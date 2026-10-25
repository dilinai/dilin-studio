/**
 * slide-kit · 组件化 · 新增 content 版式 ×5 的组件蓝图
 *
 * 版式（参考常见商务 PPT 构图·坐标自算）——
 *   content-mosaic          卡片·中心大卡（总分 1 带 6–8）：中间大卡＝图＋总述（items[0]）·四周小卡＝数据卡（小标题放大当数字＋图标）
 *   content-cards-flow      卡片·箭头串联（递进 4 段）：等宽卡＋底部一根贯穿箭头＋节点序号·末卡强调色实底
 *   content-fullbleed-glass 全图·毛玻璃（一段话）：满版图＋毛玻璃卡（backdropBlur 一层＋半透明染色一层）
 *   content-fullbleed-quote 全图·一句话：满版图＋半透明遮罩＋错落大字（标题拆 2–5 个字框·标题字体）
 *   content-fullbleed-cols  全图·三栏（并列）：满版图上方留天空（标题衬底）·下方 3 张半透明卡并列
 * 颜色字体只用 theme:* 记号（37 套主题自动吃到）；没给图时满版图版式走主题色回退底（渐层＋圆形母题）。
 * React 版式（layouts/content-mosaic-full.tsx）按本档同一份组件清单画·两边同一套坐标。
 */

import { approxLinesNeeded, approxTextWidth } from '../engine/fit-text'
import type { PageDraft, SlotImageValue } from '../types'
import { CANVAS_HEIGHT as H, CANVAS_WIDTH as W, imageSlotKey, resolveSlotImage } from '../types'
import { pad2 } from '../layouts/shared'
import type { BlueprintInput } from './blueprints'
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
} from './types'

type Blueprint = (input: BlueprintInput) => SlideComponent[]

/* ------------------------------------------------------------------ */
/* 小工具（与 blueprints.ts 同口径·各自私有、互不牵动）              */
/* ------------------------------------------------------------------ */

const NORMAL_LH = 1.45
const PADX = 64, PADY = 52
const r1 = (n: number) => Math.round(n * 100) / 100

function frame(x: number, y: number, w: number, h: number): Frame {
  return { x: r1(x), y: r1(y), w: r1(Math.max(1, w)), h: r1(Math.max(1, h)), rotate: 0 }
}

function lines(text: string | undefined, size: number, width: number, clamp: number, letterSpacing = 0): number {
  if (!text) return 0
  const w = letterSpacing > 0 ? (width * size) / (size + letterSpacing) : width
  return Math.max(1, Math.min(clamp, approxLinesNeeded(text, size, w)))
}

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
  maxLines?: number
}

