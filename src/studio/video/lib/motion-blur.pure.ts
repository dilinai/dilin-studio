// 网页剪辑页·运动模糊（照剪映「运动模糊」：模糊程度／混合／叠加次数）。
// 做法：这一格画面跟它前面一小段时间（span 秒）里的几格叠在一起出拖影——越旧的那格占得越少；画面没在动就看不出差别。
// 两种模式（mode）：'frames'＝和前几格混（只对影片·旧工程没写 mode 的影片照这个）；'dir'＝方向性快门模糊（影片、图片都行·图片没写 mode 就是这个）：
//   由关键帧／动画算出这一刻前后小段时间（快门 span 秒·以这一刻为中）的位移与缩放，沿位移方向取几个时刻、把这一层照那几刻的位置叠起来（mblurDirSamples）；
//   预览（ui/DirBlurCanvas.tsx）与汇出（ui/export-render.ts drawMedia）都用 mblurDirSamples 算样本、用 drawDirSamples 叠（同一个函数）。
// 预览（video-edit/VeditMotionBlurCanvas.tsx）与汇出（VeditExport drawMedia）都照本档：mblurKeep 留哪几格、mblurPlan 每格怎么叠。
// 本档只放纯函数（题直接跑）·⛔ 碰 DOM。
import { lookFxNegOff } from './corner-pin.pure'
export const MBLUR_MODES = ['frames', 'dir'] as const
export type MblurMode = (typeof MBLUR_MODES)[number]
export type ClipMotionBlur = { amount: number; blend: number; passes: number; mode?: MblurMode }
/** 剪映教程那组数字：模糊 30、混合 30、叠加 4 次 */
export const MBLUR_DEFAULT: ClipMotionBlur = { amount: 30, blend: 30, passes: 4 }
export const MBLUR_PASSES = [1, 2, 3, 4] as const
/** 拖影最多叠几格（预览、汇出同一个上限） */
export const MBLUR_MAX_FRAMES = 16
/** 叠图用的画布长边上限（预览、汇出同一个） */
export const MBLUR_MAX_SIDE = 1920
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 拖影往回拉多长（秒）：模糊程度 0～100 ⇒ 0.02～0.32 秒 */
export const mblurSpan = (m: ClipMotionBlur) => 0.02 + (clamp(m.amount, 0, 100) / 100) * 0.3
export const mblurActive = (m: ClipMotionBlur | null | undefined): m is ClipMotionBlur => !!m && m.amount > 0 && m.blend > 0

/** 验值：缺省／坏值 ⇒ undefined；模糊程度、混合 0～100 取整·叠加次数 1～4 */
export function parseMotionBlur(v: unknown): ClipMotionBlur | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const a = num(o.amount), b = num(o.blend)
  if (a === null || b === null) return undefined
  const m: ClipMotionBlur = { amount: Math.round(clamp(a, 0, 100)), blend: Math.round(clamp(b, 0, 100)), passes: Math.round(clamp(num(o.passes) ?? MBLUR_DEFAULT.passes, 1, 4)) }
  if (o.mode === 'dir' || o.mode === 'frames') m.mode = o.mode
  return mblurActive(m) ? m : undefined
}

/** 一格旧画面（隔了 age 秒）占多重：当前那格算 1；越旧越轻（线性降到 span 为 0）；混合越大、叠加次数越多越重 */
export function mblurWeight(m: ClipMotionBlur, age: number): number {
  const span = mblurSpan(m)
  if (!(age > 0) || age >= span) return 0
  return (clamp(m.blend, 0, 100) / 100) * (clamp(m.passes, 1, 4) / 2) * (1 - age / span)
}

/** 历史格（时间由旧到新）到了时刻 now：
 *  - 时间倒退或跳太远（拖播放头、换段）⇒ reset：旧的全丢；
 *  - 不然留下还在 span 里的、最多 MBLUR_MAX_FRAMES-1 格（再加当前那格就是上限）。回留下的下标（由旧到新）。 */
export function mblurKeep(times: readonly number[], now: number, m: ClipMotionBlur): { reset: boolean; keep: number[] } {
  const span = mblurSpan(m)
  const last = times.length ? times[times.length - 1] : null
  if (last !== null && (now < last - 1e-6 || now - last > span * 2)) return { reset: true, keep: [] }
  const keep: number[] = []
  for (let i = 0; i < times.length; i++) if (now - times[i] > 1e-6 && now - times[i] < span) keep.push(i)
  return { reset: false, keep: keep.slice(-(MBLUR_MAX_FRAMES - 1)) }
}

/** 怎么叠：由旧到新逐格画（source-over），第一格不透明度 1，之后每格不透明度＝自己的重量／到这格为止的重量和 ⇒ 结果正好是加权平均。
 *  ages＝留下的历史格各隔几秒（由旧到新）；回 { i: 历史下标（-1＝当前那格）, alpha } */
export function mblurPlan(m: ClipMotionBlur, ages: readonly number[]): Array<{ i: number; alpha: number }> {
  const items = ages.map((a, i) => ({ i, w: mblurWeight(m, a) })).filter((x) => x.w > 0)
  items.push({ i: -1, w: 1 })
  let sum = 0
  return items.map((x) => { sum += x.w; return { i: x.i, alpha: x.w / sum } })
}

/** 叠图画布多大：长边不超过 MBLUR_MAX_SIDE */
export function mblurSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MBLUR_MAX_SIDE / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

