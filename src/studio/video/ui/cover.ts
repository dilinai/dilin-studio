// 网页剪辑页·「专案」弹窗那格的封面缩图。
// 取法：第一段画面素材（_lib/vedit-draft.pure.ts coverPick 挑哪一段、哪一秒）那一格画面·长边 COVER_EDGE·JPEG data URL。
// 画不出来（素材读不到、跨网域画布被污染、逾时）⇒ null（弹窗那格黑底）。⛔ 抛。
import { COVER_EDGE } from '../lib/draft.pure'

const COVER_TIMEOUT_MS = 6000

function draw(src: CanvasImageSource, w: number, h: number): string | null {
  if (!(w > 0) || !(h > 0)) return null
  const k = COVER_EDGE / Math.max(w, h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')
  if (!g) return null
  g.drawImage(src, 0, 0, c.width, c.height)
  try { return c.toDataURL('image/jpeg', 0.72) } catch { return null } // 跨网域没开 CORS ⇒ 画布被污染·拿不到
}

/** url＝页面素材的播放网址（本机预览档／原档的 blob: 优先）·at＝影片第几秒 */
export function makeCover(url: string, kind: 'video' | 'image', at: number): Promise<string | null> {
  if (!url || typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: string | null) => { if (done) return; done = true; window.clearTimeout(timer); resolve(v) }
    const timer = window.setTimeout(() => finish(null), COVER_TIMEOUT_MS)
    if (kind === 'image') {
      const img = new Image()
      if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous'
      img.onload = () => finish(draw(img, img.naturalWidth, img.naturalHeight))
      img.onerror = () => finish(null)
      img.src = url
      return
    }
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'
    if (!url.startsWith('blob:')) v.crossOrigin = 'anonymous'
    const cleanup = () => { v.removeAttribute('src'); v.load() }
    v.onloadedmetadata = () => { v.currentTime = Math.max(0, Math.min(at, (Number.isFinite(v.duration) ? v.duration : at) - 0.05)) }
    v.onseeked = () => { const r = draw(v, v.videoWidth, v.videoHeight); cleanup(); finish(r) }
    v.onerror = () => { cleanup(); finish(null) }
    v.src = url
  })
}
