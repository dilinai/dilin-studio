'use client'

/**
 * 组件清单里的富文字框（文字组件／形状内文字共用）＋原顶栏那条文字工具栏（整组搬进来）。
 *   每打一个字 ⇒ onChange(段落)：宿主拿去即时画到画布上（预览），停手 0.6 秒或失焦才存（onCommit）；
 *   正在打字时不被外来的资料盖掉（焦点在框里＝框里的为准）；换了组件／失焦时外来的新资料才重画进来；
 *   贴上一律当纯文字（⛔ 把别处网页的样式带进来）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import SlidesFormatToolbar from './SlidesFormatToolbar'
import type { TextBox, TextParagraph } from '../kit/components/types'
import type { ResolveCtx } from '../kit/components/resolve'
import { applyFormat, boxRootStyle, copyFormatAt, paintParagraphs, pasteFormat, readParagraphs, readSelState, renderParagraphs, RICH_EDITOR_CSS, type PainterStyle, type RichSelState } from './richtext'

export type RichTextEditorProps = {
  /** 换组件就换键（同一组件连续编辑不重画） */
  editorKey: string
  paragraphs: TextParagraph[]
  box: TextBox
  ctx: ResolveCtx
  /** 编辑框底色（跟页面底色·白字不会看不见） */
  surface: string
  onChange: (paragraphs: TextParagraph[]) => void
  onCommit: () => void
  disabled?: boolean
  /** 宿主换成库里新版（轮询 reload／选边条套用／保留我的重发完）时 +1：
   *  这一拍即使框有焦点，资料与框不同也强制重画（⛔ 留旧 DOM——留了下一次 emit 就把旧字存回、盖掉别人那版）。 */
  syncEpoch?: number
}

// 焦点框读回器：轮询判「框里的字跟新版一不一样」要读焦点框现文（经 ctx 读回段落）。
const readers = new WeakMap<Element, () => TextParagraph[]>()
/** 焦点正在哪个富文字框（组件 id＋框内现在的段落）；焦点不在富文字框 ⇒ null。 */
export function readFocusedRichEditor(doc: Document): { componentId: string; paragraphs: TextParagraph[] } | null {
  const el = doc.activeElement
  if (!el) return null
  const read = readers.get(el)
  const id = el.getAttribute('data-comp-id')
  if (!read || !id) return null
  return { componentId: id, paragraphs: read() }
}

function caretToEnd(root: HTMLElement) {
  const sel = root.ownerDocument.getSelection()
  if (!sel) return
  const r = root.ownerDocument.createRange()
  r.selectNodeContents(root)
  r.collapse(false)
  sel.removeAllRanges()
  sel.addRange(r)
}

export default function RichTextEditor(p: RichTextEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<string>('')
  const keyRef = useRef<string>('')
  const epochRef = useRef<number | undefined>(p.syncEpoch)
  const [sel, setSel] = useState<RichSelState>({})
  const [painter, setPainter] = useState<PainterStyle | null>(null)
  const { onChange } = p

  // 资料 ⇒ 框：换组件必重画；同组件只在「不在框里打字」且资料真的变了时重画；
  //   宿主换成新版（syncEpoch 变）⇒ 有焦点也重画（资料与框不同时）·光标放到末尾（之后 emit 出的是新版基础上的字）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const json = JSON.stringify(p.paragraphs)
    const focused = root.ownerDocument.activeElement === root
    const resync = epochRef.current !== p.syncEpoch
    epochRef.current = p.syncEpoch
    if (keyRef.current !== p.editorKey || ((!focused || resync) && json !== lastRef.current)) {
      renderParagraphs(root, p.paragraphs, p.ctx)
      lastRef.current = json
      keyRef.current = p.editorKey
      if (focused) caretToEnd(root)
    }
  }, [p.editorKey, p.paragraphs, p.ctx, p.syncEpoch])

  // 焦点框读回器登记（轮询经 readFocusedRichEditor 读）
  const ctxRef = useRef(p.ctx)
  ctxRef.current = p.ctx
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    readers.set(root, () => readParagraphs(root, ctxRef.current))
    return () => { readers.delete(root) }
  }, [])

  const emit = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    paintParagraphs(root)
    const ps = readParagraphs(root, p.ctx)
    lastRef.current = JSON.stringify(ps)
    onChange(ps)
  }, [p.ctx, onChange])

  // 选区状态（工具栏高亮）
  useEffect(() => {
    const doc = rootRef.current?.ownerDocument
    if (!doc) return
    const h = () => { const root = rootRef.current; if (root && doc.activeElement === root) setSel(readSelState(root)) }
    doc.addEventListener('selectionchange', h)
    return () => doc.removeEventListener('selectionchange', h)
  }, [])

  const onFormat = (cmd: string, value?: string | number) => {
    const root = rootRef.current
    if (!root || p.disabled) return
    if (root.ownerDocument.activeElement !== root) root.focus()
    if (applyFormat(root, cmd, value, p.ctx)) emit()
    setSel(readSelState(root))
  }

  const rootStyle = boxRootStyle(p.box, p.ctx)
  // 大字（标题 46px）在清单里缩着看：整框 zoom（光标与选区照常·行内 px 字号一起缩）
  const zoom = Math.max(0.35, Math.min(1, 18 / Math.max(1, p.box.size)))

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden" data-testid="slc-rich">
      <style>{RICH_EDITOR_CSS}</style>
      <SlidesFormatToolbar variant="component" enabled={!p.disabled} editMode painterActive={!!painter} sel={sel}
        onFormat={onFormat}
        onCopyFormat={() => {
          const root = rootRef.current
          if (!root) return
          if (painter) { setPainter(null); return }
          const st = copyFormatAt(root)
          if (st) setPainter(st)
        }} />
      <div className="max-h-64 overflow-y-auto" style={{ background: p.surface }}>
        <div
          ref={rootRef}
          className="slc-rich px-3 py-2 min-h-[3em] select-text"
          contentEditable={!p.disabled}
          suppressContentEditableWarning
          spellCheck={false}
          data-testid="slc-rich-editor"
          data-comp-id={p.editorKey}
          style={{ ...rootStyle, zoom, cursor: painter ? 'copy' : 'text' } as React.CSSProperties}
          onInput={emit}
          onBlur={() => p.onCommit()}
          onMouseUp={() => {
            const root = rootRef.current
            if (!root || !painter) return
            window.setTimeout(() => { if (pasteFormat(root, painter)) emit(); setPainter(null) }, 0)
          }}
          onKeyDown={(e) => { if (e.key === 'Escape' && painter) setPainter(null) }}
          onPaste={(e) => {
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain')
            if (text) document.execCommand('insertText', false, text)
          }}
        />
      </div>
    </div>
  )
}
