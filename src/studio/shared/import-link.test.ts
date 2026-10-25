/**
 * AI 交成品的链接题（/studio/<编辑器>?import=<https 网址> 与 #p=<压缩后的工程>）：
 *   认网址、只收 https、不带凭证、大小上限、表头检查、#p= 来回一致与上限、读进来存成浏览器里的新工程、白话错误。
 * 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./shared/import-link.test.ts')"
 * 药（各改坏一处，对应题必红）：
 *   readLinkSource 不认 #p= ⇒ ①；normalizeImportUrl 放行 http: ⇒ ②；github blob 不换 raw ⇒ ②；
 *   fetch 的 credentials 改 'include' 或拿掉 referrerPolicy ⇒ ③；拿掉 readBoundedBytes 的上限（maxBytes 传 Infinity）⇒ ③；
 *   不检查转址后的 https ⇒ ③；payloadFromBytes 不查 format ⇒ ③（HTML 当工程）；
 *   decodeProjectHash 拿掉长度检查 ⇒ ④；拿掉解压上限 ⇒ ④（压缩炸弹）；openLinkedProject 不用读进来的内容 ⇒ ⑤；
 *   linkErrorText 少一种 code ⇒ ⑥；errorText 不把 zip 上限写成 MB／个数 ⇒ ⑥；
 *   zip.ts readEntryBounded 不数位元组（上限当 Infinity）⇒ ⑦（炸弹、表头造假、project.json 超过 4 MB）；
 *   payloadFromBytes 不传 LINK_ZIP_LIMITS（退回本机那组）⇒ ⑦（project.json 5 MB 被收下）；
 *   拿掉载入后数 zip.files ⇒ ⑦（结尾目录少报个数）；两处项目数检查都拿掉 ⇒ ⑦（5001 个）。
 */
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { FakeDir, asDir } from './testing/fake-fs'
import { memoryRegistry } from './projects'
import { browserProjectEnv, type ProjectEnv } from './project-actions'
import { opfsStore } from './store'
import { makePlaceholderApp } from './placeholder'
import { STUDIO_SHARED_I18N, makeStudioT } from './i18n'
import { StudioError, isStudioError, type StudioLang } from './types'
import { ZIP_MAX_ENTRIES, readProjectZip } from './zip'
import {
  LINK_FETCH_MAX_BYTES, LINK_HASH_MAX_CHARS, LINK_INFLATED_MAX_BYTES, LINK_ZIP_LIMITS, LINK_ZIP_MAX_TOTAL_BYTES, StudioLinkError, buildImportLink, decodeProjectHash, encodeProjectHash,
  fetchProjectPayload, isStudioLinkError, normalizeImportUrl, openLinkedProject, payloadFromBytes, readLinkSource,
} from './import-link'

const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

const OPFS = new FakeDir('opfs-root')
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => asDir(OPFS) } } })
;(globalThis as { React?: unknown }).React = require('react')

const docs = makePlaceholderApp('docs')
const PJ = { format: 'dilin-studio/docs', version: 1, name: 'AI 做的报告', body: '第一段' }
const enc = (s: string) => new TextEncoder().encode(s)
const linkErr = (code: string, detail?: string) => (e: unknown) => isStudioLinkError(e) && e.code === code && (detail === undefined || e.detail === detail)

type Call = { url: string; init: RequestInit }
function fakeFetch(make: (url: string) => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => { calls.push({ url, init }); return make(url) }) as unknown as typeof fetch
}
function respond(body: Uint8Array | string, o: { status?: number; url?: string; headers?: Record<string, string> } = {}): Response {
  const r = new Response(typeof body === 'string' ? body : (body as unknown as BodyInit), { status: o.status ?? 200, headers: o.headers })
  Object.defineProperty(r, 'url', { value: o.url ?? 'https://raw.githubusercontent.com/x/y/main/p.zip' })
  return r
}

