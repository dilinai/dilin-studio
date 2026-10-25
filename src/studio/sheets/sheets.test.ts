// 游客版表格：工程档读写、外部改档读回、xlsx／csv 本机互转、字串齐全、开源边界。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./sheets/sheets.test.ts')"
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { AssetInfo, ExternalChange, ProjectStore } from '../shared/types'
import { isStudioError } from '../shared/types'
import { missingKeys, STUDIO_SHARED_I18N } from '../shared/i18n'
import { saveProjectSafe } from '../shared/store'
import { sheetsFormat, docFromJson, docToJson, assetNamesIn, type SheetsDoc } from './format'
import { SHEETS_I18N } from './i18n'
import { sheetToCsv } from './engine/csv'
import { buildXlsxBytes, parseXlsx } from './engine/xlsx-io'
import { resolveXlsxImages } from './engine/xlsx-images'
import type { AgentContent } from './engine/agent-ops'
import { buildCondFormatter, condCellCss, DATA_BAR_DEFAULT, COLOR_SCALE_DEFAULT } from './engine/cond-format'

let passed = 0, failed = 0
const queue: Array<[string, () => void | Promise<void>]> = []
const t = (name: string, fn: () => void | Promise<void>) => { queue.push([name, fn]) }

/** 记在记忆体里的工程（同 ProjectStore 介面）；outsideWrite＝模拟用户自己的 AI 直接改 project.json */
function memoryStore(): ProjectStore & { outsideWrite(json: unknown): void; raw(): string | null } {
  let json: string | null = null
  let mtime = 0
  let base = 0 // 编辑器上次读进／写出的那一版（比对外面有没有改过）
  const assets = new Map<string, Blob>()
  return {
    backend: 'opfs', label: '',
    async readJSON<T>(o?: { peek?: boolean }) { if (!o?.peek) base = mtime; return json === null ? null : JSON.parse(json) as T },
    async writeJSON(v) { json = JSON.stringify(v, null, 2) + '\n'; mtime++; base = mtime },
    async changedOutside() { return mtime !== base },
    async writeJSONSafe(v, o) {
      if (!o?.force && mtime !== base) return { written: false as const, reason: 'changed-outside' as const, lastModified: mtime }
      json = JSON.stringify(v, null, 2) + '\n'; mtime++; base = mtime
      return { written: true as const }
    },
    async lastModified() { return json === null ? null : mtime },
    async readAsset(name) { return assets.get(name) ?? null },
    async writeAsset(name, data) { assets.set(name, data instanceof Blob ? data : new Blob([data as BlobPart])) },
    async listAssets(): Promise<AssetInfo[]> { return [...assets].map(([name, b]) => ({ name, size: b.size, lastModified: 0, type: b.type })) },
    async deleteAsset(name) { assets.delete(name) },
    watch(_cb: (c: ExternalChange) => void) { return () => {} },
    outsideWrite(v: unknown) { json = JSON.stringify(v); mtime++ },
    raw: () => json,
  }
}

const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))

const RICH: SheetsDoc = {
  name: '月报',
  sheets: [
    {
      id: 's1', name: '收支',
      content: {
        cells: {
          A1: { v: '品项', s: { b: true, bg: '#f3f4f6', align: 'center' } },
          B1: { v: '金额', s: { b: true, border: { b: { style: 'thin', color: '#000000' } } } },
          A2: { v: '房租' }, B2: { v: '12000', s: { numFmt: { t: 'number', d: 2, k: true } } },
          A3: { v: '水电' }, B3: { v: '1850.5' },
          A4: { v: '合计' }, B4: { v: '', f: '=SUM(B2:B3)' },
          C1: { v: '有 "引号", 与逗号' },
        },
        merges: ['D1:E2'],
        colWidths: { A: 140 }, rowHeights: { '1': 32 },
        images: [{ id: 'img_a', url: 'assets/logo.png', cell: 'D4', w: 40, h: 40 }],
      },
    },
    { id: 's2', name: 'Sheet2', content: { cells: { A1: { v: 'x' } } } },
  ],
}

