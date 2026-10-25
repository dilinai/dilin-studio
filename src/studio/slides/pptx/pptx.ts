// 简报 ⇒ .pptx（可编辑对象）（在 PowerPoint 里能直接改字）
//
//   做法：不按 deck 草稿重排，而是**照页面实际画出来的样子量**——每一页放进一个同源、不跑脚本的隐藏 iframe，
//   按设计画布尺寸（新版 1000×562.5 ⇒ 16:9；旧版整页 HTML 1024×768 ⇒ 4:3·与左栏缩略图同尺寸）排好版，
//   逐个元素读 getBoundingClientRect＋计算后样式：有字的 ⇒ 文字框（PowerPoint 里可改字·分段样式保留）；
//   有底色／框线的块 ⇒ 形状（矩形／圆角矩形／椭圆·透明度照算）；<img>／内嵌 svg ⇒ 图片（按页面上看到的裁切与圆角先在 canvas 里裁好）；
//   整页底色 ⇒ 投影片背景。手动排版层（deck_data.pages[i].htmlOverride）本来就是那一页的 HTML，走同一条路＝照搬。
//   只在浏览器跑（页面「pptx」钮动态载入本档·pptxgenjs 跟着进同一个懒载入 chunk·⛔ 进主包）。
//
//   来源与授权（先抄后造）：
//     - 生成 .pptx：pptxgenjs 3.12.0（MIT·Copyright (c) 2015-present Brent Ely）·整包调用·没改它的码。
//       没用 4.x：4.0.1 的浏览器版里有 import('node:fs'／'node:https')·Next 客户端编译报 UnhandledSchemeError（要改两站 next.config 才过）；3.12.0 走 require('fs') ＋ package.json browser 栏映射成空·两站零配置改动。
//     - 「量 DOM 坐标＋计算样式 ⇒ pptxgenjs 对象」的做法与下列几段规则照 dom-to-pptx 2.1.2（MIT·Copyright (c) 2025 Atharva Dharmendra Jagtap and dom-to-pptx contributors·
//       https://github.com/atharva9167j/dom-to-pptx）dist/dom-to-pptx.mjs 改写：
//         processSlide 的走访与 z 排序键（父键＋[z-index, DOM 序]）→ collect()/cmpKey()；
//         isTextContainer 的「只含行内子元素才算一个文字框」判法 → isTextContainer()；
//         getTextStyle 的 px→pt、行高、字距、粗斜底线换算 → runStyle()；
//         parseColor 用 canvas 把任意 CSS 颜色正规化成 hex＋alpha → parseColor()；
//         prepareRenderItem 对混排元素里的裸文字节点用 Range 量框 → looseText()。
//       它的动画／字型内嵌／html2canvas 截图／表格那几大块没用（没进依赖·没抄）。已修改：改成 TypeScript、按本站版式收窄、坐标换算改成「画布像素 ⇒ 英寸」单一比例。
//     - 取图的「边读边数字节·超上限即断」：本仓 core/lib/read-bounded-bytes.ts（与 Word 导出同一份）。
//     - 图床不给 CORS 时的退路：宿主传进来的同源代理（ExportMediaProxy·网站登入版＝自家媒体代理）；没传＝不走代理。
//     - 每页拆成独立文档＋强制显示＋data-step 全显＋禁动画：照本仓简报页左栏缩略图（ai-slides/page.tsx THUMB_OVERRIDE／thumbDocs）同一口径。
import type PptxGenJSType from 'pptxgenjs'
import { readBoundedBytes } from '../../shared/read-bounded-bytes'

type Pptx = InstanceType<typeof PptxGenJSType>
type Slide = ReturnType<Pptx['addSlide']>
type TextRun = { text: string; options?: Record<string, unknown> }

export type PptxExportStats = { slides: number; textBoxes: number; shapes: number; images: number; decorations: number; imagesSkipped: number; layout: '16x9' | '4x3' }

/** 取图上限（每份）：张数／单张／总字节——简报图多于文档·比 Word 导出（40 张／60MB）放宽 */
const MAX_IMAGES = 100
const MAX_IMG_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_IMG_BYTES = 150 * 1024 * 1024
/** 等字型／图片载好的上限（整份导出合计·陆版连不上 Google 字型时别卡死） */
const WAIT_FONTS_MS = 10000
const WAIT_IMG_MS = 15000

const V2 = { w: 1000, h: 562.5, inW: 10, inH: 5.625 }   // slide-kit CANVAS_WIDTH／HEIGHT ⇒ pptxgenjs LAYOUT_16x9
const LEGACY = { w: 1024, h: 768, inW: 10, inH: 7.5 }    // 旧版整页 HTML（规格 4:3·缩略图同尺寸）⇒ LAYOUT_4x3

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const raf = (w: Window) => new Promise<void>(r => w.requestAnimationFrame(() => r()))

// ── 颜色 ─────────────────────────────────────────────────────────────────
let colorCtx: CanvasRenderingContext2D | null = null
/** 任意 CSS 颜色 ⇒ {hex:'RRGGBB', a:0..1}；透明 ⇒ null（照 dom-to-pptx parseColor：先让 canvas 正规化） */
export function parseColor(str: string | null | undefined): { hex: string; a: number } | null {
  if (!str) return null
  const s = str.trim()
  if (!s || s === 'transparent' || s === 'none') return null
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    if (!(a > 0)) return null
    const hex = [m[1], m[2], m[3]].map(v => Math.max(0, Math.min(255, Math.round(parseFloat(v)))).toString(16).padStart(2, '0')).join('').toUpperCase()
    return { hex, a: Math.min(1, a) }
  }
  if (typeof document === 'undefined') return null
  if (!colorCtx) { const c = document.createElement('canvas'); c.width = c.height = 1; colorCtx = c.getContext('2d', { willReadFrequently: true }) }
  if (!colorCtx) return null
  colorCtx.clearRect(0, 0, 1, 1)
  colorCtx.fillStyle = '#000'
  colorCtx.fillStyle = s
  colorCtx.fillRect(0, 0, 1, 1)
  const d = colorCtx.getImageData(0, 0, 1, 1).data
  if (d[3] === 0) return null
  return { hex: [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(), a: d[3] / 255 }
}
/** 渐层底 ⇒ 取第一个色标当单色（PowerPoint 形状不带 CSS 渐层·照 dom-to-pptx getGradientFallbackColor 的取法） */
function gradientFallback(bgImage: string): string | null {
  if (!/gradient\(/.test(bgImage)) return null
  const m = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\b(?:white|black|transparent)\b)/.exec(bgImage)
  return m ? m[1] : null
}
const transparencyOf = (a: number) => Math.max(0, Math.min(100, Math.round((1 - a) * 100)))

