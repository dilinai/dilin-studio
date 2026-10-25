// 网页剪辑页·选中影片／图片／音频片段时「人工」页的属性（附剪映右栏 11 张截图）。
// 照剪映右栏排：画面（基础：位置大小／旋转／对齐／混合模式／不透明度；蒙版：线性／镜面／圆形／矩形／星形／爱心＋位置／旋转／大小／羽化／圆角／反转）·
//   音频（音量 dB／淡入／淡出）·变速（常规：倍数／时长／声音变调）·动画（入场／出场／循环·款式同文字动画库·去掉打字类）·调整（基础：色温…暗角 16 项）。
// 抠像、美颜美体、跟踪、曲线变速、变速卡点、HSL／曲线／色轮、换音色、声音效果这次没做（面板写「还没做」）。
// 本档只放纯函数（题直接跑）：值的范围、读档验值、改动合并、变速改长度、淡入淡出音量、预览要用的 CSS／SVG 字串。画在 video-edit/VeditClipInspector.tsx。⛔ 碰 DOM。
import { MIN_CLIP, SPEED_MAX, SPEED_MIN, clipGain, findClip, snapFrame, speedOf, srcAt, timeOfSrc, type Lane, type LayerState, type TextAnim, type TextAnimSet, type TextAnimSlot, type TlClip, type Tracks } from './timeline.pure'
import { ANIM_DUR, ANIM_LIB, ANIM_SLOTS, POSE_IDLE, parseTextAnim, textAnimPose, type AnimDef, type AnimPose } from './text-anim.pure'
import { KF_ADJ_KEYS, KF_MASK_KEYS, KF_PIN_KEYS, kfApply, kfEaseAt, kfIndexAt, kfSetEase, kfTimes, kfToggle, kfValue, normalizeKf, type KfEase, type KfProp, type KfTracks } from './keyframe.pure'
import { curveAvg, normCurve, type SpeedCurve } from './curve-speed.pure'
import type { Mosaic } from './mosaic.pure' // 追踪打码
import type { ClipFollow, MTrack } from './motion-track.pure' // 运动跟踪
import { parseMotionBlur, type ClipMotionBlur } from './motion-blur.pure' // 运动模糊
import { mergeAudio, type ClipAudio } from './audio.pure' // 声音处理
import { gradeActive, parseCurves, parseHsl, parseKey, parseLut, parseWheels, type ClipCurves, type ClipHsl, type ClipKey, type ClipLut, type ClipWheels, type Grade } from './grade.pure' // 调色抠像
import { PIN_ZERO, parsePin, type ClipPin, type PinKey, lookFxNegOff, parseRot3d, type ClipRot3d } from './corner-pin.pure' // 四角透视＋3D 旋转
import { MASK_OPS, STRIPE_DEFAULT, masksOfLook, maskMatteNegOff, normStripe, parseMatte, storeMasks, stripesShape, MASKS_MAX, type ClipMatte, type MaskOp, type StripeEase } from './mask-matte.pure' // 条纹／多蒙版／轨道遮罩

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r4 = (v: number) => Math.round(v * 10000) / 10000

// ── 画面·基础 ──
/** 混合模式（剪映「混合模式」下拉·CSS mix-blend-mode 做得到的那几种） */
export const BLEND_MODES = ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion'] as const
export type BlendMode = (typeof BLEND_MODES)[number]
/** 缩放（剪映 1%～1000%·这里存倍数） */
export const SCALE_MIN = 0.01
export const SCALE_MAX = 10
/** 位置：画面中心往右／往上挪多少（占画面宽／高的几成·-2～2） */
export const POS_LIM = 2

// ── 画面·蒙版 ──
export const MASK_SHAPES = ['linear', 'mirror', 'circle', 'rect', 'star', 'heart', 'pen', 'stripes'] as const // pen＝钢笔（自己点出来的形状）·stripes＝条纹百叶
export type MaskShape = (typeof MASK_SHAPES)[number]
/** 蒙版：x／y＝中心（同片段位置的单位）；w／h＝大小（占画面宽／高几成）；rot＝旋转；feather＝羽化 0～100；radius＝圆角 0～100（矩形才有）；invert＝反转 */
/** 钢笔：pts＝点（单位方框 -0.5～0.5·往下为正·照 w／h 放大、照 rot 转）；sharp＝直线连（缺＝平滑曲线） */
export type ClipMask = { shape: MaskShape; x: number; y: number; w: number; h: number; rot: number; feather: number; radius: number; invert: boolean; pts?: Array<[number, number]>; sharp?: boolean
  /** 条纹（shape=stripes）：count 条数·gap 每格空几成·progress 进度 0..1（可打关键帧 mask.progress）·stagger 每条间隔 0..1·ease 缓动；角度＝rot */
  count?: number; gap?: number; progress?: number; stagger?: number; ease?: StripeEase }
/** 钢笔新画出来先给一个六边形 */
export const PEN_DEFAULT: Array<[number, number]> = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; return [Math.round(Math.cos(a) * 0.5 * 1000) / 1000, Math.round(Math.sin(a) * 0.5 * 1000) / 1000] as [number, number] })
export const PEN_MAX = 40
export const maskDefault = (shape: MaskShape): ClipMask => ({ shape, x: 0, y: 0, w: shape === 'mirror' ? 1 : 0.5, h: shape === 'mirror' ? 0.3 : 0.5, rot: 0, feather: 0, radius: 0, invert: false, ...(shape === 'pen' ? { pts: PEN_DEFAULT.map((p) => [p[0], p[1]] as [number, number]) } : {}), ...(shape === 'stripes' ? { w: 1, h: 1, ...STRIPE_DEFAULT } : {}) })
/** 钢笔点验值：夹在 -0.5～0.5（再外一点也行·1）·最多 PEN_MAX 个·至少 3 个 */
export function normPenPts(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null
  const pts = v.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
    .slice(0, PEN_MAX).map((p) => [r4(clamp(p[0], -1, 1)), r4(clamp(p[1], -1, 1))] as [number, number])
  return pts.length >= 3 ? pts : null
}

// ── 调整·基础（剪映 16 项·都是 -100～100 或 0～100） ──
export const ADJ_KEYS = ['temp', 'tint', 'sat', 'vib', 'bright', 'contrast', 'highlight', 'shadow', 'white', 'black', 'light', 'sharpen', 'clarity', 'grain', 'fade', 'vignette'] as const
export type AdjKey = (typeof ADJ_KEYS)[number]
export type ClipAdjust = Partial<Record<AdjKey, number>>
/** 只能往上调的（0～100）；其余 -100～100 */
export const ADJ_POSITIVE: ReadonlySet<AdjKey> = new Set<AdjKey>(['sharpen', 'clarity', 'grain', 'fade'])
export const adjRange = (k: AdjKey): [number, number] => (ADJ_POSITIVE.has(k) ? [0, 100] : [-100, 100])
/** 面板分组（照剪映：色彩／明度／效果） */
export const ADJ_GROUPS: ReadonlyArray<{ group: 'color' | 'tone' | 'effect'; keys: readonly AdjKey[] }> = [
  { group: 'color', keys: ['temp', 'tint', 'sat', 'vib'] },
  { group: 'tone', keys: ['bright', 'contrast', 'highlight', 'shadow', 'white', 'black', 'light'] },
  { group: 'effect', keys: ['sharpen', 'clarity', 'grain', 'fade', 'vignette'] },
]

/** 画面属性：sx／sy＝缩放（等比时两个一样）；uniform=false＝不等比；x／y；rot＝旋转（度·顺时针）；blend；opacity 0～1；mask；adj */
export type ClipLook = { sx?: number; sy?: number; uniform?: boolean; x?: number; y?: number; rot?: number; blend?: BlendMode; opacity?: number; mask?: ClipMask; adj?: ClipAdjust
  /** masks＝挂两个以上蒙版时的全部（mask 同时存第一个·旧版照读）；maskOp＝合成方式（and 交集·缺省／or 并集）；matte＝轨道遮罩 */
  masks?: ClipMask[]; maskOp?: MaskOp; matte?: ClipMatte
  /** flipH／flipV＝镜像（左右／上下翻）；crop＝裁剪（素材四边各裁掉几成·0～0.9·两边加起来留至少 5%）；bg＝背景填充（画面没盖满的地方：纯色或同一画面放大模糊） */
  flipH?: boolean; flipV?: boolean; crop?: ClipCrop; bg?: ClipBg
  /** 四角透视（corner-pin.pure·没有＝不透视） */
  pin?: ClipPin
  /** 运动模糊（只对影片·见 motion-blur.pure.ts） */
  mblur?: ClipMotionBlur
  /** hsl／curves／wheels／lut＝调色（见 grade.pure.ts）；key＝色度抠像；corner＝圆角（0～100·对着素材那块）；shadow＝阴影 */
  hsl?: ClipHsl; curves?: ClipCurves; wheels?: ClipWheels; lut?: ClipLut; key?: ClipKey; corner?: number; shadow?: ClipShadow
  /** 外发光（glowPx）；描边（borderPx·贴着裁剪框／圆角的内缘）；3D 旋转面板记住的数值（真正画的是 pin·corner-pin rot3dToPin） */
  glow?: ClipGlow; border?: ClipBorder; rot3d?: ClipRot3d }
/** 外发光：color #rrggbb·radius 0～100（光晕半径·100＝画面高的 8%）·strength 0～100（浓淡·0＝不存） */
export type ClipGlow = { color: string; radius: number; strength: number }
export const GLOW_DEFAULT: ClipGlow = { color: '#ffffff', radius: 30, strength: 60 }
/** 描边：color #rrggbb·width 0～100（100＝画面高的 5%·0＝不存）·画在留下那块（裁剪框＋圆角）的内缘 */
export type ClipBorder = { color: string; width: number }
export const BORDER_DEFAULT: ClipBorder = { color: '#ffffff', width: 10 }
/** 外发光换算（画面高 h 像素）：模糊半径 blur（CSS drop-shadow 模糊＝画布 shadowBlur）·叠几层 passes（1～3）·每层颜色带透明度。
 *  预览＝外框 filter 串 passes 个 drop-shadow(0 0 blur color)（glowCss）；汇出＝同一组数字逐层「只画影子再盖原层」（export-render glowLayer）。药 ⇒ null */
