/**
 * slide-kit · 皮肤：模板配色＋装饰层，套用于任何版式
 *
 *   皮肤＝从堤麟原創 deck 模板抽出的 Theme＋各页型装饰层（静态表 ./dilin-skins.ts·抽取脚本 preview/extract-dilin-skins.mjs）。
 *   - getTheme(皮肤 id) 查得到（themes.ts）⇒ theme:* 记号按皮肤色解析·字体按皮肤字体；
 *   - 页带 skinId 且还没物化 ⇒ 派生组件＝本页型装饰层＋版式蓝图（components/derive.ts）；
 *   - 老 deck／老页没 skinId ⇒ 一字不变。
 * 纯数据＋纯函数·客户端安全。
 */

import type { PageType } from './types'
import type { SlideComponent } from './components/types'
import { DILIN_SKINS, type DilinSkin } from './dilin-skins'
import { skinAssetBase } from '../../shared/host'

export type { DilinSkin }
export { DILIN_SKINS }

const BY_ID: ReadonlyMap<string, DilinSkin> = new Map(DILIN_SKINS.map((s) => [s.id, s]))

/** 皮肤 id ⇒ 皮肤（不认得 ⇒ null） */
export function getSkin(id: unknown): DilinSkin | null {
  return typeof id === 'string' ? BY_ID.get(id) ?? null : null
}

export function isSkinId(id: unknown): id is string {
  return getSkin(id) !== null
}

/**
 * 装饰层组件（深拷贝·编号 skin.<x> ⇒ <页键>.skin.<x>·deck 内唯一）。
 * 不认得的皮肤／该页型没装饰 ⇒ []。
 */
export function skinDecorComponents(skinId: unknown, pageType: PageType, pageKey: string): SlideComponent[] {
  const layer = getSkin(skinId)?.layers[pageType]
  if (!layer || layer.length === 0) return []
  const base = skinAssetBase()
  return layer.flatMap((c) => {
    const o = withSkinMedia(structuredClone(c), base)
    if (!o) return []
    o.id = `${pageKey}.${c.id}`
    return [o]
  })
}

const isRel = (u: unknown): u is string => typeof u === 'string' && u !== '' && !/^[a-z]+:/i.test(u)
/** 皮肤表里的相对媒体路径 ⇒ 接上图床前缀；没有前缀（开源版不带图）⇒ 那个图丢掉（其余装饰照常） */
function withSkinMedia(c: SlideComponent, base: string): SlideComponent | null {
  if (c.type === 'image') { if (!isRel(c.src)) return c; return base ? { ...c, src: base + c.src } : null }
  if (c.type === 'video') {
    if (isRel(c.src) && !base) return null
    return { ...c, ...(isRel(c.src) ? { src: base + c.src } : {}), ...(isRel(c.poster) ? (base ? { poster: base + c.poster } : { poster: undefined }) : {}) }
  }
  if (c.type === 'group') return { ...c, children: c.children.map((ch) => withSkinMedia(ch, base)).filter((x): x is SlideComponent => !!x) } as SlideComponent
  return c
}
