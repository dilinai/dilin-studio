// 表格「冻结窗格／筛选／下拉清单（资料验证）」纯函数
//   ⛔ 不碰库、不碰 React：网页（SheetGrid／SheetFilterMenu）、服务端净化闸（engine/content.ts sanitizeSheetContent）、AI 操作（agent-ops applyOps 的 freeze／filter／validate）、
//   xlsx 写读（./sheet-view-xlsx.ts）同调这一份。
//
//   资料形状（存在每张 sheet 的 content 里·跟 cells／merges 同层）：
//     freeze?:      { rows, cols }                                   前 rows 行／前 cols 列固定（0＝不冻结那一向·两向都 0 ⇒ 不存）
//     filter?:      { range, criteria?: { [列字母]: 条件 } }          每张表一个筛选区（Excel 口径）·range 第一行＝表头（出筛选钮）·其下是资料行
//                   条件＝{ values: [显示字…] }（按值勾选·'' 代表空白）或 { condition: { op, value?, value2? } }
//     validations?: [{ id, range, type:'list', list? | source?, allowBlank?, showError? }]   下拉清单（list＝选项·source＝本页某区间的值）
//     hiddenRows?／hiddenCols?: [0 起的行号／栏号]                   手动隐藏的行／栏（跟筛选藏的分开存：清筛选不会把手动藏的放出来·Excel 同）
//                   allowBlank 缺省＝true（可留空）·showError 缺省＝true（打清单外的值 ⇒ 拒）·false ⇒ 收下但提示
//   口径：
//     - 筛选比的是格子显示的字（套了数字格式之后·Excel 按值勾选同口径）；大于／小于／介于：两边都是数字才按数字比·都是文字按字比·一数一字 ⇒ 不过
//     - 筛选区往下自动延到这几列最后一行有值的格（之后接龙加的行也吃得到·Excel 重新套用筛选同口径）
//     - 被筛掉的行只是不显示（资料不删）；导出 xlsx 写 hidden＝1
//     - 插删行列：端点规则同合并区（agent-ops structural）——整段被删 ⇒ 拿掉；筛选条件的列字母跟着搬
//   借鉴：条件运算子的名单与「customFilters 两条 and／or」照 ECMA-376 §18.3.2（CT_CustomFilters）·Excel 筛选选单的分组（按值／按条件）照 Excel 介面；码现写。

import { cellKey, colToIndex, indexToCol, formatValue, isFormulaError, parseRef, SheetEvaluator, DEFAULT_ROWS, DEFAULT_COLS, type SheetCells, type SheetContent, type EvalResult, type EvaluatorOptions } from './formula'
import { formatWithNumFmt, rectsOverlap, rectContains, type Rect, type NumFmt } from './style'

// ── 型别与上限 ─────────────────────────────────────────────────────────────

export type SheetFreeze = { rows: number; cols: number }
export const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'not_between', 'contains', 'not_contains', 'begins_with', 'ends_with', 'empty', 'not_empty'] as const
export type FilterOp = typeof FILTER_OPS[number]
export type FilterCondition = { op: FilterOp; value?: string; value2?: string }
export type FilterCriterion = { values: string[] } | { condition: FilterCondition }
export type SheetFilter = { range: string; criteria?: Record<string, FilterCriterion> }
export type SheetValidation = { id: string; range: string; type: 'list'; list?: string[]; source?: string; allowBlank?: boolean; showError?: boolean }
export type SheetViewState = { freeze?: SheetFreeze; filter?: SheetFilter; validations?: SheetValidation[]; hiddenRows?: number[]; hiddenCols?: number[] }
/** 带这三键的 sheet 内容（formula.ts SheetContent 不动·这里扩） */
export type ViewContent = SheetContent & SheetViewState

/** 冻结上限：网页网格现画 A1:Z100（formula DEFAULT_ROWS／COLS）——至少留一行一列能卷 */
export const FREEZE_MAX_ROWS = DEFAULT_ROWS - 1
export const FREEZE_MAX_COLS = DEFAULT_COLS - 1
export const FILTER_VALUES_MAX = 1000
export const FILTER_TEXT_MAX = 255
export const VALIDATIONS_MAX = 200
export const LIST_ITEMS_MAX = 500
/** Excel 直接写在验证里的清单（formula1 "a,b,c"）连逗号最多 255 字——超了 Excel 打不开·要改用 source 区间 */
export const LIST_CHARS_MAX = 255
/** 手动隐藏的行／栏各至多几条 */
export const HIDDEN_MAX = 5000
const MAX_ROW_IDX = 999998, MAX_COL_IDX = 18277

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

// ── A1 小工具（单格／区间·可带 $；不收整列整行——那种由调用方先裁成有界区间） ──

export function parseRect(s: unknown): Rect | null {
  if (typeof s !== 'string') return null
  const t = s.trim().replace(/^.*!/, '')
  const parts = t.split(':')
  if (parts.length > 2) return null
  const a = parseRef(parts[0] ?? ''), b = parseRef(parts[1] ?? parts[0] ?? '')
  if (!a || !b) return null
  return { r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row), c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col) }
}
export const rectA1 = (r: Rect) => (r.r0 === r.r1 && r.c0 === r.c1 ? cellKey(r.r0, r.c0) : `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}`)
const rectRange = (r: Rect) => `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}`

/** a 扣掉 b ⇒ 剩下的（至多四块：上／下整宽·左／右夹在中间） */
export function subtractRect(a: Rect, b: Rect): Rect[] {
  if (!rectsOverlap(a, b)) return [a]
  const out: Rect[] = []
  if (a.r0 < b.r0) out.push({ r0: a.r0, r1: b.r0 - 1, c0: a.c0, c1: a.c1 })
  if (a.r1 > b.r1) out.push({ r0: b.r1 + 1, r1: a.r1, c0: a.c0, c1: a.c1 })
  const r0 = Math.max(a.r0, b.r0), r1 = Math.min(a.r1, b.r1)
  if (a.c0 < b.c0) out.push({ r0, r1, c0: a.c0, c1: b.c0 - 1 })
  if (a.c1 > b.c1) out.push({ r0, r1, c0: b.c1 + 1, c1: a.c1 })
  return out
}

