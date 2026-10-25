// 网页剪辑页·调色与抠像：HSL（八个色相各调色相／饱和度／亮度）、曲线（总亮度＋红绿蓝）、
// 色轮（暗部／中灰／亮部／偏移）、LUT（内建几款电影色·调强度）、色度抠像（取一个颜色挖掉·强度／边缘柔化／去溢色）；调节层（滤镜轨上的「调节」片段）也走这一套。
// 这几样都是「一个颜色进、一个颜色出」⇒ 全部烤成一张 3D 查表（GRADE_N³ 格·RGBA·A＝抠像留下几成）：
// 预览（VeditGradeCanvas·WebGL2 3D 纹理线性取样）与汇出（applyGradeLut·CPU 三线性内插）吃同一张表 ⇒ 两边一致。
// 「调整」16 项里能逐点算的（色温色调、饱和度、明暗曲线）调节层也烤进表；锐化、清晰、颗粒、暗角要看邻居／位置·调节层不套（片段自己的照旧走 SVG 滤镜）。
// 本档只放纯函数（题直接跑）。⛔ 碰 DOM。
import { adjActive, toneTable, type ClipAdjust } from './clip-look.pure'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r3 = (v: number) => Math.round(v * 1000) / 1000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const HEX = /^#[0-9a-f]{6}$/i
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

// ── HSL ──
export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'] as const
export type HslBand = (typeof HSL_BANDS)[number]
/** 各色相中心（度）·面板色块的颜色 */
export const HSL_HUE: Record<HslBand, number> = { red: 0, orange: 30, yellow: 60, green: 120, cyan: 180, blue: 225, purple: 270, magenta: 320 }
/** h＝色相偏移、s＝饱和度、l＝亮度（各 -100～100） */
export type HslAdj = { h?: number; s?: number; l?: number }
export type ClipHsl = Partial<Record<HslBand, HslAdj>>

// ── 曲线 ──
export const CURVE_CHANNELS = ['rgb', 'r', 'g', 'b'] as const
export type CurveChannel = (typeof CURVE_CHANNELS)[number]
/** 每条曲线＝几个点 [输入, 输出]（0～1·x 由小到大·至少两点）；缺＝直线 */
export type ClipCurves = Partial<Record<CurveChannel, Array<[number, number]>>>
export const CURVE_IDENTITY: Array<[number, number]> = [[0, 0], [1, 1]]

// ── 色轮 ──
export const WHEELS = ['lift', 'gamma', 'gain', 'offset'] as const
export type WheelKey = (typeof WHEELS)[number]
/** x／y＝色盘上的点（单位圆内·角度＝往哪个颜色偏·离中心多远＝偏多少）；l＝旁边那条亮度（-100～100） */
export type Wheel = { x: number; y: number; l: number }
export type ClipWheels = Partial<Record<WheelKey, Wheel>>

// ── LUT（内建电影色）──
export const LUT_IDS = ['teal-orange', 'film', 'kodak', 'bleach', 'mono', 'vintage', 'cool', 'warm', 'cyber', 'matte'] as const
export type LutId = (typeof LUT_IDS)[number]
export type ClipLut = { id: LutId; strength: number }

// ── 抠像 ──
/** color＝挖掉的颜色；sim＝强度（多接近才挖·0～100）；soft＝边缘柔化（0～100）；spill＝去溢色（0～100） */
export type ClipKey = { color: string; sim: number; soft: number; spill: number }
export const KEY_DEFAULT: ClipKey = { color: '#00ff00', sim: 35, soft: 15, spill: 40 }

/** 一份调色（片段自己的或调节层的）；adj＝调节层才带（只套逐点那几项） */
export type Grade = { hsl?: ClipHsl; curves?: ClipCurves; wheels?: ClipWheels; lut?: ClipLut; key?: ClipKey; adj?: ClipAdjust }

