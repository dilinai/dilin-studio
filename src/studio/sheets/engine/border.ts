// 表格框线模型与套用
//
// ── 出处与授权 ──
// 套框线的「按类型算每格哪几边、外框清邻格对边、内线两侧都写、无框线连外圈邻格对边一起清」抄自
//   univer（https://github.com/dream-num/univer ·commit 511bfd2）·Apache License 2.0·Copyright 2023-present DreamNum Co., Ltd.
//   · packages/sheets/src/commands/commands/set-border.command.ts —— getBorderContext（top/left/bottom/right＝该类型或 ALL 或 OUTSIDE；
//       horizontal/vertical＝该类型或 ALL 或 INSIDE）、innerBorder（内线：左格写 r·右格写 l·上格写 b·下格写 t）、
//       outlineBorder（外框：区内一侧写·区外邻格对边写 null）、clearBorder（NONE：区内全清＋外圈 8 条带的对边清）、
//       执行顺序 inner → outline → clear；合并区写到左上格
//   · packages/core/src/types/enum/border-style-types.ts —— 线型编号（THIN=1 DOTTED=3 DASHED=4 DOUBLE=7 MEDIUM=8 THICK=13）
//   · packages/engine-render/src/basics/draw.ts getLineWidth —— 线宽（MEDIUM 2·THICK 3·其余 1）
//   · packages/engine-render/src/components/sheets/sheet.render-skeleton.ts _setBorderProps —— 渲染时相邻两格同一条边只画一次
// 已修改（Apache-2.0 §4(b) 修改声明）：
//   1. 资料形改成本仓 s.border＝{ t,r,b,l: { style, color } }（style 用名字 thin/medium/thick/dashed/dotted/double 不用数字）；
//      旧格式（'tblr' 子集字串）读入时迁成细实线（sanitizeBorder）；
//   2. 不做 univer 的斜线与 mutation／undo 物件（撤销由页面整份快照栈管）；
//   3. 相邻格共边「以后写者为准」：每次写一条边都同时把邻格对边改成同值（内线）或清掉（外框）⇒ 两格永不矛盾；
//   4. 类型补 WPS 的「粗匣框线」（外框＋粗实线）与「全表框线」（当前连续资料区全部框线）；
//   5. 绘图边框（拖画外框）／绘图边框网格（拖画全框）／擦除边框（拖擦）＝对拖出的矩形分别套 outside／all／none——两参考仓都没有这项（只有面板）⇒ 这层是自写。

import { cellKey } from './formula'
import type { Rect } from './style'

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'
export const BORDER_STYLES: readonly BorderStyle[] = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double']
export type BorderLine = { style: BorderStyle; color?: string }
export type CellBorder = { t?: BorderLine; r?: BorderLine; b?: BorderLine; l?: BorderLine }
export type BorderSide = 't' | 'r' | 'b' | 'l'
export type BorderPen = { style: BorderStyle; color?: string }
/** 预设线色（边框未指定颜色时画这个） */
export const BORDER_DEFAULT_COLOR = '#1f2937'
/** 工具栏边框下拉的套法（WPS 顺序） */
export type BorderKind = 'none' | 'all' | 'outside' | 'thickBox' | 'wholeTable' | 'bottom' | 'top' | 'left' | 'right' | 'inside' | 'horizontal' | 'vertical'
/** 一次套用：六组边（上／下／左／右外缘＋内部横／竖）·undefined＝不动·null＝清·线＝设 */
export type BorderEdges = { top?: BorderLine | null; bottom?: BorderLine | null; left?: BorderLine | null; right?: BorderLine | null; insideH?: BorderLine | null; insideV?: BorderLine | null }

/** univer getLineWidth：medium 2·thick 3·double 3（画双线占 3px）·其余 1 */
export function lineWidth(style: BorderStyle): number {
  return style === 'medium' ? 2 : style === 'thick' || style === 'double' ? 3 : 1
}
/** CSS border-style */
export function cssLineStyle(style: BorderStyle): 'solid' | 'dashed' | 'dotted' | 'double' {
  return style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : style === 'double' ? 'double' : 'solid'
}

