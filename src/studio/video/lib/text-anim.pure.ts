// 网页剪辑页·文字动画库（附剪映「动画」页截图：入场／出场／循环）。
// 自己设计的款式与动法（名字、曲线、幅度都是自己定的·没搬剪映素材）。
// 一款动画＝一支「进度 p（0～1）⇒ 姿势」的纯函数（由每款的关键帧经关键帧引擎算出来）；姿势＝位移（em·跟字号走）、缩放、旋转（度）、透明度、可见字比例。
//   入场：p 0＝刚出现 → 1＝定住；出场＝某款入场倒着播（缓动跟着反过来，退场自然是先慢后快）；循环：p＝一圈里的位置。
// 时间：入场／出场按「这一段自己的秒」算（seg＝片段起点到现在）；循环按「接着播的秒」算（local＝offset＋seg·剪开后不断拍）。
//   入场＋出场比片段长 ⇒ 两段按比例缩短（不会互相盖）。
// 画面叠字（page.tsx·CSS）与汇出（text-draw.ts·Canvas）都只吃 textAnimPose 这一份结果，两边一致。⛔ 碰 DOM。
import type { TextAnim, TextAnimSet, TextAnimSlot } from './timeline.pure'
import { kfValue, type Kf, type KfEase } from './keyframe.pure'

/** 姿势：tx／ty＝位移（em·往右／往下为正·跟字号走）；sx／sy＝缩放；rot＝旋转（度·顺时针）；alpha＝透明度倍数；reveal＝看得到的字占几成（打字机类·1＝全部） */
export type AnimPose = { tx: number; ty: number; sx: number; sy: number; rot: number; alpha: number; reveal: number }
export const POSE_IDLE: AnimPose = Object.freeze({ tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, alpha: 1, reveal: 1 }) as AnimPose
type PoseFn = (p: number) => Partial<AnimPose>
export type AnimName = { tw: string; cn: string; en: string }
/** kf＝这款的关键帧（reversed＝出场：倒着播）；f＝进度 ⇒ 姿势（由 kf 算出来） */
export type AnimDef = { id: string; name: AnimName; f: PoseFn; kf?: AnimKf; reversed?: boolean; perChar?: CharDef }

