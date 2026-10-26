// 网页剪辑页·空物件／父子连结／真 3D（摄影机、灯光）：
//   · 空物件（null）＝画面轨上不显示的控制器片段（rig {kind:'null'}·有 look 的位置大小旋转不透明度、关键帧、动画）；
//   · 父子连结：画面／文字／贴纸／空物件片段可设 parent＝另一段的 id——父层这一刻的位移、缩放、旋转（含关键帧、表达式、片段动画）沿父链级联到子层；
//     parentAlpha＝连不透明度也跟着乘；绕成圈的连结读档时拿掉（fixParents）、命令拒；
//   · 3D：片段开 d3（z、x／y／z 旋转）⇒ 这一层当成 3D 空间里的一张平面，经摄影机（rig {kind:'camera'}·位置、目标点、视角、景深）透视投影到画面；
//     灯光（rig {kind:'light'}·平行／点／聚光／环境·强度颜色）照简化 Lambert（平面法向 · 光线方向·整层一个亮度）乘在 3D 层上；
//     相邻的一串 3D 层照离摄影机远近排先后（远的先画）·2D 层把串切开（同 AE）。没摄影机 ⇒ 缺省摄影机（z＝0 那面刚好 1:1）。
// 座标（u 空间·以画面高为 1）：x 0..A（A＝画面宽／高）往右·y 0..1 往下·z 往画面里为正；
//   工程档里摄影机／灯光的 x／y／z 是「以画面正中为原点、y 往上」（同 look.x／y 的方向）、单位画面高。
// 画法：每层先照原本的 2D 画法画成整画面一张（flat）·再整层套一个 3×3（正规化座标 0..1 → 0..1）：
//   2D 子层＝父链的仿射；3D 层＝flat → 世界 → 摄影机 → 投影的 homography。预览 ⇒ CSS matrix3d（rigCssMatrix）；汇出／抽帧 ⇒ 仿射走画布 transform、投影走 warpPixels——同一个矩阵。
// 本档只放纯函数（题直接跑）·⛔ 碰 DOM。
import { srcAt, type Lane, type TlClip, type Tracks } from './timeline.pure'
import { clipAnimPose, gainAt, lookOf, lookXform, volToDb } from './clip-look.pure'
import { filterStrengthAt, textBodyAt } from './text-kf.pure'
import { stickerPose } from './sticker.pure'
import { resolveTextLook } from './text-style.pure'
import { textAnimPose } from './text-anim.pure'
import { type Mat3 } from './corner-pin.pure'
import { KF_ADJ_KEYS, KF_MASK_KEYS, KF_PIN_KEYS, normalizeKf, parseKf, type KfProp, type KfTracks } from './keyframe.pure'
import { kfExpr, parseExprs, setExprScene, setPropReader, type ClipExpr, type ExprClip } from './expr.pure'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r4 = (v: number) => Math.round(v * 10000) / 10000
const HEX_RE = /^#[0-9a-f]{6}$/i
const negOn = (k: string) => typeof window === 'undefined' && ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? '').split(',').includes(k)
/** 药（只在 node 测试跑）：vedit_parent_off ⇒ 父链不级联；vedit_parent_cycle_off ⇒ 读档不拿掉绕圈的连结；vedit_3d_off ⇒ 3D 当 2D；vedit_light_off ⇒ 不打光；vedit_3d_sort_off ⇒ 3D 层不排远近 */
export const parentNegOff = () => negOn('vedit_parent_off')
const cycleNegOff = () => negOn('vedit_parent_cycle_off')
export const d3NegOff = () => negOn('vedit_3d_off')
const lightNegOff = () => negOn('vedit_light_off')
const sortNegOff = () => negOn('vedit_3d_sort_off')
/** 药：vedit_rig_parse_off ⇒ 读档不收 d3／parent／expr（往返题红） */
const rigParseNegOff = () => negOn('vedit_rig_parse_off')

// ── 资料 ──
export const LIGHT_KINDS = ['parallel', 'point', 'spot', 'ambient'] as const
export type LightKind = (typeof LIGHT_KINDS)[number]
export type RigNull = { kind: 'null' }
/** 摄影机：位置 x／y／z、目标点 tx／ty／tz（画面正中为原点·y 往上·单位画面高）·fov＝垂直视角（度）·focus／aperture＝景深（对焦距离·光圈 0..100·0／缺＝不模糊） */
export type RigCamera = { kind: 'camera'; x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number; focus?: number; aperture?: number }
/** 灯光：light＝种类·color·intensity（1＝100%）·x／y／z＝位置·tx／ty／tz＝照向哪（平行光、聚光）·cone＝聚光锥角（度）·feather＝边缘柔和（0..100） */
export type RigLight = { kind: 'light'; light: LightKind; color: string; intensity: number; x: number; y: number; z: number; tx: number; ty: number; tz: number; cone: number; feather: number }
export type RigBody = RigNull | RigCamera | RigLight
/** 片段开 3D：有这栏＝3D 层（缺的栏＝0）·z＝离画面多远（正＝往里）·rx／ry／rz＝绕 x／y／z 轴转（度） */
export type Clip3d = { z?: number; rx?: number; ry?: number; rz?: number }
export type { ClipExpr }

