// 剪辑比例：FORMAT.md 与 project.pure.ts（给 AI 的工程格式说明）写到的 preset 键，必须都在 ratio.pure.ts 的 RATIO_PRESETS 里；
// 而且 RATIO_PRESETS 每个键说明里都有。文档写了程式没有的键（例如曾写的 21:9）⇒ AI 照填会被默默当成「适应」。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/ratio-doc.test.ts')"
// 负控：FORMAT.md 加回 "21:9" ⇒ R1 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RATIO_PRESETS } from './lib/ratio.pure'

const keys = Object.keys(RATIO_PRESETS)
const docKeys = (s: string) => [...s.matchAll(/"?kind"?:\s*"?preset"?,\s*"?key"?:?\s*([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))
let failed = 0
const ok = (n: string, f: () => void) => { try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
ok('R1 说明写的比例键＝程式有的比例键（FORMAT.md 与 project.pure.ts 两份）', () => {
  for (const f of ['FORMAT.md', 'lib/project.pure.ts']) {
    const got = docKeys(readFileSync(join(__dirname, f), 'utf8').replace(/\\\|/g, '|'))
    assert.ok(got.length, `${f}: 没找到比例清单`)
    for (const k of got) assert.ok(keys.includes(k), `${f}: 写了程式没有的比例 ${k}`)
    for (const k of keys) assert.ok(got.includes(k), `${f}: 漏写比例 ${k}`)
  }
})
console.log(`${1 - failed}/1 passed`)
if (failed) process.exitCode = 1