ok('① 认链接：?import= 取网址（解码）；#p= 取资料；两种都有 ⇒ #p= 优先；都没有 ⇒ null；组链接来回一致', () => {
  const u = 'https://raw.githubusercontent.com/a/b/main/out/报告.dilin-docs.zip'
  assert.deepEqual(readLinkSource(`?import=${encodeURIComponent(u)}`, ''), { kind: 'url', url: u })
  assert.deepEqual(readLinkSource('', '#p=abc_-1'), { kind: 'hash', data: 'abc_-1' })
  assert.deepEqual(readLinkSource('?import=https%3A%2F%2Fx.test%2Fp.json', '#p=zz'), { kind: 'hash', data: 'zz' })
  assert.equal(readLinkSource('?new=1', '#top'), null)
  assert.equal(readLinkSource('', ''), null)
  const base = 'https://dilinai.com/studio/docs'
  for (const src of [{ kind: 'url' as const, url: u }, { kind: 'hash' as const, data: 'AbC-_9' }]) {
    const link = new URL(buildImportLink(base, src))
    assert.deepEqual(readLinkSource(link.search, link.hash), src)
    assert.equal(`${link.origin}${link.pathname}`, base)
  }
})

ok('② 网址检查：只收 https、不收带帐密的；github.com 的 blob／raw 页换成 raw.githubusercontent.com', () => {
  for (const bad of ['http://dilinai.com/t/p.zip', 'javascript:alert(1)', 'data:application/json,{}', 'file:///etc/passwd', 'ftp://x.test/a', '', '/studio/docs', 'https://' + 'u:p@raw.githubusercontent.com/p.zip', 'https://' + 'u@raw.githubusercontent.com/p.zip']) {
    assert.throws(() => normalizeImportUrl(bad), linkErr('bad_url'), bad)
  }
  assert.equal(normalizeImportUrl('https://github.com/me/repo/blob/main/out/p.dilin-docs.zip'), 'https://raw.githubusercontent.com/me/repo/main/out/p.dilin-docs.zip')
  assert.equal(normalizeImportUrl('https://github.com/me/repo/raw/abc123/project.json'), 'https://raw.githubusercontent.com/me/repo/abc123/project.json')
  assert.equal(normalizeImportUrl(' https://dilinai.com/share/project.json '), 'https://dilinai.com/share/project.json', '别的 https 网址原样')
})

ok('③ 抓网址：不带凭证、不送 Referer；zip 与 project.json 都认；HTTP 错、太大（宣告与实读）、不是工程、别的编辑器、转去 http、连不上、逾时都丢对的错', async () => {
  const zip = new JSZip(); zip.file('project.json', JSON.stringify(PJ)); zip.file('assets/a.png', new Uint8Array([137, 80, 78, 71]))
  const zipBytes = await zip.generateAsync({ type: 'uint8array' })
  const calls: Call[] = []
  const p1 = await fetchProjectPayload('https://github.com/me/r/blob/main/p.zip', 'docs', 1, { fetch: fakeFetch(() => respond(zipBytes), calls) })
  assert.deepEqual(p1.json, PJ)
  assert.deepEqual(p1.assets.map(a => a.name), ['a.png'])
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/me/r/main/p.zip')
  assert.equal(calls[0].init.credentials, 'omit', '不带 cookie')
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer', '不送 Referer')
  assert.equal((calls[0].init.headers as unknown) ?? undefined, undefined, '不加任何表头（不带授权）')
  const p2 = await fetchProjectPayload('https://dilinai.com/t/project.json', 'docs', 1, { fetch: fakeFetch(() => respond('﻿' + JSON.stringify(PJ), { url: 'https://dilinai.com/t/project.json' })) })
  assert.deepEqual(p2, { json: PJ, assets: [] })
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => respond('nope', { status: 404 })) }), linkErr('fetch_failed', 'HTTP 404'))
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { maxBytes: 100, fetch: fakeFetch(() => respond('x', { headers: { 'content-length': '5000' } })) }), linkErr('too_big', '100'))
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { maxBytes: 100, fetch: fakeFetch(() => respond(new Uint8Array(500))) }), linkErr('too_big', '100'), '没宣告长度也边读边数')
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => respond('<!doctype html><title>login</title>')) }), linkErr('not_project'))
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => respond('{"hello":1}')) }), linkErr('not_project'), '没有 format 不当工程')
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => respond(JSON.stringify({ format: 'dilin-studio/sheets', version: 1 }))) }), (e: unknown) => isStudioError(e, 'bad_format'))
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => respond(JSON.stringify({ format: 'dilin-studio/docs', version: 9 }))) }), (e: unknown) => isStudioError(e, 'too_new'))
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => respond(JSON.stringify(PJ), { url: 'http://dilinai.com/t/p' })) }), linkErr('bad_url'), '转址到 http 不收')
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => { throw new TypeError('Failed to fetch') }) }), linkErr('fetch_failed', 'Failed to fetch'))
  const hang = fakeFetch((): Promise<Response> => new Promise(() => {}))
  const slow = ((u: string, init: RequestInit) => new Promise<Response>((_, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('aborted'))); void hang(u, init) })) as unknown as typeof fetch
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p', 'docs', 1, { fetch: slow, timeoutMs: 20 }), linkErr('fetch_failed', 'timeout'))
  await assert.rejects(fetchProjectPayload('http://dilinai.com/t/p', 'docs', 1, { fetch: fakeFetch(() => { throw new Error('不该去抓') }) }), linkErr('bad_url'), 'http 根本不去抓')
  assert.equal(LINK_FETCH_MAX_BYTES, 50 * 1024 * 1024)
})

