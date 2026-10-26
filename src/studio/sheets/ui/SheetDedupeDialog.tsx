'use client'
// 「移除重複」对话框（工具栏钮开·范围由 SheetGrid 定：选一块＝那块·只选一格＝它所在的整片资料·都剪到有内容的外框）
//   勾要比对的栏（栏字母＋第一列的字当栏名）·全选／全不选·「資料含標題列」（第一列像表头时预设勾·勾了第一列不比不动）。
//   确定 ⇒ onApply（SheetGrid 调 engine/data-tools removeDuplicates 写回 cells·进撤销栈·提示移除几列）。
import { useRef, useState } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'

export type DedupeColumn = { col: number; letter: string; name: string }

export default function SheetDedupeDialog({ range, columns, defaultHeader, onApply, onClose }: {
  range: string
  columns: DedupeColumn[]
  defaultHeader: boolean
  onApply: (o: { columns: number[]; hasHeader: boolean }) => void
  onClose: () => void
}) {
  const t = useSheetT()
  const ref = useRef<HTMLDivElement>(null)
  const [hasHeader, setHasHeader] = useState(defaultHeader)
  const [checked, setChecked] = useState<Set<number>>(() => new Set(columns.map(c => c.col)))
  const [err, setErr] = useState<string | null>(null)
  const apply = () => {
    if (!checked.size) { setErr(t('sheet_dd_need_col')); return }
    onApply({ columns: columns.map(c => c.col).filter(c => checked.has(c)), hasHeader })
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] bg-black/10" data-testid="sheet-dedupe-backdrop"
      onMouseDown={e => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
      <div ref={ref} role="dialog" data-testid="sheet-dedupe-dialog" className={`w-[320px] ${editorShell.menu} p-3`}>
        <div className="text-sm font-medium text-gray-800 mb-2">{t('sheet_dd_title').replace('{a}', range)}</div>
        <label className="flex items-center gap-2 mb-2 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} data-testid="sheet-dedupe-header" autoFocus />{t('sheet_dd_header')}
        </label>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] text-gray-500 mr-auto">{t('sheet_dd_columns')}</span>
          <button type="button" data-testid="sheet-dedupe-all" onClick={() => { setChecked(new Set(columns.map(c => c.col))); setErr(null) }} className="text-[11px] text-blue-600 hover:underline">{t('sheet_dd_all')}</button>
          <button type="button" data-testid="sheet-dedupe-none" onClick={() => setChecked(new Set())} className="text-[11px] text-blue-600 hover:underline">{t('sheet_dd_none')}</button>
        </div>
        <div className="max-h-[240px] overflow-y-auto border border-gray-100 rounded" data-testid="sheet-dedupe-columns">
          {columns.map(c => (
            <label key={c.col} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer" data-testid="sheet-dedupe-col" data-col={c.letter}>
              <input type="checkbox" checked={checked.has(c.col)} onChange={() => { setErr(null); setChecked(prev => { const n = new Set(prev); if (n.has(c.col)) n.delete(c.col); else n.add(c.col); return n }) }} />
              <span className="w-6 shrink-0 font-mono text-[11px] text-gray-500">{c.letter}</span>
              {/* 栏名＝第一列的字（不含标题列时淡灰：那列是资料、也一起比）·第一列空 ⇒「欄 A」 */}
              <span className={`flex-1 truncate ${hasHeader ? '' : 'text-gray-400'}`}>{c.name || t('sheet_dd_col').replace('{a}', c.letter)}</span>
            </label>
          ))}
        </div>
        {err && <div className="mt-1.5 text-[11px] text-red-600" data-testid="sheet-dedupe-error">{err}</div>}
        <div className="flex items-center gap-1 mt-3">
          <button type="button" onClick={onClose} className="ml-auto h-7 px-3 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50">{t('sheet_dd_cancel')}</button>
          <button type="button" data-testid="sheet-dedupe-ok" onClick={apply} className="h-7 px-3 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">{t('sheet_dd_ok')}</button>
        </div>
      </div>
    </div>
  )
}
