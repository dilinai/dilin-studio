// 剪辑页命令化（人点界面也走同一套）：页面人手的主要编辑动作派发命令表 commands.pure 的命令、
//   由角色 video_edit_run 同一支 applyCommandsState 改工程状态。本档放页面那半的纯函数（题直接跑）·⛔ 碰 DOM／网路。
//  · runHuman：页面现况＋一批命令 ⇒ 新轨道＋这笔命令账（步骤＋这次用掉的新编号＋当时主轨磁吸开没开）；不合 ⇒ ok:false（页面什么都不动）。
//  · via：手势（拖位、拉两端、画面上拖字块／贴纸、改字…）放手——命令在按下那刻的轨道上重算一次，跟手势算出来的一样 ⇒ 用命令那份（记命令账）；
//    不一样（磁吸插入、整组拖、撞位开新轨、Alt 复制…命令表没有的玩法）⇒ 照手势那份（不记命令账）＝人手结果跟改前逐字一样。
//  · 复原栈：照旧记「改之前的轨道快照」（T.Hist）——⛔ 改成记命令：命令不是每条都倒得回去（删片段、磁吸排紧、收空轨都会丢资料），
//    手势里命令表没有的玩法、角色存进来的整份档也不是命令；快照照原样复原最准。角色那批换上来进复原栈一步（Ctrl+Z 退得回）；
//    那批连比例一起改 ⇒ 比例另记在 ratio 帐（以轨道快照物件本身当键）·复原／重做到那份轨道时比例一起回。
//  · rebase：页面有没存的人手改动时角色改了档 ⇒ 把没存的那几笔人手命令（同编号）在角色版上依序重做；做得成 ⇒ 两边都留、不问
//    （复原栈记一步「角色那批」：Ctrl+Z 退回手上那份＝角色的动作退掉、人手的留着）；做不成（角色删了人手在改的片段、锁了轨…）
//    或没存的改动里有命令外的（拖音量线、面板滑杆…）⇒ 交回原本的问窗（套用角色版本／保留我的／合併）。
import { applyCommandsState, type CmdState, type CommandStep, type StepResult } from './commands.pure'
import { magnetEdit } from './magnet.pure'
import { parseProject, type ProjectMedia, type VeditProject } from './project.pure'
import type { RatioSel } from './ratio.pure'
import { canon, normProject } from './remote.pure'
import { pruneLanes, type Hist, type Tracks, redoHist, undoHist } from './timeline.pure'

/** 药（只在 node 测试跑·正式页面恒 false）：DILIN_NEG 含处名 ⇒ 退回修前行为 */
function neg(site: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes(site)
}

/** 一笔人手命令账：步骤＋这次用掉的新编号（重放时照发·新片段编号不变）＋当时主轨磁吸开没开（入账时要不要排紧主轨） */
export type CmdRec = { steps: CommandStep[]; ids: string[]; magnet: boolean }

/** 页面素材 ⇒ 命令层看的素材（命令只读编号、名字、种类、长度、云盘编号） */
export function toCmdMedia(m: Pick<ProjectMedia, 'id' | 'name' | 'kind' | 'duration' | 'from'> & { driveId?: string }): ProjectMedia {
  return { id: m.id, name: m.name, kind: m.kind, duration: m.duration, from: m.from, ...(m.driveId ? { driveId: m.driveId } : {}) }
}

/** 人手改动入账（同页面 commitTracks）：主轨磁吸开着 ⇒ 这一下动到主轨就排紧·再收空了的非主轨 */
export function settle(raw: Tracks, prev: Tracks, magnet: boolean): Tracks {
  return pruneLanes(magnet ? magnetEdit(raw, prev) : raw)
}

export type HumanRun = { ok: true; tracks: Tracks; results: StepResult[]; rec: CmdRec } | { ok: false; step: number; error: string }
/** 人手一个动作＝一批命令：套在页面现况上（同角色那支 applyCommandsState）·回还没入账的新轨道（入账由页面 edit 走 settle）＋命令账 */
export function runHuman(state: CmdState, steps: readonly CommandStep[], newId: () => string, magnet: boolean): HumanRun {
  if (neg('vedit_page_cmd_off')) return { ok: false, step: -1, error: 'off' }
  const used: string[] = []
  const r = applyCommandsState(state, steps, { newId: () => { const id = newId(); used.push(id); return id } })
  if (!r.ok) return { ok: false, step: r.step, error: r.error }
  return { ok: true, tracks: r.state.tracks, results: r.results, rec: { steps: JSON.parse(JSON.stringify(steps)) as CommandStep[], ids: used, magnet } }
}