ok('④ #p=：编码再解码一字不差（中文、长内容）；太长、不是 base64url、解不开、解出来不是工程、压缩炸弹都丢对的错；别的编辑器 ⇒ bad_format', async () => {
  const big = { ...PJ, body: '段落'.repeat(5000) + '😀' }
  const data = await encodeProjectHash(big)
  assert.match(data, /^[A-Za-z0-9_-]+$/, 'base64url、不补 =')
  assert.ok(data.length < JSON.stringify(big).length / 4, '有压缩')
  assert.deepEqual(await decodeProjectHash(data, 'docs', 1), { json: big, assets: [] })
  await assert.rejects(decodeProjectHash('A'.repeat(LINK_HASH_MAX_CHARS + 1), 'docs', 1), linkErr('too_big', 'hash'))
  await assert.rejects(decodeProjectHash('abc+/=', 'docs', 1), linkErr('bad_hash'))
  await assert.rejects(decodeProjectHash('AAAA_____', 'docs', 1), linkErr('bad_hash'))
  await assert.rejects(decodeProjectHash(await encodeProjectHash('只是一句话'), 'docs', 1), linkErr('bad_hash'))
  await assert.rejects(decodeProjectHash(await encodeProjectHash({ format: 'dilin-studio/paint', version: 1 }), 'docs', 1), (e: unknown) => isStudioError(e, 'bad_format'))
  const bomb = await encodeProjectHash({ ...PJ, body: ' '.repeat(LINK_INFLATED_MAX_BYTES + 10) })
  assert.ok(bomb.length < LINK_HASH_MAX_CHARS, '炸弹本身塞得进链接')
  await assert.rejects(decodeProjectHash(bomb, 'docs', 1), linkErr('too_big', String(LINK_INFLATED_MAX_BYTES)), '解压超过上限就停')
  // 跟 Node 的 zlib deflateRaw 同一种格式（仓里的出链接小工具用它）
  const zlib = require('node:zlib') as typeof import('node:zlib')
  const nodeData = zlib.deflateRawSync(Buffer.from(JSON.stringify(PJ))).toString('base64url')
  assert.deepEqual((await decodeProjectHash(nodeData, 'docs', 1)).json, PJ)
})

ok('⑤ 读进来存成浏览器里的新工程：内容与素材逐字相同、名字用工程档的 name、不当空工程沿用；读不进来什么都不建', async () => {
  const registry = memoryRegistry()
  let n = 1_900_000_000_000
  const env: ProjectEnv = { ...browserProjectEnv, registry, now: () => ++n }
  const rec = await openLinkedProject(env, docs, '缺省名', { kind: 'hash', data: await encodeProjectHash(PJ) })
  assert.equal(rec.backend, 'opfs'); assert.equal(rec.name, 'AI 做的报告'); assert.ok(!rec.blank)
  assert.deepEqual(await (await opfsStore('docs', rec.id)).readJSON(), PJ)
  const zip = new JSZip(); zip.file('project.json', JSON.stringify({ ...PJ, name: undefined })); zip.file('assets/pic.png', new Uint8Array([1, 2, 3]))
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const rec2 = await openLinkedProject(env, docs, '缺省名', { kind: 'url', url: 'https://dilinai.com/t/p.zip' }, { fetch: fakeFetch(() => respond(bytes, { url: 'https://dilinai.com/t/p.zip' })) })
  assert.equal(rec2.name, '缺省名')
  assert.deepEqual(new Uint8Array(await (await (await opfsStore('docs', rec2.id)).readAsset('pic.png'))!.arrayBuffer()), new Uint8Array([1, 2, 3]))
  assert.equal(registry.all().length, 2)
  await assert.rejects(openLinkedProject(env, docs, 'x', { kind: 'url', url: 'http://dilinai.com/t/p' }), linkErr('bad_url'))
  await assert.rejects(openLinkedProject(env, docs, 'x', { kind: 'hash', data: '!!' }), linkErr('bad_hash'))
  assert.equal(registry.all().length, 2, '失败不建工程')
})