// ── ① project.json 读写来回一致 ──
t('① docFromJson(docToJson(doc)) 一字不差（含 assets/ 图、格式、合并、宽高）', () => {
  const back = docFromJson({ format: 'dilin-studio/sheets', version: 1, ...docToJson(RICH) })
  assert.deepEqual(back, RICH)
  // 药：format.ts 的 docFromJson 拿掉 { assetUrls: true } ⇒ assets/ 图被净化闸丢掉 ⇒ 这里红
  assert.equal(back.sheets[0].content.images?.[0]?.url, 'assets/logo.png')
  assert.deepEqual(assetNamesIn(back), ['logo.png'])
})
t('① save ⇒ load 经 ProjectStore 来回一致·表头在最前', async () => {
  const st = memoryStore()
  await sheetsFormat.save(st, RICH)
  const raw = st.raw()!
  assert.match(raw, /^\{\n {2}"format": "dilin-studio\/sheets",\n {2}"version": 1,/)
  assert.deepEqual(await sheetsFormat.load(st), RICH)
})
t('① 没有 project.json ⇒ 一张空表；坏表头 ⇒ bad_format／too_new；sheets 不是阵列 ⇒ bad_format', async () => {
  const st = memoryStore()
  const empty = await sheetsFormat.load(st)
  assert.equal(empty.sheets.length, 1)
  assert.deepEqual(empty.sheets[0].content, { cells: {} })
  st.outsideWrite({ format: 'dilin-studio/docs', version: 1 })
  await assert.rejects(sheetsFormat.load(st), e => isStudioError(e, 'bad_format'))
  st.outsideWrite({ format: 'dilin-studio/sheets', version: 2, sheets: [] })
  await assert.rejects(sheetsFormat.load(st), e => isStudioError(e, 'too_new'))
  st.outsideWrite({ format: 'dilin-studio/sheets', version: 1, sheets: {} })
  await assert.rejects(sheetsFormat.load(st), e => isStudioError(e, 'bad_format'))
})
t('① 坏值丢、不整份拒：坏格名／坏颜色／重复 id／http 以外的网址', () => {
  const d = docFromJson({ format: 'dilin-studio/sheets', version: 1, sheets: [
    { id: 'dup', name: '  甲  ', content: { cells: { a1: { v: 'x' }, A1: { v: 'ok', s: { bg: 'url(x)', size: 'big', b: true } } }, images: [{ id: 'i', url: 'javascript:alert(1)', cell: 'A1', w: 20, h: 20 }, { id: 'j', url: 'assets/../x', cell: 'A1', w: 20, h: 20 }] } },
    { id: 'dup', name: '', content: { cells: { B2: { v: '1' } } } },
    'junk',
  ] })
  assert.equal(d.sheets.length, 2)
  assert.deepEqual(d.sheets[0].content.cells, { A1: { v: 'ok', s: { b: true } } })
  assert.equal(d.sheets[0].content.images, undefined)
  assert.equal(d.sheets[0].name, '甲')
  assert.notEqual(d.sheets[1].id, 'dup')
  assert.equal(d.sheets[1].name, 'Sheet2')
})

// ── ② 外部改档后重新载入 ──
t('② 用户的 AI 直接改 project.json ⇒ 再 load 读到新内容（Shell 看到修改时间变了就重挂编辑器、编辑器重读）', async () => {
  const st = memoryStore()
  await sheetsFormat.save(st, RICH)
  const m0 = await st.lastModified()
  const j = JSON.parse(st.raw()!)
  j.sheets[0].content.cells.B3 = { v: '2000' }
  j.sheets.push({ id: 's3', name: 'AI 加的', content: { cells: { A1: { v: '', f: '=1+1' } } } })
  st.outsideWrite(j)
  assert.notEqual(await st.lastModified(), m0)
  const again = await sheetsFormat.load(st)
  assert.equal(again.sheets[0].content.cells?.B3?.v, '2000')
  assert.deepEqual(again.sheets.map(s => s.name), ['收支', 'Sheet2', 'AI 加的'])
})
t('② 整页设成重挂（softReload 不开）：外部改档后外框用新 key 重挂、整页挂载时重读；游客版不另写外壳', () => {
  const idx = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  assert.doesNotMatch(idx, /softReload:\s*true/)
  // 游客版＝登入版搬来的同一份整页（药：guestPage 拿掉或改回另写的 Editor ⇒ 红）
  assert.match(idx, /guestPage: SheetsGuestPage/)
  assert.throws(() => readFileSync(join(__dirname, 'Editor.tsx'), 'utf8'), '另写的游客外壳已删')
  const g = readFileSync(join(__dirname, 'page/guest.tsx'), 'utf8')
  assert.match(g, /<SheetPage host=\{host\} \/>/)
  // 外框每次重绘换新回调 ⛔ 触发重读（药：资料层依赖改回 props 回调本身 ⇒ 外层每次重绘都把刚打的字洗掉）
  assert.match(g, /const data = useMemo\(\(\) => createGuestSheetsData\(\{[\s\S]*?\}\), \[store, projectId\]\)/)
  assert.match(g, /\}, \[projectId, data, store\]\)/, '本页宿主不随外框宿主换（换了整页会重载整份表格）')
  // 外框 flush 才强写（药：拿掉 withForce ⇒ 红）
  assert.match(g, /cbRef\.current\.registerFlush\?\.\(flush \? async \(\) => \{ await data\.withForce\(flush\) \} : null\)/)
  const gd = readFileSync(join(__dirname, 'page/guest-data.ts'), 'utf8')
  assert.match(gd, /saveProjectSafe\(o\.store, s => sheetsFormat\.save\(s, p\.next\), \{ force: force > 0 \}\)/, '自动存走底座安全写')
  // 卸载时 ⛔ 自动补存（不然「重新载入」会被手上的旧稿盖回去）
  const page = readFileSync(join(__dirname, 'page/SheetPage.tsx'), 'utf8')
  assert.doesNotMatch(page, /return \(\) => \{[^}]*(flushSaves|saveNow)\(/)
})

