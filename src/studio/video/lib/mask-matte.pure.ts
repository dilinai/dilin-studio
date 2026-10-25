// 网页剪辑页·蒙版与合成（百叶窗开场缺口单第 3–6 项）：
//   ① 条纹蒙版 shape:"stripes"（条数 count／间隙 gap／角度＝蒙版 rot／进度 progress 0..1 可打关键帧／每条间隔 stagger／缓动 ease）
//   ② 一个片段挂多个蒙版（look.masks＋look.maskOp:"and"|"or"）
//   ③ 轨道遮罩 look.matte（用上方或指定的文字／贴纸轨同一刻的形状当遮罩·alpha 或亮度·可反相·那条本身不显示）
//   ④ 混合模式跨文字层：blend 挂在哪一层（预览外框·免得阴影 filter 把它关进自己的叠层）
// 预览（CSS mask-image）与汇出（canvas destination-in）吃同一份：蒙版都走 clip-look.pure 的 masksSvg（本档出条纹形状与多蒙版合成）；
//   轨道遮罩都走 ui/matte-draw.ts 的 drawMatteOps＋本档 matteAlpha（逐像素同一个公式）。
// 本档只放纯函数（node 题直接跑）。
import type { Tracks, TlClip } from './timeline.pure'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r4 = (v: number) => Math.round(v * 10000) / 10000

/** 药：DILIN_NEG 含 vedit_mask_matte_off ⇒ 条纹不分条（整块）·多蒙版只认第一个·轨道遮罩不生效·blend 退回挂里层（只在 node 测试跑） */
export function maskMatteNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_mask_matte_off')
}

// ── ① 条纹 ──
export const STRIPE_EASES = ['linear', 'in', 'out', 'inout'] as const
export type StripeEase = (typeof STRIPE_EASES)[number]
export const STRIPE_COUNT_MAX = 60
/** 条纹缺省：12 条·间隙 0·进度 1（全开）·每条间隔 0.5·缓出 */
export const STRIPE_DEFAULT = { count: 12, gap: 0, progress: 1, stagger: 0.5, ease: 'out' as StripeEase }
const easeF = (e: StripeEase, x: number) => (e === 'in' ? x * x : e === 'out' ? 1 - (1 - x) * (1 - x) : e === 'inout' ? (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)) : x)
/**
 * 进度 p（0..1）时每条展开了几成（0..1）：stagger＝0 ⇒ 一起展开；1 ⇒ 一条接一条（前一条开完下一条才动）。
 * 每条走 d＝1/(1+(n−1)·stagger) 的进度·第 i 条从 i·stagger·d 开始·再套缓动。p=0 全关、p=1 全开。
 */
export function stripeCover(count: number, progress: number, stagger: number, ease: StripeEase = 'linear'): number[] {
  const n = Math.max(1, Math.round(count)), s = clamp(stagger, 0, 1), p = clamp(progress, 0, 1)
  if (maskMatteNegOff()) return Array.from({ length: n }, () => 1)
  const d = 1 / (1 + (n - 1) * s)
  return Array.from({ length: n }, (_, i) => r4(easeF(ease, clamp((p - i * s * d) / d, 0, 1))))
}
/** 条纹那几条在蒙版框里的位置（框的单位：0..1 从上往下）：[上缘, 高]·每条从上缘往下展开·gap＝每格空出几成 */
export function stripeBands(m: { count?: number; gap?: number; progress?: number; stagger?: number; ease?: StripeEase }): Array<[number, number]> {
  const n = Math.max(1, Math.round(m.count ?? STRIPE_DEFAULT.count)), P = 1 / n, full = P * (1 - clamp(m.gap ?? 0, 0, 0.95))
  const cov = stripeCover(n, m.progress ?? STRIPE_DEFAULT.progress, m.stagger ?? STRIPE_DEFAULT.stagger, m.ease ?? STRIPE_DEFAULT.ease)
  return cov.map((c, i) => [r4(i * P), r4((maskMatteNegOff() ? P : full) * c)] as [number, number])
}
/** 条纹形状（SVG·框中心 cx,cy·大小 w×h·旋转由外层 g 套） */
export function stripesShape(m: Parameters<typeof stripeBands>[0], cx: number, cy: number, w: number, h: number): string {
  const x0 = cx - w / 2, y0 = cy - h / 2
  return stripeBands(m).filter(([, bh]) => bh > 0).map(([y, bh]) => `<rect x="${r4(x0)}" y="${r4(y0 + y * h)}" width="${r4(w)}" height="${r4(bh * h)}"/>`).join('')
}
/** 条纹参数验值（读档／改动都过这里） */
export function normStripe(o: Record<string, unknown>): { count: number; gap: number; progress: number; stagger: number; ease: StripeEase } {
  const e = typeof o.ease === 'string' && (STRIPE_EASES as readonly string[]).includes(o.ease) ? (o.ease as StripeEase) : STRIPE_DEFAULT.ease
  return { count: Math.round(clamp(num(o.count) ?? STRIPE_DEFAULT.count, 1, STRIPE_COUNT_MAX)), gap: r4(clamp(num(o.gap) ?? STRIPE_DEFAULT.gap, 0, 0.95)),
    progress: r4(clamp(num(o.progress) ?? STRIPE_DEFAULT.progress, 0, 1)), stagger: r4(clamp(num(o.stagger) ?? STRIPE_DEFAULT.stagger, 0, 1)), ease: e }
}

