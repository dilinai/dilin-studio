// Docs project file (project.json) — see FORMAT.md for the field reference given to AI assistants.
//
//   {
//     "format": "dilin-studio/docs",
//     "version": 2,
//     "name": "Untitled document",
//     "paper": { "paper": "a4-portrait", "marginsMm": { "top": 25.4, "bottom": 25.4, "left": 31.7, "right": 31.7 }, "pageNumbers": false },
//     "content": ["# Title", "", "Body text…"],
//     "layers": { "v": 1, "unit": "mm", "items": [ … ] }
//   }
//
// `content` is the document as markdown, one array item per line (easier for people and AI to edit
// than one long escaped string). A single string is accepted on read as well.
// Images, video and audio live in assets/ and are referenced by relative path, e.g. ![](assets/photo.png).
// `layers` (version 2) are free-placed items pinned to a page (text boxes, images, video, audio); optional.
// Version 1 files (no layers) are read as they are and written back as version 2.

import type { ProjectStore, StudioFormat, StudioLang } from '../shared/types'
import { StudioError } from '../shared/types'
import { readProjectJson, writeProjectJson } from '../shared/project-file'
import { saveProjectSafe } from '../shared/store'
import type { SafeWriteResult } from '../shared/types'
import { defaultPaperSettings, parsePaperSettings, type DocPaperSettings } from './core/paper-size'
import { sanitizeDocLayers, type DocLayers } from './core/doc-layers/types'

export const DOCS_FORMAT_VERSION = 2

export interface DocsDoc {
  name: string
  paper: DocPaperSettings
  /** Markdown body (joined with \n). */
  content: string
  /** Free-placed items (text boxes etc.); null = none. */
  layers: DocLayers | null
}

export function emptyDocsDoc(): DocsDoc {
  return { name: '', paper: defaultPaperSettings(null), content: '', layers: null }
}

/** project.json body (header excluded) → DocsDoc. Unknown/invalid optional fields fall back to defaults. */
export function docsDocFromJson(j: Record<string, unknown>): DocsDoc {
  const raw = j.content
  let content: string
  if (Array.isArray(raw)) {
    if (!raw.every(l => typeof l === 'string')) throw new StudioError('bad_format', 'content must be an array of strings')
    content = (raw as string[]).join('\n')
  } else if (typeof raw === 'string') {
    content = raw
  } else if (raw === undefined || raw === null) {
    content = ''
  } else {
    throw new StudioError('bad_format', 'content must be an array of strings')
  }
  const name = typeof j.name === 'string' ? j.name.slice(0, 200) : ''
  const paper = parsePaperSettings(j.paper) ?? defaultPaperSettings(null)
  const layers = sanitizeDocLayers(j.layers)
  return { name, paper, content: content.replace(/\r\n?/g, '\n'), layers: layers && layers.items.length ? layers : null }
}

/** DocsDoc → project.json body (header added by writeProjectJson). */
export function docsDocToJson(doc: DocsDoc): Record<string, unknown> {
  return {
    name: doc.name,
    paper: { paper: doc.paper.paper, marginsMm: { ...doc.paper.marginsMm }, pageNumbers: doc.paper.pageNumbers },
    content: doc.content === '' ? [] : doc.content.split('\n'),
    ...(doc.layers && doc.layers.items.length ? { layers: doc.layers } : {}),
  }
}

/** Relative asset paths used inside the markdown body: `assets/<name>`. */
export const ASSET_PREFIX = 'assets/'
export function assetNameFromSrc(src: string): string | null {
  if (!src.startsWith(ASSET_PREFIX)) return null
  let name = src.slice(ASSET_PREFIX.length)
  try { name = decodeURIComponent(name) } catch { /* keep raw */ }
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.length > 200) return null
  return name
}
export function srcFromAssetName(name: string): string {
  return ASSET_PREFIX + name
}

