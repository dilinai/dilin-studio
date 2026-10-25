/**
 * slide-kit pipeline · 中间格式 schema（大纲 + 逐页填空）· prompt 与白名单净化
 *
 * S3 生成管线：
 *   - AI 只产「纯内容五型中间格式」——本文件是这条规矩的执行闸：
 *     sanitizeOutline / sanitizePageDraft 用**白名单重建**（只抄允许的键、
 *     字符串一律剥 HTML 标签与控制字符）——AI 输出里任何样式/坐标/颜色/
 *     字号/HTML 字段在这里被物理丢弃，进不了落库数据。
 *   - 给 AI 的 schema 说明用「必须/建议/严禁」三级约束写法（参考 PPTist 的写法）。
 */

import type { LayoutRelation, PageDraft, PageType } from '../types'
import { isLayoutRelation } from '../types'

/* ------------------------------------------------------------------ */
/* 大纲（outline-first 第一段·用户可改可确认后才成片）                    */
/* ------------------------------------------------------------------ */

/** 大纲里的一页：只有页型 + 标题 + 要点（纯内容·无任何样式字段） */
export type OutlinePage = {
  type: PageType
  /** cover 页此字段忽略（封面标题恒 = 大纲 title）；contents/end 可缺省 */
  title?: string
  /** content 页的要点提示（填空阶段展开成条目） */
  points?: string[]
  /** content 页可选的条目关系（总分／并列／递进／循环／一句话·选版式用·填空阶段带进 draft） */
  relation?: LayoutRelation
}

export type DeckOutline = {
  title: string
  pages: OutlinePage[]
  /**
   * 全简报事实表（跨页一致·各页并行填空时都拿同一份）：会用到的数字、年份、名称、状态先在大纲阶段一次定死，
   * 同一件事只准一个说法——治「p2 体重 75–160kg、p4 80–120kg」这类各页各编（沿用旧管线 7ef4a5ec 的做法·纯内容字串）。
   * 可缺省（旧大纲／用户改过的大纲没有这栏照常成片）。
   */
  facts?: string[]
}

/* ------------------------------------------------------------------ */
/* 文本净化（字符串层：剥 HTML/控制字符·截长）                  */
/* ------------------------------------------------------------------ */

const TAG_RE = /<\/?[a-zA-Z][^>]*>/g
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** 字符串净化：剥 HTML 标签/控制字符 → 压缩连续空白（保留换行）→ 截长 */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const stripped = v
    .replace(TAG_RE, '')
    .replace(CONTROL_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return stripped.length > max ? stripped.slice(0, max) : stripped
}

/* ------------------------------------------------------------------ */
/* 大纲净化（白名单重建）                                                */
/* ------------------------------------------------------------------ */

const PAGE_TYPES: readonly PageType[] = ['cover', 'contents', 'transition', 'content', 'end']

export const OUTLINE_LIMITS = {
  title: 60,
  pageTitle: 60,
  point: 80,
  maxPoints: 8,
  maxPages: 40,
  /** 事实表：最多 15 条·每条 ≤200 字（与旧管线 planFacts 同口径） */
  maxFacts: 15,
  fact: 200,
} as const

/**
 * 大纲白名单净化：非法返 null。
 * 只抄 type/title/points 三个键——AI 塞的任何别的字段（样式/颜色/layout 等）全丢。
 * 必须至少含 1 页 content 才算有效大纲。
 *
 * 🔴 结构封版：deck 结构 = 首页 cover·第二页 contents·
 * 末页 end（outlineSystem prompt 的【必须】·S2 三明治主题也按此结构分深浅底）。
 * outline 可能来自调用方/前端直传（generate route 直收用户改过的大纲），不能只靠
 * prompt 守约——这里**机械规整**而非拒收：
 *   - cover / contents / end 各取传入的第一个（缺 = 合成空骨架页·填空阶段的
 *     确定性兜底 fallbackDraft 会补内容），乱序/重复的多余份丢弃；
 *   - 中间只保留 transition / content 原序。
 * 规整对已合规大纲是恒等映射（幂等）——outline API 产物二次过闸零变化。
 */
