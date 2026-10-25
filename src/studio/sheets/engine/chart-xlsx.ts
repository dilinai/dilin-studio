// 表格图表 ⇒ xlsx 原生图表
//   纯函数·浏览器服务端共用（xlsx-io buildXlsxBytes 调它）：每张图表＝ xl/charts/chartN.xml（c:chartSpace）＋
//   该 sheet drawing 里一个 twoCellAnchor graphicFrame（跟浮图同一个 drawingN.xml·排在图片之后＝在图片之上）＋ drawing rels 一条。
//   五型都写原生：column／bar ⇒ c:barChart barDir col／bar·line ⇒ c:lineChart·pie ⇒ c:pieChart·doughnut ⇒ c:doughnutChart（没有退图片的型）。
//   系列引用 '表名'!$B$2:$B$9＋numCache／strCache（Excel 不重算也有图）·颜色写 c:spPr solidFill（圆饼／甜甜圈每扇区 c:dPt）·标题写 c:title。
//   照 ECMA-376 Part 1 §21.2（DrawingML Charts）元素顺序手写；没抄任何库。
//   ⛔ 本档不 import ./xlsx-io（它 import 本档·免得绕圈）：数字格式码换算由调用方传进来。

import { indexToCol, type SheetContent } from './formula'
import type { NumFmt, Rect } from './style'
import { colWidthOf, rowHeightOf } from './layout'
import { chartData, contentReader, sanitizeCharts, colorAt, effectiveTitle, effectiveLegend, isPieLike, shownSeries, type SheetChart, type ChartData } from './chart'

const EMU = 9525
const MAX_ROW = 999998, MAX_COL = 18277
// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const esc = (s: string) => s.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
export const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
export const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

/** 'Sheet 1' ⇒ "'Sheet 1'"（一律加引号·单引号双写） */
export const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`
/** 矩形 ⇒ 绝对引用 $B$2:$B$9（单格 $B$2） */
export function absRef(r: Rect): string {
  const a = `$${indexToCol(r.c0)}$${r.r0 + 1}`
  return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:$${indexToCol(r.c1)}$${r.r1 + 1}`
}
const hex = (c: string) => c.replace('#', '').toUpperCase()
const solid = (c: string) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`
const numStr = (v: number) => (Number.isFinite(v) ? String(v) : '0')

/** 锚格＋像素偏移 ⇒ Excel 锚点（偏移超出该格往右／下走到真落点·同 xlsx-io pxAnchor 口径） */
export function chartMarker(content: SheetContent, cell: string, ox: number, oy: number): { col: number; colOff: number; row: number; rowOff: number } {
  const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(cell)
  let col = 0, row = 0
  if (m) { row = Number(m[2]) - 1; col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1 }
  let x = Math.max(0, ox), y = Math.max(0, oy)
  for (let w = colWidthOf(content.colWidths, col); x >= w && col < MAX_COL; w = colWidthOf(content.colWidths, col)) { x -= w; col++ }
  for (let h = rowHeightOf(content.rowHeights, row); y >= h && row < MAX_ROW; h = rowHeightOf(content.rowHeights, row)) { y -= h; row++ }
  return { col, colOff: Math.round(x * EMU), row, rowOff: Math.round(y * EMU) }
}
const marker = (tag: string, a: { col: number; colOff: number; row: number; rowOff: number }) =>
  `<xdr:${tag}><xdr:col>${a.col}</xdr:col><xdr:colOff>${a.colOff}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${a.rowOff}</xdr:rowOff></xdr:${tag}>`

const strPts = (texts: string[]) => `<c:ptCount val="${texts.length}"/>${texts.map((t, i) => `<c:pt idx="${i}"><c:v>${esc(t)}</c:v></c:pt>`).join('')}`
const strCache = (texts: string[]) => `<c:strCache>${strPts(texts)}</c:strCache>`
function numCache(values: (number | null)[], code: string): string {
  return `<c:numCache><c:formatCode>${esc(code)}</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${numStr(v)}</c:v></c:pt>`)).join('') + `</c:numCache>`
}
const dLbls = (on: boolean) => on
  ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
  : ''
const txPr = (sz: number, bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="zh-TW"/></a:p></c:txPr>`

/**
 * 一张图表 ⇒ chartN.xml 全文。sheetName＝导出档里的工作表名（已 safeSheetName 过）；codeOf＝数字格式 ⇒ Excel 格式码（xlsx-io numFmtToCode）
 * 资料由调用方读好（d）——同一份 chartData（网页画的就是这份）。
 */
