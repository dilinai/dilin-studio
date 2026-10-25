/**
 * 云文档图层组件·编辑器／只读页共用的纯函数
 *
 * 资料契约在 ./types（⛔ 这里改形状）；这里只放「画到屏幕上」与「跟正文互转」要用的换算：
 * · 坐标：毫米 ↔ 屏幕 px（CSS_PX_PER_MM × 缩放）；第 n 页的纸张左上角离纸叠顶端几 px（页高＋页缝）；屏幕一点落在第几页、离该页左上角几毫米。
 * · 组件编辑：套框（FrameLayer onFrames）、切上下层（plane）、锁定、删除、改内容——一律回新阵列（层次＝阵列顺序不动）。
 * · 正文互转：正文里的图片／视频／音频／档案卡节点 ⇄ 自由组件；文字方块改回正文＝段落。
 * · 存档：编辑器 PUT 请求体要不要带 layers（只在本地改过时带·免得盖掉角色那侧刚改的）。
 * · 档案卡读权：自由摆放的档案卡也算「这篇文档挂着的档」（分享页访客下载同一道闸）。
 * 纯函数·零 DOM ⇒ 编辑器、只读页、服务端、单测共用一份。
 */

import type { Frame, ZMove } from '../../../shared/frame-kit/types'
import { normalizeAngle } from '../../../shared/frame-kit/transform'
import { CSS_PX_PER_MM, PAGE_GAP_PX, PAGE_MARGIN_MM } from '../paper-size'
import { normalizeFileCardId, serializeFileCardLine } from '../file-card'
import {
  DOC_LAYER_LIMITS, moveDocLayersZ, newDocLayerId, sanitizeDocLayer, sanitizeDocLayers,
  type DocLayerItem, type DocLayerPlane, type DocLayers, type DocTextBox,
} from './types'

// ── 坐标 ─────────────────────────────────────────────────────────────

/** 毫米 → 屏幕 px（zoom＝画面缩放·分页视图恒 1） */
export function mmToPx(mm: number, zoom = 1): number {
  return mm * CSS_PX_PER_MM * zoom
}

/** 屏幕 px → 毫米 */
export function pxToMm(px: number, zoom = 1): number {
  return px / (CSS_PX_PER_MM * zoom)
}

export type DocLayerGeometry = { pageWmm: number; pageHmm: number; gapPx: number; zoom: number; originX?: number; originY?: number }

export function pagedGeometry(page: { w: number; h: number }, zoom = 1): DocLayerGeometry {
  return { pageWmm: page.w, pageHmm: page.h, gapPx: PAGE_GAP_PX, zoom }
}

/** 连续流（纸张「關閉」）：按 A4 直式的页一页接一页往下算·没有页缝 */
export function continuousGeometry(page: { w: number; h: number }, zoom = 1): DocLayerGeometry {
  // 正文栏左上角＝纸张左上角＋页边距（同导出 Word／PDF 的版心）⇒ 纸张原点在正文栏左上方一个页边距
  return { pageWmm: page.w, pageHmm: page.h, gapPx: 0, zoom, originX: -mmToPx(PAGE_MARGIN_MM.left, zoom), originY: -mmToPx(PAGE_MARGIN_MM.top, zoom) }
}

/** 纸张左缘离宿主左缘几 px */
export function pageLeftPx(g: DocLayerGeometry): number {
  return g.originX ?? 0
}

/** 第 page 页（1 起）纸张左上角离纸叠顶端几 px */
export function pageTopPx(page: number, g: DocLayerGeometry): number {
  return (g.originY ?? 0) + (Math.max(1, Math.floor(page)) - 1) * (mmToPx(g.pageHmm, g.zoom) + g.gapPx)
}

