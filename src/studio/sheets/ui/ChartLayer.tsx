'use client'
// 表格图表层
//   自写 SVG（⛔ 加图表库）：资料拆解与版面全在 engine/chart.ts（layoutChart 出图元·这里只把图元画成 <rect>/<path>/<text>）；
//   值从求值器拿（contentReader·公式算好的值）⇒ content 一变 useMemo 重算 ⇒ 图跟着变。
//   位置＝锚格左上（SheetGrid 量出的几何 geo）＋ox/oy×zoom·大小 w/h×zoom（资料存 100% 口径·同浮图）；z-[15] 同上层图·排在图片之后＝在图片之上。
//   互动：点选（蓝框）·拖动搬位（放手按左上角落点反查锚格）·右下角拉大小（宽高各自）·× 删·Delete 键删·双击／右键「編輯圖表」开面板·
//     右键上移下移到顶到底（图表之间排·不跟图片混排——取舍见 chart.ts 头注）。每个动作经 onCharts 交 SheetGrid emit ⇒ 进撤销栈＋存档。
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import type { SheetTKey as TKey } from '../i18n'
import type { SheetContent, EvaluatorOptions } from '../engine/formula'
import { hitIndex } from '../engine/layout'
import {
  CHART_TYPES, CHARTS_MAX, CHART_DEFAULT_W, CHART_DEFAULT_H, CHART_SIDE_MIN, CHART_SIDE_MAX,
  chartData, contentReader, layoutChart, colorAt, paletteColor, effectiveLegend, isPieLike, moveChartZ, newChartId,
  parseChartRange, chartRangeKey, defaultChartAnchor, sanitizeChartColors,
  type SheetChart, type ChartType, type ChartData, type ChartPrim, type ChartZMove,
} from '../engine/chart'

export type ChartGeo = { colL: number[]; colR: number[]; rowT: number[]; rowB: number[] }
export type ChartLayerHandle = {
  /** 工具栏「插入圖表」：用这块区间开插入面板 */
  openInsert: (range: string) => void
}
type Props = {
  charts: SheetChart[]
  content: SheetContent
  /** 求值选项（带 book ⇒ 资料格里的跨表公式算得出） */
  evalOpts?: EvaluatorOptions
  geo: ChartGeo | null
  zoom: number
  readonly?: boolean
  locked?: boolean
  /** 改动交出去（label＝撤销栈字尾 sheet_hist_<label>） */
  onCharts: (next: SheetChart[], label: string) => void
}

const clampSide = (v: number) => Math.max(CHART_SIDE_MIN, Math.min(CHART_SIDE_MAX, Math.round(v)))
const COLOR_EDIT_MAX = 12

/** 一张图的 SVG（图元 ⇒ 元素·<title> 当悬停提示） */
export function ChartSvg({ chart, data, zoom, seriesName, emptyText }: { chart: SheetChart; data: ChartData | null; zoom: number; seriesName: (i: number) => string; emptyText: string }) {
  const scene = useMemo(() => layoutChart(chart, data, { seriesName, emptyText }), [chart, data, seriesName, emptyText])
  const el = (p: ChartPrim, i: number) => {
    const tip = 'tip' in p && p.tip ? <title>{p.tip}</title> : null
    switch (p.k) {
      case 'rect': return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill} data-role={p.role}>{tip}</rect>
      case 'path': return <path key={i} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.sw} strokeLinejoin="round" strokeLinecap="round" data-role={p.role}>{tip}</path>
      case 'line': return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={p.sw} shapeRendering="crispEdges" data-role={p.role} />
      case 'circle': return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} stroke={p.stroke} strokeWidth={p.sw}>{tip}</circle>
      case 'text': return <text key={i} x={p.x} y={p.y} fontSize={p.size} textAnchor={p.anchor} fill={p.fill} fontWeight={p.bold ? 700 : 400} data-role={p.role}>{p.s}</text>
    }
  }
  return (
    <svg data-testid="sheet-chart-svg" width={chart.w * zoom} height={chart.h * zoom} viewBox={`0 0 ${chart.w} ${chart.h}`} className="block select-none" style={{ fontFamily: 'inherit' }}>
      <rect x={0} y={0} width={chart.w} height={chart.h} fill="#ffffff" />
      {scene.prims.map(el)}
    </svg>
  )
}

