// Dilin Studio · 表格命令列版的核心（tools/sheets-cli.mjs 用；tools/build.mjs 另打成 app/sheets-cli-core.mjs·node 跑）。
//   表格的读档、公式、改格、xlsx／csv 读写本来就是纯函数 ⇒ 不用开浏览器：读 project.json → 检查 → 读格／跑操作 → 写回／汇出。
//   跟表格页同一套：读档＝format.docFromJson（每张过 engine/content sanitizeSheetContent 净化闸）、读格＝agent-ops readRange（带整份文件·跨表公式算得出）、
//   改格＝agent-job.pure sheetsAgentJob（同本机 MCP sheets_run／网站 update_cells 那支 applyOps）、
//   汇出＝xlsx-io buildXlsxBytes（同顶栏「xlsx」钮·图走 xlsx-images）／csv sheetToCsv（同「匯出 csv」）、汇入＝xlsx-io parseXlsx（同「匯入 xlsx／csv」）。
//   做不了的（插云盘图 add_image 要网站）照实拒、什么都不动。
import { checkProjectHeader, formatTag } from '../shared/project-file'
import { studioNeg } from '../shared/ai-panel.pure'
import { docFromJson, docToJson, newSheetId, SHEETS_FORMAT_VERSION, SHEETS_MAX, type SheetsDoc } from './format'
import { pickSheet, sheetsAgentJob, SHEET_CONTENT_MAX_BYTES } from './agent-job.pure'
import { OP_NAMES, OPS_MAX, OpError, READ_DEFAULT_LIMIT, readRange, type AgentContent } from './engine/agent-ops'
import { sanitizeSheetContent } from './engine/content'
import { SheetBook } from './engine/formula'
import { sheetToCsv } from './engine/csv'
import { buildXlsxBytes, exportFileName, parseXlsx, sniffImageMime, XlsxError, type WorkbookSheet } from './engine/xlsx-io'
import { resolveXlsxImages } from './engine/xlsx-images'
import { nextSheetName, normalizeSheetName, type SheetTab } from './engine/sheet-list'
import { csvFileName } from './page/sheet-io'

/** 负控处名（DILIN_NEG 含它 ⇒ 退回修前）：check 不报问题／读格不带整份文件（跨表公式 #REF!）／run 错了照写前面成功的那几组 */
export const SHEETS_CLI_NEG = { silentCheck: 'sheets_cli_silent_check', noBook: 'sheets_cli_no_book', partialRun: 'sheets_cli_partial_run' } as const

export type CliIssue = { code: string; text: string }
export type CliFile = { name: string; bytes: Uint8Array }
type Fail = { ok: false; error: string }

