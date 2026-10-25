// 表格图表
//   纯函数·网页（ChartLayer.tsx 画 SVG）／服务端净化闸（api/ai-sheet/_shared）／AI 改表 op（agent-ops set_chart／delete_chart）／
//   xlsx 导出（chart-xlsx.ts）／单测 五方同一份。⛔ 不碰库、不碰 React、不加依赖。
//
//   资料：content.charts＝[{ id, type, range, cell, w, h, ox?, oy?, title?, colors?, legend?, labels?, seriesIn? }]
//     type：column 柱状／bar 横条／line 折线／pie 圆饼／doughnut 甜甜圈
//     range：同一张表的 A1 区间（存成 'A1:C9'）·值从求值器拿（公式算好的值）⇒ 格子一改图跟着变
//     cell／ox／oy／w／h：跟浮图同一套（锚格左上＋100% 缩放下的像素偏移·宽高像素）
//     title：省＝自动（只有一个系列且它有名字 ⇒ 用系列名·同 Excel）；''＝不要标题
//     colors：每系列（柱／条／折线）或每扇区（圆饼／甜甜圈）一色·'#rrggbb'·缺的那格用调色盘
//     legend：省＝自动（多系列或圆饼／甜甜圈才显）；labels：数值标签（省＝不显）
//     seriesIn：'columns'｜'rows'·省＝自动（同 Excel：资料行数 ≥ 列数 ⇒ 每列一个系列·否则每行一个系列）
//   层次＝charts 数组顺序（0 最底）；图表整组画在浮图上层图之上（取舍：图表另开数组·不跟 images 混排——
//     images 的净化／导入／导出／三平面规则都按「图」写·混进去每处都要分辨；网页与 xlsx 都是「先图后图表」同一个先后）。
//
//   数据区间规则（照 Excel 预设·写进工具说明）：
//     ① 首行当「表头」（系列名或类别名）：区间至少两行·且首行（除左上格）有任何文字；或左上格空白
//     ② 首列当「标签」：区间至少两列·且首列（除左上格）有任何文字；或左上格空白
//        （单列／单行区间：那唯一一列／行的第一格是文字 ⇒ 当名字）
//     ③ 去掉表头／标签后剩的资料块：行数 ≥ 列数 ⇒ 每列一个系列（首行＝系列名·首列＝类别）；否则每行一个系列（首列＝系列名·首行＝类别）
//     ④ 不是数字的格（文字／空格／错误）当缺值：柱条画 0 高·折线断开·圆饼略过；圆饼／甜甜圈只画第一个系列（Excel 同）

import { cellKey, parseRef, SheetEvaluator, formatValue, isFormulaError, type EvalResult, type SheetContent, type EvaluatorOptions } from './formula'
import { formatWithNumFmt, type NumFmt, type Rect } from './style'

export type ChartType = 'column' | 'bar' | 'line' | 'pie' | 'doughnut'
export const CHART_TYPES: readonly ChartType[] = ['column', 'bar', 'line', 'pie', 'doughnut']
export type ChartSeriesIn = 'columns' | 'rows'
export type SheetChart = {
  id: string; type: ChartType; range: string; cell: string; w: number; h: number
  ox?: number; oy?: number; title?: string; colors?: string[]; legend?: boolean; labels?: boolean; seriesIn?: ChartSeriesIn
}

export const CHARTS_MAX = 20
export const CHART_SIDE_MIN = 120
export const CHART_SIDE_MAX = 4000
export const CHART_OFF_MAX = 4000
export const CHART_TITLE_MAX = 200
export const CHART_COLORS_MAX = 50
/** 数据区间最多几格（再大画不清楚·也防一张图拖垮求值） */
export const CHART_RANGE_MAX_CELLS = 20_000
export const CHART_SERIES_MAX = 50
export const CHART_POINTS_MAX = 1000
/** Excel 插图表的预设大小（5 吋×3 吋＝480×288 px） */
export const CHART_DEFAULT_W = 480
export const CHART_DEFAULT_H = 288
const MAX_ROW = 999998, MAX_COL = 18277

/**
 * 缺省调色盘（dataviz 参考色八色·亮底版·相邻对色盲 ΔE ≥ 8 已验）：蓝／橙／青绿／黄／洋红／绿／紫／红
 * 超过八个 ⇒ 第二轮用同色调的浅一阶（不生新色相）·再多才循环
 */
export const CHART_PALETTE: readonly string[] = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * t)
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255)
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}
export function paletteColor(i: number): string {
  const base = CHART_PALETTE[i % CHART_PALETTE.length]
  return Math.floor(i / CHART_PALETTE.length) % 2 === 1 ? lighten(base, 0.45) : base
}
/** 第 i 个系列／扇区的颜色：自订的有效就用·否则调色盘 */
export function colorAt(ch: Pick<SheetChart, 'colors'>, i: number): string {
  const c = ch.colors?.[i]
  return c && HEX_RE.test(c) ? c : paletteColor(i)
}

