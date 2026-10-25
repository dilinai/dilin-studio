/**
 * slide-kit · 组件化 · 14 个版式的「组件蓝图」
 *
 * 旧版式（layouts/*.tsx）用 flex 排版·没有绝对坐标；这里把每个版式改写成「一页 = 一组带框的组件」：
 *   - 框的位置按旧版式的 CSS（padding／gap／flex-basis／居中）逐项算出·文字行数一律用近似字宽表估
 *     （approxLinesNeeded·服务端＝浏览器同一个结果·同一页没物化前每次派生出的框都一样）；
 *   - 颜色、字体存主题记号（theme:text／theme:heading…）⇒ 换模板时自动跟着换；
 *   - 组件编号＝`<页键>.<版式内键>`（页键＝pid·老页没 pid 时＝`i<页序>`）。
 * 视觉出处同旧版式：adapted from presenton (Apache-2.0)·版式改造见 layouts/*.tsx 档头。
 * 验收：旧版式 vs 本蓝图逐版式 × 36 套模板实渲比对（core/lib/slide-kit/preview/components-parity.mjs）。
 */

import { approxLinesNeeded } from '../engine/fit-text'
import type { LayoutLocale, PageDraft, SlotImageValue } from '../types'
import { CANVAS_HEIGHT as H, CANVAS_WIDTH as W, imageSlotKey, resolveSlotImage } from '../types'
import { chromeText, pad2 } from '../layouts/shared'
import { contentOrbitBlueprint, contentOrbitDualBlueprint, contentOrbitLoopBlueprint, contentOrbitSideBlueprint } from './blueprints-orbit'
import { MOSAIC_FULL_BLUEPRINTS } from './blueprints-mosaic-full'
import type {
  ColorValue,
  ComponentRole,
  Frame,
  ImageComponent,
  ShapeComponent,
  SlideComponent,
  TextAlign,
  TextBox,
  TextComponent,
  VAlign,
} from './types'
import { WAIST_FAN_BLUEPRINTS } from './blueprints-waist-fan'

/** CSS line-height: normal 的近似（Noto Sans／Serif TC 的 ascent+descent ≈ 1.448em） */
export const NORMAL_LH = 1.45

export type BlueprintInput = {
  /** 页键（pid 或 i<页序>）·组件编号前缀 */
  pageKey: string
  draft: PageDraft
  images?: Record<string, SlotImageValue>
  locale?: LayoutLocale
}

type Blueprint = (input: BlueprintInput) => SlideComponent[]

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const r1 = (n: number) => Math.round(n * 100) / 100

function frame(x: number, y: number, w: number, h: number): Frame {
  return { x: r1(x), y: r1(y), w: r1(Math.max(1, w)), h: r1(Math.max(1, h)), rotate: 0 }
}

/** 估行数（空字＝0 行·有字至少 1 行·封顶 clamp）·有字距时按「每字多占 ls」把可用宽折算回去 */
function lines(text: string | undefined, size: number, width: number, clamp: number, letterSpacing = 0): number {
  if (!text) return 0
  const w = letterSpacing > 0 ? (width * size) / (size + letterSpacing) : width
  return Math.max(1, Math.min(clamp, approxLinesNeeded(text, size, w)))
}

/** 文字块高 */
function blockH(text: string | undefined, size: number, lh: number, width: number, clamp: number, letterSpacing = 0): number {
  return lines(text, size, width, clamp, letterSpacing) * size * lh
}

type TextOpts = {
  font?: 'theme:heading' | 'theme:body'
  size: number
  color?: ColorValue
  bold?: boolean
  lineHeight: number
  letterSpacing?: number
  align?: TextAlign
  valign?: VAlign
  maxLines?: number
}

function text(id: string, role: ComponentRole, f: Frame, content: string, o: TextOpts, roleIndex?: number): TextComponent {
  const box: TextBox = {
    font: o.font ?? 'theme:body',
    size: o.size,
    color: o.color ?? 'theme:text',
    ...(o.bold ? { bold: true } : {}),
    align: o.align ?? 'left',
    valign: o.valign ?? 'top',
    lineHeight: o.lineHeight,
    ...(o.letterSpacing ? { letterSpacing: o.letterSpacing } : {}),
    padding: 0,
    clamp: true,
    ...(o.maxLines ? { maxLines: o.maxLines } : {}),
  }
  return {
    id, type: 'text', role, ...(roleIndex !== undefined ? { roleIndex } : {}), frame: f,
    paragraphs: [{ runs: content ? [{ text: content }] : [] }],
    box,
  }
}

