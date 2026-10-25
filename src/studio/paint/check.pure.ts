// Dilin Studio · Paint — check a project.json the way the engine will read it, and say what it cannot use.
// The engine never complains: an unknown shape type is skipped, a misspelled field is ignored, a bad colour draws
// nothing. So after every load the page writes this report next to project.json (project.check.json) and an AI that
// edits the file reads it back to see what went wrong — instead of digging through the engine's code.
//   errors   = something will not show (unknown kind / shape type, missing required number, unreadable colour, missing file …)
//   warnings = it shows, but a field you wrote is not read (with the field the engine does read, when it is a common slip)
// Pure: no DOM, runs in node tests. Import rule: this directory may only import itself, shared and npm packages.
import { ASSET_REF } from './project-folder.pure'

export type CheckIssue = { path: string; message: string; hint?: string }
export type CheckReport = { ok: boolean; errors: CheckIssue[]; warnings: CheckIssue[]; layers: number; checkedAt?: string }
export const CHECK_FILE = 'project.check.json'

export const LAYER_KINDS = ['raster', 'text', 'vector', 'group', 'smart'] as const
export const BLENDS = ['normal', 'passThrough', 'dissolve', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor', 'lighten', 'screen', 'colorDodge',
  'linearDodge', 'lighterColor', 'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix', 'difference', 'exclusion',
  'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'] as const
export const TEXT_ALIGNS = ['left', 'center', 'right', 'start', 'end'] as const

/** shape types the engine draws, with the numbers each one needs and the fields it reads (beyond the common ones) */
export const SHAPES: Record<string, { need: string[]; reads: string[]; note: string }> = {
  rect: { need: ['x', 'y', 'w', 'h'], reads: ['radius'], note: '{"type":"rect","x","y","w","h"} — x, y = top-left; optional "radius" for round corners' },
  ellipse: { need: ['x', 'y', 'w', 'h'], reads: [], note: '{"type":"ellipse","x","y","w","h"} — the ellipse inside that box; w = h for a circle' },
  star: { need: ['cx', 'cy', 'r1', 'r2'], reads: ['points', 'rotation'], note: '{"type":"star","cx","cy","r1","r2","points":5} — r1 outer, r2 inner radius' },
  polygon: { need: ['cx', 'cy', 'r1'], reads: ['points', 'rotation'], note: '{"type":"polygon","cx","cy","r1","points":6} — a regular polygon (points = number of sides)' },
  path: { need: [], reads: ['points', 'closed'], note: '{"type":"path","points":[[x,y],…],"closed":true} — any polygon; a triangle is three points' },
  line: { need: [], reads: ['points', 'closed'], note: '{"type":"line","points":[[x1,y1],[x2,y2]]} — give it a "stroke" and "strokeWidth", a line has no fill' },
  bezier: { need: [], reads: ['anchors', 'closed'], note: '{"type":"bezier","anchors":[{"x","y","in":[x,y]|null,"out":[x,y]|null},…],"closed":true}' },
}
/** shape types the editor itself writes (groups, compound paths, gradient meshes); passed through without a deep check */
const EDITOR_SHAPES = new Set(['group', 'compound', 'mesh', 'symbol'])
const SHAPE_COMMON = new Set(['id', 'type', 'fill', 'stroke', 'strokeWidth'])
/** fields people often guess, and the field the engine reads instead */
const SHAPE_SLIPS: Record<string, string> = { color: 'fill', fillColor: 'fill', background: 'fill', strokeColor: 'stroke', lineWidth: 'strokeWidth', borderWidth: 'strokeWidth',
  width: 'w', height: 'h', left: 'x', top: 'y', r: 'r1', radiusX: 'w', cornerRadius: 'radius', vertices: 'points', closePath: 'closed' }
const TYPE_SLIPS: Record<string, string> = { circle: 'ellipse (w = h)', oval: 'ellipse', square: 'rect', rectangle: 'rect', triangle: 'path with three points and "closed": true',
  polyline: 'path with "closed": false', polygon_points: 'path', arrow: 'path (draw the arrow as points)', text: 'a text layer (kind "text"), not a shape' }
const TEXT_SLIPS: Record<string, string> = { content: 'text', value: 'text', fontSize: 'size', fontFamily: 'font', fill: 'color', fontWeight: 'weight', textAlign: 'align', bold: 'weight ("bold")' }
const LAYER_SLIPS: Record<string, string> = { type: 'kind', alpha: 'opacity', hidden: 'visible', blendMode: 'blend', src: 'image', url: 'image', path: 'image', left: 'x', top: 'y' }

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent|none|[a-z]+)$/i
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isPaint = (v: unknown) => (typeof v === 'string' && COLOR.test(v.trim())) || isObj(v)   // an object = gradient (editor-written)
const isPoint = (p: unknown) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1])

