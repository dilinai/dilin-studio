// 短网址代存的同步层（网站游客版·开源单机版不建）：一份开着的工程一个 ShareController。
//
// 接法：控制器包住本机 store（ctl.store）交给外框（session.ts）与整页——编辑器照旧只写本机，这一层在旁边做三件事：
//   ① 推：包住的 store 每次存好 project.json（writeJSON／writeJSONSafe 写成）⇒ 防抖 PUT project（带 base_version）；
//      新写的素材先走 assets/init → 直传各 part → complete 再推。409 ⇒ 先 GET 新版、写进本机，交给现成的外部改档流程决定
//      （没未存改动就直接重载新版；有就先问）。
//   ② 收：GET version 轮询（分页看得见 1.5 秒、看不见 6 秒·sharePollMs；转回看得见当场补一次），比本机对上的新 ⇒ GET 整份、缺的素材下载、写进本机，再叫外框登记的 watch 回调——
//      就是外框收到「project.json 被外面改了」的同一条路（没未存改动就重载、有就先问）。
//      写进本机之后、编辑器重新载入之前，包住的 store 对自动存回「外面改过」（跟真的外部改档一样挡住旧画面盖掉新版）。
//   ③ 心跳：60 秒一次；version 回 pair_waiting（有 AI 在等验证码）⇒ 当场补打一次心跳，不等 60 秒。
//      回 pair_pending ⇒ 当场产生 6 位验证码（crypto.getRandomValues）、只把 sha256 交服务器、画面显示；
//      ai_paired ⇒ 右栏显示「收回 AI 编辑权」。
//   「複製」：还没建立 ⇒ 建立（by:'page'、project＋素材）、记进本机登记、网址换成 /s/<码>；已建立 ⇒ 直接给短网址。
//   关分页：已建立（手上有页面票）才提醒；pagehide 用 sendBeacon 打 close。
//   没有页面票（别的浏览器先认领了）⇒ 只读：照样收新版，不推、不心跳。

import type { ExternalChange, ProjectStore, StudioAppId } from './types'
import type { ShareApi } from './share-api'
import { isShareHttpError } from './share-api'
import type { ShareBook, ShareEntry } from './share-book'
import { checkProjectHeader } from './project-file'
import { sharePath } from './host'
import { studioNeg } from './ai-panel.pure'

export type ShareStatus = 'idle' | 'creating' | 'shared' | 'readonly'

export interface SharePairCode {
  /** 6 位数字（只在画面显示，⛔ 送出去）。 */
  code: string
  requestId: string
  expiresAt: number
}

export interface ShareState {
  status: ShareStatus
  code: string | null
  aiPaired: boolean
  pair: SharePairCode | null
  /** 上次按「複製」建立失败（已改复制当下网址）。 */
  createFailed: boolean
  /** 服务器那份过期或被删了（本机这份还在；再按「複製」会重新建立）。 */
  gone: boolean
}

export interface ShareTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(h: unknown): void
}

export interface ShareControllerInput {
  app: StudioAppId
  projectId: string
  /** 本机 store（OPFS／资料夹）。 */
  store: ProjectStore
  /** 这个编辑器认得的最高格式版本（收到的新版超过就不收）。 */
  maxVersion: number
  api: ShareApi
  book: ShareBook
  /** 外框：把编辑器手上的改动立刻存下去（建立前先叫）。 */
  flush(): Promise<void>
  location: { origin: string; href: string; pathname: string }
  history?: { replaceState(data: unknown, unused: string, url: string): void } | null
  timers?: ShareTimers
  now?(): number
  /** 填随机位元组（缺省 crypto.getRandomValues）。 */
  random?(b: Uint8Array): Uint8Array
  /** sha256 十六进位（缺省 crypto.subtle）。 */
  sha256Hex?(s: string): Promise<string>
  pushDelayMs?: number
  /** 固定轮询间隔（给了就不看分页可见与否）。 */
  pollMs?: number
  heartbeatMs?: number
  /** 分页看不看得见（缺省 document.visibilityState／visibilitychange；没有 document ⇒ 当看得见）。 */
  visibility?: ShareVisibility | null
}

export interface ShareVisibility {
  visible(): boolean
  /** 可见与否变了叫 fn；回取消函数。 */
  onChange(fn: () => void): () => void
}

export interface ShareCopyResult { text: string; created: boolean; failed: boolean }

