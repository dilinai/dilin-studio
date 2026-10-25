// 表格单元格格式
//   纯函数·页面／服务端净化闸／单测三方同一份：
//   - CellStyle：cells[A1].s = { font,size,b,i,u,s,bg,fg,align,valign,wrap,indent,border,numFmt }（全部可省·省＝预设）
//   - numFmt 只管显示（求值引擎不看它）：常规／数值／货币／会计专用／短日期／长日期／时间／百分比／分数／科学记数／文本·小数位 d·千分位 k
//     货币／会计专用带符号 c（$ € ¥ NT$·新格预设按站别：台版 NT$·陆版 ¥·
//     没存 c 的旧格照旧显 $）；长日期按界面语言（中文「2026年9月24日」·英文「Sep 24, 2026」）；第 12 种「民國紀年」rocdate（115年9月24日）
//   - merges：['A1:B2', …]（左上:右下·矩形）；公式引用合并区里被盖住的格 ⇒ 取左上（formula.ts 那边照 coveredMap 转）
//   - images：[{ id, url, cell, w, h, ox, oy }]（浮在某格左上·ox/oy＝相对该格左上的像素偏移）
//   - 净化：sanitizeStyle／sanitizeMerges／sanitizeImages 只收白名单键与合法值·坏值丢（不整份拒）

import { cellKey, parseRef } from './formula'
import { FONT_IDS, isFontId } from '../../shared/fonts/catalog'
import { sanitizeBorder, type CellBorder } from './border'
import { parseYmdInput } from './formula-lib'

export type HAlign = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'middle' | 'bottom'
/** 12 种（顺序＝WPS 下拉顺序·民國紀年接在长日期后）：date＝短日期·longdate＝长日期·rocdate＝民國紀年长日期（台版下拉才显） */
export type NumFmtKind = 'general' | 'number' | 'currency' | 'accounting' | 'date' | 'longdate' | 'rocdate' | 'time' | 'percent' | 'fraction' | 'scientific' | 'text'
export const NUMFMT_KINDS: readonly NumFmtKind[] = ['general', 'number', 'currency', 'accounting', 'date', 'longdate', 'rocdate', 'time', 'percent', 'fraction', 'scientific', 'text']
/** 日期类（填充柄按天推·显示走日期）；rocdate 同属 */
export const NUMFMT_DATE_KINDS: readonly NumFmtKind[] = ['date', 'longdate', 'rocdate']
/** 带小数位 d 的种类（dec＋／dec－ 对它们起作用·其余先转 number） */
export const NUMFMT_DECIMAL_KINDS: readonly NumFmtKind[] = ['number', 'currency', 'accounting', 'percent', 'scientific']
/** 带千分位 k 的种类 */
export const NUMFMT_THOUSANDS_KINDS: readonly NumFmtKind[] = ['number', 'currency', 'accounting', 'percent']
/** 没存符号的旧格（之前存的货币／会计专用）显示的符号＝$（旧档照原样显示不变） */
export const CURRENCY_SYMBOL = '$'
/** 可选货币符号 */
export type CurrencySymbol = '$' | '€' | '¥' | 'NT$'
export const CURRENCY_SYMBOLS: readonly CurrencySymbol[] = ['$', '€', '¥', 'NT$']
export const isCurrencySymbol = (v: unknown): v is CurrencySymbol => typeof v === 'string' && (CURRENCY_SYMBOLS as readonly string[]).includes(v)
/** 部署区域：服务端读 DEPLOYMENT_REGION、前端读 NEXT_PUBLIC_DEPLOYMENT_REGION（两个都认·都没设＝tw） */
export function envRegion(): 'tw' | 'cn' {
  return process.env.DEPLOYMENT_REGION === 'cn' || process.env.NEXT_PUBLIC_DEPLOYMENT_REGION === 'cn' ? 'cn' : 'tw'
}
/** 新格的货币符号预设按站别：tw ＝ NT$·cn ＝ ¥；region 不给 ⇒ 读部署区域 */
export function regionCurrencySymbol(region?: 'tw' | 'cn'): CurrencySymbol {
  return (region ?? envRegion()) === 'cn' ? '¥' : 'NT$'
}
/** c＝货币符号（只货币／会计专用带·省 ⇒ 旧格 $） */
export type NumFmt = { t: NumFmtKind; d?: number; k?: boolean; c?: CurrencySymbol }
/** 显示语言（长日期跟界面语言切） */
export type NumFmtLang = 'zh' | 'en'
/** 边框：按边存 { t,r,b,l: { style, color } }·模型与套用在 ./border.ts；旧格式 'tblr' 字串读入即迁 */
export type CellStyle = {
  font?: string; size?: number
  b?: boolean; i?: boolean; u?: boolean; s?: boolean
  bg?: string; fg?: string
  align?: HAlign; valign?: VAlign; wrap?: boolean; indent?: number
  border?: CellBorder
  numFmt?: NumFmt
}
/**
 * 浮图：
 *   plane：'above'＝格子之上（缺省·省＝above·旧资料照旧）／'below'＝格子之下（格子透明处透出来·点格子仍是选格）
 *   inCell：放进格子里的图（随该格／合并区大小·ox／oy 不用·plane 不看）
 *   层次＝images 数组顺序（0 最底·同简报）；上移下移只在同一平面里换位（见 ./image-layers.ts）
 */
