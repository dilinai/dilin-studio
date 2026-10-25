'use client'
// 游客版宿主工厂：makeGuestHost(...) 回一个 StudioPageHost（page-host.ts），交给编辑器整页（appDef.guestPage）。
//   renderDriveSlot ＝ 云盘格（ui/GuestDrivePane.tsx）：「登入後即可使用雲端硬碟」＋登入钮（网站游客版与开源单机版一样·一个网址一份·不列清单）
//   renderChatSlot  ＝ 「選擇工程檔存放位置」（工程放本机·本机 AI 直接改·单机版选好才能用、没有下載）＋下載到電腦；网站游客版另有「複製」建短网址（工程放服务器·网页版 AI 也能改）（ui/AIPanel.tsx）
//   renderHomeBrand ＝ 左上角 logo＋品牌字，回 /studio 总页（样子同登入版回首页那颗）
//   has(功能键)     ＝ 编辑器给的功能表（appDef.guestFeatures）里写 true 的才有；没列的一律没有（要后端的不用列）。
// 编辑器自己的资料操作（读写工程、传素材…）由整页拿 props.store 在自己的 page/host.ts 里加，不经这里。

// 宿主一经做好就不随「忙不忙／能不能挑资料夹／清单那笔纪录」换一份：整页拿宿主当依赖（读工程的 effect 也在里面），
//   换了会重读工程、把手上没存的改动盖掉。这几样会变的放进 GuestLive，工程栏那格自己订阅、自己重画。

import { useSyncExternalStore } from 'react'
import type { ProjectStore, StudioApp, StudioLang } from './types'
import type { StudioPageHost, HomeBrandOptions } from './page-host'
import type { ProjectRecord } from './projects'
import type { ProjectEnv } from './project-actions'
import type { StudioSession } from './session'
import type { ShareController } from './share-sync'
import { isStandalone, studioHref, studioLogoSrc } from './host'
import { useStudioT } from './StudioT'
import { STUDIO_SHARED_I18N, makeStudioT } from './i18n'
import ProjectPane, { type ProjectPaneProps } from './ui/ProjectPane'
import GuestDrivePane from './ui/GuestDrivePane'
import AIPanel, { type AIPanelFolder, type AIPanelProps } from './ui/AIPanel'
import { studioNeg as studioGuestNeg } from './ai-panel.pure'

/** 工程栏那格要的、会随外框状态变的几样。 */
export interface GuestLiveState {
  record: ProjectRecord
  busy: boolean
  folderOk: boolean
}
/** 一个小订阅源：外框每次重绘 set 一次（值没变不通知），工程栏用 useSyncExternalStore 读。 */
export interface GuestLive {
  get(): GuestLiveState
  subscribe(fn: () => void): () => void
  set(next: GuestLiveState): void
}
export function createGuestLive(init: GuestLiveState): GuestLive {
  let cur = init
  const subs = new Set<() => void>()
  return {
    get: () => cur,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
    set: (next) => {
      if (next.record === cur.record && next.busy === cur.busy && next.folderOk === cur.folderOk) return
      cur = next
      for (const fn of [...subs]) fn()
    },
  }
}

function LiveProjectPane({ live, ...rest }: Omit<ProjectPaneProps, 'record' | 'busy' | 'folderOk'> & { live: GuestLive }) {
  const s = useSyncExternalStore(live.subscribe, live.get, live.get)
  return <ProjectPane {...rest} record={s.record} busy={s.busy} folderOk={s.folderOk} />
}

function LiveAIPanel({ live, ...rest }: Omit<AIPanelProps, 'busy' | 'folder'> & { live: GuestLive; folder?: Omit<AIPanelFolder, 'ok'> }) {
  const s = useSyncExternalStore(live.subscribe, live.get, live.get)
  return <AIPanel {...rest} busy={s.busy} folder={rest.folder && { ...rest.folder, ok: s.folderOk }} />
}

const BRAND_TONE = {
  light: 'text-[#2B2722] hover:bg-black/5',
  // 暗底（剪辑）悬停只微亮：用显式色——站内 theme-light 会把 hover:text-white／hover:bg-white/5 翻成深色（globals.css），logo 字就黑掉了
  dark: 'text-neutral-100 hover:text-[#ffffff] hover:bg-[rgba(255,255,255,0.10)]',
} as const

