// 表格条件格式
//   纯函数·网页（SheetGrid 画格／工具栏小面板）、服务端（净化闸 _shared、AI 改表 agent-ops）、xlsx 进出（cond-format-xlsx.ts）同一份。
//   ⛔ 不碰库、不碰 React、不碰网络。
//
//   资料：content.condFormats = CondRule[]（数组顺序＝优先序·第 0 条最高＝Excel「規則管理員」最上面那条）
//     { id, ranges:['D2:D30', …], type, value?, value2?, n?, percent?, equal?, text?, colors?, style?, stop? }
//     type：greater／greater_equal／less／less_equal／equal／not_equal／between／not_between（Excel cellIs）
//           top／bottom（前／后 N 名·percent＝按百分比）·above_average／below_average（equal＝含等于平均）
//           duplicate／unique·text_contains·color_scale（colors＝[最小, (中位), 最大]）·data_bar（colors＝[条色]）
//           色阶／数据条的 colors 可省 ⇒ 用预设色（COLOR_SCALE_DEFAULT／DATA_BAR_DEFAULT）；条长一律按区里数字格的最小～最大自动算
//     style：命中时叠上去的格式（只收 fg／bg／b／i／u／s·跟格样式 CellStyle 同名）；⛔ 改格本身存的样式（显示时叠）
//
//   判定口径（照 Excel·依据见 cond-format.test.ts 各组对照）：
//     cellIs：照公式比较 = < > 的规矩（formula-lib compareScalars）——空格跟对方同型（比数字当 0、比文字当 ""）、
//       文字永远大于数字（「大于 500」会套到文字格）、文字不分大小写、数字比 15 位；错误格一律不套。between 两端不分先后。
//     top／bottom／above／below_average／color_scale／data_bar：只算区里的数字格（文字、逻辑值、空格、错误都不算也不套）；
//       前 N 名并列 ⇒ 门槛那个值的格全套（可能多于 N 格）；百分比＝floor(数字格数×N%)·至少 1 格。
//     duplicate／unique：空格不算；文字不分大小写；数字跟「文字型数字」不算同值；错误不套。
//     text_contains：照 Excel 自动生成的 SEARCH 公式——不分大小写、认 * ? ~ 通配、数字按常规显示字比、空格／错误不套。
//     多条规则同一格：全部照优先序套·同一项（字色／底色／粗体…）先的赢；stop＝命中后后面的规则不再看（色阶／数据条不吃 stop）。
//     合并区：只看左上格（被盖住的格当空格·跟 Excel 一样）。
//   数据条：照 Excel 2007 口径（cfvo min／max·条长 10%～90%·渐层）——负值不画轴、一样按最小到最大比例（简化·写明）。

import { cellKey, colToIndex, indexToCol, SheetEvaluator, type SheetContent, type Scalar, type EvaluatorOptions } from './formula'
import { compareScalars, numToText, to15, eq15, hasWildcard, wildcardRegex, isFormulaError } from './formula-lib'
import { coveredMap, rectsOverlap, rectContains, type Rect, type CellStyle } from './style'

/** 同 agent-ops MAX_ROW_INDEX／MAX_COL_INDEX（那边 import 本档·这里另写一份免得循环） */
const MAX_ROW = 999998
const MAX_COL = 18277
export const COND_RULES_MAX = 100
export const COND_RANGES_MAX = 32
export const COND_TEXT_MAX = 255
export const COND_N_MAX = 1000

export const CELLIS_TYPES = ['greater', 'greater_equal', 'less', 'less_equal', 'equal', 'not_equal', 'between', 'not_between'] as const
export const COND_TYPES = [...CELLIS_TYPES, 'top', 'bottom', 'above_average', 'below_average', 'duplicate', 'unique', 'text_contains', 'color_scale', 'data_bar'] as const
export type CellIsType = typeof CELLIS_TYPES[number]
export type CondType = typeof COND_TYPES[number]
/** 命中时叠上去的格式（键名＝CellStyle 同名那几项） */
export type CondStyle = Pick<CellStyle, 'fg' | 'bg'> & { b?: true; i?: true; u?: true; s?: true }
export type CondRule = {
  id: string
  ranges: string[]
  type: CondType
  value?: number | string
  value2?: number | string
  n?: number
  percent?: true
  equal?: true
  text?: string
  colors?: string[]
  style?: CondStyle
  stop?: true
}

/** Excel 的三组预设（「醒目提示儲存格規則」对话框那几组） */
export const COND_PRESETS = {
  light_red: { bg: '#ffc7ce', fg: '#9c0006' },
  yellow: { bg: '#ffeb9c', fg: '#9c5700' },
  green: { bg: '#c6efce', fg: '#006100' },
  light_red_fill: { bg: '#ffc7ce' },
  red_text: { fg: '#9c0006' },
} as const satisfies Record<string, CondStyle>
export type CondPreset = keyof typeof COND_PRESETS
export const COND_PRESET_NAMES = Object.keys(COND_PRESETS) as CondPreset[]
/** 色阶预设：红（小）→ 黄 → 绿（大）＝Excel「綠-黃-紅色階」 */
export const COLOR_SCALE_DEFAULT = ['#f8696b', '#ffeb84', '#63be7b']
/** 数据条预设：Excel 蓝色数据条 */
export const DATA_BAR_DEFAULT = '#638ec6'