// 数 JSZip 实际解压吐出来的位元组（包住 DEFLATE 的解压 worker），看炸弹是不是在解完之前就被停掉
const flate = require('jszip/lib/flate') as { uncompressWorker: () => { push(c: { data: Uint8Array }): void } }
async function countInflated<T>(f: () => Promise<T>): Promise<{ inflated: number; result: Promise<T> }> {
  const orig = flate.uncompressWorker
  let inflated = 0
  flate.uncompressWorker = () => {
    const w = orig()
    const push = w.push
    w.push = function (c) { inflated += c.data.byteLength; return push.call(this, c) }
    return w
  }
  const result = f()
  try { await result } catch { /* 交给调用的题判 */ } finally { flate.uncompressWorker = orig }
  return { inflated, result }
}
/** 把 zip 里解开大于 n 的每一项，在本地档头与中央目录写的「解压后大小」都改成 n（造假表头）。 */
function lieUncompressedSize(zipBytes: Uint8Array, n: number): Uint8Array {
  const u8 = zipBytes.slice()
  const dv = new DataView(u8.buffer)
  let eocd = u8.length - 22
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50)
    if (dv.getUint32(p + 24, true) > n) {
      dv.setUint32(p + 24, n, true)
      const local = dv.getUint32(p + 42, true)
      assert.equal(dv.getUint32(local, true), 0x04034b50)
      dv.setUint32(local + 22, n, true)
    }
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  return u8
}
const MiB = 1024 * 1024
const studioErr = (code: string, detail?: string) => (e: unknown) => isStudioError(e) && e.code === code && (detail === undefined || e.detail === detail)

