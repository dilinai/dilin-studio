/**
 * 简报程序动画「死循环计时闸」·服务端编译器。
 * ⛔ 客户端 import 本档（会把 acorn／parse5 带进前端包·另有题钉住）：只给服务端存档出口与服务端渲染用。
 *
 * 输入：程序组件的 { html, css, steps }（先过 program-source.ts 的规范化·型别不对抛 program_bad_input）。
 * 做法：parse5 按 body 片段解析作者 html（含 <template> 内容、SVG）⇒
 *   script 元素分类：
 *       可执行（无 src·classic／module）⇒ acorn 解析、插检查 ⇒ 记录编译后文字＋namespace＋type＋语法目标＋CSP hash；
 *       资料（无 src·浏览器不执行的 type）⇒ 文字原样、记录、不进 hash 名单；
 *       带 src（不论 type）、importmap／speculationrules、SVG 里不认的 type ⇒ 拿掉、原位留注释、回一句白话提示。
 *   每个 on* 事件属性：按浏览器参数表当 FunctionBody 解析（包装边界核·防借包装逃出）⇒ 插检查 ⇒ 记录＋hash。
 * 插检查 `;({}).__dlg_pN();`（N＝政策版本·Object.prototype 上不可写不可配置）：
 *   函式（各种）＝完整指示序言之后；箭头简写体包成 `{;检查;return (体)}`；循环体开头（单句体先包 {}）；class static block 开头；
 *   每段 script 的入口检查＝完整指示序言之后、第一个作者可执行语句之前（module 的 import／export-from 留在原位）。
 *   同一位置多处插字合并成一份有序编辑：先收尾（内层先收）、再开头（外层先开），文字全保·⛔ 去重。
 * 拒收 program_syntax_error：语法错（ecmaVersion 2022 以上的语法也算·部分浏览器不认）；with；`__dlg` 开头的识别字或含 `__dlg_` 的字串；
 *   Annex B 单句 `if (x) function f(){}`。
 */
import * as acorn from 'acorn'
import { parseFragment, serialize } from 'parse5'
import {
  normalizeProgramSource, programSourceKey, cspSha256, PROGRAM_CHECK_NAME, PROGRAM_COMPILED_V, type ProgramSourceInput,
  type CompiledAttr, type CompiledProgram, type CompiledScript,
} from './program-source'
import {
  classifyScript, handlerParams, hasSrc, isEventAttrName, nsOf, textOf, walkElements,
  type P5Element, type P5Node, type P5Parent,
} from './program-html'

import { assembleProgramDoc } from './program-assemble'
import { verifyProgramDoc } from './program-verify'

export { classifyScript, walkElements } from './program-html'
export const PROGRAM_ECMA_VERSION = 2022 as const
export const CHECK_CALL = `;({}).${PROGRAM_CHECK_NAME}();`

export type { ProgramNs, CompiledScript, CompiledAttr, CompiledProgram } from './program-source'
export type CompileResult = { compiled: CompiledProgram; notices: string[] }

