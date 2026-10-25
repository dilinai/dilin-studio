'use client'
// 最简表格编辑器
//   网格 26 列×100 行·行号列标·点格选中·双击／直接打字编辑·Tab／Enter／方向键移动·Delete 清格；
//   上方函数输入框：左边当前格名（A1）·右边显示／编辑该格原始内容（= 开头当公式）。
//   求值在 engine/formula.ts（自写小引擎）；内容形状 { cells: { A1: { v, f, s } }, merges, images, colWidths, rowHeights }·改动经 onChange 交页面防抖存库。
//   做法（选区／编辑态／公式栏分层）只参考 fortune-sheet（MIT）的结构·代码现写。
//   矩形选区（拖选／Shift）·格式 s 渲染·合并区 rowSpan/colSpan·
//   剪贴板（Ctrl+C/X/V＋钮·TSV 互通·同页内带公式与格式）·格式刷·数字格式只管显示·浮图（上传走 /api/upload/image·可拖动／缩放／删）。
//   工具栏钮在 SheetToolbar.tsx·经 ref.exec(cmd) 打进来·选区状态经 onSelectionState 回报。
//
//     ① 列头右边线／行号下边线拖改宽高（col-resize／row-resize·拖动时虚线预览·双击自适应·多选整列／整行拖一条同改全部·缩放下换算）；
//     ② 选区右下角填充柄（拖向四方·虚框预览·放手按序列推断填·Ctrl 反转·双击向下填到邻列连续有值末行·放手后「自动填充选项」小钮四种）；
//     ③ 框线：按边存线型颜色·画在网格上层（overlay·同一条边只画一次）·绘图边框／网格／擦除三种拖画模式；
//     每次改动带 label 交页面进撤销栈·Ctrl／⌘+Z 撤·Ctrl／⌘+Y 与 Ctrl／⌘+Shift+Z 重做（编辑框里交给浏览器撤输入框文字）；
//     编辑公式时点格／拖选 ⇒ 把 A1／A1:B3 插到光标处（再点别格换掉刚插的那段）·引用在网格上同色虚框·F4 切绝对引用；
//     输入时即时语法检查（函数栏下一行红字＋错段波浪底线）·Enter 遇语法错弹「公式有誤」（改正／照原樣存成文字）·
//       执行期错误格左上角绿三角＋悬停说明·循环引用提示条·函数名自动补全（SheetFormulaInput.tsx）。
//   货币符号按站别默认＋下拉可换·长日期随界面语言＋民國紀年·
//     公式语法错点别处／失焦也先问（guardLeave）·填充柄多格数字＝Excel 线性趋势（在 engine/fill.ts）。
//     几何（每列左右缘／每行上下缘）从屏上量（表格 CSS zoom 之后的真位置）·覆盖层（框线／填充柄／预览／引用框）都按它摆。
import { Fragment, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useSheetT, useSheetLanguage, useSheetHost } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { alertDialog, confirmDialog } from '../../shared/dialog-store'
import { DEFAULT_COLS, DEFAULT_ROWS, cellKey, computeSheet, formatValue, cellFromInput, inputFromCell, isFormulaError, isTypedKey, stripInvisible, parseRef, indexToCol, SheetBook, type SheetContent, type SheetCells, type CellData, type BookSheet, type EvaluatorOptions } from '../engine/formula'
import {
  type CellStyle, type Rect, type SheetImage, type ClipBlock,
  mergeStateFor, addMerge, removeMerges, coveredMap, expandRectToMerges, parseRange, rectKeys, rectContains,
  formatWithNumFmt, applyNumFmtAction, numFmtForKind, withCurrencySymbol, valueForInput, accountingParts, CURRENCY_SYMBOL, stepSize, INDENT_MAX,
  blockFromSelection, blockFromText, pasteBlock, applyStyleToRect, copyStyle,
} from '../engine/style'
import type { ToolbarCommand, SelectionState } from './SheetToolbar'
import { wheelIsHScroll, wheelHScrollPx } from '../engine/wheel-hscroll.pure' // Alt＋滚轮左右卷
import { ZOOM_DEFAULT, applyWheel, zoomFromPinch, touchDistance, clampZoom, type WheelZoomState } from '../engine/zoom'
import { fontStack } from '../../shared/fonts/catalog'
import { ensureFontsLoaded } from '../../shared/fonts/load'
import { applyFill, fillPlanFor, fillTypeFor, fillDefaults, isShrink, fillMerges, dblClickFillEnd, clearContents, fillUnion, FILL_TYPES, type FillPlan, type FillType } from '../engine/fill'
import { applyBorderEdges, edgesForKind, borderSegments, currentEdges, currentRegion, lineWidth, cssLineStyle, BORDER_DEFAULT_COLOR, type BorderPen, type BorderEdges, type BorderSegment } from '../engine/border'
import { colWidthOf, rowHeightOf, hasRowHeight, draggedSize, setColWidths, setRowHeights, resizeTargets, autofitWidth, hitIndex } from '../engine/layout'
import { canInsertRefAt, canCarryFormula, insertRef, rectRefText, toggleAbsoluteAt, refHighlights, checkFormula, issueWhileTyping, type FormulaIssue, type XrefAction, type XrefResume } from '../engine/formula-edit'
import type { HistoryLabel } from '../engine/history'
import { imageLayer, moveImageZ, canMoveImageZ, setImagePlane, putImageInCell } from '../engine/image-layers'
import type { SheetTKey as TKey } from '../i18n'
import SheetFormulaInput from './SheetFormulaInput'
import ChartLayer, { type ChartLayerHandle } from './ChartLayer'   // 图表
import { buildCondFormatter, condCellCss, applyCondChange, rulesTouching, CondInputError } from '../engine/cond-format'   // 条件格式
import type { CondUiAction } from './SheetCondFormatMenu'
import type { DrawMode } from './SheetBorderMenu'
// 冻结筛选验证（冻结窗格／表头筛选／下拉清单）：资料口径在 engine/sheet-view.ts·画法在 SheetFreezePanes／SheetFilterMenu／SheetValidationPanel
import { cloneElement, type ReactElement } from 'react'
import { filteredRows, filterRect, filterColumnValues, validationAt, validationOptions, checkListInput, putValidation, clearValidations, sanitizeFreeze, cellReaderFor, rectA1, type ViewContent, type FilterCriterion } from '../engine/sheet-view'
import { applyOps, OpError, type AgentContent } from '../engine/agent-ops'
import { gridEmitNext } from '../engine/grid-emit'
import SheetFilterMenu from './SheetFilterMenu'
import { ValidationPanel, ValidationPicker } from './SheetValidationPanel'
import { freezeBox, frozenStyle, fixFrozenGeo, FrozenOverlayPanes, type FreezeBox } from './SheetFreezePanes'

/** 每次改动交给页面的附注（撤销栈用）：label＝下拉显示的字·group＝同组连续改动并成一步（自动填充选项换套法） */
/** commit＝编辑框（格内／公式栏）的提交（writeCell）——罩落那一刻失焦提交的那一发要能过补存窗；其余动作都不带。 */
export type ChangeMeta = { label: HistoryLabel; group?: string; commit?: true }
export type SheetGridProps = {
  content: SheetContent
  readonly?: boolean
  /** AI 编辑保护遮罩：罩着＝只挡进入编辑／贴上／剪下／填充／格式；看、选、滚、缩照常；正在编辑的那格失焦仍能提交（罩落补存窗）。 */
  locked?: boolean
  onChange: (next: SheetContent, meta: ChangeMeta) => void
  /** 当前 sheet 名（函数栏右侧淡字·也是跨表引用里认自己的名） */
  sheetName?: string
  /** 整份文件各页签（名＋内容·含这张）：公式里的跨表引用（表格2!A1）照它算；任一张一改换一份 ⇒ 这张跟着重算 */
  book?: readonly BookSheet[]
  /** 网格缩放系数（0.5～2·1＝100%）·由页面持有（按档记）·缺省 1 */
  zoom?: number
  onZoomChange?: (next: number) => void
  /** 选区状态回报（工具栏按下态） */
  onSelectionState?: (st: SelectionState) => void
  /** 撤销／重做（快捷键）·historyLocked＝不许撤（AI 编辑罩着时） */
  onUndo?: () => void
  onRedo?: () => void
  historyLocked?: boolean
  /** 跨页签点格带入（Excel）：本张是别张那条公式借来点格的——公式栏显示它·点格／拖选 ⇒ onXref pick（插 表名!A1）·打字／Enter／Esc 也交给页面（engine/formula-edit xrefStep） */
  xref?: { text: string; caret: number; home: string } | null
  onXref?: (a: XrefAction) => void
  /** 从别张回到原表那一下：原格接着编（edit）／照 Enter 提交（commit）／不存（cancel）·做完叫 onResumed */
  resume?: XrefResume | null
  onResumed?: () => void
}
export type SheetGridHandle = {
  exec: (cmd: ToolbarCommand) => void
  /** （Alt+A @ 进对话框）：当前选区的 A1 字（单格 C5·一块 C5:C9） */
  selectionRange: () => string
  /** 正在编辑格子或公式栏 ⇒ true（Alt+A 不抢键） */
  isEditing: () => boolean
  /** 点对话框里的范围小卡 ⇒ 把那块选回来；认不出 ⇒ false */
  selectRange: (a1: string) => boolean
  /** 正在编公式且光标处能插引用（点分页要带着公式走·页签按下先别抢焦点） */
  canCarryFormula: () => boolean
  /** 把正在编的公式交出去（跨页签点格带入）：交了 ⇒ 这张的编辑框失焦不再提交（马上就卸下）；带不了 ⇒ null */
  carryFormula: () => { key: string; text: string; caret: number; live: { start: number; end: number } | null } | null
}

type Pos = { r: number; c: number }
const HEAD_W = 48, HEAD_H = 28
const IMAGE_MAX_W = 320
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
/** 公式错误格左上角小三角的颜色（univer FORMULA_ERROR_MARK tl #409f11·6px） */
const ERROR_MARK = '#409f11'
const ERR_TIP: Record<string, string> = { '#DIV/0!': 'sheet_err_div0', '#REF!': 'sheet_err_ref', '#NAME?': 'sheet_err_name', '#VALUE!': 'sheet_err_value', '#N/A': 'sheet_err_na', '#NUM!': 'sheet_err_num', '#CYCLE!': 'sheet_err_cycle', '#ERROR!': 'sheet_err_error' }

// Safari 专有的捏合事件（标准 lib.dom 没有）
type GestureEventLike = Event & { scale: number }
/** 屏上量出的几何（滚动容器内容坐标·已含 zoom）：每列左右缘／每行上下缘 */
type Geo = { colL: number[]; colR: number[]; rowT: number[]; rowB: number[] }

const normRect = (a: Pos, b: Pos): Rect => ({ r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) })
const clampPos = (p: Pos): Pos => ({ r: Math.max(0, Math.min(DEFAULT_ROWS - 1, p.r)), c: Math.max(0, Math.min(DEFAULT_COLS - 1, p.c)) })
const rangeText = (r: Rect) => (r.r0 === r.r1 && r.c0 === r.c1 ? cellKey(r.r0, r.c0) : `${cellKey(r.r0, r.c0)}:${cellKey(r.r1, r.c1)}`)
const sameArr = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.25)

let measureCtx: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (!measureCtx) return text.length * 7
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/** 一格的 inline 样式（格式只管显示·框线另画在覆盖层）·列印页（SheetPrintDialog）同调这一份 */
export function cellStyleCss(s: CellStyle | undefined, isNumber: boolean): CSSProperties {
  const css: CSSProperties = {}
  if (!s) { if (isNumber) css.textAlign = 'right'; return css }
  if (s.font) { const st = fontStack(s.font); if (st) css.fontFamily = st }   // 选字体：s.font＝catalog id ⇒ CSS 栈（不在表 ⇒ 不写）
  if (s.size) css.fontSize = `${Math.round(s.size * 4 / 3)}px`
  if (s.b) css.fontWeight = 700
  if (s.i) css.fontStyle = 'italic'
  const deco = [s.u ? 'underline' : '', s.s ? 'line-through' : ''].filter(Boolean).join(' ')
  if (deco) css.textDecoration = deco
  if (s.bg) css.backgroundColor = s.bg
  if (s.fg) css.color = s.fg
  css.textAlign = s.align ?? (isNumber ? 'right' : 'left')
  if (s.valign) css.verticalAlign = s.valign
  if (s.wrap) css.whiteSpace = 'pre-wrap'
  if (s.indent) css.paddingLeft = `${6 + s.indent * 12}px`
  return css
}

