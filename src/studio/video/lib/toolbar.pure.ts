// ═══════════════════════════════════════════════════════════════════════════════════════════
// 网页剪辑页·时间轴上方工具列的纯半（对照剪映时间轴上方工具列）。
// 回的读法（照这个做）：最左游标钮·下拉四种——选择（A）、分割（B·点片段哪里就从哪里切开）、向左全选（[·选中播放头左边所有片段）、
//   向右全选（]）；后面依序：复原、重做、分割、向左裁剪（Q·删掉选中片段在播放头左边那截）、向右裁剪（W·删掉右边那截）、删除、
//   加标记（M·在时间尺上插一面小旗·存进工程档）。
// 规矩：所有改动回新的 Tracks（页面走 edit() 进复原栈）；锁住的轨不动；标记放在主轨的 markers（复原栈、工程档都跟着轨道走）。⛔ 碰 DOM。
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { EPS_TIME, MAIN_LANE, MIN_CLIP, findClip, snapFrame, splitClip, type Lane, type TlClip, type Tracks } from './timeline.pure'

/** 游标模式：select＝平常（点选、拖位、拉两端）；blade＝刀片（点片段就从点的位置切开·A 或 Esc 回 select） */
export type EditTool = 'select' | 'blade'
/** 下拉四项（照剪映排法）：前两项是模式·后两项点了就做（选完回原模式） */
export type ToolMenuItem = { id: EditTool | 'select-left' | 'select-right'; key: string }
export const TOOL_MENU: readonly ToolMenuItem[] = [
  { id: 'select', key: 'A' }, { id: 'blade', key: 'B' }, { id: 'select-left', key: '[' }, { id: 'select-right', key: ']' },
]

const EPS = EPS_TIME
const endOf = (c: TlClip) => c.start + c.length

// ── 向左／向右全选（[ ／ ]）──
/** 播放头 at 左边（left·片头在播放头左边＝有一截在左边）／右边（right·片尾在播放头右边）的所有片段；锁了的轨不选（同 Ctrl+A 的规矩） */
export function selectSide(tr: Tracks, at: number, side: 'left' | 'right'): string[] {
  const out: string[] = []
  for (const l of tr) {
    if (l.locked) continue
    for (const c of l.clips) if (side === 'left' ? c.start < at - EPS : endOf(c) > at + EPS) out.push(c.id)
  }
  return out
}

// ── 刀片（B）──
/** 刀片点在片段上：从点的位置（对齐帧格）切开这一段；锁了的轨、离两头不到一帧 ⇒ 原物件 */
export function bladeSplit(tr: Tracks, id: string, at: number, newId: string): Tracks {
  const f = findClip(tr, id)
  if (!f || f.lane.locked) return tr
  return splitClip(tr, id, at, newId)
}

// ── 向左／向右裁剪（Q ／ W）──
const under = (l: Lane, c: TlClip, t: number) => !l.locked && t >= c.start + MIN_CLIP - EPS && t <= endOf(c) - MIN_CLIP + EPS
/** 裁得到哪几段：选中的、轨没锁、播放头压在身上（离两头至少一帧·同分割） */
export function trimTargets(tr: Tracks, ids: readonly string[], at: number): string[] {
  const t = snapFrame(at)
  return ids.filter((id) => { const f = findClip(tr, id); return !!f && under(f.lane, f.clip, t) })
}
/** 切在播放头·删掉选中片段在播放头左边（left）／右边（right）那截；留下的那截编号不变（选取还在）。
 *  左裁＝片头挪到播放头、素材入点跟着往后（同分割后段的算法·程序片段接着播）·接缝转场跟着前面那截一起没了；右裁＝片尾收到播放头。
 *  这里只裁、后面的片段不往前靠；主轨磁吸开着时由页面 edit 走 magnet.pure 的 magnetEdit 把主轨排紧（后面往前补·同删除）。没有能裁的 ⇒ 原物件。 */
export function trimAt(tr: Tracks, ids: readonly string[], at: number, side: 'left' | 'right'): Tracks {
  const t = snapFrame(at)
  const hit = new Set(trimTargets(tr, ids, t))
  if (!hit.size) return tr
  const cut = (c: TlClip): TlClip => {
    if (side === 'right') return { ...c, length: t - c.start }
    const { transIn: _drop, ...rest } = c
    void _drop
    return { ...rest, start: t, length: endOf(c) - t, offset: c.offset + (t - c.start) }
  }
  return tr.map((l) => (l.clips.some((c) => hit.has(c.id)) ? { ...l, clips: l.clips.map((c) => (hit.has(c.id) ? cut(c) : c)) } : l))
}

// ── 标记（M）：时间尺上的小旗·存在主轨的 markers ──
/** 一个工程最多几面旗（读档也照这个截） */
export const MARKER_CAP = 500
/** 所有标记（秒·由小到大）；没有 ⇒ 空阵列 */
export function markersOf(tr: Tracks): number[] {
  return tr.find((l) => l.id === MAIN_LANE)?.markers ?? []
}
const putMarkers = (tr: Tracks, list: number[]): Tracks => tr.map((l) => {
  if (l.id !== MAIN_LANE) return l
  const next = { ...l }
  if (list.length) next.markers = list
  else delete next.markers
  return next
})
/** 在 at（对齐帧格·不小于 0）插一面旗；那一帧已经有 ⇒ 原物件（不叠两面）；到上限 ⇒ 原物件 */
export function addMarker(tr: Tracks, at: number): Tracks {
  const t = snapFrame(Math.max(0, at))
  const cur = markersOf(tr)
  if (cur.length >= MARKER_CAP || cur.some((x) => Math.abs(x - t) < EPS)) return tr
  return putMarkers(tr, [...cur, t].sort((a, b) => a - b))
}
/** 拿掉 at 那一帧的旗；没有 ⇒ 原物件 */
export function removeMarker(tr: Tracks, at: number): Tracks {
  const cur = markersOf(tr)
  const next = cur.filter((x) => Math.abs(x - at) >= EPS)
  return next.length === cur.length ? tr : putMarkers(tr, next)
}
/** 读档用：任意值 ⇒ 合规的标记表（有限、不小于 0 的数·对齐帧格·去重·排序·截到上限）；一面都没有 ⇒ null（工程档不写这一栏） */
export function parseMarkers(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const set = new Set<number>()
  for (const x of v) if (typeof x === 'number' && Number.isFinite(x) && x >= 0) set.add(snapFrame(x))
  const list = [...set].sort((a, b) => a - b).slice(0, MARKER_CAP)
  return list.length ? list : null
}
