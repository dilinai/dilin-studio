// 表格公式跨表引用：解析／范围函数／重算连动／改名跟着换／删表 #REF!／循环／平移与插删行／xlsx 往返。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./sheets/crossref.test.ts')"
//   openpyxl 当独立读者核汇出档另在 scripts（报告里记）——本档只用本仓引擎＋SheetJS 读回，不碰 HOME、不写档。
import assert from 'node:assert/strict'
import { SheetBook, SheetEvaluator, computeSheet, quoteSheetName, sheetPrefixAt, toXlsxFormula, type BookSheet, type SheetContent } from './engine/formula'
import { scanRefs, shiftFormula, renameSheetInFormula, renameSheetInContent, rewriteSheetRefs } from './engine/formula-refs'
import { checkFormula, refHighlights } from './engine/formula-edit'
import { shiftRefsForInsert, shiftRefsForDelete } from './engine/agent-ops'
import { mapHistory, pushHistory, emptyHistory, undoSteps } from './engine/history'
import { buildXlsxBytes, parseXlsx } from './engine/xlsx-io'
import { sheetToCsv } from './engine/csv'
import { createGuestSheetsData } from './page/guest-data'
import type { ProjectStore } from '../shared/types'
import { sheetsFormat } from './format'
import * as XLSX from 'xlsx'

let passed = 0, failed = 0
const queue: Array<[string, () => void | Promise<void>]> = []
const t = (name: string, fn: () => void | Promise<void>) => { queue.push([name, fn]) }

const cells = (o: Record<string, string>): SheetContent => ({ cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.startsWith('=') ? { v: '', f: v } : { v }])) })
/** 整本里某张的值（照网页：本张独立求值器＋book） */
function val(book: BookSheet[], sheet: string, key: string) {
  const s = book.find(x => x.name === sheet)!
  return computeSheet(s.content, { book: new SheetBook(book), sheetName: s.name }).get(key)
}