function text(id: string, role: ComponentRole, f: Frame, content: string, o: TextOpts, roleIndex?: number): TextComponent {
  const box: TextBox = {
    font: o.font ?? 'theme:body',
    size: o.size,
    color: o.color ?? 'theme:text',
    ...(o.bold ? { bold: true } : {}),
    align: o.align ?? 'left',
    valign: 'top',
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

const headingOpts = (size: number, maxLines: number, extra: Partial<TextOpts> = {}): TextOpts =>
  ({ font: 'theme:heading', size, bold: true, lineHeight: 1.3, color: 'theme:text', maxLines, ...extra })
const bodyOpts = (size: number, maxLines: number, extra: Partial<TextOpts> = {}): TextOpts =>
  ({ size, lineHeight: 1.6, color: 'theme:muted', maxLines, ...extra })

function dot(id: string, x: number, y: number, size: number, opacity?: number): ShapeComponent {
  return {
    id, type: 'shape', role: 'decor', frame: frame(x, y, size, size), shape: 'ellipse',
    fill: 'theme:accent', stroke: null, ...(opacity !== undefined ? { opacity } : {}),
  }
}

function badge(id: string, x: number, y: number, size: number, label: string, roleIndex: number): ShapeComponent {
  return {
    id, type: 'shape', role: 'itemNumber', roleIndex, frame: frame(x, y, size, size),
    shape: 'roundRect', radius: r1(size * 0.28), fill: 'theme:accent', stroke: null,
    text: {
      paragraphs: [{ runs: [{ text: label }] }],
      box: { font: 'theme:body', size: r1(size * 0.42), color: 'theme:onAccent', bold: true, align: 'center', valign: 'middle', lineHeight: 1, padding: 0 },
    },
  }
}

function figure(id: string, role: ComponentRole, f: Frame, v: SlotImageValue | undefined, radius: number): ImageComponent {
  const img = resolveSlotImage(v)
  return { id, type: 'image', role, frame: f, src: img.url ?? '', ...(img.crop ? { crop: img.crop } : {}), fit: 'cover', radius }
}

/** 页标题行（同 content 版式 TitleRow：Dot 12·gap 14·h2 32 clamp2） */
function titleRow(k: (s: string) => string, x: number, y: number, width: number, title: string): { comps: SlideComponent[]; h: number } {
  const tW = width - 26
  const tH = blockH(title, 32, 1.3, tW, 2)
  return {
    comps: [dot(k('dot'), x, y + 14, 12), text(k('title'), 'title', frame(x + 26, y, tW, tH || 41.6), title, headingOpts(32, 2))],
    h: Math.max(26, tH),
  }
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')
type Item = { heading?: string; body: string }

function contentOf(draft: PageDraft, cap: number): { title: string; items: Item[] } {
  if (draft.type !== 'content') return { title: '', items: [] }
  const raw = Array.isArray(draft.items) ? draft.items : []
  return {
    title: textOf(draft.title),
    items: raw.slice(0, cap).map((it) => {
      const h = (it as { heading?: unknown } | null)?.heading
      const b = textOf((it as { body?: unknown } | null)?.body)
      return typeof h === 'string' && h ? { heading: h, body: b } : { body: b }
    }),
  }
}

/**
 * 满版图底：有图＝整页图（role=background·锁住）；没图＝主题色回退（figureBg→bg 渐层＋强调色大圆＋细环）·
 * 回退层全用 theme:* 记号 ⇒ 37 套主题都长得像自家的「色块海报」·不出灰块裂图。
 */
function fullBleedBackground(k: (s: string) => string, images: Record<string, SlotImageValue> | undefined): { comps: SlideComponent[]; hasImage: boolean } {
  const v = images?.[imageSlotKey('background')]
  if (resolveSlotImage(v).url) {
    return { comps: [{ ...figure(k('bg'), 'background', frame(0, 0, W, H), v, 0), locked: true }], hasImage: true }
  }
  return {
    hasImage: false,
    comps: [
      {
        id: k('bg-fill'), type: 'shape', role: 'decor', locked: true, frame: frame(0, 0, W, H), shape: 'rect',
        fill: 'theme:figureBg', stroke: null, fillMode: 'gradient',
        gradient: { angle: 35, stops: [{ pos: 0, color: 'theme:figureBg' }, { pos: 100, color: 'theme:bg' }] },
      },
      { ...dot(k('bg-circle1'), W - 430, -170, 600, 0.18), locked: true },
      { ...dot(k('bg-circle2'), -150, H - 210, 400, 0.1), locked: true },
      {
        id: k('bg-ring'), type: 'shape', role: 'decor', locked: true, frame: frame(W - 300, H - 250, 330, 330), shape: 'ellipse',
        fill: null, stroke: { color: 'theme:accent', width: 2 }, opacity: 0.35,
      },
    ],
  }
}

/** 毛玻璃卡：模糊层（只 backdropBlur·不带透明度——透明度会让模糊只看得到自己）＋染色层（theme:bg 半透明） */
function glassCard(k: (s: string) => string, key: string, f: Frame, radius: number, tint: number, blur: number, roleIndex?: number): ShapeComponent[] {
  return [
    { id: k(`${key}-blur`), type: 'shape', role: 'decor', frame: f, shape: 'roundRect', radius, fill: null, stroke: null, backdropBlur: blur },
    {
      id: k(`${key}-card`), type: 'shape', role: 'card', ...(roleIndex !== undefined ? { roleIndex } : {}), frame: f,
      shape: 'roundRect', radius, fill: 'theme:bg', stroke: { color: 'theme:border', width: 1 }, opacity: tint,
    },
  ]
}

/* ------------------------------------------------------------------ */
/* content-mosaic：中心大卡＋四周 6–8 张数据小卡                         */
/*   items[0]＝总述（进中心大卡·图下）·items[1..8]＝小卡（左右各半·纵向均分）  */
/* ------------------------------------------------------------------ */

export const MOSAIC_CAP = 9

export const contentMosaic: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, MOSAIC_CAP)
  const innerW = W - 2 * PADX
  const tr = titleRow(k, PADX, PADY, innerW, title)
  const out: SlideComponent[] = [...tr.comps]
  const top = PADY + tr.h + 24, bottom = H - 40, areaH = bottom - top
  const cW = 268, cX = (W - cW) / 2
  // 中心大卡
  out.push({ id: k('lead-card'), type: 'shape', role: 'card', roleIndex: 0, frame: frame(cX, top, cW, areaH), shape: 'roundRect', radius: 18, fill: 'theme:surface', stroke: { color: 'theme:border', width: 1 } })
  const lead = items[0]
  const tw = cW - 28
  const hH = lead?.heading ? blockH(lead.heading, 18, 1.3, tw, 2) : 0
  const bH = lead?.body ? blockH(lead.body, 14, 1.6, tw, 4) : 0
  const leadH = hH + (hH && bH ? 6 : 0) + bH
  const imgH = Math.max(110, areaH - 28 - (leadH ? 14 + leadH : 0))
  out.push(figure(k('fig'), 'pageFigure', frame(cX + 14, top + 14, tw, imgH), images?.[imageSlotKey('pageFigure')], 12))
  let y = top + 14 + imgH + 14
  if (lead?.heading) {
    out.push(text(k('item0-head'), 'item', frame(cX + 14, y, tw, hH), lead.heading, headingOpts(18, 2), 0))
    y += hH + (bH ? 6 : 0)
  }
  if (lead?.body) out.push(text(k('item0-body'), 'item', frame(cX + 14, y, tw, bH), lead.body, bodyOpts(14, 4), 0))
  // 四周小卡
  const rest = items.slice(1)
  const nL = Math.ceil(rest.length / 2)
  const sides: Array<{ x: number; list: Array<{ it: Item; gi: number }> }> = [
    { x: PADX, list: rest.slice(0, nL).map((it, i) => ({ it, gi: i + 1 })) },
    { x: cX + cW + 20, list: rest.slice(nL).map((it, i) => ({ it, gi: nL + i + 1 })) },
  ]
  const sW = cX - 20 - PADX
  for (const side of sides) {
    const n = side.list.length
    if (n === 0) continue
    const ch = (areaH - 12 * (n - 1)) / n
    const baseNum = n <= 2 ? 30 : n === 3 ? 26 : 22
    const numLH = 1.25
    const tx = side.x + 62, ttw = sW - 62 - 14
    side.list.forEach(({ it, gi }, j) => {
      const cy = top + j * (ch + 12)
      // 数字放大：小标题按卡宽收字号（下限 15）·还放不下才折第二行
      const numSize = it.heading ? Math.max(15, Math.min(baseNum, Math.floor(ttw / Math.max(1, approxTextWidth(it.heading, 1) * 1.08)))) : baseNum
      const numLines = it.heading ? lines(it.heading, numSize, ttw, 2) : 0
      out.push({ id: k(`item${gi}-card`), type: 'shape', role: 'card', roleIndex: gi, frame: frame(side.x, cy, sW, ch), shape: 'roundRect', radius: 14, fill: 'theme:surface', stroke: { color: 'theme:border', width: 1 } })
      const numH = numLines * numSize * numLH
      const maxBody = Math.max(1, Math.min(5, Math.floor((ch - 20 - numH - (numH ? 4 : 0)) / (13 * 1.5))))
      const bodyH = blockH(it.body, 13, 1.5, ttw, maxBody)
      const block = numH + (numH && bodyH ? 4 : 0) + bodyH
      const by = cy + (ch - block) / 2
      // 图标（强调色淡圆＋实心点）
      const iy = cy + ch / 2 - 18
      out.push(dot(k(`item${gi}-icon`), side.x + 14, iy, 36, 0.16))
      out.push(dot(k(`item${gi}-icondot`), side.x + 14 + 12, iy + 12, 12))
      let ty = by
      if (it.heading) {
        out.push(text(k(`item${gi}-head`), 'item', frame(tx, ty, ttw, numH), it.heading, { font: 'theme:heading', size: numSize, bold: true, lineHeight: numLH, color: 'theme:accent', maxLines: 2 }, gi))
        ty += numH + (bodyH ? 4 : 0)
      }
      if (it.body) out.push(text(k(`item${gi}-body`), 'item', frame(tx, ty, ttw, bodyH), it.body, { size: 13, lineHeight: 1.5, color: 'theme:muted', maxLines: maxBody }, gi))
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* content-cards-flow：等宽卡＋一根贯穿箭头（节点序号）·末卡强调色实底        */
/* ------------------------------------------------------------------ */

export const contentCardsFlow: Blueprint = ({ pageKey, draft }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 4)
  const innerW = W - 2 * PADX
  const tr = titleRow(k, PADX, PADY, innerW, title)
  const out: SlideComponent[] = [...tr.comps]
  const n = items.length
  if (n === 0) return out
  const areaTop = PADY + tr.h + 30
  const node = 36, laneC = H - 52 - node / 2
  const cardBottom = laneC - node / 2 - 22
  const cardH = cardBottom - areaTop
  const gap = 24
  const cardW = (innerW - gap * (n - 1)) / n
  // 贯穿箭头（在节点底下·节点盖在线上）
  out.push({ id: k('flow-arrow'), type: 'shape', role: 'decor', frame: frame(PADX - 4, laneC - 8, innerW + 8, 16), shape: 'line', fill: null, stroke: { color: 'theme:accent', width: 2.5 }, lineEnds: { end: 'arrow' } })
  const pad = 24, tw = cardW - 2 * pad
  items.forEach((it, i) => {
    const x = PADX + i * (cardW + gap)
    const last = n >= 2 && i === n - 1
    out.push({
      id: k(`item${i}-card`), type: 'shape', role: 'card', roleIndex: i, frame: frame(x, areaTop, cardW, cardH), shape: 'roundRect', radius: 16,
      fill: last ? 'theme:accent' : 'theme:surface', stroke: last ? null : { color: 'theme:border', width: 1 },
    })
    out.push({ id: k(`item${i}-link`), type: 'shape', role: 'decor', frame: frame(x + cardW / 2 - 1, cardBottom, 2, laneC - node / 2 - cardBottom), shape: 'rect', fill: last ? 'theme:accent' : 'theme:border', stroke: null })
    out.push(badge(k(`item${i}-num`), x + cardW / 2 - node / 2, laneC - node / 2, node, pad2(i), i))
    let y = areaTop + 26
    const ink: ColorValue = last ? 'theme:onAccent' : 'theme:text'
    if (it.heading) {
      const hH = blockH(it.heading, 19, 1.35, tw, 3)
      out.push(text(k(`item${i}-head`), 'item', frame(x + pad, y, tw, hH), it.heading, headingOpts(19, 3, { lineHeight: 1.35, color: ink }), i))
      y += hH + 12
    }
    const maxBody = Math.max(1, Math.min(10, Math.floor((areaTop + cardH - 22 - y) / (14.5 * 1.6))))
    const bH = blockH(it.body, 14.5, 1.6, tw, maxBody)
    if (it.body) out.push(text(k(`item${i}-body`), 'item', frame(x + pad, y, tw, bH), it.body, bodyOpts(14.5, maxBody, { color: last ? 'theme:onAccent' : 'theme:muted' }), i))
  })
  return out
}

/* ------------------------------------------------------------------ */
/* content-fullbleed-glass：满版图＋毛玻璃卡放一段话                       */
/* ------------------------------------------------------------------ */

export const contentFullbleedGlass: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 1)
  const it = items[0]
  const out: SlideComponent[] = [...fullBleedBackground(k, images).comps]
  const cardX = 64, cardW = 480, pad = 36, tw = cardW - 2 * pad
  const tH = blockH(title, 30, 1.3, tw, 3)
  const hH = it?.heading ? blockH(it.heading, 17, NORMAL_LH, tw, 2) : 0
  const bH = it?.body ? blockH(it.body, 16, 1.7, tw, 8) : 0
  const contentH = tH + (hH ? 20 + hH : 0) + (bH ? (hH ? 10 : 20) + bH : 0)
  const cardH = contentH + 2 * pad
  const cardY = Math.max(36, (H - cardH) / 2)
  out.push(...glassCard(k, 'glass', frame(cardX, cardY, cardW, cardH), 22, 0.72, 16))
  let y = cardY + pad
  out.push(text(k('title'), 'title', frame(cardX + pad, y, tw, tH || 39), title, headingOpts(30, 3)))
  y += tH
  if (it?.heading) {
    out.push(text(k('item0-head'), 'item', frame(cardX + pad, y + 20, tw, hH), it.heading, { size: 17, bold: true, lineHeight: NORMAL_LH, color: 'theme:accent', maxLines: 2 }, 0))
    y += 20 + hH
  }
  if (it?.body) out.push(text(k('item0-body'), 'item', frame(cardX + pad, y + (hH ? 10 : 20), tw, bH), it.body, bodyOpts(16, 8, { lineHeight: 1.7 }), 0))
  return out
}

/* ------------------------------------------------------------------ */
/* content-fullbleed-quote：满版图＋半透明遮罩＋错落大字（2–5 个字框）       */
/* ------------------------------------------------------------------ */

const QUOTE_BREAK = /[，。、；：！？,.;:!?\s·—…]/

/**
 * 一句话拆 2–5 段（错落大字用）：先按标点／空白断（标点留在前一段尾）·不到 2 段按字数均分·超过 5 段两两并最短的；
 * 段太长（> 8 字）且不到 5 段 ⇒ 对半再切。纯函数·拆完 join('') 恒等于原句（字一个不丢）。
 */
export function splitQuoteChunks(raw: string): string[] {
  const s = raw.trim()
  if (!s) return []
  const chars = Array.from(s)
  let segs: string[] = []
  let cur = ''
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i]
    const isBreak = QUOTE_BREAK.test(chars[i])
    const nextBreak = i + 1 < chars.length && QUOTE_BREAK.test(chars[i + 1])
    if (isBreak && !nextBreak) { segs.push(cur); cur = '' }
  }
  if (cur) segs.push(cur)
  const len = (x: string) => Array.from(x).length
  const halve = (x: string): [string, string] => { const a = Array.from(x); const m = Math.ceil(a.length / 2); return [a.slice(0, m).join(''), a.slice(m).join('')] }
  if (segs.length < 2) {
    if (chars.length < 2) return [s]
    const kk = Math.max(2, Math.min(5, Math.ceil(chars.length / 5)))
    const per = Math.ceil(chars.length / kk)
    segs = []
    for (let i = 0; i < chars.length; i += per) segs.push(chars.slice(i, i + per).join(''))
  }
  while (segs.length > 5) {
    let best = 0, bestLen = Infinity
    for (let i = 0; i < segs.length - 1; i++) { const l = len(segs[i]) + len(segs[i + 1]); if (l < bestLen) { bestLen = l; best = i } }
    segs.splice(best, 2, segs[best] + segs[best + 1])
  }
  while (segs.length < 5) {
    let li = 0
    for (let i = 1; i < segs.length; i++) if (len(segs[i]) > len(segs[li])) li = i
    if (len(segs[li]) <= 8) break
    segs.splice(li, 1, ...halve(segs[li]))
  }
  return segs
}

