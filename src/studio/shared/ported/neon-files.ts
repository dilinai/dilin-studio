import { studioStaticHref } from '../host'

// neon 图标：概念名 → 128px 文件（public/icons/neon/）。纯资料＋纯函数——开源包照这张表只带用得到的那几张。
// ai = 蓝紫渐变魔法笔
export const NEON_FILE = {
  chat:   'icon-chat-128.png',
  video:  'icon-video-128.png',
  gear:   'icon-gear-128.png',
  image:  'icon-image-128.png',
  board:  'icon-board-128.png',
  doc:    'icon-doc-128.png',
  music:  'icon-music-128.png',
  report: 'icon-report-128.png',
  web:    'icon-web-128.png',
  ai:     'icon-ai-wand-128.png',
  color:  'icon-color-128.png',   // 调色板
  cloud:  'icon-cloud-128.png',   // 顶栏「雲端硬碟」窄屏图标化
  explore: 'icon-explore-128.png', // 顶栏「探索世界」窄屏图标化(同上)
} as const

export type NeonIconName = keyof typeof NEON_FILE

/** 图标网址：网站 /icons/neon/<档>；开源单页版 icons/neon/<档>（相对 index.html）。 */
export function neonFileHref(key: NeonIconName): string {
  return studioStaticHref(`/icons/neon/${NEON_FILE[key]}`)
}
