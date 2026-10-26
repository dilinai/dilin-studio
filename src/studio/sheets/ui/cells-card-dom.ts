// 表格页输入框里的「儲存格范围」小卡节点：登入版对话输入框与游客版右栏输入框共用一份画法。
// 纯 DOM（只用传进来的 document·⛔ React）⇒ 单测拿假 document 直接跑；画法同剪辑页那颗小卡（../../shared/ui/inline-card-dom）。
// 节点＝contentEditable=false＋data-token＝原记号 ⇒ 序列化回原串·退格整颗删；点卡 ⇒ 派 SHEET_CELLS_REF_EVENT（表格页把那块选回来）。
import { SHEET_CELLS_REF_EVENT, parseCellsToken } from '../engine/sheet-chat-ref.pure'
import { CHIP_CLASS, CHIP_LABEL_CLASS, CHIP_TAG_CLASS } from '../../shared/ui/inline-card-dom'

export const CELLS_TAG = '#15803D'
export const CELLS_BORDER = '#BFE3C8'
export const CELLS_SOFT = '#F0FAF2'

/** 认不出 ⇒ null（当字） */
export function makeSheetCellsCardNode(doc: Document, raw: string, openTitle: string): HTMLElement | null {
  const ref = parseCellsToken(raw)
  if (!ref) return null
  const span = doc.createElement('span')
  span.contentEditable = 'false'
  span.dataset.token = raw
  span.dataset.testid = 'sheet-cells-chip'
  span.setAttribute('data-range', ref.range)
  span.className = `${CHIP_CLASS} cursor-pointer`
  span.style.borderColor = CELLS_BORDER
  span.style.background = CELLS_SOFT
  span.title = `${ref.label}\n${openTitle}`
  const tag = doc.createElement('span')
  tag.className = CHIP_TAG_CLASS
  tag.style.color = CELLS_TAG
  tag.textContent = '▦'
  const label = doc.createElement('span')
  label.className = CHIP_LABEL_CLASS
  label.textContent = ref.label
  span.append(tag, label)
  span.addEventListener('click', () => doc.defaultView?.dispatchEvent(new CustomEvent(SHEET_CELLS_REF_EVENT, { detail: { sheetId: ref.sheetId, range: ref.range } })))
  return span
}
