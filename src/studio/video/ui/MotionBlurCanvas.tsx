'use client'
// 网页剪辑页·播放器上一层影片的运动模糊（算法在 _lib/motion-blur.pure.ts·汇出 VeditExport 照同一套）：
// 每来一格新画面（影片换格或调色画布换格）就抄一份进历史（时刻＝时间轴时刻）·照 mblurPlan 把留下的几格由旧到新叠到盖在上面的画布。
// 画得出来才把来源调成透明（影片照常播放、出声）；画不了 ⇒ 来源照显。画好的画布标 data-ready／data-frame·特效画布、背景填充改拿它当来源（page.tsx layerSource）。
// 拖播放头或暂停后跳开 ⇒ 历史清空（mblurKeep reset），那一格先不带拖影；汇出是从头一格一格画，所以每格都带。
import { useEffect, useRef } from 'react'
import { mblurKeep, mblurPlan, mblurSize, type ClipMotionBlur } from '../lib/motion-blur.pure'
import { framePending, frameKey } from './frame-ready'

type Src = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
export default function VeditMotionBlurCanvas({ source, clock, mb, canvasRef }: {
  /** 来源（同一层的影片元素，或已画好的调色画布） */
  source: () => Src | null
  /** 时间轴现在几秒 */
  clock: () => number
  mb: ClipMotionBlur
  canvasRef?: (el: HTMLCanvasElement | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ mb, clock })
  live.current = { mb, clock }
  useEffect(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    let raf = 0, lastKey = '', frameN = 0, hidden: HTMLElement | null = null
    let hist: Array<{ t: number; cv: HTMLCanvasElement }> = []
    const pool: HTMLCanvasElement[] = []
    const show = (el: HTMLElement | null) => {
      if (hidden && hidden !== el) hidden.style.opacity = ''
      hidden = el
      if (el) el.style.opacity = '0'
    }
    const off = () => { cv.style.visibility = 'hidden'; cv.dataset.ready = '0'; show(null); lastKey = ''; pool.push(...hist.map((h) => h.cv)); hist = [] }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const src = source()
      const isVid = src instanceof HTMLVideoElement, isCv = src instanceof HTMLCanvasElement
      const sw = isVid ? src.videoWidth : isCv ? src.width : (src as HTMLImageElement | null)?.naturalWidth ?? 0
      const sh = isVid ? src.videoHeight : isCv ? src.height : (src as HTMLImageElement | null)?.naturalHeight ?? 0
      if (src && framePending(src) && cv.style.visibility === 'visible') { show(src); return } // 原片跳转中／还没解出 ⇒ 留着上一张（⛔ 露出原片·⛔ 旧帧配新时间）
      if (!src || !sw || !sh || (isVid && src.readyState < 2) || (isCv && src.dataset.ready !== '1')) { off(); return }
      const key = frameKey(src)
      const L = live.current
      if (key === lastKey && cv.dataset.mb === `${L.mb.amount}/${L.mb.blend}/${L.mb.passes}`) return
      try {
        const { w, h } = mblurSize(sw, sh)
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; pool.length = 0; hist = [] }
        const now = L.clock()
        if (key !== lastKey) {
          // 新的一格：先抄进历史（跟汇出一样存没叠过的原格）
          const k = mblurKeep(hist.map((x) => x.t), now, L.mb)
          const keep = k.reset ? [] : k.keep
          const drop = hist.filter((_, i) => !keep.includes(i))
          pool.push(...drop.map((x) => x.cv))
          hist = keep.map((i) => hist[i])
          const c = pool.pop() ?? document.createElement('canvas')
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
          const c2 = c.getContext('2d')!
          c2.clearRect(0, 0, w, h); c2.drawImage(src, 0, 0, w, h)
          // 叠：历史（由旧到新）＋这一格
          g.globalAlpha = 1; g.clearRect(0, 0, w, h)
          for (const p of mblurPlan(L.mb, hist.map((x) => now - x.t))) { g.globalAlpha = p.alpha; g.drawImage(p.i < 0 ? c : hist[p.i].cv, 0, 0, w, h) }
          g.globalAlpha = 1
          hist.push({ t: now, cv: c })
          lastKey = key
        }
        cv.dataset.mb = `${L.mb.amount}/${L.mb.blend}/${L.mb.passes}`
        cv.dataset.frame = String(++frameN)
        cv.dataset.ready = '1'
        cv.dataset.trail = String(hist.length - 1)
        cv.style.visibility = 'visible'
        show(src)
      } catch { off() } // 跨域素材读不到像素 ⇒ 来源照显
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); show(null); cv.dataset.ready = '0' }
  }, [source])
  return <canvas ref={(el) => { ref.current = el; canvasRef?.(el) }} data-testid="vedit-mblur-canvas" className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{ visibility: 'hidden' }} />
}
