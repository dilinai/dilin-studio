// 单机版本机 MCP 交到剪辑页的活（lib/agent-job.pure.ts）＋页面那半的取活回圈（shared/agent-link.ts）＋两页接线。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./video/agent-job.test.ts')"
// 负控（各撤一处·对应题必红）：videoAgentJob 不先挡要网站的步骤 ⇒ J3；startAgentLink 不先探 hello ⇒ L2；剪辑页不用 commitRemoteTracks 入账 ⇒ W1。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseProject, type VeditProject } from './lib/project.pure'
import { videoAgentJob } from './lib/agent-job.pure'
import { startAgentLink, type AgentJob } from '../shared/agent-link'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])
const lane = (id: string, kind: string, clips: unknown[]) => ({ id, kind, clips, locked: false, hidden: false, muted: false })
const P = parseProject({
  v: 1, ratio: { kind: 'fit' }, programs: {},
  media: [{ id: 'm1', name: 'a.mp4', kind: 'video', duration: 10, from: 'local' }],
  tracks: [lane('main', 'visual', [{ id: 'v1', mediaId: 'm1', start: 0, length: 6, offset: 0 }])],
})
assert.ok(P.ok)
const BASE = (P as { project: VeditProject }).project
const STATE = { tracks: BASE.tracks, ratio: BASE.ratio, media: BASE.media }
const seq = () => { let i = 0; return () => `n${++i}` }

ok('J1 list：全部命令带参数表；filter 比对 id／说明／参数名', () => {
  const all = videoAgentJob({ kind: 'list' }, STATE, seq()).reply as { ok: true; result: Array<{ id: string; params: unknown[] }> }
  assert.ok(all.ok && all.result.length > 30 && all.result.some((c) => c.id === 'clip.split' && Array.isArray(c.params)))
  const f = (videoAgentJob({ kind: 'list', filter: 'SPLIT' }, STATE, seq()).reply as { result: Array<{ id: string }> }).result
  assert.ok(f.length >= 1 && f.every((c) => /split/i.test(JSON.stringify(c))))
})

ok('J2 run：切一刀 ⇒ 回新轨道与结果（新片段编号照 newId）；只读步骤（timeline.list）⇒ changed:false、不给 next；改比例 ⇒ next.ratio', () => {
  const r = videoAgentJob({ kind: 'run', steps: [{ command: 'clip.split', params: { clip: 'v1', at: 2 } }] }, STATE, seq())
  assert.equal(r.reply.ok, true)
  assert.equal((r.reply as { result: { changed: boolean } }).result.changed, true)
  const main = r.next!.tracks.find((l) => l.id === 'main')!
  assert.deepEqual(main.clips.map((c) => [c.id, c.start, c.length]), [['v1', 0, 2], ['n1', 2, 4]])
  assert.equal(r.next!.ratio, null)
  const ro = videoAgentJob({ kind: 'run', steps: [{ command: 'timeline.list' }] }, STATE, seq())
  assert.deepEqual([ro.reply.ok, (ro.reply as { result: { changed: boolean } }).result.changed, ro.next], [true, false, undefined])
  const ra = videoAgentJob({ kind: 'run', steps: [{ command: 'project.setRatio', params: { ratio: '9:16' } }] }, STATE, seq())
  assert.ok(ra.next && ra.next.ratio && JSON.stringify(ra.next.ratio).includes('9:16'))
})

ok('J3 不做的照实说、什么都不动：参数错（第几步、原因）；要网站的步骤（media.tts）；加素材（media.add）', () => {
  const bad = videoAgentJob({ kind: 'run', steps: [{ command: 'timeline.list' }, { command: 'clip.split', params: { clip: 'v1', when: 2 } }] }, STATE, seq())
  assert.equal(bad.next, undefined)
  assert.match(String((bad.reply as { message: string }).message), /^Step 1 \(clip\.split\) failed: unknown param "when".*Nothing was applied/s)
  const tts = videoAgentJob({ kind: 'run', steps: [{ command: 'media.tts', params: { text: 'hi' } }] }, STATE, seq())
  assert.deepEqual([(tts.reply as { error: string }).error, tts.next], ['not_available', undefined])
  assert.match(String((tts.reply as { message: string }).message), /needs the website/)
  const add = videoAgentJob({ kind: 'run', steps: [{ command: 'media.add', params: { drive_id: 'd1', kind: 'video' } }] }, STATE, seq())
  assert.equal(add.next, undefined)
  assert.match(String((add.reply as { message: string }).message), /media files is not available|needs the website|failed/)
  assert.equal((add.reply as { ok: boolean }).ok, false)
})

