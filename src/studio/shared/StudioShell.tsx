'use client'
// StudioShell：还没有整页（appDef.guestPage）的编辑器用的外框＝顶栏（编辑器名、工程名、存档状态、汇出、汇入、换资料夹、语言）＋编辑区＋右栏（给自己 AI 的一键复制、广告、GitHub）。
//   存档状态、看档变动、离开前提示、flush 等逻辑在 session.ts（与游客整页共用）；这里只画画面。
//   编辑器怎么接见 types.ts 头注。

import { useCallback, useRef, useState } from 'react'
import type { ProjectStore, StudioApp, StudioLang } from './types'
import { StudioTProvider } from './StudioT'
import { SIGNUP_HREF, neutralServiceNames, studioGithubUrl, studioHref } from './host'
import { canPickFolder, pickFolder } from './fs-types'
import type { ProjectRecord } from './projects'
import { readProjectDir, readProjectFileList, readProjectZip } from './zip'
import ExportOptionsDialog from './ui/ExportOptionsDialog'
import { buildAIPrompt, aiUsageKeys } from './ai-prompt'
import { AppIcon, LangSwitch } from './ui/common'
import { useStudioSession } from './session'

export interface StudioShellProps {
  appDef: StudioApp<unknown>
  record: ProjectRecord
  store: ProjectStore
  lang: StudioLang
  setLang: (l: StudioLang) => void
  /** 换了存放位置（换资料夹／OPFS 改存资料夹）后通知外层换掉 store 与纪录。 */
  onRelocated: (store: ProjectStore, record: ProjectRecord) => void
}

