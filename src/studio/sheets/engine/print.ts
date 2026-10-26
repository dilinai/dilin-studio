// 表格「列印」：设定的形状与净化＋分页计算（Excel 版面设定同口径）
//   ⛔ 不碰库、不碰 React：网页列印对话框（ui/SheetPrintDialog）、服务端净化闸（content.ts sanitizeSheetContent）、AI 读表（agent-ops readRange 回 print）、
//   xlsx 写读（./print-xlsx.ts）同调这一份。
//
//   资料形状（存在每张 sheet 的 content.print·跟 cells／freeze 同层·每张分页各一份；没有这键 ⇒ 全照 PRINT_DEFAULTS）：
//     scope        'sheet'（整张表·有东西的外框）｜'selection'（列印那一刻的选取）｜'range'（range 指定的区间，如 A1:F30）
//     paper        A4｜A3｜Letter｜Legal｜B5（JIS B5 182×257mm·Excel paperSize 13）；orientation portrait｜landscape
//     marginPreset normal｜narrow｜wide｜custom；margins＝上下左右＋页首页尾距离（公分）·非 custom 时一律照预设值
//     scaleMode    none（100%）｜fitSheet（整张塞进一页）｜fitCols（所有栏塞进一页宽）｜fitRows（所有列塞进一页高）｜custom（scale＝10–400%）
//     titleRows    每页重复的标题列，如 "1:1"、"1:2"；titleCols 每页重复的标题栏，如 "A:A"
//     gridlines／headings（印 A B C／1 2 3）／hCenter／vCenter
//     header／footer 各三格 { l, c, r }：sheet（工作表名）｜title（文件标题）｜page（第 n 页／共 m 页）｜date（列印日期）
//   分页口径（Excel）：
//     - 「塞进一页」只缩不放（最多 100%）·最小 10%
//     - 先往下再往右（Down, then over）
//     - 标题列／栏：那一页的第一列在标题列之后（标题不在这页上）才在页顶补印；标题本身不算进被分页的列
//     - 被筛选藏起来的列不印；列高／栏宽照存的像素（没设＝预设 28／96）
//   单位：CSS 像素（96 DPI）·1 公分＝96/2.54 像素

import { cellKey, colToIndex, indexToCol } from './formula'
import { colWidthOf, rowHeightOf } from './layout'
import { parseRange, type Rect } from './style'
import { parseRect, hiddenRowSet, type ViewContent } from './sheet-view'

// ── 型别与常数 ─────────────────────────────────────────────────────────────

export const PAPER_IDS = ['A4', 'A3', 'Letter', 'Legal', 'B5'] as const
export type PaperId = typeof PAPER_IDS[number]
/** 纸张尺寸（直式·公分） */
export const PAPER_CM: Record<PaperId, { w: number; h: number }> = {
  A4: { w: 21, h: 29.7 }, A3: { w: 29.7, h: 42 }, Letter: { w: 21.59, h: 27.94 }, Legal: { w: 21.59, h: 35.56 }, B5: { w: 18.2, h: 25.7 },
}
export type PrintOrientation = 'portrait' | 'landscape'
export const MARGIN_PRESETS = ['normal', 'narrow', 'wide', 'custom'] as const
export type MarginPreset = typeof MARGIN_PRESETS[number]
export type PrintMargins = { top: number; bottom: number; left: number; right: number; header: number; footer: number }
/** Excel 三种预设边界（英寸换公分：0.75″＝1.91·0.7″＝1.78·0.25″＝0.64·0.3″＝0.76·1″＝2.54·0.5″＝1.27） */
export const MARGIN_PRESET_CM: Record<Exclude<MarginPreset, 'custom'>, PrintMargins> = {
  normal: { top: 1.91, bottom: 1.91, left: 1.78, right: 1.78, header: 0.76, footer: 0.76 },
  narrow: { top: 1.91, bottom: 1.91, left: 0.64, right: 0.64, header: 0.76, footer: 0.76 },
  wide: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54, header: 1.27, footer: 1.27 },
}
export const MARGIN_MAX_CM = 10
export const SCALE_MODES = ['none', 'fitSheet', 'fitCols', 'fitRows', 'custom'] as const
export type ScaleMode = typeof SCALE_MODES[number]
export const SCALE_MIN = 10
export const SCALE_MAX = 400
export const HF_ITEMS = ['sheet', 'title', 'page', 'date'] as const
export type HFItem = typeof HF_ITEMS[number]
export type HFSlots = { l?: HFItem; c?: HFItem; r?: HFItem }
export const PRINT_SCOPES = ['sheet', 'selection', 'range'] as const
export type PrintScope = typeof PRINT_SCOPES[number]

