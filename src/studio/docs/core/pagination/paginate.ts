// 云文档真分页·分页切割纯函数
//
// 🔴 纯函数：不碰 DOM／不碰 ProseMirror——输入是「量好的切片」（自然坐标·即假设没有任何分页垫片时的排版位置），
//   输出是「在哪些锚点插多高的垫片」。量测与插垫片分别在 pm-paged-view.ts（编辑器）与 dom-paged-view.ts（分享页）。
//
// 坐标约定（px·相对正文容器顶＝第 1 页纸顶）：
//   第 k 页（0 起）纸顶 = k·(pageH + gap)；正文区 = [纸顶 + marginTop, 纸顶 + marginTop + contentH)。
//   gap 画面上＝PAGE_GAP_PX、打印时＝0。垫片高度一律写成「常数 c ＋ g 个 gap」的形式（c/g 两段）——
//   CSS 用 calc(c px + g * var(--pg-gap)) 落地 ⇒ 同一份垫片在画面（gap=24）与打印（gap=0）下都把切片送到同一页的同一位置，
//   这就是「画面第 N 页第几行＝打印第 N 页同一行」的构造性保证（判「放不放得下」也与 gap 无关，见 advance 注释）。

export type SliceAnchor =
  // 段落／标题／代码块内某一行的行首（pos＝该行第一个字的文档位置）⇒ 行内垫片（display:block 的 span）
  | { kind: 'inline'; pos: number }
  // 块级节点之前（pos＝该块在父节点里的位置）⇒ 块级垫片 div；prevBottom＝前一个兄弟块的底（自然坐标）；
  //   marginSum＝插入垫片后「前兄弟下外距 + 本块上外距」不再折叠而各自生效的总和（量测层估或实量）。
  | { kind: 'block'; pos: number; prevBottom: number; marginSum: number }
  | { kind: 'row'; pos: number; cols: number; repeat?: { h: number; headerPos: number; key: string } }

export type Slice = {
  top: number        // 自然坐标·本切片（一行／一块／一表格行）的顶
  bottom: number     // 自然坐标·底
  anchor: SliceAnchor | null   // null＝不可在此切（如全文第一块）
  keepWithNext?: boolean       // 标题：若下一片被推到下一页，本片一起走（不让标题孤零零留在页底）
  breakAfter?: boolean         // 分页符：下一片一律从新页开始（已在页顶则不再推）
}

// 段落这类「整块放得下就不必逐行量」的组：fits 时整组照放；放不下才展开成逐行切片（省量测）。
export type SliceGroup = {
  top: number
  bottom: number
  anchor: SliceAnchor | null   // 整组（＝第一行）的锚
  keepWithNext?: boolean
  breakAfter?: boolean         // 分页符：见 Slice.breakAfter
  expand?: () => Slice[]       // 逐行切片（第一行的 anchor 应＝组 anchor）；没有＝不可拆（图片／分隔线／表格行）
}

export type PageGeometry = {
  pageH: number
  marginTop: number
  contentH: number
}

export type PageBreak = {
  anchor: SliceAnchor
  pageIndex: number   // 切片被送到第几页（0 起）
  heightC: number     // 垫片高度常数段（px）
  heightG: number     // 垫片高度里含几个 gap
  effectC: number     // 本垫片让后续内容整体下移的量（常数段）——量测层下一轮拿它把量得的坐标还原成自然坐标
  effectG: number
  repeatH: number     // 其中重复表头占的高（0＝不重复）：空白垫片高＝heightC − repeatH，其下紧接一份表头复本
}

export type PaginateResult = {
  breaks: PageBreak[]
  pageCount: number
  groupPages: number[]   // 每组的起始页（0 起）——测试／首行对照用
}

// 放不放得下的容差（px）：量测有亚像素误差·差 0.5px 以内算放得下。
export const FIT_EPSILON_PX = 0.5

// 段落跨页的孤行／寡行：PDF 由 Chromium 排·CSS 预设 orphans:2／widows:2——
//   页底至少留 2 行、翻到下一页的至少 2 行，否则整段或多带一行过去。纸张画面照同一规则切，两边断在同一行。
export const PARAGRAPH_ORPHANS = 2
export const PARAGRAPH_WIDOWS = 2