// ── 净化 ────────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{6}$/
/** '#abc'／'#AABBCC' ⇒ '#aabbcc'；别的 ⇒ null（xlsx 只收六位十六进位·故不收命名色） */
export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(ch => ch + ch).join('')
  return null
}
const CELL_RE = /^[A-Z]{1,3}\d{1,6}$/
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** 'A1:C9'／'$a$1:$c$9'／'B2'（单格）⇒ 矩形；坏形／越界／太大 ⇒ null（页签前缀由调用方先剥掉） */
export function parseChartRange(s: unknown): Rect | null {
  if (typeof s !== 'string') return null
  const t = s.trim().replace(/\$/g, '').toUpperCase()
  const m = /^([A-Z]{1,3}\d{1,7})(?::([A-Z]{1,3}\d{1,7}))?$/.exec(t)
  if (!m) return null
  const a = parseRef(m[1]), b = parseRef(m[2] ?? m[1])
  if (!a || !b) return null
  const r: Rect = { r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row), c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col) }
  if (r.r1 > MAX_ROW || r.c1 > MAX_COL) return null
  if ((r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) > CHART_RANGE_MAX_CELLS) return null
  return r
}
export const chartRangeKey = (r: Rect) => `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}`

/** 净化 colors：每格有效 hex ⇒ 小写六位·无效／null ⇒ ''（＝用调色盘）·尾巴的空格去掉·全空 ⇒ undefined */
export function sanitizeChartColors(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.slice(0, CHART_COLORS_MAX).map(x => normHex(x) ?? '')
  while (out.length && !out[out.length - 1]) out.pop()
  return out.length ? out : undefined
}

/** 净化 charts（服务端存档闸与网页同一份）：白名单键·坏的整张丢（⛔ 整份拒）·id 去重·顺序＝层次照收 */
export function sanitizeCharts(input: unknown): SheetChart[] {
  if (!Array.isArray(input)) return []
  const out: SheetChart[] = []
  const seen = new Set<string>()
  for (const it of input.slice(0, CHARTS_MAX)) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    const x = it as Record<string, unknown>
    if (typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(x.id) || seen.has(x.id)) continue
    if (typeof x.type !== 'string' || !(CHART_TYPES as readonly string[]).includes(x.type)) continue
    const rect = parseChartRange(x.range)
    if (!rect) continue
    if (typeof x.cell !== 'string' || !CELL_RE.test(x.cell) || !parseRef(x.cell)) continue
    if (!isNum(x.w, CHART_SIDE_MIN, CHART_SIDE_MAX) || !isNum(x.h, CHART_SIDE_MIN, CHART_SIDE_MAX)) continue
    const ch: SheetChart = { id: x.id, type: x.type as ChartType, range: chartRangeKey(rect), cell: x.cell, w: Math.round(x.w), h: Math.round(x.h) }
    if (isNum(x.ox, 0, CHART_OFF_MAX) && Math.round(x.ox)) ch.ox = Math.round(x.ox)
    if (isNum(x.oy, 0, CHART_OFF_MAX) && Math.round(x.oy)) ch.oy = Math.round(x.oy)
    // eslint-disable-next-line no-control-regex
    if (typeof x.title === 'string') ch.title = x.title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, CHART_TITLE_MAX)
    const colors = sanitizeChartColors(x.colors)
    if (colors) ch.colors = colors
    if (typeof x.legend === 'boolean') ch.legend = x.legend
    if (x.labels === true) ch.labels = true
    if (x.seriesIn === 'columns' || x.seriesIn === 'rows') ch.seriesIn = x.seriesIn
    seen.add(ch.id); out.push(ch)
  }
  return out
}

// ── 读数据 ──────────────────────────────────────────────────────────────

export type CellRead = { v: EvalResult; text: string; fmt?: NumFmt }
export type CellReader = (r: number, c: number) => CellRead

/** 一张 sheet 的读格器：值＝求值器算好的（公式也算）·text＝格子里显示的字（套数字格式）·evalOpts 带 book 才算得出跨表引用 */
export function contentReader(content: SheetContent | null | undefined, evalOpts?: EvaluatorOptions): CellReader {
  const cells = content?.cells ?? {}
  const ev = new SheetEvaluator(cells, content?.merges, evalOpts)
  return (r, c) => {
    const k = cellKey(r, c)
    const v = ev.value(k)
    const cd = cells[k]
    const nf = cd?.s?.numFmt
    const shown = isFormulaError(v) ? null : formatWithNumFmt(nf, v, cd?.f ? undefined : cd?.v)
    return { v, text: shown ?? formatValue(v), ...(nf ? { fmt: nf } : {}) }
  }
}

export type ChartSeriesData = {
  name: string
  /** 系列名那一格（没有表头 ⇒ 无） */
  nameCell?: { r: number; c: number }
  /** 数值那一条（一列或一行） */
  valRect: Rect
  values: (number | null)[]
  /** 每个点在格子里显示的字（数值标签用·套了数字格式） */
  texts: string[]
  /** 第一个数值格的数字格式（xlsx numCache formatCode 用） */
  fmt?: NumFmt
}
export type ChartData = {
  categories: string[]
  /** 类别那一条（没有标签 ⇒ 无·类别显示 1、2、3…） */
  catRect?: Rect
  series: ChartSeriesData[]
  seriesIn: ChartSeriesIn
  /** 超过 CHART_SERIES_MAX／CHART_POINTS_MAX 被截 */
  truncated: boolean
}

const isText = (x: CellRead) => typeof x.v === 'string' && x.v !== '' && !isFormulaError(x.v)
const isBlank = (x: CellRead) => x.v === null || x.v === ''

