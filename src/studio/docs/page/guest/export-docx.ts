// 游客版 Word 汇出（全在浏览器里）：正文 markdown → 汇出用 HTML → buildDocxBlob；图片从工程 assets/ 读（http(s) 图照抓）。
//   登入版的「服务端出 Word」游客版没有，页面会直接走这条（同登入版服务端失败时退回的那条）。

import type { StudioT } from '../../../shared/types'
import { mdToExportHtml } from '../../core/md-to-html'
import { buildDocxBlob, type DocxImageLoader } from '../../core/docx-export'
import type { DocPaperPref } from '../../core/paper-size'
import { isSimplifiedSite } from '../../../shared/host'
import { assetNameFromSrc } from '../../format'
import type { AssetResolver } from './assets'

export function guestImageLoader(resolver: AssetResolver): DocxImageLoader {
  return async (url) => {
    if (assetNameFromSrc(url)) {
      const b = await resolver.blob(url)
      if (!b) return null
      return { type: b.type, read: async (limit) => (b.size > limit ? null : new Uint8Array(await b.arrayBuffer())) }
    }
    if (/^data:image\//i.test(url) || /^https?:\/\//i.test(url)) {
      const res = await fetch(url)
      if (!res.ok) return null
      const b = await res.blob()
      return { type: res.headers.get('content-type') || b.type, read: async (limit) => (b.size > limit ? null : new Uint8Array(await b.arrayBuffer())) }
    }
    return null
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
}

export async function guestDocxBlob(o: { md: string; paper: DocPaperPref | null | undefined; resolver: AssetResolver; t: StudioT }): Promise<Blob> {
  return buildDocxBlob({
    html: mdToExportHtml(o.md, { tocTitle: () => o.t('bf_toc_title') }),
    paper: o.paper ?? 'a4-portrait',
    isCn: isSimplifiedSite(),
    loadImage: guestImageLoader(o.resolver),
    budgetNote: (n) => o.t('bf_docexport_img_budget_note').replace('{n}', String(n)),
  })
}
