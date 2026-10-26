// 游客版右栏底下那个「字里行间的小卡」输入框的插字口（编辑器整页 ⇄ 右栏 ui/InlineCardBox）：
//   编辑器按 Alt+A ⇒ insert(记号)；框挂上时 bind 一支「插在光标处」，还没挂上（右栏收着）⇒ 先排着、挂上即补插。
//   makeCard＝这个编辑器的小卡画法（同登入版对话输入框那套）；认不出 ⇒ null（当字插）。

export interface InlineBox {
  /** 插一颗记号在框的光标处（框还没挂上 ⇒ 排着）；回 true＝收下了 */
  insert(token: string): boolean
  makeCard(doc: Document, raw: string): HTMLElement | null
  bind(fn: ((token: string) => void) | null): void
}

export function createInlineBox(makeCard: (doc: Document, raw: string) => HTMLElement | null): InlineBox {
  let target: ((token: string) => void) | null = null
  let pending: string[] = []
  return {
    insert(token) {
      if (target) target(token)
      else pending.push(token)
      return true
    },
    makeCard: (doc, raw) => makeCard(doc, raw),
    bind(fn) {
      target = fn
      if (fn && pending.length) {
        const q = pending
        pending = []
        for (const x of q) fn(x)
      }
    },
  }
}