// ── 页面拆页（同简报页左栏缩略图 thumbDocs 的逐层回退：section.slide → div.slide → [class*="slide"] → 整份一页） ──
type SlideSrc = { headInner: string; bodyHtml: string; lang: string }
export function splitSlides(html: string): { slides: SlideSrc[]; v2: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script').forEach(s => s.remove())
  const headInner = doc.head ? doc.head.innerHTML : ''
  const lang = (doc.documentElement.getAttribute('lang') || '').replace(/[^A-Za-z0-9-]/g, '')
  let els = Array.from(doc.querySelectorAll('section.slide'))
  if (els.length === 0) els = Array.from(doc.querySelectorAll('div.slide'))
  if (els.length === 0) {
    els = Array.from(doc.querySelectorAll('[class*="slide"]:not(style):not(script)'))
    els.forEach(el => el.setAttribute('data-pptx-root', ''))
  }
  const v2 = els.length > 0 && els.some(el => !!el.querySelector('.sk-stage'))
  if (els.length === 0) return { slides: [{ headInner, lang, bodyHtml: `<div data-pptx-root>${doc.body ? doc.body.innerHTML : ''}</div>` }], v2: false }
  return { slides: els.map(el => ({ headInner, lang, bodyHtml: el.outerHTML })), v2 }
}

function slideDoc(src: SlideSrc, box: { w: number; h: number }, v2: boolean): string {
  // 缩略图同款强制显示（THUMB_OVERRIDE）＋画布定尺寸；新版舞台不缩放（__sk_fit__ 脚本不跑）
  const css = `html,body{margin:0!important;padding:0!important;overflow:hidden!important;width:${box.w}px!important;height:${box.h}px!important}` +
    `section.slide,div.slide,[data-pptx-root]{display:flex!important;flex-direction:column}` +
    (v2 ? `section.slide{width:${box.w}px!important;height:${box.h}px!important}.sk-stage{transform:none!important}` : '') +
    `[data-step]{opacity:1!important;transform:none!important}*{animation:none!important;transition:none!important}`
  return `<!DOCTYPE html><html${src.lang ? ` lang="${src.lang}"` : ''}><head><meta charset="UTF-8">${src.headInner}<style id="__pptx_export__">${css}</style></head><body>${src.bodyHtml}</body></html>`
}

// ── 走访 ─────────────────────────────────────────────────────────────────
type Rect = { left: number; top: number; width: number; height: number }
type Item =
  | { kind: 'shape'; z: number[]; shape: 'rect' | 'roundRect' | 'ellipse'; box: Rect; opts: Record<string, unknown> }
  | { kind: 'text'; z: number[]; box: Rect; runs: TextRun[]; opts: Record<string, unknown> }
  | { kind: 'image'; z: number[]; decor?: boolean; job: () => Promise<{ data: string; box: Rect } | 'skip' | null> }

function cmpKey(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

const INLINE_TAGS = new Set(['span', 'b', 'strong', 'em', 'i', 'a', 'small', 'mark', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'font', 'code', 'br', 'label', 'abbr', 'cite', 'q', 'time'])
/** 一个元素算不算「一个文字框」：有字·子元素全是行内、没底色没框线的小段（照 dom-to-pptx isTextContainer 收窄） */
function isTextContainer(el: Element, win: Window): boolean {
  if (!(el.textContent ?? '').trim()) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'svg' || tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'iframe') return false
  for (const c of Array.from(el.children)) {
    const t = c.tagName.toLowerCase()
    if (t === 'img' || t === 'svg' || t === 'video' || t === 'canvas' || t.includes('-')) return false
    const cs = win.getComputedStyle(c)
    if (cs.display === 'none') continue
    if (!(INLINE_TAGS.has(t) || cs.display.startsWith('inline')) || cs.display === 'inline-block' || cs.display === 'inline-flex' || cs.display === 'inline-grid') return false
    if (cs.position === 'absolute' || cs.position === 'fixed') return false
    const radius = parseFloat(cs.borderTopLeftRadius) || 0
    const border = (parseFloat(cs.borderTopWidth) || 0) > 0 && !!parseColor(cs.borderTopColor)
    if (radius > 0 || border) return false
    if (!(c.textContent ?? '').trim() && parseColor(cs.backgroundColor)) return false
    if (c.children.length && !isTextContainer(c, win)) return false
  }
  return true
}