/** 画布 shadowBlur 要填多少：CSS drop-shadow 的模糊值＝高斯标准差，画布 shadowBlur＝标准差的两倍（Chromium 下逐像素相同）⇒ ×2。
 * 之前汇出直接填同一个数，光晕只有预览一半宽、也淡。药：DILIN_NEG 含 vedit_glow_canvas_blur_off ⇒ ×1（旧行为） */
export function canvasBlur(cssBlur: number): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_glow_canvas_blur_off') ? cssBlur : cssBlur * 2
}
export function glowPx(g: ClipGlow | null | undefined, h: number): { blur: number; canvasBlur: number; passes: number; color: string } | null {
  if (!g || !(g.strength > 0) || !(g.radius > 0) || lookFxNegOff()) return null
  const st = clamp(g.strength, 0, 100)
  const passes = st > 66 ? 3 : st > 33 ? 2 : 1
  const al = Math.round(clamp(st / (passes * 33.4), 0, 1) * 255).toString(16).padStart(2, '0')
  const blur = (clamp(g.radius, 0, 100) / 100) * 0.08 * h
  return { blur, canvasBlur: canvasBlur(blur), passes, color: `${g.color}${al}` }
}
export function glowCss(g: ClipGlow | null | undefined): string | null {
  const p = glowPx(g, 100)
  return p ? Array.from({ length: p.passes }, () => `drop-shadow(0 0 ${r4(p.blur)}cqh ${p.color})`).join(' ') : null
}
/** 描边宽度（画面高 h 像素）；没描边／药 ⇒ 0 */
export const borderPx = (b: ClipBorder | null | undefined, h: number): number => (b && b.width > 0 && !lookFxNegOff() ? (clamp(b.width, 0, 100) / 100) * 0.05 * h : 0)
/** 描边那一圈（汇出、预览同一份）：box＝留下那块（cropBox·以画面宽／高为 1）、半径照 cornerPx（同圆角）、宽度照 borderPx；回画面高为 1 的单位 */
export function borderRing(fr: { x: number; y: number; w: number; h: number }, crop: ClipCrop | null | undefined, corner: number, b: ClipBorder | null | undefined, aspect: number): { x: number; y: number; w: number; h: number; r: number; width: number; color: string } | null {
  const width = borderPx(b, 1)
  if (!b || !(width > 0)) return null
  const bx = cropBox(fr, crop)
  return { ...bx, r: corner > 0 ? cornerPx(corner, bx.w * aspect, bx.h) : 0, width, color: b.color }
}
/** 画留下那块（汇出 drawMedia 的 put 与预览 DirBlurCanvas 共用）：r＝素材那块、cb＝留下那块（像素）、rad＝圆角像素、ring＝borderRing、H＝画面高像素 */
export type PathCtx = { save(): void; restore(): void; beginPath(): void; rect(x: number, y: number, w: number, h: number): void; roundRect(x: number, y: number, w: number, h: number, r: number): void; clip(): void; stroke(): void; lineWidth: number; strokeStyle: unknown }
export function paintFramed(c: PathCtx, draw0: (x: number, y: number, w: number, h: number) => void, r: Frame, cb: Frame, rad: number, ring: ReturnType<typeof borderRing>, H: number): void {
  if (!rad && !ring && cb.x === r.x && cb.y === r.y && cb.w === r.w && cb.h === r.h) { draw0(r.x, r.y, r.w, r.h); return }
  const path = () => { c.beginPath(); if (rad) c.roundRect(cb.x, cb.y, cb.w, cb.h, rad); else c.rect(cb.x, cb.y, cb.w, cb.h) }
  c.save(); path(); c.clip(); draw0(r.x, r.y, r.w, r.h)
  if (ring) { c.lineWidth = ring.width * H * 2; c.strokeStyle = ring.color; path(); c.stroke() } // 线宽两倍·被裁掉外半圈 ⇒ 内缘正好 ring.width
  c.restore()
}
/** 预览描边那层 div 的 style（放在这一层里面·跟着同一个 clip-path 裁·inset box-shadow ＝内缘一圈） */
export function borderCss(ring: NonNullable<ReturnType<typeof borderRing>>): { left: string; top: string; width: string; height: string; borderRadius: string; boxShadow: string } {
  const p = (v: number) => `${r4(v * 100)}%`
  return { left: p(ring.x), top: p(ring.y), width: p(ring.w), height: p(ring.h), borderRadius: `${r4(ring.r * 100)}cqh`, boxShadow: `inset 0 0 0 ${r4(ring.width * 100)}cqh ${ring.color}` }
}
/** 阴影：opacity 0～100·blur／dist 0～100（占画面短边几成的千分之…照 shadowPx 换算）·angle 度（0＝往右·90＝往下） */
export type ClipShadow = { color: string; opacity: number; blur: number; dist: number; angle: number }
export const SHADOW_DEFAULT: ClipShadow = { color: '#000000', opacity: 60, blur: 30, dist: 20, angle: 135 }
/** 阴影换成像素（画面高 h 像素）：偏移 dx／dy、模糊（CSS drop-shadow 的模糊半径＝画布 shadowBlur·都是两倍标准差） */
export function shadowPx(s: ClipShadow, h: number): { dx: number; dy: number; blur: number; canvasBlur: number; color: string } {
  const d = (s.dist / 100) * 0.06 * h, a = (s.angle * Math.PI) / 180
  const al = Math.round(clamp(s.opacity, 0, 100) * 2.55).toString(16).padStart(2, '0')
  const blur = (s.blur / 100) * 0.06 * h // 预览 drop-shadow 也是标准差 ⇒ 画布同 canvasBlur 换算
  return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, blur, canvasBlur: canvasBlur(blur), color: `${s.color}${al}` }
}
/** 预览：阴影用画面高的 cqh 单位（播放器那块设了 containerType size） */
export function shadowCss(s: ClipShadow): string {
  const p = shadowPx(s, 100)
  return `drop-shadow(${r4(p.dx)}cqh ${r4(p.dy)}cqh ${r4(p.blur)}cqh ${p.color})`
}
/** 圆角半径（占素材那块短边一半的几成·corner 0～100）⇒ 像素（素材那块 fw×fh 像素） */
export const cornerPx = (corner: number, fw: number, fh: number) => (clamp(corner, 0, 100) / 100) * 0.5 * Math.min(fw, fh)
export type ClipCrop = { l: number; t: number; r: number; b: number }
export type ClipBg = { kind: 'color'; color: string } | { kind: 'blur'; amount: number }
export const BG_COLORS = ['#000000', '#ffffff', '#1f2937', '#7f1d1d', '#14532d', '#1e3a8a', '#713f12', '#581c87', '#f5f0e6', '#f9a8d4'] as const
/** 模糊背景的几档（剪映四档）：模糊半径占画面短边几成 */
export const BG_BLUR_LEVELS = [1, 2, 3, 4] as const
export const bgBlurPx = (amount: number, short: number) => Math.round(short * 0.012 * amount * amount)
/** 裁剪比例预设（剪映「裁剪」那排：自由／原始比例以外的几种·宽／高） */
export const CROP_RATIOS: ReadonlyArray<{ key: string; r: number | null }> = [{ key: 'free', r: null }, { key: '16:9', r: 16 / 9 }, { key: '9:16', r: 9 / 16 }, { key: '1:1', r: 1 }, { key: '4:3', r: 4 / 3 }, { key: '3:4', r: 3 / 4 }]
/** 照比例裁成置中最大那块（srcRatio＝素材宽／高） */
export function cropForRatio(srcRatio: number, want: number | null): ClipCrop | undefined {
  if (!want || !(srcRatio > 0)) return undefined
  if (Math.abs(srcRatio - want) < 1e-3) return undefined
  if (srcRatio > want) { const keep = want / srcRatio, e = r4((1 - keep) / 2); return { l: e, t: 0, r: e, b: 0 } }
  const keep = srcRatio / want, e = r4((1 - keep) / 2)
  return { l: 0, t: e, r: 0, b: e }
}
const HEX = /^#[0-9a-f]{6}$/i
function normCrop(c: ClipCrop | undefined): ClipCrop | undefined {
  if (!c) return undefined
  const f = (v: number) => r4(clamp(Number.isFinite(v) ? v : 0, 0, 0.9))
  let l = f(c.l), r = f(c.r), t = f(c.t), b = f(c.b)
  if (l + r > 0.95) { const k = 0.95 / (l + r); l = r4(l * k); r = r4(r * k) }
  if (t + b > 0.95) { const k = 0.95 / (t + b); t = r4(t * k); b = r4(b * k) }
  return l || r || t || b ? { l, t, r, b } : undefined
}
function normBg(b: ClipBg | undefined): ClipBg | undefined {
  if (!b) return undefined
  if (b.kind === 'color') return HEX.test(b.color) ? { kind: 'color', color: b.color.toLowerCase() } : undefined
  if (b.kind === 'blur') return { kind: 'blur', amount: Math.round(clamp(b.amount, 1, 4)) }
  return undefined
}
/** 裁剪后素材在这一层里还看得到的那块（fr＝素材整块·0～1） */
export const cropBox = (fr: { x: number; y: number; w: number; h: number }, c: ClipCrop | null | undefined) =>
  c ? { x: fr.x + c.l * fr.w, y: fr.y + c.t * fr.h, w: fr.w * (1 - c.l - c.r), h: fr.h * (1 - c.t - c.b) } : fr
