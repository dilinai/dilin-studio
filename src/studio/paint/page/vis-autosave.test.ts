// 画板「只切图层可见也要存」＋「自动存存成后分页名的「*」要消」（Windows 上的两处）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./paint/page/vis-autosave.test.ts')"
// 负控：watchDirty 拿掉包 CMD.run 那段 ⇒ V1 红；DrawboardPage onStatus 不叫 markEngineSaved ⇒ V3 红；markEngineSaved 不重画分页 ⇒ V2 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isVisibilityOnly, markEngineSaved, watchDirty, type DlSite } from './drawboard-host'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

function fakeSite(host = { on: true }) {
  const past: unknown[] = []
  const ran: string[] = []
  const site = {
    CMD: {
      map: {},
      reg() {},
      // 照引擎：layer.set 只带 visible ⇒ 不 push 历史；其余 undoable 的 push
      run(id: string, p: Record<string, unknown> = {}) {
        ran.push(id)
        if (id === 'fail.async') return Promise.resolve({ ok: false })
        if (id === 'layer.set' && p.id === 'locked') return { ok: false, error: 'locked' }
        if (!isVisibilityOnly(id, p)) site.History.push()
        return id === 'layer.set' && p.id === 'slow' ? Promise.resolve({ ok: true }) : { ok: true }
      },
    },
    History: { past, push() { past.push(1) }, undo() { return true }, redo() { return true }, clear() { past.length = 0 } },
    isHostActive: () => host.on,
  } as unknown as DlSite
  return { site, ran }
}

ok('V1 只切图层可见（layer.set {id, visible}）也报改动；被锁挡下不报；暂存页不报；带别的栏位照走历史那条（不重报）；包一次就好', async () => {
  const host = { on: true }
  const { site } = fakeSite(host)
  let n = 0
  watchDirty(site, () => { n++ }); watchDirty(site, () => { n += 100 })
  site.CMD.run('layer.set', { id: 'L1', visible: false })
  assert.equal(n, 1, '点眼睛 ⇒ 算改过（自动存会排）')
  site.CMD.run('layer.set', { id: 'L1', visible: true, opacity: 0.5 })
  assert.equal(n, 2, '带 opacity ⇒ 进历史那条报一次·⛔ 再多报')
  site.CMD.run('layer.set', { id: 'locked', visible: false })
  assert.equal(n, 2, '被图层锁挡下（ok:false）⇒ 没改·不报')
  await site.CMD.run('layer.set', { id: 'slow', visible: false })
  await Promise.resolve()
  assert.equal(n, 3, '命令回 Promise ⇒ 落定后报')
  host.on = false
  site.CMD.run('layer.set', { id: 'L1', visible: true })
  assert.equal(n, 3, '暂存分页在前面 ⇒ 不报（同包 History 那条）')
  assert.equal(isVisibilityOnly('layer.set', { visible: true }), true)
  assert.equal(isVisibilityOnly('layer.set', { id: 'x', name: 'y' }), false)
  assert.equal(isVisibilityOnly('layer.visible', { id: 'x', visible: true }), false)
})

ok('V2 markEngineSaved：标画板「存过」并排一次分页列重画；画板没起好／已卸不抛', () => {
  const calls: string[] = []
  const site = { doc: { defaultView: { PsFile: { markSaved: () => calls.push('mark') }, Docs: { _schedule: () => calls.push('redraw') } } } } as unknown as DlSite
  markEngineSaved(site)
  assert.deepEqual(calls, ['mark', 'redraw'])
  markEngineSaved(null)
  markEngineSaved({ doc: { defaultView: null } } as unknown as DlSite)
})

ok('V3 页面接线：自动存回「saved」且前面这份没再改 ⇒ markEngineSaved；改动照旧走 watchDirty', () => {
  const page = readFileSync(join(__dirname, 'DrawboardPage.tsx'), 'utf8')
  assert.match(page, /onStatus: \(st: AutosaveStatus, err\?: ApiErr\) => \{\n\s+hostRef\.current\.saveState\?\.\(st, cloud\.dirty\)\n(\s+\/\/[^\n]*\n)?\s+if \(st === 'saved' && !cloud\.current\(\)\?\.auto\.dirty\) markEngineSaved\(siteRef\.current\)/)
  assert.match(page, /watchDirty\(s, \(\) => handlers\.current\.cloud\.change\(\)\)/)
})

;(async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', e instanceof Error ? e.stack?.split('\n').slice(0, 4).join('\n  ') : e) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
