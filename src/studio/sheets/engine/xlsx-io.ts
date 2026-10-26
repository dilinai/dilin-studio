// 表格档 ⇄ .xlsx
//   ⛔ 不碰库、不碰网络：进 Buffer 出 Buffer／进 Buffer 出 sheet 内容。存库前仍过 api/ai-sheet/_shared 的净化闸（同一份）。
//
//   来源与授权：
//     - 读 xlsx 的格值／公式（含共享公式展开）／合并区／列宽行高／数字格式码：SheetJS 社区版 `xlsx` 0.18.5（Apache-2.0·Copyright (C) 2012-present SheetJS LLC）
//       ——本仓 core/package.json 早就依赖它（api/parse-doc 在用）·整包调用·没改它的码。
//     - 打包 zip：同一个包导出的 XLSX.CFB（SheetJS 自己写 xlsx 也用它：xlsx.js write_zip_denouement 的 CFB.write(fileType:'zip')）。
//     - 为什么样式（字体／粗斜／颜色／底色／边框／对齐）这一层自己写：SheetJS 社区版写出时样式表写死一份预设（write_sty_xml）、
//       读入时不把格的样式序号留在格上、parse_borders 只留空物件——样式是它的付费版能力。exceljs（MIT）两头都做但本仓没装，
//       装新依赖要动 package-lock 与两站部署⇒ 样式表（styles.xml）与格的样式序号这一层照 ECMA-376 §18.8 自写。
//     - 主题色 tint 换算照 ECMA-376 §18.8.19 的 HSL 亮度公式（SheetJS rgb_tint 同一条公式·这里现写）；列宽像素换算照 [MS-OI29500] 2.1.595。
//     - 导出带公式缓存值＋打开时重算（fullCalcOnLoad）。
//     - 民國紀年格式码 [$-zh-TW]e"年"m"月"d"日"（Excel 台湾区 e＝民國年）：照 Excel 台湾区常用写法（isvincent.pixnet.net 教学文列的格式码）；
//       货币符号写进格式码的引号里（"NT$"#,##0.00）·读回按码里的符号认 $／€／¥／NT$。

import * as XLSX from 'xlsx'
import { cellKey, colToIndex, indexToCol, parseLiteral, parseRef, SheetEvaluator, SheetBook, sheetKey, isFormulaError, toXlsxFormula, fromXlsxFormula, type CellData, type SheetCells, type Scalar, type EvaluatorOptions } from './formula'
import { rewriteSheetRefs, renameSheetInContent } from './formula-refs'   // 跨表引用：汇出换成档里的表名·汇入名字归一后跟着换
import { normalizeSheetName } from './sheet-list'
import { parseRange, rangeKey, SIZE_MIN, SIZE_MAX, INDENT_MAX, DECIMALS_MAX, CURRENCY_SYMBOL, IMAGE_SIDE_MIN, IMAGE_SIDE_MAX, IMAGES_MAX, NUMFMT_DATE_KINDS, valueForInput, envRegion, type CellStyle, type NumFmt, type CurrencySymbol, type SheetImage } from './style'
import { parseDateTimeText } from './formula-lib'
import { colWidthOf, rowHeightOf, COL_W_DEFAULT, ROW_H_DEFAULT } from './layout'
import { imageLayer } from './image-layers'
import { findFont, findFontByFamily } from '../../shared/fonts/catalog'
import { MAX_ROW_INDEX, MAX_COL_INDEX, type AgentContent } from './agent-ops'
import { sanitizeBorder, type BorderStyle, type CellBorder } from './border'
import { chartDrawingParts, chartContentTypes } from './chart-xlsx'   // 图表（原生 c:chartSpace）
import { condFormatSheetXml, parseDxfs, parseCondFormatting } from './cond-format-xlsx'   // 条件格式
import type { CondStyle } from './cond-format'
import { sheetViewXmlParts, filterDefinedNamesXml, readSheetViewXml, viewImportWarnings } from './sheet-view-xlsx' // 冻结筛选验证
import { filteredRows, type ViewContent } from './sheet-view'   // 手动隐藏的行扣掉筛选藏的
import { printXmlParts, printDefinedNames, mergeDefinedNames, readPrintDefinedNames, readPrintXml } from './print-xlsx' // 列印设定

export type WorkbookSheet = { name: string; content: AgentContent }

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** 导入：来源档上限（压缩后） */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024
/** 导入：zip 解开后的总量上限（防压缩炸弹·在交给 SheetJS 之前先量中央目录） */
export const IMPORT_MAX_UNZIPPED = 150 * 1024 * 1024
export const IMPORT_MAX_ENTRIES = 20_000
export const IMPORT_MAX_SHEETS = 50
export const IMPORT_MAX_CELLS = 500_000

// SheetJS 0.18.5 的型别档把 CFB 标成 any ⇒ 这里写下本档用到的那几支（形状照 node_modules/cfb/types/index.d.ts）
type CfbContainer = { FullPaths: string[]; FileIndex: Array<{ content?: Uint8Array | number[] }> }
const CFB = XLSX.CFB as {
  read(b: Uint8Array, o: { type: 'buffer' | 'array' }): CfbContainer
  write(c: CfbContainer, o: { fileType: 'zip'; type: 'array'; compression: boolean }): unknown
  utils: { cfb_new(): CfbContainer; cfb_add(c: CfbContainer, name: string, content: Uint8Array): unknown }
}
// 导出这一路浏览器也跑（表格页顶栏「xlsx」钮）⇒ 只用 TextEncoder／Uint8Array·⛔ Buffer（浏览器没有）
const UTF8 = new TextEncoder()

export class XlsxError extends Error {
  code: string
  constructor(message: string, code = 'err_xlsx_bad_file') { super(message); this.code = code }
}

// ── 小工具 ────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g
const esc = (s: string) => s.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const re = /([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].replace(/^\w+:/, '')] = m[2] ?? m[3] ?? ''
  return out
}
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** 我们存的颜色（#rgb／#rgba／#rrggbb／#rrggbbaa／小写色名）⇒ Excel ARGB；认不得 ⇒ null */
const NAMED: Record<string, string> = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080', gray: '808080', grey: '808080', pink: 'ffc0cb', brown: 'a52a2a', cyan: '00ffff', magenta: 'ff00ff', lime: '00ff00', navy: '000080', teal: '008080', silver: 'c0c0c0', maroon: '800000', olive: '808000' }
export function toArgb(color: string | undefined): string | null {
  if (!color) return null
  const c = color.trim().toLowerCase()
  if (NAMED[c]) return ('ff' + NAMED[c]).toUpperCase()
  const m = /^#([0-9a-f]{3,8})$/.exec(c)
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('')
  if (h.length === 6) return ('ff' + h).toUpperCase()
  if (h.length === 8) return (h.slice(6, 8) + h.slice(0, 6)).toUpperCase()   // CSS #rrggbbaa ⇒ AARRGGBB
  return null
}

// 主题色 tint（ECMA-376 §18.8.19：HSL 亮度·tint<0 变暗·>0 变亮）
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToHex([h, s, l]: [number, number, number]): string {
  const f = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  let r: number, g: number, b: number
  if (s === 0) r = g = b = l
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3) }
  return [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}
function tint(hex: string, t: number): string {
  if (!t) return hex
  const [h, s, l] = hexToHsl(hex)
  return hslToHex([h, s, t < 0 ? l * (1 + t) : 1 - (1 - l) * (1 - t)])
}
const INDEXED: Record<number, string> = { 0: '000000', 1: 'ffffff', 2: 'ff0000', 3: '00ff00', 4: '0000ff', 5: 'ffff00', 6: 'ff00ff', 7: '00ffff', 8: '000000', 9: 'ffffff', 10: 'ff0000', 11: '00ff00', 12: '0000ff', 13: 'ffff00', 14: 'ff00ff', 15: '00ffff' }

// ── 数字格式：我们的 11 种 ⇄ Excel 格式码 ─────────────────────────────────

