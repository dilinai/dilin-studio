// ── 表格「套回」条的状态（AI 编辑保护遮罩）──
//   条里每份没存进库的稿都是一条带 id 的「底＋稿」（改动集）；页签已被删的稿并进同一页签的孤立稿（所有份都留着·另存时一起并）。
//   🔴 一切异步收尾（套回写回、另存孤立稿）只按 id 摘掉**它自己那几份**——⛔ 拿发起时的快照整份 set 回去（期间 reload 新加进来的稿会被抹掉）。
//   ⛔ 本档不 import React／fetch。
import { applySheetDrafts, type SheetLike } from './draft-merge'

export type RestoreEntry<C extends SheetLike> = { id: number; sheetId: string; base: C; draft: C }
export type RestoreOrphan<C extends SheetLike> = { sheetId: string; name: string; start: C; entries: RestoreEntry<C>[] }
/** older＝被较新标题稿顶掉的更早几份（同一栏·以新的为准可套回；旧的只给看·⛔ 默默丢） */
export type RestoreTitle = { id: number; draft: string; seen: string; older?: string[] }
export type SheetRestoreState<C extends SheetLike> = { sheets: RestoreEntry<C>[]; orphans: RestoreOrphan<C>[]; title?: RestoreTitle }

const norm = <C extends SheetLike>(s: SheetRestoreState<C>): SheetRestoreState<C> | null => (s.sheets.length || s.orphans.length || s.title ? s : null)

/** 一份稿并进同页签的孤立稿（没有就新开一份）；start＝那张页签最后已知的库里内容（取最新的）。 */
function toOrphan<C extends SheetLike>(orphans: RestoreOrphan<C>[], e: RestoreEntry<C>, nameOf: (sid: string) => string, startOf: (sid: string) => C): RestoreOrphan<C>[] {
  const i = orphans.findIndex(o => o.sheetId === e.sheetId)
  if (i < 0) return [...orphans, { sheetId: e.sheetId, name: nameOf(e.sheetId), start: startOf(e.sheetId), entries: [e] }]
  return orphans.map((o, j) => (j === i ? { ...o, start: startOf(e.sheetId), entries: [...o.entries, e] } : o))
}

/** 孤立稿另存用的整份内容：从那张页签最后已知的库里内容起，按先后把每一份稿的改动都并上（⛔ 只取最后一份整稿）。 */
export function orphanContent<C extends SheetLike>(o: RestoreOrphan<C>): C {
  return applySheetDrafts(o.start, o.entries)
}

/** 重载时加稿：页签还在的进 sheets；页签已不在的（含条上原有同页签的稿）并进孤立稿；标题稿新的顶掉旧的（同一栏·用户较新的那次）。 */
export function restoreAdd<C extends SheetLike>(prev: SheetRestoreState<C> | null, add: {
  entries: RestoreEntry<C>[]; live: Set<string>; nameOf: (sid: string) => string; startOf: (sid: string) => C; title?: RestoreTitle
}): SheetRestoreState<C> | null {
  const all = [...(prev?.sheets ?? []), ...add.entries]
  let orphans = [...(prev?.orphans ?? [])]
  for (const e of all.filter(x => !add.live.has(x.sheetId))) orphans = toOrphan(orphans, e, add.nameOf, add.startOf)
  const title = add.title && prev?.title ? { ...add.title, older: [...(prev.title.older ?? []), prev.title.draft].filter(t => t !== add.title!.draft) } : (add.title ?? prev?.title)
  return norm({ sheets: all.filter(x => add.live.has(x.sheetId)), orphans, title })
}

/** 「套回」收尾：只摘掉这次写成的那几份（done）；这次发现页签已不在的那几份（gone）转孤立稿；标题只在还是这次那一份时摘。
 *  期间新加进来的稿、没写成的稿原样留着。 */
export function restoreFinishApply<C extends SheetLike>(prev: SheetRestoreState<C> | null, r: {
  done: Set<number>; gone: Set<number>; titleDone?: number; nameOf: (sid: string) => string; startOf: (sid: string) => C
}): SheetRestoreState<C> | null {
  if (!prev) return null
  let orphans = prev.orphans
  for (const e of prev.sheets.filter(x => r.gone.has(x.id))) orphans = toOrphan(orphans, e, r.nameOf, r.startOf)
  const sheets = prev.sheets.filter(x => !r.done.has(x.id) && !r.gone.has(x.id))
  const title = prev.title && r.titleDone !== undefined && prev.title.id === r.titleDone ? undefined : prev.title
  return norm({ sheets, orphans, title })
}

/** 孤立稿另存收尾：只摘掉这次并进新页签的那几份（期间又并进来的同页签稿留着）。 */
export function restoreFinishOrphan<C extends SheetLike>(prev: SheetRestoreState<C> | null, sheetId: string, consumed: Set<number>): SheetRestoreState<C> | null {
  if (!prev) return null
  const orphans = prev.orphans
    .map(o => (o.sheetId !== sheetId ? o : { ...o, entries: o.entries.filter(e => !consumed.has(e.id)) }))
    .filter(o => o.entries.length > 0)
  return norm({ ...prev, orphans })
}
