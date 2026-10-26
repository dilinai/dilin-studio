// 输入框「字里行间的小卡」的纯 DOM 半（只用传进来的 document／节点·⛔ React）：登入版对话输入框与游客版右栏输入框共用。
//   小卡节点＝contentEditable=false＋data-token＝原记号 ⇒ 序列化回原串；光标贴着按退格／Delete 整颗删。
//   插卡时卡片后面补一个零宽字（放光标用）·序列化时拿掉。

export const CHIP_CLASS = 'inline-flex max-w-[16rem] items-center gap-1 align-middle mx-0.5 rounded-lg border px-1.5 py-0 text-[13px] leading-6 select-none'
export const CHIP_TAG_CLASS = 'shrink-0 rounded px-0.5 text-[10.5px] font-semibold leading-4'
export const CHIP_LABEL_CLASS = 'truncate text-[#1f2937]'

/** 一颗小卡（前面一小格标签字＋后面一行说明）；点了做 onClick */
export function makeChipNode(doc: Document, o: { raw: string; testid: string; border: string; soft: string; tag: string; tagText: string; label: string; title: string; onClick?: () => void }): HTMLElement {
  const span = doc.createElement('span')
  span.contentEditable = 'false'
  span.dataset.token = o.raw
  span.dataset.testid = o.testid
  span.className = `${CHIP_CLASS} cursor-pointer`
  span.style.borderColor = o.border
  span.style.background = o.soft
  span.title = o.title
  const t = doc.createElement('span')
  t.className = CHIP_TAG_CLASS
  t.style.color = o.tag
  t.textContent = o.tagText
  const l = doc.createElement('span')
  l.className = CHIP_LABEL_CLASS
  l.textContent = o.label
  span.append(t, l)
  if (o.onClick) span.addEventListener('click', o.onClick)
  return span
}

const ZW = '​'
const isCard = (n: Node | null | undefined): n is HTMLElement => !!n && n.nodeType === 1 && !!(n as HTMLElement).dataset?.token
const onlyZw = (s: string) => s.replace(new RegExp(ZW, 'g'), '') === ''

/** 光标在卡片旁边就删掉那张卡（dir：back＝退格·fwd＝Delete）；删了回 true（调用方 preventDefault＋回写）。 */
export function deleteCardAtCaret(root: HTMLElement, sel: Selection | null, dir: 'back' | 'fwd'): boolean {
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false
  const node = sel.anchorNode
  const off = sel.anchorOffset
  if (!node || !root.contains(node)) return false
  const zwNodes: Text[] = []
  let cand: Node | null = null
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? ''
    const between = dir === 'back' ? text.slice(0, off) : text.slice(off)
    if (!onlyZw(between)) return false
    cand = dir === 'back' ? node.previousSibling : node.nextSibling
  } else {
    cand = dir === 'back' ? node.childNodes[off - 1] ?? null : node.childNodes[off] ?? null
  }
  // 中间隔着纯零宽字的字节点 ⇒ 跳过（一起删）
  while (cand && cand.nodeType === 3 && onlyZw(cand.nodeValue ?? '')) {
    zwNodes.push(cand as Text)
    cand = dir === 'back' ? cand.previousSibling : cand.nextSibling
  }
  if (!isCard(cand)) return false
  const parent = cand.parentNode!
  const doc = root.ownerDocument
  const range = doc.createRange()
  // 光标落在卡片原来的位置
  const idx = Array.prototype.indexOf.call(parent.childNodes, cand)
  cand.remove()
  zwNodes.forEach(z => z.remove())
  if (node.nodeType === 3 && node.parentNode) {
    const t = node as Text
    const text = t.nodeValue ?? ''
    if (dir === 'back') { t.nodeValue = text.slice(off); range.setStart(t, 0) }
    else { t.nodeValue = text.slice(0, off); range.setStart(t, t.nodeValue.length) }
  } else {
    // 退格：卡片原位（卡后那几个零宽字在卡片之后·不影响下标）；Delete：光标原位（删掉的都在光标之后）
    range.setStart(parent, Math.min(dir === 'back' ? idx : off, parent.childNodes.length))
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

const BLOCK = new Set(['DIV', 'P', 'LI'])
/** 输入框内容 ⇒ 一串字：字照抄、小卡换回原记号、换行（<br>／一段一个 div）换成 \n；零宽字拿掉。照原顺序。 */
export function serializeInlineBox(root: Node): string {
  let out = ''
  const walk = (n: Node) => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === 3) { out += (c.nodeValue ?? '').replace(new RegExp(ZW, 'g'), ''); return }
      if (c.nodeType !== 1) return
      const el = c as HTMLElement
      if (el.dataset?.token) { out += el.dataset.token; return }
      if (el.tagName === 'BR') { out += '\n'; return }
      const block = BLOCK.has(el.tagName)
      if (block && out && !out.endsWith('\n')) out += '\n'
      walk(el)
    })
  }
  walk(root)
  return out.replace(/ /g, ' ')
}

/** 在 range（不在框里 ⇒ 框尾）插一颗卡＋卡后零宽字，光标放到卡后 */
export function insertCardAt(root: HTMLElement, card: Node, range: Range | null): Range {
  const doc = root.ownerDocument
  let r = range && root.contains(range.startContainer) ? range : null
  if (!r) { r = doc.createRange(); r.selectNodeContents(root); r.collapse(false) }
  r.deleteContents()
  const zw = doc.createTextNode(ZW)
  r.insertNode(card)
  card.parentNode!.insertBefore(zw, card.nextSibling)   // 零宽字紧贴卡后（⛔ 再 insertNode：会在字中间多切出一个空字节点）
  const after = doc.createRange()
  after.setStart(zw, 1)
  after.collapse(true)
  return after
}