export interface ShareController {
  /** 包住的 store：外框与整页都用这一个。 */
  readonly store: ProjectStore
  get(): ShareState
  subscribe(fn: () => void): () => void
  /** 「複製」：回要复制的字（短网址；建立失败 ⇒ 当下网址）。 */
  copyLink(): Promise<ShareCopyResult>
  revokeAi(): Promise<void>
  /** beforeunload：已建立才提醒。 */
  onBeforeUnload(e: { preventDefault(): void; returnValue?: unknown }, message: string): void
  /** pagehide：sendBeacon close。 */
  onPageHide(): void
  /** 开始计时（轮询、心跳）；已有登记就接上。 */
  start(): void
  stop(): void
  // 下面几支给计时器叫，也给单测直接叫
  pushNow(): Promise<void>
  pollOnce(): Promise<void>
  heartbeatOnce(): Promise<void>
}

export const SHARE_PUSH_DELAY_MS = 1000
export const SHARE_POLL_MS = 3000
/** 分页看得见：轮询快一些（AI 发配对请求后验证码 1～2 秒内出现）。 */
export const SHARE_POLL_VISIBLE_MS = 1500
/** 分页看不见：放慢（转回看得见当场补一次·不漏新版）。 */
export const SHARE_POLL_HIDDEN_MS = 6000
export const SHARE_HEARTBEAT_MS = 60_000
export const SHARE_PAIR_TTL_MS = 5 * 60_000

/** 轮询间隔：看得见 1.5 秒、看不见 6 秒。 */
export function sharePollMs(visible: boolean): number {
  if (studioNeg('studio-share-pair-slow')) return SHARE_POLL_MS
  return visible ? SHARE_POLL_VISIBLE_MS : SHARE_POLL_HIDDEN_MS
}

const documentVisibility = (): ShareVisibility | null => {
  if (typeof document === 'undefined') return null
  return {
    visible: () => document.visibilityState !== 'hidden',
    onChange(fn) { document.addEventListener('visibilitychange', fn); return () => document.removeEventListener('visibilitychange', fn) },
  }
}

const defaultTimers: ShareTimers = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
}

export async function sha256HexOf(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('')
}

/** 6 位数字（000000–999999 均匀：超出 1e6 整数倍的那截丢掉重抽）。 */
export function sixDigitCode(random: (b: Uint8Array) => Uint8Array = b => crypto.getRandomValues(b)): string {
  const lim = Math.floor(0x100000000 / 1_000_000) * 1_000_000
  for (;;) {
    const b = random(new Uint8Array(4))
    const x = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3]
    if (x < lim) return String(x % 1_000_000).padStart(6, '0')
  }
}

