/**
 * 组件清单里的富文字框：资料（段落＋片段）⇄ 可编辑 DOM 的双向转换，外加作用于选区的格式动作（粗体、字号、颜色等）。
 *
 *   画布上⛔ 改字——字只在清单这一格改；本档只在浏览器跑（用 document／Selection）。
 *   资料→DOM：一段＝一个 <div data-p>；片段＝<span>（行内 style 画外观，data-c／data-h／data-f 记原值：
 *     主题记号 theme:accent、字体 id 之类在 DOM 上只剩算好的色值／字体栈，回存时靠原值记号还原）。
 *   DOM→资料：只认**行内** style 与 b/i/u/s/sup/sub 标签（⛔ computed style：框的默认样式挂在编辑框根上，不该被抄进每个片段）；
 *     相邻同格式片段合并；段落对齐／列表／缩进／行距记在段落的 data-* 上。
 *   格式动作照简报 iframe 编辑脚本那套（lib/aislides-utils EDIT_SCRIPT·先抄后造）：行内样式一律落成带 inline style 的 <span>
 *     （execCommand fontSize=7 ⇒ 换 span 的老法子）；段落级（对齐／列表／缩进）改段落 div 的 data-*。
 */

import type { ColorValue, FontValue, ListStyle, TextAlign, TextBox, TextParagraph, TextRun } from '../kit/components/types'
import { COMPONENT_LIMITS } from '../kit/components/types'
import { resolveColor, resolveFontStack, type ResolveCtx } from '../kit/components/resolve'
import { findFont, findFontByFamily } from '../../shared/fonts/catalog'

const UL_MARK: Record<string, string> = { disc: '•', circle: '◦', square: '▪' }

function toAlpha(n: number): string {
  let s = ''
  let x = n
  do { s = String.fromCharCode(97 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26) } while (x > 0)
  return s
}
function toRoman(n: number): string {
  const t: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let x = Math.max(1, Math.min(3999, n)); let s = ''
  for (const [v, r] of t) while (x >= v) { s += r; x -= v }
  return s
}

/* ------------------------------------------------------------------ */
/* 颜色小工具                                                          */
/* ------------------------------------------------------------------ */

/** CSS 色值（#rgb／#rrggbb／rgb()／rgba()）⇒ '#RRGGBB'（'#RRGGBBAA' 带透明）；透明／认不出 ⇒ null */
export function cssColorToHex(v: string | null | undefined): `#${string}` | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (!s || s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'currentcolor') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    return `#${full.toUpperCase()}`
  }
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*(?:\.\d+)?)\s*)?\)$/.exec(s)
  if (!m) return null
  const to2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()
  const a = m[4] === undefined || m[4] === '' ? 1 : Number(m[4])
  if (!(a > 0)) return null
  const base = `#${to2(Number(m[1]))}${to2(Number(m[2]))}${to2(Number(m[3]))}`
  return (a >= 1 ? base : `${base}${to2(a * 255)}`) as `#${string}`
}

/* ------------------------------------------------------------------ */
/* 资料 ⇒ DOM                                                          */
/* ------------------------------------------------------------------ */

function paragraphMarkers(paragraphs: readonly { list?: ListStyle; indent?: number }[]): Array<string | null> {
  const out: Array<string | null> = []
  const counters = new Map<number, number>()
  for (const p of paragraphs) {
    const ind = p.indent ?? 0
    if (!p.list) { counters.clear(); out.push(null); continue }
    if (p.list.kind === 'ul') { out.push(UL_MARK[p.list.style] ?? '•'); continue }
    const n = (counters.get(ind) ?? 0) + 1
    counters.set(ind, n)
    for (const k of [...counters.keys()]) if (k > ind) counters.delete(k)
    out.push(p.list.style === 'lower-alpha' ? `${toAlpha(n)}.` : p.list.style === 'lower-roman' ? `${toRoman(n)}.` : `${n}.`)
  }
  return out
}

