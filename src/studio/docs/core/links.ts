// Markdown links (pure string helpers, no React) shared by the document editor, exports and read-only views.
// Storage shapes:
//   [href](href)                                   plain URL
//   [name](href)                                   named link
//   [name](href){mode=card|cardLarge desc=… img=… fav=…}   link card (values encodeURIComponent'ed)
// Write side must stay within what the read regex accepts: `(`, `)` and whitespace in hrefs are
// percent-encoded; `]`, `\`, `<` in labels are backslash-escaped; newlines in labels collapse to spaces.
// Link rules run after strong/em/code on already &<>-escaped text and never inside <code> spans.

export type LinkDisplayMode = 'url' | 'name' | 'card' | 'cardLarge';

export interface LinkCardMeta {
  href: string;
  displayMode: LinkDisplayMode;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}

export const MD_LINK_CARD_RE =
  /(?<!!)\[((?:\\.|[^\]\\\n<])+)\]\((https?:\/\/[^\s)]+)\)(?:\{mode=(url|name|card|cardLarge)((?:\s+(?:desc|img|fav)=[^\s}]+)*)\})?/g;

export function encodeMdHrefParens(href: string): string {
  return href.replace(/[()\s]/g, (ch) => (ch === '(' ? '%28' : ch === ')' ? '%29' : encodeURIComponent(ch)));
}

export function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function unescapeLinkLabel(s: string): string { return s.replace(/\\(.)/g, '$1'); }

export function escapeLinkLabel(s: string): string { return s.replace(/([\\[\]<])/g, '\\$1'); }

