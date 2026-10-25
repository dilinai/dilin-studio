// 文件编辑器整页（DocsPage）的宿主接口：在 shared/page-host.ts 的 StudioPageHost 上加文件页自己要的资料操作。
//   登入版宿主（在网站那边）＝网站接线：云文档读写接口、云盘、角色对话、上传、生成、分享、上架…
//   游客版宿主（./guest/guest-host.tsx）＝工程资料夹（shared/store.ts 的 ProjectStore）：要后端的那几样 has() 回 false，页面就不画。
//   页面只认这里的形状，⛔ 直接 import 网站任何东西。
//
// 功能键（has）——游客版回 false 的就是删减清单那几条：
//   share        分享钮＋分享弹窗（公开连结、分享到个人主页）
//   listing      付费上架（上架钮、上架资料弹窗、卡点线）
//   driveLink    顶栏「雲端硬碟」连结
//   importWord   汇入 Word（服务端把 .docx 转成新文件）
//   pdf          PDF 汇出（服务端出档）
//   wordServer   Word 汇出走服务端（游客版直接用浏览器里那条）
//   fileCard     档案卡片（挂云盘里的档）
//   imageTicket  文中配图工单（确认后生成、耗用点数）
//   history      撤销／重做接云端回滚历史（游客版用编辑器自带的撤销）
//   docLive      角色改完自动出现（轮询／即时订阅）＋AI 编辑保护遮罩
//   roleWire     右栏绑定角色（选角色、角色工作态）

import type { ReactNode, RefObject } from 'react'
import type { AnyExtension, NodeViewRendererProps } from '@tiptap/core'
import type { ChatSlotOptions, StudioPageHost } from '../../shared/page-host'
import type { MdBlockHooks } from '../core/markdown'
import type { DocLayers } from '../core/doc-layers/types'
import type { DocPaperPref, DocPaperSettings } from '../core/paper-size'
import type { DocsMediaEnv } from './media/env'

export type DocsFeature =
  | 'share' | 'listing' | 'driveLink' | 'importWord' | 'pdf' | 'wordServer' | 'fileCard'
  | 'imageTicket' | 'history' | 'docLive' | 'roleWire'

/** 像 fetch 的 Response（登入版就是真的 Response；游客版是本机读写的结果）。 */
export interface HostResponse {
  ok: boolean
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>
  clone(): HostResponse
  blob(): Promise<Blob>
}

/** 读不到这份文件的原因（登入版：没登入／编号不对／找不到／一时失败）。 */
export type DocsLoadFail = 'login' | 'bad_id' | 'not_found' | 'error'

export type ShareVisibility = 'private' | 'unlisted' | 'public'
export interface ProfilePublishState { published: boolean; coverUrl: string; title: string }

export interface DocsUploadResult { url: string; isVideo: boolean; isAudio?: boolean; jobId?: string; transcoding?: boolean }
/** 一笔上传（插图／影音）：done＝传完的结果（失败 ⇒ null）；abort＝节点拿掉时停。 */
export interface DocsUploadTask { done: Promise<DocsUploadResult | null>; abort(): void }

/** 从云盘挑来的档（档案卡片用）。 */
export interface DocsAttachment { fileId?: string; name?: string; mime?: string }

/** AI 编辑保护遮罩的状态（登入版那套状态机的把手·页面只读这几栏）。 */
export interface DocsAIShield {
  locked: boolean
  by: string
  ingest(d: Record<string, unknown>): void
  kick(): void
}

export interface DocsChatSlotOptions extends ChatSlotOptions {
  /** 右栏绑定的那份档与编辑角色（登入版角色对话要；游客版用不到）。 */
  roleWire?: { docKind: 'doc'; docId: string; docTitle: string; editorAgentKey: string | null; onEditorAgentKeyChange: (key: string | null) => Promise<boolean> }
  rosterFrom?: unknown
}

/** 角色改完自动出现：轮询那一拍的判定结果（同网站 lib/doc-live）。 */
export type DocsLiveDecision =
  | { action: 'none'; reason: 'no_stamp' | 'unchanged' }
  | { action: 'own' }
  | { action: 'locked' }
  | { action: 'apply'; content: string; title: string | null }
  | { action: 'prompt'; content: string; title: string | null }

/** 角色改完自动出现的那组判定（登入版 lib/doc-live 的同名函式）。 */
export interface DocsLiveKit {
  createWatcher(): { start(docId: string, l: { onChange: () => void; onLive: (live: boolean) => void }): () => void }
  decideDocLiveUpdate(i: {
    server: { updated_at?: unknown; content?: unknown; title?: unknown }
    lastSeenUpdatedAt: string | null
    ownWriteStamps: ReadonlySet<string>
    localContent: string
    baselineContent: string
    dirty: boolean
    locked: boolean
  }): DocsLiveDecision
  docLivePollDelay(live: boolean, base: number): number
  editingDisplayName(i: { editingBy: unknown; editorAgentKey: unknown; dilinName: string }): string
  boundRoleName(editorAgentKey: unknown, dilinName: string): string
  rememberOwnWriteStamp(set: Set<string>, stamp: unknown): void
}

export interface DocsPageHost extends StudioPageHost {
  has(feature: DocsFeature | string): boolean
  renderChatSlot(opts?: DocsChatSlotOptions): ReactNode

  // ── 进出 ──
  navigate(href: string): void
  /** 打开另一份文件（汇入 Word 之后转过去）。 */
  openDoc(id: string): void
  /** 目前的使用者；null ⇒ 没登入（登入版转去登入页）。 */
  getUser(): Promise<{ email: string | null } | null>
  loginRedirect(docId: string): void
  loadFailOf(status: number | null): DocsLoadFail