/** 段落 div 的外观（对齐／缩进／列表标记位／行距）照 data-* 重画——编辑中改了列表或缩进也调它 */
export function paintParagraphs(root: HTMLElement): void {
  const blocks = paragraphElements(root)
  const metas = blocks.map((el) => ({ list: parseListAttr(el.getAttribute('data-list')), indent: clampIndent(Number(el.getAttribute('data-indent') ?? 0)) }))
  const marks = paragraphMarkers(metas)
  blocks.forEach((el, i) => {
    const align = (el.getAttribute('data-align') ?? '') as TextAlign | ''
    el.style.textAlign = align === 'distribute' ? 'justify' : align
    el.style.textAlignLast = align === 'distribute' ? 'justify' : ''
    const ind = metas[i].indent
    const mark = marks[i]
    el.style.paddingLeft = ind || mark ? `${ind * 1.5 + (mark ? 1.4 : 0)}em` : ''
    el.style.position = 'relative'
    el.style.setProperty('--slc-ind', String(ind))
    if (mark) el.setAttribute('data-marker', mark)
    else el.removeAttribute('data-marker')
    const lh = el.getAttribute('data-lh')
    el.style.lineHeight = lh ? lh : ''
  })
}

function runSpan(doc: Document, r: TextRun, ctx: ResolveCtx): HTMLElement | Text {
  const text = doc.createTextNode(r.text)
  const style: Record<string, string> = {}
  if (r.bold !== undefined) style.fontWeight = r.bold ? '700' : '400'
  if (r.italic !== undefined) style.fontStyle = r.italic ? 'italic' : 'normal'
  const deco = [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  if (deco) style.textDecorationLine = deco
  if (r.sup) { style.verticalAlign = 'super'; style.fontSize = '0.7em' }
  else if (r.sub) { style.verticalAlign = 'sub'; style.fontSize = '0.7em' }
  if (r.color) style.color = resolveColor(r.color, ctx, 'inherit')
  if (r.highlight) style.backgroundColor = resolveColor(r.highlight, ctx, 'transparent')
  if (r.font) style.fontFamily = resolveFontStack(r.font, ctx)
  if (typeof r.size === 'number' && !r.sup && !r.sub) style.fontSize = `${r.size}px`
  if (r.shadow) style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.35)'
  if (Object.keys(style).length === 0) return text
  const span = doc.createElement('span')
  for (const [k, v] of Object.entries(style)) (span.style as unknown as Record<string, string>)[k] = v
  // 原值记号：DOM 上只有算好的值，回存时靠这几个 data-* 还原主题记号／字体 id
  if (r.color) { span.setAttribute('data-c', r.color); span.setAttribute('data-cv', span.style.color) }
  if (r.highlight) { span.setAttribute('data-h', r.highlight); span.setAttribute('data-hv', span.style.backgroundColor) }
  if (r.font) { span.setAttribute('data-f', r.font); span.setAttribute('data-fv', span.style.fontFamily) }
  span.appendChild(text)
  return span
}

/** 资料 ⇒ 编辑框 DOM（整框换掉） */
export function renderParagraphs(root: HTMLElement, paragraphs: readonly TextParagraph[], ctx: ResolveCtx): void {
  const doc = root.ownerDocument
  root.textContent = ''
  const list = paragraphs.length ? paragraphs : [{ runs: [] } as TextParagraph]
  for (const p of list) {
    const div = doc.createElement('div')
    div.setAttribute('data-p', '1')
    if (p.align) div.setAttribute('data-align', p.align)
    if (p.list) div.setAttribute('data-list', `${p.list.kind}:${p.list.style}`)
    if (p.indent) div.setAttribute('data-indent', String(clampIndent(p.indent)))
    if (p.lineHeight) div.setAttribute('data-lh', String(p.lineHeight))
    const runs = (p.runs ?? []).filter((r) => r && typeof r.text === 'string' && r.text.length > 0)
    if (runs.length === 0) div.appendChild(doc.createElement('br'))
    else for (const r of runs) div.appendChild(runSpan(doc, r, ctx))
    root.appendChild(div)
  }
  paintParagraphs(root)
}

