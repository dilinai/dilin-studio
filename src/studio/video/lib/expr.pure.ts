// 网页剪辑页·表达式（AE 的 expression）：能打关键帧的属性都能挂一句表达式，这一刻的值＝表达式算出来的数。
// 安全：⛔ 用 eval／new Function——自己写的小直译器（只认算式、比较、三元、var/let/const、呼叫白名单函数），
//   没有回圈、没有物件／阵列字面、成员只认 Math.* 与片段把手（thisClip／clip('id')）的那几栏 ⇒ 碰不到全域、网路、原型链；
//   每次求值限步数（EXPR_MAX_STEPS）＋限时（EXPR_TIME_MS）＋别段互相引用限深度、绕圈即错。出错 ⇒ 回原值（关键帧／底值）·面板标红（exprStatus）。
// 支援：time（时间轴秒）·value（这一项原本的值）·wiggle(freq, amp, octaves?, ampMult?, t?)·loopOut('cycle'|'pingpong', numKf?)·
//   linear／ease／easeIn／easeOut(t, tMin, tMax, v1, v2) 或 (t, v1, v2)·thisClip.<栏>／clip('id').<栏>（读别段这一刻的值）·Math.*、clamp、noise。
// 本档只放纯函数（题直接跑）·⛔ 碰 DOM。
import { KF_PROPS, kfValue, type Kf, type KfProp, type KfTracks } from './keyframe.pure'

/** 一句表达式最长几个字 */
export const EXPR_MAX_LEN = 1000
/** 一次求值最多走几步（每个语法节点一步）·最长几毫秒·别段互相引用最深几层 */
export const EXPR_MAX_STEPS = 20000
export const EXPR_TIME_MS = 50
export const EXPR_MAX_DEPTH = 8

export type ClipExpr = Partial<Record<KfProp, string>>
/** 表达式要用到的片段栏位（时间换算＋关键帧＋表达式本身） */
export type ExprClip = { id?: string; start?: number; length?: number; offset?: number; kf?: KfTracks; expr?: ClipExpr }

const negOn = (k: string) => typeof window === 'undefined' && ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? '').split(',').includes(k)
/** 药：DILIN_NEG 含 vedit_expr_off ⇒ 表达式一律不算（回原值）；vedit_expr_limit_off ⇒ 不限步数／时间；vedit_expr_globals_open ⇒ 认不得的名字去 globalThis 找（只读·不准呼叫） */
export const exprNegOff = () => negOn('vedit_expr_off')
const limitOff = () => negOn('vedit_expr_limit_off')
const globalsOpen = () => negOn('vedit_expr_globals_open')

// ── 词法 ──
type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string } | { k: 'end' }
const OPS = ['===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', ',', '.', ';', '=']
function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) throw new ExprError('unclosed comment'); i = e + 2; continue }
    const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
    if (m) { out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1, s = ''
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2 } else s += src[j++] }
      if (j >= src.length) throw new ExprError('unclosed string')
      out.push({ k: 'str', v: s }); i = j + 1; continue
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new ExprError(`unexpected "${ch}"`)
    out.push({ k: 'op', v: op }); i += op.length
  }
  out.push({ k: 'end' })
  return out
}

// ── 语法 ──
export type Ast =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean } | { t: 'id'; v: string }
  | { t: 'un'; op: string; a: Ast } | { t: 'bin'; op: string; a: Ast; b: Ast } | { t: 'tern'; c: Ast; a: Ast; b: Ast }
  | { t: 'call'; f: Ast; args: Ast[] } | { t: 'mem'; o: Ast; k: string }
