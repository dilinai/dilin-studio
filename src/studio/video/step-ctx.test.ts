// 一步一步改（不一次整份换掉）：剪辑工程档那行叫角色用 video_edit_run 一次一两步地改·整份写回只留给命令做不到的；头仍认得出档号。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/step-ctx.test.ts')"
// 负控：projectCtxLine 改回「update_video_edit 整份写回」⇒ C1 红。
import assert from 'node:assert/strict'
import { parseProjectCtxLine, projectCtxLine } from './lib/project.pure'

const ID = '11111111-2222-4333-8444-555555555555'
const STEP = { 'zh-TW': '一次一兩步地改', 'zh-CN': '一次一两步地改', en: 'one or two steps per call' } as const
for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
  const l = projectCtxLine(lang, ID, 'T')
  assert.ok(l.includes('video_edit_run') && l.includes(STEP[lang]), `C1 ${lang} 点名逐条命令`)
  assert.ok(l.indexOf('video_edit_run') < l.indexOf('update_video_edit'), `C1 ${lang} 逐条在前、整份写回在后`)
  assert.equal(parseProjectCtxLine(l), ID, `C1 ${lang} 头照旧认得出档号`)
}
console.log('  ✓ C1 剪辑工程档那行：video_edit_run 一次一两步·整份写回只当退路·档号照认（三语）')
console.log('step-ctx: 1 passed')
