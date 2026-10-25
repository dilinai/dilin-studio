// 网页剪辑页·片段操作：
// 定格（播放头那一帧停 3 秒·后面的往后推）、倒放（开关）、镜像（左右／上下翻·开关）、复制／粘贴属性（剪映 Ctrl+Alt+C／V）、汇出字幕（SRT）。
// 片段身上的新栏位（reverse／freeze／look.flipH／flipV／crop／bg）定义在 timeline.pure.ts 与 clip-look.pure.ts。本档只放纯函数（题直接跑）。⛔ 碰 DOM。
import { FRAME, MIN_CLIP, applyDrop, findClip, planDrop, snapFrame, speedOf, splitClip, srcAt, type Lane, type TextAnimSet, type TlClip, type Tracks } from './timeline.pure'
import { normalizeLook, setClipCurve, setClipSpeed, type ClipLook } from './clip-look.pure'

const EPS = 1e-6
const endOf = (c: TlClip) => c.start + c.length
const isMedia = (c: TlClip) => !!c.mediaId && !c.text && !c.sticker && !c.filter && !c.program

// ── 定格 ──
/** 定格多长（剪映默认 3 秒） */
export const FREEZE_SECONDS = 3
/** 能不能定格：画面轨上没锁的影片片段·播放头在它上面（含片头、片尾那一帧） */
export function canFreeze(tr: Tracks, id: string, at: number, isVideo: (c: TlClip) => boolean): boolean {
  const f = findClip(tr, id)
  if (!f || f.lane.locked || f.lane.kind !== 'visual' || f.clip.freeze || !isMedia(f.clip) || !isVideo(f.clip)) return false
  return at >= f.clip.start - EPS && at <= endOf(f.clip) + EPS
}
/** 在播放头把影片切开、中间插一段定格（停在那一帧）·同轨后面的片段一起往后推定格那么长（照剪映）。
 *  播放头在片头 ⇒ 定格放在片段前面（第一帧）；在片尾 ⇒ 放在后面（最后一帧）。回新轨与定格那段的编号；做不了 ⇒ null */
export function freezeFrame(tr: Tracks, id: string, at: number, ids: { freeze: string; right: string }, seconds = FREEZE_SECONDS): { tracks: Tracks; id: string } | null {
  const f = findClip(tr, id)
  if (!f) return null
  const c = f.clip
  const t = snapFrame(Math.min(endOf(c), Math.max(c.start, at)))
  const len = Math.max(MIN_CLIP, snapFrame(seconds))
  // 停在哪一帧：片尾那格取最后一帧（往前退一帧）
  const src = srcAt(c, t >= endOf(c) - EPS ? endOf(c) - FRAME : t)
  let out = tr
  const inside = t > c.start + MIN_CLIP - EPS && t < endOf(c) - MIN_CLIP + EPS
  if (inside) out = splitClip(out, id, t, ids.right)
  const lane = out.find((l) => l.id === f.lane.id)!
  // 播放头起（含切出来的后段）同轨往后推
  const moved = lane.clips.map((x) => (x.start >= t - EPS ? { ...x, start: snapFrame(x.start + len) } : x))
  const { transIn: _tr, anim: _an, group: _g, fadeIn: _fi, fadeOut: _fo, curve: _cv, reverse: _rv, volume: _v, muted: _m, ...base } = c
  void _tr; void _an; void _g; void _fi; void _fo; void _cv; void _rv; void _v; void _m
  const fz: TlClip = { ...base, id: ids.freeze, start: t, length: len, offset: Math.max(0, src), freeze: true }
  delete fz.speed
  const clips = [...moved, fz].sort((a, b) => a.start - b.start)
  return { tracks: out.map((l) => (l.id === lane.id ? { ...l, clips } : l)), id: ids.freeze }
}

// ── 倒放 ──
/** 能倒放的：没锁的影片／音频片段（定格、图片不行） */
export const canReverse = (lane: Lane, c: TlClip, kind: string | undefined) => !lane.locked && isMedia(c) && !c.freeze && (kind === 'video' || kind === 'audio')
/** 倒放开关（几段一起：只要有一段还没倒放 ⇒ 全部倒放·都倒放了 ⇒ 全部取消）；曲线变速先改回常规（两样不并用·长度不变） */
export function toggleReverse(tr: Tracks, ids: readonly string[], kindOf: (mediaId: string) => string | undefined): Tracks {
  const hits = ids.map((id) => findClip(tr, id)).filter((f): f is { lane: Lane; clip: TlClip } => !!f && canReverse(f.lane, f.clip, kindOf(f.clip.mediaId)))
  if (!hits.length) return tr
  const on = hits.some((f) => !f.clip.reverse)
  let out = tr
  for (const h of hits) {
    if (on && h.clip.curve) out = setClipCurve(out, h.clip.id, null)
    out = out.map((l) => (l.id !== h.lane.id ? l : { ...l, clips: l.clips.map((x) => { if (x.id !== h.clip.id) return x; const n = { ...x }; if (on) n.reverse = true; else delete n.reverse; return n }) }))
  }
  return out
}

// ── 镜像 ──
/** 镜像开关（剪映「镜像」那颗＝左右翻；上下翻在面板里）：几段一起·只要有一段没翻 ⇒ 全翻·都翻了 ⇒ 全翻回来 */
export function toggleFlip(tr: Tracks, ids: readonly string[], axis: 'h' | 'v'): Tracks {
  const k = axis === 'h' ? 'flipH' : 'flipV'
  const want = new Set(ids)
  const hits = tr.flatMap((l) => (l.kind === 'visual' && !l.locked ? l.clips.filter((c) => want.has(c.id) && isMedia(c)) : []))
  if (!hits.length) return tr
  const on = hits.some((c) => !c.look?.[k])
  const ok = new Set(hits.map((c) => c.id))
  return tr.map((l) => ({ ...l, clips: l.clips.map((c) => { if (!ok.has(c.id)) return c; const look = normalizeLook({ ...(c.look ?? {}), [k]: on }); const n = { ...c }; if (look) n.look = look; else delete n.look; return n }) }))
}

