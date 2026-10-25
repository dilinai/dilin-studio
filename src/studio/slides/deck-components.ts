// ════════════════════════════════════════════════════════════════════════════
// aislides v2 deck · 组件操作纯函数层
//
//   编辑器 PATCH /api/aislides/v2/deck 与 agent 工具 POST /api/aislides/v2/components 共用这一组函数（同一口径·同一闸）。
//   规则：
//     - 读时转换：没物化的页＝版式蓝图派生（slide-kit/components/derive）；
//     - 首次被组件／动画操作动到的页才「物化」＝把派生结果写进 page.components（手动排版层一并收进 html 组件·摘掉 htmlOverride）；
//     - 标题回写：role 为 title／subtitle／lead 的文字组件改字 ⇒ 纯文字回写 draft 同名栏（目录重建／data-title／简报名同步照旧靠 draft）；
//     - 目录：有任何一张目录页已物化 ⇒ 不再自动重建（用户拥有这页·清单给「按章节重建目录」＝toc_rebuild）。
//   🔴 客户端安全：只依赖纯函数层（aislides-deck-edit／slide-kit），⛔ import supabase／react-dom/server。
// ════════════════════════════════════════════════════════════════════════════

import {
  addDeckPage,
  BLANK_LAYOUT_ID,
  exceedsPageCapAfter,
  manualDeckPageCap,
  newPagePid,
  normalizeDeckStructure,
  resolveDeckPageByPid,
  type DeckDataV2,
  type DeckPageV2,
} from './deck-edit'
import { cleanText, DRAFT_LIMITS } from './kit/pipeline/schema'
import type { LayoutLocale, PageDraft, SlotImageValue } from './kit/types'
import { CANVAS_HEIGHT, CANVAS_WIDTH, isLayoutRelation } from './kit/types'
import { pageComponents, pageKeyOf } from './kit/components/derive'
import { plainTextOf, textBodyOf } from './kit/components/resolve'
import { blueprintComponents } from './kit/components/blueprints'
import { getLayout, layoutItemCapacity } from './kit/registry'
import { getTheme, THEMES } from './kit/themes'
import { isSkinId, skinDecorComponents } from './kit/skins'   // 
import { hashSeed } from './kit/engine/pick-layout'
import type { Theme } from './kit/types'
import {
  applyComponentPatch,
  applyFramePatch,
  ComponentInputError,
  evenColWidths,
  normAnimSpec,
  normMediaStep,
  normProgramStep,
  normalizePageBackground,
  normalizePageTransition,
} from './kit/components/validate'
import { DEFAULT_PROGRAM_CSS, DEFAULT_PROGRAM_DESIGN, DEFAULT_PROGRAM_HTML } from './kit/components/program'
import { boundsOfFrames, childToPage, pageToChild, scaleChildFrame } from './kit/components/geom'
import {
  COMPONENT_ID_RE,
  COMPONENT_LIMITS,
  CREATABLE_COMPONENT_TYPES,
  SHAPE_KINDS,
  type AnimPhase,
  type ComponentOp,
  type Frame,
  type GroupComponent,
  type AnimOrderRef,
  type MediaStepSpec,
  type NewComponentInput,
  type PageTransition,
  type ProgramStepSpec,
  type SlideAnimation,
  type SlideComponent,
  type TextParagraph,
  type ZMove,
} from './kit/components/types'

export type ComponentOpError =
  | 'bad_page_index'
  | 'page_gone'
  | 'component_not_found'
  | 'bad_field'
  | 'field_not_for_type'
  | 'text_too_long'
  | 'too_many_components'
  | 'too_many_animations'
  | 'too_many_programs'   // 一页程序动画（含组合里的）满了
  | 'bad_animation_order'
  | 'bad_component_type'
  | 'deck_full'
  | 'last_page'
  | 'bad_op'
  | 'bad_layout'       // 版式不在版式库／页型对不上
  | 'too_many_items'   // 这页的条目比目标版式装得下的多

export type ComponentOpResult =
  | {
      ok: true
      deck: DeckDataV2
      /** 封面标题组件被改过（含清空）⇒ route 同步行标题 */
      coverTitle?: string
      /** 操作后前端应选中的页序（加页／移页／目录连带增减） */
      targetPageIndex?: number
      /** 新增组件的编号（component_add） */
      componentId?: string
      /** 新增的是组合 ⇒ 子件编号（与入参 children 同序）·撤销「删整组」要把子件的动画挂回新编号 */
      childIds?: string[]
    }
  | { ok: false; error: ComponentOpError; field?: string }

const fail = (error: ComponentOpError, field?: string): ComponentOpResult => ({ ok: false, error, ...(field ? { field } : {}) })

const localeOf = (deck: DeckDataV2): LayoutLocale => (deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW')

function randId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const raw = typeof c?.randomUUID === 'function' ? c.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `${prefix}${raw.slice(0, 10)}`
}

/* ------------------------------------------------------------------ */
/* 定位                                                                */
/* ------------------------------------------------------------------ */

/** 一页组件里找编号：顶层 ⇒ {index}；组合里的子件 ⇒ {index＝组的位置, child＝组内位置} */
export function findInComps(comps: readonly SlideComponent[], id: string): { index: number; child?: number } | null {
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]
    if (c.id === id) return { index: i }
    if (c.type === 'group') {
      const k = c.children.findIndex((ch) => ch.id === id)
      if (k >= 0) return { index: i, child: k }
    }
  }
  return null
}

/** 一页（含组内子件）的全部编号 */
export function allComponentIds(comps: readonly SlideComponent[]): string[] {
  return comps.flatMap((c) => (c.type === 'group' ? [c.id, ...c.children.map((ch) => ch.id)] : [c.id]))
}

/** 全份所有页的组件（派生或已物化·含组内子件）·编号 ⇒ 页序（child＝组内位置） */
export function locateComponent(deck: DeckDataV2, componentId: string): { pageIndex: number; index: number; child?: number } | null {
  if (typeof componentId !== 'string' || !COMPONENT_ID_RE.test(componentId)) return null
  const loc = localeOf(deck)
  for (let i = 0; i < deck.pages.length; i++) {
    const f = findInComps(pageComponents(deck.pages[i], i, loc), componentId)
    if (f) return { pageIndex: i, ...f }
  }
  // 老页补 pid 之前派生的编号（i<页序>.<键>）⇒ 换成现 pid 再找一次
  const m = /^i(\d+)\.(.+)$/.exec(componentId)
  if (m) {
    const i = Number(m[1])
    const page = deck.pages[i]
    if (page?.pid) {
      const f = findInComps(pageComponents(page, i, loc), `${page.pid}.${m[2]}`)
      if (f) return { pageIndex: i, ...f }
    }
  }
  return null
}

/** 改组框：宽高变了 ⇒ 子件局部框照比例缩（存的永远是现尺寸下的局部坐标） */
export function withGroupFrame(g: GroupComponent, frame: Frame): GroupComponent {
  const sx = g.frame.w > 0 ? frame.w / g.frame.w : 1
  const sy = g.frame.h > 0 ? frame.h / g.frame.h : 1
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return { ...g, frame }
  return { ...g, frame, children: g.children.map((ch) => ({ ...ch, frame: scaleChildFrame(ch.frame, sx, sy) }) as SlideComponent) }
}

