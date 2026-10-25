// ════════════════════════════════════════════════════════════════════════════
// aislides v2 deck 手动编辑纯函数层（从服务端那一侧拆出）
//
// 🔴 本模块**客户端安全**：DeckSlotPanel/page.tsx 等 'use client' 组件只许
//   import 这里，免得服务端渲染依赖（react-dom/server）被带进客户端分包：
//     本文件 = 纯函数/类型/校验/队列（依赖仅 slide-kit types/registry/engine/themes/schema·
//       全部客户端可打包）——🔴 永远不许在这里 import deck-html / react-dom/server / supabase；
//     服务端那一侧（存取与出 HTML）在网站那边，并 `export *` 本模块。
//   验证口径：production build 后客户端 chunks 里 grep 不到 renderToStaticMarkup。
// ────────────────────────────────────────────────────────────────────────────
// 手动编辑路径**永不**走 withDeckDataCleared（红线：降级=毁结构）；一切写回由 route 用
// 「deck_data+html_content 同一条 update 原子双写 + WHERE 收判据」完成。
import type { LayoutRelation, PageDraft, PageType, SlotImageValue } from './kit/types'
import { isLayoutRelation } from './kit/types'
import type { PageComponentFields } from './kit/components/types'
import { getLayout, layoutItemCapacity } from './kit/registry'
import { THEMES, getTheme } from './kit/themes'
import { isSkinId } from './kit/skins'   // 
import { hashSeed, pickLayout, maxItemCapacity, paginateDraft } from './kit/engine'
import { cleanText, DRAFT_LIMITS, OUTLINE_LIMITS } from './kit/pipeline/schema'

export type DeckLang = 'zh-TW' | 'zh-CN'

/** 空白页的版式 id（组件蓝图表有它·版式库不登记） */
export const BLANK_LAYOUT_ID = 'blank'

export type DeckPageV2 = {
  /**
   * 稳定页身份（服务端 PATCH 首笔起 ensureDeckPagePids 懒发·持久进
   * deck_data）：排队/延迟重发的编辑一律按 pid 找页——纯 pageIndex 在「删页后继任页顶位」
   * 「目录拆页整体位移」两族竞态下会把旧缓冲写到错误的页上。渲染层不消费此键
   * （renderDeckV2Html 显式字段映射）；生成管线产的 deck 无此键=首笔手动编辑时补发。
   */
  pid?: string
  layoutId: string
  themeId?: string
  /**
   * 皮肤 id（套 dilin-* 原創模板时记·＝模板 id）：该页**没物化**时派生组件＝皮肤本页型装饰层＋版式蓝图
   * （slide-kit/components/derive.ts）。老页没有＝旧口径（只有蓝图）。
   */
  skinId?: string
  draft: PageDraft
  images?: Record<string, SlotImageValue>
  /**
   * 该页的**手动排版层**：用户在中栏工具栏（粗体/字号/对齐/插图插视频…）
   * 改过的 section innerHTML（含 .sk-stage 壳）。在场时渲染层（buildDeckHtml）直接用它当该页
   * 内容·不再从 draft 重渲；不在场=照旧从 draft+版式渲。edit_slots（文字格面板/AI 工具）改到
   * 这一页时**摘掉**它（文字格是结构真源·手动排版层退回版式渲染·面板有提示）。
   * 空串不落库（applyPageHtmlEdit 视空串=还原版式）。
   */
  htmlOverride?: string
} & PageComponentFields   // components／animations／background（契约见 slide-kit/components/types.ts）

/** 索引签名保留 outline/qa/generator 等未知键（写回时原样带上·不丢生成期数据） */
export type DeckDataV2 = {
  version: 2
  /**
   * 🔴 结构元数据契约（钉给下一单 AI 工具）：outline 里只有 **title** 由编辑
   * 路维护（rename/封面同步单一标题真源）；`outline.pages` 是**生成期快照**——手动加删页/
   * 目录拆并页一律不同步它。一切页结构消费（读页数/页型/顺序）只许读 `deck.pages`（单一
   * 权威）。谁要消费 outline.pages，必须先把它升级成受维护字段并在本文件补同步逻辑。
   */
  outline?: { title?: string; pages?: unknown[] } & Record<string, unknown>
  lang?: DeckLang
  themeId?: string
  /** 套 dilin-* 原創模板后记下的皮肤 id（＝themeId）·加页时随页带上 ⇒ 新页＝装饰层＋版式蓝图。老 deck 没有＝旧口径 */
  skinId?: string
  deckId?: string
  /** 手动编辑乐观戳（服务端单调递增·生成期 deck 无此键=null 档） */
  revision?: number
  pages: DeckPageV2[]
} & Record<string, unknown>

const PAGE_TYPES: readonly PageType[] = ['cover', 'contents', 'transition', 'content', 'end']

/**
 * 宽严两档解析（工具期口径）：
 * - 返回 DeckDataV2 = 结构完整（version:2 + pages 数组 + 每页 {layoutId:string, draft.type 合法
 *   **且该页型必填槽真在**——：{type:'content'} 缺 items/title 曾能过严档，
 *   下游读 draft.items.length 抛错成 500 而非约定的 422）→ 可进编辑路；
 * - 返回 null = 不是 v2 或结构破损。🔴 调用方必须自己再分「不是 v2（deck_data 为
 *   null/version≠2 → 旧 HTML 路）」与「version:2 在场但破损（→ 資料異常·绝不落旧写路）」
 *   两种——用 {@link isDeckV2Marked} 判前者。
 */
export function parseDeckV2(raw: unknown): DeckDataV2 | null {
  if (!isDeckV2Marked(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.pages) || d.pages.length === 0) return null
  for (const p of d.pages) {
    if (!p || typeof p !== 'object') return null
    const pg = p as Record<string, unknown>
    if (typeof pg.layoutId !== 'string' || !pg.layoutId) return null
    const draft = pg.draft
    if (!draft || typeof draft !== 'object') return null
    if (!isValidDraftShape(draft as Record<string, unknown>)) return null
    // 严档还要核 layoutId 真在版式库且页型一致：未知/错型版式的 deck 若放进
    // 编辑路，重渲会输出「未知版式」中性占位框（renderer 兜底）而非资料异常保护态——用户
    // 每次保存都把好数据渲成占位页。宽档（isDeckV2Marked）不动：version:2 在场仍绝不落旧写路，
    // 这里返回 null 让调用方走「破损 v2 → 422 / 面板資料異常」分支。
    const entry = getLayout(pg.layoutId)
    if (!entry) {
      // 空白页（只手动加·组件栏自带内容）：版式库不登记它（免得引擎挑版式时挑到）·页型钉 content
      if (!(pg.layoutId === BLANK_LAYOUT_ID && (draft as { type?: unknown }).type === 'content')) return null
    } else if (entry.meta.pageType !== (draft as { type?: unknown }).type) return null
  }
  return raw as DeckDataV2
}

/** 严档·按页型核必填槽：编辑路无条件读的字段（title/items 及元素形状）必须在场且类型对。 */
function isValidDraftShape(draft: Record<string, unknown>): boolean {
  const t = draft.type
  if (typeof t !== 'string' || !PAGE_TYPES.includes(t as PageType)) return false
  const strOrAbsent = (v: unknown) => v === undefined || typeof v === 'string'
  switch (t as PageType) {
    case 'cover':
      return typeof draft.title === 'string' && strOrAbsent(draft.subtitle)
    case 'contents':
      return Array.isArray(draft.items) && draft.items.every((x) => typeof x === 'string')
    case 'transition':
      return typeof draft.title === 'string' && strOrAbsent(draft.lead)
    case 'content':
      return typeof draft.title === 'string'
        && Array.isArray(draft.items)
        && draft.items.every((x) =>
          !!x && typeof x === 'object'
          && typeof (x as Record<string, unknown>).body === 'string'
          && strOrAbsent((x as Record<string, unknown>).heading))
    case 'end':
      return strOrAbsent(draft.title) && strOrAbsent(draft.subtitle)
  }
}

/** 宽档：deck_data 自称 version:2（不管结构完不完整）。version:2 在场绝不进旧 HTML 写路。 */
export function isDeckV2Marked(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) &&
    (raw as { version?: unknown }).version === 2
}

/** deck 的乐观戳读法（无键/非有限数 = null 档·WHERE 用 is null 精确匹配） */
export function deckRevision(deck: DeckDataV2 | null | undefined): number | null {
  const r = deck?.revision
  return typeof r === 'number' && Number.isFinite(r) ? r : null
}

/** 裸 deck_data 的乐观戳读法（不要求结构完整·只要 version:2 在场）——版本恢复等只关心戳的场合用。 */
export function rawDeckRevision(raw: unknown): number | null {
  if (!isDeckV2Marked(raw)) return null
  const r = (raw as { revision?: unknown }).revision
  return typeof r === 'number' && Number.isFinite(r) ? r : null
}

/**
 * revision 高水位墓碑：恢复「旧 HTML（非 v2）快照」要把 deck_data 清掉时，
 * 若当前 deck_data 攥着 revision 高水位，**不写裸 null 而写墓碑** `{ deckRevisionFloor: N }`——
 * 否则穿越一次 deck_data=null 后高水位失忆，再恢复 rev3 的 v2 快照会写成 rev4，还攥着
 * rev4 的陈旧标签页能再次命中乐观戳、静默覆盖恢复结果（跨 legacy ABA）。
 * 墓碑没有 version:2 键 ⇒ isDeckV2Marked=false ⇒ 读侧/编辑路一律按「旧 HTML 简报」对待
 * （渲染权威=html_content·结构化编辑 409 not_v2），语义与裸 null 完全一致，只是多记个地板。
 */
const REVISION_FLOOR_KEY = 'deckRevisionFloor'

/** deck 曾到过的 revision 高水位（v2 行读 revision·墓碑行读 deckRevisionFloor·其余 null） */
export function deckRevisionFloor(raw: unknown): number | null {
  const rev = rawDeckRevision(raw)
  if (rev !== null) return rev
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const f = (raw as Record<string, unknown>)[REVISION_FLOOR_KEY]
    if (typeof f === 'number' && Number.isFinite(f)) return f
  }
  return null
}

/**
 * 版本恢复要写回主表的 deck_data（+ ·ABA 收口）：
 * v2 快照：快照里的旧 revision **不许**原样写回——恢复后的 revision =
 *   max(当前高水位, 快照值) + 1（单调不回头·任何历史标签页持有的值都不再命中）。
 *   当前高水位用 {@link deckRevisionFloor} 读（v2 行的 revision **或** 墓碑地板）——
 *   穿越「恢复旧 HTML → deck_data 非 v2」后高水位仍在，rev5→legacy→恢复 rev3 快照
 *   写成 rev6 而非 rev4。
 * 非 v2 快照（null/旧 HTML/墓碑）：有高水位可记（当前或快照自带）就写墓碑，否则原样。
 * 第二参传**主表当前 deck_data 原始值**（不是抽好的 revision——抽早了墓碑地板就丢了）。
 */
export function restoredDeckData(snapshot: unknown, currentRaw: unknown): unknown {
  const floor = Math.max(deckRevisionFloor(currentRaw) ?? -1, deckRevisionFloor(snapshot) ?? -1)
  if (!isDeckV2Marked(snapshot)) {
    if (floor >= 0) return { [REVISION_FLOOR_KEY]: floor }
    return snapshot ?? null
  }
  return {
    ...(snapshot as Record<string, unknown>),
    revision: Math.max(floor, 0) + 1,
  }
}

