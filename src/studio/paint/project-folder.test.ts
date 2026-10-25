/** Dilin Studio · Paint — project folder format tests.
 *  Run (from the studio root): node -e "require('sucrase/register/ts');require('./paint/project-folder.test.ts')"
 *  Negative controls (each one must turn a test red):
 *    toFolder keeps data URLs inline ⇒ P1/P2; fromFolder skips the file read ⇒ P1/P3; staleOwnAssets also deletes hand-named files ⇒ P4;
 *    ASSET_REF accepts "assets/../x.png" ⇒ P5. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { toFolder, fromFolder, staleOwnAssets, checkProject, isAssetRef, assetRefs, b64ToBytes, bytesToB64, emptyProject, summarize, engineToBody, bodyToEngine } from './project-folder.pure'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

// 1×1 PNGs (red, blue)
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
const BLUE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=='

const sample = () => ({
  format: 'dilin-canvas', version: 1, width: 400, height: 300,
  layers: [
    { id: 'L1', kind: 'raster', name: 'bg', visible: true, image: RED, mask: { enabled: true, image: BLUE } },
    { id: 'L2', kind: 'raster', name: 'copy', image: RED },
    { id: 'L3', kind: 'text', name: 'title', data: { text: 'assets/not-a-file.png is just text', size: 40 } },
    { id: 'L4', kind: 'vector', name: 'v', data: { shapes: [{ type: 'image', src: BLUE }] } },
  ],
  smartSources: { s1: { name: 'pic', type: 'image', w: 1, h: 1, image: RED } },
})

ok('P1 toFolder ⇒ fromFolder gives back the exact engine JSON', async () => {
  const src = sample()
  const { json, assets } = await toFolder(src)
  assert.ok(!JSON.stringify(json).includes('data:image'), 'no inline images left in project.json')
  const files = new Map([...assets].map(([k, v]) => [k, v]))
  const back = await fromFolder(JSON.parse(JSON.stringify(json)), async (p) => files.get(p) ?? null)
  assert.deepEqual(back.project, src)
  assert.deepEqual(back.missing, [])
})

ok('P2 the same image is written once (content-named)', async () => {
  const { json, assets } = await toFolder(sample())
  assert.equal(assets.size, 2, 'RED and BLUE ⇒ two files')
  const j = json as { layers: Array<{ image?: string }> }
  assert.equal(j.layers[0].image, j.layers[1].image)
  assert.match(String(j.layers[0].image), /^assets\/[0-9a-f]{16}\.png$/)
  const again = await toFolder(sample())
  assert.deepEqual([...again.assets.keys()].sort(), [...assets.keys()].sort(), 'stable names across saves')
})

ok('P3 a hand-added asset (any safe name) is loaded; a missing one is reported and left as text', async () => {
  const red = b64ToBytes(RED.split(',')[1])
  const json = { ...emptyProject(10, 10), layers: [{ id: 'A', kind: 'raster', image: 'assets/logo.png' }, { id: 'B', kind: 'raster', image: 'assets/gone.png' }] }
  const r = await fromFolder(json, async (p) => (p === 'assets/logo.png' ? red : null))
  const L = (r.project as { layers: Array<{ image: string }> }).layers
  assert.equal(L[0].image, RED)
  assert.equal(L[1].image, 'assets/gone.png')
  assert.deepEqual(r.missing, ['assets/gone.png'])
})

ok('P4 cleanup removes only editor-named files that are no longer used', () => {
  const json = { layers: [{ image: 'assets/0123456789abcdef.png' }, { image: 'assets/logo.png' }] }
  const files = ['0123456789abcdef.png', 'fedcba9876543210.png', 'logo.png', 'old-photo.jpg', 'notes.txt']
  assert.deepEqual(staleOwnAssets(files, json), ['fedcba9876543210.png'])
})

ok('P5 asset paths: no sub-folders, no "..", image types only', () => {
  for (const s of ['assets/a.png', 'assets/Logo_2.JPG', 'assets/x.webp', 'assets/0123456789abcdef.svg']) assert.ok(isAssetRef(s), s)
  for (const s of ['assets/../x.png', 'assets/sub/x.png', '/assets/x.png', 'assets/x.exe', 'assets/.png', 'https:assets/a.png', 'assets/a..png']) assert.ok(!isAssetRef(s), s)
  assert.deepEqual([...assetRefs({ a: ['assets/a.png', { b: 'assets/b.gif' }], c: 'x' })].sort(), ['assets/a.png', 'assets/b.gif'])
})

ok('P6 project shape check', () => {
  assert.equal(checkProject(emptyProject()).ok, true)
  assert.equal(checkProject({ ...emptyProject(), width: 0 }).ok, false)
  assert.equal(checkProject({ ...emptyProject(), layers: [{}] }).ok, false)
  assert.equal(checkProject([]).ok, false)
})

ok('P10 header: the engine\'s format/version are dropped on save and restored on load', () => {
  const e = { ...sample(), docName: 'x' }
  const body = engineToBody(e)
  assert.ok(!('format' in body) && !('version' in body))
  assert.deepEqual(bodyToEngine({ format: 'dilin-studio/paint', version: 1, ...body }), e)
})

ok('P7 base64 helpers round-trip large buffers', () => {
  const b = new Uint8Array(200_000).map((_, i) => (i * 31) & 255)
  assert.deepEqual(b64ToBytes(bytesToB64(b)), b)
})

ok('P8 summary lists layers bottom to top', () => {
  const s = summarize(sample())
  assert.match(s, /^Canvas 400×300, 4 layer\(s\)/)
  assert.match(s, /L1 raster "bg"/)
})

ok('P9 import boundary: paint (and page/) imports only itself, shared and npm packages', () => {
  const dir = __dirname
  const studio = resolve(dir, '..')
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(d, e.name)] : []))
  const files = walk(dir)
  assert.ok(files.some((f) => f.endsWith(join('page', 'DrawboardPage.tsx'))), 'the full page is scanned too')
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      if (!spec.startsWith('.')) { assert.ok(!spec.startsWith('@/') && !spec.startsWith('@dilinai/'), `${f} imports ${spec}`); continue }
      const target = relative(studio, resolve(dirname(f), spec)).split(sep)[0]
      assert.ok(target === 'paint' || target === 'shared', `${f} imports ${spec}`)
    }
  }
})

ok('C1 installChrome: relative logo / home links from the host resolve against the outer page, not the drawboard iframe (control: write o.logoSrc as-is ⇒ red)', async () => {
  const { installChrome, hostUrl } = await import('./page/drawboard-host')
  assert.equal(hostUrl('logo.png', 'https://dilinai.com/oss/app/index.html?app=paint&id=x'), 'https://dilinai.com/oss/app/logo.png')
  assert.equal(hostUrl('/logo.png', 'https://dilinai.com/studio/paint/abc'), 'https://dilinai.com/logo.png')
  type El = { id?: string; href?: string; src?: string; children: El[]; [k: string]: unknown }
  const mk = (): El => ({ children: [], setAttribute() {}, append(...c: El[]) { this.children.push(...c) }, style: {} })
  const bar = { ...mk(), querySelector: () => null, firstChild: null, insertBefore(n: El) { (this as El).children.push(n) } }
  const fakeDoc = {
    getElementById: (id: string) => (id === 'menubar' ? bar : null),
    createElement: () => mk(), createTextNode: (s: string) => ({ textContent: s, children: [] }),
    head: { appendChild() {} },
  }
  const g = globalThis as { document?: unknown }
  const had = 'document' in g, prev = g.document
  g.document = { baseURI: 'https://dilinai.com/oss/app/index.html?app=paint&id=x' }
  try {
    installChrome(fakeDoc as unknown as Document, { homeHref: 'index.html', homeLabel: 'Dilin Studio', homeTitle: '', logoSrc: 'logo.png' })
  } finally { if (had) g.document = prev; else delete g.document }
  const a = bar.children[0]
  assert.equal(a.href, 'https://dilinai.com/oss/app/index.html')
  assert.equal(a.children[0].src, 'https://dilinai.com/oss/app/logo.png')
})

void (async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n  ', e instanceof Error ? e.message : e) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
