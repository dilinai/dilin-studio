// Dilin Studio 共用介面（游客编辑器底座）。
//
// 每个编辑器只交一个模块：<app>/index.ts，default export 一个 StudioApp：
//
//   import type { StudioApp } from '../shared/types'
//   const app: StudioApp<MyDoc> = { app: 'sheets', Editor: SheetsEditor, format: sheetsFormat, i18n: SHEETS_I18N }
//   export default app
//
// 然后在 shared/registry.ts 把对应那一行的占位换成 `() => import('../sheets').then(m => m.default)`。
//
// 边界（开源可拆）：<app>/ 只准 import 自己目录、shared/、npm 套件。
//   网站相关的东西（地区、语言默认、注册页网址、GitHub 网址）只经 shared/host.ts 进来。
//
// ── 一次打开的流程（StudioShell 负责）───────────────────────────────────────────
//   1. Shell 从 IndexedDB 找到这个编号的工程纪录，开出 ProjectStore（资料夹或 OPFS）。
//   2. Shell 在 <StudioTProvider> 里渲染 <Editor store projectId lang revision ...>。
//   3. Editor 自己 `format.load(store)` 取文件、编辑、自己决定何时 `format.save(store, doc)`（建议改动后 0.5–1 秒防抖自动存）。
//      存档前后用 onSaveStateChange 报状态（顶栏显示「已存／未存／存档中／存档失败」），有未存改动用 onDirtyChange(true) 报。
//      自动存一律走 shared/store.ts 的 saveProjectSafe(store, s => format.save(s, doc))：外面改过 project.json ⇒ 不写、回
//      { written: false, reason: 'changed-outside' }（Shell 会问使用者）；明确存档／flush 用 { force: true } 或直接 format.save。
//   4. Shell 每 1.5 秒看 project.json 的修改时间（store.watch）。被外面（用户自己的 AI）改了：
//      - 没有未存改动 ⇒ revision + 1；
//      - 有未存改动 ⇒ 先在顶栏问用户「重新载入（丢掉未存的改动）」或「先不要」。
//      revision 变了：softReload=false（缺省）⇒ Shell 用 key 整个重挂 Editor；softReload=true ⇒ 只换 revision 这个 prop，Editor 自己重读。
//   5. 汇出 zip／换资料夹之前，Shell 会先叫 Editor 用 registerFlush 登记的函式把手上的改动存下去。
//      有 exportOptions ⇒ 先弹勾选小窗、使用者按「汇出」才 flush；有 buildExport ⇒ 用它回的 payload 打 zip。
//
// ── 字串 ────────────────────────────────────────────────────────────────────────────
//   Editor 里一律用 `const t = useStudioT()`（shared/StudioT.tsx），t(key, vars?) ⇒ 字串；{name} 形的占位用 vars 填。
//   游客版：Shell 用 shared/i18n.ts 的 makeStudioT 把「底座字典＋本编辑器 i18n」喂进 StudioTProvider。
//   登入版：页面用 siteTAdapter（shared/StudioT.tsx）把网站 LanguageContext 的 t 接进同一个 StudioTProvider，
//     网站字典里没有的键退回本编辑器 i18n 字典（所以编辑器字典要三语齐全）。⛔ 编辑器自己 import 网站的 LanguageContext。

import type { ComponentType } from 'react'

/** 五个编辑器的代号（也是网址段 /studio/<app>、zip 档名 .dilin-<app>.zip、project.json 的 format 后半）。 */
export type StudioAppId = 'docs' | 'sheets' | 'slides' | 'video' | 'paint'
export const STUDIO_APP_IDS: readonly StudioAppId[] = ['docs', 'sheets', 'slides', 'video', 'paint']
export function isStudioAppId(x: unknown): x is StudioAppId {
  return typeof x === 'string' && (STUDIO_APP_IDS as readonly string[]).includes(x)
}

/** 三种界面语言（与网站同一组代码）。 */
export type StudioLang = 'zh-TW' | 'zh-CN' | 'en'
export const STUDIO_LANGS: readonly StudioLang[] = ['zh-TW', 'zh-CN', 'en']

/** 字典：每种语言一张 键→字串 的表。键名建议带编辑器前缀（如 sheets_add_row），免得跟底座或别的编辑器撞。 */
export type StudioDict<K extends string = string> = Record<StudioLang, Record<K, string>>
/** 取字函数：没有这个键 ⇒ 回键名本身（画面上看得出漏字）。vars 填 {name} 形占位。 */
export type StudioT = (key: string, vars?: Record<string, string | number>) => string

