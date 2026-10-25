'use client'
// /studio/<编辑器>：不问存哪，直接在这个浏览器（OPFS）开一份新工程，原地换成工程网址（history.replaceState）、同一页当场渲染编辑页（ProjectPage）——
//   不再整页跳去 /studio/<编辑器>/<编号> 重载一次。换网址被浏览器拒（单档开源版 file:// 等）⇒ 退回整页 location.replace。
//   这个编辑器有「刚开、没动过」的空工程 ⇒ 沿用它，不多开一份（判据见 project-actions.ts）。之后要存到资料夹，在编辑页左栏工程清单改。
//   网址带 ?new=1（/dilin 顶栏编辑器图示带的）⇒ 一定新开一份空白工程、不沿用清单里任何一份；上一份照旧留在它原来的网址与本机清单。
//   网址带 ?import=<https 网址> 或 #p=<资料>（AI 交成品的链接·见 import-link.ts）⇒ 把那份读进来存成浏览器里的新工程再进编辑页；
//     读不进来 ⇒ 白话说哪里不对，给「改开一份空的」与回总页。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioApp, StudioAppId, StudioT } from '../types'
import { StudioError } from '../types'
import { studioHref } from '../host'
import { useStudioT } from '../StudioT'
import { hasOpfs } from '../fs-types'
import { STUDIO_SHARED_I18N, makeStudioT, resolveStudioLang } from '../i18n'
import { loadStudioApp } from '../registry'
import { browserProjectEnv, openFreshProject, type ProjectEnv } from '../project-actions'
import { LINK_FETCH_MAX_BYTES, LINK_HASH_MAX_CHARS, isStudioLinkError, openLinkedProject, readLinkSource, type LinkSource } from '../import-link'
import { StudioPageFrame, appNameKey, errorText, fmtTime } from './common'
import ProjectPage from './ProjectPage'

type Go = (href: string, id: string) => void

/** 原地换成工程网址（上一页不留 /studio/<编辑器>，同 replace）；换不了 ⇒ false（调用方退回整页跳）。 */
export function replaceUrlInPlace(href: string, w: Pick<Window, 'history'> = window): boolean {
  try { w.history.replaceState(w.history.state, '', href); return true } catch { return false }
}

/** 网址带 ?new=1 ⇒ 一定新开一份（不沿用「刚开、没动过」那份）。 */
export function wantsNewProject(search: string): boolean {
  return new URLSearchParams((search || '').replace(/^\?/, '')).get('new') === '1'
}

function mb(n: number): string { return `${Math.round(n / 1024 / 1024)} MB` }

/** 链接读不进来的白话（StudioLinkError 按 code；工程档本身的错照 errorText）。 */
export function linkErrorText(t: StudioT, e: unknown, appName: string, app: StudioAppId, maxVersion: number): string {
  if (isStudioLinkError(e)) {
    switch (e.code) {
      case 'bad_url': return t('studio_link_bad_url')
      case 'too_big': return e.detail === 'hash' ? t('studio_link_too_long', { max: LINK_HASH_MAX_CHARS }) : t('studio_link_too_big', { max: mb(Number(e.detail) || LINK_FETCH_MAX_BYTES) })
      case 'fetch_failed': return t('studio_link_fetch_failed', { detail: e.detail })
      case 'not_project': return t('studio_link_not_project')
      case 'bad_hash': return t('studio_link_bad_hash')
    }
  }
  return errorText(t, e, appName, app, maxVersion)
}

function Inner({ app, env, go, source, forceNew }: { app: StudioAppId; env: ProjectEnv; go: Go; source?: LinkSource | null; forceNew?: boolean }) {
  const t = useStudioT()
  const [err, setErr] = useState('')
  const [fromLink, setFromLink] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let def: StudioApp<unknown> | undefined
    const src = source !== undefined ? source : readLinkSource(window.location.search, window.location.hash)
    const fresh = forceNew !== undefined ? forceNew : wantsNewProject(window.location.search)
    setFromLink(!!src)
    void (async () => {
      try {
        def = await loadStudioApp(app)
        if (!hasOpfs()) throw new StudioError('unsupported', 'OPFS')
        const lang = resolveStudioLang()   // 首绘的 t 还是站别默认语言；工程名照使用者选的语言取
        const nameT = makeStudioT([STUDIO_SHARED_I18N], lang)
        const name = `${nameT(appNameKey(app))} ${fmtTime(Date.now(), lang)}`
        if (src) {
          const rec = await openLinkedProject(env, def, name, src)
          go(studioHref.project(app, rec.id), rec.id)
          return
        }
        const rec = await openFreshProject(env, def, name, { forceNew: fresh })
        go(studioHref.project(app, rec.id), rec.id)
      } catch (e) {
        setErr(linkErrorText(t, e, t(appNameKey(app)), app, def?.format.version ?? 1))
      }
    })()
  }, [app, env, go, t, source, forceNew])

  return (
    <div data-testid="studio-direct-open" data-app={app}>
      {err ? (
        <>
          <p className="text-sm text-red-600" role="alert" data-testid="studio-error">{err}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {fromLink && (
              <a href={studioHref.app(app)} data-testid="studio-link-new-blank"
                className="inline-flex items-center h-9 px-4 rounded-xl bg-[#4A3528] text-white keep-white font-semibold text-sm hover:bg-[#5C4434]">{t('studio_link_new_blank')}</a>
            )}
            <a href={studioHref.root()} className="text-xs text-[#8A7B66] hover:underline">← {t('studio_all_apps')}</a>
          </div>
        </>
      ) : (
        <p className="text-sm text-[#8A7B66]">{t(fromLink ? 'studio_link_loading' : 'studio_opening')}</p>
      )}
    </div>
  )
}

export default function DirectOpen({ app, env = browserProjectEnv, go, source, forceNew }: { app: StudioAppId; env?: ProjectEnv; go?: Go; source?: LinkSource | null; forceNew?: boolean }) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const goHere = useCallback<Go>((href, id) => {
    if (go) { go(href, id); return }
    if (replaceUrlInPlace(href)) setOpenedId(id)
    else window.location.replace(href)
  }, [go])
  if (openedId) return <ProjectPage app={app} id={openedId} />
  return <StudioPageFrame><Inner app={app} env={env} go={goHere} source={source} forceNew={forceNew} /></StudioPageFrame>
}
