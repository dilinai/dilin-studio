// Markdown ⇄ editor HTML for the document editor (shared by the guest editor and the full editor page).
//   mdToTiptapHtml(md)    markdown → HTML the tiptap schema parses (data-* attributes keep directive sources)
//   tiptapHtmlToMd(html)  editor.getHTML() → markdown (storage form)
// Line-oriented: every top-level construct starts at the beginning of a trimmed line. Things the editor
// shows but markdown has no syntax for are stored as small markers: `{indent:N}`, `<!--colwidths:…-->`,
// `&nbsp;` (empty paragraph), `<!--pagebreak-->`, raw <img>/<video>/<audio> lines with attributes.
// Hosts can add their own block types through MdBlockHooks (tried before the built-in rules for that slot).

import {
  applyInlineColor, buildColorDirective, buildRichDirective, calloutOpenTagEditor, isWholeColorDirective,
  latexDivEditor, normalizeSingleLineCallout, SAFE_CALLOUT_NAMES, tocDivEditor,
} from './directive'
import { applyInlineLinkCards, applyOutsideCode, linkElToMd } from './links'
import { BLANK_PARAGRAPH_MD, PAGE_BREAK_HTML, PAGE_BREAK_MD, isBlankParagraphLine, isPageBreakEl, isPageBreakLine } from './page-break'
import { indentListItemContinuation, isListEl, joinMdBlocks } from './list-spacing'
import { inertContainer } from './inert-dom'

export interface MdBlockHooks {
  /** A trimmed top-level line → editor HTML, or null when the hook does not handle it. */
  lineToHtml?(line: string): string | null
  /** A top-level editor element → markdown lines, or null when the hook does not handle it. */
  elToMd?(el: Element): string[] | null
}

function mdInlineBase(s: string): string {
  const base = s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~{2}/g, '<s>$1</s>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  return applyOutsideCode(base, applyInlineLinkCards);
}

export function mdInlineClean(s: string): string {
  return applyInlineColor(s, mdInlineBase);
}

