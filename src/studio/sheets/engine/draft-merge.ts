// ── 表格：没存进库的稿并到库里新版上（AI 编辑保护遮罩）──
//   用法：罩落那一刻补存失败（撞版 409／500）或罩外撞版 ⇒ 网页载入库里新版（保住 AI 刚写的格）·同时把「我改了哪些格」算出来·
//   用户点「套回我的修改」才把这些格写到新版上（⛔ 整张旧稿盖回去：那会把 AI 的新格一起抹掉）。
//   判「我改了哪些」＝草稿 vs 草稿所基于的那一版（base·最后一次确认在库的内容）逐格比；不在 cells 里的顶层栏（合并／列宽／行高／图片…）按整栏比。
//   同一格 AI 也改了、我也改了 ⇒ 套回时用我的（用户明确点了套回）。⛔ 本档不 import React／fetch。
export type SheetLike = { cells?: Record<string, unknown> } & Record<string, unknown>

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** 草稿相对 base 改了的格（键）与顶层栏（键）。 */
export function sheetDraftChanges(base: SheetLike, draft: SheetLike): { cells: string[]; fields: string[] } {
  const bc = base.cells ?? {}, dc = draft.cells ?? {}
  const cells = [...new Set([...Object.keys(bc), ...Object.keys(dc)])].filter(k => !same(bc[k], dc[k])).sort()
  const fields = [...new Set([...Object.keys(base), ...Object.keys(draft)])].filter(k => k !== 'cells' && !same(base[k], draft[k])).sort()
  return { cells, fields }
}

/** 把草稿里改了的格／栏套到 server 新版上（没改的一律取 server 的）。草稿里删掉的格 ⇒ 结果里也删。 */
export function mergeSheetDraft<T extends SheetLike>(base: SheetLike, draft: SheetLike, server: T): T {
  const ch = sheetDraftChanges(base, draft)
  const out: SheetLike = { ...server, cells: { ...(server.cells ?? {}) } }
  const oc = out.cells as Record<string, unknown>
  const dc = draft.cells ?? {}
  for (const k of ch.cells) { if (k in dc) oc[k] = dc[k]; else delete oc[k] }
  for (const f of ch.fields) { if (f in draft) out[f] = draft[f]; else delete out[f] }
  return out as T
}

/** 「套回」那刻才合并：同一张页签的几份「底＋稿」按先后逐份对**现在库里那一版**合并（每份只带它自己改了的格）。
 *  调用方写回时带的版次必须是 current 那一版的（⛔ 拿出条那刻并好的整张配最新版次写回：会把出条之后别人新加的格抹掉）。 */
export function applySheetDrafts<T extends SheetLike>(current: T, entries: Array<{ base: SheetLike; draft: SheetLike }>): T {
  return entries.reduce<T>((acc, e) => mergeSheetDraft(e.base, e.draft, acc), current)
}
