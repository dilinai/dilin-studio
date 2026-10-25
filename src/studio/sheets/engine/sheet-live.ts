// ── 表格编辑页「别人（角色）每写一格就跟着出现」——纯逻辑 ──
//   页面每 SHEET_LIVE_POLL_MS 问一次整档各页签（宿主的 listSheets）·
//   哪张页签的 updated_at 比本页记着的新 ⇒ 把库里那版合进画面——每次写格都是一次独立写入 ⇒ 一格一格看着出来；罩着时问得更勤（1.5 秒）。
//   合并口径：本页没存的格留着（下一发存档带新版次写回＝「以后写的为准」）·其余照库里的；没有稿 ⇒ 整张换成库里的。
//   ⛔ 不动：本页写在飞（inflight>0）那一拍不判（戳会在回包里更新）；戳是本页自己写回的（ownStamps）或比已知的旧（慢回包）⇒ 只记戳不换内容。
//   页签被删 ⇒ 交给 reloadDoc（它会把那张的稿并成孤立稿进「套回」条·⛔ 这里默默丢）；新增／改名／换序 ⇒ 页签清单跟着换。
//   ⛔ 本档不 import React／fetch：真接线在 ../page/SheetPage.tsx（轮询节拍与推送订阅由宿主的 startLive 管）。
import { mergeSheetDraft, type SheetLike } from './draft-merge'

export const SHEET_LIVE_POLL_MS = 3000
export const SHEET_LIVE_POLL_SHIELDED_MS = 1500
/** 推送订上这一行 ⇒ 有变才拉；轮询只当保险、放宽到 30 秒（罩着也一样）。 */
export const SHEET_LIVE_FALLBACK_MS = 30000
export const SHEET_LIVE_TABLE = 'aisheets'
/** 下一拍隔多久：推送在线 ⇒ 30 秒保险；不在线（没有推送／断线）⇒ 罩着 1.5 秒、平常 3 秒。 */
export function sheetLivePollMs(shielded: boolean, live = false): number { return live ? SHEET_LIVE_FALLBACK_MS : shielded ? SHEET_LIVE_POLL_SHIELDED_MS : SHEET_LIVE_POLL_MS }

export type SheetLiveServerRow = { id: string; name: string; position: number; content?: unknown; updated_at?: string | null }
export type SheetLiveTab = { id: string; name: string; position: number }
export type SheetLivePlan<C extends SheetLike> = {
  /** 内容要换的页签（contents／base／stamps 里都有它） */
  changed: string[]
  /** 只记戳不换内容的（本页自己写回的那一版） */
  stampOnly: string[]
  contents: Record<string, C>
  /** 合进去之后仍没存的稿（给 unsavedRef） */
  unsaved: Record<string, C>
  base: Record<string, C>
  stamps: Record<string, string>
  /** 页签新增／改名／换序 ⇒ 清单要换 */
  tabsChanged: boolean
  /** 有页签被删 ⇒ 调用方走 reloadDoc（孤立稿进「套回」条） */
  reloadNeeded: boolean
}

const ms = (s: unknown): number | null => { if (typeof s !== 'string') return null; const n = Date.parse(s); return Number.isFinite(n) ? n : null }
const contentOf = <C extends SheetLike>(row: SheetLiveServerRow, empty: C): C => (row.content && typeof row.content === 'object' ? row.content : empty) as C

/** 一拍回来后算要怎么改画面；null＝什么都不动。 */
export function sheetLiveDiff<C extends SheetLike>(i: {
  server: SheetLiveServerRow[]
  /** 本页记着的每张页签库里那一版（serverStampRef） */
  stamps: Record<string, string | undefined>
  /** 最后一次确认在库的内容（serverBaseRef） */
  base: Record<string, C>
  /** 没存的稿（unsavedRef） */
  unsaved: Record<string, C>
  /** 屏上页签清单（sheetsRef） */
  tabs: SheetLiveTab[]
  /** 本页写回成功时收到的戳（自己写的不算别人改） */
  ownStamps: Set<string>
  /** 本页写在飞的数 */
  inflight: number
  empty: C
}): SheetLivePlan<C> | null {
  if (i.inflight > 0) return null
  const plan: SheetLivePlan<C> = { changed: [], stampOnly: [], contents: {}, unsaved: {}, base: {}, stamps: {}, tabsChanged: false, reloadNeeded: false }
  const serverIds = new Set(i.server.map(s => s.id))
  if (i.tabs.some(t => !serverIds.has(t.id))) plan.reloadNeeded = true
  const tabKey = (xs: SheetLiveTab[]) => xs.map(x => `${x.id}\u0000${x.name}\u0000${x.position}`).join('\n')
  if (tabKey(i.server) !== tabKey(i.tabs)) plan.tabsChanged = true
  for (const s of i.server) {
    const stamp = typeof s.updated_at === 'string' ? s.updated_at : null
    const known = i.stamps[s.id]
    if (known !== undefined && stamp !== null && stamp === known) continue
    if (stamp !== null && i.ownStamps.has(stamp)) { plan.stampOnly.push(s.id); plan.stamps[s.id] = stamp; continue }
    const a = ms(stamp), b = ms(known)
    if (known !== undefined && a !== null && b !== null && a < b) continue   // 慢回包：库里那版比本页知道的还旧 ⇒ 不倒退
    if (known !== undefined && stamp === null) continue
    const c = contentOf(s, i.empty)
    const draft = i.unsaved[s.id]
    if (draft) {
      const merged = mergeSheetDraft(i.base[s.id] ?? i.empty, draft, c)
      plan.contents[s.id] = merged
      plan.unsaved[s.id] = merged
    } else {
      plan.contents[s.id] = c
    }
    plan.base[s.id] = c
    if (stamp !== null) plan.stamps[s.id] = stamp
    plan.changed.push(s.id)
  }
  if (!plan.changed.length && !plan.stampOnly.length && !plan.tabsChanged && !plan.reloadNeeded) return null
  return plan
}

/** 这一拍别人改了哪张 ⇒ 画面切过去（别人改的是另一张时画面要跟过去）。
 *  当前那张也被改了 ⇒ 不切（他已经看得到）；改了好几张 ⇒ 切到戳最新的那张（同戳取页签顺序在前的）；
 *  用户正在打字（格子编辑框／公式列／标题框有焦点）或当前那张还有没存的格 ⇒ 不切（⛔ 抢走他手上的字）。null＝不切。 */
export function sheetLiveFollowTarget(i: { changed: string[]; stamps: Record<string, string>; tabOrder: string[]; current: string | null; busy: boolean }): string | null {
  if (i.busy || !i.changed.length) return null
  if (i.current && i.changed.includes(i.current)) return null
  const order = (id: string) => { const k = i.tabOrder.indexOf(id); return k < 0 ? Number.MAX_SAFE_INTEGER : k }
  const pick = [...i.changed].sort((a, b) => (ms(i.stamps[b]) ?? 0) - (ms(i.stamps[a]) ?? 0) || order(a) - order(b))[0]
  return pick ?? null
}
