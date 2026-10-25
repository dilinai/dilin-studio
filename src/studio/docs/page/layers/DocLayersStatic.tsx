'use client'

/**
 * 云文档自由组件·只读显示
 * 照编辑器同一套坐标画（第几页＋离该页纸张左上角毫米 × CSS_PX_PER_MM × 缩放）·不可拖、没有右键选单。
 * 一层（plane）一份：below 叠在纸与正文之间（正文 z-index 1 盖住它）、above 叠在正文上面。
 * 容器＝纸叠左上角（分页视图＝.doc-paged；连续流＝正文区左上角·按 A4 直式页一页接一页）。
 * 每页一块、裁在纸内（同编辑器框层 overflow:clip·画面一致）。
 */

import { mmToPx, pageLeftPx, pageTopPx, type DocLayerGeometry } from '../../core/doc-layers/editor'
import type { DocLayerItem, DocLayerPlane } from '../../core/doc-layers/types'
import DocLayerContent from './DocLayerContent'

export default function DocLayersStatic({ items, plane, geometry, docId }: {
  items: readonly DocLayerItem[]
  plane: DocLayerPlane
  geometry: DocLayerGeometry
  docId: string | null | undefined
}) {
  const mine = items.filter(it => it.plane === plane && !it.hidden)
  if (!mine.length) return null
  const z = geometry.zoom
  const pages = [...new Set(mine.map(it => it.page))].sort((a, b) => a - b)
  const pw = mmToPx(geometry.pageWmm, z), ph = mmToPx(geometry.pageHmm, z)
  return (
    <div className="doc-layers-static" data-testid={`doc-layers-static-${plane}`}
      style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: plane === 'below' ? 0 : 3, pointerEvents: 'none' }}>
      {pages.map(page => (
        <div key={page} data-page={page} style={{ position: 'absolute', left: pageLeftPx(geometry), top: pageTopPx(page, geometry), width: pw, height: ph, overflow: 'clip' }}>
          {mine.filter(it => it.page === page).map(it => (
            <div key={it.id} className="doc-layer-item" data-testid="doc-layer-static-item" data-cid={it.id} data-kind={it.kind}
              style={{
                position: 'absolute', left: mmToPx(it.x, z), top: mmToPx(it.y, z), width: mmToPx(it.w, z), height: mmToPx(it.h, z),
                transform: it.rotate ? `rotate(${it.rotate}deg)` : undefined, pointerEvents: 'auto',
              }}>
              <DocLayerContent item={it} zoom={z} docId={docId} readOnly />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
