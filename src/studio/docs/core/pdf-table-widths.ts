// ══════════════════════════════════════════════════════════════════
// PDF 导出·表格列宽归一
//
// 病因两层（真图＋读 pdf-render.ts）：
//   ① 编辑器（Tiptap）把用户拖出来的列宽以**像素**输出：`<col style="width: 140px">` 与单元格 `colwidth="140" style="width:140px;min-width:140px"`。
//      PDF 模板 `table { width:100%; table-layout:fixed }`——固定布局下各列像素和 > 页宽 ⇒ 表格整体超页·右侧被裁（编辑器里有横向卷动看不出）。
//   ② 单元格没写「长串可折行」⇒ 备案号这类无空格长数字不折行·溢出压到右邻格。
// 治法（纯字符串处理·只动 PDF 这一路·编辑器/Word 导出不碰）：
//   ① 每张表按「第一行单元格 colwidth／colgroup col 像素」算总和·把每列像素改写成**百分比**（比例保真·总宽＝页宽）。
// 没写宽的列按已知列**均值**占位进总和。表标签自身 width/min-width 像素一并剥掉改 100%。`min-width:Npx` 内联一并去掉（否则仍撑开）。
//   ② 模板 CSS 加 `overflow-wrap:anywhere; word-break:break-word` 与 `min-width:0`（见 pdf-render.ts）。
// 纯函数·无 DOM·服务端 renderPdf 在 inlineR2ImagesInHtml 之后调。
// ══════════════════════════════════════════════════════════════════

/** 编辑区内容宽假设（px）·与 ai-scribe 写作助理提示词「假設編輯區總寬約 860px」同一口径·只在无宽列兜底时用 */
const EDITOR_CONTENT_WIDTH_PX = 860

const TABLE_RE = /<table\b[\s\S]*?<\/table>/gi
const COLGROUP_RE = /<colgroup\b[\s\S]*?<\/colgroup>/i
const COL_RE = /<col\b([^>]*)>/gi
const FIRST_ROW_RE = /<tr\b[\s\S]*?<\/tr>/i
const CELL_RE = /<(th|td)\b([^>]*)>/gi
const PX_IN_STYLE_RE = /(?:^|;)\s*(?:min-)?width\s*:\s*(\d+(?:\.\d+)?)px\s*(?=;|$)/gi

function readPx(attrs: string): number | null {
  const cw = /\bcolwidth\s*=\s*"?(\d+(?:\.\d+)?)"?/i.exec(attrs)
  if (cw) return Number(cw[1])
  const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs)
  if (st) {
    const m = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(st[1])
    if (m) return Number(m[1])
  }
  return null
}

/** 把 attrs 里 style 的 `width:Npx` / `min-width:Npx` 换成 `width:P%`（无 style 时新增）。 */
function rewriteWidth(attrs: string, pct: number): string {
  const p = `${Math.round(pct * 100) / 100}%`
  const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs)
  if (!st) return `${attrs} style="width:${p}"`
  let css = st[1].replace(PX_IN_STYLE_RE, '')
  css = css.replace(/^\s*;+\s*|\s*;+\s*$/g, '').replace(/;\s*;+/g, ';')
  css = css ? `${css};width:${p}` : `width:${p}`
  return attrs.replace(st[0], `style="${css}"`)
}

/** 表标签：去 width/min-width 像素·写 width:100%（其余 style 保留）。 */
function stripTableWidth(attrs: string): string {
  const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs)
  if (!st) return `${attrs} style="width:100%"`
  let css = st[1].replace(PX_IN_STYLE_RE, '').replace(/(?:^|;)\s*width\s*:\s*[^;]+(?=;|$)/gi, '')
  css = css.replace(/^\s*;+\s*|\s*;+\s*$/g, '').replace(/;\s*;+/g, ';')
  css = css ? `${css};width:100%` : 'width:100%'
  return attrs.replace(st[0], `style="${css}"`)
}