const SAFE_COLOR_RE = /^([a-z][a-z0-9]{1,32}|#[0-9a-f]{3,8})$/i   // 同 style.ts isSafeColor
const safeColor = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && SAFE_COLOR_RE.test(v)
function sanitizeLine(x: unknown): BorderLine | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined
  const o = x as Record<string, unknown>
  if (typeof o.style !== 'string' || !(BORDER_STYLES as readonly string[]).includes(o.style)) return undefined
  const line: BorderLine = { style: o.style as BorderStyle }
  if (safeColor(o.color)) line.color = o.color
  return line
}
/**
 * 净化／迁移（服务端与页面同一份）：旧格式字串 'tblr' 子集 ⇒ 各边细实线；新格式 { t,r,b,l:{style,color} } ⇒ 白名单；空 ⇒ undefined
 */
export function sanitizeBorder(input: unknown): CellBorder | undefined {
  if (typeof input === 'string') {
    if (!/^[tblr]{1,4}$/.test(input)) return undefined
    const out: CellBorder = {}
    for (const ch of ['t', 'r', 'b', 'l'] as const) if (input.includes(ch)) out[ch] = { style: 'thin' }
    return out
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const x = input as Record<string, unknown>
  const out: CellBorder = {}
  for (const k of ['t', 'r', 'b', 'l'] as const) { const l = sanitizeLine(x[k]); if (l) out[k] = l }
  return Object.keys(out).length ? out : undefined
}
export const sameLine = (a: BorderLine | undefined, b: BorderLine | undefined) => (!a && !b) || (!!a && !!b && a.style === b.style && (a.color ?? '') === (b.color ?? ''))

/** 工具栏套法 ⇒ 六组边（univer getBorderContext 口径＋WPS 粗匣） */
export function edgesForKind(kind: BorderKind, pen: BorderPen): BorderEdges {
  const line: BorderLine = { style: pen.style, ...(pen.color ? { color: pen.color } : {}) }
  switch (kind) {
    case 'none': return { top: null, bottom: null, left: null, right: null, insideH: null, insideV: null }
    case 'all': case 'wholeTable': return { top: line, bottom: line, left: line, right: line, insideH: line, insideV: line }
    case 'outside': return { top: line, bottom: line, left: line, right: line }
    case 'thickBox': { const thick: BorderLine = { style: 'thick', ...(pen.color ? { color: pen.color } : {}) }; return { top: thick, bottom: thick, left: thick, right: thick } }
    case 'inside': return { insideH: line, insideV: line }
    case 'horizontal': return { insideH: line }
    case 'vertical': return { insideV: line }
    case 'top': return { top: line }
    case 'bottom': return { bottom: line }
    case 'left': return { left: line }
    case 'right': return { right: line }
  }
}

type BorderCells = Record<string, { v?: string; f?: string; s?: { border?: CellBorder } & Record<string, unknown> }>
type Unit = { r0: number; c0: number; r1: number; c1: number }   // 一格或一整块合并区

/** 套边（univer inner → outline → clear 的合一版）；merges＝已解析的合并区矩形；bounds＝表的行列数 */
export function applyBorderEdges<T extends BorderCells>(cells: T, sel: Rect, edges: BorderEdges, merges: Rect[], bounds: { rows: number; cols: number }): T {
  const next = { ...cells } as T
  const mergeAt = (r: number, c: number): Unit => merges.find(m => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) ?? { r0: r, r1: r, c0: c, c1: c }
  const setSide = (u: Unit, side: BorderSide, line: BorderLine | null) => {
    const key = cellKey(u.r0, u.c0)
    const cur = next[key]
    const border: CellBorder = { ...(cur?.s?.border ?? {}) }
    if (line) border[side] = { ...line }; else delete border[side]
    const s = { ...(cur?.s ?? {}) } as Record<string, unknown>
    if (Object.keys(border).length) s.border = border; else delete s.border
    const rest = { ...(cur ?? {}) } as Record<string, unknown>
    if (Object.keys(s).length) rest.s = s; else delete rest.s
    if (Object.keys(rest).length) (next as Record<string, unknown>)[key] = rest
    else delete (next as Record<string, unknown>)[key]
  }
  // 选区里的每个单位（合并区只算左上一次）
  const units: Unit[] = []
  const seen = new Set<string>()
  for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) {
    const u = mergeAt(r, c); const k = `${u.r0},${u.c0}`
    if (seen.has(k)) continue
    seen.add(k); units.push(u)
  }
  const inBounds = (r: number, c: number) => r >= 0 && c >= 0 && r < bounds.rows && c < bounds.cols
  /** 写 u 的一边＋邻格对边：inner＝同值·outline＝清（univer outlineBorder 的 RangeOut null） */
  const write = (u: Unit, side: BorderSide, line: BorderLine | null, neighbor: 'same' | 'clear') => {
    setSide(u, side, line)
    const opp: BorderSide = side === 't' ? 'b' : side === 'b' ? 't' : side === 'l' ? 'r' : 'l'
    const cells: [number, number][] = []
    if (side === 't') for (let c = u.c0; c <= u.c1; c++) cells.push([u.r0 - 1, c])
    if (side === 'b') for (let c = u.c0; c <= u.c1; c++) cells.push([u.r1 + 1, c])
    if (side === 'l') for (let r = u.r0; r <= u.r1; r++) cells.push([r, u.c0 - 1])
    if (side === 'r') for (let r = u.r0; r <= u.r1; r++) cells.push([r, u.c1 + 1])
    const done = new Set<string>()
    for (const [r, c] of cells) {
      if (!inBounds(r, c)) continue
      const n = mergeAt(r, c); const k = `${n.r0},${n.c0}`
      if (done.has(k)) continue
      done.add(k)
      setSide(n, opp, neighbor === 'same' ? line : null)
    }
  }
  for (const u of units) {
    // 上缘／内部横
    if (u.r0 === sel.r0) { if (edges.top !== undefined) write(u, 't', edges.top, 'clear') }
    else if (edges.insideH !== undefined) write(u, 't', edges.insideH, 'same')
    if (u.r1 === sel.r1) { if (edges.bottom !== undefined) write(u, 'b', edges.bottom, 'clear') }
    else if (edges.insideH !== undefined) write(u, 'b', edges.insideH, 'same')
    if (u.c0 === sel.c0) { if (edges.left !== undefined) write(u, 'l', edges.left, 'clear') }
    else if (edges.insideV !== undefined) write(u, 'l', edges.insideV, 'same')
    if (u.c1 === sel.c1) { if (edges.right !== undefined) write(u, 'r', edges.right, 'clear') }
    else if (edges.insideV !== undefined) write(u, 'r', edges.insideV, 'same')
  }
  return next
}

