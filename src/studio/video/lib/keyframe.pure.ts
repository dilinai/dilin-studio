// 网页剪辑页·关键帧：片段上每个能调的数值都能打关键帧，两颗之间照缓动曲线走。
// 缓动的算法照 EffectCraft（https://github.com/storytold/effectcraft ·MIT OR Apache-2.0，这里按 MIT·Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors）
//   crates/keyframe（lib.rs ease_progress／solve_u·ease_curve.rs EaseCurve）改写成 TS（授权全文 /vedit/licenses/EffectCraft-LICENSE-MIT.txt）：
//   一段的缓动＝时间、数值都正规化到 0→1 的三次贝塞尔·两颗把手 (x1,y1)(x2,y2)；x＝影响（占这一段几成·0.1%～100%）·y＝影响×相对速度（1＝匀速·0＝停住）；
//   时间 x 先反解出贝塞尔参数 u（牛顿法 8 步·不收敛退二分 60 步·两边影响都 100% 时用立方根精确解），再取 y(u)。
// 关键帧的时刻存「素材第几秒」（同 offset 的单位）⇒ 修剪、切开、改变速时关键帧跟着画面内容走（照剪映）；图片 offset 恒 0 ⇒ 等于从片头算。
// 本档只放纯函数（题直接跑）：缓动、插值、加删、上一颗／下一颗、读档验值。⛔ 碰 DOM、⛔ import 时间轴（型别也不 import·避免绕圈）。

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r4 = (v: number) => Math.round(v * 10000) / 10000

// ── 缓动曲线 ──
/** 把手 [x1, y1, x2, y2]（正规化图上·同 effectcraft EaseCurve.handles） */
export type EaseHandles = [number, number, number, number]
/** 预设（剪映「关键帧曲线」那排）：linear 匀速·in 缓入·out 缓出·inout 缓入缓出·*2 加强版·backIn／backOut 回弹·hold 定格（到下一颗才跳） */
export const EASE_PRESETS = ['linear', 'in', 'out', 'inout', 'in2', 'out2', 'inout2', 'backIn', 'backOut', 'hold'] as const
export type EasePreset = (typeof EASE_PRESETS)[number]
/** 一颗关键帧往下一颗那段的缓动：预设或自订把手 */
export type KfEase = EasePreset | EaseHandles
const PRESET_HANDLES: Record<Exclude<EasePreset, 'hold'>, EaseHandles> = {
  linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  inout: [0.42, 0, 0.58, 1],
  in2: [0.7, 0, 0.84, 0],
  out2: [0.16, 1, 0.3, 1],
  inout2: [0.87, 0, 0.13, 1],
  backIn: [0.36, 0, 0.66, -0.56],
  backOut: [0.34, 1.56, 0.64, 1],
}
/** 影响最小 0.1%（同 Keyframe Velocity 对话框）·相对速度夹在 ±100 */
const MIN_INFLUENCE = 0.001
const MAX_SPEED = 100
/** 缓动的把手（hold 没有 ⇒ null）；自订把手先夹进范围（x 在 0.1%～100%·速度 ±100） */
export function easeHandles(e: KfEase | undefined): EaseHandles | null {
  if (e === 'hold') return null
  if (!e) return PRESET_HANDLES.linear
  if (typeof e === 'string') return PRESET_HANDLES[e] ?? PRESET_HANDLES.linear
  return sanitizeHandles(e)
}
/** 同 EaseCurve::from_handles → sanitized：影响夹 0.1%～100%·速度夹 ±100；有不是有限数 ⇒ null */
export function sanitizeHandles(h: readonly number[]): EaseHandles | null {
  if (h.length !== 4 || !h.every((v) => Number.isFinite(v))) return null
  const o = clamp(h[0], MIN_INFLUENCE, 1), i = clamp(1 - h[2], MIN_INFLUENCE, 1)
  const os = clamp(h[1] / o, -MAX_SPEED, MAX_SPEED), is = clamp((1 - h[3]) / i, -MAX_SPEED, MAX_SPEED)
  return [r4(o), r4(os * o), r4(1 - i), r4(1 - is * i)]
}

