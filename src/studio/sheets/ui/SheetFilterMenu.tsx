'use client'
// 表头筛选钮的下拉选单（按值勾选、按条件）
//   上：排序（由小到大／由大到小·接 agent-ops 同一支 sort·表头不动）；中：依值篩選（列出这列不重复的显示字＋行数·全選·搜尋）／依條件篩選（十四种运算子）；
//   下：清除此欄的篩選｜取消｜確定。全勾＝不筛这列（Excel 同）。弹层 fixed 定在钮下方·点外面／Esc 关。
//   判定与值清单都在 engine/sheet-view.ts（filterColumnValues／matchCriterion）·本档只管画与收输入。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { FILTER_OPS, type FilterCriterion, type FilterOp } from '../engine/sheet-view'
import type { SheetTKey as TKey } from '../i18n'

export type FilterMenuProps = {
  /** 钮在视窗里的位置（弹层摆它下方） */
  anchor: { x: number; y: number }
  column: string
  /** 这列（被别列筛剩的行）里的不重复显示字·'' ＝空白 */
  values: Array<{ text: string; count: number }>
  current: FilterCriterion | undefined
  readonly?: boolean
  onApply: (c: FilterCriterion | null) => void
  onSort: (descending: boolean) => void
  onClose: () => void
}

export default function SheetFilterMenu({ anchor, column, values, current, readonly, onApply, onSort, onClose }: FilterMenuProps) {
  const t = useSheetT()
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'values' | 'cond'>(current && 'condition' in current ? 'cond' : 'values')
  const [query, setQuery] = useState('')
  // 勾选：没筛 ⇒ 全勾；按值筛着 ⇒ 勾那几个（不分大小写比）
  const [checked, setChecked] = useState<Set<string>>(() => {
    if (current && 'values' in current) { const want = new Set(current.values.map(v => v.trim().toLowerCase())); return new Set(values.filter(v => want.has(v.text.toLowerCase())).map(v => v.text)) }
    return new Set(values.map(v => v.text))
  })
  const cond0 = current && 'condition' in current ? current.condition : null
  const [op, setOp] = useState<FilterOp>(cond0?.op ?? 'eq')
  const [v1, setV1] = useState(cond0?.value ?? '')
  const [v2, setV2] = useState(cond0?.value2 ?? '')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const shown = useMemo(() => { const q = query.trim().toLowerCase(); return q ? values.filter(v => v.text.toLowerCase().includes(q)) : values }, [values, query])
  const allOn = shown.length > 0 && shown.every(v => checked.has(v.text))
  const label = (s: string) => (s === '' ? t('sheet_flt_blank') : s)
  const needs1 = op !== 'empty' && op !== 'not_empty', needs2 = op === 'between' || op === 'not_between'

  const apply = () => {
    if (tab === 'values') {
      if (!checked.size) { setErr(t('sheet_flt_none_checked')); return }
      onApply(values.every(v => checked.has(v.text)) ? null : { values: [...checked] })
      return
    }
    onApply({ condition: { op, ...(needs1 ? { value: v1 } : {}), ...(needs2 ? { value2: v2 } : {}) } })
  }

  const left = Math.max(4, Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 268))
  const top = Math.max(4, Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 440))
  const tabBtn = (k: 'values' | 'cond', text: string) => (
    <button type="button" data-testid={`sheet-filter-tab-${k}`} onClick={() => { setTab(k); setErr(null) }}
      className={`flex-1 py-1 text-xs rounded ${tab === k ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>{text}</button>
  )
  return (
    <div ref={ref} role="dialog" data-testid="sheet-filter-menu" data-column={column} className={`fixed z-[70] w-[260px] ${editorShell.menu} px-2 pb-2`} style={{ left, top }}
      onContextMenu={e => e.preventDefault()} onMouseDown={e => e.stopPropagation()}>
      {!readonly && (
        <div className="border-b border-gray-100 pb-1 mb-1">
          <button type="button" data-testid="sheet-filter-sort-asc" className={editorShell.menuItem} onClick={() => onSort(false)}>↑ {t('sheet_flt_sort_asc')}</button>
          <button type="button" data-testid="sheet-filter-sort-desc" className={editorShell.menuItem} onClick={() => onSort(true)}>↓ {t('sheet_flt_sort_desc')}</button>
        </div>
      )}
      <div className="flex gap-1 mb-1.5">{tabBtn('values', t('sheet_flt_by_values'))}{tabBtn('cond', t('sheet_flt_by_cond'))}</div>
      {tab === 'values' ? (
        <>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('sheet_flt_search')} data-testid="sheet-filter-search"
            className="w-full h-7 px-2 mb-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400" />
          <div className="max-h-[220px] overflow-y-auto border border-gray-100 rounded" data-testid="sheet-filter-values">
            <label className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
              <input type="checkbox" checked={allOn} data-testid="sheet-filter-all"
                onChange={() => setChecked(prev => { const n = new Set(prev); for (const v of shown) { if (allOn) n.delete(v.text); else n.add(v.text) } return n })} />
              <span className="font-medium">{t('sheet_flt_select_all')}</span>
            </label>
            {shown.map(v => (
              <label key={v.text} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer" data-testid="sheet-filter-value" data-value={v.text}>
                <input type="checkbox" checked={checked.has(v.text)} onChange={() => setChecked(prev => { const n = new Set(prev); if (n.has(v.text)) n.delete(v.text); else n.add(v.text); return n })} />
                <span className={`flex-1 truncate ${v.text === '' ? 'text-gray-400' : ''}`}>{label(v.text)}</span>
                <span className="text-[10px] text-gray-400 tabular-nums">{v.count}</span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-1.5" data-testid="sheet-filter-cond">
          <select value={op} onChange={e => setOp(e.target.value as FilterOp)} data-testid="sheet-filter-op"
            className="w-full h-7 px-1.5 text-xs border border-gray-200 rounded bg-white outline-none focus:border-blue-400">
            {FILTER_OPS.map(o => <option key={o} value={o}>{t(`sheet_flt_op_${o}` as TKey)}</option>)}
          </select>
          {needs1 && <input value={v1} onChange={e => setV1(e.target.value)} placeholder={t('sheet_flt_value')} data-testid="sheet-filter-v1" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') apply() }} className="w-full h-7 px-2 text-xs border border-gray-200 rounded outline-none focus:border-blue-400" />}
          {needs2 && <>
            <div className="text-[11px] text-gray-500 px-0.5">{t('sheet_flt_and')}</div>
            <input value={v2} onChange={e => setV2(e.target.value)} placeholder={t('sheet_flt_value')} data-testid="sheet-filter-v2"
              onKeyDown={e => { if (e.key === 'Enter') apply() }} className="w-full h-7 px-2 text-xs border border-gray-200 rounded outline-none focus:border-blue-400" />
          </>}
        </div>
      )}
      {err && <div className="mt-1 text-[11px] text-red-600">{err}</div>}
      <div className="flex items-center gap-1 mt-2">
        {current && !readonly && <button type="button" data-testid="sheet-filter-clear-col" onClick={() => onApply(null)} className="text-[11px] text-gray-500 hover:text-red-600 mr-auto">{t('sheet_flt_clear_col')}</button>}
        <button type="button" onClick={onClose} className="ml-auto h-7 px-3 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50">{t('sheet_flt_cancel')}</button>
        {!readonly && <button type="button" data-testid="sheet-filter-ok" onClick={apply} className="h-7 px-3 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">{t('sheet_flt_ok')}</button>}
      </div>
    </div>
  )
}
