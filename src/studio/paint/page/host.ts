// 画板整页（DrawboardPage.tsx）的宿主接口：登入版（网站）与游客版各给一份，页面本身只有一份。
//   通用那几样（品牌、云盘那格、对话那格、has）见 shared/page-host.ts；这里加画板自己的：
//   工程档读写（api）、进页闸、网址、开不到时的整页说明、菜单列品牌（画板本体在 iframe 里·品牌是 DOM 不是 React）。
//   有问号的都是登入版才有的（要后端）：游客版不给 ⇒ 页面就不装那一项。

import type { ReactNode, RefObject } from 'react'
import type { ChatSlotOptions, DriveSlotOptions, StudioPageHost } from '../../shared/page-host'
import type { StudioT } from '../../shared/types'
import type { ApiErr, ChromeOpts, CloudTabs, DlSite, DocLock, ProjGet } from './drawboard-host'
import type { PaintGenAiProvider, PaintSegmentConfig } from './genai'

/** has() 认得的功能键（游客版全回 false·删减清单逐项写了为什么要后端） */
export const PAINT_FEATURES = {
  /** 右边对话栏里的角色对话（要帐号、角色、对话后端） */
  roleChat: 'roleChat',
  /** 角色经命令中继在这一页上动手画＋画的时候的遮罩（要中继后端） */
  roleDrawing: 'roleDrawing',
  /** 左栏「雲盤」页签是云端硬碟树（要登入、云盘） */
  cloudDrive: 'cloudDrive',
} as const
export type PaintFeature = keyof typeof PAINT_FEATURES

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; err: ApiErr }

/** 工程档读写：登入版＝云盘里的 .dlcanvas（/api/drawboard/project）；游客版＝这台浏览器／资料夹里的工程（project.json＋assets/） */
export interface PaintProjectApi {
  /** 建一份新档（登入版：第一次存档、存储副本）。没有 ⇒ 页面不建档：存储副本改成整份交给 upload（游客版＝下载一份 .dlcanvas） */
  create?(folderId: string | null, name?: string): Promise<ApiResult<{ id: string; folder_id: string | null; title: string; updated_at: string }>>
  get(id: string): Promise<{ ok: true; data: ProjGet } | { ok: false; err: ApiErr }>
  /** base＝上次读／存时的 updated_at：对不上（别处改过）⇒ 回 409（带现在那版的 updated_at） */
  put(id: string, base: string | null, project: unknown): Promise<{ ok: true; updated_at: string; bytes: number } | { ok: false; err: ApiErr }>
  /** 导出的档（PNG、存储副本）交出去：登入版＝存进云盘 folderId；游客版＝浏览器下载 */
  upload(blob: Blob, name: string, folderId: string | null): Promise<{ ok: true; id: string; name: string } | { ok: false; err: ApiErr }>
}

export type PaintLoadFail = 'login' | 'bad_id' | 'not_found' | 'error'

/** 云盘那格（左栏「雲盤」页签）要的东西 */
export interface PaintDriveSlotOptions extends DriveSlotOptions {
  /** 现在这份的档 id（云盘树标出「现在这份」） */
  currentId: string | null
  /** 眼睛钮：睁眼＝全列 */
  driveAll: boolean
  setDriveAll(on: boolean): void
  /** 开一份画板档（使用者点的·走「这份画板正被谁动」那把锁） */
  openFile(id: string): void
  /** 一张图放进画板（at＝落点文件坐标·null＝置中） */
  placeImage(id: string, title: string, at: [number, number] | null): void
  say(text: string, ms?: number): void
}

/** 对话那格要的东西 */
export interface PaintChatSlotOptions extends ChatSlotOptions {
  /** 输入框的占位字 */
  placeholder: string
  /** 现在这份（角色对话抬头、角色记在档上） */
  proj: { id: string; title: string } | null
  /** 页面存档建新档、中继来活时要通知角色那边（登入版的对话格把自己的两只函式挂上来） */
  roleHooks: RefObject<{ adopt: (id: string) => void; note: (key: string) => void; key?: () => string | null }>
}

