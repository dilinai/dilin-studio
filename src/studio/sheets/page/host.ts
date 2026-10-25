// 表格整页（./SheetPage.tsx）对宿主的要求：在 shared/page-host.ts 的 StudioPageHost 之上，加表格自己的资料操作与几处挂点。
//   登入版宿主（在网站那边）＝打网站的表格 API、云盘树、角色对话、AI 编辑保护遮罩、即时跟进；
//   游客版宿主（./guest.tsx）＝工程存在 ProjectStore 的 project.json（格式见 ../FORMAT.md），要后端的挂点给空的。
// 资料操作的回包照网站 API 的形状（ok／status／code＋内容），页面照同一套判断走（撞版 409、AI 编辑中、最后一张不能删…）。
// use 开头的几个是 React 钩子：每个宿主一律给同一支（游客版给空钩子），页面每次渲染照同样顺序呼叫。

import type { ComponentType, ReactNode, RefObject } from 'react'
import type { ChatSlotOptions, StudioPageHost } from '../../shared/page-host'
import type { SheetContent } from '../engine/formula'
import type { SheetTab } from '../engine/sheet-list'
import type { AgentContent } from '../engine/agent-ops'

export type SheetRow = SheetTab & { content?: SheetContent | null; updated_at?: string }
export type SheetDocRec = { title: string; readonly: boolean; editor_agent_key?: string | null; sheets: SheetRow[] }

/** 页签改名时公式跟着换过的那一张（新版次） */
export type SheetRewritten = { id: string; updated_at?: string | null }

/** 一次资料操作的结果（照网站 API：ok＋HTTP 状态＋错误码）。status 0＝没连上／没写成。 */
export type SheetHostResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code?: string }

/** 匯入建成的新表格档：href＝开启它的网址；warnings＝服务端读档时的提示（英文·页面只挑「图片没能匯入」那类给人看）。 */
export type SheetImportResult = { id: string; title: string; href: string; warnings?: string[] }

/** 登入检查：ok＝可以开；none＝没登入；error＝查不了（照没登入处理）。 */
export type SheetAuthState = 'ok' | 'none' | 'error'

/** AI 编辑保护遮罩的把手（页面只看 locked；其余交回宿主自己的元件画）。 */
export type SheetShieldHandle = { locked: boolean }
/** 罩落那一刻的补存窗（页面只用 onLock 与 isOpen）。 */
export type SheetShieldFlush = { onLock: () => void; isOpen: () => boolean }

export type SheetShieldOpts = {
  kind: 'sheet'
  id: string | null | undefined
  enabled?: boolean
  onRelease?: () => Promise<void> | void
  containerRef?: RefObject<HTMLElement | null>
  onLock?: () => void
  hold?: boolean
}

export type SheetBlockingAction = { href: string; label: string; variant?: 'secondary' }
export type SheetBlockingProps = {
  art?: 'sheet'
  title: string
  description?: string
  showSpinner?: boolean
  actions?: SheetBlockingAction[]
}

export type SheetRestoreBarProps = {
  testId: string
  onApply?: () => void
  onDiscard: () => void
  applyLabel?: string | null
  children?: ReactNode
}

/** 右栏对话格要的这份表格的情境（登入版接角色对话用；游客版不看）。 */
export type SheetChatContext = {
  docId: string
  docTitle: string
  activeSheet: { id: string; name: string } | null
  editorAgentKey: string | null
  onEditorAgentKeyChange: (key: string | null) => Promise<boolean>
  /** 页面级订的角色名册（useEditorRoleBusy 回的 roster）·原样递回 */
  rosterFrom?: unknown
  /** useSheetChatInline 回的 attach·原样递回 */
  attach?: unknown
}
export type SheetChatSlotOptions = ChatSlotOptions & { sheet: SheetChatContext }

export interface SheetsPageHost extends StudioPageHost {
  /** 这份表格的编号（登入版＝网址上的档编号；游客版＝工程编号）。 */
  docId: string

