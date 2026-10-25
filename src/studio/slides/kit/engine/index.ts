/**
 * slide-kit engine · 统一出口 + composeDeck 编排
 *
 * 引擎四件套（选版式 / 自动分页 / 字号自适应 / 图池匹配）的统一 export。
 * S3 生成管线 code against 本文件：
 *
 *   composeDeck(drafts, theme, imagePool?, opts?) → ComposedPage[]
 *
 * 契约：
 *   - ComposedPage = { layoutId, draft(可能被分页拆过), images? }
 *   - 纯同步（fit-text 浏览器路径除外·node 路径近似字宽表·且 composeDeck 不隐式调 fit-text）
 *   - 输入非法：吞错跳过该页·不 throw
 *   - 同 deckId 两次 compose 结果全等（伪随机种子确定性）
 */

import type { PageDraft, Theme } from '../types'
import { draftRelation, hashSeed, pickLayout } from './pick-layout'
import { DEFAULT_CONT_SUFFIX, paginateDraft } from './paginate'
import type { ImageAsset, SlotImage } from './match-images'
import { matchImages } from './match-images'

export { pickLayout, hashSeed, seededRandom, layoutItemCapacity, draftRelation } from './pick-layout'
export type { PickLayoutOptions } from './pick-layout'
export { paginateDraft, splitCounts, maxItemCapacity, DEFAULT_CONT_SUFFIX } from './paginate'
export type { PaginateOptions } from './paginate'
export { fitFontSize, textFitsBox, measureTextWidth, MIN_FONT_SIZE, STEP_THRESHOLD } from './fit-text'
export type { FitTextOptions } from './fit-text'
export {
  matchImages,
  centerCrop,
  assetAspect,
  DEFAULT_IMAGE_ASPECT,
  DEFAULT_SLOT_ASPECTS,
} from './match-images'
export type { ImageAsset, CropRect, SlotImage, MatchImagesOptions } from './match-images'

/* ------------------------------------------------------------------ */
/* composeDeck                                                         */
/* ------------------------------------------------------------------ */

/** 引擎产物：一页 = 选定版式 + （可能拆过页的）draft + 图槽映射 */
export type ComposedPage = {
  layoutId: string
  draft: PageDraft
  images?: Record<string, SlotImage>
  /** 手动排版层（section innerHTML）·在场时渲染层直接用它·不从 draft 重渲 */
  htmlOverride?: string
}

export type ComposeLocale = 'zh-TW' | 'zh-CN' | 'en'

const CONT_SUFFIX_BY_LOCALE: Record<ComposeLocale, string> = {
  'zh-TW': DEFAULT_CONT_SUFFIX, // （續）
  'zh-CN': '（续）',
  en: ' (cont.)',
}

export type ComposeOptions = {
  /**
   * deck 种子：同 deckId 重渲版式选择稳定·跨 deck 有变化。
   * 缺省从 drafts 内容 + theme.id 派生（同内容重渲天然稳定）。
   */
  deckId?: string
  /** 分页接续后缀语言（默认 zh-TW「（續）」·i18n 三语与主翻译库同轨） */
  locale?: ComposeLocale
  /** 直接覆盖接续后缀（优先于 locale·给非三语场景留口） */
  contSuffix?: string
}

/** 运行时校验一页 draft 是否合法（非法 → composeDeck 吞错跳过） */
function isValidDraft(d: unknown): d is PageDraft {
  if (!d || typeof d !== 'object') return false
  const t = (d as { type?: unknown }).type
  switch (t) {
    case 'cover':
      return typeof (d as { title?: unknown }).title === 'string'
    case 'contents': {
      const items = (d as { items?: unknown }).items
      return Array.isArray(items) && items.length > 0 && items.every((it) => typeof it === 'string')
    }
    case 'transition':
      return typeof (d as { title?: unknown }).title === 'string'
    case 'content': {
      const c = d as { title?: unknown; items?: unknown }
      return (
        typeof c.title === 'string' &&
        Array.isArray(c.items) &&
        c.items.length > 0 &&
        c.items.every((it) => !!it && typeof it === 'object' && typeof (it as { body?: unknown }).body === 'string')
      )
    }
    case 'end':
      return true
    default:
      return false
  }
}

/**
 * 可选文本字段防御：非字符串 → undefined（当没写）。
 * isValidDraft 只把关必填字段——heading/lead/subtitle/end.title 等
 * **可选**字段带非字符串值（回滚/复制/直改库来的脏 deck_data）会原样穿过校验直达
 * 渲染器（React SSR object child 直接 throw）。SDK 边界把脏 deck_data 当外部输入：
 * 与 sanitizePageDraft 同口径（白名单重建·非法可选键丢弃=按缺省分支走·不整页丢）。
 */
function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * 白名单重建一页 draft（对 isValidDraft 已过的页跑）：只抄该页型契约内的键·
 * 可选键非字符串丢弃。对管线净化过的干净输入是恒等映射（键序与 sanitizePageDraft
 * 输出一致 → safeStringify 派生的缺省 deckId 逐字节不变=确定性契约不破）。
 */