export type SheetImagePlane = 'above' | 'below'
export type SheetImage = { id: string; url: string; cell: string; w: number; h: number; ox?: number; oy?: number; plane?: SheetImagePlane; inCell?: true }
export type Rect = { r0: number; c0: number; r1: number; c1: number }

/** 格式刷复制的键集（＝CellStyle 全部键） */
export const STYLE_KEYS: readonly (keyof CellStyle)[] = ['font', 'size', 'b', 'i', 'u', 's', 'bg', 'fg', 'align', 'valign', 'wrap', 'indent', 'border', 'numFmt']

/** 字体：s.font 存 lib/fonts/catalog 的 id（清单 12 款全 OFL·显示时 id ⇒ CSS 栈·省＝页面预设 var(--cjk-font)） */
export const FONT_VALUES: readonly string[] = FONT_IDS
/** 字号清单 8–36 */
export const SIZE_OPTIONS: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36]
export const DEFAULT_SIZE = 11
export const SIZE_MIN = 8
export const SIZE_MAX = 36
export const INDENT_MAX = 10
export const DECIMALS_MAX = 10

/** A＋／A－：沿字号清单走一格（现值不在清单上 ⇒ 取最近的下一格） */
export function stepSize(cur: number | undefined, delta: 1 | -1): number {
  const c = cur ?? DEFAULT_SIZE
  if (delta > 0) { const n = SIZE_OPTIONS.find(x => x > c); return n ?? SIZE_MAX }
  const smaller = SIZE_OPTIONS.filter(x => x < c); return smaller.length ? smaller[smaller.length - 1] : SIZE_MIN
}

