/**
 * 简报游客编辑器（Dilin Studio）的工程档题：project.json 读写来回一致、外面改档读得到、素材存取、FORMAT.md 范例能用。
 *   跑法：npm run test:studio-slides
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AssetInfo, ProjectStore } from '../shared/types'
import { isStudioError } from '../shared/types'
import { saveProjectSafe } from '../shared/store'
import { slidesFormat, slidesDocFromJson, slidesDocToJson, emptySlidesDoc, isAssetSrc, acceptAssetUrls, type SlidesDoc } from './format'
import { AssetUrlCache, assetNamesInDeck, inlineAssetsInHtml, safeAssetName, saveAssetFiles, uniqueAssetName } from './assets'
import { applyComponentOp } from './deck-components'
import { pageComponents } from './kit/components/derive'
import { compiledDeckToHtml } from './render-deck'
import { playHtmlOf } from './play-html'
import { missingKeys } from '../shared/i18n'
import { SLIDES_I18N } from './i18n'

let pass = 0, fail = 0
const queue: Array<[string, () => void | Promise<void>]> = []
const t = (name: string, fn: () => void | Promise<void>) => queue.push([name, fn])

/** 记忆体里的工程（照 ProjectStore 介面） */
class MemStore implements ProjectStore {
  readonly backend = 'opfs' as const
  readonly label = ''
  json: string | null = null
  mtime = 0
  assets = new Map<string, Blob>()
  /** 本会话上次读／写时看到的那一版（安全写拿它比对） */
  seen: string | null | undefined = undefined
  async readJSON<T = unknown>(o?: { peek?: boolean }): Promise<T | null> { if (!o?.peek) this.seen = this.json; return this.json === null ? null : JSON.parse(this.json) as T }
  async writeJSON(v: unknown): Promise<void> { this.json = JSON.stringify(v, null, 2) + '\n'; this.mtime++; this.seen = this.json }
  async changedOutside() { return this.json !== null && this.seen !== this.json }
  async writeJSONSafe(v: unknown, o?: { force?: boolean }) {
    if (!o?.force && await this.changedOutside()) return { written: false as const, reason: 'changed-outside' as const, lastModified: this.mtime }
    await this.writeJSON(v); return { written: true as const }
  }
  async lastModified() { return this.json === null ? null : this.mtime }
  async readAsset(name: string) { return this.assets.get(name) ?? null }
  async writeAsset(name: string, data: Blob | ArrayBuffer | Uint8Array | string) { this.assets.set(name, data instanceof Blob ? data : new Blob([data as BlobPart])) }
  async listAssets(): Promise<AssetInfo[]> { return [...this.assets].map(([name, b]) => ({ name, size: b.size, lastModified: 0, type: b.type })) }
  async deleteAsset(name: string) { this.assets.delete(name) }
  watch() { return () => {} }
}

const textComp = (id: string, text: string) => ({
  id, type: 'text', frame: { x: 80, y: 220, w: 840, h: 120, rotate: 0 },
  paragraphs: [{ runs: [{ text }], align: 'center' }],
  box: { font: 'theme:heading', size: 54, color: 'theme:text', align: 'center', valign: 'middle', lineHeight: 1.2, padding: 4 },
})

t('新开工程：存档再读回，内容一字不差（不带伺服器乐观戳）', async () => {
  const s = new MemStore()
  const d0 = emptySlidesDoc('zh-TW')
  await slidesFormat.save(s, { ...d0, name: '测试' })
  const j = JSON.parse(s.json!)
  assert.equal(j.format, 'dilin-studio/slides')
  assert.equal(j.version, 1)
  assert.equal(j.deck.revision, undefined, '不写 revision')
  const d1 = await slidesFormat.load(s)
  assert.equal(d1.name, '测试')
  assert.deepEqual(slidesDocToJson(d1), slidesDocToJson({ ...d0, name: '测试' }))
  // 再存一次，档一字不变
  const before = s.json
  await slidesFormat.save(s, d1)
  assert.equal(s.json, before)
})