/** 一维三次贝塞尔与导数（effectcraft bez／bez_d） */
const bez = (p0: number, p1: number, p2: number, p3: number, u: number) => { const v = 1 - u; return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3 }
const bezD = (p0: number, p1: number, p2: number, p3: number, u: number) => { const v = 1 - u; return 3 * v * v * (p1 - p0) + 6 * v * u * (p2 - p1) + 3 * u * u * (p3 - p2) }
/** 解 bez(x0..x3, u) = x（x 曲线单调）·effectcraft solve_u */
function solveU(x0: number, x1: number, x2: number, x3: number, x: number): number {
  if (x <= x0) return 0
  if (x >= x3) return 1
  if (x1 === x3 && x2 === x0) return 0.5 + Math.cbrt(((x - x0) / (x3 - x0) - 0.5) * 0.25)
  let u = (x - x0) / (x3 - x0)
  for (let k = 0; k < 8; k++) {
    const f = bez(x0, x1, x2, x3, u) - x, d = bezD(x0, x1, x2, x3, u)
    if (Math.abs(d) < 1e-12) break
    if (Math.abs(f / d) < 1e-12) return u
    const n = u - f / d
    if (!(n >= 0 && n <= 1)) break
    u = n
  }
  let lo = 0, hi = 1
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (bez(x0, x1, x2, x3, mid) < x) lo = mid; else hi = mid }
  return (lo + hi) / 2
}
/** 一段走到 x（0..1 的时间）时数值走了几成（可超出 0..1＝回弹）；hold ⇒ 到终点前都是 0 */
export function easeProgress(e: KfEase | undefined, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const h = easeHandles(e)
  if (!h) return 0
  // 时间把手可交叉·照 AE 留着两边的影响不改（effectcraft ease_progress）
  const u = solveU(0, clamp(h[0], 0, 1), clamp(h[2], 0, 1), 1, x)
  return bez(0, h[1], h[3], 1, u)
}
/** 曲线小图（面板画预设用）：n+1 个点 [x, y] */
export const easeSamples = (e: KfEase, n = 24): Array<[number, number]> => Array.from({ length: n + 1 }, (_, i) => [i / n, r4(easeProgress(e, i / n))])

// ── 关键帧轨 ──
/** t＝素材第几秒（同片段 offset 的单位）·v＝数值·e＝往下一颗那段的缓动（缺＝匀速） */
export type Kf = { t: number; v: number; e?: KfEase }
/** 能打关键帧的数值（剪映右栏那几颗菱形）：
 *  画面 sx／sy／x／y／rot／opacity·蒙版 mask.*·调节 adj.*（16 项）·音量 vol（dB）·滤镜片段 flt（强度 0～100）·文字片段 tx／ty／ts／trot／top（位置·缩放·旋转·不透明度） */
export const KF_MASK_KEYS = ['x', 'y', 'w', 'h', 'rot', 'feather', 'radius', 'progress'] as const // progress＝条纹进度
export const KF_ADJ_KEYS = ['temp', 'tint', 'sat', 'vib', 'bright', 'contrast', 'highlight', 'shadow', 'white', 'black', 'light', 'sharpen', 'clarity', 'grain', 'fade', 'vignette'] as const
/** 四角透视（corner-pin.pure PIN_KEYS 同一串·这里不 import 免绕圈） */
export const KF_PIN_KEYS = ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3'] as const
/** 3D 层（d3.z／rx／ry／rz）·摄影机（cam.*）·灯光（lt.*）——见 rig.pure.ts（这里不 import 免绕圈·同一串） */
export const KF_RIG_PROPS = ['d3.z', 'd3.rx', 'd3.ry', 'd3.rz', 'cam.x', 'cam.y', 'cam.z', 'cam.tx', 'cam.ty', 'cam.tz', 'cam.fov', 'lt.int', 'lt.x', 'lt.y', 'lt.z'] as const
export const KF_PROPS = ['sx', 'sy', 'x', 'y', 'rot', 'opacity', ...KF_MASK_KEYS.map((k) => `mask.${k}` as const), ...KF_ADJ_KEYS.map((k) => `adj.${k}` as const), 'vol', 'flt', 'tx', 'ty', 'ts', 'trot', 'top', ...KF_PIN_KEYS.map((k) => `pin.${k}` as const), ...KF_RIG_PROPS] as const
export type KfProp = (typeof KF_PROPS)[number]
export type KfTracks = Partial<Record<KfProp, Kf[]>>
/** 两颗关键帧当成同一颗的距离（半帧·30fps） */
export const KF_EPS = 1 / 60

