/**
 * slide-kit · 组件化 · 记号解析与文字小工具（纯函数·客户端／服务端同一份）
 *   - 颜色记号 theme:<x> ⇒ 本页色板（resolvePalette(theme, 页型)）；字体记号 ⇒ 主题标题／正文字体栈
 *   - 段落／片段 ⇔ 纯文字
 */

import type { PageType, Theme } from '../types'
import { fontStack as themeFontStack, resolvePalette, type SlidePalette } from '../themes'
import { findFont } from '../../../shared/fonts/catalog'
import {
  THEME_COLOR_TOKENS,
  type ColorValue,
  type FontValue,
  type SlideComponent,
  type TextBody,
  type TextParagraph,
  type ThemeColorToken,
} from './types'

const HEX_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const THEME_TOKEN_SET: ReadonlySet<string> = new Set(THEME_COLOR_TOKENS)

export function isColorValue(v: unknown): v is ColorValue {
  if (typeof v !== 'string') return false
  if (HEX_RE.test(v)) return true
  return v.startsWith('theme:') && THEME_TOKEN_SET.has(v.slice(6))
}

/** 解析上下文：一页一个（主题＋该页页型的色板） */
export type ResolveCtx = { theme: Theme; palette: SlidePalette }

export function resolveCtx(theme: Theme, pageType: PageType): ResolveCtx {
  return { theme, palette: resolvePalette(theme, pageType) }
}

/** 颜色 ⇒ CSS 色值（坏值 ⇒ fallback） */
export function resolveColor(v: ColorValue | null | undefined, ctx: ResolveCtx, fallback = 'transparent'): string {
  if (!v || typeof v !== 'string') return fallback
  if (HEX_RE.test(v)) return v
  if (!v.startsWith('theme:')) return fallback
  const t = v.slice(6) as ThemeColorToken
  switch (t) {
    case 'primary': return ctx.theme.primary
    case 'secondary': return ctx.theme.secondary
    default: {
      const c = (ctx.palette as Record<string, unknown>)[t]
      return typeof c === 'string' ? c : fallback
    }
  }
}

/** 字体 ⇒ CSS font-family 栈 */
export function resolveFontStack(v: FontValue | null | undefined, ctx: ResolveCtx): string {
  if (v === 'theme:heading') return themeFontStack(ctx.theme.fontPair.heading)
  if (!v || v === 'theme:body') return themeFontStack(ctx.theme.fontPair.body)
  return findFont(v)?.stack ?? themeFontStack(ctx.theme.fontPair.body)
}

/** 组件用到的表内字体 id（deck-html 挂 stylesheet 用·主题字体另挂） */
export function catalogFontIdsOf(components: readonly SlideComponent[]): string[] {
  const out = new Set<string>()
  const add = (f: unknown) => { if (typeof f === 'string' && !f.startsWith('theme:') && findFont(f)) out.add(f) }
  const body = (b: TextBody | undefined) => {
    if (!b) return
    add(b.box?.font)
    for (const p of b.paragraphs ?? []) for (const r of p.runs ?? []) add(r.font)
  }
  for (const c of components) {
    if (c.type === 'group') { for (const id of catalogFontIdsOf(c.children)) out.add(id); continue }
    if (c.type === 'text') body(c)
    else if (c.type === 'shape') body(c.text)
    else if (c.type === 'table') { add(c.style?.font); for (const row of c.cells ?? []) for (const cell of row) for (const p of cell.paragraphs ?? []) for (const r of p.runs ?? []) add(r.font) }
    else if (c.type === 'chart') add(c.font)
  }
  return [...out]
}

/* ------------------------------------------------------------------ */
/* 文字                                                                */
/* ------------------------------------------------------------------ */

/** 纯文字 ⇒ 段落（\n 分段·每段一个片段·无格式） */
export function paragraphsFromText(text: string, align?: TextParagraph['align']): TextParagraph[] {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  return lines.map((t) => ({ runs: t ? [{ text: t }] : [], ...(align ? { align } : {}) }))
}

/** 段落 ⇒ 纯文字（段间 \n） */
export function plainTextOf(paragraphs: readonly TextParagraph[] | undefined): string {
  return (paragraphs ?? []).map((p) => (p.runs ?? []).map((r) => r.text ?? '').join('')).join('\n')
}

/** 段落里有没有片段级格式（有＝工具回报 rich:true·让 AI 知道整段替换会洗掉格式） */
export function hasRichRuns(paragraphs: readonly TextParagraph[] | undefined): boolean {
  for (const p of paragraphs ?? []) {
    if (p.list || p.indent) return true
    for (const r of p.runs ?? []) {
      for (const k of Object.keys(r)) if (k !== 'text') return true
    }
  }
  return false
}

/** 组件的文字本体（text 组件本身／shape 的形状内文字）·没有 ⇒ null */
export function textBodyOf(c: SlideComponent): TextBody | null {
  if (c.type === 'text') return c
  if (c.type === 'shape' && c.text) return c.text
  return null
}
