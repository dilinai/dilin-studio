// 网页剪辑页·群组、合成子素材、编曲素材展开：编曲合成成素材后拖上轨道还原成多轨（群组）；素材区右键可合成单一音频；多选轨道片段右键可群组、可合成子素材（变成一段放回素材区）。
// 群组＝片段身上记同一个 group 编号：点一段就整组选起来（拖、删、复制都整组）·Ctrl＋点整组移出·「取消群组」拿掉编号。
// 合成子素材＝选中那几段照时间轴位置混成一段声音（WAV）放进素材区（影片汇出还没开放 ⇒ 只合声音·画面不算）。
// 编曲素材＝素材区一份「混好的 WAV」带着几份藏起来的分轨（stems·每条编曲音轨一份）：拖上轨道展开成几条音频轨、绑成一组；右键「合成单一音频」＝复制那份混好的成一份普通音频。
// 本档只放纯函数（题直接跑）·⛔ 碰 DOM。
import { EPS_TIME as EPS, applyDrop, findClip, liveSelection, planDrop, snapFrame, type MediaKindLike, type TlClip, type Tracks, hasSound, clipGain, speedOf } from './timeline.pure'
import { gainEnvelope } from './clip-look.pure'
import type { SpeedCurve } from './curve-speed.pure'
import type { ClipAudio } from './audio.pure'

/** 这一段所在那组的全部成员（锁了的轨上的不算）；没群组 ⇒ 只有它自己 */
export function groupMembers(tr: Tracks, id: string): string[] {
  const f = findClip(tr, id)
  if (!f) return []
  const g = f.clip.group
  if (!g) return [id]
  const out: string[] = []
  for (const l of tr) if (!l.locked) for (const c of l.clips) if (c.group === g) out.push(c.id)
  return out.includes(id) ? out : [id, ...out]
}
/** 选取补齐整组（选到组里一段 ⇒ 整组都算选中·顺序照原选取·补的接在后面）；没群组的照旧 */
export function expandGroups(tr: Tracks, ids: readonly string[]): string[] {
  const gs = new Set<string>()
  for (const id of ids) { const g = findClip(tr, id)?.clip.group; if (g) gs.add(g) }
  if (!gs.size) return [...ids]
  const out = [...ids]
  for (const l of tr) if (!l.locked) for (const c of l.clips) if (c.group && gs.has(c.group) && !out.includes(c.id)) out.push(c.id)
  return out
}
/** 页面用的选取＝跟着轨道走（liveSelection）再补齐整组 */
export const groupSelection = (tr: Tracks, raw: readonly string[]): string[] => expandGroups(tr, liveSelection(tr, raw))
/** Ctrl／⌘＋点：点到组里的一段 ⇒ 整组一起加进来或一起移出；不按 ⇒ 只选这一段（补齐整组交给 groupSelection） */
export function groupClickSelect(tr: Tracks, sel: readonly string[], id: string, additive: boolean): string[] {
  const f = findClip(tr, id)
  if (!f || f.lane.locked) return additive ? [...sel] : []
  if (!additive) return [id]
  const mem = groupMembers(tr, id)
  return sel.includes(id) ? sel.filter((x) => !mem.includes(x)) : [...sel, ...mem.filter((x) => !sel.includes(x))]
}

