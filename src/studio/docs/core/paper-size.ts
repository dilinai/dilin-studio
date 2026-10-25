// Paper sizes, page margins and per-document paper settings (pure constants and functions).
// Paper preference: one of six `<a4|b5|a3>-<portrait|landscape>` values; null = continuous flow (no pages).
// Settings shape: { paper, marginsMm: { top, bottom, left, right }, pageNumbers }, all lengths in mm.

export type PaperKind = 'a4' | 'b5' | 'a3'
export type PaperOrientation = 'portrait' | 'landscape'

export type DocPaperPref = `${PaperKind}-${PaperOrientation}`

export const PAPER_MM: Record<PaperKind, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  b5: { w: 176, h: 250 },
  a3: { w: 297, h: 420 },
}

export const PAGE_MARGIN_MM = { top: 25.4, bottom: 25.4, left: 31.7, right: 31.7 } as const

export const PAPER_PREFS: readonly DocPaperPref[] = [
  'a4-portrait', 'a4-landscape',
  'b5-portrait', 'b5-landscape',
  'a3-portrait', 'a3-landscape',
]

export function parsePaperPref(v: unknown): DocPaperPref | null {
  return typeof v === 'string' && (PAPER_PREFS as readonly string[]).includes(v) ? (v as DocPaperPref) : null
}

export function splitPaperPref(p: DocPaperPref): { kind: PaperKind; orientation: PaperOrientation } {
  const [kind, orientation] = p.split('-') as [PaperKind, PaperOrientation]
  return { kind, orientation }
}

export function paperPageMm(p: DocPaperPref): { widthMm: number; heightMm: number } {
  const { kind, orientation } = splitPaperPref(p)
  const { w, h } = PAPER_MM[kind]
  return orientation === 'landscape' ? { widthMm: h, heightMm: w } : { widthMm: w, heightMm: h }
}

export function paperPrintableMm(p: DocPaperPref): { widthMm: number; heightMm: number } {
  const page = paperPageMm(p)
  return {
    widthMm: page.widthMm - PAGE_MARGIN_MM.left - PAGE_MARGIN_MM.right,
    heightMm: page.heightMm - PAGE_MARGIN_MM.top - PAGE_MARGIN_MM.bottom,
  }
}

export type PaperMarginsMm = { top: number; bottom: number; left: number; right: number }
export type DocPaperSettings = { paper: DocPaperPref | null; marginsMm: PaperMarginsMm; pageNumbers: boolean }

export const DEFAULT_PAGE_NUMBERS = false

export const MARGIN_MM_MIN = 0
export const MARGIN_MM_MAX = 100

export const MIN_PRINTABLE_MM = 30

export const CSS_PX_PER_MM = 96 / 25.4

export const PAGE_GAP_PX = 24

export function defaultMarginsMm(): PaperMarginsMm {
  return { top: PAGE_MARGIN_MM.top, bottom: PAGE_MARGIN_MM.bottom, left: PAGE_MARGIN_MM.left, right: PAGE_MARGIN_MM.right }
}

export function defaultPaperSettings(paper: DocPaperPref | null = null): DocPaperSettings {
  return { paper, marginsMm: defaultMarginsMm(), pageNumbers: DEFAULT_PAGE_NUMBERS }
}

function roundMm(n: number): number { return Math.round(n * 100) / 100 }

function parseMarginsMm(v: unknown, paper: DocPaperPref | null): PaperMarginsMm | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const out: Partial<PaperMarginsMm> = {}
  for (const k of ['top', 'bottom', 'left', 'right'] as const) {
    const n = o[k]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < MARGIN_MM_MIN || n > MARGIN_MM_MAX) return null
    out[k] = roundMm(n)
  }
  const m = out as PaperMarginsMm
  const page = paperPageMm(paper ?? 'a4-portrait')
  if (page.widthMm - m.left - m.right < MIN_PRINTABLE_MM) return null
  if (page.heightMm - m.top - m.bottom < MIN_PRINTABLE_MM) return null
  return m
}

export function parsePaperSettings(v: unknown): DocPaperSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (!('paper' in o)) return null
  let paper: DocPaperPref | null
  if (o.paper === null) paper = null
  else {
    paper = parsePaperPref(o.paper)
    if (!paper) return null
  }
  return {
    paper,
    marginsMm: parseMarginsMm(o.marginsMm, paper) ?? defaultMarginsMm(),
    pageNumbers: typeof o.pageNumbers === 'boolean' ? o.pageNumbers : DEFAULT_PAGE_NUMBERS,
  }
}

export function resolvePaperSettings(paperSettings: unknown, legacyPaperPref: unknown): DocPaperSettings {
  return parsePaperSettings(paperSettings) ?? defaultPaperSettings(parsePaperPref(legacyPaperPref))
}

export function paperSettingsColumns(s: DocPaperSettings): { paper_settings: DocPaperSettings; paper_pref: DocPaperPref | null } {
  return { paper_settings: { paper: s.paper, marginsMm: { ...s.marginsMm }, pageNumbers: s.pageNumbers }, paper_pref: s.paper }
}

export type PageGeometryPx = {
  pageW: number; pageH: number
  marginTop: number; marginBottom: number; marginLeft: number; marginRight: number
  contentW: number; contentH: number
}

export function pageGeometryPx(paper: DocPaperPref, marginsMm: PaperMarginsMm): PageGeometryPx {
  const page = paperPageMm(paper)
  const k = CSS_PX_PER_MM
  const pageW = page.widthMm * k
  const pageH = page.heightMm * k
  const marginTop = marginsMm.top * k
  const marginBottom = marginsMm.bottom * k
  const marginLeft = marginsMm.left * k
  const marginRight = marginsMm.right * k
  return {
    pageW, pageH, marginTop, marginBottom, marginLeft, marginRight,
    contentW: pageW - marginLeft - marginRight,
    contentH: pageH - marginTop - marginBottom,
  }
}

export function paperSettingsKey(s: DocPaperSettings): string {
  const m = s.marginsMm
  return `${s.paper ?? 'off'}|${m.top},${m.bottom},${m.left},${m.right}|${s.pageNumbers ? 1 : 0}`
}
