// 冻结窗格／筛选／下拉清单 ⇄ .xlsx 工作表 XML
//   xlsx-io.ts 的 sheetXml／parseXlsx 各一行调用本档（⛔ 本档不碰 zip）。元素照 ECMA-376 Part 1：
//     冻结＝<sheetViews><sheetView><pane xSplit ySplit topLeftCell activePane state="frozen"/>（§18.3.1.66）——sheetViews 排在 sheetFormatPr／cols／sheetData 之前
//     筛选＝<autoFilter ref><filterColumn colId><filters>|<customFilters>（§18.3.2）——排在 sheetData 之后、mergeCells 之前；被筛掉的行 <row hidden="1">
//          ＋workbook.xml 的 _xlnm._FilterDatabase 定义名（Excel 自己存档也写·LibreOffice 认它建筛选区）
//     下拉＝<dataValidations><dataValidation type="list" sqref><formula1>（§18.3.1.32）——排在 conditionalFormatting 之后、hyperlinks／drawing 之前
//   清单直接写进 formula1 时 Excel 上限 255 字（含逗号）——sheet-view 的净化与 AI 工具已先卡住。
import { cellKey, colToIndex, indexToCol } from './formula'
import { parseRect, rectA1, filterRect, filteredRows, sanitizeFreeze, sanitizeFilter, sanitizeValidations, cleanListItems, type ViewContent, type FilterCriterion, type FilterCondition, type SheetViewState, type SheetValidation } from './sheet-view'

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
/** 区间 ⇒ 绝对引用 $A$1:$B$5 */
const absRef = (a1: string) => a1.split(':').map(p => p.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':')

// ── 导出 ──────────────────────────────────────────────────────────────────

export type SheetViewXml = { sheetViews: string; autoFilter: string; dataValidations: string; hidden: Set<number>; filterRef: string | null }

function paneXml(rows: number, cols: number): string {
  if (rows && cols) return `<pane xSplit="${cols}" ySplit="${rows}" topLeftCell="${cellKey(rows, cols)}" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${cellKey(rows, cols)}" sqref="${cellKey(rows, cols)}"/>`
  if (rows) return `<pane ySplit="${rows}" topLeftCell="${cellKey(rows, 0)}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${cellKey(rows, 0)}" sqref="${cellKey(rows, 0)}"/>`
  return `<pane xSplit="${cols}" topLeftCell="${cellKey(0, cols)}" activePane="topRight" state="frozen"/><selection pane="topRight" activeCell="${cellKey(0, cols)}" sqref="${cellKey(0, cols)}"/>`
}

/** 筛选值写进 customFilter：Excel 的 * ? ~ 是万用字·字面要加 ~ */
const wild = (s: string) => s.replace(/[~*?]/g, m => `~${m}`)
const OP_XML: Partial<Record<FilterCondition['op'], string>> = { neq: 'notEqual', gt: 'greaterThan', gte: 'greaterThanOrEqual', lt: 'lessThan', lte: 'lessThanOrEqual' }
const cf = (val: string, op?: string) => `<customFilter${op ? ` operator="${op}"` : ''} val="${esc(val)}"/>`
function criterionXml(c: FilterCriterion): string {
  if ('values' in c) {
    const blank = c.values.some(v => v.trim() === '')
    const vals = c.values.filter(v => v.trim() !== '')
    return `<filters${blank ? ' blank="1"' : ''}>${vals.map(v => `<filter val="${esc(v)}"/>`).join('')}</filters>`
  }
  const { op, value = '', value2 = '' } = c.condition
  switch (op) {
    case 'empty': return '<filters blank="1"/>'
    case 'not_empty': return `<customFilters>${cf(' ', 'notEqual')}</customFilters>`
    case 'eq': return `<customFilters>${cf(wild(value))}</customFilters>`
    case 'contains': return `<customFilters>${cf(`*${wild(value)}*`)}</customFilters>`
    case 'not_contains': return `<customFilters>${cf(`*${wild(value)}*`, 'notEqual')}</customFilters>`
    case 'begins_with': return `<customFilters>${cf(`${wild(value)}*`)}</customFilters>`
    case 'ends_with': return `<customFilters>${cf(`*${wild(value)}`)}</customFilters>`
    case 'between': return `<customFilters and="1">${cf(value, 'greaterThanOrEqual')}${cf(value2, 'lessThanOrEqual')}</customFilters>`
    case 'not_between': return `<customFilters>${cf(value, 'lessThan')}${cf(value2, 'greaterThan')}</customFilters>`
    case 'neq': return `<customFilters>${cf(wild(value), 'notEqual')}</customFilters>`
    default: return `<customFilters>${cf(value, OP_XML[op])}</customFilters>`
  }
}

