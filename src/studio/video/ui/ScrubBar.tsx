'use client'
// 网页剪辑页·播放器进度条。
//   一个组件两处用：全屏时的时间轴预览（非全屏底下已有轨道时间尺·不重复放）、看单份影音原素材（那条·改用这组件）。
//   点哪跳哪；拖着时画面跟着走（照页面原本的跳秒那条路·onSeek）；放开回到按下前的播放／暂停；pointer 事件（滑鼠、手指、触控笔都能拖）；
//   键盘：←／→ 一帧、Shift 一秒、Home／End（算法在 _lib/scrub.pure.ts）。

import { useRef } from 'react'
import { scrubKeyTime, scrubPct, scrubPlaying, scrubTime } from '../lib/scrub.pure'

export default function VeditScrubBar({ dur, value, getPlaying, onSeek, onPlaying, label, valueText, testid }: {
  /** 总长（秒） */
  dur: number
  /** 现在的秒数 */
  value: number
  /** 这一刻在不在播（按下那一下现读·拿来放开后恢复） */
  getPlaying: () => boolean
  /** 跳到某秒（页面原本那条跳秒路） */
  onSeek: (t: number) => void
  /** 设播放／暂停 */
  onPlaying: (p: boolean) => void
  label: string
  valueText: string
  testid: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: number; was: boolean } | null>(null)
  const seekX = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || !(dur > 0)) return
    onSeek(scrubTime(clientX, r.left, r.width, dur))
  }
  const release = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    onPlaying(scrubPlaying('release', d.was))
  }
  const pct = scrubPct(value, dur)
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(0, Math.round(dur * 100) / 100)}
      aria-valuenow={Math.round(Math.min(Math.max(0, value), Math.max(0, dur)) * 100) / 100} aria-valuetext={valueText} title={label}
      className="relative py-2 cursor-pointer touch-none outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 rounded" data-testid={testid}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (!(dur > 0)) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const was = getPlaying()
        dragRef.current = { id: e.pointerId, was }
        onPlaying(scrubPlaying('drag', was))
        seekX(e.clientX)
      }}
      onPointerMove={(e) => { if (dragRef.current?.id === e.pointerId) seekX(e.clientX) }}
      onPointerUp={(e) => { if (dragRef.current?.id === e.pointerId) { seekX(e.clientX); release() } }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        const nt = scrubKeyTime(e.key, value, dur, e.shiftKey)
        if (nt === null || e.ctrlKey || e.metaKey || e.altKey) return
        // 进度条自己吃掉方向键（不让页面的逐帧键再挪一次）
        e.preventDefault(); e.stopPropagation()
        const was = getPlaying()
        onSeek(nt)
        onPlaying(scrubPlaying('release', was))
      }}>
      <div ref={trackRef} className="relative h-1.5 rounded-full bg-white/15">
        <div className="absolute inset-y-0 left-0 rounded-full bg-cyan-400" style={{ width: `${pct}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}
