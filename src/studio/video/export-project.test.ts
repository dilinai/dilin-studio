// 剪辑工程档汇出题：两个勾选（只打包用到的、预览品质）各管各的、都不勾跟整份打包一样、汇出→zip→汇入另一份工程读回内容不变（含药）、
// 快取键编辑器与汇出同一条规则。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/export-project.test.ts')"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssetInfo, ProjectStore } from '../shared/types'
import { applyPayload, readProjectZip, zipPayload, type ProjectPayload } from '../shared/zip'
import { saveProjectSafe } from '../shared/store'
import { VIDEO_I18N } from './i18n'
import { EXPORT_FCPXML, EXPORT_JIANYING, EXPORT_PREMIERE, EXPORT_OTIO, EXPORT_EDL, EXPORT_PREVIEW, EXPORT_USED_ONLY, assetSig, buildOtherAppFiles, buildVideoExport, cacheKeyOf } from './export-project'
import { docToFcpxml, fcpxmlSize } from './lib/fcpxml.pure'
import { JY_CONTENT, JY_DRAFT_ROOT, docToJianying } from './lib/jianying.pure'
import { emptyVideoDoc, loadVideoDoc, pruneUnusedMedia, sameDoc, saveVideoDoc, type VideoDoc } from './format'
import { mediaStoreKey } from './lib/store.pure'
import { MAIN_LANE } from './lib/timeline.pure'

/** 记「这个会话读写过哪一版」的假储存（同底座 store 的安全写规则）：outside()＝用户自己的 AI 在外面改了 project.json */
function memStore(): ProjectStore & { outside: (f: (j: Record<string, unknown>) => void) => void; raw: () => string | null } {
  let json: string | null = null
  let ver = 0, base = -1
  const assets = new Map<string, { b: Blob; at: number }>()
  let clock = 1000
  const put = (v: unknown) => { json = JSON.stringify(v, null, 2) + '\n'; ver++; base = ver }
  const changed = () => json !== null && base !== ver
  return {
    backend: 'opfs', label: '',
    outside: (f) => { const j = JSON.parse(json!); f(j); json = JSON.stringify(j, null, 2) + '\n'; ver++ },
    raw: () => json,
    async readJSON<T>(o?: { peek?: boolean }) { if (!o?.peek) base = ver; return json === null ? null : (JSON.parse(json) as T) },
    async writeJSON(v) { put(v) },
    async writeJSONSafe(v, o) { if (!o?.force && changed()) return { written: false as const, reason: 'changed-outside' as const, lastModified: ver }; put(v); return { written: true as const } },
    async changedOutside() { return changed() },
    async lastModified() { return json === null ? null : ver },
    async readAsset(n) { return assets.get(n)?.b ?? null },
    async writeAsset(n, d) { assets.set(n, { b: d instanceof Blob ? d : new Blob([d as BlobPart]), at: clock++ }) },
    async listAssets(): Promise<AssetInfo[]> { return [...assets].map(([name, a]) => ({ name, size: a.b.size, lastModified: a.at, type: a.b.type })) },
    async deleteAsset(n) { assets.delete(n) },
    watch: () => () => {},
  }
}

const PID = '0123456789abcdef0123456789abcdef'
const bytes = (n: number, ch = 'x') => new Blob([ch.repeat(n)])
const sample = (): VideoDoc => ({
  ...emptyVideoDoc('旅行'),
  media: [
    { id: 'm1', name: 'beach.mp4', kind: 'video', duration: 12, file: 'beach.mp4' },
    { id: 'm2', name: 'song.mp3', kind: 'audio', duration: 30, file: 'song.mp3' },
    { id: 'm3', name: 'unused.mov', kind: 'video', duration: 5, file: 'unused.mov' },
    { id: 'm5', name: 'raw.mov', kind: 'video', duration: 4, file: 'raw.mov' },
  ],
  tracks: [
    { id: MAIN_LANE, kind: 'visual', locked: false, hidden: false, muted: false, clips: [
      { id: 'c1', mediaId: 'm1', start: 0, length: 4, offset: 2 },
      { id: 'c5', mediaId: 'm5', start: 4, length: 4, offset: 0 },
    ] },
    { id: 'a1', kind: 'audio', locked: false, hidden: false, muted: false, clips: [{ id: 'c4', mediaId: 'm2', start: 0, length: 7, offset: 0 }] },
  ],
})

