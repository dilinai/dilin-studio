// 游客版顶栏「匯入 xlsx／csv」的宿主那一支（importWorkbook）：游客没有云盘 ⇒ 全在浏览器本机做——
//   读档＝engine/xlsx-io parseXlsx（跟登入版服务端 /api/ai-sheet/xlsx-import 同一份 SheetJS 解析·同样 10MB／50 张／50 万格上限·浏览器给 Uint8Array 走 'array' 读法）；
//   图（png／jpeg／gif·按位元组判）写进新工程的 assets/、表格里存 assets/<档名>（同游客版插图）；每张过同一道净化闸（engine/content）＋2MB 上限（任一张超 ⇒ 整份不建）；
//   建档＝shared/project-actions createOpfsProject（同「开新工程」那条：这个浏览器的 OPFS＋IndexedDB 工程清单）·名字＝档名去副档名·跟清单里的表格工程撞名 ⇒ 后面加「 (2)」。
//   回包照 host.ts importWorkbook 的约定：ok＋status＋data{id,title,href,warnings}；失败只会是 err_xlsx_not_spreadsheet／err_xlsx_too_large／err_xlsx_bad_file／
//     content_too_large／err_sheet_bad_content／err_xlsx_import_failed（没有登入过期、云盘空间那两种）。
//   ⛔ 本档不 import React、不打任何 /api。
import type { ProjectPayload } from '../../shared/types'
import { browserProjectEnv, createOpfsProject, type ProjectEnv } from '../../shared/project-actions'
import { formatTag } from '../../shared/project-file'
import { studioHref } from '../../shared/host'
import { studioNeg } from '../../shared/ai-panel.pure'
import { sanitizeSheetContent, SHEET_CONTENT_MAX_BYTES } from '../engine/content'
import { nextSheetName, normalizeSheetName, type SheetTab } from '../engine/sheet-list'
import { sheetsFormat, newSheetId, SHEETS_FORMAT_VERSION } from '../format'
import type { SheetHostResult, SheetImportResult, SheetsPageHost } from './host'

/** 负控处名：DILIN_NEG=guest_sheet_import_off ⇒ 游客宿主不给 importWorkbook（退回修前·匯入钮不画） */
export const GUEST_SHEET_IMPORT_NEG = 'guest_sheet_import_off'

const SHEET_EXT = /\.(xlsx|xls|csv)$/i
const SHEET_MIMES = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'])
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }
const UNTITLED = '未命名表格'   // 同服务端那路的预设标题

type Fail = { ok: false; status: number; code: string }
const fail = (status: number, code: string): Fail => ({ ok: false, status, code })

function randomTag(): string {
  const a = new Uint8Array(6)
  crypto.getRandomValues(a)
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

/** 清单里已有同名 ⇒ 「名字 (2)」「名字 (3)」…（同云盘撞名的写法：原名不动·序号接在后面） */
function uniqueName(want: string, taken: Set<string>): string {
  if (!taken.has(want)) return want
  let n = 2
  while (taken.has(`${want} (${n})`)) n++
  return `${want} (${n})`
}

/** 选的档 ⇒ 这个浏览器里的一份新表格工程。env 可换（单测用记忆体清单＋假 OPFS）。 */
export async function guestImportWorkbook(env: ProjectEnv, file: File): Promise<SheetHostResult<SheetImportResult>> {
  const fileName = (file.name || '').slice(0, 255)
  if (!SHEET_EXT.test(fileName) && !SHEET_MIMES.has(file.type)) return fail(400, 'err_xlsx_not_spreadsheet')
  const io = await import('../engine/xlsx-io')   // SheetJS 不进主包
  if (file.size > io.IMPORT_MAX_BYTES) return fail(413, 'err_xlsx_too_large')
  let parsed: import('../engine/xlsx-io').ImportResult
  try {
    parsed = io.parseXlsx(new Uint8Array(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof io.XlsxError) return fail(e.code === 'err_xlsx_too_large' ? 413 : 400, e.code)
    return fail(400, 'err_xlsx_bad_file')
  }

  // 图：写进新工程的 assets/（只收 png／jpeg／gif·同服务端那路）；收不了的略过记数
  const assets: ProjectPayload['assets'] = []
  let skipped = 0
  for (const im of parsed.images) {
    const content = parsed.sheets[im.sheet]?.content
    const mime = io.sniffImageMime(im.bytes)
    if (!content || !mime || !IMAGE_EXT[mime]) { skipped++; continue }
    const name = `img-${Date.now().toString(36)}-${randomTag()}.${IMAGE_EXT[mime]}`
    assets.push({ name, data: new Blob([im.bytes as Uint8Array<ArrayBuffer>], { type: mime }) })
    content.images = [...(content.images ?? []), { ...im.image, url: `assets/${name}` }]
  }
  if (skipped) parsed.warnings.push(`${skipped} picture(s) from the file could not be saved to the project and were left out.`)

  // 全部先净化＋量完（任一张坏／超 2MB ⇒ 整份不建）
  const tabs: SheetTab[] = []
  const sheets: { id: string; name: string; content: unknown }[] = []
  for (const s of parsed.sheets) {
    const clean = sanitizeSheetContent(s.content, { assetUrls: true })
    if (!clean) return fail(400, 'err_sheet_bad_content')
    if (new TextEncoder().encode(JSON.stringify(clean)).length > SHEET_CONTENT_MAX_BYTES) return fail(413, 'content_too_large')
    const name = normalizeSheetName(s.name) || nextSheetName(tabs)
    tabs.push({ id: String(tabs.length), name, position: tabs.length })
    sheets.push({ id: newSheetId(), name, content: clean })
  }

  let made = ''
  try {
    const taken = new Set((await env.registry.list('sheets')).map(r => r.name))
    const title = uniqueName((fileName.replace(SHEET_EXT, '').trim() || UNTITLED).slice(0, 110), taken)
    const payload: ProjectPayload = { json: { format: formatTag('sheets'), version: SHEETS_FORMAT_VERSION, name: title, sheets }, assets }
    const rec = await createOpfsProject({ ...env, newId: () => (made = env.newId()) }, { app: 'sheets', format: sheetsFormat }, title, payload)
    return { ok: true, status: 201, data: { id: rec.id, title: rec.name, href: studioHref.project('sheets', rec.id), warnings: parsed.warnings } }
  } catch {
    // 建到一半（例如浏览器储存满了）⇒ 收掉那半份·不留在清单里
    if (made) { await env.deleteOpfs('sheets', made).catch(() => {}); await env.registry.remove(made).catch(() => {}) }
    return fail(0, 'err_xlsx_import_failed')
  }
}

/** 游客宿主补的那一支：给 importWorkbook（负控开药 ⇒ 不给）。env 缺 ⇒ 浏览器那组（OPFS＋IndexedDB）。 */
export function guestSheetIoHost(env: ProjectEnv = browserProjectEnv): Pick<SheetsPageHost, 'importWorkbook'> {
  if (studioNeg(GUEST_SHEET_IMPORT_NEG)) return {}
  return { importWorkbook: file => guestImportWorkbook(env, file) }
}
