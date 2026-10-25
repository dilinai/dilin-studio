// Dilin Studio · Paint — files an AI (or the command-line tool) can take out of the open drawboard:
//   psd     ＝ layered Photoshop file, written by the engine's own PSD writer (the same one as File ▸ Save As ▸ PSD)
//   ai      ＝ layered Illustrator file (PDF-compatible .ai; one PDF layer per layer, vector shapes as paths, text as editable text; engine aiEncodeDoc)
//   psb     ＝ the same layered Photoshop file in the Large Document Format (.psb)
//   ora     ＝ layered OpenRaster file (Krita, GIMP and MyPaint open it; groups, visibility, opacity, blend modes; text and shapes as pixels; engine oraEncodeDoc)
//   png     ＝ the flattened picture at full size
//   project ＝ project.json＋assets/ as saved in the project (flushed first)
// Also the page side of the local MCP jobs `export` and `load` (load only on a page opened by tools/paint-cli.mjs).
import type { ProjectStore } from '../../shared/types'
import { readAll } from '../../shared/zip'
import { canvasPng, type DlSite } from './drawboard-host'

export const PSD_FILE = 'project.psd'
export const AI_FILE = 'project.ai'
export const PSB_FILE = 'project.psb'
export const ORA_FILE = 'project.ora'
export const PNG_FILE = 'export.png'
export const EXPORT_FORMATS = ['psd', 'psb', 'ai', 'ora', 'png', 'project'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

type PsdWindow = Window & { PsFile?: { psd?: { encodeDoc(withLayers: boolean, o?: { psb?: boolean }): Uint8Array }; ai?: { encodeDoc(): Promise<{ bytes: Uint8Array; notes: string[] }> }; ora?: { encodeDoc(): Promise<{ bytes: Uint8Array; notes: string[] }> } } }

/** the open document as a layered PSD (groups, masks, clipping, blend modes and opacity kept; text layers stay editable text, plain vector layers become shape layers, layer styles Photoshop also has stay layer styles; the rest as pixels) */
export function psdBlob(site: DlSite, psb = false): Blob {
  const w = (site.doc?.defaultView ?? null) as PsdWindow | null
  const enc = w?.PsFile?.psd?.encodeDoc
  if (!enc) throw new Error('this drawboard cannot write PSD files (engine without the PSD writer)')
  const bytes = enc(true, { psb })
  return new Blob([bytes as BlobPart], { type: 'image/vnd.adobe.photoshop' })
}

/** the open document as a layered Illustrator file; notes ＝ what could not be kept as it is (e.g. a text layer with a style written as a picture) */
export async function aiFile(site: DlSite): Promise<{ blob: Blob; notes: string[] }> {
  const w = (site.doc?.defaultView ?? null) as PsdWindow | null
  const enc = w?.PsFile?.ai?.encodeDoc
  if (!enc) throw new Error('this drawboard cannot write Illustrator files (engine without the .ai writer)')
  const r = await enc()
  return { blob: new Blob([r.bytes as BlobPart], { type: 'application/postscript' }), notes: r.notes ?? [] }
}

/** the open document as a layered OpenRaster file; notes ＝ what ORA cannot hold (masks merged into the layer, clipping saved as plain layers…) */
export async function oraFile(site: DlSite): Promise<{ blob: Blob; notes: string[] }> {
  const w = (site.doc?.defaultView ?? null) as PsdWindow | null
  const enc = w?.PsFile?.ora?.encodeDoc
  if (!enc) throw new Error('this drawboard cannot write OpenRaster files (engine without the .ora writer)')
  const r = await enc()
  return { blob: new Blob([r.bytes as BlobPart], { type: 'image/openraster' }), notes: r.notes ?? [] }
}

const toB64 = async (b: Blob): Promise<string> => {
  const u = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string): Uint8Array => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }

export type ExportedFile = { name: string; mime: string; base64: string; bytes: number }
type Reply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }

export type PageJobCtx = {
  site: DlSite
  store: ProjectStore
  /** save what is on screen into the project first */
  flush(): Promise<void>
  /** re-read the project from the store into the engine */
  reload(): Promise<void>
  /** the page was opened by tools/paint-cli.mjs (a throw-away headless page): `load` may replace its project */
  cli: boolean
}

