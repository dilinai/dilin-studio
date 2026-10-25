'use client'
// 网页剪辑页·播放器上一层画面片段的方向性快门模糊（算法在 lib/motion-blur.pure.ts·汇出 export-render drawMedia 照同一套）：
// 每一画（rAF）照 plan(现在几秒) 取样本（mblurDirSamples）·用 drawDirSamples 把这一层（素材那块＋裁剪／圆角／描边·paintFramed）叠到盖在上面的整画面画布；
// 有样本（片段正在照关键帧快速移动／缩放）才把同框里的原层调成透明；没在动或画不了（跨域读不到像素）⇒ 原层照显。
// 预览这张画布只叠素材本身（调色后）＋裁剪圆角描边；蒙版、调整、特效、滤镜在动的那几格先不带（汇出每格都带）。
import { useEffect, useRef } from 'react'
import { drawDirSamples, type Ctx2DLite, type DirSample, type XfLite } from '../lib/motion-blur.pure'
import { borderRing, cornerPx, cropBox, paintFramed, type ClipBorder, type ClipCrop, type Frame } from '../lib/clip-look.pure'

type Src = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
export type DirBlurPlan = { samples: DirSample[]; xf: XfLite; fr: Frame; crop: ClipCrop | null; corner: number; border: ClipBorder | null }
export default function VeditDirBlurCanvas({ source, clock, plan, transform, opacity, blend }: {
  source: () => Src | null
  clock: () => number
  /** 这一刻的样本（没在动 ⇒ null） */
  plan: (now: number) => DirBlurPlan | null
  /** 四角透视（同原层的 pinCssMatrix·画布本身就是整画面大小） */
  transform?: string | null
  /** 同原层的不透明度／混合模式 */
  opacity?: number; blend?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ plan, clock })
  live.current = { plan, clock }
  useEffect(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    let raf = 0, hidden: HTMLElement | null = null
    const layerEl = () => cv.parentElement?.querySelector<HTMLElement>('[data-testid="vedit-tl-layer"]') ?? null
    const show = (el: HTMLElement | null) => {
      if (hidden && hidden !== el) hidden.style.visibility = ''
      hidden = el
      if (el) el.style.visibility = 'hidden'
    }
    const off = () => { cv.style.visibility = 'hidden'; cv.dataset.ready = '0'; show(null) }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const src = source()
      const isVid = src instanceof HTMLVideoElement, isCv = src instanceof HTMLCanvasElement
      if (!src || (isVid && src.readyState < 2) || (isCv && src.dataset.ready === '0')) { off(); return }
      const p = live.current.plan(live.current.clock())
      const box = cv.parentElement
      if (!p || !box || !box.clientWidth) { off(); return }
      try {
        const k = Math.min(window.devicePixelRatio || 1, 1920 / Math.max(box.clientWidth, box.clientHeight))
        const W = Math.max(1, Math.round(box.clientWidth * k)), H = Math.max(1, Math.round(box.clientHeight * k))
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, W, H)
        const r = { x: p.fr.x * W, y: p.fr.y * H, w: p.fr.w * W, h: p.fr.h * H }
        const cb = cropBox(r, p.crop)
        const rad = p.corner > 0 ? cornerPx(p.corner, cb.w, cb.h) : 0
        const ring = borderRing(p.fr, p.crop, p.corner, p.border, W / H)
        drawDirSamples(g as unknown as Ctx2DLite, p.samples, p.xf, W, H, (c) => paintFramed(c as unknown as CanvasRenderingContext2D, (x, y, w, h) => (c as unknown as CanvasRenderingContext2D).drawImage(src, x, y, w, h), r, cb, rad, ring, H))
        cv.dataset.ready = '1'
        cv.dataset.samples = String(p.samples.length)
        cv.style.visibility = 'visible'
        show(layerEl())
      } catch { off() }
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); show(null) }
  }, [source])
  return <canvas ref={ref} data-testid="vedit-dirblur-canvas" className="absolute inset-0 w-full h-full pointer-events-none" style={{ visibility: 'hidden', ...(transform ? { transform } : {}), ...(opacity !== undefined && opacity < 1 ? { opacity } : {}), ...(blend && blend !== 'normal' ? { mixBlendMode: blend as React.CSSProperties['mixBlendMode'] } : {}) }} />
}