/** 轨上 t 这一刻的数值：没关键帧 ⇒ base；第一颗前＝第一颗·最后一颗后＝最后一颗；中间照前一颗的缓动走 */
export function kfValue(track: readonly Kf[] | undefined, t: number, base: number): number {
  if (!track || !track.length) return base
  if (t <= track[0].t) return track[0].v
  const last = track[track.length - 1]
  if (t >= last.t) return last.v
  let i = 0
  while (i < track.length - 2 && t >= track[i + 1].t) i++
  const a = track[i], b = track[i + 1]
  const span = b.t - a.t
  if (!(span > 0)) return b.v
  return a.v + (b.v - a.v) * easeProgress(a.e, (t - a.t) / span)
}
/** t 这一刻有没有关键帧（半帧内）：有 ⇒ 第几颗；没有 ⇒ -1 */
export const kfIndexAt = (track: readonly Kf[] | undefined, t: number): number => (track ? track.findIndex((k) => Math.abs(k.t - t) < KF_EPS) : -1)
/** 放一颗（同一刻已经有 ⇒ 改那颗的值·缓动不变）；e 给了才改缓动 */
export function kfPut(track: readonly Kf[] | undefined, t: number, v: number, e?: KfEase): Kf[] {
  const tt = r4(Math.max(0, t)), vv = r4(v)
  const cur = track ? [...track] : []
  const i = kfIndexAt(cur, tt)
  if (i >= 0) { const k: Kf = { ...cur[i], v: vv }; if (e !== undefined) setEase(k, e); cur[i] = k; return cur }
  const k: Kf = { t: tt, v: vv }
  if (e !== undefined) setEase(k, e)
  else { const prev = [...cur].reverse().find((x) => x.t < tt); if (prev?.e) k.e = prev.e } // 新的一颗沿用前一颗的缓动（剪映照这样）
  return [...cur, k].sort((a, b) => a.t - b.t)
}
const setEase = (k: Kf, e: KfEase) => { if (e === 'linear') delete k.e; else k.e = e }
/** 拿掉 t 那颗（没有 ⇒ 原样） */
export function kfDrop(track: readonly Kf[] | undefined, t: number): Kf[] {
  if (!track) return []
  const i = kfIndexAt(track, t)
  return i < 0 ? [...track] : track.filter((_, j) => j !== i)
}

/** 一段所有轨（或指定那几条）上关键帧的时刻·由小到大·去重 */
export function kfTimes(kf: KfTracks | undefined, props?: readonly KfProp[]): number[] {
  if (!kf) return []
  const out: number[] = []
  for (const p of props ?? (Object.keys(kf) as KfProp[])) for (const k of kf[p] ?? []) if (!out.some((x) => Math.abs(x - k.t) < KF_EPS)) out.push(k.t)
  return out.sort((a, b) => a - b)
}
/** 上一颗／下一颗（剪映关键帧菱形两边那对箭头）：严格在 t 之前／之后（半帧外）·没有 ⇒ null */
export const kfPrev = (times: readonly number[], t: number): number | null => { let r: number | null = null; for (const x of times) if (x < t - KF_EPS) r = x; return r }
export const kfNext = (times: readonly number[], t: number): number | null => times.find((x) => x > t + KF_EPS) ?? null