/** check one page (the top level of project.json, or one entry of "pages"). have = asset file names present (null = don't check files) */
export function checkPage(page: unknown, have: ReadonlySet<string> | null, at = ''): { errors: CheckIssue[]; warnings: CheckIssue[]; layers: number } {
  const errors: CheckIssue[] = [], warnings: CheckIssue[] = []
  const err = (path: string, message: string, hint?: string) => errors.push(hint ? { path: at + path, message, hint } : { path: at + path, message })
  const warn = (path: string, message: string, hint?: string) => warnings.push(hint ? { path: at + path, message, hint } : { path: at + path, message })
  if (!isObj(page)) { err('', 'not a JSON object'); return { errors, warnings, layers: 0 } }
  const side = (n: unknown) => isNum(n) && Number.isInteger(n) && n >= 1 && n <= 20000
  if (!side(page.width) || !side(page.height)) err('width', '"width" and "height" must be whole numbers from 1 to 20000')
  const W = isNum(page.width) ? page.width : 0, H = isNum(page.height) ? page.height : 0
  if (!Array.isArray(page.layers)) { err('layers', '"layers" must be an array (bottom to top)'); return { errors, warnings, layers: 0 } }
  const layers = page.layers as unknown[]
  const ids = new Map<string, number>()
  const groups = new Set<string>()
  layers.forEach((L) => { if (isObj(L) && L.kind === 'group' && typeof L.id === 'string') groups.add(L.id) })
  const asset = (path: string, v: unknown) => {
    if (typeof v !== 'string') return
    if (v.startsWith('data:image/')) return
    if (!ASSET_REF.test(v) || v.includes('..')) { err(path, `"${v}" is not a picture path the editor reads`, 'write "assets/<name>.png" (png, jpg, webp, gif or svg; letters, digits, . _ - only; no sub-folders) and put the file in assets/'); return }
    if (have && !have.has(v.slice('assets/'.length))) err(path, `file ${v} is not in the assets folder`, 'copy the picture into assets/ under exactly that name, or fix the path')
  }

  layers.forEach((L, i) => {
    const p = `layers[${i}]`
    if (!isObj(L)) { err(p, 'a layer must be a JSON object'); return }
    const id = typeof L.id === 'string' ? L.id : null
    if (!id) err(`${p}.id`, 'every layer needs a string "id"')
    else if (ids.has(id)) err(`${p}.id`, `id "${id}" is also used by layers[${ids.get(id)}]`, 'give each layer its own id; the editor renames the later one')
    else ids.set(id, i)
    const kind = L.kind
    if (!LAYER_KINDS.includes(kind as never)) {
      err(`${p}.kind`, `unknown layer kind ${JSON.stringify(kind)} — this layer will not load`, `use one of ${LAYER_KINDS.join(', ')}` + (typeof L.type === 'string' ? ` (you wrote "type": ${JSON.stringify(L.type)}; the field is "kind")` : ''))
    }
    for (const k of Object.keys(L)) {
      const real = LAYER_SLIPS[k]
      if (real && L[real] === undefined) warn(`${p}.${k}`, `"${k}" is not read on a layer`, `the field is "${real}"`)
    }
    if (L.visible !== undefined && typeof L.visible !== 'boolean') err(`${p}.visible`, '"visible" must be true or false')
    if (L.opacity !== undefined && !(isNum(L.opacity) && L.opacity >= 0 && L.opacity <= 1)) err(`${p}.opacity`, '"opacity" must be a number from 0 to 1', isNum(L.opacity) && L.opacity > 1 ? 'it is a fraction, not a percent: 50% is 0.5' : undefined)
    if (L.opacity === undefined) warn(`${p}.opacity`, 'no "opacity" — write 1 for fully visible')
    if (L.blend !== undefined && !BLENDS.includes(L.blend as never)) err(`${p}.blend`, `unknown blend ${JSON.stringify(L.blend)} — drawn as "normal"`, `use one of ${BLENDS.join(', ')}`)
    for (const k of ['x', 'y'] as const) if (L[k] !== undefined && !isNum(L[k])) err(`${p}.${k}`, `"${k}" must be a number`)
    if (L.parent != null) {
      if (typeof L.parent !== 'string' || !groups.has(L.parent)) err(`${p}.parent`, `parent ${JSON.stringify(L.parent)} is not the id of a group layer on this page`, 'use the id of a layer with "kind": "group", or remove "parent"')
    }
    if (L.mask != null) {
      if (!isObj(L.mask)) err(`${p}.mask`, '"mask" must be null or {"enabled": true, "image": "assets/<file>"}')
      else asset(`${p}.mask.image`, L.mask.image)
    }
    if (kind === 'raster') {
      if (L.image == null && !isObj(L.src)) err(`${p}.image`, 'a raster layer needs "image": "assets/<file>"')
      else asset(`${p}.image`, L.image)
    }
    if (kind === 'text') {
      const d = L.data
      if (!isObj(d)) { err(`${p}.data`, 'a text layer needs "data": {"x","y","text","size","font","color"}'); return }
      if (typeof d.text !== 'string') err(`${p}.data.text`, 'the words go in "data.text" (a string; "\\n" starts a new line)')
      if (!(isNum(d.size) && d.size > 0)) err(`${p}.data.size`, '"data.size" must be a number of pixels above 0', isNum(L.size) ? 'it belongs inside "data", not on the layer' : undefined)
      for (const k of ['x', 'y'] as const) if (!isNum(d[k])) err(`${p}.data.${k}`, `"data.${k}" must be a number`, k === 'y' ? 'y is the baseline of the first line (the bottom of the letters), not the top' : undefined)
      if (typeof d.font !== 'string' || !d.font.trim()) err(`${p}.data.font`, '"data.font" must be a font name, e.g. "sans-serif"')
      if (!(typeof d.color === 'string' && COLOR.test(d.color))) err(`${p}.data.color`, `"data.color" ${JSON.stringify(d.color)} is not a colour`, 'write "#rrggbb"')
      if (d.align !== undefined && !TEXT_ALIGNS.includes(d.align as never)) err(`${p}.data.align`, `unknown align ${JSON.stringify(d.align)}`, `use ${TEXT_ALIGNS.join(', ')} ("center" centres on data.x)`)
      for (const k of Object.keys(d)) {
        const real = TEXT_SLIPS[k]
        if (real && d[real.split(' ')[0]] === undefined) warn(`${p}.data.${k}`, `"${k}" is not read on a text layer`, `the field is "${real}"`)
      }
      if (isNum(d.size) && isNum(d.y) && d.y < d.size * 0.7) warn(`${p}.data.y`, `"data.y" ${d.y} is the baseline; with size ${d.size} the top of the letters is above the canvas`, `use y ≥ ${Math.ceil(d.size * 0.8)}`)
      if (isNum(d.x) && isNum(d.y) && W && H && (d.x < 0 || d.x > W || d.y > H + (isNum(d.size) ? d.size : 0))) warn(`${p}.data`, `text starts at (${d.x}, ${d.y}), outside the ${W}×${H} canvas`)
    }
    if (kind === 'vector') {
      const d = L.data
      if (!isObj(d) || !Array.isArray(d.shapes)) { err(`${p}.data.shapes`, 'a vector layer needs "data": {"shapes": [ … ]}'); return }
      const sids = new Set<string>()
      ;(d.shapes as unknown[]).forEach((s, j) => checkShape(s, `${p}.data.shapes[${j}]`, sids, err, warn))
    }
  })

  // the canvas is transparent where no layer covers it: without a filled bottom layer, dark text sits on the dark checkerboard
  const bottom = layers.find((L) => isObj(L) && L.visible !== false && L.parent == null) as Record<string, unknown> | undefined
  const filled = !!bottom && (bottom.kind === 'raster' || (bottom.kind === 'vector' && isObj(bottom.data) && Array.isArray(bottom.data.shapes) &&
    (bottom.data.shapes as unknown[]).some((s) => isObj(s) && s.type === 'rect' && s.fill && s.fill !== 'none' && isNum(s.w) && isNum(s.h) && s.w >= W && s.h >= H)))
  if (layers.length && !filled) warn('layers[0]', 'no background: the bottom layer does not cover the canvas, so the picture is transparent (shown as a dark checkerboard)', 'keep a white raster "Background" layer at the bottom, or add a vector rect the size of the canvas; remove it only when a transparent picture is wanted')
  return { errors, warnings, layers: layers.length }
}

