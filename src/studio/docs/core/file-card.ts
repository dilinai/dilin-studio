// 云文档「档案卡片」——存储形状与解析的单一真相源。
//
// 🔴 正文存的是云盘档案的 id 引用，不是档案内容。一张卡＝正文里独占一行的：
//   <div data-file-card="<user_files.id>" data-name="档名" data-size="字节数" data-mime="类型" data-created="ISO 时刻"></div>
//   - 只有 data-file-card（档案 id）是必需的；其余四个是挂档那一刻的快照，只拿来在查不到现况时显示、导出时当档名。
//     卡片上显示的档名／大小／类型／上传时间一律以服务端现查（/api/aiscribe/file-cards）为准。
//   - 必须顶格独占一行（前面最多 3 个空格·不在代码块里），跟音频 `<audio …>` 行同一套判法；
//     引用／清单里的同样字样不算卡片（不渲卡片、也不给下载——下载口按同一个 extractFileCardIds 判「这篇文档里挂了哪些档」）。
//
// 纯函数·零依赖（只 import 同样零依赖的 markdown-code-fence）⇒ 浏览器、服务端、单测都直接用这一份：
//   编辑器（tiptap 节点 parse／序列化）、分享页（切段渲染）、下载口（判「这篇挂了哪些档」）、
//   Word 导出（word-render）、PDF 导出（md-to-html）、MCP get_doc——⛔ 各写一份正则。
import { computeCodeLineMask, leadingIndentWidth } from './markdown-code-fence'

export const FILE_CARD_ATTR = 'data-file-card'

export interface FileCardAttrs {
  /** user_files.id（规范小写 uuid） */
  fileId: string
  name: string
  size: number | null
  mime: string
  /** 上传时间（ISO 字串·快照）；空字串＝不知道 */
  createdAt: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 一行是不是卡片（传入的是整行·内部 trim）。只认 `<div …data-file-card="…"…>` 加可选的 `</div>`，前后不能有别的字。 */
const FILE_CARD_LINE_RE = /^<div\s[^<>]*\bdata-file-card="[^"<>]*"[^<>]*>\s*(?:<\/div>)?$/i

function unescapeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

export function escapeFileCardAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attrOf(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))
  return m ? unescapeAttr(m[1]) : null
}

/** 档案 id 规范化：大小写不敏感·收规范 uuid；不是 uuid ⇒ null（这张卡当坏卡·不渲、不给下载）。 */
export function normalizeFileCardId(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase()
  return UUID_RE.test(s) ? s : null
}

export function isFileCardLine(line: string): boolean {
  return FILE_CARD_LINE_RE.test(line.trim())
}

/** 解析一行卡片；不是卡片行或 id 不合法 ⇒ null。 */
export function parseFileCardLine(line: string): FileCardAttrs | null {
  const t = line.trim()
  if (!FILE_CARD_LINE_RE.test(t)) return null
  const fileId = normalizeFileCardId(attrOf(t, FILE_CARD_ATTR))
  if (!fileId) return null
  const rawSize = attrOf(t, 'data-size')
  const n = rawSize && /^\d{1,16}$/.test(rawSize) ? Number(rawSize) : NaN
  return {
    fileId,
    name: attrOf(t, 'data-name') ?? '',
    size: Number.isFinite(n) && n >= 0 ? n : null,
    mime: attrOf(t, 'data-mime') ?? '',
    createdAt: attrOf(t, 'data-created') ?? '',
  }
}

/** 卡片 → 存储行（顺序固定·空的快照字段不写）。编辑器序列化与测试共用。 */
export function serializeFileCardLine(a: Pick<FileCardAttrs, 'fileId'> & Partial<FileCardAttrs>): string {
  const parts = [`${FILE_CARD_ATTR}="${escapeFileCardAttr(a.fileId)}"`]
  if (a.name) parts.push(`data-name="${escapeFileCardAttr(a.name)}"`)
  if (typeof a.size === 'number' && Number.isFinite(a.size) && a.size >= 0) parts.push(`data-size="${Math.round(a.size)}"`)
  if (a.mime) parts.push(`data-mime="${escapeFileCardAttr(a.mime)}"`)
  if (a.createdAt) parts.push(`data-created="${escapeFileCardAttr(a.createdAt)}"`)
  return `<div ${parts.join(' ')}></div>`
}

/** 这一行算不算一张卡：不在代码块里（masked＝computeCodeLineMask 那一格）、前面最多 3 个空格、整行是卡片标签。
 *  分享页切段（MarkdownWithFileCards）与下载口（extractFileCardIds）都只调这一个——画出来的卡＝能下载的卡。 */