export type SheetPrint = {
  scope: PrintScope
  range?: string
  paper: PaperId
  orientation: PrintOrientation
  marginPreset: MarginPreset
  margins: PrintMargins
  scaleMode: ScaleMode
  /** 百分比（scaleMode＝custom 才用） */
  scale: number
  titleRows?: string
  titleCols?: string
  gridlines: boolean
  headings: boolean
  hCenter: boolean
  vCenter: boolean
  header: HFSlots
  footer: HFSlots
}

export const PRINT_DEFAULTS: SheetPrint = {
  scope: 'sheet', paper: 'A4', orientation: 'portrait', marginPreset: 'normal', margins: { ...MARGIN_PRESET_CM.normal },
  scaleMode: 'none', scale: 100, gridlines: false, headings: false, hCenter: false, vCenter: false, header: {}, footer: {},
}

/** 列印时印出的栏列标题尺寸（headings＝true） */
export const HEADING_W = 36
export const HEADING_H = 20
export const PX_PER_CM = 96 / 2.54
export const cmToPx = (cm: number) => cm * PX_PER_CM

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const round2 = (n: number) => Math.round(n * 100) / 100

// ── 标题列／栏 A1 ──────────────────────────────────────────────────────────

/** "1:2"／"$1:$2"／"3" ⇒ 0 起的列区间（坏的 ⇒ null） */
export function parseRowSpan(s: unknown): { r0: number; r1: number } | null {
  if (typeof s !== 'string') return null
  const m = /^\s*\$?(\d{1,6})\s*(?::\s*\$?(\d{1,6}))?\s*$/.exec(s.replace(/^.*!/, ''))
  if (!m) return null
  const a = Number(m[1]) - 1, b = Number(m[2] ?? m[1]) - 1
  if (a < 0 || b < 0) return null
  return { r0: Math.min(a, b), r1: Math.max(a, b) }
}
/** "A:B"／"$A:$B"／"C" ⇒ 0 起的栏区间（坏的 ⇒ null） */
export function parseColSpan(s: unknown): { c0: number; c1: number } | null {
  if (typeof s !== 'string') return null
  const m = /^\s*\$?([A-Za-z]{1,3})\s*(?::\s*\$?([A-Za-z]{1,3}))?\s*$/.exec(s.replace(/^.*!/, ''))
  if (!m) return null
  const a = colToIndex(m[1].toUpperCase()), b = colToIndex((m[2] ?? m[1]).toUpperCase())
  return { c0: Math.min(a, b), c1: Math.max(a, b) }
}
export const rowSpanText = (x: { r0: number; r1: number }) => `${x.r0 + 1}:${x.r1 + 1}`
export const colSpanText = (x: { c0: number; c1: number }) => `${indexToCol(x.c0)}:${indexToCol(x.c1)}`

// ── 净化（服务端存库前·网页套用前·xlsx 读回后同一份）：坏的栏位回默认·⛔ 整份拒 ──

function cleanSlots(input: unknown): HFSlots {
  const out: HFSlots = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  const x = input as Record<string, unknown>
  for (const k of ['l', 'c', 'r'] as const) if (has(HF_ITEMS, x[k])) out[k] = x[k] as HFItem
  return out
}

export function sanitizePrint(input: unknown): SheetPrint | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const x = input as Record<string, unknown>
  const d = PRINT_DEFAULTS
  const out: SheetPrint = { ...d, margins: { ...d.margins }, header: {}, footer: {} }
  const r = parseRect(x.range)
  if (r) out.range = `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}`
  out.scope = has(PRINT_SCOPES, x.scope) ? x.scope : d.scope
  if (out.scope === 'range' && !out.range) out.scope = 'sheet'
  if (has(PAPER_IDS, x.paper)) out.paper = x.paper
  if (x.orientation === 'landscape' || x.orientation === 'portrait') out.orientation = x.orientation
  out.marginPreset = has(MARGIN_PRESETS, x.marginPreset) ? x.marginPreset : d.marginPreset
  if (out.marginPreset === 'custom') {
    const m = (x.margins && typeof x.margins === 'object' ? x.margins : {}) as Record<string, unknown>
    for (const k of ['top', 'bottom', 'left', 'right', 'header', 'footer'] as const) {
      const v = num(m[k])
      out.margins[k] = v === null ? MARGIN_PRESET_CM.normal[k] : round2(Math.max(0, Math.min(MARGIN_MAX_CM, v)))
    }
  } else out.margins = { ...MARGIN_PRESET_CM[out.marginPreset] }
  out.scaleMode = has(SCALE_MODES, x.scaleMode) ? x.scaleMode : d.scaleMode
  const sc = num(x.scale)
  out.scale = sc === null ? 100 : Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, sc)))
  const tr = parseRowSpan(x.titleRows); if (tr) out.titleRows = rowSpanText(tr)
  const tc = parseColSpan(x.titleCols); if (tc) out.titleCols = colSpanText(tc)
  for (const k of ['gridlines', 'headings', 'hCenter', 'vCenter'] as const) out[k] = x[k] === true
  out.header = cleanSlots(x.header)
  out.footer = cleanSlots(x.footer)
  return out
}

