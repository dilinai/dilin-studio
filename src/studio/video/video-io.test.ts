// 剪辑 EDL／OTIO 汇入汇出、字幕 ASS 读与 VTT／ASS 写、CapCut 草稿（lib/edl.pure、otio.pure、subtitle-io.pure、import-project.pure）＋接线。
// E1 EDL 来回：主轨（B＝带声音、慢放 M2、图片）、音频轨 A2、录制时间从 01:00:00:00；文字、上层画面、停用、音量列 notes；
// E2 Premiere 写法的 EDL：FCM DROP（29.97）、画面 V 与声音 A／A2 分开写（并回画面）、D 叠化（TO CLIP NAME）、M2 倒放、BL 黑场跳过；
// E3 OTIO 来回（文字写成 Gap＋metadata·达芬奇当空档）：三段主轨（音量、0.5 倍、静音停用）、上层图片轨、文字（字、颜色、对齐）、音频轨音量、画幅；影片自带声音并回画面；
// E4 达芬奇写法的 OTIO：Clip.1＋media_reference、24fps 带时间码起点的 available_range、Transition、巢状 Stack、FreezeFrame 进 notes；
// E5 字幕：ASS 读（Format 顺序、逗号、{\…} 标记、\N）、parseSubtitles 认得 ASS；VTT／ASS 写出再读回同几句、同时间；
// E6 接线：detectProjectFile 认 .edl／.otio；cliExport 九种格式；cliAddSubtitles；CapCut 平台栏；剪辑页选档认字幕与 EDL／OTIO；汇出对话框 VTT／ASS；
//    单机右栏多 .otio／.edl；勾选项与三语字齐；video-cli 有 subs 与九种 --format。
// 跑法（在 studio 根目录）：node -e "require('sucrase/register/ts');require('./video/video-io.test.ts')"
// E2b FCP7／OTIO 写法 xmeml：声音轨只写 <clipitem id/> 指回画面 ⇒ 并回、不静音；
// 负控：EDL 不换 M2 速度 ⇒ E1／E2 红；xmeml 不认 id 指回 ⇒ E2b 红；OTIO 自带声音不并回 ⇒ E3 红；parseAss 不跳过 Format 定的栏位 ⇒ E5 红；cliExport 拿掉 otio 分支 ⇒ E6 红。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { docToEdl } from './lib/edl.pure'
import { docToOtio } from './lib/otio.pure'
import { parseAss, tracksToAss, tracksToVtt } from './lib/subtitle-io.pure'
import { parseSubtitles } from './lib/text.pure'
import { docToJianying } from './lib/jianying.pure'
import { detectProjectFile, importEdl, importOtio, importProject, type ImportedProject } from './lib/import-project.pure'
import { CLI_EXPORT_FORMATS, cliAddSubtitles, cliExport } from './cli-core'
import { parseProjectIssues } from './lib/project.pure'
import { VIDEO_I18N } from './i18n'
import type { VideoDoc } from './format'
import type { TlClip } from './lib/timeline.pure'

