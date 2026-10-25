'use client'
// 网页剪辑页·时间轴上方工具列（对照剪映时间轴上方工具列）。
// 由左到右照剪映：游标钮（下拉：选择 A／分割 B／向左全选 [／向右全选 ]）｜复原｜重做｜分割｜向左裁剪 Q｜向右裁剪 W｜删除｜加标记 M。
// 图示照截图画（线条 svg）·每颗钮滑鼠停上去标快捷键（Mac ⌘／⌫·Windows Ctrl／Delete）。这里只画与转事件；动作在页面·算法在 _lib/toolbar.pure.ts。
// 下拉往下弹·用 fixed（轨道区外框 overflow-hidden）；点外面／Esc 收起（Esc 在这里吃掉·不连带让刀片回选择）。

import { useEffect, useRef, useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import { TOOL_MENU, type EditTool, type ToolMenuItem } from '../lib/toolbar.pure'

type IconName = 'select' | 'blade' | 'select-left' | 'select-right' | 'undo' | 'redo' | 'split' | 'trim-left' | 'trim-right' | 'delete' | 'marker' | 'chevron' | 'freeze' | 'reverse' | 'mirror' | 'solid' | 'adjust'
const DASH = '1.6 2'
/** 线条图示（照剪映截图）：20×20·跟着字色 */
export function ToolIcon({ name, className = 'w-4 h-4' }: { name: IconName; className?: string }) {
  const p = (d: string, dash?: boolean) => <path d={d} strokeDasharray={dash ? DASH : undefined} />
  const body: Record<IconName, React.ReactNode> = {
    select: p('M5 3.5l9.5 6-4.2 1.1 2.4 4.6-1.6.8-2.4-4.6L5 14.5z'),
    blade: <>{p('M3.5 5.5h13v3.5h-13z')}{p('M7 9v6M13 9v6')}</>,
    'select-left': <>{p('M16.5 3v14')}{p('M10 5.5L5.5 10l4.5 4.5M5.5 10h8')}</>,
    'select-right': <>{p('M3.5 3v14')}{p('M10 5.5l4.5 4.5-4.5 4.5M14.5 10h-8')}</>,
    undo: p('M7 4.5L3.5 8 7 11.5M3.5 8h8.5a4.25 4.25 0 010 8.5H9'),
    redo: p('M13 4.5L16.5 8 13 11.5M16.5 8H8a4.25 4.25 0 000 8.5h3'),
    split: <>{p('M4 4h3v12H4M16 4h-3v12h3')}{p('M10 2.5v15')}</>,
    'trim-left': <>{p('M6 3v14', true)}{p('M15.5 4h-3.5v12h3.5')}</>,
    'trim-right': <>{p('M4.5 4H8v12H4.5')}{p('M14 3v14', true)}</>,
    delete: p('M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4l.8-10.5'),
    marker: p('M5.5 3.5h9v9L10 16.5l-4.5-4z'),
    chevron: p('M6 8l4 4 4-4'),
    // 定格（雪花）·倒放（往回的箭头）·镜像（中线两边三角）·黑白场（半黑半白方块）
    freeze: <>{p('M10 2.5v15M3.5 6.25l13 7.5M3.5 13.75l13-7.5')}{p('M8 3.5l2 1.5 2-1.5M8 16.5l2-1.5 2 1.5')}</>,
    reverse: <>{p('M16 10a6 6 0 11-2-4.5')}{p('M14.5 2.5v3.5H11')}{p('M8.5 7.5v5l4-2.5z')}</>,
    mirror: <>{p('M10 2.5v15', true)}{p('M8 5L3 14h5zM12 5l5 9h-5z')}</>,
    adjust: <>{p('M4 5h12M4 10h12M4 15h12')}<circle cx="7" cy="5" r="1.6" fill="currentColor" /><circle cx="13" cy="10" r="1.6" fill="currentColor" /><circle cx="9" cy="15" r="1.6" fill="currentColor" /></>, // 调节层
    solid: <><rect x="3.5" y="4.5" width="13" height="11" rx="1" /><path d="M3.5 4.5h6.5v11H3.5z" fill="currentColor" stroke="none" /></>,
  }
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{body[name]}</svg>
}

/** 刀片游标（滑鼠停在片段上变刀·热点在刀口那条竖线中间）；退路 crosshair */
const BLADE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 7v16' stroke='black' stroke-width='3'/><path d='M12 7v16' stroke='white' stroke-width='1.4'/><path d='M7 1.5h10v5.5H7z' fill='white' stroke='black' stroke-width='1.2'/></svg>"
export const BLADE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(BLADE_SVG)}") 12 14, crosshair`
/** 刀片模式时插进页面：轨道上的片段（连里面的拉边、音量线）一律显示刀片游标 */
export function BladeCursorStyle() {
  return <style>{`[data-testid="vedit-lanes"] [data-clip-id], [data-testid="vedit-lanes"] [data-clip-id] * { cursor: ${BLADE_CURSOR} !important; }`}</style>
}

