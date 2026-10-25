// 剪辑页命令化题（人手动作派发同一张命令表）：
//   A 人手动作派发命令＝原行为（抽代表动作：删、Ctrl+B、刀片、静音、双击放轨、加字、加贴纸、轨道开关、标记、分离音频、群组；磁吸开着也一样）；
//   B 手势放手（拖位／拉两端）：命令重算一样才记命令账·不一样照手势那份；
//   C 复原：一步人手、一步角色——Ctrl+Z 先退角色那批（连比例）·再退人手那步；Ctrl+Shift+Z 照原样回来；
//   D 角色命令收进来不冲掉没存的人手改动：没存的人手命令在角色版上重放（两边都留）；撞上（角色删了人手在改的段）或手上有命令外改动 ⇒ 不重放（交回问窗）；
//   E 页面接线（动作走 runCmd／editVia·重放挂在问窗之前·复原栈带比例帐）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/page-cmd.test.ts')"
// 药（按退出码核·红＝非 0）：
//   DILIN_NEG=vedit_page_cmd_off ⇒ 页面派发命令不成（runHuman 恒不收）⇒ A1～A3、A6、A8、B、C、D1～D4 红；
//   DILIN_NEG=vedit_split_snap_at ⇒ timeline.split 先对齐帧格再判压到哪几段（第二期前）⇒ A2 红（播放头不在帧格上时 Ctrl+B 切到没选的段）；
//   DILIN_NEG=vedit_gesture_via_no_guard ⇒ 手势放手不比对就用命令那份 ⇒ B 红（撞位开新轨被换成挪去空位）；
//   DILIN_NEG=vedit_role_undo_ratio_off ⇒ 角色那批的比例不进比例帐 ⇒ C 红（Ctrl+Z 退掉角色那批比例没回去）；
//   DILIN_NEG=vedit_rebase_off ⇒ 不重放 ⇒ D1、D3、D4、D5 红；
//   DILIN_NEG=vedit_rebase_no_verify ⇒ 不核「没存的改动全是存档后的命令」⇒ D3 红（拖音量线那下被冲掉）、D4／D5 红（已存的旧笔再做一次）；
//   DILIN_NEG=vedit_rebase_longest ⇒ 找存档后那几笔时取对得上的最长一段 ⇒ D5 红（已存的「设成静音」重做一次·盖掉角色取消的静音）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyCommands, type CommandStep } from './lib/commands.pure'
import { parseProject, type VeditProject } from './lib/project.pure'
import { remoteAction } from './lib/remote.pure'
import * as PC from './lib/page-cmd.pure'
import {
  EMPTY_HIST, MAIN_LANE, appendMedia, commitHist, detachAudio, findClip, hasSound, moveGroup, pruneLanes, removeClips, setClipVolume, setLaneFlag,
  snapFrame, splitAtPlayhead, toggleClipFlag, type Tracks,
} from './lib/timeline.pure'
import { groupClips, pruneGroups } from './lib/group.pure'
import { addMarker, bladeSplit, removeMarker } from './lib/toolbar.pure'
import { addDefaultText } from './lib/text.pure'
import { addStickerAt } from './lib/sticker.pure'
import { STICKERS } from './lib/stickers.data'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 8).join('\n   ')) }
}

