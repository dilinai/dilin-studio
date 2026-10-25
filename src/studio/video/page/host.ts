// 剪辑整页（VideoEditPage）的宿主接口：登入版（网站那边）与游客版（./guest.tsx）各给一份。
//   页面本身只有一份；凡是要网站后端的（工程档 API、云盘、上传、角色对话、终端、朗读、别台导出、收藏存帐号…）全经这里进来。
//   游客版：要后端的那几组给 null ／ has() 回 false ⇒ 页面不画那几颗钮；纯浏览器里跑的（识别字幕、AI 分轨、编曲、汇出成片）照留。
import type { ReactNode, RefObject } from 'react'
import type { ChatSlotOptions, DriveSlotOptions, StudioPageHost } from '../../shared/page-host'
import type { VeditProject } from '../lib/project.pure'
import type { Tracks } from '../lib/timeline.pure'
import type { RatioSel } from '../lib/ratio.pure'
import type { VeditSettings } from '../lib/upload.pure'
import type { AsrEnv } from '../lib/asr.pure'
import type { WebShotFailCode, WebShotOpts } from '../lib/web-shot.pure'
import type { VeditShellApi } from '../lib/shell-job'
import type { ExportDrive } from '../ui/ExportDialog'
import type { ExportEnv } from '../ui/export-render'

export type VeditMediaKind = 'video' | 'audio' | 'image'

/** 页面上一份素材给宿主看的那几栏 */
export type HostMedia = { id: string; name: string; kind: VeditMediaKind; url: string; duration: number; from: 'local' | 'drive'; driveId?: string; missing?: boolean }

/** 开不到网址那份工程是哪一种：login＝要先登入·bad_id＝编号不对·not_found＝找不到·failed＝其余 */
export type VeditLoadFail = 'login' | 'bad_id' | 'not_found' | 'failed'

/** 读回来的一份工程（登入版＝GET /api/vedit/project 的回包；游客版＝project.json 换成同一个形状） */
export type ProjGet = {
  id: string; title: string; folder_id: string | null; updated_at: string; deleted?: boolean; drops?: unknown
  project: VeditProject; media_urls: Record<string, string>
  /** 读不到所在资料夹 ⇒ 不签（云盘档编号 → 原因码） */ media_denied?: Record<string, string>
  /** 开档时要让使用者知道的一句（游客版：project.json 里读不懂的条目、找不到的素材） */ note?: string
}
export type ProjHead = { updated_at?: string; title?: string; deleted?: boolean; folder_id?: string | null }
export type ProjSaveReply = { updated_at?: string; code?: string; drops?: unknown }
/** 存档回的状态码照 HTTP：200＝存好·409＝版次对不上·413＝太大／空间不够·404＝档没了；412＝外面改过（游客版：交给外框问使用者·页面不重试） */
export type ProjStatus = number

export interface VideoProjectHost {
  /** 开页要开哪一份：登入版＝网址 ?id=（没有 ⇒ null＝一动手才建草稿）；游客版＝这份工程 */
  urlId(): string | null
  /** 编号格式对不对（不对 ⇒ 不去读·整页明说） */
  validId(id: string): boolean
  /** 开档：开不到 ⇒ 是哪一种 */
  open(id: string): Promise<{ ok: true; d: ProjGet } | { ok: false; fail: VeditLoadFail }>
  /** 重读最新那份（version＝读历史上的某一版） */
  get(id: string, version?: string): Promise<{ status: ProjStatus; d?: ProjGet }>
  /** 只问版本（每几秒一次·角色或别的分页改了就重读）；没有 ⇒ 不问 */
  head: ((id: string) => Promise<{ status: ProjStatus; h?: ProjHead }>) | null
  /** 存档：force＝明确存档（外框要汇出／换位置前的 flush） */
  save(id: string, body: { base_updated_at: string | null; project: VeditProject; card: { duration: number; cover: string | null }; title: string }, force?: boolean): Promise<{ status: ProjStatus; j: ProjSaveReply }>
  /** 一动手剪就建草稿（没开档时）；没有 ⇒ 不建 */
  create: ((o: { folder_id: string | null; name: string }) => Promise<{ status: number | null; j: { id?: string; title?: string; folder_id?: string; updated_at?: string; code?: string } }>) | null
  /** 改名（fileName＝带 .dvedit 的档名）：回服务端定下的档名 */
  rename(id: string, fileName: string): Promise<{ ok: boolean; status: number; j: { name?: string; updated_at?: string } }>
  /** 草稿建好 ⇒ 网址换成它（登入版 ?id=）；游客版不用 */
  setUrlId(id: string): void
  /** 「專案」弹窗选了一份 ⇒ 开它 */
  openOther(id: string): void
  /** 有没有还没存的改动（游客版报给外框：外面改档时要不要先问、离开前提醒）·登入版不用 */
  dirty(d: boolean): void
  /** 登记「马上存」（外框汇出／换存放位置前叫）；卸载时传 null */
  registerFlush(f: (() => Promise<void>) | null): void
  /** 游客版：外面改了工程档、手上没未存改动 ⇒ 叫 f（整页读回换上·不重挂）；回取消登记。登入版不给（靠 head 问版本） */
  onOutsideChange?: (f: () => void) => () => void
}