/** 标题字（heading 字体·700·行高 1.3·主文字色） */
const heading = (size: number, maxLines: number, extra: Partial<TextOpts> = {}): TextOpts =>
  ({ font: 'theme:heading', size, bold: true, lineHeight: 1.3, color: 'theme:text', maxLines, ...extra })
/** 正文字（行高 1.6·次文字色） */
const body = (size: number, maxLines: number, extra: Partial<TextOpts> = {}): TextOpts =>
  ({ size, lineHeight: 1.6, color: 'theme:muted', maxLines, ...extra })

function dot(id: string, x: number, y: number, size: number, opacity?: number): ShapeComponent {
  return {
    id, type: 'shape', role: 'decor', frame: frame(x, y, size, size), shape: 'ellipse',
    fill: 'theme:accent', stroke: null, ...(opacity !== undefined ? { opacity } : {}),
  }
}

function ring(id: string, x: number, y: number, size: number, width: number): ShapeComponent {
  return {
    id, type: 'shape', role: 'decor', frame: frame(x, y, size, size), shape: 'ellipse',
    fill: null, stroke: { color: 'theme:border', width },
  }
}

/** 编号圆章（NumberBadge：圆角＝边长×0.28·accent 底·onAccent 字·700·行高 1） */
function badge(id: string, role: ComponentRole, x: number, y: number, size: number, label: string, fontSize: number, roleIndex?: number): ShapeComponent {
  return {
    id, type: 'shape', role, ...(roleIndex !== undefined ? { roleIndex } : {}), frame: frame(x, y, size, size),
    shape: 'roundRect', radius: r1(size * 0.28), fill: 'theme:accent', stroke: null,
    text: {
      paragraphs: [{ runs: [{ text: label }] }],
      box: { font: 'theme:body', size: r1(fontSize), color: 'theme:onAccent', bold: true, align: 'center', valign: 'middle', lineHeight: 1, padding: 0 },
    },
  }
}

function figure(id: string, role: ComponentRole, f: Frame, v: SlotImageValue | undefined, radius: number, roleIndex?: number): ImageComponent {
  const img = resolveSlotImage(v)
  return {
    id, type: 'image', role, ...(roleIndex !== undefined ? { roleIndex } : {}), frame: f,
    src: img.url ?? '', ...(img.crop ? { crop: img.crop } : {}), fit: 'cover', radius,
  }
}

/** 页标题行（content 版式共用 TitleRow：Dot 12 在 paddingTop 14 处·gap 14·h2 32 clamp2） */
function titleRow(k: (s: string) => string, x: number, y: number, width: number, title: string): { comps: SlideComponent[]; h: number } {
  const tW = width - 26
  const tH = blockH(title, 32, 1.3, tW, 2)
  return {
    comps: [dot(k('dot'), x, y + 14, 12), text(k('title'), 'title', frame(x + 26, y, tW, tH || 41.6), title, heading(32, 2))],
    h: Math.max(26, tH),
  }
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')

/* ------------------------------------------------------------------ */
/* 封面 ×3                                                             */
/* ------------------------------------------------------------------ */

const coverSplit: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const title = draft.type === 'cover' ? textOf(draft.title) : ''
  const subtitle = draft.type === 'cover' ? textOf(draft.subtitle) : ''
  const pad = 64, innerW = W - pad * 2, innerH = H - pad * 2, gap = 56
  const figW = innerW * 0.38
  const leftW = innerW - figW - gap
  const tH = blockH(title, 46, 1.3, leftW, 4)
  const sH = blockH(subtitle, 19, 1.6, leftW, 2)
  const groupH = 12 + 28 + tH + (subtitle ? 22 + sH : 0)
  const top = pad + (innerH - groupH) / 2
  const out: SlideComponent[] = [
    dot(k('dot1'), pad, top, 12), dot(k('dot2'), pad + 24, top, 12), dot(k('dot3'), pad + 48, top, 12),
    text(k('title'), 'title', frame(pad, top + 40, leftW, tH || 59.8), title, heading(46, 4)),
  ]
  if (subtitle) out.push(text(k('subtitle'), 'subtitle', frame(pad, top + 40 + tH + 22, leftW, sH), subtitle, body(19, 2)))
  out.push(figure(k('fig'), 'pageFigure', frame(pad + leftW + gap, pad + 12, figW, innerH - 24), images?.[imageSlotKey('pageFigure')], 20))
  return out
}