// ── 底稿：文字轨一段·主轨两段影片（接着）·音频轨一段（v1、a1 同组）；素材：影片 10 秒、图片、音频 8 秒 ──
const lane = (id: string, kind: string, clips: unknown[], extra: Record<string, unknown> = {}) => ({ id, kind, clips, locked: false, hidden: false, muted: false, ...extra })
const RAW = {
  v: 1, ratio: { kind: 'fit' }, programs: {},
  media: [
    { id: 'm1', name: 'a.mp4', kind: 'video', duration: 10, from: 'local' },
    { id: 'm2', name: 'b.png', kind: 'image', duration: 0, from: 'local' },
    { id: 'm3', name: 'c.mp3', kind: 'audio', duration: 8, from: 'local' },
  ],
  tracks: [
    lane('T', 'text', [{ id: 't1', mediaId: '', start: 1, length: 2, offset: 0, text: { content: 'Hello', x: 0.5, y: 0.5, size: 0.1 } }]),
    lane(MAIN_LANE, 'visual', [{ id: 'v1', mediaId: 'm1', start: 0, length: 4, offset: 0, muted: true, group: 'g' }, { id: 'v2', mediaId: 'm1', start: 4, length: 6, offset: 4 }]),
    lane('A', 'audio', [{ id: 'a1', mediaId: 'm3', start: 0, length: 8, offset: 0, group: 'g' }]),
  ],
}
const P0 = parseProject(RAW)
assert.ok(P0.ok && !P0.drops.length, '底稿本身干净')
const BASE = (P0 as { project: VeditProject }).project
const TR = BASE.tracks
const kindOf = (id: string) => BASE.media.find((m) => m.id === id)?.kind
const STATE = { tracks: TR, ratio: BASE.ratio, media: BASE.media }
const seq = (p = 'n') => { let i = 0; return () => `${p}${++i}` }
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x))
/** 页面那样入账（PC.settle＝commitTracks：磁吸开着排紧主轨·收空轨）后两边一样 */
const same = (a: Tracks, b: Tracks, msg: string) => assert.equal(canon(a), canon(b), msg)
/** 人手一个动作：命令那条（runHuman＋入账）vs 原算法那条（同一份入账）·两边新编号用同一串 */
function human(steps: CommandStep[], legacy: (id: () => string) => Tracks, msg: string, magnet = false, state = STATE): Tracks {
  const r = PC.runHuman(state, steps, seq(), magnet)
  assert.ok(r.ok, `${msg}：命令要收 ${r.ok ? '' : r.error}`)
  const got = PC.settle((r as { tracks: Tracks }).tracks, state.tracks, magnet), want = PC.settle(legacy(seq()), state.tracks, magnet)
  same(got, want, msg)
  assert.notEqual(canon(got), canon(state.tracks), `${msg}：真的改到东西（⛔ 两边都没动也算一样）`)
  return got
}

test('A1 删（组里删到剩一段 ⇒ 散组）＝pruneGroups(removeClips)·磁吸开着主轨照样排紧', () => {
  human([{ command: 'clip.delete', params: { clips: ['v1'] } }], () => pruneGroups(removeClips(TR, ['v1'])), '删 v1')
  const g = human([{ command: 'clip.delete', params: { clips: ['v1'] } }], () => pruneGroups(removeClips(TR, ['v1'])), '磁吸开着删 v1', true)
  assert.equal(findClip(g, 'v2')!.clip.start, 0, '磁吸：后面那段往前补')
  assert.equal(findClip(g, 'a1')!.clip.group, undefined, '组里只剩 a1 ⇒ 散组')
})

test('A2 Ctrl+B＝splitAtPlayhead（带选取）；播放头不在帧格上、选中的段离片头不到一帧 ⇒ 跟原本一样什么都不切（⛔ 切到没选的段）', () => {
  human([{ command: 'timeline.split', params: { at: 6.5, clips: ['v2'] } }], (id) => splitAtPlayhead(TR, 6.5, ['v2'], id), '选 v2 切在 6.5')
  human([{ command: 'timeline.split', params: { at: 1.5 } }], (id) => splitAtPlayhead(TR, 1.5, [], id), '没选 ⇒ 播放头下全切')
  // 选中的 s 在 1～2 秒·另一条轨 o 盖着 0～5 秒·播放头 1.01（不在帧格上·离 s 片头不到一帧）
  const tr2 = parseProject({ ...RAW, tracks: [lane('X', 'visual', [{ id: 's', mediaId: 'm2', start: 1, length: 1, offset: 0 }]), lane(MAIN_LANE, 'visual', [{ id: 'o', mediaId: 'm1', start: 0, length: 5, offset: 0 }])] })
  assert.ok(tr2.ok)
  const st2 = { ...STATE, tracks: tr2.project.tracks }
  assert.equal(splitAtPlayhead(st2.tracks, 1.01, ['s'], seq()), st2.tracks, '原算法：选中的那段压到了但切不了 ⇒ 什么都不动')
  const r = PC.runHuman(st2, [{ command: 'timeline.split', params: { at: 1.01, clips: ['s'] } }], seq(), false)
  assert.equal(r.ok, false, '命令也不切（不收 ⇒ 页面什么都不动）·⛔ 对齐成 1.0 后当成没压到、改切 o')
})

