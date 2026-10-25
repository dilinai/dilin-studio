'use client'

// ── 简报页工具栏 · 基础格式组＋插入图片／视频（参照 WPS 工具栏）──
//   分组照图：格式刷｜字体／字号／A＋／A－／清除格式｜B／I／U／删除线／阴影／上下标／字色／高亮｜
//   项目符号／编号／缩进减增｜左／中／右／两端／分散对齐｜插入图片／插入视频。
//   每颗钮只发一条消息给中栏 iframe（真动作在 iframe 文档内做·选区在那边）——本组件不碰 DOM。
//   🔴 钮一律 onMouseDown preventDefault：点父页按钮不许把焦点从 iframe 抢走（抢走=选区丢=动作落空）。
//   色盘复用共用的 ColorPicker（Word 式取色器·现成件·零新依赖）。

import { useEffect, useRef, useState } from 'react'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { useStudioT as useT } from '../../shared/StudioT'
import { ColorPicker } from '../../shared/components/ColorPicker'
import FontFamilyDropdown from '../../shared/components/FontFamilyDropdown'   // 三页共用·清单＝lib/fonts/catalog 12 款
import { findFontByFamily } from '../../shared/fonts/catalog'

export type SlidesSelState = {
  hasSel?: boolean; inText?: boolean
  b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean; ul?: boolean; ol?: boolean
  align?: string; font?: string; size?: number; shadow?: boolean; media?: boolean
}

export type SlidesFormatToolbarProps = {
  /** 有投影片且中栏已挂 iframe 才可用 */
  enabled: boolean
  /** 'component'＝挂在组件清单里富文字框上方的那一条（格式动作作用于该文字组件的选区）：
   *  不出「编辑文字／完成编辑」开关与插图插视频（插图＝新增组件·在清单头上） */
  variant?: 'page' | 'component'
  editMode: boolean
  painterActive: boolean
  sel: SlidesSelState
  onToggleEdit?: () => void
  /** 发格式动作（不在编辑态会先进编辑态） */
  onFormat: (cmd: string, value?: string | number) => void
  onCopyFormat: () => void
  onInsertImage?: (file: File) => void
  onInsertVideoFile?: (file: File) => void
  onInsertVideoUrl?: () => void
  uploading?: boolean
}

/** 字体清单：读共用字体表（../../shared/fonts/catalog）·下拉＝共用 FontFamilyDropdown·发 onFormat('fontName', <id>)（父页解成 CSS 栈＋stylesheet 网址发给 iframe）；預設＝'' */

/** 字号：8–96·简报常用 18/24/32/44/60 */
export const SLIDE_SIZES: ReadonlyArray<number> = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96]

const BULLET_STYLES: ReadonlyArray<{ label: string; value: string; sample: string }> = [
  { label: '●', value: 'ul:disc', sample: '● ● ●' },
  { label: '○', value: 'ul:circle', sample: '○ ○ ○' },
  { label: '■', value: 'ul:square', sample: '■ ■ ■' },
]
const NUMBER_STYLES: ReadonlyArray<{ label: string; value: string; sample: string }> = [
  { label: '1.', value: 'ol:decimal', sample: '1. 2. 3.' },
  { label: 'a.', value: 'ol:lower-alpha', sample: 'a. b. c.' },
  { label: 'i.', value: 'ol:lower-roman', sample: 'i. ii. iii.' },
]

const stop = (e: React.MouseEvent) => { e.preventDefault() }

function TbBtn({ active, title, onClick, disabled, children, testid, className }: {
  active?: boolean; title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; testid?: string; className?: string
}) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={!!active} disabled={disabled}
      data-testid={testid}
      onMouseDown={stop} onClick={onClick}
      className={`h-7 min-w-7 px-1.5 rounded-md text-[13px] leading-none flex items-center justify-center gap-0.5 transition-colors select-none disabled:opacity-30 ${
        active ? editorShell.chipActive : 'text-gray-700 hover:bg-gray-100'} ${className ?? ''}`}>
      {children}
    </button>
  )
}

