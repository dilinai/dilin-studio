// 公式引擎的纯函数底子
//   值的型别与强制转换（照 Excel）／1900 日期序号（含假闰日 1900-02-29＝60）／15 位有效数字／数字转文字／VALUE 解析／
//   TEXT 格式码／条件串（">10" "<>" 通配 * ? ~）／四舍五入（小数位安全）。
//   全部现写·不引第三方公式库；行为依据＝Microsoft Excel 说明文件（各函数页）与 Excel 实际算法（序号闰日 bug、比较时 15 位）。
//   跟 Excel 不一样的：「1-2」这种不当日期；超过 15 位的长数字（身份证、订单号）
//   与 0 开头的整数（电话 0912…）原样当文字（Excel 打进去会截成 15 位／吃掉前导 0）。

export type FormulaError = '#REF!' | '#DIV/0!' | '#CYCLE!' | '#NAME?' | '#VALUE!' | '#ERROR!' | '#N/A' | '#NUM!'
export const ERRORS: readonly FormulaError[] = ['#REF!', '#DIV/0!', '#CYCLE!', '#NAME?', '#VALUE!', '#ERROR!', '#N/A', '#NUM!']
export function isFormulaError(v: unknown): v is FormulaError { return typeof v === 'string' && (ERRORS as readonly string[]).includes(v) }

/** 求值内部的纯量：数／文字／逻辑／空（null）／错误 */
export type Scalar = number | string | boolean | null | FormulaError

/** 函数里抛出一个错误值（由调用边界接住变回值） */
export class FxError extends Error { code: FormulaError; constructor(code: FormulaError) { super(code); this.code = code } }
export const fail = (code: FormulaError): never => { throw new FxError(code) }

// ── 15 位有效数字 ──
/** Excel 只保 15 位有效数字：比较／显示都先收到 15 位（0.1+0.2=0.3 为 TRUE） */
export function to15(n: number): number { return Number.isFinite(n) && n !== 0 ? Number(n.toPrecision(15)) : n }
export function eq15(a: number, b: number): boolean { return a === b || to15(a) === to15(b) }

/** 数字 ⇒ 文字（& 串接／LEN／CONCAT 用的 Excel 常规口径：15 位有效数字·极大极小改 1E+21 这种写法） */
export function numToText(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!'
  const r = to15(n)
  if (r === 0) return '0'
  const s = String(r)
  if (!/e/.test(s)) return s
  const [m, e] = s.split('e')
  const sign = e[0] === '-' ? '-' : '+'
  const digits = e.replace(/^[-+]/, '')
  return `${m}E${sign}${digits.length < 2 ? '0' + digits : digits}`
}

// ── 四舍五入（以十进位字串移位·避开 2.675 这种二进位误差·Excel ROUND(2.675,2)=2.68） ──
function shift(a: number, d: number): number {
  const [m, e] = a.toExponential().split('e')
  return Number(`${m}e${Number(e) + d}`)
}
export function roundTo(x: number, digits: number, mode: 'half' | 'up' | 'down'): number {
  if (!Number.isFinite(x) || x === 0) return x
  const d = Math.trunc(digits)
  const sign = x < 0 ? -1 : 1
  const a = to15(Math.abs(x))
  const s = shift(a, d)
  const r = mode === 'half' ? Math.floor(s + 0.5) : mode === 'up' ? Math.ceil(s) : Math.floor(s)
  if (r === 0) return 0
  return sign * shift(r, -d)
}

// ── 1900 日期序号（Excel 1900 系统：1＝1900-01-01·60＝不存在的 1900-02-29（Lotus 1-2-3 留下的 bug·Excel 照留）·61＝1900-03-01） ──
export const SERIAL_MAX = 2958465   // 9999-12-31
/** 公历日 ⇒ 距 1970-01-01 天数（Howard Hinnant days_from_civil·不碰 Date 的两位年怪规） */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}
function civilFromDays(z: number): { y: number; m: number; d: number } {
  z += 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}