/** 预览：这一层的 clip-path（裁剪对着素材那块） */
export const cropClipPath = (fr: { x: number; y: number; w: number; h: number }, c: ClipCrop | null | undefined, corner = 0, aspect = 16 / 9): string | null => {
  if (!c && !(corner > 0)) return null
  const b = cropBox(fr, c)
  const p = (v: number) => `${r4(v * 100)}%`
  // 圆角：半径照留下那块的短边算（画面宽高比 aspect＝宽／高·横竖各写一个百分比才是正圆角）
  const rr = corner > 0 ? cornerPx(corner, b.w * aspect, b.h) : 0 // 以画面高为 1
  return `inset(${p(b.y)} ${p(1 - b.x - b.w)} ${p(1 - b.y - b.h)} ${p(b.x)}${rr > 0 ? ` round ${p(rr / aspect)} / ${p(rr)}` : ''})`
}
type KfClip = Pick<TlClip, 'look'> & Partial<Pick<TlClip, 'kf' | 'start' | 'length' | 'offset' | 'speed' | 'curve'>>
/** 画面属性（缺的补缺省）；给了 t（时间轴第几秒）且有关键帧 ⇒ 打过关键帧的那几项换成 t 那一刻的值（预览、汇出、面板同一份） */
export const lookOf = (c: KfClip, t?: number) => {
  const l = c.look ?? {}
  const o = { sx: l.sx ?? 1, sy: l.sy ?? 1, uniform: l.uniform !== false, x: l.x ?? 0, y: l.y ?? 0, rot: l.rot ?? 0, blend: l.blend ?? 'normal', opacity: l.opacity ?? 1, mask: (masksOfLook(l)[0] ?? null) as ClipMask | null, masks: masksOfLook(l) as ClipMask[], maskOp: (l.maskOp ?? 'and') as MaskOp, matte: maskMatteNegOff() ? null : l.matte ?? null as ClipMatte | null, adj: l.adj ?? {} as ClipAdjust,
    flipH: !!l.flipH, flipV: !!l.flipV, crop: l.crop ?? null as ClipCrop | null, bg: l.bg ?? null as ClipBg | null, mblur: l.mblur ?? null as ClipMotionBlur | null,
    hsl: l.hsl ?? null as ClipHsl | null, curves: l.curves ?? null as ClipCurves | null, wheels: l.wheels ?? null as ClipWheels | null, lut: l.lut ?? null as ClipLut | null, key: l.key ?? null as ClipKey | null,
    corner: l.corner ?? 0, shadow: l.shadow ?? null as ClipShadow | null, pin: l.pin ? { ...l.pin } : null as ClipPin | null,
    glow: l.glow ?? null as ClipGlow | null, border: l.border ?? null as ClipBorder | null, rot3d: l.rot3d ?? null as ClipRot3d | null }
  const kf = c.kf
  if (t === undefined || !kf) return o
  const s = kfSrc(c, t)
  const V = (p: KfProp, b: number) => kfValue(kf[p], s, b)
  o.sx = clamp(V('sx', o.sx), SCALE_MIN, SCALE_MAX); o.sy = clamp(V('sy', o.sy), SCALE_MIN, SCALE_MAX)
  if (o.uniform) o.sy = o.sx
  o.x = V('x', o.x); o.y = V('y', o.y); o.rot = V('rot', o.rot); o.opacity = clamp(V('opacity', o.opacity), 0, 1)
  if (o.mask) { const m = { ...o.mask }; for (const k of KF_MASK_KEYS) { const b = m[k]; if (b !== undefined || kf[`mask.${k}`]) m[k] = V(`mask.${k}`, b ?? 0) } if (m.progress !== undefined) m.progress = clamp(m.progress, 0, 1); o.mask = m; o.masks = [m, ...o.masks.slice(1)] } // 关键帧管第一个蒙版
  if (KF_ADJ_KEYS.some((k) => kf[`adj.${k}`])) { const a: ClipAdjust = { ...o.adj }; for (const k of KF_ADJ_KEYS) { const [lo, hi] = adjRange(k); const v = clamp(V(`adj.${k}`, a[k] ?? 0), lo, hi); if (v) a[k] = v; else delete a[k] } o.adj = a }
  if (o.pin) { const pn = o.pin; for (const k of KF_PIN_KEYS) pn[k] = V(`pin.${k}`, pn[k]) }
  return o
}
export type LookFull = ReturnType<typeof lookOf>
/** 关键帧用的素材时刻（缺栏的片段当从 0 算） */
const kfSrc = (c: Partial<Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve'>>, t: number) => srcAt({ start: c.start ?? 0, length: c.length ?? 0, offset: c.offset ?? 0, speed: c.speed, curve: c.curve }, t)

// ── 音量关键帧（存 dB·剪映音量也照 dB 走）──
/** 时间轴第 t 秒这段的音量倍数（有音量关键帧 ⇒ 照关键帧·不含淡入淡出） */
export function gainAt(c: Pick<TlClip, 'volume' | 'kf' | 'start' | 'length' | 'offset' | 'speed' | 'curve'>, t: number): number {
  const tr = c.kf?.vol
  if (!tr?.length) return clipGain(c)
  return dbToVol(kfValue(tr, kfSrc(c, t), volToDb(clipGain(c))))
}
/** 汇出混音用：有音量关键帧 ⇒ 逐帧（30fps）[片段里第几秒, 倍数]；没有 ⇒ null */
export function gainEnvelope(c: TlClip, step = 1 / 30): Array<[number, number]> | null {
  if (!c.kf?.vol?.length || !(c.length > 0)) return null
  const n = Math.max(1, Math.ceil(c.length / step))
  return Array.from({ length: n + 1 }, (_, i) => { const tau = Math.min(c.length, i * step); return [r4(tau), r4(gainAt(c, c.start + tau))] as [number, number] })
}

/** 拿掉缺省值（不存一堆 0 与 1）；全是缺省 ⇒ undefined */
export function normalizeLook(l: ClipLook | undefined): ClipLook | undefined {
  if (!l) return undefined
  const o: ClipLook = {}
  const sx = clamp(l.sx ?? 1, SCALE_MIN, SCALE_MAX), sy = clamp(l.sy ?? sx, SCALE_MIN, SCALE_MAX)
  if (Math.abs(sx - 1) > 1e-4) o.sx = r4(sx)
  if (Math.abs(sy - 1) > 1e-4) o.sy = r4(sy)
  if (l.uniform === false) o.uniform = false
  if (l.x && Math.abs(l.x) > 1e-5) o.x = r4(clamp(l.x, -POS_LIM, POS_LIM))
  if (l.y && Math.abs(l.y) > 1e-5) o.y = r4(clamp(l.y, -POS_LIM, POS_LIM))
  const rot = l.rot ? ((l.rot % 360) + 360) % 360 : 0
  if (rot > 1e-3 && Math.abs(rot - 360) > 1e-3) o.rot = Math.round((rot > 180 ? rot - 360 : rot) * 100) / 100
  if (l.blend && l.blend !== 'normal' && BLEND_MODES.includes(l.blend)) o.blend = l.blend
  if (l.opacity !== undefined && l.opacity < 1 - 1e-4) o.opacity = r4(clamp(l.opacity, 0, 1))
  const ml = (l.masks && l.masks.length ? l.masks : l.mask ? [l.mask] : []).slice(0, MASKS_MAX).map(normMask)
  Object.assign(o, storeMasks(ml))
  if (ml.length > 1 && l.maskOp === 'or') o.maskOp = 'or'
  const mt = parseMatte(l.matte); if (mt) o.matte = mt
  const adj: ClipAdjust = {}
  for (const k of ADJ_KEYS) { const [lo, hi] = adjRange(k); const v = Math.round(clamp(l.adj?.[k] ?? 0, lo, hi)); if (v) adj[k] = v }
  if (Object.keys(adj).length) o.adj = adj
  if (l.flipH) o.flipH = true
  if (l.flipV) o.flipV = true
  const crop = normCrop(l.crop); if (crop) o.crop = crop
  const bg = normBg(l.bg); if (bg) o.bg = bg
  const mb = parseMotionBlur(l.mblur); if (mb) o.mblur = mb // 运动模糊
  // 调色、抠像、圆角、阴影（经同一套验值·全缺省就不存）
  const hsl = parseHsl(l.hsl); if (hsl) o.hsl = hsl
  const curves = parseCurves(l.curves); if (curves) o.curves = curves
  const wheels = parseWheels(l.wheels); if (wheels) o.wheels = wheels
  const lut = parseLut(l.lut); if (lut) o.lut = lut
  const key = parseKey(l.key); if (key) o.key = key
  const corner = Math.round(clamp(l.corner ?? 0, 0, 100)); if (corner) o.corner = corner
  const sh = normShadow(l.shadow); if (sh) o.shadow = sh
  const pin = parsePin(l.pin); if (pin) o.pin = pin
  const gl = normGlow(l.glow); if (gl) o.glow = gl
  const bd = normBorder(l.border); if (bd) o.border = bd
  const r3 = parseRot3d(l.rot3d); if (r3) o.rot3d = r3
  return Object.keys(o).length ? o : undefined
}
const hexOr = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d)
/** 外发光验值：强度或半径 0／药 ⇒ undefined */
export function normGlow(v: unknown): ClipGlow | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v) || lookFxNegOff()) return undefined
  const o = v as Record<string, unknown>
  const g: ClipGlow = { color: hexOr(o.color, GLOW_DEFAULT.color), radius: Math.round(clamp(num(o.radius) ?? GLOW_DEFAULT.radius, 0, 100)), strength: Math.round(clamp(num(o.strength) ?? GLOW_DEFAULT.strength, 0, 100)) }
  return g.radius > 0 && g.strength > 0 ? g : undefined
}
/** 描边验值：宽度 0／药 ⇒ undefined */
export function normBorder(v: unknown): ClipBorder | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v) || lookFxNegOff()) return undefined
  const o = v as Record<string, unknown>
  const b: ClipBorder = { color: hexOr(o.color, BORDER_DEFAULT.color), width: Math.round(clamp(num(o.width) ?? BORDER_DEFAULT.width, 0, 100)) }
  return b.width > 0 ? b : undefined
}
function normShadow(s: unknown): ClipShadow | undefined {
  if (!s || typeof s !== 'object') return undefined
  const o = s as Record<string, unknown>
  const k = (v: unknown, d: number, hi = 100) => Math.round(clamp(num(v) ?? d, 0, hi))
  const color = typeof o.color === 'string' && HEX.test(o.color) ? o.color.toLowerCase() : SHADOW_DEFAULT.color
  const r: ClipShadow = { color, opacity: k(o.opacity, SHADOW_DEFAULT.opacity), blur: k(o.blur, SHADOW_DEFAULT.blur), dist: k(o.dist, SHADOW_DEFAULT.dist), angle: ((Math.round(num(o.angle) ?? SHADOW_DEFAULT.angle) % 360) + 360) % 360 }
  return r.opacity > 0 ? r : undefined
}
function normMask(m: ClipMask): ClipMask {
  const o: ClipMask = { shape: m.shape, x: r4(clamp(m.x, -POS_LIM, POS_LIM)), y: r4(clamp(m.y, -POS_LIM, POS_LIM)), w: r4(clamp(m.w, 0.02, 4)), h: r4(clamp(m.h, 0.02, 4)), rot: Math.round(m.rot * 100) / 100, feather: Math.round(clamp(m.feather, 0, 100)), radius: Math.round(clamp(m.radius, 0, 100)), invert: !!m.invert }
  if (m.shape === 'stripes') Object.assign(o, normStripe(m as unknown as Record<string, unknown>))
  if (m.shape === 'pen') { o.pts = normPenPts(m.pts) ?? PEN_DEFAULT.map((p) => [p[0], p[1]] as [number, number]); if (m.sharp) o.sharp = true }
  return o
}
/** 读档验值（工程档里的 look·坏的丢） */
export function parseLook(v: unknown): ClipLook | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const l: ClipLook = {}
  for (const k of ['sx', 'sy', 'x', 'y', 'rot', 'opacity'] as const) { const n = num(o[k]); if (n !== null) l[k] = n }
  if (o.uniform === false) l.uniform = false
  if (typeof o.blend === 'string' && (BLEND_MODES as readonly string[]).includes(o.blend)) l.blend = o.blend as BlendMode
  const pm = (m: Record<string, unknown> | undefined): ClipMask | null => {
    if (!m || typeof m !== 'object' || !(MASK_SHAPES as readonly string[]).includes(String(m.shape))) return null
    const d = maskDefault(m.shape as MaskShape)
    return { shape: d.shape, x: num(m.x) ?? d.x, y: num(m.y) ?? d.y, w: num(m.w) ?? d.w, h: num(m.h) ?? d.h, rot: num(m.rot) ?? 0, feather: num(m.feather) ?? 0, radius: num(m.radius) ?? 0, invert: m.invert === true,
      ...(d.shape === 'pen' ? { pts: normPenPts(m.pts) ?? d.pts, ...(m.sharp === true ? { sharp: true } : {}) } : {}), ...(d.shape === 'stripes' ? normStripe(m) : {}) }
  }
  const m0 = pm(o.mask as Record<string, unknown> | undefined); if (m0) l.mask = m0
  if (Array.isArray(o.masks)) { const ms = o.masks.map((x) => pm(x as Record<string, unknown>)).filter((x): x is ClipMask => !!x); if (ms.length) l.masks = ms } // 多蒙版（旧档没有 ⇒ 照 mask）
  if (typeof o.maskOp === 'string' && (MASK_OPS as readonly string[]).includes(o.maskOp)) l.maskOp = o.maskOp as MaskOp
  const mt = parseMatte(o.matte); if (mt) l.matte = mt
  const a = o.adj as Record<string, unknown> | undefined
  if (a && typeof a === 'object') { const adj: ClipAdjust = {}; for (const k of ADJ_KEYS) { const n = num(a[k]); if (n !== null) adj[k] = n } l.adj = adj }
  if (o.flipH === true) l.flipH = true
  if (o.flipV === true) l.flipV = true
  const cr = o.crop as Record<string, unknown> | undefined
  if (cr && typeof cr === 'object') l.crop = { l: num(cr.l) ?? 0, t: num(cr.t) ?? 0, r: num(cr.r) ?? 0, b: num(cr.b) ?? 0 }
  const bg = o.bg as Record<string, unknown> | undefined
  if (bg && typeof bg === 'object') { if (bg.kind === 'color' && typeof bg.color === 'string') l.bg = { kind: 'color', color: bg.color }; else if (bg.kind === 'blur') l.bg = { kind: 'blur', amount: num(bg.amount) ?? 2 } }
  if (o.mblur && typeof o.mblur === 'object') l.mblur = o.mblur as ClipMotionBlur // 运动模糊（normalizeLook 里验）
  // 调色、抠像、圆角、阴影（normalizeLook 里逐项验）
  l.hsl = o.hsl as ClipHsl; l.curves = o.curves as ClipCurves; l.wheels = o.wheels as ClipWheels; l.lut = o.lut as ClipLut; l.key = o.key as ClipKey
  const cn = num(o.corner); if (cn !== null) l.corner = cn
  if (o.shadow && typeof o.shadow === 'object') l.shadow = o.shadow as ClipShadow
  if (o.pin && typeof o.pin === 'object') l.pin = o.pin as ClipPin
  if (o.glow && typeof o.glow === 'object') l.glow = o.glow as ClipGlow
  if (o.border && typeof o.border === 'object') l.border = o.border as ClipBorder
  if (o.rot3d && typeof o.rot3d === 'object') l.rot3d = o.rot3d as ClipRot3d
  return normalizeLook(l)
}

