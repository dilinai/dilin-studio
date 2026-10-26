// 剪辑页「Alt+A 加進對話」的小卡记号（登入版对话框与游客版右栏输入框共用一份）：
//   小卡＝输入框值里的一段记号（值仍是一串字·送出／复制出去的正文就是这串字·AI 照记号读）：
//   片段（单段／多选的片段包）＝ ⟦N 段片段：⟨主軌 0:03–0:08「a.mp4」⟩⟨…⟩·clips=<片段编号,…>⟧
//   标记＝ ⟦標記 0:12·marker=12.000⟧；转场借标记的记号 ⟦轉場「漏光疊化」0.6s 0:07·marker=7.800⟧
//   素材＝ ⟦素材 影片「a.mp4」·media=<素材编号>⟧
// 本档只放算法与字面（三语）——画卡在 ./chat-card-dom.ts。⛔ 碰 DOM。
import { MAIN_LANE, audioStart, findClip, type LaneKind, type TlClip, type Tracks } from './timeline.pure'
import { stickerName } from './sticker.pure'
import { filterName } from './filter.pure'
import { programName } from './program-name'
import { FX_ITEMS } from './fx.data'

export type RefLang = 'zh-TW' | 'zh-CN' | 'en'

/** 点片段卡 ⇒ 派这个事件（detail＝{ ids, firstAt }）·剪辑页收到就把那几段选起来、播放头跳过去 */
export const VEDIT_CLIP_REF_EVENT = 'dilinai:vedit-clip-ref'
export type ClipRefEventDetail = { ids: string[]; firstAt: number | null }
/** 点卡派的事件：标记卡 ⇒ 轨道跳过去（detail { at }）；素材卡 ⇒ 弹窗放小播放器（detail { id, label }） */
export const VEDIT_MARKER_REF_EVENT = 'dilinai:vedit-marker-ref'
export const VEDIT_MEDIA_REF_EVENT = 'dilinai:vedit-media-ref'
export type MarkerRefDetail = { at: number }
export type MediaRefDetail = { id: string; label: string }

/** 轨道是第几条（主轨＝main·其余＝同种轨从主轨往外数第几条·1 起）；没这条 ⇒ null */
export function laneOrdinal(tr: Tracks, laneId: string): { kind: LaneKind; main: boolean; n: number } | null {
  const i = tr.findIndex((l) => l.id === laneId)
  if (i < 0) return null
  const kind = tr[i].kind
  if (tr[i].id === MAIN_LANE) return { kind, main: true, n: 0 }
  // 上区轨道顺序可自由拖（主轨不一定在区界）⇒ 上区从区底往上数、音频区从区顶往下数（不算主轨）·同种不会撞号；
  // 主轨在上区最下面（旧样子）时跟原本「从主轨往外数」一样
  const a = audioStart(tr)
  let n = 0
  if (kind === 'audio') { for (let j = a; j <= i; j++) if (tr[j].kind === kind) n++ }
  else { for (let j = a - 1; j >= i; j--) if (tr[j].kind === kind && tr[j].id !== MAIN_LANE) n++ }
  return { kind, main: false, n }
}

const LANE_WORD: Record<RefLang, { main: string } & Record<LaneKind, string>> = {
  'zh-TW': { main: '主軌', visual: '畫面軌', audio: '音訊軌', text: '文字軌', sticker: '貼紙軌', filter: '濾鏡軌', program: '程式軌' },
  'zh-CN': { main: '主轨', visual: '画面轨', audio: '音频轨', text: '文字轨', sticker: '贴纸轨', filter: '滤镜轨', program: '程序轨' },
  en: { main: 'Main track', visual: 'Video track', audio: 'Audio track', text: 'Text track', sticker: 'Sticker track', filter: 'Filter track', program: 'Program track' },
}
export function laneLabel(o: { kind: LaneKind; main: boolean; n: number }, lang: RefLang): string {
  const w = LANE_WORD[lang]
  return o.main ? w.main : `${w[o.kind]} ${o.n}`
}

/** 秒 ⇒ m:ss（满一小时 h:mm:ss·不足一秒的捨去） */
export function fmtClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec + 1e-6))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}
/** m:ss／h:mm:ss ⇒ 秒；认不出 ⇒ null */
export function clockToSec(s: string): number | null {
  if (!/^\d+(?::\d{2}){1,2}$/.test(s)) return null
  return s.split(':').reduce((a, x) => a * 60 + Number(x), 0)
}