/** 页定位：pid 优先（在本快照上解）·否则按页序 */
export function resolvePageRef(deck: DeckDataV2, ref: { pageIndex: number; pageId?: string }): number | 'page_gone' | 'bad_page_index' {
  if (typeof ref.pageId === 'string' && ref.pageId) {
    const r = resolveDeckPageByPid(deck, ref.pageId, ref.pageIndex)
    if (r.kind === 'found') return r.index
    if (r.kind === 'gone') return 'page_gone'
  }
  return Number.isInteger(ref.pageIndex) && ref.pageIndex >= 0 && ref.pageIndex < deck.pages.length ? ref.pageIndex : 'bad_page_index'
}

/* ------------------------------------------------------------------ */
/* 物化                                                                */
/* ------------------------------------------------------------------ */

/** 把第 i 页物化（已物化＝原样）：派生结果写进 components·手动排版层已收进 html 组件 ⇒ 摘掉 htmlOverride */
export function materializePage(deck: DeckDataV2, i: number): DeckDataV2 {
  const page = deck.pages[i]
  if (!page || Array.isArray(page.components)) return deck
  const comps = structuredClone(pageComponents(page, i, localeOf(deck)))
  const np: DeckPageV2 = { ...page, components: comps }
  delete np.htmlOverride
  return { ...deck, pages: deck.pages.map((p, j) => (j === i ? np : p)) }
}

function withPage(deck: DeckDataV2, i: number, fn: (p: DeckPageV2) => DeckPageV2): DeckDataV2 {
  return { ...deck, pages: deck.pages.map((p, j) => (j === i ? fn(p) : p)) }
}

/* ------------------------------------------------------------------ */
/* 标题回写 · 目录                                                      */
/* ------------------------------------------------------------------ */

/** 标题类组件改字 ⇒ 回写 draft 同名栏；回 { draft, coverTitle?, tocDirty } */
function writeBackTitle(draft: PageDraft, comp: SlideComponent): { draft: PageDraft; coverTitle?: string; tocDirty: boolean } {
  if (comp.type !== 'text' || !comp.role || !['title', 'subtitle', 'lead'].includes(comp.role)) return { draft, tocDirty: false }
  const plain = plainTextOf(comp.paragraphs).replace(/\n+/g, ' ')
  const clean = (max: number) => cleanText(plain, max)
  switch (draft.type) {
    case 'cover':
      if (comp.role === 'title') { const t = clean(DRAFT_LIMITS.title); return { draft: { ...draft, title: t }, coverTitle: t, tocDirty: false } }
      if (comp.role === 'subtitle') { const t = clean(DRAFT_LIMITS.subtitle); const d = { ...draft }; if (t) d.subtitle = t; else delete d.subtitle; return { draft: d, tocDirty: false } }
      return { draft, tocDirty: false }
    case 'transition':
      if (comp.role === 'title') return { draft: { ...draft, title: clean(DRAFT_LIMITS.title) }, tocDirty: true }
      if (comp.role === 'lead') { const t = clean(DRAFT_LIMITS.lead); const d = { ...draft }; if (t) d.lead = t; else delete d.lead; return { draft: d, tocDirty: false } }
      return { draft, tocDirty: false }
    case 'content':
      if (comp.role === 'title') return { draft: { ...draft, title: clean(DRAFT_LIMITS.title) }, tocDirty: true }
      return { draft, tocDirty: false }
    case 'end':
      if (comp.role === 'title') { const t = clean(DRAFT_LIMITS.title); const d = { ...draft }; if (t) d.title = t; else delete d.title; return { draft: d, tocDirty: false } }
      if (comp.role === 'subtitle') { const t = clean(DRAFT_LIMITS.subtitle); const d = { ...draft }; if (t) d.subtitle = t; else delete d.subtitle; return { draft: d, tocDirty: false } }
      return { draft, tocDirty: false }
    default:
      return { draft, tocDirty: false }
  }
}

/**
 * 页结构变了（加删移页／章节标题改了）之后的目录处理：
 *   有目录页已物化 ⇒ 只重编章序（partNo）·目录页不动（用户拥有它）；否则照旧整套重建（normalizeDeckStructure）。
 * 回 { deck, index }：index＝原本 targetPid 那页的新位置（-1＝找不到）。
 */
function settleStructure(deck: DeckDataV2, targetPid?: string): { deck: DeckDataV2; index: number } {
  const tocMaterialized = deck.pages.some((p) => p.draft.type === 'contents' && Array.isArray(p.components))
  let next: DeckDataV2
  if (tocMaterialized) {
    let seq = 0
    next = { ...deck, pages: deck.pages.map((p) => (p.draft.type === 'transition' ? { ...p, draft: { ...p.draft, partNo: seq++ } } : p)) }
  } else {
    next = normalizeDeckStructure(deck)
  }
  const index = targetPid ? next.pages.findIndex((p) => p.pid === targetPid) : -1
  return { deck: next, index }
}

/* ------------------------------------------------------------------ */
/* 叠层                                                                */
/* ------------------------------------------------------------------ */

export function moveZ<T>(arr: readonly T[], from: number, z: ZMove): T[] {
  const out = [...arr]
  const [item] = out.splice(from, 1)
  let to: number
  if (z === 'top') to = out.length
  else if (z === 'bottom') to = 0
  else if (z === 'up') to = Math.min(out.length, from + 1)
  else if (z === 'down') to = Math.max(0, from - 1)
  else to = Math.max(0, Math.min(out.length, Math.round(z)))
  out.splice(to, 0, item)
  return out
}

function isZMove(v: unknown): v is ZMove {
  return v === 'top' || v === 'bottom' || v === 'up' || v === 'down' || (typeof v === 'number' && Number.isFinite(v))
}

/* ------------------------------------------------------------------ */
/* 新增组件的缺省                                                        */
/* ------------------------------------------------------------------ */

function centered(w: number, h: number): Frame {
  return { x: Math.round((CANVAS_WIDTH - w) / 2), y: Math.round(((CANVAS_HEIGHT - h) / 2) * 10) / 10, w, h, rotate: 0 }
}

export function defaultComponent(type: SlideComponent['type'], id: string, shape?: string): SlideComponent {
  switch (type) {
    case 'text':
      return { id, type, frame: centered(360, 80), paragraphs: [{ runs: [] }], box: { font: 'theme:body', size: 24, color: 'theme:text', align: 'left', valign: 'top', lineHeight: 1.4, padding: 4 } }
    case 'image':
      return { id, type, frame: centered(400, 300), src: '', fit: 'cover' }
    case 'video':
      return { id, type, frame: centered(480, 270), src: '', fit: 'contain', controls: true }
    case 'shape': {
      const kind = (SHAPE_KINDS as readonly string[]).includes(shape ?? '') ? (shape as (typeof SHAPE_KINDS)[number]) : 'rect'
      if (kind === 'line') return { id, type, frame: centered(320, 20), shape: 'line', fill: null, stroke: { color: 'theme:text', width: 3 } }
      if (kind === 'arc') return { id, type, frame: centered(240, 240), shape: 'arc', fill: null, stroke: { color: 'theme:accent', width: 6 }, arc: { start: 180, end: 90 } }
      if (kind === 'ring' || kind === 'summingJunction') return { id, type, frame: centered(240, 240), shape: kind, fill: 'theme:accent', stroke: kind === 'summingJunction' ? { color: 'theme:text', width: 2 } : null }
      if (kind === 'callout') return { id, type, frame: centered(260, 140), shape: 'callout', fill: 'theme:accent', stroke: null, radius: 16, callout: { side: 'bottom', pos: 25, len: 40 } }
      return { id, type, frame: centered(240, 160), shape: kind, fill: 'theme:accent', stroke: null, ...(kind === 'roundRect' ? { radius: 16 } : {}) }
    }
    case 'table':
      return {
        id, type, frame: centered(600, 200),
        cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ paragraphs: [{ runs: [] }] }))),
        colWidths: evenColWidths(3), header: true,
        style: { font: 'theme:body', size: 16, color: 'theme:text', headerFill: 'theme:accent', headerColor: 'theme:onAccent', borderColor: 'theme:border' },
      }
    case 'chart':
      return {
        id, type, frame: centered(560, 320), chart: 'column',
        labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '1', values: [3, 5, 2, 6] }], legend: false, showValues: false,
      }
    case 'program':
      // 能动的默认范例（三步小火箭）：新增菜单与 AI 不给 html 时都是它
      return {
        id, type, frame: centered(DEFAULT_PROGRAM_DESIGN.w, DEFAULT_PROGRAM_DESIGN.h),
        html: DEFAULT_PROGRAM_HTML, css: DEFAULT_PROGRAM_CSS, designW: DEFAULT_PROGRAM_DESIGN.w, designH: DEFAULT_PROGRAM_DESIGN.h, steps: 3,
      }
    default:
      throw new ComponentInputError('bad_component_type', 'type')
  }
}

