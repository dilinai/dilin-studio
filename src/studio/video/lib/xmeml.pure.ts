// 剪辑工程 ⇒ Premiere XML（Final Cut Pro 7 的 xmeml 第 4 版·Premiere Pro「档案 › 汇入」认得；达芬奇也读得了）。
//   Premiere 不认 FCPXML（Final Cut X 那套），认的是这份旧格式 ⇒ 另写一支，规则跟 fcpxml.pure 对齐：
//   30fps 时基、片段首尾各自换帧（接缝不多 1 帧）、定速变速、音量、静音、停用、文字；带不过去的列 notes（同一套代码）。
//   轨道：主轨＝V1，主轨上面的画面／文字轨依次 V2、V3…；影片自带的声音放进对应的音轨（A1 跟 V1…），跟画面 link 成一对；
//   音频轨接在后面。定速变速写 Time Remap（in／out 在变速后的格上：out−in＝时间线上的长度），音量写 Audio Levels（线性倍数）。
//   素材路径：给 assetBase（命令列版知道资料夹在哪）⇒ file://localhost/ 绝对路径，Premiere 直接接上；
//   没给（浏览器汇出 zip）⇒ 写 assets/<档名>，Premiere 开档时会问素材在哪，指到解压出的 assets/ 就接上。
import type { VideoDoc } from '../format'
import { MAIN_LANE, type TlClip } from './timeline.pure'
import { fcpxmlSize } from './fcpxml.pure'

export const XMEML_FPS = 30

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fr = (sec: number) => Math.max(0, Math.round(sec * XMEML_FPS))
const RATE = `<rate><timebase>${XMEML_FPS}</timebase><ntsc>FALSE</ntsc></rate>`
const hexRgb = (hex: string | undefined): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return [255, 255, 255]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const param = (id: string, value: string | number, extra = '') => `<parameter><parameterid>${id}</parameterid><name>${id}</name>${extra}<value>${value}</value></parameter>`

