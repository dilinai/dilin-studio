/**
 * slide-kit · 简报版式 SDK 统一出口
 *
 * 三层数据模型：中间格式（AI 产·五型页）/ 版式（人做·语义槽）/ 主题（皮肤）。
 * S2 引擎、S3 生成管线、S4 接线一律从这里 import。
 */

export {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  imageSlotKey,
  makeSlotTable,
  resolveSlotImage,
  LAYOUT_RELATIONS,
  isLayoutRelation,
} from './types'
export type {
  PageDraft,
  PageType,
  TextSlotType,
  ImageSlotType,
  SlotTable,
  LayoutMeta,
  LayoutProps,
  LayoutLocale,
  LayoutEntry,
  LayoutRelation,
  CropRect,
  SlotImageValue,
  Theme,
  ThemeDarkMode,
} from './types'

export {
  THEMES,
  THEME_MIDNIGHT,
  THEME_FOREST,
  THEME_BERRY,
  getTheme,
  resolvePalette,
  isDarkPage,
  fontStack,
  contrastRatio,
} from './themes'
export type { SlidePalette } from './themes'

export { listLayouts, getLayout, layoutDesc, layoutItemCapacity } from './registry'

export { SlideView } from './renderer'
export type { SlideViewProps } from './renderer'