/** 左上角品牌：logo＋品牌字（窄屏 iconOnly 只留图），点了回 /studio 总页。 */
export function GuestHomeBrand({ tone = 'light', iconOnly = false, testId }: HomeBrandOptions) {
  const t = useStudioT()
  return (
    <a href={studioHref.root()} title={t('studio_all_apps')} data-testid={testId ?? 'studio-back'}
      className={`flex items-center gap-1.5 text-sm font-semibold rounded-md px-1.5 py-1 -my-1 -ml-1.5 transition-colors duration-150 shrink-0 ${BRAND_TONE[tone]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={studioLogoSrc()} alt={iconOnly ? t('studio_brand') : ''} width={22} height={22} className="object-contain shrink-0" />
      {!iconOnly && t('studio_brand')}
    </a>
  )
}

export interface GuestHostInput {
  appDef: Pick<StudioApp<unknown>, 'app' | 'format' | 'guestFeatures' | 'saveForOtherApps'>
  record: ProjectRecord
  store: ProjectStore
  lang: StudioLang
  /** 外框逻辑（session.ts）里工程栏要用的那几支。 */
  session: Pick<StudioSession, 'appName' | 'busy' | 'folderOk' | 'flush' | 'rename' | 'leaveRemoved' | 'changeFolder' | 'fail'>
  /** 会变的那几样（纪录、忙不忙、能不能挑资料夹）；给了 ⇒ 工程栏照它的现值画，record／session.busy／session.folderOk 只当初值。 */
  live?: GuestLive
  /** 汇出正在开的这份（有勾选项就先弹小窗，由外层决定）。 */
  onExport(): void
  /** 单机版右栏「存给别家软件」（编辑器有 saveForOtherApps 才给）。 */
  onSaveOtherApps?(): void
  /** 那颗的按钮字（已翻好）。 */
  otherAppsLabel?: string
  navigate(href: string): void
  env?: ProjectEnv
  /** 短网址代存（网站游客版·share-sync.ts）：右栏「複製」建立／复制短网址、验证码、收回 AI 编辑权。 */
  share?: ShareController | null
}

export function makeGuestHost(i: GuestHostInput): StudioPageHost {
  const features = i.appDef.guestFeatures ?? {}
  const t = makeStudioT([STUDIO_SHARED_I18N], i.lang)
  const live = i.live ?? createGuestLive({ record: i.record, busy: i.session.busy, folderOk: i.session.folderOk })
  return {
    kind: 'guest',
    renderHomeBrand: opts => <GuestHomeBrand {...opts} />,
    renderDriveSlot: opts => !studioGuestNeg('studio-guest-project-pane') ? (
      <GuestDrivePane variant={opts?.variant} />
    ) : (
      <LiveProjectPane live={live} appDef={i.appDef} store={i.store}
        flush={i.session.flush} navigate={i.navigate}
        onRenameCurrent={i.session.rename} onRemovedCurrent={i.session.leaveRemoved}
        onChangeFolder={() => { void i.session.changeFolder() }} onExport={i.onExport} onError={i.session.fail}
        variant={opts?.variant} env={i.env} />
    ),
    // 页面给的 title 是登入版角色对话那句（选择角色），这格用 AIPanel 自己的标题
    renderChatSlot: opts => (
      <LiveAIPanel {...opts} live={live} title={undefined} app={i.appDef.app} appName={i.session.appName} store={i.store}
        summary={i.appDef.format.summaryForAI(i.lang)} share={i.share} onDownload={isStandalone() ? undefined : i.onExport} requireFolder={isStandalone()}
        otherApps={isStandalone() && i.onSaveOtherApps && i.otherAppsLabel ? { label: i.otherAppsLabel, onSave: i.onSaveOtherApps } : undefined}
        folder={{ inFolder: i.store.backend === 'folder', label: i.store.label, onPick: () => { void i.session.changeFolder() } }} />
    ),
    chatSlotLabel: t('studio_ai_repo_title'),
    driveSlotLabel: t('studio_slot_drive'),
    has: (feature: string) => Object.prototype.hasOwnProperty.call(features, feature) && features[feature] === true,
  }
}
