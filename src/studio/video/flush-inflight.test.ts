// 剪辑外框 flush 题：第一发存档还在写、手上又改了一笔 ⇒ 汇出／关掉要等那一发写完、再把新的那笔存进去，才拿工程档去打包或离开。
//   做法：用 TypeScript 解析原始码，原样取出整页的 saveNow、flushProject 与外框（session.ts）的 flush、runExport、close，
//   接假的 refs／宿主存档（写进记忆体储存、第一发卡住）＋真的 buildVideoExport、buildExportZip、JSZip，解开 zip 看 project.json。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/flush-inflight.test.ts')"
// 药（各改坏一处，对应题必红）：
//   registerFlush 改回直接叫 saveNow（busy 就回）⇒ A、B、D、E、F；flushProject 等完不再比对、不补存 ⇒ A–E；
//   flushProject 存不成也不丢错 ⇒ D、E。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import JSZip from 'jszip'
import type { AssetInfo, ProjectStore } from '../shared/types'
import { buildExportZip } from '../shared/zip'
import { saveProjectSafe } from '../shared/store'
import { buildVideoExport } from './export-project'
import { emptyVideoDoc, saveVideoDoc } from './format'
import type { VeditProject } from './lib/project.pure'
import type { RatioSel } from './lib/ratio.pure'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript') as typeof import('typescript')

