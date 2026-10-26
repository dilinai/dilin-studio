// 表格公式引擎
//   自己写的小解析求值：四则／括号／单元格引用（A1）／区间（A1:B3）／SUM／AVERAGE／MIN／MAX／COUNT／循环引用报错。
//   ⛔ 不引 hyperformula 那种大库；做法（原始值 v／公式 f 分存·求值带缓存与循环栈）只参考了 fortune-sheet（MIT）的结构·代码全是这里现写的。
//   内容形状（按 sheet 存 JSON）：{ cells: { A1: { v: '12' }, B1: { v: '', f: '=SUM(A1:A3)' } } }
//     v＝用户原始输入（字串）；f＝以 = 开头的公式原文（有 f 时 v 忽略）。求值结果不落库·读时现算。
//   格式 s（CellStyle·只管显示）＋ merges（合并区·引用被盖住的格取左上）＋ images（浮图）——型别与净化在 ./style.ts
//   引用认 $ 绝对记号（$A$1／A$1／$A1·求值时 $ 不影响取值·
//     只管填充／复制时平移不平移——平移在 ./fill.ts）；加 NA()⇒#N/A；算出非有限数（溢出）⇒ #NUM!；
//     colWidths／rowHeights（列宽行高·拖改后存）进 SheetContent（型别与净化在 ./layout.ts）。
//   字串 "…"、比较 = <> < > <= >=、串接 &、乘方 ^、百分 %、
//     TRUE／FALSE、整列 A:A、区间参与运算（逐格·SUMPRODUCT((A1:A9="x")*B1:B9)）＋下列函数（行为照 Excel·依据见各段注与 formula.test.ts）：
//     逻辑 IF IFS AND OR NOT IFERROR IFNA SWITCH｜数学统计 ROUND ROUNDUP ROUNDDOWN ABS INT MOD SUMPRODUCT SUMIF SUMIFS COUNTIF COUNTIFS
//     AVERAGEIF COUNTA COUNTBLANK MAXIFS MINIFS MEDIAN RANK LARGE SMALL｜查找 VLOOKUP XLOOKUP INDEX MATCH CHOOSE｜文字 CONCAT TEXTJOIN
//     LEFT RIGHT MID LEN TRIM UPPER LOWER TEXT VALUE SUBSTITUTE FIND｜日期 TODAY NOW DATE YEAR MONTH DAY WEEKDAY DATEDIF EOMONTH。
//     第二批：数学 PRODUCT POWER SQRT SIGN PI EXP LN LOG LOG10 TRUNC CEILING FLOOR CEILING.MATH FLOOR.MATH MROUND EVEN ODD QUOTIENT GCD LCM
//     FACT RAND RANDBETWEEN SUMSQ｜统计 AVERAGEIFS STDEV(.S/.P) STDEVP VAR(.S/.P) VARP MODE(.SNGL) RANK.EQ RANK.AVG PERCENTILE(.INC) QUARTILE(.INC)
//     ｜资讯 ISBLANK ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISERROR ISERR ISNA ISEVEN ISODD N T｜文字 SEARCH REPLACE REPT PROPER EXACT CHAR CODE
//     UNICHAR UNICODE CLEAN CONCATENATE TEXTBEFORE TEXTAFTER NUMBERVALUE FIXED｜查找 HLOOKUP LOOKUP ROW COLUMN ROWS COLUMNS OFFSET INDIRECT ADDRESS
//     ｜日期 TIME HOUR MINUTE SECOND EDATE DAYS NETWORKDAYS WORKDAY WEEKNUM ISOWEEKNUM DATEVALUE TIMEVALUE YEARFRAC｜财务 PMT FV PV NPER NPV RATE IRR。
//     ROW()／COLUMN() 不带参＝公式所在那格；INDIRECT 只认 A1 写法（R1C1 ⇒ #REF!）；NETWORKDAYS／WORKDAY 周末固定六日。
//     不做（下期）：动态数组溢出（FILTER SORT UNIQUE·区间当结果放一格 ⇒ #VALUE!）、LET／LAMBDA、三维引用 Sheet1:Sheet3!A1、数组常量 {1,2}。
//     值的强制转换／日期序号／条件串／TEXT 格式码在 ./formula-lib.ts。
//   跨表引用（照 Excel 写法）：表格2!A1、表格2!A1:B5、表格2!A:A；名字有空格／符号 ⇒ 单引号 '销售 表'!A1（引号里 '' ＝一个单引号）。
//     页签名不分大小写；同名几张 ⇒ 认排最前那张；找不到那张 ⇒ #REF!。求值要整份文件 ⇒ EvaluatorOptions.book（SheetBook）·
//     没给 book 的求值器遇到跨表引用一律 #REF!。跨表循环（A→B→A）：book 每张只建一个求值器·绕回来碰到那张自己的循环栈 ⇒ #CYCLE!。

import { coveredMap, type CellStyle, type SheetImage } from './style'
import type { SheetChart } from './chart'   // 图表
import type { CondRule } from './cond-format'   // 条件格式
import type { SheetPrint } from './print'   // 列印设定
import {
  ERRORS, isFormulaError, FxError, fail, type FormulaError, type Scalar,
  to15, eq15, numToText, roundTo, toNum, toText, toBool, compareScalars, cmpText, hasWildcard, wildcardRegex, makeCriteria,
  ymdToSerial, serialToYmd, SERIAL_MAX, UNIX_EPOCH_SERIAL, parseNumberText, formatText, daysInMonth,
  serialToHms, parseDateTimeText, wildcardSource, isLeapYear,
} from './formula-lib'

export { ERRORS, isFormulaError, type FormulaError, type Scalar }

export type CellData = { v?: string; f?: string; s?: CellStyle }
export type SheetCells = Record<string, CellData>
/** colWidths：列字母 ⇒ 像素宽（100% 缩放下）·rowHeights：行号（1 起）⇒ 像素高·省＝预设 */
export type SheetContent = { cells?: SheetCells; merges?: string[]; images?: SheetImage[]; colWidths?: Record<string, number>; rowHeights?: Record<string, number>; charts?: SheetChart[]; condFormats?: CondRule[]; print?: SheetPrint }   // 图表·条件格式·列印设定（型别在 ./chart.ts／./cond-format.ts／./print.ts）
export type CellValue = number | string | null   // null＝空（逻辑值对外一律写成 'TRUE'／'FALSE' 字串·内部求值仍是真逻辑值·要原型用 typedValue）
export type EvalResult = CellValue | FormulaError

export const DEFAULT_COLS = 26
export const DEFAULT_ROWS = 100
const MAX_RANGE_CELLS = 100000

// ── 列名 ⇄ 索引（A=0 … Z=25 … AA=26）──
export function indexToCol(i: number): string {
  let s = ''; let n = i + 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
export function colToIndex(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export function cellKey(row: number, col: number): string { return `${indexToCol(col)}${row + 1}` }
/** 'A1' ⇒ {row:0,col:0}；'$A$1'／'A$1'／'$A1' 同一格（$ 只管平移）；坏形 ⇒ null */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(ref.trim())
  if (!m) return null
  const row = Number(m[2]) - 1
  if (row < 0) return null
  return { row, col: colToIndex(m[1]) }
}
/** 区间 A1:B3 ⇒ 所有格键（左上到右下·顺序不限） */
export function expandRange(a: string, b: string): string[] | null {
  const p = parseRef(a), q = parseRef(b)
  if (!p || !q) return null
  const r0 = Math.min(p.row, q.row), r1 = Math.max(p.row, q.row), c0 = Math.min(p.col, q.col), c1 = Math.max(p.col, q.col)
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_RANGE_CELLS) return null
  const out: string[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(cellKey(r, c))
  return out
}

/**
 * 用户原始输入 ⇒ 值：数字字串 ⇒ number；空 ⇒ null；其余 ⇒ 字串。
 * 规则：超过 15 位有效数字的长数字（身份证、订单号）与 0 开头的整数（电话 0912…、编号 007）原样当文字——
 *   不截成 15 位、不吃前导 0、不变科学记数；导出 xlsx 也写成文字格（Excel 打开看到的跟这里一样、SUM 一样不算它）。
 */
export function parseLiteral(v: string | undefined): CellValue {
  const s = (v ?? '').trim()
  if (s === '') return null
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) {
    if (/^[-+]?0\d/.test(s)) return s
    const mant = s.replace(/^[-+]/, '').replace(/e.*$/i, '').replace('.', '').replace(/^0+/, '')
    if (mant.replace(/0+$/, '').length > 15 && !/e/i.test(s)) return s
    return Number(s)
  }
  return s
}
/** 求值内部用的字面：再认 TRUE／FALSE（xlsx 导入的逻辑格就存成这两个字·导出也写回 t="b"） */
function literalValue(v: string | undefined): Scalar {
  const x = parseLiteral(v)
  if (x === 'TRUE') return true
  if (x === 'FALSE') return false
  return x
}

// ── 词法 ──
/** 一个引用（可带 $）在串首·后面不能再接字母数字底线（否则是函数名／别的词） */
export const REF_AT_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,6})(?![A-Za-z0-9_])/
const COL_AT_RE = /^(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.(])/

// ── 页签前缀（跨表）──
/** 不加引号的页签名可用的字：英数底线点·非 ASCII（中文名）；首字不能是数字或点 */
const SHEET_NAME_CH = /[A-Za-z0-9_. -￿]/
const SHEET_NAME_START = /[A-Za-z_ -￿]/
/** 页签名比对键：Excel 不分大小写（连续空白折成一个·同 sheet-list normalizeSheetName） */
export function sheetKey(name: string): string { return name.replace(/\s+/g, ' ').trim().toLowerCase() }
/**
 * src 第 i 字起是不是一个页签前缀（表格2! ／ '销售 表'!）：是 ⇒ { name（引号已拆、'' 还原）, end＝! 之后那一字 }；否 ⇒ null。
 *   呼叫方自管「i 是词首」（前一字不是名字字元）
 */
export function sheetPrefixAt(src: string, i: number): { name: string; end: number } | null {
  if (src[i] === "'") {
    let j = i + 1, s = ''
    for (;;) {
      if (j >= src.length) return null
      if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j += 2; continue } j++; break }
      s += src[j++]
    }
    return s && src[j] === '!' ? { name: s, end: j + 1 } : null
  }
  if (!SHEET_NAME_START.test(src[i] ?? '')) return null
  let j = i
  while (j < src.length && SHEET_NAME_CH.test(src[j])) j++
  if (src[j] !== '!') return null
  const name = src.slice(i, j)
  return refLikeName(name) ? null : { name, end: j + 1 }   // 长得像格位的名（A1!B2）照 Excel 要加引号 'A1'!B2
}
/** 名字长得像格位／R1C1／逻辑值 ⇒ 公式里一定要加引号 */
function refLikeName(name: string): boolean {
  return /^[A-Za-z]{1,3}\d+$/.test(name) || /^(R\d*C?\d*|C\d*)$/i.test(name) || /^(TRUE|FALSE)$/i.test(name)
}
/** 页签名 ⇒ 公式里的写法（不含 !）：普通名照写；有空格／符号、数字开头、长得像格位（A1／R1C1）⇒ 单引号括起、内含 ' 写成 ''。
 *  ascii＝只有纯英数底线点才不加引号（写进 xlsx 档用·最保守·Excel 一定认） */
export function quoteSheetName(name: string, o: { ascii?: boolean } = {}): string {
  const plain = o.ascii ? /^[A-Za-z_][A-Za-z0-9_.]*$/ : /^[A-Za-z_ -￿][A-Za-z0-9_. -￿]*$/
  if (plain.test(name) && !refLikeName(name) && !/\s/.test(name)) return name
  return `'${name.replace(/'/g, "''")}'`
}

type Tok =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'col'; v: string }
  | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'err'; v: FormulaError } | { t: 'sheet'; v: string } | { t: 'end' }