// ── 改动（面板一笔）──
/** look 里 mask／adj 是一笔改几个栏（mask=null＝拿掉蒙版）；anim＝换一格的款式（null＝那格拿掉） */
/** crop／bg 整个换（null＝拿掉） */
export type LookPatch = Omit<ClipLook, 'mask' | 'masks' | 'matte' | 'adj' | 'crop' | 'bg' | 'mblur' | 'hsl' | 'curves' | 'wheels' | 'lut' | 'key' | 'shadow' | 'pin' | 'glow' | 'border' | 'rot3d'> & {
  glow?: ClipGlow | null; border?: ClipBorder | null; rot3d?: ClipRot3d | null
  /** 四角透视：几个角并上去（开着才算）·null＝关掉 */
  pin?: Partial<ClipPin> | null; mask?: Partial<ClipMask> | null; adj?: ClipAdjust; crop?: ClipCrop | null; bg?: ClipBg | null
  /** 整份换（null＝拿掉） */
  hsl?: ClipHsl | null; curves?: ClipCurves | null; wheels?: ClipWheels | null; lut?: ClipLut | null; key?: ClipKey | null; shadow?: ClipShadow | null
  /** 运动模糊：整份换（null＝拿掉） */
  mblur?: ClipMotionBlur | null
  /** masks＝整串换（null＝全拿掉）·mask 改的是第一个；matte＝轨道遮罩整份换（null＝拿掉） */
  masks?: ClipMask[] | null; matte?: ClipMatte | null }
/** 关键帧：at＝播放头（时间轴秒·有 ⇒ 打过关键帧的数值改成在这一刻补一颗／改那颗·没打过的照旧改底值）；
 *  kfToggle＝菱形钮（这几项在 at 有关键帧 ⇒ 拿掉·没有 ⇒ 照当下的值放一颗）；kfEase＝改 at 那几颗往下一段的缓动；curve＝曲线变速（null＝改回常规） */
export type ClipPatch = { look?: LookPatch; volume?: number; fadeIn?: number; fadeOut?: number; speed?: number; pitch?: boolean; anim?: { slot: TextAnimSlot; anim: TextAnim | null }
  at?: number; kfToggle?: KfProp[]; kfEase?: { props: KfProp[]; ease: KfEase }; curve?: SpeedCurve | null
  /** 倒放开关（曲线变速先改回常规） */
  reverse?: boolean
  /** 声音处理（几项并上去·null＝那一项拿掉·整个 null＝全拿掉） */
  aud?: Partial<Record<keyof ClipAudio, unknown>> | null
  /** 追踪打码：整份打码轨换成这份（null／空＝拿掉） */
  mosaic?: Mosaic[] | null
  /** 运动跟踪：影片片段整份路径换成这份（null／空＝拿掉）；follow＝文字／贴纸绑到哪条路径（null＝解除） */
  mtrack?: MTrack[] | null; follow?: ClipFollow | null }
export const FADE_MAX = 10
export const VOL_MAX = 10

/** 这段（某几项·缺＝全部）关键帧落在时间轴的哪几秒（只算这段里面的·由小到大·对齐帧格） */
export function clipKfTimes(c: TlClip, props?: readonly KfProp[]): number[] {
  const out: number[] = []
  for (const s of kfTimes(c.kf, props)) {
    const t = snapFrame(timeOfSrc(c, s))
    if (t >= c.start - 1e-6 && t <= c.start + c.length + 1e-6 && !out.some((x) => Math.abs(x - t) < 1e-6)) out.push(t)
  }
  return out.sort((a, b) => a - b)
}
/** 时间轴第 t 秒这几项有没有关键帧（菱形实心） */
export const kfOnAt = (c: TlClip, t: number, props: readonly KfProp[]): boolean => { const s = kfSrc(c, t); return props.some((p) => kfIndexAt(c.kf?.[p], s) >= 0) }
/** 第 t 秒那几颗的缓动（没有 ⇒ null） */
export const kfEaseOn = (c: TlClip, t: number, props?: readonly KfProp[]): KfEase | null => kfEaseAt(c.kf, kfSrc(c, t), props ?? (Object.keys(c.kf ?? {}) as KfProp[]))
/** 第 t 秒有关键帧的是哪几项 */
export const kfPropsAt = (c: TlClip, t: number): KfProp[] => { const s = kfSrc(c, t); return (Object.keys(c.kf ?? {}) as KfProp[]).filter((p) => kfIndexAt(c.kf?.[p], s) >= 0) }
/** 面板那几颗菱形各管哪几项 */
export const KF_GROUP = {
  scale: ['sx', 'sy'], pos: ['x', 'y'], rot: ['rot'], opacity: ['opacity'], vol: ['vol'],
  mask: KF_MASK_KEYS.map((k) => `mask.${k}` as const),
  pin: KF_PIN_KEYS.map((k) => `pin.${k}` as const),
} as const satisfies Record<string, readonly KfProp[]>
export const adjKfProp = (k: AdjKey): KfProp => `adj.${k}`

