// 短网址代存的接口客户端（网站游客版专用·开源单机版不建、不连）：照接口表一支一支包起来，栏位名、路径、状态码照抄。
//   全部免登入；要票的那几支把票放 Authorization: Bearer <票>；关分页那支走 sendBeacon、票放 body（{ token }）。
//   网络一律经呼叫端给的 fetch（单测换成假的）；接口前缀由 host.ts 的 shareApiBase() 给。
//
//   POST {base}                      {app, by, project}            ⇒ {code, url, token, version}
//   POST {base}/<码>/assets/init      {name, size, contentType}     ⇒ {uploadId, partSize, parts:[{partNumber, url}]}
//   PUT  <各 part 的预签名网址>        那一段的位元组                  ⇒ 回应表头 ETag
//   POST {base}/<码>/assets/complete  {name, uploadId, parts:[{PartNumber, ETag}]}
//   GET  {base}/<码>                                                ⇒ {app, version, project, assets:{档名:网址}, claimed, ai_paired}｜404
//   GET  {base}/<码>/version                                        ⇒ {version, pair_waiting}
//   PUT  {base}/<码>/project          {base_version, project}       ⇒ {version}｜409 {version}
//   POST {base}/<码>/claim                                          ⇒ {token}｜409
//   POST {base}/<码>/heartbeat                                      ⇒ {version, pair_pending:{request_id}|null, ai_paired}
//   POST {base}/<码>/close            {token}（sendBeacon）
//   POST {base}/<码>/pair-code        {request_id, code_hash}
//   POST {base}/<码>/revoke-ai

import type { StudioAppId } from './types'
import { shareApiBase } from './host'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** 短网址的码：8 个英数字。 */
export const SHARE_CODE_RE = /^[A-Za-z0-9]{8}$/
export function isShareCode(x: unknown): x is string {
  return typeof x === 'string' && SHARE_CODE_RE.test(x)
}

export interface ShareCreated { code: string; url: string; token: string; version: number }
export interface ShareGot {
  app: StudioAppId
  version: number
  project: Record<string, unknown>
  assets: Record<string, string>
  claimed: boolean
  ai_paired: boolean
}
/** 轻量轮询：版本号；pairWaiting＝有 AI 在等这页交验证码（缺栏位＝false）。 */
export interface ShareVersionInfo { version: number; pairWaiting: boolean }
export interface ShareHeartbeat { version: number; pair_pending: { request_id: string } | null; ai_paired: boolean }
export interface AssetsInit { uploadId: string; partSize: number; parts: { partNumber: number; url: string }[] }

/** 接口回了非 2xx：status 照实带着（404＝过期或删了、409＝版本不对／已被认领）。 */
export class ShareHttpError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown, what: string) {
    super(`${what}: HTTP ${status}`)
    this.name = 'ShareHttpError'
    this.status = status
    this.body = body
  }
}
export function isShareHttpError(e: unknown, status?: number): e is ShareHttpError {
  return e instanceof ShareHttpError && (status === undefined || e.status === status)
}

export interface ShareApi {
  create(body: { app: StudioAppId; by: 'page' | 'ai'; project: unknown }): Promise<ShareCreated>
  get(code: string): Promise<ShareGot>
  version(code: string): Promise<ShareVersionInfo>
  putProject(code: string, token: string, body: { base_version: number; project: unknown }): Promise<number>
  claim(code: string): Promise<string>
  heartbeat(code: string, token: string): Promise<ShareHeartbeat>
  pairCode(code: string, token: string, body: { request_id: string; code_hash: string }): Promise<void>
  revokeAi(code: string, token: string): Promise<void>
  /** 关分页那一下（sendBeacon·票放 body）。回 sendBeacon 有没有排进去。 */
  closeBeacon(code: string, token: string): boolean
  /** 一个素材：init ⇒ 照 partSize 切段直传各 part ⇒ complete。 */
  uploadAsset(code: string, token: string, name: string, data: Blob): Promise<void>
  /** 下载 GET 回来的素材网址。 */
  download(url: string): Promise<Blob>
}