function fontFaceOf(cs: CSSStyleDeclaration): string {
  return (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim() || 'Noto Sans TC'
}
function transformText(t: string, tt: string): string {
  if (tt === 'uppercase') return t.toUpperCase()
  if (tt === 'lowercase') return t.toLowerCase()
  if (tt === 'capitalize') return t.replace(/\b\p{L}/gu, c => c.toUpperCase())
  return t
}
/** 一段字的样式（照 dom-to-pptx getTextStyle：px ⇒ pt 用 画布 px→英寸 比例 ×72） */
function runStyle(cs: CSSStyleDeclaration, ptPerPx: number, opacity: number, lang?: string): Record<string, unknown> {
  const fill = cs.getPropertyValue('-webkit-text-fill-color')
  let col = parseColor(fill && fill !== cs.color && !/^rgba\(0, 0, 0, 0\)$/.test(fill) ? fill : cs.color)
  if (!col) { const g = gradientFallback(cs.backgroundImage); col = g ? parseColor(g) : null }
  const o: Record<string, unknown> = {
    color: col?.hex ?? '000000',
    fontFace: fontFaceOf(cs),
    fontSize: Math.max(1, Math.round(parseFloat(cs.fontSize) * ptPerPx * 10) / 10),
    bold: (parseInt(cs.fontWeight, 10) || 400) >= 600,
    italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
    ...(lang ? { lang } : {}),
  }
  const t = transparencyOf((col?.a ?? 1) * opacity)
  if (t > 0) o.transparency = t
  const deco = cs.textDecorationLine || cs.textDecoration
  if (/underline/.test(deco)) o.underline = { style: 'sng' }
  if (/line-through/.test(deco)) o.strike = 'sngStrike'
  const ls = parseFloat(cs.letterSpacing)
  if (Number.isFinite(ls) && ls !== 0) o.charSpacing = Math.round(ls * ptPerPx * 10) / 10
  if (cs.verticalAlign === 'super') o.superscript = true
  if (cs.verticalAlign === 'sub') o.subscript = true
  return o
}

/** 文字容器 ⇒ 分段（run）：文字节点各带自己所在元素的样式；<br> 断行；空白照 white-space 收合 */
function collectRuns(el: Element, win: Window, ptPerPx: number, opacity: number, lang?: string): TextRun[] {
  const runs: TextRun[] = []
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const parent = node.parentElement
      if (!parent) return
      const cs = win.getComputedStyle(parent)
      if (cs.display === 'none' || cs.visibility === 'hidden') return
      let t = node.nodeValue ?? ''
      if (!/^pre/.test(cs.whiteSpace)) t = t.replace(/[\t\n\r ]+/g, ' ')
      else if (cs.whiteSpace === 'pre-line') t = t.replace(/[\t ]+/g, ' ')
      if (!t) return
      const lines = t.split('\n')
      lines.forEach((ln, i) => {
        const text = transformText(ln, cs.textTransform)
        const opts = runStyle(cs, ptPerPx, opacity, lang)
        if (i < lines.length - 1) opts.breakLine = true
        if (text || opts.breakLine) runs.push({ text, options: opts })
      })
      return
    }
    if (node.nodeType !== 1) return
    const e = node as Element
    if (e.tagName.toLowerCase() === 'br') {
      if (runs.length) runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: true }
      else runs.push({ text: '', options: { breakLine: true } })
      return
    }
    const cs = win.getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    e.childNodes.forEach(walk)
  }
  el.childNodes.forEach(walk)
  // 头尾空白（HTML 排版不显示）去掉；断行后的行首空白也去掉
  let prevBreak = true
  for (const r of runs) {
    if (prevBreak) r.text = r.text.replace(/^ +/, '')
    prevBreak = !!r.options?.breakLine
  }
  for (let i = runs.length - 1; i >= 0; i--) {
    const before = runs[i].text
    runs[i].text = before.replace(/ +$/, '')
    if (runs[i].text || runs[i].options?.breakLine) break
  }
  return runs.filter((r, i) => r.text !== '' || r.options?.breakLine || i === runs.length - 1)
}

/** flex 置中／文字对齐 ⇒ pptx 的 align／valign */
function alignOf(cs: CSSStyleDeclaration): { align: 'left' | 'center' | 'right' | 'justify'; valign: 'top' | 'middle' | 'bottom' } {
  const ta = cs.textAlign
  let align: 'left' | 'center' | 'right' | 'justify' = ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'right' : ta === 'justify' ? 'justify' : 'left'
  let valign: 'top' | 'middle' | 'bottom' = 'top'
  if (cs.display.includes('flex')) {
    const col = cs.flexDirection.startsWith('column')
    const h = col ? cs.alignItems : cs.justifyContent
    const v = col ? cs.justifyContent : cs.alignItems
    if (/center/.test(h)) align = 'center'
    else if (/(end|right)/.test(h)) align = 'right'
    if (/center/.test(v)) valign = 'middle'
    else if (/end/.test(v)) valign = 'bottom'
  } else if (cs.display.includes('grid')) {
    if (/center/.test(cs.justifyItems) || /center/.test(cs.justifyContent)) align = 'center'
    if (/center/.test(cs.alignItems) || /center/.test(cs.alignContent)) valign = 'middle'
  }
  return { align, valign }
}

const px = (v: string) => parseFloat(v) || 0
/** 圆角：数值或百分比 ⇒ px（取左上角·本站版式四角同值） */
function radiusPx(cs: CSSStyleDeclaration, w: number, h: number): number {
  const raw = cs.borderTopLeftRadius.split(' ')[0]
  if (!raw) return 0
  if (raw.endsWith('%')) return (parseFloat(raw) / 100) * Math.min(w, h)
  return parseFloat(raw) || 0
}

type Ctx = {
  win: Window
  root: Element
  rootRect: DOMRect
  inPerPx: number
  ptPerPx: number
  slideBg: string | null
  lang: string
  items: Item[]
  order: number
  imgBudget: { count: number; bytes: number }
  proxy?: ExportMediaProxy
  stats: PptxExportStats
}

const inBox = (c: Ctx, r: { left: number; top: number; width: number; height: number }): Rect => ({
  left: (r.left - c.rootRect.left) * c.inPerPx, top: (r.top - c.rootRect.top) * c.inPerPx, width: r.width * c.inPerPx, height: r.height * c.inPerPx,
})