export function fullAttrEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function quotEsc(s: string): string { return s.replace(/"/g, '&quot;'); }

function parseSuffix(extras: string | undefined | null): { desc: string | null; img: string | null; fav: string | null } {
  const out = { desc: null as string | null, img: null as string | null, fav: null as string | null };
  if (!extras) return out;
  for (const m of extras.matchAll(/(desc|img|fav)=([^\s}]+)/g)) {
    try {
      const v = decodeURIComponent(m[2]);
      if (m[1] === 'desc') out.desc = v; else if (m[1] === 'img') out.img = v; else out.fav = v;
    } catch { /* malformed value: skip this field */ }
  }
  return out;
}

export function parseMdLinkMatch(m: RegExpMatchArray): LinkCardMeta {
  const label = unescapeLinkLabel(m[1]);
  const href = m[2];
  const explicit = m[3] as LinkDisplayMode | undefined;
  const { desc, img, fav } = parseSuffix(m[4]);
  return {
    href,
    displayMode: explicit ?? (label === href ? 'url' : 'name'),
    title: label === href || label === hostnameOf(href) ? null : label,
    description: desc,
    image: img,
    favicon: fav,
  };
}

export function buildMdLink(meta: LinkCardMeta): string {

  const target = encodeMdHrefParens(meta.href);
  const name = meta.title && meta.title.trim() ? meta.title.trim() : meta.href;
  if (meta.displayMode === 'url') return `[${escapeLinkLabel(target)}](${target})`;

  const label = escapeLinkLabel((name === meta.href ? hostnameOf(meta.href) : name).replace(/\s+/g, ' '));
  if (meta.displayMode === 'name') return `[${label}](${target})`;
  const parts = [`mode=${meta.displayMode}`];
  if (meta.description) parts.push(`desc=${encodeURIComponent(meta.description)}`);
  if (meta.image) parts.push(`img=${encodeURIComponent(meta.image)}`);
  if (meta.favicon) parts.push(`fav=${encodeURIComponent(meta.favicon)}`);
  return `[${label}](${target}){${parts.join(' ')}}`;
}

export function linkElToMd(el: Element): string {
  const href = el.getAttribute('href') || '';
  const text = (el.textContent || '').trim();
  if (!href) return text;
  const mode = el.getAttribute('data-display-mode') as LinkDisplayMode | null;
  const title = (el.getAttribute('data-title') || text || '').trim();
  return buildMdLink({
    href,
    displayMode: mode ?? (title && title !== href ? 'name' : 'url'),
    title: title && title !== href ? title : null,
    description: el.getAttribute('data-description'),
    image: el.getAttribute('data-image'),
    favicon: el.getAttribute('data-favicon'),
  });
}

export function applyOutsideCode(html: string, transform: (s: string) => string): string {
  return html
    .split(/(<code>[\s\S]*?<\/code>)/)
    .map((seg, i) => (i % 2 === 1 ? seg : transform(seg)))
    .join('');
}

export function applyInlineLinkCards(escaped: string): string {
  return escaped.replace(MD_LINK_CARD_RE, (_full, rawLabel: string, href: string, mode?: string, extras?: string) => {
    const label = unescapeLinkLabel(rawLabel);
    const { desc, img, fav } = parseSuffix(extras);
    const displayMode = (mode as LinkDisplayMode | undefined) ?? (label === href ? 'url' : 'name');

    const title = label === href || label === hostnameOf(href) ? '' : label;
    const attrs = [
      'data-link-card="1"',
      `href="${quotEsc(href)}"`,
      `data-display-mode="${displayMode}"`,
      title ? `data-title="${quotEsc(title)}"` : '',
      desc ? `data-description="${fullAttrEsc(desc)}"` : '',
      img ? `data-image="${fullAttrEsc(img)}"` : '',
      fav ? `data-favicon="${fullAttrEsc(fav)}"` : '',
      'target="_blank"',
      'rel="noopener noreferrer"',
    ].filter(Boolean).join(' ');
    return `<a ${attrs}>${title || href}</a>`;
  });
}

export function applyInlineLinkExport(escaped: string): string {
  return escaped.replace(MD_LINK_CARD_RE, (_full, rawLabel: string, href: string, mode?: string, extras?: string) => {
    const label = unescapeLinkLabel(rawLabel);
    const { desc, img } = parseSuffix(extras);
    const displayMode = (mode as LinkDisplayMode | undefined) ?? (label === href ? 'url' : 'name');
    const safeHref = quotEsc(href);
    if (displayMode === 'url' || displayMode === 'name') {
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;word-break:break-all">${label || href}</a>`;
    }
    const title = label === href ? hostnameOf(href) : (label || hostnameOf(href));
    const descHtml = `<span style="display:block;font-size:12px;color:#6b7280;margin-top:2px;word-break:break-all">${desc ? fullAttrEsc(desc) : href}</span>`;
    const imgHtml = displayMode === 'cardLarge' && img
      ? `<img src="${fullAttrEsc(img)}" alt="" style="display:block;width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:8px">`
      : '';
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="display:block;max-width:480px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:8px 0;text-decoration:none;color:inherit">${imgHtml}<span style="display:block;font-weight:600">${title}</span>${descHtml}</a>`;
  });
}

export type LinkCardSegment = { md: string } | { card: LinkCardMeta };

type LinkSegContexts = { code: Array<[number, number]>; container: Array<[number, number]> };

function scanLinkSegContexts(content: string): LinkSegContexts {
  const code: Array<[number, number]> = [];
  const container: Array<[number, number]> = [];
  let pos = 0;
  let fence: string | null = null;

  let directiveDepth = 0;
  let inBlockquote = false;

  let inList = false;
  let inTable = false;

  const GFM_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  const isDelimRow = (s: string) => s.includes('|') && GFM_DELIM_RE.test(s);
  const lines = content.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const start = pos;
    const end = pos + line.length;
    pos = end + 1;
    const fm = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      code.push([start, end]);

      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.slice(fm[0].length).trim() === '') fence = null;
      continue;
    }
    if (fm) { fence = fm[1]; code.push([start, end]); continue; }

    const dm = line.match(/^ {0,3}(:{3,})(.*)$/);
    if (dm) {
      container.push([start, end]);
      if (dm[2].trim() === '') { if (directiveDepth > 0) directiveDepth -= 1; }
      else directiveDepth += 1;
      inBlockquote = false;
      inList = false;
      inTable = false;
      continue;
    }

    if (/^(?: {4,}|\t)/.test(line) && !/^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(line)) { code.push([start, end]); continue; }

    for (const cm of line.matchAll(/(`+)[^`\n]*?\1/g)) {
      const ci = cm.index ?? 0;
      code.push([start + ci, start + ci + cm[0].length]);
    }
    if (line.trim() === '') { inBlockquote = false; inList = false; inTable = false; continue; }
    if (/^ {0,3}>/.test(line)) { container.push([start, end]); inBlockquote = true; continue; }

    if (/^\s*(?:[-*+]\s|\d{1,9}[.)]\s)/.test(line)) { container.push([start, end]); inList = true; inBlockquote = false; continue; }

    if (inTable) {
      if (line.includes('|')) { container.push([start, end]); continue; }
      inTable = false;
    }

    if (line.includes('|') && li + 1 < lines.length && isDelimRow(lines[li + 1])) {
      container.push([start, end]);
      inTable = true;
      inList = false;
      inBlockquote = false;
      continue;
    }
    if (/^\s*(?:>|\||#{1,6}\s)/.test(line)) { container.push([start, end]); inBlockquote = false; inList = false; continue; }

    if (directiveDepth > 0 || inBlockquote || inList) container.push([start, end]);
  }
  return { code, container };
}

function idxInRanges(ranges: Array<[number, number]>, idx: number): boolean {
  return ranges.some(([a, b]) => idx >= a && idx < b);
}

const INLINE_MARK_RES: RegExp[] = [
  /(?<![\\*])\*\*(?!\s)[\s\S]*?(?<![\s\\])\*\*/g,
  /(?<![\\*])\*(?![\s*])[\s\S]*?(?<![\s\\*])\*(?!\*)/g,
  /(?<![\\_])__(?!\s)[\s\S]*?(?<![\s\\])__/g,
  /(?<![\\_\w])_(?![\s_])[\s\S]*?(?<![\s\\_])_(?![\w_])/g,
  /(?<![\\~])~~(?!\s)[\s\S]*?(?<![\s\\])~{2}/g,
];

function paragraphBounds(content: string, idx: number, end: number): [number, number] {
  let ps = 0;
  for (const m of content.slice(0, idx).matchAll(/\n[ \t]*\n/g)) ps = (m.index ?? 0) + m[0].length;
  const after = /\n[ \t]*\n/g;
  after.lastIndex = end;
  const am = after.exec(content);
  return [ps, am ? am.index : content.length];
}

function inlineMarkStraddles(para: string, rs: number, re: number): boolean {
  for (const base of INLINE_MARK_RES) {
    base.lastIndex = 0;
    for (const m of para.matchAll(base)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if ((s < rs && e > rs) || (s < re && e > re)) return true;
    }
  }
  return false;
}

export function splitLinkCardSegments(content: string): LinkCardSegment[] {
  const segs: LinkCardSegment[] = [];
  let plain = '';
  let last = 0;
  const { code, container } = scanLinkSegContexts(content);
  const re = new RegExp(MD_LINK_CARD_RE.source, 'g');
  for (const m of content.matchAll(re)) {
    const idx = m.index ?? 0;

    if (idxInRanges(code, idx)) continue;

    const end = idx + m[0].length;
    const straddled = (() => {
      if (!m[3] || m[3] === 'url' || m[3] === 'name') return false;
      const [ps, pe] = paragraphBounds(content, idx, end);
      return inlineMarkStraddles(content.slice(ps, pe), idx - ps, end - ps);
    })();
    if (!m[3] || m[3] === 'url' || m[3] === 'name' || idxInRanges(container, idx) || straddled) {
      plain += content.slice(last, idx) + `[${m[1]}](${m[2]})`;
      last = idx + m[0].length;
      continue;
    }
    plain += content.slice(last, idx);
    if (plain) { segs.push({ md: plain }); plain = ''; }
    segs.push({ card: parseMdLinkMatch(m) });
    last = idx + m[0].length;
  }
  plain += content.slice(last);
  if (plain || segs.length === 0) segs.push({ md: plain });
  return segs;
}
