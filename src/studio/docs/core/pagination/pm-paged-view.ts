// 云文档真分页·tiptap 扩展
//
// 做法：编辑仍在同一份 tiptap 文档上（⛔ 拆多份文档）——只在排版层插「分页垫片」装饰（Decoration.widget）：
//   · 段落／标题／代码块跨页 ⇒ 在被切那行的行首插 display:block 的 span（段落照样是一个节点·光标/选取/拖曳不受影响）
//   · 表格跨页 ⇒ 在被切那行之前插一条空的垫片行 tr（行不拆）
//   · 图片／分隔线／公式等整块放不下 ⇒ 在块前插垫片 div（整块到下一页）
//   垫片高度 = calc(c px + g * var(--pg-gap))：画面 gap=PAGE_GAP_PX、打印 gap=0 ⇒ 同一组垫片在画面与打印都把内容送到同一页同一位置。
//   装饰不进文档内容（getHTML/markdown/保存一律看不到）。
//
// 量测：每轮从实际 DOM 量每块的位置，扣掉「已插垫片的实际下移量」还原成自然坐标 ⇒ 交 paginate() 纯函数算断点。
//   签名没变就不派发（防抖动）；打字期间 DecorationSet.map 让垫片随文字走、停手 debounce 后重排（节奏常数在 paginate.ts）。

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { paginate, breaksSignature, PAGINATION_TUNING, type PageBreak, type Slice, type SliceAnchor, type SliceGroup } from './paginate'
import { updateColumns } from '@tiptap/extension-table'
import { tableColumnPercents } from '../pdf-table-widths'
import { PAGE_BREAK_NODE_NAME } from '../page-break'

export type PagedViewGeometry = {
  pageH: number
  marginTop: number
  contentH: number
  gap: number          // 画面上的页缝（px）·量测时用（打印由 CSS 变量归零）
}

type PgSpec = { pg: true; id: string; kind: SliceAnchor['kind']; heightC: number; heightG: number; repeatHead?: boolean }
type PgState = { geom: PagedViewGeometry | null; decos: DecorationSet; sig: string; pageCount: number }
type PgMeta = { geom?: PagedViewGeometry | null; breaks?: PageBreak[]; pageCount?: number }

export const pagedViewKey = new PluginKey<PgState>('dilinPagedView')

let idSeq = 0
const heightCss = (c: number, g: number) => `calc(${c.toFixed(3)}px + ${g} * var(--pg-gap, 0px))`

function spacerDom(b: PageBreak, id: string): HTMLElement {
  // 带重复表头的行垫片：空白段＝总下移扣掉表头高（表头复本另一个 widget 紧接其下）
  const h = heightCss(b.heightC - (b.repeatH || 0), b.heightG)
  if (b.anchor.kind === 'row') {
    const tr = document.createElement('tr')
    tr.className = 'doc-pg-spacer doc-pg-spacer-row'
    tr.dataset.pgId = id
    tr.setAttribute('contenteditable', 'false')
    tr.setAttribute('aria-hidden', 'true')
    const td = document.createElement('td')
    td.colSpan = Math.max(1, b.anchor.cols)
    td.style.height = h
    tr.appendChild(td)
    return tr
  }
  const el = document.createElement(b.anchor.kind === 'inline' ? 'span' : 'div')
  el.className = `doc-pg-spacer doc-pg-spacer-${b.anchor.kind}`
  el.dataset.pgId = id
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  el.style.height = h
  return el
}

// 表头复本：照表头行 DOM 复制一份（去掉拖栏把手／选取态），不可编辑、不进内容。
function repeatHeadDom(view: EditorView, headerPos: number, h: number, id: string): HTMLElement {
  const src = view.nodeDOM(headerPos)
  let tr: HTMLElement
  if (src instanceof HTMLElement && src.tagName === 'TR') {
    tr = src.cloneNode(true) as HTMLElement
    tr.querySelectorAll('.column-resize-handle').forEach(e => e.remove())
    tr.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'))
    tr.querySelectorAll('.selectedCell').forEach(e => e.classList.remove('selectedCell'))
    tr.removeAttribute('data-pg-id')
  } else {
    tr = document.createElement('tr')
    tr.style.height = `${h}px`
  }
  tr.className = 'doc-pg-repeat-head'
  tr.dataset.pgId = id
  tr.setAttribute('contenteditable', 'false')
  tr.setAttribute('aria-hidden', 'true')
  return tr
}

