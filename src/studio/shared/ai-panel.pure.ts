// 右栏「交給你的 AI」的纯逻辑（有题·project-pane.test.ts ⑬）：
//   「複製」复制的是当下页面网址（AI 抓这个网址，页面服务端输出的 HTML 里就有给 AI 的说明·见 ai-brief.ts）；
//   「前往 GitHub」「給個星星」：STUDIO_OSS_REPO_PUBLIC=true ⇒ 新分页开仓页；改回 false ⇒ 照常显示、按了没反应。
//   注册那一行也开新分页（AIPanel／StudioShell 的 <a target=_blank>）：右栏的外连都不盖掉正在编辑的页。

import { STUDIO_OSS_REPO_PUBLIC, STUDIO_OSS_REPO_URL } from './host'

/** 负控开关（只在 node 测试跑·正式页面恒 false）：环境变量 DILIN_NEG 含处名 ⇒ 退回修前行为 */
export function studioNeg(site: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return !!env?.DILIN_NEG && env.DILIN_NEG.split(',').includes(site) && typeof window === 'undefined'
}

/** 「複製」复制出去的字：当下页面网址。fallback＝修前那段长提示词（只在负控用）。 */
export function aiPanelCopyText(loc: { href: string }, fallback = ''): string {
  if (studioNeg('studio-ai-copy-url')) return fallback
  return loc.href
}

/** 还没选存放位置时，闸照样放行的右栏钮（不用先选资料夹也能按）：複製網址、前往 GitHub、給個星星、注册那一行。 */
export const GATE_PASS_SELECTOR = ['studio-ai-copy', 'studio-oss-github', 'studio-oss-star', 'studio-ad'].map(id => `[data-testid="${id}"]`).join(',')

/** 两颗开源仓钮按下去：公开 ⇒ window.open 新分页、回 true；没公开 ⇒ 什么都不做、回 false。 */
export function openStudioRepo(win: { open(url: string, target: string, features: string): unknown }, isPublic: boolean = STUDIO_OSS_REPO_PUBLIC): boolean {
  if (!isPublic && !studioNeg('studio-oss-btn-gate')) return false
  win.open(STUDIO_OSS_REPO_URL, '_blank', 'noopener,noreferrer')
  return true
}

/** 「先选存放位置」挡板放行的按键：F5、Ctrl／⌘＋R（重新整理）、F12、Ctrl+Shift+I／⌘⌥I（开发者工具） */
export function gatePassKey(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (k === 'F5' || k === 'F12') return true
  if ((e.ctrlKey || e.metaKey) && k === 'r') return true
  if ((e.ctrlKey && e.shiftKey && k === 'i') || (e.metaKey && e.altKey && (k === 'i' || e.code === 'KeyI'))) return true // Mac ⌘⌥I：Option 会把 key 变成「ˆ」之类，改看实体键
  return false
}