/** 元素自己的底色／框线 ⇒ 形状（框线四边不同 ⇒ 每边一条细长方块） */
function shapeItems(c: Ctx, el: Element, cs: CSSStyleDeclaration, r: DOMRect, opacity: number, z: number[]) {
  const gradient = cs.backgroundImage && /gradient\(/.test(cs.backgroundImage) && !/url\(/.test(cs.backgroundImage) ? cs.backgroundImage : null
  const bg = parseColor(cs.backgroundColor) ?? (gradient ? parseColor(gradientFallback(gradient)) : null)
  const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)]
  const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(parseColor)
  const bs = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle]
  const sideOn = bw.map((w, i) => w > 0 && !!bc[i] && bs[i] !== 'none' && bs[i] !== 'hidden')
  const uniform = sideOn.every(Boolean) && bw.every(w => Math.abs(w - bw[0]) < 0.5) && bc.every(x => x && x.hex === bc[0]!.hex)
  // 盖满整页、与投影片背景同色的那层 ⇒ 已经是背景·不再叠一个大方块（PowerPoint 里点不到后面的东西）
  const coversRoot = Math.abs(r.left - c.rootRect.left) < 1 && Math.abs(r.top - c.rootRect.top) < 1 && Math.abs(r.width - c.rootRect.width) < 1.5 && Math.abs(r.height - c.rootRect.height) < 1.5
  const fillIsBg = !gradient && !!bg && coversRoot && bg.a * opacity >= 0.99 && bg.hex === c.slideBg
  const rad = radiusPx(cs, r.width, r.height)
  const minSide = Math.min(r.width, r.height)
  const isEllipse = rad >= minSide / 2 - 0.5 && Math.abs(r.width - r.height) < 1
  // PowerPoint 形状装不下的两种 ⇒ 按页面画法先在 canvas 里画好成图（文字仍是另外的可编辑文字框）：
  //   渐层底（形状只收单色）；被中间某层 overflow:hidden 裁掉一部分的形状（例：缺图占位里探出框外的装饰圆）
  const clip = bg || gradient ? innerClip(c, el, r) : null
  if (gradient || (bg && !fillIsBg && clip)) {
    const vis = clip ?? { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, radius: 0 }
    rasterItem(c, vis, [...z], g => {
      g.globalAlpha = Math.max(0, Math.min(1, opacity))
      g.beginPath()
      if (isEllipse) g.ellipse(r.left + r.width / 2, r.top + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2)
      else g.roundRect(r.left, r.top, r.width, r.height, Math.min(rad, minSide / 2))
      g.fillStyle = (gradient && canvasGradient(g, gradient, r)) || (bg ? `rgba(${hexRgb(bg.hex)},${bg.a})` : 'transparent')
      g.fill()
    })
  }
  const solidShape = bg && !fillIsBg && !gradient && !clip
  if (solidShape || uniform) {
    let shape: 'rect' | 'roundRect' | 'ellipse' = 'rect'
    const opts: Record<string, unknown> = {}
    if (isEllipse) shape = 'ellipse'
    else if (rad > 0.5) { shape = 'roundRect'; opts.rectRadius = Math.min(rad, minSide / 2) * c.inPerPx }
    opts.fill = solidShape && bg ? { color: bg.hex, transparency: transparencyOf(bg.a * opacity) } : { type: 'none' }
    opts.line = uniform ? { color: bc[0]!.hex, width: Math.max(0.25, bw[0] * c.ptPerPx), transparency: transparencyOf(bc[0]!.a * opacity), ...(bs[0] === 'dashed' ? { dashType: 'dash' } : bs[0] === 'dotted' ? { dashType: 'sysDot' } : {}) } : { type: 'none' }
    c.items.push({ kind: 'shape', z: [...z, 0.1], shape, box: inBox(c, r), opts })
    c.stats.shapes++
  }
  if (!uniform) {
    const sides: Array<[number, Rect]> = [
      [0, { left: r.left, top: r.top, width: r.width, height: bw[0] }],
      [1, { left: r.right - bw[1], top: r.top, width: bw[1], height: r.height }],
      [2, { left: r.left, top: r.bottom - bw[2], width: r.width, height: bw[2] }],
      [3, { left: r.left, top: r.top, width: bw[3], height: r.height }],
    ]
    for (const [i, sd] of sides) {
      if (!sideOn[i]) continue
      c.items.push({ kind: 'shape', z: [...z, 0.5], shape: 'rect', box: inBox(c, sd), opts: { fill: { color: bc[i]!.hex, transparency: transparencyOf(bc[i]!.a * opacity) }, line: { type: 'none' } } })
      c.stats.shapes++
    }
  }
}

const hexRgb = (hex: string) => `${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)}`
/** 顶层逗号切参数（括号里的逗号不切） */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
/** CSS linear-／radial-gradient（计算后样式·取第一层）⇒ canvas 渐层；认不得 ⇒ null（调用方退回单色） */
function canvasGradient(g: CanvasRenderingContext2D, css: string, r: DOMRect): CanvasGradient | null {
  const m = /(repeating-)?(linear|radial)-gradient\((.*)\)/.exec(splitTop(css)[0] ?? '')
  if (!m || m[1]) return null
  const args = splitTop(m[3])
  let grad: CanvasGradient
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  if (m[2] === 'linear') {
    let angle = 180
    const first = args[0] ?? ''
    if (/^-?[\d.]+(deg|turn|rad|grad)$/.test(first)) {
      const v = parseFloat(first)
      angle = first.endsWith('turn') ? v * 360 : first.endsWith('rad') ? (v * 180) / Math.PI : first.endsWith('grad') ? v * 0.9 : v
      args.shift()
    } else if (/^to /.test(first)) {
      const t = first.slice(3)
      const map: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 }
      angle = map[t] ?? 180
      args.shift()
    }
    const a = (angle * Math.PI) / 180
    const dx = Math.sin(a), dy = -Math.cos(a)
    const len = Math.abs(r.width * dx) + Math.abs(r.height * dy)
    grad = g.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2)
  } else {
    if (args[0] && !/^(rgb|hsl|#|transparent|[a-z]+\s*$)/i.test(args[0]) || /\b(circle|ellipse|at|closest|farthest)\b/.test(args[0] ?? '')) args.shift()
    grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(r.width, r.height) / 2)
  }
  const stops = args.map(st => {
    const mm = /^(.*?)(?:\s+(-?[\d.]+)%)?(?:\s+(-?[\d.]+)%)?$/.exec(st)
    return { color: (mm?.[1] ?? st).trim(), pos: mm?.[2] !== undefined ? parseFloat(mm[2]) / 100 : null }
  }).filter(x => x.color)
  if (stops.length < 2) return null
  stops.forEach((st, i) => { if (st.pos === null) st.pos = i / (stops.length - 1) })
  try { for (const st of stops) grad.addColorStop(Math.max(0, Math.min(1, st.pos!)), st.color) } catch { return null }
  return grad
}
/** 画成图的装饰（渐层块／被裁的形状）：按可见框与圆角裁好·一倍解析度（渐层两倍画 PNG 一块就半 MB·一倍肉眼看不出差） */
function rasterItem(c: Ctx, clip: { rect: Rect; radius: number }, z: number[], paint: (g: CanvasRenderingContext2D) => void) {
  c.items.push({
    kind: 'image', z, decor: true,
    job: async () => {
      const S = 1
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(clip.rect.width * S)); cv.height = Math.max(1, Math.round(clip.rect.height * S))
      const g = cv.getContext('2d')
      if (!g) return null
      g.scale(S, S); g.translate(-clip.rect.left, -clip.rect.top)
      if (clip.radius > 0) { g.beginPath(); g.roundRect(clip.rect.left, clip.rect.top, clip.rect.width, clip.rect.height, clip.radius); g.clip() }
      paint(g)
      return { data: cv.toDataURL('image/png').replace(/^data:/, ''), box: inBox(c, clip.rect) }
    },
  })
}
/** 被「不是整页」的祖先 overflow 裁到的可见框（没被裁 ⇒ null）；整页那层不算（投影片边界本来就会切） */
function innerClip(c: Ctx, el: Element, r: DOMRect): { rect: Rect; radius: number } | null {
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom, radius = 0, clipped = false
  const rr = c.rootRect
  for (let a = el.parentElement; a && a !== c.root; a = a.parentElement) {
    const cs = c.win.getComputedStyle(a)
    if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
    const ar = a.getBoundingClientRect()
    if (ar.left <= rr.left + 1 && ar.top <= rr.top + 1 && ar.right >= rr.right - 1 && ar.bottom >= rr.bottom - 1) continue
    if (ar.left > left + 0.5 || ar.top > top + 0.5 || ar.right < right - 0.5 || ar.bottom < bottom - 0.5) {
      clipped = true
      left = Math.max(left, ar.left); top = Math.max(top, ar.top); right = Math.min(right, ar.right); bottom = Math.min(bottom, ar.bottom)
      const rad = radiusPx(cs, ar.width, ar.height)
      if (rad > 0) radius = Math.max(radius, rad)
    }
  }
  if (!clipped || right - left < 0.5 || bottom - top < 0.5) return null
  return { rect: { left, top, width: right - left, height: bottom - top }, radius }
}