/** 选区现有的六组边（「其他边框」对话框的起始勾选）：该组每一段都同一条线 ⇒ 那条线；有缺／不齐 ⇒ null */
export function currentEdges(cells: BorderCells, sel: Rect, merges: Rect[]): Record<keyof BorderEdges, BorderLine | null> {
  const mergeAt = (r: number, c: number): Unit => merges.find(m => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) ?? { r0: r, r1: r, c0: c, c1: c }
  const sideOf = (r: number, c: number, side: BorderSide) => { const u = mergeAt(r, c); return cells[cellKey(u.r0, u.c0)]?.s?.border?.[side] }
  const uniform = (lines: (BorderLine | undefined)[]): BorderLine | null => {
    if (!lines.length || !lines[0]) return null
    return lines.every(l => sameLine(l, lines[0])) ? lines[0] : null
  }
  const top: (BorderLine | undefined)[] = [], bottom: (BorderLine | undefined)[] = [], left: (BorderLine | undefined)[] = [], right: (BorderLine | undefined)[] = []
  const insideH: (BorderLine | undefined)[] = [], insideV: (BorderLine | undefined)[] = []
  for (let c = sel.c0; c <= sel.c1; c++) { top.push(sideOf(sel.r0, c, 't')); bottom.push(sideOf(sel.r1, c, 'b')) }
  for (let r = sel.r0; r <= sel.r1; r++) { left.push(sideOf(r, sel.c0, 'l')); right.push(sideOf(r, sel.c1, 'r')) }
  for (let r = sel.r0; r < sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) if (mergeAt(r, c).r1 === r) insideH.push(sideOf(r, c, 'b'))
  for (let c = sel.c0; c < sel.c1; c++) for (let r = sel.r0; r <= sel.r1; r++) if (mergeAt(r, c).c1 === c) insideV.push(sideOf(r, c, 'r'))
  return { top: uniform(top), bottom: uniform(bottom), left: uniform(left), right: uniform(right), insideH: uniform(insideH), insideV: uniform(insideV) }
}

