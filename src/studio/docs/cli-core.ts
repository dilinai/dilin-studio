// Dilin Studio · 文件命令列版的核心（tools/docs-cli.mjs 用；tools/build.mjs 另打成 app/docs-cli-core.mjs·node 跑）。
//   读档检查、命令表、改正文（同本机 MCP docs_edit＝agent-job.pure）、Markdown 汇出都是纯函数 ⇒ 不用开浏览器。
//   Word、PDF 要排版（浏览器的 DOM、列印）⇒ 命令列借无头浏览器开同一套页面做（页面那边见 cli-export.ts）。
import { checkProjectHeader, formatTag } from '../shared/project-file'
import { assetNameFromSrc, docsDocFromJson, docsDocToJson, DOCS_FORMAT_VERSION, type DocsDoc } from './format'
import { parsePaperSettings } from './core/paper-size'
import { sanitizeDocLayer } from './core/doc-layers/types'
import { docsAgentJob, DOCS_EDITS_MAX } from './agent-job.pure'

export type CliIssue = { code: string; text: string }

const NEG = (k: string) => typeof process !== 'undefined' && process.env?.DILIN_NEG === k

/** 正文与自由组件里引用的 assets/<档名>（去重·照出现顺序） */
export function assetRefs(doc: DocsDoc): string[] {
  const out = new Set<string>()
  for (const m of doc.content.matchAll(/assets\/[^\s"'()<>\]\\]+/g)) { const n = assetNameFromSrc(m[0]); if (n) out.add(n) }
  for (const it of doc.layers?.items ?? []) {
    for (const s of [(it as { src?: unknown }).src, (it as { poster?: unknown }).poster]) { if (typeof s === 'string') { const n = assetNameFromSrc(s); if (n) out.add(n) } }
  }
  return [...out]
}

/**
 * 读 project.json（字串或物件）⇒ doc＋读档报告（编辑页开档时会丢掉／改回缺省的每一条）＋引用到的素材档名。
 * 表头不对、content 不是字串阵列 ⇒ 丢错（编辑页也开不了）。
 */
export function cliLoad(raw: unknown): { doc: DocsDoc; issues: CliIssue[]; assets: string[] } {
  const j = checkProjectHeader(typeof raw === 'string' ? JSON.parse(raw) : raw, 'docs', DOCS_FORMAT_VERSION)
  const doc = docsDocFromJson(j)
  const issues: CliIssue[] = []
  if (!NEG('docs-cli-check-blind')) {
    if (j.paper !== undefined && !parsePaperSettings(j.paper)) issues.push({ code: 'paper_bad', text: `paper 讀不懂（${JSON.stringify(j.paper).slice(0, 80)}）⇒ 當成不分頁（paper: null）` })
    if (j.name !== undefined && typeof j.name !== 'string') issues.push({ code: 'name_bad', text: 'name 不是字串 ⇒ 當成沒名字' })
    const raws = j.layers == null ? [] : Array.isArray(j.layers) ? j.layers : Array.isArray((j.layers as { items?: unknown }).items) ? (j.layers as { items: unknown[] }).items : null
    if (raws === null) issues.push({ code: 'layers_bad', text: 'layers 不是 { "items": [...] } ⇒ 整組丟掉' })
    else {
      const seen = new Set<string>()
      raws.forEach((it, k) => {
        const s = sanitizeDocLayer(it)
        const id = it && typeof it === 'object' && typeof (it as { id?: unknown }).id === 'string' ? (it as { id: string }).id : `#${k + 1}`
        if (!s) issues.push({ code: 'layer_dropped', text: `自由組件 ${id} 欄位不合規則（id、kind、page、x/y/w/h、src）⇒ 丟掉` })
        else if (seen.has(s.id)) issues.push({ code: 'layer_dup', text: `自由組件 id ${s.id} 重複 ⇒ 後面那個丟掉` })
        else seen.add(s.id)
      })
    }
  }
  return { doc, issues, assets: assetRefs(doc) }
}

/** doc ⇒ project.json 全文（表头在前·跟编辑页存的一样） */
export function cliSave(doc: DocsDoc): string {
  return JSON.stringify({ format: formatTag('docs'), version: DOCS_FORMAT_VERSION, ...docsDocToJson(doc) }, null, 2) + '\n'
}

/** 命令表：run --steps 的每一步（同本机 MCP docs_edit 的 edits·同网站 edit_doc 的规矩） */
export const CLI_COMMANDS = [
  { id: 'append', params: [{ name: 'append', type: 'string', required: true, description: '接在正文最後的 markdown（自動換行接上）' }], description: '在文件最後加一段', example: { append: '## 新的一節\n\n內文' } },
  { id: 'replace', params: [{ name: 'old_text', type: 'string', required: true, description: '正文裡要換掉的那一段，要一字不差、而且只出現一次' }, { name: 'new_text', type: 'string', required: true, description: '換成什麼；空字串＝刪掉' }], description: '把正文裡唯一的一段換成新的', example: { old_text: '舊句子', new_text: '新句子' } },
  { id: 'rename', params: [{ name: 'name', type: 'string', required: true, description: '新的文件名（1–200 字）' }], description: '改文件名（只能單獨一個欄位）', example: { name: '旅行筆記' } },
] as const

export function cliCommands(filter?: string) {
  const f = (filter ?? '').trim().toLowerCase()
  return f ? CLI_COMMANDS.filter((c) => c.id.includes(f) || c.description.toLowerCase().includes(f) || c.params.some((p) => p.name.includes(f))) : [...CLI_COMMANDS]
}

/** 跑一批改动（全有或全无·最多 DOCS_EDITS_MAX 步）⇒ 新 doc＋每步结果；出错回哪一步、为什么 */
export function cliRun(doc: DocsDoc, steps: unknown[]): { ok: true; doc: DocsDoc; changed: boolean; results: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(steps) || !steps.length) return { ok: false, error: '要給至少一步' }
  if (NEG('docs-cli-run-partial')) {
    // 负控：一步一步套、错了也留着前面的（＝不是全有或全无）
    let cur = doc
    for (const s of steps) { const r = docsAgentJob(cur, { kind: 'edit', edits: [s] }); if (r.next) cur = r.next }
    return { ok: true, doc: cur, changed: cur !== doc, results: [] }
  }
  if (steps.length > DOCS_EDITS_MAX) return { ok: false, error: `一次最多 ${DOCS_EDITS_MAX} 步（分幾次跑）` }
  const r = docsAgentJob(doc, { kind: 'edit', edits: steps })
  if (!r.reply.ok) return { ok: false, error: `${r.reply.message ?? r.reply.error}${/Nothing was changed/.test(r.reply.message ?? '') ? '' : ' Nothing was changed.'}` }
  const res = r.reply.result as { changed: boolean; results: unknown[] }
  // 写回前再过一次读档（同编辑页开档）：改出编辑页读不进的东西 ⇒ 当错
  const next = r.next ? docsDocFromJson(JSON.parse(cliSave(r.next))) : doc
  return { ok: true, doc: next, changed: res.changed, results: res.results }
}

/** 读正文（同 docs_read）：offset／limit 是字数 */
export function cliRead(doc: DocsDoc, o: { offset?: number; limit?: number } = {}): unknown {
  const r = docsAgentJob(doc, { kind: 'read', offset: o.offset, limit: o.limit })
  return r.reply.ok ? { ...(r.reply.result as object), paper: doc.paper } : r.reply
}

export const CLI_EXPORT_FORMATS = ['md', 'docx', 'pdf'] as const
export type CliExportFormat = typeof CLI_EXPORT_FORMATS[number]
/** 要开浏览器排版的（同编辑页那颗钮：Word＝浏览器里组 .docx；PDF＝纸张视图的「列印」） */
export const BROWSER_EXPORT_FORMATS: readonly CliExportFormat[] = ['docx', 'pdf']

export const exportBaseName = (doc: DocsDoc): string => (doc.name || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)

/** Markdown 汇出（同编辑页「Markdown」那颗：正文原文；自由组件不在 markdown 里） */
export function cliExportMd(doc: DocsDoc): { name: string; text: string; notes: string[] } {
  const n = doc.layers?.items.length ?? 0
  return { name: `${exportBaseName(doc)}.md`, text: doc.content, notes: n ? [`${n} 個自由組件（文字方塊、圖片等）不在 Markdown 裡`] : [] }
}
