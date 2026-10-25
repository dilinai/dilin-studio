// AI 编辑保护罩落下那刻没存进去的稿（旧整页 HTML 一整份／元件版逐笔）：罩掀开后「套回／捨棄」条的纯函数。
export type SlidesFlushOp =
  | { kind: 'edit_slots'; pageIndex: number; pageId?: string; slots: unknown }
  | { kind: 'edit_page_html'; pageIndex: number; pageId?: string; html: string }
  | { kind: 'rename'; title: string }
  | { kind: string; [k: string]: unknown }

export type SlidesFlushDraft = { id: string; html?: string; title?: string; ops: SlidesFlushOp[]; stamp?: string | null; rev?: number | null; title0?: string; textOnly?: boolean; extraText?: string }

export function combineSlidesDrafts(prev: SlidesFlushDraft | null, next: SlidesFlushDraft): SlidesFlushDraft {
  if (!prev || prev.id !== next.id) return next
  const both = !!prev.html && !!next.html
  const { replay, leftover } = splitReplayOps(prev.ops, { revNow: next.rev ?? null, rev0: prev.rev, titleNow: next.title0 ?? '', title0: prev.title0 })
  return {
    ...next,
    ops: [...replay, ...next.ops],
    html: next.html ?? prev.html,
    textOnly: both || prev.textOnly || next.textOnly,
    extraText: [prev.extraText, leftover.length ? slidesDraftText({ ops: leftover }) : undefined, both ? slidesDraftText({ ops: [], html: prev.html }) : undefined].filter(Boolean).join('\n') || undefined,
  }
}

export type SlidesRestoreMode = 'overwrite' | 'replay' | 'text'

export function slidesRestoreMode(d: Pick<SlidesFlushDraft, 'html' | 'ops' | 'textOnly'>, now: { isV2: boolean; isV2Marked: boolean }): SlidesRestoreMode {
  if (d.textOnly) return 'text'
  if (d.ops.length > 0) return now.isV2 ? 'replay' : 'text'
  if (typeof d.html === 'string' && d.html) return !now.isV2 && !now.isV2Marked ? 'overwrite' : 'text'
  return 'text'
}

export function splitReplayOps<T extends { kind: string }>(ops: T[], at: { revNow: number | null; rev0: number | null | undefined; titleNow: string; title0: string | undefined }): { replay: T[]; leftover: T[] } {
  const replay: T[] = [], leftover: T[] = []
  for (const op of ops) {
    const ok = op.kind === 'edit_slots' ? true
      : op.kind === 'rename' ? at.title0 !== undefined && at.titleNow === at.title0
      : op.kind === 'edit_page_html' ? at.rev0 !== undefined && at.revNow === at.rev0
      : false
    ;(ok ? replay : leftover).push(op)
  }
  return { replay, leftover }
}

export function isFlushableSlidesOp(op: { kind: string }): boolean {
  return op.kind === 'edit_slots' || op.kind === 'edit_page_html' || op.kind === 'rename'
}

const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
function collect(v: unknown, out: string[]) {
  if (typeof v === 'string') { const s = v.trim(); if (s) out.push(s); return }
  if (Array.isArray(v)) { for (const x of v) collect(x, out); return }
  if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) collect(x, out)
}

export function slidesDraftText(d: Pick<SlidesFlushDraft, 'html' | 'title' | 'ops' | 'extraText'>): string {
  const out: string[] = []
  if (d.extraText) out.push(d.extraText)
  for (const op of d.ops) {
    if (op.kind === 'rename' && typeof op.title === 'string') out.push(op.title)
    else if (op.kind === 'edit_slots') collect((op as { slots?: unknown }).slots, out)
    else if (op.kind === 'edit_page_html' && typeof op.html === 'string') { const s = strip(op.html); if (s) out.push(s) }
  }
  if (!d.ops.length && typeof d.html === 'string' && d.html) { const s = strip(d.html); if (s) out.push(s) }
  return out.join('\n')
}

export function finishSlidesRestore(prev: SlidesFlushDraft | null, r: SlidesFlushDraft, res: { applied: Set<SlidesFlushOp>; htmlApplied: boolean; staleOps: Set<SlidesFlushOp>; staleHtml: boolean }): SlidesFlushDraft | null {
  if (!prev || prev.id !== r.id) return prev
  const sameHtml = prev.html === r.html
  const keep = (d: SlidesFlushDraft) => (d.ops.length || d.html || d.extraText ? d : null)
  const ops = prev.ops.filter(o => !res.applied.has(o))
  const html = res.htmlApplied && sameHtml ? undefined : prev.html
  if (prev === r) return keep({ ...prev, ops, html, textOnly: prev.textOnly || res.staleHtml || res.staleOps.size > 0 })
  const staleHtmlHere = res.staleHtml && sameHtml
  const staleText = [res.staleOps.size ? slidesDraftText({ ops: prev.ops.filter(o => res.staleOps.has(o)) }) : '', staleHtmlHere ? slidesDraftText({ ops: [], html: prev.html }) : ''].filter(Boolean).join('\n')
  return keep({ ...prev, ops: ops.filter(o => !res.staleOps.has(o)), html: staleHtmlHere ? undefined : html, extraText: [prev.extraText, staleText].filter(Boolean).join('\n') || undefined })
}
