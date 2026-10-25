// Markdown → self-contained HTML for exports (Word, HTML file, PDF): no node views, inline styles only.
// Same line grammar as markdown.ts; directives render as styled spans / asides, [[toc]] as a static list,
// $$ … $$ as readable source, links (incl. cards) as plain anchors. Image/video tags are passed through with
// event handlers and script URLs removed; <audio> becomes a '🔊 name' paragraph (exports cannot play it).
// Hosts add their own line types through ExportHtmlOpts.lineToHtml.

function attrEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function sanitizeMediaTag(tag: string): string {
  return tag
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(javascript|vbscript)\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
}

function audioFallbackParagraph(tag: string): string {
  const m = tag.match(/\bdata-name\s*=\s*"([^"]*)"/i)
  const rawName = m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : ''
  return `<p>🔊 ${attrEsc(rawName || '音频')}</p>`
}

import { applyInlineColor, calloutOpenTagEditor, SAFE_CALLOUT_NAMES, attrEscape, normalizeSingleLineCallout } from './directive'

import { applyInlineLinkExport, applyOutsideCode } from './links'
import { PAGE_BREAK_HTML, isBlankParagraphLine, isPageBreakLine } from './page-break'

function mdInlineBase(s: string): string {
  const base = s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~{2}/g, '<s>$1</s>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

  return applyOutsideCode(base, applyInlineLinkExport)
}

function mdInlineClean(s: string): string {
  return applyInlineColor(s, mdInlineBase)
}

export interface ExportHtmlOpts {

  tocTitle?: () => string

  lineToHtml?: (line: string) => string | null
}