test('A3 刀片＝bladeSplit；A4 静音（有的已静音 ⇒ 全设上·文字段不适用）＝toggleClipFlag；A5 双击放轨＝appendMedia', () => {
  human([{ command: 'clip.split', params: { clip: 'v2', at: 6.02 } }], (id) => bladeSplit(TR, 'v2', 6.02, id()), '刀片切 v2')
  const live = ['v1', 'a1']   // 页面送 clip.setFlag 前先挑没锁、会出声的（同 toggleClipFlag 自己略过的）
  human([{ command: 'clip.setFlag', params: { clips: live, flag: 'muted', on: !live.every((id) => !!findClip(TR, id)!.clip.muted) } }],
    () => toggleClipFlag(TR, ['v1', 'a1', 't1'], 'muted', (c) => hasSound(c, kindOf)), '静音')
  human([{ command: 'clip.add', params: { media: 'm3' } }], (id) => appendMedia(TR, 'audio', { id: id(), mediaId: 'm3', start: 0, length: 8, offset: 0 }, id()), '双击音频接到音频轨尾')
  human([{ command: 'clip.add', params: { media: 'm2' } }], (id) => appendMedia(TR, 'visual', { id: id(), mediaId: 'm2', start: 0, length: 3, offset: 0 }, id()), '双击图片接到主轨尾', true)
})

test('A6 加默认文字＝addDefaultText·点贴纸＝addStickerAt（播放头·同一份落点规划）；A7 轨道眼睛＝setLaneFlag·加／删标记＝addMarker／removeMarker', () => {
  human([{ command: 'text.add', params: { content: '默認文本', at: 1.5 } }], (id) => addDefaultText(TR, 1.5, { id, laneId: id, content: '默認文本' }).tracks, '播放头 1.5 加字（文字轨被占 ⇒ 往上开一条）')
  const sk = STICKERS[0].id
  human([{ command: 'sticker.add', params: { sticker: sk, at: 2.27 } }], (id) => addStickerAt(TR, sk, 2.27, { id, laneId: id }).tracks, '点贴纸')
  human([{ command: 'lane.setFlag', params: { lane: 'T', flag: 'hidden', on: true } }], () => setLaneFlag(TR, 'T', 'hidden', true), '藏文字轨')
  const at = snapFrame(3.31)
  const mk = human([{ command: 'marker.add', params: { at } }], () => addMarker(TR, at), '加旗')
  human([{ command: 'marker.remove', params: { at } }], () => removeMarker(mk, at), '删旗', false, { ...STATE, tracks: mk })
})

test('A8 分离音频＝detachAudio·群组＝groupClips（新组编号同一笔）', () => {
  human([{ command: 'clip.detachAudio', params: { clips: ['v2'] } }], (id) => detachAudio(TR, ['v2'], kindOf, id, id).tracks, '分离 v2 的声音')
  human([{ command: 'clip.group', params: { clips: ['v2', 't1'] } }], (id) => groupClips(TR, ['v2', 't1'], id()), '群组（v2 并进 g 组）')
})