/** 一份工程：beach.mp4（快取有小档）、song.mp3、unused.mov（快取有小档）、raw.mov（快取没小档）、notes.txt（没人指到的杂档） */
async function project() {
  const s = memStore()
  await saveVideoDoc(s, sample())
  for (const [n, b] of [['beach.mp4', bytes(5000, 'B')], ['song.mp3', bytes(800, 'S')], ['unused.mov', bytes(4000, 'U')], ['raw.mov', bytes(3000, 'R')], ['notes.txt', bytes(10, 'n')]] as const) await s.writeAsset(n, b)
  const info = new Map((await s.listAssets()).map((a) => [a.name, a]))
  const cache = new Map<string, Blob>([
    [cacheKeyOf('m1', assetSig(info.get('beach.mp4')!), PID), bytes(500, 'b')],
    [cacheKeyOf('m3', assetSig(info.get('unused.mov')!), PID), bytes(400, 'u')],
  ])
  return { s, cache, readProxy: async (k: string) => cache.get(k) ?? null }
}
const names = (p: ProjectPayload) => p.assets.map((a) => a.name).sort()
const text = async (p: ProjectPayload, n: string) => p.assets.find((a) => a.name === n)!.data.text()

/** project.json 里每份素材的档都要在 assets 里（汇出缺档 ⇒ 汇入后变「找不到素材」） */
function assertComplete(p: ProjectPayload) {
  const have = new Set(p.assets.map((a) => a.name))
  const miss = (p.json.media as { file: string }[]).map((m) => m.file).filter((f) => !have.has(f))
  assert.deepEqual(miss, [], `汇出少了素材档：${miss.join('、')}`)
}
async function viaZip(p: ProjectPayload): Promise<ProjectPayload> {
  return readProjectZip(new Uint8Array(await (await zipPayload(p)).arrayBuffer()), 'video', 1) // 同 Shell：buildExport 回的 payload 经底座 zipPayload 打包
}

let n = 0, bad = 0
async function test(name: string, fn: () => unknown) {
  try { await fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 8).join('\n   ')) }
}

