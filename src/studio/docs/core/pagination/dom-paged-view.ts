// 云文档真分页·静态 DOM 版
//
// 分享页正文是 react-markdown 渲的静态 HTML（不是 tiptap）⇒ 这里直接对 DOM 量、直接插垫片（同一套 paginate() 纯函数、
//   同一套垫片样式 calc(c + g × --pg-gap)）⇒ 这一页自己的画面＝它的打印。
//   每轮：先拆掉上轮垫片（合并被切开的文字节点）⇒ 量自然坐标 ⇒ paginate ⇒ 插垫片 ⇒ 逐个校准（量实际位置、把垫片补到正好贴页顶）。
//   只插/删带 .doc-pg-spacer 的自有节点；被切开的文字节点在下一轮 normalize() 合回（React 持有的首段节点不变）。

import { paginate, type SliceAnchor, type SliceGroup, type Slice } from './paginate'

export type StaticPagedGeometry = { pageH: number; marginTop: number; contentH: number; gap: number }

type Point =
  | { kind: 'inline'; node: Text; offset: number }
  | { kind: 'block'; before: Element }
  | { kind: 'row'; before: HTMLTableRowElement; cols: number }

const TEXT_BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'LI', 'DT', 'DD'])
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV', 'TABLE', 'HR', 'FIGURE', 'SECTION', 'DETAILS', 'DL', 'DT', 'DD'])
const CONTAINER_TAGS = new Set(['UL', 'OL', 'BLOCKQUOTE', 'DIV', 'SECTION', 'DETAILS', 'DL', 'LI'])

const isSpacer = (n: Node | null) => n instanceof Element && n.classList.contains('doc-pg-spacer')
const hasBlockChild = (el: Element) => Array.from(el.children).some(c => BLOCK_TAGS.has(c.tagName) && !isSpacer(c))

export function removeStaticSpacers(root: HTMLElement): void {
  const parents = new Set<Node>()
  root.querySelectorAll('.doc-pg-spacer').forEach(s => { if (s.parentNode) parents.add(s.parentNode); s.remove() })
  parents.forEach(p => (p as Element).normalize())
}

function textNodes(el: Element): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) if ((n as Text).data.length > 0) out.push(n as Text)
  return out
}

function lineRects(el: Element): { gTop: number; gBottom: number }[] {
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = Array.from(range.getClientRects()).filter(r => r.height > 0 && r.width > 0).sort((a, b) => a.top - b.top)
  const lines: { gTop: number; gBottom: number }[] = []
  for (const r of rects) {
    const last = lines[lines.length - 1]
    if (last && r.top < last.gBottom - Math.min(r.height, last.gBottom - last.gTop) / 2) {
      last.gTop = Math.min(last.gTop, r.top); last.gBottom = Math.max(last.gBottom, r.bottom)
    } else lines.push({ gTop: r.top, gBottom: r.bottom })
  }
  return lines
}

// 该行第一个字的 (文字节点, 偏移)：全块字符序上二分「字的顶 ≥ 行顶」
function lineStartPoint(el: Element, gTop: number): { node: Text; offset: number } | null {
  const nodes = textNodes(el)
  const idx: { node: Text; start: number }[] = []
  let total = 0
  for (const n of nodes) { idx.push({ node: n, start: total }); total += n.data.length }
  if (total === 0) return null
  const at = (i: number) => { let k = idx.length - 1; while (k > 0 && idx[k].start > i) k--; return { node: idx[k].node, offset: i - idx[k].start } }
  const range = document.createRange()
  const topOf = (i: number) => {
    const p = at(i)
    range.setStart(p.node, p.offset); range.setEnd(p.node, Math.min(p.node.data.length, p.offset + 1))
    const r = range.getClientRects()[0] ?? range.getBoundingClientRect()
    return r.height > 0 ? r.top : -Infinity
  }
  let lo = 0, hi = total - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (topOf(mid) >= gTop - 1) hi = mid; else lo = mid + 1 }
  return at(lo)
}