/** 画面轨才有的关键帧项（其余＝音量） */
const isPictureProp = (p: KfProp) => p !== 'vol'
/** 这几项此刻看到的值（菱形钮放一颗用）：音量存 dB；没蒙版 ⇒ 蒙版那几项跳过 */
export function kfCurrent(c: TlClip, t: number, props: readonly KfProp[]): Partial<Record<KfProp, number>> {
  const l = lookOf(c, t)
  const out: Partial<Record<KfProp, number>> = {}
  for (const p of props) {
    if (p === 'vol') out.vol = volToDb(gainAt(c, t))
    else if (p.startsWith('mask.')) { const v = l.mask?.[p.slice(5) as (typeof KF_MASK_KEYS)[number]]; if (typeof v === 'number') out[p] = v }
    else if (p.startsWith('adj.')) out[p] = l.adj[p.slice(4) as AdjKey] ?? 0
    else if (p.startsWith('pin.')) { if (l.pin) out[p] = l.pin[p.slice(4) as PinKey] }
    else if (p === 'sx' || p === 'sy' || p === 'x' || p === 'y' || p === 'rot' || p === 'opacity') out[p] = p === 'sy' && l.uniform ? l.sx : l[p]
  }
  return out
}
/** 一笔改动里关键帧管得到的数值（音量换成 dB） */
function patchVals(p: ClipPatch): Partial<Record<KfProp, number>> {
  const v: Partial<Record<KfProp, number>> = {}
  const lk = p.look
  if (lk) {
    for (const k of ['sx', 'sy', 'x', 'y', 'rot', 'opacity'] as const) if (lk[k] !== undefined) v[k] = lk[k]
    if (lk.mask) for (const k of KF_MASK_KEYS) { const x = lk.mask[k]; if (typeof x === 'number') v[`mask.${k}`] = x }
    if (lk.adj) for (const k of KF_ADJ_KEYS) { const x = lk.adj[k]; if (x !== undefined) v[`adj.${k}`] = x }
    if (lk.pin) for (const k of KF_PIN_KEYS) { const x = lk.pin[k]; if (typeof x === 'number') v[`pin.${k}`] = x }
  }
  if (p.volume !== undefined) v.vol = volToDb(p.volume)
  return v
}
/** 改动拿掉已经变成关键帧的那几项（剩下的照旧改底值） */
function stripVals(p: ClipPatch, used: ReadonlySet<KfProp>): ClipPatch {
  if (!used.size) return p
  const o: ClipPatch = { ...p }
  if (p.look) {
    const lk: LookPatch = { ...p.look }
    for (const k of ['sx', 'sy', 'x', 'y', 'rot', 'opacity'] as const) if (used.has(k)) delete lk[k]
    if (lk.mask) { const m = { ...lk.mask }; for (const k of KF_MASK_KEYS) if (used.has(`mask.${k}`)) delete m[k]; lk.mask = m }
    if (lk.adj) { const a = { ...lk.adj }; for (const k of KF_ADJ_KEYS) if (used.has(`adj.${k}`)) delete a[k]; lk.adj = a }
    if (lk.pin) { const q = { ...lk.pin }; for (const k of KF_PIN_KEYS) if (used.has(`pin.${k}`)) delete q[k]; lk.pin = q }
    o.look = lk
  }
  if (used.has('vol')) delete o.volume
  return o
}

/** 一段套上改动（不碰时间轴长度·变速另走 setClipSpeed）：画面属性只套画面轨上的影片／图片；声音只套有声音的 */
export function applyClipPatch(c: TlClip, p0: ClipPatch, lane: Lane['kind']): TlClip {
  let n: TlClip = { ...c }
  let p = p0
  // 关键帧：先处理菱形钮／缓动·再把打过关键帧的数值改成在播放头补一颗
  if (p.at !== undefined && (p.kfToggle || p.kfEase || c.kf)) {
    const s = kfSrc(c, p.at)
    const inside = p.at >= c.start - 1e-6 && p.at <= c.start + c.length + 1e-6
    let kf: KfTracks | undefined = c.kf
    const ok = (q: KfProp) => (c.adjust ? q.startsWith('adj.') : lane === 'visual' || !isPictureProp(q) || q.startsWith('pin.')) // 四角透视文字／贴纸轨也有 // 调节层只有调整那几项
    if (p.kfToggle && inside) kf = kfToggle(kf, s, kfCurrent(c, p.at, p.kfToggle.filter(ok)))
    if (p.kfEase) kf = kfSetEase(kf, s, p.kfEase.props, p.kfEase.ease)
    if (kf && inside) {
      const vals = Object.fromEntries(Object.entries(patchVals(p)).filter(([k]) => ok(k as KfProp))) as Partial<Record<KfProp, number>>
      const r = kfApply(kf, s, vals)
      kf = r.kf
      p = stripVals(p, new Set((Object.keys(vals) as KfProp[]).filter((k) => !(k in r.rest))))
    }
    kf = normalizeKf(kf)
    if (kf) n.kf = kf; else delete n.kf
  }
  if (p.look && (lane === 'visual' || c.adjust)) {
    const cur = c.look ?? {}
    const { mask: pm, adj: pa, crop: pc, bg: pb, mblur: pmb, hsl: ph, curves: pcv, wheels: pw, lut: pl, key: pk, shadow: ps, pin: ppin, masks: pms, matte: pmt, glow: pgl, border: pbd, rot3d: pr3, ...rest } = p.look
    const pick = <T,>(v: T | null | undefined, c: T | undefined): T | undefined => (v === null ? undefined : v ?? c)
    const grade = { hsl: pick(ph, cur.hsl), curves: pick(pcv, cur.curves), wheels: pick(pw, cur.wheels), lut: pick(pl, cur.lut), key: pick(pk, cur.key), shadow: pick(ps, cur.shadow), glow: pick(pgl, cur.glow), border: pick(pbd, cur.border), rot3d: pick(pr3, cur.rot3d) }
    // 多蒙版：masks 给了 ⇒ 整串换；mask 改的是第一个（mask=null ⇒ 拿掉第一个·后面的递补）
    let list: ClipMask[] = pms === null ? [] : pms ? pms.map((x) => ({ ...maskDefault(x.shape), ...x })) : (cur.masks?.length ? cur.masks : cur.mask ? [cur.mask] : [])
    if (pm === null) list = list.slice(1)
    else if (pm) list = [{ ...(list[0] ?? maskDefault(pm.shape ?? 'rect')), ...pm } as ClipMask, ...list.slice(1)]
    const mask = list[0]
    const matte = pmt === null ? undefined : pmt ?? cur.matte
    const adj = pa ? { ...(cur.adj ?? {}), ...pa } : cur.adj
    const crop = pc === null ? undefined : pc ?? cur.crop
    const bg = pb === null ? undefined : pb ?? cur.bg
    const mblur = pmb === null ? undefined : pmb ?? cur.mblur
    const pin = ppin === null ? undefined : ppin ? { ...(cur.pin ?? PIN_ZERO), ...ppin } : cur.pin
    const look = normalizeLook({ ...cur, ...rest, ...(mask ? { mask } : { mask: undefined }), masks: list.length > 1 ? list : undefined, matte, ...(adj ? { adj } : {}), crop, bg, mblur, pin, ...grade })
    const { look: _old, ...base } = n
    void _old
    n = look ? { ...base, look } : base
  }
  if (p.look?.pin !== undefined && (lane === 'text' || lane === 'sticker')) { // 四角透视：文字／贴纸只收 pin
    const pin = p.look.pin === null ? undefined : parsePin({ ...(c.look?.pin ?? PIN_ZERO), ...p.look.pin })
    const { look: _o, ...base } = n
    void _o
    n = pin ? { ...base, look: { ...(c.look ?? {}), pin } } : (() => { const { pin: _p, ...rest } = c.look ?? {}; void _p; return Object.keys(rest).length ? { ...base, look: rest } : base })()
  }
  if (p.volume !== undefined) n.volume = clamp(p.volume, 0, VOL_MAX)
  const lim = Math.min(FADE_MAX, c.length)
  if (p.fadeIn !== undefined) { const v = Math.round(clamp(p.fadeIn, 0, lim) * 10) / 10; if (v > 0) n.fadeIn = v; else delete n.fadeIn }
  if (p.fadeOut !== undefined) { const v = Math.round(clamp(p.fadeOut, 0, lim) * 10) / 10; if (v > 0) n.fadeOut = v; else delete n.fadeOut }
  if (p.pitch !== undefined) { if (p.pitch) n.pitch = true; else delete n.pitch }
  if (p.mosaic !== undefined && lane === 'visual') { if (p.mosaic?.length) n.mosaic = p.mosaic; else delete n.mosaic }
  if (p.mtrack !== undefined && lane === 'visual') { if (p.mtrack?.length) n.mtrack = p.mtrack; else delete n.mtrack }
  if (p.follow !== undefined && (lane === 'text' || lane === 'sticker')) { if (p.follow) n.follow = p.follow; else delete n.follow }
  if (p.aud !== undefined && !c.adjust) { const a = mergeAudio(c.aud, p.aud); if (a) n.aud = a; else delete n.aud }
  if (p.anim && lane === 'visual') {
    const a: TextAnimSet = { ...(c.anim ?? {}) }
    if (p.anim.anim) a[p.anim.slot] = p.anim.anim
    else delete a[p.anim.slot]
    const ok = parseTextAnim(a)
    if (ok) n.anim = ok; else delete n.anim
  }
  return n
}

