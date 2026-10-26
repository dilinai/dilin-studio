'use client'
// 尋找與取代小浮窗（Ctrl／⌘+F 开尋找·Ctrl／⌘+H 开取代·工具栏放大镜钮同）
//   钉在网格右上角（不挡表格中间·不罩底）·Esc／× 关；两页：尋找＝找下一個（Shift+Enter 找上一個）／全部尋找（列出来点一条跳过去）；
//   取代＝另加取代框·取代（只换当前选中那格、再跳下一个）／全部取代（完成后提示几格·公式格被跳过另说几格）。
//   选项：大小写须相符·儲存格內容須完全相符·搜寻范围（公式／值·取代页固定公式）·也取代公式里的字（预设不勾）·只在选取范围内（选了一块才出）。
//   比对与改字全走 engine/data-tools.ts（findCells／replaceCells·AI 那支同一份）；找下一个往哪跳在 ./sheet-data-tools.pure.ts。
//   改格经 onApply 交回 SheetGrid（emit 进撤销栈·Ctrl+Z 整批复原）；唯读／AI 罩着时取代相关钮停用。
import { useEffect, useRef, useState } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { findCells, replaceCells, type FindHit, type FindLookIn, type FindOptions } from '../engine/data-tools'
import { cellKey, type SheetContent, type SheetCells, type EvaluatorOptions } from '../engine/formula'
import type { Rect } from '../engine/style'
import { nextHitIndex, type CellPos } from './sheet-data-tools.pure'

export type FindMode = 'find' | 'replace'
/** 全部尋找最多列几条（再多只说总数） */
const LIST_MAX = 200

export type FindDialogProps = {
  mode: FindMode
  onMode: (m: FindMode) => void
  /** 每按一次 Ctrl+F／H（或钮）加一 ⇒ 焦点回尋找框并全选 */
  focusSeq: number
  content: SheetContent
  evalOpts?: EvaluatorOptions
  /** 活动格（找下一个从这里往后找） */
  active: CellPos
  /** 开着时最近一次选了一块的范围（只在選取範圍內用）·没选过一块 ⇒ null */
  scope: Rect | null
  scopeText: string
  /** 唯读或 AI 罩着 ⇒ 取代钮停用 */
  readonly: boolean
  /** 藏起来（手动藏／被筛掉）的格不跳过去 */
  isHidden: (row: number, col: number) => boolean
  onSelect: (p: CellPos) => void
  onApply: (cells: SheetCells, count: number) => void
  onClose: () => void
}

