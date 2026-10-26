// 巢状合成／轨道遮罩像素题的浏览器入口（comp-matte.browser.mjs 用 esbuild 打包后塞进无头 Chromium）：
//   照汇出那支 frameDrawer（成片、静帧、角色看帧 video_edit_frame、预览 PlanCanvas 都是它）画一格·回几个点的 RGBA。
import { frameDrawer, type ExportEnv } from './ui/export-render'
import type { Comps } from './lib/comp.pure'
import type { Tracks } from './lib/timeline.pure'

type Case = { tracks: Tracks; comps?: Comps; t: number; w: number; h: number; only?: string[]; pts: Array<[number, number]> }
async function run(c: Case): Promise<number[][]> {
  const env: ExportEnv = { tracks: c.tracks, ...(c.comps ? { comps: c.comps } : {}), mediaOf: () => null, originalOf: async () => null, programOf: () => null }
  const fd = await frameDrawer(env, c.w, c.h)
  try {
    await fd.frame(c.t, c.only ? new Set(c.only) : undefined)
    const px = fd.canvas.getContext('2d')!.getImageData(0, 0, c.w, c.h).data
    return c.pts.map(([x, y]) => { const i = (y * c.w + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]] })
  } finally { await fd.dispose() }
}
;(globalThis as unknown as { vnmRun: typeof run }).vnmRun = run