export interface ShareApiOptions {
  fetch?: FetchLike
  base?: string
  sendBeacon?: (url: string, data: Blob) => boolean
}

async function readBody(r: Response): Promise<unknown> {
  try { const t = await r.text(); return t ? JSON.parse(t) : null } catch { return null }
}

export function createShareApi(o: ShareApiOptions = {}): ShareApi {
  const f: FetchLike = o.fetch ?? ((u, i) => fetch(u, i))
  const base = o.base ?? shareApiBase()
  const beacon = o.sendBeacon ?? ((u: string, d: Blob) => (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon(u, d) : false))
  const at = (code: string, tail = '') => `${base}/${encodeURIComponent(code)}${tail}`
  const auth = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})
  const call = async (what: string, url: string, method: string, token?: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { ...auth(token) }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const r = await f(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' })
    const data = await readBody(r)
    if (!r.ok) throw new ShareHttpError(r.status, data, what)
    return data
  }
  const api: ShareApi = {
    async create(body) { return (await call('create', base, 'POST', undefined, body)) as ShareCreated },
    async get(code) {
      const got = (await call('get', at(code), 'GET')) as ShareGot & { project_url?: string }
      // 作品档太大（服务器 8MB 以上）⇒ 不内嵌、给 project_url；存的可能是带版本的封套 {__studio_share_version, project} 或原样一份
      if ((got.project === null || got.project === undefined) && typeof got.project_url === 'string') {
        const r = await f(got.project_url, { method: 'GET', credentials: 'omit', cache: 'no-store' })
        if (!r.ok) throw new ShareHttpError(r.status, null, 'project_url')
        const j = (await readBody(r)) as Record<string, unknown> | null
        got.project = (j && typeof j === 'object' && '__studio_share_version' in j ? j.project : j) as Record<string, unknown>
      }
      delete got.project_url
      return got
    },
    async version(code) {
      const v = (await call('version', at(code, '/version'), 'GET')) as { version: number; pair_waiting?: boolean }
      return { version: Number(v.version), pairWaiting: v.pair_waiting === true }
    },
    async putProject(code, token, body) { return Number(((await call('put', at(code, '/project'), 'PUT', token, body)) as { version: number }).version) },
    async claim(code) { return String(((await call('claim', at(code, '/claim'), 'POST')) as { token: string }).token) },
    async heartbeat(code, token) { return (await call('heartbeat', at(code, '/heartbeat'), 'POST', token)) as ShareHeartbeat },
    async pairCode(code, token, body) { await call('pair-code', at(code, '/pair-code'), 'POST', token, body) },
    async revokeAi(code, token) { await call('revoke-ai', at(code, '/revoke-ai'), 'POST', token) },
    closeBeacon(code, token) {
      try { return beacon(at(code, '/close'), new Blob([JSON.stringify({ token })], { type: 'application/json' })) } catch { return false }
    },
    async uploadAsset(code, token, name, data) {
      const init = (await call('assets/init', at(code, '/assets/init'), 'POST', token, { name, size: data.size, contentType: data.type || 'application/octet-stream' })) as AssetsInit
      const size = Math.max(1, Number(init.partSize) || data.size || 1)
      const done: { PartNumber: number; ETag: string }[] = []
      for (const p of [...init.parts].sort((a, b) => a.partNumber - b.partNumber)) {
        const start = (p.partNumber - 1) * size
        const r = await f(p.url, { method: 'PUT', body: data.slice(start, start + size), credentials: 'omit' })
        if (!r.ok) throw new ShareHttpError(r.status, null, `part ${p.partNumber}`)
        done.push({ PartNumber: p.partNumber, ETag: r.headers.get('ETag') ?? r.headers.get('etag') ?? '' })
      }
      await call('assets/complete', at(code, '/assets/complete'), 'POST', token, { name, uploadId: init.uploadId, parts: done })
    },
    async download(url) {
      const r = await f(url, { method: 'GET', credentials: 'omit', cache: 'no-store' })
      if (!r.ok) throw new ShareHttpError(r.status, null, 'asset')
      return r.blob()
    },
  }
  return api
}
