// 游客剪辑工程档题：project.json 来回一致、外面（用户的 AI）改档后读回、坏档与新版拒收、汇出用到的素材、档名。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/format.test.ts')"
import assert from 'node:assert/strict'
import type { AssetInfo, ProjectStore } from '../shared/types'
import { isStudioError } from '../shared/types'
import { assetNameFor, docFromJson, docToJson, emptyVideoDoc, loadVideoDoc, pruneUnusedMedia, sameDoc, saveVideoDoc, usedMediaIds, videoFormat, type VideoDoc } from './format'
import { MAIN_LANE } from './lib/timeline.pure'
import { dropZh, parseProject } from './lib/project.pure'
import { DROP_KEY, dropText } from './drop-text'
import { VIDEO_I18N } from './i18n'

/** 记忆体里的工程（同 ProjectStore 介面·写 JSON 照真的那样缩排 2 格） */
function memStore(): ProjectStore & { raw: () => string | null; setRaw: (s: string) => void } {
  let json: string | null = null
  const assets = new Map<string, Blob>()
  return {
    backend: 'opfs', label: '',
    raw: () => json, setRaw: (s) => { json = s },
    async readJSON<T>() { return json === null ? null : (JSON.parse(json) as T) },
    async writeJSON(v) { json = JSON.stringify(v, null, 2) + '\n' },
    async writeJSONSafe(v) { json = JSON.stringify(v, null, 2) + '\n'; return { written: true as const } },
    async changedOutside() { return false },
    async lastModified() { return json === null ? null : 1 },
    async readAsset(n) { return assets.get(n) ?? null },
    async writeAsset(n, d) { assets.set(n, d instanceof Blob ? d : new Blob([d as BlobPart])) },
    async listAssets(): Promise<AssetInfo[]> { return [...assets].map(([name, b]) => ({ name, size: b.size, lastModified: 1, type: b.type })) },
    async deleteAsset(n) { assets.delete(n) },
    watch: () => () => {},
  }
}

const sample = (): VideoDoc => ({
  ...emptyVideoDoc('旅行'),
  media: [
    { id: 'm1', name: 'beach.mp4', kind: 'video', duration: 12.5, file: 'beach.mp4' },
    { id: 'm2', name: 'song.mp3', kind: 'audio', duration: 30, file: 'song.mp3' },
    { id: 'm3', name: 'unused.png', kind: 'image', duration: 0, file: 'unused.png' },
  ],
  tracks: [
    { id: 't1', kind: 'text', locked: false, hidden: false, muted: false, clips: [{ id: 'c3', mediaId: '', start: 1, length: 2, offset: 0, text: { content: 'Hello', x: 0.5, y: 0.8, size: 0.1 } }] },
    { id: MAIN_LANE, kind: 'visual', locked: false, hidden: false, muted: false, clips: [
      { id: 'c1', mediaId: 'm1', start: 0, length: 4, offset: 2, fx: [{ fx: 'fx-shake', strength: 1 }] },
      { id: 'c2', mediaId: 'm1', start: 4, length: 3, offset: 8 },
    ] },
    { id: 'a1', kind: 'audio', locked: false, hidden: false, muted: false, clips: [{ id: 'c4', mediaId: 'm2', start: 0, length: 7, offset: 0, volume: 0.6 }] },
  ],
})

