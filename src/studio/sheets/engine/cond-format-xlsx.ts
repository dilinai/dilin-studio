// 条件格式 ⇄ .xlsx
//   照 ECMA-376 Part 1 §18.3.1.18 conditionalFormatting／§18.3.1.10 cfRule／§18.8.17 dxf 手写（同 xlsx-io.ts 的做法·不加依赖）：
//     工作表：<conditionalFormatting sqref="D2:D30 F2:F30"><cfRule type=… priority=… dxfId=…>…</cfRule></conditionalFormatting>
//       （位置在 mergeCells 之后、dataValidations／drawing 之前——xlsx-io.ts sheetXml 里接）
//     样式表：<dxfs> 里每条一个 <dxf>（字：b／i／strike／u／color·底：patternFill 的 bgColor——dxf 的实心底色写 bgColor 是 Excel 自己存的写法）
//   每条规则一个 conditionalFormatting（priority＝清单顺序＋1）。色阶 colorScale（cfvo min／percentile 50／max）、数据条 dataBar（cfvo min／max·Excel 2007 形）都原生。
//   导入：认 cellIs（数字或 "文字" 常数）、top10、aboveAverage（不含 stdDev）、duplicateValues／uniqueValues、containsText、
//     colorScale（min／[percentile 50]／max）、dataBar；别的（expression 公式型、beginsWith、iconSet、timePeriod、引用别格的 cellIs…）跳过计数·不崩。
//   ⛔ 不碰库、不碰网络、不 import xlsx-io（那边 import 本档）。

import { cellKey } from './formula'
import { sanitizeCondFormats, parseSeg, type CondRule, type CondStyle, type CellIsType } from './cond-format'

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g   // eslint-disable-line no-control-regex
const esc = (s: string) => s.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase()
const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const re = /([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].replace(/^\w+:/, '')] = unesc(m[2] ?? m[3] ?? '')
  return out
}

const CELLIS_OP: Record<CellIsType, string> = {
  greater: 'greaterThan', greater_equal: 'greaterThanOrEqual', less: 'lessThan', less_equal: 'lessThanOrEqual',
  equal: 'equal', not_equal: 'notEqual', between: 'between', not_between: 'notBetween',
}
const OP_CELLIS = Object.fromEntries(Object.entries(CELLIS_OP).map(([k, v]) => [v, k])) as Record<string, CellIsType>

/** 规则的比较值 ⇒ 公式常数（数字照写·文字加引号、内含引号成对） */
const constFormula = (v: number | string) => (typeof v === 'number' ? String(v).toUpperCase() : `"${v.replace(/"/g, '""')}"`)

/** 一份命中格式 ⇒ <dxf> */
export function dxfXml(s: CondStyle | undefined): string {
  if (!s) return '<dxf/>'
  const font = [s.b ? '<b/>' : '', s.i ? '<i/>' : '', s.s ? '<strike/>' : '', s.u ? '<u/>' : '', s.fg ? `<color rgb="${argb(s.fg)}"/>` : ''].join('')
  const fill = s.bg ? `<fill><patternFill><bgColor rgb="${argb(s.bg)}"/></patternFill></fill>` : ''
  return `<dxf>${font ? `<font>${font}</font>` : ''}${fill}</dxf>`
}

