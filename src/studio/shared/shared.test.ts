/**
 * Dilin Studio 底座题：储存层、看档变动、表头、zip 汇出汇入、字典、复制给 AI 的那段、工程编号、网站转接。
 * 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./shared/shared.test.ts')"
 * 药（各拿掉一处修正，对应题必红）：
 *   store.ts watch 不认「自己刚写的」（删掉 lastWrittenText 比对与写后记 known）⇒ ②；
 *   zip.ts applyPayload 不删多出来的素材 ⇒ ④；project-file.ts 不检查 version 上限 ⇒ ③；
 *   readProjectZip 不认多包一层目录 ⇒ ④；
 *   zip.ts buildExportZip 不用编辑器的 buildExport ⇒ ⑪；zipPayload 不查同名素材 ⇒ ⑪；
 *   ui/ExportOptionsDialog 选项字不走 t ⇒ ⑫；
 *   store.ts 安全写不比对修改时间 ⇒ ⑬⑭；peek 读也当基准 ⇒ ⑬；拒写时不通知 watch ⇒ ⑬；没读过也照写 ⇒ ⑬；
 *   saveProjectSafe 不先 changedOutside 预检（素材先被写）⇒ ⑭；
 *   store.ts 写 project.json 不经暂存档（直接写）⇒ ⑮；没 move／move 失败时不删暂存档 ⇒ ⑮；move 失败不退回直接写 ⇒ ⑮；
 *   project-file.ts writeProjectName 不走安全写 ⇒ ⑯；读现档不用 peek（把外部版本当基准）⇒ ⑯。
 *   zip.ts readEntryBounded 不数位元组（上限当 Infinity）⇒ ⑰（33 MB project.json、比例炸弹、表头造假）；
 *   本机上限不按 zip 大小放宽（固定 64 MB）⇒ ⑰（70 MB 影片素材）；本机也用 4 MB 的 project.json 上限 ⇒ ⑰；拿掉项目数检查 ⇒ ⑰。
 */
import assert from 'node:assert/strict'
import { FakeDir, asDir, type FakeOptions } from './testing/fake-fs'
import { createHandleStore, checkAssetName, copyProject, folderStore, opfsStore, saveProjectSafe, PROJECT_JSON_TMP } from './store'
import type { ProjectStore } from './types'
import { checkProjectHeader, readProjectJson, writeProjectJson, formatTag, writeProjectName, projectNameOf } from './project-file'
import { exportProjectZip, readProjectZip, applyPayload, exportFileName, readAll, zipPayload, buildExportZip, localZipLimits, ZIP_MAX_ENTRIES, LOCAL_ZIP_MAX_JSON_BYTES, LOCAL_ZIP_MIN_BUDGET_BYTES, LOCAL_ZIP_MAX_RATIO } from './zip'
import { STUDIO_SHARED_I18N, makeStudioT, missingKeys, fillVars } from './i18n'
import { buildAIPrompt, aiUsageKeys } from './ai-prompt'
import { newProjectId, isProjectId } from './projects'
import { siteTAdapter } from './StudioT'
import { STUDIO_APP_IDS, StudioError, isStudioError } from './types'
import { makePlaceholderApp } from './placeholder'
import JSZip from 'jszip'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const mk = () => { const d = new FakeDir('我的工程'); return { d, store: createHandleStore(asDir(d), { backend: 'folder', label: d.name, opfsPath: null }) } }
const rejects = async (p: Promise<unknown>, code: string) => {
  try { await p } catch (e) { assert.ok(isStudioError(e), `应丢 StudioError，收到 ${String(e)}`); assert.equal((e as { code: string }).code, code); return }
  assert.fail(`应丢 ${code}`)
}

ok('① project.json 读写来回一致（缩排 2 格、结尾换行、中文原样）；不存在 ⇒ null；坏 JSON ⇒ bad_json', async () => {
  const { d, store } = mk()
  assert.equal(await store.readJSON(), null)
  const v = { format: 'dilin-studio/sheets', version: 1, name: '月报', cells: { A1: { v: '你好' }, B2: { v: 3.5 } }, list: [1, null, true] }
  await store.writeJSON(v)
  assert.deepEqual(await store.readJSON(), v)
  assert.equal(d.text('project.json'), JSON.stringify(v, null, 2) + '\n')
  d.setText('project.json', '{ broken')
  await rejects(store.readJSON(), 'bad_json')
})

