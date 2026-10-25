// Dilin Studio · Slides — jobs from the local MCP (tools/agent-mcp.mjs) on the open slides page:
//   read ⇒ the page list (page, page_id, kind, layout, component count), plus one page's components when `page` is given
//          (canvas 1000×562.5 logical px, origin top-left) — the same reading the website's slides_list_components gives;
//   run  ⇒ a list of component / page operations, all or none — parseComponentOp + applyComponentOp, the same engine the
//          website's slides_add_component / slides_update_component / slides_set_component_frame / slides_add_page … use.
//   The page then saves and reloads, so each call shows on screen.
// Pure (tests call it directly) — no DOM, no store.
import { applyComponentOp, COMPONENT_OP_ERROR_TEXT, parseComponentOp, type ComponentOpError } from './deck-components'
import { ensureDeckPagePids, exceedsPageCapAfter, type DeckDataV2 } from './deck-edit'
import { pageComponents } from './kit/components/derive'
import { layoutChoices } from './kit/registry'
import type { SlidesDoc } from './format'

export type SlidesAgentReply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }
export type SlidesAgentOut = { reply: SlidesAgentReply; next?: SlidesDoc }

export const SLIDES_OPS_MAX = 80
export const SLIDES_OP_KINDS = ['component_add', 'component_update', 'component_frame', 'component_order', 'component_delete', 'component_group', 'component_ungroup', 'animation_set', 'animation_order', 'page_add', 'page_update', 'page_move', 'page_set_layout', 'page_restore_layout', 'transition_all', 'toc_rebuild'] as const

const fail = (error: string, message: string): SlidesAgentOut => ({ reply: { ok: false, error, message } })
const localeOf = (deck: DeckDataV2) => (deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW') as 'zh-CN' | 'zh-TW'

function pageList(deck: DeckDataV2) {
  const lang = localeOf(deck)
  return deck.pages.map((p, i) => ({ page: i + 1, page_index: i, page_id: p.pid, kind: p.draft.type, layout: p.layoutId, components: pageComponents(p, i, lang).length }))
}

export function slidesAgentJob(doc: SlidesDoc, job: { kind?: unknown; page?: unknown; ops?: unknown }): SlidesAgentOut {
  const deck = ensureDeckPagePids(doc.deck)
  if (job.kind === 'read') {
    const out: Record<string, unknown> = {
      name: doc.name,
      canvas: { width: 1000, height: 562.5, unit: 'logical px', origin: 'top-left', rotate: 'degrees, clockwise, around the frame center', z: 'stacking order: 0 = bottom, larger = on top' },
      page_count: deck.pages.length,
      pages: pageList(deck),
    }
    if (job.page !== undefined) {
      const n = job.page
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > deck.pages.length) return fail('bad_params', `page must be 1–${deck.pages.length}`)
      const i = (n as number) - 1, p = deck.pages[i]
      out.page = {
        page: n, page_index: i, page_id: p.pid, kind: p.draft.type, layout: p.layoutId,
        layouts: layoutChoices(p.draft.type),
        ...(p.background ? { background: p.background } : {}),
        ...(p.transition ? { transition: p.transition } : {}),
        components: pageComponents(p, i, localeOf(deck)).map((c, z) => ({ ...c, z })),
        animations: p.animations ?? [],
      }
    }
    return { reply: { ok: true, result: out } }
  }
  if (job.kind !== 'run') return fail('bad_job', `unknown kind ${String(job.kind)}`)
  const ops = job.ops
  if (!Array.isArray(ops) || !ops.length || ops.length > SLIDES_OPS_MAX) return fail('bad_params', `ops must be an array of 1–${SLIDES_OPS_MAX} operations ({kind, …}; kind is one of ${SLIDES_OP_KINDS.join(', ')})`)
  let cur = deck
  const results: Array<Record<string, unknown>> = []
  for (let k = 0; k < ops.length; k++) {
    const op = parseComponentOp(ops[k])
    if (!op) return fail('bad_params', `ops[${k}] is not a valid operation (kind one of ${SLIDES_OP_KINDS.join(', ')}; pages are 0-based pageIndex). Nothing was changed.`)
    const r = applyComponentOp(cur, op)
    if (!r.ok) {
      const text = COMPONENT_OP_ERROR_TEXT[r.error as ComponentOpError] ?? r.error
      return fail('command_failed', `ops[${k}] (${op.kind}) failed: ${r.error} — ${text}${r.field ? ` (${r.field})` : ''}. Nothing was changed (all operations apply together or not at all).`)
    }
    cur = r.deck
    results.push({ op: op.kind, ...(r.componentId ? { component_id: r.componentId } : {}), ...(r.childIds ? { child_ids: r.childIds } : {}), ...(typeof r.targetPageIndex === 'number' ? { page: r.targetPageIndex + 1 } : {}) })
  }
  if (exceedsPageCapAfter(deck, cur)) return fail('command_failed', 'the deck would have too many pages. Nothing was changed.')
  const changed = JSON.stringify(cur) !== JSON.stringify(doc.deck)
  return { reply: { ok: true, result: { changed, results } }, ...(changed ? { next: { ...doc, deck: cur } } : {}) }
}