// ── 储存层 ──────────────────────────────────────────────────────────────────────────

/** folder＝用户挑的本机资料夹（File System Access·Chrome／Edge）；opfs＝浏览器内部储存（Safari／Firefox 或用户选「先存在浏览器里」）。 */
export type StorageBackend = 'folder' | 'opfs'

export interface AssetInfo {
  /** assets/ 底下的档名（不含 assets/ 前缀，不含斜线）。 */
  name: string
  size: number
  /** 毫秒时间戳。 */
  lastModified: number
  /** MIME（浏览器猜的，可能是空字串）。 */
  type: string
}

export interface ExternalChange {
  /** project.json 现在的修改时间（毫秒）。 */
  lastModified: number
}

export interface ReadJSONOptions {
  /**
   * true ⇒ 只看一眼：不当作「这个会话读过这一版」（安全写的比对基准不动）。
   * 外框／汇出这类旁路读用；编辑器载入工程（format.load）别加——载入那一版就是之后自动存的基准。
   */
  peek?: boolean
}

/** 安全写的结果。written=false 时 project.json 没动：外面（用户自己的 AI）在本会话上次读写之后改过它。 */
export type SafeWriteResult =
  | { written: true }
  | { written: false; reason: 'changed-outside'; /** project.json 现在的修改时间（毫秒）。 */ lastModified: number }

/**
 * 一个工程的储存（资料夹与 OPFS 两种后端同一组函式）。结构固定：
 *   <工程根>/project.json
 *   <工程根>/assets/<档名>
 * 素材档名限制：不可含 / \ ，不可是 . 或 ..，长度 1–200；违反会丢 Error（code: 'bad_asset_name'）。
 * 所有函式在资料夹授权掉了时丢 Error（code: 'permission'），Shell 会接住并请用户重新授权。
 */
export interface ProjectStore {
  readonly backend: StorageBackend
  /** 给人看的位置：folder ⇒ 资料夹名；opfs ⇒ 空字串（画面另写「存在这个浏览器里」）。 */
  readonly label: string
  /**
   * 读 project.json；不存在 ⇒ null；不是合法 JSON ⇒ 丢 Error（code: 'bad_json'）。
   * 读到的那一版（修改时间＋内容）记成本会话的基准，安全写拿它比对；opts.peek ⇒ 不记。
   */
  readJSON<T = unknown>(opts?: ReadJSONOptions): Promise<T | null>
  /** 写 project.json（缩排 2 格、结尾换行，方便 AI 与人读改）。照写不比对（＝明确存档）；写完记成基准。自己写的不会触发 watch。 */
  writeJSON(value: unknown): Promise<void>
  /**
   * 安全写（给自动存用）：写前比对 project.json 的修改时间与本会话上次读／写时记下的——
   *   一样（或只差修改时间、内容一字不差）⇒ 照写，回 { written: true }；
   *   不一样（外面改过；或这个会话还没读写过、档却已经在）⇒ 不写，回 { written: false, reason: 'changed-outside' }，
   *     并立刻通知 watch 的回调（若 watch 还没报过这一版），外框就走「外面改过」那条问使用者；
   *   project.json 不存在 ⇒ 照写（新工程）。
   * opts.force ⇒ 不比对、照写（明确存档：选单「存档」、Ctrl+S、外框 flush）。
   * 注：比对与写之间仍有极短空档，外面恰好在那一瞬写进来的改动会被盖掉（浏览器没有档案锁）。
   */
  writeJSONSafe(value: unknown, opts?: { force?: boolean }): Promise<SafeWriteResult>
  /** 只比对不写：外面改过 ⇒ true（同 writeJSONSafe 会通知 watch）。saveProjectSafe 先用它挡，免得素材先写了 project.json 才被拒。 */
  changedOutside(): Promise<boolean>
  /** project.json 的修改时间（毫秒）；不存在 ⇒ null。 */
  lastModified(): Promise<number | null>
  readAsset(name: string): Promise<Blob | null>
  writeAsset(name: string, data: Blob | ArrayBuffer | Uint8Array | string): Promise<void>
  listAssets(): Promise<AssetInfo[]>
  /** 不存在也不报错。 */
  deleteAsset(name: string): Promise<void>
  /** 工程根目录写一份附加档（文字或图·例：给别家软件开的工程档、画板的预览图·整档覆盖）；⛔ project.json 与 assets/。没有这支 ⇒ 这种存放写不了。 */
  writeExtra?(name: string, data: string | Blob): Promise<void>
  /**
   * 每 intervalMs（缺省 1500）看一次 project.json 的修改时间，被外面改了就回调；
   * 自己 writeJSON 写的不触发（连修改时间变了但内容跟自己刚写的一字不差也不触发）。回传停止函式。
   */
  watch(onExternalChange: (c: ExternalChange) => void, intervalMs?: number): () => void
}