function buildDecos(doc: PMNode, breaks: PageBreak[]): DecorationSet {
  const decos: Decoration[] = []
  for (const b of breaks) {
    const id = `pg${++idSeq}`
    const spec: PgSpec = { pg: true, id, kind: b.anchor.kind, heightC: b.heightC - (b.repeatH || 0), heightG: b.heightG }
    decos.push(Decoration.widget(b.anchor.pos, () => spacerDom(b, id), {
      side: -2, ignoreSelection: true, marks: [], key: `${id}`, ...spec,
    }))
    const rep = b.anchor.kind === 'row' ? b.anchor.repeat : undefined
    if (rep && b.repeatH > 0) {
      const rid = `pg${++idSeq}`
      const rspec: PgSpec = { pg: true, id: rid, kind: 'row', heightC: b.repeatH, heightG: 0, repeatHead: true }
      decos.push(Decoration.widget(b.anchor.pos, (view) => repeatHeadDom(view, rep.headerPos, rep.h, rid), {
        side: -1, ignoreSelection: true, marks: [], key: `${rid}`, ...rspec,
      }))
    }
  }
  return DecorationSet.create(doc, decos)
}

// ── 量测 ────────────────────────────────────────────────────────────────────────────────

type Existing = { pos: number; effect: number }

// 已插垫片的实际下移量（从 DOM 量·不信上一轮的估值）：
//   行内／表格行垫片 = 自身高度；块级垫片 = 自身高度 + min(上缝, 下缝)（插进去后两侧外距不再折叠·多出较小的那段）。
function measureExisting(view: EditorView, state: PgState): Existing[] {
  const out: Existing[] = []
  for (const d of state.decos.find()) {
    const spec = d.spec as PgSpec
    if (!spec?.pg) continue
    const el = view.dom.querySelector(`[data-pg-id="${spec.id}"]`) as HTMLElement | null
    if (!el) continue
    const r = el.getBoundingClientRect()
    let effect = r.height
    if (spec.kind === 'block') {
      const prev = el.previousElementSibling as HTMLElement | null
      const next = el.nextElementSibling as HTMLElement | null
      const above = prev ? Math.max(0, r.top - prev.getBoundingClientRect().bottom) : 0
      const below = next ? Math.max(0, next.getBoundingClientRect().top - r.bottom) : 0
      effect += Math.min(above, below)
    }
    out.push({ pos: d.from, effect })
  }
  out.sort((a, b) => a.pos - b.pos)
  return out
}

// Σ 下移量（pos ≤ p 的垫片）——前缀和＋二分
function makeOffsetAt(existing: Existing[]): (p: number) => number {
  const prefix: number[] = [0]
  for (const e of existing) prefix.push(prefix[prefix.length - 1] + e.effect)
  return (p: number) => {
    let lo = 0, hi = existing.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (existing[mid].pos <= p) lo = mid + 1; else hi = mid }
    return prefix[lo]
  }
}

function effMargin(el: Element, side: 'top' | 'bottom'): number {
  // 外距会穿过首/末子元素折叠：取自身与首（末）子链上的最大正外距（近似·下一轮用实量值收敛）
  let m = 0
  let cur: Element | null = el
  for (let i = 0; cur && i < 4; i++) {
    const cs = getComputedStyle(cur)
    m = Math.max(m, parseFloat(side === 'top' ? cs.marginTop : cs.marginBottom) || 0)
    if (cs.paddingTop !== '0px' && side === 'top') break
    if (cs.paddingBottom !== '0px' && side === 'bottom') break
    cur = side === 'top' ? cur.firstElementChild : cur.lastElementChild
  }
  return m
}

const SPLITTABLE_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'])
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

type Line = { gTop: number; gBottom: number }

