'use client'
// 网页剪辑页·预览里要整层像素才画得对的那几层（合成段、拿画面层当轨道遮罩的片段）：一张铺满画面框的透明画布，
//   每次播放头／轨道变了就叫汇出那支 frameDrawer 只画这一层（frame(t, only)·不打码）·画好贴上来——预览＝成片同一份画法。
//   画得比播放慢时只画最新那一刻（中间跳过）；混合模式由外框的 mix-blend-mode 跟底下各层合（画布里这层对着透明底画＝原色）。
import { useEffect, useRef } from 'react'
import { frameDrawer, type ExportEnv } from './export-render'

type FD = Awaited<ReturnType<typeof frameDrawer>>
/** 预览画布长边上限（像素·再大预览也看不出差别·解码更慢） */
const PREVIEW_MAX_SIDE = 1280
const EMPTY = {}

export default function VeditPlanCanvas({ env, t, only, clipId }: { env: ExportEnv; t: number; only: readonly string[]; clipId: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  // frameDrawer 每格读 env.tracks／comps ⇒ 同一只物件、每次重画换上最新的（⛔ 每改一下就重开解码器）
  const box = useRef<ExportEnv>({ ...env })
  Object.assign(box.current, env)
  const st = useRef<{ fd: Promise<FD | null> | null; w: number; h: number; busy: boolean; want: { t: number; only: Set<string>; key: string } | null; dead: boolean; last: string }>({ fd: null, w: 0, h: 0, busy: false, want: null, dead: false, last: '' })
  useEffect(() => {
    const s = st.current
    s.dead = false
    return () => { s.dead = true; const p = s.fd; s.fd = null; void p?.then((d) => d?.dispose()) }
  }, [])
  // 轨道／合成换了（同一刻也要重画）：物件编号（同一份 ⇒ 同号）
  const ids = useRef({ map: new WeakMap<object, number>(), n: 0 })
  const idOf = (o: object) => { const m = ids.current.map; let v = m.get(o); if (v === undefined) { v = ++ids.current.n; m.set(o, v) } return v }
  const key = `${t.toFixed(4)}|${only.join(',')}|${idOf(env.tracks)}|${idOf(env.comps ?? EMPTY)}`
  useEffect(() => {
    const s = st.current, cv = ref.current
    if (!cv) return
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    let w = Math.max(2, Math.round(cv.clientWidth * dpr)), h = Math.max(2, Math.round(cv.clientHeight * dpr))
    const k = Math.min(1, PREVIEW_MAX_SIDE / Math.max(w, h)); w = Math.max(2, Math.round(w * k)); h = Math.max(2, Math.round(h * k))
    const full = `${key}|${w}x${h}`
    if (full === s.last && !s.busy) return
    s.want = { t, only: new Set(only), key: full }
    if (s.busy) return
    s.busy = true
    void (async () => {
      try {
        while (s.want && !s.dead) {
          const job = s.want
          s.want = null
          if (!s.fd || s.w !== w || s.h !== h) { const old = s.fd; void old?.then((d) => d?.dispose()); s.fd = frameDrawer(box.current, w, h, { alpha: true }).catch(() => null); s.w = w; s.h = h }
          const fd = await s.fd
          if (!fd || s.dead) break
          await fd.frame(job.t, job.only, { mosaic: false })
          if (s.dead) break
          if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
          const c2 = cv.getContext('2d')
          if (c2) { c2.setTransform(1, 0, 0, 1, 0, 0); c2.globalAlpha = 1; c2.globalCompositeOperation = 'source-over'; c2.clearRect(0, 0, w, h); c2.drawImage(fd.canvas, 0, 0, w, h) }
          s.last = job.key
          cv.dataset.ready = '1'; cv.dataset.t = job.t.toFixed(3)
        }
      } catch { cv.dataset.err = '1' } finally { s.busy = false }
    })()
  })
  return <canvas ref={ref} data-testid="vedit-plan-canvas" data-clip-id={clipId} className="absolute inset-0 w-full h-full pointer-events-none" />
}
