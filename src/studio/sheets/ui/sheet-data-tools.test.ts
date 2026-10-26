// 尋找與取代／移除重複／隱藏列欄——介面小判断（./sheet-data-tools.pure.ts）＋接线守门。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./sheets/ui/sheet-data-tools.test.ts')"
// 负控（每条撤掉题必红）：
//   A nextHitIndex 不绕回（到底回 -1）⇒ ①红      B stepOverHidden 不跳藏的（直接 from+delta）⇒ ②红
//   C headerMenuPlan 不看右键在不在选取里（恒整段）⇒ ③红      D SheetGrid 行改回 filteredRows ⇒ ⑥红
//   E 删网站字典（登入版）任一新键 ⇒ ⑦红
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  nextHitIndex, isMultiCell, stepOverHidden, nearestVisible, headerMenuPlan, withoutHidden, hiddenEdgeMarks, visibleSpan, spanLabel,
  usedBounds, trimToUsed, guessHasHeader,
} from './sheet-data-tools.pure'
import { findCells, replaceCells, removeDuplicates } from '../engine/data-tools'
import { parseRef, type SheetContent } from '../engine/formula'
import { SHEETS_I18N } from '../i18n'

let passed = 0
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('ok  ', name) }

t('① 找下一個／上一個：逐列由左到右·从活动格之后起·到底绕回头', () => {
  const hits = [{ row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 3 }, { row: 4, col: 1 }]
  assert.equal(nextHitIndex(hits, { row: 0, col: 0 }), 0, '同一列右边那个先')
  assert.equal(nextHitIndex(hits, { row: 0, col: 2 }), 1, '活动格本身就是命中 ⇒ 跳下一个（不原地踏步）')
  assert.equal(nextHitIndex(hits, { row: 1, col: 1 }), 2)
  assert.equal(nextHitIndex(hits, { row: 4, col: 1 }), 0, '🔴 最后一个之后绕回第一个')
  assert.equal(nextHitIndex(hits, { row: 9, col: 9 }), 0)
  assert.equal(nextHitIndex(hits, { row: 1, col: 3 }, true), 1, 'Shift+Enter 往回')
  assert.equal(nextHitIndex(hits, { row: 0, col: 2 }, true), 3, '第一个之前绕到最后')
  assert.equal(nextHitIndex([], { row: 0, col: 0 }), -1, '没命中 ⇒ -1')
  // 接资料层：真找一遍再循环三次回原处
  const content: SheetContent = { cells: { A1: { v: 'Apple' }, C1: { v: 'pineapple' }, B2: { v: 'APPLE pie' }, A3: { v: '香蕉' }, D3: { v: '', f: '=A1&"x"' } } }
  const { hits: found } = findCells(content, { find: 'apple' })
  assert.deepEqual(found.map(h => h.cell), ['A1', 'C1', 'B2'], '不分大小写·逐列')
  let at = { row: 0, col: 0 }; const seen: string[] = []
  for (let k = 0; k < 4; k++) { const i = nextHitIndex(found, at); seen.push(found[i].cell); at = found[i] }
  assert.deepEqual(seen, ['C1', 'B2', 'A1', 'C1'], '从 A1 起：C1→B2→绕回 A1→C1')
  assert.deepEqual(findCells(content, { find: 'apple', matchCase: true }).hits.map(h => h.cell), ['C1'])
  assert.deepEqual(findCells(content, { find: 'apple*', wholeCell: true }).hits.map(h => h.cell), ['A1', 'B2'], '整格＋通配')
  assert.equal(isMultiCell({ r0: 0, r1: 0, c0: 0, c1: 0 }), false, '一格不给「只在選取範圍內」')
  assert.equal(isMultiCell({ r0: 0, r1: 1, c0: 0, c1: 0 }), true)
  assert.equal(isMultiCell(null), false)
})

t('①b 取代：一次一格（only）·全部取代预设跳过公式格·勾了才改公式', () => {
  const content: SheetContent = { cells: { A1: { v: 'cat' }, A2: { v: 'cat cat' }, A3: { v: '', f: '="cat"' } } }
  const one = replaceCells(content, { find: 'cat', replace: 'dog', only: ['A2'] })
  assert.deepEqual(one.changed.map(c => c.cell), ['A2']); assert.equal(one.cells.A2.v, 'dog dog'); assert.equal(one.cells.A1.v, 'cat', '别格不动')
  const all = replaceCells(content, { find: 'cat', replace: 'dog' })
  assert.equal(all.changed.length, 2); assert.equal(all.skippedFormulas, 1, '公式格跳过、回报几格')
  const withF = replaceCells(content, { find: 'cat', replace: 'dog', includeFormulas: true })
  assert.equal(withF.cells.A3.f, '="dog"')
})