export function chartSpaceXml(ch: SheetChart, d: ChartData | null, sheetName: string, codeOf: (nf: NumFmt | undefined) => string | null = () => null): string {
  const q = quoteSheet(sheetName)
  const series = d ? shownSeries(ch, d) : []
  const pie = isPieLike(ch.type)
  const cats = d?.categories ?? []
  const catXml = d && cats.length
    ? (d.catRect ? `<c:cat><c:strRef><c:f>${esc(`${q}!${absRef(d.catRect)}`)}</c:f>${strCache(cats)}</c:strRef></c:cat>` : `<c:cat><c:strLit>${strPts(cats)}</c:strLit></c:cat>`)
    : ''
  const serXml = series.map((s, i) => {
    const color = colorAt(ch, i)
    const tx = s.nameCell
      ? `<c:tx><c:strRef><c:f>${esc(`${q}!${absRef({ r0: s.nameCell.r, r1: s.nameCell.r, c0: s.nameCell.c, c1: s.nameCell.c })}`)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`
      : ''
    const val = `<c:val><c:numRef><c:f>${esc(`${q}!${absRef(s.valRect)}`)}</c:f>${numCache(s.values, codeOf(s.fmt) ?? 'General')}</c:numRef></c:val>`
    const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`
    if (pie) {
      // 每扇区一色（c:dPt）＋白边（扇区之间留缝·同网页 2px）
      const dpts = cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${solid(colorAt(ch, k))}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('')
      return `<c:ser>${head}${dpts}${dLbls(!!ch.labels)}${catXml}${val}</c:ser>`
    }
    if (ch.type === 'line') {
      return `<c:ser>${head}<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr>` +
        `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${solid(color)}<a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>` +
        `${dLbls(!!ch.labels)}${catXml}${val}<c:smooth val="0"/></c:ser>`
    }
    return `<c:ser>${head}<c:spPr>${solid(color)}</c:spPr><c:invertIfNegative val="0"/>${dLbls(!!ch.labels)}${catXml}${val}</c:ser>`
  }).join('')
  const AX_CAT = 50010, AX_VAL = 50020
  let plot: string
  if (ch.type === 'pie') plot = `<c:pieChart><c:varyColors val="1"/>${serXml}<c:firstSliceAng val="0"/></c:pieChart>`
  else if (ch.type === 'doughnut') plot = `<c:doughnutChart><c:varyColors val="1"/>${serXml}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`
  else {
    const horiz = ch.type === 'bar'
    const chartEl = ch.type === 'line'
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${serXml}<c:marker val="1"/><c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:lineChart>`
      : `<c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${serXml}<c:gapWidth val="43"/><c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:barChart>`
    const lineFmt = `<c:spPr><a:ln w="9525">${solid('#BFBFBF')}</a:ln></c:spPr>`
    // 横条：类别轴反向（第一个类别在最上·同网页）·数值轴改在类别轴的最大端相交 ⇒ 刻度仍在下方
    const catAx = `<c:catAx><c:axId val="${AX_CAT}"/><c:scaling><c:orientation val="${horiz ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'l' : 'b'}"/>` +
      `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${lineFmt}${txPr(900)}` +
      `<c:crossAx val="${AX_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    const valAx = `<c:valAx><c:axId val="${AX_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'b' : 'l'}"/>` +
      `<c:majorGridlines><c:spPr><a:ln w="9525">${solid('#E5E7EB')}</a:ln></c:spPr></c:majorGridlines>` +
      `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}` +
      `<c:crossAx val="${AX_CAT}"/><c:crosses val="${horiz ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
    plot = chartEl + catAx + valAx
  }
  const title = effectiveTitle(ch, d)
  const titleXml = title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="zh-TW" sz="1400" b="1"><a:solidFill><a:srgbClr val="111827"/></a:solidFill></a:rPr><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`
  const legendXml = effectiveLegend(ch, d) ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr(900)}</c:legend>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:roundedCorners val="0"/><c:chart>${titleXml}<c:plotArea><c:layout/>${plot}</c:plotArea>${legendXml}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${solid('#FFFFFF')}<a:ln w="9525">${solid('#D9D9D9')}</a:ln></c:spPr></c:chartSpace>`
}

/** drawing 里的一个图表锚（twoCellAnchor editAs=oneCell·from＝锚格＋偏移·to＝右下角落点） */
export function chartAnchorXml(content: SheetContent, ch: SheetChart, shapeId: number, rid: string): string {
  const ox = ch.ox ?? 0, oy = ch.oy ?? 0
  const from = chartMarker(content, ch.cell, ox, oy), to = chartMarker(content, ch.cell, ox + ch.w, oy + ch.h)
  return `<xdr:twoCellAnchor editAs="oneCell">${marker('from', from)}${marker('to', to)}` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="Chart ${shapeId - 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
}

export type ChartDrawingParts = { anchors: string[]; rels: string[]; parts: Array<{ path: string; xml: string }> }
/**
 * 一张 sheet 的全部图表 ⇒ drawing 锚＋drawing rels＋chartN.xml 部件。
 *   firstChart＝全簿已用掉几个 chart 部件（新的从 +1 编）·firstRel＝drawing rels 已有几条·firstShape＝drawing 里已有几个形状（cNvPr id 接着编）
 */
export function chartDrawingParts(content: SheetContent, sheetName: string, start: { firstChart: number; firstRel: number; firstShape: number }, codeOf?: (nf: NumFmt | undefined) => string | null): ChartDrawingParts {
  const out: ChartDrawingParts = { anchors: [], rels: [], parts: [] }
  const list = sanitizeCharts(content.charts)   // 读库来的照净化闸再过一遍（坏的整张略过·⛔ 弄坏整份 xlsx）
  if (!list.length) return out
  const read = contentReader(content)
  list.forEach((ch, i) => {
    const n = start.firstChart + i + 1
    const rid = `rId${start.firstRel + i + 1}`
    out.parts.push({ path: `xl/charts/chart${n}.xml`, xml: chartSpaceXml(ch, chartData(ch, read), sheetName, codeOf) })
    out.rels.push(`<Relationship Id="${rid}" Type="${REL_CHART}" Target="../charts/chart${n}.xml"/>`)
    out.anchors.push(chartAnchorXml(content, ch, start.firstShape + i + 2, rid))
  })
  return out
}
/** [Content_Types] 每个 chart 部件一条 Override */
export const chartContentTypes = (count: number) => Array.from({ length: count }, (_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="${CHART_CT}"/>`).join('')