/** 这张表现在的列印设定（没存过 ⇒ 默认） */
export function resolvePrint(content: { print?: unknown } | null | undefined): SheetPrint {
  return sanitizePrint(content?.print) ?? { ...PRINT_DEFAULTS, margins: { ...PRINT_DEFAULTS.margins }, header: {}, footer: {} }
}

// ── 列印范围 ───────────────────────────────────────────────────────────────

type PrintContent = ViewContent & { print?: unknown }

/** 「整张表」要印的外框：有值／有公式／有底色或框线的格＋合并区＋图片盖到的格；全空 ⇒ null */
export function printUsedRect(content: PrintContent | null | undefined): Rect | null {
  let out: Rect | null = null
  const add = (r: Rect) => { out = out ? { r0: Math.min(out.r0, r.r0), r1: Math.max(out.r1, r.r1), c0: Math.min(out.c0, r.c0), c1: Math.max(out.c1, r.c1) } : { ...r } }
  for (const [k, cd] of Object.entries(content?.cells ?? {})) {
    const filled = (typeof cd?.v === 'string' && cd.v !== '') || !!cd?.f || !!cd?.s?.bg || !!(cd?.s?.border && Object.keys(cd.s.border).length)
    if (!filled) continue
    const r = parseRect(k); if (r) add(r)
  }
  for (const m of content?.merges ?? []) { const r = parseRange(m); if (r) add(r) }
  for (const im of content?.images ?? []) {
    const a = parseRect(im.cell); if (!a) continue
    if (im.inCell) { add(a); continue }
    // 浮图：从锚格起往右／往下量到图的右下角落在哪一格
    let c = a.c0, x = colWidthOf(content?.colWidths, c)
    const right = (im.ox ?? 0) + im.w
    while (x < right && c < a.c0 + 200) { c++; x += colWidthOf(content?.colWidths, c) }
    let r = a.r0, y = rowHeightOf(content?.rowHeights, r)
    const bottom = (im.oy ?? 0) + im.h
    while (y < bottom && r < a.r0 + 2000) { r++; y += rowHeightOf(content?.rowHeights, r) }
    add({ r0: a.r0, c0: a.c0, r1: r, c1: c })
  }
  return out
}

/** 这次要印的区间：range ⇒ 那一块；selection ⇒ 传进来的选取（没给 ⇒ 当整张表）；sheet ⇒ 有东西的外框（全空 ⇒ A1） */
export function printRect(content: PrintContent | null | undefined, setup: SheetPrint, selection?: string | Rect | null): Rect {
  if (setup.scope === 'range') { const r = parseRect(setup.range); if (r) return r }
  if (setup.scope === 'selection' && selection) { const r = typeof selection === 'string' ? parseRect(selection) : selection; if (r) return r }
  return printUsedRect(content) ?? { r0: 0, r1: 0, c0: 0, c1: 0 }
}

// ── 分页 ───────────────────────────────────────────────────────────────────

export type PrintPage = {
  /** 这页印的资料列／栏（0 起·不含补印的标题） */
  rows: number[]
  cols: number[]
  /** 这页页顶补印的标题列／左边补印的标题栏 */
  titleRows: number[]
  titleCols: number[]
  /** 置中位移（未缩放的表格像素·加在内容框左上角） */
  offsetX: number
  offsetY: number
}
export type PrintPlan = {
  /** 纸（像素·已按方向转好） */
  paperW: number
  paperH: number
  /** 边界（像素） */
  margins: PrintMargins
  /** 缩放倍率（1＝100%） */
  scale: number
  /** 内容框在「表格像素」里有多宽多高（＝纸扣边界 ÷ 缩放） */
  areaW: number
  areaH: number
  headW: number
  headH: number
  rect: Rect
  pages: PrintPage[]
  colW: (c: number) => number
  rowH: (r: number) => number
}
export type PlanInput = { content: PrintContent | null | undefined; setup: SheetPrint; rect: Rect; hiddenRows?: Set<number> }

function chunk(list: number[], size: (i: number) => number, titles: number[], titleMax: number, head: number, limit: number): Array<{ items: number[]; titles: number[] }> {
  const out: Array<{ items: number[]; titles: number[] }> = []
  let i = 0
  while (i < list.length) {
    const t = titles.length && list[i] > titleMax ? titles : []
    let used = head + t.reduce((s, x) => s + size(x), 0)
    const items: number[] = []
    while (i < list.length) {
      const s = size(list[i])
      if (items.length && used + s > limit + 0.01) break   // 至少一列／一栏（比整页还大的那条照印、被裁）
      items.push(list[i]); used += s; i++
    }
    out.push({ items, titles: t })
  }
  return out
}

