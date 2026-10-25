'use client'
// 表格工具栏「條件格式」小面板：
//   对当前选区挑规则种类（Excel 三组：醒目提示儲存格／前段後段／色階與資料橫條）→ 填参数 → 挑格式（Excel 预设三组＋浅红填满／红字＋自订）→「套用到選取範圍」；
//   「清除選取範圍的規則」＝Excel 同名那颗（把选区从每条规则的范围里扣掉）；底下列出这块现有的规则（可逐条删）。
//   只发动作·真改在 SheetGrid（engine/cond-format applyCondChange·跟 AI 工具 set_conditional_format 同一套入参）·进撤销栈。
import { useEffect, useRef, useState } from 'react'
import { useSheetT } from './host'
import type { SheetTKey as TKey } from '../i18n'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { COND_PRESETS, COND_PRESET_NAMES, COLOR_SCALE_DEFAULT, DATA_BAR_DEFAULT, CELLIS_TYPES, rangesLabel, type CondRule, type CondType, type CondPreset, type CondRuleInput, type CondFormatInput, type CondStyle } from '../engine/cond-format'

export type CondUiAction = { kind: 'add'; rule: CondRuleInput; format?: CondFormatInput } | { kind: 'clear' } | { kind: 'delete'; id: string }

const GROUPS: Array<{ label: TKey; types: CondType[] }> = [
  { label: 'sheet_cf_group_cell', types: ['greater', 'less', 'between', 'equal', 'greater_equal', 'less_equal', 'not_equal', 'not_between', 'text_contains', 'duplicate', 'unique'] },
  { label: 'sheet_cf_group_top', types: ['top', 'bottom', 'above_average', 'below_average'] },
  { label: 'sheet_cf_group_scale', types: ['color_scale', 'data_bar'] },
]
const isCellIs = (t: CondType) => (CELLIS_TYPES as readonly string[]).includes(t)
const typeLabel = (t: CondType) => `sheet_cf_t_${t}` as TKey

function Swatch({ s }: { s: CondStyle | undefined }) {
  return <span className="inline-flex items-center justify-center w-7 h-5 rounded border border-black/10 text-[11px] shrink-0" style={{ backgroundColor: s?.bg ?? '#fff', color: s?.fg ?? '#111', fontWeight: s?.b ? 700 : 400 }}>Aa</span>
}

/** 规则一行摘要：种类＋参数＋范围 */
function ruleSummary(r: CondRule, t: (k: TKey) => string): string {
  const parts = [t(typeLabel(r.type))]
  if (r.value !== undefined) parts.push(String(r.value) + (r.value2 !== undefined ? ` ${t('sheet_cf_and')} ${r.value2}` : ''))
  if (r.n !== undefined) parts.push(`${r.n}${r.percent ? '%' : ''}`)
  if (r.text !== undefined) parts.push(`「${r.text}」`)
  return `${parts.join(' ')} · ${rangesLabel(r.ranges)}`
}