export function htmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function mdToTiptapHtml(md: string, hooks?: MdBlockHooks): string {
  if (!md.trim()) return '';
  md = normalizeSingleLineCallout(md);
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  let pendingColwidths: number[] | null = null;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    if (isBlankParagraphLine(t)) { out.push('<p></p>'); i++; continue; }
    if (isPageBreakLine(t)) { out.push(PAGE_BREAK_HTML); i++; continue; }

    if (/^!\[/.test(t)) {
      const m = t.match(/^!\[(.*?)\]\((.+?)\)(?:\s*\{width=(\d+)\})?/);
      if (m) { const w = m[3] ? ` width="${m[3]}"` : ''; out.push(`<img src="${m[2]}" alt="${m[1]}"${w}>`); i++; continue; }
    }

    if (/^<img\s/i.test(t) || /^<video\s/i.test(t) || /^<audio\s/i.test(t)) { out.push(t); i++; continue; }
    if (hooks?.lineToHtml) { const h = hooks.lineToHtml(t); if (h !== null) { out.push(h); i++; continue; } }
    if (/^####\s/.test(t)) { out.push(`<h4>${mdInlineClean(t.slice(5))}</h4>`); i++; continue; }
    if (/^###\s/.test(t))  { out.push(`<h3>${mdInlineClean(t.slice(4))}</h3>`); i++; continue; }
    if (/^##\s/.test(t))   { out.push(`<h2>${mdInlineClean(t.slice(3))}</h2>`); i++; continue; }
    if (/^#\s/.test(t))    { out.push(`<h1>${mdInlineClean(t.slice(2))}</h1>`); i++; continue; }
    if (/^---+$/.test(t))  { out.push('<hr>'); i++; continue; }
    if (/^>\s/.test(t))    { out.push(`<blockquote><p>${mdInlineClean(t.slice(2))}</p></blockquote>`); i++; continue; }
    if (/^[-*]\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(`<li><p>${mdInlineClean(lines[i].trim().slice(2))}</p></li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(`<li><p>${mdInlineClean(lines[i].trim().replace(/^\d+\.\s/, ''))}</p></li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^<!--colwidths:[\d,]+-->$/.test(t)) {
      pendingColwidths = t.slice(14, -3).split(',').map(Number);
      i++; continue;
    }
    if (t.startsWith('|')) {
      const colwidths = pendingColwidths; pendingColwidths = null;
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim()); i++;
      }
      const isSep = (s: string) => /^\|[\s\-:|]+\|/.test(s);
      const parseCells = (s: string) => s.split('|').slice(1, -1).map(c => c.trim());
      if (rows.length >= 2 && isSep(rows[1])) {
        const ths = parseCells(rows[0]).map((c, idx) => {
          const w = colwidths?.[idx];
          return w ? `<th colwidth="${w}" style="width:${w}px;min-width:${w}px">${mdInlineClean(c)}</th>`
                   : `<th>${mdInlineClean(c)}</th>`;
        }).join('');
        const trs = rows.slice(2).map(r =>
          `<tr>${parseCells(r).map(c => `<td>${mdInlineClean(c)}</td>`).join('')}</tr>`
        ).join('');
        out.push(`<table><tbody><tr>${ths}</tr>${trs}</tbody></table>`);
      } else {
        rows.forEach(r => out.push(`<p>${mdInlineClean(r)}</p>`));
      }
      continue;
    }
    if (t.startsWith('```')) {
      const lang = t.slice(3).trim().toLowerCase();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]); i++;
      }
      if (i < lines.length) i++;
      const raw = codeLines.join('\n');
      if (lang === 'mermaid') {
        const escaped = raw.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        out.push(`<div data-type="mermaid-block" data-content="${escaped}"></div>`);
      } else {
        const escaped2 = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        out.push(`<pre><code class="language-${lang || 'text'}">${escaped2}</code></pre>`);
      }
      continue;
    }

    if (t === '[[toc]]') { out.push(tocDivEditor()); i++; continue; }
    if (t.startsWith('$$')) {
      if (t.length > 4 && t.endsWith('$$')) { out.push(latexDivEditor(t.slice(2, -2).trim())); i++; continue; }
      const buf: string[] = [];
      const firstRest = t.slice(2);
      if (firstRest.trim()) buf.push(firstRest);
      i++;
      while (i < lines.length && !lines[i].includes('$$')) { buf.push(lines[i]); i++; }
      if (i < lines.length) {
        const before = lines[i].slice(0, lines[i].indexOf('$$'));
        if (before.trim()) buf.push(before);
        i++;
      }
      out.push(latexDivEditor(buf.join('\n').trim()));
      continue;
    }
    const calloutM = t.match(/^:::\s*([a-zA-Z]+)\s*$/);
    if (calloutM) {
      const tone = calloutM[1].toLowerCase();
      i++;
      const inner: string[] = [];
      while (i < lines.length && lines[i].trim() !== ':::') { inner.push(lines[i]); i++; }
      if (i < lines.length) i++;
      const innerHtml = mdToTiptapHtml(inner.join('\n'), hooks) || '<p></p>';
      out.push(`${calloutOpenTagEditor(SAFE_CALLOUT_NAMES.has(tone) ? tone : 'note')}${innerHtml}</aside>`);
      continue;
    }
    const indentM = t.match(/^\{indent:([1-8])\}(.*)/);
    if (indentM) {
      out.push(`<p data-indent="${indentM[1]}">${mdInlineClean(indentM[2])}</p>`);
      i++; continue;
    }
    out.push(`<p>${mdInlineClean(t)}</p>`);
    i++;
  }
  return out.join('');
}

