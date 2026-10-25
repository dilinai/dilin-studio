// 简报「模板」目录（选模板弹窗用）：纯数据＋纯函数，弹窗、套用、单测同一份。
//   简报卡两种载入方式：
//     load.kind='theme'：一套版式库主题（kit/themes.ts、kit/template-themes.ts）·套用＝换整份的主题重渲，页数／页型／内容／插图不动。
//     load.kind='deck'： 一整份原创元件模板（本体与图放在网站上）·套用＝整份换成模板页（原页全撤·先问）。
//   网站模板（kind='site'）的目录不在这里：网站编辑页把完整目录经弹窗的 catalog 传进来。
//   缩图：网站上是公开路径 /templates/<kind>/<id>/thumb.webp；开源单页版经 studioStaticHref 改成相对路径 templates/<kind>/<id>/thumb.webp
//   （开源包照这份目录从同一提交拷游客版列得出的那几张进 public/templates/slides/）。

import { studioStaticHref } from '../../shared/host'
import { SLIDES_TEMPLATE_META } from './catalog-slides'
import { SLIDE_DECK_TEMPLATE_META } from './catalog-slide-decks'

export type TemplateKind = 'slides' | 'site'

/** 分类（字典键 tpl_cat_<category>）。 */
export const SLIDES_CATEGORIES = ['business', 'minimal', 'dark', 'academic', 'tech', 'warm', 'cute', 'fresh', 'chinese', 'party', 'report', 'education', 'medical', 'campus', 'marketing', 'bizplan'] as const
export const SITE_CATEGORIES = ['landing', 'company', 'portfolio', 'shop', 'blog', 'industry', 'uikit', 'saas', 'dining', 'clinic', 'edu', 'estate', 'event', 'minimalist', 'neon'] as const
export type SlidesCategory = typeof SLIDES_CATEGORIES[number]
export type SiteCategory = typeof SITE_CATEGORIES[number]
export type TemplateCategory = SlidesCategory | SiteCategory

export type TemplateLoad =
  | { kind: 'theme'; themeId: string }
  | { kind: 'html'; path: string }
  | { kind: 'bundle'; id: string; cn?: boolean }
  | { kind: 'deck'; id: string }

export type TemplateEntry = {
  /** 目录键·只许 [a-z0-9-]·全目录唯一 */
  id: string
  kind: TemplateKind
  /** 三语显示名（外来模板是专有名·三语同字） */
  name: { tw: string; cn: string; en: string }
  category: TemplateCategory
  /** 缩图（公开相对路径·首屏只载它） */
  thumb: string
  /** 出处（卡片小字） */
  source: string
  /** 授权 */
  license: string
  /** 版权行（MIT 要随附）·自制留空 */
  attribution?: string
  /** 原 LICENSE 网址 */
  licenseUrl?: string
  /** 风格一句（卡片悬停提示） */
  desc?: string
  load: TemplateLoad
  /** original＝出处行写「原创」（字典 tpl_badge_original） */
  badge?: 'original'
}

/** 出处表的行形 */
export type SlidesTemplateMeta = { id: string; name: string; category: SlidesCategory; desc: string; source: string; attribution: string; licenseUrl: string }
export type SlideDeckTemplateMeta = { id: string; category: SlidesCategory; name: { tw: string; cn: string; en: string }; pages: number; images: number }

/** 模板静态档所在的资料夹：网站 /templates/<kind>/<id>；开源单页版 templates/<kind>/<id>（相对 index.html·双击打开也走得到）。 */
export const templateDir = (kind: TemplateKind, id: string) => studioStaticHref(`/templates/${kind}/${id}`)
export const SELF_SOURCE = { source: '堤麟自製', license: '自製（隨產品授權）' } as const
export const sameName = (s: string) => ({ tw: s, cn: s, en: s })