t('project.json 不存在 ⇒ 新的空白工程；format 不对 ⇒ bad_format；版本太新 ⇒ too_new', async () => {
  const s = new MemStore()
  const d = await slidesFormat.load(s)
  assert.equal(d.deck.pages.length, 1)
  s.json = JSON.stringify({ format: 'dilin-studio/docs', version: 1 })
  await assert.rejects(slidesFormat.load(s), (e) => isStudioError(e, 'bad_format'))
  s.json = JSON.stringify({ format: 'dilin-studio/slides', version: 99, deck: {} })
  await assert.rejects(slidesFormat.load(s), (e) => isStudioError(e, 'too_new'))
  s.json = JSON.stringify({ format: 'dilin-studio/slides', version: 1, deck: { version: 1 } })
  await assert.rejects(slidesFormat.load(s), (e) => isStudioError(e, 'bad_format'))
})

t('AI 手写的页：有 components、版式跟 draft 对不上（blank＋cover／end）⇒ 改成空白页照样打开、components 留着；没 components 的错页照旧判坏', async () => {
  const comps = [{ id: 'c1', type: 'shape', shape: 'rect', frame: { x: 0, y: 0, w: 100, h: 100, rotate: 0 }, fill: '#C45C26' }]
  const base = emptySlidesDoc('zh-TW').deck as any
  const page = (draft: any, layoutId = 'blank', components: any = comps) => ({ ...base.pages[0], pid: 'p' + Math.random().toString(36).slice(2, 8), layoutId, draft, components })
  const deck = { ...base, pages: [page({ type: 'cover', title: '秋季新品' }), page({ type: 'end' }), page({ type: 'content', title: '', items: [] })] }
  const d = slidesDocFromJson({ format: 'dilin-studio/slides', version: 1, name: 'x', deck })
  assert.equal(d.deck.pages.length, 3)
  assert.deepEqual(d.deck.pages.map((p: any) => [p.layoutId, p.draft.type, p.components.length]), [['blank', 'content', 1], ['blank', 'content', 1], ['blank', 'content', 1]])
  assert.equal((d.deck.pages[0] as any).draft.title, '秋季新品')
  assert.equal(d.loadIssues?.filter((x) => x.includes('blank page')).length, 2)
  assert.throws(() => slidesDocFromJson({ format: 'dilin-studio/slides', version: 1, deck: { ...base, pages: [page({ type: 'cover', title: 'x' }, 'blank', [])] } }), (e: unknown) => isStudioError(e, 'bad_format'))
})

t('外面（用户自己的 AI）改了 project.json ⇒ 读进来就是改过的内容', async () => {
  const s = new MemStore()
  await slidesFormat.save(s, emptySlidesDoc('zh-TW'))
  const j = JSON.parse(s.json!)
  j.deck.pages[0].layoutId = 'blank'
  j.deck.pages[0].draft = { type: 'content', title: '', items: [] }
  j.deck.pages[0].components = [textComp('cAI00000001', 'AI 改的字')]
  s.json = JSON.stringify(j)
  const d = await slidesFormat.load(s)
  const comps = pageComponents(d.deck.pages[0], 0, 'zh-TW')
  assert.equal(comps.length, 1)
  assert.equal(comps[0].type === 'text' && comps[0].paragraphs[0].runs[0].text, 'AI 改的字')
  assert.equal(d.loadIssues, undefined)
})