/** 长短（秒）：入场／出场 0.1～5（缺省 0.5）；循环一圈 0.2～5（缺省 1） */
export const ANIM_DUR = {
  in: { min: 0.1, max: 5, def: 0.5 },
  out: { min: 0.1, max: 5, def: 0.5 },
  loop: { min: 0.2, max: 5, def: 1 },
} as const satisfies Record<TextAnimSlot, { min: number; max: number; def: number }>
export const ANIM_SLOTS: readonly TextAnimSlot[] = ['in', 'out', 'loop']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const c01 = (v: number) => clamp(v, 0, 1)
// ── 动画预设走关键帧引擎：每款都写成几条关键帧轨（时刻＝进度 0～1），由 keyframe.pure.ts 那套贝塞尔缓动算 ──
//   原先的缓动函数换成同形状的贝塞尔把手；弹跳拆成几颗关键帧（每段二次缓入／缓出）；闪现用定格；回弹与循环的正弦在峰谷、过零点各放一颗（把手照斜率·smoothKeys）。
type Tr = ReadonlyArray<readonly [number, number, KfEase?]>
/** 一款动画的关键帧：姿势每一栏一条轨（时刻＝进度 0～1） */
export type AnimKf = Partial<Record<keyof AnimPose, Tr>>
const OUT_CUBIC: KfEase = [0.33, 1, 0.68, 1]
const OUT_QUART: KfEase = [0.25, 1, 0.5, 1]
const IN_OUT_CUBIC: KfEase = [0.65, 0, 0.35, 1]
const OUT_BACK: KfEase = [0.34, 1.7, 0.64, 1]
const QUAD_IN: KfEase = [1 / 3, 0, 2 / 3, 1 / 3]
const QUAD_OUT: KfEase = [1 / 3, 2 / 3, 2 / 3, 1]
/** 快速淡入：0 → 1/speed 那段线性到满 */
const fade = (speed = 2): Tr => [[0, 0], [1 / speed, 1]]
/** 由 from 走到 to（一段·缓动 e） */
const go = (from: number, to: number, e: KfEase): Tr => [[0, from, e], [1, to]]
/** 照一条平滑曲线 fn 在 ts 那几刻放关键帧：每段的缓动把手照两端的斜率算（三次 Hermite＝影响 1/3·速度＝斜率×段长／落差·同 AE 的速度／影响） */
function smoothKeys(fn: (p: number) => number, ts: readonly number[]): Tr {
  const h = 1e-5, d = (p: number) => (fn(Math.min(1, p + h)) - fn(Math.max(0, p - h))) / (Math.min(1, p + h) - Math.max(0, p - h))
  const list = [...new Set([0, 1, ...ts.filter((p) => p > 1e-9 && p < 1 - 1e-9)])].sort((a, b) => a - b)
  return list.map((p, i) => {
    if (i === list.length - 1) return [p, fn(p)] as const
    const q = list[i + 1], dv = fn(q) - fn(p), dt = q - p
    if (Math.abs(dv) < 1e-9) return [p, fn(p)] as const
    return [p, fn(p), [1 / 3, (d(p) * dt) / dv / 3, 2 / 3, 1 - (d(q) * dt) / dv / 3]] as const
  })
}
/** 正弦 base＋amp·sin(2π·cycles·p＋phase)：每个过零点、峰谷放一颗（把手照斜率） */
function wave(amp: number, cycles: number, phase = 0, base = 0): Tr {
  const ts: number[] = []
  for (let k = -4; ; k++) { const p = ((k * Math.PI) / 2 - phase) / (2 * Math.PI * cycles); if (p > 1) break; ts.push(p) }
  return smoothKeys((p) => base + amp * Math.sin(2 * Math.PI * cycles * p + phase), ts)
}
const kfs = (tr: Tr): Kf[] => tr.map(([t, v, e]) => (e ? { t, v, e } : { t, v }))
/** 关键帧 ⇒ 姿势函数（只给有轨的那几栏） */
function fromKf(spec: AnimKf): PoseFn {
  const tracks = (Object.keys(spec) as Array<keyof AnimPose>).map((k) => [k, kfs(spec[k]!)] as const)
  return (p) => { const o: Partial<AnimPose> = {}; for (const [k, tr] of tracks) o[k] = kfValue(tr, p, 0); return o }
}
const def = (id: string, name: AnimName, kf: AnimKf): AnimDef => ({ id, name, kf, f: fromKf(kf) })
const both = (tr: Tr): AnimKf => ({ sx: tr, sy: tr })
/** 弹跳落下：从上面掉（重力＝二次缓入）·落地弹三下（每次高度剩四分之一） */
const BOUNCE: Tr = [[0, -2, QUAD_IN], [1 / 2.75, 0, QUAD_OUT], [1.5 / 2.75, -0.5, QUAD_IN], [2 / 2.75, 0, QUAD_OUT], [2.25 / 2.75, -0.125, QUAD_IN], [2.5 / 2.75, 0, QUAD_OUT], [2.625 / 2.75, -0.03125, QUAD_IN], [1, 0]]
/** 摆入：甩过头左右晃两下再停（每次幅度衰减） */
const SWING: Tr = [...smoothKeys((p) => -28 * Math.cos(p * Math.PI * 3.2) * Math.exp(-p * 5.5), [1, 2, 3, 4, 5, 6].map((k) => k / 6.4)).slice(0, -1), [1, 0]]
/** 闪现：前四分之三每 1/12 明暗交替（定格）·之后全亮 */
const FLICKER: Tr = [...Array.from({ length: 9 }, (_, k) => [k / 12, k % 2 ? 0.85 : 0.1, 'hold'] as const), [0.75, 1]]