// ── 颜色：只收 #hex（3/4/6/8 位）或小写命名色（同 MarkdownView SAFE_COLOR_RE 口径） ──
const SAFE_COLOR_RE = /^([a-z][a-z0-9]{1,32}|#[0-9a-f]{3,8})$/i
export function isSafeColor(v: unknown): v is string { return typeof v === 'string' && SAFE_COLOR_RE.test(v) && v.length <= 40 }

const H_ALIGNS: readonly HAlign[] = ['left', 'center', 'right']
const V_ALIGNS: readonly VAlign[] = ['top', 'middle', 'bottom']
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

/** 净化一格的 s：白名单键·坏值丢·空 ⇒ undefined */
export function sanitizeStyle(input: unknown): CellStyle | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const x = input as Record<string, unknown>
  const out: CellStyle = {}
  if (isFontId(x.font)) out.font = x.font
  if (isInt(x.size, SIZE_MIN, SIZE_MAX)) out.size = x.size
  for (const k of ['b', 'i', 'u', 's', 'wrap'] as const) if (x[k] === true) out[k] = true
  if (isSafeColor(x.bg)) out.bg = x.bg
  if (isSafeColor(x.fg)) out.fg = x.fg
  if (typeof x.align === 'string' && (H_ALIGNS as readonly string[]).includes(x.align)) out.align = x.align as HAlign
  if (typeof x.valign === 'string' && (V_ALIGNS as readonly string[]).includes(x.valign)) out.valign = x.valign as VAlign
  if (isInt(x.indent, 1, INDENT_MAX)) out.indent = x.indent
  const bd = sanitizeBorder(x.border)   // 新形 {t,r,b,l:{style,color}}·旧形 'tblr' 字串照收并迁成细实线（写旧格兼容）
  if (bd) out.border = bd
  if (x.numFmt && typeof x.numFmt === 'object' && !Array.isArray(x.numFmt)) {
    const nf = x.numFmt as Record<string, unknown>
    if (typeof nf.t === 'string' && (NUMFMT_KINDS as readonly string[]).includes(nf.t) && nf.t !== 'general') {
      const o: NumFmt = { t: nf.t as NumFmtKind }
      if (isInt(nf.d, 0, DECIMALS_MAX)) o.d = nf.d
      if (nf.k === true) o.k = true
      if ((o.t === 'currency' || o.t === 'accounting') && isCurrencySymbol(nf.c)) o.c = nf.c
      out.numFmt = o
    }
  }
  return Object.keys(out).length ? out : undefined
}

const RANGE_RE = /^([A-Z]{1,3}\d{1,6}):([A-Z]{1,3}\d{1,6})$/
export const MERGES_MAX = 2000
export const IMAGES_MAX = 100
export const IMAGE_SIDE_MIN = 16
export const IMAGE_SIDE_MAX = 4000

/** 净化 merges：只收 'A1:B2' 形（左上:右下·至少 2 格）·归一化·去重·互相重叠的后者丢 */
export function sanitizeMerges(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const rects: Rect[] = []
  for (const m of input.slice(0, MERGES_MAX)) {
    if (typeof m !== 'string') continue
    const rect = parseRange(m)
    if (!rect || (rect.r0 === rect.r1 && rect.c0 === rect.c1)) continue
    if (rects.some(r => rectsOverlap(r, rect))) continue
    rects.push(rect); out.push(rangeKey(rect))
  }
  return out
}

/** 本机工程里的素材相对路径（assets/<档名>·档名不含斜线、不是 . 或 ..） */
export const ASSET_URL_RE = /^assets\/(?!\.\.?$)[^/\\]{1,200}$/
export type SanitizeImageOpts = { /** 也收 assets/<档名>（游客版本机工程）；缺省只收 http(s) */ assetUrls?: boolean }
/** 净化 images：id／url（http(s)；assetUrls ⇒ 另收 assets/<档名>）／cell／w／h（16–4000）／ox／oy（0–4000）／plane（'below' 才存）／inCell（true 才存） */
export function sanitizeImages(input: unknown, opts: SanitizeImageOpts = {}): SheetImage[] {
  if (!Array.isArray(input)) return []
  const out: SheetImage[] = []
  const seen = new Set<string>()
  for (const it of input.slice(0, IMAGES_MAX)) {
    if (!it || typeof it !== 'object') continue
    const x = it as Record<string, unknown>
    if (typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(x.id) || seen.has(x.id)) continue
    if (typeof x.url !== 'string' || !(/^https?:\/\/\S{1,2000}$/.test(x.url) || (opts.assetUrls && ASSET_URL_RE.test(x.url)))) continue
    if (typeof x.cell !== 'string' || !parseRef(x.cell) || !/^[A-Z]{1,3}\d{1,6}$/.test(x.cell)) continue
    if (!isNum(x.w, IMAGE_SIDE_MIN, IMAGE_SIDE_MAX) || !isNum(x.h, IMAGE_SIDE_MIN, IMAGE_SIDE_MAX)) continue
    const img: SheetImage = { id: x.id, url: x.url, cell: x.cell, w: Math.round(x.w), h: Math.round(x.h) }
    if (isNum(x.ox, 0, IMAGE_SIDE_MAX)) img.ox = Math.round(x.ox)
    if (isNum(x.oy, 0, IMAGE_SIDE_MAX)) img.oy = Math.round(x.oy)
    // inCell 优先（格内图不分上下）；plane 只存 'below'（above＝缺省·省掉 ⇒ 旧资料往返一字不变）；认不得的值丢＝above
    if (x.inCell === true) img.inCell = true
    else if (x.plane === 'below') img.plane = 'below'
    seen.add(img.id); out.push(img)   // 顺序＝层次（0 最底）·照收不重排
  }
  return out
}
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

