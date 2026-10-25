// 简报整页（SlidesPage.tsx）的宿主接口。
//   整页只有一份：登入版（网站的简报编辑页）与游客版（/studio/slides/<编号>）都渲染它，差别全从这里进来。
//   登入版宿主＝网站接线（登入、网站接口、云盘、角色对话、AI 编辑保护罩、媒体签名网址）；
//   游客版宿主＝本机工程档（local-api.ts 在浏览器里做跟网站接口同形的处理），要后端的功能 has() 回 false、页面就不画那颗钮。
//
// has() 的功能键（游客版回 false 的就不画）：
//   'drive'          顶栏「雲端硬碟」钮（开网站云盘页）
//   'share'          顶栏「分享」钮与分享弹窗（公开链接要网站）
//   'userTemplates'  选模板弹窗的「我的模板」页签（存在云盘的模板夹）
//   'deckTemplates'  选模板弹窗的整份原创模板（本体与图在网站上，套用由网站算）

import type { ReactNode, RefObject } from 'react'
import type { ChatSlotOptions, DriveSlotOptions, StudioPageHost } from '../../shared/page-host'
import type { SlidesVisibility } from '../share-visibility'

/**
 * 页面对资料的请求。都回 Response（游客版自己组 Response），页面照登入版的回应码与栏位判读，一行不改。
 * 栏位形状＝网站简报接口：一行简报 { id, title, html_content, deck_data, updated_at, visibility, editor_agent_key }。
 */
export interface SlidesApi {
  /** 读一份简报（整行）。 */
  getSlide(id: string, init?: { cache?: RequestCache }): Promise<Response>
  /** 改一份简报的栏位（旧整页简报存 HTML、改公开设定）。 */
  putSlide(id: string, body: Record<string, unknown>): Promise<Response>
  /** 旧整页简报第一次存档（新建一行）。 */
  createSlide(body: Record<string, unknown>): Promise<Response>
  /** 新建元件版简报：空白一张（deckId＝幂等键）或把旧整页简报另存一份元件版（fromLegacyId）。 */
  createDeck(body: { deckId?: string; lang?: string; fromLegacyId?: string }): Promise<Response>
  /** 元件版简报的一笔结构化改动（乐观戳 expectedRevision；对不上 ⇒ 409＋最新那行）。 */
  patchDeck(body: { slideId: string; expectedRevision: number | null; op: unknown }): Promise<Response>
  /** 按元件当场渲出的整份 HTML（下载用）：{ html }。 */
  deckHtml(deckId: string): Promise<Response>
  /** 现在的乐观戳（轮询「别人改了没有」）：{ revision }。 */
  deckRevision(deckId: string): Promise<Response>
  listVersions(slideId: string): Promise<Response>
  getVersion(versionId: string): Promise<Response>
  restoreVersion(versionId: string): Promise<Response>
  /** 传一个图／影片档：{ url（写进简报的位置）, display_url（画面显示用）}。 */
  uploadMedia(file: File): Promise<Response>
  /** 私密媒体换显示网址：{ urls: { 原网址: 显示网址 } }。 */
  signMedia(urls: string[]): Promise<Response>
  /** 这份简报由哪只角色编辑：{ editor_agent_key }。 */
  setEditorAgent(id: string, key: string | null): Promise<Response>
  listUserTemplates(): Promise<Response>
  saveUserTemplate(body: { slideId: string; name: string; expectedRevision: number | null }): Promise<Response>
  deleteUserTemplate(id: string): Promise<Response>
}

/** 画布、清单、页面设定拿到的一份媒体（登入版上传元件回的形状）。 */
export type UploadedAttachment = { url: string; displayUrl?: string; name: string; mime?: string; source: 'drive' | 'local' }

export type EditorLoadFail = 'login' | 'bad_id' | 'not_found' | 'error'

/** 整页挡住不画编辑器的几种情形（宿主决定画什么）。 */
export type SlidesGate = 'auth_checking' | 'auth_slow' | 'login' | 'not_found' | 'bad_id'

/** AI 编辑保护罩（登入版：角色正在改这份时罩住中栏）。页面只看 locked，其余交回宿主画。 */
export type SlidesShieldHandle = { locked: boolean }
export type SlidesShieldFlush = {
  onLock: () => void
  isOpen: () => boolean
  track: <T>(p: Promise<T>, ok?: (v: T) => boolean) => Promise<T>
}

