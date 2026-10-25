// 网页剪辑页·形状片段与纯色片段（放画面轨·mediaId 空）：
//   形状＝矩形框／圆框／箭头／直线（描边颜色、宽度、填充可无、圆角）＋入场「描边生长」（按进度从起点画到终点）；
//   纯色＝整个画面一块颜色（黑／白／自选），当底用不用先找图。
// 位置／大小／旋转／不透明度走画面片段那套 look＋关键帧（lookOf 带 t·x／y／sx／sy／rot／opacity），入场／出场动画走 clip.anim（clipAnimPose）。
// 预览（ui/VectorCanvas.tsx）与汇出（ui/export-render.ts）都只叫这里的 drawVectorClip ⇒ 同一份计算（路径、描边生长长度、变形、不透明度）。
// 本档只放纯函数（题直接跑）：⛔ 碰 DOM（画布只认下面这个最小介面）。
import { applyDrop, mainIndex, MAIN_LANE, newLane, planDrop, snapFrame, type TlClip, type Tracks } from './timeline.pure'
import { clipAnimPose, lookOf, lookXform } from './clip-look.pure'
import { BGFX_DEFAULT_SECONDS, bgfxDefault, drawBgfx, parseBgfx, type BgfxBody, type BgfxKind } from './bgfx.pure' // 动态背景（星空粒子／光斑漂移）

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const HEX_RE = /^#[0-9a-f]{6}$/i

/** 药：DILIN_NEG 含 vedit_shape_solid_off ⇒ 形状／纯色读档丢掉、描边生长恒画满、片头转场不生效（只在 node 测试跑） */
export function shapeSolidNeg(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_shape_solid_off')
}

export const SHAPE_KINDS = ['rect', 'ellipse', 'arrow', 'line'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]
/** 形状片段的内容：shape＝哪一种；stroke＝描边颜色（#rrggbb）；width＝描边宽（画面高的比例）；fill＝填充色（缺＝不填）；
 *  radius＝圆角（矩形才用·短边的比例 0～0.5）；w／h＝外框大小（画面宽／高的比例·置中·位置大小旋转再由 look 套）；
 *  grow＝入场描边生长秒数（缺／0＝不生长·一出来就画满） */
export type ShapeBody = { shape: ShapeKind; stroke: string; width: number; fill?: string; radius: number; w: number; h: number; grow?: number }
/** 纯色片段的内容：color＝#rrggbb（整个画面） */
export type SolidBody = { color: string }

export const SHAPE_DEFAULT_SECONDS = 3
export const SOLID_DEFAULT_SECONDS = 5
export const SHAPE_WIDTH_MIN = 0.002
export const SHAPE_WIDTH_MAX = 0.1
export const SHAPE_GROW_MAX = 10
export const SOLID_PRESETS = ['#000000', '#ffffff'] as const
/** 素材区拖一张形状／纯色卡 ⇒ 值＝"shape:<种类>" 或 "solid:#rrggbb" */
export const VECTOR_DRAG_MIME = 'application/x-dilin-vedit-vector'

export function shapeDefault(shape: ShapeKind): ShapeBody {
  const line = shape === 'arrow' || shape === 'line'
  return { shape, stroke: '#ff3b30', width: 0.012, radius: 0, w: line ? 0.4 : shape === 'ellipse' ? 0.3 : 0.4, h: line ? 0.2 : shape === 'ellipse' ? 0.3 * (16 / 9) : 0.4 }
}
export const isVectorClip = (c: Pick<TlClip, 'shape' | 'solid' | 'bgfx'>): boolean => !!c.shape || !!c.solid || !!c.bgfx

