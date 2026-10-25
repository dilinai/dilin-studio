// 网页剪辑页·追踪打码：
// 右栏「跟踪」页开「追踪打码」⇒ 预览上按住要打码的地方（会自动开始播放）跟着拖·每 0.1 秒记一笔 [素材第几秒, x, y]·放手存成这段片段身上的一条打码轨（工程档 clip.mosaic）；
// 某一小段重拖（选中那条再拖）⇒ 那段时间的旧笔换成新的·前后留着。形状（方／圆／圆角）、大小、模糊／像素块／纯色、强度、颜色都是轨上的栏位·角色读写工程档就能改样式不用重拖。
// 时间存「素材秒」（同关键帧）：片段挪位置、切开都跟着走；x／y／w／h＝占成片画面宽高的比例（打在合成好的画面上·跟片段自己的缩放位移无关）。
// 本档只放纯函数（题直接跑）；Canvas 画法在 mosaic-draw.ts（汇出）·预览画法在 video-edit/page.tsx（CSS）。
import { srcAt, type TlClip, type Tracks } from './timeline.pure'

export const MOSAIC_SHAPES = ['rect', 'round', 'ellipse'] as const
export const MOSAIC_MODES = ['pixel', 'blur', 'solid'] as const
export type MosaicShape = (typeof MOSAIC_SHAPES)[number]
export type MosaicMode = (typeof MOSAIC_MODES)[number]
/** pts＝[素材第几秒, 中心 x, 中心 y]（照时刻排好）；w／h＝框宽高（占画面宽／高）；strength 1～100；color＝纯色那款的颜色 */
export type Mosaic = { id: string; pts: Array<[number, number, number]>; shape: MosaicShape; mode: MosaicMode; w: number; h: number; strength: number; color: string }
export const MOSAIC_DEFAULT: Omit<Mosaic, 'id' | 'pts'> = { shape: 'ellipse', mode: 'pixel', w: 0.14, h: 0.2, strength: 50, color: '#000000' }
export const MOSAIC_MAX = 20
export const MOSAIC_MAX_PTS = 20000
/** 记一笔的间隔（秒·时间轴） */
export const MOSAIC_STEP = 0.1
/** 两笔之间空超过 2 秒（分两次记在同一条、被跳开）⇒ 不往中间补·当成断开（框不显） */
export const MOSAIC_GAP = 2

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10000) / 10000
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 读档验值：坏的丢、笔照时刻排好去重；全没了 ⇒ undefined */
export function parseMosaics(v: unknown): Mosaic[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Mosaic[] = []
  for (const raw of v.slice(0, MOSAIC_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const pts: Array<[number, number, number]> = []
    if (Array.isArray(o.pts)) for (const p of o.pts.slice(0, MOSAIC_MAX_PTS)) {
      if (!Array.isArray(p)) continue
      const t = num(p[0]), x = num(p[1]), y = num(p[2])
      if (t === null || x === null || y === null || t < 0) continue
      pts.push([r4(t), r4(clamp(x, -0.5, 1.5)), r4(clamp(y, -0.5, 1.5))])
    }
    pts.sort((a, b) => a[0] - b[0])
    const uniq = pts.filter((p, i) => !i || p[0] - pts[i - 1][0] > 1e-4)
    if (!uniq.length) continue
    const id = typeof o.id === 'string' && o.id && o.id.length <= 64 ? o.id : `m${out.length + 1}`
    out.push({
      id, pts: uniq,
      shape: (MOSAIC_SHAPES as readonly string[]).includes(String(o.shape)) ? (o.shape as MosaicShape) : MOSAIC_DEFAULT.shape,
      mode: (MOSAIC_MODES as readonly string[]).includes(String(o.mode)) ? (o.mode as MosaicMode) : MOSAIC_DEFAULT.mode,
      w: r4(clamp(num(o.w) ?? MOSAIC_DEFAULT.w, 0.01, 1)), h: r4(clamp(num(o.h) ?? MOSAIC_DEFAULT.h, 0.01, 1)),
      strength: Math.round(clamp(num(o.strength) ?? MOSAIC_DEFAULT.strength, 1, 100)),
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : MOSAIC_DEFAULT.color,
    })
  }
  return out.length ? out : undefined
}

export type MosaicSample = { t: number; x: number; y: number }
type ClipTime = Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve'>
const srcOf = (c: ClipTime, t: number) => srcAt({ start: c.start, length: c.length, offset: c.offset, speed: c.speed, curve: c.curve }, t)

/** 记好的笔写进片段：target＝选中那条的编号（有 ⇒ 拖过那段时间的旧笔换掉·前后留着）·没有／找不到 ⇒ 新开一条（newId·样式照 style）；
 * 段外的笔丢掉；一笔都不在段里 ⇒ 原样。回新的 mosaic 清单与写进哪一条 */
export function recordMosaic(c: ClipTime & Pick<TlClip, 'mosaic'>, samples: readonly MosaicSample[], target: string | null, newId: string, style: Partial<Omit<Mosaic, 'id' | 'pts'>> = {}): { list: Mosaic[] | undefined; id: string | null } {
  const inside = samples.filter((s) => s.t >= c.start - 1e-6 && s.t <= c.start + c.length + 1e-6)
  const list = [...(c.mosaic ?? [])]
  if (!inside.length) return { list: c.mosaic, id: null }
  const pts = inside.map((s): [number, number, number] => [r4(srcOf(c, s.t)), r4(s.x), r4(s.y)]).sort((a, b) => a[0] - b[0])
  const i = target ? list.findIndex((m) => m.id === target) : -1
  if (i >= 0) {
    const lo = pts[0][0] - 1e-4, hi = pts[pts.length - 1][0] + 1e-4
    const keep = list[i].pts.filter((p) => p[0] < lo || p[0] > hi)
    list[i] = { ...list[i], pts: [...keep, ...pts].sort((a, b) => a[0] - b[0]) }
    return { list: parseMosaics(list), id: list[i].id }
  }
  if (list.length >= MOSAIC_MAX) return { list: c.mosaic, id: null }
  list.push({ ...MOSAIC_DEFAULT, ...style, id: newId, pts })
  return { list: parseMosaics(list), id: newId }
}

/** 一条打码轨在素材第 s 秒的中心（两笔之间线性补；头尾外、断开处 ⇒ null） */
export function mosaicPos(m: Pick<Mosaic, 'pts'>, s: number): { x: number; y: number } | null {
  const p = m.pts
  if (!p.length) return null
  if (p.length === 1) return Math.abs(s - p[0][0]) <= MOSAIC_STEP ? { x: p[0][1], y: p[0][2] } : null
  if (s < p[0][0] - 1e-6 || s > p[p.length - 1][0] + 1e-6) return null
  let i = 0
  while (i < p.length - 2 && s >= p[i + 1][0]) i++
  const a = p[i], b = p[i + 1]
  if (b[0] - a[0] > MOSAIC_GAP) {
    if (Math.abs(s - a[0]) <= MOSAIC_STEP) return { x: a[1], y: a[2] }
    if (Math.abs(s - b[0]) <= MOSAIC_STEP) return { x: b[1], y: b[2] }
    return null
  }
  const k = b[0] > a[0] ? clamp((s - a[0]) / (b[0] - a[0]), 0, 1) : 1
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k }
}