// ── 区间／矩形 ──
export function parseRange(s: string): Rect | null {
  const m = RANGE_RE.exec(s.trim().toUpperCase())
  if (!m) return null
  const a = parseRef(m[1]), b = parseRef(m[2])
  if (!a || !b) return null
  return { r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row), c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col) }
}
export function rangeKey(r: Rect): string { return `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}` }
export function rectsOverlap(a: Rect, b: Rect): boolean { return a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1 }
export function rectContains(a: Rect, r: number, c: number): boolean { return r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1 }
export function rectEquals(a: Rect, b: Rect): boolean { return a.r0 === b.r0 && a.r1 === b.r1 && a.c0 === b.c0 && a.c1 === b.c1 }
export function* rectKeys(r: Rect): Generator<[string, number, number]> {
  for (let rr = r.r0; rr <= r.r1; rr++) for (let cc = r.c0; cc <= r.c1; cc++) yield [cellKey(rr, cc), rr, cc]
}

/** 合并区判定：selection 是不是恰好一个既有合并区（⇒ 取消合并）；否则可合并（矩形选区天然满足·至少 2 格） */
export function mergeStateFor(merges: string[], sel: Rect): 'merged' | 'mergeable' | 'single' {
  if (merges.some(m => { const r = parseRange(m); return !!r && rectEquals(r, sel) })) return 'merged'
  if (sel.r0 === sel.r1 && sel.c0 === sel.c1) return 'single'
  return 'mergeable'
}
/** 加一个合并区：与它重叠的旧合并区全撤（Excel 口径＝并成一块） */
export function addMerge(merges: string[], sel: Rect): string[] {
  const keep = merges.filter(m => { const r = parseRange(m); return !r || !rectsOverlap(r, sel) })
  return [...keep, rangeKey(sel)]
}
/** 撤掉与选区有交集的合并区 */
export function removeMerges(merges: string[], sel: Rect): string[] {
  return merges.filter(m => { const r = parseRange(m); return !r || !rectsOverlap(r, sel) })
}
/** 被盖住的格 ⇒ 左上格键（左上本身不在表里） */
export function coveredMap(merges: string[] | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of merges ?? []) {
    const r = parseRange(m); if (!r) continue
    const tl = cellKey(r.r0, r.c0)
    for (const [k] of rectKeys(r)) if (k !== tl) out.set(k, tl)
  }
  return out
}
/** 选区扩到把所有沾到的合并区整块包进来（拖选时用） */
export function expandRectToMerges(sel: Rect, merges: string[]): Rect {
  let cur = { ...sel }
  for (let guard = 0; guard < 50; guard++) {
    let changed = false
    for (const m of merges) {
      const r = parseRange(m); if (!r || !rectsOverlap(r, cur)) continue
      const n = { r0: Math.min(cur.r0, r.r0), r1: Math.max(cur.r1, r.r1), c0: Math.min(cur.c0, r.c0), c1: Math.max(cur.c1, r.c1) }
      if (!rectEquals(n, cur)) { cur = n; changed = true }
    }
    if (!changed) break
  }
  return cur
}

// ── 边框：搬到 ./border.ts（按边存线型与颜色·套法 12 种·邻格共边以后写者为准） ──

