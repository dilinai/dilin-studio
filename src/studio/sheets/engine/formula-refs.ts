// 公式里的引用：扫出每个引用的位置／平移（填充柄／复制时相对引用跟着走·$ 绝对不动·越界 ⇒ #REF!）
// 公式 ⇒ 相对引用平移（$ 绝对引用不动）；点格带入·引用上色
//
// 平移规则抄自 univer（Apache-2.0·Copyright 2023-present DreamNum Co., Ltd.）：
//   packages/engine-formula/src/engine/analysis/lexer-tree-builder.ts  moveFormulaRefOffset（逐个引用平移·移出界 ⇒ ErrorType.REF 即 #REF!·字串原样）
//   packages/core/src/shared/range.ts                                    moveRangeByOffset（$A$1 全绝对不动·$A1 只动行·A$1 只动列·区间两端各自判）
// 已修改（Apache-2.0 §4(b) 修改声明）：univer 用它自己的完整词法树（sequenceNodesBuilder）认引用；这里改成对本仓小引擎（formula.ts）够用的
//   扫描器——跳过双引号字串·按「前一字不是字母数字底线 $ .、后面不接字母数字底线 (」认 [$]列[$]行·A1:B3 连成一段；不支持整行引用。
//   整列引用 A:A／$A:B（引擎 formula.ts 认得）另由 scanWholeCols 扫，只在 shiftFormula 平移时用。
//   跨表前缀（表格2!A1／'销售 表'!A1:B5）：前缀本身不当引用扫（Q1!A1 的 Q1 不是格位）·后面那段引用带 sheet（页签名）＋pre（前缀起点）；
//     填充／复制平移照样动（Excel 口径）；页签改名／汇出换名走 rewriteSheetRefs。
//   插删行列（shiftFormulaForStruct）：只挪指向被插删那张的引用——本张没写前缀的＋任何一张里写了那张前缀的（表格2!A1 ⇒ 表格2!A2）；
//     $ 照样挪（插删跟复制不同·Excel 口径）；整段被删 ⇒ #REF!（带前缀的留前缀＝表格2!#REF!·同 Excel）。

import { REF_AT_RE, indexToCol, colToIndex, sheetPrefixAt, sheetKey, quoteSheetName, type SheetContent, type SheetCells } from './formula'

export type RefPart = { start: number; end: number; col: number; row: number; colAbs: boolean; rowAbs: boolean }
/** 一段引用：单格（b 省）或区间 A1:B3（a、b 两端）；跨表的带 sheet（页签名）与 pre（前缀起点·start 仍是格位起点） */
export type RefSpan = { start: number; end: number; a: RefPart; b?: RefPart; sheet?: string; pre?: number }

const WORDISH = /[A-Za-z0-9_$.]/
const NAMEISH = /[A-Za-z0-9_$. -￿]/
/** 第 i 字是词首且起一个页签前缀 ⇒ 那个前缀 */
function prefixAt(src: string, i: number): { name: string; end: number } | null {
  if (i > 0 && (NAMEISH.test(src[i - 1]) || src[i - 1] === "'")) return null
  return sheetPrefixAt(src, i)
}
/** 跳过一段单引号括起的字（前缀没认成时·别让里面的字被当引用） */
function skipQuoted(src: string, i: number): number {
  let j = i + 1
  while (j < src.length) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue } return j + 1 } j++ }
  return j
}

function refAt(src: string, i: number): RefPart | null {
  if (i > 0 && WORDISH.test(src[i - 1])) return null
  const m = REF_AT_RE.exec(src.slice(i))
  if (!m) return null
  if (src[i + m[0].length] === '(') return null   // 后面接左括号 ⇒ 是函数名（如 LOG10(）不是引用
  const row = Number(m[4]) - 1
  if (row < 0) return null
  return { start: i, end: i + m[0].length, col: colToIndex(m[2]), row, colAbs: m[1] === '$', rowAbs: m[3] === '$' }
}