/** 渲染：每条单位边（同一条边两格都记着 ⇒ 只画一次） */
export type BorderSegment = { key: string; dir: 'h' | 'v'; r: number; c: number; line: BorderLine }
/**
 * 收集要画的边：h＝第 r 行上缘第 c 格那段·v＝第 c 列左缘第 r 格那段（r、c 可到 rows／cols 表示最下／最右外缘）。
 * 合并区左上格的边按整块摊到每一段；同一段被两格都记 ⇒ 取后处理者（逐格顺序·页面操作会让两边同值）。
 */
export function borderSegments(cells: BorderCells, merges: Rect[], covered: (key: string) => boolean): BorderSegment[] {
  const map = new Map<string, BorderSegment>()
  const put = (dir: 'h' | 'v', r: number, c: number, line: BorderLine) => { const key = `${dir}:${r}:${c}`; map.set(key, { key, dir, r, c, line }) }
  for (const [key, cd] of Object.entries(cells)) {
    const b = cd?.s?.border
    if (!b || covered(key)) continue
    const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(key)
    if (!m) continue
    let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); c -= 1
    const r = Number(m[2]) - 1
    const u = merges.find(x => x.r0 === r && x.c0 === c) ?? { r0: r, r1: r, c0: c, c1: c }
    if (b.t) for (let cc = u.c0; cc <= u.c1; cc++) put('h', u.r0, cc, b.t)
    if (b.b) for (let cc = u.c0; cc <= u.c1; cc++) put('h', u.r1 + 1, cc, b.b)
    if (b.l) for (let rr = u.r0; rr <= u.r1; rr++) put('v', rr, u.c0, b.l)
    if (b.r) for (let rr = u.r0; rr <= u.r1; rr++) put('v', rr, u.c1 + 1, b.r)
  }
  return [...map.values()]
}

/** 当前连续资料区（Excel CurrentRegion·「全表框线」用）：从活动格起·外圈一格（含对角）有值就往外扩·到稳定为止；全空 ⇒ 就是那一格 */
export function currentRegion(hasValue: (r: number, c: number) => boolean, at: { r: number; c: number }, bounds: { rows: number; cols: number }): Rect {
  let rect: Rect = { r0: at.r, r1: at.r, c0: at.c, c1: at.c }
  for (let guard = 0; guard < 400; guard++) {
    let grown = false
    const { r0, r1, c0, c1 } = rect
    const rowHas = (r: number) => r >= 0 && r < bounds.rows && (() => { for (let c = Math.max(0, c0 - 1); c <= Math.min(bounds.cols - 1, c1 + 1); c++) if (hasValue(r, c)) return true; return false })()
    const colHas = (c: number) => c >= 0 && c < bounds.cols && (() => { for (let r = Math.max(0, r0 - 1); r <= Math.min(bounds.rows - 1, r1 + 1); r++) if (hasValue(r, c)) return true; return false })()
    if (rowHas(r0 - 1)) { rect = { ...rect, r0: r0 - 1 }; grown = true }
    if (rowHas(r1 + 1)) { rect = { ...rect, r1: r1 + 1 }; grown = true }
    if (colHas(c0 - 1)) { rect = { ...rect, c0: c0 - 1 }; grown = true }
    if (colHas(c1 + 1)) { rect = { ...rect, c1: c1 + 1 }; grown = true }
    if (!grown) break
  }
  return rect
}
