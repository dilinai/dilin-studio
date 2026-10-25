// 网页剪辑页·预览图片预载。
// 原因：同一条画面轨共用一个 <img>，切段才换 src 去载，载好之前浏览器还挂着上一张；连播 0.2 秒一张时每次停在旧图的长短不一。
// 修法（page.tsx＋video-edit/vedit-image-preload.ts）：① 画面层的 <img> 按素材换元素（key＝素材编号），没载好宁可空着也不冒充；
// ② 播放头前后一段时间里会出现的图片先载进来并 decode 好（留着引用免得被浏览器丢掉），切段时直接用备好的。
// 本档只放纯函数（题直接跑）·⛔ 碰 DOM。
import type { Tracks } from './timeline.pure'

/** 往后预载几秒、往回留几秒（往回那段给倒着拖播放头用） */
export const PRELOAD_AHEAD = 8
export const PRELOAD_BEHIND = 2
/** 最多同时留几张已解码的图（1080×1920 一张解码后约 8MB） */
export const PRELOAD_MAX = 40

/** 播放头 t 前后那段时间里画面轨会出现的图片素材（照出现先后·去重·最多 max 张）；隐藏轨、停用的段不算 */
export function imagesToPreload(tr: Tracks, t: number, kindOf: (mediaId: string) => string | undefined, o: { ahead?: number; behind?: number; max?: number } = {}): string[] {
  const ahead = o.ahead ?? PRELOAD_AHEAD, behind = o.behind ?? PRELOAD_BEHIND, max = o.max ?? PRELOAD_MAX
  const hits: Array<{ id: string; d: number }> = []
  for (const l of tr) {
    if (l.kind !== 'visual' || l.hidden) continue
    for (const c of l.clips) {
      if (!c.mediaId || c.disabled || kindOf(c.mediaId) !== 'image') continue
      const end = c.start + c.length
      if (end < t - behind || c.start > t + ahead) continue
      // 离播放头多远：正在播的 0·后面的按开头·前面的按结尾（往回的排在往后的后面）
      const d = c.start <= t && end >= t ? 0 : c.start > t ? c.start - t : ahead + (t - end)
      hits.push({ id: c.mediaId, d })
    }
  }
  hits.sort((a, b) => a.d - b.d)
  const out: string[] = []
  for (const h of hits) { if (!out.includes(h.id)) out.push(h.id); if (out.length >= max) break }
  return out
}

/** 预载那份清单多久重算一次：播放头照整秒算（不必每格都算） */
export const preloadTick = (t: number) => Math.floor(Math.max(0, t))
