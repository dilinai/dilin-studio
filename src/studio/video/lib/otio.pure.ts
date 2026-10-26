// 剪辑工程 ⇒ OTIO（OpenTimelineIO JSON·Pixar 开的公开时间线格式：达芬奇 18.5 起、Premiere／Nuke 外挂、OTIO 程式库都读）。
//   一条轨道一个 Track：画面轨（主轨最下、往上依次）、文字轨（Gap＋metadata.dilin.text·别家软体看到的是空档）、
//   影片自带的声音（每条画面轨一条音轨·跟画面同一份档同一段时间·静音的片段不写）、音频轨。片段之间的空档写 Gap。
//   时间 30fps 的帧（片段首尾各自换帧·接缝不多 1 帧）；定速变速写 LinearTimeWarp（倒放＝负数）；停用＝enabled false。
//   OTIO 没有标准写法的（音量、淡入淡出、文字样式、画幅）写进 metadata.dilin，读回来照用、别家软体略过。
//   带不过去（列 notes）：转场、特效滤镜、贴纸、形状、程序片段、蒙版画面属性、曲线变速、定格（同 xmeml 那套代码）。
import type { VideoDoc } from '../format'
import { MAIN_LANE, type Lane, type TlClip } from './timeline.pure'
import { fcpxmlSize } from './fcpxml.pure'

export const OTIO_FPS = 30
const fr = (sec: number) => Math.max(0, Math.round(sec * OTIO_FPS))
type J = Record<string, unknown>
const RT = (v: number): J => ({ OTIO_SCHEMA: 'RationalTime.1', rate: OTIO_FPS, value: v })
const TR = (s: number, d: number): J => ({ OTIO_SCHEMA: 'TimeRange.1', duration: RT(d), start_time: RT(s) })
const item = (schema: string, name: string, extra: J): J => ({ OTIO_SCHEMA: schema, metadata: {}, name, source_range: null, effects: [], markers: [], enabled: true, ...extra })

export function docToOtio(doc: VideoDoc, o: { assetDir?: string; assetBase?: string } = {}): { otio: string; notes: string[] } {
  const dir = o.assetDir ?? 'assets'
  const notes = new Set<string>()
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))
  const live = (c: TlClip) => {
    if (c.curve) notes.add('curve')
    if (c.freeze) notes.add('reverse-freeze')
    if (c.transIn) notes.add('transition')
    if (c.fx?.length) notes.add('fx')
    if (c.look) notes.add('look')
    if (c.text?.fancy) notes.add('fancy')
    if (c.sticker) { notes.add('sticker'); return false }
    if (c.filter || c.adjust) { notes.add('filter'); return false }
    if (c.program) { notes.add('program'); return false }
    if (c.shape || c.solid || c.bgfx || c.rig) { notes.add('shape'); return false }
    if (c.text) return true
    return mediaById.has(c.mediaId)
  }
  const url = (file: string) => (o.assetBase ? o.assetBase.replace(/\/?$/, '/') + encodeURIComponent(file) : `${dir}/${file}`)
  // 可用范围：影片／声音＝整份档；图片没有档长 ⇒ 写这一段的长度（OTIO 转 Premiere XML 那支没有它会出错）
  const ref = (c: TlClip, len: number): J => {
    const m = mediaById.get(c.mediaId)!
    return { OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name: m.file, target_url: url(m.file), available_range: m.kind !== 'image' && m.duration > 0 ? TR(0, Math.max(fr(m.duration), fr(c.offset) + Math.ceil(len * Math.abs(c.speed ?? 1)))) : TR(0, len) }
  }
  /** 一条轨：片段照起点排、中间补 Gap；sound＝只写影片自带的声音那份 */
  const track = (name: string, kind: 'Video' | 'Audio', lane: Lane, clips: TlClip[], sound: boolean): J => {
    const kids: J[] = []
    let at = 0
    for (const c of [...clips].sort((a, b) => a.start - b.start)) {
      const s = Math.max(fr(c.start), at), len = fr(c.start + c.length) - s
      if (len < 1) continue
      if (s > at) kids.push(item('Gap.1', '', { source_range: TR(0, s - at) }))
      // 文字写成带 metadata.dilin.text 的 Gap：达芬奇不认文字产生器（汇入成红色离线块·Mac DaVinci 21），Gap 它当空档略过；本编辑器读回照样是文字
      if (c.text) {
        kids.push(item('Gap.1', c.text.content.slice(0, 40), { source_range: TR(0, len), enabled: !c.disabled, metadata: { dilin: { text: c.text } } }))
        at = s + len
        continue
      }
      const m = mediaById.get(c.mediaId)!
      const meta: J = {}
      if (c.volume !== undefined && c.volume !== 1) meta.volume = c.volume
      if (c.muted && !sound) meta.muted = true
      if (c.fadeIn) meta.fadeIn = c.fadeIn
      if (c.fadeOut) meta.fadeOut = c.fadeOut
      const sp = m.kind === 'image' ? 1 : (c.speed ?? 1) * (c.reverse ? -1 : 1)
      const effects = Math.abs(sp - 1) > 1e-6 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', metadata: {}, name: '', effect_name: 'LinearTimeWarp', time_scalar: sp }] : []
      kids.push(item('Clip.2', m.file, {
        source_range: TR(m.kind === 'image' ? 0 : fr(c.offset), len), effects,
        enabled: !c.disabled, metadata: Object.keys(meta).length ? { dilin: meta } : {},
        media_references: { DEFAULT_MEDIA: ref(c, len) }, active_media_reference_key: 'DEFAULT_MEDIA',
      }))
      at = s + len
    }
    return item('Track.1', name, { kind, children: kids, enabled: !lane.hidden && !(kind === 'Audio' && lane.muted) })
  }
  const mainIdx = doc.tracks.findIndex((l) => l.id === MAIN_LANE)
  const visual = [doc.tracks[mainIdx], ...doc.tracks.slice(0, Math.max(0, mainIdx)).reverse()].filter(Boolean)
  const video: J[] = [], audio: J[] = []
  let v = 0, a = 0
  for (const l of visual) {
    const clips = l.clips.filter(live)
    if (!clips.length && l.id !== MAIN_LANE) continue
    video.push(track(`V${++v}`, 'Video', l, clips, false))
    const own = clips.filter((c) => !c.text && mediaById.get(c.mediaId)?.kind === 'video' && !c.muted && !l.muted)
    if (own.length) audio.push(track(`A${++a}`, 'Audio', l, own, true))
  }
  for (const l of doc.tracks) if (l.kind === 'audio') { const clips = l.clips.filter(live); if (clips.length) audio.push(track(`A${++a}`, 'Audio', l, clips, false)) }
  const { w, h } = fcpxmlSize(doc.ratio)
  const tl = {
    OTIO_SCHEMA: 'Timeline.1', metadata: { dilin: { ratio: doc.ratio, width: w, height: h } }, name: doc.name || 'Dilin Studio', global_start_time: null,
    tracks: item('Stack.1', 'tracks', { children: [...video, ...audio] }),
  }
  return { otio: JSON.stringify(tl, null, 2), notes: [...notes] }
}
