'use client'
// 表格「列印」对话框（Excel 版面设定同款）＋列印用的页面 DOM
//   左：列印范围／纸张方向／边界／缩放／每页重复标题／格线·栏列标题·置中／页首页尾；右：即时预览（分页·可翻页）。
//   设定与分页规则在 engine/print.ts（纯函数）；「儲存設定」「列印」都把设定交页面存进这张表的 content.print（每张分页各一份）。
//   真列印：把全部页面画进 body 底下一个专用节点（#dilin-sheet-print-root）＋ @page 尺寸／零边界 CSS ⇒ window.print()；
//     @media print 只露这个节点·每页一张纸（break-after: page）·边界、页首页尾由页面自己画（浏览器自己的页首页尾因零边界不出现）。
//   每页的格：值照网页显示（数字格式）·格式（字体字级粗斜底线删除线、字色底色、对齐、换行、缩排）照 SheetGrid cellStyleCss·
//     条件格式叠色·框线按边画（engine/border borderSegments）·合并格跨栏列·图片三层（格下／格内／浮在上面）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSheetT, useSheetLanguage, useSheetHost } from './host'
import { cellStyleCss } from './SheetGrid'
import { ensureFontsLoaded } from '../../shared/fonts/load'
import { cellKey, indexToCol, isFormulaError, SheetBook, type SheetContent, type BookSheet } from '../engine/formula'
import { coveredMap, parseRange, type Rect } from '../engine/style'
import { borderSegments, lineWidth, cssLineStyle, BORDER_DEFAULT_COLOR } from '../engine/border'
import { buildCondFormatter, condCellCss } from '../engine/cond-format'
import { cellReaderFor, parseRect, type ViewContent } from '../engine/sheet-view'
import { imageLayer } from '../engine/image-layers'
import {
  PAPER_IDS, MARGIN_PRESETS, MARGIN_PRESET_CM, SCALE_MODES, SCALE_MIN, SCALE_MAX, HF_ITEMS, MARGIN_MAX_CM,
  sanitizePrint, resolvePrint, printRect, planPrint, hfText, hfEmpty, parseRowSpan, parseColSpan,
  type SheetPrint, type PrintPlan, type PrintPage, type HFSlots, type MarginPreset, type ScaleMode, type PaperId, type PrintScope,
} from '../engine/print'
import type { SheetTKey as TKey } from '../i18n'

// ── 页面 DOM（预览与真列印同一份） ──────────────────────────────────────

type PageCtx = {
  content: SheetContent
  setup: SheetPrint
  plan: PrintPlan
  sheetName: string
  docTitle: string
  date: string
  pageFmt: string
  lang: 'zh' | 'en'
  imgSrc: (url: string) => string
  onImageError?: (el: HTMLImageElement) => void
}

function usePageCtxParts(content: SheetContent, lang: 'zh' | 'en', book: readonly BookSheet[] | undefined, sheetName: string) {
  return useMemo(() => {
    const ev = book ? { book: new SheetBook(book), sheetName } : undefined   // 跨表引用（表格2!A1）照整份文件算
    const reader = cellReaderFor(content as ViewContent, lang, ev)
    const cond = buildCondFormatter(content, { eval: ev })
    const covered = coveredMap(content.merges)
    const mergeRects = (content.merges ?? []).map(m => parseRange(m)).filter((r): r is Rect => !!r)
    const segments = borderSegments(content.cells ?? {}, mergeRects, k => covered.has(k))
    return { reader, cond, mergeRects, segments }
  }, [content, lang, book, sheetName])
}
type Parts = ReturnType<typeof usePageCtxParts>

const HEAD_CLS = 'absolute flex items-center justify-center border border-gray-300 bg-gray-100 text-[11px] text-gray-500'

