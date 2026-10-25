'use client'
// 工具栏「邊框」下拉＋「其他邊框…」对话框
//   下拉（照 WPS 图的顺序·图标各一）：無框線／所有框線／外側框線／粗匣框線／全表框線｜下框線／上框線／左框線／右框線｜其他邊框…｜
//     繪圖邊框／繪圖邊框網格／擦除邊框／線條顏色 ›／線條樣式 ›（斜線表頭 VIP 不做）
//   其他邊框…：预设（無／外框／內部）＋六个方向钮（上／內部橫／下／左／內部直／右）＋可点的预览图＋线型六种＋颜色（色盘走 palette）
// 出处：选项清单与线型清单参考 univer（Apache-2.0·Copyright 2023-present DreamNum Co., Ltd.）packages/sheets-ui/src/views/border-panel/interface.ts
//   （BORDER_LINE_CHILDREN／BORDER_SIZE_CHILDREN）与 fortune-sheet（MIT）packages/react/src/components/Toolbar/index.tsx 边框菜单；
//   两仓都没有「绘图边框／擦除边框」与 Excel 式「其他边框」对话框 ⇒ 这两块 UI 自写。套用逻辑在 engine/border.ts。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { BORDER_STYLES, BORDER_DEFAULT_COLOR, lineWidth, sameLine, type BorderEdges, type BorderKind, type BorderLine, type BorderPen, type BorderStyle } from '../engine/border'

export type DrawMode = 'outline' | 'grid' | 'erase'
type EdgeKey = keyof BorderEdges
const EDGE_KEYS: EdgeKey[] = ['top', 'insideH', 'bottom', 'left', 'insideV', 'right']

/** 小图标：虚线田字格＋实线画出这一项会加的边 */
export function BorderIcon({ on, thick, erase, pencil, grid }: { on?: EdgeKey[] | 'none'; thick?: boolean; erase?: boolean; pencil?: boolean; grid?: boolean }) {
  const has = (k: EdgeKey) => Array.isArray(on) && on.includes(k)
  const sw = thick ? 3 : 1.6
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="square">
      <g strokeWidth={1} strokeDasharray="1 1.5" opacity={0.45}><rect x="1.5" y="1.5" width="13" height="13" /><path d="M8 1.5v13M1.5 8h13" /></g>
      <g strokeWidth={sw}>
        {has('top') && <path d="M1.5 1.5h13" />}
        {has('bottom') && <path d="M1.5 14.5h13" />}
        {has('left') && <path d="M1.5 1.5v13" />}
        {has('right') && <path d="M14.5 1.5v13" />}
        {has('insideH') && <path d="M1.5 8h13" />}
        {has('insideV') && <path d="M8 1.5v13" />}
      </g>
      {pencil && <path d="M9.5 3.5 12.5 6.5 6 13H3v-3z" strokeWidth={1.3} fill="white" strokeLinejoin="round" />}
      {grid && <path d="M1.5 1.5h13v13h-13zM8 1.5v13M1.5 8h13" strokeWidth={1.3} />}
      {erase && <path d="M6.5 13.5h7M3 10l5-5 4 4-4.5 4.5H5z" strokeWidth={1.3} fill="white" strokeLinejoin="round" />}
    </svg>
  )
}

/** 线型的小示意（下拉／对话框共用） */
export function LineSample({ style, color, width = 56 }: { style: BorderStyle; color?: string; width?: number }) {
  const w = lineWidth(style)
  const c = color || BORDER_DEFAULT_COLOR
  return (
    <svg width={width} height={10} viewBox={`0 0 ${width} 10`} className="shrink-0">
      {style === 'double'
        ? <><line x1={2} x2={width - 2} y1={3.5} y2={3.5} stroke={c} strokeWidth={1} /><line x1={2} x2={width - 2} y1={6.5} y2={6.5} stroke={c} strokeWidth={1} /></>
        : <line x1={2} x2={width - 2} y1={5} y2={5} stroke={c} strokeWidth={w} strokeDasharray={style === 'dashed' ? '4 2' : style === 'dotted' ? '1 2' : undefined} />}
    </svg>
  )
}

type MenuProps = {
  open: boolean
  onClose: () => void
  pen: BorderPen
  drawMode: DrawMode | null
  swatches: string[]
  onKind: (k: BorderKind) => void
  onMore: () => void
  onDraw: (m: DrawMode) => void
  onPen: (p: Partial<BorderPen>) => void
}

