'use client'
// 网页剪辑页·预览里的形状／纯色片段：一张铺满画面框的画布·每次重画都叫 shape.pure 的 drawVectorClip（汇出 export-render 叫的同一支）。
import { useEffect, useRef } from 'react'
import { drawVectorClip } from '../lib/shape.pure'
import type { TlClip } from '../lib/timeline.pure'

export default function VeditVectorCanvas({ clip, t }: { clip: TlClip; t: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr))
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)
    drawVectorClip(ctx, clip, t, w, h)
  })
  return <canvas ref={ref} data-testid="vedit-vector" data-clip-id={clip.id} data-kind={clip.shape ? `shape:${clip.shape.shape}` : clip.bgfx ? `bgfx:${clip.bgfx.kind}` : `solid:${clip.solid?.color ?? ''}`} className="absolute inset-0 w-full h-full" />
}
