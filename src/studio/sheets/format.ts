// 表格工程档 project.json 的读写（格式说明见同目录 FORMAT.md）。
//   { "format": "dilin-studio/sheets", "version": 1, "name": "…", "sheets": [ { "id", "name", "content": { cells, … } } ] }
//   每张表的 content 与登入版存库的形状同一份，读进来过同一道净化闸（engine/content.ts·另收 assets/<档名> 当图片网址）。
import type { ProjectStore, StudioFormat, StudioLang } from '../shared/types'
import { StudioError } from '../shared/types'
import { readProjectJson, writeProjectJson } from '../shared/project-file'
import type { SheetContent } from './engine/formula'
import { sanitizeSheetContent } from './engine/content'
import { normalizeSheetName } from './engine/sheet-list'

export const SHEETS_FORMAT_VERSION = 1
/** 一个工程最多几张表（同 xlsx 汇入上限） */
export const SHEETS_MAX = 50
const SHEET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export type SheetsTab = { id: string; name: string; content: SheetContent }
export type SheetsDoc = { name: string; sheets: SheetsTab[] }

export function newSheetId(): string {
  const a = new Uint8Array(6)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a)
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256)
  return 's' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

export function emptySheetsDoc(): SheetsDoc {
  return { name: '', sheets: [{ id: 's1', name: 'Sheet1', content: { cells: {} } }] }
}