/** 这几段能不能成组：至少两段·都在没锁的轨上·还没全在同一组 */
export function canGroup(tr: Tracks, ids: readonly string[]): boolean {
  const fs = ids.map((id) => findClip(tr, id)).filter((f) => !!f && !f.lane.locked)
  if (fs.length < 2) return false
  const g0 = fs[0]!.clip.group
  return !g0 || fs.some((f) => f!.clip.group !== g0)
}
export const canUngroup = (tr: Tracks, ids: readonly string[]): boolean => ids.some((id) => { const f = findClip(tr, id); return !!f && !f.lane.locked && !!f.clip.group })
/** 成组：这几段（锁了的不动）记同一个编号 gid（原本在别的组 ⇒ 那几组整组并进来） */
export function groupClips(tr: Tracks, ids: readonly string[], gid: string): Tracks {
  if (!canGroup(tr, ids)) return tr
  const all = new Set(expandGroups(tr, ids))
  return tr.map((l) => (l.locked || !l.clips.some((c) => all.has(c.id)) ? l : { ...l, clips: l.clips.map((c) => (all.has(c.id) ? { ...c, group: gid } : c)) }))
}
/** 取消群组：碰到的那几组整组拿掉编号 */
export function ungroupClips(tr: Tracks, ids: readonly string[]): Tracks {
  const gs = new Set<string>()
  for (const id of ids) { const f = findClip(tr, id); if (f && !f.lane.locked && f.clip.group) gs.add(f.clip.group) }
  if (!gs.size) return tr
  const drop = (c: TlClip): TlClip => { if (!c.group || !gs.has(c.group)) return c; const { group: _g, ...rest } = c; void _g; return rest }
  return tr.map((l) => (l.clips.some((c) => c.group && gs.has(c.group)) ? { ...l, clips: l.clips.map(drop) } : l))
}
/** 只剩一段的组 ⇒ 拿掉编号（删掉组里别的段之后·免得留一个看不见的组） */
export function pruneGroups(tr: Tracks): Tracks {
  const n = new Map<string, number>()
  for (const l of tr) for (const c of l.clips) if (c.group) n.set(c.group, (n.get(c.group) ?? 0) + 1)
  const lone = new Set([...n].filter(([, k]) => k < 2).map(([g]) => g))
  if (!lone.size) return tr
  return tr.map((l) => (l.clips.some((c) => c.group && lone.has(c.group)) ? { ...l, clips: l.clips.map((c) => { if (!c.group || !lone.has(c.group)) return c; const { group: _g, ...rest } = c; void _g; return rest }) } : l))
}

// ── 合成子素材 ──
/** 一段要混进去的声音：素材第 offset 秒起·放在子素材第 at 秒·时间轴上 length 秒（变速 ⇒ 素材走 length×speed 秒）·音量·淡入淡出 */
export type SubSeg = { mediaId: string; at: number; offset: number; length: number; speed: number; gain: number; fadeIn: number; fadeOut: number
  /** env＝音量关键帧的逐帧音量 [片段里第几秒, 倍数]（有 ⇒ 盖掉 gain）·curve＝曲线变速（有 ⇒ 播放速度照曲线走） */
  env?: Array<[number, number]>; curve?: SpeedCurve
  /** 倒放（声音也倒着放） */
  reverse?: boolean
  /** 降噪／响度统一／变调／声道／声音效果 */
  aud?: ClipAudio }
export type SubPlan = { start: number; end: number; segs: SubSeg[]; /** 选到的段里有画面（影片画面、图片、字、贴纸…）——合不进去 ⇒ 页面提醒一句 */ picture: boolean }
/** 选中那几段 ⇒ 混音计划（照「现在听得到的」：轨静音／隐藏、片段静音／停用、声音分离出去的都不出声）·时间从最早那段开头算到最晚那段结尾（中间空的就是没声音）；一段都没有 ⇒ null */
export function subClipPlan(tr: Tracks, ids: readonly string[], kindOf: (mediaId: string) => MediaKindLike | undefined): SubPlan | null {
  const want = new Set(ids)
  const hits: { c: TlClip; quiet: boolean; visualLane: boolean }[] = []
  for (const l of tr) for (const c of l.clips) if (want.has(c.id)) hits.push({ c, quiet: l.hidden || l.muted, visualLane: l.kind !== 'audio' })
  if (!hits.length) return null
  const start = Math.min(...hits.map((h) => h.c.start)), end = Math.max(...hits.map((h) => h.c.start + h.c.length))
  const segs: SubSeg[] = []
  let picture = false
  for (const { c, quiet, visualLane } of hits) {
    const k = c.mediaId ? kindOf(c.mediaId) : undefined
    if (visualLane && (k !== 'audio')) picture = true
    if (quiet || c.muted || c.disabled || !hasSound(c, kindOf)) continue
    const gain = clipGain(c)
    const env = gainEnvelope(c) // 音量关键帧 ⇒ 逐帧音量
    if (gain <= 0 && !env?.some((p) => p[1] > 0)) continue
    segs.push({ mediaId: c.mediaId, at: Math.round((c.start - start) * 1000) / 1000, offset: c.offset, length: c.length, speed: speedOf(c), gain, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, ...(env ? { env } : {}), ...(c.curve ? { curve: c.curve } : {}), ...(c.reverse ? { reverse: true } : {}), ...(c.aud ? { aud: c.aud } : {}) })
  }
  segs.sort((a, b) => a.at - b.at)
  return end - start > EPS ? { start, end, segs, picture } : null
}
/** 子素材的档名：<第一段素材名>-子素材-月日-时分.wav（合并 ⇒ -合并-） */
export function subClipName(first: string, d: Date, lang: 'tw' | 'cn' | 'en', kind: 'sub' | 'merge' = 'sub'): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const base = first.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || (lang === 'en' ? 'clip' : '片段')
  const tag = kind === 'merge' ? (lang === 'en' ? 'merged' : lang === 'tw' ? '合併' : '合并') : lang === 'en' ? 'subclip' : '子素材'
  return `${base}-${tag}-${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.wav`
}