let failed = 0, total = 0
const ok = (n: string, f: () => void) => { total++; try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
const lane = (id: string, kind: string, clips: unknown[]) => ({ id, kind, locked: false, hidden: false, muted: false, clips })
const MEDIA = [
  { id: 'm1', name: '我的 片.mp4', kind: 'video', duration: 12, from: 'local', file: '我的 片.mp4' },
  { id: 'm2', name: 'song.mp3', kind: 'audio', duration: 30, from: 'local', file: 'song.mp3' },
  { id: 'm3', name: 'logo.png', kind: 'image', duration: 0, from: 'local', file: 'logo.png' },
]
const doc = (tracks: unknown[], ratio: unknown = { kind: 'custom', w: 1470, h: 630 }) => {
  const r = parseProjectIssues({ ratio, media: MEDIA, tracks })
  if (!r.ok) throw new Error('parse')
  const byId = new Map(MEDIA.map((m) => [m.id, m.file]))
  return { name: 'T', ...r.project, media: r.project.media.map((m) => ({ ...m, file: byId.get(m.id)! })) } as unknown as VideoDoc
}
const SAMPLE = () => doc([
  lane('t', 'text', [{ id: 'x', mediaId: '', start: 0.5, length: 3, offset: 0, text: { content: '測試, A&B', x: 0.5, y: 0.5, size: 0.1, color: '#ff8000', align: 'left' } }]),
  lane('up', 'visual', [{ id: 'k', mediaId: 'm3', start: 1, length: 2, offset: 0 }]),
  lane('main', 'visual', [
    { id: 'a', mediaId: 'm1', start: 0, length: 3, offset: 0, volume: 0.5 },
    { id: 'b', mediaId: 'm1', start: 3, length: 4, offset: 2, speed: 0.5 },
    { id: 'c', mediaId: 'm1', start: 7, length: 2, offset: 1, muted: true, disabled: true },
    { id: 'd', mediaId: 'm3', start: 9, length: 1, offset: 0 },
  ]),
  lane('au', 'audio', [{ id: 's', mediaId: 'm2', start: 1, length: 4, offset: 0.5, volume: 0.25 }]),
])
const near = (a: number, b: number, eps = 1 / 30 + 1e-6, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} ≠ ${b}`)
const main = (p: ImportedProject) => p.tracks.find((l) => l.id === 'main')!.clips as TlClip[]
const byFile = (p: ImportedProject, f: string) => p.media.find((m) => m.file === f)!
const clean = (p: ImportedProject) => {
  const media = p.media.map((m) => ({ id: m.key, name: m.name, kind: m.kind, duration: m.duration || 60, from: 'local' }))
  const chk = parseProjectIssues({ ratio: p.ratio, tracks: p.tracks, media })
  assert.ok(chk.ok); if (chk.ok) assert.deepEqual(chk.issues, [])
}

ok('E1 EDL 来回：主轨 B／V、M2 慢放、图片、音频轨 A2、录制从 01:00:00:00；带不过去的列 notes', () => {
  const r = docToEdl(SAMPLE())
  assert.match(r.edl, /^TITLE: T\r\nFCM: NON-DROP FRAME/)
  assert.match(r.edl, /001 {2}AX {7}B {5}C {8}00:00:00:00 00:00:03:00 01:00:00:00 01:00:03:00/)
  assert.match(r.edl, /M2 {3}AX {8}15\.0 +00:00:02:00/)
  for (const n of ['text', 'upper-lanes', 'disabled', 'volume', 'audio-only-events']) assert.ok(r.notes.includes(n), `${n}：${r.notes}`)
  const p = importEdl(r.edl, 'T.edl')
  assert.equal(p.app, 'edl'); assert.equal(p.name, 'T')
  const [a, b, d] = main(p)
  assert.equal(main(p).length, 3)
  const m1 = byFile(p, '我的 片.mp4')
  assert.equal(m1.kind, 'video'); assert.equal(m1.path, 'assets/我的 片.mp4')
  assert.equal(a.mediaId, m1.key); near(a.start, 0); near(a.length, 3); near(a.offset, 0); assert.ok(!a.muted)
  near(b.start, 3); near(b.length, 4); near(b.offset, 2); assert.equal(b.speed, 0.5)
  assert.equal(byFile(p, 'logo.png').kind, 'image'); near(d.start, 9); near(d.length, 1)
  const au = p.tracks.filter((l) => l.kind === 'audio')
  assert.equal(au.length, 1); near(au[0].clips[0].start, 1); near(au[0].clips[0].length, 4); near(au[0].clips[0].offset, 0.5)
  assert.equal(byFile(p, 'song.mp3').kind, 'audio')
  clean(p)
  assert.match(docToEdl(SAMPLE(), { assetBase: 'file:///D:/proj/assets/' }).edl, /\* SOURCE FILE: D:\/proj\/assets\/我的 片\.mp4/)
})

const PR_EDL = `TITLE: 粗剪
FCM: DROP FRAME

001  BL       V     C        00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00

002  AX       V     C        00:00:10:00 00:00:14:00 00:00:01:00 00:00:05:00
* FROM CLIP NAME:  a.mp4
* SOURCE FILE: D:\\Pr\\a.mp4
002  AX       A     C        00:00:10:00 00:00:14:00 00:00:01:00 00:00:05:00
* FROM CLIP NAME:  a.mp4
002  AX       A2    C        00:00:10:00 00:00:14:00 00:00:01:00 00:00:05:00
* FROM CLIP NAME:  a.mp4

003  AX       V     C        00:00:20:00 00:00:20:00 00:00:05:00 00:00:05:00
003  AX       V     D    030 00:01:00:00 00:01:04:00 00:00:05:00 00:00:07:00
M2   AX       -059.9                00:01:00:00
* FROM CLIP NAME:  a.mp4
* TO CLIP NAME:  b.mov

004  AX       A3    C        00:00:00:00 00:00:06:00 00:00:00:00 00:00:06:00
* FROM CLIP NAME:  music.wav
`
ok('E2 Premiere 写法 EDL：丢帧时基、V／A／A2 分开写并回、D 叠化接 TO CLIP、M2 倒放、BL 跳过', () => {
  assert.equal(detectProjectFile('x.txt', PR_EDL), 'edl')
  const p = importProject('粗剪.edl', PR_EDL)
  const fps = 30000 / 1001
  const [a, b] = main(p)
  assert.equal(main(p).length, 2)
  assert.equal(byFile(p, 'a.mp4').path, 'D:\\Pr\\a.mp4')
  near(a.start, 30 / fps, 1e-6); near(a.length, 120 / fps, 1e-6); near(a.offset, 300 / fps, 1e-6); assert.ok(!a.muted, 'A／A2 并回画面')
  assert.equal(b.mediaId, byFile(p, 'b.mov').key); near(b.start, 150 / fps, 1e-6); near(b.length, 60 / fps, 1e-6); assert.equal(b.reverse, true); assert.equal(b.speed, 2)
  assert.ok(b.muted, '没有对应声音的影片段静音')
  const au = p.tracks.filter((l) => l.kind === 'audio').flatMap((l) => l.clips)
  assert.equal(au.length, 1); assert.equal(au[0].mediaId, byFile(p, 'music.wav').key); near(au[0].length, 180 / fps, 1e-6)
  assert.ok(p.notes.includes('transition'))
  clean(p)
})

ok('E2b FCP7／OTIO 写法 xmeml：声音轨只写 <clipitem id/> 指回画面那段 ⇒ 当成自带声音、不静音', () => {
  const X = `<?xml version="1.0"?><xmeml version="4"><sequence><name>S</name><rate><timebase>30</timebase></rate><media><video><track>
<clipitem id="clipitem-1"><name>a.mp4</name><start>0</start><end>90</end><in>0</in><out>90</out><file id="file-1"><name>a.mp4</name><pathurl>file:///x/a.mp4</pathurl><duration>300</duration><media><video/><audio/></media></file></clipitem>
</track></video><audio><track><clipitem id="clipitem-1"/></track><track><clipitem id="clipitem-2"><name>m.wav</name><start>0</start><end>60</end><in>0</in><out>60</out><file id="file-2"><name>m.wav</name><pathurl>file:///x/m.wav</pathurl><media><audio/></media></file></clipitem></track></audio></media></sequence></xmeml>`
  const p = importProject('s.xml', X)
  const [a] = main(p)
  assert.ok(!a.muted, '指回画面那段的声音并回'); near(a.length, 3)
  assert.equal(p.tracks.filter((l) => l.kind === 'audio').flatMap((l) => l.clips).length, 1)
})