/** 已解析的 project.json（表头已检查）⇒ SheetsDoc；坏的那张表丢掉、坏的格丢掉，一张都不剩 ⇒ 给一张空表。 */
export function docFromJson(j: Record<string, unknown>): SheetsDoc {
  const name = typeof j.name === 'string' ? j.name.trim().slice(0, 120) : ''
  if (j.sheets !== undefined && !Array.isArray(j.sheets)) throw new StudioError('bad_format', 'sheets is not an array')
  const sheets: SheetsTab[] = []
  const seen = new Set<string>()
  for (const raw of (Array.isArray(j.sheets) ? j.sheets : []).slice(0, SHEETS_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    let id = typeof r.id === 'string' && SHEET_ID_RE.test(r.id) ? r.id : newSheetId()
    while (seen.has(id)) id = newSheetId()
    const content = sanitizeSheetContent(r.content ?? { cells: {} }, { assetUrls: true }) ?? { cells: {} }
    const nm = normalizeSheetName(r.name) || `Sheet${sheets.length + 1}`
    seen.add(id)
    sheets.push({ id, name: nm, content })
  }
  if (!sheets.length) return { name, sheets: emptySheetsDoc().sheets }
  return { name, sheets }
}

/** SheetsDoc ⇒ project.json 本体（不含表头·writeProjectJson 会补） */
export function docToJson(doc: SheetsDoc): Record<string, unknown> {
  return { name: doc.name, sheets: doc.sheets.map(s => ({ id: s.id, name: s.name, content: s.content })) }
}

/** 这份工程用到的本机素材（assets/<档名>）档名 */
export function assetNamesIn(doc: SheetsDoc): string[] {
  const out = new Set<string>()
  for (const s of doc.sheets) for (const im of s.content.images ?? []) if (im.url.startsWith('assets/')) out.add(im.url.slice('assets/'.length))
  return [...out]
}

const SUMMARY: Record<StudioLang, string> = {
  'zh-TW': [
    'project.json 格式（表格）：{"format":"dilin-studio/sheets","version":1,"name":"<工程名>","sheets":[{"id":"s1","name":"Sheet1","content":{…}}]}',
    '・sheets 依序就是底下的分頁；id 只用英數、_、-，不要重複。',
    '・content.cells 以格名為鍵（A1、B2…，欄最多 ZZZ、列最多 999999）：{"v":"原文","f":"=SUM(A1:A3)","s":{格式}}。v 一律寫成字串（數字也是 "12.5"），有 f 的格 v 寫 ""，網頁會自己算（公式只能引用同一張表）。',
    '・s 常用：b／i／u／s（粗斜底刪·true）、size（字級 pt）、fg／bg（#rrggbb）、align（left|center|right）、valign（top|middle|bottom）、wrap、numFmt（{"t":"number|currency|percent|date…","d":小數位,"k":千分位}）。',
    '・其他選用：merges（["A1:B2"]）、colWidths（{"A":120}）、rowHeights（{"1":32}）、images（[{"id","url":"assets/檔名","cell":"C3","w","h"}]，圖檔放 assets/）、freeze、filter、validations、condFormats（條件格式，如資料橫條 [{"id":"r1","ranges":["B2:B20"],"type":"data_bar"}]；color_scale／data_bar 的 colors 可省，用預設色、長短按範圍內最小到最大自動算）、charts、print（列印設定）。',
    '・不認得的鍵與壞值會被丟掉；改完存檔，網頁約 1.5 秒內自動重新載入。',
  ].join('\n'),
  'zh-CN': [
    'project.json 格式（表格）：{"format":"dilin-studio/sheets","version":1,"name":"<工程名>","sheets":[{"id":"s1","name":"Sheet1","content":{…}}]}',
    '・sheets 依序就是底下的分页；id 只用英数、_、-，不要重复。',
    '・content.cells 以格名为键（A1、B2…，列最多 ZZZ、行最多 999999）：{"v":"原文","f":"=SUM(A1:A3)","s":{格式}}。v 一律写成字符串（数字也是 "12.5"），有 f 的格 v 写 ""，网页会自己算（公式只能引用同一张表）。',
    '・s 常用：b／i／u／s（粗斜下划删除·true）、size（字号 pt）、fg／bg（#rrggbb）、align（left|center|right）、valign（top|middle|bottom）、wrap、numFmt（{"t":"number|currency|percent|date…","d":小数位,"k":千分位}）。',
    '・其他可选：merges（["A1:B2"]）、colWidths（{"A":120}）、rowHeights（{"1":32}）、images（[{"id","url":"assets/文件名","cell":"C3","w","h"}]，图片放 assets/）、freeze、filter、validations、condFormats（条件格式，如数据条 [{"id":"r1","ranges":["B2:B20"],"type":"data_bar"}]；color_scale／data_bar 的 colors 可省，用默认色、长短按范围内最小到最大自动算）、charts、print（打印设置）。',
    '・不认得的键与坏值会被丢掉；改完保存，网页约 1.5 秒内自动重新载入。',
  ].join('\n'),
  en: [
    'project.json format (spreadsheet): {"format":"dilin-studio/sheets","version":1,"name":"<project name>","sheets":[{"id":"s1","name":"Sheet1","content":{…}}]}',
    '- sheets are the tabs, in order; ids use letters, digits, _ and - only, and must be unique.',
    '- content.cells is keyed by cell name (A1, B2…; columns up to ZZZ, rows up to 999999): {"v":"raw text","f":"=SUM(A1:A3)","s":{style}}. v is always a string (numbers too: "12.5"); for formula cells write v as "" and the page computes it (formulas can only reference the same sheet).',
    '- common s keys: b/i/u/s (bold/italic/underline/strike, true), size (pt), fg/bg (#rrggbb), align (left|center|right), valign (top|middle|bottom), wrap, numFmt ({"t":"number|currency|percent|date…","d":decimals,"k":thousands}).',
    '- optional: merges (["A1:B2"]), colWidths ({"A":120}), rowHeights ({"1":32}), images ([{"id","url":"assets/<file>","cell":"C3","w","h"}], files go in assets/), freeze, filter, validations, condFormats (conditional formats, e.g. data bars [{"id":"r1","ranges":["B2:B20"],"type":"data_bar"}]; colors is optional for color_scale / data_bar: default colors, bar length scaled from the lowest to the highest number in the range), charts, print (print setup).',
    '- unknown keys and bad values are dropped; after you save, the page reloads within about 1.5 seconds.',
  ].join('\n'),
}

export const sheetsFormat: StudioFormat<SheetsDoc> = {
  version: SHEETS_FORMAT_VERSION,
  emptyProject: emptySheetsDoc,
  async load(store: ProjectStore) {
    const j = await readProjectJson(store, 'sheets', SHEETS_FORMAT_VERSION)
    return j ? docFromJson(j) : emptySheetsDoc()
  },
  save: (store: ProjectStore, doc: SheetsDoc) => writeProjectJson(store, 'sheets', SHEETS_FORMAT_VERSION, docToJson(doc)),
  summaryForAI: (lang: StudioLang) => SUMMARY[lang] ?? SUMMARY.en,
}