/**
 * 生成 route 覆写既有简报时的 revision 延续：新 deck_data 必须带
 * revision = 当前高水位 + 1（v2 行的 revision / 墓碑地板 / 全无=从 0 起）——旧病是
 * generate 写入**不含 revision** 的新 deck（null 档），随后 PATCH 从 null 重新计到 1，
 * 历史 rev=1 的陈旧标签页能再次命中 CAS 静默覆盖（ABA 复辟）。
 */
export function regenDeckRevision(currentRaw: unknown): number {
  return (deckRevisionFloor(currentRaw) ?? -1) + 1
}

/**
 * deck_data 状态 CAS 子句（配 {@link regenDeckRevision} 用）：把「读到的
 * 当前 deck_data 状态」钉进 update 的 WHERE——生成 route 的读（算 revision）到写之间若有
 * 手动编辑/另一路生成插队，WHERE 0 行 → 调用方重读重算重试，不产出撞号 revision
 * （撞号=两个不同内容共用同一戳 ⇒ 陈旧标签页 CAS 又能命中）。
 * 四档：null → deck_data is null；v2 → version='2' + revision 精确档（含 is null）；
 * 墓碑 → deckRevisionFloor 精确档；其余未知非 v2 形态（理论不存在）→ 钉「仍非 v2」。
 */
export function applyDeckStateGuard<
  Q extends { eq(column: string, value: string): Q; is(column: string, value: null): Q },
>(q: Q, currentRaw: unknown): Q {
  if (currentRaw === null || currentRaw === undefined) return q.is('deck_data', null)
  if (isDeckV2Marked(currentRaw)) {
    const rev = rawDeckRevision(currentRaw)
    const q2 = q.eq('deck_data->>version', '2')
    return rev === null ? q2.is('deck_data->>revision', null) : q2.eq('deck_data->>revision', String(rev))
  }
  const floor = deckRevisionFloor(currentRaw)
  if (floor !== null) return q.eq(`deck_data->>${REVISION_FLOOR_KEY}`, String(floor))
  // 未知 legacy JSON 档：除「仍非 v2」外再钉「仍非墓碑」——读写窗内该行被
  // 写成墓碑 {deckRevisionFloor:N}（version 同样无键）时，旧口径单 version-is-null 照样命中、
  // 会把高水位地板盖没（跨代 ABA 复辟种子）。两个**不同 legacy 对象**互相命中仍在
  // （PostgREST 钉不了整份 JSON 指纹）——正常写路只产 null/墓碑/v2·该碰撞态不可达（读侧
  // 深比对见 sameDeckGuardState）；本闸把「可达的碰撞态（墓碑）」关死。
  return q.is('deck_data->>version', null).is(`deck_data->>${REVISION_FLOOR_KEY}`, null)
}

/**
 * 「读到的 deck_data 状态」是否等同（本地深判·读侧）——给带基线的守卫写路
 * （服务端那一侧带基线的覆写）在**发起点快照 vs 写前现读**之间
 * 补资料库条件比对钉不到的精度：
 * 档位（null/v2/墓碑/legacy）不同 = 必不同；
 * v2 按 revision 比（同戳=同代·revision 纪律保证同戳不同容不可达）；墓碑按地板比；
 * legacy 档 PostgREST 只能钉「仍非 v2 非墓碑」→ 这里补 JSON 深比对（本地便宜·不受限）。
 */
export function sameDeckGuardState(a: unknown, b: unknown): boolean {
  const kindOf = (x: unknown): string => {
    if (x === null || x === undefined) return 'null'
    if (isDeckV2Marked(x)) return `v2:${rawDeckRevision(x)}`
    const floor = deckRevisionFloor(x)
    if (floor !== null) return `tomb:${floor}`
    return 'legacy'
  }
  const ka = kindOf(a)
  if (ka !== kindOf(b)) return false
  return ka === 'legacy' ? JSON.stringify(a) === JSON.stringify(b) : true
}

/* ── 稳定页身份 pid──────────────────────────────────────────
 * 排队保存/延迟重发按 pageIndex 找页是两族竞态的共同病根：
 *   删页在飞时排队的文字保存——旧 index 已指继任页，旧缓冲整格盖到别人头上；
 *   目录拆页在飞时的第二笔编辑——index 整体位移·写错相邻页。
 * 现口径：每页带持久 pid（服务端 PATCH 读侧 ensureDeckPagePids 懒发·随原子双写落库），
 * op 可带 pageId → 服务端在**乐观戳钉住的那份快照**上按 pid 解析真实 index（页已删=可读
 * 拒绝 err_aislides_page_gone·绝不落错页）。生成管线（禁区·零改）产的 deck 无 pid——
 * 首笔 PATCH 补发后前端即持有；补发前的极窄窗口由前端 enqueue 快照换算兜底。 */

/** 页 pid 发号（uuid·无 crypto.randomUUID 的旧环境退随机串·唯一性只需 deck 内） */
export function newPagePid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** **落库** pid 的合法口径（ensureDeckPagePids 用）：非空字符串·长度有界（超长/坏形=换新号） */
export function isValidPagePid(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64
}

/**
 * op.pageId 的**查找键**口径（parsePatchOp 用）——与落库口径分开：
 * 存量坏数据里的超长 pid 是「库里真实存在的身份」，面板原样送回；若解析层先按 ≤64 拒 400，
 * 读侧 ensureDeckPagePids 永无机会修复=该页永久无法保存（校验顺序在修复之前把路堵死）。
 * 现口径：非空字符串即认（长度由 route 的 256KB body 字节闸整体兜底·查找=O(页数) 字符串
 * 比较无放大面）——匹配上坏 pid 的页照常编辑，随本笔原子双写换成合法新号（一次即愈）。
 */
