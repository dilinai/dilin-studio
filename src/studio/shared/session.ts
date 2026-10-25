'use client'
// 一份开着的工程的外框逻辑（StudioShell 与游客整页共用一份）：
//   存档状态、外部改档（store.watch·没未存改动就重载、有就先问）、离开前未存提示、flush、汇出、汇入覆盖、换资料夹、改名、关闭去向。
//   只有状态与动作、不画画面；StudioShell 拿它画顶栏，游客整页（appDef.guestPage）拿它填宿主与 EditorProps。
//
// 「最后修改」只在编辑器真的报过改动之后存档才更新（载入时报的「已存」不算）——直开时靠它认出「刚开、没动过」的空工程。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorProps, ProjectStore, SaveState, StudioAgentJob, StudioAgentReply, StudioApp, StudioLang, StudioT } from './types'
import { makeStudioT, STUDIO_SHARED_I18N } from './i18n'
import { canPickFolder, pickFolder, type DirHandle } from './fs-types'
import { copyProject, deleteOpfsProject, folderStore, inspectFolder, saveProjectSafe } from './store'
import { updateProject, type ProjectRecord } from './projects'
import { checkProjectHeader, projectNameOf, writeProjectName } from './project-file'
import { applyPayload, buildExportZip, downloadBlob, exportFileName, type ProjectPayload } from './zip'
import { confirmDialog } from './dialog-store'
import { browserProjectEnv, leaveTarget, type ProjectEnv } from './project-actions'
import { appNameKey, errorText } from './ui/common'

export type SessionNotice = { kind: 'ok' | 'err'; text: string } | null

export interface StudioSessionInput {
  appDef: StudioApp<unknown>
  record: ProjectRecord
  store: ProjectStore
  lang: StudioLang
  /** 换了存放位置（换资料夹／OPFS 改存资料夹）或改了名之后通知外层换掉 store 与纪录。 */
  onRelocated: (store: ProjectStore, record: ProjectRecord) => void
  env?: ProjectEnv
  /** 换网址（缺省 location.assign）。 */
  navigate?: (href: string) => void
}

export interface StudioSession {
  t: StudioT
  appName: string
  saveState: SaveState
  saveDetail: string
  /** 顶栏那句存档状态。 */
  statusText: string
  revision: number
  /** 编辑器的 key：外部改档且 softReload=false ⇒ 变（整个重挂）。 */
  editorKey: number
  externalPending: boolean
  dismissExternal(): void
  reloadEditor(): void
  notice: SessionNotice
  setNotice(n: SessionNotice): void
  name: string
  setName(n: string): void
  busy: boolean
  folderOk: boolean
  /** 有没有还没存的改动（当下值）。 */
  isDirty(): boolean
  flush(): Promise<void>
  fail(e: unknown): void
  /** flush＋打包下载（options＝汇出勾选）。 */
  runExport(options: ReadonlySet<string>): Promise<void>
  /** flush＋把 appDef.saveForOtherApps 产的档写进工程资料夹根目录（单机版右栏那颗）；写完提示档名。 */
  saveOtherApps(): Promise<void>
  /** 读进一份工程盖掉现在这份（先问）。 */
  doImport(load: () => Promise<ProjectPayload | null>): Promise<void>
  /** 换资料夹／OPFS 改存到资料夹（要在使用者的点击里叫）。 */
  changeFolder(): Promise<void>
  rename(v: string): Promise<void>
  /** 关掉这份：flush，再去这个编辑器最近的另一份，没有就回 /studio。 */
  close(): Promise<void>
  /** 正在开的这份被移出清单了：丢掉未存标记（免得离开时再问）、去别份或回 /studio。 */
  leaveRemoved(): Promise<void>
  /** 单机版本机 MCP 的一件活（appDef.agentJob）：flush、套用、安全写回、重载编辑页 */
  agentJob(job: StudioAgentJob): Promise<StudioAgentReply>
  editorProps: EditorProps
}

const defaultNavigate = (href: string) => { window.location.assign(href) }

/** 存好后要写进清单的那一笔：工程档里的名字跟清单不同 ⇒ 改名；touchAt 有值 ⇒ 记最后修改；都没有 ⇒ null。
 *  改名与最后修改合成一次写（分两次写会互相盖掉）。 */
