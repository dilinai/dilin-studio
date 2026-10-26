// 剪辑工程 ⇒ FCPXML 1.10（Final Cut Pro、DaVinci Resolve 都能「汇入时间线」接着剪）。
//   带得过去：主轨与其他画面轨／音频轨的素材片段（起点、长度、素材入点）、文字片段（内容、字级、字色、对齐）、片段音量与静音、停用。
//   定速变速用 timeMap 带过去（start 写在变速后的时间上）；片段首尾各自换帧（尾＝round(起点＋长度)），接缝不会多出 1 帧空档。
//   带不过去（先不放·列在 notes 里）：曲线变速、倒放定格、转场、特效滤镜、花字款式、贴纸、形状纯色、程序片段、画面位置缩放与蒙版。
//   素材路径写成相对 project 的 assets/<档名>：跟汇出 zip 的排法一致，解压后整夹拿去开。
//   命令列版（tools/video-cli.mjs）知道资料夹在哪 ⇒ 给 assetBase（file:// 网址前缀）写绝对路径，达芬奇直接接得上。
//   达芬奇 21 不认相对路径（./assets/x 与 assets/x 都报找不到）：汇入时它问「要不要另选资料夹搜索」，按是、选 assets 就接上；浏览器拿不到资料夹的绝对路径，免不掉这一步。
import type { VideoDoc } from '../format'
import { MAIN_LANE, type Lane, type TlClip } from './timeline.pure'
import { RATIO_PRESETS, type RatioSel } from './ratio.pure'

export const FCPXML_FPS = 30

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fr = (sec: number) => Math.max(0, Math.round(sec * FCPXML_FPS))
const tm = (frames: number) => (frames === 0 ? '0s' : `${frames}/${FCPXML_FPS}s`)
const even = (n: number) => Math.max(16, Math.round(n / 2) * 2)

/** 时间线画面大小：预设比例照长边 1920（短边 1080 起算）；自定义照填的；「适应」不知道素材尺寸 ⇒ 1920×1080 */
export function fcpxmlSize(ratio: RatioSel): { w: number; h: number } {
  if (ratio.kind === 'custom') return { w: even(ratio.w), h: even(ratio.h) }
  const r = ratio.kind === 'preset' ? RATIO_PRESETS[ratio.key] : 16 / 9
  return r >= 1 ? { w: even(1080 * r), h: 1080 } : { w: 1080, h: even(1080 / r) }
}

