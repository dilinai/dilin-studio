'use client'

// ── 简报手动编辑一期 · 文字格面板──
//   选中页 → 按该页 draft.type 列出文字格（标题/副语/导语/条目…）·失焦保存 →
//   父层 PATCH /api/aislides/v2/deck → 服务端重渲 → 中栏 iframe 刷新。
//   本组件只管「当前页」的编辑缓冲：父层用 key=`${pageIndex}:${resetKey}` 控制重挂
//     （翻页/外部刷新/冲突重载时重挂取库真值；同页 edit_slots 成功不重挂=不打断输入）。
//   旧 HTML 简报（deck=null）没有结构 → 只显提示（文字修改找右侧角色）。

import { editorShell } from '../../shared/theme/editor-shell-theme'  // 壳层共用 token（中栏底部文字格面板跟着整页转浅）
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudioT as useT } from '../../shared/StudioT'
// 客户端只 import 纯函数层（服务端那一侧带着 react-dom/server·见 deck-edit 文件头注）
import { contentRowKept, createCommitGate, manualContentItemCap, manualContentsItemCap, manualDeckPageCap, type DeckDataV2, type SlotEditInput } from '../deck-edit'

export type DeckSlotPanelProps = {
  /** null = 旧格式简报（无结构·不出格子） */
  deck: DeckDataV2 | null
  /** version:2 在场但结构破损——只显資料異常提示·一切编辑不开 */
  broken?: boolean
  pageIndex: number
  /** PATCH 在飞（结构按钮禁用·文字格照常可打字） */
  busy: boolean
  /** 返回保存成败：false/reject=失败 → 面板恢复脏标·再次失焦可原值重试。
   *  第三参=本页稳定身份 pid（deck.pages[pageIndex].pid·可缺）：父层塞进
   *  op.pageId → 服务端按 pid 找页——排队/延迟重发的笔在 index 位移后不再写错页。 */
  onEditSlots: (pageIndex: number, slots: SlotEditInput, pageId?: string) => Promise<boolean> | boolean | void
  onAddPage: (afterIndex: number, pageType: 'content' | 'transition', afterPageId?: string) => void
  onDeletePage: (pageIndex: number, pageId?: string) => void
}

/** src=该行对应库里**当前**条目序（图槽 itemFigure:N 随行走）·新加行=null。
 *  key=行的稳定客户端标识（保存成功后按 key 重算各行 src·与序号解耦）。 */
type ItemRow = { key: number; heading: string; body: string; src: number | null }

const inputCls = `w-full ${editorShell.softSurface} border ${editorShell.divider} rounded-lg px-2.5 py-1.5 text-[13px] text-gray-100 outline-none focus:border-blue-500/70 select-text placeholder:text-gray-600`
const labelCls = 'text-[11px] text-gray-500 mb-1'

