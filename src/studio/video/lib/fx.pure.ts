// 网页剪辑页·特效与转场：「程序片段」轨道跟素材同级、是内容本体；特效、转场是点缀，标在原有素材上、不进程序轨。库＝自写转场＋特效（fx.data·GLSL）。
// 特效＝标在画面轨素材片段身上（TlClip.fx·跟着片段挪、剪·剪开两段都带）；转场＝标在同轨两段尾接头的接缝上（存在后一段 TlClip.transIn·
// 横跨切点两侧各一半·两段分开 ⇒ 不起作用·剪开时后段不带）。预览由 VeditFxCanvas 用 WebGL2 照这里算出的进度跑着色器。
// 本档只放纯函数（题直接跑）。⛔ 碰 DOM。
import { studioStaticHref } from '../../shared/host'
import { FX_ITEMS, type FxItem, type FxKind } from './fx.data'
import { EPS_TIME, findClip, snapFrame, type ClipFx, type Lane, type TlClip, type TransBody, type Tracks } from './timeline.pure'
import { lookOf } from './clip-look.pure'

export const FX_DRAG_MIME = 'application/x-dilin-vedit-fx'
export const TRANS_DRAG_MIME = 'application/x-dilin-vedit-transition'
/** 一段最多几个特效 */
export const FX_MAX_PER_CLIP = 4
export const TRANS_DEFAULT = 0.8
export const TRANS_MIN = 0.2
export const TRANS_MAX = 3
/** 特效在片段头尾各淡入淡出多久（片子短就再短） */
export const FX_FADE = 0.15

const BY_ID = new Map(FX_ITEMS.map((x) => [x.id, x]))
export const fxById = (id: string | undefined): FxItem | null => (id ? BY_ID.get(id) ?? null : null)
export const fxThumb = (id: string) => studioStaticHref(`/vedit/fx/${id}.jpg`)
export type FxLang = 'zh-TW' | 'zh-CN' | 'en'
export const fxName = (id: string, lang: FxLang): string => { const it = fxById(id); return it ? (lang === 'zh-CN' ? it.name.cn : lang === 'en' ? it.name.en : it.name.tw) : id }
/** 左清单那一类有哪几款（类编号照剪映那排·特效 scene-…／转场 effects-…） */
export const fxIn = (kind: FxKind, cat: string): FxItem[] => FX_ITEMS.filter((x) => x.kind === kind && x.cats.includes(cat))
export const isFxCat = (kind: FxKind, cat: string): boolean => FX_ITEMS.some((x) => x.kind === kind && x.cats.includes(cat))

/** 特效、转场只加在画面轨的素材片段（影片／图片）上 */
export const decoratable = (lane: Lane, c: TlClip): boolean => lane.kind === 'visual' && !!c.mediaId && !c.text && !c.sticker && !c.filter && !c.program
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const endOf = (c: TlClip) => c.start + c.length
const editLane = (tr: Tracks, lane: Lane, f: (c: TlClip) => TlClip, id: string): Tracks =>
  tr.map((l) => (l !== lane ? l : { ...l, clips: l.clips.map((c) => (c.id === id ? f(c) : c)) }))

