// 剪辑页输入框里的小卡节点（片段／标记／素材·转场借标记那颗）：登入版对话输入框与游客版右栏输入框共用一份画法。
// 纯 DOM（只用传进来的 document·⛔ React）⇒ 单测拿假 document 直接跑。
// 节点＝contentEditable=false＋data-token＝原记号 ⇒ 序列化回原串·光标贴着按退格／Delete 整颗删（../../shared/ui/inline-card-dom）。
import { CHIP_CLASS, CHIP_LABEL_CLASS, CHIP_TAG_CLASS, makeChipNode } from '../../shared/ui/inline-card-dom'
import { VEDIT_CLIP_REF_EVENT, VEDIT_MARKER_REF_EVENT, VEDIT_MEDIA_REF_EVENT, parseClipToken, parseMarkerToken, parseMediaToken } from './chat-token.pure'

export const CLIP_ICON_PATH = 'M6 4v12M14 4v12M2.5 8h3.5M2.5 12h3.5M14 8h3.5M14 12h3.5'
export const CLIP_CHIP_CLASS = CHIP_CLASS
export const CLIP_BORDER = '#E3D7BB'
export const CLIP_SOFT = '#FBF7EA'
export const CLIP_TAG = '#C96442'
export const MARKER_TAG = '#B45309'
export const MARKER_BORDER = '#F3D7A7'
export const MARKER_SOFT = '#FFF7E6'
export const MEDIA_TAG = '#2563EB'
export const MEDIA_BORDER = '#C9D8F5'
export const MEDIA_SOFT = '#F1F6FE'

/** 输入框里的片段小卡（contentEditable=false·data-token＝原记号 ⇒ 序列化回原串·退格整颗删）；认不出 ⇒ null（当字） */
export function makeClipCardNode(doc: Document, raw: string, countLabel: (n: number) => string): HTMLElement | null {
  const ref = parseClipToken(raw)
  if (!ref) return null
  const span = doc.createElement('span')
  span.contentEditable = 'false'
  span.dataset.token = raw
  span.dataset.testid = 'vedit-clip-chip'
  span.setAttribute('data-count', String(ref.ids.length))
  span.className = CLIP_CHIP_CLASS
  span.style.borderColor = CLIP_BORDER
  span.style.background = CLIP_SOFT
  span.title = ref.items.join('\n')
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', CLIP_TAG)
  svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('width', '13'); svg.setAttribute('height', '13')
  svg.setAttribute('aria-hidden', 'true')
  const rect = doc.createElementNS(svgNS, 'rect')
  rect.setAttribute('x', '2.5'); rect.setAttribute('y', '4'); rect.setAttribute('width', '15'); rect.setAttribute('height', '12'); rect.setAttribute('rx', '1.5')
  const path = doc.createElementNS(svgNS, 'path')
  path.setAttribute('d', CLIP_ICON_PATH)
  svg.append(rect, path)
  const tag = doc.createElement('span')
  tag.className = CHIP_TAG_CLASS
  tag.style.color = CLIP_TAG
  tag.textContent = countLabel(ref.ids.length)
  const label = doc.createElement('span')
  label.className = CHIP_LABEL_CLASS
  label.textContent = ref.items[0] + (ref.items.length > 1 ? ' …' : '')
  span.append(svg, tag, label)
  return span
}

export type VideoCardOpts = {
  countLabel: (n: number) => string
  /** 卡的提示字第二行（点了会怎样）；空字串 ⇒ 不加那行 */
  openTitle: string
}

function fire(doc: Document, name: string, detail: unknown) {
  doc.defaultView?.dispatchEvent(new CustomEvent(name, { detail }))
}
const withOpen = (title: string, open: string) => (open ? `${title}\n${open}` : title)

/** 片段／标记／素材三种记号 ⇒ 小卡节点（点了派对应事件）；不是这三种 ⇒ null */
export function makeVideoCardNode(doc: Document, raw: string, o: VideoCardOpts): HTMLElement | null {
  const clip = parseClipToken(raw)
  if (clip) {
    const n = makeClipCardNode(doc, raw, o.countLabel)
    if (!n) return null
    n.classList.add('cursor-pointer')
    n.title = withOpen(n.title, o.openTitle)
    n.addEventListener('click', () => fire(doc, VEDIT_CLIP_REF_EVENT, { ids: clip.ids, firstAt: clip.firstAt }))
    return n
  }
  const mk = parseMarkerToken(raw)
  if (mk) {
    const n = makeChipNode(doc, { raw, testid: 'vedit-marker-chip', border: MARKER_BORDER, soft: MARKER_SOFT, tag: MARKER_TAG, tagText: '⚑', label: mk.label, title: withOpen(mk.label, o.openTitle), onClick: () => fire(doc, VEDIT_MARKER_REF_EVENT, { at: mk.at }) })
    n.setAttribute('data-at', String(mk.at))
    return n
  }
  const md = parseMediaToken(raw)
  if (md) {
    const n = makeChipNode(doc, { raw, testid: 'vedit-media-chip', border: MEDIA_BORDER, soft: MEDIA_SOFT, tag: MEDIA_TAG, tagText: '▣', label: md.label, title: withOpen(md.label, o.openTitle), onClick: () => fire(doc, VEDIT_MEDIA_REF_EVENT, { id: md.id, label: md.label }) })
    n.setAttribute('data-media-id', md.id)
    return n
  }
  return null
}