const coverStage: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const title = draft.type === 'cover' ? textOf(draft.title) : ''
  const subtitle = draft.type === 'cover' ? textOf(draft.subtitle) : ''
  const out: SlideComponent[] = []
  const bg = resolveSlotImage(images?.background)
  if (bg.url) {
    out.push({ ...figure(k('bg'), 'background', frame(0, 0, W, H), images?.background, 0), locked: true })
    out.push({ id: k('mask'), type: 'shape', role: 'backgroundMask', frame: frame(0, 0, W, H), shape: 'rect', fill: 'theme:bg', stroke: null, opacity: 0.82, locked: true })
  } else {
    out.push(dot(k('circle1'), W + 140 - 430, -140, 430, 0.12))
    out.push(dot(k('circle2'), W - 96 - 108, 118, 108, 0.3))
  }
  const x = 80, colW = 720 - 160
  const rowH = Math.max(14, 15 * NORMAL_LH)
  const tH = blockH(title, 54, 1.3, colW, 3)
  const sH = blockH(subtitle, 20, 1.6, colW, 2)
  const groupH = rowH + 30 + tH + (subtitle ? 24 + sH : 0)
  const top = (H - groupH) / 2
  out.push(dot(k('dot'), x, top + (rowH - 14) / 2, 14))
  out.push(text(k('eyebrow'), 'eyebrow', frame(x + 26, top, colW - 26, rowH), 'PRESENTATION', { size: 15, lineHeight: NORMAL_LH, letterSpacing: 6, color: 'theme:muted', valign: 'middle', maxLines: 1 }))
  out.push(text(k('title'), 'title', frame(x, top + rowH + 30, colW, tH || 70.2), title, heading(54, 3)))
  if (subtitle) out.push(text(k('subtitle'), 'subtitle', frame(x, top + rowH + 30 + tH + 24, colW, sH), subtitle, body(20, 2)))
  return out
}

const coverFrame: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const title = draft.type === 'cover' ? textOf(draft.title) : ''
  const subtitle = draft.type === 'cover' ? textOf(draft.subtitle) : ''
  const inset = 26, bw = 1.5
  const areaTop = inset + bw, areaH = H - 2 * inset - 2 * bw
  const tW = 700, sW = 560
  const tH = blockH(title, 44, 1.3, tW, 3)
  const sH = blockH(subtitle, 18, 1.6, sW, 2)
  const groupH = 14 + 30 + tH + (subtitle ? 22 + sH : 0) + 34 + 8
  const top = areaTop + (areaH - groupH) / 2
  const cx = W / 2
  const out: SlideComponent[] = [
    { id: k('frame'), type: 'shape', role: 'decor', frame: frame(inset, inset, W - 2 * inset, H - 2 * inset), shape: 'roundRect', radius: 6, fill: null, stroke: { color: 'theme:border', width: bw } },
    dot(k('dot'), cx - 7, top, 14),
    text(k('title'), 'title', frame(cx - tW / 2, top + 44, tW, tH || 57.2), title, heading(44, 3, { align: 'center' })),
  ]
  if (subtitle) out.push(text(k('subtitle'), 'subtitle', frame(cx - sW / 2, top + 44 + tH + 22, sW, sH), subtitle, body(18, 2, { align: 'center' })))
  const dy = top + groupH - 8
  out.push(dot(k('dot1'), cx - 22, dy, 8), dot(k('dot2'), cx - 4, dy, 8), dot(k('dot3'), cx + 14, dy, 8))
  return out
}

/* ------------------------------------------------------------------ */
/* 目录 ×2                                                             */
/* ------------------------------------------------------------------ */

function contentsItemsOf(draft: PageDraft, cap: number): string[] {
  const raw = draft.type === 'contents' && Array.isArray(draft.items) ? draft.items : []
  return raw.slice(0, cap).map(textOf)
}

const contentsIndex: Blueprint = ({ pageKey, draft, locale }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const items = contentsItemsOf(draft, 10)
  const chrome = chromeText(locale)
  const pad = 64, innerW = W - 2 * pad, innerH = H - 2 * pad, gap = 60
  const leftW = innerW * 0.26
  const rightX = pad + leftW + gap, rightW = innerW - leftW - gap
  const hH = blockH(chrome.contents, 44, 1.3, leftW, 9)
  const groupH = 12 + 20 + hH + 14 + 15 * 1.6
  const top = pad + (innerH - groupH) / 2
  const out: SlideComponent[] = [
    dot(k('dot'), pad, top, 12),
    text(k('contents-title'), 'contentsTitle', frame(pad, top + 32, leftW, hH), chrome.contents, heading(44, 9)),
    text(k('eyebrow'), 'eyebrow', frame(pad, top + 32 + hH + 14, leftW, 24), chrome.contentsEyebrow, body(15, 9)),
  ]
  const half = Math.ceil(items.length / 2)
  const cols = [items.slice(0, half), items.slice(half)].filter((c) => c.length > 0)
  const colW = cols.length === 2 ? (rightW - 48) / 2 : rightW
  cols.forEach((col, ci) => {
    const colX = rightX + ci * (colW + 48)
    const spanW = colW - 38 - 16
    const rows = col.map((it) => {
      const sH = blockH(it, 17, 1.5, spanW, 2)
      return { it, sH, h: Math.max(38, sH) }
    })
    const colH = rows.reduce((a, r) => a + r.h, 0) + 22 * (rows.length - 1)
    let y = pad + (innerH - colH) / 2
    rows.forEach((row, i) => {
      const idx = ci * half + i
      out.push(badge(k(`item${idx}-num`), 'itemNumber', colX, y + (row.h - 38) / 2, 38, pad2(idx), 38 * 0.42, idx))
      out.push(text(k(`item${idx}`), 'contentsItem', frame(colX + 54, y + (row.h - row.sH) / 2, spanW, row.sH || 25.5), row.it, { size: 17, lineHeight: 1.5, color: 'theme:text', maxLines: 2 }, idx))
      y += row.h + 22
    })
  })
  return out
}