// ── 净化（服务端存库前·网页套用前同一份）：坏的那项丢掉、⛔ 整份拒 ─────────────

const cleanText = (v: unknown, max = FILTER_TEXT_MAX): string | null => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.slice(0, max) : null)

export function sanitizeFreeze(input: unknown): SheetFreeze | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const { rows, cols } = input as { rows?: unknown; cols?: unknown }
  const r = isInt(rows) ? Math.max(0, Math.min(FREEZE_MAX_ROWS, rows)) : 0
  const c = isInt(cols) ? Math.max(0, Math.min(FREEZE_MAX_COLS, cols)) : 0
  return r || c ? { rows: r, cols: c } : undefined
}

export function sanitizeCondition(input: unknown): FilterCondition | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const x = input as { op?: unknown; value?: unknown; value2?: unknown }
  if (typeof x.op !== 'string' || !(FILTER_OPS as readonly string[]).includes(x.op)) return null
  const op = x.op as FilterOp
  const out: FilterCondition = { op }
  if (op === 'empty' || op === 'not_empty') return out
  const v = cleanText(x.value)
  if (v === null) return null
  out.value = v
  if (op === 'between' || op === 'not_between') {
    const v2 = cleanText(x.value2)
    if (v2 === null) return null
    out.value2 = v2
  }
  return out
}

export function sanitizeCriterion(input: unknown): FilterCriterion | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const x = input as { values?: unknown; condition?: unknown }
  if (Array.isArray(x.values)) {
    const seen = new Set<string>()
    const values: string[] = []
    for (const v of x.values) { const s = cleanText(v); if (s !== null && !seen.has(s) && values.length < FILTER_VALUES_MAX) { seen.add(s); values.push(s) } }
    return { values }
  }
  const c = sanitizeCondition(x.condition)
  return c ? { condition: c } : null
}

export function sanitizeFilter(input: unknown): SheetFilter | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const x = input as { range?: unknown; criteria?: unknown }
  const r = parseRect(x.range)
  if (!r) return undefined
  const out: SheetFilter = { range: rectRange(r) }
  if (x.criteria && typeof x.criteria === 'object' && !Array.isArray(x.criteria)) {
    const crit: Record<string, FilterCriterion> = {}
    for (const [k, v] of Object.entries(x.criteria as Record<string, unknown>)) {
      if (!/^[A-Z]{1,3}$/.test(k)) continue
      const c = colToIndex(k)
      if (c < r.c0 || c > r.c1) continue   // 列不在筛选区里 ⇒ 丢
      const cr = sanitizeCriterion(v)
      if (cr) crit[k] = cr
    }
    if (Object.keys(crit).length) out.criteria = crit
  }
  return out
}

/** 清单项：去头尾空白·去重·丢空的与带逗号的（Excel 清单以逗号分项）·总长（连逗号）超 LIST_CHARS_MAX 截掉后面的 */
export function cleanListItems(input: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let chars = 0
  for (const v of input) {
    const s = cleanText(v)?.trim()
    if (!s || s.includes(',') || seen.has(s)) continue
    const add = s.length + (out.length ? 1 : 0)
    if (out.length >= LIST_ITEMS_MAX || chars + add > LIST_CHARS_MAX) break
    seen.add(s); out.push(s); chars += add
  }
  return out
}

export function sanitizeValidations(input: unknown): SheetValidation[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: SheetValidation[] = []
  const ids = new Set<string>()
  for (const raw of input) {
    if (out.length >= VALIDATIONS_MAX) break
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const x = raw as { id?: unknown; range?: unknown; type?: unknown; list?: unknown; source?: unknown; allowBlank?: unknown; showError?: unknown }
    if (x.type !== undefined && x.type !== 'list') continue
    const r = parseRect(x.range)
    if (!r) continue
    const v: SheetValidation = { id: '', range: rectA1(r), type: 'list' }
    const src = parseRect(x.source)
    if (Array.isArray(x.list)) { const items = cleanListItems(x.list); if (!items.length) continue; v.list = items }
    else if (src) v.source = rectA1(src)
    else continue
    if (x.allowBlank === false) v.allowBlank = false
    if (x.showError === false) v.showError = false
    let id = typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : `v${out.length + 1}`
    for (let n = 2; ids.has(id); n++) id = `v${out.length + 1}_${n}`
    ids.add(id); v.id = id
    out.push(v)
  }
  return out.length ? out : undefined
}

/** 隐藏的行／栏：0 起的整数·去重排序·至多 HIDDEN_MAX·空 ⇒ undefined */
export function sanitizeHidden(input: unknown, maxIndex: number): number[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out = [...new Set(input.filter((v): v is number => isInt(v) && v >= 0 && v <= maxIndex))].sort((a, b) => a - b).slice(0, HIDDEN_MAX)
  return out.length ? out : undefined
}

/** 几键一起净化（content.ts sanitizeSheetContent 一行调用）·没有的键不回 */
export function sanitizeSheetView(input: unknown): SheetViewState {
  if (!input || typeof input !== 'object') return {}
  const x = input as Record<string, unknown>
  const out: SheetViewState = {}
  const f = sanitizeFreeze(x.freeze); if (f) out.freeze = f
  const fl = sanitizeFilter(x.filter); if (fl) out.filter = fl
  const vs = sanitizeValidations(x.validations); if (vs) out.validations = vs
  const hr = sanitizeHidden(x.hiddenRows, MAX_ROW_IDX); if (hr) out.hiddenRows = hr
  const hc = sanitizeHidden(x.hiddenCols, MAX_COL_IDX); if (hc) out.hiddenCols = hc
  return out
}