const BASE = daysFromCivil(1899, 12, 30)
/** 1970-01-01 的序号 */
export const UNIX_EPOCH_SERIAL = 25569
function serialOfFirst(y: number, m: number): number {
  const n = daysFromCivil(y, m, 1) - BASE
  return n < 61 ? n - 1 : n   // 1900-03-01 以前：Excel 少算了自己多出来的 2-29
}
/** 年月日 ⇒ 序号（月、日可溢出／为 0 或负·照 DATE：先定月首再加 d-1）；超出 0..9999-12-31 ⇒ null */
export function ymdToSerial(y: number, m: number, d: number): number | null {
  const total = y * 12 + (m - 1)
  const yy = Math.floor(total / 12), mm = total - yy * 12 + 1
  const n = serialOfFirst(yy, mm) + d - 1
  return n < 0 || n > SERIAL_MAX ? null : n
}
/** 序号 ⇒ 年月日（取整数部分）；0 ⇒ 1900-01-00（Excel 口径）；60 ⇒ 1900-02-29；越界 ⇒ null */
export function serialToYmd(serial: number): { y: number; m: number; d: number } | null {
  if (!Number.isFinite(serial)) return null
  const n = Math.floor(serial)
  if (n < 0 || n > SERIAL_MAX) return null
  if (n === 0) return { y: 1900, m: 1, d: 0 }
  if (n === 60) return { y: 1900, m: 2, d: 29 }
  return civilFromDays(BASE + (n < 60 ? n + 1 : n))
}
/** 序号小数 ⇒ 时分秒（四舍五入到秒） */
export function serialToHms(serial: number): { h: number; mi: number; s: number } {
  let secs = Math.round((serial - Math.floor(serial)) * 86400)
  if (secs >= 86400) secs = 86399
  return { h: Math.floor(secs / 3600), mi: Math.floor((secs % 3600) / 60), s: secs % 60 }
}
export function isLeapYear(y: number): boolean { return y === 1900 || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) }   // 1900 照 Excel 当闰年
export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

// ── 文字 ⇒ 数（VALUE 与四则里的文字强制转换） ──
const NUM_RE = /^([+-])?(?:(\d{1,3}(?:,\d{3})+|\d+)(\.\d*)?|(\.\d+))(e[+-]?\d+)?$/i
/** 文字 ⇒ 数：一般数字（可带千分位、正负号、% 尾、$ ¥ € 前缀、(12) 当负）、日期（yyyy-mm-dd／yyyy/m/d／yyyy年m月d日·可接时分）、时间（h:mm[:ss] [AM|PM]）；认不得 ⇒ null */
export function parseNumberText(raw: string): number | null {
  let s = raw.trim()
  if (s === '') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim() }
  let pct = 0
  while (s.endsWith('%')) { pct++; s = s.slice(0, -1).trim() }
  let sign = ''
  if (/^[+-]/.test(s)) { sign = s[0]; s = s.slice(1).trim() }
  s = s.replace(/^(NT\$|US\$|\$|¥|￥|€)\s*/i, '')
  const m = NUM_RE.exec(sign + s)
  if (m) {
    let n = Number((sign + s).replace(/,/g, ''))
    if (!Number.isFinite(n)) return null
    n = n / Math.pow(100, pct)
    return neg ? -n : n
  }
  if (neg || pct || sign) return null
  return parseDateTimeText(s)
}
/** 日期／时间文字 ⇒ 序号；不是 ⇒ null */
export function parseDateTimeText(s: string): number | null {
  const t = s.trim()
  const m = /^(\d{4})\s*(?:[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})|年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日)(?:[T\s]+(.+))?$/.exec(t)
  if (m) {
    const y = Number(m[1]), mo = Number(m[2] ?? m[4]), d = Number(m[3] ?? m[5])
    if (mo < 1 || mo > 12 || d < 1 || d > (y === 1900 && mo === 2 ? 29 : daysInMonth(y, mo))) return null
    const ser = ymdToSerial(y, mo, d)
    if (ser === null) return null
    if (m[6] === undefined) return ser
    const tm = parseTimeText(m[6])
    return tm === null ? null : ser + tm
  }
  return parseTimeText(t)
}
/**
 * 输入识别：格里直接打的「带四位年」日期 ⇒ 序号；别的 ⇒ null（照旧当文字）。
 *   认：yyyy/m/d、yyyy-m-d（同一种分隔·月日一或两位·前后空白可修·这一天须真的存在）——2026/10/16、2026-1-5、2026/01/05
 *   不认：不带年、不存在的日（2026/2/30、2026/13/1）、带时间（2026-10-16 14:30·维持现况＝文字）、
 *         点或年月日写法（2026.10.16／2026年10月16日·维持现况）、1900 年以前
 *   （公式里的文字强制转换与 COUNTIF 条件串走上面 parseNumberText·那条本来就认带年份写法，这里不动它）
 */
