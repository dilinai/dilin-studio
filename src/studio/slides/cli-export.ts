// Dilin Studio · 简报命令列版要开浏览器的汇出（页面这边·tools/slides-cli.mjs 开的无头页经本机小服务交来）：
//   html ＝ 编辑页「html」那颗同一条（本机接口 deckHtml：程序动画编好、assets/ 换成 data: ⇒ exportSlidesHtml）
//   pptx ＝ 编辑页「pptx」那颗同一条（buildComponentPptx：照元件量字、烤图、动画时间线；素材读工程 assets/）
//   每页 PNG、PDF：编辑页本身没有这两种汇出 ⇒ 不做（README 写明）。
import type { ProjectStore, StudioT } from '../shared/types'
import { LocalSlidesApi } from './page/local-api'
import { exportSlidesHtml } from './html-utils'
import type { DeckDataV2 } from './deck-edit'

export const SLIDES_PAGE_EXPORTS = ['html', 'pptx'] as const
const CLI_PROJECT = 'cli'

export async function slidesCliExport(store: ProjectStore, format: string, t: StudioT): Promise<{ files: { name: string; blob: Blob }[]; notes?: string[] }> {
  if (format !== 'html' && format !== 'pptx') throw new Error(`format must be one of ${SLIDES_PAGE_EXPORTS.join(', ')}`)
  const api = new LocalSlidesApi(store, CLI_PROJECT, () => ({ onDirtyChange: () => {} }))
  try {
    if (format === 'html') {
      const r = await api.deckHtml(CLI_PROJECT)
      const j = await r.json() as { html?: unknown; error?: unknown }
      if (!r.ok || typeof j.html !== 'string') throw new Error(`deck could not be rendered: ${String(j.error ?? r.status)}`)
      return { files: [{ name: 'export.html', blob: new Blob([exportSlidesHtml(j.html)], { type: 'text/html' }) }] }
    }
    const r = await api.getSlide(CLI_PROJECT)
    const row = await r.json() as { deck_data?: DeckDataV2; title?: string; error?: unknown }
    if (!r.ok || !row.deck_data) throw new Error(`deck could not be loaded: ${String(row.error ?? r.status)}`)
    const { buildComponentPptx } = await import('./pptx/pptx-components')
    const { pptxReportLines } = await import('./editor/labels')
    const { blob, report } = await buildComponentPptx({ deck: row.deck_data, title: row.title || 'slides', mediaUrl: (u) => api.mediaUrl(u) })
    return { files: [{ name: 'export.pptx', blob }], notes: pptxReportLines(report, (k) => t(k)) }
  } finally { api.dispose() }
}