// ── ① 解析 ──
t('解析：表格2!A1／区间／单引号名／\'\' 转义／不分大小写／像格位的名要加引号 \'Q1\'／第二端再写前缀', () => {
  const book: BookSheet[] = [
    { name: '表格1', content: cells({ A1: '=表格2!A1', A2: '=SUM(表格2!A1:B2)', A3: "='销售 表'!A1*2", A4: "='O''Brien'!B1", A5: '=sheet2!A1', A6: "='Q1'!A1+1", A7: '=SUM(表格2!A1:表格2!B2)', A8: "=SUM('销售 表'!A1:A3)" }) },
    { name: '表格2', content: cells({ A1: '10', B1: '20', A2: '1', B2: '2' }) },
    { name: '销售 表', content: cells({ A1: '7', A2: '1', A3: '2' }) },
    { name: "O'Brien", content: cells({ B1: 'hi' }) },
    { name: 'Sheet2', content: cells({ A1: '5' }) },
    { name: 'Q1', content: cells({ A1: '41' }) },
  ]
  assert.equal(val(book, '表格1', 'A1'), 10)
  assert.equal(val(book, '表格1', 'A2'), 33)
  assert.equal(val(book, '表格1', 'A3'), 14)
  assert.equal(val(book, '表格1', 'A4'), 'hi')
  assert.equal(val(book, '表格1', 'A5'), 5, '页签名不分大小写')
  assert.equal(val(book, '表格1', 'A6'), 42, "'Q1'!A1：长得像格位的页签名加引号照认")
  assert.equal(checkFormula('=Q1!A1')?.code, 'badChar', '不加引号的 Q1! 照 Excel 不认（Q1 是格位）')
  assert.equal(val(book, '表格1', 'A7'), 33)
  assert.equal(val(book, '表格1', 'A8'), 10)
})
t('解析：不存在的表名 ⇒ #REF!；没给 book ⇒ 跨表 #REF!；前缀后不接格位 ⇒ 错；第二端换了别张 ⇒ #REF!', () => {
  const book: BookSheet[] = [{ name: '表格1', content: cells({ A1: '=没这张!A1', A2: '=SUM(没这张!A1:A3)', A3: '=表格2!A1', A4: '=表格2!', A5: '=SUM(表格2!A1:表格3!A2)' }) }, { name: '表格2', content: cells({ A1: '3' }) }]
  assert.equal(val(book, '表格1', 'A1'), '#REF!')
  assert.equal(val(book, '表格1', 'A2'), '#REF!')
  assert.equal(computeSheet(book[0].content).get('A3'), '#REF!', '没 book ⇒ #REF!')
  assert.equal(val(book, '表格1', 'A4'), '#REF!')
  assert.equal(val(book, '表格1', 'A5'), '#REF!')
  // Excel 删页签后的写法 #REF!A1（汇入的档会有）⇒ #REF!（⛔ #ERROR!）
  assert.equal(computeSheet(cells({ A1: '=#REF!A1+1', A2: '=SUM(#REF!A1:A3)' })).get('A1'), '#REF!')
  assert.equal(computeSheet(cells({ A1: '=#REF!A1+1', A2: '=SUM(#REF!A1:A3)' })).get('A2'), '#REF!')
})
t('前缀词法：sheetPrefixAt／quoteSheetName（空白、数字开头、像格位、单引号）', () => {
  assert.deepEqual(sheetPrefixAt("'a''b'!A1", 0), { name: "a'b", end: 7 })
  assert.deepEqual(sheetPrefixAt('表格2!A1', 0), { name: '表格2', end: 4 })
  assert.equal(sheetPrefixAt('SUM(A1)', 0), null)
  assert.equal(sheetPrefixAt("'没闭!A1", 0), null)
  assert.equal(quoteSheetName('表格2'), '表格2')
  assert.equal(quoteSheetName('销售 表'), "'销售 表'")
  assert.equal(quoteSheetName("O'Brien"), "'O''Brien'")
  assert.equal(quoteSheetName('2024'), "'2024'")
  assert.equal(quoteSheetName('A1'), "'A1'")
  assert.equal(quoteSheetName('R1C1'), "'R1C1'")
  assert.equal(quoteSheetName('表格2', { ascii: true }), "'表格2'")
  assert.equal(quoteSheetName('Sheet_2', { ascii: true }), 'Sheet_2')
})
t('语法检查：跨表写法不报错；只写前缀／前缀接函数 ⇒ badRef；引用上色不框别张', () => {
  for (const f of ['=表格2!A1', '=SUM(表格2!A1:B5)', "='销售 表'!A1:B5", "=VLOOKUP(1,'O''Brien'!A:B,2,FALSE)", '=表格2!A1:表格2!B2', '=SUM(表格2!A:A)']) assert.equal(checkFormula(f), null, f)
  assert.equal(checkFormula('=表格2!')?.code, 'badRef')
  assert.equal(checkFormula('=表格2!SUM(A1)')?.code, 'badRef')
  assert.deepEqual(refHighlights('=A1+表格2!B2').map(h => h.text), ['A1'])
})

// ── ② 范围函数 ──
t('范围函数吃跨表区间：SUM AVERAGE COUNT COUNTIF SUMIF VLOOKUP INDEX MATCH XLOOKUP 整列', () => {
  const data = cells({ A1: '苹果', B1: '3', A2: '香蕉', B2: '5', A3: '苹果', B3: '7' })
  const book: BookSheet[] = [
    { name: '汇总', content: cells({
      A1: '=SUM(数据!B1:B3)', A2: '=AVERAGE(数据!B1:B3)', A3: '=COUNT(数据!B:B)', A4: '=COUNTIF(数据!A1:A3,"苹果")',
      A5: '=SUMIF(数据!A1:A3,"苹果",数据!B1:B3)', A6: '=VLOOKUP("香蕉",数据!A1:B3,2,FALSE)', A7: '=INDEX(数据!B1:B3,3)',
      A8: '=MATCH("香蕉",数据!A1:A3,0)', A9: '=XLOOKUP("香蕉",数据!A1:A3,数据!B1:B3)', A10: '=SUM(数据!B:B)', A11: '=INDEX(数据!A1:B3,2,2)*10',
    }) },
    { name: '数据', content: data },
  ]
  const want: Record<string, unknown> = { A1: 15, A2: 5, A3: 3, A4: 2, A5: 10, A6: 5, A7: 7, A8: 2, A9: 5, A10: 15, A11: 50 }
  for (const [k, v] of Object.entries(want)) assert.equal(val(book, '汇总', k), v, k)
})