// ── 逐字动画（需求单第 2、9 项）：整段姿势不动·每个字各自照「字进度 q（0～1）」走一份字姿势；字与字之间差 stagger 秒 ──
//   预览（VideoEditPage 叠字·FancyText 每字一格）与汇出（text-draw.ts 每字一笔）都只吃 charPoses → charMatrix 这一份：同一支纯函数算每个字的透明度、位移、旋转、缩放、3D 翻转。
/** 字姿势：tx／ty＝位移（em）；sx／sy＝缩放；rot＝平面旋转（度）；rx／ry＝绕横轴／直轴翻（度·3D）；alpha＝透明度；pivot＝翻转轴离字中心往下几 em（站起＝字底边） */
export type CharPose = { tx: number; ty: number; sx: number; sy: number; rot: number; rx: number; ry: number; alpha: number; pivot: number }
export const CHAR_IDLE: CharPose = Object.freeze({ tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, rx: 0, ry: 0, alpha: 1, pivot: 0 }) as CharPose
type CharKf = Partial<Record<Exclude<keyof CharPose, 'pivot'>, Tr>>
/** 一款逐字动画：f＝字进度 ⇒ 字姿势（入场 q 0＝刚开始 → 1＝定住）；pivot＝翻转轴位置 */
export type CharDef = { f: (q: number) => Partial<CharPose>; pivot: number }
/** 每字间隔（秒）：0～1·缺省 0.06 */
export const STAGGER = { min: 0, max: 1, def: 0.06 } as const
const pcDef = (id: string, name: AnimName, kf: CharKf, pivot = 0): AnimDef => {
  const tracks = (Object.keys(kf) as Array<keyof CharKf>).map((k) => [k, kfs(kf[k]!)] as const)
  const f = (q: number) => { const o: Partial<CharPose> = {}; for (const [k, tr] of tracks) o[k] = kfValue(tr, q, 0); return o }
  // f／kf 也照字姿势给（库表、关键帧题看得到这款怎么动）；整段姿势 textAnimPose 跳过逐字款·真正的画法走 charPoseAt
  return { id, name, kf: kf as AnimKf, f: f as PoseFn, perChar: { pivot, f } }
}
const PC_IN: readonly AnimDef[] = [
  pcDef('in-pc-fade', { tw: '逐字顯現', cn: '逐字显现', en: 'Letters fade in' }, { alpha: go(0, 1, IN_OUT_CUBIC), ty: go(0.3, 0, OUT_CUBIC) }),
  pcDef('in-pc-spin', { tw: '逐字旋轉', cn: '逐字旋转', en: 'Letters spin in' }, { ry: go(-180, 0, OUT_CUBIC), alpha: fade(3) }),
  pcDef('in-pc-fold', { tw: '折疊', cn: '折叠', en: 'Fold open' }, { rx: go(90, 0, OUT_BACK), alpha: fade(4) }),
  pcDef('in-pc-standup', { tw: '站起', cn: '站起', en: 'Stand up' }, { rx: go(-90, 0, OUT_BACK), alpha: fade(4) }, 0.5),
  pcDef('in-pc-pop', { tw: '逐字彈出', cn: '逐字弹出', en: 'Letters pop' }, { ...({ sx: go(0, 1, OUT_BACK), sy: go(0, 1, OUT_BACK) }), alpha: fade(4) }),
]
/** 入场 15 款＋逐字 5 款（顺序＝面板排的顺序） */
export const ANIM_IN: readonly AnimDef[] = [
  def('in-fade', { tw: '漸顯', cn: '渐显', en: 'Fade in' }, { alpha: go(0, 1, IN_OUT_CUBIC) }),
  def('in-zoom-up', { tw: '放大', cn: '放大', en: 'Zoom up' }, { ...both(go(0.3, 1, OUT_CUBIC)), alpha: fade() }),
  def('in-zoom-down', { tw: '縮小', cn: '缩小', en: 'Zoom down' }, { ...both(go(1.8, 1, OUT_CUBIC)), alpha: fade() }),
  def('in-pop', { tw: '彈入', cn: '弹入', en: 'Pop' }, { ...both(go(0, 1, OUT_BACK)), alpha: fade(4) }),
  def('in-type', { tw: '打字機', cn: '打字机', en: 'Typewriter' }, { reveal: [[0, 0], [1, 1]] }),
  def('in-rise', { tw: '向上露出', cn: '向上露出', en: 'Rise' }, { ty: go(1.2, 0, OUT_QUART), alpha: fade() }),
  def('in-drop', { tw: '向下露出', cn: '向下露出', en: 'Drop' }, { ty: go(-1.2, 0, OUT_QUART), alpha: fade() }),
  def('in-left', { tw: '向左滑入', cn: '向左滑入', en: 'Slide left' }, { tx: go(3, 0, OUT_QUART), alpha: fade() }),
  def('in-right', { tw: '向右滑入', cn: '向右滑入', en: 'Slide right' }, { tx: go(-3, 0, OUT_QUART), alpha: fade() }),
  def('in-roll', { tw: '滾入', cn: '滚入', en: 'Roll in' }, { tx: go(-3, 0, OUT_CUBIC), rot: go(-360, 0, OUT_CUBIC), alpha: fade() }),
  def('in-spin', { tw: '旋入', cn: '旋入', en: 'Spin in' }, { rot: go(200, 0, OUT_CUBIC), ...both(go(0.2, 1, OUT_CUBIC)), alpha: fade() }),
  def('in-bounce', { tw: '彈跳落下', cn: '弹跳落下', en: 'Bounce down' }, { ty: BOUNCE, alpha: fade(5) }),
  def('in-swing', { tw: '擺入', cn: '摆入', en: 'Swing in' }, { rot: SWING, alpha: fade(3) }),
  def('in-stretch', { tw: '橫向展開', cn: '横向展开', en: 'Unfold' }, { sx: go(0, 1, OUT_CUBIC), alpha: fade(3) }),
  def('in-flicker', { tw: '閃現', cn: '闪现', en: 'Flicker in' }, { alpha: FLICKER }),
  def('in-dissolve', { tw: '溶解', cn: '溶解', en: 'Dissolve' }, { alpha: go(0, 1, QUAD_IN), ...both(go(1.12, 1, OUT_CUBIC)) }),
  ...PC_IN,
]
/** 出场 15 款：某款入场倒着播（from＝那款入场的编号） */
const OUT_SRC: ReadonlyArray<[string, AnimName, string]> = [
  ['out-fade', { tw: '漸隱', cn: '渐隐', en: 'Fade out' }, 'in-fade'],
  ['out-zoom-up', { tw: '放大消失', cn: '放大消失', en: 'Zoom away' }, 'in-zoom-down'],
  ['out-zoom-down', { tw: '縮小消失', cn: '缩小消失', en: 'Shrink away' }, 'in-zoom-up'],
  ['out-pop', { tw: '彈出', cn: '弹出', en: 'Pop out' }, 'in-pop'],
  ['out-type', { tw: '打字消失', cn: '打字消失', en: 'Backspace' }, 'in-type'],
  ['out-rise', { tw: '向上消失', cn: '向上消失', en: 'Lift away' }, 'in-drop'],
  ['out-drop', { tw: '向下消失', cn: '向下消失', en: 'Sink away' }, 'in-rise'],
  ['out-left', { tw: '向左滑出', cn: '向左滑出', en: 'Slide out left' }, 'in-right'],
  ['out-right', { tw: '向右滑出', cn: '向右滑出', en: 'Slide out right' }, 'in-left'],
  ['out-roll', { tw: '滾出', cn: '滚出', en: 'Roll out' }, 'in-roll'],
  ['out-spin', { tw: '旋出', cn: '旋出', en: 'Spin out' }, 'in-spin'],
  ['out-swing', { tw: '擺出', cn: '摆出', en: 'Swing out' }, 'in-swing'],
  ['out-stretch', { tw: '橫向收起', cn: '横向收起', en: 'Fold' }, 'in-stretch'],
  ['out-flicker', { tw: '閃滅', cn: '闪灭', en: 'Flicker out' }, 'in-flicker'],
  ['out-dissolve', { tw: '消散', cn: '消散', en: 'Dissolve out' }, 'in-dissolve'],
  ['out-pc-fade', { tw: '逐字消失', cn: '逐字消失', en: 'Letters fade out' }, 'in-pc-fade'],
  ['out-pc-spin', { tw: '逐字旋出', cn: '逐字旋出', en: 'Letters spin out' }, 'in-pc-spin'],
  ['out-pc-fold', { tw: '逐字折起', cn: '逐字折起', en: 'Letters fold away' }, 'in-pc-fold'],
  ['out-pc-standup', { tw: '逐字倒下', cn: '逐字倒下', en: 'Letters fall down' }, 'in-pc-standup'],
  ['out-pc-pop', { tw: '逐字縮沒', cn: '逐字缩没', en: 'Letters pop out' }, 'in-pc-pop'],
]
export const ANIM_OUT: readonly AnimDef[] = OUT_SRC.map(([id, name, from]) => {
  const src = ANIM_IN.find((d) => d.id === from)!
  if (src.perChar) { const pc = src.perChar; return { id, name, kf: src.kf, reversed: true, f: (p: number) => src.f(1 - p), perChar: { ...pc, f: (q: number) => pc.f(1 - q) } } }
  return { id, name, kf: src.kf, reversed: true, f: (p: number) => src.f(1 - p) }
})
/** 心跳：两下（线性三角形·先大后小） */
const HEART: Tr = [[0, 1], [0.02, 1], [0.1, 1.12], [0.18, 1], [0.22, 1], [0.3, 1.08], [0.38, 1], [1, 1]]
/** 循环 8 款（p＝一圈里的位置） */
export const ANIM_LOOP: readonly AnimDef[] = [
  def('loop-breathe', { tw: '呼吸', cn: '呼吸', en: 'Breathe' }, both(smoothKeys((p) => 1 + 0.07 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)), [0.5]))),
  def('loop-sway', { tw: '搖擺', cn: '摇摆', en: 'Sway' }, { rot: wave(7, 1) }),
  def('loop-jump', { tw: '跳動', cn: '跳动', en: 'Hop' }, { ty: smoothKeys((p) => -0.3 * Math.sin(Math.PI * p), [0.5]), sy: smoothKeys((p) => 1 - 0.05 * (1 - Math.sin(Math.PI * p)), [0.5]), sx: smoothKeys((p) => 1 + 0.05 * (1 - Math.sin(Math.PI * p)), [0.5]) }),
  def('loop-blink', { tw: '閃爍', cn: '闪烁', en: 'Blink' }, { alpha: smoothKeys((p) => 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(2 * Math.PI * p)), [0.5]) }),
  def('loop-float', { tw: '漂浮', cn: '漂浮', en: 'Float' }, { ty: wave(0.14, 1), rot: wave(2, 1, 1) }),
  def('loop-shake', { tw: '抖動', cn: '抖动', en: 'Shake' }, { tx: wave(0.06, 5), rot: wave(1.5, 7) }),
  def('loop-heartbeat', { tw: '心跳', cn: '心跳', en: 'Heartbeat' }, both(HEART)),
  def('loop-jelly', { tw: '果凍', cn: '果冻', en: 'Jelly' }, { sx: wave(0.09, 1, 0, 1), sy: wave(-0.09, 1, 0, 1) }),
]
export const ANIM_LIB: Record<TextAnimSlot, readonly AnimDef[]> = { in: ANIM_IN, out: ANIM_OUT, loop: ANIM_LOOP }
export const animDef = (slot: TextAnimSlot, id: string): AnimDef | undefined => ANIM_LIB[slot].find((d) => d.id === id)