/** 往上找会裁切它的祖先（overflow 非 visible）⇒ 可见框与圆角 */
function clipOf(c: Ctx, el: Element, r: DOMRect): { rect: Rect; radius: number } | null {
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom, radius = 0
  let radiusSet = false
  for (let a = el.parentElement; a; a = a.parentElement) {
    const cs = c.win.getComputedStyle(a)
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const ar = a.getBoundingClientRect()
      left = Math.max(left, ar.left); top = Math.max(top, ar.top); right = Math.min(right, ar.right); bottom = Math.min(bottom, ar.bottom)
      if (!radiusSet) { const rad = radiusPx(cs, ar.width, ar.height); if (rad > 0 && Math.abs(ar.left - left) < 1 && Math.abs(ar.top - top) < 1 && Math.abs(ar.right - right) < 1 && Math.abs(ar.bottom - bottom) < 1) radius = rad; radiusSet = true }
    }
    if (a === c.root) break
  }
  const rr = c.rootRect
  left = Math.max(left, rr.left); top = Math.max(top, rr.top); right = Math.min(right, rr.right); bottom = Math.min(bottom, rr.bottom)
  if (right - left < 0.5 || bottom - top < 0.5) return null
  return { rect: { left, top, width: right - left, height: bottom - top }, radius }
}

/**
 * 直取外站图／影片失败（多半是对方没给 CORS）时的退路：宿主给一个同源代理网址（网站＝自家媒体代理）。
 * 不给 ⇒ 不走代理、照「抓不到」算（游客版就是这样：不连本站伺服器）。
 */
export type ExportMediaProxy = (url: string, kind: 'image' | 'video') => string

/** 组件版按组件直出也用同一套取图（同一份张数／字节上限·CORS 不给时走宿主代理） */
export function fetchExportBitmap(url: string, budget: MeasureBudget): Promise<{ bmp: ImageBitmap; hasAlpha: boolean } | null> {
  return fetchBitmap({ imgBudget: budget.imgBudget, proxy: budget.proxy } as Ctx, url)
}
async function fetchBitmap(c: Ctx, url: string): Promise<{ bmp: ImageBitmap; hasAlpha: boolean } | null> {
  if (!url || c.imgBudget.count >= MAX_IMAGES || c.imgBudget.bytes >= MAX_TOTAL_IMG_BYTES) return null
  const direct = await fetchBitmapFrom(c, url)
  if (direct) return direct
  // 直取失败 ⇒ 宿主有代理才走（网站那条只代理本人名下的本站图·其余回 403 ⇒ 照「抓不到」算）
  if (!c.proxy) return null
  let sameOrigin = false
  try { sameOrigin = new URL(url, location.href).origin === location.origin } catch { return null }
  if (sameOrigin || !/^https?:/i.test(url)) return null
  return fetchBitmapFrom(c, c.proxy(url, 'image'))
}
async function fetchBitmapFrom(c: Ctx, url: string): Promise<{ bmp: ImageBitmap; hasAlpha: boolean } | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (type && !type.startsWith('image/')) return null
    const buf = await readBoundedBytes(res, Math.min(MAX_IMG_BYTES, MAX_TOTAL_IMG_BYTES - c.imgBudget.bytes))
    if (!buf) return null
    const blob = new Blob([buf as BlobPart], { type: type || 'image/png' })
    let bmp: ImageBitmap
    if (type === 'image/svg+xml') bmp = await svgBlobToBitmap(blob)
    else bmp = await createImageBitmap(blob)
    c.imgBudget.count++; c.imgBudget.bytes += buf.byteLength
    return { bmp, hasAlpha: type !== 'image/jpeg' && type !== 'image/jpg' }
  } catch { return null }
}
function svgBlobToBitmap(blob: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob)
    const im = new Image()
    im.onload = () => { createImageBitmap(im).then(b => { URL.revokeObjectURL(u); resolve(b) }, e => { URL.revokeObjectURL(u); reject(e) }) }
    im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('svg decode')) }
    im.src = u
  })
}

