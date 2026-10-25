// 简报显示层：把整份 HTML 里私密媒体的原网址换成可显示的网址（编辑框、放映框、画布小窗共用）。
export type SlidesWinMode = 'scroll' | 'play'

export function slidesWinToggle(mode: SlidesWinMode): SlidesWinMode {
  return mode === 'play' ? 'scroll' : 'play'
}

export function slidesWinButton(mode: SlidesWinMode): { labelKey: 'cnv_slides_play' | 'cnv_slides_stop'; icon: 'play' | 'stop' } {
  return mode === 'play' ? { labelKey: 'cnv_slides_stop', icon: 'stop' } : { labelKey: 'cnv_slides_play', icon: 'play' }
}

export function slidesMediaSrcs(html: string): string[] {
  const out = new Set<string>()
  const re = /\sdata-src="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) { if (/^https?:\/\//.test(m[1])) out.add(m[1]) }
  return [...out]
}

export function withSignedMedia(html: string, signed: Readonly<Record<string, string>>): string {
  let out = html
  for (const [u, s] of Object.entries(signed)) {
    if (s && s !== u) out = out.split(` src="${u}"`).join(` src="${s}"`)
  }
  return out
}

export function slidesDisplayHtml(html: string, srcs: readonly string[], signed: Readonly<Record<string, string>>): string {
  if (!html) return html
  let out = html
  for (const u of srcs) {
    const s = signed[u]
    if (s === undefined) out = out.split(` src="${u}"`).join(' src=""')
    else if (s !== u) out = out.split(` src="${u}"`).join(` src="${s}"`)
  }
  return out
}

export function signedShape(srcs: readonly string[], signed: Readonly<Record<string, string>>): string {
  return srcs.map(u => (signed[u] === undefined ? '-' : signed[u] === u ? 'b' : 's')).join('')
}

export function slidesPlaySource(fresh: string | null | undefined, stored: string | null | undefined): string {
  if (typeof fresh === 'string' && fresh.trim()) return fresh
  const s = typeof stored === 'string' ? stored : ''
  if (!s.trim() || s.includes('__pv_cell__')) return ''
  return /<section\b[^>]*class="[^"]*\bslide\b/i.test(s) || /class="sk-stage"/.test(s) ? s : ''
}