// ── 读档验值（坏的回 null·好的夹进范围）──
export function parseShape(v: unknown): ShapeBody | null {
  if (shapeSolidNeg() || !isObj(v) || !SHAPE_KINDS.includes(v.shape as ShapeKind)) return null
  const d = shapeDefault(v.shape as ShapeKind)
  const out: ShapeBody = {
    shape: v.shape as ShapeKind,
    stroke: typeof v.stroke === 'string' && HEX_RE.test(v.stroke) ? v.stroke.toLowerCase() : d.stroke,
    width: clamp(num(v.width) ?? d.width, SHAPE_WIDTH_MIN, SHAPE_WIDTH_MAX),
    radius: clamp(num(v.radius) ?? 0, 0, 0.5),
    w: clamp(num(v.w) ?? d.w, 0.01, 4), h: clamp(num(v.h) ?? d.h, 0.01, 4),
  }
  if (typeof v.fill === 'string' && HEX_RE.test(v.fill)) out.fill = v.fill.toLowerCase()
  const g = num(v.grow)
  if (g !== null && g > 0) out.grow = Math.round(clamp(g, 0.1, SHAPE_GROW_MAX) * 100) / 100
  return out
}
export function parseSolid(v: unknown): SolidBody | null {
  if (shapeSolidNeg() || !isObj(v) || typeof v.color !== 'string' || !HEX_RE.test(v.color)) return null
  return { color: v.color.toLowerCase() }
}

// ── 片段 ──
export function newShapeClip(id: string, shape: ShapeKind): TlClip {
  return { id, mediaId: '', start: 0, length: SHAPE_DEFAULT_SECONDS, offset: 0, shape: shapeDefault(shape) }
}
export function newSolidClip(id: string, color: string): TlClip {
  return { id, mediaId: '', start: 0, length: SOLID_DEFAULT_SECONDS, offset: 0, solid: { color: HEX_RE.test(color) ? color.toLowerCase() : '#000000' } }
}
/** 动态背景片段（seed＝伪随机种子·同种子同画面） */
export function newBgfxClip(id: string, kind: BgfxKind, seed: number): TlClip {
  return { id, mediaId: '', start: 0, length: BGFX_DEFAULT_SECONDS, offset: 0, bgfx: bgfxDefault(kind, seed) }
}
/** 改动态背景参数（锁了的轨不动·验值同读档） */
export function patchBgfx(tr: Tracks, id: string, p: Partial<BgfxBody>): Tracks {
  const q: Partial<BgfxBody> = { ...p }
  for (const k of ['color', 'bg'] as const) if (q[k] !== undefined && !HEX_RE.test(String(q[k]))) delete q[k] // 坏颜色 ⇒ 留原色
  return tr.map((l) => (l.locked ? l : { ...l, clips: l.clips.map((c) => (c.id === id && c.bgfx ? { ...c, bgfx: parseBgfx({ ...c.bgfx, ...q }) ?? c.bgfx } : c)) }))
}
/** 点一张形状／纯色卡 ⇒ 放在播放头（画面轨照落点规划：主轨空着就进主轨·不然往上找／新增一条画面轨） */
export function addVectorAt(tr: Tracks, clip: TlClip, at: number, laneId: () => string): Tracks {
  return applyDrop(tr, planDrop(tr, 'visual', null, snapFrame(Math.max(0, at)), clip.length), clip, laneId())
}
/** 背景类（纯色、动态背景）：点一下／命令不指定轨 ⇒ 放最底。
 *  上区的轨不能放到主轨下面（pinMain）⇒ 最底＝主轨：主轨那段空着就直接进；被占着 ⇒ 那段跟背景时间重叠的主轨片段原样（不改起点）
 *  挪进主轨正上方一条新轨，背景进主轨。主轨锁了 ⇒ 照一般画面片段规则。回挪了几段（给命令回报用）。药：DILIN_NEG 含 vedit_bg_bottom_off ⇒ 照一般规则 */
