// 网页剪辑页·运动跟踪（motion tracking）：
// 影片片段属性「跟踪」页框一处（矩形）＋起始时刻 ⇒ 浏览器逐格读帧（ui/track-client.ts）·本档 NCC 模板匹配算出那块每一格的中心与缩放 ⇒ 存成这段片段身上的一条跟踪路径 clip.mtrack；
// 文字／贴纸片段 clip.follow＝{ clip 影片片段编号, track 路径编号, at 绑定那一刻的素材秒 } ⇒ 整层跟着那块画面走（平移＋以跟踪点为心缩放）。
// 文字仍是文字片段：字、字体、样式、位置都照常改（follow 只是外加的一层位移·不碰 text 本体）。
// 预览（CSS matrix·followCssMatrix）与汇出（canvas setTransform·followAffine）都由 followAt 这同一个纯函数算。
// 时间存「素材秒」（同关键帧／打码轨）：影片片段挪位置、切开都跟着走；x／y＝占成片画面宽高的比例；s＝相对起始框的大小（起始＝1）。
// 本档只放纯函数（题直接跑）。
// 路径点存在「影片片段没套自身变换时」的画面座标（照比例置中那块）；跟随时再照这段片段这一刻的位移／旋转／缩放（含关键帧、片段动画）映射到画面
// ⇒ 片段放大、挪位、打关键帧推拉，字照样贴着那块画面（hostXf／hostMap·框选反算用 hostUnmap）。裁剪不移动画面、不用扣。
import { srcAt, type TlClip, type Tracks } from './timeline.pure'
import { clipAnimPose, lookOf, lookXform } from './clip-look.pure'

/** pts＝[素材秒, 中心 x, 中心 y, 缩放]（照时刻排好）；w／h＝起始框宽高（占画面宽／高·画框提示用） */
export type MTrack = { id: string; pts: Array<[number, number, number, number]>; w: number; h: number }
/** 文字／贴纸跟随：clip＝影片片段编号（切开后找同一条路径的那半）；track＝路径编号；at＝绑定那一刻（路径素材秒·那时位移为 0、缩放 1） */
export type ClipFollow = { clip: string; track: string; at: number }
export const MTRACK_MAX = 10
export const MTRACK_MAX_PTS = 20000
/** 追踪取样间隔（素材秒） */
export const MTRACK_STEP = 1 / 15

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10000) / 10000
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ID_OK = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v)

const negOn = (k: string) => { const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''; return typeof window === 'undefined' && env.split(',').includes(k) }
/** 药：DILIN_NEG 含 vedit_track_follow_off ⇒ 跟随不生效（只在 node 测试跑） */
export function followNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_track_follow_off')
}

// ── 读档验值 ──
export function parseMTracks(v: unknown): MTrack[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: MTrack[] = []
  for (const raw of v.slice(0, MTRACK_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (!ID_OK(o.id) || out.some((m) => m.id === o.id)) continue
    const pts: Array<[number, number, number, number]> = []
    if (Array.isArray(o.pts)) for (const p of o.pts.slice(0, MTRACK_MAX_PTS)) {
      if (!Array.isArray(p)) continue
      const t = num(p[0]), x = num(p[1]), y = num(p[2]), s = num(p[3]) ?? 1
      if (t === null || x === null || y === null || t < 0) continue
      pts.push([r4(t), r4(clamp(x, -1, 2)), r4(clamp(y, -1, 2)), r4(clamp(s, 0.05, 20))])
    }
    pts.sort((a, b) => a[0] - b[0])
    const uniq = pts.filter((p, i) => !i || p[0] - pts[i - 1][0] > 1e-4)
    if (!uniq.length) continue
    out.push({ id: o.id, pts: uniq, w: r4(clamp(num(o.w) ?? 0.1, 0.005, 1)), h: r4(clamp(num(o.h) ?? 0.1, 0.005, 1)) })
  }
  return out.length ? out : undefined
}
export function parseFollow(v: unknown): ClipFollow | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const at = num(o.at)
  if (!ID_OK(o.clip) || !ID_OK(o.track) || at === null || at < 0) return undefined
  return { clip: o.clip, track: o.track, at: r4(at) }
}

/** 一条路径在素材第 s 秒的点（两点之间线性补·头尾外 ⇒ 停在头／尾） */
export function mtrackAt(m: Pick<MTrack, 'pts'>, s: number): { x: number; y: number; s: number } | null {
  const p = m.pts
  if (!p.length) return null
  if (s <= p[0][0]) return { x: p[0][1], y: p[0][2], s: p[0][3] }
  const z = p[p.length - 1]
  if (s >= z[0]) return { x: z[1], y: z[2], s: z[3] }
  let lo = 0, hi = p.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid][0] <= s) lo = mid; else hi = mid }
  const a = p[lo], b = p[hi], k = b[0] > a[0] ? (s - a[0]) / (b[0] - a[0]) : 0
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, s: a[3] + (b[3] - a[3]) * k }
}

