'use client'
// 表格页工具栏
//   四组照图顺序：①格式刷／貼上／剪下／複製 ②字体／字号／A＋A－｜B I U 刪除線／邊框／填滿色／字體色／清除格式
//   ③垂直对齐三钮／水平对齐三钮／縮排減增／自動換行／合併 ④數字格式下拉／貨幣／%／千分位／小數增減 ＋ 插入圖片。
//   下拉＝自绘弹层 11 种（WPS 顺序）·每项图标＋名＋副标；「转换」不做。
//   字体／字号／数字格式三颗下拉的箭头同一颗（ToolbarChevron.tsx·appearance-none＋自绘 chevron·同款同高）。
//   每颗钮只发 ToolbarCommand·真动作在 SheetGrid（作用于当前选区）；「转换」钮略过。
//   不放文档专属钮（正文／標1／標2／標3／清單／引用／程式碼／分隔線）。
//   ⛔ 最左「‹」收左栏那颗不在本组件里。
//   边框钮改成 WPS 整套下拉＋其他边框对话框（SheetBorderMenu.tsx）；
//     最左加「復原／重做」两颗图标钮（不可用时灰）＋⌄ 下拉列最近 20 步（点某一步＝一次撤到那里）。
//   冻结筛选验证那组后面接资料两颗：移除重複・尋找與取代（放大镜·Ctrl／⌘+F 同）。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { palette } from '../../shared/theme/color-palette'
import { SIZE_OPTIONS, DEFAULT_SIZE, NUMFMT_KINDS, CURRENCY_SYMBOLS, CURRENCY_SYMBOL, regionCurrencySymbol, type CellStyle, type NumFmtKind, type HAlign, type VAlign, type CurrencySymbol } from '../engine/style'
import { useSheetHost } from './host'
import FontFamilyDropdown from '../../shared/components/FontFamilyDropdown'
import { SelectWithChevron, ToolbarChevron } from '../../shared/components/ToolbarChevron'
import { BorderMenu, BorderDialog, type DrawMode } from './SheetBorderMenu'
import type { BorderEdges, BorderKind, BorderLine, BorderPen } from '../engine/border'
import SheetCondFormatMenu, { type CondUiAction } from './SheetCondFormatMenu'   // 条件格式
import type { CondRule } from '../engine/cond-format'
import SheetViewToolbar, { type ViewCommand, type ViewSelState } from './SheetViewToolbar' // 冻结筛选验证

export type ToolbarCommand =
  | { t: 'brush' } | { t: 'paste' } | { t: 'cut' } | { t: 'copy' }
  | { t: 'style'; patch: Partial<CellStyle> }
  | { t: 'toggle'; key: 'b' | 'i' | 'u' | 's' | 'wrap' }
  | { t: 'sizeStep'; delta: 1 | -1 }
  | { t: 'border'; kind: BorderKind }
  | { t: 'borderEdges'; edges: BorderEdges }
  | { t: 'drawMode'; mode: DrawMode | null }
  | { t: 'pen'; pen: Partial<BorderPen> }
  | { t: 'clearFormat' }
  | { t: 'indent'; delta: 1 | -1 }
  | { t: 'merge' }
  | { t: 'numFmt'; kind: NumFmtKind }
  | { t: 'numAction'; action: 'currency' | 'percent' | 'thousands' | 'dec+' | 'dec-' }
  | { t: 'currencySymbol'; sym: CurrencySymbol }
  | { t: 'insertImage'; file: File }
  | { t: 'insertChart' }   // 图表
  | { t: 'condFormat'; action: CondUiAction }   // 条件格式
  | ViewCommand   // 冻结筛选验证：凍結／篩選／下拉選單
  | { t: 'find'; mode: 'find' | 'replace' }   // 尋找與取代（小浮窗在 SheetFindDialog）
  | { t: 'dedupe' }   // 移除重複（对话框在 SheetDedupeDialog）