// ── 特效（片段身上）──
/** 给一段加一款特效（同款不重复·满了不加·锁了的轨不加）；加不了 ⇒ 原物件 */
export function addEffect(tr: Tracks, clipId: string, fxId: string): Tracks {
  const hit = findClip(tr, clipId)
  const it = fxById(fxId)
  if (!hit || !it || it.kind !== 'effect' || hit.lane.locked || !decoratable(hit.lane, hit.clip)) return tr
  const list = hit.clip.fx ?? []
  if (list.some((x) => x.fx === fxId) || list.length >= FX_MAX_PER_CLIP) return tr
  return editLane(tr, hit.lane, (c) => ({ ...c, fx: [...list, { fx: fxId, strength: 1 }] }), clipId)
}
export function removeEffect(tr: Tracks, clipId: string, fxId: string): Tracks {
  const hit = findClip(tr, clipId)
  if (!hit || hit.lane.locked || !hit.clip.fx?.some((x) => x.fx === fxId)) return tr
  return editLane(tr, hit.lane, (c) => {
    const left = (c.fx ?? []).filter((x) => x.fx !== fxId)
    const { fx: _f, ...rest } = c
    void _f
    return left.length ? { ...c, fx: left } : rest
  }, clipId)
}
export function setEffectStrength(tr: Tracks, clipId: string, fxId: string, strength: number): Tracks {
  const hit = findClip(tr, clipId)
  const v = clamp(Number.isFinite(strength) ? strength : 0, 0, 1)
  const cur = hit?.clip.fx?.find((x) => x.fx === fxId)
  if (!hit || hit.lane.locked || !cur || Math.abs(cur.strength - v) < 1e-9) return tr
  return editLane(tr, hit.lane, (c) => ({ ...c, fx: (c.fx ?? []).map((x) => (x.fx === fxId ? { ...x, strength: v } : x)) }), clipId)
}

// ── 转场（接缝上）──
/** 这段前面紧接着的那段（同轨·前一段的尾＝这段的头）；没有 ⇒ null */
export function prevAbutting(lane: Lane, c: TlClip): TlClip | null {
  return lane.clips.find((x) => x.id !== c.id && Math.abs(endOf(x) - c.start) < EPS_TIME && decoratable(lane, x)) ?? null
}
export function nextAbutting(lane: Lane, c: TlClip): TlClip | null {
  return lane.clips.find((x) => x.id !== c.id && Math.abs(x.start - endOf(c)) < EPS_TIME && decoratable(lane, x)) ?? null
}
/** 这个接缝（right＝后一段）转场最长多长：两边各一半不能超出那一段、也不能跟那一段另一头的转场叠在一起 */
export function transLimit(lane: Lane, right: TlClip): number {
  const left = prevAbutting(lane, right)
  const nx0 = nextAbutting(lane, right)
  // 片头转场（前面没接着别段）：整个转场在这段开头里（从黑场进场）·不能跟尾巴那个接缝的转场叠
  if (!left) return Math.min(TRANS_MAX, right.length - (nx0?.transIn ? nx0.transIn.length / 2 : 0))
  const leftIn = left.transIn && prevAbutting(lane, left) ? left.transIn.length / 2 : 0
  const nx = nextAbutting(lane, right)
  const rightOut = nx?.transIn ? nx.transIn.length / 2 : 0
  return Math.min(TRANS_MAX, 2 * (left.length - leftIn), 2 * (right.length - rightOut))
}
/** 接缝上放／换一款转场（right＝后一段·接缝要真的接上·锁了的轨不放）；length 缺 ⇒ 原有的长度或默认 0.8 秒·夹在可放范围；放不了 ⇒ 原物件 */
export function setTransition(tr: Tracks, rightId: string, trId: string, length?: number): Tracks {
  const hit = findClip(tr, rightId)
  const it = fxById(trId)
  if (!hit || !it || it.kind !== 'transition' || hit.lane.locked || !decoratable(hit.lane, hit.clip)) return tr
  const lim = transLimit(hit.lane, hit.clip)
  if (lim < TRANS_MIN - 1e-9) return tr
  // 换款时：这款有自己的默认长度（len·照原片节奏定的）⇒ 用它；同款改长度 ⇒ 照给的
  const keep = hit.clip.transIn && hit.clip.transIn.tr === trId ? hit.clip.transIn.length : undefined
  const want = length ?? keep ?? it.len ?? hit.clip.transIn?.length ?? TRANS_DEFAULT
  const body: TransBody = { tr: trId, length: snapFrame(clamp(want, TRANS_MIN, lim)) }
  if (hit.clip.transIn && hit.clip.transIn.tr === body.tr && Math.abs(hit.clip.transIn.length - body.length) < 1e-9) return tr
  return editLane(tr, hit.lane, (c) => ({ ...c, transIn: body }), rightId)
}
export function setTransLength(tr: Tracks, rightId: string, length: number): Tracks {
  const hit = findClip(tr, rightId)
  return hit?.clip.transIn ? setTransition(tr, rightId, hit.clip.transIn.tr, length) : tr
}
export function removeTransition(tr: Tracks, rightId: string): Tracks {
  const hit = findClip(tr, rightId)
  if (!hit || hit.lane.locked || !hit.clip.transIn) return tr
  const { transIn: _t, ...rest } = hit.clip
  void _t
  return editLane(tr, hit.lane, () => rest, rightId)
}
/** 点一款转场放到哪个接缝（回后一段的编号）：选中了画面轨素材片段 ⇒ 它两头离播放头近的那个（开头前面空着 ⇒ 片头转场）；
 *  没选 ⇒ 由上到下第一条画面轨里离播放头最近、2 秒内的接缝；都没有 ⇒ null */
