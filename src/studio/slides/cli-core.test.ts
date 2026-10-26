// 简报命令列版核心（cli-core.ts·tools/slides-cli.mjs 用）：读档报告、操作全有或全无、写回再读 0 问题、读页与元件、命令表。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./slides/cli-core.test.ts')"
// 药：DILIN_NEG=slides-cli-check-blind ⇒ S1 红（读档报告不列丢掉的元件、改成空白页的页）；DILIN_NEG=slides-cli-run-partial ⇒ S2 红（错一步仍留着前面的改动）。
import assert from 'node:assert/strict'
import { CLI_COMMANDS, CLI_EXPORT_FORMATS, cliCommands, cliLoad, cliRead, cliRun, cliSave } from './cli-core'
import { SLIDES_OP_KINDS } from './agent-job.pure'

let failed = 0, n = 0
const ok = (name: string, f: () => void) => { n++; try { f(); console.log('✓', name) } catch (e) { failed++; console.log('✗', name, '\n ', (e as Error).message) } }
const text = (id: string, s: string, y = 220) => ({ id, type: 'text', frame: { x: 80, y, w: 840, h: 120, rotate: 0 }, paragraphs: [{ runs: [{ text: s }], align: 'center' }], box: { font: 'theme:heading', size: 54, color: 'theme:text', align: 'center', valign: 'middle', lineHeight: 1.2, padding: 4 } })
const blank = (pid: string, components: unknown[], extra: Record<string, unknown> = {}) => ({ pid, layoutId: 'blank', draft: { type: 'content', title: '', items: [] }, background: { color: '#FFFFFF' }, components, ...extra })
const proj = {
  format: 'dilin-studio/slides', version: 1, name: '季報',
  deck: { version: 2, lang: 'zh-TW', themeId: 'forest-moss', pages: [
    blank('p0000001', [text('c_title', '第三季報告'), { id: 'c_pic', type: 'image', frame: { x: 700, y: 20, w: 200, h: 120, rotate: 0 }, src: 'assets/logo.png', fit: 'contain' }]),
    blank('p0000002', [text('c_body', '營收成長 12%', 100)]),
  ] },
}

ok('S1 check：好档 0 条＋素材引用；坏元件丢掉、版式页型对不上改空白页各列一条；deck 坏到开不了丢错', () => {
  const good = cliLoad(JSON.stringify(proj))
  assert.deepEqual(good.issues, [])
  assert.deepEqual(good.assets, ['logo.png'])
  const pages = JSON.parse(JSON.stringify(proj.deck.pages))
  pages[1].components.push({ id: 'c_bad', type: 'hologram', frame: { x: 0, y: 0, w: 10, h: 10, rotate: 0 } })
  pages[0].draft = { type: 'cover', title: '季報', subtitle: '' }
  const bad = cliLoad({ ...proj, deck: { ...proj.deck, pages } })
  assert.deepEqual(bad.issues.map((x) => x.code).sort(), ['dropped', 'page_to_blank'])
  assert.ok(bad.issues.every((x) => /page \d/.test(x.text)))
  assert.throws(() => cliLoad({ ...proj, deck: { pages: 'x' } }))
  assert.throws(() => cliLoad({ ...proj, format: 'dilin-studio/docs' }))
})

ok('S2 run：改字＋移框＋加页＋在新页加元件，写回再读 0 问题；错一步全不动', () => {
  const { doc } = cliLoad(proj)
  const r = cliRun(doc, [
    { kind: 'component_update', componentId: 'c_title', patch: { text: '第四季報告' } },
    { kind: 'component_frame', componentId: 'c_title', frame: { y: 60 } },
    { kind: 'page_add', afterIndex: 1, pageKind: 'blank' },
    { kind: 'component_add', pageIndex: 2, component: { type: 'text', text: '謝謝', frame: { x: 100, y: 200, w: 800, h: 100 } } },
  ])
  assert.ok(r.ok, !r.ok ? r.error : '')
  if (!r.ok) return
  const back = cliLoad(cliSave(r.doc))
  assert.deepEqual(back.issues, [])
  assert.equal(back.doc.deck.pages.length, 3)
  const t = back.doc.deck.pages[0].components!.find((c) => c.id === 'c_title') as unknown as { frame: { y: number }; paragraphs: { runs: { text: string }[] }[] }
  assert.equal(t.frame.y, 60); assert.equal(t.paragraphs[0].runs[0].text, '第四季報告')
  assert.ok(JSON.stringify(back.doc.deck.pages[2].components).includes('謝謝'))
  const bad = cliRun(doc, [{ kind: 'page_add', afterIndex: 0, pageKind: 'blank' }, { kind: 'component_delete', componentId: 'no_such' }])
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /ops\[1\][\s\S]*Nothing was changed/)
  assert.equal(cliRun(doc, [{ kind: 'nope' }]).ok, false)
})

ok('S3 read／commands：页清单与单页元件（含 z）；命令表跟 slides_run 认得的操作一一对上；汇出格式只有 html、pptx', () => {
  const { doc } = cliLoad(proj)
  const all = cliRead(doc) as { page_count: number; pages: { page_id: string }[] }
  assert.equal(all.page_count, 2); assert.equal(all.pages[1].page_id, 'p0000002')
  const one = cliRead(doc, 1) as { page: { components: { id: string; z: number }[] } }
  assert.deepEqual(one.page.components.map((c) => [c.id, c.z]), [['c_title', 0], ['c_pic', 1]])
  assert.equal((cliRead(doc, 9) as { ok: boolean }).ok, false)
  assert.deepEqual(CLI_COMMANDS.map((c) => c.id).sort(), [...SLIDES_OP_KINDS].sort())
  assert.ok(cliCommands('page').length >= 5)
  assert.deepEqual([...CLI_EXPORT_FORMATS], ['html', 'pptx'])
})

console.log(`${n - failed}/${n} passed`)
if (failed) process.exitCode = 1