type ClipTime = Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve'> & Partial<Pick<TlClip, 'reverse' | 'freeze'>>
const srcOf = (c: ClipTime, t: number) => srcAt(c, t)
/** 追踪要读哪几格：从时间轴第 t0 秒往后到片段结尾·每 MTRACK_STEP 秒（时间轴）一格·回素材秒（最多 max 格） */
export function trackTimes(c: ClipTime, t0: number, max = 900, dir: 'fwd' | 'back' = 'fwd'): number[] {
  const a = clamp(t0, c.start, c.start + c.length), out: number[] = []
  if (dir === 'back') { // 往前追：从播放头一格格退到片段开头（开头那格一定算进去）
    for (let t = Math.min(a, c.start + c.length - 1e-6); t > c.start + 1e-4 && out.length < max - 1; t -= MTRACK_STEP) out.push(r4(srcOf(c, t)))
    const s0 = r4(srcOf(c, c.start)); if (out[out.length - 1] !== s0) out.push(s0)
    return out
  }
  for (let t = a; t < c.start + c.length - 1e-6 && out.length < max; t += MTRACK_STEP) out.push(r4(srcOf(c, t)))
  return out
}

/** 影片片段这一刻的画面变换（位移／旋转／缩放·同预览 lookStyle 与汇出 xfm）：以画面正中为心 */
export type HostXf = { tx: number; ty: number; rot: number; sx: number; sy: number }
type HostClip = Pick<TlClip, 'look' | 'anim' | 'start' | 'length'> & Partial<Pick<TlClip, 'kf' | 'offset' | 'speed' | 'curve'>>
export function hostXf(c: HostClip, t: number): HostXf {
  if (negOn('vedit_track_host_off')) return HOST_ID
  const x = lookXform(lookOf(c, t), clipAnimPose(c, t))
  return { tx: x.tx, ty: x.ty, rot: x.rot, sx: x.sx, sy: x.sy }
}
const HOST_ID: HostXf = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 }
const isId = (h: HostXf) => Math.abs(h.tx) < 1e-6 && Math.abs(h.ty) < 1e-6 && Math.abs(h.rot) < 1e-6 && Math.abs(h.sx - 1) < 1e-6 && Math.abs(h.sy - 1) < 1e-6
/** 片段座标（未变换·画面比例）⇒ 画面比例；aspect＝画面宽／高（旋转要用） */
export function hostMap(h: HostXf, aspect: number, x: number, y: number): [number, number] {
  if (isId(h)) return [x, y]
  const A = aspect > 0 ? aspect : 16 / 9, r = (h.rot * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r)
  const dx = (x - 0.5) * A * h.sx, dy = (y - 0.5) * h.sy
  return [0.5 + (dx * co - dy * si) / A + h.tx / 100, 0.5 + dx * si + dy * co + h.ty / 100]
}
/** 反过来：画面比例 ⇒ 片段座标（框选换算） */
export function hostUnmap(h: HostXf, aspect: number, x: number, y: number): [number, number] {
  if (isId(h)) return [x, y]
  const A = aspect > 0 ? aspect : 16 / 9, r = (h.rot * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r)
  const ux = (x - 0.5 - h.tx / 100) * A, uy = y - 0.5 - h.ty / 100
  const dx = ux * co + uy * si, dy = -ux * si + uy * co
  return [0.5 + dx / (A * (h.sx || 1)), 0.5 + dy / (h.sy || 1)]
}
const hostScale = (h: HostXf) => Math.sqrt(Math.abs(h.sx * h.sy)) || 1
/** 画面上的框（中心＋宽高·画面比例）⇒ 片段座标的框（宽高除掉缩放·旋转只转中心） */
export function boxToHost(b: TrackBox, h: HostXf, aspect: number): TrackBox {
  const [x, y] = hostUnmap(h, aspect, b.x, b.y)
  return { x, y, w: b.w / (Math.abs(h.sx) || 1), h: b.h / (Math.abs(h.sy) || 1) }
}
/** 素材第 s 秒落在时间轴第几秒（倒查·曲线变速／倒放也行：取样找最近） */
export function tlAtSrc(c: ClipTime, s: number): number {
  if (!c.curve && !(c as { reverse?: boolean }).reverse && !(c as { freeze?: boolean }).freeze) {
    const sp = c.speed && c.speed > 0 ? c.speed : 1
    return clamp(c.start + (s - c.offset) / sp, c.start, c.start + c.length)
  }
  let best = c.start, bd = Infinity
  for (let i = 0; i <= 400; i++) { const t = c.start + (c.length * i) / 400, d = Math.abs(srcOf(c, t) - s); if (d < bd) { bd = d; best = t } }
  return best
}