export type ClipRefItem = { id: string; laneId: string; start: number; end: number; name: string }
/** 选中的片段 ⇒ 卡与描述要的几格·照起点（同起点照轨道由上到下）排；找不到的片段跳过 */
export function clipRefItems(tr: Tracks, ids: readonly string[], nameOf: (mediaId: string) => string | undefined, lang: RefLang = 'zh-TW'): ClipRefItem[] {
  const out: (ClipRefItem & { li: number })[] = []
  for (const id of ids) {
    const f = findClip(tr, id)
    if (!f || out.some((x) => x.id === id)) continue
    out.push({ id, laneId: f.lane.id, start: f.clip.start, end: f.clip.start + f.clip.length, name: f.clip.text ? f.clip.text.content : f.clip.sticker ? stickerName(f.clip.sticker.sticker, lang) : f.clip.filter ? filterName(f.clip.filter.filter, lang) : f.clip.program ? programName(f.clip.program.pkg, lang) : nameOf(f.clip.mediaId) ?? '?', li: tr.indexOf(f.lane) })
  }
  out.sort((a, b) => a.start - b.start || a.li - b.li)
  return out.map(({ li: _li, ...x }) => x)
}

/** 描述一段（卡第二行与喂角色的那几格同一句）：「主軌 0:03–0:08「a.mp4」」；素材名里的 ⟨⟩ 换掉（那是本行切格的记号） */
export function clipRefText(tr: Tracks, it: ClipRefItem, lang: RefLang): string {
  const o = laneOrdinal(tr, it.laneId)
  const lane = o ? laneLabel(o, lang) : '?'
  const name = it.name.replace(/[⟨⟩]/g, (c) => (c === '⟨' ? '<' : '>')).replace(/\s*\n\s*/g, ' ')
  const span = `${fmtClock(it.start)}–${fmtClock(it.end)}`
  return lang === 'en' ? `${lane} ${span} "${name}"` : `${lane} ${span}「${name}」`
}

// ── 片段小卡的记号 ──
/** group1＝头＋各格（⟨…⟩…）·group2＝片段编号（逗号分隔） */
export const VEDIT_CLIP_TOKEN_SRC = '⟦([^⟦⟧\\n]*)·clips=([^⟦⟧\\s·]+)⟧'

const cleanCell = (s: string) => s.replace(/[⟦⟧]/g, '').replace(/[⟨]/g, '<').replace(/[⟩]/g, '>').replace(/\s*\n\s*/g, ' ').trim()
const cleanId = (s: string) => s.replace(/[\s,·⟦⟧]/g, '')

/** 选中的片段（描述已按 clipRefText 写好）⇒ 一颗行内小卡的记号；没有片段 ⇒ null */
export function buildClipToken(texts: readonly string[], ids: readonly string[], lang: RefLang): string | null {
  const idList = ids.map(cleanId).filter(Boolean)
  if (!texts.length || !idList.length) return null
  const cells = texts.map((x) => `⟨${cleanCell(x)}⟩`).join('')
  const head = lang === 'en' ? `${texts.length} clip(s): ` : `${texts.length} 段片段：`
  return `⟦${head}${cells}·clips=${idList.join(',')}⟧`
}

export type ClipToken = { ids: string[]; items: string[]; firstAt: number | null }
/** 一颗片段记号 ⇒ 编号、各段描述、第一段开头秒数；认不出 ⇒ null */
export function parseClipToken(raw: string): ClipToken | null {
  const m = new RegExp(`^${VEDIT_CLIP_TOKEN_SRC}$`).exec(raw.trim())
  if (!m) return null
  const ids = m[2].split(',').filter(Boolean)
  const items = Array.from(m[1].matchAll(/⟨([^⟨⟩]*)⟩/g), (x) => x[1])
  if (!ids.length || !items.length) return null
  const t = /(\d+(?::\d{2}){1,2})–/.exec(items[0])
  return { ids, items, firstAt: t ? clockToSec(t[1]) : null }
}