/** 素材原档存哪、快取键怎么算（登入版＝浏览器本机储存；游客版＝工程资料夹 assets/） */
export interface VideoMediaHost {
  /** 剪辑用小档、波形、缩图快取的键（按内容·同一份内容同一个键） */
  keyOf(m: { id: string; from: 'local' | 'drive'; driveId?: string }, projectId: string | null): string
  /** 原档存起来（游客版写进 assets/）；成了 ⇒ true */
  storeOriginal(m: { id: string; name: string; from: 'local' | 'drive'; driveId?: string }, blob: Blob, projectId: string | null): Promise<boolean>
  /** 读原档（没有 ⇒ null） */
  readOriginal(m: { id: string; from: 'local' | 'drive'; driveId?: string }, projectId: string | null): Promise<Blob | null>
  /** 素材拿掉了：gone＝这次拿掉的·keep＝还留着的（同一份内容还有人用 ⇒ 快取别删） */
  forget(gone: readonly HostMedia[], keep: readonly HostMedia[], projectId: string | null): void
  /** 没开工程档时，素材清单要不要记在这个浏览器（登入版：重新整理还在） */
  rememberList: boolean
}

/** 云盘里的一笔（进素材区用） */
export type DriveRef = { id: string; name: string; kind: VeditMediaKind | null; url: string | null }

/** 素材格／轨道收到的网站专属拖放（桌面「檔案管理」、对话框「產物」、云盘条目） */
export type SiteDrop =
  | { kind: 'desk'; fetch: () => Promise<{ files: File[]; /** 没取到的份数 */ failed: number }> }
  | { kind: 'artifact'; fetch: () => Promise<File> }
  | { kind: 'drive'; id: string }

export interface VideoDriveHost {
  /** 背景上传一份进云盘（回云盘档编号与长期网址）·失败抛（带 status／code／reason）·取消抛 AbortError */
  upload(file: File, folderId: string | null, onProgress: (done: number, total: number) => void): { done: Promise<{ id: string; url: string }>; cancel: () => void }
  /** 云盘档案行那条长期网址（读不到 ⇒ null） */
  rowUrl(id: string): Promise<string | null>
  /** 按编号查一笔（本人·没删）；不是影音图档 kind＝null */
  fileById(id: string): Promise<DriveRef | null>
  /** 拖着的是不是云盘条目（悬停期读得到的那几栏） */
  dragInfo(dt: DataTransfer | null | undefined): { id: string; kind: VeditMediaKind | null } | null
  /** 素材格收不收这次拖放（电脑档以外的网站来源） */
  accepts(dt: DataTransfer): boolean
  /** 读一次网站来源的拖放；没有 ⇒ null */
  readDrop(dt: DataTransfer): SiteDrop | null
  /** 素材区接住了 ⇒ 标记（别让同挂 document 的整页拖入再接一次） */
  markHandled(ev: Event): void
  /** 云盘树要重新读（上传、转好小档之后） */
  invalidate(): void
  /** 设定窗要用资料夹 ⇒ 先读一次 */
  ensureLoaded(): void
  /** 云盘那份原档下载进本机储存（key＝快取键·out.why：fetch＝取不到·space＝空间不够·write＝写入中断） */
  cacheOriginal(key: string, url: string, signal?: AbortSignal, out?: { why?: 'fetch' | 'space' | 'write' }): Promise<File | null>
  /** 终端转好、存云盘的剪辑用小档／波形／缩图下载进本机储存 */
  cacheCloudProxy(key: string, fileId: string): Promise<File | null>
  cacheCloudPeaks(key: string, fileId: string): Promise<boolean>
  cacheCloudThumbs(key: string, fileId: string): Promise<File | null>
}

/** 「雲端硬碟」那一格（登入版＝云盘树；游客版＝工程清单＋存放位置）多给的东西：登入版点影音图档要进素材 */
export type VideoDriveSlotOptions = DriveSlotOptions & {
  vedit?: {
    /** 现在播放器开着的那份素材的云盘档编号（树上标亮） */ currentDriveId: string | null
    /** 单击影音图档 ⇒ 进素材并选中 */ onMedia: (f: DriveRef) => void
  }
}