/** 扫出公式里全部引用（按出现顺序）；字串 "…" 里的不算 */
export function scanRefs(src: string): RefSpan[] {
  const out: RefSpan[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {   // 字串：到下一个未成对的引号（"" 是转义）
      i++
      while (i < src.length) { if (src[i] === '"') { if (src[i + 1] === '"') { i += 2; continue } i++; break } i++ }
      continue
    }
    // 跨表前缀：认了就接着认后面那段引用（带上页签名）；后面不是格位（整列 A:A 归 scanWholeCols）⇒ 跳过前缀
    const pre = (ch === "'" || /[A-Za-z_ -￿]/.test(ch)) ? prefixAt(src, i) : null
    let sheet: { sheet: string; pre: number } | null = null
    if (pre) { sheet = { sheet: pre.name, pre: i }; i = pre.end }
    else if (ch === "'") { i = skipQuoted(src, i); continue }
    const c0 = src[i] ?? ''
    const a = (c0 === '$' || /[A-Za-z]/.test(c0)) ? (sheet ? refAt2(src, i) : refAt(src, i)) : null
    if (!a) {
      if (sheet) continue
      if (/[A-Za-z_]/.test(c0)) { const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i)); i += w ? w[0].length : 1 }   // 整个词跳过（免得 LOG10 里的 G10 被认成引用）
      else i++
      continue
    }
    if (src[a.end] === ':') {
      // 第二端前可再写一次同一张的前缀（表格2!A1:表格2!B5）
      const p2 = sheet ? sheetPrefixAt(src, a.end + 1) : null
      const bAt = p2 && sheetKey(p2.name) === sheetKey(sheet!.sheet) ? p2.end : a.end + 1
      const b = refAt2(src, bAt)
      if (b) { out.push({ start: a.start, end: b.end, a, b, ...sheet }); i = b.end; continue }
    }
    out.push({ start: a.start, end: a.end, a, ...sheet })
    i = a.end
  }
  return out
}
/** 冒号后的第二端（冒号本身不是 WORDISH·直接认） */
function refAt2(src: string, i: number): RefPart | null {
  const m = REF_AT_RE.exec(src.slice(i))
  if (!m || src[i + m[0].length] === '(') return null
  const row = Number(m[4]) - 1
  if (row < 0) return null
  return { start: i, end: i + m[0].length, col: colToIndex(m[2]), row, colAbs: m[1] === '$', rowAbs: m[3] === '$' }
}

/** 整列引用一段：A:A／$A:$C（两端各有 $ 记号） */
export type ColSpan = { start: number; end: number; a: { col: number; abs: boolean }; b: { col: number; abs: boolean }; sheet?: string; pre?: number }
const WHOLE_COL_AT = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.(])/
/** 扫出公式里的整列引用（字串 "…" 里的不算；前一字是字母数字底线 $ . : 的不算）；跨表的（表格2!A:A）带 sheet／pre */
export function scanWholeCols(src: string): ColSpan[] {
  const out: ColSpan[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {
      i++
      while (i < src.length) { if (src[i] === '"') { if (src[i + 1] === '"') { i += 2; continue } i++; break } i++ }
      continue
    }
    const pre = (ch === "'" || /[A-Za-z_ -￿]/.test(ch)) ? prefixAt(src, i) : null
    if (pre) {
      const m = WHOLE_COL_AT.exec(src.slice(pre.end))
      if (m) {
        const end = pre.end + m[0].length
        out.push({ start: pre.end, end, a: { col: colToIndex(m[2]), abs: m[1] === '$' }, b: { col: colToIndex(m[4]), abs: m[3] === '$' }, sheet: pre.name, pre: i })
        i = end
      } else i = pre.end
      continue
    }
    if (ch === "'") { i = skipQuoted(src, i); continue }
    if ((ch === '$' || /[A-Za-z]/.test(ch)) && !(i > 0 && (WORDISH.test(src[i - 1]) || src[i - 1] === ':'))) {
      const m = WHOLE_COL_AT.exec(src.slice(i))
      if (m) {
        out.push({ start: i, end: i + m[0].length, a: { col: colToIndex(m[2]), abs: m[1] === '$' }, b: { col: colToIndex(m[4]), abs: m[3] === '$' } })
        i += m[0].length
        continue
      }
    }
    if (/[A-Za-z_]/.test(ch)) { const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i)); i += w ? w[0].length : 1 }
    else i++
  }
  return out
}

export function refPartText(p: Pick<RefPart, 'col' | 'row' | 'colAbs' | 'rowAbs'>): string {
  return `${p.colAbs ? '$' : ''}${indexToCol(p.col)}${p.rowAbs ? '$' : ''}${p.row + 1}`
}

