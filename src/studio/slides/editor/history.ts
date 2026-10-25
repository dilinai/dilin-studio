/**
 * 简报组件编辑 · 撤销／重做与复制贴上（纯逻辑·零 DOM／React）——  *
 * 撤销做法＝「反向操作」：每一笔组件操作送出前，先拿当下的 deck 算出能把它还原的那几笔（同一套 ComponentOp·走同一条 PATCH），
 *   一次手势（拖一组、贴上三个、整组排层级）＝一格（多笔）。服务端不用改。
 *   删掉的组件撤销＝按原内容原叠层重新新增——服务端会发新编号 ⇒ 记「旧编号→新编号」，之后栈里提到旧编号的一律换成新的；
 *   新增（贴上／清单新增／拖图进来）的撤销＝删掉它；新编号要等回包才知道 ⇒ 先挂占位编号，回包后补上；
 *   栈按页（页的 pid）；页结构类操作（加页、移页、还原版式、重建目录）不进栈，且会清掉那一页的栈。
 * 复制贴上：剪贴簿是本页面内存里的一份组件内容（跨页可贴·⛔ 碰系统剪贴簿＝不跟浏览器文字复制打架）。
 */

import type { DeckDataV2 } from '../deck-edit'
import { applyComponentOp, locateComponent } from '../deck-components'
import { pageComponents } from '../kit/components/derive'
import type {
  AnimOrderRef, AnimPhase, AnimSpec, BasicSlideAnimation, ComponentOp, ComponentPatch, Frame, GroupComponent, MediaSlideAnimation, MediaStepSpec, NewComponentInput,
  ProgramStepSpec, SlideAnimation, SlideComponent, TextBox,
} from '../kit/components/types'
import { CREATABLE_COMPONENT_TYPES, isBasicAnimation } from '../kit/components/types'

/* ------------------------------------------------------------------ */
/* 组件内容 ⇒ 补丁／新增入参                                             */
/* ------------------------------------------------------------------ */

const OPT_BOX_KEYS = ['bold', 'italic', 'clamp', 'letterSpacing', 'fill', 'border', 'radius', 'maxLines'] as const

/** 文字框整份（可选键没有的给 null＝清掉） */
function fullBox(b: TextBox): Record<string, unknown> {
  const out: Record<string, unknown> = { ...b }
  for (const k of OPT_BOX_KEYS) if (out[k] === undefined) out[k] = null
  return out
}

/**
 * 能把任一组件的「内部」整份改回 c 的补丁（名称／锁／隐藏／透明度＋各种类的全部栏位·没有的给 null）。
 * 撤销「改属性」与贴上（新增时带上）共用。
 */
export function componentRestorePatch(c: SlideComponent): ComponentPatch {
  const p: Record<string, unknown> = {
    name: c.name ?? null,
    locked: !!c.locked,
    hidden: !!c.hidden,
    opacity: c.opacity ?? null,
    morphKey: c.morphKey ?? null,
  }
  switch (c.type) {
    case 'text':
      p.paragraphs = structuredClone(c.paragraphs)
      p.box = fullBox(c.box)
      break
    case 'shape':
      p.shape = c.shape
      p.fill = c.fill ?? null
      p.stroke = c.stroke ?? null
      p.radius = c.radius ?? null
      p.lineEnds = c.lineEnds ?? null
      for (const k of ['fillMode', 'gradient', 'shadow', 'arc', 'thickness', 'callout', 'backdropBlur'] as const) p[k] = c[k] !== undefined ? structuredClone(c[k]) : null
      if (c.text) { p.paragraphs = structuredClone(c.text.paragraphs); p.box = fullBox(c.text.box) }
      else p.paragraphs = []
      break
    case 'image':
      p.src = c.src
      p.crop = c.crop ?? null
      p.fit = c.fit
      p.radius = c.radius ?? null
      p.border = c.border ?? null
      p.flipX = !!c.flipX
      p.flipY = !!c.flipY
      break
    case 'video':
      p.src = c.src
      p.poster = c.poster ?? null
      p.autoplay = !!c.autoplay
      p.loop = !!c.loop
      p.muted = !!c.muted
      p.controls = c.controls !== false
      p.fit = c.fit
      break
    case 'table':
      p.cells = structuredClone(c.cells)
      p.colWidths = [...c.colWidths]
      p.header = c.header
      p.tableStyle = { ...c.style, bandFill: c.style.bandFill ?? null }
      break
    case 'chart':
      p.chart = c.chart
      p.labels = [...c.labels]
      p.series = structuredClone(c.series)
      p.colors = c.colors ? [...c.colors] : null
      p.legend = c.legend
      p.showValues = c.showValues
      p.chartFont = c.font ?? null
      p.chartTextColor = c.textColor ?? null
      break
    case 'program':
      p.html = c.html
      for (const k of ['css', 'designW', 'designH', 'steps', 'transparent', 'bgColor', 'decompose', 'cues'] as const) p[k] = c[k] !== undefined ? structuredClone(c[k]) : null
      break
    case 'html':
    case 'group':
      break
  }
  return p as ComponentPatch
}

