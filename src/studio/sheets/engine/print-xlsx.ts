// 列印设定 ⇄ .xlsx（工作表 XML 的 printOptions／pageMargins／pageSetup／headerFooter＋sheetPr 的 fitToPage＋workbook 的列印范围／列印标题定义名）
//   xlsx-io.ts 的 sheetXml／buildXlsxBytes／parseXlsx 各一行调用本档（⛔ 本档不碰 zip）。元素照 ECMA-376 Part 1：
//     sheetPr＞pageSetUpPr fitToPage（§18.3.1.65）——sheetPr 是 worksheet 第一个子元素
//     printOptions（§18.3.1.70）→ pageMargins（§18.3.1.62·英寸）→ pageSetup（§18.3.1.63）→ headerFooter（§18.3.1.46）——排在 dataValidations／hyperlinks 之后、drawing 之前
//     _xlnm.Print_Area／_xlnm.Print_Titles 定义名（§18.2.5·localSheetId＝第几张）
//   对照：
//     paper      Letter 1｜Legal 5｜A3 8｜A4 9｜B5(JIS) 13
//     scaleMode  none ⇒ 不写 scale｜custom ⇒ scale｜fitSheet ⇒ fitToPage＋1×1｜fitCols ⇒ 1×0｜fitRows ⇒ 0×1
//     页首页尾   &L／&C／&R 三段；sheet＝&A·title＝&F·date＝&D·page＝&P / &N
//     scope      range ⇒ Print_Area；sheet／selection ⇒ 不写（Excel 没有「目前选取」可存）
import { parseRect } from './sheet-view'
import {
  sanitizePrint, parseRowSpan, parseColSpan, rowSpanText, colSpanText,
  type SheetPrint, type PaperId, type HFSlots, type HFItem,
} from './print'

// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const esc = (s: string) => s.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const re = /([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].replace(/^\w+:/, '')] = unesc(m[2] ?? m[3] ?? '')
  return out
}
const truthy = (v: string | undefined) => v === '1' || v === 'true'

export const PAPER_XLSX: Record<PaperId, number> = { Letter: 1, Legal: 5, A3: 8, A4: 9, B5: 13 }
const PAPER_FROM_XLSX: Record<number, PaperId> = { 1: 'Letter', 5: 'Legal', 8: 'A3', 9: 'A4', 13: 'B5' }
const HF_CODE: Record<HFItem, string> = { sheet: '&A', title: '&F', date: '&D', page: '&P / &N' }
const inch = (cm: number) => Math.round(cm / 2.54 * 10000) / 10000
const cm = (inches: number) => Math.round(inches * 2.54 * 100) / 100

// ── 导出 ──────────────────────────────────────────────────────────────────

export type PrintXml = { sheetPr: string; tail: string }

function hfXml(s: HFSlots): string {
  return (['l', 'c', 'r'] as const).filter(k => s[k]).map(k => `&${k.toUpperCase()}${HF_CODE[s[k]!]}`).join('')
}

/** 一张 sheet 的列印 XML：sheetPr（要塞进 worksheet 开头）＋尾段（printOptions…headerFooter）·没设过列印 ⇒ 两段都空 */
export function printXmlParts(content: { print?: unknown }): PrintXml {
  const p = content.print === undefined ? undefined : sanitizePrint(content.print)
  if (!p) return { sheetPr: '', tail: '' }
  const fit = p.scaleMode === 'fitSheet' || p.scaleMode === 'fitCols' || p.scaleMode === 'fitRows'
  const sheetPr = fit ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''
  const po = [p.hCenter ? 'horizontalCentered="1"' : '', p.vCenter ? 'verticalCentered="1"' : '', p.headings ? 'headings="1"' : '', p.gridlines ? 'gridLines="1"' : ''].filter(Boolean)
  const m = p.margins
  const setup = [`paperSize="${PAPER_XLSX[p.paper]}"`]
  if (p.scaleMode === 'custom') setup.push(`scale="${p.scale}"`)
  if (fit) setup.push(`fitToWidth="${p.scaleMode === 'fitRows' ? 0 : 1}"`, `fitToHeight="${p.scaleMode === 'fitCols' ? 0 : 1}"`)
  setup.push(`orientation="${p.orientation}"`)
  const head = hfXml(p.header), foot = hfXml(p.footer)
  const tail =
    (po.length ? `<printOptions ${po.join(' ')}/>` : '') +
    `<pageMargins left="${inch(m.left)}" right="${inch(m.right)}" top="${inch(m.top)}" bottom="${inch(m.bottom)}" header="${inch(m.header)}" footer="${inch(m.footer)}"/>` +
    `<pageSetup ${setup.join(' ')}/>` +
    (head || foot ? `<headerFooter>${head ? `<oddHeader>${esc(head)}</oddHeader>` : ''}${foot ? `<oddFooter>${esc(foot)}</oddFooter>` : ''}</headerFooter>` : '')
  return { sheetPr, tail }
}

