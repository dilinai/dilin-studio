// 表格列宽／行高
//   纯函数·页面／服务端净化闸／单测三方同一份：
//   - 存法：sheet JSON 的 colWidths{ 列字母: 宽 }／rowHeights{ 行号(1 起): 高 }·单位＝100% 缩放下的像素·省＝预设（列 96／行 28）
//   - 拖动换算：屏上位移 ÷ 缩放系数 ＝ 资料里的像素（zoom.ts 的 CSS zoom 把整张表等比放大·资料永远存 100% 口径）
//   - 多选整列／整行时拖其中一条 ⇒ 选中的每条都改成同一值（Excel 口径）
//   - 命中测试：各列左缘／各行上缘（屏上量出来的）二分查找 ⇒ 格坐标（填充柄／绘图边框／公式点格拖选共用）
//   交互做法参考 fortune-sheet（MIT·Copyright (c) 2022 Suzhou Ruilisi Technology Co., Ltd）packages/core/src/events/mouse.ts 的
//   列宽行高拖动（按下记起点·移动画预览线·放手才写）与 univer（Apache-2.0）sheets-ui 的双击自适应；本档代码现写（没有逐行抄）。

import { indexToCol, colToIndex } from './formula'

export const COL_W_DEFAULT = 96
export const ROW_H_DEFAULT = 28
export const COL_W_MIN = 16
export const COL_W_MAX = 1200
export const ROW_H_MIN = 12
export const ROW_H_MAX = 600
/** 自适应列宽时左右留白（格左右 padding 各 6px＋边线） */
export const AUTOFIT_PAD = 14

export type Sizes = Record<string, number>

export function colWidthOf(colWidths: Sizes | undefined, c: number): number {
  const w = colWidths?.[indexToCol(c)]
  return typeof w === 'number' && Number.isFinite(w) ? w : COL_W_DEFAULT
}
export function rowHeightOf(rowHeights: Sizes | undefined, r: number): number {
  const h = rowHeights?.[String(r + 1)]
  return typeof h === 'number' && Number.isFinite(h) ? h : ROW_H_DEFAULT
}
/** 该行有没有被手动定过高（没定 ⇒ 行高随内容撑开·有 ⇒ 内容超出就裁） */
export function hasRowHeight(rowHeights: Sizes | undefined, r: number): boolean {
  return typeof rowHeights?.[String(r + 1)] === 'number'
}

export const clampColW = (w: number) => Math.max(COL_W_MIN, Math.min(COL_W_MAX, Math.round(w)))
export const clampRowH = (h: number) => Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, Math.round(h)))

/** 拖动：起始宽 + 屏上位移 ÷ 缩放 ⇒ 新宽（夹取·取整） */
export function draggedSize(start: number, deltaScreenPx: number, zoom: number, axis: 'col' | 'row'): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const v = start + deltaScreenPx / z
  return axis === 'col' ? clampColW(v) : clampRowH(v)
}

/** 写一组列宽（indexes 各设 w·w=null ⇒ 删回预设）；返回新对象·空 ⇒ undefined */
export function setColWidths(colWidths: Sizes | undefined, indexes: number[], w: number | null): Sizes | undefined {
  const next: Sizes = { ...(colWidths ?? {}) }
  for (const c of indexes) { const k = indexToCol(c); if (w === null || w === COL_W_DEFAULT) delete next[k]; else next[k] = clampColW(w) }
  return Object.keys(next).length ? next : undefined
}
export function setRowHeights(rowHeights: Sizes | undefined, indexes: number[], h: number | null): Sizes | undefined {
  const next: Sizes = { ...(rowHeights ?? {}) }
  for (const r of indexes) { const k = String(r + 1); if (h === null) delete next[k]; else next[k] = clampRowH(h) }
  return Object.keys(next).length ? next : undefined
}

/**
 * 拖哪一条会改哪几条：被拖的那条落在「整列选区」里 ⇒ 选区里的每一列；否则只它自己（Excel 口径）。
 * sel＝当前矩形选区；full＝选区是不是整列（列拖）／整行（行拖）
 */
export function resizeTargets(dragged: number, sel: { a0: number; a1: number } | null, full: boolean): number[] {
  if (!sel || !full || dragged < sel.a0 || dragged > sel.a1) return [dragged]
  const out: number[] = []
  for (let i = sel.a0; i <= sel.a1; i++) out.push(i)
  return out
}

/** 自适应列宽：这一列每格文字量出的宽（100% 口径）取最大 + 留白；全空 ⇒ 预设宽 */
export function autofitWidth(textWidths: number[]): number {
  const max = textWidths.reduce((m, w) => (Number.isFinite(w) && w > m ? w : m), 0)
  return max <= 0 ? COL_W_DEFAULT : clampColW(Math.ceil(max + AUTOFIT_PAD))
}

/** 一张表最多存几笔自订列宽／行高 */
export const SIZES_MAX_COLS = 2000
export const SIZES_MAX_ROWS = 5000
/** 净化（服务端同一份）：键只收列字母 A–ZZZ／行号 1–999999·值只收有限数·夹到上下限·空 ⇒ undefined */
export function sanitizeColWidths(input: unknown): Sizes | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: Sizes = {}
  let n = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= SIZES_MAX_COLS) break
    if (!/^[A-Z]{1,3}$/.test(k) || colToIndex(k) < 0) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    out[k] = clampColW(v); n++
  }
  return Object.keys(out).length ? out : undefined
}
export function sanitizeRowHeights(input: unknown): Sizes | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: Sizes = {}
  let n = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= SIZES_MAX_ROWS) break
    if (!/^[1-9]\d{0,5}$/.test(k)) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    out[k] = clampRowH(v); n++
  }
  return Object.keys(out).length ? out : undefined
}

// ── 命中测试：屏上各列左缘（升序）⇒ 第几列 ──
/** edges＝每条（列／行）的起点坐标升序·ends＝终点；x 落在哪条里（左外 ⇒ 0·右外 ⇒ 最后一条） */
export function hitIndex(starts: number[], ends: number[], x: number): number {
  const n = starts.length
  if (!n) return 0
  if (x < starts[0]) return 0
  if (x >= ends[n - 1]) return n - 1
  let lo = 0, hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= x) lo = mid; else hi = mid - 1
  }
  return lo
}
