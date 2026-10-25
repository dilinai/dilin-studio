'use client'
// 游客版画板（/studio/paint/<工程>）：渲染跟登入版同一份整页（DrawboardPage.tsx），宿主换成本机工程——
//   通用那几格（云盘那格＝工程清单＋存放位置、对话那格＝复制仓库给 AI、品牌、has）来自外框给的游客宿主（props.host）；
//   画板自己的：工程档读写走 guest-api.ts（这个工程的 project.json＋assets/）、导出与另存副本是下载、
//   起好时开的就是这个工程、网址不动、没有进页闸、没有角色对话／中继／云盘树（要后端的不给 ⇒ 页面不装）。
//   外框要的：存档状态与「有没存的改动」（顶栏、离开前提醒）、flush（汇出／换存放位置前）、外面改了档 ⇒ revision 变 ⇒ 重读。
//   单机版：画板起好就接本机 MCP（shared/agent-link.ts）·AI 下的命令照网站 drawboard_run 同一支 runRelayJob 在这页跑（先过参数规格）。
import { useEffect, useMemo, useRef } from 'react'
import type { GuestPageProps } from '../../shared/page-host'
import type { SaveState } from '../../shared/types'
import { useStudioT } from '../../shared/StudioT'
import { isStandalone, studioHref, studioLogoSrc } from '../../shared/host'
import { startAgentLink } from '../../shared/agent-link'
import { getProject } from '../../shared/projects'
import DrawboardPage from './DrawboardPage'
import { createGuestApi } from './guest-api'
import { canvasPng, runRelayJob, type DlSite, type RelayJobIn } from './drawboard-host'
import { writeBack, WRITE_BACK_MS } from './write-back'
import { OPENED_BY_CLI, paintPageJob, setLiveSite } from './agent-export'
import { PAINT_FEATURES, type PaintPageHost } from './host'

/** 游客版没有的功能（键见 host.ts PAINT_FEATURES）·外框给的游客宿主 has() 也都回 false */
export const PAINT_GUEST_FEATURES: Record<keyof typeof PAINT_FEATURES, boolean> = { roleChat: false, roleDrawing: false, cloudDrive: false }

export default function GuestPaintPage(props: GuestPageProps) {
  const { host: base, store, projectId, revision } = props
  const t = useStudioT()
  const cb = useRef(props)
  cb.current = props
  const tRef = useRef(t)
  tRef.current = t
  const ctl = useRef<{ flush(): Promise<void>; reload(): Promise<void> } | null>(null)
  const agentStop = useRef<(() => void) | null>(null)
  // 外框的底座宿主经 ref 读：它换一份（改名后、换语言）时本页的宿主与资料层（api 里记着读档时的基准）不跟着重做
  const baseRef = useRef(base)
  baseRef.current = base

  // 画好后把预览图与每层实际外框写回工程夹（write-back.ts）：读进一版、存好一版之后等画面稳了再写·连发只写最后一次
  const siteRef = useRef<DlSite | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const host = useMemo<PaintPageHost>(() => {
    const later = () => {
      if (!store.writeExtra) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { const s = siteRef.current; if (s) void writeBack(s, store, canvasPng).catch(() => {}) }, WRITE_BACK_MS)
    }
    const api = createGuestApi({ store, projectId, untitled: () => tRef.current('drawboard_untitled'), listedName: async () => (await getProject(projectId))?.name, onSettled: later })
    const blank = (title: string, desc: string | null, t: (k: string) => string) => (
      <div className="h-screen bg-neutral-900 text-neutral-300 flex flex-col items-center justify-center gap-4 px-6 text-center" data-testid="drawboard-load-failed">
        <p className="text-base font-semibold text-neutral-100">{title}</p>
        {desc && <p className="max-w-md text-sm text-neutral-400">{desc}</p>}
        <a href={studioHref.root()} className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm">{t('drawboard_back_studio')}</a>
      </div>
    )
    return {
      kind: 'guest',
      renderHomeBrand: (o) => baseRef.current.renderHomeBrand(o),
      renderDriveSlot: (o) => baseRef.current.renderDriveSlot(o),
      get driveSlotLabel() { return baseRef.current.driveSlotLabel },
      renderChatSlot: (o) => baseRef.current.renderChatSlot(o),
      has: (k) => baseRef.current.has(k),
      // 品牌照外框左上角那颗（同一张图、同一个名字·回 /studio 总页）
      chrome: (tt) => ({ homeHref: studioHref.root(), homeLabel: tt('studio_brand'), homeTitle: tt('studio_all_apps'), logoSrc: studioLogoSrc() }),
      api,
      gate: async () => true,
      initialId: () => projectId,
      isId: (id) => id === projectId,
      loadFail: (status) => (status === 404 ? 'not_found' : 'error'),
      tabTitle: (failTitle, title, tt) => `${failTitle || title} · ${tt('studio_app_paint')}`,
      displayName: (title) => title,
      renderGateClosed: (tt) => blank(tt('drawboard_not_open'), null, tt),
      renderLoadFail: ({ title, t: tt }) => blank(title, tt('drawboard_open_failed_desc'), tt),
      // 画板起好：顶栏那句「給 AI 的命令集」是登入版角色用的 ⇒ 藏起来
      install: (s) => { siteRef.current = s; later(); const el = s.doc?.getElementById('agentHint') as HTMLElement | null | undefined; if (el && !baseRef.current.has(PAINT_FEATURES.roleDrawing)) el.style.display = 'none'
        agentStop.current?.()
        setLiveSite(s)
        // 本机 MCP 的活：export（PSD／PNG／工程）、load（只给 tools/paint-cli.mjs 开的那页）先在这页办·其余照网站同一支 runRelayJob
        const cli = OPENED_BY_CLI
        const jobCtx = { site: s, store, cli, flush: async () => { await ctl.current?.flush() }, reload: async () => { await ctl.current?.reload() } }
        agentStop.current = isStandalone() ? startAgentLink({ editor: 'paint', project: () => ({ id: projectId, title: api.name }), handle: async (job) => (await paintPageJob(jobCtx, job)) ?? runRelayJob(s, job as unknown as RelayJobIn) }) : null
      },
      saveState: (st, dirty) => {
        const p = cb.current
        const s: SaveState | null = st === 'saving' ? 'saving' : st === 'saved' ? 'saved' : st === 'error' || st === 'blocked' ? 'error' : st === 'pending' || st === 'offline' ? 'dirty' : null
        p.onDirtyChange(dirty)
        if (s) p.onSaveStateChange?.(s)
      },
      connect: (c) => { ctl.current = c },
      // 「檔案▸關閉」把这个工程关掉 ⇒ 离开这个工程（外框决定去哪：这个编辑器最近的另一份，没有就回 /studio）·游客版没有「另建一份」可存
      afterHostClosed: () => { const close = cb.current.onClose; if (close) void close(); else window.location.assign(studioHref.root()) },
    }
  }, [store, projectId])

  useEffect(() => () => { agentStop.current?.(); agentStop.current = null; setLiveSite(null) }, [])
  // 外框汇出／换存放位置前先存
  useEffect(() => {
    const reg = cb.current.registerFlush
    reg?.(async () => { await ctl.current?.flush() })
    return () => { reg?.(null) }
  }, [host])
  // 外面改了档、外框决定重读 ⇒ 载入最新那版（第一次的值是起好时那次·已经读过）
  const firstRevision = useRef(revision)
  useEffect(() => { if (revision !== firstRevision.current) void ctl.current?.reload() }, [revision])

  return <DrawboardPage host={host} />
}
