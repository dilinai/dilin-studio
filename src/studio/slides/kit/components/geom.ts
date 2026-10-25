/**
 * slide-kit · 组件化 · 框的几何（平滑切换／组合／幻灯片背景填充·纯函数·零依赖·客户端／服务端／单测同一份）
 *
 *   矩阵＝CSS matrix(a,b,c,d,e,f)：x' = a·x + c·y + e；y' = b·x + d·y + f。
 *   一个框（x,y,w,h,rotate）的「框内局部 ⇒ 外层」＝ T(中心) · R(rotate) · T(-w/2,-h/2)（与 CSS left/top＋rotate 绕中心同效）。
 *   组合：子件框是组框内的局部坐标 ⇒ 子件局部 ⇒ 页面 ＝ M(组框) · M(子件框)。
 *   幻灯片背景填充：形状里放一层页面大小的底·套「页面 ⇒ 形状局部」＝上式的反矩阵 ⇒ 不管怎么转、在不在组里都跟页面对齐。
 */

import type { Frame } from '../../../shared/frame-kit/types'

export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** m1·m2（先套 m2 再套 m1） */
export function mul(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!det) return IDENTITY
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** 框内局部 ⇒ 外层 */
export function frameMatrix(f: Frame): Mat {
  const r = ((f.rotate || 0) * Math.PI) / 180
  const cos = Math.cos(r), sin = Math.sin(r)
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2
  // T(c)·R·T(-w/2,-h/2)
  return [cos, sin, -sin, cos, cx - cos * (f.w / 2) + sin * (f.h / 2), cy - sin * (f.w / 2) - cos * (f.h / 2)]
}

/** 一串由外到内的框（组框、子件框…）⇒ 最内层局部 ⇒ 页面 */
export function chainMatrix(frames: readonly Frame[]): Mat {
  let m = IDENTITY
  for (const f of frames) m = mul(m, frameMatrix(f))
  return m
}

/** 幻灯片背景填充那层要套的矩阵（页面 ⇒ 最内层框的局部）·transform-origin 0 0 */
export function bgFillMatrix(frames: readonly Frame[]): Mat {
  return invert(chainMatrix(frames))
}

export const cssMatrix = (m: Mat): string => `matrix(${m.map((v) => Math.round(v * 1e6) / 1e6).join(',')})`

const norm360 = (r: number) => { const x = r % 360; return Math.round((x < 0 ? x + 360 : x) * 100) / 100 }
const r2 = (n: number) => Math.round(n * 100) / 100

/** 组内局部框 ⇒ 页面框（中心按组矩阵换算·角度相加·宽高不变） */
export function childToPage(group: Frame, child: Frame): Frame {
  const [cx, cy] = apply(frameMatrix(group), child.x + child.w / 2, child.y + child.h / 2)
  return { x: r2(cx - child.w / 2), y: r2(cy - child.h / 2), w: child.w, h: child.h, rotate: norm360((group.rotate || 0) + (child.rotate || 0)) }
}

/** 页面框 ⇒ 组内局部框（childToPage 的反算） */
export function pageToChild(group: Frame, abs: Frame): Frame {
  const [cx, cy] = apply(invert(frameMatrix(group)), abs.x + abs.w / 2, abs.y + abs.h / 2)
  return { x: r2(cx - abs.w / 2), y: r2(cy - abs.h / 2), w: abs.w, h: abs.h, rotate: norm360((abs.rotate || 0) - (group.rotate || 0)) }
}

/** 一个（可能旋转的）框的外接矩形 */
export function frameBounds(f: Frame): { x: number; y: number; w: number; h: number } {
  const m = frameMatrix(f)
  const pts = [apply(m, 0, 0), apply(m, f.w, 0), apply(m, 0, f.h), apply(m, f.w, f.h)]
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 几个框的外接框（组合缺省组框·不转） */
export function boundsOfFrames(frames: readonly Frame[]): Frame {
  const bs = frames.map(frameBounds)
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  const x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h))
  return { x: r2(x), y: r2(y), w: Math.max(1, r2(x2 - x)), h: Math.max(1, r2(y2 - y)), rotate: 0 }
}

/** 组框改宽高 ⇒ 子件局部框按比例缩（与 PowerPoint 拉组合同效：子件不转的照比例·有转的宽高照比例近似） */
export function scaleChildFrame(f: Frame, sx: number, sy: number): Frame {
  return { x: r2(f.x * sx), y: r2(f.y * sy), w: Math.max(1, r2(f.w * sx)), h: Math.max(1, r2(f.h * sy)), rotate: f.rotate }
}

/** 角度补间：取最短那一边（存的角度都正规成 0–360·PowerPoint 平滑同样走最短路） */
export function angleDelta(from: number, to: number): number {
  let d = ((to - from) % 360 + 360) % 360
  if (d > 180) d -= 360
  return d
}