export function isBackgroundClip(c: TlClip): boolean { return !!(c.bgfx || c.solid) }
export function addBackgroundAt(tr: Tracks, clip: TlClip, at: number, laneId: () => string): { tracks: Tracks; moved: number } {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  const start = snapFrame(Math.max(0, at)), end = start + clip.length
  const mi = mainIndex(tr), main = tr[mi]
  if (!main || main.id !== MAIN_LANE || main.locked || (typeof window === 'undefined' && env.split(',').includes('vedit_bg_bottom_off'))) return { tracks: addVectorAt(tr, clip, at, laneId), moved: 0 }
  const hit = (c: TlClip) => start < c.start + c.length - 1e-6 && end > c.start + 1e-6
  const up = main.clips.filter(hit)
  const c = { ...clip, start, length: clip.length }
  if (!up.length) return { tracks: tr.map((l, i) => (i === mi ? { ...l, clips: [...l.clips, c] } : l)), moved: 0 }
  const lifted = { ...newLane(laneId(), 'visual'), clips: up }
  const next = tr.map((l, i) => (i === mi ? { ...l, clips: [...l.clips.filter((x) => !hit(x)), c] } : l))
  return { tracks: [...next.slice(0, mi), lifted, ...next.slice(mi)], moved: up.length }
}
/** 改形状内容（锁了的轨不动） */
export function patchShape(tr: Tracks, id: string, p: Partial<ShapeBody>): Tracks {
  return tr.map((l) => (l.locked ? l : { ...l, clips: l.clips.map((c) => (c.id === id && c.shape ? { ...c, shape: parseShape({ ...c.shape, ...p }) ?? c.shape } : c)) }))
}
export function patchSolid(tr: Tracks, id: string, color: string): Tracks {
  return tr.map((l) => (l.locked ? l : { ...l, clips: l.clips.map((c) => (c.id === id && c.solid && HEX_RE.test(color) ? { ...c, solid: { color: color.toLowerCase() } } : c)) }))
}

// ── 几何（像素·画面 W×H·外框置中）──
export type Pt = [number, number]
export type ShapePath = { pts: Pt[]; closed: boolean }
const ARC_STEPS = 8
const ELLIPSE_STEPS = 64
/** 形状的描边路径（照描边顺序）：矩形＝左上起顺时针（圆角取样）·圆＝正上起顺时针·直线＝左到右·箭头＝杆（左到右）再箭头两翼 */
export function shapePaths(b: ShapeBody, W: number, H: number): ShapePath[] {
  const cx = W / 2, cy = H / 2, w = b.w * W, h = b.h * H
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2
  if (b.shape === 'line') return [{ pts: [[x0, cy], [x1, cy]], closed: false }]
  if (b.shape === 'arrow') {
    const head = Math.min(w * 0.5, Math.max(b.width * H * 4, w * 0.15)), a = Math.PI / 6
    return [{ pts: [[x0, cy], [x1, cy]], closed: false }, { pts: [[x1 - head * Math.cos(a), cy - head * Math.sin(a)], [x1, cy], [x1 - head * Math.cos(a), cy + head * Math.sin(a)]], closed: false }]
  }
  if (b.shape === 'ellipse') {
    const pts: Pt[] = []
    for (let i = 0; i <= ELLIPSE_STEPS; i++) { const t = -Math.PI / 2 + (i / ELLIPSE_STEPS) * Math.PI * 2; pts.push([cx + (w / 2) * Math.cos(t), cy + (h / 2) * Math.sin(t)]) }
    return [{ pts, closed: true }]
  }
  const r = clamp(b.radius, 0, 0.5) * Math.min(w, h)
  if (r <= 0) return [{ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], closed: true }]
  const pts: Pt[] = []
  const arc = (ax: number, ay: number, from: number) => { for (let i = 0; i <= ARC_STEPS; i++) { const t = from + (i / ARC_STEPS) * (Math.PI / 2); pts.push([ax + r * Math.cos(t), ay + r * Math.sin(t)]) } }
  arc(x1 - r, y0 + r, -Math.PI / 2); arc(x1 - r, y1 - r, 0); arc(x0 + r, y1 - r, Math.PI / 2); arc(x0 + r, y0 + r, Math.PI)
  pts.push([x1 - r, y0])
  pts.unshift([x0 + r, y0])
  return [{ pts, closed: true }]
}
const seg = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const pathLength = (ps: readonly ShapePath[]): number => ps.reduce((s, p) => s + p.pts.slice(1).reduce((q, pt, i) => q + seg(p.pts[i], pt), 0), 0)
/** 照描边顺序只留前 len 像素长（描边生长用） */
export function truncatePaths(ps: readonly ShapePath[], len: number): ShapePath[] {
  const out: ShapePath[] = []
  let left = len
  for (const p of ps) {
    if (left <= 1e-9) break
    const pts: Pt[] = [p.pts[0]]
    let full = true
    for (let i = 1; i < p.pts.length; i++) {
      const d = seg(p.pts[i - 1], p.pts[i])
      if (d <= left) { pts.push(p.pts[i]); left -= d; continue }
      const k = d > 0 ? left / d : 0
      pts.push([p.pts[i - 1][0] + (p.pts[i][0] - p.pts[i - 1][0]) * k, p.pts[i - 1][1] + (p.pts[i][1] - p.pts[i - 1][1]) * k])
      left = 0; full = false; break
    }
    out.push({ pts, closed: p.closed && full })
  }
  return out
}
/** 描边生长进度（时间轴 t）：没设 grow ⇒ 1；不然＝段内秒数÷grow（夹 0～1） */
export function growProgress(c: Pick<TlClip, 'shape' | 'start'>, t: number): number {
  const g = c.shape?.grow
  if (!g || g <= 0 || shapeSolidNeg()) return 1
  return clamp((t - c.start) / g, 0, 1)
}
/** 进度 p 时描边画到多长（像素）＝全长 × p */
export const growLength = (b: ShapeBody, W: number, H: number, p: number): number => pathLength(shapePaths(b, W, H)) * clamp(p, 0, 1)

