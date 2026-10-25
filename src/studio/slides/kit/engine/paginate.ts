/**
 * slide-kit engine · 超容量自动分页
 *
 * 算法思想出处：参考 PPTist（固定切法·转述思路自研）。
 * 条目多于该页型「最大版式容量」时，按固定切法均分成多页：
 *   - 页数 = ceil(n / maxCap)，各页条目数尽量均衡（前面的页多摊 1 条）
 *   - 例：content 最大容量 4 → 6 条切 3+3、8 条切 4+4、12 条切 4+4+4
 *   - 例：contents 最大容量 10 → 12 条切 6+6
 *   - 均衡切保证「后页不出现孤条」（7 切 4+3 而非 4+3 的极端如 5 切 4+1 → 3+2）
 * 接续标记：content 拆出的第 2 页起标题加后缀（默认「（續）」·caller 按语言传入）。
 *   contents 页无标题字段·不加后缀（编号接续是版式的已知缺口）。
 * 纯函数：不改入参 draft·超界才拆·其余页型原样单元素数组返回。
 */

import type { LayoutRelation, PageDraft, PageType } from '../types'
import { listLayouts } from '../registry'
import { draftRelation, layoutItemCapacity } from './pick-layout'

/** 接续后缀默认值（繁中·陆版/英文由 composeDeck locale 映射） */
export const DEFAULT_CONT_SUFFIX = '（續）'

export type PaginateOptions = {
  /** 拆页后 later 页标题的接续后缀（默认「（續）」） */
  contSuffix?: string
}

/**
 * 该页型在 registry 里的最大条目容量（item 槽）。
 * 无条目页型（cover/transition/end）或页型无版式时返回 Infinity（= 永不拆）。
 */
export function maxItemCapacity(pageType: PageType, relation?: LayoutRelation): number {
  if (pageType !== 'contents' && pageType !== 'content') return Infinity
  // 与 pickLayout 同口径：没点名关系 ⇒ 只算不带 relation 的版式；点名了 ⇒ 再并上同关系的版式（装不下会回落到前者）
  const all = listLayouts(pageType)
  const plain = all.filter((m) => !m.relation)
  const pool = [...(plain.length > 0 ? plain : all), ...(relation ? all.filter((m) => m.relation === relation) : [])]
  const caps = pool.map((m) => (m.relation ? layoutItemCapacity(m) : m.slots.text.item))
  if (caps.length === 0) return Infinity
  return Math.max(...caps)
}

/** n 条按 maxCap 均衡切成各页条目数（如 12/4 → [4,4,4]·6/4 → [3,3]·7/4 → [4,3]） */
export function splitCounts(n: number, maxCap: number): number[] {
  // 🔴 maxCap 非有限正数防护（-）：registry 某页型最大容量
  // 若为 0/负/NaN → 原实现 pages = ceil(n/0) = Infinity 循环永不收敛（NaN 则返回
  // 空数组静默丢整页）。容量无意义时视为「不可拆」·整页原样单元素返回。
  if (!Number.isFinite(maxCap) || maxCap < 1) return [n]
  const cap = Math.floor(maxCap) // 非整容量向下取整·保证每页 ≤ maxCap
  if (n <= cap) return [n]
  const pages = Math.ceil(n / cap)
  const base = Math.floor(n / pages)
  const extra = n % pages
  const counts: number[] = []
  for (let i = 0; i < pages; i++) counts.push(i < extra ? base + 1 : base)
  return counts
}

/**
 * 单页 draft → 分页后的 draft 数组（≥1 页）。
 * 不超容量/无条目页型 → [draft] 原样返回（同一引用·零拷贝）。
 */
export function paginateDraft(draft: PageDraft, opts: PaginateOptions = {}): PageDraft[] {
  if (draft.type !== 'contents' && draft.type !== 'content') return [draft]

  const maxCap = maxItemCapacity(draft.type, draftRelation(draft))
  const n = draft.items.length
  if (n <= maxCap) return [draft]
  // 🔴 容量非有限正数 → 不拆·原样返回（NaN 时上一行比较恒 false 会漏到
  // 这里·双保险；Infinity 已被 n <= maxCap 拦住）
  if (!Number.isFinite(maxCap) || maxCap < 1) return [draft]

  const suffix = opts.contSuffix ?? DEFAULT_CONT_SUFFIX
  const counts = splitCounts(n, maxCap)
  const out: PageDraft[] = []
  let offset = 0
  counts.forEach((count, pageNo) => {
    const slice = draft.items.slice(offset, offset + count)
    offset += count
    // 🔴 spread 保留 draft 全量字段（-）：原实现只重建
    // type/items/title——S1 PageDraft 未来加副标题/备注/来源等字段（或 AI 产的
    // 中间格式带额外运行时字段）会在拆页时被静默剥掉。只覆写真正变化的键。
    if (draft.type === 'contents') {
      out.push({ ...draft, items: slice as string[] })
    } else {
      out.push({
        ...draft,
        title: pageNo === 0 ? draft.title : `${draft.title}${suffix}`,
        items: slice as Array<{ heading?: string; body: string }>,
      })
    }
  })
  return out
}