t('② 游客资料层：新增／改名／删页签照同一份规则；存档带版次（撞版 409 零写）；几张同时存不互相盖掉', async () => {
  const { createGuestSheetsData } = await import('./page/guest-data')
  const st = memoryStore()
  await sheetsFormat.save(st, RICH)
  const states: string[] = []
  const d = createGuestSheetsData({ store: st, fallbackName: () => '清单名', onSaveState: s => states.push(s) })
  const rec = (await d.getDoc())!
  assert.equal(rec.title, '月报'); assert.deepEqual(rec.sheets.map(s => [s.name, s.position]), [['收支', 0], ['Sheet2', 1]])
  const add = await d.addSheet({ prefix: '表格' })
  assert.ok(add.ok); if (!add.ok) return
  assert.equal(add.data.sheet.name, '表格1'); assert.equal(add.data.sheets.length, 3)
  const sid = add.data.sheet.id
  // 两张同时存（页面 flushSaves 是 Promise.all）⇒ 两笔都在档里
  const base1 = rec.sheets[0].updated_at, base2 = add.data.sheet.updated_at
  const [r1, r2] = await Promise.all([d.saveSheet('s1', { cells: { A1: { v: '一' } } }, base1), d.saveSheet(sid, { cells: { B2: { v: '二' } } }, base2)])
  assert.ok(r1.ok && r2.ok)
  const disk = await sheetsFormat.load(st)
  assert.equal(disk.sheets[0].content.cells.A1?.v, '一'); assert.equal(disk.sheets[2].content.cells.B2?.v, '二')
  // 旧版次 ⇒ 409 零写（药：拿掉版次比对 ⇒ 这里 ok）
  const stale = await d.saveSheet('s1', { cells: { A1: { v: '旧' } } }, base1)
  assert.equal(stale.ok, false); assert.equal(!stale.ok && stale.status, 409)
  assert.equal((await sheetsFormat.load(st)).sheets[0].content.cells.A1?.v, '一')
  // 改名空白 ⇒ err_sheet_empty_name；删到剩一张 ⇒ err_sheet_last
  const rn = await d.renameSheet('s2', '   ')
  assert.equal(!rn.ok && rn.code, 'err_sheet_empty_name')
  assert.ok((await d.renameSheet('s2', ' 新名 ')).ok)
  assert.equal((await sheetsFormat.load(st)).sheets[1].name, '新名')
  assert.ok((await d.deleteSheet('s2')).ok); assert.ok((await d.deleteSheet(sid)).ok)
  const last = await d.deleteSheet('s1')
  assert.equal(!last.ok && last.code, 'err_sheet_last')
  // 标题：带 baseTitle 而现在不同 ⇒ 409；照写 ⇒ 存进 name
  assert.equal((await d.putTitle('甲', '不是这个')).status, 409)
  assert.ok((await d.putTitle(' 季报 ')).ok)
  assert.equal((await sheetsFormat.load(st)).name, '季报')
  assert.ok(states.includes('saving') && states.includes('saved'))
})

t('② 游客资料层：外面改过 project.json ⇒ 自动存不写、回失败（留给外框问）；外框 flush（withForce）才盖过去', async () => {
  const { createGuestSheetsData } = await import('./page/guest-data')
  const st = memoryStore()
  await sheetsFormat.save(st, RICH)
  const d = createGuestSheetsData({ store: st })
  const rec = (await d.getDoc())!
  st.outsideWrite({ format: 'dilin-studio/sheets', version: 1, name: 'AI 改的', sheets: [] })
  const r = await d.saveSheet('s1', { cells: { A1: { v: '我的' } } }, rec.sheets[0].updated_at)
  assert.equal(r.ok, false)
  assert.equal(JSON.parse(st.raw()!).name, 'AI 改的', '外面改的那份没被盖掉')
  assert.equal(d.current()!.sheets[0].content.cells.A1?.v, '品项', '没写成 ⇒ 记忆体那份不动')
  const f = await d.withForce(() => d.saveSheet('s1', { cells: { A1: { v: '我的' } } }, rec.sheets[0].updated_at))
  assert.ok(f.ok)
  assert.equal(JSON.parse(st.raw()!).sheets[0].content.cells.A1.v, '我的')
})

t('② 外面改过 project.json ⇒ 自动存不写（留给外框问）；明确存档才盖过去', async () => {
  const st = memoryStore()
  await sheetsFormat.save(st, RICH)
  await sheetsFormat.load(st)
  st.outsideWrite({ format: 'dilin-studio/sheets', version: 1, name: 'AI 改的', sheets: [] })
  const r = await saveProjectSafe(st, s => sheetsFormat.save(s, RICH))
  assert.equal(r.written, false)
  assert.equal(JSON.parse(st.raw()!).name, 'AI 改的', '外面改的那份没被盖掉')
  assert.equal((await saveProjectSafe(st, s => sheetsFormat.save(s, RICH), { force: true })).written, true)
  assert.equal(JSON.parse(st.raw()!).name, '月报')
})

