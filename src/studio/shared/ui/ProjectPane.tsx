'use client'
// 工程清单＋存放位置（游客宿主 renderDriveSlot 的内容·五个编辑器各自放进登入版云盘区块的那个位置）：
//   ① 这个浏览器记得的同一编辑器工程（最近改的在前·正在开的那份高亮）：点一下切过去（先存手上的改动再换网址）；「⋯」或右键：改名、从清单移除。
//   ② 「新開一份」＝直接存在浏览器里、不问；旁边小选单：新開到資料夾…、匯入工程檔（zip）、匯入資料夾（汇入的都成为新的一份）。
//   ③ 存放位置：这份存在哪＋「改存到資料夾／換資料夾」（不能挑资料夹的浏览器只显示提示）＋「匯出工程檔」。
//   只管内容、填满放它的那格；页签、宽度、收合由整页照登入版画。
//   行与选单用 editorShell.drive* 那组 class；暗底编辑器（剪辑）给 variant='dark' 换成 editorShellDarkDrive。

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { ProjectStore, StudioApp } from '../types'
import type { ProjectRecord } from '../projects'
import { useStudioLang, useStudioT } from '../StudioT'
import { canPickFolder, pickFolder } from '../fs-types'
import { readProjectDir, readProjectFileList, readProjectZip, type ProjectPayload } from '../zip'
import { confirmDialog } from '../dialog-store'
import { editorShell, editorShellDarkDrive } from '../theme/editor-shell-theme'
import { browserProjectEnv, createFolderProject, createOpfsProject, removeProjectEntry, renameProject, switchProject, type ProjectEnv } from '../project-actions'
import { studioHref } from '../host'
import { AppIcon, appNameKey, fmtTime } from './common'

export interface ProjectPaneProps {
  appDef: Pick<StudioApp<unknown>, 'app' | 'format'>
  record: ProjectRecord
  store: Pick<ProjectStore, 'backend' | 'label'>
  folderOk: boolean
  busy: boolean
  /** 把编辑器手上的改动存下去（切换、新开前叫）。 */
  flush(): Promise<void>
  navigate(href: string): void
  /** 改正在开的这份的名字（走外框那条：先存、写回工程档、重载编辑器）。 */
  onRenameCurrent(name: string): Promise<void>
  /** 正在开的这份被移除了 ⇒ 外框丢掉未存标记、离开这页。 */
  onRemovedCurrent(): Promise<void>
  onChangeFolder(): void
  /** 汇出正在开的这份（zip）。 */
  onExport(): void
  onError(e: unknown): void
  env?: ProjectEnv
  /** 'dark'＝暗底编辑器（剪辑）。 */
  variant?: 'light' | 'dark'
  /** 单测用：一开始的清单（不给 ⇒ 挂上后读）。 */
  initialList?: ProjectRecord[]
}

const DARK = {
  ...editorShellDarkDrive,
  menu: 'rounded-md border border-neutral-700 bg-neutral-800 py-1 shadow-lg',
  menuItem: editorShellDarkDrive.driveMenuItem,
  sep: 'border-neutral-800',
  whereText: 'text-neutral-300',
  hint: 'text-neutral-500',
  btn: 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-cyan-400',
  input: 'text-neutral-100 bg-neutral-800 border-neutral-600 focus:border-cyan-500',
}
const LIGHT = {
  ...editorShell,
  sep: 'border-black/5',
  whereText: 'text-gray-600',
  hint: 'text-gray-500',
  btn: `${editorShell.divider} bg-white ${editorShell.driveLoadMoreIdle}`,
  input: 'text-gray-700 bg-white border-gray-200 focus:border-blue-300',
}

const FOLDER_ICON = <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-yellow-500 shrink-0" aria-hidden><path d="M2 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z" /></svg>