/** 角色对话那一格（登入版）要的现况：页面每次渲染都给最新的 */
export type VideoChatCtx = {
  tracks: Tracks; media: readonly HostMedia[]; ratio: RatioSel; fitAspect: number | null; playhead: number; playing: boolean; sel: readonly string[]
  proj: { id: string; title: string } | null
  /** 点对话里的小卡要做的事 */
  api: VeditCardApi
}
export type VeditCardApi = {
  tracks: () => Tracks
  media: () => readonly HostMedia[]
  /** 卡里那几段选起来、播放头跳过去（都没了 ⇒ 说一声） */ jumpToClips: (ids: readonly string[], firstAt: number | null) => void
  /** 播放头跳到标记·标记还在 ⇒ 选中它（回有没有） */ jumpToMarker: (at: number) => boolean
  notice: (text: string) => void
}
export type VideoChatSlotOptions = ChatSlotOptions & { vedit?: VideoChatCtx }

/** 往对话输入框插小卡（登入版） */
export interface VideoChatHost {
  clipsToken(tracks: Tracks, ids: readonly string[], nameOf: (mediaId: string) => string | undefined): string | null
  transToken(start: number, tr: string, length: number): string | null
  markerToken(at: number): string | null
  mediaToken(m: Pick<HostMedia, 'id' | 'name' | 'kind'>): string | null
  /** true＝插进去了；false＝输入框还没挂上（还没选角色）⇒ 先排着 */
  insert(token: string): boolean
  /** 本页刚建好的新档编号（之前选的角色记到它上） */
  adopt(fileId: string): void
}

/** 角色编辑遮罩（登入版：角色在改这份工程档 ⇒ 轨道区盖罩、改动挡掉） */
export type AiShieldHandle = { locked: boolean }
export type AiShieldOpts = { id: string | undefined; enabled: boolean; onRelease: () => Promise<void>; containerRef: RefObject<HTMLDivElement | null>; onLock: () => void }

export interface VideoTtsHost {
  /** 朗读面板（选中文字时人工页里那块） */
  renderPanel(text: string, host: { busy: boolean; msg: { ok: boolean; text: string } | null; onRun: (o: Record<string, unknown>) => void }): ReactNode
  /** 合成：成了回音档与长度、花了几点；失败回原因码 */
  speak(o: Record<string, unknown>, text: string): Promise<{ ok: true; blob: Blob; ms: number; cost: string; fileName: string } | { ok: false; code: 'unreadable' | 'credits' | 'blocked' | 'rate' | 'other' }>
}

/** 识别字幕「雲端識別」（登入版·阿里国际站 3.1·每人每天免费 2 小时·超过扣积分）；游客版 null */
/** 「網頁截圖」（登入版·服务器无头浏览器截长图·不耗用点数）：成了回图片档（已带档名）与是否截断；失败回原因码（web-shot.pure WebShotFailCode）；游客版 null */
export interface VideoWebShotHost {
  shot(o: WebShotOpts, signal: AbortSignal): Promise<{ ok: true; file: File; truncated: boolean } | { ok: false; code: WebShotFailCode }>
}
export type CloudAsrCue = { start: number; end: number; text: string }
export interface VideoCloudAsrHost {
  /** 今天还剩几秒免费（站别时区 0 点重置）；这站没开 ⇒ available:false */
  quota(): Promise<{ available: true; left: number; daily: number } | { available: false }>
  /** 估价：这次几秒、今天剩几秒免费 ⇒ 免费几秒、超出几秒、要扣几积分（整次算一次·四舍五入后 0 算 1） */
  estimate(sec: number, left: number): { freeSec: number; overSec: number; credits: number }
  /** 开一次识别（预扣超出那段·expect＝给人看过的价·服务器算出来更高 ⇒ price） */
  start(sec: number, expect: number): Promise<{ ok: true; job: string; credits: number; left: number } | { ok: false; code: 'credits' | 'price' | 'unavailable' | 'other'; credits?: number; left?: number }>
  /** 送一段 16kHz 单声道 WAV（≤2 分钟）⇒ 句子（秒·相对这段开头·原文简体） */
  segment(job: string, wav: Blob, lang: 'zh' | 'en'): Promise<{ ok: true; cues: CloudAsrCue[] } | { ok: false; code: 'closed' | 'rate' | 'other' }>
  /** 结算（取消也叫）：回最后扣了几积分、退了几积分、今天还剩几秒 */
  finish(job: string, cancelled: boolean): Promise<{ credits: number; refunded: number; left: number | null } | null>
  /** 一段几秒 */
  segSec: number
}