/** 重追合并：新算的一段（times 素材秒·照追的方向排）盖掉旧路径同方向那一截·其余旧点留着 */
export function mergeMTrack(old: MTrack, add: MTrack, dir: 'fwd' | 'back'): MTrack | null {
  if (!add.pts.length) return old
  const pts = [...add.pts].sort((a, b) => a[0] - b[0])
  const lo = pts[0][0], hi = pts[pts.length - 1][0]
  const keep = old.pts.filter((p) => (dir === 'fwd' ? p[0] < lo - 1e-4 : p[0] > hi + 1e-4))
  // 接缝（往后追＝新段开头·往前追＝新段结尾）对齐旧路径那一刻：新段缩放从 1 起算 ⇒ 乘上旧路径该刻缩放；位置平移到旧路径该刻 ⇒ 字不跳
  const seam = dir === 'fwd' ? pts[0] : pts[pts.length - 1], o = mtrackAt(old, seam[0])
  const k = o && !mergeSeamNegOff() && seam[3] > 0 ? o.s / seam[3] : 1, dx = o && !mergeSeamNegOff() ? o.x - seam[1] : 0, dy = o && !mergeSeamNegOff() ? o.y - seam[2] : 0
  const fit = pts.map((p): [number, number, number, number] => [p[0], p[1] + dx, p[2] + dy, p[3] * k])
  return parseMTracks([{ id: old.id, pts: [...keep, ...fit], w: old.w, h: old.h }])?.[0] ?? null
}
/** 药：DILIN_NEG 含 vedit_retrack_seam_off ⇒ 重追不对齐接缝（只在 node 测试跑） */
const mergeSeamNegOff = () => negOn('vedit_retrack_seam_off')

/** 时间轴第 t 秒这段（文字／贴纸）的跟随变换：(x,y) ↦ (qx + (x−q0x)·k, qy + (y−q0y)·k)（画面比例座标）；
 * q0＝绑定那刻路径点·q／k＝这一刻的点与相对缩放。没绑／找不到路径 ⇒ null（照原位）。
 * 影片片段切开了 ⇒ 先找这一刻正盖着 t 的那半（带同一条路径）·没有就用绑的那段 */
export type FollowXf = { q0x: number; q0y: number; qx: number; qy: number; k: number }
export function followAt(tr: Tracks, c: Pick<TlClip, 'follow'>, t: number, aspect = 16 / 9): FollowXf | null {
  const f = c.follow
  if (!f || followNegOff()) return null
  let host: TlClip | null = null, track: MTrack | null = null
  for (const l of tr) {
    if (l.kind !== 'visual') continue
    for (const x of l.clips) {
      const m = x.mtrack?.find((q) => q.id === f.track)
      if (!m) continue
      const covers = t >= x.start - 1e-6 && t < x.start + x.length
      if (covers || (!host && x.id === f.clip)) { host = x; track = m }
      if (covers) break
    }
  }
  if (!host || !track) return null
  const p0 = mtrackAt(track, f.at), p = mtrackAt(track, srcOf(host, t))
  if (!p0 || !p) return null
  // 路径点是片段座标：绑定那刻、这一刻各照当时的片段变换映射到画面（片段推拉／挪位时字跟着那块画面）
  const h0 = host.look || host.kf || host.anim ? hostXf(host, tlAtSrc(host, f.at)) : HOST_ID, h = host.look || host.kf || host.anim ? hostXf(host, t) : HOST_ID
  const [q0x, q0y] = hostMap(h0, aspect, p0.x, p0.y), [qx, qy] = hostMap(h, aspect, p.x, p.y)
  return { q0x, q0y, qx, qy, k: (p0.s > 0 ? p.s / p0.s : 1) * (hostScale(h) / hostScale(h0)) }
}
/** 画面比例座标的一点经跟随后落在哪 */
export const followPoint = (f: FollowXf | null, x: number, y: number): [number, number] => (f ? [f.qx + (x - f.q0x) * f.k, f.qy + (y - f.q0y) * f.k] : [x, y])
/** 汇出：canvas setTransform／transform 参数（像素·原点左上）a,b,c,d,e,f */
export function followAffine(f: FollowXf, W: number, H: number): [number, number, number, number, number, number] {
  return [f.k, 0, 0, f.k, (f.qx - f.q0x * f.k) * W, (f.qy - f.q0y * f.k) * H]
}
/** 预览：整层（舞台 px 大小·transform-origin 正中）的 CSS matrix（同 followAffine 换成以正中为原点） */
export function followCssMatrix(f: FollowXf, w: number, h: number): string {
  const [a, , , d, e, g] = followAffine(f, w, h)
  // 以正中 (cx,cy) 为原点：p' − c = a(p − c) + (a·c + e − c)
  const tx = a * w / 2 + e - w / 2, ty = d * h / 2 + g - h / 2
  return `matrix(${a}, 0, 0, ${d}, ${r4(tx)}, ${r4(ty)})`
}

