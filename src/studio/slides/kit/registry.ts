/**
 * slide-kit · 版式注册表 + 查询
 * S2 选版式引擎 code against：listLayouts / getLayout。
 */

import type { LayoutEntry, LayoutMeta, LayoutRelation, PageType } from './types'
import { coverFrame, coverSplit, coverStage } from './layouts/cover'
import { contentsCards, contentsIndex } from './layouts/contents'
import { transitionCenter, transitionNumber } from './layouts/transition'
import { contentCards, contentFocus, contentGrid, contentList, contentSplit } from './layouts/content'
import { endCenter, endFrame } from './layouts/end'
import { contentBeam, contentFan, contentSplitDuo, contentSplitSteps, contentWaist, contentWaistDuo } from './layouts/content-waist-fan'
import { contentOrbit, contentOrbitDual, contentOrbitLoop, contentOrbitSide } from './layouts/content-orbit'
import { contentCardsFlowLayout, contentFullbleedColsLayout, contentFullbleedGlassLayout, contentFullbleedQuoteLayout, contentMosaicLayout } from './layouts/content-mosaic-full'

/**
 * 注册即深冻结：listLayouts / getLayout 返回的是注册表内部对象，
 * 冻结防调用方原地篡改元数据污染后续查询/选版式（库边界防御）。
 */
function freezeEntry(e: LayoutEntry): LayoutEntry {
  Object.freeze(e.meta.slots.text)
  Object.freeze(e.meta.slots.image)
  Object.freeze(e.meta.slots)
  Object.freeze(e.meta)
  return Object.freeze(e)
}

/** 首批版式 14 个（每页型 ≥2·content 覆盖 1~4 条目） */
const RAW_ENTRIES: LayoutEntry[] = [
  coverSplit,
  coverStage,
  coverFrame,
  contentsIndex,
  contentsCards,
  transitionNumber,
  transitionCenter,
  contentSplit,
  contentCards,
  contentGrid,
  contentList,
  contentFocus,
  endCenter,
  endFrame,
  // 新增内容版式（meta 带 relation·现行 pickLayout 跳过）
  contentWaist,
  contentWaistDuo,
  contentFan,
  contentBeam,
  contentSplitSteps,
  contentSplitDuo,
  // 关系版式·环绕类（meta.relation·现行自动挑选跳过）
  contentOrbit,
  contentOrbitLoop,
  contentOrbitSide,
  contentOrbitDual,
  // 新增版式（meta.relation 有值＝现行 pickLayout／paginate 跳过）·卡片中心大卡／箭头串联／全图三款
  contentMosaicLayout,
  contentCardsFlowLayout,
  contentFullbleedGlassLayout,
  contentFullbleedQuoteLayout,
  contentFullbleedColsLayout,
]

const ENTRIES: readonly LayoutEntry[] = RAW_ENTRIES.map(freezeEntry)

const BY_ID = new Map<string, LayoutEntry>(ENTRIES.map((e) => [e.meta.id, e]))

/** 列出全部版式元数据；带 pageType 只列该页型 */
export function listLayouts(pageType?: PageType): LayoutMeta[] {
  return ENTRIES.filter((e) => !pageType || e.meta.pageType === pageType).map((e) => e.meta)
}

/** 按 id 取版式（元数据+组件）。未知 id 返 null 不 throw。 */
export function getLayout(id: string): LayoutEntry | null {
  return BY_ID.get(id) ?? null
}

/**
 * 版式能装几条 draft 条目：有 item 槽 ⇒ item 槽数；没有 ⇒ content／subtitle 槽里大的那个
 * （一句话、两段并列这类版式）。通用写法·按槽位算·⛔ 写死版式 id。
 */
export function layoutItemCapacity(meta: LayoutMeta): number {
  const t = meta.slots.text
  return t.item > 0 ? t.item : Math.max(t.content, t.subtitle)
}

const RELATION_ZH: Record<LayoutRelation, string> = { total: '總分', parallel: '並列', progressive: '遞進', loop: '循環', quote: '一句話', paragraph: '一段話' }

/** 版式一句中文说明：meta.desc 优先；没写 ⇒ 按关系＋槽位自动拼（新版式不用另登记也有说明） */
export function layoutDesc(meta: LayoutMeta): string {
  if (typeof meta.desc === 'string' && meta.desc) return meta.desc
  const parts: string[] = []
  if (meta.relation) parts.push(RELATION_ZH[meta.relation] ?? meta.relation)
  const cap = layoutItemCapacity(meta)
  if ((meta.pageType === 'content' || meta.pageType === 'contents') && cap > 0) parts.push(`最多 ${cap} 條`)
  const t = meta.slots.text, img = meta.slots.image
  if (t.title > 0 && !parts.length) parts.push('標題')
  if (img.background > 0) parts.push('滿版底圖')
  else if (img.pageFigure > 0) parts.push('含配圖')
  if (img.itemFigure > 0) parts.push('條目配圖')
  return parts.join('·') || meta.id
}

/** 一种版式在清单里的样子（工具回报／编辑器换版式用） */
export type LayoutChoice = { id: string; desc: string; relation?: LayoutRelation; maxItems?: number }

/** 某几种页型的全部版式（注册序·含带 relation 的）·清单给 AI／编辑器挑 */
export function layoutChoices(...pageTypes: PageType[]): LayoutChoice[] {
  return listLayouts().filter((m) => pageTypes.includes(m.pageType)).map((m) => ({
    id: m.id,
    desc: layoutDesc(m),
    ...(m.relation ? { relation: m.relation } : {}),
    ...(m.pageType === 'content' || m.pageType === 'contents' ? { maxItems: layoutItemCapacity(m) } : {}),
  }))
}

/** 版式清单的一行字（报错「可用版式」用）：id「说明」、… */
export function layoutChoicesText(...pageTypes: PageType[]): string {
  return layoutChoices(...pageTypes).map((c) => `${c.id}「${c.desc}」`).join('、')
}