/** 新建空白简报自带的那套主题也是一张卡（卡 id＝主题 id）。 */
export const BLANK_DEFAULT_TEMPLATE_ID = 'forest-moss'
export const SELF_SLIDES: TemplateEntry[] = [
  { id: BLANK_DEFAULT_TEMPLATE_ID, kind: 'slides', name: { tw: '空白簡報（預設）', cn: '空白简报（默认）', en: 'Blank (Default)' }, category: 'fresh', thumb: `${templateDir('slides', BLANK_DEFAULT_TEMPLATE_ID)}/thumb.webp`, ...SELF_SOURCE, desc: '新建空白簡報自帶的版式', load: { kind: 'theme', themeId: BLANK_DEFAULT_TEMPLATE_ID } },
  { id: 'plain-white', kind: 'slides', name: { tw: '簡約白', cn: '简约白', en: 'Plain White' }, category: 'minimal', thumb: `${templateDir('slides', 'plain-white')}/thumb.webp`, ...SELF_SOURCE, load: { kind: 'theme', themeId: 'plain-white' } },
  { id: 'deep-night', kind: 'slides', name: { tw: '深色商務', cn: '深色商务', en: 'Deep Night' }, category: 'dark', thumb: `${templateDir('slides', 'deep-night')}/thumb.webp`, ...SELF_SOURCE, load: { kind: 'theme', themeId: 'deep-night' } },
  { id: 'warm-beige', kind: 'slides', name: { tw: '米色講義', cn: '米色讲义', en: 'Warm Beige' }, category: 'warm', thumb: `${templateDir('slides', 'warm-beige')}/thumb.webp`, ...SELF_SOURCE, load: { kind: 'theme', themeId: 'warm-beige' } },
]

/** 原创整份元件模板：排在「空白簡報（預設）」之后、其余自制与外来之前 */
export const ORIGINAL_SLIDES: readonly TemplateEntry[] = SLIDE_DECK_TEMPLATE_META.map(m => ({
  id: m.id, kind: 'slides', name: m.name, category: m.category, thumb: `${templateDir('slides', m.id)}/thumb.webp`,
  source: '堤麟原創', license: '堤麟原創（隨產品授權）', load: { kind: 'deck', id: m.id }, badge: 'original',
}))

/** 收进来的外来主题模板（全 MIT） */
export const THIRD_PARTY_SLIDES: readonly TemplateEntry[] = SLIDES_TEMPLATE_META.map(m => ({
  id: m.id, kind: 'slides', name: sameName(m.name), category: m.category, thumb: `${templateDir('slides', m.id)}/thumb.webp`,
  source: m.source, license: 'MIT', attribution: m.attribution, licenseUrl: m.licenseUrl, desc: m.desc, load: { kind: 'theme', themeId: m.id },
}))

/** 简报卡全部（顺序＝弹窗里的顺序） */
export const SLIDES_TEMPLATE_CATALOG: readonly TemplateEntry[] = [SELF_SLIDES[0], ...ORIGINAL_SLIDES, ...SELF_SLIDES.slice(1), ...THIRD_PARTY_SLIDES]

/** 宿主没有 deckTemplates（游客版）时选模板弹窗的筛子：整份原创模板的本体与图在网站上、套用由网站算 ⇒ 不列。开源包也照它决定拷哪几张缩图。 */
export const withoutDeckTemplates = (e: TemplateEntry) => e.load.kind !== 'deck'

export function templatesOf(kind: TemplateKind, catalog: readonly TemplateEntry[] = SLIDES_TEMPLATE_CATALOG): TemplateEntry[] {
  return catalog.filter(t => t.kind === kind)
}

export function categoriesOf(kind: TemplateKind): readonly TemplateCategory[] {
  return kind === 'slides' ? SLIDES_CATEGORIES : SITE_CATEGORIES
}

export function findTemplate(id: string, catalog: readonly TemplateEntry[] = SLIDES_TEMPLATE_CATALOG): TemplateEntry | null {
  return catalog.find(t => t.id === id) ?? null
}

/** 分类的字典键 */
export function categoryLabelKey(cat: TemplateCategory): `tpl_cat_${TemplateCategory}` {
  return `tpl_cat_${cat}`
}