/** 能跟的路径（面板下拉用）：所有画面轨影片片段身上的路径 */
export function followChoices(tr: Tracks): Array<{ clip: string; track: string; n: number; span: [number, number] }> {
  const out: Array<{ clip: string; track: string; n: number; span: [number, number] }> = []
  const seen = new Set<string>()
  for (const l of tr) if (l.kind === 'visual') for (const x of l.clips) for (const m of x.mtrack ?? []) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push({ clip: x.id, track: m.id, n: out.length + 1, span: [m.pts[0][0], m.pts[m.pts.length - 1][0]] })
  }
  return out
}
/** 绑上：at＝时间轴第 t 秒那一刻路径的素材秒（那刻字照原位） */
export function bindFollow(tr: Tracks, clipId: string, trackId: string, t: number): ClipFollow | null {
  for (const l of tr) if (l.kind === 'visual') for (const x of l.clips) {
    if (x.id !== clipId || !x.mtrack?.some((m) => m.id === trackId)) continue
    return { clip: clipId, track: trackId, at: r4(Math.max(0, srcOf(x, clamp(t, x.start, x.start + x.length - 1e-6)))) }
  }
  return null
}

// ── 追踪算法（NCC 模板匹配·灰阶帧）──
export type Gray = { w: number; h: number; d: Float32Array | Uint8ClampedArray | number[] }
/** RGBA 像素 ⇒ 灰阶 */
export function toGray(rgba: ArrayLike<number>, w: number, h: number): Gray {
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
  return { w, h, d }
}
function sample(g: Gray, x: number, y: number): number {
  const xi = clamp(x, 0, g.w - 1), yi = clamp(y, 0, g.h - 1)
  const x0 = Math.floor(xi), y0 = Math.floor(yi), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1)
  const fx = xi - x0, fy = yi - y0, d = g.d
  const a = d[y0 * g.w + x0], b = d[y0 * g.w + x1], c = d[y1 * g.w + x0], e = d[y1 * g.w + x1]
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy
}
/** 以 (cx,cy)（像素）为心、宽高 bw×bh 的那块重采成 tw×th 并减均值除标准差 */
function patch(g: Gray, cx: number, cy: number, bw: number, bh: number, tw: number, th: number, out: Float32Array): boolean {
  let sum = 0
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const v = sample(g, cx - bw / 2 + ((i + 0.5) / tw) * bw, cy - bh / 2 + ((j + 0.5) / th) * bh)
    out[j * tw + i] = v; sum += v
  }
  const n = tw * th, mean = sum / n
  let ss = 0
  for (let i = 0; i < n; i++) { out[i] -= mean; ss += out[i] * out[i] }
  const sd = Math.sqrt(ss / n)
  if (sd < 1e-3) return false
  for (let i = 0; i < n; i++) out[i] /= sd
  return true
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length }

