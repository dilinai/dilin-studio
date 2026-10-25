/**
 * slide-kit · 主题 3 套 + 页面调色解析
 *
 * 色盘取材：一套十色盘
 * （午夜行政 / 森林苔藓 / 莓果奶油 三行原样取材）。
 * 配色规矩：一色独大 60-70%、深浅三明治或全深二选一、强对比。
 */

import type { PageType, Theme, ThemeDarkMode } from './types'
import { THIRD_PARTY_TEMPLATE_THEMES } from './template-themes'   //  清单抽出的 33 套
import { findFontByFamily } from '../../shared/fonts/catalog'
import { getSkin } from './skins'   // 13 套堤麟原創 deck 抽出的皮肤（themeId＝皮肤 id 时查得到）

/* ------------------------------------------------------------------ */
/* 字体栈                                                              */
/* ------------------------------------------------------------------ */

const FONT_STACKS: Record<string, string> = {
  'Noto Sans TC':
    "'Noto Sans TC','Noto Sans CJK TC','PingFang TC','Microsoft JhengHei',sans-serif",
  'Noto Serif TC':
    "'Noto Serif TC','Noto Serif CJK TC','PingFang TC','Microsoft JhengHei',serif",
  // 字体表（core/lib/fonts/catalog.ts）里两款 Google 单字重中文字体·模板主题用得到
  'Huninn':
    "'Huninn','jf-openhuninn','Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif",
  'Iansui':
    "'Iansui','Klee One','Noto Serif TC','PingFang TC','Microsoft JhengHei',serif",
  // 小清新皮肤标题字（字体表 lxgw-wenkai-screen·css 切片载·deck-html 按字体表挂样式表）
  'LXGW WenKai Screen':
    "'LXGW WenKai Screen','LXGW WenKai','Kaiti TC','DFKai-SB','Noto Serif TC',serif",
}

/** Google Fonts 上只有单一字重的族（css2 带 wght 轴会整条 400）·deck-html 组链接用 */
export const SINGLE_WEIGHT_FONTS: ReadonlySet<string> = new Set(['Huninn', 'Iansui'])

/**
 * 主题字族里**不在 Google Fonts 上**的（字体表 load.kind='css'·例：霞鹜文楷）⇒ 字体表 id。
 *   这类字族 ⛔ 拼进 Google css2 链（css2 遇不认得的族整条 400·连正文字体一起失效）·改由字体表样式表挂载。
 *   既有主题（Noto／Huninn／Iansui）全在 Google 上 ⇒ 回 []·链接串一字不变。
 */
export function themeCssFontIds(theme: Pick<Theme, 'fontPair'>): string[] {
  const out: string[] = []
  for (const fam of [theme.fontPair.heading, theme.fontPair.body]) {
    const f = findFontByFamily(fam)
    if (f && f.load.kind === 'css' && !out.includes(f.id)) out.push(f.id)
  }
  return out
}

/** 主题字族里走 Google css2 的那几个（去掉 {@link themeCssFontIds} 那类）·顺序＝标题、正文 */
export function themeGoogleFamilies(theme: Pick<Theme, 'fontPair'>): { heading: string | null; body: string | null } {
  const g = (fam: string) => (findFontByFamily(fam)?.load.kind === 'css' ? null : fam)
  return { heading: g(theme.fontPair.heading), body: g(theme.fontPair.body) }
}

/** 主题字体名 → 带 fallback 的 CSS font-family 栈 */
export function fontStack(family: string): string {
  return FONT_STACKS[family] ?? `'${family}','Noto Sans CJK TC',sans-serif`
}

/* ------------------------------------------------------------------ */
/* 主题 3 套                                                           */
/* ------------------------------------------------------------------ */

/** 午夜行政：藏青大气·三明治（封面/过渡/结尾深底·内容浅底） */
export const THEME_MIDNIGHT: Theme = {
  id: 'midnight-exec',
  name: '午夜行政',
  primary: '#1E2761',
  secondary: '#CADCFC',
  accent: '#FFFFFF',
  darkMode: 'sandwich',
  fontPair: { heading: 'Noto Sans TC', body: 'Noto Sans TC' },
}

