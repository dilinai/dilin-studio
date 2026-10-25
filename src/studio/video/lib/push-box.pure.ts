// 网页剪辑页·推镜头「推到框」（漂浮屏幕截图推拉）：
// 选中影片／图片片段 ⇒ 在预览画面拉一个框（画面比例座标·中心＋宽高）⇒「套用」在这段打两组位置／缩放关键帧（sx／sy／x／y·沿用 kf 机制与 lookOf）：
//   播放头处＝当下的值；播放头＋时长处＝那个框正好放大填满画面（照画面比例取装得下的等比缩放·框中心移到画面正中）。
// 框是画在「已经套了片段变换」的画面上：先用 motion-track.pure 的 hostXf／hostUnmap 扣掉片段这一刻的位移／旋转／缩放（含关键帧、片段动画）换成片段座标，
//   终点缩放＝现在的缩放 × 放大倍数·再反算位移让那块落到正中 ⇒ 已经放大过的片段再推一次也对。
// 缓动写在播放头那颗（往终点那段）·同面板关键帧缓动选项（keyframe.pure EASE_PRESETS）。
// 本档只放纯函数（题直接跑）：页面（ClipInspector「推镜头」组）与命令 clip.pushToBox 都叫这里。
import { srcAt, type TlClip, type Tracks } from './timeline.pure'
import { POS_LIM, SCALE_MAX, SCALE_MIN, lookOf } from './clip-look.pure'
import { hostMap, hostUnmap, hostXf, type HostXf, type TrackBox } from './motion-track.pure'
import { KF_EPS, kfIndexAt, kfPut, normalizeKf, type KfEase, type KfTracks } from './keyframe.pure'

export const PUSH_DUR_DEFAULT = 1
export const PUSH_DUR_MIN = 0.1
export const PUSH_DUR_MAX = 30
/** 框太小（占画面 <1.5%）不收（拉框手滑） */
export const PUSH_BOX_MIN = 0.015
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10000) / 10000

/** 药：DILIN_NEG 含 vedit_push_box_off ⇒ 不扣片段已有变换（当没缩放没位移）、缓动不写进关键帧（只在 node 测试跑） */
export function pushNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_push_box_off')
}
const ID: HostXf = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 }

type PushClip = Pick<TlClip, 'look' | 'anim' | 'start' | 'length' | 'offset'> & Partial<Pick<TlClip, 'kf' | 'speed' | 'curve'>>
export type PushVals = { sx: number; sy: number; x: number; y: number }
/** 框（画面比例·中心＋宽高）在时间轴第 t 秒这一刻要放大填满画面时，这段的 sx／sy／x／y（look 单位：x 占画面宽、y 占画面高往上为正）；aspect＝画面宽／高 */
export function pushTarget(c: PushClip, t: number, box: TrackBox, aspect: number): PushVals {
  const neg = pushNegOff()
  const l = lookOf(c, t)
  const h = neg ? ID : hostXf(c, t)
  const [ux, uy] = hostUnmap(h, aspect, box.x, box.y) // 框中心在片段座标
  const m = 1 / Math.max(box.w, box.h, 1e-3) // 框宽、高各占画面几成 ⇒ 都 ≤1 的最大倍数
  let sx = (neg ? 1 : l.sx) * m, sy = (neg ? 1 : l.sy) * m
  const k = Math.min(1, SCALE_MAX / Math.max(sx, sy)) // 夹上限（等比一起缩）
  sx = clamp(sx * k, SCALE_MIN, SCALE_MAX); sy = clamp(sy * k, SCALE_MIN, SCALE_MAX)
  // 终点变换先不带位移：框中心落在哪 ⇒ 位移补回正中
  const h1: HostXf = { tx: 0, ty: 0, rot: neg ? 0 : l.rot, sx: sx * (l.flipH ? -1 : 1), sy: sy * (l.flipV ? -1 : 1) }
  const [px, py] = hostMap(h1, aspect, ux, uy)
  return { sx: r4(sx), sy: r4(sy), x: r4(clamp(0.5 - px, -POS_LIM, POS_LIM)), y: r4(clamp(py - 0.5, -POS_LIM, POS_LIM)) }
}

export type PushResult = { kf: KfTracks; t0: number; t1: number; from: PushVals; to: PushVals }
/** 推到框的关键帧：t0＝播放头（时间轴秒·要在片段里）·dur＝秒数（到片尾为止）·ease＝t0 那颗往终点那段的缓动。
 *  两颗之间原有的 sx／sy／x／y 关键帧拿掉（不然推的路上会被拉走）；其余关键帧留着。不合（播放头不在片段里、剩不到一格）⇒ null */
export function pushBoxKeys(c: PushClip, t0: number, box: TrackBox, dur: number, ease: KfEase, aspect: number): PushResult | null {
  const end = c.start + c.length
  if (!(t0 >= c.start - 1e-6 && t0 < end - 1e-6) || !(box.w > 0 && box.h > 0)) return null
  const t1 = Math.min(t0 + clamp(dur, PUSH_DUR_MIN, PUSH_DUR_MAX), end)
  if (t1 - t0 < 1 / 30 - 1e-6) return null
  const l = lookOf(c, t0)
  const from: PushVals = { sx: r4(l.sx), sy: r4(l.sy), x: r4(l.x), y: r4(l.y) }
  const to = pushTarget(c, t0, box, aspect)
  const s0 = srcAt(c as TlClip, t0), s1 = srcAt(c as TlClip, t1)
  const kf: KfTracks = { ...(c.kf ?? {}) }
  const neg = pushNegOff()
  for (const p of ['sx', 'sy', 'x', 'y'] as const) {
    let tr = (kf[p] ?? []).filter((k) => !(k.t > s0 + KF_EPS && k.t < s1 - KF_EPS))
    tr = kfPut(tr, s0, from[p], neg ? undefined : ease)
    tr = kfIndexAt(tr, s1) >= 0 ? kfPut(tr, s1, to[p]) : kfPut(tr, s1, to[p], 'linear')
    kf[p] = tr
  }
  return { kf: normalizeKf(kf) ?? {}, t0, t1, from, to }
}
/** 套到轨道（锁了的轨／找不到／不合 ⇒ null） */
export function applyPushBox(tr: Tracks, id: string, t0: number, box: TrackBox, dur: number, ease: KfEase, aspect: number): Tracks | null {
  for (const l of tr) {
    const c = l.clips.find((x) => x.id === id)
    if (!c) continue
    if (l.locked || l.kind !== 'visual') return null
    const r = pushBoxKeys(c, t0, box, dur, ease, aspect)
    if (!r) return null
    return tr.map((q) => (q === l ? { ...q, clips: q.clips.map((x) => (x.id === id ? { ...x, kf: r.kf } : x)) } : q))
  }
  return null
}