/** 网格回报给工具栏的当前选区状态（钮的按下态／合并钮字样由它定） */
export type SelectionState = {
  style: CellStyle | undefined
  merge: 'merged' | 'mergeable' | 'single'
  brush: boolean
  /** 画框线的笔（线型＋颜色）·绘图边框模式 */
  pen: BorderPen
  drawMode: DrawMode | null
  /** 选区现有的六组边（其他边框对话框的起始勾选） */
  edges: Record<keyof BorderEdges, BorderLine | null>
  /** 条件格式：跟选区有交集的规则（小面板列出来可删） */
  cond?: CondRule[]
  /** 冻结筛选验证：冻结行列数／有没有筛选区／活动格有没有下拉清单 */
  view?: ViewSelState
}
const NO_EDGES: Record<keyof BorderEdges, BorderLine | null> = { top: null, bottom: null, left: null, right: null, insideH: null, insideV: null }
export const EMPTY_SELECTION_STATE: SelectionState = { style: undefined, merge: 'single', brush: false, pen: { style: 'thin' }, drawMode: null, edges: NO_EDGES }

/** 撤销栈给工具栏看的（能不能撤／重做·最近 20 步的字） */
export type HistoryView = { canUndo: boolean; canRedo: boolean; recent: { id: number; label: string }[] }
type Props = {
  state: SelectionState; readonly?: boolean; onCommand: (cmd: ToolbarCommand) => void
  history: HistoryView; historyDisabled?: boolean; onUndo: (steps?: number) => void; onRedo: () => void
}

