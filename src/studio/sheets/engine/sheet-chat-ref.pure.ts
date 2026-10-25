// ═══════════════════════════════════════════════════════════════════════════════════════════
// 表格页「选中格子按 Alt+A 把那块插进对话输入框」纯半（跟剪辑页同一套做法）。
// 小卡＝输入框值里的一段记号（值仍是一串字·送出正文就是这串字·角色照记号读）：
//   ⟦儲存格 表格1!C5:C9·cells=<分页编号>!C5:C9⟧（头＝「儲存格／单元格／Cells」＋分页名!范围·cells＝分页编号!范围 ⇒ 点卡把那块选回来）
// 本档只放算法与字面——画卡在宿主的对话格里；页面只管接线。⛔ 碰 DOM。
// ═══════════════════════════════════════════════════════════════════════════════════════════

export type SheetRefLang = 'zh-TW' | 'zh-CN' | 'en'

/** group1＝头（儲存格 表格1!C5:C9）·group2＝分页编号·group3＝范围 */
export const SHEET_CELLS_TOKEN_SRC = '⟦([^⟦⟧\\n·]*)·cells=([A-Za-z0-9-]{1,64})!([A-Z]{1,3}\\d{1,7}(?::[A-Z]{1,3}\\d{1,7})?)⟧'
const RANGE_RE = /^[A-Z]{1,3}\d{1,7}(?::[A-Z]{1,3}\d{1,7})?$/
const SHEET_ID_RE = /^[A-Za-z0-9-]{1,64}$/
const HEAD_WORD: Record<SheetRefLang, string> = { 'zh-TW': '儲存格', 'zh-CN': '单元格', en: 'Cells' }
const cleanName = (s: string) => s.replace(/[⟦⟧⟨⟩·\n]/g, ' ').replace(/\s{2,}/g, ' ').trim()

/** 选中的那块（分页名、分页编号、A1 范围）⇒ 一颗行内小卡的记号；范围／编号不对 ⇒ null */
export function buildCellsToken(sheetName: string | null | undefined, sheetId: string, range: string, lang: SheetRefLang): string | null {
  const r = range.trim().toUpperCase()
  if (!RANGE_RE.test(r) || !SHEET_ID_RE.test(sheetId)) return null
  const name = cleanName(sheetName ?? '')
  const where = name ? `${name}!${r}` : r
  return `⟦${HEAD_WORD[lang]} ${where}·cells=${sheetId}!${r}⟧`
}

export type CellsToken = { label: string; sheetId: string; range: string }
/** 一颗表格范围记号 ⇒ 卡上那行字、分页编号、范围；认不出 ⇒ null */
export function parseCellsToken(raw: string): CellsToken | null {
  const m = new RegExp(`^${SHEET_CELLS_TOKEN_SRC}$`).exec(raw.trim())
  if (!m) return null
  return { label: m[1].trim(), sheetId: m[2], range: m[3] }
}

export type SheetSeg = { type: 'text'; text: string } | ({ type: 'cells'; raw: string } & CellsToken)
/** 一串字 ⇒ 字段／小卡段（输入框与讯息气泡共用·raw 拼回＝原串） */
export function splitSheetSegments(text: string): SheetSeg[] {
  const re = new RegExp(SHEET_CELLS_TOKEN_SRC, 'g')
  const out: SheetSeg[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'cells', raw: m[0], label: m[1].trim(), sheetId: m[2], range: m[3] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}
export function hasSheetCellChips(text: string): boolean {
  return splitSheetSegments(text).some((s) => s.type === 'cells')
}

/** Alt＋A（Mac ⌥A·按 code 认·⌥A 打出的是 å）——同剪辑页的 isAltA */
export type AltKeyLike = { code?: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean }
export const isSheetAltA = (e: AltKeyLike) => !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing && e.code === 'KeyA'

/** 点卡派的事件：表格页把那块选回来（detail { sheetId, range }） */
export const SHEET_CELLS_REF_EVENT = 'dilinai:sheet-cells-ref'
export type SheetCellsRefDetail = { sheetId: string; range: string }
