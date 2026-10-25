// 编辑器页「壳层」共用样式 token
//
// 来源＝网站云文档页壳层现有 class，一字不改抽到这里；
// 云文档页与网站生成页（`my-site/page.tsx`）两页共用。⛔ 这里不写新的十六进制——每条都是云文档页原有的 class 串
//（`hp-lavender` 定义在网站全站样式（开源包里是 `src/shell/site.css`）；`bg-[#111827] text-[#FFFFFF]` 是云文档页类型切换钮原有的两个 class）。
// 右栏对话框组件（assistant-panel/AssistantPanel.tsx）有它自己的一套 token·不在这里——只有它的根底引这里的 `beigeSurface`（三页右栏与壳层同一米色）。
//
// 深浅态：全站 `<html className="theme-light">` 固定（ThemeContext 只留 light·setTheme 为 no-op），
// 云文档页没有第二态；两页共用同一组 class ⇒ 有几态就一起有几态。

import { palette } from './color-palette'

export const editorShell = {
  /** 整页底＝淡粉紫渐变铺底（云文档页 root） */
  root: 'hp-lavender text-gray-900',
  /** 壳层暖米面＝首页侧栏同一 token `palette.warm.bg`·
   *  以 inline style 引 token（不写十六进制）；挂在顶栏 header／左栏列／右栏列上·右栏对话框根底也引同一 token（assistant-panel 两根） */
  beigeSurface: { backgroundColor: palette.warm.bg } as const,
  /** 右栏对话框整栏（四页签正文＋底部输入框区）＝首页右侧流式面板那档浅米 `palette.warm.panel`·
   *  挂在右栏列与 assistant-panel 两根上；对话块里首页那层 hp-aurora 光晕在右栏内不铺（globals.css 按 side-chat-panel 关掉）⇒ 整栏一色 */
  chatSurface: { backgroundColor: palette.warm.panel } as const,
  /** 整页字体（云文档页 root 的 inline style） */
  rootFont: { fontFamily: 'var(--cjk-font)' } as const,
  /** 整页载入中（云文档页「載入中」屏） */
  loadingScreen: 'min-h-screen hp-lavender flex items-center justify-center text-sm text-gray-400',

  /** 顶栏 */
  headerBar: 'border-b border-black/5',
  /** 顶栏「返回／雲端硬碟」文字钮 */
  headerLink: 'text-gray-400 hover:text-gray-700 hover:bg-black/5 rounded-md px-1.5 py-1 -my-1 transition-colors duration-150 flex items-center gap-1 text-xs shrink-0',
  /** 顶栏竖分隔线 */
  headerDivider: 'w-px h-4 bg-gray-200 shrink-0',
  /** 顶栏标题输入框 */
  titleInput: 'text-sm font-medium text-gray-800 bg-transparent outline-none min-w-0 border-b border-transparent focus:border-gray-200 pb-0.5',
  /** 顶栏文字钮（匯出 Word／PDF／Markdown） */
  headerTextBtn: 'text-xs text-gray-400 hover:text-gray-700 transition-colors',
  /** 顶栏有框动作钮（表格页「匯出／匯入／列印」·图示＋字）：只用灰阶与黑白透明度·不写十六进制 */
  headerActionBtn: 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-black/10 bg-white/70 text-xs text-gray-700 shadow-sm whitespace-nowrap hover:bg-white hover:border-black/20 hover:text-gray-900 transition-colors disabled:opacity-60',
  /** 顶栏动作钮里的淡字（副标·如 xlsx／csv） */
  headerActionHint: 'text-[10px] text-gray-400',
  /** 顶栏链接钮（分享） */
  headerLinkBtn: 'text-xs text-blue-500 hover:text-blue-700 transition-colors',

  /** 侧栏（左／右）列：本身不带底色·透出整页铺底；相邻处由拖宽把手供分隔线 */
  sideCol: 'shrink-0 flex flex-col relative',
  /** 侧栏顶部页签 */
  sideTabActive: 'text-blue-600 border-b-2 border-blue-500 bg-white',
  sideTabIdle: 'text-gray-400 hover:text-gray-600',

  /** 中央列（编辑区／预览区）＝白底盖白·两侧渐变透出 */
  centerCol: 'bg-white',
  /** 中央列工具栏 */
  toolbarBar: 'border-b border-black/5 bg-white',
  /** 工具栏图标钮 */
  toolbarBtn: 'px-2 py-0.5 text-sm rounded-md hover:bg-gray-100 text-gray-600 flex items-center gap-1',
  /** 工具栏文字钮（窄屏匯出下拉触发钮） */
  toolbarTextBtn: 'px-2 py-0.5 text-xs rounded hover:bg-gray-100 text-gray-500 flex items-center gap-1',
  /** 切换钮（云文档页类型／模型切换钮） */
  chipActive: 'bg-[#111827] text-[#FFFFFF]',
  chipIdle: 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',

  /** 拖宽把手（列与列之间的分隔线也由它供） */
  resizeHandle: 'group relative w-2 shrink-0 cursor-col-resize touch-none border-x border-black/5',
  resizeHandleLine: 'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/5 transition-colors group-hover:bg-violet-300',
  resizeHandleGrip: 'absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-300 opacity-0 transition-opacity group-hover:opacity-100',
  /** 没有拖宽把手时列的分隔线（同一条 border-black/5） */
  colBorderL: 'border-l border-black/5',
  colBorderR: 'border-r border-black/5',
  /** 左右栏收合钮：
   *  正方形小块·灰字悬停深（同 headerLink 那组 hover）；收起态边缘窄条＝24px·顶上放同一颗钮 */
  collapseBtn: 'w-6 h-6 shrink-0 self-center mx-1 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-black/5 transition-colors',
  collapsedEdge: 'shrink-0 flex flex-col items-center pt-1.5 w-6',

  /** 云盘树 */
  driveHeaderText: 'text-xs text-gray-400 font-medium',
  driveRefreshBtn: 'p-1 text-gray-400 hover:text-gray-600 rounded transition-colors',
  driveSpinner: 'w-4 h-4 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin',
  driveFolderRow: 'w-full flex items-center gap-1.5 pr-2 py-1.5 rounded text-sm text-gray-500 hover:bg-blue-50 transition-colors',
  driveFileRowBase: 'flex-1 min-w-0 flex items-center gap-1.5 pr-7 py-1.5 rounded text-sm transition-colors',
  driveFileRowCurrent: 'text-blue-600 bg-blue-50 font-medium',
  driveFileRowIdle: 'text-gray-500 hover:bg-blue-50',
  driveMoreBtn: 'absolute right-1 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-opacity',
  driveMenu: 'absolute right-1 z-20 min-w-[96px] rounded-md border border-gray-200 bg-white py-1 shadow-lg',
  driveMenuItem: 'w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors',
  driveLoadMoreIdle: 'text-gray-500 hover:bg-blue-50 hover:text-blue-600',
  driveLoadMoreError: 'text-red-500 hover:bg-red-50',

  /** 灰雾（上架编辑态覆盖侧栏／工具栏） */
  dimMask: 'absolute inset-0 bg-gray-500/25 z-40 pointer-events-auto select-none',
  /** 弹层遮罩与弹层卡 */
  modalMask: 'absolute inset-0 bg-black/30',
  modalCard: 'relative bg-white rounded-2xl shadow-2xl',

  /** 空态／提示字 */
  mutedText: 'text-gray-400',
  hintText: 'text-gray-500',

  /** 以下四条供简报页用（同样只取云文档页现有 class）：
   *  浮层菜单＝云盘树三点菜单同款（去掉定位 class）；弹层遮罩色＝云文档页弹层遮罩 `bg-black/30`；
   *  半透明盖罩色＝上架灰雾 `bg-gray-500/25`；浅面（列表行／卡内输入底）＝云文档页秘匣卡 `bg-gray-50`·悬停 `hover:bg-gray-100`·描边 `border-gray-200` */
  menu: 'rounded-md border border-gray-200 bg-white py-1 shadow-lg',
  menuItem: 'w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors',
  modalMaskColor: 'bg-black/30',
  maskColor: 'bg-gray-500/25',
  softSurface: 'bg-gray-50',
  softSurfaceHover: 'hover:bg-gray-100',
  divider: 'border-gray-200',
} as const