/** 森林苔藓：森绿沉稳·全程浅底 */
export const THEME_FOREST: Theme = {
  id: 'forest-moss',
  name: '森林苔藓',
  primary: '#2C5F2D',
  secondary: '#97BC62',
  accent: '#F5F5F5',
  darkMode: 'light',
  fontPair: { heading: 'Noto Serif TC', body: 'Noto Sans TC' },
}

/** 莓果奶油：莓紫高级感·全程深底 */
export const THEME_BERRY: Theme = {
  id: 'berry-cream',
  name: '莓果奶油',
  primary: '#6D2E46',
  secondary: '#A26769',
  accent: '#ECE2D0',
  darkMode: 'all-dark',
  fontPair: { heading: 'Noto Serif TC', body: 'Noto Sans TC' },
}

/** 生成期随机挑的池（hashSeed % length）——⛔ 别把模板主题塞进来·会改变存量 deckId 的落点 */
export const THEMES: Theme[] = [THEME_MIDNIGHT, THEME_FOREST, THEME_BERRY]

/* ------------------------------------------------------------------ */
/* 模板主题（简报页顶栏「模板」弹窗用） */
/*   简报模板＝版式库里的版式定义（主题色／字体／深浅策略）·套用＝换 deck 的 themeId 重渲·内容槽位不动 */
/*   ⛔ 不进 THEMES（生成期随机池）——只在 getTheme 查得到（deck.themeId 指名才用）·3 款自制占位·没抄别人的 */
/* ------------------------------------------------------------------ */

/** 简约白：近白底·黑字·一点蓝·全程浅底 */
export const THEME_PLAIN_WHITE: Theme = {
  id: 'plain-white',
  name: '簡約白',
  primary: '#1F2937',
  secondary: '#E5E7EB',
  accent: '#2563EB',
  darkMode: 'light',
  fontPair: { heading: 'Noto Sans TC', body: 'Noto Sans TC' },
}

/** 深色商务：石板深底·琥珀强调·全程深底 */
export const THEME_DEEP_NIGHT: Theme = {
  id: 'deep-night',
  name: '深色商務',
  primary: '#0F172A',
  secondary: '#94A3B8',
  accent: '#F59E0B',
  darkMode: 'all-dark',
  fontPair: { heading: 'Noto Sans TC', body: 'Noto Sans TC' },
}

/** 米色讲义：米色纸感·棕字·衬线标题·三明治 */
export const THEME_WARM_BEIGE: Theme = {
  id: 'warm-beige',
  name: '米色講義',
  primary: '#5C4A32',
  secondary: '#D9C7A5',
  accent: '#B45309',
  darkMode: 'sandwich',
  fontPair: { heading: 'Noto Serif TC', body: 'Noto Sans TC' },
}

export const TEMPLATE_THEMES: Theme[] = [THEME_PLAIN_WHITE, THEME_DEEP_NIGHT, THEME_WARM_BEIGE, ...THIRD_PARTY_TEMPLATE_THEMES]

export function getTheme(id: string): Theme | null {
  return THEMES.find((t) => t.id === id) ?? TEMPLATE_THEMES.find((t) => t.id === id) ?? getSkin(id) ?? null
}

/* ------------------------------------------------------------------ */
/* 页面调色解析（版式统一从这里拿颜色·不各自硬编码）                       */
/* ------------------------------------------------------------------ */

/** 一页解析出的可用色板 */
export type SlidePalette = {
  /** 本页是深底页 */
  isDark: boolean
  /** 页背景 */
  bg: string
  /** 卡片/面板底色 */
  surface: string
  /** 面板描边 */
  border: string
  /** 主文字 */
  text: string
  /** 次文字 */
  muted: string
  /** 强调色（已按对比度回退·对 bg 保证可读） */
  accent: string
  /** 强调色上的文字色 */
  onAccent: string
  /** 图占位块底色 */
  figureBg: string
}

/** 深浅策略 × 页型 → 本页走深底还是浅底 */
export function isDarkPage(mode: ThemeDarkMode, pageType: PageType): boolean {
  if (mode === 'all-dark') return true
  if (mode === 'light') return false
  // sandwich：封面/过渡/结尾深·目录/内容浅
  return pageType === 'cover' || pageType === 'transition' || pageType === 'end'
}

/* --- 小工具：hex 运算（不引依赖） --- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** 与白混（amount 0-1 越大越浅） */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount)
}

