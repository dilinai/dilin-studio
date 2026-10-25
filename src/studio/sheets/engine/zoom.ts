// 表格网格缩放系数
//   Ctrl＋滚轮／触控板两指捏合／屏幕触控捏合 ⇒ 只缩网格·不缩浏览器整页。
//   这里只放纯函数（夹取／步进／滚轮累积／捏合比例／本地存取键）·事件拦截在 SheetGrid.tsx。
//   范围 50%～200%·滚轮每步 10%·Ctrl+0 归 100%；捏合按两指距离比连续缩（取整到 1%）。

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const ZOOM_STEP = 0.1
export const ZOOM_DEFAULT = 1
/** |deltaY| 到这个量（或 deltaMode 非像素）＝鼠标滚轮一格 ⇒ 恰走一步（Chromium 一格 deltaY≈100·Firefox 行模式 deltaY=3 但 deltaMode=1） */
export const WHEEL_NOTCH_DELTA = 50
/** 小 deltaY（Mac／Chromium 触控板两指捏合每回合几到十几）攒到这个量才走一步·免得一捏就跳到头 */
export const WHEEL_STEP_DELTA = 25

/** 夹到 50%～200%·取整到 1%；坏值（NaN／非数）⇒ 100% */
export function clampZoom(z: number): number {
  if (typeof z !== 'number' || !Number.isFinite(z)) return ZOOM_DEFAULT
  const r = Math.round(z * 100) / 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, r))
}

/** 走一步（dir>0 放大·dir<0 缩小·0 不动）：先对齐到 10% 网格再加减·再夹取。例 1.03 放大 ⇒ 1.1；1.03 缩小 ⇒ 1.0 */
export function stepZoom(z: number, dir: number): number {
  const cur = clampZoom(z)
  if (dir === 0) return cur
  const next = dir > 0
    ? (Math.floor(cur / ZOOM_STEP + 1e-9) + 1) * ZOOM_STEP
    : (Math.ceil(cur / ZOOM_STEP - 1e-9) - 1) * ZOOM_STEP
  return clampZoom(next)
}

export type WheelZoomState = { zoom: number; acc: number }
/** 一次 Ctrl＋wheel（deltaY<0＝放大）：鼠标一格（|deltaY|≥WHEEL_NOTCH_DELTA 或 deltaMode≠0）恰走一步；
 *  小 delta（触控板捏合）累积·每满 WHEEL_STEP_DELTA 走一步·换向即清余量。返回新状态；到头后 acc 归零。 */
export function applyWheel(state: WheelZoomState, deltaY: number, deltaMode = 0): WheelZoomState {
  if (!Number.isFinite(deltaY) || deltaY === 0) return state
  let zoom = clampZoom(state.zoom)
  if (deltaMode !== 0 || Math.abs(deltaY) >= WHEEL_NOTCH_DELTA) return { zoom: stepZoom(zoom, deltaY < 0 ? +1 : -1), acc: 0 }
  let acc = (Math.sign(state.acc) === Math.sign(deltaY) ? state.acc : 0) + deltaY
  while (acc <= -WHEEL_STEP_DELTA) { zoom = stepZoom(zoom, +1); acc += WHEEL_STEP_DELTA }
  while (acc >= WHEEL_STEP_DELTA) { zoom = stepZoom(zoom, -1); acc -= WHEEL_STEP_DELTA }
  // 到头了就别把余量攒着（否则到顶后往回捏要先抵消一大段）
  if (zoom === ZOOM_MAX && acc < 0) acc = 0
  if (zoom === ZOOM_MIN && acc > 0) acc = 0
  return { zoom, acc }
}

/** 捏合：起手时的系数 × 两指距离比（或 Safari gesture 的 scale）·连续·取整到 1%·夹取。起手距离 0／坏值 ⇒ 不动 */
export function zoomFromPinch(startZoom: number, ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampZoom(startZoom)
  return clampZoom(startZoom * ratio)
}
/** 两触点距离 */
export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/** 显示用「150%」 */
export function formatZoom(z: number): string { return `${Math.round(clampZoom(z) * 100)}%` }

// ── 按档记（浏览器 localStorage·不同步远端） ──
export function zoomStorageKey(docId: string): string { return `aisheet:zoom:${docId}` }
export function readStoredZoom(docId: string, storage?: Pick<Storage, 'getItem'> | null): number {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    const raw = s?.getItem(zoomStorageKey(docId))
    if (raw == null || raw === '') return ZOOM_DEFAULT
    return clampZoom(Number(raw))
  } catch { return ZOOM_DEFAULT }
}
export function writeStoredZoom(docId: string, z: number, storage?: Pick<Storage, 'setItem' | 'removeItem'> | null): void {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    if (!s) return
    const v = clampZoom(z)
    if (v === ZOOM_DEFAULT) s.removeItem(zoomStorageKey(docId)); else s.setItem(zoomStorageKey(docId), String(v))
  } catch { /* 隐私模式／禁存 ⇒ 不记·页面照常 */ }
}
