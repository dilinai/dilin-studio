// 网页剪辑页·拖着的东西「本身跟着滑鼠走」。
// 按下那一刻把要拖的元素照原样复制一份、钉在画面最上层（position: fixed·不吃滑鼠），之后每一下照滑鼠位移挪它；
// 原位那份由页面照落点规划画（淡掉＝落点示意）。放手／取消就拿掉复制品。⛔ 不碰 React 状态（每一下直接改 transform·不重画）。
export type DragFloat = { move: (dx: number, dy: number) => void; end: () => void }

/** els＝要跟着走的元素（多选＝几段一起）；拿不到就回一个什么都不做的 */
export function floatClones(els: readonly Element[]): DragFloat {
  if (typeof document === 'undefined' || !els.length) return { move: () => {}, end: () => {} }
  const layer = document.createElement('div')
  layer.setAttribute('data-testid', 'vedit-drag-float')
  Object.assign(layer.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '90', pointerEvents: 'none' })
  for (const el of els) {
    const r = el.getBoundingClientRect()
    const c = el.cloneNode(true) as HTMLElement
    c.removeAttribute('data-testid')
    c.querySelectorAll('[data-testid]').forEach((n) => n.removeAttribute('data-testid'))
    Object.assign(c.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', opacity: '0.92', boxShadow: '0 6px 18px rgba(0,0,0,0.55)', pointerEvents: 'none' })
    layer.appendChild(c)
  }
  document.body.appendChild(layer)
  return {
    move: (dx, dy) => { layer.style.transform = `translate(${dx}px, ${dy}px)` },
    end: () => { layer.remove() },
  }
}