// ── 方向性快门模糊（mode 'dir'）──
/** 这段实际用哪种：写了 mode 照写的；没写 ⇒ 影片 'frames'（旧工程照旧）、图片 'dir'。药 ⇒ 图片没有运动模糊、影片只剩 'frames' */
export function mblurModeOf(m: ClipMotionBlur | null | undefined, media: 'video' | 'image' | string): MblurMode | null {
  if (!mblurActive(m)) return null
  const want: MblurMode = m.mode ?? (media === 'video' ? 'frames' : 'dir')
  if (lookFxNegOff()) return media === 'video' ? 'frames' : null
  return want === 'frames' && media !== 'video' ? 'dir' : want
}
/** 一层的变形（同 clip-look lookXform：tx／ty＝占画面宽／高的百分比·rot 度·sx／sy 倍数） */
export type XfLite = { tx: number; ty: number; rot: number; sx: number; sy: number }
/** 一个样本：相对这一刻的位移（同 tx／ty 单位）、缩放比、旋转差；alpha 照 mblurPlan 那招（由先到后 source-over ⇒ 加权平均） */
export type DirSample = { dt: number; dtx: number; dty: number; ksx: number; ksy: number; drot: number; alpha: number }
/** 样本数：叠加次数 1～4 ⇒ 3／7／11／15 个（含这一刻·不超过 MBLUR_MAX_FRAMES） */
export const mblurDirCount = (m: ClipMotionBlur) => Math.min(MBLUR_MAX_FRAMES - 1, 4 * clamp(Math.round(m.passes), 1, 4) - 1)
/** 快门里取样：时刻 t＋span·(k/(n−1)−½)；每个样本照那一刻的变形（xfAt）减这一刻 ⇒ 位移方向就是关键帧在这一刻前后的位移方向。
 *  这一刻占 1、其他每个占 混合/100；最后画这一刻。整段快门里位移 <0.05%、缩放差 <0.05%、旋转差 <0.05° ⇒ null（没在动·不模糊） */
export function mblurDirSamples(m: ClipMotionBlur, xfAt: (t: number) => XfLite, t: number): DirSample[] | null {
  if (!mblurActive(m) || lookFxNegOff()) return null
  const span = mblurSpan(m), n = mblurDirCount(m), c = xfAt(t)
  const raw: Array<Omit<DirSample, 'alpha'> & { w: number }> = []
  let moving = false
  for (let k = 0; k < n; k++) {
    const dt = span * (k / (n - 1) - 0.5)
    if (Math.abs(dt) < 1e-9) continue
    const x = xfAt(t + dt)
    const s = { dt, dtx: x.tx - c.tx, dty: x.ty - c.ty, ksx: c.sx ? x.sx / c.sx : 1, ksy: c.sy ? x.sy / c.sy : 1, drot: x.rot - c.rot, w: clamp(m.blend, 0, 100) / 100 }
    if (Math.abs(s.dtx) > 0.05 || Math.abs(s.dty) > 0.05 || Math.abs(s.ksx - 1) > 5e-4 || Math.abs(s.ksy - 1) > 5e-4 || Math.abs(s.drot) > 0.05) moving = true
    raw.push(s)
  }
  if (!moving) return null
  // 离这一刻远的先画（两头交错）·这一刻最后
  raw.sort((a, b) => Math.abs(b.dt) - Math.abs(a.dt) || a.dt - b.dt)
  raw.push({ dt: 0, dtx: 0, dty: 0, ksx: 1, ksy: 1, drot: 0, w: 1 })
  let sum = 0
  return raw.map(({ w, ...s }) => { sum += w; return { ...s, alpha: w / sum } })
}
/** 这一刻的位移方向（单位向量·画面座标 x 右 y 下·tx 以宽、ty 以高的百分比）：取快门最晚样本减最早样本；没动 ⇒ null */
export function mblurDirVector(samples: readonly DirSample[] | null): [number, number] | null {
  if (!samples || samples.length < 2) return null
  const a = samples.reduce((p, s) => (s.dt < p.dt ? s : p)), b = samples.reduce((p, s) => (s.dt > p.dt ? s : p))
  const dx = b.dtx - a.dtx, dy = b.dty - a.dty, L = Math.hypot(dx, dy)
  return L > 1e-9 ? [dx / L, dy / L] : null
}
/** 画布 2D 里用到的那几样（题用假画布录呼叫） */
export type Ctx2DLite = { save(): void; restore(): void; globalAlpha: number; translate(x: number, y: number): void; rotate(a: number): void; scale(x: number, y: number): void }
/** 照变形摆好（同汇出 xfm：画面正中＋位移 ⇒ 旋转 ⇒ 缩放 ⇒ 移回） */
export function applyXf(c: Ctx2DLite, xf: XfLite, W: number, H: number): void {
  c.translate(W / 2 + (xf.tx / 100) * W, H / 2 + (xf.ty / 100) * H)
  if (xf.rot) c.rotate((xf.rot * Math.PI) / 180)
  if (xf.sx !== 1 || xf.sy !== 1) c.scale(xf.sx, xf.sy)
  c.translate(-W / 2, -H / 2)
}
/** 叠样本（预览 DirBlurCanvas 与汇出 drawMedia 都呼叫这一个）：c 先清空（透明）；每个样本照「这一刻变形＋样本差」摆好、带 alpha 画一次 layer */
export function drawDirSamples(c: Ctx2DLite, samples: readonly DirSample[], xf: XfLite, W: number, H: number, layer: (c: Ctx2DLite) => void): void {
  for (const s of samples) {
    c.save()
    c.globalAlpha = s.alpha
    applyXf(c, { tx: xf.tx + s.dtx, ty: xf.ty + s.dty, rot: xf.rot + s.drot, sx: xf.sx * s.ksx, sy: xf.sy * s.ksy }, W, H)
    layer(c)
    c.restore()
  }
}
