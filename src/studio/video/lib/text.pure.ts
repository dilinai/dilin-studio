// 网页剪辑页·文字片段＋花字库（附图＝剪映专业版「文本／花字库」）。
// 文字片段＝放在文字轨上的一段（TlClip.text·mediaId 空）：播放器上叠字画（花字用那支 fancyToCss）·能拖位置、拉大小、双击改字。
// 花字库：「文本」页签左清单「花字库」底下 15 类（照剪映那排）·右边款式格；点一款 ⇒ 选中的文字片段都套这款；没选文字 ⇒ 在播放头新加一段套好的。
// 本档只放纯函数（题直接跑）；画在 video-edit/page.tsx 与 VeditAssetTabs.tsx。⛔ 碰 DOM。
import { isAss, parseAss } from './subtitle-io.pure'
import { FANCY_CATS, FANCY_TEXTS, type FancyCat, type FancyItem, type FancyStyle } from './fancy-text.data'
import { MIN_CLIP, applyDrop, findClip, newLane, planDrop, snapFrame, type TextBody, type TlClip, type Tracks } from './timeline.pure'

/** 新加的文字片段多长（同图片·之后拉两端改） */
export const TEXT_DEFAULT_SECONDS = 3
/** （要能拖进轨道）：文本页的卡拖着带这个类型·值＝花字款式编号（素白的默认文本＝TEXT_DRAG_PLAIN） */
export const TEXT_DRAG_MIME = 'application/x-vedit-text'
export const TEXT_DRAG_PLAIN = 'plain'
/** 字高占画面高：缺省／最小／最大 */
export const TEXT_SIZE_DEFAULT = 0.1
export const TEXT_SIZE_MIN = 0.03
export const TEXT_SIZE_MAX = 0.5
/** 没套花字时的素白字（白字＋淡黑影·深浅底都看得清） */
export const PLAIN_TEXT_STYLE: FancyStyle = { family: 'sans', weight: 700, fill: { type: 'solid', color: '#ffffff' }, shadows: [{ color: 'rgba(0,0,0,0.6)', blur: 0.08, x: 0, y: 0.04 }] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const FANCY_BY_ID = new Map(FANCY_TEXTS.map((f) => [f.id, f]))
export const fancyById = (id: string | undefined): FancyItem | null => (id ? FANCY_BY_ID.get(id) ?? null : null)
/** 这段字画成什么样（花字编号认不得 ⇒ 素白字） */
export const textStyleOf = (b: Pick<TextBody, 'fancy'>): FancyStyle => fancyById(b.fancy)?.style ?? PLAIN_TEXT_STYLE

// ── 左清单：花字库底下 15 类（编号 fancy-<类>）──
export const FANCY_CAT_PREFIX = 'fancy-'
export const fancyCatIds = (): string[] => FANCY_CATS.map((c) => FANCY_CAT_PREFIX + c.id)
/** 左清单选的那格是不是花字某一类（是 ⇒ 回类别） */
export function fancyCatOf(pick: string): FancyCat | null {
  if (!pick.startsWith(FANCY_CAT_PREFIX)) return null
  const id = pick.slice(FANCY_CAT_PREFIX.length)
  return FANCY_CATS.some((c) => c.id === id) ? (id as FancyCat) : null
}
/** 这一类的款式（照资料档顺序） */
export const fancyIn = (cat: FancyCat): FancyItem[] => FANCY_TEXTS.filter((f) => f.cats.includes(cat))

// ── 文字片段 ──
export const isTextClip = (c: Pick<TlClip, 'text'>): boolean => !!c.text
export function newTextClip(id: string, content: string, fancy: string | null): TlClip {
  const text: TextBody = { content, x: 0.5, y: 0.5, size: TEXT_SIZE_DEFAULT, ...(fancy ? { fancy } : {}) }
  return { id, mediaId: '', start: 0, length: TEXT_DEFAULT_SECONDS, offset: 0, text }
}
/** 在播放头加一段文字（文字轨照拖素材的落点规划：主轨上面离主轨最近那条文字轨·那段被占／锁了 ⇒ 往上新增一条） */
export function addTextAt(tr: Tracks, clip: TlClip, at: number, newLaneId: string): Tracks {
  return applyDrop(tr, planDrop(tr, 'text', null, snapFrame(Math.max(0, at)), clip.length), clip, newLaneId)
}
/** 选中的片段里能改的文字片段（锁了的轨不算） */
export function editableTextIds(tr: Tracks, sel: readonly string[]): string[] {
  return sel.filter((id) => { const f = findClip(tr, id); return !!f && !!f.clip.text && !f.lane.locked })
}
/** 改这几段文字（锁了的轨不动·f 回原物件＝没变）；一段都没变 ⇒ 原物件（文字栏也走这条） */
export function patchText(tr: Tracks, ids: ReadonlySet<string>, f: (b: TextBody) => TextBody): Tracks {
  let hit = false
  const out = tr.map((l) => {
    if (l.locked || !l.clips.some((c) => ids.has(c.id) && c.text)) return l
    return { ...l, clips: l.clips.map((c) => { if (!ids.has(c.id) || !c.text) return c; const t = f(c.text); if (t === c.text) return c; hit = true; return { ...c, text: t } }) }
  })
  return hit ? out : tr
}
/** 点一款花字：选中有文字片段 ⇒ 都套这款（ids＝那几段）；没有 ⇒ 在播放头新加一段套好的（ids＝新那段·页面选起来） */
export function applyFancy(tr: Tracks, sel: readonly string[], fancy: string, at: number, mk: { id: () => string; laneId: () => string; content: string }): { tracks: Tracks; ids: string[]; added: boolean } {
  if (!fancyById(fancy)) return { tracks: tr, ids: [], added: false }
  const ids = editableTextIds(tr, sel)
  if (ids.length) return { tracks: patchText(tr, new Set(ids), (b) => (b.fancy === fancy ? b : { ...b, fancy })), ids, added: false }
  const c = newTextClip(mk.id(), mk.content, fancy)
  return { tracks: addTextAt(tr, c, at, mk.laneId()), ids: [c.id], added: true }
}
/** 画面上拖位置：中心落在 0～1 */
export const moveText = (tr: Tracks, id: string, x: number, y: number): Tracks =>
  patchText(tr, new Set([id]), (b) => ({ ...b, x: clamp(x, 0, 1), y: clamp(y, 0, 1) }))
/** 拉右下角改大小：字高占画面高 TEXT_SIZE_MIN～MAX */
export const resizeText = (tr: Tracks, id: string, size: number): Tracks =>
  patchText(tr, new Set([id]), (b) => ({ ...b, size: clamp(size, TEXT_SIZE_MIN, TEXT_SIZE_MAX) }))
/** 双击改字：去头尾空白·改成空的 ⇒ 不改（留原字·要拿掉就删片段） */
export function setTextContent(tr: Tracks, id: string, content: string): Tracks {
  const v = content.replace(/^\s+|\s+$/g, '')
  if (!v) return tr
  return patchText(tr, new Set([id]), (b) => (b.content === v ? b : { ...b, content: v }))
}
/** 拉角改大小的换算：拖动的距离（画面高的比例）加到原字高上 */
export const sizeFromDrag = (size0: number, dyFrac: number): number => clamp(size0 + dyFrac, TEXT_SIZE_MIN, TEXT_SIZE_MAX)

// ── 「新建文本」两张卡──
// 默认文本＝在播放头加一段素白字（同花字那条落点）；导入本地字幕＝读 SRT／VTT·一句一段排上一条文字轨（字在画面下方）。
/** 字幕放在画面哪里、字多大（字高占画面高） */
export const SUBTITLE_Y = 0.88
export const SUBTITLE_SIZE = 0.055
/** 字幕档上限（字节）与句数上限 */
export const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024
export const SUBTITLE_MAX_CUES = 3000
export type SubtitleCue = { start: number; end: number; text: string }
/** 识别字幕补满空隙（剪映「自动填充文本间隙」）：一句结束到下一句开始之间空着 ≤ maxGap 秒 ⇒ 前一句拉长接上（字幕不再一闪一闪）；
 *  空更久的（真的没人说话）留着·不改句子内容、不动开头 */
export const CUE_GAP_FILL_MAX = 2
export function fillCueGaps(cues: readonly SubtitleCue[], maxGap = CUE_GAP_FILL_MAX): SubtitleCue[] {
  const out = [...cues].sort((a, b) => a.start - b.start).map((c) => ({ ...c }))
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = out[i + 1].start - out[i].end
    if (gap > 1e-6 && gap <= maxGap + 1e-6) out[i].end = out[i + 1].start
  }
  return out
}

