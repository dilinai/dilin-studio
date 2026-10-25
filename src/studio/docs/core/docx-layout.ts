// Word (.docx) layout constants and conversions, matched to the document editor's CSS
// (body 15px / line-height 1.75; h1–h4 sizes and spacing; fixed-layout tables with striped rows).
// 1 CSS px = 1/96 in = 15 twips. Pure constants and functions, usable in the browser and on a server.

import { convertMillimetersToTwip } from 'docx'

export const TWIPS_PER_PX = 15
const PX_PER_MM = 96 / 25.4

export function docxBodyFont(isCn: boolean): string {
  return isCn ? 'Noto Sans SC' : 'Noto Sans TC'
}

const BODY_PX = 15
const pxToHalfPt = (px: number) => Math.round(px * 0.75 * 2)
const pxToTw = (px: number) => Math.round(px * TWIPS_PER_PX)

export const BODY_COLOR = '1F2329'
export const BODY_SIZE = pxToHalfPt(BODY_PX)
export const BODY_LINE = pxToTw(BODY_PX * 1.75)
export const BODY_AFTER = pxToTw(BODY_PX * 0.25)

type HeadingSpec = { size: number; line: number; before: number; after: number }

const HEADING_CSS: Record<1 | 2 | 3 | 4, [number, number, number, number]> = {
  1: [1.87, 1.3, 1.8, 0.5],
  2: [1.6, 1.35, 1.6, 0.4],
  3: [1.33, 1.4, 1.4, 0.35],
  4: [1.07, 1.4, 1.2, 0.3],
}
export function headingSpec(level: 1 | 2 | 3 | 4): HeadingSpec {
  const [em, lh, mt, mb] = HEADING_CSS[level]
  const px = BODY_PX * em
  return {
    size: pxToHalfPt(px),
    line: pxToTw(px * lh),

    before: Math.max(0, pxToTw(px * mt) - BODY_AFTER),
    after: pxToTw(px * mb),
  }
}

const TABLE_FONT_PX = BODY_PX * 0.9
export const TABLE_TEXT_STYLE_ID = 'DilinTableText'
export const TABLE_SIZE = pxToHalfPt(TABLE_FONT_PX)
export const TABLE_LINE = pxToTw(TABLE_FONT_PX * 1.75)
export const TABLE_PARA_SPACE = pxToTw(TABLE_FONT_PX * 0.25)
export const TABLE_CELL_MARGIN = {
  top: pxToTw(TABLE_FONT_PX * 0.35), bottom: pxToTw(TABLE_FONT_PX * 0.35),
  left: pxToTw(TABLE_FONT_PX * 0.75), right: pxToTw(TABLE_FONT_PX * 0.75),
}
export const TABLE_BORDER_COLOR = 'DEE0E3'
export const TABLE_STRIPE_FILL = 'FAFAFA'

export function parseColwidthsComment(line: string): number[] | null {
  const m = line.trim().match(/^<!--colwidths:([\d,]+)-->$/)
  if (!m) return null
  const ws = m[1].split(',').filter(Boolean).map(Number)
  return ws.length && ws.every(w => Number.isFinite(w) && w > 0) ? ws : null
}

export function docxColumnWidths(colwidthsPx: readonly (number | null | undefined)[] | null | undefined, cols: number, contentTwips: number): number[] {
  const n = Math.max(1, cols)
  const px = colwidthsPx && colwidthsPx.length === n && colwidthsPx.every(w => typeof w === 'number' && Number.isFinite(w) && w > 0)
    ? (colwidthsPx as number[]) : null
  if (!px) {
    const each = Math.floor(contentTwips / n)
    return Array.from({ length: n }, () => Math.max(1, each))
  }
  const tw = px.map(w => w * TWIPS_PER_PX)
  const total = tw.reduce((a, b) => a + b, 0)
  const scale = total > contentTwips ? contentTwips / total : 1
  return tw.map(w => Math.max(1, Math.floor(w * scale)))
}

export function contentBoxPx(printable: { widthMm: number; heightMm: number }): { width: number; height: number } {
  return { width: Math.floor(printable.widthMm * PX_PER_MM), height: Math.floor(printable.heightMm * PX_PER_MM) }
}

export function docxImageSize(natural: { width: number; height: number }, requestedWidthPx: number | null | undefined, box: { width: number; height: number }): { width: number; height: number } {
  const nw = natural.width > 0 ? natural.width : 400
  const nh = natural.height > 0 ? natural.height : 300
  let w = requestedWidthPx && requestedWidthPx > 0 ? requestedWidthPx : box.width
  w = Math.min(w, box.width)
  let h = w * nh / nw
  if (h > box.height) { w = w * box.height / h; h = box.height }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
}

export function parseWidthPx(v: string | null | undefined): number | null {
  if (!v) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 && n <= 20000 ? n : null
}
export const IMAGE_SPACING = { before: pxToTw(8), after: pxToTw(8) }

export function docxStyles(isCn: boolean) {
  const font = docxBodyFont(isCn)
  const heading = (level: 1 | 2 | 3 | 4) => {
    const s = headingSpec(level)
    return {
      run: { font, size: s.size, bold: true, color: BODY_COLOR },
      paragraph: { spacing: { before: s.before, after: s.after, line: s.line, lineRule: 'atLeast' as const }, outlineLevel: level - 1, keepNext: true },
    }
  }
  return {
    default: {
      document: {
        run: { font, size: BODY_SIZE, color: BODY_COLOR },
        paragraph: { spacing: { before: 0, after: BODY_AFTER, line: BODY_LINE, lineRule: 'atLeast' as const } },
      },
      heading1: heading(1),
      heading2: heading(2),
      heading3: heading(3),
      heading4: heading(4),
    },
    paragraphStyles: [{
      id: TABLE_TEXT_STYLE_ID, name: 'Dilin Table Text', basedOn: 'Normal', quickFormat: false,
      run: { size: TABLE_SIZE },

      paragraph: { spacing: { before: TABLE_PARA_SPACE, after: TABLE_PARA_SPACE, line: TABLE_LINE, lineRule: 'atLeast' as const } },
    }],
  }
}

export function docxPageMargin(m: { top: number; bottom: number; left: number; right: number }) {
  return {
    top: convertMillimetersToTwip(m.top), bottom: convertMillimetersToTwip(m.bottom),
    left: convertMillimetersToTwip(m.left), right: convertMillimetersToTwip(m.right),
  }
}