// ── 标记卡与素材卡 ──
export const VEDIT_MARKER_TOKEN_SRC = '⟦([^⟦⟧\\n·]*)·marker=(\\d+(?:\\.\\d+)?)⟧'
export const VEDIT_MEDIA_TOKEN_SRC = '⟦([^⟦⟧\\n·]*)·media=([A-Za-z0-9-]{1,64})⟧'
const MARKER_WORD: Record<RefLang, string> = { 'zh-TW': '標記', 'zh-CN': '标记', en: 'Marker' }
const MEDIA_WORD: Record<RefLang, { head: string; video: string; audio: string; image: string }> = {
  'zh-TW': { head: '素材', video: '影片', audio: '音訊', image: '圖片' },
  'zh-CN': { head: '素材', video: '视频', audio: '音频', image: '图片' },
  en: { head: 'Media', video: 'video', audio: 'audio', image: 'image' },
}
const cleanLabel = (s: string) => s.replace(/[⟦⟧⟨⟩·]/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
/** 时间尺上的标记（秒）⇒ 一颗标记卡的记号；秒数不对 ⇒ null */
export function buildMarkerToken(at: number, lang: RefLang): string | null {
  if (!Number.isFinite(at) || at < 0) return null
  return `⟦${MARKER_WORD[lang]} ${fmtClock(at)}·marker=${at.toFixed(3)}⟧`
}
export type MarkerToken = { at: number; label: string }
export function parseMarkerToken(raw: string): MarkerToken | null {
  const m = new RegExp(`^${VEDIT_MARKER_TOKEN_SRC}$`).exec(raw.trim())
  if (!m) return null
  const at = Number(m[2])
  return Number.isFinite(at) ? { at, label: m[1].trim() } : null
}
// ── 特效与转场：转场＝接缝上那个时间点 ⇒ 借标记卡的记号；特效＝片段身上的 ⇒ 片段卡那一格后面带上「（特效 色差、轉場 閃白衝焦 0.4s）」
const FX_LANG: Record<RefLang, 'tw' | 'cn' | 'en'> = { 'zh-TW': 'tw', 'zh-CN': 'cn', en: 'en' }
const FX_WORD: Record<RefLang, { fx: string; tr: string; sep: string }> = { 'zh-TW': { fx: '特效', tr: '轉場', sep: '、' }, 'zh-CN': { fx: '特效', tr: '转场', sep: '、' }, en: { fx: 'effects', tr: 'transition', sep: ', ' } }
/** 特效／转场编号 ⇒ 这个语言的名字（认不得 ⇒ 编号本身） */
export const fxName = (id: string, lang: RefLang) => FX_ITEMS.find((x) => x.id === id)?.name[FX_LANG[lang]] ?? id
/** 接缝上的转场（at＝后一段的开头秒）⇒ 一颗转场卡的记号；秒数不对 ⇒ null */
export function buildTransToken(at: number, trId: string, length: number, lang: RefLang): string | null {
  if (!Number.isFinite(at) || at < 0) return null
  const name = cleanLabel(fxName(trId, lang))
  const len = `${Math.round(length * 10) / 10}s`
  const label = lang === 'en' ? `${FX_WORD.en.tr} "${name}" ${len} ${fmtClock(at)}` : `${FX_WORD[lang].tr}「${name}」${len} ${fmtClock(at)}`
  return `⟦${label}·marker=${at.toFixed(3)}⟧`
}
/** 片段身上的特效与转场 ⇒ 片段卡那一格后面的括号说明（都没有 ⇒ 空字串） */
export function clipFxNote(c: Pick<TlClip, 'fx' | 'transIn'>, lang: RefLang): string {
  const w = FX_WORD[lang]
  const parts: string[] = []
  if (c.fx?.length) parts.push(`${w.fx} ${c.fx.map((f) => fxName(f.fx, lang)).join(lang === 'en' ? ' + ' : '+')}`)
  if (c.transIn) parts.push(`${w.tr} ${fxName(c.transIn.tr, lang)} ${Math.round(c.transIn.length * 10) / 10}s`)
  if (!parts.length) return ''
  return lang === 'en' ? ` (${parts.join(w.sep)})` : `（${parts.join(w.sep)}）`
}
/** 素材区一份素材 ⇒ 一颗素材卡的记号（标签带种类与档名）；编号不像样 ⇒ null */
export function buildMediaToken(m: { id: string; name: string; kind: 'video' | 'audio' | 'image' }, lang: RefLang): string | null {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(m.id)) return null
  const w = MEDIA_WORD[lang]
  const name = cleanLabel(m.name) || '?'
  return lang === 'en' ? `⟦${w.head} ${w[m.kind]} "${name}"·media=${m.id}⟧` : `⟦${w.head} ${w[m.kind]}「${name}」·media=${m.id}⟧`
}
export type MediaToken = { id: string; label: string }
export function parseMediaToken(raw: string): MediaToken | null {
  const m = new RegExp(`^${VEDIT_MEDIA_TOKEN_SRC}$`).exec(raw.trim())
  return m ? { id: m[2], label: m[1].trim() } : null
}

/** 选中的几段 ⇒ 一颗片段卡（各段描述后面带上身上的特效、转场）；都找不到 ⇒ null。登入版宿主与游客版宿主都用这支 */
export function clipsTokenOf(tr: Tracks, ids: readonly string[], nameOf: (mediaId: string) => string | undefined, lang: RefLang): string | null {
  const items = clipRefItems(tr, ids, nameOf, lang)
  return buildClipToken(items.map((it) => clipRefText(tr, it, lang) + (() => { const f = findClip(tr, it.id); return f ? clipFxNote(f.clip, lang) : '' })()), items.map((it) => it.id), lang)
}
/** 片段卡上那一小格「N 段片段」 */
export function clipCountLabel(n: number, lang: RefLang): string {
  return lang === 'en' ? `${n} clip(s)` : `${n} 段片段`
}