export const POS3_LIM = 100
export const ROT3_LIM = 3600
export const FOV_MIN = 5
export const FOV_MAX = 150
export const FOV_DEFAULT = 40
export const INTENSITY_MAX = 10
export const CONE_MIN = 1
export const CONE_MAX = 170
export const RIG_DEFAULT_SECONDS = 5
/** 空物件在预览里画的那个框（半边长·画面高） */
export const NULL_BOX = 0.075
const NEAR = 0.01
/** 视角 ⇒ 焦距（画面高为 1）：缺省摄影机放在 z＝−焦距 ⇒ z＝0 那面 1:1 */
export const camDist = (fov: number) => 0.5 / Math.tan(((clamp(fov, FOV_MIN, FOV_MAX) / 2) * Math.PI) / 180)
export const KF_D3_KEYS = ['z', 'rx', 'ry', 'rz'] as const
export const KF_CAM_KEYS = ['x', 'y', 'z', 'tx', 'ty', 'tz', 'fov'] as const
export const KF_LT_KEYS = ['int', 'x', 'y', 'z'] as const
export const D3_PROPS: readonly KfProp[] = KF_D3_KEYS.map((k) => `d3.${k}` as KfProp)
export const CAM_PROPS: readonly KfProp[] = KF_CAM_KEYS.map((k) => `cam.${k}` as KfProp)
export const LT_PROPS: readonly KfProp[] = KF_LT_KEYS.map((k) => `lt.${k}` as KfProp)
/** 空物件身上能打关键帧／挂表达式的那几项（同形状片段） */
export const NULL_PROPS: readonly KfProp[] = ['sx', 'sy', 'x', 'y', 'rot', 'opacity']
export const isRigKf = (p: string) => p.startsWith('d3.') || p.startsWith('cam.') || p.startsWith('lt.')

export const CAMERA_DEFAULT: RigCamera = { kind: 'camera', x: 0, y: 0, z: -r4(camDist(FOV_DEFAULT)), tx: 0, ty: 0, tz: 0, fov: FOV_DEFAULT }
export const LIGHT_DEFAULT: Omit<RigLight, 'light'> = { kind: 'light', color: '#ffffff', intensity: 1, x: -0.6, y: 0.6, z: -1, tx: 0, ty: 0, tz: 0, cone: 60, feather: 50 }

export const isRigClip = (c: Pick<TlClip, 'rig'>): boolean => !!c.rig
/** 能当子层（能设 parent、能开 3D 的是画面（含合成段）／文字／贴纸／空物件；摄影机／灯光能设 parent·不能开 3D） */
export function canChild(c: TlClip, lane: Lane['kind']): boolean {
  if (lane === 'text') return !!c.text
  if (lane === 'sticker') return !!c.sticker
  return lane === 'visual' && !c.adjust && (!!c.mediaId || !!c.comp || !!c.shape || !!c.solid || !!c.bgfx || !!c.rig) // 合成段（巢状合成）同影片段
}
/** 能当父层：子层那几种去掉摄影机、灯光 */
export const canParent = (c: TlClip, lane: Lane['kind']): boolean => canChild(c, lane) && c.rig?.kind !== 'camera' && c.rig?.kind !== 'light'
export const can3d = (c: TlClip, lane: Lane['kind']): boolean => canParent(c, lane)

