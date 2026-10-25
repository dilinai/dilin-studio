// 简报工程档：project.json ＝ { format: "dilin-studio/slides", version: 1, name, deck }，素材在 assets/。
//   栏位说明给人／给 AI 看的版本在 FORMAT.md；summaryForAI 是它的摘要。
//   程序动画的编译产物（compiled／compileError）只在记忆体里：读进来一律剥掉、开着时当场编译，存档也不写。

import type { ProjectStore, StudioFormat, StudioLang } from '../shared/types'
import { StudioError } from '../shared/types'
import { readProjectJson, writeProjectJson } from '../shared/project-file'
import { defaultLang } from '../shared/host'
import { BLANK_LAYOUT_ID, blankDeckV2, ensureDeckPagePids, parseDeckV2, type DeckDataV2, type DeckLang } from './deck-edit'
import { getLayout } from './kit/registry'
import type { SlideComponent } from './kit/components/types'
import { getExtraMediaUrlAcceptor, normalizeComponent, normalizePageBackground, normalizePageTransition, setExtraMediaUrlAcceptor } from './kit/components/validate'

export const SLIDES_FORMAT_VERSION = 1

/** loadIssues：读进来时丢掉的坏栏位（给人与 AI 看·不存档） */
export type SlidesDoc = { name: string; deck: DeckDataV2; loadIssues?: string[] }

