// 网页剪辑页·文字片段与滤镜片段的关键帧（同 keyframe.pure.ts 那套引擎）：
//   文字：位置 tx／ty（字块中心 0～1）·缩放 ts·旋转 trot·不透明度 top；滤镜：强度 flt（0～1）。
//   关键帧时刻同影片片段＝素材第几秒（srcAt·文字／滤镜没变速 ⇒ offset＋过了几秒）。预览、汇出、面板都照 textBodyAt／filterStrengthAt 取这一刻的值。
// 本档只放纯函数（题直接跑）。⛔ 碰 DOM。
import { findClip, srcAt, type TextBody, type TlClip, type Tracks } from './timeline.pure'
import { kfApply, kfIndexAt, kfSetEase, kfToggle, kfValue, normalizeKf, type KfEase, type KfProp, type KfTracks } from './keyframe.pure'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** 文字那几颗菱形各管哪几项 */
export const TEXT_KF = { scale: ['ts'], pos: ['tx', 'ty'], rot: ['trot'], opacity: ['top'] } as const satisfies Record<string, readonly KfProp[]>
export const TEXT_KF_PROPS: readonly KfProp[] = ['tx', 'ty', 'ts', 'trot', 'top']
const has = (kf: KfTracks | undefined, p: KfProp) => !!kf?.[p]?.length

/** 文字片段时间轴第 t 秒的样子（打过关键帧的那几项换成这一刻的值） */
export function textBodyAt(c: Pick<TlClip, 'text' | 'kf' | 'start' | 'length' | 'offset' | 'speed' | 'curve'>, t: number): TextBody | undefined {
  const b = c.text
  const kf = c.kf
  if (!b || !kf || !TEXT_KF_PROPS.some((p) => has(kf, p))) return b
  const s = srcAt(c, t)
  const o: TextBody = { ...b }
  if (has(kf, 'tx')) o.x = kfValue(kf.tx, s, b.x)
  if (has(kf, 'ty')) o.y = kfValue(kf.ty, s, b.y)
  if (has(kf, 'ts')) o.scale = clamp(kfValue(kf.ts, s, b.scale ?? 1), 0.05, 20)
  if (has(kf, 'trot')) o.rotate = kfValue(kf.trot, s, b.rotate ?? 0)
  if (has(kf, 'top')) o.opacity = clamp(kfValue(kf.top, s, b.opacity ?? 1), 0, 1)
  return o
}
/** 文字面板一笔改动里关键帧管得到的数值 */
const TEXT_FIELD: Record<string, KfProp> = { x: 'tx', y: 'ty', scale: 'ts', rotate: 'trot', opacity: 'top' }
/** 文字改动先过关键帧（at＝播放头）：打过关键帧的那几项 ⇒ 在这一刻补一颗／改那颗·从改动里拿掉；回 [新 kf, 剩下照旧改底值的改动] */
export function textKfSplit<P extends Record<string, unknown>>(c: TlClip, at: number, p: P): { kf: KfTracks | undefined; rest: P } {
  if (!c.kf || at < c.start - 1e-6 || at > c.start + c.length + 1e-6) return { kf: c.kf, rest: p }
  const vals: Partial<Record<KfProp, number>> = {}
  for (const [k, prop] of Object.entries(TEXT_FIELD)) { const v = p[k]; if (typeof v === 'number') vals[prop] = v }
  const r = kfApply(c.kf, srcAt(c, at), vals)
  const rest = { ...p }
  for (const [k, prop] of Object.entries(TEXT_FIELD)) if (prop in vals && !(prop in r.rest)) delete rest[k]
  return { kf: normalizeKf(r.kf), rest }
}
/** 文字菱形钮当下的值 */
export function textKfCurrent(c: TlClip, t: number, props: readonly KfProp[]): Partial<Record<KfProp, number>> {
  const b = textBodyAt(c, t)
  if (!b) return {}
  const v: Partial<Record<KfProp, number>> = { tx: b.x, ty: b.y, ts: b.scale ?? 1, trot: b.rotate ?? 0, top: b.opacity ?? 1 }
  return Object.fromEntries(props.filter((p) => p in v).map((p) => [p, v[p]!]))
}

/** 滤镜片段时间轴第 t 秒的强度（0～1·有关键帧照关键帧）；src＝已经算好的素材时刻（layersAt 的 local）可直接给 */
export function filterStrengthAt(c: Pick<TlClip, 'filter' | 'kf' | 'start' | 'length' | 'offset' | 'speed' | 'curve'>, t: number, src?: number): number {
  const base = c.filter?.strength ?? 0
  if (!c.kf?.flt?.length) return base
  return clamp(kfValue(c.kf.flt, src ?? srcAt(c, t), base), 0, 1)
}

/** 关键帧动作（菱形钮／缓动）套到这几段（文字、滤镜共用·只动 kf；播放头不在那段上的跳过） */
export type KfOp = { toggle?: readonly KfProp[]; ease?: { props: readonly KfProp[]; ease: KfEase } }
export function applyKfOp(tr: Tracks, ids: readonly string[], at: number, op: KfOp, current: (c: TlClip, props: readonly KfProp[]) => Partial<Record<KfProp, number>>): Tracks {
  let out = tr
  for (const id of ids) {
    const f = findClip(out, id)
    if (!f || f.lane.locked) continue
    const c = f.clip
    if (at < c.start - 1e-6 || at > c.start + c.length + 1e-6) continue
    const s = srcAt(c, at)
    let kf = c.kf
    if (op.toggle) kf = kfToggle(kf, s, current(c, op.toggle))
    if (op.ease) kf = kfSetEase(kf, s, op.ease.props, op.ease.ease)
    kf = normalizeKf(kf)
    if (JSON.stringify(kf) === JSON.stringify(c.kf)) continue
    const n: TlClip = { ...c }
    if (kf) n.kf = kf; else delete n.kf
    out = out.map((l) => (l.id !== f.lane.id ? l : { ...l, clips: l.clips.map((x) => (x.id === id ? n : x)) }))
  }
  return out
}
/** 滤镜强度改动先过关键帧：打过关键帧 ⇒ 在播放头补一颗（回 null＝没关键帧·照旧改底值） */
export function filterKfStrength(tr: Tracks, id: string, at: number, v: number): Tracks | null {
  const f = findClip(tr, id)
  const c = f?.clip
  if (!f || !c?.kf?.flt?.length || at < c.start - 1e-6 || at > c.start + c.length + 1e-6) return null
  const r = kfApply(c.kf, srcAt(c, at), { flt: clamp(v, 0, 1) })
  return tr.map((l) => (l.id !== f.lane.id ? l : { ...l, clips: l.clips.map((x) => (x.id === id ? { ...c, kf: normalizeKf(r.kf) } : x)) }))
}
export const kfOnClip = (c: TlClip, t: number, props: readonly KfProp[]) => { const s = srcAt(c, t); return props.some((p) => kfIndexAt(c.kf?.[p], s) >= 0) }