export default function SheetCondFormatMenu({ rules, disabled, onAction }: { rules: CondRule[] | undefined; disabled: boolean; onAction: (a: CondUiAction) => void }) {
  const t = useSheetT()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<CondType>('greater')
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [n, setN] = useState('10')
  const [percent, setPercent] = useState(false)
  const [orEqual, setOrEqual] = useState(false)
  const [text, setText] = useState('')
  const [preset, setPreset] = useState<CondPreset | 'custom'>('light_red')
  const [fg, setFg] = useState('#9c0006')
  const [bg, setBg] = useState('#ffc7ce')
  const [bold, setBold] = useState(false)
  const [three, setThree] = useState(true)
  const [scale, setScale] = useState<string[]>([...COLOR_SCALE_DEFAULT])
  const [bar, setBar] = useState(DATA_BAR_DEFAULT)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const styled = !(type === 'color_scale' || type === 'data_bar')
  const apply = () => {
    setErr(null)
    const rule: CondRuleInput = { type }
    if (isCellIs(type)) {
      if (!value.trim() || ((type === 'between' || type === 'not_between') && !value2.trim())) { setErr(t('sheet_cf_need_value')); return }
      rule.value = value.trim()
      if (type === 'between' || type === 'not_between') rule.value2 = value2.trim()
    } else if (type === 'top' || type === 'bottom') {
      rule.n = Math.max(1, Math.floor(Number(n) || 10)); if (percent) rule.percent = true
    } else if (type === 'above_average' || type === 'below_average') {
      if (orEqual) rule.or_equal = true
    } else if (type === 'text_contains') {
      if (!text) { setErr(t('sheet_cf_need_value')); return }
      rule.text = text
    } else if (type === 'color_scale') rule.colors = three ? scale : [scale[0], scale[2]]
    else if (type === 'data_bar') rule.colors = [bar]
    const format: CondFormatInput | undefined = !styled ? undefined : preset === 'custom' ? { color: fg, bg, ...(bold ? { bold: true } : {}) } : preset
    onAction({ kind: 'add', rule, ...(format ? { format } : {}) })
  }

  const input = 'h-7 px-2 rounded border border-gray-200 text-xs text-gray-800 bg-white min-w-0'
  const colorIn = (v: string, set: (c: string) => void, testid: string, title: string) => (
    <label className="inline-flex items-center gap-1 text-[11px] text-gray-600" title={title}>
      <input type="color" value={v} data-testid={testid} onChange={e => set(e.target.value.toLowerCase())} className="w-6 h-6 p-0 border border-gray-200 rounded cursor-pointer" />{title}
    </label>
  )
  return (
    <div className="relative" ref={ref}>
      <button type="button" title={t('sheet_cf_button')} aria-label={t('sheet_cf_button')} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} data-testid="tb-condfmt"
        onMouseDown={e => e.preventDefault()} onClick={() => setOpen(v => !v)}
        className={`${editorShell.toolbarBtn} h-7 justify-center gap-1 ${open ? 'bg-gray-200 text-gray-900' : ''} ${disabled ? 'opacity-40 cursor-default' : ''}`}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9.5h18M3 15h18M9 4v16" /><rect x="10.5" y="11" width="9" height="2.5" fill="currentColor" stroke="none" opacity=".45" /></svg>
        <span className="text-xs">{t('sheet_cf_button')}</span>
      </button>
      {open && (
        <div role="dialog" aria-label={t('sheet_cf_button')} data-testid="tb-condfmt-panel" className={`absolute left-0 top-full mt-1 z-50 ${editorShell.menu} p-3 w-[320px] text-xs text-gray-700 space-y-2.5`}>
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-gray-500">{t('sheet_cf_rule')}</span>
            <select value={type} data-testid="tb-condfmt-type" onChange={e => { setType(e.target.value as CondType); setErr(null) }} className={`${input} flex-1`}>
              {GROUPS.map(g => (
                <optgroup key={g.label} label={t(g.label)}>
                  {g.types.map(x => <option key={x} value={x}>{t(typeLabel(x))}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {isCellIs(type) && (
            <div className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-gray-500">{t('sheet_cf_value')}</span>
              <input value={value} onChange={e => setValue(e.target.value)} placeholder={t('sheet_cf_value_ph')} data-testid="tb-condfmt-value" className={`${input} flex-1`} />
              {(type === 'between' || type === 'not_between') && <><span>{t('sheet_cf_and')}</span><input value={value2} onChange={e => setValue2(e.target.value)} data-testid="tb-condfmt-value2" className={`${input} flex-1`} /></>}
            </div>
          )}
          {(type === 'top' || type === 'bottom') && (
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-gray-500">{t('sheet_cf_n')}</span>
              <input type="number" min={1} max={percent ? 100 : 1000} value={n} onChange={e => setN(e.target.value)} data-testid="tb-condfmt-n" className={`${input} w-20`} />
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={percent} onChange={e => setPercent(e.target.checked)} />{t('sheet_cf_percent')}</label>
            </div>
          )}
          {(type === 'above_average' || type === 'below_average') && (
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={orEqual} onChange={e => setOrEqual(e.target.checked)} />{t('sheet_cf_or_equal')}</label>
          )}
          {type === 'text_contains' && (
            <input value={text} onChange={e => setText(e.target.value)} placeholder={t('sheet_cf_text_ph')} data-testid="tb-condfmt-text" className={`${input} w-full`} />
          )}
          {type === 'color_scale' && (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {[false, true].map(x => (
                  <button key={String(x)} type="button" onClick={() => setThree(x)} aria-pressed={three === x}
                    className={`h-6 px-2 rounded border ${three === x ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200'}`}>{t(x ? 'sheet_cf_scale_three' : 'sheet_cf_scale_two')}</button>
                ))}
                <span className="flex-1 h-6 rounded border border-black/10" style={{ background: `linear-gradient(90deg, ${three ? scale.join(', ') : `${scale[0]}, ${scale[2]}`})` }} />
              </div>
              <div className="flex gap-3">
                {colorIn(scale[0], c => setScale(s => [c, s[1], s[2]]), 'tb-condfmt-low', t('sheet_cf_low'))}
                {three && colorIn(scale[1], c => setScale(s => [s[0], c, s[2]]), 'tb-condfmt-mid', t('sheet_cf_mid'))}
                {colorIn(scale[2], c => setScale(s => [s[0], s[1], c]), 'tb-condfmt-high', t('sheet_cf_high'))}
              </div>
            </div>
          )}
          {type === 'data_bar' && colorIn(bar, setBar, 'tb-condfmt-bar', t('sheet_cf_bar_color'))}
          {styled && (
            <div className="space-y-1">
              <div className="text-gray-500">{t('sheet_cf_format')}</div>
              {[...COND_PRESET_NAMES, 'custom' as const].map(p => (
                <label key={p} className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer ${preset === p ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                  <input type="radio" name="cf-preset" checked={preset === p} onChange={() => setPreset(p)} data-testid={`tb-condfmt-preset-${p}`} />
                  <Swatch s={p === 'custom' ? { fg, bg, ...(bold ? { b: true as const } : {}) } : COND_PRESETS[p]} />
                  <span className="truncate">{t(`sheet_cf_p_${p}` as TKey)}</span>
                </label>
              ))}
              {preset === 'custom' && (
                <div className="flex items-center gap-3 pl-7">
                  {colorIn(fg, setFg, 'tb-condfmt-fg', t('sheet_cf_text_color'))}
                  {colorIn(bg, setBg, 'tb-condfmt-bg', t('sheet_cf_fill_color'))}
                  <label className="inline-flex items-center gap-1"><input type="checkbox" checked={bold} onChange={e => setBold(e.target.checked)} />{t('sheet_cf_bold')}</label>
                </div>
              )}
            </div>
          )}
          {err && <div className="text-red-600" data-testid="tb-condfmt-err">{err}</div>}
          <div className="flex gap-2 pt-0.5">
            <button type="button" onClick={apply} data-testid="tb-condfmt-apply" className="h-7 px-3 rounded bg-blue-600 text-white hover:bg-blue-700">{t('sheet_cf_apply')}</button>
            <button type="button" onClick={() => onAction({ kind: 'clear' })} data-testid="tb-condfmt-clear" disabled={!rules?.length}
              className={`h-7 px-3 rounded border border-gray-200 hover:bg-gray-50 ${rules?.length ? '' : 'opacity-40 cursor-default'}`}>{t('sheet_cf_clear')}</button>
          </div>
          <div className="border-t border-gray-100 pt-2" data-testid="tb-condfmt-rules">
            <div className="text-[11px] text-gray-400 mb-1">{t('sheet_cf_here')}</div>
            {!rules?.length && <div className="text-gray-400">{t('sheet_cf_none')}</div>}
            {rules?.map(r => (
              <div key={r.id} className="flex items-center gap-2 py-0.5" data-testid="tb-condfmt-rule" data-rule-id={r.id}>
                {r.type === 'color_scale' ? <span className="w-7 h-5 rounded border border-black/10 shrink-0" style={{ background: `linear-gradient(90deg, ${(r.colors ?? []).join(', ')})` }} />
                  : r.type === 'data_bar' ? <span className="w-7 h-5 rounded border border-black/10 shrink-0" style={{ background: `linear-gradient(90deg, ${r.colors?.[0] ?? DATA_BAR_DEFAULT} 60%, transparent 60%)` }} />
                  : <Swatch s={r.style} />}
                <span className="flex-1 min-w-0 truncate" title={ruleSummary(r, t)}>{ruleSummary(r, t)}</span>
                <button type="button" title={t('sheet_cf_delete')} aria-label={t('sheet_cf_delete')} onClick={() => onAction({ kind: 'delete', id: r.id })}
                  className="w-5 h-5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600 shrink-0">×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