export class ProgramCompileError extends Error {
  readonly code = 'program_syntax_error' as const
  constructor(readonly where: string, readonly line: number, readonly column: number, readonly reason: string, readonly sourceLine: string) {
    super(`${where}第 ${line} 行第 ${column} 欄：${reason}${sourceLine ? `\n  ${sourceLine}` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/* JS 改写                                                              */
/* ------------------------------------------------------------------ */

type Edit = { pos: number; text: string; close: boolean; depth: number; seq: number }
type AnyNode = acorn.Node & Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'raw', 'regex', 'bigint'])

function lineCol(src: string, pos: number): { line: number; column: number; text: string } {
  let line = 1, ls = 0
  for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) { line++; ls = i + 1 }
  const le = src.indexOf('\n', ls)
  return { line, column: pos - ls + 1, text: src.slice(ls, le < 0 ? undefined : le).slice(0, 200) }
}

/** 函式体／Program 的「完整指示序言」结束位置（没有指示 ⇒ null） */
function prologueEnd(body: AnyNode[]): number | null {
  let end: number | null = null
  for (const s of body) {
    if (s.type === 'ExpressionStatement' && typeof s.directive === 'string') end = s.end
    else break
  }
  return end
}

function isLoop(t: string): boolean {
  return t === 'ForStatement' || t === 'ForInStatement' || t === 'ForOfStatement' || t === 'WhileStatement' || t === 'DoWhileStatement'
}
function isFunction(t: string): boolean {
  return t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression'
}

/**
 * 走 AST、收集插字、顺便核拒收规则。`offset`＝这段 AST 在原文里的位移（事件属性包装用）·`fail(pos, reason)` 抛编译错。
 */
function collectEdits(root: AnyNode, fail: (pos: number, reason: string) => never): Edit[] {
  const edits: Edit[] = []
  let seq = 0
  const add = (pos: number, text: string, close: boolean, depth: number) => edits.push({ pos, text, close, depth, seq: seq++ })
  const checkName = (pos: number, name: string) => { if (name.startsWith('__dlg')) fail(pos, `不能用 __dlg 開頭的名字（${name}）——這是播放器保留的`) }
  const checkStr = (pos: number, v: unknown) => { if (typeof v === 'string' && v.includes('__dlg_')) fail(pos, '字串裡不能含 __dlg_——這是播放器保留的') }
  const visit = (node: AnyNode, depth: number) => {
    switch (node.type) {
      case 'WithStatement': fail(node.start, '不支援 with 語句')
      // eslint-disable-next-line no-fallthrough
      case 'Identifier': case 'PrivateIdentifier': checkName(node.start, node.name); break
      case 'Literal': checkStr(node.start, node.value); break
      case 'TemplateElement': checkStr(node.start, node.value?.cooked); checkStr(node.start, node.value?.raw); break
      case 'IfStatement':
        if (node.consequent?.type === 'FunctionDeclaration' || node.alternate?.type === 'FunctionDeclaration') {
          fail(node.start, 'if 後面直接寫 function 宣告不支援，請改成 if (…) { function … }')
        }
        break
      case 'StaticBlock': add(braceAfterStatic(node), CHECK_CALL, false, depth); break
    }
    if (isFunction(node.type)) {
      const b = node.body as AnyNode
      if (node.type === 'ArrowFunctionExpression' && node.expression) {
        add(b.start, `{${CHECK_CALL}return (`, false, depth)
        add(b.end, ')}', true, depth)
      } else {
        const pe = prologueEnd(b.body)
        add(pe ?? b.start + 1, CHECK_CALL, false, depth)
      }
    } else if (isLoop(node.type)) {
      const b = node.body as AnyNode
      if (b.type === 'BlockStatement') add(b.start + 1, CHECK_CALL, false, depth)
      else { add(b.start, `{${CHECK_CALL}`, false, depth); add(b.end, '}', true, depth) }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, depth + 1) }
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, depth + 1)
    }
  }
  visit(root, 0)
  return edits
}

/** class static block：`static {` 的 `{` 后一位（acorn 的 StaticBlock.start 指向 static·中间可夹注释 ⇒ 用 tokenizer 跳过注释找第二个记号） */
let currentSrc = ''
function braceAfterStatic(node: AnyNode): number {
  const toks = acorn.tokenizer(currentSrc.slice(node.start), { ecmaVersion: PROGRAM_ECMA_VERSION })
  toks.getToken() // static
  const brace = toks.getToken()
  if (brace.type.label !== '{') throw new Error('static block 找不到 {')
  return node.start + brace.start + 1
}

/** 合并同位置插字：先收尾（内层先收＝depth 大的先）、再开头（外层先开＝depth 小的先）；同 depth 按收集顺序 */
export function applyEdits(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    if (a.close !== b.close) return a.close ? -1 : 1
    if (a.depth !== b.depth) return a.close ? b.depth - a.depth : a.depth - b.depth
    return a.close ? b.seq - a.seq : a.seq - b.seq
  })
  let out = '', at = 0
  for (const e of sorted) { out += src.slice(at, e.pos) + e.text; at = e.pos }
  return out + src.slice(at)
}

function parseJs(src: string, sourceType: 'script' | 'module', where: string, map?: (pos: number) => number, mapSrc?: string): AnyNode {
  try {
    return acorn.parse(src, {
      ecmaVersion: PROGRAM_ECMA_VERSION, sourceType, preserveParens: true, allowHashBang: false,
      allowReturnOutsideFunction: false, allowImportExportEverywhere: false, allowAwaitOutsideFunction: false,
    }) as AnyNode
  } catch (e) {
    const pos = typeof (e as { pos?: number }).pos === 'number' ? (e as { pos: number }).pos : 0
    const real = map ? map(pos) : pos
    const lc = lineCol(mapSrc ?? src, real)
    const msg = String((e as Error).message).replace(/\s*\(\d+:\d+\)$/, '')
    throw new ProgramCompileError(where, lc.line, lc.column, `語法錯誤（${msg}；只認 ES${PROGRAM_ECMA_VERSION} 以內的寫法，較新的語法部分瀏覽器不認）`, lc.text)
  }
}

/** 一段 script／module：插入口检查＋函式／循环检查 */
export function compileScriptText(src: string, kind: 'classic' | 'module', where: string): string {
  const ast = parseJs(src, kind === 'module' ? 'module' : 'script', where)
  currentSrc = src
  const fail = (pos: number, reason: string): never => { const lc = lineCol(src, pos); throw new ProgramCompileError(where, lc.line, lc.column, reason, lc.text) }
  const edits = collectEdits(ast, fail)
  // 入口检查：完整指示序言之后、第一个作者可执行语句之前；module 的 import／export … from 不算可执行（留原位）
  const body = ast.body as AnyNode[]
  const pe = prologueEnd(body)
  let entry: number
  if (kind === 'classic') entry = pe ?? (body.length ? body[0].start : 0)
  else {
    // module：序言之后、第一个「不是 import／export … from」的语句之前；import 留原位（作者语句可以排在 import 前面）
    const afterPrologue = body.filter((s) => !(s.type === 'ExpressionStatement' && typeof s.directive === 'string' && s.end <= (pe ?? -1)))
    const first = afterPrologue.find((s) => !isStaticModuleDecl(s))
    entry = first ? first.start : (pe ?? (body.length ? body[body.length - 1].end : 0))
  }
  edits.push({ pos: entry, text: CHECK_CALL, close: false, depth: -1, seq: -1 })
  return applyEdits(src, edits)
}

function isStaticModuleDecl(s: AnyNode): boolean {
  return s.type === 'ImportDeclaration' || s.type === 'ExportAllDeclaration' || (s.type === 'ExportNamedDeclaration' && !!s.source)
}

/** 事件属性值：按浏览器参数表当 FunctionBody 解析（包装边界核）·插检查 */
export function compileHandlerBody(value: string, params: string, where: string): string {
  const prefix = `(function(${params}){\n`
  const wrapped = `${prefix}${value}\n})`
  const map = (pos: number) => Math.max(0, Math.min(value.length, pos - prefix.length))
  const ast = parseJs(wrapped, 'script', where, map, value)
  const fail = (pos: number, reason: string): never => { const lc = lineCol(value, map(pos)); throw new ProgramCompileError(where, lc.line, lc.column, reason, lc.text) }
  // 包装边界核：恰一个表达式语句、是（括号里的）函式表达式、函式体范围恰是原值
  const stmts = ast.body as AnyNode[]
  let fn = stmts.length === 1 && stmts[0].type === 'ExpressionStatement' ? (stmts[0].expression as AnyNode) : null
  if (fn && fn.type === 'ParenthesizedExpression') fn = fn.expression as AnyNode
  if (!fn || fn.type !== 'FunctionExpression' || fn.body.start !== prefix.length - 2 || fn.body.end !== wrapped.length - 1) {
    fail(prefix.length, '事件屬性的寫法跳出了函式本體（例如多出 `});`），不支援')
  }
  currentSrc = wrapped
  // 插字都在函式体 { … } 之内；换回原值坐标（体开头那一格＝包装的 { 后一位 ⇒ 落在原值第 0 位）
  const edits = collectEdits(fn as AnyNode, fail).map((e) => ({ ...e, pos: Math.max(0, Math.min(value.length, e.pos - prefix.length)) }))
  return applyEdits(value, edits)
}

/* ------------------------------------------------------------------ */
/* HTML 片段                                                            */
/* ------------------------------------------------------------------ */

function setText(el: P5Element, text: string) {
  const tn = { nodeName: '#text', value: text, parentNode: el } as unknown as P5Node
  el.childNodes = text ? [tn as never] : []
}

export function compileProgram(src: ProgramSourceInput): CompileResult {
  const n = normalizeProgramSource(src)
  const key = programSourceKey(n)
  // css 放进 <style>：出现 </style（不分大小写）就会截断样式、后面变成标签 ⇒ 拒收（ 组装不替作者转义）
  const cut = n.css.search(/<\/style/i)
  if (cut >= 0) { const lc = lineCol(n.css, cut); throw new ProgramCompileError('樣式', lc.line, lc.column, '樣式裡不能出現 </style', lc.text) }
  const frag = parseFragment(n.html, { scriptingEnabled: true })
  const scripts: CompiledScript[] = []
  const attrs: CompiledAttr[] = []
  const notices: string[] = []
  let scriptNo = 0, handlerNo = 0
  walkElements(frag, (el) => {
    const ns = nsOf(el)
    const isScript = el.tagName === 'script'
    let cls: ReturnType<typeof classifyScript>['cls'] | null = null, type: string | null = null
    if (isScript) {
      scriptNo++
      const src = hasSrc(el)
      ;({ cls, type } = classifyScript(el))
      // 要拿掉的 script 先拿掉、⛔ 先收它的 on* ——
      //   不然产物里没有这个元素、attrs 却记着它的事件属性 ⇒ 读回核个数对不上 ⇒ 本该「拿掉＋提示」的整笔被拒成 program_syntax_error
      if (src || cls === 'unsupported') {
        const parent = el.parentNode as P5Parent
        const i = parent.childNodes.indexOf(el as never)
        const comment = { nodeName: '#comment', data: 'dilin: script removed', parentNode: parent } as unknown as P5Node
        parent.childNodes.splice(i, 1, comment as never)
        notices.push(src ? `第 ${scriptNo} 段外部腳本（src／href）不支援，已拿掉` : `第 ${scriptNo} 段腳本（type=${type ?? ''}）不支援，已拿掉`)
        return
      }
    }
    // 留下来的元素（含留下的 script）才收事件属性
    for (const a of el.attrs) {
      if (a.namespace || !isEventAttrName(a.name)) continue
      handlerNo++
      const where = `第 ${handlerNo} 個事件屬性（<${el.tagName} ${a.name}>）`
      a.value = compileHandlerBody(a.value, handlerParams(el), where)
      attrs.push({ ns, el: el.tagName, name: a.name, value: a.value, hash: cspSha256(a.value) })
    }
    if (!isScript || cls === null) return
    const text = textOf(el)
    if (cls === 'data') { scripts.push({ kind: 'data', ns, type, text }); return }
    const out = compileScriptText(text, cls, `第 ${scriptNo} 段腳本`)
    setText(el, out)
    scripts.push({ kind: cls, ns, type, text: out, hash: cspSha256(out) })
  })
  const html = serialize(frag)
  const hashes = [...new Set([...scripts.flatMap((s) => (s.kind === 'data' ? [] : [s.hash])), ...attrs.map((a) => a.hash)])]
  // 拿掉了什么跟着产物走（存档带着、读回带着、编辑页显示一句）——生产写路只取 compiled
  const compiled: CompiledProgram = { v: PROGRAM_COMPILED_V, key, html, css: n.css, hashes, scripts, attrs, ...(notices.length ? { notices: [...notices] } : {}) }
  // 存档时先自己组装＋读回核一次（框外观与 gen 不影响作者段）：浏览器读法与片段读法不一致（命名空间混淆等）⇒ 当场拒收、说原因，
  // ⛔ 存进去、播放时才静默变静态
  const probe = { w: 100, h: 100, bg: 'transparent', font: 'sans-serif', steps: n.steps }
  const vr = verifyProgramDoc(assembleProgramDoc(compiled, probe, '0'.repeat(16)), compiled, probe)
  if (!vr.ok) throw new ProgramCompileError('HTML', 1, 1, `這段 HTML 播放時會被瀏覽器讀成不同的結構（${vr.reason}），請改寫（例如別把 <style>／<img> 包在 <math>／<svg> 裡）`, '')
  return { compiled, notices }
}
