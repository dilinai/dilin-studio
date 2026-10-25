// 简报本体 HTML ⇒ 补字体 stylesheet <link>
//   纯字串·无 DOM／alias 依赖（单测直 require）。本体里用到「选字体」表内字体 ⇒ 把对应 <link data-font-id> 补进 <head>（已有同 id 跳过·幂等）。
//   v2 简报按页存 innerHTML（head 不存）·每次显示都从页内容重扫 ⇒ 重载／分享页照样有字体；旧 HTML 简报 head 里已带的不重复。
import { fontIdsInHtml, fontLinkTags } from './catalog'

export function injectFontLinks(html: string): string {
  if (!html) return html
  const ids = fontIdsInHtml(html).filter(id => !html.includes(`data-font-id="${id}"`))
  if (!ids.length) return html
  const tags = fontLinkTags(ids)
  return html.includes('</head>') ? html.replace('</head>', tags + '\n</head>') : html.replace(/(<body[^>]*>)/i, (m) => tags + '\n' + m)
}
