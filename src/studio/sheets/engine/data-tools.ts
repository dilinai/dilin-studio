// 表格「尋找／取代」與「移除重複」纯函数
//   ⛔ 不碰库、不碰 React：网页对话框（ui/SheetFindDialog、ui/SheetDedupeDialog）与 AI 操作（agent-ops applyOps 的 find／replace／dedupe）同调这一份。
//   口径照 Excel：
//     尋找：逐列（一列由左到右·再下一列）；比的是「公式」（格里的原文·公式格比公式字）或「值」（格子显示的字·套过数字格式）；
//           认通配 * ? ~（~* 找星号）；可分大小写、可要求整格相符。
//     取代：只改原文（Excel 取代对话框也只有「公式」一种）；预设不动公式格（改坏引用难收拾）——要改公式格得明说 includeFormulas。
//     移除重复：在选的范围里，指定几栏（预设全部）的值都一样的列只留第一列·后面重复的整列从范围里拿掉、下面的往上补
//               （只动范围内的格·范围外不动·同 Excel「移除重複項目」）；比的是算出来的值：数字照数字比·文字不分大小写·空白算一种值。
//   借鉴：通配转正则用 ./formula-lib wildcardSource（COUNTIF／SEARCH 同一份）；搬动的公式照排序同口径平移（./formula-refs shiftFormula·复制口径）。

import { cellKey, parseRef, SheetEvaluator, isFormulaError, type CellData, type SheetCells, type SheetContent, type EvaluatorOptions } from './formula'
import { wildcardSource, to15 } from './formula-lib'
import { shiftFormula } from './formula-refs'
import { parseRange, rectsOverlap, rectContains, type Rect } from './style'
import { cellReaderFor } from './sheet-view'

/** 一次最多回几个找到的格（再多也只数数） */
export const FIND_HITS_MAX = 10_000
const MAX_ROWS = 999_999, MAX_COLS = 18_278

export class DataToolError extends Error {
  code: string
  constructor(message: string, code = 'err_sheet_bad_op') { super(message); this.code = code }
}

export type FindLookIn = 'formulas' | 'values'
export type FindOptions = {
  find: string
  matchCase?: boolean
  /** 整格相符（整段原文／显示字就是要找的字） */
  wholeCell?: boolean
  /** formulas＝比原文（缺省）·values＝比显示的字 */
  lookIn?: FindLookIn
  /** 只在这块里找·省＝整张 */
  rect?: Rect | null
}
export type FindHit = { cell: string; row: number; col: number; text: string; formula: boolean }

/** 要找的字 ⇒ 正则（通配 * ? ~·整格 ⇒ 锚定头尾） */
export function findRegex(o: Pick<FindOptions, 'find' | 'matchCase' | 'wholeCell'>, global = false): RegExp {
  if (!o.find) throw new DataToolError('find must not be empty')
  const src = wildcardSource(o.find)
  return new RegExp(o.wholeCell ? `^(?:${src})$` : src, (o.matchCase ? '' : 'i') + (global ? 'g' : ''))
}

/** 有内容的格（逐列由上而下·一列由左到右）·落在 rect 里的 */
function orderedKeys(cells: SheetCells, rect?: Rect | null): Array<{ k: string; r: number; c: number }> {
  const out: Array<{ k: string; r: number; c: number }> = []
  for (const k of Object.keys(cells)) {
    const p = parseRef(k); if (!p) continue
    if (rect && !rectContains(rect, p.row, p.col)) continue
    const cd = cells[k]
    if (!((typeof cd.v === 'string' && cd.v !== '') || (typeof cd.f === 'string' && cd.f.trim() !== ''))) continue
    out.push({ k: cellKey(p.row, p.col), r: p.row, c: p.col })
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c)
}

/** 原文：公式格＝公式字·其余＝打进去的字 */
export function rawInput(cd: CellData | undefined): string { return cd?.f ? cd.f : cd?.v ?? '' }

/** 尋找：回找到的格（依序·至多 FIND_HITS_MAX）＋总数 */
export function findCells(content: SheetContent | null | undefined, o: FindOptions, evalOpts?: EvaluatorOptions): { hits: FindHit[]; total: number } {
  const re = findRegex(o)
  const cells = content?.cells ?? {}
  const read = o.lookIn === 'values' ? cellReaderFor(content, 'zh', evalOpts) : null
  const hits: FindHit[] = []
  let total = 0
  for (const { k, r, c } of orderedKeys(cells, o.rect)) {
    const cd = cells[k]
    const text = read ? read(r, c).text : rawInput(cd)
    if (!re.test(text)) continue
    total++
    if (hits.length < FIND_HITS_MAX) hits.push({ cell: k, row: r, col: c, text, formula: !!cd.f })
  }
  return { hits, total }
}