function numBody(d: number, k: boolean): string { return `${k ? '#,##0' : '0'}${d > 0 ? '.' + '0'.repeat(d) : ''}` }
export function numFmtToCode(nf: NumFmt | undefined): string | null {
  if (!nf || nf.t === 'general') return null
  const d = nf.d ?? 2
  switch (nf.t) {
    case 'number': return numBody(d, !!nf.k)
    case 'currency': return `"${nf.c ?? CURRENCY_SYMBOL}"${numBody(d, nf.k !== false)}`
    case 'accounting': { const b = numBody(d, nf.k !== false); const c = nf.c ?? CURRENCY_SYMBOL; return `_("${c}"* ${b}_);_("${c}"* \\(${b}\\);_("${c}"* "-"${'?'.repeat(d)}_);_(@_)` }
    case 'date': return 'yyyy/m/d'
    case 'longdate': return 'yyyy"年"m"月"d"日"'
    case 'rocdate': return '[$-zh-TW]e"年"m"月"d"日"'
    case 'time': return 'hh:mm'
    case 'percent': return `${numBody(d, !!nf.k)}%`
    case 'fraction': return '# ??/??'
    case 'scientific': return `0${d > 0 ? '.' + '0'.repeat(d) : ''}E+00`
    case 'text': return '@'
  }
  return null
}
/** 格式码里的货币符号（我们认的四种）：NT$ 先认（它含 $）·其余 ¥ € $；£ 等认不得 ⇒ undefined（显示照旧 $） */
function currencySymbolOf(code: string): CurrencySymbol | undefined {
  if (/NT\$/.test(code)) return 'NT$'
  if (/[¥￥]/.test(code)) return '¥'
  if (/€/.test(code)) return '€'
  if (/\$/.test(code.replace(/\[\$[^\]]*\]/g, ''))) return '$'
  return undefined
}
/** Excel 格式码 ⇒ 最接近的那一种（只管显示·认不出 ⇒ undefined＝常规） */
export function codeToNumFmt(code: string | undefined | null): NumFmt | undefined {
  if (!code) return undefined
  const raw = String(code)
  if (/^general$/i.test(raw.trim())) return undefined
  const first = raw.split(';')[0]
  const bare = first.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/[_*]./g, '').replace(/\[[^\]]*\]/g, '')
  if (bare.trim() === '@') return { t: 'text' }
  const decimals = () => { const m = /\.([0#?]+)/.exec(bare); return Math.min(DECIMALS_MAX, m ? m[1].length : 0) }
  const thousands = /[#0?],[#0?]/.test(bare)
  if (/E[+-]/i.test(bare)) return { t: 'scientific', d: decimals() }
  if (/\?+\s*\/\s*[?\d]+/.test(bare)) return { t: 'fraction' }
  const noText = bare.replace(/[^A-Za-z]/g, '')
  // 民國紀年：台湾区码（[$-zh-TW]／[$-404]）里的 e＝民國年
  if (/e/i.test(noText) && /[md]/i.test(noText) && /\[\$-(?:zh-TW|0*404)\]/i.test(raw)) return { t: 'rocdate' }
  if (/[yd]/i.test(noText) || /^m+$/i.test(noText)) return /年|dddd|mmmm/.test(raw) ? { t: 'longdate' } : { t: 'date' }
  if (/[hs]/i.test(noText)) return { t: 'time' }
  if (bare.includes('%')) return { t: 'percent', d: decimals(), ...(thousands ? { k: true } : {}) }
  const found = currencySymbolOf(first)
  const sym = found && found !== CURRENCY_SYMBOL ? found : undefined   // $ ＝ 没存符号的旧格同一个显示（不写 c·旧档往返不变形）
  if (/_\(|\*\s/.test(first) && /[$¥€£]|\[\$/.test(first)) return { t: 'accounting', d: decimals(), ...(thousands ? { k: true } : {}), ...(sym ? { c: sym } : {}) }
  if (/[$¥€£]|\[\$/.test(first)) return { t: 'currency', d: decimals(), ...(thousands ? { k: true } : {}), ...(sym ? { c: sym } : {}) }
  if (/[0#]/.test(bare)) return { t: 'number', d: decimals(), ...(thousands ? { k: true } : {}) }
  return undefined
}

// ── 导出 ──────────────────────────────────────────────────────────────────

const BORDER_OUT: Record<string, string> = { thin: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' }
/** 像素 ⇒ Excel 列宽（[MS-OI29500] 2.1.595·最大数字宽 7px） */
export const pxToColWidth = (px: number) => Math.floor((px / 7) * 256) / 256
export const colWidthToPx = (w: number) => Math.floor(((256 * w + Math.floor(128 / 7)) / 256) * 7)

/** 导出档名：去掉路径字与控制字·不带副档名就补 .xlsx */
export function exportFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let n = raw.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim()
  n = n.replace(/\.xlsx$/i, '').slice(0, 180).trim() || 'sheet'
  return `${n}.xlsx`
}

/** Excel 工作表名：≤31 字·不许 : \ / ? * [ ]·不许首尾单引号·不分大小写唯一 */
export function safeSheetName(name: string, taken: Set<string>): string {
  let base = (name || 'Sheet').replace(/[:\\/?*[\]]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Sheet'
  base = base.slice(0, 31)
  let out = base, n = 2
  while (taken.has(out.toLowerCase())) { const suf = ` (${n++})`; out = base.slice(0, 31 - suf.length) + suf }
  taken.add(out.toLowerCase())
  return out
}

class StyleTable {
  fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>']
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
  borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
  numFmts: string[] = []   // 自订格式码（id 从 164 起）
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  dxfs: string[] = []   // 条件格式的命中格式（dxfId 从 0 起）
  dxf(xml: string): number { return this.pick(this.dxfs, xml, 'dxf') }
  private idx = new Map<string, number>()
  private pick(list: string[], xml: string, kind: string, base = 0): number {
    const k = kind + xml
    const hit = this.idx.get(k)
    if (hit !== undefined) return hit
    list.push(xml)
    const i = list.length - 1 + base
    this.idx.set(k, i)
    return i
  }
  xfFor(s: CellStyle | undefined): number {
    if (!s) return 0
    // 字体
    let fontId = 0
    const fontName = s.font ? findFont(s.font)?.label : undefined
    const fg = toArgb(s.fg)
    if (s.b || s.i || s.u || s.s || fontName || (s.size && s.size !== 11) || fg) {
      const parts = [s.b ? '<b/>' : '', s.i ? '<i/>' : '', s.s ? '<strike/>' : '', s.u ? '<u/>' : '', `<sz val="${s.size ?? 11}"/>`, fg ? `<color rgb="${fg}"/>` : '<color theme="1"/>', `<name val="${esc(fontName ?? 'Calibri')}"/>`]
      fontId = this.pick(this.fonts, `<font>${parts.join('')}</font>`, 'font')
    }
    // 底色
    let fillId = 0
    const bg = toArgb(s.bg)
    if (bg) fillId = this.pick(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor indexed="64"/></patternFill></fill>`, 'fill')
    // 边框（按边形＝现行；旧 'tblr' 字串也认·都经网页同一份 sanitizeBorder）
    let borderId = 0
    const sides: CellBorder = sanitizeBorder((s as { border?: unknown }).border) ?? {}
    if (Object.keys(sides).length) {
      const side = (tag: string, k: 't' | 'r' | 'b' | 'l') => {
        const l = sides[k]
        if (!l) return `<${tag}/>`
        const st = BORDER_OUT[l.style ?? 'thin'] ?? 'thin'
        const col = toArgb(l.color)
        return `<${tag} style="${st}">${col ? `<color rgb="${col}"/>` : '<color indexed="64"/>'}</${tag}>`
      }
      borderId = this.pick(this.borders, `<border>${side('left', 'l')}${side('right', 'r')}${side('top', 't')}${side('bottom', 'b')}<diagonal/></border>`, 'border')
    }
    // 数字格式
    let numFmtId = 0
    const code = numFmtToCode(s.numFmt)
    if (code) numFmtId = this.pick(this.numFmts, code, 'numfmt', 164)
    // 对齐
    const al: string[] = []
    if (s.align) al.push(`horizontal="${s.align}"`)
    if (s.valign) al.push(`vertical="${s.valign === 'middle' ? 'center' : s.valign}"`)
    if (s.wrap) al.push('wrapText="1"')
    if (s.indent) al.push(`indent="${s.indent}"`)
    if (!fontId && !fillId && !borderId && !numFmtId && !al.length) return 0
    const applies = [fontId ? ' applyFont="1"' : '', fillId ? ' applyFill="1"' : '', borderId ? ' applyBorder="1"' : '', numFmtId ? ' applyNumberFormat="1"' : '', al.length ? ' applyAlignment="1"' : ''].join('')
    const xml = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applies}${al.length ? `><alignment ${al.join(' ')}/></xf>` : '/>'}`
    return this.pick(this.xfs, xml, 'xf')
  }
  xml(): string {
    const nf = this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` : ''
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf}` +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs></styleSheet>`
  }
}

const EXCEL_ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'])

/** 一张 sheet 的图片附带：格内图的格 ⇒ vm 号（1 起）·drawing／背景图在 sheet rels 里的 rId */
type SheetExtra = { inCellVm?: Map<string, number>; drawingRid?: string; pictureRid?: string }

/** book＝整份文件的求值选项（跨表公式的缓存值）·mapF＝公式原文（含 =）⇒ 写进档的原文（跨表前缀换成档里的表名） */
type SheetXmlCtx = { evalOpts?: EvaluatorOptions; mapF?: (f: string) => string }
function sheetXml(content: AgentContent, styles: StyleTable, extra: SheetExtra = {}, ctx: SheetXmlCtx = {}): string {
  const cells: SheetCells = content.cells ?? {}
  const ev = new SheetEvaluator(cells, content.merges, ctx.evalOpts)
  const byRow = new Map<number, Array<{ c: number; k: string; cd: CellData }>>()
  let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1
  const inCellVm = extra.inCellVm ?? new Map<string, number>()
  const entries: Array<[string, CellData]> = Object.entries(cells)
  for (const k of inCellVm.keys()) if (!cells[k]) entries.push([k, {}])   // 格内图的格本来是空的 ⇒ 补一格写 vm
  for (const [k, cd] of entries) {
    const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(k); if (!m) continue
    const r = Number(m[2]) - 1, c = colToIndex(m[1])
    if (!byRow.has(r)) byRow.set(r, [])
    byRow.get(r)!.push({ c, k, cd })
    minR = Math.min(minR, r); minC = Math.min(minC, c); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
  }
  const rowsH = content.rowHeights && typeof content.rowHeights === 'object' ? content.rowHeights : {}
  for (const k of Object.keys(rowsH)) { const r = Number(k) - 1; if (Number.isInteger(r) && r >= 0 && r <= MAX_ROW_INDEX && !byRow.has(r)) byRow.set(r, []) }
  // 冻结筛选验证：冻结 pane／autoFilter／dataValidations 三段＋被筛掉的行写 hidden（空行也要写一列 <row> 才藏得住）
  const view = sheetViewXmlParts(content)
  const print = printXmlParts(content)   // 列印设定：sheetPr（fitToPage）放最前·printOptions…headerFooter 放 dataValidations 之后、drawing 之前
  for (const r of view.hidden) if (!byRow.has(r)) byRow.set(r, [])
  const out: string[] = []
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const list = byRow.get(r)!.sort((a, b) => a.c - b.c)
    const h = rowsH[String(r + 1)]
    const ht = (typeof h === 'number' && Number.isFinite(h) && h > 0 ? ` ht="${Math.round(h * 0.75 * 100) / 100}" customHeight="1"` : '') + (view.hidden.has(r) ? ' hidden="1"' : '')
    const cs = list.map(({ k, cd }) => {
      const s = styles.xfFor(cd.s)
      const sAttr = s ? ` s="${s}"` : ''
      const vm = inCellVm.get(k)
      if (vm) return `<c r="${k}"${sAttr} t="e" vm="${vm}"><v>#VALUE!</v></c>`   // Excel「放进格子里的图」：值＝#VALUE!＋vm 指到 Rich Value（没这功能的旧版 Excel 就看到 #VALUE!）
      if (cd.f && cd.f.trim().startsWith('=')) {
        // 公式原文照写·只给 Excel 2010 后的新函数补 _xlfn. 前缀（IFS／XLOOKUP…不带 Excel 会 #NAME?）·档里 fullCalcOnLoad＝1 Excel 打开即重算
        const f = `<f>${esc(toXlsxFormula((ctx.mapF ? ctx.mapF(cd.f.trim()) : cd.f.trim()).slice(1)))}</f>`
        let val: Scalar = ev.typedValue(k)
        if (isFormulaError(val) && typeof cd.v === 'string' && cd.v !== '') val = parseLiteral(cd.v)   // 本编辑器算不了（外来函数）⇒ 用导入时存下的 Excel 缓存值
        if (val === null) return `<c r="${k}"${sAttr}>${f}</c>`
        if (typeof val === 'boolean') return `<c r="${k}"${sAttr} t="b">${f}<v>${val ? 1 : 0}</v></c>`
        if (typeof val === 'number') return `<c r="${k}"${sAttr}>${f}<v>${val}</v></c>`
        if (EXCEL_ERRORS.has(val)) return `<c r="${k}"${sAttr} t="e">${f}<v>${esc(val)}</v></c>`
        if (isFormulaError(val)) return `<c r="${k}"${sAttr} t="e">${f}<v>#VALUE!</v></c>`
        return `<c r="${k}"${sAttr} t="str">${f}<v>${esc(val)}</v></c>`
      }
      const raw = cd.v ?? ''
      if (raw === '') return sAttr ? `<c r="${k}"${sAttr}/>` : ''
      if (cd.s?.numFmt?.t === 'text') return `<c r="${k}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`
      if (raw === 'TRUE' || raw === 'FALSE') return `<c r="${k}"${sAttr} t="b"><v>${raw === 'TRUE' ? 1 : 0}</v></c>`
      const lit = parseLiteral(raw)
      if (typeof lit === 'number' && Number.isFinite(lit)) return `<c r="${k}"${sAttr}><v>${lit}</v></c>`
      return `<c r="${k}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`
    }).join('')
    out.push(`<row r="${r + 1}"${ht}>${cs}</row>`)
  }
  const merges = (content.merges ?? []).map(m => parseRange(m)).filter(Boolean).map(r => rangeKey(r!))
  for (const m of merges) { const r = parseRange(m)!; minR = Math.min(minR, r.r0); minC = Math.min(minC, r.c0); maxR = Math.max(maxR, r.r1); maxC = Math.max(maxC, r.c1) }
  const dim = maxR >= 0 ? (minR === maxR && minC === maxC ? cellKey(minR, minC) : `${cellKey(minR, minC)}:${cellKey(maxR, maxC)}`) : 'A1'
  const colW = content.colWidths && typeof content.colWidths === 'object' ? Object.entries(content.colWidths).filter(([k, w]) => /^[A-Z]{1,3}$/.test(k) && typeof w === 'number' && w > 0).map(([k, w]) => ({ c: colToIndex(k), w: w as number })).sort((a, b) => a.c - b.c) : []
  // 手动隐藏的栏：没设宽的也要写一条 <col hidden="1">（宽照预设）
  const hidCols = new Set((content as { hiddenCols?: number[] }).hiddenCols ?? [])
  for (const c of hidCols) if (!colW.some(x => x.c === c)) colW.push({ c, w: 0 })
  colW.sort((a, b) => a.c - b.c)
  const cols = colW.length ? `<cols>${colW.map(({ c, w }) => `<col min="${c + 1}" max="${c + 1}" width="${pxToColWidth(w > 0 ? w : COL_W_DEFAULT)}"${w > 0 ? ' customWidth="1"' : ''}${hidCols.has(c) ? ' hidden="1"' : ''}/>`).join('')}</cols>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    // 缺 <sheetViews> 时 Excel 读进来的行高一律减半（明写 ht=21 也读成 10.5）·补一行即正常（同 openpyxl）·顺序 dimension→sheetViews→sheetFormatPr→cols
    // 默认列宽／行高＝编辑器 96px／28px（没设宽高的列与行在 Excel 里同尺寸·上下层图与合成背景才对得上位）·顺序 dimension→sheetFormatPr→cols
    `${print.sheetPr}<dimension ref="${dim}"/>${view.sheetViews}<sheetFormatPr defaultColWidth="${pxToColWidth(COL_W_DEFAULT)}" defaultRowHeight="${ROW_H_DEFAULT * 0.75}" customHeight="1"/>${cols}<sheetData>${out.join('')}</sheetData>` +
    view.autoFilter +   // autoFilter 在 sheetData 之后、mergeCells 之前（§18.3.1.99）
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    // 条件格式：mergeCells→phoneticPr→conditionalFormatting→dataValidations→…→drawing（ECMA-376 CT_Worksheet 顺序）
    condFormatSheetXml(content.condFormats, x => styles.dxf(x)) +
    view.dataValidations +   // dataValidations 在 conditionalFormatting 之后、drawing 之前
    print.tail +   // printOptions→pageMargins→pageSetup→headerFooter（§18.3.1.99：dataValidations／hyperlinks 之后、drawing 之前）
    // CT_Worksheet 元素顺序：…mergeCells…drawing…picture（ECMA-376 §18.3.1.99）
    (extra.drawingRid ? `<drawing r:id="${extra.drawingRid}"/>` : '') +
    (extra.pictureRid ? `<picture r:id="${extra.pictureRid}"/>` : '') +
    `</worksheet>`
}

// ── 图片──────────────────────────────────
//   上层图（plane above）＝ xl/drawings/drawingN.xml 的 oneCellAnchor（锚格＋EMU 偏移＋ext 宽高）·anchor 顺序＝images 数组顺序（后写的在上）
//   格内图（inCell）＝ Excel「放进格子里的图」：Rich Value（xl/richData/*＋xl/metadata.xml·格写 t="e" vm="N" 值 #VALUE!）
//     那格本来有值或公式 ⇒ 退为 twoCellAnchor 锚满该格（合并区＝整块）的浮动图（⛔ 为了放图把格值抹掉）
//   下层图（plane below）＝ 工作表背景图 <picture r:id>（Excel 平铺·只在屏幕上看得到、打印没有）；位元组由调用方备好（一张原样或多张合成）
//   位元组都由调用方先取好（xlsx-images.ts）——本档仍是纯函数·浏览器服务端共用

/** 96 DPI 一像素＝9525 EMU（ECMA-376 §20.1.2.1） */
export const EMU_PER_PX = 9525
export type XlsxPictureExt = 'png' | 'jpeg' | 'gif'
export type XlsxPicture = { bytes: Uint8Array; ext: XlsxPictureExt }
/** images：键＝`${sheet 序}:${image id}`；backgrounds：sheet 序 ⇒ 背景图 */
export type XlsxMedia = { images?: Map<string, XlsxPicture>; backgrounds?: Map<number, XlsxPicture> }
export const mediaKey = (sheetIndex: number, imageId: string) => `${sheetIndex}:${imageId}`
const PIC_MIME: Record<XlsxPictureExt, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' }

/** 锚格＋像素偏移 ⇒ Excel 锚点（偏移超出该格就按本编辑器的列宽行高往右／下走到真正落点那格·Excel 才不会把偏移截在格边） */
export function pxAnchor(content: AgentContent, cell: string, ox = 0, oy = 0): { col: number; colOff: number; row: number; rowOff: number } {
  const p = parseRef(cell) ?? { row: 0, col: 0 }
  let col = p.col, row = p.row, x = Math.max(0, ox), y = Math.max(0, oy)
  for (let w = colWidthOf(content.colWidths, col); x >= w && col < MAX_COL_INDEX; w = colWidthOf(content.colWidths, col)) { x -= w; col++ }
  for (let h = rowHeightOf(content.rowHeights, row); y >= h && row < MAX_ROW_INDEX; h = rowHeightOf(content.rowHeights, row)) { y -= h; row++ }
  return { col, colOff: Math.round(x * EMU_PER_PX), row, rowOff: Math.round(y * EMU_PER_PX) }
}

const XDR_NS = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const picXml = (id: number, rid: string, cx: number, cy: number) =>
  `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${id - 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
  `<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
  `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/>`
const marker = (tag: string, a: { col: number; colOff: number; row: number; rowOff: number }) =>
  `<xdr:${tag}><xdr:col>${a.col}</xdr:col><xdr:colOff>${a.colOff}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${a.rowOff}</xdr:rowOff></xdr:${tag}>`
/** 合并区（含锚格）⇒ 矩形；不在合并区 ⇒ 单格 */
function cellRect(content: AgentContent, key: string): { r0: number; c0: number; r1: number; c1: number } | null {
  const p = parseRef(key); if (!p) return null
  for (const m of content.merges ?? []) { const r = parseRange(m); if (r && p.row >= r.r0 && p.row <= r.r1 && p.col >= r.c0 && p.col <= r.c1) return r }
  return { r0: p.row, c0: p.col, r1: p.row, c1: p.col }
}

export type ImageExportStats = { drawn: number; in_cell: number; in_cell_floating: number; background: boolean }

/**
 * 表格档的 sheet 们 ⇒ .xlsx 位元组（公式带算好的缓存值·打开时 Excel 全表重算）。
 * 浏览器与服务端共用这一份：表格页顶栏「xlsx」钮在浏览器里直接调它（动态载入）；服务端经下面的 buildXlsx 调它。
 */
export function buildXlsxBytes(sheets: WorkbookSheet[], media: XlsxMedia = {}, stats?: ImageExportStats): Uint8Array {
  if (!sheets.length) throw new XlsxError('nothing to export', 'err_xlsx_empty')
  const styles = new StyleTable()
  const taken = new Set<string>()
  const names = sheets.map(s => safeSheetName(s.name, taken))
  // 跨表引用：缓存值照整份文件算；公式里的页签名换成档里的表名（Excel 表名有字数与符号限制·safeSheetName 可能改过）·
  //   指到不存在的页签 ⇒ 整段写 #REF!（Excel 删掉页签后也是这样）；同名几张 ⇒ 认排最前那张（同网页求值）
  const book = new SheetBook(sheets.map(s => ({ name: s.name, content: s.content })))
  const xname = new Map<string, string>()
  sheets.forEach((s, i) => { const k = sheetKey(s.name); if (!xname.has(k)) xname.set(k, names[i]) })
  const mapF = (f: string) => rewriteSheetRefs(f, n => { const x = xname.get(sheetKey(n)); return x === undefined ? 'ref' : { name: x } }, { ascii: true })
  const zip = CFB.utils.cfb_new()
  const add = (p: string, s: string) => CFB.utils.cfb_add(zip, p, UTF8.encode(s))
  const st: ImageExportStats = stats ?? { drawn: 0, in_cell: 0, in_cell_floating: 0, background: false }
  // 媒体档：同一份位元组（同一个物件）只写一次
  const mediaName = new Map<XlsxPicture, string>()
  const usedExt = new Set<XlsxPictureExt>()
  const addMedia = (p: XlsxPicture): string => {
    const hit = mediaName.get(p); if (hit) return hit
    const name = `image${mediaName.size + 1}.${p.ext}`
    mediaName.set(p, name); usedExt.add(p.ext)
    CFB.utils.cfb_add(zip, `xl/media/${name}`, p.bytes)
    return name
  }
  const richValues: string[] = []   // 格内图（全簿一份清单）：第 i 个＝vm i+1·值＝媒体档名
  const drawings: number[] = []     // 有 drawing 的 sheet 序（drawingN 的 N＝在这清单里的序＋1）
  let chartCount = 0                // 图表：全簿 chartN.xml 已编到几
  const sheetXmls = sheets.map((s, si) => {
    const content = s.content ?? {}
    const extra: SheetExtra = { inCellVm: new Map() }
    const sheetRels: string[] = []
    const anchors: string[] = []
    const drawRels: string[] = []
    const cells = content.cells ?? {}
    for (const im of content.images ?? []) {
      const layer = imageLayer(im)
      if (layer === 'below') continue
      const pic = media.images?.get(mediaKey(si, im.id))
      if (!pic) continue
      if (layer === 'cell') {
        const rect = cellRect(content, im.cell); if (!rect) continue
        const key = cellKey(rect.r0, rect.c0)
        const cd = cells[key]
        const empty = !cd || ((cd.v === undefined || cd.v === '') && !cd.f)
        if (empty && !extra.inCellVm!.has(key)) {
          richValues.push(addMedia(pic)); extra.inCellVm!.set(key, richValues.length); st.in_cell++
          continue
        }
        // 退路：锚满该格（合并区＝整块）的浮动图
        const rid = `rId${drawRels.length + 1}`
        drawRels.push(`<Relationship Id="${rid}" Type="${REL_IMAGE}" Target="../media/${addMedia(pic)}"/>`)
        let cx = 0, cy = 0
        for (let c = rect.c0; c <= rect.c1; c++) cx += colWidthOf(content.colWidths, c)
        for (let r = rect.r0; r <= rect.r1; r++) cy += rowHeightOf(content.rowHeights, r)
        anchors.push(`<xdr:twoCellAnchor editAs="oneCell">${marker('from', { col: rect.c0, colOff: 0, row: rect.r0, rowOff: 0 })}${marker('to', { col: rect.c1 + 1, colOff: 0, row: rect.r1 + 1, rowOff: 0 })}${picXml(anchors.length + 2, rid, cx * EMU_PER_PX, cy * EMU_PER_PX)}</xdr:twoCellAnchor>`)
        st.in_cell_floating++
        continue
      }
      const rid = `rId${drawRels.length + 1}`
      drawRels.push(`<Relationship Id="${rid}" Type="${REL_IMAGE}" Target="../media/${addMedia(pic)}"/>`)
      const cx = Math.round(im.w * EMU_PER_PX), cy = Math.round(im.h * EMU_PER_PX)
      anchors.push(`<xdr:oneCellAnchor>${marker('from', pxAnchor(content, im.cell, im.ox, im.oy))}<xdr:ext cx="${cx}" cy="${cy}"/>${picXml(anchors.length + 2, rid, cx, cy)}</xdr:oneCellAnchor>`)
      st.drawn++
    }
    // 图表：原生图表进同一个 drawing（排在图片之后＝在上层·同网页）
    const cp = chartDrawingParts(content, names[si], { firstChart: chartCount, firstRel: drawRels.length, firstShape: anchors.length }, numFmtToCode)
    anchors.push(...cp.anchors); drawRels.push(...cp.rels); for (const p of cp.parts) add(p.path, p.xml); chartCount += cp.parts.length
    if (anchors.length) {
      drawings.push(si)
      const n = drawings.length
      extra.drawingRid = `rId${sheetRels.length + 1}`
      sheetRels.push(`<Relationship Id="${extra.drawingRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/>`)
      add(`xl/drawings/drawing${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr ${XDR_NS}>${anchors.join('')}</xdr:wsDr>`)
      add(`xl/drawings/_rels/drawing${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${drawRels.join('')}</Relationships>`)
    }
    const bg = media.backgrounds?.get(si)
    if (bg) {
      extra.pictureRid = `rId${sheetRels.length + 1}`
      sheetRels.push(`<Relationship Id="${extra.pictureRid}" Type="${REL_IMAGE}" Target="../media/${addMedia(bg)}"/>`)
      st.background = true
    }
    if (sheetRels.length) add(`xl/worksheets/_rels/sheet${si + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${sheetRels.join('')}</Relationships>`)
    return sheetXml(content, styles, extra, { evalOpts: { book, sheetName: s.name }, mapF })
  })
  const hasRich = richValues.length > 0
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    [...usedExt].map(e => `<Default Extension="${e}" ContentType="${PIC_MIME[e]}"/>`).join('') +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    drawings.map((_, i) => `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('') +
    chartContentTypes(chartCount) +   // 图表
    (hasRich ? `<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>` +
      `<Override PartName="/xl/richData/rdrichvalue.xml" ContentType="application/vnd.ms-excel.rdrichvalue+xml"/>` +
      `<Override PartName="/xl/richData/rdrichvaluestructure.xml" ContentType="application/vnd.ms-excel.rdrichvaluestructure+xml"/>` +
      `<Override PartName="/xl/richData/rdRichValueTypes.xml" ContentType="application/vnd.ms-excel.rdrichvaluetypes+xml"/>` +
      `<Override PartName="/xl/richData/richValueRel.xml" ContentType="application/vnd.ms-excel.richvaluerel+xml"/>` : '') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${mergeDefinedNames(filterDefinedNamesXml(sheets.map((s, i) => ({ sheetName: names[i], index: i, content: s.content ?? {} }))), printDefinedNames(sheets.map((s, i) => ({ sheetName: names[i], index: i, content: s.content ?? {} }))))}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`)
  const N = sheets.length
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${N + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    (hasRich ? `<Relationship Id="rId${N + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>` +
      `<Relationship Id="rId${N + 3}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue" Target="richData/rdrichvalue.xml"/>` +
      `<Relationship Id="rId${N + 4}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/>` +
      `<Relationship Id="rId${N + 5}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes" Target="richData/rdRichValueTypes.xml"/>` +
      `<Relationship Id="rId${N + 6}" Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/>` : '') +
    `</Relationships>`)
  if (hasRich) addRichValueParts(add, richValues)
  sheetXmls.forEach((x, i) => add(`xl/worksheets/sheet${i + 1}.xml`, x))
  add('xl/styles.xml', styles.xml())
  const out = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true })   // Node 下回 Buffer（也是 Uint8Array）·浏览器回 Uint8Array
  return out instanceof Uint8Array ? out : Uint8Array.from(out as ArrayLike<number>)
}

/**
 * Excel「放进格子里的图」（Place in Cell·Excel 365 2023 起）的 Rich Value 部件——照 [MS-XLSX] 2.3.6 rich data 部件与 Excel 实际存出的档：
 *   metadata.xml：XLRICHVALUE 型·futureMetadata 第 i 块 <xlrd:rvb i="i"/>·valueMetadata 第 i 块 <rc t="1" v="i"/>（格的 vm＝i+1）
 *   rdrichvaluestructure.xml：结构 _localImage｛_rvRel:LocalImageIdentifier、CalcOrigin｝；rdrichvalue.xml：每张 <rv s="0"><v>rel 序</v><v>5</v></rv>（5＝放进格子里）
 *   richValueRel.xml＋_rels：rel 序 ⇒ ../media/imageN
 */
function addRichValueParts(add: (p: string, s: string) => unknown, media: string[]): void {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const n = media.length
  add('xl/metadata.xml', X + `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata">` +
    `<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>` +
    `<futureMetadata name="XLRICHVALUE" count="${n}">${media.map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`).join('')}</futureMetadata>` +
    `<valueMetadata count="${n}">${media.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join('')}</valueMetadata></metadata>`)
  add('xl/richData/rdrichvaluestructure.xml', X + `<rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`)
  add('xl/richData/rdrichvalue.xml', X + `<rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="${n}">${media.map((_, i) => `<rv s="0"><v>${i}</v><v>5</v></rv>`).join('')}</rvData>`)
  add('xl/richData/rdRichValueTypes.xml', X + `<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><global><keyFlags>` +
    `<key name="_Self"><flag name="ExcludeFromFile" value="1"/><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_DisplayString"><flag name="ExcludeFromCalcComparison" value="1"/></key>` +
    `<key name="_Flags"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Format"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_SubLabel"><flag name="ExcludeFromCalcComparison" value="1"/></key>` +
    `<key name="_Attribution"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Icon"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Display"><flag name="ExcludeFromCalcComparison" value="1"/></key>` +
    `<key name="_CanonicalPropertyNames"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_ClassificationId"><flag name="ExcludeFromCalcComparison" value="1"/></key></keyFlags></global></rvTypesInfo>`)
  add('xl/richData/richValueRel.xml', X + `<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${media.map((_, i) => `<rel r:id="rId${i + 1}"/>`).join('')}</richValueRels>`)
  add('xl/richData/_rels/richValueRel.xml.rels', X + `<Relationships xmlns="${REL_NS}">${media.map((m, i) => `<Relationship Id="rId${i + 1}" Type="${REL_IMAGE}" Target="../media/${m}"/>`).join('')}</Relationships>`)
}

/** 服务端用（xlsx-export 路由等）：同 buildXlsxBytes·回 Buffer */
export function buildXlsx(sheets: WorkbookSheet[], media?: XlsxMedia, stats?: ImageExportStats): Buffer {
  const u = buildXlsxBytes(sheets, media, stats)
  return Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength)
}

// ── 导入 ──────────────────────────────────────────────────────────────────

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/** zip 预检（交给 SheetJS 解压之前）：量中央目录里宣告的解压后大小与条目数；zip64／读不懂 ⇒ 拒（⛔ 放行） */
export function zipPreflight(b: Uint8Array): { entries: number; unzipped: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const u16 = (i: number) => dv.getUint16(i, true), u32 = (i: number) => dv.getUint32(i, true)
  const min = Math.max(0, b.length - 65_557)
  let eocd = -1
  for (let i = b.length - 22; i >= min; i--) if (u32(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new XlsxError('not a valid .xlsx (zip directory missing)')
  const count = u16(eocd + 10), cdSize = u32(eocd + 12), cdOff = u32(eocd + 16)
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new XlsxError('zip64 spreadsheets are not supported', 'err_xlsx_too_large')
  if (count > IMPORT_MAX_ENTRIES) throw new XlsxError(`too many parts inside the file (${count})`, 'err_xlsx_too_large')
  if (cdOff + cdSize > b.length) throw new XlsxError('not a valid .xlsx (zip directory out of range)')
  let p = cdOff, total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(p) !== 0x02014b50) throw new XlsxError('not a valid .xlsx (bad zip entry)')
    const usize = u32(p + 24)
    if (usize === 0xffffffff) throw new XlsxError('zip64 spreadsheets are not supported', 'err_xlsx_too_large')
    total += usize
    if (total > IMPORT_MAX_UNZIPPED) throw new XlsxError(`the file unpacks to more than ${Math.round(IMPORT_MAX_UNZIPPED / 1024 / 1024)}MB`, 'err_xlsx_too_large')
    p += 46 + u16(p + 28) + u16(p + 30) + u16(p + 32)
  }
  return { entries: count, unzipped: total }
}

type RawColor = { rgb?: string; theme?: number; tint?: number; indexed?: number; auto?: boolean }
type RawFont = { name?: string; sz?: number; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: RawColor }
type RawBorderSide = { style: string; color?: RawColor }
type RawXf = { numFmtId: number; fontId: number; fillId: number; borderId: number; align?: Record<string, string> }
type RawStyles = { fonts: RawFont[]; fills: Array<{ pattern?: string; fg?: RawColor }>; borders: Array<Partial<Record<'left' | 'right' | 'top' | 'bottom', RawBorderSide>>>; xfs: RawXf[] }

const section = (xml: string, tag: string) => { const m = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml); return m ? m[1] : '' }
const children = (xml: string, tag: string) => {
  const out: Array<{ open: string; body: string }> = []
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push({ open: m[1] ?? '', body: m[2] ?? '' })
  return out
}
const colorIn = (body: string, tag = 'color'): RawColor | undefined => {
  const m = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)/?>`).exec(body)
  if (!m) return undefined
  const a = attrs(m[1])
  return { ...(a.rgb ? { rgb: a.rgb.slice(-6).toLowerCase() } : {}), ...(a.theme !== undefined ? { theme: Number(a.theme) } : {}), ...(a.tint !== undefined ? { tint: Number(a.tint) } : {}), ...(a.indexed !== undefined ? { indexed: Number(a.indexed) } : {}), ...(a.auto === '1' || a.auto === 'true' ? { auto: true } : {}) }
}
const boolEl = (body: string, tag: string) => { const m = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)/?>`).exec(body); if (!m) return false; const v = attrs(m[1]).val; return v === undefined || !(v === '0' || v === 'false' || v === 'none') }