/** 网页网格／列印／导出要藏的行（0 起）：手动藏的＋被筛掉的 */
export function hiddenRowSet(content: ViewContent | null | undefined, reader?: CellReader): Set<number> {
  const out = filteredRows(content, reader)
  for (const r of content?.hiddenRows ?? []) out.add(r)
  return out
}
/** 要藏的栏（0 起） */
export function hiddenColSet(content: ViewContent | null | undefined): Set<number> { return new Set(content?.hiddenCols ?? []) }
/** 把 [from..to] 设成藏／不藏 ⇒ 新清单（空 ⇒ undefined） */
export function setHidden(list: number[] | undefined, from: number, to: number, hide: boolean): number[] | undefined {
  const set = new Set(list ?? [])
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) { if (hide) set.add(i); else set.delete(i) }
  if (set.size > HIDDEN_MAX) throw new SheetViewError(`at most ${HIDDEN_MAX} hidden rows or columns per tab`)
  const out = [...set].sort((a, b) => a - b)
  return out.length ? out : undefined
}

// ── 读格（显示字＋数字值）────────────────────────────────────────────────

export type CellText = { text: string; num: number | null }
export type CellReader = (r: number, c: number) => CellText

/** 一格显示的字（同 agent-ops displayOf／网页 display：有数字格式先套·算不出 ⇒ 原值字） */
export function cellTextOf(raw: string | undefined, nf: NumFmt | undefined, v: EvalResult, isFormula: boolean, lang: 'zh' | 'en' = 'zh'): CellText {
  const shown = isFormulaError(v) ? null : formatWithNumFmt(nf, v, isFormula ? undefined : raw, { lang })
  return { text: shown ?? formatValue(v), num: typeof v === 'number' && Number.isFinite(v) ? v : null }
}

/** 整张 sheet 的读格器（同一个求值器·逐格缓存） */
export function cellReaderFor(content: SheetContent | null | undefined, lang: 'zh' | 'en' = 'zh', evalOpts?: EvaluatorOptions): CellReader {
  const cells: SheetCells = content?.cells ?? {}
  const ev = new SheetEvaluator(cells, content?.merges, evalOpts)   // evalOpts 带 book ⇒ 跨表引用算得出
  const memo = new Map<string, CellText>()
  return (r, c) => {
    const k = cellKey(r, c)
    const hit = memo.get(k); if (hit) return hit
    const cd = cells[k]
    const out = cd ? cellTextOf(cd.v, cd.s?.numFmt, ev.value(k), !!cd.f, lang) : { text: '', num: null }
    memo.set(k, out)
    return out
  }
}

// ── 筛选 ──────────────────────────────────────────────────────────────────

const hasValueAt = (cells: SheetCells, r: number, c: number) => { const cd = cells[cellKey(r, c)]; return !!cd && ((typeof cd.v === 'string' && cd.v !== '') || (typeof cd.f === 'string' && cd.f.trim() !== '')) }

/** 筛选区（实际吃到的）：表头行＝range 第一行·底往下延到这几列最后一行有值的格 */
export function filterRect(content: ViewContent | null | undefined): Rect | null {
  const f = content?.filter
  const r = f ? parseRect(f.range) : null
  if (!r) return null
  let bottom = r.r1
  for (const k of Object.keys(content?.cells ?? {})) {
    const p = parseRef(k); if (!p || p.col < r.c0 || p.col > r.c1 || p.row <= bottom) continue
    if (hasValueAt(content!.cells!, p.row, p.col)) bottom = p.row
  }
  return { ...r, r1: bottom }
}

