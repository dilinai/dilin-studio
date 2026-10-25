'use client'
// 游客版的「媒体怎么取」：src 是工程素材（assets/…）⇒ 从这个工程读档转 object URL；http(s)／data:image 照原样；
//   没有网络接口（不抓缩略图、不抓网页摘要——链接卡就显示网址本身）。画面元件与登入版同一份（../media/）。
import type { DocsImageProps, DocsMediaEnv, DocsVideoProps } from '../media/env'
import { PLAIN_DOCS_MEDIA } from '../media/env'
import { mdToExportHtml } from '../../core/md-to-html'
import { useAssetUrl } from './assets'
import { assetSrcAway } from './html'

function GuestVideo({ src, ...rest }: DocsVideoProps) {
  const url = useAssetUrl(src)
  if (!url) return <div className={rest.className} style={{ ...rest.style, background: '#f3f4f6' }} />
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video src={url} {...rest} />
}

function GuestImage({ src, alt, ...rest }: DocsImageProps) {
  const url = useAssetUrl(src || '')
  if (!src) return null
  if (url === undefined) return <span className={rest.className} style={{ ...rest.style, display: 'block', background: '#f9fafb', aspectRatio: '16 / 9' }} />
  if (url === null) return <span className={rest.className} style={{ ...rest.style, display: 'block', background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: 12, wordBreak: 'break-all' }}>{src}</span>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt ?? ''} loading="lazy" {...rest} />
}

function useGuestAudioSrc(src: string | undefined) {
  const url = useAssetUrl(src || '')
  return { src: url ?? undefined }
}

function useGuestAudioDownload(src: string, name: string) {
  const url = useAssetUrl(src)
  return url ? { href: url, download: name } : null
}

/** 文字方块：markdown 转成汇出同一套 HTML（文字都已跳脱、只放行净过的图片／影片行）；工程素材路径不放进 src。 */
function GuestMarkdown({ content, className }: { content: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: assetSrcAway(mdToExportHtml(content)) }} />
}

export const GUEST_DOCS_MEDIA: DocsMediaEnv = {
  ...PLAIN_DOCS_MEDIA,
  Video: GuestVideo,
  Image: GuestImage,
  useAudioSrc: useGuestAudioSrc,
  useAudioDownloadHref: useGuestAudioDownload,
  Markdown: GuestMarkdown,
}