ok('② 看档变动：自己写的不触发；外面改了触发一次；只改时间、内容跟自己写的一样不触发', async () => {
  const { d, store } = mk()
  await store.writeJSON({ a: 1 })
  const hits: number[] = []
  const stop = store.watch(c => hits.push(c.lastModified), 15)
  await sleep(50)
  await store.writeJSON({ a: 2 })            // 自己写
  await sleep(60)
  assert.equal(hits.length, 0, '自己写的不该触发')
  d.touch('project.json')                    // 时间变、内容是自己写的那份
  await sleep(60)
  assert.equal(hits.length, 0, '只是时间变了不该触发')
  d.setText('project.json', JSON.stringify({ a: 99 }))   // 外面（AI）改
  await sleep(60)
  assert.equal(hits.length, 1, '外面改了要触发一次')
  await sleep(60)
  assert.equal(hits.length, 1, '同一次改动不重复触发')
  stop()
  d.setText('project.json', JSON.stringify({ a: 100 }))
  await sleep(60)
  assert.equal(hits.length, 1, '停了就不再触发')
  assert.deepEqual(await store.readJSON(), { a: 100 })
})

ok('③ 表头：format 必须是本编辑器、version 正整数且不超过认得的；writeProjectJson 表头放最前且盖掉 body 同名栏', async () => {
  assert.equal(formatTag('docs'), 'dilin-studio/docs')
  assert.doesNotThrow(() => checkProjectHeader({ format: 'dilin-studio/docs', version: 1 }, 'docs', 1))
  for (const bad of [null, [], 'x', { format: 'dilin-studio/sheets', version: 1 }, { format: 'dilin-studio/docs' }, { format: 'dilin-studio/docs', version: 0 }, { format: 'dilin-studio/docs', version: 1.5 }]) {
    assert.throws(() => checkProjectHeader(bad, 'docs', 1), (e: unknown) => isStudioError(e, 'bad_format'), JSON.stringify(bad))
  }
  assert.throws(() => checkProjectHeader({ format: 'dilin-studio/docs', version: 2 }, 'docs', 1), (e: unknown) => isStudioError(e, 'too_new'))
  const { d, store } = mk()
  await writeProjectJson(store, 'docs', 1, { format: 'x', version: 9, name: 'n', body: 'b' })
  assert.ok(d.text('project.json').startsWith('{\n  "format": "dilin-studio/docs",\n  "version": 1,'))
  assert.deepEqual(await readProjectJson(store, 'docs', 1), { format: 'dilin-studio/docs', version: 1, name: 'n', body: 'b' })
  await rejects(readProjectJson(store, 'sheets', 1), 'bad_format')
})

ok('④ 汇出 zip 再汇入（另一个工程）：project.json 与素材逐字节相同；目标多出来的素材删掉；多包一层目录的 zip 也认；不认得的格式拒收', async () => {
  const a = mk()
  await a.store.writeJSON({ format: 'dilin-studio/paint', version: 1, name: '图', layers: [{ id: 'l1', src: 'assets/a.png' }] })
  const png = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255])
  await a.store.writeAsset('a.png', png)
  await a.store.writeAsset('说明.txt', '中文素材')
  const zipBlob = await exportProjectZip(a.store)
  const b = mk()
  await b.store.writeAsset('old.bin', 'stale')
  await applyPayload(b.store, await readProjectZip(zipBlob, 'paint', 1))
  assert.deepEqual(await b.store.readJSON(), await a.store.readJSON())
  assert.deepEqual((await b.store.listAssets()).map(x => x.name), ['a.png', '说明.txt'], '多出来的 old.bin 要删')
  assert.deepEqual(new Uint8Array(await (await b.store.readAsset('a.png'))!.arrayBuffer()), png)
  assert.equal(await (await b.store.readAsset('说明.txt'))!.text(), '中文素材')
  // 多包一层目录
  const z = new JSZip()
  z.file('我的工程/project.json', JSON.stringify({ format: 'dilin-studio/paint', version: 1 }))
  z.file('我的工程/assets/x.txt', 'x')
  z.file('__MACOSX/我的工程/._project.json', 'junk')
  const p = await readProjectZip(await z.generateAsync({ type: 'arraybuffer' }), 'paint', 1)
  assert.deepEqual(p.assets.map(x => x.name), ['x.txt'])
  // 不认得的格式／太新／没 project.json
  const wrong = new JSZip(); wrong.file('project.json', JSON.stringify({ format: 'dilin-studio/docs', version: 1 }))
  await rejects(readProjectZip(await wrong.generateAsync({ type: 'arraybuffer' }), 'paint', 1), 'bad_format')
  const newer = new JSZip(); newer.file('project.json', JSON.stringify({ format: 'dilin-studio/paint', version: 7 }))
  await rejects(readProjectZip(await newer.generateAsync({ type: 'arraybuffer' }), 'paint', 1), 'too_new')
  const none = new JSZip(); none.file('readme.txt', 'hi')
  await rejects(readProjectZip(await none.generateAsync({ type: 'arraybuffer' }), 'paint', 1), 'no_project_json')
  assert.equal(exportFileName('我的/图:1', 'paint'), '我的_图_1.dilin-paint.zip')
  assert.equal(exportFileName('  ', 'docs'), 'project.dilin-docs.zip')
})

