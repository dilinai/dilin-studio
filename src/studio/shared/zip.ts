// 工程档汇出／汇入：<名字>.dilin-<app>.zip，里面 project.json＋assets/<档名>。
//   汇入接受：这种 zip（也接受「整个资料夹压起来」多包一层目录的 zip）、或直接一个资料夹（目录句柄或 <input webkitdirectory> 的档案清单）。
//   project.json 表头不对（format 不是 dilin-studio/<app>、version 太新）⇒ 丢 StudioError、⛔ 写进工程。
//   读 zip 有解压上限（项目数、project.json、单档、合计；见 ZipReadLimits），边解边数、超过就停。

import JSZip from 'jszip'
import type { ProjectPayload, ProjectStore, StudioApp, StudioAppId } from './types'
import { StudioError } from './types'
import { ASSETS_DIR, PROJECT_JSON, checkAssetName } from './store'
import { checkProjectHeader } from './project-file'
import { dirValues } from './fs-types'

export type { ProjectPayload } from './types'

/** 档名里不能用的字换掉；空 ⇒ project。 */
export function safeFileBase(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
  return s || 'project'
}
export function exportFileName(name: string, app: StudioAppId): string {
  return `${safeFileBase(name)}.dilin-${app}.zip`
}

/** 把 store 里的整份工程读成 payload（project.json＋全部 assets）。没有 project.json ⇒ 丢 no_project_json。 */
export async function readAll(store: ProjectStore): Promise<ProjectPayload> {
  const json = await store.readJSON({ peek: true })   // 旁路读：不动安全写的基准
  if (json === null) throw new StudioError('no_project_json')
  if (typeof json !== 'object' || Array.isArray(json)) throw new StudioError('bad_format', Array.isArray(json) ? 'array' : typeof json)
  const assets: ProjectPayload['assets'] = []
  for (const a of await store.listAssets()) {
    const b = await store.readAsset(a.name)
    if (b) assets.push({ name: a.name, data: b })
  }
  return { json: json as Record<string, unknown>, assets }
}

/** 把一份 payload 打成 zip（Blob）：project.json（缩排 2 格、结尾换行）＋assets/<档名>。素材档名照 checkAssetName 检查、同名 ⇒ 丢 bad_asset_name。 */
export async function zipPayload(payload: ProjectPayload): Promise<Blob> {
  const zip = new JSZip()
  zip.file(PROJECT_JSON, JSON.stringify(payload.json, null, 2) + '\n')
  const folder = zip.folder(ASSETS_DIR)!
  const seen = new Set<string>()
  for (const a of payload.assets) {
    checkAssetName(a.name)
    if (seen.has(a.name)) throw new StudioError('bad_asset_name', `duplicate: ${a.name}`)
    seen.add(a.name)
    folder.file(a.name, await a.data.arrayBuffer())   // 先转 ArrayBuffer：JSZip 读 Blob 要 FileReader（单测环境没有）
  }
  for (const x of payload.extras ?? []) {
    if (!x.name || /[\\/]/.test(x.name) || x.name === PROJECT_JSON) throw new StudioError('bad_asset_name', `extra: ${x.name}`)
    zip.file(x.name, typeof x.text === 'string' ? x.text : await x.text.arrayBuffer())
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** 把整个工程打成 zip（Blob）＝ readAll → zipPayload。 */
export async function exportProjectZip(store: ProjectStore): Promise<Blob> {
  return zipPayload(await readAll(store))
}

/**
 * Shell 按「汇出工程档」走的那条（使用者勾完选项、flush 之后）：编辑器有 buildExport ⇒ 用它回的 payload；
 * 没有 ⇒ 整份（readAll）。两条都经 zipPayload 打包。
 */
export async function buildExportZip(appDef: Pick<StudioApp<unknown>, 'buildExport'>, store: ProjectStore, ctx: { projectId: string; options: ReadonlySet<string> }): Promise<Blob> {
  const payload = appDef.buildExport ? await appDef.buildExport(store, { projectId: ctx.projectId, options: new Set(ctx.options) }) : await readAll(store)
  return zipPayload(payload)
}

/** 浏览器下载一个 Blob。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function parseJsonText(text: string): unknown {
  try { return JSON.parse(text) } catch (e) { throw new StudioError('bad_json', (e as Error).message) }
}

// ── 读 zip 的上限（防压缩炸弹）──────────────────────────────────────────────────────
//   解压时边解边数实际吐出来的位元组，超过就当场停掉解压、丢错；⛔ 信 zip 表头写的大小（可以造假）。
//   项目数：载入后数 zip.files 全部（含目录、__MACOSX）；载入前先看结尾目录宣告的个数，太多就不去解析。

export interface ZipReadLimits {
  /** 项目数上限（含目录、__MACOSX）。 */
  maxEntries: number
  /** project.json 解开后上限。 */
  maxJsonBytes: number
  /** 单一素材解开后上限。 */
  maxEntryBytes: number
  /** project.json＋全部素材解开后合计上限。 */
  maxTotalBytes: number
}

/** 项目数上限 5000（含目录）：一般工程的素材远少于此。 */
export const ZIP_MAX_ENTRIES = 5000
/** 本机汇入 project.json 上限 32 MB：网页自己存的大表格等可能超过 4 MB，要读得回来。 */
export const LOCAL_ZIP_MAX_JSON_BYTES = 32 * 1024 * 1024
/** 本机汇入单档／合计上限的保底 64 MB。 */
export const LOCAL_ZIP_MIN_BUDGET_BYTES = 64 * 1024 * 1024
/** 本机汇入单档／合计上限＝zip 本身大小的 20 倍（不低于保底）：影片素材本来就压过、比例约 1，固定上限会读不回自己汇出的工程；炸弹比例远超 20。 */
export const LOCAL_ZIP_MAX_RATIO = 20

/** 本机选档汇入（readProjectZip 不给 limits 时）的上限：zipBytes＝zip 档本身的位元组数。 */
export function localZipLimits(zipBytes: number): ZipReadLimits {
  const budget = Math.max(LOCAL_ZIP_MIN_BUDGET_BYTES, LOCAL_ZIP_MAX_RATIO * zipBytes)
  return { maxEntries: ZIP_MAX_ENTRIES, maxJsonBytes: LOCAL_ZIP_MAX_JSON_BYTES, maxEntryBytes: budget, maxTotalBytes: budget }
}

/** 结尾目录（End-Of-Central-Directory，zip64 也认）宣告的项目数；找不到／读不懂 ⇒ null（交给 JSZip 判）。只拿来提早拒收。 */
function declaredEntryCount(u8: Uint8Array): number | null {
  if (u8.length < 22) return null
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const u64 = (o: number) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32
  const stop = Math.max(0, u8.length - 22 - 0xffff)   // 结尾目录后面最多跟 65535 字的注解
  for (let i = u8.length - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue
    const n = dv.getUint16(i + 10, true)
    if (n !== 0xffff) return n
    const loc = i - 20                                 // zip64：个数在 zip64 结尾目录里
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) return n
    const off = u64(loc + 8)
    if (off + 40 > u8.length || dv.getUint32(off, true) !== 0x06064b50) return null
    return u64(off + 32)
  }
  return null
}