t('② 方向键跳过藏的行／栏·走到头还是藏的就留原地', () => {
  const hid = new Set([2, 3, 9])
  assert.equal(stepOverHidden(1, 1, hid, 10), 4, '1 往下跳过 2、3 落 4')
  assert.equal(stepOverHidden(4, -1, hid, 10), 1, '往回同样跳')
  assert.equal(stepOverHidden(8, 1, hid, 10), 8, '🔴 下面全藏 ⇒ 不动（不落在藏的那条上）')
  assert.equal(stepOverHidden(0, -1, hid, 10), 0, '顶边夹住')
  assert.equal(stepOverHidden(5, 1, new Set(), 10), 6)
  assert.equal(stepOverHidden(5, 0, hid, 10), 5)
  assert.equal(nearestVisible(2, hid, 10), 4, '活动格被藏 ⇒ 先往后找')
  assert.equal(nearestVisible(9, hid, 10), 8, '后面没有 ⇒ 往前')
  assert.equal(nearestVisible(5, hid, 10), 5)
})

t('③ 右键表头选单：在选取里＝整段·不在＝只那一条（并改选它）·取消隐藏＝选取里藏的＋紧挨着的藏段', () => {
  const inSel = headerMenuPlan({ clicked: 3, selA: 2, selB: 5, hidden: [4, 7], count: 26 })
  assert.deepEqual(inSel.hide, { from: 2, to: 5 }); assert.equal(inSel.reselect, false)
  assert.deepEqual(inSel.unhide, [4], '选取里藏着的放出来')
  const out = headerMenuPlan({ clicked: 8, selA: 2, selB: 5, hidden: [4, 7], count: 26 })
  assert.deepEqual(out.hide, { from: 8, to: 8 }, '🔴 右键不在选取里 ⇒ 只藏那一条')
  assert.equal(out.reselect, true)
  assert.deepEqual(out.unhide, [7], '右键 I（8）左边紧挨的 H（7）藏着 ⇒ 可放出来')
  const run = headerMenuPlan({ clicked: 5, selA: 5, selB: 5, hidden: [2, 3, 4, 6], count: 26 })
  assert.deepEqual(run.unhide, [2, 3, 4, 6], '两边紧挨的整段藏的都算')
  const none = headerMenuPlan({ clicked: 5, selA: 5, selB: 5, hidden: [1], count: 26 })
  assert.deepEqual(none.unhide, [], '不紧挨 ⇒ 没东西可放 ⇒ 选单那项停用')
  const all = headerMenuPlan({ clicked: 0, selA: 0, selB: 2, hidden: undefined, count: 3 })
  assert.equal(all.hide, null, '会藏到一条不剩 ⇒ 不给藏')
  assert.deepEqual(withoutHidden([2, 3, 7], [3, 7]), [2])
  assert.equal(withoutHidden([3], [3]), undefined, '放光 ⇒ 键消失')
  assert.equal(spanLabel(1, 3, i => String(i + 1)), '2–4'); assert.equal(spanLabel(4, 4, i => String(i + 1)), '5')
})

t('④ 表头双线位置·合并区跨度只数看得见的', () => {
  const hidden = new Set([1, 2, 5])
  const m = hiddenEdgeMarks(6, i => !hidden.has(i), hidden)
  assert.deepEqual([...m.before], [3], 'B C 藏 ⇒ D 前缘画')
  assert.deepEqual([...m.after], [4], '最后一条 F 藏 ⇒ E 后缘画')
  const lead = hiddenEdgeMarks(4, i => i !== 0, new Set([0]))
  assert.deepEqual([...lead.before], [1], '打头的 A 藏 ⇒ B 前缘画')
  const filt = hiddenEdgeMarks(4, i => i !== 1, new Set())
  assert.equal(filt.before.size + filt.after.size, 0, '筛掉的（不在手动清单）不画')
  assert.equal(visibleSpan(0, 4, hidden), 3, 'A D E')
  assert.equal(visibleSpan(1, 2, hidden), 0)
})