export type TrackBox = { x: number; y: number; w: number; h: number } // 中心与宽高（占帧宽／高）
export type TrackOpts = { search?: number; scales?: readonly number[]; scale?: boolean; tpl?: number; adapt?: number }
export type TrackPt = { x: number; y: number; s: number; score: number }
/** 逐格追（串流版·浏览器一格一格喂）：create(f0, box) ⇒ step(下一格) 回这一格的位置 */
export function createTracker(f0: Gray, box: TrackBox, opts: TrackOpts = {}) {
  const bw0 = box.w * f0.w, bh0 = box.h * f0.h
  const tplN = opts.tpl ?? 24
  const k = Math.min(1, tplN / Math.max(bw0, bh0))
  const tw = Math.max(4, Math.round(bw0 * k)), th = Math.max(4, Math.round(bh0 * k))
  const tpl = new Float32Array(tw * th), cand = new Float32Array(tw * th)
  let cx = box.x * f0.w, cy = box.y * f0.h, s = 1
  if (!patch(f0, cx, cy, bw0, bh0, tw, th, tpl)) patch(f0, cx, cy, bw0 + 2, bh0 + 2, tw, th, tpl)
  const scales = opts.scale === false ? [1] : opts.scales ?? [0.94, 1, 1.06]
  const first: TrackPt = { x: cx / f0.w, y: cy / f0.h, s: 1, score: 1 }
  const step = (g: Gray): TrackPt => {
    const R = Math.max(2, Math.round((opts.search ?? 0.08) * Math.min(g.w, g.h)))
    const st = Math.max(1, Math.round(R / 12))
    let best = { x: cx, y: cy, s, v: -2 }
    const tryAt = (x: number, y: number, ss: number) => {
      if (!patch(g, x, y, bw0 * ss, bh0 * ss, tw, th, cand)) return
      const v = dot(tpl, cand)
      if (v > best.v) best = { x, y, s: ss, v }
    }
    for (const sc of scales) { const ss = clamp(s * sc, 0.1, 10); for (let dy = -R; dy <= R; dy += st) for (let dx = -R; dx <= R; dx += st) tryAt(cx + dx, cy + dy, ss) }
    // 细修：步长减半直到半像素（缩放另试 ±2%）
    for (let sp = Math.max(0.5, st / 2); ; sp /= 2) {
      const b = best
      for (const sc of scales.length > 1 ? [0.98, 1, 1.02] : [1]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tryAt(b.x + dx * sp, b.y + dy * sp, clamp(b.s * sc, 0.1, 10))
      if (sp <= 0.5) break
    }
    cx = best.x; cy = best.y; s = best.s
    const ad = opts.adapt ?? 0.1
    if (ad > 0 && best.v > 0.85 && patch(g, cx, cy, bw0 * s, bh0 * s, tw, th, cand)) for (let j = 0; j < tpl.length; j++) tpl[j] = tpl[j] * (1 - ad) + cand[j] * ad
    return { x: cx / g.w, y: cy / g.h, s, score: best.v }
  }
  return { first, step }
}
/** 逐格追（整串）：frames[0] 上的 box ⇒ 每格 {x,y,s,score}（x／y 占帧宽高·s 相对起始框）。
 * 做法：起始框重采成 ≤tpl×tpl 的模板（零均值单位方差）·下一格在上一格位置 ±search（占帧短边）内网格搜 NCC 最高·再逐次减半步长细修到半像素；
 * scale ⇒ 每格另试几个相对缩放（默认 0.94/1/1.06）。模板每格以 0.1 比例慢慢掺新貌（分数高才掺）·抗慢慢变形又不太漂。onStep 回 false ⇒ 中止 */
export function trackFrames(frames: readonly Gray[], box: TrackBox, opts: TrackOpts = {}, onStep?: (i: number) => boolean | void): TrackPt[] {
  if (!frames.length) return []
  const tk = createTracker(frames[0], box, opts)
  const out = [tk.first]
  for (let i = 1; i < frames.length; i++) { if (onStep && onStep(i) === false) break; out.push(tk.step(frames[i])) }
  return out
}

/** 追好的结果写成一条路径：times＝每格的素材秒；帧座标（占素材帧）⇒ 画面座标用 map（影片在画面里那块·没给＝整个画面） */
export function makeMTrack(id: string, times: readonly number[], res: ReadonlyArray<{ x: number; y: number; s: number }>, box: TrackBox, map: TrackBox = { x: 0.5, y: 0.5, w: 1, h: 1 }): MTrack | null {
  const n = Math.min(times.length, res.length)
  const toX = (x: number) => map.x - map.w / 2 + x * map.w, toY = (y: number) => map.y - map.h / 2 + y * map.h
  const pts: Array<[number, number, number, number]> = []
  for (let i = 0; i < n; i++) pts.push([times[i], toX(res[i].x), toY(res[i].y), res[i].s])
  return parseMTracks([{ id, pts, w: box.w * map.w, h: box.h * map.h }])?.[0] ?? null
}
/** 改／删一条（null＝删） */
export function patchMTracks(list: readonly MTrack[] | undefined, id: string, m: MTrack | null): MTrack[] | undefined {
  const cur = list ?? []
  if (!m) return parseMTracks(cur.filter((x) => x.id !== id))
  // 已有同编号 ⇒ 原位替换（重追后清单顺序、名字「路徑 N」不变）；新的才接在最后
  return parseMTracks(cur.some((x) => x.id === id) ? cur.map((x) => (x.id === id ? m : x)) : [...cur, m])
}