/** 编辑框根的默认外观（＝文字框 box：字体、字号、颜色、粗斜、行距）——片段没写的就继承它 */
export function boxRootStyle(box: TextBox, ctx: ResolveCtx): Record<string, string> {
  return {
    fontFamily: resolveFontStack(box.font, ctx),
    fontSize: `${box.size}px`,
    color: resolveColor(box.color, ctx, ctx.palette.text),
    fontWeight: box.bold ? '700' : '400',
    fontStyle: box.italic ? 'italic' : 'normal',
    lineHeight: String(box.lineHeight > 0 ? box.lineHeight : 1.45),
    ...(box.letterSpacing ? { letterSpacing: `${box.letterSpacing}px` } : {}),
    textAlign: box.align === 'distribute' ? 'justify' : box.align,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  }
}

/* ------------------------------------------------------------------ */
/* DOM ⇒ 资料                                                          */
/* ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'SECTION', 'ARTICLE', 'TABLE', 'TR'])
const isBlock = (n: Node): n is HTMLElement => n.nodeType === 1 && BLOCK_TAGS.has((n as HTMLElement).tagName)

function clampIndent(n: number): number { return Number.isFinite(n) ? Math.max(0, Math.min(8, Math.round(n))) : 0 }

function parseListAttr(v: string | null): ListStyle | undefined {
  if (!v) return undefined
  const [k, st] = v.split(':')
  if (k === 'ul' && (st === 'disc' || st === 'circle' || st === 'square')) return { kind: 'ul', style: st }
  if (k === 'ol' && (st === 'decimal' || st === 'lower-alpha' || st === 'lower-roman')) return { kind: 'ol', style: st }
  return undefined
}

/**
 * 编辑框里的「段落元素」清单：根的直接子块；打字时浏览器可能直接往根里塞裸字或 <br>、贴上时可能嵌套块——
 * 裸行内节点就地包进 <div data-p>，嵌套块拆平（每个最内层块各算一段）。
 */
export function paragraphElements(root: HTMLElement): HTMLElement[] {
  const doc = root.ownerDocument
  // 裸行内节点 ⇒ 包起来
  let pending: Node[] = []
  const flush = (before: Node | null) => {
    if (!pending.length) return
    const onlyBr = pending.every((n) => n.nodeType === 1 && (n as HTMLElement).tagName === 'BR')
    const div = doc.createElement('div')
    div.setAttribute('data-p', '1')
    root.insertBefore(div, before)
    for (const n of pending) div.appendChild(n)
    if (onlyBr && pending.length > 1) while (div.childNodes.length > 1) div.removeChild(div.lastChild!)
    pending = []
  }
  for (const n of Array.from(root.childNodes)) {
    if (isBlock(n)) { flush(n); continue }
    if (n.nodeType === 3 && !(n.textContent ?? '').length) { root.removeChild(n); continue }
    pending.push(n)
  }
  flush(null)
  const out: HTMLElement[] = []
  const walk = (el: HTMLElement) => {
    const innerBlocks = Array.from(el.childNodes).filter(isBlock)
    if (innerBlocks.length === 0) { out.push(el); return }
    // 块里又有块（贴上的 <ul><li>…）：每个最内层块各算一段；块旁边的裸字自成一段
    let buf: Node[] = []
    const emit = () => {
      if (!buf.length) return
      const div = doc.createElement('div'); div.setAttribute('data-p', '1')
      el.insertBefore(div, buf[0])
      for (const n of buf) div.appendChild(n)
      out.push(div); buf = []
    }
    for (const n of Array.from(el.childNodes)) {
      if (isBlock(n)) { emit(); walk(n) } else if (!(n.nodeType === 3 && !(n.textContent ?? '').trim())) buf.push(n)
    }
    emit()
  }
  for (const n of Array.from(root.childNodes)) if (isBlock(n)) walk(n)
  return out
}

type Marks = Omit<TextRun, 'text'>