/** 变速（剪映「常规变速」）：时间轴长度跟着变（素材那一段不变）；变长 ⇒ 后面紧接着的片段一起往后推（照剪映·不盖到下一段）；淡入淡出夹进新长度 */
export function setClipSpeed(tr: Tracks, id: string, speed: number): Tracks {
  const f = findClip(tr, id)
  if (!f) return tr
  const c = f.clip
  const sp = Math.round(clamp(speed, SPEED_MIN, SPEED_MAX) * 100) / 100
  if (Math.abs(sp - speedOf(c)) < 1e-6 && !c.curve) return tr
  const len = Math.max(MIN_CLIP, snapFrame((c.length * speedOf(c)) / sp))
  const nc: TlClip = { ...c, length: len }
  delete nc.curve // 改常规倍数 ⇒ 曲线变速拿掉（剪映两种只能选一种）
  if (sp === 1) delete nc.speed; else nc.speed = sp
  return relength(tr, f.lane.id, c, nc)
}
/** 曲线变速（剪映「曲线变速」）：素材那段不变·时间轴长度＝素材秒数／曲线平均速度·speed 存平均速度；null ⇒ 改回常规（保持现在的长度＝平均速度） */
export function setClipCurve(tr: Tracks, id: string, curve: SpeedCurve | null): Tracks {
  const f = findClip(tr, id)
  if (!f) return tr
  const c = f.clip
  if (!curve) {
    if (!c.curve) return tr
    const nc: TlClip = { ...c }
    delete nc.curve
    const sp = Math.round(clamp(speedOf(c), SPEED_MIN, SPEED_MAX) * 100) / 100
    if (sp === 1) delete nc.speed; else nc.speed = sp
    return relength(tr, f.lane.id, c, { ...nc, length: Math.max(MIN_CLIP, snapFrame((c.length * speedOf(c)) / sp)) })
  }
  const cv = normCurve(curve)
  if (!cv) return tr
  const avg = curveAvg(cv)
  const len = Math.max(MIN_CLIP, snapFrame((c.length * speedOf(c)) / avg))
  return relength(tr, f.lane.id, c, { ...c, curve: cv, speed: r4(len > 0 ? (c.length * speedOf(c)) / len : avg), length: len })
}
/** 换了长度的片段放回去：变长 ⇒ 后面紧接着的片段一起往后推（不盖到下一段）；淡入淡出夹进新长度 */
function relength(tr: Tracks, laneId: string, c: TlClip, nc: TlClip): Tracks {
  const lane = tr.find((l) => l.id === laneId)!
  const len = nc.length
  const end0 = c.start + c.length, end1 = c.start + len
  const later = lane.clips.filter((x) => x.id !== c.id && x.start >= end0 - 1e-6).sort((a, b) => a.start - b.start)
  const next = later[0]
  const shift = !next ? 0 : Math.abs(next.start - end0) < 1e-6 ? end1 - end0 : Math.max(0, end1 - next.start)
  if (nc.fadeIn && nc.fadeIn > len) nc.fadeIn = Math.round(len * 10) / 10
  if (nc.fadeOut && nc.fadeOut > len) nc.fadeOut = Math.round(len * 10) / 10
  const moved = new Set(later.map((x) => x.id))
  return tr.map((l) => (l.id !== laneId ? l : { ...l, clips: l.clips.map((x) => (x.id === c.id ? nc : shift && moved.has(x.id) ? { ...x, start: snapFrame(x.start + shift) } : x)) }))
}

const setFlag = (tr: Tracks, id: string, k: 'reverse', on: boolean): Tracks => tr.map((l) => ({ ...l, clips: l.clips.map((c) => { if (c.id !== id || !!c[k] === on) return c; const n = { ...c }; if (on) n[k] = true; else delete n[k]; return n }) }))
/** 一批片段套一笔改动（多选＝一起改）；有变速 ⇒ 每段各自改长度 */
export function patchClips(tr: Tracks, ids: readonly string[], p: ClipPatch, canSpeed: (c: TlClip) => boolean): Tracks {
  const want = new Set(ids)
  let out = tr.map((l) => {
    let hit = false
    const clips = l.clips.map((c) => { if (!want.has(c.id) || (!c.mediaId && !c.adjust && !((p.look?.pin !== undefined || p.follow !== undefined) && (c.text || c.sticker)))) return c; hit = true; return applyClipPatch(c, p, l.kind) })
    return hit ? { ...l, clips } : l
  })
  if (p.speed !== undefined) for (const id of ids) { const f = findClip(out, id); if (f && canSpeed(f.clip)) out = setClipSpeed(out, id, p.speed) }
  if (p.curve !== undefined) for (const id of ids) { const f = findClip(out, id); if (f && canSpeed(f.clip)) { out = setClipCurve(out, id, p.curve); if (p.curve) out = setFlag(out, id, 'reverse', false) } }
  if (p.reverse !== undefined) for (const id of ids) {
    const f = findClip(out, id)
    if (!f || !canSpeed(f.clip) || f.clip.freeze || f.lane.locked) continue
    if (p.reverse && f.clip.curve) out = setClipCurve(out, id, null)
    out = setFlag(out, id, 'reverse', p.reverse)
  }
  return out
}

// ── 人工页要显示什么 ──
export type ClipMediaKind = 'video' | 'audio' | 'image' | 'adjust' // adjust＝调节层（只有「调整」页）
/** 选中的影音图片段：ids＝全部选中的素材片段；clip／lane／media＝面板照哪段显示（最后选的那段）；没有 ⇒ none */
export type ManualClipState = { kind: 'none' } | { kind: 'clip'; ids: string[]; clip: TlClip; lane: Lane['kind']; media: ClipMediaKind }
export function manualClipState(tr: Tracks, sel: readonly string[], kindOf: (mediaId: string) => ClipMediaKind | undefined): ManualClipState {
  const ids = sel.filter((id) => { const f = findClip(tr, id); return !!f && (!!f.clip.adjust || (!!f.clip.mediaId && !!kindOf(f.clip.mediaId))) && !f.lane.locked })
  if (!ids.length) return { kind: 'none' }
  const f = findClip(tr, ids[ids.length - 1])!
  return { kind: 'clip', ids, clip: f.clip, lane: f.lane.kind, media: f.clip.adjust ? 'adjust' : kindOf(f.clip.mediaId)! }
}
/** 人工页顶上的页签（照剪映排：画面／音频／变速／动画／跟踪／调整；图片没有音频、变速；音频只有音频、变速）·跟踪这次没做（页里写「还没做」） */
export type ClipTab = 'picture' | 'audio' | 'speed' | 'anim' | 'track' | 'adjust'
export function clipTabsFor(lane: Lane['kind'], media: ClipMediaKind): ClipTab[] {
  if (media === 'adjust') return ['adjust']
  if (media === 'audio' || lane === 'audio') return ['audio', 'speed']
  if (media === 'image') return ['picture', 'anim', 'track', 'adjust']
  return ['picture', 'audio', 'speed', 'anim', 'track', 'adjust']
}

/** 两笔改动并成一笔（后面的盖前面的；蒙版、调整各栏逐项并；蒙版 null＝拿掉） */
export function mergeClipPatch(a: ClipPatch, b: ClipPatch): ClipPatch {
  const out: ClipPatch = { ...a, ...b }
  if (a.look || b.look) {
    const la = a.look ?? {}, lb = b.look ?? {}
    const look: LookPatch = { ...la, ...lb }
    if (lb.mask === null) look.mask = null
    else if (la.mask || lb.mask) look.mask = la.mask === null ? (lb.mask ?? null) : { ...(la.mask ?? {}), ...(lb.mask ?? {}) }
    if (la.adj || lb.adj) look.adj = { ...(la.adj ?? {}), ...(lb.adj ?? {}) }
    out.look = look
  }
  if (a.aud !== undefined || b.aud !== undefined) out.aud = b.aud === null ? null : a.aud === null && b.aud === undefined ? null : { ...(a.aud ?? {}), ...(b.aud ?? {}) }
  return out
}
/** 面板的即时值与放手（同文字面板 textLiveStep 的规矩：拖的时候只即时看·放手才一次进复原栈·套到当时那几段） */
export type ClipLive = { ids: string[]; patch: ClipPatch }
export function clipLiveStep(prev: ClipLive | null, cur: readonly string[], p: ClipPatch, commit: boolean): { live: ClipLive | null; commit: ClipLive | null } {
  const same = !!prev && prev.ids.join(',') === cur.join(',')
  if (!commit) return cur.length ? { live: { ids: [...cur], patch: same ? mergeClipPatch(prev!.patch, p) : p }, commit: null } : { live: prev, commit: null }
  const ids = prev ? prev.ids : [...cur]
  return { live: null, commit: ids.length ? { ids, patch: prev ? mergeClipPatch(prev.patch, p) : p } : null }
}

/** 变速倍数滑杆（剪映那条刻度 0.1x｜1x｜2x｜5x｜10x｜100x）：照对数排（左半 0.1～1·右半 1～100）·位置 0～500 */
export const SPEED_TICKS = [0.1, 1, 2, 5, 10, 100] as const
export function speedToPos(s: number): number {
  const v = clamp(s, SPEED_MIN, SPEED_MAX)
  for (let i = 0; i < SPEED_TICKS.length - 1; i++) {
    const a = SPEED_TICKS[i], b = SPEED_TICKS[i + 1]
    if (v <= b + 1e-9) return Math.round((i + Math.log(v / a) / Math.log(b / a)) * 100)
  }
  return 500
}
export function posToSpeed(pos: number): number {
  const p = clamp(pos, 0, 500) / 100
  const i = Math.min(SPEED_TICKS.length - 2, Math.floor(p))
  const a = SPEED_TICKS[i], b = SPEED_TICKS[i + 1]
  const v = a * Math.pow(b / a, p - i)
  return Math.round(v * (v < 10 ? 100 : 10)) / (v < 10 ? 100 : 10)
}

// ── 音量（剪映用 dB 显示）──
export const DB_MIN = -40
export const DB_MAX = 20
/** 倍数 ⇒ dB（0 ⇒ 最小那档） */
export const volToDb = (v: number) => (v <= 0 ? DB_MIN : clamp(Math.round(20 * Math.log10(v) * 10) / 10, DB_MIN, DB_MAX))
/** dB ⇒ 倍数（最小那档＝静音） */
export const dbToVol = (db: number) => (db <= DB_MIN ? 0 : clamp(Math.pow(10, db / 20), 0, VOL_MAX))
/** 淡入淡出：时间轴 t 这一刻这段的音量还剩几成（0～1） */
export function fadeGain(c: Pick<TlClip, 'start' | 'length' | 'fadeIn' | 'fadeOut'>, t: number): number {
  const at = t - c.start
  let g = 1
  if (c.fadeIn && c.fadeIn > 0) g = Math.min(g, at / c.fadeIn)
  if (c.fadeOut && c.fadeOut > 0) g = Math.min(g, (c.length - at) / c.fadeOut)
  return clamp(g, 0, 1)
}