// ── ③ 重算连动 ──
t('重算连动：被引用的分页一改（整本换一份）⇒ 这边的公式跟着变；链式 A→B→C', () => {
  const a = cells({ A1: '=表格2!A1*2' })
  const b1 = cells({ A1: '=表格3!A1+1' })
  const c1 = cells({ A1: '1' })
  assert.equal(val([{ name: '表格1', content: a }, { name: '表格2', content: b1 }, { name: '表格3', content: c1 }], '表格1', 'A1'), 4)
  const c2 = cells({ A1: '10' })
  assert.equal(val([{ name: '表格1', content: a }, { name: '表格2', content: b1 }, { name: '表格3', content: c2 }], '表格1', 'A1'), 22)
  // 同一个 book：别张的求值器懒建·读别张也照别张的合并区（区间里被盖住的格算空）
  const merged: SheetContent = { cells: { A1: { v: '5' }, A2: { v: '9' } }, merges: ['A1:A2'] }
  assert.equal(val([{ name: 'x', content: cells({ A1: '=SUM(y!A1:A2)', A2: '=y!A2' }) }, { name: 'y', content: merged }], 'x', 'A1'), 5)
  assert.equal(val([{ name: 'x', content: cells({ A1: '=SUM(y!A1:A2)', A2: '=y!A2' }) }, { name: 'y', content: merged }], 'x', 'A2'), 5)
})

// ── ⑥ 循环 ──
t('循环引用：跨表 A→B→A ⇒ #CYCLE!（不卡死）；三张绕一圈；写自己名字的自引用', () => {
  const book: BookSheet[] = [{ name: 'A', content: cells({ A1: '=B!A1+1' }) }, { name: 'B', content: cells({ A1: '=A!A1+1' }) }]
  assert.equal(val(book, 'A', 'A1'), '#CYCLE!')
  assert.equal(val(book, 'B', 'A1'), '#CYCLE!')
  const ring: BookSheet[] = [{ name: 'p', content: cells({ A1: '=q!A1' }) }, { name: 'q', content: cells({ A1: "=SUM('r'!A1:A2)" }) }, { name: 'r', content: cells({ A2: '=p!A1' }) }]   // r 单字像 R1C1 的「列」⇒ 照 Excel 加引号
  assert.equal(val(ring, 'p', 'A1'), '#CYCLE!')
  const self: BookSheet[] = [{ name: '表格1', content: cells({ A1: '=表格1!A2', A2: '=表格1!A1', B1: '=表格1!C1*3', C1: '2' }) }]
  assert.equal(val(self, '表格1', 'A1'), '#CYCLE!')
  assert.equal(val(self, '表格1', 'B1'), 6)
  // 不在圈里的照算（循环栈按表分开：A!A1 与 B!A1 同键名不互相误判）
  const sameKey: BookSheet[] = [{ name: 'A', content: cells({ A1: '=B!A1+1' }) }, { name: 'B', content: cells({ A1: '=A!B1+1' }) }]
  sameKey[0].content!.cells!.B1 = { v: '5' }
  assert.equal(val(sameKey, 'A', 'A1'), 7)
})