/**
 * 平移公式里的相对引用（univer moveFormulaRefOffset 口径）：dRow／dCol＝目标格减来源格；
 * $ 那一维不动；任一端移出 [0, maxRows)×[0, maxCols) ⇒ 整段换 #REF!。非公式（不以 = 开头）原样回。
 */
export function shiftFormula(f: string, dRow: number, dCol: number, maxRows = Infinity, maxCols = Infinity): string {
  if (!f.trim().startsWith('=') || (dRow === 0 && dCol === 0)) return f
  // 一般引用＋整列引用（整列只跟着列走·Excel 口径：=SUM(A:A) 往右拖一格 ⇒ =SUM(B:B)、往下拖不变）
  type Edit = { start: number; end: number; text: string }
  const edits: Edit[] = []
  const spans = scanRefs(f)
  if (!spans.length && !/:/.test(f)) return f
  let out = ''
  let last = 0
  const move = (p: RefPart): RefPart | null => {
    const row = p.rowAbs ? p.row : p.row + dRow
    const col = p.colAbs ? p.col : p.col + dCol
    if (row < 0 || col < 0 || row >= maxRows || col >= maxCols) return null
    return { ...p, row, col }
  }
  for (const sp of spans) {
    const a = move(sp.a)
    const b = sp.b ? move(sp.b) : undefined
    edits.push({ start: sp.start, end: sp.end, text: !a || b === null ? '#REF!' : refPartText(a) + (b ? ':' + refPartText(b) : '') })
  }
  for (const cs of scanWholeCols(f)) {
    if (spans.some(sp => sp.start < cs.end && cs.start < sp.end)) continue
    const mv = (p: { col: number; abs: boolean }) => { const col = p.abs ? p.col : p.col + dCol; return col < 0 || col >= maxCols ? null : `${p.abs ? '$' : ''}${indexToCol(col)}` }
    const a = mv(cs.a), b = mv(cs.b)
    edits.push({ start: cs.start, end: cs.end, text: a === null || b === null ? '#REF!' : `${a}:${b}` })
  }
  if (!edits.length) return f
  edits.sort((x, y) => x.start - y.start)
  for (const e of edits) { out += f.slice(last, e.start) + e.text; last = e.end }
  return out + f.slice(last)
}

// ── 插删行列（结构变动）──
export type StructAxis = 'row' | 'col'
/** 一次插删：insert＝在第 at 条之前（0 起）插 count 条；delete＝删掉 [at, at+count-1] */
export type StructChange = { axis: StructAxis; mode: 'insert' | 'delete'; at: number; count: number }
/**
 * 哪些引用要挪：local＝这条公式就在被插删那张上（没写前缀的引用指的是它）；
 * sheet＝被插删那张的页签名（写了这个前缀的引用也挪·不分大小写·省 ⇒ 带前缀的一律不动）；maxRow／maxCol＝最末一行／列（0 起·推出去 ⇒ #REF!）
 */
export type StructScope = { local: boolean; sheet?: string | null; maxRow: number; maxCol: number }

/** 一维端点：插入 ⇒ 落在 at 之后（含）的往后推；删除见 structSpan */
function structPoint(v: number, ch: StructChange): number | null {
  if (ch.mode === 'insert') return v >= ch.at ? v + ch.count : v
  const end = ch.at + ch.count - 1
  if (v >= ch.at && v <= end) return null
  return v > end ? v - ch.count : v
}
/** 一段 [lo,hi] 的端点（fortune-sheet functionStrChange_range 口径）：整段被删 ⇒ null；部分被删 ⇒ 收缩；插在中间 ⇒ 撑大 */
function structSpan(lo: number, hi: number, ch: StructChange): [number, number] | null {
  if (ch.mode === 'insert') return [lo >= ch.at ? lo + ch.count : lo, hi >= ch.at ? hi + ch.count : hi]
  const end = ch.at + ch.count - 1
  if (lo >= ch.at && hi <= end) return null
  let s = lo, e = hi
  if (s > end) s -= ch.count; else if (s >= ch.at) s = ch.at
  if (e > end) e -= ch.count; else if (e >= ch.at) e = ch.at - 1
  if (e < s) e = s
  return [s, e]
}

