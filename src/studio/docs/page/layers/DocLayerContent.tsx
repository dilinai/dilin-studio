'use client'

/**
 * 云文档自由组件·一个组件里画什么
 * 编辑器（FrameLayer renderItem）与只读／分享页（DocLayersStatic）共用：画面所见＝导出所得。
 * · 文字方块：markdown 渲染（MarkdownView·同正文的颜色／粗斜指令）；editing＝换成文字框原地改（失焦／Esc 收）。
 * · 图片：SmartImage（私桶裸链 403 自动换签·同正文）·框内等比置中（contain·同导出）。
 * · 视频：正文视频卡同款（VideoCardView·点播放钮原地播）。
 * · 音频：正文音频卡同款（AudioCardView·内嵌播放条）。
 * · 档案卡：正文档案卡同款（FileCardView·点了开／下载·权限服务端现判）；影音档卡就地播。
 * 字号 pt → px：pt × 96/72 × 缩放（与纸张 mm → px 同一口径·画面＝打印）。
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDocsMedia } from '../media/env'
import { VideoCardView } from '../media/video/views'
import { AudioCardView } from '../media/audio/views'
import { DEFAULT_TEXTBOX_PT, mmToPx } from '../../core/doc-layers/editor'
import type { DocLayerItem, DocTextBox } from '../../core/doc-layers/types'

/** 文字方块的外框样式（编辑与显示同一份） */
export function textBoxStyle(text: DocTextBox, zoom: number): CSSProperties {
  const fontPx = (text.fontSizePt ?? DEFAULT_TEXTBOX_PT) * (96 / 72) * zoom
  return {
    width: '100%', height: '100%', boxSizing: 'border-box', overflow: 'hidden',
    padding: mmToPx(text.paddingMm ?? 2, zoom),
    background: text.fill ?? 'transparent',
    border: text.border ? `1px solid ${text.border}` : undefined,
    color: text.color ?? '#1F2329',
    fontSize: fontPx, lineHeight: 1.5,
    textAlign: text.align ?? 'left',
    display: 'flex', flexDirection: 'column',
    justifyContent: text.valign === 'middle' ? 'center' : text.valign === 'bottom' ? 'flex-end' : 'flex-start',
  }
}

export default function DocLayerContent({ item, zoom, docId, editing, onTextCommit, readOnly }: {
  item: DocLayerItem
  zoom: number
  docId: string | null | undefined
  /** 文字方块正在原地改 */
  editing?: boolean
  /** 改完（失焦／Esc）回新的 markdown（没变也回·宿主自己比） */
  onTextCommit?: (md: string) => void
  readOnly?: boolean
}) {
  const { Markdown: MarkdownView, Image: SmartImage, FileCard: FileCardView, displayName } = useDocsMedia()
  switch (item.kind) {
    case 'text':
      return editing && onTextCommit
        ? <TextBoxEditor text={item.text} zoom={zoom} onCommit={onTextCommit} />
        : (
          <div className="doc-layer-text" data-testid="doc-layer-text" style={textBoxStyle(item.text, zoom)}>
            {item.text.md.trim() ? <MarkdownView content={item.text.md} className="doc-layer-text-md" /> : null}
          </div>
        )
    case 'image':
      return <SmartImage src={item.src} alt={item.alt ?? ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
    case 'video':
      return <div className="doc-layer-media" data-testid="doc-layer-video"><VideoCardView src={item.src} name={item.name ?? ''} size={null} thumbnail={item.poster ?? null} readOnly={readOnly} /></div>
    case 'audio':
      return <div className="doc-layer-media" data-testid="doc-layer-audio"><AudioCardView src={item.src} name={item.name ?? ''} size={null} readOnly={readOnly} /></div>
    case 'file':
      return (
        <div className="doc-layer-media" data-testid="doc-layer-file">
          {FileCardView
            ? <FileCardView docId={docId} attrs={{ fileId: item.fileId, name: item.name ?? '', size: item.size ?? null, mime: item.mime ?? '', createdAt: '' }} fill />
            : <div className="text-xs text-gray-500 truncate p-2">{displayName(item.name ?? '')}</div>}
        </div>
      )
  }
}

function TextBoxEditor({ text, zoom, onCommit }: { text: DocTextBox; zoom: number; onCommit: (md: string) => void }) {
  const [v, setV] = useState(text.md)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, [])
  const commit = () => { if (done.current) return; done.current = true; onCommit(v) }
  const st = textBoxStyle(text, zoom)
  return (
    <textarea
      ref={ref}
      data-testid="doc-layer-text-editor"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); commit() } }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ ...st, display: 'block', resize: 'none', outline: '2px solid #2563eb', fontFamily: 'inherit', pointerEvents: 'auto' }}
    />
  )
}