  // ── 资料 ──
  checkAuth(): Promise<SheetAuthState>
  /** 整份表格（标题＋各页签＋内容）；读不到 ⇒ null。fresh＝不用快取。 */
  getDoc(o?: { fresh?: boolean }): Promise<SheetDocRec | null>
  /** 改标题；baseTitle＝写之前看到的标题（被别人先改了 ⇒ 409）。 */
  putTitle(title: string, baseTitle?: string): Promise<SheetHostResult<{ title?: string } | null>>
  /** 末尾加一张；name 缺 ⇒ 预设名「prefixN」；content 给了就一起写进去。 */
  addSheet(b: { name?: string; prefix: string; content?: SheetContent }): Promise<SheetHostResult<{ sheet: SheetTab & { updated_at?: string }; sheets: SheetRow[] }>>
  /** 改名；rewritten＝公式里引用了旧名（跨表 表格2!A1）、宿主已一并换成新名的那几张页签（含这张自己）与它们的新版次。 */
  renameSheet(id: string, name: string): Promise<SheetHostResult<{ sheets: SheetTab[]; updated_at?: string | null; rewritten?: SheetRewritten[] }>>
  deleteSheet(id: string): Promise<SheetHostResult<{ sheets: SheetTab[] }>>
  /** 存一张页签的内容；baseUpdatedAt＝这份稿所基于的版次（库里已是更新的版 ⇒ 409 零写）。 */
  saveSheet(id: string, content: SheetContent, baseUpdatedAt?: string): Promise<SheetHostResult<{ updated_at?: string | null } | null>>
  /** 各页签（含内容与版次）；读不到 ⇒ null。 */
  listSheets(o?: { fresh?: boolean }): Promise<SheetRow[] | null>
  /** 有图的工作簿 ⇒ 产 xlsx（图要取档、合成）；below＝表格底下的图张数、skipped＝读不到的张数。失败就丢错。 */
  xlsxWithImages(sheets: { name: string; content: AgentContent }[]): Promise<{ blob: Blob; below: number; skipped: number }>
  /**
   * 顶栏「匯入 xlsx／csv」（has('xlsxImport') 才叫）：把选的档建成一份新的表格档、回新档的编号、标题、开启网址。
   *   登入版＝云盘里、这份表格同一个资料夹；游客版＝这个浏览器里的一份新工程（page/guest-import.ts）。
   *   失败照 API 回包：status＋code（err_xlsx_too_large／content_too_large／err_xlsx_not_spreadsheet／err_xlsx_bad_file／401…）。
   */
  importWorkbook?(file: File): Promise<SheetHostResult<SheetImportResult>>
  /** 换绑定的编辑角色；回新的 key（失败 ok:false）。 */
  setEditorAgent(key: string | null): Promise<{ ok: boolean; key: string | null }>
  /** 即时跟进（has('live') 才叫）：宿主管节拍与推送，到点叫 pullOnce；回停止函式。 */
  startLive(o: { docId: string; pullOnce: () => Promise<void>; aiLockedRef: { current: boolean } }): () => void

  // ── 跟外框的约定（游客版用：未存提示、外框要求立刻存）──
  /** 有没有还没存进去的改动。 */
  onUnsavedChange?(unsaved: boolean): void
  /** 登记「立刻把手上的改动存下去」；卸载时传 null。 */
  registerFlush?(flush: (() => Promise<boolean>) | null): void

  // ── 钩子（每个宿主固定给同一支）──
  useShieldFlush(opts: { run: () => Promise<boolean> | boolean; onFail: () => void }): SheetShieldFlush
  useEditorAIShield(opts: SheetShieldOpts): SheetShieldHandle
  useEditorRoleBusy(o: { editorAgentKey: string | null | undefined; enabled?: boolean }): { busy: boolean; roster: unknown }
  /** 选格子按 Alt+A 插进对话输入框；insert 不给 ⇒ 这个宿主没有可插的对话框（Alt+A 不拦）。 */
  useSheetChatInline(openTitle: string): { insert?: (text: string) => boolean; attach?: unknown }
  /** 存档口的写闸（罩着 ⇒ 只放补存窗里的失焦提交）。 */
  shieldWriteAllowed(a: { locked: boolean; flushOpen: boolean; commit?: boolean }): boolean

  // ── 元件 ──
  BlockingStatus: ComponentType<SheetBlockingProps>
  EditorLoadingScreen: ComponentType<{ kind: 'sheet'; label: string; className: string }>
  EditorAIShield: ComponentType<{ shield: SheetShieldHandle; testId?: string }>
  EditorAIShieldPill: ComponentType<{ shield: SheetShieldHandle; testId?: string }>
  EditorRestoreBar: ComponentType<SheetRestoreBarProps>

  renderChatSlot(opts?: SheetChatSlotOptions): ReactNode
  /** 整页最底下（弹窗之类·登入版的云盘预览窗）。 */
  renderPageExtras?(): ReactNode
}

/** 整页用 has() 问的功能键。游客版拿掉（has() 回 false）的：登入版顶栏「雲端硬碟」连结、即时跟进别人写的格；
 *  顶栏「匯入 xlsx／csv」（要 importWorkbook：登入版建云盘里的新表格档·游客版建这个浏览器里的新工程）与「匯出 csv」（纯前端）两版都开。 */
export const SHEET_FEATURES = {
  driveLink: 'sheet-drive-link',
  live: 'sheet-live',
  xlsxImport: 'xlsxImport',
  csvExport: 'csvExport',
} as const
