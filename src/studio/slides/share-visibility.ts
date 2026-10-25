// 简报公开设定的几档（私有／仅链接／公开）与写入前的检查（简体站不出公开档）。
export type SlidesVisibility = 'private' | 'unlisted' | 'public'

export const SLIDES_LINK_READABLE: readonly SlidesVisibility[] = ['unlisted', 'public']

export function slidesShareOptions(cn: boolean): SlidesVisibility[] {
  return cn ? ['private', 'unlisted'] : ['private', 'unlisted', 'public']
}

export function isSlidesVisibility(v: unknown): v is SlidesVisibility {
  return v === 'private' || v === 'unlisted' || v === 'public'
}

export function checkSlidesVisibilityWrite(
  v: unknown,
  cn: boolean,
): { kind: 'skip' } | { kind: 'reject' } | { kind: 'set'; value: SlidesVisibility } {
  if (!isSlidesVisibility(v)) return { kind: 'skip' }
  if (cn && v === 'public') return { kind: 'reject' }
  return { kind: 'set', value: v }
}