const absArea = (a1: string) => a1.split(':').map(p => p.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':')
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`

/** workbook.xml 定义名（不含外层 <definedNames>）：每张有列印范围／标题的 sheet 各一两条 */
export function printDefinedNames(items: Array<{ sheetName: string; index: number; content: { print?: unknown } }>): string {
  const out: string[] = []
  for (const x of items) {
    const p = x.content.print === undefined ? undefined : sanitizePrint(x.content.print)
    if (!p) continue
    const q = quoteSheet(x.sheetName)
    if (p.scope === 'range' && p.range) out.push(`<definedName name="_xlnm.Print_Area" localSheetId="${x.index}">${esc(`${q}!${absArea(p.range)}`)}</definedName>`)
    const tc = parseColSpan(p.titleCols), tr = parseRowSpan(p.titleRows)
    const parts: string[] = []
    if (tc) parts.push(`${q}!${colSpanText(tc).replace(/([A-Z]+)/g, '$$$1')}`)
    if (tr) parts.push(`${q}!${rowSpanText(tr).replace(/(\d+)/g, '$$$1')}`)
    if (parts.length) out.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${x.index}">${esc(parts.join(','))}</definedName>`)
  }
  return out.join('')
}

/** 把几段 <definedNames>…</definedNames> 或裸 <definedName> 并成一个 <definedNames>（都空 ⇒ ''） */
export function mergeDefinedNames(...parts: string[]): string {
  const inner = parts.map(s => s.replace(/^<definedNames>/, '').replace(/<\/definedNames>$/, '')).join('')
  return inner ? `<definedNames>${inner}</definedNames>` : ''
}

// ── 导入 ──────────────────────────────────────────────────────────────────

/** workbook.xml ⇒ 第几张 sheet 的列印范围／标题（原文·未净化） */
export function readPrintDefinedNames(wbXml: string): Map<number, { area?: string; titleRows?: string; titleCols?: string }> {
  const out = new Map<number, { area?: string; titleRows?: string; titleCols?: string }>()
  for (const m of wbXml.matchAll(/<(?:\w+:)?definedName\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?definedName>/g)) {
    const a = attrs(m[1])
    const idx = Number(a.localSheetId)
    if (!Number.isInteger(idx) || idx < 0) continue
    const body = unesc(m[2]).trim()
    const cur = out.get(idx) ?? {}
    if (a.name === '_xlnm.Print_Area') {
      const first = body.split(',')[0] ?? ''
      const ref = first.replace(/^.*!/, '').replace(/\$/g, '')
      if (parseRect(ref)) cur.area = ref
    } else if (a.name === '_xlnm.Print_Titles') {
      for (const part of body.split(',')) {
        const ref = part.replace(/^.*!/, '').replace(/\$/g, '').trim()
        if (/^\d+(:\d+)?$/.test(ref)) cur.titleRows = ref
        else if (/^[A-Za-z]+(:[A-Za-z]+)?$/.test(ref)) cur.titleCols = ref
      }
    } else continue
    out.set(idx, cur)
  }
  return out
}

function slotsFromHF(code: string): HFSlots {
  const out: HFSlots = {}
  // 拆 &L／&C／&R 三段（没段落码 ⇒ 当中间）
  const segs: Record<'l' | 'c' | 'r', string> = { l: '', c: '', r: '' }
  let cur: 'l' | 'c' | 'r' = 'c'
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '&' && i + 1 < code.length) {
      const k = code[i + 1].toUpperCase()
      if (k === 'L' || k === 'C' || k === 'R') { cur = k.toLowerCase() as 'l' | 'c' | 'r'; i++; continue }
      if (k === '&') { segs[cur] += '&&'; i++; continue }
    }
    segs[cur] += code[i]
  }
  for (const k of ['l', 'c', 'r'] as const) {
    const s = segs[k]
    if (/&[Pp]/.test(s)) out[k] = 'page'
    else if (/&[Aa]/.test(s)) out[k] = 'sheet'
    else if (/&[Ff]/.test(s)) out[k] = 'title'
    else if (/&[Dd]/.test(s)) out[k] = 'date'
  }
  return out
}