// ── ④ 改名 ──
t('改名：公式里指到旧名的前缀换成新名（照规则加引号）·字串里的不动·别张的不动·没变 ⇒ null', () => {
  assert.equal(renameSheetInFormula('=表格2!A1+SUM(表格2!B1:B3)', '表格2', '销售 表'), "='销售 表'!A1+SUM('销售 表'!B1:B3)")
  assert.equal(renameSheetInFormula("='销售 表'!A1&\"表格2!A1\"", '销售 表', "O'Brien"), "='O''Brien'!A1&\"表格2!A1\"")
  assert.equal(renameSheetInFormula('=SHEET2!A:A', 'sheet2', 'Data'), '=Data!A:A', '不分大小写')
  assert.equal(renameSheetInFormula('=表格3!A1+表格2!A1', '表格2', 'X'), '=表格3!A1+X!A1')
  assert.equal(renameSheetInFormula('=SUM(表格2!A1:表格2!B2)', '表格2', 'X'), '=SUM(X!A1:B2)')
  const c = cells({ A1: '=表格2!A1', A2: 'x' })
  const n = renameSheetInContent(c, '表格2', '新')!
  assert.equal(n.cells!.A1.f, '=新!A1'); assert.equal(n.cells!.A2, c.cells!.A2)
  assert.equal(renameSheetInContent(c, '没关系', '新'), null)
})
t('改名（游客版资料层）：别张与自己的跨表公式一并换·回 rewritten；同名几张改的不是排最前那张 ⇒ 不换', async () => {
  const store = memStore()
  await sheetsFormat.save(store, { name: 'x', sheets: [
    { id: 's1', name: '表格1', content: cells({ A1: '=表格2!A1*2', A2: '=表格1!A3' }) },
    { id: 's2', name: '表格2', content: cells({ A1: '21', B1: '=表格2!A1' }) },
    { id: 's3', name: '表格3', content: cells({ A1: '="表格2!A1"' }) },
  ] })
  const data = createGuestSheetsData({ store })
  await data.getDoc()
  const r = await data.renameSheet('s2', '销售 表')
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual((r.data.rewritten ?? []).map(x => x.id).sort(), ['s1', 's2'])
  assert.ok(r.data.rewritten!.every(x => typeof x.updated_at === 'string'))
  const d = data.current()!
  assert.equal(d.sheets[0].content.cells!.A1.f, "='销售 表'!A1*2")
  assert.equal(d.sheets[1].content.cells!.B1.f, "='销售 表'!A1")
  assert.equal(d.sheets[2].content.cells!.A1.f, '="表格2!A1"', '字串里的不动')
  assert.equal(val(d.sheets.map(s => ({ name: s.name, content: s.content })), '表格1', 'A1'), 42, '改名后照算')
  // 同名：两张都叫 dup·引用指排最前那张（s1）·改 s2 的名 ⇒ 公式不动
  await sheetsFormat.save(store, { name: 'y', sheets: [
    { id: 'a', name: 'dup', content: cells({ A1: '1' }) }, { id: 'b', name: 'dup', content: cells({ A1: '2' }) }, { id: 'c', name: 'use', content: cells({ A1: '=dup!A1' }) },
  ] })
  const d2 = createGuestSheetsData({ store }); await d2.getDoc()
  const r2 = await d2.renameSheet('b', 'other')
  assert.ok(r2.ok && !(r2.data.rewritten ?? []).length)
  assert.equal(d2.current()!.sheets[2].content.cells!.A1.f, '=dup!A1')
})
t('改名：撤销栈前后两份都跟着换（撤回去不会指到旧名变 #REF!）', () => {
  let h = emptyHistory<SheetContent>()
  h = pushHistory(h, { sheetId: 's1', label: { k: 'edit' }, before: cells({ A1: '=表格2!A1' }), after: cells({ A1: '=表格2!A1+1' }) })
  h = mapHistory(h, c => renameSheetInContent(c, '表格2', 'X'))
  const u = undoSteps(h, 1)
  assert.equal(u.apply[0].content.cells!.A1.f, '=X!A1')
  assert.equal(u.state.redo[0].after.cells!.A1.f, '=X!A1+1')
})

