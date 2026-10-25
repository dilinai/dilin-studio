// AI 交成品的链接：打开 /studio/<编辑器>?import=<https 网址> 或 /studio/<编辑器>#p=<压缩后的工程>，
//   网页就把那份工程读进来、存成这个浏览器里的一份新工程、进编辑页（DirectOpen.tsx 接）。
//
// 两种写法：
//   ?import=<网址>：网址指向工程 zip（project.json＋assets/）或单独一个 project.json。AI 把档放在网上（例如它的 GitHub 仓、gist），
//     给用户的链接带上那个网址。github.com/<人>/<仓>/blob/<分支>/<路径> 会自动换成同一档的 raw.githubusercontent.com 网址。
//   #p=<资料>：小工程整份塞进链接、不用另外放档。资料＝project.json 的 UTF-8 文字经 deflate-raw 压缩（CompressionStream 同一种）
//     再转 base64url（不补 =）。放在 # 后面 ⇒ 不会送到任何服务器。只装得下 project.json（素材要走 ?import= 的 zip）。
//
// 抓网址的规矩：
//   只收 https://（转址后也要是 https）；⛔ 带用户任何凭证（credentials: 'omit'、不送 Referer）；
//   大小上限 LINK_FETCH_MAX_BYTES（边读边数，超过就停）；逾时 LINK_FETCH_TIMEOUT_MS；
//   读到的先看表头：zip（PK 开头）走 readProjectZip（解压上限 LINK_ZIP_LIMITS），否则当 JSON 读、format／version 要对；都不是 ⇒ not_project。
//   失败一律丢 StudioLinkError（code 见下），画面按 code 取白话。

import type { ProjectPayload, StudioAppId } from './types'
import { checkProjectHeader } from './project-file'
import { ZIP_MAX_ENTRIES, readProjectZip, type ZipReadLimits } from './zip'
import { readBoundedBytes } from './read-bounded-bytes'
import { createOpfsProject, type ProjectAppDef, type ProjectEnv } from './project-actions'
import type { ProjectRecord } from './projects'

/** ?import= 抓回来的档最大 50 MB（含素材的 zip）。 */
export const LINK_FETCH_MAX_BYTES = 50 * 1024 * 1024
/** 抓档逾时 30 秒。 */
export const LINK_FETCH_TIMEOUT_MS = 30_000
/**
 * #p= 那段最长 60 000 字：常见浏览器网址上限远大于此，但聊天软件、短信常把太长的链接截断；
 *   一般 project.json 压缩后约剩三到五成，60 000 字大约装得下 100–200 KB 的 project.json。再大就请 AI 改用 ?import=。
 */
export const LINK_HASH_MAX_CHARS = 60_000
/**
 * 给 AI 的说明里建议的「整个链接」总长上限（约 32 KB）：工程档优先嵌进 #p=，整个网址超过这个长度就别嵌，
 *   云端做的改放公开地址走 ?import=、本机做的改指向本机资料夹。聊天软件、短信、邮件常把很长的链接截断，留得比
 *   LINK_HASH_MAX_CHARS（网页载入端的硬上限）保守。只用在说明文字，载入端不看它。
 */
export const LINK_RECOMMENDED_MAX_CHARS = 32_000
/** #p= 解压后最大 4 MB（防压缩炸弹）。 */
export const LINK_INFLATED_MAX_BYTES = 4 * 1024 * 1024
/** 链接带来的 zip 解开后合计最大 64 MB（抓档上限 50 MB 再留一点；防压缩炸弹）。 */
export const LINK_ZIP_MAX_TOTAL_BYTES = 64 * 1024 * 1024
/**
 * 链接带来的 zip 的解压上限：project.json 跟 #p= 同一个 4 MB；单档不超过抓档上限；合计 LINK_ZIP_MAX_TOTAL_BYTES；项目数同本机。
 */
export const LINK_ZIP_LIMITS: Readonly<ZipReadLimits> = {
  maxEntries: ZIP_MAX_ENTRIES,
  maxJsonBytes: LINK_INFLATED_MAX_BYTES,
  maxEntryBytes: LINK_FETCH_MAX_BYTES,
  maxTotalBytes: LINK_ZIP_MAX_TOTAL_BYTES,
}

/** too_big 的 detail：'hash'＝#p= 那段太长；否则＝超过的位元组上限。 */
export type StudioLinkErrorCode = 'bad_url' | 'too_big' | 'fetch_failed' | 'not_project' | 'bad_hash'

export class StudioLinkError extends Error {
  readonly code: StudioLinkErrorCode
  readonly detail: string
  constructor(code: StudioLinkErrorCode, detail = '') {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'StudioLinkError'
    this.code = code
    this.detail = detail
  }
}
export function isStudioLinkError(e: unknown): e is StudioLinkError {
  return e instanceof StudioLinkError
}

export type LinkSource = { kind: 'url'; url: string } | { kind: 'hash'; data: string }

