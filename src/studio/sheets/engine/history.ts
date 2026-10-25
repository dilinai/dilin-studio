// 表格页撤销／重做栈
//
// ── 出处与授权 ──
// 栈的规矩抄自 univer（https://github.com/dream-num/univer ·commit 511bfd2）·Apache License 2.0·Copyright 2023-present DreamNum Co., Ltd.
//   · packages/core/src/services/undoredo/undoredo.service.ts —— LocalUndoRedoService：一个工作簿一对 undo／redo 栈（切 sheet 页签共用）；
//       pushUndoRedo 时清空 redo（分支丢弃）；超过上限 splice(0,1) 丢最老一条；beginUndoRedoGroup 的 replace 模式
//       （同一 groupId 连续入栈 ⇒ 保留最初那步的 undo·只换 redo——拖动这类连续操作算一步）
//   · packages/ui/src/controllers/shared-shortcut.controller.ts —— Ctrl/⌘+Z 撤销·Ctrl/⌘+Y 与 ⌘+Shift+Z 重做（快捷键接线在 SheetGrid.tsx）
// 已修改（Apache-2.0 §4(b) 修改声明）：
//   1. univer 每步存 mutation 清单（undoMutations／redoMutations）；本仓 sheet 内容就是一份 JSON ⇒ 每步存那张 sheet 改动前后两份快照（before／after）；
//   2. 上限 univer 预设 50 ⇒ 本仓要 ≥100 ⇒ HISTORY_LIMIT＝100；
//   3. 加 undoSteps／redoSteps(n)：下拉「最近 20 步」点某一步＝一次撤到那里（univer 没有这个下拉·这段自写）；
//   4. 每步带 label（给下拉显示「輸入 A1」「粗體」…）与 sheetId（撤到别张 sheet 的改动时页面先切过去·Excel 口径）。

export const HISTORY_LIMIT = 100
export const HISTORY_MENU_MAX = 20

/** 下拉里显示的那句：k＝翻译键尾巴（sheet_hist_<k>）·a＝参数（格名等） */
export type HistoryLabel = { k: string; a?: string }
export type HistoryEntry<T> = { id: number; sheetId: string; label: HistoryLabel; before: T; after: T; group?: string }
export type HistoryState<T> = { undo: HistoryEntry<T>[]; redo: HistoryEntry<T>[]; seq: number }

export function emptyHistory<T>(): HistoryState<T> { return { undo: [], redo: [], seq: 0 } }

/**
 * 入栈一步：清空 redo（分支丢弃）；group 与栈顶相同且同一张 sheet ⇒ 并进栈顶（留栈顶的 before·换 after·label 取新的）；
 * 超上限丢最老。返回新状态（不改原物件）。
 */
export function pushHistory<T>(st: HistoryState<T>, e: { sheetId: string; label: HistoryLabel; before: T; after: T; group?: string }, limit = HISTORY_LIMIT): HistoryState<T> {
  const top = st.undo[st.undo.length - 1]
  if (e.group && top && top.group === e.group && top.sheetId === e.sheetId) {
    const merged: HistoryEntry<T> = { ...top, after: e.after, label: e.label }
    return { undo: [...st.undo.slice(0, -1), merged], redo: [], seq: st.seq }
  }
  const seq = st.seq + 1
  const undo = [...st.undo, { id: seq, sheetId: e.sheetId, label: e.label, before: e.before, after: e.after, ...(e.group ? { group: e.group } : {}) }]
  while (undo.length > Math.max(1, limit)) undo.shift()
  return { undo, redo: [], seq }
}

export type HistoryApply<T> = { sheetId: string; content: T }
/**
 * 撤 n 步（n 超过栈深 ⇒ 撤到底）：依序从栈顶弹出·每步把那张 sheet 设回 before。
 * 返回新状态＋要套用的内容（同一张 sheet 撤了好几步 ⇒ 只留最早那步的 before）＋最后落在哪张 sheet（页面切过去）
 */
export function undoSteps<T>(st: HistoryState<T>, n = 1): { state: HistoryState<T>; apply: HistoryApply<T>[]; focusSheet: string | null } {
  const k = Math.max(0, Math.min(n, st.undo.length))
  if (!k) return { state: st, apply: [], focusSheet: null }
  const popped = st.undo.slice(st.undo.length - k).reverse()   // 由新到旧
  const bySheet = new Map<string, T>()
  for (const e of popped) bySheet.set(e.sheetId, e.before)       // 越旧越后写 ⇒ 留最早的 before
  return {
    state: { undo: st.undo.slice(0, st.undo.length - k), redo: [...st.redo, ...popped], seq: st.seq },
    apply: [...bySheet].map(([sheetId, content]) => ({ sheetId, content })),
    focusSheet: popped[popped.length - 1].sheetId,
  }
}
/** 重做 n 步：从 redo 顶依序弹回 undo·每步把那张 sheet 设成 after（同张多步 ⇒ 留最新那步的 after） */
export function redoSteps<T>(st: HistoryState<T>, n = 1): { state: HistoryState<T>; apply: HistoryApply<T>[]; focusSheet: string | null } {
  const k = Math.max(0, Math.min(n, st.redo.length))
  if (!k) return { state: st, apply: [], focusSheet: null }
  const popped = st.redo.slice(st.redo.length - k).reverse()     // 由最近撤掉的起
  const bySheet = new Map<string, T>()
  for (const e of popped) bySheet.set(e.sheetId, e.after)         // 越新越后写 ⇒ 留最新的 after
  return {
    state: { undo: [...st.undo, ...popped], redo: st.redo.slice(0, st.redo.length - k), seq: st.seq },
    apply: [...bySheet].map(([sheetId, content]) => ({ sheetId, content })),
    focusSheet: popped[popped.length - 1].sheetId,
  }
}
/** 下拉清单：栈顶起最近 max 步（第 0 项＝最近一步） */
export function recentSteps<T>(st: HistoryState<T>, max = HISTORY_MENU_MAX): HistoryEntry<T>[] {
  return st.undo.slice(-max).reverse()
}
/** 删掉某张 sheet 的全部步（那张 sheet 被删了·撤回它没有意义也回不去） */
export function dropSheet<T>(st: HistoryState<T>, sheetId: string): HistoryState<T> {
  return { undo: st.undo.filter(e => e.sheetId !== sheetId), redo: st.redo.filter(e => e.sheetId !== sheetId), seq: st.seq }
}
/** 每步的前后两份都过一遍 fn（页签改名后公式里的名字跟着换·撤销回去的内容才不会指到旧名变 #REF!）；fn 回 null＝那份不变 */
export function mapHistory<T>(st: HistoryState<T>, fn: (content: T) => T | null): HistoryState<T> {
  const m = (e: HistoryEntry<T>): HistoryEntry<T> => {
    const before = fn(e.before), after = fn(e.after)
    return before || after ? { ...e, before: before ?? e.before, after: after ?? e.after } : e
  }
  return { undo: st.undo.map(m), redo: st.redo.map(m), seq: st.seq }
}
