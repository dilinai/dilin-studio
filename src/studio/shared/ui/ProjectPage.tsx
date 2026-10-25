'use client'
// /studio/<编辑器>/<工程编号>：认得这个编号（这台浏览器的 IndexedDB 有纪录）才开编辑器。
//   不认得 ⇒ 只显示「这个网址只在建立它的那台浏览器能打开」＋「在这里开一份新的」（＝/studio/<编辑器>?new=1 直开），⛔ 显示任何内容。
//   编辑器有整页（appDef.guestPage）⇒ 渲染 GuestProjectPage（整页＋游客宿主·不套 StudioShell）；没有 ⇒ StudioShell＋Editor。
//   资料夹工程：浏览器重开后授权会掉 ⇒ 先显示「允许」钮（requestPermission 要使用者亲手点）。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ProjectStore, StudioApp, StudioAppId } from '../types'
import { STUDIO_SHARED_I18N, makeStudioT } from '../i18n'
import { studioHref } from '../host'
import { StudioTProvider } from '../StudioT'
import { ensureFolderPermission } from '../fs-types'
import { folderStore, opfsStore } from '../store'
import { getProject, isProjectId, updateProject, type ProjectRecord } from '../projects'
import { projectNameOf } from '../project-file'
import { loadStudioApp } from '../registry'
import StudioShell from '../StudioShell'
import GuestProjectPage from './GuestProjectPage'
import { AppIcon, LangSwitch, appNameKey, useStudioLangState } from './common'

type State =
  | { s: 'loading' }
  | { s: 'bad' }
  | { s: 'unknown' }
  | { s: 'perm'; rec: ProjectRecord; denied: boolean }
  | { s: 'ready'; rec: ProjectRecord; store: ProjectStore; def: StudioApp<unknown> }
  | { s: 'error'; msg: string }

export default function ProjectPage({ app, id }: { app: StudioAppId; id: string }) {
  const { lang, setLang } = useStudioLangState()
  const t = useMemo(() => makeStudioT([STUDIO_SHARED_I18N], lang), [lang])
  const [st, setSt] = useState<State>({ s: 'loading' })

  const open = useCallback(async (rec: ProjectRecord, request: boolean) => {
    const def = await loadStudioApp(app)
    let store: ProjectStore
    if (rec.backend === 'folder') {
      if (!rec.handle) { setSt({ s: 'unknown' }); return }
      if (!(await ensureFolderPermission(rec.handle, request))) { setSt({ s: 'perm', rec, denied: request }); return }
      store = folderStore(rec.handle)
    } else {
      store = await opfsStore(app, rec.id)
    }
    // project.json 里有 name（例如汇入的、或 AI 改了）⇒ 清单名跟着它
    try {
      const n = projectNameOf(await store.readJSON({ peek: true }))   // 旁路读：基准留给编辑器载入
      if (n && n !== rec.name) rec = (await updateProject(rec.id, { name: n })) ?? rec
    } catch { /* 读坏了交给编辑器报 */ }
    setSt({ s: 'ready', rec, store, def })
  }, [app])

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!isProjectId(id)) { setSt({ s: 'bad' }); return }
      try {
        const rec = await getProject(id)
        if (!alive) return
        if (!rec || rec.app !== app) { setSt({ s: 'unknown' }); return }
        await open(rec, false)
      } catch (e) { if (alive) setSt({ s: 'error', msg: String((e as Error)?.message || e) }) }
    })()
    return () => { alive = false }
  }, [app, id, open])

  if (st.s === 'ready') {
    if (st.def.guestPage) {
      return <GuestProjectPage appDef={st.def} record={st.rec} store={st.store} lang={lang}
        onRelocated={(store, rec) => setSt({ s: 'ready', rec, store, def: st.def })} />
    }
    return <StudioShell appDef={st.def} record={st.rec} store={st.store} lang={lang} setLang={setLang}
      onRelocated={(store, rec) => setSt({ s: 'ready', rec, store, def: st.def })} />
  }

  const card = (body: ReactNode) => (
    <StudioTProvider t={t} lang={lang}>
      <div className="min-h-screen bg-[#FAFAF8] text-[#4A3528] flex flex-col" lang={lang}>
        <header className="h-12 px-3 flex items-center gap-2 border-b border-[#EEE4B8] bg-[#FBF8EF]">
          <a href={studioHref.root()} className="flex items-center gap-2" title={t('studio_all_apps')} data-testid="studio-back"><AppIcon app={app} size={26} /><span className="font-bold text-sm">{t(appNameKey(app))}</span></a>
          <div className="flex-1" />
          <LangSwitch lang={lang} setLang={setLang} />
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#E7DCBE] bg-white p-6 text-center shadow-[0_6px_16px_rgba(75,65,28,0.06)]">{body}</div>
        </main>
      </div>
    </StudioTProvider>
  )

  if (st.s === 'loading') return card(<p className="text-sm text-[#8A7B66]">{t('studio_loading')}</p>)
  if (st.s === 'error') return card(<p className="text-sm text-red-600">{t('studio_err_generic', { detail: st.msg })}</p>)
  if (st.s === 'perm') {
    return card(
      <div data-testid="studio-perm">
        <h1 className="text-lg font-bold">{t('studio_perm_title', { name: st.rec.handle?.name ?? '' })}</h1>
        <p className="mt-2 text-sm text-[#6E5B45]">{t('studio_perm_body')}</p>
        {st.denied && <p className="mt-2 text-sm text-red-600">{t('studio_perm_denied')}</p>}
        <button type="button" onClick={() => void open(st.rec, true)} data-testid="studio-perm-btn"
          className="mt-5 h-10 px-6 rounded-xl bg-[#4A3528] text-white keep-white font-semibold text-sm hover:bg-[#5C4434]">{t('studio_perm_btn')}</button>
      </div>,
    )
  }
  // bad／unknown：⛔ 任何工程内容
  return card(
    <div data-testid="studio-unknown">
      <h1 className="text-lg font-bold">{st.s === 'bad' ? t('studio_bad_id') : t('studio_unknown_title')}</h1>
      {st.s === 'unknown' && <p className="mt-2 text-sm text-[#6E5B45] leading-relaxed">{t('studio_unknown_body')}</p>}
      <a href={studioHref.appNew(app)} data-testid="studio-unknown-new"
        className="mt-5 inline-flex items-center h-10 px-6 rounded-xl bg-[#4A3528] text-white keep-white font-semibold text-sm hover:bg-[#5C4434]">{t('studio_unknown_new')}</a>
    </div>,
  )
}