ok('⑤ 素材：写／列／读／删；档名不合法（斜线、..、空、控制字元）拒收；换资料夹 copyProject 整份搬过去', async () => {
  const { store } = mk()
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x\u0001', 'x'.repeat(201)]) assert.throws(() => checkAssetName(bad), (e: unknown) => isStudioError(e, 'bad_asset_name'), JSON.stringify(bad))
  await store.writeAsset('b.txt', 'B'); await store.writeAsset('a.txt', new Blob(['A']))
  assert.deepEqual((await store.listAssets()).map(x => [x.name, x.size]), [['a.txt', 1], ['b.txt', 1]])
  await store.deleteAsset('a.txt'); await store.deleteAsset('nope.txt')
  assert.deepEqual((await store.listAssets()).map(x => x.name), ['b.txt'])
  assert.equal(await store.readAsset('a.txt'), null)
  await store.writeJSON({ k: 1 })
  const to = mk()
  await to.store.writeAsset('zzz', 'old')
  await copyProject(store, to.store)
  assert.deepEqual(await to.store.readJSON(), { k: 1 })
  assert.deepEqual((await to.store.listAssets()).map(x => x.name), ['b.txt'])
})

ok('⑤b 根目录附加档 writeExtra：写进工程根目录（不进 assets/）、整档覆盖、不碰 project.json；档名不合法或撞 project.json／assets 拒收', async () => {
  const { d, store } = mk()
  await store.writeJSON({ a: 1 })
  await store.writeExtra!('旅行.fcpxml', '<x/>')
  await store.writeExtra!('旅行.fcpxml', '<y/>')
  assert.equal(d.text('旅行.fcpxml'), '<y/>')
  assert.deepEqual(await store.listAssets(), [])
  assert.deepEqual(JSON.parse(d.text('project.json')), { a: 1 })
  for (const bad of ['project.json', '.project.json.tmp', 'assets', 'a/b.fcpxml', '..', '']) await assert.rejects(store.writeExtra!(bad, 'x'), (e: unknown) => (e as { code?: string }).code === 'bad_asset_name', bad)
  assert.deepEqual(JSON.parse(d.text('project.json')), { a: 1 })
})

ok('⑥ 字典：底座三语键齐；取字退英文再退键名；{占位} 代入', () => {
  assert.deepEqual(missingKeys(STUDIO_SHARED_I18N), [])
  for (const app of STUDIO_APP_IDS) for (const l of ['zh-TW', 'zh-CN', 'en'] as const) assert.ok(STUDIO_SHARED_I18N[l][`studio_app_${app}` as 'studio_app_docs'], `${l} ${app}`)
  const t = makeStudioT([STUDIO_SHARED_I18N, { 'zh-TW': { only_tw: '繁', studio_new: '盖掉' }, 'zh-CN': {}, en: { only_en: 'EN' } }], 'zh-TW')
  assert.equal(t('studio_new'), '盖掉', '后面的字典盖前面')
  assert.equal(t('only_en'), 'EN', '本语言没有退英文')
  assert.equal(t('nope_key'), 'nope_key', '都没有回键名')
  assert.equal(t('studio_last_modified', { time: '10:00' }), '最後修改 10:00')
  assert.equal(fillVars('{a}-{b}', { a: 1 }), '1-{b}')
  assert.equal(makeStudioT([STUDIO_SHARED_I18N], 'zh-CN')('studio_app_slides'), '简报')
})

ok('⑦ 一键复制那段：资料夹工程＝编辑器名＋资料夹名＋格式重点＋「改完存档网页会自动更新」；浏览器工程改走 zip；简体站说法不带服务名', () => {
  const t = makeStudioT([STUDIO_SHARED_I18N], 'zh-TW')
  const s = buildAIPrompt({ t, appName: '表格', backend: 'folder', folderName: '月报资料夹', summary: '  格式重点 XYZ  ' })
  assert.ok(s.includes('「表格」') && s.includes('「月报资料夹」') && s.includes('格式重点 XYZ') && s.includes('網頁會自動更新'), s)
  const z = buildAIPrompt({ t, appName: '表格', backend: 'opfs', folderName: '', summary: 'S' })
  assert.ok(z.includes('zip') && z.includes('S') && !z.includes('資料夾「'), z)
  const neutral = aiUsageKeys(true).map(k => makeStudioT([STUDIO_SHARED_I18N], 'zh-CN')(k)).join('')
  assert.ok(!/Claude|Codex|Cowork|ChatGPT|OpenAI|Anthropic/i.test(neutral), neutral)
  const named = aiUsageKeys(false).map(k => t(k)).join('')
  assert.ok(/Claude Code/.test(named) && /Cowork/.test(named))
})

