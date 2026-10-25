// 一步一步改（不一次整份换掉）：给 AI 的说明叫它一步一步写回（编辑页说明与 /s/<码> 页说明·三语·五编辑器）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./shared/step-brief.test.ts')"
// 负控：shareParas 拿掉 studio_brief_step ⇒ B1 红。
import assert from 'node:assert/strict'
import { studioAIBrief, studioShareBrief } from './ai-brief'

const STEP = { 'zh-TW': '每改好一小處', 'zh-CN': '每改好一小处', en: 'after each small change' } as const
let n = 0
for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
  for (const app of ['docs', 'sheets', 'slides', 'video', 'paint'] as const) {
    const b = studioAIBrief(app, lang, lang === 'zh-CN', 'x').join('\n')
    assert.ok(b.includes(STEP[lang]), `B1 ${lang}/${app} 编辑页说明带一步一写`)
  }
  const s = studioShareBrief('abc123', lang).join('\n')
  assert.ok(s.includes(STEP[lang]), `B1 ${lang} /s 页说明带一步一写`)
  n++
}
console.log(`  ✓ B1 三语五编辑器＋/s 页说明都叫 AI 一步一步写回（${n} 语）`)
console.log('step-brief: 1 passed')
