// deck → 静态整份 HTML（放映、下载 html 用）。纯函数·浏览器与服务端都能跑。
//   程序动画：调用方先把要跑的程序编译好（有 compiled 产物）再交进来；没编译的那框画静态。

import type { SlotImageValue, Theme } from './kit/types'
import { resolveSlotImage } from './kit/types'
import type { SlotImage } from './kit/engine'
import { getTheme, THEMES } from './kit/themes'
import { hashSeed } from './kit/engine'
import { buildDeckHtml, type DeckHtmlPage } from './kit/pipeline/deck-html'
import type { DeckDataV2, DeckLang } from './deck-edit'

export function resolveDeckTheme(deck: DeckDataV2): Theme {
  return getTheme(deck.themeId ?? '') ?? THEMES[hashSeed(deck.deckId ?? '') % THEMES.length]
}

/** 存档图槽值（裸 url 或 {url,crop} 两形态）→ 引擎 SlotImage 形态（坏形状/空 url 摘掉） */
export function toSlotImages(images?: Record<string, SlotImageValue>): Record<string, SlotImage> | undefined {
  if (!images || typeof images !== 'object') return undefined
  const out: Record<string, SlotImage> = {}
  for (const [k, v] of Object.entries(images)) {
    const r = resolveSlotImage(v)
    if (r.url) out[k] = { url: r.url, ...(r.crop ? { crop: r.crop } : {}) }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** deck 每页 ⇒ 渲染管线要的那几栏（照 deck 原样·⛔ 渲染时临时补字） */
export function deckHtmlPages(deck: DeckDataV2): DeckHtmlPage[] {
  return deck.pages.map((p) => {
    const images = toSlotImages(p.images)
    return {
      layoutId: p.layoutId,
      draft: p.draft,
      ...(images ? { images } : {}),
      ...(typeof p.htmlOverride === 'string' && p.htmlOverride ? { htmlOverride: p.htmlOverride } : {}),
      ...(typeof p.pid === 'string' ? { pid: p.pid } : {}),
      ...(typeof p.skinId === 'string' && p.skinId ? { skinId: p.skinId } : {}),
      ...(Array.isArray(p.components) ? { components: p.components } : {}),
      ...(Array.isArray(p.animations) ? { animations: p.animations } : {}),
      ...(p.background && typeof p.background === 'object' ? { background: p.background } : {}),
      ...(p.transition && typeof p.transition === 'object' ? { transition: p.transition } : {}),
    }
  })
}

/** deck（程序已编译）⇒ 整份 HTML */
export function compiledDeckToHtml(deck: DeckDataV2, title: string): Promise<string> {
  const lang: DeckLang = deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'
  return buildDeckHtml({ title, lang, theme: resolveDeckTheme(deck), pages: deckHtmlPages(deck) })
}