ok('E3 OTIO 来回：主轨三段＋图片、上层图片、文字、音频轨音量、画幅；自带声音并回', () => {
  const r = docToOtio(SAMPLE())
  const j = JSON.parse(r.otio)
  assert.equal(j.OTIO_SCHEMA, 'Timeline.1')
  const kinds = j.tracks.children.map((t: { kind: string; name: string }) => `${t.name}:${t.kind}`)
  assert.deepEqual(kinds, ['V1:Video', 'V2:Video', 'V3:Video', 'A1:Audio', 'A2:Audio'])
  // 文字写成 Gap（达芬奇不认文字产生器·会变离线块）：整份没有 GeneratorReference
  assert.ok(!r.otio.includes('GeneratorReference'))
  assert.equal(j.tracks.children[2].children.find((x: { metadata: { dilin?: unknown } }) => x.metadata.dilin).OTIO_SCHEMA, 'Gap.1')
  const p = importOtio(r.otio, 'T.otio')
  assert.equal(p.app, 'otio'); assert.deepEqual(p.ratio, { kind: 'custom', w: 1470, h: 630 })
  const [a, b, c, d] = main(p)
  assert.equal(main(p).length, 4)
  near(a.start, 0); near(a.length, 3); assert.equal(a.volume, 0.5); assert.ok(!a.muted)
  near(b.start, 3); near(b.offset, 2); assert.equal(b.speed, 0.5)
  near(c.start, 7); near(c.offset, 1); assert.equal(c.muted, true); assert.equal(c.disabled, true)
  near(d.start, 9); assert.equal(d.mediaId, byFile(p, 'logo.png').key)
  const mi = p.tracks.findIndex((l) => l.id === 'main')
  assert.equal(p.tracks[0].kind, 'text'); assert.equal(p.tracks[1].kind, 'visual'); assert.equal(mi, 2)
  const t = p.tracks[0].clips[0].text!
  assert.equal(t.content, '測試, A&B'); assert.equal(t.color, '#ff8000'); assert.equal(t.align, 'left'); near(t.size, 0.1, 1e-9)
  const au = p.tracks.slice(mi + 1)
  assert.equal(au.length, 1, '自带声音不另开音轨'); near(au[0].clips[0].start, 1); near(au[0].clips[0].offset, 0.5); assert.equal(au[0].clips[0].volume, 0.25)
  clean(p)
})

