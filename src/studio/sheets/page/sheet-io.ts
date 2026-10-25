// 顶栏「匯出 csv」「匯入 xlsx／csv」两颗钮的逻辑（整页 SheetPage 只管画钮、开档选择窗、出提示）。
//   匯出 csv：只出目前这张工作表·画面上看到的值（engine/csv sheetToCsv·UTF-8 带 BOM 让 Excel 认得中文）·纯前端。
//   匯入：先在浏览器用 engine/xlsx-io parseXlsx 读一遍（坏档、超过上限当场就说·不用先传上去）⇒ 交宿主 importWorkbook 建新表格档；
//     宿主回的错误码 ⇒ 一句白话（字典键）。两颗钮都要宿主 has() 说有才画。
import type { StudioLang } from '../../shared/types'
import { SheetBook, type SheetContent, type BookSheet } from '../engine/formula'
import { sheetToCsv } from '../engine/csv'
import { SHEET_FEATURES, type SheetsPageHost } from './host'

/** 档案选择窗的 accept：副档名＋常见 MIME（有的系统只认其一） */
export const SHEET_IMPORT_ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv'
const SHEET_FILE_EXT = /\.(xlsx|xls|csv)$/i

/** 顶栏这两颗钮画不画：匯入要宿主说有、而且真的给了 importWorkbook；匯出 csv 只看 has()。 */
export function sheetIoButtons(host: Pick<SheetsPageHost, 'has' | 'importWorkbook'>): { importOn: boolean; csvOn: boolean } {
  return {
    importOn: host.has(SHEET_FEATURES.xlsxImport) && typeof host.importWorkbook === 'function',
    csvOn: host.has(SHEET_FEATURES.csvExport),
  }
}

/** 去掉路径字与控制字、压空白（同 xlsx 下载档名的规则） */
function cleanPart(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 匯出档名：「<表格标题>-<工作表名>.csv」；标题或页签名空 ⇒ 只用有的那一段；都空 ⇒ sheet.csv */
export function csvFileName(docTitle: string, sheetName: string): string {
  const parts = [cleanPart(docTitle).slice(0, 120), cleanPart(sheetName).slice(0, 60)].filter(Boolean)
  return `${parts.join('-') || 'sheet'}.csv`
}

/** 目前这张工作表 ⇒ csv 档（文字＋档名）。数字格式里的月份／中文日期照界面语言。 */
export function buildSheetCsv(o: { docTitle: string; sheetName: string; content: SheetContent | null | undefined; lang: StudioLang; book?: readonly BookSheet[] }): { text: string; fileName: string } {
  const ev = o.book ? { book: new SheetBook(o.book), sheetName: o.sheetName } : undefined   // 跨表引用（表格2!A1）要整份文件才算得出
  return { text: sheetToCsv(o.content, { lang: o.lang === 'en' ? 'en' : 'zh', bom: true, eval: ev }), fileName: csvFileName(o.docTitle, o.sheetName) }
}

export type SheetImportFail = 'bad_type' | 'too_big' | 'sheet_too_big' | 'bad_file' | 'login' | 'quota' | 'unconfirmed' | 'failed'
export type SheetImportOutcome =
  | { ok: true; id: string; title: string; href: string; imagesSkipped: boolean }
  | { ok: false; reason: SheetImportFail }

/** 每种失败给人看的那句（字典键） */
export const SHEET_IMPORT_FAIL_KEY: Record<SheetImportFail, string> = {
  bad_type: 'sheet_import_bad_type',
  too_big: 'sheet_import_too_big',
  sheet_too_big: 'sheet_import_sheet_too_big',
  bad_file: 'sheet_import_bad_file',
  login: 'sheet_import_login',
  quota: 'sheet_import_quota',
  unconfirmed: 'sheet_import_unconfirmed',
  failed: 'sheet_import_failed',
}

/** 宿主（网站 API）回的失败 ⇒ 哪一种 */
export function sheetImportFailReason(status: number, code?: string): SheetImportFail {
  if (status === 401) return 'login'
  if (code === 'content_too_large') return 'sheet_too_big'
  if (code === 'err_xlsx_too_large' || (status === 413 && !code)) return 'too_big'
  if (code === 'err_storage_quota' || code === 'err_quota_exceeded' || status === 402 || status === 507) return 'quota'
  if (code === 'err_xlsx_not_spreadsheet') return 'bad_type'
  if (code === 'err_xlsx_bad_file' || code === 'err_sheet_bad_content') return 'bad_file'
  if (code === 'err_xlsx_import_unconfirmed') return 'unconfirmed'
  return 'failed'
}

/**
 * 匯入一个档：副档名 ⇒ 大小 ⇒ 浏览器里先读一遍（同服务端那份 parseXlsx·坏档／超过张数格数上限当场拒）⇒ 宿主建新档。
 *   parse 可换（单测用）；缺 ⇒ 动态载入 engine/xlsx-io（SheetJS 不进主包）。
 */
export async function runSheetImport(
  host: Pick<SheetsPageHost, 'importWorkbook'>,
  file: File,
  o: { parse?: (bytes: Uint8Array) => void; maxBytes?: number } = {},
): Promise<SheetImportOutcome> {
  if (!host.importWorkbook) return { ok: false, reason: 'failed' }
  if (!SHEET_FILE_EXT.test(file.name || '')) return { ok: false, reason: 'bad_type' }
  let parse = o.parse
  let maxBytes = o.maxBytes
  let isTooLarge = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'err_xlsx_too_large'
  if (!parse || maxBytes === undefined) {
    const io = await import('../engine/xlsx-io')
    parse = parse ?? (b => { io.parseXlsx(b) })
    maxBytes = maxBytes ?? io.IMPORT_MAX_BYTES
    const prev = isTooLarge
    isTooLarge = e => (e instanceof io.XlsxError && e.code === 'err_xlsx_too_large') || prev(e)
  }
  if (file.size > maxBytes) return { ok: false, reason: 'too_big' }
  try {
    parse(new Uint8Array(await file.arrayBuffer()))
  } catch (e) {
    return { ok: false, reason: isTooLarge(e) ? 'too_big' : 'bad_file' }
  }
  const res = await host.importWorkbook(file).catch(() => null)
  if (!res) return { ok: false, reason: 'failed' }
  if (!res.ok) return { ok: false, reason: sheetImportFailReason(res.status, res.code) }
  const d = res.data
  if (!d || !d.id) return { ok: false, reason: 'unconfirmed' }
  return { ok: true, id: d.id, title: d.title, href: d.href, imagesSkipped: (d.warnings ?? []).some(w => /picture/i.test(w)) }
}