/** 新编号（不撞 taken·用了就登记进去） */
function freshId(taken: Set<string>, prefix: string): string {
  let id = randId(prefix)
  while (taken.has(id)) id = randId(prefix)
  taken.add(id)
  return id
}

/** 新增入参 ⇒ 组件（逐栏白名单）；type=group ＝整组（子件各自同一套·框是组内局部坐标） */
function buildComponent(input: Record<string, unknown>, taken: Set<string>): SlideComponent {
  if (input.type === 'group') {
    const kidsIn = input.children
    if (!Array.isArray(kidsIn) || kidsIn.length === 0 || kidsIn.length > COMPONENT_LIMITS.groupChildren) throw new ComponentInputError('bad_field', 'children')
    const children = kidsIn.map((k, n) => {
      if (!k || typeof k !== 'object' || (k as Record<string, unknown>).type === 'group') throw new ComponentInputError('bad_component_type', `children[${n}].type`)
      if (!(CREATABLE_COMPONENT_TYPES as readonly string[]).includes((k as Record<string, unknown>).type as string)) throw new ComponentInputError('bad_component_type', `children[${n}].type`)
      return buildComponent(k as Record<string, unknown>, taken)
    })
    const ext = { w: Math.max(1, ...children.map((c) => c.frame.x + c.frame.w)), h: Math.max(1, ...children.map((c) => c.frame.y + c.frame.h)) }
    let frame = centered(Math.round(ext.w * 100) / 100, Math.round(ext.h * 100) / 100)
    if (input.frame !== undefined) frame = applyFramePatch(frame, input.frame)
    let g: SlideComponent = { id: freshId(taken, 'g'), type: 'group', frame, children }
    const rest: Record<string, unknown> = {}
    for (const k of ['name', 'locked', 'hidden', 'opacity', 'morphKey']) if (input[k] !== undefined) rest[k] = input[k]
    for (const k of Object.keys(input)) if (input[k] !== undefined && !['type', 'frame', 'children', 'name', 'locked', 'hidden', 'opacity', 'morphKey'].includes(k)) throw new ComponentInputError('field_not_for_type', k)
    if (Object.keys(rest).length) g = applyComponentPatch(g, rest)
    return g
  }
  const id = freshId(taken, 'c')
  let comp = defaultComponent(input.type as SlideComponent['type'], id, typeof input.shape === 'string' ? input.shape : undefined)
  // 自带程序 ⇒ 范例的样式／步数／设计尺寸不跟进来（没给设计尺寸＝组件框原尺寸）
  if (comp.type === 'program' && input.html !== undefined) { delete comp.css; delete comp.steps; delete comp.designW; delete comp.designH }
  if (input.frame !== undefined) comp = { ...comp, frame: applyFramePatch(comp.frame, input.frame) } as SlideComponent
  const rest: Record<string, unknown> = { ...input }
  delete rest.type; delete rest.frame
  if (comp.type === 'shape') delete rest.shape
  if (Object.keys(rest).length) comp = applyComponentPatch(comp, rest)
  return comp
}

