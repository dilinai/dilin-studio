// Blank line after lists.
// joinMdBlocks (save side): a list block followed by any other block gets a blank line in between,
//   otherwise CommonMark readers fold the next line into the last list item.
// indentListItemContinuation: line breaks inside a list item are indented so they stay in that item.
// separateListFromFollowing (read side, for older files): a non-indented, non-list line right after a
//   list gets a blank line inserted; fenced code and $$ math blocks are left untouched.

export interface MdBlock {
  lines: string[]

  list?: boolean
}

export function isListEl(el: { tagName: string }): boolean {
  const t = el.tagName.toLowerCase()
  return t === 'ul' || t === 'ol'
}

export function joinMdBlocks(blocks: MdBlock[]): string[] {
  const out: string[] = []
  let prevList = false
  for (const b of blocks) {
    if (!b.lines.length) continue
    if (prevList && out.length) out.push('')
    for (const l of b.lines) out.push(l)
    prevList = !!b.list
  }
  return out
}

export function indentListItemContinuation(marker: string, text: string): string {
  const pad = ' '.repeat(marker.length)
  return marker + text.replace(/\n/g, '\n' + pad)
}

const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

export function separateListFromFollowing(md: string): string {
  if (!md || !md.includes('\n')) return md
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  let fence: string | null = null
  let inMath = false
  for (const line of lines) {
    if (fence) {
      out.push(line)
      const m = line.match(FENCE_RE)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.trim().slice(m[1].length).trim()) fence = null
      continue
    }
    if (inMath) {
      out.push(line)
      if (line.includes('$$')) inMath = false
      continue
    }
    const t = line.trim()
    if (!t) inList = false
    else if (LIST_ITEM_RE.test(line)) inList = true
    else if (inList && !/^[ \t]/.test(line)) {
      out.push('')
      inList = false
    }
    out.push(line)
    const fm = line.match(FENCE_RE)
    if (fm) { fence = fm[1]; continue }
    if (t.startsWith('$$') && !(t.length > 4 && t.endsWith('$$'))) inMath = true
  }
  return out.join('\n')
}