/** 按页面上的实际画法（object-fit／裁切框／圆角）把图先在 canvas 里画好 ⇒ base64（pptxgenjs 的 data 格式） */
function drawVisible(bmp: ImageBitmap, drawn: Rect, clip: { rect: Rect; radius: number }, hasAlpha: boolean): string | null {
  const vis = clip.rect
  const scale = Math.min(2, Math.max(1, bmp.width / Math.max(1, drawn.width)))
  const cw = Math.max(1, Math.round(vis.width * scale)), ch = Math.max(1, Math.round(vis.height * scale))
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch
  const g = cv.getContext('2d')
  if (!g) return null
  if (clip.radius > 0) {
    g.beginPath()
    const rr = Math.min(clip.radius * scale, cw / 2, ch / 2)
    g.roundRect(0, 0, cw, ch, rr)
    g.clip()
  }
  g.drawImage(bmp, (drawn.left - vis.left) * scale, (drawn.top - vis.top) * scale, drawn.width * scale, drawn.height * scale)
  const png = clip.radius > 0 || hasAlpha
  const url = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9)
  return url.replace(/^data:/, '')
}
/** object-fit／background-size ⇒ 图在元素框里真正画出来的那块 */
function fitRect(box: Rect, iw: number, ih: number, fit: string, pos: string): Rect {
  if (fit === 'fill' || !iw || !ih) return box
  const s = fit === 'cover' ? Math.max(box.width / iw, box.height / ih) : fit === 'contain' ? Math.min(box.width / iw, box.height / ih) : fit === 'none' ? 1 : Math.min(1, Math.min(box.width / iw, box.height / ih))
  const w = iw * s, h = ih * s
  const [px0, py0] = (pos || '50% 50%').split(/\s+/)
  const frac = (v: string | undefined, def: number) => !v ? def : v.endsWith('%') ? parseFloat(v) / 100 : v === 'left' || v === 'top' ? 0 : v === 'right' || v === 'bottom' ? 1 : v === 'center' ? 0.5 : def
  return { left: box.left + (box.width - w) * frac(px0, 0.5), top: box.top + (box.height - h) * frac(py0 ?? px0, 0.5), width: w, height: h }
}

function imageItem(c: Ctx, el: Element, url: string, r: DOMRect, fit: string, pos: string, z: number[]) {
  const clip = clipOf(c, el, r)
  if (!clip) return
  // 图自己带圆角（<img style="border-radius">）且没被祖先裁小 ⇒ 用它自己的圆角
  const own = radiusPx(c.win.getComputedStyle(el), r.width, r.height)
  const sameBox = Math.abs(clip.rect.left - r.left) < 1 && Math.abs(clip.rect.top - r.top) < 1 && Math.abs(clip.rect.width - r.width) < 1 && Math.abs(clip.rect.height - r.height) < 1
  if (own > 0 && sameBox) clip.radius = Math.max(clip.radius, own)
  c.items.push({
    kind: 'image', z,
    job: async () => {
      const got = await fetchBitmap(c, url)
      if (!got) return 'skip'
      const drawn = fitRect({ left: r.left, top: r.top, width: r.width, height: r.height }, got.bmp.width, got.bmp.height, fit, pos)
      const data = drawVisible(got.bmp, drawn, clip, got.hasAlpha)
      got.bmp.close()
      return data ? { data, box: inBox(c, clip.rect) } : 'skip'
    },
  })
}

/** 内嵌 <svg>（图示／图标）⇒ 序列化成图（currentColor 换成算出来的字色） */
function svgItem(c: Ctx, el: Element, r: DOMRect, z: number[]) {
  const clip = clipOf(c, el, r)
  if (!clip) return
  const clone = el.cloneNode(true) as Element
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(r.width)); clone.setAttribute('height', String(r.height))
  const color = c.win.getComputedStyle(el).color
  const xml = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color)
  c.items.push({
    kind: 'image', z,
    job: async () => {
      try {
        const bmp = await svgBlobToBitmap(new Blob([xml], { type: 'image/svg+xml' }))
        const data = drawVisible(bmp, { left: r.left, top: r.top, width: r.width, height: r.height }, clip, true)
        bmp.close()
        return data ? { data, box: inBox(c, clip.rect) } : null
      } catch { return null }
    },
  })
}

/** 混排元素（块级子元素＋裸文字）里的裸文字节点 ⇒ 用 Range 量它自己的框（照 dom-to-pptx prepareRenderItem 文字节点那支） */
function looseText(c: Ctx, node: Text, parentCs: CSSStyleDeclaration, opacity: number, z: number[]) {
  const t = (node.nodeValue ?? '').replace(/[\t\n\r ]+/g, ' ').trim()
  if (!t) return
  const range = node.ownerDocument.createRange()
  range.selectNodeContents(node)
  const r = range.getBoundingClientRect()
  range.detach()
  if (r.width < 0.5 || r.height < 0.5) return
  const lh = parseFloat(parentCs.lineHeight)
  c.items.push({
    kind: 'text', z,
    box: inBox(c, { left: r.left, top: r.top, width: Math.min(r.width + Math.max(6, r.width * 0.08), c.rootRect.right - r.left), height: r.height }),
    runs: [{ text: transformText(t, parentCs.textTransform), options: runStyle(parentCs, c.ptPerPx, opacity, c.lang) }],
    opts: { align: 'left', valign: 'top', ...(Number.isFinite(lh) ? { lineSpacing: Math.round(lh * c.ptPerPx * 10) / 10 } : {}) },
  })
  c.stats.textBoxes++
}