/** 工作表 XML（＋该张的定义名）⇒ 列印设定（净化过）·什么都没有 ⇒ undefined */
export function readPrintXml(xml: string, names?: { area?: string; titleRows?: string; titleCols?: string }): SheetPrint | undefined {
  const raw: Record<string, unknown> = {}
  let any = false
  const ps = /<(?:\w+:)?pageSetup\b([^>]*)\/?>/.exec(xml)
  const fitPr = /<(?:\w+:)?pageSetUpPr\b([^>]*)\/?>/.exec(xml)
  const fitToPage = fitPr ? truthy(attrs(fitPr[1]).fitToPage) : false
  if (ps) {
    any = true
    const a = attrs(ps[1])
    const paper = PAPER_FROM_XLSX[Number(a.paperSize ?? 9)]
    if (paper) raw.paper = paper
    if (a.orientation === 'landscape' || a.orientation === 'portrait') raw.orientation = a.orientation
    if (fitToPage) {
      const fw = Number(a.fitToWidth ?? 1), fh = Number(a.fitToHeight ?? 1)
      raw.scaleMode = fw >= 1 && fh >= 1 ? 'fitSheet' : fw >= 1 ? 'fitCols' : fh >= 1 ? 'fitRows' : 'none'
    } else if (a.scale !== undefined && Number(a.scale) !== 100) { raw.scaleMode = 'custom'; raw.scale = Number(a.scale) }
  } else if (fitToPage) { any = true; raw.scaleMode = 'fitSheet' }
  const pm = /<(?:\w+:)?pageMargins\b([^>]*)\/?>/.exec(xml)
  if (pm) {
    const a = attrs(pm[1])
    const margins: Record<string, number> = {}
    for (const k of ['top', 'bottom', 'left', 'right', 'header', 'footer'] as const) { const v = Number(a[k]); if (Number.isFinite(v)) margins[k] = cm(v) }
    raw.margins = margins
    raw.marginPreset = presetOf(margins)
    // pageMargins 是 Excel 每份档都写的段 ⇒ 只有不是「标准」才算设过列印
    if (raw.marginPreset !== 'normal') any = true
  }
  const po = /<(?:\w+:)?printOptions\b([^>]*)\/?>/.exec(xml)
  if (po) {
    const a = attrs(po[1])
    raw.gridlines = truthy(a.gridLines); raw.headings = truthy(a.headings); raw.hCenter = truthy(a.horizontalCentered); raw.vCenter = truthy(a.verticalCentered)
    if (raw.gridlines || raw.headings || raw.hCenter || raw.vCenter) any = true
  }
  const oh = /<(?:\w+:)?oddHeader>([\s\S]*?)<\/(?:\w+:)?oddHeader>/.exec(xml)
  const of = /<(?:\w+:)?oddFooter>([\s\S]*?)<\/(?:\w+:)?oddFooter>/.exec(xml)
  if (oh) { raw.header = slotsFromHF(unesc(oh[1])); any = true }
  if (of) { raw.footer = slotsFromHF(unesc(of[1])); any = true }
  if (names?.area) { raw.scope = 'range'; raw.range = names.area; any = true }
  if (names?.titleRows) { raw.titleRows = names.titleRows; any = true }
  if (names?.titleCols) { raw.titleCols = names.titleCols; any = true }
  return any ? sanitizePrint(raw) : undefined
}

function presetOf(m: Record<string, number>): SheetPrint['marginPreset'] {
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.02
  const presets: Array<[SheetPrint['marginPreset'], Record<string, number>]> = [
    ['normal', { top: 1.91, bottom: 1.91, left: 1.78, right: 1.78 }],
    ['narrow', { top: 1.91, bottom: 1.91, left: 0.64, right: 0.64 }],
    ['wide', { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 }],
  ]
  for (const [id, v] of presets) if (Object.entries(v).every(([k, x]) => near(m[k], x))) {
    // 页首页尾距离也要对得上（Excel 预设各自的 header／footer）才算预设
    const hf = id === 'wide' ? 1.27 : 0.76
    if (near(m.header, hf) && near(m.footer, hf)) return id
  }
  return 'custom'
}