// ── ⑤ 删表 ──
t('删表（游客版资料层）：删掉被引用的分页 ⇒ 引用它的公式 #REF!；再建同名的又接得上', async () => {
  const store = memStore()
  await sheetsFormat.save(store, { name: 'x', sheets: [{ id: 's1', name: '表格1', content: cells({ A1: '=表格2!A1', A2: '=SUM(表格2!A:A)' }) }, { id: 's2', name: '表格2', content: cells({ A1: '9' }) }] })
  const data = createGuestSheetsData({ store }); await data.getDoc()
  const book = () => data.current()!.sheets.map(s => ({ name: s.name, content: s.content }))
  assert.equal(val(book(), '表格1', 'A1'), 9)
  assert.ok((await data.deleteSheet('s2')).ok)
  assert.equal(val(book(), '表格1', 'A1'), '#REF!')
  assert.equal(val(book(), '表格1', 'A2'), '#REF!')
  assert.ok((await data.addSheet({ name: '表格2', prefix: '表格', content: cells({ A1: '4' }) })).ok)
  assert.equal(val(book(), '表格1', 'A1'), 4)
})

// ── 平移／插删行 ──
t('平移：填充往下拖 表格2!A1 ⇒ 表格2!A2（$ 不动）；插删本表行 ⇒ 跨表引用不动、本表的照动；单引号名里的字不被当格位', () => {
  assert.equal(shiftFormula('=表格2!A1+B1', 1, 0), '=表格2!A2+B2')
  assert.equal(shiftFormula("='销售 表'!$A$1+'Q1 x'!A1", 1, 0), "='销售 表'!$A$1+'Q1 x'!A2")
  assert.equal(shiftFormula('=SUM(表格2!A:A)', 0, 1), '=SUM(表格2!B:B)')
  assert.equal(shiftRefsForInsert("='Q1'!A5+A5", 'row', 1, 2).f, "='Q1'!A5+A7", "'Q1'!A5：Q1 是页签名·A5 是别张的格·都不动")
  assert.equal(shiftRefsForDelete("='A1 b'!A5+A5", 'row', 0, 1).f, "='A1 b'!A5+A4")
  const sp = scanRefs("=SUM('销售 表'!A1:B2)+'Q1'!C3")
  assert.deepEqual(sp.map(s => [s.sheet, s.a.row, s.a.col]), [['销售 表', 0, 0], ['Q1', 2, 2]])
})