const r3 = (v: number) => Math.round(v * 1000) / 1000
/** 读档验值：每格认得的编号才留·秒数夹进范围；一格都没有 ⇒ undefined（不存） */
export function parseTextAnim(v: unknown): TextAnimSet | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o: TextAnimSet = {}
  for (const k of ANIM_SLOTS) {
    const a = (v as Record<string, unknown>)[k]
    if (!a || typeof a !== 'object') continue
    const { id, dur } = a as Record<string, unknown>
    if (typeof id !== 'string' || !animDef(k, id)) continue
    const d = typeof dur === 'number' && Number.isFinite(dur) ? dur : ANIM_DUR[k].def
    o[k] = { id, dur: r3(clamp(d, ANIM_DUR[k].min, ANIM_DUR[k].max)) }
    const st = (a as Record<string, unknown>).stagger
    if (animDef(k, id)!.perChar && typeof st === 'number' && Number.isFinite(st)) o[k]!.stagger = r3(clamp(st, STAGGER.min, STAGGER.max))
  }
  return Object.keys(o).length ? o : undefined
}

/** 面板改一格：给值＝换成这款；null＝拿掉这格；没写＝不动 */
export type TextAnimPatch = { [K in TextAnimSlot]?: TextAnim | null }
export function mergeTextAnim(cur: TextAnimSet | undefined, p: TextAnimPatch): TextAnimSet | undefined {
  const raw: Record<string, unknown> = { ...(cur ?? {}) }
  for (const k of ANIM_SLOTS) { const v = p[k]; if (v === undefined) continue; if (v === null) delete raw[k]; else raw[k] = v }
  return parseTextAnim(raw)
}

