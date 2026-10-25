// 游客剪辑字典题：编辑器码里写死的每个键三语都有（游客版没有网站字典可退）、陆版简中不出现境外服务名。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/i18n.test.ts')"
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { VIDEO_I18N } from './i18n'
import { STUDIO_SHARED_I18N, missingKeys } from '../shared/i18n'
import type { StudioDict } from '../shared/types'

const files: string[] = []
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f) && f !== 'i18n.ts') files.push(p) } }
walk(__dirname)

/** 码里 t('键') 用到、却不在字典里的键（纯函式·药也喂这里） */
export function missingUsed(srcs: readonly string[], dicts: readonly StudioDict[]): string[] {
  const out = new Set<string>()
  for (const s of srcs) for (const m of s.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9_]*)'/g)) {
    if (!dicts.some((d) => (['zh-TW', 'zh-CN', 'en'] as const).every((l) => typeof (d[l] as Record<string, string>)[m[1]] === 'string'))) out.add(m[1])
  }
  return [...out].sort()
}

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 8).join('\n   ')) }
}

test('A 编辑器码里 t(\'…\') 用到的键：三语都查得到', () => {
  const srcs = files.map((f) => readFileSync(f, 'utf8'))
  assert.ok(srcs.join('').includes("t('vedit_"), '扫不到任何 t(\'vedit_…\')·题本身坏了')
  assert.deepEqual(missingUsed(srcs, [STUDIO_SHARED_I18N, VIDEO_I18N]), [])
})

test('B 药：码里多一个字典没有的键 ⇒ 红', () => {
  assert.deepEqual(missingUsed(["t('vedit_no_such_key_x')"], [VIDEO_I18N]), ['vedit_no_such_key_x'])
})

test('C 三语键一样多（简中、英文不缺）', () => {
  assert.deepEqual(missingKeys(VIDEO_I18N), [])
  assert.ok(Object.keys(VIDEO_I18N['zh-TW']).length > 300)
})

test('D 陆版简中不出现境外服务名', () => {
  const hit = Object.entries(VIDEO_I18N['zh-CN']).filter(([, v]) => /Google|YouTube|ChatGPT|OpenAI|Claude|Gemini|Instagram|Facebook|TikTok/i.test(v))
  assert.deepEqual(hit, [])
})

console.log(bad ? `studio-video i18n：${n}/${n + bad} 过` : `studio-video i18n → ${n} 过`)
if (bad) process.exit(1)
