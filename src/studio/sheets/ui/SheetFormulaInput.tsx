'use client'
// 公式输入框
//   ① 引用同色高亮：input 文字设透明、底下垫一层同字体同内距的「镜像」逐段上色（公式里的 A1 与网格上的虚框同色）
//   ② 语法错那一段：镜像里加红色波浪底线（错在哪由 engine/formula-edit.ts checkFormula 给起止）
//   ③ 函数名自动补全：打到函数名一半 ⇒ 下拉前缀相符的函数（↑↓ 选·Enter／Tab 插入「SUM(」·Esc 收起）
// 出处：补全下拉的键盘规矩（↑↓ 循环·Enter／Tab 选中插入 NAME(）抄 fortune-sheet（MIT·Copyright (c) 2022 Suzhou Ruilisi Technology Co., Ltd）
//   packages/react/src/components/SheetOverlay/InputBox.tsx selectActiveFormula／onKeyDown；清单外观（已打的前缀标色·下一行说明）参考 univer
//   （Apache-2.0）packages/sheets-formula-ui/src/views/formula-editor/search-function/SearchFunction.tsx。镜像叠色法两仓都没有
//   （它们用 contenteditable 富文本逐段 span）⇒ 自写：本仓编辑框是原生 <input>（输入法组字、原生 Ctrl+Z 撤输入框文字都靠它）不换 contenteditable。
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { useSheetT } from './host'
import { functionSuggestions, applySuggestion, type RefHighlight, type FormulaIssue } from '../engine/formula-edit'
import { caretPatch, readCaretView, type CaretView } from './sheet-caret-sync.pure'

type Props = {
  value: string
  onChange: (v: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  highlights: RefHighlight[]
  issue: FormulaIssue | null
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  readOnly?: boolean
  testid: string
  /** 外框（定位用·含背景） */
  wrapClassName: string
  /** input 与镜像共用的字体／内距 class（两边必须一致才对得齐） */
  textClassName: string
  style?: CSSProperties
}

export default function SheetFormulaInput({ value, onChange, inputRef, highlights, issue, onKeyDown, onFocus, onBlur, readOnly, testid, wrapClassName, textClassName, style }: Props) {
  const t = useSheetT()
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [caret, setCaret] = useState<number>(value.length)
  const [scrollX, setScrollX] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const isFormula = value.startsWith('=')

  // （React #185）：先跟上回 set 过的比·没变就不 set（原先每次渲染后都 set ⇒ 极快连打长公式时嵌套更新累计超限）
  const shown = useRef<CaretView>({ caret: value.length, scrollX: 0 })
  const applyView = (next: CaretView) => {
    const patch = caretPatch(shown.current, next)
    if (!patch) return
    shown.current = next
    if (patch.caret !== undefined) setCaret(patch.caret)
    if (patch.scrollX !== undefined) setScrollX(patch.scrollX)
  }
  const syncCaret = () => {
    const el = inputRef.current
    if (!el) return
    applyView(readCaretView(el))
  }
  useEffect(() => { syncCaret() })   // 每次渲染后对一下（父层程式化改值／插引用后光标会动）·没变就不 set

  const sug = useMemo(() => (isFormula && !readOnly ? functionSuggestions(value, caret) : null), [isFormula, readOnly, value, caret])
  const open = !!sug && dismissed !== `${value}@${caret}`
  useEffect(() => { setActive(0) }, [sug?.prefix])

  const pick = (name: string) => {
    if (!sug) return
    const r = applySuggestion(value, sug, name)
    onChange(r.text)
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret); syncCaret() } })
  }

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (open && sug) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % sug.items.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + sug.items.length) % sug.items.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(sug.items[Math.min(active, sug.items.length - 1)]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(`${value}@${caret}`); return }
    }
    onKeyDown?.(e)
  }

  // 镜像：按高亮段／错段切片
  const pieces = useMemo(() => {
    if (!isFormula) return null
    const marks: { start: number; end: number; color?: string; err?: boolean }[] = highlights.map(h => ({ start: h.start, end: h.end, color: h.color }))
    if (issue) marks.push({ start: issue.start, end: Math.min(value.length, Math.max(issue.end, issue.start + 1)), err: true })
    const cuts = new Set<number>([0, value.length])
    for (const m of marks) { cuts.add(Math.max(0, Math.min(value.length, m.start))); cuts.add(Math.max(0, Math.min(value.length, m.end))) }
    const pts = [...cuts].sort((a, b) => a - b)
    const out: { text: string; color?: string; err?: boolean }[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      if (a === b) continue
      const hl = marks.find(m => !m.err && m.start <= a && m.end >= b)
      const er = marks.some(m => m.err && m.start <= a && m.end >= b)
      out.push({ text: value.slice(a, b), color: hl?.color, err: er })
    }
    // 错在结尾（缺右括号／缺数值）⇒ 结尾补一个看得见的红点位
    if (issue && issue.start >= value.length) out.push({ text: ' ', err: true })
    return out
  }, [isFormula, highlights, issue, value])

  return (
    <div className={`relative ${wrapClassName}`} style={style}>
      {pieces && (
        <div ref={mirrorRef} aria-hidden className={`absolute inset-0 pointer-events-none overflow-hidden whitespace-pre flex items-center ${textClassName}`} data-testid={`${testid}-mirror`}>
          <span style={{ transform: `translateX(${-scrollX}px)` }} className="inline-block">
            {pieces.map((p, i) => (
              <span key={i} style={{ color: p.color ?? '#1f2937', ...(p.err ? { textDecoration: 'underline wavy #dc2626', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' } : {}) }}
                data-err={p.err ? '1' : undefined} data-ref-color={p.color}>{p.text}</span>
            ))}
          </span>
        </div>
      )}
      <input ref={inputRef as RefObject<HTMLInputElement>} value={value} readOnly={readOnly} data-testid={testid} spellCheck={false} autoComplete="off"
        onChange={e => { onChange(e.target.value); applyView(readCaretView(e.target)) }}
        onKeyDown={onKey}
        onKeyUp={syncCaret} onClick={syncCaret} onSelect={syncCaret} onScroll={syncCaret}
        onFocus={onFocus} onBlur={onBlur}
        className={`relative w-full h-full bg-transparent outline-none ${textClassName}`}
        style={pieces ? { color: 'transparent', caretColor: '#111827' } : undefined} />
      {open && sug && (
        <ul role="listbox" data-testid={`${testid}-suggest`}
          className="absolute left-0 top-full mt-1 z-[60] min-w-[220px] max-h-[260px] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg py-1 text-left">
          {sug.items.map((name, i) => (
            <li key={name} role="option" aria-selected={i === active}>
              <button type="button" data-testid={`${testid}-suggest-${name}`}
                onMouseDown={e => { e.preventDefault(); pick(name) }}
                className={`w-full px-2.5 py-1 text-left ${i === active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <span className="block font-mono text-[13px] text-gray-900"><span className="text-red-500">{name.slice(0, sug.prefix.length)}</span>{name.slice(sug.prefix.length)}</span>
                <span className="block text-[11px] text-gray-500">{t(`sheet_fn_${name}` as 'sheet_fn_SUM')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