/** 片段上音量线的形状（照剪映·淡入淡出那段画成曲线）。
 *  回 [x, g]：x＝片段里第几成（0..1）·g＝那一点的音量倍数（片段音量×淡入淡出）；没淡入淡出 ⇒ 只两点（一条直线）。
 *  页面再用 gainToFrac（按分贝）换成高度 ⇒ 线性淡出画出来自然是一条往下弯的曲线（同剪映）。 */
export function volumeEnvelope(c: Pick<TlClip, 'length' | 'fadeIn' | 'fadeOut'>, gain: number, steps = 24): Array<[number, number]> {
  const L = c.length
  if (!(L > 0)) return []
  const fi = Math.min(L, Math.max(0, c.fadeIn ?? 0)), fo = Math.min(L, Math.max(0, c.fadeOut ?? 0))
  const xs = new Set<number>([0, 1])
  for (let i = 0; i <= steps; i++) { if (fi > 0) xs.add((fi * i) / steps / L); if (fo > 0) xs.add((L - fo + (fo * i) / steps) / L) }
  const f = { start: 0, length: L, fadeIn: fi, fadeOut: fo }
  return [...xs].filter((x) => x >= 0 && x <= 1).sort((p, q) => p - q).map((x) => [r4(x), r4(gain * fadeGain(f, x * L))])
}

// ── 动画（画面·款式同文字动画库·打字类只对字有用 ⇒ 拿掉）──
export const VISUAL_ANIM_LIB: Record<TextAnimSlot, readonly AnimDef[]> = {
  in: ANIM_LIB.in.filter((d) => !d.id.includes('type') && !d.perChar),
  out: ANIM_LIB.out.filter((d) => !d.id.includes('type') && !d.perChar),
  loop: ANIM_LIB.loop,
}
export { ANIM_DUR, ANIM_SLOTS }
/** 时间轴 t 这一刻这段的动画姿势 */
export const clipAnimPose = (c: Pick<TlClip, 'anim' | 'start' | 'length'>, t: number): AnimPose =>
  c.anim ? textAnimPose(c.anim, Math.max(0, t - c.start), c.length, Math.max(0, t - c.start)) : POSE_IDLE

// ── 预览画法（字串·页面直接塞进 style）──
/** 姿势的位移单位：字是 em·画面改成画面宽的 1/3、高的 1/2（滑入 3 格＝整个画面宽） */
const POSE_TX = 100 / 3
const POSE_TY = 50
/** 这一层的变形数值（汇出：画布照同一份数值画）：tx／ty＝位移（占这一层宽／高的百分比·往下为正）·rot＝度·sx／sy＝缩放·opacity */
export function lookXform(l: LookFull, pose: AnimPose = POSE_IDLE): { tx: number; ty: number; rot: number; sx: number; sy: number; opacity: number } {
  return { tx: l.x * 100 + pose.tx * POSE_TX, ty: -l.y * 100 + pose.ty * POSE_TY, rot: l.rot + pose.rot, sx: l.sx * pose.sx * (l.flipH ? -1 : 1), sy: (l.uniform ? l.sx : l.sy) * pose.sy * (l.flipV ? -1 : 1), opacity: clamp(l.opacity * pose.alpha, 0, 1) }
}
/** 这一层的 transform／opacity／混合模式（位置 y 往上为正·同剪映） */
export function lookStyle(l: LookFull, pose: AnimPose = POSE_IDLE): { transform: string; opacity: number; mixBlendMode: BlendMode } {
  const parts: string[] = []
  const { tx, ty, rot, sx, sy, opacity } = lookXform(l, pose)
  if (Math.abs(tx) > 1e-4 || Math.abs(ty) > 1e-4) parts.push(`translate(${r4(tx)}%, ${r4(ty)}%)`)
  if (Math.abs(rot) > 1e-4) parts.push(`rotate(${r4(rot)}deg)`)
  if (Math.abs(sx - 1) > 1e-5 || Math.abs(sy - 1) > 1e-5) parts.push(`scale(${r4(sx)}, ${r4(sy)})`)
  return { transform: parts.join(' ') || 'none', opacity: r4(opacity), mixBlendMode: l.blend }
}
/** 对齐（剪映那排 6 颗：靠左／水平置中／靠右／靠上／垂直置中／靠下）：照缩放后的大小贴到画面边 */
export type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export const ALIGN_DIRS: readonly AlignDir[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']
export function alignPatch(l: LookFull, d: AlignDir): LookPatch {
  const sx = l.sx, sy = l.uniform ? l.sx : l.sy
  if (d === 'left') return { x: r4(-(1 - sx) / 2) }
  if (d === 'right') return { x: r4((1 - sx) / 2) }
  if (d === 'hcenter') return { x: 0 }
  if (d === 'top') return { y: r4((1 - sy) / 2) }
  if (d === 'bottom') return { y: r4(-(1 - sy) / 2) }
  return { y: 0 }
}

/** 调整的明暗曲线（17 点·0～1）：亮度、对比度、高光、阴影、白色、黑色、光感、褪色都并在这一条 */
export function toneTable(a: ClipAdjust, n = 17): number[] {
  const g = (k: AdjKey) => (a[k] ?? 0) / 100
  const B = g('bright'), C = g('contrast') + g('clarity') * 0.15, H = g('highlight'), S = g('shadow'), W = g('white'), K = g('black'), L = g('light'), F = g('fade')
  return Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1)
    let y = L >= 0 ? 1 - Math.pow(1 - x, 1 + L * 1.2) : Math.pow(x, 1 - L * 1.2)
    y += B * 0.18
    y = (y - 0.5) * (1 + C * 0.7) + 0.5
    y += H * 0.22 * Math.pow(Math.max(0, (x - 0.5) / 0.5), 2)
    y += S * 0.22 * Math.pow(Math.max(0, 1 - x / 0.5), 2)
    y += W * 0.15 * x ** 3
    y += K * 0.15 * (1 - x) ** 3
    y = y * (1 - 0.3 * F) + 0.2 * F
    return Math.round(clamp(y, 0, 1) * 10000) / 10000
  })
}
/** 素材在这一层里实际占的那块（画面置中·照比例放得下·占这一层宽高的几成）：暗角、蒙版都对着这块画（剪映的暗角、蒙版跟着片段的画面走） */
export type Frame = { x: number; y: number; w: number; h: number }
export const FULL_FRAME: Frame = { x: 0, y: 0, w: 1, h: 1 }
export function frameIn(stageAspect: number, mediaAspect: number | null | undefined): Frame {
  if (!(stageAspect > 0) || !mediaAspect || !(mediaAspect > 0) || !Number.isFinite(mediaAspect)) return FULL_FRAME
  const w = Math.min(1, mediaAspect / stageAspect), h = Math.min(1, stageAspect / mediaAspect)
  return { x: r4((1 - w) / 2), y: r4((1 - h) / 2), w: r4(w), h: r4(h) }
}
/** 预览里素材元素（img／video）的大小：照比例撑满这一层（小图、小片也放大·同汇出 containRect）——
 *  只靠 max-w-full／max-h-full 只缩不放 ⇒ 640×360 的图在 696 宽的舞台只有原尺寸、缩 0.6 后比成片小约 8%。
 *  按 cq 单位算（舞台是 size 容器）·元素框＝画面那块 ⇒ 暗角／蒙版读的 offset 框照旧对。比例未知 ⇒ null（照旧）。药：DILIN_NEG 含 vedit_pv_fit_off ⇒ null */