function collect(c: Ctx, el: Element, parentKey: number[], parentOpacity: number) {
  const order = c.order++
  const cs = c.win.getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return
  const opacity = parentOpacity * (Number.isFinite(parseFloat(cs.opacity)) ? parseFloat(cs.opacity) : 1)
  if (opacity <= 0.001) return
  const zi = cs.zIndex !== 'auto' && cs.position !== 'static' ? parseInt(cs.zIndex, 10) || 0 : 0
  const key = [...parentKey, zi, order]
  const r = el.getBoundingClientRect()
  const tag = el.tagName.toLowerCase()
  const visibleBox = r.width >= 0.5 && r.height >= 0.5

  if (tag === 'img') {
    const im = el as HTMLImageElement
    if (visibleBox) imageItem(c, el, im.currentSrc || im.src, r, cs.objectFit || 'fill', cs.objectPosition, key)
    return
  }
  if (tag === 'video') {
    const poster = (el as HTMLVideoElement).poster
    if (visibleBox && poster) imageItem(c, el, poster, r, cs.objectFit || 'contain', cs.objectPosition, key)
    else if (visibleBox) { c.items.push({ kind: 'shape', z: key, shape: 'rect', box: inBox(c, r), opts: { fill: { color: '1F1F1F' }, line: { type: 'none' } } }); c.stats.shapes++ }
    return
  }
  if (tag === 'svg') { if (visibleBox) svgItem(c, el, r, key); return }
  if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript' || tag === 'iframe' || tag === 'canvas') return

  if (visibleBox) {
    shapeItems(c, el, cs, r, opacity, key)
    const bgUrl = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(cs.backgroundImage)
    if (bgUrl) {
      const bsz = cs.backgroundSize
      imageItem(c, el, new URL(bgUrl[1], el.ownerDocument.baseURI).href, r, bsz === 'cover' ? 'cover' : bsz === 'contain' ? 'contain' : 'fill', cs.backgroundPosition, [...key, 0.25])
    }
  }
  if (isTextContainer(el, c.win)) {
    if (!visibleBox) return
    const runs = collectRuns(el, c.win, c.ptPerPx, opacity, c.lang)
    if (!runs.some(x => x.text.trim())) return
    const pad = { t: px(cs.paddingTop) + px(cs.borderTopWidth), r: px(cs.paddingRight) + px(cs.borderRightWidth), b: px(cs.paddingBottom) + px(cs.borderBottomWidth), l: px(cs.paddingLeft) + px(cs.borderLeftWidth) }
    const box = { left: r.left + pad.l, top: r.top + pad.t, width: Math.max(1, r.width - pad.l - pad.r), height: Math.max(1, r.height - pad.t - pad.b) }
    // 字比框宽（nowrap／溢出）⇒ 框放宽到字的实际宽，免得 PowerPoint 折行
    const range = el.ownerDocument.createRange(); range.selectNodeContents(el)
    const tr = range.getBoundingClientRect(); range.detach()
    if (tr.width > box.width + 1) { box.left = Math.min(box.left, tr.left); box.width = Math.max(box.width, tr.width + 2) }
    if (tr.height > box.height + 1 && cs.overflow === 'visible') box.height = tr.height
    const { align, valign } = alignOf(cs)
    const lh = parseFloat(cs.lineHeight)
    // 只有一行的字：框留一点余量（PowerPoint／LibreOffice 换字型后字宽略不同·不留就多折一行）
    const lineH = Number.isFinite(lh) && lh > 0 ? lh : parseFloat(cs.fontSize) * 1.3
    if (tr.height <= lineH * 1.5) {
      const slack = Math.max(6, box.width * 0.08)
      if (align === 'center') { box.left -= slack / 2; box.width += slack } else if (align === 'right') { box.left -= slack; box.width += slack } else box.width += slack
      const minL = c.rootRect.left, maxR = c.rootRect.right
      if (box.left < minL) { box.width -= minL - box.left; box.left = minL }
      if (box.left + box.width > maxR) box.width = maxR - box.left
    }
    // 条列（li）：项目符号是 ::marker（不在 DOM 里）⇒ 改用 PowerPoint 自己的项目符号·框往左放出符号那格
    const extra: Record<string, unknown> = {}
    if (tag === 'li' && cs.display === 'list-item' && cs.listStyleType !== 'none') {
      const indentPx = parseFloat(cs.fontSize) * 1.3
      box.left -= indentPx; box.width += indentPx
      const ordered = el.parentElement?.tagName.toLowerCase() === 'ol'
      const idx = el.parentElement ? Array.from(el.parentElement.children).filter(x => x.tagName.toLowerCase() === 'li').indexOf(el) : 0
      extra.bullet = ordered ? { type: 'number', indent: indentPx * c.ptPerPx, numberStartAt: idx + 1 } : { indent: indentPx * c.ptPerPx }
    }
    c.items.push({
      kind: 'text', z: [...key, 1e9], box: inBox(c, box), runs,
      opts: {
        align, valign, ...extra,
        ...(Number.isFinite(lh) && lh > 0 ? { lineSpacing: Math.round(lh * c.ptPerPx * 10) / 10 } : {}),
        wrap: !(cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre'),
      },
    })
    c.stats.textBoxes++
    return
  }
  el.childNodes.forEach(n => {
    if (n.nodeType === 1) collect(c, n as Element, key, opacity)
    else if (n.nodeType === 3) looseText(c, n as Text, cs, opacity, [...key, 1e9, c.order++])
  })
}

/** 整页底色：根元素或盖满整页的第一层有不透明底色的元素（新版＝Canvas 那层 div）；都没有 ⇒ body／html；再没有 ⇒ 白 */
function pageBackground(win: Window, root: Element): string {
  const rr = root.getBoundingClientRect()
  const stack: Element[] = [root]
  for (let n = 0; n < 12 && stack.length; n++) {
    const el = stack.shift()!
    const cs = win.getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const covers = Math.abs(r.width - rr.width) < 1.5 && Math.abs(r.height - rr.height) < 1.5
    const bg = parseColor(cs.backgroundColor)
    if (covers && bg && bg.a >= 0.99) return bg.hex
    if (covers) stack.push(...Array.from(el.children))
  }
  for (const el of [win.document.body, win.document.documentElement]) {
    const bg = el ? parseColor(win.getComputedStyle(el).backgroundColor) : null
    if (bg && bg.a >= 0.99) return bg.hex
  }
  return 'FFFFFF'
}

/** 等字型与图载好。等待时间整份共用一个额度（字型连不上时——例如陆版连不到 Google 字型——别每页都各等满） */
async function waitReady(win: Window, budget: { fontMs: number; imgMs: number }) {
  const d = win.document
  void d.body?.offsetHeight
  await raf(win)
  const waitFonts = async () => {
    const t0 = Date.now()
    await Promise.race([d.fonts?.ready ?? Promise.resolve(), sleep(Math.max(0, budget.fontMs))])
    budget.fontMs -= Date.now() - t0
  }
  await waitFonts()
  const imgs = Array.from(d.images)
  const t1 = Date.now()
  await Promise.race([
    Promise.all(imgs.map(im => (im.complete ? Promise.resolve() : new Promise<void>(r => { im.addEventListener('load', () => r(), { once: true }); im.addEventListener('error', () => r(), { once: true }) })))),
    sleep(Math.max(0, budget.imgMs)),
  ])
  budget.imgMs -= Date.now() - t1
  await waitFonts()
  await raf(win); await raf(win)
}

/**
 * 简报整份 HTML（调用方先过 stripEditScript·私密媒体已换签名链）⇒ .pptx Blob。
 * 每页＝一张投影片；文字框／形状／图片都是 PowerPoint 里可点可改的对象。
 */
export async function buildSlidesPptx(opts: { html: string; title: string; onProgress?: (done: number, total: number) => void; proxy?: ExportMediaProxy }): Promise<{ blob: Blob; stats: PptxExportStats }> {
  const { slides, v2 } = splitSlides(opts.html)
  const box = v2 ? V2 : LEGACY
  const mod = await import('pptxgenjs')
  const PptxGenJS = (mod as unknown as { default: typeof PptxGenJSType }).default
  const pptx: Pptx = new PptxGenJS()
  pptx.layout = v2 ? 'LAYOUT_16x9' : 'LAYOUT_4x3'
  pptx.title = opts.title
  const stats: PptxExportStats = { slides: 0, textBoxes: 0, shapes: 0, images: 0, decorations: 0, imagesSkipped: 0, layout: v2 ? '16x9' : '4x3' }
  const imgBudget = { count: 0, bytes: 0 }
  const waitBudget = { fontMs: WAIT_FONTS_MS, imgMs: WAIT_IMG_MS }

  const iframe = createExportFrame(box)
  try {
    for (let i = 0; i < slides.length; i++) {
      const slide: Slide = pptx.addSlide()
      await measureDocOntoSlide(pptx, slide, iframe, slideDoc(slides[i], box, v2), { box, v2, place: { x: 0, y: 0, w: box.inW }, setBackground: true, imgBudget, waitBudget, stats, proxy: opts.proxy })
      stats.slides++
      opts.onProgress?.(i + 1, slides.length)
    }
  } finally {
    iframe.remove()
  }
  const blob = await pptx.write({ outputType: 'blob' }) as Blob
  return { blob, stats }
}

/** 量页用的隐藏 iframe（同源可读 DOM·不跑任何脚本） */
export function createExportFrame(box: { w: number; h: number }): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')   // 同源可读 DOM·不跑任何脚本
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = `position:fixed;left:-${box.w * 3}px;top:0;width:${box.w}px;height:${box.h}px;border:0;opacity:0;pointer-events:none;z-index:-1`
  document.body.appendChild(iframe)
  return iframe
}