const toNum = (s: string | undefined): number | null => {
  if (s === undefined) return null
  const t = s.trim().replace(/,/g, '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(t)) return null
  const n = Number(t.replace(/%$/, ''))
  return Number.isFinite(n) ? (t.endsWith('%') ? n / 100 : n) : null
}
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const lower = (s: string) => s.toLocaleLowerCase()

/** 两边比大小：都是数字 ⇒ 数字比；都不是 ⇒ 字比（不分大小写）；一数一字 ⇒ null（不过） */
function cmp(cell: CellText, value: string): number | null {
  const vn = toNum(value)
  if (cell.num !== null && vn !== null) return cell.num - vn
  if (cell.num === null && vn === null && cell.text !== '') return collator.compare(cell.text, value)
  return null
}
const eqCell = (cell: CellText, value: string) => { const vn = toNum(value); return cell.num !== null && vn !== null ? cell.num === vn : lower(cell.text.trim()) === lower(value.trim()) }

/** 一格过不过某条件 */
export function matchCondition(cond: FilterCondition, cell: CellText): boolean {
  const v = cond.value ?? '', t = lower(cell.text)
  switch (cond.op) {
    case 'empty': return cell.text.trim() === ''
    case 'not_empty': return cell.text.trim() !== ''
    case 'eq': return eqCell(cell, v)
    case 'neq': return !eqCell(cell, v)
    case 'contains': return t.includes(lower(v))
    case 'not_contains': return !t.includes(lower(v))
    case 'begins_with': return t.startsWith(lower(v))
    case 'ends_with': return t.endsWith(lower(v))
    case 'gt': { const d = cmp(cell, v); return d !== null && d > 0 }
    case 'gte': { const d = cmp(cell, v); return d !== null && d >= 0 }
    case 'lt': { const d = cmp(cell, v); return d !== null && d < 0 }
    case 'lte': { const d = cmp(cell, v); return d !== null && d <= 0 }
    case 'between': case 'not_between': {
      const a = cmp(cell, v), b = cmp(cell, cond.value2 ?? '')
      const inside = a !== null && b !== null && ((a >= 0 && b <= 0) || (a <= 0 && b >= 0))   // 上下限给反了也认
      return cond.op === 'between' ? inside : (a !== null && b !== null && !inside)
    }
  }
  return true
}

/** 一格过不过某列的筛选（按值勾选：比显示字·不分大小写·'' ＝空白） */
export function matchCriterion(crit: FilterCriterion, cell: CellText): boolean {
  if ('values' in crit) { const t = lower(cell.text.trim()); return crit.values.some(v => lower(v.trim()) === t) }
  return matchCondition(crit.condition, cell)
}

/** 被筛掉的行（0 起）·except＝不看这一列的条件（筛选选单列「这列还有哪些值」用：Excel 只列被别列筛剩的行的值） */
export function filteredRows(content: ViewContent | null | undefined, reader?: CellReader, except?: number): Set<number> {
  const out = new Set<number>()
  const rect = filterRect(content)
  const crit = content?.filter?.criteria
  if (!rect || !crit) return out
  const cols = Object.entries(crit).map(([k, c]) => ({ c: colToIndex(k), crit: c })).filter(x => x.c >= rect.c0 && x.c <= rect.c1 && x.c !== except)
  if (!cols.length) return out
  const read = reader ?? cellReaderFor(content)
  for (let r = rect.r0 + 1; r <= rect.r1; r++) {
    if (cols.some(x => !matchCriterion(x.crit, read(r, x.c)))) out.add(r)
  }
  return out
}

/** 筛选选单「按值」那一列的不重复值（按出现先后·数字照数字排在前·空白放最后标 ''）＋各值的行数 */
export function filterColumnValues(content: ViewContent | null | undefined, col: number, reader?: CellReader): Array<{ text: string; count: number }> {
  const rect = filterRect(content)
  if (!rect || col < rect.c0 || col > rect.c1) return []
  const read = reader ?? cellReaderFor(content)
  const others = filteredRows(content, read, col)
  const map = new Map<string, { text: string; count: number; num: number | null }>()
  for (let r = rect.r0 + 1; r <= rect.r1; r++) {
    if (others.has(r)) continue
    const cell = read(r, col)
    const t = cell.text.trim()
    const key = lower(t)
    const hit = map.get(key)
    if (hit) hit.count++
    else map.set(key, { text: t, count: 1, num: cell.num })
  }
  return [...map.values()].sort((a, b) => {
    if (a.text === '' || b.text === '') return a.text === '' ? (b.text === '' ? 0 : 1) : -1
    if (a.num !== null && b.num !== null) return a.num - b.num
    if (a.num !== null || b.num !== null) return a.num !== null ? -1 : 1
    return collator.compare(a.text, b.text)
  }).map(({ text, count }) => ({ text, count }))
}

// ── 下拉清单（资料验证）────────────────────────────────────────────────────

/** 这格套的验证（后设的盖前设的） */
export function validationAt(content: ViewContent | null | undefined, r: number, c: number): SheetValidation | null {
  const vs = content?.validations ?? []
  for (let i = vs.length - 1; i >= 0; i--) { const rr = parseRect(vs[i].range); if (rr && rectContains(rr, r, c)) return vs[i] }
  return null
}

/** 清单选项：list 原样；source ⇒ 那块区间（同页）每格的显示字（空格略·去重·至多 LIST_ITEMS_MAX） */
export function validationOptions(content: ViewContent | null | undefined, v: SheetValidation, reader?: CellReader): string[] {
  if (v.list) return v.list
  const r = parseRect(v.source)
  if (!r) return []
  const read = reader ?? cellReaderFor(content)
  const out: string[] = []
  const seen = new Set<string>()
  for (let rr = r.r0; rr <= r.r1 && out.length < LIST_ITEMS_MAX; rr++) for (let cc = r.c0; cc <= r.c1 && out.length < LIST_ITEMS_MAX; cc++) {
    const t = read(rr, cc).text.trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

export type ValidationVerdict = 'ok' | 'blank' | 'not_in_list'
/** 手打的值过不过清单：空 ⇒ 看 allowBlank；数字两边都是数字按数字比（1 ＝ 1.0）·否则照字比（去头尾空白） */
export function checkListInput(v: SheetValidation, options: string[], raw: string): ValidationVerdict {
  const t = raw.trim()
  if (t === '') return v.allowBlank === false ? 'blank' : 'ok'
  const n = toNum(t)
  return options.some(o => o.trim() === t || (n !== null && toNum(o) === n)) ? 'ok' : 'not_in_list'
}

/** 在 rect 设一条新清单：与它重叠的旧验证先扣掉那块（Excel：同一格只留最后设的）·再放新的 */
export function putValidation(list: SheetValidation[] | undefined, rect: Rect, v: Omit<SheetValidation, 'id' | 'range'>): SheetValidation[] {
  const out = clearValidations(list, rect)
  return [...out, { ...v, id: newValidationId(out), range: rectA1(rect) }]
}
/** 把 rect 里的验证拿掉（没给 rect ⇒ 全拿掉）·部分重叠的切成剩下的几块 */
export function clearValidations(list: SheetValidation[] | undefined, rect?: Rect | null): SheetValidation[] {
  if (!rect) return []
  const out: SheetValidation[] = []
  for (const v of list ?? []) {
    const r = parseRect(v.range); if (!r) continue
    const rest = subtractRect(r, rect)
    rest.forEach((x, i) => out.push({ ...v, range: rectA1(x), id: i === 0 ? v.id : newValidationId([...(list ?? []), ...out]) }))
  }
  return out
}
export function newValidationId(list: SheetValidation[]): string {
  const ids = new Set(list.map(v => v.id))
  for (let n = list.length + 1; ; n++) { const id = `v${n}`; if (!ids.has(id)) return id }
}

// ── 插删行列：冻结／筛选区／验证区间跟着搬（端点规则同 agent-ops structural 的合并区） ──

type Axis = 'row' | 'col'
/** 一个矩形随插删搬：插入 ⇒ at 之后（含）的端点往后推；删除 ⇒ 整段被删 ⇒ null·部分被删 ⇒ 收缩·之后的往前拉 */
export function shiftRect(r: Rect, axis: Axis, mode: 'insert' | 'delete', at: number, count: number): Rect | null {
  let s = axis === 'row' ? r.r0 : r.c0, e = axis === 'row' ? r.r1 : r.c1
  const end = at + count - 1
  if (mode === 'insert') { if (s >= at) s += count; if (e >= at) e += count }
  else {
    if (s >= at && e <= end) return null
    if (s > end) s -= count; else if (s >= at) s = at
    if (e > end) e -= count; else if (e >= at) e = at - 1
    if (e < s) e = s
  }
  return axis === 'row' ? { ...r, r0: s, r1: e } : { ...r, c0: s, c1: e }
}
/** 一个索引随插删搬（删掉 ⇒ null） */
function shiftIndex(v: number, mode: 'insert' | 'delete', at: number, count: number): number | null {
  if (mode === 'insert') return v >= at ? v + count : v
  if (v >= at && v <= at + count - 1) return null
  return v > at + count - 1 ? v - count : v
}

/** 改 content 本身（agent-ops 插删行列那一步之后调）·回警告句 */
export function shiftViewForStruct(content: ViewContent, axis: Axis, mode: 'insert' | 'delete', at: number, count: number, max: { rows: number; cols: number }): string[] {
  const warnings: string[] = []
  // 冻结：插在冻结区里 ⇒ 冻结跟着多；删到冻结区 ⇒ 少掉删到的那几条（Excel 同）
  if (content.freeze) {
    const k = axis === 'row' ? 'rows' : 'cols'
    const n = content.freeze[k]
    if (n > 0) {
      let next = n
      if (mode === 'insert' && at < n) next = n + count
      else if (mode === 'delete' && at < n) next = n - (Math.min(n, at + count) - at)
      const f = sanitizeFreeze({ ...content.freeze, [k]: next })
      if (f) content.freeze = f; else delete content.freeze
    }
  }
  // 筛选区：区跟着搬·条件的列字母跟着搬（被删的列条件拿掉）·表头行被删 ⇒ 整个筛选拿掉
  if (content.filter) {
    const r = parseRect(content.filter.range)
    const head = r ? (axis === 'row' ? shiftIndex(r.r0, mode, at, count) : r.r0) : null
    const nr = r && head !== null ? shiftRect(r, axis, mode, at, count) : null
    if (!nr || (axis === 'row' && nr.r1 > max.rows) || (axis === 'col' && nr.c1 > max.cols)) { delete content.filter; warnings.push('the filter area was removed (its header row or all its columns were deleted).') }
    else {
      const crit: Record<string, FilterCriterion> = {}
      for (const [k, c] of Object.entries(content.filter.criteria ?? {})) {
        const ni = axis === 'col' ? shiftIndex(colToIndex(k), mode, at, count) : colToIndex(k)
        if (ni !== null) crit[indexToCol(ni)] = c
      }
      content.filter = { range: rectRange(nr), ...(Object.keys(crit).length ? { criteria: crit } : {}) }
    }
  }
  // 下拉清单：区间与 source 都跟着搬·整段被删 ⇒ 拿掉
  if (content.validations) {
    let gone = 0
    const out: SheetValidation[] = []
    for (const v of content.validations) {
      const r = parseRect(v.range)
      const nr = r ? shiftRect(r, axis, mode, at, count) : null
      if (!nr || nr.r1 > max.rows || nr.c1 > max.cols) { gone++; continue }
      const next: SheetValidation = { ...v, range: rectA1(nr) }
      if (v.source) {
        const sr = parseRect(v.source)
        const ns = sr ? shiftRect(sr, axis, mode, at, count) : null
        if (!ns) { gone++; continue }
        next.source = rectA1(ns)
      }
      out.push(next)
    }
    if (out.length) content.validations = out; else delete content.validations
    if (gone) warnings.push(`${gone} dropdown list(s) were removed (their cells or their source range were deleted).`)
  }
  // 手动隐藏的行／栏：跟着搬·被删的那几条拿掉
  const hk = axis === 'row' ? 'hiddenRows' : 'hiddenCols'
  if (content[hk]?.length) {
    const lim = axis === 'row' ? max.rows : max.cols
    const next = content[hk]!.map(v => shiftIndex(v, mode, at, count)).filter((v): v is number => v !== null && v <= lim)
    if (next.length) content[hk] = next; else delete content[hk]
  }
  return warnings
}

// ── AI 操作（agent-ops applyOps 的 freeze／filter／validate 三种 op）──────────────

export class SheetViewError extends Error {
  code: string
  constructor(message: string, code = 'err_sheet_bad_op') { super(message); this.code = code }
}
/** agent-ops 交进来的那几支（免得本档反过来 import agent-ops·绕圈） */
export type ViewOpCtx = {
  parseA1: (s: unknown) => { rect: Rect; kind: 'cell' | 'range' | 'cols' | 'rows'; sheet: string | null } | null
  usedRange: (c: ViewContent) => Rect | null
}
export type ViewOpResult = { op: string; [k: string]: unknown }

const fail = (msg: string, code?: string): never => { throw new SheetViewError(msg, code) }

function optBool(o: Record<string, unknown>, k: string, idx: number): boolean | undefined {
  if (o[k] === undefined || o[k] === null) return undefined
  if (typeof o[k] !== 'boolean') fail(`ops[${idx}].${k} must be true or false`)
  return o[k] as boolean
}

/** freeze：{ rows?, cols? }（没给的那向不变·0＝取消那向） */
function opFreeze(content: ViewContent, o: Record<string, unknown>, idx: number): ViewOpResult {
  const cur = content.freeze ?? { rows: 0, cols: 0 }
  const pick = (k: 'rows' | 'cols', max: number): number => {
    const v = o[k]
    if (v === undefined || v === null) return cur[k]
    if (!isInt(v) || v < 0 || v > max) fail(`ops[${idx}].${k} must be a whole number 0–${max} (0 = not frozen)`)
    return v as number
  }
  if ((o.rows === undefined || o.rows === null) && (o.cols === undefined || o.cols === null)) fail(`ops[${idx}]: give rows and/or cols (e.g. rows: 1 freezes the top row; both 0 unfreezes)`)
  const rows = pick('rows', FREEZE_MAX_ROWS), cols = pick('cols', FREEZE_MAX_COLS)
  if (rows || cols) content.freeze = { rows, cols }; else delete content.freeze
  return { op: 'freeze', rows, cols, ...(rows || cols ? { top_left_cell: cellKey(rows, cols) } : {}) }
}

/** 筛选条件入参（AI 给的）⇒ 内部条件；坏的直接报（⛔ 静默丢） */
function criterionIn(x: unknown, where: string): FilterCriterion {
  if (!x || typeof x !== 'object' || Array.isArray(x)) fail(`${where} must be {"values":[…]} or {"condition":{"op":…,"value":…}}`)
  const o = x as { values?: unknown; condition?: unknown }
  if (o.values !== undefined && o.condition !== undefined) fail(`${where}: give values or condition, not both`)
  if (o.values !== undefined) {
    if (!Array.isArray(o.values) || !o.values.length) fail(`${where}.values must be a non-empty list of the values to show (use "" for blank cells)`)
    const arr = o.values as unknown[]
    if (arr.length > FILTER_VALUES_MAX) fail(`${where}.values: at most ${FILTER_VALUES_MAX} values`)
    if (arr.some(v => v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v)))) fail(`${where}.values must be strings or numbers`)
    return sanitizeCriterion({ values: arr.map(v => (v === null ? '' : v)) })!
  }
  const c = o.condition as { op?: unknown; value?: unknown; value2?: unknown } | undefined
  if (!c || typeof c !== 'object') fail(`${where} must have values or condition`)
  if (typeof c!.op !== 'string' || !(FILTER_OPS as readonly string[]).includes(c!.op)) fail(`${where}.condition.op must be one of ${FILTER_OPS.join(', ')}`)
  const op = c!.op as FilterOp
  if (op !== 'empty' && op !== 'not_empty' && cleanText(c!.value) === null) fail(`${where}.condition.value is required for ${op}`)
  if ((op === 'between' || op === 'not_between') && cleanText(c!.value2) === null) fail(`${where}.condition.value2 is required for ${op} (the upper end)`)
  return { condition: sanitizeCondition(c)! }
}

/** filter：{ range?, criteria?, clear? } */
function opFilter(content: ViewContent, o: Record<string, unknown>, idx: number, ctx: ViewOpCtx): ViewOpResult {
  const clear = optBool(o, 'clear', idx)
  if (clear) {
    if (o.range !== undefined || o.criteria !== undefined) fail(`ops[${idx}]: clear:true turns the filter off — don't combine it with range or criteria`)
    const had = !!content.filter
    delete content.filter
    return { op: 'filter', cleared: had }
  }
  let rect: Rect | null = null
  if (o.range !== undefined && o.range !== null) {
    const a = ctx.parseA1(o.range)
    if (!a) fail(`ops[${idx}].range: bad A1 range "${String(o.range)}" (use the header row like A1:E1, or the whole table like A1:E30)`)
    const used = ctx.usedRange(content)
    if (a!.kind === 'rows') fail(`ops[${idx}].range: a filter needs columns — give the header row like A1:E1`)
    if (a!.kind === 'cols') {
      if (!used) fail(`ops[${idx}]: the sheet is empty — write the table first`)
      rect = { r0: used!.r0, r1: used!.r1, c0: a!.rect.c0, c1: a!.rect.c1 }
    } else if (a!.kind === 'cell') {
      if (!used || !rectContains(used, a!.rect.r0, a!.rect.c0)) fail(`ops[${idx}].range: give the header row like A1:E1 (a single cell outside the table can't be expanded)`)
      rect = { r0: a!.rect.r0, r1: used!.r1, c0: used!.c0, c1: used!.c1 }
    } else rect = a!.rect
    if (rect!.r0 === rect!.r1 && used && used.r1 > rect!.r1) rect = { ...rect!, r1: used.r1 }   // 只给表头那一行 ⇒ 往下吃到表尾
  } else if (content.filter) rect = parseRect(content.filter.range)
  else {
    const used = ctx.usedRange(content)
    if (!used) fail(`ops[${idx}]: the sheet is empty — write the table first, then add the filter`)
    rect = used
  }
  const prev = content.filter
  const prevRect = prev ? parseRect(prev.range) : null
  // 换了表头行或列宽 ⇒ 旧条件只留还在新区里的列
  const crit: Record<string, FilterCriterion> = {}
  for (const [k, c] of Object.entries(prev?.criteria ?? {})) {
    const ci = colToIndex(k)
    if (prevRect && prevRect.r0 === rect!.r0 && ci >= rect!.c0 && ci <= rect!.c1) crit[k] = c
  }
  if (o.criteria !== undefined && o.criteria !== null) {
    if (typeof o.criteria !== 'object' || Array.isArray(o.criteria)) fail(`ops[${idx}].criteria must be an object like {"D":{"values":["未付"]}}`)
    const reader = cellReaderFor(content)
    const headers: Array<{ c: number; text: string }> = []
    for (let c = rect!.c0; c <= rect!.c1; c++) headers.push({ c, text: reader(rect!.r0, c).text.trim() })
    for (const [key, val] of Object.entries(o.criteria as Record<string, unknown>)) {
      // 键：列字母（"D"）或表头字（"付款狀態"）——一句话就能叫
      let col: number | null = null
      const k = key.trim()
      if (/^[A-Za-z]{1,3}$/.test(k) && !headers.some(h => h.text.toLowerCase() === k.toLowerCase())) col = colToIndex(k)
      else { const h = headers.find(x => x.text.toLowerCase() === k.toLowerCase()); col = h ? h.c : null }
      if (col === null || col < rect!.c0 || col > rect!.c1) fail(`ops[${idx}].criteria: "${key}" is not a column of the filter area ${rectA1(rect!)} (use a column letter or a header: ${headers.map(h => `${indexToCol(h.c)}=${h.text || '(blank)'}`).join(', ')})`)
      const letter = indexToCol(col!)
      if (val === null) { delete crit[letter]; continue }
      crit[letter] = criterionIn(val, `ops[${idx}].criteria.${key}`)
    }
  }
  content.filter = { range: rectRange(rect!), ...(Object.keys(crit).length ? { criteria: crit } : {}) }
  const eff = filterRect(content)!
  const hidden = filteredRows(content)
  return { op: 'filter', range: rectA1(eff), header_row: eff.r0 + 1, criteria: content.filter.criteria ?? {}, data_rows: eff.r1 - eff.r0, hidden_rows: hidden.size }
}

/** validate：{ range?, list? | source?, allow_blank?, reject_invalid?, clear? } */
function opValidate(content: ViewContent, o: Record<string, unknown>, idx: number, ctx: ViewOpCtx, warnings: string[]): ViewOpResult {
  const clear = optBool(o, 'clear', idx)
  const used = ctx.usedRange(content)
  const boundRect = (): Rect | null => {
    if (o.range === undefined || o.range === null) return null
    const a = ctx.parseA1(o.range)
    if (!a) fail(`ops[${idx}].range: bad A1 range "${String(o.range)}" (e.g. C2:C50, or C:C for the whole column)`)
    if (a!.kind === 'rows') fail(`ops[${idx}].range: give cells or columns like C2:C50 or C:C`)
    if (a!.kind === 'cols') return { r0: 0, r1: Math.max(DEFAULT_ROWS - 1, used?.r1 ?? 0), c0: a!.rect.c0, c1: a!.rect.c1 }
    return a!.rect
  }
  const rect = boundRect()
  if (clear) {
    if (o.list !== undefined || o.source !== undefined) fail(`ops[${idx}]: clear:true removes dropdowns — don't combine it with list or source`)
    const before = content.validations?.length ?? 0
    const next = clearValidations(content.validations, rect)
    if (next.length) content.validations = next; else delete content.validations
    return { op: 'validate', cleared: true, range: rect ? rectA1(rect) : 'all', remaining: next.length, removed_rules: Math.max(0, before - next.length) }
  }
  if (!rect) fail(`ops[${idx}].range is required (the cells that get the dropdown, e.g. C2:C50)`)
  const hasList = o.list !== undefined && o.list !== null, hasSrc = o.source !== undefined && o.source !== null
  if (hasList === hasSrc) fail(`ops[${idx}]: give exactly one of list (the options) or source (a range on this tab holding the options)`)
  const v: Omit<SheetValidation, 'id' | 'range'> = { type: 'list' }
  if (hasList) {
    if (!Array.isArray(o.list) || !o.list.length) fail(`ops[${idx}].list must be a non-empty list like ["已付","未付"]`)
    const arr = o.list as unknown[]
    if (arr.length > LIST_ITEMS_MAX) fail(`ops[${idx}].list: at most ${LIST_ITEMS_MAX} options`)
    for (const x of arr) {
      if (typeof x !== 'string' && !(typeof x === 'number' && Number.isFinite(x))) fail(`ops[${idx}].list items must be strings or numbers`)
      const s = String(x).trim()
      if (!s) fail(`ops[${idx}].list has an empty option`)
      if (s.includes(',')) fail(`ops[${idx}].list: option "${s}" contains a comma — Excel splits list options on commas; put the options in cells and use source instead`)
    }
    const items = cleanListItems(arr)
    const distinct = new Set(arr.map(x => String(x).trim())).size
    if (items.length < distinct) fail(`ops[${idx}].list is too long for an Excel dropdown (max ${LIST_CHARS_MAX} characters including separators) — put the options in cells and use source instead`)
    v.list = items
  } else {
    if (typeof o.source === 'string' && o.source.includes('!')) fail(`ops[${idx}].source must be a range on this same tab (like H2:H10)`)
    const a = ctx.parseA1(o.source)
    if (!a || a.kind === 'rows' || a.kind === 'cols') fail(`ops[${idx}].source must be a bounded range on this tab like H2:H10`)
    v.source = rectA1(a!.rect)
  }
  const allowBlank = optBool(o, 'allow_blank', idx), reject = optBool(o, 'reject_invalid', idx)
  if (allowBlank === false) v.allowBlank = false
  if (reject === false) v.showError = false
  const next = putValidation(content.validations, rect!, v)
  if (next.length > VALIDATIONS_MAX) fail(`ops[${idx}]: a tab holds at most ${VALIDATIONS_MAX} dropdown rules`)
  content.validations = next
  const added = next[next.length - 1]
  const opts = validationOptions(content, added)
  if (!opts.length) warnings.push(`ops[${idx}]: the source ${v.source} has no values yet, so the dropdown is empty until you fill it.`)
  // 区里已有、不在清单里的值：照留（Excel 同）·但告诉 AI
  const reader = cellReaderFor(content)
  let bad = 0
  for (const k of Object.keys(content.cells ?? {})) {
    const p = parseRef(k); if (!p || !rectContains(rect!, p.row, p.col)) continue
    const t = reader(p.row, p.col).text
    if (t.trim() !== '' && checkListInput(added, opts, t) !== 'ok') bad++
  }
  if (bad) warnings.push(`ops[${idx}]: ${bad} cell(s) in ${rectA1(rect!)} already hold a value that is not in the list (kept as is).`)
  return { op: 'validate', id: added.id, range: added.range, ...(added.list ? { list: added.list } : { source: added.source, options: opts.slice(0, 50) }), allow_blank: added.allowBlank !== false, reject_invalid: added.showError !== false }
}

/** hide：{ rows?: "2:5"|"5", cols?: "B:D"|"B", hidden?: true（缺省藏·false＝取消隐藏）, unhide_all?: true } */
function opHide(content: ViewContent, o: Record<string, unknown>, idx: number): ViewOpResult {
  const hide = optBool(o, 'hidden', idx) ?? true
  const all = optBool(o, 'unhide_all', idx)
  if (all) {
    if (o.rows !== undefined || o.cols !== undefined) fail(`ops[${idx}]: unhide_all:true shows every hidden row and column — don't combine it with rows or cols`)
    delete content.hiddenRows; delete content.hiddenCols
  } else {
    if ((o.rows === undefined || o.rows === null) && (o.cols === undefined || o.cols === null)) fail(`ops[${idx}]: give rows (like "2:5" or "7") and/or cols (like "B:D" or "C")`)
    if (o.rows !== undefined && o.rows !== null) {
      const m = typeof o.rows === 'string' ? /^\s*(\d{1,7})\s*(?::\s*(\d{1,7})\s*)?$/.exec(o.rows) : typeof o.rows === 'number' && isInt(o.rows) ? [String(o.rows), String(o.rows)] as unknown as RegExpExecArray : null
      const a = m ? Number(m[1]) : NaN, b = m ? Number(m[2] ?? m[1]) : NaN
      if (!m || a < 1 || b < 1 || a - 1 > MAX_ROW_IDX || b - 1 > MAX_ROW_IDX) fail(`ops[${idx}].rows must be row numbers like "2:5" or "7"`)
      content.hiddenRows = setHidden(content.hiddenRows, a - 1, b - 1, hide)
      if (!content.hiddenRows) delete content.hiddenRows
    }
    if (o.cols !== undefined && o.cols !== null) {
      const m = typeof o.cols === 'string' ? /^\s*\$?([A-Za-z]{1,3})\s*(?::\s*\$?([A-Za-z]{1,3})\s*)?$/.exec(o.cols) : null
      const a = m ? colToIndex(m[1]) : NaN, b = m ? colToIndex(m[2] ?? m[1]) : NaN
      if (!m || a > MAX_COL_IDX || b > MAX_COL_IDX) fail(`ops[${idx}].cols must be column letters like "B:D" or "C"`)
      content.hiddenCols = setHidden(content.hiddenCols, a, b, hide)
      if (!content.hiddenCols) delete content.hiddenCols
    }
  }
  return { op: 'hide', hidden_rows: (content.hiddenRows ?? []).slice(0, VIEW_HIDDEN_ROWS_LIST_MAX).map(r => r + 1), hidden_cols: (content.hiddenCols ?? []).slice(0, VIEW_HIDDEN_ROWS_LIST_MAX).map(c => indexToCol(c)), hidden_row_count: content.hiddenRows?.length ?? 0, hidden_col_count: content.hiddenCols?.length ?? 0 }
}

export const VIEW_OP_NAMES = ['freeze', 'filter', 'validate', 'hide'] as const
export function applyViewOp(content: ViewContent, o: Record<string, unknown>, idx: number, ctx: ViewOpCtx, warnings: string[]): ViewOpResult {
  switch (o.op) {
    case 'freeze': return opFreeze(content, o, idx)
    case 'filter': return opFilter(content, o, idx, ctx)
    case 'validate': return opValidate(content, o, idx, ctx, warnings)
    case 'hide': return opHide(content, o, idx)
  }
  return fail(`ops[${idx}].op is not a view op`)
}

// ── get_sheet 回包：冻结／筛选／验证的现况 ─────────────────────────────────

export type ViewOut = {
  freeze?: { rows: number; cols: number; top_left_cell: string }
  filter?: { range: string; header_row: number; criteria: Record<string, FilterCriterion>; hidden_rows: number[]; hidden_count: number }
  validations?: Array<{ id: string; range: string; list?: string[]; source?: string; allow_blank: boolean; reject_invalid: boolean }>
  /** 手动隐藏的行（1 起）／栏（字母）·筛选藏的行在 filter.hidden_rows */
  hidden?: { rows: number[]; cols: string[]; row_count: number; col_count: number }
}
export const VIEW_HIDDEN_ROWS_LIST_MAX = 200
export function viewOut(content: ViewContent | null | undefined, rect?: Rect | null): ViewOut {
  const out: ViewOut = {}
  const f = sanitizeFreeze(content?.freeze)
  if (f) out.freeze = { ...f, top_left_cell: cellKey(f.rows, f.cols) }
  const eff = filterRect(content)
  if (eff && content?.filter) {
    const hidden = [...filteredRows(content)].sort((a, b) => a - b)
    out.filter = { range: rectA1(eff), header_row: eff.r0 + 1, criteria: content.filter.criteria ?? {}, hidden_rows: hidden.slice(0, VIEW_HIDDEN_ROWS_LIST_MAX).map(r => r + 1), hidden_count: hidden.length }
  }
  const vs = (content?.validations ?? []).filter(v => { if (!rect) return true; const r = parseRect(v.range); return !!r && rectsOverlap(r, rect) })
  if (vs.length) out.validations = vs.map(v => ({ id: v.id, range: v.range, ...(v.list ? { list: v.list } : { source: v.source }), allow_blank: v.allowBlank !== false, reject_invalid: v.showError !== false }))
  const hr = sanitizeHidden(content?.hiddenRows, MAX_ROW_IDX), hc = sanitizeHidden(content?.hiddenCols, MAX_COL_IDX)
  if (hr || hc) out.hidden = { rows: (hr ?? []).slice(0, VIEW_HIDDEN_ROWS_LIST_MAX).map(r => r + 1), cols: (hc ?? []).slice(0, VIEW_HIDDEN_ROWS_LIST_MAX).map(c => indexToCol(c)), row_count: hr?.length ?? 0, col_count: hc?.length ?? 0 }
  return out
}