export function parseYmdInput(raw: string): number | null {
  const m = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[3]), d = Number(m[4])
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
  const ser = ymdToSerial(y, mo, d)
  return ser === null || ser < 1 ? null : ser
}
function parseTimeText(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM|A|P)?$/i.exec(s.trim())
  if (!m) return null
  let h = Number(m[1]); const mi = Number(m[2]); const se = m[3] === undefined ? 0 : Number(m[3])
  if (m[4]) { if (h < 1 || h > 12) return null; const pm = /^p/i.test(m[4]); h = (h % 12) + (pm ? 12 : 0) }
  if (h > 23 || mi > 59 || se >= 60) return null
  return (h * 3600 + mi * 60 + se) / 86400
}

// ── 强制转换（照 Excel） ──
/** 四则／数字参数：空 ⇒ 0·TRUE ⇒ 1·文字照 VALUE 解析（认不得 ⇒ #VALUE!）·错误照传 */
export function toNum(v: Scalar): number {
  if (typeof v === 'number') return v
  if (v === null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (isFormulaError(v)) return fail(v)
  const n = parseNumberText(v)
  return n === null ? fail('#VALUE!') : n
}
/** 文字参数：数 ⇒ 常规文字·逻辑 ⇒ TRUE／FALSE·空 ⇒ ""·错误照传 */
export function toText(v: Scalar): string {
  if (typeof v === 'string') { if (isFormulaError(v)) return fail(v); return v }
  if (typeof v === 'number') return numToText(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return ''
}
/** 条件参数：数 ≠ 0 为真·空为假·文字只认 TRUE／FALSE（不分大小写）·其余 #VALUE! */
export function toBool(v: Scalar): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null) return false
  if (isFormulaError(v)) return fail(v)
  const u = v.toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  return fail('#VALUE!')
}

// ── 比较（= <> < > <= >=）·Excel：数 < 文字 < 逻辑；空格跟对方同型（0／""／FALSE）；文字不分大小写；数比 15 位 ──
const rank = (v: number | string | boolean) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2)
export function compareScalars(a: Scalar, b: Scalar): number {
  if (isFormulaError(a)) return fail(a)
  if (isFormulaError(b)) return fail(b)
  const blankFor = (o: Scalar): number | string | boolean => (typeof o === 'string' ? '' : typeof o === 'boolean' ? false : 0)
  const x = a === null ? blankFor(b) : a
  const y = b === null ? blankFor(a) : b
  const rx = rank(x), ry = rank(y)
  if (rx !== ry) return rx < ry ? -1 : 1
  if (typeof x === 'number') { const p = to15(x), q = to15(y as number); return p === q ? 0 : p < q ? -1 : 1 }
  if (typeof x === 'string') return cmpText(x, y as string)
  return x === y ? 0 : x ? 1 : -1
}
export function cmpText(a: string, b: string): number {
  const p = a.toUpperCase(), q = b.toUpperCase()
  return p === q ? 0 : p < q ? -1 : 1
}