// ── 工程档格式 ──────────────────────────────────────────────────────────────────────

/** project.json 顶层必备的两栏（其余栏位归各编辑器）。name 可选：有的话 Shell 拿来当工程名。 */
export interface ProjectHeader {
  format: `dilin-studio/${StudioAppId}`
  version: number
  name?: string
}

/**
 * 各编辑器的工程档读写。建议用 shared/project-file.ts 的 readProjectJson／writeProjectJson 包 header，
 * 它们会检查 format 与 version（不认得 ⇒ 丢 StudioError 'bad_format'／'too_new'），编辑器只管自己的栏位。
 */
export interface StudioFormat<Doc> {
  /** 现在写出去的版本号（整数，从 1 起）。读到比它大的版本 ⇒ 拒收（是新版网页存的）。 */
  version: number
  /** 新开工程的初始文件。 */
  emptyProject(): Doc
  /** 从 store 读成 Doc。project.json 不存在 ⇒ 回 emptyProject()。格式不对 ⇒ 丢 StudioError。 */
  load(store: ProjectStore): Promise<Doc>
  /** 把 Doc 写回 store（project.json，必要时连 assets）。 */
  save(store: ProjectStore, doc: Doc): Promise<void>
  /**
   * 给用户自己的 AI 看的格式重点（从 <app>/FORMAT.md 摘·短）。
   * 右栏「一键复制」会把它接在「这是什么编辑器、资料夹在哪」后面。用 lang 的语言写。
   * ⛔ 写境外服务名（陆站也会显示）。
   */
  summaryForAI(lang: StudioLang): string
}

// ── 编辑器元件 ──────────────────────────────────────────────────────────────────────

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

export interface EditorProps {
  store: ProjectStore
  /** 32 字元十六进位的工程编号（网址那段）。 */
  projectId: string
  lang: StudioLang
  /** 外部改档后递增（只有 softReload／outsideSoftReload=true 的编辑器需要看它；否则 Shell 直接重挂）。 */
  revision: number
  /** 有没有还没存的改动（Shell 拿来决定外部改档时要不要先问）。 */
  onDirtyChange(dirty: boolean): void
  /** 存档状态（顶栏显示）。detail＝失败原因（给人看的一句）。 */
  onSaveStateChange?(state: SaveState, detail?: string): void
  /** 登记「把手上改动立刻存下去」的函式；Shell 在汇出／换资料夹前呼叫。卸载时传 null。 */
  registerFlush?(flush: (() => Promise<void>) | null): void
  /** 编辑器自己的「关闭」（例：画板 檔案▸關閉）叫它：外框先 flush，再去这个编辑器最近的另一份工程，没有就回 /studio 总页。 */
  onClose?(): void | Promise<void>
}

/** 工程档的一份完整内容（汇出 zip／汇入都用这个形状）：project.json 解析后的物件＋assets/ 底下的档。 */
export interface ProjectPayload {
  json: Record<string, unknown>
  assets: { name: string; data: Blob }[]
  /** 放在 zip 根目录的附加档（例如给别家软件开的工程档·文字或 Blob〔分层 PSD〕）；汇入时不读 */
  extras?: { name: string; text: string | Blob }[]
}

/** 本机 MCP 交来的一件活（kind＋各编辑器自己的参数） */
export type StudioAgentJob = { kind?: unknown } & Record<string, unknown>
export type StudioAgentReply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }
export type StudioAgentOut<Doc> = { reply: StudioAgentReply; next?: Doc }

/** 汇出时给使用者勾的一个选项。label＝编辑器自己 i18n 字典里的键（Shell 用 t(label) 显示）。 */
export interface StudioExportOption {
  id: string
  label: string
}

export interface StudioExportContext {
  projectId: string
  /** 使用者勾了的选项 id（没给 exportOptions 或一个都没勾 ⇒ 空集合）。 */
  options: ReadonlySet<string>
}

