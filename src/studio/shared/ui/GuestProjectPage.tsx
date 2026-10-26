'use client'
// 游客工程页的整页版：编辑器有 appDef.guestPage（照登入版搬来的那一份整页）⇒ 不套 StudioShell，整页直接渲染它。
//   外框逻辑（flush、外部改档重载、离开前未存提示、汇出、换资料夹、改名、关闭去向）照 StudioShell 同一份（session.ts）；
//   宿主＝makeGuestHost（左边工程清单、右边复制给 AI、左上角回 /studio）。
//   外部改档要问使用者、或有提示要显示时，浮在页面最上方正中（整页自己的顶栏不动）。
//   网站游客版另建短网址同步层（share-sync.ts）：它包住本机 store，外框与整页拿的都是包过的那个；服务器来的新版走同一条外部改档。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectStore, StudioApp, StudioLang } from '../types'
import type { ProjectRecord } from '../projects'
import { StudioTProvider } from '../StudioT'
import { useStudioSession } from '../session'
import { createGuestLive, makeGuestHost } from '../guest-host'
import { isStandalone, shareEnabled } from '../host'
import { startAgentLink } from '../agent-link'
import { cliPageJob } from '../cli-page-job'
import { createShareApi, type ShareApi } from '../share-api'
import { localShareBook, type ShareBook } from '../share-book'
import { createShareController, type ShareController } from '../share-sync'
import ExportOptionsDialog from './ExportOptionsDialog'

// 伺服端渲染没有 layout effect（会警告）⇒ 那边退回 useEffect
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface GuestProjectPageProps {
  appDef: StudioApp<unknown>
  record: ProjectRecord
  store: ProjectStore
  lang: StudioLang
  onRelocated: (store: ProjectStore, record: ProjectRecord) => void
  /** 短网址代存的接口与本机登记（缺省＝真的；单测换假的）。 */
  shareDeps?: { api?: ShareApi; book?: ShareBook; location?: { origin: string; href: string; pathname: string } }
}

const navigate = (href: string) => { window.location.assign(href) }