// ── 数字格式（只管显示·11 种） ──
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30)   // Excel 序列日 0＝1899-12-30
const SERIAL_MAX = 2958465                        // 9999-12-31
function groupThousands(intPart: string): string { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function fixed(n: number, d: number, k: boolean): string {
  const neg = n < 0
  const s = Math.abs(n).toFixed(d)
  const [ip, fp] = s.split('.')
  const body = (k ? groupThousands(ip) : ip) + (fp !== undefined ? '.' + fp : '')
  return (neg ? '-' : '') + body
}
/** 现有数值显示几位小数（常规格式下）·A＋小数位时从它起算 */
export function decimalsOf(n: number): number {
  const s = String(Number(n.toPrecision(12)))
  const i = s.indexOf('.')
  return i < 0 || /e/i.test(s) ? 0 : s.length - i - 1
}
function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }
type Ymd = { y: number; m: number; d: number }
/** 序列日（整数部分）⇒ 年月日；超范围 ⇒ null */
function serialToYmd(n: number): Ymd | null {
  if (!Number.isFinite(n) || n < 0 || n > SERIAL_MAX) return null
  const d = new Date(SERIAL_EPOCH_MS + Math.floor(n) * 86400000)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}
/** 序列日小数部分 ⇒ 时分（四舍五入到分·24:00 进位归 0:00） */
function serialToHm(n: number): { h: number; mi: number } | null {
  if (!Number.isFinite(n) || n < 0) return null
  const frac = n - Math.floor(n)
  let mins = Math.round(frac * 1440)
  if (mins >= 1440) mins -= 1440
  return { h: Math.floor(mins / 60), mi: mins % 60 }
}
const shortDate = (x: Ymd) => `${x.y}/${x.m}/${x.d}`
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 长日期：中文 2026年9月24日·英文 Sep 24, 2026（Excel en-US「mmm d, yyyy」） */
const longDate = (x: Ymd, lang: NumFmtLang = 'zh') => (lang === 'en' ? `${EN_MONTHS[x.m - 1]} ${x.d}, ${x.y}` : `${x.y}年${x.m}月${x.d}日`)
/** 民國紀年：西元年−1911（1912＝民國元年·寫作 1年）；1911 年以前 ⇒ 民國前 N 年（Excel [$-zh-TW]e 的写法不含「民國」两字） */
const rocDate = (x: Ymd) => (x.y >= 1912 ? `${x.y - 1911}年${x.m}月${x.d}日` : `民國前${1912 - x.y}年${x.m}月${x.d}日`)
const hm = (t: { h: number; mi: number }) => `${pad2(t.h)}:${pad2(t.mi)}`

/** 'YYYY-MM-DD' / 'YYYY/MM/DD' / 'YYYY.MM.DD'（后面可带 T 或空格接时分）⇒ 年月日；不是日期 ⇒ null */
export function parseYmd(s: string): Ymd | null {
  const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?\s*$/.exec(s)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3])
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  const d = new Date(Date.UTC(y, mo - 1, da))
  if (d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null
  return { y, m: mo, d: da }
}
/** 'YYYY-MM-DD' / 'YYYY/MM/DD' 字串 ⇒ 'YYYY-MM-DD'（不是日期 ⇒ null） */
export function parseDateString(s: string): string | null {
  const x = parseYmd(s)
  return x ? `${x.y}-${pad2(x.m)}-${pad2(x.d)}` : null
}
/** 'H:mm' / 'HH:mm:ss' / 'YYYY-MM-DD HH:mm' 字串 ⇒ 时分；不是时间 ⇒ null */
export function parseTimeString(s: string): { h: number; mi: number } | null {
  const m = /^\s*(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[T ])?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(s)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2]), se = m[3] === undefined ? 0 : Number(m[3])
  if (h > 23 || mi > 59 || se > 59) return null
  return { h, mi }
}