const OPS2 = ['<>', '<=', '>=']
function tokenize(src: string): Tok[] | FormulaError {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '"') {   // 字串："" 是一个引号
      let s = ''; i++
      for (;;) {
        if (i >= src.length) return '#ERROR!'
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue } i++; break }
        s += src[i++]
      }
      out.push({ t: 'str', v: s }); continue
    }
    if (ch === '#') {   // 错误字面（填充平移出界写进来的 #REF! 等）⇒ 求值即该错误
      const e = ERRORS.find(x => src.startsWith(x, i))
      if (!e) return '#ERROR!'
      out.push({ t: 'err', v: e }); i += e.length; continue
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i))
      if (!m) return '#ERROR!'
      out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue
    }
    if (ch === "'" || /[A-Za-z_ -￿]/.test(ch)) {   // 页签前缀（表格2!／'销售 表'!）先认·免得 Q1!A1 的 Q1 被当成格位
      const pre = sheetPrefixAt(src, i)
      if (pre) { out.push({ t: 'sheet', v: pre.name }); i = pre.end; continue }
      if (!/[A-Za-z_]/.test(ch)) return '#ERROR!'
    }
    if (ch === '$' || /[A-Za-z_]/.test(ch)) {
      const rest = src.slice(i)
      // $ 绝对记号：$A$1／A$1／$A1 ⇒ 同 A1（求值不看 $）
      const abs = REF_AT_RE.exec(rest)
      if (abs && rest[abs[0].length] !== '(') { out.push({ t: 'ref', v: (abs[2] + abs[4]).toUpperCase() }); i += abs[0].length; continue }
      // 整列 A:A／$A:$C（前一个或后一个是冒号才算）
      const col = COL_AT_RE.exec(rest)
      const prevColon = out.length > 0 && out[out.length - 1].t === 'op' && (out[out.length - 1] as { v: string }).v === ':'
      if (col && (prevColon || /^\s*:/.test(rest.slice(col[0].length)))) { out.push({ t: 'col', v: col[2].toUpperCase() }); i += col[0].length; continue }
      if (ch === '$') return '#ERROR!'
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)!
      let word = m[0].toUpperCase(); i += m[0].length
      word = word.replace(/^(_XLFN\.)?(_XLWS\.)?/, '')   // xlsx 档里新函数带 _xlfn. 前缀（IFS、XLOOKUP…）
      out.push({ t: 'id', v: word })
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS2.includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/(),:&^%=<>'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue }
    return '#ERROR!'
  }
  out.push({ t: 'end' })
  return out
}

// ── 语法树 ──
type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: FormulaError }
  | { k: 'ref'; v: string; sh?: string }   // sh＝跨表的页签名（省＝本表）
  | { k: 'range'; a: string; b: string; sh?: string }
  | { k: 'cols'; a: string; b: string; sh?: string }
  | { k: 'neg'; x: Node }
  | { k: 'pct'; x: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'call'; name: string; args: Node[] }

class ParseFail extends Error { code: FormulaError; constructor(code: FormulaError) { super(code); this.code = code } }

/**
 * Excel 运算优先序（Microsoft「Excel 公式中的运算子优先顺序」）：: ⇒ 负号 ⇒ % ⇒ ^ ⇒ * / ⇒ + - ⇒ & ⇒ = < > <= >= <>
 *   所以 =-2^2＝4（负号先结合）·=2^3^2＝64（左结合）
 */
function parse(src: string): Node | FormulaError {
  const toks = tokenize(src)
  if (typeof toks === 'string') return toks
  let p = 0
  const peek = () => toks[p]
  const take = () => toks[p++]
  const isOp = (...vs: string[]) => { const t = peek(); return t.t === 'op' && vs.includes(t.v) }
  function compare(): Node {
    let l = concat()
    while (isOp('=', '<>', '<', '>', '<=', '>=')) { const op = (take() as { v: string }).v; l = { k: 'bin', op, l, r: concat() } }
    return l
  }
  function concat(): Node {
    let l = additive()
    while (isOp('&')) { take(); l = { k: 'bin', op: '&', l, r: additive() } }
    return l
  }
  function additive(): Node {
    let l = term()
    while (isOp('+', '-')) { const op = (take() as { v: string }).v; l = { k: 'bin', op, l, r: term() } }
    return l
  }
  function term(): Node {
    let l = power()
    while (isOp('*', '/')) { const op = (take() as { v: string }).v; l = { k: 'bin', op, l, r: power() } }
    return l
  }
  function power(): Node {
    let l = unary()
    while (isOp('^')) { take(); l = { k: 'bin', op: '^', l, r: unary() } }
    return l
  }
  function unary(): Node {
    if (isOp('-')) { take(); return { k: 'neg', x: unary() } }
    if (isOp('+')) { take(); return unary() }
    let x = primary()
    while (isOp('%')) { take(); x = { k: 'pct', x } }
    return x
  }
  /** 区间第二端前可再写一次同一张的前缀（表格2!A1:表格2!B5·Excel 认）；换了别张 ⇒ #REF! */
  function secondEnd(sh: string | undefined): Tok {
    let b = take()
    if (b.t === 'sheet') { if (sh === undefined || sheetKey(b.v) !== sheetKey(sh)) throw new ParseFail('#REF!'); b = take() }
    return b
  }
  function primary(): Node {
    let t = take()
    let sh: string | undefined
    if (t.t === 'sheet') {
      sh = t.v; t = take()
      if (t.t === 'err') return { k: 'err', v: t.v }   // 表格2!#REF!（插删行列删掉的跨表引用·Excel 写法）＝那个错误值（IFERROR 接得住）
      if (t.t !== 'ref' && t.t !== 'col') throw new ParseFail('#REF!')
    }
    const at = sh === undefined ? {} : { sh }
    if (t.t === 'num') return { k: 'num', v: t.v }
    if (t.t === 'str') return { k: 'str', v: t.v }
    if (t.t === 'err') {
      // Excel 删掉页签后公式写成 #REF!A1（汇入的档里会有）⇒ 吃掉后面那段引用·整个当 #REF!
      if (t.v === '#REF!' && (peek().t === 'ref' || peek().t === 'col')) { take(); if (isOp(':')) { take(); take() } }
      return { k: 'err', v: t.v }
    }
    if (t.t === 'ref') {
      if (isOp(':')) { take(); const b = secondEnd(sh); if (b.t !== 'ref') throw new ParseFail('#REF!'); return { k: 'range', a: t.v, b: b.v, ...at } }
      return { k: 'ref', v: t.v, ...at }
    }
    if (t.t === 'col') {
      if (!isOp(':')) throw new ParseFail('#NAME?')
      take(); const b = secondEnd(sh); if (b.t !== 'col') throw new ParseFail('#REF!')
      return { k: 'cols', a: t.v, b: b.v, ...at }
    }
    if (t.t === 'id') {
      if (!isOp('(')) {
        if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' }
        throw new ParseFail('#NAME?')
      }
      take()
      const args: Node[] = []
      if (!isOp(')')) { args.push(compare()); while (isOp(',')) { take(); args.push(compare()) } }
      if (!isOp(')')) throw new ParseFail('#ERROR!')
      take()
      return { k: 'call', name: t.v, args }
    }
    if (t.t === 'op' && t.v === '(') { const e = compare(); if (!isOp(')')) throw new ParseFail('#ERROR!'); take(); return e }
    throw new ParseFail('#ERROR!')
  }
  try {
    const n = compare()
    if (peek().t !== 'end') return '#ERROR!'
    return n
  } catch (e) { return e instanceof ParseFail ? e.code : '#ERROR!' }
}

/** 引擎认得的函数与参数个数（语法检查／自动补全同一份·formula-edit.ts 读它·顺序＝补全清单顺序） */
export const FUNCTION_SPECS: Readonly<Record<string, { min: number; max: number }>> = {
  SUM: { min: 1, max: 255 }, AVERAGE: { min: 1, max: 255 }, MIN: { min: 1, max: 255 }, MAX: { min: 1, max: 255 }, COUNT: { min: 1, max: 255 },
  NA: { min: 0, max: 0 },
  // 逻辑
  IF: { min: 2, max: 3 }, IFS: { min: 2, max: 254 }, AND: { min: 1, max: 255 }, OR: { min: 1, max: 255 }, NOT: { min: 1, max: 1 },
  IFERROR: { min: 2, max: 2 }, IFNA: { min: 2, max: 2 }, SWITCH: { min: 3, max: 254 }, TRUE: { min: 0, max: 0 }, FALSE: { min: 0, max: 0 },
  // 数学统计
  ROUND: { min: 2, max: 2 }, ROUNDUP: { min: 2, max: 2 }, ROUNDDOWN: { min: 2, max: 2 }, ABS: { min: 1, max: 1 }, INT: { min: 1, max: 1 }, MOD: { min: 2, max: 2 },
  SUMPRODUCT: { min: 1, max: 255 }, SUMIF: { min: 2, max: 3 }, SUMIFS: { min: 3, max: 255 }, COUNTIF: { min: 2, max: 2 }, COUNTIFS: { min: 2, max: 254 },
  AVERAGEIF: { min: 2, max: 3 }, COUNTA: { min: 1, max: 255 }, COUNTBLANK: { min: 1, max: 1 }, MAXIFS: { min: 3, max: 255 }, MINIFS: { min: 3, max: 255 },
  MEDIAN: { min: 1, max: 255 }, RANK: { min: 2, max: 3 }, LARGE: { min: 2, max: 2 }, SMALL: { min: 2, max: 2 },
  // 查找
  VLOOKUP: { min: 3, max: 4 }, XLOOKUP: { min: 3, max: 6 }, INDEX: { min: 2, max: 3 }, MATCH: { min: 2, max: 3 }, CHOOSE: { min: 2, max: 255 },
  // 文字
  CONCAT: { min: 1, max: 255 }, TEXTJOIN: { min: 3, max: 255 }, LEFT: { min: 1, max: 2 }, RIGHT: { min: 1, max: 2 }, MID: { min: 3, max: 3 },
  LEN: { min: 1, max: 1 }, TRIM: { min: 1, max: 1 }, UPPER: { min: 1, max: 1 }, LOWER: { min: 1, max: 1 }, TEXT: { min: 2, max: 2 },
  VALUE: { min: 1, max: 1 }, SUBSTITUTE: { min: 3, max: 4 }, FIND: { min: 2, max: 3 },
  // 日期
  TODAY: { min: 0, max: 0 }, NOW: { min: 0, max: 0 }, DATE: { min: 3, max: 3 }, YEAR: { min: 1, max: 1 }, MONTH: { min: 1, max: 1 }, DAY: { min: 1, max: 1 },
  WEEKDAY: { min: 1, max: 2 }, DATEDIF: { min: 3, max: 3 }, EOMONTH: { min: 2, max: 2 },
  // ── 第二批 ──
  // 数学
  PRODUCT: { min: 1, max: 255 }, POWER: { min: 2, max: 2 }, SQRT: { min: 1, max: 1 }, SIGN: { min: 1, max: 1 }, PI: { min: 0, max: 0 },
  EXP: { min: 1, max: 1 }, LN: { min: 1, max: 1 }, LOG: { min: 1, max: 2 }, LOG10: { min: 1, max: 1 }, TRUNC: { min: 1, max: 2 },
  CEILING: { min: 2, max: 2 }, FLOOR: { min: 2, max: 2 }, 'CEILING.MATH': { min: 1, max: 3 }, 'FLOOR.MATH': { min: 1, max: 3 }, MROUND: { min: 2, max: 2 },
  EVEN: { min: 1, max: 1 }, ODD: { min: 1, max: 1 }, QUOTIENT: { min: 2, max: 2 }, GCD: { min: 1, max: 255 }, LCM: { min: 1, max: 255 },
  FACT: { min: 1, max: 1 }, RAND: { min: 0, max: 0 }, RANDBETWEEN: { min: 2, max: 2 }, SUMSQ: { min: 1, max: 255 },
  // 统计
  AVERAGEIFS: { min: 3, max: 255 }, STDEV: { min: 1, max: 255 }, 'STDEV.S': { min: 1, max: 255 }, 'STDEV.P': { min: 1, max: 255 }, STDEVP: { min: 1, max: 255 },
  VAR: { min: 1, max: 255 }, 'VAR.S': { min: 1, max: 255 }, 'VAR.P': { min: 1, max: 255 }, VARP: { min: 1, max: 255 },
  MODE: { min: 1, max: 255 }, 'MODE.SNGL': { min: 1, max: 255 }, 'RANK.EQ': { min: 2, max: 3 }, 'RANK.AVG': { min: 2, max: 3 },
  PERCENTILE: { min: 2, max: 2 }, 'PERCENTILE.INC': { min: 2, max: 2 }, QUARTILE: { min: 2, max: 2 }, 'QUARTILE.INC': { min: 2, max: 2 },
  // 资讯
  ISBLANK: { min: 1, max: 1 }, ISNUMBER: { min: 1, max: 1 }, ISTEXT: { min: 1, max: 1 }, ISNONTEXT: { min: 1, max: 1 }, ISLOGICAL: { min: 1, max: 1 },
  ISERROR: { min: 1, max: 1 }, ISERR: { min: 1, max: 1 }, ISNA: { min: 1, max: 1 }, ISEVEN: { min: 1, max: 1 }, ISODD: { min: 1, max: 1 },
  N: { min: 1, max: 1 }, T: { min: 1, max: 1 },
  // 文字
  SEARCH: { min: 2, max: 3 }, REPLACE: { min: 4, max: 4 }, REPT: { min: 2, max: 2 }, PROPER: { min: 1, max: 1 }, EXACT: { min: 2, max: 2 },
  CHAR: { min: 1, max: 1 }, CODE: { min: 1, max: 1 }, UNICHAR: { min: 1, max: 1 }, UNICODE: { min: 1, max: 1 }, CLEAN: { min: 1, max: 1 },
  CONCATENATE: { min: 1, max: 255 }, TEXTBEFORE: { min: 2, max: 6 }, TEXTAFTER: { min: 2, max: 6 }, NUMBERVALUE: { min: 1, max: 3 }, FIXED: { min: 1, max: 3 },
  // 查找
  HLOOKUP: { min: 3, max: 4 }, LOOKUP: { min: 2, max: 3 }, ROW: { min: 0, max: 1 }, COLUMN: { min: 0, max: 1 }, ROWS: { min: 1, max: 1 },
  COLUMNS: { min: 1, max: 1 }, OFFSET: { min: 3, max: 5 }, INDIRECT: { min: 1, max: 2 }, ADDRESS: { min: 2, max: 5 },
  // 日期时间
  TIME: { min: 3, max: 3 }, HOUR: { min: 1, max: 1 }, MINUTE: { min: 1, max: 1 }, SECOND: { min: 1, max: 1 }, EDATE: { min: 2, max: 2 },
  DAYS: { min: 2, max: 2 }, NETWORKDAYS: { min: 2, max: 3 }, WORKDAY: { min: 2, max: 3 }, WEEKNUM: { min: 1, max: 2 }, ISOWEEKNUM: { min: 1, max: 1 },
  DATEVALUE: { min: 1, max: 1 }, TIMEVALUE: { min: 1, max: 1 }, YEARFRAC: { min: 2, max: 3 },
  // 财务
  PMT: { min: 3, max: 5 }, FV: { min: 3, max: 5 }, PV: { min: 3, max: 5 }, NPER: { min: 3, max: 5 }, NPV: { min: 2, max: 255 },
  RATE: { min: 3, max: 6 }, IRR: { min: 1, max: 2 },
}

