// 网页剪辑页·曲线变速（剪映「变速 › 曲线变速」）：一段片段里速度照一条曲线变（蒙太奇／英雄时刻／子弹时间／跳接／闪进／闪出／自订）。
// 曲线＝几个点 [x, s]：x＝片段时间轴长度的第几成（0～1·头尾两点固定在 0 与 1）·s＝那一刻的速度倍数（0.1～10）；
//   两点之间照对数速度用平滑步进接（剪映的曲线是平滑的·速度是乘的 ⇒ 在对数上接）。
// 素材那一段（S 秒）不变·时间轴长度 L＝S／平均速度；时间轴过了 τ 秒 ⇒ 素材走 L×∫₀^{τ/L} v(x)dx 秒（累积表 CUM_N 格·查表线性内插）。
// 本档只放纯函数（题直接跑）。⛔ 碰 DOM、⛔ import 时间轴。

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10000) / 10000

export const CURVE_SPEED_MIN = 0.1
export const CURVE_SPEED_MAX = 10
export type CurvePoint = [number, number]
/** id＝哪一款（custom＝自订·改过点的预设也变 custom）·pts＝点（x 由小到大·头 0 尾 1）；
 *  win＝这段只用到原曲线的 a～b 那截（切开、修剪后各段留自己那截·速度一点不走样；缺＝整条） */
export type SpeedCurve = { id: CurvePreset; pts: CurvePoint[]; win?: [number, number] }
export const CURVE_PRESETS = ['custom', 'montage', 'hero', 'bullet', 'jump', 'flashIn', 'flashOut'] as const
export type CurvePreset = (typeof CURVE_PRESETS)[number]
const PRESET_PTS: Record<CurvePreset, CurvePoint[]> = {
  custom: [[0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]],
  montage: [[0, 1], [0.2, 4], [0.4, 0.5], [0.6, 0.5], [0.8, 4], [1, 1]],
  hero: [[0, 4], [0.3, 4], [0.45, 0.3], [0.55, 0.3], [0.7, 4], [1, 4]],
  bullet: [[0, 1], [0.3, 1], [0.45, 0.1], [0.55, 0.1], [0.7, 1], [1, 1]],
  jump: [[0, 1], [0.4, 1], [0.5, 10], [0.6, 1], [1, 1]],
  flashIn: [[0, 10], [0.25, 10], [0.45, 1], [1, 1]],
  flashOut: [[0, 1], [0.55, 1], [0.75, 10], [1, 10]],
}
export const curvePreset = (id: CurvePreset): SpeedCurve => ({ id, pts: PRESET_PTS[id].map((p) => [p[0], p[1]] as CurvePoint) })

/** 验值：点按 x 排·头尾补齐到 0 与 1·速度夹 0.1～10·至少两点；坏的 ⇒ null */
export function parseCurve(v: unknown): SpeedCurve | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const id = (CURVE_PRESETS as readonly string[]).includes(String(o.id)) ? (o.id as CurvePreset) : 'custom'
  if (!Array.isArray(o.pts)) return null
  const pts: CurvePoint[] = []
  for (const p of o.pts) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => typeof x === 'number' && Number.isFinite(x))) continue
    pts.push([clamp(p[0], 0, 1), clamp(p[1], CURVE_SPEED_MIN, CURVE_SPEED_MAX)])
  }
  const w = Array.isArray(o.win) && o.win.length === 2 && o.win.every((x) => typeof x === 'number' && Number.isFinite(x)) ? o.win as [number, number] : null
  return normCurve({ id, pts, ...(w ? { win: w } : {}) })
}
export function normCurve(c: SpeedCurve): SpeedCurve | null {
  const pts = [...c.pts].sort((a, b) => a[0] - b[0]).map((p) => [r4(clamp(p[0], 0, 1)), r4(clamp(p[1], CURVE_SPEED_MIN, CURVE_SPEED_MAX))] as CurvePoint)
  if (pts.length < 2 || pts.length > 20) return null
  pts[0][0] = 0; pts[pts.length - 1][0] = 1
  for (let i = 1; i < pts.length; i++) if (pts[i][0] <= pts[i - 1][0]) return null
  const w = c.win ? [clamp(c.win[0], 0, 1), clamp(c.win[1], 0, 1)] as [number, number] : null
  return w && w[1] - w[0] > 1e-4 && (w[0] > 1e-9 || w[1] < 1 - 1e-9) ? { id: c.id, pts, win: [Math.round(w[0] * 1e6) / 1e6, Math.round(w[1] * 1e6) / 1e6] } : { id: c.id, pts }
}