/** 与黑混（amount 0-1 越大越深） */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount))
}

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * 正文级对比保底：把 color 朝可读方向逐步推（深底提亮/浅底压暗），
 * 直到对 refs 里每个背景都 ≥ min。正文（bodyStyle）统一用 palette.muted 渲，
 * 且既画在页底 bg 上也画在卡片 surface 上——两面都必须过 WCAG AA 4.5。
 * 迭代封顶仍不够则钉极值（白/近黑），保证返回值恒满足约束（QA 的 contrast
 * 检查因此只是数据缺陷兜底、正常主题永不触发）。
 */
function ensureContrast(refs: string[], color: string, min: number, darkBg: boolean): string {
  let c = color
  for (let i = 0; i < 24; i++) {
    if (refs.every((r) => contrastRatio(c, r) >= min)) return c
    c = darkBg ? tint(c, 0.1) : shade(c, 0.1)
  }
  return darkBg ? '#FFFFFF' : '#111111'
}

/** 从候选里挑第一个对 bg 对比度 ≥ min 的色；全不够挑对比最大的 */
function pickReadable(bg: string, candidates: string[], min = 3): string {
  let best = candidates[0]
  let bestRatio = 0
  for (const c of candidates) {
    const r = contrastRatio(bg, c)
    if (r >= min) return c
    if (r > bestRatio) {
      bestRatio = r
      best = c
    }
  }
  return best
}

/**
 * 主题 + 页型 → 本页色板。
 * 强调色按对比度回退（不许低对比元素）——
 * 例如午夜行政 accent 白色在浅底页不可读，自动回退主色。
 */
export function resolvePalette(theme: Theme, pageType: PageType): SlidePalette {
  const dark = isDarkPage(theme.darkMode, pageType)
  if (dark) {
    const bg = theme.primary
    const surface = tint(bg, 0.08)
    const accent = pickReadable(bg, [theme.accent, theme.secondary, '#FFFFFF'])
    return {
      isDark: true,
      bg,
      surface,
      border: tint(bg, 0.22),
      // darkInk.heading 覆写（照过 AA 保底）·不给＝白（旧口径）
      text: theme.darkInk?.heading ? ensureContrast([bg, surface], theme.darkInk.heading, 4.5, true) : '#FFFFFF',
      // muted 是正文色（bodyStyle）·必须对 bg 与 surface 双面 ≥ 4.5
      muted: ensureContrast([bg, surface], theme.darkInk?.body ?? pickReadable(bg, [theme.secondary, tint(bg, 0.65)], 3.5), 4.5, true),
      accent,
      onAccent: contrastRatio(accent, '#111111') >= 4.5 ? '#111111' : '#FFFFFF',
      figureBg: tint(bg, 0.14),
    }
  }
  // bg／ink 覆写：不给＝旧推导（既有主题输出不变）
  const bg = theme.bg ?? tint(theme.secondary, 0.92)
  const surface = '#FFFFFF'
  const text = theme.ink?.heading ? ensureContrast([bg, surface], theme.ink.heading, 4.5, false) : shade(theme.primary, 0.55)
  const accent = pickReadable(bg, [theme.accent, theme.primary, theme.secondary])
  return {
    isDark: false,
    bg,
    surface,
    border: tint(theme.secondary, 0.55),
    text,
    // 浅底 bg 比 surface(白) 更严·两面一起钉 ≥ 4.5（午夜浅底旧值 #6f798b 对 bg 仅 4.28）
    muted: ensureContrast([bg, surface], theme.ink?.body ?? shade(theme.secondary, 0.45), 4.5, false),
    accent,
    onAccent: contrastRatio(accent, '#FFFFFF') >= 3 ? '#FFFFFF' : shade(accent, 0.75),
    figureBg: tint(theme.secondary, 0.72),
  }
}

/**
 * 正文对比自检（供单测/QA 工具核主题数据）：主题 × 页型的 text/muted
 * 对 bg/surface 四对比值全部 ≥ 4.5 才 true。
 */
export function paletteMeetsBodyAA(theme: Theme, pageType: PageType): boolean {
  const p = resolvePalette(theme, pageType)
  return (
    contrastRatio(p.text, p.bg) >= 4.5 &&
    contrastRatio(p.text, p.surface) >= 4.5 &&
    contrastRatio(p.muted, p.bg) >= 4.5 &&
    contrastRatio(p.muted, p.surface) >= 4.5
  )
}