// ── ⑦ xlsx 往返 ──
t('xlsx 汇出：公式里的页签名换成档里的表名（Excel 认得的写法）·指到不存在的页签整段写 #REF!·缓存值照整本算', () => {
  const bytes = buildXlsxBytes([
    { name: '表格1', content: cells({ A1: '=表格2!A1*2', A2: "=SUM('销售 表'!A1:A2)", A3: "='a[b]'!A1", A4: '=没这张!A1+1', A5: '=VLOOKUP(2,Data!A1:B2,2,FALSE)' }) },
    { name: '表格2', content: cells({ A1: '21' }) },
    { name: '销售 表', content: cells({ A1: '1', A2: '2' }) },
    { name: 'a[b]', content: cells({ A1: 'x' }) },
    { name: 'Data', content: cells({ A1: '1', B1: 'one', A2: '2', B2: 'two' }) },
  ])
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true })
  assert.deepEqual(wb.SheetNames, ['表格1', '表格2', '销售 表', 'a_b_', 'Data'])
  const ws = wb.Sheets['表格1']
  assert.equal(ws.A1.f, "'表格2'!A1*2"); assert.equal(ws.A1.v, 42)
  assert.equal(ws.A2.f, "SUM('销售 表'!A1:A2)"); assert.equal(ws.A2.v, 3)
  assert.equal(ws.A3.f, 'a_b_!A1'); assert.equal(ws.A3.v, 'x')
  assert.equal(ws.A4.f, '#REF!+1')
  assert.equal(ws.A5.f, 'VLOOKUP(2,Data!A1:B2,2,FALSE)'); assert.equal(ws.A5.v, 'two')
  // 页签名里像函数的字（'IFS (2)'）不补 _xlfn.（只给真函数补）
  assert.equal(toXlsxFormula("IFS('IFS (2)'!A1>0,1,TRUE,2)"), "_xlfn.IFS('IFS (2)'!A1>0,1,TRUE,2)")
})
t('xlsx 往返：汇出再汇入 ⇒ 跨表公式原样（含改过的表名）·值照算·算不出计数 0；汇入名字归一（连续空白）公式跟着换', () => {
  const src = [
    { name: '表格1', content: cells({ A1: '=表格2!A1*2', A2: "=SUM('销售 表'!A1:A2)" }) },
    { name: '表格2', content: cells({ A1: '21' }) },
    { name: '销售 表', content: cells({ A1: '1', A2: '2' }) },
  ]
  const back = parseXlsx(buildXlsxBytes(src))
  assert.equal(back.stats.formulas_not_computable, 0)
  assert.equal(back.sheets[0].content.cells!.A1.f, "='表格2'!A1*2")
  const book = back.sheets.map(s => ({ name: s.name, content: s.content }))
  assert.equal(val(book, '表格1', 'A1'), 42)
  assert.equal(val(book, '表格1', 'A2'), 3)
  // 汇入：Excel 表名「销售  表」（两个空白）⇒ 网页名「销售 表」·公式跟着换
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[5]]), '销售  表')
  const s1 = XLSX.utils.aoa_to_sheet([[0]]); s1.A1 = { t: 'n', f: "'销售  表'!A1+1" } as XLSX.CellObject
  XLSX.utils.book_append_sheet(wb, s1, 'Main')
  const imp = parseXlsx(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
  assert.deepEqual(imp.sheets.map(s => s.name), ['销售 表', 'Main'])
  assert.equal(imp.sheets[1].content.cells!.A1.f, "='销售 表'!A1+1")
  assert.equal(val(imp.sheets.map(s => ({ name: s.name, content: s.content })), 'Main', 'A1'), 6)
  assert.equal(imp.stats.formulas_not_computable, 0, '跨表公式算得出（整本读完才数）')
})
t('csv 汇出：带整本 ⇒ 跨表公式出值', () => {
  const book = [{ name: 'a', content: cells({ A1: '=b!A1+1' }) }, { name: 'b', content: cells({ A1: '1' }) }]
  assert.equal(sheetToCsv(book[0].content, { bom: false, eval: { book: new SheetBook(book), sheetName: 'a' } }), '2\r\n')
})
t('rewriteSheetRefs：整列跨表 / 区间第二端前缀一并收 / 非公式不动', () => {
  assert.equal(rewriteSheetRefs('=SUM(x!A:B)', () => ({ name: 'y z' })), "=SUM('y z'!A:B)")
  assert.equal(rewriteSheetRefs('=x!A1:x!B2', () => 'ref'), '=#REF!')
  assert.equal(rewriteSheetRefs('x!A1', () => ({ name: 'q' })), 'x!A1')
})
t('SheetEvaluator 直接带 book（AI 读表／排序那条）：跨表值算得出', () => {
  const book = new SheetBook([{ name: 'b', content: cells({ A1: '3' }) }])
  const ev = new SheetEvaluator(cells({ A1: '=b!A1*3' }).cells!, undefined, { book, sheetName: 'a' })
  assert.equal(ev.value('A1'), 9)
})

/** 记在记忆体里的工程（同 sheets.test.ts） */
function memStore(): ProjectStore {
  let json: string | null = null
  let mtime = 0, base = 0
  return {
    backend: 'opfs', label: '',
    async readJSON<T>(o?: { peek?: boolean }) { if (!o?.peek) base = mtime; return json === null ? null : JSON.parse(json) as T },
    async writeJSON(v) { json = JSON.stringify(v); mtime++; base = mtime },
    async changedOutside() { return mtime !== base },
    async writeJSONSafe(v, o) {
      if (!o?.force && mtime !== base) return { written: false as const, reason: 'changed-outside' as const, lastModified: mtime }
      json = JSON.stringify(v); mtime++; base = mtime
      return { written: true as const }
    },
    async lastModified() { return json === null ? null : mtime },
    async readAsset() { return null },
    async writeAsset() {},
    async listAssets() { return [] },
  } as unknown as ProjectStore
}

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('✓', name) } catch (e) { failed++; console.log('RED', name, '：', (e as Error).message) }
  }
  console.log(`crossref.test: passed=${passed} failed=${failed}`)
  if (failed) process.exitCode = 1
})()
