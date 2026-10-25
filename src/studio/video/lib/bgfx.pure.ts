// 网页剪辑页·程序画的动态背景片段（放画面轨·mediaId 空·同纯色片段 solid 那套：贴纸页「形状与纯色」组点一下放在播放头）：
//   stars＝星空粒子（点点星光闪烁、缓慢漂移）；bokeh＝光斑漂移（几团柔光大圆点慢慢飘、边缘柔化）。
// 参数：color＝粒子／光斑颜色·bg＝底色·density 0～1（多少颗）·speed 0～2（漂移与闪烁快慢·0＝静止）·seed＝伪随机种子（存在片段里·同种子同画面）·parallax＝整体缓慢平移＋放大一点。
// 同一时刻的圆点列表只由 bgfxFrame（纯函数·确定性伪随机 mulberry32）算；预览（ui/VectorCanvas.tsx）与汇出（ui/export-render.ts）都经 shape.pure drawVectorClip ⇒ drawBgfx 画 ⇒ 一样。
// 本档只放纯函数（题直接跑）：⛔ 碰 DOM。
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const HEX_RE = /^#[0-9a-f]{6}$/i
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** 药：DILIN_NEG 含 vedit_bgfx_off ⇒ 动态背景读档丢掉、圆点不随时间动（只在 node 测试跑） */
export function bgfxNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_bgfx_off')
}

export const BGFX_KINDS = ['stars', 'bokeh'] as const
export type BgfxKind = (typeof BGFX_KINDS)[number]
/** 动态背景片段内容 */
export type BgfxBody = { kind: BgfxKind; color: string; bg: string; density: number; speed: number; seed: number; parallax?: boolean }
export const BGFX_DEFAULT_SECONDS = 5
export const BGFX_SEED_MAX = 999999

export function bgfxDefault(kind: BgfxKind, seed = 1): BgfxBody {
  return kind === 'stars'
    ? { kind, color: '#ffffff', bg: '#05070f', density: 0.5, speed: 1, seed }
    : { kind, color: '#ffc36b', bg: '#0b1020', density: 0.5, speed: 1, seed }
}
/** 读档验值：坏的回 null·好的夹进范围 */
export function parseBgfx(v: unknown): BgfxBody | null {
  if (bgfxNegOff() || !isObj(v) || !BGFX_KINDS.includes(v.kind as BgfxKind)) return null
  const d = bgfxDefault(v.kind as BgfxKind)
  const out: BgfxBody = {
    kind: v.kind as BgfxKind,
    color: typeof v.color === 'string' && HEX_RE.test(v.color) ? v.color.toLowerCase() : d.color,
    bg: typeof v.bg === 'string' && HEX_RE.test(v.bg) ? v.bg.toLowerCase() : d.bg,
    density: r3(clamp(num(v.density) ?? d.density, 0, 1)),
    speed: r3(clamp(num(v.speed) ?? d.speed, 0, 2)),
    seed: Math.round(clamp(num(v.seed) ?? 1, 0, BGFX_SEED_MAX)),
  }
  if (v.parallax === true) out.parallax = true
  return out
}
/** 新种子（页面用 Math.random·命令可指定） */
export const bgfxSeed = (rnd: number): number => Math.floor(clamp(rnd, 0, 0.999999) * BGFX_SEED_MAX) + 1

// ── 确定性伪随机 ──
/** mulberry32：同种子同一串数（0..1） */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const frac = (v: number) => v - Math.floor(v)

/** 一颗圆点（像素·画面 W×H）：r＝半径·a＝不透明度 0..1·soft＝柔边（光斑） */
export type BgfxDot = { x: number; y: number; r: number; a: number; soft: boolean }
/** 整层的视差变换：以画面正中为心放大 scale·再平移 dx／dy（像素） */
export type BgfxView = { scale: number; dx: number; dy: number }
export const bgfxCount = (b: Pick<BgfxBody, 'kind' | 'density'>): number => (b.kind === 'stars' ? Math.round(40 + b.density * 360) : Math.round(6 + b.density * 24))