/** 宿主里一点（离宿主左上角 px）落在第几页、离该页纸张左上角几毫米（落在页缝里算上一页的底边） */
export function locateOnPages(xPx: number, yPx: number, g: DocLayerGeometry): { page: number; x: number; y: number } {
  xPx -= g.originX ?? 0
  yPx -= g.originY ?? 0
  const pageH = mmToPx(g.pageHmm, g.zoom)
  const stride = pageH + g.gapPx
  const idx = Math.max(0, Math.floor(Math.max(0, yPx) / stride))
  const inPage = Math.min(pageH, Math.max(0, yPx) - idx * stride)
  return { page: Math.min(DOC_LAYER_LIMITS.pageMax, idx + 1), x: r2(pxToMm(xPx, g.zoom)), y: r2(pxToMm(inPage, g.zoom)) }
}

/** 纸叠要画几页：正文页数与组件最远那页取大（组件钉在第 5 页而正文只有 3 页 ⇒ 画到第 5 页） */
export function sheetCount(contentPages: number, items: readonly DocLayerItem[]): number {
  return Math.max(1, Math.floor(contentPages) || 1, maxLayerPage(items))
}

export function maxLayerPage(items: readonly DocLayerItem[]): number {
  let m = 0
  for (const it of items) if (it.page > m) m = it.page
  return m
}

const r2 = (n: number) => Math.round(n * 100) / 100

// ── 组件编辑（一律回新阵列·顺序＝层次不动） ─────────────────────────────

export function layerItems(layers: DocLayers | null | undefined): DocLayerItem[] {
  return layers?.items ? [...layers.items] : []
}

/** 阵列 ⇒ 存档形状（空＝null·与 sanitizeDocLayers 同口径） */
export function toDocLayers(items: readonly DocLayerItem[]): DocLayers | null {
  return items.length ? { v: 1, unit: 'mm', items: [...items] } : null
}

export function layerFrame(it: DocLayerItem): Frame {
  return { x: it.x, y: it.y, w: it.w, h: it.h, rotate: it.rotate }
}

/** 套一个框的改动（只改给了的栏）·过净化闸收拢（毫米上下限·两位小数·角度进 [0,360)） */
export function patchLayerFrame(it: DocLayerItem, patch: Partial<Frame>): DocLayerItem {
  const next = { ...it, ...patch, rotate: normalizeAngle(patch.rotate ?? it.rotate) }
  return sanitizeDocLayer(next) ?? it
}

export function applyFrameChanges(items: readonly DocLayerItem[], changes: readonly { id: string; frame: Partial<Frame> }[]): DocLayerItem[] {
  const byId = new Map(changes.map(c => [c.id, c.frame]))
  return items.map(it => (byId.has(it.id) ? patchLayerFrame(it, byId.get(it.id)!) : it))
}

/** 切「浮在文字上面／垫在文字底下」 */
export function setLayersPlane(items: readonly DocLayerItem[], ids: readonly string[], plane: DocLayerPlane): DocLayerItem[] {
  const s = new Set(ids)
  return items.map(it => (s.has(it.id) && it.plane !== plane ? { ...it, plane } : it))
}

export function setLayersLocked(items: readonly DocLayerItem[], ids: readonly string[], locked: boolean): DocLayerItem[] {
  const s = new Set(ids)
  return items.map(it => {
    if (!s.has(it.id)) return it
    if (locked) return it.locked ? it : { ...it, locked: true }
    if (!it.locked) return it
    const { locked: _drop, ...rest } = it
    void _drop
    return rest as DocLayerItem
  })
}

export function removeLayers(items: readonly DocLayerItem[], ids: readonly string[]): DocLayerItem[] {
  const s = new Set(ids)
  return items.filter(it => !s.has(it.id))
}

/** 改文字方块的内容／样式（过净化闸） */
export function patchTextBox(items: readonly DocLayerItem[], id: string, patch: Partial<DocTextBox>): DocLayerItem[] {
  return items.map(it => {
    if (it.id !== id || it.kind !== 'text') return it
    return sanitizeDocLayer({ ...it, text: { ...it.text, ...patch } }) ?? it
  })
}

