// ═══════════════════════════════════════════════════════════════════════════════════════════
// 网页剪辑页·主轨磁吸的纯半（对照剪映时间轴右上两颗开关：左＝主轨磁吸、右＝自动吸附）。
// 回的读法（照这个做）：
//   ① 主轨磁吸开着：主轨的片段一段接一段从头排、中间不留空；删掉、裁短（含工具列向左／向右裁剪 Q／W）、拖走一段 ⇒ 后面的自动往前补；
//      拖进主轨的片段插进去、把后面的往后推（按落点在哪两段之间决定插入位置）。关掉就跟以前一样可以留空。
//   ② 两颗开关状态都记住（本机 localStorage·写法照 dilin.videoEdit.settings.v1 那份）。
// 规矩：只管主轨（其他轨照旧）；锁住的主轨不重排；打开那一下把主轨现有的空隙收紧（照剪映·页面走 edit() 进复原栈一步）。
// 接缝转场（transIn·标在「跟同轨前一段的接缝」上）：重排后这段的前一段换了人、而且是因为搬动／删掉／插进来才换的 ⇒ 那个接缝已经没了·转场一起拿掉
//   （同 trimAt 左裁「接缝转场跟着前面那截一起没了」的规矩）；只是往前补位、分割、裁剪（前一段还是同一段或只是分割出来的后段）⇒ 转场留着。
// 算法全在这里·页面（video-edit/page.tsx）只管接事件。⛔ 碰 DOM。
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { MAIN_LANE, MIN_CLIP, applyDrop, findClip, mainIndex, moveGroup, planDrop, snapFrame, trimClip,
  type DropHint, type DropPlan, type LaneKind, type MoveOpts, type TlClip, type Tracks } from './timeline.pure'

const EPS = 1e-6
const endOf = (c: TlClip) => c.start + c.length
const byStart = (a: TlClip, b: TlClip) => a.start - b.start
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mainOf = (tr: Tracks) => tr.find((l) => l.id === MAIN_LANE)
const NONE: ReadonlySet<string> = new Set()

// ── 两颗开关存本机──
export const VEDIT_TIMELINE_PREFS_KEY = 'dilin.videoEdit.timeline.v1'
/** magnet＝主轨磁吸；snap＝自动吸附（拖片段、拉两端、画面里拖字块贴纸贴齐对齐线·见 snap.pure） */
export type TimelinePrefs = { magnet: boolean; snap: boolean }
/** 缺省两颗都开（照剪映·附图两颗都亮着） */
export const TIMELINE_PREFS_DEFAULT: TimelinePrefs = { magnet: true, snap: true }
/** 读回开关（坏的、缺的格子用缺省·⛔ 抛） */
export function parseTimelinePrefs(raw: string | null): TimelinePrefs {
  if (!raw) return { ...TIMELINE_PREFS_DEFAULT }
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { ...TIMELINE_PREFS_DEFAULT } }
  if (!v || typeof v !== 'object') return { ...TIMELINE_PREFS_DEFAULT }
  const o = v as Record<string, unknown>
  return {
    magnet: typeof o.magnet === 'boolean' ? o.magnet : TIMELINE_PREFS_DEFAULT.magnet,
    snap: typeof o.snap === 'boolean' ? o.snap : TIMELINE_PREFS_DEFAULT.snap,
  }
}

// ── 排紧 ──
/** 插入位置：anchor（落点）在第几段之后——跟各段的中点比（过了那段的一半就排到它后面）；list 照起点排好 */
export function insertIndex(list: readonly TlClip[], anchor: number): number {
  return list.filter((c) => c.start + c.length / 2 <= anchor + EPS).length
}

/** 把主轨排紧：没搬动的照原本先后·moved（这一下刚放进主轨的那几段）整批插在 anchor（落点·缺＝它们最早那段的起点）落在的那两段之间·
 *  然后从 0 起一段接一段排；接缝转场照上面的规矩（prev＝这一下之前的轨道·拿来比「前一段换没换人」）。
 *  主轨锁了／没主轨 ⇒ 原物件；排完没变 ⇒ 原物件。 */
export function magnetPack(tr: Tracks, prev: Tracks | null, moved: ReadonlySet<string> = NONE, anchor?: number): Tracks {
  const main = mainOf(tr)
  if (!main || main.locked) return tr
  const stay = main.clips.filter((c) => !moved.has(c.id)).sort(byStart)
  const mov = main.clips.filter((c) => moved.has(c.id)).sort(byStart)
  const at = mov.length ? insertIndex(stay, anchor ?? mov[0].start) : 0
  const order = [...stay.slice(0, at), ...mov, ...stay.slice(at)]
  // 这一下之前主轨上各段的前一段是谁（不在主轨上的段 ⇒ 没记）
  const pm = prev ? mainOf(prev) : undefined
  const prevIds = pm ? [...pm.clips].sort(byStart).map((c) => c.id) : []
  const prevPred = new Map<string, string | null>(prevIds.map((id, k) => [id, k ? prevIds[k - 1] : null]))
  const here = new Set(order.map((c) => c.id))
  const torn = (id: string | null | undefined) => typeof id === 'string' && (moved.has(id) || !here.has(id))   // 搬走／删掉／刚插进来
  const out: TlClip[] = []
  let t = 0
  for (let k = 0; k < order.length; k++) {
    const c = order[k]
    const pred = k ? order[k - 1].id : null
    let n = c
    if (Math.abs(c.start - t) > EPS) n = { ...n, start: t }
    const pp = prevPred.get(c.id)
    if (n.transIn && pp !== pred && (moved.has(c.id) || torn(pp) || torn(pred))) {
      const { transIn: _drop, ...rest } = n
      void _drop
      n = rest
    }
    out.push(n)
    t = n.start + n.length
  }
  if (out.length === main.clips.length && out.every((c, k) => c === main.clips[k])) return tr
  return tr.map((l) => (l === main ? { ...l, clips: out } : l))
}

