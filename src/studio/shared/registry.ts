// 五个编辑器的注册表（按需载入·各编辑器分开打包）。
//   编辑器做好后把自己那一行换成：  sheets: () => import('../sheets').then(m => m.default),
//   ⛔ 改别人那一行；⛔ 改 STUDIO_APP_IDS 的顺序（/studio 总页与 /dilin 顶栏照这个顺序排）。

import type { StudioApp, StudioAppId, StudioFormat } from './types'
import { STUDIO_APP_IDS } from './types'
import { makePlaceholderApp } from './placeholder'

export type StudioAppLoader = () => Promise<StudioApp<any>>   // eslint-disable-line @typescript-eslint/no-explicit-any

export const STUDIO_APP_LOADERS: Record<StudioAppId, StudioAppLoader> = {
  docs: () => import('../docs').then(m => m.default),
  sheets: () => import('../sheets').then(m => m.default),
  slides: () => import('../slides').then(m => m.default),
  video: () => import('../video').then(m => m.default),
  paint: () => import('../paint').then(m => m.default),
}

/** 只载各编辑器的格式（format.ts·不带画面）：服务端给 AI 的说明（ui/AIBrief.tsx）要格式重点用。 */
export const STUDIO_FORMAT_LOADERS: Record<StudioAppId, () => Promise<StudioFormat<any>>> = {   // eslint-disable-line @typescript-eslint/no-explicit-any
  docs: () => import('../docs/format').then(m => m.docsFormat),
  sheets: () => import('../sheets/format').then(m => m.sheetsFormat),
  slides: () => import('../slides/format').then(m => m.slidesFormat),
  video: () => import('../video/format').then(m => m.videoFormat),
  paint: () => import('../paint/format').then(m => m.paintFormat),
}

export function loadStudioApp(app: StudioAppId): Promise<StudioApp<any>> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  return STUDIO_APP_LOADERS[app]()
}

export { STUDIO_APP_IDS }