/** 这一页、这一层的组件（保持全局层次顺序） */
export function layersOnPage(items: readonly DocLayerItem[], page: number, plane: DocLayerPlane): DocLayerItem[] {
  return items.filter(it => it.page === page && it.plane === plane)
}

/** 一点（第 page 页·毫米）上最上面那个组件（不计旋转·给「点在字上找底下的组件」用）；没有＝null */
export function topLayerAt(items: readonly DocLayerItem[], page: number, x: number, y: number, plane?: DocLayerPlane): DocLayerItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.page !== page || it.hidden || (plane && it.plane !== plane)) continue
    if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it
  }
  return null
}

/** 文字方块缺省：字号 11.25pt（＝15px·同正文）·内距 2mm */
export const DEFAULT_TEXTBOX_PT = 11.25
export const DEFAULT_TEXTBOX_PADDING_MM = 2

/** 新文字方块：落在该页正中（80×30 mm·收进纸内） */
export function newTextBoxLayer(page: number, paper: { w: number; h: number }, md = ''): DocLayerItem {
  const w = Math.min(80, paper.w), h = Math.min(30, paper.h)
  return sanitizeDocLayer({
    id: newDocLayerId(), kind: 'text', page, plane: 'above', rotate: 0,
    x: r2((paper.w - w) / 2), y: r2((paper.h - h) / 2), w, h,
    text: { md, fontSizePt: DEFAULT_TEXTBOX_PT, align: 'left', valign: 'top', paddingMm: DEFAULT_TEXTBOX_PADDING_MM },
  })!
}

/** 把组件中心挪到 spot（某页某毫米点）并整个夹在纸内；spot 没有 ⇒ 原样 */
export function placeLayerCentered(it: DocLayerItem, spot: { page: number; x: number; y: number } | null, paper: { w: number; h: number }): DocLayerItem {
  if (!spot) return it
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max))
  return { ...it, page: spot.page, x: r2(clamp(spot.x - it.w / 2, paper.w - it.w)), y: r2(clamp(spot.y - it.h / 2, paper.h - it.h)) }
}

// ── 存档 ───────────────────────────────────────────────────────────────

/** 比对用的签名（净化后再序列化·栏位顺序固定） */
export function docLayersKey(v: unknown): string {
  return JSON.stringify(sanitizeDocLayers(v) ?? null)
}

/**
 * 编辑器 PUT 请求体的 layers 那段：extra＝存档队列在「调用那一刻」快照下来的 { layers }（useDocSaveQueue D8）。
 *   本地没改过组件 ⇒ extra 里没有 layers 键 ⇒ 不带（免得拿本页旧那份盖掉角色刚摆好的）；带了就整份替换（null＝清空）。
 */
export function layersPutBody(extra: unknown): { layers?: DocLayers | null } {
  if (!extra || typeof extra !== 'object' || !('layers' in (extra as object))) return {}
  const v = (extra as { layers: unknown }).layers
  return { layers: v == null ? null : sanitizeDocLayers(v) }
}

// ── 正文 ⇄ 自由组件 ─────────────────────────────────────

/** 正文里能改成自由摆放的节点（TipTap 节点名＋attrs） */
export type FlowMediaNode = { type: 'image' | 'videoBlock' | 'audioBlock' | 'fileCard'; attrs: Record<string, unknown> }
export const FLOW_MEDIA_TYPES: readonly FlowMediaNode['type'][] = ['image', 'videoBlock', 'audioBlock', 'fileCard']

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * 正文节点 ⇒ 自由组件（落在 at：第几页＋离该页纸张左上角毫米·大小毫米）；src 不是 http／站内路径（如生成中的占位图）⇒ null（不能搬）。
 */