export function sanitizeOutline(raw: unknown): DeckOutline | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { title?: unknown; pages?: unknown }
  const title = cleanText(o.title, OUTLINE_LIMITS.title)
  if (!title) return null
  if (!Array.isArray(o.pages) || o.pages.length === 0) return null

  const pages: OutlinePage[] = []
  for (const p of o.pages.slice(0, OUTLINE_LIMITS.maxPages)) {
    if (!p || typeof p !== 'object') continue
    const t = (p as { type?: unknown }).type
    if (typeof t !== 'string' || !PAGE_TYPES.includes(t as PageType)) continue
    const page: OutlinePage = { type: t as PageType }
    const pt = cleanText((p as { title?: unknown }).title, OUTLINE_LIMITS.pageTitle)
    if (pt) page.title = pt
    const rawPoints = (p as { points?: unknown }).points
    if (Array.isArray(rawPoints)) {
      const points = rawPoints
        .map((x) => cleanText(x, OUTLINE_LIMITS.point))
        .filter(Boolean)
        .slice(0, OUTLINE_LIMITS.maxPoints)
      if (points.length > 0) page.points = points
    }
    // 关系只收 content 页·只收认得的值（别的一律丢·与其余白名单同口径）
    const rel = (p as { relation?: unknown }).relation
    if (page.type === 'content' && isLayoutRelation(rel)) page.relation = rel
    pages.push(page)
  }

  // —— 结构规整——
  // 三个结构页占 3 席·中间页按上限截断（合成结构页后总数恒 ≤ maxPages）
  const middle = pages
    .filter((p) => p.type === 'transition' || p.type === 'content')
    .slice(0, OUTLINE_LIMITS.maxPages - 3)
  if (!middle.some((p) => p.type === 'content')) return null // 0 页 content = 无效大纲（原契约不变）
  const cover: OutlinePage = pages.find((p) => p.type === 'cover') ?? { type: 'cover' }
  const contents: OutlinePage = pages.find((p) => p.type === 'contents') ?? { type: 'contents' }
  const end: OutlinePage = pages.find((p) => p.type === 'end') ?? { type: 'end' }
  const structured = [cover, contents, ...middle, end]
  // 事实表：只收字串·同一闸净化·空的不落（没有这栏＝旧口径恒等映射）
  const rawFacts = (o as { facts?: unknown }).facts
  const facts = Array.isArray(rawFacts)
    ? rawFacts.map((x) => cleanText(x, OUTLINE_LIMITS.fact)).filter(Boolean).slice(0, OUTLINE_LIMITS.maxFacts)
    : []
  return facts.length > 0 ? { title, pages: structured, facts } : { title, pages: structured }
}

/* ------------------------------------------------------------------ */
/* 逐页填空净化（白名单重建 PageDraft）                                   */
/* ------------------------------------------------------------------ */

export const DRAFT_LIMITS = {
  title: 60,
  subtitle: 80,
  lead: 120,
  contentsItem: 40,
  maxContentsItems: 12,
  heading: 24,
  body: 160,
  maxContentItems: 8,
} as const

/**
 * 单页填空结果白名单净化：按期望页型重建 PageDraft·非法返 null。
 * 只抄该页型允许的键——最后一道闸（样式/坐标/HTML 到不了 PageDraft）。
 */
