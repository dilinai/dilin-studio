// 网页剪辑页·追踪打码的 Canvas 画法（汇出成片、合成子素材、静帧用）：在合成好的整格画面上逐个框打码。
// 像素块＝框那块缩小到每块一格再放大（不平滑）；模糊＝框外扩一圈拷出来、带 blur 滤镜画回去；纯色＝直接填。形状照框裁（方／圆角／圆）。
// 参数（块多大、糊多少）在 mosaic.pure.ts·预览 CSS 吃同一份。
import { MOSAIC_ROUND, mosaicBlock, mosaicBlur, mosaicRect, type MosaicBox } from './mosaic.pure'

type Cv = HTMLCanvasElement | OffscreenCanvas
const mk = (w: number, h: number): Cv => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }))
type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function shapePath(ctx: Ctx2, b: MosaicBox, r: { x: number; y: number; w: number; h: number }) {
  ctx.beginPath()
  if (b.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
  else if (b.shape === 'round') (ctx as CanvasRenderingContext2D).roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * MOSAIC_ROUND)
  else ctx.rect(r.x, r.y, r.w, r.h)
}

export function drawMosaics(ctx: Ctx2, boxes: readonly MosaicBox[], W: number, H: number) {
  for (const b of boxes) {
    const r = mosaicRect(b, W, H)
    if (!(r.w >= 1 && r.h >= 1)) continue
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'
    shapePath(ctx, b, r)
    ctx.clip()
    if (b.mode === 'solid') { ctx.fillStyle = b.color; ctx.fillRect(r.x, r.y, r.w, r.h) }
    else if (b.mode === 'pixel') {
      const blk = Math.max(2, mosaicBlock(b.strength) * H)
      const x0 = Math.floor(r.x), y0 = Math.floor(r.y), w0 = Math.ceil(r.w) + 1, h0 = Math.ceil(r.h) + 1
      const sw = Math.max(1, Math.round(w0 / blk)), sh = Math.max(1, Math.round(h0 / blk))
      const small = mk(sw, sh), sc = small.getContext('2d') as Ctx2
      sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'medium'
      sc.drawImage(ctx.canvas as CanvasImageSource, x0, y0, w0, h0, 0, 0, sw, sh)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small as CanvasImageSource, 0, 0, sw, sh, x0, y0, w0, h0)
    } else {
      const rad = Math.max(1, mosaicBlur(b.strength) * H), pad = Math.ceil(rad * 2)
      const x0 = Math.max(0, Math.floor(r.x) - pad), y0 = Math.max(0, Math.floor(r.y) - pad)
      const x1 = Math.min(W, Math.ceil(r.x + r.w) + pad), y1 = Math.min(H, Math.ceil(r.y + r.h) + pad)
      if (x1 > x0 && y1 > y0) {
        const tmp = mk(x1 - x0, y1 - y0), tc = tmp.getContext('2d') as Ctx2
        tc.drawImage(ctx.canvas as CanvasImageSource, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
        ctx.filter = `blur(${rad.toFixed(2)}px)`
        ctx.drawImage(tmp as CanvasImageSource, x0, y0)
      }
    }
    ctx.restore()
  }
}