export function savedRecordPatch(fileName: string | undefined, recordName: string, touchAt: number | null): { name?: string; updatedAt?: number } | null {
  const renamed = !!fileName && fileName !== recordName
  if (!renamed && touchAt === null) return null
  return { ...(renamed ? { name: fileName } : {}), ...(touchAt !== null ? { updatedAt: touchAt } : {}) }
}

/** 外面改了 project.json 时外框怎么做：手上有未存改动 ⇒ ask（顶栏问）；编辑器自己读回（softReload／outsideSoftReload）⇒ revision（只递增 revision）；
 *  其余 ⇒ remount（整个重挂编辑器）。 */
export function outsideChangeAction(dirty: boolean, app: Pick<StudioApp, 'softReload' | 'outsideSoftReload'>): 'ask' | 'revision' | 'remount' {
  if (dirty) return 'ask'
  return app.softReload || app.outsideSoftReload ? 'revision' : 'remount'
}

export function useStudioSession({ appDef, record, store, lang, onRelocated, env = browserProjectEnv, navigate = defaultNavigate }: StudioSessionInput): StudioSession {
  const app = appDef.app
  const t = useMemo(() => makeStudioT([STUDIO_SHARED_I18N, appDef.i18n], lang), [appDef.i18n, lang])
  const appName = t(appNameKey(app))
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveDetail, setSaveDetail] = useState('')
  const [revision, setRevision] = useState(0)
  const [editorKey, setEditorKey] = useState(0)
  const [externalPending, setExternalPending] = useState(false)
  const [notice, setNotice] = useState<SessionNotice>(null)
  const [name, setName] = useState(record.name)
  const [busy, setBusy] = useState(false)
  const [folderOk, setFolderOk] = useState(true)   // 首绘假设能挑资料夹（避免水合不一致），挂载后再量
  const dirtyRef = useRef(false)
  const changedRef = useRef(false)                 // 编辑器报过改动（之后的存档才算「改过」）
  const relocatedRef = useRef(onRelocated)
  relocatedRef.current = onRelocated
  const flushRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => { setFolderOk(canPickFolder()) }, [])
  useEffect(() => { setName(record.name) }, [record.name])

  const reloadEditor = useCallback(() => {
    dirtyRef.current = false
    setExternalPending(false)
    setRevision(r => r + 1)
    if (!appDef.softReload) setEditorKey(k => k + 1)
  }, [appDef.softReload])
  // 改存到别的资料夹后：编辑器（含 softReload 的）整个重挂，让它改用新资料夹读写——不重挂的话它手上还是旧的存储，
  //   之后的改动存不进新资料夹（显示「沒存成」），重新整理后就不见了
  const remountEditor = useCallback(() => {
    dirtyRef.current = false
    setExternalPending(false)
    setRevision(r => r + 1)
    setEditorKey(k => k + 1)
  }, [])

  // 外部改档
  useEffect(() => {
    const stop = store.watch(() => {
      // 清单的最后修改跟着动；project.json 里的 name 被改了 ⇒ 工程名跟着它
      void store.readJSON({ peek: true }).then(j => projectNameOf(j), () => undefined).then(n => updateProject(record.id, n ? { name: n, updatedAt: Date.now() } : { updatedAt: Date.now() }))
        .then(r => { if (r && r.name !== record.name) relocatedRef.current(store, r) }).catch(() => {})
      const act = outsideChangeAction(dirtyRef.current, appDef)
      if (act === 'ask') setExternalPending(true)
      else if (act === 'revision') { setExternalPending(false); setRevision(r => r + 1) }
      else reloadEditor()
    })
    return stop
  }, [store, record.id, record.name, reloadEditor, appDef])

  // 有未存改动时关页提醒
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const lastTouch = useRef(0)
  // 整页自己改了名（顶栏标题写进 project.json 的 name）⇒ 存好后清单名跟上
  const recordNameRef = useRef(record.name)
  recordNameRef.current = record.name
  const syncing = useRef(false)
  const pendingTouch = useRef<number | null>(null)
  const syncAfterSave = useCallback((touchAt: number | null) => {
    if (touchAt !== null) pendingTouch.current = touchAt
    if (syncing.current) return
    syncing.current = true
    void store.readJSON({ peek: true }).then(j => projectNameOf(j), () => undefined)
      .then(n => {
        const patch = savedRecordPatch(n, recordNameRef.current, pendingTouch.current)
        pendingTouch.current = null
        if (!patch) return null
        return updateProject(record.id, patch).then(r => { if (r && patch.name !== undefined) relocatedRef.current(store, r) })
      })
      .catch(() => {})
      .finally(() => { syncing.current = false; if (pendingTouch.current !== null) syncAfterSaveRef.current(null) })
  }, [store, record.id])
  const syncAfterSaveRef = useRef(syncAfterSave)
  syncAfterSaveRef.current = syncAfterSave
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d
    if (d) changedRef.current = true
    setSaveState(s => (d ? (s === 'saving' ? s : 'dirty') : s === 'dirty' ? 'saved' : s))
  }, [])
  const onSaveStateChange = useCallback((s: SaveState, detail?: string) => {
    setSaveState(s)
    setSaveDetail(detail ?? '')
    if (s === 'dirty') changedRef.current = true
    if (s === 'saved') {
      dirtyRef.current = false
      const now = Date.now()
      const touch = changedRef.current && now - lastTouch.current > 5000
      if (touch) { lastTouch.current = now; changedRef.current = false }
      syncAfterSave(touch ? now : null)
    }
  }, [syncAfterSave])
  const registerFlush = useCallback((f: (() => Promise<void>) | null) => { flushRef.current = f }, [])
  const flush = useCallback(async () => { if (flushRef.current) await flushRef.current() }, [])

  const fail = useCallback((e: unknown) => setNotice({ kind: 'err', text: errorText(t, e, appName, app, appDef.format.version) }), [t, appName, app, appDef.format.version])

  const runExport = async (options: ReadonlySet<string>) => {
    setBusy(true)
    try {
      await flush()
      downloadBlob(await buildExportZip(appDef, store, { projectId: record.id, options }), exportFileName(name || t('studio_untitled'), app))
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const saveOtherApps = async () => {
    const def = appDef.saveForOtherApps
    if (!def || !store.writeExtra) return
    setBusy(true)
    try {
      await flush()
      const files = await def.build(store)
      for (const f of files) await store.writeExtra(f.name, f.text)
      const done = t('studio_other_apps_done', { names: files.map(f => f.name).join('、'), folder: store.label })
      setNotice({ kind: 'ok', text: def.hint ? `${done} ${t(def.hint)}` : done })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const doImport = async (load: () => Promise<ProjectPayload | null>) => {
    try {
      const p = await load()
      if (!p) return
      if (!(await confirmDialog({ message: t('studio_import_confirm'), danger: true }))) return
      setBusy(true)
      await applyPayload(store, p)
      await updateProject(record.id, { updatedAt: Date.now() })
      reloadEditor()
      setSaveState('saved')
      setNotice({ kind: 'ok', text: t('studio_import_done') })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const changeFolder = async () => {
    try {
      const dir: DirHandle | null = await pickFolder()
      if (!dir) return
      if (record.handle && (await record.handle.isSameEntry(dir))) return
      const ins = await inspectFolder(dir)
      const next = folderStore(dir)
      // 资料夹里已有这个编辑器的工程（例如使用者的 AI 先做好的）⇒ 问要不要打开它：打开就改用那份，不拿手上这份盖掉
      let existing: Record<string, unknown> | null = null
      if (ins.hasProjectJson) {
        try { existing = checkProjectHeader(await next.readJSON({ peek: true }), app, appDef.format.version) } catch { existing = null }
      }
      if (existing) {
        if (!(await confirmDialog({ message: t('studio_folder_open_existing', { name: dir.name }) }))) return
        setBusy(true)
        await flush()
        const wasOpfs = record.backend === 'opfs'
        const rec = await updateProject(record.id, { backend: 'folder', handle: dir, name: projectNameOf(existing) ?? record.name, updatedAt: Date.now() })
        if (wasOpfs) await deleteOpfsProject(app, record.id).catch(() => {})
        if (rec) onRelocated(next, rec)
        remountEditor()
        setNotice({ kind: 'ok', text: t('studio_change_folder_done', { name: dir.name }) })
        return
      }
      const msg = ins.hasProjectJson ? 'studio_folder_bad_project' : 'studio_folder_not_empty'
      if ((ins.hasProjectJson || ins.otherEntries > 0) && !(await confirmDialog({ message: t(msg, { name: dir.name }) }))) return
      setBusy(true)
      await flush()
      await copyProject(store, next)
      const wasOpfs = record.backend === 'opfs'
      const rec = await updateProject(record.id, { backend: 'folder', handle: dir, updatedAt: Date.now() })
      if (wasOpfs) await deleteOpfsProject(app, record.id).catch(() => {})
      if (rec) onRelocated(next, rec)
      remountEditor()
      setNotice({ kind: 'ok', text: t('studio_change_folder_done', { name: dir.name }) })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  // 改名：先 flush 编辑器手上的改动，再把 name 安全写回 project.json；写成了就重载编辑器（它手上那份 name 是旧的，
  //   不重载下次自动存会把旧名写回去）。外面刚改过 ⇒ 不写、名字退回、提示再改一次（watch 那边会照外面的版本更新）。
  //   flush 后仍有未存改动（编辑器没登记 flush）⇒ 只改清单名、不碰 project.json，免得重载丢掉改动。
  const rename = async (v: string) => {
    const n = v.trim().slice(0, 120)
    if (!n || n === record.name) { setName(record.name); return }
    try {
      await flush()
      let wrote = false
      if (!dirtyRef.current) {
        const r = await writeProjectName(store, n)
        if (!r.written && r.reason === 'changed-outside') { setName(record.name); setNotice({ kind: 'err', text: t('studio_rename_conflict') }); return }
        wrote = r.written
      }
      const rec = await updateProject(record.id, { name: n, updatedAt: Date.now() })
      if (rec) onRelocated(store, rec)
      if (wrote) reloadEditor()
    } catch (e) { setName(record.name); fail(e) }
  }

  // 单机版本机 MCP 的一件活（appDef.agentJob）：同改名——先 flush 手上的改动；还有没存的 ⇒ 不碰（免得重载丢掉）；
  //   在 project.json 现况上算；改了 ⇒ 安全写回（外面刚改过 ⇒ 不写、照实回）·写成了就重载编辑页（画面跟着这一步变）。
  const agentJob = async (job: StudioAgentJob): Promise<StudioAgentReply> => {
    const run = appDef.agentJob
    if (!run) return { ok: false, error: 'not_available', message: 'this editor does not take commands here' }
    try {
      // 读也先存：页上刚改、还没自动存的那笔也要读得到（读的是 project.json）
      await flush()
      if (dirtyRef.current) return { ok: false, error: 'busy', message: job.kind === 'read'
        ? 'the page has unsaved changes that could not be saved yet, so reading now would miss them; try again in a moment.'
        : 'the page has unsaved changes that could not be saved yet; try again in a moment. Nothing was changed.' }
      const doc = await appDef.format.load(store)
      const out = await run(doc, job)
      if (out.next !== undefined) {
        const next = out.next
        const w = await saveProjectSafe(store, s => appDef.format.save(s, next))
        if (!w.written) return { ok: false, error: 'changed_outside', message: 'project.json was just changed outside the page; nothing was written. Read it again and retry.' }
        reloadEditor()
      }
      return out.reply
    } catch (e) {
      return { ok: false, error: 'command_failed', message: e instanceof Error ? e.message : String(e) }
    }
  }

  const close = async () => {
    try {
      await flush()
      dirtyRef.current = false
      navigate(await leaveTarget(env, app, record.id))
    } catch (e) { fail(e) }
  }
  const leaveRemoved = async () => {
    dirtyRef.current = false
    flushRef.current = null
    navigate(await leaveTarget(env, app, record.id))
  }

  const statusText = saveState === 'saved' ? t('studio_save_saved') : saveState === 'dirty' ? t('studio_save_dirty') : saveState === 'saving' ? t('studio_save_saving') : t('studio_save_error', { detail: saveDetail })
  const editorProps: EditorProps = { store, projectId: record.id, lang, revision, onDirtyChange, onSaveStateChange, registerFlush, onClose: close }

  return {
    t, appName, saveState, saveDetail, statusText, revision, editorKey,
    externalPending, dismissExternal: () => setExternalPending(false), reloadEditor,
    notice, setNotice, name, setName, busy, folderOk,
    isDirty: () => dirtyRef.current,
    flush, fail, runExport, saveOtherApps, doImport, changeFolder, rename, close, leaveRemoved, agentJob, editorProps,
  }
}