/**
 * 栏宽算法单一真相源：
 * 每栏的像素宽（没写宽＝null）⇒ 每栏占版心的百分比（总和 100）。
 * · 全没写宽 ⇒ 平分（固定布局均分·与两边 CSS 同）。
 * · 部分写宽 ⇒ 没写宽的栏平分「编辑区宽 860 − 已写宽和」；已写宽和 ≥ 860 ⇒ 按已写宽的均值占位（v3 口径·见下方注释）。
 */
export function fillTableColumnWidths(widths: (number | null)[], colCount = widths.length): number[] | null {
  const known = widths.filter((w): w is number => typeof w === 'number' && w > 0)
  if (known.length === 0 || colCount <= 0) return null
  const knownSum = known.reduce((a, b) => a + b, 0)
  const avg = knownSum / known.length
  const unknownCount = colCount - known.length
  const remaining = EDITOR_CONTENT_WIDTH_PX - knownSum
  const fillPx = unknownCount > 0 && remaining > 0 ? remaining / unknownCount : avg
  const filled: number[] = []
  for (let i = 0; i < colCount; i++) {
    const w = widths[i]
    filled.push(typeof w === 'number' && w > 0 ? w : fillPx)
  }
  return filled
}

export function tableColumnPercents(widths: (number | null)[]): number[] {
  const n = widths.length
  if (n === 0) return []
  const filled = fillTableColumnWidths(widths, n)
  if (!filled) return Array.from({ length: n }, () => Math.round((100 / n) * 100) / 100)
  const total = filled.reduce((a, b) => a + b, 0)
  return filled.map(px => Math.round((px / total) * 100 * 100) / 100)
}

function normalizeOneTable(table: string): string {
  // 列宽来源：优先 colgroup（Tiptap 真输出）·退而取第一行单元格 colwidth/width。两者都无 ⇒ 只剥表级像素宽·列不动（固定布局均分）。
  const cg = COLGROUP_RE.exec(table)
  let widths: (number | null)[] = []
  if (cg) {
    for (const m of cg[0].matchAll(COL_RE)) widths.push(readPx(m[1]))
  }
  const firstRow = FIRST_ROW_RE.exec(table)
  let rowWidths: (number | null)[] = []
  if (firstRow) for (const m of firstRow[0].matchAll(CELL_RE)) rowWidths.push(readPx(m[2]))
  if (widths.length === 0 || widths.every(w => w === null)) widths = rowWidths
  const known = widths.filter((w): w is number => typeof w === 'number' && w > 0)
  // v2：表标签自身的 width/min-width 像素（Tiptap renderHTML 真输出 `<table style="width:1000px">`
  //   或 `min-width:1000px`）会盖过模板 width:100% ⇒ 表整体仍超页·右栏被裁。不论有无列宽都先剥掉·改 width:100%。
  let out = table.replace(/^<table\b([^>]*)>/i, (whole, attrs: string) => `<table ${stripTableWidth(attrs).trim()}>`)
  if (known.length === 0) return out
  // v2：无宽列不能因「已知列和＝100%」被挤成零宽——无宽列按已知列**均值**占位·一起进总和·
  //   每列都得到 >0 的百分比（编辑器里无宽列本就按剩余空间显示·纸上给它一份均值是最接近的保真）。
  const colCount = Math.max(widths.length, rowWidths.length)
  // v3：编辑器 `width:100%;table-layout:fixed` 下·无宽列显示的是
  //   【编辑区剩余空间】不是均值——两列表只拖第 1 列到 300px·画面是 300 : 560·均值法给 300 : 300 ⇒ 中线回正中。
  //   正门＝客户端把画面读数补齐（table-col-widths.ts）·这里是老客户端／别的调用方没补时的兜底：无宽列平分「编辑区宽－已知和」；
  // 已知和已 ≥ 编辑区宽（表本就横向卷动）⇒ 剩余为 0·退回均值。
  //   （算法本体搬到上方 fillTableColumnWidths·纸张分页视图同用一份）
  const filled = fillTableColumnWidths(widths, colCount)!
  const total = filled.reduce((a, b) => a + b, 0)
  const pctOf = (px: number) => (px / total) * 100

  if (cg) {
    let i = 0
    const newCg = cg[0].replace(COL_RE, (whole, attrs: string) => {
      const px = filled[i++]
      return typeof px === 'number' && px > 0 ? `<col ${rewriteWidth(attrs, pctOf(px)).trim()}>` : whole
    })
    out = out.replace(cg[0], newCg)
  }
  // 所有行的单元格：去 px 宽/最小宽·第一行按比例写百分比（固定布局只认第一行）·其余行只去 px。
  let rowIdx = 0
  out = out.replace(/<tr\b[\s\S]*?<\/tr>/gi, (tr) => {
    let c = 0
    const r = tr.replace(CELL_RE, (whole, tag: string, attrs: string) => {
      const idx = c++
      const px = rowIdx === 0 ? filled[idx] : null
      let a = attrs.replace(/\s*\bcolwidth\s*=\s*"?\d+(?:\.\d+)?"?/i, '')
      if (rowIdx === 0 && typeof px === 'number' && px > 0) a = rewriteWidth(a, pctOf(px))
      else {
        const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(a)
        if (st) {
          let css = st[1].replace(PX_IN_STYLE_RE, '').replace(/^\s*;+\s*|\s*;+\s*$/g, '').replace(/;\s*;+/g, ';')
          a = css ? a.replace(st[0], `style="${css}"`) : a.replace(st[0], '').replace(/\s{2,}/g, ' ')
        }
      }
      a = a.replace(/\s+$/, '')
      return a.trim() ? `<${tag} ${a.trim()}>` : `<${tag}>`
    })
    rowIdx++
    return r
  })
  return out
}