// 一个文字块里的行（按文字/行内元素的矩形分组）；垫片自身的矩形剔除。
function measureLines(el: HTMLElement): Line[] {
  const range = document.createRange()
  range.selectNodeContents(el)
  const spacerRects = Array.from(el.querySelectorAll('.doc-pg-spacer')).map(s => s.getBoundingClientRect())
  const rects = Array.from(range.getClientRects())
    .filter(r => r.height > 0 && r.width > 0)
    .filter(r => !spacerRects.some(s => r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5))
    .sort((a, b) => a.top - b.top)
  const lines: Line[] = []
  for (const r of rects) {
    const last = lines[lines.length - 1]
    // 与当前行竖向重叠过半 ⇒ 同一行
    if (last && r.top < last.gBottom - Math.min(r.height, last.gBottom - last.gTop) / 2) {
      last.gTop = Math.min(last.gTop, r.top)
      last.gBottom = Math.max(last.gBottom, r.bottom)
    } else lines.push({ gTop: r.top, gBottom: r.bottom })
  }
  return lines
}

// 行首文档位置：[from,to] 里 coordsAtPos(p,1).top ≥ 该行字形顶 的最小 p（二分）
function lineStartPos(view: EditorView, from: number, to: number, gTop: number): number {
  let lo = from, hi = to
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    let top: number
    try { top = view.coordsAtPos(mid, 1).top } catch { top = -Infinity }
    if (top >= gTop - 1) hi = mid; else lo = mid + 1
  }
  return lo
}

type Ctx = { view: EditorView; pmTop: number; offsetAt: (p: number) => number; existingPos: Set<number>; groups: SliceGroup[] }

function rectOf(view: EditorView, pos: number): { el: HTMLElement; top: number; bottom: number } | null {
  const el = view.nodeDOM(pos)
  if (!(el instanceof HTMLElement)) return null
  const r = el.getBoundingClientRect()
  return { el, top: r.top, bottom: r.bottom }
}

// 块锚：块在 pos；前兄弟 prev（pos/dom）。marginSum：已有块垫片 ⇒ 实量上下缝之和；否则计算样式估。
function blockAnchor(ctx: Ctx, pos: number, el: HTMLElement, prev: { end: number; el: HTMLElement } | null): SliceAnchor | null {
  if (!prev) return null
  // 🔴 prev.end == pos（前兄弟的尾＝本块的头）：本块自己的垫片也挂在 pos 上 ⇒ 前兄弟的底只能扣 pos 之前的垫片（用 end-1），
  //   否则每轮把自己的垫片当成前兄弟的下移扣掉 ⇒ 垫片一轮比一轮高（真跑实撞：每秒涨 1413px）。
  const prevBottom = prev.el.getBoundingClientRect().bottom - ctx.pmTop - ctx.offsetAt(prev.end - 1)
  let marginSum = effMargin(prev.el, 'bottom') + effMargin(el, 'top')
  if (ctx.existingPos.has(pos)) {
    const sp = el.previousElementSibling as HTMLElement | null
    if (sp?.classList.contains('doc-pg-spacer')) {
      const r = sp.getBoundingClientRect()
      const pr = (sp.previousElementSibling as HTMLElement | null)?.getBoundingClientRect()
      marginSum = Math.max(0, pr ? r.top - pr.bottom : 0) + Math.max(0, el.getBoundingClientRect().top - r.bottom)
    }
  }
  return { kind: 'block', pos, prevBottom, marginSum }
}

function visitChildren(ctx: Ctx, parent: PMNode, parentPos: number /* 父节点内容起点 */, firstAnchor: SliceAnchor | null): void {
  let prev: { end: number; el: HTMLElement } | null = null
  parent.forEach((child, offset, index) => {
    const pos = parentPos + offset
    const box = rectOf(ctx.view, pos)
    if (!box) return
    const anchor = index === 0 ? firstAnchor : blockAnchor(ctx, pos, box.el, prev)
    visitBlock(ctx, child, pos, box, anchor)
    prev = { end: pos + child.nodeSize, el: box.el }
  })
}