/** 照上面「数据区间规则」把区间拆成类别＋系列；区间坏或去掉表头后没资料 ⇒ null */
export function chartData(ch: Pick<SheetChart, 'range' | 'seriesIn'>, read: CellReader): ChartData | null {
  const rc = parseChartRange(ch.range)
  if (!rc) return null
  const n = rc.r1 - rc.r0 + 1, m = rc.c1 - rc.c0 + 1
  const tlBlank = isBlank(read(rc.r0, rc.c0))
  let headRow = false, headCol = false
  if (n >= 2) {
    if (tlBlank && m >= 2) headRow = true
    else for (let c = m >= 2 ? rc.c0 + 1 : rc.c0; c <= rc.c1 && !headRow; c++) if (isText(read(rc.r0, c))) headRow = true
  }
  if (m >= 2) {
    if (tlBlank && n >= 2) headCol = true
    else for (let r = n >= 2 ? rc.r0 + 1 : rc.r0; r <= rc.r1 && !headCol; r++) if (isText(read(r, rc.c0))) headCol = true
  }
  const dr0 = rc.r0 + (headRow ? 1 : 0), dc0 = rc.c0 + (headCol ? 1 : 0)
  const R = rc.r1 - dr0 + 1, C = rc.c1 - dc0 + 1
  if (R <= 0 || C <= 0) return null
  const seriesIn: ChartSeriesIn = ch.seriesIn ?? (R >= C ? 'columns' : 'rows')
  const byCol = seriesIn === 'columns'
  const nSer = byCol ? C : R, nPts = byCol ? R : C
  const truncated = nSer > CHART_SERIES_MAX || nPts > CHART_POINTS_MAX
  const S = Math.min(nSer, CHART_SERIES_MAX), P = Math.min(nPts, CHART_POINTS_MAX)
  // 类别：按列排系列 ⇒ 首列各行；按行排 ⇒ 首行各列
  const hasCat = byCol ? headCol : headRow
  const categories: string[] = []
  for (let i = 0; i < P; i++) categories.push(hasCat ? (byCol ? read(dr0 + i, rc.c0) : read(rc.r0, dc0 + i)).text : String(i + 1))
  const catRect: Rect | undefined = hasCat ? (byCol ? { r0: dr0, r1: dr0 + P - 1, c0: rc.c0, c1: rc.c0 } : { r0: rc.r0, r1: rc.r0, c0: dc0, c1: dc0 + P - 1 }) : undefined
  const hasName = byCol ? headRow : headCol
  const series: ChartSeriesData[] = []
  for (let s = 0; s < S; s++) {
    const nameCell = hasName ? (byCol ? { r: rc.r0, c: dc0 + s } : { r: dr0 + s, c: rc.c0 }) : undefined
    const valRect: Rect = byCol ? { r0: dr0, r1: dr0 + P - 1, c0: dc0 + s, c1: dc0 + s } : { r0: dr0 + s, r1: dr0 + s, c0: dc0, c1: dc0 + P - 1 }
    const values: (number | null)[] = [], texts: string[] = []
    let fmt: NumFmt | undefined
    for (let i = 0; i < P; i++) {
      const x = byCol ? read(dr0 + i, dc0 + s) : read(dr0 + s, dc0 + i)
      const num = typeof x.v === 'number' && Number.isFinite(x.v) ? x.v : null
      values.push(num); texts.push(num === null ? '' : x.text)
      if (num !== null && !fmt && x.fmt) fmt = x.fmt
    }
    series.push({ name: nameCell ? read(nameCell.r, nameCell.c).text : '', ...(nameCell ? { nameCell } : {}), valRect, values, texts, ...(fmt ? { fmt } : {}) })
  }
  return { categories, ...(catRect ? { catRect } : {}), series, seriesIn, truncated }
}

export const isPieLike = (t: ChartType) => t === 'pie' || t === 'doughnut'
/** 实际画的系列（圆饼／甜甜圈只第一个） */
export function shownSeries(ch: Pick<SheetChart, 'type'>, d: ChartData): ChartSeriesData[] {
  return isPieLike(ch.type) ? d.series.slice(0, 1) : d.series
}
/** 实际标题：给了就用（''＝不要）·省 ⇒ 只有一个系列且有名字 ⇒ 系列名（Excel 同） */
export function effectiveTitle(ch: Pick<SheetChart, 'title' | 'type'>, d: ChartData | null): string {
  if (ch.title !== undefined) return ch.title
  const ss = d ? shownSeries(ch, d) : []
  return ss.length === 1 ? ss[0].name : ''
}
/** 图例显不显：给了就照·省 ⇒ 圆饼／甜甜圈或多系列才显 */
export function effectiveLegend(ch: Pick<SheetChart, 'legend' | 'type'>, d: ChartData | null): boolean {
  if (ch.legend !== undefined) return ch.legend
  return isPieLike(ch.type) || (!!d && d.series.length > 1)
}

// ── 版面（SVG 图元·100% 缩放的像素·网页按 zoom 等比放） ─────────────────────

export type ChartPrim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: string; tip?: string; role?: string }
  | { k: 'path'; d: string; fill: string; stroke?: string; sw?: number; tip?: string; role?: string }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; role?: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill: string; stroke: string; sw: number; tip?: string }
  | { k: 'text'; x: number; y: number; s: string; size: number; anchor: 'start' | 'middle' | 'end'; fill: string; bold?: boolean; role?: string }
