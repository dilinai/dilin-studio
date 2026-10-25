// （React #185）：公式输入框「光标／卷动量没变就不 set」——纯判断＋接线。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./sheets/ui/sheet-caret-sync.test.ts')"
// 负控（每条撤掉题必红·已实跑）：
//   A caretPatch 不比较（恒回整份）⇒ ①红      B SheetFormulaInput 渲染后效果改回直接 setCaret／setScrollX ⇒ ②红
//   C onChange 改回直接 setScrollX ⇒ ②红
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { caretPatch, readCaretView } from './sheet-caret-sync.pure'

let passed = 0
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('ok  ', name) }

t('① 没变就不 set；只给真变了的那一项', () => {
  const v = { caret: 28, scrollX: 127 }
  assert.equal(caretPatch(v, { caret: 28, scrollX: 127 }), null, '光标与卷动都没变 ⇒ 不 set（不排更新）')
  assert.deepEqual(caretPatch(v, { caret: 29, scrollX: 127 }), { caret: 29 }, '只光标动 ⇒ 只 set 光标')
  assert.deepEqual(caretPatch(v, { caret: 28, scrollX: 135 }), { scrollX: 135 }, '只卷动 ⇒ 只 set 卷动')
  assert.deepEqual(caretPatch(v, { caret: 0, scrollX: 0 }), { caret: 0, scrollX: 0 })
  assert.deepEqual(readCaretView({ selectionStart: null, value: '=SUM(A1)', scrollLeft: 3 }), { caret: 8, scrollX: 3 }, '没选取 ⇒ 光标在字尾')
  assert.deepEqual(readCaretView({ selectionStart: 2, value: '=SUM(A1)', scrollLeft: 0 }), { caret: 2, scrollX: 0 })
  // 连打模拟：同一个字的几次「渲染后对一下」只有第一次会 set
  let sets = 0, shown = { caret: 0, scrollX: 0 }
  const sync = (el: { selectionStart: number; value: string; scrollLeft: number }) => {
    const next = readCaretView(el), p = caretPatch(shown, next)
    if (p) { shown = next; sets += Object.keys(p).length }
  }
  const f = '=SUM(A1:A4)+SUM(B1:B4)+SUM(C1:C4)'
  for (let i = 1; i <= f.length; i++) {
    const el = { selectionStart: i, value: f.slice(0, i), scrollLeft: Math.max(0, i * 8 - 90) }
    for (let k = 0; k < 6; k++) sync(el)   // onChange＋渲染后效果＋onSelect／onKeyUp／onScroll…
  }
  assert.ok(sets <= f.length * 2, `每个字最多 set 光标＋卷动各一次（实得 ${sets}）`)
})

t('② 接线：SheetFormulaInput 渲染后效果与 onChange 都走「比过才 set」·不再每次渲染直接 set', () => {
  const S = readFileSync(join(__dirname, 'SheetFormulaInput.tsx'), 'utf8')
  assert.match(S, /import \{ caretPatch, readCaretView, type CaretView \} from '\.\/sheet-caret-sync\.pure'/)
  assert.match(S, /const patch = caretPatch\(shown\.current, next\)\n\s*if \(!patch\) return/, '比过没变就 return')
  assert.match(S, /const syncCaret = \(\) => \{\n\s*const el = inputRef\.current\n\s*if \(!el\) return\n\s*applyView\(readCaretView\(el\)\)\n\s*\}/)
  assert.match(S, /onChange=\{e => \{ onChange\(e\.target\.value\); applyView\(readCaretView\(e\.target\)\) \}\}/, 'onChange 也走比较')
  const direct = S.split('\n').filter(l => /set(Caret|ScrollX)\(/.test(l) && !/if \(patch\.(caret|scrollX) !== undefined\) set(Caret|ScrollX)\(patch\./.test(l))
  assert.deepEqual(direct, [], '⛔ 别处直接 setCaret／setScrollX（绕过比较）')
})

console.log(`sheet-caret-sync: ${passed}/2 passed`)