const MENU_LABEL: Record<ToolMenuItem['id'], TKey> = { select: 'vedit_tool_select', blade: 'vedit_tool_blade', 'select-left': 'vedit_tool_select_left', 'select-right': 'vedit_tool_select_right' }

export type VeditToolbarProps = {
  tool: EditTool
  onTool: (t: EditTool) => void
  onSelectSide: (side: 'left' | 'right') => void
  mac: boolean
  canUndo: boolean; onUndo: () => void
  canRedo: boolean; onRedo: () => void
  canSplit: boolean; onSplit: () => void
  canTrim: boolean; onTrim: (side: 'left' | 'right') => void
  canDelete: boolean; onDelete: () => void
  onMarker: () => void
  /** 定格／倒放／镜像（对选中的片段）·黑场白场（放在播放头） */
  ops?: { canFreeze: boolean; onFreeze: () => void; canReverse: boolean; onReverse: () => void; canMirror: boolean; onMirror: () => void; onSolid: (k: 'black' | 'white') => void; /** 调节层 */ onAdjust?: () => void }
}

function Btn({ label, onClick, disabled, testid, children }: { label: string; onClick: () => void; disabled?: boolean; testid: string; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} data-testid={testid} onMouseDown={(e) => e.preventDefault()}
      className="h-7 w-7 flex items-center justify-center rounded text-neutral-300 hover:bg-neutral-700 disabled:opacity-35 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}

export default function VeditToolbar(p: VeditToolbarProps) {
  const t = useStudioT()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ left: Math.max(4, r.left), top: r.bottom + 4 }) }
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', esc, true); window.removeEventListener('resize', place) }
  }, [open])

  const mod = (k: string) => (p.mac ? `⌘${k}` : `Ctrl+${k}`)
  const tip = (key: TKey, keys: string) => `${t(key)}（${keys}）`
  const pick = (it: ToolMenuItem) => {
    setOpen(false)
    if (it.id === 'select-left' || it.id === 'select-right') p.onSelectSide(it.id === 'select-left' ? 'left' : 'right')
    else p.onTool(it.id)
  }
  const cursorLabel = `${t('vedit_tool_cursor')}：${t(MENU_LABEL[p.tool])}`

  return (
    <div className="flex items-center gap-1" data-testid="vedit-toolbar">
      <div ref={boxRef} className="relative">
        <button ref={btnRef} type="button" title={cursorLabel} aria-label={cursorLabel} aria-haspopup="menu" aria-expanded={open} data-testid="vedit-tool-cursor" data-tool={p.tool}
          onMouseDown={(e) => e.preventDefault()} onClick={() => { place(); setOpen((o) => !o) }}
          className={`h-7 px-1 flex items-center gap-0.5 rounded hover:bg-neutral-700 ${p.tool === 'blade' ? 'text-cyan-300' : 'text-neutral-300'} ${open ? 'bg-neutral-700' : ''}`}>
          <ToolIcon name={p.tool} />
          <ToolIcon name="chevron" className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && pos && (
          <div role="menu" aria-label={t('vedit_tool_cursor')} data-testid="vedit-tool-menu" className="fixed z-50 w-44 p-1 rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl"
            style={{ left: pos.left, top: pos.top }}>
            {TOOL_MENU.map((it) => {
              const mode = it.id === 'select' || it.id === 'blade'
              const cur = mode && it.id === p.tool
              return (
                <button key={it.id} type="button" role={mode ? 'menuitemradio' : 'menuitem'} aria-checked={mode ? cur : undefined} data-testid={`vedit-tool-pick-${it.id}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}
                  className={`w-full h-9 px-2 flex items-center gap-2.5 rounded text-left text-[13px] text-neutral-200 hover:bg-neutral-700 ${cur ? 'bg-neutral-700' : ''}`}>
                  <ToolIcon name={it.id} className="w-[18px] h-[18px] shrink-0" />
                  <span className="flex-1 whitespace-nowrap">{t(MENU_LABEL[it.id])}</span>
                  <span className="shrink-0 text-[12px] text-neutral-400 tabular-nums">{it.key}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="mx-1 h-4 w-px bg-neutral-700" aria-hidden />
      <Btn label={tip('vedit_tool_undo', mod('Z'))} onClick={p.onUndo} disabled={!p.canUndo} testid="vedit-tool-undo"><ToolIcon name="undo" /></Btn>
      <Btn label={tip('vedit_tool_redo', p.mac ? '⇧⌘Z' : 'Ctrl+Shift+Z')} onClick={p.onRedo} disabled={!p.canRedo} testid="vedit-tool-redo"><ToolIcon name="redo" /></Btn>
      <Btn label={tip('vedit_tool_split', mod('B'))} onClick={p.onSplit} disabled={!p.canSplit} testid="vedit-tool-split"><ToolIcon name="split" /></Btn>
      <Btn label={tip('vedit_tool_trim_left', 'Q')} onClick={() => p.onTrim('left')} disabled={!p.canTrim} testid="vedit-tool-trim-left"><ToolIcon name="trim-left" /></Btn>
      <Btn label={tip('vedit_tool_trim_right', 'W')} onClick={() => p.onTrim('right')} disabled={!p.canTrim} testid="vedit-tool-trim-right"><ToolIcon name="trim-right" /></Btn>
      <Btn label={tip('vedit_tool_delete', p.mac ? '⌫' : 'Delete')} onClick={p.onDelete} disabled={!p.canDelete} testid="vedit-tool-delete"><ToolIcon name="delete" /></Btn>
      <Btn label={tip('vedit_tool_marker', 'M')} onClick={p.onMarker} testid="vedit-tool-marker"><ToolIcon name="marker" /></Btn>
      {p.ops && <>
        <div className="mx-1 h-4 w-px bg-neutral-700" aria-hidden />
        <Btn label={t('vedit_tool_freeze')} onClick={p.ops.onFreeze} disabled={!p.ops.canFreeze} testid="vedit-tool-freeze"><ToolIcon name="freeze" /></Btn>
        <Btn label={t('vedit_tool_reverse')} onClick={p.ops.onReverse} disabled={!p.ops.canReverse} testid="vedit-tool-reverse"><ToolIcon name="reverse" /></Btn>
        <Btn label={t('vedit_tool_mirror')} onClick={p.ops.onMirror} disabled={!p.ops.canMirror} testid="vedit-tool-mirror"><ToolIcon name="mirror" /></Btn>
        <Btn label={t('vedit_tool_black')} onClick={() => p.ops!.onSolid('black')} testid="vedit-tool-black"><ToolIcon name="solid" /></Btn>
        {p.ops.onAdjust && <Btn label={t('vedit_tool_adjust')} onClick={p.ops.onAdjust} testid="vedit-tool-adjust"><ToolIcon name="adjust" /></Btn>}
        <Btn label={t('vedit_tool_white')} onClick={() => p.ops!.onSolid('white')} testid="vedit-tool-white"><span className="w-4 h-4 rounded-sm border border-current bg-white/90" aria-hidden /></Btn>
      </>}
    </div>
  )
}