function parseStyles(xml: string): RawStyles {
  const fonts = children(section(xml, 'fonts'), 'font').map(({ body }) => {
    const f: RawFont = {}
    const name = /<(?:\w+:)?name\b([^>]*)\/?>/.exec(body); if (name) f.name = unesc(attrs(name[1]).val ?? '')
    const sz = /<(?:\w+:)?sz\b([^>]*)\/?>/.exec(body); if (sz) f.sz = Number(attrs(sz[1]).val)
    f.b = boolEl(body, 'b'); f.i = boolEl(body, 'i'); f.u = boolEl(body, 'u'); f.strike = boolEl(body, 'strike')
    f.color = colorIn(body)
    return f
  })
  const fills = children(section(xml, 'fills'), 'fill').map(({ body }) => {
    const pf = /<(?:\w+:)?patternFill\b([^>]*)>?/.exec(body)
    return { pattern: pf ? attrs(pf[1]).patternType : undefined, fg: colorIn(body, 'fgColor') }
  })
  const borders = children(section(xml, 'borders'), 'border').map(({ body }) => {
    const b: RawStyles['borders'][number] = {}
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      for (const el of children(body, side)) { const st = attrs(el.open).style; if (st && st !== 'none') b[side] = { style: st, color: colorIn(el.body) } }
    }
    return b
  })
  const xfs = children(section(xml, 'cellXfs'), 'xf').map(({ open, body }) => {
    const a = attrs(open)
    const al = /<(?:\w+:)?alignment\b([^>]*)\/?>/.exec(body)
    return { numFmtId: Number(a.numFmtId ?? 0), fontId: Number(a.fontId ?? 0), fillId: Number(a.fillId ?? 0), borderId: Number(a.borderId ?? 0), ...(al ? { align: attrs(al[1]) } : {}) }
  })
  return { fonts, fills, borders, xfs }
}