export function fitLayerCss(mediaAspect: number | null | undefined): { width: string; height: string } | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  if (typeof window === 'undefined' && env.split(',').includes('vedit_pv_fit_off')) return null
  if (!mediaAspect || !(mediaAspect > 0) || !Number.isFinite(mediaAspect)) return null
  return { width: `min(100cqw, ${r4(mediaAspect)} * 100cqh)`, height: 'auto' }
}
export const adjActive = (a: ClipAdjust | undefined): boolean => !!a && ADJ_KEYS.some((k) => (a[k] ?? 0) !== 0)
/** 颗粒用的杂讯图（灰阶·feImage 拉满这一层） */
const NOISE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="960" height="540" filter="url(#n)"/></svg>'
const svgData = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`
/** SVG 滤镜的内容（<filter primitiveUnits="objectBoundingBox" x=0 y=0 width=1 height=1> 里面那几行·sRGB 算）：
 *  色温色调（矩阵）→ 饱和度＋自然饱和度 → 明暗曲线 → 锐化／清晰（卷积）→ 暗角（中间亮四周暗的图·正片叠底；负＝四周变亮·滤色）→ 颗粒（杂讯图·叠加·按强度混）；
 *  暗角、颗粒最后只留这一层自己有画面的地方（in SourceAlpha）——不会盖到底下的轨道与画面外的空白。没调 ⇒ '' */
export function adjustFilterBody(a: ClipAdjust | undefined, fr: Frame = FULL_FRAME): string {
  if (!adjActive(a)) return ''
  const g = (k: AdjKey) => (a![k] ?? 0) / 100
  const out: string[] = []
  let cur = 'SourceGraphic', n = 0
  const step = (el: string, attrs: string, inner = '') => { const r = `s${n++}`; out.push(`<${el} in="${cur}" ${attrs} result="${r}"${inner ? `>${inner}</${el}>` : '/>'}`); cur = r }
  const T = g('temp'), Ti = g('tint')
  if (T || Ti) {
    const r = 1 + T * 0.15 + Ti * 0.04, gg = 1 - Ti * 0.12, b = 1 - T * 0.15 + Ti * 0.04
    step('feColorMatrix', `type="matrix" values="${r4(r)} 0 0 0 0 0 ${r4(gg)} 0 0 0 0 0 ${r4(b)} 0 0 0 0 0 1 0"`)
  }
  const sat = (1 + g('sat')) * (1 + g('vib') * 0.5)
  if (Math.abs(sat - 1) > 1e-4) step('feColorMatrix', `type="saturate" values="${r4(Math.max(0, sat))}"`)
  const tone = toneTable(a!)
  if (tone.some((y, i) => Math.abs(y - i / (tone.length - 1)) > 1e-4)) {
    const tv = tone.join(' ')
    step('feComponentTransfer', '', `<feFuncR type="table" tableValues="${tv}"/><feFuncG type="table" tableValues="${tv}"/><feFuncB type="table" tableValues="${tv}"/>`)
  }
  const k = g('sharpen') * 0.8 + g('clarity') * 0.35
  if (k > 1e-3) step('feConvolveMatrix', `order="3" preserveAlpha="true" kernelMatrix="0 ${r4(-k)} 0 ${r4(-k)} ${r4(1 + 4 * k)} ${r4(-k)} 0 ${r4(-k)} 0"`)
  const v = g('vignette'), gr = g('grain')
  if (v || gr) {
    if (v) {
      const edge = v > 0 ? Math.round(255 * (1 - 0.85 * v)) : Math.round(255 * 0.85 * -v)
      const mid = v > 0 ? 255 : 0, stop = Math.round(62 - 22 * Math.abs(v))
      const img = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none"><radialGradient id="g" cx="50%" cy="50%" r="71%"><stop offset="${stop}%" stop-color="rgb(${mid},${mid},${mid})"/><stop offset="100%" stop-color="rgb(${edge},${edge},${edge})"/></radialGradient><rect width="100" height="100" fill="url(#g)"/></svg>`
      out.push(`<feFlood flood-color="rgb(${mid},${mid},${mid})" result="vbg"/>`)
      out.push(`<feImage href="${svgData(img)}" x="${fr.x}" y="${fr.y}" width="${fr.w}" height="${fr.h}" preserveAspectRatio="none" result="vimg"/>`)
      out.push(`<feComposite in="vimg" in2="vbg" operator="over" result="vig"/>`)
      out.push(`<feBlend in="${cur}" in2="vig" mode="${v > 0 ? 'multiply' : 'screen'}" result="vb"/>`)
      cur = 'vb'
    }
    if (gr) {
      out.push(`<feImage href="${svgData(NOISE_SVG)}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="noise"/>`)
      out.push(`<feBlend in="${cur}" in2="noise" mode="overlay" result="gb"/>`)
      const al = r4(gr * 0.45)
      out.push(`<feComposite in="gb" in2="${cur}" operator="arithmetic" k1="0" k2="${al}" k3="${r4(1 - al)}" k4="0" result="gm"/>`)
      cur = 'gm'
    }
    out.push(`<feComposite in="${cur}" in2="SourceAlpha" operator="in" result="fin"/>`)
  }
  return out.join('')
}

/** 钢笔路径（闭合）：sharp＝直线连；否则 Catmull-Rom 换成三次贝塞尔（过每个点的平滑曲线）；map＝单位方框 ⇒ 画面坐标 */
export function penPath(pts: ReadonlyArray<[number, number]>, sharp: boolean, map: (x: number, y: number) => [number, number]): string {
  const P = pts.map((p) => map(p[0], p[1]))
  const f = (q: [number, number]) => `${r4(q[0])} ${r4(q[1])}`
  if (P.length < 3) return ''
  if (sharp) return `M${P.map(f).join(' L')} Z`
  const n = P.length
  let d = `M${f(P[0])}`
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n]
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1)} ${f(c2)} ${f(p2)}`
  }
  return `${d} Z`
}
/** 盖在这条画面轨上的调节层：由近到远（先套贴着它的那层）·每层的调色照 t 那一刻（关键帧） */
export function adjustLayersOver(layers: readonly LayerState[], laneId: string, t: number): Grade[] {
  const i = layers.findIndex((s) => s.lane.id === laneId)
  if (i < 0 || layers[i].lane.kind !== 'visual') return []
  const out: Grade[] = []
  for (let j = i - 1; j >= 0; j--) {
    const s = layers[j]
    const c = s.hit?.clip
    if (s.lane.kind !== 'filter' || !s.show || !c?.adjust) continue
    const g = adjustLayerGrade(lookOf(c, t))
    if (gradeActive(g)) out.push(g)
  }
  return out
}
/** 这段的调色（片段自己的·给烤表用） */
export const lookGrade = (l: Pick<LookFull, 'hsl' | 'curves' | 'wheels' | 'lut' | 'key'>): Grade => {
  const g: Grade = {}
  if (l.hsl) g.hsl = l.hsl; if (l.curves) g.curves = l.curves; if (l.wheels) g.wheels = l.wheels; if (l.lut) g.lut = l.lut; if (l.key) g.key = l.key
  return g
}
/** 调节层的调色（再加「调整」里逐点那几项·抠像不算） */
export const adjustLayerGrade = (l: LookFull): Grade => { const g = lookGrade({ ...l, key: null }); if (Object.keys(l.adj).length) g.adj = l.adj; return g }

/** 蒙版画成一张 SVG 图（CSS mask-image 用·白＝看得到）：aspect＝画面宽高比（圆不被压扁）；羽化＝高斯模糊；反转＝挖掉 */
export function maskSvg(m: ClipMask, aspect: number, fr: Frame = FULL_FRAME): string { return masksSvg([m], 'and', aspect, fr) }
/** 一个蒙版的 <mask>（id＝m/f 加编号）：白＝看得到 */
function maskDef(m: ClipMask, W: number, H: number, fr: Frame, id: string): string {
  // 中心、大小都对着素材那块（fr）算：x／w 是素材宽的几成·y／h 是素材高的几成
  const FW = fr.w * W, FH = fr.h * H
  const cx = fr.x * W + FW / 2 + m.x * FW, cy = fr.y * H + FH / 2 - m.y * FH
  const w = m.w * FW, h = m.h * FH
  const big = 4 * Math.max(W, H)
  let shape: string
  if (m.shape === 'linear') shape = `<rect x="${cx - big}" y="${cy}" width="${2 * big}" height="${big}"/>`
  else if (m.shape === 'mirror') shape = `<rect x="${cx - big}" y="${cy - h / 2}" width="${2 * big}" height="${h}"/>`
  else if (m.shape === 'circle') shape = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}"/>`
  else if (m.shape === 'rect') { const rr = (Math.min(w, h) / 2) * (m.radius / 100); shape = `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${r4(rr)}"/>` }
  else if (m.shape === 'stripes') shape = stripesShape(m, cx, cy, w, h) // 条纹百叶（每条照进度展开·mask-matte.pure）
  else if (m.shape === 'star') {
    const pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.4 : 1; return `${r4(cx + Math.cos(a) * r * w / 2)},${r4(cy + Math.sin(a) * r * h / 2)}` })
    shape = `<polygon points="${pts.join(' ')}"/>`
  } else if (m.shape === 'pen') {
    shape = `<path d="${penPath(m.pts ?? PEN_DEFAULT, !!m.sharp, (x, y) => [cx + x * w, cy + y * h])}"/>`
  } else {
    // 爱心（单位方框 -1..1 画好再放大）
    const P = (x: number, y: number) => `${r4(cx + x * w / 2)} ${r4(cy + y * h / 2)}`
    shape = `<path d="M${P(0, 1)} C${P(-0.2, 0.75)} ${P(-1, 0.2)} ${P(-1, -0.35)} C${P(-1, -0.85)} ${P(-0.35, -1.05)} ${P(0, -0.55)} C${P(0.35, -1.05)} ${P(1, -0.85)} ${P(1, -0.35)} C${P(1, 0.2)} ${P(0.2, 0.75)} ${P(0, 1)} Z"/>`
  }
  const blur = (m.feather / 100) * Math.min(FW, FH) * 0.12
  const inner = m.invert ? 'black' : 'white', outer = m.invert ? 'white' : 'black'
  const f = `f${id.slice(1)}`
  return `${blur > 0.01 ? `<filter id="${f}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${r4(blur)}"/></filter>` : ''}` +
    `<mask id="${id}"><rect width="${W}" height="${H}" fill="${outer}"/><g fill="${inner}"${blur > 0.01 ? ` filter="url(#${f})"` : ''}${m.rot ? ` transform="rotate(${r4(m.rot)} ${r4(cx)} ${r4(cy)})"` : ''}>${shape}</g></mask>`
}
/** 多蒙版合成成一张 SVG（预览 CSS mask-image 与汇出 destination-in 都用这张）：and＝层层套 mask（交集）；or＝每个各画一块白再叠（并集） */
export function masksSvg(ms: readonly ClipMask[], op: MaskOp, aspect: number, fr: Frame = FULL_FRAME): string {
  const H = 1000, W = Math.round(H * (aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9))
  const list = maskMatteNegOff() ? ms.slice(0, 1) : ms
  const ids = list.map((_, i) => (i ? `m${i}` : 'm'))
  const defs = list.map((m, i) => maskDef(m, W, H, fr, ids[i])).join('')
  const body = op === 'or' && list.length > 1
    ? ids.map((id) => `<rect width="${W}" height="${H}" fill="white" mask="url(#${id})"/>`).join('')
    : ids.slice(1).reduceRight((acc, id) => `<g mask="url(#${id})">${acc}</g>`, `<rect width="${W}" height="${H}" fill="white" mask="url(#m)"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`
}
export const masksUrl = (ms: readonly ClipMask[], op: MaskOp, aspect: number, fr: Frame = FULL_FRAME) => `url("data:image/svg+xml;utf8,${encodeURIComponent(masksSvg(ms, op, aspect, fr))}")`
export const maskUrl = (m: ClipMask, aspect: number, fr: Frame = FULL_FRAME) => `url("data:image/svg+xml;utf8,${encodeURIComponent(maskSvg(m, aspect, fr))}")`