export function createShareController(i: ShareControllerInput): ShareController {
  const inner = i.store
  const timers = i.timers ?? defaultTimers
  const now = i.now ?? (() => Date.now())
  const random = i.random ?? (b => crypto.getRandomValues(b))
  const sha = i.sha256Hex ?? sha256HexOf
  const pushDelay = i.pushDelayMs ?? SHARE_PUSH_DELAY_MS
  const vis = i.visibility === undefined ? documentVisibility() : i.visibility
  const isVisible = () => !vis || vis.visible()
  const pollMs = () => i.pollMs ?? sharePollMs(isVisible())

  let entry: ShareEntry | null = i.book.byProject(i.projectId)
  let state: ShareState = {
    status: entry ? (entry.token ? 'shared' : 'readonly') : 'idle',
    code: entry?.code ?? null, aiPaired: false, pair: null, createFailed: false, gone: false,
  }
  const subs = new Set<() => void>()
  const set = (p: Partial<ShareState>) => { state = { ...state, ...p }; for (const f of [...subs]) f() }

  const watchers = new Set<(c: ExternalChange) => void>()
  let pendingRemote = false          // 收进本机的新版还没被编辑器重新载入
  let localChanged = false           // 本机存过、还没推上去
  const pendingAssets = new Set<string>()
  let lastSyncedText: string | null = null
  let pushTimer: unknown = null
  let pushing: Promise<void> | null = null
  let pushAgain = false
  let polling = false
  let beating = false
  let creating: Promise<ShareCopyResult> | null = null
  let pollH: unknown = null
  let beatH: unknown = null
  let pollEvery = 0
  let unVis: (() => void) | null = null
  let started = false

  const canPush = () => !!entry && (!!entry.token || studioNeg('studio-share-readonly-push'))

  const noteSaved = () => {
    localChanged = true
    if (!canPush()) return
    if (pushTimer !== null) timers.clearTimeout(pushTimer)
    pushTimer = timers.setTimeout(() => { pushTimer = null; void ctl.pushNow() }, pushDelay)
  }

  const store: ProjectStore = {
    get backend() { return inner.backend },
    get label() { return inner.label },
    async readJSON(ro) {
      const v = await inner.readJSON(ro)
      if (!ro?.peek) pendingRemote = false
      return v as never
    },
    async writeJSON(v) { await inner.writeJSON(v); pendingRemote = false; noteSaved() },
    async writeJSONSafe(v, wo) {
      if (!wo?.force && pendingRemote) return { written: false, reason: 'changed-outside', lastModified: (await inner.lastModified()) ?? now() }
      const r = await inner.writeJSONSafe(v, wo)
      if (r.written) { pendingRemote = false; noteSaved() }
      return r
    },
    async changedOutside() { return pendingRemote || inner.changedOutside() },
    lastModified: () => inner.lastModified(),
    readAsset: n => inner.readAsset(n),
    async writeAsset(n, d) { await inner.writeAsset(n, d); pendingAssets.add(n) },
    listAssets: () => inner.listAssets(),
    async deleteAsset(n) { await inner.deleteAsset(n); pendingAssets.delete(n) },
    // 附加档（检查报告、预览图…）只写本机这份·不同步到服务器
    writeExtra: inner.writeExtra && ((n, x) => inner.writeExtra!(n, x)),
    watch(cb, ms) {
      const stop = inner.watch(cb, ms)
      watchers.add(cb)
      return () => { watchers.delete(cb); stop() }
    },
  }

  const goneNow = () => {
    if (entry) i.book.remove(entry.code)
    entry = null
    stopTimers()
    set({ status: 'idle', code: null, aiPaired: false, pair: null, gone: true })
  }
  const setVersion = (v: number) => {
    if (!entry || !Number.isFinite(v)) return
    entry = i.book.update(entry.code, { version: v }) ?? { ...entry, version: v }
  }

  const uploadAssets = async (names: Iterable<string>) => {
    if (!entry) return
    for (const n of [...names]) {
      const b = await inner.readAsset(n)
      if (b) await i.api.uploadAsset(entry.code, entry.token ?? '', n, b)
      pendingAssets.delete(n)
    }
  }

  /** 服务器那份写进本机、叫外框的外部改档回调。 */
  const applyRemote = async (got: { version: number; project: Record<string, unknown>; assets: Record<string, string> }) => {
    const json = checkProjectHeader(got.project, i.app, i.maxVersion)
    const have = new Set((await inner.listAssets()).map(a => a.name))
    for (const [name, url] of Object.entries(got.assets ?? {})) {
      if (have.has(name)) continue
      await inner.writeAsset(name, await i.api.download(url))
    }
    await inner.writeJSON(json)
    lastSyncedText = JSON.stringify(json)
    setVersion(got.version)
    pendingRemote = true
    if (studioNeg('studio-share-poll-noreload')) return
    const c = { lastModified: now() }
    for (const cb of [...watchers]) { try { cb(c) } catch { /* 回调自己的错不影响同步 */ } }
  }

  const pullLatest = async () => {
    if (!entry) return
    const got = await i.api.get(entry.code)
    await applyRemote(got)
  }

  const doPush = async () => {
    if (!entry || !canPush()) return
    const e = entry
    localChanged = false
    try {
      await uploadAssets(pendingAssets)
      const project = await inner.readJSON({ peek: true })
      const text = JSON.stringify(project)
      if (project === null || text === lastSyncedText) return
      const body = studioNeg('studio-share-base-version') ? { project } as { base_version: number; project: unknown } : { base_version: e.version, project }
      const v = await i.api.putProject(e.code, e.token ?? '', body)
      lastSyncedText = text
      setVersion(v)
    } catch (err) {
      if (isShareHttpError(err, 409)) { await pullLatest().catch(() => { localChanged = true }); return }
      if (isShareHttpError(err, 404)) { goneNow(); return }
      localChanged = true                                    // 网络错 ⇒ 过一会再推
      if (pushTimer === null) pushTimer = timers.setTimeout(() => { pushTimer = null; void ctl.pushNow() }, pushDelay * 5)
    }
  }

  const startTimers = () => {
    if (!started || !entry) return
    if (pollH === null) { pollEvery = pollMs(); pollH = timers.setInterval(() => { void ctl.pollOnce() }, pollEvery) }
    if (vis && !unVis) unVis = vis.onChange(onVisibility)
    if (entry.token && beatH === null) {
      beatH = timers.setInterval(() => { void ctl.heartbeatOnce() }, i.heartbeatMs ?? SHARE_HEARTBEAT_MS)
      void ctl.heartbeatOnce()
    }
  }
  /** 可见与否变了：间隔不同就换一个；转回看得见当场补一次。 */
  function onVisibility() {
    if (!started || !entry || pollH === null) return
    const ms = pollMs()
    if (ms !== pollEvery) { timers.clearInterval(pollH); pollEvery = ms; pollH = timers.setInterval(() => { void ctl.pollOnce() }, ms) }
    if (isVisible()) void ctl.pollOnce()
  }
  function stopTimers() {
    if (unVis) { unVis(); unVis = null }
    if (pollH !== null) { timers.clearInterval(pollH); pollH = null }
    if (beatH !== null) { timers.clearInterval(beatH); beatH = null }
    if (pushTimer !== null) { timers.clearTimeout(pushTimer); pushTimer = null }
  }

  const shortUrl = (code: string) => `${i.location.origin}${sharePath(code)}`
  const replaceUrl = (code: string) => {
    if (i.location.pathname === sharePath(code)) return
    try { i.history?.replaceState(null, '', sharePath(code)) } catch { /* 换不了网址也不影响复制 */ }
  }

  const create = async (): Promise<ShareCopyResult> => {
    set({ status: 'creating', createFailed: false })
    try {
      await i.flush()
      const project = await inner.readJSON({ peek: true })
      const r = await i.api.create({ app: i.app, by: 'page', project })
      entry = { code: r.code, projectId: i.projectId, app: i.app, token: r.token, version: Number(r.version) || 1 }
      i.book.put(entry)
      lastSyncedText = JSON.stringify(project)
      replaceUrl(r.code)
      set({ status: 'shared', code: r.code, gone: false })
      for (const a of await inner.listAssets()) pendingAssets.add(a.name)
      try { await uploadAssets(pendingAssets) } catch { /* 素材下次推的时候再传 */ }
      startTimers()
      if (localChanged || pendingAssets.size) noteSaved()
      return { text: shortUrl(r.code), created: true, failed: false }
    } catch {
      if (!entry) set({ status: 'idle', createFailed: true })
      return entry ? { text: shortUrl(entry.code), created: true, failed: false } : { text: i.location.href, created: false, failed: true }
    }
  }

  const ctl: ShareController = {
    store,
    get: () => state,
    subscribe: fn => { subs.add(fn); return () => { subs.delete(fn) } },
    async copyLink() {
      if (entry) return { text: shortUrl(entry.code), created: false, failed: false }
      if (studioNeg('studio-share-copy-url')) return { text: i.location.href, created: false, failed: false }
      if (!creating) creating = create().finally(() => { creating = null })
      return creating
    },
    async revokeAi() {
      if (!entry?.token) return
      await i.api.revokeAi(entry.code, entry.token)
      set({ aiPaired: false, pair: null })
    },
    onBeforeUnload(e, message) {
      if (!entry?.token && !studioNeg('studio-share-unload-always')) return
      e.preventDefault()
      e.returnValue = message
    },
    onPageHide() {
      if (entry?.token) i.api.closeBeacon(entry.code, entry.token)
    },
    start() {
      started = true
      if (entry) replaceUrl(entry.code)
      startTimers()
    },
    stop() { started = false; stopTimers() },
    async pushNow() {
      if (pushTimer !== null) { timers.clearTimeout(pushTimer); pushTimer = null }
      if (pushing) { pushAgain = true; return pushing }
      pushing = doPush().finally(() => {
        pushing = null
        if (pushAgain) { pushAgain = false; void ctl.pushNow() }
      })
      return pushing
    },
    async pollOnce() {
      if (!entry || polling || pushing || pushTimer !== null || localChanged) return
      polling = true
      try {
        const { version: v, pairWaiting } = await i.api.version(entry.code)
        // 有 AI 在等验证码 ⇒ 当场打一次心跳拿 request_id（不等 60 秒那一下）
        if (pairWaiting && entry?.token && !studioNeg('studio-share-pair-slow')) void ctl.heartbeatOnce()
        if (!entry || !(v > entry.version)) return
        const got = await i.api.get(entry.code)
        if (pushing || localChanged || !entry) return             // 拉的时候本机又存了 ⇒ 让推那边的 409 处理
        await applyRemote(got)
      } catch (err) {
        if (isShareHttpError(err, 404)) goneNow()
      } finally { polling = false }
    },
    async heartbeatOnce() {
      if (!entry?.token || beating) return
      beating = true
      try {
        const e = entry
        const hb = await i.api.heartbeat(e.code, e.token!)
        const p = hb.pair_pending
        if (p && p.request_id) {
          if (state.pair?.requestId !== p.request_id) {
            const code = sixDigitCode(random)
            const codeHash = studioNeg('studio-share-pair-plain') ? code : await sha(code)
            await i.api.pairCode(e.code, e.token!, { request_id: p.request_id, code_hash: codeHash })
            set({ pair: { code, requestId: p.request_id, expiresAt: now() + SHARE_PAIR_TTL_MS }, aiPaired: !!hb.ai_paired })
          } else set({ aiPaired: !!hb.ai_paired })
        } else set({ pair: null, aiPaired: !!hb.ai_paired })
      } catch (err) {
        if (isShareHttpError(err, 404)) goneNow()
      } finally { beating = false }
    },
  }
  return ctl
}