ok('⑧ 工程编号：128 位随机（32 个小写十六进位）、两次不同；别的形状不收', () => {
  const a = newProjectId(), b = newProjectId()
  assert.match(a, /^[0-9a-f]{32}$/); assert.notEqual(a, b)
  assert.ok(isProjectId(a))
  for (const x of ['', 'abc', a.toUpperCase(), a + '0', a.slice(1), '../' + a.slice(3), null, 123]) assert.ok(!isProjectId(x), String(x))
})

ok('⑨ 网站转接 siteTAdapter：网站有就用网站的；回 undefined 或回键名本身 ⇒ 退底座字典；代入 {占位}', () => {
  const fb = makeStudioT([STUDIO_SHARED_I18N], 'en')
  const site: Record<string, string | undefined> = { cancel: '取消（站）', echo: 'echo', tpl: 'hi {n}' }
  const t = siteTAdapter(k => (k === 'echo' ? 'echo' : site[k]), fb)
  assert.equal(t('cancel'), '取消（站）')
  assert.equal(t('echo'), 'echo', '网站回键名本身且底座也没有 ⇒ 底座回键名')
  assert.equal(t('studio_new'), 'New project', '网站没有 ⇒ 底座')
  assert.equal(t('tpl', { n: 3 }), 'hi 3')
})

ok('⑩ 占位编辑器：新开的空工程表头正确、读回一致', async () => {
  const def = makePlaceholderApp('video')
  const { store } = mk()
  await def.format.save(store, def.format.emptyProject())
  assert.deepEqual(await store.readJSON(), { format: 'dilin-studio/video', version: 1 })
  assert.deepEqual(await def.format.load(store), {})
  await def.format.save(store, { name: '片' })
  assert.deepEqual(await def.format.load(store), { name: '片' })
  assert.ok(def.format.summaryForAI('en').includes('dilin-studio/video'))
})

const zipNames = async (b: Blob) => Object.keys((await JSZip.loadAsync(await b.arrayBuffer())).files).filter(n => !n.endsWith('/')).sort()

ok('⑪ 汇出选项口：没 buildExport ⇒ 整份（与 exportProjectZip 同内容）；有 ⇒ 用它回的 payload、收到 projectId 与勾选；zipPayload 档名检查', async () => {
  const a = mk()
  await a.store.writeJSON({ format: 'dilin-studio/video', version: 1, name: '片', clips: ['a.mp4'] })
  await a.store.writeAsset('a.mp4', 'AAAA'); await a.store.writeAsset('b.mp4', 'BBBB')
  const whole = await buildExportZip({}, a.store, { projectId: 'p1', options: new Set() })
  assert.deepEqual(await zipNames(whole), ['assets/a.mp4', 'assets/b.mp4', 'project.json'])
  assert.deepEqual(await zipNames(await exportProjectZip(a.store)), await zipNames(whole))
  const p = await readAll(a.store)
  assert.deepEqual(p.json, await a.store.readJSON()); assert.deepEqual(p.assets.map(x => x.name), ['a.mp4', 'b.mp4'])
  let got = null as { projectId: string; options: string[] } | null
  const def = {
    buildExport: async (s: typeof a.store, ctx: { projectId: string; options: ReadonlySet<string> }) => {
      got = { projectId: ctx.projectId, options: [...ctx.options].sort() }
      const full = await readAll(s)
      return ctx.options.has('only-used') ? { json: { ...full.json, trimmed: true }, assets: full.assets.filter(x => x.name === 'a.mp4') } : full
    },
  }
  const picked = new Set(['only-used', 'small'])
  const trimmed = await buildExportZip(def, a.store, { projectId: 'p1', options: picked })
  assert.deepEqual(got, { projectId: 'p1', options: ['only-used', 'small'] })
  assert.deepEqual(await zipNames(trimmed), ['assets/a.mp4', 'project.json'], '只打包 buildExport 回的素材')
  const back = await readProjectZip(trimmed, 'video', 1)
  assert.equal(back.json.trimmed, true)
  assert.equal(await back.assets[0].data.text(), 'AAAA')
  assert.deepEqual(await a.store.listAssets().then(l => l.map(x => x.name)), ['a.mp4', 'b.mp4'], '汇出不动工程本身')
  await rejects(zipPayload({ json: {}, assets: [{ name: '../x', data: new Blob(['x']) }] }), 'bad_asset_name')
  await rejects(zipPayload({ json: {}, assets: [{ name: 'x', data: new Blob(['1']) }, { name: 'x', data: new Blob(['2']) }] }), 'bad_asset_name')
  await rejects(readAll(mk().store), 'no_project_json')
})

