/**
 * 简报组件画布 · 框的几何——本体在 @/lib/frame-kit（简报／云文档／云表格共用）。
 * 这里留旧路径：其余原样转出；吸附与把手在不在页面里这三支绑上简报逻辑画布（1000×562.5）·签名与旧版一样（行为零变化）。
 */

import {
  moveFrame as fkMoveFrame, moveGroup as fkMoveGroup, handleOnPage as fkHandleOnPage,
  type Frame, type Guide, type Handle, type IdFrame, type PageSize,
} from '../../shared/frame-kit'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../kit/types'

export {
  HANDLES, handleSign, normalizeFrame, normalizeAngle, resizeFrame, rotateFrame, aabb, nudgeFrame, handleCursor, framePatch,
  groupBox, nudgeGroup, resizeGroup, rotateGroup, groupRotateDelta, marqueeHits, groupZMoves, groupZOrder,
} from '../../shared/frame-kit'
export type { Handle, Guide, IdFrame, ArrowKey } from '../../shared/frame-kit'

/** 简报逻辑画布 */
export const SLIDE_PAGE: PageSize = { w: CANVAS_WIDTH, h: CANVAS_HEIGHT }

export function moveFrame(start: Frame, dx: number, dy: number, others: readonly Frame[], threshold: number, snap = true): { frame: Frame; guides: Guide[] } {
  return fkMoveFrame(SLIDE_PAGE, start, dx, dy, others, threshold, snap)
}

export function moveGroup(items: readonly IdFrame[], dx: number, dy: number, others: readonly Frame[], threshold: number, snap = true): { items: IdFrame[]; guides: Guide[] } {
  return fkMoveGroup(SLIDE_PAGE, items, dx, dy, others, threshold, snap)
}

export function handleOnPage(f: Frame, h: Handle | 'rotate', rotateGap: number): boolean {
  return fkHandleOnPage(SLIDE_PAGE, f, h, rotateGap)
}