function effMargin(el: Element, side: 'top' | 'bottom'): number {
  let m = 0
  let cur: Element | null = el
  for (let i = 0; cur && i < 4; i++) {
    const cs = getComputedStyle(cur)
    m = Math.max(m, parseFloat(side === 'top' ? cs.marginTop : cs.marginBottom) || 0)
    if ((side === 'top' ? cs.paddingTop : cs.paddingBottom) !== '0px') break
    cur = side === 'top' ? cur.firstElementChild : cur.lastElementChild
  }
  return m
}

type Ctx = { top0: number; points: Point[]; groups: SliceGroup[] }

function anchorFor(ctx: Ctx, p: Point, extra?: Omit<Extract<SliceAnchor, { kind: 'block' }>, 'kind' | 'pos'>): SliceAnchor {
  ctx.points.push(p)
  const pos = ctx.points.length - 1
  if (p.kind === 'inline') return { kind: 'inline', pos }
  if (p.kind === 'row') return { kind: 'row', pos, cols: p.cols }
  return { kind: 'block', pos, prevBottom: extra!.prevBottom, marginSum: extra!.marginSum }
}

function visitChildren(ctx: Ctx, parent: Element, firstAnchor: SliceAnchor | null): void {
  let prev: Element | null = null
  for (const child of Array.from(parent.children)) {
    if (isSpacer(child)) continue
    const r = child.getBoundingClientRect()
    if (r.height === 0 && r.width === 0) continue
    const anchor = prev === null ? firstAnchor : anchorFor(ctx, { kind: 'block', before: child }, {
      prevBottom: prev.getBoundingClientRect().bottom - ctx.top0,
      marginSum: effMargin(prev, 'bottom') + effMargin(child, 'top'),
    })
    visit(ctx, child, anchor)
    prev = child
  }
}

function visit(ctx: Ctx, el: Element, anchor: SliceAnchor | null): void {
  const rect = el.getBoundingClientRect()
  const top = rect.top - ctx.top0, bottom = rect.bottom - ctx.top0
  const table = el.tagName === 'TABLE' ? el as HTMLTableElement : (el.children.length === 1 && el.firstElementChild?.tagName === 'TABLE' ? el.firstElementChild as HTMLTableElement : null)
  if (table) {
    const rows = Array.from(table.rows)
    const cols = rows[0] ? Array.from(rows[0].cells).reduce((n, c) => n + (c.colSpan || 1), 0) : 1
    rows.forEach((tr, i) => {
      const rr = tr.getBoundingClientRect()
      const a = i === 0 ? anchor : anchorFor(ctx, { kind: 'row', before: tr, cols: Math.max(1, cols) })
      ctx.groups.push({ top: rr.top - ctx.top0, bottom: rr.bottom - ctx.top0, anchor: a, keepWithNext: i === 0 && rows.length > 1 })
    })
    return
  }
  if (CONTAINER_TAGS.has(el.tagName) && hasBlockChild(el)) { visitChildren(ctx, el, anchor); return }
  if (TEXT_BLOCK_TAGS.has(el.tagName) || (el.tagName === 'BLOCKQUOTE' && !hasBlockChild(el))) {
    ctx.groups.push({
      top, bottom, anchor, keepWithNext: HEADING_TAGS.has(el.tagName),
      expand: () => {
        const lines = lineRects(el)
        const cs = getComputedStyle(el)
        const fs = parseFloat(cs.fontSize) || 15
        const lh = cs.lineHeight === 'normal' ? fs * 1.2 : (parseFloat(cs.lineHeight) || fs * 1.2)
        const out: Slice[] = []
        lines.forEach((ln, i) => {
          const half = Math.max(0, (lh - (ln.gBottom - ln.gTop)) / 2)
          let a: SliceAnchor | null = anchor
          if (i > 0) {
            const pt = lineStartPoint(el, ln.gTop)
            if (!pt) return
            a = anchorFor(ctx, { kind: 'inline', node: pt.node, offset: pt.offset })
          }
          out.push({
            top: (i === 0 ? rect.top : ln.gTop - half) - ctx.top0,
            bottom: (i === lines.length - 1 ? Math.max(ln.gBottom, Math.min(ln.gBottom + half, rect.bottom)) : ln.gBottom + half) - ctx.top0,
            anchor: a,
          })
        })
        return out
      },
    })
    return
  }
  ctx.groups.push({ top, bottom, anchor })   // 原子块
}

