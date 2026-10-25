'use client'

/**
 * 云文档自由组件·编辑器的一层
 *
 * 一层（plane）一份、每页一块通用框层（FrameLayer·拖动／把手／旋转／拉框／右键四项）：
 * · above：叠在正文上面·passThrough（空白处让给底下的正文打字；只有组件本身接滑鼠）；
 * · below：垫在正文底下（正文 z-index 1 盖住它）·平时不接滑鼠（⛔ 挡打字）；宿主开「选底层组件」时（active）整层抬到正文上面才接滑鼠。
 * 坐标：FrameLayer 的逻辑单位＝毫米（pageWidth×pageHeight＝纸张毫米）·scale＝CSS_PX_PER_MM×缩放；每页一块摆在 pageTopPx(page)。
 * 层次：右键四项只在同页同层里算（moveDocLayersZScoped）；⛔ 图层视窗。
 * 右键另加（extraMenuItems）：移到文字下面／上面（切 plane）、改回跟着文字走、锁定／解除锁定、删除。
 * 双击：文字方块＝原地改字；视频／音频＝框里的播放钮可按（框边仍可拖）。选中单个文字方块 ⇒ 框上方出样式条（字号、颜色、底色、框线、对齐）。
 */

import { useEffect, useMemo, type CSSProperties } from 'react'
import { useStudioT } from '../../../shared/StudioT'
import FrameLayer, { type FrameLayerItem, type FrameLayerMenuItem } from '../../../shared/components/FrameLayer'
import {
  DEFAULT_TEXTBOX_PT, applyFrameChanges, layerFrame, layersOnPage, mmToPx, moveDocLayersZScoped, pageLeftPx, pageTopPx, patchTextBox, removeLayers, setLayersLocked, setLayersPlane,
  type DocLayerGeometry,
} from '../../core/doc-layers/editor'
import { CSS_PX_PER_MM } from '../../core/paper-size'
import type { DocLayerItem, DocLayerPlane, DocTextBox } from '../../core/doc-layers/types'
import DocLayerContent from './DocLayerContent'

type FI = FrameLayerItem & { item: DocLayerItem }

export type DocLayersPlaneProps = {
  /** 全部组件（阵列顺序＝层次） */
  items: readonly DocLayerItem[]
  plane: DocLayerPlane
  pageCount: number
  geometry: DocLayerGeometry
  docId: string
  selectedIds: readonly string[]
  onSelect: (ids: string[]) => void
  /** 任何改动都回整份新阵列 */
  onChange: (next: DocLayerItem[]) => void
  /** below 层：开了「选底层组件」才接滑鼠 */
  active: boolean
  editingId: string | null
  onEditingId: (id: string | null) => void
  liveId: string | null
  onLiveId: (id: string | null) => void
  /** 「改回跟着文字走」 */
  onToFlow: (id: string) => void
}

const isEditableEl = (el: Element) => {
  const tag = el.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable
}

