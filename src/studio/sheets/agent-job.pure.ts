// Dilin Studio · Sheets — jobs from the local MCP (tools/agent-mcp.mjs) on the open sheets page:
//   read ⇒ the tabs, plus cells of one tab by A1 range (input / value / display / format) — engine/agent-ops readRange;
//   run  ⇒ a list of ops on one tab, all or none — engine/agent-ops applyOps, the same ops the website's update_cells /
//          format_cells / insert_rows / merge / sort / set_chart / freeze / filter / validate send (op names in OP_NAMES).
//   The result is cleaned with sanitizeSheetContent like the website saves it. The page then saves and reloads.
//   insert/delete rows or columns ⇒ formulas on the other tabs that point at this tab (表格2!A5) move too (Excel) — same
//   shiftOtherSheetsForStruct as the website route; the reply lists them in cross_sheet.
// Pure (tests call it directly) — no DOM, no store.
import { applyOps, opSheetNames, OP_NAMES, OpError, readRange, shiftOtherSheetsForStruct, READ_DEFAULT_LIMIT, type AgentContent } from './engine/agent-ops'
import { sanitizeSheetContent } from './engine/content'
import type { SheetsDoc, SheetsTab } from './format'

export type SheetsAgentReply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }
export type SheetsAgentOut = { reply: SheetsAgentReply; next?: SheetsDoc }

/** ops that need the website (drive pictures) */
const WEBSITE_ONLY = new Set(['add_image'])
export const SHEET_CONTENT_MAX_BYTES = 2 * 1024 * 1024

const fail = (error: string, message: string): SheetsAgentOut => ({ reply: { ok: false, error, message } })
const tabList = (doc: SheetsDoc) => doc.sheets.map((t, i) => ({ id: t.id, name: t.name, position: i }))

/** 表名或 id ⇒ 那张表（缺省第一张）；找不到、同名多张 ⇒ 回说明字串（命令列版 cli-core 也用） */
export function pickSheet(doc: SheetsDoc, want: string | null): SheetsTab | string {
  if (!doc.sheets.length) return 'the project has no sheets'
  if (!want) return doc.sheets[0]
  const w = want.trim()
  const byId = doc.sheets.find((t) => t.id === w)
  if (byId) return byId
  let hits = doc.sheets.filter((t) => t.name === w)
  if (!hits.length) hits = doc.sheets.filter((t) => t.name.trim().toLowerCase() === w.toLowerCase())
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) return `several sheets are named "${w}" — pass the sheet id instead`
  return `no sheet named "${w}". Sheets: ${JSON.stringify(tabList(doc))}`
}

