// 剪辑 ⇒ Premiere XML（FCP7 xmeml·lib/xmeml.pure.ts）＋接线（汇出勾选、单机右栏、命令列 --format premiere）。
// P1 24fps 相接片段：每段 start＝上一段 end（没有 1 帧空档）、V1＝主轨、序列 30fps 与工程宽高；
// P2 0.5 倍定速：Time Remap speed 50、in／out 在变速后的格上（out−in＝end−start）；
// P3 影片自带声音进 A1、跟画面 link 成一对；音频轨的片段带 Audio Levels（线性倍数）；静音＝0；停用＝enabled FALSE；
// P4 文字片段成 Text generator（字、字级÷1.83、颜色、对齐、位置 origin＝中心为 0、垂直往下补 0.75 字高）；贴纸列 notes 不进时间线；
// P5 assetBase ⇒ pathurl file://localhost/ 绝对路径（中文档名编码）；没给 ⇒ assets/<档名>；画面区、声音区各写一次整份 <file>（同 id·达芬奇先读声音区）；
// P6 接线：汇出勾选 premiere ⇒ zip 根目录多 <名>.xml；单机右栏回 .fcpxml＋.xml；cliExport premiere；三语字齐。
// 跑法（在 studio 根目录）：node -e "require('sucrase/register/ts');require('./video/xmeml.test.ts')"
// 负控：拿掉 origin ⇒ P4 红；拿掉 PR_TEXT_SCALE／PR_TEXT_DROP ⇒ P4 红；lenOf 改回 fr(c.length) ⇒ P1 红；拿掉 timeRemap ⇒ P2 红；拿掉 link ⇒ P3 红；cliExport 去掉 premiere 分支 ⇒ P6 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { docToXmeml } from './lib/xmeml.pure'
import { cliExport } from './cli-core'
import { parseProjectIssues } from './lib/project.pure'
import { VIDEO_I18N } from './i18n'
import { STICKERS } from './lib/stickers.data'
import type { VideoDoc } from './format'

