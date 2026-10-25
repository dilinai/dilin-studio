// 网格每次改动交给页面的那份 sheet 内容——SheetGrid emit 的纯函数版（好单测）。
//   以「现在整份内容」为底（⛔ 只挑认得的几键重组：冻结／筛选／下拉清单、图表、条件格式…这些顶层键会被一格改动抹掉），
//   再盖上网格手上的 cells／merges／images／列宽行高与这次的 patch；空的合并／图片／列宽行高与值为 undefined 的键拿掉（取消冻结／关筛选＝键消失）。
import type { SheetContent, SheetCells } from './formula'
import type { SheetImage } from './style'

export type GridParts = { cells: SheetCells; merges: string[]; images: SheetImage[]; colWidths?: Record<string, number>; rowHeights?: Record<string, number> }

export function gridEmitNext<T extends SheetContent>(content: T | null | undefined, parts: GridParts, patch: Partial<T> & Record<string, unknown>): T {
  const next = {
    ...((content ?? {}) as Record<string, unknown>),
    cells: parts.cells, ...(parts.merges.length ? { merges: parts.merges } : {}), ...(parts.images.length ? { images: parts.images } : {}),
    ...(parts.colWidths ? { colWidths: parts.colWidths } : {}), ...(parts.rowHeights ? { rowHeights: parts.rowHeights } : {}), ...patch,
  } as Record<string, unknown> & SheetContent
  if (next.merges && !next.merges.length) delete next.merges
  if (next.images && !next.images.length) delete next.images
  if (!next.colWidths || !Object.keys(next.colWidths).length) delete next.colWidths
  if (!next.rowHeights || !Object.keys(next.rowHeights).length) delete next.rowHeights
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  for (const k of ['charts', 'condFormats', 'validations']) { const v = next[k]; if (Array.isArray(v) && !v.length) delete next[k] }   // 合：图表／条件格式／下拉删光 ⇒ 键也拿掉
  return next as T
}