const SHEET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
/** 键排序后的 JSON（比对净化前后用·键序不同不算改） */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`
  if (isObj(x)) return `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}`
  return JSON.stringify(x) ?? 'null'
}

/** 净化前后逐张比：表格页开档时会丢掉／改掉的每一条（坏的表、坏的格、认不得的键、坏值） */
function loadIssues(j: Record<string, unknown>): CliIssue[] {
  const out: CliIssue[] = []
  const add = (code: string, text: string) => out.push({ code, text })
  const raw = Array.isArray(j.sheets) ? j.sheets : []
  if (j.name !== undefined && typeof j.name !== 'string') add('name_not_string', 'name 不是字串，會被當成空的')
  if (!raw.length) add('no_sheets', 'sheets 是空的（或沒寫），表格頁會給一張空表')
  if (raw.length > SHEETS_MAX) add('too_many_sheets', `sheets 有 ${raw.length} 張，超過 ${SHEETS_MAX} 張的會被丟掉`)
  const seen = new Set<string>()
  raw.slice(0, SHEETS_MAX).forEach((s, i) => {
    const at = `sheets[${i}]`
    if (!isObj(s)) { add('sheet_not_object', `${at} 不是物件，整張丟掉`); return }
    const label = `${at}（${typeof s.name === 'string' ? s.name : '?'}）`
    if (typeof s.id !== 'string' || !SHEET_ID_RE.test(s.id)) add('sheet_bad_id', `${label} 的 id 不合格（只能英數、_、-，1–64 字），會換一個新的`)
    else if (seen.has(s.id)) add('sheet_dup_id', `${label} 的 id「${s.id}」跟前面重複，會換一個新的`)
    else seen.add(s.id)
    const nm = normalizeSheetName(s.name)
    if (!nm) add('sheet_no_name', `${label} 沒有名字，會叫 Sheet${i + 1}`)
    else if (nm !== s.name) add('sheet_name_changed', `${label} 的名字會改成「${nm}」（連續空白壓成一個、去頭尾空白、最多 60 字）`)
    const c = s.content ?? { cells: {} }
    const clean = sanitizeSheetContent(c, { assetUrls: true })
    if (!clean) {
      add('content_bad', `${label} 的 content 讀不進來（不是物件、cells 不是物件，或某一格不是物件），整張變空表`)
      return
    }
    const rc = c as Record<string, unknown>
    for (const k of Object.keys(rc)) {
      if (k === 'cells') continue
      if (!(k in clean)) add('content_key_dropped', `${label} 的 content.${k} ${['merges', 'images', 'colWidths', 'rowHeights', 'freeze', 'filter', 'validations', 'condFormats', 'charts', 'print', 'hiddenRows', 'hiddenCols'].includes(k) ? '全是壞值' : '不認得'}，會被丟掉`)
      else if (stable(rc[k]) !== stable((clean as Record<string, unknown>)[k])) add('content_key_changed', `${label} 的 content.${k} 有壞值，會被改掉或丟掉一部分`)
    }
    const cells = isObj(rc.cells) ? rc.cells : {}
    const got = (clean.cells ?? {}) as Record<string, Record<string, unknown>>
    for (const [k, cell] of Object.entries(cells)) {
      if (!/^[A-Z]{1,3}\d{1,6}$/.test(k)) { add('cell_bad_key', `${label} 的格名「${k}」不對（要大寫、欄 A–ZZZ、列 1–999999），這格丟掉`); continue }
      const g = got[k]
      const c0 = cell as Record<string, unknown>
      if (!g) { if (Object.keys(c0).length) add('cell_dropped', `${label} ${k} 沒有能用的 v／f／s（v 要是字串、f 要以 = 開頭），這格丟掉`); continue }
      const bad = ['v', 'f', 's'].filter((x) => c0[x] !== undefined && stable(c0[x]) !== stable(g[x]))
      const extra = Object.keys(c0).filter((x) => !['v', 'f', 's'].includes(x))
      if (bad.length) add('cell_changed', `${label} ${k} 的 ${bad.join('、')} 有壞值（v 不是字串、f 不以 = 開頭、s 裡有認不得的格式），會被改掉`)
      if (extra.length) add('cell_key_dropped', `${label} ${k} 的 ${extra.join('、')} 不認得，會被丟掉`)
    }
  })
  return out
}

/** 读 project.json（字串或物件）⇒ doc＋读档报告（表格页开档时会丢掉／改掉的每一条） */
export function cliLoad(raw: unknown): { doc: SheetsDoc; issues: CliIssue[] } {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw
  checkProjectHeader(j, 'sheets', SHEETS_FORMAT_VERSION)
  const doc = docFromJson(j as Record<string, unknown>)
  return { doc, issues: studioNeg(SHEETS_CLI_NEG.silentCheck) ? [] : loadIssues(j as Record<string, unknown>) }
}

/** doc ⇒ project.json 全文（表头在前） */
export function cliSave(doc: SheetsDoc): string {
  return JSON.stringify({ format: formatTag('sheets'), version: SHEETS_FORMAT_VERSION, ...docToJson(doc) }, null, 2) + '\n'
}

const tabList = (doc: SheetsDoc) => doc.sheets.map((t, i) => ({ id: t.id, name: t.name, position: i }))
const bookOf = (doc: SheetsDoc) => new SheetBook(doc.sheets.map((t) => ({ name: t.name, content: t.content })))

/** 读格：一张表（名字或 id·缺省第一张）某区间（缺省有值区）⇒ input／value／display（公式算好·跨表引用带整份文件） */
export function cliGet(doc: SheetsDoc, o: { sheet?: string; range?: string; offset?: number; limit?: number; formats?: boolean } = {}): { ok: true; result: Record<string, unknown> } | Fail {
  const range = o.range?.trim() || null
  const named = range && range.includes('!') ? range.slice(0, range.lastIndexOf('!')).replace(/^'(.*)'$/, '$1') : null
  if (named && o.sheet && named.toLowerCase() !== o.sheet.toLowerCase()) return { ok: false, error: `--range names sheet "${named}" but --sheet is "${o.sheet}"` }
  const tab = pickSheet(doc, o.sheet?.trim() || named)
  if (typeof tab === 'string') return { ok: false, error: tab }
  try {
    const r = readRange(tab.content as AgentContent, {
      range: range ? range.replace(/^.*!/, '') : null,
      offset: o.offset, limit: o.limit ?? READ_DEFAULT_LIMIT, includeFormats: !!o.formats,
      eval: studioNeg(SHEETS_CLI_NEG.noBook) ? undefined : { book: bookOf(doc), sheetName: tab.name },
    })
    return { ok: true, result: { sheet: { id: tab.id, name: tab.name }, sheets: tabList(doc), ...r } }
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message }
    throw e
  }
}

/** 跑一批操作（可跨表·每步可带 "sheet"·range 也可写 Sheet2!A1）：全有或全无 ⇒ 新 doc＋每步结果；出错回哪一步、为什么 */
export function cliRun(doc: SheetsDoc, steps: unknown[], o: { sheet?: string } = {}): { ok: true; doc: SheetsDoc; changed: boolean; results: unknown[]; warnings: string[] } | Fail {
  if (!Array.isArray(steps) || !steps.length) return { ok: false, error: 'steps must be a non-empty array of {op, …}' }
  // 连续指同一张表的几步并成一组（一组＝一次 sheetsAgentJob·同一张表、最多 OPS_MAX 步）
  const groups: Array<{ start: number; sheet: string | null; ops: unknown[] }> = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isObj(s)) return { ok: false, error: `steps[${i}] must be an object like {"op":"set","range":"A1","values":[["x"]]}. Nothing was changed.` }
    const { sheet, ...op } = s
    if (sheet !== undefined && typeof sheet !== 'string') return { ok: false, error: `steps[${i}].sheet must be a sheet name or id. Nothing was changed.` }
    const r = typeof op.range === 'string' && op.range.includes('!') ? op.range.slice(0, op.range.lastIndexOf('!')).replace(/^'(.*)'$/, '$1') : null
    const want = (sheet as string | undefined)?.trim() || r || o.sheet?.trim() || null
    const tab = pickSheet(doc, want)
    if (typeof tab === 'string') return { ok: false, error: `steps[${i}]: ${tab}. Nothing was changed.` }
    const last = groups[groups.length - 1]
    if (last && last.sheet === tab.id && last.ops.length < OPS_MAX) last.ops.push(op)
    else groups.push({ start: i, sheet: tab.id, ops: [op] })
  }
  let cur = doc
  let changed = false
  const results: unknown[] = []
  const warnings: string[] = []
  for (const g of groups) {
    const out = sheetsAgentJob(cur, { kind: 'run', sheet: g.sheet, ops: g.ops })
    if (!out.reply.ok) {
      const msg = (out.reply.message ?? out.reply.error).replace(/ops\[(\d+)\]/g, (_, n) => `steps[${g.start + Number(n)}]`)
      if (studioNeg(SHEETS_CLI_NEG.partialRun) && cur !== doc) return { ok: true, doc: cur, changed, results, warnings: [...warnings, msg] }
      return { ok: false, error: /Nothing was changed/.test(msg) ? msg : `${msg}\nNothing was changed (all steps apply together or not at all).` }
    }
    const res = out.reply.result as { sheet: { id: string; name: string }; changed: boolean; results: Array<Record<string, unknown>>; warnings?: string[]; cross_sheet?: unknown }
    for (const x of res.results) results.push({ sheet: res.sheet.name, ...x })
    if (res.warnings) warnings.push(...res.warnings)
    if (out.next) { cur = out.next; changed = true }
  }
  return { ok: true, doc: cur, changed, results, warnings }
}

/** 操作表（同本机 MCP sheets_run／网站 update_cells 那批 op）：参数与一个例子 */
const OP_SPECS: Record<string, { params: string; example: Record<string, unknown>; description: string }> = {
  set: { params: 'range (top-left cell, or a range the same size as values), values (2-D array; "=…" is a formula, "\'…" forces text, null clears)', example: { op: 'set', range: 'A1', values: [['Item', 'Qty'], ['Apple', 3], ['Total', '=SUM(B2:B2)']] }, description: 'Write values and formulas' },
  format: { params: 'range, style {bold, italic, underline, strike, size, font, color, bg, align, valign, wrap, indent, number_format {type, decimals, thousands, symbol}, border {apply, style, color}} or clear:true', example: { op: 'format', range: 'A1:B1', style: { bold: true, bg: '#fff3bf' } }, description: 'Cell formatting' },
  insert_rows: { params: 'at (1-based row), count', example: { op: 'insert_rows', at: 2, count: 1 }, description: 'Insert rows (formulas move like Excel, other tabs too)' },
  delete_rows: { params: 'at, count', example: { op: 'delete_rows', at: 5, count: 2 }, description: 'Delete rows' },
  insert_cols: { params: 'at (column letter), count', example: { op: 'insert_cols', at: 'C', count: 1 }, description: 'Insert columns' },
  delete_cols: { params: 'at, count', example: { op: 'delete_cols', at: 'C' }, description: 'Delete columns' },
  merge: { params: 'range', example: { op: 'merge', range: 'A1:C1' }, description: 'Merge cells (keeps the top-left value)' },
  unmerge: { params: 'range', example: { op: 'unmerge', range: 'A1:C1' }, description: 'Unmerge' },
  sort: { params: 'range, by [{column, descending}], has_header', example: { op: 'sort', range: 'A1:B20', by: [{ column: 'B', descending: true }], has_header: true }, description: 'Sort rows of a range' },
  resize: { params: 'range (columns like B or B:D, rows like 2 or 2:5), width | height (px)', example: { op: 'resize', range: 'A:B', width: 140 }, description: 'Column widths / row heights' },
  update_image: { params: 'id, cell, w, h, ox, oy, mode (float|below|in_cell), order', example: { op: 'update_image', id: '<image id from get>', w: 200, h: 120 }, description: 'Move / resize a picture already in the sheet' },
  delete_image: { params: 'id', example: { op: 'delete_image', id: '<image id>' }, description: 'Remove a picture' },
  add_image: { params: '— needs the website (pictures come from the drive); put the file in assets/ and add it to content.images in project.json instead', example: {}, description: 'Not available from the command line' },
  set_chart: { params: 'id (to change one), type (column|bar|line|pie|doughnut), range, cell, w, h, title', example: { op: 'set_chart', type: 'column', range: 'A1:B5', cell: 'D2' }, description: 'Add or change a chart' },
  delete_chart: { params: 'id', example: { op: 'delete_chart', id: '<chart id>' }, description: 'Remove a chart' },
  cond_format: { params: 'ranges (one or more ranges, comma separated; no tab name — use "sheet"), rule {type, …}, format {…}; or rule_id + clear:true', example: { op: 'cond_format', ranges: 'B2:B20', rule: { type: 'data_bar' } }, description: 'Conditional formatting' },
  freeze: { params: 'rows, cols', example: { op: 'freeze', rows: 1, cols: 0 }, description: 'Freeze panes' },
  filter: { params: 'range, criteria {column: {values:[…]}}; or clear:true', example: { op: 'filter', range: 'A1:D20' }, description: 'Filter' },
  find: { params: 'find (wildcards * ?; ~* = a real *), range, match_case, whole_cell, look_in (formulas|values)', example: { op: 'find', find: 'Total' }, description: 'Find cells (lists matches, changes nothing)' },
  replace: { params: 'find, replace ("" deletes the match), range, match_case, whole_cell, include_formulas', example: { op: 'replace', find: '2025', replace: '2026' }, description: 'Find & replace (formula cells left alone unless include_formulas)' },
  dedupe: { params: 'range, columns ["A","C"] (default: all), has_header', example: { op: 'dedupe', range: 'A1:B20', has_header: true }, description: 'Remove duplicate rows inside a range' },
  hide: { params: 'rows "5:9", cols "C" or "B:D", hidden (default true); or unhide_all:true', example: { op: 'hide', cols: 'C' }, description: 'Hide / unhide rows and columns' },
  validate: { params: 'range, list [...] or source "F1:F5", allow_blank, reject_invalid; or clear:true', example: { op: 'validate', range: 'C2:C20', list: ['Yes', 'No'] }, description: 'Drop-down list (data validation)' },
}

export function cliCommands(filter?: string) {
  const f = (filter ?? '').trim().toLowerCase()
  const all = OP_NAMES.map((op) => ({ op, ...(OP_SPECS[op] ?? { params: '', example: {}, description: '' }) }))
  return f ? all.filter((c) => c.op.includes(f) || c.description.toLowerCase().includes(f) || c.params.toLowerCase().includes(f)) : all
}

export const CLI_EXPORT_FORMATS = ['xlsx', 'csv'] as const
export type CliExportFormat = typeof CLI_EXPORT_FORMATS[number]

/**
 * 汇出：xlsx＝整份（给 sheet ⇒ 只那一张）·公式带算好的缓存值·图从 readAsset（assets/<档名>）取 png／jpeg／gif（别种略过记数）；
 *       csv＝一张（缺省第一张）·画面上看到的值·UTF-8 带 BOM（Excel 认得中文）。
 */
export async function cliExport(doc: SheetsDoc, format: CliExportFormat, o: { sheet?: string; readAsset?: (name: string) => Uint8Array | null; lang?: 'zh' | 'en' } = {}): Promise<{ ok: true; file: CliFile; notes: string[] } | Fail> {
  const notes: string[] = []
  if (format === 'csv') {
    const tab = pickSheet(doc, o.sheet?.trim() || null)
    if (typeof tab === 'string') return { ok: false, error: tab }
    const text = sheetToCsv(tab.content, { lang: o.lang ?? 'zh', bom: true, eval: { book: bookOf(doc), sheetName: tab.name } })
    if (doc.sheets.length > 1 && !o.sheet) notes.push(`csv holds one sheet: wrote "${tab.name}" (use --sheet for another)`)
    return { ok: true, file: { name: csvFileName(doc.name, tab.name), bytes: new TextEncoder().encode(text) }, notes }
  }
  let tabs = doc.sheets
  if (o.sheet) {
    const tab = pickSheet(doc, o.sheet.trim())
    if (typeof tab === 'string') return { ok: false, error: tab }
    tabs = [tab]
  }
  const sheetsIn: WorkbookSheet[] = tabs.map((t) => ({ name: t.name, content: t.content as AgentContent }))
  let media
  if (sheetsIn.some((s) => (s.content.images ?? []).length)) {
    const r = await resolveXlsxImages(sheetsIn, {
      async fetchBytes(url) { return url.startsWith('assets/') && o.readAsset ? o.readAsset(url.slice('assets/'.length)) : null },
    })
    media = r.media
    if (r.skipped) notes.push(`${r.skipped} picture(s) left out (only png / jpeg / gif files in assets/ can go into the xlsx)`)
    if (r.below) notes.push(`${r.below} sheet(s) have pictures under the cells: Excel shows them as the sheet background (on screen only, not printed)`)
  }
  return { ok: true, file: { name: exportFileName(doc.name || 'sheet'), bytes: buildXlsxBytes(sheetsIn, media) }, notes }
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

/** 汇入 .xlsx／.xls／.csv ⇒ 新工程（project.json 全文＋assets/ 的图）；任一张坏或超 2MB ⇒ 整份不建（同表格页「匯入」） */
export function cliImport(bytes: Uint8Array, fileName: string, o: { formulas?: 'keep' | 'values' } = {}): { ok: true; json: string; name: string; assets: CliFile[]; warnings: string[]; stats: Record<string, unknown> } | Fail {
  let parsed
  try { parsed = parseXlsx(bytes, { formulas: o.formulas ?? 'keep' }) } catch (e) {
    if (e instanceof XlsxError) return { ok: false, error: `${e.message} (${e.code})` }
    return { ok: false, error: 'could not read this spreadsheet file' }
  }
  const assets: CliFile[] = []
  let skipped = 0
  parsed.images.forEach((im, i) => {
    const content = parsed.sheets[im.sheet]?.content
    const mime = sniffImageMime(im.bytes)
    if (!content || !mime || !IMAGE_EXT[mime]) { skipped++; return }
    const name = `img-${i + 1}.${IMAGE_EXT[mime]}`
    assets.push({ name, bytes: im.bytes })
    content.images = [...(content.images ?? []), { ...im.image, url: `assets/${name}` }]
  })
  if (skipped) parsed.warnings.push(`${skipped} picture(s) from the file could not be saved to the project and were left out.`)
  const tabs: SheetTab[] = []
  const sheets: Array<{ id: string; name: string; content: unknown }> = []
  for (const s of parsed.sheets) {
    const clean = sanitizeSheetContent(s.content, { assetUrls: true })
    if (!clean) return { ok: false, error: `sheet "${s.name}" came out invalid. Nothing was created.` }
    if (new TextEncoder().encode(JSON.stringify(clean)).length > SHEET_CONTENT_MAX_BYTES) return { ok: false, error: `sheet "${s.name}" is over 2 MB. Nothing was created.` }
    const name = normalizeSheetName(s.name) || nextSheetName(tabs)
    tabs.push({ id: String(tabs.length), name, position: tabs.length })
    sheets.push({ id: newSheetId(), name, content: clean })
  }
  const name = (fileName.replace(/^.*[\\/]/, '').replace(/\.(xlsx|xls|csv)$/i, '').trim() || 'sheet').slice(0, 110)
  const doc = docFromJson({ name, sheets })
  return { ok: true, json: cliSave(doc), name, assets, warnings: parsed.warnings, stats: parsed.stats }
}
