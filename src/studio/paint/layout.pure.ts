// Dilin Studio · Paint — where every layer really landed, for an AI that edits project.json and cannot see the canvas.
// After the page draws a project it writes two files next to project.json:
//   preview.png          = the whole picture, flattened (longest side at most PREVIEW_MAX px)
//   project.layout.json  = per layer: the box it actually covers (canvas pixels, [x0, y0, x1, y1]), whether it is
//                          (partly) outside the canvas; vector layers also per shape; text layers the measured text box.
// Boxes come from the live engine: raster = its non-transparent pixels, text = measured with the real font, vector =
// shape geometry (plus half the stroke). Pure: the engine-specific bits (pixel box, text measuring) are passed in.

export const LAYOUT_FILE = 'project.layout.json'
export const PREVIEW_FILE = 'preview.png'
export const PREVIEW_MAX = 1024

export type Box = [number, number, number, number]
export type TextMetrics = { width: number; ascent: number; descent: number }
export type LayoutDeps = {
  /** non-transparent box of a raster layer, in the layer's own canvas pixels (null = fully transparent / unknown) */
  pixelBox(layer: Record<string, unknown>): Box | null
  /** measure one line of text with a CSS font string */
  measure(font: string, text: string): TextMetrics
}
export type LayerLayout = {
  index: number; id: string; name: string; kind: string; visible: boolean
  box: Box | null
  /** none = inside the canvas; partly = crosses an edge; outside = nothing of it is on the canvas; empty = draws nothing */
  onCanvas: 'inside' | 'partly' | 'outside' | 'empty'
  shapes?: Array<{ id: string; type: string; box: Box | null; onCanvas: LayerLayout['onCanvas'] }>
  text?: { lines: number; size: number; box: Box | null }
}
export type Layout = { about: string; width: number; height: number; preview: string; previewScale: number; layers: LayerLayout[]; drawnAt?: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const round = (b: Box | null): Box | null => (b ? (b.map((n) => Math.round(n * 10) / 10) as Box) : null)
const union = (a: Box | null, b: Box | null): Box | null => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])
const shift = (b: Box | null, dx: number, dy: number): Box | null => (b ? [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] : null)
const pad = (b: Box | null, p: number): Box | null => (b && p > 0 ? [b[0] - p, b[1] - p, b[2] + p, b[3] + p] : b)
const ofPoints = (pts: unknown): Box | null => {
  if (!Array.isArray(pts)) return null
  let b: Box | null = null
  for (const p of pts) if (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) b = union(b, [p[0], p[1], p[0], p[1]])
  return b
}

export function where(b: Box | null, w: number, h: number): LayerLayout['onCanvas'] {
  if (!b || b[2] <= b[0] || b[3] <= b[1]) return 'empty'
  if (b[2] <= 0 || b[3] <= 0 || b[0] >= w || b[1] >= h) return 'outside'
  return b[0] < 0 || b[1] < 0 || b[2] > w || b[3] > h ? 'partly' : 'inside'
}

/** box of one vector shape in layer coordinates (null = not drawn / not understood) */
export function shapeBox(s: Record<string, unknown>): Box | null {
  let b: Box | null = null
  const t = s.type
  if ((t === 'rect' || t === 'ellipse') && isNum(s.x) && isNum(s.y) && isNum(s.w) && isNum(s.h)) b = [Math.min(s.x, s.x + s.w), Math.min(s.y, s.y + s.h), Math.max(s.x, s.x + s.w), Math.max(s.y, s.y + s.h)]
  else if ((t === 'star' || t === 'polygon') && isNum(s.cx) && isNum(s.cy) && isNum(s.r1)) { const r = Math.max(s.r1, isNum(s.r2) ? s.r2 : 0); b = [s.cx - r, s.cy - r, s.cx + r, s.cy + r] }
  else if (t === 'path' || t === 'line') b = ofPoints(s.points)
  else if (t === 'bezier' && Array.isArray(s.anchors)) {
    const pts: unknown[] = []
    for (const a of s.anchors) if (isObj(a)) { pts.push([a.x, a.y]); if (Array.isArray(a.in)) pts.push(a.in); if (Array.isArray(a.out)) pts.push(a.out) }
    b = ofPoints(pts)
  } else if ((t === 'group' || t === 'compound') && Array.isArray(s.children)) {
    for (const c of s.children) if (isObj(c)) b = union(b, shapeBox(c))
  }
  const stroked = s.stroke !== undefined && s.stroke !== 'none' && isNum(s.strokeWidth) && s.strokeWidth > 0
  return pad(b, stroked ? (s.strokeWidth as number) / 2 : 0)
}