/** 版面设定 ⇒ 每页印哪些列栏（纯函数·预览与真列印同一份） */
export function planPrint(input: PlanInput): PrintPlan {
  const { content, setup, rect } = input
  const hidden = input.hiddenRows ?? hiddenRowSet(content)   // 手动藏的行＋筛掉的行都不印
  const colW = (c: number) => colWidthOf(content?.colWidths, c)
  const rowH = (r: number) => (hidden.has(r) ? 0 : rowHeightOf(content?.rowHeights, r))
  const paper = PAPER_CM[setup.paper] ?? PAPER_CM.A4
  const land = setup.orientation === 'landscape'
  const paperW = cmToPx(land ? paper.h : paper.w), paperH = cmToPx(land ? paper.w : paper.h)
  const m = setup.margins
  const margins: PrintMargins = { top: cmToPx(m.top), bottom: cmToPx(m.bottom), left: cmToPx(m.left), right: cmToPx(m.right), header: cmToPx(m.header), footer: cmToPx(m.footer) }
  const minArea = cmToPx(1)
  const availW = Math.max(minArea, paperW - margins.left - margins.right)
  const availH = Math.max(minArea, paperH - margins.top - margins.bottom)
  const rows: number[] = [], cols: number[] = []
  for (let r = rect.r0; r <= rect.r1; r++) if (!hidden.has(r)) rows.push(r)
  for (let c = rect.c0; c <= rect.c1; c++) cols.push(c)
  const tr = parseRowSpan(setup.titleRows), tc = parseColSpan(setup.titleCols)
  const titleRows: number[] = [], titleCols: number[] = []
  if (tr) for (let r = tr.r0; r <= tr.r1; r++) if (!hidden.has(r)) titleRows.push(r)
  if (tc) for (let c = tc.c0; c <= tc.c1; c++) titleCols.push(c)
  const headW = setup.headings ? HEADING_W : 0, headH = setup.headings ? HEADING_H : 0
  const totalW = headW + cols.reduce((s, c) => s + colW(c), 0)
  const totalH = headH + rows.reduce((s, r) => s + rowH(r), 0)
  let scale = 1
  switch (setup.scaleMode) {
    case 'custom': scale = setup.scale / 100; break
    case 'fitSheet': scale = Math.min(1, availW / totalW, availH / totalH); break
    case 'fitCols': scale = Math.min(1, availW / totalW); break
    case 'fitRows': scale = Math.min(1, availH / totalH); break
    default: scale = 1
  }
  scale = Math.max(SCALE_MIN / 100, Math.min(SCALE_MAX / 100, scale))
  const areaW = availW / scale, areaH = availH / scale
  const colChunks = chunk(cols, colW, titleCols, tc ? tc.c1 : -1, headW, areaW)
  const rowChunks = chunk(rows, rowH, titleRows, tr ? tr.r1 : -1, headH, areaH)
  const pages: PrintPage[] = []
  for (const cc of colChunks) {
    for (const rc of rowChunks) {
      const usedW = headW + [...cc.titles, ...cc.items].reduce((s, c) => s + colW(c), 0)
      const usedH = headH + [...rc.titles, ...rc.items].reduce((s, r) => s + rowH(r), 0)
      pages.push({
        rows: rc.items, cols: cc.items, titleRows: rc.titles, titleCols: cc.titles,
        offsetX: setup.hCenter ? Math.max(0, (areaW - usedW) / 2) : 0,
        offsetY: setup.vCenter ? Math.max(0, (areaH - usedH) / 2) : 0,
      })
    }
  }
  return { paperW, paperH, margins, scale, areaW, areaH, headW, headH, rect, pages, colW, rowH }
}

// ── 页首页尾 ───────────────────────────────────────────────────────────────

export type HFContext = { sheet: string; title: string; date: string; page: number; pages: number; pageFmt: string }
/** 页首页尾一格的字（pageFmt 例：「第 {n} 頁／共 {m} 頁」） */
export function hfText(item: HFItem | undefined, ctx: HFContext): string {
  switch (item) {
    case 'sheet': return ctx.sheet
    case 'title': return ctx.title
    case 'date': return ctx.date
    case 'page': return ctx.pageFmt.replace('{n}', String(ctx.page)).replace('{m}', String(ctx.pages))
    default: return ''
  }
}
export const hfEmpty = (s: HFSlots) => !s.l && !s.c && !s.r