const contentsCards: Blueprint = ({ pageKey, draft, locale }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const items = contentsItemsOf(draft, 6)
  const chrome = chromeText(locale)
  const padX = 72, padY = 54, innerW = W - 2 * padX, innerH = H - 2 * padY
  const rowH = 36 * 1.3
  // 标题行：Dot 10 ＋ gap 14 ＋ h2 ＋ gap 14 ＋ Dot 10（整行水平居中·文字框给全宽置中·两颗圆点按估的字宽摆）
  const tw = Math.min(innerW - 48, approxTitleWidth(chrome.contents, 36))
  const cx = W / 2
  const out: SlideComponent[] = [
    dot(k('dot1'), cx - tw / 2 - 14 - 10, padY + (rowH - 10) / 2, 10),
    text(k('contents-title'), 'contentsTitle', frame(padX, padY, innerW, rowH), chrome.contents, heading(36, 1, { align: 'center', valign: 'middle' })),
    dot(k('dot2'), cx + tw / 2 + 14, padY + (rowH - 10) / 2, 10),
  ]
  const perRow = items.length <= 4 ? 2 : 3
  const cellW = (innerW - 20 * (perRow - 1)) / perRow
  const spanW = cellW - 2 - 44 - 36 - 16
  const areaTop = padY + rowH + 36, areaH = innerH - rowH - 36
  const rowsN = Math.ceil(items.length / perRow)
  const rowHeights: number[] = []
  for (let r = 0; r < rowsN; r++) {
    let m = 0
    for (let c = 0; c < perRow; c++) {
      const it = items[r * perRow + c]
      if (it === undefined) continue
      m = Math.max(m, Math.max(36, blockH(it, 16, 1.5, spanW, 2)) + 42)
    }
    rowHeights.push(m)
  }
  const total = rowHeights.reduce((a, b) => a + b, 0) + 20 * Math.max(0, rowsN - 1)
  let y = areaTop + (areaH - total) / 2
  for (let r = 0; r < rowsN; r++) {
    const rh = rowHeights[r]
    for (let c = 0; c < perRow; c++) {
      const i = r * perRow + c
      const it = items[i]
      if (it === undefined) continue
      const x = padX + c * (cellW + 20)
      const inner = rh - 42
      const sH = blockH(it, 16, 1.5, spanW, 2)
      out.push({ id: k(`item${i}-card`), type: 'shape', role: 'card', roleIndex: i, frame: frame(x, y, cellW, rh), shape: 'roundRect', radius: 14, fill: 'theme:surface', stroke: { color: 'theme:border', width: 1 } })
      out.push(badge(k(`item${i}-num`), 'itemNumber', x + 23, y + 21 + (inner - 36) / 2, 36, pad2(i), 36 * 0.42, i))
      out.push(text(k(`item${i}`), 'contentsItem', frame(x + 23 + 36 + 16, y + 21 + (inner - sH) / 2, spanW, sH || 24), it, { size: 16, lineHeight: 1.5, color: 'theme:text', maxLines: 2 }, i))
    }
    y += rh + 20
  }
  return out
}

/** 单行标题字宽（近似表·目录卡片标题两侧圆点定位用） */
function approxTitleWidth(s: string, size: number): number {
  // approxLinesNeeded 只给行数；单行宽直接按近似表累加（与 fit-text 同一张表）
  let em = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x2e80 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x30ff) || (code >= 0xff00 && code <= 0xff60)) em += 1
    else if (ch === ' ') em += 0.3
    else if (/[A-Z]/.test(ch)) em += 0.72
    else em += 0.55
  }
  return em * size
}