// ── 读档验值 ──
export function parseHsl(v: unknown): ClipHsl | undefined {
  if (!isObj(v)) return undefined
  const o: ClipHsl = {}
  for (const b of HSL_BANDS) {
    const x = v[b]
    if (!isObj(x)) continue
    const a: HslAdj = {}
    for (const k of ['h', 's', 'l'] as const) { const n = num(x[k]); if (n !== null && Math.round(n)) a[k] = clamp(Math.round(n), -100, 100) }
    if (Object.keys(a).length) o[b] = a
  }
  return Object.keys(o).length ? o : undefined
}
export function normCurvePts(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null
  const pts = v.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
    .map((p) => [r3(c01(p[0])), r3(c01(p[1]))] as [number, number]).sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const p of pts) if (!out.length || p[0] - out[out.length - 1][0] >= 0.01) out.push(p)
  if (out.length < 2 || out.length > 16) return null
  return out
}
const isIdentity = (pts: Array<[number, number]>) => pts.every((p) => Math.abs(p[0] - p[1]) < 1e-4) && pts[0][0] <= 1e-4 && pts[pts.length - 1][0] >= 1 - 1e-4
export function parseCurves(v: unknown): ClipCurves | undefined {
  if (!isObj(v)) return undefined
  const o: ClipCurves = {}
  for (const c of CURVE_CHANNELS) { const p = normCurvePts(v[c]); if (p && !isIdentity(p)) o[c] = p }
  return Object.keys(o).length ? o : undefined
}
export function normWheel(w: unknown): Wheel | null {
  if (!isObj(w)) return null
  let x = num(w.x) ?? 0, y = num(w.y) ?? 0
  const r = Math.hypot(x, y)
  if (r > 1) { x /= r; y /= r }
  const l = clamp(Math.round(num(w.l) ?? 0), -100, 100)
  if (Math.hypot(x, y) < 1e-3 && !l) return null
  return { x: r3(x), y: r3(y), l }
}
export function parseWheels(v: unknown): ClipWheels | undefined {
  if (!isObj(v)) return undefined
  const o: ClipWheels = {}
  for (const k of WHEELS) { const w = normWheel(v[k]); if (w) o[k] = w }
  return Object.keys(o).length ? o : undefined
}
export function parseLut(v: unknown): ClipLut | undefined {
  if (!isObj(v) || !(LUT_IDS as readonly string[]).includes(String(v.id))) return undefined
  const s = clamp(Math.round(num(v.strength) ?? 100), 0, 100)
  return s ? { id: v.id as LutId, strength: s } : undefined
}
export function parseKey(v: unknown): ClipKey | undefined {
  if (!isObj(v) || typeof v.color !== 'string' || !HEX.test(v.color)) return undefined
  const k = (n: unknown, d: number) => clamp(Math.round(num(n) ?? d), 0, 100)
  return { color: v.color.toLowerCase(), sim: k(v.sim, KEY_DEFAULT.sim), soft: k(v.soft, KEY_DEFAULT.soft), spill: k(v.spill, KEY_DEFAULT.spill) }
}
/** 有没有要烤表的东西 */
export function gradeActive(g: Grade | null | undefined): boolean {
  if (!g) return false
  return !!(g.hsl && Object.keys(g.hsl).length) || !!(g.curves && Object.keys(g.curves).length) || !!(g.wheels && Object.keys(g.wheels).length) || !!(g.lut && g.lut.strength > 0) || !!g.key || adjPointActive(g.adj)
}
const adjPointActive = (a?: ClipAdjust) => !!a && (['temp', 'tint', 'sat', 'vib', 'bright', 'contrast', 'highlight', 'shadow', 'white', 'black', 'light', 'fade'] as const).some((k) => (a[k] ?? 0) !== 0)

// ── 每一步的颜色运算（0～1）──
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d < 1e-9) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60; if (h < 0) h += 360
  return [h, Math.min(1, s), l]
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }
const smooth = (e0: number, e1: number, x: number) => { const t = c01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
/** 某色相属于这个色带几成：照两边相邻色带的中心距离做平滑三角（几条加起来＝1） */
function bandWeight(b: HslBand, h: number): number {
  const i = HSL_BANDS.indexOf(b), c = HSL_HUE[b]
  const prev = HSL_HUE[HSL_BANDS[(i + 7) % 8]], next = HSL_HUE[HSL_BANDS[(i + 1) % 8]]
  const toPrev = hueDist(c, prev), toNext = hueDist(c, next)
  const d = hueDist(h, c)
  const ahead = ((h - c + 540) % 360) - 180 >= 0
  const span = ahead ? toNext : toPrev
  if (d >= span) return 0
  const t = 1 - d / span
  return t * t * (3 - 2 * t)
}
export function applyHsl(r: number, g: number, b: number, hsl: ClipHsl): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b)
  if (s < 1e-4) return [r, g, b]
  let dh = 0, ds = 0, dl = 0
  for (const band of HSL_BANDS) {
    const a = hsl[band]
    if (!a) continue
    const w = bandWeight(band, h)
    if (!w) continue
    dh += w * (a.h ?? 0) * 0.3; ds += w * (a.s ?? 0) / 100; dl += w * (a.l ?? 0) / 100
  }
  const gate = smooth(0, 0.12, s) // 近灰的颜色不动
  const ns = c01(s * (1 + ds * gate))
  const nl = c01(l + dl * gate * 0.5 * s * (1 - Math.abs(2 * l - 1) * 0.5))
  return hslToRgb(h + dh * gate, ns, nl)
}

