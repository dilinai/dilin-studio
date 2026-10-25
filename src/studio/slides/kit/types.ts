/**
 * slide-kit · 三层数据模型类型（中间格式 / 版式 / 主题）
 *
 * 版式视觉起点 adapted from presenton (Apache-2.0)，数据结构为自研契约。
 *
 * 逻辑画布基准：1000 × 562.5（16:9）。版式内一切坐标/尺寸按逻辑像素表达，
 * 渲染时由 SlideView 按目标宽度等比缩放（缩略图/编辑/放映同数据三缩放）。
 */

import type * as React from 'react'

/** 逻辑画布基准（16:9） */
export const CANVAS_WIDTH = 1000
export const CANVAS_HEIGHT = 562.5

/* ------------------------------------------------------------------ */
/* 第一层 · 中间格式（AI 产 · 五型页 · 纯内容零样式）                     */
/* ------------------------------------------------------------------ */

/**
 * 内容页的「条目关系」：
 *   total＝总分（一句总述带几个分点）·parallel＝并列·progressive＝递进（阶段／流程）·loop＝循环·quote＝一句话·paragraph＝一段话（全图毛玻璃）。
 * draft 带了它 ⇒ pickLayout 先在 meta.relation 相同的版式里挑；没带 ⇒ 照旧（只挑不带 relation 的版式）。
 */
export const LAYOUT_RELATIONS = ['total', 'parallel', 'progressive', 'loop', 'quote', 'paragraph'] as const
export type LayoutRelation = (typeof LAYOUT_RELATIONS)[number]

/** 是不是认得的关系（白名单·别的一律当没给） */
export function isLayoutRelation(v: unknown): v is LayoutRelation {
  return typeof v === 'string' && (LAYOUT_RELATIONS as readonly string[]).includes(v)
}

/**
 * AI 只产这个：不含坐标、颜色、字号、HTML。
 * 丑不丑由版式决定，AI 坏不了版面。
 */
export type PageDraft =
  | { type: 'cover'; title: string; subtitle?: string }
  | { type: 'contents'; items: string[] }
  /** partNo：章序（0 起·引擎/大纲注入·版式渲成 01/02…·缺省按 0） */
  | { type: 'transition'; title: string; lead?: string; partNo?: number }
  /** relation：可选的条目关系（选版式用·纯内容语义·不是样式）；lead：可选总述（关系版式·环绕中心圆等处写它·旧版式不读） */
  | { type: 'content'; title: string; lead?: string; items: Array<{ heading?: string; body: string }>; relation?: LayoutRelation }
  /** end 可选自带致谢文案（多语场景覆盖版式默认「謝謝觀看」） */
  | { type: 'end'; title?: string; subtitle?: string }

/** 五型页 */
export type PageType = PageDraft['type']

/* ------------------------------------------------------------------ */
/* 第二层 · 版式（人做 · SDK 本体）                                      */
/* ------------------------------------------------------------------ */

/** 文本槽语义（PPTist 三层语义标记思路·自研实现） */
export type TextSlotType =
  | 'title'
  | 'subtitle'
  | 'content'
  | 'item'
  | 'itemTitle'
  | 'itemNumber'
  | 'partNumber'
  | 'footer'

/** 图槽语义 */
export type ImageSlotType = 'background' | 'pageFigure' | 'itemFigure'

/**
 * 槽位表：类型 × 容量。**满键 Record**（钉死契约）：
 * 每个槽类型必有数字，版式没有的槽容量 = 0。
 * S2 引擎可直接读 `meta.slots.text.title`，永远拿到 number 不会 undefined。
 * 版式作者用 {@link makeSlotTable} 只写真有的槽，缺键自动补 0。
 */
export type SlotTable = {
  text: Record<TextSlotType, number>
  image: Record<ImageSlotType, number>
}

const TEXT_SLOT_TYPES: readonly TextSlotType[] = [
  'title',
  'subtitle',
  'content',
  'item',
  'itemTitle',
  'itemNumber',
  'partNumber',
  'footer',
]
const IMAGE_SLOT_TYPES: readonly ImageSlotType[] = ['background', 'pageFigure', 'itemFigure']

/** 版式声明槽位的入口：只写真有的槽，缺键补 0，产出满键 SlotTable */
export function makeSlotTable(partial: {
  text?: Partial<Record<TextSlotType, number>>
  image?: Partial<Record<ImageSlotType, number>>
}): SlotTable {
  const text = {} as Record<TextSlotType, number>
  for (const k of TEXT_SLOT_TYPES) text[k] = partial.text?.[k] ?? 0
  const image = {} as Record<ImageSlotType, number>
  for (const k of IMAGE_SLOT_TYPES) image[k] = partial.image?.[k] ?? 0
  return { text, image }
}