function validationXml(v: SheetValidation): string {
  const f1 = v.list ? `"${v.list.map(x => x.replace(/"/g, '""')).join(',')}"` : absRef(v.source ?? 'A1')
  const a = [`type="list"`, v.allowBlank !== false ? 'allowBlank="1"' : '', 'showInputMessage="1"', 'showErrorMessage="1"', v.showError === false ? 'errorStyle="information"' : '', `sqref="${v.range}"`].filter(Boolean).join(' ')
  return `<dataValidation ${a}><formula1>${esc(f1)}</formula1></dataValidation>`
}

/** 一张 sheet 的三段 XML＋被筛掉的行（0 起）——没设的那段回空字串（冻结没设 ⇒ 原本那段 sheetViews） */
export function sheetViewXmlParts(content: ViewContent): SheetViewXml {
  const f = sanitizeFreeze(content.freeze)
  const sheetViews = `<sheetViews><sheetView workbookViewId="0"${f ? `>${paneXml(f.rows, f.cols)}</sheetView>` : '/>'}</sheetViews>`
  const eff = filterRect(content)
  let autoFilter = ''
  let hidden = new Set<number>()
  let filterRef: string | null = null
  if (eff && content.filter) {
    filterRef = rectA1({ ...eff, r1: Math.max(eff.r1, eff.r0) })
    const cols = Object.entries(content.filter.criteria ?? {}).map(([k, c]) => ({ id: colToIndex(k) - eff.c0, c })).filter(x => x.id >= 0 && x.id <= eff.c1 - eff.c0).sort((a, b) => a.id - b.id)
    autoFilter = `<autoFilter ref="${filterRef}">${cols.map(x => `<filterColumn colId="${x.id}">${criterionXml(x.c)}</filterColumn>`).join('')}</autoFilter>`
    hidden = filteredRows(content)
  }
  const vs = content.validations ?? []
  const dataValidations = vs.length ? `<dataValidations count="${vs.length}">${vs.map(validationXml).join('')}</dataValidations>` : ''
  return { sheetViews, autoFilter, dataValidations, hidden, filterRef }
}

/** workbook.xml 的 <definedNames>（有筛选的 sheet 各一条 _xlnm._FilterDatabase）·都没有 ⇒ '' */
export function filterDefinedNamesXml(items: Array<{ sheetName: string; index: number; content: ViewContent }>): string {
  const names = items.map(x => { const eff = x.content.filter ? filterRect(x.content) : null; return { ...x, ref: eff ? rectA1(eff) : null } }).filter(x => x.ref).map(x => `<definedName name="_xlnm._FilterDatabase" localSheetId="${x.index}" hidden="1">${esc(`'${x.sheetName.replace(/'/g, "''")}'!${absRef(x.ref!)}`)}</definedName>`)
  return names.length ? `<definedNames>${names.join('')}</definedNames>` : ''
}

// ── 导入 ──────────────────────────────────────────────────────────────────

const OP_IN: Record<string, FilterCondition['op']> = { equal: 'eq', notEqual: 'neq', greaterThan: 'gt', greaterThanOrEqual: 'gte', lessThan: 'lt', lessThanOrEqual: 'lte' }
const unwild = (s: string) => s.replace(/~([~*?])/g, '$1')
const hasWild = (s: string) => /(^|[^~])[*?]/.test(s)