/** 页的切换：null／type none ＝摘掉 */
function setTransition(np: DeckPageV2, raw: unknown): void {
  const tr: PageTransition | null = raw === null ? null : normalizePageTransition(raw)
  if (tr && tr.type !== 'none') np.transition = tr; else delete np.transition
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/** 把一笔组件／页操作套到 deck（纯函数·不改入参）。前置：调用方已 ensureDeckPagePids。 */
export function applyComponentOp(deck: DeckDataV2, op: ComponentOp): ComponentOpResult {
  try {
    const r = applyInner(deck, op)
    // 一页程序动画总数闸（含组合后代）——任何一笔操作做完、哪一页超过上限又比做之前多 ⇒ 这笔拒
    //   （加含程序的组合、parentId 加进组合、复制页……都在这里一起管·不靠各 op 自己记得数；旧资料本来就超的·不增加的操作照放）
    if (r.ok && programCapExceededAfter(deck, r.deck)) return fail('too_many_programs')
    return r
  } catch (e) {
    if (e instanceof ComponentInputError) return fail(e.code as ComponentOpError, e.field)
    throw e
  }
}

function applyInner(deck0: DeckDataV2, op: ComponentOp): ComponentOpResult {
  switch (op.kind) {
    case 'component_update':
    case 'component_frame':
    case 'component_order':
    case 'component_delete':
    case 'animation_set': {
      const loc = locateComponent(deck0, op.componentId)
      if (!loc) return fail('component_not_found', 'componentId')
      let deck = materializePage(deck0, loc.pageIndex)
      const page = deck.pages[loc.pageIndex]
      const comps = page.components as SlideComponent[]
      const idx = loc.index
      const parent = loc.child !== undefined ? (comps[idx] as GroupComponent) : null
      const cur = parent ? parent.children[loc.child!] : comps[idx]
      // 换掉／删掉 cur（组内子件＝改组的 children；组删到一个不剩＝整组删）
      const put = (next: SlideComponent | null, z?: ZMove): SlideComponent[] => {
        if (!parent) {
          let arr = next ? comps.map((c, i) => (i === idx ? next : c)) : comps.filter((_, i) => i !== idx)
          if (next && z !== undefined) arr = moveZ(arr, idx, z)
          return arr
        }
        let kids = next ? parent.children.map((c, i) => (i === loc.child ? next : c)) : parent.children.filter((_, i) => i !== loc.child)
        if (next && z !== undefined) kids = moveZ(kids, loc.child!, z)
        return kids.length ? comps.map((c, i) => (i === idx ? ({ ...parent, children: kids } as SlideComponent) : c)) : comps.filter((_, i) => i !== idx)
      }
      if (op.kind === 'component_update') {
        const next = applyComponentPatch(cur, op.patch)
        const nextComps = put(next)
        const wb = writeBackTitle(page.draft, next)
        deck = withPage(deck, loc.pageIndex, (p) => ({ ...p, components: nextComps, draft: wb.draft }))
        let targetPageIndex = loc.pageIndex
        let out: DeckDataV2 = deck
        if (wb.tocDirty) {
          const settled = settleStructure(deck, page.pid)
          if (exceedsPageCapAfter(deck0, settled.deck)) return fail('deck_full')
          out = settled.deck
          if (settled.index >= 0) targetPageIndex = settled.index
        }
        if (wb.coverTitle !== undefined) out = { ...out, outline: { ...(out.outline ?? {}), title: wb.coverTitle } }
        return { ok: true, deck: out, targetPageIndex, ...(wb.coverTitle !== undefined ? { coverTitle: wb.coverTitle } : {}) }
      }
      if (op.kind === 'component_frame') {
        const frame = applyFramePatch(cur.frame, op.frame ?? {})
        // 组合拉宽高 ⇒ 子件跟着按比例缩
        const next = cur.type === 'group' ? withGroupFrame(cur, frame) : ({ ...cur, frame } as SlideComponent)
        if (op.z !== undefined && !isZMove(op.z)) return fail('bad_field', 'z')
        return { ok: true, deck: withPage(deck, loc.pageIndex, (p) => ({ ...p, components: put(next, op.z) })), targetPageIndex: loc.pageIndex }
      }
      if (op.kind === 'component_order') {
        if (!isZMove(op.z)) return fail('bad_field', 'z')
        return { ok: true, deck: withPage(deck, loc.pageIndex, (p) => ({ ...p, components: put(cur, op.z) })), targetPageIndex: loc.pageIndex }
      }
      if (op.kind === 'component_delete') {
        const nextComps = put(null)
        const live = new Set(allComponentIds(nextComps))
        return {
          ok: true,
          deck: withPage(deck, loc.pageIndex, (p) => {
            const np: DeckPageV2 = { ...p, components: nextComps }
            const anims = (p.animations ?? []).filter((a) => live.has(a.componentId))
            if (anims.length) np.animations = anims; else delete np.animations
            return np
          }),
          targetPageIndex: loc.pageIndex,
        }
      }
      // animation_set
      let anims: SlideAnimation[] = [...(page.animations ?? [])]
      for (const phase of ['enter', 'emphasis', 'exit'] as AnimPhase[]) {
        if (!(phase in op)) continue
        const v = (op as Record<string, unknown>)[phase]
        if (v === undefined) continue
        const at = anims.findIndex((a) => a.componentId === cur.id && a.phase === phase)
        if (v === null) { if (at >= 0) anims.splice(at, 1); continue }
        const spec = normAnimSpec(v, phase, phase)
        const next: SlideAnimation = { id: at >= 0 ? anims[at].id : randId('a'), componentId: cur.id, phase, ...spec }
        if (next.direction === undefined) delete next.direction
        if (at >= 0) anims[at] = next
        else anims.push(next)
      }
      // 影片步骤（只挂 video）／程序步骤（只挂 program）：整组换·已有的按序原位换（位置不变）·多的接最后·少的删
      for (const phase of ['media', 'program'] as const) {
        const v = (op as Record<string, unknown>)[phase]
        if (v === undefined) continue
        if (v !== null && cur.type !== (phase === 'media' ? 'video' : 'program')) return fail('field_not_for_type', phase)
        if (v !== null && !Array.isArray(v)) return fail('bad_field', phase)
        const list = (v ?? []) as unknown[]
        if (list.length > COMPONENT_LIMITS.animationsPerPage) return fail('too_many_animations')
        const specs = list.map((x, i) => (phase === 'media' ? normMediaStep(x, `${phase}[${i}]`) : normProgramStep(x, `${phase}[${i}]`)))
        const mine = anims.map((a, i) => (a.componentId === cur.id && a.phase === phase ? i : -1)).filter((i) => i >= 0)
        const built: SlideAnimation[] = specs.map((s, k) => {
          const id = k < mine.length ? anims[mine[k]].id : randId('a')
          if (phase === 'media') {
            const m = s as MediaStepSpec
            return { id, componentId: cur.id, phase: 'media', effect: m.effect, ...(m.seekSec !== undefined ? { seekSec: m.seekSec } : {}), trigger: m.trigger, durationMs: 0, delayMs: m.delayMs }
          }
          const p = s as ProgramStepSpec
          return { id, componentId: cur.id, phase: 'program', effect: 'step', trigger: p.trigger, durationMs: p.durationMs ?? 0, delayMs: p.delayMs }
        })
        mine.forEach((at, k) => { if (k < built.length) anims[at] = built[k] })
        const drop = new Set(mine.slice(built.length))
        anims = [...anims.filter((_, i) => !drop.has(i)), ...built.slice(mine.length)]
      }
      if (anims.length > COMPONENT_LIMITS.animationsPerPage) return fail('too_many_animations')
      const liveIds = new Set(allComponentIds(comps))
      anims = anims.filter((a) => liveIds.has(a.componentId))
      return {
        ok: true,
        deck: withPage(deck, loc.pageIndex, (p) => { const np: DeckPageV2 = { ...p }; if (anims.length) np.animations = anims; else delete np.animations; return np }),
        targetPageIndex: loc.pageIndex,
      }
    }

    case 'component_add': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      const input = op.component as unknown as Record<string, unknown>
      if (!input || typeof input !== 'object') return fail('bad_field', 'component')
      const type = input.type
      if (type !== 'group' && !(CREATABLE_COMPONENT_TYPES as readonly string[]).includes(type as string)) return fail('bad_component_type', 'type')
      let deck = materializePage(deck0, i)
      const comps = deck.pages[i].components as SlideComponent[]
      const taken = new Set(deck.pages.flatMap((p, j) => allComponentIds(pageComponents(p, j, localeOf(deck)))))
      if (op.z !== undefined && !isZMove(op.z)) return fail('bad_field', 'z')
      // 一页的程序动画（含组合里的）有上限·旧资料超过的渲染时只画占位
      if (type === 'program' && programCount(comps) >= COMPONENT_LIMITS.programsPerPage) return fail('too_many_programs')
      // 加进组合里（撤销「删组内子件」）：parentId＝本页顶层的组合
      if (op.parentId !== undefined) {
        const gi = comps.findIndex((c) => c.id === op.parentId)
        const g = comps[gi]
        if (!g || g.type !== 'group') return fail('component_not_found', 'parentId')
        if (type === 'group') return fail('bad_component_type', 'type')
        if (g.children.length >= COMPONENT_LIMITS.groupChildren) return fail('too_many_components')
        const child = buildComponent(input, taken)
        let kids = [...g.children, child]
        if (op.z !== undefined) kids = moveZ(kids, kids.length - 1, op.z)
        deck = withPage(deck, i, (p) => ({ ...p, components: comps.map((c, k) => (k === gi ? ({ ...g, children: kids } as SlideComponent) : c)) }))
        return { ok: true, deck, targetPageIndex: i, componentId: child.id }
      }
      if (comps.length >= COMPONENT_LIMITS.perPage) return fail('too_many_components')
      const comp = buildComponent(input, taken)
      let nextComps = [...comps, comp]
      if (op.z !== undefined) nextComps = moveZ(nextComps, nextComps.length - 1, op.z)
      deck = withPage(deck, i, (p) => ({ ...p, components: nextComps }))
      return { ok: true, deck, targetPageIndex: i, componentId: comp.id, ...(comp.type === 'group' ? { childIds: comp.children.map((c) => c.id) } : {}) }
    }

    case 'component_group': {
      const ids = Array.isArray(op.componentIds) ? op.componentIds : []
      if (ids.length < 2 || ids.length > COMPONENT_LIMITS.groupChildren || new Set(ids).size !== ids.length) return fail('bad_field', 'componentIds')
      const locs = ids.map((id) => locateComponent(deck0, id))
      if (locs.some((l) => !l)) return fail('component_not_found', 'componentIds')
      const pi = locs[0]!.pageIndex
      if (locs.some((l) => l!.pageIndex !== pi || l!.child !== undefined)) return fail('bad_field', 'componentIds')
      let deck = materializePage(deck0, pi)
      const comps = deck.pages[pi].components as SlideComponent[]
      const idxs = locs.map((l) => l!.index).sort((a, b) => a - b)
      const members = idxs.map((k) => comps[k])
      if (members.some((c) => c.type === 'group' || c.type === 'html')) return fail('bad_component_type', 'componentIds')
      const taken = new Set(deck.pages.flatMap((p, j) => allComponentIds(pageComponents(p, j, localeOf(deck)))))
      let gid = typeof op.groupId === 'string' && COMPONENT_ID_RE.test(op.groupId) && !taken.has(op.groupId) ? op.groupId : randId('g')
      while (taken.has(gid)) gid = randId('g')
      const gframe = op.frame !== undefined ? applyFramePatch(boundsOfFrames(members.map((c) => c.frame)), op.frame) : boundsOfFrames(members.map((c) => c.frame))
      const group: GroupComponent = { id: gid, type: 'group', frame: gframe, children: members.map((c) => ({ ...c, frame: pageToChild(gframe, c.frame) }) as SlideComponent) }
      const rest = comps.filter((_, k) => !idxs.includes(k))
      const at = idxs[idxs.length - 1] - (idxs.length - 1)   // 最上面那个成员原本的叠层位置
      rest.splice(at, 0, group)
      deck = withPage(deck, pi, (p) => ({ ...p, components: rest }))
      return { ok: true, deck, targetPageIndex: pi, componentId: gid }
    }

    case 'component_ungroup': {
      const loc = locateComponent(deck0, op.componentId)
      if (!loc || loc.child !== undefined) return fail('component_not_found', 'componentId')
      let deck = materializePage(deck0, loc.pageIndex)
      const comps = deck.pages[loc.pageIndex].components as SlideComponent[]
      const g = comps[loc.index]
      if (g.type !== 'group') return fail('bad_component_type', 'componentId')
      const gop = typeof g.opacity === 'number' ? g.opacity : 1
      const kids = g.children.map((ch) => {
        const out = { ...ch, frame: childToPage(g.frame, ch.frame) } as SlideComponent
        const o = Math.round((typeof ch.opacity === 'number' ? ch.opacity : 1) * gop * 100) / 100
        if (o < 1) out.opacity = o; else delete out.opacity
        if (g.hidden) out.hidden = true
        return out
      })
      const next = [...comps.slice(0, loc.index), ...kids, ...comps.slice(loc.index + 1)]
      deck = withPage(deck, loc.pageIndex, (p) => {
        const np: DeckPageV2 = { ...p, components: next }
        const anims = (p.animations ?? []).filter((a) => a.componentId !== g.id)
        if (anims.length) np.animations = anims; else delete np.animations
        return np
      })
      return { ok: true, deck, targetPageIndex: loc.pageIndex }
    }

    case 'page_update': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      const patch = op.patch as unknown as Record<string, unknown>
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('bad_field', 'patch')
      for (const k of Object.keys(patch)) if (patch[k] !== undefined && k !== 'background' && k !== 'transition') return fail('field_not_for_type', k)
      const np: DeckPageV2 = { ...deck0.pages[i] }
      if (patch.background !== undefined) {
        const bg = patch.background === null ? null : normalizePageBackground(patch.background)
        if (bg && Object.keys(bg).length) np.background = bg; else delete np.background
      }
      if (patch.transition !== undefined) setTransition(np, patch.transition)
      return { ok: true, deck: withPage(deck0, i, () => np), targetPageIndex: i }
    }

    case 'transition_all': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      const tr = op.transition === null ? null : normalizePageTransition(op.transition)
      return { ok: true, deck: { ...deck0, pages: deck0.pages.map((p) => { const np = { ...p }; setTransition(np, tr); return np }) }, targetPageIndex: i }
    }

    case 'animation_order': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      const deck = materializePage(deck0, i)
      const anims = deck.pages[i].animations ?? []
      const raw = Array.isArray(op.order) ? op.order : null
      if (!raw) return fail('bad_animation_order', 'order')
      // 「组件＋阶段＋第几条」点名 ⇒ 换成动画编号（刚重新新增回来的组件·动画编号是服务端新发的·点名才排得回去）
      const order = raw.map((x) => (typeof x === 'string' ? x : resolveAnimRef(anims, x)))
      if (order.length !== anims.length || order.some((id) => !id) || new Set(order).size !== order.length) return fail('bad_animation_order', 'order')
      const byId = new Map(anims.map((a) => [a.id, a]))
      if (!order.every((id) => byId.has(id!))) return fail('bad_animation_order', 'order')
      return { ok: true, deck: withPage(deck, i, (p) => ({ ...p, animations: order.map((id) => byId.get(id!)!) })), targetPageIndex: i }
    }

    case 'page_add': {
      const kind = op.pageKind
      const afterRef = typeof op.afterPageId === 'string' && op.afterPageId
        ? resolvePageRef(deck0, { pageIndex: op.afterIndex, pageId: op.afterPageId })
        : (Number.isInteger(op.afterIndex) && op.afterIndex >= -1 && op.afterIndex < deck0.pages.length ? op.afterIndex : 'bad_page_index')
      if (typeof afterRef !== 'number') return fail(afterRef)
      // 点名版式：页型跟版式走（content／transition 版式才能加·明说的 kind 要对得上·复制页不收）
      if (op.layoutId !== undefined) {
        if (kind === 'duplicate') return fail('bad_field', 'layoutId')
        const meta = typeof op.layoutId === 'string' ? getLayout(op.layoutId)?.meta : undefined
        if (!meta || (meta.pageType !== 'content' && meta.pageType !== 'transition')) return fail('bad_layout', 'layoutId')
        if ((kind === 'content' || kind === 'transition') && kind !== meta.pageType) return fail('bad_layout', 'layoutId')
        const r = addDeckPage(deck0, afterRef, meta.pageType, { layoutId: meta.id })
        if (!r.ok) return fail(r.error === 'deck_full' ? 'deck_full' : r.error === 'bad_layout' ? 'bad_layout' : 'bad_op')
        return { ok: true, deck: r.deck, targetPageIndex: r.targetPageIndex }
      }
      if (kind === 'content' || kind === 'transition') {
        const r = addDeckPage(deck0, afterRef, kind)
        if (!r.ok) return fail(r.error === 'deck_full' ? 'deck_full' : 'bad_op')
        return { ok: true, deck: r.deck, targetPageIndex: r.targetPageIndex }
      }
      if (deck0.pages.length >= manualDeckPageCap()) return fail('deck_full')
      let newPage: DeckPageV2
      if (kind === 'blank') {
        // 套过 dilin-* 的 deck：空白页也铺该皮肤内容页装饰层（底色／缎带跟模板一致·上面空着给人放东西）
        const pid = newPagePid()
        const skinId = isSkinId(deck0.skinId) ? deck0.skinId : undefined
        newPage = { pid, layoutId: BLANK_LAYOUT_ID, ...(deck0.themeId ? { themeId: deck0.themeId } : {}), ...(skinId ? { skinId } : {}), draft: { type: 'content', title: '', items: [] }, components: skinId ? skinDecorComponents(skinId, 'content', pid) : [] }
      } else if (kind === 'duplicate') {
        const src = resolvePageRef(deck0, { pageIndex: op.sourceIndex ?? afterRef, pageId: op.sourcePageId })
        if (typeof src !== 'number') return fail(src)
        newPage = duplicatePage(deck0, src)
      } else {
        return fail('bad_op', 'pageKind')
      }
      const at = afterRef + 1
      const inserted: DeckDataV2 = { ...deck0, pages: [...deck0.pages.slice(0, at), newPage, ...deck0.pages.slice(at)] }
      const settled = settleStructure(inserted, newPage.pid)
      if (exceedsPageCapAfter(deck0, settled.deck)) return fail('deck_full')
      return { ok: true, deck: settled.deck, targetPageIndex: settled.index >= 0 ? settled.index : at }
    }

    case 'page_set_layout': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      if (typeof op.layoutId !== 'string' || !op.layoutId) return fail('bad_field', 'layoutId')
      if (deck0.pages[i].layoutId === op.layoutId) return { ok: true, deck: deck0, targetPageIndex: i }
      const r = relayoutPage(deck0, i, op.layoutId)
      if (!r.ok) return fail(r.error, r.error === 'bad_layout' ? 'layoutId' : undefined)
      return { ok: true, deck: withPage(deck0, i, () => r.page), targetPageIndex: i }
    }

    case 'page_move': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      if (!Number.isInteger(op.to)) return fail('bad_field', 'to')
      const to = Math.max(0, Math.min(deck0.pages.length - 1, op.to))
      const moved = { ...deck0, pages: moveZ(deck0.pages, i, to) }
      const settled = settleStructure(moved, deck0.pages[i].pid)
      if (exceedsPageCapAfter(deck0, settled.deck)) return fail('deck_full')
      return { ok: true, deck: settled.deck, targetPageIndex: settled.index >= 0 ? settled.index : to }
    }

    case 'page_restore_layout': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      const deck = withPage(deck0, i, (p) => {
        const np: DeckPageV2 = { ...p }
        delete np.components; delete np.animations; delete np.htmlOverride
        return np
      })
      const settled = settleStructure(deck, deck0.pages[i].pid)
      return { ok: true, deck: settled.deck, targetPageIndex: settled.index >= 0 ? settled.index : i }
    }

    case 'toc_rebuild': {
      const i = resolvePageRef(deck0, op)
      if (typeof i !== 'number') return fail(i)
      const pid = deck0.pages[i].pid
      const cleared: DeckDataV2 = {
        ...deck0,
        pages: deck0.pages.map((p) => {
          if (p.draft.type !== 'contents') return p
          const np: DeckPageV2 = { ...p }
          delete np.components; delete np.animations; delete np.htmlOverride
          return np
        }),
      }
      const settled = settleStructure(cleared, pid)
      if (exceedsPageCapAfter(deck0, settled.deck)) return fail('deck_full')
      return { ok: true, deck: settled.deck, targetPageIndex: settled.index >= 0 ? settled.index : Math.min(i, settled.deck.pages.length - 1) }
    }

    default:
      return fail('bad_op')
  }
}

