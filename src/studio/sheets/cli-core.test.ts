// 表格命令列版核心（cli-core.ts·tools/sheets-cli.mjs 用）：读档报告、读格算公式（含跨表）、改格写回、全有或全无、xlsx／csv 汇出汇入往返。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./sheets/cli-core.test.ts')"
// 负控（DILIN_NEG=<处名> 再跑·对应题必红）：sheets_cli_silent_check ⇒ S1；sheets_cli_no_book ⇒ S2；sheets_cli_partial_run ⇒ S3。
import assert from 'node:assert/strict'
import { cliCommands, cliExport, cliGet, cliImport, cliLoad, cliRun, cliSave } from './cli-core'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

// FORMAT.md 的最小范例＋第二张表跨表引用
const proj = {
  format: 'dilin-studio/sheets', version: 1, name: '月報',
  sheets: [
    { id: 's1', name: 'Sheet1', content: {
      cells: {
        A1: { v: '品項', s: { b: true, bg: '#f3f4f6' } }, B1: { v: '金額', s: { b: true, bg: '#f3f4f6' } },
        A2: { v: '房租' }, B2: { v: '12000' },
        A3: { v: '水電' }, B3: { v: '1850.5' },
        A4: { v: '合計' }, B4: { v: '', f: '=SUM(B2:B3)', s: { numFmt: { t: 'number', d: 2, k: true } } },
      },
      colWidths: { A: 140 },
    } },
    { id: 's2', name: '彙總', content: { cells: { A1: { v: '', f: '=Sheet1!B4*2' }, A2: { v: '', f: '=A1/0' } } } },
  ],
}
const cellsOf = (r: { ok: boolean }) => { assert.ok(r.ok, JSON.stringify(r)); return (r as unknown as { result: { cells: Array<{ cell: string; input: string; value: unknown; display: string }> } }).result.cells }
const at = (cells: ReturnType<typeof cellsOf>, k: string) => cells.find((c) => c.cell === k)

ok('S1 check：范例 0 条；坏格名、v 不是字串、坏颜色、认不得的键、重复 id、名字带空白都列出来；表头错整份拒', () => {
  assert.deepEqual(cliLoad(JSON.stringify(proj)).issues, [])
  const bad = JSON.parse(JSON.stringify(proj))
  bad.sheets[0].content.cells.a9 = { v: 'x' }
  bad.sheets[0].content.cells.C1 = { v: 12 }
  bad.sheets[0].content.cells.C2 = { v: 'ok', s: { bg: 'not-a-color', size: 'big' } }
  bad.sheets[0].content.cells.C3 = { v: 'ok', note: 'x' }
  bad.sheets[0].content.wat = 1
  bad.sheets[1].id = 's1'
  bad.sheets[1].name = '  彙  總 '
  const { doc, issues } = cliLoad(bad)
  const codes = issues.map((x) => x.code).sort()
  assert.deepEqual(codes, ['cell_bad_key', 'cell_changed', 'cell_dropped', 'cell_key_dropped', 'content_key_dropped', 'sheet_dup_id', 'sheet_name_changed'])
  assert.ok(issues.every((x) => x.text.length > 6))
  assert.equal(doc.sheets[1].name, '彙 總')
  assert.notEqual(doc.sheets[1].id, 's1')
  assert.throws(() => cliLoad({ ...proj, format: 'dilin-studio/video' }))
  assert.throws(() => cliLoad({ ...proj, version: 99 }))
})

ok('S2 get：公式算好（input／value／display）、跨表引用算得出、错误码照回、range／sheet 选得到', () => {
  const { doc } = cliLoad(proj)
  const c = cellsOf(cliGet(doc))
  assert.deepEqual(at(c, 'B4'), { cell: 'B4', input: '=SUM(B2:B3)', value: 13850.5, display: '13,850.50' })
  assert.equal(at(c, 'A1')!.display, '品項')
  const two = cellsOf(cliGet(doc, { sheet: '彙總' }))
  assert.equal(at(two, 'A1')!.value, 27701)
  assert.equal(at(two, 'A2')!.value, '#DIV/0!')
  assert.deepEqual(cellsOf(cliGet(doc, { range: 'B2:B3' })).map((x) => x.cell), ['B2', 'B3'])
  assert.equal(cellsOf(cliGet(doc, { range: "'彙總'!A1" }))[0].value, 27701)
  const miss = cliGet(doc, { sheet: '沒有這張' })
  assert.ok(!miss.ok && /no sheet named/.test(miss.error))
  assert.ok(!cliGet(doc, { range: 'nope' }).ok)
})

