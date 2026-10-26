'use client'
// 游客版右栏底下那块：一个能混排字与小卡的输入框＋「一鍵複製」＋一句说明。
//   编辑器按 Alt+A（Mac ⌥A）⇒ 选中的内容做成小卡插在框的光标处（记号与画法同登入版对话输入框·../inline-box.ts）；
//   「一鍵複製」⇒ 框里的字连同每颗卡的记号照原顺序串成纯文字放进剪贴簿（同登入版送给角色的正文：卡就在原位）。
//   小卡＝contentEditable=false 的节点·光标贴着按退格／Delete 整颗删（./inline-card-dom）。

import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useStudioT } from '../StudioT'
import type { InlineBox } from '../inline-box'
import { deleteCardAtCaret, insertCardAt, serializeInlineBox } from './inline-card-dom'

/** 写进剪贴簿；写不进就退回旧法（隐藏 textarea＋execCommand） */
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text) } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch { /* 连这条都不行就算了 */ }
    ta.remove()
  }
}

const isAltA = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string }) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA'

export default function InlineCardBox({ box, app, dense, below }: { box: InlineBox; app: string; dense?: boolean; below?: boolean }) {
  const t = useStudioT()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const rangeRef = useRef<Range | null>(null)
  const [empty, setEmpty] = useState(true)
  const [msg, setMsg] = useState<'copied' | 'empty' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sync = () => { const r = rootRef.current; setEmpty(!r || serializeInlineBox(r).trim() === '') }

  // 记住框里最后的光标（焦点在编辑器上按 Alt+A 时插回那里）
  useEffect(() => {
    const onSel = () => {
      const r = rootRef.current
      const s = document.getSelection()
      if (r && s && s.rangeCount && r.contains(s.getRangeAt(0).startContainer)) rangeRef.current = s.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  useEffect(() => {
    box.bind((token) => {
      const r = rootRef.current
      if (!r) return
      const card = box.makeCard(document, token)
      const node = card ?? document.createTextNode(token)
      const after = insertCardAt(r, node, rangeRef.current)
      rangeRef.current = after.cloneRange()
      if (document.activeElement === r) { const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(after) }
      sync()
    })
    return () => box.bind(null)
  }, [box])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const flash = (m: 'copied' | 'empty') => { setMsg(m); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 1500) }
  const onCopy = () => {
    const r = rootRef.current
    const text = r ? serializeInlineBox(r).trim() : ''
    if (!text) { flash('empty'); return }
    void copyText(text).then(() => flash('copied'))
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isAltA(e)) return   // Alt+A 照样交给编辑器（插卡进本框）
    e.stopPropagation()     // 在框里打字 ⇒ 编辑器的单键快捷键别接
    if ((e.key === 'Backspace' || e.key === 'Delete') && rootRef.current && deleteCardAtCaret(rootRef.current, document.getSelection(), e.key === 'Backspace' ? 'back' : 'fwd')) { e.preventDefault(); sync() }
  }
  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    // 只收纯文字（别把外面的格式、图片贴进来）
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
  }
  const hintKey = app === 'video' ? 'studio_ai_box_hint_video' : app === 'sheets' ? 'studio_ai_box_hint_sheets' : 'studio_ai_box_hint'

  return (
    // flex-none：在右栏底下照常占位（上面清单区 flex-1 min-h-0 自己捲）；below＝清单下面还有没捲到的 ⇒ 上缘一道阴影
    <section className={`flex-none min-w-0 border-t border-[#E7E0D2] flex flex-col gap-2 ${below ? 'shadow-[0_-8px_12px_-10px_rgba(74,53,40,0.45)]' : ''} ${dense ? 'px-3 py-3' : 'px-4 py-4'}`} data-testid="studio-ai-box" data-below={below ? '' : undefined}>
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1 min-w-0">
          {empty && <div className="pointer-events-none absolute left-2.5 top-1.5 text-[13px] leading-6 text-[#A89880]" data-testid="studio-ai-box-placeholder">{t('studio_ai_box_placeholder')}</div>}
          <div ref={rootRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={t('studio_ai_box_placeholder')}
            onInput={sync} onKeyDown={onKeyDown} onPaste={onPaste} data-testid="studio-ai-box-input"
            className="w-full min-w-0 min-h-[76px] max-h-48 overflow-x-hidden overflow-y-auto [&_[data-token]]:max-w-[calc(100%-0.25rem)] rounded-xl border border-[#E7DCBE] bg-white px-2.5 py-1.5 text-[13px] leading-6 text-[#1f2937] whitespace-pre-wrap break-words outline-none focus:border-[#C9B58A]" />
        </div>
        <button type="button" onClick={onCopy} data-testid="studio-ai-box-copy"
          className="shrink-0 w-[4.5rem] rounded-xl bg-[#4A3528] px-2 text-[13px] font-semibold leading-tight text-white keep-white hover:bg-[#5C4434]">
          {msg === 'copied' ? t('studio_ai_copied') : t('studio_ai_box_copy')}
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-[#8A7B66]" role={msg ? 'status' : undefined} data-testid="studio-ai-box-hint">
        {msg === 'empty' ? t('studio_ai_box_empty') : t(hintKey)}
      </p>
    </section>
  )
}