/** 单调三次曲线（Fritsch–Carlson·不会冲过头）照点取值 */
export function curveFn(pts: ReadonlyArray<[number, number]>): (x: number) => number {
  const n = pts.length
  if (n < 2) return (x) => x
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - x))
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], bb = m[i + 1] / d[i], s = a * a + bb * bb
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * bb * d[i] }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t
    return c01((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1])
  }
}

/** 色轮点 ⇒ 三个通道各偏多少（色相环上那个颜色减掉平均·离中心越远越多） */
export function wheelTint(w: Pick<Wheel, 'x' | 'y'>): [number, number, number] {
  const amt = Math.min(1, Math.hypot(w.x, w.y))
  if (amt < 1e-6) return [0, 0, 0]
  const deg = (Math.atan2(-w.y, w.x) * 180) / Math.PI // 上＝正 y·画面往上是 -y
  const [r, g, b] = hslToRgb(deg, 1, 0.5)
  const mean = (r + g + b) / 3
  return [(r - mean) * amt, (g - mean) * amt, (b - mean) * amt]
}
function applyWheels(c: [number, number, number], w: ClipWheels): [number, number, number] {
  const T = (k: WheelKey) => (w[k] ? wheelTint(w[k]!) : [0, 0, 0])
  const L = (k: WheelKey) => (w[k]?.l ?? 0) / 100
  const tl = T('lift'), tg = T('gamma'), tn = T('gain'), to = T('offset')
  return c.map((v, i) => {
    const lift = tl[i] * 0.35 + L('lift') * 0.25
    const gain = 1 + tn[i] * 0.6 + L('gain') * 0.5
    const gam = Math.exp(-(tg[i] * 0.8 + L('gamma') * 0.7))
    const off = to[i] * 0.25 + L('offset') * 0.2
    const x = c01(v * gain + lift * (1 - v))
    return c01(Math.pow(x, gam) + off)
  }) as [number, number, number]
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const sCurve = (x: number, k: number) => { const y = 1 / (1 + Math.exp(-k * (x - 0.5))), y0 = 1 / (1 + Math.exp(k / 2)), y1 = 1 / (1 + Math.exp(-k / 2)); return (y - y0) / (y1 - y0) }
/** 内建 LUT（自己写的色调·不是哪家的档）：颜色进、颜色出 */
export function lutColor(id: LutId, r: number, g: number, b: number): [number, number, number] {
  const Y = luma(r, g, b)
  switch (id) {
    case 'teal-orange': { // 暗部偏青、亮部与肤色偏橙
      const t = smooth(0.15, 0.85, Y)
      return [c01(sCurve(r, 5) + mix(-0.06, 0.07, t)), c01(sCurve(g, 5) + mix(0.02, 0.01, t)), c01(sCurve(b, 5) + mix(0.07, -0.08, t))]
    }
    case 'film': { const k = (v: number) => 0.06 + 0.88 * sCurve(v, 4); const s = 0.85; return [c01(k(mix(Y, r, s)) + 0.02), c01(k(mix(Y, g, s))), c01(k(mix(Y, b, s)) - 0.02)] }
    case 'kodak': { const k = (v: number) => sCurve(v, 4.5); return [c01(k(r) * 1.04 + 0.01), c01(k(g) * 1.0), c01(k(b) * 0.92 + 0.02)] }
    case 'bleach': { const m = sCurve(Y, 7); const s = 0.45; return [c01(mix(m, sCurve(r, 7), s)), c01(mix(m, sCurve(g, 7), s)), c01(mix(m, sCurve(b, 7), s))] }
    case 'mono': { const m = sCurve(Y, 5); return [m, m, m] }
    case 'vintage': { const k = (v: number) => 0.1 + 0.8 * v; const t = smooth(0, 1, Y); return [c01(k(r) + 0.05 * t), c01(k(g) + 0.03), c01(k(b) * 0.85 + 0.06 * (1 - t))] }
    case 'cool': return [c01(r * 0.92), c01(g * 0.99 + 0.01), c01(b * 1.08 + 0.03)]
    case 'warm': return [c01(r * 1.08 + 0.02), c01(g * 1.01), c01(b * 0.86)]
    case 'cyber': { const t = smooth(0.2, 0.8, Y); return [c01(sCurve(r, 4) + mix(0.02, 0.1, t)), c01(sCurve(g, 4) * 0.9), c01(sCurve(b, 4) + mix(0.12, 0.04, t))] }
    case 'matte': { const k = (v: number) => 0.09 + 0.84 * sCurve(v, 3.2); return [k(mix(Y, r, 0.8)), k(mix(Y, g, 0.8)), k(mix(Y, b, 0.8))] }
  }
}

/** 抠像：颜色离要挖的颜色多远（YCbCr 的色度平面·不看亮度）⇒ 留下几成；去溢色＝把那个颜色通道多出来的部分砍掉 */
export function keyAlpha(r: number, g: number, b: number, k: ClipKey): { a: number; rgb: [number, number, number] } {
  const [kr, kg, kb] = hexRgb(k.color)
  const cb = (x: [number, number, number]) => -0.1146 * x[0] - 0.3854 * x[1] + 0.5 * x[2]
  const cr = (x: [number, number, number]) => 0.5 * x[0] - 0.4542 * x[1] - 0.0458 * x[2]
  const p: [number, number, number] = [r, g, b], q: [number, number, number] = [kr, kg, kb]
  const d = Math.hypot(cb(p) - cb(q), cr(p) - cr(q))
  const lo = (k.sim / 100) * 0.45, hi = lo + 0.005 + (k.soft / 100) * 0.3
  const a = smooth(lo, hi, d)
  let rgb = p
  if (k.spill > 0) {
    // 去溢色（经典 despill）：要挖那颜色最强的通道（绿幕＝绿）比另两个的平均多出来的部分照强度砍掉·其它颜色不动
    const kd = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0
    const o = [0, 1, 2].filter((i) => i !== kd)
    const excess = p[kd] - (p[o[0]] + p[o[1]]) / 2
    if (excess > 0) { rgb = [...p] as [number, number, number]; rgb[kd] = p[kd] - excess * (k.spill / 100) }
  }
  return { a, rgb }
}

/** 调节层的「调整」逐点那几步（同 adjust-px.pure.ts 前三步·同预览 SVG 滤镜）：色温色调 → 饱和度 → 明暗曲线 */
function adjPoint(c: [number, number, number], a: ClipAdjust): [number, number, number] {
  if (!adjActive(a)) return c
  const g = (k: keyof ClipAdjust) => (a[k] ?? 0) / 100
  const T = g('temp'), Ti = g('tint')
  let [r, gg, b] = c
  if (T || Ti) { r = c01(r * (1 + T * 0.15 + Ti * 0.04)); gg = c01(gg * (1 - Ti * 0.12)); b = c01(b * (1 - T * 0.15 + Ti * 0.04)) }
  const s = Math.max(0, (1 + g('sat')) * (1 + g('vib') * 0.5))
  if (Math.abs(s - 1) > 1e-4) {
    const R = (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * gg + (0.072 - 0.072 * s) * b
    const G = (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * gg + (0.072 - 0.072 * s) * b
    const B = (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * gg + (0.072 + 0.928 * s) * b
    r = c01(R); gg = c01(G); b = c01(B)
  }
  const tone = toneTable(a), n1 = tone.length - 1
  const tb = (x: number) => { const p = x * n1, i = Math.min(n1 - 1, Math.floor(p)); return tone[i] + (tone[i + 1] - tone[i]) * (p - i) }
  return [tb(r), tb(gg), tb(b)]
}

/** 一份调色的逐点函数（次序：调整逐点项 → 色轮 → 曲线 → HSL → LUT；抠像的透明度照原色算、去溢色套在最后） */
export function gradeFn(g: Grade): (r: number, gg: number, b: number) => [number, number, number, number] {
  const cv = g.curves ?? {}
  const fm = cv.rgb ? curveFn(cv.rgb) : null, fr = cv.r ? curveFn(cv.r) : null, fg = cv.g ? curveFn(cv.g) : null, fb = cv.b ? curveFn(cv.b) : null
  const hasW = !!g.wheels && Object.keys(g.wheels).length > 0, hasH = !!g.hsl && Object.keys(g.hsl).length > 0
  const lut = g.lut && g.lut.strength > 0 ? g.lut : null
  return (r0, g0, b0) => {
    let c: [number, number, number] = [r0, g0, b0]
    let a = 1
    if (g.key) { const k = keyAlpha(r0, g0, b0, g.key); a = k.a; c = k.rgb }
    if (g.adj) c = adjPoint(c, g.adj)
    if (hasW) c = applyWheels(c, g.wheels!)
    if (fm) c = [fm(c[0]), fm(c[1]), fm(c[2])]
    if (fr) c[0] = fr(c[0])
    if (fg) c[1] = fg(c[1])
    if (fb) c[2] = fb(c[2])
    if (hasH) c = applyHsl(c[0], c[1], c[2], g.hsl!)
    if (lut) { const l = lutColor(lut.id, c[0], c[1], c[2]), t = lut.strength / 100; c = [mix(c[0], l[0], t), mix(c[1], l[1], t), mix(c[2], l[2], t)] }
    return [c01(c[0]), c01(c[1]), c01(c[2]), a]
  }
}

// ── 烤表 ──
/** 表的格数（33³·电影调色常用格数） */
export const GRADE_N = 33
const lutCache = new Map<string, Uint8Array>()
/** 几份调色依序套（片段自己的在前·上面的调节层由下往上）烤成一张 RGBA 表：x＝红（最快）·y＝绿·z＝蓝（同 WebGL TEXTURE_3D 排法） */
export function bakeGradeLut(grades: readonly Grade[], N = GRADE_N): Uint8Array {
  const key = `${N}|${JSON.stringify(grades)}`
  const hit = lutCache.get(key)
  if (hit) return hit
  const fns = grades.filter(gradeActive).map(gradeFn)
  const out = new Uint8Array(N * N * N * 4)
  let o = 0
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    let c: [number, number, number, number] = [ri / (N - 1), gi / (N - 1), bi / (N - 1), 1]
    for (const f of fns) { const n = f(c[0], c[1], c[2]); c = [n[0], n[1], n[2], c[3] * n[3]] }
    out[o++] = Math.round(c[0] * 255); out[o++] = Math.round(c[1] * 255); out[o++] = Math.round(c[2] * 255); out[o++] = Math.round(c[3] * 255)
  }
  if (lutCache.size > 64) lutCache.delete(lutCache.keys().next().value!)
  lutCache.set(key, out)
  return out
}
/** 表的指纹（预览换表才重传纹理） */
export const gradeKey = (grades: readonly Grade[]) => JSON.stringify(grades.filter(gradeActive))

/** 汇出：就地照表改像素（三线性内插·同 WebGL 3D 纹理线性取样）；抠像的透明度乘进 alpha */
export function applyGradeLut(data: Uint8ClampedArray, lut: Uint8Array, N = GRADE_N): void {
  const n1 = N - 1, NN = N * N
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const fr = (data[i] / 255) * n1, fg = (data[i + 1] / 255) * n1, fb = (data[i + 2] / 255) * n1
    const r0 = Math.min(n1 - 1, Math.floor(fr)), g0 = Math.min(n1 - 1, Math.floor(fg)), b0 = Math.min(n1 - 1, Math.floor(fb))
    const tr = fr - r0, tg = fg - g0, tb = fb - b0
    const base = (r0 + g0 * N + b0 * NN) * 4
    for (let ch = 0; ch < 4; ch++) {
      const at = (dr: number, dg: number, db: number) => lut[base + (dr + dg * N + db * NN) * 4 + ch]
      const c00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tr, c10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tr
      const c01_ = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tr, c11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tr
      const c0 = c00 + (c10 - c00) * tg, c1 = c01_ + (c11 - c01_) * tg
      const v = c0 + (c1 - c0) * tb
      if (ch < 3) data[i + ch] = Math.round(v)
      else data[i + 3] = Math.round((data[i + 3] * v) / 255)
    }
  }
}

/** 色轮点的显示色（面板画色盘用） */
export const wheelColor = (w: Pick<Wheel, 'x' | 'y'>) => { const t = wheelTint(w); return `rgb(${t.map((v) => Math.round(c01(0.5 + v) * 255)).join(',')})` }
export const hueColor = (deg: number) => { const [r, g, b] = hslToRgb(deg, 0.85, 0.5); return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})` }