/** 一个元素自己（行内 style＋标签）带的格式；只填还没被内层定下来的键 */
function marksOf(el: HTMLElement, into: Marks, ctx: ResolveCtx): void {
  const tag = el.tagName
  const st = el.style
  const set = <K extends keyof Marks>(k: K, v: Marks[K]) => { if (into[k] === undefined && v !== undefined) into[k] = v }
  // 粗斜底删
  const fw = st.fontWeight
  if (fw) set('bold', fw === 'bold' || fw === 'bolder' || Number(fw) >= 600)
  else if (tag === 'B' || tag === 'STRONG') set('bold', true)
  const fs = st.fontStyle
  if (fs) set('italic', fs === 'italic' || fs === 'oblique')
  else if (tag === 'I' || tag === 'EM') set('italic', true)
  const deco = `${st.textDecorationLine || ''} ${st.textDecoration || ''}`
  if (deco.includes('underline') || tag === 'U') set('underline', true)
  if (deco.includes('line-through') || tag === 'S' || tag === 'STRIKE' || tag === 'DEL') set('strike', true)
  const va = st.verticalAlign
  if (va === 'super' || tag === 'SUP') { if (into.sub === undefined) set('sup', true) }
  if (va === 'sub' || tag === 'SUB') { if (into.sup === undefined) set('sub', true) }
  // 颜色（先认原值记号：显示值没被改过＝沿用记号）
  const rawC = el.getAttribute('data-c'), rawCv = el.getAttribute('data-cv')
  const color = st.color || (tag === 'FONT' ? el.getAttribute('color') ?? '' : '')
  if (color && into.color === undefined) {
    if (rawC && rawCv === st.color) into.color = rawC as ColorValue
    else { const h = cssColorToHex(color); if (h) into.color = h }
  }
  const rawH = el.getAttribute('data-h'), rawHv = el.getAttribute('data-hv')
  const bg = st.backgroundColor
  if (bg && into.highlight === undefined) {
    if (rawH && rawHv === bg) into.highlight = rawH as ColorValue
    else { const h = cssColorToHex(bg); if (h) into.highlight = h }
  }
  const rawF = el.getAttribute('data-f'), rawFv = el.getAttribute('data-fv')
  const ff = st.fontFamily
  if (ff && into.font === undefined) {
    if (rawF && rawFv === ff) into.font = rawF as FontValue
    else {
      const first = ff.split(',')[0]
      const hit = findFontByFamily(first)
      if (hit) into.font = hit.id
      else if (ff === resolveFontStack('theme:heading', ctx)) into.font = 'theme:heading'
      else if (ff === resolveFontStack('theme:body', ctx)) into.font = 'theme:body'
    }
  }
  const fsz = st.fontSize
  if (fsz && into.size === undefined && /px$/.test(fsz)) {
    const n = parseFloat(fsz)
    if (Number.isFinite(n)) into.size = Math.max(COMPONENT_LIMITS.fontSizeMin, Math.min(COMPONENT_LIMITS.fontSizeMax, Math.round(n * 10) / 10))
  }
  const ts = st.textShadow
  if (ts && into.shadow === undefined) into.shadow = ts !== 'none'
}

const MARK_KEYS: Array<keyof Marks> = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'color', 'highlight', 'font', 'size', 'shadow']

function sameMarks(a: Marks, b: Marks): boolean {
  return MARK_KEYS.every((k) => a[k] === b[k])
}

function cleanMarks(m: Marks): Marks {
  const out: Marks = {}
  for (const k of MARK_KEYS) {
    const v = m[k]
    if (v === undefined || v === false) continue   // false＝没开（bold:false 只在盖过框默认粗体时有意义·下面单独留）
    ;(out as Record<string, unknown>)[k] = v
  }
  if (m.bold === false) out.bold = false            // 框默认粗、这段特意取消粗
  if (m.italic === false) out.italic = false
  return out
}

