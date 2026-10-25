// Dilin Studio · Paint — the editor session without any UI framework: wires the engine (in an iframe) to the
// project store. (The paint page itself now saves through page/guest-api.ts; this session is kept for its tests and format notes.)
//   • Save (menu, Ctrl+S) and an autosave AUTOSAVE_MS after the last edit write project.json + assets/.
//   • The studio shell watches project.json for outside edits; when it decides to reload it calls reload()
//     (via the `revision` prop), so the engine stays open and only the drawing is replaced.
//   • Open / Export (PNG, SVG, PSD …) keep the engine's own local behaviour (file picker / download).
//   • File ▸ Close on the drawing leaves the project (onLeave) instead of saving a blank canvas over it.
//   • A project with several pages (from the signed-in site) opens its first page only; autosave stays off and only
//     an explicit Save writes (which keeps the first page only).
import type { ProjectStore, SaveState, StudioLang } from '../shared/types'
import { isStudioError } from '../shared/types'
import { saveProjectSafe } from '../shared/store'
import { applyLanguage, claimHostTab, hideAgentHint, installHostClose, installSave, loadProject, serializeProject, siteOf, watchEdits, type DlSite } from './engine-bridge'
import { loadPaintDetailed, savePaint } from './format'
import type { PaintKey } from './i18n'

export const AUTOSAVE_MS = 1000
export const ENGINE_WAIT_MS = 60_000

/** a notice for the user (load problems only; save state goes to the shell) */
export type PaintNotice = { key: PaintKey; vars?: Record<string, string>; tone: 'muted' | 'error' } | null
export type PaintSessionOpts = {
  frame: HTMLIFrameElement
  store: ProjectStore
  lang: StudioLang
  name: string
  saveLabel: string
  onNotice?: (n: PaintNotice) => void
  onDirtyChange?: (dirty: boolean) => void
  onSaveStateChange?: (state: SaveState, detail?: string) => void
  /** File ▸ Close on the drawing: pending edits are autosaved first (unless held), then this runs */
  onLeave?: () => void
  autosaveMs?: number
}
/** user = menu / Ctrl+S (always writes); flush = the shell before export / folder change (not over a multi-page
 *  file); auto = autosave and leaving (neither over a multi-page file nor over an outside edit) */
export type SaveMode = 'user' | 'flush' | 'auto'
export type PaintSession = {
  /** resolves once the engine is up and the project is loaded (false = engine never started / project broken) */
  ready: Promise<boolean>
  /** write pending edits now (default mode 'user'; the shell's flush passes 'flush') */
  save(mode?: SaveMode): Promise<{ ok: boolean; error?: string }>
  /** re-read the project from the store (after the shell saw an outside edit) */
  reload(): Promise<boolean>
  setLang(lang: StudioLang): void
  dispose(): void
}