/** 一张 sheet 的 <conditionalFormatting>…（没规则 ⇒ ''）；dxf(xml) ＝样式表登记一个 dxf 回它的序号 */
export function condFormatSheetXml(rules: CondRule[] | undefined, dxf: (xml: string) => number): string {
  if (!Array.isArray(rules) || !rules.length) return ''
  return rules.map((r, i) => {
    const sqref = r.ranges.join(' ')
    const pri = ` priority="${i + 1}"`
    const stop = r.stop ? ' stopIfTrue="1"' : ''
    const dx = () => ` dxfId="${dxf(dxfXml(r.style))}"`
    let body: string
    if (r.type in CELLIS_OP) {
      const two = r.type === 'between' || r.type === 'not_between'
      body = `<cfRule type="cellIs"${dx()}${pri}${stop} operator="${CELLIS_OP[r.type as CellIsType]}"><formula>${esc(constFormula(r.value ?? 0))}</formula>${two ? `<formula>${esc(constFormula(r.value2 ?? 0))}</formula>` : ''}</cfRule>`
    } else if (r.type === 'top' || r.type === 'bottom') {
      body = `<cfRule type="top10"${dx()}${pri}${stop}${r.percent ? ' percent="1"' : ''}${r.type === 'bottom' ? ' bottom="1"' : ''} rank="${r.n ?? 10}"/>`
    } else if (r.type === 'above_average' || r.type === 'below_average') {
      body = `<cfRule type="aboveAverage"${dx()}${pri}${stop}${r.type === 'below_average' ? ' aboveAverage="0"' : ''}${r.equal ? ' equalAverage="1"' : ''}/>`
    } else if (r.type === 'duplicate' || r.type === 'unique') {
      body = `<cfRule type="${r.type === 'duplicate' ? 'duplicateValues' : 'uniqueValues'}"${dx()}${pri}${stop}/>`
    } else if (r.type === 'text_contains') {
      // Excel 自己存的样子：text 属性＋一条 SEARCH 公式（相对引用＝第一段的左上格）
      const tl = parseSeg(r.ranges[0])
      const ref = tl ? cellKey(tl.r0, tl.c0) : 'A1'
      const t = r.text ?? ''
      body = `<cfRule type="containsText"${dx()}${pri}${stop} operator="containsText" text="${esc(t)}"><formula>${esc(`NOT(ISERROR(SEARCH("${t.replace(/"/g, '""')}",${ref})))`)}</formula></cfRule>`
    } else if (r.type === 'color_scale') {
      const cs = r.colors ?? []
      const cfvo = cs.length === 3 ? '<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>' : '<cfvo type="min"/><cfvo type="max"/>'
      body = `<cfRule type="colorScale"${pri}><colorScale>${cfvo}${cs.map(c => `<color rgb="${argb(c)}"/>`).join('')}</colorScale></cfRule>`
    } else if (r.type === 'data_bar') {
      body = `<cfRule type="dataBar"${pri}><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb((r.colors ?? ['#638ec6'])[0])}"/></dataBar></cfRule>`
    } else return ''
    return `<conditionalFormatting sqref="${esc(sqref)}">${body}</conditionalFormatting>`
  }).join('')
}

// ── 导入 ──────────────────────────────────────────────────────────────────

/** 颜色栏（同 xlsx-io colorIn 的形：rgb 取后 6 位小写） */
export type CfColorRaw = { rgb?: string; theme?: number; tint?: number; indexed?: number; auto?: boolean }
type ColorResolver = (c: CfColorRaw | undefined) => string | undefined
const colorAttr = (body: string, tag: string): CfColorRaw | undefined => {
  const m = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)/?>`).exec(body)
  if (!m) return undefined
  const a = attrs(m[1])
  return { ...(a.rgb ? { rgb: a.rgb.slice(-6).toLowerCase() } : {}), ...(a.theme !== undefined ? { theme: Number(a.theme) } : {}), ...(a.tint !== undefined ? { tint: Number(a.tint) } : {}), ...(a.indexed !== undefined ? { indexed: Number(a.indexed) } : {}), ...(a.auto === '1' || a.auto === 'true' ? { auto: true } : {}) }
}
const has = (body: string, tag: string) => { const m = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)/?>`).exec(body); if (!m) return false; const v = attrs(m[1]).val; return v === undefined || !(v === '0' || v === 'false' || v === 'none') }

/** styles.xml 的 <dxfs> ⇒ 命中格式（序号＝dxfId） */
export function parseDxfs(stylesXml: string, color: ColorResolver): CondStyle[] {
  const sec = /<(?:\w+:)?dxfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?dxfs>/.exec(stylesXml)?.[1] ?? ''
  const out: CondStyle[] = []
  for (const m of sec.matchAll(/<(?:\w+:)?dxf\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?dxf>)/g)) {
    const body = m[1] ?? ''
    const s: CondStyle = {}
    const font = /<(?:\w+:)?font\b[^>]*>([\s\S]*?)<\/(?:\w+:)?font>/.exec(body)?.[1]
    if (font) {
      if (has(font, 'b')) s.b = true
      if (has(font, 'i')) s.i = true
      if (has(font, 'strike')) s.s = true
      if (has(font, 'u')) s.u = true
      const fg = color(colorAttr(font, 'color')); if (fg) s.fg = fg
    }
    const fill = /<(?:\w+:)?fill\b[^>]*>([\s\S]*?)<\/(?:\w+:)?fill>/.exec(body)?.[1]
    if (fill) { const bg = color(colorAttr(fill, 'bgColor')) ?? color(colorAttr(fill, 'fgColor')); if (bg) s.bg = bg }
    out.push(s)
  }
  return out
}

