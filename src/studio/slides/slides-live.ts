// 编辑中别人（角色）改了同一份：轮询比乐观戳、手上有没存的字就压成草稿出选边条（套用最新版／保留我的）的纯函数。
export const SLIDES_LIVE_POLL_MS = 3000

export type SlidesLiveVerdict = 'none' | 'reload' | 'prompt'

export function slidesLiveVerdict(i: {
  remote: number | null
  local: number | null
  hasDraft: boolean
  focused?: { componentId: string; boxText: string } | null
  remoteDeck?: unknown
}): SlidesLiveVerdict {
  if (i.remote === null || i.local === null || i.remote <= i.local) return 'none'
  if (i.hasDraft) return 'prompt'
  if (i.focused) {
    const remoteText = componentTextIn(i.remoteDeck, i.focused.componentId)
    if (remoteText !== null && remoteText !== i.focused.boxText) return 'prompt'
  }
  return 'reload'
}

type LooseParagraph = { runs?: { text?: unknown }[] }
export function paragraphsText(paragraphs: readonly LooseParagraph[] | undefined | null): string {
  return (paragraphs ?? []).map((p) => (p?.runs ?? []).map((r) => (typeof r?.text === 'string' ? r.text : '')).join('')).join('\n')
}

export function componentTextIn(deck: unknown, componentId: string): string | null {
  const pages = (deck as { pages?: unknown } | null)?.pages
  if (!Array.isArray(pages)) return null
  for (const pg of pages) {
    const comps = (pg as { components?: unknown } | null)?.components
    if (!Array.isArray(comps)) continue
    for (const c of comps as { id?: unknown; type?: unknown; paragraphs?: LooseParagraph[]; text?: { paragraphs?: LooseParagraph[] } }[]) {
      if (!c || c.id !== componentId) continue
      if (c.type === 'text' && Array.isArray(c.paragraphs)) return paragraphsText(c.paragraphs)
      if (c.type === 'shape' && Array.isArray(c.text?.paragraphs)) return paragraphsText(c.text!.paragraphs)
      return null
    }
  }
  return null
}

export type HeldDraft<Op> = { seq: number; op: Op }

export function holdDraft<Op>(held: readonly HeldDraft<Op>[], d: HeldDraft<Op>): HeldDraft<Op>[] {
  if (held.some(h => h.seq === d.seq)) return [...held]
  return [...held, d].sort((a, b) => a.seq - b.seq)
}

export function deckWithDrafts<D, Op>(
  deck: D | null,
  held: readonly HeldDraft<Op>[],
  typing: Op | null,
  apply: (d: D, op: Op) => { ok: true; deck: D } | { ok: false },
): D | null {
  if (deck === null) return null
  let d: D = deck
  for (const h of held) { const r = apply(d, h.op); if (r.ok) d = r.deck }
  if (typing) { const r = apply(d, typing); if (r.ok) d = r.deck }
  return d
}

export function shouldHoldAfterFailure(i: { epochAtSend: number; epochNow: number; docAtSend: string | null; docNow: string | null }): boolean {
  return i.epochAtSend !== i.epochNow && !!i.docAtSend && i.docAtSend === i.docNow
}
