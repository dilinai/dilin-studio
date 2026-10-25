// 右栏「一键复制」那段话（纯函数·有题）。
//   资料夹工程：编辑器名＋资料夹名＋format.summaryForAI＋「改完存档网页会自动更新」。
//   浏览器（OPFS）工程：本机 AI 读不到 ⇒ 改成「我会传 zip 给你、改完传回来」的说法。

import type { StorageBackend, StudioT } from './types'

export function buildAIPrompt(o: { t: StudioT; appName: string; backend: StorageBackend; folderName: string; summary: string }): string {
  const summary = o.summary.trim()
  if (o.backend === 'folder') return o.t('studio_ai_prompt_folder', { app: o.appName, folder: o.folderName, summary })
  return o.t('studio_ai_prompt_zip', { app: o.appName, summary })
}

/** 三种用法说明的键（简体站用不带服务名的说法）。 */
export function aiUsageKeys(neutral: boolean): [string, string, string] {
  return neutral
    ? ['studio_ai_use1_neutral', 'studio_ai_use2_neutral', 'studio_ai_use3_neutral']
    : ['studio_ai_use1', 'studio_ai_use2', 'studio_ai_use3']
}