const RESOLVE_OTIO = JSON.stringify({
  OTIO_SCHEMA: 'Timeline.1', name: 'Resolve 片', global_start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 86400 }, metadata: {},
  tracks: { OTIO_SCHEMA: 'Stack.1', name: '', children: [
    { OTIO_SCHEMA: 'Track.1', name: 'Video 1', kind: 'Video', children: [
      { OTIO_SCHEMA: 'Clip.1', name: 'A001.mov', source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 86448 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 48 } },
        media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'file:///Volumes/Media/A001.mov', available_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 86400 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 480 } } }, effects: [], markers: [], metadata: {} },
      { OTIO_SCHEMA: 'Transition.1', name: 'Cross Dissolve', in_offset: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 12 }, out_offset: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 12 } },
      { OTIO_SCHEMA: 'Gap.1', name: '', source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 0 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 24 } } },
      { OTIO_SCHEMA: 'Clip.1', name: 'A001.mov', source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 86400 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 24 } },
        media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'file:///Volumes/Media/A001.mov', available_range: null }, effects: [{ OTIO_SCHEMA: 'FreezeFrame.1', name: '', time_scalar: 0 }], markers: [], metadata: {} },
      { OTIO_SCHEMA: 'Stack.1', name: 'Compound', children: [], source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 0 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 24 } } },
    ] },
    { OTIO_SCHEMA: 'Track.1', name: 'Audio 1', kind: 'Audio', children: [
      { OTIO_SCHEMA: 'Clip.1', name: 'A001.mov', source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 86448 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 48 } },
        media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'file:///Volumes/Media/A001.mov', available_range: null }, effects: [], markers: [], metadata: {} },
      { OTIO_SCHEMA: 'Clip.1', name: 'bgm.wav', source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 48000, value: 0 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 48000, value: 96000 } },
        media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'file:///Volumes/Media/bgm.wav', available_range: null }, effects: [], markers: [], metadata: {} },
    ] },
  ] },
})
ok('E4 达芬奇写法 OTIO：Clip.1、时间码起点、Transition 不占时间、Gap、巢状 Stack 与定格进 notes', () => {
  assert.equal(detectProjectFile('x.json', RESOLVE_OTIO), 'otio')
  const p = importProject('x.otio', RESOLVE_OTIO)
  assert.equal(p.name, 'Resolve 片')
  const [a, b] = main(p)
  assert.equal(main(p).length, 2)
  assert.equal(byFile(p, 'A001.mov').path, '/Volumes/Media/A001.mov')
  near(a.start, 0, 1e-9); near(a.length, 2, 1e-9); near(a.offset, 2, 1e-9, '入点＝start−available 起点'); assert.ok(!a.muted)
  near(b.start, 3, 1e-9); near(b.length, 1, 1e-9); near(b.offset, 0, 1e-9, '借同素材的时间码起点'); assert.ok(b.muted, '画面没对上声音 ⇒ 静音')
  const au = p.tracks.filter((l) => l.kind === 'audio').flatMap((l) => l.clips)
  assert.equal(au.length, 1); near(au[0].start, 2, 1e-9); near(au[0].length, 2, 1e-9); assert.equal(byFile(p, 'bgm.wav').kind, 'audio')
  for (const n of ['transition', 'freeze', 'compound']) assert.ok(p.notes.includes(n), `${n}：${p.notes}`)
  clean(p)
})