// ── 复制／粘贴属性（剪映 Ctrl+Alt+C／V）──
/** 拷下来的属性：画面（look·含调节、蒙版、镜像、裁剪、背景）、动画、特效、音量、淡入淡出、变调、常规变速 */
export type AttrPack = { look?: ClipLook; anim?: TextAnimSet; fx?: TlClip['fx']; volume?: number; fadeIn?: number; fadeOut?: number; pitch?: boolean; speed?: number; aud?: TlClip['aud'] }
export function copyAttrs(tr: Tracks, ids: readonly string[]): AttrPack | null {
  for (const id of ids) {
    const f = findClip(tr, id)
    if (!f || !isMedia(f.clip)) continue
    const c = f.clip
    const p: AttrPack = {}
    if (f.lane.kind === 'visual') { if (c.look) p.look = c.look; if (c.anim) p.anim = c.anim; if (c.fx?.length) p.fx = c.fx }
    if (c.volume !== undefined) p.volume = c.volume
    if (c.fadeIn) p.fadeIn = c.fadeIn
    if (c.fadeOut) p.fadeOut = c.fadeOut
    if (c.pitch) p.pitch = true
    if (c.aud) p.aud = c.aud
    if (!c.curve && !c.freeze) p.speed = speedOf(c)
    return p
  }
  return null
}
/** 贴到选中的几段（锁了的轨不动·画面那几样只贴画面轨·声音那几样只贴有声音的·变速只贴能变速的〔图片、定格不贴〕）；
 *  贴上的就整份换掉（没拷到的那样拿掉＝跟来源一样·剪映同）·关键帧、曲线变速不贴 */
export function pasteAttrs(tr: Tracks, ids: readonly string[], p: AttrPack, can: { sound: (c: TlClip) => boolean; speed: (c: TlClip) => boolean }): Tracks {
  const want = new Set(ids)
  const sp: string[] = []
  let out = tr.map((l) => {
    if (l.locked) return l
    let hit = false
    const clips = l.clips.map((c) => {
      if (!want.has(c.id) || !isMedia(c)) return c
      hit = true
      const n: TlClip = { ...c }
      if (l.kind === 'visual') {
        if (p.look) n.look = p.look; else delete n.look
        if (p.anim) n.anim = p.anim; else delete n.anim
        if (p.fx?.length) n.fx = p.fx; else delete n.fx
      }
      if (can.sound(c)) {
        if (p.volume !== undefined) n.volume = p.volume; else delete n.volume
        const lim = (v?: number) => (v ? Math.min(v, Math.round(c.length * 10) / 10) : 0)
        if (lim(p.fadeIn)) n.fadeIn = lim(p.fadeIn); else delete n.fadeIn
        if (lim(p.fadeOut)) n.fadeOut = lim(p.fadeOut); else delete n.fadeOut
        if (p.pitch) n.pitch = true; else delete n.pitch
        if (p.aud) n.aud = p.aud; else delete n.aud
      }
      if (p.speed !== undefined && can.speed(c) && !c.freeze && Math.abs(speedOf(c) - p.speed) > 1e-6) sp.push(c.id)
      return n
    })
    return hit ? { ...l, clips } : l
  })
  for (const id of sp) out = setClipSpeed(out, id, p.speed!)
  return out
}

// ── 汇出字幕（SRT）──
const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), x = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}
/** 文字轨上的字（没藏的轨·没停用的段·有字的）照时间排成 SRT；only 给了 ⇒ 只算那几段·时间从 from 起算（汇出选中段时对得上成片） */
export function tracksToSrt(tr: Tracks, opts: { only?: ReadonlySet<string>; from?: number } = {}): string {
  const from = opts.from ?? 0
  const items = tr.filter((l) => l.kind === 'text' && !l.hidden)
    .flatMap((l) => l.clips.filter((c) => c.text && !c.disabled && c.text.content.trim() && (!opts.only || opts.only.has(c.id))))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  return items.map((c, i) => `${i + 1}\n${srtTime(c.start - from)} --> ${srtTime(endOf(c) - from)}\n${c.text!.content.trim()}\n`).join('\n')
}
// ── 黑场／白场 ──
/** 黑场白场一段多长（剪映 3 秒） */
export const SOLID_SECONDS = 3
export const SOLID_COLORS = { black: '#000000', white: '#ffffff' } as const
export const solidFileName = (k: keyof typeof SOLID_COLORS) => (k === 'black' ? '黑场.png' : '白场.png')

// ── 调节层（剪映「调节」拖上轨道）──
/** 在播放头放一段调节层（滤镜轨·被占 ⇒ 往上开一条）·回新轨与它的编号 */
export function addAdjustLayer(tr: Tracks, at: number, ids: { clip: string; lane: string }, seconds = ADJUST_SECONDS): { tracks: Tracks; id: string } {
  const len = Math.max(MIN_CLIP, snapFrame(seconds))
  const plan = planDrop(tr, 'filter', null, snapFrame(Math.max(0, at)), len)
  const c: TlClip = { id: ids.clip, mediaId: '', start: plan.start, length: len, offset: 0, adjust: true }
  return { tracks: applyDrop(tr, plan, c, ids.lane), id: ids.clip }
}
export const ADJUST_SECONDS = 3
