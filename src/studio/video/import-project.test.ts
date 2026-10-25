// 剪辑汇入别家工程（lib/import-project.pure.ts）＋接线（剪辑页选档、命令列 import）。
// I1 FCPXML 来回：自家汇出再读回，片段位置／长度／入点／0.5 倍速／音量／停用／文字／图片／上层画面轨／音频轨与比例都对得上；
// I2 Premiere XML 来回：同上，影片自带的声音并回画面那段（不另开音轨）、静音照回、文字成文字片段；
// I3 剪映草稿来回：同上（含声音淡入淡出、文字位置）；
// I4 Final Cut 写法：clip 包 video＋影片原声 audio、挂在片段上的上层片段与次要故事线、29.97 的分数时间、timeMap 变速、转场与滤镜进 notes、file:// 路径解码；
// I5 Premiere 写法：29.97（ntsc）、转场旁的 -1 起止接到转场中点、立体声两条原声都并回、文字 generator；加密的剪映草稿照实拒绝；
// I5b Premiere 文字工具图形（<clipitem>＋GraphicAndType·源文本是 base64 二进制）：成文字段（字、时间、左端基线换成字块中心、字级），不当缺档素材；
// I6 剪映真草稿（复合片段）：复合片段照内层草稿摊开（图片＋mkv 两段）、比例照素材 1080×1920；
// I7 接线：importedToTracks 对档、对不上的列 missing 并拿掉片段；cliImport／cliImportDoc；剪辑页选档认工程档；video-cli 有 import；三语字齐。
// 跑法（在 studio 根目录）：node -e "require('sucrase/register/ts');require('./video/import-project.test.ts')"
// 负控：fcpTime 不除分母 ⇒ I1／I4 红；xmeml 自带声音不并 ⇒ I2／I5 红；不认 GraphicAndType ⇒ I5b 红；剪映复合片段不摊开 ⇒ I6 红；importedToTracks 不拿掉对不上的 ⇒ I7 红。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { docToFcpxml } from './lib/fcpxml.pure'
import { docToXmeml } from './lib/xmeml.pure'
import { docToJianying } from './lib/jianying.pure'
import { ImportBad, detectProjectFile, importFcpxml, importJianying, importProject, importXmeml, importedToTracks, type ImportedProject } from './lib/import-project.pure'
import { cliImport, cliImportDoc } from './cli-core'
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
  lane('t', 'text', [{ id: 'x', mediaId: '', start: 0.5, length: 3, offset: 0, text: { content: '測試 A&B', x: 0.5, y: 0.5, size: 0.1, color: '#ff8000', align: 'left' } }]),
  lane('up', 'visual', [{ id: 'k', mediaId: 'm3', start: 1, length: 2, offset: 0 }]),
  lane('main', 'visual', [
    { id: 'a', mediaId: 'm1', start: 0, length: 3, offset: 0, volume: 0.5 },
    { id: 'b', mediaId: 'm1', start: 3, length: 4, offset: 2, speed: 0.5 },
    { id: 'c', mediaId: 'm1', start: 7, length: 2, offset: 1, muted: true, disabled: true },
  ]),
  lane('au', 'audio', [{ id: 's', mediaId: 'm2', start: 1, length: 4, offset: 0, volume: 0.25 }]),
])
const near = (a: number, b: number, eps = 1 / 30 + 1e-6, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} ≠ ${b}`)
const laneOf = (p: ImportedProject, id: string) => p.tracks.find((l) => l.id === id)!
const byFile = (p: ImportedProject, f: string) => p.media.find((m) => m.file === f)!
/** 三种来回共用的核对 */
function checkRound(p: ImportedProject, opts: { textAlign?: boolean } = {}) {
  assert.deepEqual(p.ratio, { kind: 'custom', w: 1470, h: 630 })
  const ids = p.tracks.map((l) => `${l.id}:${l.kind}`)
  const main = laneOf(p, 'main')
  assert.equal(main.clips.length, 3, ids.join(' '))
  const m1 = byFile(p, '我的 片.mp4')
  assert.equal(m1.kind, 'video')
  const [a, b, c] = main.clips as TlClip[]
  assert.equal(a.mediaId, m1.key)
  near(a.start, 0); near(a.length, 3); near(a.offset, 0); assert.equal(a.volume, 0.5)
  near(b.start, 3); near(b.length, 4); near(b.offset, 2, 0.05, 'b.offset'); assert.equal(b.speed, 0.5)
  near(c.start, 7); near(c.length, 2); near(c.offset, 1); assert.equal(c.muted, true); assert.equal(c.disabled, true)
  // 上区：文字在最上、图片层在主轨上面；音频在主轨下面
  const upper = p.tracks.slice(0, p.tracks.findIndex((l) => l.id === 'main'))
  assert.equal(upper.length, 2, ids.join(' '))
  assert.equal(upper[0].kind, 'text'); assert.equal(upper[1].kind, 'visual')
  const t = upper[0].clips[0].text!
  assert.equal(t.content, '測試 A&B'); assert.equal(t.color, '#ff8000'); near(t.size, 0.1, 0.002, 'size')
  if (opts.textAlign !== false) assert.equal(t.align, 'left')
  near(upper[0].clips[0].start, 0.5); near(upper[0].clips[0].length, 3)
  const img = upper[1].clips[0]
  assert.equal(byFile(p, 'logo.png').kind, 'image'); assert.equal(img.mediaId, byFile(p, 'logo.png').key); near(img.start, 1); near(img.length, 2)
  const au = p.tracks.slice(p.tracks.findIndex((l) => l.id === 'main') + 1)
  assert.equal(au.length, 1, ids.join(' ')); assert.equal(au[0].kind, 'audio')
  const s = au[0].clips[0]
  assert.equal(byFile(p, 'song.mp3').kind, 'audio'); near(s.start, 1); near(s.length, 4); assert.equal(s.volume, 0.25)
  // 读进来的轨道剪辑页收得下（同一套检查·没有丢掉的）
  const media = p.media.map((m) => ({ id: m.key, name: m.name, kind: m.kind, duration: m.duration, from: 'local' }))
  const chk = parseProjectIssues({ ratio: p.ratio, tracks: p.tracks, media })
  assert.ok(chk.ok); if (chk.ok) assert.deepEqual(chk.issues, [])
}

ok('I1 FCPXML 来回：位置、长度、入点、0.5 倍速、音量、静音停用、文字、图片、上层画面轨、音频轨、比例', () => {
  const p = importFcpxml(docToFcpxml(SAMPLE()).xml, 'T.fcpxml')
  assert.equal(p.app, 'fcpxml'); assert.equal(p.name, 'T')
  checkRound(p)
  assert.equal(byFile(p, '我的 片.mp4').path, 'assets/我的 片.mp4')
  assert.equal(importFcpxml(docToFcpxml(SAMPLE(), { assetBase: 'file:///D:/proj/assets/' }).xml).media.find((m) => m.kind === 'video')!.path, 'D:/proj/assets/我的 片.mp4')
})

ok('I2 Premiere XML 来回：同 I1；影片自带声音并回画面那段、不另开音轨', () => {
  const p = importXmeml(docToXmeml(SAMPLE(), { assetBase: 'file:///D:/proj/assets/' }).xml, 'T.xml')
  assert.equal(p.app, 'premiere')
  checkRound(p)
  assert.equal(byFile(p, '我的 片.mp4').path, 'D:/proj/assets/我的 片.mp4')
})

ok('I3 剪映草稿来回：同 I1，外加声音淡入淡出与文字位置', () => {
  const d = SAMPLE()
  d.tracks.find((l) => l.id === 'au')!.clips[0].fadeIn = 0.5
  d.tracks.find((l) => l.id === 't')!.clips[0].text!.y = 0.8
  const jy = docToJianying(d, { mediaRoot: 'C:/proj/assets' })
  const p = importJianying(JSON.stringify(jy.content), 'C:/drafts/T/draft_content.json')
  assert.equal(p.app, 'jianying')
  checkRound(p)
  assert.equal(p.tracks.find((l) => l.kind === 'audio')!.clips[0].fadeIn, 0.5)
  near(p.tracks.find((l) => l.kind === 'text')!.clips[0].text!.y, 0.8, 1e-6, 'text y')
  assert.equal(byFile(p, '我的 片.mp4').path, 'C:/proj/assets/assets/我的 片.mp4')
  // 占位符路径（剪辑页汇出的草稿）⇒ 相对草稿资料夹
  const p2 = importJianying(JSON.stringify(docToJianying(d).content))
  assert.equal(byFile(p2, 'song.mp3').path, 'assets/song.mp3')
})

const FCP = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">
  <resources>
    <format id="r1" name="FFVideoFormat1080p2997" frameDuration="1001/30000s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>
    <asset id="r2" name="A001" uid="X1" start="3600s" duration="300300/30000s" hasVideo="1" format="r1" hasAudio="1" audioSources="1" audioChannels="2">
      <media-rep kind="original-media" sig="X1" src="file:///Volumes/Media/Movies/A%20001.mov"/>
    </asset>
    <asset id="r3" name="Music" start="0s" duration="60s" hasAudio="1" audioSources="1" audioChannels="2"><media-rep kind="original-media" src="file:///Volumes/Media/Music/bed.m4a"/></asset>
    <asset id="r4" name="B-roll" start="0s" duration="20s" hasVideo="1" format="r1"><media-rep kind="original-media" src="file:///Volumes/Media/Movies/broll.mp4"/></asset>
    <effect id="r5" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>
    <effect id="r6" name="Cross Dissolve" uid="FxPlug:4731E73A"/>
  </resources>
  <library><event name="E"><project name="FCP 片">
    <sequence format="r1" duration="600600/30000s" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
      <spine>
        <clip name="A001" offset="0s" duration="150150/30000s" start="108108000/30000s" format="r1" tcFormat="NDF">
          <video ref="r2" offset="108000000/30000s" start="108000000/30000s" duration="300300/30000s"/>
          <audio ref="r2" lane="-1" offset="108000000/30000s" start="108000000/30000s" duration="300300/30000s"/>
          <adjust-volume amount="-6dB"/>
          <asset-clip ref="r4" lane="1" offset="108138000/30000s" name="B-roll" start="0s" duration="60060/30000s">
            <adjust-transform position="10 0"/>
          </asset-clip>
          <title ref="r5" lane="2" offset="108108000/30000s" name="Hello" start="0s" duration="90090/30000s">
            <param name="Position" key="9999/999166631/999166633/1/100/101" value="0 -300"/>
            <text><text-style ref="ts1">Hello 世界</text-style></text>
            <text-style-def id="ts1"><text-style font="Helvetica" fontSize="108" fontColor="1 0 0 1" bold="1" alignment="center"/></text-style-def>
          </title>
        </clip>
        <transition name="Cross Dissolve" offset="135135/30000s" duration="30030/30000s"><filter-video ref="r6" name="Cross Dissolve"/></transition>
        <asset-clip ref="r2" offset="150150/30000s" name="A001 慢" start="108300000/30000s" duration="150150/30000s" tcFormat="NDF">
          <timeMap><timept time="3600s" value="3600s" interp="smooth2"/><timept time="3620s" value="3610s" interp="smooth2"/></timeMap>
          <filter-video ref="r6" name="Color"/>
          <spine lane="-1" offset="108300000/30000s">
            <asset-clip ref="r3" offset="108300000/30000s" name="bed" start="10s" duration="150150/30000s"><adjust-volume amount="-96dB"/></asset-clip>
          </spine>
        </asset-clip>
      </spine>
    </sequence>
  </project></event></library>
</fcpxml>`

