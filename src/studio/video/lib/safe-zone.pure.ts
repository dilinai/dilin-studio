// 网页剪辑页·预览画面的安全区（剪映播放器右下「参考线／安全区」）：
// broadcast＝电视标准（EBU R95：动作安全 93%、字幕安全 90%·两个框）；douyin＝抖音竖屏（上方状态列与分页、下方文案与音乐列、右侧按钮栏会盖住画面·那几块打灰）。
// 只是辅助看的线：不进工程档、不进成片。本档只放纯函数（题直接跑）；画法在 video-edit/page.tsx 舞台里。
export const SAFE_MODES = ['off', 'broadcast', 'douyin'] as const
export type SafeMode = (typeof SAFE_MODES)[number]
/** 一块（0～1·占画面宽高的比例）：frame＝画一个框（label＝框名翻译键尾）·cover＝打灰（会被平台介面盖住） */
export type SafeRect = { kind: 'frame' | 'cover'; x: number; y: number; w: number; h: number; label?: string }
const inset = (k: number, label: string): SafeRect => ({ kind: 'frame', x: (1 - k) / 2, y: (1 - k) / 2, w: k, h: k, label })
export function safeRects(mode: SafeMode): SafeRect[] {
  if (mode === 'broadcast') return [inset(0.93, 'action'), inset(0.9, 'title')]
  if (mode === 'douyin') return [
    { kind: 'cover', x: 0, y: 0, w: 1, h: 0.08 }, // 状态列＋「关注｜推荐」分页
    { kind: 'cover', x: 0, y: 0.8, w: 1, h: 0.2 }, // 作者名、文案、音乐列、底部导航
    { kind: 'cover', x: 0.86, y: 0.38, w: 0.14, h: 0.42 }, // 右侧头像、点赞、评论、收藏、分享
    { kind: 'frame', x: 0.04, y: 0.08, w: 0.82, h: 0.72, label: 'content' },
  ]
  return []
}
export const nextSafeMode = (m: SafeMode): SafeMode => SAFE_MODES[(SAFE_MODES.indexOf(m) + 1) % SAFE_MODES.length]
export const isSafeMode = (v: unknown): v is SafeMode => (SAFE_MODES as readonly unknown[]).includes(v)