const ASS = `[Script Info]
Title: x
PlayResX: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,50

[Events]
Format: Start, End, Style, Text
Comment: 0:00:00.00,0:00:01.00,Default,不算
Dialogue: 0:00:01.50,0:00:03.00,Default,{\\an8\\c&H00FF00&}第一句，有逗號, 還有
Dialogue: 0:00:00.20,0:00:01.00,Default,上\\N下\\h行
Dialogue: 1:00:00.00,0:00:01.00,Default,倒著的丟掉
`
ok('E5 字幕：ASS 读、parseSubtitles 认 ASS；VTT／ASS 写出再读回', () => {
  const cues = parseAss(ASS)
  assert.deepEqual(cues, [{ start: 0.2, end: 1, text: '上\n下 行' }, { start: 1.5, end: 3, text: '第一句，有逗號, 還有' }])
  assert.deepEqual(parseSubtitles('\uFEFF' + ASS), cues)
  const d = SAMPLE()
  d.tracks[0].clips.push({ id: 'y', mediaId: '', start: 5, length: 1.25, offset: 0, text: { content: '第二\n行', x: 0.5, y: 0.88, size: 0.055 } } as TlClip)
  const vtt = tracksToVtt(d.tracks)
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:00\.500 --> 00:00:03\.500\n測試, A&B\n/)
  assert.deepEqual(parseSubtitles(vtt).map((c) => [c.start, c.end, c.text]), [[0.5, 3.5, '測試, A&B'], [5, 6.25, '第二\n行']])
  const ass = tracksToAss(d.tracks, { w: 1470, h: 630 }, { title: 'T' })
  assert.match(ass, /PlayResX: 1470\nPlayResY: 630/)
  assert.match(ass, /Dialogue: 0,0:00:00\.50,0:00:03\.50,Default,,0,0,0,,\{\\an5\\pos\(735,315\)\\fs63\\c&H0080FF&\}測試, A&B/)
  assert.match(ass, /Dialogue: 0,0:00:05\.00,0:00:06\.25,Default,,0,0,0,,第二\\N行\n/)
  assert.deepEqual(parseAss(ass).map((c) => [c.start, c.end, c.text]), [[0.5, 3.5, '測試, A&B'], [5, 6.25, '第二\n行']])
  assert.equal(tracksToVtt(doc([lane('main', 'visual', [])]).tracks), '')
})