export default function StudioShell({ appDef, record, store, lang, setLang, onRelocated }: StudioShellProps) {
  const app = appDef.app
  const ss = useStudioSession({ appDef, record, store, lang, onRelocated })
  const { t, appName, saveState, statusText, externalPending, notice, setNotice, name, setName, busy, folderOk, reloadEditor, rename, changeFolder } = ss
  const [panelOpen, setPanelOpen] = useState(false)
  const [importMenu, setImportMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const zipInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)

  // 汇出：有 exportOptions ⇒ 先弹勾选小窗（缺省全不勾），按「汇出」才 flush＋打包；没有 ⇒ 直接 flush＋打包。
  const [exportPick, setExportPick] = useState<Set<string> | null>(null)
  const runExport = async (options: ReadonlySet<string>) => {
    setExportPick(null)
    await ss.runExport(options)
  }
  const doExport = () => {
    if (appDef.exportOptions?.length) setExportPick(new Set())
    else void runExport(new Set())
  }
  const cancelExport = useCallback(() => setExportPick(null), [])

  const doImport: typeof ss.doImport = async load => {
    setImportMenu(false)
    await ss.doImport(load)
  }
  const importFolder = () => {
    if (canPickFolder()) {
      void doImport(async () => { const d = await pickFolder(); return d ? readProjectDir(d, app, appDef.format.version) : null })
    } else dirInput.current?.click()
  }

  const prompt = buildAIPrompt({ t, appName, backend: store.backend, folderName: store.label, summary: appDef.format.summaryForAI(lang) })
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt) } catch {
      const ta = document.createElement('textarea'); ta.value = prompt; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* 连这条都不行就算了 */ }
      ta.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  const github = studioGithubUrl()
  const Editor = appDef.Editor
  const btn = 'h-8 px-2.5 rounded-lg text-xs font-medium text-[#5C4A36] hover:bg-black/5 disabled:opacity-40 whitespace-nowrap'

  const panel = (
    <div className="flex flex-col gap-4 p-4 text-sm" data-testid="studio-ai-panel">
      <section>
        <h2 className="font-bold text-[#4A3528]">{t('studio_ai_title')}</h2>
        <ol className="mt-2 space-y-1 text-[13px] text-[#6E5B45] leading-relaxed">
          {aiUsageKeys(neutralServiceNames()).map(k => <li key={k}>{t(k)}</li>)}
        </ol>
        {store.backend === 'opfs' && <p className="mt-2 text-[12px] text-amber-700 leading-relaxed" data-testid="studio-ai-opfs-note">{t('studio_ai_opfs_note')}</p>}
        <p className="mt-3 text-[12px] text-[#8A7B66]">{t('studio_ai_how')}</p>
        <div className="mt-1.5 rounded-xl border border-[#E7DCBE] bg-white">
          <pre className="max-h-64 overflow-auto p-3 text-[12px] leading-relaxed text-[#4A3528] whitespace-pre-wrap break-words font-sans" data-testid="studio-ai-prompt">{prompt}</pre>
          <div className="border-t border-[#EEE4B8] p-2 flex justify-end">
            <button type="button" onClick={copy} data-testid="studio-ai-copy"
              className="h-8 px-4 rounded-lg bg-[#4A3528] text-[13px] font-semibold text-white keep-white hover:bg-[#5C4434]">{copied ? t('studio_ai_copied') : t('studio_ai_copy')}</button>
          </div>
        </div>
      </section>
      {!folderOk && <p className="text-[12px] text-[#8A7B66] leading-relaxed" data-testid="studio-browser-only">{t('studio_browser_only')}</p>}
      <a href={SIGNUP_HREF} target="_blank" rel="noopener" className="block rounded-xl bg-[#FBF8EF] border border-[#EEE4B8] px-3 py-2 text-[13px] text-[#8A6D3B] hover:bg-[#F4ECD6]" data-testid="studio-ad">{t('studio_ad')} →</a>
      {github && (
        <a href={github} target="_blank" rel="noopener noreferrer" data-testid="studio-github"
          className="inline-flex items-center justify-center gap-2 h-9 rounded-xl border border-[#E7DCBE] bg-white text-[13px] font-medium text-[#4A3528] hover:bg-[#FBF8EF]">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
          {t('studio_github')}
        </a>
      )}
    </div>
  )

  return (
    <StudioTProvider t={t} lang={lang}>
      <div className="h-screen flex flex-col bg-[#FAFAF8] text-[#4A3528]" lang={lang} data-testid="studio-shell" data-app={app} data-backend={store.backend}>
        <header className="shrink-0 border-b border-[#EEE4B8] bg-[#FBF8EF]">
          <div className="h-12 px-3 flex items-center gap-2 min-w-0">
            <a href={studioHref.root()} className="flex items-center gap-2 shrink-0" title={t('studio_all_apps')} data-testid="studio-back">
              <AppIcon app={app} size={26} />
              <span className="font-bold text-sm hidden sm:inline">{appName}</span>
            </a>
            <span className="w-px h-4 bg-[#E7DCBE] shrink-0" />
            <input value={name} onChange={e => setName(e.target.value)} onBlur={e => { void rename(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              aria-label={t('studio_untitled')} data-testid="studio-name"
              className="min-w-0 w-40 sm:w-56 bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-[#E7DCBE]" />
            <span className={`text-[11px] whitespace-nowrap ${saveState === 'error' ? 'text-red-600' : 'text-[#8A7B66]'}`} data-testid="studio-save-state" data-state={saveState}>{statusText}</span>
            <span className="hidden md:inline text-[11px] text-[#B8A884] truncate" data-testid="studio-where">
              {store.backend === 'folder' ? t('studio_where_folder', { name: store.label }) : t('studio_where_opfs')}
            </span>
            <div className="flex-1" />
            <button type="button" className={btn} onClick={doExport} disabled={busy} data-testid="studio-export">{t('studio_export')}</button>
            <div className="relative">
              <button type="button" className={btn} onClick={() => setImportMenu(v => !v)} disabled={busy} aria-haspopup="menu" aria-expanded={importMenu} data-testid="studio-import">{t('studio_import')}</button>
              {importMenu && (
                <div role="menu" className="absolute right-0 top-full mt-1 z-30 min-w-[120px] rounded-lg border border-[#E7DCBE] bg-white py-1 shadow-lg">
                  <button type="button" role="menuitem" className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#FBF8EF]" onClick={() => { setImportMenu(false); zipInput.current?.click() }} data-testid="studio-import-zip">{t('studio_import_zip')}</button>
                  <button type="button" role="menuitem" className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#FBF8EF]" onClick={importFolder} data-testid="studio-import-folder">{t('studio_import_folder')}</button>
                </div>
              )}
            </div>
            {folderOk && (
              <button type="button" className={btn} onClick={changeFolder} disabled={busy} data-testid="studio-change-folder">
                {store.backend === 'folder' ? t('studio_change_folder') : t('studio_move_to_folder')}
              </button>
            )}
            <LangSwitch lang={lang} setLang={setLang} />
            <button type="button" className={`${btn} lg:hidden`} onClick={() => setPanelOpen(v => !v)} aria-expanded={panelOpen} data-testid="studio-panel-toggle">AI</button>
          </div>
          {externalPending && (
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-t border-amber-200 bg-amber-50 text-[13px]" data-testid="studio-external">
              <span>{t('studio_external_changed')}</span>
              <button type="button" className="h-7 px-3 rounded-md bg-amber-600 text-white keep-white text-xs" onClick={reloadEditor} data-testid="studio-external-reload">{t('studio_external_reload')}</button>
              <button type="button" className="h-7 px-3 rounded-md text-xs hover:bg-black/5" onClick={ss.dismissExternal}>{t('studio_external_later')}</button>
            </div>
          )}
          {notice && (
            <div className={`px-3 py-1.5 flex items-center gap-2 border-t text-[13px] ${notice.kind === 'err' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role="status" data-testid="studio-notice">
              <span className="flex-1">{notice.text}</span>
              <button type="button" className="text-xs opacity-60 hover:opacity-100" onClick={() => setNotice(null)} aria-label="×">×</button>
            </div>
          )}
        </header>
        <div className="flex-1 min-h-0 flex relative">
          <main className="flex-1 min-w-0 bg-white" data-testid="studio-editor">
            <Editor key={ss.editorKey} {...ss.editorProps} />
          </main>
          <aside className={`${panelOpen ? 'flex' : 'hidden'} lg:flex absolute lg:static inset-y-0 right-0 z-20 w-[320px] max-w-full flex-col overflow-y-auto border-l border-[#EEE4B8] bg-[#FAF9F5] shadow-xl lg:shadow-none`}>
            {panel}
          </aside>
        </div>
        <input ref={zipInput} type="file" accept=".zip,application/zip" hidden data-testid="studio-import-zip-input"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doImport(() => readProjectZip(f, app, appDef.format.version)) }} />
        <input ref={dirInput} type="file" hidden multiple {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={e => { const fs = e.target.files; if (fs && fs.length) { const list = Array.from(fs); e.target.value = ''; void doImport(() => readProjectFileList(list, app, appDef.format.version)) } }} />
        {exportPick && appDef.exportOptions && (
          <ExportOptionsDialog t={t} options={appDef.exportOptions} selected={exportPick}
            onToggle={(id, on) => setExportPick(s => { if (!s) return s; const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })}
            onConfirm={() => void runExport(exportPick)} onCancel={cancelExport} />
        )}
      </div>
    </StudioTProvider>
  )
}
