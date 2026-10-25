// 剪辑读档：片段指到库里没有的转场／特效／动画／贴纸／滤镜，要列进读档报告（以前默默拿掉、报告 0 条）；
// FORMAT.md 的范例与转场清单要跟 lib/fx.data.ts 对得上（范例曾写不存在的 tr-fade）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/ref-unknown.test.ts')"
// 负控：project.pure.ts 拿掉 transIn 那行 drop ⇒ U1 红；FORMAT.md 范例改回 tr-fade ⇒ U2 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseProjectIssues } from './lib/project.pure'
import { FX_ITEMS } from './lib/fx.data'
import { DROP_KEY } from './drop-text'

let failed = 0
const ok = (n: string, f: () => void) => { try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
const lane = (id: string, kind: string, clips: unknown[]) => ({ id, kind, locked: false, hidden: false, muted: false, clips })

ok('U1 不认得的转场／特效／动画拿掉并报出来；贴纸／滤镜留着但报出来；认得的照收、不报', () => {
  const r = parseProjectIssues({
    media: [{ id: 'm1', name: 'a.mp4', kind: 'video', duration: 20, from: 'local' }],
    tracks: [
      lane('main', 'visual', [
        { id: 'c1', mediaId: 'm1', start: 0, length: 4, offset: 0, fx: [{ fx: 'nope-fx' }], anim: { in: { id: 'zzz' } } },
        { id: 'c2', mediaId: 'm1', start: 4, length: 3, offset: 4, transIn: { tr: 'tr-fade', length: 0.8 } },
        { id: 'c3', mediaId: 'm1', start: 7, length: 3, offset: 7, transIn: { tr: 'tr-luma_dissolve', length: 0.8 } },
      ]),
      lane('s1', 'sticker', [{ id: 'k1', start: 0, length: 2, offset: 0, sticker: { sticker: 'no-such-sticker' } }]),
      lane('f1', 'filter', [{ id: 'g1', start: 0, length: 2, offset: 0, filter: { filter: 'no-such-filter' } }]),
    ],
  })
  assert.ok(r.ok)
  if (!r.ok) return
  const got = r.issues.filter((d) => d.code.startsWith('ref_')).map((d) => `${d.code}|${d.id}|${d.body}|${d.old}`).sort()
  assert.deepEqual(got, [
    'ref_unknown_kept|g1|filter|no-such-filter',
    'ref_unknown_kept|k1|sticker|no-such-sticker',
    'ref_unknown|c1|anim|in:zzz',
    'ref_unknown|c1|fx|nope-fx',
    'ref_unknown|c2|transIn|tr-fade',
  ])
  const main = r.project.tracks.find((l) => l.id === 'main')!
  assert.equal(main.clips.find((c) => c.id === 'c3')!.transIn?.tr, 'tr-luma_dissolve')
  assert.equal(main.clips.find((c) => c.id === 'c2')!.transIn, undefined)
  for (const c of ['ref_unknown', 'ref_unknown_kept'] as const) assert.ok(DROP_KEY[c], `页面文字表缺 ${c}`)
})

ok('U2 FORMAT.md：范例里的转场在库里；列出的转场清单＝库里全部转场', () => {
  const md = readFileSync(join(__dirname, 'FORMAT.md'), 'utf8')
  const trans = FX_ITEMS.filter((x) => x.kind === 'transition').map((x) => x.id).sort()
  for (const m of md.matchAll(/"tr":\s*"([^"]+)"/g)) assert.ok(trans.includes(m[1]), `范例用了库里没有的转场 ${m[1]}`)
  const line = md.split('\n').find((l) => l.includes('Transition ids:'))
  assert.ok(line, 'FORMAT.md 没列转场清单')
  const listed = [...line!.matchAll(/`(tr-[^`]+)`/g)].map((m) => m[1]).sort()
  assert.deepEqual(listed, trans)
})

console.log(`${2 - failed}/2 passed`)
if (failed) process.exitCode = 1