async function exportFiles(c: PageJobCtx, format: ExportFormat, save: boolean): Promise<{ files: ExportedFile[]; saved: string[]; notes?: string[] }> {
  const out: { name: string; blob: Blob }[] = []
  let notes: string[] | undefined
  if (format === 'psd') out.push({ name: PSD_FILE, blob: psdBlob(c.site) })
  else if (format === 'psb') out.push({ name: PSB_FILE, blob: psdBlob(c.site, true) })
  else if (format === 'ora') { const r = await oraFile(c.site); out.push({ name: ORA_FILE, blob: r.blob }); notes = r.notes }
  else if (format === 'ai') { const r = await aiFile(c.site); out.push({ name: AI_FILE, blob: r.blob }); notes = r.notes }
  else if (format === 'png') out.push({ name: PNG_FILE, blob: (await canvasPng(c.site, 1)).blob })
  else {
    await c.flush()
    const p = await readAll(c.store)
    out.push({ name: 'project.json', blob: new Blob([JSON.stringify(p.json, null, 2) + '\n'], { type: 'application/json' }) })
    for (const a of p.assets) out.push({ name: `assets/${a.name}`, blob: a.data })
  }
  const saved: string[] = []
  // a project kept in a folder: psd / psb / ai / ora / png also land next to project.json (the AI working in that folder finds them there)
  if (save && format !== 'project' && c.store.writeExtra) for (const f of out) { await c.store.writeExtra(f.name, f.blob); saved.push(f.name) }
  const files: ExportedFile[] = []
  for (const f of out) files.push({ name: f.name, mime: f.blob.type || 'application/octet-stream', base64: await toB64(f.blob), bytes: f.blob.size })
  return notes ? { files, saved, notes } : { files, saved }
}

/** jobs the drawboard runner (runRelayJob) does not know: export / load. null ⇒ not one of these. */
export async function paintPageJob(c: PageJobCtx, job: { kind?: unknown; format?: unknown; save?: unknown; json?: unknown; assets?: unknown }): Promise<Reply | null> {
  if (job.kind === 'export') {
    const f = String(job.format || 'psd').toLowerCase() as ExportFormat
    if (!EXPORT_FORMATS.includes(f)) return { ok: false, error: 'bad_params', message: `format must be one of ${EXPORT_FORMATS.join(', ')}` }
    try { return { ok: true, result: await exportFiles(c, f, job.save !== false) } } catch (e) { return { ok: false, error: 'command_failed', message: e instanceof Error ? e.message : String(e) } }
  }
  if (job.kind === 'load') {
    if (!c.cli) return { ok: false, error: 'not_available', message: 'only a page opened by tools/paint-cli.mjs can have its project replaced' }
    if (!job.json || typeof job.json !== 'object' || Array.isArray(job.json)) return { ok: false, error: 'bad_params', message: 'json must be the project.json object' }
    try {
      const assets = (job.assets && typeof job.assets === 'object' ? job.assets : {}) as Record<string, unknown>
      for (const [n, b] of Object.entries(assets)) if (typeof b === 'string') await c.store.writeAsset(n, fromB64(b))
      await c.store.writeJSON(job.json)
      await c.reload()
      return { ok: true, result: { loaded: true, assets: Object.keys(assets).length } }
    } catch (e) { return { ok: false, error: 'command_failed', message: e instanceof Error ? e.message : String(e) } }
  }
  return null
}

/** this tab was opened by tools/paint-cli.mjs (…&cli=1): read when the bundle loads — opening a new project rewrites the address (history.replaceState) and drops it */
export const OPENED_BY_CLI: boolean = (() => { try { return new URLSearchParams(window.location.search).get('cli') === '1' } catch { return false } })()

/** the drawboard open in this tab (the export dialog's PSD option reads it; null ⇒ no drawboard on screen) */
let live: DlSite | null = null
export const setLiveSite = (s: DlSite | null): void => { live = s }
export const liveSite = (): DlSite | null => live
