'use client'
// 下拉清单（资料验证）的两块小介面
//   ① ValidationPanel：工具栏「下拉選單」开的设定面板——对当前选区填选项（一行一个·逗号也拆）·可留空白·清单外的值拒绝或只提醒·移除；
//   ② ValidationPicker：选中设了清单的格 ⇒ 格右侧小箭头点开的选项清单（点一项＝填进去）。
//   清单上限（Excel 255 字）与判值在 engine/sheet-view.ts（cleanListItems／checkListInput）。
import { useEffect, useRef, useState } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { cleanListItems, LIST_CHARS_MAX, type SheetValidation } from '../engine/sheet-view'

function useOutside(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey) }
  }, [ref, onClose])
}

/** 输入框里的字 ⇒ 选项（一行一个·中英逗号顿号也拆·去空白去重） */
export function splitOptions(text: string): string[] {
  return text.split(/[\n,，、]/).map(s => s.trim()).filter(Boolean)
}

export function ValidationPanel({ range, initial, onApply, onRemove, onClose }: {
  range: string
  initial: SheetValidation | null
  onApply: (list: string[], opts: { allowBlank: boolean; showError: boolean }) => void
  onRemove: () => void
  onClose: () => void
}) {
  const t = useSheetT()
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, onClose)
  const [text, setText] = useState((initial?.list ?? []).join('\n'))
  const [allowBlank, setAllowBlank] = useState(initial?.allowBlank !== false)
  const [showError, setShowError] = useState(initial?.showError !== false)
  const [err, setErr] = useState<string | null>(null)
  const apply = () => {
    const raw = splitOptions(text)
    if (!raw.length) { setErr(t('sheet_val_need_options')); return }
    const items = cleanListItems(raw)
    if (items.length < new Set(raw).size || items.join(',').length > LIST_CHARS_MAX) { setErr(t('sheet_val_too_long')); return }
    onApply(items, { allowBlank, showError })
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] bg-black/10" data-testid="sheet-validation-backdrop">
      <div ref={ref} role="dialog" data-testid="sheet-validation-panel" className={`w-[300px] ${editorShell.menu} p-3`}>
        <div className="text-sm font-medium text-gray-800 mb-2">{t('sheet_val_title').replace('{a}', range)}</div>
        {initial?.source && <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1 mb-2">{t('sheet_val_source_note').replace('{a}', initial.source)}</div>}
        <label className="block text-[11px] text-gray-500 mb-1">{t('sheet_val_options')}</label>
        <textarea value={text} onChange={e => { setText(e.target.value); setErr(null) }} rows={6} autoFocus data-testid="sheet-validation-options"
          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 resize-y" />
        <label className="flex items-center gap-2 mt-2 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={allowBlank} onChange={e => setAllowBlank(e.target.checked)} data-testid="sheet-validation-allow-blank" />{t('sheet_val_allow_blank')}
        </label>
        <label className="flex items-center gap-2 mt-1 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={showError} onChange={e => setShowError(e.target.checked)} data-testid="sheet-validation-reject" />{t('sheet_val_reject')}
        </label>
        {err && <div className="mt-1.5 text-[11px] text-red-600" data-testid="sheet-validation-error">{err}</div>}
        <div className="flex items-center gap-1 mt-3">
          {initial && <button type="button" data-testid="sheet-validation-remove" onClick={onRemove} className="text-[11px] text-gray-500 hover:text-red-600 mr-auto">{t('sheet_val_remove')}</button>}
          <button type="button" onClick={onClose} className="ml-auto h-7 px-3 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50">{t('sheet_flt_cancel')}</button>
          <button type="button" data-testid="sheet-validation-apply" onClick={apply} className="h-7 px-3 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">{t('sheet_val_apply')}</button>
        </div>
      </div>
    </div>
  )
}

export function ValidationPicker({ anchor, options, current, onPick, onClose }: {
  anchor: { x: number; y: number; w: number }
  options: string[]
  current: string
  onPick: (v: string) => void
  onClose: () => void
}) {
  const t = useSheetT()
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, onClose)
  const left = Math.max(4, Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - Math.max(anchor.w, 140) - 4))
  return (
    <div ref={ref} role="listbox" data-testid="sheet-validation-picker" className={`fixed z-[70] max-h-[260px] overflow-y-auto ${editorShell.menu}`}
      style={{ left, top: anchor.y, minWidth: Math.max(anchor.w, 140) }} onMouseDown={e => e.stopPropagation()}>
      {options.length === 0 && <div className="px-3 py-1.5 text-xs text-gray-400">{t('sheet_val_empty')}</div>}
      {options.map(o => (
        <button key={o} type="button" role="option" aria-selected={o === current} data-testid="sheet-validation-option" data-value={o}
          onMouseDown={e => e.preventDefault()} onClick={() => onPick(o)}
          className={`${editorShell.menuItem} ${o === current ? 'bg-blue-50 text-blue-700' : ''}`}>{o}</button>
      ))}
    </div>
  )
}