/** 入场／出场这一段实际几秒（两段加起来比片段长 ⇒ 按比例缩短） */
export function animSpans(a: TextAnimSet | undefined, length: number): { inD: number; outD: number } {
  const i = a?.in?.dur ?? 0, o = a?.out?.dur ?? 0, len = Math.max(0, length)
  const k = i + o > len && i + o > 0 ? len / (i + o) : 1
  return { inD: i * k, outD: o * k }
}

/** 这一刻的姿势：seg＝片段起点到现在（秒）；length＝片段长；local＝接着播的秒（offset＋seg·循环用）。没动画 ⇒ POSE_IDLE */
export function textAnimPose(a: TextAnimSet | undefined, seg: number, length: number, local: number = seg): AnimPose {
  if (!a) return POSE_IDLE
  const pose: AnimPose = { ...POSE_IDLE }
  const add = (q: Partial<AnimPose>) => {
    pose.tx += q.tx ?? 0; pose.ty += q.ty ?? 0; pose.rot += q.rot ?? 0
    pose.sx *= q.sx ?? 1; pose.sy *= q.sy ?? 1; pose.alpha *= q.alpha ?? 1
    pose.reveal = Math.min(pose.reveal, q.reveal ?? 1)
  }
  const { inD, outD } = animSpans(a, length)
  // 逐字款不动整段（每字姿势走 charPoseAt）
  const fin = a.in && animDef('in', a.in.id), fout = a.out && animDef('out', a.out.id)
  const floop = a.loop && animDef('loop', a.loop.id)
  if (fin && !fin.perChar && inD > 0 && seg < inD) add(fin.f(c01(seg / inD)))
  if (fout && !fout.perChar && outD > 0 && seg > length - outD) add(fout.f(c01((seg - (length - outD)) / outD)))
  if (floop && a.loop!.dur > 0) { const ph = (((local / a.loop!.dur) % 1) + 1) % 1; add(floop.f(ph)) }
  pose.alpha = c01(pose.alpha); pose.reveal = c01(pose.reveal)
  return pose
}
export const poseIdle = (p: AnimPose) => p.tx === 0 && p.ty === 0 && p.sx === 1 && p.sy === 1 && p.rot === 0 && p.alpha === 1 && p.reveal >= 1

