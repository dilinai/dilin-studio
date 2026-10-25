// Document markers for an empty paragraph (`&nbsp;` on its own line) and a page break
// (`<!--pagebreak-->` on its own line). HTML forms: <p></p> and <div data-page-break="true"></div>.

export const BLANK_PARAGRAPH_MD = '&nbsp;'
export const PAGE_BREAK_MD = '<!--pagebreak-->'
export const PAGE_BREAK_ATTR = 'data-page-break'
export const PAGE_BREAK_HTML = `<div ${PAGE_BREAK_ATTR}="true"></div>`
export const PAGE_BREAK_NODE_NAME = 'pageBreak'

export function isBlankParagraphLine(t: string): boolean {
  return t === BLANK_PARAGRAPH_MD
}

export function isPageBreakLine(t: string): boolean {
  return /^<!--\s*pagebreak\s*-->$/i.test(t)
}

export function isPageBreakEl(el: Element): boolean {
  return el.tagName.toLowerCase() === 'div' && el.hasAttribute(PAGE_BREAK_ATTR)
}