// ── 通配（* 任意串·? 一个字·~ 跳脱）·不分大小写·整串比对 ──
export function hasWildcard(s: string): boolean { return /[*?~]/.test(s) }
export function wildcardRegex(pat: string): RegExp { return new RegExp(`^${wildcardSource(pat)}$`, 'i') }
/** 通配样式 ⇒ 不锚定的正则原文（SEARCH 找位置用·整串比对用上面 wildcardRegex） */
export function wildcardSource(pat: string): string {
  let re = ''
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i]
    if (ch === '~' && i + 1 < pat.length && '*?~'.includes(pat[i + 1])) { re += '\\' + pat[++i]; continue }
    if (ch === '*') re += '[\\s\\S]*'
    else if (ch === '?') re += '[\\s\\S]'
    else re += ch.replace(/[.+^${}()|[\]\\/-]/g, '\\$&')
  }
  return re
}

// ── 条件串（SUMIF／COUNTIF／…IFS 的 criteria）──
/**
 * 依据：Microsoft「COUNTIF 函數」「SUMIF 函數」「COUNTIFS 函數」说明——
 *   数字条件也算「文字型数字」的格（"1" 跟 1 同算）；">10" 只比数字格；"" 算空格与空字串；"=" 只算空格；"<>" 算非空；
 *   文字条件不分大小写、认通配 * ? ~；引用到空格的条件当 0；错误格不报错、只是对不上（除非条件本身就是该错误）。
 */
export function makeCriteria(c: Scalar): (v: Scalar) => boolean {
  if (c === null) c = 0
  if (typeof c === 'number') { const n = c; return v => numEqualsCell(n, v) }
  if (typeof c === 'boolean') { const b = c; return v => v === b }
  if (isFormulaError(c)) { const e = c; return v => v === e }
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!
  const op = m[1] ?? ''
  const rest = m[2]
  if (rest === '') {
    if (op === '') return v => v === null || v === ''
    if (op === '=') return v => v === null
    if (op === '<>') return v => v !== null && v !== ''
    return () => false
  }
  const num = parseNumberText(rest)
  if (num !== null) {
    if (op === '' || op === '=') return v => numEqualsCell(num, v)
    if (op === '<>') return v => !numEqualsCell(num, v)
    return v => typeof v === 'number' && cmpOp(op, compareScalars(v, num))
  }
  const up = rest.toUpperCase()
  if (up === 'TRUE' || up === 'FALSE') {
    const b = up === 'TRUE'
    if (op === '' || op === '=') return v => v === b
    if (op === '<>') return v => v !== b
    return v => typeof v === 'boolean' && cmpOp(op, compareScalars(v, b))
  }
  if (isFormulaError(rest)) {
    if (op === '' || op === '=') return v => v === rest
    if (op === '<>') return v => v !== rest
    return () => false
  }
  const re = wildcardRegex(rest)
  const textEq = (v: Scalar) => typeof v === 'string' && !isFormulaError(v) && re.test(v)
  if (op === '' || op === '=') return textEq
  if (op === '<>') return v => !textEq(v)
  return v => typeof v === 'string' && !isFormulaError(v) && cmpOp(op, cmpText(v, rest))
}
function numEqualsCell(n: number, v: Scalar): boolean {
  if (typeof v === 'number') return eq15(v, n)
  if (typeof v === 'string' && !isFormulaError(v)) { const x = parseNumberText(v); return x !== null && eq15(x, n) }
  return false
}
function cmpOp(op: string, d: number): boolean {
  return op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0
}

