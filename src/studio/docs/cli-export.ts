// Dilin Studio · 文件命令列版要开浏览器的那几种汇出（页面这边·tools/docs-cli.mjs 开的无头页经本机小服务交来）：
//   docx ＝ 游客版「Word」那颗同一条（guestDocxBlob：正文 markdown → 汇出用 HTML → .docx；图片读工程 assets/）
//   PDF 不在这里：命令列那边直接对纸张视图做「列印」（浏览器列印成 PDF·同编辑页「列印」）。
import type { ProjectStore, StudioT } from '../shared/types'
import { docsFormat } from './format'
import { createAssetResolver } from './page/guest/assets'
import { guestDocxBlob } from './page/guest/export-docx'

export const DOCS_PAGE_EXPORTS = ['docx'] as const

export async function docsCliExport(store: ProjectStore, format: string, t: StudioT): Promise<{ files: { name: string; blob: Blob }[]; notes?: string[] }> {
  if (format !== 'docx') throw new Error(`format must be one of ${DOCS_PAGE_EXPORTS.join(', ')}`)
  const doc = await docsFormat.load(store)
  const resolver = createAssetResolver(store)
  try {
    const blob = await guestDocxBlob({ md: doc.content, paper: doc.paper.paper, resolver, t })
    return { files: [{ name: 'export.docx', blob }] }
  } finally { resolver.dispose() }
}
