// Dilin Studio · Paint — project folder format (pure, isomorphic: runs in the browser and in node tests).
//
// The paint engine (public/drawboard-app) serializes a document as one JSON object whose pixel data are
// inline `data:image/...;base64,` strings. On disk we keep the same JSON, but every inline image becomes a
// file under `assets/` and the JSON holds its relative path instead. That keeps `project.json` small and
// readable, so a local AI (Claude Code, Codex, …) can open it, edit it and save it back.
//
//   project.json          the engine JSON with images replaced by "assets/<name>.<ext>"; its header is
//                         "format": "dilin-studio/paint", "version": 1 (the engine itself calls its format "dilin-canvas")
//   assets/<sha16>.png    images written by the editor (name = first 16 hex chars of the content's SHA-256)
//   assets/<any>.png      images an AI or a person added by hand (any safe name; referenced from project.json)
//
// Rules (also in FORMAT.md):
//   save: every string anywhere in the JSON that is a base64 image data URL ⇒ written to assets/, replaced by its path.
//   load: every string anywhere in the JSON of the form "assets/<name>.<png|jpg|jpeg|webp|gif|svg>" whose file
//         exists ⇒ replaced by a data URL of that file. Paths whose file is missing are left as they are.
//   cleanup after save: editor-named assets (16 hex chars) no longer referenced are deleted; hand-named ones are kept.
// Import rule: this directory may only import itself, shared and npm packages.

/** what the engine writes in its own "format" field */
export const ENGINE_FORMAT = 'dilin-canvas'
export const ENGINE_VERSION = 1
/** project.json header (shared/project-file.ts checks it) */
export const PAINT_VERSION = 1
export const ASSETS_DIR = 'assets'

/** engine JSON ⇒ project.json body (header fields removed; the studio writes its own header) */
export function engineToBody(engine: unknown): Record<string, unknown> {
  const { format: _f, version: _v, ...rest } = (engine && typeof engine === 'object' ? engine : {}) as Record<string, unknown>
  void _f; void _v
  return rest
}
/** project.json (any header) ⇒ engine JSON */
export function bodyToEngine(body: Record<string, unknown>): Record<string, unknown> {
  const { format: _f, version: _v, ...rest } = body
  void _f; void _v
  return { format: ENGINE_FORMAT, version: ENGINE_VERSION, ...rest }
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
}
const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }

/** "data:image/png;base64,...." ⇒ { mime, b64 }; anything else ⇒ null */
const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]*)$/
/** a reference to a file in assets/ (no sub-folders, no "..", safe characters only) */
export const ASSET_REF = /^assets\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})\.(png|jpe?g|webp|gif|svg)$/i
/** editor-written asset file name */
const OWN_NAME = /^[0-9a-f]{16}\.(png|jpg|webp|gif|svg)$/

export function parseDataUrl(s: string): { mime: string; b64: string } | null {
  const m = DATA_URL.exec(s)
  return m ? { mime: m[1], b64: m[2].replace(/\s+/g, '') } : null
}
export const isAssetRef = (s: unknown): s is string => typeof s === 'string' && ASSET_REF.test(s) && !s.includes('..')

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)))
  return btoa(s)
}

/** walk every string in a JSON tree; fn returns a replacement or undefined (keep). Returns a new tree, input untouched. */
async function mapStrings(v: unknown, fn: (s: string) => Promise<string | undefined>): Promise<unknown> {
  if (typeof v === 'string') { const r = await fn(v); return r === undefined ? v : r }
  if (Array.isArray(v)) { const out: unknown[] = []; for (const x of v) out.push(await mapStrings(x, fn)); return out }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = await mapStrings(x, fn)
    return out
  }
  return v
}
/** every asset path referenced anywhere in a JSON tree */
export function assetRefs(v: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') { if (isAssetRef(v)) into.add(v) }
  else if (Array.isArray(v)) for (const x of v) assetRefs(x, into)
  else if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) assetRefs(x, into)
  return into
}

