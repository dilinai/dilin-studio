// 表格 agent 操作
//   纯函数：/api/ai-sheet/cells（网站 MCP 与本机桥 mcp-server 同调的那条 route）用它读区间、按操作清单改一张 sheet。
//   ⛔ 不碰库、不碰 React。改完存库前仍过 engine/content.ts 的 sanitizeSheetContent（净化闸同一份·格式白名单在 style.ts）。
//
//   借鉴（只借算法·本档代码现写·没有逐行抄）：
//     - 插删行列时公式引用怎么动（插入点之后的端点往后推·删掉的整段 ⇒ #REF!·区间部分被删 ⇒ 收缩）：
//       fortune-sheet（MIT·Copyright (c) 2022 Suzhou Ruilisi Technology Co., Ltd·9434660）packages/core/src/modules/formula.ts functionStrChange_range
//     - 排序比较（数字在文字前·空格不论升降都排最后·稳定排序）：fortune-sheet packages/core/src/modules/sort.ts orderbydata
//     - 区间读回「原始输入＋算出来的值」两份、批量改一次按区间交（接口形状自定）。
//   合并：照网页 SheetGrid doMerge 同口径（只留左上格内容·其余格内容清掉、格式保留·与之重叠的旧合并区撤掉＝style.ts addMerge）。
//   边框：⛔ 另写一份——套法与邻格共边规则全用网页工具栏那份 ./border.ts（edgesForKind＋applyBorderEdges·univer 口径· c5db9ce8）；
//         读回用 sanitizeBorder（旧 'tblr' 字串也迁成细实线）。
//   公式引用扫描：用 ./formula-refs.ts scanRefs（univer 口径）；排序搬行用它的 shiftFormula（复制口径·$ 不动·出界 #REF!）；
//         插删行列的端点规则（下）是本档加在同一个扫描器上的。

import { sanitizePrint, type SheetPrint } from './print'   // 列印设定（get_sheet 回包带出）
import { cellKey, colToIndex, indexToCol, formatValue, isFormulaError, sheetKey, SheetEvaluator, DEFAULT_COLS, DEFAULT_ROWS, type CellData, type SheetCells, type SheetContent, type EvalResult, type EvaluatorOptions } from './formula'
import { addMerge, removeMerges, parseRange, rangeKey, rectsOverlap, rectContains, coveredMap, formatWithNumFmt, valueForInput, numFmtForKind, isSafeColor, NUMFMT_KINDS, CURRENCY_SYMBOLS, CURRENCY_SYMBOL, isCurrencySymbol, type CurrencySymbol, SIZE_MIN, SIZE_MAX, INDENT_MAX, DECIMALS_MAX, type CellStyle, type NumFmt, type NumFmtKind, type Rect, type SheetImage, IMAGES_MAX, IMAGE_SIDE_MIN, IMAGE_SIDE_MAX } from './style'
import { moveImageZ, setImagePlane, putImageInCell, type ZMove } from './image-layers'
import { setColWidths, setRowHeights, SIZES_MAX_COLS, SIZES_MAX_ROWS, COL_W_MIN, COL_W_MAX, ROW_H_MIN, ROW_H_MAX, COL_W_DEFAULT, ROW_H_DEFAULT } from './layout'
import { isFontId, findFontByFamily } from '../../shared/fonts/catalog'
import { applyBorderEdges, edgesForKind, sanitizeBorder, BORDER_STYLES, type BorderKind, type BorderStyle, type CellBorder } from './border'
import { scanRefs, shiftFormula, shiftFormulaForStruct, shiftContentForStruct, type RefPart as ScanRefPart, type StructChange, type StructScope } from './formula-refs'
import { applyChartOp, chartsForRead, shiftChartsForStructural, ChartOpError } from './chart'   // 图表
import { applyCondChange, condChangeFromOp, condFormatsOut, shiftCondFormats, CondInputError, type CondOut } from './cond-format'   // 条件格式
import { applyViewOp, shiftViewForStruct, viewOut, SheetViewError, VIEW_OP_NAMES, type ViewOut } from './sheet-view' // 冻结筛选验证（＋hide 隐藏行列）
import { findCells, replaceCells, removeDuplicates, DataToolError, type FindLookIn } from './data-tools' // 寻找取代·移除重复

/** 0 起·第 999999 行（格键上限 6 位数字·同 sanitizeSheetContent 的键正则） */
export const MAX_ROW_INDEX = 999998
/** ZZZ（格键上限 3 个字母） */
export const MAX_COL_INDEX = 18277
/** 网页网格现在只画 A1:Z100（formula.ts DEFAULT_ROWS／DEFAULT_COLS）——写到外面资料照存、网页看不到 ⇒ 回给 agent 一句提醒 */
export const EDITOR_VISIBLE_ROWS = DEFAULT_ROWS
export const EDITOR_VISIBLE_COLS = DEFAULT_COLS

export const READ_DEFAULT_LIMIT = 500
export const READ_MAX_LIMIT = 2000
export const OPS_MAX = 100
/** 一次请求里 set 写入的格数上限 */
export const SET_CELLS_MAX = 100_000
/** 一次 format 真正逐格套的格数上限（整列／整行先裁到有东西的范围） */
export const FORMAT_CELLS_MAX = 200_000
export const STRUCT_COUNT_MAX = 10_000
/** 单格原文上限（Excel 同值） */
export const CELL_TEXT_MAX = 32_767

/** 带列宽行高（SheetContent 里的）与其它将来的键：本档只搬、不认的原样带过 */
export type AgentContent = SheetContent & { colWidths?: Record<string, number>; rowHeights?: Record<string, number>; [k: string]: unknown }

export class OpError extends Error {
  code: string
  constructor(message: string, code = 'err_sheet_bad_op') { super(message); this.code = code }
}

// ── A1 区间 ──────────────────────────────────────────────────────────────

export type A1 = { rect: Rect; sheet: string | null; kind: 'cell' | 'range' | 'cols' | 'rows' }

/** 'A1'／'a1:c3'／'$B$2'／'A:C'（整列）／'2:5'（整行）／'表格1!A1:B2'（带页签名）⇒ 矩形；坏形或越界 ⇒ null */
export function parseA1(input: unknown): A1 | null {
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (!s || s.length > 200) return null
  let sheet: string | null = null
  const bang = s.lastIndexOf('!')
  if (bang >= 0) {
    let name = s.slice(0, bang).trim()
    if (/^'.*'$/.test(name)) name = name.slice(1, -1).replace(/''/g, "'")
    if (!name) return null
    sheet = name
    s = s.slice(bang + 1).trim()
  }
  s = s.replace(/\$/g, '').toUpperCase()
  const colOk = (c: number) => c >= 0 && c <= MAX_COL_INDEX
  const rowOk = (r: number) => r >= 0 && r <= MAX_ROW_INDEX
  let m = /^([A-Z]{1,3})(\d{1,7})$/.exec(s)
  if (m) {
    const r = Number(m[2]) - 1, c = colToIndex(m[1])
    return rowOk(r) && colOk(c) ? { rect: { r0: r, r1: r, c0: c, c1: c }, sheet, kind: 'cell' } : null
  }
  m = /^([A-Z]{1,3})(\d{1,7}):([A-Z]{1,3})(\d{1,7})$/.exec(s)
  if (m) {
    const ra = Number(m[2]) - 1, rb = Number(m[4]) - 1, ca = colToIndex(m[1]), cb = colToIndex(m[3])
    if (![ra, rb].every(rowOk) || ![ca, cb].every(colOk)) return null
    return { rect: { r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: Math.min(ca, cb), c1: Math.max(ca, cb) }, sheet, kind: 'range' }
  }
  m = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(s)
  if (m) {
    const ca = colToIndex(m[1]), cb = colToIndex(m[2])
    if (![ca, cb].every(colOk)) return null
    return { rect: { r0: 0, r1: MAX_ROW_INDEX, c0: Math.min(ca, cb), c1: Math.max(ca, cb) }, sheet, kind: 'cols' }
  }
  m = /^(\d{1,7}):(\d{1,7})$/.exec(s)
  if (m) {
    const ra = Number(m[1]) - 1, rb = Number(m[2]) - 1
    if (![ra, rb].every(rowOk)) return null
    return { rect: { r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: 0, c1: MAX_COL_INDEX }, sheet, kind: 'rows' }
  }
  return null
}

/** 矩形 ⇒ 'A1'（单格）或 'A1:C3' */
export function rectToA1(r: Rect): string {
  return r.r0 === r.r1 && r.c0 === r.c1 ? cellKey(r.r0, r.c0) : rangeKey(r)
}
const area = (r: Rect) => (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1)
function intersect(a: Rect, b: Rect): Rect | null {
  const r = { r0: Math.max(a.r0, b.r0), r1: Math.min(a.r1, b.r1), c0: Math.max(a.c0, b.c0), c1: Math.min(a.c1, b.c1) }
  return r.r0 <= r.r1 && r.c0 <= r.c1 ? r : null
}
function keyPos(k: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(k)
  if (!m) return null
  return { r: Number(m[2]) - 1, c: colToIndex(m[1]) }
}
const hasValue = (c: CellData | undefined) => !!c && ((typeof c.f === 'string' && c.f.trim() !== '') || (typeof c.v === 'string' && c.v !== ''))

/** 有值区：有原文或公式的格的外框（只有格式的格不算）；空表 ⇒ null */
export function usedRange(content: AgentContent | null | undefined): Rect | null {
  let out: Rect | null = null
  for (const [k, c] of Object.entries(content?.cells ?? {})) {
    if (!hasValue(c)) continue
    const p = keyPos(k); if (!p) continue
    out = out ? { r0: Math.min(out.r0, p.r), r1: Math.max(out.r1, p.r), c0: Math.min(out.c0, p.c), c1: Math.max(out.c1, p.c) } : { r0: p.r, r1: p.r, c0: p.c, c1: p.c }
  }
  return out
}
/** 有东西的外框：格（含只有格式的）＋合并区＋浮图锚格 */
export function contentExtent(content: AgentContent | null | undefined): Rect | null {
  let out: Rect | null = null
  const add = (r: Rect) => { out = out ? { r0: Math.min(out.r0, r.r0), r1: Math.max(out.r1, r.r1), c0: Math.min(out.c0, r.c0), c1: Math.max(out.c1, r.c1) } : { ...r } }
  for (const k of Object.keys(content?.cells ?? {})) { const p = keyPos(k); if (p) add({ r0: p.r, r1: p.r, c0: p.c, c1: p.c }) }
  for (const m of content?.merges ?? []) { const r = parseRange(m); if (r) add(r) }
  for (const im of content?.images ?? []) { const p = keyPos(im.cell); if (p) add({ r0: p.r, r1: p.r, c0: p.c, c1: p.c }) }
  return out
}