ok('⑫ 汇出勾选小窗：列出每个选项（字走 t）、按 selected 打勾、有「汇出」与「取消」', () => {
  ;(globalThis as { React?: unknown }).React = require('react')     // sucrase 转 JSX 用 React.createElement
  const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
  const Dialog = (require('./ui/ExportOptionsDialog') as typeof import('./ui/ExportOptionsDialog')).default
  const dict = { 'zh-TW': { v_only_used: '只打包用到的片段', v_small: '素材壓成小檔' }, 'zh-CN': { v_only_used: '只打包用到的片段', v_small: '素材压成小档' }, en: { v_only_used: 'Only clips in use', v_small: 'Smaller media' } }
  const opts = [{ id: 'only-used', label: 'v_only_used' }, { id: 'small', label: 'v_small' }]
  const noop = () => {}
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
    const t = makeStudioT([STUDIO_SHARED_I18N, dict], lang)
    const html = renderToStaticMarkup(require('react').createElement(Dialog, { t, options: opts, selected: new Set<string>(), onToggle: noop, onConfirm: noop, onCancel: noop }))
    assert.ok(html.includes(dict[lang].v_only_used) && html.includes(dict[lang].v_small), html)
    assert.ok(html.includes(t('studio_export_go')) && html.includes(t('studio_cancel')) && html.includes(t('studio_export_options_title')))
    assert.ok(!html.includes('checked'), '全不勾 ⇒ 没有 checked')
    assert.ok(!html.includes('v_only_used'), '不该露键名')
  }
  const t = makeStudioT([STUDIO_SHARED_I18N, dict], 'en')
  const html = renderToStaticMarkup(require('react').createElement(Dialog, { t, options: opts, selected: new Set(['small']), onToggle: noop, onConfirm: noop, onCancel: noop }))
  assert.equal((html.match(/checked=""/g) || []).length, 1)
  assert.ok(/data-testid="studio-export-opt-small"[^>]*checked=""|checked=""[^>]*data-testid="studio-export-opt-small"/.test(html), html)
})

/** 两种 store：真资料夹（folderStore）与 OPFS（opfsStore·navigator.storage 换成记忆体目录）。 */
const OPFS_ROOT_DIR = new FakeDir('opfs-root')
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => asDir(OPFS_ROOT_DIR) } } })
async function bothBackends(): Promise<Array<{ kind: string; dir: FakeDir; open: () => Promise<ProjectStore> }>> {
  const fd = new FakeDir('资料夹工程')
  const id = newProjectId()
  await opfsStore('paint', id)                         // 先建出 <OPFS>/dilin-studio/paint/<id>/
  const od = (await (await OPFS_ROOT_DIR.getDirectoryHandle('dilin-studio')).getDirectoryHandle('paint')).entries.get(id) as FakeDir
  return [
    { kind: 'folder', dir: fd, open: async () => folderStore(asDir(fd)) },
    { kind: 'opfs', dir: od, open: () => opfsStore('paint', id) },
  ]
}