/** 一段 n 行、第 firstMiss 行（0 起）起放不下 ⇒ 按孤行／寡行规则实际从第几行起翻页（0＝整段翻）。 */
export function paragraphBreakLine(n: number, firstMiss: number, orphans = PARAGRAPH_ORPHANS, widows = PARAGRAPH_WIDOWS): number {
  if (firstMiss <= 0 || firstMiss >= n) return Math.max(0, Math.min(firstMiss, n))
  let k = firstMiss
  if (k < orphans) return 0                  // 页底不够 orphans 行 ⇒ 整段翻
  // 下一页不够 widows 行 ⇒ 多带几行过去；但多带之后页底会不够 orphans 行 ⇒ 不带（宁可寡行·Chromium 同：3 行段放得下 2 行时留 2 行）
  if (n - k < widows && n - widows >= orphans) k = n - widows
  return k
}

export function paginate(groups: SliceGroup[], geom: PageGeometry, gap: number): PaginateResult {
  const { pageH, marginTop, contentH } = geom
  const pageTop = (k: number) => k * (pageH + gap) + marginTop           // 第 k 页正文顶（画面坐标）
  const pageBottom = (k: number) => pageTop(k) + contentH                  // 第 k 页正文底
  let page = 0
  let sumC = 0   // 已插垫片的累计下移（常数段）
  let sumG = 0   // 已插垫片的累计 gap 数（恒＝当前页码·见 advance）
  const breaks: PageBreak[] = []
  const groupPages: number[] = []

  const vis = (y: number) => y + sumC + gap * sumG

  // 把切片 s 送到下一页正文顶。effect = pageTop(page+1) − s 当前画面顶，拆成 c/g 两段：
  //   c = (page+1)·pageH + marginTop − (s.top + sumC)，g = (page+1) − sumG ⇒ 推完后 sumG == 新页码，
  //   于是之后任何一次「放得下吗」的比较两边都含同样多的 gap ⇒ 判定与 gap 取值无关（画面＝打印）。
  const advance = (s: { top: number; anchor: SliceAnchor }): void => {
    const next = page + 1
    // 表格行带重复表头：新页正文顶先放表头复本，本行落在复本之下
    const repeatH = s.anchor.kind === 'row' && s.anchor.repeat && s.anchor.repeat.h > 0 ? s.anchor.repeat.h : 0
    let effectC = next * pageH + marginTop - (s.top + sumC) + repeatH
    const effectG = next - sumG
    // 垫片高度：行内／表格行垫片直接等于下移量；块级垫片要扣掉「折叠消失后多出来的外距」。
    let heightC = effectC
    if (s.anchor.kind === 'block') heightC = effectC + (s.top - s.anchor.prevBottom) - s.anchor.marginSum
    // 负高度（前面有超长块溢出到下一页之后）无法实现 ⇒ 夹 0（下移量同步按夹后算）。
    const minH = heightC + effectG * gap
    if (minH < 0) { effectC -= minH; heightC -= minH }
    breaks.push({ anchor: s.anchor, pageIndex: next, heightC, heightG: effectG, effectC, effectG, repeatH })
    sumC += effectC
    sumG += effectG
    page = next
  }

  const fits = (bottom: number) => vis(bottom) <= pageBottom(page) + FIT_EPSILON_PX
  const atPageTop = (top: number) => vis(top) <= pageTop(page) + FIT_EPSILON_PX

  // 本页上连续几片「随下一片走」（标题→表头→…）：后面那片要翻页时，整串从最前一片一起走（不留孤标题/孤表头）
  let kwnRun: { top: number; anchor: SliceAnchor | null; gi: number }[] = []
  let pendingBreak = false   // 上一片是分页符
  const place = (s: Slice, gi: number, force = false): void => {
    let advanced = false
    if (pendingBreak && s.anchor) {
      // 分页符后的第一片：不在页顶就翻（不管放不放得下）
      if (!atPageTop(s.top)) { advance({ top: s.top, anchor: s.anchor }); advanced = true }
      pendingBreak = false
    } else if (s.anchor && !atPageTop(s.top)) {
      if (force || !fits(s.bottom)) {
        const head = kwnRun[0]
        if (head && head.anchor && !atPageTop(head.top)) {
          advance({ top: head.top, anchor: head.anchor })
          for (const k of kwnRun) if (groupPages[k.gi] !== undefined) groupPages[k.gi] = page   // 回头改：整串都到了新页
        } else advance({ top: s.top, anchor: s.anchor })
        advanced = true
      }
    }
    if (advanced) kwnRun = []
    if (s.keepWithNext) kwnRun.push({ top: s.top, anchor: s.anchor, gi })
    else kwnRun = []
    if (s.breakAfter) { pendingBreak = true; kwnRun = [] }
  }

  // 逐行展开缓存（一组最多展开一次）
  const expanded = new Map<number, Slice[]>()
  const linesOf = (i: number): Slice[] => {
    let l = expanded.get(i)
    if (!l) { l = groups[i].expand!(); expanded.set(i, l) }
    return l
  }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    if (!g.expand || (!pendingBreak && fits(g.bottom))) {
      place({ top: g.top, bottom: g.bottom, anchor: g.anchor, keepWithNext: g.keepWithNext, breakAfter: g.breakAfter }, i)
      groupPages.push(page)
      continue
    }
    const lines = linesOf(i)
    if (lines.length === 0) {
      place({ top: g.top, bottom: g.bottom, anchor: g.anchor, keepWithNext: g.keepWithNext, breakAfter: g.breakAfter }, i)
      groupPages.push(page)
      continue
    }
    // 孤行／寡行：先找本页第一条放不下的行（本段在当前页起头时才管·段已在页顶则照逐行切），按规则挪到实际翻页行
    let forceAt = -1
    if (!pendingBreak) {
      let miss = -1
      for (let j = 0; j < lines.length; j++) { if (!fits(lines[j].bottom)) { miss = j; break } }
      if (miss > 0) {
        const k = paragraphBreakLine(lines.length, miss)
        if (k !== miss && !atPageTop(lines[k].top) && (k === 0 ? (lines[0].anchor ?? g.anchor) : lines[k].anchor)) forceAt = k
      }
    }
    let first = -1
    for (let j = 0; j < lines.length; j++) {
      const s = j === 0 ? { ...lines[j], anchor: lines[j].anchor ?? g.anchor, keepWithNext: g.keepWithNext && lines.length === 1 } : lines[j]
      place(s, i, j === forceAt)
      if (j === 0) first = page
    }
    groupPages.push(first)
  }
  // 页数：最后一片的底（画面坐标）落在哪一页的纸内（超长块溢出会多占页）
  let pageCount = page + 1
  if (groups.length > 0) {
    const lastBottom = vis(groups[groups.length - 1].bottom)
    let k = page
    while (lastBottom > k * (pageH + gap) + pageH + FIT_EPSILON_PX) k++
    pageCount = k + 1
  }
  return { breaks, pageCount, groupPages }
}

// 断点签名（判「这轮算出来的跟上轮一样吗」·一样就不派发事务·防抖动死循环）。取整到 0.5px。
export function breaksSignature(breaks: PageBreak[]): string {
  const r = (n: number) => Math.round(n * 2) / 2
  return breaks.map(b => `${b.anchor.kind}@${b.anchor.pos}:${r(b.heightC)}+${b.heightG}g${b.repeatH > 0 && b.anchor.kind === 'row' && b.anchor.repeat ? `^${r(b.repeatH)}:${b.anchor.repeat.headerPos}:${b.anchor.repeat.key}` : ''}`).join('|')
}

// 重排节奏（单一真相源·编辑器与分享页共用）：打字停 debounceMs 后重排；连续打字最长 maxWaitMs 必排一次；
//   派发新断点后再补量 settleRuns 次让块级垫片的外距估值收敛（签名不变即停）。
export const PAGINATION_TUNING = { debounceMs: 150, maxWaitMs: 800, settleRuns: 4 } as const
