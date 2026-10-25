// 网页剪辑页·汇入／拖放的档是哪种素材（影片／音讯／图片）。
// 先看 File.type；它是空字串、application/octet-stream 或别的非影音图片类型（系统没登记副档名、页面脚本或浏览器扩充自己造的 File）⇒ 按副档名判断。
// 本档只放纯函数（题直接跑）；页面在 page/VideoEditPage.tsx 的 onPick。
export type MediaFileKind = 'video' | 'audio' | 'image'

export const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|opus|aiff?|wma|caf|weba)$/i
export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i
/** 浏览器 <img> 画得出来的图片（工程汇入那边另有更宽的表·含 psd／exr 等只认名字不显示的） */
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

/** 只看副档名 */
export function mediaKindOfName(name: string): MediaFileKind | null {
  const n = (name ?? '').trim()
  if (AUDIO_EXT.test(n)) return 'audio'
  if (VIDEO_EXT.test(n)) return 'video'
  if (IMAGE_EXT.test(n)) return 'image'
  return null
}

/** File.type 前缀优先；不是 video/ audio/ image/ 开头 ⇒ 副档名 */
export function mediaKindOf(file: { name: string; type: string }): MediaFileKind | null {
  const t = (file.type ?? '').toLowerCase()
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('image/')) return 'image'
  return mediaKindOfName(file.name)
}

/** <input type=file accept> 补上副档名：有的系统没登记 .m4a 等的类型 ⇒ 只写 audio/* 时选档窗不列出来 */
export const MEDIA_ACCEPT_EXTS = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma', 'caf', 'weba', 'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']
  .map((e) => '.' + e).join(',')