t('⑤ 移除重複：范围剪到有内容的外框·第一列像表头才预设勾', () => {
  const cells = { A1: { v: '姓名' }, B1: { v: '分數' }, A2: { v: '王' }, B2: { v: '90' }, A3: { v: '王' }, B3: { v: '90' }, A4: { v: '李' }, C9: { s: { b: true } } }
  const used = usedBounds(cells, parseRef)
  assert.deepEqual(used, { r0: 0, r1: 3, c0: 0, c1: 1 }, '只有格式的 C9 不算有内容')
  assert.deepEqual(trimToUsed({ r0: 0, r1: 99, c0: 0, c1: 0 }, used), { r0: 0, r1: 3, c0: 0, c1: 0 }, '整栏 A ⇒ A1:A4')
  assert.equal(trimToUsed({ r0: 10, r1: 20, c0: 5, c1: 6 }, used), null)
  assert.equal(trimToUsed({ r0: 0, r1: 1, c0: 0, c1: 0 }, null), null)
  assert.equal(guessHasHeader([['姓名', '分數'], ['王', 90], ['李', 80]]), true, '表头是字、底下有数字')
  assert.equal(guessHasHeader([['王', '甲'], ['李', '乙']]), true, '全是字但表头的字底下没再出现')
  assert.equal(guessHasHeader([['王', '甲'], ['王', '甲']]), false, '第一列跟底下一样 ⇒ 是资料')
  assert.equal(guessHasHeader([[1, 2], [3, 4]]), false, '第一列是数字')
  assert.equal(guessHasHeader([['姓名', null], ['王', 1]]), false, '表头有空格')
  assert.equal(guessHasHeader([['姓名']]), false, '只有一列')
  const content: SheetContent = { cells }
  const r = removeDuplicates(content, { r0: 0, r1: 3, c0: 0, c1: 1 }, { hasHeader: true })
  assert.equal(r.removed, 1); assert.equal(r.kept, 2)
  assert.throws(() => removeDuplicates({ cells, merges: ['A2:B2'] }, { r0: 0, r1: 3, c0: 0, c1: 1 }), /merged/, '合并格丢英文错（介面换中文 sheet_dd_merged）')
})