type Prog = { decls: Array<{ name: string; v: Ast }>; body: Ast }
export class ExprError extends Error {}
const RESERVED = new Set(['var', 'let', 'const', 'true', 'false', 'function', 'new', 'this', 'return', 'for', 'while', 'do', 'if', 'else', 'class', 'import', 'export', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof', 'with', 'yield', 'await', 'async', 'eval', 'arguments', 'constructor', 'prototype', '__proto__'])

function parse(src: string): Prog {
  const tk = lex(src)
  let p = 0
  const peek = () => tk[p]
  const isOp = (v: string) => { const x = tk[p]; return x.k === 'op' && x.v === v }
  const eat = (v: string) => { if (!isOp(v)) throw new ExprError(`expected "${v}"`); p++ }
  const prim = (): Ast => {
    const x = tk[p++]
    if (x.k === 'num') return { t: 'num', v: x.v }
    if (x.k === 'str') return { t: 'str', v: x.v }
    if (x.k === 'id') {
      if (x.v === 'true' || x.v === 'false') return { t: 'bool', v: x.v === 'true' }
      if (RESERVED.has(x.v)) throw new ExprError(`"${x.v}" is not allowed`)
      return { t: 'id', v: x.v }
    }
    if (x.k === 'op' && x.v === '(') { const e = expr(); eat(')'); return e }
    throw new ExprError(x.k === 'end' ? 'unexpected end' : `unexpected "${'v' in x ? x.v : ''}"`)
  }
  const post = (): Ast => {
    let e = prim()
    for (;;) {
      if (isOp('.')) { p++; const n = tk[p++]; if (n.k !== 'id' || RESERVED.has(n.v)) throw new ExprError('bad member name'); e = { t: 'mem', o: e, k: n.v }; continue }
      if (isOp('(')) { p++; const args: Ast[] = []; if (!isOp(')')) { for (;;) { args.push(expr()); if (isOp(',')) { p++; continue } break } } eat(')'); e = { t: 'call', f: e, args }; continue }
      return e
    }
  }
  const unary = (): Ast => { if (isOp('-') || isOp('+') || isOp('!')) { const op = (tk[p++] as { v: string }).v; return { t: 'un', op, a: unary() } } return pow() }
  const pow = (): Ast => { const a = post(); if (isOp('**')) { p++; return { t: 'bin', op: '**', a, b: unary() } } return a }
  const level = (next: () => Ast, ops: string[]) => (): Ast => { let a = next(); while (ops.some(isOp)) { const op = (tk[p++] as { v: string }).v; a = { t: 'bin', op, a, b: next() } } return a }
  const mul = level(unary, ['*', '/', '%'])
  const add = level(mul, ['+', '-'])
  const rel = level(add, ['<', '<=', '>', '>='])
  const eq = level(rel, ['===', '!==', '==', '!='])
  const and = level(eq, ['&&'])
  const or = level(and, ['||'])
  const expr = (): Ast => { const c = or(); if (isOp('?')) { p++; const a = expr(); eat(':'); return { t: 'tern', c, a, b: expr() } } return c }
  const decls: Prog['decls'] = []
  let body: Ast | null = null
  while (peek().k !== 'end') {
    const x = peek()
    if (x.k === 'id' && (x.v === 'var' || x.v === 'let' || x.v === 'const')) {
      p++
      const n = tk[p++]
      if (n.k !== 'id' || RESERVED.has(n.v)) throw new ExprError('bad variable name')
      eat('=')
      decls.push({ name: n.v, v: expr() })
    } else {
      if (body) throw new ExprError('only the last statement may be a plain expression')
      body = expr()
    }
    if (isOp(';')) { while (isOp(';')) p++; continue }
    if (peek().k !== 'end' && !(peek().k === 'id' && ['var', 'let', 'const'].includes((peek() as { v: string }).v))) throw new ExprError(`unexpected "${'v' in peek() ? (peek() as { v: unknown }).v : ''}"`)
  }
  if (!body) throw new ExprError('the expression has no result')
  return { decls, body }
}

/** 编译（快取）：语法错 ⇒ err */
const CACHE = new Map<string, Prog | string>()
export function compileExpr(src: string): { ok: true } | { ok: false; err: string } {
  const r = compiled(src)
  return typeof r === 'string' ? { ok: false, err: r } : { ok: true }
}
function compiled(src: string): Prog | string {
  const hit = CACHE.get(src)
  if (hit !== undefined) return hit
  let r: Prog | string
  if (!src.trim()) r = 'empty expression'
  else if (src.length > EXPR_MAX_LEN) r = `longer than ${EXPR_MAX_LEN} characters`
  else { try { r = parse(src) } catch (e) { r = e instanceof ExprError ? e.message : 'syntax error' } }
  if (CACHE.size > 500) CACHE.clear()
  CACHE.set(src, r)
  return r
}

// ── 求值 ──
/** 片段把手（thisClip／clip('id')）·Math 命名空间·内建函数 */
type Handle = { h: 'clip'; clip: ExprClip }
type NS = { h: 'ns'; name: string }
type Fn = { h: 'fn'; name: string; call: (args: Val[]) => Val }
type Val = number | string | boolean | Handle | NS | Fn

/** 读别段一项这一刻的值（底值＋关键帧＋它自己的表达式）·由 rig.pure 注册（这档不 import 画面属性那几档·免得绕圈） */
type PropReader = (c: ExprClip, p: KfProp, t: number) => number
let reader: PropReader | null = null
export const setPropReader = (f: PropReader) => { reader = f }
/** clip('id') 找片段用的场景（一帧画之前设好·预览、汇出、命令同一份） */
let sceneClips: Map<string, ExprClip> = new Map()
let sceneSrc: unknown = null
export function setExprScene(tracks: ReadonlyArray<{ clips: readonly ExprClip[] }>): void {
  if (sceneSrc === tracks) return
  sceneSrc = tracks
  sceneClips = new Map()
  for (const l of tracks) for (const c of l.clips) if (c.id) sceneClips.set(c.id, c)
}

/** 正在算的那几项（clip:prop）——别段互相引用绕回来 ⇒ 错 */
const stack: string[] = []
type Run = { steps: number; t0: number }

const isNum = (v: Val): v is number => typeof v === 'number'
function asNum(v: Val, what: string): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  throw new ExprError(`${what} is not a number`)
}
const r01 = (x: number) => Math.min(1, Math.max(0, x))
/** linear／ease 共用：(t, tMin, tMax, v1, v2) 或 (t, v1, v2)（t 当 0..1） */
function interp(name: string, shape: (x: number) => number) {
  return (a: Val[]) => {
    const n = a.map((x, i) => asNum(x, `${name} argument ${i + 1}`))
    if (n.length === 3) return n[1] + (n[2] - n[1]) * shape(r01(n[0]))
    if (n.length !== 5) throw new ExprError(`${name} takes (t, tMin, tMax, v1, v2) or (t, v1, v2)`)
    const [t, lo, hi, v1, v2] = n
    if (hi === lo) return t < lo ? v1 : v2
    return v1 + (v2 - v1) * shape(r01((t - lo) / (hi - lo)))
  }
}
/** 一维平滑杂讯（-1..1·同一个 seed 同一条）：格点哈希值＋smoothstep 内插 */
function hash(n: number, seed: number): number {
  let h = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return ((h >>> 0) / 4294967295) * 2 - 1
}
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u
}
export function seedOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h | 0 }