/** Excel 2010 以后才有的函数：写进 xlsx 档时要带 _xlfn. 前缀（ECMA-376 第 1 部 §18.17.7「Future functions」·不带 Excel 打开会 #NAME?） */
export const XLFN_FUNCTIONS: ReadonlySet<string> = new Set([
  'IFS', 'SWITCH', 'IFNA', 'CONCAT', 'TEXTJOIN', 'MAXIFS', 'MINIFS', 'XLOOKUP',
  'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'MODE.SNGL', 'RANK.EQ', 'RANK.AVG', 'PERCENTILE.INC', 'QUARTILE.INC', 'CEILING.MATH', 'FLOOR.MATH',
  'DAYS', 'ISOWEEKNUM', 'NUMBERVALUE', 'UNICHAR', 'UNICODE', 'TEXTBEFORE', 'TEXTAFTER',
])
/** 公式原文（不含开头 =）⇒ xlsx <f> 里要写的字（新函数补 _xlfn.·字串里的不动） */
export function toXlsxFormula(f: string): string { return mapFunctionNames(f, n => (XLFN_FUNCTIONS.has(n.toUpperCase()) ? `_xlfn.${n}` : n)) }
/** xlsx <f> 里读来的字 ⇒ 公式原文（去掉 _xlfn.／_xlws. 前缀） */
export function fromXlsxFormula(f: string): string { return f.replace(/("(?:[^"]|"")*")|_xlfn\.(?:_xlws\.)?/gi, (m, str) => str ?? '') }
/** 逐字扫：跳过 "字串" 与 '页签名'·词首（前一字不是字母数字底线 . $）且后面接「(」的词＝函数名（不用后顾正则·旧 Safari 不认） */
function mapFunctionNames(f: string, fn: (name: string) => string): string {
  let out = '', i = 0
  while (i < f.length) {
    const ch = f[i]
    if (ch === '"' || ch === "'") {   // "字串"·'页签名'（跨表前缀·里面的 IFS (2) 不是函数）
      let j = i + 1
      while (j < f.length) { if (f[j] === ch) { if (f[j + 1] === ch) { j += 2; continue } j++; break } j++ }
      out += f.slice(i, j); i = j; continue
    }
    if (/[A-Za-z_]/.test(ch) && (i === 0 || !/[A-Za-z0-9_.$ -￿]/.test(f[i - 1]))) {
      const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(f.slice(i))![0]
      i += w.length
      out += /^\s*\(/.test(f.slice(i)) ? fn(w) : w
      continue
    }
    out += ch; i++
  }
  return out
}

// ── 值：纯量／区间引用／数组 ──
/** s＝这段引用落在哪张表的求值器（跨表）·省＝本表 */
type Ref = { t: 'ref'; r0: number; c0: number; r1: number; c1: number; s?: SheetEvaluator }
type Arr = { t: 'arr'; rows: number; cols: number; d: Scalar[] }
type V = Scalar | Ref | Arr
const isRef = (v: V): v is Ref => typeof v === 'object' && v !== null && (v as Ref).t === 'ref'
const isArr = (v: V): v is Arr => typeof v === 'object' && v !== null && (v as Arr).t === 'arr'
const isMulti = (v: V): boolean => (isRef(v) && (v.r0 !== v.r1 || v.c0 !== v.c1)) || (isArr(v) && v.d.length !== 1)

/** 服务端 TODAY／NOW 的时区：台北／北京都是 UTC+8 */
export const SERVER_TZ_OFFSET_MINUTES = 480

export type EvaluatorOptions = {
  /** 时钟（TODAY／NOW 用·测试注入）·省 ⇒ new Date() */
  now?: () => Date
  /** 时区：比 UTC 快几分钟（台北／北京＝480）·省 ⇒ 执行环境的本地时区 */
  tzOffsetMinutes?: number
  /** 整份文件（跨表引用用）·省 ⇒ 跨表引用一律 #REF! */
  book?: SheetBook
  /** 这张表自己的页签名（写了自己名字的引用 表格1!A1 直接算本表·循环栈按它分表） */
  sheetName?: string
}

/** 整份文件里的一张页签（名＋内容） */
export type BookSheet = { name: string; content?: SheetContent | null }

/**
 * 整份文件：按页签名（不分大小写·同名取排最前那张）懒建各张的求值器（每张只一个⇒跨表 A→B→A 绕回来碰到它自己的循环栈 ⇒ #CYCLE!）。
 *   内容一改就换一个新的（求值器带缓存）；网页／导出／AI 读表各自现建。
 */
export class SheetBook {
  private byKey = new Map<string, BookSheet>()
  private evs = new Map<string, SheetEvaluator>()
  constructor(sheets: readonly BookSheet[], private opts: Pick<EvaluatorOptions, 'now' | 'tzOffsetMinutes'> = {}) {
    for (const s of sheets) { const k = sheetKey(s.name); if (!this.byKey.has(k)) this.byKey.set(k, s) }
  }
  has(name: string): boolean { return this.byKey.has(sheetKey(name)) }
  /** 那张页签的求值器；没有这张 ⇒ null */
  sheet(name: string): SheetEvaluator | null {
    const k = sheetKey(name)
    const hit = this.evs.get(k)
    if (hit) return hit
    const s = this.byKey.get(k)
    if (!s) return null
    const ev = new SheetEvaluator(s.content?.cells ?? {}, s.content?.merges, { ...this.opts, book: this, sheetName: s.name })
    this.evs.set(k, ev)
    return ev
  }
}

/** 一份 sheet 的求值器：带缓存＋循环栈。getRaw(key) 给原始格（没有 ⇒ undefined） */
export class SheetEvaluator {
  private cache = new Map<string, Scalar>()
  private stack = new Set<string>()
  /** 正在算的公式格（栈顶＝ROW()／COLUMN() 不带参时的「本格」） */
  private cur: string[] = []
  private covered: Map<string, string>
  private maxRowCache: number | null = null
  constructor(private cells: SheetCells, merges?: string[], private opts: EvaluatorOptions = {}) {
    this.covered = coveredMap(merges)
  }
  /** 跨表引用指到哪张表的求值器：省／写的是自己 ⇒ 本表；book 里没有那张 ⇒ null（#REF!） */
  private owner(sh: string | undefined): SheetEvaluator | null {
    if (sh === undefined) return this
    if (this.opts.sheetName !== undefined && sheetKey(sh) === sheetKey(this.opts.sheetName)) return this
    return this.opts.book?.sheet(sh) ?? null
  }

  /** 某格的显示值（公式格算公式·普通格按字面）；合并区里被盖住的格 ⇒ 取左上；逻辑值写成 'TRUE'／'FALSE' */
  value(key: string): EvalResult { return outward(this.typedValue(key)) }

  /** 同 value 但逻辑值是真 boolean（导出 xlsx 写 t="b" 用） */
  typedValue(key: string): Scalar {
    let k = key.toUpperCase()
    const tl = this.covered.get(k)
    if (tl) k = tl
    if (this.cache.has(k)) return this.cache.get(k)!
    const cell = this.cells[k]
    let out: Scalar
    if (cell?.f && cell.f.trim().startsWith('=')) {
      if (this.stack.has(k)) return '#CYCLE!'
      this.stack.add(k); this.cur.push(k)
      try { out = this.evalTyped(cell.f) } finally { this.stack.delete(k); this.cur.pop() }
    } else if (cell?.s?.numFmt?.t === 'text') {
      out = cell.v ? cell.v : null   // 文字格式（Excel「@」）：数字也当文字（SUM 不算·=A1+1 照四则转换·跟导出后的 Excel 一样）
    } else {
      out = literalValue(cell?.v)
    }
    this.cache.set(k, out)
    return out
  }

  /** 公式原文（含开头 =）⇒ 结果（逻辑值写成 'TRUE'／'FALSE'） */
  evalFormula(f: string): EvalResult { return outward(this.evalTyped(f)) }

  /** 公式原文 ⇒ 结果（逻辑值是真 boolean）；区间当结果（没有溢出）⇒ #VALUE!；引用到空格 ⇒ 0（Excel：=A1 而 A1 空白显示 0） */
  evalTyped(f: string): Scalar {
    const src = f.trim().replace(/^=/, '')
    if (!src.trim()) return null
    const ast = parse(src)
    if (typeof ast === 'string') return ast
    let v: Scalar
    try { v = this.scalar(this.ev(ast)) } catch (e) { v = codeOf(e) }
    if (v === null) return 0
    return typeof v === 'number' && !Number.isFinite(v) ? '#NUM!' : v   // 溢出（1E308*10）⇒ #NUM!（Excel 口径）
  }

  // ── 引用取值 ──
  private maxRow(): number {
    if (this.maxRowCache !== null) return this.maxRowCache
    let m = 0
    for (const k of Object.keys(this.cells)) { const p = parseRef(k); if (p && p.row > m) m = p.row }
    return (this.maxRowCache = m)
  }
  private cellAt(r: number, c: number, inRange: boolean): Scalar {
    const k = cellKey(r, c)
    if (inRange && this.covered.has(k)) return null   // 区间里被合并区盖住的格算空（左上只计一次·Excel 口径）；直接引用 =B1 才取左上
    return this.typedValue(k)
  }
  private deref(ref: Ref): Arr {
    if (ref.s && ref.s !== this) return ref.s.deref(ref)   // 跨表：到那张表取（合并区、循环栈照那张的）
    const rows = ref.r1 - ref.r0 + 1, cols = ref.c1 - ref.c0 + 1
    if (rows * cols > MAX_RANGE_CELLS) fail('#REF!')
    const single = rows === 1 && cols === 1
    const d: Scalar[] = []
    for (let r = ref.r0; r <= ref.r1; r++) for (let c = ref.c0; c <= ref.c1; c++) d.push(this.cellAt(r, c, !single))
    return { t: 'arr', rows, cols, d }
  }
  /** 单格引用的值（跨表到那张表取） */
  private refCell(v: Ref): Scalar { return (v.s ?? this).cellAt(v.r0, v.c0, false) }
  /** 值 ⇒ 一个纯量（单格引用取值·多格区间 ⇒ #VALUE!） */
  private scalar(v: V): Scalar {
    if (isRef(v)) { if (isMulti(v)) return '#VALUE!'; return this.refCell(v) }
    if (isArr(v)) return v.d.length === 1 ? v.d[0] : '#VALUE!'
    return v
  }
  /** 值 ⇒ 数组（引用展开·纯量当 1×1） */
  private arr(v: V): Arr {
    if (isRef(v)) return this.deref(v)
    if (isArr(v)) return v
    return { t: 'arr', rows: 1, cols: 1, d: [v] }
  }
  /** 运算用：单格引用 ⇒ 纯量·多格 ⇒ 数组 */
  private operand(v: V): Scalar | Arr {
    if (isRef(v)) return isMulti(v) ? this.deref(v) : this.refCell(v)
    return v
  }

  private ev(n: Node): V {
    switch (n.k) {
      case 'num': return n.v
      case 'str': return n.v
      case 'bool': return n.v
      case 'err': return n.v
      case 'ref': {
        const p = parseRef(n.v); if (!p) return '#REF!'
        const s = this.owner(n.sh); if (!s) return '#REF!'
        return { t: 'ref', r0: p.row, c0: p.col, r1: p.row, c1: p.col, ...(s !== this ? { s } : {}) }
      }
      case 'range': {
        const p = parseRef(n.a), q = parseRef(n.b)
        if (!p || !q) return '#REF!'
        const s = this.owner(n.sh); if (!s) return '#REF!'
        return { t: 'ref', r0: Math.min(p.row, q.row), c0: Math.min(p.col, q.col), r1: Math.max(p.row, q.row), c1: Math.max(p.col, q.col), ...(s !== this ? { s } : {}) }
      }
      case 'cols': {   // 整列：行数收到那张表有内容的最末一行
        const a = colToIndex(n.a), b = colToIndex(n.b)
        const s = this.owner(n.sh); if (!s) return '#REF!'
        return { t: 'ref', r0: 0, c0: Math.min(a, b), r1: s.maxRow(), c1: Math.max(a, b), ...(s !== this ? { s } : {}) }
      }
      case 'neg': return this.map1(this.operand(this.ev(n.x)), x => -toNum(x))
      case 'pct': return this.map1(this.operand(this.ev(n.x)), x => toNum(x) / 100)
      case 'bin': return this.map2(this.operand(this.ev(n.l)), this.operand(this.ev(n.r)), (a, b) => binop(n.op, a, b))
      case 'call': {
        const spec = FUNCTION_SPECS[n.name]
        if (!spec) return '#NAME?'
        if (n.args.length < spec.min || n.args.length > spec.max) return '#VALUE!'
        try { return this.call(n.name, n.args) } catch (e) { return codeOf(e) }
      }
    }
  }
  private map1(x: Scalar | Arr, f: (a: Scalar) => Scalar): Scalar | Arr {
    if (!isArr(x)) return safe(() => f(x))
    return { t: 'arr', rows: x.rows, cols: x.cols, d: x.d.map(a => safe(() => f(a))) }
  }
  /** 两个运算元逐格（Excel 数组运算：一边单行／单列会撑开·尺寸对不上的格 ⇒ #N/A） */
  private map2(x: Scalar | Arr, y: Scalar | Arr, f: (a: Scalar, b: Scalar) => Scalar): Scalar | Arr {
    if (!isArr(x) && !isArr(y)) return safe(() => f(x, y))
    return broadcast([x, y], xs => f(xs[0], xs[1]))
  }
  /** 纯量函数遇到数组参数 ⇒ 逐格算（LEN(A1:A3)、ROUND(B1:B3*0.9,0)…进 SUMPRODUCT 用） */
  private lift(args: Node[], f: (...xs: Scalar[]) => Scalar): V {
    const vs = args.map(a => this.operand(this.ev(a)))
    if (!vs.some(v => isArr(v) && v.d.length !== 1)) return safe(() => f(...vs.map(v => (isArr(v) ? v.d[0] : v))))
    return broadcast(vs, xs => f(...xs))
  }
  private s(n: Node | undefined): Scalar { return n === undefined ? null : this.scalar(this.ev(n)) }
  private num(n: Node): number { return toNum(this.s(n)) }

  /** 统计类参数摊平（SUM AVERAGE MIN MAX MEDIAN…）：引用／数组里只收数字（文字、逻辑、空格跳过·错误照传）；直接写的参数照四则转换 */
  private nums(args: Node[]): number[] {
    const out: number[] = []
    for (const a of args) {
      const v = this.ev(a)
      if (isRef(v) || isArr(v)) {
        for (const x of this.arr(v).d) { if (isFormulaError(x)) fail(x); if (typeof x === 'number') out.push(x) }
      } else if (v !== null) out.push(toNum(v))
    }
    return out
  }
  private range(n: Node): Arr {
    const v = this.ev(n)
    if (isFormulaError(v)) fail(v)
    return this.arr(v)
  }
  /** 一维区间（单行或单列）⇒ 值清单；二维 ⇒ null */
  private vector(n: Node): Scalar[] | null {
    const a = this.range(n)
    return a.rows === 1 || a.cols === 1 ? a.d : null
  }
  /** SUMIF／AVERAGEIF 的第 3 参：Excel 以它的左上格为起点·撑成跟条件区一样大（Microsoft SUMIF 说明「sum_range 大小形状不同时」） */
  private sameShape(n: Node, like: Arr): Arr {
    const v = this.ev(n)
    if (isFormulaError(v)) fail(v)
    if (isRef(v)) return this.deref({ ...v, r1: v.r0 + like.rows - 1, c1: v.c0 + like.cols - 1 })
    const a = this.arr(v)
    if (a.rows !== like.rows || a.cols !== like.cols) fail('#VALUE!')
    return a
  }
  /** …IFS 的条件组：每组区间尺寸都要跟 base 一样（不一样 ⇒ #VALUE!）·回传每格是否全中 */
  private ifsMask(args: Node[], base: Arr): boolean[] {
    const mask = base.d.map(() => true)
    for (let i = 0; i + 1 < args.length; i += 2) {
      const r = this.range(args[i])
      if (r.rows !== base.rows || r.cols !== base.cols) fail('#VALUE!')
      const crit = makeCriteria(this.s(args[i + 1]))
      r.d.forEach((x, j) => { if (mask[j] && !crit(x)) mask[j] = false })
    }
    return mask
  }

  private nowSerial(): number {
    const d = (this.opts.now ?? (() => new Date()))()
    // 服务端（导出 xlsx、角色读表）没指定时区 ⇒ 台北／北京 UTC+8（两站同时区·服务器跑在 UTC 会把清早算成前一天）；浏览器照本机时区
    const tz = this.opts.tzOffsetMinutes ?? (typeof window === 'undefined' ? SERVER_TZ_OFFSET_MINUTES : -d.getTimezoneOffset())
    return (d.getTime() + tz * 60000) / 86400000 + UNIX_EPOCH_SERIAL
  }

  private call(name: string, args: Node[]): V {
    switch (name) {
      case 'NA': return '#N/A'
      case 'TRUE': return true
      case 'FALSE': return false
      // ── 统计 ──
      case 'SUM': return this.nums(args).reduce((a, b) => a + b, 0)
      case 'AVERAGE': { const xs = this.nums(args); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : '#DIV/0!' }
      case 'MIN': { const xs = this.nums(args); return xs.length ? Math.min(...xs) : 0 }   // Excel：没有数字 ⇒ 0
      case 'MAX': { const xs = this.nums(args); return xs.length ? Math.max(...xs) : 0 }
      case 'MEDIAN': {
        const xs = this.nums(args).sort((a, b) => a - b)
        if (!xs.length) return '#NUM!'
        const h = xs.length >> 1
        return xs.length % 2 ? xs[h] : (xs[h - 1] + xs[h]) / 2
      }
      case 'COUNT': {   // 引用里只数数字格；直接写的参数：数、逻辑、文字型数字都算；错误不算也不报（Microsoft COUNT 说明）
        let n = 0
        for (const a of args) {
          const v = this.ev(a)
          if (isRef(v) || isArr(v)) { for (const x of this.arr(v).d) if (typeof x === 'number') n++ }
          else if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && !isFormulaError(v) && parseNumberText(v) !== null)) n++
        }
        return n
      }
      case 'COUNTA': {   // 非空都算（错误、"" 也算）
        let n = 0
        for (const a of args) {
          const v = this.ev(a)
          if (isRef(v) || isArr(v)) { for (const x of this.arr(v).d) if (x !== null) n++ }
          else n++
        }
        return n
      }
      case 'COUNTBLANK': { const r = this.range(args[0]); return r.d.filter(x => x === null || x === '').length }
      case 'LARGE': case 'SMALL': {
        const xs = this.nums([args[0]]).sort((a, b) => (name === 'LARGE' ? b - a : a - b))
        const k = Math.ceil(this.num(args[1]))
        if (k < 1 || k > xs.length) return '#NUM!'
        return xs[k - 1]
      }
      case 'RANK': {   // 降序（order 省或 0）＝比它大的个数＋1；同值同名次；数不在区间里 ⇒ #N/A
        const x = this.num(args[0])
        const xs = this.nums([args[1]])
        const asc = args[2] !== undefined && this.num(args[2]) !== 0
        if (!xs.some(y => eq15(y, x))) return '#N/A'
        return 1 + xs.filter(y => !eq15(y, x) && (asc ? y < x : y > x)).length
      }
      case 'SUMPRODUCT': {   // 各数组同尺寸（不同 ⇒ #VALUE!）·非数字当 0·错误照传
        const as = args.map(a => this.arr(this.operand(this.ev(a))))
        const { rows, cols } = as[0]
        if (as.some(a => a.rows !== rows || a.cols !== cols)) return '#VALUE!'
        let sum = 0
        for (let i = 0; i < rows * cols; i++) {
          let p = 1
          for (const a of as) { const x = a.d[i]; if (isFormulaError(x)) return x; p *= typeof x === 'number' ? x : 0 }
          sum += p
        }
        return sum
      }
      case 'SUMIF': case 'AVERAGEIF': {
        const r = this.range(args[0])
        const crit = makeCriteria(this.s(args[1]))
        const vals = args[2] !== undefined ? this.sameShape(args[2], r) : r
        let sum = 0, n = 0
        r.d.forEach((x, i) => {
          if (!crit(x)) return
          const y = vals.d[i]
          if (isFormulaError(y)) fail(y)
          if (typeof y === 'number') { sum += y; n++ }
        })
        if (name === 'SUMIF') return sum
        return n ? sum / n : '#DIV/0!'
      }
      case 'COUNTIF': { const r = this.range(args[0]); const crit = makeCriteria(this.s(args[1])); return r.d.filter(x => crit(x)).length }
      case 'COUNTIFS': {
        if (args.length % 2) return '#VALUE!'
        const base = this.range(args[0])
        return this.ifsMask(args, base).filter(Boolean).length
      }
      case 'SUMIFS': case 'MAXIFS': case 'MINIFS': case 'AVERAGEIFS': {
        if (args.length % 2 === 0) return '#VALUE!'
        const vals = this.range(args[0])
        const mask = this.ifsMask(args.slice(1), vals)
        const xs: number[] = []
        vals.d.forEach((y, i) => { if (!mask[i]) return; if (isFormulaError(y)) fail(y); if (typeof y === 'number') xs.push(y) })
        if (name === 'SUMIFS') return xs.reduce((a, b) => a + b, 0)
        if (name === 'AVERAGEIFS') return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : '#DIV/0!'
        if (!xs.length) return 0
        return name === 'MAXIFS' ? Math.max(...xs) : Math.min(...xs)
      }
      // ── 数学 ──
      case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN':
        return this.lift(args, (x, d) => roundTo(toNum(x), toNum(d), name === 'ROUND' ? 'half' : name === 'ROUNDUP' ? 'up' : 'down'))
      case 'ABS': return this.lift(args, x => Math.abs(toNum(x)))
      case 'INT': return this.lift(args, x => Math.floor(to15(toNum(x))))
      case 'MOD': return this.lift(args, (x, y) => {   // 余数跟除数同号（Microsoft MOD：n - d*INT(n/d)）
        const n = toNum(x), d = toNum(y)
        if (d === 0) return fail('#DIV/0!')
        const r = n - d * Math.floor(to15(n / d))
        return to15(r) === to15(d) ? 0 : r
      })
      // ── 逻辑 ──
      case 'IF': {
        const c = this.operand(this.ev(args[0]))
        if (isArr(c) && c.d.length !== 1) {   // 数组 IF（SUMPRODUCT(IF(…))）：两支都算、逐格挑
          const t = this.operand(this.ev(args[1]))
          const f = args[2] !== undefined ? this.operand(this.ev(args[2])) : false
          return broadcast([c, t, f], ([cc, tt, ff]) => (toBool(cc) ? tt : ff))
        }
        const cond = toBool(isArr(c) ? c.d[0] : c)
        if (cond) return this.ev(args[1])
        return args[2] !== undefined ? this.ev(args[2]) : false
      }
      case 'IFS': {
        if (args.length % 2) return '#VALUE!'
        for (let i = 0; i < args.length; i += 2) if (toBool(this.s(args[i]))) return this.ev(args[i + 1])
        return '#N/A'
      }
      case 'AND': case 'OR': {   // 引用里只看逻辑与数字（文字、空跳过）；一个都没有 ⇒ #VALUE!
        const bs: boolean[] = []
        for (const a of args) {
          const v = this.ev(a)
          if (isRef(v) || isArr(v)) {
            for (const x of this.arr(v).d) { if (isFormulaError(x)) fail(x); if (typeof x === 'boolean') bs.push(x); else if (typeof x === 'number') bs.push(x !== 0) }
          } else if (v !== null) bs.push(toBool(v))
        }
        if (!bs.length) return '#VALUE!'
        return name === 'AND' ? bs.every(Boolean) : bs.some(Boolean)
      }
      case 'NOT': return this.lift(args, x => !toBool(x))
      case 'IFERROR': case 'IFNA': {
        const hit = (x: Scalar) => (name === 'IFNA' ? x === '#N/A' : isFormulaError(x))
        let v: V
        try { v = this.operand(this.ev(args[0])) } catch (e) { v = codeOf(e) }
        if (isArr(v)) {
          if (!v.d.some(hit)) return v
          const alt = this.s(args[1])
          return { t: 'arr', rows: v.rows, cols: v.cols, d: v.d.map(x => (hit(x) ? alt : x)) }
        }
        return hit(v) ? this.ev(args[1]) : v
      }
      case 'SWITCH': {
        const x = this.s(args[0])
        if (isFormulaError(x)) return x
        const pairs = Math.floor((args.length - 1) / 2)
        for (let i = 0; i < pairs; i++) {
          const c = this.s(args[1 + i * 2])
          if (isFormulaError(c)) return c
          if (compareScalars(x, c) === 0) return this.ev(args[2 + i * 2])   // 同「=」口径：不同型不相等·文字不分大小写
        }
        return (args.length - 1) % 2 ? this.ev(args[args.length - 1]) : '#N/A'
      }
      // ── 查找 ──
      case 'VLOOKUP': {
        const key = this.s(args[0])
        if (isFormulaError(key)) return key
        const tb = this.range(args[1])
        const col = Math.trunc(this.num(args[2]))
        const approx = args[3] === undefined ? true : toBool(this.s(args[3]))
        if (col < 1) return '#VALUE!'
        if (col > tb.cols) return '#REF!'
        const first: Scalar[] = []
        for (let r = 0; r < tb.rows; r++) first.push(tb.d[r * tb.cols])
        const i = approx ? approxIndex(first, key, 1) : exactIndex(first, key, true, false)
        return i < 0 ? '#N/A' : tb.d[i * tb.cols + col - 1]
      }
      case 'MATCH': {
        const key = this.s(args[0])
        if (isFormulaError(key)) return key
        const vec = this.vector(args[1])
        if (!vec) return '#N/A'
        const type = args[2] === undefined ? 1 : Math.sign(Math.trunc(this.num(args[2])))
        const i = type === 0 ? exactIndex(vec, key, true, false) : approxIndex(vec, key, type)
        return i < 0 ? '#N/A' : i + 1
      }
      case 'XLOOKUP': {
        const key = this.s(args[0])
        if (isFormulaError(key)) return key
        const look = this.range(args[1])
        if (look.rows !== 1 && look.cols !== 1) return '#VALUE!'
        const ret = this.range(args[2])
        const vertical = look.cols === 1 && (look.rows > 1 || ret.rows === look.rows)
        const n = vertical ? look.rows : look.cols
        if ((vertical ? ret.rows : ret.cols) !== n) return '#VALUE!'
        const mode = args[4] === undefined ? 0 : Math.trunc(this.num(args[4]))
        const search = args[5] === undefined ? 1 : Math.trunc(this.num(args[5]))
        if (![0, -1, 1, 2].includes(mode) || ![1, -1, 2, -2].includes(search)) return '#VALUE!'
        const i = xlookupIndex(look.d, key, mode, search < 0)
        if (i < 0) return args[3] !== undefined ? this.ev(args[3]) : '#N/A'
        if (vertical) return ret.cols === 1 ? ret.d[i] : { t: 'arr', rows: 1, cols: ret.cols, d: ret.d.slice(i * ret.cols, (i + 1) * ret.cols) }
        if (ret.rows === 1) return ret.d[i]
        return { t: 'arr', rows: ret.rows, cols: 1, d: Array.from({ length: ret.rows }, (_, r) => ret.d[r * ret.cols + i]) }
      }
      case 'INDEX': {
        const src = this.ev(args[0])
        if (isFormulaError(src)) return src
        const a = this.arr(src)
        let r = Math.trunc(this.num(args[1]))
        let c = args[2] === undefined ? 0 : Math.trunc(this.num(args[2]))
        if (args[2] === undefined && a.rows === 1 && a.cols > 1) { c = r; r = 1 }   // 单行区间只给一个号 ⇒ 当第几栏
        else if (args[2] === undefined && a.cols === 1) c = 1
        if (r < 0 || c < 0 || r > a.rows || c > a.cols) return '#REF!'
        if (r === 0 && c === 0) return src
        if (isRef(src)) {
          if (r === 0) return { ...src, c0: src.c0 + c - 1, c1: src.c0 + c - 1 }   // ...src 带着 s（跨表那张）
          if (c === 0) return { ...src, r0: src.r0 + r - 1, r1: src.r0 + r - 1 }
          return { ...src, r0: src.r0 + r - 1, c0: src.c0 + c - 1, r1: src.r0 + r - 1, c1: src.c0 + c - 1 }
        }
        if (r === 0) return { t: 'arr', rows: a.rows, cols: 1, d: Array.from({ length: a.rows }, (_, i) => a.d[i * a.cols + c - 1]) }
        if (c === 0) return { t: 'arr', rows: 1, cols: a.cols, d: a.d.slice((r - 1) * a.cols, r * a.cols) }
        return a.d[(r - 1) * a.cols + c - 1]
      }
      case 'CHOOSE': {
        const i = Math.trunc(this.num(args[0]))
        if (i < 1 || i >= args.length) return '#VALUE!'
        return this.ev(args[i])
      }
      // ── 文字 ──
      case 'CONCAT': case 'TEXTJOIN': {
        const parts: string[] = []
        let delim = '', skipEmpty = false, from = 0
        if (name === 'TEXTJOIN') { delim = toText(this.s(args[0])); skipEmpty = toBool(this.s(args[1])); from = 2 }
        for (const a of args.slice(from)) {
          const v = this.ev(a)
          const xs = isRef(v) || isArr(v) ? this.arr(v).d : [v]
          for (const x of xs) { const t = toText(x); if (skipEmpty && t === '') continue; parts.push(t) }
        }
        const out = parts.join(delim)
        return out.length > 32767 ? '#VALUE!' : out
      }
      case 'LEFT': case 'RIGHT': return this.lift(args.length === 1 ? [args[0], { k: 'num', v: 1 }] : args, (t, n) => {
        const s = toText(t), k = Math.trunc(toNum(n))
        if (k < 0) return fail('#VALUE!')
        return name === 'LEFT' ? s.slice(0, k) : k === 0 ? '' : s.slice(Math.max(0, s.length - k))
      })
      case 'MID': return this.lift(args, (t, st, n) => {
        const s = toText(t), a = Math.trunc(toNum(st)), k = Math.trunc(toNum(n))
        if (a < 1 || k < 0) return fail('#VALUE!')
        return s.slice(a - 1, a - 1 + k)
      })
      case 'LEN': return this.lift(args, t => toText(t).length)
      case 'TRIM': return this.lift(args, t => toText(t).replace(/^ +| +$/g, '').replace(/ {2,}/g, ' '))   // Excel TRIM 只认半形空白（字码 32）
      case 'UPPER': return this.lift(args, t => toText(t).toUpperCase())
      case 'LOWER': return this.lift(args, t => toText(t).toLowerCase())
      case 'VALUE': return this.lift(args, t => {
        if (typeof t === 'number') return t
        if (t === null) return 0
        if (typeof t === 'boolean') return fail('#VALUE!')
        const n = parseNumberText(toText(t))
        return n === null ? fail('#VALUE!') : n
      })
      case 'TEXT': return this.lift(args, (x, f) => {
        const fmt = toText(f)
        let n: number
        if (typeof x === 'number') n = x
        else if (x === null) n = 0
        else if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE'
        else { const t = toText(x); const p = parseNumberText(t); if (p === null) return t; n = p }   // 认不得是数的文字 ⇒ 原样（Excel TEXT("abc","0")＝"abc"）
        return formatText(n, fmt)
      })
      case 'SUBSTITUTE': return this.lift(args, (t, o, nw, inst) => {
        const s = toText(t), old = toText(o), rep = toText(nw)
        if (old === '') return s
        if (inst === undefined || args.length < 4) return s.split(old).join(rep)
        const k = Math.trunc(toNum(inst))
        if (k < 1) return fail('#VALUE!')
        let idx = -1
        for (let i = 0; i < k; i++) { idx = s.indexOf(old, idx + 1); if (idx < 0) return s }
        return s.slice(0, idx) + rep + s.slice(idx + old.length)
      })
      case 'FIND': return this.lift(args, (f, w, st) => {   // 分大小写·不认通配（Microsoft FIND 说明）
        const needle = toText(f), hay = toText(w)
        const start = args.length >= 3 ? Math.trunc(toNum(st)) : 1
        if (start < 1 || start > hay.length + 1) return fail('#VALUE!')
        const i = hay.indexOf(needle, start - 1)
        return i < 0 ? fail('#VALUE!') : i + 1
      })
      // ── 日期 ──
      case 'TODAY': return Math.floor(this.nowSerial())
      case 'NOW': return this.nowSerial()
      case 'DATE': return this.lift(args, (y, m, d) => {   // 年 0–1899 自动加 1900；月日可溢出（Microsoft DATE 说明）
        let yy = Math.trunc(toNum(y))
        if (yy < 0 || yy > 9999) return fail('#NUM!')
        if (yy < 1900) yy += 1900
        const s = ymdToSerial(yy, Math.trunc(toNum(m)), Math.trunc(toNum(d)))
        return s === null ? fail('#NUM!') : s
      })
      case 'YEAR': case 'MONTH': case 'DAY': return this.lift(args, x => {
        const ymd = serialToYmd(dateArg(x))
        if (!ymd) return fail('#NUM!')
        return name === 'YEAR' ? ymd.y : name === 'MONTH' ? ymd.m : ymd.d
      })
      case 'WEEKDAY': return this.lift(args, (x, t) => {
        const n = Math.floor(dateArg(x))
        const type = args.length >= 2 && t !== null ? Math.trunc(toNum(t)) : 1
        const sun0 = ((n + 6) % 7)   // 0＝星期日（Excel 把序号 1、即 1900-01-01 当星期日）
        if (type === 1) return sun0 + 1
        if (type === 2) return ((sun0 + 6) % 7) + 1
        if (type === 3) return (sun0 + 6) % 7
        if (type >= 11 && type <= 17) { const startSun0 = (type - 10) % 7; return ((sun0 - startSun0 + 7) % 7) + 1 }
        return fail('#NUM!')
      })
      case 'EOMONTH': return this.lift(args, (x, m) => {
        const ymd = serialToYmd(dateArg(x))
        if (!ymd) return fail('#NUM!')
        const s = ymdToSerial(ymd.y, ymd.m + Math.trunc(toNum(m)) + 1, 0)
        return s === null ? fail('#NUM!') : s
      })
      case 'DATEDIF': return this.lift(args, (a, b, u) => datedif(dateArg(a), dateArg(b), toText(u)))
    }
    return this.call2(name, args)
  }

  /** 第二批函数（行为照 Microsoft 各函数说明页·依据写在 formula-fns2.test.ts 各题） */
  private call2(name: string, args: Node[]): V {
    const n = args.length
    switch (name) {
      // ── 数学 ──
      case 'PRODUCT': { const xs = this.nums(args); return xs.length ? xs.reduce((a, b) => a * b, 1) : 0 }
      case 'SUMSQ': return this.nums(args).reduce((a, b) => a + b * b, 0)
      case 'POWER': return this.lift(args, (x, y) => binop('^', x, y))
      case 'SQRT': return this.lift(args, x => { const v = toNum(x); return v < 0 ? fail('#NUM!') : Math.sqrt(v) })
      case 'SIGN': return this.lift(args, x => Math.sign(toNum(x)))
      case 'PI': return Math.PI
      case 'EXP': return this.lift(args, x => Math.exp(toNum(x)))
      case 'LN': return this.lift(args, x => { const v = toNum(x); return v <= 0 ? fail('#NUM!') : Math.log(v) })
      case 'LOG10': return this.lift(args, x => { const v = toNum(x); return v <= 0 ? fail('#NUM!') : Math.log10(v) })
      case 'LOG': return this.lift(args, (x, b) => {
        const v = toNum(x), base = opt(b, 10)
        if (v <= 0 || base <= 0) return fail('#NUM!')
        if (base === 1) return fail('#DIV/0!')
        return base === 10 ? Math.log10(v) : base === 2 ? Math.log2(v) : Math.log(v) / Math.log(base)
      })
      case 'TRUNC': return this.lift(args, (x, d) => roundTo(toNum(x), opt(d, 0), 'down'))
      case 'CEILING': case 'FLOOR': return this.lift(args, (x, s) => {   // 正数配负倍数 ⇒ #NUM!·倍数 0：CEILING 回 0、FLOOR #DIV/0!
        const v = toNum(x), sig = toNum(s)
        if (sig === 0) return name === 'CEILING' ? 0 : fail('#DIV/0!')
        if (v > 0 && sig < 0) return fail('#NUM!')
        const q = to15(v / sig)
        return (name === 'CEILING' ? Math.ceil(q) : Math.floor(q)) * sig
      })
      case 'CEILING.MATH': case 'FLOOR.MATH': return this.lift(args, (x, s, m) => {   // 倍数取绝对值；负数 mode≠0：CEILING 远离 0、FLOOR 靠近 0
        const v = toNum(x), sig = Math.abs(opt(s, 1)), away = opt(m, 0) !== 0
        if (sig === 0) return 0
        const q = to15(v / sig)
        const up = name === 'CEILING.MATH' ? !(v < 0 && away) : (v < 0 && away)
        return (up ? Math.ceil(q) : Math.floor(q)) * sig
      })
      case 'MROUND': return this.lift(args, (x, m) => {
        const v = toNum(x), mm = toNum(m)
        if (mm === 0) return 0
        if (v * mm < 0) return fail('#NUM!')
        return roundTo(v / mm, 0, 'half') * mm
      })
      case 'EVEN': case 'ODD': return this.lift(args, x => {   // 远离 0 进到最近的偶数／奇数
        const v = toNum(x), sg = v < 0 ? -1 : 1, a = Math.abs(to15(v))
        return sg * (name === 'EVEN' ? Math.ceil(a / 2) * 2 : Math.ceil((a + 1) / 2) * 2 - 1)
      })
      case 'QUOTIENT': return this.lift(args, (x, y) => { const d = toNum(y); return d === 0 ? fail('#DIV/0!') : Math.trunc(to15(toNum(x) / d)) })
      case 'GCD': case 'LCM': {
        const xs = this.nums(args).map(x => Math.trunc(x))
        if (xs.some(x => x < 0)) return '#NUM!'
        const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b))
        if (name === 'GCD') return xs.reduce((a, b) => g(a, b), 0)
        if (xs.some(x => x === 0)) return 0
        return xs.reduce((a, b) => (a / g(a, b)) * b, 1)
      }
      case 'FACT': return this.lift(args, x => {
        const k = Math.trunc(toNum(x))
        if (k < 0) return fail('#NUM!')
        let p = 1
        for (let i = 2; i <= k && Number.isFinite(p); i++) p *= i
        return p
      })
      case 'RAND': return Math.random()
      case 'RANDBETWEEN': return this.lift(args, (a, b) => {
        const lo = Math.ceil(toNum(a)), hi = Math.floor(toNum(b))
        if (lo > hi) return fail('#NUM!')
        return lo + Math.floor(Math.random() * (hi - lo + 1))
      })
      // ── 统计 ──
      case 'STDEV': case 'STDEV.S': case 'STDEVP': case 'STDEV.P': case 'VAR': case 'VAR.S': case 'VARP': case 'VAR.P': {
        const v = variance(this.nums(args), !(name.endsWith('P') || name.endsWith('.P')))
        return name.startsWith('STDEV') ? Math.sqrt(v) : v
      }
      case 'MODE': case 'MODE.SNGL': {   // 出现最多次的数·并列取先出现的·都只出现一次 ⇒ #N/A
        const xs = this.nums(args)
        const cnt = new Map<number, number>()
        let best: number | null = null, bestN = 1
        for (const x of xs) {
          const k = to15(x), c = (cnt.get(k) ?? 0) + 1
          cnt.set(k, c)
          if (c > bestN) { bestN = c; best = k }
        }
        if (best === null) return '#N/A'
        return xs.find(x => cnt.get(to15(x)) === bestN)!
      }
      case 'RANK.EQ': return this.call('RANK', args)
      case 'RANK.AVG': {   // 同值取名次平均
        const x = this.num(args[0])
        const xs = this.nums([args[1]])
        const asc = args[2] !== undefined && this.num(args[2]) !== 0
        const same = xs.filter(y => eq15(y, x)).length
        if (!same) return '#N/A'
        return 1 + xs.filter(y => !eq15(y, x) && (asc ? y < x : y > x)).length + (same - 1) / 2
      }
      case 'PERCENTILE': case 'PERCENTILE.INC': return percentileInc(this.nums([args[0]]), this.num(args[1]))
      case 'QUARTILE': case 'QUARTILE.INC': {
        const q = Math.trunc(this.num(args[1]))
        if (q < 0 || q > 4) return '#NUM!'
        return percentileInc(this.nums([args[0]]), q / 4)
      }
      // ── 资讯（错误不往外传·判断本身） ──
      case 'ISBLANK': return this.lift(args, x => x === null)
      case 'ISNUMBER': return this.lift(args, x => typeof x === 'number')
      case 'ISTEXT': return this.lift(args, x => typeof x === 'string' && !isFormulaError(x))
      case 'ISNONTEXT': return this.lift(args, x => !(typeof x === 'string' && !isFormulaError(x)))
      case 'ISLOGICAL': return this.lift(args, x => typeof x === 'boolean')
      case 'ISERROR': return this.lift(args, x => isFormulaError(x))
      case 'ISERR': return this.lift(args, x => isFormulaError(x) && x !== '#N/A')
      case 'ISNA': return this.lift(args, x => x === '#N/A')
      case 'ISEVEN': case 'ISODD': return this.lift(args, x => {
        const r = Math.abs(Math.trunc(toNum(x))) % 2
        return name === 'ISEVEN' ? r === 0 : r === 1
      })
      case 'N': return this.lift(args, x => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : isFormulaError(x) ? fail(x) : 0))
      case 'T': return this.lift(args, x => (isFormulaError(x) ? fail(x) : typeof x === 'string' ? x : ''))
      // ── 文字 ──
      case 'SEARCH': return this.lift(args, (f, w, st) => {   // 不分大小写·认通配 * ? ~（Microsoft SEARCH 说明）
        const needle = toText(f), hay = toText(w)
        const start = n >= 3 ? Math.trunc(toNum(st)) : 1
        if (start < 1 || start > hay.length + 1) return fail('#VALUE!')
        if (needle === '') return start
        const m = new RegExp(wildcardSource(needle), 'i').exec(hay.slice(start - 1))
        return m ? m.index + start : fail('#VALUE!')
      })
      case 'REPLACE': return this.lift(args, (t, st, k, nw) => {
        const s = toText(t), a = Math.trunc(toNum(st)), len = Math.trunc(toNum(k))
        if (a < 1 || len < 0) return fail('#VALUE!')
        return s.slice(0, a - 1) + toText(nw) + s.slice(a - 1 + len)
      })
      case 'REPT': return this.lift(args, (t, k) => {
        const s = toText(t), times = Math.trunc(toNum(k))
        if (times < 0 || s.length * times > 32767) return fail('#VALUE!')
        return s.repeat(times)
      })
      case 'PROPER': return this.lift(args, t => {   // 字母前一字不是字母 ⇒ 大写·其余小写（数字后面也算词首：2nd ⇒ 2Nd·照 Excel）
        let out = '', prev = false
        for (const ch of toText(t)) { const isL = /\p{L}/u.test(ch); out += isL ? (prev ? ch.toLowerCase() : ch.toUpperCase()) : ch; prev = isL }
        return out
      })
      case 'EXACT': return this.lift(args, (a, b) => toText(a) === toText(b))
      case 'CHAR': return this.lift(args, x => { const k = Math.trunc(toNum(x)); return k < 1 || k > 255 ? fail('#VALUE!') : String.fromCharCode(k) })
      case 'UNICHAR': return this.lift(args, x => { const k = Math.trunc(toNum(x)); return k < 1 || k > 0x10ffff ? fail('#VALUE!') : String.fromCodePoint(k) })
      case 'CODE': case 'UNICODE': return this.lift(args, x => { const s = toText(x); return s === '' ? fail('#VALUE!') : s.codePointAt(0)! })
      case 'CLEAN': return this.lift(args, x => toText(x).replace(/[\u0000-\u001F]/g, ''))
      case 'CONCATENATE': return this.lift(args, (...xs) => { const s = xs.map(toText).join(''); return s.length > 32767 ? fail('#VALUE!') : s })
      case 'TEXTBEFORE': case 'TEXTAFTER': {
        const s = toText(this.s(args[0])), d = toText(this.s(args[1]))
        const inst = n >= 3 && args[2] ? Math.trunc(this.num(args[2])) : 1
        const ci = n >= 4 && this.num(args[3]) !== 0
        const atEnd = n >= 5 && toBool(this.s(args[4]))
        if (inst === 0 || Math.abs(inst) > s.length + 1) return '#VALUE!'
        const hay = ci ? s.toLowerCase() : s, nd = ci ? d.toLowerCase() : d
        const hits: Array<{ i: number; len: number }> = []
        if (nd === '') hits.push({ i: inst > 0 ? 0 : s.length, len: 0 })
        else for (let i = hay.indexOf(nd); i >= 0; i = hay.indexOf(nd, i + nd.length)) hits.push({ i, len: nd.length })
        if (atEnd) { if (inst > 0) hits.push({ i: s.length, len: 0 }); else hits.unshift({ i: 0, len: 0 }) }
        const h = inst > 0 ? hits[inst - 1] : hits[hits.length + inst]
        if (!h) return n >= 6 ? this.ev(args[5]) : '#N/A'
        return name === 'TEXTBEFORE' ? s.slice(0, h.i) : s.slice(h.i + h.len)
      }
      case 'NUMBERVALUE': return this.lift(args, (t, ds, gs) => {
        if (typeof t === 'number') return t
        const dec = ds === undefined ? '.' : toText(ds)[0] ?? '', grp = gs === undefined ? ',' : toText(gs)[0] ?? ''
        if (!dec || dec === grp) return fail('#VALUE!')
        let s = toText(t).replace(/\s+/g, '')
        if (s === '') return 0
        if (grp) s = s.split(grp).join('')
        if (s.split(dec).length > 2) return fail('#VALUE!')
        const v = parseNumberText(s.replace(dec, '.'))
        return v === null ? fail('#VALUE!') : v
      })
      case 'FIXED': return this.lift(args, (x, d, nc) => {
        const dd = Math.trunc(opt(d, 2)), noCommas = nc !== undefined && toBool(nc)
        const r = roundTo(toNum(x), dd, 'half')
        const [i, f] = Math.abs(r).toFixed(Math.max(0, Math.min(dd, 127))).split('.')
        return (r < 0 ? '-' : '') + (noCommas ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + (f ? '.' + f : '')
      })
      // ── 查找／引用 ──
      case 'HLOOKUP': {
        const key = this.s(args[0])
        if (isFormulaError(key)) return key
        const tb = this.range(args[1])
        const row = Math.trunc(this.num(args[2]))
        const approx = args[3] === undefined ? true : toBool(this.s(args[3]))
        if (row < 1) return '#VALUE!'
        if (row > tb.rows) return '#REF!'
        const first = tb.d.slice(0, tb.cols)
        const i = approx ? approxIndex(first, key, 1) : exactIndex(first, key, true, false)
        return i < 0 ? '#N/A' : tb.d[(row - 1) * tb.cols + i]
      }
      case 'LOOKUP': {   // 向量式（第 3 参）·省第 3 参：一维就在自己里面找·二维照宽高挑首行／首列找、回末行／末列（Microsoft LOOKUP 说明）
        const key = this.s(args[0])
        if (isFormulaError(key)) return key
        const a = this.range(args[1])
        let look: Scalar[], res: Scalar[]
        if (n >= 3) {
          if (a.rows !== 1 && a.cols !== 1) return '#N/A'
          look = a.d; res = this.range(args[2]).d
        } else if (a.rows === 1 || a.cols === 1) { look = res = a.d }
        else if (a.cols > a.rows) { look = a.d.slice(0, a.cols); res = a.d.slice((a.rows - 1) * a.cols) }
        else { look = []; res = []; for (let r = 0; r < a.rows; r++) { look.push(a.d[r * a.cols]); res.push(a.d[r * a.cols + a.cols - 1]) } }
        const i = approxIndex(look, key, 1)
        return i < 0 || i >= res.length ? '#N/A' : res[i]
      }
      case 'ROW': case 'COLUMN': {
        if (n === 0) {
          const k = this.cur[this.cur.length - 1]
          const p = k ? parseRef(k) : null
          if (!p) return '#VALUE!'
          return name === 'ROW' ? p.row + 1 : p.col + 1
        }
        const v = this.ev(args[0])
        if (isFormulaError(v)) return v
        if (!isRef(v)) return '#VALUE!'
        return name === 'ROW' ? v.r0 + 1 : v.c0 + 1
      }
      case 'ROWS': case 'COLUMNS': {
        const v = this.ev(args[0])
        if (isFormulaError(v)) return v
        if (isRef(v)) return name === 'ROWS' ? v.r1 - v.r0 + 1 : v.c1 - v.c0 + 1
        if (isArr(v)) return name === 'ROWS' ? v.rows : v.cols
        return 1
      }
      case 'OFFSET': {
        const v = this.ev(args[0])
        if (isFormulaError(v)) return v
        if (!isRef(v)) return '#VALUE!'
        const r0 = v.r0 + Math.trunc(this.num(args[1])), c0 = v.c0 + Math.trunc(this.num(args[2]))
        const h = n >= 4 && args[3] ? Math.trunc(this.num(args[3])) : v.r1 - v.r0 + 1
        const w = n >= 5 && args[4] ? Math.trunc(this.num(args[4])) : v.c1 - v.c0 + 1
        if (r0 < 0 || c0 < 0 || h < 1 || w < 1 || r0 + h - 1 > 999998 || c0 + w - 1 > 18277) return '#REF!'
        return { ...v, r0, c0, r1: r0 + h - 1, c1: c0 + w - 1 }
      }
      case 'INDIRECT': {
        const t = toText(this.s(args[0])).trim()
        if (n >= 2 && !toBool(this.s(args[1]))) return '#REF!'   // R1C1 写法不认
        const pre = sheetPrefixAt(t, 0)
        const body = (pre ? t.slice(pre.end) : t).replace(/\$/g, '').toUpperCase()
        const at = pre ? { sh: pre.name } : {}
        let m: RegExpExecArray | null
        if ((m = /^([A-Z]{1,3}\d{1,6})(?::([A-Z]{1,3}\d{1,6}))?$/.exec(body))) return this.ev(m[2] ? { k: 'range', a: m[1], b: m[2], ...at } : { k: 'ref', v: m[1], ...at })
        if ((m = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(body))) return this.ev({ k: 'cols', a: m[1], b: m[2], ...at })
        return '#REF!'
      }
      case 'ADDRESS': return this.lift(args, (r, c, ab, a1, sh) => {
        const row = Math.trunc(toNum(r)), col = Math.trunc(toNum(c)), abs = Math.trunc(opt(ab, 1))
        if (row < 1 || row > 1048576 || col < 1 || col > 18278 || abs < 1 || abs > 4) return fail('#VALUE!')
        const rAbs = abs === 1 || abs === 2, cAbs = abs === 1 || abs === 3
        const ref = a1 === undefined || toBool(a1)
          ? `${cAbs ? '$' : ''}${indexToCol(col - 1)}${rAbs ? '$' : ''}${row}`
          : `R${rAbs ? row : `[${row}]`}C${cAbs ? col : `[${col}]`}`
        const s = sh === undefined ? '' : toText(sh)
        return s ? `${quoteSheetName(s)}!${ref}` : ref
      })
      // ── 日期时间 ──
      case 'TIME': return this.lift(args, (h, m, s) => {
        const H = Math.trunc(toNum(h)), M = Math.trunc(toNum(m)), S = Math.trunc(toNum(s))
        if (H > 32767 || M > 32767 || S > 32767) return fail('#NUM!')
        const total = H * 3600 + M * 60 + S
        if (total < 0) return fail('#NUM!')
        return (total % 86400) / 86400
      })
      case 'HOUR': case 'MINUTE': case 'SECOND': return this.lift(args, x => {
        const t = serialToHms(dateArg(x))
        return name === 'HOUR' ? t.h : name === 'MINUTE' ? t.mi : t.s
      })
      case 'EDATE': return this.lift(args, (x, m) => {   // 月底日对到目标月的最后一天（1/31 加一个月 ⇒ 2/28）
        const ymd = serialToYmd(dateArg(x))
        if (!ymd) return fail('#NUM!')
        const total = ymd.y * 12 + (ymd.m - 1) + Math.trunc(toNum(m))
        const ty = Math.floor(total / 12), tm = total - ty * 12 + 1
        if (ty < 1900 || ty > 9999) return fail('#NUM!')
        const s = ymdToSerial(ty, tm, Math.min(ymd.d, daysInMonth(ty, tm)))
        return s === null ? fail('#NUM!') : s
      })
      case 'DAYS': return this.lift(args, (e, s) => Math.floor(dateArg(e)) - Math.floor(dateArg(s)))
      case 'NETWORKDAYS': {
        const a = Math.floor(dateArg(this.s(args[0]))), b = Math.floor(dateArg(this.s(args[1])))
        const hol = this.holidays(args[2])
        const lo = Math.min(a, b), hi = Math.max(a, b)
        let k = 0
        for (let d = lo; d <= hi; d++) if (!isWeekend(d) && !hol.has(d)) k++
        return a <= b ? k : -k
      }
      case 'WORKDAY': {
        let d = Math.floor(dateArg(this.s(args[0])))
        let left = Math.trunc(this.num(args[1]))
        if (Math.abs(left) > 1_000_000) return '#NUM!'
        const hol = this.holidays(args[2])
        const step = left < 0 ? -1 : 1
        while (left !== 0) { d += step; if (d < 0 || d > SERIAL_MAX) return '#NUM!'; if (!isWeekend(d) && !hol.has(d)) left -= step }
        return d
      }
      case 'WEEKNUM': return this.lift(args, (x, t) => {   // 1 月 1 日那周是第 1 周；类型定一周从星期几起（21＝ISO）
        const d = Math.floor(dateArg(x)), type = Math.trunc(opt(t, 1))
        if (type === 21) return isoWeek(d)
        const start = type === 1 || type === 17 ? 0 : type === 2 || type === 11 ? 1 : type >= 12 && type <= 16 ? type - 10 : -1
        if (start < 0) return fail('#NUM!')
        const ymd = serialToYmd(d)
        const jan1 = ymd ? ymdToSerial(ymd.y, 1, 1) : null
        if (jan1 === null) return fail('#NUM!')
        const off = (((jan1 + 6) % 7) - start + 7) % 7
        return Math.floor((d - jan1 + off) / 7) + 1
      })
      case 'ISOWEEKNUM': return this.lift(args, x => isoWeek(Math.floor(dateArg(x))))
      case 'DATEVALUE': case 'TIMEVALUE': return this.lift(args, x => {
        if (isFormulaError(x)) return fail(x)
        if (typeof x !== 'string') return fail('#VALUE!')
        const v = parseDateTimeText(x)
        if (v === null) return fail('#VALUE!')
        return name === 'DATEVALUE' ? Math.floor(v) : v - Math.floor(v)
      })
      case 'YEARFRAC': return this.lift(args, (a, b, bs) => yearfrac(Math.floor(dateArg(a)), Math.floor(dateArg(b)), Math.trunc(opt(bs, 0))))
      // ── 财务（现金流正负号照 Excel：付出为负、收入为正） ──
      case 'PMT': return this.lift(args, (r, k, pv, fv, ty) => {
        const rate = toNum(r), nper = toNum(k), p = toNum(pv), f = opt(fv, 0), t = opt(ty, 0) ? 1 : 0
        if (nper === 0) return fail('#NUM!')
        if (rate === 0) return -(p + f) / nper
        const g = Math.pow(1 + rate, nper)
        return -(rate * (f + p * g)) / ((1 + rate * t) * (g - 1))
      })
      case 'FV': return this.lift(args, (r, k, pm, pv, ty) => {
        const rate = toNum(r), nper = toNum(k), pmt = toNum(pm), p = opt(pv, 0), t = opt(ty, 0) ? 1 : 0
        if (rate === 0) return -(p + pmt * nper)
        const g = Math.pow(1 + rate, nper)
        return -(p * g + pmt * (1 + rate * t) * (g - 1) / rate)
      })
      case 'PV': return this.lift(args, (r, k, pm, fv, ty) => {
        const rate = toNum(r), nper = toNum(k), pmt = toNum(pm), f = opt(fv, 0), t = opt(ty, 0) ? 1 : 0
        if (rate === 0) return -(f + pmt * nper)
        const g = Math.pow(1 + rate, nper)
        return -(f + pmt * (1 + rate * t) * (g - 1) / rate) / g
      })
      case 'NPER': return this.lift(args, (r, pm, pv, fv, ty) => {
        const rate = toNum(r), pmt = toNum(pm), p = toNum(pv), f = opt(fv, 0), t = opt(ty, 0) ? 1 : 0
        if (rate === 0) return pmt === 0 ? fail('#NUM!') : -(p + f) / pmt
        const num = pmt * (1 + rate * t) - f * rate, den = p * rate + pmt * (1 + rate * t)
        if (den === 0 || num / den <= 0) return fail('#NUM!')
        return Math.log(num / den) / Math.log(1 + rate)
      })
      case 'NPV': {   // 第一笔在第 1 期末
        const rate = this.num(args[0])
        if (rate === -1) return '#DIV/0!'
        return this.nums(args.slice(1)).reduce((s, v, i) => s + v / Math.pow(1 + rate, i + 1), 0)
      }
      case 'RATE': return this.lift(args, (k, pm, pv, fv, ty, gs) => {
        const nper = toNum(k), pmt = toNum(pm), p = toNum(pv), f = opt(fv, 0), t = opt(ty, 0) ? 1 : 0
        const eq = (r: number) => (r === 0 ? p + pmt * nper + f : p * Math.pow(1 + r, nper) + pmt * (1 + r * t) * (Math.pow(1 + r, nper) - 1) / r + f)
        return newton(eq, opt(gs, 0.1))
      })
      case 'IRR': {   // 第一笔在第 0 期；要同时有正有负
        const vs = this.nums([args[0]])
        if (!vs.some(v => v > 0) || !vs.some(v => v < 0)) return '#NUM!'
        return newton(r => vs.reduce((s, v, i) => s + v / Math.pow(1 + r, i), 0), n >= 2 ? this.num(args[1]) : 0.1)
      }
    }
    return '#NAME?'
  }
  /** 假日清单（NETWORKDAYS／WORKDAY 第 3 参）：区间里的日期序号·文字日期也认 */
  private holidays(a: Node | undefined): Set<number> {
    const out = new Set<number>()
    if (!a) return out
    const v = this.ev(a)
    for (const x of this.arr(isFormulaError(v) ? fail(v) : v).d) {
      if (x === null || x === '') continue
      out.add(Math.floor(dateArg(x)))
    }
    return out
  }
}

