// 角色看一帧（video_edit_frame）的纯函数：出几格、多大、那一刻画面上有什么。
//   画法本身在网站那边（借汇出那支 frameDrawer）；这里零 DOM（单测直载）。
import { FRAME, layersAt, timelineEnd, type MediaKindLike, type TextAnimSet, type Tracks } from './timeline.pure'
import { fxStateAt } from './fx.pure'
import { animSpans } from './text-anim.pure'

/** 一次最多几格 */
export const VEDIT_FRAME_MAX_TIMES = 6
/** 出图长边（px）：下限／上限／缺省 */
export const VEDIT_FRAME_SIZE_MIN = 200
export const VEDIT_FRAME_SIZE_MAX = 1600
export const VEDIT_FRAME_SIZE_DEFAULT = 960

/** 长边夹进范围（不是数 ⇒ 缺省） */
export function clampFrameSize(v: unknown): number {
  const n = Number(v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return VEDIT_FRAME_SIZE_DEFAULT
  return Math.min(VEDIT_FRAME_SIZE_MAX, Math.max(VEDIT_FRAME_SIZE_MIN, Math.round(n)))
}

/** 画面比例（宽／高·null＝16:9 同汇出）⇒ 长边＝maxSize 的出图尺寸 */
export function frameSize(ratio: number | null, maxSize: number): { w: number; h: number } {
  const r = ratio !== null && Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
  const m = Math.max(2, Math.round(maxSize))
  return r >= 1 ? { w: m, h: Math.max(2, Math.round(m / r)) } : { w: Math.max(2, Math.round(m * r)), h: m }
}

/** 要画哪几秒：没给 ⇒ 播放头；夹在 0..最后一格（同汇出静帧·过了尾巴就画最后一格）·三位小数 */
export function frameTimes(times: readonly number[] | undefined, playhead: number, tracks: Tracks): number[] {
  const end = timelineEnd(tracks)
  const last = Math.max(0, end - FRAME)
  const list = times && times.length ? times.slice(0, VEDIT_FRAME_MAX_TIMES) : [playhead]
  return list.map((t) => Math.round(Math.min(Math.max(0, Number.isFinite(t) ? t : 0), last) * 1000) / 1000)
}

/** 那一刻每条轨上的片段（上到下·同 tracks 序）：lane／kind／clip、看不看得到、是什么（素材名／文字／贴纸／滤镜／程序包）、素材播到第几秒 */
export type FrameLayer = {
  lane: string; laneKind: string; clip: string; visible: boolean
  media?: { id: string; name: string | null; kind: MediaKindLike | null; at: number }
  text?: string; sticker?: string; filter?: string; program?: string; adjust?: true; shape?: string; solid?: string; bgfx?: string
  flags?: string[]
  /** 此刻在接缝转场窗内 ⇒ 哪款、前段 from／后段 to、进度 0–1（照时间匀速·0＝刚进窗 1＝出窗）、整段几秒 */
  transition?: { tr: string; from: string; to: string; progress: number; length: number }
  /**（同上「不列文字当下的入场动画进度」）：这段的动画此刻走到哪——入场／出场 progress 0–1（入场 1＝已定住·出场 0＝还没开始）、active＝正在动；循环 phase＝一圈里的位置 */
  anim?: FrameAnim
}
export type FrameAnim = { in?: { id: string; dur: number; progress: number; active: boolean }; out?: { id: string; dur: number; progress: number; active: boolean }; loop?: { id: string; dur: number; phase: number } }
const r3 = (v: number) => Math.round(v * 1000) / 1000
const c01 = (v: number) => Math.min(1, Math.max(0, v))
/** 动画此刻的进度（时间算法同 textAnimPose：seg＝片段自己的秒·local＝循环用的秒；入场＋出场比片段长 ⇒ 照 animSpans 按比例缩短） */
export function animProgress(a: TextAnimSet | undefined, seg: number, length: number, local: number = seg): FrameAnim | undefined {
  if (!a) return undefined
  const { inD, outD } = animSpans(a, length)
  const o: FrameAnim = {}
  if (a.in) { const p = inD > 0 ? c01(seg / inD) : 1; o.in = { id: a.in.id, dur: r3(inD), progress: r3(p), active: inD > 0 && seg >= 0 && seg < inD } }
  if (a.out) { const p = outD > 0 ? c01((seg - (length - outD)) / outD) : 0; o.out = { id: a.out.id, dur: r3(outD), progress: r3(p), active: outD > 0 && seg > length - outD } }
  if (a.loop && a.loop.dur > 0) o.loop = { id: a.loop.id, dur: a.loop.dur, phase: r3((((local / a.loop.dur) % 1) + 1) % 1) }
  return Object.keys(o).length ? o : undefined
}
export function frameLayers(tracks: Tracks, t: number, mediaOf: (id: string) => { name: string; kind: MediaKindLike } | null | undefined): FrameLayer[] {
  const out: FrameLayer[] = []
  for (const s of layersAt(tracks, t)) {
    if (!s.hit) continue
    const c = s.hit.clip
    const row: FrameLayer = { lane: s.lane.id, laneKind: s.lane.kind, clip: c.id, visible: s.show }
    if (c.text) row.text = c.text.content
    else if (c.sticker) row.sticker = c.sticker.sticker
    else if (c.filter) row.filter = c.filter.filter
    else if (c.program) row.program = c.program.pkg
    else if (c.shape) row.shape = c.shape.shape
    else if (c.solid) row.solid = c.solid.color
    else if (c.bgfx) row.bgfx = c.bgfx.kind
    else if (c.adjust) row.adjust = true
    else if (c.mediaId) { const m = mediaOf(c.mediaId); row.media = { id: c.mediaId, name: m?.name ?? null, kind: m?.kind ?? null, at: Math.round(s.hit.local * 1000) / 1000 } }
    // 转场（画面轨·同汇出 fxStateAt 认的那个窗）与动画进度（文字＝text.anim·画面片段／贴纸＝clip.anim）
    const st = s.lane.kind === 'visual' ? fxStateAt(s.lane, t) : null
    if (st?.trans?.head) {
      const L = c.transIn?.length ?? 0 // 片头转场：从黑场进场（窗＝这段开头 L 秒）
      row.transition = { tr: st.trans.tr, from: '', to: c.id, progress: r3(L > 0 ? c01((t - c.start) / L) : 0), length: r3(L) }
    } else if (st?.trans) {
      const later = st.trans.live === 'to' ? c : st.trans.other.clip, earlier = st.trans.live === 'to' ? st.trans.other.clip : c
      const L = later.transIn?.length ?? 0
      row.transition = { tr: st.trans.tr, from: earlier.id, to: later.id, progress: r3(L > 0 ? c01((t - (later.start - L / 2)) / L) : 0), length: r3(L) }
    }
    const an = c.text ? animProgress(c.text.anim, s.hit.local - c.offset, c.length, s.hit.local) : animProgress(c.anim, Math.max(0, t - c.start), c.length, Math.max(0, t - c.start))
    if (an) row.anim = an
    const flags = [s.lane.hidden && 'lane_hidden', c.disabled && 'disabled', (s.lane.muted || c.muted) && 'muted', c.freeze && 'freeze', c.reverse && 'reverse'].filter((x): x is string => !!x)
    if (flags.length) row.flags = flags
    out.push(row)
  }
  return out
}

/** 一格帧图压成多大的 dataURL：先 PNG（字清楚）·超过这格的预算 ⇒ JPEG 0.9 ⇒ 0.75（整件结果要过中继口的上限） */
export const VEDIT_FRAME_REPLY_BUDGET = 10 * 1024 * 1024
export function frameEncodePlan(count: number): { budget: number; steps: Array<{ type: 'image/png' | 'image/jpeg'; quality?: number }> } {
  return { budget: Math.floor(VEDIT_FRAME_REPLY_BUDGET / Math.max(1, count)), steps: [{ type: 'image/png' }, { type: 'image/jpeg', quality: 0.9 }, { type: 'image/jpeg', quality: 0.75 }] }
}
