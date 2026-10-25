/**
 * 简报「播放／预览」键位
 *
 *   ↑／↓        ＝上一页／下一页
 *   ←／→        ＝上一步／下一步（步＝页内单击动画那一组组·走完最后一步再 → 才翻下一页；没动画的页 → 直接翻页）
 *   空白键／PageDown＝下一步；PageUp＝上一步（翻页笔的前后键送的就是 PageDown／PageUp·前后对称）
 *   Home／End   ＝第一页／最后一页
 *   全屏播放时鼠标左键＝下一步（点在 ✕ 上除外·那条在 SlidesPlayer 里判）
 *
 * 焦点在打字的地方（输入框／下拉／富文字）一律不接；按着 Ctrl／⌘／Alt 不接（留给复制贴上、浏览器快捷键）。
 * 空白键落在按钮／连结上也不接——那一下是「按这颗钮」，不是翻页。
 */
import { isEditableTarget } from './keys'

export type PlayAction = 'prevPage' | 'nextPage' | 'prevStep' | 'nextStep' | 'firstPage' | 'lastPage'

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null }

function isPressableTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).closest !== 'function') return false
  return !!(el as Element).closest('button,a[href],summary,[role="button"],[role="menuitem"],[role="tab"],[role="option"]')
}

export function playKeyAction(e: KeyLike): PlayAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (isEditableTarget(e.target)) return null
  switch (e.key) {
    case 'ArrowUp': return 'prevPage'
    case 'ArrowDown': return 'nextPage'
    case 'ArrowLeft': return 'prevStep'
    case 'ArrowRight': return 'nextStep'
    case 'PageUp': return 'prevStep'
    case 'PageDown': return 'nextStep'
    case ' ': case 'Spacebar': return isPressableTarget(e.target) ? null : 'nextStep'
    case 'Home': return 'firstPage'
    case 'End': return 'lastPage'
    default: return null
  }
}

/** 换页类动作 ⇒ 目标页号（夹在 0..count-1）；步进类回 null（交给简报本体的 nextStep／prevStep） */
export function targetPage(action: PlayAction, cur: number, count: number): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (action) {
    case 'prevPage': return Math.max(0, Math.min(last, cur - 1))
    case 'nextPage': return Math.max(0, Math.min(last, cur + 1))
    case 'firstPage': return 0
    case 'lastPage': return last
    default: return null
  }
}

/** 播放画面在全屏里按简报比例居中铺满（两侧或上下留黑） */
export function fitBox(W: number, H: number, ratio = 16 / 9): { w: number; h: number; left: number; top: number } {
  if (W <= 0 || H <= 0) return { w: 0, h: 0, left: 0, top: 0 }
  let w = W, h = W / ratio
  if (h > H) { h = H; w = H * ratio }
  return { w, h, left: (W - w) / 2, top: (H - h) / 2 }
}

/**
 * fullscreenchange 来了怎么办（浏览器原生退全屏＝Esc／F11／系统手势都走这条）：
 *   没在播 ⇒ 不管；
 *   全屏元素就是播放层 ⇒ 记下「这一趟真进了全屏」；
 *   播放中、这一趟进过全屏、现在全屏元素不是播放层了 ⇒ 收起播放（状态与浏览器对齐）；
 *   还没进过全屏（requestFullscreen 被拒·页内铺满在播）⇒ 不管（别把页内铺满误收掉）。
 */
export function fullscreenChangeVerdict(s: { open: boolean; entered: boolean; isMine: boolean }): 'entered' | 'close' | 'ignore' {
  if (!s.open) return 'ignore'
  if (s.isMine) return 'entered'
  return s.entered ? 'close' : 'ignore'
}
