// Dilin Studio 各编辑器与底座的版本号（语义化版本 主.次.修）。
//   只记在码里、不显示在画面上，也不写进工程档（工程档的 version 是格式版本，跟这里无关）。
//   改了某个编辑器目录（<编辑器>/）就把它这一格往上调；改了 shared/ 就调 base。
//     修 bug、改文案 ⇒ 修订号＋1；加功能 ⇒ 次版本＋1、修订号归 0；工程档格式不相容 ⇒ 主版本＋1。
//   版本检查会比对：目录改了而版本号没动 ⇒ 算错（合不进去·小改至少升最后一位）。
//   ⛔ 用别的写法：检查脚本按每行「键名、冒号、单引号版本号」读这一档。

import type { StudioAppId } from './types'

export const STUDIO_VERSIONS: Readonly<Record<StudioAppId | 'base', string>> = Object.freeze({
  base: '1.3.35',
  docs: '1.3.29',
  sheets: '1.4.8',
  slides: '1.3.28',
  video: '1.3.40',
  paint: '1.3.49',
})