export default function DeckSlotPanel(props: DeckSlotPanelProps) {
  const { deck, broken, pageIndex, busy, onEditSlots, onAddPage, onDeletePage } = props
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)

  const page = deck?.pages[pageIndex] ?? null
  const draft = page?.draft ?? null
  /** 本页稳定身份（父层 key=pid → 面板存续期恒同一逻辑页·渲染现读恒新鲜） */
  const pagePid = page && typeof page.pid === 'string' && page.pid ? page.pid : undefined

  // 编辑缓冲（初值来自库真值·父层 key 控制重挂时机）
  const [title, setTitle] = useState(() => (draft && 'title' in draft && typeof draft.title === 'string' ? draft.title : ''))
  const [subtitle, setSubtitle] = useState(() => (draft && 'subtitle' in draft && typeof draft.subtitle === 'string' ? draft.subtitle : ''))
  const [lead, setLead] = useState(() => (draft && draft.type === 'transition' && draft.lead ? draft.lead : ''))
  const [contentsItems, setContentsItems] = useState<string[]>(() => (draft?.type === 'contents' ? [...draft.items] : []))
  const [contentItems, setContentItems] = useState<ItemRow[]>(() =>
    draft?.type === 'content' ? draft.items.map((it, i) => ({ key: i, heading: it.heading ?? '', body: it.body, src: i })) : [])
  /** 新加行的稳定 key 发号器（初值=库条目数·与初始行 key 不撞） */
  const keySeqRef = useRef(draft?.type === 'content' ? draft.items.length : 0)
  /** 缓冲镜像 ref：send/延迟重发永远读**此刻**真值（陈闭包类竞态一律走这）。
   *  每次渲染同步刷新；commitWith 还会先行合并（setState 未 flush 前 send 也读得到删行后数组）。 */
  const stateRef = useRef({ title, subtitle, lead, contentsItems, contentItems })
  stateRef.current = { title, subtitle, lead, contentsItems, contentItems }
  /** 面板级提交闸（脏标/在飞/pending 状态机·纯函数层有单测）：
   *  在飞时后续 commit 只标 pending·前一笔**成功**才按最新缓冲重发（src 已 resync·
   *    itemMap 恒基于最新条目序）——父层队列只保序·救不了「构造那刻序号已过期」。
   *  🔴 前一笔**失败**（尤其 409）不自动重发：父层已 cancelPending+落最新行+
   *    重挂面板，旧实例这笔延迟重发会拿刷新后的新 revision 提交陈旧缓冲=静默盖回他窗内容。
   *    失败只保 dirty——存活实例下一次失焦按当前缓冲原值重试（v3  行为不变）。
   *  卸载/重挂即 dispose：旧实例的一切延迟重发作废。
   *  exec 经 execRef 每轮渲染刷新（buildSlots/draft 恒新鲜）；gate 实例一次性（挂载期恒同）。 */
  const execRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
  const gateRef = useRef<ReturnType<typeof createCommitGate> | null>(null)
  if (!gateRef.current) gateRef.current = createCommitGate(() => execRef.current())
  // 闸生命周期跟 effect 走（setup 复活/cleanup 拆）：React StrictMode dev 态
  // 首挂 setup→cleanup→setup——旧口径 cleanup dispose 后没人重建 ⇒ Next15/React19 开发模式
  // 首挂后所有 commit() 被永久拒（文字格保存全聋）。resume 只复活**本实例**的闸；真卸载/
  // key 重挂后无 setup 跟随 ⇒ 恒 disposed·旧实例延迟重发作废语义不变（生命周期层有单测）。
  useEffect(() => {
    const gate = gateRef.current
    gate?.resume()
    return () => { gate?.dispose() }
  }, [])

  const itemCap = useMemo(() => manualContentItemCap(), [])
  const contentsCap = useMemo(() => manualContentsItemCap(), [])

  if (broken) {
    // version:2 在场但结构破损：不是旧 HTML（不许落降级写路）·明说資料異常
    return (
      <div className={`border-t ${editorShell.divider} px-4 py-2.5 text-[12px] text-amber-600 shrink-0`}>
        {t('asld_deck_broken_hint')}
      </div>
    )
  }

  if (!deck || !page || !draft) {
    // 旧 HTML 简报：没结构·不做格子编辑（DoD5）
    return (
      <div className={`border-t ${editorShell.divider} px-4 py-2.5 text-[12px] ${editorShell.hintText} shrink-0`}>
        {t('asld_legacy_deck_hint')}
      </div>
    )
  }

  // 槽值一律从**显式传入的当前值**建（不是 setState 后的陈闭包）：
  //   删除条目按钮走 commitWith(下一份数组)——旧写法 mutate() 排队 setState 后
  //   queueMicrotask(commit)，commit 闭包里的 contentsItems/contentItems 还是删除前
  //   的旧数组 → 单独点 ✕ 只改 UI 不改库。
  const buildSlots = (): SlotEditInput => {
    // 恒读 stateRef（渲染同步镜像+commitWith 先行合并）——send 可能发生在
    // 「上一笔落定后的延迟重发」，闭包里的 state 早已过期。
    const st = stateRef.current
    const slots: SlotEditInput = {}
    switch (draft.type) {
      case 'cover':
        slots.title = st.title; slots.subtitle = st.subtitle; break
      case 'contents':
        slots.items = st.contentsItems; break
      case 'transition':
        slots.title = st.title; slots.lead = st.lead; break
      case 'content':
        // itemMap[新行序]=当前条目序（null=新加行）：itemFigure:N 图槽按条目
        // 序号绑定·删行后服务端按 map 重排图槽（不送=条目数变了时服务端宁摘不错配）
        slots.title = st.title
        slots.items = st.contentItems.map(({ heading, body }) => ({ heading, body }))
        slots.itemMap = st.contentItems.map((r) => r.src)
        break
      case 'end':
        slots.title = st.title; slots.subtitle = st.subtitle; break
    }
    return slots
  }
  /** 保存成功后按提交快照重算各行 src：服务端丢全空行+按 itemMap 重排图槽后，
   *  库里条目序=「快照中被保留行的保留序」。判据 contentRowKept 与服务端 applySlotEdit 逐字
   *  同口径（cleanText 双空=丢）——面板自己 trim 判会口径漂移。快照外的行（在飞期间新加）
   *  保持 src 原值（null=新行）。同步改 stateRef：下一笔 send 读到的已是新序。 */
  const resyncSrcs = (snapshot: ItemRow[]) => {
    const newSrc = new Map<number, number | null>()
    let seq = 0
    for (const r of snapshot) newSrc.set(r.key, contentRowKept(r.heading, r.body) ? seq++ : null)
    const apply = (rows: ItemRow[]) => rows.map((r) => (newSrc.has(r.key) ? { ...r, src: newSrc.get(r.key)! } : r))
    stateRef.current = { ...stateRef.current, contentItems: apply(stateRef.current.contentItems) }
    setContentItems(apply)
  }
  // 保存失败要能「原值重试」：闸内脏标乐观清（成功路径不打扰后续输入），
  //   保存方回报失败（false/reject/取消）→ 闸恢复脏标——存活面板下次失焦按当前缓冲原值重发，
  //   不用先改一个字才能再存。（409 冲突路径父层会重挂面板取最新真值·旧实例不再自动重发。）
  //   exec 每轮渲染刷新：快照/槽值恒读此刻真值（陈闭包类竞态一律走 stateRef）。
  execRef.current = () => {
    const snapshot = draft.type === 'content' ? stateRef.current.contentItems : null
    // 恒带 pagePid：延迟重发（pending）那刻 index 可能已位移·服务端按 pid 找页
    return Promise.resolve(onEditSlots(pageIndex, buildSlots(), pagePid)).then((ok) => {
      if (ok === false) return false
      if (snapshot) resyncSrcs(snapshot)
      return true
    })
  }
  const commit = () => { gateRef.current?.commit() }
  const markDirty = () => { gateRef.current?.markDirty() }
  /** 结构性小改（删条目）：同步算出下一份数组 → setState（调用方已做）+ 先行合并进 stateRef
   *  → 立即提交（在飞则转 pending·前笔成功落定后按最新缓冲重发）——陈闭包类
   *  竞态的解法从「显式传数组」升级为「镜像 ref 先行合并」，同样不吃 setState 异步亏。 */
  const commitWith = (over: { contentsItems?: string[]; contentItems?: ItemRow[] }) => {
    stateRef.current = { ...stateRef.current, ...over }
    gateRef.current?.markDirty()
    gateRef.current?.commit()
  }

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const typeLabel: Record<string, string> = {
    cover: t('asld_ptype_cover'), contents: t('asld_ptype_contents'), transition: t('asld_ptype_transition'),
    content: t('asld_ptype_content'), end: t('asld_ptype_end'),
  }

  return (
    <div className={`border-t ${editorShell.divider} shrink-0 ${editorShell.softSurface}`}>
      {/* 头行：面板名 + 页型 + 折叠 */}
      <div className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none" onClick={() => setCollapsed(c => !c)}>
        <span className="text-[11px] font-medium text-gray-300">{t('asld_panel_title')}</span>
        <span className="text-[10px] text-gray-600">{typeLabel[draft.type] ?? draft.type}</span>
        <span className="ml-auto text-[10px] text-gray-600">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 max-h-64 overflow-y-auto space-y-2.5">
          {/* 这页有手动排版层（工具栏改过格式/插过图）：文字格是结构真源·改它会退回版式渲染 */}
          {typeof page.htmlOverride === 'string' && page.htmlOverride && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5" data-testid="deck-page-override-hint">
              {t('asld_page_override_hint')}
            </div>
          )}
          {/* 标题格（cover/transition/content/end 有；contents 无） */}
          {draft.type !== 'contents' && (
            <div>
              <div className={labelCls}>{t('asld_slot_title')}</div>
              <input
                className={inputCls}
                value={title}
                placeholder={draft.type === 'cover' ? t('asld_cover_title_ph') : t('asld_slot_empty_ph')}
                onChange={e => { setTitle(e.target.value); markDirty() }}
                onBlur={commit}
                onKeyDown={blurOnEnter}
              />
            </div>
          )}

          {/* 副语格（cover/end） */}
          {(draft.type === 'cover' || draft.type === 'end') && (
            <div>
              <div className={labelCls}>{t('asld_slot_subtitle')}</div>
              <input className={inputCls} value={subtitle} placeholder={t('asld_slot_empty_ph')}
                onChange={e => { setSubtitle(e.target.value); markDirty() }} onBlur={commit} onKeyDown={blurOnEnter} />
            </div>
          )}

          {/* 导语格（transition） */}
          {draft.type === 'transition' && (
            <div>
              <div className={labelCls}>{t('asld_slot_lead')}</div>
              <input className={inputCls} value={lead} placeholder={t('asld_slot_empty_ph')}
                onChange={e => { setLead(e.target.value); markDirty() }} onBlur={commit} onKeyDown={blurOnEnter} />
            </div>
          )}

          {/* 目录条目（contents·加删页会按章节自动重建） */}
          {draft.type === 'contents' && (
            <div>
              <div className={labelCls}>{t('asld_slot_items')} <span className="text-gray-700">· {t('asld_slot_contents_hint')}</span></div>
              <div className="space-y-1.5">
                {contentsItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input className={inputCls} value={it} placeholder={t('asld_slot_empty_ph')}
                      onChange={e => { setContentsItems(arr => arr.map((x, j) => j === i ? e.target.value : x)); markDirty() }}
                      onBlur={commit} onKeyDown={blurOnEnter} />
                    <button
                      onClick={() => { const next = contentsItems.filter((_, j) => j !== i); setContentsItems(next); commitWith({ contentsItems: next }) }}
                      className="shrink-0 text-[11px] px-1.5 py-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title={t('asld_remove_item')}>✕</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setContentsItems(arr => [...arr, ''])}
                disabled={contentsItems.length >= contentsCap}
                className={`mt-1.5 rounded-lg ${editorShell.toolbarTextBtn} disabled:opacity-30`}>
                {t('asld_add_item')}{contentsItems.length >= contentsCap ? `（≤${contentsCap}）` : ''}
              </button>
            </div>
          )}

          {/* 条目格（content：小标+正文） */}
          {draft.type === 'content' && (
            <div>
              <div className={labelCls}>{t('asld_slot_items')}</div>
              <div className="space-y-2">
                {contentItems.map((it, i) => (
                  <div key={it.key} className={`rounded-lg border ${editorShell.divider} ${editorShell.centerCol} p-2 space-y-1.5`}>
                    <div className="flex items-center gap-1.5">
                      <input className={inputCls} value={it.heading} placeholder={t('asld_slot_item_heading')}
                        onChange={e => { setContentItems(arr => arr.map((x, j) => j === i ? { ...x, heading: e.target.value } : x)); markDirty() }}
                        onBlur={commit} onKeyDown={blurOnEnter} />
                      <button
                        onClick={() => { const next = contentItems.filter((_, j) => j !== i); setContentItems(next); commitWith({ contentItems: next }) }}
                        className="shrink-0 text-[11px] px-1.5 py-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title={t('asld_remove_item')}>✕</button>
                    </div>
                    <textarea className={`${inputCls} resize-none`} rows={2} value={it.body} placeholder={t('asld_slot_item_body')}
                      onChange={e => { setContentItems(arr => arr.map((x, j) => j === i ? { ...x, body: e.target.value } : x)); markDirty() }}
                      onBlur={commit} />
                  </div>
                ))}
              </div>
              <button onClick={() => setContentItems(arr => [...arr, { key: keySeqRef.current++, heading: '', body: '', src: null }])}
                disabled={contentItems.length >= itemCap}
                className={`mt-1.5 rounded-lg ${editorShell.toolbarTextBtn} disabled:opacity-30`}>
                {t('asld_add_item')}{contentItems.length >= itemCap ? `（≤${itemCap}）` : ''}
              </button>
            </div>
          )}

          {/* 结构操作：加页（选页型）/ 删本页。达总页上限（与生成端同源
              manualDeckPageCap=40）加页禁用+上限后缀——与条目上限同款体感·服务端 deck_full
              同口径兜底（面板绕不过） */}
          <div className={`flex items-center gap-1.5 pt-1 border-t ${editorShell.divider}`}>
            <button onClick={() => onAddPage(pageIndex, 'content', pagePid)} disabled={busy || deck.pages.length >= manualDeckPageCap()}
              className={`rounded-lg ${editorShell.toolbarTextBtn} disabled:opacity-30`}>
              {t('asld_add_content_page')}{deck.pages.length >= manualDeckPageCap() ? `（≤${manualDeckPageCap()}）` : ''}
            </button>
            <button onClick={() => onAddPage(pageIndex, 'transition', pagePid)} disabled={busy || deck.pages.length >= manualDeckPageCap()}
              className={`rounded-lg ${editorShell.toolbarTextBtn} disabled:opacity-30`}>
              {t('asld_add_transition_page')}{deck.pages.length >= manualDeckPageCap() ? `（≤${manualDeckPageCap()}）` : ''}
            </button>
            <button onClick={() => onDeletePage(pageIndex, pagePid)} disabled={busy || deck.pages.length <= 1}
              className="ml-auto text-[11px] px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30 text-red-400 transition-colors">
              {t('asld_delete_this_page')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