const MATH_FNS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
  sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, log10: Math.log10, hypot: Math.hypot,
}
const MATH_CONST: Record<string, number> = { PI: Math.PI, E: Math.E }
/** 把手上读得到的栏：片段时间＋各项（简写 z／rx／ry／rz＝d3.*） */
const HANDLE_ALIAS: Record<string, KfProp> = { z: 'd3.z', rx: 'd3.rx', ry: 'd3.ry', rz: 'd3.rz' }
const KF_SET = new Set<string>(KF_PROPS)

/** 这一项此刻要算的东西 */
export type ExprCtx = { clip: ExprClip; prop: KfProp; t: number; s: number; value: number; base: number; track?: readonly Kf[] }

function evaluate(prog: Prog, cx: ExprCtx, run: Run): number {
  const vars = new Map<string, Val>()
  const step = () => {
    if (limitOff()) return
    if (++run.steps > EXPR_MAX_STEPS) throw new ExprError('too much work (step limit)')
    if ((run.steps & 255) === 0 && Date.now() - run.t0 > EXPR_TIME_MS) throw new ExprError('took too long (time limit)')
  }
  const fn = (name: string, call: (a: Val[]) => Val): Fn => ({ h: 'fn', name, call })
  const readProp = (c: ExprClip, p: KfProp, t: number): number => {
    if (!reader) throw new ExprError('clip values are not available here')
    const key = `${c.id ?? '?'}:${p}`
    if (stack.includes(key)) throw new ExprError(`loop: ${key} depends on itself`)
    if (stack.length >= EXPR_MAX_DEPTH) throw new ExprError('clip references nested too deep')
    stack.push(key)
    try { return reader(c, p, t) } finally { stack.pop() }
  }
  const member = (o: Val, k: string): Val => {
    if (typeof o === 'object' && o.h === 'ns' && o.name === 'Math') {
      if (k in MATH_CONST) return MATH_CONST[k]
      if (k in MATH_FNS) return fn(`Math.${k}`, (a) => MATH_FNS[k](...a.map((x, i) => asNum(x, `Math.${k} argument ${i + 1}`))))
      throw new ExprError(`Math.${k} is not available`)
    }
    if (typeof o === 'object' && o.h === 'clip') {
      const c = o.clip
      if (k === 'start') return c.start ?? 0
      if (k === 'length') return c.length ?? 0
      if (k === 'end') return (c.start ?? 0) + (c.length ?? 0)
      if (k === 'offset') return c.offset ?? 0
      if (k === 'prop') return fn('prop', (a) => { const p = a[0]; if (typeof p !== 'string' || !KF_SET.has(HANDLE_ALIAS[p] ?? p)) throw new ExprError(`unknown property ${String(p)}`); return readProp(c, (HANDLE_ALIAS[p] ?? p) as KfProp, a.length > 1 ? asNum(a[1], 'time') : cx.t) })
      const p = HANDLE_ALIAS[k] ?? k
      if (KF_SET.has(p)) return readProp(c, p as KfProp, cx.t)
      throw new ExprError(`clips have no "${k}"`)
    }
    if (globalsOpen() && o !== null && (typeof o === 'object' || typeof o === 'function')) return (o as unknown as Record<string, Val>)[k] // 药：只读穿透（题看沙盒有没有挡）
    throw new ExprError(`"${k}" can't be read here`)
  }
  const ident = (name: string): Val => {
    if (vars.has(name)) return vars.get(name)!
    switch (name) {
      case 'time': return cx.t
      case 'value': return cx.value
      case 'PI': return Math.PI
      case 'Math': return { h: 'ns', name: 'Math' }
      case 'thisClip': return { h: 'clip', clip: cx.clip }
    }
    if (name in MATH_FNS) return member({ h: 'ns', name: 'Math' }, name)
    const b = BUILTINS[name]
    if (b) return fn(name, (a) => b(a, cx))
    if (globalsOpen() && name in globalThis) return (globalThis as unknown as Record<string, Val>)[name]
    throw new ExprError(`unknown name "${name}"`)
  }
  const ev = (n: Ast): Val => {
    step()
    switch (n.t) {
      case 'num': return n.v
      case 'str': return n.v
      case 'bool': return n.v
      case 'id': return ident(n.v)
      case 'mem': return member(ev(n.o), n.k)
      case 'un': { const a = ev(n.a); return n.op === '!' ? !truthy(a) : n.op === '-' ? -asNum(a, 'operand') : asNum(a, 'operand') }
      case 'tern': return truthy(ev(n.c)) ? ev(n.a) : ev(n.b)
      case 'bin': {
        if (n.op === '&&') { const a = ev(n.a); return truthy(a) ? ev(n.b) : a }
        if (n.op === '||') { const a = ev(n.a); return truthy(a) ? a : ev(n.b) }
        const a = ev(n.a), b = ev(n.b)
        if (n.op === '==' || n.op === '===') return eqv(a, b)
        if (n.op === '!=' || n.op === '!==') return !eqv(a, b)
        const x = asNum(a, 'left side'), y = asNum(b, 'right side')
        switch (n.op) {
          case '+': return x + y
          case '-': return x - y
          case '*': return x * y
          case '/': return x / y
          case '%': return x % y
          case '**': return x ** y
          case '<': return x < y
          case '<=': return x <= y
          case '>': return x > y
          case '>=': return x >= y
        }
        throw new ExprError(`unknown operator ${n.op}`)
      }
      case 'call': {
        const f = ev(n.f)
        if (typeof f !== 'object' || f.h !== 'fn') throw new ExprError('only built-in functions can be called')
        return f.call(n.args.map(ev))
      }
    }
  }
  for (const d of prog.decls) vars.set(d.name, ev(d.v))
  const r = ev(prog.body)
  const v = asNum(r, 'the result')
  if (!Number.isFinite(v)) throw new ExprError('the result is not a finite number')
  return v
}
const truthy = (v: Val) => (typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : typeof v === 'string' ? v.length > 0 : typeof v === 'boolean' ? v : true)
const eqv = (a: Val, b: Val) => (typeof a === 'object' || typeof b === 'object' ? a === b : a === b)