test('B 手势放手：单段拖到空位＝clip.move ⇒ 记命令账；撞位开新轨（命令表没有的玩法）⇒ 照拖出来那份·不记', () => {
  const drag = (ids: string[], dt: number) => pruneLanes(moveGroup(TR, ids, dt, 0, { newLaneId: () => 'NL', overlapNew: true }))
  const free = drag(['a1'], 9)
  const v1 = PC.via(STATE, [{ command: 'clip.move', params: { clip: 'a1', at: 9, lane: 'A' } }], seq(), free, true)
  assert.ok(v1.rec, '拖到空位：命令重算一样 ⇒ 记命令账')
  same(v1.tracks, free, '轨道照拖出来那份')
  const hit = drag(['v1'], 5)   // v1 拖到 5 秒撞上 v2 ⇒ 页面开新轨放上去
  assert.ok(findClip(hit, 'v1')!.lane.id !== MAIN_LANE, '底稿：拖位撞上 ⇒ 新开一条')
  const v2 = PC.via(STATE, [{ command: 'clip.move', params: { clip: 'v1', at: 5, lane: MAIN_LANE } }], seq(), hit, true)
  assert.equal(v2.rec, null, '命令（挪去最近空位）跟拖出来的不一样 ⇒ 不记')
  assert.equal(v2.tracks, hit, '轨道一字不差照拖出来那份')
})

// 角色那批：在 base 上跑命令（同 video_edit_run）
const role = (base: VeditProject, steps: CommandStep[]) => { const r = applyCommands(base, steps, { newId: seq('r') }); assert.ok(r.ok, r.ok ? '' : r.error); return (r as { project: VeditProject }).project }

test('C 复原：一步人手（删 v2）、一步角色（加字＋改成 9:16）——Ctrl+Z 先退角色那批（比例一起回）·再退人手那步；重做照原样回来', () => {
  const ledger: PC.RatioLedger = new WeakMap()
  let hist = EMPTY_HIST
  const h = PC.runHuman(STATE, [{ command: 'clip.delete', params: { clips: ['v2'] } }], seq(), false)
  assert.ok(h.ok)
  const t1 = PC.settle((h as { tracks: Tracks }).tracks, TR, false)
  hist = commitHist(hist, TR)   // 页面 commitTracks
  const rp = role({ ...BASE, tracks: t1 }, [{ command: 'text.add', params: { content: 'AI', at: 5 } }, { command: 'project.setRatio', params: { ratio: '9:16' } }])
  // 页面 loadContent(remote)：先记比例帐·再 commitRemoteTracks（照原样进复原栈）
  PC.noteRemoteRatio(ledger, { tracks: t1, ratio: BASE.ratio }, rp.ratio)
  hist = commitHist(hist, t1)
  let cur = { tracks: pruneLanes(rp.tracks), ratio: rp.ratio }
  const step = (dir: 'undo' | 'redo') => { const r = PC.stepHist(dir, hist, ledger, cur)!; assert.ok(r, dir); hist = r.hist; cur = { tracks: r.tracks, ratio: r.ratio ?? cur.ratio } }
  step('undo')
  same(cur.tracks, t1, '退一步＝角色那批退掉（人手删的 v2 还是删的）')
  assert.deepEqual(cur.ratio, BASE.ratio, '比例跟着回去')
  step('undo')
  same(cur.tracks, TR, '再退一步＝人手那步退掉')
  assert.deepEqual(cur.ratio, BASE.ratio)
  step('redo'); same(cur.tracks, t1, '重做人手那步'); assert.deepEqual(cur.ratio, BASE.ratio)
  step('redo'); same(cur.tracks, pruneLanes(rp.tracks), '重做角色那批'); assert.deepEqual(cur.ratio, rp.ratio, '比例也回来')
})

// 页面：人手派发一笔 ⇒ 入账＋记命令账（同 runCmd／commitTracks）
function page(saved: VeditProject, acts: CommandStep[][]): { mine: VeditProject; log: PC.CmdRec[] } {
  let tracks = saved.tracks
  const log: PC.CmdRec[] = []
  for (const steps of acts) {
    const r = PC.runHuman({ tracks, ratio: saved.ratio, media: saved.media }, steps, seq('h'), false)
    assert.ok(r.ok, r.ok ? '' : r.error)
    const ok = r as { tracks: Tracks; rec: PC.CmdRec }
    tracks = PC.settle(ok.tracks, tracks, false)
    log.push(ok.rec)
  }
  return { mine: { ...saved, tracks }, log }
}

