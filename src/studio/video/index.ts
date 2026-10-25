// Dilin Studio·剪辑编辑器（游客版）的接入口：整页＝登入版同一份（page/VideoEditPage.tsx），游客宿主在 page/guest.tsx。
//   guestPage：工程页整页渲染它（不套 StudioShell 外框）；Editor：只在外框不认 guestPage 时用（同一份整页盖满视窗·两格放占位）。
import type { StudioApp } from '../shared/types'
import VideoGuestPage, { GuestEditorAdapter, VIDEO_GUEST_FEATURES } from './page/guest'
import { EXPORT_EDL, EXPORT_FCPXML, EXPORT_JIANYING, EXPORT_OTIO, EXPORT_PREMIERE, EXPORT_PREVIEW, EXPORT_USED_ONLY, buildOtherAppFiles, buildVideoExport } from './export-project'
import { videoFormat, type VideoDoc } from './format'
import { VIDEO_I18N } from './i18n'

const app: StudioApp<VideoDoc> = {
  app: 'video', Editor: GuestEditorAdapter, guestPage: VideoGuestPage, guestFeatures: VIDEO_GUEST_FEATURES, format: videoFormat, i18n: VIDEO_I18N,
  // 外面（使用者自己的 AI）改了 project.json、手上没未存改动 ⇒ 整页读回换上（进复原栈），不重挂：播放头、捲动、面板、复原栈都留着
  outsideSoftReload: true,
  // 「匯出工程檔」先弹勾选小窗（缺省全不勾）：只打包时间轴用到的片段、影片压成预览品质、附 Final Cut／达芬奇工程档
  exportOptions: [
    { id: EXPORT_USED_ONLY, label: 'vedit_guest_export_used_only' },
    { id: EXPORT_PREVIEW, label: 'vedit_guest_export_preview' },
    { id: EXPORT_FCPXML, label: 'vedit_guest_export_fcpxml' },
    { id: EXPORT_JIANYING, label: 'vedit_guest_export_jianying' },
    { id: EXPORT_PREMIERE, label: 'vedit_guest_export_premiere' },
    { id: EXPORT_OTIO, label: 'vedit_guest_export_otio' },
    { id: EXPORT_EDL, label: 'vedit_guest_export_edl' },
  ],
  buildExport: (store, ctx) => buildVideoExport(store, ctx),
  // 开源单机版没有「下載到電腦」：右栏这颗把 .fcpxml（Final Cut／达芬奇）与 .xml（Premiere）直接写进工程资料夹根目录
  saveForOtherApps: { label: 'vedit_save_fcpxml', hint: 'vedit_save_fcpxml_hint', build: buildOtherAppFiles },
}
export default app
