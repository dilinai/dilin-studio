// Dilin Studio · Paint — after the page draws a project, write what it looks like back into the project folder
// (layout.pure.ts): preview.png (flattened, longest side ≤ 1024) and project.layout.json (each layer's real box).
// An AI that edits project.json reads them to check its work. Folders that cannot take extra files are skipped.
import type { ProjectStore } from '../../shared/types'
import type { DlSite } from './drawboard-host'
import { LAYOUT_FILE, PREVIEW_FILE, layoutOf, layoutText, previewScaleFor, type Box } from '../layout.pure'

/** wait this long after a load / save before drawing the preview (the engine finishes rendering first; bursts collapse) */
export const WRITE_BACK_MS = 1200

type Png = (site: DlSite, scale: number) => Promise<{ blob: Blob }>

export async function writeBack(site: DlSite, store: ProjectStore, png: Png, now: () => Date = () => new Date()): Promise<boolean> {
  const doc = site.Doc
  if (!store.writeExtra || !doc || !doc.width || !doc.height) return false
  const win = site.doc?.defaultView as (Window & { LayerBox?: { alphaBox(c: HTMLCanvasElement): Box | null } }) | null | undefined
  const ctx = (site.doc ?? document).createElement('canvas').getContext('2d')
  const scale = previewScaleFor(doc.width, doc.height)
  const layout = layoutOf(doc as { width: number; height: number; layers?: unknown[] }, {
    pixelBox: (L) => {
      const c = (L.data as { canvas?: HTMLCanvasElement } | undefined)?.canvas
      if (!c || !win?.LayerBox) return c ? [0, 0, c.width, c.height] : null
      try { return win.LayerBox.alphaBox(c) } catch { return [0, 0, c.width, c.height] }
    },
    measure: (font, text) => {
      if (!ctx) return { width: 0, ascent: 0, descent: 0 }
      ctx.font = font
      const m = ctx.measureText(text)
      return { width: m.width, ascent: m.actualBoundingBoxAscent || 0, descent: m.actualBoundingBoxDescent || 0 }
    },
  }, { previewScale: Math.round(scale * 1000) / 1000, now: now() })
  await store.writeExtra(LAYOUT_FILE, layoutText(layout))
  try { await store.writeExtra(PREVIEW_FILE, (await png(site, scale)).blob) } catch { /* tainted / no composite: the layout alone still helps */ }
  return true
}