export interface VideoOffloadHost {
  /** 在线的别台（右键选单一开就问一次） */
  devices(): Promise<Array<{ deviceId: string; label: string }>>
  /** 交给那台合（存进素材上传夹）·回云盘档编号 */
  render(o: { drive: ExportDrive; device: string; part: unknown; signal: AbortSignal; onProgress: (p: number) => void }): Promise<{ fileId: string }>
  /** 失败原因码（cancelled／unsaved／server_old／ignored／failed） */
  errorCode(e: unknown): string
}

export interface VideoPageHost extends StudioPageHost {
  renderDriveSlot(opts?: VideoDriveSlotOptions): ReactNode
  renderChatSlot(opts?: VideoChatSlotOptions): ReactNode
  /** 「雲端硬碟」旁的眼睛钮（只列影音图／全列）；没有 ⇒ 不画 */
  renderDriveEye: (() => ReactNode) | null
  /** 宿主自己画的弹窗（预览窗、小卡弹窗）开着没：开着时剪辑快捷键让开 */
  overlayOpen(): boolean
  /** 「回首頁」去哪 */
  homeHref: string
  /** 开放闸（登入版白名单／登入）；游客版直接过 */
  checkGate(): Promise<boolean>
  renderGateClosed(): ReactNode
  /** 网址那份开不到 ⇒ 整页说明 */
  renderLoadFail(fail: VeditLoadFail, id: string | null): ReactNode
  project: VideoProjectHost
  media: VideoMediaHost
  drive: VideoDriveHost | null
  shell: VeditShellApi | null
  /** 识别字幕／拆曲的浏览器模型从哪下 */
  asr: AsrEnv
  /** 识别字幕「雲端識別」（游客版 null） */
  cloudAsr: VideoCloudAsrHost | null
  /** 编曲音色授权全文网址（没有 ⇒ 只写授权名） */
  arrangeCreditUrl?: string
  /** 收藏（贴纸、滤镜、特效、转场的星星）：登入版存帐号偏好；游客版存这个浏览器 */
  favs: { load(keys: readonly string[]): Promise<Record<string, unknown> | null>; save(key: string, ids: readonly string[]): Promise<void> }
  tts: VideoTtsHost | null
  webShot: VideoWebShotHost | null
  chat: VideoChatHost | null
  /** 编辑遮罩（hook：页面每次渲染都叫） */
  useAiShield(o: AiShieldOpts): AiShieldHandle
  renderAiShieldPill(s: AiShieldHandle): ReactNode
  renderAiShield(s: AiShieldHandle): ReactNode
  /** 角色看一帧（登入版：接中继·回停止函式）；没有 ⇒ null。onPrimary＝同一份开在别的分页、那页是主分页 ⇒ false（页面挂提示）·宿主不给就不挂 */
  startRelay: ((o: { projectId: () => string | null; loading: () => boolean; env: () => ExportEnv; ratio: () => number | null; playhead: () => number; project: () => { id: string; title: string } | null; mediaInfo: (id: string) => { name: string; kind: VeditMediaKind } | null; onPrimary?: (primary: boolean) => void }) => () => void) | null
  offload: VideoOffloadHost | null
  /** 汇出弹窗的存雲盤／别台导出（游客版 null） */
  exportDrive(o: { folder: () => Promise<string | null>; saveProject: () => Promise<string | null> }): ExportDrive | null
  renderProjectsDialog: ((o: { currentId: string | null; onOpen: (id: string) => void; onClose: () => void }) => ReactNode) | null
  renderHistoryDialog: ((o: { projectId: string; onRestore: (vid: string) => Promise<boolean>; onClose: () => void }) => ReactNode) | null
  /** 设定窗：登入版有资料夹与自动调配算力那几项；游客版只有快捷键 */
  renderSettingsDialog(o: { value: VeditSettings; onChange: (v: VeditSettings) => void; onClose: () => void }): ReactNode
}

/** 功能键（has()）：页面用到的几颗 */
export const VEDIT_FEATURES = {
  /** 素材卡「存到雲端硬碟」、背景上传、上传进度窗 */ drive: 'vedit.drive',
  /** 顶栏「專案」（最近的草稿） */ projects: 'vedit.projects',
  /** 顶栏「歷史版本」 */ history: 'vedit.history',
  /** 「雲端硬碟」旁的眼睛钮（只列影音图／全列） */ driveAll: 'vedit.drive-all',
  /** 顶栏「第三方授權」小窗 */ licenses: 'vedit.licenses',
} as const
