/**
 * 简报组件编辑 · 快捷键该不该接
 *
 * 旧版方向键挂在画布根元素的 onKeyDown 上 ⇒ 只有焦点刚好在画布上才响：点下方清单那一行、点属性栏、
 * 点完「鎖定」等按钮之后焦点都不在画布，方向键事件到不了处理函数。
 * 改成挂在 window：只要焦点不在打字的地方、也不在对话框里，而且落在简报编辑区（画布＋下方清单）或页面本身，就接。
 */

/** 焦点在打字的地方（输入框／下拉／富文字）⇒ 快捷键让给它自己 */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).closest !== 'function') return false
  const e = el as HTMLElement
  const tag = e.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (e.isContentEditable) return true
  return !!e.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]')
}

/**
 * 这一下按键该不该当成简报组件的快捷键：
 *   焦点不在打字的地方；
 *   没有弹窗（aria-modal）开着、焦点也不在对话框里；
 *   焦点在简报编辑区（画布＋下方清单·data-testid=slides-stage-area）里，或在页面本身（body——点完的按钮被拿掉后焦点会回到这里）。
 */
export function isDeckShortcutTarget(target: EventTarget | null, doc: Document | null = typeof document !== 'undefined' ? document : null): boolean {
  if (!doc) return false
  if (isEditableTarget(target)) return false
  if (doc.querySelector('[aria-modal="true"]')) return false
  const el = target as Element | null
  if (!el || el === doc.body || el === doc.documentElement || (el as unknown) === doc) return true
  if (typeof el.closest !== 'function') return false
  if (el.closest('[role="dialog"],[role="alertdialog"]')) return false
  return !!el.closest('[data-testid="slides-stage-area"]')
}

/** Ctrl（Mac＝⌘）按着吗 */
export const modKey = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey
