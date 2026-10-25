/**
 * 云文档图层组件——资料契约
 *
 * 一份文档＝markdown 正文（照旧·跟着文字走的图片／视频／音频／档案卡仍在正文里）＋这里的「自由摆放组件」：
 * · 组件钉在纸上：记第几页（page·1 起）、离那一页纸张左上角几毫米（x／y·mm），文字增删它不动（＝Word「固定在页面上」）；
 * · 这一版不做文字环绕：plane='above' 浮在文字上面／'below' 垫在文字底下（右键切换）；
 * · 两种并存：正文里的媒体右键「改成自由摆放」才搬进这里；这里的也能「改回跟着文字走」搬回正文；
 * · 层次＝items 数组顺序（0 最底·后面盖前面·同简报）；右键 上移一層／下移一層／移到最頂／移到最底；⛔ 图层视窗。
 * 单位一律毫米、原点＝那一页纸张左上角（含页边距·不是正文区）；旋转以框中心为轴顺时针·单位度（frame-kit 同口径）。
 * 纸张尺寸见 lib/paper-size（paper_settings·paper=null「關閉」连续流时组件仍按 A4 直式的页来算）。
 * 纯类型＋纯函数·零依赖（除 frame-kit 与 paper-size）⇒ 编辑器／服务端净化闸／角色工具／导出 四方同一份。
 */

import { groupZOrder, normalizeAngle, type ZMove } from '../../../shared/frame-kit'
import { PAPER_MM, splitPaperPref, type DocPaperPref } from '../paper-size'

export const DOC_LAYERS_VERSION = 1

export const DOC_LAYER_KINDS = ['text', 'image', 'video', 'audio', 'file'] as const
export type DocLayerKind = (typeof DOC_LAYER_KINDS)[number]
export type DocLayerPlane = 'above' | 'below'