/** 分数：就近分母 ≤ maxDigits 位（Excel「分母为两位数」口径）⇒ 「整数 分子/分母」·分子归零 ⇒ 只剩整数 */
export function toFraction(n: number, maxDigits = 2): string {
  if (!Number.isFinite(n)) return String(n)
  const neg = n < 0
  const a = Math.abs(n)
  let ip = Math.floor(a)
  const fp = a - ip
  const maxDen = Math.pow(10, Math.max(1, Math.min(3, maxDigits))) - 1
  let bestNum = 0, bestDen = 1, bestErr = fp
  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(fp * den)
    const err = Math.abs(fp - num / den)
    if (err < bestErr - 1e-12) { bestErr = err; bestNum = num; bestDen = den; if (err < 1e-12) break }
  }
  if (bestNum === bestDen) { ip += 1; bestNum = 0 }
  const body = bestNum === 0 ? String(ip) : (ip ? `${ip} ` : '') + `${bestNum}/${bestDen}`
  return (neg && body !== '0' ? '-' : '') + body
}
/** 科学记数：1.23E+04（指数至少两位·Excel 口径） */
export function toScientific(n: number, d: number): string {
  if (!Number.isFinite(n)) return String(n)
  const [mant, exp] = n.toExponential(d).split('e')
  const sign = exp[0] === '-' ? '-' : '+'
  const digits = exp.replace(/^[-+]/, '')
  return `${mant}E${sign}${digits.length < 2 ? '0' + digits : digits}`
}
/** 会计专用两段：符号靠左·数字靠右（负数括号·零显「-」）·网格用 flex 把两段推到两边；sym 省 ⇒ 旧格 $ */
export function accountingParts(n: number, d: number, k: boolean, sym: string = CURRENCY_SYMBOL): { sym: string; body: string } {
  const body = n === 0 ? '-' : (n < 0 ? `(${fixed(-n, d, k)})` : fixed(n, d, k))
  return { sym, body }
}

/**
 * 按 numFmt 出显示字串。value＝求值结果（number／string／null）·raw＝用户原始输入（text 格式照原文显示）。
 * 常规＝formatValue 口径（调用方自己给·这里只处理非常规）；返回 null ＝ 交回常规显示
 * 日期／时间：格内存数字（Excel 序列日·小数＝当天几分之几）或字串（ISO 形）都能显示；别的值交回常规
 */
export function formatWithNumFmt(fmt: NumFmt | undefined, value: number | string | null, raw: string | undefined, opts?: { lang?: NumFmtLang }): string | null {
  if (!fmt || fmt.t === 'general') return null
  const lang = opts?.lang ?? 'zh'
  if (fmt.t === 'text') return raw ?? (value === null ? '' : String(value))
  if (typeof value !== 'number') {
    if (typeof value !== 'string') return null
    if (fmt.t === 'date') { const x = parseYmd(value); return x ? shortDate(x) : null }
    if (fmt.t === 'longdate') { const x = parseYmd(value); return x ? longDate(x, lang) : null }
    if (fmt.t === 'rocdate') { const x = parseYmd(value); return x ? rocDate(x) : null }
    if (fmt.t === 'time') { const x = parseTimeString(value); return x ? hm(x) : null }
    return null
  }
  const d = fmt.d ?? 2
  switch (fmt.t) {
    case 'number': return fixed(value, d, !!fmt.k)
    case 'currency': { const s = fixed(Math.abs(value), d, fmt.k !== false); return (value < 0 ? '-' : '') + (fmt.c ?? CURRENCY_SYMBOL) + s }
    case 'accounting': { const p = accountingParts(value, d, fmt.k !== false, fmt.c ?? CURRENCY_SYMBOL); return `${p.sym} ${p.body}` }
    case 'date': { const x = serialToYmd(value); return x ? shortDate(x) : null }
    case 'longdate': { const x = serialToYmd(value); return x ? longDate(x, lang) : null }
    case 'rocdate': { const x = serialToYmd(value); return x ? rocDate(x) : null }
    case 'time': { const x = serialToHm(value); return x ? hm(x) : null }
    case 'percent': return fixed(value * 100, d, !!fmt.k) + '%'
    case 'fraction': return toFraction(value, 2)
    case 'scientific': return toScientific(value, d)
  }
  return null
}

