// Dilin Studio · Paint — load / save a project through the studio storage layer (a local folder or the browser's OPFS).
import type { ProjectStore, StudioFormat, StudioLang } from '../shared/types'
import { StudioError } from '../shared/types'
import { readProjectJson, writeProjectJson } from '../shared/project-file'
import { ASSETS_DIR, PAINT_VERSION, assetRefs, bodyToEngine, checkProject, emptyProject, engineToBody, fromFolder, staleOwnAssets, toFolder, type Sha256, webSha256 } from './project-folder.pure'
import { paintFormatNotes } from './ai-brief'

/** the engine's own project JSON (images inline as data URLs) — what the paint engine loads and serializes */
export type PaintDoc = Record<string, unknown>

const blobBytes = async (b: Blob | null): Promise<Uint8Array | null> => (b ? new Uint8Array(await b.arrayBuffer()) : null)

/** read project.json + assets/ ⇒ engine JSON, plus which referenced asset files were not found.
 *  No project.json ⇒ a new blank project (fresh: true). Bad header / shape ⇒ throws StudioError. */
export async function loadPaintDetailed(store: ProjectStore): Promise<{ doc: PaintDoc; missing: string[]; fresh: boolean; pages: number; name?: string }> {
  const json = await readProjectJson(store, 'paint', PAINT_VERSION)
  if (json === null) return { doc: emptyProject(), missing: [], fresh: true, pages: 1 }
  const c = checkProject(json)
  if (!c.ok) throw new StudioError('bad_format', c.error)
  // a multi-page file from the signed-in site: the top level is page 1, "pages" holds pages 2…; only page 1 is edited here
  const { pages: extra, name, ...page1 } = json as Record<string, unknown>
  const pages = 1 + (Array.isArray(extra) ? extra.length : 0)
  const { project, missing } = await fromFolder(page1, async (p) => blobBytes(await store.readAsset(p.slice(ASSETS_DIR.length + 1))))
  return { doc: bodyToEngine(project as Record<string, unknown>), missing, fresh: false, pages, name: typeof name === 'string' ? name : undefined }
}

/** engine JSON ⇒ assets/ (new files only) then project.json, then remove editor-named assets nobody uses any more */
/** extra.name ⇒ written into project.json (the engine does not keep the project name; pass the loaded one back) */
export async function savePaint(store: ProjectStore, doc: PaintDoc, sha: Sha256 = webSha256, extra?: { name?: string }): Promise<{ wrote: number; removed: number; json: Record<string, unknown> }> {
  const { json, assets } = await toFolder(engineToBody(doc), sha)
  const have = new Set((await store.listAssets()).map((a) => a.name))
  let wrote = 0
  for (const [path, bytes] of assets) {
    const name = path.slice(ASSETS_DIR.length + 1)
    if (have.has(name)) continue   // content-named: same name ⇒ same bytes
    await store.writeAsset(name, bytes); wrote++
  }
  const body = json as Record<string, unknown>
  await writeProjectJson(store, 'paint', PAINT_VERSION, extra?.name !== undefined ? { name: extra.name, ...body } : body)
  let removed = 0
  for (const f of staleOwnAssets([...have], json)) { try { await store.deleteAsset(f); removed++ } catch { /* the next save retries */ } }
  return { wrote, removed, json: json as Record<string, unknown> }
}

/** asset paths referenced by project.json that are not in assets/ (for the "missing files" notice) */
export async function missingAssets(store: ProjectStore, json: unknown): Promise<string[]> {
  const have = new Set((await store.listAssets()).map((a) => `${ASSETS_DIR}/${a.name}`))
  return [...assetRefs(json)].filter((p) => !have.has(p))
}

export const paintFormat: StudioFormat<PaintDoc> = {
  version: PAINT_VERSION,
  emptyProject: () => emptyProject(),
  load: async (store) => (await loadPaintDetailed(store)).doc,
  save: async (store, doc) => { await savePaint(store, doc) },
  summaryForAI: (lang: StudioLang) => paintFormatNotes(lang),
}