const STYLE_TYPES: readonly CondType[] = [...CELLIS_TYPES, 'top', 'bottom', 'above_average', 'below_average', 'duplicate', 'unique', 'text_contains']
export const isStyleType = (t: CondType) => STYLE_TYPES.includes(t)

// ── 颜色：只收 #rgb／#rrggbb（导出 xlsx 要精确 ARGB）＋常用色名 ⇒ 一律存 #rrggbb 小写 ──
const NAMED: Record<string, string> = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080', gray: '808080', grey: '808080', pink: 'ffc0cb', brown: 'a52a2a', cyan: '00ffff', magenta: 'ff00ff', lime: '00ff00', navy: '000080', teal: '008080', silver: 'c0c0c0', maroon: '800000', olive: '808000' }
export function normColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const c = v.trim().toLowerCase()
  if (NAMED[c]) return '#' + NAMED[c]
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]
  return '#' + h
}

// ── 区间：'A1'／'A1:B5'／'A:C'／'2:5'（可带 $）·多段用逗号或空白分 ──
const SEG_RE = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/
/** 一段 ⇒ 矩形；坏形／越界 ⇒ null */
export function parseSeg(seg: string): Rect | null {
  const s = seg.trim().toUpperCase()
  let m = SEG_RE.exec(s)
  if (m) {
    const ra = Number(m[2]) - 1, ca = colToIndex(m[1])
    const rb = m[4] ? Number(m[4]) - 1 : ra, cb = m[3] ? colToIndex(m[3]) : ca
    if ([ra, rb].some(r => r < 0 || r > MAX_ROW) || [ca, cb].some(c => c < 0 || c > MAX_COL)) return null
    return { r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: Math.min(ca, cb), c1: Math.max(ca, cb) }
  }
  m = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/.exec(s)
  if (m) { const a = colToIndex(m[1]), b = colToIndex(m[2]); if (a > MAX_COL || b > MAX_COL) return null; return { r0: 0, r1: MAX_ROW, c0: Math.min(a, b), c1: Math.max(a, b) } }
  m = /^\$?(\d{1,7}):\$?(\d{1,7})$/.exec(s)
  if (m) { const a = Number(m[1]) - 1, b = Number(m[2]) - 1; if (a < 0 || b < 0 || a > MAX_ROW || b > MAX_ROW) return null; return { r0: Math.min(a, b), r1: Math.max(a, b), c0: 0, c1: MAX_COL } }
  return null
}
/** 矩形 ⇒ 存的字（单格 'B2'·其余 'A1:C3'） */
export function segText(r: Rect): string {
  return r.r0 === r.r1 && r.c0 === r.c1 ? cellKey(r.r0, r.c0) : `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}`
}
/** 给人／AI 看的字：整列 'E:E'、整行 '2:5' 照那样写 */
export function segLabel(r: Rect): string {
  if (r.r0 === 0 && r.r1 === MAX_ROW) return `${indexToCol(r.c0)}:${indexToCol(r.c1)}`
  if (r.c0 === 0 && r.c1 === MAX_COL) return `${r.r0 + 1}:${r.r1 + 1}`
  return segText(r)
}
export const rangesLabel = (ranges: string[]) => ranges.map(s => { const r = parseSeg(s); return r ? segLabel(r) : s }).join(',')
/** 'D2:D30, F2:F30' ⇒ 矩形们；任一段坏 ⇒ null */
export function parseRanges(input: unknown): Rect[] | null {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,，;\s]+/) : null
  if (!parts) return null
  const out: Rect[] = []
  for (const p of parts) {
    if (typeof p !== 'string') return null
    if (!p.trim()) continue
    const r = parseSeg(p)
    if (!r) return null
    out.push(r)
  }
  return out.length ? out : null
}
const rectsOf = (rule: CondRule): Rect[] => rule.ranges.map(parseSeg).filter((x): x is Rect => !!x)

/** a 减掉 b ⇒ 剩下的（至多 4 块·上／下整宽＋左／右夹在中间） */
export function subtractRect(a: Rect, b: Rect): Rect[] {
  if (!rectsOverlap(a, b)) return [a]
  const out: Rect[] = []
  if (a.r0 < b.r0) out.push({ r0: a.r0, r1: b.r0 - 1, c0: a.c0, c1: a.c1 })
  if (a.r1 > b.r1) out.push({ r0: b.r1 + 1, r1: a.r1, c0: a.c0, c1: a.c1 })
  const r0 = Math.max(a.r0, b.r0), r1 = Math.min(a.r1, b.r1)
  if (a.c0 < b.c0) out.push({ r0, r1, c0: a.c0, c1: b.c0 - 1 })
  if (a.c1 > b.c1) out.push({ r0, r1, c0: b.c1 + 1, c1: a.c1 })
  return out
}