/** 下拉选一种 ⇒ 新 numFmt（常规 ⇒ undefined；带小数位的种类预设 2 位；货币／会计预设千分位＋符号：currency 给了用它·没给按站别预设） */
export function numFmtForKind(kind: NumFmtKind, currency?: CurrencySymbol): NumFmt | undefined {
  if (kind === 'general') return undefined
  const o: NumFmt = { t: kind }
  if (NUMFMT_DECIMAL_KINDS.includes(kind)) o.d = 2
  if (kind === 'currency' || kind === 'accounting') { o.k = true; o.c = currency ?? regionCurrencySymbol() }
  return o
}
/** 下拉「貨幣符號」：现格是货币／会计专用 ⇒ 只换符号（种类／小数位／千分位照留）；别的格式 ⇒ 转成货币＋该符号 */
export function withCurrencySymbol(cur: NumFmt | undefined, sym: CurrencySymbol): NumFmt {
  if (cur && (cur.t === 'currency' || cur.t === 'accounting')) return { ...cur, c: sym }
  return numFmtForKind('currency', sym)!
}
/** 用户敲进常规格的原文长得像日期 ⇒ 自动标短日期（原值照存·只管显示）；别的 ⇒ undefined */
export function autoNumFmtForInput(raw: string): NumFmt | undefined {
  if (raw.trim().startsWith('=')) return undefined
  return parseYmd(raw) && !parseTimeString(raw) ? { t: 'date' } : undefined
}
/**
 * 用户输入的原文 ⇒ 要存的 v ＋ 要补的 numFmt。
 *   cur＝格子现有的数字格式。
 *   - 文字格式（@）的格：原文照存（Excel 同：文字格里打日期还是文字）
 *   - 带四位年的 yyyy/m/d、yyyy-m-d（parseYmdInput）⇒ 存真日期：v＝日期序号（Excel 1900 系统）·常规格补短日期格式；
 *     已有别的格式（长日期／民國紀年／数值…）照留（Excel 同：只有常规格才自动换格式）
 *   - 其余照旧：原文照存；常规格里长得像日期的（如 2026.10.16）照旧只标短日期显示（autoNumFmtForInput）
 *   「10/16」「1-2」这种不带年的不认·公式（= 开头）不经这里
 */
export function valueForInput(raw: string, cur?: NumFmt): { v: string; numFmt?: NumFmt } {
  if (cur?.t === 'text' || raw.trim().startsWith('=')) return { v: raw }
  const plain = !cur || cur.t === 'general'
  const serial = parseYmdInput(raw)
  if (serial !== null) return plain ? { v: String(serial), numFmt: { t: 'date' } } : { v: String(serial) }
  const auto = plain ? autoNumFmtForInput(raw) : undefined
  return auto ? { v: raw, numFmt: auto } : { v: raw }
}

/** 工具栏「货币／%／千分位／小数增减」对现 numFmt 的变换（value 给「常规 ⇒ 数字」时起算小数位用） */
export function applyNumFmtAction(cur: NumFmt | undefined, action: 'currency' | 'percent' | 'thousands' | 'dec+' | 'dec-', value: number | null, currency?: CurrencySymbol): NumFmt | undefined {
  const base: NumFmt = cur ? { ...cur } : { t: 'general' }
  const toNumeric = (keep: readonly NumFmtKind[]): NumFmt => keep.includes(base.t)
    ? base
    : { t: 'number', d: value === null ? 2 : decimalsOf(value) }
  switch (action) {
    case 'currency': return base.t === 'currency' ? undefined : { t: 'currency', d: base.d ?? 2, k: true, c: currency ?? regionCurrencySymbol() }
    case 'percent': return base.t === 'percent' ? undefined : { t: 'percent', d: base.d ?? 2 }
    case 'thousands': { const n = toNumeric(NUMFMT_THOUSANDS_KINDS); return { ...n, k: !n.k } }
    case 'dec+': { const n = toNumeric(NUMFMT_DECIMAL_KINDS); return { ...n, d: Math.min(DECIMALS_MAX, (n.d ?? 2) + 1) } }
    case 'dec-': { const n = toNumeric(NUMFMT_DECIMAL_KINDS); return { ...n, d: Math.max(0, (n.d ?? 2) - 1) } }
  }
}

// ── 剪贴板：选区 ⇄ TSV ──
export type ClipCell = { v?: string; f?: string; s?: CellStyle }
export type ClipBlock = { rows: number; cols: number; cells: Record<string, ClipCell>; text: string }

