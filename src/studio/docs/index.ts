// Dilin Studio · Docs：游客版文件编辑器交给底座的模块。
//   guestPage＝跟登入版同一份整页（page/DocsPage.tsx）；Editor＝旧外框（StudioShell）也能开的同一份（两格先放占位）。
import type { StudioApp } from '../shared/types'
import GuestDocsPage, { GuestDocsEditor } from './page/guest/GuestDocsPage'
import { docsFormat, type DocsDoc } from './format'
import { DOCS_I18N } from './i18n'
import { docsAgentJob } from './agent-job.pure'

const app: StudioApp<DocsDoc> = {
  app: 'docs',
  Editor: GuestDocsEditor,
  guestPage: GuestDocsPage,
  format: docsFormat,
  i18n: DOCS_I18N,
  // 单机版本机 MCP：docs_read／docs_edit（读 markdown·局部改）
  agentJob: docsAgentJob,
}

export default app