function checkShape(s: unknown, p: string, sids: Set<string>, err: (path: string, m: string, h?: string) => void, warn: (path: string, m: string, h?: string) => void): void {
  if (!isObj(s)) { err(p, 'a shape must be a JSON object'); return }
  const type = s.type
  if (typeof s.id !== 'string' && typeof s.id !== 'number') warn(`${p}.id`, 'no "id" — give each shape a unique id (the editor needs it to select the shape)')
  else if (sids.has(String(s.id))) warn(`${p}.id`, `shape id "${s.id}" is used twice in this layer`)
  else sids.add(String(s.id))
  if (typeof type === 'string' && EDITOR_SHAPES.has(type)) return
  const spec = typeof type === 'string' ? SHAPES[type] : undefined
  if (!spec) {
    err(`${p}.type`, `unknown shape type ${JSON.stringify(type)} — nothing is drawn`,
      (typeof type === 'string' && TYPE_SLIPS[type] ? `use ${TYPE_SLIPS[type]}. ` : '') + `Shapes: ${Object.keys(SHAPES).join(', ')}`)
    return
  }
  for (const k of spec.need) if (!isNum(s[k])) err(`${p}.${k}`, `a ${type} needs a number "${k}"`, spec.note)
  if (type === 'rect' || type === 'ellipse') for (const k of ['w', 'h']) if (isNum(s[k]) && s[k] <= 0) err(`${p}.${k}`, `"${k}" is ${s[k]} — nothing is drawn`)
  if (type === 'path' || type === 'line') {
    const pts = s.points
    if (!Array.isArray(pts) || pts.length < 2 || !pts.every(isPoint)) err(`${p}.points`, `a ${type} needs "points": [[x, y], [x, y], …] (at least two)`, spec.note)
    else if (type === 'path' && s.closed !== true && pts.length >= 3 && s.fill && s.fill !== 'none') warn(`${p}.closed`, 'a filled path without "closed": true is drawn open', 'add "closed": true for a triangle or any filled polygon')
  }
  if (type === 'bezier' && (!Array.isArray(s.anchors) || s.anchors.length < 2)) err(`${p}.anchors`, 'a bezier needs at least two "anchors"', spec.note)
  if ((type === 'star' || type === 'polygon') && s.points !== undefined && !(isNum(s.points) && s.points >= 3)) err(`${p}.points`, `on a ${type}, "points" is the number of ${type === 'star' ? 'tips' : 'sides'} (3 or more)`, type === 'polygon' ? 'for a polygon with your own corners use type "path"' : undefined)
  for (const k of ['fill', 'stroke'] as const) if (s[k] !== undefined && !isPaint(s[k])) err(`${p}.${k}`, `"${k}" ${JSON.stringify(s[k])} is not a colour`, 'write "#rrggbb" or "none"')
  const hasFill = s.fill !== undefined && s.fill !== 'none'
  const hasStroke = s.stroke !== undefined && s.stroke !== 'none' && isNum(s.strokeWidth) && s.strokeWidth > 0
  if (!hasFill && !hasStroke) err(p, 'this shape has no fill and no visible stroke — nothing is drawn', type === 'line' ? 'a line needs "stroke": "#rrggbb" and "strokeWidth" above 0' : 'add "fill": "#rrggbb" (or a "stroke" with "strokeWidth")')
  if (s.stroke !== undefined && s.stroke !== 'none' && !isNum(s.strokeWidth)) warn(`${p}.strokeWidth`, 'a stroke without "strokeWidth" is not drawn')
  // only the common slips (the editor writes many fields of its own on shapes; those are fine): a guessed name whose real field is missing
  for (const k of Object.keys(s)) {
    if (SHAPE_COMMON.has(k) || spec.need.includes(k) || spec.reads.includes(k)) continue
    const real = SHAPE_SLIPS[k]
    if (real && s[real.split(' ')[0]] === undefined) warn(`${p}.${k}`, `"${k}" is not read on ${/^[aeiou]/.test(String(type)) ? 'an' : 'a'} ${type}`, `the field is "${real}". ${spec.note}`)
  }
}

/** the whole project.json (page 1 at the top level, pages 2… in "pages"). have = names of the files in assets/ */
export function checkProjectFile(json: unknown, have: ReadonlySet<string> | null, now?: Date): CheckReport {
  const p = isObj(json) ? json : {}
  const r = checkPage(p, have)
  if (Array.isArray(p.pages)) p.pages.forEach((pg, i) => { const q = checkPage(pg, have, `pages[${i}].`); r.errors.push(...q.errors); r.warnings.push(...q.warnings); r.layers += q.layers })
  return { ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings, layers: r.layers, ...(now ? { checkedAt: now.toISOString() } : {}) }
}

/** the report as written to project.check.json (stable key order, readable) */
export const reportText = (r: CheckReport): string => JSON.stringify({
  about: 'Written by the editor each time it opens project.json. errors = will not show; warnings = a field is not read. Fix project.json and save; this file is rewritten.',
  ...r,
}, null, 2) + '\n'
