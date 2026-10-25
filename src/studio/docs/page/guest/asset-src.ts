// 游客版：图片／影片／音讯节点的 src 若是工程素材（assets/…），画面上改写成 data-studio-src（不放 src）。
//   页面永远不会出现 <img|video|audio src="assets/…">（不然浏览器会先拿这个相对路径去网站要档）；存档前 html.ts 的
//   assetSrcBack 再换回 src。节点 schema 与登入版同一份，只是外面包这一层。
import type { AnyExtension } from '@tiptap/core'
import { assetNameFromSrc } from '../../format'
import { STUDIO_SRC_ATTR } from './html'

type Spec = readonly unknown[]
function swapAssetSrc(spec: Spec): Spec {
  if (!Array.isArray(spec) || typeof spec[1] !== 'object' || spec[1] === null) return spec
  const attrs = { ...(spec[1] as Record<string, unknown>) }
  const src = attrs.src
  if (typeof src === 'string' && assetNameFromSrc(src)) { delete attrs.src; attrs[STUDIO_SRC_ATTR] = src }
  return [spec[0], attrs, ...spec.slice(2)]
}

export function withAssetSrc<T extends AnyExtension>(ext: T, tag: 'img' | 'video' | 'audio'): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ext as any).extend({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addAttributes(this: any) {
      const parent = this.parent?.() ?? {}
      const src = parent.src ?? {}
      return { ...parent, src: { ...src, parseHTML: (el: HTMLElement) => el.getAttribute('src') || el.getAttribute(STUDIO_SRC_ATTR) || '' } }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parseHTML(this: any) { return [...(this.parent?.() ?? []), { tag: `${tag}[${STUDIO_SRC_ATTR}]` }] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderHTML(this: any, props: any) { return swapAssetSrc(this.parent?.(props)) },
  }) as T
}
