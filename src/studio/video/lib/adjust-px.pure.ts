// 网页剪辑页·「调节」16 项套进成片（预览与汇出同一套）。
// 预览是 SVG 滤镜（clip-look.pure.ts adjustFilterBody·sRGB）；汇出画布上没有同一套 ⇒ 这里照同一串步骤逐像素算一遍（同一份数值·同一个次序）：
//   色温色调（逐色乘）→ 饱和度＋自然饱和度（feColorMatrix saturate 那条矩阵）→ 明暗曲线（toneTable 17 点·feFuncX table 线性内插）→
//   锐化／清晰（3×3 卷积·边缘照 duplicate·不动透明度）→ 暗角（中间亮四周暗的椭圆渐层·正片叠底；负＝滤色）→ 颗粒（杂讯·叠加·按强度混）。
// 每一步做完都夹回 0～1（同 SVG 每个滤镜元件的输出）。只处理有画面的像素（alpha＞0）。⛔ 碰 DOM（吃 Uint8ClampedArray·题直接跑）。
import { adjActive, toneTable, type ClipAdjust, type AdjKey } from './clip-look.pure'

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** 颗粒杂讯（固定种子·同预览那张静态杂讯图一样不会每帧换）：0.5 上下 */
function noiseAt(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return 0.5 + (((h >>> 0) / 4294967296) - 0.5) * 0.55
}

/** 就地改 data（RGBA·w×h·整块＝素材那一块·暗角对着整块画） */
export function adjustPixels(data: Uint8ClampedArray, w: number, h: number, a: ClipAdjust | undefined): void {
  if (!adjActive(a) || w <= 0 || h <= 0) return
  const g = (k: AdjKey) => (a![k] ?? 0) / 100
  const T = g('temp'), Ti = g('tint')
  const mr = 1 + T * 0.15 + Ti * 0.04, mg = 1 - Ti * 0.12, mb = 1 - T * 0.15 + Ti * 0.04
  const doTemp = !!(T || Ti)
  const satRaw = (1 + g('sat')) * (1 + g('vib') * 0.5)
  const s = Math.max(0, satRaw), doSat = Math.abs(satRaw - 1) > 1e-4
  const tone = toneTable(a!), n1 = tone.length - 1
  const doTone = tone.some((y, i) => Math.abs(y - i / n1) > 1e-4)
  const k = g('sharpen') * 0.8 + g('clarity') * 0.35, doConv = k > 1e-3
  const v = g('vignette'), gr = g('grain')
  const tbl = (c: number) => { const p = c * n1, i = Math.min(n1 - 1, Math.floor(p)); return tone[i] + (tone[i + 1] - tone[i]) * (p - i) }
  // 前三步逐像素（存成 0～1 浮点·卷积要看邻居）
  const N = w * h
  const buf = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const o = i * 4
    let r = data[o] / 255, gg = data[o + 1] / 255, b = data[o + 2] / 255
    if (doTemp) { r = c01(r * mr); gg = c01(gg * mg); b = c01(b * mb) }
    if (doSat) {
      const R = (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * gg + (0.072 - 0.072 * s) * b
      const G = (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * gg + (0.072 - 0.072 * s) * b
      const B = (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * gg + (0.072 + 0.928 * s) * b
      r = c01(R); gg = c01(G); b = c01(B)
    }
    if (doTone) { r = tbl(r); gg = tbl(gg); b = tbl(b) }
    buf[i * 3] = r; buf[i * 3 + 1] = gg; buf[i * 3 + 2] = b
  }
  const vEdge = v > 0 ? (255 * (1 - 0.85 * v) | 0) / 255 : (255 * 0.85 * -v | 0) / 255
  const vMid = v > 0 ? 1 : 0, vStop = (62 - 22 * Math.abs(v)) / 100
  const al = gr * 0.45
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4
      if (data[o + 3] === 0) continue
      let r: number, gg: number, b: number
      if (doConv) {
        // 0 −k 0 / −k 1+4k −k / 0 −k 0（边缘照 duplicate）
        const up = (y > 0 ? i - w : i) * 3, dn = (y < h - 1 ? i + w : i) * 3, lf = (x > 0 ? i - 1 : i) * 3, rt = (x < w - 1 ? i + 1 : i) * 3, me = i * 3
        r = c01((1 + 4 * k) * buf[me] - k * (buf[up] + buf[dn] + buf[lf] + buf[rt]))
        gg = c01((1 + 4 * k) * buf[me + 1] - k * (buf[up + 1] + buf[dn + 1] + buf[lf + 1] + buf[rt + 1]))
        b = c01((1 + 4 * k) * buf[me + 2] - k * (buf[up + 2] + buf[dn + 2] + buf[lf + 2] + buf[rt + 2]))
      } else { r = buf[i * 3]; gg = buf[i * 3 + 1]; b = buf[i * 3 + 2] }
      if (v) {
        // 渐层：中心 (50%,50%)·半径 71%（对着这一块拉成椭圆）·vStop 内＝中间色·到 100% 渐到边缘色·再外＝边缘色
        const dx = ((x + 0.5) / w - 0.5), dy = ((y + 0.5) / h - 0.5)
        const d = Math.sqrt(dx * dx + dy * dy) / 0.71
        const f = d <= vStop ? 0 : d >= 1 ? 1 : (d - vStop) / (1 - vStop)
        const q = vMid + (vEdge - vMid) * f
        if (v > 0) { r *= q; gg *= q; b *= q } else { r = r + q - r * q; gg = gg + q - gg * q; b = b + q - b * q }
      }
      if (gr) {
        const nz = noiseAt(x, y)
        const ov = (cs: number) => (nz <= 0.5 ? 2 * cs * nz : 1 - 2 * (1 - cs) * (1 - nz))
        r = c01(al * ov(r) + (1 - al) * r); gg = c01(al * ov(gg) + (1 - al) * gg); b = c01(al * ov(b) + (1 - al) * b)
      }
      data[o] = Math.round(r * 255); data[o + 1] = Math.round(gg * 255); data[o + 2] = Math.round(b * 255)
    }
  }
}