/** 选填参数：没写 ⇒ 预设值（写了空格照四则当 0） */
function opt(x: Scalar | undefined, d: number): number { return x === undefined ? d : toNum(x) }
function variance(xs: number[], sample: boolean): number {
  const k = xs.length
  if (k < (sample ? 2 : 1)) return fail('#DIV/0!')
  const m = xs.reduce((a, b) => a + b, 0) / k
  return xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (sample ? k - 1 : k)
}
/** PERCENTILE.INC：排序后在 k×(n−1) 的位置线性内插 */
function percentileInc(xs: number[], k: number): number {
  if (!xs.length || k < 0 || k > 1) return fail('#NUM!')
  const s = [...xs].sort((a, b) => a - b)
  const pos = k * (s.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
/** 序号是不是星期六日（序号 1＝1900-01-01 当星期日·同 WEEKDAY） */
function isWeekend(d: number): boolean { const w = (d + 6) % 7; return w === 0 || w === 6 }
/** ISO 周：星期一起·那周的星期四落在哪一年就算哪一年的第几周 */
function isoWeek(d: number): number {
  const sun0 = (d + 6) % 7, iso = sun0 === 0 ? 7 : sun0
  const thu = d - iso + 4
  const ymd = serialToYmd(thu)
  const jan1 = ymd ? ymdToSerial(ymd.y, 1, 1) : null
  if (jan1 === null) return fail('#NUM!')
  return Math.floor((thu - jan1) / 7) + 1
}
/** YEARFRAC：basis 0 美式 30/360·1 实际/实际·2 实际/360·3 实际/365·4 欧式 30/360（算法同 Excel 公开说明与 LibreOffice） */
function yearfrac(a: number, b: number, basis: number): number {
  if (basis < 0 || basis > 4) return fail('#NUM!')
  const s = Math.min(a, b), e = Math.max(a, b)
  const p = serialToYmd(s), q = serialToYmd(e)
  if (!p || !q) return fail('#NUM!')
  if (basis === 2) return (e - s) / 360
  if (basis === 3) return (e - s) / 365
  if (basis === 0 || basis === 4) {
    let sd = p.d, ed = q.d
    if (basis === 4) { if (sd === 31) sd = 30; if (ed === 31) ed = 30 }
    else {
      const lastFeb = (y: number, m: number, d: number) => m === 2 && d === daysInMonth(y, 2)
      if (lastFeb(p.y, p.m, p.d) && lastFeb(q.y, q.m, q.d)) { sd = 30; ed = 30 }
      else if (lastFeb(p.y, p.m, p.d)) sd = 30
      if (ed === 31 && sd >= 30) ed = 30
      if (sd === 31) sd = 30
    }
    return ((q.y - p.y) * 360 + (q.m - p.m) * 30 + (ed - sd)) / 360
  }
  // basis 1：一年以内看期间有没有 2/29（有 ⇒ 366）；跨好几年 ⇒ 用这几个年头的平均天数
  const withinYear = p.y === q.y || (q.y === p.y + 1 && (p.m > q.m || (p.m === q.m && p.d >= q.d)))
  if (withinYear) {
    let ylen = 365
    if (p.y === q.y) { if (isLeapYear(p.y)) ylen = 366 }
    else {
      for (const y of [p.y, q.y]) {
        if (!isLeapYear(y)) continue
        const f29 = ymdToSerial(y, 2, 29)
        if (f29 !== null && f29 >= s && f29 <= e) ylen = 366
      }
    }
    return (e - s) / ylen
  }
  const first = ymdToSerial(p.y, 1, 1), after = ymdToSerial(q.y + 1, 1, 1)
  if (first === null || after === null) return fail('#NUM!')
  return (e - s) / ((after - first) / (q.y - p.y + 1))
}
/** 牛顿法解 f(r)=0（RATE／IRR·数值导数·100 步内收不拢 ⇒ #NUM!） */
function newton(f: (r: number) => number, guess: number): number {
  let r = guess
  for (let i = 0; i < 100; i++) {
    const y = f(r)
    if (!Number.isFinite(y)) break
    if (Math.abs(y) < 1e-10) return r
    const h = Math.max(1e-7, Math.abs(r) * 1e-7)
    const d = (f(r + h) - y) / h
    if (!Number.isFinite(d) || d === 0) break
    const nr = r - y / d
    if (nr <= -1) r = (r - 1) / 2
    else { if (Math.abs(nr - r) < 1e-12) return nr; r = nr }
  }
  return fail('#NUM!')
}

/** 日期参数：数＝序号·文字照日期解析（"2026-10-16"）·负或超过 9999-12-31 ⇒ #NUM! */
function dateArg(x: Scalar): number {
  const n = toNum(x)
  if (n < 0 || n > SERIAL_MAX + 1) return fail('#NUM!')
  return n
}
/** DATEDIF（Microsoft DATEDIF 说明·"MD" 的已知怪值照算法出） */
function datedif(a: number, b: number, unit: string): number {
  const s = Math.floor(a), e = Math.floor(b)
  if (s > e) return fail('#NUM!')
  const p = serialToYmd(s), q = serialToYmd(e)
  if (!p || !q) return fail('#NUM!')
  const u = unit.toUpperCase()
  const months = (q.y - p.y) * 12 + (q.m - p.m) - (q.d < p.d ? 1 : 0)
  switch (u) {
    case 'D': return e - s
    case 'M': return months
    case 'Y': return Math.floor(months / 12)
    case 'YM': return months % 12
    case 'MD': {
      if (q.d >= p.d) return q.d - p.d
      const pm = q.m === 1 ? 12 : q.m - 1, py = q.m === 1 ? q.y - 1 : q.y
      return q.d + daysInMonth(py, pm) - p.d
    }
    case 'YD': {
      let start = ymdToSerial(q.y, p.m, p.d)
      if (start === null) return fail('#NUM!')
      if (start > e) { start = ymdToSerial(q.y - 1, p.m, p.d); if (start === null) return fail('#NUM!') }
      return e - start
    }
  }
  return fail('#NUM!')
}

// ── 查找比对 ──
/** 精确比对：同型才比（数 15 位·文字不分大小写·wild＝文字认通配）·数跟文字型数字不算相等（VLOOKUP 的老坑·照 Excel） */
function sameValue(x: Scalar, key: Scalar, wild: RegExp | null): boolean {
  if (key === null) return false
  if (typeof key === 'number') return typeof x === 'number' && eq15(x, key)
  if (typeof key === 'boolean') return x === key
  if (isFormulaError(x)) return false
  if (typeof x !== 'string') return false
  return wild ? wild.test(x) : cmpText(x, key) === 0
}
function exactIndex(list: Scalar[], key: Scalar, allowWild: boolean, reverse: boolean): number {
  const wild = allowWild && typeof key === 'string' && hasWildcard(key) ? wildcardRegex(key) : null
  if (!reverse) { for (let i = 0; i < list.length; i++) if (sameValue(list[i], key, wild)) return i; return -1 }
  for (let i = list.length - 1; i >= 0; i--) if (sameValue(list[i], key, wild)) return i
  return -1
}
/** 近似比对（已排序）：type 1＝不大于 key 的最后一个（升序）·-1＝不小于 key 的最后一个（降序）；只比同型的格 */
function approxIndex(list: Scalar[], key: Scalar, type: number): number {
  if (key === null || isFormulaError(key)) return -1
  let found = -1
  for (let i = 0; i < list.length; i++) {
    const x = list[i]
    if (x === null || isFormulaError(x) || typeof x !== typeof key) continue
    const d = compareScalars(x, key)
    if (type > 0) { if (d <= 0) found = i; else break }
    else { if (d >= 0) found = i; else break }
  }
  return found
}
/** XLOOKUP：mode 0 精确（不认通配）·-1 精确或次小·1 精确或次大·2 通配；reverse＝从后往前 */
function xlookupIndex(list: Scalar[], key: Scalar, mode: number, reverse: boolean): number {
  if (mode === 0 || mode === 2) return exactIndex(list, key, mode === 2, reverse)
  const ex = exactIndex(list, key, false, reverse)
  if (ex >= 0) return ex
  let best = -1
  const order = reverse ? list.map((_, i) => list.length - 1 - i) : list.map((_, i) => i)
  for (const i of order) {
    const x = list[i]
    if (x === null || isFormulaError(x) || key === null || typeof x !== typeof key) continue
    const d = compareScalars(x, key)
    if (mode === -1 && d < 0 && (best < 0 || compareScalars(x, list[best]) > 0)) best = i
    if (mode === 1 && d > 0 && (best < 0 || compareScalars(x, list[best]) < 0)) best = i
  }
  return best
}

// ── 运算 ──
function binop(op: string, a: Scalar, b: Scalar): Scalar {
  if (op === '&') return toText(a) + toText(b)
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    const d = compareScalars(a, b)
    return op === '=' ? d === 0 : op === '<>' ? d !== 0 : op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0
  }
  const x = toNum(a), y = toNum(b)
  if (op === '+') return x + y
  if (op === '-') return x - y
  if (op === '*') return x * y
  if (op === '^') {
    if (x === 0 && y === 0) return fail('#NUM!')
    if (x === 0 && y < 0) return fail('#DIV/0!')
    const r = Math.pow(x, y)
    return Number.isNaN(r) ? fail('#NUM!') : r
  }
  if (y === 0) return fail('#DIV/0!')
  return x / y
}
function broadcast(vs: Array<Scalar | Arr>, f: (xs: Scalar[]) => Scalar): Arr {
  const dims = vs.map(v => (isArr(v) ? { rows: v.rows, cols: v.cols } : { rows: 1, cols: 1 }))
  const rows = Math.max(...dims.map(d => d.rows)), cols = Math.max(...dims.map(d => d.cols))
  if (rows * cols > MAX_RANGE_CELLS) fail('#REF!')
  const d: Scalar[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let miss = false
    const xs = vs.map((v, i) => {
      if (!isArr(v)) return v
      const { rows: R, cols: C } = dims[i]
      const rr = R === 1 ? 0 : r, cc = C === 1 ? 0 : c
      if (rr >= R || cc >= C) { miss = true; return null }
      return v.d[rr * C + cc]
    })
    d.push(miss ? '#N/A' : safe(() => f(xs)))
  }
  return { t: 'arr', rows, cols, d }
}
function safe(f: () => Scalar): Scalar {
  try {
    const v = f()
    return typeof v === 'number' && !Number.isFinite(v) ? '#NUM!' : v
  } catch (e) { return codeOf(e) }
}
function codeOf(e: unknown): FormulaError {
  if (e instanceof FxError || e instanceof ParseFail) return e.code
  return '#ERROR!'
}
function outward(v: Scalar): EvalResult { return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v }

/** 整张表现算：只算有内容的格（显示层按需再取） */
export function computeSheet(content: SheetContent | null | undefined, opts?: EvaluatorOptions): Map<string, EvalResult> {
  const cells = content?.cells ?? {}
  const ev = new SheetEvaluator(cells, content?.merges, opts)
  const out = new Map<string, EvalResult>()
  for (const k of Object.keys(cells)) out.set(k.toUpperCase(), ev.value(k))
  return out
}

/** 显示用：数字收到 15 位有效数字（Excel 精度·0.1+0.2 ⇒ 0.3）·不变科学记数（1E+21 以上才写 E）·空 ⇒ '' */
export function formatValue(v: EvalResult): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? numToText(v) : '#ERROR!'
  return v
}

