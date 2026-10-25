// 网页剪辑页·播放器进度条的纯算法。
//   点哪跳哪：按下位置 → 秒数；拖着时先停（画面跟着播放头走）·放开后回到按下前的播放／暂停状态。
//   键盘：←／→ 一帧、Shift＋←／→ 一秒、Home 回开头、End 到尾。
//   组件在 video-edit/VeditScrubBar.tsx；全屏时间轴预览与看单份原素材两处共用。

import { FRAME, stepTime } from './timeline.pure'

/** 按下／拖到的横坐标 → 在条上的比例（夹在 0～1；条宽 0 ⇒ 0） */
export function scrubFrac(clientX: number, left: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(clientX)) return 0
  return Math.min(1, Math.max(0, (clientX - left) / width))
}

/** 按下／拖到的横坐标 → 秒数（总长不明 ⇒ 0） */
export function scrubTime(clientX: number, left: number, width: number, dur: number): number {
  if (!(dur > 0)) return 0
  return scrubFrac(clientX, left, width) * dur
}

/** 进度条阶段 → 这时该不该在播：拖着（含按下那一刻）一律停；放开 ⇒ 回到按下前的状态 */
export type ScrubPhase = 'drag' | 'release'
export function scrubPlaying(phase: ScrubPhase, wasPlaying: boolean): boolean {
  return phase === 'release' ? wasPlaying : false
}

/** 键盘微调 → 新秒数；不是进度条管的键 ⇒ null（交回页面） */
export function scrubKeyTime(key: string, t: number, dur: number, shift = false): number | null {
  const end = Math.max(0, dur)
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return stepTime(t, -1, end, shift ? 1 : FRAME)
    case 'ArrowRight': case 'ArrowUp': return stepTime(t, 1, end, shift ? 1 : FRAME)
    case 'Home': return 0
    case 'End': return end
    default: return null
  }
}

/** 进度百分比（画填色与圆点用·夹在 0～100） */
export function scrubPct(t: number, dur: number): number {
  if (!(dur > 0)) return 0
  return Math.min(100, Math.max(0, (t / dur) * 100))
}
