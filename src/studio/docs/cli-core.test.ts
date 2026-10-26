// 文件命令列版核心（cli-core.ts·tools/docs-cli.mjs 用）：读档报告、改正文全有或全无、写回再读 0 问题、Markdown 汇出。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./docs/cli-core.test.ts')"
// 药：DILIN_NEG=docs-cli-check-blind ⇒ D1 红（读档报告不列坏 paper／坏组件）；DILIN_NEG=docs-cli-run-partial ⇒ D2 红（错一步仍留着前面的改动）。
import assert from 'node:assert/strict'
import { BROWSER_EXPORT_FORMATS, CLI_EXPORT_FORMATS, cliCommands, cliExportMd, cliLoad, cliRead, cliRun, cliSave } from './cli-core'

let failed = 0, n = 0
const ok = (name: string, f: () => void) => { n++; try { f(); console.log('✓', name) } catch (e) { failed++; console.log('✗', name, '\n ', (e as Error).message) } }
const proj = {
  format: 'dilin-studio/docs', version: 2, name: '旅行筆記',
  paper: { paper: 'a4-portrait', marginsMm: { top: 25.4, bottom: 25.4, left: 31.7, right: 31.7 }, pageNumbers: true },
  content: ['# 旅行筆記', '', '第一天：抵達港口。', '', '![港口](assets/harbour.png)'],
  layers: { v: 1, unit: 'mm', items: [
    { id: 'box1', kind: 'text', page: 1, x: 120, y: 30, w: 60, h: 25, text: { md: '**註**' } },
    { id: 'pic1', kind: 'image', page: 1, x: 20, y: 200, w: 80, h: 50, src: 'assets/side.jpg' },
  ] },
}

ok('D1 check：好档 0 条；坏 paper、坏组件、重复 id 各一条；表头不对丢错；素材引用列得出来', () => {
  const good = cliLoad(JSON.stringify(proj))
  assert.deepEqual(good.issues, [])
  assert.deepEqual(good.assets, ['harbour.png', 'side.jpg'])
  const bad = cliLoad({ ...proj, paper: { paper: 'letter' }, layers: { items: [...proj.layers.items, { id: 'x', kind: 'nope', page: 1, x: 0, y: 0, w: 10, h: 10 }, { ...proj.layers.items[0] }] } })
  assert.deepEqual(bad.issues.map((x) => x.code).sort(), ['layer_dropped', 'layer_dup', 'paper_bad'])
  assert.equal(bad.doc.paper.paper, null)
  assert.throws(() => cliLoad({ ...proj, format: 'dilin-studio/slides' }))
  assert.throws(() => cliLoad({ ...proj, content: [1, 2] }))
})

ok('D2 run：接在最后＋换唯一一段＋改名，写回再读 0 问题；错一步（找不到）全不动', () => {
  const { doc } = cliLoad(proj)
  const r = cliRun(doc, [{ append: '## 第二天' }, { old_text: '抵達港口', new_text: '抵達北港' }, { name: '北港之旅' }])
  assert.ok(r.ok, !r.ok ? r.error : '')
  if (!r.ok) return
  assert.equal(r.changed, true)
  const back = cliLoad(cliSave(r.doc))
  assert.deepEqual(back.issues, [])
  assert.equal(back.doc.name, '北港之旅')
  assert.match(back.doc.content, /抵達北港。[\s\S]*## 第二天$/)
  assert.equal(back.doc.layers?.items.length, 2, '自由组件原样留着')
  const bad = cliRun(doc, [{ append: '不該留下' }, { old_text: '沒有這句', new_text: 'x' }])
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /Edit 1: old_text was not found[\s\S]*Nothing was changed/)
  assert.equal(cliRun(doc, [{ old_text: '\n', new_text: '' }]).ok, false, '不唯一要拒')
  assert.equal(cliRun(doc, [{ bogus: 1 }]).ok, false)
})

ok('D3 read／commands／export md：正文原文、纸张设定、三种步骤；md 不带自由组件且照实说', () => {
  const { doc } = cliLoad(proj)
  const r = cliRead(doc) as { content: string; paper: { paper: string }; layers: number }
  assert.equal(r.content, proj.content.join('\n')); assert.equal(r.paper.paper, 'a4-portrait'); assert.equal(r.layers, 2)
  assert.deepEqual(cliCommands().map((c) => c.id), ['append', 'replace', 'rename'])
  assert.deepEqual(cliCommands('old_text').map((c) => c.id), ['replace'])
  const md = cliExportMd(doc)
  assert.equal(md.name, '旅行筆記.md'); assert.equal(md.text, proj.content.join('\n')); assert.equal(md.notes.length, 1)
  assert.deepEqual([...CLI_EXPORT_FORMATS], ['md', 'docx', 'pdf']); assert.deepEqual([...BROWSER_EXPORT_FORMATS], ['docx', 'pdf'])
})

console.log(`${n - failed}/${n} passed`)
if (failed) process.exitCode = 1