export default function GuestProjectPage({ appDef, record, store: localStore, lang, onRelocated, shareDeps }: GuestProjectPageProps) {
  // 短网址代存（网站游客版才有）：同步层包住本机 store，外框与整页都拿包过的那个（share-sync.ts）
  const flushRef = useRef<() => Promise<void>>(async () => {})
  const share = useMemo<ShareController | null>(() => {
    const loc = shareDeps?.location ?? (typeof window !== 'undefined' ? window.location : null)
    if (!shareEnabled() || !loc) return null
    return createShareController({
      app: appDef.app, projectId: record.id, store: localStore, maxVersion: appDef.format.version,
      api: shareDeps?.api ?? createShareApi(), book: shareDeps?.book ?? localShareBook,
      flush: () => flushRef.current(), location: loc, history: typeof window !== 'undefined' ? window.history : null,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStore, record.id, appDef.app])
  const store = share ? share.store : localStore
  // 外框改名等会把它手上的 store 交回外层：交回的是包过的那个 ⇒ 换回本机 store（免得外层再包一层、同步层重建）
  const relocated = useCallback((s: ProjectStore, r: ProjectRecord) => onRelocated(share && s === share.store ? localStore : s, r), [onRelocated, share, localStore])
  const ss = useStudioSession({ appDef, record, store, lang, onRelocated: relocated, navigate })
  const { t } = ss
  const ssRef = useRef(ss)
  ssRef.current = ss
  const storeRef = useRef(store)
  storeRef.current = store
  flushRef.current = () => ssRef.current.flush()

  // 轮询／心跳；关分页：已建立才提醒，pagehide 用 sendBeacon 打 close
  useEffect(() => {
    if (!share) return
    share.start()
    const onBeforeUnload = (e: BeforeUnloadEvent) => share.onBeforeUnload(e, ssRef.current.t('studio_share_leave_warn'))
    const onPageHide = () => share.onPageHide()
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      share.stop()
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [share])

  // 单机版本机 MCP：编辑器给了 agentJob（文件、表格、简报）⇒ 这页接活·交给外框 agentJob（先存、套用、写回、重载）；
  //   命令列开的无头页另有 load／export 两种活（cli-page-job.ts）先接
  useEffect(() => {
    if (!isStandalone() || !appDef.agentJob) return
    return startAgentLink({ editor: appDef.app, project: () => ({ id: record.id, title: ssRef.current.name || record.name }), handle: async (job) => (await cliPageJob({ appDef, store: storeRef.current, t: ssRef.current.t, flush: () => ssRef.current.flush(), reload: () => ssRef.current.reloadEditor() }, job)) ?? ssRef.current.agentJob(job) })
  }, [appDef, record.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [exportPick, setExportPick] = useState<Set<string> | null>(null)
  const onExport = useCallback(() => {
    if (appDef.exportOptions?.length) setExportPick(new Set())
    else void ssRef.current.runExport(new Set())
  }, [appDef.exportOptions])
  const runExport = (options: ReadonlySet<string>) => { setExportPick(null); void ss.runExport(options) }

  // 宿主：只有存放位置（store）或语言变了才换一个——整页拿它当依赖，换了就重读工程、盖掉手上没存的改动。
  //   忙不忙、能不能挑资料夹、清单那笔纪录（改名后会换）放进 live，工程栏那格自己订阅重画；动作经 ref 叫最新那份。
  const [live] = useState(() => createGuestLive({ record, busy: ss.busy, folderOk: ss.folderOk }))
  useIsoLayoutEffect(() => { live.set({ record, busy: ss.busy, folderOk: ss.folderOk }) })
  const host = useMemo(() => makeGuestHost({
    appDef, record: live.get().record, store, lang, onExport, navigate, live, share,
    onSaveOtherApps: appDef.saveForOtherApps && store.writeExtra ? () => { void ssRef.current.saveOtherApps() } : undefined,
    otherAppsLabel: appDef.saveForOtherApps ? t(appDef.saveForOtherApps.label) : undefined,
    session: {
      appName: ss.appName, busy: live.get().busy, folderOk: live.get().folderOk,
      flush: () => ssRef.current.flush(),
      rename: v => ssRef.current.rename(v),
      leaveRemoved: () => ssRef.current.leaveRemoved(),
      changeFolder: () => ssRef.current.changeFolder(),
      fail: e => ssRef.current.fail(e),
    },
  }), [appDef, store, lang, onExport, ss.appName, live, share, t])

  const Page = appDef.guestPage!
  return (
    <StudioTProvider t={t} lang={lang}>
      <div className="contents" lang={lang} data-testid="studio-guest-page" data-app={appDef.app} data-backend={store.backend}>
        <Page key={ss.editorKey} {...ss.editorProps} host={host} />
        {(ss.externalPending || ss.notice) && (
          <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] w-[min(560px,calc(100vw-16px))] flex flex-col gap-1.5">
            {ss.externalPending && (
              <div className="px-3 py-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 text-[13px] text-[#4A3528] shadow-lg" data-testid="studio-external">
                <span>{t('studio_external_changed')}</span>
                <button type="button" className="h-7 px-3 rounded-md bg-amber-600 text-white keep-white text-xs" onClick={ss.reloadEditor} data-testid="studio-external-reload">{t('studio_external_reload')}</button>
                <button type="button" className="h-7 px-3 rounded-md text-xs hover:bg-black/5" onClick={ss.dismissExternal}>{t('studio_external_later')}</button>
              </div>
            )}
            {ss.notice && (
              <div className={`px-3 py-1.5 flex items-center gap-2 rounded-lg border text-[13px] shadow-lg ${ss.notice.kind === 'err' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role="status" data-testid="studio-notice">
                <span className="flex-1">{ss.notice.text}</span>
                <button type="button" className="text-xs opacity-60 hover:opacity-100" onClick={() => ss.setNotice(null)} aria-label="×">×</button>
              </div>
            )}
          </div>
        )}
        {exportPick && appDef.exportOptions && (
          <ExportOptionsDialog t={t} options={appDef.exportOptions} selected={exportPick}
            onToggle={(id, on) => setExportPick(s => { if (!s) return s; const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })}
            onConfirm={() => runExport(exportPick)} onCancel={() => setExportPick(null)} />
        )}
      </div>
    </StudioTProvider>
  )
}