/** 右栏那一格（登入版＝角色对话）要的这份简报资讯。 */
export type SlidesChatContext = {
  docId: string
  docTitle: string
  editorAgentKey: string | null
  onEditorAgentKeyChange: (key: string | null) => Promise<boolean>
  slidesFormat: 'components' | 'legacy'
  roster?: unknown
}

export interface SlidesPageHost extends StudioPageHost {
  api: SlidesApi
  /** 网址参数（登入版＝网址列；游客版＝工程编号当 id）。 */
  useSearchParams(): { get(name: string): string | null }
  useRouter(): { push(href: string): void }
  /** 此刻网址上的简报编号（同步现读，确认删页那一下用）。 */
  urlDocId(): string | null
  /** 新建的空白简报落定后，网址换成它（不新增浏览纪录）。 */
  replaceDeckUrl(id: string): void
  /** 打开另一份简报（旧整页简报另存元件版之后）。 */
  openDeck(id: string): void
  isEditorId(id: string): boolean
  editorLoadFail(status: number | null): EditorLoadFail
  /** 登入了没有（游客版恒 true）。 */
  checkAuth(): Promise<boolean>
  /** 新建简报的语言。 */
  slideLang: 'zh-TW' | 'zh-CN'
  shareOptions(): SlidesVisibility[]
  shareUrl(id: string): string
  /** 传档前先拦（太大）：回一句给人看的话；能传 ⇒ null。 */
  uploadTooLarge(file: File): string | null
  /** 画面上显示媒体用的网址（签名表里没有的那些）。 */
  mediaUrl(src: string): string
  /** 下载 PowerPoint 时外站图直取失败的代理网址（没有 ⇒ 不走第二次）。 */
  pptxProxy?: (url: string, kind: 'image' | 'video') => string
  /** 旧整页简报下载 PowerPoint 的量版器（元件版不用）。 */
  loadLegacyPptx(): Promise<{ buildSlidesPptx: (o: { html: string; title: string; proxy?: (url: string, kind: 'image' | 'video') => string }) => Promise<{ blob: Blob; stats: { imagesSkipped: number } }> }>
  /** 网址带了「指定编辑角色」⇒ 回要改绑成哪只（跟现绑一样 ⇒ null）。 */
  editorKeyFromUrl(current: string | null): string | null
  /** 从云盘拖进画布的条目 ⇒ 一份媒体。 */
  resolveDriveDrop(id: string, name: string): Promise<{ ok: true; attachment: UploadedAttachment } | { ok: false }>
  useEditorRoleBusy(o: { editorAgentKey: string | null; enabled: boolean }): { busy: boolean; roster: unknown }
  useEditorAIShield(o: { kind: 'slides'; id: string | null; enabled: boolean; onRelease: () => Promise<void> | void; containerRef: RefObject<HTMLDivElement | null>; onLock: () => void; hold: boolean }): SlidesShieldHandle
  useShieldFlush(o: { run: () => Promise<boolean> | boolean; onFail: () => void }): SlidesShieldFlush
  /** 掀罩前拉新版要不要静默（同一份已落屏的档）。 */
  shieldReloadQuiet(a: { id: string | null | undefined; landedId: string | null | undefined; idLoad: string }): boolean
  useSignedMediaRefresh(o: { map: Record<string, string>; merge: (fresh: Record<string, string>) => void; frames: () => Array<HTMLIFrameElement | null | undefined>; root: () => Document }): void
  renderGate(kind: SlidesGate, id: string | null): ReactNode
  renderShieldPill(shield: SlidesShieldHandle, testId: string): ReactNode
  renderShield(shield: SlidesShieldHandle, testId: string): ReactNode
  renderRestoreBar(p: { testId: string; onApply: () => void; onDiscard: () => void; applyLabel: string | null; children?: ReactNode }): ReactNode
  renderDriveSlot(opts?: DriveSlotOptions & { currentId?: string | null }): ReactNode
  renderChatSlot(opts?: ChatSlotOptions & { slides?: SlidesChatContext }): ReactNode
}