// ── 合并──
/** 合并得了吗：至少两段（锁了的轨上的不算）·而且都在音频轨上（画面要等影片汇出才合得了） */
export function mergeBlock(tr: Tracks, ids: readonly string[]): 'ok' | 'few' | 'picture' {
  const fs = ids.map((id) => findClip(tr, id)).filter((f) => !!f && !f.lane.locked)
  if (fs.length < 2) return 'few'
  return fs.every((f) => f!.lane.kind === 'audio') ? 'ok' : 'picture'
}
/** 合好的那段换上去：拿掉选中那几段·新的一段放在最早那段所在的轨（那段时间空着）·不然照拖素材进来的落点规划；回新轨道与新片段编号。
 *  kind＝visual（合并带画面：合成一支影片）⇒ 只认画面轨上的那几段当「家」·落点照画面素材规划 */
export function replaceWithMerged(tr: Tracks, ids: readonly string[], c: TlClip, newLaneId: string, kind: 'audio' | 'visual' = 'audio'): { tracks: Tracks; id: string } {
  const fs = ids.map((id) => findClip(tr, id)).filter((f): f is NonNullable<typeof f> => !!f && !f.lane.locked)
  fs.sort((x, y) => x.clip.start - y.clip.start || tr.indexOf(x.lane) - tr.indexOf(y.lane))
  if (kind === 'visual') fs.sort((x, y) => Number(x.lane.kind !== 'visual') - Number(y.lane.kind !== 'visual'))
  const gone = new Set(fs.map((f) => f.clip.id))
  const cut = tr.map((l) => (l.clips.some((x) => gone.has(x.id)) ? { ...l, clips: l.clips.filter((x) => !gone.has(x.id)) } : l))
  const home = fs.length && fs[0].lane.kind === (kind === 'visual' ? 'visual' : 'audio') ? cut.find((l) => l.id === fs[0].lane.id) : undefined
  const end = c.start + c.length
  const plan = home && !home.clips.some((x) => x.start < end - EPS && x.start + x.length > c.start + EPS)
    ? { lane: home.id, at: 0, kind, start: c.start, length: c.length }
    : planDrop(cut, kind, null, c.start, c.length)
  return { tracks: pruneGroups(applyDrop(cut, plan, c, newLaneId)), id: c.id }
}

// ── 编曲素材（多轨）──
/** 编曲素材拖上轨道：每份分轨一段·都从 at 开始·照拖素材进来的落点规划（第一份照放手那条轨·其余往音频区找空轨、被占就新开）·全部记同一个组编号；回新轨道与新片段编号 */
export function dropStems(tr: Tracks, stems: ReadonlyArray<{ mediaId: string; length: number }>, at: number, first: ReturnType<typeof planDrop> | null,
  ids: { clip: () => string; lane: () => string; group: string }): { tracks: Tracks; ids: string[] } {
  let out = tr
  const made: string[] = []
  const start = snapFrame(Math.max(0, first ? first.start : at))
  stems.forEach((s, i) => {
    const plan = i === 0 && first ? { ...first, length: s.length } : planDrop(out, 'audio', null, start, s.length)
    const c: TlClip = { id: ids.clip(), mediaId: s.mediaId, start: plan.start, length: plan.length, offset: 0, ...(stems.length > 1 ? { group: ids.group } : {}) }
    out = applyDrop(out, plan, c, ids.lane())
    made.push(c.id)
  })
  return { tracks: out, ids: made }
}
/** 编曲合成素材的档名：编曲-月日-时分.wav（混好那份）·编曲-月日-时分-<音轨名>.wav（分轨） */
export function stemFileName(mixName: string, label: string, ix: number): string {
  const base = mixName.replace(/\.wav$/i, '')
  const safe = label.replace(/[\\/:*?"<>|]/g, '').slice(0, 30) || String(ix + 1)
  return `${base}-${ix + 1}-${safe}.wav`
}
/** 「合成单一音频」那份的档名 */
export const mixdownName = (name: string, lang: 'tw' | 'cn' | 'en') => `${name.replace(/\.[^.]+$/, '')}-${lang === 'en' ? 'mix' : lang === 'tw' ? '合成' : '合成'}.wav`