ok('I4 Final Cut 写法：clip 包 video、原声不另放、上层片段与标题、次要故事线、分数时间、timeMap、notes、路径解码', () => {
  assert.equal(detectProjectFile('x.fcpxml', FCP.slice(0, 300)), 'fcpxml')
  const p = importProject('x.fcpxml', FCP)
  assert.equal(p.name, 'FCP 片'); assert.deepEqual(p.ratio, { kind: 'preset', key: '16:9' })
  const main = laneOf(p, 'main').clips
  assert.equal(main.length, 2)
  near(main[0].start, 0, 1e-6); near(main[0].length, 5.005, 1e-6); near(main[0].offset, 3.6, 1e-6, 'clip 入点＝video.start＋clip.start−video.offset−asset.start'); near(main[0].volume!, 0.501, 0.001)
  near(main[1].start, 5.005, 1e-6); assert.equal(main[1].speed, 0.5); near(main[1].offset, 5, 1e-6, 'timeMap 入点（3600＋10×0.5−3600）')
  const m = byFile(p, 'A 001.mov'); assert.equal(m.path, '/Volumes/Media/Movies/A 001.mov'); assert.equal(m.kind, 'video')
  assert.ok(!p.tracks.some((l) => l.kind === 'audio' && l.clips.some((c) => c.mediaId === m.key)), '原声没另放')
  const br = p.tracks.find((l) => l.kind === 'visual' && l.id !== 'main')!.clips[0]
  near(br.start, 1, 1e-6, 'B-roll 上层片段 start'); near(br.length, 2.002, 1e-6)
  const tt = p.tracks.find((l) => l.kind === 'text')!.clips[0]
  assert.equal(tt.text!.content, 'Hello 世界'); near(tt.text!.size, 0.1, 1e-6); assert.equal(tt.text!.color, '#ff0000'); assert.equal(tt.text!.bold, true); near(tt.text!.y, 0.5 + 300 / 1080, 1e-6)
  assert.equal(p.tracks[0].kind, 'text', '标题在最上（lane 2）')
  const bed = p.tracks.find((l) => l.kind === 'audio')!.clips[0]
  near(bed.start, 5.005, 1e-6); near(bed.offset, 10, 1e-6); assert.equal(bed.muted, true)
  for (const n of ['transition', 'fx', 'look']) assert.ok(p.notes.includes(n), `${n} 进 notes：${p.notes}`)
})

