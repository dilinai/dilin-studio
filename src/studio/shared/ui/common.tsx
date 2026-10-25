'use client'
// /studio 各页共用的小件：语言状态、页框（StudioTProvider＋顶栏品牌与语言切换）、编辑器图示方块、错误转人话。

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { StudioAppId, StudioDict, StudioLang, StudioT } from '../types'
import { STUDIO_LANGS, isStudioError } from '../types'
import { STUDIO_LANG_LABELS, STUDIO_SHARED_I18N, makeStudioT, resolveStudioLang, saveStudioLang } from '../i18n'
import { defaultLang, langLocked, studioHref } from '../host'
import { StudioTProvider, useStudioT } from '../StudioT'
import { STUDIO_APP_GRADIENT, STUDIO_APP_ICON_PATH } from '../icons'
import { formatTag } from '../project-file'

/** 界面语言（首绘用站别默认、挂载后读 localStorage·避免水合不一致）。 */
export function useStudioLangState(): { lang: StudioLang; setLang: (l: StudioLang) => void; locked: boolean } {
  const [lang, setLangState] = useState<StudioLang>(defaultLang())
  useEffect(() => { setLangState(resolveStudioLang()) }, [])
  const setLang = useCallback((l: StudioLang) => { saveStudioLang(l); setLangState(l) }, [])
  return { lang, setLang, locked: langLocked() }
}

export function LangSwitch({ lang, setLang }: { lang: StudioLang; setLang: (l: StudioLang) => void }) {
  const t = useStudioT()
  if (langLocked()) return null
  return (
    <select aria-label={t('studio_lang')} value={lang} onChange={e => setLang(e.target.value as StudioLang)} data-testid="studio-lang"
      className="h-7 text-xs border border-gray-200 rounded-md bg-white px-1.5 text-gray-600">
      {STUDIO_LANGS.map(l => <option key={l} value={l}>{STUDIO_LANG_LABELS[l]}</option>)}
    </select>
  )
}

/** 编辑器图示：渐层圆角方块＋白色图示（同网站顶栏 dock 那组）。 */
export function AppIcon({ app, size = 32 }: { app: StudioAppId; size?: number }) {
  const [from, to] = STUDIO_APP_GRADIENT[app]
  const style: CSSProperties = {
    width: size, height: size, borderRadius: size * 0.27, background: `linear-gradient(160deg, ${from}, ${to})`,
    boxShadow: '0 1px 2px rgba(60,40,10,.18), inset 0 1px 0 rgba(255,255,255,.35)',
  }
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={style} aria-hidden>
      <svg viewBox="0 0 20 20" fill="#fff" style={{ width: size * 0.58, height: size * 0.58, filter: 'drop-shadow(0 1px 0 rgba(0,0,0,.12))' }}>
        <path fillRule="evenodd" clipRule="evenodd" d={STUDIO_APP_ICON_PATH[app]} />
      </svg>
    </span>
  )
}

/** 首页类页面的外框：提供取字、顶栏（品牌＋语言），内容放中间。 */
const NO_DICTS: readonly StudioDict[] = []
export function StudioPageFrame({ extraDicts = NO_DICTS, children }: { extraDicts?: readonly StudioDict[]; children: ReactNode }) {
  const { lang, setLang } = useStudioLangState()
  const t = useMemo(() => makeStudioT([STUDIO_SHARED_I18N, ...extraDicts], lang), [lang, extraDicts])
  return (
    <StudioTProvider t={t} lang={lang}>
      <div className="min-h-screen bg-[#FAFAF8] text-[#4A3528]" lang={lang} data-testid="studio-page">
        <header className="sticky top-0 z-10 border-b border-[#EEE4B8] bg-[#FBF8EF]/90 backdrop-blur">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
            <a href={studioHref.root()} className="font-bold tracking-tight">{t('studio_name')}</a>
            <LangSwitch lang={lang} setLang={setLang} />
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
      </div>
    </StudioTProvider>
  )
}

/** 位元组数 ⇒「N MB」（四舍五入到整数）。 */
function mb(n: number): string { return `${Math.round(n / 1024 / 1024)} MB` }

/** 错误转一句人话（StudioError 按 code 取字；其他错误给原讯息）。 */
export function errorText(t: StudioT, e: unknown, appName: string, app: StudioAppId, maxVersion: number): string {
  if (isStudioError(e)) {
    const detail = e.detail ?? ''
    switch (e.code) {
      case 'bad_format': return t('studio_err_bad_format', { app: appName, expected: formatTag(app), got: detail || '?' })
      case 'too_new': return t('studio_err_too_new', { got: detail, max: maxVersion })
      case 'zip_too_big':
      case 'json_too_big': return t(`studio_err_${e.code}`, { max: mb(Number(detail) || 0) })
      case 'zip_too_many': return t('studio_err_zip_too_many', { max: Number(detail) || 0 })
      default: return t(`studio_err_${e.code}`, { detail })
    }
  }
  const msg = e instanceof Error ? e.message : String(e)
  return t('studio_err_generic', { detail: msg })
}

export function appNameKey(app: StudioAppId): string { return `studio_app_${app}` }

/** 时间显示（本地时区·到分钟）。 */
export function fmtTime(ms: number, lang: StudioLang): string {
  try { return new Date(ms).toLocaleString(lang, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return new Date(ms).toISOString() }
}
