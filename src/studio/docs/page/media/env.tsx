'use client'
// 文件编辑器里「媒体怎么取」这一层：正文图片、影片、音讯、自由组件里的文字方块、链接卡的网页摘要。
//   画面（卡片、三种视图、工具条）只有一份、放在 docs/page/；src 怎么变成能播能看的网址由宿主决定：
//     登入版＝网站云端素材（签名自愈、站内代理、缩略图与网页摘要走网站接口）；
//     游客版＝工程资料夹 assets/ 里的档（浏览器里转成 object URL）、没有网络接口。
//   取法：useDocsMedia() ⇒ 外层 <DocsMediaProvider> 给的那一份；没包 ⇒ 网站登记的那一份（setDefaultDocsMedia）；
//   都没有 ⇒ 最朴素的原生元素（不发任何请求）。

import { createContext, useContext, type ComponentType, type ImgHTMLAttributes, type ReactNode, type VideoHTMLAttributes } from 'react'

export interface OgPreview {
  ok: boolean
  url: string
  source: 'og' | 'meta' | 'domain'
  title: string
  description: string
  image: string
  favicon: string
  siteName: string
}

export type DocsVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> & { src: string }
export type DocsImageProps = ImgHTMLAttributes<HTMLImageElement> & { src?: string; alt?: string }

export interface DocsMediaEnv {
  /** 视频播放元素。 */
  Video: ComponentType<DocsVideoProps>
  /** 正文与自由组件里的图片。 */
  Image: ComponentType<DocsImageProps>
  /** 音讯 src ⇒ 能放的网址（onError＝坏了再取一次）。 */
  useAudioSrc(src: string | undefined): { src: string | undefined; onError?: () => void }
  /** 音讯下载连结（download＝要不要加 download 属性给档名）；null ⇒ 不显示下载钮。 */
  useAudioDownloadHref(src: string, name: string): { href: string; download?: string } | null
  /** 文字方块的 markdown 显示。 */
  Markdown: ComponentType<{ content: string; className?: string }>
  /** 自由组件里的档案卡（没有 ⇒ 显示档名）。 */
  FileCard?: ComponentType<{ docId: string | null | undefined; attrs: { fileId: string; name: string; size: number | null; mime: string; createdAt: string }; fill?: boolean }>
  /** 正文旧式视频框（iframe 播放器）用的网址（登入版换站内代理链）。 */
  videoProxySrc(src: string): string
  /** 视频缩略图网址（没有 ⇒ null，卡片画默认图示）。 */
  videoThumbnail(src: string): Promise<string | null>
  /** 档名显示（乱码修正等）。 */
  displayName(name: string): string
  /** 网址的网页摘要（标题、描述、封面）。 */
  ogPreview(url: string): Promise<OgPreview>
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function PlainVideo({ src, ...rest }: DocsVideoProps) {
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video src={src} {...rest} />
}
function PlainImage({ src, alt, ...rest }: DocsImageProps) {
  if (!src) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? ''} loading="lazy" {...rest} />
}
function PlainMarkdown({ content, className }: { content: string; className?: string }) {
  return <div className={className} style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
}

export const PLAIN_DOCS_MEDIA: DocsMediaEnv = {
  Video: PlainVideo,
  Image: PlainImage,
  useAudioSrc: (src) => ({ src }),
  useAudioDownloadHref: () => null,
  Markdown: PlainMarkdown,
  videoProxySrc: (src) => src,
  videoThumbnail: async () => null,
  displayName: (name) => name,
  ogPreview: async (url) => ({ ok: false, url, source: 'domain', title: hostOf(url), description: '', image: '', favicon: '', siteName: '' }),
}

let registered: DocsMediaEnv | null = null
/** 网站载入时登记自己的那一份（没包 Provider 的地方用它）。 */
export function setDefaultDocsMedia(env: DocsMediaEnv): void { registered = env }

const Ctx = createContext<DocsMediaEnv | null>(null)

export function DocsMediaProvider({ value, children }: { value: DocsMediaEnv; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDocsMedia(): DocsMediaEnv {
  return useContext(Ctx) ?? registered ?? PLAIN_DOCS_MEDIA
}