ok('⑬ 安全写（资料夹与 OPFS）：外面改过 ⇒ 自动存不写、回 changed-outside、立刻通知 watch 一次；force 照写；只改时间不算；没读过不写；peek 不当基准；档不在照写', async () => {
  for (const b of await bothBackends()) {
    const tag = (s: string) => `[${b.kind}] ${s}`
    const s = await b.open()
    assert.equal(s.backend, b.kind)
    assert.deepEqual(await s.writeJSONSafe({ v: 0 }), { written: true }, tag('档不在 ⇒ 照写（新工程）'))
    await s.writeJSON({ v: 1 })
    assert.deepEqual(await s.readJSON(), { v: 1 })
    assert.deepEqual(await s.writeJSONSafe({ v: 2 }), { written: true }, tag('没人动过 ⇒ 写'))
    const hits: number[] = []
    const stop = s.watch(c => hits.push(c.lastModified), 15)
    await sleep(30)
    b.dir.setText('project.json', JSON.stringify({ v: 'AI' }))          // 用户的 AI 改了
    const r = await s.writeJSONSafe({ v: 3 })
    assert.equal(r.written, false, tag('外面改过 ⇒ 不写'))
    assert.ok(!r.written && r.reason === 'changed-outside' && typeof r.lastModified === 'number', tag(JSON.stringify(r)))
    assert.equal(b.dir.text('project.json'), JSON.stringify({ v: 'AI' }), tag('档还是外面那份'))
    assert.equal(hits.length, 1, tag('立刻通知 watch 一次'))
    await sleep(60)
    assert.equal(hits.length, 1, tag('watch 下一轮不为同一版再报'))
    assert.equal((await s.writeJSONSafe({ v: 3 })).written, false, tag('再自动存一次还是不写'))
    assert.equal(await s.changedOutside(), true)
    assert.equal(hits.length, 1, tag('同一版不重复报'))
    assert.deepEqual(await s.writeJSONSafe({ v: 4 }, { force: true }), { written: true }, tag('force 照写'))
    assert.deepEqual(JSON.parse(b.dir.text('project.json')), { v: 4 })
    assert.deepEqual(await s.writeJSONSafe({ v: 5 }), { written: true }, tag('force 写完基准跟上'))
    b.dir.touch('project.json')                                         // 只改时间
    assert.deepEqual(await s.writeJSONSafe({ v: 6 }), { written: true }, tag('只改时间、内容一样 ⇒ 照写'))
    b.dir.setText('project.json', JSON.stringify({ v: 'AI2' }))
    assert.equal((await s.writeJSONSafe({ v: 7 })).written, false)
    assert.deepEqual(await s.readJSON(), { v: 'AI2' })                  // 使用者选了重新载入 ⇒ 编辑器重读
    assert.deepEqual(await s.writeJSONSafe({ v: 8 }), { written: true }, tag('重读后基准是新那版 ⇒ 写'))
    assert.equal(hits.length, 2, tag('第二次外改也报了'))
    stop()
    // 新会话：没读过就不写；peek 读不当基准；正常读之后才写
    const s2 = await b.open()
    assert.equal((await s2.writeJSONSafe({ v: 9 })).written, false, tag('这个会话没读过、档却在 ⇒ 不写'))
    await s2.readJSON({ peek: true })
    assert.equal((await s2.writeJSONSafe({ v: 9 })).written, false, tag('peek 不当基准'))
    await s2.readJSON()
    assert.deepEqual(await s2.writeJSONSafe({ v: 9 }), { written: true })
  }
})

ok('⑭ saveProjectSafe（编辑器自动存的接口）：外面改过 ⇒ 素材与 project.json 都不写、回 changed-outside；force 照写；save 里的 writeJSON 走安全写；别的错照丢', async () => {
  for (const b of await bothBackends()) {
    const s = await b.open()
    const save = (doc: { v: number }) => async (st: ProjectStore) => { await st.writeAsset('a.txt', `A${doc.v}`); await st.writeJSON({ format: 'dilin-studio/paint', version: 1, ...doc }) }
    assert.deepEqual(await saveProjectSafe(s, save({ v: 1 })), { written: true })
    assert.equal(await (await s.readAsset('a.txt'))!.text(), 'A1')
    b.dir.setText('project.json', JSON.stringify({ format: 'dilin-studio/paint', version: 1, v: 99 }))
    const r = await saveProjectSafe(s, save({ v: 2 }))
    assert.ok(!r.written && r.reason === 'changed-outside', `[${b.kind}] ${JSON.stringify(r)}`)
    assert.equal(await (await s.readAsset('a.txt'))!.text(), 'A1', `[${b.kind}] 被挡下时素材也不写`)
    assert.equal(JSON.parse(b.dir.text('project.json')).v, 99)
    assert.deepEqual(await saveProjectSafe(s, save({ v: 3 }), { force: true }), { written: true })
    assert.equal(JSON.parse(b.dir.text('project.json')).v, 3)
    assert.equal(await (await s.readAsset('a.txt'))!.text(), 'A3')
    // 预检过了、save 跑到一半外面才改 ⇒ project.json 照样不写
    const racing = async (st: ProjectStore) => { b.dir.setText('project.json', JSON.stringify({ v: 'late' })); await st.writeJSON({ v: 4 }) }
    const r2 = await saveProjectSafe(s, racing)
    assert.equal(r2.written, false, `[${b.kind}] save 中途外改也不盖`)
    assert.equal(b.dir.text('project.json'), JSON.stringify({ v: 'late' }))
    await s.readJSON()
    await assert.rejects(saveProjectSafe(s, async () => { throw new Error('boom') }), /boom/)
  }
})

