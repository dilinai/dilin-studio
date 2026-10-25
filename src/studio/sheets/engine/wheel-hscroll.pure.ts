// 表格页按住 Alt（Mac 是 Option）＋滚轮 ⇒ 左右卷。纯函数·零依赖（SheetGrid 与题共用）。
// 滚轮通常只给 deltaY；有的系统／触控板同时给 deltaX ⇒ 取绝对值较大的那一轴。deltaMode 1＝行、2＝页 ⇒ 换成像素。
export const WHEEL_LINE_PX = 40

/** 这一下滚轮要不要改成左右卷：按着 Alt、没按 Ctrl（Ctrl＋滚轮归缩放） */
export function wheelIsHScroll(e: { altKey: boolean; ctrlKey: boolean }): boolean {
  return e.altKey && !e.ctrlKey
}

/** 左右要卷几像素（正＝往右） */
export function wheelHScrollPx(e: { deltaX: number; deltaY: number; deltaMode: number }, pageWidth: number): number {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (!Number.isFinite(d)) return 0
  return e.deltaMode === 1 ? d * WHEEL_LINE_PX : e.deltaMode === 2 ? d * pageWidth : d
}