ok('⑦ 链接带来的 zip 有解压上限：压缩炸弹解到上限就停（不解完）；表头造假照样停；项目太多拒收；project.json 超过 4 MB 拒收；正常工程原样读进来', async () => {
  assert.deepEqual({ ...LINK_ZIP_LIMITS }, { maxEntries: ZIP_MAX_ENTRIES, maxJsonBytes: LINK_INFLATED_MAX_BYTES, maxEntryBytes: LINK_FETCH_MAX_BYTES, maxTotalBytes: LINK_ZIP_MAX_TOTAL_BYTES })
  assert.equal(LINK_ZIP_MAX_TOTAL_BYTES, 64 * MiB)
  // 炸弹：三个 40 MB 全零素材（每个都没超过单档上限，合计 120 MB 超过 64 MB）
  const zeros = new Uint8Array(40 * MiB)
  const bz = new JSZip(); bz.file('project.json', JSON.stringify(PJ))
  for (const n of ['a.bin', 'b.bin', 'c.bin']) bz.file(`assets/${n}`, zeros)
  const bomb = await bz.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  assert.ok(bomb.length < 1 * MiB, `炸弹本身很小：${bomb.length}`)
  const viaFetch = await countInflated(() => fetchProjectPayload('https://dilinai.com/t/p.zip', 'docs', 1, { fetch: fakeFetch(() => respond(bomb)) }))
  await assert.rejects(viaFetch.result, studioErr('zip_too_big', String(LINK_ZIP_MAX_TOTAL_BYTES)), '合计超过 64 MB')
  assert.ok(viaFetch.inflated < LINK_ZIP_MAX_TOTAL_BYTES + 20 * MiB && viaFetch.inflated < 120 * MiB, `超过就停、没解完：解了 ${viaFetch.inflated}`)
  // 单档 80 MB 超过 50 MB
  const one = new JSZip(); one.file('project.json', JSON.stringify(PJ)); one.file('assets/big.bin', new Uint8Array(80 * MiB))
  const oneBytes = await one.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  const single = await countInflated(() => payloadFromBytes(oneBytes, 'docs', 1))
  await assert.rejects(single.result, studioErr('zip_too_big', String(LINK_FETCH_MAX_BYTES)), '单档超过 50 MB')
  assert.ok(single.inflated < LINK_FETCH_MAX_BYTES + 20 * MiB, `单档超过就停：解了 ${single.inflated}`)
  // 表头造假：那个素材写「解开只有 100 字」，实际解出 80 MB ⇒ 照数实际的、在 50 MB 停
  //   （JSZip 自己在一档解完时才比大小，那时已解完整档；这里要在那之前就停）
  const lied = await countInflated(() => payloadFromBytes(lieUncompressedSize(oneBytes, 100), 'docs', 1))
  await assert.rejects(lied.result, studioErr('zip_too_big', String(LINK_FETCH_MAX_BYTES)), '不信表头写的大小')
  assert.ok(lied.inflated < LINK_FETCH_MAX_BYTES + 20 * MiB, `表头造假也在上限就停：解了 ${lied.inflated}`)
  // 项目数：刚好 5000 个（含 assets/ 目录）收；多一个拒收；结尾目录少报个数也照数实际的
  const many = new JSZip(); many.file('project.json', JSON.stringify(PJ))
  for (let i = 0; Object.keys(many.files).length < ZIP_MAX_ENTRIES; i++) many.file(`assets/f${i}.txt`, 'x')
  const atLimit = await many.generateAsync({ type: 'uint8array' })
  assert.equal(Object.keys((await JSZip.loadAsync(atLimit)).files).length, ZIP_MAX_ENTRIES)
  assert.equal((await payloadFromBytes(atLimit, 'docs', 1)).assets.length, ZIP_MAX_ENTRIES - 2, '刚好上限照收')
  many.file('assets/one-more.txt', 'x')
  const over = await many.generateAsync({ type: 'uint8array' })
  await assert.rejects(payloadFromBytes(over, 'docs', 1), studioErr('zip_too_many', String(ZIP_MAX_ENTRIES)))
  const underReported = over.slice()
  const dv = new DataView(underReported.buffer)
  let eocd = underReported.length - 22
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--
  dv.setUint16(eocd + 8, 1, true); dv.setUint16(eocd + 10, 1, true)
  assert.equal(Object.keys((await JSZip.loadAsync(underReported)).files).length, ZIP_MAX_ENTRIES + 1, 'JSZip 不管宣告的个数、照样全读')
  await assert.rejects(payloadFromBytes(underReported, 'docs', 1), studioErr('zip_too_many', String(ZIP_MAX_ENTRIES)), '结尾目录少报个数也拦')
  // project.json 5 MB（压缩后很小）：链接 ⇒ 跟 #p= 同一个 4 MB 上限拒收（本机选档照收，见 shared.test ⑰）
  const bigJson = new JSZip(); bigJson.file('project.json', JSON.stringify({ ...PJ, body: ' '.repeat(5 * MiB) }))
  const bigJsonBytes = await bigJson.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  assert.ok(bigJsonBytes.length < 64 * 1024, `${bigJsonBytes.length}`)
  await assert.rejects(fetchProjectPayload('https://dilinai.com/t/p.zip', 'docs', 1, { fetch: fakeFetch(() => respond(bigJsonBytes)) }), studioErr('json_too_big', String(LINK_INFLATED_MAX_BYTES)))
  await assert.rejects(payloadFromBytes(lieUncompressedSize(bigJsonBytes, 10), 'docs', 1), studioErr('json_too_big', String(LINK_INFLATED_MAX_BYTES)), 'project.json 表头造假也拦')
  // 正常工程：链接与本机两条读出来一样、跟原档逐字节相同
  const pic = new Uint8Array(300_000); for (let i = 0; i < pic.length; i++) pic[i] = (i * 2654435761) >>> 24
  const normal = new JSZip(); normal.file('project.json', JSON.stringify(PJ)); normal.file('assets/pic.png', pic); normal.file('assets/note.txt', '你好')
  const normalBytes = await normal.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  const viaLink = await fetchProjectPayload('https://dilinai.com/t/p.zip', 'docs', 1, { fetch: fakeFetch(() => respond(normalBytes)) })
  const viaLocal = await readProjectZip(normalBytes, 'docs', 1)
  for (const p of [viaLink, viaLocal]) {
    assert.deepEqual(p.json, PJ)
    assert.deepEqual(p.assets.map(a => a.name).sort(), ['note.txt', 'pic.png'])
    assert.deepEqual(new Uint8Array(await p.assets.find(a => a.name === 'pic.png')!.data.arrayBuffer()), pic)
    assert.equal(await p.assets.find(a => a.name === 'note.txt')!.data.text(), '你好')
  }
})

