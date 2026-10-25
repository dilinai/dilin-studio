// 表格页左栏宽度：两个页签都跟着一起缩、宽度同步，但底下硬碟树（游客版：工程清单）自留最窄宽。
// 左栏宽度只有一份、两个页签同一个宽，都能拖到 SHEET_LEFT_MIN；上方「表格／硬碟」页签排随栏宽一起缩。
// 硬碟树自己留最窄宽 SHEET_DRIVE_TREE_MIN：栏比它窄时树维持这个宽、在栏里左右卷（⛔ 再把整栏撑宽）。纯函数·零依赖（页面与题共用）。
export const SHEET_LEFT_MIN = 128 // 实量：12px「▦ 表格」要 47px·收合钮 32px ⇒ 两页签各 48 刚好不挤
export const SHEET_DRIVE_TREE_MIN = 160 // 硬碟树最窄（原左栏下限）

/** 拖宽后的栏宽：夹进 [SHEET_LEFT_MIN, max]·两个页签同一份 */
export function sheetLeftClamp(width: number, max: number): number {
  return Math.max(SHEET_LEFT_MIN, Math.min(max, width))
}

/** 栏宽比硬碟树最窄还窄 ⇒ 树要左右卷 */
export function sheetDriveTreeScrolls(width: number): boolean {
  return width < SHEET_DRIVE_TREE_MIN
}