/** 数字格式 11 种的图标（照现行做法＝内联 SVG 线稿·与工具栏其它钮同一套笔画） */
const NUMFMT_ICON: Record<NumFmtKind, ReactNode> = {
  general: <path d="M4 6h16M4 12h16M4 18h10" />,
  number: <><path d="M5 9h14M5 15h14" /><path d="M10 4 8 20M16 4l-2 16" /></>,
  currency: <><path d="M12 3v18" /><path d="M16.5 7.5A3.5 3.5 0 0 0 13 5h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a3.5 3.5 0 0 1-3.5-2.5" /></>,
  accounting: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h5M8 16h8" /></>,
  date: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  longdate: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M7 14h3M12 14h5M7 17h6" /></>,
  rocdate: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M8 13.5h8M12 13.5v5M9 18.5h6" /></>,
  time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  percent: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></>,
  fraction: <><path d="M17 5 7 19" /><path d="M5 8h4M15 16h4" /></>,
  scientific: <><path d="M4 18 9 6l5 12" /><path d="M6 14h6" /><path d="M16 9h4M18 7v4" /></>,
  text: <><path d="M5 6h14M12 6v13M8 19h8" /></>,
}
function NumFmtIcon({ kind, className = 'w-4 h-4' }: { kind: NumFmtKind; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{NUMFMT_ICON[kind]}</svg>
}

/** 数字格式下拉：钮＝现格式图标＋名·弹层＝12 项（图标／名／副标·民國紀年只台版列）·选中打勾；底下一排「貨幣符號」$ € ¥ NT$ */
function NumFmtMenu({ value, currency, disabled, onPick, onSymbol }: { value: NumFmtKind; currency: CurrencySymbol | undefined; disabled: boolean; onPick: (k: NumFmtKind) => void; onSymbol: (s: CurrencySymbol) => void }) {
  const t = useSheetT()
  const isCn = useSheetHost().region === 'cn'
  const [open, setOpen] = useState(false)
  // 民國紀年：台版才列（陆版不列·已存的照样显示）
  const kinds = isCn ? NUMFMT_KINDS.filter(k => k !== 'rocdate') : NUMFMT_KINDS
  // 现格是货币／会计专用 ⇒ 亮它的符号（没存符号的旧格＝$）；别的格 ⇒ 不亮
  const curSym: CurrencySymbol | null = value === 'currency' || value === 'accounting' ? (currency ?? CURRENCY_SYMBOL) : null
  const label = (k: NumFmtKind) => t(`sheet_nf_${k}` as 'sheet_nf_general')
  const sub = (k: NumFmtKind) => t(`sheet_nf_${k}_sub` as 'sheet_nf_general_sub')
  return (
    <div className="relative">
      <button type="button" title={t('sheet_tb_numfmt')} aria-label={t('sheet_tb_numfmt')} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        data-testid="tb-numfmt" data-value={value}
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(v => !v)}
        className={`h-7 w-[104px] flex items-center gap-1 pl-1.5 pr-6 border border-gray-200 rounded bg-white text-xs text-gray-700 hover:bg-gray-100 ${disabled ? 'opacity-40 cursor-default' : ''}`}>
        <NumFmtIcon kind={value} className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{label(value)}</span>
      </button>
      <ToolbarChevron />
      <Popover open={open} onClose={() => setOpen(false)} testid="tb-numfmt-menu">
        <ul role="listbox" aria-label={t('sheet_tb_numfmt')} className="w-[232px] max-h-[70vh] overflow-y-auto">
          {kinds.map(k => (
            <li key={k} role="option" aria-selected={k === value}>
              <button type="button" data-testid={`tb-numfmt-opt-${k}`} onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(k); setOpen(false) }}
                className={`${editorShell.menuItem} w-full flex items-center gap-2 px-2 py-1.5 text-left ${k === value ? 'bg-gray-100' : ''}`}>
                <span className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-600 shrink-0"><NumFmtIcon kind={k} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-gray-800 leading-tight">{label(k)}</span>
                  <span className="block text-[11px] text-gray-500 leading-tight truncate">{sub(k)}</span>
                </span>
                {k === value && <svg className="w-3.5 h-3.5 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-100 mt-1 pt-2 px-1" data-testid="tb-currency-syms">
          <div className="text-[11px] text-gray-500 mb-1">{t('sheet_nf_currency_symbol')}</div>
          <div className="flex gap-1">
            {CURRENCY_SYMBOLS.map(c => (
              <button key={c} type="button" data-testid={`tb-currency-sym-${c}`} aria-pressed={curSym === c} onMouseDown={e => e.preventDefault()}
                onClick={() => { onSymbol(c); setOpen(false) }}
                className={`h-7 min-w-[44px] px-2 rounded border text-xs font-medium ${curSym === c ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{c}</button>
            ))}
          </div>
        </div>
      </Popover>
    </div>
  )
}
/** 色盘：主题色板 token（warm／aurora／ink／accent／coffee）＋基础色 */
const SWATCHES: string[] = [
  '#000000', '#444444', '#888888', '#bbbbbb', '#ffffff',
  '#e11d48', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7',
  palette.warm.bg, palette.warm.surface, palette.warm.border, palette.aurora.violet, palette.aurora.pink, palette.aurora.blue,
  palette.ink.primary, palette.ink.icon, palette.ink.muted, palette.accent.brand, palette.accent.brandDeep, palette.coffee.text,
]

function Divider() { return <div className="w-px h-4 bg-gray-200 mx-1.5 shrink-0" /> }

function Btn({ label, title, active, disabled, onClick, testid, children }: { label?: ReactNode; title: string; active?: boolean; disabled?: boolean; onClick: () => void; testid: string; children?: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active ? 'true' : undefined} disabled={disabled} data-testid={testid}
      onMouseDown={e => e.preventDefault()}   // 别抢网格焦点
      onClick={onClick}
      className={`${editorShell.toolbarBtn} h-7 min-w-[28px] justify-center ${active ? 'bg-gray-200 text-gray-900' : ''} ${disabled ? 'opacity-40 cursor-default' : ''}`}>
      {children ?? label}
    </button>
  )
}

/** 小弹层（点外面关） */
function Popover({ open, onClose, children, testid }: { open: boolean; onClose: () => void; children: ReactNode; testid: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])
  if (!open) return null
  return <div ref={ref} data-testid={testid} className={`absolute left-0 top-full mt-1 z-50 ${editorShell.menu} p-2`}>{children}</div>
}

function ColorButton({ kind, value, title, onPick, testid }: { kind: 'fg' | 'bg'; value: string | undefined; title: string; onPick: (color: string | undefined) => void; testid: string }) {
  const t = useSheetT()
  const [open, setOpen] = useState(false)
  const customRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative">
      <Btn title={title} testid={testid} onClick={() => setOpen(v => !v)}>
        <span className="flex flex-col items-center leading-none">
          {kind === 'fg'
            ? <span className="text-[13px] font-semibold" style={{ color: value ?? 'inherit' }}>A</span>
            : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 20h16M7 4l9 9-5 5-4-4a3 3 0 0 1 0-4l4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          <span className="block w-4 h-1 mt-0.5 rounded-sm border border-black/10" style={{ backgroundColor: value ?? 'transparent' }} />
        </span>
      </Btn>
      <Popover open={open} onClose={() => setOpen(false)} testid={`${testid}-popover`}>
        <div className="grid grid-cols-6 gap-1 w-[156px]">
          {SWATCHES.map(c => (
            <button key={c} type="button" title={c} data-color={c} onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(c); setOpen(false) }}
              className={`w-5 h-5 rounded border ${value === c ? 'border-blue-500 ring-1 ring-blue-300' : 'border-black/10'}`} style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(undefined); setOpen(false) }} className={`${editorShell.menuItem} px-2 py-1 w-auto`}>{t('sheet_tb_no_color')}</button>
          <label className={`${editorShell.menuItem} px-2 py-1 w-auto cursor-pointer`}>
            {t('sheet_tb_custom_color')}
            <input ref={customRef} type="color" className="sr-only" defaultValue={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
              onChange={e => { onPick(e.target.value.toLowerCase()); setOpen(false) }} />
          </label>
        </div>
      </Popover>
    </div>
  )
}

/** 復原／重做两颗＋⌄ 最近 20 步 */
function HistoryControls({ history, disabled, onUndo, onRedo }: { history: HistoryView; disabled: boolean; onUndo: (steps?: number) => void; onRedo: () => void }) {
  const t = useSheetT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Btn title={t('sheet_undo')} testid="tb-undo" disabled={disabled || !history.canUndo} onClick={() => onUndo(1)}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
      </Btn>
      <Btn title={t('sheet_redo')} testid="tb-redo" disabled={disabled || !history.canRedo} onClick={onRedo}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
      </Btn>
      <div className="relative">
        <Btn title={t('sheet_undo_list')} testid="tb-undo-list" disabled={disabled || !history.canUndo} onClick={() => setOpen(v => !v)}>
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 5 5 5-5" /></svg>
        </Btn>
        <Popover open={open && !disabled} onClose={() => setOpen(false)} testid="tb-undo-menu">
          <div className="w-[220px] max-h-[60vh] overflow-y-auto">
            <div className="px-1 pb-1 text-[11px] text-gray-400">{t('sheet_undo_list')}</div>
            {history.recent.length === 0 && <div className="px-2 py-1.5 text-xs text-gray-400">{t('sheet_undo_empty')}</div>}
            {history.recent.map((h, i) => (
              <button key={h.id} type="button" data-testid={`tb-undo-step-${i}`} onMouseDown={e => e.preventDefault()}
                onClick={() => { onUndo(i + 1); setOpen(false) }}
                className={`${editorShell.menuItem} w-full flex items-center gap-2 px-2 py-1.5 text-left`}>
                <span className="w-5 text-right text-[11px] text-gray-400 tabular-nums">{i + 1}</span><span className="text-[13px] truncate">{h.label}</span>
              </button>
            ))}
          </div>
        </Popover>
      </div>
    </>
  )
}

export default function SheetToolbar({ state, readonly, onCommand, history, historyDisabled, onUndo, onRedo }: Props) {
  const t = useSheetT()
  const isCn = useSheetHost().region === 'cn'
  const st = state.style ?? {}
  const dis = !!readonly
  const [borderOpen, setBorderOpen] = useState(false)
  const [borderDialog, setBorderDialog] = useState(false)
  // 转唯读（AI 罩落）⇒ 已开的框线下拉／「其他框线」弹窗一并关（弹窗只看自己的 open·套用会直送 borderEdges）；⛔ 为此挡缩放／翻页等纯浏览
  useEffect(() => { if (dis) { setBorderDialog(false); setBorderOpen(false) } }, [dis])
  const fileRef = useRef<HTMLInputElement>(null)
  const nfKind: NumFmtKind = st.numFmt?.t ?? 'general'

  return (
    <div className="flex items-center gap-0.5 flex-wrap min-w-0" data-testid="sheet-toolbar-groups">
      {/* ── 组零：復原／重做＋最近 20 步 ── */}
      <HistoryControls history={history} disabled={dis || !!historyDisabled} onUndo={onUndo} onRedo={onRedo} />
      <Divider />
      {/* ── 组一：格式刷／貼上／剪下／複製 ── */}
      <Btn title={state.brush ? t('sheet_tb_brush_hint') : t('sheet_tb_brush')} testid="tb-brush" active={state.brush} disabled={dis} onClick={() => onCommand({ t: 'brush' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 4h12v5H4zM10 9v4H7a2 2 0 0 0-2 2v5h4v-3h9V9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Btn>
      <Btn title={t('sheet_tb_paste')} testid="tb-paste" disabled={dis} onClick={() => onCommand({ t: 'paste' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 4h6v3H9zM7 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Btn>
      <Btn title={t('sheet_tb_cut')} testid="tb-cut" disabled={dis} onClick={() => onCommand({ t: 'cut' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="6" cy="18" r="3" /><circle cx="18" cy="18" r="3" /><path d="M8 16 20 4M16 16 4 4" strokeLinecap="round" /></svg>
      </Btn>
      <Btn title={t('sheet_tb_copy')} testid="tb-copy" onClick={() => onCommand({ t: 'copy' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M5 15V5a1 1 0 0 1 1-1h10" strokeLinecap="round" /></svg>
      </Btn>
      <Divider />

      {/* ── 组二：字体／字号／A＋A－｜B I U S／邊框／填滿色／字體色／清除格式 ── */}
      {/* 字体下拉＝lib/fonts/catalog 12 款（与云文档页共用 FontFamilyDropdown）·值＝id·存 cells[A1].s.font */}
      <FontFamilyDropdown value={st.font} disabled={dis} testid="tb-font" onPick={id => onCommand({ t: 'style', patch: { font: id } })} />
      <SelectWithChevron wrapClassName="w-[52px] ml-0.5" value={st.size ?? DEFAULT_SIZE} disabled={dis} title={t('sheet_tb_size')} aria-label={t('sheet_tb_size')} data-testid="tb-size"
        onChange={e => onCommand({ t: 'style', patch: { size: Number(e.target.value) === DEFAULT_SIZE ? undefined : Number(e.target.value) } })}>
        {SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
      </SelectWithChevron>
      <Btn title={t('sheet_tb_size_up')} testid="tb-size-up" disabled={dis} onClick={() => onCommand({ t: 'sizeStep', delta: 1 })}><span className="text-xs font-semibold">A<sup className="text-[9px]">+</sup></span></Btn>
      <Btn title={t('sheet_tb_size_down')} testid="tb-size-down" disabled={dis} onClick={() => onCommand({ t: 'sizeStep', delta: -1 })}><span className="text-xs font-semibold">A<sup className="text-[9px]">−</sup></span></Btn>
      <Divider />
      <Btn title={t('sheet_tb_bold')} testid="tb-bold" active={!!st.b} disabled={dis} onClick={() => onCommand({ t: 'toggle', key: 'b' })}><span className="font-bold">B</span></Btn>
      <Btn title={t('sheet_tb_italic')} testid="tb-italic" active={!!st.i} disabled={dis} onClick={() => onCommand({ t: 'toggle', key: 'i' })}><span className="italic font-serif">I</span></Btn>
      <Btn title={t('sheet_tb_underline')} testid="tb-underline" active={!!st.u} disabled={dis} onClick={() => onCommand({ t: 'toggle', key: 'u' })}><span className="underline">U</span></Btn>
      <Btn title={t('sheet_tb_strike')} testid="tb-strike" active={!!st.s} disabled={dis} onClick={() => onCommand({ t: 'toggle', key: 's' })}><span className="line-through">S</span></Btn>
      <div className="relative">
        <Btn title={t('sheet_tb_border')} testid="tb-border" active={!!st.border || !!state.drawMode} disabled={dis} onClick={() => setBorderOpen(v => !v)}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="4" width="16" height="16" /><path d="M12 4v16M4 12h16" strokeDasharray="2 2" /></svg>
          <svg className="w-2.5 h-2.5 -ml-0.5 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m5 8 5 5 5-5" /></svg>
        </Btn>
        <BorderMenu open={borderOpen && !dis} onClose={() => setBorderOpen(false)} pen={state.pen} drawMode={state.drawMode} swatches={SWATCHES}
          onKind={k => onCommand({ t: 'border', kind: k })}
          onMore={() => setBorderDialog(true)}
          onDraw={m => onCommand({ t: 'drawMode', mode: state.drawMode === m ? null : m })}
          onPen={p => onCommand({ t: 'pen', pen: p })} />
        <BorderDialog open={borderDialog && !dis} initial={state.edges} pen={state.pen} swatches={SWATCHES}
          onCancel={() => setBorderDialog(false)}
          onApply={edges => { setBorderDialog(false); if (!dis) onCommand({ t: 'borderEdges', edges }) }} />
      </div>
      <ColorButton kind="bg" value={st.bg} title={t('sheet_tb_fill')} testid="tb-fill" onPick={c => onCommand({ t: 'style', patch: { bg: c } })} />
      <ColorButton kind="fg" value={st.fg} title={t('sheet_tb_color')} testid="tb-color" onPick={c => onCommand({ t: 'style', patch: { fg: c } })} />
      <Btn title={t('sheet_tb_clear_fmt')} testid="tb-clear-format" disabled={dis} onClick={() => onCommand({ t: 'clearFormat' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 19h6M14 4l6 6-8 8H8l-3-3z" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Btn>
      <Divider />

      {/* ── 组三：垂直对齐三钮／水平对齐三钮／縮排減增／自動換行／合併 ── */}
      {(['top', 'middle', 'bottom'] as VAlign[]).map(v => (
        <Btn key={v} title={t(`sheet_tb_valign_${v}` as 'sheet_tb_valign_top')} testid={`tb-valign-${v}`} active={(st.valign ?? 'bottom') === v && !!st.valign} disabled={dis}
          onClick={() => onCommand({ t: 'style', patch: { valign: v } })}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            {v === 'top' && <path d="M4 5h16M8 9h8M8 13h8" strokeLinecap="round" />}
            {v === 'middle' && <path d="M4 12h16M8 8h8M8 16h8" strokeLinecap="round" />}
            {v === 'bottom' && <path d="M4 19h16M8 11h8M8 15h8" strokeLinecap="round" />}
          </svg>
        </Btn>
      ))}
      <div className="w-1" />
      {(['left', 'center', 'right'] as HAlign[]).map(a => (
        <Btn key={a} title={t(`sheet_tb_align_${a}` as 'sheet_tb_align_left')} testid={`tb-align-${a}`} active={st.align === a} disabled={dis}
          onClick={() => onCommand({ t: 'style', patch: { align: a } })}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 6h16M4 18h16" />
            {a === 'left' && <path d="M4 10h10M4 14h10" />}
            {a === 'center' && <path d="M7 10h10M7 14h10" />}
            {a === 'right' && <path d="M10 10h10M10 14h10" />}
          </svg>
        </Btn>
      ))}
      <Btn title={t('sheet_tb_indent_dec')} testid="tb-indent-dec" disabled={dis || !st.indent} onClick={() => onCommand({ t: 'indent', delta: -1 })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M12 10h8M12 14h8M4 18h16M8 10l-3 2 3 2" /></svg>
      </Btn>
      <Btn title={t('sheet_tb_indent_inc')} testid="tb-indent-inc" disabled={dis} onClick={() => onCommand({ t: 'indent', delta: 1 })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M12 10h8M12 14h8M4 18h16M5 10l3 2-3 2" /></svg>
      </Btn>
      <Btn title={t('sheet_tb_wrap')} testid="tb-wrap" active={!!st.wrap} disabled={dis} onClick={() => onCommand({ t: 'toggle', key: 'wrap' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h11a3 3 0 0 1 0 6h-3M4 18h5M14 15l-2 3 2 3" /></svg>
      </Btn>
      <Btn title={state.merge === 'merged' ? t('sheet_tb_unmerge') : t('sheet_tb_merge')} testid="tb-merge" active={state.merge === 'merged'} disabled={dis || state.merge === 'single'} onClick={() => onCommand({ t: 'merge' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="3" y="5" width="18" height="14" /><path d="M9 12h6M9 12l2-2M9 12l2 2M15 12l-2-2M15 12l-2 2" /></svg>
      </Btn>
      <Divider />

      {/* ── 组四：數字格式下拉／貨幣／%／千分位／小數增減（「转换」略） ── */}
      <NumFmtMenu value={nfKind} currency={st.numFmt?.c} disabled={dis} onPick={k => onCommand({ t: 'numFmt', kind: k })} onSymbol={c => onCommand({ t: 'currencySymbol', sym: c })} />
      {/* 「$」钮：套货币（符号＝站别预设 NT$／¥）·title 写出会套哪个符号 */}
      <Btn title={`${t('sheet_nf_currency')}（${regionCurrencySymbol(isCn ? 'cn' : 'tw')}）`} testid="tb-currency" active={nfKind === 'currency'} disabled={dis} onClick={() => onCommand({ t: 'numAction', action: 'currency' })}><span className="text-xs font-semibold">$</span></Btn>
      <Btn title={t('sheet_nf_percent')} testid="tb-percent" active={nfKind === 'percent'} disabled={dis} onClick={() => onCommand({ t: 'numAction', action: 'percent' })}><span className="text-xs font-semibold">%</span></Btn>
      <Btn title={t('sheet_tb_thousands')} testid="tb-thousands" active={!!st.numFmt?.k} disabled={dis} onClick={() => onCommand({ t: 'numAction', action: 'thousands' })}><span className="text-xs font-semibold">,</span></Btn>
      <Btn title={t('sheet_tb_dec_inc')} testid="tb-dec-inc" disabled={dis} onClick={() => onCommand({ t: 'numAction', action: 'dec+' })}><span className="text-[10px] font-mono leading-none">.0<span className="text-[8px]">←</span></span></Btn>
      <Btn title={t('sheet_tb_dec_dec')} testid="tb-dec-dec" disabled={dis} onClick={() => onCommand({ t: 'numAction', action: 'dec-' })}><span className="text-[10px] font-mono leading-none">.00<span className="text-[8px]">→</span></span></Btn>
      <Divider />

      {/* ── 条件格式── */}
      <SheetCondFormatMenu rules={state.cond} disabled={dis} onAction={a => onCommand({ t: 'condFormat', action: a })} />
      {/* ── 冻结筛选验证：凍結窗格／篩選／下拉選單 ── */}
      <SheetViewToolbar view={state.view} disabled={dis} onCommand={onCommand} />
      {/* ── 资料：移除重複／尋找與取代（尋找唯读也能用·取代钮在浮窗里另停用） ── */}
      <Btn title={t('sheet_tb_dedupe_title')} testid="tb-dedupe" disabled={dis} onClick={() => onCommand({ t: 'dedupe' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9.5h18M3 15h9" /><path d="m15 13 5 5M20 13l-5 5" /></svg>
        <span className="text-xs">{t('sheet_tb_dedupe')}</span>
      </Btn>
      <Btn title={t('sheet_tb_find')} testid="tb-find" onClick={() => onCommand({ t: 'find', mode: 'find' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>
      </Btn>
      <Divider />

      {/* ── 插入圖片 ── */}
      <Btn title={t('sheet_tb_image')} testid="tb-image" disabled={dis} onClick={() => fileRef.current?.click()}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 16-5-5-8 8" /></svg>
        <span className="text-xs">{t('sheet_tb_image')}</span>
      </Btn>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" data-testid="tb-image-input"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onCommand({ t: 'insertImage', file: f }) }} />
      {/* 图表：插入圖表（用当前选区当数据区间·选类型后插入） */}
      <Btn title={t('sheet_tb_chart')} testid="tb-chart" disabled={dis} onClick={() => onCommand({ t: 'insertChart' })}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h18M6 20v-6M11 20V8M16 20v-9M21 20V4" /></svg>
        <span className="text-xs">{t('sheet_tb_chart')}</span>
      </Btn>
    </div>
  )
}