// ── 净化（服务端存库前·xlsx 导入后都过这一份）──
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
function sanitizeCondStyle(x: unknown): CondStyle | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined
  const o = x as Record<string, unknown>
  const s: CondStyle = {}
  const fg = normColor(o.fg), bg = normColor(o.bg)
  if (fg) s.fg = fg
  if (bg) s.bg = bg
  for (const k of ['b', 'i', 'u', 's'] as const) if (o[k] === true) s[k] = true
  return Object.keys(s).length ? s : undefined
}
function condValue(v: unknown): number | string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.length > 0 && v.length <= COND_TEXT_MAX && !v.trim().startsWith('=')) return v
  return undefined
}

/** 净化 condFormats：白名单键·坏规则整条丢（不整份拒）·id 重复的后者丢·上限 100 条·每条 32 段 */
export function sanitizeCondFormats(input: unknown): CondRule[] {
  if (!Array.isArray(input)) return []
  const out: CondRule[] = []
  const seen = new Set<string>()
  for (const it of input.slice(0, COND_RULES_MAX)) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    const x = it as Record<string, unknown>
    if (typeof x.id !== 'string' || !ID_RE.test(x.id) || seen.has(x.id)) continue
    if (typeof x.type !== 'string' || !(COND_TYPES as readonly string[]).includes(x.type)) continue
    const type = x.type as CondType
    if (!Array.isArray(x.ranges)) continue
    const rects = x.ranges.slice(0, COND_RANGES_MAX).map(s => (typeof s === 'string' ? parseSeg(s) : null)).filter((r): r is Rect => !!r)
    if (!rects.length) continue
    const rule: CondRule = { id: x.id, ranges: rects.map(segText), type }
    if ((CELLIS_TYPES as readonly string[]).includes(type)) {
      const v = condValue(x.value); if (v === undefined) continue
      rule.value = v
      if (type === 'between' || type === 'not_between') { const v2 = condValue(x.value2); if (v2 === undefined) continue; rule.value2 = v2 }
    } else if (type === 'top' || type === 'bottom') {
      const pct = x.percent === true
      if (typeof x.n !== 'number' || !Number.isInteger(x.n) || x.n < 1 || x.n > (pct ? 100 : COND_N_MAX)) continue
      rule.n = x.n
      if (pct) rule.percent = true
    } else if (type === 'above_average' || type === 'below_average') {
      if (x.equal === true) rule.equal = true
    } else if (type === 'text_contains') {
      if (typeof x.text !== 'string' || !x.text || x.text.length > COND_TEXT_MAX) continue
      rule.text = x.text
    } else if (type === 'color_scale' || type === 'data_bar') {
      // 没给 colors ⇒ 预设色（同 parseRuleInput）；给了但坏 ⇒ 整条丢
      const raw = x.colors === undefined ? (type === 'color_scale' ? COLOR_SCALE_DEFAULT : [DATA_BAR_DEFAULT]) : x.colors
      const cs = Array.isArray(raw) ? raw.map(normColor) : []
      if (cs.some(c => !c)) continue
      if (type === 'color_scale' ? !(cs.length === 2 || cs.length === 3) : cs.length !== 1) continue
      rule.colors = cs as string[]
    }
    if (isStyleType(type)) {
      const st = sanitizeCondStyle(x.style); if (st) rule.style = st
      if (x.stop === true) rule.stop = true
    }
    seen.add(rule.id); out.push(rule)
  }
  return out
}

// ── 插删行列：区间端点跟着走（同 agent-ops 合并区那套：插入点之后的往后推·整段被删 ⇒ 那段拿掉·部分被删 ⇒ 收缩） ──
export function shiftCondFormats(rules: CondRule[] | undefined, axis: 'row' | 'col', mode: 'insert' | 'delete', at: number, count: number): { rules: CondRule[]; removed: number } {
  const end = at + count - 1
  const max = axis === 'row' ? MAX_ROW : MAX_COL
  const out: CondRule[] = []
  let removed = 0
  for (const rule of rules ?? []) {
    const segs: string[] = []
    for (const r of rectsOf(rule)) {
      const whole = axis === 'row' ? (r.r0 === 0 && r.r1 === MAX_ROW) : (r.c0 === 0 && r.c1 === MAX_COL)   // 整列规则插删行时照旧是整列
      let s = axis === 'row' ? r.r0 : r.c0, e = axis === 'row' ? r.r1 : r.c1
      if (!whole) {
        if (mode === 'insert') { if (s >= at) s += count; if (e >= at) e += count }
        else {
          if (s >= at && e <= end) continue
          if (s > end) s -= count; else if (s >= at) s = at
          if (e > end) e -= count; else if (e >= at) e = at - 1
          if (e < s) e = s
        }
        if (s > max) continue
        e = Math.min(e, max)
      }
      segs.push(segText(axis === 'row' ? { ...r, r0: s, r1: e } : { ...r, c0: s, c1: e }))
    }
    if (segs.length) out.push({ ...rule, ranges: segs }); else removed++
  }
  return { rules: out, removed }
}

// ── 判定 ──────────────────────────────────────────────────────────────────

export type CondBar = { color: string; pct: number }
export type CondHit = { style?: CondStyle; bar?: CondBar }