// ── 格式：内部 CellStyle ⇄ agent 看的字 ────────────────────────────────────

/** 线型（＝网页工具栏同一份 border.ts BORDER_STYLES） */
export const BORDER_LINE_STYLES: readonly BorderStyle[] = BORDER_STYLES
export type BorderLineStyle = BorderStyle
/** agent 看的套法名 ⇒ 网页工具栏的套法（border.ts BorderKind）：outer＝外框·inner＝内部横竖·thick_outer＝粗匣 */
const PRESET_KIND = { all: 'all', outer: 'outside', inner: 'inside', horizontal: 'horizontal', vertical: 'vertical', none: 'none', top: 'top', bottom: 'bottom', left: 'left', right: 'right', thick_outer: 'thickBox' } as const satisfies Record<string, BorderKind>
export type BorderPreset = keyof typeof PRESET_KIND
export const BORDER_PRESETS = Object.keys(PRESET_KIND) as BorderPreset[]
const SIDE_NAME = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const

export type FormatOut = {
  font?: string; size?: number; bold?: true; italic?: true; underline?: true; strike?: true
  color?: string; bg?: string; align?: string; valign?: string; wrap?: true; indent?: number
  number_format?: { type: NumFmtKind; decimals?: number; thousands?: boolean; symbol?: CurrencySymbol }
  borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left', { style: BorderStyle; color?: string }>>
}
/** 内部格式 ⇒ agent 读的形（键名与 format_cells 入参同一套·读回来可以原样再套） */
export function formatOut(s: CellStyle | undefined): FormatOut | undefined {
  if (!s) return undefined
  const o: FormatOut = {}
  if (s.font) o.font = s.font
  if (s.size) o.size = s.size
  if (s.b) o.bold = true
  if (s.i) o.italic = true
  if (s.u) o.underline = true
  if (s.s) o.strike = true
  if (s.fg) o.color = s.fg
  if (s.bg) o.bg = s.bg
  if (s.align) o.align = s.align
  if (s.valign) o.valign = s.valign
  if (s.wrap) o.wrap = true
  if (s.indent) o.indent = s.indent
  // 货币／会计专用回它显示的符号（没存 c 的旧格＝$·同工具栏下拉亮的那颗）⇒ 读回来原样再套不变样
  if (s.numFmt) o.number_format = { type: s.numFmt.t, ...(s.numFmt.d !== undefined ? { decimals: s.numFmt.d } : {}), ...(s.numFmt.k !== undefined ? { thousands: s.numFmt.k } : {}), ...(s.numFmt.t === 'currency' || s.numFmt.t === 'accounting' ? { symbol: s.numFmt.c ?? CURRENCY_SYMBOL } : {}) }
  const b: CellBorder = sanitizeBorder((s as { border?: unknown }).border) ?? {}
  const bo: NonNullable<FormatOut['borders']> = {}
  for (const side of ['t', 'r', 'b', 'l'] as const) { const l = b[side]; if (l) bo[SIDE_NAME[side]] = { ...l } }
  if (Object.keys(bo).length) o.borders = bo
  return Object.keys(o).length ? o : undefined
}

export type FormatInput = {
  font?: string | null; size?: number | null
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean
  color?: string | null; bg?: string | null
  align?: 'left' | 'center' | 'right' | null; valign?: 'top' | 'middle' | 'bottom' | null
  wrap?: boolean; indent?: number | null
  number_format?: { type: NumFmtKind; decimals?: number; thousands?: boolean; symbol?: CurrencySymbol } | null
  border?: { apply: BorderPreset; style?: BorderLineStyle; color?: string } | null
}
const FORMAT_KEYS = ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'color', 'bg', 'align', 'valign', 'wrap', 'indent', 'number_format', 'border'] as const

/** 校 agent 给的格式：坏值直接报错（⛔ 静默丢——agent 要知道哪一项没生效） */
export function validateFormat(input: unknown): FormatInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OpError('style must be an object')
  const x = input as Record<string, unknown>
  for (const k of Object.keys(x)) if (!(FORMAT_KEYS as readonly string[]).includes(k)) throw new OpError(`unknown style key "${k}" (allowed: ${FORMAT_KEYS.join(', ')})`)
  const out: FormatInput = {}
  if ('font' in x) {
    if (x.font === null) out.font = null
    else if (isFontId(x.font)) out.font = x.font
    else { const f = findFontByFamily(x.font); if (!f) throw new OpError(`unknown font "${String(x.font)}"`); out.font = f.id }
  }
  if ('size' in x) {
    if (x.size === null) out.size = null
    else if (typeof x.size === 'number' && Number.isInteger(x.size) && x.size >= SIZE_MIN && x.size <= SIZE_MAX) out.size = x.size
    else throw new OpError(`size must be an integer ${SIZE_MIN}–${SIZE_MAX}`)
  }
  for (const k of ['bold', 'italic', 'underline', 'strike', 'wrap'] as const) {
    if (!(k in x)) continue
    if (typeof x[k] !== 'boolean') throw new OpError(`${k} must be true or false`)
    out[k] = x[k] as boolean
  }
  for (const k of ['color', 'bg'] as const) {
    if (!(k in x)) continue
    if (x[k] === null) out[k] = null
    else if (isSafeColor(x[k])) out[k] = x[k] as string
    else throw new OpError(`${k} must be a hex color like #1f6feb (or a lowercase color name)`)
  }
  if ('align' in x) {
    if (x.align === null || x.align === 'left' || x.align === 'center' || x.align === 'right') out.align = x.align as FormatInput['align']
    else throw new OpError('align must be left / center / right')
  }
  if ('valign' in x) {
    if (x.valign === null || x.valign === 'top' || x.valign === 'middle' || x.valign === 'bottom') out.valign = x.valign as FormatInput['valign']
    else throw new OpError('valign must be top / middle / bottom')
  }
  if ('indent' in x) {
    if (x.indent === null) out.indent = null
    else if (typeof x.indent === 'number' && Number.isInteger(x.indent) && x.indent >= 0 && x.indent <= INDENT_MAX) out.indent = x.indent
    else throw new OpError(`indent must be an integer 0–${INDENT_MAX}`)
  }
  if ('number_format' in x) {
    const nf = x.number_format
    if (nf === null) out.number_format = null
    else {
      if (!nf || typeof nf !== 'object' || Array.isArray(nf)) throw new OpError('number_format must be {type, decimals?, thousands?, symbol?}')
      const o = nf as Record<string, unknown>
      for (const k of Object.keys(o)) if (!['type', 'decimals', 'thousands', 'symbol'].includes(k)) throw new OpError(`unknown number_format key "${k}" (allowed: type, decimals, thousands, symbol)`)
      if (typeof o.type !== 'string' || !(NUMFMT_KINDS as readonly string[]).includes(o.type)) throw new OpError(`number_format.type must be one of ${NUMFMT_KINDS.join(', ')}`)
      if (o.decimals !== undefined && !(typeof o.decimals === 'number' && Number.isInteger(o.decimals) && o.decimals >= 0 && o.decimals <= DECIMALS_MAX)) throw new OpError(`number_format.decimals must be 0–${DECIMALS_MAX}`)
      if (o.thousands !== undefined && typeof o.thousands !== 'boolean') throw new OpError('number_format.thousands must be true or false')
      // 货币符号（补缺·同工具栏下拉「貨幣符號」那四颗·存 numFmt.c）：只货币／会计专用收
      if (o.symbol !== undefined) {
        if (!isCurrencySymbol(o.symbol)) throw new OpError(`number_format.symbol must be one of ${CURRENCY_SYMBOLS.join(', ')}`)
        if (o.type !== 'currency' && o.type !== 'accounting') throw new OpError('number_format.symbol only applies to type currency or accounting')
      }
      out.number_format = { type: o.type as NumFmtKind, ...(o.decimals !== undefined ? { decimals: o.decimals as number } : {}), ...(o.thousands !== undefined ? { thousands: o.thousands as boolean } : {}), ...(o.symbol !== undefined ? { symbol: o.symbol as CurrencySymbol } : {}) }
    }
  }
  if ('border' in x) {
    const b = x.border
    if (b === null) out.border = null
    else {
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new OpError('border must be {apply, style?, color?}')
      const o = b as Record<string, unknown>
      if (typeof o.apply !== 'string' || !(BORDER_PRESETS as readonly string[]).includes(o.apply)) throw new OpError(`border.apply must be one of ${BORDER_PRESETS.join(', ')}`)
      if (o.style !== undefined && !(typeof o.style === 'string' && (BORDER_LINE_STYLES as readonly string[]).includes(o.style))) throw new OpError(`border.style must be one of ${BORDER_LINE_STYLES.join(', ')}`)
      if (o.color !== undefined && !isSafeColor(o.color)) throw new OpError('border.color must be a hex color like #000000')
      out.border = { apply: o.apply as BorderPreset, ...(o.style ? { style: o.style as BorderLineStyle } : {}), ...(o.color ? { color: o.color as string } : {}) }
    }
  }
  return out
}

/** 把非边框的格式项套到一格（null／false ⇒ 撤掉那一项） */
function patchStyle(cur: CellStyle | undefined, f: FormatInput): CellStyle | undefined {
  const s: CellStyle & Record<string, unknown> = { ...(cur ?? {}) }
  const setOrDel = <K extends keyof CellStyle>(k: K, v: CellStyle[K] | null | undefined | false) => { if (v === null || v === undefined || v === false) delete s[k]; else s[k] = v as CellStyle[K] }
  if ('font' in f) setOrDel('font', f.font)
  if ('size' in f) setOrDel('size', f.size)
  if ('bold' in f) setOrDel('b', f.bold ? true : null)
  if ('italic' in f) setOrDel('i', f.italic ? true : null)
  if ('underline' in f) setOrDel('u', f.underline ? true : null)
  if ('strike' in f) setOrDel('s', f.strike ? true : null)
  if ('color' in f) setOrDel('fg', f.color)
  if ('bg' in f) setOrDel('bg', f.bg)
  if ('align' in f) setOrDel('align', f.align)
  if ('valign' in f) setOrDel('valign', f.valign)
  if ('wrap' in f) setOrDel('wrap', f.wrap ? true : null)
  if ('indent' in f) setOrDel('indent', f.indent ? f.indent : null)
  if ('number_format' in f) {
    const nf = f.number_format
    // 预设值（小数位 2·货币／会计带千分位＋符号：给了 symbol 用它·没给按站别）照工具栏下拉同一份 numFmtForKind；agent 明给的再盖上去
    const base = nf ? numFmtForKind(nf.type, nf.symbol) : undefined
    if (!nf || !base) delete s.numFmt
    else {
      const o: NumFmt = { ...base }
      if (nf.decimals !== undefined) o.d = nf.decimals
      if (nf.thousands === true) o.k = true
      else if (nf.thousands === false) delete o.k
      s.numFmt = o
    }
  }
  return Object.keys(s).length ? s : undefined
}