const PR = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4"><project><name>P</name><children><sequence id="sequence-1"><name>粗剪</name><duration>300</duration>
<rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
<media><video><format><samplecharacteristics><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><width>1080</width><height>1920</height></samplecharacteristics></format>
<track>
<clipitem id="clipitem-1"><name>a.mp4</name><enabled>TRUE</enabled><duration>900</duration><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><start>0</start><end>-1</end><in>30</in><out>150</out>
<file id="file-1"><name>a.mp4</name><pathurl>file://localhost/D%3a/Pr/a.mp4</pathurl><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><duration>900</duration><media><video/><audio><channelcount>2</channelcount></audio></media></file></clipitem>
<transitionitem><start>105</start><end>135</end><alignment>center</alignment><effect><name>Cross Dissolve</name></effect></transitionitem>
<clipitem id="clipitem-2"><name>a.mp4</name><enabled>TRUE</enabled><duration>900</duration><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate><start>-1</start><end>240</end><in>300</in><out>405</out><file id="file-1"/></clipitem>
</track>
<track><generatoritem id="g1"><name>Text</name><start>30</start><end>90</end><in>0</in><out>60</out><effect><name>Text</name><effectid>Text</effectid><effecttype>generator</effecttype>
<parameter><parameterid>str</parameterid><value>你好</value></parameter><parameter><parameterid>fontsize</parameterid><value>96</value></parameter>
<parameter><parameterid>fontcolor</parameterid><value><alpha>255</alpha><red>0</red><green>0</green><blue>255</blue></value></parameter></effect></generatoritem></track>
</video><audio>
<track><clipitem id="clipitem-3"><name>a.mp4</name><start>0</start><end>-1</end><in>30</in><out>150</out><file id="file-1"/><sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
<filter><effect><effectid>audiolevels</effectid><parameter><parameterid>level</parameterid><value>0.5</value></parameter></effect></filter></clipitem>
<transitionitem><start>105</start><end>135</end></transitionitem>
<clipitem id="clipitem-4"><name>a.mp4</name><start>-1</start><end>240</end><in>300</in><out>405</out><file id="file-1"/></clipitem></track>
<track><clipitem id="clipitem-5"><name>a.mp4</name><start>0</start><end>-1</end><in>30</in><out>150</out><file id="file-1"/><sourcetrack><mediatype>audio</mediatype><trackindex>2</trackindex></sourcetrack></clipitem>
<transitionitem><start>105</start><end>135</end></transitionitem>
<clipitem id="clipitem-6"><name>a.mp4</name><start>-1</start><end>240</end><in>300</in><out>405</out><file id="file-1"/></clipitem></track>
</audio></media></sequence></children></project></xmeml>`

ok('I5 Premiere 写法：ntsc 时基、转场旁 -1 接到中点、立体声两条原声并回、文字；加密剪映草稿照实拒绝', () => {
  const p = importProject('粗剪.xml', PR)
  assert.equal(p.app, 'premiere'); assert.equal(p.name, '粗剪'); assert.deepEqual(p.ratio, { kind: 'preset', key: '9:16' })
  const fps = 30000 / 1001, main = laneOf(p, 'main').clips
  assert.equal(main.length, 2)
  near(main[0].start, 0, 1e-6); near(main[0].length, 120 / fps, 1e-6); near(main[0].offset, 30 / fps, 1e-6); assert.equal(main[0].volume, 0.5)
  near(main[1].start, 120 / fps, 1e-6, '后一段从转场中点起'); near(main[1].offset, (300 + 15) / fps, 1e-6)
  assert.equal(p.tracks.filter((l) => l.kind === 'audio').length, 0, '两条原声都并回画面')
  assert.equal(byFile(p, 'a.mp4').path, 'D:/Pr/a.mp4')
  const t = p.tracks.find((l) => l.kind === 'text')!.clips[0]
  assert.equal(t.text!.content, '你好'); near(t.text!.size, 96 * 1.83 / 1920, 1e-6); assert.equal(t.text!.color, '#0000ff'); near(t.start, 30 / fps, 1e-6)
  assert.ok(p.notes.includes('transition'))
  assert.throws(() => importProject('draft_content.json', 'Kx9eQ2sd8f7…base64…'), (e: unknown) => e instanceof ImportBad && e.code === 'encrypted' && /encrypted/.test((e as Error).message))
  assert.throws(() => importProject('a.txt', 'hello'), ImportBad)
})

// Premiere 汇出的文字工具图形（V2）：<file> 只有 mediaSource、没有 pathurl；位置是文字左端、基线
const PR_GT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4"><sequence id="sequence-1"><name>序列 01</name><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
<media><video><format><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></format>
<track><clipitem id="clipitem-1"><name>a24.mp4</name><start>0</start><end>60</end><in>0</in><out>60</out><file id="file-1"><name>a24.mp4</name><pathurl>file://localhost/D:/Pr/a24.mp4</pathurl><duration>240</duration><media><video/></media></file></clipitem></track>
<track><clipitem id="clipitem-4"><masterclipid>masterclip-3</masterclipid><name>图形</name><enabled>TRUE</enabled><start>15</start><end>90</end><in>108000</in><out>108075</out>
<file id="file-3"><name>图形</name><mediaSource>GraphicAndType</mediaSource><media><video><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></video></media></file>
<filter><effect><name>Pr 匯出測試</name><effectid>GraphicAndType</effectid><effectcategory>graphic</effectcategory><effecttype>filter</effecttype><mediatype>video</mediatype>
<parameter authoringApp="PremierePro"><parameterid>1</parameterid><name>源文本</name><hash>4fc10743-cdc7-113c-4840-49e900000158</hash><value>QAEAAAAAAABEMyIRDAAAAAAABgAKAAQABgAAAGQAAAAAAF4AGAAQAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAABcABwBeAAAAAAAAARAAAAAcAAAALAAAAAAAAQBU////WP///1z///9g////AQAAAAQAAAAGAAAAU2ltU3VuAAABAAAADAAAAAgADAAEAAgACAAAAAgAAABQAAAADwAAAFByIOWMr+WHuua4rOippgAAADYAFAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAACAAEADYAAAACAAAADAAAAAwAAAAAAIBA9P////j////8////BAAEAAQAAAA=</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>3</parameterid><name>位置</name><IsTimeVarying>false</IsTimeVarying><value>-91445760000000000,0.3567708283662796:0.17088606953620911,0,0,0,0,0,0,5,4,0,0,0,0</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>4</parameterid><name>缩放</name><IsTimeVarying>false</IsTimeVarying><value>-91445760000000000,100.,0,0,0,0,0,0</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>7</parameterid><name>旋转</name><IsTimeVarying>false</IsTimeVarying><value>-91445760000000000,0.,0,0,0,0,0,0</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>8</parameterid><name>不透明度</name><IsTimeVarying>false</IsTimeVarying><value>-91445760000000000,100.,0,0,0,0,0,0</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>9</parameterid><name>锚点</name><IsTimeVarying>false</IsTimeVarying><value>-91445760000000000,0:0,0,0,0,0,0,0,5,4,0,0,0,0</value></parameter>
</effect></filter></clipitem></track>
</video></media></sequence></xmeml>`

