// 一张工作表内容的形状闸：只收 { cells: { A1: { v?, f?, s? } }, merges?, images?, colWidths?, rowHeights?, charts?, condFormats?, freeze?, filter?, validations?, print? }。
//   别的键丢掉；格式、图、图表、条件格式、冻结筛选验证各走自己的白名单净化（坏的那项丢·不整份拒）；cells 坏形 ⇒ null。
//   登入版存库前、游客版读 project.json 时都过这一道。
import type { SheetContent, SheetCells, CellData } from './formula'
import { sanitizeStyle, sanitizeMerges, sanitizeImages, type SanitizeImageOpts } from './style'
import { sanitizeColWidths, sanitizeRowHeights } from './layout'
import { sanitizeCharts } from './chart'
import { sanitizeCondFormats } from './cond-format'
import { sanitizeSheetView } from './sheet-view'
import { sanitizePrint } from './print'   // 列印设定

/** 一张工作表内容 JSON 的上限（登入版存库前量·游客版匯入建工程前量·同一个数）：2MB */
export const SHEET_CONTENT_MAX_BYTES = 2 * 1024 * 1024

export function sanitizeSheetContent(input: unknown, opts: SanitizeImageOpts = {}): SheetContent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const cellsIn = (input as { cells?: unknown }).cells
  const out: SheetContent = { cells: {} }
  if (cellsIn !== undefined) {
    if (!cellsIn || typeof cellsIn !== 'object' || Array.isArray(cellsIn)) return null
    const cells: SheetCells = {}
    for (const [k, c] of Object.entries(cellsIn as Record<string, unknown>)) {
      if (!/^[A-Z]{1,3}\d{1,6}$/.test(k)) continue   // 坏键丢掉
      if (!c || typeof c !== 'object') return null
      const { v, f, s } = c as { v?: unknown; f?: unknown; s?: unknown }
      const cell: CellData = {}
      if (typeof v === 'string') cell.v = v
      if (typeof f === 'string' && f.trim().startsWith('=')) cell.f = f
      const st = sanitizeStyle(s)
      if (st) cell.s = st
      if (cell.v === undefined && cell.f === undefined && cell.s === undefined) continue
      cells[k] = cell
    }
    out.cells = cells
  }
  const merges = sanitizeMerges((input as { merges?: unknown }).merges)
  if (merges.length) out.merges = merges
  const images = sanitizeImages((input as { images?: unknown }).images, opts)
  if (images.length) out.images = images
  const colWidths = sanitizeColWidths((input as { colWidths?: unknown }).colWidths)
  if (colWidths) out.colWidths = colWidths
  const rowHeights = sanitizeRowHeights((input as { rowHeights?: unknown }).rowHeights)
  if (rowHeights) out.rowHeights = rowHeights
  const charts = sanitizeCharts((input as { charts?: unknown }).charts)
  if (charts.length) out.charts = charts
  const condFormats = sanitizeCondFormats((input as { condFormats?: unknown }).condFormats)
  if (condFormats.length) out.condFormats = condFormats
  Object.assign(out, sanitizeSheetView(input))
  const print = sanitizePrint((input as { print?: unknown }).print)
  if (print) out.print = print
  return out
}