/** 工程里放素材的前缀（src 写成 assets/<档名>） */
export const ASSET_PREFIX = 'assets/'
/** 工程素材的引用：assets/<档名>（档名不带斜线、不是 . 或 ..、不带引号与角括号） */
export const ASSET_SRC_RE = /^assets\/(?!\.\.?$)[^\/\\\s"'<>]{1,200}$/
export const isAssetSrc = (src: unknown): src is string => typeof src === 'string' && ASSET_SRC_RE.test(src)
export const assetNameOf = (src: string): string => src.slice(ASSET_PREFIX.length)

function deckLangFor(lang: StudioLang): DeckLang {
  return lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'
}

function newDeckId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return typeof c?.randomUUID === 'function' ? c.randomUUID() : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** 程序组件（含组合里的）去掉编译产物 */
function stripCompiledComps(comps: readonly SlideComponent[]): SlideComponent[] {
  return comps.map((c) => {
    if (c.type === 'program') {
      const { compiled: _c, compileError: _e, ...rest } = c as SlideComponent & { compiled?: unknown; compileError?: unknown }
      void _c; void _e
      return rest as SlideComponent
    }
    if (c.type === 'group') return { ...c, children: stripCompiledComps(c.children) } as SlideComponent
    return c
  })
}
export function stripCompiled(deck: DeckDataV2): DeckDataV2 {
  return { ...deck, pages: deck.pages.map((p) => (Array.isArray(p.components) ? { ...p, components: stripCompiledComps(p.components) } : p)) }
}

export function emptySlidesDoc(lang: StudioLang = defaultLang()): SlidesDoc {
  const deck = blankDeckV2(newDeckId(), deckLangFor(lang))
  const { revision: _r, ...rest } = deck
  void _r
  return { name: '', deck: rest as DeckDataV2 }
}

/** 编辑器挂着时登记：工程素材 assets/<档名> 也算合法媒体网址（卸载撤掉） */
export function acceptAssetUrls(on: boolean): void {
  setExtraMediaUrlAcceptor(on ? isAssetSrc : null)
}

/**
 * 每页的元件、背景、切换照与编辑操作同一套规矩正规化（档是外面的 AI 也能改的·当不可信输入）：
 *   合规的照收；不合规的那一个丢掉、记一句在 issues（第几页、哪个元件、哪一栏）；html 元件（内部用的整页排版层）原样留着。
 */
function normalizePages(deck: DeckDataV2, issues: string[]): DeckDataV2 {
  const prev = getExtraMediaUrlAcceptor()
  setExtraMediaUrlAcceptor(isAssetSrc)
  const why = (e: unknown) => { const x = e as { field?: unknown; code?: unknown; message?: unknown }; return [x.code, x.field].filter((v) => typeof v === 'string' && v).join(' ') || String(x.message ?? e) }
  try {
    const pages = deck.pages.map((p, i) => {
      const out = { ...p }
      if (Array.isArray(p.components)) {
        out.components = p.components.flatMap((c, k) => {
          if (c && typeof c === 'object' && (c as { type?: unknown }).type === 'html') return [c]
          try { return [normalizeComponent(c, `pages[${i}].components[${k}]`)] }
          catch (e) { issues.push(`page ${i + 1}: component ${typeof (c as { id?: unknown })?.id === 'string' ? (c as { id: string }).id : `#${k + 1}`} dropped (${why(e)})`); return [] }
        })
      }
      if (p.background !== undefined) {
        try { out.background = normalizePageBackground(p.background, `pages[${i}].background`) }
        catch (e) { delete out.background; issues.push(`page ${i + 1}: background dropped (${why(e)})`) }
      }
      if (p.transition !== undefined) {
        try { out.transition = normalizePageTransition(p.transition, `pages[${i}].transition`) }
        catch (e) { delete out.transition; issues.push(`page ${i + 1}: transition dropped (${why(e)})`) }
      }
      return out
    })
    return { ...deck, pages }
  } finally { setExtraMediaUrlAcceptor(prev) }
}

/**
 * 外面（多半是 AI）手写的工程：页上有 components（那就是整张投影片）、版式却跟 draft 页型对不上
 * （常见：layoutId "blank" 配 draft cover／end）⇒ 严档 parseDeckV2 会把整份判坏、页面只剩「簡報載入失敗」。
 * 这种页改成空白页（layoutId blank＋空的 content draft），components 原样留着，记一条 issue。
 * 没有 components 的页不动（它靠版式排，改了会变空白），照旧交给严档判。
 */
export function repairComponentPages(raw: unknown, issues: string[]): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { pages?: unknown }).pages)) return raw
  const pages = (raw as { pages: unknown[] }).pages.map((p, i) => {
    if (!p || typeof p !== 'object') return p
    const pg = p as Record<string, unknown>
    if (!Array.isArray(pg.components) || pg.components.length === 0) return p
    const draft = pg.draft as { type?: unknown; title?: unknown } | undefined
    const type = draft && typeof draft === 'object' ? draft.type : undefined
    const layoutId = typeof pg.layoutId === 'string' ? pg.layoutId : ''
    const entry = layoutId && layoutId !== BLANK_LAYOUT_ID ? getLayout(layoutId) : null
    const fits = layoutId === BLANK_LAYOUT_ID ? type === 'content' : !!entry && entry.meta.pageType === type
    if (fits) return p
    issues.push(`page ${i + 1}: layoutId "${layoutId}" + draft "${String(type)}" → blank page (components kept)`)
    const title = draft && typeof draft.title === 'string' ? draft.title : ''
    return { ...pg, layoutId: BLANK_LAYOUT_ID, draft: { type: 'content', title, items: [] } }
  })
  return { ...(raw as Record<string, unknown>), pages }
}

/** 已解析的 project.json（表头已核过）⇒ SlidesDoc；deck 不对 ⇒ StudioError('bad_format') */
export function slidesDocFromJson(j: Record<string, unknown>): SlidesDoc {
  const issues: string[] = []
  const deck = parseDeckV2(repairComponentPages(j.deck, issues))
  if (!deck) throw new StudioError('bad_format', 'deck')
  const name = typeof j.name === 'string' ? j.name.slice(0, 200) : ''
  const clean = normalizePages(ensureDeckPagePids(stripCompiled(deck)), issues)
  return issues.length ? { name, deck: clean, loadIssues: issues } : { name, deck: clean }
}

/** 要写进 project.json 的那份（不带编译产物、不带伺服器才用的乐观戳） */
export function slidesDocToJson(doc: SlidesDoc): Record<string, unknown> {
  const { revision: _r, ...deck } = stripCompiled(doc.deck)
  void _r
  return { name: doc.name, deck }
}