export default function ProjectPane(p: ProjectPaneProps) {
  const t = useStudioT()
  const lang = useStudioLang()
  const env = p.env ?? browserProjectEnv
  const app = p.appDef.app
  const sh = p.variant === 'dark' ? DARK : LIGHT
  const [list, setList] = useState<ProjectRecord[] | null>(p.initialList ?? null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuUp, setMenuUp] = useState(false)
  const [newMenu, setNewMenu] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const zipInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const onError = useRef(p.onError)
  onError.current = p.onError

  const refresh = useCallback(async () => {
    try { setList(await env.registry.list(app)) } catch (e) { onError.current(e) }
  }, [env, app])
  // 正在开的这份改了名／换了位置／存过 ⇒ 清单跟着刷新；切回这个分页也刷新（别的分页可能新开或移除了）
  useEffect(() => { void refresh() }, [refresh, p.record.name, p.record.updatedAt, p.record.backend])
  useEffect(() => {
    const f = () => { void refresh() }
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [refresh])
  useEffect(() => {
    if (!menuId && !newMenu) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement | null)?.closest?.('[data-studio-pane-menu]')) { setMenuId(null); setNewMenu(false) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuId, newMenu])

  const defaultName = () => `${t(appNameKey(app))} ${fmtTime(Date.now(), lang)}`
  /** 一次只跑一个动作；错交给外框显示。f 里第一个 await 之前的部分仍在这一下点击里（挑资料夹要在点击里叫）。 */
  const run = (f: () => Promise<void>) => {
    if (workingRef.current) return
    workingRef.current = true
    setWorking(true)
    void f().catch(e => onError.current(e)).finally(() => { workingRef.current = false; setWorking(false) })
  }
  const off = working || p.busy

  const go = (id: string) => run(() => switchProject(p.flush, p.navigate, app, id))
  const newOpfs = () => run(async () => {
    setNewMenu(false)
    await p.flush()
    const rec = await createOpfsProject(env, p.appDef, defaultName())
    p.navigate(studioHref.project(app, rec.id))
  })
  const newInFolder = () => run(async () => {
    setNewMenu(false)
    const dir = await pickFolder()
    if (!dir) return
    await p.flush()
    const r = await createFolderProject(env, p.appDef, dir, name => confirmDialog({ message: t('studio_folder_not_empty', { name }) }))
    if (!r) return
    if (r.rec.id === p.record.id) { await refresh(); return }
    p.navigate(studioHref.project(app, r.rec.id))
  })
  const importNew = (load: () => Promise<ProjectPayload | null>) => run(async () => {
    setNewMenu(false)
    const payload = await load()
    if (!payload) return
    await p.flush()
    const rec = await createOpfsProject(env, p.appDef, defaultName(), payload)
    p.navigate(studioHref.project(app, rec.id))
  })
  const importFolder = () => {
    if (canPickFolder()) importNew(async () => { const d = await pickFolder(); return d ? readProjectDir(d, app, p.appDef.format.version) : null })
    else { setNewMenu(false); dirInput.current?.click() }
  }

  const editingRef = useRef<string | null>(null)
  const startRename = (rec: ProjectRecord) => { setMenuId(null); editingRef.current = rec.id; setEditing(rec.id); setDraft(rec.name) }
  const cancelRename = () => { editingRef.current = null; setEditing(null) }
  const commitRename = (rec: ProjectRecord) => {
    if (editingRef.current !== rec.id) return     // Enter 之后输入框卸载时的 blur 不再送一次
    editingRef.current = null
    setEditing(null)
    const v = draft
    run(async () => {
      if (rec.id === p.record.id) await p.onRenameCurrent(v)
      else await renameProject(env, rec, v)
      await refresh()
    })
  }
  const remove = (rec: ProjectRecord) => {
    setMenuId(null)
    run(async () => {
      const message = t(rec.backend === 'opfs' ? 'studio_remove_confirm_opfs' : 'studio_remove_confirm_folder', { name: rec.name || t('studio_untitled') })
      if (!(await confirmDialog({ message, danger: rec.backend === 'opfs' }))) return
      await removeProjectEntry(env, rec)
      if (rec.id === p.record.id) { await p.onRemovedCurrent(); return }
      await refresh()
    })
  }
  const openMenu = (rec: ProjectRecord, e: ReactMouseEvent) => {
    const row = (e.currentTarget as HTMLElement).closest('[data-studio-pane-row]')?.getBoundingClientRect()
    const box = (e.currentTarget as HTMLElement).closest('[data-studio-pane-list]')?.getBoundingClientRect()
    setMenuUp(!!(row && box && row.bottom + 72 > box.bottom))
    setNewMenu(false)
    setMenuId(cur => (cur === rec.id && e.type === 'click' ? null : rec.id))
  }

  const where = p.store.backend === 'folder' ? t('studio_where_folder', { name: p.store.label }) : t('studio_where_opfs')
  return (
    <div data-testid="studio-pane" data-variant={p.variant ?? 'light'} className="flex-1 min-h-0 flex flex-col">
      <div className="relative flex items-center gap-0.5 px-2 pt-2 pb-1.5" data-studio-pane-menu="">
        <button type="button" onClick={newOpfs} disabled={off} data-testid="studio-pane-new"
          className={`flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors ${sh.driveFileRowIdle} disabled:opacity-40`}>
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" /></svg>
          <span className="truncate text-left">{t('studio_new')}</span>
        </button>
        <button type="button" onClick={() => { setMenuId(null); setNewMenu(v => !v) }} disabled={off} aria-haspopup="menu" aria-expanded={newMenu}
          title={t('studio_pane_new_more')} aria-label={t('studio_pane_new_more')} data-testid="studio-pane-new-more" className={`${sh.driveRefreshBtn} disabled:opacity-40`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </button>
        {newMenu && (
          <div role="menu" className={`absolute left-2 right-2 top-full z-30 mt-0.5 ${sh.menu}`} data-testid="studio-pane-new-menu">
            {p.folderOk && <button type="button" role="menuitem" className={sh.menuItem} onClick={newInFolder} data-testid="studio-pane-new-folder">{t('studio_pane_new_folder')}</button>}
            <button type="button" role="menuitem" className={sh.menuItem} onClick={() => { setNewMenu(false); zipInput.current?.click() }} data-testid="studio-pane-import-zip">{t('studio_import_new')}</button>
            <button type="button" role="menuitem" className={sh.menuItem} onClick={importFolder} data-testid="studio-pane-import-folder">{t('studio_import_folder_new')}</button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2" data-studio-pane-list="" data-testid="studio-pane-list">
        {list === null ? (
          <div className="flex items-center justify-center py-6"><span className={sh.driveSpinner} /></div>
        ) : list.map(rec => {
          const current = rec.id === p.record.id
          const open = menuId === rec.id
          const name = rec.name || t('studio_untitled')
          const recWhere = rec.backend === 'folder' ? t('studio_where_folder', { name: rec.handle?.name ?? '' }) : t('studio_where_opfs')
          return (
            <div key={rec.id} className="group relative flex items-center" data-studio-pane-row="" data-studio-pane-menu={open ? '' : undefined}>
              {editing === rec.id ? (
                <input autoFocus value={draft} maxLength={120} aria-label={t('studio_pane_rename')} data-testid="studio-pane-rename-input"
                  onChange={e => setDraft(e.target.value)} onBlur={() => commitRename(rec)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(rec); else if (e.key === 'Escape') cancelRename() }}
                  className={`flex-1 min-w-0 my-0.5 px-2 py-1 rounded text-sm border outline-none ${sh.input}`} />
              ) : (
                <button type="button" onClick={() => { if (!current) go(rec.id) }} onContextMenu={e => { e.preventDefault(); openMenu(rec, e) }}
                  title={`${name}\n${recWhere} · ${t('studio_last_modified', { time: fmtTime(rec.updatedAt, lang) })}`}
                  aria-current={current ? 'page' : undefined} data-testid="studio-pane-item" data-id={rec.id} data-current={current ? '1' : '0'} disabled={off && !current}
                  style={{ paddingLeft: 8 }} className={`${sh.driveFileRowBase} ${current ? sh.driveFileRowCurrent : sh.driveFileRowIdle}`}>
                  {rec.backend === 'folder' ? FOLDER_ICON : <AppIcon app={app} size={16} />}
                  <span className="truncate flex-1 text-left">{name}</span>
                </button>
              )}
              {editing !== rec.id && (
                <button type="button" aria-label={t('studio_pane_more')} title={t('studio_pane_more')} aria-haspopup="menu" aria-expanded={open} data-studio-pane-menu="" data-testid="studio-pane-item-more"
                  onClick={e => { e.stopPropagation(); openMenu(rec, e) }}
                  className={`${sh.driveMoreBtn} ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M4 10a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm4.5 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm4.5 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" /></svg>
                </button>
              )}
              {open && (
                <div role="menu" data-studio-pane-menu="" data-testid="studio-pane-item-menu" className={`${sh.driveMenu} ${menuUp ? 'bottom-full mb-0.5' : 'top-full mt-0.5'}`}>
                  <button type="button" role="menuitem" className={sh.driveMenuItem} onClick={() => startRename(rec)} data-testid="studio-pane-rename">{t('studio_pane_rename')}</button>
                  <button type="button" role="menuitem" className={sh.driveMenuItem} onClick={() => remove(rec)} data-testid="studio-pane-remove">{t('studio_remove')}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className={`shrink-0 border-t ${sh.sep} px-3 py-2.5`} data-testid="studio-pane-where-box">
        <div className={sh.driveHeaderText}>{t('studio_pane_where')}</div>
        <div className={`mt-1 flex items-center gap-1.5 min-w-0 text-sm ${sh.whereText}`} data-testid="studio-pane-where" data-backend={p.store.backend} title={where}>
          {p.store.backend === 'folder' ? FOLDER_ICON : <AppIcon app={app} size={16} />}
          <span className="truncate">{where}</span>
        </div>
        {p.folderOk ? (
          <button type="button" onClick={p.onChangeFolder} disabled={off} data-testid="studio-change-folder"
            className={`mt-2 w-full px-2.5 py-1.5 rounded text-xs text-left border ${sh.btn} transition-colors disabled:opacity-40`}>
            {p.store.backend === 'folder' ? t('studio_change_folder') : t('studio_move_to_folder')}
          </button>
        ) : (
          <p className={`mt-2 text-[11px] leading-relaxed ${sh.hint}`} data-testid="studio-pane-browser-only">{t('studio_browser_only')}</p>
        )}
        <button type="button" onClick={p.onExport} disabled={off} data-testid="studio-export"
          className={`mt-1.5 w-full px-2.5 py-1.5 rounded text-xs text-left border ${sh.btn} transition-colors disabled:opacity-40`}>
          {t('studio_export')}
        </button>
      </div>

      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden data-testid="studio-pane-import-zip-input"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importNew(() => readProjectZip(f, app, p.appDef.format.version)) }} />
      <input ref={dirInput} type="file" hidden multiple {...({ webkitdirectory: '' } as Record<string, string>)} data-testid="studio-pane-import-dir-input"
        onChange={e => { const fs = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; if (fs.length) importNew(() => readProjectFileList(fs, app, p.appDef.format.version)) }} />
    </div>
  )
}
