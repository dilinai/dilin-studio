// 网页剪辑页·轨道遮罩画法：预览（VideoEditPage 画成 mask-image）与汇出（export-render destination-in）都调这一支，
// 遮罩轨这一刻的文字（drawTextBody）／贴纸画进画布（跟随照 followAt·同那条轨平常的画法）·再照 matteAlpha 逐像素转成遮罩。
import { drawTextBody } from '../lib/text-draw'
import { stickerBox, stickerById, stickerPose, stickerSrc } from '../lib/sticker.pure'
import { clipAnimPose } from '../lib/clip-look.pure'
import { followAffine, followAt } from '../lib/motion-track.pure'
import { matteAlpha } from '../lib/mask-matte.pure'
import type { DrawOp, MatteOp } from '../lib/export.pure'
import type { Tracks } from '../lib/timeline.pure'

type TsOp = Extract<DrawOp, { kind: 'text' | 'sticker' }>
/** 这支只画文字／贴纸遮罩（画面层当遮罩的走汇出那支 drawMedia·预览 PlanCanvas） */
const tsOps = (m: MatteOp): TsOp[] => m.ops.filter((o): o is TsOp => o.kind === 'text' || o.kind === 'sticker')

/** 贴纸档名 ⇒ 现成的图（汇出先 await 好·预览拿快取·还没载好 ⇒ null 先不画） */
export const matteStickerFile = (id: string): string | null => { const it = stickerById(id); return it ? stickerSrc(it) : null }

/** 把遮罩画进 c（W×H·画面座标）并转成「白＋alpha」：画完 c 就是那张遮罩 */
export function drawMatteOps(c: CanvasRenderingContext2D, m: MatteOp, W: number, H: number, t: number, tracks: Tracks, img: (file: string) => CanvasImageSource | null): void {
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'
  c.clearRect(0, 0, W, H)
  for (const op of tsOps(m)) {
    c.save()
    const fo = followAt(tracks, op.clip, t, W / H)
    if (fo) c.transform(...followAffine(fo, W, H))
    if (op.kind === 'text') drawTextBody(c, op.body, W, H, op.at)
    else {
      const it = stickerById(op.body.sticker), im = it ? img(stickerSrc(it)) : null
      if (it && im) {
        const b = stickerBox(it, op.body.size), bw = b.w * H, bh = b.h * H
        const sp = stickerPose(op.body, clipAnimPose(op.clip, t))
        c.globalAlpha = sp.alpha
        c.translate(op.body.x * W + sp.dx * H, op.body.y * H + sp.dy * H)
        if (sp.rot) c.rotate((sp.rot * Math.PI) / 180)
        if (sp.sx !== 1 || sp.sy !== 1) c.scale(sp.sx, sp.sy)
        c.drawImage(im, -bw / 2, -bh / 2, bw, bh)
      }
    }
    c.restore()
  }
  const px = c.getImageData(0, 0, W, H)
  matteAlpha(px.data, m.mode, m.invert)
  c.putImageData(px, 0, 0)
}

// ── 预览用：画成一张图当外框的 mask-image（长边 640·同一支 drawMatteOps）──
let pvCv: HTMLCanvasElement | null = null
const pvImgs = new Map<string, HTMLImageElement>()
const pvImg = (f: string): CanvasImageSource | null => {
  let im = pvImgs.get(f)
  if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.src = f; pvImgs.set(f, im) }
  return im.complete && im.naturalWidth > 0 ? im : null
}
const pvUrls = new Map<string, string>()
/** 预览：遮罩图的 CSS url（同样的输入快取着·免得每格重画） */
export function matteCssUrl(m: MatteOp, t: number, tracks: Tracks, ratio: number): string {
  const W = 640, H = Math.max(1, Math.round(W / (ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9)))
  const key = JSON.stringify([m.mode, m.invert, W, H, tsOps(m).map((o) => [o.kind, o.clip.id, o.body, o.kind === 'text' ? o.at : null]), tsOps(m).some((o) => o.clip.follow) ? t : 0, tsOps(m).filter((o): o is Extract<TsOp, { kind: 'sticker' }> => o.kind === 'sticker').map((o) => { const f = matteStickerFile(o.body.sticker); return f ? !!pvImg(f) : false })])
  const hit = pvUrls.get(key)
  if (hit) return hit
  if (!pvCv) pvCv = document.createElement('canvas')
  if (pvCv.width !== W || pvCv.height !== H) { pvCv.width = W; pvCv.height = H }
  drawMatteOps(pvCv.getContext('2d', { willReadFrequently: true })!, m, W, H, t, tracks, pvImg)
  const url = `url("${pvCv.toDataURL('image/png')}")`
  if (pvUrls.size > 60) pvUrls.clear()
  pvUrls.set(key, url)
  return url
}