ok('⑮ 写 project.json 先写暂存档再换上：外部读者写到一半时只看到旧整份或没有档（第一次建）、读不到空档或半截；没 move／move 不肯盖 ⇒ 退回直接写、不留暂存档', async () => {
  const run = async (fo: FakeOptions, backend: 'folder' | 'opfs') => {
    const seen: Array<string | null> = []
    let d: FakeDir
    fo = { ...fo, onWrite: () => seen.push(d.peek('project.json')) }
    d = new FakeDir('工程', fo)
    const s = createHandleStore(asDir(d), { backend, label: backend === 'folder' ? d.name : '', opfsPath: backend === 'opfs' ? ['dilin-studio', 'docs', 'x'] : null })
    const v1 = { format: 'dilin-studio/docs', version: 1, body: 'x'.repeat(50) }
    const v2 = { ...v1, body: 'y'.repeat(80) }
    await s.writeJSON(v1)
    await s.writeJSON(v2)
    assert.deepEqual(await s.readJSON(), v2)
    assert.equal(d.peek(PROJECT_JSON_TMP), null, '不留暂存档')
    return seen
  }
  const full1 = JSON.stringify({ format: 'dilin-studio/docs', version: 1, body: 'x'.repeat(50) }, null, 2) + '\n'
  for (const backend of ['folder', 'opfs'] as const) {
    for (const nonAtomic of [false, true]) {
      const seen = await run({ move: 'overwrite', nonAtomic }, backend)
      assert.ok(seen.length >= 2, `[${backend}] onWrite 有叫到`)
      assert.deepEqual(seen, [null, full1], `[${backend}${nonAtomic ? '·就地写' : ''}] 第一次建时外面看不到 project.json、第二次只看到旧整份：${JSON.stringify(seen)}`)
    }
    // 退路：没有 move ／ move 不肯盖已存在的档 ⇒ 直接写，结果照样对、不留暂存档
    await run({ move: 'none' }, backend)
    const nov = await run({ move: 'no-overwrite' }, backend)
    assert.equal(nov[0], null, '第一次建（目标还不在）move 仍可用 ⇒ 外面看不到空档')
  }
})

ok('⑯ 顶栏改名写回 project.json 的 name（资料夹与 OPFS）：其余栏位原样；外面刚改过 ⇒ 不写；没工程档／同名 ⇒ 不写；外部改 name ⇒ 旁路读得到新名、不动基准', async () => {
  for (const b of await bothBackends()) {
    const s = await b.open()
    const doc = { format: 'dilin-studio/paint', version: 1, name: '旧名', layers: [{ id: 'l1' }] }
    assert.deepEqual(await writeProjectName(s, '新名'), { written: false, reason: 'no-project' })
    await s.writeJSON(doc)
    assert.deepEqual(await writeProjectName(s, '新名'), { written: true })
    assert.deepEqual(JSON.parse(b.dir.text('project.json')), { ...doc, name: '新名' }, `[${b.kind}] 只换 name`)
    assert.deepEqual(await writeProjectName(s, '新名'), { written: false, reason: 'unchanged' })
    b.dir.setText('project.json', JSON.stringify({ ...doc, name: 'AI 取的名' }))
    assert.equal(projectNameOf(await s.readJSON({ peek: true })), 'AI 取的名', '外部改 name ⇒ 外框读得到')
    const r = await writeProjectName(s, '再改')
    assert.ok(!r.written && r.reason === 'changed-outside', `[${b.kind}] ${JSON.stringify(r)}`)
    assert.equal(JSON.parse(b.dir.text('project.json')).name, 'AI 取的名', `[${b.kind}] 外面那份没被盖`)
  }
})