t('自动存不盖外面改过的档：载入后外面改了 project.json ⇒ 自动存不写（留给外框问）；明确存档照写', async () => {
  const s = new MemStore()
  await slidesFormat.save(s, emptySlidesDoc('zh-TW'))
  const d = await slidesFormat.load(s)
  const j = JSON.parse(s.json!); j.name = '外面改的'; s.json = JSON.stringify(j); s.mtime++
  const r = await saveProjectSafe(s, (st) => slidesFormat.save(st, { ...d, name: '编辑器这边' }))
  assert.equal(r.written, false)
  assert.equal(JSON.parse(s.json!).name, '外面改的', '外面那版没被盖掉')
  const r2 = await saveProjectSafe(s, (st) => slidesFormat.save(st, { ...d, name: '编辑器这边' }), { force: true })
  assert.equal(r2.written, true); assert.equal(JSON.parse(s.json!).name, '编辑器这边')
  // 重新载入后（基准跟上）自动存照常
  const d2 = await slidesFormat.load(s)
  assert.equal((await saveProjectSafe(s, (st) => slidesFormat.save(st, { ...d2, name: '再改' }))).written, true)
})

t('程序动画的编译产物：读进来剥掉、存档不写（外面塞的假产物不算数）', async () => {
  const s = new MemStore()
  const d0 = emptySlidesDoc('zh-TW')
  const j = slidesDocToJson(d0) as { deck: { pages: Array<Record<string, unknown>> } }
  j.deck.pages[0].layoutId = 'blank'
  j.deck.pages[0].draft = { type: 'content', title: '', items: [] }
  j.deck.pages[0].components = [{ id: 'cProg000001', type: 'program', frame: { x: 0, y: 0, w: 400, h: 300, rotate: 0 }, html: '<p>x</p>', compiled: { v: 1, key: 'sha256:fake', doc: '<script>evil()</script>' } }]
  s.json = JSON.stringify({ format: 'dilin-studio/slides', version: 1, ...j })
  const d = await slidesFormat.load(s)
  const c = d.deck.pages[0].components![0] as Record<string, unknown>
  assert.equal(c.compiled, undefined, '读进来就剥掉')
  await slidesFormat.save(s, { ...d, deck: { ...d.deck, pages: [{ ...d.deck.pages[0], components: [{ ...c, compiled: { v: 1 } } as never] }] } })
  assert.ok(!s.json!.includes('"compiled"'), '存档不写编译产物')
})

t('不合格式的元件：丢掉那一个、记一句给人和 AI 看；其余照收', async () => {
  const s = new MemStore()
  const j = slidesDocToJson(emptySlidesDoc('zh-TW')) as { deck: { pages: Array<Record<string, unknown>> } }
  j.deck.pages[0].components = [textComp('cGood000001', 'ok'), { id: 'cBad0000001', type: 'text', frame: { x: 0, y: 0 } }, { id: 'cBadUrl0001', type: 'image', fit: 'cover', src: 'javascript:alert(1)', frame: { x: 0, y: 0, w: 10, h: 10, rotate: 0 } }]
  s.json = JSON.stringify({ format: 'dilin-studio/slides', version: 1, ...j })
  const d = await slidesFormat.load(s)
  assert.deepEqual(d.deck.pages[0].components!.map((c) => c.id), ['cGood000001'])
  assert.equal(d.loadIssues?.length, 2)
  assert.ok(d.loadIssues!.every((x) => /^page 1: component cBad/.test(x)))
})

t('工程素材 assets/<档名>：读档时收、编辑器挂着时能新增；没挂着时照旧只收 http(s)（登入版不变）', async () => {
  const j = slidesDocToJson(emptySlidesDoc('zh-TW')) as { deck: { pages: Array<Record<string, unknown>> } }
  j.deck.pages[0].components = [{ id: 'cImg0000001', type: 'image', fit: 'cover', src: 'assets/photo.png', frame: { x: 0, y: 0, w: 100, h: 100, rotate: 0 } }]
  const d = slidesDocFromJson({ format: 'dilin-studio/slides', version: 1, ...j })
  assert.equal(d.loadIssues, undefined)
  assert.equal((d.deck.pages[0].components![0] as { src: string }).src, 'assets/photo.png')
  const add = { kind: 'component_add', pageIndex: 0, component: { type: 'image', src: 'assets/b.png', frame: { x: 0, y: 0, w: 10, h: 10 } } } as const
  assert.equal(applyComponentOp(d.deck, add as never).ok, false, '没挂着 ⇒ 不收相对路径（药：拿掉开关就会收）')
  acceptAssetUrls(true)
  try { assert.equal(applyComponentOp(d.deck, add as never).ok, true, '挂着 ⇒ 收') } finally { acceptAssetUrls(false) }
  assert.equal(isAssetSrc('assets/../x'), false)
  assert.equal(isAssetSrc('assets/a/b.png'), false)
  assert.equal(isAssetSrc('assets/"x.png'), false)
})

