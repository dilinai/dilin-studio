// 网页剪辑页·四角透视（corner pin）：把这一层画面的四个角各自拖到任意位置（3D 透视／贴到斜面上）。
// 资料：clip.look.pin = { x0,y0, x1,y1, x2,y2, x3,y3 }＝四个角（0 左上·1 右上·2 右下·3 左下）离「整个画面」那个角的位移，
//   x 以画面宽为 1、y 以画面高为 1、往下为正；没有 pin ＝不透视（旧工程照旧）。关键帧项 pin.x0…pin.y3（同 kf 那套）。
// 画法：这一层先照原本的位置／缩放／旋转画好（整个画面大小那一层），再整层套一个 homography（3×3 投影矩阵·正规化座标 0..1）：
//   预览 ⇒ pinCssMatrix 把同一个矩阵换成 CSS matrix3d（投影变换·精确）；汇出 ⇒ warpPixels 用同一个矩阵的反矩阵逐像素反查（双线性）。
// 本档只放纯函数（题直接跑）·⛔ 碰 DOM。

export const PIN_KEYS = ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3'] as const
export type PinKey = (typeof PIN_KEYS)[number]
export type ClipPin = Record<PinKey, number>
export const PIN_ZERO: ClipPin = { x0: 0, y0: 0, x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0 }
/** 位移上限（画面宽／高的几倍） */
export const PIN_LIM = 2
/** 单位正方形四角（左上·右上·右下·左下） */
export const UNIT_QUAD: ReadonlyArray<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]]
export type Mat3 = [number, number, number, number, number, number, number, number, number]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r4 = (v: number) => Math.round(v * 10000) / 10000

/** 药：DILIN_NEG 含 vedit_corner_pin_off ⇒ 不套透视（只在 node 测试跑） */
export function pinNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_corner_pin_off')
}

/** 读档验值：不是物件 ⇒ undefined；缺的角补 0·夹在 ±PIN_LIM */
export function parsePin(v: unknown): ClipPin | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const p = { ...PIN_ZERO }
  for (const k of PIN_KEYS) p[k] = r4(clamp(num(o[k]) ?? 0, -PIN_LIM, PIN_LIM))
  return p
}
/** 四角在画面上的位置（正规化 0..1） */
export const pinQuad = (p: ClipPin): Array<[number, number]> => UNIT_QUAD.map(([x, y], i) => [x + p[`x${i}` as PinKey], y + p[`y${i}` as PinKey]])

/** 解 8×8（高斯消去·部分主元）；奇异 ⇒ null */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / r[i])
}
/** 四点对四点的 homography（src[i] → dst[i]·h33=1）；退化（三点共线等） ⇒ null */
export function homography(src: ReadonlyArray<readonly [number, number]>, dst: ReadonlyArray<readonly [number, number]>): Mat3 | null {
  const A: number[][] = [], b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  const h = solve(A, b)
  if (!h || !h.every(Number.isFinite)) return null
  const H: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
  return invertH(H) ? H : null // 奇异（三点共线）⇒ 不算
}
/** 套矩阵（投影·除以 w）；w≈0 ⇒ null（落在地平线外） */
export function applyH(H: Mat3, x: number, y: number): [number, number] | null {
  const w = H[6] * x + H[7] * y + H[8]
  if (Math.abs(w) < 1e-12) return null
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]
}
/** 反矩阵（伴随矩阵／行列式）；奇异 ⇒ null */
export function invertH(H: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = H
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}
/** 这一层的透视矩阵（正规化画面座标 0..1 → 0..1）：没 pin／四角都没动／退化／药 ⇒ null（照旧不透视）。预览、汇出都从这里取 */
export function pinMatrix(p: ClipPin | null | undefined): Mat3 | null {
  if (!p || pinNegOff()) return null
  if (PIN_KEYS.every((k) => Math.abs(p[k]) < 1e-6)) return null
  const q = pinQuad(p)
  // 四角要围成凸四边形（拖成交叉的蝴蝶结没有合理的投影）
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4]
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(z) < 1e-9) return null
    const s = Math.sign(z)
    if (sign && s !== sign) return null
    sign = s
  }
  return homography(UNIT_QUAD, q)
}
/** 预览：同一个矩阵换成 CSS matrix3d（元素 w×h px·transform-origin 在正中＝CSS 缺省）。
 *  H_px = S·H·S⁻¹（S＝diag(w,h)）·再抵掉原点：M = T(-c)·H_px·T(c) */
export function pinCssMatrix(H: Mat3, w: number, h: number): string {
  const S = (m: Mat3, sx: number, sy: number): Mat3 => [m[0], (m[1] * sx) / sy, m[2] * sx, (m[3] * sy) / sx, m[4], m[5] * sy, m[6] / sx, m[7] / sy, m[8]]
  const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c])) as Mat3
  const cx = w / 2, cy = h / 2
  const M = mul(mul([1, 0, -cx, 0, 1, -cy, 0, 0, 1], S(H, w, h)), [1, 0, cx, 0, 1, cy, 0, 0, 1])
  const n = M[8]
  const m = M.map((v) => v / n)
  // CSS matrix3d 是栏优先：a b 0 g / c d 0 h / 0 0 1 0 / tx ty 0 1
  const v = [m[0], m[3], 0, m[6], m[1], m[4], 0, m[7], 0, 0, 1, 0, m[2], m[5], 0, m[8]]
  return `matrix3d(${v.map((x) => +x.toFixed(9)).join(',')})`
}
/** 汇出：src 整层（w×h RGBA）照 H 投影进 dst（同大小）·逐像素反查＋双线性；落在四边形外 ⇒ 透明 */
export function warpPixels(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, H: Mat3): void {
  const Hi = invertH(H)
  dst.fill(0)
  if (!Hi) return
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w
      const wq = Hi[6] * nx + Hi[7] * ny + Hi[8]
      if (wq <= 1e-12) continue
      const sx = ((Hi[0] * nx + Hi[1] * ny + Hi[2]) / wq) * w - 0.5, sy = ((Hi[3] * nx + Hi[4] * ny + Hi[5]) / wq) * h - 0.5
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) continue
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0
      const o = (y * w + x) * 4
      for (let ch = 0; ch < 4; ch++) {
        const P = (xx: number, yy: number) => src[(clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)) * 4 + ch]
        dst[o + ch] = (P(x0, y0) * (1 - fx) + P(x0 + 1, y0) * fx) * (1 - fy) + (P(x0, y0 + 1) * (1 - fx) + P(x0 + 1, y0 + 1) * fx) * fy
      }
    }
  }
}