// ── 读档 ──
const pos = (v: unknown, d: number) => r4(clamp(num(v) ?? d, -POS3_LIM, POS3_LIM))
export function parseRig(v: unknown): RigBody | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.kind === 'null') return { kind: 'null' }
  if (o.kind === 'camera') {
    const d = CAMERA_DEFAULT
    const cam: RigCamera = { kind: 'camera', x: pos(o.x, d.x), y: pos(o.y, d.y), z: pos(o.z, d.z), tx: pos(o.tx, d.tx), ty: pos(o.ty, d.ty), tz: pos(o.tz, d.tz), fov: r4(clamp(num(o.fov) ?? FOV_DEFAULT, FOV_MIN, FOV_MAX)) }
    const ap = num(o.aperture)
    if (ap !== null && ap > 0) { cam.aperture = r4(clamp(ap, 0, 100)); cam.focus = r4(clamp(num(o.focus) ?? Math.abs(cam.z), 0.01, POS3_LIM)) }
    return cam
  }
  if (o.kind === 'light') {
    if (!(LIGHT_KINDS as readonly unknown[]).includes(o.light)) return null
    const d = LIGHT_DEFAULT
    return { kind: 'light', light: o.light as LightKind, color: typeof o.color === 'string' && HEX_RE.test(o.color) ? o.color.toLowerCase() : d.color, intensity: r4(clamp(num(o.intensity) ?? d.intensity, 0, INTENSITY_MAX)),
      x: pos(o.x, d.x), y: pos(o.y, d.y), z: pos(o.z, d.z), tx: pos(o.tx, d.tx), ty: pos(o.ty, d.ty), tz: pos(o.tz, d.tz), cone: r4(clamp(num(o.cone) ?? d.cone, CONE_MIN, CONE_MAX)), feather: r4(clamp(num(o.feather) ?? d.feather, 0, 100)) }
  }
  return null
}
/** 3D 栏：不是物件 ⇒ undefined；是 ⇒ 开 3D（0 的栏不存） */
export function parseD3(v: unknown): Clip3d | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const out: Clip3d = {}
  const z = num(o.z); if (z) out.z = r4(clamp(z, -POS3_LIM, POS3_LIM))
  for (const k of ['rx', 'ry', 'rz'] as const) { const a = num(o[k]); if (a) out[k] = r4(clamp(a, -ROT3_LIM, ROT3_LIM)) }
  return out
}
/** 摄影机／灯光片段的关键帧只收自己那几项 */
export const rigKfOk = (r: RigBody) => (p: KfProp): boolean => (r.kind === 'camera' ? p.startsWith('cam.') : r.kind === 'light' ? p.startsWith('lt.') : NULL_PROPS.includes(p))
/** 读档：一段身上的 d3／parent／parentAlpha／expr（kfOk＝这段原本能打的关键帧项·表达式同那几项＋3D 项）；坏的表达式回 bad */
export function parseRigFields(c: Record<string, unknown>, clip: TlClip, lane: Lane['kind'], kfOk: (p: KfProp) => boolean): { badExpr: string[] } {
  if (rigParseNegOff()) return { badExpr: [] }
  if (can3d(clip, lane) && c.d3 !== undefined) {
    const d3 = parseD3(c.d3)
    if (d3) {
      clip.d3 = d3
      const k3 = parseKf(c.kf)
      const add: KfTracks = {}
      for (const p of D3_PROPS) if (k3?.[p]) add[p] = k3[p]
      const kf = normalizeKf({ ...(clip.kf ?? {}), ...add })
      if (kf) clip.kf = kf
    }
  }
  if (canChild(clip, lane) && typeof c.parent === 'string' && c.parent && c.parent !== clip.id) { clip.parent = c.parent; if (c.parentAlpha === true) clip.parentAlpha = true }
  const ok = (p: KfProp) => kfOk(p) || (!!clip.d3 && D3_PROPS.includes(p))
  const r = parseExprs(c.expr, ok)
  if (r.expr) clip.expr = r.expr
  return { badExpr: r.bad }
}
/** 读档最后一道：parent 指不到／指到不能当父层的 ⇒ 拿掉（bad）；绕成圈 ⇒ 拿掉形成圈那段的连结（loop） */
export function fixParents(tracks: Tracks): Array<{ id: string; old: string; loop: boolean }> {
  const out: Array<{ id: string; old: string; loop: boolean }> = []
  const by = new Map<string, { clip: TlClip; lane: Lane['kind'] }>()
  for (const l of tracks) for (const c of l.clips) by.set(c.id, { clip: c, lane: l.kind })
  for (const { clip, lane } of by.values()) {
    if (!clip.parent) { delete clip.parentAlpha; continue }
    const p = by.get(clip.parent)
    if (!p || !canParent(p.clip, p.lane) || !canChild(clip, lane)) { out.push({ id: clip.id, old: clip.parent, loop: false }); delete clip.parent; delete clip.parentAlpha }
  }
  if (cycleNegOff()) return out
  for (const { clip } of by.values()) {
    let cur = clip.parent, n = 0
    while (cur && n++ < 256) {
      if (cur === clip.id) { out.push({ id: clip.id, old: clip.parent!, loop: true }); delete clip.parent; delete clip.parentAlpha; break }
      cur = by.get(cur)?.clip.parent
    }
  }
  return out
}
/** 设了 parent 会不会绕圈（命令先问这个） */
export function parentLoops(tracks: Tracks, id: string, parent: string): boolean {
  const by = new Map<string, TlClip>()
  for (const l of tracks) for (const c of l.clips) by.set(c.id, c)
  let cur: string | undefined = parent, n = 0
  while (cur && n++ < 256) { if (cur === id) return true; cur = by.get(cur)?.parent }
  return false
}