export type ChartScene = { w: number; h: number; prims: ChartPrim[]; title: string; legend: boolean }
export type LayoutOpts = { seriesName?: (i: number) => string; emptyText?: string }

const INK = '#111827', INK2 = '#4b5563', MUTED = '#6b7280', GRID = '#e5e7eb', BASE = '#9ca3af', SURFACE = '#ffffff'

/** 估字宽（不量真字·中日韩全形＝一个字号宽·其余约 0.58 字号） */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) >= 0x2e80 ? size : size * 0.58
  return w
}
/** 超宽就截字加「…」 */
export function fitText(s: string, size: number, maxW: number): string {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) { if (textWidth(out + ch + '…', size) > maxW) break; out += ch }
  return out ? out + '…' : ''
}
/** 好看的刻度：min／max ⇒ 等距刻度（1、2、2.5、5 × 10ⁿ） */
export function niceTicks(min: number, max: number, target: number): { lo: number; hi: number; step: number; ticks: number[] } {
  if (!(max > min)) max = min + 1
  const raw = (max - min) / Math.max(1, target)
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw - 1e-12) ?? 10 * p
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step)
  return { lo, hi: hi > lo ? hi : lo + step, step, ticks }
}
export function fmtTick(v: number, step: number): string {
  const d = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9))
  const s = Math.abs(v).toFixed(d)
  const [ip, fp] = s.split('.')
  return (v < 0 && Number(s) !== 0 ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fp ? '.' + fp : '')
}
const r1 = (v: number) => Math.round(v * 10) / 10