const SheetGrid = forwardRef<SheetGridHandle, SheetGridProps>(function SheetGrid({ content, readonly, locked, onChange, sheetName, book, onSelectionState, zoom = ZOOM_DEFAULT, onZoomChange, onUndo, onRedo, historyLocked, xref, onXref, resume, onResumed }, ref) {
  // AI 编辑保护遮罩：罩期挡「进入编辑／贴上／剪下／填充／格式」·⛔ 挡 writeCell／emit（罩落那刻正在编辑的格失焦要能提交·进补存窗）。读 ref：这些回调多为陈闭包
  const lockedRef = useRef(false)
  lockedRef.current = !!locked
  const t = useSheetT()
  // 长日期按界面语言切换（英文界面 ⇒ Sep 24, 2026·中文两种 ⇒ 2026年9月24日）
  const { language } = useSheetLanguage()
  const host = useSheetHost()
  const imgSrc = (url: string) => (host.imageSrc ? host.imageSrc(url) : url)
  const nfLang = language === 'en' ? 'en' : 'zh'
  const cells: SheetCells = useMemo(() => content?.cells ?? {}, [content])
  const merges = useMemo(() => content?.merges ?? [], [content])
  const images = useMemo(() => content?.images ?? [], [content])
  const charts = useMemo(() => content?.charts ?? [], [content])   // 图表
  const chartLayerRef = useRef<ChartLayerHandle | null>(null)
  const colWidths = content?.colWidths
  const rowHeights = content?.rowHeights
  const covered = useMemo(() => coveredMap(merges), [merges])
  const mergeRects = useMemo(() => merges.map(parseRange).filter((x): x is Rect => !!x), [merges])
  // 跨表：整份文件一个 SheetBook（各张求值器懒建·共用循环栈）·格值／条件格式／筛选／图表同一份
  const evalOpts = useMemo<EvaluatorOptions | undefined>(() => (book ? { book: new SheetBook(book), sheetName } : undefined), [book, sheetName])
  const values = useMemo(() => computeSheet(content, evalOpts), [content, evalOpts])
  const condFmt = useMemo(() => buildCondFormatter(content, { eval: evalOpts }), [content, evalOpts])   // 条件格式：值一改（content 换了）就重算
  // 冻结筛选验证：冻结行列数（夹在网格内）·筛选区（往下自动延）·被筛掉的行（不显示·资料不删）
  const view = content as ViewContent
  const freeze = useMemo(() => sanitizeFreeze(view?.freeze), [view?.freeze])
  const fr = Math.min(freeze?.rows ?? 0, DEFAULT_ROWS - 1), fc = Math.min(freeze?.cols ?? 0, DEFAULT_COLS - 1)
  const viewReader = useMemo(() => cellReaderFor(view, nfLang, evalOpts), [view, nfLang, evalOpts])
  const fRect = useMemo(() => filterRect(view), [view])
  const hiddenRows = useMemo(() => filteredRows(view, viewReader), [view, viewReader])
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 })          // 活动格（锚）
  const [selEnd, setSelEnd] = useState<Pos | null>(null)        // 拖选／Shift 的另一角
  const [editing, setEditing] = useState<{ pos: Pos; value: string } | null>(null)
  const [barValue, setBarValue] = useState('')
  const [barFocus, setBarFocus] = useState(false)
  const [brush, setBrush] = useState<{ style: CellStyle | undefined } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  //
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null)
  const [pen, setPen] = useState<BorderPen>({ style: 'thin' })
  const [refLive, setRefLive] = useState<{ start: number; end: number } | null>(null)
  const [fillPreview, setFillPreview] = useState<{ rect: Rect; shrink: boolean } | null>(null)
  const [fillOpts, setFillOpts] = useState<{ plan: FillPlan; type: FillType; seriesDisabled: boolean; before: { cells: SheetCells; merges: string[] }; after: SheetCells; group: string; menu: boolean } | null>(null)
  const [resizing, setResizing] = useState<{ axis: 'col' | 'row'; index: number; edge: number; delta: number; size: number } | null>(null)
  const [drawDrag, setDrawDrag] = useState<Rect | null>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  // 键盘焦点落在这只看不见的 input 上（不是 div）：中文输入法的组字不会在 div 上产生可打印的 keydown（key='Process'）⇒ 直接打中文进不了编辑态；
  //   input 收得到 compositionend／onChange ⇒ 组好的字整段带进格里编辑（组字期候选窗照常·格里先看不到·最简版先这样）
  const keyInputRef = useRef<HTMLInputElement>(null)
  const cellInputRef = useRef<HTMLInputElement>(null)
  const barInputRef = useRef<HTMLInputElement>(null)
  const draggingRef = useRef(false)
  const internalClipRef = useRef<ClipBlock | null>(null)   // 同页复制的块（带公式与格式）·贴回时以文字相同为凭
  const brushRef = useRef<{ style: CellStyle | undefined } | null>(null)
  brushRef.current = brush
  const geoRef = useRef<Geo | null>(null); geoRef.current = geo
  const commitGuard = useRef(false)   // 「公式有誤」对话框开着时·编辑框失焦别提交
  const skipBarBlurRef = useRef(false) // 函数栏 Enter 已提交 ⇒ 随后那次失焦别再写一遍
  const carriedRef = useRef(false)     // 公式已交给别张点格（跨页签带入）⇒ 编辑框失焦别提交（这张马上卸下）
  const resumeCommitRef = useRef(false) // 从别张回来要照 Enter 提交 ⇒ 编辑态铺好那拍提交

  // 活动格若落在合并区里被盖住的格 ⇒ 视为左上
  const activeKey = useMemo(() => { const k = cellKey(sel.r, sel.c); return covered.get(k) ?? k }, [sel, covered])
  const activePos = useMemo<Pos>(() => { const p = parseRef(activeKey)!; return { r: p.row, c: p.col } }, [activeKey])
  /** 当前矩形选区（把沾到的合并区整块包进来） */
  const rect = useMemo<Rect>(() => expandRectToMerges(normRect(sel, selEnd ?? sel), merges), [sel, selEnd, merges])
  const mergeState = useMemo(() => mergeStateFor(merges, rect), [merges, rect])
  const fullCols = rect.r0 === 0 && rect.r1 === DEFAULT_ROWS - 1
  const fullRows = rect.c0 === 0 && rect.c1 === DEFAULT_COLS - 1

  // ── 缩放：三种手势只缩网格·不缩浏览器整页──
  //   ① wheel 带 ctrlKey（Ctrl＋滚轮；Mac／Chromium 触控板两指捏合也是 ctrlKey=true 的 wheel）⇒ preventDefault＋按 deltaY 步进
  //   ② 屏幕触控两指（touchstart／touchmove 距离比）⇒ preventDefault＋连续缩；单指不拦（容器 touch-action: pan-x pan-y ⇒ 单指照常卷动·浏览器自己的捏合缩页被关掉）
  //   ③ Safari gesturestart／gesturechange（e.scale）⇒ preventDefault＋连续缩
  //   监听全挂原生 addEventListener { passive: false }（React 合成 onWheel 是 passive 的·preventDefault 无效）·只挂网格容器 ⇒ 容器外照浏览器默认
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const onZoomRef = useRef(onZoomChange); onZoomRef.current = onZoomChange
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const setZoom = (z: number) => { const v = clampZoom(z); if (v !== zoomRef.current) onZoomRef.current?.(v) }
    let wheelState: WheelZoomState = { zoom: zoomRef.current, acc: 0 }
    const onWheel = (e: WheelEvent) => {
      if (wheelIsHScroll(e)) {                     // Alt（Mac Option）＋滚轮 ⇒ 左右卷
        e.preventDefault()
        el.scrollLeft += wheelHScrollPx(e, el.clientWidth)
        return
      }
      if (!e.ctrlKey) return                       // 普通滚轮＝卷动·不拦
      e.preventDefault()                           // 拦下浏览器整页缩放
      if (wheelState.zoom !== zoomRef.current) wheelState = { zoom: zoomRef.current, acc: 0 }
      wheelState = applyWheel(wheelState, e.deltaY, e.deltaMode)
      setZoom(wheelState.zoom)
    }
    let pinch: { startDist: number; startZoom: number } | null = null
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { pinch = { startDist: touchDistance(e.touches[0], e.touches[1]), startZoom: zoomRef.current }; e.preventDefault() }
      else pinch = null
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      if (pinch.startDist <= 0) return
      setZoom(zoomFromPinch(pinch.startZoom, touchDistance(e.touches[0], e.touches[1]) / pinch.startDist))
    }
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null }
    let gestureStartZoom = zoomRef.current
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureStartZoom = zoomRef.current }
    const onGestureChange = (e: Event) => { e.preventDefault(); setZoom(zoomFromPinch(gestureStartZoom, (e as GestureEventLike).scale)) }
    const onGestureEnd = (e: Event) => { e.preventDefault() }
    const opt: AddEventListenerOptions = { passive: false }
    el.addEventListener('wheel', onWheel, opt)
    el.addEventListener('touchstart', onTouchStart, opt)
    el.addEventListener('touchmove', onTouchMove, opt)
    el.addEventListener('touchend', onTouchEnd, opt)
    el.addEventListener('touchcancel', onTouchEnd, opt)
    el.addEventListener('gesturestart', onGestureStart, opt)
    el.addEventListener('gesturechange', onGestureChange, opt)
    el.addEventListener('gestureend', onGestureEnd, opt)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [])
  // Ctrl+0（Mac ⌘0）归 100%：焦点在网格区（含格内编辑框）时拦下·别让浏览器把整页缩放归位
  const onZoomKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); e.stopPropagation(); onZoomRef.current?.(ZOOM_DEFAULT) }
  }

  // ── 正在编辑的公式（格内或函数栏）：引用高亮＋语法检查 ──
  const editText = editing ? editing.value : barFocus ? barValue : null
  const editTextRef = useRef(editText); editTextRef.current = editText
  const isFormulaEdit = !!editText && editText.startsWith('=')
  const highlights = useMemo(() => (editText && editText.startsWith('=') ? refHighlights(editText) : []), [editText])
  const issue: FormulaIssue | null = useMemo(() => (editText && editText.trim().startsWith('=') ? issueWhileTyping(editText) : null), [editText])
  const issueText = useCallback((i: FormulaIssue) => t(`sheet_fx_err_${i.code}` as 'sheet_fx_err_badChar').replace('{a}', i.a ?? ''), [t])
  const setEditText = useCallback((v: string) => {
    if (editing) setEditing(ed => (ed ? { ...ed, value: v } : ed)); else setBarValue(v)
  }, [editing])
  const activeInput = useCallback(() => (editing ? cellInputRef.current : barInputRef.current), [editing])
  const setCaretLater = useCallback((pos: number) => {
    requestAnimationFrame(() => { const el = editing ? cellInputRef.current : barInputRef.current; if (el) { el.focus(); el.setSelectionRange(pos, pos) } })
  }, [editing])

  // 选中格变 ⇒ 函数栏回显该格原文（编辑栏没在打字时）
  useEffect(() => { if (!barFocus) setBarValue(inputFromCell(cells[activeKey])) }, [activeKey, cells, barFocus])
  useEffect(() => { if (editing) cellInputRef.current?.focus() }, [editing?.pos.r, editing?.pos.c])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!editing && !barFocus) setRefLive(null) }, [editing, barFocus])
  const edges = useMemo(() => currentEdges(cells, rect, mergeRects), [cells, rect, mergeRects])
  const condHere = useMemo(() => rulesTouching(content?.condFormats, rect), [content?.condFormats, rect])   // 条件格式
  const activeDv = useMemo(() => validationAt(view, activePos.r, activePos.c), [view, activePos])   // 活动格的下拉清单
  useEffect(() => { onSelectionState?.({ style: cells[activeKey]?.s, merge: mergeState, brush: !!brush, pen, drawMode, edges, view: { freezeRows: fr, freezeCols: fc, filterOn: !!view?.filter, validation: !!activeDv }, cond: condHere }) }, [activeKey, cells, mergeState, brush, onSelectionState, pen, drawMode, edges, fr, fc, view, activeDv, condHere])
  // 选字体：档里用到的字体懒载（只挂用到的 id·同 id 只挂一次）
  useEffect(() => { const ids = new Set<string>(); for (const cd of Object.values(cells)) if (cd?.s?.font) ids.add(cd.s.font); if (ids.size) ensureFontsLoaded(ids) }, [cells])
  // 填充后的「自动填充选项」：内容被别的动作改了 ⇒ 收起
  useEffect(() => { if (fillOpts && cells !== fillOpts.after) setFillOpts(null) }, [cells, fillOpts])

  const emit = useCallback((patch: Partial<ViewContent>, meta: ChangeMeta) => {
    if (readonly) return
    // 罩期一切新动作（删图／拖图／调行高列宽／合并／填充／框线／清除…）在这里一并挡；只有编辑框提交（writeCell·commit）放过去给页面补存窗判
    if (lockedRef.current && !meta.commit) return
    // 冻结筛选验证：以整份 content 为底（freeze／filter／validations 与图表、条件格式等顶层键原样带着）·纯函数在 engine/grid-emit.ts（有题）
    const next = gridEmitNext<ViewContent>(content as ViewContent, { cells, merges, images, colWidths, rowHeights }, patch)
    onChange(next, meta)
  }, [content, cells, merges, images, colWidths, rowHeights, onChange, readonly])

  const writeCell = useCallback((key: string, rawIn: string, opts?: { asText?: boolean }) => {
    if (readonly) return
    const raw = stripInvisible(rawIn)   // 画不出的字（控制字元／零宽／私用区）不进格子
    const next: SheetCells = { ...cells }
    const cd = opts?.asText ? (raw === '' ? null : { v: raw }) : cellFromInput(raw)
    let keep = cells[key]?.s
    // 带四位年的「2026/10/16」「2026-10-16」⇒ 存真日期；「10/16」「1-2」照旧文字·规则在 style.ts valueForInput
    if (cd && !opts?.asText && !cd.f) { const got = valueForInput(raw, keep?.numFmt); cd.v = got.v; if (got.numFmt) keep = { ...(keep ?? {}), numFmt: got.numFmt } }
    if (cd) next[key] = keep ? { ...cd, s: keep } : cd
    else if (keep) next[key] = { s: keep }
    else delete next[key]
    const old = cells[key]
    if (JSON.stringify(old ?? null) === JSON.stringify(next[key] ?? null)) return   // 没变 ⇒ 不进撤销栈
    // 冻结筛选验证：下拉清单格手打清单外的值（公式不判）⇒ 设了拒绝 ⇒ 不写、提示；只提醒 ⇒ 照写再提示（Excel 停止／资讯两型）
    const at = parseRef(key)
    const dv = at && !raw.trim().startsWith('=') ? validationAt(view, at.row, at.col) : null
    const verdict = dv ? checkListInput(dv, validationOptions(view, dv, viewReader), raw) : 'ok'
    const msg = verdict === 'blank' ? t('sheet_val_blank_msg') : verdict === 'not_in_list' ? t(dv?.showError === false ? 'sheet_val_warn_msg' : 'sheet_val_reject_msg').replace('{a}', raw.trim()) : ''
    if (verdict !== 'ok' && dv?.showError !== false) { void alertDialog(msg); return }
    emit({ cells: next }, { label: { k: 'edit', a: key }, commit: true })
    if (verdict !== 'ok') void alertDialog(msg)
  }, [cells, emit, readonly, view, viewReader, t])

  const move = useCallback((dr: number, dc: number, extend = false) => {
    if (extend) { setSelEnd(prev => clampPos({ r: (prev ?? sel).r + dr, c: (prev ?? sel).c + dc })); return }
    setSelEnd(null)
    setSel(p => {
      // 从合并区左上往右／下走要跳过整块
      const k = cellKey(p.r, p.c)
      const m = merges.map(parseRange).find(r => r && rectContains(r, p.r, p.c))
      const base = m && covered.get(k) === undefined && (dr > 0 || dc > 0) ? { r: dr > 0 ? m.r1 : p.r, c: dc > 0 ? m.c1 : p.c } : p
      let to = clampPos({ r: base.r + dr, c: base.c + dc })
      while (dr !== 0 && hiddenRows.has(to.r) && to.r > 0 && to.r < DEFAULT_ROWS - 1) to = clampPos({ r: to.r + Math.sign(dr), c: to.c })   // 跳过被筛掉的行
      return to
    })
  }, [merges, covered, sel, hiddenRows])

  const focusGrid = () => keyInputRef.current?.focus({ preventScroll: true })
  const commitEdit = useCallback((then?: { dr: number; dc: number }) => {
    if (editing) { writeCell(cellKey(editing.pos.r, editing.pos.c), editing.value); setEditing(null) }
    setRefLive(null)
    if (then) move(then.dr, then.dc)
    keyInputRef.current?.focus({ preventScroll: true })
  }, [editing, writeCell, move])

  const startEdit = useCallback((pos: Pos, initial?: string) => {
    if (readonly || lockedRef.current) return
    const k = cellKey(pos.r, pos.c); const tl = covered.get(k)
    const p = tl ? (() => { const q = parseRef(tl)!; return { r: q.row, c: q.col } })() : pos
    setSel(p); setSelEnd(null); setRefLive(null); setFillOpts(null)
    setEditing({ pos: p, value: initial ?? inputFromCell(cells[cellKey(p.r, p.c)]) })
  }, [cells, readonly, covered])

  /** Enter／Tab 提交：公式有语法错 ⇒ 弹「公式有誤」（改正＝回去编辑·照原樣存成文字＝存成字串）（Excel 口径） */
  const tryCommit = useCallback(async (source: 'cell' | 'bar', then?: { dr: number; dc: number }) => {
    const text = source === 'cell' ? editing?.value : barValue
    if (text === undefined) return
    const bad = !readonly && text.trim().startsWith('=') ? checkFormula(text) : null
    if (bad) {
      commitGuard.current = true
      const asText = await confirmDialog({ title: t('sheet_fx_err_title'), message: t('sheet_fx_err_prefix') + issueText(bad), confirmLabel: t('sheet_fx_err_as_text'), cancelLabel: t('sheet_fx_err_fix') })
      commitGuard.current = false
      if (!asText) {
        requestAnimationFrame(() => { const el = source === 'cell' ? cellInputRef.current : barInputRef.current; if (el) { el.focus(); el.setSelectionRange(bad.start, Math.max(bad.start, Math.min(text.length, bad.end))) } })
        return
      }
      if (source === 'cell' && editing) { writeCell(cellKey(editing.pos.r, editing.pos.c), text, { asText: true }); setEditing(null) }
      else { writeCell(activeKey, text, { asText: true }); setBarFocus(false); if (document.activeElement === barInputRef.current) skipBarBlurRef.current = true }
      setRefLive(null)
      if (then) move(then.dr, then.dc)
      focusGrid()
      return
    }
    if (source === 'cell') commitEdit(then)
    else { if (!readonly) writeCell(activeKey, barValue); setBarFocus(false); setRefLive(null); if (then) move(then.dr, then.dc); skipBarBlurRef.current = true; focusGrid() }
  }, [editing, barValue, readonly, t, issueText, writeCell, activeKey, move, commitEdit])

  /** ：离开编辑（点别的格／列头行号／全选角／拖宽高／点页面别处失焦）前与 Enter／Tab 同判（checkFormula）。
   *  有错 ⇒ 同一个「公式有誤」框：改正＝留在原格原输入框继续编（选区不动）·照原樣存成文字＝存成字串后才做原本要做的事（after）。
   *  返回 true＝已拦下（调用方就此打住）；false＝没错·照常提交 */
  const pendingBad = useCallback((): { source: 'cell' | 'bar'; key: string; text: string; bad: FormulaIssue } | null => {
    if (readonly) return null
    if (editing) {
      const bad = editing.value.trim().startsWith('=') ? checkFormula(editing.value) : null
      return bad ? { source: 'cell', key: cellKey(editing.pos.r, editing.pos.c), text: editing.value, bad } : null
    }
    if (!barFocus || barValue === inputFromCell(cells[activeKey])) return null
    const bad = barValue.trim().startsWith('=') ? checkFormula(barValue) : null
    return bad ? { source: 'bar', key: activeKey, text: barValue, bad } : null
  }, [readonly, editing, barFocus, barValue, cells, activeKey])
  const guardLeave = useCallback((after?: () => void): boolean => {
    if (commitGuard.current) return true
    const p = pendingBad()
    if (!p) return false
    commitGuard.current = true
    void (async () => {
      const asText = await confirmDialog({ title: t('sheet_fx_err_title'), message: t('sheet_fx_err_prefix') + issueText(p.bad), confirmLabel: t('sheet_fx_err_as_text'), cancelLabel: t('sheet_fx_err_fix') })
      commitGuard.current = false
      if (!asText) {
        requestAnimationFrame(() => { const el = p.source === 'cell' ? cellInputRef.current : barInputRef.current; if (el) { el.focus(); el.setSelectionRange(p.bad.start, Math.max(p.bad.start, Math.min(p.text.length, p.bad.end))) } })
        return
      }
      writeCell(p.key, p.text, { asText: true })
      if (p.source === 'cell') setEditing(null)
      else { setBarFocus(false); if (document.activeElement === barInputRef.current) skipBarBlurRef.current = true }
      setRefLive(null)
      after?.()
    })()
    return true
  }, [pendingBad, t, issueText, writeCell])

  /** 跨页签点格带入：正在编的公式（格内或公式栏）＋光标＋刚插的那段；光标处不能插 ⇒ null */
  const carryable = useCallback((): { key: string; text: string; caret: number; live: { start: number; end: number } | null } | null => {
    if (readonly || commitGuard.current) return null
    const text = editing ? editing.value : barFocus ? barValue : null
    if (text === null) return null
    const inp = editing ? cellInputRef.current : barInputRef.current
    const caret = inp?.selectionStart ?? text.length
    if (!canCarryFormula(text, caret, refLive)) return null
    return { key: editing ? cellKey(editing.pos.r, editing.pos.c) : activeKey, text, caret, live: refLive && caret === refLive.end ? refLive : null }
  }, [readonly, editing, barFocus, barValue, refLive, activeKey])
  // 从别张点完格回来（页面递 resume·这张刚挂上）：回原格——接着编（光标照旧）／照 Enter 提交（有语法错照样问）／不存
  useEffect(() => {
    if (!resume) return
    const q = parseRef(resume.key)
    if (q) {
      const p = { r: q.row, c: q.col }
      setSel(p); setSelEnd(null)
      if (resume.mode === 'cancel') focusGrid()
      else {
        setEditing({ pos: p, value: resume.text })
        if (resume.mode === 'commit') resumeCommitRef.current = true
        else requestAnimationFrame(() => { const el = cellInputRef.current; if (el) { el.focus(); el.setSelectionRange(resume.caret, resume.caret) } })
      }
    }
    onResumed?.()
  }, [resume])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (resumeCommitRef.current && editing) { resumeCommitRef.current = false; void tryCommit('cell', { dr: 1, dc: 0 }) } }, [editing, tryCommit])

  // ── 格式动作（作用于当前选区） ──
  const patchRect = useCallback((fn: (cur: CellStyle | undefined, r: number, c: number) => CellStyle | undefined, label: HistoryLabel = { k: 'format', a: rangeText(rect) }) => {
    if (readonly || lockedRef.current) return
    emit({ cells: applyStyleToRect(cells, rect, fn) }, { label })
  }, [cells, rect, emit, readonly])
  // 条件格式：工具栏小面板的新增／清除选区／删一条（规矩＝AI 工具同一份 applyCondChange）·进撤销栈
  const applyCond = useCallback((a: CondUiAction) => {
    if (readonly || lockedRef.current) return
    try {
      const r = applyCondChange(content?.condFormats, a.kind === 'add' ? { ranges: [rect], rule: a.rule, ...(a.format !== undefined ? { format: a.format } : {}) } : a.kind === 'clear' ? { clear: true, ranges: [rect] } : { clear: true, ruleId: a.id })
      emit({ condFormats: r.rules }, { label: { k: a.kind === 'add' ? 'cond_format' : 'cond_clear', a: rangeText(rect) } })
    } catch (e) {
      if (e instanceof CondInputError) void alertDialog(t('sheet_cf_failed') + e.message); else throw e
    }
  }, [content?.condFormats, rect, emit, readonly, t])
  const applyCondRef = useRef(applyCond); applyCondRef.current = applyCond
  const setStyle = useCallback((patch: Partial<CellStyle>) => {
    patchRect(cur => {
      const n: CellStyle = { ...(cur ?? {}) }
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === false) delete (n as Record<string, unknown>)[k]; else (n as Record<string, unknown>)[k] = v }
      return Object.keys(n).length ? n : undefined
    })
  }, [patchRect])
  const toggleStyle = useCallback((key: 'b' | 'i' | 'u' | 's' | 'wrap') => {
    const on = !cells[activeKey]?.s?.[key]
    setStyle({ [key]: on } as Partial<CellStyle>)
  }, [cells, activeKey, setStyle])

  const display = useCallback((key: string) => {
    const v = values.get(key)
    const s = cells[key]?.s
    if (s?.numFmt) {
      const val = v === undefined ? null : (isFormulaError(v) ? null : v)
      if (!isFormulaError(v)) { const f = formatWithNumFmt(s.numFmt, val, cells[key]?.v, { lang: nfLang }); if (f !== null) return f }
    }
    return v === undefined ? '' : formatValue(v)
  }, [values, cells, nfLang])

  // ── 剪贴板 ──
  const copyBlock = useCallback((): ClipBlock => {
    const block = blockFromSelection(cells, rect, display)
    internalClipRef.current = block
    return block
  }, [cells, rect, display])
  const clearRect = useCallback((r: Rect, label: HistoryLabel) => {
    const next = { ...cells }
    for (const [k] of rectKeys(r)) delete next[k]
    emit({ cells: next }, { label })
  }, [cells, emit])
  const doCut = useCallback(async () => {
    const block = copyBlock()
    try { await navigator.clipboard?.writeText(block.text) } catch { /* 没权限也照剪：内部块仍在 */ }
    if (!readonly && !lockedRef.current) clearRect(rect, { k: 'cut', a: rangeText(rect) })
  }, [copyBlock, clearRect, rect, readonly])
  const doCopy = useCallback(async () => {
    const block = copyBlock()
    try { await navigator.clipboard?.writeText(block.text) } catch { /* 没权限：内部块仍可贴 */ }
  }, [copyBlock])
  const pasteText = useCallback((text: string) => {
    if (readonly || lockedRef.current) return
    const internal = internalClipRef.current
    const block = internal && internal.text === text ? internal : blockFromText(text)
    const { cells: next, rect: r } = pasteBlock(cells as Record<string, CellData>, block, activePos, DEFAULT_ROWS, DEFAULT_COLS)
    emit({ cells: next as SheetCells }, { label: { k: 'paste', a: rangeText(r) } })
    setSel({ r: r.r0, c: r.c0 }); setSelEnd(r.r1 === r.r0 && r.c1 === r.c0 ? null : { r: r.r1, c: r.c1 })
  }, [cells, activePos, emit, readonly])
  const doPaste = useCallback(async () => {
    if (readonly || lockedRef.current) return
    let text: string | null = null
    try { text = await navigator.clipboard.readText() } catch { text = null }
    if (text === null) {
      // 浏览器不给读剪贴簿 ⇒ 退回同页内部块；连内部块都没有才提示
      if (internalClipRef.current) { pasteText(internalClipRef.current.text); return }
      await alertDialog(t('sheet_tb_paste_denied')); return
    }
    if (text) pasteText(text)
  }, [pasteText, readonly, t])

  // ── 合并 ──
  const doMerge = useCallback(() => {
    if (readonly || mergeState === 'single') return
    if (mergeState === 'merged') { emit({ merges: removeMerges(merges, rect) }, { label: { k: 'unmerge', a: rangeText(rect) } }); return }
    // 合并：只留左上格内容（Excel 口径）·其余格内容清掉、格式保留
    const tl = cellKey(rect.r0, rect.c0)
    const next = { ...cells }
    for (const [k] of rectKeys(rect)) {
      if (k === tl || !next[k]) continue
      const { s } = next[k]
      if (s) next[k] = { s }; else delete next[k]
    }
    emit({ cells: next, merges: addMerge(merges, rect) }, { label: { k: 'merge', a: rangeText(rect) } })
    setSel({ r: rect.r0, c: rect.c0 }); setSelEnd({ r: rect.r1, c: rect.c1 })
  }, [readonly, mergeState, merges, rect, cells, emit])

  // ── 框线 ──
  const bounds = useMemo(() => ({ rows: DEFAULT_ROWS, cols: DEFAULT_COLS }), [])
  const applyEdges = useCallback((target: Rect, e: BorderEdges) => {
    if (readonly || lockedRef.current) return   // 罩落前已开的框线弹窗／绘图边框在罩期套用 ⇒ 挡
    emit({ cells: applyBorderEdges(cells, target, e, mergeRects, bounds) as SheetCells }, { label: { k: 'border', a: rangeText(target) } })
  }, [readonly, emit, cells, mergeRects, bounds])
  const hasValueAt = useCallback((r: number, c: number) => { const cd = cells[cellKey(r, c)]; return !!cd && ((cd.v !== undefined && cd.v !== '') || !!cd.f) }, [cells])

  // ── 浮图 ──
  const insertImage = useCallback(async (file: File) => {
    if (readonly || uploading) return
    setUploading(true)
    try {
      if (!host.uploadImage) throw new Error('no image store')
      const up = await host.uploadImage(file)
      if (!up.url) throw new Error('no url')
      const j = { url: up.url, display_url: up.displayUrl ?? (host.imageSrc ? host.imageSrc(up.url) : up.url) }
      const dim = await new Promise<{ w: number; h: number }>((resolve) => {
        const im = new Image()
        im.onload = () => resolve({ w: im.naturalWidth || 200, h: im.naturalHeight || 150 })
        im.onerror = () => resolve({ w: 200, h: 150 })
        im.src = j.display_url || j.url!
      })
      const scale = Math.min(1, IMAGE_MAX_W / dim.w)
      const img: SheetImage = { id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, url: j.url, cell: activeKey, w: Math.max(16, Math.round(dim.w * scale)), h: Math.max(16, Math.round(dim.h * scale)), ox: 0, oy: 0 }
      emit({ images: [...images, img] }, { label: { k: 'image' } })
      setSelectedImage(img.id)
    } catch {
      await alertDialog(t('sheet_tb_image_fail'))
    } finally { setUploading(false) }
  }, [readonly, uploading, activeKey, images, emit, t, host])
  const updateImage = useCallback((id: string, patch: Partial<SheetImage>) => {
    emit({ images: images.map(im => im.id === id ? { ...im, ...patch } : im) }, { label: { k: 'image_move' } })
  }, [images, emit])
  const deleteImage = useCallback((id: string) => {
    if (readonly || lockedRef.current) return
    emit({ images: images.filter(im => im.id !== id) }, { label: { k: 'image_delete' } })
    setSelectedImage(null)
  }, [images, emit, readonly])
  // ── 图片层次／平面（右键选单）：上移下移到顶到底·移到表格底下／上面·放进格子里 ──
  const [imgMenu, setImgMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const imgMenuRef = useRef<HTMLDivElement | null>(null)
  const applyImages = useCallback((next: SheetImage[], label: string) => {
    if (readonly || lockedRef.current || next === images) return   // 动不了（已到顶／底）⇒ 不进撤销栈
    emit({ images: next }, { label: { k: label } })
  }, [images, emit, readonly])
  useEffect(() => {
    if (!imgMenu) return
    const close = (e: Event) => { if (e.type === 'mousedown' && imgMenuRef.current?.contains(e.target as Node)) return; setImgMenu(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setImgMenu(null) }
    const g = gridRef.current
    window.addEventListener('mousedown', close, true); window.addEventListener('keydown', onKey); g?.addEventListener('scroll', close)
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', onKey); g?.removeEventListener('scroll', close) }
  }, [imgMenu])

  // ── 冻结筛选验证：工具栏「凍結／篩選／下拉選單」·筛选选单·下拉清单 ──
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null)
  const [valPanel, setValPanel] = useState<Rect | null>(null)
  const [valPicker, setValPicker] = useState<{ x: number; y: number; w: number } | null>(null)
  const runViewCommand = useCallback((cmd: Extract<ToolbarCommand, { t: 'freeze' | 'filterToggle' | 'validationPanel' }>) => {
    if (readonly || lockedRef.current) return
    if (cmd.t === 'freeze') {
      // 首列＝只冻第一行·首欄＝只冻第一列（Excel 同：换一种就盖掉另一向）·至选取格＝活动格上方的行与左方的列
      const want = cmd.mode === 'row' ? { rows: 1, cols: 0 } : cmd.mode === 'col' ? { rows: 0, cols: 1 } : cmd.mode === 'sel' ? { rows: activePos.r, cols: activePos.c } : null
      emit({ freeze: sanitizeFreeze(want) }, { label: { k: 'freeze' } })
    } else if (cmd.t === 'filterToggle') {
      if (view?.filter) { emit({ filter: undefined }, { label: { k: 'filter' } }); setFilterMenu(null); focusGrid(); return }
      // 只点一格或全选 ⇒ 这格所在的连续资料区（Excel 同）；选了一块 ⇒ 第一行当表头（只选表头一行 ⇒ 往下延到这几列最后一行有值）
      const whole = rect.r0 === 0 && rect.r1 === DEFAULT_ROWS - 1
      const target = (rect.r0 === rect.r1 && rect.c0 === rect.c1) || whole ? currentRegion(hasValueAt, activePos, bounds) : rect
      if (target.r0 === target.r1 && target.c0 === target.c1 && !hasValueAt(target.r0, target.c0)) { void alertDialog(t('sheet_flt_need_table')); return }
      emit({ filter: { range: `${cellKey(target.r0, target.c0)}:${cellKey(target.r1, target.c1)}` } }, { label: { k: 'filter' } })
    } else setValPanel(rect)
    focusGrid()
  }, [readonly, activePos, emit, view, rect, hasValueAt, bounds, t])
  const applyFilterCriterion = useCallback((col: number, crit: FilterCriterion | null) => {
    const f = view?.filter
    if (!f || readonly || lockedRef.current) return
    const criteria = { ...(f.criteria ?? {}) }
    if (crit) criteria[indexToCol(col)] = crit; else delete criteria[indexToCol(col)]
    emit({ filter: { range: f.range, ...(Object.keys(criteria).length ? { criteria } : {}) } }, { label: { k: 'filter' } })
  }, [view, emit, readonly])
  const sortFilterColumn = useCallback((col: number, descending: boolean) => {
    if (!fRect || readonly || lockedRef.current) return
    // 排序接 AI 那支 sort（agent-ops·同口径：数字在文字前·空白最后·稳定·公式相对行跟着搬）·表头不动
    try {
      const res = applyOps(view as AgentContent, [{ op: 'sort', range: rectA1(fRect), by: [{ column: indexToCol(col), descending }], has_header: true }])
      emit({ cells: res.content.cells ?? {} }, { label: { k: 'sort', a: indexToCol(col) } })
    } catch (e) { if (e instanceof OpError) void alertDialog(t('sheet_flt_sort_fail')); else throw e }
  }, [fRect, view, emit, readonly, t])
  const openValPicker = useCallback(() => {
    const td = gridRef.current?.querySelector<HTMLElement>(`td[data-cell="${activeKey}"]`)
    if (!td || !activeDv || readonly || lockedRef.current) return
    const b = td.getBoundingClientRect()
    setValPicker({ x: b.left, y: b.bottom + 2, w: b.width })
  }, [activeKey, activeDv, readonly])
  useEffect(() => { setValPicker(null) }, [activeKey])
  const sizesForFreeze = { headW: HEAD_W, headH: HEAD_H, colWidths, rowHeights }

  // ── 工具栏命令入口 ──
  useImperativeHandle(ref, () => ({
    exec(cmd: ToolbarCommand) {
      switch (cmd.t) {
        case 'brush': setBrush(b => b ? null : { style: copyStyle(cells[activeKey]?.s) }); focusGrid(); break
        case 'copy': void doCopy(); break
        case 'cut': void doCut(); break
        case 'paste': void doPaste(); break
        case 'style': setStyle(cmd.patch); break
        case 'toggle': toggleStyle(cmd.key); break
        case 'sizeStep': setStyle({ size: stepSize(cells[activeKey]?.s?.size, cmd.delta) }); break
        case 'border': {
          // 全表框线＝当前连续资料区（Excel CurrentRegion）；其余套在选区
          const target = cmd.kind === 'wholeTable' ? expandRectToMerges(currentRegion(hasValueAt, activePos, bounds), merges) : rect
          applyEdges(target, edgesForKind(cmd.kind, pen))
          if (cmd.kind === 'wholeTable') { setSel({ r: target.r0, c: target.c0 }); setSelEnd({ r: target.r1, c: target.c1 }) }
          focusGrid(); break
        }
        case 'borderEdges': applyEdges(rect, cmd.edges); focusGrid(); break
        case 'drawMode': setDrawMode(cmd.mode); focusGrid(); break
        // 挑线条颜色／样式 ⇒ 换笔并进绘图边框（Excel 口径：选了线色／线型就开始画）
        case 'pen': setPen(p => ({ ...p, ...cmd.pen })); setDrawMode(m => m && m !== 'erase' ? m : 'outline'); focusGrid(); break
        case 'clearFormat': patchRect(() => undefined); break
        case 'indent': { const cur = cells[activeKey]?.s?.indent ?? 0; const n = Math.max(0, Math.min(INDENT_MAX, cur + cmd.delta)); setStyle({ indent: n || undefined }); break }
        case 'merge': doMerge(); break
        case 'numFmt': patchRect(cur => { const n: CellStyle = { ...(cur ?? {}) }; const nf = numFmtForKind(cmd.kind); if (nf) n.numFmt = nf; else delete n.numFmt; return Object.keys(n).length ? n : undefined }, { k: 'numfmt', a: rangeText(rect) }); break
        // 格式下拉挑货币符号（$／€／¥／NT$）⇒ 选区里货币／会计格换符号；其它格先套成货币再带这个符号
        case 'currencySymbol': patchRect(cur => ({ ...(cur ?? {}), numFmt: withCurrencySymbol(cur?.numFmt, cmd.sym) }), { k: 'numfmt', a: rangeText(rect) }); break
        case 'numAction': {
          const v = values.get(activeKey)
          const numVal = typeof v === 'number' ? v : null
          patchRect(cur => { const n = { ...(cur ?? {}) }; const nf = applyNumFmtAction(cur?.numFmt, cmd.action, numVal); if (nf) n.numFmt = nf; else delete n.numFmt; return Object.keys(n).length ? n : undefined }, { k: 'numfmt', a: rangeText(rect) })
          break
        }
        case 'insertImage': void insertImage(cmd.file); break
        // 图表：用选区当数据区间（只选一格 ⇒ 扩到它所在的连续资料区·Excel 口径）开插入面板
        case 'insertChart': chartLayerRef.current?.openInsert(rangeText(rect.r0 === rect.r1 && rect.c0 === rect.c1 ? currentRegion(hasValueAt, activePos, bounds) : rect)); break
        case 'condFormat': applyCondRef.current(cmd.action); break   // 条件格式
        // 冻结筛选验证
        case 'freeze': case 'filterToggle': case 'validationPanel': runViewCommand(cmd); break
      }
    },
    selectionRange: () => rangeText(rect),
    isEditing: () => !!editing || barFocus,
    selectRange(a1: string) {
      const r = parseRange(a1.includes(':') ? a1 : `${a1}:${a1}`)
      if (!r) return false
      const c = (p: Pos) => clampPos(p)
      setSel(c({ r: r.r0, c: r.c0 })); setSelEnd(r.r1 > r.r0 || r.c1 > r.c0 ? c({ r: r.r1, c: r.c1 }) : null)
      focusGrid()
      return true
    },
    canCarryFormula: () => carryable() !== null,
    carryFormula() {
      const c = carryable()
      if (c) carriedRef.current = true
      return c
    },
  }), [carryable, editing, barFocus, cells, activeKey, activePos, doCopy, doCut, doPaste, setStyle, toggleStyle, patchRect, rect, doMerge, values, insertImage, applyEdges, pen, hasValueAt, bounds, merges, runViewCommand])

  // 格式刷：起刷后下一次选区（点或拖）松手 ⇒ 套用到该选区
  const brushArmedRef = useRef(false)
  useEffect(() => { brushArmedRef.current = false }, [brush])
  useEffect(() => {
    const onUp = () => {
      if (draggingRef.current) draggingRef.current = false
      if (brushRef.current && brushArmedRef.current) {
        const style = brushRef.current.style
        brushArmedRef.current = false
        setBrush(null)
        // 用最新 rect（setState 已排队·下一拍读）
        setTimeout(() => { setPendingBrush({ style }) }, 0)
      }
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])
  const [pendingBrush, setPendingBrush] = useState<{ style: CellStyle | undefined } | null>(null)
  useEffect(() => {
    if (!pendingBrush) return
    setPendingBrush(null)
    patchRect(() => (pendingBrush.style ? { ...pendingBrush.style } : undefined), { k: 'brush', a: rangeText(rect) })
  }, [pendingBrush, patchRect, rect])

  // ── 几何：量每列左右缘／每行上下缘（滚动容器内容坐标·已含 zoom） ──
  const measure = useCallback(() => {
    const g = gridRef.current, tb = tableRef.current
    if (!g || !tb) return
    const gr = g.getBoundingClientRect()
    const ox = g.scrollLeft - gr.left, oy = g.scrollTop - gr.top
    const colL: number[] = [], colR: number[] = [], rowT: number[] = [], rowB: number[] = []
    tb.querySelectorAll<HTMLElement>('th[data-col]').forEach(th => { const r = th.getBoundingClientRect(); colL.push(r.left + ox); colR.push(r.right + ox) })
    tb.querySelectorAll<HTMLElement>('th[data-row]').forEach(th => { const r = th.getBoundingClientRect(); rowT.push(r.top + oy); rowB.push(r.bottom + oy) })
    fixFrozenGeo(tb, { colL, colR, rowT, rowB }, frzRef.current)   // 冻结的那几条是 sticky（量到的是钉住的位置）·被筛掉的行是零高
    setGeo(prev => (prev && sameArr(prev.colL, colL) && sameArr(prev.colR, colR) && sameArr(prev.rowT, rowT) && sameArr(prev.rowB, rowB) ? prev : { colL, colR, rowT, rowB }))
  }, [])
  useLayoutEffect(() => { measure() }, [measure, content, zoom, editing, fr, fc])
  // 覆盖层裁掉冻结的列头／行号那一条（border-collapse 下表头格的边线区不盖底·覆盖层的线会从缝里透出来）：卷动时更新裁切量（CSS 变数·不重渲染）
  //   冻结窗格 ⇒ 主层再多裁冻结区的高宽（frzBox）·另给三块冻结窗格 --sx／--sy（卷动量）
  const frzBox: FreezeBox = useMemo(() => freezeBox(geo, fr, fc), [geo, fr, fc])
  const frzRef = useRef({ fr, fc }); frzRef.current = { fr, fc }
  const frzBoxRef = useRef(frzBox); frzBoxRef.current = frzBox
  useEffect(() => {
    const g = gridRef.current; if (!g) return
    const upd = () => {
      g.style.setProperty('--ov-top', `${g.scrollTop + HEAD_H * zoomRef.current + frzBox.frozenH}px`); g.style.setProperty('--ov-left', `${g.scrollLeft + HEAD_W * zoomRef.current + frzBox.frozenW}px`)
      g.style.setProperty('--sx', `${g.scrollLeft}px`); g.style.setProperty('--sy', `${g.scrollTop}px`)
    }
    upd()
    g.addEventListener('scroll', upd, { passive: true })
    return () => g.removeEventListener('scroll', upd)
  }, [zoom, frzBox.frozenH, frzBox.frozenW])
  useEffect(() => {
    const tb = tableRef.current
    if (!tb || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(tb)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure])
  /** 屏上一点 ⇒ 格坐标（落在表外夹到边） */
  const hitCell = useCallback((clientX: number, clientY: number): Pos | null => {
    const g = gridRef.current, gm = geoRef.current
    if (!g || !gm || !gm.colL.length || !gm.rowT.length) return null
    const gr = g.getBoundingClientRect()
    let x = clientX - gr.left + g.scrollLeft, y = clientY - gr.top + g.scrollTop
    // 落在冻结区（钉在视窗上·不随卷动）⇒ 不加卷动量
    const fb = frzBoxRef.current
    if (fb.frozenW > 0 && clientX - gr.left < fb.colL0 + fb.frozenW) x = clientX - gr.left
    if (fb.frozenH > 0 && clientY - gr.top < fb.rowT0 + fb.frozenH) y = clientY - gr.top
    return { r: hitIndex(gm.rowT, gm.rowB, y), c: hitIndex(gm.colL, gm.colR, x) }
  }, [])
  /** 拖到容器边缘自动卷 */
  const autoScroll = (ev: MouseEvent) => {
    const g = gridRef.current; if (!g) return
    const gr = g.getBoundingClientRect()
    if (ev.clientY > gr.bottom - 16) g.scrollTop += 24; else if (ev.clientY < gr.top + HEAD_H * zoomRef.current + 8) g.scrollTop -= 24
    if (ev.clientX > gr.right - 16) g.scrollLeft += 24; else if (ev.clientX < gr.left + HEAD_W * zoomRef.current + 8) g.scrollLeft -= 24
  }
  /** 挂一组全窗口的拖动监听（放手自动拆） */
  const trackDrag = (onMove: (ev: MouseEvent) => void, onUp: (ev: MouseEvent) => void) => {
    const mv = (ev: MouseEvent) => { autoScroll(ev); onMove(ev) }
    const up = (ev: MouseEvent) => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); onUp(ev) }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
  }

  // ── 填充柄（第 2 条） ──
  const runFill = useCallback((plan: FillPlan, type: FillType, before: { cells: SheetCells; merges: string[] }, group: string) => {
    const m = fillMerges(before.merges, plan)
    if ('conflict' in m) { void alertDialog(t('sheet_fill_merge_conflict')); return }
    const next = applyFill(before.cells, plan, type, DEFAULT_ROWS, DEFAULT_COLS)
    const u = fillUnion(plan)
    emit({ cells: next, merges: m.merges }, { label: { k: 'fill', a: rangeText(u) }, group })
    setSel({ r: u.r0, c: u.c0 }); setSelEnd({ r: u.r1, c: u.c1 })
    setFillOpts({ plan, type, seriesDisabled: fillDefaults(before.cells, plan).seriesDisabled, before, after: next, group, menu: false })
  }, [emit, t])
  const startFill = (e: ReactMouseEvent) => {
    if (readonly) return
    e.preventDefault(); e.stopPropagation()
    const source = rect
    const before = { cells, merges }
    setFillOpts(null)
    let plan: ReturnType<typeof fillPlanFor> = null
    trackDrag(ev => {
      const at = hitCell(ev.clientX, ev.clientY); if (!at) return
      plan = fillPlanFor(source, at)
      if (!plan) setFillPreview(null)
      else if (isShrink(plan)) setFillPreview({ rect: plan.clear, shrink: true })
      else setFillPreview({ rect: fillUnion(plan), shrink: false })
    }, ev => {
      setFillPreview(null)
      const p = plan
      if (!p) return
      if (isShrink(p)) {
        emit({ cells: clearContents(before.cells, p.clear) }, { label: { k: 'clear', a: rangeText(p.clear) } })
        setSel({ r: p.keep.r0, c: p.keep.c0 }); setSelEnd({ r: p.keep.r1, c: p.keep.c1 })
      } else {
        runFill(p, fillTypeFor(before.cells, p, ev.ctrlKey || ev.metaKey), before, `fill-${Date.now()}`)
      }
      focusGrid()
    })
  }
  const dblFill = (e: ReactMouseEvent) => {
    if (readonly) return
    e.preventDefault(); e.stopPropagation()
    const end = dblClickFillEnd(cells, rect, DEFAULT_ROWS, DEFAULT_COLS)
    if (end === null) return
    const plan: FillPlan = { dir: 'down', source: rect, target: { r0: rect.r1 + 1, r1: end, c0: rect.c0, c1: rect.c1 } }
    runFill(plan, fillTypeFor(cells, plan, false), { cells, merges }, `fill-${Date.now()}`)
    focusGrid()
  }
  const refill = (type: FillType) => {
    if (!fillOpts) return
    runFill(fillOpts.plan, type, fillOpts.before, fillOpts.group)   // 同 group ⇒ 撤销栈并进同一步（univer group replace）
  }

  // ── 拖改列宽行高（第 1 条） ──
  const startResize = (axis: 'col' | 'row', index: number) => (e: ReactMouseEvent) => {
    if (readonly || e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const gm = geoRef.current; if (!gm) return
    if (guardLeave(focusGrid)) return
    if (editing) commitEdit()
    const start = axis === 'col' ? e.clientX : e.clientY
    const startSize = axis === 'col' ? colWidthOf(colWidths, index) : hasRowHeight(rowHeights, index) ? rowHeightOf(rowHeights, index) : Math.round((gm.rowB[index] - gm.rowT[index]) / zoomRef.current)
    const edge = axis === 'col' ? gm.colR[index] : gm.rowB[index]
    const targets = axis === 'col' ? resizeTargets(index, { a0: rect.c0, a1: rect.c1 }, fullCols) : resizeTargets(index, { a0: rect.r0, a1: rect.r1 }, fullRows)
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize'
    setResizing({ axis, index, edge, delta: 0, size: startSize })
    let delta = 0
    trackDrag(ev => {
      delta = (axis === 'col' ? ev.clientX : ev.clientY) - start
      const size = draggedSize(startSize, delta, zoomRef.current, axis)
      setResizing({ axis, index, edge, delta: (size - startSize) * zoomRef.current, size })
    }, () => {
      document.body.style.cursor = prevCursor
      setResizing(null)
      if (Math.abs(delta) < 1) return
      const size = draggedSize(startSize, delta, zoomRef.current, axis)
      const label = targets.length > 1 ? `${axis === 'col' ? indexToCol(targets[0]) : targets[0] + 1}–${axis === 'col' ? indexToCol(targets[targets.length - 1]) : targets[targets.length - 1] + 1}` : (axis === 'col' ? indexToCol(index) : String(index + 1))
      if (axis === 'col') emit({ colWidths: setColWidths(colWidths, targets, size) }, { label: { k: 'col_width', a: label } })
      else emit({ rowHeights: setRowHeights(rowHeights, targets, size) }, { label: { k: 'row_height', a: label } })
    })
  }
  /** 双击边线自适应：列＝量字宽取最大（univer _calculateColWidth 口径：跳过合并区·空列回预设）；行＝撤掉手定高度回随内容 */
  const autofit = (axis: 'col' | 'row', index: number) => (e: ReactMouseEvent) => {
    if (readonly || lockedRef.current) return   // 罩期双击边线不自适应
    e.preventDefault(); e.stopPropagation()
    if (axis === 'row') {
      const targets = resizeTargets(index, { a0: rect.r0, a1: rect.r1 }, fullRows)
      emit({ rowHeights: setRowHeights(rowHeights, targets, null) }, { label: { k: 'row_height', a: String(index + 1) } })
      return
    }
    const targets = resizeTargets(index, { a0: rect.c0, a1: rect.c1 }, fullCols)
    const base = tableRef.current ? getComputedStyle(tableRef.current).fontFamily : 'sans-serif'
    let next = colWidths
    for (const c of targets) {
      const ws: number[] = []
      for (let r = 0; r < DEFAULT_ROWS; r++) {
        const key = cellKey(r, c)
        if (covered.has(key)) continue
        const m = mergeRects.find(x => x.r0 === r && x.c0 === c); if (m && m.c1 > m.c0) continue
        const text = display(key); if (!text) continue
        const s = cells[key]?.s
        const num = typeof values.get(key) === 'number'
        const family = s?.font ? (fontStack(s.font) ?? base) : num ? MONO_STACK : base
        const size = s?.size ? Math.round(s.size * 4 / 3) : 13
        ws.push(textWidth(text, `${s?.i ? 'italic ' : ''}${s?.b ? 700 : 400} ${size}px ${family}`) + (s?.indent ? s.indent * 12 : 0))
      }
      next = setColWidths(next, [c], autofitWidth(ws))
    }
    emit({ colWidths: next }, { label: { k: 'col_width', a: indexToCol(index) } })
  }

  // ── 列头／行号点选整列整行（多选列再拖一条＝同改全部） ──
  const startHeaderSelect = (axis: 'col' | 'row', index: number) => (e: ReactMouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    if (xref) return   // 借来点格时列头行号不接（公式栏焦点别丢）
    const anchor = e.shiftKey ? (axis === 'col' ? sel.c : sel.r) : index
    const apply = (to: number) => {
      if (axis === 'col') { setSel({ r: 0, c: anchor }); setSelEnd({ r: DEFAULT_ROWS - 1, c: to }) }
      else { setSel({ r: anchor, c: 0 }); setSelEnd({ r: to, c: DEFAULT_COLS - 1 }) }
    }
    if (guardLeave(() => { apply(index); focusGrid() })) return
    if (editing) commitEdit()
    setSelectedImage(null); setFillOpts(null)
    apply(index)
    trackDrag(ev => { const at = hitCell(ev.clientX, ev.clientY); if (at) apply(axis === 'col' ? at.c : at.r) }, () => {})
    focusGrid()
  }

  // ── 格子按下：公式点格带入／绘图边框／选区 ──
  const onCellMouseDown = (e: ReactMouseEvent, r: number, c: number, isEdit: boolean) => {
    if (isEdit) return
    // 别张的公式借来点格（跨页签带入）：点／拖 ⇒ 插 表名!A1（页面 xrefStep 管字）·选区跟着画出来·公式栏焦点不丢
    if (xref && onXref && sheetName) {
      if (e.button !== 0) return
      e.preventDefault()
      const anchor = { r, c }
      const pick = (to: Pos) => {
        const rr = expandRectToMerges(normRect(anchor, to), merges)
        setSel({ r: rr.r0, c: rr.c0 }); setSelEnd(rr.r1 > rr.r0 || rr.c1 > rr.c0 ? { r: rr.r1, c: rr.c1 } : null)
        onXref({ t: 'pick', sheet: sheetName, rect: rr })
      }
      pick(anchor)
      trackDrag(ev => { const at = hitCell(ev.clientX, ev.clientY); if (at) pick(at) }, () => {})
      return
    }
    // 编辑公式中·光标处能插引用（或刚插的那段还活着）⇒ 插 A1·拖着就成 A1:B3
    const text = editTextRef.current
    if (text !== null && text.startsWith('=') && e.button === 0) {
      const inp = activeInput()
      const caret = inp?.selectionStart ?? text.length
      const live = refLive && caret === refLive.end ? refLive : null
      if (live || canInsertRefAt(text, caret)) {
        e.preventDefault()
        const anchor = { r, c }
        const put = (to: Pos, cur: { start: number; end: number } | null, base: string, at: number) => {
          const rr = expandRectToMerges(normRect(anchor, to), merges)
          const res = insertRef(base, at, rectRefText(rr), cur)
          setEditText(res.text); setRefLive(res.live); setCaretLater(res.caret)
          return res
        }
        let res = put(anchor, live, text, caret)
        trackDrag(ev => {
          const at = hitCell(ev.clientX, ev.clientY); if (!at) return
          res = put(at, res.live, res.text, res.caret)
        }, () => {})
        return
      }
    }
    e.preventDefault()
    if (guardLeave(() => { setSel({ r, c }); setSelEnd(null); focusGrid() })) return
    if (editing) commitEdit()
    setSelectedImage(null)
    if (fillOpts) setFillOpts(null)
    if (drawMode && !readonly) {
      const anchor = { r, c }
      const mk = (to: Pos) => expandRectToMerges(normRect(anchor, to), merges)
      let cur = mk(anchor)
      setDrawDrag(cur)
      trackDrag(ev => { const at = hitCell(ev.clientX, ev.clientY); if (at) { cur = mk(at); setDrawDrag(cur) } }, () => {
        setDrawDrag(null)
        applyEdges(cur, edgesForKind(drawMode === 'outline' ? 'outside' : drawMode === 'grid' ? 'all' : 'none', pen))
      })
      focusGrid()
      return
    }
    if (e.shiftKey) { setSelEnd({ r, c }) } else { setSel({ r, c }); setSelEnd(null); draggingRef.current = true }
    if (brushRef.current) brushArmedRef.current = true
    focusGrid()
  }

  // 网格键盘（没在编辑时·挂在看不见的 input 上）
  const onGridKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (editing) return
    const k = e.key
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.altKey) {
      const lk = k.toLowerCase()
      // Ctrl／⌘+Z 撤·Ctrl／⌘+Y 与 Ctrl／⌘+Shift+Z 重做（univer shared-shortcut 口径）
      if (lk === 'z' && !e.shiftKey) { e.preventDefault(); if (!historyLocked) onUndo?.(); return }
      if (lk === 'y' || (lk === 'z' && e.shiftKey)) { e.preventDefault(); if (!historyLocked) onRedo?.(); return }
      if (lk === 'b') { e.preventDefault(); toggleStyle('b'); return }
      if (lk === 'i') { e.preventDefault(); toggleStyle('i'); return }
      if (lk === 'u') { e.preventDefault(); toggleStyle('u'); return }
      if (lk === 'a') { e.preventDefault(); setSel({ r: 0, c: 0 }); setSelEnd({ r: DEFAULT_ROWS - 1, c: DEFAULT_COLS - 1 }); return }
      return   // c／x／v 交给 copy／cut／paste 事件
    }
    if (k === 'ArrowDown' && e.altKey && activeDv) { e.preventDefault(); openValPicker(); return }   // Alt+↓ 开下拉清单（Excel 同）
    if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0, e.shiftKey) }
    else if (k === 'ArrowDown') { e.preventDefault(); move(1, 0, e.shiftKey) }
    else if (k === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0) }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1, e.shiftKey) }
    else if (k === 'ArrowRight') { e.preventDefault(); move(0, 1, e.shiftKey) }
    else if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1) }
    else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault()
      if (selectedImage) { deleteImage(selectedImage); return }
      if (readonly) return
      // 清内容·格式保留
      const next = { ...cells }; let changed = false
      for (const [kk] of rectKeys(rect)) { const cd = next[kk]; if (!cd) continue; if (cd.v === undefined && cd.f === undefined) continue; if (cd.s) next[kk] = { s: cd.s }; else delete next[kk]; changed = true }
      if (changed) emit({ cells: next }, { label: { k: 'clear', a: rangeText(rect) } })
    }
    else if (k === 'Escape') { e.preventDefault(); setBrush(null); setSelectedImage(null); setSelEnd(null); setDrawMode(null); setFillOpts(null) }
    else if (k === 'F2') { e.preventDefault(); startEdit(activePos) }
    else if (isTypedKey(k) && !e.altKey) { e.preventDefault(); startEdit(activePos, k) }   // 没对应字的键（key＝"\u0000" 等）不起编辑
  }
  /** 编辑框里的 F4：光标所在引用切下一种绝对型（univer reference-absolute 口径） */
  const onF4 = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const text = editTextRef.current
    if (!text) return false
    const r = toggleAbsoluteAt(text, e.currentTarget.selectionStart ?? text.length)
    e.preventDefault()
    if (r) { setEditText(r.text); setRefLive(null); setCaretLater(r.caret) }
    return true
  }
  // 格内编辑框键盘（Ctrl+Z 不拦：浏览器先撤输入框文字·离开编辑再撤格子—）
  const onCellKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'F4') { onF4(e); return }
    if (e.key === 'Enter') { e.preventDefault(); void tryCommit('cell', { dr: 1, dc: 0 }) }
    else if (e.key === 'Tab') { e.preventDefault(); void tryCommit('cell', { dr: 0, dc: e.shiftKey ? -1 : 1 }) }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setRefLive(null); focusGrid() }
  }
  // 输入法组字（compositionend 后 onChange 才带整段字）⇒ 带着进编辑态
  const onKeyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = stripInvisible(e.target.value)
    e.target.value = ''
    if (!v || editing) return
    startEdit(activePos, v)
  }

  // ── 浮图定位：量目标格在滚动容器里的位置（内容／布局变了重量） ──
  //   格内图（inCell）不加偏移·另记该格（合并区＝左上格的 td·rowSpan/colSpan 已盖满）的屏上宽高 cw／ch
  const [imgPos, setImgPos] = useState<Record<string, { x: number; y: number; cw: number; ch: number }>>({})
  const measureImages = useCallback(() => {
    const g = gridRef.current; if (!g) return
    const gr = g.getBoundingClientRect()
    const out: Record<string, { x: number; y: number; cw: number; ch: number }> = {}
    for (const im of images) {
      const key = covered.get(im.cell) ?? im.cell
      const td = g.querySelector<HTMLElement>(`td[data-cell="${key}"]`)
      if (!td) continue
      const r = td.getBoundingClientRect()
      const off = im.inCell ? 0 : 1
      const ap = parseRef(key), sx = ap && ap.col < fc ? g.scrollLeft : 0, sy = ap && ap.row < fr ? g.scrollTop : 0   // 锚在冻结格（sticky）⇒ 扣回卷动量＝本来的位置
      out[im.id] = { x: r.left - gr.left + g.scrollLeft - sx + off * (im.ox ?? 0) * zoom, y: r.top - gr.top + g.scrollTop - sy + off * (im.oy ?? 0) * zoom, cw: r.width, ch: r.height }
    }
    setImgPos(out)
  }, [images, covered, zoom, fr, fc])
  useLayoutEffect(() => { measureImages() }, [measureImages, content, zoom])   // zoom 变了格位也变 ⇒ 重量
  useEffect(() => { window.addEventListener('resize', measureImages); return () => window.removeEventListener('resize', measureImages) }, [measureImages])

  /** 格子上按右键：底下有格内图／下层图 ⇒ 选它＋开图片选单（格内图在上·下层由顶到底找）；没有 ⇒ 浏览器原选单 */
  const onGridContextMenu = (e: ReactMouseEvent) => {
    if (readonly || editing) return
    if (!(e.target as HTMLElement).closest?.('td[data-cell]')) return
    const g = gridRef.current; if (!g) return
    const gr = g.getBoundingClientRect()
    const x = e.clientX - gr.left + g.scrollLeft, y = e.clientY - gr.top + g.scrollTop
    const inside = (im: SheetImage) => {
      const p = imgPos[im.id]; if (!p) return false
      const w = im.inCell ? p.cw : im.w * zoom, h = im.inCell ? p.ch : im.h * zoom
      return x >= p.x && x < p.x + w && y >= p.y && y < p.y + h
    }
    const hit = images.find(im => im.inCell && inside(im)) ?? [...images].reverse().find(im => imageLayer(im) === 'below' && inside(im))
    if (!hit) return
    e.preventDefault()
    setSelectedImage(hit.id); setImgMenu({ id: hit.id, x: e.clientX, y: e.clientY })
  }

  const [dragImg, setDragImg] = useState<{ id: string; x: number; y: number; w: number; h: number; mode: 'move' | 'resize' } | null>(null)
  const startImageDrag = (im: SheetImage, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (readonly) return
    // 真浏览器里：右键按下也进拖动 ⇒ 图层设 pointerEvents:none ⇒ 紧接的 contextmenu 落到底下格子·上层图的右键选单出不来。只认左键（主键）。
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    setSelectedImage(im.id)
    const g = gridRef.current; if (!g) return
    const pos = imgPos[im.id] ?? { x: 0, y: 0 }
    const startX = e.clientX, startY = e.clientY
    const st = { id: im.id, x: pos.x, y: pos.y, w: im.w, h: im.h, mode }
    setDragImg(st)
    const ratio = im.w / im.h
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY
      if (mode === 'move') setDragImg({ ...st, x: Math.max(0, pos.x + dx), y: Math.max(0, pos.y + dy) })
      else { const w = Math.max(16, Math.min(4000, Math.round(im.w + dx / zoom))); setDragImg({ ...st, w, h: Math.max(16, Math.round(w / ratio)) }) }
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
      const dx = ev.clientX - startX, dy = ev.clientY - startY
      setDragImg(null)
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return   // 只是点一下（选中）⇒ 不进撤销栈
      if (mode === 'resize') { const w = Math.max(16, Math.min(4000, Math.round(im.w + dx / zoom))); updateImage(im.id, { w, h: Math.max(16, Math.round(w / ratio)) }); return }
      // 落到哪格：以图左上角在滚动容器里的坐标反查（量出的几何）
      const nx = Math.max(0, pos.x + dx), ny = Math.max(0, pos.y + dy)
      const gm = geoRef.current
      let target: { key: string; left: number; top: number } | null = null
      if (gm && gm.colL.length && gm.rowT.length) {
        const c = hitIndex(gm.colL, gm.colR, nx + 1), r = hitIndex(gm.rowT, gm.rowB, ny + 1)
        const k0 = cellKey(r, c); const key = covered.get(k0) ?? k0
        const p = parseRef(key)!
        target = { key, left: gm.colL[p.col], top: gm.rowT[p.row] }
      }
      if (!target) return
      // ox／oy 存 100% 缩放口径（屏上位移 ÷ zoom）——xlsx 导出按它换 EMU；显示时再乘 zoom（measureImages）
      updateImage(im.id, { cell: target.key, ox: Math.max(0, Math.round((nx - target.left) / zoom)), oy: Math.max(0, Math.round((ny - target.top) / zoom)) })
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  const cols = useMemo(() => Array.from({ length: DEFAULT_COLS }, (_, i) => i), [])
  const rows = useMemo(() => Array.from({ length: DEFAULT_ROWS }, (_, i) => i), [])
  const mergeAt = useMemo(() => {
    const m = new Map<string, Rect>()
    for (const r of mergeRects) m.set(cellKey(r.r0, r.c0), r)
    return m
  }, [mergeRects])
  const tableWidth = useMemo(() => HEAD_W + cols.reduce((s, c) => s + colWidthOf(colWidths, c), 0), [cols, colWidths])
  const segments = useMemo(() => borderSegments(cells, mergeRects, k => covered.has(k)), [cells, mergeRects, covered])
  const cycleKeys = useMemo(() => [...values].filter(([, v]) => v === '#CYCLE!').map(([k]) => k), [values])

  // 冻结筛选验证：覆盖层另画三块冻结窗格（同一份 GridOverlay 复本·各自裁切／随卷动位移）；浮图在冻结后裁到可卷那块
  const withFrozenPanes = (el: ReactElement<OverlayProps>) => (
    <>{el}{(fr > 0 || fc > 0) && geo && <FrozenOverlayPanes box={frzBox} width={(geo.colR[geo.colR.length - 1] ?? 0) + 260} height={(geo.rowB[geo.rowB.length - 1] ?? 0) + 260} render={() => cloneElement(el, { clip: 'none' })} />}</>
  )
  const imgClip = (x: number, y: number): CSSProperties => (fr > 0 || fc > 0 ? { clipPath: `inset(max(0px, calc(var(--ov-top, 0px) - ${y}px)) 0 0 max(0px, calc(var(--ov-left, 0px) - ${x}px)))` } : {})

  // 编辑中的函数栏／格内框（同一颗 SheetFormulaInput）
  const shownBar = xref ? xref.text : editing ? editing.value : barValue
  // 借来点格时：公式栏一直拿着焦点、光标放回该在的地方（点格插完字 ⇒ 光标在插的那段尾巴）
  useEffect(() => {
    if (!xref) return
    const el = barInputRef.current
    if (el) { if (document.activeElement !== el) el.focus(); el.setSelectionRange(xref.caret, xref.caret) }
  }, [xref?.text, xref?.caret])   // eslint-disable-line react-hooks/exhaustive-deps
  const errLine = isFormulaEdit && issue ? issueText(issue) : null

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="sheet-grid-root">
      {/* 函数输入框：左＝当前格名·右＝原始内容（编辑中＝正在打的字·引用同色·语法错波浪线·函数名补全） */}
      <div className={`flex items-center gap-2 px-3 py-1.5 ${editorShell.toolbarBar} shrink-0`} data-testid="sheet-formula-bar">
        <div className="w-16 shrink-0 h-7 flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs font-mono text-gray-700" data-testid="sheet-cell-name">{activeKey}</div>
        <span className="text-gray-400 text-xs italic select-none">fx</span>
        <SheetFormulaInput
          value={shownBar}
          inputRef={barInputRef}
          readOnly={readonly || (!!editing && !xref)}
          testid="sheet-formula-input"
          highlights={highlights}
          issue={isFormulaEdit ? issue : null}
          wrapClassName={`flex-1 min-w-0 h-7 bg-white border rounded ${errLine ? 'border-red-400' : 'border-gray-200 focus-within:border-blue-400'}`}
          textClassName="px-2 text-sm font-mono text-gray-800"
          onFocus={() => { if (!xref) setBarFocus(true) }}
          onBlur={() => {
            if (xref) return
            if (commitGuard.current || carriedRef.current) return
            if (skipBarBlurRef.current) { skipBarBlurRef.current = false; setBarFocus(false); return }
            // 切走整个窗口（document 失焦）⇒ 不问也不存·回来接着编（浏览器会把焦点还给它）
            if (!document.hasFocus() && pendingBad()) return
            if (guardLeave()) return
            setBarFocus(false); setRefLive(null)
            if (!editing && !readonly && barValue !== inputFromCell(cells[activeKey])) writeCell(activeKey, barValue)
          }}
          onChange={v => {
            if (xref) { onXref?.({ t: 'type', text: v, caret: barInputRef.current?.selectionStart ?? v.length }); return }
            if (!editing) { setBarValue(v); setRefLive(null) }
          }}
          onKeyDown={e => {
            if (xref) {
              if (e.key === 'Enter') { e.preventDefault(); onXref?.({ t: 'enter' }) }
              else if (e.key === 'Escape') { e.preventDefault(); onXref?.({ t: 'esc' }) }
              return
            }
            if (e.key === 'F4') { onF4(e); return }
            if (e.key === 'Enter') { e.preventDefault(); void tryCommit('bar', { dr: 1, dc: 0 }) }
            if (e.key === 'Escape') { e.preventDefault(); setBarValue(inputFromCell(cells[activeKey])); setBarFocus(false); setRefLive(null); focusGrid() }
          }}
        />
        {uploading && <span className={`text-xs ${editorShell.hintText} shrink-0`} data-testid="sheet-image-uploading">{t('sheet_tb_image_uploading')}</span>}
        {brush && <span className={`text-xs text-blue-600 shrink-0`} data-testid="sheet-brush-hint">{t('sheet_tb_brush_hint')}</span>}
        {drawMode && <span className="text-xs text-blue-600 shrink-0" data-testid="sheet-draw-hint">{t(drawMode === 'erase' ? 'sheet_bd_erase_hint' : 'sheet_bd_draw_hint')}</span>}
        {sheetName && <span className={`text-xs ${editorShell.hintText} shrink-0 truncate max-w-[160px]`}>{t('sheet_current')}：{sheetName}</span>}
      </div>
      {/* 语法错一行红字（输入时即时）·循环引用提示条 */}
      {xref && <div className="px-3 py-1 text-xs text-blue-700 bg-blue-50 border-b border-blue-100 shrink-0" data-testid="sheet-xref-hint">{t('sheet_xref_hint').replace('{a}', xref.home)}</div>}
      {errLine && <div className="px-3 py-1 text-xs text-red-600 bg-red-50 border-b border-red-100 shrink-0" data-testid="sheet-formula-error" data-code={issue?.code}>{t('sheet_fx_err_prefix')}{errLine}</div>}
      {!errLine && cycleKeys.length > 0 && <div className="px-3 py-1 text-xs text-amber-700 bg-amber-50 border-b border-amber-100 shrink-0" data-testid="sheet-cycle-hint">{t('sheet_fx_cycle').replace('{a}', cycleKeys.slice(0, 8).join('、') + (cycleKeys.length > 8 ? '…' : ''))}</div>}

      {/* 网格 */}
      <div ref={gridRef} data-testid="sheet-grid" data-zoom={zoom} data-draw-mode={drawMode ?? undefined} onKeyDown={onZoomKey}
        className="relative isolate flex-1 min-h-0 overflow-auto outline-none bg-white select-none"   /* isolate：下层图 z-index:-1 画在本框白底之上、格子（格底色／格线）之下 */
        onContextMenu={onGridContextMenu}
        style={{ touchAction: 'pan-x pan-y', cursor: drawMode ? (drawMode === 'erase' ? 'cell' : 'crosshair') : undefined }}>
        <input ref={keyInputRef} data-testid="sheet-key-input" aria-label="grid keyboard" onKeyDown={onGridKey} onChange={onKeyInputChange}
          onCopy={e => { e.preventDefault(); const b = copyBlock(); e.clipboardData.setData('text/plain', b.text) }}
          onCut={e => { e.preventDefault(); const b = copyBlock(); e.clipboardData.setData('text/plain', b.text); if (!readonly && !lockedRef.current) clearRect(rect, { k: 'cut', a: rangeText(rect) }) }}
          onPaste={e => { e.preventDefault(); const text = e.clipboardData.getData('text/plain'); if (text) pasteText(text) }}
          className="absolute left-0 top-0 w-px h-px opacity-0 pointer-events-none" tabIndex={0} autoComplete="off" />
        {/* 下层图：z -1＝在格子之下·格子没底色处透出来·格线照画；
            不接滑鼠（点格子仍是选格·选它走右键）；数组顺序＝层次（后画的在上） */}
        {images.map(im => {
          if (imageLayer(im) !== 'below') return null
          const d = dragImg?.id === im.id ? dragImg : null
          const p = d ? { x: d.x, y: d.y } : imgPos[im.id]
          if (!p) return null
          const w = d ? d.w : im.w, h = d ? d.h : im.h
          return (
            <div key={im.id} data-testid="sheet-image-below" data-image-id={im.id} data-image-cell={im.cell} className="absolute pointer-events-none"
              style={{ left: p.x, top: p.y, width: w * zoom, height: h * zoom, zIndex: -1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc(im.url)} alt="" draggable={false} className="w-full h-full object-fill select-none" onError={e => { host.onImageError?.(e.currentTarget) }} />
            </div>
          )
        })}
        {/* 缩放走 CSS zoom（行高／列宽／字号／边线等比·且卷动范围跟着变）·⛔ 不用 transform: scale（scale 不改布局尺寸·卷到底会露白／被裁） */}
        <table ref={tableRef} data-testid="sheet-table" className="border-collapse table-fixed text-[13px] leading-tight" style={{ width: tableWidth, zoom }} data-brush={brush ? 'on' : undefined}>
          <colgroup>
            <col style={{ width: HEAD_W }} />
            {cols.map(c => <col key={c} style={{ width: colWidthOf(colWidths, c) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 h-7 bg-gray-50 border border-gray-200 cursor-cell" data-testid="sheet-select-all" title={t('sheet_select_all')}
                onMouseDown={e => { e.preventDefault(); const all = () => { setSel({ r: 0, c: 0 }); setSelEnd({ r: DEFAULT_ROWS - 1, c: DEFAULT_COLS - 1 }); focusGrid() }; if (guardLeave(all)) return; if (editing) commitEdit(); all() }} />
              {cols.map(c => {
                const letter = indexToCol(c)
                return (
                  <th key={c} data-col={c} data-testid={`sheet-col-head-${letter}`} onMouseDown={startHeaderSelect('col', c)} style={frozenStyle('colHead', 0, c, fr, fc, geo, zoom, sizesForFreeze) ?? undefined}
                    className={`relative h-7 border border-gray-200 text-[11px] font-medium cursor-pointer ${c >= rect.c0 && c <= rect.c1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-500'}`}>
                    {letter}
                    {!readonly && c > 0 && <div className="absolute top-0 -left-[3px] w-[6px] h-full cursor-col-resize z-[1] hover:bg-blue-400/50" title={t('sheet_col_resize')}
                      onMouseDown={startResize('col', c - 1)} onDoubleClick={autofit('col', c - 1)} />}
                    {!readonly && <div data-testid={`sheet-col-resize-${letter}`} className="absolute top-0 -right-[3px] w-[6px] h-full cursor-col-resize z-[1] hover:bg-blue-400/50" title={t('sheet_col_resize')}
                      onMouseDown={startResize('col', c)} onDoubleClick={autofit('col', c)} />}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const h = rowHeightOf(rowHeights, r)
              const fixedH = hasRowHeight(rowHeights, r)
              return (
                <tr key={r} style={{ height: h, ...(hiddenRows.has(r) ? { display: 'none' } : {}) }} data-filtered={hiddenRows.has(r) ? '1' : undefined}>
                  <th data-row={r} data-testid={`sheet-row-head-${r + 1}`} onMouseDown={startHeaderSelect('row', r)} style={{ height: h, ...frozenStyle('rowHead', r, 0, fr, fc, geo, zoom, sizesForFreeze) }}
                    className={`sticky left-0 z-10 border border-gray-200 text-[11px] font-medium cursor-pointer ${r >= rect.r0 && r <= rect.r1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-500'}`}>
                    {r + 1}
                    {!readonly && r > 0 && <div className="absolute left-0 -top-[3px] h-[6px] w-full cursor-row-resize z-[1] hover:bg-blue-400/50" title={t('sheet_row_resize')}
                      onMouseDown={startResize('row', r - 1)} onDoubleClick={autofit('row', r - 1)} />}
                    {!readonly && <div data-testid={`sheet-row-resize-${r + 1}`} className="absolute left-0 -bottom-[3px] h-[6px] w-full cursor-row-resize z-[1] hover:bg-blue-400/50" title={t('sheet_row_resize')}
                      onMouseDown={startResize('row', r)} onDoubleClick={autofit('row', r)} />}
                  </th>
                  {cols.map(c => {
                    const key = cellKey(r, c)
                    if (covered.has(key)) return null   // 合并区里被盖住的格不画（左上格 rowSpan/colSpan 盖过来）
                    const m = mergeAt.get(key)
                    const isActive = r === activePos.r && c === activePos.c
                    const inRange = rectContains(rect, r, c)
                    const isEdit = !!editing && editing.pos.r === r && editing.pos.c === c
                    const shown = display(key)
                    const val = values.get(key)
                    const err = isFormulaError(val)
                    const num = typeof val === 'number'
                    const cd = cells[key]
                    const css = cellStyleCss(cd?.s, num)
                    Object.assign(css, condCellCss(condFmt.at(r, c), cd?.s))   // 条件格式：命中的格式叠上去（不改存的格样式）
                    if (inRange && !isActive) css.boxShadow = 'inset 0 0 0 200px rgba(59,130,246,0.12)'
                    // 冻结筛选验证：冻结格 sticky（垫白底）·筛选表头留出钮的位置
                    const fz = frozenStyle('cell', r, c, fr, fc, geo, zoom, sizesForFreeze)
                    if (fz) { const selShade = css.boxShadow; Object.assign(css, fz); if (selShade) css.boxShadow = `${fz.boxShadow}, ${selShade}`; if (!css.backgroundColor) css.backgroundColor = '#fff'; if (isEdit) css.zIndex = 40 }
                    const fltHead = !!fRect && r === fRect.r0 && c >= fRect.c0 && c <= fRect.c1
                    if (fltHead) css.paddingRight = 20
                    const showPick = isActive && !isEdit && !!activeDv && !readonly && !locked
                    if (showPick) css.paddingRight = 20
                    const clip: CSSProperties | undefined = fixedH && !isEdit ? { maxHeight: h - 1, overflow: 'hidden' } : undefined
                    return (
                      <td key={c} data-cell={key} rowSpan={m ? m.r1 - m.r0 + 1 : undefined} colSpan={m ? m.c1 - m.c0 + 1 : undefined}
                        onMouseDown={e => onCellMouseDown(e, r, c, isEdit)}
                        onMouseEnter={() => { if (draggingRef.current) setSelEnd({ r, c }) }}
                        onDoubleClick={() => { if (!drawMode) startEdit({ r, c }) }}
                        style={css}
                        className={`relative border border-gray-200 px-1.5 align-bottom ${isEdit ? 'overflow-visible z-[40]' : 'overflow-hidden'} ${cd?.s?.wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'} ${isActive && !isEdit ? 'outline outline-2 outline-blue-500 -outline-offset-1 z-[5]' : ''} ${err ? 'text-red-600' : (cd?.s?.fg ? '' : 'text-gray-800')} ${num && !cd?.s?.font ? 'font-mono' : ''}`}
                        title={err ? t((ERR_TIP[val as string] ?? 'sheet_err_error') as 'sheet_err_error') : undefined}
                        data-error={err ? (val as string) : undefined}>
                        {err && !isEdit && <span aria-hidden data-testid="sheet-error-mark" className="absolute left-0 top-0 w-0 h-0 pointer-events-none" style={{ borderTop: `6px solid ${ERROR_MARK}`, borderRight: '6px solid transparent' }} />}
                        {fltHead && !isEdit && (() => { const on = !!view?.filter?.criteria?.[indexToCol(c)]; return (   // 表头筛选钮（已筛的那列亮蓝＋漏斗）
                          <button type="button" data-testid={`sheet-filter-btn-${indexToCol(c)}`} data-active={on ? '1' : undefined} title={t('sheet_flt_btn').replace('{a}', indexToCol(c))}
                            onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                            onClick={e => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); setFilterMenu(m => (m?.col === c ? null : { col: c, x: b.left, y: b.bottom + 2 })) }}
                            className={`absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-sm border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100'}`}>
                            {on ? <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8.5V20l-4 1.5v-9z" /></svg>
                              : <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}><path d="m5 8 5 5 5-5" /></svg>}
                          </button>) })()}
                        {showPick && (   // 下拉清单格选中 ⇒ 右侧小箭头（Alt+↓ 同）
                          <button type="button" data-testid="sheet-validation-arrow" title={t('sheet_val_pick')} onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                            onClick={e => { e.stopPropagation(); if (valPicker) setValPicker(null); else openValPicker() }}
                            className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-sm border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 z-[1]">
                            <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}><path d="m5 8 5 5 5-5" /></svg>
                          </button>
                        )}
                        {isEdit ? (
                          <SheetFormulaInput
                            value={editing!.value}
                            inputRef={cellInputRef}
                            testid="sheet-cell-input"
                            highlights={highlights}
                            issue={isFormulaEdit ? issue : null}
                            wrapClassName="w-full h-full min-h-[26px] bg-white outline outline-2 outline-blue-500 -outline-offset-1"
                            textClassName="font-mono text-[13px] text-gray-800"
                            onChange={v => { setEditing(ed => (ed ? { ...ed, value: v } : ed)); setRefLive(null) }}
                            onKeyDown={onCellKey}
                            onBlur={() => { if (commitGuard.current || carriedRef.current) return; if (!document.hasFocus() && pendingBad()) return; if (guardLeave()) return; commitEdit() }}
                          />
                        ) : (
                          cd?.s?.numFmt?.t === 'accounting' && num && !err ? (() => {   // 会计专用：符号靠左·数字靠右
                            const p = accountingParts(val as number, cd.s.numFmt.d ?? 2, cd.s.numFmt.k !== false, cd.s.numFmt.c ?? CURRENCY_SYMBOL)
                            return <span className="flex justify-between gap-2" data-numfmt="accounting" style={clip}><span>{p.sym}</span><span>{p.body}</span></span>
                          })() : (
                          <span className={cd?.s?.wrap ? 'block' : 'truncate block'} style={clip}>{shown}</span>)
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* 覆盖层：框线／选区框／填充柄／各种预览／引用框（位置全按量出的几何） */}
        {geo && (
          withFrozenPanes(<GridOverlay geo={geo} segments={segments}
            selRect={rect} showSelBox={!editing && (rect.r1 > rect.r0 || rect.c1 > rect.c0)}
            showHandle={!readonly && !locked && !editing && !drawMode && !barFocus && !selectedImage}   /* 罩期不出填充把手 */
            fillPreview={fillPreview} resizing={resizing} drawDrag={drawDrag} drawMode={drawMode} pen={pen}
            refBoxes={isFormulaEdit ? highlights : []}
            fillOpts={fillOpts && !readonly ? { rect: fillUnion(fillOpts.plan), type: fillOpts.type, seriesDisabled: fillOpts.seriesDisabled, menu: fillOpts.menu } : null}
            onFillDown={startFill} onFillDbl={dblFill}
            onFillOptsToggle={() => setFillOpts(o => (o ? { ...o, menu: !o.menu } : o))}
            onRefill={type => refill(type)}
          />)
        )}

        {/* 浮图层（随表格滚动·位置由目标格量出）：上层图 z-15（在表头 z-10/20 之下）·格内图 z-3（盖在格上·点了仍是选格）·
            下层图在 table 前面另画（z -1）。选中的下层／格内图另画一个框（z-15）给拖动、缩放、删除。 */}
        {images.map(im => {
          const layer = imageLayer(im)
          const d = dragImg?.id === im.id ? dragImg : null
          const p0 = imgPos[im.id]
          const p = d ? { x: d.x, y: d.y } : p0
          if (!p) return null
          const selected = selectedImage === im.id
          const cellImg = layer === 'cell' ? (
            <div key={`${im.id}-cell`} data-testid="sheet-image-incell" data-image-id={im.id} data-image-cell={im.cell} className="absolute z-[3] pointer-events-none overflow-hidden"
              style={{ left: p.x + 1, top: p.y + 1, width: Math.max(0, (p0?.cw ?? 0) - 2), height: Math.max(0, (p0?.ch ?? 0) - 2), ...imgClip(p.x + 1, p.y + 1) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc(im.url)} alt="" draggable={false} className="w-full h-full object-contain select-none" onError={e => { host.onImageError?.(e.currentTarget) }} />
            </div>
          ) : null
          if (layer !== 'above' && !selected) return cellImg
          const box = layer === 'cell' && p0 ? { w: p0.cw / zoom, h: p0.ch / zoom } : { w: d ? d.w : im.w, h: d ? d.h : im.h }
          const movable = !readonly && layer !== 'cell'
          return (<Fragment key={im.id}>{cellImg}
            <div data-testid={layer === 'above' ? 'sheet-image' : 'sheet-image-selected-frame'} data-image-id={im.id} data-image-cell={im.cell} data-image-plane={layer}
              className={`absolute z-[15] ${selected ? 'ring-2 ring-blue-500' : 'ring-1 ring-transparent hover:ring-blue-300'}`}
              style={{ left: p.x, top: p.y, width: box.w * zoom, height: box.h * zoom, cursor: movable ? 'move' : 'default', pointerEvents: d ? 'none' : 'auto', ...imgClip(p.x, p.y) }}   // 浮图层在 table 外·尺寸自己乘 zoom（位置从真格位量·已含 zoom）
              onPointerDown={movable ? startImageDrag(im, 'move') : undefined}
              onClick={e => { e.stopPropagation(); setSelectedImage(im.id); focusGrid() }}
              onContextMenu={e => { if (readonly) return; e.preventDefault(); e.stopPropagation(); setSelectedImage(im.id); setImgMenu({ id: im.id, x: e.clientX, y: e.clientY }) }}>
              {/* 上层图本体就画在这里；下层／格内图本体在别处（这里只是选中框·半透明垫一层看得出选的是哪张） */}
              {layer === 'above'
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imgSrc(im.url)} alt="" draggable={false} className="w-full h-full object-fill select-none" onError={e => { host.onImageError?.(e.currentTarget) }} />
                : <div className="w-full h-full bg-blue-400/10" />}
              {selected && !readonly && (
                <>
                  <button type="button" title={t('sheet_img_delete')} data-testid="sheet-image-delete"
                    onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); deleteImage(im.id) }}
                    className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-600 text-xs leading-none flex items-center justify-center shadow hover:bg-red-50 hover:text-red-600">×</button>
                  {movable && <div data-testid="sheet-image-resize" onPointerDown={startImageDrag(im, 'resize')}
                    className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-500 border border-white rounded-sm cursor-nwse-resize" />}
                </>
              )}
            </div>
          </Fragment>)
        })}
        {/* 图表层：跟上层图同一层（z-15）·画在图片之后＝在上；拖动／缩放／右键／面板都在 ChartLayer 里 */}
        <ChartLayer ref={chartLayerRef} charts={charts} content={content} evalOpts={evalOpts} geo={geo} zoom={zoom} readonly={readonly} locked={locked}
          onCharts={(next, label) => emit({ charts: next }, { label: { k: label } })} />
      </div>
      {/* 图片右键选单·⛔ 图层视窗 */}
      {imgMenu && (() => {
        const im = images.find(i => i.id === imgMenu.id)
        if (!im || readonly) return null
        const layer = imageLayer(im)
        const item = (id: string, label: string, run: () => void, disabled = false) => (
          <button key={id} type="button" data-testid={`sheet-image-menu-${id}`} disabled={disabled}
            onMouseDown={e => e.preventDefault()} onClick={() => { setImgMenu(null); if (!disabled) run() }}
            className={`${editorShell.menuItem} ${disabled ? 'opacity-40 cursor-default' : ''}`}>{label}</button>
        )
        const left = Math.max(4, Math.min(imgMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 196))
        const top = Math.max(4, Math.min(imgMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 300))
        return (
          <div ref={imgMenuRef} data-testid="sheet-image-menu" role="menu" className={`fixed z-[60] w-[188px] ${editorShell.menu}`} style={{ left, top }}
            onContextMenu={e => e.preventDefault()}>
            {layer !== 'cell' && (['up', 'down', 'top', 'bottom'] as const).map(m => item(`z-${m}`, t(`sheet_img_z_${m}` as TKey), () => applyImages(moveImageZ(images, im.id, m), 'image_layer'), !canMoveImageZ(images, im.id, m)))}
            {layer !== 'cell' && <div className="my-1 border-t border-gray-100" />}
            {layer !== 'below' && item('below', t('sheet_img_to_below'), () => applyImages(setImagePlane(images, im.id, 'below'), 'image_layer'))}
            {layer !== 'above' && item('above', t('sheet_img_to_above'), () => applyImages(setImagePlane(images, im.id, 'above'), 'image_layer'))}
            {layer !== 'cell' && item('incell', t('sheet_img_in_cell'), () => applyImages(putImageInCell(images, im.id), 'image_layer'))}
            <div className="my-1 border-t border-gray-100" />
            {item('delete', t('sheet_img_delete'), () => deleteImage(im.id))}
          </div>
        )
      })()}
      {/* 冻结筛选验证：表头筛选选单／下拉清单设定面板／下拉清单挑值 */}
      {filterMenu && fRect && (
        <SheetFilterMenu key={filterMenu.col} anchor={filterMenu} column={indexToCol(filterMenu.col)} readonly={readonly || locked}
          values={filterColumnValues(view, filterMenu.col, viewReader)} current={view?.filter?.criteria?.[indexToCol(filterMenu.col)]}
          onApply={c => { applyFilterCriterion(filterMenu.col, c); setFilterMenu(null); focusGrid() }}
          onSort={desc => { sortFilterColumn(filterMenu.col, desc); setFilterMenu(null); focusGrid() }}
          onClose={() => setFilterMenu(null)} />
      )}
      {valPanel && !readonly && (
        <ValidationPanel range={rangeText(valPanel)} initial={validationAt(view, valPanel.r0, valPanel.c0)}
          onApply={(list, o) => { emit({ validations: putValidation(view?.validations, valPanel, { type: 'list', list, ...(o.allowBlank ? {} : { allowBlank: false }), ...(o.showError ? {} : { showError: false }) }) }, { label: { k: 'validation', a: rangeText(valPanel) } }); setValPanel(null); focusGrid() }}
          onRemove={() => { const next = clearValidations(view?.validations, valPanel); emit({ validations: next.length ? next : undefined }, { label: { k: 'validation', a: rangeText(valPanel) } }); setValPanel(null); focusGrid() }}
          onClose={() => { setValPanel(null); focusGrid() }} />
      )}
      {valPicker && activeDv && (
        <ValidationPicker anchor={valPicker} options={validationOptions(view, activeDv, viewReader)} current={display(activeKey)}
          onPick={v => { setValPicker(null); writeCell(activeKey, v); focusGrid() }}
          onClose={() => setValPicker(null)} />
      )}
    </div>
  )
})

// ═════════════ 覆盖层 ═════════════
type OverlayProps = {
  geo: Geo
  segments: BorderSegment[]
  selRect: Rect
  showSelBox: boolean
  showHandle: boolean
  fillPreview: { rect: Rect; shrink: boolean } | null
  resizing: { axis: 'col' | 'row'; index: number; edge: number; delta: number; size: number } | null
  drawDrag: Rect | null
  drawMode: DrawMode | null
  pen: BorderPen
  refBoxes: { start: number; rect: Rect; color: string; text: string }[]
  fillOpts: { rect: Rect; type: FillType; seriesDisabled: boolean; menu: boolean } | null
  onFillDown: (e: ReactMouseEvent) => void
  onFillDbl: (e: ReactMouseEvent) => void
  onFillOptsToggle: () => void
  onRefill: (t: FillType) => void
  /** 冻结窗格：外层窗格自己裁 ⇒ 'none' 关掉本层的主层裁切 */
  clip?: string
}
const GridOverlay = memo(function GridOverlay({ geo, segments, selRect, showSelBox, showHandle, fillPreview, resizing, drawDrag, drawMode, pen, refBoxes, fillOpts, onFillDown, onFillDbl, onFillOptsToggle, onRefill, clip }: OverlayProps) {
  const t = useSheetT()
  const nR = geo.rowT.length, nC = geo.colL.length
  const box = (r: Rect) => {
    const r0 = Math.max(0, Math.min(nR - 1, r.r0)), r1 = Math.max(0, Math.min(nR - 1, r.r1)), c0 = Math.max(0, Math.min(nC - 1, r.c0)), c1 = Math.max(0, Math.min(nC - 1, r.c1))
    return { left: geo.colL[c0], top: geo.rowT[r0], width: geo.colR[c1] - geo.colL[c0], height: geo.rowB[r1] - geo.rowT[r0] }
  }
  const lines: ReactNode[] = []
  for (const s of segments) {
    const w = lineWidth(s.line.style)
    const border = `${w}px ${cssLineStyle(s.line.style)} ${s.line.color || BORDER_DEFAULT_COLOR}`
    if (s.dir === 'h') {
      if (s.c >= nC) continue
      const y = s.r >= nR ? geo.rowB[nR - 1] : geo.rowT[s.r]
      const x1 = geo.colL[s.c], x2 = geo.colR[s.c]
      lines.push(<div key={s.key} data-bd={s.key} data-bd-style={s.line.style} className="absolute" style={{ left: x1 - (w > 1 ? 1 : 0), top: Math.round(y - w / 2), width: x2 - x1 + (w > 1 ? 2 : 0), height: 0, borderTop: border }} />)
    } else {
      if (s.r >= nR) continue
      const x = s.c >= nC ? geo.colR[nC - 1] : geo.colL[s.c]
      const y1 = geo.rowT[s.r], y2 = geo.rowB[s.r]
      lines.push(<div key={s.key} data-bd={s.key} data-bd-style={s.line.style} className="absolute" style={{ left: Math.round(x - w / 2), top: y1 - (w > 1 ? 1 : 0), width: 0, height: y2 - y1 + (w > 1 ? 2 : 0), borderLeft: border }} />)
    }
  }
  const sb = box(selRect)
  const handleX = sb.left + sb.width, handleY = sb.top + sb.height
  const pickOpen = fillOpts?.menu ?? false
  // 两层（都裁掉冻结表头那一条）：框线层 z-4（在活动格外框 z-5 之下）·互动预览层 z-9（在表头 z-10／20 之下）
  const layer: CSSProperties = { left: 0, top: 0, width: (geo.colR[nC - 1] ?? 0) + 260, height: (geo.rowB[nR - 1] ?? 0) + 260, clipPath: clip ?? 'inset(var(--ov-top, 0px) 0 0 var(--ov-left, 0px))' }
  return (
    <>
      <div className="absolute pointer-events-none z-[4]" style={layer} data-testid="sheet-border-layer">{lines}</div>
      <div className="absolute pointer-events-none z-[9]" style={layer}>
      {showSelBox && <div className="absolute pointer-events-none z-[6] border-2 border-blue-500" data-testid="sheet-sel-box" style={{ left: sb.left - 1, top: sb.top - 1, width: sb.width + 2, height: sb.height + 2 }} />}
      {showHandle && (
        <div data-testid="sheet-fill-handle" title={t('sheet_fill_handle')} onMouseDown={onFillDown} onDoubleClick={onFillDbl}
          className="absolute z-[7] w-[7px] h-[7px] bg-blue-500 border border-white cursor-crosshair pointer-events-auto" style={{ left: handleX - 4, top: handleY - 4 }} />
      )}
      {fillPreview && (() => { const b = box(fillPreview.rect); return (
        <div data-testid="sheet-fill-preview" className={`absolute pointer-events-none z-[9] border-2 border-dashed ${fillPreview.shrink ? 'border-gray-400 bg-gray-400/20' : 'border-gray-500'}`} style={{ left: b.left - 1, top: b.top - 1, width: b.width + 2, height: b.height + 2 }} />
      ) })()}
      {drawDrag && (() => { const b = box(drawDrag); return (
        <div data-testid="sheet-draw-preview" className="absolute pointer-events-none z-[9]" style={{ left: b.left - 1, top: b.top - 1, width: b.width + 2, height: b.height + 2, border: `2px dashed ${drawMode === 'erase' ? '#9ca3af' : (pen.color || BORDER_DEFAULT_COLOR)}` }} />
      ) })()}
      {refBoxes.map((h, i) => { const b = box(h.rect); return (
        <div key={`${h.start}-${i}`} data-testid="sheet-ref-box" data-ref={h.text} data-color={h.color} className="absolute pointer-events-none z-[9]"
          style={{ left: b.left - 1, top: b.top - 1, width: b.width + 2, height: b.height + 2, border: `2px dashed ${h.color}`, backgroundColor: `${h.color}14` }} />
      ) })}
      {resizing && (() => {
        const pos = resizing.edge + resizing.delta
        return resizing.axis === 'col'
          ? <><div data-testid="sheet-resize-line" className="absolute pointer-events-none z-[25] border-l-2 border-dashed border-blue-500" style={{ left: pos - 1, top: 0, height: geo.rowB[nR - 1] }} />
              <div className="absolute pointer-events-none z-[26] px-1.5 py-0.5 rounded bg-gray-800 text-white text-[11px]" style={{ left: pos + 6, top: geo.rowT[0] + 2 }}>{t('sheet_size_px').replace('{a}', String(resizing.size))}</div></>
          : <><div data-testid="sheet-resize-line" className="absolute pointer-events-none z-[25] border-t-2 border-dashed border-blue-500" style={{ top: pos - 1, left: 0, width: geo.colR[nC - 1] }} />
              <div className="absolute pointer-events-none z-[26] px-1.5 py-0.5 rounded bg-gray-800 text-white text-[11px]" style={{ top: pos + 6, left: geo.colL[0] + 2 }}>{t('sheet_size_px').replace('{a}', String(resizing.size))}</div></>
      })()}
      {fillOpts && (() => { const b = box(fillOpts.rect); return (
        <div className="absolute z-[30] pointer-events-auto" style={{ left: b.left + b.width + 2, top: b.top + b.height + 2 }}>
          <button type="button" data-testid="sheet-fill-options" title={t('sheet_fill_opts')} onMouseDown={e => e.preventDefault()} onClick={onFillOptsToggle}
            className="w-6 h-5 flex items-center justify-center rounded border border-gray-300 bg-white shadow-sm text-gray-600 hover:bg-gray-50">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}><rect x="2" y="2" width="8" height="8" /><path d="M6 12h8M12 6v8" /></svg>
            <svg className="w-2 h-2" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}><path d="m5 8 5 5 5-5" /></svg>
          </button>
          {pickOpen && (
            <div data-testid="sheet-fill-options-menu" role="radiogroup" className={`absolute left-0 top-full mt-1 ${editorShell.menu} p-1 w-[200px]`}>
              {FILL_TYPES.map(k => {
                const dis = k === 'series' && fillOpts.seriesDisabled
                return (
                  <button key={k} type="button" role="radio" aria-checked={fillOpts.type === k} disabled={dis} data-testid={`sheet-fill-opt-${k}`}
                    onMouseDown={e => e.preventDefault()} onClick={() => onRefill(k)}
                    className={`${editorShell.menuItem} w-full flex items-center gap-2 px-2 py-1.5 text-left ${dis ? 'opacity-40 cursor-default' : ''}`}>
                    <span className={`w-3 h-3 rounded-full border ${fillOpts.type === k ? 'border-blue-600 bg-blue-600 shadow-[inset_0_0_0_2px_white]' : 'border-gray-400'}`} />
                    <span className="text-[13px] text-gray-700">{t(`sheet_fill_${k}` as 'sheet_fill_copy')}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) })()}
      </div>
    </>
  )
})

export default SheetGrid