// ── 这一刻的数值（关键帧＋表达式） ──
const at = (c: TlClip, t: number) => srcAt(c, t)
export function d3At(c: TlClip, t: number): Required<Clip3d> {
  const b = c.d3 ?? {}, s = at(c, t)
  return { z: kfExpr(c, 'd3.z', t, s, b.z ?? 0), rx: kfExpr(c, 'd3.rx', t, s, b.rx ?? 0), ry: kfExpr(c, 'd3.ry', t, s, b.ry ?? 0), rz: kfExpr(c, 'd3.rz', t, s, b.rz ?? 0) }
}
export function cameraAt(c: TlClip, t: number): RigCamera {
  const b = c.rig?.kind === 'camera' ? c.rig : CAMERA_DEFAULT, s = at(c, t)
  const v = (k: (typeof KF_CAM_KEYS)[number]) => kfExpr(c, `cam.${k}` as KfProp, t, s, b[k])
  return { ...b, x: v('x'), y: v('y'), z: v('z'), tx: v('tx'), ty: v('ty'), tz: v('tz'), fov: clamp(v('fov'), FOV_MIN, FOV_MAX) }
}
export function lightAt(c: TlClip, t: number): RigLight | null {
  if (c.rig?.kind !== 'light') return null
  const b = c.rig, s = at(c, t)
  return { ...b, intensity: clamp(kfExpr(c, 'lt.int', t, s, b.intensity), 0, INTENSITY_MAX), x: kfExpr(c, 'lt.x', t, s, b.x), y: kfExpr(c, 'lt.y', t, s, b.y), z: kfExpr(c, 'lt.z', t, s, b.z) }
}
/** 一段一项这一刻的值（表达式 clip('id').prop 读的就是这个·底值＋关键帧＋它自己的表达式） */
export function propValue(c: TlClip, p: KfProp, t: number): number {
  if (p === 'sx' || p === 'sy' || p === 'x' || p === 'y' || p === 'rot' || p === 'opacity') return lookOf(c, t)[p]
  if (p.startsWith('mask.')) return (lookOf(c, t).mask as Record<string, unknown> | null)?.[p.slice(5)] as number ?? 0
  if (p.startsWith('adj.')) return (lookOf(c, t).adj as Record<string, number>)[p.slice(4)] ?? 0
  if (p.startsWith('pin.')) return (lookOf(c, t).pin as Record<string, number> | null)?.[p.slice(4)] ?? 0
  if (p === 'tx' || p === 'ty' || p === 'ts' || p === 'trot' || p === 'top') {
    const b = textBodyAt(c, t)
    if (!b) return 0
    return p === 'tx' ? b.x : p === 'ty' ? b.y : p === 'ts' ? b.scale ?? 1 : p === 'trot' ? b.rotate ?? 0 : b.opacity ?? 1
  }
  if (p === 'flt') return filterStrengthAt(c, t)
  if (p === 'vol') return volToDb(gainAt(c, t))
  if (p.startsWith('d3.')) return d3At(c, t)[p.slice(3) as keyof Clip3d]
  if (p.startsWith('cam.')) { const v = cameraAt(c, t); return v[p.slice(4) as (typeof KF_CAM_KEYS)[number]] }
  if (p.startsWith('lt.')) { const v = lightAt(c, t); if (!v) return 0; const k = p.slice(3); return k === 'int' ? v.intensity : v[k as 'x' | 'y' | 'z'] }
  return 0
}
setPropReader((c: ExprClip, p: KfProp, t: number) => propValue(c as TlClip, p, t))

