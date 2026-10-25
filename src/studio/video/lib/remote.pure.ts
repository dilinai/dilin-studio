// 网页剪辑页·收到远端更新（角色 update_video_edit／别的分页存档）时怎么办：
// 原写法：每 2 秒问版本·变了就整份载入远端版 ⇒ 页面上还没存的改动被盖掉、也不提醒；存档 409 也一样整份换掉。
//   新写法（本档纯函数·页面照它走）：
//     · 远端内容跟手上一样 ⇒ 只换版次（adopt）；
//     · 手上没有没存的改动 ⇒ 照旧换上远端版（apply·进复原栈）；
//     · 手上有没存的改动、远端内容其实没变（例如只改了档名）⇒ 只换版次·手上的改动接着自动存（adopt）；
//     · 手上有没存的改动、远端内容也变了 ⇒ ⛔ 自己换·先问（ask）：「套用角色的版本／保留我的改动／合併兩邊」——
//       合併＝三方合并（上次存进去／读进来那份＝底·手上＝我的·远端＝他的）：按轨道、按片段（含字幕片段）逐个比，
//       只有一边改的取那边、两边改成一样的照收；两边把同一个东西改得不一样、或合完同一条轨上撞在一起 ⇒ 合不了（只给套用／保留两条路）。
// ⛔ 碰 DOM／网路。
import { parseProject, type VeditProject } from './project.pure'
import { MAIN_LANE, type Lane, type TlClip } from './timeline.pure'

/** 键排好再 stringify（同一份内容不因栏位先后不同被当成改过） */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x))
}

/** 同服务端那把尺规范化（parseProject）·不合规 ⇒ 原样 */
export function normProject(p: VeditProject): VeditProject {
  const r = parseProject(JSON.parse(JSON.stringify(p)))
  return r.ok ? r.project : p
}

export type RemoteAction = 'adopt' | 'apply' | 'ask'
/** saved＝上次存进去／读进来那份（null＝不知道·例如刚建草稿）；mine＝手上现况；remote＝远端新版 */
export function remoteAction(saved: VeditProject | null, mine: VeditProject, remote: VeditProject): RemoteAction {
  const m = canon(normProject(mine)), r = canon(normProject(remote))
  if (m === r) return 'adopt'
  const s = saved ? canon(normProject(saved)) : null
  if (s !== null && m === s) return 'apply'
  if (s !== null && r === s) return 'adopt'
  return 'ask'
}

const NONE = '\u0000none'
/** 三方取一：一样 ⇒ 取；只一边改 ⇒ 取改的那边；两边改得不一样 ⇒ conflict */
function pick3<T>(b: T | undefined, m: T | undefined, t: T | undefined): { v: T | undefined } | 'conflict' {
  const cb = b === undefined ? NONE : canon(b), cm = m === undefined ? NONE : canon(m), ct = t === undefined ? NONE : canon(t)
  if (cm === ct) return { v: m }
  if (cm === cb) return { v: t }
  if (ct === cb) return { v: m }
  return 'conflict'
}

type LaneMeta = Omit<Lane, 'clips'>
const metaOf = (l: Lane): LaneMeta => { const { clips: _c, ...rest } = l; void _c; return rest }
type Placed = { lane: string; clip: TlClip }
const placedOf = (p: VeditProject) => { const m = new Map<string, Placed>(); for (const l of p.tracks) for (const c of l.clips) m.set(c.id, { lane: l.id, clip: c }); return m }
const EPS = 1e-6
const overlapPairs = (p: VeditProject): Set<string> => {
  const s = new Set<string>()
  for (const l of p.tracks) {
    const cs = [...l.clips].sort((a, b) => a.start - b.start)
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length && cs[j].start < cs[i].start + cs[i].length - EPS; j++) s.add([cs[i].id, cs[j].id].sort().join('|'))
  }
  return s
}

export type MergeResult = { ok: true; project: VeditProject } | { ok: false; reason: 'conflict' | 'overlap'; conflicts: number }