/** 编辑框 DOM ⇒ 段落资料 */
export function readParagraphs(root: HTMLElement, ctx: ResolveCtx): TextParagraph[] {
  const blocks = paragraphElements(root)
  const out: TextParagraph[] = []
  for (const block of blocks) {
    const runs: TextRun[] = []
    const push = (text: string, marks: Marks) => {
      if (!text) return
      const m = cleanMarks(marks)
      const last = runs[runs.length - 1]
      if (last && sameMarks(cleanMarks(last), m)) last.text += text
      else runs.push({ text, ...m })
    }
    const walk = (node: Node, inherited: Element[]) => {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? '').replace(/​/g, '')
        if (!text) return
        const marks: Marks = {}
        for (let i = inherited.length - 1; i >= 0; i--) marksOf(inherited[i] as HTMLElement, marks, ctx)
        push(text, marks)
        return
      }
      if (node.nodeType !== 1) return
      const el = node as HTMLElement
      if (el.tagName === 'BR') {
        // 段尾占位 <br>（空段／段尾）不算字；段中间的 <br> ＝段内换行
        const isLast = !el.nextSibling || (el.nextSibling.nodeType === 3 && !(el.nextSibling.textContent ?? '').length && !el.nextSibling.nextSibling)
        if (!isLast) {
          const marks: Marks = {}
          for (let i = inherited.length - 1; i >= 0; i--) marksOf(inherited[i] as HTMLElement, marks, ctx)
          push('\n', marks)
        }
        return
      }
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return
      for (const c of Array.from(el.childNodes)) walk(c, [...inherited, el])
    }
    for (const c of Array.from(block.childNodes)) walk(c, [])
    const p: TextParagraph = { runs }
    const align = block.getAttribute('data-align') as TextAlign | null
    if (align && ['left', 'center', 'right', 'justify', 'distribute'].includes(align)) p.align = align
    const list = parseListAttr(block.getAttribute('data-list'))
    if (list) p.list = list
    const ind = clampIndent(Number(block.getAttribute('data-indent') ?? 0))
    if (ind) p.indent = ind
    const lh = Number(block.getAttribute('data-lh'))
    if (lh >= 0.8 && lh <= 4) p.lineHeight = lh
    out.push(p)
  }
  return out.length ? out : [{ runs: [] }]
}

/* ------------------------------------------------------------------ */
/* 格式动作（编辑框里的当前选区）                                        */
/* ------------------------------------------------------------------ */

export type RichSelState = {
  hasSel?: boolean; inText?: boolean
  b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean; ul?: boolean; ol?: boolean
  align?: string; font?: string; size?: number; shadow?: boolean
}

function selectionIn(root: HTMLElement): Range | null {
  const sel = root.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  return root.contains(r.commonAncestorContainer) ? r : null
}

function anchorEl(root: HTMLElement): HTMLElement | null {
  const r = selectionIn(root)
  if (!r) return null
  const n = r.startContainer
  const el = n.nodeType === 1 ? (n as HTMLElement) : n.parentElement
  return el && root.contains(el) ? el : null
}

/** 选区碰到的段落 div（没有选区＝空） */
export function selectedParagraphs(root: HTMLElement): HTMLElement[] {
  const r = selectionIn(root)
  if (!r) return []
  const blocks = paragraphElements(root)
  return blocks.filter((b) => r.intersectsNode(b))
}

function styleEl(el: HTMLElement, styles: Record<string, string>): void {
  for (const [k, v] of Object.entries(styles)) (el.style as unknown as Record<string, string>)[k] = v
}