// ── TEXT(value, format_text) 格式码 ──
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ZH_DAYS = ['日', '一', '二', '三', '四', '五', '六']
/** 依格式码分段（; 分隔·引号与 \ 里的不算） */
function splitSections(fmt: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]
    if (ch === '"') { const j = fmt.indexOf('"', i + 1); const end = j < 0 ? fmt.length : j; cur += fmt.slice(i, end + 1); i = end; continue }
    if (ch === '\\') { cur += fmt.slice(i, i + 2); i++; continue }
    if (ch === ';') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}
type FTok = { k: 'lit'; s: string } | { k: 'code'; s: string }
/** 格式码 ⇒ 字面段与码段（引号、\x、_x 占位、*x 填充、[颜色／地区] 都在这里处理掉） */
function lexFormat(sec: string): FTok[] {
  const out: FTok[] = []
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i]
    if (ch === '"') { const j = sec.indexOf('"', i + 1); const end = j < 0 ? sec.length : j; out.push({ k: 'lit', s: sec.slice(i + 1, end) }); i = end; continue }
    if (ch === '\\') { if (i + 1 < sec.length) out.push({ k: 'lit', s: sec[i + 1] }); i++; continue }
    if (ch === '_') { out.push({ k: 'lit', s: ' ' }); i++; continue }
    if (ch === '*') { i++; continue }
    if (ch === '[') {
      const j = sec.indexOf(']', i)
      const inner = j < 0 ? '' : sec.slice(i + 1, j)
      if (/^(h+|m+|s+)$/i.test(inner)) out.push({ k: 'code', s: `[${inner.toLowerCase()}]` })
      i = j < 0 ? sec.length : j
      continue
    }
    out.push({ k: 'code', s: ch })
  }
  return out
}
function isDateFormat(toks: FTok[]): boolean {
  const code = toks.filter(t => t.k === 'code').map(t => t.s).join('')
  return /[ydhsa]|\[[hms]+\]|m/i.test(code.replace(/E[+-]/gi, ''))
}
/** TEXT 函数：值 n 照格式码出字（常见数字码 0 # ? , . % E+、日期时间码 y m d h s AM/PM aaa aaaa、三段 正;负;零） */
export function formatText(n: number, fmt: string): string {
  const secs = splitSections(fmt)
  let sec = secs[0], v = n, autoMinus = true
  if (n < 0 && secs.length >= 2) { sec = secs[1]; v = -n; autoMinus = false }
  else if (n === 0 && secs.length >= 3) { sec = secs[2] }
  if (/^\s*general\s*$/i.test(sec) || sec === '') return sec === '' && secs.length > 1 ? '' : numToText(n)
  const toks = lexFormat(sec)
  if (isDateFormat(toks)) {
    if (n < 0) return fail('#VALUE!')
    return formatDateCode(n, toks)
  }
  return formatNumberCode(v, toks, autoMinus && v < 0)
}
function formatDateCode(serial: number, toks: FTok[]): string {
  // 把码段串成 token：yyyy yy m.. d.. h.. s.. AM/PM A/P aaaa aaa [h] [m] [s] .0（秒的小数）
  type DT = { k: 'lit'; s: string } | { k: 'y' | 'm' | 'd' | 'h' | 's' | 'ap' | 'a' | 'eh' | 'em' | 'es' | 'frac'; n: number; s?: string }
  const code = toks
  const parts: DT[] = []
  let i = 0
  const flat: Array<{ ch: string; lit: boolean }> = []
  for (const t of code) {
    if (t.k === 'lit') { flat.push({ ch: t.s, lit: true }); continue }
    if (t.s.startsWith('[')) { flat.push({ ch: t.s, lit: false }); continue }
    flat.push({ ch: t.s, lit: false })
  }
  while (i < flat.length) {
    const f = flat[i]
    if (f.lit) { parts.push({ k: 'lit', s: f.ch }); i++; continue }
    const c = f.ch
    if (c === '[h]' || c === '[hh]') { parts.push({ k: 'eh', n: c.length - 2 }); i++; continue }
    if (/^\[m+\]$/.test(c)) { parts.push({ k: 'em', n: c.length - 2 }); i++; continue }
    if (/^\[s+\]$/.test(c)) { parts.push({ k: 'es', n: c.length - 2 }); i++; continue }
    const lc = c.toLowerCase()
    const rest = flat.slice(i).map(x => (x.lit ? '\u0000' : x.ch)).join('')
    if (/^am\/pm/i.test(rest)) { parts.push({ k: 'ap', n: 5 }); i += 5; continue }
    if (/^a\/p/i.test(rest)) { parts.push({ k: 'ap', n: 3, s: rest[0] }); i += 3; continue }
    if ('ymdhsa'.includes(lc)) {
      let j = i
      while (j < flat.length && !flat[j].lit && flat[j].ch.toLowerCase() === lc) j++
      const k = lc as 'y' | 'm' | 'd' | 'h' | 's' | 'a'
      parts.push({ k, n: j - i })
      i = j
      continue
    }
    if (c === '.' && i + 1 < flat.length && flat[i + 1].ch === '0' && parts.length && (parts[parts.length - 1] as { k: string }).k === 's') {
      let j = i + 1
      while (j < flat.length && !flat[j].lit && flat[j].ch === '0') j++
      parts.push({ k: 'frac', n: j - i - 1 }); i = j; continue
    }
    parts.push({ k: 'lit', s: c }); i++
  }
  // m 是月还是分：前一个非字面段是 h，或后一个非字面段是 s ⇒ 分
  const kinds = parts.map(p => p.k)
  const isMinute = (idx: number) => {
    for (let a = idx - 1; a >= 0; a--) { if (kinds[a] === 'lit') continue; return kinds[a] === 'h' || kinds[a] === 'eh' }
    for (let b = idx + 1; b < kinds.length; b++) { if (kinds[b] === 'lit') continue; return kinds[b] === 's' }
    return false
  }
  const has12 = parts.some(p => p.k === 'ap')
  const fracDigits = (parts.find(p => p.k === 'frac') as { n: number } | undefined)?.n ?? 0
  // 秒的进位：按要显示的小数位四舍五入整段时间
  const unit = 86400 * Math.pow(10, fracDigits)
  const totalUnits = Math.round(serial * unit)
  const dayN = Math.floor(totalUnits / unit)
  const inDay = totalUnits - dayN * unit
  const secsAll = Math.floor(inDay / Math.pow(10, fracDigits))
  const fracPart = inDay - secsAll * Math.pow(10, fracDigits)
  const ymd = serialToYmd(dayN)
  if (!ymd) return fail('#VALUE!')
  const h24 = Math.floor(secsAll / 3600), mi = Math.floor((secsAll % 3600) / 60), se = secsAll % 60
  const wd = ((dayN + 6) % 7)   // 0＝星期日（Excel 序号 1 当星期日）
  const pad = (x: number, w: number) => String(x).padStart(w, '0')
  let out = ''
  parts.forEach((p, idx) => {
    switch (p.k) {
      case 'lit': out += p.s; return
      case 'y': out += p.n <= 2 ? pad(ymd.y % 100, 2) : pad(ymd.y, 4); return
      case 'm':
        if (p.n <= 2 && isMinute(idx)) { out += pad(mi, p.n); return }
        out += p.n === 1 ? String(ymd.m) : p.n === 2 ? pad(ymd.m, 2) : p.n === 3 ? MONTHS[ymd.m - 1].slice(0, 3) : p.n === 5 ? MONTHS[ymd.m - 1][0] : MONTHS[ymd.m - 1]
        return
      case 'd': out += p.n === 1 ? String(ymd.d) : p.n === 2 ? pad(ymd.d, 2) : p.n === 3 ? DAYS[wd].slice(0, 3) : DAYS[wd]; return
      case 'a': out += p.n >= 4 ? '星期' + ZH_DAYS[wd] : p.n === 3 ? ZH_DAYS[wd] : 'a'.repeat(p.n); return
      case 'h': { const h = has12 ? ((h24 + 11) % 12) + 1 : h24; out += pad(h, Math.min(p.n, 2)); return }
      case 's': out += pad(se, Math.min(p.n, 2)); return
      case 'frac': out += '.' + pad(fracPart, p.n); return
      case 'eh': out += pad(dayN * 24 + h24, p.n); return
      case 'em': out += pad((dayN * 24 + h24) * 60 + mi, p.n); return
      case 'es': out += pad(((dayN * 24 + h24) * 60 + mi) * 60 + se, p.n); return
      case 'ap': {
        const pm = h24 >= 12
        if (p.n === 5) out += pm ? 'PM' : 'AM'
        else { const lower = p.s === 'a'; out += pm ? (lower ? 'p' : 'P') : (lower ? 'a' : 'A') }
        return
      }
    }
  })
  return out
}
function groupThousands(int: string): string { return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function formatNumberCode(v: number, toks: FTok[], minus: boolean): string {
  // 码段里认 0 # ? . , % E+ E-；别的码字（含 @）当字面
  type NT = { k: 'lit'; s: string } | { k: 'd'; c: '0' | '#' | '?' } | { k: 'dot' } | { k: 'comma' } | { k: 'pct' } | { k: 'exp'; sign: '+' | '-' }
  const nt: NT[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.k === 'lit') { nt.push({ k: 'lit', s: t.s }); continue }
    const c = t.s
    if (c === '0' || c === '#' || c === '?') nt.push({ k: 'd', c })
    else if (c === '.') nt.push({ k: 'dot' })
    else if (c === ',') nt.push({ k: 'comma' })
    else if (c === '%') nt.push({ k: 'pct' })
    else if ((c === 'E' || c === 'e') && toks[i + 1]?.k === 'code' && (toks[i + 1].s === '+' || toks[i + 1].s === '-')) { nt.push({ k: 'exp', sign: toks[i + 1].s as '+' | '-' }); i++ }
    else nt.push({ k: 'lit', s: c })
  }
  const firstDigit = nt.findIndex(t => t.k === 'd')
  const firstDot = nt.findIndex(t => t.k === 'dot')
  const firstD = firstDigit >= 0 && firstDot >= 0 && firstDot < firstDigit ? firstDot : firstDigit   // ".00" 这种没有整数位的
  if (firstDigit < 0) {   // 没有数字位：只有字面（如 TEXT(5,"件")）·% 照乘
    return (minus ? '-' : '') + nt.map(t => (t.k === 'lit' ? t.s : t.k === 'pct' ? '%' : t.k === 'dot' ? '.' : t.k === 'comma' ? ',' : '')).join('')
  }
  let lastD = -1
  nt.forEach((t, i) => { if (t.k === 'd') lastD = i })
  const pctCount = nt.filter(t => t.k === 'pct').length
  let x = v * Math.pow(100, pctCount)
  const expIdx = nt.findIndex(t => t.k === 'exp')
  const coreEnd = expIdx >= 0 ? expIdx : lastD
  const dotIdx = nt.findIndex((t, i) => t.k === 'dot' && i >= firstD && i <= coreEnd)
  const intToks = nt.slice(firstD, dotIdx >= 0 ? dotIdx : coreEnd + 1)
  const fracToks = dotIdx >= 0 ? nt.slice(dotIdx + 1, coreEnd + 1) : []
  const intD = intToks.filter(t => t.k === 'd') as Array<{ k: 'd'; c: '0' | '#' | '?' }>
  const fracD = fracToks.filter(t => t.k === 'd') as Array<{ k: 'd'; c: '0' | '#' | '?' }>
  // 整数段尾巴的逗号＝每个除以 1000；夹在数字位中间的逗号＝千分位
  let trailingCommas = 0
  for (let i = intToks.length - 1; i >= 0 && intToks[i].k === 'comma'; i--) trailingCommas++
  if (dotIdx < 0) { for (let i = coreEnd + 1; i < nt.length && nt[i].k === 'comma'; i++) trailingCommas++ }
  const grouping = intToks.slice(0, intToks.length - trailingCommas).some(t => t.k === 'comma')
  x = x / Math.pow(1000, trailingCommas)
  let expStr = ''
  if (expIdx >= 0) {
    const expDigits = nt.slice(expIdx + 1).filter(t => t.k === 'd').length || 1
    const intCount = Math.max(1, intD.length)
    let e = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x))) - (intCount - 1)
    let mant = x === 0 ? 0 : x / Math.pow(10, e)
    mant = roundTo(mant, fracD.length, 'half')
    if (Math.abs(mant) >= Math.pow(10, intCount)) { mant /= 10; e += 1 }
    x = mant
    const sign = e < 0 ? '-' : nt[expIdx].k === 'exp' && (nt[expIdx] as { sign: string }).sign === '+' ? '+' : ''
    expStr = 'E' + sign + String(Math.abs(e)).padStart(expDigits, '0')
  }
  const r = roundTo(Math.abs(x), fracD.length, 'half')
  const fixed = r.toFixed(fracD.length)
  let [intDigits, fracDigits = ''] = fixed.split('.')
  if (intDigits === '0') intDigits = ''
  // 小数位：# 去尾 0·? 补空白
  let fracOut = ''
  {
    const chars = fracDigits.split('')
    let keep = chars.length
    for (let i = chars.length - 1; i >= 0; i--) { if (chars[i] === '0' && fracD[i].c !== '0') keep = i; else break }
    for (let i = 0; i < chars.length; i++) fracOut += i < keep ? chars[i] : fracD[i].c === '?' ? ' ' : ''
  }
  // 整数位：右往左填·多出的数字塞进最左一位
  const minInt = intD.filter(t => t.c !== '#').length
  let intStr = intDigits
  if (grouping) {
    const zeros = Math.max(0, intD.filter(t => t.c === '0').length - intStr.length)
    intStr = groupThousands('0'.repeat(zeros) + intStr)
  }
  let body = ''
  if (grouping) {
    body = intStr || (minInt ? '0' : '')
    const prefix = intToks.filter(t => t.k === 'lit').map(t => (t as { s: string }).s).join('')
    body = prefix + body
  } else {
    const digits = intStr.split('')
    const out: string[] = []
    for (let i = intToks.length - 1; i >= 0; i--) {
      const t = intToks[i]
      if (t.k === 'lit') { out.unshift(t.s); continue }
      if (t.k !== 'd') continue
      const isFirst = intToks.findIndex(q => q.k === 'd') === i
      if (isFirst) { out.unshift(digits.length ? digits.join('') : t.c === '0' ? '0' : t.c === '?' ? ' ' : ''); digits.length = 0; continue }
      const dg = digits.pop()
      out.unshift(dg !== undefined ? dg : t.c === '0' ? '0' : t.c === '?' ? ' ' : '')
    }
    body = out.join('')
  }
  const showDot = dotIdx >= 0
  const fracLits = fracToks.filter(t => t.k === 'lit').map(t => (t as { s: string }).s).join('')
  const core = body + (showDot ? '.' + fracOut : '') + fracLits + expStr
  const before = nt.slice(0, firstD).map(t => (t.k === 'lit' ? t.s : t.k === 'pct' ? '%' : '')).join('')
  const after = nt.slice((expIdx >= 0 ? nt.length : coreEnd + 1)).map(t => (t.k === 'lit' ? t.s : t.k === 'pct' ? '%' : '')).join('')
  const isZero = r === 0
  return (minus && !isZero ? '-' : '') + before + core + after
}