export function layoutChart(ch: SheetChart, d: ChartData | null, opts: LayoutOpts = {}): ChartScene {
  const W = ch.w, H = ch.h
  const prims: ChartPrim[] = []
  const pad = 10
  const title = effectiveTitle(ch, d)
  const legendOn = effectiveLegend(ch, d)
  const sName = (i: number) => (d?.series[i]?.name || (opts.seriesName ? opts.seriesName(i) : `Series ${i + 1}`))
  let top = pad, bottom = H - pad
  if (title) {
    prims.push({ k: 'text', x: W / 2, y: top + 14, s: fitText(title, 14, W - pad * 2), size: 14, anchor: 'middle', fill: INK, bold: true, role: 'title' })
    top += 26
  }
  const series = d ? shownSeries(ch, d) : []
  const hasNum = series.some(s => s.values.some(v => v !== null))
  const empty = () => { prims.push({ k: 'text', x: W / 2, y: (top + bottom) / 2 + 4, s: opts.emptyText ?? 'No data', size: 12, anchor: 'middle', fill: MUTED, role: 'empty' }); return { w: W, h: H, prims, title, legend: false } }
  if (!d || !hasNum) return empty()
  const pie = isPieLike(ch.type)
  // 图例（底部·可折行·最多三行）
  if (legendOn) {
    const items = pie ? d.categories.map((c, i) => ({ label: c, color: colorAt(ch, i) })) : series.map((_, i) => ({ label: sName(i), color: colorAt(ch, i) }))
    const lines: Array<Array<{ label: string; color: string; w: number }>> = [[]]
    let lw = 0
    const maxW = W - pad * 2
    for (const it of items) {
      const label = fitText(it.label, 11, Math.max(30, maxW - 18))
      const w = 14 + textWidth(label, 11) + 12
      if (lw + w > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0 }
      lines[lines.length - 1].push({ label, color: it.color, w }); lw += w
    }
    const shown = lines.slice(0, 3)
    const lh = shown.length * 16 + 4
    bottom -= lh
    shown.forEach((ln, li) => {
      const total = ln.reduce((s, x) => s + x.w, 0) - 12
      let x = (W - total) / 2
      const y = bottom + 6 + li * 16
      for (const it of ln) {
        prims.push({ k: 'rect', x: r1(x), y: y, w: 10, h: 10, fill: it.color, role: 'legend-swatch' })
        prims.push({ k: 'text', x: r1(x + 14), y: y + 9, s: it.label, size: 11, anchor: 'start', fill: INK2, role: 'legend' })
        x += it.w
      }
    })
  }
  if (bottom - top < 24) return { w: W, h: H, prims, title, legend: legendOn }

  if (pie) {
    const s = series[0]
    const vals = s.values.map(v => (v === null ? 0 : Math.abs(v)))
    const total = vals.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return empty()
    const cx = W / 2, cy = (top + bottom) / 2
    const R = Math.max(10, Math.min(W - pad * 2, bottom - top) / 2 - 2)
    const Ri = ch.type === 'doughnut' ? R * 0.5 : 0
    let a0 = -Math.PI / 2
    const pt = (rad: number, a: number) => `${r1(cx + rad * Math.cos(a))} ${r1(cy + rad * Math.sin(a))}`
    vals.forEach((v, i) => {
      if (!(v > 0)) return
      const frac = v / total
      const a1 = a0 + frac * Math.PI * 2
      const tip = `${d.categories[i]}: ${s.texts[i]} (${(frac * 100).toFixed(1)}%)`
      let path: string
      if (frac >= 0.9999) {
        // 整圈：两段半圆（单段 360° 弧画不出来）
        path = `M ${pt(R, -Math.PI / 2)} A ${R} ${R} 0 1 1 ${pt(R, Math.PI / 2)} A ${R} ${R} 0 1 1 ${pt(R, -Math.PI / 2)} Z` +
          (Ri ? ` M ${pt(Ri, -Math.PI / 2)} A ${Ri} ${Ri} 0 1 0 ${pt(Ri, Math.PI / 2)} A ${Ri} ${Ri} 0 1 0 ${pt(Ri, -Math.PI / 2)} Z` : '')
      } else {
        const large = a1 - a0 > Math.PI ? 1 : 0
        path = Ri
          ? `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(Ri, a1)} A ${Ri} ${Ri} 0 ${large} 0 ${pt(Ri, a0)} Z`
          : `M ${r1(cx)} ${r1(cy)} L ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} Z`
      }
      prims.push({ k: 'path', d: path, fill: colorAt(ch, i), stroke: SURFACE, sw: 2, tip, role: 'slice' })
      if (ch.labels && frac > 0.035) {
        const am = (a0 + a1) / 2, rr = Ri ? (R + Ri) / 2 : R * 0.65
        prims.push({ k: 'text', x: r1(cx + rr * Math.cos(am)), y: r1(cy + rr * Math.sin(am) + 4), s: s.texts[i], size: 11, anchor: 'middle', fill: SURFACE, bold: true, role: 'label' })
      }
      a0 = a1
    })
    return { w: W, h: H, prims, title, legend: legendOn }
  }

  // 有轴的三型（柱／条／折线）
  const nCat = d.categories.length
  let vmin = 0, vmax = 0
  for (const s of series) for (const v of s.values) if (v !== null) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v) }
  const horiz = ch.type === 'bar'
  const left0 = pad, right0 = W - pad
  if (!horiz) {
    const plotH0 = bottom - top - 18
    const tk = niceTicks(vmin, vmax, Math.max(2, Math.min(8, Math.floor(plotH0 / 36))))
    const labW = Math.max(...tk.ticks.map(v => textWidth(fmtTick(v, tk.step), 10))) + 6
    const x0 = left0 + labW, x1 = right0, y0 = top + 4, y1 = bottom - 18
    const Y = (v: number) => y1 - (v - tk.lo) / (tk.hi - tk.lo) * (y1 - y0)
    for (const v of tk.ticks) {
      const y = r1(Y(v))
      prims.push({ k: 'line', x1: x0, y1: y, x2: x1, y2: y, stroke: v === 0 ? BASE : GRID, sw: 1, role: v === 0 ? 'baseline' : 'grid' })
      prims.push({ k: 'text', x: x0 - 4, y: y + 3.5, s: fmtTick(v, tk.step), size: 10, anchor: 'end', fill: MUTED, role: 'tick' })
    }
    const band = (x1 - x0) / Math.max(1, nCat)
    const maxLab = Math.max(...d.categories.map(c => textWidth(c, 10)))
    const every = Math.max(1, Math.ceil((Math.min(maxLab, 120) + 6) / Math.max(1, band)))
    d.categories.forEach((c, i) => { if (i % every === 0) prims.push({ k: 'text', x: r1(x0 + band * (i + 0.5)), y: y1 + 13, s: fitText(c, 10, band * every - 4), size: 10, anchor: 'middle', fill: INK2, role: 'cat' }) })
    if (ch.type === 'column') {
      const group = band * 0.7, bw = group / series.length
      series.forEach((s, si) => s.values.forEach((v, i) => {
        if (v === null) return
        const x = x0 + band * i + (band - group) / 2 + bw * si
        const ya = Y(Math.max(0, v)), yb = Y(Math.min(0, v))
        const gap = bw > 6 ? 1 : 0
        prims.push({ k: 'rect', x: r1(x + gap), y: r1(ya), w: r1(Math.max(1, bw - gap * 2)), h: r1(Math.max(0.5, yb - ya)), fill: colorAt(ch, si), tip: `${sName(si)} · ${d.categories[i]}: ${s.texts[i]}`, role: 'bar' })
        if (ch.labels) prims.push({ k: 'text', x: r1(x + bw / 2), y: r1(v >= 0 ? ya - 3 : yb + 11), s: s.texts[i], size: 10, anchor: 'middle', fill: INK2, role: 'label' })
      }))
    } else {
      series.forEach((s, si) => {
        const color = colorAt(ch, si)
        let dpath = '', pen = false
        s.values.forEach((v, i) => {
          if (v === null) { pen = false; return }
          const x = r1(x0 + band * (i + 0.5)), y = r1(Y(v))
          dpath += `${pen ? 'L' : 'M'} ${x} ${y} `; pen = true
        })
        if (dpath) prims.push({ k: 'path', d: dpath.trim(), fill: 'none', stroke: color, sw: 2, role: 'line' })
        s.values.forEach((v, i) => {
          if (v === null) return
          const x = r1(x0 + band * (i + 0.5)), y = r1(Y(v))
          prims.push({ k: 'circle', cx: x, cy: y, r: 4, fill: color, stroke: SURFACE, sw: 1.5, tip: `${sName(si)} · ${d.categories[i]}: ${s.texts[i]}` })
          if (ch.labels) prims.push({ k: 'text', x, y: y - 7, s: s.texts[i], size: 10, anchor: 'middle', fill: INK2, role: 'label' })
        })
      })
    }
    return { w: W, h: H, prims, title, legend: legendOn }
  }
  // 横条：类别在左（第一个在最上）·数值轴在下
  const catW = Math.min(Math.max(...d.categories.map(c => textWidth(c, 10))) + 8, (right0 - left0) * 0.35)
  const x0 = left0 + catW, x1 = right0 - 8, y0 = top + 2, y1 = bottom - 16
  const tk = niceTicks(vmin, vmax, Math.max(2, Math.min(8, Math.floor((x1 - x0) / 70))))
  const X = (v: number) => x0 + (v - tk.lo) / (tk.hi - tk.lo) * (x1 - x0)
  for (const v of tk.ticks) {
    const x = r1(X(v))
    prims.push({ k: 'line', x1: x, y1: y0, x2: x, y2: y1, stroke: v === 0 ? BASE : GRID, sw: 1, role: v === 0 ? 'baseline' : 'grid' })
    prims.push({ k: 'text', x, y: y1 + 12, s: fmtTick(v, tk.step), size: 10, anchor: 'middle', fill: MUTED, role: 'tick' })
  }
  const band = (y1 - y0) / Math.max(1, nCat)
  const every = Math.max(1, Math.ceil(13 / Math.max(1, band)))
  d.categories.forEach((c, i) => { if (i % every === 0) prims.push({ k: 'text', x: x0 - 4, y: r1(y0 + band * (i + 0.5) + 3.5), s: fitText(c, 10, catW - 6), size: 10, anchor: 'end', fill: INK2, role: 'cat' }) })
  const group = band * 0.7, bh = group / series.length
  series.forEach((s, si) => s.values.forEach((v, i) => {
    if (v === null) return
    const y = y0 + band * i + (band - group) / 2 + bh * si
    const xa = X(Math.min(0, v)), xb = X(Math.max(0, v))
    const gap = bh > 6 ? 1 : 0
    prims.push({ k: 'rect', x: r1(xa), y: r1(y + gap), w: r1(Math.max(0.5, xb - xa)), h: r1(Math.max(1, bh - gap * 2)), fill: colorAt(ch, si), tip: `${sName(si)} · ${d.categories[i]}: ${s.texts[i]}`, role: 'bar' })
    if (ch.labels) prims.push({ k: 'text', x: r1(v >= 0 ? xb + 3 : xa - 3), y: r1(y + bh / 2 + 3.5), s: s.texts[i], size: 10, anchor: v >= 0 ? 'start' : 'end', fill: INK2, role: 'label' })
  }))
  return { w: W, h: H, prims, title, legend: legendOn }
}