export function isPagePidLookupKey(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * 按 pid 解页（route 用）：必须在 ensureDeckPagePids **之前**的原始快照上解——
 * 存量重复 pid 时 ensure 保首个占号者、给后页换新号；先修复再 findIndex 必命中首个＝把
 * 「客户端到底指哪页」的歧义**确定成错的对象**（第二页内容静默写进第一页· 病灶）。
 * 口径：唯一命中=found；0 命中=gone；多命中（存量撞号）用客户端同送的 pageIndex/afterIndex
 * 提示消歧——提示恰是命中位之一（index 与 pid 同指一页=自洽）才认，否则 ambiguous=可读
 * 拒绝（前端落最新行后 index 恢复新鲜·下一笔自然自洽；成功写一笔后 ensure 落库=撞号根除）。
 * ensureDeckPagePids 只换号不重排页序 ⇒ 原始快照上解出的 index 在修复后 deck 上原位有效。
 */
export type PagePidResolution = { kind: 'found'; index: number } | { kind: 'gone' } | { kind: 'ambiguous' }

export function resolveDeckPageByPid(deck: DeckDataV2, pid: string, indexHint: number): PagePidResolution {
  const matches: number[] = []
  deck.pages.forEach((p, i) => { if (p.pid === pid) matches.push(i) })
  if (matches.length === 0) return { kind: 'gone' }
  if (matches.length === 1) return { kind: 'found', index: matches[0] }
  return matches.includes(indexHint) ? { kind: 'found', index: indexHint } : { kind: 'ambiguous' }
}

/** 全部页补齐 pid（已有且不重复的保留·缺失/坏形/撞号的重发）。纯函数·无变化时返回原引用。 */
export function ensureDeckPagePids(deck: DeckDataV2): DeckDataV2 {
  const seen = new Set<string>()
  let changed = false
  const pages = deck.pages.map((p) => {
    if (isValidPagePid(p.pid) && !seen.has(p.pid)) { seen.add(p.pid); return p }
    changed = true
    let pid = newPagePid()
    while (seen.has(pid)) pid = newPagePid()
    seen.add(pid)
    return { ...p, pid }
  })
  return changed ? { ...deck, pages } : deck
}

/** 按 pid 找页（-1=没有这页·调用方按 page_gone 可读拒绝） */
export function findDeckPageIndexByPid(deck: DeckDataV2, pid: string): number {
  return deck.pages.findIndex((p) => p.pid === pid)
}

/* ── 槽位编辑 ──────────────────────────────────────────────────────────── */

/** 编辑面板送来的槽值（按页型取用·多余键丢弃·与 AI 同一净化闸 cleanText） */
export type SlotEditInput = {
  title?: unknown
  subtitle?: unknown
  lead?: unknown
  /** contents 页 = string[]；content 页 = {heading?,body?}[] */
  items?: unknown
  /**
   * content 页条目图随行走：itemMap[新条目序] = 旧条目序（null=新加行）。
   * itemFigure:N 图槽按**条目序号**绑定（types.ts imageSlotKey 契约）——面板删第 0 条后
   * 若图槽原样保留，原第 0 张图会顶到新第 0 条（原第 1 条内容）上。面板送 itemMap，
   * 服务端按它重排 itemFigure:*；没送且条目数变了 = 对应关系不可知 → 图槽全摘（宁丢不错配）。
   */
  itemMap?: unknown
  /** content 页条目关系：认得的值＝设定（版式按关系重挑）·null／''＝摘掉（回到现行挑法）·不给＝不动 */
  relation?: unknown
}

export type DeckEditError =
  | 'bad_page_index'
  | 'last_page'
  | 'bad_page_type'
  | 'too_many_items'
  | 'deck_full'
  | 'page_html_too_large'
  | 'bad_theme'   // set_theme 指了版式库里没有的主题
  | 'bad_template'   // apply_template 指了目录里没有的整份模板
  | 'bad_layout'   // 点名的版式不在版式库／页型对不上
  | 'page_componentized'   // 这页已物化成组件·文字格／手动排版层两条旧写路不再收（改用组件操作）

export type DeckEditResult =
  | {
      ok: true
      deck: DeckDataV2
      /** cover 标题被编辑过（含清空=''）才在场——route 据此同步行标题 */
      coverTitle?: string
      /** 加/删页后前端应选中的页序（目录分页数可能连带增减·index 不能靠猜） */
      targetPageIndex?: number
    }
  | { ok: false; error: DeckEditError }

/** 手动 content 条目上限：面板不分页 → 钉在版式库最大容量与 AI 上限的较小者
 *  relation＝这页点名的条目关系（同关系的版式装得多就放宽到它们的容量） */
export function manualContentItemCap(relation?: LayoutRelation): number {
  const cap = maxItemCapacity('content', relation)
  return Number.isFinite(cap) ? Math.min(DRAFT_LIMITS.maxContentItems, cap) : DRAFT_LIMITS.maxContentItems
}

/**
 * 手动加页的总页数上限：与生成端同源（OUTLINE_LIMITS.maxPages=40·大纲
 * 净化按它截断）——旧口径 addDeckPage 只限索引不限总数，循环 PATCH add_page 可无限增长
 * pages：单行 JSON/HTML 无界膨胀·每笔又整份 renderDeckV2Html=服务端渲染成本随页数持续
 * 放大。判据钉在 lib 纯函数层（route/面板同一口径）：达上限=可读拒绝（deck_full）·不静默截。
 * 注：按插入前 pages.length（含目录页）判——目录页数由章节数派生（章节数≤页数）·有界。
 */
export function manualDeckPageCap(): number {
  return OUTLINE_LIMITS.maxPages
}

/**
 * 归一后总页数闸（applySlotEdit/addDeckPage/deleteDeckPage 统一口径）：
 * normalizeDeckStructure 会按章节数增减目录**张数**——旧口径只在 addDeckPage 插入前查
 * pages.length，两条绕路都放行：① edit_slots 填章名 10→11 章目录拆页（40→41）；
 * ② add_page 在 39 页时插入 + 连带目录拆页（41）。判据=只拒「页数**增长**且越上限」：
 * 存量已超限的 deck（历史生成物）做不增长的编辑（改字/删页）不误伤·不许再长。
 */
export function exceedsPageCapAfter(before: DeckDataV2, after: DeckDataV2): boolean {
  return after.pages.length > manualDeckPageCap() && after.pages.length > before.pages.length
}

/**
 * 手动 contents（目录）单页条目上限：DRAFT_LIMITS.maxContentsItems=12 >
 * 目录版式最大容量 10——超容量的 11–12 项存得进库但 pickLayout 只能选容量 10 的版式，
 * 渲染静默截掉尾项。手动直改目录一律钉在版式真容量内（超出=可读拒绝·不静默截）。
 */
export function manualContentsItemCap(): number {
  const cap = maxItemCapacity('contents')
  return Number.isFinite(cap) ? Math.min(DRAFT_LIMITS.maxContentsItems, cap) : DRAFT_LIMITS.maxContentsItems
}

/* ── PATCH op 运行时校验────────────────────────────────────
 * TypeScript 强转拦不住恶意 JSON：pageIndex:"__proto__" 让 deck.pages[pageIndex] 读到
 * 数组原型、下游 old.type 抛 500 而非约定 400。op 必须逐字段运行时核形（整数页码/白名单
 * kind/页型/slots 是普通对象），核不过=null → route 落 400 err_aislides_bad_request。
 * items 数组在**遍历/净化之前**先按硬上限拒（手动条目上限 ≤12·400 已是十足余量·
 * 超大数组直接拒=不给「先完整 map 再判超限」的资源消耗窗）。 */

/** op 内 items 数组的绝对上限（先于任何遍历判·正常上限见 manualContent(s)ItemCap） */
export const PATCH_MAX_ITEMS = 400

const isPageIdx = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= -1 && v <= 10_000

/* pageId/afterPageId：稳定页身份（可选·前端持有 pid 时恒送）。
 * 送了 = 服务端按 pid 在乐观戳钉住的快照上解析真实 index（pageIndex/afterIndex 沦为兜底）；
 * 送了但坏形（非法类型/超长）= 整 op 拒 400——静默丢掉会退回按 index 找页 = 病根复辟。 */
export type DeckPatchOpInput =
  | { kind: 'edit_slots'; pageIndex: number; pageId?: string; slots: SlotEditInput }
  | { kind: 'add_page'; afterIndex: number; afterPageId?: string; pageType: AddPageType }
  | { kind: 'delete_page'; pageIndex: number; pageId?: string }
  | { kind: 'rename'; title: string }
  | { kind: 'edit_page_html'; pageIndex: number; pageId?: string; html: string }
  | { kind: 'set_theme'; themeId: string }   // 整份换版式主题（内容槽位不动）
  | { kind: 'apply_template'; templateId: string }   // 整份换成组件化模板的页（原页全撤·前端先问过）
  | { kind: 'apply_user_template'; sourceSlideId: string }   // 整份换成用户自存模板的页（route 按本人读那份·原页全撤·前端先问过）

/** 单页手动排版层的字符上限（整份 PATCH body 另有 256KB 字节闸·此处按 UTF-16 单元
 *  先拒明显超限；正常一页版式 markup 数 KB～数十 KB·插图插视频只落 url 不落 data:）。 */
export const PAGE_HTML_MAX_CHARS = 120_000

/** 可选 pid 字段三态：没送=undefined；送对=string；送坏=Symbol 哨兵（调用方整 op 拒 400）。
 *  核形用**查找键**口径（isPagePidLookupKey·非空字符串即认）——不是落库
 *  口径 isValidPagePid：存量超长 pid 若在这被 400 挡死，读侧修复永无机会跑=该页永久无法保存。 */
const BAD_PID: unique symbol = Symbol('bad_pid')
function optPid(o: Record<string, unknown>, key: string): string | undefined | typeof BAD_PID {
  if (!(key in o) || o[key] === undefined) return undefined
  return isPagePidLookupKey(o[key]) ? o[key] : BAD_PID
}

export function parsePatchOp(raw: unknown): DeckPatchOpInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  switch (o.kind) {
    case 'edit_slots': {
      if (!isPageIdx(o.pageIndex) || o.pageIndex < 0) return null
      const pageId = optPid(o, 'pageId')
      if (pageId === BAD_PID) return null
      const s = o.slots
      if (!s || typeof s !== 'object' || Array.isArray(s)) return null
      const src = s as Record<string, unknown>
      if (Array.isArray(src.items) && src.items.length > PATCH_MAX_ITEMS) return null
      // 白名单收窄（多余键在这就丢·applySlotEdit 再按页型取用）
      const slots: SlotEditInput = {}
      if ('title' in src) slots.title = src.title
      if ('subtitle' in src) slots.subtitle = src.subtitle
      if ('lead' in src) slots.lead = src.lead
      if ('items' in src) slots.items = src.items
      if ('relation' in src) {
        // 关系只收认得的值或 null／''（摘掉）·别的＝坏 op
        if (src.relation !== null && src.relation !== '' && src.relation !== undefined && !isLayoutRelation(src.relation)) return null
        slots.relation = src.relation
      }
      if ('itemMap' in src && src.itemMap !== undefined) {
        // itemMap 同样运行时核形：必须与 items 等长·元素=null 或 0..10000 整数
        const m = src.itemMap
        if (!Array.isArray(m)) return null
        if (!Array.isArray(src.items) || m.length !== src.items.length) return null
        for (const e of m) {
          if (e !== null && !(typeof e === 'number' && Number.isInteger(e) && e >= 0 && e <= 10_000)) return null
        }
        slots.itemMap = m
      }
      return { kind: 'edit_slots', pageIndex: o.pageIndex, ...(pageId ? { pageId } : {}), slots }
    }
    case 'add_page': {
      if (!isPageIdx(o.afterIndex)) return null
      if (o.pageType !== 'content' && o.pageType !== 'transition') return null
      const afterPageId = optPid(o, 'afterPageId')
      if (afterPageId === BAD_PID) return null
      return { kind: 'add_page', afterIndex: o.afterIndex, ...(afterPageId ? { afterPageId } : {}), pageType: o.pageType }
    }
    case 'delete_page': {
      if (!isPageIdx(o.pageIndex) || o.pageIndex < 0) return null
      const pageId = optPid(o, 'pageId')
      if (pageId === BAD_PID) return null
      return { kind: 'delete_page', pageIndex: o.pageIndex, ...(pageId ? { pageId } : {}) }
    }
    case 'rename':
      return typeof o.title === 'string' ? { kind: 'rename', title: o.title } : null
    case 'edit_page_html': {
      if (!isPageIdx(o.pageIndex) || o.pageIndex < 0) return null
      const pageId = optPid(o, 'pageId')
      if (pageId === BAD_PID) return null
      if (typeof o.html !== 'string' || o.html.length > PAGE_HTML_MAX_CHARS) return null
      return { kind: 'edit_page_html', pageIndex: o.pageIndex, ...(pageId ? { pageId } : {}), html: o.html }
    }
    case 'set_theme':
      // 只核形（非空短字串）·主题在不在版式库由 applyThemeChange 判（bad_theme=400 可读拒绝·不是 bad_request）
      return typeof o.themeId === 'string' && /^[a-z0-9-]{1,64}$/.test(o.themeId) ? { kind: 'set_theme', themeId: o.themeId } : null
    case 'apply_template':
      // 只核形·模板在不在目录由 applySlideDeckTemplate 判（bad_template=400 可读拒绝）
      return typeof o.templateId === 'string' && /^[a-z0-9-]{1,64}$/.test(o.templateId) ? { kind: 'apply_template', templateId: o.templateId } : null
    case 'apply_user_template':
      // 只核形（uuid）·归属／在不在模板夹由 route 按本人读判
      return typeof o.sourceSlideId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(o.sourceSlideId) ? { kind: 'apply_user_template', sourceSlideId: o.sourceSlideId } : null
    default:
      return null
  }
}

/* ── 整份换版式主题 ──────────────────────────────────────
 * 模板＝版式库里的版式定义·套用＝换 deck 的主题（色／字体／深浅策略）重渲·⛔ 不把整页 HTML 塞进 htmlOverride。
 * 纯函数：deck.themeId 与每页 themeId 一起换（renderDeckV2Html 读 deck.themeId·页级键随行同步免得两处漂开）；
 * 页的手动排版层 htmlOverride 一律摘掉（它是按旧主题的颜色烘出来的固定 HTML·留着就是「换了主题这页不变」·与 edit_slots 摘层同口径）；
 * 结构（页数／页型／目录／槽位内容／插图）分毫不动。主题不在版式库 ⇒ bad_theme（route 落 400 可读拒绝）。 */
/** 哪几页带手动排版层（htmlOverride 非空）——套模板前据此决定弹不弹「会清掉这些页的手动排版」。
 *  0 起页序·升序·去重；额外传入的页序（编辑中还没回写的脏页）并进来。纯函数·客户端安全。 */
export function manualLayoutPageIndexes(deck: DeckDataV2 | null | undefined, extra: readonly number[] = []): number[] {
  const out = new Set<number>()
  deck?.pages.forEach((p, i) => { if (typeof p.htmlOverride === 'string' && p.htmlOverride.trim()) out.add(i) })
  const n = deck?.pages.length ?? 0
  for (const i of extra) if (Number.isInteger(i) && i >= 0 && (n === 0 || i < n)) out.add(i)
  return [...out].sort((a, b) => a - b)
}

export function applyThemeChange(deck: DeckDataV2, themeId: string): DeckEditResult {
  if (!getTheme(themeId)) return { ok: false, error: 'bad_theme' }
  const lang: DeckLang = deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'
  // 换成皮肤主题 ⇒ skinId 跟着换（没物化的页长出该皮肤装饰层）；换成一般主题 ⇒ 摘掉 skinId（旧皮肤的写死色装饰不该留在新主题上）
  const skinId = isSkinId(themeId) ? themeId : undefined
  const pages = deck.pages.map((p) => {
    // 还没填过字的封面（存量空白简报）套模板时把默认标题／副标真写进 deck——
    //   画面上看得到的字一律来自 deck_data（缩图＝正本＝放映同一份）·⛔ 渲染层再临时补字
    const np: DeckPageV2 = { ...fillBlankCover(p, lang), themeId }
    delete np.htmlOverride
    if (skinId) np.skinId = skinId; else delete np.skinId
    return np
  })
  const next: DeckDataV2 = { ...deck, themeId, pages }
  if (skinId) next.skinId = skinId; else delete next.skinId
  return { ok: true, deck: next }
}

/* ── 单页手动排版层 ───────────────────────────────────
 * 简报本体是 HTML（iframe 内 contenteditable）·工具栏的格式动作/插图插视频直接落在该页
 * section 里；v2 结构化简报**不许**走 html 直写路（降级红线）⇒ 改成把该页 innerHTML 存进
 * deck_data.pages[i].htmlOverride·route 同一条 update 原子双写重渲（渲染层见 buildDeckHtml）。 */

/** 服务端无 DOM·用正则做最低限度的净化：去 <script>、on* 事件属性、javascript: 伪协议、data: 媒体源
 *  （data: 一律不收——一张贴上的 base64 图就能把 body 撑爆 256KB 闸·插图必须走云盘 url）。
 *  🔴 这不是完整 XSS 净化（与旧 HTML 简报 PUT 路同一信任模型：内容只在 sandbox="allow-scripts"
 *  的 opaque-origin iframe 里渲·拿不到父页 cookie/DOM）·此处只是别把明显的脚本载体存进库。 */