export function sheetsAgentJob(doc: SheetsDoc, job: { kind?: unknown; sheet?: unknown; range?: unknown; offset?: unknown; limit?: unknown; include_formats?: unknown; ops?: unknown }): SheetsAgentOut {
  const sheetIn = typeof job.sheet === 'string' && job.sheet.trim() ? job.sheet.trim() : null
  if (job.kind === 'read') {
    const range = typeof job.range === 'string' && job.range.trim() ? job.range.trim() : null
    const named = range && range.includes('!') ? range.slice(0, range.lastIndexOf('!')).replace(/^'(.*)'$/, '$1') : null
    if (named && sheetIn && named.toLowerCase() !== sheetIn.toLowerCase()) return fail('bad_params', `range names sheet "${named}" but sheet is "${sheetIn}"`)
    const tab = pickSheet(doc, sheetIn ?? named)
    if (typeof tab === 'string') return fail('bad_params', tab)
    try {
      const r = readRange(tab.content as AgentContent, {
        range: range ? range.replace(/^.*!/, '') : null,
        offset: Number.isInteger(job.offset) ? (job.offset as number) : undefined,
        limit: Number.isInteger(job.limit) ? (job.limit as number) : READ_DEFAULT_LIMIT,
        includeFormats: job.include_formats !== false,
      })
      return { reply: { ok: true, result: { sheet: { id: tab.id, name: tab.name }, sheets: tabList(doc), ...r } } }
    } catch (e) {
      if (e instanceof OpError) return fail('bad_params', e.message)
      throw e
    }
  }
  if (job.kind !== 'run') return fail('bad_job', `unknown kind ${String(job.kind)}`)
  const ops = job.ops
  if (!Array.isArray(ops) || !ops.length) return fail('bad_params', `ops must be a non-empty array of {op, …} (op is one of ${OP_NAMES.join(', ')})`)
  const web = ops.findIndex((o) => o && typeof o === 'object' && WEBSITE_ONLY.has(String((o as { op?: unknown }).op)))
  if (web >= 0) return fail('not_available', `ops[${web}] (add_image) needs the website (pictures come from the drive). Nothing was changed. Insert pictures in the editor instead.`)
  const named = opSheetNames(ops)
  if (named.length > 1) return fail('bad_params', 'all ops must target the same sheet (one call edits one sheet)')
  if (named.length === 1 && sheetIn && named[0].toLowerCase() !== sheetIn.toLowerCase() && !doc.sheets.some((t) => t.id === sheetIn && t.name.toLowerCase() === named[0].toLowerCase())) return fail('bad_params', `ops name sheet "${named[0]}" but sheet is "${sheetIn}"`)
  const tab = pickSheet(doc, sheetIn ?? named[0] ?? null)
  if (typeof tab === 'string') return fail('bad_params', tab)
  const opsIn = ops.map((o) => (o && typeof o === 'object' && typeof (o as { range?: unknown }).range === 'string')
    ? { ...(o as Record<string, unknown>), range: (o as { range: string }).range.replace(/^.*!/, '') }
    : o)
  let applied
  try { applied = applyOps(tab.content as AgentContent, opsIn, { sheetName: tab.name }) } catch (e) {
    if (e instanceof OpError) return fail('command_failed', `${e.message}\nNothing was changed (all ops apply together or not at all).`)
    throw e
  }
  const clean = sanitizeSheetContent(applied.content)
  if (!clean) return fail('command_failed', 'the sheet content came out invalid. Nothing was changed.')
  if (new TextEncoder().encode(JSON.stringify(clean)).length > SHEET_CONTENT_MAX_BYTES) return fail('command_failed', 'the sheet would be over 2 MB. Nothing was changed.')
  // other tabs: only their formulas change (no re-clean here — tabs were cleaned on load, with their assets/ picture urls)
  const others = shiftOtherSheetsForStruct(doc.sheets, tab.id, applied.structs)
  for (const o of others) if (new TextEncoder().encode(JSON.stringify(o.content)).length > SHEET_CONTENT_MAX_BYTES) return fail('command_failed', `sheet "${o.name}" would be over 2 MB after moving its references. Nothing was changed.`)
  const broken = others.reduce((n, o) => n + o.broken, 0)
  if (broken) applied.warnings.push(`${broken} formula reference(s) on other sheets pointed into the deleted rows/columns of "${tab.name}" and now read #REF!.`)
  const changed = others.length > 0 || JSON.stringify(clean) !== JSON.stringify(sanitizeSheetContent(tab.content) ?? { cells: {} })
  const next: SheetsDoc = { ...doc, sheets: doc.sheets.map((t) => {
    if (t.id === tab.id) return { ...t, content: clean }
    const o = others.find((x) => x.id === t.id)
    return o ? { ...t, content: o.content } : t
  }) }
  return {
    reply: { ok: true, result: { sheet: { id: tab.id, name: tab.name }, changed, results: applied.results, ...(others.length ? { cross_sheet: others.map((o) => ({ id: o.id, name: o.name })) } : {}), ...(applied.warnings.length ? { warnings: applied.warnings } : {}) } },
    ...(changed ? { next } : {}),
  }
}
