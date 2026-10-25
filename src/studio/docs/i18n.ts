// 文件编辑器的三语字串：整页（page/DocsPage.tsx）用的键名与网站字典同名，内容抄自网站（见 page/page-strings.ts）。
//   登入版先查网站字典；游客版与开源仓查这一份。
//   网站字典里没有、只有游客版用的另放 DOCS_GUEST_ONLY（page-strings 要跟网站一字不差，⛔ 加进那份）。
import type { StudioDict } from '../shared/types'
import { DOCS_PAGE_I18N } from './page/page-strings'

/** 游客版专用：没有角色对话时编辑区的占位字（登入版那句叫人去右侧 AI 面板下指令）。 */
export const DOCS_GUEST_ONLY: StudioDict = {
  'zh-TW': { docs_guest_editor_ph: '在這裡開始寫作…' },
  'zh-CN': { docs_guest_editor_ph: '在这里开始写作…' },
  en: { docs_guest_editor_ph: 'Start writing here…' },
}

export const DOCS_I18N: StudioDict = {
  'zh-TW': { ...DOCS_PAGE_I18N['zh-TW'], ...DOCS_GUEST_ONLY['zh-TW'] },
  'zh-CN': { ...DOCS_PAGE_I18N['zh-CN'], ...DOCS_GUEST_ONLY['zh-CN'] },
  en: { ...DOCS_PAGE_I18N.en, ...DOCS_GUEST_ONLY.en },
}