let n = 0, bad = 0
async function test(name: string, fn: () => unknown) {
  try { await fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}

void (async () => {
  await test('A 存了再读回来一模一样（含文字、特效、音量）', async () => {
    const s = memStore(), d = sample()
    // 示范里用的特效编号要真的在库里（不在库里会被读档丢掉·题就不准了）
    const fx = (await import('./lib/fx.data')).FX_ITEMS.find((x) => x.kind === 'effect')!.id
    ;(d.tracks[1].clips[0].fx as { fx: string }[])[0].fx = fx
    await saveVideoDoc(s, d)
    const back = await loadVideoDoc(s)
    assert.deepEqual(back.drops, [])
    assert.ok(sameDoc(back, d), '读回来跟存进去的不同')
    assert.deepEqual(docToJson(back), docToJson(d))
  })

  await test('B project.json 表头在最前·缩排 2 格（AI 好读好改）', async () => {
    const s = memStore()
    await saveVideoDoc(s, sample())
    const raw = s.raw()!
    assert.match(raw, /^\{\n {2}"format": "dilin-studio\/video",\n {2}"version": 1,\n {2}"name": "旅行"/)
  })

  await test('C 外面改了 project.json（挪片段、加素材）⇒ 读回来就是改后的样子', async () => {
    const s = memStore()
    await saveVideoDoc(s, sample())
    const j = JSON.parse(s.raw()!)
    j.tracks.find((l: { id: string }) => l.id === MAIN_LANE).clips[1].start = 5
    j.media.push({ id: 'm9', name: 'new.jpg', kind: 'image', duration: 0, file: 'new.jpg' })
    j.tracks.find((l: { id: string }) => l.id === MAIN_LANE).clips.push({ id: 'c9', mediaId: 'm9', start: 8, length: 3, offset: 0 })
    s.setRaw(JSON.stringify(j))
    const back = await loadVideoDoc(s)
    assert.deepEqual(back.drops, [])
    const main = back.tracks.find((l) => l.id === MAIN_LANE)!
    assert.equal(main.clips[1].start, 5)
    assert.equal(main.clips[2].mediaId, 'm9')
    assert.equal(back.media.find((m) => m.id === 'm9')?.file, 'new.jpg')
  })

  await test('D 素材没有 file 或档名带斜线 ⇒ 那份素材连同用到它的片段丢掉、说明原因', async () => {
    const j = docToJson(sample()) as { media: Record<string, unknown>[] }
    delete j.media[0].file
    j.media[1].file = '../etc/passwd'
    const back = docFromJson(j)
    assert.deepEqual(back.media.map((m) => m.id), ['m3'])
    assert.equal(back.tracks.find((l) => l.id === MAIN_LANE)!.clips.length, 0)
    assert.equal(back.tracks.find((l) => l.id === 'a1')!.clips.length, 0)
    assert.deepEqual(back.drops.filter((d) => d.code === 'media_bad_file').map((d) => (d as { id: string }).id), ['m1', 'm2'])
  })

  await test('E 云盘栏位（driveId／cloudProxy／from=drive）读时丢掉·素材照常用', async () => {
    const j = docToJson(sample()) as { media: Record<string, unknown>[] }
    j.media[0].from = 'drive'
    j.media[0].driveId = '11111111-2222-3333-4444-555555555555'
    j.media[0].cloudProxy = { of: 'x' }
    const back = docFromJson(j)
    assert.deepEqual(back.drops, [])
    assert.deepEqual(Object.keys(back.media[0]).sort(), ['duration', 'file', 'id', 'kind', 'name'])
    assert.ok(!JSON.stringify(docToJson(back)).includes('driveId'))
  })

  await test('F 表头不对 ⇒ bad_format；版本比这版新 ⇒ too_new', async () => {
    const s = memStore()
    s.setRaw(JSON.stringify({ format: 'dilin-studio/sheets', version: 1 }))
    await assert.rejects(loadVideoDoc(s), (e) => isStudioError(e, 'bad_format'))
    s.setRaw(JSON.stringify({ format: 'dilin-studio/video', version: 2 }))
    await assert.rejects(loadVideoDoc(s), (e) => isStudioError(e, 'too_new'))
  })

  await test('G 没有 project.json ⇒ 空工程（只有主轨）', async () => {
    const d = await videoFormat.load(memStore())
    assert.deepEqual(d.tracks.map((l) => l.id), [MAIN_LANE])
    assert.deepEqual(d.media, [])
  })

  await test('H 只打包用到的：没上轨的素材不带·编曲分轨跟着母档走', () => {
    const d = sample()
    d.media.push({ id: 'm4', name: 'vocal.wav', kind: 'audio', duration: 30, file: 'vocal.wav', stemOf: 'm2' })
    d.media[1].stems = ['m4']
    assert.deepEqual([...usedMediaIds(d)].sort(), ['m1', 'm2', 'm4'])
    assert.deepEqual(pruneUnusedMedia(d).media.map((m) => m.id), ['m1', 'm2', 'm4'])
  })

  await test('I 素材档名：撞名加 (2)·斜线换掉·太长截短但留副档名', () => {
    assert.equal(assetNameFor('a.mp4', new Set()), 'a.mp4')
    assert.equal(assetNameFor('a.mp4', new Set(['a.mp4', 'a (2).mp4'])), 'a (3).mp4')
    assert.equal(assetNameFor('x/y\\z.png', new Set()), 'x_y_z.png')
    const long = assetNameFor('甲'.repeat(300) + '.mov', new Set())
    assert.ok(long.length <= 200 && long.endsWith('.mov'))
    assert.equal(assetNameFor('..', new Set()), 'media')
  })

  await test('J 给 AI 的格式重点：三语都有、陆版不写境外服务名', () => {
    for (const l of ['zh-TW', 'zh-CN', 'en'] as const) assert.match(videoFormat.summaryForAI(l), /dilin-studio\/video/)
    assert.doesNotMatch(videoFormat.summaryForAI('zh-CN'), /Claude|ChatGPT|GitHub|Google|OpenAI|Codex/i)
  })

  await test('K 读不懂的条目回代码：编辑器按界面语言写一句（三语齐、参数都填得进去）；登入版那串中文照旧', () => {
    const j = docToJson(sample()) as { media: Record<string, unknown>[]; tracks: Record<string, unknown>[] }
    j.media.push({ id: 'm9', kind: 'hologram', file: 'x.bin' })
    j.media.push(7 as unknown as Record<string, unknown>)
    ;(j.tracks.find((l) => l.id === 'a1')!.clips as Record<string, unknown>[]).push({ id: 'c9', mediaId: 'nope', start: 20, length: 1, offset: 0 })
    const back = docFromJson(j)
    assert.deepEqual(back.drops.map((d) => d.code).sort(), ['clip_no_media', 'media_bad_kind', 'media_not_object'])
    for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
      const dict = VIDEO_I18N[lang] as Record<string, string>
      const t = (k: string, v?: Record<string, string | number>) => (dict[k] ?? `?${k}`).replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? `{${x}}`))
      for (const [code, key] of Object.entries(DROP_KEY)) assert.ok(dict[key], `${lang} 缺 ${code}`)
      for (const d of back.drops) { const line = dropText(t, d); assert.doesNotMatch(line, /\{|\?vedit/, `${lang} ${d.code} 有没填的参数：${line}`) }
      assert.match(dropText(t, { code: 'clip_no_body', id: 'c1', body: 'text' }), /c1.*text/)
    }
    // 药：少一种代码的字 ⇒ 红
    const bad = { ...(VIDEO_I18N.en as Record<string, string>) }; delete bad[DROP_KEY.clip_overlap]
    assert.ok(!Object.values(DROP_KEY).every((k) => bad[k]))
    // 登入版（服务端回角色的那句）字不变
    const r = parseProject({ media: [{ id: 'm1', kind: 'x' }], tracks: [{ id: 'main', kind: 'visual', clips: [{ id: 'c1', mediaId: 'zz', start: 0, length: 1 }] }] })
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual(r.drops, ['素材 m1 的 kind 要是 video／audio／image', '片段 c1 指到的素材不在素材清单里'])
    assert.equal(dropZh({ code: 'group_renamed', old: 'a', group: 'b' }), '舊副本群組 a 已換成相容編號 b，成員保持不變')
  })

  console.log(bad ? `studio-video format：${n}/${n + bad} 过` : `studio-video format → ${n} 过`)
  if (bad) process.exit(1)
})()
