// Word (.docx) export built in the browser from export-flavoured document HTML (see md-to-html.ts).
// Layout follows docx-layout.ts (same numbers as the editor CSS). Images are embedded through `loadImage`,
// which the host provides (the full editor fetches URLs with a byte cap; the guest editor reads assets/).
//
// Image budget per document: at most 40 images and 60 MB in total, 10 MB per image; images past the
// budget are skipped and a note is appended at the end, so nothing disappears silently.

import {
  Document as DocxDocument, Packer,
  Paragraph as DocxParagraph, TextRun as DocxTextRun, HeadingLevel,
  Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell,
  WidthType, ShadingType, BorderStyle, convertMillimetersToTwip, PageOrientation,
  ImageRun, AlignmentType, TableLayoutType,
} from 'docx'
import {
  docxStyles, docxColumnWidths, docxImageSize, contentBoxPx, parseWidthPx, IMAGE_SPACING,
  TABLE_TEXT_STYLE_ID, TABLE_CELL_MARGIN, TABLE_BORDER_COLOR, TABLE_STRIPE_FILL,
} from './docx-layout'
import { PAPER_MM, PAGE_MARGIN_MM, paperPrintableMm, splitPaperPref, type DocPaperPref } from './paper-size'
import { inertContainer } from './inert-dom'

/** One image source: its MIME type (checked before reading) and a bounded reader (null = over `limit` bytes). */
export interface DocxImageSource {
  type: string
  read(limit: number): Promise<Uint8Array | null>
}
/** Resolve an image URL / src; null = not available (a placeholder paragraph is written instead). */
export type DocxImageLoader = (url: string) => Promise<DocxImageSource | null>

export interface DocxBuildOptions {
  /** Export-flavoured HTML (mdToExportHtml output). */
  html: string
  paper: DocPaperPref
  /** Simplified-Chinese body font (Noto Sans SC) instead of Traditional (Noto Sans TC). */
  isCn: boolean
  loadImage: DocxImageLoader
  /** Text of the note appended when images were skipped for the budget. */
  budgetNote(skipped: number): string
  onProgress?: (done: number, total: number) => void
}

function runsFrom(el: Element, bold = false, italics = false, strike = false): DocxTextRun[] {
  const out: DocxTextRun[] = []
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ''
      if (t) out.push(new DocxTextRun({ text: t, bold: bold || undefined, italics: italics || undefined, strike: strike || undefined }))
    } else {
      const child = node as Element
      const tag = child.tagName?.toLowerCase()
      if (tag === 'code') {
        out.push(new DocxTextRun({ text: child.textContent ?? '', font: 'Courier New', size: 20 }))
      } else if (tag === 'br') {
        out.push(new DocxTextRun({ break: 1 }))
      } else {
        out.push(...runsFrom(child, bold || tag === 'strong', italics || tag === 'em', strike || tag === 's'))
      }
    }
  }
  return out
}

type ClientImgType = 'jpg' | 'png' | 'gif' | 'bmp'
const MIME_TO_IMG_TYPE: Record<string, ClientImgType> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp',
}
const CLIENT_MAX_IMG_WIDTH_PX = 500
const CLIENT_MAX_IMG_HEIGHT_PX = 700
const CLIENT_MAX_IMG_BYTES = 10 * 1024 * 1024
const CLIENT_MAX_IMAGES_PER_DOC = 40
const CLIENT_MAX_TOTAL_IMG_BYTES = 60 * 1024 * 1024

interface ImgBudget { bytesUsed: number; embedded: number; skipped: number }
const newImgBudget = (): ImgBudget => ({ bytesUsed: 0, embedded: 0, skipped: 0 })
const budgetExhausted = (b: ImgBudget) =>
  b.embedded >= CLIENT_MAX_IMAGES_PER_DOC || b.bytesUsed >= CLIENT_MAX_TOTAL_IMG_BYTES

function clientScaledDims(w: number, h: number): { width: number; height: number } {
  const wScale = w > CLIENT_MAX_IMG_WIDTH_PX ? CLIENT_MAX_IMG_WIDTH_PX / w : 1
  const hScale = h > CLIENT_MAX_IMG_HEIGHT_PX ? CLIENT_MAX_IMG_HEIGHT_PX / h : 1
  const scale = Math.min(wScale, hScale, 1)
  if (scale >= 1) return { width: w, height: h }
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

// url → image paragraph; null when the image cannot be used. editorImage = a body image (left aligned,
// width as in the editor); without it (card / video cover) the image is centred and capped at 500×700.
async function embedImageParagraph(loadImage: DocxImageLoader, url: string, budget?: ImgBudget, editorImage?: { widthPx: number | null; box: { width: number; height: number } }): Promise<DocxParagraph | null> {
  if (!url) return null
  if (budget && budgetExhausted(budget)) { budget.skipped++; return null }
  try {
    const src = await loadImage(url)
    if (!src) return null
    const contentType = (src.type || '').split(';')[0].trim().toLowerCase()
    const kind = MIME_TO_IMG_TYPE[contentType]
    if (!kind) return null
    const remaining = budget ? CLIENT_MAX_TOTAL_IMG_BYTES - budget.bytesUsed : CLIENT_MAX_IMG_BYTES
    const buf = await src.read(Math.min(CLIENT_MAX_IMG_BYTES, Math.max(0, remaining)))
    if (!buf) {
      if (budget && remaining < CLIENT_MAX_IMG_BYTES) budget.skipped++
      return null
    }
    const blob = new Blob([buf as BlobPart], { type: contentType })
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const objUrl = URL.createObjectURL(blob)
      const probe = new Image()
      probe.onload = () => { URL.revokeObjectURL(objUrl); resolve({ width: probe.naturalWidth || 400, height: probe.naturalHeight || 300 }) }
      probe.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('decode failed')) }
      probe.src = objUrl
    })
    const scaled = editorImage ? docxImageSize(dims, editorImage.widthPx, editorImage.box) : clientScaledDims(dims.width, dims.height)
    if (budget) { budget.bytesUsed += buf.byteLength; budget.embedded++ }
    return new DocxParagraph({
      alignment: editorImage ? AlignmentType.LEFT : AlignmentType.CENTER,
      spacing: editorImage ? IMAGE_SPACING : { before: 80, after: 80 },
      children: [new ImageRun({ type: kind, data: buf, transformation: scaled })],
    })
  } catch {
    return null
  }
}