/** 内建函数（拿得到这一项的上下文：value、关键帧轨、时刻） */
const BUILTINS: Record<string, (a: Val[], cx: ExprCtx) => Val> = {
  clip: (a) => {
    const id = a[0]
    if (typeof id !== 'string') throw new ExprError('clip("id") needs a clip id string')
    const c = sceneClips.get(id)
    if (!c) throw new ExprError(`no clip "${id}"`)
    return { h: 'clip', clip: c }
  },
  wiggle: (a, cx) => {
    const n = a.map((x, i) => asNum(x, `wiggle argument ${i + 1}`))
    if (n.length < 2) throw new ExprError('wiggle takes (freq, amp, octaves?, ampMult?, t?)')
    const [freq, amp] = n
    const oct = Math.max(1, Math.min(8, Math.round(n[2] ?? 1))), mult = n[3] ?? 0.5, t = n[4] ?? cx.t
    const seed = seedOf(`${cx.clip.id ?? ''}:${cx.prop}`)
    let s = 0, k = 1, f = freq
    for (let i = 0; i < oct; i++) { s += k * noise1(t * f, seed + i * 7919); k *= mult; f *= 2 }
    return cx.value + amp * s
  },
  loopOut: (a, cx) => {
    const type = a[0] === undefined ? 'cycle' : a[0]
    if (type !== 'cycle' && type !== 'pingpong') throw new ExprError('loopOut type must be "cycle" or "pingpong"')
    const nk = a[1] === undefined ? 0 : Math.max(0, Math.round(asNum(a[1], 'loopOut numKeyframes')))
    const tr = cx.track
    if (!tr || tr.length < 2) return cx.value
    const last = tr[tr.length - 1], first = tr[nk > 0 ? Math.max(0, tr.length - 1 - nk) : 0]
    const span = last.t - first.t
    if (!(span > 0) || cx.s <= last.t) return cx.value
    const d = cx.s - first.t, k = Math.floor(d / span), r = d - k * span
    const s = type === 'cycle' ? first.t + r : k % 2 === 0 ? first.t + r : last.t - r
    return kfValue(tr, s, cx.base)
  },
  linear: interp('linear', (x) => x),
  ease: interp('ease', (x) => (1 - Math.cos(Math.PI * x)) / 2),
  easeIn: interp('easeIn', (x) => 1 - Math.cos((Math.PI * x) / 2)),
  easeOut: interp('easeOut', (x) => Math.sin((Math.PI * x) / 2)),
  clamp: (a) => { const [v, lo, hi] = a.map((x, i) => asNum(x, `clamp argument ${i + 1}`)); return Math.min(hi, Math.max(lo, v)) },
  noise: (a, cx) => noise1(asNum(a[0], 'noise argument'), seedOf(`${cx.clip.id ?? ''}:${cx.prop}`)),
  degreesToRadians: (a) => (asNum(a[0], 'degreesToRadians argument') * Math.PI) / 180,
  radiansToDegrees: (a) => (asNum(a[0], 'radiansToDegrees argument') * 180) / Math.PI,
}