const BORDER_IN: Record<string, string> = { thin: 'thin', hair: 'dotted', dotted: 'dotted', medium: 'medium', thick: 'thick', double: 'double', dashed: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed', mediumDashed: 'dashed', mediumDashDot: 'dashed', mediumDashDotDot: 'dashed', slantDashDot: 'dashed' }

type ThemeColors = Array<{ rgb?: string }> | undefined
function resolveColor(c: RawColor | undefined, theme: ThemeColors): string | undefined {
  if (!c || c.auto) return undefined
  let hex: string | undefined
  if (c.rgb && /^[0-9a-f]{6}$/.test(c.rgb)) hex = c.rgb
  else if (c.theme !== undefined && theme?.[c.theme]?.rgb) hex = String(theme[c.theme]!.rgb).slice(-6).toLowerCase()
  else if (c.indexed !== undefined) hex = INDEXED[c.indexed]
  if (!hex || !/^[0-9a-f]{6}$/.test(hex)) return undefined
  return '#' + (c.tint ? tint(hex, c.tint) : hex)
}

/** 一个 xf ⇒ 我们的 CellStyle（跟工作簿预设字体一样的项不存·省得每格都挂一份） */
function styleFromXf(st: RawStyles, xfIdx: number, theme: ThemeColors): CellStyle | undefined {
  const xf = st.xfs[xfIdx]
  if (!xf) return undefined
  const s: CellStyle = {}
  const f = st.fonts[xf.fontId], base = st.fonts[0] ?? {}
  if (f) {
    if (f.name && f.name !== base.name) { const hit = findFontByFamily(f.name); if (hit) s.font = hit.id }
    if (f.sz && f.sz !== base.sz) { const n = Math.round(f.sz); if (n >= SIZE_MIN && n <= SIZE_MAX) s.size = n }
    if (f.b) s.b = true
    if (f.i) s.i = true
    if (f.u) s.u = true
    if (f.strike) s.s = true
    const fg = resolveColor(f.color, theme), baseFg = resolveColor(base.color, theme)
    if (fg && fg !== baseFg && fg !== '#000000') s.fg = fg
  }
  const fill = st.fills[xf.fillId]
  if (fill && fill.pattern && fill.pattern !== 'none' && fill.pattern !== 'gray125') { const bg = resolveColor(fill.fg, theme); if (bg) s.bg = bg }
  const bd = st.borders[xf.borderId]
  if (bd) {
    const map: CellBorder = {}
    for (const [side, k] of [['top', 't'], ['right', 'r'], ['bottom', 'b'], ['left', 'l']] as const) {
      const x = bd[side]; if (!x) continue
      const style = (BORDER_IN[x.style] ?? 'thin') as BorderStyle
      const color = resolveColor(x.color, theme)
      const col = color && color !== '#000000' ? color : undefined
      map[k] = { style, ...(col ? { color: col } : {}) }
    }
    if (Object.keys(map).length) s.border = map
  }
  if (xf.align) {
    const h = xf.align.horizontal, v = xf.align.vertical
    if (h === 'left' || h === 'center' || h === 'right') s.align = h
    else if (h === 'centerContinuous') s.align = 'center'
    if (v === 'top' || v === 'bottom') s.valign = v
    else if (v === 'center') s.valign = 'middle'
    if (xf.align.wrapText === '1' || xf.align.wrapText === 'true') s.wrap = true
    const ind = Number(xf.align.indent)
    if (Number.isInteger(ind) && ind >= 1) s.indent = Math.min(INDENT_MAX, ind)
  }
  return Object.keys(s).length ? s : undefined
}

function cfbText(cfb: CfbContainer, path: string): string | null {
  const want = path.replace(/^\/+/, '').toLowerCase()
  const i = cfb.FullPaths.findIndex(p => p.replace(/^[^/]*\//, '').toLowerCase() === want)
  if (i < 0) return null
  const c = cfb.FileIndex[i]?.content
  if (!c) return null
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(c instanceof Uint8Array ? c : Uint8Array.from(c))
}

type SheetPart = { path: string; xml: string; styles: Map<string, number>; vm: Map<string, number> }
/** 每张 sheet 的 xml 路径（照 workbook.xml 的顺序＋rels）＋每格的样式序号＋格内图的 vm 号 */
function sheetParts(cfb: CfbContainer): SheetPart[] {
  const wbXml = cfbText(cfb, 'xl/workbook.xml') ?? ''
  const rels = cfbText(cfb, 'xl/_rels/workbook.xml.rels') ?? ''
  const relMap = new Map<string, string>()
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) { const a = attrs(m[1]); if (a.Id && a.Target) relMap.set(a.Id, a.Target) }
  const out: SheetPart[] = []
  for (const m of section(wbXml, 'sheets').matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1])
    let target = relMap.get(a.id ?? '') ?? ''
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
    const xml = cfbText(cfb, target) ?? ''
    const map = new Map<string, number>()
    const vm = new Map<string, number>()
    for (const c of xml.matchAll(/<(?:\w+:)?c\b([^>]*)>/g)) {
      const ca = attrs(c[1])
      if (ca.r && ca.s && ca.s !== '0') map.set(ca.r.toUpperCase(), Number(ca.s))
      if (ca.r && ca.vm && Number(ca.vm) >= 1) vm.set(ca.r.toUpperCase(), Number(ca.vm))
    }
    out.push({ path: target, xml, styles: map, vm })
  }
  return out
}