/** 三方合并（base＝底·mine＝我的·theirs＝远端）：合得干净 ⇒ ok＋合好的工程；两边改到同一个东西 ⇒ conflict；合完撞在一起 ⇒ overlap */
export function mergeProjects(base0: VeditProject, mine0: VeditProject, theirs0: VeditProject): MergeResult {
  const base = normProject(base0), mine = normProject(mine0), theirs = normProject(theirs0)
  let conflicts = 0
  const take = <T,>(r: { v: T | undefined } | 'conflict'): T | undefined => { if (r === 'conflict') { conflicts++; return undefined } return r.v }
  // 比例
  const ratio = take(pick3(base.ratio, mine.ratio, theirs.ratio)) ?? theirs.ratio
  // 轨道本身（种类、锁、藏、静音、标记旗）
  const metas = (p: VeditProject) => new Map(p.tracks.map((l) => [l.id, metaOf(l)]))
  const mb = metas(base), mm = metas(mine), mt = metas(theirs)
  const laneIds = [...new Set([...mt.keys(), ...mm.keys(), ...mb.keys()])]
  const laneOut = new Map<string, LaneMeta>()
  for (const id of laneIds) { const v = take(pick3(mb.get(id), mm.get(id), mt.get(id))); if (v) laneOut.set(id, v) }
  // 片段（含字幕／贴纸／程序片段）：在哪条轨＋内容一起比
  const pb = placedOf(base), pm = placedOf(mine), pt = placedOf(theirs)
  const clipIds = [...new Set([...pt.keys(), ...pm.keys(), ...pb.keys()])]
  const byLane = new Map<string, TlClip[]>()
  for (const id of clipIds) {
    const v = take(pick3(pb.get(id), pm.get(id), pt.get(id)))
    if (!v) continue
    if (!laneOut.has(v.lane)) { conflicts++; continue }   // 一边删了轨、另一边往那条轨放片段
    const arr = byLane.get(v.lane) ?? []
    arr.push(v.clip)
    byLane.set(v.lane, arr)
  }
  // 轨道先后：照远端·我这边新加的插在我那边它前一条后面
  const order = theirs.tracks.map((l) => l.id).filter((id) => laneOut.has(id))
  const mineOrder = mine.tracks.map((l) => l.id)
  for (let i = 0; i < mineOrder.length; i++) {
    const id = mineOrder[i]
    if (!laneOut.has(id) || order.includes(id)) continue
    let at = 0
    for (let k = i - 1; k >= 0; k--) { const j = order.indexOf(mineOrder[k]); if (j >= 0) { at = j + 1; break } }
    order.splice(at, 0, id)
  }
  if (!order.includes(MAIN_LANE) && laneOut.has(MAIN_LANE)) order.unshift(MAIN_LANE)
  const tracks: Lane[] = order.map((id) => ({ ...(laneOut.get(id) as LaneMeta), clips: (byLane.get(id) ?? []).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }))
  // 素材清单、内嵌程序包
  const mediaOf = (p: VeditProject) => new Map(p.media.map((m) => [m.id, m]))
  const db = mediaOf(base), dm = mediaOf(mine), dt = mediaOf(theirs)
  const mediaIds = [...new Set([...dt.keys(), ...dm.keys(), ...db.keys()])]
  const media = mediaIds.map((id) => take(pick3(db.get(id), dm.get(id), dt.get(id)))).filter((x): x is VeditProject['media'][number] => !!x)
  const used = new Set(tracks.flatMap((l) => l.clips.map((c) => c.mediaId)).filter(Boolean))
  for (const id of used) if (!media.some((m) => m.id === id)) { const m = dm.get(id) ?? dt.get(id) ?? db.get(id); if (m) media.push(m) }
  const programs: VeditProject['programs'] = {}
  for (const k of new Set([...Object.keys(theirs.programs), ...Object.keys(mine.programs), ...Object.keys(base.programs)])) {
    const v = take(pick3(base.programs[k], mine.programs[k], theirs.programs[k]))
    if (v) programs[k] = v
  }
  if (conflicts) return { ok: false, reason: 'conflict', conflicts }
  const out: VeditProject = { v: theirs.v, ratio, tracks, media, programs }
  // 合完同一条轨上撞在一起（两边各把不同片段挪到同一处）⇒ 合不了
  const before = new Set([...overlapPairs(mine), ...overlapPairs(theirs)])
  for (const k of overlapPairs(out)) if (!before.has(k)) return { ok: false, reason: 'overlap', conflicts: 1 }
  return { ok: true, project: out }
}