function PrintPageView({ ctx, parts, page, index, forPrint }: { ctx: PageCtx; parts: Parts; page: PrintPage; index: number; forPrint?: boolean }) {
  const { content, setup, plan } = ctx
  const cells = content.cells ?? {}
  const colSeq = [...page.titleCols, ...page.cols], rowSeq = [...page.titleRows, ...page.rows]
  // 每栏左缘／每列上缘（未缩放的表格像素·从栏列标题之后起算）
  const xL = new Map<number, number>(), xR = new Map<number, number>(), yT = new Map<number, number>(), yB = new Map<number, number>()
  let x = plan.headW
  for (const c of colSeq) { xL.set(c, x); x += plan.colW(c); xR.set(c, x) }
  let y = plan.headH
  for (const r of rowSeq) { yT.set(r, y); y += plan.rowH(r); yB.set(r, y) }
  const usedW = x, usedH = y
  const colSet = new Set(colSeq), rowSet = new Set(rowSeq)
  const merges = parts.mergeRects.filter(m => colSeq.some(c => c >= m.c0 && c <= m.c1) && rowSeq.some(r => r >= m.r0 && r <= m.r1))
  const mergeOf = (r: number, c: number) => merges.find(m => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1)
  const nodes: ReactNode[] = []
  for (const r of rowSeq) {
    for (const c of colSeq) {
      const m = mergeOf(r, c)
      let w = plan.colW(c), h = plan.rowH(r)
      let srcR = r, srcC = c
      if (m) {
        // 合并区在这页的第一格才画（被分页切开的合并区：每页各画看得到的那一段·字只在含左上格那段）
        const firstC = colSeq.find(cc => cc >= m.c0 && cc <= m.c1), firstR = rowSeq.find(rr => rr >= m.r0 && rr <= m.r1)
        if (firstC !== c || firstR !== r) continue
        w = colSeq.filter(cc => cc >= m.c0 && cc <= m.c1).reduce((s, cc) => s + plan.colW(cc), 0)
        h = rowSeq.filter(rr => rr >= m.r0 && rr <= m.r1).reduce((s, rr) => s + plan.rowH(rr), 0)
        srcR = m.r0; srcC = m.c0
      }
      if (h <= 0) continue
      const key = cellKey(srcR, srcC)
      const showText = srcR === r && srcC === c
      const cd = cells[key]
      const rd = parts.reader(srcR, srcC)
      const err = isFormulaError(rd.text)
      const css: CSSProperties = { ...cellStyleCss(cd?.s, rd.num !== null), ...(condCellCss(parts.cond.at(srcR, srcC), cd?.s) as CSSProperties) }
      const inCell = (content.images ?? []).find(im => im.inCell && im.cell === key)
      const va = css.verticalAlign === 'top' ? 'flex-start' : css.verticalAlign === 'middle' ? 'center' : 'flex-end'
      const ta = css.textAlign === 'center' ? 'center' : css.textAlign === 'right' ? 'flex-end' : 'flex-start'
      nodes.push(
        <div key={`c-${r}-${c}`} data-print-cell={key}
          className={`absolute overflow-hidden px-1.5 flex ${setup.gridlines ? 'border-r border-b border-gray-300' : ''} ${cd?.s?.wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'} ${err ? 'text-red-600' : (cd?.s?.fg ? '' : 'text-gray-800')} ${rd.num !== null && !cd?.s?.font ? 'font-mono' : ''}`}
          style={{ ...css, left: xL.get(c), top: yT.get(r), width: w, height: h, alignItems: va, justifyContent: ta, zIndex: 1, ...(css.backgroundColor ? {} : { backgroundColor: 'transparent' }) }}>
          {inCell ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.imgSrc(inCell.url)} alt="" className="w-full h-full object-contain" onError={e => ctx.onImageError?.(e.currentTarget)} />
          ) : showText ? <span className={cd?.s?.wrap ? 'w-full' : ''} style={{ textAlign: css.textAlign }}>{rd.text}</span> : null}
        </div>,
      )
    }
  }
  // 格线：最左一栏左边、最上一列上边补一条（其余由每格右／下边）
  const grid: ReactNode[] = setup.gridlines && colSeq.length && rowSeq.length ? [
    <div key="gl-l" className="absolute border-l border-gray-300" style={{ left: plan.headW, top: plan.headH, height: usedH - plan.headH, zIndex: 1 }} />,
    <div key="gl-t" className="absolute border-t border-gray-300" style={{ left: plan.headW, top: plan.headH, width: usedW - plan.headW, zIndex: 1 }} />,
  ] : []
  // 框线（按边·同一条边只画一次）
  const lines: ReactNode[] = []
  for (const s of parts.segments) {
    const wpx = lineWidth(s.line.style)
    const border = `${wpx}px ${cssLineStyle(s.line.style)} ${s.line.color || BORDER_DEFAULT_COLOR}`
    if (s.dir === 'h') {
      if (!colSet.has(s.c)) continue
      const yy = yT.get(s.r) ?? yB.get(s.r - 1)
      if (yy === undefined) continue
      lines.push(<div key={s.key} className="absolute" style={{ left: xL.get(s.c), top: yy - wpx / 2, width: plan.colW(s.c), height: 0, borderTop: border, zIndex: 2 }} />)
    } else {
      if (!rowSet.has(s.r)) continue
      const xx = xL.get(s.c) ?? xR.get(s.c - 1)
      if (xx === undefined) continue
      lines.push(<div key={s.key} className="absolute" style={{ left: xx - wpx / 2, top: yT.get(s.r), width: 0, height: plan.rowH(s.r), borderLeft: border, zIndex: 2 }} />)
    }
  }
  // 图片：锚格在这页才画（格下层 z0·浮在上面 z3）
  const picsBelow: ReactNode[] = [], picsAbove: ReactNode[] = []
  for (const im of content.images ?? []) {
    const layer = imageLayer(im)
    if (layer === 'cell') continue
    const a = parseRect(im.cell)
    if (!a || !colSet.has(a.c0) || !rowSet.has(a.r0)) continue
    ;(layer === 'below' ? picsBelow : picsAbove).push(
      <div key={`im-${im.id}`} className="absolute" style={{ left: (xL.get(a.c0) ?? 0) + (im.ox ?? 0), top: (yT.get(a.r0) ?? 0) + (im.oy ?? 0), width: im.w, height: im.h, zIndex: layer === 'below' ? 0 : 3 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ctx.imgSrc(im.url)} alt="" className="w-full h-full object-fill" onError={e => ctx.onImageError?.(e.currentTarget)} />
      </div>,
    )
  }
  // 栏列标题（A B C／1 2 3）
  const heads: ReactNode[] = []
  if (setup.headings) {
    heads.push(<div key="h-corner" className={HEAD_CLS} style={{ left: 0, top: 0, width: plan.headW, height: plan.headH }} />)
    for (const c of colSeq) heads.push(<div key={`hc-${c}`} className={HEAD_CLS} style={{ left: xL.get(c), top: 0, width: plan.colW(c), height: plan.headH }}>{indexToCol(c)}</div>)
    for (const r of rowSeq) if (plan.rowH(r) > 0) heads.push(<div key={`hr-${r}`} className={HEAD_CLS} style={{ left: 0, top: yT.get(r), width: plan.headW, height: plan.rowH(r) }}>{r + 1}</div>)
  }
  const hf = (slots: HFSlots) => (['l', 'c', 'r'] as const).map(k => (
    <span key={k} className={`flex-1 min-w-0 truncate ${k === 'c' ? 'text-center' : k === 'r' ? 'text-right' : 'text-left'}`}>
      {hfText(slots[k], { sheet: ctx.sheetName, title: ctx.docTitle, date: ctx.date, page: index + 1, pages: plan.pages.length, pageFmt: ctx.pageFmt })}
    </span>
  ))
  const m = plan.margins
  return (
    <div className="dsp-page relative overflow-hidden bg-white text-[13px] leading-tight" data-testid="sheet-print-page" data-page={index + 1}
      style={{ width: plan.paperW, height: forPrint ? plan.paperH - 1 : plan.paperH, fontFamily: 'var(--cjk-font)' }}>
      {!hfEmpty(setup.header) && <div className="absolute flex gap-2 text-[12px] text-gray-800" data-testid="sheet-print-header" style={{ left: m.left, right: m.right, top: m.header }}>{hf(setup.header)}</div>}
      {!hfEmpty(setup.footer) && <div className="absolute flex gap-2 text-[12px] text-gray-800" data-testid="sheet-print-footer" style={{ left: m.left, right: m.right, bottom: m.footer }}>{hf(setup.footer)}</div>}
      <div className="absolute overflow-hidden" style={{ left: m.left, top: m.top, width: plan.paperW - m.left - m.right, height: plan.paperH - m.top - m.bottom }}>
        <div className="relative" style={{ width: plan.areaW, height: plan.areaH, transform: plan.scale === 1 ? undefined : `scale(${plan.scale})`, transformOrigin: '0 0' }}>
          <div className="absolute" style={{ left: page.offsetX, top: page.offsetY, width: usedW, height: usedH }}>
            {picsBelow}{heads}{nodes}{grid}{lines}{picsAbove}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 列印节点里的 CSS：萤幕上藏起来；列印时只露它、每页一张纸 */
function printCss(plan: PrintPlan): string {
  const w = (plan.paperW / (96 / 2.54)).toFixed(2), h = (plan.paperH / (96 / 2.54)).toFixed(2)
  return `@media screen { #dilin-sheet-print-root { display: none !important; } }
@media print {
  @page { size: ${w}cm ${h}cm; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#dilin-sheet-print-root) { display: none !important; }
  #dilin-sheet-print-root { display: block !important; }
  #dilin-sheet-print-root .dsp-page { break-after: page; page-break-after: always; }
  #dilin-sheet-print-root .dsp-page:last-child { break-after: auto; page-break-after: auto; }
  #dilin-sheet-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`
}

// ── 对话框 ──────────────────────────────────────────────────────────────

export type SheetPrintDialogProps = {
  content: SheetContent
  /** 整份文件各页签（跨表公式照它算）·省 ⇒ 跨表引用 #REF! */
  book?: readonly BookSheet[]
  sheetName: string
  docTitle: string
  /** 开对话框那一刻的选取（A1 或 A1:B3） */
  selection: string | null
  /** 唯读：设定不存、照样能印 */
  readonly?: boolean
  /** 存设定（交页面写进 content.print·进撤销栈） */
  onSave: (print: SheetPrint) => void
  onClose: () => void
}

const field = 'w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-400'
const labelCls = 'text-[11px] font-medium text-gray-500'

export default function SheetPrintDialog({ content, book, sheetName, docTitle, selection, readonly, onSave, onClose }: SheetPrintDialogProps) {
  const t = useSheetT()
  const { language } = useSheetLanguage()
  const host = useSheetHost()
  const lang: 'zh' | 'en' = language === 'en' ? 'en' : 'zh'
  const saved = useMemo(() => resolvePrint(content), [content])
  const [draft, setDraft] = useState<SheetPrint>(saved)
  const [rangeText, setRangeText] = useState(saved.range ?? '')
  const [rowsText, setRowsText] = useState(saved.titleRows ?? '')
  const [colsText, setColsText] = useState(saved.titleCols ?? '')
  const [pageIdx, setPageIdx] = useState(0)
  const [printing, setPrinting] = useState(false)
  const patch = useCallback((p: Partial<SheetPrint>) => setDraft(d => ({ ...d, ...p })), [])

  const rangeBad = draft.scope === 'range' && !parseRect(rangeText)
  const rowsBad = rowsText.trim() !== '' && !parseRowSpan(rowsText)
  const colsBad = colsText.trim() !== '' && !parseColSpan(colsText)
  // 文字栏 ⇒ 设定（坏的不套·画面上标红）
  const effective = useMemo<SheetPrint>(() => sanitizePrint({
    ...draft,
    range: parseRect(rangeText) ? rangeText : undefined,
    scope: draft.scope === 'range' && !parseRect(rangeText) ? 'sheet' : draft.scope,
    titleRows: parseRowSpan(rowsText) ? rowsText : undefined,
    titleCols: parseColSpan(colsText) ? colsText : undefined,
  })!, [draft, rangeText, rowsText, colsText])
  const rect = useMemo(() => printRect(content as ViewContent, effective, selection), [content, effective, selection])
  const plan = useMemo(() => planPrint({ content: content as ViewContent, setup: effective, rect }), [content, effective, rect])
  const parts = usePageCtxParts(content, lang, book, sheetName)
  const date = useMemo(() => new Date().toLocaleDateString(language === 'en' ? 'en-US' : language === 'zh-CN' ? 'zh-CN' : 'zh-TW'), [language])
  const ctx: PageCtx = { content, setup: effective, plan, sheetName, docTitle, date, pageFmt: t('sheet_print_page_fmt'), lang, imgSrc: url => (host.imageSrc ? host.imageSrc(url) : url), onImageError: host.onImageError }
  const pages = plan.pages.length
  const cur = Math.min(pageIdx, pages - 1)
  useEffect(() => { if (pageIdx > pages - 1) setPageIdx(Math.max(0, pages - 1)) }, [pageIdx, pages])
  useEffect(() => { const ids = new Set<string>(); for (const cd of Object.values(content.cells ?? {})) if (cd?.s?.font) ids.add(cd.s.font); if (ids.size) ensureFontsLoaded(ids) }, [content])

  // 预览按右栏大小缩放
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 600, h: 600 })
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const pv = Math.max(0.1, Math.min((box.w - 32) / plan.paperW, (box.h - 24) / plan.paperH))

  const save = useCallback(() => {
    if (readonly) return
    if (JSON.stringify(effective) !== JSON.stringify(saved)) onSave(effective)   // 没改 ⇒ 不写（旧档开了又关不会长出 print）
  }, [readonly, effective, saved, onSave])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !printing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, printing])

  // 真列印：画进 body 底下的列印节点 ⇒ 等图片字体 ⇒ window.print() ⇒ 收掉
  const doPrint = useCallback(() => { save(); setPrinting(true) }, [save])
  const printRootRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose   // 页面每次重画 onClose 换身 ⇒ 读 ref（⛔ 进依赖：会重跑一次 window.print）
  useEffect(() => {
    if (!printing) return
    let done = false
    const finish = () => { if (done) return; done = true; setPrinting(false); onCloseRef.current() }
    const run = async () => {
      const root = printRootRef.current
      const imgs = root ? [...root.querySelectorAll('img')] : []
      await Promise.race([
        Promise.all(imgs.map(im => (im.complete ? Promise.resolve() : new Promise<void>(res => { im.addEventListener('load', () => res(), { once: true }); im.addEventListener('error', () => res(), { once: true }) })))),
        new Promise(res => setTimeout(res, 4000)),
      ])
      try { await Promise.race([(document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready, new Promise(res => setTimeout(res, 2000))]) } catch { /* 字体等不到也照印 */ }
      window.addEventListener('afterprint', finish, { once: true })
      window.print()
      // 有的浏览器不发 afterprint：列印窗关掉、人回到页面（动滑鼠／按键）才收
      for (const ev of ['mousemove', 'keydown', 'pointerdown'] as const) window.addEventListener(ev, finish, { once: true })
    }
    const id = requestAnimationFrame(() => { void run() })
    return () => { cancelAnimationFrame(id); window.removeEventListener('afterprint', finish); for (const ev of ['mousemove', 'keydown', 'pointerdown'] as const) window.removeEventListener(ev, finish) }
  }, [printing])

  const opt = <K extends string>(value: K, label: string) => <option key={value} value={value}>{label}</option>
  const hfRow = (which: 'header' | 'footer') => (
    <div className="grid grid-cols-3 gap-1.5">
      {(['l', 'c', 'r'] as const).map(k => (
        <label key={k} className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">{t(`sheet_print_hf_${k}` as TKey)}</span>
          <select className={field} value={draft[which][k] ?? ''} data-testid={`sheet-print-${which}-${k}`}
            onChange={e => patch({ [which]: { ...draft[which], [k]: e.target.value || undefined } } as Partial<SheetPrint>)}>
            {opt('', t('sheet_print_hf_none'))}
            {HF_ITEMS.map(it => opt(it, t(`sheet_print_hf_${it}` as TKey)))}
          </select>
        </label>
      ))}
    </div>
  )
  const check = (k: 'gridlines' | 'headings' | 'hCenter' | 'vCenter', label: string) => (
    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
      <input type="checkbox" checked={draft[k]} onChange={e => patch({ [k]: e.target.checked } as Partial<SheetPrint>)} data-testid={`sheet-print-${k}`} className="accent-blue-600" />
      {label}
    </label>
  )
  const marginInput = (k: keyof SheetPrint['margins']) => (
    <label key={k} className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-400">{t(`sheet_print_m_${k}` as TKey)}</span>
      <input type="number" min={0} max={MARGIN_MAX_CM} step={0.1} className={field} value={draft.margins[k]} data-testid={`sheet-print-margin-${k}`}
        onChange={e => patch({ margins: { ...draft.margins, [k]: Number(e.target.value) } })} />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-6" data-testid="sheet-print-dialog" role="dialog" aria-modal="true" aria-label={t('sheet_print_dlg_title')}>
      <div className="absolute inset-0 bg-black/30" onClick={() => { if (!printing) onClose() }} />
      <div className="relative flex h-full max-h-[860px] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5 shrink-0">
          <PrinterIcon className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">{t('sheet_print_dlg_title')}</h2>
          <span className="text-xs text-gray-400 truncate">· {sheetName}</span>
          <button type="button" onClick={onClose} aria-label={t('sheet_print_cancel')} className="ml-auto w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">✕</button>
        </div>
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* ── 左：设定 ── */}
          <div className="md:w-[340px] shrink-0 overflow-y-auto border-b md:border-b-0 md:border-r border-gray-200 px-4 py-3 space-y-4 max-h-[45%] md:max-h-none" data-testid="sheet-print-form">
            <section className="space-y-1.5">
              <div className={labelCls}>{t('sheet_print_scope')}</div>
              {(['sheet', 'selection', 'range'] as PrintScope[]).map(s => (
                <label key={s} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                  <input type="radio" name="sheet-print-scope" checked={draft.scope === s} onChange={() => patch({ scope: s })} data-testid={`sheet-print-scope-${s}`} className="accent-blue-600" />
                  {s === 'selection' ? t('sheet_print_scope_selection').replace('{a}', selection ?? 'A1') : t(`sheet_print_scope_${s}` as TKey)}
                </label>
              ))}
              {draft.scope === 'range' && (
                <>
                  <input className={`${field} ${rangeBad ? 'border-red-400' : ''}`} value={rangeText} placeholder={t('sheet_print_range_ph')} data-testid="sheet-print-range"
                    onChange={e => setRangeText(e.target.value.toUpperCase())} />
                  {rangeBad && <div className="text-[11px] text-red-500">{t('sheet_print_range_bad')}</div>}
                </>
              )}
            </section>
            <section className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>{t('sheet_print_paper')}</span>
                <select className={field} value={draft.paper} onChange={e => patch({ paper: e.target.value as PaperId })} data-testid="sheet-print-paper">
                  {PAPER_IDS.map(p => opt(p, p === 'B5' ? 'B5 (JIS)' : p))}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span className={labelCls}>{t('sheet_print_orientation')}</span>
                <div className="flex rounded-md border border-gray-200 overflow-hidden">
                  {(['portrait', 'landscape'] as const).map(o => (
                    <button key={o} type="button" onClick={() => patch({ orientation: o })} data-testid={`sheet-print-${o}`} aria-pressed={draft.orientation === o}
                      className={`flex-1 py-1 text-xs flex items-center justify-center gap-1 ${draft.orientation === o ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}>
                      <span className={`inline-block border border-current rounded-[1px] ${o === 'portrait' ? 'w-2 h-2.5' : 'w-2.5 h-2'}`} />
                      {t(`sheet_print_${o}` as TKey)}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="space-y-1.5">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>{t('sheet_print_margins')}（{t('sheet_print_cm')}）</span>
                <select className={field} value={draft.marginPreset} data-testid="sheet-print-margin-preset"
                  onChange={e => { const v = e.target.value as MarginPreset; patch(v === 'custom' ? { marginPreset: v } : { marginPreset: v, margins: { ...MARGIN_PRESET_CM[v] } }) }}>
                  {MARGIN_PRESETS.map(p => opt(p, t(`sheet_print_m_${p}` as TKey) + (p === 'custom' ? '' : `（${MARGIN_PRESET_CM[p].top} / ${MARGIN_PRESET_CM[p].left}）`)))}
                </select>
              </label>
              {draft.marginPreset === 'custom' && (
                <div className="grid grid-cols-3 gap-1.5">{(['top', 'bottom', 'left', 'right', 'header', 'footer'] as const).map(marginInput)}</div>
              )}
            </section>
            <section className="space-y-1.5">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>{t('sheet_print_scaling')}</span>
                <select className={field} value={draft.scaleMode} onChange={e => patch({ scaleMode: e.target.value as ScaleMode })} data-testid="sheet-print-scale-mode">
                  {SCALE_MODES.map(s => opt(s, t(`sheet_print_s_${s}` as TKey)))}
                </select>
              </label>
              {draft.scaleMode === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input type="number" min={SCALE_MIN} max={SCALE_MAX} step={5} className={`${field} w-24`} value={draft.scale} data-testid="sheet-print-scale"
                    onChange={e => patch({ scale: Number(e.target.value) })} />
                  <span className="text-xs text-gray-500">%（{SCALE_MIN}–{SCALE_MAX}）</span>
                </div>
              )}
            </section>
            <section className="space-y-1.5">
              <div className={labelCls}>{t('sheet_print_titles')}</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-400">{t('sheet_print_title_rows')}</span>
                  <input className={`${field} ${rowsBad ? 'border-red-400' : ''}`} value={rowsText} placeholder={t('sheet_print_title_rows_ph')} onChange={e => setRowsText(e.target.value)} data-testid="sheet-print-title-rows" />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-400">{t('sheet_print_title_cols')}</span>
                  <input className={`${field} ${colsBad ? 'border-red-400' : ''}`} value={colsText} placeholder={t('sheet_print_title_cols_ph')} onChange={e => setColsText(e.target.value.toUpperCase())} data-testid="sheet-print-title-cols" />
                </label>
              </div>
            </section>
            <section className="space-y-1.5">
              <div className={labelCls}>{t('sheet_print_options')}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {check('gridlines', t('sheet_print_gridlines'))}
                {check('hCenter', t('sheet_print_hcenter'))}
                {check('headings', t('sheet_print_headings'))}
                {check('vCenter', t('sheet_print_vcenter'))}
              </div>
            </section>
            <section className="space-y-1.5">
              <div className={labelCls}>{t('sheet_print_header')}</div>
              {hfRow('header')}
              <div className={`${labelCls} pt-1`}>{t('sheet_print_footer')}</div>
              {hfRow('footer')}
            </section>
            <div className="text-[11px] text-gray-400">{readonly ? t('sheet_print_readonly_note') : t('sheet_print_saved_note')}</div>
          </div>
          {/* ── 右：预览 ── */}
          <div className="flex flex-1 min-h-0 min-w-0 flex-col bg-gray-100">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 shrink-0">
              <span className="font-medium text-gray-600">{t('sheet_print_preview')}</span>
              <span>{effective.paper} · {t(`sheet_print_${effective.orientation}` as TKey)} · {t('sheet_print_scale_now').replace('{p}', String(Math.round(plan.scale * 100)))}</span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setPageIdx(Math.max(0, cur - 1))} disabled={cur <= 0} title={t('sheet_print_prev')} aria-label={t('sheet_print_prev')} data-testid="sheet-print-prev"
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40">‹</button>
                <span className="min-w-[96px] text-center tabular-nums" data-testid="sheet-print-pageno">{t('sheet_print_page_fmt').replace('{n}', String(cur + 1)).replace('{m}', String(pages))}</span>
                <button type="button" onClick={() => setPageIdx(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1} title={t('sheet_print_next')} aria-label={t('sheet_print_next')} data-testid="sheet-print-next"
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40">›</button>
              </div>
            </div>
            <div ref={boxRef} className="flex-1 min-h-[220px] overflow-hidden flex items-start justify-center pb-3" data-testid="sheet-print-preview">
              <div className="shadow-lg ring-1 ring-black/5" style={{ width: plan.paperW * pv, height: plan.paperH * pv }}>
                <div style={{ transform: `scale(${pv})`, transformOrigin: '0 0', width: plan.paperW, height: plan.paperH }}>
                  {plan.pages[cur] && <PrintPageView ctx={ctx} parts={parts} page={plan.pages[cur]} index={cur} />}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-2.5 shrink-0">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100" data-testid="sheet-print-cancel">{t('sheet_print_cancel')}</button>
          {!readonly && (
            <button type="button" onClick={() => { save(); onClose() }} disabled={rangeBad || rowsBad || colsBad} className="px-3 py-1.5 rounded-md border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50" data-testid="sheet-print-save">{t('sheet_print_save')}</button>
          )}
          <button type="button" onClick={doPrint} disabled={printing || rangeBad || rowsBad || colsBad} data-testid="sheet-print-go"
            className="px-4 py-1.5 rounded-md bg-blue-600 text-xs font-medium keep-white hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
            <PrinterIcon className="w-3.5 h-3.5" />{printing ? t('sheet_print_preparing') : t('sheet_print_go')}
          </button>
        </div>
      </div>
      {printing && typeof document !== 'undefined' && createPortal(
        <div id="dilin-sheet-print-root" ref={printRootRef} data-testid="sheet-print-root">
          <style>{printCss(plan)}</style>
          {plan.pages.map((pg, i) => <PrintPageView key={i} ctx={ctx} parts={parts} page={pg} index={i} forPrint />)}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** 印表机图示（Heroicons 24 outline·MIT） */
export function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
    </svg>
  )
}
