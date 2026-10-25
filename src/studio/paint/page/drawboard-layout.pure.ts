// 画板页版面（左栏页签＋两条拖拉条）——纯函数·isomorphic（sucrase 单测直载·⛔ @/ 别名）。
//   左栏顶上两个页签（云盘｜工具）切换；左栏云盘那格右缘、图层面板与右边对话栏之间各一条拖拉条调宽。
//   ⇒ 记：左栏现在哪个页签（tools｜drive）、云盘那格多宽、右边对话栏多宽、对话栏收起没（chatCollapsed）、
//     云盘树的眼睛钮睁眼没（driveAll·睁眼＝全列）；存本机（localStorage）·下次开页照旧。

export type DrawboardTab = 'tools' | 'drive'
export type DrawboardLayout = { tab: DrawboardTab; driveW: number; chatW: number; chatCollapsed: boolean; driveAll: boolean }

export const DRAWBOARD_LAYOUT_KEY = 'dilin.drawboard.layout'
export const DRAWBOARD_LAYOUT_DEFAULT: DrawboardLayout = { tab: 'tools', driveW: 260, chatW: 380, chatCollapsed: false, driveAll: false }
/** 宽度上下限：云盘树 180–520；对话框 300–760（再窄输入框排不下） */
export const DRIVE_W_MIN = 180
export const DRIVE_W_MAX = 520
export const CHAT_W_MIN = 300
export const CHAT_W_MAX = 760
/** 画板中间（画布＋图层面板）至少留多宽：拖拉条拖不过它 */
export const STAGE_MIN = 420

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** 夹宽度：各自上下限之外，再让画板中间至少留 STAGE_MIN（viewport＝整页宽·量不到传 0 ⇒ 只夹上下限） */
export function clampLayout(l: DrawboardLayout, viewport = 0): DrawboardLayout {
  let chatW = clamp(Math.round(l.chatW), CHAT_W_MIN, CHAT_W_MAX)
  let driveW = clamp(Math.round(l.driveW), DRIVE_W_MIN, DRIVE_W_MAX)
  if (viewport > 0) {
    chatW = clamp(chatW, CHAT_W_MIN, Math.max(CHAT_W_MIN, viewport - STAGE_MIN))
    // 对话框收起时不占宽 ⇒ 云盘树只让画板中间留够
    const right = l.chatCollapsed ? 0 : chatW
    const left = l.tab === 'drive' ? driveW : 0
    if (left && viewport - right - left < STAGE_MIN) driveW = clamp(viewport - right - STAGE_MIN, DRIVE_W_MIN, driveW)
  }
  return { tab: l.tab === 'drive' ? 'drive' : 'tools', driveW, chatW, chatCollapsed: l.chatCollapsed === true, driveAll: l.driveAll === true }
}

/** localStorage 读回来的字串 ⇒ 版面（坏／没有 ⇒ 缺省） */
export function parseLayout(raw: string | null | undefined): DrawboardLayout {
  if (!raw) return { ...DRAWBOARD_LAYOUT_DEFAULT }
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof DrawboardLayout, unknown>>
    return clampLayout({
      tab: v.tab === 'drive' ? 'drive' : 'tools',
      driveW: num(v.driveW, DRAWBOARD_LAYOUT_DEFAULT.driveW),
      chatW: num(v.chatW, DRAWBOARD_LAYOUT_DEFAULT.chatW),
      chatCollapsed: v.chatCollapsed === true,
      driveAll: v.driveAll === true,
    })
  } catch { return { ...DRAWBOARD_LAYOUT_DEFAULT } }
}

/** 拖拉条拖了 dx（往右为正）：云盘那条往右＝变宽；对话框那条在对话框左边·往右＝变窄 */
export function dragLayout(start: DrawboardLayout, which: 'drive' | 'chat', dx: number, viewport = 0): DrawboardLayout {
  return clampLayout(which === 'drive' ? { ...start, driveW: start.driveW + dx } : { ...start, chatW: start.chatW - dx }, viewport)
}