/* ------------------------------------------------------------------ */
/* 换版式（page_set_layout 与编辑器换版式缩图共用）          */
/* ------------------------------------------------------------------ */

/** 一页组件摊平（组内子件也算·收字收图用） */
function flatComps(comps: readonly SlideComponent[]): SlideComponent[] {
  return comps.flatMap((c) => (c.type === 'group' ? [c, ...c.children] : [c]))
}

/** 文字组件在版式里的「位子」：role＋条目序＋（条目的）小标／正文——新旧版式同位子就把字搬过去 */
function slotKeyOf(c: SlideComponent, pageKey: string): string | null {
  if (!c.role || !textBodyOf(c)) return null
  const local = c.id.startsWith(`${pageKey}.`) ? c.id.slice(pageKey.length + 1) : ''
  const part = /-head$/.test(local) ? 'head' : /-body$/.test(local) ? 'body' : ''
  return `${c.role}:${c.roleIndex ?? ''}:${part}`
}

const compText = (c: SlideComponent): string => {
  const b = textBodyOf(c)
  return b ? plainTextOf(b.paragraphs) : ''
}

/** 已物化的页：按 role 从组件收回 draft（文字）与 images（图）——组件才是这页的真内容（draft 可能是旧的） */
function harvestPage(page: DeckPageV2, pageKey: string): { draft: PageDraft; images?: Record<string, SlotImageValue> } {
  const comps = flatComps(page.components ?? [])
  const images: Record<string, SlotImageValue> = { ...(page.images ?? {}) }
  for (const c of comps) {
    if (c.type !== 'image' || !c.role) continue
    const k = c.role === 'pageFigure' || c.role === 'background' ? c.role : c.role === 'itemFigure' && Number.isInteger(c.roleIndex) ? `itemFigure:${c.roleIndex}` : null
    if (!k) continue
    if (c.src) images[k] = c.crop ? { url: c.src, crop: c.crop } : c.src
    else delete images[k]
  }
  const d = page.draft
  let draft: PageDraft = d
  const byIndex = (role: string): Map<number, SlideComponent[]> => {
    const m = new Map<number, SlideComponent[]>()
    for (const c of comps) {
      if (c.role !== role || !textBodyOf(c) || !Number.isInteger(c.roleIndex)) continue
      const list = m.get(c.roleIndex!) ?? []
      list.push(c)
      m.set(c.roleIndex!, list)
    }
    return m
  }
  if (d.type === 'content') {
    const titleComp = comps.find((c) => c.role === 'title' && textBodyOf(c))
    const title = titleComp ? cleanText(compText(titleComp).replace(/\n+/g, ' '), DRAFT_LIMITS.title) : d.title
    const m = byIndex('item')
    let items = d.items
    // 一个条目组件都没有（版式本来就不放条目／全被删了）⇒ 留着 draft 原条目（宁可不丢字）
    if (m.size > 0) {
      items = []
      for (const idx of [...m.keys()].sort((a, b) => a - b)) {
        const list = m.get(idx)!
        const key = (c: SlideComponent) => (c.id.startsWith(`${pageKey}.`) ? c.id.slice(pageKey.length + 1) : '')
        let head = list.find((c) => /-head$/.test(key(c)))
        let body = list.find((c) => /-body$/.test(key(c)))
        if (!head && !body) { if (list.length >= 2) { head = list[0]; body = list[list.length - 1] } else body = list[0] }
        else if (!body) body = list.find((c) => c !== head)
        else if (!head) head = list.find((c) => c !== body)
        const heading = head ? cleanText(compText(head).replace(/\n+/g, ' '), DRAFT_LIMITS.heading) : ''
        const text = body ? cleanText(compText(body), DRAFT_LIMITS.body) : ''
        if (!heading && !text) continue
        items.push(heading ? { heading, body: text } : { body: text })
      }
    }
    draft = isLayoutRelation(d.relation) ? { type: 'content', title, items, relation: d.relation } : { type: 'content', title, items }
  } else if (d.type === 'contents') {
    const m = byIndex('contentsItem')
    if (m.size > 0) {
      const items = [...m.keys()].sort((a, b) => a - b)
        .map((idx) => cleanText(compText(m.get(idx)![0]).replace(/\n+/g, ' '), DRAFT_LIMITS.contentsItem)).filter(Boolean)
      draft = { type: 'contents', items }
    }
  }
  return { draft, ...(Object.keys(images).length ? { images } : {}) }
}