test('D1 角色改档时手上有没存的人手改动（加字、删 v2）⇒ 照旧该问（remoteAction ask）·人手命令在角色版上重放：两边都留', () => {
  const { mine, log } = page(BASE, [[{ command: 'text.add', params: { content: '人手加的', at: 4 } }], [{ command: 'clip.delete', params: { clips: ['v2'] } }]])
  const remote = role(BASE, [{ command: 'clip.setVolume', params: { clips: 'a1', volume: 0.5 } }, { command: 'marker.add', params: { at: 2 } }])
  assert.equal(remoteAction(BASE, mine, remote), 'ask', '原本：先问（三选一）')
  const rb = PC.rebase(BASE, mine, remote, log)
  assert.ok(rb.ok, `重放要成 ${rb.ok ? '' : rb.why}`)
  const p = (rb as { project: VeditProject }).project
  assert.equal(findClip(p.tracks, 'a1')!.clip.volume, 0.5, '角色改的音量在')
  assert.deepEqual(p.tracks.find((l) => l.id === MAIN_LANE)!.markers, [2], '角色加的标记在')
  assert.ok(p.tracks.some((l) => l.clips.some((c) => c.text?.content === '人手加的')), '人手没存的字在（⛔ 被冲掉）')
  assert.equal(findClip(p.tracks, 'v2'), null, '人手删的 v2 还是删的')
  const hid = log[0].ids[0]
  assert.ok(findClip(p.tracks, hid), '新片段编号照人手那次（重放同编号）')
  assert.equal(remoteAction(remote, p, remote), 'adopt', '合好之后：底＝角色版·手上多出人手那几下 ⇒ 下次问版本只换版次、照常自存（⛔ 再问一次）')
})

test('D2 撞上：角色把人手正在改的那段删了 ⇒ 不重放（交回问窗）', () => {
  const { mine, log } = page(BASE, [[{ command: 'clip.split', params: { clip: 'v2', at: 7 } }]])
  const remote = role(BASE, [{ command: 'clip.delete', params: { clips: 'v2' } }])
  const rb = PC.rebase(BASE, mine, remote, log)
  assert.equal(rb.ok, false)
  assert.equal((rb as { why: string }).why, 'refused')
})

test('D3 手上有命令外的改动（拖音量线：直接改轨道·没记命令账）⇒ 不重放（⛔ 把那一下冲掉）', () => {
  const { mine, log } = page(BASE, [[{ command: 'text.add', params: { content: '字', at: 4 } }]])
  const dragged = { ...mine, tracks: setClipVolume(mine.tracks, ['a1'], 2, () => true) }   // 音量线拖的（不是命令）
  const remote = role(BASE, [{ command: 'marker.add', params: { at: 2 } }])
  const rb = PC.rebase(BASE, dragged, remote, log)
  assert.equal(rb.ok, false, '手上这份不是「底＋命令账」⇒ 不重放')
  assert.equal((rb as { why: string }).why, 'unrecorded')
})

test('D4 命令账里有已存过的旧笔（存档时不剪账）⇒ 只重放存档之后那几笔（⛔ 旧笔再做一次多出一段字）', () => {
  const first = page(BASE, [[{ command: 'text.add', params: { content: '旧', at: 4 } }]])
  const saved = first.mine   // 这时存档了
  const second = page(saved, [[{ command: 'clip.delete', params: { clips: ['v2'] } }]])
  const log = [...first.log, ...second.log]
  const remote = role(saved, [{ command: 'marker.add', params: { at: 2 } }])
  const rb = PC.rebase(saved, second.mine, remote, log)
  assert.ok(rb.ok, rb.ok ? '' : rb.why)
  assert.equal((rb as { recs: number }).recs, 1, '只重放 1 笔')
  const texts = (rb as { project: VeditProject }).project.tracks.flatMap((l) => l.clips.filter((c) => c.text?.content === '旧'))
  assert.equal(texts.length, 1, '旧字只一段')
})