const hexColor = (hex: string | undefined): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return '1 1 1 1'
  const n = parseInt(m[1], 16)
  return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255} 1`
}

type Built = { xml: string; notes: string[] }

export function docToFcpxml(doc: VideoDoc, o: { assetDir?: string; assetBase?: string } = {}): Built {
  const dir = o.assetDir ?? 'assets'
  const { w, h } = fcpxmlSize(doc.ratio)
  const notes = new Set<string>()
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))
  const needEnd = new Map<string, number>() // 素材用到第几秒（素材时长没量到时拿来当资产长度）
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
    if (c.shape || c.solid || c.bgfx || c.rig) { notes.add('shape'); return false }
    if (c.text) return true
    const m = mediaById.get(c.mediaId)
    if (!m) return false
    needEnd.set(m.id, Math.max(needEnd.get(m.id) ?? 0, c.offset + c.length * (c.speed ?? 1)))
    return true
  }
  const lanes = doc.tracks.map((l) => ({ lane: l, clips: l.clips.filter(live).sort((a, b) => a.start - b.start) }))
  const mainIdx = Math.max(0, doc.tracks.findIndex((l) => l.id === MAIN_LANE))

  // 资源：格式、每份用到的素材、一个文字特效
  /** 定速变速（曲线／倒放／定格不算）⇒ 速度；其余 1 */
  const rate = (c: TlClip) => (c.speed && c.speed !== 1 && !c.curve && !c.reverse && !c.freeze ? c.speed : 1)
  const assetSec = new Map<string, number>()
  const res: string[] = [`<format id="r1" name="FFVideoFormat${h}p${FCPXML_FPS}" frameDuration="1/${FCPXML_FPS}s" width="${w}" height="${h}"/>`]
  const assetRef = new Map<string, string>()
  let rid = 2
  for (const m of doc.media) {
    if (!needEnd.has(m.id)) continue
    const ref = `r${rid++}`
    assetRef.set(m.id, ref)
    const dur = fr(Math.max(m.duration || 0, needEnd.get(m.id)!))
    assetSec.set(m.id, dur / FCPXML_FPS)
    const hasV = m.kind !== 'audio' && !m.noPicture, hasA = m.kind !== 'image'
    res.push(`<asset id="${ref}" name="${esc(m.name)}" start="0s" duration="${tm(dur)}"${hasV ? ` hasVideo="1" format="r1"` : ''}${hasA ? ` hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"` : ''}><media-rep kind="original-media" src="${esc(o.assetBase ? o.assetBase + encodeURIComponent(m.file) : encodeURI(`./${dir}/${m.file}`))}"/></asset>`)
  }
  const titleRef = `r${rid++}`
  let hasTitle = false
  let tsId = 0

  /** 片段在时间线上占几帧：首尾各自换帧（各自四舍五入再相减会在接缝多出／少掉 1 帧） */
  const lenOf = (c: TlClip) => Math.max(1, fr(c.start + c.length) - fr(c.start))
  /** 素材片段的 start（素材时间·变速片段写在变速后的时间上） */
  const startOf = (c: TlClip) => fr(c.offset / rate(c))
  const clipXml = (c: TlClip, laneNo: number | null, offsetFrames: number): string => {
    const lane = laneNo === null ? '' : ` lane="${laneNo}"`
    const off = tm(offsetFrames), dur = tm(lenOf(c))
    const en = c.disabled ? ' enabled="0"' : ''
    if (c.text) {
      hasTitle = true
      const id = `ts${++tsId}`, t = c.text
      const size = Math.round(t.size > 0 && t.size <= 1 ? t.size * h : t.size || 72)
      const align = t.align ?? 'center'
      return `<title ref="${titleRef}"${lane} offset="${off}" name="${esc(t.content.slice(0, 40) || 'Title')}" start="0s" duration="${dur}"${en}><text><text-style ref="${id}">${esc(t.content)}</text-style></text><text-style-def id="${id}"><text-style font="Helvetica" fontSize="${size}" fontColor="${hexColor(t.color)}"${t.bold ? ' bold="1"' : ''}${t.italic ? ' italic="1"' : ''} alignment="${align}"/></text-style-def></title>`
    }
    const m = mediaById.get(c.mediaId)!
    const g = c.muted ? 0 : c.volume ?? 1
    const vol = g === 1 ? '' : `<adjust-volume amount="${g <= 0 ? '-96' : (20 * Math.log10(g)).toFixed(2)}dB"/>`
    const sp = m.kind === 'image' ? 1 : rate(c)
    const a = assetSec.get(m.id) ?? 0
    const tmap = sp === 1 ? '' : `<timeMap><timept time="0s" value="0s" interp="linear"/><timept time="${tm(fr(a / sp))}" value="${tm(fr(a))}" interp="linear"/></timeMap>`
    return `<asset-clip ref="${assetRef.get(m.id)}"${lane} offset="${off}" name="${esc(m.name)}" start="${tm(sp === 1 ? fr(c.offset) : startOf(c))}" duration="${dur}"${m.kind === 'image' ? '' : ' tcFormat="NDF"'}${en}>${tmap}${vol}`
  }

  // 主轨排成主故事线（中间空档补 gap）；其他轨的片段挂在盖住它起点的那一格上（offset 用那一格自己的时间）
  type Slot = { tl0: number; tl1: number; local0: number; open: string; children: string[]; close: string }
  const slots: Slot[] = []
  let cur = 0
  const total = Math.max(0, ...lanes.flatMap((l) => l.clips.map((c) => fr(c.start + c.length))))
  const pushGap = (to: number) => { if (to > cur) { slots.push({ tl0: cur, tl1: to, local0: 0, open: `<gap name="Gap" offset="${tm(cur)}" start="0s" duration="${tm(to - cur)}">`, children: [], close: '</gap>' }); cur = to } }
  for (const c of lanes[mainIdx]?.clips ?? []) {
    const s = fr(c.start)
    if (s < cur) { notes.add('overlap'); continue }
    pushGap(s)
    const len = lenOf(c)
    const head = clipXml(c, null, s)
    if (c.text) slots.push({ tl0: s, tl1: s + len, local0: 0, open: head.replace(/<\/title>$/, ''), children: [], close: '</title>' })
    else slots.push({ tl0: s, tl1: s + len, local0: mediaById.get(c.mediaId)?.kind === 'image' ? fr(c.offset) : startOf(c), open: head, children: [], close: '</asset-clip>' })
    cur = s + len
  }
  pushGap(Math.max(total, cur, 1))
  lanes.forEach(({ lane, clips }, i) => {
    if (i === mainIdx) return
    const laneNo = laneNumber(lane, i, mainIdx)
    for (const c of clips) {
      const s = fr(c.start)
      const slot = slots.find((x) => s >= x.tl0 && s < x.tl1) ?? slots[slots.length - 1]
      const xml = clipXml(c, laneNo, slot.local0 + (s - slot.tl0))
      slot.children.push(c.text ? xml : xml + '</asset-clip>')
    }
  })
  if (hasTitle) res.push(`<effect id="${titleRef}" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>`)

  const name = esc(doc.name || 'Dilin Studio')
  const spine = slots.map((s) => s.open + s.children.join('') + s.close).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
<resources>
${res.join('\n')}
</resources>
<library>
<event name="${name}">
<project name="${name}">
<sequence format="r1" duration="${tm(cur)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
<spine>
${spine}
</spine>
</sequence>
</project>
</event>
</library>
</fcpxml>
`
  return { xml, notes: [...notes] }
}

/** FCPXML 的 lane：主轨上面的轨 1、2、3…（越上越大）；下面的（音频）-1、-2… */
function laneNumber(_lane: Lane, i: number, mainIdx: number): number {
  return i < mainIdx ? mainIdx - i : -(i - mainIdx)
}