// ── 层次（同浮图口径：数组顺序＝层次·0 最底） ─────────────────────────────

export type ChartZMove = 'up' | 'down' | 'top' | 'bottom'
export const CHART_Z_MOVES: readonly ChartZMove[] = ['up', 'down', 'top', 'bottom']
/** 动不了（已到顶／底·找不到）⇒ 回原数组（同一参照·调用方据此不进撤销栈） */
export function moveChartZ(charts: SheetChart[], id: string, move: ChartZMove): SheetChart[] {
  const i = charts.findIndex(c => c.id === id)
  if (i < 0) return charts
  const to = move === 'up' ? i + 1 : move === 'down' ? i - 1 : move === 'top' ? charts.length - 1 : 0
  if (to < 0 || to >= charts.length || to === i) return charts
  const out = charts.slice()
  const [it] = out.splice(i, 1)
  out.splice(to, 0, it)
  return out
}

export function newChartId(charts: readonly SheetChart[]): string {
  for (;;) { const id = `chart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; if (!charts.some(c => c.id === id)) return id }
}

/** 新图表的缺省锚格：数据区间右边隔一列（第一行对齐）；右边超出 Z 列 ⇒ 改放区间下方隔一行 */
export function defaultChartAnchor(range: Rect): string {
  if (range.c1 + 2 <= 25) return cellKey(range.r0, range.c1 + 2)
  return cellKey(Math.min(MAX_ROW, range.r1 + 2), range.c0)
}

// ── AI 改表 op（agent-ops 的 set_chart／delete_chart 交到这里） ─────────────

export class ChartOpError extends Error {
  code: string
  constructor(message: string, code = 'err_sheet_bad_op') { super(message); this.code = code }
}
type ChartHost = { cells?: SheetContent['cells']; merges?: string[]; charts?: SheetChart[] }

/** 读回给 AI 的形（键名＝set_chart 的参数名·读回来可以原样再给） */
export function chartOut(ch: SheetChart, d: ChartData | null) {
  return {
    chart_id: ch.id, type: ch.type, data_range: ch.range, title: effectiveTitle(ch, d), ...(ch.title === undefined ? { title_auto: true } : {}),
    colors: (d ? (isPieLike(ch.type) ? d.categories : d.series).map((_, i) => colorAt(ch, i)) : (ch.colors ?? []).map((_, i) => colorAt(ch, i))),
    legend: effectiveLegend(ch, d), data_labels: !!ch.labels, series_in: d?.seriesIn ?? ch.seriesIn ?? 'columns',
    anchor: ch.cell, offset_x: ch.ox ?? 0, offset_y: ch.oy ?? 0, width: ch.w, height: ch.h,
    series: d ? shownSeries(ch, d).map(s => s.name) : [], categories: d?.categories.length ?? 0,
  }
}
/** get_sheet 回包的 charts（整张表的都列·最多 20 张） */
export function chartsForRead(content: ChartHost | null | undefined): ReturnType<typeof chartOut>[] | undefined {
  const list = content?.charts ?? []
  if (!list.length) return undefined
  const read = contentReader(content as SheetContent)
  return list.map(ch => chartOut(ch, chartData(ch, read)))
}

function needCell(v: unknown, where: string): string {
  const k = typeof v === 'string' ? v.trim().toUpperCase().replace(/^.*!/, '').replace(/\$/g, '') : ''
  const p = CELL_RE.test(k) ? parseRef(k) : null
  if (!p || p.row > MAX_ROW || p.col > MAX_COL) throw new ChartOpError(`${where} must be one cell like "F2"`)
  return cellKey(p.row, p.col)
}
function optSide(v: unknown, where: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (!isNum(v, CHART_SIDE_MIN, CHART_SIDE_MAX)) throw new ChartOpError(`${where} must be ${CHART_SIDE_MIN}–${CHART_SIDE_MAX} pixels`)
  return Math.round(v)
}
function optOff(v: unknown, where: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (!isNum(v, 0, CHART_OFF_MAX)) throw new ChartOpError(`${where} must be 0–${CHART_OFF_MAX} pixels`)
  return Math.round(v)
}
function optBool(v: unknown, where: string): boolean | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'boolean') throw new ChartOpError(`${where} must be true or false (or null for automatic)`)
  return v
}

/**
 * set_chart：带 id ⇒ 改那张（只改给了的栏位·null ⇒ 回自动／预设）；不带 ⇒ 新建（type、range 必给）。
 * delete_chart：拿掉那张。坏参一律抛 ChartOpError（调用方整笔零写）。
 */
export function applyChartOp(content: ChartHost, o: Record<string, unknown>, idx: number): { charts: SheetChart[]; result: Record<string, unknown>; warnings: string[] } {
  const at = (k: string) => `ops[${idx}].${k}`
  const charts = (content.charts ?? []).map(c => ({ ...c }))
  const warnings: string[] = []
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (o.op === 'delete_chart') {
    if (!id || !charts.some(c => c.id === id)) throw new ChartOpError(`${at('id')}: no chart "${id}" on this sheet (get_sheet lists chart ids)`, 'err_sheet_chart_not_found')
    return { charts: charts.filter(c => c.id !== id), result: { op: 'delete_chart', id }, warnings }
  }
  // ── set_chart
  if (o.type !== undefined && !(typeof o.type === 'string' && (CHART_TYPES as readonly string[]).includes(o.type))) throw new ChartOpError(`${at('type')} must be one of ${CHART_TYPES.join(', ')}`)
  let range: string | undefined
  if (o.range !== undefined && o.range !== null) {
    const r = parseChartRange(typeof o.range === 'string' ? o.range.replace(/^.*!/, '') : o.range)
    if (!r) throw new ChartOpError(`${at('range')} must be a bounded A1 range on this sheet like "A1:C9" (at most ${CHART_RANGE_MAX_CELLS} cells)`)
    range = chartRangeKey(r)
  }
  let title: string | null | undefined
  if (o.title !== undefined) {
    if (o.title !== null && typeof o.title !== 'string') throw new ChartOpError(`${at('title')} must be text ("" = no title, null = automatic)`)
    if (typeof o.title === 'string' && o.title.length > CHART_TITLE_MAX) throw new ChartOpError(`${at('title')} is longer than ${CHART_TITLE_MAX} characters`)
    title = o.title as string | null
  }
  let colors: string[] | null | undefined
  if (o.colors !== undefined) {
    if (o.colors === null) colors = null
    else {
      if (!Array.isArray(o.colors) || o.colors.length > CHART_COLORS_MAX) throw new ChartOpError(`${at('colors')} must be a list of up to ${CHART_COLORS_MAX} hex colors like ["#2a78d6","#eb6834"]`)
      o.colors.forEach((c, j) => { if (c !== null && c !== '' && !normHex(c)) throw new ChartOpError(`${at(`colors[${j}]`)} must be a hex color like #2a78d6 (or null to keep the default)`) })
      colors = sanitizeChartColors(o.colors) ?? null
    }
  }
  const legend = optBool(o.legend, at('legend')), labels = optBool(o.labels, at('labels'))
  let seriesIn: ChartSeriesIn | null | undefined
  if (o.series_in !== undefined) {
    if (o.series_in !== null && o.series_in !== 'columns' && o.series_in !== 'rows') throw new ChartOpError(`${at('series_in')} must be "columns" or "rows" (or null for automatic)`)
    seriesIn = o.series_in as ChartSeriesIn | null
  }
  const cell = o.cell === undefined || o.cell === null ? undefined : needCell(o.cell, at('cell'))
  const w = optSide(o.w, at('w')), h = optSide(o.h, at('h'))
  const ox = optOff(o.ox, at('ox')), oy = optOff(o.oy, at('oy'))
  let order: ChartZMove | undefined
  if (o.order !== undefined && o.order !== null) {
    if (!CHART_Z_MOVES.includes(o.order as ChartZMove)) throw new ChartOpError(`${at('order')} must be one of ${CHART_Z_MOVES.join(', ')}`)
    order = o.order as ChartZMove
  }
  const patch = (c: SheetChart): SheetChart => {
    const n: SheetChart = { ...c }
    if (o.type !== undefined) n.type = o.type as ChartType
    if (range) n.range = range
    if (title === null) delete n.title; else if (title !== undefined) n.title = title
    if (colors === null) delete n.colors; else if (colors) n.colors = colors
    if (legend === null) delete n.legend; else if (legend !== undefined) n.legend = legend
    if (labels === null || labels === false) delete n.labels; else if (labels) n.labels = true
    if (seriesIn === null) delete n.seriesIn; else if (seriesIn) n.seriesIn = seriesIn
    if (cell) n.cell = cell
    if (w !== undefined) n.w = w
    if (h !== undefined) n.h = h
    if (ox !== undefined) { if (ox) n.ox = ox; else delete n.ox }
    if (oy !== undefined) { if (oy) n.oy = oy; else delete n.oy }
    return n
  }
  let next: SheetChart[]
  let target: SheetChart
  let created = false
  if (id) {
    const i = charts.findIndex(c => c.id === id)
    if (i < 0) throw new ChartOpError(`${at('id')}: no chart "${id}" on this sheet (get_sheet lists chart ids; leave chart_id out to create a new chart)`, 'err_sheet_chart_not_found')
    const touched = ['type', 'range', 'title', 'colors', 'legend', 'labels', 'series_in', 'cell', 'w', 'h', 'ox', 'oy', 'order'].some(k => o[k] !== undefined)
    if (!touched) throw new ChartOpError(`ops[${idx}]: give at least one thing to change (type, data range, title, colors, legend, data labels, series_in, anchor, size, offsets or order)`)
    target = patch(charts[i])
    next = charts.map((c, k) => (k === i ? target : c))
  } else {
    if (o.type === undefined) throw new ChartOpError(`${at('type')} is required to create a chart (${CHART_TYPES.join(', ')})`)
    if (!range) throw new ChartOpError(`${at('range')} is required to create a chart (the data, e.g. "A1:B9" with a header row)`)
    if (charts.length >= CHARTS_MAX) throw new ChartOpError(`ops[${idx}]: a sheet holds at most ${CHARTS_MAX} charts`)
    const rc = parseChartRange(range)!
    created = true
    target = patch({ id: newChartId(charts), type: o.type as ChartType, range, cell: defaultChartAnchor(rc), w: CHART_DEFAULT_W, h: CHART_DEFAULT_H })
    next = [...charts, target]
  }
  if (order) next = moveChartZ(next, target.id, order)
  const d = chartData(target, contentReader(content as SheetContent))
  if (!d || !d.series.some(s => s.values.some(v => v !== null))) warnings.push(`ops[${idx}]: ${target.range} has no numbers yet, so chart ${target.id} is empty until it does (numbers inside the range are plotted; text in the first row/column becomes series names / categories).`)
  if (d && isPieLike(target.type) && d.series.length > 1) warnings.push(`ops[${idx}]: a ${target.type} chart shows only the first series (${d.series[0].name || 'series 1'}); give one row or one column of numbers to plot a different one.`)
  if (d?.truncated) warnings.push(`ops[${idx}]: only the first ${CHART_SERIES_MAX} series and ${CHART_POINTS_MAX} points are plotted.`)
  return { charts: next, result: { op: 'set_chart', created, ...chartOut(target, d), layer_index: next.findIndex(c => c.id === target.id) }, warnings }
}

