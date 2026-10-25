// 表格档的 sheet 清单纯函数
//   服务端路由（/api/ai-sheet/sheets）与页面（/ai-sheet/[id]）共用这一份：预设名／新增／改名／删（最后一张不可删）／顺序。
//   ⛔ 这里不碰库、不碰 React——只算清单。

export type SheetTab = { id: string; name: string; position: number }

export const SHEET_NAME_MAX = 60
export const DEFAULT_SHEET_PREFIX = '表格'

/** 页签名归一：去首尾空白·连续空白折成一个·截到上限。空 ⇒ '' */
export function normalizeSheetName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, SHEET_NAME_MAX)
}

/** 按 position 升序（同序按 id 稳定） */
export function sortSheets(list: readonly SheetTab[]): SheetTab[] {
  return [...list].sort((a, b) => (a.position - b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 顺序重编成 0..n-1（删掉一张后不留洞） */
export function renumber(list: readonly SheetTab[]): SheetTab[] {
  return sortSheets(list).map((s, i) => ({ ...s, position: i }))
}

/** 预设名「<prefix>N」：N＝清单里同前缀数字后缀的最大值＋1（至少 1）·再跳过撞名（防「表格2」被手改成「表格3」后新的又叫「表格3」） */
export function nextSheetName(list: readonly SheetTab[], prefix: string = DEFAULT_SHEET_PREFIX): string {
  const p = normalizeSheetName(prefix) || DEFAULT_SHEET_PREFIX
  const names = new Set(list.map(s => s.name))
  let max = 0
  for (const s of list) {
    if (!s.name.startsWith(p)) continue
    const tail = s.name.slice(p.length)
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail))
  }
  let n = max + 1
  while (names.has(`${p}${n}`)) n++
  return `${p}${n}`
}

export type SheetListError = 'not_found' | 'empty_name' | 'last_sheet'
export type SheetListResult = { ok: true; list: SheetTab[] } | { ok: false; reason: SheetListError }

/** 末尾加一张（名字缺 ⇒ 预设名）。返回新清单（已重编顺序）。 */
export function addSheet(list: readonly SheetTab[], id: string, name?: string | null, prefix?: string): { list: SheetTab[]; added: SheetTab } {
  const nm = normalizeSheetName(name) || nextSheetName(list, prefix)
  const maxPos = list.reduce((m, s) => Math.max(m, s.position), -1)
  const added: SheetTab = { id, name: nm, position: maxPos + 1 }
  return { list: renumber([...list, added]), added }
}

/** 就地改名（Enter 存）。空名 ⇒ empty_name；找不到 ⇒ not_found。同名允许（Excel 不允许）。 */
export function renameSheet(list: readonly SheetTab[], id: string, name: unknown): SheetListResult {
  const nm = normalizeSheetName(name)
  if (!nm) return { ok: false, reason: 'empty_name' }
  if (!list.some(s => s.id === id)) return { ok: false, reason: 'not_found' }
  return { ok: true, list: sortSheets(list.map(s => (s.id === id ? { ...s, name: nm } : s))) }
}

/** 删一张；最后一张不可删 ⇒ last_sheet。返回重编顺序后的清单。 */
export function removeSheet(list: readonly SheetTab[], id: string): SheetListResult {
  if (!list.some(s => s.id === id)) return { ok: false, reason: 'not_found' }
  if (list.length <= 1) return { ok: false, reason: 'last_sheet' }
  return { ok: true, list: renumber(list.filter(s => s.id !== id)) }
}

/** 删掉当前这张后该切到哪张（Excel 口径：右邻·没右邻取左邻） */
export function neighborAfterRemove(list: readonly SheetTab[], id: string): string | null {
  const sorted = sortSheets(list)
  const i = sorted.findIndex(s => s.id === id)
  if (i < 0) return sorted[0]?.id ?? null
  return sorted[i + 1]?.id ?? sorted[i - 1]?.id ?? null
}