// ── 画（预览与汇出同一支）──
/** 画布最小介面（CanvasRenderingContext2D 满足） */
export type VecCtx = {
  save(): void; restore(): void; translate(x: number, y: number): void; rotate(a: number): void; scale(x: number, y: number): void
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void
  fill(): void; stroke(): void; fillRect(x: number, y: number, w: number, h: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  createRadialGradient?: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => { addColorStop(o: number, c: string): void }
  globalAlpha: number; fillStyle: unknown; strokeStyle: unknown; lineWidth: number; lineCap: string; lineJoin: string
}
/** 这段在时间轴 t 这一刻画进 W×H 的画布（位置大小旋转不透明度＝lookOf 带 t 的关键帧值＋clip.anim 姿势·同媒体片段的 lookXform） */
export function drawVectorClip(ctx: VecCtx, c: TlClip, t: number, W: number, H: number): void {
  if (!c.shape && !c.solid && !c.bgfx) return
  const xf = lookXform(lookOf(c, t), clipAnimPose(c, t))
  if (xf.opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = xf.opacity
  ctx.translate(W / 2 + (xf.tx / 100) * W, H / 2 + (xf.ty / 100) * H)
  if (xf.rot) ctx.rotate((xf.rot * Math.PI) / 180)
  if (xf.sx !== 1 || xf.sy !== 1) ctx.scale(xf.sx, xf.sy)
  ctx.translate(-W / 2, -H / 2)
  if (c.solid) { ctx.fillStyle = c.solid.color; ctx.fillRect(0, 0, W, H); ctx.restore(); return }
  if (c.bgfx) { drawBgfx(ctx, c.bgfx, t - c.start, W, H, xf.opacity); ctx.restore(); return } // 动态背景：圆点列表＝bgfx.pure bgfxFrame（预览汇出同一支）
  const b = c.shape!
  const p = growProgress(c, t)
  const all = shapePaths(b, W, H)
  const trace = (ps: readonly ShapePath[]) => { ctx.beginPath(); for (const q of ps) { q.pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); if (q.closed) ctx.closePath() } }
  // 填充：跟着生长淡入（画满时全不透明）
  if (b.fill && (b.shape === 'rect' || b.shape === 'ellipse') && p > 0) { ctx.globalAlpha = xf.opacity * p; ctx.fillStyle = b.fill; trace(all); ctx.fill(); ctx.globalAlpha = xf.opacity }
  const ps = p >= 1 ? all : truncatePaths(all, pathLength(all) * p)
  if (ps.length) {
    ctx.strokeStyle = b.stroke; ctx.lineWidth = b.width * H
    ctx.lineCap = b.shape === 'rect' && b.radius <= 0 && p >= 1 ? 'butt' : 'round'; ctx.lineJoin = b.shape === 'rect' && b.radius <= 0 ? 'miter' : 'round'
    trace(ps); ctx.stroke()
  }
  ctx.restore()
}
