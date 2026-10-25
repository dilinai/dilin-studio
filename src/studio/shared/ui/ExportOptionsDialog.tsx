'use client'
// 汇出前的勾选小窗：列编辑器给的 exportOptions（label 走 t）、缺省全不勾、「汇出」＋「取消」。
//   状态（勾了哪些）由 Shell 持有，本元件只画；Esc／点遮罩＝取消。

import { useEffect } from 'react'
import type { StudioExportOption, StudioT } from '../types'

export interface ExportOptionsDialogProps {
  t: StudioT
  options: readonly StudioExportOption[]
  selected: ReadonlySet<string>
  onToggle(id: string, on: boolean): void
  onConfirm(): void
  onCancel(): void
}

export default function ExportOptionsDialog({ t, options, selected, onToggle, onConfirm, onCancel }: ExportOptionsDialogProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }} data-testid="studio-export-dialog">
      <div role="dialog" aria-modal="true" aria-labelledby="studio-export-title" className="w-full max-w-sm rounded-2xl border border-[#E7DCBE] bg-white p-5 shadow-xl">
        <h2 id="studio-export-title" className="text-base font-bold text-[#4A3528]">{t('studio_export_options_title')}</h2>
        <p className="mt-1 text-[13px] text-[#8A7B66]">{t('studio_export_options_hint')}</p>
        <ul className="mt-3 space-y-2">
          {options.map(o => (
            <li key={o.id}>
              <label className="flex items-start gap-2 text-[13px] text-[#4A3528] cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={selected.has(o.id)} onChange={e => onToggle(o.id, e.target.checked)} data-testid={`studio-export-opt-${o.id}`} />
                <span>{t(o.label)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="h-8 px-3 rounded-lg text-xs hover:bg-black/5" onClick={onCancel} data-testid="studio-export-cancel">{t('studio_cancel')}</button>
          <button type="button" className="h-8 px-4 rounded-lg bg-[#4A3528] text-xs font-semibold text-white keep-white hover:bg-[#5C4434]" onClick={onConfirm} data-testid="studio-export-go">{t('studio_export_go')}</button>
        </div>
      </div>
    </div>
  )
}
