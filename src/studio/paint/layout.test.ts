/** Dilin Studio · Paint — preview.png + project.layout.json tests (where layers really landed).
 * Run (from the studio root): node -e "require('sucrase/register/ts');require('./paint/layout.test.ts')"
 * Negative controls (each must turn a test red): layoutOf stops shifting by the layer x/y ⇒ Y2; textBox ignores align ⇒ Y3;
 * writeBack stops writing the preview ⇒ Y5; the page stops calling writeBack after load ⇒ Y6. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAYOUT_FILE, PREVIEW_FILE, layoutOf, previewScaleFor, shapeBox, textBox, where, type LayoutDeps } from './layout.pure'
import { writeBack } from './page/write-back'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])
// every character 10 px wide, ascent 0.7 × size, descent 0.2 × size
const measure: LayoutDeps['measure'] = (font, text) => { const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]); return { width: [...text].length * 10, ascent: size * 0.7, descent: size * 0.2 } }
const deps: LayoutDeps = { measure, pixelBox: (L) => ((L.data as { box?: [number, number, number, number] }).box ?? null) }

ok('Y1 shape boxes: rect / ellipse / star / triangle path / line with stroke / bezier handles / group', () => {
  assert.deepEqual(shapeBox({ type: 'rect', x: 10, y: 20, w: 30, h: 40 }), [10, 20, 40, 60])
  assert.deepEqual(shapeBox({ type: 'rect', x: 10, y: 20, w: -10, h: 5 }), [0, 20, 10, 25])
  assert.deepEqual(shapeBox({ type: 'star', cx: 50, cy: 50, r1: 20, r2: 8 }), [30, 30, 70, 70])
  assert.deepEqual(shapeBox({ type: 'path', points: [[400, 100], [480, 240], [320, 240]], closed: true }), [320, 100, 480, 240])
  assert.deepEqual(shapeBox({ type: 'line', points: [[0, 0], [10, 0]], stroke: '#000', strokeWidth: 4 }), [-2, -2, 12, 2])
  assert.deepEqual(shapeBox({ type: 'bezier', anchors: [{ x: 0, y: 0, out: [5, -10] }, { x: 10, y: 0 }] }), [0, -10, 10, 0])
  assert.deepEqual(shapeBox({ type: 'group', children: [{ type: 'rect', x: 0, y: 0, w: 1, h: 1 }, { type: 'rect', x: 5, y: 5, w: 1, h: 1 }] }), [0, 0, 6, 6])
  assert.equal(shapeBox({ type: 'triangle' }), null)
})

ok('Y2 layers: boxes move with the layer x/y; onCanvas inside / partly / outside / empty', () => {
  const l = layoutOf({ width: 400, height: 300, layers: [
    { id: 'B', kind: 'raster', name: 'Background', x: 0, y: 0, data: { box: [0, 0, 400, 300] } },
    { id: 'V', kind: 'vector', name: 'v', x: 100, y: 0, data: { shapes: [{ id: 's1', type: 'rect', x: 0, y: 0, w: 50, h: 50, fill: '#f00' }, { id: 's2', type: 'ellipse', x: 280, y: 280, w: 40, h: 40, fill: '#00f' }] } },
    { id: 'O', kind: 'raster', name: 'gone', x: 500, y: 0, data: { box: [0, 0, 10, 10] } },
    { id: 'E', kind: 'raster', name: 'blank', x: 0, y: 0, data: {} },
  ] }, deps)
  assert.deepEqual(l.layers.map((x) => x.onCanvas), ['inside', 'partly', 'outside', 'empty'])
  assert.deepEqual(l.layers[1].shapes!.map((s) => [s.box, s.onCanvas]), [[[100, 0, 150, 50], 'inside'], [[380, 280, 420, 320], 'partly']])
  assert.deepEqual(l.layers[1].box, [100, 0, 420, 320])
  assert.deepEqual(l.layers[2].box, [500, 0, 510, 10])
})

ok('Y3 text: measured with the real font string; baseline y; align centre / right; several lines', () => {
  let font = ''
  const t = textBox({ x: 100, y: 64, text: 'Hello', size: 64, font: 'serif', weight: 'bold', align: 'center' }, (f, s) => { font = f; return measure(f, s) })
  assert.equal(font, 'bold 64px serif')
  assert.deepEqual(t.box, [75, 64 - 64 * 0.7, 125, 64 + 64 * 0.2])
  assert.deepEqual(textBox({ x: 100, y: 10, text: 'ab', size: 10, font: 'x', align: 'right' }, measure).box, [80, 3, 100, 12])
  const two = textBox({ x: 0, y: 10, text: 'abc\nabcdef', size: 10, font: 'x' }, measure)
  assert.equal(two.lines, 2)
  assert.deepEqual(two.box, [0, 3, 60, 10 + 12 + 2])
  // baseline too high ⇒ the box shows it is off the top
  assert.equal(where(textBox({ x: 10, y: 20, text: 'Hi', size: 64, font: 'x' }, measure).box, 400, 300), 'partly')
})

ok('Y4 preview scale keeps the longest side ≤ 1024 and never enlarges', () => {
  assert.equal(previewScaleFor(400, 300), 1)
  assert.equal(previewScaleFor(2048, 1000), 0.5)
  assert.equal(previewScaleFor(1000, 4096), 0.25)
})

ok('Y5 writeBack writes project.layout.json (text) and preview.png (blob) with writeExtra; no writeExtra ⇒ nothing', async () => {
  const wrote = new Map<string, string | Blob>()
  const store = { writeExtra: async (n: string, d: string | Blob) => { wrote.set(n, d) } } as unknown as import('../shared/types').ProjectStore
  const site = { Doc: { width: 2048, height: 1024, layers: [{ id: 'B', kind: 'vector', name: 'bg', x: 0, y: 0, data: { shapes: [{ type: 'rect', x: 0, y: 0, w: 2048, h: 1024, fill: '#fff' }] } }] } } as unknown as import('./page/drawboard-host').DlSite
  let asked = 0
  const png = async (_s: unknown, scale: number) => { asked = scale; return { blob: new Blob(['png']) } }
  ;(globalThis as { document?: unknown }).document = { createElement: () => ({ getContext: () => null }) }
  assert.equal(await writeBack(site, store, png, () => new Date(0)), true)
  assert.equal(asked, 0.5)
  const l = JSON.parse(wrote.get(LAYOUT_FILE) as string)
  assert.equal(l.previewScale, 0.5)
  assert.equal(l.drawnAt, '1970-01-01T00:00:00.000Z')
  assert.deepEqual(l.layers[0].box, [0, 0, 2048, 1024])
  assert.ok(wrote.get(PREVIEW_FILE) instanceof Blob)
  assert.equal(await writeBack(site, {} as never, png), false)
})

ok('Y6 the guest page writes back after a load and after a save (debounced); guide and FORMAT tell the AI to read both files', () => {
  const page = readFileSync(join(__dirname, 'page', 'GuestPaintPage.tsx'), 'utf8')
  assert.match(page, /onSettled: later/)
  assert.match(page, /void writeBack\(s, store, canvasPng\)/)
  assert.match(page, /install: \(s\) => \{ siteRef\.current = s; later\(\);/)
  const api = readFileSync(join(__dirname, 'page', 'guest-api.ts'), 'utf8')
  assert.equal((api.match(/o\.onSettled\?\.\('(load|save)'\)/g) || []).length, 2)
  const brief = readFileSync(join(__dirname, 'ai-brief.ts'), 'utf8')
  assert.equal((brief.match(/project\.layout\.json/g) || []).length, 3)
  assert.match(readFileSync(join(__dirname, 'FORMAT.md'), 'utf8'), /## Seeing what was drawn: preview\.png and project\.layout\.json/)
})

void (async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n   ', e instanceof Error ? e.message : e) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