t('素材存档：档名收安全、不撞名；整份 HTML 里的 assets/ 换成 data:（放映框读不到本页 blob:）', async () => {
  assert.equal(safeAssetName('我的 照片 (1).PNG'), '我的_照片_1_.PNG')
  assert.equal(uniqueAssetName('a.png', new Set(['a.png', 'a-2.png'])), 'a-3.png')
  const s = new MemStore()
  const g = globalThis as { URL: { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void } }
  const oc = g.URL.createObjectURL, orv = g.URL.revokeObjectURL
  g.URL.createObjectURL = () => 'blob:test'; g.URL.revokeObjectURL = () => {}
  try {
    const cache = new AssetUrlCache(s)
    const f = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const [r1] = await saveAssetFiles(s, cache, [f])
    const [r2] = await saveAssetFiles(s, cache, [f])
    assert.equal(r1.url, 'assets/a.png'); assert.equal(r2.url, 'assets/a-2.png')
    assert.equal(s.assets.size, 2)
    const html = await inlineAssetsInHtml('<img src="assets/a.png"><img src="assets/a-2.png"><img src="assets/none.png">', s, ['a.png', 'a-2.png', 'none.png'])
    assert.equal((html.match(/data:image\/png;base64,AQID/g) ?? []).length, 2)
    assert.ok(html.includes('assets/none.png'), '读不到的原样留着')
  } finally { g.URL.createObjectURL = oc; g.URL.revokeObjectURL = orv }
})

t('deck 里引用到的素材都列得出来（元件、组合里的、背景）', () => {
  const d = emptySlidesDoc('zh-TW').deck
  d.pages[0] = { ...d.pages[0], background: { imageUrl: 'assets/bg.jpg' }, components: [
    { id: 'c1', type: 'image', src: 'assets/a.png', fit: 'cover', frame: { x: 0, y: 0, w: 1, h: 1, rotate: 0 } },
    { id: 'g1', type: 'group', frame: { x: 0, y: 0, w: 1, h: 1, rotate: 0 }, children: [{ id: 'c2', type: 'video', src: 'assets/v.mp4', poster: 'assets/p.jpg', fit: 'cover', frame: { x: 0, y: 0, w: 1, h: 1, rotate: 0 } }] },
  ] as never }
  assert.deepEqual(assetNamesInDeck(d).sort(), ['a.png', 'bg.jpg', 'p.jpg', 'v.mp4'])
})

t('FORMAT.md 的最小范例：照它写的 project.json 读得进来、一个都不丢、渲得出放映 HTML', async () => {
  const md = fs.readFileSync(path.join(__dirname, 'FORMAT.md'), 'utf8')
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1])
  const example = blocks.find((b) => b.includes('"dilin-studio/slides"'))
  assert.ok(example, '找到范例')
  const s = new MemStore()
  s.json = example!
  const d = await slidesFormat.load(s)
  assert.equal(d.loadIssues, undefined, `范例有不合格的地方：${d.loadIssues?.join('；')}`)
  assert.equal(d.deck.pages[0].components?.length, 1)
  const html = playHtmlOf(await compiledDeckToHtml(d.deck, d.name))
  assert.ok(html.includes('Hello, slides'))
  assert.ok(html.includes('id="__slides_nav__"') && html.includes('__play_step_reset__'), '放映那份有导航与换页归零')
})

