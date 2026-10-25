'use client'
// 网页剪辑页·预览的背景填充（剪映「背景」：画面没盖满的地方铺纯色，或同一画面放大铺满再模糊）。
// 垫在那一层的画面底下、铺满整个播放器、不跟着那一层的变形走（汇出照 VeditExport drawMedia 同一套：放大 1.1 倍盖满·模糊半径 bgBlurPx）。
import { useEffect, useRef } from 'react'
import { bgBlurPx, type ClipBg } from '../lib/clip-look.pure'

export default function VeditBgFill({ bg, source }: { bg: ClipBg; source: () => HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef(bg)
  live.current = bg
  useEffect(() => {
    if (bg.kind !== 'blur') return
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const b = live.current
      const src = source()
      const W = Math.max(1, Math.round(cv.clientWidth / 2)), H = Math.max(1, Math.round(cv.clientHeight / 2)) // 半解析度就够（反正是模糊）
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
      const sw = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLCanvasElement ? src.width : src?.naturalWidth ?? 0, sh = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLCanvasElement ? src.height : src?.naturalHeight ?? 0
      if (!src || !sw || !sh || b.kind !== 'blur') { g.clearRect(0, 0, W, H); return }
      const k = Math.max(W / sw, H / sh) * 1.1, bw = sw * k, bh = sh * k
      g.filter = `blur(${bgBlurPx(b.amount, Math.min(W, H))}px)`
      try { g.drawImage(src, (W - bw) / 2, (H - bh) / 2, bw, bh) } catch { /* 还没载好 */ }
      g.filter = 'none'
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [bg.kind, source])
  if (bg.kind === 'color') return <div className="absolute inset-0 pointer-events-none" style={{ background: bg.color }} data-testid="vedit-bg-fill" data-kind="color" />
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" data-testid="vedit-bg-fill" data-kind="blur" />
}
