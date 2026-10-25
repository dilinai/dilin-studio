// 画板命令说明照版本说存在哪：登入版＝云端硬碟；游客版、单机版（没有云盘）⇒ 存进这份工程／浏览器下载，不提云端硬碟。
// （单机版 AI 读 paint_list_commands 看到「存进雲端硬碟」，以为档案跑到云盘去了）
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./paint/page/where.test.ts')"
// 负控：installCommands 不看 h.where ⇒ W1 红；DrawboardPage 不传 where ⇒ W2 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installCommands, type DlSite } from './drawboard-host'

let failed = 0
const ok = (n: string, f: () => void) => { try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
const IDS = ['file.saveProject', 'file.openProject', 'file.exportPNG', 'file.exportPNG2x']
function specs(where?: 'drive' | 'local'): Record<string, string> {
  const map: Record<string, { id: string; params?: string; run: unknown }> = {}
  const site = { doc: null, CMD: { map, reg: (id: string, m: { params?: string }, run: unknown) => { map[id] = { ...m, id, run } } } } as unknown as DlSite
  installCommands(site, { save: async () => ({ ok: true }), open: () => ({ ok: true }), exportPng: async () => ({ ok: true }), ...(where ? { where } : {}) })
  return Object.fromEntries(IDS.map((id) => [id, String(map[id]?.params ?? '')]))
}

ok('W1 local：四条命令说明都不提云端硬碟、说存进工程／下载；drive（与缺省）照旧说云端硬碟', () => {
  const l = specs('local')
  for (const id of IDS) assert.doesNotMatch(l[id], /雲端|云端|云盘/, `${id}: ${l[id]}`)
  assert.match(l['file.saveProject'], /工程/)
  assert.match(l['file.exportPNG'], /下載/)
  for (const s of [specs('drive'), specs()]) for (const id of ['file.saveProject', 'file.exportPNG', 'file.exportPNG2x']) assert.match(s[id], /雲端硬碟/, id)
})

ok('W2 DrawboardPage：没有建档（游客版、单机版）⇒ where local', () => {
  assert.match(readFileSync(join(__dirname, 'DrawboardPage.tsx'), 'utf8'), /where: h0\.api\.create \? 'drive' : 'local'/)
})

console.log(`${2 - failed}/2 passed`)
if (failed) process.exitCode = 1