// Files the editor stores itself are named `<16 lowercase hex>.<ext>` (SHA-256 of the bytes, so inserting the same
// file twice reuses it; files over HASH_MAX_BYTES get a random name instead of being read whole). Only names of this
// shape are ever deleted by the cleanup; anything named by a person or an AI stays.
export const OWN_ASSET_NAME = /^[0-9a-f]{16}\.[a-z0-9]{1,10}$/
export const HASH_MAX_BYTES = 64 * 1024 * 1024
export function isOwnAssetName(name: string): boolean {
  return OWN_ASSET_NAME.test(name)
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba', 'audio/aac': 'aac', 'audio/flac': 'flac',
}
export function assetExt(fileName: string, mime: string): string {
  const dot = fileName.lastIndexOf('.')
  const fromName = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : ''
  return fromName || MIME_EXT[mime.toLowerCase()] || 'bin'
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** The assets/ name the editor gives an inserted file. */
export async function ownAssetName(file: Blob, fileName: string): Promise<string> {
  const ext = assetExt(fileName, file.type || '')
  let id: Uint8Array
  if (file.size <= HASH_MAX_BYTES) id = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  else id = globalThis.crypto.getRandomValues(new Uint8Array(8))
  return `${hex(id).slice(0, 16)}.${ext}`
}

/** Editor-named files in assets/ that the markdown body no longer mentions. */
export function staleOwnAssets(files: readonly string[], content: string): string[] {
  return files.filter(f => isOwnAssetName(f) && !content.includes(ASSET_PREFIX + f))
}

const SUMMARY: Record<StudioLang, string> = {
  'zh-TW': [
    'project.json 欄位：format 固定 "dilin-studio/docs"、version 固定 2、name（文件名）、paper（紙張：paper 為 a4|b5|a3 加 -portrait|-landscape，或 null＝不分頁；marginsMm 上下左右邊距 mm；pageNumbers 頁碼）、content（正文 markdown，陣列一項一行）、layers（可省：釘在紙上的自由組件，如文字方塊，見 FORMAT.md）。',
    '正文語法：# 到 #### 標題、**粗體**、*斜體*、~~刪除線~~、`程式碼`、- 清單、1. 編號、> 引用、--- 分隔線、| 表格 |、```程式碼區塊```、```mermaid 圖表。',
    '擴充語法：:color[字]{color=red}、:bg[字]{color=#fde68a}（底色）、:box[字]{color=#94a3b8}（框）；:::tip 換行 內容 換行 :::（tip/note/info/warn/danger/success/important/caution）；$$ 公式 $$；[[toc]] 目錄；{indent:2} 開頭＝縮排；單獨一行 &nbsp;＝空行；<!--pagebreak-->＝分頁。',
    '圖片影音放 assets/ 資料夾，用相對路徑：![說明](assets/圖.png)、<img src="assets/圖.png" width="320">、<video src="assets/片.mp4" controls></video>、<audio src="assets/聲.mp3" data-name="聲.mp3" controls></audio>。自己放的檔用一般檔名；16 個十六進位字元的檔名（如 3f9a0c1d2b4e5f60.jpg）歸編輯器管，正文沒提到就會被清掉。',
    '改完直接存檔，網頁會在一兩秒內自動更新。',
  ].join('\n'),
  'zh-CN': [
    'project.json 字段：format 固定 "dilin-studio/docs"、version 固定 2、name（文件名）、paper（纸张：paper 为 a4|b5|a3 加 -portrait|-landscape，或 null＝不分页；marginsMm 上下左右边距 mm；pageNumbers 页码）、content（正文 markdown，数组一项一行）、layers（可省：钉在纸上的自由组件，如文字方块，见 FORMAT.md）。',
    '正文语法：# 到 #### 标题、**粗体**、*斜体*、~~删除线~~、`代码`、- 列表、1. 编号、> 引用、--- 分隔线、| 表格 |、```代码块```、```mermaid 图表。',
    '扩展语法：:color[字]{color=red}、:bg[字]{color=#fde68a}（底色）、:box[字]{color=#94a3b8}（框）；:::tip 换行 内容 换行 :::（tip/note/info/warn/danger/success/important/caution）；$$ 公式 $$；[[toc]] 目录；{indent:2} 开头＝缩进；单独一行 &nbsp;＝空行；<!--pagebreak-->＝分页。',
    '图片影音放 assets/ 文件夹，用相对路径：![说明](assets/图.png)、<img src="assets/图.png" width="320">、<video src="assets/片.mp4" controls></video>、<audio src="assets/声.mp3" data-name="声.mp3" controls></audio>。自己放的文件用一般文件名；16 个十六进制字符的文件名（如 3f9a0c1d2b4e5f60.jpg）归编辑器管，正文没提到就会被清掉。',
    '改完直接保存，网页会在一两秒内自动更新。',
  ].join('\n'),
  en: [
    'project.json fields: format is always "dilin-studio/docs", version is 2, name (document title), paper (paper: a4|b5|a3 plus -portrait|-landscape, or null for no pages; marginsMm top/bottom/left/right in mm; pageNumbers), content (the body as markdown, one array item per line), layers (optional: free-placed items pinned to the page such as text boxes, see FORMAT.md).',
    'Body syntax: # to #### headings, **bold**, *italic*, ~~strike~~, `code`, - lists, 1. numbered, > quote, --- rule, | tables |, ```code blocks```, ```mermaid diagrams.',
    'Extensions: :color[text]{color=red}, :bg[text]{color=#fde68a} (highlight), :box[text]{color=#94a3b8} (outline); :::tip newline body newline ::: (tip/note/info/warn/danger/success/important/caution); $$ formula $$; [[toc]] table of contents; leading {indent:2} indents a paragraph; a line with only &nbsp; is an empty line; <!--pagebreak--> starts a new page.',
    'Images, video and audio go in the assets/ folder and are referenced relatively: ![caption](assets/pic.png), <img src="assets/pic.png" width="320">, <video src="assets/clip.mp4" controls></video>, <audio src="assets/sound.mp3" data-name="sound.mp3" controls></audio>. Give files you add a normal name: names of 16 hex characters (e.g. 3f9a0c1d2b4e5f60.jpg) belong to the editor and are deleted once the body no longer mentions them.',
    'Save the file and the page updates itself within a second or two.',
  ].join('\n'),
}

export const docsFormat: StudioFormat<DocsDoc> = {
  version: DOCS_FORMAT_VERSION,
  emptyProject: emptyDocsDoc,
  async load(store: ProjectStore): Promise<DocsDoc> {
    const j = await readProjectJson(store, 'docs', DOCS_FORMAT_VERSION)
    return j ? docsDocFromJson(j) : emptyDocsDoc()
  },
  async save(store: ProjectStore, doc: DocsDoc): Promise<void> {
    await writeProjectJson(store, 'docs', DOCS_FORMAT_VERSION, docsDocToJson(doc))
  },
  summaryForAI(lang: StudioLang): string {
    return SUMMARY[lang] ?? SUMMARY.en
  },
}

/** Save as the editor does: autosave (default) leaves project.json alone when it changed outside since this
 *  session last read or wrote it (the shell then asks the user); force = an explicit save / the shell's flush. */
export function saveDocs(store: ProjectStore, doc: DocsDoc, o?: { force?: boolean }): Promise<SafeWriteResult> {
  return saveProjectSafe(store, s => docsFormat.save(s, doc), o)
}
