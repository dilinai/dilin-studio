/**
 * 中栏预览框贴合（16:9）——纯函数·宿主的 ResizeObserver 拿量到的尺寸来算；下方清单的高度不影响预览框尺寸。
 *
 *   预览框＝可用宽贴合 16:9；窗口太矮时按高度贴合，但高度上限只扣掉「下方面板格保底高」——
 *     组件版（本頁元件清单）扣固定的 PANEL_RESERVE，⛔ 跟清单项数／展开的编辑器高度走：清单多了在自己格里卷动，预览尺寸不变。
 *   旧整页简报（下方只有一条「另存元件版」横条或文字格面板）：扣面板自然高，但最多扣 PANEL_RESERVE（同样不会被面板挤扁）。
 */

/** 下方面板格保底高（px）：清单表头＋约 4～5 行 */
export const PANEL_RESERVE = 200
/** 极矮窗口保底：预览框至少这么高（面板在自己格里卷动） */
export const STAGE_MIN_H = 120

export type StageFitInput = {
  /** 预览区可用宽高（已扣掉预览框 1px 边框） */
  aw: number
  ah: number
  /** 下方面板内容自然高（组件版不参与计算） */
  panelNatH: number
  /** 组件版（本頁元件清单）⇒ 扣固定保底高 */
  listMode: boolean
  /** 下方面板高：预览与元件清单之间分隔条拖出来的值（组件版才用·null／不给＝PANEL_RESERVE） */
  panelH?: number | null
}

/** 拖拉条：下方面板至少这么高（表头＋一行） */
export const PANEL_MIN_H = 80
/** 拖拉条存档键（本机·每台浏览器各记各的） */
export const PANEL_H_KEY = 'dilinai.slides.panelH'

/** 拖拉后的面板高钳在 [PANEL_MIN_H, ah − STAGE_MIN_H]（预览框至少留 STAGE_MIN_H）。 */
export function clampPanelH(h: number, ah: number): number {
  const max = Math.max(PANEL_MIN_H, ah - STAGE_MIN_H)
  return Math.round(Math.min(max, Math.max(PANEL_MIN_H, h)))
}

/** 拖动中：起手时面板高 startH·指针从 startY 移到 y ⇒ 往下拖面板变矮（预览变大）、往上拖面板变高。 */
export function dragPanelH(startH: number, startY: number, y: number, ah: number): number {
  return clampPanelH(startH - (y - startY), ah)
}

/** 存档读回：不是正数就当没拖过。 */
export function parsePanelH(raw: string | null): number | null {
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

export function stageReserve(i: Pick<StageFitInput, 'panelNatH' | 'listMode' | 'panelH'>): number {
  if (i.listMode) return i.panelH ?? PANEL_RESERVE
  return Math.min(Math.max(0, i.panelNatH), PANEL_RESERVE)
}

export function fitStage(i: StageFitInput): { w: number; h: number } | null {
  if (i.aw <= 0 || i.ah <= 0) return null
  const maxH = Math.max(STAGE_MIN_H, i.ah - stageReserve(i))
  let w = i.aw
  if (w * 9 / 16 > maxH) w = maxH * 16 / 9
  w = Math.max(1, Math.floor(w))
  return { w, h: Math.round(w * 9 / 16) }
}
