// Dilin Studio · Paint — bridge to the paint engine running in a same-origin iframe (public/drawboard-app).
// The engine's top-level objects (CMD, UI, Lang, Project, History, Docs …) are collected by site-bridge.js into
// window.__dlSite once the page has started. Only DOM here, no React, no network.

import type { StudioLang } from '../shared/types'

type Params = Record<string, unknown>
export type DlCmd = { id: string; run: (p: Params) => unknown; i18n?: string; params?: string; undoable?: boolean }
export type DlTabs = {
  activeId(): string | null
  host(id: string, on: boolean): void
  name(name: string): void
}
export type DlSite = {
  CMD: { map: Record<string, DlCmd>; reg(id: string, meta: Params, fn: (p: Params) => unknown): void; run(id: string, p?: Params): unknown }
  UI: { draw(): void; fit(): void; refresh(): void } | null
  Lang: { cur: string; set(l: string): void } | null
  Project: { serialize(opts?: { reuse?: boolean }): unknown; serializeAsync?(opts?: { reuse?: boolean }): Promise<unknown>; load(json: unknown): Promise<void> }
  isHostActive?: () => boolean
  History: { push(): void; undo(): boolean; redo(): boolean; clear(): void }
  composite: ((scale: number) => HTMLCanvasElement) | null
  Tabs?: DlTabs | null
  doc?: Document
}
type DlWindow = Window & { __dlSite?: DlSite; __dlSiteReady?: boolean; PsFile?: { markSaved?: () => void } }

/** the engine inside the iframe, once it has started (null while loading) */
export function siteOf(frame: HTMLIFrameElement | null): DlSite | null {
  const w = frame?.contentWindow as DlWindow | null | undefined
  try {
    if (!(w && w.__dlSiteReady && w.__dlSite && w.__dlSite.CMD)) return null
    if (w.__dlSite.Tabs && !w.__dlSite.Tabs.activeId()) return null   // the tab bar registers its first tab on window load
    w.__dlSite.doc = w.document
    return w.__dlSite
  } catch { return null }
}

/** studio language ⇒ engine language (the engine's i18n uses zh-Hant / zh-Hans / en) */
export const ENGINE_LANG: Record<StudioLang, string> = { 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans', en: 'en' }
export function applyLanguage(site: DlSite, lang: StudioLang): void {
  const want = ENGINE_LANG[lang]
  if (site.Lang && site.Lang.cur !== want) site.Lang.set(want)
  const sel = site.doc?.getElementById('langSel') as HTMLSelectElement | null | undefined
  if (sel && sel.value !== want) sel.value = want
}

/** the engine's top-bar hint about its command set is for the signed-in site's AI roles; the guest page has none */
export function hideAgentHint(site: DlSite): void {
  const el = site.doc?.getElementById('agentHint') as HTMLElement | null | undefined
  if (el) el.style.display = 'none'
}

/** File ▸ Close / Close All on the saved tab would swap the drawing for a blank one (and autosave would then write the
 *  blank over the project). Here closing the saved tab means leaving the project: other tabs are closed first (the
 *  engine asks about their unsaved changes; Cancel stops), then onLeave() runs. Closing a scratch tab stays as it was. */
export const CLOSE_CMDS = ['ps.file.close', 'ps.file.closeAll'] as const
export function installHostClose(site: DlSite, onLeave: () => Promise<void> | void): void {
  type DocsApi = { list: Array<{ id: string; host?: boolean }> }
  const docs = () => (site.doc?.defaultView as (Window & { Docs?: DocsApi }) | null | undefined)?.Docs
  for (const id of CLOSE_CMDS) {
    const orig = site.CMD.map[id] as (DlCmd & { __studioClose?: boolean }) | undefined
    if (!orig || orig.__studioClose) continue
    const meta: Params = { ...orig, __studioClose: true }
    delete meta.id; delete meta.run
    site.CMD.reg(id, meta, async (p) => {
      if (id === 'ps.file.close' && site.isHostActive?.() === false) return orig.run.call(orig, p) // a scratch tab
      const d = docs()
      const host = d?.list.find((x) => x.host)
      if (d && host && d.list.length > 1) {
        await site.CMD.run('ps.document.activate', { document: host.id })
        const r = (await site.CMD.run('ps.file.closeOthers', { ui: p?.ui, save: p?.save })) as { ok?: boolean; cancelled?: boolean } | undefined
        if (r && (r.cancelled || r.ok === false)) return r
      }
      await onLeave()
      return { ok: true, closed: 1, left: true }
    })
  }
}

/** make the current engine tab the one that is saved to the project folder (the engine treats "host" tabs as the file) */
export function claimHostTab(site: DlSite, name: string): void {
  const id = site.Tabs?.activeId()
  if (id && site.Tabs) { site.Tabs.host(id, true); site.Tabs.name(name) }
}

/** call onChange after every edit / undo / redo made on the saved tab (not on scratch tabs) */
export function watchEdits(site: DlSite, onChange: () => void): void {
  const H = site.History as DlSite['History'] & { __studioWrapped?: boolean }
  if (H.__studioWrapped) return
  H.__studioWrapped = true
  for (const k of ['push', 'undo', 'redo'] as const) {
    const orig = H[k].bind(H) as () => unknown
    ;(H as unknown as Record<string, () => unknown>)[k] = () => {
      const host = site.isHostActive?.() !== false
      const r = orig()
      if (host) onChange()
      return r
    }
  }
}

/** engine JSON of the saved tab (incremental: unchanged pixel layers reuse their last encoding) */
export async function serializeProject(site: DlSite): Promise<unknown> {
  return site.Project.serializeAsync ? site.Project.serializeAsync({ reuse: true }) : site.Project.serialize()
}

/** replace what the engine shows with this project; clears undo history */
export async function loadProject(site: DlSite, project: unknown): Promise<void> {
  await site.Project.load(project)
  site.History.clear()
  try { (site.doc?.defaultView as DlWindow | null | undefined)?.PsFile?.markSaved?.() } catch { /* older engine */ }
  site.UI?.fit()
}

/** route the engine's "Save" (menu + Ctrl+S) to our save. Other file commands keep their own local behaviour
 *  (open a local file, export PNG/SVG as a download). */
export function installSave(site: DlSite, save: () => Promise<unknown>, label: string): void {
  const cur = site.CMD.map['file.saveProject'] as (DlCmd & { __studio?: boolean }) | undefined
  if (cur?.__studio) return
  site.CMD.reg('file.saveProject', { i18n: cur?.i18n ?? '', params: `{} ${label}`, __studio: true }, () => save())
  // File ▸ Save (Ctrl+S) on the saved tab ⇒ our save; on scratch tabs (opened files, smart-object contents) ⇒ the engine's own
  const orig = site.CMD.map['ps.file.save'] as (DlCmd & { __studio?: boolean }) | undefined
  if (!orig || orig.__studio) return
  const upstream = orig.run
  const meta: Params = { ...orig, __studio: true }
  delete meta.id; delete meta.run
  site.CMD.reg('ps.file.save', meta, (p) => {
    const win = site.doc?.defaultView as (Window & { Smart?: { session?: unknown } }) | null | undefined
    const ours = p?.ui === true && site.isHostActive?.() !== false && !win?.Smart?.session
    return ours ? site.CMD.run('file.saveProject', {}) : upstream(p)
  })
}