/** 从网址的 search 与 hash 找出要读进来的工程；都没有 ⇒ null。两种都有 ⇒ #p= 优先（不用连网）。 */
export function readLinkSource(search: string, hash: string): LinkSource | null {
  const h = (hash || '').replace(/^#/, '')
  for (const part of h.split('&')) {
    if (part.startsWith('p=')) return { kind: 'hash', data: part.slice(2) }
  }
  const q = new URLSearchParams((search || '').replace(/^\?/, ''))
  const u = q.get('import')
  if (u !== null) return { kind: 'url', url: u }
  return null
}

/** 检查并整理 ?import= 的网址：只收 https、不收带帐密的；github.com 的 blob 页换成 raw 档。不合格 ⇒ bad_url。 */
export function normalizeImportUrl(raw: string): string {
  let u: URL
  try { u = new URL(String(raw || '').trim()) } catch { throw new StudioLinkError('bad_url', String(raw || '').slice(0, 200)) }
  if (u.protocol !== 'https:') throw new StudioLinkError('bad_url', u.protocol)
  if (u.username || u.password) throw new StudioLinkError('bad_url', 'credentials in URL')
  if (u.hostname === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/)
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`
  }
  return u.toString()
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/** 一份抓回来／解出来的档 ⇒ payload：zip 走 readProjectZip（用 LINK_ZIP_LIMITS 那组上限）；否则当 project.json。 */
export async function payloadFromBytes(bytes: Uint8Array, app: StudioAppId, maxVersion: number): Promise<ProjectPayload> {
  if (bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b)) return readProjectZip(bytes, app, maxVersion, { ...LINK_ZIP_LIMITS })
  let json: unknown
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')) } catch { throw new StudioLinkError('not_project') }
  if (!json || typeof json !== 'object' || Array.isArray(json) || typeof (json as Record<string, unknown>).format !== 'string') throw new StudioLinkError('not_project')
  return { json: checkProjectHeader(json, app, maxVersion), assets: [] }
}

export interface FetchProjectOptions {
  fetch?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

/** 抓 ?import= 的网址读成 payload（规矩见头注）。 */
export async function fetchProjectPayload(rawUrl: string, app: StudioAppId, maxVersion: number, o: FetchProjectOptions = {}): Promise<ProjectPayload> {
  const url = normalizeImportUrl(rawUrl)
  const doFetch = o.fetch ?? fetch
  const max = o.maxBytes ?? LINK_FETCH_MAX_BYTES
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? LINK_FETCH_TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await doFetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store', signal: ctl.signal })
    } catch (e) {
      throw new StudioLinkError('fetch_failed', ctl.signal.aborted ? 'timeout' : (e as Error)?.message || String(e))
    }
    if (res.url && !res.url.startsWith('https://')) throw new StudioLinkError('bad_url', 'redirected to non-https')
    if (!res.ok) throw new StudioLinkError('fetch_failed', `HTTP ${res.status}`)
    let bytes: Uint8Array | null
    try { bytes = await readBoundedBytes(res, max) } catch (e) {
      throw new StudioLinkError('fetch_failed', ctl.signal.aborted ? 'timeout' : (e as Error)?.message || String(e))
    }
    if (!bytes) throw new StudioLinkError('too_big', String(max))
    return await payloadFromBytes(bytes, app, maxVersion)
  } finally { clearTimeout(timer) }
}

// ── #p= ────────────────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new StudioLinkError('bad_hash', 'not base64url')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  let bin: string
  try { bin = atob(b64) } catch { throw new StudioLinkError('bad_hash', 'not base64url') }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pipeBytes(input: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }, limit: number): Promise<Uint8Array | null> {
  const w = stream.writable.getWriter()
  const writing = w.write(input as BufferSource).then(() => w.close()).catch(() => {})
  const r = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await r.read()
      if (done) break
      total += value.byteLength
      if (total > limit) { await r.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  } finally { void writing }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

/** 把一份 project.json（物件）做成 #p= 后面那段。 */
export async function encodeProjectHash(json: unknown): Promise<string> {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const z = await pipeBytes(text, new CompressionStream('deflate-raw'), Number.MAX_SAFE_INTEGER)
  return toBase64Url(z!)
}

/** 读 #p= 那段成 payload（只有 project.json、没有素材）。 */
export async function decodeProjectHash(data: string, app: StudioAppId, maxVersion: number): Promise<ProjectPayload> {
  if (data.length > LINK_HASH_MAX_CHARS) throw new StudioLinkError('too_big', 'hash')
  const z = fromBase64Url(data)
  let raw: Uint8Array | null
  try { raw = await pipeBytes(z, new DecompressionStream('deflate-raw'), LINK_INFLATED_MAX_BYTES) } catch (e) { throw new StudioLinkError('bad_hash', (e as Error)?.message || 'inflate') }
  if (!raw) throw new StudioLinkError('too_big', String(LINK_INFLATED_MAX_BYTES))
  if (!raw.length) throw new StudioLinkError('bad_hash', 'empty')
  try { return await payloadFromBytes(raw, app, maxVersion) } catch (e) {
    if (isStudioLinkError(e) && e.code === 'not_project') throw new StudioLinkError('bad_hash', 'not a project')
    throw e
  }
}

/** 组给用户的链接（base＝/studio/<编辑器> 的完整网址）。 */
export function buildImportLink(base: string, src: LinkSource): string {
  return src.kind === 'hash' ? `${base}#p=${src.data}` : `${base}?import=${encodeURIComponent(src.url)}`
}

/** 链接带来的那份 ⇒ 读进来、存成这个浏览器里的一份新工程（名字用工程档里的 name，没有就用 name）。回新工程的纪录。 */
export async function openLinkedProject(env: ProjectEnv, def: ProjectAppDef, name: string, src: LinkSource, o: FetchProjectOptions = {}): Promise<ProjectRecord> {
  const payload = src.kind === 'hash'
    ? await decodeProjectHash(src.data, def.app, def.format.version)
    : await fetchProjectPayload(src.url, def.app, def.format.version, o)
  return createOpfsProject(env, def, name, payload)
}