/** 两份轨道内容一样（键排好再比·同一物件直接算一样） */
export const sameTracks = (a: Tracks, b: Tracks): boolean => a === b || canon(a) === canon(b)

/** 手势放手：命令在 state（按下那刻）上重算·prune＝手势那条自己会收空轨（时间轴拖位／拉两端）⇒ 命令那份也收了再比；
 *  一样 ⇒ 命令那份＋命令账；不一样或命令不收 ⇒ 手势那份（expect）·rec null。magnet＝这笔之后走不走页面 edit 的磁吸入账（记进命令账·重放照做） */
export function via(state: CmdState, steps: readonly CommandStep[], newId: () => string, expect: Tracks, prune: boolean, magnet = false): { tracks: Tracks; rec: CmdRec | null } {
  const r = runHuman(state, steps, newId, magnet)
  if (r.ok) {
    const t = prune ? pruneLanes(r.tracks) : r.tracks
    if (neg('vedit_gesture_via_no_guard') || sameTracks(t, expect)) return { tracks: t, rec: r.rec }
  }
  return { tracks: expect, rec: null }
}

// ── 复原栈（轨道快照·T.Hist）＋角色那批的比例帐 ──
/** 复原到「这份轨道快照」时比例要回到哪（只有连比例一起换的角色那批才记·键＝快照物件本身） */
export type RatioLedger = WeakMap<Tracks, RatioSel>
type Snap = { tracks: Tracks; ratio: RatioSel }
const sameRatio = (a: RatioSel, b: RatioSel) => canon(a) === canon(b)
/** 角色（或别的分页）那批换上来（页面 commitRemoteTracks 照原样进复原栈一步·⛔ 过主轨磁吸）：比例也变了 ⇒ 记进比例帐（复原到换之前那份轨道时比例回到 prev.ratio） */
export function noteRemoteRatio(ledger: RatioLedger, prev: Snap, nextRatio: RatioSel): void {
  if (!sameRatio(prev.ratio, nextRatio) && !neg('vedit_role_undo_ratio_off')) ledger.set(prev.tracks, prev.ratio)
}
/** 复原／重做一步：回新栈、要换上的轨道、比例（null＝比例不动）；复原／重做到比例帐里有的快照 ⇒ 比例一起回、手上这份的比例记下（再重做／复原时回来） */
export function stepHist(dir: 'undo' | 'redo', hist: Hist, ledger: RatioLedger, cur: Snap): { hist: Hist; tracks: Tracks; ratio: RatioSel | null } | null {
  const r = dir === 'undo' ? undoHist(hist, cur.tracks) : redoHist(hist, cur.tracks)
  if (!r) return null
  const back = ledger.get(r.tracks)
  if (back === undefined) return { hist: r.hist, tracks: r.tracks, ratio: null }
  ledger.set(cur.tracks, cur.ratio)
  return { hist: r.hist, tracks: r.tracks, ratio: back }
}

// ── 角色改档撞上没存的人手改动：重放 ──
/** 这几笔人手命令依序在 base 上重做（同编号·同磁吸入账）；哪笔不成 ⇒ null */
export function replay(base: CmdState, recs: readonly CmdRec[]): Tracks | null {
  let tracks = base.tracks
  for (const rec of recs) {
    let i = 0
    const r = applyCommandsState({ ...base, tracks }, rec.steps, { newId: () => rec.ids[i++] ?? globalThis.crypto.randomUUID() })
    if (!r.ok) return null
    tracks = settle(r.state.tracks, tracks, rec.magnet)
  }
  return tracks
}