/* ------------------------------------------------------------------ */
/* 章节 ×2                                                             */
/* ------------------------------------------------------------------ */

function transitionOf(draft: PageDraft): { title: string; lead: string; partNo: number } {
  if (draft.type !== 'transition') return { title: '', lead: '', partNo: 0 }
  const p = (draft as { partNo?: unknown }).partNo
  return { title: textOf(draft.title), lead: textOf(draft.lead), partNo: typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : 0 }
}

const transitionNumber: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, lead, partNo } = transitionOf(draft)
  const label = String(partNo + 1).padStart(2, '0')
  // 巨号是粗体数字：近似表的数字 0.55em 偏窄（思源黑体粗体量得 0.59em·圆体退字约 0.556em）⇒ 取中 0.575em 排后面的分隔线与文字栏；
  //   字框另留 24px 余量·免得换了字体后数字被折成两行
  const numW = label.length * 0.575 * 170
  const out: SlideComponent[] = [dot(k('circle'), -30, H + 60 - 380, 380, 0.08)]
  out.push(text(k('num'), 'partNumber', frame(80, (H - 170) / 2, numW + 24, 170), label, { font: 'theme:heading', size: 170, bold: true, lineHeight: 1, color: 'theme:accent', valign: 'middle', maxLines: 1 }))
  const divX = 80 + numW + 64
  out.push({ id: k('divider'), type: 'shape', role: 'decor', frame: frame(divX, 150, 2, H - 300), shape: 'rect', fill: 'theme:border', stroke: null })
  const colX = divX + 2 + 64
  const colW = W - 80 - colX
  const rowH = Math.max(10, 14 * NORMAL_LH)
  const tH = blockH(title, 42, 1.3, colW, 2)
  const lW = Math.min(520, colW)
  const lH = blockH(lead, 18, 1.6, lW, 3)
  const groupH = rowH + 18 + tH + (lead ? 18 + lH : 0)
  const top = (H - groupH) / 2
  out.push(dot(k('dot'), colX, top + (rowH - 10) / 2, 10))
  out.push(text(k('eyebrow'), 'eyebrow', frame(colX + 20, top, colW - 20, rowH), 'CHAPTER', { size: 14, lineHeight: NORMAL_LH, letterSpacing: 5, color: 'theme:muted', valign: 'middle', maxLines: 1 }))
  out.push(text(k('title'), 'title', frame(colX, top + rowH + 18, colW, tH || 54.6), title, heading(42, 2)))
  if (lead) out.push(text(k('lead'), 'lead', frame(colX, top + rowH + 18 + tH + 18, lW, lH), lead, body(18, 3)))
  return out
}

const transitionCenter: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, lead, partNo } = transitionOf(draft)
  const label = String(partNo + 1).padStart(2, '0')
  const tW = 680, lW = 560, cx = W / 2
  const tH = blockH(title, 44, 1.3, tW, 2)
  const lH = blockH(lead, 18, 1.6, lW, 2)
  const groupH = 56 + 30 + tH + (lead ? 18 + lH : 0)
  const top = (H - groupH) / 2
  const out: SlideComponent[] = [
    ring(k('ring'), W + 110 - 320, -110, 320, 2),
    badge(k('num'), 'partNumber', cx - 28, top, 56, label, 22),
    text(k('title'), 'title', frame(cx - tW / 2, top + 86, tW, tH || 57.2), title, heading(44, 2, { align: 'center' })),
  ]
  if (lead) out.push(text(k('lead'), 'lead', frame(cx - lW / 2, top + 86 + tH + 18, lW, lH), lead, body(18, 2, { align: 'center' })))
  return out
}

/* ------------------------------------------------------------------ */
/* 内容 ×5                                                             */
/* ------------------------------------------------------------------ */

type Item = { heading?: string; body: string }
function contentOf(draft: PageDraft, cap: number): { title: string; items: Item[] } {
  if (draft.type !== 'content') return { title: '', items: [] }
  const raw = Array.isArray(draft.items) ? draft.items : []
  return {
    title: textOf(draft.title),
    items: raw.slice(0, cap).map((it) => {
      const h = (it as { heading?: unknown } | null)?.heading
      const b = textOf((it as { body?: unknown } | null)?.body)
      return typeof h === 'string' ? { heading: h, body: b } : { body: b }
    }),
  }
}

const PADX = 64, PADY = 52

