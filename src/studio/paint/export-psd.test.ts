/** Dilin Studio · Paint — layered PSD out of the drawboard, and the page jobs export / load (local MCP and tools/paint-cli.mjs).
 * Run (from the studio root): node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./paint/export-psd.test.ts')"
 * Negative controls (each must turn a test red): zipPayload writes a Blob extra as text ⇒ P1; buildPaintExport ignores the PSD option ⇒ P2;
 * paintPageJob lets `load` through on a normal page ⇒ P4; buildPaintExport ignores the AI option ⇒ P6; export drops the .ai notes ⇒ P6. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import type { ProjectStore } from '../shared/types'
import { zipPayload } from '../shared/zip'
import { buildPaintExport, EXPORT_AI, EXPORT_PSD, savePsdForOtherApps } from './export-project'
import { AI_FILE, paintPageJob, PSD_FILE, setLiveSite } from './page/agent-export'
import type { DlSite } from './page/drawboard-host'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

const PSD = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1, 9, 9]) // "8BPS" + version 1 + filler
let encodeCalls: boolean[] = []
const AI = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]) // "%PDF-1.5"
const site = { doc: { defaultView: { PsFile: {
  psd: { encodeDoc: (layers: boolean) => { encodeCalls.push(layers); return PSD } },
  ai: { encodeDoc: async () => ({ bytes: AI, notes: ['text layer "T" written as a picture'] }) },
} } } } as unknown as DlSite

function memStore(folder = true) {
  const files = new Map<string, Blob>()
  let json: unknown = { format: 'dilin-paint', version: 1, width: 10, height: 10, layers: [] }
  const extras = new Map<string, string | Blob>()
  const s = {
    label: 'mem',
    async readJSON() { return json },
    async writeJSON(v: unknown) { json = v },
    async listAssets() { return [...files.keys()].map((name) => ({ name, size: files.get(name)!.size, lastModified: 0, type: '' })) },
    async readAsset(n: string) { return files.get(n) ?? null },
    async writeAsset(n: string, d: Uint8Array) { files.set(n, new Blob([d as BlobPart])) },
    ...(folder ? { async writeExtra(n: string, d: string | Blob) { extras.set(n, d) } } : {}),
  }
  return { store: s as unknown as ProjectStore, extras, files, json: () => json }
}

ok('P1 a Blob extra goes into the zip byte for byte (text extras unchanged)', async () => {
  const z = await zipPayload({ json: { a: 1 }, assets: [], extras: [{ name: PSD_FILE, text: new Blob([PSD as BlobPart]) }, { name: 'x.txt', text: 'hi' }] })
  const r = await JSZip.loadAsync(await z.arrayBuffer())
  assert.deepEqual([...await r.file(PSD_FILE)!.async('uint8array')], [...PSD])
  assert.equal(await r.file('x.txt')!.async('string'), 'hi')
})

ok('P2 export project: PSD option ticked + drawboard open ⇒ project.psd with layers; not ticked or no drawboard ⇒ nothing extra', async () => {
  const m = memStore()
  encodeCalls = []
  setLiveSite(site)
  const on = await buildPaintExport(m.store, { projectId: 'p', options: new Set([EXPORT_PSD]) })
  assert.deepEqual(on.extras?.map((x) => x.name), [PSD_FILE])
  assert.deepEqual([...new Uint8Array(await (on.extras![0].text as Blob).arrayBuffer())], [...PSD])
  assert.deepEqual(encodeCalls, [true], 'written with layers')
  const off = await buildPaintExport(m.store, { projectId: 'p', options: new Set() })
  assert.equal(off.extras, undefined)
  setLiveSite(null)
  const closed = await buildPaintExport(m.store, { projectId: 'p', options: new Set([EXPORT_PSD]) })
  assert.equal(closed.extras, undefined, 'no blank PSD when the drawboard is not open')
  await assert.rejects(() => savePsdForOtherApps(), /not open/)
  setLiveSite(site)
  assert.deepEqual((await savePsdForOtherApps()).map((f) => f.name), [PSD_FILE, AI_FILE])
  setLiveSite(null)
})

ok('P3 page job export: psd comes back as base64 and is saved next to project.json; project = project.json + assets/; bad format refused', async () => {
  const m = memStore()
  await m.store.writeAsset('a.png', new Uint8Array([1, 2, 3]))
  let flushed = 0
  const c = { site, store: m.store, cli: false, flush: async () => { flushed++ }, reload: async () => {} }
  const r = await paintPageJob(c, { kind: 'export', format: 'psd' }) as { ok: true; result: { files: Array<{ name: string; base64: string; mime: string }>; saved: string[] } }
  assert.equal(r.ok, true)
  assert.deepEqual([...Buffer.from(r.result.files[0].base64, 'base64')], [...PSD])
  assert.equal(r.result.files[0].mime, 'image/vnd.adobe.photoshop')
  assert.deepEqual(r.result.saved, [PSD_FILE])
  assert.ok(m.extras.get(PSD_FILE) instanceof Blob)
  const nosave = await paintPageJob(c, { kind: 'export', format: 'psd', save: false }) as { result: { saved: string[] } }
  assert.deepEqual(nosave.result.saved, [])
  const pr = await paintPageJob(c, { kind: 'export', format: 'project' }) as { result: { files: Array<{ name: string; base64: string }> } }
  assert.deepEqual(pr.result.files.map((f) => f.name), ['project.json', 'assets/a.png'])
  assert.equal(flushed, 1, 'project export flushes first')
  assert.equal(JSON.parse(Buffer.from(pr.result.files[0].base64, 'base64').toString()).format, 'dilin-paint')
  assert.deepEqual(await paintPageJob(c, { kind: 'export', format: 'gif' }), { ok: false, error: 'bad_params', message: 'format must be one of psd, psb, ai, ora, png, project' })
  assert.equal(await paintPageJob(c, { kind: 'run' }), null, 'other jobs go on to the drawboard runner')
})

ok('P4 page job load: refused on a normal page (never replaces the user\'s work); on the command-line page writes project.json + assets and reloads', async () => {
  const m = memStore()
  let reloads = 0
  const json = { format: 'dilin-paint', version: 1, width: 64, height: 32, layers: [] }
  const user = await paintPageJob({ site, store: m.store, cli: false, flush: async () => {}, reload: async () => { reloads++ } }, { kind: 'load', json })
  assert.equal((user as { error: string }).error, 'not_available')
  assert.notDeepEqual(m.json(), json)
  const cli = await paintPageJob({ site, store: m.store, cli: true, flush: async () => {}, reload: async () => { reloads++ } }, { kind: 'load', json, assets: { 'b.png': Buffer.from([7, 8]).toString('base64') } })
  assert.deepEqual(cli, { ok: true, result: { loaded: true, assets: 1 } })
  assert.deepEqual(m.json(), json)
  assert.deepEqual([...new Uint8Array(await m.files.get('b.png')!.arrayBuffer())], [7, 8])
  assert.equal(reloads, 1)
  assert.equal((await paintPageJob({ site, store: m.store, cli: true, flush: async () => {}, reload: async () => {} }, { kind: 'load', json: [] }) as { error: string }).error, 'bad_params')
})

ok('P5 wiring: the paint app offers the PSD option and "save for other apps"; the guest page sets the live drawboard and answers export/load before the runner', () => {
  const idx = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  assert.match(idx, /exportOptions: \[\{ id: EXPORT_PSD, label: 'paint_export_psd' \}, \{ id: EXPORT_AI, label: 'paint_export_ai' \}\]/)
  assert.match(idx, /saveForOtherApps: \{ label: 'paint_save_psd'/)
  const page = readFileSync(join(__dirname, 'page/GuestPaintPage.tsx'), 'utf8')
  assert.match(page, /setLiveSite\(s\)/)
  assert.match(page, /\(await paintPageJob\(jobCtx, job\)\) \?\? runRelayJob\(s, job/)
  assert.match(page, /const cli = OPENED_BY_CLI/)
  assert.match(readFileSync(join(__dirname, 'page/agent-export.ts'), 'utf8'), /OPENED_BY_CLI: boolean = \(\(\) => \{ try \{ return new URLSearchParams\(window\.location\.search\)\.get\('cli'\) === '1'/)
})

ok('P6 .ai: export option ⇒ project.ai in the zip; page job export ai ⇒ project.ai saved next to project.json with the notes', async () => {
  const m = memStore()
  setLiveSite(site)
  const both = await buildPaintExport(m.store, { projectId: 'p', options: new Set([EXPORT_PSD, EXPORT_AI]) })
  assert.deepEqual(both.extras?.map((x) => x.name), [PSD_FILE, AI_FILE])
  const ai = await buildPaintExport(m.store, { projectId: 'p', options: new Set([EXPORT_AI]) })
  assert.deepEqual(ai.extras?.map((x) => x.name), [AI_FILE])
  assert.deepEqual([...new Uint8Array(await (ai.extras![0].text as Blob).arrayBuffer())], [...AI])
  setLiveSite(null)
  const c = { site, store: m.store, cli: false, flush: async () => {}, reload: async () => {} }
  const r = await paintPageJob(c, { kind: 'export', format: 'ai' }) as { ok: true; result: { files: Array<{ name: string; base64: string; mime: string }>; saved: string[]; notes: string[] } }
  assert.equal(r.ok, true)
  assert.deepEqual([r.result.files[0].name, r.result.files[0].mime], [AI_FILE, 'application/postscript'])
  assert.deepEqual([...Buffer.from(r.result.files[0].base64, 'base64')], [...AI])
  assert.deepEqual(r.result.saved, [AI_FILE])
  assert.deepEqual(r.result.notes, ['text layer "T" written as a picture'])
  const psd = await paintPageJob(c, { kind: 'export', format: 'psd' }) as { result: Record<string, unknown> }
  assert.equal('notes' in psd.result, false, 'psd has no notes')
})

void (async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', e instanceof Error ? e.stack?.split('\n').slice(0, 4).join('\n ') : e) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