// ── ③ 汇出 xlsx 再汇入，内容不变（走浏览器那条 Uint8Array 路） ──
const sheetsIn = (d: SheetsDoc) => d.sheets.map(s => ({ name: s.name, content: s.content as AgentContent }))
t('③ xlsx：buildXlsxBytes ⇒ parseXlsx(Uint8Array) 值、公式、格式、合并、宽高都回得来', () => {
  const bytes = buildXlsxBytes(sheetsIn(RICH))
  const plain = new Uint8Array(bytes.byteLength); plain.set(bytes)   // 不是 Buffer ⇒ 走浏览器那条路
  assert.equal(Buffer.isBuffer(plain), false)
  // 药：engine/xlsx-io.ts 的 zipPreflight 改回 b.readUInt32LE ⇒ 这里抛 TypeError 红
  const res = parseXlsx(plain)
  assert.deepEqual(res.sheets.map(s => s.name), ['收支', 'Sheet2'])
  const c = res.sheets[0].content
  assert.equal(c.cells?.A2?.v, '房租')
  assert.equal(c.cells?.B2?.v, '12000')
  assert.deepEqual(c.cells?.B2?.s?.numFmt, { t: 'number', d: 2, k: true })
  assert.equal(c.cells?.B4?.f, '=SUM(B2:B3)')
  assert.equal(c.cells?.A1?.s?.b, true)
  assert.equal(c.cells?.A1?.s?.bg, '#f3f4f6')
  assert.equal(c.cells?.B1?.s?.border?.b?.style, 'thin')
  assert.equal(c.cells?.C1?.v, '有 "引号", 与逗号')
  assert.deepEqual(c.merges, ['D1:E2'])
  assert.equal(c.colWidths?.A, 140)
  assert.equal(c.rowHeights?.['1'], 32)
  assert.equal(res.sheets[1].content.cells?.A1?.v, 'x')
})
t('③ xlsx 带图：assets/ 里的图经 resolveXlsxImages 写进档、汇入读回同一份位元组', async () => {
  const st = memoryStore()
  await st.writeAsset('logo.png', PNG_1x1)
  const r = await resolveXlsxImages(sheetsIn(RICH), {
    async fetchBytes(url) { const b = url.startsWith('assets/') ? await st.readAsset(url.slice(7)) : null; return b ? new Uint8Array(await b.arrayBuffer()) : null },
  })
  assert.equal(r.skipped, 0)
  const bytes = buildXlsxBytes(sheetsIn(RICH), r.media)
  const res = parseXlsx(Uint8Array.from(bytes))
  assert.equal(res.images.length, 1)
  assert.deepEqual([...res.images[0].bytes], [...PNG_1x1])
  assert.equal(res.images[0].image.cell, 'D4')
})
t('③ csv 汇入（浏览器路·Uint8Array）：UTF-8 中文不乱码、有无 BOM 都行、引号逗号照 RFC 4180', () => {
  // 药：engine/xlsx-io.ts 拿掉「纯文字档先 TextDecoder 解成字串」那段 ⇒ 没 BOM 的中文变乱码 ⇒ 红
  const plain = parseXlsx(new TextEncoder().encode('名字,数量\r\n苹果,3\r\n"有,逗号",007\r\n'))
  const c = plain.sheets[0].content.cells ?? {}
  assert.equal(c.A1?.v, '名字'); assert.equal(c.A2?.v, '苹果'); assert.equal(c.B2?.v, '3'); assert.equal(c.A3?.v, '有,逗号')
  const bom = new TextEncoder().encode('\uFEFF名字,数量\r\n蘋果,3\r\n')
  const browser = parseXlsx(Uint8Array.from(bom))
  assert.equal(browser.sheets[0].content.cells?.A1?.v, '名字')
  // 带 BOM 时与服务端（Buffer）那条读出一样
  assert.deepEqual(browser.sheets.map(s => s.content), parseXlsx(Buffer.from(bom)).sheets.map(s => s.content))
})

// ── ④ csv 汇出 ──
t('④ sheetToCsv：显示值（公式取结果·数字格式照显示）＋RFC 4180 引号＋BOM', () => {
  const csv = sheetToCsv(RICH.sheets[0].content)
  assert.ok(csv.startsWith('\uFEFF'))
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines[0], '品项,金额,"有 ""引号"", 与逗号"')
  assert.equal(lines[1], '房租,"12,000.00",')
  assert.equal(lines[3], '合计,13850.5,')
  assert.equal(sheetToCsv({ cells: {} }, { bom: false }), '')
})

