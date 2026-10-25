// 剪辑命令列版核心（cli-core.ts·tools/video-cli.mjs 用）：读档报告、跑命令写回、全有或全无、要网站的照拒、汇出 FCPXML／剪映。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/cli-core.test.ts')"
// 负控：cliRun 不挡 WEBSITE_ONLY ⇒ V2 红；cliLoad 不回 issues ⇒ V1 红。
import assert from 'node:assert/strict'
import { cliCommands, cliExport, cliLoad, cliRun, cliSave } from './cli-core'

let failed = 0
const ok = (n: string, f: () => void) => { try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
const lane = (id: string, kind: string, clips: unknown[]) => ({ id, kind, locked: false, hidden: false, muted: false, clips })
const proj = {
  format: 'dilin-studio/video', version: 1, name: '观木者', ratio: '21:9',
  media: [{ id: 'm1', name: 'a.mp4', kind: 'video', duration: 12, file: 'a.mp4' }],
  tracks: [lane('main', 'visual', [
    { id: 'c1', mediaId: 'm1', start: 0, length: 4, offset: 0 },
    { id: 'c2', mediaId: 'm1', start: 4, length: 3, offset: 4, transIn: { tr: 'tr-fade', length: 0.8 } },
  ])],
  programs: {},
}

ok('V1 check：读档报告列出比例认不得、转场 id 不存在', () => {
  const { issues } = cliLoad(JSON.stringify(proj))
  assert.deepEqual(issues.map((x) => x.code).sort(), ['ratio_unknown', 'ref_unknown'])
  assert.ok(issues.every((x) => x.text.length > 4))
  assert.throws(() => cliLoad({ ...proj, format: 'dilin-studio/paint' }))
})

ok('V2 run：加字幕、改比例，写回的 project.json 再读 0 问题；错一步全不动；配音要网站', () => {
  const { doc } = cliLoad(proj)
  const r = cliRun(doc, [{ command: 'text.add', params: { content: '观木者', at: 0.5, length: 3 } }, { command: 'project.setRatio', params: { ratio: '16:9' } }] as never)
  if (!r.ok) {
    // 比例命令名以命令表为准
    const ids = cliCommands('ratio').map((c) => c.id)
    assert.fail(`${r.error} · ratio 命令：${ids.join(',')}`)
  }
  const back = cliLoad(cliSave(r.doc))
  assert.deepEqual(back.issues, [])
  assert.ok(back.doc.tracks.some((l) => l.clips.some((c) => c.text?.content === '观木者')))
  const bad = cliRun(doc, [{ command: 'text.add', params: { content: 'x', at: 0 } }, { command: 'nope.cmd', params: {} }] as never)
  assert.equal(bad.ok, false)
  const web = cliRun(doc, [{ command: 'media.tts', params: {} }] as never)
  assert.ok(!web.ok && /needs the website/.test(web.error))
})

ok('V3 export：FCPXML 一份、剪映草稿两份；命令表有内容', () => {
  const { doc } = cliLoad(proj)
  const x = cliExport(doc, 'fcpxml')
  assert.equal(x.files.length, 1); assert.match(x.files[0].text, /<fcpxml version="1\.10">/)
  const j = cliExport(doc, 'jianying', { mediaRoot: '/tmp/a' })
  assert.deepEqual(j.files.map((f) => f.name), ['draft_content.json', 'draft_meta_info.json'])
  assert.ok(cliCommands().length > 20)
})

console.log(`${3 - failed}/3 passed`)
if (failed) process.exitCode = 1