t('FORMAT.md 里每个 json 片段都是合法 JSON（AI 会照抄）', () => {
  const md = fs.readFileSync(path.join(__dirname, 'FORMAT.md'), 'utf8')
  for (const m of md.matchAll(/```json\n([\s\S]*?)```/g)) {
    const src = m[1].trim()
    if (src.startsWith('"')) JSON.parse(`{${src}}`)
    else JSON.parse(src)
  }
})

t('字典三语齐全', () => {
  assert.deepEqual(missingKeys(SLIDES_I18N), [])
})

t('给 AI 的格式摘要三语都有、不写境外服务名', () => {
  for (const l of ['zh-TW', 'zh-CN', 'en'] as const) {
    const x = slidesFormat.summaryForAI(l)
    assert.ok(x.includes('dilin-studio/slides') && x.includes('1000×562.5'))
    assert.ok(!/google|github|claude|openai|chatgpt/i.test(x))
  }
})

t('开源可拆：slides 只 import 自己目录、../shared、npm 套件', () => {
  const root = __dirname
  const bad: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'ext') walk(p); continue }
      if (!/\.tsx?$/.test(e.name)) continue
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1]
        if (spec.startsWith('@/') || spec.startsWith('@dilinai/')) { bad.push(`${path.relative(root, p)} ⇒ ${spec}`); continue }
        if (!spec.startsWith('.')) continue
        const abs = path.resolve(path.dirname(p), spec)
        const inSlides = abs === root || abs.startsWith(root + path.sep)
        const inShared = abs.startsWith(path.join(root, '..', 'shared'))
        if (!inSlides && !inShared) bad.push(`${path.relative(root, p)} ⇒ ${spec}`)
      }
    }
  }
  walk(root)
  assert.deepEqual(bad, [])
})

t('零伺服器：码里不写本站接口路径；下载 PowerPoint 外站图直取失败时，没给代理就不再发第二个请求', async () => {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue
      const code = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (/['"`]\/api\//.test(code)) hits.push(path.relative(__dirname, p))
    }
  }
  walk(__dirname)
  assert.deepEqual(hits, [])

  const { fetchExportBitmap, newMeasureBudget } = await import('./pptx/pptx')
  const g = globalThis as unknown as { fetch: unknown; location: unknown }
  const saved = { fetch: g.fetch, location: g.location }
  const calls: string[] = []
  g.fetch = async (u: string) => { calls.push(u); throw new TypeError('blocked by CORS') }
  g.location = { href: 'https://dilinai.com/studio/slides/x', origin: 'https://dilinai.com' }
  try {
    assert.equal(await fetchExportBitmap('https://github.com/a.png', newMeasureBudget('16x9')), null)
    assert.deepEqual(calls, ['https://github.com/a.png'], '没给代理：只直取那一次')
    calls.length = 0
    await fetchExportBitmap('https://github.com/a.png', newMeasureBudget('16x9', (u, k) => `/proxy?k=${k}&u=${encodeURIComponent(u)}`))
    assert.deepEqual(calls, ['https://github.com/a.png', '/proxy?k=image&u=https%3A%2F%2Fgithub.com%2Fa.png'], '给了代理：直取失败才走代理')
  } finally { g.fetch = saved.fetch; g.location = saved.location }
})

// ── 游客版整页的接口层（page/local-api.ts）：跟网站简报接口同形（回应码、栏位、乐观戳） ──
t('本机接口：读一份＝整行（标题、整份 HTML、结构、乐观戳）；别的编号 404', async () => {
  const { LocalSlidesApi } = await import('./page/local-api')
  const s = new MemStore()
  await slidesFormat.save(s, { name: '我的簡報', deck: emptySlidesDoc('zh-TW').deck })
  const api = new LocalSlidesApi(s, 'p1', () => ({ onDirtyChange() {} }))
  const r = await api.getSlide('p1')
  assert.equal(r.status, 200)
  const row = await r.json() as { id: string; title: string; html_content: string; deck_data: { revision: number; pages: unknown[] } }
  assert.equal(row.id, 'p1'); assert.equal(row.title, '我的簡報')
  assert.equal(row.deck_data.revision, 1, '乐观戳从 1 起（存档不写它）')
  assert.ok(row.html_content.includes('<section'), '带整份 HTML（左栏缩图、放映用）')
  assert.equal((await api.getSlide('nope')).status, 404)
})

