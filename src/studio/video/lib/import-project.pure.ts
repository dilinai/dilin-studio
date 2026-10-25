// 别家剪辑工程 ⇒ 剪辑工程（汇入）：FCPXML（Final Cut Pro、DaVinci Resolve·1.8～1.11）、Premiere XML（FCP7 xmeml·Premiere／达芬奇都写）、
// EDL（CMX3600·不写帧率 ⇒ 照时间码猜 30／60、FCM DROP ⇒ 29.97）、OTIO（OpenTimelineIO JSON·Timeline／Track／Clip／Gap、LinearTimeWarp）、
// 剪映／CapCut 草稿（没加密的 draft_content.json·复合片段照内层草稿摊开）。跟 fcpxml／xmeml／jianying 三支汇出对称：那三支写出去的这里读得回来。
//   读出一份中间结果 ImportedProject：比例、素材清单（档名＋原路径·没有档本身）、轨道（片段的 mediaId＝素材的 key）、带不过来的 notes。
//   素材档本身由调用方对上（剪辑页：跟工程档一起选／拖进来的档按档名对；命令列版：照原路径、工程档旁边、assets/ 找）⇒ importedToTracks 换成真素材 id。
//   带得过来：片段位置、长度、素材入点、定速变速、倒放、音量与静音、声音淡入淡出、停用、文字（字、字级、颜色、粗斜、对齐、位置·含 Premiere 文字工具图形）、剪映画面位置缩放旋转不透明度。
//   带不过来（列 notes）：转场、特效滤镜、贴纸、曲线变速、蒙版、动画、多机位、FCP 复合片段、生成器（色块等）。
//   读不了：加密的剪映草稿（新版剪映存档就加密）、不是这三种的档 ⇒ 丢 ImportBad（白话写原因）。
// 本档只放纯函数（不碰 DOM／fs·剪辑页、命令列版、题共用）。
import { MAIN_LANE, type Lane, type LaneKind, type TextFont, type TlClip, type Tracks } from './timeline.pure'
import { RATIO_PRESETS, type RatioPresetKey, type RatioSel } from './ratio.pure'
import { fcpxmlSize } from './fcpxml.pure'
import { PR_TEXT_DROP, PR_TEXT_SCALE } from './xmeml.pure'
import type { ProjectMediaKind } from './project.pure'
import { AUDIO_EXT } from './media-kind.pure'

export class ImportBad extends Error { constructor(public code: 'encrypted' | 'unknown' | 'broken' | 'empty', message: string) { super(message) } }

export type ImportApp = 'fcpxml' | 'premiere' | 'jianying' | 'edl' | 'otio'
/** 工程里用到的一份素材：key＝片段的 mediaId（汇入时临时的）、file＝原档名（对档用）、path＝原工程写的路径（解码过） */
export type ImportedMedia = { key: string; name: string; file: string; path: string; kind: ProjectMediaKind; duration: number }
export type ImportedProject = { app: ImportApp; name: string; ratio: RatioSel; media: ImportedMedia[]; tracks: Tracks; notes: string[] }