/** 下拉：自建（原生 <select> 会在 mousedown 抢焦点·且 preventDefault 后打不开） */
function TbDropdown({ label, title, open, onOpen, onClose, children, testid, width }: {
  label: React.ReactNode; title: string; open: boolean; onOpen: () => void; onClose: () => void; children: React.ReactNode; testid?: string; width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h, true)
    return () => document.removeEventListener('mousedown', h, true)
  }, [open, onClose])
  return (
    <div ref={ref} className="relative">
      <button type="button" title={title} aria-label={title} aria-expanded={open} data-testid={testid}
        onMouseDown={stop} onClick={() => (open ? onClose() : onOpen())}
        className={`h-7 px-1.5 rounded-md text-[12px] leading-none flex items-center gap-1 text-gray-700 hover:bg-gray-100 select-none ${open ? 'bg-gray-100' : ''}`}>
        {label}<span className="text-[9px] text-gray-400">▾</span>
      </button>
      {open && (
        <div onMouseDown={stop} className={`absolute left-0 top-full mt-1 z-40 rounded-lg border ${editorShell.divider} bg-white shadow-lg py-1 max-h-72 overflow-y-auto ${width ?? 'min-w-[9rem]'}`}>
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, active, children, style, testid }: { onClick: () => void; active?: boolean; children: React.ReactNode; style?: React.CSSProperties; testid?: string }) {
  return (
    <button type="button" data-testid={testid} onMouseDown={stop} onClick={onClick} style={style}
      className={`w-full text-left px-3 py-1 text-[13px] hover:bg-gray-100 whitespace-nowrap ${active ? 'bg-gray-100 font-medium' : 'text-gray-700'}`}>
      {children}
    </button>
  )
}

const Divider = () => <div className={`${editorShell.headerDivider} mx-0.5`} />

export default function SlidesFormatToolbar(p: SlidesFormatToolbarProps) {
  const t = useT()
  const [menu, setMenu] = useState<null | 'size' | 'script' | 'bullet' | 'number' | 'video'>(null)
  const [picker, setPicker] = useState<null | { kind: 'fore' | 'hilite'; pos: { x: number; y: number } }>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const vidInput = useRef<HTMLInputElement>(null)
  const close = () => setMenu(null)
  const dis = !p.enabled
  const sel = p.sel
  const fmt = (cmd: string, v?: string | number) => { close(); p.onFormat(cmd, v) }
  const curFontId = findFontByFamily(sel.font)?.id   // iframe 回报 computed fontFamily 首项 ⇒ 表内 id（不在表＝預設）
  const isComp = p.variant === 'component'

  return (
    <div className={`flex items-center flex-wrap gap-0.5 px-3 py-1 ${editorShell.toolbarBar} shrink-0`} data-testid={isComp ? 'slc-text-toolbar' : 'slides-format-toolbar'} onMouseDown={e => { if (e.target === e.currentTarget) e.preventDefault() }}>
      {/* 编辑态开关：格式动作都要选区·先进编辑态（点格式钮也会自动进） */}
      {!isComp && <>
      <TbBtn title={p.editMode ? t('asld_done_edit') : t('asld_edit_text')} onClick={() => p.onToggleEdit?.()} disabled={dis} active={p.editMode} testid="sf-edit-toggle" className="px-2 text-[12px]">
        {p.editMode ? t('asld_done_edit') : t('asld_edit_text')}
      </TbBtn>
      <Divider />
      </>}
      {/* 格式刷 */}
      <TbBtn title={t('asld_tb_painter')} onClick={p.onCopyFormat} disabled={dis} active={p.painterActive} testid="sf-painter">🖌</TbBtn>
      <Divider />
      {/* 字体／字号／A+／A-／清除格式 */}
      <FontFamilyDropdown testid="sf-font" value={curFontId} disabled={dis} triggerClassName="w-[128px]" onPick={id => fmt('fontName', id ?? '')} />
      <TbDropdown title={t('asld_tb_size')} label={<span className="w-6 text-center tabular-nums">{sel.size || '–'}</span>} open={menu === 'size'} onOpen={() => setMenu('size')} onClose={close} testid="sf-size" width="min-w-[4.5rem]">
        {SLIDE_SIZES.map(n => <MenuItem key={n} onClick={() => fmt('fontSize', n)} active={sel.size === n} testid={`sf-size-${n}`}>{n}</MenuItem>)}
      </TbDropdown>
      <TbBtn title={t('asld_tb_size_up')} onClick={() => fmt('sizeStep', 2)} disabled={dis} testid="sf-size-up">A<sup className="text-[9px]">+</sup></TbBtn>
      <TbBtn title={t('asld_tb_size_down')} onClick={() => fmt('sizeStep', -2)} disabled={dis} testid="sf-size-down">A<sup className="text-[9px]">−</sup></TbBtn>
      <TbBtn title={t('asld_tb_clear')} onClick={() => fmt('removeFormat')} disabled={dis} testid="sf-clear"><span className="text-[12px]">A</span><span className="text-[10px] -ml-0.5">✕</span></TbBtn>
      <Divider />
      {/* B／I／U／删除线／阴影／上下标／字色／高亮 */}
      <TbBtn title={t('asld_tb_bold')} onClick={() => fmt('bold')} disabled={dis} active={sel.b} testid="sf-bold"><b>B</b></TbBtn>
      <TbBtn title={t('asld_tb_italic')} onClick={() => fmt('italic')} disabled={dis} active={sel.i} testid="sf-italic"><i className="font-serif">I</i></TbBtn>
      <TbBtn title={t('asld_tb_underline')} onClick={() => fmt('underline')} disabled={dis} active={sel.u} testid="sf-underline"><u>U</u></TbBtn>
      <TbBtn title={t('asld_tb_strike')} onClick={() => fmt('strikeThrough')} disabled={dis} active={sel.s} testid="sf-strike"><s>S</s></TbBtn>
      <TbBtn title={t('asld_tb_shadow')} onClick={() => fmt('shadow')} disabled={dis} active={sel.shadow} testid="sf-shadow"><span style={{ textShadow: '1px 1px 2px rgba(0,0,0,.5)' }}>S</span></TbBtn>
      <TbDropdown title={t('asld_tb_script')} label={<span>X<sup className="text-[9px]">2</sup></span>} open={menu === 'script'} onOpen={() => setMenu('script')} onClose={close} testid="sf-script" width="min-w-[6rem]">
        <MenuItem onClick={() => fmt('superscript')} active={sel.sup} testid="sf-superscript">X<sup>2</sup> {t('asld_tb_superscript')}</MenuItem>
        <MenuItem onClick={() => fmt('subscript')} active={sel.sub} testid="sf-subscript">X<sub>2</sub> {t('asld_tb_subscript')}</MenuItem>
      </TbDropdown>
      <button type="button" title={t('asld_tb_color')} aria-label={t('asld_tb_color')} disabled={dis} data-testid="sf-forecolor"
        onMouseDown={e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setPicker({ kind: 'fore', pos: { x: r.left, y: r.bottom + 4 } }) }}
        className="h-7 min-w-7 px-1.5 rounded-md text-[13px] leading-none flex items-center justify-center text-gray-700 hover:bg-gray-100 disabled:opacity-30">
        <span className="border-b-[3px] border-red-500 leading-[1]">A</span>
      </button>
      <button type="button" title={t('asld_tb_highlight')} aria-label={t('asld_tb_highlight')} disabled={dis} data-testid="sf-hilite"
        onMouseDown={e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setPicker({ kind: 'hilite', pos: { x: r.left, y: r.bottom + 4 } }) }}
        className="h-7 min-w-7 px-1.5 rounded-md text-[13px] leading-none flex items-center justify-center text-gray-700 hover:bg-gray-100 disabled:opacity-30">
        <span className="bg-yellow-300 px-0.5 rounded-sm leading-[1]">A</span>
      </button>
      <Divider />
      {/* 项目符号／编号／缩进 */}
      <TbDropdown title={t('asld_tb_bullets')} label={<span className={sel.ul ? 'font-bold' : ''}>≡•</span>} open={menu === 'bullet'} onOpen={() => setMenu('bullet')} onClose={close} testid="sf-bullets" width="min-w-[6rem]">
        {BULLET_STYLES.map(b => <MenuItem key={b.value} onClick={() => fmt('list', b.value)} testid={`sf-list-${b.value.split(':')[1]}`}>{b.sample}</MenuItem>)}
      </TbDropdown>
      <TbDropdown title={t('asld_tb_numbers')} label={<span className={sel.ol ? 'font-bold' : ''}>≡1</span>} open={menu === 'number'} onOpen={() => setMenu('number')} onClose={close} testid="sf-numbers" width="min-w-[6rem]">
        {NUMBER_STYLES.map(b => <MenuItem key={b.value} onClick={() => fmt('list', b.value)} testid={`sf-list-${b.value.split(':')[1]}`}>{b.sample}</MenuItem>)}
      </TbDropdown>
      <TbBtn title={t('asld_tb_outdent')} onClick={() => fmt('outdent')} disabled={dis} testid="sf-outdent">⇤</TbBtn>
      <TbBtn title={t('asld_tb_indent')} onClick={() => fmt('indent')} disabled={dis} testid="sf-indent">⇥</TbBtn>
      <Divider />
      {/* 对齐五钮 */}
      <TbBtn title={t('asld_tb_align_left')} onClick={() => fmt('justifyLeft')} disabled={dis} active={sel.align === 'left' || sel.align === 'start'} testid="sf-align-left">≡<span className="sr-only">L</span></TbBtn>
      <TbBtn title={t('asld_tb_align_center')} onClick={() => fmt('justifyCenter')} disabled={dis} active={sel.align === 'center'} testid="sf-align-center">☰</TbBtn>
      <TbBtn title={t('asld_tb_align_right')} onClick={() => fmt('justifyRight')} disabled={dis} active={sel.align === 'right' || sel.align === 'end'} testid="sf-align-right">≡<span className="sr-only">R</span></TbBtn>
      <TbBtn title={t('asld_tb_align_justify')} onClick={() => fmt('justifyFull')} disabled={dis} active={sel.align === 'justify'} testid="sf-align-justify">▤</TbBtn>
      <TbBtn title={t('asld_tb_align_distribute')} onClick={() => fmt('justifyDistribute')} disabled={dis} active={sel.align === 'distribute'} testid="sf-align-distribute">▦</TbBtn>
      {!isComp && <>
      <Divider />
      {/* 插入图片／视频 */}
      <TbBtn title={t('asld_tb_insert_image')} onClick={() => imgInput.current?.click()} disabled={dis || p.uploading} testid="sf-insert-image" className="px-2 text-[12px]">🖼 {t('asld_tb_insert_image')}</TbBtn>
      <TbDropdown title={t('asld_tb_insert_video')} label={<span className="text-[12px]">🎬 {t('asld_tb_insert_video')}</span>} open={menu === 'video'} onOpen={() => setMenu('video')} onClose={close} testid="sf-insert-video" width="min-w-[9rem]">
        <MenuItem onClick={() => { close(); vidInput.current?.click() }} testid="sf-video-file">{t('asld_tb_video_file')}</MenuItem>
        <MenuItem onClick={() => { close(); p.onInsertVideoUrl?.() }} testid="sf-video-url">{t('asld_tb_video_url')}</MenuItem>
      </TbDropdown>
      {p.uploading && <span className="text-[11px] text-gray-400 ml-1">{t('asld_tb_uploading')}</span>}
      <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" data-testid="sf-image-input"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onInsertImage?.(f) }} />
      <input ref={vidInput} type="file" accept="video/mp4,video/webm" className="hidden" data-testid="sf-video-input"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onInsertVideoFile?.(f) }} />
      </>}
      <ColorPicker
        isOpen={picker !== null}
        anchorPos={picker?.pos ?? { x: 0, y: 0 }}
        onClose={() => setPicker(null)}
        onConfirm={(color) => { const k = picker?.kind; setPicker(null); if (k === 'fore') p.onFormat('foreColor', color); else if (k === 'hilite') p.onFormat('hiliteColor', color) }}
      />
    </div>
  )
}