// ── 公式引用：插删行列／搬动时改写 ──────────────────────────────────────────

type RefPart = Pick<ScanRefPart, 'col' | 'row' | 'colAbs' | 'rowAbs'>

/**
 * 改写公式里的每个引用（单格或 A1:B3 区间）：fn 回新字串（'#REF!' 也行）或 null（不动）。
 * 扫描器＝网页同一份 formula-refs scanRefs（跳过 "字串"·函数名 LOG10( 不算）；另外跨表的（Sheet1!A1·前一字是 !）不动。
 *   （插删行列已不走这支：改走 formula-refs shiftFormulaForStruct——写了本张名的跨表引用也挪·整列也挪）
 */
export function rewriteRefs(f: string, fn: (a: RefPart, b: RefPart | null) => string | null): string {
  let out = ''
  let last = 0
  for (const sp of scanRefs(f)) {
    if (sp.start > 0 && f[sp.start - 1] === '!') continue
    const rep = fn(sp.a, sp.b ?? null)
    if (rep === null) continue
    out += f.slice(last, sp.start) + rep
    last = sp.end
  }
  return out + f.slice(last)
}

type Axis = 'row' | 'col'
const maxA = (axis: Axis) => (axis === 'row' ? MAX_ROW_INDEX : MAX_COL_INDEX)

/** 本张插删的改写口径：没写前缀的＋写了本张名的（sheetName 省 ⇒ 带前缀的不动） */
const localScope = (sheetName?: string | null): StructScope => ({ local: true, sheet: sheetName ?? null, maxRow: MAX_ROW_INDEX, maxCol: MAX_COL_INDEX })

/** 插入 count 条（在第 at 条之前·0 起）：落在 at 之后（含）的端点往后推 count（$ 也推·整列随插列推）；推出上限 ⇒ #REF!——规则在 formula-refs shiftFormulaForStruct */
export function shiftRefsForInsert(f: string, axis: Axis, at: number, count: number, sheetName?: string | null): { f: string; broken: number } {
  return shiftFormulaForStruct(f, { axis, mode: 'insert', at, count }, localScope(sheetName))
}

/** 删掉 [at, at+count-1]：单格落在里面 ⇒ #REF!；区间整段被删 ⇒ #REF!、部分被删 ⇒ 收缩；之后的端点往前拉 count（fortune-sheet 同口径） */
export function shiftRefsForDelete(f: string, axis: Axis, at: number, count: number, sheetName?: string | null): { f: string; broken: number } {
  return shiftFormulaForStruct(f, { axis, mode: 'delete', at, count }, localScope(sheetName))
}

/**
 * 别张跟着改（Excel 口径）：一张插删行列（changes＝按序的那几次）⇒ 整份文件其余每张里写了它名字前缀的引用（表格2!A1）一起挪。
 *   tabs＝整份文件（顺序＝页签顺序）·targetId＝被插删那张。同名几张时前缀指的是排最前那张（同求值器）⇒ 改的不是它就都不动。
 *   回：要写回的那几张（没一格变的不列）＋各张新变 #REF! 的段数。
 */
export function shiftOtherSheetsForStruct<T extends SheetContent>(tabs: ReadonlyArray<{ id: string; name: string; content: T | null | undefined }>, targetId: string, changes: readonly StructChange[]): Array<{ id: string; name: string; content: T; broken: number }> {
  const target = tabs.find(t => t.id === targetId)
  if (!target || !changes.length) return []
  const holder = tabs.find(t => sheetKey(t.name) === sheetKey(target.name))
  if (holder?.id !== targetId) return []
  const out: Array<{ id: string; name: string; content: T; broken: number }> = []
  for (const t of tabs) {
    if (t.id === targetId) continue
    const r = shiftContentForStruct(t.content, changes, { local: false, sheet: target.name, maxRow: MAX_ROW_INDEX, maxCol: MAX_COL_INDEX })
    if (r) out.push({ id: t.id, name: t.name, content: r.content, broken: r.broken })
  }
  return out
}

/** 格子被搬动 dRow 行（排序用）：网页同一份 shiftFormula（复制口径·相对行跟着走·$ 不动·出界 ⇒ #REF!）；broken＝多出来的 #REF! 段数 */
export function shiftRefsForMove(f: string, dRow: number): { f: string; broken: number } {
  const out = shiftFormula(f, dRow, 0, MAX_ROW_INDEX + 1, MAX_COL_INDEX + 1)
  const count = (x: string) => x.split('#REF!').length - 1
  return { f: out, broken: Math.max(0, count(out) - count(f)) }
}

// ── 读区间 ────────────────────────────────────────────────────────────────

export type CellOut = {
  cell: string
  /** 原始输入：公式格＝公式原文（= 开头）·其余＝原文 */
  input: string
  /** 算出来的值：数字／文字／null（空）／错误码字串（#DIV/0! 等） */
  value: number | string | null
  /** 网页格子里显示的字（套了数字格式） */
  display: string
  format?: FormatOut
  /** 这格是合并区左上 ⇒ 合并区范围 */
  merge?: string
  /** 这格被别的合并区盖住（网页看不到它） */
  hidden_by_merge?: string
}
export type ReadResult = {
  used_range: string | null
  range: string | null
  total: number
  offset: number
  limit: number
  next_offset: number | null
  cells: CellOut[]
  merges: string[]
  images?: Array<{ id: string; cell: string; w: number; h: number; ox?: number; oy?: number; plane?: 'below'; in_cell?: true }>
  col_widths?: Record<string, number>
  row_heights?: Record<string, number>
  /** 图表：整张表的图表（键名＝set_chart 参数名） */
  charts?: ReturnType<typeof chartsForRead>
  /** 条件格式：规则清单（不给 range ⇒ 全部；给了 ⇒ 跟区间有交集的）·键名＝set_conditional_format 入参 */
  cond_formats?: CondOut[]
  // 冻结筛选验证：现况（冻结／筛选区与条件／被筛掉的行／下拉清单）
  freeze?: ViewOut['freeze']
  filter?: ViewOut['filter']
  validations?: ViewOut['validations']
  /** 列印设定（网页「列印」对话框存的那份·没设过 ⇒ 不回）：纸张／方向／边界（公分）／缩放／列印范围／标题列栏／格线／页首页尾 */
  print?: SheetPrint
}

export function displayOf(cell: CellData | undefined, v: EvalResult): string {
  const nf = cell?.s?.numFmt as NumFmt | undefined
  const shown = isFormulaError(v) ? null : formatWithNumFmt(nf, v, cell?.f ? undefined : cell?.v)
  return shown ?? formatValue(v)
}

/** 读一张 sheet 的某区间（不给 ⇒ 有值区）·只回有东西的格（按行再按列排）·offset／limit 分页；eval 带整份文件（book＋sheetName）⇒ 跨表公式算得出 */
export function readRange(content: AgentContent | null | undefined, opts: { range?: string | null; offset?: number; limit?: number; includeFormats?: boolean; includeFormatOnly?: boolean; eval?: EvaluatorOptions } = {}): ReadResult {
  const cells = content?.cells ?? {}
  const used = usedRange(content)
  let rect: Rect | null
  let rangeLabel: string | null
  if (opts.range) {
    const a = parseA1(opts.range)
    if (!a) throw new OpError(`bad range "${opts.range}" (use A1 notation like A1:C10, A:C or 2:5)`)
    rect = a.rect
    // 整列／整行照原样回（A:C 的矩形是一百万行·印成 A1:C999999 反而误导）
    rangeLabel = a.kind === 'cols' || a.kind === 'rows' ? opts.range.trim().replace(/^.*!/, '').replace(/\$/g, '').toUpperCase() : rectToA1(a.rect)
  } else { rect = used; rangeLabel = used ? rectToA1(used) : null }
  const limit = Math.min(READ_MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? READ_DEFAULT_LIMIT)))
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const includeFormats = opts.includeFormats !== false
  const out: ReadResult = { used_range: used ? rectToA1(used) : null, range: rangeLabel, total: 0, offset, limit, next_offset: null, cells: [], merges: [] }
  // 图：没给 range ⇒ 整张的图全列；给了 ⇒ 锚格在区内的
  const imgs = (content?.images ?? []).filter(im => { if (!opts.range) return true; const p = keyPos(im.cell); return !!p && !!rect && rectContains(rect, p.r, p.c) })
  if (imgs.length) out.images = imgs.map(im => ({ id: im.id, cell: im.cell, w: im.w, h: im.h, ...(im.inCell ? { in_cell: true as const } : { ox: im.ox ?? 0, oy: im.oy ?? 0, ...(im.plane === 'below' ? { plane: 'below' as const } : {}) }) }))
  // N3：列宽行高 ⛔ 跟着有值区走——不给 range ⇒ 全部列出（空表／纯图表设过的也拿得到）；给了 ⇒ 区内的
  if (content?.colWidths && typeof content.colWidths === 'object') {
    const cw: Record<string, number> = {}
    for (const [k, w] of Object.entries(content.colWidths)) { if (/^[A-Z]{1,3}$/.test(k) && (!opts.range || (!!rect && colToIndex(k) >= rect.c0 && colToIndex(k) <= rect.c1))) cw[k] = w }
    if (Object.keys(cw).length) out.col_widths = cw
  }
  if (content?.rowHeights && typeof content.rowHeights === 'object') {
    const rh: Record<string, number> = {}
    for (const [k, h] of Object.entries(content.rowHeights)) { const r = Number(k) - 1; if (/^\d{1,6}$/.test(k) && (!opts.range || (!!rect && r >= rect.r0 && r <= rect.r1))) rh[k] = h }
    if (Object.keys(rh).length) out.row_heights = rh
  }
  // 图表：不论 range 都列整张表的图表（最多 20 张·AI 要拿 chart_id 改）
  const charts = chartsForRead(content)
  if (charts) out.charts = charts
  // 条件格式：AI 读得到 rule_id 与设定（不给 range ⇒ 全列）
  { const cf = condFormatsOut(content?.condFormats, opts.range ? rect : null); if (cf.length) out.cond_formats = cf }
  Object.assign(out, viewOut(content, opts.range ? rect : null))   // 冻结筛选验证
  { const pr = content?.print === undefined ? undefined : sanitizePrint(content.print); if (pr) out.print = pr }   // 列印设定
  if (!rect) return out
  const ev = new SheetEvaluator(cells, content?.merges, opts.eval)
  const covered = coveredMap(content?.merges)
  const mergeAt = new Map<string, string>()
  for (const m of content?.merges ?? []) { const r = parseRange(m); if (r) mergeAt.set(cellKey(r.r0, r.c0), rangeKey(r)) }
  const hits: Array<{ k: string; r: number; c: number }> = []
  for (const [k, c] of Object.entries(cells)) {
    const p = keyPos(k); if (!p || !rectContains(rect, p.r, p.c)) continue
    if (!hasValue(c) && !(opts.includeFormatOnly && includeFormats && c?.s)) continue
    hits.push({ k, r: p.r, c: p.c })
  }
  hits.sort((a, b) => a.r - b.r || a.c - b.c)
  out.total = hits.length
  for (const h of hits.slice(offset, offset + limit)) {
    const cd = cells[h.k]
    const v = ev.value(h.k)
    const item: CellOut = { cell: h.k, input: cd.f ? cd.f : (cd.v ?? ''), value: v, display: displayOf(cd, v) }
    if (includeFormats) { const f = formatOut(cd.s); if (f) item.format = f }
    const mg = mergeAt.get(h.k); if (mg) item.merge = mg
    const cov = covered.get(h.k); if (cov) item.hidden_by_merge = mergeAt.get(cov) ?? cov
    out.cells.push(item)
  }
  out.next_offset = offset + limit < hits.length ? offset + limit : null
  out.merges = (content?.merges ?? []).filter(m => { const r = parseRange(m); return !!r && rectsOverlap(r, rect!) })
  return out
}