export function mdToExportHtml(md: string, opts?: ExportHtmlOpts): string {
  if (!md.trim()) return ''
  md = normalizeSingleLineCallout(md)
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0
  let pendingColwidths: number[] | null = null

  const tocHeadings: { level: number; text: string }[] = []
  for (const ln of lines) {
    const hm = ln.trim().match(/^(#{1,4})\s+(.+)$/)
    if (hm) tocHeadings.push({ level: hm[1].length, text: hm[2].trim() })
  }
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) { i++; continue }

    if (isBlankParagraphLine(t)) { out.push('<p></p>'); i++; continue }
    if (isPageBreakLine(t)) { out.push(PAGE_BREAK_HTML); i++; continue }
    if (/^!\[/.test(t)) {
      const m = t.match(/^!\[(.*?)\]\((.+?)\)(?:\s*\{width=(\d+)\})?/)
      if (m) { const w = m[3] ? ` width="${m[3]}"` : ''; out.push(`<img src="${attrEsc(m[2])}" alt="${attrEsc(m[1])}"${w}>`); i++; continue }
    }
    if (/^<img\s/i.test(t) || /^<video\s/i.test(t)) { out.push(sanitizeMediaTag(t)); i++; continue }
    if (/^<audio\s/i.test(t)) { out.push(audioFallbackParagraph(t)); i++; continue }
    if (opts?.lineToHtml) { const h = opts.lineToHtml(t); if (h !== null) { out.push(h); i++; continue } }
    if (/^####\s/.test(t)) { out.push(`<h4>${mdInlineClean(t.slice(5))}</h4>`); i++; continue }
    if (/^###\s/.test(t))  { out.push(`<h3>${mdInlineClean(t.slice(4))}</h3>`); i++; continue }
    if (/^##\s/.test(t))   { out.push(`<h2>${mdInlineClean(t.slice(3))}</h2>`); i++; continue }
    if (/^#\s/.test(t))    { out.push(`<h1>${mdInlineClean(t.slice(2))}</h1>`); i++; continue }
    if (/^---+$/.test(t))  { out.push('<hr>'); i++; continue }
    if (/^>\s/.test(t))    { out.push(`<blockquote><p>${mdInlineClean(t.slice(2))}</p></blockquote>`); i++; continue }
    if (/^[-*]\s/.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(`<li><p>${mdInlineClean(lines[i].trim().slice(2))}</p></li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (/^\d+\.\s/.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(`<li><p>${mdInlineClean(lines[i].trim().replace(/^\d+\.\s/, ''))}</p></li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }
    if (/^<!--colwidths:[\d,]+-->$/.test(t)) {
      pendingColwidths = t.slice(14, -3).split(',').map(Number)
      i++; continue
    }
    if (t.startsWith('|')) {
      const colwidths = pendingColwidths; pendingColwidths = null
      const rows: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim()); i++
      }
      const isSep = (s: string) => /^\|[\s\-:|]+\|/.test(s)
      const parseCells = (s: string) => s.split('|').slice(1, -1).map(c => c.trim())
      if (rows.length >= 2 && isSep(rows[1])) {
        const ths = parseCells(rows[0]).map((c, idx) => {
          const w = colwidths?.[idx]
          return w ? `<th colwidth="${w}" style="width:${w}px;min-width:${w}px">${mdInlineClean(c)}</th>`
                   : `<th>${mdInlineClean(c)}</th>`
        }).join('')
        const trs = rows.slice(2).map(r =>
          `<tr>${parseCells(r).map(c => `<td>${mdInlineClean(c)}</td>`).join('')}</tr>`
        ).join('')
        out.push(`<table><tbody><tr>${ths}</tr>${trs}</tbody></table>`)
      } else {
        rows.forEach(r => out.push(`<p>${mdInlineClean(r)}</p>`))
      }
      continue
    }
    if (t.startsWith('```')) {
      const lang = t.slice(3).trim().toLowerCase()
      i++
      const codeLines: string[] = []
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]); i++
      }
      if (i < lines.length) i++
      const raw = codeLines.join('\n')
      if (lang === 'mermaid') {
        const escaped = raw.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        out.push(`<div data-type="mermaid-block" data-content="${escaped}"></div>`)
      } else {
        const escaped2 = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        out.push(`<pre><code class="language-${lang || 'text'}">${escaped2}</code></pre>`)
      }
      continue
    }

    if (t === '[[toc]]') {
      const head = `<div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px">${opts?.tocTitle ? opts.tocTitle() : 'Contents'}</div>`
      if (tocHeadings.length === 0) {
        out.push(`<nav class="md-toc" style="border:1px solid #e5e7eb;background:#f9fafb;padding:12px;border-radius:8px;margin:12px 0">${head}</nav>`)
      } else {
        const lis = tocHeadings.map(h =>
          `<li style="margin-left:${(h.level - 1) * 16}px;list-style:none"><span style="color:#2563eb">${mdInlineClean(h.text)}</span></li>`
        ).join('')
        out.push(`<nav class="md-toc" style="border:1px solid #e5e7eb;background:#f9fafb;padding:12px;border-radius:8px;margin:12px 0">${head}<ul style="list-style:none;padding-left:0;margin:0;font-size:14px">${lis}</ul></nav>`)
      }
      i++; continue
    }

    if (t.startsWith('$$')) {
      let latex: string
      if (t.length > 4 && t.endsWith('$$')) { latex = t.slice(2, -2).trim(); i++ }
      else {
        const buf: string[] = []
        const firstRest = t.slice(2); if (firstRest.trim()) buf.push(firstRest)
        i++
        while (i < lines.length && !lines[i].includes('$$')) { buf.push(lines[i]); i++ }
        if (i < lines.length) { const before = lines[i].slice(0, lines[i].indexOf('$$')); if (before.trim()) buf.push(before); i++ }
        latex = buf.join('\n').trim()
      }
      out.push(`<div class="doc-latex-block" style="text-align:center;margin:8px 0;padding:8px;background:#f8fafc;border-radius:6px;font-family:ui-monospace,monospace;overflow-x:auto">$$ ${attrEscape(latex)} $$</div>`)
      continue
    }

    const calloutM = t.match(/^:::\s*([a-zA-Z]+)\s*$/)
    if (calloutM) {
      const tone = calloutM[1].toLowerCase()
      i++
      const inner: string[] = []
      while (i < lines.length && lines[i].trim() !== ':::') { inner.push(lines[i]); i++ }
      if (i < lines.length) i++
      const innerHtml = mdToExportHtml(inner.join('\n'), { tocTitle: opts?.tocTitle }) || '<p></p>'
      out.push(`${calloutOpenTagEditor(SAFE_CALLOUT_NAMES.has(tone) ? tone : 'note')}${innerHtml}</aside>`)
      continue
    }
    const indentM = t.match(/^\{indent:([1-8])\}(.*)/)
    if (indentM) {
      out.push(`<p data-indent="${indentM[1]}">${mdInlineClean(indentM[2])}</p>`)
      i++; continue
    }
    out.push(`<p>${mdInlineClean(t)}</p>`)
    i++
  }
  return out.join('')
}