/** 动态背景在片段里第 tau 秒（从片段开头算）的画面：圆点列表＋视差变换。同 body 同 tau ⇒ 结果一字不差 */
export function bgfxFrame(b: BgfxBody, tau: number, W: number, H: number): { dots: BgfxDot[]; view: BgfxView } {
  const T = bgfxNegOff() ? 0 : Math.max(0, tau)
  const R = rng(b.seed * 7919 + (b.kind === 'stars' ? 11 : 23))
  const n = bgfxCount(b), sp = b.speed, S = Math.min(W, H)
  const dots: BgfxDot[] = []
  for (let i = 0; i < n; i++) {
    // 每颗固定抽同样几个数（不论速度）⇒ 改速度不换星位
    const x0 = R(), y0 = R(), rr = R(), ph = R(), fq = R(), ang = R(), vv = R()
    if (b.kind === 'stars') {
      const v = (0.004 + vv * 0.012) * sp, th = ang * Math.PI * 2
      const x = frac(x0 + Math.cos(th) * v * T * 0.6 + 0.01 * sp * T), y = frac(y0 + Math.sin(th) * v * T * 0.3)
      const tw = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (ph + (0.3 + fq * 1.2) * sp * T))
      const big = rr > 0.93
      dots.push({ x: x * W, y: y * H, r: (big ? 1.6 + rr * 1.2 : 0.5 + rr * 1.1) * (H / 1080) * 1.4, a: r3(clamp(0.25 + 0.75 * tw * (0.5 + 0.5 * rr), 0, 1)), soft: false })
    } else {
      const v = (0.006 + vv * 0.018) * sp, th = ang * Math.PI * 2, m = 0.3 // 出画再从另一边进来（留边免得一跳）
      const wrap = (p0: number, d: number) => frac(p0 + d / (1 + m)) * (1 + m) - m / 2
      const x = wrap(x0, Math.cos(th) * v * T), y = wrap(y0, Math.sin(th) * v * T)
      const br = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (ph + (0.05 + fq * 0.12) * sp * T))
      dots.push({ x: x * W, y: y * H, r: (0.04 + rr * 0.1) * S, a: r3(clamp(0.12 + 0.3 * br, 0, 1)), soft: true })
    }
  }
  const view: BgfxView = b.parallax && !bgfxNegOff()
    ? { scale: r3(1 + 0.06 * (1 - Math.cos((Math.PI * 2 * T) / 30)) / 2), dx: r3(Math.sin((Math.PI * 2 * T) / 24) * 0.02 * W), dy: r3(Math.sin((Math.PI * 2 * T) / 34) * 0.012 * H) }
    : { scale: 1, dx: 0, dy: 0 }
  return { dots, view }
}

/** 画布最小介面（CanvasRenderingContext2D 满足；createRadialGradient 有就用来画光斑柔边） */
export type BgfxCtx = {
  save(): void; restore(): void; translate(x: number, y: number): void; scale(x: number, y: number): void
  beginPath(): void; arc(x: number, y: number, r: number, a0: number, a1: number): void; fill(): void; fillRect(x: number, y: number, w: number, h: number): void
  globalAlpha: number; fillStyle: unknown
  createRadialGradient?: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => { addColorStop(o: number, c: string): void }
}
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`
/** 在已经套好片段变换的画布上画（底色铺满 W×H·圆点照 bgfxFrame）；alpha＝片段不透明度 */
export function drawBgfx(ctx: BgfxCtx, b: BgfxBody, tau: number, W: number, H: number, alpha: number): void {
  const { dots, view } = bgfxFrame(b, tau, W, H)
  ctx.globalAlpha = alpha
  ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H)
  ctx.save()
  if (view.scale !== 1 || view.dx || view.dy) { ctx.translate(W / 2 + view.dx, H / 2 + view.dy); ctx.scale(view.scale, view.scale); ctx.translate(-W / 2, -H / 2) }
  for (const d of dots) {
    if (d.a <= 0 || d.r <= 0) continue
    if (d.soft && ctx.createRadialGradient) {
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r)
      g.addColorStop(0, rgba(b.color, 1)); g.addColorStop(0.55, rgba(b.color, 0.6)); g.addColorStop(1, rgba(b.color, 0))
      ctx.globalAlpha = alpha * d.a; ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill()
      continue
    }
    if (d.soft) { // 没有渐层 ⇒ 两圈叠出柔边
      ctx.globalAlpha = alpha * d.a * 0.45; ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = alpha * d.a; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 0.6, 0, Math.PI * 2); ctx.fill()
      continue
    }
    ctx.globalAlpha = alpha * d.a; ctx.fillStyle = b.color
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = alpha
}