/** 供 renderPdf：把 HTML 里每张表的像素列宽归一成百分比（总和＝100%），并去掉撑开用的 min-width。非表格内容一字不动。 */
export function normalizePdfTableWidths(html: string): string {
  if (!html || !/<table\b/i.test(html)) return html
  return html.replace(TABLE_RE, (t) => normalizeOneTable(t))
}

// ══════════════════════════════════════════════════════════════════
// 表头行 ⇒ <thead>
//   Tiptap 把表头行（全是 th）放在 <tbody> 第一行 ⇒ Chromium 列印时它只是普通一行：会孤留页底、跨页也不重复。
//   包进 <thead> ⇒ Chromium 跨页每页重复表头；配合模板 `tr { break-inside: avoid }`，表头放得下而第一行放不下时整个表头跟着第一行走
//   （Chromium 列印：tbody 形态表头孤留、thead＋avoid 形态随行）。纸张分页视图照同一规则（paginate.ts 表头随行＋row.repeat）。
//   只动「第一行格子全是 th」的表；已有 <thead> 的不动；表外内容一字不动。
// ══════════════════════════════════════════════════════════════════
export function promoteHeaderRowToThead(html: string): string {
  if (!html || !/<table\b/i.test(html)) return html
  return html.replace(TABLE_RE, (table) => {
    if (/<thead\b/i.test(table)) return table
    const m = /^([\s\S]*?<tbody\b[^>]*>)\s*(<tr\b[\s\S]*?<\/tr>)/i.exec(table)
    if (!m) return table
    const row = m[2]
    const cells = row.match(/<(th|td)\b/gi) || []
    if (cells.length === 0 || cells.some(c => c.toLowerCase() !== '<th')) return table
    // 只剩表头一行（没有表体）⇒ 不包（包了 tbody 变空·没必要）
    const rest = table.slice(m[0].length)
    if (!/<tr\b/i.test(rest)) return table
    const beforeTbody = m[1].replace(/<tbody\b[^>]*>$/i, '')
    const tbodyOpen = /<tbody\b[^>]*>$/i.exec(m[1])![0]
    return `${beforeTbody}<thead>${row}</thead>${tbodyOpen}${rest}`
  })
}