export function sanitizePageHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s(?:href|src|xlink:href|poster)\s*=\s*)("|')?\s*javascript:[^"'>\s]*("|')?/gi, '$1$2$3')
    .replace(/(\s(?:src|poster)\s*=\s*)("|')\s*data:[^"']*("|')/gi, '$1$2$3')
}

/** 把该页的手动排版层写进 deck（纯函数）。html 净化后为空白 = 还原版式（摘 htmlOverride）。
 *  超限=可读拒绝 page_html_too_large（route 落 400）。不动结构（页数/页型/目录）·不改标题真源。 */
export function applyPageHtmlEdit(deck: DeckDataV2, pageIndex: number, html: string): DeckEditResult {
  const page = deck.pages[pageIndex]
  if (!page) return { ok: false, error: 'bad_page_index' }
  if (Array.isArray(page.components)) return { ok: false, error: 'page_componentized' }
  if (typeof html !== 'string' || html.length > PAGE_HTML_MAX_CHARS) return { ok: false, error: 'page_html_too_large' }
  const clean = sanitizePageHtml(html).trim()
  const pages = deck.pages.map((p, i) => {
    if (i !== pageIndex) return p
    const np: DeckPageV2 = { ...p }
    if (clean) np.htmlOverride = clean
    else delete np.htmlOverride
    return np
  })
  return { ok: true, deck: { ...deck, pages }, targetPageIndex: pageIndex }
}

function cleanOpt(v: unknown, max: number, fallback: string | undefined): string | undefined {
  if (v === undefined) return fallback           // 没送这个键 = 不动原值
  const s = cleanText(v, max)
  return s || undefined                          // 送了但清空 = 摘掉可选键
}

/** items 数超版式容量时按最小够装容量重挑版式（确定性种子=deckId+页序+页型·引擎同源） */
function relayoutIfOverflow(deck: DeckDataV2, pageIndex: number, layoutId: string, draft: PageDraft): string {
  if (draft.type !== 'content' && draft.type !== 'contents') return layoutId
  const meta = getLayout(layoutId)?.meta
  const cap = meta ? layoutItemCapacity(meta) : undefined
  if (cap !== undefined && draft.items.length <= cap) return layoutId
  return pickLayout(draft, { deckId: deck.deckId ?? '', pageIndex })?.id ?? layoutId
}

/* itemFigure:N 重排：srcMap[新序]=旧序（null=无来源）。
 * 非 itemFigure 键（background/pageFigure）原样保留；映射后一张图也不剩 → undefined（键摘掉）。 */