function visitBlock(ctx: Ctx, node: PMNode, pos: number, box: { el: HTMLElement; top: number; bottom: number }, anchor: SliceAnchor | null): void {
  const { view, pmTop, offsetAt } = ctx
  // 自然坐标＝量得 − 位置 ≤ p 的垫片下移。🔴 取「底」时 p 用节点尾 −1：节点尾＝下一块的头，下一块的垫片就挂在那里，不能算进本块
  const nat = (y: number, p: number) => y - pmTop - offsetAt(p)
  const name = node.type.name

  if (name === 'table') {
    // 表格：逐行切片；第一行用表格的块锚（整表推走时表格外距一起走）
    let cols = 0
    node.firstChild?.forEach(c => { cols += (c.attrs.colspan as number) || 1 })
    // 第一行全是表头格 ⇒ 跨页时在新页顶重复（同 PDF：服务端把这行包成 <thead>·Chromium 每页重复）
    let repeat: { h: number; headerPos: number; key: string } | undefined
    const head = node.firstChild
    if (head && node.childCount > 1 && head.childCount > 0) {
      let allTh = true
      head.forEach(c => { if (c.type.name !== 'tableHeader') allTh = false })
      const hr = allTh ? rectOf(view, pos + 1) : null
      if (hr && hr.bottom > hr.top) repeat = { h: hr.bottom - hr.top, headerPos: pos + 1, key: `${Math.round((hr.bottom - hr.top) * 2) / 2}:${hashText(head.textContent)}` }
    }
    node.forEach((row, off, i) => {
      const rpos = pos + 1 + off
      const r = rectOf(view, rpos)
      if (!r) return
      const a: SliceAnchor | null = i === 0 ? anchor : { kind: 'row', pos: rpos, cols: Math.max(1, cols), ...(repeat ? { repeat } : {}) }
      // 首行（表头）随下一行走：不让表头孤零零留在页底
      ctx.groups.push({ top: nat(r.top, rpos), bottom: nat(r.bottom, rpos + row.nodeSize - 1), anchor: a, keepWithNext: i === 0 && node.childCount > 1 })
    })
    return
  }

  if (node.isTextblock && SPLITTABLE_TAGS.has(box.el.tagName)) {
    const el = box.el
    const from = pos + 1, to = pos + node.nodeSize - 1
    const group: SliceGroup = {
      top: nat(box.top, pos), bottom: nat(box.bottom, pos + node.nodeSize - 1), anchor,
      keepWithNext: HEADING_TAGS.has(el.tagName),
      expand: () => {
        const lines = measureLines(el)
        if (lines.length === 0) return []
        const cs = getComputedStyle(el)
        const fs = parseFloat(cs.fontSize) || 15
        const lh = cs.lineHeight === 'normal' ? fs * 1.2 : (parseFloat(cs.lineHeight) || fs * 1.2)
        const elRect = el.getBoundingClientRect()
        return lines.map((ln, i) => {
          const half = Math.max(0, (lh - (ln.gBottom - ln.gTop)) / 2)
          const start = i === 0 ? pos : lineStartPos(view, from, to, ln.gTop)
          const top = i === 0 ? elRect.top : ln.gTop - half
          const bottom = i === lines.length - 1 ? Math.max(ln.gBottom, Math.min(ln.gBottom + half, elRect.bottom)) : ln.gBottom + half
          const s: Slice = {
            top: nat(top, start), bottom: nat(bottom, start),
            anchor: i === 0 ? anchor : { kind: 'inline', pos: start },
          }
          return s
        })
      },
    }
    ctx.groups.push(group)
    return
  }

  const isContainer = !node.isTextblock && !node.isAtom && node.childCount > 0 && !!node.firstChild?.isBlock
  if (isContainer) {
    visitChildren(ctx, node, pos + 1, anchor)
    return
  }
  // 原子块（图片/视频/音频/分隔线/公式/mermaid/…）：整块；分页符＝整块且其后一律换页
  ctx.groups.push({ top: nat(box.top, pos), bottom: nat(box.bottom, pos + node.nodeSize - 1), anchor, ...(name === PAGE_BREAK_NODE_NAME ? { breakAfter: true } : {}) })
}