// ── ④b 顶栏「匯出 csv」「匯入 xlsx／csv」 ──
t('④b 匯出 csv：BOM 开头·逗号／引号／换行照 RFC 4180 加引号·只出给它的那一张·档名「标题-页签名.csv」', async () => {
  const { buildSheetCsv, csvFileName } = await import('./page/sheet-io')
  const content = { cells: { A1: { v: '名字' }, B1: { v: '備註' }, A2: { v: '王小明' }, B2: { v: '甲,乙' }, A3: { v: '說 "好"' }, B3: { v: '第一行\n第二行' } } }
  const other = { cells: { A1: { v: '別張' } } }
  const r = buildSheetCsv({ docTitle: '月報', sheetName: '收支', content, lang: 'zh-TW' })
  // 药：sheet-io.ts buildSheetCsv 的 bom: true 改成 false ⇒ 这里红
  assert.ok(r.text.startsWith('﻿'), '开头要有 UTF-8 BOM')
  assert.equal(r.text.slice(1), '名字,備註\r\n王小明,"甲,乙"\r\n"說 ""好""","第一行\n第二行"\r\n')
  assert.doesNotMatch(r.text, /別張/, '只出目前这张')
  assert.equal(buildSheetCsv({ docTitle: '月報', sheetName: '別張', content: other, lang: 'en' }).text, '﻿別張\r\n')
  assert.equal(r.fileName, '月報-收支.csv')
  assert.equal(csvFileName(' a/b\\c ', 'x:y'), 'a b c-x y.csv')
  assert.equal(csvFileName('', ''), 'sheet.csv')
  // 整页取的是「目前这张」的内容（药：downloadCsv 改成拿 sheets[0] ⇒ 红）
  const page = readFileSync(join(__dirname, 'page/SheetPage.tsx'), 'utf8')
  assert.match(page, /const sid = currentSheetIdRef\.current[\s\S]{0,200}buildSheetCsv\(\{[^}]*sheetName: sheet\.name, content: contentsRef\.current\[sid\]/)
})

t('④b 匯入接线：选的档原样交给宿主 importWorkbook；副档名不对／太大／浏览器读不出 ⇒ 不送；宿主错误码 ⇒ 白话那句', async () => {
  const { runSheetImport, sheetImportFailReason, SHEET_IMPORT_FAIL_KEY } = await import('./page/sheet-io')
  const got: File[] = []
  type Reply = Awaited<ReturnType<NonNullable<import('./page/host').SheetsPageHost['importWorkbook']>>>
  let reply: Reply = { ok: true, status: 201, data: { id: 'n1', title: '報表', href: '/ai-sheet/n1', warnings: [] } }
  const host = { importWorkbook: async (f: File) => { got.push(f); return reply } }
  const xlsx = new File([buildXlsxBytes([{ name: 'A', content: { cells: { A1: { v: '1' } } } }, { name: 'B', content: { cells: {} } }]) as Uint8Array<ArrayBuffer>], '報表.xlsx')
  // 药：runSheetImport 里 host.importWorkbook(file) 改成传别的（例如 new File([], file.name)）⇒ 这里红
  const ok = await runSheetImport(host, xlsx)
  assert.deepEqual(ok, { ok: true, id: 'n1', title: '報表', href: '/ai-sheet/n1', imagesSkipped: false })
  assert.equal(got.length, 1); assert.equal(got[0], xlsx, '宿主收到的就是选的那个档')
  // 浏览器路真读（不注入 parse）：csv 中文＋逗号照样过
  const csv = new File([new TextEncoder().encode('名字,數量\r\n"甲,乙",3\r\n')], '清單.csv', { type: 'text/csv' })
  assert.equal((await runSheetImport(host, csv)).ok, true); assert.equal(got.length, 2)
  // 副档名不对 ⇒ 不送
  assert.deepEqual(await runSheetImport(host, new File(['x'], 'a.png')), { ok: false, reason: 'bad_type' })
  // 太大 ⇒ 不送（上限注入成 4 位元组）
  assert.deepEqual(await runSheetImport(host, new File(['12345'], 'a.csv'), { parse: () => {}, maxBytes: 4 }), { ok: false, reason: 'too_big' })
  // 浏览器读不出 ⇒ 不送；读出来超过张数／格数 ⇒ too_big
  assert.deepEqual(await runSheetImport(host, new File(['x'], 'a.xlsx'), { parse: () => { throw new Error('bad') }, maxBytes: 99 }), { ok: false, reason: 'bad_file' })
  assert.deepEqual(await runSheetImport(host, new File(['x'], 'a.xlsx'), { parse: () => { throw Object.assign(new Error('big'), { code: 'err_xlsx_too_large' }) }, maxBytes: 99 }), { ok: false, reason: 'too_big' })
  assert.equal(got.length, 2, '🔴 前面拒的四次都没送到宿主')
  // 宿主回错 ⇒ 对应那句
  reply = { ok: false, status: 413, code: 'content_too_large' }
  assert.deepEqual(await runSheetImport(host, xlsx), { ok: false, reason: 'sheet_too_big' })
  reply = { ok: true, status: 201, data: { id: 'n2', title: 'x', href: '/ai-sheet/n2', warnings: ['1 picture(s) from the file could not be saved to the drive and were left out.'] } }
  assert.equal((await runSheetImport(host, xlsx) as { imagesSkipped: boolean }).imagesSkipped, true)
  assert.equal(sheetImportFailReason(401), 'login')
  assert.equal(sheetImportFailReason(413, 'err_xlsx_too_large'), 'too_big')
  assert.equal(sheetImportFailReason(400, 'err_xlsx_bad_file'), 'bad_file')
  assert.equal(sheetImportFailReason(413, 'err_storage_quota'), 'quota')
  assert.equal(sheetImportFailReason(500, 'err_xlsx_import_unconfirmed'), 'unconfirmed')
  assert.equal(sheetImportFailReason(500), 'failed')
  for (const k of Object.values(SHEET_IMPORT_FAIL_KEY)) assert.ok(k in SHEETS_I18N['zh-TW'], `字典缺 ${k}`)
  // 宿主没给 importWorkbook ⇒ 不叫
  assert.deepEqual(await runSheetImport({}, xlsx), { ok: false, reason: 'failed' })
})

t('④b 两颗钮按宿主 has() 开关：匯入还要有 importWorkbook；整页照 sheetIoButtons 画', async () => {
  const { sheetIoButtons } = await import('./page/sheet-io')
  const { SHEET_FEATURES } = await import('./page/host')
  assert.equal(SHEET_FEATURES.xlsxImport, 'xlsxImport'); assert.equal(SHEET_FEATURES.csvExport, 'csvExport')
  const imp = async () => ({ ok: false as const, status: 0 })
  assert.deepEqual(sheetIoButtons({ has: () => false, importWorkbook: imp }), { importOn: false, csvOn: false })
  assert.deepEqual(sheetIoButtons({ has: () => true, importWorkbook: imp }), { importOn: true, csvOn: true })
  assert.deepEqual(sheetIoButtons({ has: () => true }), { importOn: false, csvOn: true }, '没给 importWorkbook ⇒ 匯入钮不画')
  assert.deepEqual(sheetIoButtons({ has: f => f === 'csvExport', importWorkbook: imp }), { importOn: false, csvOn: true })
  // 药：SheetPage 顶栏拿掉 {io.importOn && 或 {io.csvOn && ⇒ 这里红（匯出 csv 在「匯出」下拉里·匯入有宽屏钮＋窄屏「⋯」项＋选档框三处）
  const page = readFileSync(join(__dirname, 'page/SheetPage.tsx'), 'utf8')
  assert.match(page, /const io = sheetIoButtons\(host\)/)
  assert.match(page, /\{io\.csvOn && \(\s*<button[\s\S]{0,200}?data-testid="sheet-download-csv"/)
  assert.match(page, /\{io\.importOn && \(\s*<button[\s\S]{0,200}?data-testid="sheet-import"/)
  assert.match(page, /\{io\.importOn && \(\s*<button[\s\S]{0,200}?data-testid="sheet-import-menuitem"/, '窄屏「⋯」里的匯入也在闸里')
  assert.match(page, /\{io\.importOn && \(\s*<input[\s\S]{0,200}?data-testid="sheet-import-input"/, '选档框也在闸里')
  assert.equal((page.match(/data-testid="sheet-download-csv"|data-testid="sheet-import"/g) ?? []).length, 2, '钮只在 has() 闸里各出现一次')
})

// 游客版跟登入版一样开这两颗钮：
//   匯出 csv＝同一支 buildSheetCsv；匯入＝游客宿主 importWorkbook 在浏览器本机读档、建成这个浏览器里的一份新工程（page/guest-import.ts·不打 /api）。
//   负控（环境变量药）：DILIN_NEG=guest_sheet_import_off ⇒ 游客宿主不给 importWorkbook ⇒ 下面「游客版两颗钮都开」「游客匯入走本机」「游客匯入 csv」「游客匯入 xlsx」「游客匯入超限」五题红。
/** 记忆体工程清单＋假 OPFS（每个工程编号一份 memoryStore） */
async function memoryProjectEnv() {
  const { memoryRegistry } = await import('../shared/projects')
  const registry = memoryRegistry()
  const stores = new Map<string, ReturnType<typeof memoryStore>>()
  let n = 0
  const env = {
    registry,
    async openOpfs(_app: string, id: string) { let s = stores.get(id); if (!s) { s = memoryStore(); stores.set(id, s) } return s },
    async deleteOpfs(_app: string, id: string) { stores.delete(id) },
    openFolder: () => { throw new Error('no folder') },
    folderAllowed: async () => false,
    now: () => 1_700_000_000_000,
    newId: () => (++n).toString(16).padStart(32, '0'),
  }
  return { env: env as unknown as import('../shared/project-actions').ProjectEnv, registry, stores }
}
async function guestImport(file: File, envIn?: Awaited<ReturnType<typeof memoryProjectEnv>>) {
  const m = envIn ?? await memoryProjectEnv()
  const { guestSheetIoHost } = await import('./page/guest-import')
  const host = guestSheetIoHost(m.env)
  assert.equal(typeof host.importWorkbook, 'function', '游客宿主要给 importWorkbook')
  return { ...m, r: await host.importWorkbook!(file) }
}

t('④b 游客版两颗钮都开：表格功能表列了 xlsxImport／csvExport·外框真宿主 has() 认·游客宿主给 importWorkbook·整页照 sheetIoButtons 两颗都画', async () => {
  ;(globalThis as { React?: unknown }).React = require('react')     // sucrase 转 JSX 用 React.createElement
  const app = (await import('./index')).default
  assert.equal(app.guestFeatures?.xlsxImport, true); assert.equal(app.guestFeatures?.csvExport, true)
  const { makeGuestHost } = await import('../shared/guest-host')
  const gh = makeGuestHost({ appDef: app as never, record: {} as never, store: memoryStore(), lang: 'zh-TW', session: {} as never, onExport() {}, navigate() {} })
  assert.equal(gh.has('xlsxImport'), true); assert.equal(gh.has('csvExport'), true)
  const { sheetIoButtons } = await import('./page/sheet-io')
  const { guestSheetIoHost } = await import('./page/guest-import')
  const m = await memoryProjectEnv()
  assert.deepEqual(sheetIoButtons({ has: f => gh.has(f), ...guestSheetIoHost(m.env) }), { importOn: true, csvOn: true })
  // 游客宿主真的接上那一支（has 照外框·importWorkbook 由 guest-import 给）
  const g = readFileSync(join(__dirname, 'page/guest.tsx'), 'utf8')
  assert.match(g, /has: f => b\(\)\.has\(f\),/)
  assert.match(g, /\.\.\.guestSheetIoHost\(\),/)
  // 匯入钮提示：游客版换「存成这个浏览器里」的说法（三语都有·不再说云盘）
  const page = readFileSync(join(__dirname, 'page/SheetPage.tsx'), 'utf8')
  assert.match(page, /const importTitle = host\.kind === 'guest' \? t\('sheet_import_title_guest'\) : t\('sheet_import_title'\)/)
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as const) {
    const s = (SHEETS_I18N[lang] as Record<string, string>).sheet_import_title_guest
    assert.ok(s && !/雲端硬碟|云盘|cloud drive/i.test(s), `${lang}: ${s}`)
  }
})

t('④b 游客匯入走本机：游客匯入那支源码不含 /api/·匯入全程不叫 fetch', async () => {
  // 只看程式码（注释里讲「跟服务端 /api/… 同一份解析」那几句不算）
  const src = readFileSync(join(__dirname, 'page/guest-import.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  assert.match(src, /export async function guestImportWorkbook/, '去注释后程式码还在')
  assert.doesNotMatch(src, /\/api\//)
  assert.doesNotMatch(src, /\bfetch\(/)
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => { calls++; throw new Error('不该打网路') }) as typeof fetch
  try {
    const { r } = await guestImport(new File([new TextEncoder().encode('a,b\r\n1,2\r\n')], 'x.csv', { type: 'text/csv' }))
    assert.equal(r.ok, true, JSON.stringify(r))
  } finally { globalThis.fetch = realFetch }
  assert.equal(calls, 0)
})

t('④b 游客匯入 csv：建出一份新工程（清单一笔＋project.json）·名字＝档名去副档名·中文逗号引号逐格对·开启网址＝/studio/sheets/<编号>·撞名加 (2)', async () => {
  const csv = () => new File([new TextEncoder().encode('名字,備註\r\n王小明,"甲,乙"\r\n')], '名單.csv', { type: 'text/csv' })
  const m = await memoryProjectEnv()
  const { r } = await guestImport(csv(), m)
  assert.ok(r.ok, JSON.stringify(r))
  const d = (r as { data: { id: string; title: string; href: string } }).data
  assert.equal(d.title, '名單'); assert.equal(d.href, `/studio/sheets/${d.id}`)
  const rec = await m.registry.get(d.id)
  assert.equal(rec?.app, 'sheets'); assert.equal(rec?.backend, 'opfs'); assert.equal(rec?.name, '名單'); assert.notEqual(rec?.blank, true)
  const doc = await sheetsFormat.load(m.stores.get(d.id)!)
  assert.equal(doc.name, '名單'); assert.equal(doc.sheets.length, 1)
  const cells = doc.sheets[0].content.cells
  assert.equal(cells.A1?.v, '名字'); assert.equal(cells.B1?.v, '備註'); assert.equal(cells.A2?.v, '王小明'); assert.equal(cells.B2?.v, '甲,乙')
  // 同名再匯一次 ⇒ 名單 (2)·第一份不动
  const again = await guestImport(csv(), m)
  assert.equal((again.r as { data: { title: string } }).data.title, '名單 (2)')
  assert.equal((await m.registry.list('sheets')).length, 2)
})

t('④b 游客匯入 xlsx：两张工作表（中文页签名·数值·公式·粗体·图）逐张进新工程·图写进工程 assets/', async () => {
  // 测试里现做一份 xlsx（同一支 buildXlsxBytes／SheetJS）·第一张放一张图（drawing）
  const xlsxWithPic = buildXlsxBytes([
    { name: '一月', content: { cells: { A1: { v: '品名', s: { b: true } }, B1: { v: '100' }, B2: { v: '50' }, B3: { f: '=SUM(B1:B2)', v: '' } }, images: [{ id: 'p1', url: 'x', cell: 'C3', w: 10, h: 10 }] } as AgentContent },
    { name: '二月', content: { cells: { A1: { v: 'x' } } } as AgentContent },
  ], { images: new Map([['0:p1', { bytes: PNG_1x1, ext: 'png' as const }]]) })
  const m = await memoryProjectEnv()
  const { r } = await guestImport(new File([xlsxWithPic as Uint8Array<ArrayBuffer>], '月報.xlsx'), m)
  assert.ok(r.ok, JSON.stringify(r))
  const d = (r as { data: { id: string; title: string } }).data
  assert.equal(d.title, '月報')
  const store = m.stores.get(d.id)!
  const doc = await sheetsFormat.load(store)
  assert.deepEqual(doc.sheets.map(s => s.name), ['一月', '二月'])
  const c1 = doc.sheets[0].content
  assert.equal(c1.cells.A1?.v, '品名'); assert.equal(c1.cells.A1?.s?.b, true); assert.equal(c1.cells.B1?.v, '100'); assert.equal(c1.cells.B3?.f, '=SUM(B1:B2)')
  assert.equal(doc.sheets[1].content.cells.A1?.v, 'x')
  const imgs = c1.images ?? []
  assert.equal(imgs.length, 1, '图要进来')
  assert.match(imgs[0].url, /^assets\/img-[a-z0-9]+-[0-9a-f]{12}\.png$/)
  const blob = await store.readAsset(imgs[0].url.slice('assets/'.length))
  assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), PNG_1x1)
})

t('④b 游客匯入超限／坏档：超 10MB ⇒ err_xlsx_too_large（413）·超 50 万格 ⇒ err_xlsx_too_large·单张超 2MB ⇒ content_too_large·非表格 ⇒ err_xlsx_not_spreadsheet·读不出 ⇒ err_xlsx_bad_file·都不建工程·白话对上（没有登入／云盘那两句）', async () => {
  const { sheetImportFailReason } = await import('./page/sheet-io')
  const { IMPORT_MAX_BYTES, IMPORT_MAX_CELLS } = await import('./engine/xlsx-io')
  const m = await memoryProjectEnv()
  const cases: Array<[File, number, string, string]> = []
  cases.push([new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], 'big.csv'), 413, 'err_xlsx_too_large', 'too_big'])
  // 50 万格以上（每格一个字·约 1MB 的 csv）
  const cols = 100, rows = Math.ceil((IMPORT_MAX_CELLS + 1) / cols)
  const line = Array(cols).fill('1').join(',') + '\n'
  cases.push([new File([line.repeat(rows)], 'cells.csv'), 413, 'err_xlsx_too_large', 'too_big'])
  // 单张 2MB 以上：两万格、每格 200 字（档本身约 4MB < 10MB·格数 2 万 < 50 万）
  const fat = Array(10).fill('x'.repeat(200)).join(',') + '\n'
  cases.push([new File([fat.repeat(2_000)], 'fat.csv'), 413, 'content_too_large', 'sheet_too_big'])
  cases.push([new File(['x'], 'a.png', { type: 'image/png' }), 400, 'err_xlsx_not_spreadsheet', 'bad_type'])
  cases.push([new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])], 'broken.xlsx'), 400, 'err_xlsx_bad_file', 'bad_file'])
  for (const [file, status, code, reason] of cases) {
    const { r } = await guestImport(file, m)
    assert.deepEqual(r, { ok: false, status, code }, file.name)
    assert.equal(sheetImportFailReason(status, code), reason, file.name)
  }
  assert.equal((await m.registry.list('sheets')).length, 0, '🔴 超限／坏档一份都不建')
  assert.equal(m.stores.size, 0, '🔴 也没开 OPFS 夹')
})

// ── ⑤ 字串三语齐、画面用到的键都在 ──
t('⑤ SHEETS_I18N 三语键一致', () => { assert.deepEqual(missingKeys(SHEETS_I18N), []) })
t('⑤ 画面与编辑器里 t(\'…\') 用到的键都在字典里（药：删字典里任一个用到的键 ⇒ 红）', () => {
  // 整页与游客宿主（page/）也算；游客外框会一起喂底座字典（STUDIO_SHARED_I18N）⇒ 两本都认
  const tw = { ...STUDIO_SHARED_I18N['zh-TW'], ...SHEETS_I18N['zh-TW'] } as Record<string, string>
  const keys = new Set<string>(), prefixes = new Set<string>()
  const files = (dir: string) => readdirSync(join(__dirname, dir)).filter(n => /\.tsx?$/.test(n) && !n.includes('.test.')).map(n => `${dir}/${n}`)
  for (const f of [...files('page'), ...files('ui')]) {
    const s = readFileSync(join(__dirname, f), 'utf8')
    for (const m of s.matchAll(/\bt\(\s*'([a-z][a-z0-9_]+)'/g)) keys.add(m[1])
    for (const m of s.matchAll(/\bt\(\s*`([a-z][a-z0-9_]*_)\$\{/g)) prefixes.add(m[1])
  }
  const missing = [...keys].filter(k => !(k in tw))
  assert.deepEqual(missing, [])
  for (const p of prefixes) assert.ok(Object.keys(tw).some(k => k.startsWith(p)), `前缀 ${p} 一个键都没有`)
})

// ── ⑥ 开源边界：只准 import 自己目录、../shared、npm ──
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p) }
  return out
}
t('⑥ import 边界（药：任一档 import \'@/lib/…\' ⇒ 红）', () => {
  const bad: string[] = []
  for (const f of walk(__dirname)) {
    const rel = relative(__dirname, f).split('\\').join('/')
    const s = readFileSync(f, 'utf8')
    for (const m of s.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const spec = m[1]
      if (spec.startsWith('node:')) { if (!rel.endsWith('.test.ts')) bad.push(`${rel} → ${spec}`); continue }
      if (spec.startsWith('@/') || spec.startsWith('@dilinai/')) { bad.push(`${rel} → ${spec}`); continue }
      if (!spec.startsWith('.')) continue   // npm
      const target = relative(__dirname, join(f, '..', spec)).split('\\').join('/')
      if (target.startsWith('../shared') || !target.startsWith('..')) continue
      bad.push(`${rel} → ${spec}`)
    }
  }
  assert.deepEqual(bad, [])
})

t('⑦ 画不出的字：没对应字的键（\\u0000）不起编辑、写格前滤掉控制／零宽／私用区；中文、emoji、Tab 换行照留', () => {
  const { stripInvisible, isTypedKey } = require('./engine/formula') as typeof import('./engine/formula')
  for (const k of ['\u0000', '\u0007', '\u200B', '\uFEFF', '\uE000', '\t', 'Enter', 'Unidentified', 'Process', '']) assert.equal(isTypedKey(k), false, JSON.stringify(k))
  for (const k of ['a', '=', '1', '中', '，', '😀']) assert.equal(isTypedKey(k), true, k)
  assert.equal(stripInvisible('\u0000=D2*E2'), '=D2*E2')
  assert.equal(stripInvisible('\u200B急件\uFEFF\uE001'), '急件')
  assert.equal(stripInvisible('第一行\n第二\t欄'), '第一行\n第二\t欄')
  assert.equal(stripInvisible('👨\u200D👩\u200D👧 項目'), '👨\u200D👩\u200D👧 項目')
  const src = readFileSync(join(__dirname, 'ui', 'SheetGrid.tsx'), 'utf8')
  assert.match(src, /else if \(isTypedKey\(k\) && !e\.altKey\) \{ e\.preventDefault\(\); startEdit\(activePos, k\) \}/, '起编辑要过 isTypedKey')
  assert.ok(!/k\.length === 1 && !e\.altKey/.test(src), '不能再拿 k.length===1 当首字')
  assert.match(src, /const raw = stripInvisible\(rawIn\)/, 'writeCell 写格前滤')
  assert.match(src, /const v = stripInvisible\(e\.target\.value\)/, '输入法整段带入也滤')
})

t('⑧ 条件格式只给 type＋ranges（数据条／色阶没给 colors）：读档留住、补预设色、格上画出条（药：净化遇缺 colors 整条丢 ⇒ 红）', () => {
  const cells: Record<string, { v: string }> = { A1: { v: '值' } }
  ;['5', '20', '50', '80', '100'].forEach((v, i) => { cells[`A${i + 2}`] = { v } })
  const back = docFromJson({ format: 'dilin-studio/sheets', version: 1, name: 'bar', sheets: [{ id: 's1', name: 'S', content: { cells, condFormats: [
    { id: 'r1', ranges: ['A2:A6'], type: 'data_bar' },
    { id: 'r2', ranges: ['B2:B6'], type: 'color_scale' },
    { id: 'r3', ranges: ['C2:C6'], type: 'data_bar', colors: ['url(x)'] },   // 给了但坏 ⇒ 照旧丢
  ] } }] })
  const content = back.sheets[0].content as AgentContent
  assert.deepEqual(content.condFormats, [
    { id: 'r1', ranges: ['A2:A6'], type: 'data_bar', colors: [DATA_BAR_DEFAULT] },
    { id: 'r2', ranges: ['B2:B6'], type: 'color_scale', colors: COLOR_SCALE_DEFAULT },
  ])
  const fmt = buildCondFormatter(content)
  const lo = fmt.at(1, 0), hi = fmt.at(5, 0)
  assert.equal(lo?.bar?.color, DATA_BAR_DEFAULT)
  assert.equal(lo?.bar?.pct, 10, '最小值＝10%')
  assert.equal(hi?.bar?.pct, 90, '最大值＝90%')
  const css = condCellCss(hi, undefined)
  assert.match(String(css.backgroundImage), /^linear-gradient\(90deg, #638ec6/)
  assert.equal(css.backgroundSize, '90.0% calc(100% - 6px)')
  assert.equal(fmt.at(0, 0), null, '文字格不画')
})

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('✓', name) } catch (e) { failed++; console.log('RED', name, '：', (e as Error).message) }
  }
  console.log(`sheets.test: passed=${passed} failed=${failed}`)
  if (failed) process.exitCode = 1
})()