const ITEM_FIGURE_PREFIX = 'itemFigure:'
function remapItemFigures(
  images: Record<string, SlotImageValue> | undefined,
  srcMap: ReadonlyArray<number | null>,
): Record<string, SlotImageValue> | undefined {
  if (!images) return undefined
  const out: Record<string, SlotImageValue> = {}
  for (const [k, v] of Object.entries(images)) {
    if (!k.startsWith(ITEM_FIGURE_PREFIX)) out[k] = v
  }
  srcMap.forEach((src, j) => {
    if (src === null) return
    const v = images[`${ITEM_FIGURE_PREFIX}${src}`]
    if (v !== undefined) out[`${ITEM_FIGURE_PREFIX}${j}`] = v
  })
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 编辑第 pageIndex 页的文字格：按该页 draft.type 白名单重建 draft（与 AI 填空同一
 * cleanText 闸·用户输入同样转义/剥标签/截长）。纯函数·返回新 deck 不改入参。
 * cover 标题**只要被编辑过（slots.title 在场）**就返回 coverTitle——含清空
 * （''）：旧口径「非空才返回」让清空后 outline.title 与行标题攥着旧值（画面已空白、结构
 * 元数据还是老标题）。route 侧对 ''=行标题退默认「未命名簡報」·outline.title 如实置 ''。
 */
export function applySlotEdit(deck: DeckDataV2, pageIndex: number, slots: SlotEditInput): DeckEditResult {
  const page = deck.pages[pageIndex]
  if (!page) return { ok: false, error: 'bad_page_index' }
  if (Array.isArray(page.components)) return { ok: false, error: 'page_componentized' }
  const old = page.draft
  let draft: PageDraft
  let coverTitle: string | undefined
  /** content 页 items 被整组替换时的图槽重排表（null=本次不动 images） */
  let itemSrcMap: Array<number | null> | null = null
  /** 条目关系改了 ⇒ 版式按新关系重挑（没改＝照旧只在装不下时重挑） */
  let relationChanged = false
  switch (old.type) {
    case 'cover': {
      const title = slots.title === undefined ? old.title : cleanText(slots.title, DRAFT_LIMITS.title)
      const subtitle = cleanOpt(slots.subtitle, DRAFT_LIMITS.subtitle, old.subtitle)
      draft = subtitle ? { type: 'cover', title, subtitle } : { type: 'cover', title }
      if (slots.title !== undefined) coverTitle = title
      break
    }
    case 'contents': {
      // 超版式容量=可读拒绝（too_many_items）·不再静默 slice 到 12 存库截 10 上屏
      let items = old.items
      if (Array.isArray(slots.items)) {
        const next = slots.items.map((x) => cleanText(x, DRAFT_LIMITS.contentsItem)).filter(Boolean)
        if (next.length > manualContentsItemCap()) return { ok: false, error: 'too_many_items' }
        items = next
      }
      draft = { type: 'contents', items }
      break
    }
    case 'transition': {
      const title = slots.title === undefined ? old.title : cleanText(slots.title, DRAFT_LIMITS.title)
      const lead = cleanOpt(slots.lead, DRAFT_LIMITS.lead, old.lead)
      draft = { type: 'transition', title, ...(lead ? { lead } : {}), ...(typeof old.partNo === 'number' ? { partNo: old.partNo } : {}) }
      break
    }
    case 'content': {
      const title = slots.title === undefined ? old.title : cleanText(slots.title, DRAFT_LIMITS.title)
      // 条目关系：不给＝沿用；给认得的值＝设定；null／''／认不得＝摘掉
      const oldRelation = isLayoutRelation(old.relation) ? old.relation : undefined
      const relation: LayoutRelation | undefined = slots.relation === undefined ? oldRelation : (isLayoutRelation(slots.relation) ? slots.relation : undefined)
      relationChanged = relation !== oldRelation
      let items = old.items
      if (Array.isArray(slots.items)) {
        const rawMap = Array.isArray(slots.itemMap) && slots.itemMap.length === slots.items.length
          ? (slots.itemMap as ReadonlyArray<number | null>)
          : null
        const next: Array<{ heading?: string; body: string }> = []
        const kept: Array<number | null> = []
        for (let k = 0; k < slots.items.length; k++) {
          const it = slots.items[k]
          if (!it || typeof it !== 'object') continue
          const heading = cleanText((it as Record<string, unknown>).heading, DRAFT_LIMITS.heading)
          const body = cleanText((it as Record<string, unknown>).body, DRAFT_LIMITS.body)
          if (!heading && !body) continue        // 全空行丢弃（面板空白行不落库）
          next.push(heading ? { heading, body } : { body })
          kept.push(rawMap ? rawMap[k] : k)
        }
        if (next.length > manualContentItemCap(relation)) return { ok: false, error: 'too_many_items' }
        // 图槽重排口径：有 itemMap=按面板真实对应关系走（删/加行图随行）；
        // 无 itemMap（防御路·面板恒送）：等长=纯文字改按原位保留，不等长=对应关系
        // 不可知 → itemFigure 全摘（宁丢不错配——旧病是原样保留后整体错位一格）。
        itemSrcMap = rawMap !== null || next.length !== old.items.length
          ? (rawMap !== null ? kept : kept.map(() => null))
          : kept   // 无 map 且等长：kept=[0..n-1]（空行没触发丢弃）=原位保留
        items = next
      }
      draft = relation ? { type: 'content', title, items, relation } : { type: 'content', title, items }
      break
    }
    case 'end': {
      const title = cleanOpt(slots.title, DRAFT_LIMITS.title, old.title)
      const subtitle = cleanOpt(slots.subtitle, DRAFT_LIMITS.subtitle, old.subtitle)
      draft = { type: 'end', ...(title ? { title } : {}), ...(subtitle ? { subtitle } : {}) }
      break
    }
    default:
      return { ok: false, error: 'bad_page_type' }
  }
  const layoutId = relationChanged
    ? (pickLayout(draft, { deckId: deck.deckId ?? '', pageIndex })?.id ?? page.layoutId)
    : relayoutIfOverflow(deck, pageIndex, page.layoutId, draft)
  const pages = deck.pages.map((p, i) => {
    if (i !== pageIndex) return p
    const np: DeckPageV2 = { ...p, layoutId, draft }
    // 文字格是结构真源：这页一旦经 edit_slots 改过·手动排版层作废（退回版式渲染）
    delete np.htmlOverride
    if (itemSrcMap) {
      const remapped = remapItemFigures(p.images, itemSrcMap)
      if (remapped) np.images = remapped
      else delete np.images
    }
    return np
  })
  let next: DeckDataV2 = { ...deck, pages }
  // 封面标题被编辑过就同步 outline.title（单一标题真源·含清空）
  if (coverTitle !== undefined) {
    next = { ...next, outline: { ...(next.outline ?? {}), title: coverTitle } }
  }
  // 目录随章节单一权威：改章节（transition）标题=权威变了 → 目录重建；无章节时权威
  // 回退 content 页标题 → 此时改 content 标题同样重建。手动直改目录条目不触发重建
  // （改的就是目录本身），但下次章节变动会按权威重写——目录权威=章节，面板有提示。
  // 重建可能改目录**张数**（10→11 章 1 张拆 2 张）→ 被编辑页 index 整体位移，
  // 前端拿旧 index 继续写=写错页。与加删页同法：归一前贴临时标记键·归一后按键定位真实
  // index·标记剥净绝不落库——targetPageIndex 恒返回（无重建时=入参 pageIndex）。
  let targetPageIndex = pageIndex
  const hasTransition = next.pages.some((p) => p.draft.type === 'transition')
  const hasContents = next.pages.some((p) => p.draft.type === 'contents')
  if (hasContents && (old.type === 'transition' || (old.type === 'content' && !hasTransition))) {
    const marked = { ...next, pages: next.pages.map((p, i) => (i === pageIndex ? markTarget(p) : p)) }
    const { deck: normalized, index } = stripTarget(normalizeDeckStructure(marked))
    // 40 页上限不许被 edit_slots 绕过：填章名让目录 1→2 张拆页时总页数会**增长**
    //   ——旧口径只有 addDeckPage 查上限，40 页 deck 靠一笔改字就拆成 41+。归一后统一闸
    //   （见 exceedsPageCapAfter：只拒「增长且越限」·存量超限 deck 的非增长编辑不误伤）。
    if (exceedsPageCapAfter(deck, normalized)) return { ok: false, error: 'deck_full' }
    next = normalized
    // 被编辑页是 transition/content（非 contents）·重建不吞它=恒能找到；防御性钳制兜底
    targetPageIndex = index >= 0 ? index : Math.max(0, Math.min(pageIndex, next.pages.length - 1))
  }
  return { ok: true, deck: next, coverTitle, targetPageIndex }
}

/**
 * 目录重建后「非被编辑页」的 index 换算（前端用）：edit_slots 触发的
 * normalizeDeckStructure 只增删/重排 contents 页·非 contents 页相对顺序不变——
 * 看的是非 contents 页：老序数（它前面有几张非 contents 页）→ 新 deck 里同序数那张的 index；
 * 看的是 contents 页：目录组内第 j 张 → 新目录组第 min(j, 新张数-1) 张（收缩钳制）。
 * 越界/形状缺失一律钳到 [0, len-1]（保守不抛）。
 */
export function remapPageIndexAfterTocRebuild(oldDeck: DeckDataV2, newDeck: DeckDataV2, index: number): number {
  const clamp = (i: number) => Math.max(0, Math.min(i, newDeck.pages.length - 1))
  const oldPage = oldDeck.pages[index]
  if (!oldPage) return clamp(index)
  const isToc = (p: DeckPageV2) => p.draft.type === 'contents'
  if (isToc(oldPage)) {
    const j = oldDeck.pages.slice(0, index).filter(isToc).length
    const newTocIdxs = newDeck.pages.map((p, i) => (isToc(p) ? i : -1)).filter((i) => i >= 0)
    if (newTocIdxs.length === 0) return clamp(index)
    return newTocIdxs[Math.min(j, newTocIdxs.length - 1)]
  }
  const k = oldDeck.pages.slice(0, index).filter((p) => !isToc(p)).length
  const newNonTocIdxs = newDeck.pages.map((p, i) => (!isToc(p) ? i : -1)).filter((i) => i >= 0)
  if (newNonTocIdxs.length === 0) return clamp(index)
  return newNonTocIdxs[Math.min(k, newNonTocIdxs.length - 1)]
}

/* ── 加页 / 删页（轻量·目录从章节单一权威重建）───────────────────────────── */

/**
 * 结构归一（加/删页后调用）：① transition 章序按出现序重编（0 起·引擎同契约）
 * ② contents 页（如有）items 从「章节单一权威」重建——有 transition 用章标题，
 *   没有用 content 页标题。
 * 🔴 多目录页安全：生成管线（engine/paginate）会把超容量目录拆成多张
 *   contents 页——旧实现把**每张**目录页都重写成同一份完整章节列表 = 重复目录 + 单页超
 *   容量截尾。现口径：全部 contents 页视作**一组**（以第一张所在位置为锚·连拆页产物一起
 *   收拢），权威章节列表经 paginateDraft 按版式真容量重新分片（与生成管线同一分页算法·
 *   每页 ≤ maxItemCapacity('contents')·一章不丢），页数随之增减（12 章=6+6 两页·删到
 *   9 章=1 页）。版式/主题沿用原目录页（不够的新分片按引擎确定性挑选）。
 */
export function normalizeDeckStructure(deck: DeckDataV2): DeckDataV2 {
  let seq = 0
  const pages = deck.pages.map((p) => {
    if (p.draft.type !== 'transition') return p
    const partNo = seq++
    return p.draft.partNo === partNo ? p : { ...p, draft: { ...p.draft, partNo } }
  })
  const firstTocIdx = pages.findIndex((p) => p.draft.type === 'contents')
  if (firstTocIdx === -1) return { ...deck, pages }

  const chapterTitles = pages
    .filter((p) => p.draft.type === 'transition')
    .map((p) => (p.draft as { title: string }).title)
    .filter(Boolean)
  const source = chapterTitles.length > 0
    ? chapterTitles
    : pages.filter((p) => p.draft.type === 'content').map((p) => (p.draft as { title: string }).title).filter(Boolean)
  const items = source
    .map((s) => cleanText(s, DRAFT_LIMITS.contentsItem))
    .filter(Boolean)
  // 分片=生成管线同源算法（每片 ≤ 版式最大容量·不 slice 丢章）
  const tocDrafts = paginateDraft({ type: 'contents', items })

  const existingToc = pages.filter((p) => p.draft.type === 'contents')
  const rest = pages.filter((p) => p.draft.type !== 'contents')
  const rebuilt: DeckPageV2[] = tocDrafts.map((draft, j) => {
    // 版式/主题沿用第 j 张原目录页（分片变多时复用最后一张的·再按容量重挑）
    const base = existingToc[Math.min(j, existingToc.length - 1)]
    const np: DeckPageV2 = { ...base, layoutId: relayoutIfOverflow(deck, firstTocIdx + j, base.layoutId, draft), draft }
    // 拆出的新分片不许连 pid 一起复制（撞号=两页同身份·按 pid 找页会指错）：
    // 第 j<原张数 的分片继承原第 j 张身份；多出来的分片发新 pid（base 本无 pid 则保持无）。
    if (j >= existingToc.length && np.pid !== undefined) np.pid = newPagePid()
    return np
  })
  return { ...deck, pages: [...rest.slice(0, firstTocIdx), ...rebuilt, ...rest.slice(firstTocIdx)] }
}

export type AddPageType = 'content' | 'transition'

/* 加/删页的「响应目标页」不能在前端按 afterIndex+1/pageIndex 猜：
 * normalizeDeckStructure 会按章节数增删目录分页（10→11 章目录 1 张拆 2 张），新页/邻页的
 * 最终 index 会额外位移。做法=归一前给目标页对象贴临时标记键，归一后按键定位真实 index，
 * 再把标记从**所有**页上剥净（绝不落库）。normalize 对 transition 重编/目录重建走对象
 * spread（{...p}/{...base}）·标记键随之存活。 */
const TARGET_KEY = '__deckEditTarget'
const markTarget = (p: DeckPageV2): DeckPageV2 =>
  ({ ...(p as Record<string, unknown>), [TARGET_KEY]: true }) as unknown as DeckPageV2
function stripTarget(deck: DeckDataV2): { deck: DeckDataV2; index: number } {
  let index = -1
  const pages = deck.pages.map((p, i) => {
    if (!(TARGET_KEY in (p as Record<string, unknown>))) return p
    if (index === -1) index = i
    const rest = { ...(p as Record<string, unknown>) }
    delete rest[TARGET_KEY]
    return rest as unknown as DeckPageV2
  })
  return { deck: { ...deck, pages }, index }
}

/** 在 afterIndex 之后插入一张该页型的空 slots 页（默认版式=引擎确定性挑选）。
 *  opts.layoutId＝点名版式（必须在版式库·页型＝pageType；不然 bad_layout）。 */
export function addDeckPage(deck: DeckDataV2, afterIndex: number, pageType: AddPageType, opts: { layoutId?: string } = {}): DeckEditResult {
  if (pageType !== 'content' && pageType !== 'transition') return { ok: false, error: 'bad_page_type' }
  if (opts.layoutId !== undefined) {
    const want = getLayout(opts.layoutId)
    if (!want || want.meta.pageType !== pageType) return { ok: false, error: 'bad_layout' }
  }
  // 总页数上限（与生成端 OUTLINE_LIMITS.maxPages 同源）：达上限=可读拒绝
  if (deck.pages.length >= manualDeckPageCap()) return { ok: false, error: 'deck_full' }
  const at = Math.min(Math.max(Math.floor(afterIndex), -1), deck.pages.length - 1) + 1
  const draft: PageDraft = pageType === 'content'
    ? { type: 'content', title: '', items: [] }
    : { type: 'transition', title: '' }
  const layoutId = opts.layoutId ?? pickLayout(draft, { deckId: deck.deckId ?? '', pageIndex: at })?.id
  if (!layoutId) return { ok: false, error: 'bad_page_type' }   // registry 每页型≥2·理论不可达
  // deck 记着皮肤 ⇒ 新页带 skinId（派生＝装饰层＋版式蓝图·theme:* 按皮肤解析）
  const page: DeckPageV2 = markTarget({ pid: newPagePid(), layoutId, ...(deck.themeId ? { themeId: deck.themeId } : {}), ...(isSkinId(deck.skinId) ? { skinId: deck.skinId } : {}), draft })
  const pages = [...deck.pages.slice(0, at), page, ...deck.pages.slice(at)]
  const { deck: normalized, index } = stripTarget(normalizeDeckStructure({ ...deck, pages }))
  // 归一后再闸一道：39 页插 1 页 + 新章名连带目录拆页 = 41——插入前的
  // pages.length 预检（上方 deck_full）拦不住连带增长；统一按归一后总数判。
  if (exceedsPageCapAfter(deck, normalized)) return { ok: false, error: 'deck_full' }
  return { ok: true, deck: normalized, targetPageIndex: index >= 0 ? index : at }
}

/** 删除第 pageIndex 页（至少留 1 页）。目标页=后继页（删末页=前驱）归一后的真实位置。 */
export function deleteDeckPage(deck: DeckDataV2, pageIndex: number): DeckEditResult {
  if (!deck.pages[pageIndex]) return { ok: false, error: 'bad_page_index' }
  if (deck.pages.length <= 1) return { ok: false, error: 'last_page' }
  const followIdx = pageIndex + 1 < deck.pages.length ? pageIndex + 1 : pageIndex - 1
  const pages = deck.pages
    .map((p, i) => (i === followIdx ? markTarget(p) : p))
    .filter((_, i) => i !== pageIndex)
  const { deck: normalized, index } = stripTarget(normalizeDeckStructure({ ...deck, pages }))
  // 统一口径的归一后总数闸（删页数学上不增长——纯防御·与另两 op 同边界）
  if (exceedsPageCapAfter(deck, normalized)) return { ok: false, error: 'deck_full' }
  // 标记页可能在目录收缩时被合并掉（多张 toc 并 1 张）→ 退位安全钳制
  const fallback = Math.max(0, Math.min(pageIndex, normalized.pages.length - 1))
  return { ok: true, deck: normalized, targetPageIndex: index >= 0 ? index : fallback }
}

/**
 * content 条目行「服务端会不会保留」的**同一判据**（面板保存成功后重算
 * 各行 src 用）：与 applySlotEdit content 分支逐字同口径——cleanText 后 heading、body
 * 双空=丢弃。面板若自己 trim 判空，空白/纯标签行会与服务端口径漂移 → src 重排错位。
 */
export function contentRowKept(heading: unknown, body: unknown): boolean {
  return !!(cleanText(heading, DRAFT_LIMITS.heading) || cleanText(body, DRAFT_LIMITS.body))
}

/**
 * 「清结构」写值统一出口：旧 HTML 直存路（保存 PUT / agent replace·insert_slide）
 * 清 deck_data 时**不写裸 null 而写墓碑**（当前行攥有 revision 高水位/旧墓碑地板时）——
 * 裸 null 让高水位失忆：rev5 → HTML 直存写 null → 重新生成 regenDeckRevision(null)=0 起算，
 * 历史 rev 标签页/恢复流可再次命中乐观戳（跨代 ABA·与 restoredDeckData 同病同治）。
 * 无高水位可记（本来就 null/无戳）→ 原样 null（行为与旧版逐字节等）。
 */
export function clearedDeckData(currentRaw: unknown): unknown {
  const floor = deckRevisionFloor(currentRaw)
  return floor !== null ? { [REVISION_FLOOR_KEY]: floor } : null
}

/* ── 空白 deck（新建态·零 LLM）─────────────────────────────────────────── */

/**
 * 空白封面的默认字（标题＋副标）——**真写进 deck_data**：
 *   旧口径 deck 里存空串、只在服务端渲 html（左栏缩图）时临时补占位字，而中栏正本按 deck 画
 *   ⇒ 两边一个有标题有副标、一个显「按下方清單輸入標題」且装饰点位置不同（副标在不在会改版式排位）。
 *   现口径：画面上的字只有一个出处＝deck_data·缩图／正本／放映都从它画·渲染层不再补字。
 */
export function blankCoverDraft(lang: DeckLang): PageDraft {
  const cn = lang === 'zh-CN'
  return {
    type: 'cover',
    title: cn ? '空白简报' : '空白簡報',
    // 定案：编辑区在画布下方的元件清单
    subtitle: cn ? '按下方清单编辑标题与内容' : '按下方清單編輯標題與內容',
  }
}

/**
 * 封面还没填过字（标题与副标都空·且没物化成组件、没有手动排版层）⇒ 换成 {@link blankCoverDraft}；
 * 其余原样返回（同一个对象）。纯函数。
 */
export function fillBlankCover(page: DeckPageV2, lang: DeckLang): DeckPageV2 {
  const d = page.draft
  if (d.type !== 'cover' || Array.isArray(page.components)) return page
  if (typeof page.htmlOverride === 'string' && page.htmlOverride.trim()) return page
  if ((typeof d.title === 'string' && d.title.trim()) || (typeof d.subtitle === 'string' && d.subtitle.trim())) return page
  return { ...page, draft: blankCoverDraft(lang) }
}

/**
 * 新建空白简报的起始版式钉死一套：主题森林苔藓＋封面「左字右配圖卡」。
 *   旧口径按 deckId 种子在 3 主题 × 3 封面版式里随机挑 ⇒ 每份新简报长得不一样、模板页也找不到「那一套」。
 *   主题同时登记成模板卡「空白簡報（預設）」（templates/catalog.ts BLANK_DEFAULT_TEMPLATE_ID·单测钉两处同值）。
 */
export const BLANK_DECK_THEME_ID = 'forest-moss'
export const BLANK_COVER_LAYOUT_ID = 'cover-split'

/** 空白单页 deck：起始版式固定（见上）·默认标题／副标真写进 deck（见 blankCoverDraft） */
export function blankDeckV2(deckId: string, lang: DeckLang): DeckDataV2 {
  const theme = getTheme(BLANK_DECK_THEME_ID) ?? THEMES[hashSeed(deckId) % THEMES.length]
  const draft: PageDraft = blankCoverDraft(lang)
  const layoutId = getLayout(BLANK_COVER_LAYOUT_ID) ? BLANK_COVER_LAYOUT_ID : (pickLayout(draft, { deckId, pageIndex: 0 })?.id ?? 'cover-split')
  return {
    version: 2,
    outline: { title: '', pages: [{ type: 'cover' }] },
    lang,
    themeId: theme.id,
    deckId,
    revision: 0,
    pages: [{ pid: newPagePid(), layoutId, themeId: theme.id, draft }],
  }
}

/* ── 串行任务队列（前端 patchDeck 用· +）─────────────
 * 旧口径「上一笔在飞就丢弃本笔」会静默丢连续编辑（第一次失焦清了 dirty、第二次失焦
 * 撞忙锁直接 return——既不排队也不恢复 dirty）。现口径：一律排队、顺序执行、一笔不丢；
 * 单笔异常吞掉（返回 null）不断链·全空时回调 onIdle（busy 态复位）。
 * cancelPending：首笔吃 409 重载最新数据后，队内**还没开跑**的后续笔
 * 全是冲突前旧屏快照凑的——execution-time 现读新戳会让它们绕过乐观戳、把整页旧槽位
 * 盖回他窗刚写的内容。409 处理方必须调 cancelPending 整队作废（被取消笔 resolve null·
 * 调用方按失败路径走=面板恢复脏标可重编）。在跑那笔不受影响（它自己正处理 409）。
 * detach：**跨文档队列换血**的旧队侧收口（CONFIRMED：全组件共用一只
 * 串行队列时，A 简报的 PATCH 永久 pending 会把 B 简报的保存笔压在 tail.then() 后面=
 * 切文档后 B 保存被 A 阻塞；URL 切换只作废显示归属救不了任务队列）。口径：文档切换
 * 第一拍旧队列 detach（=cancelPending 整队作废 + **onIdle 永久静音**）+ 换一只新队列——
 *   静音的必要性：新文档已换新队列，旧队列在跑那笔稍后收尾排空时若还回调 onIdle，
 *     会把新文档刚开始的 busy 态错清（跨队串显示=同族病）；
 *   在跑那笔照常收尾（fetch 不可撤·其结果由调用方的 loadedIdRef 执行时守卫+保存
 *     归属句柄各自免疫）；detach 后再 enqueue 的笔一律不执行 resolve null（fail-closed·
 *     正确用法=换新队列后不该再往旧队塞）。幂等。 */
export type SerialTaskQueue = {
  /** 队内未完成任务数（含在跑那笔） */
  pending(): number
  enqueue<T>(task: () => Promise<T>): Promise<T | null>
  /** 作废所有还没开跑的任务（在跑那笔照常收尾）——409 冲突重载后旧快照笔全弃 */
  cancelPending(): void
  /** 文档切换第一拍：整队作废 + onIdle 永久静音（旧队列排空不再错清新文档 busy）·幂等 */
  detach(): void
}

/* ── 面板提交闸────────────────────────────────────────────────
 * 面板「脏标/在飞/pending」三态的唯一状态机（DeckSlotPanel 用·纯函数层可单测）。
 * 🔴 病根（CONFIRMED）：旧口径首笔失败（尤其 409）恢复 dirty 后，把在飞期间攒下的
 * pending **无条件再次 send()**——409 时父层已 cancelPending() 整队作废 + 落最新行 + 重挂
 * 面板，可这笔延迟重发住在**旧组件实例的 Promise 续体**里，父层管不到它：它会按刷新后的
 * 新 revision 提交冲突前的陈旧缓冲 → 乐观戳命中 → 静默盖回他窗刚写的内容。
 * 现口径：pending 只在「前一笔真成功 && 实例未 dispose（未被重挂/卸载）」才自动重发；
 * 失败路一律只保 dirty——存活实例由用户下一次失焦按当前缓冲原值重试（v3  行为不变），
 * 已作废实例就此打住（新面板挂的是库最新真值·旧缓冲不再是有效基准）。 */
export type CommitGate = {
  /** 输入变更（onChange）：只标脏·等失焦/显式提交 */
  markDirty(): void
  /** 失焦/结构小改：脏才发·在飞转 pending（不丢不重入） */
  commit(): void
  /** 组件卸载/重挂：此后一切延迟重发作废（旧实例缓冲已不是有效基准） */
  dispose(): void
  /** dispose 可逆（effect setup 调）：React StrictMode dev 态首挂走
   *  setup→cleanup→setup——cleanup dispose 后 setup 必须能复活同一实例的闸，否则首挂后
   *  所有 commit() 永久被拒（病灶）。真卸载=cleanup 后没有下一次 setup ⇒ 恒 disposed·
   *  「旧实例延迟重发作废」语义分毫不变（依赖的是卸载后无人 resume·不是 dispose 不可逆）。 */
  resume(): void
  /** 测试探针 */
  isDirty(): boolean
  isInFlight(): boolean
}

/** exec 返回 false/reject=失败（其余含 void 视为成功）——与 onEditSlots 回报口径一致。 */
export function createCommitGate(exec: () => Promise<boolean> | boolean | void): CommitGate {
  let dirty = false
  let inFlight = false
  let pending = false
  let disposed = false
  const send = () => {
    dirty = false
    inFlight = true
    let run: Promise<boolean>
    try {
      // exec 同步发起（失焦即刻发请求·与旧面板 send 口径一致）；同步 throw 与 reject 同=失败
      run = Promise.resolve(exec()).then((ok) => ok !== false, () => false)
    } catch {
      run = Promise.resolve(false)
    }
    run
      .then((ok) => {
        if (!ok) dirty = true
        inFlight = false
        if (!pending) return
        pending = false
        // 自动重发的两道闸：前一笔失败（旧缓冲基准已作废·父层可能已落最新行
        // 重挂面板）或本实例已 dispose（旧实例的续体不许再拿新 revision 提交陈旧缓冲）→ 打住。
        if (ok && !disposed && dirty) send()
      })
  }
  return {
    markDirty: () => { dirty = true },
    commit: () => {
      if (disposed || !dirty) return
      if (inFlight) { pending = true; return }
      send()
    },
    dispose: () => { disposed = true },
    resume: () => { disposed = false },
    isDirty: () => dirty,
    isInFlight: () => inFlight,
  }
}

/* ── 面板身份 key（React key=重挂开关）───────────────────────────
 * 病灶：存量 pid-less deck 首笔 PATCH 服务端补 pid → 前端 key 由「页序」变「pid」强制
 * 重挂——首笔在飞期间的第二笔本地输入连同提交闸里攒的 pending 一起被销毁。
 * 做法：
 *   pid 稳定（prev.pid === pid）→ 恒沿用旧 key：index 位移也不换代（语义·
 *     index 对齐到最新=后续「同 index 长出 pid」类判断不吃陈值）；
 *   身份从无到有（prev 无 pid·同一 index 上长出 pid）→ 沿用旧 key、只记下 pid——
 *     这是同一逻辑页刚获得身份，不是换页；⚠️ 补 pid 与目录拆/并页**同笔**发生（index 也
 *     位移）时纯函数分不清「同页搬家」和「翻页」——那一步由父层在响应处理那刻用
 *     {@link adoptDeckPanelIdentity} 收养（父层拿着 targetPageIndex=确知是同一逻辑页）；
 *   「从有到无」（prev 有 pid·本轮渲染读到无 pid）→ 粘住 prev 不动：pid 一经落库永不
 *     被摘，同一 deck 内不存在「有身份页→无身份页」的合法过渡——此形态只可能是落屏前
 *     插队的陈旧渲染（提交期效应若把 pid 抹回 null，下一真渲染会误判换页重挂），或整本
 *     换 deck（载入/恢复路径 resetKey+1 且身份 ref 已清 null·根本走不进 prev 非空分支）；
 *   其余（真换页/换 pid）→ 新 key（pid 优先·pid-less 退页序）。
 * 纯函数（幂等+收敛：同输入重算返回等值结果；对更旧的输入返回 prev 不倒退）——
 * page.tsx 渲染期只读算·提交期（useEffect）才写 ref。 */
export type DeckPanelIdentity = { key: string; pid: string | null; index: number }

export function nextDeckPanelIdentity(
  prev: DeckPanelIdentity | null,
  pid: string | null | undefined,
  index: number,
): DeckPanelIdentity {
  const p = typeof pid === 'string' && pid ? pid : null
  if (prev) {
    if (p !== null) {
      if (prev.pid === p) return prev.index === index ? prev : { key: prev.key, pid: p, index }
      if (prev.pid === null && prev.index === index) return { key: prev.key, pid: p, index }
    } else if (prev.pid !== null) {
      return prev   // 从有到无=陈旧渲染（pid 永不被摘·换 deck 由「resetKey+1 且清 ref」兜）
    }
  }
  return { key: p !== null ? `pid:${p}` : `idx:${index}`, pid: p, index }
}

/* ── 身份收养（响应处理那刻·事件期调用）─────────────────────
 * 场景：存量 pid-less deck 首笔 edit_slots 既补 pid **又**触发目录拆/并页——响应里
 * 「身份从无到有」和「index 位移」同笔到达。渲染期纯函数只能按「同 index 长出 pid」
 * 沿用 key，位移场景会误判成翻页 → 重挂销毁第二笔飞行输入/pending。父层在响应处理
 * 那刻**确知**目标页就是被编辑的同一逻辑页（服务端 targetPageIndex/换算表 remap），
 * 在这里显式收养：prev 无 pid → 沿用旧 key、记下新 pid+新 index；同 pid → 只对齐
 * index；pid 真变（不是同一页）→ 不收养、按新身份走（下一渲染重挂取真值）。
 * 「换号≠换页」窗：服务端 ensureDeckPagePids 对**坏形**（超长>64/空）
 * 或**撞号**（deck 内重复·非首个占号者）的存量 pid 会换发新号——同一逻辑页「旧 pid→
 * 新 pid」。旧口径一律判「身份真变」换代重挂=首笔在飞期间第二笔输入+pending 被销毁
 * （与「从无到有」同病）。判据收窄不放宽：只有旧 pid 在**发笔那刻快照**（prevDeck）里
 * 可证「必被服务端换号」——坏形（!isValidPagePid）或撞号（同 pid 页数>1）——才收养沿用
 * 旧 key；合法且唯一的 pid 变了=真换页（陈旧 ref/迟到响应），照旧换代取库真值。
 * 🔴 只许在事件期（fetch 响应处理）调用后写 ref——渲染期维持只读。 */
export function adoptDeckPanelIdentity(
  prev: DeckPanelIdentity | null,
  pid: string | null | undefined,
  index: number,
  prevDeck?: DeckDataV2 | null,
): DeckPanelIdentity | null {
  const p = typeof pid === 'string' && pid ? pid : null
  if (!prev) return prev            // 面板没挂过：无身份可收养·首渲自会铸新
  if (p === null) return prev       // 响应页无 pid（服务端 ensure 后理论不存在）：不动
  if (prev.pid === p) return prev.index === index ? prev : { key: prev.key, pid: p, index }
  if (prev.pid === null) return { key: prev.key, pid: p, index }   // 从无到有·index 位移也不换代（调用方担保同一逻辑页）
  // 旧 pid 坏形/在发笔快照里撞号 ⇒ 服务端必换号：同一逻辑页收养不换代
  if (
    !isValidPagePid(prev.pid) ||
    (prevDeck ? prevDeck.pages.filter((pg) => pg.pid === prev.pid).length > 1 : false)
  ) {
    return { key: prev.key, pid: p, index }
  }
  return { key: `pid:${p}`, pid: p, index }   // 身份真变：不该收养=换代（面板重挂取库真值）
}

/* ── 旧 HTML 保存（slides PUT/POST）响应 → 保存态映射 ─────────────
 * 病灶：savePresentation 的 PUT 不看 res.ok 就置 saved——服务端 CAS 重试耗尽回 409
 * （updateHtmlClearingDeckData conflict）时显示「已儲存」实未落库（假绿）。
 * 口径与 v2 patchDeck 分流同构：409=冲突专属可读提示·其余非 2xx=儲存失敗·都不置 saved。 */
export function htmlSaveStatusFromResponse(ok: boolean, status: number): 'saved' | 'save_conflict' | 'edit_failed' {
  if (ok) return 'saved'
  return status === 409 ? 'save_conflict' : 'edit_failed'
}

/* ── 保存状态计时器（page.tsx 保存指示的唯一状态机·可注入时钟单测）──
 * 病灶（CONFIRMED）：开始新保存时不撤旧「转 idle」计时器——连续保存且后笔较慢时，前笔
 * 成功排下的 setTimeout 在后笔仍在飞时触发，把 'saving' 提前打成 'idle'（界面在请求尚未
 * 完成时隐藏「保存中」）。口径：
 *   beginSaving()：先撤一切未触发的「转 idle」计时器再置 'saving'——保存在飞期间不存在
 *     任何能动状态的旧计时器；
 *   settle(s)：置终态并排「转 idle」计时器（saved=2000ms·可读失败提示=5000ms）；连续
 *     settle 后到先撤前=任何时刻至多一只计时器在飞；
 *   dispose()：卸载清理（幂等）——撤计时器**并置终态旗标**。
 * dispose 必须是**终态**：旧口径 dispose 只清当前 timer——卸载后仍在飞
 * 的请求 settle() 时照样调 state setter（对已卸载组件 setState）**并新排一只转 idle 计时器**
 * （泄漏·2s/5s 后再 set 一次）。现口径：disposed 旗标 fail-closed——dispose 后 beginSaving/
 * settle/reset 全部 no-op（不 set 不排新计时器）；resume() 配对给 StrictMode dev 首挂的
 * effect 重放（setup→cleanup(dispose)→setup(resume)·与 createCommitGate 同款生命周期——
 * 真卸载后无人 resume=永久终态）。reset()=「静默转 idle」（撤计时器+set('idle')·disposed
 * 时连 set 都不做）——收口 page.tsx 四处裸 setSaveStatus('idle')（catch/切走路径），否则
 * 那些路径在卸载后照样 setState。
 * schedule/cancel 可注入（单测假时钟）·默认 setTimeout/clearTimeout。
 * 保存代际归属（CONFIRMED×2）：全组件共用一只计时器·旧口径任何
 * 写手（patchDeck/savePresentation/restoreVersion）的迟到响应都能无归属地 reset/settle——
 * A 简报的迟到响应把 B 简报刚开始的保存误置 idle；且文档切换本身没有同步复位点，
 * A 的 fetch 一直 pending 时切到 B 永久卡「保存中」。口径：
 *   acquire()：归属版 beginSaving——翻归属代+置 saving·返回**只在本代有效**的句柄
 *     {settle,reset}（后来者 acquire/invalidate 翻代后·旧句柄一切调用静默 no-op=迟到响应
 *     碰不到新归属的状态）；
 *   invalidate()：文档代际切换的同步复位点——翻代作废一切在飞句柄+静默转 idle（不等
 *     旧请求收尾·pending 的请求此后无论何时返回都摸不到状态）；
 *   裸 settle/reset/beginSaving 保留（无归属·仅限「非请求响应」的即时用户动作用）。
 * preemptSettle（CONFIRMED）：即时用户动作的**显示接管**——裸 settle 不翻
 *   归属代，409 处理链（bump 后仍在 await json/落屏）的原 owned 句柄稍后 settle('conflict')
 *   会把「删除已取消」这条更具体的提示盖成普通冲突文案。口径：preemptSettle(s)=翻归属代
 *   （作废一切在飞句柄·与 acquire/invalidate 同一单调计数）+置终态提示——「谁的响应许动
 *   显示」由代际裁：迟到响应全 no-op·后续新保存 acquire 照常接管。page.tsx 确认按钮
 *   cancel_stale 一处专用（裸 settle 在 page.tsx 就此绝迹）。 */
export type SaveSettleStatus =
  | 'saved' | 'conflict' | 'save_conflict' | 'edit_failed' | 'page_gone' | 'page_ambiguous'
  | 'restore_failed' | 'restore_unverified' | 'delete_confirm_stale'

/** 归属句柄：只有仍是当前归属代时 settle/reset 才生效（迟到响应免疫） */
export type OwnedSaveHandle = {
  settle(s: SaveSettleStatus): void
  reset(): void
}

export type SaveStatusTimer = {
  beginSaving(): void
  /** 归属版 beginSaving：翻归属代+置 saving·返回只在本代有效的句柄 */
  acquire(): OwnedSaveHandle
  /** 文档切换同步复位点：作废一切在飞句柄+静默转 idle */
  invalidate(): void
  /** 即时用户动作的显示接管：翻归属代（作废一切在飞句柄）+置终态提示——
   *  正在飞的请求响应此后 settle/reset 全 no-op·不覆盖本提示；后续 acquire 照常接管 */
  preemptSettle(s: SaveSettleStatus): void
  settle(s: SaveSettleStatus): void
  /** 静默转 idle（撤计时器·disposed 时不 set）——catch/切走路径用 */
  reset(): void
  /** 终态：撤计时器+此后一切 set/排程拒绝（幂等） */
  dispose(): void
  /** StrictMode effect 重放配对复活（真卸载后无人调=终态保持） */
  resume(): void
}

export function createSaveStatusTimer(deps: {
  set: (s: SaveSettleStatus | 'saving' | 'idle') => void
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}): SaveStatusTimer {
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const cancel = deps.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let handle: unknown = null
  let disposed = false
  // 归属代：acquire/invalidate 单调翻代——旧代句柄的 settle/reset
  // 一律 no-op（不 set 不撤不排计时器·当前归属的显示不被迟到响应碰）
  let owner = 0
  const clear = () => {
    if (handle !== null) { cancel(handle); handle = null }
  }
  const beginImpl = () => {
    if (disposed) return
    clear(); deps.set('saving')
  }
  const settleImpl = (s: SaveSettleStatus) => {
    if (disposed) return
    clear()
    deps.set(s)
    handle = schedule(() => { handle = null; deps.set('idle') }, s === 'saved' ? 2000 : 5000)
  }
  const resetImpl = () => {
    clear()
    if (!disposed) deps.set('idle')
  }
  return {
    beginSaving: beginImpl,
    acquire() {
      const my = ++owner
      beginImpl()
      return {
        settle: (s: SaveSettleStatus) => { if (owner === my) settleImpl(s) },
        reset: () => { if (owner === my) resetImpl() },
      }
    },
    invalidate() { owner += 1; resetImpl() },
    preemptSettle(s: SaveSettleStatus) { owner += 1; settleImpl(s) },
    settle: settleImpl,
    reset: resetImpl,
    dispose() { disposed = true; clear() },
    resume() { disposed = false },
  }
}

/* ── 删除确认框目标页身份解算（打开→确认之间库可能已变）────────
 * 病灶（PLAUSIBLE·亲证）：pid-less 页输入框聚焦时直接点「删除本页」——blur 先发
 * edit_slots PATCH（服务端补全 deck pid + 目录拆/并页=index 位移），确认框却攥着打开
 * 那刻的 {旧 index, pageId:undefined}；确认时按旧 index 删=删错页（身份换算旧口径只盖
 * edit_slots·delete 无人管）。
 * 口径（确认那刻现算·纯函数）：
 *   已攥 pid → 原样返回（服务端按 pid 找页·index 只是兜底·v8 语义零变化）；
 *   无 pid 且 deck 自打开后已换代（引用变）→ 按目录重建换算表把旧 index 翻译成现 deck
 *     的 index（非 contents 页相对序不变=blur 笔唯一可能的结构改动），再从现 deck 该页
 *     补读 pid（blur 笔已让服务端 ensure 全 deck pid）；
 *   无 pid 且 deck 未换代 → index 原样·仍尝试补读 pid（有则更稳·无则行为逐字不变）；
 *   现 deck 缺失（降级/清空）或 deckAtOpen 缺失（防御）→ 不换算（patchDeck 入口闸/
 *     服务端 page_gone+乐观戳兜底）。越界 index 不钳制不换页——宁可让服务端可读拒绝，
 *     不静默改删别的页。 */
export function resolveDeleteTarget(
  saved: { pageIndex: number; pageId?: string },
  deckAtOpen: DeckDataV2 | null | undefined,
  deckNow: DeckDataV2 | null | undefined,
): { pageIndex: number; pageId?: string } {
  if (saved.pageId) return { pageIndex: saved.pageIndex, pageId: saved.pageId }
  if (!deckNow) return { pageIndex: saved.pageIndex }
  const idx = deckAtOpen && deckAtOpen !== deckNow
    ? remapPageIndexAfterTocRebuild(deckAtOpen, deckNow, saved.pageIndex)
    : saved.pageIndex
  const pid = deckNow.pages[idx]?.pid
  return { pageIndex: idx, ...(pid ? { pageId: pid } : {}) }
}

/* ── 冲突重载代际闸（删除确认框专用·可单测状态机）──────────────────
 * 病灶（CONFIRMED）：409 冲突重载把**他窗最新结构**落屏，但打开着的删除确认框不关——
 * resolveDeleteTarget 的换算表只假设「同窗 blur 笔目录拆并页」（非 contents 页相对序不变），
 * 他窗真删了原目标页时该假设不成立：pid-less 确认框按位序换算落到**继任页**、再从现 deck
 * 补读继任页 pid → 用户点「确认删除」真删继任页（服务端按 pid 找页=正确地删错了）。
 * 做法：冲突重载过后，作废打开中的删除确认（不按位序推测目标页）：
 *   bump()：409 检出那刻**同步**翻代（在一切 await 之前）——两窗都关死：
 *     窗A（打开→确认之间重载已落屏）：409 路径顺手关框+可读提示，即便关框 setState 尚未
 *     提交、用户抢点「确认」，确认闸按代际拒绝；
 *     窗B（确认那刻重载仍在飞）：409 已检出但 json/落屏还在 await——确认点击落在这窗内时
 *     epoch 已翻，确认闸同样拒绝。（确认点击早于 409 检出的更早窗=delete 已入队，由
 *     cancelPending 整队作废收口·既有机制。）
 *   epochNow()：打开确认框那刻快照，存进 deleteConfirm；
 *   isStale(e)：确认那刻对照——不等=经历过冲突重载·撤销操作。
 * bump 的第二个调用点=**文档切换第一拍**（URL effect·所有 await 之前）：
 *   无冲突的同路由换文档（?id=A→?id=B）不走 409 路·epoch 原口径不翻——A 的 pid-less
 *   确认框会被 resolveDeleteTarget 对 B 的 deck 换算到继任页还补读其 pid（命中 pid 反而
 *   绕过服务端 page_gone 兜底=正确地删错页）。切换那拍同步 bump+关框：关框 setState 未
 *   提交前抢点「确认」也被代际闸拒绝（与 409 窗B 同款）。isStale 语义不变（快照对照）。 */
export type DeckConflictGuard = {
  /** 打开确认框那刻快照 */
  epochNow(): number
  /** 409 检出那刻同步翻代（一切 await 之前） */
  bump(): void
  /** 确认那刻对照：true=打开后经历过冲突重载·待确认操作必须撤销 */
  isStale(epochAtOpen: number): boolean
}

export function createDeckConflictGuard(): DeckConflictGuard {
  let epoch = 0
  return {
    epochNow: () => epoch,
    bump: () => { epoch += 1 },
    isStale: (epochAtOpen: number) => epochAtOpen !== epoch,
  }
}

/* ── 确认删除决策（page.tsx 确认按钮的唯一决策函数·纯函数可单测）────────
 * 先过代际闸再解算目标：经历过冲突重载 → cancel_stale（关框+可读提示·不删任何页）；
 * 未经历 → 与旧口径逐字同（resolveDeleteTarget 确认那刻现算）。
 * 令牌双绑 {docId, epoch}（破坏性确认令牌不能只绑冲突 epoch 还必须绑
 * 文档 ID·否则无冲突的同路由换文档会绕过代际闸）——执行删除前双核：
 *   epoch 闸（原有）：打开后经历过 409 冲突重载/文档切换 bump → 撤销；
 *   docId 闸（新增）：saved.docId=打开那刻文档归属（loadedIdRef 现值）·docNow=确认那刻
 *     同一来源现值——不等=令牌属别的文档·撤销（兜「没经过 URL effect 复位点」的残窗·
 *     与 epoch 闸互为独立保险）。docId 缺省（旧令牌/session-only 未持久化 deck）与
 *     docNow=null 归一比较：null===null 放行（session 内自删自的页照旧）·一边有值一边
 *     null=文档归属真变过（如首存转正落在框开着的窗内）→ 宁可撤销让用户重开框。
 * 第三闸=**URL 意图闸**（PLAUSIBLE·提交前同步闸落地）：作废动作
 * （bump+关框）全在 URL effect（passive）里——「URL 已变到 ?id=B、effect 尚未执行」的
 * 窗内 loadedIdRef 仍是 A、epoch 未翻，docId/epoch 双核都拦不住抢点的确认。urlDocNow=
 * 确认那刻 **window.location.search 同步现读**的 ?id=（导航意图的同步真值·不等任何
 * effect/重渲）——与令牌 docId 不等=用户已表达去别的文档的意图·撤销待确认删除。
 * null 归一同 docId 闸：双 null（session-only 未持久化·URL 本无 ?id=）放行；半 null
 * （如首存转正 replaceState 落在框开着的窗内）撤销——方向与 docId 闸一致。
 * 三闸正交各兜一窗：epoch=经过复位点（409/切换 effect 已跑）·docId=已加载文档已换·
 * urlDocNow=导航意图已发出而 effect 未跑。任一触发即撤销。 */
export function resolveConfirmedDelete(
  saved: { pageIndex: number; pageId?: string; docId?: string | null; deckAtOpen?: DeckDataV2 | null; epochAtOpen: number },
  guard: Pick<DeckConflictGuard, 'isStale'>,
  docNow: string | null,
  deckNow: DeckDataV2 | null | undefined,
  urlDocNow: string | null,
): { kind: 'cancel_stale' } | { kind: 'delete'; target: { pageIndex: number; pageId?: string } } {
  if (guard.isStale(saved.epochAtOpen)) return { kind: 'cancel_stale' }
  if ((saved.docId ?? null) !== docNow) return { kind: 'cancel_stale' }
  if ((saved.docId ?? null) !== (urlDocNow ?? null)) return { kind: 'cancel_stale' }
  return { kind: 'delete', target: resolveDeleteTarget(saved, saved.deckAtOpen, deckNow) }
}

/* ── 队列执行时刻的 op 身份换算（的 delete 扩展）──
 * 确认删除时前笔（blur edit_slots）仍在飞：delete 排在其后·执行那刻结构已被前笔改动
 * （enqueueDeck ≠ 执行时 deck·调用方判引用后才进来）。edit_slots 语义原样（只换算
 * index）；delete_page 除换算 index 外再从执行时 deck 补读 pid——服务端
 * 按 pid 找页=陈索引不再删错页。
 * add_page 同窗收口：pid-less deck 首笔编辑（blur）与「加页」同手势
 * ——add 排在 edit_slots 之后·前笔触发目录拆/并页=锚页 index 位移，旧口径 add 被显式
 * 放过 → 按陈旧 afterIndex 插错位置。现口径：无 afterPageId 的 add_page 在执行那刻按
 * 换算表把 afterIndex 翻译成锚定**同一逻辑页**的新 index，并从执行时 deck 补读该页 pid
 * 作 afterPageId（前笔已让服务端 ensure 全 deck pid·服务端按 pid 解锚=双保险）。锚页是
 * contents 且被并页收缩时换算表钳到目录组末张（锚语义=「插在目录组之后」·保守不越组）。
 * 带 afterPageId 的 add / rename（无位置语义）原样返回。 */
export function remapQueuedOpForExec<
  T extends { kind: string; pageIndex?: number; pageId?: string; afterIndex?: number; afterPageId?: string },
>(
  op: T,
  enqueueDeck: DeckDataV2,
  execDeck: DeckDataV2,
): T {
  if (op.kind === 'add_page') {
    if (op.afterPageId !== undefined || typeof op.afterIndex !== 'number') return op
    const idx = remapPageIndexAfterTocRebuild(enqueueDeck, execDeck, op.afterIndex)
    const pid = execDeck.pages[idx]?.pid
    return { ...op, afterIndex: idx, ...(pid ? { afterPageId: pid } : {}) } as T
  }
  if (op.kind !== 'edit_slots' && op.kind !== 'delete_page' && op.kind !== 'edit_page_html') return op
  if (op.pageId !== undefined || typeof op.pageIndex !== 'number') return op
  const idx = remapPageIndexAfterTocRebuild(enqueueDeck, execDeck, op.pageIndex)
  if (op.kind === 'delete_page') {
    const pid = execDeck.pages[idx]?.pid
    // 泛型 spread 收窄限制：结构同形（只覆写 pageIndex/补可选 pageId）·断言回 T
    return { ...op, pageIndex: idx, ...(pid ? { pageId: pid } : {}) } as T
  }
  return { ...op, pageIndex: idx } as T
}

/* ── 发起代际计数器（A→B→A 旧响应复活窗终封·挂载级单调计数）──────────
 * 病灶（CONFIRMED）：patchDeck 发笔只捕获 sid/queue·响应落屏守卫只比 loadedIdRef===sid
 * ——A→B→A 后「当前文档 ID」恢复成 A，A 的旧 PATCH 响应重新取得落屏资格：可覆盖更新
 * 的 A 画面、翻冲突代并关闭新开的确认框（409 路 bump/关框/落屏全排在该守卫之后）。
 * 做法：每笔请求另记发起时的代际；落屏前代际不符即丢弃（只比文档 ID 挡不住 A→B→A）。
 *   bump()：**文档切换复位点**（URL effect 第一拍主块·与 invalidate/冲突 bump/队列
 *     换血同一同步块）单调递增——能发笔的文档会话（前提=已落屏且 URL=本档）离开时
 *     必经该块=切换类翻代单点全覆盖（A→B→A 无论 B 落没落屏·A→B 那拍已翻·旧笔终生失格）；
 *     切回支路（B 未落屏折返·loadedIdRef 复原处）**不翻**——离开时已翻·再翻只会误杀
 *     首存转正 replaceState 窗内合法在飞笔（该支路对转正也可达）。
 *     恢复换血点同拍 bump（restoreVersion 成功落屏/回读对齐两处）——
 *     同文档版本恢复=同一 ID 内的内容代际替换·不翻代则「恢复前已写库但响应延迟」的
 *     PATCH 仍同代同归属·旧 revision 回盖恢复后的画面（翻代点全谱恰三处·契约钉死）。
 *     restoreVersion 自身发起那刻也捕获快照（restoreGen）·恢复链
 *     post-await 写点统一 staleRestore=代际主判据+恢复代双保险（A→B→A 下 mySeq 与
 *     loadedIdRef 都会重新成立·只有代际救得住）。
 *   now()：发笔那刻快照（与 sid/myQueue 同拍同步捕获）；
 *   isCurrent(g)：响应落屏守卫主判据——不等=发起代际已翻·代际只增不回=永不复活。 */
export type DocIssueGeneration = {
  /** 发笔那刻快照 */
  now(): number
  /** 文档切换复位点单调递增（一切 await 之前） */
  bump(): void
  /** 响应落屏守卫：false=发起代际已翻·旧响应终生失格 */
  isCurrent(genAtIssue: number): boolean
}

export function createDocIssueGeneration(): DocIssueGeneration {
  let gen = 0
  return {
    now: () => gen,
    bump: () => { gen += 1 },
    isCurrent: (genAtIssue: number) => genAtIssue === gen,
  }
}

export function createSerialTaskQueue(onIdle?: () => void): SerialTaskQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let depth = 0
  let gen = 0
  let detached = false   // 文档切换后旧队列终态：不再执行新笔·不再回调 onIdle
  return {
    pending: () => depth,
    cancelPending: () => { gen += 1 },
    detach: () => { gen += 1; detached = true },
    enqueue<T>(task: () => Promise<T>): Promise<T | null> {
      depth += 1
      const myGen = gen
      const run: Promise<{ ok: true; v: T } | { ok: false }> = tail.then(() => {
        // 排队期间被作废（cancelPending 翻代）/ 队列已 detach（fail-closed）：不执行
        if (myGen !== gen || detached) return { ok: false as const }
        return Promise.resolve()
          .then(() => task())
          .then(
            (v) => ({ ok: true as const, v }),
            () => ({ ok: false as const }),
          )
      })
      tail = run
      return run.then((r) => {
        depth -= 1
        // detach 后 onIdle 永久静音：旧队列在跑那笔迟到排空时
        // 不许错清新文档（新队列）刚开始的 busy 态
        if (depth === 0 && !detached) onIdle?.()
        return r.ok ? r.v : null
      })
    },
  }
}