type Stats = { nums: number[]; min: number; max: number; mid: number; avg: number; cut: number | null; counts: Map<string, number> }
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const hex = (c: number[]) => '#' + c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
/** 两色之间插色（sRGB 线性·Excel 同） */
export function mixColor(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b), k = Math.max(0, Math.min(1, t))
  return hex(x.map((v, i) => v + (y[i] - v) * k))
}
/** PERCENTILE.INC（色阶中间点＝第 50 百分位） */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
/** 重复值的比对键：数字按 15 位·文字不分大小写·逻辑值另一类 */
function dupKey(v: Scalar): string | null {
  if (v === null || v === '' || isFormulaError(v)) return null
  if (typeof v === 'number') return 'n' + to15(v)
  if (typeof v === 'boolean') return 'b' + v
  return 's' + v.toUpperCase()
}
function textOf(v: Scalar): string | null {
  if (v === null || isFormulaError(v)) return null
  if (typeof v === 'number') return numToText(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return v
}
/** text_contains 的比对器（SEARCH 口径：不分大小写·* ? ~ 通配·找得到就算） */
function containsMatcher(text: string): (s: string) => boolean {
  if (!hasWildcard(text)) { const u = text.toUpperCase(); return s => s.toUpperCase().includes(u) }
  const src = wildcardRegex(text).source.replace(/^\^/, '').replace(/\$$/, '')
  const re = new RegExp(src, 'i')
  return s => re.test(s)
}

/** 单格对一条「有格式」的规则（cellIs／top／平均／重复／含文字）：命中 ⇒ true */
function matchStyleRule(rule: CondRule, v: Scalar, stats: () => Stats): boolean {
  if (isFormulaError(v)) return false
  const t = rule.type
  if ((CELLIS_TYPES as readonly string[]).includes(t)) {
    const a = rule.value as Scalar
    const cmp = (x: Scalar) => compareScalars(v, x)
    switch (t as CellIsType) {
      case 'greater': return cmp(a) > 0
      case 'greater_equal': return cmp(a) >= 0
      case 'less': return cmp(a) < 0
      case 'less_equal': return cmp(a) <= 0
      case 'equal': return cmp(a) === 0
      case 'not_equal': return cmp(a) !== 0
      case 'between': case 'not_between': {
        const b = rule.value2 as Scalar
        const lo = compareScalars(a, b) <= 0 ? a : b, hi = lo === a ? b : a
        const inside = cmp(lo) >= 0 && cmp(hi) <= 0
        return t === 'between' ? inside : !inside
      }
    }
  }
  if (t === 'text_contains') { const s = textOf(v); return s !== null && containsMatcher(rule.text ?? '')(s) }
  if (t === 'duplicate' || t === 'unique') { const k = dupKey(v); if (k === null) return false; const n = stats().counts.get(k) ?? 0; return t === 'duplicate' ? n > 1 : n === 1 }
  if (typeof v !== 'number') return false
  const st = stats()
  if (t === 'top' || t === 'bottom') return st.cut !== null && (t === 'top' ? to15(v) >= to15(st.cut) : to15(v) <= to15(st.cut))
  if (t === 'above_average' || t === 'below_average') {
    if (!st.nums.length) return false
    if (eq15(v, st.avg)) return !!rule.equal
    return t === 'above_average' ? v > st.avg : v < st.avg
  }
  return false
}

export type CondFormatter = {
  /** 第 r 行第 c 列（0 起）的叠加结果；没命中 ⇒ null */
  at(r: number, c: number): CondHit | null
  rules: CondRule[]
}

/**
 * 一张 sheet 的条件格式判定器：值一改（content 换了）重建一个即可（网页 useMemo 跟着 content）。
 *   value 省 ⇒ 用本表求值器（公式按算出来的值判）；合并区里被盖住的格一律当空格。统计（名次／平均／重复／色阶范围）按规则懒算一次。
 */
export function buildCondFormatter(content: SheetContent | null | undefined, opts: { value?: (key: string) => Scalar; eval?: EvaluatorOptions } = {}): CondFormatter {
  const rules = Array.isArray(content?.condFormats) ? content!.condFormats! : []
  const cells = content?.cells ?? {}
  const covered = coveredMap(content?.merges)
  let ev: SheetEvaluator | null = null
  const raw = opts.value ?? ((k: string) => { ev = ev ?? new SheetEvaluator(cells, content?.merges, opts.eval); return ev.typedValue(k) })
  const value = (k: string): Scalar => (covered.has(k) ? null : raw(k))
  const prepared = rules.map(rule => {
    const rects = rectsOf(rule)
    let st: Stats | null = null
    const stats = (): Stats => {
      if (st) return st
      const nums: number[] = []
      const counts = new Map<string, number>()
      const seen = new Set<string>()
      for (const k of Object.keys(cells)) {
        const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(k); if (!m) continue
        const r = Number(m[2]) - 1, c = colToIndex(m[1])
        if (!rects.some(x => rectContains(x, r, c)) || seen.has(k)) continue
        seen.add(k)
        const v = value(k)
        if (typeof v === 'number') nums.push(v)
        const dk = dupKey(v); if (dk) counts.set(dk, (counts.get(dk) ?? 0) + 1)
      }
      const sorted = [...nums].sort((a, b) => a - b)
      let cut: number | null = null
      if ((rule.type === 'top' || rule.type === 'bottom') && sorted.length) {
        const n = rule.percent ? Math.max(1, Math.floor(sorted.length * (rule.n ?? 10) / 100)) : (rule.n ?? 10)
        const k = Math.min(n, sorted.length)
        cut = rule.type === 'top' ? sorted[sorted.length - k] : sorted[k - 1]
      }
      st = { nums, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, mid: percentile(sorted, 0.5), avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0, cut, counts }
      return st
    }
    return { rule, rects, stats }
  })
  return {
    rules,
    at(r: number, c: number): CondHit | null {
      if (!prepared.length) return null
      const key = cellKey(r, c)
      let v: Scalar | undefined
      const val = () => (v === undefined ? (v = value(key)) : v)
      const style: CondStyle = {}
      let bar: CondBar | undefined
      let any = false
      for (const p of prepared) {
        if (!p.rects.some(x => rectContains(x, r, c))) continue
        const rule = p.rule
        if (rule.type === 'color_scale' || rule.type === 'data_bar') {
          const x = val()
          if (typeof x !== 'number') continue
          const st = p.stats()
          const cs = rule.colors ?? []
          if (rule.type === 'data_bar') {
            if (bar) continue
            const span = st.max - st.min
            bar = { color: cs[0] ?? DATA_BAR_DEFAULT, pct: span > 0 ? 10 + 80 * (x - st.min) / span : 90 }
            any = true
          } else if (!style.bg && cs.length >= 2) {
            let bg: string
            if (cs.length === 2) bg = st.max > st.min ? mixColor(cs[0], cs[1], (x - st.min) / (st.max - st.min)) : cs[0]
            else if (x <= st.mid) bg = st.mid > st.min ? mixColor(cs[0], cs[1], (x - st.min) / (st.mid - st.min)) : cs[1]
            else bg = st.max > st.mid ? mixColor(cs[1], cs[2], (x - st.mid) / (st.max - st.mid)) : cs[2]
            style.bg = bg; any = true
          }
          continue
        }
        if (!matchStyleRule(rule, val(), p.stats)) continue
        any = true
        const s = rule.style ?? {}
        for (const k of ['fg', 'bg', 'b', 'i', 'u', 's'] as const) if (s[k] !== undefined && style[k] === undefined) (style as Record<string, unknown>)[k] = s[k]
        if (rule.stop) break
      }
      if (!any) return null
      return { ...(Object.keys(style).length ? { style } : {}), ...(bar ? { bar } : {}) }
    },
  }
}

/** 网格一格的 inline 样式补丁（叠在格样式之上·⛔ 改存的样式）：字色／底色／粗斜底线删除线；数据条＝背景渐层（不加 DOM·字照样在上面） */
export function condCellCss(hit: CondHit | null, cell: CellStyle | undefined): Record<string, string | number> {
  const css: Record<string, string | number> = {}
  if (!hit) return css
  const s = hit.style
  if (s?.fg) css.color = s.fg
  if (s?.bg) css.backgroundColor = s.bg
  if (s?.b) css.fontWeight = 700
  if (s?.i) css.fontStyle = 'italic'
  if (s?.u || s?.s) css.textDecoration = [(s.u || cell?.u) ? 'underline' : '', (s.s || cell?.s) ? 'line-through' : ''].filter(Boolean).join(' ')
  if (hit.bar) {
    const pct = Math.max(0, Math.min(100, hit.bar.pct))
    css.backgroundImage = `linear-gradient(90deg, ${hit.bar.color}, ${mixColor(hit.bar.color, '#ffffff', 0.85)})`
    css.backgroundSize = `${pct.toFixed(1)}% calc(100% - 6px)`
    css.backgroundPosition = 'left center'
    css.backgroundRepeat = 'no-repeat'
  }
  return css
}

// ── 改规则（AI 工具 set_conditional_format 与网页小面板同一套入参）──────────────

export class CondInputError extends Error {}

/** 入参的规则（工具／小面板）：{ type, value?, value2?, n?, percent?, below?, unique?, or_equal?, text?, colors? } */
export type CondRuleInput = Record<string, unknown>
/** 入参的格式：预设名（light_red／yellow／green／light_red_fill／red_text）或 { color, bg, bold, italic, underline, strike } */
export type CondFormatInput = string | Record<string, unknown>

const TYPE_ALIAS: Record<string, CondType> = {
  gt: 'greater', greater_than: 'greater', '>': 'greater', ge: 'greater_equal', '>=': 'greater_equal',
  lt: 'less', less_than: 'less', '<': 'less', le: 'less_equal', '<=': 'less_equal',
  eq: 'equal', equals: 'equal', '=': 'equal', ne: 'not_equal', '<>': 'not_equal',
  top_n: 'top', bottom_n: 'bottom', duplicates: 'duplicate', duplicate_values: 'duplicate', unique_values: 'unique',
  contains: 'text_contains', text: 'text_contains', colorscale: 'color_scale', databar: 'data_bar',
}

/** 入参 ⇒ 规则本体（不含 id／ranges）；坏 ⇒ 抛 CondInputError（话写给 AI 看·说清哪一项怎么改） */
export function parseRuleInput(input: unknown): Omit<CondRule, 'id' | 'ranges' | 'style' | 'stop'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CondInputError('rule must be an object like {"type":"greater","value":500}')
  const x = input as Record<string, unknown>
  const allowed = ['type', 'value', 'value2', 'n', 'percent', 'below', 'unique', 'or_equal', 'text', 'colors']
  for (const k of Object.keys(x)) if (!allowed.includes(k)) throw new CondInputError(`unknown rule key "${k}" (allowed: ${allowed.join(', ')})`)
  let t = typeof x.type === 'string' ? x.type.trim().toLowerCase() : ''
  t = TYPE_ALIAS[t] ?? t
  if (t === 'above_average' && x.below === true) t = 'below_average'
  if (t === 'duplicate' && x.unique === true) t = 'unique'
  if (!(COND_TYPES as readonly string[]).includes(t)) throw new CondInputError(`rule.type must be one of ${COND_TYPES.join(', ')}`)
  const type = t as CondType
  const num = (v: unknown, name: string): number | string => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new CondInputError(`rule.${name} must be a finite number`); return v }
    if (typeof v === 'string' && v.trim() !== '') {
      if (v.trim().startsWith('=')) throw new CondInputError(`rule.${name}: formulas are not supported here — give a number or a piece of text`)
      if (v.length > COND_TEXT_MAX) throw new CondInputError(`rule.${name} is longer than ${COND_TEXT_MAX} characters`)
      const n = Number(v.trim().replace(/,/g, ''))
      return /^[-+]?(\d[\d,]*\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v.trim()) && Number.isFinite(n) ? n : v   // 「500」「1,200」当数字（Excel 对话框同）
    }
    throw new CondInputError(`rule.${name} is required for type ${type} (a number, or text to compare with)`)
  }
  const out: Omit<CondRule, 'id' | 'ranges' | 'style' | 'stop'> = { type }
  if ((CELLIS_TYPES as readonly string[]).includes(type)) {
    out.value = num(x.value, 'value')
    if (type === 'between' || type === 'not_between') out.value2 = num(x.value2, 'value2')
  } else if (type === 'top' || type === 'bottom') {
    const pct = x.percent === true
    if (x.percent !== undefined && typeof x.percent !== 'boolean') throw new CondInputError('rule.percent must be true or false')
    const n = x.n === undefined ? 10 : x.n
    const hi = pct ? 100 : COND_N_MAX
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > hi) throw new CondInputError(`rule.n must be an integer 1–${hi}${pct ? ' (percent)' : ''}`)
    out.n = n
    if (pct) out.percent = true
  } else if (type === 'above_average' || type === 'below_average') {
    if (x.or_equal === true) out.equal = true
  } else if (type === 'text_contains') {
    const s = typeof x.text === 'string' ? x.text : typeof x.value === 'string' || typeof x.value === 'number' ? String(x.value) : ''
    if (!s) throw new CondInputError('rule.text is required for text_contains (the text to look for)')
    if (s.length > COND_TEXT_MAX) throw new CondInputError(`rule.text is longer than ${COND_TEXT_MAX} characters`)
    out.text = s
  } else if (type === 'color_scale' || type === 'data_bar') {
    const raw = x.colors === undefined ? (type === 'color_scale' ? COLOR_SCALE_DEFAULT : [DATA_BAR_DEFAULT]) : typeof x.colors === 'string' ? [x.colors] : x.colors
    if (!Array.isArray(raw)) throw new CondInputError('rule.colors must be a list of hex colors')
    const cs = raw.map(normColor)
    if (cs.some(c => !c)) throw new CondInputError('rule.colors must be hex colors like #63be7b')
    if (type === 'color_scale' && !(cs.length === 2 || cs.length === 3)) throw new CondInputError('color_scale needs 2 colors [lowest, highest] or 3 [lowest, middle, highest]')
    if (type === 'data_bar' && cs.length !== 1) throw new CondInputError('data_bar takes one color, e.g. ["#638ec6"]')
    out.colors = cs as string[]
  }
  return out
}