/** 角色动手画那一组（中继、遮罩、「在别的分页开着」提示）要的东西 */
export interface PaintLiveOptions {
  site: DlSite | null
  enabled: boolean
  frameRef: RefObject<HTMLIFrameElement | null>
  siteRef: RefObject<DlSite | null>
  projRef: RefObject<{ id: string } | null>
  docLock: DocLock
  cloud: CloudTabs
  say: (text: string, ms?: number) => void
  roleHooks: RefObject<{ adopt: (id: string) => void; note: (key: string) => void; key?: () => string | null }>
  /** 角色正在画（遮罩罩着）⇒ 页面挡人手切档、放图（这一组每次渲染把值写进来） */
  locked: { current: boolean }
  /** 「有新版」那条在不在（提示条排在它下面） */
  staleShown: boolean
}

export interface PaintPageHost extends StudioPageHost {
  renderDriveSlot(opts?: PaintDriveSlotOptions): ReactNode
  renderChatSlot(opts?: PaintChatSlotOptions): ReactNode
  /** 菜单列最左那格（画板 iframe 里·installChrome 用） */
  chrome(t: StudioT): ChromeOpts
  api: PaintProjectApi
  /** 进页闸：false ⇒ 整页「沒有開放」 */
  gate(): Promise<boolean>
  /** 页面起好时要开的那份（登入版＝网址 ?id=；游客版＝这个工程） */
  initialId(): string | null
  /** 编号格式对不对（不对 ⇒ 不读、整页明说） */
  isId(id: string): boolean
  /** 读那份没成：回应码 ⇒ 哪一种 */
  loadFail(status: number | null): PaintLoadFail
  /** 现在这份换了 ⇒ 网址跟着换成什么（undefined＝网址不动） */
  pageHref?(id: string | null): string | undefined
  /** 浏览器分页标题 */
  tabTitle(failTitle: string | null, title: string, t: StudioT): string
  /** 档名 ⇒ 给人看的名字（登入版去掉云盘档名前缀） */
  displayName(title: string): string
  /** 进页闸没过的整页 */
  renderGateClosed(t: StudioT): ReactNode
  /** 起好时要开的那份开不到的整页说明 */
  renderLoadFail(o: { kind: PaintLoadFail; title: string; t: StudioT }): ReactNode
  /** 角色动手画那一组（登入版才有） */
  renderLive?(o: PaintLiveOptions): ReactNode
  /** 云盘条目拖进画板（登入版才有）⇒ 回拆线函式 */
  installDrop?(doc: Document, site: DlSite, onDrop: (item: { id: string; kind: string; name: string; mime?: string | null }, at: [number, number] | null) => void): () => void
  /** 云盘图放进画板（登入版才有） */
  placeImage?(site: DlSite, id: string, name: string, at: [number, number] | null): Promise<unknown>
  /** 左栏切到云盘页签（第一次要取树）／云盘里多了档（导出、另存）⇒ 宿主自己决定要不要重取 */
  onDriveTab?(): void
  driveChanged?(): void
  /** 生成式填充／扩展／移除、文字转向量（用网站生图服务·扣点数）：登入版才有；没给 ⇒ 画板一律出「需登入堤麟」的说明（游客版、单机版） */
  genai?(ctx: { folderId(): string | null }): PaintGenAiProvider
  /** AI 去背／选择主体（AI）在浏览器本地跑的模型来源（不扣点）·没给或回 null ⇒ 画板退回传统演算法 */
  segment?(): PaintSegmentConfig | null
  /** 画板起好时宿主自己要装的（登入版：桌面版列印） */
  install?(site: DlSite, frameWin: Window & typeof globalThis): void
  /** 存档状态（游客版报给外框：顶栏未存提示、离开前提醒）＋页面的 flush／重读两只给宿主用 */
  saveState?(st: 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'blocked' | 'offline', dirty: boolean): void
  connect?(c: { flush(): Promise<void>; reload(): Promise<void> } | null): void
  /** 画板「檔案▸關閉」把这份关掉之后：没给 ⇒ 照登入版留一张空白画板（之后存档另建一份） */
  afterHostClosed?(): void
}
