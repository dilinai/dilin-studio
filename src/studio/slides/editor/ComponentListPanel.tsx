'use client'

/**
 * 画布下方的「本頁元件」清单（取代「頁面內容」文字格面板）
 *   头：本頁元件＋新增（文字／圖片／影片／形狀／表格／圖表／程序動畫）；目录页已物化时多一颗「按章節重建目錄」。
 *   每行：种类图标、名称（双击改名）、锁定、隐藏、删除（⛔ 画布上删·只能在这里删）。点行 ⇄ 画布选中同步；画布双击会展开这一行。
 *   展开＝按种类出编辑器：文字（富文字框＋原顶栏工具栏）／图片／影片／形状／表格／图表；html 组件（旧整页／手动排版层）只给「還原成版式元件」（按之前先问）。
 *   装饰（role=decor）收成一行「裝飾」，展开后可逐个改。
 *   改动：文字每打一字即时画到画布（onPreview），停手 0.6 秒或失焦才存；其他栏位改完即存（onOp）。
 *   版面：清单在下方面板格内自带卷轴，预览框尺寸由 stage-fit.ts 按可用空间算、与清单项数无关；
 *     表头「本頁元件＋新增钮」（多选时连同多选栏）钉在格顶（sticky）；选中／展开那一行捲进视野时让开表头（scroll-margin-top＝表头实高）。
 *   多选：Ctrl（⌘）＋点行＝加选／减选；多选时哪一行都不展开（多选不能改内容），清单顶上出一条「已選 N 個」＋整组的 X／Y／寬／高（寬高＝整组等比）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CalloutTail, ChartComponent, ChartKind, ColorValue, ComponentOp, ComponentPatch, Frame, ImageComponent, LinearGradient, ProgramComponent, ShapeComponent, ShapeKind, SlideComponent,
  TableCell, TableComponent, TextBox, TextParagraph, VideoComponent,
} from '../kit/components/types'
import { CHART_KINDS, COMPONENT_LIMITS, SHAPE_KINDS } from '../kit/components/types'
import { plainTextOf, resolveColor, type ResolveCtx } from '../kit/components/resolve'
import { evenColWidths } from '../kit/components/validate'
import { compiledProgramRemoved } from '../kit/components/program-source'
import { useStudioT as useT } from '../../shared/StudioT'
/** 字串键（字典在 ../i18n-site.ts 与 ../i18n.ts） */
type TKey = string
import { confirmDialog, promptDialog, alertDialog } from '../../shared/dialog-store'
import { useSlidesHost, type MediaAttachment as Attachment } from './host'
import RichTextEditor from './RichTextEditor'
import { componentLabel, TYPE_ICON, typeKey } from './labels'
import { groupBox } from './transform'
import { cssColorToHex } from './richtext'
import { editorShell } from '../../shared/theme/editor-shell-theme'

export type ComponentListPanelProps = {
  components: readonly SlideComponent[]
  pageIndex: number
  pageId?: string
  ctx: ResolveCtx
  isContentsPage: boolean
  materialized: boolean
  selectedId: string | null
  /** 多选（一个以上）：清单上这几行都亮、都不展开 */
  selectedIds?: readonly string[]
  expandedId: string | null
  onSelect: (id: string | null) => void
  onExpand: (id: string | null) => void
  onOp: (op: ComponentOp) => void
  /** 文字即时预览（null＝收回预览） */
  onPreview: (op: ComponentOp | null) => void
  /** 本地档上传（图片／影片）⇒ 裸链＋显示链（宿主走 /api/upload/media·与原工具栏插图同一条） */
  uploadMedia: (files: FileList) => Promise<Attachment[]>
  /** 刚拿到的媒体显示链（私密桶签名链）登记给画布用 */
  onMediaShown: (url: string, displayUrl?: string) => void
  busy?: boolean
  /** Ctrl（⌘）＋点行：加选／减选 */
  onToggle?: (id: string) => void
  /** 多选栏改整组的位置／大小 */
  onGroupFrame?: (f: Partial<Frame>) => void
  /** 宿主换成库里新版时 +1 ⇒ 富文字框有焦点也重画成新版（见 RichTextEditor） */
  syncEpoch?: number
  /** 组合（多选栏）／取消组合（组合那一行） */
  onGroup?: () => void
  onUngroup?: (id: string) => void
}

const hex6 = (c: string) => (cssColorToHex(c) ?? '#000000').slice(0, 7)

