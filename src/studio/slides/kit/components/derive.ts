/**
 * slide-kit · 组件化 · 读时转换（一页 ⇒ 组件清单）
 *
 *   有 components ⇒ 直接用（已物化）；
 *   没有但有 htmlOverride（工具栏手动排版层）⇒ 包成 1 个锁住、铺满全页的 html 组件（无损·内部不能改·清单给「还原成版式组件」）；
 *   两样都没有 ⇒ 按 layoutId 取组件蓝图（blueprints.ts）；页带 skinId（套过堤麟原創模板·皮肤 ）⇒ 先铺该皮肤本页型的装饰层再叠蓝图。
 * 纯函数·客户端安全（不碰 supabase／react-dom/server）。
 */

import type { LayoutLocale, PageDraft, SlotImageValue } from '../types'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../types'
import { blueprintComponents } from './blueprints'
import { skinDecorComponents } from '../skins'
import { COMPONENT_TYPES, type HtmlComponent, type PageComponentFields, type SlideComponent } from './types'

/** 派生时要的那几栏（DeckPageV2 的子集·免得本档反向依赖 aislides-deck-edit） */
export type DerivablePage = {
  pid?: string
  layoutId: string
  draft: PageDraft
  images?: Record<string, SlotImageValue>
  htmlOverride?: string
  /** 皮肤 id（套 dilin-* 模板后记下·不认得／没有 ⇒ 不铺装饰层＝旧口径） */
  skinId?: string
} & PageComponentFields

/** 页键：pid 优先；老页没 pid ⇒ `i<页序>`（服务端读组件时会先补 pid·之后就稳定） */
export function pageKeyOf(page: DerivablePage, index: number): string {
  return typeof page.pid === 'string' && page.pid ? page.pid : `i${index}`
}

const TYPES: ReadonlySet<string> = new Set(COMPONENT_TYPES)
const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
/** 脏资料防御（回滚／直改库来的坏组件）：种类不认得、编号不是字串、框不是有限数 ⇒ 渲染时跳过（⛔ 让整份 SSR 抛） */
export function isRenderableComponent(c: unknown): c is SlideComponent {
  if (!c || typeof c !== 'object') return false
  const o = c as { id?: unknown; type?: unknown; frame?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown; rotate?: unknown } }
  const f = o.frame
  if (!(typeof o.id === 'string' && TYPES.has(String(o.type)) && !!f && fin(f.x) && fin(f.y) && fin(f.w) && fin(f.h) && (f.rotate === undefined || fin(f.rotate)))) return false
  const x = c as Record<string, unknown>
  const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  const body = (b: unknown) => isObj(b) && Array.isArray((b as { paragraphs?: unknown }).paragraphs) && isObj((b as { box?: unknown }).box)
  switch (o.type) {
    case 'text': return body(x)
    case 'shape': return x.text === undefined || body(x.text)
    case 'table': return Array.isArray(x.cells) && (x.cells as unknown[]).every(Array.isArray) && isObj(x.style)
    case 'chart': return Array.isArray(x.labels) && Array.isArray(x.series)
    case 'html': return typeof x.html === 'string'
    case 'program': return typeof x.html === 'string'
    default: return true
  }
}

/** 这页是不是已物化（有 components 栏） */
export function isMaterialized(page: DerivablePage): boolean {
  return Array.isArray(page.components)
}

/**
 * 手动排版层（iframe 里序列化回来的 section innerHTML）⇒ html 组件内容：
 * 外层 .sk-stage 带着 __sk_fit__ 写上去的 transform:scale(…)——换成不缩放的静态舞台，
 * 免得套进新舞台后被视口适配脚本再缩一次（双重缩放）。
 */
export function neutralizeStageShell(html: string): string {
  return html.replace(/<div\b[^>]*\bclass="sk-stage"[^>]*>/, `<div class="sk-legacy-stage" style="width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;position:relative;overflow:hidden">`)
}

function overrideComponent(key: string, html: string): HtmlComponent {
  return {
    id: `${key}.legacy`,
    type: 'html',
    role: 'legacyHtml',
    frame: { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT, rotate: 0 },
    locked: true,
    html: neutralizeStageShell(html),
    designW: CANVAS_WIDTH,
    designH: CANVAS_HEIGHT,
  }
}

/**
 * 一页的组件清单。
 * @param index 页序（老页没 pid 时拿来当页键）
 * @param locale 版式静态文案语言（目录／致谢默认语）
 */
export function pageComponents(page: DerivablePage, index: number, locale?: LayoutLocale): SlideComponent[] {
  if (Array.isArray(page.components)) {
    const cs = page.components
    const ok = cs.filter(isRenderableComponent)
    return ok.length === cs.length ? cs : ok
  }
  const key = pageKeyOf(page, index)
  if (typeof page.htmlOverride === 'string' && page.htmlOverride.trim()) return [overrideComponent(key, page.htmlOverride)]
  return derivedComponents(page, key, locale)
}

/** 蓝图派生（＋皮肤装饰层·铺在底下） */
function derivedComponents(page: DerivablePage, key: string, locale?: LayoutLocale): SlideComponent[] {
  const bp = blueprintComponents(page.layoutId, { pageKey: key, draft: page.draft, images: page.images, locale }) ?? []
  if (!page.skinId) return bp
  const decor = skinDecorComponents(page.skinId, page.draft?.type ?? 'content', key)
  return decor.length ? [...decor, ...bp] : bp
}

/** 版式派生（不看 components／htmlOverride）——「还原成版式组件」与目录重建用 */
export function layoutComponents(page: DerivablePage, index: number, locale?: LayoutLocale): SlideComponent[] {
  return derivedComponents(page, pageKeyOf(page, index), locale)
}