function makeSpacer(kind: Point['kind'], c: number, g: number, cols = 1): HTMLElement {
  const h = `calc(${c.toFixed(3)}px + ${g} * var(--pg-gap, 0px))`
  if (kind === 'row') {
    const tr = document.createElement('tr'); tr.className = 'doc-pg-spacer doc-pg-spacer-row'; tr.setAttribute('aria-hidden', 'true')
    const td = document.createElement('td'); td.colSpan = cols; td.style.height = h; tr.appendChild(td)
    return tr
  }
  const el = document.createElement(kind === 'inline' ? 'span' : 'div')
  el.className = `doc-pg-spacer doc-pg-spacer-${kind}`; el.setAttribute('aria-hidden', 'true'); el.style.height = h
  return el
}

// 对 root（内容容器·顶＝第 1 页纸顶·已带 padding-top＝上边距）分页；回页数。
export function paginateStaticDom(root: HTMLElement, geom: StaticPagedGeometry): number {
  removeStaticSpacers(root)
  // 懒加载图屏外不载 ⇒ 高度 0 ⇒ 分页与列印都会错 ⇒ 立即载入（载完 load 事件再排一次）
  root.querySelectorAll('img[loading="lazy"]').forEach(i => { (i as HTMLImageElement).loading = 'eager' })
  const ctx: Ctx = { top0: root.getBoundingClientRect().top, points: [], groups: [] }
  visitChildren(ctx, root, null)
  const res = paginate(ctx.groups, geom, geom.gap)
  // 插垫片（倒序插·行内切分不影响前面的点）
  const placed: { el: HTMLElement; b: typeof res.breaks[number]; kind: Point['kind'] }[] = []
  for (const b of [...res.breaks].reverse()) {
    const p = ctx.points[b.anchor.pos]
    if (!p) continue
    if (p.kind === 'inline') {
      const target = p.offset > 0 ? p.node.splitText(p.offset) : p.node
      const sp = makeSpacer('inline', b.heightC, b.heightG)
      target.parentNode?.insertBefore(sp, target)
      placed.push({ el: sp, b, kind: 'inline' })
    } else if (p.kind === 'row') {
      const sp = makeSpacer('row', b.heightC, b.heightG, p.cols)
      p.before.parentNode?.insertBefore(sp, p.before)
      placed.push({ el: sp, b, kind: 'row' })
    } else {
      const sp = makeSpacer('block', b.heightC, b.heightG)
      p.before.parentNode?.insertBefore(sp, p.before)
      placed.push({ el: sp, b, kind: 'block' })
    }
  }
  // 校准：从上到下量「垫片后内容的实际顶」对齐到目标页正文顶（估的行距/外距误差在此抹平）
  placed.reverse()
  for (const { el, b, kind } of placed) {
    const target = b.pageIndex * (geom.pageH + geom.gap) + geom.marginTop
    const top0 = root.getBoundingClientRect().top
    let actual: number
    if (kind === 'block') {
      const next = el.nextElementSibling
      if (!next) continue
      actual = next.getBoundingClientRect().top - top0
    } else {
      actual = el.getBoundingClientRect().bottom - top0
    }
    const diff = target - actual
    if (Math.abs(diff) > 0.25) {
      const c = b.heightC + diff
      b.heightC = c
      const td = kind === 'row' ? (el.firstElementChild as HTMLElement) : el
      td.style.height = `calc(${c.toFixed(3)}px + ${b.heightG} * var(--pg-gap, 0px))`
    }
  }
  return res.pageCount
}