const ROOT = join(__dirname, '..') // studio 根
/** 原始码里某个 const 的初值（useCallback(fn, deps) ⇒ 取 fn）⇒ 转成能在 vm 里跑的 JS 式子 */
function extract(rel: string, name: string): string {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: import('typescript').Expression[] = []
  const visit = (n: import('typescript').Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && n.initializer) found.push(n.initializer)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  assert.equal(found.length, 1, `${rel} 里找不到唯一的 ${name}`)
  let init = found[0]
  if (ts.isCallExpression(init) && init.expression.getText(sf) === 'useCallback') init = init.arguments[0]
  return ts.transpileModule(`(${init.getText(sf)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '')
}
/** 整页登记给外框的那支：host.project.registerFlush(<这支>) 的参数 */
function registeredFlush(rel: string): string {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (n: import('typescript').Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'host.project.registerFlush' && n.arguments[0] && ts.isArrowFunction(n.arguments[0])) found.push(n.arguments[0].getText(sf))
    ts.forEachChild(n, visit)
  }
  visit(sf)
  assert.equal(found.length, 1, `${rel} 里找不到唯一一处 registerFlush(() => …)`)
  return ts.transpileModule(`(${found[0]})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim().replace(/;$/, '')
}
const PAGE = 'video/page/VideoEditPage.tsx'
const SESSION = 'shared/session.ts'
const SRC = {
  saveNow: extract(PAGE, 'saveNow'),
  flushProject: extract(PAGE, 'flushProject'),
  registered: registeredFlush(PAGE),
  flush: extract(SESSION, 'flush'),
  runExport: extract(SESSION, 'runExport'),
  close: extract(SESSION, 'close'),
}
const PAGE_TEXT = readFileSync(join(ROOT, PAGE), 'utf8')

/** 记忆体储存（安全写规则同底座）；hold() 之后下一发写 project.json 卡住，直到 release() */
function memStore() {
  let json: string | null = null
  let ver = 0, base = -1
  const assets = new Map<string, Blob>()
  let gate: Promise<void> | null = null
  let open: (() => void) | null = null
  let failNext = false
  const writes: string[] = []
  const put = async (v: unknown) => {
    if (failNext) { failNext = false; throw new Error('disk full') }
    if (gate) { const g = gate; gate = null; await g }
    json = JSON.stringify(v, null, 2) + '\n'; ver++; base = ver
    writes.push(json)
  }
  const changed = () => json !== null && base !== ver
  const store: ProjectStore = {
    backend: 'opfs', label: '',
    async readJSON<T>(o?: { peek?: boolean }) { if (!o?.peek) base = ver; return json === null ? null : (JSON.parse(json) as T) },
    async writeJSON(v) { await put(v) },
    async writeJSONSafe(v, o) { if (!o?.force && changed()) return { written: false as const, reason: 'changed-outside' as const, lastModified: ver }; await put(v); return { written: true as const } },
    async changedOutside() { return changed() },
    async lastModified() { return json === null ? null : ver },
    async readAsset(n) { return assets.get(n) ?? null },
    async writeAsset(n, d) { assets.set(n, d instanceof Blob ? d : new Blob([d as BlobPart])) },
    async listAssets(): Promise<AssetInfo[]> { return [...assets].map(([name, b]) => ({ name, size: b.size, lastModified: 1, type: b.type })) },
    async deleteAsset(n) { assets.delete(n) },
    watch: () => () => {},
  }
  return {
    store, writes,
    hold() { gate = new Promise<void>((r) => { open = r }) },
    release() { open?.(); open = null },
    failNextWrite() { failNext = true },
    ratioOnDisk: () => (json ? (JSON.parse(json) as { ratio: RatioSel }).ratio : null),
  }
}

const mark = (w: number): RatioSel => ({ kind: 'custom', w, h: 100 })
const ORIGINAL = 100, EDIT1 = 101, EDIT2 = 102
const tick = () => new Promise<void>((r) => setImmediate(r))

/** 一页：整页的 saveNow／flushProject＋外框的 flush／runExport／close，全用原始码 */
async function page(o: { remoteAsk?: boolean } = {}) {
  const mem = memStore()
  await saveVideoDoc(mem.store, { ...emptyVideoDoc('旅行'), ratio: mark(ORIGINAL) })
  let current: VeditProject = { v: 1, ratio: mark(ORIGINAL), tracks: emptyVideoDoc().tracks, media: [], programs: {} } as unknown as VeditProject
  const setRatio = (w: number) => { current = { ...current, ratio: mark(w) } }
  const events: string[] = []
  const timers: number[] = []
  const window = {
    // 外框 flush 里等「正在存」那一下的短暂停是真的；自动存的重试／接着再存那几个计时器只记下、不跑（免得跟题抢）
    setTimeout: (fn: () => void, ms: number) => { if (ms <= 50) return setTimeout(fn, 1); timers.push(ms); return 0 },
  }
  const scope: Record<string, unknown> = {
    console, JSON, Promise, Error, window,
    // 整页
    projRef: { current: { id: 'p1', title: '旅行', folderId: null } },
    projBusyRef: { current: false },
    remoteAskRef: { current: o.remoteAsk ? { d: {}, canMerge: false } : null },
    projBaseRef: { current: '1' },
    projSavedRef: { current: JSON.stringify(current) },
    projectNow: () => JSON.parse(JSON.stringify(current)),
    cardNow: async () => ({ duration: 0, cover: null }),
    setSaveState: (s: string) => events.push(`save-state:${s}`),
    setNotice: () => {},
    setProjState: () => {},
    reportProjectGroups: () => {},
    reloadProject: async () => null,
    t: (k: string) => k,
    VEDIT_SAVE_DEBOUNCE_MS: 1200,
    saveNowRef: { current: null },
    host: {
      project: {
        // 同游客宿主那支：转成工程档、安全写（force＝明确存档照写）
        save: async (_id: string, body: { project: VeditProject }, force?: boolean) => {
          events.push(`write-start:${(body.project.ratio as { w: number }).w}`)
          const r = await saveProjectSafe(mem.store, (s) => saveVideoDoc(s, { ...emptyVideoDoc('旅行'), ratio: body.project.ratio }), { force })
          if (!r.written) return { status: 412, j: {} }
          events.push(`write-done:${(body.project.ratio as { w: number }).w}`)
          return { status: 200, j: { updated_at: String(await mem.store.lastModified()) } }
        },
        dirty: () => {},
      },
    },
  }
  const ctx = vm.createContext(scope)
  const saveNow = vm.runInContext(SRC.saveNow, ctx) as (force?: boolean) => Promise<void>
  ;(scope.saveNowRef as { current: unknown }).current = saveNow
  const flushProject = vm.runInContext(SRC.flushProject, ctx) as () => Promise<void>
  scope.flushProjectRef = { current: flushProject }
  // 外框
  let downloaded: Blob | null = null
  const failures: unknown[] = []
  const navigations: string[] = []
  Object.assign(scope, {
    flushRef: { current: vm.runInContext(SRC.registered, ctx) },   // 整页登记给外框的那支（registerFlush 的参数原样）
    setBusy: () => {},
    buildExportZip,
    appDef: { buildExport: (s: ProjectStore, c: { projectId: string; options: ReadonlySet<string> }) => buildVideoExport(s, c, { readProxy: async () => null }) },
    store: mem.store,
    record: { id: 'p1' },
    name: '旅行',
    app: 'video',
    exportFileName: () => 'out.zip',
    downloadBlob: (b: Blob) => { downloaded = b; events.push(`downloaded:${(mem.ratioOnDisk() as { w: number }).w}`) },
    fail: (e: unknown) => { failures.push(e); events.push('fail') },
    dirtyRef: { current: true },
    navigate: (href: string) => { navigations.push(href); events.push(`navigate:${(mem.ratioOnDisk() as { w: number }).w}`) },
    leaveTarget: async () => '/studio',
    env: {},
  })
  scope.flush = vm.runInContext(SRC.flush, ctx)
  const runExport = vm.runInContext(SRC.runExport, ctx) as (opts: ReadonlySet<string>) => Promise<void>
  const close = vm.runInContext(SRC.close, ctx) as () => Promise<void>
  const zipRatio = async () => {
    assert.ok(downloaded, '没打包')
    const z = await JSZip.loadAsync(await (downloaded as Blob).arrayBuffer())
    return (JSON.parse(await z.file('project.json')!.async('string')) as { ratio: { w: number } }).ratio.w
  }
  return { mem, scope, saveNow, flushProject, runExport, close, setRatio, events, failures, navigations, zipRatio, timers }
}

let n = 0, bad = 0
async function test(name: string, fn: () => unknown) {
  try { await fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 8).join('\n   ')) }
}

