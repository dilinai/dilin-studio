// Dilin Studio · Paint — the module the studio shell loads (shared/registry.ts).
//   guestPage＝same full page as the signed-in /drawboard (page/DrawboardPage.tsx), with the guest host (local project).
//   Editor＝the same page for the older StudioShell path (placeholder host for the drive / AI slots).
import type { StudioApp } from '../shared/types'
import PaintGuestEditor from './page/guest-placeholder'
import GuestPaintPage, { PAINT_GUEST_FEATURES } from './page/GuestPaintPage'
import { paintFormat, type PaintDoc } from './format'
import { PAINT_I18N } from './i18n'
import { buildPaintExport, EXPORT_AI, EXPORT_PSD, savePsdForOtherApps } from './export-project'

const paint: StudioApp<PaintDoc> = {
  app: 'paint',
  Editor: PaintGuestEditor,
  guestPage: GuestPaintPage,
  // has() 功能表：画板整页问的几项（角色对话、角色动手画、云端硬碟树）游客版都没有
  guestFeatures: PAINT_GUEST_FEATURES,
  format: paintFormat,
  i18n: PAINT_I18N,
  // the engine stays open across outside edits: only the drawing is re-read
  softReload: true,
  // 「匯出工程檔」先弹勾选：附上分层 PSD（引擎自己的 PSD 写法·Photoshop 开得到每一层）
  exportOptions: [{ id: EXPORT_PSD, label: 'paint_export_psd' }, { id: EXPORT_AI, label: 'paint_export_ai' }],
  buildExport: (store, ctx) => buildPaintExport(store, ctx),
  // 开源单机版右栏「存给别家软件」：把分层 project.psd 与 project.ai 写进工程资料夹
  saveForOtherApps: { label: 'paint_save_psd', hint: 'paint_save_psd_hint', build: savePsdForOtherApps },
}
export default paint