ok('⑥ 白话错误：每种 code 三语都有字、不露键名；工程档本身的错照 errorText；DirectOpen 读链接、原地换网址（换不了才整页 replace）', () => {
  const { linkErrorText } = require('./ui/DirectOpen') as typeof import('./ui/DirectOpen')
  const cases: unknown[] = [
    new StudioLinkError('bad_url', 'http:'), new StudioLinkError('too_big', 'hash'), new StudioLinkError('too_big', String(LINK_FETCH_MAX_BYTES)),
    new StudioLinkError('fetch_failed', 'HTTP 404'), new StudioLinkError('not_project'), new StudioLinkError('bad_hash', 'x'),
  ]
  for (const lang of ['zh-TW', 'zh-CN', 'en'] as StudioLang[]) {
    const t = makeStudioT([STUDIO_SHARED_I18N], lang)
    const texts = cases.map(e => linkErrorText(t, e, t('studio_app_docs'), 'docs', 1))
    for (const s of texts) assert.ok(s && !/studio_[a-z_]+/.test(s), `${lang}: ${s}`)
    assert.equal(new Set(texts).size, texts.length, '每种说法不同')
    assert.deepEqual(texts, [
      t('studio_link_bad_url'), t('studio_link_too_long', { max: LINK_HASH_MAX_CHARS }), t('studio_link_too_big', { max: '50 MB' }),
      t('studio_link_fetch_failed', { detail: 'HTTP 404' }), t('studio_link_not_project'), t('studio_link_bad_hash'),
    ], '每种 code 用它自己那句')
    for (const k of ['studio_link_loading', 'studio_link_new_blank']) assert.ok(t(k) !== k, k)
    // zip 解压上限的错（StudioError）经 errorText：位元组上限写成 MB、个数写成数字
    const zipTexts = [
      new StudioError('zip_too_big', String(LINK_ZIP_MAX_TOTAL_BYTES)), new StudioError('zip_too_many', String(ZIP_MAX_ENTRIES)), new StudioError('json_too_big', String(LINK_INFLATED_MAX_BYTES)),
    ].map(e => linkErrorText(t, e, t('studio_app_docs'), 'docs', 1))
    for (const s of zipTexts) assert.ok(s && !/studio_[a-z_]+|\{max\}/.test(s), `${lang}: ${s}`)
    assert.deepEqual(zipTexts, [t('studio_err_zip_too_big', { max: '64 MB' }), t('studio_err_zip_too_many', { max: 5000 }), t('studio_err_json_too_big', { max: '4 MB' })])
    assert.ok(zipTexts[0].includes('64 MB') && zipTexts[1].includes('5000') && zipTexts[2].includes('4 MB'), zipTexts.join(' / '))
    assert.equal(new Set(zipTexts).size, 3)
  }
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'ui/DirectOpen.tsx'), 'utf8') as string
  assert.match(src, /readLinkSource\(window\.location\.search, window\.location\.hash\)/)
  assert.match(src, /const rec = await openLinkedProject\(env, def, name, src\)\s*go\(studioHref\.project\(app, rec\.id\), rec\.id\)/)
  assert.match(src, /w\.history\.replaceState\(w\.history\.state, '', href\)/)
})

void (async () => {
  let fail = 0
  for (const [n, f] of tests) {
    try { await f(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}\n    ${(e as Error).stack?.split('\n').slice(0, 5).join('\n    ')}`) }
  }
  console.log(`studio import link → ${tests.length - fail} 过 ${fail} 败`)
  process.exit(fail ? 1 : 0)
})()