// ── 3D 旋转便利（rotX／rotY＋透视距离 ⇒ 四角透视的四个角·同一个 pin 机制）──
// 资料：clip.look.rot3d = { x: rotX 度, y: rotY 度, d: 透视距离（以画面高为 1） }＝面板记住的数值；真正画的仍是 look.pin（四角）·关键帧照 pin.x0…pin.y3 打。
// 换算（画面宽高比 A＝W/H·以画面高为 1·原点在画面正中·z 往里为正）：
//   角 (u,v)∈{0,1}² ⇒ P＝((u−½)·A, v−½, 0)
//   先绕 y 轴转 θy：x₁＝X·cosθy, z₁＝X·sinθy（rotY＞0 ⇒ 右边往里退）
//   再绕 x 轴转 θx：y₂＝Y·cosθx − z₁·sinθx, z₂＝Y·sinθx + z₁·cosθx（rotX＞0 ⇒ 下边往里退）
//   针孔投影（相机在 z＝−d·看向画面）：x′＝x₁·d/(d+z₂), y′＝y₂·d/(d+z₂)
//   回正规化：u′＝x′/A＋½, v′＝y′＋½ ⇒ pin：xi＝u′−u, yi＝v′−v
//   0 度 ⇒ 四角不动（pin 全 0 ⇒ pinMatrix 回 null·不变形）；rotY 正负对调 ⇒ 左右镜像；rotX 正负对调 ⇒ 上下镜像。
export type ClipRot3d = { x: number; y: number; d: number }
export const ROT3D_LIM = 80
export const ROT3D_D_MIN = 0.5
export const ROT3D_D_MAX = 10
export const ROT3D_DEFAULT: ClipRot3d = { x: 0, y: 0, d: 2.5 }

/** 药：DILIN_NEG 含 vedit_look_glow_mblur_off ⇒ 外发光／描边／方向运动模糊／图片运动模糊／3D 旋转换算都关（只在 node 测试跑） */
export function lookFxNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_look_glow_mblur_off')
}
/** 读档验值：角度夹在 ±80·距离 0.5～10；两个角度都是 0 ⇒ undefined（不存） */
export function parseRot3d(v: unknown): ClipRot3d | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v) || lookFxNegOff()) return undefined
  const o = v as Record<string, unknown>
  const r: ClipRot3d = { x: Math.round(clamp(num(o.x) ?? 0, -ROT3D_LIM, ROT3D_LIM) * 10) / 10, y: Math.round(clamp(num(o.y) ?? 0, -ROT3D_LIM, ROT3D_LIM) * 10) / 10, d: r4(clamp(num(o.d) ?? ROT3D_DEFAULT.d, ROT3D_D_MIN, ROT3D_D_MAX)) }
  return r.x || r.y ? r : undefined
}
/** rotX／rotY（度）＋透视距离 ⇒ 四角透视的 pin（aspect＝画面宽／高） */
export function rot3dToPin(r: ClipRot3d, aspect: number): ClipPin {
  const p = { ...PIN_ZERO }
  if (lookFxNegOff()) return p
  const A = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9
  const ax = (clamp(r.x, -ROT3D_LIM, ROT3D_LIM) * Math.PI) / 180, ay = (clamp(r.y, -ROT3D_LIM, ROT3D_LIM) * Math.PI) / 180
  const d = clamp(r.d, ROT3D_D_MIN, ROT3D_D_MAX)
  UNIT_QUAD.forEach(([u, v], i) => {
    const X = (u - 0.5) * A, Y = v - 0.5
    const x1 = X * Math.cos(ay), z1 = X * Math.sin(ay)
    const y2 = Y * Math.cos(ax) - z1 * Math.sin(ax), z2 = Y * Math.sin(ax) + z1 * Math.cos(ax)
    const k = d / Math.max(1e-3, d + z2)
    p[`x${i}` as PinKey] = r4(clamp((x1 * k) / A + 0.5 - u, -PIN_LIM, PIN_LIM))
    p[`y${i}` as PinKey] = r4(clamp(y2 * k + 0.5 - v, -PIN_LIM, PIN_LIM))
  })
  return p
}

/**
 * 画面上角点的显示位置（CSS left/top）：夹在框内、离边至少半颗角点（6px）——
 * 预览框外层会裁掉超出的部分，四角没动时角点圆心正好压在框边，会被裁掉一半、点到旁边的分隔条。
 * 只改显示位置；拖动按指标位移算，不受影响。
 */
export function pinHandlePos(v: number): string {
  if (pinHandleNegOff()) return `${v * 100}%`
  return `clamp(6px, ${Math.round(v * 10000) / 100}%, calc(100% - 6px))`
}
/** 药：DILIN_NEG 含 vedit_pin_handle_clamp_off ⇒ 角点照原位压在框边（只在 node 测试跑） */
export function pinHandleNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_pin_handle_clamp_off')
}
