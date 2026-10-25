'use client'
// 字串注入：编辑器 UI 一律 `const t = useStudioT()`；谁喂字典由外层决定。
//   游客版（StudioShell）：<StudioTProvider t={makeStudioT([STUDIO_SHARED_I18N, app.i18n], lang)} lang={lang}>
//   登入版页面：<StudioTProvider t={siteTAdapter(siteT, makeStudioT([app.i18n], lang))} lang={lang}>
//     siteT＝网站 LanguageContext 的 useT()；网站字典查不到（回 undefined 或回键名本身）的键退回编辑器字典。
//   没包 Provider ⇒ 回一个只认底座字典、语言＝host 默认的 t（不会炸，但画面会是默认语言）。

import { createContext, useContext, type ReactNode } from 'react'
import type { StudioLang, StudioT } from './types'
import { makeStudioT, STUDIO_SHARED_I18N } from './i18n'
import { defaultLang } from './host'

type Ctx = { t: StudioT; lang: StudioLang }
const StudioTContext = createContext<Ctx | null>(null)
let fallback: Ctx | null = null

export function StudioTProvider({ t, lang, children }: { t: StudioT; lang: StudioLang; children: ReactNode }) {
  return <StudioTContext.Provider value={{ t, lang }}>{children}</StudioTContext.Provider>
}

function useCtx(): Ctx {
  const c = useContext(StudioTContext)
  if (c) return c
  if (!fallback) { const lang = defaultLang(); fallback = { lang, t: makeStudioT([STUDIO_SHARED_I18N], lang) } }
  return fallback
}

/** 取字函数 t(key, vars?)。 */
export function useStudioT(): StudioT { return useCtx().t }
/** 现在的界面语言。 */
export function useStudioLang(): StudioLang { return useCtx().lang }

/**
 * 登入版转接：先问网站的 t，查不到再问 fallback（编辑器字典）。
 * siteT 的型别故意放宽成 (key: string) => string | undefined：网站 t 只收自己的键型别，调用端写
 * `siteTAdapter(k => siteT(k as TKey), …)` 即可。网站 t 查不到时有的回 undefined、有的回键名本身，两种都当查不到。
 */
export function siteTAdapter(siteT: (key: string) => string | undefined, fallbackT: StudioT): StudioT {
  return (key, vars) => {
    let s: string | undefined
    try { s = siteT(key) } catch { s = undefined }
    if (s === undefined || s === null || s === key) return fallbackT(key, vars)
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
  }
}
