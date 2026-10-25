// 字体懒载
//   每款字体＝往 <head> 挂一条 <link rel=stylesheet data-font-id>·同一 id 只挂一次（模块级 Set＋DOM 查重·双保险）。
//   stylesheet 里是 unicode-range 切片的 @font-face ⇒ 浏览器只拉页面上真用到的那几片（中文字体 100 余片里命中几片载几片）。
//   ⛔ 只在浏览器跑（typeof document 判）·服务端调用＝无操作。

import { findFont, fontCssHref, fontCatalog } from './catalog'

const requested = new Set<string>()

export function ensureFontLoaded(id: string | undefined | null): void {
  if (!id || typeof document === 'undefined') return
  const entry = findFont(id)
  if (!entry) return
  if (requested.has(id)) return
  if (document.head.querySelector(`link[data-font-id="${id}"]`)) { requested.add(id); return }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = fontCssHref(entry)
  link.setAttribute('data-font-id', id)
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
  requested.add(id)
}

export function ensureFontsLoaded(ids: Iterable<string | undefined | null>): void {
  for (const id of ids) ensureFontLoaded(id)
}

/** 下拉打开时把 12 款全挂上（每项用自己的字体渲染预览·预览字只会拉命中的几片） */
export function ensureAllCatalogFontsLoaded(): void {
  for (const f of fontCatalog()) ensureFontLoaded(f.id)
}
