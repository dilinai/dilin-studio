/** Dilin Studio · Paint — project.check.json tests (what the engine cannot read).
 *  Run (from the studio root): node -e "require('sucrase/register/ts');require('./paint/check.test.ts')"
 *  Negative controls (each must turn a test red): SHAPES loses "path" ⇒ C1; the slip table loses "fontSize" ⇒ C3;
 *  checkPage stops checking assets ⇒ C4; guest-api stops writing the report ⇒ C6;
 *  a language of ai-brief or FORMAT.md loses the "change words via data.text, don't type on the canvas" line ⇒ C8. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHECK_FILE, checkProjectFile, reportText } from './check.pure'
import { emptyProject } from './project-folder.pure'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

const bg = { id: 'L1', kind: 'raster', name: 'Background', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, image: 'assets/bg.png' }
const page = (...layers: unknown[]) => ({ format: 'dilin-studio/paint', version: 1, width: 400, height: 300, layers: [bg, ...layers] })
const vec = (...shapes: unknown[]) => ({ id: 'V', kind: 'vector', name: 'v', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, data: { shapes } })
const have = new Set(['bg.png'])
const paths = (xs: { path: string }[]) => xs.map((x) => x.path)

ok('C1 a clean drawing (rect, ellipse, triangle path, star, line, text) ⇒ ok, no errors, no warnings', () => {
  const r = checkProjectFile(page(
    vec({ id: 'a', type: 'rect', x: 1, y: 1, w: 10, h: 10, fill: '#ff0000', stroke: 'none', strokeWidth: 0 },
      { id: 'b', type: 'ellipse', x: 1, y: 1, w: 10, h: 10, fill: '#00f' },
      { id: 'c', type: 'path', points: [[400, 100], [480, 240], [320, 240]], closed: true, fill: '#ffcc00' },
      { id: 'd', type: 'star', cx: 50, cy: 50, r1: 20, r2: 8, points: 5, fill: '#000' },
      { id: 'e', type: 'line', points: [[0, 0], [10, 10]], stroke: '#000', strokeWidth: 2 }),
    { id: 'T', kind: 'text', name: 't', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, data: { x: 20, y: 60, text: 'Hello', size: 48, font: 'sans-serif', color: '#123456', align: 'left', weight: 'bold' } },
  ), have)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.ok, true)
  assert.equal(r.layers, 3)
})

ok('C2 unknown kind / shape type / blend, no fill nor stroke ⇒ errors with a hint naming what to write', () => {
  const r = checkProjectFile(page(
    { id: 'X', type: 'raster', name: 'x', image: 'assets/bg.png' },
    vec({ id: 's1', type: 'triangle', points: [[0, 0], [1, 1], [2, 0]], fill: '#f00' }, { id: 's2', type: 'rect', x: 0, y: 0, w: 5, h: 5 }),
    { ...bg, id: 'B2', blend: 'add' },
  ), have)
  assert.equal(r.ok, false)
  const at = (p: string) => r.errors.find((e) => e.path === p)
  assert.match(at('layers[1].kind')!.hint!, /"kind"/)
  assert.match(at('layers[2].data.shapes[0].type')!.hint!, /path with three points and "closed": true/)
  assert.ok(at('layers[2].data.shapes[1]'), 'a rect with no fill and no stroke draws nothing')
  assert.match(at('layers[3].blend')!.message, /unknown blend "add"/)
})

ok('C3 common slips are warnings that name the real field; editor-written extra fields are not flagged', () => {
  const r = checkProjectFile(page(
    { id: 'T', kind: 'text', name: 't', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, data: { x: 20, y: 60, text: 'Hi', fontSize: 30, size: 30, font: 'serif', color: '#000', fontFamily: 'serif' } },
    { id: 'T2', kind: 'text', name: 't2', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, data: { x: 20, y: 60, content: 'Hi', size: 30, font: 'serif', color: '#000' } },
    vec({ id: 'a', type: 'rect', x: 0, y: 0, w: 5, h: 5, color: '#f00' }, { id: 'b', type: 'bezier', anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }], fill: '#000', effects: [], apStack: [], profile: 'x' }),
  ), have)
  assert.ok(!r.warnings.some((w) => w.path.endsWith('fontSize')), 'size is there, so fontSize is a harmless extra')
  assert.match(r.warnings.find((w) => w.path === 'layers[2].data.content')!.hint!, /"text"/)
  assert.match(r.warnings.find((w) => w.path === 'layers[3].data.shapes[0].color')!.hint!, /"fill"/)
  assert.ok(!r.warnings.some((w) => /shapes\[1\]/.test(w.path)), 'fields the editor writes on its own shapes are not warnings')
  assert.ok(r.errors.some((e) => e.path === 'layers[2].data.text'))
})

ok('C4 pictures: a missing file and a bad path are errors; a data URL is fine', () => {
  const r = checkProjectFile(page({ ...bg, id: 'P', image: 'assets/gone.png' }, { ...bg, id: 'Q', image: 'pics/a.png' }, { ...bg, id: 'R', image: 'data:image/png;base64,AAAA' }), have)
  assert.deepEqual(paths(r.errors), ['layers[1].image', 'layers[2].image'])
  assert.match(r.errors[0].message, /not in the assets folder/)
})

ok('C5 no background ⇒ warning; baseline above the canvas ⇒ warning; percent opacity ⇒ error with a hint; duplicate id; pages are checked too', () => {
  const r = checkProjectFile({ format: 'dilin-studio/paint', version: 1, width: 400, height: 300, layers: [
    { id: 'T', kind: 'text', name: 't', visible: true, opacity: 50, blend: 'normal', x: 0, y: 0, data: { x: 20, y: 10, text: 'Hi', size: 48, font: 'serif', color: '#000' } },
    { id: 'T', kind: 'text', name: 't', visible: true, opacity: 1, blend: 'normal', x: 0, y: 0, data: { x: 20, y: 60, text: 'Hi', size: 48, font: 'serif', color: 'reddish!' } },
  ], pages: [{ format: 'dilin-canvas', version: 1, width: 10, height: 10, layers: [{ id: 'Z', kind: 'blob' }] }] }, have)
  assert.ok(r.warnings.some((w) => w.path === 'layers[0]' && /no background/.test(w.message)))
  assert.ok(r.warnings.some((w) => w.path === 'layers[0].data.y'))
  assert.match(r.errors.find((e) => e.path === 'layers[0].opacity')!.hint!, /0\.5/)
  assert.ok(r.errors.some((e) => e.path === 'layers[1].id'))
  assert.ok(r.errors.some((e) => e.path === 'layers[1].data.color'))
  assert.ok(r.errors.some((e) => e.path === 'pages[0].layers[0].kind'))
  // a fresh blank project from the editor itself is clean (no layers ⇒ no background warning either)
  assert.deepEqual(checkProjectFile(emptyProject(), new Set()).errors, [])
})

ok('C6 the report text says what it is; the guest api writes it on every load next to project.json', () => {
  const t = JSON.parse(reportText(checkProjectFile(page(), have, new Date(0))))
  assert.equal(t.checkedAt, '1970-01-01T00:00:00.000Z')
  assert.match(t.about, /errors = will not show/)
  assert.equal(CHECK_FILE, 'project.check.json')
  const src = readFileSync(join(__dirname, 'page', 'guest-api.ts'), 'utf8')
  assert.match(src, /if \(store\.writeExtra\) await store\.writeExtra\(CHECK_FILE, reportText\(report\)\)/)
  const brief = readFileSync(join(__dirname, 'ai-brief.ts'), 'utf8')
  assert.equal((brief.match(/project\.check\.json/g) || []).length, 3, 'all three languages tell the AI to read the report')
})

ok('C7 FORMAT.md and the checker use the same shape table: every shape type the checker accepts is documented with its required numbers', () => {
  const { SHAPES } = require('./check.pure') as typeof import('./check.pure')
  const fmt = readFileSync(join(__dirname, 'FORMAT.md'), 'utf8')
  for (const [type, s] of Object.entries(SHAPES)) {
    const line = fmt.split('\n').find((l) => l.includes(`"type": "${type}"`))
    assert.ok(line, `FORMAT.md has no line for shape "${type}"`)
    for (const k of s.need) assert.ok(line!.includes(`"${k}"`), `FORMAT.md line for "${type}" misses "${k}"`)
  }
})

ok('C8 all three languages and FORMAT.md say: change words by editing the text layer data.text, do not type on the web canvas', () => {
  const { paintFormatNotes } = require('./ai-brief') as typeof import('./ai-brief')
  const want = { 'zh-TW': /改字：直接改那個文字層 data 的 text[^\n]*別在網頁畫布上用滑鼠點文字工具再打字/, 'zh-CN': /改字：直接改那个文字层 data 的 text[^\n]*别在网页画布上用鼠标点文字工具再打字/, en: /edit that text layer's data\.text[^\n]*Do not click the text tool on the web canvas and type/ } as const
  for (const [lang, re] of Object.entries(want)) assert.match(paintFormatNotes(lang as keyof typeof want), re, lang)
  const fmt = readFileSync(join(__dirname, 'FORMAT.md'), 'utf8').replace(/\s+/g, ' ')
  assert.match(fmt, /edit its `data\.text`.*Do not click the text tool on the web canvas and type/)
})

void (async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n  ', e instanceof Error ? e.message : e) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