/** 在播放头加一段默认文本（回新轨道与那段的编号·页面选起来） */
export function addDefaultText(tr: Tracks, at: number, mk: { id: () => string; laneId: () => string; content: string }): { tracks: Tracks; id: string } {
  const c = newTextClip(mk.id(), mk.content, null)
  return { tracks: addTextAt(tr, c, at, mk.laneId()), id: c.id }
}

/** 字幕档的位元组 ⇒ 文字：有 BOM 照 BOM；能当 UTF-8 读就 UTF-8；不能（台湾常见 Big5·大陆常见 GBK）⇒ 按介面语言猜 */
export function decodeSubtitleBytes(bytes: Uint8Array, lang: 'zh-TW' | 'zh-CN' | 'en' | string): string {
  const b = bytes
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3))
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { /* 不是 UTF-8 */ }
  try { return new TextDecoder(lang === 'zh-CN' ? 'gb18030' : 'big5').decode(b) } catch { return new TextDecoder('utf-8').decode(b) }
}

/** 时间码 ⇒ 秒：「01:02:03,456」「01:02:03.456」「02:03.456」（VTT 可省时）；认不得 ⇒ null */
function parseStamp(s: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim())
  if (!m) return null
  const [, h, mi, se, ms] = m
  if (Number(mi) > 59 || Number(se) > 59) return null
  return Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(se) + (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0)
}
/** 读 SRT／VTT（ASS／SSA 交 subtitle-io.parseAss）：一块一句（序号行可有可无·时间行后面的版面设定不管）；去掉 <i>、{\an8} 这类标记；空句、倒着的时间丢掉；照开始时间排 */
export function parseSubtitles(raw: string): SubtitleCue[] {
  if (isAss(raw)) return parseAss(raw)
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const out: SubtitleCue[] = []
  for (const block of text.split(/\n[ \t]*\n+/)) {
    const lines = block.split('\n').map((l) => l.replace(/\s+$/, ''))
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const [a, rest] = lines[ti].split('-->')
    const start = parseStamp(a), end = parseStamp((rest ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null || end <= start) continue
    const body = lines.slice(ti + 1).map((l) => l.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()).filter(Boolean).join('\n')
    if (body) out.push({ start, end, text: body })
  }
  return out.sort((x, y) => x.start - y.start)
}

/** 字幕句 ⇒ 一句一段文字片段（对齐到帧·跟下一句叠到的部分截掉·短过一帧的丢掉·最多 SUBTITLE_MAX_CUES 句） */
export function subtitleClips(cues: readonly SubtitleCue[], mkId: () => string): TlClip[] {
  const out: TlClip[] = []
  const list = cues.slice(0, SUBTITLE_MAX_CUES)
  for (let i = 0; i < list.length; i++) {
    const s = snapFrame(Math.max(0, list[i].start))
    let e = snapFrame(list[i].end)
    const next = list[i + 1]
    if (next) e = Math.min(e, snapFrame(next.start))
    if (out.length) { const p = out[out.length - 1]; if (s < p.start + p.length - 1e-6) continue }
    if (e - s < MIN_CLIP - 1e-6) continue
    out.push({ id: mkId(), mediaId: '', start: s, length: e - s, offset: 0, text: { content: list[i].text, x: 0.5, y: SUBTITLE_Y, size: SUBTITLE_SIZE } })
  }
  return out
}
/** 整批字幕放上一条文字轨：主轨上方离主轨最近那条文字轨在整段时间里空着又没锁 ⇒ 放进去；不然往上新增一条（同 planDrop 落点） */
export function addSubtitles(tr: Tracks, cues: readonly SubtitleCue[], mk: { id: () => string; laneId: () => string }): { tracks: Tracks; ids: string[] } {
  const clips = subtitleClips(cues, mk.id)
  if (!clips.length) return { tracks: tr, ids: [] }
  const span0 = clips[0].start, last = clips[clips.length - 1]
  const p = planDrop(tr, 'text', null, span0, last.start + last.length - span0)
  const byStart = (a: TlClip, b: TlClip) => a.start - b.start
  if (p.lane !== null) return { tracks: tr.map((l) => (l.id === p.lane ? { ...l, clips: [...l.clips, ...clips].sort(byStart) } : l)), ids: clips.map((c) => c.id) }
  const at = Math.min(Math.max(0, p.at), tr.length)
  return { tracks: [...tr.slice(0, at), { ...newLane(mk.laneId(), 'text'), clips }, ...tr.slice(at)], ids: clips.map((c) => c.id) }
}