type Draft = { mode: 'insert' | 'edit'; id?: string; type: ChartType; range: string; showTitle: boolean; title: string; legend: boolean; labels: boolean; colors: string[]; err?: string }

const ChartLayer = forwardRef<ChartLayerHandle, Props>(function ChartLayer({ charts, content, evalOpts, geo, zoom, readonly, locked, onCharts }, ref) {
  const t = useSheetT()
  const seriesName = useCallback((i: number) => t('sheet_chart_series').replace('{a}', String(i + 1)), [t])
  const emptyText = t('sheet_chart_empty')
  const read = useMemo(() => contentReader(content, evalOpts), [content, evalOpts])
  const datas = useMemo(() => new Map(charts.map(ch => [ch.id, chartData(ch, read)])), [charts, read])
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const editable = !readonly && !locked
  const lockedRef = useRef(false); lockedRef.current = !editable

  const posOf = useCallback((ch: SheetChart): { x: number; y: number } | null => {
    if (!geo) return null
    const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(ch.cell); if (!m) return null
    const r = Number(m[2]) - 1, c = m[1].split('').reduce((s, x) => s * 26 + x.charCodeAt(0) - 64, 0) - 1
    if (r >= geo.rowT.length || c >= geo.colL.length) return null   // 网页网格画不到（A1:Z100 外）
    return { x: geo.colL[c] + (ch.ox ?? 0) * zoom, y: geo.rowT[r] + (ch.oy ?? 0) * zoom }
  }, [geo, zoom])

  const commit = useCallback((next: SheetChart[], label: string) => { if (!lockedRef.current) onCharts(next, label) }, [onCharts])
  const remove = useCallback((id: string) => { commit(charts.filter(c => c.id !== id), 'chart_delete'); setSelected(null) }, [charts, commit])

  // 点到图表／选单／面板以外 ⇒ 取消选取；选中时 Delete／Backspace 删图（抢在网格清格之前）
  useEffect(() => {
    if (!selected && !menu) return
    const down = (e: MouseEvent) => {
      const tg = e.target as Node
      if (menuRef.current?.contains(tg)) return
      if (!(rootRef.current?.contains(tg))) { setMenu(null); if (!panelRef.current?.contains(tg)) setSelected(null) }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenu(null); setSelected(null); return }
      if (!selected || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      const a = document.activeElement as HTMLElement | null
      if (a && a.tagName === 'INPUT' && a.dataset.testid !== 'sheet-key-input') return   // 正在别的输入框打字
      if (a && (a.tagName === 'TEXTAREA' || a.isContentEditable)) return
      if (!editable) return
      e.preventDefault(); e.stopPropagation()
      remove(selected)
    }
    window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true) }
  }, [selected, menu, editable, remove])

  // 拖动／拉角
  const startDrag = (ch: SheetChart, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelected(ch.id); setMenu(null)
    if (!editable) return
    e.preventDefault()
    const p = posOf(ch); if (!p) return
    const sx = e.clientX, sy = e.clientY
    const st = { id: ch.id, x: p.x, y: p.y, w: ch.w, h: ch.h }
    setDrag(st)
    const calc = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      return mode === 'move' ? { ...st, x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) } : { ...st, w: clampSide(ch.w + dx / zoom), h: clampSide(ch.h + dy / zoom) }
    }
    const onMove = (ev: PointerEvent) => setDrag(calc(ev))
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
      setDrag(null)
      if (Math.abs(ev.clientX - sx) < 1 && Math.abs(ev.clientY - sy) < 1) return   // 只是点一下 ⇒ 不进撤销栈
      const d = calc(ev)
      if (mode === 'resize') { commit(charts.map(c => (c.id === ch.id ? { ...c, w: d.w, h: d.h } : c)), 'chart_resize'); return }
      if (!geo || !geo.colL.length || !geo.rowT.length) return
      const c = hitIndex(geo.colL, geo.colR, d.x + 1), r = hitIndex(geo.rowT, geo.rowB, d.y + 1)
      const col = (n: number) => { let s = ''; for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s }
      const ox = Math.max(0, Math.round((d.x - geo.colL[c]) / zoom)), oy = Math.max(0, Math.round((d.y - geo.rowT[r]) / zoom))
      commit(charts.map(x => {
        if (x.id !== ch.id) return x
        const n: SheetChart = { ...x, cell: `${col(c)}${r + 1}` }
        if (ox) n.ox = ox; else delete n.ox
        if (oy) n.oy = oy; else delete n.oy
        return n
      }), 'chart_move')
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  // ── 面板（插入／编辑） ──
  const draftFrom = useCallback((ch: SheetChart): Draft => {
    const d = datas.get(ch.id) ?? null
    const n = Math.min(COLOR_EDIT_MAX, d ? (isPieLike(ch.type) ? d.categories.length : d.series.length) : 1)
    return {
      mode: 'edit', id: ch.id, type: ch.type, range: ch.range, showTitle: ch.title !== '', title: ch.title ?? '',
      legend: effectiveLegend(ch, d), labels: !!ch.labels, colors: Array.from({ length: Math.max(1, n) }, (_, i) => colorAt(ch, i)),
    }
  }, [datas])
  useImperativeHandle(ref, () => ({
    openInsert(range: string) {
      if (!editable) return
      setMenu(null)
      const rect = parseChartRange(range)
      const probe: SheetChart = { id: '_', type: 'column', range: rect ? chartRangeKey(rect) : range, cell: 'A1', w: CHART_DEFAULT_W, h: CHART_DEFAULT_H }
      const d = rect ? chartData(probe, read) : null
      setDraft({ mode: 'insert', type: 'column', range: probe.range, showTitle: true, title: '', legend: effectiveLegend(probe, d), labels: false,
        colors: Array.from({ length: Math.max(1, Math.min(COLOR_EDIT_MAX, d?.series.length ?? 1)) }, (_, i) => paletteColor(i)) })
    },
  }), [editable, read])

  // 换类型 ⇒ 颜色格子数跟着换（圆饼按类别·其余按系列）
  const setDraftType = (type: ChartType) => setDraft(dr => {
    if (!dr) return dr
    const rect = parseChartRange(dr.range)
    const d = rect ? chartData({ range: chartRangeKey(rect) }, read) : null
    const n = Math.max(1, Math.min(COLOR_EDIT_MAX, d ? (isPieLike(type) ? d.categories.length : d.series.length) : 1))
    const colors = Array.from({ length: n }, (_, i) => dr.colors[i] ?? paletteColor(i))
    const legend = dr.mode === 'insert' ? effectiveLegend({ type }, d) : dr.legend
    return { ...dr, type, colors, legend }
  })

  const saveDraft = () => {
    if (!draft) return
    const rect = parseChartRange(draft.range.replace(/^.*!/, ''))
    if (!rect) { setDraft({ ...draft, err: t('sheet_chart_range_bad') }); return }
    const range = chartRangeKey(rect)
    const d = chartData({ range }, read)
    const colors = sanitizeChartColors(draft.colors.map((c, i) => (c.toLowerCase() === paletteColor(i) ? '' : c)))
    const autoLegend = effectiveLegend({ type: draft.type }, d)
    const apply = (base: SheetChart): SheetChart => {
      const n: SheetChart = { ...base, type: draft.type, range }
      if (!draft.showTitle) n.title = ''
      else if (draft.title.trim()) n.title = draft.title.trim()
      else delete n.title
      if (colors) n.colors = colors; else delete n.colors
      if (draft.legend !== autoLegend) n.legend = draft.legend; else delete n.legend
      if (draft.labels) n.labels = true; else delete n.labels
      return n
    }
    if (draft.mode === 'insert') {
      if (charts.length >= CHARTS_MAX) { setDraft({ ...draft, err: t('sheet_chart_max') }); return }
      const ch = apply({ id: newChartId(charts), type: draft.type, range, cell: defaultChartAnchor(rect), w: CHART_DEFAULT_W, h: CHART_DEFAULT_H })
      commit([...charts, ch], 'chart'); setSelected(ch.id)
    } else {
      const cur = charts.find(c => c.id === draft.id)
      if (cur) commit(charts.map(c => (c.id === cur.id ? apply(cur) : c)), 'chart_edit')
    }
    setDraft(null)
  }

  const typeIcon = (k: ChartType) => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {k === 'column' && <path d="M5 20V12M10 20V6M15 20V10M20 20V4M3 20h18" />}
      {k === 'bar' && <path d="M4 5h10M4 10h16M4 15h7M4 20h13M4 3v19" />}
      {k === 'line' && <path d="M3 20h18M4 16l5-6 4 3 7-8" />}
      {k === 'pie' && <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 2.5A9 9 0 0 1 21.5 9H15z" /></>}
      {k === 'doughnut' && <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v5M21 12h-5" /></>}
    </svg>
  )

  return (
    <>
      <div ref={rootRef} data-testid="sheet-chart-layer">
        {charts.map(ch => {
          const p0 = posOf(ch); if (!p0) return null
          const d = drag?.id === ch.id ? drag : null
          const p = d ? { x: d.x, y: d.y } : p0
          const shown = d ? { ...ch, w: d.w, h: d.h } : ch
          const sel = selected === ch.id
          return (
            <div key={ch.id} data-testid="sheet-chart" data-chart-id={ch.id} data-chart-type={ch.type} data-chart-cell={ch.cell}
              className={`absolute z-[15] bg-white border ${sel ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-300 hover:border-blue-300'}`}
              style={{ left: p.x, top: p.y, width: shown.w * zoom, height: shown.h * zoom, cursor: editable ? 'move' : 'default', pointerEvents: d ? 'none' : 'auto' }}
              onPointerDown={startDrag(ch, 'move')}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); setSelected(ch.id) }}
              onDoubleClick={e => { e.stopPropagation(); if (editable) setDraft(draftFrom(ch)) }}
              onContextMenu={e => { if (readonly) return; e.preventDefault(); e.stopPropagation(); setSelected(ch.id); setMenu({ id: ch.id, x: e.clientX, y: e.clientY }) }}>
              <ChartSvg chart={shown} data={datas.get(ch.id) ?? null} zoom={zoom} seriesName={seriesName} emptyText={emptyText} />
              {sel && editable && (
                <>
                  <button type="button" title={t('sheet_chart_delete')} data-testid="sheet-chart-delete"
                    onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); remove(ch.id) }}
                    className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-600 text-xs leading-none flex items-center justify-center shadow hover:bg-red-50 hover:text-red-600">×</button>
                  <div data-testid="sheet-chart-resize" onPointerDown={startDrag(ch, 'resize')}
                    className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-500 border border-white rounded-sm cursor-nwse-resize" />
                </>
              )}
            </div>
          )
        })}
      </div>

      {menu && (() => {
        const ch = charts.find(c => c.id === menu.id)
        if (!ch) return null
        const z = (m: ChartZMove) => moveChartZ(charts, ch.id, m)
        const item = (id: string, label: string, run: () => void, disabled = false) => (
          <button key={id} type="button" data-testid={`sheet-chart-menu-${id}`} disabled={disabled || !editable}
            onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); if (!disabled && editable) run() }}
            className={`${editorShell.menuItem} ${disabled || !editable ? 'opacity-40 cursor-default' : ''}`}>{label}</button>
        )
        const left = Math.max(4, Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 196))
        const top = Math.max(4, Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 240))
        return (
          <div ref={menuRef} data-testid="sheet-chart-menu" role="menu" className={`fixed z-[60] w-[188px] ${editorShell.menu}`} style={{ left, top }} onContextMenu={e => e.preventDefault()}>
            {item('edit', t('sheet_chart_edit'), () => setDraft(draftFrom(ch)))}
            <div className="my-1 border-t border-gray-100" />
            {(['up', 'down', 'top', 'bottom'] as const).map(m => item(`z-${m}`, t(`sheet_img_z_${m}` as TKey), () => commit(z(m), 'chart_layer'), z(m) === charts))}
            <div className="my-1 border-t border-gray-100" />
            {item('delete', t('sheet_chart_delete'), () => remove(ch.id))}
          </div>
        )
      })()}

      {draft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20" data-testid="sheet-chart-panel-backdrop"
          onMouseDown={e => { if (e.target === e.currentTarget) setDraft(null) }}>
          <div ref={panelRef} data-testid="sheet-chart-panel" role="dialog" aria-label={t(draft.mode === 'insert' ? 'sheet_chart_insert_title' : 'sheet_chart_edit')}
            className="w-[380px] max-w-[94vw] rounded-lg border border-gray-200 bg-white p-4 shadow-xl text-sm text-gray-700"
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setDraft(null) } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); saveDraft() } }}>
            <div className="mb-3 font-semibold text-gray-900">{t(draft.mode === 'insert' ? 'sheet_chart_insert_title' : 'sheet_chart_edit')}</div>
            <div className="mb-3 grid grid-cols-5 gap-1" role="radiogroup">
              {CHART_TYPES.map(k => (
                <button key={k} type="button" role="radio" aria-checked={draft.type === k} data-testid={`sheet-chart-type-${k}`} onClick={() => setDraftType(k)}
                  className={`flex flex-col items-center gap-1 rounded border px-1 py-1.5 text-[11px] ${draft.type === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                  {typeIcon(k)}<span>{t(`sheet_chart_type_${k}` as TKey)}</span>
                </button>
              ))}
            </div>
            <label className="mb-1 block text-xs text-gray-500">{t('sheet_chart_range')}</label>
            <input data-testid="sheet-chart-range" value={draft.range} onChange={e => setDraft({ ...draft, range: e.target.value, err: undefined })}
              className="mb-1 h-8 w-full rounded border border-gray-300 px-2 font-mono text-sm focus:border-blue-400 focus:outline-none" />
            <div className="mb-3 text-[11px] text-gray-400">{t('sheet_chart_range_hint')}</div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-gray-500">{t('sheet_chart_title')}</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" data-testid="sheet-chart-show-title" checked={draft.showTitle} onChange={e => setDraft({ ...draft, showTitle: e.target.checked })} />{t('sheet_chart_show_title')}</label>
            </div>
            <input data-testid="sheet-chart-title" value={draft.title} disabled={!draft.showTitle} placeholder={t('sheet_chart_title_auto')}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              className="mb-3 h-8 w-full rounded border border-gray-300 px-2 text-sm focus:border-blue-400 focus:outline-none disabled:bg-gray-50" />
            <div className="mb-3 flex gap-4 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" data-testid="sheet-chart-legend" checked={draft.legend} onChange={e => setDraft({ ...draft, legend: e.target.checked })} />{t('sheet_chart_legend')}</label>
              <label className="flex items-center gap-1"><input type="checkbox" data-testid="sheet-chart-labels" checked={draft.labels} onChange={e => setDraft({ ...draft, labels: e.target.checked })} />{t('sheet_chart_labels')}</label>
            </div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-gray-500">{t('sheet_chart_colors')}</span>
              <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setDraft({ ...draft, colors: draft.colors.map((_, i) => paletteColor(i)) })}>{t('sheet_chart_colors_reset')}</button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5" data-testid="sheet-chart-colors">
              {draft.colors.map((c, i) => (
                <input key={i} type="color" value={c} aria-label={`${t('sheet_chart_colors')} ${i + 1}`}
                  onChange={e => setDraft({ ...draft, colors: draft.colors.map((x, k) => (k === i ? e.target.value : x)) })}
                  className="h-7 w-7 cursor-pointer rounded border border-gray-300 p-0.5" />
              ))}
            </div>
            {draft.err && <div className="mb-2 text-xs text-red-600" data-testid="sheet-chart-err">{draft.err}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className="h-8 rounded border border-gray-300 px-3 text-xs hover:bg-gray-50">{t('sheet_chart_cancel')}</button>
              <button type="button" data-testid="sheet-chart-ok" onClick={saveDraft} className="h-8 rounded bg-blue-600 px-3 text-xs text-white hover:bg-blue-700">{t('sheet_chart_ok')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
})

export default ChartLayer
