// 網頁表格「尋找與取代／移除重複／隱藏行列」三样介面的纯逻辑（不碰 React·好单测）
//   资料层（findCells／replaceCells／removeDuplicates·hiddenRows／hiddenCols）在 engine/data-tools.ts、engine/sheet-view.ts；
//   这里只管介面要的小判断：找下一个往哪跳（循环）·右键表头选单该出哪几项·隐藏后方向键怎么跳·表头双线画在哪·移除重复的范围与表头猜测。
import type { Rect } from '../engine/style'

export type CellPos = { row: number; col: number }

// ── 尋找：找下一个／上一个（逐列由左到右·到底绕回头）────────────────────

/** hits 已照「逐列由左到右」排好：from 之后（backward ⇒ 之前）第一个的下标·到底绕回·没有 ⇒ -1 */
export function nextHitIndex(hits: readonly CellPos[], from: CellPos, backward = false): number {
  if (!hits.length) return -1
  const after = (h: CellPos) => h.row > from.row || (h.row === from.row && h.col > from.col)
  const before = (h: CellPos) => h.row < from.row || (h.row === from.row && h.col < from.col)
  if (!backward) { const i = hits.findIndex(after); return i >= 0 ? i : 0 }
  for (let i = hits.length - 1; i >= 0; i--) if (before(hits[i])) return i
  return hits.length - 1
}

/** 选区大于一格才给「只在選取範圍內」 */
export function isMultiCell(r: Rect | null | undefined): boolean {
  return !!r && (r.r1 > r.r0 || r.c1 > r.c0)
}

// ── 隐藏行列：方向键跳过·右键选单·表头双线 ──────────────────────────────

/** 从 from 走 delta 步（±1）·落在藏的那条就继续走；走到头还是藏的 ⇒ 留在原地 */
export function stepOverHidden(from: number, delta: number, hidden: ReadonlySet<number>, count: number): number {
  if (!delta) return from
  let to = Math.max(0, Math.min(count - 1, from + delta))
  const dir = Math.sign(delta)
  while (hidden.has(to)) {
    const n = to + dir
    if (n < 0 || n > count - 1) return from
    to = n
  }
  return to
}

/** 离 i 最近的没藏那条（先往后找再往前）·全藏 ⇒ i */
export function nearestVisible(i: number, hidden: ReadonlySet<number>, count: number): number {
  if (!hidden.has(i)) return i
  for (let k = i + 1; k < count; k++) if (!hidden.has(k)) return k
  for (let k = i - 1; k >= 0; k--) if (!hidden.has(k)) return k
  return i
}

/** 右键表头选单：要藏哪一段（右键的那条在选取里 ⇒ 整段选取·不在 ⇒ 只那一条）·要放出来哪几条（选取里藏着的＋右键处／选取两头紧挨着的藏段）。
 *  hidden＝手动藏的清单（筛选藏的不在这里放）·count＝这一向的总条数（藏完会一条不剩 ⇒ hide 给 null） */
export function headerMenuPlan(o: { clicked: number; selA: number; selB: number; hidden: readonly number[] | undefined; count: number }): {
  hide: { from: number; to: number } | null
  unhide: number[]
  /** 右键的那条不在选取里 ⇒ 页面先把选取换成这一条（Excel 同） */
  reselect: boolean
} {
  const a = Math.min(o.selA, o.selB), b = Math.max(o.selA, o.selB)
  const inSel = o.clicked >= a && o.clicked <= b
  const from = inSel ? a : o.clicked, to = inSel ? b : o.clicked
  const set = new Set(o.hidden ?? [])
  let visibleLeft = 0
  for (let i = 0; i < o.count; i++) if (!set.has(i) && (i < from || i > to)) visibleLeft++
  const out = new Set<number>()
  for (let i = from; i <= to; i++) if (set.has(i)) out.add(i)
  const walk = (start: number, dir: number) => { for (let i = start; i >= 0 && i < o.count && set.has(i); i += dir) out.add(i) }
  walk(from - 1, -1); walk(to + 1, 1)
  return { hide: visibleLeft > 0 ? { from, to } : null, unhide: [...out].sort((x, y) => x - y), reselect: !inSel }
}

