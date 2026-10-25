// 网页剪辑页·自动保存草稿。
// 的读法（已发出）：原本只有已存成剪辑档（网址带 ?id=）的才停手 1.2 秒自动存；直接开剪辑页、还没按「存成剪輯檔」前关掉就没了。
//   改成照剪映：一开始动手剪（第一次真改动：加素材、加片段、改轨道等）就自动在设定里的草稿资料夹（没设＝云盘根目录）开一份草稿工程档，
//   网址换成 ?id=，之后照现有的停手自动存。草稿名「剪輯草稿＋日期时间」（三语·之后可改名）。剪辑页加「最近的草稿」清单（点了开 ?id= 接着剪）。
// 本档只放纯函数（题直接跑·页面与 /api/vedit/project 共用）：算不算真动手、该不该建、失败怎么说、多久再试、草稿名、最近清单读回与时间字。⛔ 碰 DOM／库。
import type { Tracks } from './timeline.pure'
import type { RatioSel } from './ratio.pure'
import { safeProjectName } from './project.pure'

export type DraftLang = 'zh-TW' | 'zh-CN' | 'en'

/** 看「有没有动手」用的那几样：轨道（整份）、素材区有哪几份、画面比例 */
export type DraftSnap = { tracks: Tracks; mediaIds: readonly string[]; ratio: RatioSel }

/** 跟开页那一刻（本机素材清单读回之后）比，算不算真动手剪了：
 *  轨道有任何变化（加片段、加轨、锁／藏／静音…）、素材区多了开页时没有的素材、改了画面比例 ⇒ 算；
 *  只是看看（播放、选片段、开设定、背景转档／上传完成）⇒ 不算；只移除开页时就在的素材 ⇒ 不算（那是清理·不建空草稿）。
 *  base＝null（开页还没读完）⇒ 不算。 */
export function draftTouched(base: DraftSnap | null, now: DraftSnap): boolean {
  if (!base) return false
  if (JSON.stringify(base.tracks) !== JSON.stringify(now.tracks)) return true
  const had = new Set(base.mediaIds)
  if (now.mediaIds.some((id) => !had.has(id))) return true
  return JSON.stringify(base.ratio) !== JSON.stringify(now.ratio)
}

/** 建草稿的进度：idle 还没建／creating 正在建／failed 没建成（retryAt 后再试）／done 建好了（这页不再建） */
export type DraftPhase = 'idle' | 'creating' | 'failed' | 'done'
export type DraftState = { phase: DraftPhase; tries: number; retryAt: number }
export const DRAFT_IDLE: DraftState = { phase: 'idle', tries: 0, retryAt: 0 }

/** 现在该怎么做：create＝去建；wait＝没建成、还没到再试的时候（计时器会再叫）；none＝不用建。
 *  已经开着工程档（网址有 ?id=／已建好）⇒ none（照旧·不重建）；正在建 ⇒ none（同一页只建一次·建好再走自动存）；没动手 ⇒ none（不建空草稿）。 */
export function draftNext(s: { hasProject: boolean; urlId: boolean; touched: boolean; state: DraftState; now: number }): 'create' | 'wait' | 'none' {
  if (s.hasProject || s.urlId) return 'none'
  if (s.state.phase === 'done' || s.state.phase === 'creating') return 'none'
  if (!s.touched) return 'none'
  if (s.state.phase === 'failed' && s.now < s.state.retryAt) return 'wait'
  return 'create'
}

/** 第几次没建成之后隔多久再试：5、10、20、40 秒，之后每 60 秒 */
export const DRAFT_RETRY_MAX_MS = 60_000
export function draftRetryMs(tries: number): number {
  const n = Math.max(1, Math.floor(tries))
  return Math.min(DRAFT_RETRY_MAX_MS, 5000 * 2 ** Math.min(n - 1, 10))
}

/** 没建成的原因（顶栏那句白话照这个挑）：没登入／云盘满／网路断／其他 */
export type DraftFail = 'login' | 'full' | 'net' | 'other'
/** status＝null 表示请求根本没送到（网路断） */
export function draftFailKind(status: number | null, code?: string | null): DraftFail {
  if (status === null || status === 0) return 'net'
  if (status === 401) return 'login'
  if (status === 413 || code === 'vedit_project_quota' || code === 'quota_exceeded') return 'full'
  return 'other'
}

const pad = (n: number) => String(n).padStart(2, '0')
/** 草稿名：「剪輯草稿 2026-10-06 19.15」（本机时间·冒号在档名里会被换掉 ⇒ 时分用点）·三语 */
export function draftName(lang: DraftLang, d: Date): string {
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
  return `${lang === 'en' ? 'Edit draft' : lang === 'zh-CN' ? '剪辑草稿' : '剪輯草稿'} ${when}`
}