/** 错落横移比例（第 i 段往右挪「可挪宽 × 比例」） */
const QUOTE_STAGGER = [0, 0.34, 0.12, 0.46, 0.22]

export const contentFullbleedQuote: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 1)
  const sub = items[0]
  const bg = fullBleedBackground(k, images)
  const out: SlideComponent[] = [...bg.comps]
  out.push({ id: k('mask'), type: 'shape', role: 'backgroundMask', locked: true, frame: frame(0, 0, W, H), shape: 'rect', fill: 'theme:bg', stroke: null, opacity: bg.hasImage ? 0.58 : 0.3 })
  // 落款（右下）：小标题＝强调色小字·正文＝副标
  const sW = 520, sX = W - 64 - sW
  const lH = sub?.heading ? blockH(sub.heading, 15, NORMAL_LH, sW, 1, 2) : 0
  const bH = sub?.body ? blockH(sub.body, 17, 1.6, sW, 3) : 0
  const subH = lH + (lH && bH ? 8 : 0) + bH
  const quoteTop = 56
  const quoteBottom = H - 56 - (subH ? subH + 28 : 0)
  // 大字
  const chunks = splitQuoteChunks(title)
  const n = chunks.length
  if (n > 0) {
    const availH = quoteBottom - quoteTop
    const lh = 1.3, gapR = 0.16
    const maxW = 780
    const unitW = Math.max(...chunks.map((c) => approxTextWidth(c, 1)))
    let size = Math.min(84, availH / (n * lh + (n - 1) * gapR), maxW / Math.max(1, unitW * 1.1))
    size = Math.max(26, Math.floor(size))
    const lineH = size * lh, gap = size * gapR
    const total = n * lineH + (n - 1) * gap
    let y = quoteTop + Math.max(0, (availH - total) / 2)
    chunks.forEach((c, i) => {
      const cw = approxTextWidth(c, size) * 1.1
      const slack = Math.max(0, W - 2 * 80 - cw)
      const x = 80 + slack * QUOTE_STAGGER[i % QUOTE_STAGGER.length]
      // role=lead（⛔ title：标题类组件改字会整句回写 draft.title·拆开的一段写回去就把整句截断了）
      out.push({
        ...text(k(`quote${i}`), 'lead', frame(x, y, W - x - 40, lineH), c, {
          font: 'theme:heading', size, bold: true, lineHeight: lh, color: i % 2 === 1 ? 'theme:accent' : 'theme:text', maxLines: 1,
        }),
        name: `大字 ${i + 1}`,
      })
      y += lineH + gap
    })
  }
  let y = quoteBottom + 28
  if (sub?.heading) {
    out.push(text(k('item0-head'), 'subtitle', frame(sX, y, sW, lH), sub.heading, { size: 15, bold: true, lineHeight: NORMAL_LH, letterSpacing: 2, color: 'theme:accent', align: 'right', maxLines: 1 }, 0))
    y += lH + (bH ? 8 : 0)
  }
  if (sub?.body) out.push(text(k('item0-body'), 'subtitle', frame(sX, y, sW, bH), sub.body, bodyOpts(17, 3, { align: 'right', color: 'theme:text' }), 0))
  return out
}