/** 一条 customFilter ⇒ 条件（认不得 ⇒ null） */
function customToCond(op: string | undefined, val: string): FilterCondition | null {
  const o = OP_IN[op ?? 'equal']
  if (!o) return null
  if ((o === 'eq' || o === 'neq') && hasWild(val)) {
    // 头一个 * ／尾巴没跳脱的 * ⇒ 包含／开头是／结尾是；中间还有万用字 ⇒ 认不得
    const lead = val.startsWith('*')
    let tilde = 0
    for (let i = val.length - 2; i >= 0 && val[i] === '~'; i--) tilde++
    const trail = val.length > 1 && val.endsWith('*') && tilde % 2 === 0
    const core = val.slice(lead ? 1 : 0, trail ? -1 : undefined)
    if (hasWild(core) || (!lead && !trail)) return null
    if (lead && trail) return { op: o === 'eq' ? 'contains' : 'not_contains', value: unwild(core) }
    if (o === 'neq') return null
    return { op: trail ? 'begins_with' : 'ends_with', value: unwild(core) }
  }
  if (o === 'neq' && val === ' ') return { op: 'not_empty' }
  return { op: o, value: unwild(val) }
}

function criterionFromXml(body: string): FilterCriterion | null {
  const fl = /<(?:\w+:)?filters\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?filters>)/.exec(body)
  if (fl) {
    const a = attrs(fl[1])
    const vals = [...(fl[2] ?? '').matchAll(/<(?:\w+:)?filter\b([^>]*)\/?>/g)].map(m => attrs(m[1]).val ?? '').filter(v => v !== '')
    const blank = a.blank === '1' || a.blank === 'true'
    if (!vals.length) return blank ? { condition: { op: 'empty' } } : null
    return { values: blank ? [...vals, ''] : vals }
  }
  const cfs = /<(?:\w+:)?customFilters\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?customFilters>/.exec(body)
  if (!cfs) return null
  const and = ['1', 'true'].includes(attrs(cfs[1]).and ?? '')
  const list = [...cfs[2].matchAll(/<(?:\w+:)?customFilter\b([^>]*)\/?>/g)].map(m => attrs(m[1]))
  if (list.length === 1) { const c = customToCond(list[0].operator, list[0].val ?? ''); return c ? { condition: c } : null }
  if (list.length === 2) {
    const [x, y] = list
    const lo = (o?: string) => o === 'greaterThanOrEqual' || o === 'greaterThan'
    const hi = (o?: string) => o === 'lessThanOrEqual' || o === 'lessThan'
    if (and && lo(x.operator) && hi(y.operator)) return { condition: { op: 'between', value: x.val ?? '', value2: y.val ?? '' } }
    if (and && hi(x.operator) && lo(y.operator)) return { condition: { op: 'between', value: y.val ?? '', value2: x.val ?? '' } }
    if (!and && hi(x.operator) && lo(y.operator)) return { condition: { op: 'not_between', value: x.val ?? '', value2: y.val ?? '' } }
    if (!and && lo(x.operator) && hi(y.operator)) return { condition: { op: 'not_between', value: y.val ?? '', value2: x.val ?? '' } }
  }
  return null
}

