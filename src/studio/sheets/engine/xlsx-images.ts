// 导出 xlsx 前先把表格里的图取成位元组
//   浏览器服务端都能跑（⛔ import node 模块）：取档／转档／合成由调用方注入（服务端＝xlsx-images-node.ts：云盘直读＋safeFetch＋sharp）
//   - 每个 URL 只取一次；取不到／认不得又转不了 ⇒ 略过那张并记数（⛔ 中断导出）
//   - 下层图（plane below）每张 sheet 一张背景图：只有一张、钉在 A1 左上、大小＝原图像素 ⇒ 原图直接当背景；
//     多张或要定位／缩放 ⇒ 按本编辑器的列宽行高把各张排到一张透明画布上（数组顺序＝由底到顶）合成一张 PNG
//   - Excel 背景图只在屏幕上看得到、打印没有 ⇒ 回 below 张数给调用方提示
import { mediaKey, imagePixelSize, sniffImageMime, type XlsxMedia, type XlsxPicture, type XlsxPictureExt, type WorkbookSheet } from './xlsx-io'
import { imageLayer } from './image-layers'
import { colWidthOf, rowHeightOf } from './layout'
import { parseRef } from './formula'
import type { SheetImage } from './style'

export type ComposeLayer = { bytes: Uint8Array; x: number; y: number; w: number; h: number }
export type XlsxImageIO = {
  /** 取图位元组；拿不到 ⇒ null（别抛） */
  fetchBytes(url: string): Promise<Uint8Array | null>
  /** 不是 PNG／JPEG／GIF（webp／avif…）⇒ 转 PNG；做不到 ⇒ null */
  toPng?(bytes: Uint8Array): Promise<Uint8Array | null>
  /** 透明画布 width×height·各层依序画到 (x,y,w,h)（拉伸）⇒ PNG；做不到 ⇒ null */
  compose?(width: number, height: number, layers: ComposeLayer[]): Promise<Uint8Array | null>
}
export type XlsxImageResolve = { media: XlsxMedia; images: number; skipped: number; below: number; composed: number }

/** 合成画布边长上限（像素）——超出的部分裁掉 */
export const COMPOSE_MAX_SIDE = 8000

const EXT_OF: Record<string, XlsxPictureExt> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' }

/** 图左上角在整张表里的像素座标（本编辑器 100% 口径·列宽行高缺省同网格） */
export function imageOrigin(content: WorkbookSheet['content'], im: SheetImage): { x: number; y: number } {
  const p = parseRef(im.cell) ?? { row: 0, col: 0 }
  let x = im.ox ?? 0, y = im.oy ?? 0
  for (let c = 0; c < p.col; c++) x += colWidthOf(content.colWidths, c)
  for (let r = 0; r < p.row; r++) y += rowHeightOf(content.rowHeights, r)
  return { x, y }
}

export async function resolveXlsxImages(sheets: WorkbookSheet[], io: XlsxImageIO): Promise<XlsxImageResolve> {
  const cache = new Map<string, Promise<XlsxPicture | null>>()
  const load = (url: string) => {
    let p = cache.get(url)
    if (!p) {
      p = (async () => {
        let bytes: Uint8Array | null = null
        try { bytes = await io.fetchBytes(url) } catch { bytes = null }
        if (!bytes || !bytes.length) return null
        let mime = sniffImageMime(bytes)
        if (!mime && io.toPng) { try { bytes = await io.toPng(bytes) } catch { bytes = null } ; mime = bytes ? sniffImageMime(bytes) : null }
        return bytes && mime && EXT_OF[mime] ? { bytes, ext: EXT_OF[mime] } : null
      })()
      cache.set(url, p)
    }
    return p
  }
  const out: XlsxImageResolve = { media: { images: new Map(), backgrounds: new Map() }, images: 0, skipped: 0, below: 0, composed: 0 }
  for (let si = 0; si < sheets.length; si++) {
    const content = sheets[si].content ?? {}
    const list = (content.images ?? []) as SheetImage[]
    const below: Array<{ im: SheetImage; pic: XlsxPicture }> = []
    for (const im of list) {
      out.images++
      const pic = await load(im.url)
      if (!pic) { out.skipped++; continue }
      if (imageLayer(im) === 'below') below.push({ im, pic })
      else out.media.images!.set(mediaKey(si, im.id), pic)
    }
    if (!below.length) continue
    out.below += below.length
    const one = below.length === 1 ? below[0] : null
    const nat = one ? imagePixelSize(one.pic.bytes) : null
    if (one && one.im.cell === 'A1' && !one.im.ox && !one.im.oy && nat && nat.w === one.im.w && nat.h === one.im.h) {
      out.media.backgrounds!.set(si, one.pic)   // 原图直接当背景（Excel 平铺）
      continue
    }
    const layers: ComposeLayer[] = below.map(({ im, pic }) => ({ bytes: pic.bytes, ...imageOrigin(content, im), w: im.w, h: im.h }))
    const W = Math.min(COMPOSE_MAX_SIDE, Math.max(...layers.map(l => l.x + l.w)))
    const H = Math.min(COMPOSE_MAX_SIDE, Math.max(...layers.map(l => l.y + l.h)))
    let png: Uint8Array | null = null
    if (io.compose) { try { png = await io.compose(W, H, layers.filter(l => l.x < W && l.y < H)) } catch { png = null } }
    if (png && sniffImageMime(png) === 'image/png') { out.media.backgrounds!.set(si, { bytes: png, ext: 'png' }); out.composed++ }
    else { out.media.backgrounds!.set(si, below[below.length - 1].pic); out.skipped += below.length - 1 }   // 合成不了 ⇒ 最上面那张原样当背景·其余记略过
  }
  return out
}