/** 放出来几条之后的新清单（空 ⇒ undefined·键消失） */
export function withoutHidden(list: readonly number[] | undefined, show: readonly number[]): number[] | undefined {
  const drop = new Set(show)
  const out = (list ?? []).filter(i => !drop.has(i))
  return out.length ? out : undefined
}

/** 表头的「这里藏了东西」双线：before＝在这条前缘画（前一条是手动藏的）·after＝在最后一条看得见的后缘画（后面全藏了） */
export function hiddenEdgeMarks(count: number, visible: (i: number) => boolean, manual: ReadonlySet<number>): { before: Set<number>; after: Set<number> } {
  const before = new Set<number>(), after = new Set<number>()
  let last = -1
  for (let i = 0; i < count; i++) {
    if (!visible(i)) continue
    if (i > 0 && manual.has(i - 1)) before.add(i)
    last = i
  }
  if (last >= 0 && last < count - 1 && manual.has(last + 1)) after.add(last)
  return { before, after }
}

/** 一段 [a..b] 里看得见的条数（合并格的 rowSpan／colSpan 要扣掉藏的） */
export function visibleSpan(a: number, b: number, hidden: ReadonlySet<number>): number {
  let n = 0
  for (let i = a; i <= b; i++) if (!hidden.has(i)) n++
  return n
}

/** 历史与提示用的那段字：一条 ⇒ "3"·一段 ⇒ "3–5"（fmt 把 0 起的号换成显示字） */
export function spanLabel(from: number, to: number, fmt: (i: number) => string): string {
  return from === to ? fmt(from) : `${fmt(Math.min(from, to))}–${fmt(Math.max(from, to))}`
}

// ── 移除重複：范围与表头 ───────────────────────────────────────────────

/** 有内容的格的外框（没有 ⇒ null）·keys＝有值或公式的格名 A1 */
export function usedBounds(cells: Readonly<Record<string, { v?: unknown; f?: unknown } | undefined>>, parse: (k: string) => { row: number; col: number } | null): Rect | null {
  let out: Rect | null = null
  for (const [k, cd] of Object.entries(cells)) {
    if (!cd || !((cd.v !== undefined && cd.v !== null && cd.v !== '') || (typeof cd.f === 'string' && cd.f.trim() !== ''))) continue
    const p = parse(k); if (!p) continue
    out = out ? { r0: Math.min(out.r0, p.row), r1: Math.max(out.r1, p.row), c0: Math.min(out.c0, p.col), c1: Math.max(out.c1, p.col) } : { r0: p.row, r1: p.row, c0: p.col, c1: p.col }
  }
  return out
}

/** 选的范围剪到有内容的外框里（整栏／整列选取不把底下一大片空白算进来·Excel 同）·不相交 ⇒ null */
export function trimToUsed(rect: Rect, used: Rect | null): Rect | null {
  if (!used) return null
  const r: Rect = { r0: Math.max(rect.r0, used.r0), r1: Math.min(rect.r1, used.r1), c0: Math.max(rect.c0, used.c0), c1: Math.min(rect.c1, used.c1) }
  return r.r0 <= r.r1 && r.c0 <= r.c1 ? r : null
}

export type DedupeCellValue = string | number | boolean | null
/** 第一列像不像表头（「資料含標題列」预设勾不勾）：第一列每格都是非空的字·底下还有资料·
 *  而且底下有数字（表头是字、资料是数），或表头的字在自己那栏底下一次都没再出现 */
export function guessHasHeader(rows: readonly (readonly DedupeCellValue[])[]): boolean {
  if (rows.length < 2) return false
  const head = rows[0]
  if (!head.length || !head.every(v => typeof v === 'string' && v.trim() !== '')) return false
  const body = rows.slice(1)
  if (body.some(r => r.some(v => typeof v === 'number'))) return true
  return head.every((h, c) => !body.some(r => typeof r[c] === 'string' && (r[c] as string).trim().toLowerCase() === (h as string).trim().toLowerCase()))
}
