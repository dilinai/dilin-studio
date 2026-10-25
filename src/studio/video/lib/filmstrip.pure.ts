// 网页剪辑页·时间轴影片片段上的缩图条（剪映轨道上影片一格一格的画面）。
// 算法：片段宽 widthPx 切成一格格（每格约 tileW 宽·最多 FILMSTRIP_MAX_TILES 格·太多就把格放宽）·每格取它中间那一刻的素材画面；
// 素材时间对齐到「一格大约几秒」往上取的整数档（缩放时同一档的格共用同一张·快取命中多）。倒放 ⇒ 时间反过来。
// 本档只放纯函数（题直接跑）。抓影格与快取在 video-edit/vedit-filmstrip.ts。

export const FILMSTRIP_MAX_TILES = 60
/** 素材时间对齐的档（秒） */
export const FILMSTRIP_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300] as const
export type FilmTile = { x: number; w: number; t: number }

/** offset＝片段从素材第几秒起·srcLen＝片段用掉素材几秒（长度×速度）·duration＝素材全长（不明 ⇒ 0） */
export function filmstripTiles(o: { offset: number; srcLen: number; widthPx: number; tileW: number; duration: number; reverse?: boolean }): FilmTile[] {
  const { offset, srcLen, widthPx, tileW } = o
  if (!(widthPx > 0) || !(tileW > 0) || !(srcLen > 0)) return []
  const n = Math.max(1, Math.min(FILMSTRIP_MAX_TILES, Math.ceil(widthPx / tileW)))
  const w = Math.max(tileW, widthPx / n)
  const count = Math.max(1, Math.ceil(widthPx / w))
  const perTile = (srcLen * w) / widthPx
  const step = FILMSTRIP_STEPS.find((s) => s >= perTile) ?? FILMSTRIP_STEPS[FILMSTRIP_STEPS.length - 1]
  const last = o.duration > 0 ? Math.max(0, o.duration - 0.05) : Infinity
  const out: FilmTile[] = []
  for (let i = 0; i < count; i++) {
    const x = i * w
    const frac = Math.min(1, (x + Math.min(w, widthPx - x) / 2) / widthPx)
    const raw = offset + (o.reverse ? 1 - frac : frac) * srcLen
    const t = Math.min(last, Math.max(0, Math.round(Math.floor(raw / step) * step * 1000) / 1000))
    out.push({ x: Math.round(x * 10) / 10, w: Math.round(Math.min(w, widthPx - x) * 10) / 10, t })
  }
  return out
}
/** 快取键 */
export const filmKey = (mediaId: string, t: number) => `${mediaId}@${t.toFixed(3)}`