export function sanitizePageDraft(raw: unknown, expected: PageType): PageDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // type 字段允许缺省/写错——以调用方期望页型为准（结构封版后页型定死·AI 改不动）
  switch (expected) {
    case 'cover': {
      const title = cleanText(r.title, DRAFT_LIMITS.title)
      if (!title) return null
      const subtitle = cleanText(r.subtitle, DRAFT_LIMITS.subtitle)
      return subtitle ? { type: 'cover', title, subtitle } : { type: 'cover', title }
    }
    case 'contents': {
      if (!Array.isArray(r.items)) return null
      const items = r.items
        .map((x) => cleanText(x, DRAFT_LIMITS.contentsItem))
        .filter(Boolean)
        .slice(0, DRAFT_LIMITS.maxContentsItems)
      if (items.length === 0) return null
      return { type: 'contents', items }
    }
    case 'transition': {
      const title = cleanText(r.title, DRAFT_LIMITS.title)
      if (!title) return null
      const lead = cleanText(r.lead, DRAFT_LIMITS.lead)
      // partNo 不从 AI 拿——composeDeck 按出现序自动编章（引擎契约）
      return lead ? { type: 'transition', title, lead } : { type: 'transition', title }
    }
    case 'content': {
      const title = cleanText(r.title, DRAFT_LIMITS.title)
      if (!title || !Array.isArray(r.items)) return null
      const items: Array<{ heading?: string; body: string }> = []
      for (const it of r.items.slice(0, DRAFT_LIMITS.maxContentItems)) {
        if (!it || typeof it !== 'object') continue
        const body = cleanText((it as Record<string, unknown>).body, DRAFT_LIMITS.body)
        if (!body) continue
        const heading = cleanText((it as Record<string, unknown>).heading, DRAFT_LIMITS.heading)
        items.push(heading ? { heading, body } : { body })
      }
      if (items.length === 0) return null
      // 可选条目关系（认得的值才收）
      return isLayoutRelation(r.relation) ? { type: 'content', title, items, relation: r.relation } : { type: 'content', title, items }
    }
    case 'end': {
      const title = cleanText(r.title, DRAFT_LIMITS.title)
      const subtitle = cleanText(r.subtitle, DRAFT_LIMITS.subtitle)
      const out: PageDraft = { type: 'end' }
      if (title) (out as { title?: string }).title = title
      if (subtitle) (out as { subtitle?: string }).subtitle = subtitle
      return out
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* Prompt（三级约束：必须/建议/严禁）                                     */
/* ------------------------------------------------------------------ */

export type PipelineLang = 'zh-TW' | 'zh-CN'

const FORBIDDEN_CLAUSE_TW =
  '【嚴禁】輸出任何樣式、顏色、字號、座標、版面、HTML、markdown 標記或占位文字（如「待補充」「請提供內容」）——版面完全由系統版式庫決定，你只負責內容。'
const FORBIDDEN_CLAUSE_CN =
  '【严禁】输出任何样式、颜色、字号、坐标、版面、HTML、markdown 标记或占位文字（如「待补充」「请提供内容」）——版面完全由系统版式库决定，你只负责内容。'

export function forbiddenClause(lang: PipelineLang): string {
  return lang === 'zh-CN' ? FORBIDDEN_CLAUSE_CN : FORBIDDEN_CLAUSE_TW
}

function langLine(lang: PipelineLang): string {
  return lang === 'zh-CN'
    ? '【语言】全部内容使用简体中文。'
    : '【語言】全部內容使用繁體中文。'
}

/** 大纲阶段 system prompt */
export function outlineSystem(lang: PipelineLang): string {
  const zh = lang === 'zh-CN'
  return [
    zh
      ? '你是资深简报策略师。根据用户需求产出简报大纲。只回 JSON，不加任何说明文字：'
      : '你是資深簡報策略師。根據使用者需求產出簡報大綱。只回 JSON，不加任何說明文字：',
    `{
  "title": "${zh ? '简报主标题' : '簡報主標題'}",
  "pages": [
    { "type": "cover" },
    { "type": "contents" },
    { "type": "transition", "title": "${zh ? '章标题' : '章標題'}" },
    { "type": "content", "title": "${zh ? '页标题' : '頁標題'}", "points": ["${zh ? '这页要传达的核心讯息（具体·非「介绍XX」）' : '這頁要傳達的核心訊息（具體·非「介紹XX」）'}"] },
    { "type": "end" }
  ],
  "facts": ["${zh ? '全简报共用的事实表：每条一句、数字带单位（如：成年大熊猫体重约 80–125 公斤）' : '全簡報共用的事實表：每條一句、數字帶單位（如：成年大熊貓體重約 80–125 公斤）'}"]
}`,
    zh
      ? `【必须】type 只能是 cover / contents / transition / content / end 五种；第一页 cover、第二页 contents、最后一页 end；content 页通常 4-8 页，每页 points 1-4 条；title ≤ ${OUTLINE_LIMITS.pageTitle} 字；若用户明确说了「N 页」，content 页数必须配合到总页数 = N。`
      : `【必須】type 只能是 cover / contents / transition / content / end 五種；第一頁 cover、第二頁 contents、最後一頁 end；content 頁通常 4-8 頁，每頁 points 1-4 條；title ≤ ${OUTLINE_LIMITS.pageTitle} 字；若使用者明確說了「N 頁」，content 頁數必須配合到總頁數 = N。`,
    // 跨页一致（沿用旧管线 7ef4a5ec 的事实表·各页并行填空、互不相见）
    zh
      ? `【必须·跨页一致】各页是分开填写的：会用到的数字、年份、名称、状态（如保育等级）全部先写进 facts（最多 ${OUTLINE_LIMITS.maxFacts} 条），同一件事只准一个说法；points 里的数字必须与 facts 一字不差。用户已给的数字照抄，不可改写。`
      : `【必須·跨頁一致】各頁是分開填寫的：會用到的數字、年份、名稱、狀態（如保育等級）全部先寫進 facts（最多 ${OUTLINE_LIMITS.maxFacts} 條），同一件事只准一個說法；points 裡的數字必須與 facts 一字不差。使用者已給的數字照抄，不可改寫。`,
    zh
      ? '【建议】内容分 2 章以上时，每章前放一页 transition；points 写具体结论（「XX 比 YY 快 3 倍」而非「介绍 XX」）；content 页可加 "relation" 标出要点之间的关系：total（一句总述带几个分点）/ parallel（并列）/ progressive（递进、阶段、流程）/ loop（循环）/ quote（一句话），看不出来就不写。'
      : '【建議】內容分 2 章以上時，每章前放一頁 transition；points 寫具體結論（「XX 比 YY 快 3 倍」而非「介紹 XX」）；content 頁可加 "relation" 標出要點之間的關係：total（一句總述帶幾個分點）/ parallel（並列）/ progressive（遞進、階段、流程）/ loop（循環）/ quote（一句話），看不出來就不寫。',
    forbiddenClause(lang),
    langLine(lang),
  ].join('\n\n')
}

/** 逐页填空 system prompt（按页型给该型的字段契约） */
export function pageFillSystem(pageType: PageType, lang: PipelineLang): string {
  const zh = lang === 'zh-CN'
  const shapes: Record<PageType, string> = {
    cover: `{ "type": "cover", "title": "${zh ? '主标题' : '主標題'}", "subtitle": "${zh ? '副标语（可选）' : '副標語（可選）'}" }`,
    contents: `{ "type": "contents", "items": ["${zh ? '条目名' : '條目名'}"] }`,
    transition: `{ "type": "transition", "title": "${zh ? '章标题' : '章標題'}", "lead": "${zh ? '导语（可选）' : '導語（可選）'}" }`,
    content: `{ "type": "content", "title": "${zh ? '页标题' : '頁標題'}", "items": [ { "heading": "${zh ? '小标（可选）' : '小標（可選）'}", "body": "${zh ? '正文' : '正文'}" } ] }`,
    end: `{ "type": "end", "title": "${zh ? '致谢标题（可选）' : '致謝標題（可選）'}", "subtitle": "${zh ? '副语（可选）' : '副語（可選）'}" }`,
  }
  const musts: Record<PageType, string> = {
    cover: zh
      ? `【必须】title ≤ 20 字、有力；subtitle ≤ 30 字（场合/日期/受众感）。`
      : `【必須】title ≤ 20 字、有力；subtitle ≤ 30 字（場合/日期/受眾感）。`,
    contents: zh
      ? `【必须】items 与给定章节清单一致，每条 ≤ 16 字（目录条目要短·超长会被截断）。`
      : `【必須】items 與給定章節清單一致，每條 ≤ 16 字（目錄條目要短·超長會被截斷）。`,
    transition: zh
      ? `【必须】title ≤ 20 字；lead ≤ 60 字，一两句说清本章看什么。`
      : `【必須】title ≤ 20 字；lead ≤ 60 字，一兩句說清本章看什麼。`,
    content: zh
      ? `【必须】items 条数 = 给定要点数（无要点时 2-4 条）；heading ≤ 12 字；body 40-60 字完整句子，具体有信息量；title ≤ 20 字。`
      : `【必須】items 條數 = 給定要點數（無要點時 2-4 條）；heading ≤ 12 字；body 40-60 字完整句子，具體有信息量；title ≤ 20 字。`,
    end: zh ? `【必须】不超过一句致谢/行动呼吁。` : `【必須】不超過一句致謝/行動呼籲。`,
  }
  return [
    zh
      ? '你是简报文案师。根据简报主题与本页规格，产出这一页的最终内容。只回一个 JSON 对象，不加任何说明文字：'
      : '你是簡報文案師。根據簡報主題與本頁規格，產出這一頁的最終內容。只回一個 JSON 物件，不加任何說明文字：',
    shapes[pageType],
    musts[pageType],
    zh
      ? '【建议】口吻专业、干练；数字与结论优先；避免空话。'
      : '【建議】口吻專業、幹練；數字與結論優先；避免空話。',
    // 跨页一致（沿用旧管线 7ef4a5ec 单页提示词那条「禁止」）
    zh
      ? '【严禁】与其他页说法矛盾：本页出现的数字、年份、名称、状态必须与【全简报事实表】【全简报大纲】一致；事实表没有的精确数字不要自己编（改用不带数字的说法）。'
      : '【嚴禁】與其他頁說法矛盾：本頁出現的數字、年份、名稱、狀態必須與【全簡報事實表】【全簡報大綱】一致；事實表沒有的精確數字不要自己編（改用不帶數字的說法）。',
    forbiddenClause(lang),
    langLine(lang),
  ].join('\n\n')
}

/** 逐页填空 user prompt（简报语境 + 本页规格） */
export function pageFillUser(opts: {
  outline: DeckOutline
  page: OutlinePage
  pageIndex: number
  userPrompt: string
  lang: PipelineLang
  /** 修-验环时带上一轮 QA 找出的问题 */
  qaFeedback?: string
}): string {
  const zh = opts.lang === 'zh-CN'
  // 各页并行、互不相见 ⇒ 每页都带全简报大纲（各页标题＋要点）＋事实表（跨页一致靠它·沿用旧管线 7ef4a5ec）
  const chapterList = opts.outline.pages
    .filter((p) => p.type === 'transition' || p.type === 'content')
    .map((p, i) => `${i + 1}. [${p.type}] ${p.title ?? ''}${p.points?.length ? `：${p.points.join(' / ')}` : ''}`)
    .join('\n')
  const facts = Array.isArray(opts.outline.facts) ? opts.outline.facts.filter((f) => typeof f === 'string' && f) : []
  const lines = [
    `${zh ? '【简报主标题】' : '【簡報主標題】'}${opts.outline.title}`,
    `${zh ? '【全简报大纲】（各章节/页标题与要点）' : '【全簡報大綱】（各章節/頁標題與要點）'}\n${chapterList}`,
    ...(facts.length
      ? [`${zh ? '【全简报事实表】（各页共用·本页提到就照抄，不可改数字）' : '【全簡報事實表】（各頁共用·本頁提到就照抄，不可改數字）'}\n${facts.map((f) => `- ${f}`).join('\n')}`]
      : []),
    `${zh ? '【本页】' : '【本頁】'}${zh ? '第' : '第'} ${opts.pageIndex + 1} ${zh ? '页' : '頁'}·type=${opts.page.type}${opts.page.title ? `·${zh ? '标题' : '標題'}=${opts.page.title}` : ''}`,
  ]
  if (opts.page.points?.length) {
    lines.push(`${zh ? '【本页要点】' : '【本頁要點】'}\n${opts.page.points.map((p) => `- ${p}`).join('\n')}`)
  }
  if (opts.userPrompt) {
    lines.push(`${zh ? '【用户原始需求摘要】' : '【使用者原始需求摘要】'}${opts.userPrompt.slice(0, 2000)}`)
  }
  if (opts.qaFeedback) {
    lines.push(
      zh
        ? `【上一版的问题·必须修正】\n${opts.qaFeedback}`
        : `【上一版的問題·必須修正】\n${opts.qaFeedback}`,
    )
  }
  return lines.join('\n\n')
}
