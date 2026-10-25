// 游客版：正文里的工程素材（assets/…）在画面上不放进 src（浏览器会拿相对路径去网站要档），改放 data-studio-src，
//   节点画面再自己把档转成 object URL 显示；存档前把 data-studio-src 换回 src（见 asset-src.ts）。
import { inertContainer } from '../../core/inert-dom'

/** 画面上代替 src 放工程素材路径的属性。 */
export const STUDIO_SRC_ATTR = 'data-studio-src'

/** 编辑器 HTML ⇒ 存档用的 HTML：data-studio-src 换回 src（在惰性文档里改·不触发任何请求）。 */
export function assetSrcBack(html: string): string {
  if (!html.includes(STUDIO_SRC_ATTR)) return html
  const div = inertContainer()
  div.innerHTML = html
  for (const el of Array.from(div.querySelectorAll(`[${STUDIO_SRC_ATTR}]`))) {
    el.setAttribute('src', el.getAttribute(STUDIO_SRC_ATTR) || '')
    el.removeAttribute(STUDIO_SRC_ATTR)
  }
  return div.innerHTML
}

/** 要放进画面的 HTML 片段里，工程素材的 src 先挪开（显示文字方块等用）。 */
export function assetSrcAway(html: string): string {
  return html.replace(/(<(?:img|video|audio|source)\b[^>]*?)\ssrc=(["'])(assets\/[^"']*)\2/gi, `$1 ${STUDIO_SRC_ATTR}=$2$3$2`)
}