/** 页面每一笔改动（edit）用：主轨这一下有动到（主轨物件换了）⇒ 排紧；没动到主轨（改别的轨）⇒ 原物件（不顺手收别处留下的空） */
export function magnetEdit(raw: Tracks, prev: Tracks): Tracks {
  const a = mainOf(raw)
  return a && a !== mainOf(prev) ? magnetPack(raw, prev) : raw
}

// ── 拖进主轨＝插进去──
/** 素材拖进来的落点规划（磁吸版）：画面素材落到主轨（滑鼠在主轨上·或照原规划本来就进主轨）⇒ 不再因为被占而往上新开一条·
 *  改成插在落点所在的那两段之间（start＝插入处·页面灰底画在那）；别的情形照 planDrop。主轨锁了 ⇒ 照 planDrop。 */
export function magnetDropPlan(tr: Tracks, kind: LaneKind, hint: DropHint, want: number, length: number): DropPlan {
  const plan = planDrop(tr, kind, hint, want, length)
  if (kind !== 'visual') return plan
  const main = mainOf(tr)
  if (!main || main.locked) return plan
  const toMain = plan.lane === MAIN_LANE || (!!hint && 'lane' in hint && hint.lane === MAIN_LANE)
  if (!toMain) return plan
  const list = [...main.clips].sort(byStart)
  const at = insertIndex(list, Math.max(0, want))
  return { lane: MAIN_LANE, at: mainIndex(tr), kind, start: at ? endOf(list[at - 1]) : 0, length }
}
/** 照磁吸版落点放进去：进主轨 ⇒ 插好再排紧；别处照 applyDrop */
export function magnetDrop(tr: Tracks, plan: DropPlan, clip: TlClip, newLaneId: string): Tracks {
  const placed = applyDrop(tr, plan, clip, newLaneId)
  return plan.lane === MAIN_LANE ? magnetPack(placed, tr, new Set([clip.id])) : placed
}

/** 整批拖位（磁吸版）：主轨上原有的片段不挡路（moveGroup free）·落进主轨的那几段照 anchor（滑鼠落点·缺＝片头）插进去·然后排紧；
 *  从主轨拖走的 ⇒ 后面往前补。主轨锁了 ⇒ 照 moveGroup。 */
export function magnetMove(tr: Tracks, ids: readonly string[], dt: number, laneShift: number, opts: MoveOpts = {}, anchor?: number): Tracks {
  const main = mainOf(tr)
  if (!main || main.locked) return moveGroup(tr, ids, dt, laneShift, opts)
  const r = moveGroup(tr, ids, dt, laneShift, { ...opts, free: MAIN_LANE })
  const rm = mainOf(r)
  if (r === tr || rm === main) return r   // 没动到主轨（只在别的轨上拖）⇒ 不顺手收主轨的空（同 magnetEdit）
  const before = new Set(main.clips.map((c) => c.id))
  const moved = new Set((rm?.clips ?? []).filter((c) => !before.has(c.id) || (!opts.copy && ids.includes(c.id))).map((c) => c.id))
  return magnetPack(r, tr, moved, anchor)
}

/** 拉两端（磁吸版·只对主轨上的段）：这段留在原位（片头不动）·只改长度与入点——拉短 ⇒ 后面往前补；拉长 ⇒ 后面往后推（不再被下一段挡住）；
 *  影音照样不超出素材本身·最短一帧；图片两端随便拉。不在主轨／主轨锁了 ⇒ 照 trimClip。 */
export function rippleTrim(tr: Tracks, id: string, side: 'l' | 'r', to: number, srcDur: number): Tracks {
  const f = findClip(tr, id)
  if (!f || f.lane.id !== MAIN_LANE || f.lane.locked) return trimClip(tr, id, side, to, srcDur)
  const c = f.clip
  const fin = Number.isFinite(srcDur)
  let next: TlClip
  if (side === 'l') {
    const ns = clamp(snapFrame(to), fin ? c.start - c.offset : -Infinity, endOf(c) - MIN_CLIP)
    const d = ns - c.start
    next = { ...c, length: c.length - d, offset: fin ? c.offset + d : 0 }
  } else {
    const ne = clamp(snapFrame(to), c.start + MIN_CLIP, fin ? c.start + (srcDur - c.offset) : Infinity)
    next = { ...c, length: ne - c.start }
  }
  if (Math.abs(next.length - c.length) < EPS && Math.abs(next.offset - c.offset) < EPS) return tr
  const placed = tr.map((l) => (l === f.lane ? { ...l, clips: l.clips.map((x) => (x.id === id ? next : x)) } : l))
  return magnetPack(placed, tr)
}