export async function buildDocxBlob(opts: DocxBuildOptions): Promise<Blob> {
  const { paper, onProgress, loadImage } = opts
  const CONTENT_TWIPS = Math.floor(convertMillimetersToTwip(paperPrintableMm(paper).widthMm))
  const CONTENT_BOX = contentBoxPx(paperPrintableMm(paper))

  const div = inertContainer()
  div.innerHTML = opts.html
  div.querySelectorAll('.tableWrapper').forEach(w => {
    const tEl = w.querySelector('table'); if (tEl) w.replaceWith(tEl)
  })

  type DocChild = DocxParagraph | DocxTable
  const children: DocChild[] = []
  const imgBudget = newImgBudget()
  // progress counts top-level elements actually finished (a failing element is not counted)
  const topLevelTotal = div.children.length
  let topLevelDone = 0

  for (const node of div.childNodes) {
    if (node.nodeType !== 1) continue
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    let nodeOk = true
    try {
    if (tag === 'img') {
      const src = el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || ''
      const embedded = await embedImageParagraph(loadImage, src, imgBudget, { widthPx: parseWidthPx(el.getAttribute('width')), box: CONTENT_BOX })
      children.push(embedded ?? new DocxParagraph({
        alignment: AlignmentType.CENTER,
        children: [new DocxTextRun(alt ? `[图片: ${alt}]` : '[图片]')],
      }))
      continue
    }
    if (tag === 'video') {
      // video: cover image only; no cover → a play-symbol placeholder
      const thumb = el.getAttribute('data-thumbnail') || ''
      const embedded = thumb ? await embedImageParagraph(loadImage, thumb, imgBudget) : null
      children.push(embedded ?? new DocxParagraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 120 },
        children: [new DocxTextRun({ text: '▶', size: 56 })],
      }))
      continue
    }
    if (tag === 'h1') { children.push(new DocxParagraph({ heading: HeadingLevel.HEADING_1, children: runsFrom(el) })); continue }
    if (tag === 'h2') { children.push(new DocxParagraph({ heading: HeadingLevel.HEADING_2, children: runsFrom(el) })); continue }
    if (tag === 'h3') { children.push(new DocxParagraph({ heading: HeadingLevel.HEADING_3, children: runsFrom(el) })); continue }
    if (tag === 'h4') { children.push(new DocxParagraph({ heading: HeadingLevel.HEADING_4, children: runsFrom(el) })); continue }
    if (tag === 'hr') {
      children.push(new DocxParagraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC', space: 1 } } }))
      continue
    }
    if (tag === 'blockquote') {
      const p = el.querySelector('p')
      children.push(new DocxParagraph({ children: runsFrom(p ?? el), indent: { left: convertMillimetersToTwip(10) } }))
      continue
    }
    if (tag === 'ul') {
      for (const li of el.querySelectorAll(':scope > li')) {
        const p = (li as Element).querySelector('p')
        children.push(new DocxParagraph({
          children: [new DocxTextRun('• '), ...runsFrom(p ?? (li as Element))],
          indent: { left: convertMillimetersToTwip(8), hanging: convertMillimetersToTwip(4) },
        }))
      }
      continue
    }
    if (tag === 'ol') {
      let n = 1
      for (const li of el.querySelectorAll(':scope > li')) {
        const p = (li as Element).querySelector('p')
        children.push(new DocxParagraph({
          children: [new DocxTextRun(`${n}. `), ...runsFrom(p ?? (li as Element))],
          indent: { left: convertMillimetersToTwip(8), hanging: convertMillimetersToTwip(4) },
        }))
        n++
      }
      continue
    }
    if (tag === 'pre') {
      const code = el.querySelector('code')
      children.push(new DocxParagraph({
        children: [new DocxTextRun({ text: code?.textContent ?? el.textContent ?? '', font: 'Courier New', size: 20 })],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F5F7' },
      }))
      continue
    }
    if (tag === 'p') {
      const indent = parseInt(el.getAttribute('data-indent') ?? '0') || 0
      // link card paragraph = a single <a style="display:block…">: cover image (if any) + title only
      const cardAnchor = (el.children.length === 1 && el.firstElementChild?.tagName.toLowerCase() === 'a'
        && (el.firstElementChild.getAttribute('style') || '').includes('display:block'))
        ? el.firstElementChild
        : null
      if (cardAnchor) {
        const cardImgEl = cardAnchor.querySelector('img')
        const cardImgSrc = cardImgEl?.getAttribute('src') || ''
        const cardEmbedded = cardImgSrc ? await embedImageParagraph(loadImage, cardImgSrc, imgBudget) : null
        const titleSpan = cardAnchor.querySelector('span')
        const titleText = titleSpan?.textContent ?? cardAnchor.textContent ?? ''
        if (cardEmbedded) {
          children.push(cardEmbedded)
          children.push(new DocxParagraph({ children: [new DocxTextRun({ text: titleText, bold: true })] }))
        } else {
          children.push(new DocxParagraph({ children: [new DocxTextRun(titleText)] }))
        }
        continue
      }
      // images nested anywhere inside an ordinary paragraph become their own image paragraphs first
      for (const imgEl of Array.from(el.querySelectorAll('img'))) {
        const src = imgEl.getAttribute('src') || ''
        const alt = imgEl.getAttribute('alt') || ''
        const embedded = await embedImageParagraph(loadImage, src, imgBudget)
        children.push(embedded ?? new DocxParagraph({
          alignment: AlignmentType.CENTER,
          children: [new DocxTextRun(alt ? `[图片: ${alt}]` : '[图片]')],
        }))
      }
      children.push(new DocxParagraph({
        children: runsFrom(el),
        ...(indent > 0 ? { indent: { left: convertMillimetersToTwip(indent * 10) } } : {}),
      }))
      continue
    }
    if (tag === 'table') {
      // column widths = the editor's widths (fixed layout; scaled down to the text width; none → equal split)
      const allRows = Array.from(el.querySelectorAll('tr'))
      if (!allRows.length) continue
      const headerCells = Array.from(allRows[0].querySelectorAll('th, td'))
      const cwPx = headerCells.map(c => { const w = (c as Element).getAttribute('colwidth'); return w ? parseInt(w) : null })
      const cols = Math.max(1, ...allRows.map(r => r.querySelectorAll('th, td').length))
      const colTw = docxColumnWidths(cwPx, cols, CONTENT_TWIPS)
      const border = { style: BorderStyle.SINGLE, size: 6, color: TABLE_BORDER_COLOR }

      const docRows = allRows.map((row, ri) => {
        const cells = Array.from(row.querySelectorAll('th, td'))
        return new DocxTableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: cols }, (_, ci) => {
            const cell = cells[ci] as Element | undefined
            const isH = cell?.tagName.toLowerCase() === 'th'
            const fill = ri % 2 === 1 ? TABLE_STRIPE_FILL : null
            return new DocxTableCell({
              children: [new DocxParagraph({ style: TABLE_TEXT_STYLE_ID, children: cell ? runsFrom(cell, isH) : [] })],
              width: { size: colTw[ci], type: WidthType.DXA },
              margins: { ...TABLE_CELL_MARGIN, marginUnitType: WidthType.DXA },
              ...(fill ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill } } : {}),
            })
          }),
        })
      })

      children.push(new DocxTable({
        rows: docRows,
        layout: TableLayoutType.FIXED,
        width: { size: colTw.reduce((x, y) => x + y, 0), type: WidthType.DXA },
        columnWidths: colTw,
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      }))
      continue
    }
    } catch (err) {
      nodeOk = false
      throw err
    } finally {
      if (nodeOk) {
        topLevelDone++
        onProgress?.(topLevelDone, topLevelTotal)
      }
    }
  }

  if (imgBudget.skipped > 0) {
    children.push(new DocxParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new DocxTextRun({
        text: opts.budgetNote(imgBudget.skipped),
        italics: true, size: 20, color: '888888',
      })],
    }))
  }

  const doc = new DocxDocument({
    styles: docxStyles(opts.isCn),
    sections: [{
      properties: {
        page: {
          // docx swaps width/height itself for LANDSCAPE, so the portrait base size is passed
          size: {
            width: convertMillimetersToTwip(PAPER_MM[splitPaperPref(paper).kind].w),
            height: convertMillimetersToTwip(PAPER_MM[splitPaperPref(paper).kind].h),
            ...(splitPaperPref(paper).orientation === 'landscape' ? { orientation: PageOrientation.LANDSCAPE } : {}),
          },
          margin: {
            top: convertMillimetersToTwip(PAGE_MARGIN_MM.top), bottom: convertMillimetersToTwip(PAGE_MARGIN_MM.bottom),
            left: convertMillimetersToTwip(PAGE_MARGIN_MM.left), right: convertMillimetersToTwip(PAGE_MARGIN_MM.right),
          },
        },
      },
      children,
    }],
  })

  return Packer.toBlob(doc)
}
