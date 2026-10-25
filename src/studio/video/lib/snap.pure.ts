// ═══════════════════════════════════════════════════════════════════════════════════════════
// 网页剪辑页·自动吸附与对齐辅助线的纯半：
//   自动吸附开着：拖片段（含拉两端）贴齐旁边片段的头尾与播放头；关掉就自由摆。
//   ——靠近对齐线（播放头、别段头尾、标记旗）就吸过去并略微顿住：
//     要拖出吸附距离再多 SNAP_HOLD_PX 像素才放开；吸住时在那条对齐位置画一条浅蓝竖线（SNAP_LINE_COLOR）·放开或离开就消失。
//   ——播放器画面里拖文字／贴纸：靠近画面中线（横、竖）、画面四边、别的字块／贴纸的边与中线就吸过去、
//     同一套门槛顿住、画浅蓝辅助线。自动吸附关掉 ⇒ 时间轴与画面里都不吸、不顿、不画线。
// ⛔ 碰 DOM（页面量好位置传进来）。
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { SNAP_PX } from './timeline.pure'

const EPS = 1e-9
/** 吸住后要再拖出吸附距离多少像素才放开（照剪映手感） */
export const SNAP_HOLD_PX = 6
/** 对齐辅助线颜色（浅蓝·跟页面青色主题协调·＝Tailwind sky-300） */
export const SNAP_LINE_COLOR = '#7dd3fc'

/** 吸住的是哪条线：p＝线的位置；off＝被拖那块上哪一点贴着它（相对 v 的位移·例：片头 0、片尾＝长度） */
export type SnapHold = { p: number; off: number } | null
/** v＝吸完的位置；hit＝吸住的那条线（null＝没吸·不画线） */
export type SnapHit = { v: number; hit: SnapHold }

/** 吸附门槛（换成跟位置同一种单位）：unitPx＝一个单位几像素（时间轴＝每秒几像素·画面＝画面宽／高几像素）；
 *  on＝自动吸附开关——关 ⇒ 门槛都是 -1（永远吸不到、也顿不住） */
export function snapThresholds(unitPx: number, on: boolean): { thr: number; release: number } {
  if (!on || !(unitPx > 0)) return { thr: -1, release: -1 }
  return { thr: SNAP_PX / unitPx, release: (SNAP_PX + SNAP_HOLD_PX) / unitPx }
}

/** 一维吸附带顿住：v＝想到的位置；offs＝被拖那块上能贴线的几点（相对 v）；points＝对齐线；
 *  held＝上一下吸住的那条（还在线表里、而且离它没超过 release ⇒ 继续吸住＝顿住）；否则在 thr 内找最近的一条吸过去；都不近 ⇒ 原位、不画线。 */
export function holdSnap(v: number, offs: readonly number[], points: readonly number[], thr: number, release: number, held: SnapHold): SnapHit {
  if (held && points.some((p) => Math.abs(p - held.p) < EPS) && offs.some((o) => Math.abs(o - held.off) < EPS)
    && Math.abs(v + held.off - held.p) <= release + EPS) return { v: held.p - held.off, hit: held }
  let best: SnapHold = null
  let d = thr + EPS
  for (const off of offs) for (const p of points) {
    const x = Math.abs(v + off - p)
    if (x < d) { d = x; best = { p, off } }
  }
  return best ? { v: best.p - best.off, hit: best } : { v, hit: null }
}

// ── 播放器画面里的对齐──
/** 画面上一块东西：中心 x／y 与半宽 hw／半高 hh（都按画面宽／高的比例 0～1） */
export type StageBox = { x: number; y: number; hw: number; hh: number }
/** 画面里的对齐线：画面四边（0、1）＋中线（0.5）＋别的字块／贴纸的两边与中线 */
export function stageLines(others: readonly StageBox[]): { xs: number[]; ys: number[] } {
  const xs = [0, 0.5, 1], ys = [0, 0.5, 1]
  for (const b of others) { xs.push(b.x - b.hw, b.x, b.x + b.hw); ys.push(b.y - b.hh, b.y, b.y + b.hh) }
  return { xs, ys }
}
export type StageHeld = { x: SnapHold; y: SnapHold }
export const STAGE_HELD_NONE: StageHeld = { x: null, y: null }
/** 拖画面上那块到 box（中心已夹在 0～1）：横竖各自吸（左边／中心／右边贴竖线·上边／中心／下边贴横线）·各自顿住；
 *  wPx／hPx＝画面宽高几像素（门槛照像素算）；on＝自动吸附开关。回吸完的中心、这一下吸住哪几条（下一下传回来）、要画的辅助线（gx＝竖线 x·gy＝横线 y） */
export function stageSnap(box: StageBox, others: readonly StageBox[], wPx: number, hPx: number, on: boolean, held: StageHeld = STAGE_HELD_NONE):
  { x: number; y: number; held: StageHeld; gx: number | null; gy: number | null } {
  const { xs, ys } = stageLines(others)
  const tx = snapThresholds(wPx, on), ty = snapThresholds(hPx, on)
  const sx = holdSnap(box.x, [-box.hw, 0, box.hw], xs, tx.thr, tx.release, held.x)
  const sy = holdSnap(box.y, [-box.hh, 0, box.hh], ys, ty.thr, ty.release, held.y)
  return { x: sx.v, y: sy.v, held: { x: sx.hit, y: sy.hit }, gx: sx.hit?.p ?? null, gy: sy.hit?.p ?? null }
}
