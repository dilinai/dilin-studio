'use client'
// 表格工具栏「冻结／筛选／下拉清单」一组
//   凍結窗格＝下拉四项（凍結首列／凍結首欄／凍結至選取格／取消凍結）·篩選＝开关（亮＝这张表有筛选区）·下拉選單＝开设定小面板（面板在 SheetGrid 里·要选区）。
//   每颗钮只发 ViewCommand（经 SheetToolbar 的 onCommand 进 SheetGrid.exec）；资料口径在 engine/sheet-view.ts。
import { useEffect, useRef, useState } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'

export type FreezeMode = 'row' | 'col' | 'sel' | 'none'
export type ViewCommand = { t: 'freeze'; mode: FreezeMode } | { t: 'filterToggle' } | { t: 'validationPanel' }
/** 网格回报的现况（钮的按下态） */
export type ViewSelState = { freezeRows: number; freezeCols: number; filterOn: boolean; validation: boolean }

export default function SheetViewToolbar({ view, disabled, onCommand }: { view: ViewSelState | undefined; disabled: boolean; onCommand: (cmd: ViewCommand) => void }) {
  const t = useSheetT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const frozen = !!view && (view.freezeRows > 0 || view.freezeCols > 0)
  const btn = (active: boolean) => `${editorShell.toolbarBtn} h-7 min-w-[28px] justify-center ${active ? 'bg-gray-200 text-gray-900' : ''} ${disabled ? 'opacity-40 cursor-default' : ''}`
  const item = (mode: FreezeMode, label: string) => (
    <button key={mode} type="button" data-testid={`tb-freeze-${mode}`} onMouseDown={e => e.preventDefault()}
      onClick={() => { setOpen(false); onCommand({ t: 'freeze', mode }) }}
      className={`${editorShell.menuItem} whitespace-nowrap`}>{label}</button>
  )
  return (
    <>
      <div className="relative" ref={ref}>
        <button type="button" title={t('sheet_tb_freeze')} aria-label={t('sheet_tb_freeze')} aria-pressed={frozen || undefined} aria-haspopup="menu" aria-expanded={open}
          data-testid="tb-freeze" data-rows={view?.freezeRows ?? 0} data-cols={view?.freezeCols ?? 0} disabled={disabled}
          onMouseDown={e => e.preventDefault()} onClick={() => setOpen(v => !v)} className={btn(frozen)}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M8 4v16" /><path d="M3 9h5V4" fill="currentColor" fillOpacity={0.25} /></svg>
          <span className="text-xs">{t('sheet_tb_freeze')}</span>
          <svg className="w-2.5 h-2.5 -ml-0.5 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m5 8 5 5 5-5" /></svg>
        </button>
        {open && !disabled && (
          <div role="menu" data-testid="tb-freeze-menu" className={`absolute left-0 top-full mt-1 z-50 min-w-[200px] ${editorShell.menu}`}>
            {item('row', t('sheet_freeze_row'))}
            {item('col', t('sheet_freeze_col'))}
            {item('sel', t('sheet_freeze_sel'))}
            <div className="my-1 border-t border-gray-100" />
            {item('none', t('sheet_freeze_none'))}
          </div>
        )}
      </div>
      <button type="button" title={view?.filterOn ? t('sheet_tb_filter_off') : t('sheet_tb_filter')} aria-label={t('sheet_tb_filter')} aria-pressed={view?.filterOn || undefined}
        data-testid="tb-filter" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => onCommand({ t: 'filterToggle' })} className={btn(!!view?.filterOn)}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" /></svg>
        <span className="text-xs">{t('sheet_tb_filter')}</span>
      </button>
      <button type="button" title={t('sheet_tb_validation')} aria-label={t('sheet_tb_validation')} aria-pressed={view?.validation || undefined}
        data-testid="tb-validation" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => onCommand({ t: 'validationPanel' })} className={btn(!!view?.validation)}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M15 5v14" /><path d="m17 11 1.5 1.5L20 11" /></svg>
        <span className="text-xs">{t('sheet_tb_validation')}</span>
      </button>
    </>
  )
}
