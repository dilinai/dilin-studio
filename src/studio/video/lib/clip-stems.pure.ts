// 网页剪辑页·时间轴片段右键「分离人声」的纯函数。
// 做法（页面在 video-edit/vedit-clip-stems.ts＋VeditClipStems.tsx）：
//   ① 只拆这段用到的那截素材（stemsSourceRange·前后各多拆 STEMS_PAD 秒·对齐到取样格）；
//   ② 有装好 AI 分轨的终端 ⇒ 交终端（壳出 htdemucs_6s 六轨·人声＝vocals·伴奏＝其余五轨加起来·mixStems）；没有 ⇒ 照编曲「拆人声」那条在这台浏览器拆（人声／纯伴奏两轨）；
//   ③ 人声、伴奏各进素材区，再各放一段到音频轨，跟原片段同起点同长度、素材时刻一一对上（placeStems·入点减掉①的起点）；原片段静音（免得两份声音叠着）。
// 本档只放判据与轨道改法（题直接跑）·⛔ 碰 fetch／DOM／音频解码。
import { STEM_NAMES, type StemName } from './shell-media.pure'
import { applyDrop, canSeparateVocals, findClip, planDrop, srcAt, type MediaKindLike, type TlClip, type Tracks } from './timeline.pure'

/** 送去拆的那截前后各多带几秒（模型在头尾会糊一点·也留一点余地给之后往外拉边）；素材头尾到了就不再多 */
export const STEMS_PAD = 1
/** 伴奏＝六轨里人声以外那五轨加起来 */
export const ACCOMP_STEMS: readonly StemName[] = STEM_NAMES.filter((k) => k !== 'vocals')

/** 这几段（右键选单的对象）里能分离人声的、照给的顺序（锁了的轨、文字贴纸滤镜程序、没声音的不算） */
export function stemsTargets(tr: Tracks, ids: readonly string[], kindOf: (mediaId: string) => MediaKindLike | undefined): string[] {
  return [...new Set(ids)].filter((id) => canSeparateVocals(tr, id, kindOf))
}

/** 这段用到素材的哪一截（秒·from 对齐到取样格往下取、to 往上取）：变速／曲线变速／倒放都照 srcAt 换；
 *  dur＝素材全长（不知道 ⇒ 0／非数＝不夹尾）；截出来不到 1 个取样 ⇒ null */
export function stemsSourceRange(c: Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve' | 'reverse' | 'freeze'>, dur: number, sr: number): { from: number; to: number } | null {
  if (c.freeze || !(c.length > 0) || !(sr > 0)) return null
  const a = srcAt(c, c.start), b = srcAt(c, c.start + c.length)
  let lo = Math.max(0, Math.min(a, b) - STEMS_PAD)
  let hi = Math.max(a, b) + STEMS_PAD
  if (Number.isFinite(dur) && dur > 0) hi = Math.min(hi, dur)
  lo = Math.floor(lo * sr) / sr
  hi = Math.ceil(hi * sr) / sr
  if (!(hi - lo >= 1 / sr)) return null
  return { from: lo, to: hi }
}
/** 那截要几个取样（解码后照这个长度截齐／补零·人声伴奏跟原声一格不差） */
export const stemsSampleCount = (r: { from: number; to: number }, sr: number) => Math.max(1, Math.round((r.to - r.from) * sr))

/** 几轨（每轨左右两声道）加成一轨·长度一律 n（短的补零、长的截掉） */
export function mixStems(parts: ReadonlyArray<readonly [Float32Array, Float32Array]>, n: number): [Float32Array, Float32Array] {
  const L = new Float32Array(n), R = new Float32Array(n)
  for (const [l, r] of parts) {
    const m = Math.min(n, l.length, r.length)
    for (let i = 0; i < m; i++) { L[i] += l[i]; R[i] += r[i] }
  }
  return [L, R]
}
/** 一个声道截齐／补零到 n */
export function fitLength(ch: Float32Array, n: number): Float32Array {
  if (ch.length === n) return ch
  const out = new Float32Array(n)
  out.set(ch.subarray(0, Math.min(n, ch.length)))
  return out
}

/** 拆出来那一轨在素材区的样子（编号＋那截从原素材第几秒起） */
export type StemMedia = { mediaId: string }
/** 放回轨道：原片段那段（id）还在、还能分 ⇒ 人声一段、伴奏一段放进音频轨（人声在上·伴奏紧贴在它下面·被占就往下新增一条）·
 *  两段跟原片段同起点、同长度、同变速／曲线／倒放／淡入淡出／音量（含音量关键帧）／声音处理，入点＝原入点−from（拆的那截从 from 起）；
 *  原片段设静音（右键「取消静音」可以还原）。原片段不在了／不能分了 ⇒ null（页面只把档放进素材区）。 */
export function placeStems(tr: Tracks, id: string, from: number, parts: { vocals: StemMedia; inst: StemMedia }, kindOf: (mediaId: string) => MediaKindLike | undefined, newId: () => string, newLaneId: () => string): { tracks: Tracks; ids: [string, string] } | null {
  if (!canSeparateVocals(tr, id, kindOf)) return null
  const { lane, clip: c } = findClip(tr, id)!
  const shift = (t: number) => Math.round((t - from) * 1e6) / 1e6
  const make = (mediaId: string): TlClip => ({
    id: newId(), mediaId, start: c.start, length: c.length, offset: Math.max(0, shift(c.offset)),
    ...(c.volume !== undefined ? { volume: c.volume } : {}), ...(c.speed !== undefined ? { speed: c.speed } : {}), ...(c.pitch ? { pitch: true } : {}),
    ...(c.fadeIn ? { fadeIn: c.fadeIn } : {}), ...(c.fadeOut ? { fadeOut: c.fadeOut } : {}), ...(c.curve ? { curve: c.curve } : {}), ...(c.reverse ? { reverse: true } : {}),
    ...(c.aud ? { aud: c.aud } : {}),
    // 关键帧的时刻＝素材第几秒 ⇒ 只带音量那条、跟着入点一起挪
    ...(c.kf?.vol?.length ? { kf: { vol: c.kf.vol.map((k) => ({ ...k, t: shift(k.t) })) } } : {}),
  })
  // 原片段先静音（放进去之前改·免得 planDrop 当成别的段）
  let out = tr.map((l) => (l.id === lane.id ? { ...l, clips: l.clips.map((x) => (x.id === id ? { ...x, muted: true } : x)) } : l))
  const v = make(parts.vocals.mediaId)
  const pv = planDrop(out, 'audio', lane.kind === 'audio' ? { lane: lane.id } : null, c.start, c.length)
  const vLane = pv.lane ?? newLaneId()
  out = applyDrop(out, pv, v, vLane)
  const a = make(parts.inst.mediaId)
  const pa = planDrop(out, 'audio', { lane: vLane }, c.start, c.length)
  out = applyDrop(out, pa, a, pa.lane ?? newLaneId())
  return { tracks: out, ids: [v.id, a.id] }
}