// ── 改：操作清单 ──────────────────────────────────────────────────────────

export type SheetOp =
  | { op: 'set'; range: string; values: unknown[][] }
  | { op: 'format'; range: string; style?: unknown; clear?: boolean }
  | { op: 'insert_rows'; at: number; count?: number }
  | { op: 'delete_rows'; at: number; count?: number }
  | { op: 'insert_cols'; at: string; count?: number }
  | { op: 'delete_cols'; at: string; count?: number }
  | { op: 'merge'; range: string }
  | { op: 'unmerge'; range: string }
  | { op: 'sort'; range: string; by: Array<{ column: string; descending?: boolean }>; has_header?: boolean }
  // 表格图（插进格子／浮动自由摆放／垫在格子下）——url 由 route 先把云盘 file_id 换成自家图床网址
  | { op: 'add_image'; cell: string; url: string; w: number; h: number; ox?: number; oy?: number; mode?: ImageMode }
  | { op: 'update_image'; id: string; cell?: string; w?: number; h?: number; ox?: number; oy?: number; mode?: ImageMode; order?: ZMove }
  | { op: 'delete_image'; id: string }
  // 图表：set_chart（带 id 改·不带建）／delete_chart——栏位校验与套用在 ./chart.ts applyChartOp
  | { op: 'set_chart'; id?: string; type?: string; range?: string; [k: string]: unknown }
  | { op: 'delete_chart'; id: string }
  // 条件格式（set_conditional_format）：ranges＝多段区间（⛔ 用 range 栏：route 会剥页签名）
  | { op: 'cond_format'; ranges?: string; rule?: unknown; format?: unknown; clear?: boolean; rule_id?: string; priority?: number; stop_if_true?: boolean }
  // 冻结筛选验证：参数与口径在 ./sheet-view.ts applyViewOp
  | { op: 'freeze'; rows?: number; cols?: number }
  | { op: 'filter'; range?: string; criteria?: Record<string, unknown>; clear?: boolean }
  | { op: 'validate'; range?: string; list?: unknown[]; source?: string; allow_blank?: boolean; reject_invalid?: boolean; clear?: boolean }
  | { op: 'hide'; rows?: string; cols?: string; hidden?: boolean; unhide_all?: boolean }
  // 寻找取代·移除重复：口径在 ./data-tools.ts
  | { op: 'find'; find: string; range?: string; match_case?: boolean; whole_cell?: boolean; look_in?: 'formulas' | 'values' }
  | { op: 'replace'; find: string; replace: string; range?: string; match_case?: boolean; whole_cell?: boolean; include_formulas?: boolean }
  | { op: 'dedupe'; range: string; columns?: string[]; has_header?: boolean }

export const OP_NAMES = ['set', 'format', 'insert_rows', 'delete_rows', 'insert_cols', 'delete_cols', 'merge', 'unmerge', 'sort', 'add_image', 'update_image', 'delete_image', 'resize', 'set_chart', 'delete_chart', 'cond_format', ...VIEW_OP_NAMES, 'find', 'replace', 'dedupe'] as const
/** find 回给 agent 的格至多几个（再多只给总数） */
export const FIND_RESULT_MAX = 200

export type OpResult = { op: string; range?: string; cells?: number; [k: string]: unknown }
/** structs＝这次做了的插删行列（按序·0 起）——呼叫方拿去 shiftOtherSheetsForStruct 改整份文件其余各张的跨表引用 */
export type ApplyResult = { content: AgentContent; results: OpResult[]; warnings: string[]; structs: StructChange[] }

/**
 * resize 的裸列「B」／裸行「5」（可带页签名·$·大小写）⇒ 补成 B:B／5:5；不是裸形 ⇒ 原字串照回。
 *   resize 解析与 opSheetNames 辨页签共用这一份
 */
export function expandBareColRow(range: string): string {
  const bare = /^(.*!)?\s*\$?([A-Za-z]{1,3}|\d{1,7})\s*$/.exec(range.trim())
  return bare ? `${bare[1] ?? ''}${bare[2]}:${bare[2]}` : range
}

/** 页签名（op 的 range 里带的 Sheet1!A1）——route 用它核「这条 op 是不是写到别张」 */
export function opSheetNames(ops: unknown[]): string[] {
  const out = new Set<string>()
  for (const o of ops) {
    if (!o || typeof o !== 'object') continue
    const r = (o as { range?: unknown }).range
    // F1：resize 收裸列／裸行 ⇒ 辨名前先走同一套补形（只 resize·别的 op 本来就不收裸形·applyOps 照拒）
    const a = typeof r === 'string' ? parseA1((o as { op?: unknown }).op === 'resize' ? expandBareColRow(r) : r) : null
    if (a?.sheet) out.add(a.sheet)
  }
  return [...out]
}

function cloneContent(c: AgentContent | null | undefined): AgentContent {
  const src = c ?? {}
  const cells: SheetCells = {}
  for (const [k, v] of Object.entries(src.cells ?? {})) cells[k] = { ...v, ...(v.s ? { s: { ...v.s, ...(v.s.numFmt ? { numFmt: { ...v.s.numFmt } } : {}) } } : {}) }
  return { ...src, cells, merges: [...(src.merges ?? [])], images: (src.images ?? []).map(i => ({ ...i })), ...(src.colWidths ? { colWidths: { ...src.colWidths } } : {}), ...(src.rowHeights ? { rowHeights: { ...src.rowHeights } } : {}) }
}

/** agent 给的一个值 ⇒ 这格的内容：'=…' 公式·"'=…" 当文字·数字／布尔转字·null／'' 清空 */
function inputToCell(x: unknown, where: string): { clear: true } | { v: string; f?: string; text?: true } {
  if (x === null || x === undefined || x === '') return { clear: true }
  if (typeof x === 'number') { if (!Number.isFinite(x)) throw new OpError(`${where}: number must be finite`); return { v: String(x) } }
  if (typeof x === 'boolean') return { v: x ? 'TRUE' : 'FALSE' }
  if (typeof x !== 'string') throw new OpError(`${where}: values must be strings, numbers, booleans or null`)
  if (x.length > CELL_TEXT_MAX) throw new OpError(`${where}: text longer than ${CELL_TEXT_MAX} characters`)
  if (x.startsWith("'")) return { v: x.slice(1), text: true }   // 前导单引号 ⇒ 当文字（Excel 同·'2026-10-16 也不转日期）
  if (x.trim().startsWith('=')) {
    const f = x.trim()
    if (f.length < 2) throw new OpError(`${where}: empty formula`)
    return { v: '', f }
  }
  return { v: x }
}

function needRange(o: Record<string, unknown>, idx: number): A1 {
  const a = parseA1(o.range)
  if (!a) throw new OpError(`ops[${idx}].range: bad A1 range "${String(o.range)}"`)
  return a
}
function needCount(o: Record<string, unknown>, idx: number): number {
  const n = o.count === undefined ? 1 : o.count
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > STRUCT_COUNT_MAX) throw new OpError(`ops[${idx}].count must be an integer 1–${STRUCT_COUNT_MAX}`)
  return n
}
function needRowAt(o: Record<string, unknown>, idx: number): number {
  const at = o.at
  if (typeof at !== 'number' || !Number.isInteger(at) || at < 1 || at - 1 > MAX_ROW_INDEX) throw new OpError(`ops[${idx}].at must be a row number (1-based)`)
  return at - 1
}
function needColAt(o: Record<string, unknown>, idx: number): number {
  const at = o.at
  if (typeof at === 'string' && /^[A-Za-z]{1,3}$/.test(at.trim())) { const c = colToIndex(at.trim()); if (c <= MAX_COL_INDEX) return c }
  if (typeof at === 'number' && Number.isInteger(at) && at >= 1 && at - 1 <= MAX_COL_INDEX) return at - 1
  throw new OpError(`ops[${idx}].at must be a column letter like "C" (or a 1-based column number)`)
}
/** 整列／整行的区间先裁到有东西的范围（不然逐格套会是百万格） */
function clipToExtent(a: A1, content: AgentContent): Rect | null {
  if (a.kind === 'cell' || a.kind === 'range') return a.rect
  const ext = contentExtent(content)
  return ext ? intersect(a.rect, ext) : null
}