function normalizeDraft(d: PageDraft): PageDraft {
  const r = d as Record<string, unknown>
  switch (d.type) {
    case 'cover': {
      const subtitle = optString(r.subtitle)
      return subtitle !== undefined ? { type: 'cover', title: d.title, subtitle } : { type: 'cover', title: d.title }
    }
    case 'contents':
      return { type: 'contents', items: d.items } // items 已由 isValidDraft 逐条验字符串
    case 'transition': {
      const lead = optString(r.lead)
      const rawPartNo = r.partNo
      const partNo =
        typeof rawPartNo === 'number' && Number.isFinite(rawPartNo) && rawPartNo >= 0 ? rawPartNo : undefined
      const out: PageDraft = { type: 'transition', title: d.title }
      if (lead !== undefined) out.lead = lead
      if (partNo !== undefined) out.partNo = partNo
      return out
    }
    case 'content': {
      const items = d.items.map((it) => {
        const heading = optString((it as Record<string, unknown>).heading)
        return heading !== undefined ? { heading, body: it.body } : { body: it.body }
      })
      // 关系只收认得的值（不带＝键不出现·干净输入恒等映射不变）
      const relation = draftRelation(d)
      return relation ? { type: 'content', title: d.title, items, relation } : { type: 'content', title: d.title, items }
    }
    case 'end': {
      const title = optString(r.title)
      const subtitle = optString(r.subtitle)
      const out: { type: 'end'; title?: string; subtitle?: string } = { type: 'end' }
      if (title !== undefined) out.title = title
      if (subtitle !== undefined) out.subtitle = subtitle
      return out
    }
  }
}

/**
 * 引擎编排主入口：PageDraft[] + 主题 + 图池 → ComposedPage[]。
 *
 * 流程：逐页校验（非法跳过）→ transition 自动补章序 → 超容量分页 → 选版式 → 图池匹配。
 * 纯同步·不 throw·同 deckId 两次调用结果深等。
 * theme 参与 deckId 缺省派生（注意：主题色值 hex-only·引擎不产不改任何色值）。
 */
export function composeDeck(
  drafts: PageDraft[],
  theme: Theme,
  imagePool?: ImageAsset[],
  opts: ComposeOptions = {},
): ComposedPage[] {
  if (!Array.isArray(drafts)) return []

  // 🔴 imagePool 运行时可能是字符串 / {length:1} 类 array-like（JS 边界）：
  // 只看 .length 就传下去会在 pool.filter 抛 TypeError 破「非法不 throw」契约·
  // 非数组一律当无图池（matchImages 内还有同款双保险）。
  const pool = Array.isArray(imagePool) ? imagePool : undefined

  // 白名单重建：可选字段非字符串在 SDK 边界统一丢弃——
  // 干净输入恒等映射（deckId 派生不变）·脏输入可选键被剔=渲染器拿不到 object child
  const valid = drafts.filter(isValidDraft).map(normalizeDraft)

  const deckId =
    opts.deckId ?? `deck-${hashSeed(safeStringify(valid) + '|' + (theme?.id ?? '')).toString(16)}`
  const contSuffix = opts.contSuffix ?? CONT_SUFFIX_BY_LOCALE[opts.locale ?? 'zh-TW']

  /* transition 章序：draft 未带 partNo 的按出现序自动编号（0 起） */
  let transitionSeq = 0
  const withPartNo: PageDraft[] = valid.map((d) => {
    if (d.type !== 'transition') return d
    const partNo = typeof d.partNo === 'number' && d.partNo >= 0 ? d.partNo : transitionSeq
    transitionSeq = partNo + 1
    return d.partNo === partNo ? d : { ...d, partNo }
  })

  /* 分页展开 */
  const pages: PageDraft[] = []
  for (const d of withPartNo) pages.push(...paginateDraft(d, { contSuffix }))

  /* 选版式 + 配图 */
  const out: ComposedPage[] = []
  pages.forEach((draft, pageIndex) => {
    const meta = pickLayout(draft, { deckId, pageIndex })
    if (!meta) return // 无候选版式（理论不可达·registry 每页型≥2）·吞错跳过
    // itemFigure 只配到分页后真实条目数（4 槽版式承载 3 条时
    // 不给不存在的第 4 条产图映射·'itemFigure:i' 按条目序号对位）
    const itemCount =
      draft.type === 'content' || draft.type === 'contents' ? draft.items.length : undefined
    const images = pool && pool.length > 0 ? matchImages(meta, pool, { itemCount }) : undefined
    out.push(images ? { layoutId: meta.id, draft, images } : { layoutId: meta.id, draft })
  })
  return out
}

/** JSON.stringify 兜底（循环引用等异常时退化为长度指纹·保证不 throw） */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return `unstringifiable:${Array.isArray(v) ? v.length : 0}`
  }
}