/** 给选区包一层带 inline style 的 span；选区折叠时改光标所在元素（下一段输入沿用） */
function wrapSelection(root: HTMLElement, styles: Record<string, string>, raw?: Record<string, string>): boolean {
  const doc = root.ownerDocument
  const r = selectionIn(root)
  if (!r) return false
  const sel = doc.getSelection()!
  if (sel.isCollapsed) {
    const el = anchorEl(root)
    if (!el || el === root) return false
    if (el.hasAttribute('data-p')) {
      // 光标停在段落本身（空段）：塞一个空 span 接住下一段输入
      const sp = doc.createElement('span'); styleEl(sp, styles)
      if (raw) for (const [k, v] of Object.entries(raw)) sp.setAttribute(k, v)
      sp.appendChild(doc.createTextNode('​'))
      r.insertNode(sp)
      const nr = doc.createRange(); nr.setStart(sp.firstChild!, 1); nr.collapse(true)
      sel.removeAllRanges(); sel.addRange(nr)
      return true
    }
    styleEl(el, styles)
    if (raw) for (const [k, v] of Object.entries(raw)) el.setAttribute(k, v)
    return true
  }
  doc.execCommand('styleWithCSS', false, 'false')
  doc.execCommand('fontSize', false, '7')
  const fonts = Array.from(root.querySelectorAll('font[size="7"]')) as HTMLElement[]
  for (const f of fonts) {
    const sp = doc.createElement('span')
    while (f.firstChild) sp.appendChild(f.firstChild)
    if (f.getAttribute('style')) sp.setAttribute('style', f.getAttribute('style')!)
    styleEl(sp, styles)
    if (raw) for (const [k, v] of Object.entries(raw)) sp.setAttribute(k, v)
    f.parentNode!.replaceChild(sp, f)
    // 内层旧的同类行内值要让位（不然内层 span 的旧字号／颜色盖过这次设的）
    for (const inner of Array.from(sp.querySelectorAll('span')) as HTMLElement[]) {
      for (const k of Object.keys(styles)) (inner.style as unknown as Record<string, string>)[k] = ''
      if (raw) for (const k of Object.keys(raw)) { inner.removeAttribute(k); inner.removeAttribute(`${k}v`) }
    }
  }
  doc.execCommand('styleWithCSS', false, 'true')
  return fonts.length > 0
}

function curFontPx(root: HTMLElement): number {
  const el = anchorEl(root) ?? root
  const v = parseFloat(getComputedStyle(el).fontSize)
  return Number.isFinite(v) ? v : 24
}

/**
 * 做一个格式动作（cmd／value 与 SlidesFormatToolbar 发的同一套）。回：有没有真的改到。
 * ctx 用来把字体 id 解成字体栈、主题色记号解成色值。
 */
export function applyFormat(root: HTMLElement, cmd: string, value: string | number | undefined, ctx: ResolveCtx): boolean {
  const doc = root.ownerDocument
  if (!selectionIn(root)) return false
  const exec = (c: string, v?: string) => { doc.execCommand('styleWithCSS', false, 'true'); return doc.execCommand(c, false, v) }
  switch (cmd) {
    case 'bold': case 'italic': case 'underline': case 'strikeThrough': case 'superscript': case 'subscript':
      return exec(cmd)
    case 'removeFormat': {
      exec('removeFormat')
      for (const p of selectedParagraphs(root)) {
        p.removeAttribute('data-align')
        for (const sp of Array.from(p.querySelectorAll('[data-c],[data-h],[data-f]'))) {
          for (const a of ['data-c', 'data-cv', 'data-h', 'data-hv', 'data-f', 'data-fv']) sp.removeAttribute(a)
        }
      }
      paintParagraphs(root)
      return true
    }
    case 'justifyLeft': case 'justifyCenter': case 'justifyRight': case 'justifyFull': case 'justifyDistribute': {
      const align = cmd === 'justifyLeft' ? 'left' : cmd === 'justifyCenter' ? 'center' : cmd === 'justifyRight' ? 'right' : cmd === 'justifyFull' ? 'justify' : 'distribute'
      const ps = selectedParagraphs(root)
      for (const p of ps) p.setAttribute('data-align', align)
      paintParagraphs(root)
      return ps.length > 0
    }
    case 'fontName': {
      const id = String(value ?? '')
      if (!id) return wrapSelection(root, { fontFamily: resolveFontStack('theme:body', ctx) }, { 'data-f': 'theme:body' })
      const f = findFont(id)
      if (!f) return false
      return wrapSelection(root, { fontFamily: f.stack }, { 'data-f': f.id })
    }
    case 'fontSize': {
      const px = Math.max(COMPONENT_LIMITS.fontSizeMin, Math.min(COMPONENT_LIMITS.fontSizeMax, Number(value) || 0))
      return px > 0 && wrapSelection(root, { fontSize: `${px}px` })
    }
    case 'sizeStep': {
      const px = Math.max(COMPONENT_LIMITS.fontSizeMin, Math.min(COMPONENT_LIMITS.fontSizeMax, Math.round(curFontPx(root) + (Number(value) || 0))))
      return wrapSelection(root, { fontSize: `${px}px` })
    }
    case 'foreColor': {
      const hex = cssColorToHex(String(value ?? ''))
      return !!hex && wrapSelection(root, { color: hex })
    }
    case 'hiliteColor': {
      const hex = cssColorToHex(String(value ?? ''))
      return !!hex && wrapSelection(root, { backgroundColor: hex })
    }
    case 'shadow': {
      const el = anchorEl(root)
      const has = !!el && getComputedStyle(el).textShadow !== 'none'
      return wrapSelection(root, { textShadow: has ? 'none' : '1px 1px 2px rgba(0, 0, 0, 0.35)' })
    }
    case 'list': {
      const v = String(value ?? '')
      const list = parseListAttr(v)
      if (!list) return false
      const ps = selectedParagraphs(root)
      const allSame = ps.length > 0 && ps.every((p) => p.getAttribute('data-list') === v)
      for (const p of ps) { if (allSame) p.removeAttribute('data-list'); else p.setAttribute('data-list', v) }
      paintParagraphs(root)
      return ps.length > 0
    }
    case 'indent': case 'outdent': {
      const ps = selectedParagraphs(root)
      for (const p of ps) {
        const n = clampIndent(Number(p.getAttribute('data-indent') ?? 0) + (cmd === 'indent' ? 1 : -1))
        if (n) p.setAttribute('data-indent', String(n)); else p.removeAttribute('data-indent')
      }
      paintParagraphs(root)
      return ps.length > 0
    }
    default:
      return false
  }
}

