'use client'
// 「字體」下拉：云文档页与表格页工具栏共用一份。
//   清单＝shared/fonts/catalog 12 款（简体／繁体／英文三组）＋首项「預設」；每项用它自己的字体渲染预览（打开下拉那刻把 12 款 stylesheet 挂上·
//   预览字只拉命中的几片切片）；选了 ⇒ onPick(id)·「預設」⇒ onPick(undefined)。
//   ⛔ 不用原生 <select>：<option> 没法逐项换字体渲染。触发钮与各项都 onMouseDown preventDefault ⇒ 不抢编辑器／网格焦点（选区不丢）。
import { useEffect, useRef, useState } from 'react'
import { useStudioT } from '../StudioT'
import { editorShell } from '../theme/editor-shell-theme'
import { fontCatalog, findFont, type FontEntry } from '../fonts/catalog'
import { ensureAllCatalogFontsLoaded, ensureFontLoaded } from '../fonts/load'
import { ToolbarChevron } from './ToolbarChevron'   // 三颗下拉箭头同一颗

type Props = {
  /** 当前选区的字体 id（undefined＝預設） */
  value: string | undefined
  onPick: (id: string | undefined) => void
  disabled?: boolean
  testid: string
  /** 触发钮宽度 class（默认 w-[136px]） */
  triggerClassName?: string
}

const GROUPS: FontEntry['group'][] = ['sc', 'tc', 'latin']

export default function FontFamilyDropdown({ value, onPick, disabled, testid, triggerClassName }: Props) {
  const t = useStudioT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = findFont(value)

  useEffect(() => { if (cur) ensureFontLoaded(cur.id) }, [cur])   // 触发钮上也用当前字体显示
  useEffect(() => {
    if (!open) return
    ensureAllCatalogFontsLoaded()
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const groupLabel = (g: FontEntry['group']) => g === 'sc' ? t('font_group_sc') : g === 'tc' ? t('font_group_tc') : t('font_group_latin')
  const pick = (id: string | undefined) => { onPick(id); setOpen(false) }

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" disabled={disabled} title={t('font_pick_title')} aria-label={t('font_pick_title')} aria-haspopup="listbox" aria-expanded={open}
        data-testid={testid} data-font-id={cur?.id ?? ''}
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(v => !v)}
        className={`h-7 text-xs border border-gray-200 rounded bg-white pl-2 pr-6 text-gray-700 flex items-center gap-1 ${triggerClassName ?? 'w-[136px]'} ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-gray-50'}`}>
        <span className="truncate" style={cur ? { fontFamily: cur.stack } : undefined}>{cur ? cur.label : t('font_default')}</span>
      </button>
      <ToolbarChevron />
      {open && (
        <div role="listbox" data-testid={`${testid}-popover`} className={`absolute left-0 top-full mt-1 z-50 ${editorShell.menu} w-[236px] max-h-[360px] overflow-y-auto`}>
          <button type="button" role="option" aria-selected={!cur} data-font-id="" onMouseDown={e => e.preventDefault()} onClick={() => pick(undefined)}
            className={`${editorShell.menuItem} ${!cur ? 'text-blue-600 bg-blue-50' : ''}`}>{t('font_default')}</button>
          {GROUPS.map(g => (
            <div key={g}>
              <div className="px-3 pt-2 pb-0.5 text-[10px] text-gray-400 select-none">{groupLabel(g)}</div>
              {fontCatalog().filter(f => f.group === g).map(f => (
                <button key={f.id} type="button" role="option" aria-selected={cur?.id === f.id} data-font-id={f.id}
                  onMouseDown={e => e.preventDefault()} onClick={() => pick(f.id)}
                  className={`${editorShell.menuItem} flex items-baseline justify-between gap-2 ${cur?.id === f.id ? 'text-blue-600 bg-blue-50' : ''}`}>
                  <span className="text-[13px]" style={{ fontFamily: f.stack }}>{f.label}</span>
                  <span className="text-[11px] text-gray-400 shrink-0" style={{ fontFamily: f.stack }}>{f.zh}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