export type ReplaceOptions = Omit<FindOptions, 'lookIn'> & {
  replace: string
  /** 连公式格的公式字也改（缺省 false：公式格跳过·回报跳过几格） */
  includeFormulas?: boolean
  /** 只改这几格（网页「取代」一次一格用）·省＝范围里全部 */
  only?: readonly string[]
}
export type ReplaceResult = { cells: SheetCells; changed: Array<{ cell: string; before: string; after: string }>; skippedFormulas: number }

/** 取代：回新的 cells（只复制改到的格）·改了哪些格·因为是公式而跳过几格 */
export function replaceCells(content: SheetContent | null | undefined, o: ReplaceOptions): ReplaceResult {
  const re = findRegex(o, true)
  const src = content?.cells ?? {}
  const cells: SheetCells = { ...src }
  const only = o.only ? new Set(o.only.map(k => k.toUpperCase())) : null
  const changed: ReplaceResult['changed'] = []
  let skippedFormulas = 0
  for (const { k } of orderedKeys(src, o.rect)) {
    if (only && !only.has(k)) continue
    const cd = src[k]
    const before = rawInput(cd)
    re.lastIndex = 0
    if (!re.test(before)) continue
    if (cd.f && !o.includeFormulas) { skippedFormulas++; continue }
    re.lastIndex = 0
    const after = o.wholeCell ? o.replace : before.replace(re, () => o.replace)
    if (after === before) continue
    let next: CellData
    if (cd.f) next = after.trim().startsWith('=') && after.trim().length > 1 ? { ...cd, v: '', f: after.trim() } : { ...cd, v: after, f: undefined }
    else next = { ...cd, v: after }
    if (next.f === undefined) delete next.f
    if ((next.v ?? '') === '' && !next.f) { if (next.s) cells[k] = { s: next.s }; else delete cells[k] }
    else cells[k] = next
    changed.push({ cell: k, before, after })
  }
  return { cells, changed, skippedFormulas }
}

export type DedupeOptions = {
  /** 比哪几栏（0 起的栏号·都要在 rect 里）·省＝范围里每一栏 */
  columns?: readonly number[]
  /** 第一列是表头（不比、不动） */
  hasHeader?: boolean
}
export type DedupeResult = { cells: SheetCells; removed: number; kept: number; removedRows: number[]; brokenRefs: number }

/** 一格的比对键：数字照 15 位·文字不分大小写·空白一种·错误照错误码 */
function dupKey(v: ReturnType<SheetEvaluator['value']>): string {
  if (v === null || v === '') return 'e'
  if (typeof v === 'number') return 'n' + to15(v)
  if (isFormulaError(v)) return 'x' + v
  return 's' + v.toLowerCase()
}

/** 移除重复：回新的 cells·拿掉几列·剩几列·拿掉的是原本第几列（0 起） */
export function removeDuplicates(content: SheetContent | null | undefined, rect: Rect, o: DedupeOptions = {}, evalOpts?: EvaluatorOptions): DedupeResult {
  const src = content?.cells ?? {}
  if ((content?.merges ?? []).some(m => { const r = parseRange(m); return !!r && rectsOverlap(r, rect) })) throw new DataToolError('the range contains merged cells — unmerge them first to remove duplicates')
  const cols = o.columns && o.columns.length ? [...new Set(o.columns)] : Array.from({ length: rect.c1 - rect.c0 + 1 }, (_, i) => rect.c0 + i)
  for (const c of cols) if (c < rect.c0 || c > rect.c1) throw new DataToolError(`column ${c + 1} is outside the range`)
  const start = rect.r0 + (o.hasHeader ? 1 : 0)
  const ev = new SheetEvaluator(src, content?.merges, evalOpts)
  const seen = new Set<string>()
  const keepRows: number[] = [], removedRows: number[] = []
  for (let r = start; r <= rect.r1; r++) {
    const key = cols.map(c => dupKey(ev.value(cellKey(r, c)))).join('\u0001')
    if (seen.has(key)) removedRows.push(r)
    else { seen.add(key); keepRows.push(r) }
  }
  const cells: SheetCells = { ...src }
  let brokenRefs = 0
  if (removedRows.length) {
    const rowCells = (r: number) => { const m = new Map<number, CellData>(); for (let c = rect.c0; c <= rect.c1; c++) { const cd = src[cellKey(r, c)]; if (cd) m.set(c, cd) } return m }
    const kept = keepRows.map(r => ({ src: r, cells: rowCells(r) }))
    for (let r = start; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) delete cells[cellKey(r, c)]
    kept.forEach((row, i) => {
      const target = start + i
      for (const [c, cd] of row.cells) {
        const copy: CellData = { ...cd }
        if (copy.f && target !== row.src) {
          const f = shiftFormula(copy.f, target - row.src, 0, MAX_ROWS, MAX_COLS)
          brokenRefs += Math.max(0, f.split('#REF!').length - copy.f.split('#REF!').length)
          copy.f = f
        }
        cells[cellKey(target, c)] = copy
      }
    })
  }
  return { cells, removed: removedRows.length, kept: keepRows.length, removedRows, brokenRefs }
}