export type MeasureBudget = { imgBudget: { count: number; bytes: number }; waitBudget: { fontMs: number; imgMs: number }; stats: PptxExportStats; proxy?: ExportMediaProxy }
export function newMeasureBudget(layout: '16x9' | '4x3', proxy?: ExportMediaProxy): MeasureBudget {
  return { imgBudget: { count: 0, bytes: 0 }, waitBudget: { fontMs: WAIT_FONTS_MS, imgMs: WAIT_IMG_MS }, stats: { slides: 0, textBoxes: 0, shapes: 0, images: 0, decorations: 0, imagesSkipped: 0, layout }, proxy }
}

/**
 * 把一份文件（一页）量进投影片：place＝放在投影片上的位置（英寸·x／y 是左上·w 是宽·高按比例）。
 * 整页导出 place＝整张投影片；组件版的 html 组件place＝那个组件的框。
 */
export async function measureDocOntoSlide(
  pptx: Pptx, slide: Slide, iframe: HTMLIFrameElement, docHtml: string,
  o: { box: { w: number; h: number }; v2: boolean; place: { x: number; y: number; w: number }; setBackground: boolean } & MeasureBudget,
): Promise<void> {
  iframe.style.width = `${o.box.w}px`; iframe.style.height = `${o.box.h}px`
  await new Promise<void>(resolve => { iframe.onload = () => resolve(); iframe.srcdoc = docHtml })
  const win = iframe.contentWindow
  if (!win) throw new Error('export frame unavailable')
  await waitReady(win, o.waitBudget)
  const d = win.document
  const section = d.querySelector('section.slide, div.slide, [data-pptx-root]') ?? d.body
  const root = (o.v2 ? section.querySelector('.sk-stage') : null) ?? section
  const rootRect = root.getBoundingClientRect()
  const inPerPx = o.place.w / (rootRect.width || o.box.w)
  const c: Ctx = { win, root, rootRect, inPerPx, ptPerPx: inPerPx * 72, slideBg: pageBackground(win, root), lang: d.documentElement.lang || 'zh-TW', items: [], order: 0, imgBudget: o.imgBudget, proxy: o.proxy, stats: o.stats }
  collect(c, root, [], 1)
  if (o.setBackground) slide.background = { color: c.slideBg ?? 'FFFFFF' }
  const dx = o.place.x, dy = o.place.y
  // 图片要先取（异步）·再按 z 序一次放进投影片
  const resolved = await Promise.all(c.items.map(async it => (it.kind === 'image' ? { it, img: await it.job() } : { it, img: null })))
  resolved.sort((a, b) => cmpKey(a.it.z, b.it.z))
  for (const { it, img } of resolved) {
    if (it.kind === 'shape') {
      slide.addShape(it.shape === 'ellipse' ? pptx.ShapeType.ellipse : it.shape === 'roundRect' ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x: dx + it.box.left, y: dy + it.box.top, w: it.box.width, h: it.box.height, ...it.opts })
    } else if (it.kind === 'text') {
      slide.addText(it.runs as Parameters<Slide['addText']>[0], { x: dx + it.box.left, y: dy + it.box.top, w: it.box.width, h: it.box.height, margin: 0, fit: 'none', isTextBox: true, ...it.opts } as Parameters<Slide['addText']>[1])
    } else if (img === 'skip') {
      o.stats.imagesSkipped++
    } else if (img) {
      const decor = it.kind === 'image' && it.decor
      if (decor) o.stats.decorations++; else o.stats.images++
      slide.addImage({ data: img.data, x: dx + img.box.left, y: dy + img.box.top, w: img.box.width, h: img.box.height, objectName: decor ? `decoration ${o.stats.decorations}` : `picture ${o.stats.images}` })
    }
  }
}