// ── 导入图片：drawing 图 ⇒ above·工作表背景图 ⇒ below·格内图（Rich Value）⇒ inCell ──
//   位元组交回调用方（路由）上传到云盘换 URL——本档不碰网络

/** 读回的一张图：image.url 先空着（路由上传后填）；mime 只认 png／jpeg／gif（其余略过计数） */
export type ImportedImage = { sheet: number; image: SheetImage; bytes: Uint8Array; mime: string }

function cfbBytes(cfb: CfbContainer, path: string): Uint8Array | null {
  const want = path.replace(/^\/+/, '').toLowerCase()
  const i = cfb.FullPaths.findIndex(p => p.replace(/^[^/]*\//, '').toLowerCase() === want)
  const c = i < 0 ? undefined : cfb.FileIndex[i]?.content
  return c ? (c instanceof Uint8Array ? c : Uint8Array.from(c)) : null
}
/** 部件内的相对路径 ⇒ 包内绝对路径（处理 ../） */
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg) }
  return parts.join('/')
}
/** 某部件的 rels：Id ⇒ 绝对路径 */
function partRels(cfb: CfbContainer, part: string): Map<string, { type: string; target: string }> {
  const slash = part.lastIndexOf('/')
  const relsPath = `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`
  const out = new Map<string, { type: string; target: string }>()
  for (const m of (cfbText(cfb, relsPath) ?? '').matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1])
    if (a.Id && a.Target && a.TargetMode !== 'External') out.set(a.Id, { type: a.Type ?? '', target: resolvePart(part, a.Target) })
  }
  return out
}
/** 认图：PNG／JPEG／GIF 魔数 ⇒ mime；别的 ⇒ null */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  return null
}
/** 读图的像素宽高（PNG IHDR／GIF 逻辑屏／JPEG SOFn）·读不出 ⇒ null */
export function imagePixelSize(b: Uint8Array): { w: number; h: number } | null {
  const mime = sniffImageMime(b)
  if (mime === 'image/png' && b.length >= 24) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 }
  if (mime === 'image/gif' && b.length >= 10) return { w: b[6] | b[7] << 8, h: b[8] | b[9] << 8 }
  if (mime === 'image/jpeg') {
    let p = 2
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue }
      const mk = b[p + 1]
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { p += 2; continue }
      const len = b[p + 2] << 8 | b[p + 3]
      if ((mk >= 0xc0 && mk <= 0xcf) && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: b[p + 7] << 8 | b[p + 8], h: b[p + 5] << 8 | b[p + 6] }
      p += 2 + len
    }
  }
  return null
}
const clampSide = (n: number) => Math.max(IMAGE_SIDE_MIN, Math.min(IMAGE_SIDE_MAX, Math.round(n)))
const clampOff = (n: number) => Math.max(0, Math.min(IMAGE_SIDE_MAX, Math.round(n)))
const numIn = (xml: string, tag: string) => { const m = new RegExp(`<(?:\\w+:)?${tag}>\\s*(-?\\d+)\\s*</(?:\\w+:)?${tag}>`).exec(xml); return m ? Number(m[1]) : 0 }