export type EditorShellTokens = typeof editorShell

/** 云盘树那组 class 的暗底版（网页剪辑页素材区「雲端硬碟」页签用的那组·逐字照搬），给暗底编辑器（剪辑）的左栏工程清单用。 */
export const editorShellDarkDrive = {
  driveHeaderText: 'text-xs text-neutral-400 font-medium',
  driveRefreshBtn: 'p-1 text-neutral-500 hover:text-neutral-200 rounded transition-colors',
  driveSpinner: 'w-4 h-4 rounded-full border-2 border-neutral-600 border-t-cyan-400 animate-spin',
  driveFolderRow: 'w-full flex items-center gap-1.5 pr-2 py-1.5 rounded text-sm text-neutral-300 hover:bg-neutral-800 transition-colors',
  driveFileRowBase: 'flex-1 min-w-0 flex items-center gap-1.5 pr-7 py-1.5 rounded text-sm transition-colors',
  driveFileRowCurrent: 'text-cyan-400 bg-neutral-800 font-medium',
  driveFileRowIdle: 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
  driveMoreBtn: 'absolute right-1 w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700 transition-opacity',
  driveMenu: 'absolute right-1 z-20 min-w-[96px] rounded-md border border-neutral-700 bg-neutral-800 py-1 shadow-lg',
  driveMenuItem: 'w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-700 hover:text-cyan-400 transition-colors',
  driveLoadMoreIdle: 'text-neutral-400 hover:bg-neutral-800 hover:text-cyan-400',
} as const