t('本机接口：一笔结构化改动＝套用＋存进 project.json＋乐观戳 +1；戳对不上 ⇒ 409 带最新那行、档不动（药：拿掉戳比对这格红）', async () => {
  const { LocalSlidesApi } = await import('./page/local-api')
  const s = new MemStore()
  await slidesFormat.save(s, { name: '', deck: emptySlidesDoc('zh-TW').deck })
  const states: string[] = []
  const api = new LocalSlidesApi(s, 'p1', () => ({ onDirtyChange() {}, onSaveStateChange: (st) => { states.push(st) } }))
  await api.getSlide('p1')
  const op = { kind: 'component_add', pageIndex: 0, component: { type: 'text', frame: { x: 10, y: 10, w: 200, h: 60 } } }
  const ok = await api.patchDeck({ slideId: 'p1', expectedRevision: 1, op })
  assert.equal(ok.status, 200)
  const rec = await ok.json() as { componentId?: string; deck_data: { revision: number } }
  assert.ok(typeof rec.componentId === 'string', '新元件编号（撤销栈要接）')
  assert.equal(rec.deck_data.revision, 2)
  const saved = await slidesFormat.load(s)
  assert.ok(pageComponents(saved.deck.pages[0], 0, 'zh-TW').some((c) => c.id === rec.componentId), '存进 project.json')
  assert.ok(!('revision' in (JSON.parse(s.json!) as { deck: object }).deck), '乐观戳不写进档')
  assert.ok(states.includes('saving') && states[states.length - 1] === 'saved', '存档状态报给外框')
  const before = s.json
  const stale = await api.patchDeck({ slideId: 'p1', expectedRevision: 1, op })
  assert.equal(stale.status, 409)
  const j = await stale.json() as { code: string; current: { deck_data: { revision: number } } }
  assert.equal(j.code, 'err_aislides_conflict'); assert.equal(j.current.deck_data.revision, 2)
  assert.equal(s.json, before, '409 不写档')
})

t('本机接口：改名＝写 project.json 的 name（清空退「未命名」）；要后端的（版本、分享、角色、我的模板、整份原创模板）一律 404／不支援', async () => {
  const { LocalSlidesApi } = await import('./page/local-api')
  const s = new MemStore()
  await slidesFormat.save(s, { name: 'A', deck: emptySlidesDoc('zh-TW').deck })
  const api = new LocalSlidesApi(s, 'p1', () => ({ onDirtyChange() {} }))
  await api.getSlide('p1')
  assert.equal((await api.patchDeck({ slideId: 'p1', expectedRevision: 1, op: { kind: 'rename', title: '新名字' } })).status, 200)
  assert.equal((await slidesFormat.load(s)).name, '新名字')
  const r2 = await api.patchDeck({ slideId: 'p1', expectedRevision: 2, op: { kind: 'rename', title: '   ' } })
  assert.equal((await r2.json() as { title: string }).title, '未命名簡報')
  const call = api as unknown as Record<string, () => Promise<Response>>
  for (const m of ['listVersions', 'getVersion', 'restoreVersion', 'putSlide', 'setEditorAgent', 'listUserTemplates', 'saveUserTemplate', 'deleteUserTemplate', 'createDeck', 'createSlide']) assert.equal((await call[m]()).status, 404, m)
  const tpl = await api.patchDeck({ slideId: 'p1', expectedRevision: 3, op: { kind: 'apply_template', templateId: 'dilin-business' } })
  assert.equal(tpl.status, 400, '整份原创模板要网站的模板本体：不支援')
})