/** 格内图：vm 号 ⇒ 图档路径（metadata.xml → rdrichvalue.xml → richValueRel.xml） */
function richImageTargets(cfb: CfbContainer): Map<number, string> {
  const out = new Map<number, string>()
  const wbRels = partRels(cfb, 'xl/workbook.xml')
  const byType = (re: RegExp, fallback: string) => [...wbRels.values()].find(r => re.test(r.type))?.target ?? fallback
  const meta = cfbText(cfb, byType(/\/sheetMetadata$/, 'xl/metadata.xml'))
  if (!meta) return out
  const fut = children(section(meta, 'futureMetadata'), 'bk').map(({ body }) => { const m = /<(?:\w+:)?rvb\b([^>]*)\/?>/.exec(body); return m ? Number(attrs(m[1]).i) : -1 })
  const vals = children(section(meta, 'valueMetadata'), 'bk').map(({ body }) => { const m = /<(?:\w+:)?rc\b([^>]*)\/?>/.exec(body); return m ? Number(attrs(m[1]).v) : -1 })
  const rvXml = cfbText(cfb, byType(/\/rdRichValue$/, 'xl/richData/rdrichvalue.xml')) ?? ''
  const stXml = cfbText(cfb, byType(/\/rdRichValueStructure$/, 'xl/richData/rdrichvaluestructure.xml')) ?? ''
  const relPart = byType(/\/richValueRel$/, 'xl/richData/richValueRel.xml')
  const relXml = cfbText(cfb, relPart) ?? ''
  const structs = children(stXml, 's').map(({ body }) => [...body.matchAll(/<(?:\w+:)?k\b([^>]*)\/?>/g)].map(k => attrs(k[1]).n ?? ''))
  const rvs = children(rvXml, 'rv').map(({ open, body }) => ({ s: Number(attrs(open).s ?? 0), v: [...body.matchAll(/<(?:\w+:)?v\b[^>]*>([^<]*)<\/(?:\w+:)?v>/g)].map(x => x[1]) }))
  const relIds = [...relXml.matchAll(/<(?:\w+:)?rel\b([^>]*)\/?>/g)].map(m => attrs(m[1]).id ?? '')
  const relTargets = partRels(cfb, relPart)
  vals.forEach((fi, i) => {
    const rvIdx = fut[fi]; const rv = rvs[rvIdx]; if (!rv) return
    const keyAt = (structs[rv.s] ?? []).indexOf('_rvRel:LocalImageIdentifier'); if (keyAt < 0) return
    const target = relTargets.get(relIds[Number(rv.v[keyAt])] ?? '')?.target
    if (target) out.set(i + 1, target)
  })
  return out
}

