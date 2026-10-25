// 单机版：AI 经本机 MCP 接到第一件活起，右栏「先选存放位置」挡板就收起（AI 在画、页面还挡着要位置不合理）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./shared/agent-gate.test.ts')"
// 负控：agent-link 不叫 markAgentActive ⇒ G1 红；FolderGate 不看 agent ⇒ G2 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentLinkActive, resetAgentActive, startAgentLink, subscribeAgentActive } from './agent-link'
import { gatePassKey } from './ai-panel.pure'

let failed = 0
const tests: Array<[string, () => Promise<void> | void]> = []
const ok = (n: string, f: () => Promise<void> | void) => tests.push([n, f])

ok('G1 接到第一件活 ⇒ agentLinkActive 变 true、订阅的被叫到；没接到活之前是 false', async () => {
  resetAgentActive()
  let calls = 0
  const off = subscribeAgentActive(() => { calls++ })
  let served = false
  const fake = (async (url: string) => {
    const u = String(url)
    if (u.includes('/_agent/hello')) return new Response(JSON.stringify({ name: 'dilin-studio-agent' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (u.includes('/_agent/poll')) {
      if (served) { await new Promise((r) => setTimeout(r, 50)); return new Response('', { status: 204 }) }
      served = true
      return new Response(JSON.stringify({ id: 'j1', kind: 'read' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  assert.equal(agentLinkActive(), false)
  const stop = startAgentLink({ editor: 'docs', project: () => ({ id: 'p1' }), handle: async () => ({ ok: true, result: 1 }), fetch: fake, retryMs: 10 })
  for (let i = 0; i < 50 && !agentLinkActive(); i++) await new Promise((r) => setTimeout(r, 10))
  stop(); off()
  assert.equal(agentLinkActive(), true)
  assert.equal(calls, 1)
})

ok('G2 FolderGate：agent 动手后整个不画、按键也不弹', () => {
  const s = readFileSync(join(__dirname, 'ui/AIPanel.tsx'), 'utf8')
  assert.match(s, /const agent = useSyncExternalStore\(subscribeAgentActive, agentLinkActive, \(\) => false\)/)
  assert.match(s, /if \(!mounted \|\| other \|\| agent\) return null/)
  assert.match(s, /if \(currentDialog\(\) \|\| agentLinkActive\(\)\) return/)
})

ok('G3 挡板放行重新整理与开发者工具键（F5、Ctrl／⌘+R、F12、Ctrl+Shift+I、⌘⌥I）；一般字键照挡', () => {
  for (const k of [{ key: 'F5' }, { key: 'r', ctrlKey: true }, { key: 'R', metaKey: true }, { key: 'F12' }, { key: 'I', ctrlKey: true, shiftKey: true }, { key: 'i', metaKey: true, altKey: true }, { key: 'ˆ', code: 'KeyI', metaKey: true, altKey: true }]) assert.equal(gatePassKey(k), true, JSON.stringify(k))
  for (const k of [{ key: 'r' }, { key: 'a', ctrlKey: true }, { key: 'Enter' }]) assert.equal(gatePassKey(k), false, JSON.stringify(k))
  assert.match(readFileSync(join(__dirname, 'ui/AIPanel.tsx'), 'utf8'), /if \(gatePassKey\(e\)\) return/)
})

;(async () => {
  for (const [n, f] of tests) { try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