/**
 * 插删行列后改写一条公式（Excel 口径）：scope 指定的那张上的引用跟着挪（$ 也挪）；整列 A:A 只随插删列动；
 * 删掉的单格／整段 ⇒ #REF!（前缀留着：表格2!#REF!）·推出表格边 ⇒ #REF!；指向别张的、字串里的不动。broken＝这次新变 #REF! 的段数。
 * 区间第二端写了前缀（表格2!A1:表格2!B5）且要改 ⇒ 收成只在最前写一次。非公式原样回。
 */
export function shiftFormulaForStruct(f: string, ch: StructChange, scope: StructScope): { f: string; broken: number } {
  if (!f.trim().startsWith('=') || ch.count <= 0) return { f, broken: 0 }
  const want = scope.sheet ? sheetKey(scope.sheet) : null
  const mine = (sheet: string | undefined) => (sheet === undefined ? scope.local : want !== null && sheetKey(sheet) === want)
  const max = ch.axis === 'row' ? scope.maxRow : scope.maxCol
  type Edit = { start: number; end: number; text: string }
  const edits: Edit[] = []
  let broken = 0
  const spans = scanRefs(f)
  for (const sp of spans) {
    if (!mine(sp.sheet)) continue
    const get = (p: RefPart) => (ch.axis === 'row' ? p.row : p.col)
    const put = (p: RefPart, v: number): RefPart => (ch.axis === 'row' ? { ...p, row: v } : { ...p, col: v })
    let text: string | null
    if (!sp.b) {
      const v = structPoint(get(sp.a), ch)
      text = v === null || v > max ? null : v === get(sp.a) ? '' : refPartText(put(sp.a, v))
    } else {
      const v1 = get(sp.a), v2 = get(sp.b)
      const swapped = v1 > v2
      const r = structSpan(Math.min(v1, v2), Math.max(v1, v2), ch)
      if (!r || r[1] > max) text = null
      else if (r[0] === Math.min(v1, v2) && r[1] === Math.max(v1, v2)) text = ''
      else text = `${refPartText(put(sp.a, swapped ? r[1] : r[0]))}:${refPartText(put(sp.b, swapped ? r[0] : r[1]))}`
    }
    if (text === '') continue
    if (text === null) broken++
    edits.push({ start: sp.start, end: sp.end, text: text ?? '#REF!' })
  }
  if (ch.axis === 'col') {
    for (const cs of scanWholeCols(f)) {
      if (spans.some(sp => sp.start < cs.end && cs.start < sp.end) || !mine(cs.sheet)) continue
      const lo = Math.min(cs.a.col, cs.b.col), hi = Math.max(cs.a.col, cs.b.col)
      const r = structSpan(lo, hi, ch)
      if (r && r[0] === lo && r[1] === hi) continue
      if (!r || r[1] > max) { broken++; edits.push({ start: cs.start, end: cs.end, text: '#REF!' }); continue }
      const [ea, eb] = cs.a.col <= cs.b.col ? [cs.a, cs.b] : [cs.b, cs.a]
      edits.push({ start: cs.start, end: cs.end, text: `${ea.abs ? '$' : ''}${indexToCol(r[0])}:${eb.abs ? '$' : ''}${indexToCol(r[1])}` })
    }
  }
  if (!edits.length) return { f, broken: 0 }
  edits.sort((x, y) => x.start - y.start)
  let out = '', last = 0
  for (const e of edits) { out += f.slice(last, e.start) + e.text; last = e.end }
  return { f: out + f.slice(last), broken }
}

/** 一张页签内容里的公式照 changes 依序改写（scope 同上）；没有一格变 ⇒ null（呼叫方据此判要不要写回） */
export function shiftContentForStruct<T extends SheetContent>(content: T | null | undefined, changes: readonly StructChange[], scope: StructScope): { content: T; broken: number } | null {
  const cells = content?.cells
  if (!content || !cells || !changes.length) return null
  let next: SheetCells | null = null
  let broken = 0
  for (const [k, cd] of Object.entries(cells)) {
    if (!cd?.f) continue
    let f = cd.f
    for (const ch of changes) { const r = shiftFormulaForStruct(f, ch, scope); f = r.f; broken += r.broken }
    if (f === cd.f) continue
    next = next ?? { ...cells }
    next[k] = { ...cd, f }
  }
  return next ? { content: { ...content, cells: next }, broken } : null
}