export type Sha256 = (bytes: Uint8Array) => Promise<Uint8Array>
export const webSha256: Sha256 = async (bytes) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource))
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** engine JSON ⇒ { json for project.json, files to write into assets/ } (same image ⇒ same file, written once) */
export async function toFolder(project: unknown, sha: Sha256 = webSha256): Promise<{ json: unknown; assets: Map<string, Uint8Array> }> {
  const assets = new Map<string, Uint8Array>()
  const json = await mapStrings(project, async (s) => {
    if (!s.startsWith('data:image/')) return undefined
    const d = parseDataUrl(s)
    if (!d) return undefined
    const bytes = b64ToBytes(d.b64)
    const name = `${hex(await sha(bytes)).slice(0, 16)}.${MIME_EXT[d.mime]}`
    const path = `${ASSETS_DIR}/${name}`
    if (!assets.has(path)) assets.set(path, bytes)
    return path
  })
  return { json, assets }
}

/** project.json (parsed) ⇒ engine JSON. read(path) returns the file bytes or null if it does not exist. */
export async function fromFolder(json: unknown, read: (path: string) => Promise<Uint8Array | null>): Promise<{ project: unknown; missing: string[] }> {
  const missing: string[] = []
  const cache = new Map<string, string | null>()
  const project = await mapStrings(json, async (s) => {
    if (!isAssetRef(s)) return undefined
    if (!cache.has(s)) {
      const bytes = await read(s)
      const ext = (ASSET_REF.exec(s)?.[2] || 'png').toLowerCase()
      cache.set(s, bytes ? `data:${EXT_MIME[ext]};base64,${bytesToB64(bytes)}` : null)
      if (!bytes) missing.push(s)
    }
    return cache.get(s) ?? undefined
  })
  return { project, missing }
}

/** files in assets/ that the editor wrote and the project no longer references (safe to delete after a save) */
export function staleOwnAssets(files: readonly string[], json: unknown): string[] {
  const used = assetRefs(json)
  return files.filter((f) => OWN_NAME.test(f) && !used.has(`${ASSETS_DIR}/${f}`))
}

export type CheckResult = { ok: true } | { ok: false; error: string }
/** shape check of the paint fields before handing a project to the engine (the header is checked by the studio;
 *  the engine reports per-layer errors itself) */
export function checkProject(v: unknown): CheckResult {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'project.json is not a JSON object' }
  const p = v as Record<string, unknown>
  const side = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 20000
  if (!side(p.width) || !side(p.height)) return { ok: false, error: '"width" and "height" must be whole numbers from 1 to 20000' }
  if (!Array.isArray(p.layers)) return { ok: false, error: '"layers" must be an array' }
  for (const L of p.layers) {
    if (!L || typeof L !== 'object' || typeof (L as Record<string, unknown>).id !== 'string') return { ok: false, error: 'every layer needs a string "id"' }
  }
  return { ok: true }
}

/** a new blank project (the editor opens it as a white canvas) */
export const emptyProject = (width = 1200, height = 675): Record<string, unknown> => ({ format: ENGINE_FORMAT, version: ENGINE_VERSION, createdBy: 'Dilin Studio', width, height, layers: [] as unknown[] })

/** one-paragraph state summary for the "copy for your AI" block */
export function summarize(json: unknown): string {
  const p = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const layers = Array.isArray(p.layers) ? (p.layers as Array<Record<string, unknown>>) : []
  const kinds = new Map<string, number>()
  for (const L of layers) { const k = String(L.kind ?? '?'); kinds.set(k, (kinds.get(k) || 0) + 1) }
  const list = layers.slice(0, 30).map((L) => `${L.id} ${L.kind} "${L.name ?? ''}"${L.visible === false ? ' (hidden)' : ''}`).join('; ')
  return `Canvas ${p.width}×${p.height}, ${layers.length} layer(s)` +
    (kinds.size ? ` (${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')})` : '') +
    (list ? `. Bottom to top: ${list}${layers.length > 30 ? '; …' : ''}.` : '.')
}