// ── 插删行列：锚格与数据区间跟着动（端点规则同合并区） ──────────────────────

export function shiftChartsForStructural(charts: SheetChart[], axis: 'row' | 'col', mode: 'insert' | 'delete', at: number, count: number): { charts: SheetChart[]; removed: number } {
  const end = at + count - 1
  const max = axis === 'row' ? MAX_ROW : MAX_COL
  const out: SheetChart[] = []
  let removed = 0
  for (const ch of charts) {
    const rc = parseChartRange(ch.range), p = parseRef(ch.cell)
    if (!rc || !p) continue
    let s = axis === 'row' ? rc.r0 : rc.c0, e = axis === 'row' ? rc.r1 : rc.c1
    if (mode === 'insert') { if (s >= at) s += count; if (e >= at) e += count }
    else {
      if (s >= at && e <= end) { removed++; continue }   // 数据整段被删 ⇒ 图表拿掉
      if (s > end) s -= count; else if (s >= at) s = at
      if (e > end) e -= count; else if (e >= at) e = at - 1
      if (e < s) e = s
    }
    if (s > max || e > max) { removed++; continue }
    let v = axis === 'row' ? p.row : p.col
    if (mode === 'insert') { if (v >= at) v += count }
    else if (v >= at && v <= end) v = Math.min(at, max)   // 锚格被删 ⇒ 落到删除处（图表留着）
    else if (v > end) v -= count
    if (v > max) { removed++; continue }
    const nr: Rect = axis === 'row' ? { ...rc, r0: s, r1: e } : { ...rc, c0: s, c1: e }
    out.push({ ...ch, range: chartRangeKey(nr), cell: axis === 'row' ? cellKey(v, p.col) : cellKey(p.row, v) })
  }
  return { charts: out, removed }
}