let failed = 0
const ok = (n: string, f: () => void) => { try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
const lane = (id: string, kind: string, clips: unknown[]) => ({ id, kind, locked: false, hidden: false, muted: false, clips })
const MEDIA = [
  { id: 'm1', name: '我的 片.mp4', kind: 'video', duration: 12, from: 'local', file: '我的 片.mp4' },
  { id: 'm2', name: 'song.mp3', kind: 'audio', duration: 30, from: 'local', file: 'song.mp3' },
]
const doc = (tracks: unknown[], ratio: unknown = { kind: 'custom', w: 1470, h: 630 }) => {
  const r = parseProjectIssues({ ratio, media: MEDIA, tracks })
  if (!r.ok) throw new Error('parse')
  const byId = new Map(MEDIA.map((m) => [m.id, m.file]))
  return { name: 'T', ...r.project, media: r.project.media.map((m) => ({ ...m, file: byId.get(m.id)! })) } as unknown as VideoDoc
}
const items = (xml: string, tag = 'clipitem') => [...xml.matchAll(new RegExp(`<${tag} id="[^"]+">([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])
const num = (x: string, k: string) => +(new RegExp(`<${k}>(-?\\d+)</${k}>`).exec(x) ?? [])[1]
const videoPart = (xml: string) => xml.slice(xml.indexOf('\n<video>\n'), xml.indexOf('\n</video>\n'))
const audioPart = (xml: string) => xml.slice(xml.indexOf('\n<audio>\n'), xml.indexOf('\n</audio>\n'))

ok('P1 24fps 相接片段：start 接上一段 end、主轨在 V1、序列 30fps 与工程宽高', () => {
  const clips = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, mediaId: 'm1', start: i * (41 / 24), length: 41 / 24, offset: 0 }))
  const { xml } = docToXmeml(doc([lane('top', 'visual', [{ id: 'k', mediaId: 'm1', start: 1, length: 1, offset: 0 }]), lane('main', 'visual', clips)]))
  assert.match(xml, /^<\?xml[\s\S]*<!DOCTYPE xmeml>\n<xmeml version="4">/)
  assert.match(xml, /<sequence id="sequence-1">\n<name>T<\/name>\n<duration>\d+<\/duration>\n<rate><timebase>30<\/timebase><ntsc>FALSE<\/ntsc><\/rate>/)
  assert.match(xml, /<width>1470<\/width><height>630<\/height>/)
  const v1 = items(videoPart(xml).split('<track>')[1])
  assert.equal(v1.length, 6, 'V1 是主轨那 6 段')
  for (let i = 1; i < v1.length; i++) assert.equal(num(v1[i], 'start'), num(v1[i - 1], 'end'), `第 ${i} 段跟前一段之间有空档`)
  assert.equal(items(videoPart(xml).split('<track>')[2]).length, 1, 'V2 是主轨上面那轨')
})

ok('P2 0.5 倍定速：Time Remap speed 50、out−in＝end−start、in 在变速后的格上', () => {
  const { xml } = docToXmeml(doc([lane('main', 'visual', [{ id: 'c1', mediaId: 'm1', start: 0, length: 20, offset: 2, speed: 0.5 }])]))
  const v = items(videoPart(xml))[0]
  assert.match(v, /<effectid>timeremap<\/effectid>[\s\S]*<parameterid>speed<\/parameterid><name>speed<\/name><valuemin>-100000<\/valuemin><valuemax>100000<\/valuemax><value>50<\/value>/)
  assert.equal(num(v, 'in'), 120)
  assert.equal(num(v, 'out') - num(v, 'in'), num(v, 'end') - num(v, 'start'))
  assert.equal(num(v, 'end'), 600)
})

ok('P3 影片自带声音进 A1 并 link；音频轨带 Audio Levels；静音 0；停用 enabled FALSE', () => {
  const { xml } = docToXmeml(doc([
    lane('main', 'visual', [{ id: 'a', mediaId: 'm1', start: 0, length: 3, offset: 0, volume: 0.5 }, { id: 'b', mediaId: 'm1', start: 3, length: 2, offset: 3, muted: true, disabled: true }]),
    lane('au', 'audio', [{ id: 's', mediaId: 'm2', start: 1, length: 4, offset: 0, volume: 0.25 }]),
  ]))
  const v = items(videoPart(xml)), aTracks = audioPart(xml).split('<track>').slice(1).map((t) => items(t))
  assert.equal(aTracks.length, 2, 'A1＝主轨带的声音，A2＝音频轨')
  assert.equal(aTracks[0].length, 2)
  const vId = /<linkclipref>(clipitem-\d+)<\/linkclipref><mediatype>video/.exec(v[0])![1], aId = /<linkclipref>(clipitem-\d+)<\/linkclipref><mediatype>audio/.exec(v[0])![1]
  assert.match(xml, new RegExp(`<clipitem id="${vId}">`)); assert.match(xml, new RegExp(`<clipitem id="${aId}">[\\s\\S]*?<linkclipref>${vId}<`))
  assert.match(aTracks[0][0], /<effectid>audiolevels<\/effectid>[\s\S]*<value>0\.5<\/value>/)
  assert.match(aTracks[0][1], /<enabled>FALSE<\/enabled>/); assert.match(aTracks[0][1], /<parameterid>level<\/parameterid>[\s\S]*<value>0<\/value>/)
  assert.match(v[1], /<enabled>FALSE<\/enabled>/)
  assert.match(aTracks[1][0], /<name>song\.mp3<\/name>[\s\S]*<start>30<\/start><end>150<\/end>[\s\S]*<value>0\.25<\/value>/)
  assert.doesNotMatch(aTracks[1][0], /<link>/)
})

ok('P4 文字成 Text generator（字、字级、颜色、对齐）；贴纸列 notes', () => {
  const { xml, notes } = docToXmeml(doc([
    lane('t', 'text', [{ id: 'x', mediaId: '', start: 0.5, length: 3, offset: 0, text: { content: '測試 A&B', x: 0.5, y: 0.3, size: 0.1, color: '#ff8000', align: 'left' } }]),
    lane('st', 'sticker', [{ id: 'y', mediaId: '', start: 0, length: 2, offset: 0, sticker: { sticker: STICKERS[0].id, x: 0.5, y: 0.5, size: 0.3 } }]),
    lane('main', 'visual', [{ id: 'a', mediaId: 'm1', start: 0, length: 4, offset: 0 }]),
  ]))
  const g = items(xml, 'generatoritem')
  assert.equal(g.length, 1)
  assert.match(g[0], /<effectid>Text<\/effectid>[\s\S]*<parameterid>str<\/parameterid><name>str<\/name><value>測試 A&amp;B<\/value>/)
  assert.match(g[0], /<parameterid>fontsize<\/parameterid><name>fontsize<\/name><value>34<\/value>/)
  assert.match(g[0], /<red>255<\/red><green>128<\/green><blue>0<\/blue>/)
  assert.match(g[0], /<parameterid>fontalign<\/parameterid><name>fontalign<\/name><value>1<\/value>/)
  assert.match(g[0], /<parameterid>origin<\/parameterid><name>Origin<\/name><value><horiz>0<\/horiz><vert>-0\.125<\/vert><\/value>/)
  assert.ok(notes.includes('sticker'), JSON.stringify(notes))
})

ok('P5 assetBase ⇒ file://localhost/ 绝对路径（中文与空格编码）；没给 ⇒ assets/<档名>', () => {
  const d = doc([lane('main', 'visual', [{ id: 'a', mediaId: 'm1', start: 0, length: 2, offset: 0 }])])
  assert.match(docToXmeml(d, { assetBase: 'file:///D:/proj/assets/' }).xml, /<pathurl>file:\/\/localhost\/D:\/proj\/assets\/%E6%88%91%E7%9A%84%20%E7%89%87\.mp4<\/pathurl>/)
  assert.match(docToXmeml(d).xml, /<pathurl>assets\/%E6%88%91%E7%9A%84%20%E7%89%87\.mp4<\/pathurl>/)
  const x = docToXmeml(d).xml
  assert.equal((x.match(/<pathurl>/g) ?? []).length, 2, '画面区、声音区各写一次整份 <file>')
  assert.equal((x.match(/<file id="file-1">/g) ?? []).length, 2, '两份同一个 id')
})

ok('P6 接线：cliExport premiere ⇒ <名>.xml；汇出勾选与右栏挂上；三语字齐', () => {
  const d = doc([lane('main', 'visual', [{ id: 'a', mediaId: 'm1', start: 0, length: 2, offset: 0 }])])
  const r = cliExport(d, 'premiere', { assetBase: 'file:///x/assets/' })
  assert.equal(r.files.length, 1); assert.equal(r.files[0].name, 'T.xml'); assert.match(r.files[0].text, /<xmeml version="4">/)
  const I = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  assert.match(I, /\{ id: EXPORT_PREMIERE, label: 'vedit_guest_export_premiere' \}/)
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) assert.match((VIDEO_I18N[lang] as Record<string, string>).vedit_guest_export_premiere ?? '', /Premiere/)
  const E = readFileSync(join(__dirname, 'export-project.ts'), 'utf8')
  assert.match(E, /return \[fcpxmlFile\(doc\), premiereFile\(doc\)[,\]]/)
  assert.match(E, /if \(ctx\.options\.has\(EXPORT_PREMIERE\)\) extras\.push\(premiereFile\(doc\)\)/)
})

console.log(failed ? `studio-video xmeml：${6 - failed}/6 过` : 'studio-video xmeml → 6 过')
if (failed) process.exitCode = 1
