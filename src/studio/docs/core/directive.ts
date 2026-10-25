// Rich-text directives inside the markdown body (pure string helpers, no DOM / React / KaTeX; usable on a server).
//   inline :color[text]{color=red}  :bg[text]{color=#fde68a}  :box[text]{color=#94a3b8}  :font[text]{family=<font id>}
//   blocks :::tone … :::   $$ … $$   [[toc]]
// Values are whitelisted (SAFE_COLOR_RE / font catalog ids / SAFE_CALLOUT_NAMES); anything else renders as plain text.
// Labels use CommonMark backslash escapes. Inline directives are swapped for private-use placeholders while the
// rest of the line is escaped/formatted, then put back as <span data-*> (the placeholder is chosen so it never
// occurs in the input).

import { fontStack, isFontId } from '../../shared/fonts/catalog'

export const SAFE_COLOR_RE = /^([a-z][a-z0-9]{1,32}|#[0-9a-f]{3,8})$/i
export const SAFE_CALLOUT_NAMES = new Set([
  'tip', 'warn', 'warning', 'note', 'info', 'danger', 'caution', 'important', 'success',
])

export const CALLOUT_TONE_CLASS: Record<string, string> = {
  tip:       'border-emerald-400 bg-emerald-50/70 text-emerald-900',
  success:   'border-emerald-400 bg-emerald-50/70 text-emerald-900',
  info:      'border-sky-400 bg-sky-50/70 text-sky-900',
  note:      'border-slate-400 bg-slate-50/70 text-slate-800',
  warn:      'border-amber-400 bg-amber-50/70 text-amber-900',
  warning:   'border-amber-400 bg-amber-50/70 text-amber-900',
  caution:   'border-orange-400 bg-orange-50/70 text-orange-900',
  danger:    'border-rose-400 bg-rose-50/70 text-rose-900',
  important: 'border-violet-400 bg-violet-50/70 text-violet-900',
}
const CALLOUT_BASE_CLASS = 'callout my-3 p-3 rounded-lg border-l-4'

export function calloutClassName(tone: string): string {
  return `${CALLOUT_BASE_CLASS} callout-${tone} ${CALLOUT_TONE_CLASS[tone] || CALLOUT_TONE_CLASS.note}`
}

export function attrEscape(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeDirectiveLabel(text: string): string {

  return text.replace(/[!-/:-@[-`{-~]/g, (m) => '\\' + m)
}
export function unescapeDirectiveLabel(text: string): string {

  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

export function buildColorDirective(color: string, text: string): string {
  return `:color[${escapeDirectiveLabel(text)}]{color=${color}}`
}

export type RichType = 'color' | 'bg' | 'box' | 'font'
export const RICH_TYPES: RichType[] = ['color', 'bg', 'box', 'font']

export const RICH_DIRECTIVE_RE = /:(color|bg|box|font)\[((?:\\.|[^\]\\])*)\]\{([^}]*)\}/g

export function richDataAttr(type: RichType): string {
  return type === 'color' ? 'data-color' : type === 'bg' ? 'data-bg' : type === 'box' ? 'data-box' : 'data-font'
}

export function richStyle(type: RichType, value: string): string {
  if (type === 'font') { const st = fontStack(value); return st ? `font-family:${st}` : '' }
  if (type === 'bg')  return `background-color:${value};border-radius:2px;padding:0 1px`
  if (type === 'box') return `border:1px solid ${value};border-radius:2px;padding:0 2px`
  return `color:${value}`
}

export function isRichValueSafe(type: RichType, value: string): boolean {
  return type === 'font' ? isFontId(value) : SAFE_COLOR_RE.test(value)
}

export function buildRichDirective(type: RichType, value: string, text: string): string {
  return `:${type}[${escapeDirectiveLabel(text)}]{${type === 'font' ? 'family' : 'color'}=${value}}`
}

export function parseRichDirective(type: RichType, bracket: string, brace: string): { value: string; text: string } {
  if (type !== 'font') { const r = parseColorDirective(bracket, brace); return { value: r.color, text: r.text } }
  const eq = brace.match(/^\s*family\s*=\s*(.+?)\s*$/)
  return { value: eq ? eq[1].trim() : '', text: unescapeDirectiveLabel(bracket) }
}

export const COLOR_DIRECTIVE_RE = /:color\[((?:\\.|[^\]\\])*)\]\{([^}]*)\}/g

export function parseColorDirective(bracket: string, brace: string): { color: string; text: string } {
  const eq = brace.match(/^\s*color\s*=\s*(.+?)\s*$/)
  if (eq) {

    return { color: eq[1].trim(), text: unescapeDirectiveLabel(bracket) }
  }

  const bare = brace.trim()
  if (bare) return { color: bracket.trim(), text: unescapeDirectiveLabel(bare) }
  return { color: '', text: unescapeDirectiveLabel(bracket) }
}

export function isWholeColorDirective(text: string): boolean {
  return new RegExp(`^\\s*(?:${COLOR_DIRECTIVE_RE.source})\\s*$`).test(text)
}

const SENTINEL_CANDIDATE_FIRST = 0xE000
const SENTINEL_CANDIDATE_LAST = 0xF8FF

export function applyInlineColor(s: string, baseClean: (x: string) => string): string {
  if (!s.includes(':color[') && !s.includes(':bg[') && !s.includes(':box[') && !s.includes(':font[')) return baseClean(s)
  let sentinel = ''
  for (let cp = SENTINEL_CANDIDATE_FIRST; cp <= SENTINEL_CANDIDATE_LAST; cp++) {
    const c = String.fromCharCode(cp)
    if (!s.includes(c)) { sentinel = c; break }
  }
  if (!sentinel) {

    return baseClean(s)
  }
  const spans: string[] = []
  const re = new RegExp(RICH_DIRECTIVE_RE.source, 'g')
  const withMarks = s.replace(re, (_full, type: string, bracket: string, brace: string) => {
    const t = type as RichType
    const { value, text } = parseRichDirective(t, bracket, brace)
    const innerHtml = baseClean(text)
    const span = (value && isRichValueSafe(t, value))
      ? `<span ${richDataAttr(t)}="${attrEscape(value)}" style="${richStyle(t, value)}">${innerHtml}</span>`
      : innerHtml
    spans.push(span)
    return `${sentinel}${spans.length - 1}${sentinel}`
  })
  const cleaned = baseClean(withMarks)
  return cleaned.replace(new RegExp(`${sentinel}(\\d+)${sentinel}`, 'g'), (_m, i: string) => spans[Number(i)] ?? '')
}

const STRIP_DIRECTIVE_MIN_ROUNDS = 20
export function stripDirectiveMarkup(text: string): string {
  if (!text) return text
  let prev = text
  const maxRounds = Math.max(STRIP_DIRECTIVE_MIN_ROUNDS, prev.length)
  for (let i = 0; i < maxRounds; i++) {
    const next = prev.replace(new RegExp(RICH_DIRECTIVE_RE.source, 'g'), (_full, type: string, bracket: string, brace: string) => parseRichDirective(type as RichType, bracket, brace).text)
    if (next === prev) break
    prev = next
  }
  return prev
}

export function stripTitleWithFallback(raw: string, fallback: string = '未命名文件'): string {
  const stripped = stripDirectiveMarkup(raw).trim()
  return stripped || fallback
}

export function resolveAgentTitleInput(rawTitle: unknown): { titleProvided: boolean; title: string | undefined } {
  const titleProvided = typeof rawTitle === 'string' && rawTitle.trim() !== ''
  const title = titleProvided ? stripTitleWithFallback((rawTitle as string).trim()) : undefined
  return { titleProvided, title }
}

export function calloutOpenTagEditor(tone: string): string {
  return `<aside data-callout="${attrEscape(tone)}" class="${calloutClassName(tone)}">`
}
export function latexDivEditor(latex: string): string {
  return `<div data-latex="${attrEscape(latex)}"></div>`
}
export function tocDivEditor(): string {
  return `<div data-toc="true"></div>`
}

const SINGLE_LINE_CALLOUT_RE = /^:::([a-zA-Z]+)[ \t]+(.+?)(?:[ \t]*:::)?[ \t]*$/
export function normalizeSingleLineCallout(md: string): string {
  if (!md || md.indexOf(':::') === -1) return md
  const lines = md.split('\n')
  let inFence = false
  let changed = false
  const out: string[] = []
  for (const line of lines) {
    const fenceM = line.match(/^\s*(```|~~~)/)
    if (fenceM) { inFence = !inFence; out.push(line); continue }
    if (inFence) { out.push(line); continue }
    const m = line.match(SINGLE_LINE_CALLOUT_RE)
    if (!m) { out.push(line); continue }
    const tone = m[1].toLowerCase()
    if (!SAFE_CALLOUT_NAMES.has(tone)) { out.push(line); continue }

    const content = m[2].replace(/[ \t]*:::[ \t]*$/, '').trimEnd()
    if (!content) { out.push(line); continue }
    out.push(`:::${tone}`, content, ':::')
    changed = true
  }
  return changed ? out.join('\n') : md
}