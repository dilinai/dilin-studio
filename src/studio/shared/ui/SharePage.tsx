'use client'
// /s/<码>：短网址作品。取作品、存进这个浏览器（或沿用本机已有那份）、认领页面票，再照工程页一样开整页（GuestProjectPage·同步层在里面）。
//   网址栏保持 /s/<码>（不换去 /studio/<编辑器>/<编号>）。
//   过期或删了 ⇒ 白话「這份已經過期或被刪除」＋「開一份新的」；码的形状不对 ⇒「這個網址不對」。

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StudioAppId } from '../types'
import { STUDIO_SHARED_I18N, makeStudioT, resolveStudioLang } from '../i18n'
import { studioHref } from '../host'
import { StudioTProvider } from '../StudioT'
import { loadStudioApp } from '../registry'
import { browserProjectEnv, type ProjectEnv } from '../project-actions'
import { createShareApi, isShareCode, type ShareApi } from '../share-api'
import { localShareBook, type ShareBook } from '../share-book'
import { openSharedProject, type ShareOpenResult } from '../share-open'
import GuestProjectPage from './GuestProjectPage'
import { AppIcon, LangSwitch, appNameKey, errorText, fmtTime, useStudioLangState } from './common'

type State =
  | { s: 'loading' }
  | { s: 'bad' }
  | { s: 'error'; msg: string }
  | ShareOpenResult & { s: 'done' }

export interface SharePageProps {
  code: string
  /** 单测换假的；缺省＝真的接口、localStorage 登记、浏览器工程清单。 */
  api?: ShareApi
  book?: ShareBook
  env?: ProjectEnv
}

export default function SharePage({ code, api, book, env }: SharePageProps) {
  const { lang, setLang } = useStudioLangState()
  const t = useMemo(() => makeStudioT([STUDIO_SHARED_I18N], lang), [lang])
  const [st, setSt] = useState<State>(() => (isShareCode(code) ? { s: 'loading' } : { s: 'bad' }))
  const deps = useMemo(() => ({ api: api ?? createShareApi(), book: book ?? localShareBook, env: env ?? browserProjectEnv }), [api, book, env])

  useEffect(() => {
    if (!isShareCode(code)) return
    let alive = true
    void (async () => {
      try {
        const nameT = makeStudioT([STUDIO_SHARED_I18N], resolveStudioLang())
        const r = await openSharedProject(code, {
          ...deps, loadApp: loadStudioApp,
          defaultName: (app: StudioAppId) => `${nameT(appNameKey(app))} ${fmtTime(Date.now(), resolveStudioLang())}`,
        })
        if (alive) setSt({ ...r, s: 'done' })
      } catch (e) { if (alive) setSt({ s: 'error', msg: errorText(t, e, '', 'docs', 1) }) }
    })()
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, deps])

  if (st.s === 'done' && st.kind === 'ready') {
    return <GuestProjectPage appDef={st.def} record={st.rec} store={st.store} lang={lang} shareDeps={{ api: deps.api, book: deps.book }}
      onRelocated={(store, rec) => setSt({ ...st, rec, store })} />
  }

  const app = st.s === 'done' && st.kind === 'gone' ? st.app : null
  const card = (body: ReactNode) => (
    <StudioTProvider t={t} lang={lang}>
      <div className="min-h-screen bg-[#FAFAF8] text-[#4A3528] flex flex-col" lang={lang} data-testid="studio-share-page">
        <header className="h-12 px-3 flex items-center gap-2 border-b border-[#EEE4B8] bg-[#FBF8EF]">
          <a href={studioHref.root()} className="flex items-center gap-2" title={t('studio_all_apps')} data-testid="studio-back">
            {app && <AppIcon app={app} size={26} />}<span className="font-bold text-sm">{app ? t(appNameKey(app)) : t('studio_name')}</span>
          </a>
          <div className="flex-1" />
          <LangSwitch lang={lang} setLang={setLang} />
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#E7DCBE] bg-white p-6 text-center shadow-[0_6px_16px_rgba(75,65,28,0.06)]">{body}</div>
        </main>
      </div>
    </StudioTProvider>
  )

  if (st.s === 'loading') return card(<p className="text-sm text-[#8A7B66]" data-testid="studio-share-loading">{t('studio_share_loading')}</p>)
  if (st.s === 'error') return card(<p className="text-sm text-red-600" role="alert" data-testid="studio-error">{t('studio_share_open_failed', { detail: st.msg })}</p>)
  if (st.s === 'bad') return card(<h1 className="text-lg font-bold" data-testid="studio-share-bad">{t('studio_bad_id')}</h1>)
  // 过期或删了：⛔ 任何作品内容
  return card(
    <div data-testid="studio-share-gone-page">
      <h1 className="text-lg font-bold">{t('studio_share_gone_title')}</h1>
      <p className="mt-2 text-sm text-[#6E5B45] leading-relaxed">{t('studio_share_gone_body')}</p>
      <a href={app ? studioHref.appNew(app) : studioHref.root()} data-testid="studio-share-gone-new"
        className="mt-5 inline-flex items-center h-10 px-6 rounded-xl bg-[#4A3528] text-white keep-white font-semibold text-sm hover:bg-[#5C4434]">{t('studio_share_gone_new')}</a>
    </div>,
  )
}