/** 格式入参 ⇒ CondStyle（预设名或物件）；坏 ⇒ 抛 */
export function parseFormatInput(input: unknown): CondStyle {
  if (typeof input === 'string') {
    const p = COND_PRESETS[input.trim().toLowerCase() as CondPreset]
    if (!p) throw new CondInputError(`format preset must be one of ${COND_PRESET_NAMES.join(', ')} (or an object {color, bg, bold, italic, underline, strike})`)
    return { ...p }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CondInputError('format must be a preset name or an object {color, bg, bold, italic, underline, strike}')
  const x = input as Record<string, unknown>
  const keys = ['color', 'bg', 'bold', 'italic', 'underline', 'strike']
  for (const k of Object.keys(x)) if (!keys.includes(k)) throw new CondInputError(`unknown format key "${k}" (allowed: ${keys.join(', ')})`)
  const s: CondStyle = {}
  for (const [k, sk] of [['color', 'fg'], ['bg', 'bg']] as const) {
    if (x[k] === undefined || x[k] === null) continue
    const c = normColor(x[k]); if (!c) throw new CondInputError(`format.${k} must be a hex color like #9c0006`)
    s[sk] = c
  }
  for (const [k, sk] of [['bold', 'b'], ['italic', 'i'], ['underline', 'u'], ['strike', 's']] as const) {
    if (x[k] === undefined) continue
    if (typeof x[k] !== 'boolean') throw new CondInputError(`format.${k} must be true or false`)
    if (x[k]) s[sk] = true
  }
  if (!Object.keys(s).length) throw new CondInputError('format is empty — give at least one of color, bg, bold, italic, underline, strike (or a preset like "light_red")')
  return s
}

export function newCondId(rules: CondRule[]): string {
  for (;;) { const id = `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; if (!rules.some(r => r.id === id)) return id }
}

/** 改规则的一次请求（AI op 与网页小面板共用） */
export type CondChange = {
  /** 套用范围（新规则必给·改某条时给 ⇒ 换范围·clear 时给 ⇒ 只从这块拿掉） */
  ranges?: Rect[]
  rule?: unknown
  format?: unknown
  clear?: boolean
  ruleId?: string
  /** 1 起·1＝最先判（Excel 规则管理员最上面）；新规则缺省 1 */
  priority?: number
  stopIfTrue?: boolean
}
export type CondChangeResult = { rules: CondRule[]; result: Record<string, unknown>; warnings: string[] }

/**
 * 依请求改一份规则清单（不改原清单）：
 *   clear＋ranges ⇒ 把这块从（所有／rule_id 那条）规则的范围里扣掉（Excel「清除選取儲存格的規則」·扣空的规则整条拿掉）；
 *   clear＋rule_id（不给 ranges）⇒ 删那条；rule_id ⇒ 改那条（给了什么换什么）；其余 ⇒ 新增一条（缺省排第一＝最先判·Excel 同）。
 */
export function applyCondChange(cur: CondRule[] | undefined, ch: CondChange): CondChangeResult {
  const rules = (cur ?? []).map(r => ({ ...r, ranges: [...r.ranges] }))
  const warnings: string[] = []
  const pick = (id: string) => { const i = rules.findIndex(r => r.id === id); if (i < 0) throw new CondInputError(`no conditional format rule "${id}" on this tab (get_sheet lists cond_formats with their rule_id)`); return i }
  const capRanges = (rects: Rect[]) => { if (rects.length > COND_RANGES_MAX) throw new CondInputError(`a rule can cover at most ${COND_RANGES_MAX} separate ranges`); return rects.map(segText) }
  if (ch.priority !== undefined && (typeof ch.priority !== 'number' || !Number.isInteger(ch.priority) || ch.priority < 1)) throw new CondInputError('priority must be an integer ≥ 1 (1 = checked first)')
  const place = (i: number, pr: number | undefined) => { if (pr === undefined) return; const [r] = rules.splice(i, 1); rules.splice(Math.min(pr - 1, rules.length), 0, r) }

  if (ch.clear) {
    if (ch.ruleId && !ch.ranges) { const i = pick(ch.ruleId); rules.splice(i, 1); return { rules, result: { cleared: 1, rule_id: ch.ruleId }, warnings } }
    if (!ch.ranges) throw new CondInputError('clear needs range (which cells to clear) or rule_id (which rule to delete)')
    let changed = 0, deleted = 0
    const targets = ch.ruleId ? [pick(ch.ruleId)] : rules.map((_, i) => i)
    for (const i of targets) {
      const before = rectsOf(rules[i])
      let rest = before
      for (const cut of ch.ranges) rest = rest.flatMap(r => subtractRect(r, cut))
      if (rest.length === before.length && rest.every((r, j) => segText(r) === segText(before[j]))) continue
      changed++
      if (!rest.length) { rules[i] = null as unknown as CondRule; deleted++; continue }
      rules[i] = { ...rules[i], ranges: capRanges(rest) }
    }
    const kept = rules.filter(Boolean)
    if (!changed) warnings.push('no conditional format rule touches that range, so nothing was cleared.')
    return { rules: kept, result: { cleared: changed, rules_deleted: deleted, rules_trimmed: changed - deleted }, warnings }
  }

  if (ch.ruleId) {
    const i = pick(ch.ruleId)
    let r = { ...rules[i] }
    if (ch.rule !== undefined) {
      const body = parseRuleInput(ch.rule)
      const keep = { id: r.id, ranges: r.ranges, ...(r.style ? { style: r.style } : {}), ...(r.stop ? { stop: true as const } : {}) }
      r = { ...keep, ...body }
    }
    if (ch.format !== undefined) r.style = parseFormatInput(ch.format)
    if (ch.ranges) r.ranges = capRanges(ch.ranges)
    if (ch.stopIfTrue !== undefined) { if (ch.stopIfTrue) r.stop = true; else delete r.stop }
    if (!isStyleType(r.type)) { delete r.style; delete r.stop }
    else if (!r.style) r.style = { ...COND_PRESETS.light_red }
    if (ch.rule === undefined && ch.format === undefined && !ch.ranges && ch.stopIfTrue === undefined && ch.priority === undefined) throw new CondInputError('give at least one of rule, format, range, priority, stop_if_true to change (or clear:true to delete)')
    rules[i] = r
    place(i, ch.priority)
    return { rules, result: { rule_id: r.id, range: rangesLabel(r.ranges), type: r.type, priority: rules.findIndex(x => x.id === r.id) + 1 }, warnings }
  }

  if (!ch.ranges) throw new CondInputError('range is required for a new rule (e.g. "D2:D30")')
  if (ch.rule === undefined) throw new CondInputError('rule is required for a new rule, e.g. {"type":"greater","value":500}')
  if (rules.length >= COND_RULES_MAX) throw new CondInputError(`a tab holds at most ${COND_RULES_MAX} conditional format rules — clear some first`)
  const body = parseRuleInput(ch.rule)
  const r: CondRule = { id: newCondId(rules), ranges: capRanges(ch.ranges), ...body }
  if (isStyleType(r.type)) {
    r.style = ch.format === undefined ? { ...COND_PRESETS.light_red } : parseFormatInput(ch.format)
    if (ch.stopIfTrue) r.stop = true
  } else if (ch.format !== undefined) warnings.push(`${r.type} paints its own colors (rule.colors); format was ignored.`)
  rules.unshift(r)
  place(0, ch.priority)
  return { rules, result: { rule_id: r.id, range: rangesLabel(r.ranges), type: r.type, priority: rules.findIndex(x => x.id === r.id) + 1 }, warnings }
}

/** agent op 'cond_format' 的入参（route 收的 ops 清单那一条）⇒ CondChange；ranges 用 'ranges' 栏（⛔ 'range'：route 会把 range 里的页签名整段剥掉·多段会剥坏） */
export function condChangeFromOp(o: Record<string, unknown>): CondChange {
  const allowed = ['op', 'ranges', 'rule', 'format', 'clear', 'rule_id', 'priority', 'stop_if_true']
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new CondInputError(`unknown key "${k}" (allowed: ${allowed.slice(1).join(', ')})`)
  let ranges: Rect[] | undefined
  if (o.ranges !== undefined && o.ranges !== null && o.ranges !== '') {
    if (typeof o.ranges === 'string' && o.ranges.includes('!')) throw new CondInputError('range must not carry a tab name here — pass the tab as `sheet` instead')
    const r = parseRanges(o.ranges)
    if (!r) throw new CondInputError(`bad range "${String(o.ranges)}" (use A1 notation like D2:D30, several separated by commas like "D2:D30,F2:F30", or whole columns like E:E)`)
    ranges = r
  }
  if (o.clear !== undefined && typeof o.clear !== 'boolean') throw new CondInputError('clear must be true or false')
  if (o.stop_if_true !== undefined && typeof o.stop_if_true !== 'boolean') throw new CondInputError('stop_if_true must be true or false')
  if (o.rule_id !== undefined && (typeof o.rule_id !== 'string' || !o.rule_id.trim())) throw new CondInputError('rule_id must be the id string from get_sheet cond_formats')
  return {
    ...(ranges ? { ranges } : {}),
    ...(o.rule !== undefined ? { rule: o.rule } : {}),
    ...(o.format !== undefined && o.format !== null ? { format: o.format } : {}),
    ...(o.clear === true ? { clear: true } : {}),
    ...(typeof o.rule_id === 'string' ? { ruleId: o.rule_id.trim() } : {}),
    ...(o.priority !== undefined ? { priority: o.priority as number } : {}),
    ...(typeof o.stop_if_true === 'boolean' ? { stopIfTrue: o.stop_if_true } : {}),
  }
}

// ── 读回（get_sheet 回包 cond_formats·键名＝工具入参同一套·读回来可以原样再套）──
export type CondOut = {
  rule_id: string; range: string; priority: number
  rule: Record<string, unknown>
  format?: Record<string, unknown>
  stop_if_true?: true
}
export function condFormatsOut(rules: CondRule[] | undefined, within?: Rect | null): CondOut[] {
  const out: CondOut[] = []
  ;(rules ?? []).forEach((r, i) => {
    if (within && !rectsOf(r).some(x => rectsOverlap(x, within))) return
    const rule: Record<string, unknown> = { type: r.type }
    if (r.value !== undefined) rule.value = r.value
    if (r.value2 !== undefined) rule.value2 = r.value2
    if (r.n !== undefined) rule.n = r.n
    if (r.percent) rule.percent = true
    if (r.equal) rule.or_equal = true
    if (r.text !== undefined) rule.text = r.text
    if (r.colors) rule.colors = [...r.colors]
    const f: Record<string, unknown> = {}
    if (r.style?.fg) f.color = r.style.fg
    if (r.style?.bg) f.bg = r.style.bg
    if (r.style?.b) f.bold = true
    if (r.style?.i) f.italic = true
    if (r.style?.u) f.underline = true
    if (r.style?.s) f.strike = true
    out.push({ rule_id: r.id, range: rangesLabel(r.ranges), priority: i + 1, rule, ...(Object.keys(f).length ? { format: f } : {}), ...(r.stop ? { stop_if_true: true as const } : {}) })
  })
  return out
}
/** 跟某块有交集的规则（网页小面板列「这块套了哪些」用） */
export function rulesTouching(rules: CondRule[] | undefined, rect: Rect): CondRule[] {
  return (rules ?? []).filter(r => rectsOf(r).some(x => rectsOverlap(x, rect)))
}