type Budget = { left: number; readonly max: number }
/** JSZip 3 的内部串流（index.d.ts 没列）：data 同步发、error／end 延后发；_worker.error 会往上游传、停掉解压并清掉。 */
interface ZipStreamHelper {
  on(evt: 'data', fn: (chunk: Uint8Array) => void): ZipStreamHelper
  on(evt: 'error', fn: (e: unknown) => void): ZipStreamHelper
  on(evt: 'end', fn: () => void): ZipStreamHelper
  resume(): ZipStreamHelper
  _worker?: { error(e: unknown): unknown }
}

/**
 * 解压一个项目、边解边数：这一档超过 limit ⇒ overCode；累计用掉的超过 budget ⇒ zip_too_big。
 * 超过就停掉解压、丢掉已收的块；之后同一块输入同步吐出来的资料一律不收。回收到的块（不拼接，素材直接包成 Blob）。
 */
function readEntryBounded(entry: JSZip.JSZipObject, limit: number, budget: Budget, overCode: 'zip_too_big' | 'json_too_big'): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const s = (entry as unknown as { internalStream(t: 'uint8array'): ZipStreamHelper }).internalStream('uint8array')
    let chunks: Uint8Array[] = []
    let size = 0
    let done = false
    const fail = (e: unknown) => {
      if (done) return
      done = true
      chunks = []
      // 不能在 data 回调里同步停：JSZip 正在走监听清单，error 会清掉它而当掉。
      //   微任务在这一块输入解完之后、下一块（setImmediate）之前跑 ⇒ 最多多解一块输入，吐出的不收。
      queueMicrotask(() => { try { s._worker?.error(e) } catch { /* 已停 */ } })
      reject(e)
    }
    s.on('data', c => {
      if (done) return
      size += c.byteLength
      budget.left -= c.byteLength
      if (size > limit) return fail(new StudioError(overCode, String(limit)))
      if (budget.left < 0) return fail(new StudioError('zip_too_big', String(budget.max)))
      chunks.push(c)
    })
    s.on('error', e => { if (done) return; done = true; chunks = []; reject(e) })
    s.on('end', () => { if (done) return; done = true; resolve(chunks) })
    s.resume()
  })
}

/**
 * 读 zip（ArrayBuffer／Blob）成 payload，并检查表头。
 * limits：不给 ⇒ 本机选档的上限（localZipLimits）；链接带来的由 import-link 传它那一组。超过 ⇒ zip_too_big／zip_too_many／json_too_big。
 */