export function layerFromFlowNode(node: FlowMediaNode, at: { page: number; x: number; y: number; w: number; h: number }, plane: DocLayerPlane = 'above'): DocLayerItem | null {
  const base = { id: newDocLayerId(), page: at.page, x: at.x, y: at.y, w: at.w, h: at.h, rotate: 0, plane }
  const a = node.attrs ?? {}
  switch (node.type) {
    case 'image': return sanitizeDocLayer({ ...base, kind: 'image', src: s(a.src), alt: s(a.alt) || undefined })
    case 'videoBlock': return sanitizeDocLayer({ ...base, kind: 'video', src: s(a.src), poster: s(a.thumbnail) || undefined, name: s(a.name) || undefined })
    case 'audioBlock': return sanitizeDocLayer({ ...base, kind: 'audio', src: s(a.src), name: s(a.name) || undefined })
    case 'fileCard': {
      const fileId = normalizeFileCardId(s(a.fileId))
      if (!fileId) return null
      return sanitizeDocLayer({ ...base, kind: 'file', fileId, name: s(a.name) || undefined, size: typeof a.size === 'number' ? a.size : undefined, mime: s(a.mime) || undefined })
    }
  }
}

/**
 * 自由组件 ⇒ 插回正文的东西：媒体＝对应节点（节点名＋attrs·宽度按组件宽换 px）；文字方块＝markdown 段落（宿主转 HTML 插）。
 */
export function flowFromLayer(it: DocLayerItem): { node: FlowMediaNode } | { md: string } {
  switch (it.kind) {
    case 'image': return { node: { type: 'image', attrs: { src: it.src, alt: it.alt ?? '', width: Math.round(mmToPx(it.w)) } } }
    case 'video': return { node: { type: 'videoBlock', attrs: { src: it.src, displayMode: 'card', name: it.name ?? '', thumbnail: it.poster ?? null } } }
    case 'audio': return { node: { type: 'audioBlock', attrs: { src: it.src, displayMode: 'card', name: it.name ?? '' } } }
    case 'file': return { node: { type: 'fileCard', attrs: { fileId: it.fileId, name: it.name ?? '', size: it.size ?? null, mime: it.mime ?? '' } } }
    case 'text': return { md: it.text.md.trim() ? it.text.md : '' }
  }
}

/** 正文节点在屏幕上的框（px·离纸叠左上角）⇒ 组件落点（第几页＋毫米·大小收进纸内·至少 10mm） */
export function flowRectToLayerAt(rect: { left: number; top: number; width: number; height: number }, g: DocLayerGeometry): { page: number; x: number; y: number; w: number; h: number } {
  const loc = locateOnPages(rect.left, rect.top, g)
  const w = Math.max(10, Math.min(g.pageWmm, r2(pxToMm(rect.width, g.zoom))))
  const h = Math.max(10, Math.min(g.pageHmm, r2(pxToMm(rect.height, g.zoom))))
  return { page: loc.page, x: loc.x, y: loc.y, w, h }
}

// ── 档案卡读权（分享页访客下载） ───────────────────────────────────────

/** 自由摆放的档案卡 ⇒ 正文卡片行（每张一行·给 extractFileCardIds 那道闸当「这篇挂着的档」）；没有＝'' */
export function docLayerFileCardLines(layers: unknown): string {
  const items = sanitizeDocLayers(layers)?.items ?? []
  return items
    .filter((it): it is Extract<DocLayerItem, { kind: 'file' }> => it.kind === 'file')
    .map(it => serializeFileCardLine({ fileId: it.fileId, name: it.name, size: it.size ?? null, mime: it.mime }))
    .join('\n')
}

/**
 * 叠层移动只在「同一页、同一层」里算（右键上移一層／下移一層／移到最頂／移到最底）：别页、别层的组件在阵列里的位置不动。
 *   ⇒ 「上移一層」一定跨过同页同层的下一个（不会白跨一个别页的而画面没变）。
 */
export function moveDocLayersZScoped(items: readonly DocLayerItem[], ids: readonly string[], z: ZMove, scope: (it: DocLayerItem) => boolean): DocLayerItem[] {
  const subset = items.filter(scope)
  const moved = moveDocLayersZ(subset, ids.filter(id => subset.some(it => it.id === id)), z)
  let k = 0
  return items.map(it => (scope(it) ? moved[k++] : it))
}