/** 跨表前缀后面直接接 #REF!（插删行列删掉的跨表引用·Excel 写法 表格2!#REF!）：前缀起点／名字／整段止点（字串里的不算） */
function scanSheetErrRefs(src: string): Array<{ pre: number; start: number; end: number; sheet: string }> {
  const out: Array<{ pre: number; start: number; end: number; sheet: string }> = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {
      i++
      while (i < src.length) { if (src[i] === '"') { if (src[i + 1] === '"') { i += 2; continue } i++; break } i++ }
      continue
    }
    const pre = (ch === "'" || /[A-Za-z_ -￿]/.test(ch)) ? prefixAt(src, i) : null
    if (pre) {
      if (src.startsWith('#REF!', pre.end)) out.push({ pre: i, start: pre.end, end: pre.end + 5, sheet: pre.name })
      i = pre.end
      continue
    }
    if (ch === "'") { i = skipQuoted(src, i); continue }
    if (/[A-Za-z_]/.test(ch)) { const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i)); i += w ? w[0].length : 1 }
    else i++
  }
  return out
}

// ── 跨表前缀改写（页签改名·汇出 xlsx 换成档里的表名）──
/**
 * 公式里每段跨表引用的前缀改写：fn(页签名) 回 { name }＝换成这个名（照规则重新加引号）·'ref'＝整段引用换成 #REF!（那张不在了）·null＝不动。
 *   ascii＝加引号用最保守的口径（写进 xlsx 档）。非公式原样回。
 */
export function rewriteSheetRefs(f: string, fn: (name: string) => { name: string } | 'ref' | null, o: { ascii?: boolean } = {}): string {
  if (!f.trim().startsWith('=') || !f.includes('!')) return f
  type Edit = { start: number; end: number; text: string }
  const edits: Edit[] = []
  const spans: Array<{ pre?: number; start: number; end: number; sheet?: string }> = [...scanRefs(f)]
  for (const cs of scanWholeCols(f)) if (!spans.some(sp => sp.start < cs.end && cs.start < sp.end)) spans.push(cs)
  spans.push(...scanSheetErrRefs(f))   // 表格2!#REF!（插删删掉的跨表引用）：前缀照样跟着改名／换档里名
  for (const sp of spans) {
    if (sp.sheet === undefined || sp.pre === undefined) continue
    const r = fn(sp.sheet)
    if (r === null) continue
    if (r === 'ref') { edits.push({ start: sp.pre, end: sp.end, text: '#REF!' }); continue }
    // 区间第二端若也写了前缀（表格2!A1:表格2!B5）⇒ 一并换（一律收成只在最前写一次）
    const body = f.slice(sp.start, sp.end).replace(/:(?:'(?:[^']|'')*'|[^:!'"]+)!/, ':')
    edits.push({ start: sp.pre, end: sp.end, text: `${quoteSheetName(r.name, o)}!${body}` })
  }
  if (!edits.length) return f
  edits.sort((x, y) => x.start - y.start)
  let out = '', last = 0
  for (const e of edits) { out += f.slice(last, e.start) + e.text; last = e.end }
  return out + f.slice(last)
}

/** 页签 from 改名成 to：公式里指向 from 的前缀都换成 to（不分大小写比对） */
export function renameSheetInFormula(f: string, from: string, to: string): string {
  const k = sheetKey(from)
  return rewriteSheetRefs(f, name => (sheetKey(name) === k ? { name: to } : null))
}

/** 一张页签内容里所有公式跟着改名；没有一格变 ⇒ null（呼叫方据此判要不要写回） */
export function renameSheetInContent<T extends SheetContent>(content: T | null | undefined, from: string, to: string): T | null {
  const cells = content?.cells
  if (!content || !cells) return null
  let next: SheetCells | null = null
  for (const [k, cd] of Object.entries(cells)) {
    if (!cd?.f) continue
    const f = renameSheetInFormula(cd.f, from, to)
    if (f === cd.f) continue
    next = next ?? { ...cells }
    next[k] = { ...cd, f }
  }
  return next ? { ...content, cells: next } : null
}