const UI = (f: string) => readFileSync(join(__dirname, f), 'utf8')
t('⑥ 接线：网格行用 hiddenRowSet·栏真不画·方向键走 stepOverHidden·快捷键／工具栏／撤销栈', () => {
  const G = UI('SheetGrid.tsx')
  assert.match(G, /const hiddenRows = useMemo\(\(\) => hiddenRowSet\(view, viewReader\), \[view, viewReader\]\)/, '🔴 行改用 hiddenRowSet（手动藏＋筛掉）')
  assert.ok(!/filteredRows\(view, viewReader\)/.test(G), '⛔ 不再只看筛选')
  assert.match(G, /const hiddenCols = useMemo\(\(\) => hiddenColSet\(view\), \[view\]\)/)
  assert.match(G, /cols\.map\(c => hiddenCols\.has\(c\) \? null : <col /, 'colgroup 跳过藏的栏')
  assert.match(G, /style=\{hiddenCols\.has\(c\) \? \{ display: 'none' \} : frozenStyle\('colHead'/, '列头 display:none（留给 measure 按序量）')
  assert.match(G, /if \(hiddenCols\.has\(c\) && !\(span && span\.cs > 0\)\) return null/, '格子不画')
  assert.match(G, /s \+ \(hiddenCols\.has\(c\) \? 0 : colWidthOf\(colWidths, c\)\)/, '表宽扣掉藏的栏')
  assert.match(G, /r: dr \? stepOverHidden\(p\.r, dr, hiddenRows, DEFAULT_ROWS\) : p\.r,\n\s*c: dc \? stepOverHidden\(p\.c, dc, hiddenCols, DEFAULT_COLS\) : p\.c,/)
  assert.match(G, /if \(lk === 'f' \|\| lk === 'h'\) \{ e\.preventDefault\(\); openFind\(lk === 'h' \? 'replace' : 'find'\); return \}/, 'Ctrl／⌘+F／H')
  assert.match(G, /case 'find': openFind\(cmd\.mode\); break/); assert.match(G, /case 'dedupe': openDedupe\(\); break/)
  // 改动都走 emit（进撤销栈＋存档）
  assert.match(G, /emit\(\{ cells: next \}, \{ label: \{ k: 'replace', a: String\(count\) \} \}\)/)
  assert.match(G, /emit\(\{ cells: res\.cells \}, \{ label: \{ k: 'dedupe', a: rangeText\(d\.rect\) \} \}\)/)
  assert.match(G, /emit\(row \? \{ hiddenRows: next \} : \{ hiddenCols: next \}, \{ label \}\)/)
  assert.match(G, /onContextMenu=\{onHeaderContextMenu\('col', c\)\}/); assert.match(G, /onContextMenu=\{onHeaderContextMenu\('row', r\)\}/)
  const F = UI('SheetFreezePanes.tsx')
  assert.match(F, /fix\('th\[data-col\]', g\.colL, g\.colR, fz\.fc, r => r\.width\)/, '藏的栏在几何里当零宽')
  const B = UI('SheetToolbar.tsx')
  assert.match(B, /testid="tb-find" onClick=\{\(\) => onCommand\(\{ t: 'find', mode: 'find' \}\)\}/)
  assert.match(B, /testid="tb-dedupe" disabled=\{dis\} onClick=\{\(\) => onCommand\(\{ t: 'dedupe' \}\)\}/)
  const D = UI('SheetFindDialog.tsx')
  assert.match(D, /disabled=\{mode === 'replace'\}/, '取代页搜寻范围固定公式')
  assert.match(D, /btn\('sheet-replace-all', t\('sheet_find_replace_all'\), replaceAll, false, readonly/, '唯读停用全部取代')
})

t('⑦ 新键两份字典（studio 版＋登入版网站）三语都在、字一样', () => {
  const keys = Object.keys(SHEETS_I18N['zh-TW']).filter(k => /^sheet_(find_|dd_|hide_|unhide_|tb_find|tb_dedupe|hist_(replace|dedupe|hide_|unhide_))/.test(k))
  assert.equal(keys.length, 57, `新键数（实得 ${keys.length}）`)
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) for (const k of keys) assert.ok((SHEETS_I18N[lang] as Record<string, string>)[k], `${lang} 缺 ${k}`)
  // 登入版网站字典当字读（studio 档不许 import 网站的 lib·见 sheets.test ⑥ import 边界）：tw／cn／en 三段依序切开；
  //   单独拿出去的 studio（没有网站那份字典）⇒ 这段跳过
  const edPath = join(__dirname, '../../../lib/translations/editors.ts')
  if (existsSync(edPath)) {
    const ed = readFileSync(edPath, 'utf8')
    const iCn = ed.indexOf('\nconst cn: typeof tw = {'), iEn = ed.indexOf('\nconst en: typeof tw = {')
    assert.ok(iCn > 0 && iEn > iCn, 'editors.ts 三段结构没变')
    const section = (s: string) => { const m: Record<string, string> = {}; for (const x of s.matchAll(/^\s*(sheet_[a-z0-9_]+):\s*("(?:[^"\\]|\\.)*"),?\s*$/gm)) m[x[1]] = JSON.parse(x[2]); return m }
    const pairs: Array<[string, Record<string, string>, Record<string, string>]> = [
      ['zh-TW', SHEETS_I18N['zh-TW'] as Record<string, string>, section(ed.slice(0, iCn))],
      ['zh-CN', SHEETS_I18N['zh-CN'] as Record<string, string>, section(ed.slice(iCn, iEn))],
      ['en', SHEETS_I18N.en as Record<string, string>, section(ed.slice(iEn))],
    ]
    for (const [lang, a, b] of pairs) for (const k of keys) assert.equal(b[k], a[k], `🔴 网站字典 ${lang} ${k} 不一致`)
  }
  assert.equal(SHEETS_I18N['zh-TW'].sheet_hide_rows, '隱藏列', '台：列＝row'); assert.equal(SHEETS_I18N['zh-CN'].sheet_hide_rows, '隐藏行', '陆：行＝row')
  assert.equal(SHEETS_I18N['zh-TW'].sheet_hide_cols, '隱藏欄'); assert.equal(SHEETS_I18N['zh-CN'].sheet_hide_cols, '隐藏列')
})

console.log(`sheet-data-tools: ${passed}/8 passed`)