/** 一张 sheet 的图：drawing（twoCell／oneCell／absolute 三种锚·有 pic 的才收）＋背景图＋格内图 */
function importSheetImages(cfb: CfbContainer, si: number, part: SheetPart, content: AgentContent, rich: Map<number, string>, skipped: { n: number }): ImportedImage[] {
  const out: ImportedImage[] = []
  const rels = partRels(cfb, part.path)
  let seq = 0
  const push = (path: string | undefined, img: Omit<SheetImage, 'id' | 'url'>) => {
    if (out.length >= IMAGES_MAX) { skipped.n++; return }
    const bytes = path ? cfbBytes(cfb, path) : null
    const mime = bytes ? sniffImageMime(bytes) : null
    if (!bytes || !mime) { skipped.n++; return }
    out.push({ sheet: si, image: { id: `xlsx_${si}_${++seq}`, url: '', ...img }, bytes, mime })
  }
  const pxW = (c0: number, c1: number) => { let s = 0; for (let c = c0; c < c1; c++) s += colWidthOf(content.colWidths, c); return s }
  const pxH = (r0: number, r1: number) => { let s = 0; for (let r = r0; r < r1; r++) s += rowHeightOf(content.rowHeights, r); return s }
  // 背景图 ⇒ 格子之下（钉在 A1·原图大小·超上限等比缩）
  const bgId = /<(?:\w+:)?picture\b([^>]*)\/?>/.exec(part.xml)
  if (bgId) {
    const path = rels.get(attrs(bgId[1]).id ?? '')?.target
    const bytes = path ? cfbBytes(cfb, path) : null
    const sz = bytes ? imagePixelSize(bytes) : null
    const k = sz ? Math.min(1, IMAGE_SIDE_MAX / Math.max(sz.w, sz.h)) : 1
    push(path, { cell: 'A1', w: clampSide((sz?.w ?? 400) * k), h: clampSide((sz?.h ?? 300) * k), plane: 'below' })
  }
  // drawing ⇒ 格子之上（anchor 顺序＝层次）
  const dr = /<(?:\w+:)?drawing\b([^>]*)\/?>/.exec(part.xml)
  const drPath = dr ? rels.get(attrs(dr[1]).id ?? '')?.target : undefined
  const drXml = drPath ? cfbText(cfb, drPath) ?? '' : ''
  if (drPath && drXml) {
    const drRels = partRels(cfb, drPath)
    for (const m of drXml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
      const kind = m[1], body = m[2]
      if (!/<(?:\w+:)?pic\b/.test(body)) continue   // 图表／形状／文字方块：不收
      const blip = /<(?:\w+:)?blip\b([^>]*)\/?>/.exec(body)
      const path = blip ? drRels.get(attrs(blip[1]).embed ?? '')?.target : undefined
      const ext = /<(?:\w+:)?ext\b([^>]*\bcx=[^>]*)\/?>/.exec(body)
      const extA = ext ? attrs(ext[1]) : {}
      let w = Number(extA.cx) / EMU_PER_PX, h = Number(extA.cy) / EMU_PER_PX
      let cell = 'A1', ox = 0, oy = 0
      if (kind === 'absoluteAnchor') {
        const pos = /<(?:\w+:)?pos\b([^>]*)\/?>/.exec(body); const pa = pos ? attrs(pos[1]) : {}
        ox = Number(pa.x ?? 0) / EMU_PER_PX; oy = Number(pa.y ?? 0) / EMU_PER_PX
      } else {
        const from = section(body, 'from')
        const c = Math.min(MAX_COL_INDEX, numIn(from, 'col')), r = Math.min(MAX_ROW_INDEX, numIn(from, 'row'))
        cell = cellKey(r, c); ox = numIn(from, 'colOff') / EMU_PER_PX; oy = numIn(from, 'rowOff') / EMU_PER_PX
        if (kind === 'twoCellAnchor' && !(w > 0 && h > 0)) {
          const to = section(body, 'to')
          w = pxW(c, numIn(to, 'col')) + numIn(to, 'colOff') / EMU_PER_PX - ox
          h = pxH(r, numIn(to, 'row')) + numIn(to, 'rowOff') / EMU_PER_PX - oy
        }
      }
      if (!(w > 0 && h > 0)) { w = 200; h = 150 }
      const img: Omit<SheetImage, 'id' | 'url'> = { cell, w: clampSide(w), h: clampSide(h) }
      if (clampOff(ox)) img.ox = clampOff(ox)
      if (clampOff(oy)) img.oy = clampOff(oy)
      push(path, img)
    }
  }
  // 格内图（Rich Value）⇒ inCell
  for (const [ref, vm] of part.vm) {
    const path = rich.get(vm); if (!path) continue
    const p = parseRef(ref); if (!p || p.row > MAX_ROW_INDEX || p.col > MAX_COL_INDEX) continue
    push(path, { cell: ref, w: clampSide(colWidthOf(content.colWidths, p.col)), h: clampSide(rowHeightOf(content.rowHeights, p.row)), inCell: true })
  }
  return out
}

export type ImportStats = { sheets: number; cells: number; formulas: number; formulas_not_computable: number; merges: number; styled_cells: number; dropped_cells: number; images?: number }
/** images：读回的图（位元组·url 空）——调用方上传换 URL 后按 sheet 序塞回 content.images（顺序＝层次） */
export type ImportResult = { sheets: WorkbookSheet[]; stats: ImportStats; warnings: string[]; images: ImportedImage[] }

/** CSV 里带四位年＋时间的（2026-10-16 14:30）⇒ 维持 SheetJS 原解析（现况）；别的被猜成日期的改走 valueForInput */
function csvDateTimeKept(text: string): boolean {
  return /\d:\d/.test(text) && parseDateTimeText(text) !== null
}

/**
 * .xlsx（也收 .xls／.csv·那两种只取值不取样式）⇒ 表格档的 sheet 们。
 * formulas：'keep'（预设·公式原文＋Excel 缓存值都存）／'values'（只存算好的值·公式丢掉）。
 */
/** 像纯文字档：开头 4KB 没有 NUL、也不是 UTF-16 BOM（旧版 BIFF .xls、UTF-16 文字交给 SheetJS 自己认） */
function looksLikeText(b: Uint8Array): boolean {
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return false
  for (let i = 0, n = Math.min(b.length, 4096); i < n; i++) if (b[i] === 0) return false
  return true
}
export type LegacyTextEncoding = 'big5' | 'gbk'
/**
 * 文字档位元组 ⇒ 字串：先当 UTF-8（严格·去 BOM）；解坏了 ⇒ 退回 Big5／GBK（严格解得通的才算）。
 * 两种都解得通时：有双位元组的第二位元组落在 0x40–0x7E（Big5 常见、GB2312 没有）⇒ Big5；否则照 prefer（缺省按部署区域：cn ⇒ GBK、其余 ⇒ Big5）。
 * 都解不通 ⇒ 照 UTF-8 宽松解（坏字变 �，不整档拒）。
 */
export function decodeSheetText(b: Uint8Array, prefer?: LegacyTextEncoding): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { /* 不是 UTF-8 ⇒ 往下 */ }
  const ok = (['big5', 'gbk'] as const).filter(e => { try { new TextDecoder(e, { fatal: true }).decode(b); return true } catch { return false } })
  let pick: LegacyTextEncoding | undefined
  if (ok.length === 1) pick = ok[0]
  else if (ok.length === 2) {
    let lowTrail = false
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i] < 0x81) continue
      if (b[i + 1] >= 0x40 && b[i + 1] <= 0x7e) { lowTrail = true; break }
      i++
    }
    pick = lowTrail ? 'big5' : (prefer ?? (envRegion() === 'cn' ? 'gbk' : 'big5'))
  }
  return new TextDecoder(pick ?? 'utf-8').decode(b)
}

