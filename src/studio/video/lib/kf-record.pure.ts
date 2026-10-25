// 网页剪辑页·边播边拖、一路自动打关键帧（剪映「主动关键帧」那招）：
// 播放中在预览画面上按住一段（影片／图片画面·或文字）拖着走 ⇒ 每隔 KF_RECORD_STEP 秒记一笔位置·放手才一次写成关键帧（一步复原）；
// 拖过的那段时间里原本的位置关键帧换成新记的（照剪映：重录盖掉旧的）·前后的不动。停着时拖＝照旧改位置（打过关键帧的就在播放头补一颗）。
// 本档只放纯函数（题直接跑）。接线在 video-edit/page.tsx（onPicDown／onTextDown）。
import { srcAt, type TlClip } from './timeline.pure'
import { KF_EPS, kfPut, normalizeKf, type KfProp, type KfTracks } from './keyframe.pure'

/** 记一笔的间隔（秒·时间轴）：10 笔／秒——够顺、又不会一段几百颗 */
export const KF_RECORD_STEP = 0.1
export type KfSample = { t: number; x: number; y: number }

/** 拖着时要不要再记一笔：第一笔一定记；之后照时间轴隔够 step 才记（倒着跳了也记——播放头被拖回去） */
export function shouldSample(prev: readonly KfSample[], t: number, step = KF_RECORD_STEP): boolean {
  const last = prev[prev.length - 1]
  return !last || Math.abs(t - last.t) >= step - 1e-6
}

/** 记的那几笔 ⇒ 关键帧（px／py＝写哪两条轨：画面 x／y·文字 tx／ty）：只收落在这段里面的笔；
 *  拖过的时间范围（素材时刻）里原有的那两条轨的关键帧先拿掉·再一笔一颗放进去·前后的保留；一笔都没有 ⇒ 原样 */
export function recordKf(c: Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve' | 'kf'>, px: KfProp, py: KfProp, samples: readonly KfSample[]): KfTracks | undefined {
  const inside = samples.filter((s) => s.t >= c.start - 1e-6 && s.t <= c.start + c.length + 1e-6)
  if (!inside.length) return c.kf
  const at = (t: number) => srcAt({ start: c.start, length: c.length, offset: c.offset, speed: c.speed, curve: c.curve }, t)
  const ss = inside.map((s) => ({ s: at(s.t), x: s.x, y: s.y })).sort((a, b) => a.s - b.s)
  const lo = ss[0].s - KF_EPS, hi = ss[ss.length - 1].s + KF_EPS
  const out: KfTracks = { ...(c.kf ?? {}) }
  let tx = (out[px] ?? []).filter((k) => k.t < lo || k.t > hi)
  let ty = (out[py] ?? []).filter((k) => k.t < lo || k.t > hi)
  for (const p of ss) { tx = kfPut(tx, p.s, p.x); ty = kfPut(ty, p.s, p.y) }
  out[px] = tx; out[py] = ty
  return normalizeKf(out)
}

/** 预览上拖画面：滑鼠位移（像素）⇒ 片段位置（x 占画面宽·y 往上为正占画面高·夹在 -2～2·同右栏位置的范围） */
export function picDragPos(x0: number, y0: number, dxPx: number, dyPx: number, w: number, h: number): { x: number; y: number } {
  const c = (v: number) => Math.round(Math.min(2, Math.max(-2, v)) * 10000) / 10000
  return { x: c(x0 + dxPx / Math.max(1, w)), y: c(y0 - dyPx / Math.max(1, h)) }
}