/** 假小服务：hello／poll（一件活后回 204）／reply */
function fakeServer(hello: boolean, jobs: AgentJob[]) {
  const replies: unknown[] = [], polls: URLSearchParams[] = []
  let left = false
  const f = (async (url: string, init?: RequestInit) => {
    const [path, qs] = String(url).split('?')
    const u = { pathname: path, searchParams: new URLSearchParams(qs || '') }
    if (u.pathname === '/_agent/hello') return new Response(JSON.stringify(hello ? { name: 'dilin-studio-agent' } : { name: 'other' }), { status: 200 })
    if (u.pathname === '/_agent/poll') { polls.push(u.searchParams); const j = jobs.shift(); if (j) return new Response(JSON.stringify(j), { status: 200 }); await new Promise((r) => setTimeout(r, 20)); return new Response(null, { status: 204 }) }
    if (u.pathname === '/_agent/reply') { replies.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }) }
    if (u.pathname === '/_agent/leave') { left = true; return new Response('{}', { status: 200 }) }
    return new Response(null, { status: 404 })
  }) as unknown as typeof fetch
  return { f, replies, polls, left: () => left }
}

ok('L1 接上小服务：取活带编辑器／工程／标题 ⇒ handle 跑 ⇒ 交回同一件活的编号；handle 抛错 ⇒ 交回 command_failed；停了 ⇒ 不再取', async () => {
  const s = fakeServer(true, [{ id: 'j1', kind: 'run', command: 'x' }, { id: 'j2', kind: 'boom' }])
  const stop = startAgentLink({ editor: 'paint', project: () => ({ id: 'P1', title: 'Poster' }), fetch: s.f, retryMs: 10, handle: async (job) => { if (job.kind === 'boom') throw new Error('kaboom'); return { ok: true, result: { ran: job.command } } } })
  await new Promise((r) => setTimeout(r, 150))
  stop()
  assert.deepEqual(s.replies.map((r) => (r as { id: string }).id), ['j1', 'j2'])
  assert.deepEqual((s.replies[0] as { reply: unknown }).reply, { ok: true, result: { ran: 'x' } })
  assert.deepEqual((s.replies[1] as { reply: unknown }).reply, { ok: false, error: 'command_failed', message: 'kaboom' })
  const q = s.polls[0]
  assert.deepEqual([q.get('editor'), q.get('project'), q.get('title')], ['paint', 'P1', 'Poster'])
  assert.equal((s.replies[0] as { page: string }).page, q.get('page'))
  const n = s.polls.length
  await new Promise((r) => setTimeout(r, 80))
  assert.ok(s.polls.length <= n + 1, '停了就不再取活')
  assert.equal(s.left(), true, '停了 ⇒ 跟小服务说这页关了')
})

ok('L2 不是单机版那支小服务（网站游客版、Perl／Python 版）⇒ 探一次就停、不取活', async () => {
  const s = fakeServer(false, [{ id: 'j1', kind: 'run' }])
  const stop = startAgentLink({ editor: 'video', project: () => null, fetch: s.f, retryMs: 10, handle: async () => ({ ok: true, result: 1 }) })
  await new Promise((r) => setTimeout(r, 80))
  stop()
  assert.deepEqual([s.polls.length, s.replies.length, s.left()], [0, 0, false])
})

ok('W1 两页接线：画板游客页起好就接（只在单机版）·活交给网站同一支 runRelayJob；剪辑页在页面现况上跑 videoAgentJob、成了用 commitRemoteTracks 入账', () => {
  const paint = readFileSync(join(__dirname, '../paint/page/GuestPaintPage.tsx'), 'utf8')
  assert.match(paint, /isStandalone\(\) \? startAgentLink\(\{ editor: 'paint',[^\n]*handle: async \(job\) => \(await paintPageJob\(jobCtx, job\)\) \?\? runRelayJob\(s, job/)
  assert.match(paint, /useEffect\(\(\) => \(\) => \{ agentStop\.current\?\.\(\)/)
  const video = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(video, /const out = videoAgentJob\(job, cmdState\(\), uid\)/)
  assert.match(video, /commitRemoteTracks\(out\.next\.tracks\)/)
  assert.match(video, /isStandalone\(\) \? startAgentLink\(\{ editor: 'video'/)
  const host = readFileSync(join(__dirname, '../paint/page/drawboard-host.ts'), 'utf8')
  assert.match(host, /export async function runRelayJob\(/, 'runRelayJob 在 studio 共用那份（网站那份转引）')
})

void (async () => {
  let failed = 0
  for (const [n, f] of tests) {
    try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', e instanceof Error ? e.stack?.split('\n').slice(0, 4).join('\n  ') : e) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