const NONE = '\u0000none'
/** 三方取一（同 remote.pure 合并）：只一边改 ⇒ 取改的那边；两边改得不一样 ⇒ conflict */
function pick3<T>(b: T | undefined, m: T | undefined, t: T | undefined): { v: T | undefined } | 'conflict' {
  const cb = b === undefined ? NONE : canon(b), cm = m === undefined ? NONE : canon(m), ct = t === undefined ? NONE : canon(t)
  if (cm === ct) return { v: m }
  if (cm === cb) return { v: t }
  if (ct === cb) return { v: m }
  return 'conflict'
}
/** 按编号三方合一份清单（远端的顺序为主·只在手上有的接在后面） */
function merge3<T>(b: Map<string, T>, m: Map<string, T>, t: Map<string, T>): T[] | null {
  const out: T[] = []
  for (const id of [...new Set([...t.keys(), ...m.keys(), ...b.keys()])]) {
    const r = pick3(b.get(id), m.get(id), t.get(id))
    if (r === 'conflict') return null
    if (r.v !== undefined) out.push(r.v)
  }
  return out
}

/** 命令账最多留几笔（页面每派发一笔就记·超过只留最近这些——重放只用得到上次存档之后那几笔） */
export const CMD_LOG_CAP = 200
export const logPush = (log: readonly CmdRec[], rec: CmdRec): CmdRec[] => [...log, rec].slice(-CMD_LOG_CAP)

export type Rebase = { ok: true; project: VeditProject; recs: number } | { ok: false; why: 'unrecorded' | 'refused' | 'ratio' | 'media' | 'invalid' }
/** saved＝上次存进去／读进来那份（底）·mine＝手上现况·remote＝角色改好的新版·log＝页面这阵子人手派发的命令账（依先后·含已存过的）。
 *  ① 找出「上次存档后」那几笔：在底上依序重做＝手上这份的那段尾巴就是（⛔ 靠存档时去剪账·存档那支不必知道有账）；
 *     一段都对不上（手上有命令外的改动：拖音量线、面板滑杆、复原…）⇒ unrecorded（⛔ 重放·免得丢掉那几下）；
 *  ② 比例、素材清单、内嵌程序包三方取一（两边改得不一样 ⇒ 不重放）；③ 在角色版上依序重做 ⇒ 哪笔不成 ⇒ refused；
 *  ④ 结果过 parseProject（丢东西／改值 ⇒ invalid）。成 ⇒ 回合好的工程（角色的改动＋人手没存的改动都在）·recs＝重放了几笔。 */
export function rebase(saved: VeditProject, mine: VeditProject, remote: VeditProject, log: readonly CmdRec[]): Rebase {
  if (neg('vedit_rebase_off')) return { ok: false, why: 'refused' }
  const s = normProject(saved), m = normProject(mine), r = normProject(remote)
  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]))
  const media = merge3(byId(s.media), byId(m.media), byId(r.media))
  if (!media) return { ok: false, why: 'media' }
  let recs: readonly CmdRec[] | null = null
  if (neg('vedit_rebase_no_verify')) recs = log
  else {
    // 从最新一笔往回试·取对得上的最短那段（已存过的旧笔就算碰巧重做也一样〔例如「设成静音」〕也不再做一次——免得盖掉角色后来的改动）
    const want = canon(m.tracks)
    const ks = Array.from({ length: log.length + 1 }, (_, i) => log.length - i)
    if (neg('vedit_rebase_longest')) ks.reverse()   // 药：从最旧一笔往后试（取对得上的最长那段）
    for (const k of ks) {
      const again = replay({ tracks: s.tracks, ratio: m.ratio, media: m.media }, log.slice(k))
      if (again && canon(normProject({ ...m, tracks: again }).tracks) === want) { recs = log.slice(k); break }
    }
  }
  if (!recs) return { ok: false, why: 'unrecorded' }
  const ratio = pick3(s.ratio, m.ratio, r.ratio)
  if (ratio === 'conflict' || !ratio.v) return { ok: false, why: 'ratio' }
  const tracks = replay({ tracks: pruneLanes(r.tracks), ratio: ratio.v, media }, recs)
  if (!tracks) return { ok: false, why: 'refused' }
  const pk = (p: VeditProject) => new Map(Object.entries(p.programs).map(([k, v]) => [k, { id: k, v }]))
  const progs = merge3(pk(s), pk(m), pk(r))
  if (!progs) return { ok: false, why: 'media' }
  const out: VeditProject = { v: r.v, ratio: ratio.v, tracks, media, programs: Object.fromEntries(progs.map((x) => [x.id, x.v])) }
  const chk = parseProject(JSON.parse(JSON.stringify(out)))
  if (!chk.ok || chk.drops.length || canon(chk.project.tracks) !== canon(out.tracks)) return { ok: false, why: 'invalid' }
  return { ok: true, project: chk.project, recs: recs.length }
}