// 结构变动（插删行列）：格、公式、合并、浮图、列宽行高一起动
function structural(content: AgentContent, axis: Axis, mode: 'insert' | 'delete', at: number, count: number, warnings: string[], sheetName?: string | null): { moved: number; brokenRefs: number } {
  const end = at + count - 1
  let brokenRefs = 0
  // ① 公式先改（引用的是改之前的坐标）：没写前缀的＋写了本张名的（表格1!A1 在表格1 里）·别张由呼叫方 shiftOtherSheetsForStruct 改
  for (const cd of Object.values(content.cells ?? {})) {
    if (!cd.f) continue
    const r = mode === 'insert' ? shiftRefsForInsert(cd.f, axis, at, count, sheetName) : shiftRefsForDelete(cd.f, axis, at, count, sheetName)
    if (r.f !== cd.f) cd.f = r.f
    brokenRefs += r.broken
  }
  // ② 格子搬家
  const next: SheetCells = {}
  let moved = 0, dropped = 0
  for (const [k, cd] of Object.entries(content.cells ?? {})) {
    const p = keyPos(k); if (!p) continue
    const v = axis === 'row' ? p.r : p.c
    let nv = v
    if (mode === 'insert') { if (v >= at) nv = v + count }
    else if (v >= at && v <= end) { dropped++; continue }
    else if (v > end) nv = v - count
    if (nv > maxA(axis)) throw new OpError(`this would push data past the sheet edge (${axis === 'row' ? `row ${MAX_ROW_INDEX + 1}` : `column ${indexToCol(MAX_COL_INDEX)}`})`, 'err_sheet_out_of_bounds')
    if (nv !== v) moved++
    next[axis === 'row' ? cellKey(nv, p.c) : cellKey(p.r, nv)] = cd
  }
  content.cells = next
  // ③ 合并区（端点同公式区间规则）
  const merges: string[] = []
  let mergesGone = 0
  for (const m of content.merges ?? []) {
    const r = parseRange(m); if (!r) continue
    let s = axis === 'row' ? r.r0 : r.c0, e = axis === 'row' ? r.r1 : r.c1
    if (mode === 'insert') { if (s >= at) s += count; if (e >= at) e += count }
    else {
      if (s >= at && e <= end) { mergesGone++; continue }
      if (s > end) s -= count; else if (s >= at) s = at
      if (e > end) e -= count; else if (e >= at) e = at - 1
      if (e < s) e = s
    }
    const nr = axis === 'row' ? { ...r, r0: s, r1: e } : { ...r, c0: s, c1: e }
    if (nr.r0 === nr.r1 && nr.c0 === nr.c1) { mergesGone++; continue }
    if (nr.r1 > MAX_ROW_INDEX || nr.c1 > MAX_COL_INDEX) { mergesGone++; continue }
    merges.push(rangeKey(nr))
  }
  content.merges = merges
  // ④ 浮图（锚格跟着走·锚格被删 ⇒ 图拿掉）
  let imagesGone = 0
  const images: SheetImage[] = []
  for (const im of content.images ?? []) {
    const p = keyPos(im.cell); if (!p) continue
    const v = axis === 'row' ? p.r : p.c
    let nv = v
    if (mode === 'insert') { if (v >= at) nv = v + count }
    else if (v >= at && v <= end) { imagesGone++; continue }
    else if (v > end) nv = v - count
    if (nv > maxA(axis)) { imagesGone++; continue }
    images.push({ ...im, cell: axis === 'row' ? cellKey(nv, p.c) : cellKey(p.r, nv) })
  }
  content.images = images
  // 图表：锚格与数据区间跟着动（数据整段被删 ⇒ 图表拿掉）
  if (content.charts?.length) {
    const sc = shiftChartsForStructural(content.charts, axis, mode, at, count)
    content.charts = sc.charts
    if (sc.removed) warnings.push(`${sc.removed} chart(s) whose data was deleted were removed.`)
  }
  // ⑤ 列宽行高（colWidths{列字母}／rowHeights{行号 1 起}·有才动）
  const sizes = axis === 'row' ? content.rowHeights : content.colWidths
  if (sizes && typeof sizes === 'object') {
    const nextSizes: Record<string, number> = {}
    for (const [k, val] of Object.entries(sizes)) {
      const v = axis === 'row' ? Number(k) - 1 : (/^[A-Z]{1,3}$/.test(k) ? colToIndex(k) : NaN)
      if (!Number.isInteger(v) || v < 0) continue
      let nv = v
      if (mode === 'insert') { if (v >= at) nv = v + count }
      else if (v >= at && v <= end) continue
      else if (v > end) nv = v - count
      if (nv > maxA(axis)) continue
      nextSizes[axis === 'row' ? String(nv + 1) : indexToCol(nv)] = val
    }
    if (axis === 'row') content.rowHeights = nextSizes; else content.colWidths = nextSizes
  }
  // ⑥ 条件格式：规则区间端点同合并区规则（整段被删 ⇒ 那段拿掉·段全没了 ⇒ 规则拿掉）
  if (content.condFormats?.length) {
    const cf = shiftCondFormats(content.condFormats, axis, mode, at, count)
    content.condFormats = cf.rules
    if (cf.removed) warnings.push(`${cf.removed} conditional format rule(s) covered only the deleted ${axis === 'row' ? 'rows' : 'columns'} and were removed.`)
  }
  if (dropped) warnings.push(`${dropped} non-empty cell(s) were in the deleted ${axis === 'row' ? 'rows' : 'columns'} and are gone.`)
  if (brokenRefs) warnings.push(`${brokenRefs} formula reference(s) pointed into deleted ${axis === 'row' ? 'rows' : 'columns'} and now read #REF!.`)
  if (mergesGone) warnings.push(`${mergesGone} merged area(s) were removed.`)
  if (imagesGone) warnings.push(`${imagesGone} floating image(s) anchored there were removed.`)
  // ⑥ 冻结筛选验证：冻结行列数／筛选区与条件列／下拉清单区间跟着搬
  warnings.push(...shiftViewForStruct(content, axis, mode, at, count, { rows: MAX_ROW_INDEX, cols: MAX_COL_INDEX }))
  return { moved, brokenRefs }
}

// 排序比较（Excel 口径）：数字 < 文字 < 错误；空格不论升降都排最后；同值保持原顺序
type SortKey = { kind: 0 | 1 | 2 | 3; n?: number; s?: string }
function sortKeyOf(v: EvalResult): SortKey {
  if (v === null || v === '') return { kind: 3 }
  if (typeof v === 'number') return { kind: 0, n: v }
  if (isFormulaError(v)) return { kind: 2, s: v }
  return { kind: 1, s: v }
}
const collator = new Intl.Collator('en', { sensitivity: 'base' })
function compareKeys(a: SortKey, b: SortKey, desc: boolean): number {
  if (a.kind === 3 || b.kind === 3) return a.kind === b.kind ? 0 : a.kind === 3 ? 1 : -1
  let d: number
  if (a.kind !== b.kind) d = a.kind - b.kind
  else if (a.kind === 0) d = (a.n! - b.n!)
  else d = collator.compare(a.s!, b.s!)
  return desc ? -d : d
}

/**
 * 按清单依序改一张 sheet（全部成功才算·中途哪一条坏 ⇒ 抛 OpError·调用方零写）。
 */
/** 图的摆法：float＝浮在格子上（缺省·可自由摆放）／below＝垫在格子底下／in_cell＝放进格子里（随格大小） */
export type ImageMode = 'float' | 'below' | 'in_cell'
const IMAGE_MODES: readonly ImageMode[] = ['float', 'below', 'in_cell']
const Z_MOVES: readonly ZMove[] = ['up', 'down', 'top', 'bottom']
function imgCell(v: unknown, idx: number): string {
  const k = typeof v === 'string' ? v.trim().toUpperCase().replace(/^.*!/, '').replace(/\$/g, '') : ''
  const p = /^[A-Z]{1,3}\d{1,6}$/.test(k) ? keyPos(k) : null
  if (!p || p.r < 0 || p.c < 0 || p.r > MAX_ROW_INDEX || p.c > MAX_COL_INDEX) throw new OpError(`ops[${idx}].cell must be one cell like "B2"`)
  return cellKey(p.r, p.c)
}
function imgSide(v: unknown, idx: number, name: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < IMAGE_SIDE_MIN || v > IMAGE_SIDE_MAX) throw new OpError(`ops[${idx}].${name} must be a number of pixels ${IMAGE_SIDE_MIN}–${IMAGE_SIDE_MAX}`)
  return Math.round(v)
}
function imgOff(v: unknown, idx: number, name: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > IMAGE_SIDE_MAX) throw new OpError(`ops[${idx}].${name} must be 0–${IMAGE_SIDE_MAX} pixels`)
  return Math.round(v)
}
function imgMode(v: unknown, idx: number): ImageMode | undefined {
  if (v === undefined || v === null) return undefined
  if (!IMAGE_MODES.includes(v as ImageMode)) throw new OpError(`ops[${idx}].mode must be one of ${IMAGE_MODES.join(', ')}`)
  return v as ImageMode
}
/** 换摆法（共用网页右键选单那几支：进格子＝一格只留一张·换平面＝排到新平面最顶） */
function applyImageMode(images: SheetImage[], id: string, mode: ImageMode): SheetImage[] {
  if (mode === 'in_cell') return putImageInCell(images, id)
  return setImagePlane(images, id, mode === 'below' ? 'below' : 'above')
}
function newImageId(images: SheetImage[]): string {
  for (;;) { const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; if (!images.some(im => im.id === id)) return id }
}