/** 文字本体换成这几段（text 组件本身／形状里的字） */
function withParagraphs(c: SlideComponent, paragraphs: TextParagraph[]): SlideComponent {
  if (c.type === 'text') return { ...c, paragraphs }
  if (c.type === 'shape' && c.text) return { ...c, text: { ...c.text, paragraphs } }
  return c
}

export type RelayoutResult = { ok: true; page: DeckPageV2 } | { ok: false; error: 'bad_layout' | 'too_many_items' }

/**
 * 把第 i 页换成 layoutId 版式（纯函数·不改入参）：
 *   - 版式要在版式库、页型＝这页的页型；条目数超过新版式容量 ⇒ too_many_items（⛔ 静默丢字）；
 *   - 没物化的页：只换 layoutId（draft／图原样·手动排版层作废）；
 *   - 已物化的页：先按 role 把组件里的字／图收回 draft／images，再按新版式蓝图重新物化——同一位子（role＋条目序＋小标／正文）
 *     的字连片段格式一起搬过去；自己加的组件（编号不是版式派生的）原样留在最上层；动画只留还在的组件的。
 */
export function relayoutPage(deck: DeckDataV2, i: number, layoutId: string): RelayoutResult {
  const page = deck.pages[i]
  const entry = getLayout(layoutId)
  if (!page || !entry || entry.meta.pageType !== page.draft.type) return { ok: false, error: 'bad_layout' }
  const key = pageKeyOf(page, i)
  const materialized = Array.isArray(page.components)
  const h = materialized ? harvestPage(page, key) : { draft: page.draft, images: page.images }
  const d = h.draft
  if ((d.type === 'content' || d.type === 'contents') && d.items.length > layoutItemCapacity(entry.meta)) return { ok: false, error: 'too_many_items' }
  const np: DeckPageV2 = { ...page, layoutId, draft: d }
  if (h.images && Object.keys(h.images).length) np.images = h.images; else delete np.images
  delete np.htmlOverride
  if (!materialized) return { ok: true, page: np }

  const fresh = blueprintComponents(layoutId, { pageKey: key, draft: d, images: np.images, locale: localeOf(deck) }) ?? []
  const oldFlat = flatComps(page.components ?? [])
  const oldById = new Map(oldFlat.map((c) => [c.id, c]))
  const oldBySlot = new Map<string, SlideComponent>()
  for (const c of oldFlat) { const k = slotKeyOf(c, key); if (k && !oldBySlot.has(k)) oldBySlot.set(k, c) }
  const next = fresh.map((c) => {
    let out = c
    const prev = oldById.get(c.id)
    if (prev?.morphKey) out = { ...out, morphKey: prev.morphKey } as SlideComponent
    const sk = slotKeyOf(c, key)
    const src = sk ? oldBySlot.get(sk) : undefined
    const sb = src ? textBodyOf(src) : null
    if (sb && plainTextOf(sb.paragraphs).trim()) out = withParagraphs(out, structuredClone(sb.paragraphs))
    return out
  })
  // 自己加的组件留着（组合里混了版式派生件 ⇒ 只留自己加的那几个子件·组合框不动）
  const mine = (c: SlideComponent) => !c.id.startsWith(`${key}.`)
  const custom: SlideComponent[] = []
  for (const c of page.components ?? []) {
    if (!mine(c)) continue
    if (c.type === 'group') {
      const kids = c.children.filter(mine)
      if (kids.length) custom.push(kids.length === c.children.length ? c : ({ ...c, children: kids } as SlideComponent))
    } else custom.push(c)
  }
  np.components = [...next, ...custom]
  const live = new Set(allComponentIds(np.components))
  const anims = (page.animations ?? []).filter((a) => live.has(a.componentId))
  if (anims.length) np.animations = anims; else delete np.animations
  return { ok: true, page: np }
}

