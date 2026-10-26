// 程序片段在别处显示的名字（加进对话卡、专案现况）：网站自带的照包名；使用者上传的读本机清单（读不到 ⇒「程序片段」）。
import { BUILTIN_PROGRAMS } from './programs.data'
import { VEDIT_PROGRAMS_KEY, l10n, parseStoredPrograms, type Lang } from './program.pure'

export function programName(pkg: string, lang: Lang): string {
  const b = BUILTIN_PROGRAMS.find((x) => x.id === pkg)
  if (b) return l10n(b.manifest.name, lang)
  let raw: string | null = null
  try { raw = typeof window !== 'undefined' ? window.localStorage.getItem(VEDIT_PROGRAMS_KEY) : null } catch { raw = null }
  const u = parseStoredPrograms(raw).find((x) => x.id === pkg)
  return u ? l10n(u.name, lang) : lang === 'en' ? 'Program clip' : lang === 'zh-CN' ? '程序片段' : '程式片段'
}