/** 读 .xlsx／.xls／.csv：服务端给 Buffer、浏览器给 Uint8Array 都行（同一条解析路）。 */
export function parseXlsx(buf: Uint8Array, opts: { formulas?: 'keep' | 'values' } = {}): ImportResult {
  const readType: 'buffer' | 'array' = typeof Buffer !== 'undefined' && Buffer.isBuffer(buf) ? 'buffer' : 'array'
  if (buf.length > IMPORT_MAX_BYTES) throw new XlsxError(`file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024}MB`, 'err_xlsx_too_large')
  const zipped = isZip(buf)
  if (zipped) zipPreflight(buf)
  // 纯文字档（csv 等）：先自己解成字串再交给 SheetJS（它的 buffer／array 读法遇到没 BOM 的 UTF-8 中文会乱码）
  const isOle = buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0
  const textIn = !zipped && !isOle && looksLikeText(buf) ? decodeSheetText(buf) : null
  const src: Uint8Array | string = textIn ?? buf
  const srcType: 'buffer' | 'array' | 'string' = textIn !== null ? 'string' : readType
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(src, { type: srcType, cellFormula: true, cellNF: true, cellStyles: true, cellDates: false, cellHTML: false, sheetRows: MAX_ROW_INDEX + 1 })
  } catch {
    throw new XlsxError('could not read this spreadsheet file')
  }
  if (!wb.SheetNames.length) throw new XlsxError('the workbook has no sheets')
  // CSV 这类纯文字档·SheetJS 会把「10/16」「1-2」「2026/2/30」都猜成日期（还会时区偏掉）⇒ 再读一份不猜的原文·
  //   被猜成日期的格改照网页打字同一条认（style.ts valueForInput）：带四位年的才是真日期·其余照文字；带时间的维持 SheetJS 原解析（现况）
  let rawWb: XLSX.WorkBook | null = null
  if (!zipped) { try { rawWb = XLSX.read(src, { type: srcType, raw: true, cellDates: false, cellHTML: false, sheetRows: MAX_ROW_INDEX + 1 }) } catch { rawWb = null } }
  if (wb.SheetNames.length > IMPORT_MAX_SHEETS) throw new XlsxError(`too many sheets (${wb.SheetNames.length}; max ${IMPORT_MAX_SHEETS})`, 'err_xlsx_too_large')
  let rawStyles: RawStyles | null = null
  let styleIdx: Array<Map<string, number>> = []
  const theme = (wb as unknown as { Themes?: { themeElements?: { clrScheme?: ThemeColors } } }).Themes?.themeElements?.clrScheme
  let cfb: CfbContainer | null = null
  let parts: SheetPart[] = []
  let condDxfs: CondStyle[] = []   // 条件格式
  let condSkipped = 0
  if (zipped) {
    try {
      cfb = CFB.read(buf, { type: readType })
      parts = sheetParts(cfb)
      const sx = cfbText(cfb, 'xl/styles.xml')
      if (sx) { rawStyles = parseStyles(sx); styleIdx = parts.map(p => p.styles) }
      if (sx) condDxfs = parseDxfs(sx, c => resolveColor(c, theme))   // 条件格式
    } catch { rawStyles = null; cfb = null; parts = [] }
  }
  const images: ImportedImage[] = []
  const imgSkipped = { n: 0 }
  let rich = new Map<number, string>()
  if (cfb) { try { rich = richImageTargets(cfb) } catch { rich = new Map() } }
  const keepFormulas = opts.formulas !== 'values'
  const stats: ImportStats = { sheets: 0, cells: 0, formulas: 0, formulas_not_computable: 0, merges: 0, styled_cells: 0, dropped_cells: 0 }
  const warnings: string[] = []
  const sheets: WorkbookSheet[] = []
  let printNames = new Map<number, { area?: string; titleRows?: string; titleCols?: string }>()   // 列印设定：workbook.xml 的列印范围／标题
  if (cfb) { try { printNames = readPrintDefinedNames(cfbText(cfb, 'xl/workbook.xml') ?? '') } catch { printNames = new Map() } }
  wb.SheetNames.forEach((name, si) => {
    const ws = wb.Sheets[name]
    const rawWs = rawWb && rawWb.SheetNames[si] !== undefined ? rawWb.Sheets[rawWb.SheetNames[si]] : undefined
    const cells: SheetCells = {}
    const sIdx = styleIdx[si]
    const styleCache = new Map<number, CellStyle | undefined>()
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue
      const m = /^([A-Z]{1,3})(\d+)$/.exec(addr); if (!m) continue
      const r = Number(m[2]) - 1, c = colToIndex(m[1])
      if (r > MAX_ROW_INDEX || c > MAX_COL_INDEX) { stats.dropped_cells++; continue }
      const x = ws[addr] as XLSX.CellObject & { f?: string; z?: string | number; w?: string }
      const cached = x.t === 'n' ? (typeof x.v === 'number' && Number.isFinite(x.v) ? String(x.v) : '') : x.t === 'b' ? (x.v ? 'TRUE' : 'FALSE') : x.t === 'e' ? String(x.w ?? '#VALUE!') : x.t === 'z' ? '' : x.v === undefined || x.v === null ? '' : String(x.v)
      const cd: CellData = {}
      if (typeof x.f === 'string' && x.f.trim() && keepFormulas) { cd.f = '=' + fromXlsxFormula(x.f.trim()); if (cached !== '') cd.v = cached; stats.formulas++ }
      else if (cached !== '') cd.v = cached
      let s: CellStyle | undefined
      const xi = sIdx?.get(addr)
      if (rawStyles && xi !== undefined) { if (!styleCache.has(xi)) styleCache.set(xi, styleFromXf(rawStyles, xi, theme)); const hit = styleCache.get(xi); if (hit) s = { ...hit } }
      let nf = typeof x.z === 'string' ? codeToNumFmt(x.z) : undefined
      const rx = rawWs?.[addr] as XLSX.CellObject | undefined
      if (x.t === 'n' && cd.f === undefined && nf && NUMFMT_DATE_KINDS.includes(nf.t) && rx?.t === 's' && typeof rx.v === 'string' && !csvDateTimeKept(rx.v)) {
        const got = valueForInput(rx.v)
        cd.v = got.v
        nf = got.numFmt
      }
      if (nf) s = { ...(s ?? {}), numFmt: nf }
      // Excel 里是「文字」的数字（'5、从别处贴来的文字型数字）⇒ 标文字格式·不然这里当数字算、SUM 跟 Excel 对不上（Excel：引用里的文字型数字 SUM 不算）
      if (x.t === 's' && cd.f === undefined && typeof parseLiteral(cd.v) === 'number' && s?.numFmt?.t !== 'text') s = { ...(s ?? {}), numFmt: { t: 'text' } }
      if (s) { cd.s = s; stats.styled_cells++ }
      if (cd.v === undefined && cd.f === undefined && cd.s === undefined) continue
      cells[cellKey(r, c)] = cd
      if (cd.v !== undefined || cd.f !== undefined) stats.cells++
      if (stats.cells > IMPORT_MAX_CELLS) throw new XlsxError(`too many cells (max ${IMPORT_MAX_CELLS})`, 'err_xlsx_too_large')
    }
    const content: AgentContent = { cells }
    const merges = ((ws['!merges'] ?? []) as XLSX.Range[]).filter(g => g.e.r <= MAX_ROW_INDEX && g.e.c <= MAX_COL_INDEX && (g.s.r !== g.e.r || g.s.c !== g.e.c)).map(g => XLSX.utils.encode_range(g))
    if (merges.length) { content.merges = merges; stats.merges += merges.length }
    const cols = (ws['!cols'] ?? []) as Array<{ width?: number; wpx?: number; hidden?: boolean } | undefined>
    const colWidths: Record<string, number> = {}
    cols.forEach((col, i) => { if (!col || i > MAX_COL_INDEX) return; const px = typeof col.width === 'number' ? colWidthToPx(col.width) : col.wpx; if (typeof px === 'number' && px > 0) colWidths[indexToCol(i)] = px })
    const hidCols = cols.map((col, i) => (col?.hidden && i <= MAX_COL_INDEX ? i : -1)).filter(i => i >= 0)
    if (hidCols.length) content.hiddenCols = hidCols
    if (Object.keys(colWidths).length) content.colWidths = colWidths
    const rows = (ws['!rows'] ?? []) as Array<{ hpt?: number; hpx?: number; hidden?: boolean } | undefined>
    const rowHeights: Record<string, number> = {}
    rows.forEach((row, i) => { if (!row || i > MAX_ROW_INDEX) return; const px = typeof row.hpt === 'number' ? Math.round(row.hpt * 4 / 3) : row.hpx; if (typeof px === 'number' && px > 0) rowHeights[String(i + 1)] = px })
    if (Object.keys(rowHeights).length) content.rowHeights = rowHeights
    // 条件格式：认得的规则读回来·认不得的计数跳过（不崩）
    if (parts[si]) { try { const cf = parseCondFormatting(parts[si].xml, condDxfs, c => resolveColor(c, theme)); if (cf.rules.length) content.condFormats = cf.rules; condSkipped += cf.skipped } catch { condSkipped++ } }
    if (cfb && parts[si]) {
      try {
        const got = importSheetImages(cfb, si, parts[si], content, rich, imgSkipped)
        for (const g of got) if (g.image.inCell) { const cd = cells[g.image.cell]; if (cd && !cd.f && cd.v === '#VALUE!') { delete cd.v; if (!cd.s) delete cells[g.image.cell] } }   // 格内图那格的 #VALUE! 是占位·不当值
        images.push(...got)
      } catch { imgSkipped.n++ }
    }
    // 冻结筛选验证：冻结 pane／autoFilter／list 型资料验证读回来（工作表 XML 里那三段）
    if (parts[si]?.xml) { try { const v = readSheetViewXml(parts[si].xml); Object.assign(content, v.view); warnings.push(...viewImportWarnings(name, v.skipped)) } catch { /* 读不懂就略过·值照收 */ } }
    // 手动隐藏的行：xlsx 里 hidden 的行扣掉被筛选藏的（那些清了筛选要放出来）
    {
      const filtered = filteredRows(content as ViewContent)
      const hidRows = rows.map((row, i) => (row?.hidden && i <= MAX_ROW_INDEX && !filtered.has(i) ? i : -1)).filter(i => i >= 0)
      if (hidRows.length) content.hiddenRows = hidRows
    }
    // 列印设定：纸张方向缩放边界列印选项页首页尾＋列印范围标题
    if (parts[si]?.xml) { try { const pr = readPrintXml(parts[si].xml, printNames.get(si)); if (pr) content.print = pr } catch { /* 读不懂就略过 */ } }
    sheets.push({ name, content })
    stats.sheets++
  })
  // 页签名照网页规则归一（连续空白折成一个）·公式里的跨表引用跟着换（名字没变的不动）
  const fixed = sheets.map(s => normalizeSheetName(s.name) || s.name)
  sheets.forEach((s, i) => {
    if (fixed[i] === s.name) return
    for (const t of sheets) { const c = renameSheetInContent(t.content, s.name, fixed[i]); if (c) t.content = c }
    s.name = fixed[i]
  })
  // 算不出的公式计数：整份文件读完才算（跨表引用要别张）
  if (keepFormulas && stats.formulas) {
    const book = new SheetBook(sheets)
    for (const s of sheets) {
      const ev = new SheetEvaluator(s.content.cells ?? {}, s.content.merges, { book, sheetName: s.name })
      for (const [k, cd] of Object.entries(s.content.cells ?? {})) {
        if (!cd.f) continue
        const got = ev.value(k)
        if (isFormulaError(got) && !(cd.v && isFormulaError(cd.v))) stats.formulas_not_computable++
      }
    }
  }
  if (images.length) stats.images = images.length
  if (imgSkipped.n) warnings.push(`${imgSkipped.n} picture(s) could not be read (unsupported format such as EMF/WMF/BMP, or too many) and were skipped.`)
  if (stats.dropped_cells) warnings.push(`${stats.dropped_cells} cell(s) beyond ${indexToCol(MAX_COL_INDEX)}${MAX_ROW_INDEX + 1} were skipped.`)
  if (stats.formulas_not_computable) warnings.push(`${stats.formulas_not_computable} formula(s) use functions or references this editor can't compute yet (they show an error in the web editor; their last Excel values were kept and are used when exporting). Re-import with formulas:"values" to keep plain values instead.`)
  if (condSkipped) warnings.push(`${condSkipped} conditional formatting rule(s) of a kind this editor doesn't support (formula-based, icon sets, dates, rules that refer to other cells…) were skipped.`)   // 条件格式
  if (!zipped) warnings.push('this is not an .xlsx file, so only values, formulas and number formats were imported (no fonts/colors/borders).')
  return { sheets, stats, warnings, images }
}