/** 文字方块：md＝markdown 子集（段落、粗斜、颜色指令、列表）；字号 pt；颜色 '#RRGGBB'；fill 底色（省＝透明）；border 框线色（省＝无） */
export type DocTextBox = { md: string; fontSizePt?: number; color?: string; fill?: string; border?: string; align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom'; paddingMm?: number }

type Base<K extends DocLayerKind> = {
  /** 文档内唯一 */
  id: string
  kind: K
  /** 第几页（1 起） */
  page: number
  /** 离该页纸张左上角（mm） */
  x: number
  y: number
  w: number
  h: number
  /** 度·顺时针·[0,360) */
  rotate: number
  /** 文字之上／之下（缺省 above） */
  plane: DocLayerPlane
  locked?: boolean
  hidden?: boolean
}
export type DocTextLayer = Base<'text'> & { text: DocTextBox }
export type DocImageLayer = Base<'image'> & { src: string; alt?: string }
export type DocVideoLayer = Base<'video'> & { src: string; poster?: string; name?: string }
export type DocAudioLayer = Base<'audio'> & { src: string; name?: string }
/** 档案卡：fileId＝云盘档 id（同正文档案卡 data-file-card）·其余为挂档那刻的快照 */
export type DocFileLayer = Base<'file'> & { fileId: string; name?: string; size?: number; mime?: string }
export type DocLayerItem = DocTextLayer | DocImageLayer | DocVideoLayer | DocAudioLayer | DocFileLayer

export type DocLayers = { v: 1; unit: 'mm'; items: DocLayerItem[] }

export const DOC_LAYER_LIMITS = {
  items: 300,
  pageMax: 2000,
  /** 坐标可部分出纸 */
  posMin: -500,
  posMax: 1000,
  sizeMin: 1,
  sizeMax: 1000,
  textChars: 20000,
  urlChars: 2048,
  nameChars: 200,
  fontSizeMinPt: 4,
  fontSizeMaxPt: 400,
  paddingMaxMm: 50,
} as const

export const DOC_LAYER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:~-]{0,63}$/
const COLOR_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/
// 网址：http(s)、站内 /api/，或游客工程里的素材相对路径 assets/<档名>（档名不含斜线、空白、引号、括号）
const URL_RE = /^(https?:\/\/|\/api\/|assets\/(?!\.\.?$)[^\s/\\"'<>()]+$)/i

export const emptyDocLayers = (): DocLayers => ({ v: 1, unit: 'mm', items: [] })

/** 一页纸张的毫米尺寸（paper=null「關閉」⇒ A4 直式） */
export function pageSizeMm(paper: DocPaperPref | null | undefined): { w: number; h: number } {
  if (!paper) return { w: PAPER_MM.a4.w, h: PAPER_MM.a4.h }
  const { kind, orientation } = splitPaperPref(paper)
  const s = PAPER_MM[kind]
  return orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null)
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)
const url = (v: unknown): string | null => { const s = str(v, DOC_LAYER_LIMITS.urlChars); return s && URL_RE.test(s.trim()) ? s.trim() : null }
const color = (v: unknown): string | undefined => (typeof v === 'string' && COLOR_RE.test(v) ? v.toUpperCase() : undefined)

/** 净化一个组件：认不得／缺必要栏 ⇒ null（整个丢·不整份拒） */
export function sanitizeDocLayer(input: unknown): DocLayerItem | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const L = DOC_LAYER_LIMITS
  if (typeof o.id !== 'string' || !DOC_LAYER_ID_RE.test(o.id)) return null
  if (!DOC_LAYER_KINDS.includes(o.kind as DocLayerKind)) return null
  const page = num(o.page, 1, L.pageMax)
  const x = num(o.x, L.posMin, L.posMax), y = num(o.y, L.posMin, L.posMax)
  const w = num(o.w, L.sizeMin, L.sizeMax), h = num(o.h, L.sizeMin, L.sizeMax)
  if (page === null || x === null || y === null || w === null || h === null) return null
  const base = {
    id: o.id, page: Math.floor(page), x: r2(x), y: r2(y), w: r2(w), h: r2(h),
    rotate: normalizeAngle(typeof o.rotate === 'number' ? o.rotate : 0),
    plane: (o.plane === 'below' ? 'below' : 'above') as DocLayerPlane,
    ...(o.locked === true ? { locked: true } : {}),
    ...(o.hidden === true ? { hidden: true } : {}),
  }
  switch (o.kind as DocLayerKind) {
    case 'text': {
      const t = (o.text && typeof o.text === 'object' ? o.text : {}) as Record<string, unknown>
      const md = typeof t.md === 'string' ? t.md.slice(0, L.textChars) : ''
      const text: DocTextBox = { md }
      const fs = num(t.fontSizePt, L.fontSizeMinPt, L.fontSizeMaxPt); if (fs !== null) text.fontSizePt = r2(fs)
      const c = color(t.color); if (c) text.color = c
      const f = color(t.fill); if (f) text.fill = f
      const b = color(t.border); if (b) text.border = b
      if (t.align === 'left' || t.align === 'center' || t.align === 'right') text.align = t.align
      if (t.valign === 'top' || t.valign === 'middle' || t.valign === 'bottom') text.valign = t.valign
      const p = num(t.paddingMm, 0, L.paddingMaxMm); if (p !== null) text.paddingMm = r2(p)
      return { ...base, kind: 'text', text }
    }
    case 'image': {
      const src = url(o.src); if (!src) return null
      const alt = str(o.alt, L.nameChars)
      return { ...base, kind: 'image', src, ...(alt ? { alt } : {}) }
    }
    case 'video': {
      const src = url(o.src); if (!src) return null
      const poster = url(o.poster), name = str(o.name, L.nameChars)
      return { ...base, kind: 'video', src, ...(poster ? { poster } : {}), ...(name ? { name } : {}) }
    }
    case 'audio': {
      const src = url(o.src); if (!src) return null
      const name = str(o.name, L.nameChars)
      return { ...base, kind: 'audio', src, ...(name ? { name } : {}) }
    }
    case 'file': {
      const fileId = str(o.fileId, 64); if (!fileId || !/^[0-9a-f-]{8,64}$/i.test(fileId)) return null
      const name = str(o.name, L.nameChars), mime = str(o.mime, 200)
      const size = num(o.size, 0, Number.MAX_SAFE_INTEGER)
      return { ...base, kind: 'file', fileId, ...(name ? { name } : {}), ...(size !== null ? { size: Math.floor(size) } : {}), ...(mime ? { mime } : {}) }
    }
  }
}

/** 净化整份：null／空 ⇒ null（＝没有组件·旧文档照旧）；重复 id 后者丢；顺序照留（＝层次）；超上限截断 */
export function sanitizeDocLayers(input: unknown): DocLayers | null {
  if (input == null) return null
  const items = Array.isArray(input) ? input : (typeof input === 'object' && Array.isArray((input as { items?: unknown }).items) ? (input as { items: unknown[] }).items : null)
  if (!items) return null
  const seen = new Set<string>()
  const out: DocLayerItem[] = []
  for (const it of items) {
    if (out.length >= DOC_LAYER_LIMITS.items) break
    const s = sanitizeDocLayer(it)
    if (!s || seen.has(s.id)) continue
    seen.add(s.id); out.push(s)
  }
  return out.length ? { v: 1, unit: 'mm', items: out } : null
}

/** 叠层移动（单个或整组）：数字＝把第一个移到第几位；方向＝整组上移／下移／到顶／到底（frame-kit groupZOrder·彼此先后不变） */
export function moveDocLayersZ(items: readonly DocLayerItem[], ids: readonly string[], z: ZMove): DocLayerItem[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const order = items.map(i => i.id)
  let next: string[]
  if (typeof z === 'number') {
    const id = ids[0]; if (!byId.has(id)) return [...items]
    const rest = order.filter(x => x !== id)
    rest.splice(Math.max(0, Math.min(rest.length, Math.floor(z))), 0, id)
    next = rest
  } else next = groupZOrder(order, new Set(ids), z)
  return next.map(id => byId.get(id)!)
}

/** 新组件 id（c＋10 位） */
export function newDocLayerId(): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'c'
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}