export function seamFor(tr: Tracks, picked: string | null, t: number): string | null {
  if (picked) {
    const hit = findClip(tr, picked)
    if (hit && decoratable(hit.lane, hit.clip)) {
      const cand = [{ id: hit.clip.id, at: hit.clip.start }, (() => { const n = nextAbutting(hit.lane, hit.clip); return n ? { id: n.id, at: n.start } : null })()]
        .filter((x): x is { id: string; at: number } => !!x).sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))
      if (cand.length) return cand[0].id
    }
  }
  for (const lane of tr) {
    if (lane.kind !== 'visual' || lane.locked) continue
    const seams = lane.clips.filter((c) => decoratable(lane, c) && prevAbutting(lane, c)).sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t)) // 没选 ⇒ 只找真接缝（片头转场要先选那段或拖到它开头）
    if (seams.length && Math.abs(seams[0].start - t) <= 2) return seams[0].id
  }
  return null
}
/** 拖一款转场放手：那条轨上离放手点最近的接缝（tolerance 秒内）；没有 ⇒ null */
export function seamNear(lane: Lane, t: number, tolerance: number): string | null {
  const seams = lane.clips.filter((c) => decoratable(lane, c)).sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))
  return seams.length && Math.abs(seams[0].start - t) <= tolerance ? seams[0].id : null
}
/** 这条轨上起作用的转场（时间轴画接缝标记用）：后一段编号、切点、长度、款 */
export function laneSeams(lane: Lane): Array<{ id: string; cut: number; length: number; tr: string; head?: true }> {
  return lane.clips.filter((c) => c.transIn && decoratable(lane, c)).map((c) => ({ id: c.id, cut: c.start, length: c.transIn!.length, tr: c.transIn!.tr, ...(prevAbutting(lane, c) ? {} : { head: true as const }) }))
}

// ── 预览这一刻要画什么 ──
const smooth = (p: number) => p * p * (3 - 2 * p)
export type FxPass = { fx: string; strength: number; progress: number; amount: number; time: number }
/** other.fx＝另一段身上的特效（这一刻）·other.rel＝另一段的缩放÷这段的缩放（[横, 竖]·整层会照这段的缩放放大，另一段先按这个比例画进去才会是它自己的大小） */
export type TransPass = { tr: string; progress: number; live: 'from' | 'to'; other: { clip: TlClip; source: number; fx: FxPass[]; rel: [number, number] }
  /** 片头转场（前面没接着别段）：另一边＝黑场（画的那头用全黑一格当 other·other.clip＝这段自己·不取素材） */ head?: true }