export function fileCardAtLine(line: string, masked: boolean): FileCardAttrs | null {
  if (masked || leadingIndentWidth(line) > 3) return null
  return parseFileCardLine(line)
}

/** 整篇正文里挂了哪些卡（顶格独占一行·不在代码块里）；按出现顺序·含重复。 */
export function listFileCards(content: string | null | undefined): FileCardAttrs[] {
  const src = content ?? ''
  if (!src.includes(FILE_CARD_ATTR)) return []
  const lines = src.split('\n')
  const mask = computeCodeLineMask(src)
  const out: FileCardAttrs[] = []
  for (let i = 0; i < lines.length; i++) {
    const a = fileCardAtLine(lines[i], mask[i])
    if (a) out.push(a)
  }
  return out
}

/** 整篇正文挂了哪些档案 id（去重·保序）。下载口判「这份档是不是这篇文档挂的」只认这个。 */
export function extractFileCardIds(content: string | null | undefined): string[] {
  return [...new Set(listFileCards(content).map(a => a.fileId))]
}

/** 这份档的下载／打开网址（站内相对路径·权限由服务端按文档分享权限＋云盘现有判定现判）。 */
export function fileCardHref(docId: string, fileId: string, mode: 'download' | 'open' = 'download'): string {
  return `/api/aiscribe/file-cards?doc=${encodeURIComponent(docId)}&file=${encodeURIComponent(fileId)}&mode=${mode}`
}

export type FileCardLang = 'tw' | 'cn' | 'en'

const ATTACH_LABEL: Record<FileCardLang, string> = { tw: '附件：', cn: '附件：', en: 'Attachment: ' }
const UNNAMED: Record<FileCardLang, string> = { tw: '未命名檔案', cn: '未命名文件', en: 'Untitled file' }

/** 导出（docx／pdf）时卡片退化成的那一行字：「附件：档名」（连结另挂在档名上）。 */
export function fileCardExportLabel(lang: FileCardLang): string {
  return ATTACH_LABEL[lang]
}
export function fileCardExportName(name: string, lang: FileCardLang): string {
  return name.trim() || UNNAMED[lang]
}

/** 卡片在打开／新分页时浏览器能直接看的类型（其余一律下载）。html／svg／xml 等会跑脚本的类型⛔ 在这里。 */
export function fileCardInlineKind(mime: string | null | undefined): 'image' | 'pdf' | 'video' | 'audio' | 'text' | null {
  const m = (mime ?? '').trim().toLowerCase().split(';')[0]
  if (m === 'image/png' || m === 'image/jpeg' || m === 'image/gif' || m === 'image/webp' || m === 'image/avif') return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'text/plain' || m === 'text/markdown' || m === 'text/csv') return 'text'
  return null
}

/** 就地播放：影音卡点了在文件里展开播放器（src＝mode=open 同源网址·该路由对影音转 Range）；其余照旧另开／下载。 */
export function fileCardPlayKind(mime: string | null | undefined): 'video' | 'audio' | null {
  const k = fileCardInlineKind(mime)
  return k === 'video' || k === 'audio' ? k : null
}

/** 卡片里就地播放器外框的标记属性：编辑器 NodeView 的 stopEvent 认它（播放器上的点按／拖进度条／键盘一律不交给 ProseMirror） */
export const FILE_CARD_PLAYER_ATTR = 'data-file-card-player'

export function isInFileCardPlayer(target: EventTarget | null | undefined): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null | undefined
  return !!el && typeof el.closest === 'function' && !!el.closest(`[${FILE_CARD_PLAYER_ATTR}]`)
}

/** 服务端导出（Word／分享页 PDF）拼绝对连结用的本站网址：部署配置优先（NEXT_PUBLIC_SITE_ORIGIN／SITE_URL／BASE_URL），
 *  没配就按区域取正式站。⛔ 用请求的 Host（导出档会被带出站外·不让请求者决定连结指到哪）。 */
export function fileCardSiteOrigin(env: Record<string, string | undefined>, isCn: boolean): string {
  for (const v of [env.NEXT_PUBLIC_SITE_ORIGIN, env.NEXT_PUBLIC_SITE_URL, env.NEXT_PUBLIC_BASE_URL]) {
    const s = (v ?? '').trim()
    if (!s) continue
    try { return new URL(s).origin } catch { /* 配错当没配 */ }
  }
  return isCn ? 'https://dilinai.cn' : 'https://dilinai.com'
}