/** 能不能复制（html＝内部用的旧整页／手动排版层·新增不了 ⇒ 不能复制；组合整组复制） */
export function isCopyable(c: SlideComponent): boolean {
  return (CREATABLE_COMPONENT_TYPES as readonly string[]).includes(c.type) || c.type === 'group'
}

/**
 * 组件 ⇒ component_add 的入参（内容整份＋框）。html 回 null；组合＝整组（子件框是组内局部坐标）。
 * 配对键：照原样带（撤销删除＝一模一样回来）；keyFromId＝复制到剪贴簿：没有的记成原编号（贴到别页也能跟原件平滑配对·同 PowerPoint 复制物件保留名称）。
 */
export function componentToInput(c: SlideComponent, frame: Frame = c.frame, opts: { unlock?: boolean; keyFromId?: boolean } = {}): NewComponentInput | null {
  if (!isCopyable(c)) return null
  const patch = componentRestorePatch(c) as Record<string, unknown>
  if (opts.unlock) patch.locked = false
  // 名称 null／opacity null 对新增是多余的（缺省就是没有）
  if (patch.name === null) delete patch.name
  if (patch.opacity === null) delete patch.opacity
  if (opts.keyFromId) patch.morphKey = c.morphKey ?? c.id
  else if (patch.morphKey === null) delete patch.morphKey
  if (c.type === 'group') {
    const children = c.children.map((ch) => componentToInput(ch, ch.frame, { keyFromId: opts.keyFromId })).filter((x): x is NewComponentInput => !!x)
    return { type: 'group', frame: { ...frame }, children, ...patch } as NewComponentInput
  }
  return { type: c.type as NewComponentInput['type'], frame: { ...frame }, ...patch } as NewComponentInput
}

/* ------------------------------------------------------------------ */
/* 反向操作                                                            */
/* ------------------------------------------------------------------ */

/**
 * 一步＝一笔要送的操作。restores＝这一步是新增、新增出来的就是这个编号（旧编号或占位编号）的那个组件——回包拿到新编号后记别名。
 * restoresChildren＝新增的是整组、子件原编号（与入参 children 同序）——回包的 childIds 逐个记别名（子件的动画才挂得回去）。
 */
export type Step = { op: ComponentOp; restores?: string; restoresChildren?: string[] }
export type Entry = { page: string; forward: Step[]; inverse: Step[] }

const PHASES: AnimPhase[] = ['enter', 'emphasis', 'exit']
const specOf = (a: BasicSlideAnimation): AnimSpec => ({ effect: a.effect, trigger: a.trigger, durationMs: a.durationMs, delayMs: a.delayMs, ...(a.direction ? { direction: a.direction } : {}) })
/** 一个组件的影片步骤／程序步骤整组（照页动画表先后）·没有＝null（animation_set 的 media／program 栏） */
export function mediaStepsOf(anims: readonly SlideAnimation[], id: string): MediaStepSpec[] | null {
  const l = anims.filter((a) => a.componentId === id && a.phase === 'media').map((a) => {
    const m = a as MediaSlideAnimation
    return { effect: m.effect, ...(typeof m.seekSec === 'number' ? { seekSec: m.seekSec } : {}), trigger: m.trigger, delayMs: m.delayMs }
  })
  return l.length ? l : null
}
export function programStepsOf(anims: readonly SlideAnimation[], id: string): ProgramStepSpec[] | null {
  const l = anims.filter((a) => a.componentId === id && a.phase === 'program').map((a) => ({ trigger: a.trigger, delayMs: a.delayMs, ...(a.durationMs ? { durationMs: a.durationMs } : {}) }))
  return l.length ? l : null
}
/** 一个组件的全部动画 ⇒ 一笔 animation_set（还原删除／取消组合用） */
function animSetFor(anims: readonly SlideAnimation[], id: string): ComponentOp | null {
  const mine = anims.filter((a) => a.componentId === id)
  if (!mine.length) return null
  const set: Record<string, unknown> = { kind: 'animation_set', componentId: id }
  for (const a of mine) if (isBasicAnimation(a)) set[a.phase] = specOf(a)
  const media = mediaStepsOf(anims, id), program = programStepsOf(anims, id)
  if (media) set.media = media
  if (program) set.program = program
  return set as ComponentOp
}
/**
 * 页动画表现在的先后 ⇒ animation_order 的点名序（每条按「组件＋阶段＋同组件同阶段第几条」）。
 * 重新新增回来的组件换了动画编号、组件编号也走别名 ⇒ 用点名才排得回原位。
 */