// ── 矩阵（4×4 列优先排列成 16 格·row-major：m[r*4+c]） ──
export type Mat4 = number[]
const I4 = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]; o[r * 4 + c] = s }
  return o
}
const T4 = (x: number, y: number, z: number): Mat4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]
const S4 = (x: number, y: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const rad = (d: number) => (d * Math.PI) / 180
/** 绕 z 顺时针（y 往下的画面上看·同 CSS rotate） */
const Rz4 = (d: number): Mat4 => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
/** 绕 y：正＝右边往里退（同 rot3d） */
const Ry4 = (d: number): Mat4 => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }
/** 绕 x：正＝下边往里退（同 rot3d） */
const Rx4 = (d: number): Mat4 => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1] }
export const apply4 = (m: Mat4, p: readonly [number, number, number]): [number, number, number] => {
  const [x, y, z] = p
  return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]]
}
const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2])
const norm = (a: readonly number[]): [number, number, number] => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
/** 3×3 反矩阵（row-major）；奇异 ⇒ null */
function inv3(m: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

// ── 每段这一刻的 2D 姿势（u 空间）：a＝静止时的锚点·p＝现在的锚点·rot／sx／sy＝绕锚点的旋转缩放·alpha＝不透明度 ──
export type Pose = { au: number; av: number; pu: number; pv: number; rot: number; sx: number; sy: number; alpha: number }
export function poseOf(c: TlClip, t: number, A: number): Pose {
  if (c.text) {
    const tb = textBodyAt(c, t) ?? c.text
    const local = srcAt(c, t)
    const pz = textAnimPose(tb.anim, local - c.offset, c.length, local)
    const em = resolveTextLook(tb).fontScale
    const sc = tb.scale ?? 1
    return { au: A * c.text.x, av: c.text.y, pu: A * tb.x + pz.tx * em, pv: tb.y + pz.ty * em, rot: (tb.rotate ?? 0) + pz.rot, sx: sc * pz.sx, sy: sc * pz.sy, alpha: clamp((tb.opacity ?? 1) * pz.alpha, 0, 1) }
  }
  if (c.sticker) {
    const b = c.sticker, sp = stickerPose(b, clipAnimPose(c, t))
    return { au: A * b.x, av: b.y, pu: A * b.x + sp.dx, pv: b.y + sp.dy, rot: sp.rot, sx: sp.sx, sy: sp.sy, alpha: sp.alpha }
  }
  const xf = lookXform(lookOf(c, t), clipAnimPose(c, t))
  return { au: A / 2, av: 0.5, pu: A * (0.5 + xf.tx / 100), pv: 0.5 + xf.ty / 100, rot: xf.rot, sx: xf.sx, sy: xf.sy, alpha: xf.opacity }
}
/** 这段自己的变换（u 空间 4×4）：T(p,z)·Rz(rot)·[Rx·Ry·Rz(3D)]·S·T(−a) */
function local4(ps: Pose, d: Required<Clip3d> | null): Mat4 {
  let m = mul4(T4(ps.pu, ps.pv, d?.z ?? 0), Rz4(ps.rot))
  if (d) m = mul4(m, mul4(Rx4(d.rx), mul4(Ry4(d.ry), Rz4(d.rz))))
  return mul4(mul4(m, S4(ps.sx, ps.sy)), T4(-ps.au, -ps.av, 0))
}

// ── 一帧的场景 ──
/** rig＝这段这一刻怎么套：m＝整层要再套的 3×3（正规化座标·null＝不必套）·is3d＝透视投影（汇出走逐像素）·hidden＝在摄影机后面不画·
 *  depth＝离摄影机多远（3D 才有·排先后）·shade＝灯光乘数 [r,g,b]（null＝不打光）·blur＝景深模糊（画面高的几成）·alpha＝父链带来的不透明度 */
export type RigOut = { m: Mat3 | null; is3d: boolean; hidden: boolean; depth: number | null; shade: [number, number, number] | null; blur: number; alpha: number }
export const RIG_NONE: RigOut = Object.freeze({ m: null, is3d: false, hidden: false, depth: null, shade: null, blur: 0, alpha: 1 }) as RigOut
export type RigView = { eye: [number, number, number]; f: number; V: Mat4; aperture: number; focus: number }
export type RigScene = {
  of(c: TlClip): RigOut
  /** 几层照 3D 远近排（由下往上·远的先画）：info 回 'skip'＝这层不画东西（不切开 3D 串）·null／2D 片段＝切开 */
  order<T>(items: readonly T[], info: (x: T) => TlClip | 'skip' | null): T[]
  /** 空物件的框（预览画·正规化座标四角）；在摄影机后面 ⇒ null */
  nullQuad(c: TlClip): Array<[number, number]> | null
  /** 灯光在画面上的位置（预览画小点）；在摄影机后面 ⇒ null */
  lightDot(c: TlClip): [number, number] | null
  view: RigView
  active: boolean
}
const isOn = (c: TlClip, t: number) => !c.disabled && t >= c.start - 1e-6 && t < c.start + c.length - 1e-6
/** 场景里有没有用到父子／3D（都没有 ⇒ 每段都 RIG_NONE·免得白算） */
const usesRig = (tr: Tracks) => tr.some((l) => l.clips.some((c) => !!c.parent || !!c.d3 || !!c.rig))

export function rigScene(tracks: Tracks, t: number, aspect: number): RigScene {
  setExprScene(tracks)
  const A = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9
  const by = new Map<string, { clip: TlClip; lane: Lane }>()
  for (const l of tracks) for (const c of l.clips) by.set(c.id, { clip: c, lane: l })
  const active = usesRig(tracks)
  const poses = new Map<string, Pose>()
  const poseC = (c: TlClip) => { let p = poses.get(c.id); if (!p) { p = poseOf(c, t, A); poses.set(c.id, p) } return p }
  const is3d = (c: TlClip) => !!c.d3 && !d3NegOff() && !!by.get(c.id) && can3d(c, by.get(c.id)!.lane.kind)
  const parentOf = (c: TlClip): TlClip | null => {
    if (!c.parent || parentNegOff()) return null
    const p = by.get(c.parent)
    return p && canParent(p.clip, p.lane.kind) ? p.clip : null
  }
  // 父链（防圈：走过的再遇到就停）
  const w2 = new Map<string, Mat4>(), w4 = new Map<string, Mat4>(), al = new Map<string, number>()
  const chain2 = (c: TlClip, seen: Set<string>): Mat4 => { // P2：父链（只用 2D 部分）
    const p = parentOf(c)
    if (!p || seen.has(p.id)) return I4()
    let m = w2.get(p.id)
    if (!m) { seen.add(p.id); m = mul4(chain2(p, seen), local4(poseC(p), null)); w2.set(p.id, m) }
    return m
  }
  const chain4 = (c: TlClip, seen: Set<string>): Mat4 => { // P4：父链（父层开 3D 的连 3D 一起）
    const p = parentOf(c)
    if (!p || seen.has(p.id)) return I4()
    let m = w4.get(p.id)
    if (!m) { seen.add(p.id); m = mul4(chain4(p, seen), local4(poseC(p), is3d(p) ? d3At(p, t) : null)); w4.set(p.id, m) }
    return m
  }
  const alpha = (c: TlClip, seen: Set<string>): number => {
    const p = parentOf(c)
    if (!p || !c.parentAlpha || seen.has(p.id)) return 1
    let a = al.get(p.id)
    if (a === undefined) { seen.add(p.id); a = poseC(p).alpha * alpha(p, seen); al.set(p.id, a) }
    return a
  }
  // 摄影机：最上面那条轨这一刻开着的那段；没有 ⇒ 缺省（z＝0 那面 1:1）
  const toU = (x: number, y: number, z: number): [number, number, number] => [A / 2 + x, 0.5 - y, z]
  let cam: { eye: [number, number, number]; tgt: [number, number, number]; fov: number; aperture: number; focus: number } | null = null
  const lights: Array<{ L: RigLight; pos: [number, number, number]; tgt: [number, number, number] }> = []
  if (active) for (const l of tracks) {
    if (l.hidden || l.kind !== 'visual') continue
    for (const c of l.clips) {
      if (!c.rig || !isOn(c, t)) continue
      if (c.rig.kind === 'camera' && !cam) {
        const v = cameraAt(c, t), P = chain4(c, new Set([c.id]))
        cam = { eye: apply4(P, toU(v.x, v.y, v.z)), tgt: apply4(P, toU(v.tx, v.ty, v.tz)), fov: v.fov, aperture: v.aperture ?? 0, focus: v.focus ?? Math.abs(v.z) }
      } else if (c.rig.kind === 'light') {
        const v = lightAt(c, t)!, P = chain4(c, new Set([c.id]))
        lights.push({ L: v, pos: apply4(P, toU(v.x, v.y, v.z)), tgt: apply4(P, toU(v.tx, v.ty, v.tz)) })
      }
    }
  }
  const fov = cam?.fov ?? FOV_DEFAULT
  const f = camDist(fov)
  const eye = cam?.eye ?? [A / 2, 0.5, -f] as [number, number, number]
  const tgt = cam?.tgt ?? [A / 2, 0.5, 0] as [number, number, number]
  const fw = norm(sub(tgt, eye))
  let rt = cross(fw, [0, -1, 0])
  if (len(rt) < 1e-9) rt = cross(fw, [0, 0, 1])
  rt = norm(rt)
  const dn = cross(fw, rt)
  const V: Mat4 = [rt[0], rt[1], rt[2], -dot(rt, eye), dn[0], dn[1], dn[2], -dot(dn, eye), fw[0], fw[1], fw[2], -dot(fw, eye), 0, 0, 0, 1]
  const view: RigView = { eye, f, V, aperture: cam?.aperture ?? 0, focus: cam?.focus ?? f }
  /** u 空间一点 ⇒ 画面（正规化）；在摄影机后面 ⇒ null */
  const project = (p: readonly [number, number, number]): [number, number] | null => {
    const v = apply4(V, p)
    if (v[2] <= NEAR) return null
    return [0.5 + (f * v[0]) / v[2] / A, 0.5 + (f * v[1]) / v[2]]
  }
  const shadeOf = (F: Mat4, C: readonly number[]): [number, number, number] | null => {
    if (!lights.length || lightNegOff()) return null
    const Li = inv3([F[0], F[1], F[2], F[4], F[5], F[6], F[8], F[9], F[10]])
    if (!Li) return null
    let n = norm([Li[6], Li[7], Li[8]])
    if (dot(n, sub(eye, C)) < 0) n = [-n[0], -n[1], -n[2]]
    const out: [number, number, number] = [0, 0, 0]
    for (const { L, pos: lp, tgt: lt } of lights) {
      let k = 1
      if (L.light === 'parallel') k = Math.max(0, dot(n, norm(sub(lp, lt))))
      else if (L.light === 'point' || L.light === 'spot') {
        k = Math.max(0, dot(n, norm(sub(lp, C))))
        if (L.light === 'spot') {
          const a = (Math.acos(clamp(dot(norm(sub(C, lp)), norm(sub(lt, lp))), -1, 1)) * 180) / Math.PI
          const half = L.cone / 2, inner = half * (1 - L.feather / 100)
          k *= a <= inner ? 1 : a >= half ? 0 : (half - a) / Math.max(1e-6, half - inner)
        }
      }
      const rgb = [1, 3, 5].map((i) => parseInt(L.color.slice(i, i + 2), 16) / 255)
      for (let i = 0; i < 3; i++) out[i] += L.intensity * rgb[i] * k
    }
    return [r4(out[0]), r4(out[1]), r4(out[2])]
  }
  const cache = new Map<string, RigOut>()
  const of = (c: TlClip): RigOut => {
    if (!active) return RIG_NONE
    const hit = cache.get(c.id)
    if (hit) return hit
    let out: RigOut = RIG_NONE
    const lane = by.get(c.id)?.lane.kind
    if (lane && canChild(c, lane) && !c.rig) {
      const a = alpha(c, new Set([c.id]))
      if (is3d(c)) {
        const ps = poseC(c), d = d3At(c, t)
        // flat（照 2D 画好的整层）⇒ 世界：P4·T(p,z)·Rz·R3·Rz⁻¹·T(−p)（2D 的缩放在 flat 里已经有了）
        const F = mul4(mul4(chain4(c, new Set([c.id])), mul4(T4(ps.pu, ps.pv, d.z), mul4(Rz4(ps.rot), mul4(mul4(Rx4(d.rx), mul4(Ry4(d.ry), Rz4(d.rz))), Rz4(-ps.rot))))), T4(-ps.pu, -ps.pv, 0))
        const Q = mul4(V, F)
        const G = [Q[0], Q[1], Q[3], Q[4], Q[5], Q[7], Q[8], Q[9], Q[11]]
        // 投影：x′＝½＋f·vx／vz／A·y′＝½＋f·vy／vz ⇒ K·G·diag(A,1,1)
        const K = [f / A, 0, 0.5, 0, f, 0.5, 0, 0, 1]
        const KG = [0, 1, 2].flatMap((r) => [0, 1, 2].map((cc) => K[r * 3] * G[cc] + K[r * 3 + 1] * G[3 + cc] + K[r * 3 + 2] * G[6 + cc]))
        const H: Mat3 = [KG[0] * A, KG[1], KG[2], KG[3] * A, KG[4], KG[5], KG[6] * A, KG[7], KG[8]]
        const C = apply4(F, [ps.pu, ps.pv, 0])
        const depth = apply4(V, C)[2]
        const blur = view.aperture > 0 ? (view.aperture / 100) * 0.02 * Math.abs(depth - view.focus) / Math.max(depth, 0.1) : 0
        out = { m: H, is3d: true, hidden: depth <= NEAR, depth: r4(depth), shade: shadeOf(F, C), blur: r4(blur), alpha: a }
      } else {
        const P = chain2(c, new Set([c.id]))
        const ident = P.every((v, i) => Math.abs(v - I4()[i]) < 1e-12)
        // u 空间仿射 ⇒ 正规化：D⁻¹·P·D（D＝diag(A,1)）
        const m: Mat3 | null = ident ? null : [P[0], P[1] / A, P[3] / A, P[4] * A, P[5], P[7], 0, 0, 1]
        out = m || a < 1 ? { ...RIG_NONE, m, alpha: a } : RIG_NONE
      }
    }
    cache.set(c.id, out)
    return out
  }
  const order = <T,>(items: readonly T[], info: (x: T) => TlClip | 'skip' | null): T[] => {
    if (!active || sortNegOff()) return [...items]
    const out: T[] = []
    let run: Array<{ x: T; d: number; i: number }> = []
    const flush = () => { run.sort((a, b) => b.d - a.d || a.i - b.i); out.push(...run.map((r) => r.x)); run = [] }
    items.forEach((x, i) => {
      const c = info(x)
      if (c === 'skip') { out.push(x); return } // 不画东西的层：位置无所谓·不切开
      const r = c ? of(c) : null
      if (r?.is3d) { run.push({ x, d: r.depth ?? 0, i }); return }
      flush(); out.push(x)
    })
    flush()
    return out
  }
  const nullQuad = (c: TlClip): Array<[number, number]> | null => {
    if (c.rig?.kind !== 'null') return null
    const ps = poseC(c), h = NULL_BOX
    const corners: Array<[number, number, number]> = [[ps.au - h, ps.av - h, 0], [ps.au + h, ps.av - h, 0], [ps.au + h, ps.av + h, 0], [ps.au - h, ps.av + h, 0]]
    if (is3d(c)) {
      const W = mul4(chain4(c, new Set([c.id])), local4(ps, d3At(c, t)))
      const q = corners.map((p) => project(apply4(W, p)))
      return q.every(Boolean) ? (q as Array<[number, number]>) : null
    }
    const W = mul4(chain2(c, new Set([c.id])), local4(ps, null))
    return corners.map((p) => { const w = apply4(W, p); return [w[0] / A, w[1]] as [number, number] })
  }
  const lightDot = (c: TlClip): [number, number] | null => {
    const v = c.rig?.kind === 'light' ? lightAt(c, t) : null
    if (!v || v.light === 'ambient') return null
    return project(apply4(chain4(c, new Set([c.id])), toU(v.x, v.y, v.z)))
  }
  return { of, order, nullQuad, lightDot, view, active }
}

// ── 画（预览／汇出共用的小工具） ──
/** 预览：3×3（正规化）⇒ CSS matrix3d（元素 w×h px·transform-origin 在正中＝CSS 缺省）·同 pinCssMatrix 但只除以 |h33|（不翻正负·摄影机后面那半照样被裁掉） */
export function rigCssMatrix(H: Mat3, w: number, h: number): string {
  const S = (m: Mat3, sx: number, sy: number): Mat3 => [m[0], (m[1] * sx) / sy, m[2] * sx, (m[3] * sy) / sx, m[4], m[5] * sy, m[6] / sx, m[7] / sy, m[8]]
  const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c])) as Mat3
  const cx = w / 2, cy = h / 2
  const M = mul(mul([1, 0, -cx, 0, 1, -cy, 0, 0, 1], S(H, w, h)), [1, 0, cx, 0, 1, cy, 0, 0, 1])
  const n = Math.abs(M[8]) > 1e-12 ? Math.abs(M[8]) : 1
  const m = M.map((v) => v / n)
  const v = [m[0], m[3], 0, m[6], m[1], m[4], 0, m[7], 0, 0, 1, 0, m[2], m[5], 0, m[8]]
  return `matrix3d(${v.map((x) => +x.toFixed(9)).join(',')})`
}
/** 汇出：2D 仿射（正规化）⇒ 画布 transform(a,b,c,d,e,f)（W×H px） */
export function rigCanvasAffine(m: Mat3, W: number, H: number): [number, number, number, number, number, number] {
  return [m[0], (m[3] * H) / W, (m[1] * W) / H, m[4], m[2] * W, m[5] * H]
}
/** 灯光乘到像素上（RGBA·透明度不动·夹 0..255） */
export function shadePixels(d: Uint8ClampedArray, s: readonly [number, number, number]): void {
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * s[0]; d[i + 1] = d[i + 1] * s[1]; d[i + 2] = d[i + 2] * s[2] }
}
/** 预览：灯光乘数 ⇒ SVG feColorMatrix 的 values */
export const shadeMatrixValues = (s: readonly [number, number, number]) => `${s[0]} 0 0 0 0 0 ${s[1]} 0 0 0 0 0 ${s[2]} 0 0 0 0 0 1 0`

