// 五个编辑器的图示（Heroicons 20 solid·MIT，见 THIRD_PARTY.md）与底色渐层。
//   与网站登入后首页顶栏 dock 同一组图示路径、同一组渐层（palette.dock）；路径字串跟网站那份逐字相同（网站侧有题核对）。

import type { StudioAppId } from './types'
import { palette } from './theme/color-palette'

export const STUDIO_APP_ICON_PATH: Record<StudioAppId, string> = {
  docs: 'M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Zm6 6a1 1 0 1 0-2 0v2H6a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2v-2Z',
  sheets: 'M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11ZM4.5 7v2.25h4.75V7H4.5Zm6.25 0v2.25h4.75V7h-4.75Zm4.75 3.75h-4.75V13h4.75v-2.25Zm0 3.75h-4.75V15.5h4.75V14.5Zm-6.25 1V14.5H4.5v1h4.75Zm-4.75-2.5h4.75v-2.25H4.5V13Z',
  slides: 'M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909-.48-.48a.75.75 0 0 0-1.06 0L6.53 11.06l-4.03-4.03v4.03Z',
  video: 'M3.25 4A2.25 2.25 0 0 0 1 6.25v7.5A2.25 2.25 0 0 0 3.25 16h7.5A2.25 2.25 0 0 0 13 13.75v-7.5A2.25 2.25 0 0 0 10.75 4h-7.5ZM19 4.75a.75.75 0 0 0-1.28-.53l-3 3a.75.75 0 0 0-.22.53v4.5c0 .199.079.39.22.53l3 3a.75.75 0 0 0 1.28-.53V4.75Z',
  paint: 'M15.993 1.385a1.87 1.87 0 0 1 2.623 2.622l-4.03 5.27a12.749 12.749 0 0 1-4.237 3.562 4.508 4.508 0 0 0-3.188-3.188 12.75 12.75 0 0 1 3.562-4.236l5.27-4.03ZM6 11a3 3 0 0 0-3 3 .5.5 0 0 1-.72.45.75.75 0 0 0-1.035.931A4.001 4.001 0 0 0 9 14.004V14a3.01 3.01 0 0 0-1.66-2.685A2.99 2.99 0 0 0 6 11Z',
}

export const STUDIO_APP_GRADIENT: Record<StudioAppId, readonly [string, string]> = {
  docs: palette.dock.doc,
  sheets: palette.dock.sheet,
  slides: palette.dock.slides,
  video: palette.dock.video,
  paint: palette.dock.board,
}
