// Table column widths. Tiptap only stores a colwidth for columns the user dragged, so before saving or
// exporting the editor HTML the widths actually shown on screen are read back and written into the first
// row (`colwidth` attributes), which tiptapHtmlToMd turns into a <!--colwidths:…--> marker.

const TABLE_RE = /<table\b[\s\S]*?<\/table>/gi
const COLGROUP_RE = /<colgroup\b[\s\S]*?<\/colgroup>/i
const FIRST_ROW_RE = /<tr\b[\s\S]*?<\/tr>/i
const CELL_RE = /<(th|td)\b([^>]*)>/gi

function cellKnownPx(attrs: string): number | null {
  const cw = /\bcolwidth\s*=\s*"?(\d+(?:\.\d+)?)"?/i.exec(attrs)
  if (cw) return Number(cw[1])
  const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs)
  if (st) {
    const m = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(st[1])
    if (m) return Number(m[1])
  }
  return null
}

export function firstRowKnownWidths(table: string): (number | null)[] | null {
  const fr = FIRST_ROW_RE.exec(table)
  if (!fr) return null
  const out: (number | null)[] = []
  for (const m of fr[0].matchAll(CELL_RE)) {
    const span = /\bcolspan\s*=\s*"?(\d+)"?/i.exec(m[2])
    if (span && Number(span[1]) > 1) return null
    out.push(cellKnownPx(m[2]))
  }
  return out
}

export function writeTableColWidthsIntoHtml(html: string, widthsPerTable: (number[] | null)[]): string {
  if (!html || !/<table\b/i.test(html)) return html
  let i = 0
  return html.replace(TABLE_RE, (table) => {
    const widths = widthsPerTable[i++]
    if (!widths || widths.length === 0) return table
    const known = firstRowKnownWidths(table)
    if (!known || known.length !== widths.length) return table
    const knownCount = known.filter((w) => typeof w === 'number' && w > 0).length
    if (knownCount === 0 || knownCount === known.length) return table
    if (widths.some((w) => !(w > 0))) return table
    const fr = FIRST_ROW_RE.exec(table)
    if (!fr) return table
    let c = 0
    const newRow = fr[0].replace(CELL_RE, (_whole, tag: string, attrs: string) => {
      const w = widths[c++]
      let a = attrs.replace(/\s*\bcolwidth\s*=\s*"?\d+(?:\.\d+)?"?/i, '')
      const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(a)
      const rest = st
        ? st[1].replace(/(?:^|;)\s*(?:min-)?width\s*:\s*[^;]+(?=;|$)/gi, '').replace(/^\s*;+\s*|\s*;+\s*$/g, '').replace(/;\s*;+/g, ';')
        : ''
      const css = `${rest ? `${rest};` : ''}width:${w}px;min-width:${w}px`
      a = st ? a.replace(st[0], `style="${css}"`) : `${a} style="${css}"`
      return `<${tag} colwidth="${w}" ${a.trim()}>`
    })

    let out = table.replace(fr[0], () => newRow)
    const cg = `<colgroup>${widths.map((w) => `<col style="width: ${w}px">`).join('')}</colgroup>`
    out = COLGROUP_RE.test(out) ? out.replace(COLGROUP_RE, () => cg) : out.replace(/^(<table\b[^>]*>)/i, (m) => `${m}${cg}`)
    return out
  })
}

export function readLiveTableColWidths(editorDom: HTMLElement | null | undefined): (number[] | null)[] {
  if (!editorDom || typeof window === 'undefined') return []
  return Array.from(editorDom.querySelectorAll('table')).map((tbl) => {
    const row = tbl.querySelector('tr')
    if (!row) return null
    const cells = Array.from(row.children).filter((c) => c.tagName === 'TH' || c.tagName === 'TD')
    if (!cells.length) return null
    if (cells.some((c) => Number(c.getAttribute('colspan') || 1) > 1)) return null
    const widths = cells.map((c) => Math.round(c.getBoundingClientRect().width))
    return widths.every((w) => w > 0) ? widths : null
  })
}

export function editorHtmlWithLiveColWidths(editor: { getHTML(): string; view: { dom: HTMLElement } }): string {
  const html = editor.getHTML()
  if (!/<table\b/i.test(html)) return html

  if (typeof editor.view.dom.closest === 'function' && editor.view.dom.closest('.doc-paged')) return html
  const live = readLiveTableColWidths(editor.view.dom)
  const n = (html.match(TABLE_RE) || []).length
  if (!live.length || live.length !== n) return html
  return writeTableColWidthsIntoHtml(html, live)
}