ok('S3 set／run：写公式重算、写回再读 0 问题；跨表多步一次成；错一步全不动（指出 steps[i]）；add_image 要网站', () => {
  const { doc } = cliLoad(proj)
  const r = cliRun(doc, [{ op: 'set', range: 'A5', values: [['網路', 999], ['總計', '=B4+B5']] }])
  assert.ok(r.ok, JSON.stringify(r))
  const back = cliLoad(cliSave(r.doc))
  assert.deepEqual(back.issues, [])
  assert.equal(at(cellsOf(cliGet(back.doc, { range: 'B6' })), 'B6')!.value, 14849.5)
  assert.equal(at(cellsOf(cliGet(back.doc, { sheet: '彙總' })), 'A1')!.value, 27701)   // 别张没动
  const multi = cliRun(doc, [
    { op: 'set', range: 'B2', values: [[10000]] },
    { op: 'format', range: 'A1:B1', style: { bold: true, bg: '#fff3bf' } },
    { sheet: '彙總', op: 'set', range: 'B1', values: [['=A1+1']] },
    { op: 'set', range: 'Sheet1!C1', values: [['備註']] },
  ])
  assert.ok(multi.ok, JSON.stringify(multi))
  assert.equal(multi.results.length, 4)
  assert.equal(at(cellsOf(cliGet(multi.doc, { sheet: '彙總' })), 'B1')!.value, 23702)
  assert.equal(at(cellsOf(cliGet(multi.doc)), 'C1')!.value, '備註')
  const bad = cliRun(doc, [{ op: 'set', range: 'B2', values: [[1]] }, { sheet: '彙總', op: 'set', range: 'A9', values: [['x']] }, { sheet: '彙總', op: 'merge', range: 'zz' }])
  assert.equal(bad.ok, false)
  assert.match((bad as { error: string }).error, /steps\[2\]/)
  assert.match((bad as { error: string }).error, /Nothing was changed/)
  assert.equal(doc.sheets[0].content.cells!.B2.v, '12000')
  const img = cliRun(doc, [{ op: 'add_image', cell: 'A1', url: 'assets/y.png', w: 10, h: 10 }])
  assert.ok(!img.ok && /website/.test(img.error))
  assert.ok(!cliRun(doc, [{ sheet: '沒有', op: 'set', range: 'A1', values: [[1]] }]).ok)
})

ok('S4 export／import：xlsx 往返值与公式都对；csv 是画面上看到的值；csv 汇入成工程', async () => {
  const { doc } = cliLoad(proj)
  const x = await cliExport(doc, 'xlsx')
  assert.ok(x.ok)
  if (!x.ok) return
  assert.equal(x.file.name, '月報.xlsx')
  assert.deepEqual([...x.file.bytes.slice(0, 2)], [0x50, 0x4b])
  const im = cliImport(x.file.bytes, x.file.name)
  assert.ok(im.ok, JSON.stringify(im))
  if (!im.ok) return
  const re = cliLoad(im.json)
  assert.deepEqual(re.issues, [])
  assert.deepEqual(re.doc.sheets.map((t) => t.name), ['Sheet1', '彙總'])
  const b4 = at(cellsOf(cliGet(re.doc)), 'B4')!
  assert.equal(b4.input, '=SUM(B2:B3)'); assert.equal(b4.value, 13850.5); assert.equal(b4.display, '13,850.50')
  assert.equal(at(cellsOf(cliGet(re.doc, { sheet: '彙總' })), 'A1')!.value, 27701)
  const c = await cliExport(doc, 'csv')
  assert.ok(c.ok)
  if (!c.ok) return
  assert.equal(c.file.name, '月報-Sheet1.csv')
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(c.file.bytes)
  assert.ok(text.startsWith('﻿品項,金額'))
  assert.match(text, /合計,"13,850\.50"/)
  assert.ok(c.notes.length === 1)
  const cs = cliImport(new TextEncoder().encode('品項,數量\r\n蘋果,3\r\n梨,4\r\n'), 'fruit.csv')
  assert.ok(cs.ok)
  if (!cs.ok) return
  assert.equal(cs.name, 'fruit')
  const got = cliLoad(cs.json)
  assert.equal(at(cellsOf(cliGet(got.doc)), 'B3')!.value, 4)
  assert.ok(!cliImport(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'bad.xlsx').ok)
})

ok('S5 commands：每个 op 都有说明；可直接跑的例子都跑得过', () => {
  const all = cliCommands()
  assert.ok(all.length >= 19 && all.every((c) => c.description))
  assert.deepEqual(cliCommands('freeze').map((c) => c.op), ['freeze'])
  const { doc } = cliLoad(proj)
  for (const c of all) {
    if (!Object.keys(c.example).length || JSON.stringify(c.example).includes('<')) continue
    const r = cliRun(doc, [c.example])
    assert.ok(r.ok, `${c.op}: ${JSON.stringify(r)}`)
  }
})

;(async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