/** 打字机：字（不算换行）共几个、这一刻看得到几个 */
export const charCount = (content: string) => Array.from(content).filter((ch) => ch !== '\n').length
export const visibleChars = (content: string, reveal: number) => (reveal >= 1 ? charCount(content) : Math.floor(c01(reveal) * charCount(content)))
/** 看得到 n 个字 ⇒ 原字串切在第几个码元（换行不算字·跟着前面的字一起露出） */
export function revealCut(content: string, n: number): number {
  let seen = 0, i = 0
  for (const ch of Array.from(content)) {
    if (ch !== '\n') { if (seen >= n) return i; seen++ }
    i += ch.length
  }
  return content.length
}

/** 面板预览：小格子里一直重播（入场／出场：播完停 0.6 秒再来；循环：一直转） */
export function previewPose(slot: TextAnimSlot, id: string, dur: number, clock: number): AnimPose {
  const d = Math.max(0.1, dur)
  if (slot === 'loop') return textAnimPose({ loop: { id, dur: d } }, clock, Infinity, clock)
  const cyc = d + 0.6, t = clock % cyc
  return slot === 'in' ? textAnimPose({ in: { id, dur: d } }, t, cyc) : textAnimPose({ out: { id, dur: d } }, Math.min(t, d) + (cyc - d), cyc)
}