void (async () => {
  await test('A 第一发还在写、又改了一笔 ⇒ 汇出等它写完、再把新那笔存进去才打包：zip 里是最新那笔', async () => {
    const p = await page()
    p.setRatio(EDIT1)
    p.mem.hold()
    const first = p.saveNow()                      // 自动存：第一发卡在写档
    await tick()
    assert.deepEqual(p.events.filter((e) => e.startsWith('write')), [`write-start:${EDIT1}`])
    p.setRatio(EDIT2)                              // 写档那几拍里又改了
    const exporting = p.runExport(new Set())
    for (let i = 0; i < 20; i++) await tick()
    assert.ok(!p.events.some((e) => e.startsWith('downloaded')), `第一发还没写完就打包了：${p.events.join(' ')}`)
    p.mem.release()
    await Promise.all([first, exporting])
    assert.deepEqual(p.failures, [])
    assert.equal(await p.zipRatio(), EDIT2, `zip 里不是最新那笔：${p.events.join(' ')}`)
    assert.equal((p.mem.ratioOnDisk() as { w: number }).w, EDIT2)
  })

  await test('B 关掉也一样：等写完、存好最新那笔才离开', async () => {
    const p = await page()
    p.setRatio(EDIT1)
    p.mem.hold()
    const first = p.saveNow()
    await tick()
    p.setRatio(EDIT2)
    const closing = p.close()
    for (let i = 0; i < 20; i++) await tick()
    assert.deepEqual(p.navigations, [], '第一发还没写完就离开了')
    p.mem.release()
    await Promise.all([first, closing])
    assert.deepEqual(p.events.filter((e) => e.startsWith('navigate')), [`navigate:${EDIT2}`])
  })

  await test('C 没有在写的那发：汇出前照样把手上的改动存进去（明确存档）', async () => {
    const p = await page()
    p.setRatio(EDIT1)
    await p.runExport(new Set())
    assert.equal(await p.zipRatio(), EDIT1)
  })

  await test('D 存不成（写档出错）⇒ 汇出丢错、不拿磁碟上的旧档打包；关掉也不离开', async () => {
    const p = await page()
    p.setRatio(EDIT1)
    for (let i = 0; i < 5; i++) p.mem.failNextWrite()
    // 每一轮存档都失败
    const realSave = (p.scope.host as { project: { save: (...a: unknown[]) => Promise<unknown> } }).project.save
    ;(p.scope.host as { project: { save: (...a: unknown[]) => Promise<unknown> } }).project.save = async (...a: unknown[]) => { p.mem.failNextWrite(); return realSave(...a) }
    await p.runExport(new Set())
    assert.equal(p.failures.length, 1, '没把存不成告诉外框')
    assert.ok(!p.events.some((e) => e.startsWith('downloaded')), '存不成还拿旧档打包')
    await p.close()
    assert.deepEqual(p.navigations, [], '存不成还离开')
  })

  await test('E 正在问「远端改了怎么办」⇒ 不存也不假装存好：汇出丢错', async () => {
    const p = await page({ remoteAsk: true })
    p.setRatio(EDIT1)
    await p.runExport(new Set())
    assert.equal(p.failures.length, 1)
    assert.ok(!p.events.some((e) => e.startsWith('downloaded')))
  })

  await test('F 整页登记给外框的是 flushProject（不是会在 busy 时直接回的 saveNow）', () => {
    assert.match(PAGE_TEXT, /host\.project\.registerFlush\(\(\) => flushProjectRef\.current\(\)\)/)
    assert.ok(!/registerFlush\(\(\) => saveNowRef\.current\(/.test(PAGE_TEXT))
  })

  console.log(bad ? `studio-video flush：${n}/${n + bad} 过` : `studio-video flush → ${n} 过`)
  if (bad) process.exit(1)
})()