/** 选区 ⇒ TSV（每格取显示字串·display 由调用方给）＋内部块（含公式与格式·键＝相对 r,c "r,c"） */
export function blockFromSelection(cells: Record<string, ClipCell>, sel: Rect, display: (key: string) => string): ClipBlock {
  const out: Record<string, ClipCell> = {}
  const lines: string[] = []
  for (let r = sel.r0; r <= sel.r1; r++) {
    const parts: string[] = []
    for (let c = sel.c0; c <= sel.c1; c++) {
      const key = cellKey(r, c)
      const cd = cells[key]
      if (cd) out[`${r - sel.r0},${c - sel.c0}`] = { ...cd, s: cd.s ? { ...cd.s } : undefined }
      parts.push(display(key).replace(/[\t\n\r]/g, ' '))
    }
    lines.push(parts.join('\t'))
  }
  return { rows: sel.r1 - sel.r0 + 1, cols: sel.c1 - sel.c0 + 1, cells: out, text: lines.join('\n') }
}
/** 外来文字 ⇒ 块：按行拆 \n·按 \t 拆列（单格无 tab 也成一块）；每格值照打字同一条认（valueForInput·带年份日期存真日期） */
export function blockFromText(text: string): ClipBlock {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  const cells: Record<string, ClipCell> = {}
  let cols = 1
  lines.forEach((ln, r) => {
    const parts = ln.split('\t'); cols = Math.max(cols, parts.length)
    parts.forEach((p, c) => {
      if (p === '') return
      if (p.trim().startsWith('=')) { cells[`${r},${c}`] = { v: '', f: p.trim() }; return }
      const got = valueForInput(p)
      cells[`${r},${c}`] = got.numFmt ? { v: got.v, s: { numFmt: got.numFmt } } : { v: got.v }
    })
  })
  return { rows: lines.length, cols, cells, text }
}
/** 把块贴到目标左上角（行列上限内）⇒ 新 cells（块覆盖范围内原格清掉） */
export function pasteBlock(cells: Record<string, ClipCell>, block: ClipBlock, at: { r: number; c: number }, maxRows: number, maxCols: number): { cells: Record<string, ClipCell>; rect: Rect } {
  const next = { ...cells }
  const r1 = Math.min(maxRows - 1, at.r + block.rows - 1), c1 = Math.min(maxCols - 1, at.c + block.cols - 1)
  for (let r = at.r; r <= r1; r++) for (let c = at.c; c <= c1; c++) {
    const key = cellKey(r, c)
    const src = block.cells[`${r - at.r},${c - at.c}`]
    if (src) next[key] = { ...src, s: src.s ? { ...src.s } : undefined }; else delete next[key]
    if (next[key] && next[key].s === undefined) delete next[key].s
  }
  return { cells: next, rect: { r0: at.r, c0: at.c, r1, c1 } }
}
/** 格式刷：把 style 套到选区每格（内容不动）；style 为空 ⇒ 清格式 */
export function applyStyleToRect<T extends { s?: CellStyle }>(cells: Record<string, T>, sel: Rect, patch: (cur: CellStyle | undefined, r: number, c: number) => CellStyle | undefined): Record<string, T> {
  const next = { ...cells }
  for (const [key, r, c] of rectKeys(sel)) {
    const cur = next[key]
    const s = patch(cur?.s, r, c)
    if (s && Object.keys(s).length) next[key] = { ...(cur ?? ({} as T)), s }
    else if (cur) { const { s: _s, ...rest } = cur; if (Object.keys(rest).length) next[key] = rest as T; else delete next[key] }
  }
  return next
}
/** 复制一份可套用的格式（格式刷取样） */
export function copyStyle(s: CellStyle | undefined): CellStyle | undefined {
  if (!s) return undefined
  const out: CellStyle = {}
  for (const k of STYLE_KEYS) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = k === 'numFmt' ? { ...(s.numFmt as NumFmt) } : k === 'border' ? JSON.parse(JSON.stringify(s.border)) : s[k]
  return Object.keys(out).length ? out : undefined
}