  // ── 这份文件的读写（形状同网站 /api/aiscribe/docs：GET 回整份；PUT 收部分栏位） ──
  getDoc(docId: string): Promise<HostResponse>
  putDoc(docId: string, body: Record<string, unknown>, opts?: { bearer?: boolean }): Promise<HostResponse>

  // ── 偏好 ──
  loadEditorFontScale(): Promise<number | null>
  saveEditorFontScale(scale: number): void | Promise<void>
  /** 新文件的纸张初值（网站存在帐号偏好；游客版不用）。 */
  saveDocPaperPref(paper: DocPaperPref | null): Promise<void>

  // ── 媒体 ──
  media: DocsMediaEnv
  /** 正文里的视频、音讯节点（schema 同一份·各宿主接自己的取法）。 */
  videoNode: AnyExtension
  audioNode: AnyExtension
  /** 档案卡片节点（游客版没有）。 */
  fileCardNode?: AnyExtension
  fileCardUploadRegistry?: Map<string, File>
  fileCardAccept?: string
  /** 正文图片节点外面再包一层（游客版：assets/ 路径不进 src、免得浏览器去网站要档）。 */
  wrapMediaNode?<T extends AnyExtension>(ext: T, tag: 'img' | 'video' | 'audio'): T
  /** md⇄编辑器 HTML 转换的额外规则（登入版：档案卡片那一行）。 */
  mdHooks?: MdBlockHooks
  /** 编辑器 HTML ⇒ 存档用的 HTML（游客版要把 assets/ 路径换回 src）。 */
  saveHtml?(html: string): string
  uploadMedia(file: File, onProgress: (pct: number) => void): DocsUploadTask
  transcodeStatus(jobId: string): Promise<{ status: string; transcodedUrl: string | null }>
  /** 单发上传会被挡的大小（登入版 100MB）。 */
  exceedsUploadLimit(size: number): boolean
  /** 文中配图工单那张卡（游客版没有）。 */
  renderImageTicket?(props: NodeViewRendererProps): ReactNode
  isImageTicketSrc?(src: string): boolean
  renderDrivePicker?(props: { onPick: (atts: DocsAttachment[]) => void; onClose: () => void }): ReactNode

  // ── 汇出／汇入 ──
  downloadEditorPdf?(req: { title: string; html: string; paper: string | null | undefined; fileName: string; layers?: DocLayers }): Promise<boolean>
  /** 服务端 Word（失败丢错 ⇒ 页面退回浏览器那条）。 */
  exportWordServer?(docId: string, paper: DocPaperPref | null): Promise<Blob>
  exportDocAsWord(opts: { content: string; title: string; paper?: DocPaperPref | null; docId?: string }): Promise<void>
  exportDocAsMarkdown(opts: { content: string; title: string }): void
  importWord?(file: File, opts: { nearDocId: string; lang: string; source: 'doc_page' }): Promise<{ ok: true; id: string } | { ok: false; message: string }>
  printPage(win: Window): unknown

  // ── 分享／上架 ──
  loadDocVisibility?(docId: string): Promise<ShareVisibility>
  renderShareModal?(props: {
    open: boolean; onClose: () => void; title: string; shareUrl: string
    loadVisibility: () => Promise<ShareVisibility>; onChange: (v: ShareVisibility) => Promise<void>
    enableUnlisted?: boolean; linkOnly?: boolean
    profilePublish?: { initial: ProfilePublishState; onChange: (next: ProfilePublishState) => Promise<void> }
    ogWarmupDocId?: string
  }): ReactNode
  /** 这个使用者能不能上架（登入版问服务端）。 */
  useMeRoles(email: string | null): { isSeller: boolean }
  renderListingModal?(props: { open: boolean; onClose: () => void; docTitle: string; docId: string; paywallBlockIndex: number }): ReactNode
  renderPaywallLine?(props: { positionPx: number; onChange: (px: number) => void; scrollContainerRef: RefObject<HTMLDivElement | null> }): ReactNode

  // ── 角色／遮罩／自动出现 ──
  postEditorAgent?(body: { kind: 'doc'; id: string; editor_agent_key: string | null }): Promise<HostResponse>
  useEditorRoleBusy(o: { editorAgentKey: string | null; enabled: boolean }): { busy: boolean; roster: unknown }
  useEditorAIShield(o: { kind: 'doc'; id: string; enabled: boolean; onRelease: () => Promise<void>; containerRef: RefObject<HTMLDivElement | null>; hold: boolean }): DocsAIShield
  renderAIShield?(shield: DocsAIShield, testId: string): ReactNode
  renderAIShieldPill?(shield: DocsAIShield, testId: string): ReactNode
  docLive?: DocsLiveKit

  // ── 回滚历史（撤销／重做） ──
  historyVersions?(docId: string): Promise<HostResponse>
  historyRollback?(docId: string, versionId: string): Promise<HostResponse>

  // ── 画面 ──
  renderLoadFail(fail: DocsLoadFail, docId: string): ReactNode
  renderReadOnly?(props: { docId: string; title: string; content: string; paperSettings: DocPaperSettings; layers: DocLayers | null }): ReactNode

  // ── 游客版外框要知道的（登入版不给） ──
  /** 有改动（还没存）。 */
  onEdited?(): void
  /** 这一发存好了、存的正是画面上这一份。 */
  onSaved?(): void
  onSaveStatus?(s: 'idle' | 'saving' | 'saved' | 'error'): void
  registerFlush?(flush: (() => Promise<void>) | null): void
}