/** 版式元数据（registry 查询/选版式引擎用） */
export type LayoutMeta = {
  id: string
  pageType: PageType
  slots: SlotTable
  thumbnail?: string
  /** 这版式适合的条目关系（带了＝pickLayout 只在 draft 带同一关系时才挑它）·⛔ 影响已存简报（layoutId 不变） */
  relation?: LayoutRelation
  /** 一句中文说明（slides_list_components 版式清单／编辑器换版式提示用·没写＝按槽位自动拼） */
  desc?: string
  /** 版式批次（新版式＝'v2'·与 relation 同时给） */
  group?: 'v2'
  /** 建议条目数 [下限, 上限]（上限＝slots.text.item）·relation 版式才给 */
  itemRange?: readonly [number, number]
}

/**
 * 版式组件入参。
 * images：图槽 id → 图槽值（裸 url 或 {url, crop}）。key 约定见 {@link imageSlotKey}：
 *   - 'background' / 'pageFigure'（每版式至多一个）
 *   - 'itemFigure:0'、'itemFigure:1' …（条目插图按条目序号）
 * 缺图时版式渲染主题化占位块，不渲裂图。
 */
/**
 * 版式静态文案语言：版式 chrome（目录标题/致谢默认语）跟语言走。
 * 与 engine 的 ComposeLocale 同值域（types 是底层·不反向 import engine）。
 * 缺省 'zh-TW' = 既有调用方零行为变化。
 */
export type LayoutLocale = 'zh-TW' | 'zh-CN' | 'en'

/**
 * 百分比裁剪窗（0~100·相对原图）——。
 * S2 图池匹配（engine/match-images centerCrop）产出·渲染侧（Figure/背景图）
 * 按 inset 百分比精确套用。定义收在 types（底层）·engine 从这里取（不反向依赖）。
 */
export type CropRect = { x: number; y: number; w: number; h: number }

/**
 * 图槽值：
 *   - 裸 url 字符串（旧形态·object-fit:cover 中心裁剪）——既有调用方零改动；
 *   - { url, crop? }（engine SlotImage 形态）——crop 由渲染侧真消费·契约闭合。
 */
export type SlotImageValue = string | { url: string; crop?: CropRect }

/** 图槽值归一（两形态 → {url?, crop?}·空串/坏形状归 {}·渲染层走占位路径） */
export function resolveSlotImage(v: SlotImageValue | undefined): { url?: string; crop?: CropRect } {
  if (!v) return {}
  if (typeof v === 'string') return v.length > 0 ? { url: v } : {}
  if (typeof v === 'object' && typeof v.url === 'string' && v.url.length > 0) {
    return { url: v.url, crop: v.crop }
  }
  return {}
}

export type LayoutProps = {
  draft: PageDraft
  theme: Theme
  images?: Record<string, SlotImageValue>
  /** 静态文案语言（目录/謝謝觀看等版式自带字）·缺省 zh-TW */
  locale?: LayoutLocale
}

/** 版式 = 元数据 + React 组件 */
export type LayoutEntry = {
  meta: LayoutMeta
  Component: React.FC<LayoutProps>
}

/** images 字典 key 约定的唯一生成处 */
export function imageSlotKey(slot: ImageSlotType, index?: number): string {
  return slot === 'itemFigure' ? `itemFigure:${index ?? 0}` : slot
}

/* ------------------------------------------------------------------ */
/* 第三层 · 主题（皮肤层）                                               */
/* ------------------------------------------------------------------ */

/**
 * 深浅策略：
 *   - 'sandwich'：封面/过渡/结尾深底，目录/内容浅底（三明治）
 *   - 'all-dark'：全程深底
 *   - 'light'   ：全程浅底
 */
export type ThemeDarkMode = 'sandwich' | 'all-dark' | 'light'

export type Theme = {
  id: string
  /** 主色（60-70% 视觉权重·深色主题的深底即主色） */
  primary: string
  /** 辅助色 */
  secondary: string
  /** 强调色（引擎按对比度回退·见 themes.resolvePalette） */
  accent: string
  darkMode: ThemeDarkMode
  /** 中文字体配对（标题有性格·正文干净） */
  fontPair: { heading: string; body: string }
  /** 展示名（可选） */
  name?: string
  // ── 以下四键全可选：外部版式模板（reveal.js／Marp／Slidev／Shower）抽出来的「原样」颜色；
  //    不设＝沿旧推导（bg＝tint(secondary)·浅底字＝shade(primary)·深底字＝白）·既有三套主题一个都没设 ⇒ 输出一字不变。
  //    正文色照过 AA 4.5 保底（ensureContrast）·标题色给了也过同一道保底。
  /** 浅底页背景（不给＝tint(secondary, 0.92)） */
  bg?: string
  /** 浅底页文字：heading＝标题（text）·body＝正文（muted） */
  ink?: { heading?: string; body?: string }
  /** 深底页文字：heading＝标题（不给＝#FFFFFF）·body＝正文 */
  darkInk?: { heading?: string; body?: string }
  /** 装饰风格名（描述用：原模板的装饰特征与版式库取舍·渲染层不读） */
  decor?: string
}