/** 工作表 XML ⇒ 冻结／筛选／下拉清单（净化过）＋读不进来的提示 */
export function readSheetViewXml(xml: string): { view: SheetViewState; skipped: { filters: number; validations: number } } {
  const view: SheetViewState = {}
  const skipped = { filters: 0, validations: 0 }
  // 冻结（只认 frozen／frozenSplit·一般「分割」不是冻结）
  const sv = /<(?:\w+:)?sheetView\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?sheetView>)/.exec(xml)
  const pane = sv?.[1] ? /<(?:\w+:)?pane\b([^>]*)\/?>/.exec(sv[1]) : null
  if (pane) {
    const a = attrs(pane[1])
    if (a.state === 'frozen' || a.state === 'frozenSplit') {
      const f = sanitizeFreeze({ rows: Math.round(Number(a.ySplit ?? 0)), cols: Math.round(Number(a.xSplit ?? 0)) })
      if (f) view.freeze = f
    }
  }
  // 筛选（只认工作表层的 autoFilter·表格物件 table 里的不收）
  const af = /<(?:\w+:)?autoFilter\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?autoFilter>)/.exec(xml)
  if (af) {
    const r = parseRect(attrs(af[1]).ref)
    if (r) {
      const criteria: Record<string, FilterCriterion> = {}
      for (const m of (af[2] ?? '').matchAll(/<(?:\w+:)?filterColumn\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?filterColumn>)/g)) {
        const id = Number(attrs(m[1]).colId)
        const c = Number.isInteger(id) ? criterionFromXml(m[2] ?? '') : null
        if (c && id >= 0 && r.c0 + id <= r.c1) criteria[indexToCol(r.c0 + id)] = c
        else skipped.filters++
      }
      const fl = sanitizeFilter({ range: rectA1({ ...r, r1: Math.max(r.r1, r.r0) }), criteria })
      if (fl) view.filter = fl
    }
  }
  // 下拉清单（type="list"·sqref 可多块 ⇒ 每块一条；formula1 引用别张表的不收）
  const raw: Array<Partial<SheetValidation>> = []
  const dvs = /<(?:\w+:)?dataValidations\b[^>]*>([\s\S]*?)<\/(?:\w+:)?dataValidations>/.exec(xml.replace(/<extLst>[\s\S]*<\/extLst>/, ''))
  for (const m of (dvs?.[1] ?? '').matchAll(/<(?:\w+:)?dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?dataValidation>)/g)) {
    const a = attrs(m[1])
    if (a.type !== 'list') { skipped.validations++; continue }
    const f1m = /<(?:\w+:)?formula1>([\s\S]*?)<\/(?:\w+:)?formula1>/.exec(m[2] ?? '')
    const f1 = f1m ? unesc(f1m[1]).trim() : ''
    let list: string[] | undefined, source: string | undefined
    if (f1.length >= 2 && f1.startsWith('"') && f1.endsWith('"')) list = cleanListItems(f1.slice(1, -1).replace(/""/g, '\u0000').split(',').map(s => s.replace(/\u0000/g, '"')))
    else if (f1 && !f1.includes('!')) { const sr = parseRect(f1.replace(/\$/g, '')); if (sr) source = rectA1(sr) }
    if (!list?.length && !source) { skipped.validations++; continue }
    const allowBlank = a.allowBlank === '1' || a.allowBlank === 'true'
    const showError = (a.showErrorMessage === '1' || a.showErrorMessage === 'true') && (a.errorStyle ?? 'stop') === 'stop'
    for (const part of (a.sqref ?? '').split(/\s+/).filter(Boolean)) {
      const r = parseRect(part)
      if (!r) continue
      raw.push({ range: rectA1(r), type: 'list', ...(list ? { list } : { source }), ...(allowBlank ? {} : { allowBlank: false }), ...(showError ? {} : { showError: false }) })
    }
  }
  // 新版 Excel 把引用别张表的清单写在 extLst 的 x14:dataValidations ⇒ 不收、记一笔
  for (const _ of xml.matchAll(/<x14:dataValidation\b/g)) skipped.validations++
  const vs = sanitizeValidations(raw)
  if (vs) view.validations = vs
  return { view, skipped }
}

/** 读回来那张的提示句（parseXlsx warnings 用） */
export function viewImportWarnings(name: string, skipped: { filters: number; validations: number }): string[] {
  const out: string[] = []
  if (skipped.filters) out.push(`sheet "${name}": ${skipped.filters} filter condition(s) of a kind this editor doesn't support (top 10, colors, dynamic dates…) were dropped.`)
  if (skipped.validations) out.push(`sheet "${name}": ${skipped.validations} data validation rule(s) other than same-tab dropdown lists were dropped.`)
  return out
}