/**
 * 自由组件里的图／视频／音频（与视频封面）⇒ 账本认得的嵌入语法（`![](url)`／`<video src>`／`<audio src>`·每个一行）；没有＝''。
 *   给「图↔文档」账本（syncDocImageLedger）用：分享页访客签组件里的媒体与签正文里的同一条路（账本仍只收作者自己的、图音视三族的档）。
 */
export function docLayersMediaMarkdown(layers: unknown): string {
  const q = (u: string) => u.replace(/"/g, '%22')
  const out: string[] = []
  for (const it of sanitizeDocLayers(layers)?.items ?? []) {
    if (it.kind === 'image') out.push(`![](${it.src.replace(/[\s)]/g, encodeURIComponent)})`)
    else if (it.kind === 'video') { out.push(`<video src="${q(it.src)}"></video>`); if (it.poster) out.push(`![](${it.poster.replace(/[\s)]/g, encodeURIComponent)})`) }
    else if (it.kind === 'audio') out.push(`<audio src="${q(it.src)}"></audio>`)
  }
  return out.join('\n')
}

/**
 * docs 路由 PUT 的整份组件乐观锁：
 * 编辑器要拿「服务端那份 layers 原样序列化」去算。服务端回的是 jsonb ⇒ 物件键按 Postgres jsonb 的序（先短后长、同长按字节）；
 * 本地刚存成功的那份（还没 GET 回来）用 pgJsonbCanonical 排成同一个序再序列化，两边对得上。
 */
const utf8Len = (x: string) => new TextEncoder().encode(x).length

export function pgJsonbCanonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pgJsonbCanonical)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).filter(k => (v as Record<string, unknown>)[k] !== undefined)
    keys.sort((a, b) => {
      const la = utf8Len(a), lb = utf8Len(b)
      if (la !== lb) return la - lb
      return a < b ? -1 : a > b ? 1 : 0
    })
    const o: Record<string, unknown> = {}
    for (const k of keys) o[k] = pgJsonbCanonical((v as Record<string, unknown>)[k])
    return o
  }
  return v
}

/** 算 base_layers_sha256 的那串：服务端那份 layers（GET 原样／本地存成功的那份）⇒ jsonb 序的 JSON 字串 */
export function serverLayersJson(v: unknown): string {
  return JSON.stringify(pgJsonbCanonical(v ?? null))
}

/**
 * 整份组件 409（角色刚改过组件）时的三方合并：以服务端那份为新基准——
 *   · 角色新加的（服务端有、基准没有）留着；角色删的（基准有、服务端没有）且本页没改过 ⇒ 删；
 *   · 本页新加的（本地有、基准没有）加在最上面；本页删的（基准有、本地没有）从服务端那份删掉；
 *   · 两边都在：本页改过（与基准不同）⇒ 用本页的；没改过 ⇒ 用服务端的。层次以服务端顺序为主。
 */
export function mergeDocLayers(base: readonly DocLayerItem[], local: readonly DocLayerItem[], server: readonly DocLayerItem[]): DocLayerItem[] {
  const B = new Map(base.map(i => [i.id, i])), Lm = new Map(local.map(i => [i.id, i]))
  const same = (a: DocLayerItem, b: DocLayerItem) => JSON.stringify(pgJsonbCanonical(a)) === JSON.stringify(pgJsonbCanonical(b))
  const out: DocLayerItem[] = []
  for (const s of server) {
    const b = B.get(s.id), l = Lm.get(s.id)
    if (b && !l) continue                                   // 本页删了
    if (b && l && !same(b, l)) { out.push(l); continue }    // 本页改了
    out.push(s)
  }
  const inServer = new Set(server.map(i => i.id))
  for (const l of local) if (!B.has(l.id) && !inServer.has(l.id)) out.push(l)   // 本页新加的
  // 角色删了、本页改过的：本页的改动留着（不默默丢用户的手）
  for (const l of local) if (B.has(l.id) && !inServer.has(l.id) && !same(B.get(l.id)!, l)) out.push(l)
  return out
}