/* ------------------------------------------------------------------ */
/* content-fullbleed-cols：满版图上方留天空·下方 3 张半透明卡并列            */
/* ------------------------------------------------------------------ */

export const contentFullbleedCols: Blueprint = ({ pageKey, draft, images }) => {
  const k = (s: string) => `${pageKey}.${s}`
  const { title, items } = contentOf(draft, 3)
  const out: SlideComponent[] = [...fullBleedBackground(k, images).comps]
  const innerW = W - 2 * PADX
  // 标题衬底（只衬字那一块·天空留给图）
  if (title) {
    const titleW = Math.min(innerW - 26 - 22, approxTextWidth(title, 30) * 1.08 + 12)
    const tH = blockH(title, 30, 1.3, titleW, 2)
    out.push({ id: k('title-pill'), type: 'shape', role: 'decor', frame: frame(PADX - 22, 40, titleW + 26 + 44, tH + 28), shape: 'roundRect', radius: 16, fill: 'theme:bg', stroke: null, opacity: 0.8 })
    out.push(dot(k('dot'), PADX, 54 + (39 - 12) / 2, 12))
    out.push(text(k('title'), 'title', frame(PADX + 26, 54, titleW, tH), title, headingOpts(30, 2)))
  }
  const n = items.length
  if (n === 0) return out
  const gap = 20, pad = 22
  const cardW = (innerW - gap * (n - 1)) / n
  const tw = cardW - 2 * pad
  const metrics = items.map((it) => {
    const hH = it.heading ? blockH(it.heading, 18, NORMAL_LH, tw, 2) : 0
    const bH = it.body ? blockH(it.body, 14.5, 1.6, tw, 4) : 0
    return { hH, bH, h: 10 + 12 + hH + (hH && bH ? 8 : 0) + bH }
  })
  const cardH = Math.max(140, Math.min(232, Math.max(...metrics.map((m) => m.h)) + 2 * pad))
  const cardY = H - 44 - cardH
  items.forEach((it, i) => {
    const x = PADX + i * (cardW + gap)
    const m = metrics[i]
    out.push(...glassCard(k, `item${i}`, frame(x, cardY, cardW, cardH), 16, 0.8, 14, i))
    out.push(dot(k(`item${i}-dot`), x + pad, cardY + pad, 10))
    let y = cardY + pad + 22
    if (it.heading) {
      out.push(text(k(`item${i}-head`), 'item', frame(x + pad, y, tw, m.hH), it.heading, { font: 'theme:heading', size: 18, bold: true, lineHeight: NORMAL_LH, color: 'theme:text', maxLines: 2 }, i))
      y += m.hH + (m.bH ? 8 : 0)
    }
    if (it.body) out.push(text(k(`item${i}-body`), 'item', frame(x + pad, y, tw, m.bH), it.body, bodyOpts(14.5, 4), i))
  })
  return out
}

/** 本档 5 个蓝图（blueprints.ts 的 BLUEPRINTS 逐条登记） */
export const MOSAIC_FULL_BLUEPRINTS = {
  'content-mosaic': contentMosaic,
  'content-cards-flow': contentCardsFlow,
  'content-fullbleed-glass': contentFullbleedGlass,
  'content-fullbleed-quote': contentFullbleedQuote,
  'content-fullbleed-cols': contentFullbleedCols,
} as const