t('整页（page/SlidesPage.tsx）只经宿主拿资料：不直接 fetch、不写网站接口路径、不碰登入（药：把任一 host.api.* 改回 fetch 这格红）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'page', 'SlidesPage.tsx'), 'utf8')
  assert.ok(!/\bfetch\(/.test(src), '整页里没有 fetch(')
  assert.ok(!/createClient|supabase|LanguageContext|next\/navigation/.test(src), '整页不碰网站登入、字典、路由')
  for (const m of ['getSlide', 'patchDeck', 'uploadMedia', 'deckRevision', 'deckHtml']) assert.ok(src.includes(`host.api.${m}(`), `经宿主 ${m}`)
  for (const f of ['drive', 'share', 'userTemplates', 'deckTemplates']) assert.ok(src.includes(`host.has('${f}')`), `要后端的 ${f} 看宿主`)
})

t('选模板缩图：网站照旧 /templates/slides/<id>/thumb.webp；开源单页版是相对路径 templates/…（药：templateDir 写死绝对路径 ⇒ 红）', async () => {
  const { SLIDES_TEMPLATE_CATALOG, templateDir } = await import('./templates/catalog')
  assert.equal(process.env.NEXT_PUBLIC_STUDIO_STANDALONE, undefined, '本题以网站设定载目录')
  for (const e of SLIDES_TEMPLATE_CATALOG) assert.equal(e.thumb, `/templates/slides/${e.id}/thumb.webp`, `网站缩图 ${e.id}`)
  assert.equal(templateDir('site', 'x'), '/templates/site/x')
  process.env.NEXT_PUBLIC_STUDIO_STANDALONE = '1'
  try {
    assert.equal(templateDir('slides', 'plain-white'), 'templates/slides/plain-white')
    assert.equal(templateDir('site', 'x'), 'templates/site/x')
  } finally { delete process.env.NEXT_PUBLIC_STUDIO_STANDALONE }
})

t('游客版选模板弹窗列得出的每张卡（不含整份原创）都能经本机接口套用：换主题 200、主题换上（不要网站、不抓档）', async () => {
  const { LocalSlidesApi } = await import('./page/local-api')
  const { SLIDES_TEMPLATE_CATALOG, withoutDeckTemplates } = await import('./templates/catalog')
  const guest = SLIDES_TEMPLATE_CATALOG.filter(withoutDeckTemplates)
  assert.ok(guest.length > 0 && guest.every((e) => e.load.kind === 'theme'), '游客版列的都是主题卡')
  const realFetch = globalThis.fetch
  globalThis.fetch = (() => { throw new Error('套用模板不该抓网路') }) as typeof fetch
  try {
    const s = new MemStore()
    await slidesFormat.save(s, { name: 'A', deck: emptySlidesDoc('zh-TW').deck })
    const api = new LocalSlidesApi(s, 'p1', () => ({ onDirtyChange() {} }))
    await api.getSlide('p1')
    let rev = 1
    for (const e of guest) {
      if (e.load.kind !== 'theme') continue
      const r = await api.patchDeck({ slideId: 'p1', expectedRevision: rev, op: { kind: 'set_theme', themeId: e.load.themeId } })
      assert.equal(r.status, 200, `套用 ${e.id}`)
      const rec = await r.json() as { deck_data: { revision: number; themeId?: string } }
      rev = rec.deck_data.revision
      assert.equal((await slidesFormat.load(s)).deck.themeId, e.load.themeId, `${e.id} 主题存进档`)
    }
  } finally { globalThis.fetch = realFetch }
})

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log(`  ✓ ${name}`) }
    catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error)?.stack ?? e}`) }
  }
  console.log(`\nstudio-slides: ${pass} 过 · ${fail} 败`)
  if (fail) process.exitCode = 1
})()