void (async () => {
  await test('A 都不勾 ⇒ 跟整份打包一样：project.json 原样、assets/ 每个档都在、内容是原档', async () => {
    const { s, readProxy } = await project()
    const p = await buildVideoExport(s, { projectId: PID, options: new Set() }, { readProxy })
    assert.deepEqual(p.json, await s.readJSON())
    assert.deepEqual(names(p), ['beach.mp4', 'notes.txt', 'raw.mov', 'song.mp3', 'unused.mov'])
    assert.equal(await text(p, 'beach.mp4'), 'B'.repeat(5000))
    assertComplete(p)
  })

  await test('B 只打包用到的 ⇒ media 只剩时间轴用到的、assets/ 只放它们的档；其余栏位原样', async () => {
    const { s, readProxy } = await project()
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_USED_ONLY]) }, { readProxy })
    const orig = (await s.readJSON()) as Record<string, unknown>
    assert.deepEqual((p.json.media as { id: string }[]).map((m) => m.id), ['m1', 'm2', 'm5'])
    assert.deepEqual(names(p), ['beach.mp4', 'raw.mov', 'song.mp3'])
    assert.deepEqual({ ...p.json, media: null }, { ...orig, media: null })
    assert.equal(await text(p, 'beach.mp4'), 'B'.repeat(5000), '没勾预览品质却换了小档')
    assertComplete(p)
  })

  await test('C 预览品质 ⇒ 影片换快取小档、档名照旧、project.json 不动；没小档的影片与音频照放原档', async () => {
    const { s, cache, readProxy } = await project()
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_PREVIEW]) }, { readProxy })
    assert.deepEqual(p.json, await s.readJSON())
    assert.deepEqual(names(p), ['beach.mp4', 'notes.txt', 'raw.mov', 'song.mp3', 'unused.mov'])
    assert.equal(await text(p, 'beach.mp4'), 'b'.repeat(500))
    assert.equal(await text(p, 'unused.mov'), 'u'.repeat(400))
    assert.equal(await text(p, 'raw.mov'), 'R'.repeat(3000))
    assert.equal(await text(p, 'song.mp3'), 'S'.repeat(800))
    // 小档没比原档小 ⇒ 放原档
    for (const k of [...cache.keys()]) cache.set(k, bytes(9000, 'z'))
    const p2 = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_PREVIEW]) }, { readProxy })
    assert.equal(await text(p2, 'beach.mp4'), 'B'.repeat(5000))
  })

  await test('D 原档被外面换过（大小／修改时间变了）⇒ 快取键跟着变·⛔ 拿旧小档', async () => {
    const { s, readProxy } = await project()
    await s.writeAsset('beach.mp4', bytes(5000, 'N'))
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_PREVIEW]) }, { readProxy })
    assert.equal(await text(p, 'beach.mp4'), 'N'.repeat(5000))
  })

  await test('E 两个都勾 ⇒ 打成 zip、汇入另一份工程读回：内容＝只留用到的那份、素材一个不缺；药：少放一个档 ⇒ 红', async () => {
    const { s, readProxy } = await project()
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_USED_ONLY, EXPORT_PREVIEW]) }, { readProxy })
    const t2 = memStore()
    await applyPayload(t2, await viaZip(p))
    const back = await loadVideoDoc(t2)
    assert.deepEqual(back.drops, [])
    assert.ok(sameDoc(back, pruneUnusedMedia(await loadVideoDoc(s))), '汇入读回跟原工程（只留用到的）不同')
    assert.deepEqual((await t2.listAssets()).map((a) => a.name).sort(), ['beach.mp4', 'raw.mov', 'song.mp3'])
    assert.equal(await (await t2.readAsset('beach.mp4'))!.text(), 'b'.repeat(500))
    assertComplete(p)
    const broken = { ...p, assets: p.assets.filter((a) => a.name !== 'raw.mov') }
    assert.throws(() => assertComplete(broken), /raw\.mov/)
  })

  await test('F 快取键规则编辑器与汇出同一份：编辑器只经 cacheKeyOf／assetSig 算键', () => {
    assert.equal(cacheKeyOf('m1', '-a-b', PID), mediaStoreKey({ id: 'm1-a-b', from: 'drive' }, PID))
    assert.equal(assetSig({ size: 36, lastModified: 72.4 }), '-10-20')
    // 游客版宿主（page/guest.tsx）给整页算键：只经 cacheKeyOf
    const E = readFileSync(join(__dirname, 'page/guest.tsx'), 'utf8')
    assert.match(E, /const keyOf = \(id: string\) => cacheKeyOf\(id, st\.sigs\.get\(id\) \?\? '', projectId\)/)
    assert.match(E, /keyOf: \(m\) => keyOf\(m\.id\)/)
    assert.doesNotMatch(E, /mediaStoreKey|toString\(36\)/, '编辑器自己拼键（会跟汇出对不上）')
    // 写进 assets/ 后改按那份的修改时间（重开、汇出才对得上这次转的小档）
    assert.match(E, /await store\.writeAsset\(file, blob\)[\s\S]{0,300}if \(a\) st\.sigs\.set\(m\.id, assetSig\(a\)\)/)
  })

  await test('G 汇出只「看一眼」project.json（peek）：⛔ 动编辑器自动存的比对基准——外面改过的照样挡得住', async () => {
    const { s, readProxy } = await project()
    await s.readJSON() // 编辑器载入那一版
    s.outside((j) => { j.name = '外面改的' })
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_USED_ONLY]) }, { readProxy })
    assert.equal(p.json.name, '外面改的')
    assert.equal(await s.changedOutside(), true, '汇出把基准换成外面那一版了（之后自动存会盖掉外面的改动）')
  })

  await test('H 自动存（saveProjectSafe）：外面改过 ⇒ 不写、project.json 留外面那版；明确存档（force）照写；编辑器自动存走它、flush 才带 force', async () => {
    const { s } = await project()
    const doc = await loadVideoDoc(s)
    s.outside((j) => { j.name = 'AI 改的名' })
    const before = s.raw()
    const r = await saveProjectSafe(s, (x) => saveVideoDoc(x, { ...doc, name: '页面上的' }))
    assert.equal(r.written, false)
    assert.equal(s.raw(), before, '外面改过还是写进去了')
    const f = await saveProjectSafe(s, (x) => saveVideoDoc(x, { ...doc, name: '页面上的' }), { force: true })
    assert.equal(f.written, true)
    assert.equal((await s.readJSON<{ name: string }>())!.name, '页面上的')
    // 没被外面改过 ⇒ 自动存照写
    const ok = await saveProjectSafe(s, (x) => saveVideoDoc(x, { ...doc, name: '再改一次' }))
    assert.equal(ok.written, true)
    const E = readFileSync(join(__dirname, 'page/guest.tsx'), 'utf8'), P = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
    assert.match(E, /saveProjectSafe\(store, \(s\) => saveVideoDoc\(s, doc\), \{ force \}\)/)
    assert.match(E, /if \(!r\.written\) \{ props\.onSaveStateChange\?\.\('dirty'\); return \{ status: 412, j: \{\} \} \}/)
    assert.match(P, /if \(r\.status === 412\) \{ setSaveState\('held'\); return \}/, '页面：外面改过 ⇒ 不写、不重试')
    assert.match(P, /host\.project\.registerFlush\(\(\) => flushProjectRef\.current\(\)\)/)
    assert.equal((P.match(/saveNowRef\.current\(true\)/g) ?? []).length, 1, '防抖自动存不该带 force（只有 flush 带）')
    assert.match(P, /const flushProject = useCallback\([\s\S]{0,600}await saveNowRef\.current\(true\)/, 'force 那一发在 flushProject 里')
    // 游客版宿主没有旁路读 project.json（读档只在开档时·汇出另用 peek）
    const reads = [...E.matchAll(/\.readJSON\b[^\n]{0,60}/g)].map((m) => m[0])
    for (const x of reads) assert.match(x, /\(\{ peek: true \}\)/, `编辑器的旁路读要带 peek：${x}`)
  })

  await test('I 接入口：两个勾选挂上 Shell（id 与 export-project 同一份、字三语都有）、buildExport 指到 buildVideoExport', () => {
    const I = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    assert.match(I, /\{ id: EXPORT_USED_ONLY, label: 'vedit_guest_export_used_only' \}/)
    assert.match(I, /\{ id: EXPORT_PREVIEW, label: 'vedit_guest_export_preview' \}/)
    assert.match(I, /buildExport: \(store, ctx\) => buildVideoExport\(store, ctx\)/)
    for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) for (const k of ['vedit_guest_export_used_only', 'vedit_guest_export_preview', 'vedit_guest_export_fcpxml', 'vedit_guest_export_jianying']) assert.ok((VIDEO_I18N[lang] as Record<string, string>)[k], `${lang} 缺 ${k}`)
  })

  await test('J 附 FCPXML ⇒ zip 根目录多一份 <工程名>.fcpxml：主轨排成故事线、其他轨挂成 lane、素材指到 assets/；没勾就没有', async () => {
    const { s, readProxy } = await project()
    const none = await buildVideoExport(s, { projectId: PID, options: new Set() }, { readProxy })
    assert.equal(none.extras, undefined)
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_FCPXML]) }, { readProxy })
    assert.equal(p.extras?.length, 1)
    assert.match(p.extras![0].name, /\.fcpxml$/)
    const x = p.extras![0].text
    assert.match(x, /^<\?xml[\s\S]*<fcpxml version="1\.10">[\s\S]*<spine>[\s\S]*<\/spine>/)
    for (const m of (p.json.media as { file: string }[]).filter((m) => x.includes(`/${m.file}"`))) assert.ok(x.includes(`src="./assets/${encodeURI(m.file)}"`))
    assert.ok(/<asset-clip /.test(x), '素材片段要进时间线')
    assertComplete(p)
    const z = await zipPayload(p)
    assert.ok(z.size > 0)
  })

  await test('J3 附剪映草稿 ⇒ zip 根目录多 draft_content.json＋draft_meta_info.json：时间微秒、主轨空档留着（磁吸关）、素材指草稿夹占位符下 assets/、文字与淡入淡出带过去；没勾就没有', async () => {
    const { s, readProxy } = await project()
    const none = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_FCPXML]) }, { readProxy })
    assert.ok(!none.extras!.some((e) => e.name.startsWith('draft_')))
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_JIANYING]) }, { readProxy })
    assert.deepEqual(p.extras!.map((e) => e.name), [JY_CONTENT, 'draft_meta_info.json'])
    const c = JSON.parse(p.extras![0].text), meta = JSON.parse(p.extras![1].text)
    assert.equal(c.config.maintrack_adsorb, false)
    assert.equal(meta.tm_duration, c.duration)
    for (const v of [...c.materials.videos, ...c.materials.audios]) assert.ok(v.path.startsWith(`${JY_DRAFT_ROOT}/assets/`), v.path)
    const segs = c.tracks.flatMap((t: { segments: { target_timerange: { start: number; duration: number } }[] }) => t.segments)
    for (const sg of segs) assert.ok(Number.isInteger(sg.target_timerange.start) && sg.target_timerange.duration > 0)
    assert.equal(c.tracks[0].type, 'video', '主轨排第一条')
    assertComplete(p)
    // 主轨有空档：第二段起点照原样（不被挤到前一段尾巴）
    const doc = { name: 'x', ratio: { kind: 'preset', key: '16:9' }, programs: {}, drops: [], media: [{ id: 'm1', name: 'a.mp4', kind: 'video', duration: 5, file: 'a.mp4' }, { id: 'm2', name: 'b.m4a', kind: 'audio', duration: 5, file: 'b.m4a' }],
      tracks: [{ id: 't', kind: 'text', locked: false, hidden: false, muted: false, clips: [{ id: 'x', mediaId: '', start: 0.5, length: 3, offset: 0, text: { content: '測試', x: 0.5, y: 0.3, size: 0.08, color: '#ff0000', bold: true } }] },
        { id: 'main', kind: 'visual', locked: false, hidden: false, muted: false, clips: [{ id: 'a', mediaId: 'm1', start: 0, length: 2.5, offset: 0 }, { id: 'b', mediaId: 'm1', start: 3, length: 2, offset: 2.5, volume: 0.5 }] },
        { id: 'au', kind: 'audio', locked: false, hidden: false, muted: false, clips: [{ id: 's', mediaId: 'm2', start: 1, length: 3.5, offset: 0, fadeIn: 0.5, fadeOut: 1 }] }] } as unknown as Parameters<typeof docToJianying>[0]
    const j = docToJianying(doc, { seed: 'ab' }).content as { duration: number; tracks: { type: string; segments: { target_timerange: { start: number }; source_timerange: { start: number } | null; volume: number }[] }[]; materials: { texts: { content: string }[]; audio_fades: { fade_in_duration: number; fade_out_duration: number }[] } }
    assert.deepEqual(j.tracks.map((t) => t.type), ['video', 'audio', 'text'])
    assert.deepEqual(j.tracks[0].segments.map((x) => x.target_timerange.start), [0, 3_000_000])
    assert.equal(j.tracks[0].segments[1].source_timerange!.start, 2_500_000)
    assert.equal(j.tracks[0].segments[1].volume, 0.5)
    assert.equal(j.duration, 5_000_000)
    assert.equal(JSON.parse(j.materials.texts[0].content).text, '測試')
    assert.deepEqual(j.materials.audio_fades.map((f) => [f.fade_in_duration, f.fade_out_duration]), [[500_000, 1_000_000]])
  })

  await test('J4 剪映草稿画幅照工程写死（ratio custom＋工程宽高），不交给剪映跟着素材走', async () => {
    const mk = (ratio: unknown) => ({ name: 'x', ratio, programs: {}, drops: [], media: [{ id: 'm1', name: 'a.mp4', kind: 'video', duration: 5, file: 'a.mp4' }],
      tracks: [{ id: 'main', kind: 'visual', locked: false, hidden: false, muted: false, clips: [{ id: 'a', mediaId: 'm1', start: 0, length: 2, offset: 0 }] }] }) as unknown as Parameters<typeof docToJianying>[0]
    const cc = (ratio: unknown) => (docToJianying(mk(ratio), { seed: 'ab' }).content as { canvas_config: { width: number; height: number; ratio: string } }).canvas_config
    assert.deepEqual(cc({ kind: 'custom', w: 1470, h: 630 }), { width: 1470, height: 630, ratio: 'custom' })
    assert.deepEqual(cc({ kind: 'preset', key: '9:16' }), { width: 1080, height: 1920, ratio: 'custom' })
    assert.deepEqual(cc({ kind: 'preset', key: '16:9' }), { width: 1920, height: 1080, ratio: 'custom' })
  })

  await test('J2 单机版「存一份 Final Cut／达芬奇工程档」：buildOtherAppFiles 回 <工程名>.fcpxml＋.xml＋.otio＋.edl（同汇出附的那四份）；接入口挂上、字三语齐', async () => {
    const { s, readProxy } = await project()
    const files = await buildOtherAppFiles(s)
    const p = await buildVideoExport(s, { projectId: PID, options: new Set([EXPORT_FCPXML, EXPORT_PREMIERE, EXPORT_OTIO, EXPORT_EDL]) }, { readProxy })
    assert.deepEqual(files, p.extras)
    assert.deepEqual(files.map((f) => f.name.replace(/^.*\./, "")), ["fcpxml", "xml", "otio", "edl"])
    const I = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    assert.match(I, /saveForOtherApps: \{ label: 'vedit_save_fcpxml', hint: 'vedit_save_fcpxml_hint', build: buildOtherAppFiles \}/)
    for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) for (const k of ['vedit_save_fcpxml', 'vedit_save_fcpxml_hint']) assert.ok((VIDEO_I18N[lang] as Record<string, string>)[k], `${lang} 缺 ${k}`)
    await assert.rejects(buildOtherAppFiles({ ...s, readJSON: async () => null }), (e: unknown) => (e as { code?: string }).code === 'no_project_json')
  })

  await test('K FCPXML 本体：起点长度换成 30fps 格、空档补 gap、文字成 title、音频轨 lane 负数、音量换 dB、特效贴纸列在 notes', () => {
    const doc = {
      name: 'a & b', ratio: { kind: 'preset', key: '9:16' }, programs: {}, drops: [],
      media: [{ id: 'v', name: 'v.mp4', kind: 'video', duration: 5, file: 'v.mp4' }, { id: 'a', name: 's.mp3', kind: 'audio', duration: 9, file: 's.mp3' }],
      tracks: [
        { id: 'st', kind: 'sticker', locked: false, hidden: false, muted: false, clips: [{ id: 'k', mediaId: '', start: 0, length: 1, offset: 0, sticker: { sticker: 'x', x: 0, y: 0, size: 1 } }] },
        { id: 'tx', kind: 'text', locked: false, hidden: false, muted: false, clips: [{ id: 't', mediaId: '', start: 0.5, length: 1, offset: 0, text: { content: '你<好>', x: 0.5, y: 0.5, size: 0.1, color: '#ff0000' } }] },
        { id: MAIN_LANE, kind: 'visual', locked: false, hidden: false, muted: false, clips: [{ id: 'c1', mediaId: 'v', start: 0, length: 2, offset: 1 }, { id: 'c2', mediaId: 'v', start: 3, length: 1, offset: 0, volume: 0.5 }] },
        { id: 'au', kind: 'audio', locked: false, hidden: false, muted: false, clips: [{ id: 'm', mediaId: 'a', start: 1, length: 2, offset: 0, muted: true }] },
      ],
    } as unknown as VideoDoc
    const { xml, notes } = docToFcpxml(doc)
    assert.deepEqual(fcpxmlSize(doc.ratio), { w: 1080, h: 1920 })
    assert.match(xml, /<asset-clip ref="r2" offset="0s" name="v\.mp4" start="30\/30s" duration="60\/30s"/)
    assert.match(xml, /<gap name="Gap" offset="60\/30s" start="0s" duration="30\/30s">/)
    assert.match(xml, /<asset-clip ref="r2" offset="90\/30s"[^>]*><adjust-volume amount="-6\.02dB"\/>/)
    assert.match(xml, /<title ref="r4" lane="1" offset="45\/30s"[\s\S]*?你&lt;好&gt;[\s\S]*?fontColor="1 0 0 1"/)
    assert.match(xml, /<asset-clip ref="r3" lane="-1" offset="60\/30s"[^>]*><adjust-volume amount="-96dB"\/>/)
    assert.match(xml, /<event name="a &amp; b">/)
    assert.ok(notes.includes('sticker'))
  })

  console.log(bad ? `studio-video export：${n}/${n + bad} 过` : `studio-video export → ${n} 过`)
  if (bad) process.exit(1)
})()