/** 这段身上的转场是片头转场（带 transIn、前面没接着别段） */
export const isHeadTrans = (lane: Lane, c: TlClip): boolean => !!c.transIn && decoratable(lane, c) && !prevAbutting(lane, c)
/** 片头转场在时间轴 t 的进度（窗＝这段开头 length 秒·0＝全黑场·1＝全是这段）；不在窗内 ⇒ null */
const headNeg = (): boolean => { const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''; return typeof window === 'undefined' && env.split(',').includes('vedit_shape_solid_off') } // 药（同 shape.pure shapeSolidNeg）
export function headTransProgress(c: TlClip, t: number): number | null {
  const L = c.transIn?.length ?? 0, local = t - c.start
  if (!(L > 0) || local < -EPS_TIME || local >= L || headNeg()) return null
  return transProgress(c.transIn!.tr, clamp(local / L, 0, 1))
}
/** 进度怎么走：款的缓动写 linear ⇒ 照时间匀速（着色器自己算节奏）；其余 ⇒ 头尾放缓 */
const transProgress = (trId: string, p: number) => (fxById(trId)?.ease === 'linear' ? p : smooth(p))
/** 一段在时间轴 t 这一刻身上的特效（local＝段内第几秒）：款的缓动写 none ⇒ 整段恒定强度（不在头尾淡入淡出·免得接缝处闪一下） */
function clipEffects(c: TlClip, local: number): FxPass[] {
  const fade = Math.min(FX_FADE, c.length / 4)
  const env = fade <= 0 ? 1 : clamp(Math.min(local / fade, (c.length - local) / fade), 0, 1)
  return (c.fx ?? []).filter((x) => fxById(x.fx)?.kind === 'effect' && x.strength > 0)
    .map((x) => ({ fx: x.fx, strength: x.strength, progress: c.length > 0 ? clamp(local / c.length, 0, 1) : 0, amount: (fxById(x.fx)?.ease === 'none' ? 1 : env) * x.strength, time: c.offset + local }))
}
const relScale = (other: TlClip, cur: TlClip, t: number): [number, number] => {
  const o = lookOf(other, t), k = lookOf(cur, t)
  return [k.sx > 0 ? o.sx / k.sx : 1, k.sy > 0 ? o.sy / k.sy : 1]
}
/** 一条画面轨这一刻：特效几道（压到的那段身上的）＋转场（压到接缝窗内）；都没有 ⇒ null。source＝另一段该取素材第几秒（借头尾手柄·页面再夹进素材长度） */
export function fxStateAt(lane: Lane, t: number): { clip: TlClip; effects: FxPass[]; trans: TransPass | null } | null {
  if (lane.kind !== 'visual') return null
  const c = lane.clips.find((x) => t >= x.start - EPS_TIME && t < endOf(x) - EPS_TIME)
  if (!c || !decoratable(lane, c) || c.disabled) return null
  const local = Math.max(0, t - c.start)
  const effects = clipEffects(c, local)
  let trans: TransPass | null = null
  // 压到自己开头那个接缝（这段是后一段）或结尾那个接缝（这段是前一段）的窗内
  const prev = c.transIn ? prevAbutting(lane, c) : null
  const next = nextAbutting(lane, c)
  const head = !prev && c.transIn && fxById(c.transIn.tr) ? headTransProgress(c, t) : null
  if (head !== null) {
    trans = { tr: c.transIn!.tr, progress: head, live: 'to', other: { clip: c, source: 0, fx: [], rel: [1, 1] }, head: true }
  } else if (prev && c.transIn && fxById(c.transIn.tr) && local < c.transIn.length / 2) {
    const L = c.transIn.length
    trans = { tr: c.transIn.tr, progress: transProgress(c.transIn.tr, clamp((t - (c.start - L / 2)) / L, 0, 1)), live: 'to',
      other: { clip: prev, source: prev.offset + prev.length + (t - c.start), fx: clipEffects(prev, t - prev.start).filter((x) => x.amount > 0), rel: relScale(prev, c, t) } }
  } else if (next?.transIn && fxById(next.transIn.tr) && endOf(c) - t < next.transIn.length / 2) {
    const L = next.transIn.length
    trans = { tr: next.transIn.tr, progress: transProgress(next.transIn.tr, clamp((t - (next.start - L / 2)) / L, 0, 1)), live: 'from',
      other: { clip: next, source: next.offset + (t - next.start), fx: clipEffects(next, t - next.start).filter((x) => x.amount > 0), rel: relScale(next, c, t) } }
  }
  if (!effects.length && !trans) return null
  return { clip: c, effects, trans }
}