export function createPaintSession(o: PaintSessionOpts): PaintSession {
  const autosaveMs = o.autosaveMs ?? AUTOSAVE_MS
  let lang = o.lang, alive = true, site: DlSite | null = null
  let dirty = false, loading = false, again = false, againMode: SaveMode = 'auto'
  // autosave goes through the studio's saveProjectSafe: if someone else (the user's AI) changed project.json since
  // our last load / save, nothing is written and the shell asks the user; an explicit save (menu, Ctrl+S, the
  // shell's flush) writes anyway (force)
  let held = false
  // project name from project.json (the engine does not keep it); written back on every save
  let projName: string | undefined
  // pages in the loaded project; >1 ⇒ only page 1 is in the editor, so nothing writes unless the user saves
  let pages = 1
  let saving: Promise<void> | null = null
  let editSeq = 0   // bumped on every edit: a save only clears "dirty" if nothing was edited while it ran
  let timer: ReturnType<typeof setTimeout> | null = null
  const notice = (n: PaintNotice) => o.onNotice?.(n)
  const setDirty = (d: boolean) => { if (dirty !== d) { dirty = d; o.onDirtyChange?.(d) } }

  const load = async (s: DlSite): Promise<boolean> => {
    let r: Awaited<ReturnType<typeof loadPaintDetailed>>
    try { r = await loadPaintDetailed(o.store) } catch (e) {
      const reason = isStudioError(e) ? (e.detail ? `${e.code} (${e.detail})` : e.code) : e instanceof Error ? e.message : String(e)
      notice({ key: 'paint_load_failed', vars: { reason }, tone: 'error' })
      return false
    }
    if (timer) { clearTimeout(timer); timer = null }
    loading = true
    try { await loadProject(s, r.doc) } finally { loading = false }
    claimHostTab(s, o.name)   // loading resets the engine's tab name to the document's own
    setDirty(false)
    held = false
    pages = r.pages
    projName = r.name
    o.onSaveStateChange?.('saved')
    notice(pages > 1 ? { key: 'paint_multipage', vars: { n: String(pages) }, tone: 'error' }
      : r.missing.length ? { key: 'paint_missing', vars: { files: r.missing.join(', ') }, tone: 'error' } : null)
    return true
  }

  const rankOf = (m: SaveMode) => (m === 'user' ? 2 : m === 'flush' ? 1 : 0)
  const save = async (mode: SaveMode): Promise<{ ok: boolean; error?: string }> => {
    const s = site
    if (!s) return { ok: false, error: 'not_ready' }
    if (timer) { clearTimeout(timer); timer = null }
    if (saving) { again = true; if (rankOf(mode) > rankOf(againMode)) againMode = mode; await saving; return dirty ? { ok: false, error: 'save_failed' } : { ok: true } }
    let result: { ok: boolean; error?: string } = { ok: true }
    saving = (async () => {
      let m0 = mode
      do {
        if (rankOf(againMode) > rankOf(m0)) m0 = againMode
        again = false; againMode = 'auto'
        const before = editSeq
        if (m0 !== 'user' && pages > 1) {
          o.onSaveStateChange?.('dirty')
          result = { ok: false, error: 'multi_page' }
          break
        }
        o.onSaveStateChange?.('saving')
        try {
          const doc = await serializeProject(s) as Record<string, unknown>
          const w = await saveProjectSafe(o.store, (st) => savePaint(st, doc, undefined, { name: projName }).then(() => undefined), { force: m0 !== 'auto' })
          if (!w.written) {
            held = true
            notice({ key: 'paint_external_hold', tone: 'error' })
            o.onSaveStateChange?.('dirty')
            result = { ok: false, error: 'external_change' }
            break
          }
          if (held || pages > 1) { held = false; pages = 1; notice(null) }
          if (editSeq === before) setDirty(false)
          o.onSaveStateChange?.(dirty ? 'dirty' : 'saved')
          result = { ok: true }
        } catch (e) {
          const msg = isStudioError(e) ? e.code : e instanceof Error ? e.message : String(e)
          o.onSaveStateChange?.('error', msg)
          result = { ok: false, error: msg }
          break
        }
      } while (again && alive)
    })()
    try { await saving } finally { saving = null }
    return result
  }

  const ready = (async () => {
    notice({ key: 'paint_loading', tone: 'muted' })
    const t0 = Date.now()
    while (alive && !(site = siteOf(o.frame))) {
      if (Date.now() - t0 > ENGINE_WAIT_MS) { notice({ key: 'paint_engine_failed', tone: 'error' }); return false }
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!alive || !site) return false
    applyLanguage(site, lang)
    claimHostTab(site, o.name)
    hideAgentHint(site)
    installSave(site, () => save('user'), o.saveLabel)
    installHostClose(site, async () => { if (dirty) await save('auto'); o.onLeave?.() })
    watchEdits(site, () => {
      if (loading) return
      editSeq++
      setDirty(true)
      o.onSaveStateChange?.('dirty')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void save('auto') }, autosaveMs)
    })
    return load(site)
  })()

  return {
    ready,
    save: (mode = 'user') => save(mode),
    async reload() { await ready; if (!site || !alive) return false; if (saving) await saving; return load(site) },
    setLang(l) { lang = l; if (site) applyLanguage(site, l) },
    dispose() {
      if (timer) { clearTimeout(timer); timer = null }
      if (dirty && site) void save('auto')   // leaving with unsaved edits ⇒ write them once (not over an outside edit / a multi-page file)
      alive = false
    },
  }
}
