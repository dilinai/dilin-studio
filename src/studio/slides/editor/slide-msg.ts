/**
 * 简报本体（沙盒 iframe）回报换页 {type:'slideChange', index} 的收信判读——分享页、全屏放映、画布小窗、编辑页同一份。
 *
 *   页里的程序动画（作者码）能直接向 top 送 slideChange 污染页码 ⇒
 *   ① 只认自己那扇简报 iframe（e.source 必须正是它的 contentWindow）；② 页码要是有限整数、在 [0, 页数) 里。
 *   不合 ⇒ null（整包不理）。
 */
export function slideChangeIndex(data: unknown, source: unknown, frameWin: unknown, count: number): number | null {
  if (!frameWin || source !== frameWin) return null
  if (!data || typeof data !== 'object') return null
  const d = data as { type?: unknown; index?: unknown }
  if (d.type !== 'slideChange') return null
  const i = d.index
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= count) return null
  return i
}