// ── 改（命令与面板共用） ──
/** 这段能挂表达式的项（＝能打关键帧的那几项·读档 parseProject 留得住的） */
export function exprPropsFor(c: TlClip, lane: Lane['kind']): KfProp[] {
  const d3 = c.d3 ? [...D3_PROPS] : []
  const pin = c.look?.pin ? KF_PIN_KEYS.map((k) => `pin.${k}` as KfProp) : []
  if (c.rig) return c.rig.kind === 'null' ? [...NULL_PROPS, ...d3] : c.rig.kind === 'camera' ? [...CAM_PROPS] : [...LT_PROPS]
  if (lane === 'text') return c.text ? ['tx', 'ty', 'ts', 'trot', 'top', ...pin, ...d3] : []
  if (lane === 'sticker') return c.sticker ? [...pin, ...d3] : []
  if (lane === 'filter') return c.adjust ? KF_ADJ_KEYS.map((k) => `adj.${k}` as KfProp) : c.filter ? ['flt'] : []
  if (lane === 'audio') return c.mediaId ? ['vol'] : []
  if (lane !== 'visual') return []
  if (c.shape || c.solid || c.bgfx) return [...NULL_PROPS, ...d3]
  if ((!c.mediaId && !c.comp) || c.adjust) return [] // 合成段同影片段
  return ['sx', 'sy', 'x', 'y', 'rot', 'opacity', ...(c.look?.mask ? KF_MASK_KEYS.map((k) => `mask.${k}` as KfProp) : []), ...KF_ADJ_KEYS.map((k) => `adj.${k}` as KfProp), ...pin, 'vol', ...d3]
}
/** 一笔改动：parent（null＝拿掉）·parentAlpha·d3（null＝关 3D·连 3D 关键帧、表达式一起拿掉）·expr（src null＝拿掉那项）·rig（摄影机／灯光的栏·种类不变） */
export type RigPatch = { parent?: string | null; parentAlpha?: boolean; d3?: Clip3d | null; expr?: { prop: KfProp; src: string | null }; rig?: Partial<Omit<RigCamera, 'kind'>> | Partial<Omit<RigLight, 'kind'>> }
export function patchRigClip(tr: Tracks, id: string, p: RigPatch): Tracks {
  return tr.map((l) => (l.locked || !l.clips.some((c) => c.id === id) ? l : { ...l, clips: l.clips.map((c) => {
    if (c.id !== id) return c
    const n: TlClip = { ...c }
    if (p.parent === null) { delete n.parent; delete n.parentAlpha } else if (typeof p.parent === 'string') n.parent = p.parent
    if (p.parentAlpha !== undefined) { if (p.parentAlpha && n.parent) n.parentAlpha = true; else delete n.parentAlpha }
    if (p.d3 === null) {
      delete n.d3
      if (n.kf) { const kf = { ...n.kf }; for (const k of D3_PROPS) delete kf[k]; const k2 = normalizeKf(kf); if (k2) n.kf = k2; else delete n.kf }
      if (n.expr) { const ex = { ...n.expr }; for (const k of D3_PROPS) delete ex[k]; if (Object.keys(ex).length) n.expr = ex; else delete n.expr }
    } else if (p.d3) n.d3 = parseD3({ ...(c.d3 ?? {}), ...p.d3 }) ?? {}
    if (p.expr) { const ex: ClipExpr = { ...(n.expr ?? {}) }; if (p.expr.src === null || !p.expr.src.trim()) delete ex[p.expr.prop]; else ex[p.expr.prop] = p.expr.src; if (Object.keys(ex).length) n.expr = ex; else delete n.expr }
    if (p.rig && c.rig && c.rig.kind !== 'null') n.rig = parseRig({ ...c.rig, ...p.rig, kind: c.rig.kind }) ?? c.rig
    return n
  }) }))
}

// ── 新片段 ──
export const newNullClip = (id: string): TlClip => ({ id, mediaId: '', start: 0, length: RIG_DEFAULT_SECONDS, offset: 0, rig: { kind: 'null' } })
export const newCameraClip = (id: string, p: Partial<Omit<RigCamera, 'kind'>> = {}): TlClip => ({ id, mediaId: '', start: 0, length: RIG_DEFAULT_SECONDS, offset: 0, rig: parseRig({ ...CAMERA_DEFAULT, ...p })! })
export const newLightClip = (id: string, light: LightKind, p: Partial<Omit<RigLight, 'kind' | 'light'>> = {}): TlClip => ({ id, mediaId: '', start: 0, length: RIG_DEFAULT_SECONDS, offset: 0, rig: parseRig({ ...LIGHT_DEFAULT, ...p, light })! })