const contentSplit: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 2)
  const innerW = W - 2 * PADX, innerH = H - 2 * PADY
  const tr = titleRow(k, PADX, PADY, innerW, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = PADY + tr.h + 32, areaH = innerH - tr.h - 32
  const figW = innerW * 0.4, leftW = innerW - figW - 52
  const blocks = items.map((it) => {
    const headH = it.heading ? Math.max(8, 19 * NORMAL_LH) : 0
    const bH = blockH(it.body, 16, 1.6, leftW, 4)
    return { it, headH, bH, h: (it.heading ? headH + 10 : 0) + bH }
  })
  const total = blocks.reduce((a, b) => a + b.h, 0) + 30 * Math.max(0, blocks.length - 1)
  let y = areaTop + (areaH - total) / 2
  blocks.forEach((b, i) => {
    if (b.it.heading) {
      out.push(dot(k(`item${i}-dot`), PADX, y + (b.headH - 8) / 2, 8))
      out.push(text(k(`item${i}-head`), 'item', frame(PADX + 18, y, leftW - 18, b.headH), b.it.heading, { size: 19, bold: true, lineHeight: NORMAL_LH, color: 'theme:text', maxLines: 1 }, i))
      y += b.headH + 10
    }
    out.push(text(k(`item${i}-body`), 'item', frame(PADX, y, leftW, b.bH || 25.6), b.it.body, body(16, 4), i))
    y += b.bH + 30
  })
  out.push(figure(k('fig'), 'pageFigure', frame(PADX + leftW + 52, areaTop, figW, areaH), images?.[imageSlotKey('pageFigure')], 18))
  return out
}

const contentCards: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 4)
  const innerW = W - 2 * PADX, innerH = H - 2 * PADY
  const tr = titleRow(k, PADX, PADY, innerW, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = PADY + tr.h + 34, areaH = innerH - tr.h - 34
  const n = items.length
  if (n === 0) return out
  const cardW = (innerW - 22 * (n - 1)) / n
  const tw = cardW - 2 - 48
  items.forEach((it, i) => {
    const x = PADX + i * (cardW + 22)
    out.push({ id: k(`item${i}-card`), type: 'shape', role: 'card', roleIndex: i, frame: frame(x, areaTop, cardW, areaH), shape: 'roundRect', radius: 16, fill: 'theme:surface', stroke: { color: 'theme:border', width: 1 } })
    let y = areaTop + 1 + 26
    out.push(badge(k(`item${i}-num`), 'itemNumber', x + 25, y, 40, pad2(i), 40 * 0.42, i))
    y += 40
    if (it.heading) {
      const hH = blockH(it.heading, 18, NORMAL_LH, tw, 2)
      out.push(text(k(`item${i}-head`), 'item', frame(x + 25, y + 18, tw, hH), it.heading, { size: 18, bold: true, lineHeight: NORMAL_LH, color: 'theme:text', maxLines: 2 }, i))
      y += 18 + hH
    }
    const bH = blockH(it.body, 14.5, 1.6, tw, 6)
    out.push(text(k(`item${i}-body`), 'item', frame(x + 25, y + 12, tw, bH || 23.2), it.body, body(14.5, 6), i))
  })
  return out
}

const contentGrid: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 4)
  const innerW = W - 2 * PADX, innerH = H - 2 * PADY
  const tr = titleRow(k, PADX, PADY, innerW, title)
  const out: SlideComponent[] = [...tr.comps]
  const areaTop = PADY + tr.h + 30, areaH = innerH - tr.h - 30
  const colW = (innerW - 44) / 2
  const tw = colW - 36 - 16
  const cells = items.map((it) => {
    const hH = it.heading ? 17 * NORMAL_LH : 0
    const bH = blockH(it.body, 14.5, 1.6, tw, 3)
    return { it, hH, bH, h: Math.max(36, hH + 6 + bH) }
  })
  const rowsN = Math.ceil(cells.length / 2)
  const rowHeights: number[] = []
  for (let r = 0; r < rowsN; r++) rowHeights.push(Math.max(cells[2 * r]?.h ?? 0, cells[2 * r + 1]?.h ?? 0))
  const total = rowHeights.reduce((a, b) => a + b, 0) + 22 * Math.max(0, rowsN - 1)
  let y = areaTop + (areaH - total) / 2
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < 2; c++) {
      const i = 2 * r + c
      const cell = cells[i]
      if (!cell) continue
      const x = PADX + c * (colW + 44)
      out.push(badge(k(`item${i}-num`), 'itemNumber', x, y, 36, pad2(i), 36 * 0.42, i))
      if (cell.it.heading) out.push(text(k(`item${i}-head`), 'item', frame(x + 52, y, tw, cell.hH), cell.it.heading, { size: 17, bold: true, lineHeight: NORMAL_LH, color: 'theme:text', maxLines: 1 }, i))
      out.push(text(k(`item${i}-body`), 'item', frame(x + 52, y + cell.hH + 6, tw, cell.bH || 23.2), cell.it.body, body(14.5, 3), i))
    }
    y += rowHeights[r] + 22
  }
  return out
}