ok('E6 接线：认档、cliExport 九种、cliAddSubtitles、CapCut、剪辑页、汇出对话框、单机右栏、勾选、三语、video-cli', () => {
  assert.equal(detectProjectFile('cut.edl', ''), 'edl'); assert.equal(detectProjectFile('cut.otio', ''), 'otio')
  assert.deepEqual([...CLI_EXPORT_FORMATS], ['fcpxml', 'premiere', 'jianying', 'capcut', 'edl', 'otio', 'srt', 'vtt', 'ass'])
  const names = CLI_EXPORT_FORMATS.map((f) => cliExport(SAMPLE(), f).files.map((x) => x.name).join('+'))
  assert.deepEqual(names, ['T.fcpxml', 'T.xml', 'draft_content.json+draft_meta_info.json', 'draft_content.json+draft_meta_info.json', 'T.edl', 'T.otio', 'T.srt', 'T.vtt', 'T.ass'])
  assert.equal(importProject('T.otio', cliExport(SAMPLE(), 'otio').files[0].text).app, 'otio')
  const cc = JSON.parse(cliExport(SAMPLE(), 'capcut').files[0].text) as { platform: { app_source: string } }
  assert.equal(cc.platform.app_source, 'cc')
  assert.equal((docToJianying(SAMPLE()).content.platform as { app_source: string }).app_source, 'lv')
  const s = cliAddSubtitles(doc([lane('main', 'visual', [])]), new TextEncoder().encode(ASS))
  assert.equal(s.n, 2); assert.equal(s.doc.tracks.filter((l) => l.kind === 'text').flatMap((l) => l.clips).length, 2)
  const P = readFileSync(join(__dirname, 'page', 'VideoEditPage.tsx'), 'utf8')
  assert.match(P, /const subs = all\.filter\(\(f\) => \/\\\.\(srt\|vtt\|ass\|ssa\)\$\/i\.test\(f\.name\)\)/)
  assert.match(P, /\/\\\.\(fcpxml\|xml\|json\|bak\|edl\|otio\)\$\/i\.test\(f\.name\)/)
  assert.match(P, /importSubsRef\.current = importSubtitles/)
  assert.match(readFileSync(join(__dirname, 'ui', 'AssetTabs.tsx'), 'utf8'), /accept="\.srt,\.vtt,\.ass,\.ssa/)
  const E = readFileSync(join(__dirname, 'ui', 'ExportDialog.tsx'), 'utf8')
  assert.match(E, /\['wav', 'srt', 'vtt', 'ass', 'png'\] as const/)
  assert.match(E, /tracksToAss\(env\.tracks, size,/)
  const X = readFileSync(join(__dirname, 'export-project.ts'), 'utf8')
  assert.match(X, /return \[fcpxmlFile\(doc\), premiereFile\(doc\), otioFile\(doc\), edlFile\(doc\)\]/)
  assert.match(readFileSync(join(__dirname, 'index.ts'), 'utf8'), /\{ id: EXPORT_OTIO, label: 'vedit_guest_export_otio' \},\n {4}\{ id: EXPORT_EDL, label: 'vedit_guest_export_edl' \}/)
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
    const d = VIDEO_I18N[lang] as Record<string, string>
    for (const k of ['vedit_export_vtt', 'vedit_export_ass', 'vedit_guest_export_otio', 'vedit_guest_export_edl']) assert.ok(d[k], `${lang} ${k}`)
    assert.match(d.vedit_sub_none, /ASS/)
  }
  const cli = join(__dirname, '..', '..', '..', 'scripts', 'studio-oss-template', 'tools', 'video-cli.mjs')
  if (existsSync(cli)) { const c = readFileSync(cli, 'utf8'); assert.match(c, /if \(o\.cmd === 'subs'\) \{/); assert.match(c, /core\.CLI_EXPORT_FORMATS\.includes\(o\.format\)/) }
})

console.log(failed ? `studio-video io：${total - failed}/${total} 过` : `studio-video io → ${total} 过`)
if (failed) process.exitCode = 1