function hashText(t: string): string {
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0
  return `${t.length}.${(h >>> 0).toString(36)}`
}

// ── 表格栏宽──────────────────────────────────
//   PDF（pdf-render.ts → normalizePdfTableWidths）把每张表的栏宽换成百分比（总和＝版心宽）；编辑器（Tiptap TableView）照像素画——
//   纸张版心比连续流窄（A4 直式约 554px），有写宽的栏占满后没写宽的「內容」栏被挤成一字一行、全写宽的表则横向溢出。
//   分页视图下改用同一个 tableColumnPercents 算百分比写到 <col>，表宽 100%——同一份栏宽属性，两边同一个比例。
//   关掉分页 ⇒ 交回 Tiptap 自己的 updateColumns 画回像素。
const TIPTAP_CELL_MIN_WIDTH = 25   // Table.configure 没改 cellMinWidth ⇒ Tiptap 预设 25

function firstRowColWidths(table: PMNode): (number | null)[] {
  const out: (number | null)[] = []
  const row = table.firstChild
  if (!row) return out
  row.forEach(cell => {
    const span = (cell.attrs.colspan as number) || 1
    const cw = cell.attrs.colwidth as (number | null)[] | null
    for (let j = 0; j < span; j++) out.push(cw && typeof cw[j] === 'number' && cw[j]! > 0 ? cw[j]! : null)
  })
  return out
}

export function syncPagedTableWidths(view: EditorView, paged: boolean): void {
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    const dom = view.nodeDOM(pos)
    const table = dom instanceof HTMLTableElement ? dom : (dom instanceof HTMLElement ? dom.querySelector('table') : null)
    const colgroup = table?.querySelector(':scope > colgroup') as HTMLTableColElement | null
    if (!table || !colgroup) return false
    const cols = Array.from(colgroup.children) as HTMLElement[]
    if (paged) {
      const pct = tableColumnPercents(firstRowColWidths(node))
      if (pct.length !== cols.length) return false
      table.dataset.pgWidths = '1'
      table.style.width = '100%'
      table.style.minWidth = ''
      cols.forEach((c, i) => { c.style.removeProperty('min-width'); c.style.width = `${pct[i]}%` })
    } else if (table.dataset.pgWidths) {
      delete table.dataset.pgWidths
      cols.forEach(c => { c.style.removeProperty('width'); c.style.removeProperty('min-width') })
      updateColumns(node, colgroup, table, TIPTAP_CELL_MIN_WIDTH)
    }
    return false
  })
}

export function eagerImages(root: HTMLElement): void {
  root.querySelectorAll('img[loading="lazy"]').forEach(i => { (i as HTMLImageElement).loading = 'eager' })
}

export function collectGroups(view: EditorView, state: PgState): SliceGroup[] {
  const existing = measureExisting(view, state)
  const ctx: Ctx = {
    view,
    pmTop: view.dom.getBoundingClientRect().top,
    offsetAt: makeOffsetAt(existing),
    existingPos: new Set(existing.map(e => e.pos)),
    groups: [],
  }
  visitChildren(ctx, view.state.doc, 0, null)
  return ctx.groups
}

// ── 扩展 ────────────────────────────────────────────────────────────────────────────────

export type PagedViewOptions = { onPageCount?: (n: number) => void }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagedView: { setPagedGeometry: (geom: PagedViewGeometry | null) => ReturnType }
  }
}

