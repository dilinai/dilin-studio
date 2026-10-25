// Dilin Studio · Docs — jobs from the local MCP (tools/agent-mcp.mjs) on the open docs page:
//   read ⇒ the doc's markdown (with name, length, free-placed layer count);
//   edit ⇒ a list of small edits, all or none: {append} adds at the end, {old_text, new_text} replaces the one exact passage
//          (same rules as the website's edit_doc), {name} renames. The page saves it and reloads, so each call shows on screen.
// Pure (tests call it directly) — no DOM, no store.
import type { DocsDoc } from './format'

export type DocsAgentReply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }
export type DocsAgentOut = { reply: DocsAgentReply; next?: DocsDoc }

export const DOCS_EDITS_MAX = 50
export const DOCS_CONTENT_MAX = 2_000_000

const bad = (message: string): DocsAgentOut => ({ reply: { ok: false, error: 'bad_params', message } })

export function docsAgentJob(doc: DocsDoc, job: { kind?: unknown; edits?: unknown; offset?: unknown; limit?: unknown }): DocsAgentOut {
  if (job.kind === 'read') {
    const off = Number.isInteger(job.offset) && (job.offset as number) > 0 ? (job.offset as number) : 0
    const lim = Number.isInteger(job.limit) && (job.limit as number) > 0 ? Math.min(job.limit as number, 200_000) : 200_000
    const part = doc.content.slice(off, off + lim)
    return { reply: { ok: true, result: { name: doc.name, chars: doc.content.length, offset: off, next_offset: off + part.length < doc.content.length ? off + part.length : null, content: part, layers: doc.layers?.items.length ?? 0 } } }
  }
  if (job.kind !== 'edit') return bad(`unknown kind ${String(job.kind)}`)
  const edits = job.edits
  if (!Array.isArray(edits) || !edits.length || edits.length > DOCS_EDITS_MAX) return bad(`edits must be an array of 1–${DOCS_EDITS_MAX} items`)
  let content = doc.content
  let name = doc.name
  const results: Array<Record<string, unknown>> = []
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i] as Record<string, unknown> | null
    const where = `Edit ${i}: `
    if (!e || typeof e !== 'object' || Array.isArray(e)) return bad(`${where}must be an object`)
    const keys = Object.keys(e)
    if (typeof e.name === 'string' && keys.length === 1) {
      const n = e.name.trim().slice(0, 200)
      if (!n) return bad(`${where}name is empty`)
      name = n; results.push({ edit: i, renamed: n }); continue
    }
    const isAppend = typeof e.append === 'string'
    const isReplace = 'old_text' in e || 'new_text' in e
    const unknown = keys.filter((k) => !['append', 'old_text', 'new_text'].includes(k))
    if (unknown.length) return bad(`${where}unknown field ${unknown.map((k) => `'${k}'`).join(', ')} (use append, old_text + new_text, or name)`)
    if (isAppend === isReplace) return bad(`${where}give either append, or old_text + new_text`)
    if (isAppend) {
      const a = e.append as string
      if (!a.trim()) return bad(`${where}append is empty`)
      content = content && !content.endsWith('\n') ? `${content}\n${a}` : `${content}${a}`
      results.push({ edit: i, appended: a.length })
      continue
    }
    if (typeof e.old_text !== 'string' || !e.old_text || typeof e.new_text !== 'string') return bad(`${where}replacing needs old_text (non-empty) and new_text (empty string deletes)`)
    const n = content.split(e.old_text).length - 1
    if (n === 0) return { reply: { ok: false, error: 'command_failed', message: `${where}old_text was not found (it must match exactly — read the doc again and copy it). Nothing was changed.` } }
    if (n > 1) return { reply: { ok: false, error: 'command_failed', message: `${where}old_text occurs ${n} times — include more surrounding words so it is unique. Nothing was changed.` } }
    const at = content.indexOf(e.old_text)
    content = content.slice(0, at) + e.new_text + content.slice(at + e.old_text.length)
    results.push({ edit: i, replaced: true })
  }
  if (content.length > DOCS_CONTENT_MAX) return { reply: { ok: false, error: 'command_failed', message: `the doc would be over ${DOCS_CONTENT_MAX} characters. Nothing was changed.` } }
  const changed = content !== doc.content || name !== doc.name
  return { reply: { ok: true, result: { changed, results, chars: content.length } }, ...(changed ? { next: { ...doc, content: content.replace(/\r\n?/g, '\n'), name } } : {}) }
}