export function inlineToMd(el: Element): string {
  return Array.from(el.childNodes).map(node => {
    if (node.nodeType === 3) return node.textContent ?? '';
    const child = node as Element;
    const tag = child.tagName?.toLowerCase();
    if (tag === 'strong') return `**${inlineToMd(child)}**`;
    if (tag === 'em')     return `*${inlineToMd(child)}*`;
    if (tag === 's')      return `~~${inlineToMd(child)}~~`;
    if (tag === 'code')   return `\`${child.textContent ?? ''}\``;
    if (tag === 'br')     return '\n';

    if (tag === 'a' && child.getAttribute('href')) return linkElToMd(child);

    if (tag === 'span' && child.getAttribute('data-font')) return buildRichDirective('font', child.getAttribute('data-font')!, inlineToMd(child));

    if (tag === 'span' && child.getAttribute('data-bg')) return buildRichDirective('bg', child.getAttribute('data-bg')!, inlineToMd(child));
    if (tag === 'span' && child.getAttribute('data-box')) return buildRichDirective('box', child.getAttribute('data-box')!, inlineToMd(child));
    if (tag === 'span' && child.getAttribute('data-color')) {
      const inner = inlineToMd(child);

      if (isWholeColorDirective(inner)) return inner;
      return buildColorDirective(child.getAttribute('data-color')!, inner);
    }
    return inlineToMd(child);
  }).join('');
}