export default function DocLayersPlane(props: DocLayersPlaneProps) {
  const t = useStudioT()
  const { items, plane, geometry, active } = props
  const z = geometry.zoom
  const scale = CSS_PX_PER_MM * z
  const pages = Array.from({ length: Math.max(1, props.pageCount) }, (_, i) => i + 1)
  const sel = useMemo(() => new Set(props.selectedIds), [props.selectedIds])
  const mine = items.filter(it => it.plane === plane)

  // Delete／Backspace：焦点在本层（框层根）且有选中 ⇒ 删
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as Element | null
      if (!el || typeof el.closest !== 'function' || isEditableEl(el) || !el.closest(`[data-doc-layers-plane="${plane}"]`)) return
      const ids = props.items.filter(it => it.plane === plane && sel.has(it.id) && !it.locked).map(it => it.id)
      if (!ids.length) return
      e.preventDefault()
      props.onChange(removeLayers(props.items, ids))
      props.onSelect([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plane, props, sel])

  if (!mine.length) return null

  const menuFor = (ids: string[]): FrameLayerMenuItem[] => {
    const its = items.filter(it => ids.includes(it.id))
    if (!its.length) return []
    const anyUnlocked = its.some(it => !it.locked)
    const out: FrameLayerMenuItem[] = [
      plane === 'above'
        ? { key: 'to-below', label: t('doc_layer_to_below'), onSelect: () => props.onChange(setLayersPlane(items, ids, 'below')) }
        : { key: 'to-above', label: t('doc_layer_to_above'), onSelect: () => props.onChange(setLayersPlane(items, ids, 'above')) },
    ]
    if (ids.length === 1) out.push({ key: 'to-flow', label: t('doc_layer_to_flow'), onSelect: () => props.onToFlow(ids[0]) })
    if (ids.length === 1 && its[0].kind === 'text' && !its[0].locked) out.push({ key: 'edit-text', label: t('doc_layer_edit_text'), onSelect: () => props.onEditingId(ids[0]) })
    out.push({ key: anyUnlocked ? 'lock' : 'unlock', label: t(anyUnlocked ? 'doc_layer_lock' : 'doc_layer_unlock'), onSelect: () => props.onChange(setLayersLocked(items, ids, anyUnlocked)) })
    out.push({ key: 'delete', label: t('doc_layer_delete'), onSelect: () => { props.onChange(removeLayers(items, ids)); props.onSelect([]) } })
    return out
  }

  const single = props.selectedIds.length === 1 ? mine.find(it => it.id === props.selectedIds[0]) : undefined
  const styleBarFor = single && single.kind === 'text' && !single.locked && (plane === 'above' || active) ? single : null

  return (
    <div className="doc-layers-plane" data-doc-layers-plane={plane} data-testid={`doc-layers-plane-${plane}`} data-active={active ? '1' : undefined}
      style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: plane === 'below' && !active ? 0 : 3, pointerEvents: 'none' }}>
      {pages.map(page => {
        const its: FI[] = layersOnPage(items, page, plane).map(it => ({ id: it.id, frame: layerFrame(it), locked: it.locked, hidden: it.hidden, item: it }))
        if (!its.length && !(plane === 'below' && active)) return null
        const pageSel = props.selectedIds.filter(id => its.some(fi => fi.id === id))
        const scope = (it: DocLayerItem) => it.page === page && it.plane === plane
        return (
          <div key={page} data-doc-layer-root={`${plane}-${page}`} data-page={page}
            style={{ position: 'absolute', left: pageLeftPx(geometry), top: pageTopPx(page, geometry), pointerEvents: 'none' }}>
            <FrameLayer<FI>
              items={its}
              pageWidth={geometry.pageWmm}
              pageHeight={geometry.pageHmm}
              scale={scale}
              passThrough={plane === 'above' || !active}
              testIdPrefix={`dl-${plane}`}
              selectedIds={pageSel}
              onSelect={(ids) => props.onSelect(ids)}
              onFrames={(changes) => props.onChange(applyFrameChanges(items, changes))}
              onZMove={(ids, zm) => props.onChange(moveDocLayersZScoped(items, ids, zm, scope))}
              extraMenuItems={menuFor}
              onItemDoubleClick={(id) => {
                const it = items.find(x => x.id === id)
                if (!it || it.locked) return
                if (it.kind === 'text') props.onEditingId(id)
                else if (it.kind === 'video' || it.kind === 'audio' || it.kind === 'file') props.onLiveId(id)
              }}
              hitMode={(fi) => (fi.id === props.editingId || fi.id === props.liveId ? 'edge' : 'box')}
              isShortcutTarget={(target) => {
                const el = target as Element | null
                if (!el || typeof el.closest !== 'function' || isEditableEl(el)) return false
                return !!el.closest(`[data-doc-layer-root="${plane}-${page}"]`)
              }}
              renderItem={(fi) => {
                const interactive = fi.id === props.editingId || fi.id === props.liveId
                return (
                  <div className="doc-layer-item" data-kind={fi.item.kind} style={{ width: '100%', height: '100%', ...(interactive ? { pointerEvents: 'auto' as const } : {}) }}>
                    <DocLayerContent item={fi.item} zoom={z} docId={props.docId}
                      editing={fi.id === props.editingId}
                      onTextCommit={(md) => {
                        props.onEditingId(null)
                        if (fi.item.kind === 'text' && md !== fi.item.text.md) props.onChange(patchTextBox(items, fi.id, { md }))
                      }} />
                  </div>
                )
              }}
            />
            {styleBarFor && styleBarFor.page === page && (
              <TextStyleBar item={styleBarFor} zoom={z}
                onPatch={(patch) => props.onChange(patchTextBox(items, styleBarFor.id, patch))} />
            )}
          </div>
        )
      })}
    </div>
  )
}

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]

