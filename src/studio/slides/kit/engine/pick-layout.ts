/**
 * slide-kit engine · 选版式
 *
 * 算法思想出处：参考 PPTist（转述思路·代码自研）。
 * 规则：
 *   1. 按页型筛候选（registry.listLayouts(pageType)）。
 *   2. 有条目的页型（contents/content）数「item 槽容量」：
 *      优先选 容量 ≥ 条目数 且最接近 的一组；全都不够选容量最大的一组
 *      （正常流程 paginate 先跑·不会走到「全不够」·此处兜底防直接调用）。
 *   3. content 1 条特判：优先「标题+正文」型版式（item 容量恰为 1 的版式·如 content-focus）。
 *      —— 与「最接近容量」规则天然同解·显式写出以钉死语义。
 *   4. transition 按章轮换（partNo 序·PPTist「过渡页轮换=章节节奏一致」思路）·
 *      起始偏移吃 deckId·跨 deck 有变化。
 *   5. 同分（同容量多张）伪随机挑一张：种子 = deckId + 页序 + 页型 ——
 *      同 deck 重渲稳定（DoD 3 全等断言）·跨 deck 有变化·同 deck 内不同页也有变化。
 *
 * 纯函数·同输入必同输出·不 throw（无候选返 null）。
 */

import type { LayoutMeta, LayoutRelation, PageDraft } from '../types'
import { isLayoutRelation } from '../types'
import { layoutItemCapacity, listLayouts } from '../registry'

/* ------------------------------------------------------------------ */
/* 确定性伪随机（种子来自字符串·mulberry32 + FNV-1a）                     */
/* ------------------------------------------------------------------ */

/** FNV-1a 32 位字符串散列（种子生成·非加密用途） */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32：种子确定 → 序列确定（[0,1) 均匀） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* 选版式                                                              */
/* ------------------------------------------------------------------ */

export type PickLayoutOptions = {
  /** 同 deck 重渲稳定的根种子（composeDeck 注入·缺省空串仍确定性） */
  deckId?: string
  /** 页在 deck 内的序号（同 deck 内不同页的同分挑选互不相同） */
  pageIndex?: number
}

/** 有条目页型的条目数；无条目页型返回 0 */
function itemCount(draft: PageDraft): number {
  if (draft.type === 'contents' || draft.type === 'content') return draft.items.length
  return 0
}

/** 版式对条目的容量（item 槽·满键 Record 保证是 number） */
function itemCapacity(meta: LayoutMeta): number {
  return meta.slots.text.item
}

/** 版式能装几条 draft 条目（定义在 registry·这里转出给引擎调用方） */
export { layoutItemCapacity }

/** draft 带的关系（只 content 页有·认不得的值当没给） */
export function draftRelation(draft: PageDraft): LayoutRelation | undefined {
  if (draft.type !== 'content') return undefined
  const r = (draft as { relation?: unknown }).relation
  return isLayoutRelation(r) ? r : undefined
}

/**
 * 选版式主入口。无候选（未知页型/registry 空）返 null 不 throw。
 *
 * 条目关系：
 *   - draft 带 relation ⇒ 先在「meta.relation 相同」的版式里按条目数挑（容量 ≥ 条目数里最小的一组·同分伪随机）；
 *     同关系的版式一张都装不下（或注册表还没有这种关系的版式）⇒ 回落到下面的现行逻辑（⛔ 硬塞装不下的版式丢字）；
 *   - draft 没带 relation ⇒ 完全照现行逻辑，且只在不带 relation 的版式里挑（带关系的版式只给点名关系的页用）。
 */
export function pickLayout(draft: PageDraft, opts: PickLayoutOptions = {}): LayoutMeta | null {
  const all = listLayouts(draft.type)
  if (all.length === 0) return null

  const deckId = opts.deckId ?? ''
  const pageIndex = opts.pageIndex ?? 0

  const relation = draftRelation(draft)
  if (relation) {
    const need = itemCount(draft)
    const fitting = all.filter((m) => m.relation === relation && layoutItemCapacity(m) >= need)
    if (fitting.length > 0) {
      const minCap = Math.min(...fitting.map(layoutItemCapacity))
      return pickFromTie(fitting.filter((m) => layoutItemCapacity(m) === minCap), deckId, pageIndex, `${draft.type}:${relation}`)
    }
  }

  // 现行逻辑：只看不带 relation 的版式（注册表里一张都没有＝退回全部·防御）
  const plain = all.filter((m) => !m.relation)
  const candidates = plain.length > 0 ? plain : all

  /* transition：按章轮换（id 排序钉死轮换序·偏移吃 deckId） */
  if (draft.type === 'transition') {
    const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const partNo = typeof draft.partNo === 'number' && draft.partNo >= 0 ? Math.floor(draft.partNo) : 0
    const offset = hashSeed(`${deckId}#transition`) % sorted.length
    return sorted[(offset + partNo) % sorted.length]
  }

  const need = itemCount(draft)
  let tieGroup: LayoutMeta[]

  if (draft.type === 'contents' || draft.type === 'content') {
    /* content 1 条特判：标题+正文版式（item 容量恰 1）优先 */
    if (draft.type === 'content' && need === 1) {
      const focus = candidates.filter((m) => itemCapacity(m) === 1)
      if (focus.length > 0) {
        return pickFromTie(focus, deckId, pageIndex, draft.type)
      }
    }
    const fitting = candidates.filter((m) => itemCapacity(m) >= need)
    if (fitting.length > 0) {
      const minCap = Math.min(...fitting.map(itemCapacity))
      tieGroup = fitting.filter((m) => itemCapacity(m) === minCap)
    } else {
      /* 兜底：全不够装（未经 paginate 直接调用）→ 容量最大的一组 */
      const maxCap = Math.max(...candidates.map(itemCapacity))
      tieGroup = candidates.filter((m) => itemCapacity(m) === maxCap)
    }
  } else {
    /* cover / end：无条目·全候选同分 */
    tieGroup = [...candidates]
  }

  return pickFromTie(tieGroup, deckId, pageIndex, draft.type)
}

/** 同分组伪随机挑一张（组内按 id 排序钉死顺序再掷·与 registry 注册序无关） */
function pickFromTie(group: LayoutMeta[], deckId: string, pageIndex: number, pageType: string): LayoutMeta {
  if (group.length === 1) return group[0]
  const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const rand = seededRandom(hashSeed(`${deckId}#${pageIndex}#${pageType}`))
  return sorted[Math.floor(rand() * sorted.length)]
}