// ── 逐字计算（预览与汇出共用） ──
/** 药：DILIN_NEG 含 vedit_text_perchar_off ⇒ 逐字动画不生效（只在 node 测试跑） */
function perCharOff(): boolean {
  const env = typeof process !== 'undefined' ? process.env?.DILIN_NEG ?? '' : ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_text_perchar_off')
}
export const hasPerChar = (a: TextAnimSet | undefined) => !!((a?.in && animDef('in', a.in.id)?.perChar) || (a?.out && animDef('out', a.out.id)?.perChar))
/** 没设每字间隔时的缺省（固定 0.06 秒时 3 秒 12 个字几乎一起出、看不出逐字）：照这段时长与字数摊——时长×0.7÷字数·夹 0.03～0.5 秒；
 *  例：3 秒 12 字≈0.18 秒、0.5 秒 4 字≈0.09 秒。手动设过的照设的值。药：DILIN_NEG 含 vedit_perchar_auto_off ⇒ 退回固定 STAGGER.def */
export function autoStagger(span: number, n: number): number {
  const env = typeof process !== 'undefined' ? process.env?.DILIN_NEG ?? '' : ''
  if (typeof window === 'undefined' && env.split(',').includes('vedit_perchar_auto_off')) return STAGGER.def
  if (!(span > 0) || n < 1) return STAGGER.def
  return r3(clamp((span * 0.7) / n, 0.03, 0.5))
}
/** 一段 span 秒里 n 个字：实际间隔（太长就压到 span 的七成摊给 n-1 个间隔）与每字时长 */
export function charTiming(span: number, n: number, stagger?: number): { gap: number; each: number } {
  const st = stagger ?? autoStagger(span, n)
  const g = n > 1 ? Math.min(Math.max(0, st), (span * 0.7) / (n - 1)) : 0
  return { gap: g, each: Math.max(1e-6, span - g * (n - 1)) }
}
/** 第 i 个字（0 起·换行不算字）在 seg 秒（片段起点起算）的字姿势；n＝字数。不是逐字款 ⇒ CHAR_IDLE */
export function charPoseAt(a: TextAnimSet | undefined, i: number, n: number, seg: number, length: number): CharPose {
  if (!a || perCharOff()) return CHAR_IDLE
  const { inD, outD } = animSpans(a, length)
  const fin = a.in && animDef('in', a.in.id)?.perChar, fout = a.out && animDef('out', a.out.id)?.perChar
  if (!fin && !fout) return CHAR_IDLE
  const p: CharPose = { ...CHAR_IDLE }
  const add = (q: Partial<CharPose>, pivot: number) => {
    p.tx += q.tx ?? 0; p.ty += q.ty ?? 0; p.rot += q.rot ?? 0; p.rx += q.rx ?? 0; p.ry += q.ry ?? 0
    p.sx *= q.sx ?? 1; p.sy *= q.sy ?? 1; p.alpha *= q.alpha ?? 1; if (pivot) p.pivot = pivot
  }
  if (fin && inD > 0 && seg < inD) { const { gap, each } = charTiming(inD, n, a.in!.stagger); add(fin.f(c01((seg - i * gap) / each)), fin.pivot) }
  if (fout && outD > 0 && seg > length - outD) { const { gap, each } = charTiming(outD, n, a.out!.stagger); add(fout.f(c01((seg - (length - outD) - i * gap) / each)), fout.pivot) }
  p.alpha = c01(p.alpha)
  return p
}
/** 整段 n 个字这一刻的字姿势；全都静止（或不是逐字款）⇒ null（照旧整段画·旧工程不变） */
export function charPoses(a: TextAnimSet | undefined, n: number, seg: number, length: number): CharPose[] | null {
  if (!hasPerChar(a) || perCharOff()) return null
  const out = Array.from({ length: n }, (_, i) => charPoseAt(a, i, n, seg, length))
  return out.every((q) => q === CHAR_IDLE || charIdle(q)) ? null : out
}
export const charIdle = (q: CharPose) => q.tx === 0 && q.ty === 0 && q.sx === 1 && q.sy === 1 && q.rot === 0 && q.rx === 0 && q.ry === 0 && q.alpha === 1
/** 透视感强度：3D 翻转用 2D 仿射近似（缩放＋斜切）·翻 ry 时近的那边看起来高一点（斜切 y）·翻 rx 时上下边错开一点（斜切 x） */
export const PERSP = 0.3
/** 字姿势 ⇒ 2D 矩阵 [a,b,c,d,e,f]（canvas setTransform／CSS matrix 同排法·e／f 单位 em·以字中心为原点）。
 *  3D 近似：绕横轴翻 rx ⇒ 竖向缩 cos(rx)＋横斜切 PERSP·sin(rx)；绕直轴翻 ry ⇒ 横向缩 cos(ry)＋竖斜切 PERSP·sin(ry)；以 pivot 为轴心。 */