/** 算一句：成功 ⇒ 数；语法错／执行错／超限 ⇒ err（呼叫的人回原值） */
export function runExpr(src: string, cx: ExprCtx): { ok: true; v: number } | { ok: false; err: string } {
  const prog = compiled(src)
  if (typeof prog === 'string') return { ok: false, err: prog }
  const outer = stack.length === 0
  // 步数／时间限额整次共用（别段的表达式经 clip('id') 套进来也算在同一份里·免得一层层摊开绕过限额）
  const run: Run = outer || !curRun ? { steps: 0, t0: Date.now() } : curRun
  const prev = curRun
  curRun = run
  if (outer) stack.push(`${cx.clip.id ?? '?'}:${cx.prop}`)
  try { return { ok: true, v: evaluate(prog, cx, run) } } catch (e) { return { ok: false, err: e instanceof ExprError ? e.message : 'error' } } finally { if (outer) stack.pop(); curRun = prev }
}
let curRun: Run | null = null

/** 关键帧（或底值）＋表达式：t＝时间轴秒·s＝素材秒（关键帧那把尺）·base＝没关键帧时的底值。没表达式／出错 ⇒ 回关键帧值 */
export function kfExpr(c: ExprClip, p: KfProp, t: number, s: number, base: number): number {
  const value = kfValue(c.kf?.[p], s, base)
  const src = c.expr?.[p]
  if (!src || exprNegOff()) return value
  const r = runExpr(src, { clip: c, prop: p, t, s, value, base, track: c.kf?.[p] })
  return r.ok ? r.v : value
}
/** 面板用：这一项此刻的表达式结果（没表达式 ⇒ null；出错 ⇒ err＋原值） */
export function exprStatus(c: ExprClip, p: KfProp, t: number, s: number, base: number): { ok: true; v: number } | { ok: false; err: string; v: number } | null {
  const src = c.expr?.[p]
  if (!src) return null
  const value = kfValue(c.kf?.[p], s, base)
  const r = runExpr(src, { clip: c, prop: p, t, s, value, base, track: c.kf?.[p] })
  return r.ok ? r : { ok: false, err: r.err, v: value }
}
/** 读档验值：只收认得的项、字串、编得过；ok＝这段能挂表达式的项（同关键帧那几项）；坏的回 bad（读档报出来） */
export function parseExprs(v: unknown, ok: (p: KfProp) => boolean): { expr?: ClipExpr; bad: string[] } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { bad: v === undefined ? [] : ['expr'] }
  const out: ClipExpr = {}
  const bad: string[] = []
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
    if (!KF_SET.has(k) || !ok(k as KfProp) || typeof s !== 'string' || !compileExpr(s).ok) { bad.push(k); continue }
    out[k as KfProp] = s
  }
  return { ...(Object.keys(out).length ? { expr: out } : {}), bad }
}
