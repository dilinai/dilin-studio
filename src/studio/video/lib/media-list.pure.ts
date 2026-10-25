// 网页剪辑页·素材区的搜寻与排序（剪映素材区右上「搜索｜排序」）。
// 搜寻：档名含打的每个词（空白分开·大小写、全半形不分）；排序：加入先后／名称（数字照大小）／长度／种类（影片→图片→音频）·可反过来。
// 本档只放纯函数（题直接跑）。画法在 video-edit/page.tsx 素材格上方那排。

export const MEDIA_SORTS = ['added', 'name', 'duration', 'kind'] as const
export type MediaSort = (typeof MEDIA_SORTS)[number]
export type MediaListItem = { name: string; kind: string; duration: number }

/** 全形英数转半形·小写（搜寻比对用） */
export const foldName = (s: string) => s.normalize('NFKC').toLowerCase()
const KIND_ORDER: Record<string, number> = { video: 0, image: 1, audio: 2 }

/** 照搜寻字与排序挑出要列的（不改原阵列·同分的照加入先后） */
export function mediaListView<M extends MediaListItem>(list: readonly M[], q: string, sort: MediaSort, desc = false): M[] {
  const terms = foldName(q).split(/\s+/).filter(Boolean)
  const hit = terms.length ? list.filter((m) => { const n = foldName(m.name); return terms.every((t) => n.includes(t)) }) : [...list]
  const idx = new Map(hit.map((m, i) => [m, i]))
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const cmp = (a: M, b: M): number => {
    const d = sort === 'name' ? coll.compare(a.name, b.name)
      : sort === 'duration' ? (a.duration || 0) - (b.duration || 0)
      : sort === 'kind' ? (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
      : 0
    return d || idx.get(a)! - idx.get(b)!
  }
  const out = hit.sort(cmp)
  return desc ? out.reverse() : out
}
export const isMediaSort = (v: unknown): v is MediaSort => (MEDIA_SORTS as readonly unknown[]).includes(v)