/** 用户在函数输入框／格里敲的原文 ⇒ 格资料（= 开头当公式；空 ⇒ 删格） */
/** 打不出来、画不出来的字（控制字元〔Tab 换行照留〕、零宽空白、字前 BOM、私用区）：起编辑与写格前都滤掉。
 *  实例：某些鼠标的键盘介面会送一颗没对应字的键并一直连发，浏览器给的 key 是 "\u0000"，原本当首字起编辑 ⇒ 格子开头多一个☒、「=D2*E2」变纯文字。
 *  中文、全形符号、emoji（含 ZWJ 组合）照留。 */
const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u2060\uFEFF\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/gu
export function stripInvisible(s: string): string { return s.replace(INVISIBLE_RE, '') }
/** 格子上按的这一下是不是一个真打得出来的字（keydown 的 key·只有一个字元才算） */
export function isTypedKey(k: string): boolean { return [...k].length === 1 && stripInvisible(k) === k && !/^[\t\n\r]$/.test(k) }
export function cellFromInput(raw: string): CellData | null {
  if (raw === '' ) return null
  if (raw.trim().startsWith('=')) return { v: '', f: raw.trim() }
  return { v: raw }
}
/** 格资料 ⇒ 函数输入框里显示的原文；日期格式的整数序号 ⇒ yyyy/m/d */
export function inputFromCell(cell: CellData | undefined): string {
  if (!cell) return ''
  if (cell.f) return cell.f
  const v = cell.v ?? ''
  const t = cell.s?.numFmt?.t
  if (t === 'date' || t === 'longdate' || t === 'rocdate') {
    const n = parseLiteral(v)
    const x = typeof n === 'number' && Number.isInteger(n) && n >= 1 ? serialToYmd(n) : null
    if (x) return `${x.y}/${x.m}/${x.d}`
  }
  return v
}