ok('I5b Premiere 文字工具图形：GraphicAndType 成文字段、左端基线换成字块中心、不当缺档素材', () => {
  const p = importProject('pr-export.xml', PR_GT)
  assert.equal(p.app, 'premiere')
  assert.deepEqual(p.media.map((m) => m.file), ['a24.mp4'], '图形不进素材清单')
  const t = p.tracks.find((l) => l.kind === 'text')!.clips[0]
  assert.equal(t.text!.content, 'Pr 匯出測試')
  near(t.start, 0.5, 1e-6); near(t.start + t.length, 3, 1e-6)
  near(t.text!.x, 0.5, 0.02, '字块中心 x'); near(t.text!.y, 0.135, 0.02, '字块中心 y'); near(t.text!.size, 0.09, 0.02, '字高')
  assert.equal(t.text!.font, 'serif', 'SimSun ⇒ 明体')
  const r = importedToTracks(p, (m) => (m.file === 'a24.mp4' ? `real-${m.key}` : null), () => 'n')
  assert.deepEqual(r.missing, [], '没有缺档')
  assert.ok(!p.notes.includes('generator'))
})

const REAL = process.env.JY_REAL_DRAFT ?? '' // 剪映真草稿里的复合片段子草稿（draft_content.json）·没给就略过
ok('I6 剪映真草稿（复合片段）：照内层草稿摊开、比例照素材', () => {
  if (!REAL || !existsSync(REAL)) { console.log('  （没给剪映真草稿样本，略过）'); return }
  const p = importProject('draft/subdraft/X/draft_content.json', readFileSync(REAL, 'utf8'))
  assert.deepEqual(p.ratio, { kind: 'preset', key: '9:16' })
  assert.ok(p.media.some((m) => m.kind === 'image') && p.media.some((m) => m.kind === 'video'), '图与影片素材都在')
  assert.ok(p.media.every((m) => /^[A-Z]:\//.test(m.path ?? '')), '素材路径照草稿里的盘符路径')
  const all = p.tracks.flatMap((l) => l.clips)
  assert.ok(all.length >= 3, `摊开后 ${all.length} 段`)
  const end = Math.max(...all.map((c) => c.start + c.length))
  assert.ok(end <= 5 + 1e-3, `都在复合片段的 5 秒内：${end}`)
  const media = p.media.map((m) => ({ id: m.key, name: m.name, kind: m.kind, duration: m.duration, from: 'local' }))
  const chk = parseProjectIssues({ ratio: p.ratio, tracks: p.tracks, media })
  assert.ok(chk.ok && !chk.issues.length, JSON.stringify(chk.ok && chk.issues))
})

ok('I7 接线：对档／缺档、cliImport＋cliImportDoc、剪辑页选档认工程档、video-cli import、三语字', () => {
  const p = importFcpxml(docToFcpxml(SAMPLE()).xml)
  let n = 0
  const r = importedToTracks(p, (m) => (m.file === 'song.mp3' ? null : `real-${m.key}`), () => `n${++n}`)
  assert.deepEqual(r.missing.map((m) => m.file), ['song.mp3'])
  assert.ok(!r.tracks.some((l) => l.kind === 'audio'), '缺档的那段拿掉、空轨收掉')
  assert.ok(r.tracks.flatMap((l) => l.clips).every((c) => !c.mediaId || c.mediaId.startsWith('real-')))
  assert.equal(r.clips, 5)
  const ip = cliImport('T.xml', docToXmeml(SAMPLE()).xml)
  const keys = Object.fromEntries(ip.media.map((m) => [m.key, m.file]))
  const d = cliImportDoc(ip, keys)
  assert.deepEqual(d.doc.drops, []); assert.equal(d.missing.length, 0); assert.equal(d.doc.name, 'T')
  assert.equal(d.doc.tracks.flatMap((l) => l.clips).length, 6); assert.deepEqual(d.doc.ratio, { kind: 'custom', w: 1470, h: 630 })
  const P = readFileSync(join(__dirname, 'page', 'VideoEditPage.tsx'), 'utf8')
  assert.match(P, /detectProjectFile\(f\.name, await f\.slice\(0, 4000\)\.text\(\)/)
  assert.match(P, /if \(app\) return importOtherRef\.current\(f, app, all\.filter\(\(x\) => x !== f\)\)/)
  assert.match(P, /accept=\{`video\/\*,audio\/\*,image\/\*,\$\{MEDIA_ACCEPT_EXTS\},\.fcpxml,\.xml,\.json,/)
  const cli = join(__dirname, '..', '..', '..', 'scripts', 'studio-oss-template', 'tools', 'video-cli.mjs')
  if (existsSync(cli)) assert.match(readFileSync(cli, 'utf8'), /if \(o\.cmd === 'import'\) \{ importOther\(core, o\); return \}/)
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) for (const k of ['vedit_import_done', 'vedit_import_missing', 'vedit_import_notes', 'vedit_import_encrypted', 'vedit_import_bad']) assert.ok((VIDEO_I18N[lang] as Record<string, string>)[k], `${lang} ${k}`)
})

console.log(failed ? `studio-video import：${total - failed}/${total} 过` : `studio-video import → ${total} 过`)
if (failed) process.exitCode = 1