/** 边框下拉（WPS 顺序） */
export function BorderMenu({ open, onClose, pen, drawMode, swatches, onKind, onMore, onDraw, onPen }: MenuProps) {
  const t = useSheetT()
  const ref = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<'color' | 'style' | null>(null)
  useEffect(() => {
    if (!open) { setSub(null); return }
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])
  if (!open) return null
  const item = (testid: string, label: ReactNode, icon: ReactNode, onClick: () => void, extra?: { active?: boolean; arrow?: boolean; onEnter?: () => void }) => (
    <button key={testid} type="button" data-testid={testid} onMouseDown={e => e.preventDefault()} onClick={onClick} onMouseEnter={extra?.onEnter ?? (() => setSub(null))}
      className={`${editorShell.menuItem} w-full flex items-center gap-2 px-2 py-1.5 text-left whitespace-nowrap ${extra?.active ? 'bg-blue-50 text-blue-700' : ''}`}>
      {icon}<span className="flex-1 text-[13px]">{label}</span>{extra?.arrow && <span className="text-gray-400 text-xs">›</span>}
    </button>
  )
  const kind = (k: BorderKind, on: EdgeKey[] | 'none', opts?: { thick?: boolean; sub?: string }) =>
    item(`tb-border-${k}`, <span className="flex flex-col leading-tight"><span>{t(`sheet_bd_${k}` as 'sheet_bd_all')}</span>{opts?.sub && <span className="text-[10px] text-gray-400">{opts.sub}</span>}</span>,
      <BorderIcon on={on} thick={opts?.thick} />, () => { onKind(k); onClose() })
  const sep = (k: string) => <div key={k} className="my-1 h-px bg-gray-100" />
  return (
    <div ref={ref} data-testid="tb-border-popover" className={`absolute left-0 top-full mt-1 z-50 ${editorShell.menu} p-1 w-[208px]`}>
      <div className="px-2 pt-1 pb-1 text-[11px] text-gray-400">{t('sheet_tb_border')}</div>
      {kind('none', 'none')}
      {kind('all', ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'])}
      {kind('outside', ['top', 'bottom', 'left', 'right'])}
      {kind('thickBox', ['top', 'bottom', 'left', 'right'], { thick: true })}
      {kind('wholeTable', ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'], { sub: t('sheet_bd_wholeTable_sub') })}
      {sep('s1')}
      {kind('bottom', ['bottom'])}
      {kind('top', ['top'])}
      {kind('left', ['left'])}
      {kind('right', ['right'])}
      {sep('s2')}
      {item('tb-border-more', t('sheet_bd_more'), <BorderIcon on={['top', 'left']} />, () => { onMore(); onClose() })}
      {sep('s3')}
      {item('tb-border-draw', t('sheet_bd_draw'), <BorderIcon pencil />, () => { onDraw('outline'); onClose() }, { active: drawMode === 'outline' })}
      {item('tb-border-draw-grid', t('sheet_bd_draw_grid'), <BorderIcon grid pencil />, () => { onDraw('grid'); onClose() }, { active: drawMode === 'grid' })}
      {item('tb-border-erase', t('sheet_bd_erase'), <BorderIcon erase />, () => { onDraw('erase'); onClose() }, { active: drawMode === 'erase' })}
      <div className="relative">
        {item('tb-border-color', t('sheet_bd_color'), <span className="w-4 h-4 flex items-center justify-center"><span className="w-3.5 h-3.5 rounded-sm border border-black/10" style={{ backgroundColor: pen.color || BORDER_DEFAULT_COLOR }} /></span>, () => setSub(s => (s === 'color' ? null : 'color')), { arrow: true, onEnter: () => setSub('color') })}
        {sub === 'color' && (
          <div data-testid="tb-border-color-menu" className={`absolute left-full top-0 ml-1 ${editorShell.menu} p-2 w-[168px]`}>
            <button type="button" data-testid="tb-border-color-auto" onMouseDown={e => e.preventDefault()} onClick={() => { onPen({ color: undefined }); onClose() }}
              className={`${editorShell.menuItem} w-full flex items-center gap-2 px-1.5 py-1 mb-1 text-[12px]`}>
              <span className="w-4 h-4 rounded-sm border border-black/10" style={{ backgroundColor: BORDER_DEFAULT_COLOR }} />{t('sheet_bd_color_auto')}
            </button>
            <div className="grid grid-cols-6 gap-1">
              {swatches.map(c => (
                <button key={c} type="button" title={c} data-color={c} data-testid={`tb-border-color-${c.replace('#', '')}`} onMouseDown={e => e.preventDefault()}
                  onClick={() => { onPen({ color: c }); onClose() }}
                  className={`w-5 h-5 rounded border ${pen.color === c ? 'border-blue-500 ring-1 ring-blue-300' : 'border-black/10'}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="relative">
        {item('tb-border-style', t('sheet_bd_style'), <LineSample style={pen.style} color={pen.color} width={16} />, () => setSub(s => (s === 'style' ? null : 'style')), { arrow: true, onEnter: () => setSub('style') })}
        {sub === 'style' && (
          <div data-testid="tb-border-style-menu" className={`absolute left-full top-0 ml-1 ${editorShell.menu} p-1 w-[168px]`}>
            {BORDER_STYLES.map(s => (
              <button key={s} type="button" data-testid={`tb-border-style-${s}`} onMouseDown={e => e.preventDefault()} onClick={() => { onPen({ style: s }); onClose() }}
                className={`${editorShell.menuItem} w-full flex items-center gap-2 px-2 py-1.5 ${pen.style === s ? 'bg-blue-50' : ''}`}>
                <LineSample style={s} color={pen.color} /><span className="text-[12px] text-gray-700">{t(`sheet_bd_st_${s}` as 'sheet_bd_st_thin')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type DialogProps = {
  open: boolean
  initial: Record<EdgeKey, BorderLine | null>
  pen: BorderPen
  swatches: string[]
  onCancel: () => void
  onApply: (edges: BorderEdges) => void
}

/** 其他边框…（Excel「儲存格格式 › 外框」口径：先挑线型与颜色·再点方向钮／预览图的边·确定才套） */
export function BorderDialog({ open, initial, pen, swatches, onCancel, onApply }: DialogProps) {
  const t = useSheetT()
  const [edges, setEdges] = useState(initial)
  const [style, setStyle] = useState<BorderStyle>(pen.style)
  const [color, setColor] = useState<string | undefined>(pen.color)
  useEffect(() => { if (open) { setEdges(initial); setStyle(pen.style); setColor(pen.color) } }, [open])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  const line: BorderLine = { style, ...(color ? { color } : {}) }
  const toggle = (k: EdgeKey) => setEdges(e => ({ ...e, [k]: e[k] && sameLine(e[k]!, line) ? null : line }))
  const preset = (p: 'none' | 'outline' | 'inside') => setEdges(e => p === 'none'
    ? { top: null, bottom: null, left: null, right: null, insideH: null, insideV: null }
    : p === 'outline' ? { ...e, top: line, bottom: line, left: line, right: line } : { ...e, insideH: line, insideV: line })
  const apply = () => {
    const out: BorderEdges = {}
    for (const k of EDGE_KEYS) if (!sameLine(edges[k] ?? undefined, initial[k] ?? undefined)) out[k] = edges[k]
    onApply(out)
  }
  const edgeBtn = (k: EdgeKey, icon: ReactNode) => (
    <button key={k} type="button" data-testid={`sheet-bd-dlg-${k}`} aria-pressed={!!edges[k]} title={t(k === 'insideH' ? 'sheet_bd_dlg_insideH' : k === 'insideV' ? 'sheet_bd_dlg_insideV' : (`sheet_bd_${k}` as 'sheet_bd_top'))}
      onClick={() => toggle(k)} className={`w-8 h-8 flex items-center justify-center rounded border ${edges[k] ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{icon}</button>
  )
  // 预览：2×2 格·可点的边（上下左右＋内部横竖）
  const W = 150, H = 100, P = 10
  const seg = (k: EdgeKey): [number, number, number, number] => k === 'top' ? [P, P, W - P, P] : k === 'bottom' ? [P, H - P, W - P, H - P] : k === 'left' ? [P, P, P, H - P]
    : k === 'right' ? [W - P, P, W - P, H - P] : k === 'insideH' ? [P, H / 2, W - P, H / 2] : [W / 2, P, W / 2, H - P]
  const draw = (k: EdgeKey) => {
    const l = edges[k]; if (!l) return null
    const [x1, y1, x2, y2] = seg(k)
    const c = l.color || BORDER_DEFAULT_COLOR
    if (l.style === 'double') {
      const dx = y1 === y2 ? 0 : 1.5, dy = y1 === y2 ? 1.5 : 0
      return <g key={k}><line x1={x1 - dx} y1={y1 - dy} x2={x2 - dx} y2={y2 - dy} stroke={c} strokeWidth={1} /><line x1={x1 + dx} y1={y1 + dy} x2={x2 + dx} y2={y2 + dy} stroke={c} strokeWidth={1} /></g>
    }
    return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={lineWidth(l.style)} strokeDasharray={l.style === 'dashed' ? '6 3' : l.style === 'dotted' ? '1.5 2.5' : undefined} />
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" data-testid="sheet-bd-dialog" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-w-[94vw] p-5 text-gray-800" role="dialog" aria-label={t('sheet_bd_dlg_title')}>
        <div className="text-base font-semibold mb-1">{t('sheet_bd_dlg_title')}</div>
        <div className="text-xs text-gray-500 mb-4">{t('sheet_bd_dlg_hint')}</div>
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500 mb-1.5">{t('sheet_bd_dlg_presets')}</div>
            <div className="flex gap-3 mb-4">
              {([['none', 'none', 'sheet_bd_none'], ['outline', ['top', 'bottom', 'left', 'right'], 'sheet_bd_dlg_outline'], ['inside', ['insideH', 'insideV'], 'sheet_bd_dlg_inside']] as const).map(([p, on, label]) => (
                <button key={p} type="button" data-testid={`sheet-bd-dlg-preset-${p}`} onClick={() => preset(p)} className="flex flex-col items-center gap-1 text-[11px] text-gray-600">
                  <span className="w-10 h-10 flex items-center justify-center rounded border border-gray-200 hover:bg-gray-50"><BorderIcon on={on as EdgeKey[] | 'none'} /></span>{t(label)}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-500 mb-1.5">{t('sheet_bd_dlg_edges')}</div>
            <div className="flex gap-2">
              <div className="flex flex-col justify-between py-1">
                {edgeBtn('top', <BorderIcon on={['top']} />)}{edgeBtn('insideH', <BorderIcon on={['insideH']} />)}{edgeBtn('bottom', <BorderIcon on={['bottom']} />)}
              </div>
              <div>
                <svg width={W} height={H} className="border border-gray-100 rounded bg-white cursor-pointer" data-testid="sheet-bd-dlg-preview"
                  onClick={e => {
                    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top
                    const cand: [EdgeKey, number][] = [['top', Math.abs(y - P)], ['bottom', Math.abs(y - (H - P))], ['left', Math.abs(x - P)], ['right', Math.abs(x - (W - P))], ['insideH', Math.abs(y - H / 2)], ['insideV', Math.abs(x - W / 2)]]
                    cand.sort((a, b) => a[1] - b[1]); if (cand[0][1] <= 8) toggle(cand[0][0])
                  }}>
                  <g stroke="#e5e7eb" strokeDasharray="2 2"><rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} fill="none" /><line x1={W / 2} y1={P} x2={W / 2} y2={H - P} /><line x1={P} y1={H / 2} x2={W - P} y2={H / 2} /></g>
                  <g fill="#9ca3af" fontSize="11" textAnchor="middle">{[[W / 4, H / 4 + 4], [3 * W / 4, H / 4 + 4], [W / 4, 3 * H / 4 + 4], [3 * W / 4, 3 * H / 4 + 4]].map(([x, y], i) => <text key={i} x={x} y={y}>{t('sheet_bd_dlg_preview')}</text>)}</g>
                  {EDGE_KEYS.map(draw)}
                </svg>
                <div className="flex justify-between px-1 mt-2">
                  {edgeBtn('left', <BorderIcon on={['left']} />)}{edgeBtn('insideV', <BorderIcon on={['insideV']} />)}{edgeBtn('right', <BorderIcon on={['right']} />)}
                </div>
              </div>
            </div>
          </div>
          <div className="w-[168px] shrink-0">
            <div className="text-xs text-gray-500 mb-1.5">{t('sheet_bd_style')}</div>
            <div className="flex flex-col gap-0.5 mb-3">
              {BORDER_STYLES.map(s => (
                <button key={s} type="button" data-testid={`sheet-bd-dlg-style-${s}`} onClick={() => setStyle(s)}
                  className={`flex items-center gap-2 px-2 py-1 rounded ${style === s ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'}`}>
                  <LineSample style={s} color={color} /><span className="text-[12px]">{t(`sheet_bd_st_${s}` as 'sheet_bd_st_thin')}</span>
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-500 mb-1.5">{t('sheet_bd_color')}</div>
            <button type="button" onClick={() => setColor(undefined)} className={`w-full flex items-center gap-2 px-1.5 py-1 mb-1 rounded text-[12px] ${!color ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <span className="w-4 h-4 rounded-sm border border-black/10" style={{ backgroundColor: BORDER_DEFAULT_COLOR }} />{t('sheet_bd_color_auto')}
            </button>
            <div className="grid grid-cols-6 gap-1">
              {swatches.map(c => (
                <button key={c} type="button" title={c} data-testid={`sheet-bd-dlg-color-${c.replace('#', '')}`} onClick={() => setColor(c)}
                  className={`w-5 h-5 rounded border ${color === c ? 'border-blue-500 ring-1 ring-blue-300' : 'border-black/10'}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" data-testid="sheet-bd-dlg-cancel" onClick={onCancel} className="px-4 h-8 rounded-md border border-gray-200 text-sm hover:bg-gray-50">{t('sheet_bd_dlg_cancel')}</button>
          <button type="button" data-testid="sheet-bd-dlg-ok" onClick={apply} className="px-4 h-8 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700">{t('sheet_bd_dlg_ok')}</button>
        </div>
      </div>
    </div>
  )
}