const contentList: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 4)
  const padY = 56, innerW = W - 2 * PADX, innerH = H - 2 * padY
  const leftW = innerW * 0.3
  const tH = blockH(title, 30, 1.3, leftW, 6)
  const groupH = 12 + 18 + tH
  const top = padY + (innerH - groupH) / 2
  const out: SlideComponent[] = [
    dot(k('dot'), PADX, top, 12),
    text(k('title'), 'title', frame(PADX, top + 30, leftW, tH || 39), title, heading(30, 6)),
  ]
  const rx = PADX + leftW + 56, rw = innerW - leftW - 56
  const tw = rw - 38 - 18
  const rows = items.map((it, i) => {
    const hH = it.heading ? 17 * NORMAL_LH : 0
    const bH = blockH(it.body, 14.5, 1.6, tw, 2)
    const inner = Math.max(38, hH + 5 + bH)
    return { it, hH, bH, border: i === 0 ? 0 : 1, h: inner + 36 + (i === 0 ? 0 : 1) }
  })
  const total = rows.reduce((a, r) => a + r.h, 0)
  let y = padY + (innerH - total) / 2
  rows.forEach((row, i) => {
    if (row.border) out.push({ id: k(`item${i}-rule`), type: 'shape', role: 'decor', frame: frame(rx, y, rw, 1), shape: 'rect', fill: 'theme:border', stroke: null })
    const cy = y + row.border + 18
    out.push(badge(k(`item${i}-num`), 'itemNumber', rx, cy, 38, pad2(i), 38 * 0.42, i))
    if (row.it.heading) out.push(text(k(`item${i}-head`), 'item', frame(rx + 56, cy, tw, row.hH), row.it.heading, { size: 17, bold: true, lineHeight: NORMAL_LH, color: 'theme:text', maxLines: 1 }, i))
    out.push(text(k(`item${i}-body`), 'item', frame(rx + 56, cy + row.hH + 5, tw, row.bH || 23.2), row.it.body, body(14.5, 2), i))
    y += row.h
  })
  return out
}

const contentFocus: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 1)
  const it = items[0]
  const padY = 60, innerW = W - 2 * PADX, innerH = H - 2 * padY
  const figW = innerW * 0.36, leftW = innerW - figW - 56
  const spanW = leftW - 22
  const sH = blockH(title, 16, 1.5, spanW, 2, 2)
  const rowH = Math.max(15, sH)
  const hH = it?.heading ? blockH(it.heading, 34, 1.3, leftW, 3) : 0
  const bH = it ? blockH(it.body, 17, 1.6, leftW, 6) : 0
  const groupH = rowH + (it?.heading ? 24 + hH : 0) + (it ? 20 + bH : 0)
  const top = padY + (innerH - groupH) / 2
  const out: SlideComponent[] = [
    dot(k('dot'), PADX, top + 5, 10),
    text(k('title'), 'title', frame(PADX + 22, top, spanW, sH || 24), title, { size: 16, bold: true, lineHeight: 1.5, letterSpacing: 2, color: 'theme:accent', maxLines: 2 }),
  ]
  let y = top + rowH
  if (it?.heading) {
    out.push(text(k('item0-head'), 'item', frame(PADX, y + 24, leftW, hH), it.heading, heading(34, 3), 0))
    y += 24 + hH
  }
  if (it) out.push(text(k('item0-body'), 'item', frame(PADX, y + 20, leftW, bH || 27.2), it.body, body(17, 6), 0))
  out.push(figure(k('fig'), 'pageFigure', frame(PADX + leftW + 56, padY + 8, figW, innerH - 16), images?.[imageSlotKey('pageFigure')], 18))
  return out
}

/* ------------------------------------------------------------------ */
/* 结尾 ×2                                                             */
/* ------------------------------------------------------------------ */

function endOf(draft: PageDraft, locale?: LayoutLocale): { title: string; subtitle: string } {
  const d = draft.type === 'end' ? draft : undefined
  return { title: textOf(d?.title) || chromeText(locale).thanks, subtitle: textOf(d?.subtitle) }
}