/** 文字方块样式条（选中单个文字方块时浮在框上方）：字号、文字颜色、底色、框线、对齐 */
function TextStyleBar({ item, zoom, onPatch }: { item: Extract<DocLayerItem, { kind: 'text' }>; zoom: number; onPatch: (p: Partial<DocTextBox>) => void }) {
  const t = useStudioT()
  const tx = item.text
  const top = Math.max(0, mmToPx(item.y, zoom) - 38)
  const btn = (on: boolean): CSSProperties => ({ padding: '2px 6px', borderRadius: 4, fontSize: 12, background: on ? '#DBEAFE' : 'transparent', color: '#1F2329' })
  const colorPick = (label: string, key: 'color' | 'fill' | 'border', fallback: string, clearable: boolean) => (
    <label className="flex items-center gap-1 text-[11px] text-gray-600" title={label}>
      <span>{label}</span>
      <input type="color" data-testid={`doc-layer-style-${key}`} value={(tx[key] ?? fallback).slice(0, 7)}
        onChange={(e) => onPatch({ [key]: e.target.value.toUpperCase() })} style={{ width: 22, height: 18, padding: 0, border: 'none', background: 'none' }} />
      {clearable && tx[key] && (
        <button type="button" onClick={() => onPatch({ [key]: undefined })} style={btn(false)} title={t('doc_layer_none')}>×</button>
      )}
    </label>
  )
  return (
    <div data-testid="doc-layer-style-bar" onPointerDown={(e) => e.stopPropagation()}
      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1 shadow-md"
      style={{ position: 'absolute', left: mmToPx(item.x, zoom), top, zIndex: 5, pointerEvents: 'auto', whiteSpace: 'nowrap' }}>
      <label className="flex items-center gap-1 text-[11px] text-gray-600">
        <span>{t('doc_layer_font_size')}</span>
        <select data-testid="doc-layer-style-size" value={String(tx.fontSizePt ?? DEFAULT_TEXTBOX_PT)} onChange={(e) => onPatch({ fontSizePt: Number(e.target.value) })}
          className="rounded border border-gray-200 text-[12px] px-1 py-0">
          {[...new Set([...FONT_SIZES, tx.fontSizePt ?? DEFAULT_TEXTBOX_PT])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {colorPick(t('doc_layer_color'), 'color', '#1F2329', false)}
      {colorPick(t('doc_layer_fill'), 'fill', '#FFFFFF', true)}
      {colorPick(t('doc_layer_border'), 'border', '#9CA3AF', true)}
      <span className="flex items-center gap-0.5">
        {(['left', 'center', 'right'] as const).map(a => (
          <button key={a} type="button" data-testid={`doc-layer-style-align-${a}`} style={btn((tx.align ?? 'left') === a)} onClick={() => onPatch({ align: a })}
            title={t(a === 'left' ? 'doc_layer_align_left' : a === 'center' ? 'doc_layer_align_center' : 'doc_layer_align_right')}>
            {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
          </button>
        ))}
      </span>
    </div>
  )
}
