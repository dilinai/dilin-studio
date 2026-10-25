// 网页剪辑页·四块之间的拖拉条。
// 量：mediaW＝左素材区宽·chatW＝右对话框宽·topFrac＝上排占（上排＋轨道）总高的比例·driveW＝素材区里左窄栏（匯入｜雲端硬碟树）宽。单位 px（topFrac 例外）。
// 夹限照「每块都留得下」：播放器至少 PLAYER_MIN 宽；窄栏至少 DRIVE_MIN、素材格至少 GRID_MIN；上下两排各至少 ROW_MIN 高。⛔ 本档碰 DOM／React（题直接 require）。

export type VeditLayout = { mediaW: number; chatW: number; topFrac: number; driveW: number }
export type VeditSplit = 'media' | 'chat' | 'rows' | 'drive'
export type Box = { width: number; height: number }

export const VEDIT_LAYOUT_KEY = 'dilin.videoEdit.layout'
export const VEDIT_LAYOUT_DEFAULT: VeditLayout = { mediaW: 440, chatW: 340, topFrac: 0.58, driveW: 150 }
export const MEDIA_MIN = 240
export const CHAT_MIN = 260
export const PLAYER_MIN = 280
export const DRIVE_MIN = 72
export const GRID_MIN = 120
export const ROW_MIN = 160
const GAPS = 6 * 4 // 三条拖拉条＋外边距（与 page.tsx 的 gap 同量级·只拿来留余）

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** 把四个量夹进这个视窗放得下的范围（视窗缩小时也调用）。 */
export function clampLayout(l: VeditLayout, box: Box): VeditLayout {
  const chatW = clamp(l.chatW, CHAT_MIN, box.width - MEDIA_MIN - PLAYER_MIN - GAPS)
  const mediaW = clamp(l.mediaW, MEDIA_MIN, box.width - chatW - PLAYER_MIN - GAPS)
  const driveW = clamp(l.driveW, DRIVE_MIN, mediaW - GRID_MIN)
  const minFrac = box.height > 0 ? Math.min(0.5, ROW_MIN / box.height) : 0.25
  const topFrac = clamp(l.topFrac, minFrac, 1 - minFrac)
  return { mediaW, chatW, topFrac, driveW }
}

/** 拖一条拉条 delta（px·往右／往下为正）：media＝素材区右缘·chat＝对话框左缘（往右拖＝变窄）·rows＝上下之间·drive＝窄栏右缘。 */
export function dragLayout(l: VeditLayout, which: VeditSplit, delta: number, box: Box): VeditLayout {
  const next = { ...l }
  if (which === 'media') next.mediaW = l.mediaW + delta
  else if (which === 'chat') next.chatW = l.chatW - delta
  else if (which === 'drive') next.driveW = l.driveW + delta
  else if (box.height > 0) next.topFrac = l.topFrac + delta / box.height
  return clampLayout(next, box)
}

/** 本机存档 ⇒ 版面（坏值／缺值一律缺省·⛔ 抛）。 */
export function parseLayout(raw: string | null | undefined): VeditLayout {
  let o: Record<string, unknown> = {}
  try { const j = raw ? JSON.parse(raw) : null; if (j && typeof j === 'object') o = j as Record<string, unknown> } catch { /* 坏档当没有 */ }
  const num = (k: keyof VeditLayout) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : VEDIT_LAYOUT_DEFAULT[k])
  return { mediaW: num('mediaW'), chatW: num('chatW'), topFrac: num('topFrac'), driveW: num('driveW') }
}