const smooth = (f: number) => f * f * (3 - 2 * f)
/** 片段第 x 成（0～1）那一刻的速度（有 win ⇒ 对到原曲线那截） */
export function curveSpeedAt(c: SpeedCurve, x0: number): number {
  const x = c.win ? c.win[0] + clamp(x0, 0, 1) * (c.win[1] - c.win[0]) : x0
  const p = c.pts
  if (x <= p[0][0]) return p[0][1]
  if (x >= p[p.length - 1][0]) return p[p.length - 1][1]
  let i = 0
  while (i < p.length - 2 && x >= p[i + 1][0]) i++
  const a = p[i], b = p[i + 1]
  const f = smooth((x - a[0]) / (b[0] - a[0]))
  return Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * f)
}

/** 累积表：cum[i]＝∫₀^{i/N} v(x)dx（辛普森）·同一份曲线只算一次 */
export const CUM_N = 400
const cumCache = new WeakMap<SpeedCurve, Float64Array>()
function cumTable(c: SpeedCurve): Float64Array {
  let t = cumCache.get(c)
  if (t) return t
  t = new Float64Array(CUM_N + 1)
  const h = 1 / CUM_N
  for (let i = 1; i <= CUM_N; i++) {
    const x0 = (i - 1) * h, x1 = i * h
    t[i] = t[i - 1] + (h / 6) * (curveSpeedAt(c, x0) + 4 * curveSpeedAt(c, (x0 + x1) / 2) + curveSpeedAt(c, x1))
  }
  cumCache.set(c, t)
  return t
}
/** ∫₀^x v（x 0～1） */
export function curveCum(c: SpeedCurve, x: number): number {
  const t = cumTable(c)
  const p = clamp(x, 0, 1) * CUM_N
  const i = Math.min(CUM_N - 1, Math.floor(p))
  return t[i] + (t[i + 1] - t[i]) * (p - i)
}
/** 平均速度（＝素材秒数／时间轴秒数） */
export const curveAvg = (c: SpeedCurve): number => curveCum(c, 1)
/** 反查：素材走了 y 成（0～1·对 ∫₀^1）⇒ 片段第几成 */
export function curveInv(c: SpeedCurve, y: number): number {
  const t = cumTable(c), total = t[CUM_N]
  const want = clamp(y, 0, 1) * total
  let lo = 0, hi = CUM_N
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] < want) lo = m; else hi = m }
  const span = t[hi] - t[lo]
  return (lo + (span > 0 ? (want - t[lo]) / span : 0)) / CUM_N
}
/** 截出 a～b 那一段（切开、修剪用）：点不动·只收窄 win（速度跟原曲线一模一样） */
export function cropCurve(c: SpeedCurve, a: number, b: number): SpeedCurve {
  const lo = clamp(a, 0, 1), hi = clamp(b, lo + 1e-4, 1)
  const [w0, w1] = c.win ?? [0, 1]
  return normCurve({ id: c.id, pts: c.pts, win: [w0 + lo * (w1 - w0), w0 + hi * (w1 - w0)] }) ?? c
}
/** 面板拖点用：有 win ⇒ 把那截烤成自己的点（窗里的原点＋两端·重新拉回 0～1）；没有 ⇒ 原样 */
export function bakeCurve(c: SpeedCurve): SpeedCurve {
  if (!c.win) return c
  const [lo, hi] = c.win
  const raw: SpeedCurve = { id: c.id, pts: c.pts }
  const inner = c.pts.filter((p) => p[0] > lo + 1e-4 && p[0] < hi - 1e-4)
  const pts = [[lo, curveSpeedAt(raw, lo)] as CurvePoint, ...inner, [hi, curveSpeedAt(raw, hi)] as CurvePoint].map((p) => [r4((p[0] - lo) / (hi - lo)), r4(p[1])] as CurvePoint)
  return normCurve({ id: 'custom', pts }) ?? raw
}
/** 面板画曲线：n+1 个 [x, 速度] */
export const curveSamples = (c: SpeedCurve, n = 60): CurvePoint[] => Array.from({ length: n + 1 }, (_, i) => [i / n, r4(curveSpeedAt(c, i / n))])
/** 速度 ⇒ 面板图上的高（0～1·对数·1x 在正中） */
export const speedToY = (s: number) => clamp((Math.log10(clamp(s, CURVE_SPEED_MIN, CURVE_SPEED_MAX)) + 1) / 2, 0, 1)
export const yToSpeed = (y: number) => r4(clamp(Math.pow(10, clamp(y, 0, 1) * 2 - 1), CURVE_SPEED_MIN, CURVE_SPEED_MAX))
/** 浏览器影片元素放得了的速度（playbackRate 0.0625～16） */
export const elementRate = (s: number) => clamp(s, 0.0625, 16)