export function blockElToMd(el: Element, hooks?: MdBlockHooks): string[] {
  const tag = el.tagName.toLowerCase();
  if (tag === 'h1') return [`# ${inlineToMd(el)}`];
  if (tag === 'h2') return [`## ${inlineToMd(el)}`];
  if (tag === 'h3') return [`### ${inlineToMd(el)}`];
  if (tag === 'h4') return [`#### ${inlineToMd(el)}`];
  if (tag === 'hr') return ['---'];
  if (isPageBreakEl(el)) return [PAGE_BREAK_MD];

  if (tag === 'aside' && el.getAttribute('data-callout')) {
    const tone = el.getAttribute('data-callout') || 'note';

    const inner = joinMdBlocks([
      ...Array.from(el.children).map(child => ({ lines: blockElToMd(child, hooks), list: isListEl(child) })),
      { lines: [':::'] },
    ]);
    return [`:::${tone}`, ...inner];
  }
  if (tag === 'div' && el.getAttribute('data-latex') != null) {
    return ['$$', el.getAttribute('data-latex') || '', '$$'];
  }
  if (tag === 'div' && el.getAttribute('data-toc') != null) {
    return ['[[toc]]'];
  }
  if (tag === 'blockquote') {
    const p = el.querySelector('p');
    return [`> ${p ? inlineToMd(p) : inlineToMd(el)}`];
  }
  if (tag === 'ul') {
    const out: string[] = [];
    for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
      const p = (li as Element).querySelector('p');

      out.push(indentListItemContinuation('- ', p ? inlineToMd(p) : inlineToMd(li as Element)));
    }
    return out;
  }
  if (tag === 'ol') {
    const out: string[] = [];
    let n = 1;
    for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
      const p = (li as Element).querySelector('p');
      out.push(indentListItemContinuation(`${n}. `, p ? inlineToMd(p) : inlineToMd(li as Element)));
      n++;
    }
    return out;
  }
  if (tag === 'pre') {
    const code = el.querySelector('code');
    const lang = code?.className.match(/language-(\S+)/)?.[1] || '';
    return ['```' + lang, code ? (code.textContent ?? '') : inlineToMd(el), '```'];
  }
  if (hooks?.elToMd) { const h = hooks.elToMd(el); if (h !== null) return h; }
  if (tag === 'div' && el.getAttribute('data-type') === 'mermaid-block') {
    const content = el.getAttribute('data-content') || '';
    return content.trim() ? ['```mermaid', content, '```'] : [];
  }

  const tableEl: Element | null =
    tag === 'table' ? el :
    (tag === 'div' && el.classList.contains('tableWrapper')) ? el.querySelector('table') :
    null;
  if (tableEl) {
    const out: string[] = [];
    const allRows = Array.from(tableEl.querySelectorAll('tr'));
    if (allRows.length) {
      const headerCells = Array.from(allRows[0].querySelectorAll('th, td'));
      const ths = headerCells.map(c => inlineToMd(c as Element));
      const trs = allRows.slice(1).map(tr =>
        Array.from(tr.querySelectorAll('td, th')).map(c => inlineToMd(c as Element))
      );
      if (ths.length) {

        const colwidths = headerCells.map(c => (c as Element).getAttribute('colwidth')).filter(Boolean);
        if (colwidths.length === ths.length) {
          out.push(`<!--colwidths:${colwidths.join(',')}-->`);
        }
        out.push(`| ${ths.join(' | ')} |`);
        out.push(`|${ths.map(() => '---').join('|')}|`);
        trs.forEach(row => out.push(`| ${row.join(' | ')} |`));
      }
    }
    return out;
  }
  if (tag === 'img') {
    const src = el.getAttribute('src') || '';
    const alt = el.getAttribute('alt') || '';
    const width = el.getAttribute('width');
    if (src) return [width ? `<img src="${src}" alt="${alt}" width="${width}">` : `![${alt}](${src})`];
    return [];
  }
  if (tag === 'video') {
    const src = el.getAttribute('src') || '';
    const originalSrc = el.getAttribute('data-original-src');
    const width = el.getAttribute('width');
    const ratio = el.getAttribute('data-ratio');
    const jobId = el.getAttribute('data-job-id');
    const transcoding = el.getAttribute('data-transcoding');

    const displayMode = el.getAttribute('data-display-mode');
    const vName = el.getAttribute('data-name');
    const vSize = el.getAttribute('data-size');
    const vThumb = el.getAttribute('data-thumbnail');
    if (src) {
      const attrs = [
        `src="${htmlAttr(src)}"`,
        displayMode ? `data-display-mode="${htmlAttr(displayMode)}"` : '',
        vName ? `data-name="${htmlAttr(vName)}"` : '',
        vSize ? `data-size="${htmlAttr(vSize)}"` : '',
        vThumb ? `data-thumbnail="${htmlAttr(vThumb)}"` : '',
        originalSrc ? `data-original-src="${htmlAttr(originalSrc)}"` : '',
        width ? `width="${htmlAttr(width)}"` : '',
        ratio ? `data-ratio="${htmlAttr(ratio)}"` : '',
        jobId ? `data-job-id="${htmlAttr(jobId)}"` : '',
        transcoding ? `data-transcoding="${htmlAttr(transcoding)}"` : '',
        'controls',
      ].filter(Boolean).join(' ');
      return [`<video ${attrs}></video>`];
    }
    return [];
  }
  if (tag === 'audio') {

    const src = el.getAttribute('src') || '';
    const displayMode = el.getAttribute('data-display-mode');
    const aName = el.getAttribute('data-name');
    const aSize = el.getAttribute('data-size');
    if (src) {
      const attrs = [
        `src="${htmlAttr(src)}"`,
        displayMode ? `data-display-mode="${htmlAttr(displayMode)}"` : '',
        aName ? `data-name="${htmlAttr(aName)}"` : '',
        aSize ? `data-size="${htmlAttr(aSize)}"` : '',
        'controls',
      ].filter(Boolean).join(' ');
      return [`<audio ${attrs}></audio>`];
    }
    return [];
  }
  if (tag === 'p') {
    const indent = parseInt(el.getAttribute('data-indent') || '0') || 0;
    const text = inlineToMd(el);

    return text.trim() ? [(indent > 0 ? `{indent:${indent}}` : '') + text] : [BLANK_PARAGRAPH_MD];
  }
  return [];
}

export function tiptapHtmlToMd(html: string, hooks?: MdBlockHooks): string {
  if (typeof document === 'undefined' || !html) return '';
  const div = inertContainer();
  div.innerHTML = html;

  const blocks = Array.from(div.childNodes)
    .filter(node => node.nodeType === 1)
    .map(node => ({ lines: blockElToMd(node as Element, hooks), list: isListEl(node as Element) }));
  return joinMdBlocks(blocks).join('\n');
}
