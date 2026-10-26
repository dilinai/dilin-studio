// 剪辑工程 ⇒ EDL（CMX3600·最老牌的剪辑清单：Premiere、达芬奇、Avid、Final Cut 都读写）。
//   EDL 只有一条画面轨：主轨的片段写成 V（影片带声音的写 B＝画面＋A1）；音频轨依次写 A2、A3…（声道码照 OTIO cmx_3600 那套）。
//   时间：30fps 不丢帧（NON-DROP FRAME）、录制时间码从 01:00:00:00 起（剪辑软件的惯例）、片段首尾各自换帧（接缝不多 1 帧）。
//   定速变速写 M2（播放速度＝30×倍数·倒放写负数）；素材写 FROM CLIP NAME（档名）＋SOURCE FILE（路径）。
//   带不过去（列 notes）：主轨以外的画面轨、文字、音量、停用、转场、特效与其余（同 xmeml 那套代码）。
import type { VideoDoc } from '../format'
import { MAIN_LANE, type TlClip } from './timeline.pure'

export const EDL_FPS = 30
const REC_START = 3600 * EDL_FPS

const fr = (sec: number) => Math.max(0, Math.round(sec * EDL_FPS))
/** 帧数 ⇒ HH:MM:SS:FF（30fps 不丢帧） */
export function edlTc(frames: number): string {
  const f = Math.max(0, Math.round(frames))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(f / (3600 * EDL_FPS)))}:${p(Math.floor(f / (60 * EDL_FPS)) % 60)}:${p(Math.floor(f / EDL_FPS) % 60)}:${p(f % EDL_FPS)}`
}

export function docToEdl(doc: VideoDoc, o: { assetDir?: string; assetBase?: string } = {}): { edl: string; notes: string[] } {
  const dir = o.assetDir ?? 'assets'
  const notes = new Set<string>()
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))
  const live = (c: TlClip) => {
    if (c.curve) notes.add('curve')
    if (c.freeze) notes.add('reverse-freeze')
    if (c.transIn) notes.add('transition')
    if (c.fx?.length) notes.add('fx')
    if (c.look) notes.add('look')
    if (c.sticker) { notes.add('sticker'); return false }
    if (c.filter || c.adjust) { notes.add('filter'); return false }
    if (c.program) { notes.add('program'); return false }
    if (c.shape || c.solid || c.bgfx || c.rig) { notes.add('shape'); return false }
    if (c.text) { notes.add('text'); return false }
    if (c.disabled) { notes.add('disabled'); return false }
    return mediaById.has(c.mediaId)
  }
  type Ev = { rec: number; len: number; ch: string; c: TlClip }
  const evs: Ev[] = []
  const push = (c: TlClip, ch: string) => {
    if (c.volume !== undefined && c.volume !== 1) notes.add('volume')
    const rec = fr(c.start)
    evs.push({ rec, len: Math.max(1, fr(c.start + c.length) - rec), ch, c })
  }
  for (const l of doc.tracks) {
    if (l.kind === 'audio') continue
    const clips = l.clips.filter(live)
    if (!clips.length) continue
    if (l.id !== MAIN_LANE) { notes.add('upper-lanes'); continue }
    for (const c of clips) push(c, mediaById.get(c.mediaId)!.kind === 'video' && !c.muted && !l.muted ? 'B' : 'V')
  }
  let an = 1
  for (const l of doc.tracks) {
    if (l.kind !== 'audio') continue
    const clips = l.clips.filter((c) => live(c) && !c.muted)
    if (!clips.length || l.muted) continue
    const ch = `A${++an}`
    // 只有声音的事件（配乐、音效）：达芬奇 21 汇入 EDL 时整段略过（A2／A 声道、改卷号、单独一份都试过·Mac 版）⇒ 提醒另放
    notes.add('audio-only-events')
    for (const c of clips) push(c, ch)
  }
  evs.sort((a, b) => a.rec - b.rec || (a.ch < b.ch ? -1 : 1))
  const out = [`TITLE: ${(doc.name || 'Dilin Studio').replace(/[\r\n]+/g, ' ').slice(0, 70)}`, 'FCM: NON-DROP FRAME', '']
  evs.forEach((e, k) => {
    const m = mediaById.get(e.c.mediaId)!
    const sp = m.kind === 'image' ? 1 : (e.c.speed ?? 1) * (e.c.reverse ? -1 : 1)
    const src = m.kind === 'image' ? 0 : fr(e.c.offset)
    const srcLen = Math.max(1, Math.round(e.len * Math.abs(sp)))
    const reel = 'AX'
    out.push(`${String(k + 1).padStart(3, '0')}  ${reel.padEnd(8)} ${e.ch.padEnd(5)} C        ${edlTc(src)} ${edlTc(src + srcLen)} ${edlTc(REC_START + e.rec)} ${edlTc(REC_START + e.rec + e.len)}`)
    if (Math.abs(sp - 1) > 1e-6) out.push(`M2   ${reel.padEnd(8)}  ${(EDL_FPS * sp).toFixed(1)}                ${edlTc(src)}`)
    out.push(`* FROM CLIP NAME:  ${m.file}`)
    out.push(`* SOURCE FILE: ${o.assetBase ? decodeURI(o.assetBase.replace(/^file:\/\/(localhost)?\/?/i, '/').replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/?$/, '/') + m.file : `${dir}/${m.file}`}`)
    out.push('')
  })
  return { edl: out.join('\r\n'), notes: [...notes] }
}