const SUMMARY: Record<StudioLang, string> = {
  'zh-TW': [
    '格式：project.json＝{"format":"dilin-studio/slides","version":1,"name":"…","deck":{"version":2,"lang":"zh-TW","themeId":"…","pages":[…]}}；素材放 assets/，用 "assets/<檔名>" 引用。',
    '每頁：{"pid":"…","layoutId":"blank","draft":{"type":"content","title":"","items":[]},"background":{"color":"#FFFFFF"},"components":[…],"animations":[…]}。有 components 的頁就照它畫；沒有就照 layoutId＋draft 自動排版。',
    '畫布 1000×562.5，每個元件都有 id（整份唯一）、type、frame:{x,y,w,h,rotate}。type：text（paragraphs:[{runs:[{text}]}]＋box:{font,size,color,align,valign,lineHeight,padding}）、image（src,fit）、video（src,fit）、shape（shape,fill,stroke,text）、table、chart、program（html/css 動畫）、group（children）。',
    '顏色寫 "#RRGGBB" 或 "theme:text／theme:accent／theme:bg…"，字體寫 "theme:heading／theme:body"。詳細欄位見 FORMAT.md。',
  ].join('\n'),
  'zh-CN': [
    '格式：project.json＝{"format":"dilin-studio/slides","version":1,"name":"…","deck":{"version":2,"lang":"zh-CN","themeId":"…","pages":[…]}}；素材放 assets/，用 "assets/<文件名>" 引用。',
    '每页：{"pid":"…","layoutId":"blank","draft":{"type":"content","title":"","items":[]},"background":{"color":"#FFFFFF"},"components":[…],"animations":[…]}。有 components 的页就照它画；没有就照 layoutId＋draft 自动排版。',
    '画布 1000×562.5，每个元件都有 id（整份唯一）、type、frame:{x,y,w,h,rotate}。type：text（paragraphs:[{runs:[{text}]}]＋box:{font,size,color,align,valign,lineHeight,padding}）、image（src,fit）、video（src,fit）、shape（shape,fill,stroke,text）、table、chart、program（html/css 动画）、group（children）。',
    '颜色写 "#RRGGBB" 或 "theme:text／theme:accent／theme:bg…"，字体写 "theme:heading／theme:body"。详细栏位见 FORMAT.md。',
  ].join('\n'),
  en: [
    'Format: project.json = {"format":"dilin-studio/slides","version":1,"name":"…","deck":{"version":2,"lang":"zh-TW","themeId":"…","pages":[…]}}; media files go in assets/ and are referenced as "assets/<file name>".',
    'A page: {"pid":"…","layoutId":"blank","draft":{"type":"content","title":"","items":[]},"background":{"color":"#FFFFFF"},"components":[…],"animations":[…]}. A page with "components" is drawn exactly from them; without, it is laid out from layoutId + draft.',
    'The slide is 1000×562.5. Every component has id (unique in the deck), type, frame:{x,y,w,h,rotate}. Types: text (paragraphs:[{runs:[{text}]}] + box:{font,size,color,align,valign,lineHeight,padding}), image (src,fit), video (src,fit), shape (shape,fill,stroke,text), table, chart, program (HTML/CSS animation), group (children).',
    'Colours are "#RRGGBB" or "theme:text / theme:accent / theme:bg…"; fonts "theme:heading / theme:body". Full field list: FORMAT.md.',
  ].join('\n'),
}

export const slidesFormat: StudioFormat<SlidesDoc> = {
  version: SLIDES_FORMAT_VERSION,
  emptyProject: () => emptySlidesDoc(),
  async load(store: ProjectStore): Promise<SlidesDoc> {
    const j = await readProjectJson(store, 'slides', SLIDES_FORMAT_VERSION)
    return j ? slidesDocFromJson(j) : emptySlidesDoc()
  },
  save: (store: ProjectStore, doc: SlidesDoc) => writeProjectJson(store, 'slides', SLIDES_FORMAT_VERSION, slidesDocToJson(doc)),
  summaryForAI: (lang: StudioLang) => SUMMARY[lang],
}
