// 表格编辑器交给底座的唯一出口（介面见 ../shared/types.ts）。
//   guestPage＝照登入版搬来的整页（page/SheetPage.tsx·游客宿主见 page/guest.tsx）；Editor＝旧外框把它当编辑器挂时的同一份整页。
import type { StudioApp } from '../shared/types'
import SheetsGuestPage, { SheetsGuestEditor } from './page/guest'
import { sheetsFormat, type SheetsDoc } from './format'
import { SHEETS_I18N } from './i18n'
import { sheetsAgentJob } from './agent-job.pure'

//   guestFeatures：顶栏「匯入 xlsx／csv」（浏览器本机读档建新工程·page/guest-import.ts）、「匯出 csv」（纯前端）游客版也开。
const app: StudioApp<SheetsDoc> = {
  app: 'sheets', Editor: SheetsGuestEditor, guestPage: SheetsGuestPage, format: sheetsFormat, i18n: SHEETS_I18N,
  guestFeatures: { xlsxImport: true, csvExport: true },
  // 单机版本机 MCP：sheets_read／sheets_run（网站 update_cells 同一支 agent-ops）
  agentJob: sheetsAgentJob,
}
export default app