ok('⑰ 本机选档汇入 zip 的解压上限：project.json 5 MB 照收（网页自己存的大工程读得回来）、超过 32 MB 拒收；比例炸弹拒收（表头造假也拦）；不好压的大素材（影片）超过 64 MB 照收；项目太多拒收', async () => {
  const MiB = 1024 * 1024
  const PJ = { format: 'dilin-studio/docs', version: 1, name: '大工程' }
  const errIs = (code: string, detail?: string) => (e: unknown) => isStudioError(e) && e.code === code && (detail === undefined || e.detail === detail)
  assert.deepEqual(localZipLimits(1000), { maxEntries: ZIP_MAX_ENTRIES, maxJsonBytes: LOCAL_ZIP_MAX_JSON_BYTES, maxEntryBytes: LOCAL_ZIP_MIN_BUDGET_BYTES, maxTotalBytes: LOCAL_ZIP_MIN_BUDGET_BYTES })
  assert.equal(localZipLimits(100 * MiB).maxTotalBytes, LOCAL_ZIP_MAX_RATIO * 100 * MiB, '大 zip ⇒ 按比例')
  const deflate9 = (z: JSZip) => z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  // project.json 5 MB：本机收（链接那条拒收，见 import-link.test ⑦）
  const body = ' '.repeat(5 * MiB)
  const j5 = new JSZip(); j5.file('project.json', JSON.stringify({ ...PJ, body }))
  const p5 = await readProjectZip(await deflate9(j5), 'docs', 1)
  assert.equal((p5.json as { body: string }).body.length, body.length)
  // project.json 33 MB：拒收；表头造假也拦
  const j33 = new JSZip(); j33.file('project.json', JSON.stringify({ ...PJ, body: ' '.repeat(33 * MiB) }))
  const j33Bytes = await deflate9(j33)
  await assert.rejects(readProjectZip(j33Bytes, 'docs', 1), errIs('json_too_big', String(LOCAL_ZIP_MAX_JSON_BYTES)))
  // 比例炸弹：两个 40 MB 全零素材，zip 不到 1 MB ⇒ 上限＝保底 64 MB ⇒ 拒收
  const zeros = new Uint8Array(40 * MiB)
  const bz = new JSZip(); bz.file('project.json', JSON.stringify(PJ)); bz.file('assets/a.bin', zeros); bz.file('assets/b.bin', zeros)
  const bomb = await deflate9(bz)
  await assert.rejects(readProjectZip(bomb, 'docs', 1), errIs('zip_too_big', String(LOCAL_ZIP_MIN_BUDGET_BYTES)))
  await assert.rejects(readProjectZip(new Blob([bomb as BlobPart]), 'docs', 1), errIs('zip_too_big', String(LOCAL_ZIP_MIN_BUDGET_BYTES)), 'Blob（选档）同一条')
  // 不好压的素材 70 MB（像影片）：zip 本身也约 70 MB ⇒ 上限按 20 倍 ⇒ 照收、逐字节相同
  const vid = new Uint8Array(70 * MiB)
  require('node:crypto').randomFillSync(vid)
  const vz = new JSZip(); vz.file('project.json', JSON.stringify(PJ)); vz.file('assets/clip.mp4', vid)
  const vBytes = await vz.generateAsync({ type: 'uint8array' })
  const pv = await readProjectZip(vBytes, 'docs', 1)
  assert.equal(pv.assets.length, 1)
  assert.ok(Buffer.from(await pv.assets[0].data.arrayBuffer()).equals(Buffer.from(vid)), '素材逐字节相同')
  // 同一个 zip 指定小上限（等于给它一个很小的比例）⇒ 单档超过就停；表头造假（写 100 字）也一样
  const tiny = { maxEntries: ZIP_MAX_ENTRIES, maxJsonBytes: MiB, maxEntryBytes: 8 * MiB, maxTotalBytes: 100 * MiB }
  await assert.rejects(readProjectZip(bomb, 'docs', 1, tiny), errIs('zip_too_big', String(8 * MiB)))
  // 表头造假：一个 80 MB 全零素材写「解开只有 100 字」⇒ 照数实际的、在 64 MB 停（JSZip 自己要等整档解完才比大小）
  const lz = new JSZip(); lz.file('project.json', JSON.stringify(PJ)); lz.file('assets/big.bin', new Uint8Array(80 * MiB))
  const liar = await deflate9(lz)
  const dv = new DataView(liar.buffer, liar.byteOffset, liar.byteLength)
  let eocd = liar.length - 22
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--
  for (let i = 0, p = dv.getUint32(eocd + 16, true); i < dv.getUint16(eocd + 10, true); i++) {
    if (dv.getUint32(p + 24, true) > 100) { dv.setUint32(p + 24, 100, true); dv.setUint32(dv.getUint32(p + 42, true) + 22, 100, true) }   // 只改那个素材
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  await assert.rejects(readProjectZip(liar, 'docs', 1), errIs('zip_too_big', String(LOCAL_ZIP_MIN_BUDGET_BYTES)), '本机：表头造假的炸弹也拦')
  // 项目数
  const many = new JSZip(); many.file('project.json', JSON.stringify(PJ))
  for (let i = 0; Object.keys(many.files).length <= ZIP_MAX_ENTRIES; i++) many.file(`assets/f${i}.txt`, 'x')
  await assert.rejects(readProjectZip(await many.generateAsync({ type: 'uint8array' }), 'docs', 1), errIs('zip_too_many', String(ZIP_MAX_ENTRIES)))
  // 三种错的白话（三语）：位元组写 MB、个数写数字、不露键名
  const { errorText } = require('./ui/common') as typeof import('./ui/common')
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
    const t = makeStudioT([STUDIO_SHARED_I18N], lang)
    const s = [new StudioError('zip_too_big', String(LOCAL_ZIP_MIN_BUDGET_BYTES)), new StudioError('json_too_big', String(LOCAL_ZIP_MAX_JSON_BYTES)), new StudioError('zip_too_many', '5000')]
      .map(e => errorText(t, e, 'x', 'docs', 1))
    assert.ok(s[0].includes('64 MB') && s[1].includes('32 MB') && s[2].includes('5000'), s.join(' / '))
    for (const x of s) assert.ok(!/studio_[a-z_]+|\{max\}/.test(x), x)
  }
})

void (async () => {
  let fail = 0
  for (const [n, f] of tests) {
    try { await f(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`) }
  }
  console.log(`studio shared → ${tests.length - fail} 过 ${fail} 败`)
  process.exit(fail ? 1 : 0)   // 题红时可能留着 watch 的计时器 ⇒ 直接收工，免得卡住
})()