// ── ② 多蒙版 ──
export const MASK_OPS = ['and', 'or'] as const
/** and＝交集（每个都留下的地方才看得到·缺省）；or＝并集（任一个留下就看得到） */
export type MaskOp = (typeof MASK_OPS)[number]
export const MASKS_MAX = 8
/** 这段挂的蒙版清单：look.masks（两个以上才存）优先·否则旧档的单个 look.mask；药 ⇒ 只认第一个 */
export function masksOfLook<M>(l: { mask?: M | null; masks?: M[] | null }): M[] {
  const all = l.masks && l.masks.length ? l.masks : l.mask ? [l.mask] : []
  return maskMatteNegOff() ? all.slice(0, 1) : all
}
/** 改清单第 i 个（i 超出 ⇒ 加在后面）；返回新清单 */
export function patchMaskList<M extends object>(list: readonly M[], i: number, p: Partial<M>): M[] {
  const out = list.slice()
  if (i >= 0 && i < out.length) out[i] = { ...out[i], ...p }
  return out
}
/** 写档：一个 ⇒ 只写 mask（旧格式）；两个以上 ⇒ mask＝第一个（旧版读得到第一个）＋masks＝全部 */
export function storeMasks<M>(list: readonly M[]): { mask?: M; masks?: M[] } {
  if (!list.length) return {}
  return list.length === 1 ? { mask: list[0] } : { mask: list[0], masks: list.slice(0, MASKS_MAX) }
}

// ── ③ 轨道遮罩 ──
export const MATTE_MODES = ['alpha', 'luma'] as const
export type MatteMode = (typeof MATTE_MODES)[number]
/** lane＝当遮罩的那条轨 id（缺＝这条上面最近一条文字／贴纸轨）；mode＝alpha（形状）或 luma（亮度）；invert＝反相（挖掉形状） */
export type ClipMatte = { lane?: string; mode: MatteMode; invert?: boolean }
export function parseMatte(v: unknown): ClipMatte | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const m: ClipMatte = { mode: o.mode === 'luma' ? 'luma' : 'alpha' }
  if (typeof o.lane === 'string' && o.lane) m.lane = o.lane
  if (o.invert === true) m.invert = true
  return m
}
const isMatteKind = (k: string) => k === 'text' || k === 'sticker'
/** 片段 laneId 的遮罩用哪条轨：指定的（要是文字／贴纸轨）；缺 ⇒ 往上（tracks 里 index 小＝上面）找最近一条文字／贴纸轨；找不到 ⇒ null */
export function matteLaneOf(tr: Tracks, laneId: string, m: ClipMatte | undefined | null): string | null {
  if (!m) return null
  if (m.lane) { const l = tr.find((x) => x.id === m.lane); return l && l.id !== laneId && isMatteKind(l.kind) ? l.id : null }
  const i = tr.findIndex((x) => x.id === laneId)
  for (let j = i - 1; j >= 0; j--) if (isMatteKind(tr[j].kind)) return tr[j].id
  return null
}
const activeAt = (cs: readonly TlClip[], t: number) => cs.find((c) => !c.disabled && t >= c.start - 1e-9 && t < c.start + c.length - 1e-9)
/** 这一刻被拿来当遮罩的轨（那几条本身不画）：画面轨此刻那段挂了 matte 且看得到 ⇒ 它的遮罩轨；药 ⇒ 空 */
export function matteLanesAt(tr: Tracks, t: number): Map<string, string> {
  const out = new Map<string, string>()
  if (maskMatteNegOff()) return out
  for (const l of tr) {
    if (l.kind !== 'visual' || l.hidden) continue
    const c = activeAt(l.clips, t)
    const m = c?.look?.matte
    if (!c || !m) continue
    const src = matteLaneOf(tr, l.id, m)
    if (src) out.set(src, l.id)
  }
  return out
}
/** 遮罩画好的 RGBA 像素 ⇒ 改成「白＋alpha＝留下多少」（汇出 destination-in·预览 mask-image 同一张）：
 *  alpha 模式＝原 alpha；luma 模式＝亮度(Rec.709)×alpha；invert＝1−那个值 */
export function matteAlpha(px: Uint8ClampedArray | number[], mode: MatteMode, invert = false): void {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255
    let v = mode === 'luma' ? ((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255) * a : a
    if (invert) v = 1 - v
    px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = Math.round(clamp(v, 0, 1) * 255)
  }
}

// ── ④ 混合模式挂哪层 ──
/** 预览：blend 挂外框（outer＝跟文字等兄弟层同一个叠层·阴影 filter／轨道遮罩 mask 也在外框·不会把 blend 关进自己的叠层）；药 ⇒ inner（旧：挂里层） */
export const blendHost = (): 'outer' | 'inner' => (maskMatteNegOff() ? 'inner' : 'outer')
