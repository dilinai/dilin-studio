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
  // 单机版命令列 tools/docs-cli.mjs 的 Word 汇出（无头页里跑·同「Word」那颗）
  cliExport: (store, format, t) => import('./cli-export').then((m) => m.docsCliExport(store, format, t)),
}

export default app