const endCenter: Blueprint = ({ pageKey, draft, locale }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, subtitle } = endOf(draft, locale)
  const tW = 720, sW = 560, cx = W / 2
  const tH = blockH(title, 54, 1.3, tW, 2)
  const sH = blockH(subtitle, 18, 1.6, sW, 2)
  const groupH = 10 + 30 + tH + (subtitle ? 22 + sH : 0)
  const top = (H - groupH) / 2
  const out: SlideComponent[] = [
    dot(k('circle'), -130, -130, 380, 0.1),
    ring(k('ring'), W + 90 - 300, H + 120 - 300, 300, 2),
    dot(k('dot1'), cx - 27, top, 10), dot(k('dot2'), cx - 5, top, 10), dot(k('dot3'), cx + 17, top, 10),
    text(k('title'), 'title', frame(cx - tW / 2, top + 40, tW, tH), title, heading(54, 2, { align: 'center' })),
  ]
  if (subtitle) out.push(text(k('subtitle'), 'subtitle', frame(cx - sW / 2, top + 40 + tH + 22, sW, sH), subtitle, body(18, 2, { align: 'center' })))
  return out
}

const endFrame: Blueprint = ({ pageKey, draft, locale }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, subtitle } = endOf(draft, locale)
  const inset = 26, bw = 1.5
  const areaTop = inset + bw, areaH = H - 2 * inset - 2 * bw
  const tW = 680, sW = 540, cx = W / 2
  const tH = blockH(title, 48, 1.3, tW, 2)
  const sH = blockH(subtitle, 17, 1.6, sW, 2)
  const groupH = 14 + 28 + tH + (subtitle ? 20 + sH : 0)
  const top = areaTop + (areaH - groupH) / 2
  const out: SlideComponent[] = [
    { id: k('frame'), type: 'shape', role: 'decor', frame: frame(inset, inset, W - 2 * inset, H - 2 * inset), shape: 'roundRect', radius: 6, fill: null, stroke: { color: 'theme:border', width: bw } },
    dot(k('dot'), cx - 7, top, 14),
    text(k('title'), 'title', frame(cx - tW / 2, top + 42, tW, tH), title, heading(48, 2, { align: 'center' })),
  ]
  if (subtitle) out.push(text(k('subtitle'), 'subtitle', frame(cx - sW / 2, top + 42 + tH + 20, sW, sH), subtitle, body(17, 2, { align: 'center' })))
  return out
}

/* ------------------------------------------------------------------ */
/* 空白页（只手动选·pickLayout 不挑它）                                  */
/* ------------------------------------------------------------------ */

const blank: Blueprint = () => []

/* ------------------------------------------------------------------ */

export const BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  'cover-split': coverSplit,
  'cover-stage': coverStage,
  'cover-frame': coverFrame,
  'contents-index': contentsIndex,
  'contents-cards': contentsCards,
  'transition-number': transitionNumber,
  'transition-center': transitionCenter,
  'content-split': contentSplit,
  'content-cards': contentCards,
  'content-grid': contentGrid,
  'content-list': contentList,
  'content-focus': contentFocus,
  'end-center': endCenter,
  'end-frame': endFrame,
  // 新增内容版式（蓝图本体在 blueprints-waist-fan.ts）
  'content-waist': WAIST_FAN_BLUEPRINTS['content-waist'],
  'content-waist-duo': WAIST_FAN_BLUEPRINTS['content-waist-duo'],
  'content-fan': WAIST_FAN_BLUEPRINTS['content-fan'],
  'content-beam': WAIST_FAN_BLUEPRINTS['content-beam'],
  'content-split-steps': WAIST_FAN_BLUEPRINTS['content-split-steps'],
  'content-split-duo': WAIST_FAN_BLUEPRINTS['content-split-duo'],
  'content-orbit': contentOrbitBlueprint,
  'content-orbit-loop': contentOrbitLoopBlueprint,
  'content-orbit-side': contentOrbitSideBlueprint,
  'content-orbit-dual': contentOrbitDualBlueprint,
  // 新增版式（蓝图在 blueprints-mosaic-full.ts）
  'content-mosaic': MOSAIC_FULL_BLUEPRINTS['content-mosaic'],
  'content-cards-flow': MOSAIC_FULL_BLUEPRINTS['content-cards-flow'],
  'content-fullbleed-glass': MOSAIC_FULL_BLUEPRINTS['content-fullbleed-glass'],
  'content-fullbleed-quote': MOSAIC_FULL_BLUEPRINTS['content-fullbleed-quote'],
  'content-fullbleed-cols': MOSAIC_FULL_BLUEPRINTS['content-fullbleed-cols'],
  blank,
}

/** 版式 id ⇒ 组件（未知版式 ⇒ null·调用方走中性占位） */
export function blueprintComponents(layoutId: string, input: BlueprintInput): SlideComponent[] | null {
  const bp = BLUEPRINTS[layoutId]
  return bp ? bp(input) : null
}
