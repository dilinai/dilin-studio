import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { alertDialog } from '../../shared/dialog-store'

/** 格式刷用到的两句提示（键名同网站字典）。 */
export type FormatPainterKey = 'bf_doc_painter_select_first' | 'bf_doc_painter_no_format'

type CapturedMark = { type: string; attrs: Record<string, unknown> }
type PainterCapture = { marks: CapturedMark[]; from: number; to: number }

// 三色 + 加粗/斜体/删除线
const PAINTER_MARK_TYPES = ['colorMark', 'bgMark', 'boxMark', 'bold', 'italic', 'strike']

// 选区「安静」多久才算定型再套用（覆盖鼠标拖选/触屏长按拖柄/键盘 Shift+方向——见下方 effect 注释）。
const SETTLE_MS = 220

export function useFormatPainter(editor: Editor | null, t: (key: FormatPainterKey) => string) {
  const [painterArmed, setPainterArmed] = useState(false)
  const painterRef = useRef<PainterCapture | null>(null)

  const armFormatPainter = useCallback(() => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    if (empty) { void alertDialog(t('bf_doc_painter_select_first')); return }
    if (painterArmed) { setPainterArmed(false); painterRef.current = null; return }  // 再点一次取消
    const wanted = new Set(PAINTER_MARK_TYPES)
    const collected = new Map<string, CapturedMark>()
    editor.state.doc.nodesBetween(from, to, (node) => {
      node.marks.forEach(m => {
        if (wanted.has(m.type.name) && !collected.has(m.type.name)) {
          collected.set(m.type.name, { type: m.type.name, attrs: { ...m.attrs } })
        }
      })
    })
    if (collected.size === 0) { void alertDialog(t('bf_doc_painter_no_format')); return }
    painterRef.current = { marks: [...collected.values()], from, to }
    setPainterArmed(true)
  }, [editor, painterArmed, t])

  useEffect(() => {
    if (!editor || !painterArmed) return
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let pointerDown = false
    let shiftHeld = false
    let pendingApply = false
    const applyToCurrentSelection = () => {
      const cap = painterRef.current
      if (!cap) return
      const { from, to, empty } = editor.state.selection
      if (empty) return                              // 折叠光标（点击）→ 还停着等目标
      if (from === cap.from && to === cap.to) return  // 仍是源选区 → 等
      const capturedTypes = new Set(cap.marks.map(m => m.type))
      let chain = editor.chain().focus().setTextSelection({ from, to })
      PAINTER_MARK_TYPES.forEach(type => {
        if (capturedTypes.has(type)) return           // 源本就捕获到该类型 → 随后 setMark 会覆盖，不必先 unset
        if (!editor.schema.marks[type]) return         // 防御：schema 未注册该 mark，跳过避免抛异常连累后续 chain
        chain = chain.unsetMark(type)
      })
      cap.marks.forEach(m => { chain = chain.setMark(m.type, m.attrs) })
      chain.run()
      painterRef.current = null
      setPainterArmed(false)
    }
    const trySettleApply = () => {
      if (pointerDown || shiftHeld) { pendingApply = true; return }  // finding#5/#3：还按着，先记下等松开
      pendingApply = false
      applyToCurrentSelection()
    }
    const onSelectionChange = () => {
      // 只认落在本编辑器 DOM 内的选区变化（别的输入框/页面别的地方选字别误触发这个刷子）
      const dom = editor.view.dom
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const anchorInside = sel.anchorNode ? dom.contains(sel.anchorNode) || sel.anchorNode === dom : false
      if (!anchorInside) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => { requestAnimationFrame(trySettleApply) }, SETTLE_MS)
    }
    const onPointerDown = () => { pointerDown = true }
    const onPointerUp = () => {
      pointerDown = false
      if (pendingApply && !shiftHeld) { pendingApply = false; requestAnimationFrame(applyToCurrentSelection) }
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.shiftKey) shiftHeld = true }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return  // 只认 Shift 键本身释放；方向键单独松开不算"扩选结束"
      shiftHeld = false
      if (pendingApply && !pointerDown) { pendingApply = false; requestAnimationFrame(applyToCurrentSelection) }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown, { passive: true })
    document.addEventListener('mouseup', onPointerUp)
    document.addEventListener('touchend', onPointerUp)
    document.addEventListener('touchcancel', onPointerUp)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('mouseup', onPointerUp)
      document.removeEventListener('touchend', onPointerUp)
      document.removeEventListener('touchcancel', onPointerUp)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      if (settleTimer) clearTimeout(settleTimer)
    }
  }, [editor, painterArmed])

  return { painterArmed, armFormatPainter }
}