/** 格式刷：记下选区处的行内外观（8 项）；套用时对新选区 wrapSelection */
export type PainterStyle = Record<string, string>
export function copyFormatAt(root: HTMLElement): PainterStyle | null {
  const el = anchorEl(root)
  if (!el) return null
  const cs = getComputedStyle(el)
  return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, textDecorationLine: cs.textDecorationLine, color: cs.color, backgroundColor: cs.backgroundColor, textShadow: cs.textShadow }
}
export function pasteFormat(root: HTMLElement, st: PainterStyle): boolean {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(st)) if (v && v !== 'normal' && v !== 'none' && v !== 'rgba(0, 0, 0, 0)') clean[k] = v
  return wrapSelection(root, clean)
}

/** 工具栏高亮用的选区状态 */
export function readSelState(root: HTMLElement): RichSelState {
  const doc = root.ownerDocument
  const r = selectionIn(root)
  if (!r) return {}
  const el = anchorEl(root) ?? root
  const cs = getComputedStyle(el)
  const q = (c: string) => { try { return doc.queryCommandState(c) } catch { return false } }
  const p = selectedParagraphs(root)[0]
  const list = p?.getAttribute('data-list') ?? ''
  return {
    hasSel: !r.collapsed, inText: true,
    b: q('bold'), i: q('italic'), u: q('underline'), s: q('strikeThrough'), sup: q('superscript'), sub: q('subscript'),
    ul: list.startsWith('ul:'), ol: list.startsWith('ol:'),
    align: p?.getAttribute('data-align') ?? (getComputedStyle(root).textAlign || 'left'),
    font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
    size: Math.round(parseFloat(cs.fontSize)),
    shadow: cs.textShadow !== 'none',
  }
}

/** 编辑框用的样式（段落列表标记用 ::before 画·只在编辑框里生效） */
export const RICH_EDITOR_CSS = `
.slc-rich [data-p][data-marker]::before{content:attr(data-marker);position:absolute;left:calc(var(--slc-ind,0) * 1.5em);width:1.4em}
.slc-rich [data-p]{min-height:1em}
.slc-rich:focus{outline:none}
`