export function charMatrix(q: CharPose): [number, number, number, number, number, number] {
  const rx = (q.rx * Math.PI) / 180, ry = (q.ry * Math.PI) / 180, r = (q.rot * Math.PI) / 180
  // 3D 近似（列向量）：X 轴 → (cos ry, PERSP·sin ry)、Y 轴 → (PERSP·sin rx, cos rx)
  const la = q.sx * Math.cos(ry), lb = q.sx * PERSP * Math.sin(ry), lc = q.sy * PERSP * Math.sin(rx), ld = q.sy * Math.cos(rx)
  const cr = Math.cos(r), sr = Math.sin(r)
  const a = cr * la - sr * lb, b = sr * la + cr * lb, c = cr * lc - sr * ld, d = sr * lc + cr * ld
  // 轴心 (0,pivot)：T(tx,ty)·T(0,pv)·M·T(0,-pv)
  const pv = q.pivot
  return [a, b, c, d, q.tx - c * pv, q.ty + pv - d * pv]
}
const n6 = (v: number) => Math.round(v * 1e6) / 1e6
/** 预览用：字姿势 ⇒ CSS（matrix 的位移另用 em 的 translate·同一份 charMatrix） */
export function charCss(q: CharPose): { transform: string; opacity: number } {
  const [a, b, c, d, e, f] = charMatrix(q)
  return { transform: `translate(${n6(e)}em, ${n6(f)}em) matrix(${n6(a)}, ${n6(b)}, ${n6(c)}, ${n6(d)}, 0, 0)`, opacity: q.alpha }
}
/** 面板小格预览（逐字款）：同 previewPose 的重播节奏 */
export function previewCharPoses(slot: TextAnimSlot, id: string, dur: number, clock: number, n: number, stagger?: number): CharPose[] | null {
  if (slot === 'loop') return null
  const d = Math.max(0.1, dur), cyc = d + 0.6, t = clock % cyc
  const a: TextAnimSet = { [slot]: { id, dur: d, ...(stagger !== undefined ? { stagger } : {}) } }
  return charPoses(a, n, slot === 'in' ? t : Math.min(t, d) + (cyc - d), cyc)
}
