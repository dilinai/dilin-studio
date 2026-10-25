/**
 * 编曲「拆曲」交給終端：跑到一半切去别的分页 ⇒ ⛔ 发 media_cancel、六轨照收（例如切去「素材」分页时页面自己发了取消·整趟白跑）。
 * 跑法（在 studio 根目录）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./video/song-stems.test.ts')"
 * 负控：编曲面板关掉时取消那一趟（SplitPane 卸下发 cancel）⇒ S2 红；剪辑页不把那一趟交给编曲面板（自己在面板里跑）⇒ S2 红；
 *       离开编曲分页不显示右下小卡 ⇒ S2 红；runner 每次开跑前先把上一趟当取消（start 不看 busy）⇒ S1 红。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SongStemsRunner, type SongStemsEnv } from './ui/song-stems'
import type { ShellJobOpts, ShellPhase } from './lib/shell-job'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])
const rd = (p: string) => readFileSync(join(__dirname, p), 'utf8')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const

/** 假终端：每 5ms 报一段进度、看一次 cancelled()（真的那条看到就发 media_cancel） */
function fakeShell(steps: number) {
  const log = { cancels: 0, phases: [] as string[], added: null as null | { mix: string; stems: string[] } }
  const env: SongStemsEnv = {
    api: {
      runShellJob: async (o: ShellJobOpts) => {
        for (let i = 0; i < steps; i++) {
          if (o.cancelled()) { log.cancels++; throw new Error('cancelled') }
          const ph: ShellPhase = { kind: 'job', job: { id: 'j', kind: 'stems', state: 'running', pct: i * 10, stage: `step ${i}` } } as unknown as ShellPhase
          o.onPhase(ph); log.phases.push(`step ${i}`)
          await sleep(5)
        }
        return { kind: 'stems', files: Object.fromEntries(STEMS.map((k) => [k, `id-${k}`])) } as never
      },
      fetchDriveBlob: async (id: string) => new Blob([id]),
    },
    put: async () => ({ fileId: 'f', folderId: null }),
    addMedia: (mix, stems) => { log.added = { mix: mix.name, stems: stems.map((f) => f.name) } },
    t: (k) => k,
  }
  return { env, log }
}
const job = { mix: async () => new File(['x'], '歌.mp3', { type: 'audio/mpeg' }), names: Object.fromEntries(STEMS.map((k) => [k, `歌-${k}.mp3`])) as never }
const dev = { role: '剪輯師', deviceId: 'dev-1', name: '工作站' }

ok('S1 runner：跑到一半没人看着（编曲分页关了）⇒ 不发取消、六轨照收；回来照样读得到进度；第二次开跑不收', async () => {
  const { env, log } = fakeShell(8)
  const r = new SongStemsRunner(() => env)
  const p = r.start(dev, new File(['x'], '歌.mp3'), job)
  await sleep(18)
  assert.ok(r.get().phase, '跑着')
  assert.equal(r.asClipJob()?.phase.kind, 'shell'); assert.equal(r.asClipJob()?.name, '歌.mp3')
  void r.start(dev, new File(['y'], '另一首.mp3'), job) // 已在跑 ⇒ 不收、⛔ 把上一趟当取消
  await p
  assert.equal(log.cancels, 0)
  assert.deepEqual(log.added, { mix: '歌.mp3', stems: STEMS.map((k) => `歌-${k}.mp3`) })
  assert.equal(r.get().phase, null); assert.deepEqual(r.get().msg, { ok: true, text: 'vedit_shell_stems_done' })
  assert.equal(r.asClipJob(), null)
})
ok('S1b runner：按取消、关剪辑页（dispose）才发取消，结果不进素材区', async () => {
  for (const how of ['cancel', 'dispose'] as const) {
    const { env, log } = fakeShell(8)
    const r = new SongStemsRunner(() => env)
    const p = r.start(dev, new File(['x'], '歌.mp3'), job)
    await sleep(12)
    r[how]()
    await p
    assert.equal(log.cancels, 1, how); assert.equal(log.added, null, how)
  }
})
ok('S2 接线：编曲面板只读剪辑页那一趟（卸下不取消）·剪辑页交 stems 进编曲、关页才 dispose、离开编曲分页显示右下小卡', () => {
  const A = rd('ui/Arrange.tsx'), P = rd('page/VideoEditPage.tsx'), S = rd('ui/song-stems.ts')
  const pane = A.slice(A.indexOf('function SplitPane('), A.indexOf('function SplitPane(') + 6000)
  assert.ok(!/runShellJob/.test(pane), '面板不自己交终端')
  assert.ok(!/useEffect\(\(\) => \(\) =>[^\n]*(shellRun|stems\.runner\.(cancel|dispose))/.test(pane), '面板卸下不取消')
  assert.match(pane, /shell\.stems\.runner\.start\(dev, song, /)
  assert.match(P, /const songStems = useSongStems\(\{/)
  assert.match(P, /api: host\.shell, stems: songStems \}/)
  assert.match(P, /\{topTab !== 'arrange' && <ClipStemsPanel job=\{songStems\.runner\.asClipJob\(\)\} onCancel=\{songStems\.runner\.cancel\} \/>\}/)
  assert.match(S, /useEffect\(\(\) => \(\) => r\.dispose\(\), \[r\]\)/)
})

;(async () => {
  let failed = 0
  for (const [n, f] of tests) { try { await f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error)?.message) } }
  console.log(`song stems: ${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
})()