/** 这一刻要打的码（画面坐标·0～1）：照轨道由下到上收·隐藏轨、停用段不算；only＝只看这几段（汇出选中段） */
export type MosaicBox = { id: string; clipId: string; x: number; y: number; w: number; h: number; shape: MosaicShape; mode: MosaicMode; strength: number; color: string }
export function mosaicsAt(tr: Tracks, t: number, only?: ReadonlySet<string>): MosaicBox[] {
  const out: MosaicBox[] = []
  for (const l of [...tr].reverse()) {
    if (l.kind !== 'visual' || l.hidden) continue
    for (const c of l.clips) {
      if (!c.mosaic?.length || c.disabled || (only && !only.has(c.id))) continue
      if (t < c.start - 1e-6 || t >= c.start + c.length) continue
      const s = srcOf(c, t)
      for (const m of c.mosaic) {
        const p = mosaicPos(m, s)
        if (p) out.push({ id: m.id, clipId: c.id, x: p.x, y: p.y, w: m.w, h: m.h, shape: m.shape, mode: m.mode, strength: m.strength, color: m.color })
      }
    }
  }
  return out
}

/** 强度 ⇒ 像素块边长／模糊半径（占画面高的比例·预览与汇出同一份） */
export const mosaicBlock = (strength: number) => 0.006 + (clamp(strength, 1, 100) / 100) * 0.05
export const mosaicBlur = (strength: number) => 0.004 + (clamp(strength, 1, 100) / 100) * 0.04
/** 框在像素画布上的位置（左上角与宽高） */
export function mosaicRect(b: Pick<MosaicBox, 'x' | 'y' | 'w' | 'h'>, W: number, H: number) {
  const w = b.w * W, h = b.h * H
  return { x: b.x * W - w / 2, y: b.y * H - h / 2, w, h }
}
/** 圆角那款的圆角（占框短边的比例） */
export const MOSAIC_ROUND = 0.25
/** 这一段的打码轨时间范围（素材秒）·面板列清单用 */
export const mosaicSpan = (m: Pick<Mosaic, 'pts'>) => (m.pts.length ? [m.pts[0][0], m.pts[m.pts.length - 1][0]] as const : null)
/** 改一条的样式（面板用）：null＝删掉那条 */
export function patchMosaic(list: readonly Mosaic[] | undefined, id: string, p: Partial<Omit<Mosaic, 'id'>> | null): Mosaic[] | undefined {
  const cur = list ?? []
  const next = p === null ? cur.filter((m) => m.id !== id) : cur.map((m) => (m.id === id ? { ...m, ...p } : m))
  return parseMosaics(next)
}