/** file:///D:/x ⇒ file://localhost/D:/x（Premiere 汇出就这样写·两种它都认，照它自己的写法最稳） */
const localhostUrl = (u: string) => u.replace(/^file:\/\/\//, 'file://localhost/')

/** Premiere 旧版 Text 产生器：fontsize 画出来的字高是像素字级的 1.83 倍 ⇒ 写出时除掉；
 *  Origin 的垂直点落在字下缘附近，字的中心在它上面约 0.75 个字高 ⇒ 写出时往下补。读回（import-project.pure）照同两数反算。 */
export const PR_TEXT_SCALE = 1.83
export const PR_TEXT_DROP = 0.75

export function docToXmeml(doc: VideoDoc, o: { assetDir?: string; assetBase?: string } = {}): { xml: string; notes: string[] } {
  const dir = o.assetDir ?? 'assets'
  const { w, h } = fcpxmlSize(doc.ratio)
  const notes = new Set<string>()
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))
  const live = (c: TlClip) => {
    if (c.curve) notes.add('curve')
    if (c.reverse || c.freeze) notes.add('reverse-freeze')
    if (c.transIn) notes.add('transition')
    if (c.fx?.length) notes.add('fx')
    if (c.look) notes.add('look')
    if (c.text?.fancy) notes.add('fancy')
    if (c.sticker) { notes.add('sticker'); return false }
    if (c.filter || c.adjust) { notes.add('filter'); return false }
    if (c.program) { notes.add('program'); return false }
    if (c.shape || c.solid || c.bgfx) { notes.add('shape'); return false }
    if (c.text) return true
    return mediaById.has(c.mediaId)
  }
  const rate = (c: TlClip) => (c.speed && c.speed !== 1 && !c.curve && !c.reverse && !c.freeze ? c.speed : 1)
  const lenOf = (c: TlClip) => Math.max(1, fr(c.start + c.length) - fr(c.start))

  // 素材用到第几秒（素材时长没量到时拿来当档长）
  const needEnd = new Map<string, number>()
  const lanes = doc.tracks.map((l) => ({ lane: l, clips: l.clips.filter(live).sort((a, b) => a.start - b.start) }))
  for (const { clips } of lanes) for (const c of clips) if (!c.text) {
    const m = mediaById.get(c.mediaId)!
    needEnd.set(m.id, Math.max(needEnd.get(m.id) ?? 0, c.offset + c.length * (c.speed ?? 1)))
  }
  const fileFrames = (id: string) => fr(Math.max(mediaById.get(id)!.duration || 0, needEnd.get(id) ?? 0))

  // 画面区、声音区各自第一次用到时写整份 <file>（同一个 id），之后只写 <file id/>：
  //   达芬奇 21 先读声音区，声音区里只写 id、整份写在画面区的，它报找不到档
  const fileId = new Map<string, string>()
  const written = new Set<string>()
  const fileXml = (mid: string, part: 'v' | 'a'): string => {
    const nid = fileId.get(mid) ?? `file-${fileId.size + 1}`
    fileId.set(mid, nid)
    if (written.has(part + nid)) return `<file id="${nid}"/>`
    written.add(part + nid)
    const m = mediaById.get(mid)!
    const url = o.assetBase ? localhostUrl(o.assetBase) + encodeURIComponent(m.file) : encodeURI(`${dir}/${m.file}`)
    const hasV = m.kind !== 'audio' && !m.noPicture, hasA = m.kind !== 'image'
    return `<file id="${nid}"><name>${esc(m.name)}</name><pathurl>${esc(url)}</pathurl>${RATE}<duration>${fileFrames(mid)}</duration>`
      + `<media>${hasV ? `<video><samplecharacteristics>${RATE}<width>${w}</width><height>${h}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>` : ''}`
      + `${hasA ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : ''}</media></file>`
  }

  let clipNo = 0
  const timeRemap = (sp: number) => `<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>`
    + `${param('variablespeed', 0)}${param('speed', +(sp * 100).toFixed(4), '<valuemin>-100000</valuemin><valuemax>100000</valuemax>')}${param('reverse', 'FALSE')}${param('frameblending', 'FALSE')}</effect></filter>`
  const levels = (g: number) => `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>`
    + `${param('level', +Math.max(0, g).toFixed(4), '<valuemin>0</valuemin><valuemax>3.98109</valuemax>')}</effect></filter>`

  /** 素材片段在 xmeml 里的格：start／end＝时间线；in／out＝变速后的素材格（out−in＝end−start）；duration＝变速后的整档长 */
  const span = (c: TlClip) => {
    const m = mediaById.get(c.mediaId)!
    const sp = m.kind === 'image' ? 1 : rate(c)
    const start = fr(c.start), len = lenOf(c), inF = fr(c.offset / sp)
    return { m, sp, start, end: start + len, inF, outF: inF + len, dur: Math.max(inF + len, Math.round(fileFrames(m.id) / sp)) }
  }

  type Item = { xml: string }
  const video: Item[][] = [], audio: Item[][] = []
  const mainIdx = Math.max(0, doc.tracks.findIndex((l) => l.id === MAIN_LANE))
  // V1＝主轨，往上依次（doc.tracks 由上而下排）；音频轨放在画面带声的音轨后面
  const visualOrder = lanes.map((l, i) => ({ ...l, i })).filter((l) => l.lane.kind !== 'audio').sort((a, b) => (a.i === mainIdx ? -1 : b.i === mainIdx ? 1 : b.i - a.i))
  const audioLanes = lanes.filter((l) => l.lane.kind === 'audio')
  // 画面轨带的声音各占一条音轨（只有真有影片的那几条才配·文字轨不配），照 V 的顺序排 A1、A2…
  const sounds = (cs: TlClip[]) => cs.some((c) => !c.text && mediaById.get(c.mediaId)?.kind === 'video')
  const aNoOf: number[] = []
  visualOrder.forEach((l, vi) => { if (sounds(l.clips)) aNoOf[vi] = aNoOf.filter(Boolean).length + 1 })

  visualOrder.forEach(({ clips }, vi) => {
    const vt: Item[] = [], at: Item[] = []
    let last = 0
    for (const c of clips) {
      const start = fr(c.start)
      if (start < last) { notes.add('overlap'); continue }
      const en = c.disabled ? 'FALSE' : 'TRUE'
      if (c.text) {
        const t = c.text, len = lenOf(c), [r, g, b] = hexRgb(t.color)
        const px = t.size > 0 && t.size <= 1 ? t.size * h : t.size || 72
        const size = Math.round(px / PR_TEXT_SCALE)
        vt.push({ xml: `<generatoritem id="clipitem-${++clipNo}"><name>${esc(t.content.slice(0, 40) || 'Text')}</name><enabled>${en}</enabled><duration>${len}</duration>${RATE}`
          + `<start>${start}</start><end>${start + len}</end><in>0</in><out>${len}</out>`
          + `<effect><name>Text</name><effectid>Text</effectid><effectcategory>Text</effectcategory><effecttype>generator</effecttype><mediatype>video</mediatype>`
          + `${param('str', esc(t.content))}${param('fontname', 'Arial')}${param('fontsize', size)}`
          + `<parameter><parameterid>fontcolor</parameterid><name>Font Color</name><value><alpha>255</alpha><red>${r}</red><green>${g}</green><blue>${b}</blue></value></parameter>`
          + `${param('fontalign', t.align === 'left' ? 1 : t.align === 'right' ? 3 : 2)}`
          // 位置：画面中心＝0、到边＝±0.5（往下为正）；不写 Premiere 会把字的中心放在画面左上角。垂直方向的点在字下缘附近 ⇒ 往下补 PR_TEXT_DROP 个字高
          + `<parameter><parameterid>origin</parameterid><name>Origin</name><value><horiz>${+(t.x - 0.5).toFixed(4)}</horiz><vert>${+(t.y - 0.5 + PR_TEXT_DROP * px / h).toFixed(4)}</vert></value></parameter>`
          + `</effect></generatoritem>` })
        last = start + len
        continue
      }
      const s = span(c), withPic = s.m.kind !== 'audio' && !s.m.noPicture, withSnd = s.m.kind === 'video'
      const g = c.muted ? 0 : c.volume ?? 1
      const head = (id: string) => `<clipitem id="${id}"><name>${esc(s.m.name)}</name><enabled>${en}</enabled><duration>${s.dur}</duration>${RATE}`
        + `<start>${s.start}</start><end>${s.end}</end><in>${s.inF}</in><out>${s.outF}</out>`
      const vId = `clipitem-${++clipNo}`, aId = withSnd ? `clipitem-${++clipNo}` : ''
      // 画面与声音 link 成一对（Premiere 拖一个另一个跟着走）：先记下各是该轨第几段
      const vNo = vt.length + 1, aNo = at.length + 1
      const link = !(withPic && withSnd) ? '' : `<link><linkclipref>${vId}</linkclipref><mediatype>video</mediatype><trackindex>${vi + 1}</trackindex><clipindex>${vNo}</clipindex></link>`
        + `<link><linkclipref>${aId}</linkclipref><mediatype>audio</mediatype><trackindex>${aNoOf[vi]}</trackindex><clipindex>${aNo}</clipindex><groupindex>1</groupindex></link>`
      if (withPic) vt.push({ xml: head(vId) + fileXml(s.m.id, 'v') + (s.sp !== 1 ? timeRemap(s.sp) : '') + link + '</clipitem>' })
      if (withSnd) at.push({ xml: head(aId) + fileXml(s.m.id, 'a') + `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` + (s.sp !== 1 ? timeRemap(s.sp) : '') + (g !== 1 ? levels(g) : '') + link + '</clipitem>' })
      last = s.end
    }
    video.push(vt); if (aNoOf[vi]) audio.push(at)
  })
  for (const { clips } of audioLanes) {
    const at: Item[] = []
    let last = 0
    for (const c of clips) {
      if (c.text) continue
      const s = span(c)
      if (s.start < last) { notes.add('overlap'); continue }
      const g = c.muted ? 0 : c.volume ?? 1
      at.push({ xml: `<clipitem id="clipitem-${++clipNo}"><name>${esc(s.m.name)}</name><enabled>${c.disabled ? 'FALSE' : 'TRUE'}</enabled><duration>${s.dur}</duration>${RATE}`
        + `<start>${s.start}</start><end>${s.end}</end><in>${s.inF}</in><out>${s.outF}</out>${fileXml(s.m.id, 'a')}`
        + `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>${s.sp !== 1 ? timeRemap(s.sp) : ''}${g !== 1 ? levels(g) : ''}</clipitem>` })
      last = s.end
    }
    audio.push(at)
  }
  // 最上面没东西的画面轨拿掉（link 的 V 轨号只指得到有片段的轨，拿掉顶上的不影响）
  while (video.length > 1 && !video[video.length - 1].length) video.pop()
  const aTracks = audio.length ? audio : [[]]

  const total = Math.max(1, ...lanes.flatMap((l) => l.clips.map((c) => fr(c.start + c.length))))
  const name = esc(doc.name || 'Dilin Studio')
  const track = (items: Item[]) => `<track>${items.map((x) => x.xml).join('\n')}<enabled>TRUE</enabled><locked>FALSE</locked></track>`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${name}</name>
<duration>${total}</duration>
${RATE}
<timecode>${RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${RATE}<width>${w}</width><height>${h}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${video.map(track).join('\n')}
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
${aTracks.map(track).join('\n')}
</audio>
</media>
</sequence>
</xmeml>
`
  return { xml, notes: [...notes] }
}