/** Excel 列上限 1048576 行 ⇒ 本编辑器 999999 行（整列 E1:E1048576 收成 E1:E999999＝整列） */
const clampSeg = (s: string) => s.replace(/\d+/g, d => String(Math.min(Number(d), 999999)))
const formulaConst = (f: string | undefined): number | string | undefined => {
  if (f === undefined) return undefined
  const s = unesc(f).trim()
  if (/^[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?$/i.test(s)) return Number(s)
  const m = /^"((?:[^"]|"")*)"$/.exec(s)
  return m ? m[1].replace(/""/g, '"') : undefined   // 引用别格／运算式 ⇒ 认不得
}

/** 一张工作表 xml 的条件格式 ⇒ 规则（照 priority 排）；认不得的计 skipped */
export function parseCondFormatting(sheetXml: string, dxfs: CondStyle[], color: ColorResolver): { rules: CondRule[]; skipped: number } {
  const found: Array<{ pri: number; rule: Record<string, unknown> }> = []
  let skipped = 0, n = 0
  // 只认主命名空间的（不带前缀）·x14:conditionalFormatting（extLst 里的 Excel 2010 扩充）不收
  for (const cf of sheetXml.matchAll(/<conditionalFormatting\b([^>]*)>([\s\S]*?)<\/conditionalFormatting>/g)) {
    const sq = attrs(cf[1]).sqref ?? ''
    const ranges = sq.split(/\s+/).filter(Boolean).map(clampSeg)
    for (const m of cf[2].matchAll(/<cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/g)) {
      const a = attrs(m[1]), body = m[2] ?? ''
      const formulas = [...body.matchAll(/<formula>([\s\S]*?)<\/formula>/g)].map(x => x[1])
      const style = a.dxfId !== undefined ? dxfs[Number(a.dxfId)] : undefined
      const base = { id: `xlsx_cf_${++n}`, ranges, ...(style && Object.keys(style).length ? { style } : {}), ...(a.stopIfTrue === '1' || a.stopIfTrue === 'true' ? { stop: true } : {}) }
      const pri = Number(a.priority ?? 1e9)
      let rule: Record<string, unknown> | null = null
      switch (a.type) {
        case 'cellIs': {
          const t = OP_CELLIS[a.operator ?? '']
          const v1 = formulaConst(formulas[0]), v2 = formulaConst(formulas[1])
          if (!t || v1 === undefined || ((t === 'between' || t === 'not_between') && v2 === undefined)) break
          rule = { ...base, type: t, value: v1, ...(v2 !== undefined && (t === 'between' || t === 'not_between') ? { value2: v2 } : {}) }
          break
        }
        case 'top10': {
          const pct = a.percent === '1' || a.percent === 'true'
          rule = { ...base, type: a.bottom === '1' || a.bottom === 'true' ? 'bottom' : 'top', n: Number(a.rank ?? 10), ...(pct ? { percent: true } : {}) }
          break
        }
        case 'aboveAverage': {
          if (a.stdDev) break
          rule = { ...base, type: a.aboveAverage === '0' || a.aboveAverage === 'false' ? 'below_average' : 'above_average', ...(a.equalAverage === '1' || a.equalAverage === 'true' ? { equal: true } : {}) }
          break
        }
        case 'duplicateValues': rule = { ...base, type: 'duplicate' }; break
        case 'uniqueValues': rule = { ...base, type: 'unique' }; break
        case 'containsText': {
          if (a.operator && a.operator !== 'containsText') break
          if (a.text) rule = { ...base, type: 'text_contains', text: a.text }
          break
        }
        case 'colorScale': {
          const cfvo = [...body.matchAll(/<(?:\w+:)?cfvo\b([^>]*)\/?>/g)].map(x => attrs(x[1]))
          const cols = [...body.matchAll(/<(?:\w+:)?color\b([^>]*)\/?>/g)].map(x => color(colorAttr(x[0], 'color')))
          const okShape = cfvo.length === cols.length && cfvo[0]?.type === 'min' && cfvo[cfvo.length - 1]?.type === 'max'
            && (cfvo.length === 2 || (cfvo.length === 3 && cfvo[1].type === 'percentile' && Number(cfvo[1].val) === 50))
          if (okShape && cols.every(Boolean)) rule = { id: base.id, ranges, type: 'color_scale', colors: cols }
          break
        }
        case 'dataBar': {
          const c = color(colorAttr(body, 'color'))
          if (c) rule = { id: base.id, ranges, type: 'data_bar', colors: [c] }
          break
        }
      }
      if (rule) found.push({ pri, rule }); else skipped++
    }
  }
  found.sort((x, y) => x.pri - y.pri)
  const rules = sanitizeCondFormats(found.map(f => f.rule))
  return { rules, skipped: skipped + (found.length - rules.length) }
}