/** evalOpts：整份文件（book＋sheetName）·排序比的是算出来的值·跨表公式要它才算得出；sheetName 也定插删行列时「写了本张名的引用」跟着挪 */
export function applyOps(input: AgentContent | null | undefined, ops: unknown, evalOpts?: EvaluatorOptions): ApplyResult {
  if (!Array.isArray(ops) || ops.length === 0) throw new OpError('ops must be a non-empty array')
  if (ops.length > OPS_MAX) throw new OpError(`too many ops (max ${OPS_MAX} per call)`)
  const content = cloneContent(input)
  content.cells = content.cells ?? {}
  const results: OpResult[] = []
  const warnings: string[] = []
  const structs: StructChange[] = []
  let setCount = 0

  ops.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OpError(`ops[${idx}] must be an object`)
    const o = raw as Record<string, unknown>
    const cells = content.cells!
    switch (o.op) {
      case 'set': {
        const a = needRange(o, idx)
        if (a.kind === 'cols' || a.kind === 'rows') throw new OpError(`ops[${idx}].range: set needs a cell or a bounded range (e.g. A1 or A1:C3)`)
        const values = o.values
        if (!Array.isArray(values) || values.length === 0 || !values.every(Array.isArray)) throw new OpError(`ops[${idx}].values must be a 2-D array like [["a", 1], ["b", 2]]`)
        const rows = values as unknown[][]
        const width = Math.max(...rows.map(r => r.length))
        if (a.kind === 'range') {
          const h = a.rect.r1 - a.rect.r0 + 1, w = a.rect.c1 - a.rect.c0 + 1
          if (rows.length !== h || rows.some(r => r.length !== w)) throw new OpError(`ops[${idx}]: values are ${rows.length}×${width} but range ${rectToA1(a.rect)} is ${h}×${w} (give just the top-left cell to write any size)`)
        }
        if (a.rect.r0 + rows.length - 1 > MAX_ROW_INDEX || a.rect.c0 + width - 1 > MAX_COL_INDEX) throw new OpError(`ops[${idx}]: values run past the sheet edge`, 'err_sheet_out_of_bounds')
        const covered = coveredMap(content.merges)
        let n = 0
        rows.forEach((row, dr) => row.forEach((x, dc) => {
          const k = cellKey(a.rect.r0 + dr, a.rect.c0 + dc)
          const where = `ops[${idx}] ${k}`
          const next = inputToCell(x, where)
          const cur = cells[k]
          if (covered.has(k) && !('clear' in next)) throw new OpError(`${where} is hidden inside a merged area — write to its top-left cell ${covered.get(k)} instead (or unmerge first)`)
          if ('clear' in next) {
            if (!cur) return
            if (cur.s) cells[k] = { s: cur.s }; else delete cells[k]
          } else {
            const cd: CellData = next.f ? { v: '', f: next.f } : { v: next.v }
            let s = cur?.s
            // 跟网页打字同一条：带四位年的 2026/10/16、2026-10-16 ⇒ 真日期；'开头的照文字
            if (!next.f && !next.text) { const got = valueForInput(next.v, s?.numFmt); cd.v = got.v; if (got.numFmt) s = { ...(s ?? {}), numFmt: got.numFmt } }
            if (s) cd.s = s
            cells[k] = cd
          }
          n++
        }))
        setCount += n
        if (setCount > SET_CELLS_MAX) throw new OpError(`too many cells written in one call (max ${SET_CELLS_MAX})`)
        results.push({ op: 'set', range: rectToA1({ r0: a.rect.r0, c0: a.rect.c0, r1: a.rect.r0 + rows.length - 1, c1: a.rect.c0 + width - 1 }), cells: n })
        break
      }
      case 'format': {
        const a = needRange(o, idx)
        const style = o.style === undefined ? {} : validateFormat(o.style)
        const clear = o.clear === true
        if (o.clear !== undefined && typeof o.clear !== 'boolean') throw new OpError(`ops[${idx}].clear must be true or false`)
        if (!clear && Object.keys(style).length === 0) throw new OpError(`ops[${idx}]: give style (and/or clear: true)`)
        const rect = clipToExtent(a, content)
        if (!rect) { results.push({ op: 'format', range: String(o.range), cells: 0 }); warnings.push(`ops[${idx}]: ${String(o.range)} has nothing in it yet, so there was nothing to format (whole-row/column formats only reach cells that exist).`); break }
        if (a.kind === 'cols' || a.kind === 'rows') warnings.push(`ops[${idx}]: whole ${a.kind === 'cols' ? 'column' : 'row'} formats were applied to ${rectToA1(rect)} (the part that has content); cells added later outside it won't inherit them.`)
        if (area(rect) > FORMAT_CELLS_MAX) throw new OpError(`ops[${idx}]: range too large to format (${area(rect)} cells; max ${FORMAT_CELLS_MAX})`)
        const { border, ...rest } = style
        let n = 0
        for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) {
          const k = cellKey(r, c)
          const cur = cells[k]
          let s: CellStyle | undefined = clear ? undefined : cur?.s
          if (Object.keys(rest).length) s = patchStyle(s, rest)
          if (s) { cells[k] = { ...(cur ?? {}), s }; n++ }
          else if (cur) { const { s: _s, ...restCell } = cur; if (hasValue(restCell)) cells[k] = restCell; else delete cells[k]; n++ }
        }
        // 边框：网页工具栏同一套（border.ts）——外缘写到区内一侧并清区外邻格对边·内线两侧同写·none 连外圈邻格对边一起清·合并区写左上
        if (border !== undefined) {
          const kind = border === null ? 'none' : PRESET_KIND[border.apply]
          const pen = { style: (border?.style ?? 'thin') as BorderStyle, ...(border?.color ? { color: border.color } : {}) }
          const mergeRects = (content.merges ?? []).map(m => parseRange(m)).filter((x): x is Rect => !!x)
          content.cells = applyBorderEdges(cells as never, rect, edgesForKind(kind, pen), mergeRects, { rows: MAX_ROW_INDEX + 1, cols: MAX_COL_INDEX + 1 }) as SheetCells
        }
        results.push({ op: 'format', range: rectToA1(rect), cells: n })
        break
      }
      case 'insert_rows': case 'delete_rows': {
        const at = needRowAt(o, idx), count = needCount(o, idx)
        const mode = o.op === 'insert_rows' ? 'insert' : 'delete'
        const r = structural(content, 'row', mode, at, count, warnings, evalOpts?.sheetName)
        structs.push({ axis: 'row', mode, at, count })
        results.push({ op: o.op, at: at + 1, count, moved_cells: r.moved })
        break
      }
      case 'insert_cols': case 'delete_cols': {
        const at = needColAt(o, idx), count = needCount(o, idx)
        const mode = o.op === 'insert_cols' ? 'insert' : 'delete'
        const r = structural(content, 'col', mode, at, count, warnings, evalOpts?.sheetName)
        structs.push({ axis: 'col', mode, at, count })
        results.push({ op: o.op, at: indexToCol(at), count, moved_cells: r.moved })
        break
      }
      case 'merge': {
        const a = needRange(o, idx)
        if (a.kind === 'cols' || a.kind === 'rows') throw new OpError(`ops[${idx}].range: merge needs a bounded range like A1:C1`)
        if (area(a.rect) < 2) throw new OpError(`ops[${idx}]: a merge needs at least 2 cells`)
        const tl = cellKey(a.rect.r0, a.rect.c0)
        let discarded = 0
        for (let r = a.rect.r0; r <= a.rect.r1; r++) for (let c = a.rect.c0; c <= a.rect.c1; c++) {
          const k = cellKey(r, c)
          if (k === tl || !cells[k]) continue
          if (hasValue(cells[k])) discarded++
          const { s } = cells[k]
          if (s) cells[k] = { s }; else delete cells[k]
        }
        const before = (content.merges ?? []).length
        content.merges = addMerge(content.merges ?? [], a.rect)
        const replaced = before + 1 - content.merges.length
        if (discarded) warnings.push(`ops[${idx}]: merging ${rectToA1(a.rect)} kept only the top-left value; ${discarded} other value(s) were cleared.`)
        if (replaced) warnings.push(`ops[${idx}]: ${replaced} overlapping merged area(s) were replaced.`)
        results.push({ op: 'merge', range: rectToA1(a.rect), cleared_values: discarded })
        break
      }
      case 'unmerge': {
        const a = needRange(o, idx)
        const before = (content.merges ?? []).length
        content.merges = removeMerges(content.merges ?? [], a.rect)
        const removed = before - content.merges.length
        if (!removed) warnings.push(`ops[${idx}]: no merged cells overlap ${String(o.range)}.`)
        results.push({ op: 'unmerge', range: String(o.range), removed })
        break
      }
      case 'sort': {
        const a = needRange(o, idx)
        let rect = a.rect
        if (a.kind === 'cols' || a.kind === 'rows') {
          const used = usedRange(content)
          const clipped = used ? intersect(a.rect, used) : null
          if (!clipped) { results.push({ op: 'sort', range: String(o.range), rows: 0 }); break }
          rect = clipped
        }
        if ((content.merges ?? []).some(m => { const r = parseRange(m); return !!r && rectsOverlap(r, rect) })) throw new OpError(`ops[${idx}]: ${rectToA1(rect)} contains merged cells — unmerge them first to sort`)
        if (!Array.isArray(o.by) || o.by.length === 0 || o.by.length > 3) throw new OpError(`ops[${idx}].by must list 1–3 sort keys like [{"column":"B"}]`)
        const keys = (o.by as unknown[]).map((b, j) => {
          const x = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
          if (typeof x.column !== 'string' || !/^[A-Za-z]{1,3}$/.test(x.column.trim())) throw new OpError(`ops[${idx}].by[${j}].column must be a column letter`)
          const c = colToIndex(x.column.trim())
          if (c < rect.c0 || c > rect.c1) throw new OpError(`ops[${idx}].by[${j}].column ${x.column} is outside ${rectToA1(rect)}`)
          if (x.descending !== undefined && typeof x.descending !== 'boolean') throw new OpError(`ops[${idx}].by[${j}].descending must be true or false`)
          return { c, desc: x.descending === true }
        })
        if (o.has_header !== undefined && typeof o.has_header !== 'boolean') throw new OpError(`ops[${idx}].has_header must be true or false`)
        const start = rect.r0 + (o.has_header === true ? 1 : 0)
        if (start > rect.r1) { results.push({ op: 'sort', range: rectToA1(rect), rows: 0 }); break }
        const ev = new SheetEvaluator(cells, content.merges, evalOpts)
        const rowsData: Array<{ src: number; keys: SortKey[]; cells: Map<number, CellData> }> = []
        for (let r = start; r <= rect.r1; r++) {
          const m = new Map<number, CellData>()
          for (let c = rect.c0; c <= rect.c1; c++) { const cd = cells[cellKey(r, c)]; if (cd) m.set(c, cd) }
          rowsData.push({ src: r, keys: keys.map(k => sortKeyOf(ev.value(cellKey(r, k.c)))), cells: m })
        }
        const sorted = rowsData.map((x, i) => ({ x, i })).sort((p, q) => {
          for (let j = 0; j < keys.length; j++) { const d = compareKeys(p.x.keys[j], q.x.keys[j], keys[j].desc); if (d) return d }
          return p.i - q.i
        }).map(p => p.x)
        let broken = 0, movedRows = 0
        for (let r = start; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) delete cells[cellKey(r, c)]
        sorted.forEach((row, i) => {
          const target = start + i
          if (row.src !== target) movedRows++
          for (const [c, cd] of row.cells) {
            const copy: CellData = { ...cd }
            if (copy.f) { const s = shiftRefsForMove(copy.f, target - row.src); copy.f = s.f; broken += s.broken }
            cells[cellKey(target, c)] = copy
          }
        })
        if (broken) warnings.push(`ops[${idx}]: ${broken} relative reference(s) moved off the sheet and now read #REF!.`)
        const imgs = (content.images ?? []).filter(im => { const p = keyPos(im.cell); return !!p && rectContains({ ...rect, r0: start }, p.r, p.c) }).length
        if (imgs) warnings.push(`ops[${idx}]: ${imgs} floating image(s) in the sorted rows stay where they were (images don't move with sorting).`)
        results.push({ op: 'sort', range: rectToA1({ ...rect, r0: start }), rows: sorted.length, moved_rows: movedRows })
        break
      }
      case 'add_image': {
        const images = content.images ?? []
        if (images.length >= IMAGES_MAX) throw new OpError(`ops[${idx}]: a sheet holds at most ${IMAGES_MAX} images`)
        const url = typeof o.url === 'string' ? o.url.trim() : ''
        if (!/^https?:\/\/\S{1,2000}$/.test(url)) throw new OpError(`ops[${idx}].url must be an http(s) URL`)
        const cell = imgCell(o.cell, idx)
        const w = imgSide(o.w, idx, 'w') ?? 200, h = imgSide(o.h, idx, 'h') ?? 150
        const ox = imgOff(o.ox, idx, 'ox'), oy = imgOff(o.oy, idx, 'oy')
        const mode = imgMode(o.mode, idx) ?? 'float'
        const id = newImageId(images)
        let next: SheetImage[] = [...images, { id, url, cell, w, h, ox: ox ?? 0, oy: oy ?? 0 }]
        if (mode !== 'float') next = applyImageMode(next, id, mode)
        const bumped = mode === 'in_cell' ? images.filter(im => im.inCell && im.cell === cell).map(im => im.id) : []
        content.images = next
        const put = next.find(im => im.id === id)!
        results.push({ op: 'add_image', id, cell, mode, w: put.w, h: put.h, ...(mode === 'in_cell' ? {} : { ox: put.ox ?? 0, oy: put.oy ?? 0 }) })
        if (bumped.length) warnings.push(`ops[${idx}]: ${cell} already had an in-cell image (${bumped.join(', ')}); it now floats over the cell instead (one in-cell image per cell).`)
        break
      }
      case 'update_image': case 'delete_image': {
        const id = typeof o.id === 'string' ? o.id.trim() : ''
        let images = content.images ?? []
        if (!id || !images.some(im => im.id === id)) throw new OpError(`ops[${idx}].id: no image "${id}" on this sheet (get_sheet lists image ids)`, 'err_sheet_image_not_found')
        if (o.op === 'delete_image') {
          content.images = images.filter(im => im.id !== id)
          results.push({ op: 'delete_image', id })
          break
        }
        const cell = o.cell === undefined || o.cell === null ? undefined : imgCell(o.cell, idx)
        let w = imgSide(o.w, idx, 'w'), h = imgSide(o.h, idx, 'h')
        const ox = imgOff(o.ox, idx, 'ox'), oy = imgOff(o.oy, idx, 'oy')
        const mode = imgMode(o.mode, idx)
        // 只给一边 ⇒ 另一边照原比例跟着变·两边都给才照给的
        { const old = images.find(im => im.id === id)!
          const fit = (v: number) => Math.max(IMAGE_SIDE_MIN, Math.min(IMAGE_SIDE_MAX, Math.round(v)))
          const inRange = (v: number) => v >= IMAGE_SIDE_MIN && v <= IMAGE_SIDE_MAX
          // N4：派生边越界时 ⛔ 只夹那一边（比例就变了）——两边一起缩放到能放下·回包警告写实际尺寸
          if (w !== undefined && h === undefined && old.w > 0) {
            const hh = w * old.h / old.w
            if (inRange(Math.round(hh))) h = Math.round(hh)
            else { const want = w; h = fit(hh); w = fit(h * old.w / old.h); warnings.push(`ops[${idx}]: keeping ${id}'s proportions, width ${want} would make the height go past ${IMAGE_SIDE_MIN}–${IMAGE_SIDE_MAX}, so it was set to ${w}×${h}.`) }
          } else if (h !== undefined && w === undefined && old.h > 0) {
            const ww = h * old.w / old.h
            if (inRange(Math.round(ww))) w = Math.round(ww)
            else { const want = h; w = fit(ww); h = fit(w * old.h / old.w); warnings.push(`ops[${idx}]: keeping ${id}'s proportions, height ${want} would make the width go past ${IMAGE_SIDE_MIN}–${IMAGE_SIDE_MAX}, so it was set to ${w}×${h}.`) }
          } }
        const order = o.order === undefined || o.order === null ? undefined : (Z_MOVES.includes(o.order as ZMove) ? o.order as ZMove : (() => { throw new OpError(`ops[${idx}].order must be one of ${Z_MOVES.join(', ')}`) })())
        if (cell === undefined && w === undefined && h === undefined && ox === undefined && oy === undefined && !mode && !order) throw new OpError(`ops[${idx}]: give at least one of cell, w, h, ox, oy, mode, order`)
        images = images.map(im => im.id === id ? { ...im, ...(cell ? { cell } : {}), ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}), ...(ox !== undefined ? { ox } : {}), ...(oy !== undefined ? { oy } : {}) } : im)
        // 搬进别格而本来就是格内图 ⇒ 那格原有的格内图移出来（一格一张）
        const cur = images.find(im => im.id === id)!
        if (cur.inCell && cell && (!mode || mode === 'in_cell')) images = images.map(im => (im.id !== id && im.inCell && im.cell === cell ? (({ inCell: _q, ...r }) => r as SheetImage)(im) : im))
        if (mode) images = applyImageMode(images, id, mode)
        if (order) images = moveImageZ(images, id, order)
        // 格内图不带偏移（同网页「放进格子」清 ox／oy）·已在格内又给偏移也不存 ⇒ 存的与回的一致
        images = images.map(im => (im.id === id && im.inCell ? (({ ox: _x, oy: _y, ...r }) => r as SheetImage)(im) : im))
        content.images = images
        const now = images.find(im => im.id === id)!
        const nowMode: ImageMode = now.inCell ? 'in_cell' : now.plane === 'below' ? 'below' : 'float'
        if (nowMode === 'in_cell' && (ox !== undefined || oy !== undefined)) warnings.push(`ops[${idx}]: ${id} sits inside its cell, so ox/oy do not apply and were not saved (it starts at offset 0 if it floats again).`)
        if (nowMode === 'in_cell' && (w !== undefined || h !== undefined)) warnings.push(`ops[${idx}]: ${id} sits inside its cell and fills it — w/h are saved for when it floats again; to make it look bigger here, use resize (set_sheet_dimensions) on its row/column.`)
        results.push({ op: 'update_image', id, cell: now.cell, mode: nowMode, w: now.w, h: now.h, ...(nowMode === 'in_cell' ? {} : { ox: now.ox ?? 0, oy: now.oy ?? 0 }), layer_index: images.filter(im => (im.inCell ? 'in_cell' : im.plane === 'below' ? 'below' : 'float') === nowMode).findIndex(im => im.id === id) })
        break
      }
      case 'resize': {
        // 设列宽行高：range 定哪几列／行·width 改列宽·height 改行高·null ⇒ 回预设；
        //   fit_images ⇒ 区内每张格内图把它那列宽／那行高撑到图的大小（超上限等比缩·只撑大不缩小·同列／同行取最大）
        // N1：说明写的「B」（单列）／「5」（单行）也收——补成 B:B／5:5 再解析（只这一 op·别的 op 照旧要完整 A1）
        //   补形抽成 expandBareColRow·opSheetNames 辨页签同用
        const a = needRange(typeof o.range === 'string' ? { ...o, range: expandBareColRow(o.range) } : o, idx)
        const sz = (v: unknown, name: string, lo: number, hi: number): number | null | undefined => {
          if (v === undefined) return undefined
          if (v === null) return null
          if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new OpError(`ops[${idx}].${name} must be ${lo}–${hi} pixels (or null for the default)`)
          return Math.round(v)
        }
        const width = sz(o.width, 'width', COL_W_MIN, COL_W_MAX), height = sz(o.height, 'height', ROW_H_MIN, ROW_H_MAX)
        if (o.fit_images !== undefined && typeof o.fit_images !== 'boolean') throw new OpError(`ops[${idx}].fit_images must be true or false`)
        const fitImgs = o.fit_images === true
        if (width === undefined && height === undefined && !fitImgs) throw new OpError(`ops[${idx}]: give width, height or fit_images`)
        if (width !== undefined && a.kind === 'rows') throw new OpError(`ops[${idx}]: width needs columns (e.g. "B:D" or "B2:D5"), not whole rows`)
        if (height !== undefined && a.kind === 'cols') throw new OpError(`ops[${idx}]: height needs rows (e.g. "2:5" or "B2:D5"), not whole columns`)
        const span = (lo: number, hi: number) => { const n = hi - lo + 1; if (n > STRUCT_COUNT_MAX) throw new OpError(`ops[${idx}]: at most ${STRUCT_COUNT_MAX} columns/rows per resize`); return Array.from({ length: n }, (_, i) => lo + i) }
        const out: OpResult = { op: 'resize', range: rectToA1(a.rect) }
        if (a.kind === 'cols' || a.kind === 'rows') out.range = String(o.range).trim().replace(/^.*!/, '').replace(/\$/g, '').toUpperCase()
        // N2：存档净化只收列宽 2000 笔／行高 5000 笔（layout sanitize*）——超了后面的会被悄悄丢 ⇒ 整笔拒、⛔ 回「已设」
        const capCheck = (m: Record<string, number> | undefined, cap: number, what: string) => {
          if (m && Object.keys(m).length > cap) throw new OpError(`ops[${idx}]: a sheet can keep at most ${cap} custom ${what}; this would make ${Object.keys(m).length} — use a smaller range, or set some back to the default (null) first`)
        }
        if (width !== undefined) { const next = setColWidths(content.colWidths, span(a.rect.c0, a.rect.c1), width); capCheck(next, SIZES_MAX_COLS, 'column widths'); content.colWidths = next; if (!content.colWidths) delete content.colWidths; out.width = width }
        if (height !== undefined) { const next = setRowHeights(content.rowHeights, span(a.rect.r0, a.rect.r1), height); capCheck(next, SIZES_MAX_ROWS, 'row heights'); content.rowHeights = next; if (!content.rowHeights) delete content.rowHeights; out.height = height }
        if (fitImgs) {
          const colNeed = new Map<number, number>(), rowNeed = new Map<number, number>()
          for (const im of content.images ?? []) {
            const p = im.inCell ? keyPos(im.cell) : null
            if (!p || !rectContains(a.rect, p.r, p.c)) continue
            const k = Math.min(1, COL_W_MAX / im.w, ROW_H_MAX / im.h)
            colNeed.set(p.c, Math.max(colNeed.get(p.c) ?? 0, Math.round(im.w * k)))
            rowNeed.set(p.r, Math.max(rowNeed.get(p.r) ?? 0, Math.round(im.h * k)))
          }
          const cw: Record<string, number> = {}, rh: Record<string, number> = {}
          for (const [c, need] of colNeed) { const cur = content.colWidths?.[indexToCol(c)]; if (need > (typeof cur === 'number' ? cur : COL_W_DEFAULT)) { content.colWidths = setColWidths(content.colWidths, [c], need); cw[indexToCol(c)] = content.colWidths?.[indexToCol(c)] ?? need } }
          for (const [r, need] of rowNeed) { const cur = content.rowHeights?.[String(r + 1)]; if (need > (typeof cur === 'number' ? cur : ROW_H_DEFAULT)) { content.rowHeights = setRowHeights(content.rowHeights, [r], need); rh[String(r + 1)] = content.rowHeights?.[String(r + 1)] ?? need } }
          // F2（原 N2 的 fit 分支）：撑出来的新键也算进 2000 列宽／5000 行高总帽——超了整笔拒（抛在 cloneContent 上·route 400 零写）
          //   ⛔ 先回 fitted_* 再让存档净化悄悄截尾（回「已撑」却没存全）
          capCheck(content.colWidths, SIZES_MAX_COLS, 'column widths'); capCheck(content.rowHeights, SIZES_MAX_ROWS, 'row heights')
          out.fitted_col_widths = cw; out.fitted_row_heights = rh
          if (!colNeed.size) warnings.push(`ops[${idx}]: fit_images found no in-cell image in ${out.range} (floating images keep their own size and don't need room).`)
        }
        results.push(out)
        break
      }
      // 图表：建／改／删（纯函数在 ./chart.ts·坏参转成 OpError ⇒ route 400 零写）
      case 'set_chart': case 'delete_chart': {
        try {
          const r = applyChartOp(content, o, idx)
          content.charts = r.charts
          results.push(r.result as OpResult); warnings.push(...r.warnings)
        } catch (e) { if (e instanceof ChartOpError) throw new OpError(e.message, e.code); throw e }
        break
      }
      case 'cond_format': {
        // 条件格式：新增／改（rule_id）／清（clear）·规矩全在 cond-format.ts applyCondChange（网页小面板同一份）
        try {
          const r = applyCondChange(content.condFormats, condChangeFromOp(o))
          content.condFormats = r.rules
          results.push({ op: 'cond_format', ...r.result })
          for (const w of r.warnings) warnings.push(`ops[${idx}]: ${w}`)
        } catch (e) {
          if (e instanceof CondInputError) throw new OpError(`ops[${idx}]: ${e.message}`, /no conditional format rule/.test(e.message) ? 'err_sheet_cond_not_found' : 'err_sheet_bad_op')
          throw e
        }
        break
      }
      // 冻结筛选验证：freeze／filter／validate（纯函数在 ./sheet-view.ts·错一律转 OpError ⇒ route 400 零写）
      case 'find': case 'replace': {
        if (typeof o.find !== 'string' || o.find === '') throw new OpError(`ops[${idx}].find must be the text to look for (wildcards * ? work; ~* finds a real *)`)
        if (o.find.length > 255) throw new OpError(`ops[${idx}].find: at most 255 characters`)
        const bool = (k: string): boolean | undefined => { if (o[k] === undefined || o[k] === null) return undefined; if (typeof o[k] !== 'boolean') throw new OpError(`ops[${idx}].${k} must be true or false`); return o[k] as boolean }
        let rect: Rect | null = null
        if (o.range !== undefined && o.range !== null) { const a = needRange(o, idx); rect = clipToExtent(a, content); if (!rect) { results.push({ op: o.op, range: String(o.range), found: 0, ...(o.op === 'replace' ? { replaced: 0, changed_cells: [] } : { matches: [] }) }); break } }
        const common = { find: o.find, matchCase: bool('match_case'), wholeCell: bool('whole_cell'), rect }
        if (o.op === 'find') {
          if (o.look_in !== undefined && o.look_in !== 'formulas' && o.look_in !== 'values') throw new OpError(`ops[${idx}].look_in must be "formulas" (what was typed, formulas as text) or "values" (what the cell shows)`)
          const got = findCells(content, { ...common, lookIn: (o.look_in ?? 'formulas') as FindLookIn }, evalOpts)
          results.push({ op: 'find', ...(rect ? { range: rectToA1(rect) } : {}), found: got.total, matches: got.hits.slice(0, FIND_RESULT_MAX).map(h => ({ cell: h.cell, text: h.text })) })
          if (got.total > FIND_RESULT_MAX) warnings.push(`ops[${idx}]: ${got.total} cells matched; only the first ${FIND_RESULT_MAX} are listed — narrow it with range.`)
          break
        }
        if (typeof o.replace !== 'string') throw new OpError(`ops[${idx}].replace must be the new text ("" deletes the match)`)
        if (o.replace.length > CELL_TEXT_MAX) throw new OpError(`ops[${idx}].replace: text longer than ${CELL_TEXT_MAX} characters`)
        const r = replaceCells(content, { ...common, replace: o.replace, includeFormulas: bool('include_formulas') })
        if (r.changed.some(x => x.after.length > CELL_TEXT_MAX)) throw new OpError(`ops[${idx}]: a replaced cell would be longer than ${CELL_TEXT_MAX} characters`)
        content.cells = r.cells
        if (r.skippedFormulas) warnings.push(`ops[${idx}]: ${r.skippedFormulas} formula cell(s) also matched and were left as is (set include_formulas: true to change formula text too).`)
        results.push({ op: 'replace', ...(rect ? { range: rectToA1(rect) } : {}), replaced: r.changed.length, changed_cells: r.changed.slice(0, FIND_RESULT_MAX).map(x => x.cell), skipped_formulas: r.skippedFormulas })
        break
      }
      case 'dedupe': {
        const a = needRange(o, idx)
        let rect = a.rect
        if (a.kind === 'cols' || a.kind === 'rows') { const used = usedRange(content); const clipped = used ? intersect(a.rect, used) : null; if (!clipped) { results.push({ op: 'dedupe', range: String(o.range), removed: 0, kept: 0 }); break } rect = clipped }
        if (o.has_header !== undefined && typeof o.has_header !== 'boolean') throw new OpError(`ops[${idx}].has_header must be true or false`)
        let cols: number[] | undefined
        if (o.columns !== undefined && o.columns !== null) {
          if (!Array.isArray(o.columns) || !o.columns.length) throw new OpError(`ops[${idx}].columns must be a list of column letters like ["A","C"]`)
          cols = (o.columns as unknown[]).map((x, j) => {
            if (typeof x !== 'string' || !/^\s*[A-Za-z]{1,3}\s*$/.test(x)) throw new OpError(`ops[${idx}].columns[${j}] must be a column letter`)
            const c = colToIndex(x.trim())
            if (c < rect.c0 || c > rect.c1) throw new OpError(`ops[${idx}].columns[${j}] ${x} is outside ${rectToA1(rect)}`)
            return c
          })
        }
        let r
        try { r = removeDuplicates(content, rect, { columns: cols, hasHeader: o.has_header === true }, evalOpts) } catch (e) { if (e instanceof DataToolError) throw new OpError(`ops[${idx}]: ${e.message}`, e.code); throw e }
        content.cells = r.cells
        if (r.brokenRefs) warnings.push(`ops[${idx}]: ${r.brokenRefs} relative reference(s) moved off the sheet and now read #REF!.`)
        const imgs = r.removed ? (content.images ?? []).filter(im => { const p = keyPos(im.cell); return !!p && rectContains(rect, p.r, p.c) }).length : 0
        if (imgs) warnings.push(`ops[${idx}]: ${imgs} floating image(s) in the range stay where they were (images don't move with the rows).`)
        results.push({ op: 'dedupe', range: rectToA1(rect), compared_columns: (cols ?? Array.from({ length: rect.c1 - rect.c0 + 1 }, (_, i) => rect.c0 + i)).map(c => indexToCol(c)), removed: r.removed, kept: r.kept, removed_rows: r.removedRows.slice(0, FIND_RESULT_MAX).map(x => x + 1) })
        break
      }
      case 'freeze': case 'filter': case 'validate': case 'hide': {
        try { results.push(applyViewOp(content, o, idx, { parseA1, usedRange }, warnings)) } catch (e) { if (e instanceof SheetViewError) throw new OpError(e.message, e.code); throw e }
        break
      }
      default:
        throw new OpError(`ops[${idx}].op must be one of ${OP_NAMES.join(', ')}`)
    }
  })

  const ext = usedRange(content)
  if (ext && (ext.r1 >= EDITOR_VISIBLE_ROWS || ext.c1 >= EDITOR_VISIBLE_COLS)) {
    warnings.push(`note: the web editor currently shows A1:${indexToCol(EDITOR_VISIBLE_COLS - 1)}${EDITOR_VISIBLE_ROWS}; data outside it (this sheet reaches ${rectToA1(ext)}) is saved but not visible there yet.`)
  }
  if (!(content.merges ?? []).length) delete content.merges
  if (!(content.images ?? []).length) delete content.images
  if (!(content.charts ?? []).length) delete content.charts   // 图表
  if (!(content.condFormats ?? []).length) delete content.condFormats   // 条件格式
  return { content, results, warnings, structs }
}

/** 一张 sheet 的摘要（有值区／有值格数／合并区数·route 回报用） */
export function summarizeContent(content: AgentContent | null | undefined): { used_range: string | null; cells: number; merges: number } {
  const u = usedRange(content)
  return { used_range: u ? rectToA1(u) : null, cells: Object.values(content?.cells ?? {}).filter(hasValue).length, merges: (content?.merges ?? []).length }
}
