// （React #185）：公式输入框「光标位置／横向卷动量」要不要 set 的比较（纯函数·node 题直接测）。
//   原先 SheetFormulaInput 每次渲染后都 setCaret／setScrollX，onChange 里又 setScrollX ⇒ 无头浏览器极快连打（0～10ms／字）
//   长公式在 96px 格里横向卷动时，嵌套更新累计超过 React 上限（#185 Maximum update depth）。
//   改成：先读出框里真的值，跟上回 set 过的比；一样就不 set（不排更新）、只有真变的那一项才 set。

export type CaretView = { caret: number; scrollX: number }
export type CaretSource = { selectionStart: number | null; value: string; scrollLeft: number }

/** 从输入框读出现在的光标位置与横向卷动量（没选取＝放在字尾）。 */
export function readCaretView(el: CaretSource): CaretView {
  return { caret: el.selectionStart ?? el.value.length, scrollX: el.scrollLeft }
}

/** 跟上回 set 过的比：都没变 ⇒ null（不 set）；否则只给真变了的那几项。 */
export function caretPatch(prev: CaretView, next: CaretView): Partial<CaretView> | null {
  const p: Partial<CaretView> = {}
  if (prev.caret !== next.caret) p.caret = next.caret
  if (prev.scrollX !== next.scrollX) p.scrollX = next.scrollX
  return p.caret === undefined && p.scrollX === undefined ? null : p
}