export interface StudioApp<Doc = unknown> {
  app: StudioAppId
  Editor: ComponentType<EditorProps>
  format: StudioFormat<Doc>
  /** 本编辑器自己的三语字串（底座的字串不用重复）。 */
  i18n: StudioDict
  /** true ⇒ 外部改档时不重挂，Editor 看 revision 自己重读（保住捲动位置等）。缺省 false。 */
  softReload?: boolean
  /** true ⇒ 外部改档、手上又没有未存改动时只递增 revision（Editor 自己读回换上），不重挂；汇入工程、改名、单机 MCP 写回这类重载照旧重挂。
   *  softReload=true 时用不到。缺省 false。 */
  outsideSoftReload?: boolean
  /**
   * 汇出工程档前给使用者勾的选项（例：剪辑的「只打包时间轴用到的片段」）。
   * 有给 ⇒ 按「汇出工程档」先弹小窗列出来（缺省全不勾）＋「汇出」钮；没给 ⇒ 直接汇出。
   */
  exportOptions?: StudioExportOption[]
  /**
   * 自己决定 zip 里放什么（先 flush 才叫）：回一份 payload，Shell 用 shared/zip.ts 的 zipPayload 打包。
   * 没给 ⇒ Shell 把 store 里的 project.json＋全部 assets 原样打包（readAll → zipPayload）。
   * ⛔ 改 store 本身——这里只读、组一份新的内容。
   */
  buildExport?(store: ProjectStore, ctx: StudioExportContext): Promise<ProjectPayload>
  /**
   * 开源单机版右栏「存给别家软件」：先 flush 才叫，回几份文字档，外框用 store.writeExtra 写进工程资料夹根目录（素材就是旁边的 assets/）。
   * label＝编辑器自己 i18n 字典里的键（按钮字）；hint＝存好后接在提示后面的一句（键·可省）。没给 ⇒ 不出这颗。⛔ 改 store。
   */
  saveForOtherApps?: { label: string; hint?: string; build(store: ProjectStore): Promise<{ name: string; text: string | Blob }[]> }
  /**
   * 照登入版整页搬来的那一份（见 page-host.ts）。有给 ⇒ 游客工程页整页渲染它（不套 StudioShell 外框）；
   * 没给 ⇒ 照旧 StudioShell＋Editor。
   */
  guestPage?: import('./page-host').GuestPageComponent
  /**
   * 开源单机版本机 MCP（tools/agent-mcp.mjs）交到这个编辑器的活（read／edit／run…·各编辑器 agent-job.pure.ts）：
   * 在现在这份 doc 上算出回包与改后的 doc（next·没改就不给）。外框先 flush、安全写回、重载编辑页（session.ts agentJob）。
   * 没给 ⇒ 外框不接（画板、剪辑在自己整页里接）。
   */
  agentJob?(doc: Doc, job: StudioAgentJob): StudioAgentOut<Doc> | Promise<StudioAgentOut<Doc>>
  /**
   * 游客版宿主 has(功能键) 的功能表：键＝整页里用 host.has('…') 问的那些，值＝游客版有没有。
   * 没列的键一律当没有（false）——要后端的功能不用列；纯前端但整页用 has() 问的功能要列成 true。
   */
  guestFeatures?: Readonly<Record<string, boolean>>
}

/** 储存层／格式层丢的错误都带 code，Shell 按 code 取字显示。 */
export type StudioErrorCode =
  | 'permission'        // 资料夹授权掉了
  | 'bad_json'          // project.json 不是合法 JSON
  | 'bad_format'        // format 栏不是 dilin-studio/<这个编辑器>
  | 'too_new'           // version 比这版网页认得的新
  | 'bad_asset_name'
  | 'no_project_json'   // 汇入的 zip／资料夹里没有 project.json
  | 'unsupported'       // 这个浏览器没有需要的 API
  | 'zip_too_big'       // zip 解开后单档或合计超过上限（detail＝上限位元组数）
  | 'zip_too_many'      // zip 里的项目（含目录）太多（detail＝上限个数）
  | 'json_too_big'      // zip 里的 project.json 解开后超过上限（detail＝上限位元组数）

export class StudioError extends Error {
  readonly code: StudioErrorCode
  readonly detail?: string
  constructor(code: StudioErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'StudioError'
    this.code = code
    this.detail = detail
  }
}
export function isStudioError(e: unknown, code?: StudioErrorCode): e is StudioError {
  return e instanceof StudioError && (code === undefined || e.code === code)
}