/** 选进来的档是不是别家工程（看副档名与开头几百字）：fcpxml／premiere／jianying；不是 ⇒ null */
export function detectProjectFile(name: string, head: string): ImportApp | null {
  const n = name.toLowerCase(), h = head.slice(0, 4000)
  if (/<fcpxml[\s>]/.test(h) || n.endsWith('.fcpxml')) return 'fcpxml'
  if (/<xmeml[\s>]/.test(h)) return 'premiere'
 if (n.endsWith('.edl') || /^\s*TITLE:[^\n]*\n(\s*\n)*\s*FCM:/i.test(h)) return 'edl'
 if (n.endsWith('.otio') || /"OTIO_SCHEMA"\s*:\s*"(Timeline|SerializableCollection)\./.test(h)) return 'otio'
  const b = n.replace(/^.*[\\/]/, '')
  if (/^(draft_content|draft_info|template)\.json(\.bak)?$/.test(b)) return 'jianying' // 加密的也认（读时再照实说读不了）
  if (b.endsWith('.json') && /"canvas_config"|"materials"\s*:/.test(h)) return 'jianying'
  return null
}

/** 读一份别家工程（文字全文）：app 不给 ⇒ 照内容认 */
export function importProject(name: string, text: string, app: ImportApp | null = detectProjectFile(name, text)): ImportedProject {
  if (app === 'fcpxml') return importFcpxml(text, name)
  if (app === 'premiere') return importXmeml(text, name)
  if (app === 'jianying') return importJianying(text, name)
 if (app === 'edl') return importEdl(text, name)
 if (app === 'otio') return importOtio(text, name)
  throw new ImportBad('unknown', 'not a Final Cut / DaVinci (FCPXML), Premiere (XML), EDL, OpenTimelineIO (.otio) or Jianying / CapCut draft file')
}

// ── 共用 ──
const stem = (n: string) => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
const baseName = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '')
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const hex2 = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|psd|tga|exr|dpx)$/i
/** 原工程写的路径 ⇒ 解码后的本机路径（file:// 网址、file://localhost/D:/、%20、剪映草稿占位符） */
export function decodeMediaPath(src: string): string {
  let s = (src ?? '').trim()
  s = s.replace(/^##_draftpath_placeholder_[^#]*_##[\\/]?/, '')
  const url = /^file:/i.test(s)
  if (url) s = s.replace(/^file:\/\/localhost\//i, 'file:///').replace(/^file:\/\/\/?/i, '/')
  try { s = decodeURIComponent(s) } catch { /* 原样 */ }
  if (url && /^\/[A-Za-z]:[\\/]/.test(s)) s = s.slice(1) // file:///D:/x ⇒ D:/x
  return s.replace(/^\.\//, '')
}
/** 素材种类：工程说的＋副档名（图片写成影片的、只有声音的） */
const kindOf = (path: string, hasVideo: boolean, hasAudio: boolean, durSec: number): ProjectMediaKind => {
  if (IMAGE_EXT.test(path)) return 'image'
  if (AUDIO_EXT.test(path)) return 'audio'
  if (!hasVideo && hasAudio) return 'audio'
  if (hasVideo && !hasAudio && durSec <= 0) return 'image'
  return 'video'
}
/** 画面大小 ⇒ 比例：正好是哪个预设的大小就用预设，不然自定义 */
export function ratioOfSize(w: number, h: number): RatioSel {
  if (!(w > 0 && h > 0)) return { kind: 'fit' }
  for (const key of Object.keys(RATIO_PRESETS) as RatioPresetKey[]) { const s = fcpxmlSize({ kind: 'preset', key }); if (s.w === Math.round(w) && s.h === Math.round(h)) return { kind: 'preset', key } }
  return { kind: 'custom', w: clamp(Math.round(w), 16, 8192), h: clamp(Math.round(h), 16, 8192) }
}

/** 中间片段：kind＝放哪种轨（画面／文字／声音）·z＝叠在哪一层（画面与文字：0＝主轨、越大越上；声音：-1 最靠上、越小越下） */
type IClip = TlClip & { lk: 'visual' | 'text' | 'audio'; z: number }
class Builder {
  media = new Map<string, ImportedMedia>()
  clips: IClip[] = []
  notes = new Set<string>()
  private n = 0
  note(c: string) { this.notes.add(c) }
  id() { return `i${(++this.n).toString(36)}` }
  addMedia(path: string, kind: ProjectMediaKind, duration: number, name?: string, dedupe = path): string {
    const k = 'p:' + dedupe
    const had = [...this.media.values()].find((m) => (m as ImportedMedia & { dk?: string }).dk === k)
    if (had) { if (duration > had.duration) had.duration = r6(duration); return had.key }
    const key = `m${this.media.size + 1}`
    const file = baseName(path) || name || key
    const m = { key, name: name || file, file, path, kind, duration: r6(Math.max(0, duration)) } as ImportedMedia & { dk?: string }
    Object.defineProperty(m, 'dk', { value: k, enumerable: false })
    this.media.set(key, m)
    return key
  }
  push(c: Omit<IClip, 'id'> & { id?: string }): IClip | null {
    if (!(c.length > 1e-6) || c.start < -1e-6) return null
    const x = { ...c, id: c.id ?? this.id(), start: r6(Math.max(0, c.start)), length: r6(c.length), offset: r6(Math.max(0, c.offset)) } as IClip
    this.clips.push(x)
    return x
  }
  /** 片段排进轨道：同 (种类, z) 的一组·同一时间叠到的往外开新轨（画面／文字往上、声音往下）；主轨＝画面 z 最接近 0 的第一条 */
  tracks(): Tracks {
    const groups = new Map<string, IClip[]>()
    for (const c of this.clips) { const k = `${c.lk}|${c.z}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c) }
    type L = { kind: LaneKind; z: number; sub: number; clips: TlClip[] }
    const lanes: L[] = []
    for (const [k, cs] of groups) {
      const [lk, zs] = k.split('|'), z = +zs
      cs.sort((a, b) => a.start - b.start || a.length - b.length)
      const subs: TlClip[][] = []
      for (const c of cs) {
        let s = subs.findIndex((l) => { const p = l[l.length - 1]; return p.start + p.length <= c.start + 1e-6 })
        if (s < 0) { subs.push([]); s = subs.length - 1 }
        const { lk: _k, z: _z, ...clip } = c; void _k; void _z
        subs[s].push(clip)
      }
      subs.forEach((clips, sub) => lanes.push({ kind: lk as LaneKind, z, sub, clips }))
    }
    const upper = lanes.filter((l) => l.kind !== 'audio')
    const audio = lanes.filter((l) => l.kind === 'audio').sort((a, b) => b.z - a.z || a.sub - b.sub)
    const vis = upper.filter((l) => l.kind === 'visual')
    const main = vis.length ? vis.reduce((m, l) => (Math.abs(l.z) < Math.abs(m.z) || (l.z === m.z && l.sub < m.sub) ? l : m)) : null
    // 上区由上到下：z 大的在上；同 z 的叠出来那几条在上
    const rest = upper.filter((l) => l !== main).sort((a, b) => b.z - a.z || b.sub - a.sub)
    let k = 0
    const mk = (l: L, id: string): Lane => ({ id, kind: l.kind, clips: l.clips, locked: false, hidden: false, muted: false })
    const out: Tracks = rest.map((l) => mk(l, `${l.kind === 'text' ? 't' : 'v'}${++k}`))
    out.push(main ? mk(main, MAIN_LANE) : { id: MAIN_LANE, kind: 'visual', clips: [], locked: false, hidden: false, muted: false })
    for (const l of audio) out.push(mk(l, `a${++k}`))
    return out
  }
  result(app: ImportApp, name: string, ratio: RatioSel): ImportedProject {
    const tracks = this.tracks()
    if (!tracks.some((l) => l.clips.length)) throw new ImportBad('empty', 'this project has no clips we can read')
    const used = new Set(tracks.flatMap((l) => l.clips.map((c) => c.mediaId)).filter(Boolean))
    return { app, name, ratio, media: [...this.media.values()].filter((m) => used.has(m.key)), tracks, notes: [...this.notes] }
  }
}

// ── 小 XML 读取器（只要元素、属性、文字；注释／处理指令／DOCTYPE 跳过·CDATA 当文字） ──
export type XNode = { tag: string; attrs: Record<string, string>; kids: XNode[]; text: string }
const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const unent = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m))
export function parseXml(s: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, kids: [], text: '' }
  const stack = [root]
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt < 0) break
    if (lt > i) stack[stack.length - 1].text += unent(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); i = e < 0 ? s.length : e + 3; continue }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); stack[stack.length - 1].text += s.slice(lt + 9, e < 0 ? s.length : e); i = e < 0 ? s.length : e + 3; continue }
    if (s[lt + 1] === '?') { const e = s.indexOf('?>', lt); i = e < 0 ? s.length : e + 2; continue }
    if (s[lt + 1] === '!') { // DOCTYPE（可能带 [ ] 内部子集）
      let d = 0, j = lt + 2
      for (; j < s.length; j++) { if (s[j] === '[') d++; else if (s[j] === ']') d--; else if (s[j] === '>' && d <= 0) break }
      i = j + 1; continue
    }
    if (s[lt + 1] === '/') {
      const e = s.indexOf('>', lt), tag = s.slice(lt + 2, e).trim()
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break }
      i = e + 1; continue
    }
    // 起始标签（属性值里可能有 >）
    let j = lt + 1, q = ''
    for (; j < s.length; j++) { const c = s[j]; if (q) { if (c === q) q = '' } else if (c === '"' || c === "'") q = c; else if (c === '>') break }
    let body = s.slice(lt + 1, j)
    const self = body.endsWith('/')
    if (self) body = body.slice(0, -1)
    const m = /^([^\s/>]+)/.exec(body)
    const node: XNode = { tag: m ? m[1] : '', attrs: {}, kids: [], text: '' }
    for (const a of body.slice(node.tag.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = unent(a[3] ?? a[4] ?? '')
    stack[stack.length - 1].kids.push(node)
    if (!self) stack.push(node)
    i = j + 1
  }
  return root
}
const kid = (n: XNode | undefined, tag: string) => n?.kids.find((k) => k.tag === tag)
const kidsOf = (n: XNode | undefined, tag: string) => (n ? n.kids.filter((k) => k.tag === tag) : [])
const txt = (n: XNode | undefined, tag?: string) => (tag ? kid(n, tag)?.text : n?.text)?.trim() ?? ''
function find(n: XNode, tag: string): XNode | undefined { for (const k of n.kids) { if (k.tag === tag) return k; const f = find(k, tag); if (f) return f } return undefined }
function findAll(n: XNode, tag: string, out: XNode[] = []): XNode[] { for (const k of n.kids) { if (k.tag === tag) out.push(k); findAll(k, tag, out) } return out }
const allText = (n: XNode): string => n.text + n.kids.map(allText).join('')

// ═══════════════════════ FCPXML ═══════════════════════
/** FCPXML 时间：「1001/30000s」「10s」「0s」 ⇒ 秒 */
export function fcpTime(v: string | undefined): number {
  if (!v) return 0
  const m = /^\s*(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?s?\s*$/.exec(v)
  return m ? +m[1] / (m[2] ? +m[2] : 1) : 0
}
const dbToGain = (v: string | undefined) => { const m = /(-?\d+(?:\.\d+)?)\s*dB/i.exec(v ?? ''); return m ? (+m[1] <= -95 ? 0 : Math.pow(10, +m[1] / 20)) : 1 }
const fcpColor = (v: string | undefined) => { const p = (v ?? '').trim().split(/\s+/).map(Number); return p.length >= 3 && p.every((x) => Number.isFinite(x)) ? rgbHex(p[0], p[1], p[2]) : undefined }

export function importFcpxml(text: string, fileName = ''): ImportedProject {
  const doc = parseXml(text), root = find(doc, 'fcpxml')
  if (!root) throw new ImportBad('broken', 'not an FCPXML file (no <fcpxml>)')
  const res = kid(root, 'resources')
  const formats = new Map<string, XNode>(), assets = new Map<string, XNode>(), effects = new Map<string, XNode>(), media = new Map<string, XNode>()
  for (const r of res?.kids ?? []) { const id = r.attrs.id; if (!id) continue; if (r.tag === 'format') formats.set(id, r); else if (r.tag === 'asset') assets.set(id, r); else if (r.tag === 'effect') effects.set(id, r); else if (r.tag === 'media') media.set(id, r) }
  const project = find(root, 'project'), seq = project ? kid(project, 'sequence') : find(root, 'sequence')
  if (!seq) throw new ImportBad('empty', 'this FCPXML has no timeline (project / sequence)')
  const fmt = formats.get(seq.attrs.format ?? '')
  let W = +(fmt?.attrs.width ?? 0), H = +(fmt?.attrs.height ?? 0)
  if (!(W > 0 && H > 0)) { const m = /(\d{3,4})p/.exec(fmt?.attrs.name ?? ''); if (m) { H = +m[1]; W = Math.round(H * 16 / 9) } }
  const B = new Builder()
  const assetKey = (ref: string): { key: string; kind: ProjectMediaKind; start: number } | null => {
    const a = assets.get(ref)
    if (!a) { if (media.has(ref)) B.note('compound'); else if (effects.has(ref)) B.note('generator'); return null }
    const src = a.attrs.src ?? kid(a, 'media-rep')?.attrs.src ?? ''
    const path = decodeMediaPath(src)
    const dur = fcpTime(a.attrs.duration)
    const kind = kindOf(path, a.attrs.hasVideo === '1', a.attrs.hasAudio === '1', dur)
    return { key: B.addMedia(path, kind, dur, a.attrs.name, src || ref), kind, start: fcpTime(a.attrs.start) }
  }
  /** 片段时间 t（clip 的 start 那套）⇒ 素材时间：有 timeMap 照分段直线换算，没有＝t */
  const timeMapOf = (el: XNode) => {
    const tm = kid(el, 'timeMap'); if (!tm) return null
    const pts = kidsOf(tm, 'timept').map((p) => ({ t: fcpTime(p.attrs.time), v: fcpTime(p.attrs.value) })).sort((a, b) => a.t - b.t)
    return pts.length >= 2 ? pts : null
  }
  const mapT = (pts: { t: number; v: number }[], t: number) => {
    let i = 0; while (i < pts.length - 2 && t > pts[i + 1].t) i++
    const a = pts[i], b = pts[i + 1], k = (b.v - a.v) / ((b.t - a.t) || 1)
    return a.v + (t - a.t) * k
  }
  const looks = (el: XNode) => {
    for (const k of el.kids) {
      if (k.tag === 'filter-video' || k.tag === 'filter-audio') B.note('fx')
      else if (k.tag === 'adjust-transform' || k.tag === 'adjust-crop' || k.tag === 'adjust-corners' || k.tag === 'adjust-blend' || k.tag === 'adjust-stabilization') B.note('look')
      else if (k.tag === 'keyframeAnimation') B.note('keyframes')
    }
  }
  /** 一段带素材的元素（asset-clip／video／audio 或 clip 里的主要那份）放上时间线 */
  const placeMedia = (el: XNode, inner: XNode | null, ref: string, tl0: number, lane: number, lenSec: number) => {
    const a = assetKey(ref); if (!a) return
    const enabled = el.attrs.enabled !== '0'
    // 素材入点：有 inner（clip 里那份）＝inner.start＋(clip.start − inner.offset)
    const s0 = inner ? fcpTime(inner.attrs.start) + fcpTime(el.attrs.start) - fcpTime(inner.attrs.offset) : fcpTime(el.attrs.start)
    const pts = timeMapOf(el)
    let src = s0, speed = 1
    if (pts) {
      const t0 = fcpTime(el.attrs.start), t1 = t0 + lenSec
      const v0 = mapT(pts, t0), v1 = mapT(pts, t1)
      speed = lenSec > 0 ? (v1 - v0) / lenSec : 1
      const slopes = new Set(pts.slice(1).map((p, i) => Math.round(((p.v - pts[i].v) / ((p.t - pts[i].t) || 1)) * 1000)))
      if (slopes.size > 1) B.note('curve')
      src = Math.min(v0, v1) + (inner ? fcpTime(inner.attrs.start) - fcpTime(inner.attrs.offset) : 0)
    }
    const vol = kid(el, 'adjust-volume') ?? (inner ? kid(inner, 'adjust-volume') : undefined)
    const g = dbToGain(vol?.attrs.amount)
    looks(el); if (inner) looks(inner)
    const audioOnly = a.kind === 'audio'
    const c: Omit<IClip, 'id'> = { lk: audioOnly ? 'audio' : 'visual', z: audioOnly ? (lane < 0 ? lane : -0.5) : lane, mediaId: a.key, start: tl0, length: lenSec, offset: a.kind === 'image' ? 0 : Math.max(0, src - a.start) }
    if (Math.abs(speed) > 1e-6 && Math.abs(Math.abs(speed) - 1) > 1e-4 && a.kind !== 'image') c.speed = Math.round(clamp(Math.abs(speed), 0.1, 100) * 100) / 100
    if (speed < 0) c.reverse = true
    if (g <= 0) c.muted = true; else if (Math.abs(g - 1) > 1e-3) c.volume = Math.round(g * 1000) / 1000
    if (!enabled) c.disabled = true
    B.push(c)
  }
  const placeTitle = (el: XNode, tl0: number, lane: number, lenSec: number) => {
    const txtNode = kid(el, 'text')
    const content = (txtNode ? allText(txtNode) : '').replace(/\r\n?/g, '\n').trim()
    if (!content) return
    const ts = find(el, 'text-style-def') ? find(find(el, 'text-style-def')!, 'text-style') : undefined
    const size = +(ts?.attrs.fontSize ?? 0)
    const pos = kidsOf(el, 'param').find((p) => /position/i.test(p.attrs.name ?? ''))?.attrs.value?.split(/\s+/).map(Number)
    const text: TlClip['text'] = { content: content.slice(0, 2000), x: 0.5, y: 0.5, size: clamp(size > 0 && H > 0 ? size / H : 0.06, 0.03, 0.5) }
    if (pos && pos.length >= 2 && W > 0 && H > 0) { text.x = clamp(0.5 + pos[0] / W, 0, 1); text.y = clamp(0.5 - pos[1] / H, 0, 1) }
    const col = fcpColor(ts?.attrs.fontColor); if (col) text.color = col
    if (ts?.attrs.bold === '1') text.bold = true
    if (ts?.attrs.italic === '1') text.italic = true
    const al = ts?.attrs.alignment; if (al === 'left' || al === 'right') text.align = al
    const c: Omit<IClip, 'id'> = { lk: 'text', z: lane || 1, mediaId: '', start: tl0, length: lenSec, offset: 0, text }
    if (el.attrs.enabled === '0') c.disabled = true
    B.push(c)
  }
  /** 一个故事元素：tl0＝它在时间线的起点·lane＝它在哪层；里面挂着的（lane 属性）照 offset 换到时间线 */
  const element = (el: XNode, tl0: number, lane: number) => {
    const len = fcpTime(el.attrs.duration), start = fcpTime(el.attrs.start)
    const local = (o: string | undefined) => tl0 + fcpTime(o) - start
    switch (el.tag) {
      case 'asset-clip': placeMedia(el, null, el.attrs.ref ?? '', tl0, lane, len); break
      case 'video': case 'audio': placeMedia(el, null, el.attrs.ref ?? '', tl0, lane, len); break
      case 'clip': case 'sync-clip': {
        // 主要那份：没写 lane 的 video／audio／asset-clip（画面优先）
        const prim = el.kids.filter((k) => (k.tag === 'video' || k.tag === 'asset-clip' || k.tag === 'audio') && !k.attrs.lane)
        const p = prim.find((k) => k.tag !== 'audio') ?? prim[0]
        if (p) placeMedia(el, p, p.attrs.ref ?? '', tl0, lane, len)
        // 同一份素材的声音（影片自带的声音拆在 lane -1）⇒ 不另放
        const own = new Set(prim.map((k) => k.attrs.ref))
        for (const k of el.kids) if (k.attrs.lane && !(k.tag === 'audio' && own.has(k.attrs.ref))) element(k, local(k.attrs.offset), lane + +k.attrs.lane)
        return
      }
      case 'title': placeTitle(el, tl0, lane, len); break
      case 'gap': break
      case 'transition': B.note('transition'); return
      case 'ref-clip': B.note('compound'); break
      case 'mc-clip': B.note('multicam'); break
      case 'spine': { // 次要故事线：子元素的 offset 跟上层同一套时间（第一段的 offset＝这条线的 offset），不然从 0 起算
        const first = el.kids.find((k) => k.attrs.offset !== undefined)
        const shift = first && Math.abs(fcpTime(first.attrs.offset) - fcpTime(el.attrs.offset)) < 1e-6 ? fcpTime(el.attrs.offset) : 0
        for (const k of el.kids) element(k, tl0 + fcpTime(k.attrs.offset) - shift, lane)
        return
      }
      default: return
    }
    for (const k of el.kids) if (k.attrs.lane !== undefined && k.tag !== 'param') element(k, local(k.attrs.offset), lane + +k.attrs.lane)
  }
  const spine = kid(seq, 'spine')
  for (const el of spine?.kids ?? []) element(el, fcpTime(el.attrs.offset), 0)
  return B.result('fcpxml', project?.attrs.name || stem(fileName), ratioOfSize(W, H))
}

// ═══════════════════════ Premiere XML（xmeml） ═══════════════════════
const rateOf = (n: XNode | undefined, fallback: number) => { const r = kid(n, 'rate'); const tb = +txt(r, 'timebase'); return tb > 0 ? (txt(r, 'ntsc').toUpperCase() === 'TRUE' ? tb * 1000 / 1001 : tb) : fallback }
const param = (eff: XNode | undefined, id: string) => kidsOf(eff, 'parameter').find((p) => txt(p, 'parameterid').toLowerCase() === id.toLowerCase())

// ── Premiere 文字工具图形（effectid／mediaSource＝GraphicAndType·Pr 2019 起汇出成 <clipitem>、<file> 没有 pathurl） ──
//   参数照编号：1＝源文本（base64 二进制·FlatBuffers）、3＝位置「x:y」（按画面宽高归一·文字左端、第一行基线）、4＝缩放（%）、7＝旋转（度）、8＝不透明度（%）、9＝锚点。
//   参数的 value 是「时间,值,…」·取第二格（有关键帧也只取这一格）。
/** 字级：二进制里的表格结构没有公开，不去猜 ⇒ 一律当 Pr 新建文字的缺省 100 px（缩放参数照乘） */
export const PR_GT_FONT_PX = 100
/** 第一行基线到字块中心往上几个字高（剪辑页文字段的 y 是字块中心） */
export const PR_GT_BASELINE = 0.4
/** 多行：行距几个字高（字块中心往下补半个「行数－1」行距） */
const PR_GT_LINE = 1.2
const GT_WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u
/** 估一行字宽（字高的倍数）：CJK／全形 1 个、其余 0.5 个 */
const gtEm = (line: string) => [...line].reduce((w, c) => w + (GT_WIDE.test(c) ? 1 : 0.5), 0)
/** 二进制里的字串：「4 字节小端长度＋UTF-8＋\0」·长度吻合、能解成合法 UTF-8、没有控制字元的才算（逐字节扫·不写死偏移） */
export function gtStrings(b: Uint8Array): string[] {
  const dec = new TextDecoder('utf-8', { fatal: true }), out: string[] = []
  for (let i = 0; i + 5 <= b.length; i++) {
    const n = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
    if (n < 1 || n > 8000 || i + 4 + n >= b.length || b[i + 4 + n] !== 0) continue
    const seg = b.subarray(i + 4, i + 4 + n)
    if (seg.includes(0)) continue
    let str: string
    try { str = dec.decode(seg) } catch { continue }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(str)) continue
    out.push(str)
    i += 3 + n // 跳过这段（下一轮再 +1 落在 \0 之后）
  }
  return out
}
const b64Bytes = (v: string): Uint8Array => {
  try { const bin = atob(v.replace(/\s+/g, '')); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b } catch { return new Uint8Array(0) }
}
/** 字体名 ⇒ 剪辑页的三种通用字体（认不出 ⇒ 不带） */
const gtFont = (name: string): TextFont | undefined => {
  if (/sim(sun|fang|kai)|song|ming|mincho|kai|serif|times|georgia|garamond|batang/i.test(name) && !/sans/i.test(name)) return 'serif'
  if (/mono|courier|consol|menlo/i.test(name)) return 'mono'
  if (/hei|yahei|gothic|sans|arial|helvetica|verdana|segoe|pingfang|noto|source han|dengxian/i.test(name)) return 'sans'
  return undefined
}
/** 一个 GraphicAndType 效果 ⇒ 文字段的内容（读不出字 ⇒ null） */
export function gtText(fx: XNode, W: number, H: number): TlClip['text'] | null {
  const pv = (id: string) => (txt(param(fx, id), 'value').split(',')[1] ?? '').trim()
  const name = txt(fx, 'name')
  const strs = gtStrings(b64Bytes(txt(param(fx, '1'), 'value')))
  // 字：跟效果名一样（或以效果名起头·名字可能被截短）的那段；都没有 ⇒ 最长那段；二进制读不出 ⇒ 效果名
  const raw = strs.find((x) => x === name) ?? (name ? strs.find((x) => x.startsWith(name)) : undefined) ?? (strs.length ? strs.reduce((a, x) => (x.length > a.length ? x : a)) : name)
  const content = raw.replace(/\r\n?/g, '\n').trim().slice(0, 2000)
  if (!content || !(W > 0 && H > 0)) return null
  const sc = +pv('4'), px = PR_GT_FONT_PX * (sc > 0 ? sc / 100 : 1)
  const size = px / H
  const lines = content.split('\n')
  const text: TlClip['text'] = { content, x: 0.5, y: 0.5, size: clamp(size, 0.03, 0.5) }
  const pos = pv('3').split(':').map(Number)
  if (pos.length === 2 && pos.every(Number.isFinite)) {
    // 左端、第一行基线 ⇒ 字块中心：x 加半个估出的字宽（对齐当靠左）、y 往上 PR_GT_BASELINE 个字高、多行再往下补
    const em = Math.max(...lines.map(gtEm))
    text.x = clamp(pos[0] + (em * px) / W / 2, 0, 1)
    text.y = clamp(pos[1] - PR_GT_BASELINE * size + ((lines.length - 1) * PR_GT_LINE * size) / 2, 0, 1)
  }
  const font = strs.filter((x) => x !== raw).map(gtFont).find(Boolean); if (font) text.font = font
  const rot = +pv('7'); if (Number.isFinite(rot) && Math.abs(rot) > 1e-3) text.rotate = rot
  const op = +pv('8'); if (Number.isFinite(op) && op >= 0 && op < 100) text.opacity = Math.round(op) / 100
  return text
}

export function importXmeml(text: string, fileName = ''): ImportedProject {
  const doc = parseXml(text), root = find(doc, 'xmeml')
  if (!root) throw new ImportBad('broken', 'not a Premiere / Final Cut 7 XML file (no <xmeml>)')
  const seq = findAll(root, 'sequence').find((s) => kid(s, 'media')) ?? find(root, 'sequence')
  if (!seq) throw new ImportBad('empty', 'this XML has no sequence')
  const fps = rateOf(seq, 30)
  const vfmt = kid(kid(kid(kid(seq, 'media'), 'video'), 'format'), 'samplecharacteristics')
  const W = +txt(vfmt, 'width'), H = +txt(vfmt, 'height')
  // <file>：整份写在第一次出现的地方，之后只写 id ⇒ 整份档先收齐
  const files = new Map<string, XNode>()
  for (const f of findAll(root, 'file')) if (f.attrs.id && (kid(f, 'pathurl') || kid(f, 'name')) && !files.has(f.attrs.id)) files.set(f.attrs.id, f)
  const B = new Builder()
  const fileKey = new Map<string, { key: string; kind: ProjectMediaKind }>()
  const mediaOf = (item: XNode): { key: string; kind: ProjectMediaKind; fid: string } | null => {
    const fr = kid(item, 'file'); if (!fr) return null
    const fid = fr.attrs.id ?? ''
    const had = fileKey.get(fid); if (had) return { ...had, fid }
    const f = files.get(fid) ?? fr
    const url = txt(f, 'pathurl'), path = decodeMediaPath(url) || txt(f, 'name')
    const md = kid(f, 'media'), frate = rateOf(f, fps)
    const dur = +txt(f, 'duration') / frate
    const kind = kindOf(path, !!kid(md, 'video'), !!kid(md, 'audio'), md ? dur : 1)
    const v = { key: B.addMedia(path, kind, Number.isFinite(dur) ? dur : 0, txt(f, 'name') || undefined, url || fid), kind }
    fileKey.set(fid, v)
    return { ...v, fid }
  }
  const speedOf = (item: XNode) => {
    for (const fx of kidsOf(item, 'filter').map((f) => kid(f, 'effect'))) {
      if (!fx || txt(fx, 'effectid').toLowerCase() !== 'timeremap') continue
      if (txt(param(fx, 'variablespeed'), 'value') === '1') B.note('curve')
      const sp = +txt(param(fx, 'speed'), 'value')
      return { speed: Number.isFinite(sp) && sp !== 0 ? Math.abs(sp) / 100 : 1, reverse: txt(param(fx, 'reverse'), 'value').toUpperCase() === 'TRUE' || sp < 0 }
    }
    return { speed: 1, reverse: false }
  }
  const levelOf = (item: XNode) => {
    let g = 1
    for (const fx of kidsOf(item, 'filter').map((f) => kid(f, 'effect'))) {
      const id = txt(fx, 'effectid').toLowerCase()
      if (id === 'audiolevels') { const v = +txt(param(fx, 'level'), 'value'); if (Number.isFinite(v)) g *= v }
      else if (fx && id !== 'timeremap') B.note(txt(fx, 'mediatype') === 'audio' ? 'fx' : 'fx')
    }
    return g
  }
  /** 一条轨的片段：start／end 是 -1（贴着转场）⇒ 照转场中点接上 */
  // 只写 id 的 <clipitem id="…"/>（FCP7、OTIO 转出的档在声音轨这样指回画面那段）⇒ 换成那份完整的
  const clipById = new Map(findAll(root, 'clipitem').filter((c) => c.kids.length && c.attrs.id).map((c) => [c.attrs.id, c]))
  const items = (track: XNode) => {
    const list = track.kids.filter((k) => k.tag === 'clipitem' || k.tag === 'generatoritem' || k.tag === 'transitionitem')
      .map((k) => (k.tag === 'clipitem' && !k.kids.length ? clipById.get(k.attrs.id) ?? k : k))
    const out: { el: XNode; s: number; e: number; inF: number }[] = []
    list.forEach((el, i) => {
      if (el.tag === 'transitionitem') { B.note('transition'); return }
      let s = +txt(el, 'start'), e = +txt(el, 'end'), inF = +txt(el, 'in')
      if (s < 0) { const t = list[i - 1]; if (t?.tag === 'transitionitem') { const mid = (+txt(t, 'start') + +txt(t, 'end')) / 2; inF += mid - +txt(t, 'start'); s = mid } }
      if (e < 0) { const t = list[i + 1]; if (t?.tag === 'transitionitem') e = (+txt(t, 'start') + +txt(t, 'end')) / 2 }
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ el, s, e, inF: Number.isFinite(inF) ? inF : 0 })
    })
    return out
  }
  const media = kid(seq, 'media')
  const vTracks = kidsOf(kid(media, 'video'), 'track'), aTracks = kidsOf(kid(media, 'audio'), 'track')
  // 影片自带的声音：音轨上跟某段画面同一份档、同一段时间的 ⇒ 并进那段画面（音量、静音照它）
  const own: { fid: string; s: number; e: number; clip: IClip; got: boolean }[] = []
  vTracks.forEach((tr, vi) => {
    if (txt(tr, 'enabled').toUpperCase() === 'FALSE') B.note('track-off')
    for (const { el, s, e, inF } of items(tr)) {
      const enabled = txt(el, 'enabled').toUpperCase() !== 'FALSE'
      if (el.tag === 'generatoritem') {
        const fx = kid(el, 'effect'), id = (txt(fx, 'effectid') || txt(fx, 'name')).toLowerCase()
        const str = txt(param(fx, 'str'), 'value')
        if (!/text|title|typewriter/.test(id) || !str) { B.note('generator'); continue }
        const size = +txt(param(fx, 'fontsize'), 'value')
        const col = kid(param(fx, 'fontcolor'), 'value')
        const al = txt(param(fx, 'fontalign'), 'value')
        const text: TlClip['text'] = { content: str.replace(/\r\n?/g, '\n').slice(0, 2000), x: 0.5, y: 0.5, size: clamp(size > 0 && H > 0 ? size * PR_TEXT_SCALE / H : 0.06, 0.03, 0.5) }
        if (col && kid(col, 'red')) text.color = rgbHex(+txt(col, 'red') / 255, +txt(col, 'green') / 255, +txt(col, 'blue') / 255)
        if (al === '1') text.align = 'left'; else if (al === '3') text.align = 'right'
        const org = kid(param(fx, 'origin'), 'value'); if (org && kid(org, 'horiz')) { text.x = clamp(0.5 + +txt(org, 'horiz'), 0, 1); text.y = clamp(0.5 + +txt(org, 'vert') - PR_TEXT_DROP * text.size, 0, 1) }
        B.push({ lk: 'text', z: vi || 1, mediaId: '', start: s / fps, length: (e - s) / fps, offset: 0, text, ...(enabled ? {} : { disabled: true }) })
        continue
      }
      // 文字工具图形：照字放文字段（⛔ 当素材·不然成了缺档）
      const fr = kid(el, 'file'), gts = kidsOf(el, 'filter').map((f) => kid(f, 'effect')).filter((fx): fx is XNode => txt(fx, 'effectid') === 'GraphicAndType')
      if (gts.length || txt(files.get(fr?.attrs.id ?? '') ?? fr, 'mediaSource') === 'GraphicAndType') {
        const ts = gts.map((fx) => gtText(fx, W, H)).filter((t): t is NonNullable<TlClip['text']> => !!t)
        if (!ts.length) B.note('generator')
        for (const text of ts) B.push({ lk: 'text', z: vi || 1, mediaId: '', start: s / fps, length: (e - s) / fps, offset: 0, text, ...(enabled ? {} : { disabled: true }) })
        continue
      }
      const m = mediaOf(el); if (!m) continue
      const sp = speedOf(el)
      for (const f of kidsOf(el, 'filter')) { const id = txt(kid(f, 'effect'), 'effectid').toLowerCase(); if (id && id !== 'timeremap' && id !== 'audiolevels') B.note(/basic|motion/.test(id) ? 'look' : 'fx') }
      const clip: Omit<IClip, 'id'> = { lk: m.kind === 'audio' ? 'audio' : 'visual', z: m.kind === 'audio' ? -0.5 : vi, mediaId: m.key, start: s / fps, length: (e - s) / fps, offset: m.kind === 'image' ? 0 : (inF / fps) * sp.speed }
      if (m.kind !== 'image' && Math.abs(sp.speed - 1) > 1e-4) clip.speed = Math.round(clamp(sp.speed, 0.1, 100) * 100) / 100
      if (sp.reverse) clip.reverse = true
      if (!enabled) clip.disabled = true
      const put = B.push(clip)
      if (put && m.kind === 'video') own.push({ fid: m.fid, s, e, clip: put, got: false })
    }
  })
  aTracks.forEach((tr, ai) => {
    for (const { el, s, e, inF } of items(tr)) {
      const m = mediaOf(el); if (!m) continue
      const g = levelOf(el)
      const enabled = txt(el, 'enabled').toUpperCase() !== 'FALSE'
      const pair = own.find((o) => o.fid === m.fid && Math.abs(o.s - s) <= 1 && Math.abs(o.e - e) <= 1)
      if (pair) { // 自带声音（立体声拆两条也一样）：第一条的音量算数
        if (!pair.got) { pair.got = true; if (g <= 0) pair.clip.muted = true; else if (Math.abs(g - 1) > 1e-3) pair.clip.volume = Math.round(g * 1000) / 1000 }
        continue
      }
      const sp = speedOf(el)
      const clip: Omit<IClip, 'id'> = { lk: 'audio', z: -(ai + 1), mediaId: m.key, start: s / fps, length: (e - s) / fps, offset: (inF / fps) * sp.speed }
      if (Math.abs(sp.speed - 1) > 1e-4) clip.speed = Math.round(clamp(sp.speed, 0.1, 100) * 100) / 100
      if (sp.reverse) clip.reverse = true
      if (g <= 0) clip.muted = true; else if (Math.abs(g - 1) > 1e-3) clip.volume = Math.round(g * 1000) / 1000
      if (!enabled) clip.disabled = true
      B.push(clip)
    }
  })
  // 影片在画面轨、声音却没出现在任何音轨（被删掉）⇒ 静音
  for (const o of own) if (!o.got && aTracks.length) o.clip.muted = true
  return B.result('premiere', txt(seq, 'name') || stem(fileName), ratioOfSize(W, H))
}

// ═══════════════════════ 剪映／CapCut 草稿 ═══════════════════════
type J = Record<string, unknown>
const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): J[] => (Array.isArray(v) ? v.filter(isObj) : [])
const n0 = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const US = 1_000_000
/** 文字素材的字与样式：新版 content 是 JSON {text, styles}；旧版是 <font …><size=…>[字]</size></font> 标记 */
function jyText(t: J): { text: string; size?: number; color?: string; bold?: boolean; italic?: boolean; underline?: boolean } | null {
  const raw = typeof t.content === 'string' ? t.content : ''
  try {
    const j = JSON.parse(raw) as J
    if (isObj(j) && typeof j.text === 'string') {
      const st = arr(j.styles)[0] ?? {}
      const col = isObj(st.fill) && isObj(st.fill.content) && isObj(st.fill.content.solid) && Array.isArray(st.fill.content.solid.color) ? st.fill.content.solid.color as number[] : null
      return { text: j.text, size: n0(st.size) || undefined, color: col && col.length >= 3 ? rgbHex(col[0], col[1], col[2]) : undefined, bold: st.bold === true || undefined, italic: st.italic === true || undefined, underline: st.underline === true || undefined }
    }
  } catch { /* 旧版标记 */ }
  if (!raw) return null
  const inner = /\[([\s\S]*)\]/.exec(raw)?.[1] ?? raw.replace(/<[^>]*>/g, '')
  const size = /<size=([\d.]+)>/.exec(raw)?.[1], col = /<color=\(([\d.]+),([\d.]+),([\d.]+)/.exec(raw)
  return { text: inner, size: size ? +size : undefined, color: col ? rgbHex(+col[1], +col[2], +col[3]) : undefined }
}

export function importJianying(text: string, fileName = ''): ImportedProject {
  let j: unknown
  const t = text.replace(/^\uFEFF/, '').trimStart()
  try { j = JSON.parse(t) } catch {
    throw t.startsWith('{') ? new ImportBad('broken', 'this Jianying draft is damaged (not valid JSON)')
      : new ImportBad('encrypted', 'this Jianying / CapCut draft is encrypted (newer Jianying saves drafts encrypted) and cannot be imported. Drafts saved by older Jianying versions, and drafts exported from this editor, can be imported.')
  }
  if (!isObj(j) || !Array.isArray(j.tracks) || !isObj(j.materials)) throw new ImportBad('broken', 'not a Jianying / CapCut draft (no tracks / materials)')
  const B = new Builder()
  const top = j
  const cc = isObj(top.canvas_config) ? top.canvas_config : {}
  let W = n0(cc.width), H = n0(cc.height)
  if (!(W > 0 && H > 0)) { // 「原始」比例：跟主轨第一段素材
    const mats = isObj(top.materials) ? arr(top.materials.videos) : []
    const mainSeg = arr(arr(top.tracks).find((x) => x.type === 'video')?.segments)[0]
    const v = mats.find((m) => m.id === mainSeg?.material_id) ?? mats[0]
    W = n0(v?.width, 1920); H = n0(v?.height, 1080)
  }
  /** 一份草稿的轨道 ⇒ 片段（tl0／窗口：复合片段摊开时用）：z 加在 zBase 上 */
  const draft = (d: J, win: { t0: number; s0: number; s1: number; sp: number; zBase: number; depth: number } | null) => {
    const mats = isObj(d.materials) ? d.materials : {}
    const byId = new Map<string, { cat: string; m: J }>()
    for (const [cat, list] of Object.entries(mats)) for (const m of arr(list)) if (typeof m.id === 'string') byId.set(m.id, { cat, m })
    const tracks = arr(d.tracks)
    const mainIdx = Math.max(0, tracks.findIndex((x) => x.type === 'video'))
    let aNo = 0
    const aAll = tracks.filter((x) => x.type === 'audio').length
    tracks.forEach((tr, ti) => {
      const type = String(tr.type)
      if (type === 'audio') aNo++
      if (!['video', 'audio', 'text'].includes(type)) { B.note(type === 'sticker' ? 'sticker' : type === 'filter' || type === 'adjust' ? 'filter' : type === 'effect' ? 'fx' : 'other-track'); return }
      const zLocal = type === 'audio' ? -(aAll - aNo + 1) : ti - mainIdx // 音轨：后面的那条在上（同汇出的排法）
      const z = win ? (type === 'audio' ? -1 - (win.depth + aNo) / 100 : win.zBase + zLocal / 100) : zLocal
      for (const sg of arr(tr.segments)) {
        const tt = isObj(sg.target_timerange) ? sg.target_timerange : {}
        let start = n0(tt.start) / US, len = n0(tt.duration) / US
        const st = isObj(sg.source_timerange) ? sg.source_timerange : null
        let offset = st ? n0(st.start) / US : 0
        const refs = (Array.isArray(sg.extra_material_refs) ? sg.extra_material_refs : []).map((x) => byId.get(String(x))).filter(Boolean) as { cat: string; m: J }[]
        let speed = n0(sg.speed, 0) || 1
        for (const r of refs) {
          if (r.cat === 'speeds') { speed = n0(r.m.speed, speed) || speed; if (r.m.curve_speed) B.note('curve') }
          else if (r.cat === 'transitions') B.note('transition')
          else if (r.cat === 'material_animations' && arr(r.m.animations).length) B.note('anim')
          else if (r.cat === 'masks' || r.cat === 'common_mask') B.note('mask')
          else if (r.cat === 'effects' || r.cat === 'video_effects') B.note('fx')
          else if (r.cat === 'beats' || r.cat === 'placeholder_infos' || r.cat === 'canvases' || r.cat === 'sound_channel_mappings' || r.cat === 'vocal_separations' || r.cat === 'loudnesses') { /* 无关画面 */ }
        }
        const mat = byId.get(String(sg.material_id))
        // 复合片段：素材没路径、挂着一份 drafts（combination）⇒ 照内层草稿摊开（剪进这段的窗口）
        const comb = refs.find((r) => r.cat === 'drafts' && isObj(r.m.draft))
        if (comb && (!mat || !String(mat.m.path ?? ''))) {
          if ((win?.depth ?? 0) >= 4) { B.note('compound'); continue }
          const zB = win ? win.zBase + zLocal / 100 : zLocal
          const sp = speed * (win?.sp ?? 1)
          let t0 = start, s0 = offset, s1 = offset + len * speed
          if (win) { const a = Math.max(start, win.s0), b = Math.min(start + len, win.s1); if (b <= a) continue; t0 = win.t0 + (a - win.s0) / win.sp; s0 = offset + (a - start) * speed; s1 = s0 + (b - a) * speed }
          draft(comb.m.draft as J, { t0, s0, s1, sp, zBase: zB, depth: (win?.depth ?? 0) + 1 })
          continue
        }
        if (!mat) continue
        // 窗口：这段只取 [s0,s1) 那一截、整段再按外层速度伸缩
        const place = (c: Omit<IClip, 'id'>) => {
          if (win) {
            const a = Math.max(c.start, win.s0), b = Math.min(c.start + c.length, win.s1)
            if (b <= a + 1e-6) return
            const sp0 = c.speed ?? 1
            c.offset += (a - c.start) * sp0
            c.start = win.t0 + (a - win.s0) / win.sp; c.length = (b - a) / win.sp
            const sp = sp0 * win.sp
            if (Math.abs(sp - 1) > 1e-4 && c.lk !== 'text') c.speed = Math.round(clamp(sp, 0.1, 100) * 100) / 100; else delete c.speed
          }
          B.push(c)
        }
        const visible = sg.visible !== false
        if (mat.cat === 'texts') {
          const tx = jyText(mat.m); if (!tx || !tx.text.trim()) continue
          const tf = isObj(sg.clip) && isObj(sg.clip.transform) ? sg.clip.transform : {}
          const text: TlClip['text'] = { content: tx.text.slice(0, 2000), x: clamp((n0(tf.x) + 1) / 2, 0, 1), y: clamp((1 - n0(tf.y)) / 2, 0, 1), size: clamp((tx.size ?? 8) / 100, 0.03, 0.5) }
          if (tx.color) text.color = tx.color
          if (tx.bold) text.bold = true; if (tx.italic) text.italic = true; if (tx.underline) text.underline = true
          const al = n0(mat.m.alignment, 1); if (al === 0) text.align = 'left'; else if (al === 2) text.align = 'right'
          place({ lk: 'text', z: Math.max(z, win ? z : 1), mediaId: '', start, length: len, offset: 0, text, ...(visible ? {} : { disabled: true }) })
          continue
        }
        if (mat.cat === 'stickers') { B.note('sticker'); continue }
        if (mat.cat !== 'videos' && mat.cat !== 'audios') { B.note('other-track'); continue }
        const path = decodeMediaPath(String(mat.m.path ?? ''))
        if (!path) { B.note('compound'); continue }
        const mt = String(mat.m.type ?? '')
        const kind: ProjectMediaKind = mat.cat === 'audios' ? 'audio' : mt === 'photo' || IMAGE_EXT.test(path) ? 'image' : 'video'
        const dur = n0(mat.m.duration) / US
        const key = B.addMedia(path, kind, kind === 'image' ? 0 : dur, String(mat.m.material_name ?? mat.m.name ?? '') || undefined, path)
        // 影片原声拆出来的（video_original_sound）：那份影片的声音 ⇒ 放音频轨、仍指同一份档
        if (mt === 'video_original_sound') { const m = B.media.get(key); if (m && m.kind === 'audio' && !AUDIO_EXT.test(path)) m.kind = 'video' }
        const isAudio = type === 'audio' || kind === 'audio'
        const c: Omit<IClip, 'id'> = { lk: isAudio ? 'audio' : 'visual', z: isAudio ? (z < 0 ? z : -0.5) : z, mediaId: key, start, length: len, offset: kind === 'image' ? 0 : offset }
        if (kind !== 'image' && Math.abs(speed - 1) > 1e-4) c.speed = Math.round(clamp(speed, 0.1, 100) * 100) / 100
        if (sg.reverse === true) c.reverse = true
        const vol = n0(sg.volume, 1); if (vol <= 0) c.muted = true; else if (Math.abs(vol - 1) > 1e-3) c.volume = Math.round(clamp(vol, 0, 10) * 1000) / 1000
        if (!visible) c.disabled = true
        for (const r of refs) if (r.cat === 'audio_fades') { const fi = n0(r.m.fade_in_duration) / US, fo = n0(r.m.fade_out_duration) / US; if (fi > 0) c.fadeIn = Math.round(Math.min(fi, 10) * 10) / 10; if (fo > 0) c.fadeOut = Math.round(Math.min(fo, 10) * 10) / 10 }
        // 画面位置、缩放、旋转、不透明度（剪映 transform 以半个画面为 1、y 朝上；我们的 look.x／y 以整个画面为 1、y 朝上）
        if (!isAudio && isObj(sg.clip)) {
          const cl = sg.clip, tf = isObj(cl.transform) ? cl.transform : {}, sc = isObj(cl.scale) ? cl.scale : {}
          const look: Record<string, number | boolean> = {}
          if (Math.abs(n0(tf.x)) > 1e-4) look.x = r6(n0(tf.x) / 2)
          if (Math.abs(n0(tf.y)) > 1e-4) look.y = r6(n0(tf.y) / 2)
          const sx = n0(sc.x, 1), sy = n0(sc.y, 1)
          if (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4) { look.sx = r6(sx); look.sy = r6(sy); if (Math.abs(sx - sy) > 1e-4) look.uniform = false }
          if (Math.abs(n0(cl.rotation)) > 1e-3) look.rot = r6(n0(cl.rotation))
          if (n0(cl.alpha, 1) < 0.999) look.opacity = r6(clamp(n0(cl.alpha, 1), 0, 1))
          if (isObj(cl.flip) && (cl.flip.horizontal === true || cl.flip.vertical === true)) { if (cl.flip.horizontal === true) look.flipH = true; if (cl.flip.vertical === true) look.flipV = true }
          if (Object.keys(look).length) c.look = look as TlClip['look']
        }
        if (arr(sg.common_keyframes).length) B.note('keyframes')
        place(c)
      }
    })
  }
  draft(top, null)
  const meta = typeof top.name === 'string' && top.name ? top.name : ''
  return B.result('jianying', meta || stem(fileName.replace(/[\\/](draft_content|draft_info|template)\.json(\.bak)?$/i, '')) || 'Jianying', ratioOfSize(W, H))
}

// ═══════════════════════ EDL（CMX3600） ═══════════════════════
const TC_RE = '\\d{1,2}[:;.]\\d{2}[:;.]\\d{2}[:;.]\\d{2}'
const EV_RE = new RegExp(`^(\\d{1,6})\\s+(\\S+)\\s+(\\S+)\\s+(C|D|W\\d{3}|KB|K\\s*O|K)\\s+(?:(\\d{1,3})\\s+)?(${TC_RE})\\s+(${TC_RE})\\s+(${TC_RE})\\s+(${TC_RE})\\s*$`, 'i')
/** 时间码 ⇒ 帧（drop＝29.97 丢帧算法：每分钟丢 2 帧号、逢十分钟不丢） */
function tcFrames(tc: string, base: number, drop: boolean): number {
  const [h, m, s, f] = tc.split(/[:;.]/).map(Number)
  const mins = h * 60 + m
  return (mins * 60 + s) * base + f - (drop ? 2 * (mins - Math.floor(mins / 10)) : 0)
}

export function importEdl(text: string, fileName = ''): ImportedProject {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const title = lines.map((l) => /^\s*TITLE:\s*(.*)$/i.exec(l)?.[1]).find((x) => x !== undefined)?.trim() ?? ''
  const drop = lines.some((l) => /^\s*FCM:\s*DROP/i.test(l))
  type Ev = { ch: string; tr: string; src: string[]; rec: string[]; name: string; path: string; to: string; m2: number | null }
  const evs: Ev[] = []
  for (const l of lines) {
    const e = EV_RE.exec(l.trim())
    if (e) { evs.push({ ch: e[3].toUpperCase(), tr: e[4].toUpperCase(), src: [e[6], e[7]], rec: [e[8], e[9]], name: e[2], path: '', to: '', m2: null }); continue }
    const cur = evs[evs.length - 1]
    if (!cur) continue
    let m: RegExpExecArray | null
    if ((m = /^\s*\*\s*FROM CLIP NAME:\s*(.*)$/i.exec(l))) cur.name = m[1].trim() || cur.name
    else if ((m = /^\s*\*\s*TO CLIP NAME:\s*(.*)$/i.exec(l))) cur.to = m[1].trim()
    else if ((m = /^\s*\*\s*(?:SOURCE FILE|FROM FILE|FROM CLIP):\s*(.*)$/i.exec(l))) cur.path = m[1].trim()
    else if ((m = new RegExp(`^\\s*M2\\s+.*?\\s(-?\\d+(?:\\.\\d+)?)\\s+(${TC_RE})\\s*$`, 'i').exec(l))) cur.m2 = +m[1]
  }
  if (!evs.length) throw new ImportBad(/^\s*TITLE:/im.test(text) ? 'empty' : 'broken', 'not an EDL (CMX3600) file, or it has no events')
  // EDL 不写帧率：时间码里出现 ≥30 的帧号 ⇒ 60；不然照 30（丢帧 ⇒ 29.97）
  const maxF = Math.max(...evs.flatMap((e) => [...e.src, ...e.rec].map((t) => +t.split(/[:;.]/)[3])))
  const base = maxF >= 30 ? 60 : 30
  const fps = drop ? base * 1000 / 1001 : base
  const B = new Builder()
  const recFr = evs.map((e) => e.rec.map((t) => tcFrames(t, base, drop)))
  const zero = Math.floor(Math.min(...recFr.map((r) => r[0])) / (3600 * base)) * 3600 * base
  type Placed = { key: string; s: number; e: number; clip: IClip | null; sound: boolean }
  const vids: Placed[] = []
  const auds: { key: string; s: number; e: number; c: Omit<IClip, 'id'> }[] = []
  evs.forEach((e, i) => {
    if (/^(BL|BLK|BLACK)$/i.test(e.name) && !e.path) return
    if (e.tr !== 'C') B.note('transition')
    const [r0, r1] = recFr[i]
    if (r1 <= r0) return
    const s0 = tcFrames(e.src[0], base, drop)
    const name = (e.tr === 'D' || e.tr.startsWith('W')) && e.to ? e.to : e.name
    const path = decodeMediaPath(e.path)
    const file = baseName(path) || name
    const ch = e.ch
    const hasV = /V/.test(ch) || ch === 'B', hasA = /A/.test(ch) || ch === 'B'
    const kind: ProjectMediaKind = IMAGE_EXT.test(file) ? 'image' : AUDIO_EXT.test(file) ? 'audio' : hasV ? 'video' : 'audio'
    // 同一份档在 V 行写了路径、A 行只写档名（Premiere 这样）⇒ 照档名认同一份·有路径的补上
    const key = B.addMedia(path || file, kind, 0, file, 'edl:' + file.toLowerCase())
    const mm = B.media.get(key)!
    if (path && mm.path === mm.file) mm.path = path
    if (kind === 'video' && mm.kind === 'audio') mm.kind = 'video'
    const sp = e.m2 !== null ? e.m2 / base : 1
    const c: Omit<IClip, 'id'> = { lk: kind === 'audio' ? 'audio' : 'visual', z: 0, mediaId: key, start: (r0 - zero) / fps, length: (r1 - r0) / fps, offset: kind === 'image' ? 0 : s0 / fps }
    if (kind !== 'image' && Math.abs(Math.abs(sp) - 1) > 1e-4 && sp !== 0) c.speed = Math.round(clamp(Math.abs(sp), 0.1, 100) * 100) / 100
    if (sp < 0) c.reverse = true
    if (hasV && kind !== 'audio') {
      const vn = /V(\d+)/.exec(ch)
      c.z = vn ? +vn[1] - 1 : 0
      vids.push({ key, s: r0, e: r1, clip: B.push(c), sound: hasA })
    } else {
      const an = /A(\d+)/.exec(ch)
      c.lk = 'audio'; c.z = -(an ? +an[1] : 1)
      auds.push({ key, s: r0, e: r1, c })
    }
  })
  // 画面事件在 V、声音另写在 A 同一段（Premiere 这样写）⇒ 并回画面；画面事件本身带声道（B、AA/V）也算有声音
  for (const a of auds) {
    const v = vids.find((x) => x.key === a.key && Math.abs(x.s - a.s) <= 1 && Math.abs(x.e - a.e) <= 1)
    if (v) { v.sound = true; continue }
    B.push(a.c)
  }
  if (auds.length || vids.some((v) => v.sound)) for (const v of vids) if (!v.sound && v.clip && B.media.get(v.key)?.kind === 'video') v.clip.muted = true
  return B.result('edl', title || stem(fileName), { kind: 'fit' })
}

// ═══════════════════════ OTIO（OpenTimelineIO JSON） ═══════════════════════
const rtSec = (v: unknown) => (isObj(v) && typeof v.value === 'number' && typeof v.rate === 'number' && v.rate > 0 ? v.value / v.rate : 0)
const schemaOf = (v: unknown) => (isObj(v) && typeof v.OTIO_SCHEMA === 'string' ? v.OTIO_SCHEMA.replace(/\.\d+$/, '') : '')

export function importOtio(text: string, fileName = ''): ImportedProject {
  let j: unknown
  try { j = JSON.parse(text.replace(/^﻿/, '')) } catch { throw new ImportBad('broken', 'this OTIO file is damaged (not valid JSON)') }
  if (schemaOf(j) === 'SerializableCollection') j = arr((j as J).children).find((x) => schemaOf(x) === 'Timeline')
  if (schemaOf(j) !== 'Timeline' || !isObj((j as J).tracks)) throw new ImportBad('broken', 'not an OpenTimelineIO timeline (no Timeline / tracks)')
  const tl = j as J
  const B = new Builder()
  const dmeta = isObj(tl.metadata) && isObj(tl.metadata.dilin) ? tl.metadata.dilin : {}
  const tracks = arr((tl.tracks as J).children)
  type V = { key: string; s: number; e: number; clip: IClip }
  const vids: V[] = []
  const auds: { key: string; s: number; e: number; c: Omit<IClip, 'id'>; meta: J }[] = []
  let vi = 0, ai = 0
  const refOf = (it: J): unknown => { const refs = isObj(it.media_references) ? it.media_references : null; return refs ? (refs[String(it.active_media_reference_key ?? 'DEFAULT_MEDIA')] ?? Object.values(refs)[0]) : it.media_reference }
  // 素材的时间码起点（达芬奇只在其中一段写 available_range）：同一个网址的片段共用
  const availStart = new Map<string, number>()
  for (const tr of tracks) for (const it of arr(tr.children)) {
    const r = refOf(it)
    if (isObj(r) && typeof r.target_url === 'string' && isObj(r.available_range) && !availStart.has(r.target_url)) availStart.set(r.target_url, rtSec(r.available_range.start_time))
  }
  for (const tr of tracks) {
    if (schemaOf(tr) !== 'Track') { B.note('compound'); continue }
    const isAudio = tr.kind === 'Audio'
    const z = isAudio ? -(++ai) : vi++
    if (tr.enabled === false) B.note('track-off')
    let t = 0
    for (const it of arr(tr.children)) {
      const sc = schemaOf(it)
      const sr = isObj(it.source_range) ? it.source_range : null
      if (sc === 'Transition') { B.note('transition'); continue }
      if (sc === 'Gap') { // 本编辑器写的文字段（Gap＋metadata.dilin.text）⇒ 文字；其余是空档
        const len = rtSec(sr?.duration), gm = isObj(it.metadata) && isObj(it.metadata.dilin) && isObj(it.metadata.dilin.text) ? it.metadata.dilin.text : null
        if (gm && typeof gm.content === 'string' && gm.content.trim() && len > 0) B.push({ lk: 'text', z: Math.max(1, z), mediaId: '', start: t, length: len, offset: 0, text: { ...gm, content: gm.content.slice(0, 2000), x: n0(gm.x, 0.5), y: n0(gm.y, 0.5), size: clamp(n0(gm.size, 0.06), 0.03, 0.5) } as TlClip['text'], ...(it.enabled === false ? { disabled: true } : {}) })
        t += len; continue
      }
      if (sc !== 'Clip') { if (sc === 'Stack' || sc === 'Track') B.note('compound'); t += rtSec(sr?.duration); continue }
      const ref = refOf(it)
      const avail = isObj(ref) && isObj(ref.available_range) ? ref.available_range : null
      const len = rtSec(sr?.duration) || rtSec(avail?.duration)
      const start = t
      t += len
      if (len <= 0) continue
      const meta: J = isObj(it.metadata) && isObj(it.metadata.dilin) ? it.metadata.dilin : {}
      let sp = 1
      for (const fx of arr(it.effects)) {
        const s = schemaOf(fx)
        if (s === 'LinearTimeWarp') sp *= typeof fx.time_scalar === 'number' ? fx.time_scalar : 1
        else if (s === 'FreezeFrame') B.note('freeze')
        else B.note('fx')
      }
      const rs = schemaOf(ref)
      if (rs === 'GeneratorReference' || isObj(meta.text)) {
        const mt = isObj(meta.text) ? meta.text : null
        const p = isObj(ref) && isObj(ref.parameters) ? ref.parameters : {}
        const content = typeof mt?.content === 'string' ? mt.content : typeof p.text === 'string' ? p.text : ''
        if (!content.trim()) { B.note('generator'); continue }
        const text = { ...(mt ?? {}), content: content.slice(0, 2000), x: n0(mt?.x, 0.5), y: n0(mt?.y, 0.5), size: clamp(n0(mt?.size, 0.06), 0.03, 0.5) } as TlClip['text']
        B.push({ lk: 'text', z: Math.max(1, z), mediaId: '', start, length: len, offset: 0, text, ...(it.enabled === false ? { disabled: true } : {}) })
        continue
      }
      if (rs === 'ImageSequenceReference') { B.note('image-seq'); continue }
      const target = isObj(ref) && typeof ref.target_url === 'string' ? ref.target_url : ''
      const path = decodeMediaPath(target)
      const name = String(it.name ?? '') || (isObj(ref) ? String(ref.name ?? '') : '')
      const file = baseName(path) || name
      if (!file) continue
      const dur = rtSec(avail?.duration)
      const kind: ProjectMediaKind = IMAGE_EXT.test(file) ? 'image' : AUDIO_EXT.test(file) || (isAudio && !/\.(mp4|mov|mkv|webm|avi|mxf|m4v)$/i.test(file)) ? 'audio' : 'video'
      const key = B.addMedia(path || file, kind, kind === 'image' ? 0 : dur, file, path || file)
      const off = Math.max(0, rtSec(sr?.start_time) - (avail ? rtSec(avail.start_time) : availStart.get(target) ?? 0))
      const c: Omit<IClip, 'id'> = { lk: isAudio || kind === 'audio' ? 'audio' : 'visual', z, mediaId: key, start, length: len, offset: kind === 'image' ? 0 : off }
      if (kind !== 'image' && Math.abs(Math.abs(sp) - 1) > 1e-4 && sp !== 0) c.speed = Math.round(clamp(Math.abs(sp), 0.1, 100) * 100) / 100
      if (sp < 0) c.reverse = true
      if (it.enabled === false) c.disabled = true
      if (typeof meta.fadeIn === 'number') c.fadeIn = meta.fadeIn
      if (typeof meta.fadeOut === 'number') c.fadeOut = meta.fadeOut
      const vol = typeof meta.volume === 'number' ? meta.volume : 1
      if (isAudio && kind === 'video') { auds.push({ key, s: start, e: start + len, c, meta }); continue }
      if (meta.muted === true || vol <= 0) c.muted = true; else if (Math.abs(vol - 1) > 1e-3) c.volume = vol
      if (c.lk === 'audio') { auds.push({ key, s: start, e: start + len, c, meta }); continue }
      const put = B.push(c)
      if (put && kind === 'video') vids.push({ key, s: start, e: start + len, clip: put })
    }
  }
  const got = new Set<V>()
  for (const a of auds) {
    const v = vids.find((x) => !got.has(x) && x.key === a.key && Math.abs(x.s - a.s) < 0.02 && Math.abs(x.e - a.e) < 0.02)
    if (v) { // 影片自带的声音 ⇒ 并回画面那段（音量照声音那段）
      got.add(v)
      const vol = typeof a.meta.volume === 'number' ? a.meta.volume : 1
      if (a.meta.muted === true || vol <= 0) v.clip.muted = true; else if (Math.abs(vol - 1) > 1e-3) v.clip.volume = vol
      continue
    }
    const vol = typeof a.meta.volume === 'number' ? a.meta.volume : 1
    if (a.meta.muted === true || vol <= 0) a.c.muted = true; else if (Math.abs(vol - 1) > 1e-3) a.c.volume = vol
    a.c.lk = 'audio'
    B.push(a.c)
  }
  if (ai) for (const v of vids) if (!got.has(v)) v.clip.muted = true
  const W = n0(dmeta.width), H = n0(dmeta.height)
  return B.result('otio', String(tl.name ?? '') || stem(fileName), W > 0 && H > 0 ? ratioOfSize(W, H) : { kind: 'fit' })
}

// ═══════════════════════ 对上素材 ⇒ 剪辑工程 ═══════════════════════
/** 汇入的工程 ⇒ 轨道：resolve(媒体) 回真的素材 id（对不上 ⇒ null：那份素材的片段拿掉、列进 missing）；文字片段照搬。 */
export function importedToTracks(p: ImportedProject, resolve: (m: ImportedMedia) => string | null, newId: () => string): { tracks: Tracks; missing: ImportedMedia[]; clips: number } {
  const map = new Map<string, string>(), missing: ImportedMedia[] = []
  for (const m of p.media) { const id = resolve(m); if (id) map.set(m.key, id); else missing.push(m) }
  let n = 0
  const tracks: Tracks = p.tracks.map((l) => ({ ...l, id: l.id === MAIN_LANE ? MAIN_LANE : newId(), clips: l.clips.flatMap((c) => {
    if (c.mediaId && !map.has(c.mediaId)) return []
    n++
    return [{ ...c, id: newId(), mediaId: c.mediaId ? map.get(c.mediaId)! : '' }]
  }) })).filter((l) => l.id === MAIN_LANE || l.clips.length)
  return { tracks, missing, clips: n }
}

/** 档名对档（不分大小写·去掉路径）：选进来的档里找跟工程里同名的 */
export function matchByName<T extends { name: string }>(media: ImportedMedia, files: readonly T[]): T | null {
  const want = media.file.toLowerCase()
  return files.find((f) => baseName(f.name).toLowerCase() === want) ?? null
}

const NOTE_TEXT: Record<string, [string, string, string]> = {
  transition: ['轉場', '转场', 'transitions'],
  fx: ['特效與濾鏡', '特效与滤镜', 'effects and filters'],
  look: ['畫面位置、縮放與裁切', '画面位置、缩放与裁切', 'position, scale and crop'],
  keyframes: ['關鍵幀', '关键帧', 'keyframes'],
  curve: ['曲線變速（改成平均速度）', '曲线变速（改成平均速度）', 'speed ramps (average speed used)'],
  compound: ['複合片段', '复合片段', 'compound clips'],
  multicam: ['多機位片段', '多机位片段', 'multicam clips'],
  generator: ['生成器（色塊、圖形等）', '生成器（色块、图形等）', 'generators (colour mattes, graphics)'],
  sticker: ['貼紙', '贴纸', 'stickers'],
  filter: ['濾鏡與調節', '滤镜与调节', 'filters and adjustments'],
  anim: ['動畫', '动画', 'animations'],
  mask: ['蒙版', '蒙版', 'masks'],
 freeze: ['定格', '定格', 'freeze frames'],
 'image-seq': ['圖片序列', '图片序列', 'image sequences'],
  'track-off': ['關掉的軌道（照樣匯入）', '关掉的轨道（照样汇入）', 'disabled tracks (imported anyway)'],
  'other-track': ['其他軌道', '其他轨道', 'other tracks'],
}
/** notes 代码 ⇒ 给人看的字（三语） */
export function importNoteText(code: string, lang: 'zh-TW' | 'zh-CN' | 'en'): string {
  const t = NOTE_TEXT[code]
  return t ? t[lang === 'zh-TW' ? 0 : lang === 'zh-CN' ? 1 : 2] : code
}