/** animation_order 的「组件＋阶段＋第几条」点名 ⇒ 页动画表里那条的编号（没有＝null） */
function resolveAnimRef(anims: readonly SlideAnimation[], ref: Exclude<AnimOrderRef, string>): string | null {
  if (!ref || typeof ref !== 'object' || typeof ref.componentId !== 'string' || typeof ref.phase !== 'string') return null
  const k = ref.index ?? 0
  if (!Number.isInteger(k) || k < 0) return null
  const mine = anims.filter((a) => a.componentId === ref.componentId && a.phase === ref.phase)
  return mine[k]?.id ?? null
}

/** 复制一页：组件全部换新编号（派生编号换成新页键·自订编号换新随机号）·动画跟着改挂·程序书签（cues）跟着改指 */
function duplicatePage(deck: DeckDataV2, src: number): DeckPageV2 {
  const page = deck.pages[src]
  const pid = newPagePid()
  const comps = structuredClone(pageComponents(page, src, localeOf(deck)))
  const oldKey = page.pid ?? `i${src}`
  const idMap = new Map<string, string>()
  // 复制出来的每一件记「来源的配对键」（来源没有＝来源编号）⇒ 原页⇄复制页同一件能补间（组内子件同）
  const remap = (c: SlideComponent) => {
    const nid = c.id.startsWith(`${oldKey}.`) ? `${pid}.${c.id.slice(oldKey.length + 1)}` : randId(c.type === 'group' ? 'g' : 'c')
    idMap.set(c.id, nid)
    c.morphKey = c.morphKey ?? c.id
    c.id = nid
    if (c.type === 'group') c.children.forEach(remap)
  }
  comps.forEach(remap)
  const animIdMap = new Map<string, string>()
  const anims = (page.animations ?? []).filter((a) => idMap.has(a.componentId)).map((a) => {
    const nid = randId('a')
    animIdMap.set(a.id, nid)
    return { ...a, id: nid, componentId: idMap.get(a.componentId)! }
  })
  // 程序组件的书签指着本页的组件／动画 ⇒ 换成复制页上对应的新编号（留着旧编号＝书签在复制页上认不到目标）；指不到的照原样留
  const recue = (c: SlideComponent) => {
    if (c.type === 'program' && Array.isArray(c.cues)) {
      c.cues = c.cues.map((q) => ({
        ...q,
        componentId: idMap.get(q.componentId) ?? q.componentId,
        ...(q.animationId !== undefined ? { animationId: animIdMap.get(q.animationId) ?? q.animationId } : {}),
      }))
    }
    if (c.type === 'group') c.children.forEach(recue)
  }
  comps.forEach(recue)
  const np: DeckPageV2 = { ...structuredClone(page), pid, components: comps }
  delete np.htmlOverride
  if (anims.length) np.animations = anims; else delete np.animations
  return np
}

/* ------------------------------------------------------------------ */
/* 入参核形（route 用·深层栏位由 applyComponentOp 逐栏白名单）             */
/* ------------------------------------------------------------------ */

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optPid = (o: Record<string, unknown>, k: string): string | undefined | false => (o[k] === undefined || o[k] === null ? undefined : isStr(o[k]) ? (o[k] as string) : false)