export function animOrderRefs(anims: readonly SlideAnimation[]): AnimOrderRef[] {
  const seen = new Map<string, number>()
  return anims.map((a) => {
    const key = `${a.componentId}\u0000${a.phase}`
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    return { componentId: a.componentId, phase: a.phase, index: k }
  })
}

function pageKeyAt(deck: DeckDataV2, i: number): string { return deck.pages[i]?.pid ?? `i${i}` }
function compsAt(deck: DeckDataV2, i: number): SlideComponent[] { return pageComponents(deck.pages[i], i, deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW') }

let placeholderSeq = 0
/** 新增操作回包前的占位编号（回包后 History.bindCreated 换成真的） */
export function newPlaceholder(): string { return `@new${++placeholderSeq}` }
export const isPlaceholder = (id: string) => id.startsWith('@new')

/**
 * 一笔操作在 deck 上的反向（能把它还原的几步）＋它落在哪一页。
 * addPlaceholder＝component_add 的新编号占位（撤销＝删它）。回 null＝这种操作不进栈（页结构类）或套不上。
 */
export function inverseOf(deck: DeckDataV2, op: ComponentOp, addPlaceholder?: string): { page: string; steps: Step[] } | null {
  switch (op.kind) {
    case 'component_update':
    case 'component_frame':
    case 'component_order':
    case 'component_delete':
    case 'animation_set': {
      const loc = locateComponent(deck, op.componentId)
      if (!loc) return null
      const comps = compsAt(deck, loc.pageIndex)
      const parent = loc.child !== undefined ? (comps[loc.index] as GroupComponent) : null
      const cur = parent ? parent.children[loc.child!] : comps[loc.index]
      const zAt = parent ? loc.child! : loc.index
      const page = pageKeyAt(deck, loc.pageIndex)
      if (op.kind === 'component_update') return { page, steps: [{ op: { kind: 'component_update', componentId: cur.id, patch: componentRestorePatch(cur) } }] }
      if (op.kind === 'component_frame') {
        const steps: Step[] = [{ op: { kind: 'component_frame', componentId: cur.id, frame: { ...cur.frame } } }]
        // 组合改过宽高 ⇒ 子件被按比例缩过：逐个放回原局部框（免得来回缩出误差）
        if (cur.type === 'group') for (const ch of cur.children) steps.push({ op: { kind: 'component_frame', componentId: ch.id, frame: { ...ch.frame } } })
        if (op.z !== undefined) steps.push({ op: { kind: 'component_order', componentId: cur.id, z: zAt } })
        return { page, steps: op.z !== undefined ? steps.reverse() : steps }
      }
      if (op.kind === 'component_order') return { page, steps: [{ op: { kind: 'component_order', componentId: cur.id, z: zAt } }] }
      if (op.kind === 'animation_set') {
        const anims = deck.pages[loc.pageIndex].animations ?? []
        const inv: Record<string, unknown> = { kind: 'animation_set', componentId: cur.id }
        for (const ph of PHASES) {
          if (!(ph in op) || (op as Record<string, unknown>)[ph] === undefined) continue
          const a = anims.find((x) => x.componentId === cur.id && x.phase === ph)
          inv[ph] = a && isBasicAnimation(a) ? specOf(a) : null
        }
        if (op.media !== undefined) inv.media = mediaStepsOf(anims, cur.id)
        if (op.program !== undefined) inv.program = programStepsOf(anims, cur.id)
        return { page, steps: [{ op: inv as ComponentOp }] }
      }
      // component_delete ⇒ 原内容原叠层新增回来（＋它的动画）；组内子件 ⇒ 加回同一个组合；
      //   整组 ⇒ 子件的动画（含程序步骤／影片步骤）也逐个挂回；最后把页动画表排回删前的先后（重新挂上的会接在最后）
      const input = componentToInput(cur)
      if (!input) return null
      const pid = deck.pages[loc.pageIndex].pid
      if (parent && parent.children.length <= 1) return null   // 组删到不剩（整组没了）：不进栈
      const anims = deck.pages[loc.pageIndex].animations ?? []
      const kids = cur.type === 'group' ? cur.children.filter(isCopyable) : []   // 与 componentToInput 的 children 同序
      const steps: Step[] = [{
        op: { kind: 'component_add', pageIndex: loc.pageIndex, ...(pid ? { pageId: pid } : {}), component: input, z: zAt, ...(parent ? { parentId: parent.id } : {}) },
        restores: cur.id,
        ...(kids.length ? { restoresChildren: kids.map((ch) => ch.id) } : {}),
      }]
      let hadAnims = false
      for (const id of [cur.id, ...kids.map((ch) => ch.id)]) {
        const set = animSetFor(anims, id)
        if (set) { steps.push({ op: set }); hadAnims = true }
      }
      if (hadAnims) steps.push({ op: { kind: 'animation_order', pageIndex: loc.pageIndex, ...(pid ? { pageId: pid } : {}), order: animOrderRefs(anims) } })
      return { page, steps }
    }
    case 'component_add': {
      if (!addPlaceholder) return null
      const r = applyComponentOp(deck, op)
      if (!r.ok) return null
      const i = r.targetPageIndex ?? op.pageIndex
      return { page: pageKeyAt(r.deck, i), steps: [{ op: { kind: 'component_delete', componentId: addPlaceholder } }] }
    }
    case 'component_group': {
      // 撤销＝取消组合＋各成员放回原叠层（组合编号要发笔前就定好·不然撤销认不到）
      if (!op.groupId) return null
      const locs = op.componentIds.map((id) => locateComponent(deck, id))
      if (locs.some((l) => !l || l.child !== undefined)) return null
      const pi = locs[0]!.pageIndex
      const comps = compsAt(deck, pi)
      const order = locs.map((l) => ({ id: comps[l!.index].id, z: l!.index })).sort((a, b) => a.z - b.z)
      return {
        page: pageKeyAt(deck, pi),
        steps: [{ op: { kind: 'component_ungroup', componentId: op.groupId } }, ...order.map((o) => ({ op: { kind: 'component_order', componentId: o.id, z: o.z } as ComponentOp }))],
      }
    }
    case 'component_ungroup': {
      const loc = locateComponent(deck, op.componentId)
      if (!loc || loc.child !== undefined) return null
      const g = compsAt(deck, loc.pageIndex)[loc.index]
      if (g.type !== 'group') return null
      const steps: Step[] = g.children.map((ch) => ({ op: { kind: 'component_update', componentId: ch.id, patch: { opacity: ch.opacity ?? null, hidden: !!ch.hidden } } as ComponentOp }))
      steps.push({ op: { kind: 'component_group', componentIds: g.children.map((ch) => ch.id), groupId: g.id, frame: { ...g.frame } } })
      steps.push({ op: { kind: 'component_update', componentId: g.id, patch: { name: g.name ?? null, locked: !!g.locked, hidden: !!g.hidden, opacity: g.opacity ?? null, morphKey: g.morphKey ?? null } } })
      const set = animSetFor(deck.pages[loc.pageIndex].animations ?? [], g.id)
      if (set) steps.push({ op: set })
      return { page: pageKeyAt(deck, loc.pageIndex), steps }
    }
    case 'page_update': {
      const r = applyComponentOp(deck, op)
      if (!r.ok) return null
      const i = r.targetPageIndex ?? op.pageIndex
      const p = deck.pages[i]
      const patch: Record<string, unknown> = {}
      if (op.patch.background !== undefined) patch.background = p.background ? structuredClone(p.background) : null
      if (op.patch.transition !== undefined) patch.transition = p.transition ? { ...p.transition } : null
      return { page: pageKeyAt(deck, i), steps: [{ op: { kind: 'page_update', pageIndex: i, ...(p.pid ? { pageId: p.pid } : {}), patch } as ComponentOp }] }
    }
    case 'transition_all': {
      const r = applyComponentOp(deck, op)
      if (!r.ok) return null
      const i = r.targetPageIndex ?? op.pageIndex
      return {
        page: pageKeyAt(deck, i),
        steps: deck.pages.map((p, k) => ({ op: { kind: 'page_update', pageIndex: k, ...(p.pid ? { pageId: p.pid } : {}), patch: { transition: p.transition ? { ...p.transition } : null } } as ComponentOp })),
      }
    }
    case 'animation_order': {
      const r = applyComponentOp(deck, op)
      if (!r.ok) return null
      const i = r.targetPageIndex ?? op.pageIndex
      const before = deck.pages[i]?.animations ?? []
      const pid = deck.pages[i]?.pid
      return { page: pageKeyAt(deck, i), steps: [{ op: { kind: 'animation_order', pageIndex: i, ...(pid ? { pageId: pid } : {}), order: before.map((a) => a.id) } }] }
    }
    default:
      return null
  }
}

/**
 * 一整个手势（多笔）⇒ 一格：逐笔在「套上前一笔之后」的 deck 上算反向，反向整串倒过来。
 * placeholders＝各 component_add 的占位编号（与 ops 同序·非新增的位置给 undefined）。
 * 回 null＝有一笔不进栈（整格不记）。
 */
export function buildEntry(deck: DeckDataV2, ops: readonly ComponentOp[], placeholders: readonly (string | undefined)[] = []): Entry | null {
  let d = deck
  let page: string | null = null
  const inverse: Step[] = []
  const forward: Step[] = []
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    const inv = inverseOf(d, op, placeholders[k])
    if (!inv) return null
    page = page ?? inv.page
    inverse.unshift(...inv.steps)
    forward.push({ op, ...(placeholders[k] ? { restores: placeholders[k] } : {}) })
    const r = applyComponentOp(d, op)
    if (r.ok) {
      d = r.deck
      // 本地新增拿到的随机编号换成占位编号（后面的笔若提到它·撤销链才接得上）
      if (op.kind === 'component_add' && placeholders[k] && r.componentId) d = renameComponent(d, r.componentId, placeholders[k]!)
    }
  }
  return page ? { page, forward, inverse } : null
}

/** deck 里某个组件改编号（只给本地推演用·服务端不会见到占位编号） */
function renameComponent(deck: DeckDataV2, from: string, to: string): DeckDataV2 {
  // 组内子件同样改（加进组合里的那笔）
  const ren = (c: SlideComponent): SlideComponent => (c.id === from ? ({ ...c, id: to } as SlideComponent)
    : c.type === 'group' && c.children.some((ch) => ch.id === from) ? { ...c, children: c.children.map(ren) } : c)
  return {
    ...deck,
    pages: deck.pages.map((p) => (Array.isArray(p.components) && p.components.some((c) => c.id === from || (c.type === 'group' && c.children.some((ch) => ch.id === from)))
      ? { ...p, components: p.components.map(ren), ...(p.animations ? { animations: p.animations.map((a) => (a.componentId === from ? { ...a, componentId: to } : a)) } : {}) }
      : p)),
  }
}

/* ------------------------------------------------------------------ */
/* 栈                                                                  */
/* ------------------------------------------------------------------ */

export const HISTORY_LIMIT = 100

/** 按页的撤销／重做栈＋编号别名（重新新增回来的组件换了编号） */
export class History {
  private undoS = new Map<string, Entry[]>()
  private redoS = new Map<string, Entry[]>()
  private alias = new Map<string, string>()

  /** 记一格（新动作 ⇒ 那一页的重做栈清空） */
  push(e: Entry): void {
    const u = this.undoS.get(e.page) ?? []
    u.push(e)
    if (u.length > HISTORY_LIMIT) u.shift()
    this.undoS.set(e.page, u)
    this.redoS.delete(e.page)
  }
  canUndo(page: string): boolean { return (this.undoS.get(page)?.length ?? 0) > 0 }
  canRedo(page: string): boolean { return (this.redoS.get(page)?.length ?? 0) > 0 }
  /** 取出要撤销的那一格（执行成功后调 doneUndo 把它放进重做栈） */
  takeUndo(page: string): Entry | null { return this.undoS.get(page)?.pop() ?? null }
  takeRedo(page: string): Entry | null { return this.redoS.get(page)?.pop() ?? null }
  doneUndo(e: Entry): void { const r = this.redoS.get(e.page) ?? []; r.push(e); this.redoS.set(e.page, r) }
  doneRedo(e: Entry): void { const u = this.undoS.get(e.page) ?? []; u.push(e); this.undoS.set(e.page, u) }
  /** 清一页（页结构变了／那一页被别人改了／执行失败） */
  clearPage(page: string): void { this.undoS.delete(page); this.redoS.delete(page) }
  clearAll(): void { this.undoS.clear(); this.redoS.clear(); this.alias.clear() }
  /** 旧编号（或占位编号）⇒ 服务端新发的编号 */
  bind(oldId: string, newId: string): void { if (oldId !== newId) this.alias.set(oldId, newId) }
  /** 一步「重新新增」回包：那个组件（不管之前被换过几次编号）现在叫 newId */
  bindRestored(restores: string, newId: string): void { this.bind(this.resolve(restores), newId) }
  /** 顺着别名找到现在的编号 */
  resolve(id: string): string {
    let cur = id
    for (let n = 0; n < 50 && this.alias.has(cur); n++) cur = this.alias.get(cur)!
    return cur
  }
  /** 一步要送出去的操作（编号换成现在的） */
  resolveOp(op: ComponentOp): ComponentOp {
    if (op.kind === 'component_group') return { ...op, componentIds: op.componentIds.map((id) => this.resolve(id)) }
    if (op.kind === 'component_add' && op.parentId) return { ...op, parentId: this.resolve(op.parentId) }
    if (op.kind === 'animation_order') return { ...op, order: op.order.map((x) => (typeof x === 'string' ? x : { ...x, componentId: this.resolve(x.componentId) })) }
    if ('componentId' in op && typeof op.componentId === 'string') return { ...op, componentId: this.resolve(op.componentId) } as ComponentOp
    return op
  }
  size(page: string): { undo: number; redo: number } { return { undo: this.undoS.get(page)?.length ?? 0, redo: this.redoS.get(page)?.length ?? 0 } }
}

/* ------------------------------------------------------------------ */
/* 贴上                                                                */
/* ------------------------------------------------------------------ */

export type ClipItem = { input: NewComponentInput; frame: Frame }
/** pasted＝各页已贴过几次（决定下一次偏多少） */
export type Clip = { fromPage: string; items: ClipItem[]; pasted: Record<string, number> }

/** 复制：选中的（按叠层由下到上）⇒ 剪贴簿（html 跳过·贴上的一律解锁） */
export function makeClip(fromPage: string, comps: readonly SlideComponent[], ids: ReadonlySet<string>): Clip | null {
  const items: ClipItem[] = []
  for (const c of comps) {
    if (!ids.has(c.id)) continue
    const input = componentToInput(c, c.frame, { unlock: true, keyFromId: true })
    if (input) items.push({ input, frame: { ...c.frame } })
  }
  return items.length ? { fromPage, items, pasted: {} } : null
}

export const PASTE_OFFSET = 16

/** 贴上：同一页每贴一次往右下多偏 16；别页第一次贴在原位（之后照样每次偏）。回的 nextPasted 要写回 clip.pasted */
export function pasteOps(clip: Clip, toPage: string, pageIndex: number, pageId?: string): { ops: ComponentOp[]; nextPasted: Record<string, number> } {
  const done = clip.pasted[toPage] ?? 0
  const n = toPage === clip.fromPage ? done + 1 : done
  const d = n * PASTE_OFFSET
  // 贴回同一页 ⇒ 不带配对键（同页两件同键·平滑会认错）；贴到别页 ⇒ 带着（跟原件配对）
  const strip = (inp: NewComponentInput): NewComponentInput => {
    const o = { ...inp } as Record<string, unknown>
    delete o.morphKey
    if (o.type === 'group') o.children = (o.children as NewComponentInput[]).map(strip)
    return o as NewComponentInput
  }
  const ops: ComponentOp[] = clip.items.map((it) => ({
    kind: 'component_add', pageIndex, ...(pageId ? { pageId } : {}),
    component: { ...(toPage === clip.fromPage ? strip(structuredClone(it.input)) : structuredClone(it.input)), frame: { ...it.frame, x: it.frame.x + d, y: it.frame.y + d } } as NewComponentInput,
  }))
  return { ops, nextPasted: { ...clip.pasted, [toPage]: done + 1 } }
}

/** Alt 拖出复制：选中的那几个在新位置各新增一份（叠层在最上·先后同原本） */
export function duplicateOps(comps: readonly SlideComponent[], moved: ReadonlyMap<string, Frame>, pageIndex: number, pageId?: string): ComponentOp[] {
  const ops: ComponentOp[] = []
  for (const c of comps) {
    const f = moved.get(c.id)
    if (!f) continue
    const input = componentToInput(c, f, { unlock: true })
    if (input) ops.push({ kind: 'component_add', pageIndex, ...(pageId ? { pageId } : {}), component: input })
  }
  return ops
}