/** 套一批数值（面板一笔改动）到关键帧：有轨的那几项 ⇒ 在 t 放一颗（剪映：已经打过关键帧的数值一改就自动在播放头补一颗）；回 [新轨, 没轨的那几项（照旧改底值）] */
export function kfApply(kf: KfTracks | undefined, t: number, vals: Partial<Record<KfProp, number>>): { kf: KfTracks | undefined; rest: Partial<Record<KfProp, number>> } {
  const rest: Partial<Record<KfProp, number>> = {}
  let out: KfTracks | undefined = kf
  for (const p of Object.keys(vals) as KfProp[]) {
    const v = vals[p]
    if (v === undefined) continue
    if (kf?.[p]?.length) out = { ...out, [p]: kfPut(out![p], t, v) }
    else rest[p] = v
  }
  return { kf: out, rest }
}
/** 菱形钮：t 有关键帧 ⇒ 这几项都拿掉；没有 ⇒ 这几项都在 t 放一颗（值＝当下看到的） */
export function kfToggle(kf: KfTracks | undefined, t: number, cur: Partial<Record<KfProp, number>>): KfTracks | undefined {
  const props = Object.keys(cur) as KfProp[]
  const on = props.some((p) => kfIndexAt(kf?.[p], t) >= 0)
  const out: KfTracks = { ...(kf ?? {}) }
  for (const p of props) {
    if (on) { const n = kfDrop(out[p], t); if (n.length) out[p] = n; else delete out[p] }
    else out[p] = kfPut(out[p], t, cur[p]!)
  }
  return normalizeKf(out)
}
/** 改 t 那几颗的缓动（几项一起·没那颗的跳过） */
export function kfSetEase(kf: KfTracks | undefined, t: number, props: readonly KfProp[], e: KfEase): KfTracks | undefined {
  if (!kf) return kf
  const out: KfTracks = { ...kf }
  for (const p of props) {
    const tr = out[p], i = kfIndexAt(tr, t)
    if (!tr || i < 0) continue
    const n = [...tr]; const k: Kf = { ...n[i] }; setEase(k, e); n[i] = k; out[p] = n
  }
  return out
}
/** t 那颗的缓动（几项里第一颗找到的）·没有 ⇒ null */
export function kfEaseAt(kf: KfTracks | undefined, t: number, props: readonly KfProp[]): KfEase | null {
  for (const p of props) { const tr = kf?.[p], i = kfIndexAt(tr, t); if (tr && i >= 0) return tr[i].e ?? 'linear' }
  return null
}
/** 空轨拿掉·全空 ⇒ undefined */
export function normalizeKf(kf: KfTracks | undefined): KfTracks | undefined {
  if (!kf) return undefined
  const out: KfTracks = {}
  for (const p of KF_PROPS) { const tr = kf[p]; if (tr?.length) out[p] = tr }
  return Object.keys(out).length ? out : undefined
}
/** 读档验值：坏的丢、时刻排好、同一刻只留一颗 */
export function parseKf(v: unknown): KfTracks | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const out: KfTracks = {}
  for (const p of KF_PROPS) {
    const arr = o[p]
    if (!Array.isArray(arr)) continue
    let tr: Kf[] = []
    for (const k of arr) {
      if (!k || typeof k !== 'object') continue
      const r = k as Record<string, unknown>
      const t = num(r.t), val = num(r.v)
      if (t === null || val === null || t < 0) continue
      const e = parseEase(r.e)
      tr = kfPut(tr, t, val, e ?? 'linear')
    }
    if (tr.length) out[p] = tr.slice(0, 500)
  }
  return Object.keys(out).length ? out : undefined
}
function parseEase(v: unknown): KfEase | undefined {
  if (typeof v === 'string') return (EASE_PRESETS as readonly string[]).includes(v) ? (v as EasePreset) : undefined
  if (Array.isArray(v)) return sanitizeHandles(v.map((x) => (typeof x === 'number' ? x : NaN))) ?? undefined
  return undefined
}
