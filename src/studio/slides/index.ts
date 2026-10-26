// Dilin Studio · 简报编辑器（游客版入口）。底座照 StudioApp 介面载入。
//   guestPage＝跟登入版同一份整页（page/SlidesPage.tsx），宿主换成本机工程档那套（page/guest-page.tsx）。
import type { StudioApp } from '../shared/types'
import SlidesGuestPage, { SlidesGuestEditor } from './page/guest-page'
import { slidesFormat, type SlidesDoc } from './format'
import { SLIDES_I18N } from './i18n'
import { slidesAgentJob } from './agent-job.pure'

const app: StudioApp<SlidesDoc> = {
  app: 'slides',
  Editor: SlidesGuestEditor,
  format: slidesFormat,
  i18n: SLIDES_I18N,
  guestPage: SlidesGuestPage,
  // 单机版本机 MCP：slides_read／slides_run（网站简报组件工具同一支 applyComponentOp）
  agentJob: slidesAgentJob,
  // 单机版命令列 tools/slides-cli.mjs 的网页版／PowerPoint 汇出（无头页里跑·同「html」「pptx」那两颗）
  cliExport: (store, format, t) => import('./cli-export').then((m) => m.slidesCliExport(store, format, t)),
}
export default app