/** measured box of a text layer's words, in layer coordinates (x/y = baseline start of the first line) */
export function textBox(d: Record<string, unknown>, measure: LayoutDeps['measure']): { lines: number; size: number; box: Box | null } {
  const size = isNum(d.size) ? d.size : 0
  const lines = String(d.text ?? '').split('\n')
  if (!size || !isNum(d.x) || !isNum(d.y)) return { lines: lines.length, size, box: null }
  const font = `${typeof d.weight === 'string' || isNum(d.weight) ? d.weight : 'normal'} ${size}px ${typeof d.font === 'string' ? d.font : 'sans-serif'}`
  const lh = size * (isNum(d.lineHeight) ? d.lineHeight : 1.2)
  let b: Box | null = null
  lines.forEach((ln, i) => {
    const m = measure(font, ln)
    if (!ln.trim() || m.width <= 0) return
    const x0 = d.align === 'center' ? (d.x as number) - m.width / 2 : d.align === 'right' || d.align === 'end' ? (d.x as number) - m.width : (d.x as number)
    const base = (d.y as number) + i * lh
    b = union(b, [x0, base - m.ascent, x0 + m.width, base + m.descent])
  })
  return { lines: lines.length, size, box: b }
}

/** the live engine document (Doc: width, height, layers bottom→top) ⇒ layout */
export function layoutOf(doc: { width: number; height: number; layers?: unknown[] }, deps: LayoutDeps, o: { previewScale?: number; now?: Date } = {}): Layout {
  const W = doc.width, H = doc.height
  const layers: LayerLayout[] = []
  ;(doc.layers ?? []).forEach((raw, index) => {
    if (!isObj(raw)) return
    const L = raw
    const lx = isNum(L.x) ? L.x : 0, ly = isNum(L.y) ? L.y : 0
    const base = { index, id: String(L.id ?? ''), name: String(L.name ?? ''), kind: String(L.kind ?? ''), visible: L.visible !== false }
    const d = isObj(L.data) ? L.data : {}
    if (L.kind === 'vector') {
      const shapes = (Array.isArray(d.shapes) ? d.shapes : []).filter(isObj).map((s) => {
        const box = round(shift(shapeBox(s), lx, ly))
        return { id: String(s.id ?? ''), type: String(s.type ?? ''), box, onCanvas: where(box, W, H) }
      })
      const box = shapes.reduce<Box | null>((a, s) => union(a, s.box), null)
      layers.push({ ...base, box, onCanvas: where(box, W, H), shapes })
    } else if (L.kind === 'text') {
      const t = textBox(d, deps.measure)
      const box = round(shift(t.box, lx, ly))
      layers.push({ ...base, box, onCanvas: where(box, W, H), text: { ...t, box } })
    } else if (L.kind === 'raster') {
      const box = round(shift(deps.pixelBox(L), lx, ly))
      layers.push({ ...base, box, onCanvas: where(box, W, H) })
    } else {
      layers.push({ ...base, box: null, onCanvas: 'empty' })
    }
  })
  return {
    about: 'Written by the editor after it draws project.json: where each layer really is, in canvas pixels [x0, y0, x1, y1]. preview.png is the flattened picture. Read-only; it is rewritten.',
    width: W, height: H, preview: PREVIEW_FILE, previewScale: o.previewScale ?? 1, layers,
    ...(o.now ? { drawnAt: o.now.toISOString() } : {}),
  }
}

export const previewScaleFor = (w: number, h: number): number => Math.min(1, PREVIEW_MAX / Math.max(1, w, h))
export const layoutText = (l: Layout): string => JSON.stringify(l, null, 2) + '\n'