/** 组件／页操作的外层核形：坏形 ⇒ null（route 落 400）·通过的操作仍要过 applyComponentOp 的逐栏白名单 */
export function parseComponentOp(raw: unknown): ComponentOp | null {
  if (!isPlainObj(raw)) return null
  const o = raw
  const pageRef = (): { pageIndex: number; pageId?: string } | null => {
    if (!isInt(o.pageIndex, 0, 10_000)) return null
    const pid = optPid(o, 'pageId')
    if (pid === false) return null
    return { pageIndex: o.pageIndex, ...(pid ? { pageId: pid } : {}) }
  }
  switch (o.kind) {
    case 'component_update':
      return isStr(o.componentId, 100) && isPlainObj(o.patch) ? { kind: 'component_update', componentId: o.componentId, patch: o.patch } : null
    case 'component_frame':
      if (!isStr(o.componentId, 100) || !isPlainObj(o.frame)) return null
      if (o.z !== undefined && !isZMove(o.z)) return null
      return { kind: 'component_frame', componentId: o.componentId, frame: o.frame as Partial<Frame>, ...(o.z !== undefined ? { z: o.z as ZMove } : {}) }
    case 'component_order':
      return isStr(o.componentId, 100) && isZMove(o.z) ? { kind: 'component_order', componentId: o.componentId, z: o.z } : null
    case 'component_delete':
      return isStr(o.componentId, 100) ? { kind: 'component_delete', componentId: o.componentId } : null
    case 'component_add': {
      const ref = pageRef()
      if (!ref || !isPlainObj(o.component) || typeof o.component.type !== 'string') return null
      if (o.z !== undefined && !isZMove(o.z)) return null
      const parent = optPid(o, 'parentId')
      if (parent === false) return null
      return { kind: 'component_add', ...ref, component: o.component as never, ...(o.z !== undefined ? { z: o.z as ZMove } : {}), ...(parent ? { parentId: parent } : {}) }
    }
    case 'component_group': {
      if (!Array.isArray(o.componentIds) || o.componentIds.length < 2 || o.componentIds.length > COMPONENT_LIMITS.groupChildren || !o.componentIds.every((x) => isStr(x, 100))) return null
      const gid = optPid(o, 'groupId')
      if (gid === false) return null
      if (o.frame !== undefined && !isPlainObj(o.frame)) return null
      return { kind: 'component_group', componentIds: o.componentIds as string[], ...(gid ? { groupId: gid } : {}), ...(o.frame !== undefined ? { frame: o.frame as Frame } : {}) }
    }
    case 'component_ungroup':
      return isStr(o.componentId, 100) ? { kind: 'component_ungroup', componentId: o.componentId } : null
    case 'page_update': {
      const ref = pageRef()
      return ref && isPlainObj(o.patch) ? { kind: 'page_update', ...ref, patch: o.patch as never } : null
    }
    case 'transition_all': {
      const ref = pageRef()
      if (!ref || !(o.transition === null || isPlainObj(o.transition))) return null
      return { kind: 'transition_all', ...ref, transition: o.transition as PageTransition | null }
    }
    case 'animation_set': {
      if (!isStr(o.componentId, 100)) return null
      const out: Record<string, unknown> = { kind: 'animation_set', componentId: o.componentId }
      for (const k of ['enter', 'emphasis', 'exit']) {
        if (!(k in o) || o[k] === undefined) continue
        if (o[k] !== null && !isPlainObj(o[k])) return null
        out[k] = o[k]
      }
      // 影片步骤／程序步骤：数组（逐条由 applyComponentOp 核）或 null
      for (const k of ['media', 'program']) {
        if (!(k in o) || o[k] === undefined) continue
        if (o[k] !== null && !(Array.isArray(o[k]) && (o[k] as unknown[]).length <= 200)) return null
        out[k] = o[k]
      }
      return out as ComponentOp
    }
    case 'animation_order': {
      const ref = pageRef()
      // 每项：动画编号，或 { componentId, phase, index? } 点名（只认这三个键）
      const okItem = (x: unknown) => isStr(x, 100)
        || (isPlainObj(x) && Object.keys(x).every((k) => ['componentId', 'phase', 'index'].includes(k)) && isStr(x.componentId, 100) && isStr(x.phase, 20) && (x.index === undefined || isInt(x.index, 0, 200)))
      if (!ref || !Array.isArray(o.order) || o.order.length > 200 || !o.order.every(okItem)) return null
      return { kind: 'animation_order', ...ref, order: o.order as AnimOrderRef[] }
    }
    case 'page_add': {
      if (!isInt(o.afterIndex, -1, 10_000)) return null
      if (!['blank', 'content', 'transition', 'duplicate'].includes(o.pageKind as string)) return null
      const after = optPid(o, 'afterPageId'), src = optPid(o, 'sourcePageId')
      if (after === false || src === false) return null
      if (o.sourceIndex !== undefined && !isInt(o.sourceIndex, 0, 10_000)) return null
      const lay = optPid(o, 'layoutId')
      if (lay === false) return null
      return {
        kind: 'page_add', afterIndex: o.afterIndex, pageKind: o.pageKind as 'blank',
        ...(after ? { afterPageId: after } : {}), ...(src ? { sourcePageId: src } : {}), ...(o.sourceIndex !== undefined ? { sourceIndex: o.sourceIndex as number } : {}),
        ...(lay ? { layoutId: lay } : {}),
      }
    }
    case 'page_move': {
      const ref = pageRef()
      return ref && isInt(o.to, 0, 10_000) ? { kind: 'page_move', ...ref, to: o.to } : null
    }
    case 'page_set_layout': {
      const ref = pageRef()
      return ref && isStr(o.layoutId, 100) ? { kind: 'page_set_layout', ...ref, layoutId: o.layoutId } : null
    }
    case 'page_restore_layout':
    case 'toc_rebuild': {
      const ref = pageRef()
      return ref ? { kind: o.kind, ...ref } : null
    }
    default:
      return null
  }
}

/** 一页的程序动画个数（含组合里的） */
export function programCount(comps: readonly SlideComponent[]): number {
  let n = 0
  for (const c of comps) { if (c.type === 'program') n++; else if (c.type === 'group') n += programCount(c.children) }
  return n
}

/**
 * 操作后有没有哪一页的程序动画（含组合后代）超过 programsPerPage、而且比操作前同一页（按 pid·没 pid 按位置）多。
 * 只拒「让数目变多」的那一笔：旧资料本来就超过的页，删／改／挪／成组照放；新出来的页（复制页、套模板）操作前算 0。
 * 没物化的页（版式派生）不会有程序组件 ⇒ 只数 components。applyComponentOp 与 deck 路由（套我的模板等非组件 op）共用。
 */
export function programCapExceededAfter(before: DeckDataV2, after: DeckDataV2): boolean {
  const cap = COMPONENT_LIMITS.programsPerPage
  const keyOf = (p: { pid?: string }, i: number) => (typeof p.pid === 'string' && p.pid ? `pid:${p.pid}` : `at:${i}`)
  const prev = new Map<string, number>()
  before.pages.forEach((p, i) => prev.set(keyOf(p, i), programCount((p.components ?? []) as SlideComponent[])))
  return after.pages.some((p, i) => {
    const n = programCount((p.components ?? []) as SlideComponent[])
    return n > cap && n > (prev.get(keyOf(p, i)) ?? 0)
  })
}

/** 给人看的拒绝句（繁·route 400 的 error 栏） */
export const COMPONENT_OP_ERROR_TEXT: Record<ComponentOpError, string> = {
  bad_page_index: '頁碼不存在',
  page_gone: '該頁已被刪除',
  component_not_found: '找不到這個元件',
  bad_field: '元件內容格式不對',
  field_not_for_type: '這種元件沒有這個欄位',
  text_too_long: '文字太長',
  too_many_components: `這一頁的元件太多（上限 ${COMPONENT_LIMITS.perPage} 個）`,
  too_many_animations: `這一頁的動畫太多（上限 ${COMPONENT_LIMITS.animationsPerPage} 個）`,
  too_many_programs: `這一頁的程序動畫太多（上限 ${COMPONENT_LIMITS.programsPerPage} 個·含組合裡的）`,
  bad_animation_order: '動畫順序不對',
  bad_component_type: '不支援這種元件',
  deck_full: '頁數已達上限',
  last_page: '至少要保留一頁',
  bad_op: '不支援的操作',
  bad_layout: '找不到這個版式（或它不是這種頁用的版式）',
  too_many_items: '這一頁的條目比這個版式裝得下的多',
}

/** deck 用的主题（与服务端 renderDeckV2Html 同一口径：themeId 查表·查不到按 deckId 种子挑）——编辑页画布用（客户端安全） */
export function deckThemeOf(deck: DeckDataV2): Theme {
  return getTheme(deck.themeId ?? '') ?? THEMES[hashSeed(deck.deckId ?? '') % THEMES.length]
}