test('D5 已存的旧笔重做也一样（设成静音）·角色后来取消了静音 ⇒ 只重放存档之后那笔·⛔ 把角色取消的静音又设回去', () => {
  const first = page(BASE, [[{ command: 'clip.setFlag', params: { clips: 'v2', flag: 'muted', on: true } }]])
  const saved = first.mine
  const second = page(saved, [[{ command: 'text.add', params: { content: '新', at: 4 } }]])
  const remote = role(saved, [{ command: 'clip.setFlag', params: { clips: 'v2', flag: 'muted', on: false } }])
  const rb = PC.rebase(saved, second.mine, remote, [...first.log, ...second.log])
  assert.ok(rb.ok, rb.ok ? '' : rb.why)
  const p = (rb as { project: VeditProject }).project
  assert.ok(!findClip(p.tracks, 'v2')!.clip.muted, '角色取消的静音留着')
  assert.ok(p.tracks.some((l) => l.clips.some((c) => c.text?.content === '新')), '人手新加的字在')
})

test('E 页面接线：主要人手动作走 runCmd／editVia／logVia·复原栈带比例帐·重放挂在问窗之前', () => {
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  for (const cmd of ['clip.add', 'clip.delete', 'timeline.split', 'clip.split', 'marker.add', 'marker.remove', 'clip.detachAudio', 'clip.setFlag', 'lane.setFlag', 'clip.group', 'clip.ungroup', 'clip.setVolume', 'clip.setFx', 'clip.setTransition', 'text.add', 'sticker.add'])
    assert.match(pg, new RegExp(`runCmd\\(\\[\\{ command: '${cmd.replace('.', '\\.')}'`), `${cmd} 走 runCmd`)
  for (const cmd of ['text.update', 'sticker.update', 'clip.move']) assert.match(pg, new RegExp(`editVia\\(\\[\\{ command: '${cmd.replace('.', '\\.')}'`), `${cmd} 走 editVia`)
  assert.match(pg, /command: 'clip\.trim', params: \{ clip: d\.clip\.id/, '拉两端放手＝clip.trim')
  assert.match(pg, /logVia\(d\.base, \[\{ command: 'lane\.move'/, '轨道排序放手＝lane.move')
  assert.match(pg, /const r = PC\.runHuman\(cmdState\(\), steps, uid, tlPrefsRef\.current\.magnet\)/, 'runCmd 走同一支套用函数')
  assert.match(pg, /if \(rec\) cmdLogRef\.current = PC\.logPush\(cmdLogRef\.current, rec\)/, '入账才记命令账')
  assert.match(pg, /PC\.noteRemoteRatio\(ratioLedgerRef\.current, \{ tracks: tracksRef\.current, ratio: ratioRef\.current \}, p\.ratio\)\n\s*if \(mode !== 'open'\) commitRemoteTracks\(p\.tracks\)/, '角色那批先记比例帐再进复原栈')
  assert.match(pg, /const r = PC\.stepHist\(dir, histRef\.current, ratioLedgerRef\.current, \{ tracks: tracksRef\.current, ratio: ratioRef\.current \}\)/, '复原／重做带比例帐')
  const rl = pg.slice(pg.indexOf('const reloadProject = useCallback('), pg.indexOf('const resolveRemote = useCallback('))
  assert.ok(rl.indexOf("if (act === 'ask' && saved && await rebaseRemote(d, saved, mine)) return 'rebase'") > 0 && rl.indexOf("if (act === 'ask' && saved && await rebaseRemote") < rl.indexOf("if (act === 'ask') {"), '重放挂在问窗之前')
  assert.match(pg, /const rb = PC\.rebase\(saved, mine, d\.project, cmdLogRef\.current\)\n\s*if \(!rb\.ok\) return false/)
})

console.log(`page-cmd → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)