// ── ＋ 「像这样」（附剪映「本地草稿」格子：
//    封面、名字、大小｜时长）：每份工程档旁存一张「卡片」（封面缩图＋总长）·列表口一起回。──
//   剪辑页每次自动存成功时一并写（PUT 带 card）·写不成不挡存档。⛔ 建迁移（库里没有封面／时长栏）。
/** 卡片物件的储存键（工程档旁边） */
export const cardKeyOf = (projectR2Key: string): string => `${projectR2Key}.card.json`
/** （迁移 395）：工程档每次存档换一个新物件 ⇒ 卡片改按档号存一个固定键（角色写回不带卡片也不会丢）；读时找不到再退回旧那格（cardKeyOf(r2_key)） */
export const cardKeyForFile = (userId: string, fileId: string): string => `userfiles/${userId}/vedit-card-${fileId}.json`
/** 卡片整份上限（封面 data URL 占大头·小缩图 JPEG 约 10～20KB） */
export const VEDIT_CARD_MAX_BYTES = 48 * 1024
/** 封面缩图长边几像素 */
export const COVER_EDGE = 240
export type DraftCard = { duration: number; cover: string | null }
const COVER_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/
/** 卡片读回：时长 0～24 小时（坏的当 0）·封面只认 base64 图片 data URL 且整份不超上限（超了／坏了 ⇒ 没封面）。整份不是物件 ⇒ null */
export function parseCard(raw: unknown): DraftCard | null {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const d = typeof o.duration === 'number' && Number.isFinite(o.duration) ? Math.min(86400, Math.max(0, o.duration)) : 0
  const cover = typeof o.cover === 'string' && o.cover.length <= VEDIT_CARD_MAX_BYTES - 64 && COVER_RE.test(o.cover) ? o.cover : null
  return { duration: d, cover }
}

/** 封面取哪一格：画面轨（没藏）上最早一段没停用的影片／图片片段（同时开始 ⇒ 上面那条）·影片取那段开头往里一点（避开黑场）；没有 ⇒ null（黑底） */
export function coverPick(tracks: Tracks, kindOf: (mediaId: string) => 'video' | 'audio' | 'image' | undefined): { mediaId: string; kind: 'video' | 'image'; at: number } | null {
  let best: { mediaId: string; kind: 'video' | 'image'; at: number; start: number } | null = null
  for (const l of tracks) {
    if (l.kind !== 'visual' || l.hidden) continue
    for (const c of l.clips) {
      if (c.disabled || !c.mediaId) continue
      const k = kindOf(c.mediaId)
      if (k !== 'video' && k !== 'image') continue
      if (best && best.start <= c.start) continue
      best = { mediaId: c.mediaId, kind: k, at: k === 'image' ? 0 : c.offset + Math.min(1, c.length * 0.1), start: c.start }
    }
  }
  return best ? { mediaId: best.mediaId, kind: best.kind, at: best.at } : null
}

/** 卡片上的时长字：「02:28」；一小时以上「1:02:28」 */
export function fmtCardDuration(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`
}

/** 「最近的草稿」列几份（服务端也照这个限） */
export const RECENT_DRAFTS_LIMIT = 20
export type RecentDraft = { id: string; title: string; updated_at: string; folder_id: string | null; duration: number | null; cover: string | null }
const UUID_RE = /^[0-9a-f-]{36}$/i

/** 最近清单回包读回：坏的条目丢掉·按更新时间新到旧·最多 RECENT_DRAFTS_LIMIT 份（⛔ 抛） */
export function parseRecentDrafts(raw: unknown): RecentDraft[] {
  const items = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []
  const out: RecentDraft[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id) || typeof o.updated_at !== 'string' || !Number.isFinite(Date.parse(o.updated_at))) continue
    const card = parseCard({ duration: o.duration, cover: o.cover })
    out.push({ id: o.id, title: typeof o.title === 'string' && o.title.trim() ? o.title : '?', updated_at: o.updated_at, folder_id: typeof o.folder_id === 'string' ? o.folder_id : null,
      duration: typeof o.duration === 'number' && card ? card.duration : null, cover: card?.cover ?? null })
  }
  return out.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, RECENT_DRAFTS_LIMIT)
}

// ── （顶栏中间的剪辑名）──
// 名字存在哪：剪辑名＝云盘里工程档的档名「<名>.dvedit」（/api/vedit/project 读回的 title、「專案」清单的名字都是 projectTitle(档名)）；
//   工程档内容、卡片（<r2_key>.card.json）里都没有名字栏 ⇒ 改名＝改那份档的档名（云盘页改名同一条口 PATCH /api/files/<id>）。
/** 改名输入框收尾（Enter／失焦）：过档名清洗（同建档 safeProjectName·上限 VEDIT_NAME_MAX）；清完是空的（空白／只有空格）或跟现在一样 ⇒ 不存（恢复原名） */
export function renameVerdict(raw: string, current: string): { save: false } | { save: true; name: string } {
  const name = safeProjectName(raw, '')
  return !name || name === current ? { save: false } : { save: true, name }
}
/** 建草稿时用的名字：还没建草稿时先改过名 ⇒ 用那个；没改过 ⇒「剪輯草稿＋日期时间」 */
export function draftCreateName(pending: string | null, lang: DraftLang, d: Date): string {
  return pending && safeProjectName(pending, '') ? safeProjectName(pending, '') : draftName(lang, d)
}

/** 清单上的时间：今年 ⇒「10-06 19:15」；别年 ⇒「2025-10-06 19:15」（本机时间） */
export function fmtDraftTime(iso: string, now: Date): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`
}