export const PagedView = Extension.create<PagedViewOptions>({
  name: 'pagedView',
  addOptions() { return { onPageCount: undefined } },
  addCommands() {
    return {
      setPagedGeometry: (geom) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(pagedViewKey, { geom } satisfies PgMeta).setMeta('addToHistory', false)
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    const opts = this.options
    return [new Plugin<PgState>({
      key: pagedViewKey,
      state: {
        init: (): PgState => ({ geom: null, decos: DecorationSet.empty, sig: '', pageCount: 1 }),
        apply(tr: Transaction, prev: PgState, _old: EditorState, newState: EditorState): PgState {
          const meta = tr.getMeta(pagedViewKey) as PgMeta | undefined
          let next = prev
          if (tr.docChanged) next = { ...next, decos: next.decos.map(tr.mapping, tr.doc), sig: '' }
          if (meta) {
            if ('geom' in meta) {
              next = { ...next, geom: meta.geom ?? null }
              if (!meta.geom) next = { ...next, decos: DecorationSet.empty, sig: '', pageCount: 1 }
            }
            if (meta.breaks && next.geom) next = { ...next, decos: buildDecos(newState.doc, meta.breaks), sig: breaksSignature(meta.breaks) }
            if (typeof meta.pageCount === 'number') next = { ...next, pageCount: meta.pageCount }
          }
          return next
        },
      },
      props: {
        decorations(state) { return pagedViewKey.getState(state)?.decos ?? DecorationSet.empty },
      },
      view(view) {
        let timer: ReturnType<typeof setTimeout> | null = null
        let firstPending = 0
        let settle = 0
        let destroyed = false
        let lastCount = -1
        const run = () => {
          timer = null; firstPending = 0
          if (destroyed || !view.dom.isConnected) return
          const st = pagedViewKey.getState(view.state)
          if (!st?.geom) { syncPagedTableWidths(view, false); if (lastCount !== 1) { lastCount = 1; opts.onPageCount?.(1) } return }
          syncPagedTableWidths(view, true)
          if (view.composing) { schedule(); return }
          // 懒加载图（SmartImage loading=lazy）在屏外不载 ⇒ 高度 0 ⇒ 分页随滚动变、列印也缺图 ⇒ 分页视图下一律改成立即载入
          //   （载完 'load' 事件会再触发重排）。只改 NodeView 里 React 管的 img 属性·不碰文档内容。
          eagerImages(view.dom)
          const groups = collectGroups(view, st)
          const res = paginate(groups, st.geom, st.geom.gap)
          const sig = breaksSignature(res.breaks)
          if (sig !== st.sig || res.pageCount !== st.pageCount) {
            view.dispatch(view.state.tr.setMeta(pagedViewKey, { breaks: res.breaks, pageCount: res.pageCount } satisfies PgMeta).setMeta('addToHistory', false))
            if (sig !== st.sig && settle < PAGINATION_TUNING.settleRuns) { settle++; schedule(true) }
          }
          if (res.pageCount !== lastCount) { lastCount = res.pageCount; opts.onPageCount?.(res.pageCount) }
        }
        const schedule = (soon = false) => {
          if (destroyed) return
          const now = Date.now()
          if (!firstPending) firstPending = now
          if (timer) clearTimeout(timer)
          const wait = soon ? 30 : (now - firstPending >= PAGINATION_TUNING.maxWaitMs ? 0 : PAGINATION_TUNING.debounceMs)
          timer = setTimeout(run, wait)
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null
        ro?.observe(view.dom)
        void (typeof document !== 'undefined' ? document.fonts?.ready.then(() => schedule()) : undefined)
        // 图片/视频载入完高度才定 ⇒ 捕获阶段监听 load
        const onLoad = () => schedule()
        view.dom.addEventListener('load', onLoad, true)
        // 分页视图换成 PDF 同款字体（globals.css·按需下载）⇒ 字档到了版面会变 ⇒ 重排
        const fonts = typeof document !== 'undefined' ? document.fonts : undefined
        fonts?.addEventListener?.('loadingdone', onLoad)
        return {
          update(v, prevState) {
            const a = pagedViewKey.getState(v.state), b = pagedViewKey.getState(prevState)
            // TableView 每次表格节点更新都会把栏宽写回像素 ⇒ 分页视图下每拍重套百分比（量测前也会再套一次）
            if (v.state.doc !== prevState.doc || a?.geom !== b?.geom) syncPagedTableWidths(v, !!a?.geom)
            if (v.state.doc !== prevState.doc) { settle = 0; schedule() }
            else if (a?.geom !== b?.geom) { settle = 0; schedule(true) }
          },
          destroy() { destroyed = true; if (timer) clearTimeout(timer); ro?.disconnect(); view.dom.removeEventListener('load', onLoad, true); fonts?.removeEventListener?.('loadingdone', onLoad) },
        }
      },
    })]
  },
})
