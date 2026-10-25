// 网页剪辑页·运动跟踪（浏览器端读帧）：另开一个藏着的 <video>·逐格 seek 到要的素材秒·画进小画布（长边 ≤320）·转灰阶喂给 motion-track.pure 的 createTracker。
// 可取消（AbortSignal）·每格回报进度。算法全在纯函数档；这里只碰 DOM。
import { createTracker, toGray, type TrackBox, type TrackPt } from '../lib/motion-track.pure'

const MAX_SIDE = 320

function seek(v: HTMLVideoElement, t: number, signal: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    if (signal.aborted) { rej(new DOMException('aborted', 'AbortError')); return }
    const done = () => { v.removeEventListener('seeked', done); v.removeEventListener('error', bad); signal.removeEventListener('abort', ab); res() }
    const bad = () => { v.removeEventListener('seeked', done); v.removeEventListener('error', bad); signal.removeEventListener('abort', ab); rej(new Error('video error')) }
    const ab = () => { v.removeEventListener('seeked', done); v.removeEventListener('error', bad); rej(new DOMException('aborted', 'AbortError')) }
    v.addEventListener('seeked', done); v.addEventListener('error', bad); signal.addEventListener('abort', ab)
    v.currentTime = t
  })
}

/** url＝影片网址；times＝要读的素材秒（第一格＝框选那格）；box＝在素材帧上的框（中心＋宽高·占帧比例）。回每格的点（被取消 ⇒ 回已算好的那些·aborted=true） */
export async function runTrack(o: { url: string; times: readonly number[]; box: TrackBox; signal: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<{ pts: TrackPt[]; aborted: boolean }> {
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.playsInline = true
  v.src = o.url
  await new Promise<void>((res, rej) => {
    if (v.readyState >= 1) { res(); return }
    v.addEventListener('loadedmetadata', () => res(), { once: true })
    v.addEventListener('error', () => rej(new Error('video error')), { once: true })
  })
  const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth || 1, v.videoHeight || 1))
  const w = Math.max(8, Math.round((v.videoWidth || 320) * k)), h = Math.max(8, Math.round((v.videoHeight || 180) * k))
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d')
  const grab = () => { ctx.drawImage(v, 0, 0, w, h); return toGray(ctx.getImageData(0, 0, w, h).data, w, h) }
  const pts: TrackPt[] = []
  try {
    await seek(v, o.times[0], o.signal)
    const tk = createTracker(grab(), o.box)
    pts.push(tk.first)
    o.onProgress?.(1, o.times.length)
    for (let i = 1; i < o.times.length; i++) {
      await seek(v, o.times[i], o.signal)
      pts.push(tk.step(grab()))
      o.onProgress?.(i + 1, o.times.length)
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0)) // 让画面喘口气
    }
    return { pts, aborted: false }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { pts, aborted: true }
    throw e
  } finally {
    v.removeAttribute('src'); v.load()
  }
}