export async function readProjectZip(data: Blob | ArrayBuffer | Uint8Array, app: StudioAppId, maxVersion: number, limits?: ZipReadLimits): Promise<ProjectPayload> {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data)
  const lim = limits ?? localZipLimits(u8.byteLength)
  const declared = declaredEntryCount(u8)
  if (declared !== null && declared > lim.maxEntries) throw new StudioError('zip_too_many', String(lim.maxEntries))
  const zip = await JSZip.loadAsync(u8)
  if (Object.keys(zip.files).length > lim.maxEntries) throw new StudioError('zip_too_many', String(lim.maxEntries))
  const budget: Budget = { left: lim.maxTotalBytes, max: lim.maxTotalBytes }
  // 找 project.json：根目录，或唯一一层目录底下（使用者把整个资料夹压起来的情形）
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !n.startsWith('__MACOSX/'))
  let prefix: string | null = null
  if (names.includes(PROJECT_JSON)) prefix = ''
  else {
    const hits = names.filter(n => /^[^/]+\/project\.json$/.test(n))
    if (hits.length === 1) prefix = hits[0].slice(0, -PROJECT_JSON.length)
  }
  if (prefix === null) throw new StudioError('no_project_json')
  const jsonChunks = await readEntryBounded(zip.file(prefix + PROJECT_JSON)!, Math.min(lim.maxJsonBytes, lim.maxEntryBytes), budget, 'json_too_big')
  const json = checkProjectHeader(parseJsonText(new TextDecoder('utf-8').decode(concatChunks(jsonChunks))), app, maxVersion)
  const assets: ProjectPayload['assets'] = []
  const ap = `${prefix}${ASSETS_DIR}/`
  for (const n of names) {
    if (!n.startsWith(ap)) continue
    const rest = n.slice(ap.length)
    if (!rest || rest.includes('/')) continue          // 只收 assets/ 第一层档案
    if (rest.startsWith('.')) continue                 // .DS_Store 之类
    checkAssetName(rest)
    assets.push({ name: rest, data: new Blob(await readEntryBounded(zip.file(n)!, lim.maxEntryBytes, budget, 'zip_too_big') as BlobPart[]) })
  }
  return { json, assets }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

/** 读一个资料夹（目录句柄）成 payload。 */
export async function readProjectDir(dir: FileSystemDirectoryHandle, app: StudioAppId, maxVersion: number): Promise<ProjectPayload> {
  let jsonFile: File | null = null
  let assetsDir: FileSystemDirectoryHandle | null = null
  for await (const h of dirValues(dir)) {
    if (h.kind === 'file' && h.name === PROJECT_JSON) jsonFile = await (h as FileSystemFileHandle).getFile()
    if (h.kind === 'directory' && h.name === ASSETS_DIR) assetsDir = h as FileSystemDirectoryHandle
  }
  if (!jsonFile) throw new StudioError('no_project_json')
  const json = checkProjectHeader(parseJsonText(await jsonFile.text()), app, maxVersion)
  const assets: ProjectPayload['assets'] = []
  if (assetsDir) {
    for await (const h of dirValues(assetsDir)) {
      if (h.kind !== 'file' || h.name.startsWith('.')) continue
      checkAssetName(h.name)
      assets.push({ name: h.name, data: await (h as FileSystemFileHandle).getFile() })
    }
  }
  return { json, assets }
}

/** 读 <input type=file webkitdirectory> 选出来的档案清单（Safari／Firefox 选资料夹走这条）。 */
export async function readProjectFileList(files: ArrayLike<File>, app: StudioAppId, maxVersion: number): Promise<ProjectPayload> {
  const list = Array.from(files)
  const rel = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/^[^/]+\//, '')   // 去掉最外层资料夹名
  const jf = list.find(f => rel(f) === PROJECT_JSON)
  if (!jf) throw new StudioError('no_project_json')
  const json = checkProjectHeader(parseJsonText(await jf.text()), app, maxVersion)
  const assets: ProjectPayload['assets'] = []
  for (const f of list) {
    const r = rel(f)
    if (!r.startsWith(`${ASSETS_DIR}/`)) continue
    const n = r.slice(ASSETS_DIR.length + 1)
    if (!n || n.includes('/') || n.startsWith('.')) continue
    checkAssetName(n)
    assets.push({ name: n, data: f })
  }
  return { json, assets }
}

/** 把 payload 整份写进工程（盖掉原内容；原本有、payload 没有的素材删掉）。project.json 最后写。 */
export async function applyPayload(store: ProjectStore, p: ProjectPayload): Promise<void> {
  const keep = new Set(p.assets.map(a => a.name))
  for (const a of p.assets) await store.writeAsset(a.name, a.data)
  for (const a of await store.listAssets()) if (!keep.has(a.name)) await store.deleteAsset(a.name)
  await store.writeJSON(p.json)
}