export default function ComponentListPanel(p: ComponentListPanelProps) {
  const t = useT()
  const [decorOpen, setDecorOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 钉顶表头的实高（折行／多选栏出没会变）⇒ 行的 scroll-margin-top·捲进视野时不被表头盖住
  const headRef = useRef<HTMLDivElement>(null)
  const [headH, setHeadH] = useState(0)
  useEffect(() => {
    const el = headRef.current
    if (!el) return
    const m = () => setHeadH(el.offsetHeight)
    m()
    const ro = new ResizeObserver(m)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const multi = (p.selectedIds?.length ?? 0) > 1
  const multiBox = useMemo(() => (multi ? groupBox(p.components.filter((c) => p.selectedIds!.includes(c.id) && !c.hidden).map((c) => c.frame)) : null), [multi, p.components, p.selectedIds])

  // 画面上由上到下＝最上层到最底层（与 PowerPoint 选择窗格同向）
  const ordered = useMemo(() => [...p.components].reverse(), [p.components])
  const decor = ordered.filter((c) => c.role === 'decor')
  const main = ordered.filter((c) => c.role !== 'decor')

  // 选中／展开变了 ⇒ 把那一行捲进视野（画布双击跳过来）
  useEffect(() => {
    const id = p.expandedId ?? p.selectedId
    if (!id) return
    if (decor.some((c) => c.id === id)) setDecorOpen(true)
    // 捲的是那一行的标题列（展开的编辑器可能比格子还高·整块 nearest 会对齐到底边看不见标题）
    const el = listRef.current?.querySelector(`[data-cid="${CSS.escape(id)}"] > [data-testid="slc-row-head"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.expandedId, p.selectedId])

  const update = (id: string, patch: ComponentPatch) => p.onOp({ kind: 'component_update', componentId: id, patch })
  const add = (component: Extract<ComponentOp, { kind: 'component_add' }>['component']) =>
    p.onOp({ kind: 'component_add', pageIndex: p.pageIndex, ...(p.pageId ? { pageId: p.pageId } : {}), component })

  const row = (c: SlideComponent, nested = false) => {
    const sel = p.selectedId === c.id || (p.selectedIds?.includes(c.id) ?? false)
    const open = p.expandedId === c.id && !multi
    const label = componentLabel(c, t)
    return (
      <div key={c.id} data-cid={c.id} data-testid="slc-row" className={`rounded-lg ${sel ? 'ring-1 ring-blue-400 bg-blue-50/60' : ''} ${nested ? 'ml-4' : ''}`}>
        <div data-testid="slc-row-head" style={{ scrollMarginTop: headH + 4 }} className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none ${sel ? '' : 'hover:bg-gray-50'} rounded-lg`}
          onClick={(e) => {
            if ((e.ctrlKey || e.metaKey) && p.onToggle) { p.onToggle(c.id); return }
            p.onSelect(c.id); p.onExpand(open ? null : c.id)
          }}>
          <span className="w-5 text-center text-[12px] text-gray-500 shrink-0" title={t(typeKey(c.type))}>{TYPE_ICON[c.type]}</span>
          {renaming === c.id ? (
            <input autoFocus defaultValue={c.name ?? ''} maxLength={COMPONENT_LIMITS.nameChars} placeholder={label}
              className="flex-1 min-w-0 text-xs border border-blue-300 rounded px-1 py-0.5 bg-white"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }}
              onBlur={(e) => { setRenaming(null); const v = e.target.value.trim(); if (v !== (c.name ?? '')) update(c.id, { name: v || null }) }} />
          ) : (
            <span className={`flex-1 min-w-0 truncate text-xs ${c.hidden ? 'text-gray-400 line-through' : 'text-gray-700'}`} data-testid="slc-row-name"
              onDoubleClick={(e) => { e.stopPropagation(); setRenaming(c.id) }} title={t('slc_rename_hint')}>{label}</span>
          )}
          {/* 锁定钮用 SVG 画两种状态（🔒／🔓 emoji 在彩色字体里外观几乎相同）：锁住＝实心琥珀锁＋淡琥珀底；未锁＝灰线稿、锁扣掀开 */}
          <button type="button" data-locked={c.locked ? '1' : '0'} className={`w-6 h-6 rounded inline-flex items-center justify-center ${c.locked ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-gray-400 hover:bg-gray-100'}`} data-testid="slc-row-lock"
            title={c.locked ? t('slc_unlock') : t('slc_lock')} onClick={(e) => { e.stopPropagation(); update(c.id, { locked: !c.locked }) }}>
            {c.locked
              ? <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M6 8V6a4 4 0 118 0v2h.5A1.5 1.5 0 0116 9.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 15.5v-6A1.5 1.5 0 015.5 8H6zm2 0h4V6a2 2 0 10-4 0v2z" /></svg>
              : <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 8V5.5a2.5 2.5 0 015 0" /><rect x="4.5" y="8" width="11" height="8.5" rx="1.5" /></svg>}
          </button>
          <button type="button" className={`w-6 h-6 rounded text-[12px] ${c.hidden ? 'text-gray-300' : 'text-gray-500'} hover:bg-gray-100`} data-testid="slc-row-hide"
            title={c.hidden ? t('slc_show') : t('slc_hide')} onClick={(e) => { e.stopPropagation(); update(c.id, { hidden: !c.hidden }) }}>{c.hidden ? '◌' : '👁'}</button>
          <button type="button" className="w-6 h-6 rounded text-[12px] text-gray-400 hover:bg-red-50 hover:text-red-500" data-testid="slc-row-delete"
            title={t('slc_delete')} onClick={async (e) => {
              e.stopPropagation()
              if (await confirmDialog({ message: t('slc_delete_confirm').replace('{name}', label) })) p.onOp({ kind: 'component_delete', componentId: c.id })
            }}>✕</button>
        </div>
        {open && (
          <div className="px-2 pb-2 pt-1 space-y-2" data-testid="slc-row-editor" onClick={(e) => e.stopPropagation()}>
            <FrameFields c={c} onFrame={(frame) => p.onOp({ kind: 'component_frame', componentId: c.id, frame })} />
            {c.type === 'group'
              ? <button type="button" data-testid="slc-ungroup" disabled={p.busy} className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40"
                  title="Ctrl+Shift+G" onClick={() => p.onUngroup?.(c.id)}>{t('slc_ungroup')}</button>
              : <TypeEditor c={c} {...p} update={update} />}
          </div>
        )}
        {/* 组合：组内子件逐行（由上到下＝最上层到最底层）·可各自展开改内容；框是组内坐标 */}
        {c.type === 'group' && (
          <div className="ml-4 border-l border-gray-200" data-testid="slc-group-children">
            {[...c.children].reverse().map((ch) => row(ch, true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-3 pb-2" data-testid="slc-list">
      {/* 表头（＋多选栏）钉在下方面板格顶：清单卷动时不跟着走（面板格＝page.tsx 的 slides-panel-slot·overflow-y-auto） */}
      <div ref={headRef} className={`sticky top-0 z-10 -mx-3 px-3 pt-2 pb-2 ${editorShell.softSurface}`} data-testid="slc-list-head">
      <div className="flex items-center gap-1 flex-wrap">
        <div className="text-xs font-medium text-gray-600 mr-1" data-testid="slc-list-title">{t('slc_list_title').replace('{n}', String(p.components.length))}</div>
        {([
          ['text', () => add({ type: 'text', text: t('slc_new_text') })],
          ['image', () => add({ type: 'image' })],
          ['video', () => add({ type: 'video' })],
          ['shape', () => add({ type: 'shape', shape: 'roundRect' })],
          ['table', () => add({ type: 'table' })],
          ['chart', () => add({ type: 'chart' })],
          ['program', () => add({ type: 'program' })],
        ] as const).map(([type, fn]) => (
          <button key={type} type="button" disabled={p.busy} data-testid={`slc-add-${type}`}
            className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40"
            onClick={fn}>＋{t(typeKey(type))}</button>
        ))}
        {p.isContentsPage && p.materialized && (
          <button type="button" data-testid="slc-toc-rebuild" disabled={p.busy}
            className="ml-auto px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40"
            onClick={async () => { if (await confirmDialog({ message: t('slc_toc_rebuild_confirm') })) p.onOp({ kind: 'toc_rebuild', pageIndex: p.pageIndex, ...(p.pageId ? { pageId: p.pageId } : {}) }) }}>
            {t('slc_toc_rebuild')}</button>
        )}
      </div>
      {multi && multiBox && (
        <div className="mt-2 px-2 py-1.5 rounded-lg bg-blue-50/70 ring-1 ring-blue-200 space-y-1" data-testid="slc-multi-bar">
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-blue-800" data-testid="slc-multi-count">{t('slc_multi_selected').replace('{n}', String(p.selectedIds!.length))}</div>
            {p.onGroup && <button type="button" data-testid="slc-group" disabled={p.busy} title="Ctrl+G"
              className="px-2 py-0.5 text-[11px] rounded-md border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 disabled:opacity-40" onClick={() => p.onGroup?.()}>{t('slc_group')}</button>}
          </div>
          <MultiFrameFields box={multiBox} onChange={(f) => p.onGroupFrame?.(f)} />
        </div>
      )}
      </div>
      <div ref={listRef} className="space-y-0.5">
        {main.length === 0 && decor.length === 0 && <div className="text-xs text-gray-400 px-2 py-3">{t('slc_list_empty')}</div>}
        {main.map((c) => row(c))}
        {decor.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-lg hover:bg-gray-50 select-none" data-testid="slc-decor-group"
              onClick={() => setDecorOpen((v) => !v)}>
              <span className="w-5 text-center text-[11px] text-gray-400">{decorOpen ? '▾' : '▸'}</span>
              <span className="text-xs text-gray-500">{t('slc_decor_group').replace('{n}', String(decor.length))}</span>
            </div>
            {decorOpen && decor.map((c) => row(c, true))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 位置／尺寸／角度                                                     */
/* ------------------------------------------------------------------ */

function NumField(props: { label: string; value: number; min?: number; max?: number; step?: number; onCommit: (v: number) => void; testid?: string; width?: string }) {
  const [v, setV] = useState(String(props.value))
  useEffect(() => { setV(String(props.value)) }, [props.value])
  const commit = () => {
    const n = Number(v)
    if (!Number.isFinite(n)) { setV(String(props.value)); return }
    const c = Math.max(props.min ?? -Infinity, Math.min(props.max ?? Infinity, n))
    if (c !== props.value) props.onCommit(c)
    else setV(String(props.value))
  }
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-500">
      {props.label}
      <input type="number" value={v} step={props.step ?? 1} data-testid={props.testid}
        className={`${props.width ?? 'w-16'} border border-gray-200 rounded px-1 py-0.5 text-gray-700 bg-white`}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

function FrameFields({ c, onFrame }: { c: SlideComponent; onFrame: (f: Partial<Frame>) => void }) {
  const t = useT()
  const L = COMPONENT_LIMITS
  const r2 = (n: number) => Math.round(n * 100) / 100
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="slc-frame-fields">
      <NumField label="X" value={r2(c.frame.x)} min={L.posMin} max={L.posMax} onCommit={(x) => onFrame({ x })} testid="slc-frame-x" />
      <NumField label="Y" value={r2(c.frame.y)} min={L.posMin} max={L.posMax} onCommit={(y) => onFrame({ y })} testid="slc-frame-y" />
      <NumField label={t('slc_w')} value={r2(c.frame.w)} min={L.sizeMin} max={L.sizeMax} onCommit={(w) => onFrame({ w })} testid="slc-frame-w" />
      <NumField label={t('slc_h')} value={r2(c.frame.h)} min={L.sizeMin} max={L.sizeMax} onCommit={(h) => onFrame({ h })} testid="slc-frame-h" />
      <NumField label={t('slc_angle')} value={r2(c.frame.rotate)} min={-360} max={360} onCommit={(rotate) => onFrame({ rotate })} testid="slc-frame-rotate" />
    </div>
  )
}

/** 多选栏：整组的框（X／Y＝整组平移；寬／高＝整组等比缩放） */
function MultiFrameFields({ box, onChange }: { box: Frame; onChange: (f: Partial<Frame>) => void }) {
  const t = useT()
  const L = COMPONENT_LIMITS
  const r2 = (n: number) => Math.round(n * 100) / 100
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="slc-multi-fields">
      <NumField label="X" value={r2(box.x)} min={L.posMin} max={L.posMax} onCommit={(x) => onChange({ x })} testid="slc-multi-x" />
      <NumField label="Y" value={r2(box.y)} min={L.posMin} max={L.posMax} onCommit={(y) => onChange({ y })} testid="slc-multi-y" />
      <NumField label={t('slc_w')} value={r2(box.w)} min={L.sizeMin} max={L.sizeMax} onCommit={(w) => onChange({ w })} testid="slc-multi-w" />
      <NumField label={t('slc_h')} value={r2(box.h)} min={L.sizeMin} max={L.sizeMax} onCommit={(h) => onChange({ h })} testid="slc-multi-h" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 小控件                                                              */
/* ------------------------------------------------------------------ */

function ColorField(props: { label: string; value: ColorValue | null | undefined; ctx: ResolveCtx; allowNone?: boolean; onChange: (v: ColorValue | null) => void; testid?: string }) {
  const t = useT()
  const shown = props.value ? hex6(resolveColor(props.value, props.ctx, '#000000')) : '#ffffff'
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-500">
      {props.label}
      <input type="color" value={shown} data-testid={props.testid} className="w-7 h-6 p-0 border border-gray-200 rounded bg-white"
        onChange={(e) => props.onChange(e.target.value.toUpperCase() as ColorValue)} />
      {props.allowNone && (
        <button type="button" className={`text-[10px] px-1 rounded border ${props.value ? 'border-gray-200 text-gray-400' : 'border-blue-300 text-blue-600'}`}
          onClick={() => props.onChange(null)}>{t('slc_none')}</button>
      )}
    </label>
  )
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-600">
      <input type="checkbox" checked={props.checked} data-testid={props.testid} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* 各种类的编辑器                                                       */
/* ------------------------------------------------------------------ */

type EditorProps = ComponentListPanelProps & { c: SlideComponent; update: (id: string, patch: ComponentPatch) => void }

function TypeEditor(props: EditorProps) {
  const { c } = props
  switch (c.type) {
    case 'text': return <TextBlock {...props} body={{ paragraphs: c.paragraphs, box: c.box }} />
    case 'shape': return <ShapeEditor {...props} c={c} />
    case 'image': return <ImageEditor {...props} c={c} />
    case 'video': return <VideoEditor {...props} c={c} />
    case 'table': return <TableEditor {...props} c={c} />
    case 'chart': return <ChartEditor {...props} c={c} />
    case 'html': return <HtmlEditor {...props} />
    case 'program': return <ProgramEditor {...props} c={c} />
    default: return null
  }
}

/** 程序动画：程式（HTML＋JS）／样式（CSS）两格（失焦存）·步数·设计尺寸·背景 */
function ProgramEditor(props: EditorProps & { c: ProgramComponent }) {
  const t = useT()
  const { c, update, ctx } = props
  const [html, setHtml] = useState(c.html)
  const [css, setCss] = useState(c.css ?? '')
  useEffect(() => { setHtml(c.html) }, [c.html])
  useEffect(() => { setCss(c.css ?? '') }, [c.css])
  const L = COMPONENT_LIMITS
  const commitHtml = async () => {
    if (html === c.html) return
    if (html.length > L.programHtmlChars) { await alertDialog(t('slc_program_too_long').replace('{n}', String(L.programHtmlChars))); return }
    update(c.id, { html })
  }
  const commitCss = async () => {
    if (css === (c.css ?? '')) return
    if (css.length > L.programCssChars) { await alertDialog(t('slc_program_too_long').replace('{n}', String(L.programCssChars))); return }
    update(c.id, { css: css || null })
  }
  const mono = 'w-full border border-gray-200 rounded px-1.5 py-1 bg-white text-[11px] leading-snug text-gray-800 font-mono'
  // 计时闸：存档时编译器拿掉的 script（外部 src／importmap…）跟着 compiled 回来·这里说一句（细目放 title·最多列 20 条·数字用真总数）
  const removed = compiledProgramRemoved(c)
  return (
    <div className="space-y-1.5" data-testid="slc-program-editor">
      <div className="text-[11px] text-gray-400">{t('slc_program_hint')}</div>
      {removed.count > 0 && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1" data-testid="slc-program-removed" title={removed.list.join('\n') + (removed.count > removed.list.length ? '\n…' : '')}>
          {t('slc_program_removed').replace('{n}', String(removed.count))}
        </div>
      )}
      <label className="block text-[11px] text-gray-500">{t('slc_program_html')}
        <textarea value={html} rows={8} spellCheck={false} className={mono} data-testid="slc-program-html"
          onChange={(e) => setHtml(e.target.value)} onBlur={() => { void commitHtml() }} />
      </label>
      <label className="block text-[11px] text-gray-500">{t('slc_program_css')}
        <textarea value={css} rows={3} spellCheck={false} className={mono} data-testid="slc-program-css"
          onChange={(e) => setCss(e.target.value)} onBlur={() => { void commitCss() }} />
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <NumField label={t('slc_program_steps')} value={c.steps ?? 0} min={0} max={L.programStepsMax} onCommit={(steps) => update(c.id, { steps: Math.round(steps) })} testid="slc-program-steps" width="w-14" />
        <NumField label={t('slc_program_design_w')} value={c.designW ?? Math.round(c.frame.w)} min={L.programDesignMin} max={L.programDesignMax} onCommit={(designW) => update(c.id, { designW })} width="w-16" />
        <NumField label={t('slc_program_design_h')} value={c.designH ?? Math.round(c.frame.h)} min={L.programDesignMin} max={L.programDesignMax} onCommit={(designH) => update(c.id, { designH })} width="w-16" />
        <Check label={t('slc_program_transparent')} checked={c.transparent !== false} onChange={(v) => update(c.id, { transparent: v ? null : false })} testid="slc-program-transparent" />
        {c.transparent === false && <ColorField label={t('slc_fill')} value={(c.bgColor ?? 'theme:bg') as ColorValue} ctx={ctx} onChange={(v) => v && update(c.id, { bgColor: v })} />}
      </div>
    </div>
  )
}

/** 文字本体（文字组件／形状内文字）：富文字框＋框设定 */
function TextBlock(props: EditorProps & { body: { paragraphs: TextParagraph[]; box: TextBox } }) {
  const t = useT()
  const { c, body, ctx, onOp, onPreview } = props
  const isShape = c.type === 'shape'
  const pending = useRef<TextParagraph[] | null>(null)
  const timer = useRef<number>(0)
  const opFor = (ps: TextParagraph[]): ComponentOp => ({ kind: 'component_update', componentId: c.id, patch: isShape ? { paragraphs: ps, box: {} } : { paragraphs: ps } })
  const flush = () => {
    window.clearTimeout(timer.current)
    const ps = pending.current
    pending.current = null
    if (!ps) return
    onOp(opFor(ps))
    onPreview(null)
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  // 换组件／收起 ⇒ 没存的先存
  useEffect(() => () => flushRef.current(), [c.id])

  const box = body.box
  const setBox = (b: ComponentPatch['box']) => props.update(c.id, { box: b })
  const surface = box.fill ? resolveColor(box.fill, ctx, ctx.palette.bg) : isShape && (c as ShapeComponent).fill ? resolveColor((c as ShapeComponent).fill!, ctx, ctx.palette.bg) : ctx.palette.bg
  return (
    <div className="space-y-1.5">
      <RichTextEditor editorKey={c.id} paragraphs={body.paragraphs} box={box} ctx={ctx} surface={surface} syncEpoch={props.syncEpoch}
        onChange={(ps) => {
          pending.current = ps
          onPreview(opFor(ps))
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => flushRef.current(), 600)
        }}
        onCommit={() => flushRef.current()} />
      <div className="flex items-center gap-2 flex-wrap" data-testid="slc-box-fields">
        <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_valign')}
          <select value={box.valign} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" data-testid="slc-box-valign"
            onChange={(e) => setBox({ valign: e.target.value as TextBox['valign'] })}>
            <option value="top">{t('slc_valign_top')}</option><option value="middle">{t('slc_valign_middle')}</option><option value="bottom">{t('slc_valign_bottom')}</option>
          </select>
        </label>
        <NumField label={t('slc_font_size')} value={box.size} min={COMPONENT_LIMITS.fontSizeMin} max={COMPONENT_LIMITS.fontSizeMax} onCommit={(size) => setBox({ size })} testid="slc-box-size" width="w-14" />
        <NumField label={t('slc_line_height')} value={box.lineHeight} min={0.8} max={4} step={0.05} onCommit={(lineHeight) => setBox({ lineHeight })} width="w-14" />
        <NumField label={t('slc_padding')} value={box.padding} min={0} max={COMPONENT_LIMITS.paddingMax} onCommit={(padding) => setBox({ padding })} width="w-14" />
        <ColorField label={t('slc_text_color')} value={box.color} ctx={ctx} onChange={(v) => v && setBox({ color: v })} testid="slc-box-color" />
        <ColorField label={t('slc_fill')} value={box.fill} ctx={ctx} allowNone onChange={(v) => setBox({ fill: v })} />
        <ColorField label={t('slc_border')} value={box.border?.color} ctx={ctx} allowNone
          onChange={(v) => setBox({ border: v ? { color: v, width: box.border?.width || 1, dash: box.border?.dash ?? 'solid' } : null })} />
      </div>
    </div>
  )
}

/** 换图／换片／封面：＋（雲端硬碟／本地上传）＋贴网址 */
function MediaPicker(props: EditorProps & { kind: 'image' | 'video'; label: string; onPicked: (url: string) => void; testid: string }) {
  const t = useT()
  const { MediaUploader: AttachmentUploader } = useSlidesHost()
  const accept = props.kind === 'image' ? 'image/*' : 'video/mp4,video/webm'
  return (
    <div className="flex items-center gap-1.5" data-testid={props.testid}>
      <span className="text-[11px] text-gray-500">{props.label}</span>
      <AttachmentUploader size="sm" accept={accept} customLocalHandler={props.uploadMedia}
        onAttach={async (atts) => {
          const a = atts[0]
          if (!a?.url) return
          if (a.mime && !a.mime.startsWith(props.kind === 'image' ? 'image/' : 'video/')) { await alertDialog(t(props.kind === 'image' ? 'slc_not_image' : 'slc_not_video')); return }
          props.onMediaShown(a.url, a.displayUrl)
          props.onPicked(a.url)
        }} />
      <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-testid={`${props.testid}-url`}
        onClick={async () => {
          const u = (await promptDialog({ message: t('slc_media_url_prompt'), defaultValue: '' }))?.trim()
          if (!u) return
          if (!/^https:\/\/\S+$/i.test(u)) { await alertDialog(t('slc_media_url_bad')); return }
          props.onPicked(u)
        }}>{t('slc_media_url')}</button>
    </div>
  )
}

function ImageEditor(props: EditorProps & { c: ImageComponent }) {
  const t = useT()
  const { c, update, ctx } = props
  return (
    <div className="space-y-1.5">
      <MediaPicker {...props} kind="image" label={t('slc_replace_image')} testid="slc-image-pick" onPicked={(src) => update(c.id, { src, crop: null })} />
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_fit')}
          <select value={c.fit} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" data-testid="slc-image-fit" onChange={(e) => update(c.id, { fit: e.target.value as 'cover' | 'contain' })}>
            <option value="cover">{t('slc_fit_cover')}</option><option value="contain">{t('slc_fit_contain')}</option>
          </select>
        </label>
        {c.crop && <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" onClick={() => update(c.id, { crop: null })}>{t('slc_reset_crop')}</button>}
        <NumField label={t('slc_radius')} value={c.radius ?? 0} min={0} max={COMPONENT_LIMITS.radiusMax} onCommit={(radius) => update(c.id, { radius: radius || null })} width="w-14" />
        <ColorField label={t('slc_border')} value={c.border?.color} ctx={ctx} allowNone onChange={(v) => update(c.id, { border: v ? { color: v, width: c.border?.width || 2 } : null })} />
        <Check label={t('slc_flip_x')} checked={!!c.flipX} onChange={(v) => update(c.id, { flipX: v })} />
        <Check label={t('slc_flip_y')} checked={!!c.flipY} onChange={(v) => update(c.id, { flipY: v })} />
      </div>
    </div>
  )
}

function VideoEditor(props: EditorProps & { c: VideoComponent }) {
  const t = useT()
  const { c, update } = props
  return (
    <div className="space-y-1.5">
      <MediaPicker {...props} kind="video" label={t('slc_replace_video')} testid="slc-video-pick" onPicked={(src) => update(c.id, { src })} />
      <div className="flex items-center gap-2 flex-wrap">
        <MediaPicker {...props} kind="image" label={t('slc_poster')} testid="slc-poster-pick" onPicked={(poster) => update(c.id, { poster })} />
        {c.poster && <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white text-gray-500" onClick={() => update(c.id, { poster: null })}>{t('slc_poster_clear')}</button>}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Check label={t('slc_autoplay')} checked={!!c.autoplay} onChange={(v) => update(c.id, { autoplay: v })} testid="slc-video-autoplay" />
        <Check label={t('slc_loop')} checked={!!c.loop} onChange={(v) => update(c.id, { loop: v })} />
        <Check label={t('slc_muted')} checked={!!c.muted} onChange={(v) => update(c.id, { muted: v })} />
        <Check label={t('slc_controls')} checked={c.controls !== false} onChange={(v) => update(c.id, { controls: v })} />
        <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_fit')}
          <select value={c.fit} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" onChange={(e) => update(c.id, { fit: e.target.value as 'cover' | 'contain' })}>
            <option value="contain">{t('slc_fit_contain')}</option><option value="cover">{t('slc_fit_cover')}</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function ShapeEditor(props: EditorProps & { c: ShapeComponent }) {
  const t = useT()
  const { c, update, ctx } = props
  const isLine = c.shape === 'line' || c.shape === 'arc'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_shape_kind')}
          <select value={c.shape} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" data-testid="slc-shape-kind" onChange={(e) => update(c.id, { shape: e.target.value as ShapeKind })}>
            {SHAPE_KINDS.map((k) => <option key={k} value={k}>{t(`slc_shape_${k}` as TKey)}</option>)}
          </select>
        </label>
        {!isLine && <ColorField label={t('slc_fill')} value={c.fill} ctx={ctx} allowNone onChange={(v) => update(c.id, { fill: v })} testid="slc-shape-fill" />}
        <ColorField label={t('slc_stroke')} value={c.stroke?.color} ctx={ctx} allowNone={!isLine}
          onChange={(v) => update(c.id, { stroke: v ? { color: v, width: c.stroke?.width || 2, dash: c.stroke?.dash ?? 'solid' } : null })} />
        {c.stroke && <NumField label={t('slc_stroke_width')} value={c.stroke.width} min={0} max={COMPONENT_LIMITS.strokeMax} onCommit={(width) => update(c.id, { stroke: { ...c.stroke!, width } })} width="w-14" />}
        {c.stroke && (
          <select value={c.stroke.dash ?? 'solid'} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-[11px] text-gray-700" onChange={(e) => update(c.id, { stroke: { ...c.stroke!, dash: e.target.value as 'solid' | 'dashed' | 'dotted' } })}>
            <option value="solid">{t('slc_dash_solid')}</option><option value="dashed">{t('slc_dash_dashed')}</option><option value="dotted">{t('slc_dash_dotted')}</option>
          </select>
        )}
        {(c.shape === 'roundRect' || c.shape === 'callout') && <NumField label={t('slc_radius')} value={c.radius ?? (c.shape === 'callout' ? 12 : 0)} min={0} max={COMPONENT_LIMITS.radiusMax} onCommit={(radius) => update(c.id, { radius })} width="w-14" />}
        {isLine && (<>
          <Check label={t('slc_line_start_arrow')} checked={c.lineEnds?.start === 'arrow'} onChange={(v) => update(c.id, { lineEnds: { ...(c.lineEnds ?? {}), start: v ? 'arrow' : 'none' } })} />
          <Check label={t('slc_line_end_arrow')} checked={c.lineEnds?.end === 'arrow'} onChange={(v) => update(c.id, { lineEnds: { ...(c.lineEnds ?? {}), end: v ? 'arrow' : 'none' } })} />
        </>)}
      </div>
      <ShapeExtraFields {...props} />
      {!isLine && (c.text
        ? <TextBlock {...props} body={c.text} />
        : <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-testid="slc-shape-add-text"
            onClick={() => update(c.id, { box: {} })}>{t('slc_shape_add_text')}</button>)}
    </div>
  )
}

/** 形状新栏：填色方式（纯色／渐层／幻灯片背景填充）·渐层·阴影·弧角·环厚·对话框尾巴·毛玻璃 */
function ShapeExtraFields(props: EditorProps & { c: ShapeComponent }) {
  const t = useT()
  const { c, update, ctx } = props
  const L = COMPONENT_LIMITS
  const strokeOnly = c.shape === 'line' || c.shape === 'arc'
  const mode = c.fillMode ?? 'solid'
  const g: LinearGradient = c.gradient ?? { angle: 90, stops: [{ pos: 0, color: '#000000CC' as ColorValue }, { pos: 100, color: '#00000033' as ColorValue }] }
  const alphaOf = (v: ColorValue) => { const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(v); return m ? Math.round((parseInt(m[1], 16) / 255) * 100) : 100 }
  const withAlpha = (hex: string, pct: number) => `${hex.slice(0, 7).toUpperCase()}${pct >= 100 ? '' : Math.round((Math.max(0, pct) / 100) * 255).toString(16).padStart(2, '0').toUpperCase()}` as ColorValue
  const setStop = (i: number, color: ColorValue) => update(c.id, { fillMode: 'gradient', gradient: { ...g, stops: g.stops.map((st, k) => (k === i ? { ...st, color } : st)) } })
  const sh = c.shadow
  return (
    <div className="space-y-1.5" data-testid="slc-shape-extra">
      {!strokeOnly && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_fill_mode')}
            <select value={mode} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" data-testid="slc-shape-fill-mode"
              onChange={(e) => {
                const v = e.target.value
                if (v === 'solid') update(c.id, { fillMode: null })
                else if (v === 'gradient') update(c.id, { fillMode: 'gradient', gradient: g })
                else update(c.id, { fillMode: 'pageBackground' })
              }}>
              <option value="solid">{t('slc_fill_solid')}</option>
              <option value="gradient">{t('slc_fill_gradient')}</option>
              <option value="pageBackground">{t('slc_fill_page_bg')}</option>
            </select>
          </label>
          {mode === 'gradient' && g.stops.slice(0, 2).map((st, i) => (
            <span key={i} className="flex items-center gap-1">
              <ColorField label={t(i === 0 ? 'slc_gradient_from' : 'slc_gradient_to')} value={st.color} ctx={ctx} onChange={(v) => v && setStop(i, withAlpha(v, alphaOf(st.color)))} testid={`slc-gradient-${i}`} />
              <NumField label={t('slc_alpha')} value={alphaOf(st.color)} min={0} max={100} width="w-12" onCommit={(a) => setStop(i, withAlpha(st.color, a))} />
            </span>
          ))}
          {mode === 'gradient' && <NumField label={t('slc_angle')} value={g.angle} min={0} max={359} width="w-12" onCommit={(angle) => update(c.id, { gradient: { ...g, angle } })} />}
          {!strokeOnly && <NumField label={t('slc_backdrop_blur')} value={c.backdropBlur ?? 0} min={0} max={L.blurMax} width="w-12" onCommit={(v) => update(c.id, { backdropBlur: v || null })} testid="slc-shape-blur" />}
        </div>
      )}
      {mode === 'pageBackground' && !strokeOnly && <div className="text-[10.5px] text-gray-400">{t('slc_fill_page_bg_hint')}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <Check label={t('slc_shadow')} checked={!!sh} testid="slc-shape-shadow"
          onChange={(v) => update(c.id, { shadow: v ? { color: '#00000066' as ColorValue, blur: 12, distance: 8, angle: 0 } : null })} />
        {sh && (<>
          <ColorField label="" value={sh.color} ctx={ctx} onChange={(v) => v && update(c.id, { shadow: { ...sh, color: withAlpha(v, alphaOf(sh.color)) } })} />
          <NumField label={t('slc_shadow_blur')} value={sh.blur} min={0} max={L.shadowMax} width="w-12" onCommit={(blur) => update(c.id, { shadow: { ...sh, blur } })} />
          <NumField label={t('slc_shadow_distance')} value={sh.distance} min={0} max={L.shadowMax} width="w-12" onCommit={(distance) => update(c.id, { shadow: { ...sh, distance } })} />
          <NumField label={t('slc_angle')} value={sh.angle} min={0} max={359} width="w-12" onCommit={(angle) => update(c.id, { shadow: { ...sh, angle } })} />
        </>)}
      </div>
      {(c.shape === 'arc' || c.shape === 'ring') && (
        <div className="flex items-center gap-2 flex-wrap">
          {c.shape === 'ring' && <Check label={t('slc_ring_partial')} checked={!!c.arc} onChange={(v) => update(c.id, { arc: v ? { start: 180, end: 0 } : null })} />}
          {(c.shape === 'arc' || c.arc) && (<>
            <NumField label={t('slc_arc_start')} value={c.arc?.start ?? 0} min={0} max={359} width="w-12" onCommit={(start) => update(c.id, { arc: { start, end: c.arc?.end ?? 270 } })} testid="slc-arc-start" />
            <NumField label={t('slc_arc_end')} value={c.arc?.end ?? 270} min={0} max={359} width="w-12" onCommit={(end) => update(c.id, { arc: { start: c.arc?.start ?? 0, end } })} testid="slc-arc-end" />
          </>)}
          {c.shape === 'ring' && <NumField label={t('slc_ring_thickness')} value={Math.round((c.thickness ?? 0.2) * 100)} min={2} max={50} width="w-12" onCommit={(v) => update(c.id, { thickness: v / 100 })} />}
        </div>
      )}
      {c.shape === 'callout' && (() => {
        const tail = c.callout ?? { side: 'bottom' as const, pos: 25, len: 40 }
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_callout_side')}
              <select value={tail.side} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" data-testid="slc-callout-side" onChange={(e) => update(c.id, { callout: { ...tail, side: e.target.value as CalloutTail['side'] } })}>
                {(['top', 'right', 'bottom', 'left'] as const).map((d) => <option key={d} value={d}>{t(`slc_side_${d}` as TKey)}</option>)}
              </select>
            </label>
            <NumField label={t('slc_callout_pos')} value={tail.pos} min={0} max={100} width="w-12" onCommit={(pos) => update(c.id, { callout: { ...tail, pos } })} />
            <NumField label={t('slc_callout_len')} value={tail.len} min={0} max={L.calloutLenMax} width="w-12" onCommit={(len) => update(c.id, { callout: { ...tail, len } })} />
          </div>
        )
      })()}
    </div>
  )
}

function TableEditor(props: EditorProps & { c: TableComponent }) {
  const t = useT()
  const { c, update, ctx } = props
  const rows = c.cells.length
  const cols = c.cells[0]?.length ?? 0
  const L = COMPONENT_LIMITS
  const resize = (nr: number, nc: number) => {
    const blank = (): TableCell => ({ paragraphs: [{ runs: [] }] })
    const cells = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, k) => c.cells[r]?.[k] ?? blank()))
    update(c.id, { cells, colWidths: nc === cols ? c.colWidths : evenColWidths(nc) })
  }
  const setCell = (r: number, k: number, text: string) => {
    const cells: Array<Array<string | TableCell>> = c.cells.map((row, i) => row.map((cell, j) => (i === r && j === k ? text : cell)))
    update(c.id, { cells })
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">{t('slc_table_rows')}</span>
        <button type="button" className="w-6 h-6 rounded border border-gray-200 text-xs disabled:opacity-30" disabled={rows <= 1} onClick={() => resize(rows - 1, cols)}>−</button>
        <span className="text-xs w-5 text-center">{rows}</span>
        <button type="button" className="w-6 h-6 rounded border border-gray-200 text-xs disabled:opacity-30" disabled={rows >= L.tableRows} data-testid="slc-table-add-row" onClick={() => resize(rows + 1, cols)}>＋</button>
        <span className="text-[11px] text-gray-500 ml-2">{t('slc_table_cols')}</span>
        <button type="button" className="w-6 h-6 rounded border border-gray-200 text-xs disabled:opacity-30" disabled={cols <= 1} onClick={() => resize(rows, cols - 1)}>−</button>
        <span className="text-xs w-5 text-center">{cols}</span>
        <button type="button" className="w-6 h-6 rounded border border-gray-200 text-xs disabled:opacity-30" disabled={cols >= L.tableCols} data-testid="slc-table-add-col" onClick={() => resize(rows, cols + 1)}>＋</button>
        <Check label={t('slc_table_header')} checked={c.header} onChange={(v) => update(c.id, { header: v })} />
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse" data-testid="slc-table-grid">
          <tbody>
            {c.cells.map((row, r) => (
              <tr key={r}>
                {row.map((cell, k) => (
                  <td key={k} className="border border-gray-200 p-0">
                    <input key={`${r}-${k}-${plainTextOf(cell.paragraphs)}`} defaultValue={plainTextOf(cell.paragraphs)} maxLength={L.cellChars}
                      data-testid={`slc-cell-${r}-${k}`}
                      className={`w-24 px-1 py-0.5 outline-none ${c.header && r === 0 ? 'font-semibold bg-gray-50' : 'bg-white'}`}
                      onBlur={(e) => { if (e.target.value !== plainTextOf(cell.paragraphs)) setCell(r, k, e.target.value) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ColorField label={t('slc_table_header_fill')} value={c.style.headerFill} ctx={ctx} onChange={(v) => v && update(c.id, { tableStyle: { headerFill: v } })} />
        <ColorField label={t('slc_table_header_color')} value={c.style.headerColor} ctx={ctx} onChange={(v) => v && update(c.id, { tableStyle: { headerColor: v } })} />
        <ColorField label={t('slc_text_color')} value={c.style.color} ctx={ctx} onChange={(v) => v && update(c.id, { tableStyle: { color: v } })} />
        <ColorField label={t('slc_table_band')} value={c.style.bandFill} ctx={ctx} onChange={(v) => v && update(c.id, { tableStyle: { bandFill: v } })} />
        <ColorField label={t('slc_border')} value={c.style.borderColor} ctx={ctx} onChange={(v) => v && update(c.id, { tableStyle: { borderColor: v } })} />
        <NumField label={t('slc_font_size')} value={c.style.size} min={COMPONENT_LIMITS.fontSizeMin} max={COMPONENT_LIMITS.fontSizeMax} onCommit={(size) => update(c.id, { tableStyle: { size } })} width="w-14" />
      </div>
    </div>
  )
}

function ChartEditor(props: EditorProps & { c: ChartComponent }) {
  const t = useT()
  const { c, update } = props
  const L = COMPONENT_LIMITS
  const pie = c.chart === 'pie' || c.chart === 'doughnut'
  const setValue = (si: number, li: number, v: number) => update(c.id, { series: c.series.map((s, i) => (i === si ? { ...s, values: s.values.map((x, j) => (j === li ? v : x)) } : s)) })
  const setLabel = (li: number, v: string) => update(c.id, { labels: c.labels.map((x, j) => (j === li ? v : x)) })
  const setName = (si: number, v: string) => update(c.id, { series: c.series.map((s, i) => (i === si ? { ...s, name: v } : s)) })
  const addRow = () => update(c.id, { labels: [...c.labels, `${c.labels.length + 1}`], series: c.series.map((s) => ({ ...s, values: [...s.values, 0] })) })
  const delRow = () => update(c.id, { labels: c.labels.slice(0, -1), series: c.series.map((s) => ({ ...s, values: s.values.slice(0, -1) })) })
  const addSeries = () => update(c.id, { series: [...c.series, { name: `${c.series.length + 1}`, values: c.labels.map(() => 0) }] })
  const delSeries = () => update(c.id, { series: c.series.slice(0, -1) })
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_chart_kind')}
          <select value={c.chart} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" data-testid="slc-chart-kind" onChange={(e) => update(c.id, { chart: e.target.value as ChartKind })}>
            {CHART_KINDS.map((k) => <option key={k} value={k}>{t(`slc_chart_${k}` as TKey)}</option>)}
          </select>
        </label>
        <Check label={t('slc_chart_legend')} checked={c.legend} onChange={(v) => update(c.id, { legend: v })} />
        <Check label={t('slc_chart_values')} checked={c.showValues} onChange={(v) => update(c.id, { showValues: v })} />
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse" data-testid="slc-chart-grid">
          <thead>
            <tr>
              <th className="border border-gray-200 bg-gray-50 px-1 text-[10px] text-gray-400 font-normal">{t('slc_chart_label')}</th>
              {c.series.map((s, si) => (
                <th key={si} className="border border-gray-200 p-0">
                  <input key={`${si}-${s.name}`} defaultValue={s.name} maxLength={L.chartLabelChars} className="w-20 px-1 py-0.5 bg-gray-50 font-semibold outline-none" disabled={pie && si > 0}
                    onBlur={(e) => { if (e.target.value !== s.name) setName(si, e.target.value) }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.labels.map((lab, li) => (
              <tr key={li}>
                <td className="border border-gray-200 p-0">
                  <input key={`${li}-${lab}`} defaultValue={lab} maxLength={L.chartLabelChars} className="w-20 px-1 py-0.5 outline-none" data-testid={`slc-chart-label-${li}`}
                    onBlur={(e) => { if (e.target.value !== lab) setLabel(li, e.target.value) }} />
                </td>
                {c.series.map((s, si) => (
                  <td key={si} className="border border-gray-200 p-0">
                    <input key={`${si}-${li}-${s.values[li]}`} type="number" defaultValue={s.values[li] ?? 0} className="w-20 px-1 py-0.5 outline-none" data-testid={`slc-chart-v-${si}-${li}`}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== s.values[li]) setValue(si, li, v) }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white disabled:opacity-30" disabled={c.labels.length >= L.chartPoints} onClick={addRow}>＋{t('slc_chart_row')}</button>
        <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white disabled:opacity-30" disabled={c.labels.length <= 1} onClick={delRow}>−{t('slc_chart_row')}</button>
        {!pie && <>
          <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white disabled:opacity-30" disabled={c.series.length >= L.chartSeries} onClick={addSeries}>＋{t('slc_chart_series')}</button>
          <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white disabled:opacity-30" disabled={c.series.length <= 1} onClick={delSeries}>−{t('slc_chart_series')}</button>
        </>}
      </div>
    </div>
  )
}

function HtmlEditor(props: EditorProps) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-gray-500">{t('slc_html_note')}</div>
      <button type="button" data-testid="slc-restore-layout" disabled={props.busy}
        className="px-2 py-1 text-[11px] rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 disabled:opacity-40"
        onClick={async () => {
          if (await confirmDialog({ message: t('slc_restore_confirm') })) props.onOp({ kind: 'page_restore_layout', pageIndex: props.pageIndex, ...(props.pageId ? { pageId: props.pageId } : {}) })
        }}>{t('slc_restore_layout')}</button>
    </div>
  )
}