export default function SheetFindDialog({ mode, onMode, focusSeq, content, evalOpts, active, scope, scopeText, readonly, isHidden, onSelect, onApply, onClose }: FindDialogProps) {
  const t = useSheetT()
  const findRef = useRef<HTMLInputElement>(null)
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeCell, setWholeCell] = useState(false)
  const [lookIn, setLookIn] = useState<FindLookIn>('formulas')
  const [inSel, setInSel] = useState(false)
  const [inclFormulas, setInclFormulas] = useState(false)
  const [status, setStatus] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null)
  const [list, setList] = useState<{ hits: FindHit[]; total: number } | null>(null)
  useEffect(() => { const el = findRef.current; if (el) { el.focus(); el.select() } }, [focusSeq, mode])
  useEffect(() => { if (!scope) setInSel(false) }, [scope])

  const look: FindLookIn = mode === 'replace' ? 'formulas' : lookIn   // 取代只改原文（Excel 同）
  const opts = (): FindOptions | null => {
    if (!find) { setStatus({ text: t('sheet_find_need_text'), tone: 'warn' }); return null }
    return { find, matchCase, wholeCell, lookIn: look, rect: inSel && scope ? scope : null }
  }
  /** 看得见的命中（藏的格跳过）·照逐列由左到右 */
  const visibleHits = (c: SheetContent, o: FindOptions) => findCells(c, o, evalOpts).hits.filter(h => !isHidden(h.row, h.col))
  const go = (c: SheetContent, o: FindOptions, from: CellPos, backward: boolean): boolean => {
    const hits = visibleHits(c, o)
    const i = nextHitIndex(hits, from, backward)
    if (i < 0) { setStatus({ text: t('sheet_find_not_found').replace('{a}', find), tone: 'warn' }); return false }
    onSelect(hits[i])
    setStatus({ text: t('sheet_find_pos').replace('{n}', String(i + 1)).replace('{m}', String(hits.length)), tone: 'info' })
    return true
  }
  const findNext = (backward = false) => { const o = opts(); if (o) { setList(null); go(content, o, active, backward) } }
  const findAll = () => {
    const o = opts(); if (!o) return
    const hits = visibleHits(content, o)
    setList({ hits: hits.slice(0, LIST_MAX), total: hits.length })
    setStatus(hits.length ? { text: t('sheet_find_all_count').replace('{n}', String(hits.length)), tone: 'info' } : { text: t('sheet_find_not_found').replace('{a}', find), tone: 'warn' })
  }
  const skippedNote = (n: number) => (n > 0 ? t('sheet_find_skipped').replace('{n}', String(n)) : '')
  /** 取代：活动格符合 ⇒ 换掉它再跳下一个；不符合 ⇒ 只是找下一个（Excel 同） */
  const replaceOne = () => {
    if (readonly) return
    const o = opts(); if (!o) return
    setList(null)
    const key = cellKey(active.row, active.col)
    const inScope = !o.rect || (active.row >= o.rect.r0 && active.row <= o.rect.r1 && active.col >= o.rect.c0 && active.col <= o.rect.c1)
    const res = inScope ? replaceCells(content, { ...o, replace: repl, includeFormulas: inclFormulas, only: [key] }) : null
    if (res && res.changed.length) {
      onApply(res.cells, res.changed.length)
      const moved = go({ ...content, cells: res.cells }, o, active, false)
      if (moved) setStatus(s => ({ text: `${t('sheet_find_replaced').replace('{n}', '1')}・${s?.text ?? ''}`, tone: 'info' }))
      else setStatus({ text: t('sheet_find_replaced').replace('{n}', '1'), tone: 'info' })
      return
    }
    const moved = go(content, o, active, false)
    if (res?.skippedFormulas && moved) setStatus(s => ({ text: `${t('sheet_find_skipped_only').replace('{n}', '1')}・${s?.text ?? ''}`, tone: 'warn' }))
  }
  const replaceAll = () => {
    if (readonly) return
    const o = opts(); if (!o) return
    setList(null)
    const res = replaceCells(content, { ...o, replace: repl, includeFormulas: inclFormulas })
    if (res.changed.length) {
      onApply(res.cells, res.changed.length)
      setStatus({ text: t('sheet_find_replaced').replace('{n}', String(res.changed.length)) + skippedNote(res.skippedFormulas), tone: res.skippedFormulas ? 'warn' : 'info' })
    } else if (res.skippedFormulas) setStatus({ text: t('sheet_find_skipped_only').replace('{n}', String(res.skippedFormulas)), tone: 'warn' })
    else setStatus({ text: t('sheet_find_not_found').replace('{a}', find), tone: 'warn' })
  }

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (mod && !e.altKey && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) { e.preventDefault(); onMode(e.key.toLowerCase() === 'h' ? 'replace' : 'find'); return }
  }
  const field = (testid: string, value: string, set: (v: string) => void, label: string, ref?: React.RefObject<HTMLInputElement | null>) => (
    <label className="flex items-center gap-2 mb-1.5">
      <span className="w-14 shrink-0 text-[11px] text-gray-500">{label}</span>
      <input ref={ref} value={value} data-testid={testid} autoComplete="off" spellCheck={false}
        onChange={e => { set(e.target.value); setStatus(null) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey) } }}
        className="flex-1 min-w-0 h-7 px-2 text-xs border border-gray-200 rounded outline-none focus:border-blue-400" />
    </label>
  )
  const check = (testid: string, on: boolean, set: (v: boolean) => void, label: string, disabled = false) => (
    <label className={`flex items-center gap-2 text-xs text-gray-700 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={on} disabled={disabled} data-testid={testid} onChange={e => { set(e.target.checked); setStatus(null); setList(null) }} />{label}
    </label>
  )
  const tab = (m: FindMode, label: string) => (
    <button type="button" data-testid={`sheet-find-tab-${m}`} aria-pressed={mode === m} onClick={() => { onMode(m); setStatus(null); setList(null) }}
      className={`px-2.5 py-1 text-xs rounded ${mode === m ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>{label}</button>
  )
  const btn = (testid: string, label: string, run: () => void, primary = false, disabled = false, title?: string) => (
    <button type="button" data-testid={testid} disabled={disabled} title={title} onClick={run}
      className={`h-7 px-2.5 text-xs rounded ${primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-200 text-gray-700 hover:bg-gray-50'} ${disabled ? 'opacity-40 cursor-default' : ''}`}>{label}</button>
  )
  return (
    <div role="dialog" aria-label={t('sheet_find_title')} data-testid="sheet-find-dialog" data-mode={mode} onKeyDown={onKey}
      className={`absolute right-4 top-12 z-[65] w-[340px] ${editorShell.menu} p-3`}>
      <div className="flex items-center gap-1 mb-2">
        {tab('find', t('sheet_find_tab_find'))}{tab('replace', t('sheet_find_tab_replace'))}
        <button type="button" data-testid="sheet-find-close" title={t('sheet_find_close')} aria-label={t('sheet_find_close')} onClick={onClose}
          className="ml-auto w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100">×</button>
      </div>
      {field('sheet-find-input', find, setFind, t('sheet_find_what'), findRef)}
      {mode === 'replace' && field('sheet-replace-input', repl, setRepl, t('sheet_find_with'))}
      <div className="space-y-1 mt-1">
        {check('sheet-find-case', matchCase, setMatchCase, t('sheet_find_match_case'))}
        {check('sheet-find-whole', wholeCell, setWholeCell, t('sheet_find_whole'))}
        {scope && check('sheet-find-in-sel', inSel, setInSel, t('sheet_find_in_sel').replace('{a}', scopeText))}
        {mode === 'replace' && check('sheet-find-incl-formulas', inclFormulas, setInclFormulas, t('sheet_find_incl_formulas'), readonly)}
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <span>{t('sheet_find_look_in')}</span>
          <select value={look} disabled={mode === 'replace'} data-testid="sheet-find-look-in" onChange={e => { setLookIn(e.target.value as FindLookIn); setStatus(null); setList(null) }}
            className="h-6 px-1 text-xs border border-gray-200 rounded bg-white outline-none focus:border-blue-400 disabled:opacity-60">
            <option value="formulas">{t('sheet_find_look_formulas')}</option>
            <option value="values">{t('sheet_find_look_values')}</option>
          </select>
        </label>
      </div>
      <div className="text-[10px] text-gray-400 mt-1.5">{t('sheet_find_hint')}</div>
      <div className="flex flex-wrap items-center justify-end gap-1 mt-2">
        {mode === 'replace' && <>
          {btn('sheet-replace-all', t('sheet_find_replace_all'), replaceAll, false, readonly, readonly ? t('sheet_find_readonly') : undefined)}
          {btn('sheet-replace-one', t('sheet_find_replace'), replaceOne, false, readonly, readonly ? t('sheet_find_readonly') : undefined)}
        </>}
        {btn('sheet-find-all', t('sheet_find_all'), findAll)}
        {btn('sheet-find-prev', t('sheet_find_prev'), () => findNext(true), false, false, 'Shift+Enter')}
        {btn('sheet-find-next', t('sheet_find_next'), () => findNext(false), true, false, 'Enter')}
      </div>
      {status && <div data-testid="sheet-find-status" data-tone={status.tone} className={`mt-2 text-[11px] ${status.tone === 'warn' ? 'text-amber-700' : 'text-gray-600'}`}>{status.text}</div>}
      {list && list.hits.length > 0 && (
        <div className="mt-1.5 max-h-[200px] overflow-y-auto border border-gray-100 rounded" data-testid="sheet-find-list">
          {list.hits.map(h => (
            <button key={h.cell} type="button" data-testid="sheet-find-hit" data-cell={h.cell} onClick={() => onSelect(h)}
              className={`${editorShell.menuItem} w-full flex items-center gap-2 px-2 py-1 text-left ${h.row === active.row && h.col === active.col ? 'bg-blue-50' : ''}`}>
              <span className="w-12 shrink-0 font-mono text-[11px] text-gray-500">{h.cell}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-gray-800">{h.text}</span>
            </button>
          ))}
          {list.total > list.hits.length && <div className="px-2 py-1 text-[11px] text-gray-400">{t('sheet_find_all_more').replace('{n}', String(list.hits.length))}</div>}
        </div>
      )}
    </div>
  )
}
