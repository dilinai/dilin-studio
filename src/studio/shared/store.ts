// 储存层：资料夹（File System Access）与 OPFS 共用一份实作——两者都是 FileSystemDirectoryHandle，
// 差别只在根从哪来（使用者挑的资料夹 vs navigator.storage.getDirectory() 底下的 dilin-studio/<app>/<id>）。
// 结构：<根>/project.json、<根>/assets/<档名>。⛔ 包成压缩档放资料夹——要让用户的 AI 直接读改 project.json。
//
// 写档：有 createWritable 就用（Chrome／Edge／Firefox）；没有（较旧 Safari 的 OPFS）退到专用 Worker 的
// createSyncAccessHandle（只有 OPFS 才会走到这条·需要 opfsPath）。
// project.json（含第一次建）：先写同夹 .project.json.tmp 再 move 换上，外部读者读不到空档或半截；做不到时的退路见 writeProjectText。

import type { AssetInfo, ExternalChange, ProjectStore, ReadJSONOptions, SafeWriteResult, StorageBackend, StudioAppId } from './types'
import { StudioError } from './types'
import { dirValues, type DirHandle } from './fs-types'

export const PROJECT_JSON = 'project.json'
export const ASSETS_DIR = 'assets'
/** OPFS 底下放工程的根目录名。 */
export const OPFS_ROOT = 'dilin-studio'
export const WATCH_INTERVAL_MS = 1500

/** 素材档名检查：1–200 字、不含 / \ 与控制字元、不是 . 或 ..。 */
export function checkAssetName(name: string): void {
  // eslint-disable-next-line no-control-regex
  if (typeof name !== 'string' || !name || name.length > 200 || /[\\/\u0000-\u001f]/.test(name) || name === '.' || name === '..') {
    throw new StudioError('bad_asset_name', String(name))
  }
}

function wrapErr(e: unknown): never {
  if (e instanceof StudioError) throw e
  if (e && typeof e === 'object' && 'name' in e && ((e as DOMException).name === 'NotAllowedError' || (e as DOMException).name === 'SecurityError')) {
    throw new StudioError('permission', (e as Error).message)
  }
  throw e
}

function isNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && ((e as DOMException).name === 'NotFoundError' || (e as DOMException).name === 'TypeMismatchError')
}

async function toBlob(data: Blob | ArrayBuffer | Uint8Array | string): Promise<Blob> {
  if (data instanceof Blob) return data
  if (typeof data === 'string') return new Blob([data], { type: 'text/plain' })
  if (data instanceof Uint8Array) return new Blob([data.slice().buffer as ArrayBuffer])
  return new Blob([data])
}

// ── Safari OPFS 退路：Worker＋createSyncAccessHandle ────────────────────────────────
const WORKER_SRC = `onmessage = async (e) => {
  const { id, path, name, buf } = e.data
  try {
    let d = await navigator.storage.getDirectory()
    for (const p of path) d = await d.getDirectoryHandle(p, { create: true })
    const fh = await d.getFileHandle(name, { create: true })
    const h = await fh.createSyncAccessHandle()
    h.truncate(0); h.write(new Uint8Array(buf), { at: 0 }); h.flush(); h.close()
    postMessage({ id, ok: true })
  } catch (err) { postMessage({ id, ok: false, error: String(err && err.message || err) }) }
}`
let worker: Worker | null = null
let workerSeq = 0
const workerWaits = new Map<number, (r: { ok: boolean; error?: string }) => void>()
function syncWrite(path: string[], name: string, buf: ArrayBuffer): Promise<void> {
  if (!worker) {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })))
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string }>) => { workerWaits.get(e.data.id)?.(e.data); workerWaits.delete(e.data.id) }
  }
  const id = ++workerSeq
  return new Promise((resolve, reject) => {
    workerWaits.set(id, r => (r.ok ? resolve() : reject(new StudioError('unsupported', r.error || 'OPFS write'))))
    worker!.postMessage({ id, path, name, buf }, [buf])
  })
}

/** 写一个档（整档覆盖）。subPath＝相对工程根的目录段（OPFS 退路要用）。 */
async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob, opfsPath: string[] | null): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const cw = (fh as unknown as { createWritable?: () => Promise<FileSystemWritableFileStream> }).createWritable
  if (typeof cw === 'function') {
    const w = await cw.call(fh)
    try { await w.write(data) } catch (e) { await w.abort().catch(() => {}); throw e }
    await w.close()
    return
  }
  if (!opfsPath) throw new StudioError('unsupported', 'createWritable')
  await syncWrite(opfsPath, name, await data.arrayBuffer())
}

/** project.json 的同夹暂存档（点开头：inspectFolder／汇入都略过它）。 */
export const PROJECT_JSON_TMP = '.project.json.tmp'

type MovableHandle = FileSystemFileHandle & { move?: (dest: FileSystemDirectoryHandle, name: string) => Promise<void> }

function isPermissionErr(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && ((e as DOMException).name === 'NotAllowedError' || (e as DOMException).name === 'SecurityError')
}

/**
 * 写 project.json，让外部读者（用户的 AI、编辑器）只会读到旧的整份或新的整份、读不到空档或半截：
 *   先把内容写进同夹的 .project.json.tmp，再用档案句柄的 move(根目录, 'project.json') 换上去（盖掉旧档）。
 * 退回「直接写 project.json」的条件（照实）：
 *   ① 这个浏览器的档案句柄没有 move ⇒ 这个 store 以后都直接写（canMove 记成 false，不再每次建暂存档）；
 *   ② move 丢错（例如这个浏览器的 move 不肯盖掉已存在的档）⇒ 这次删掉暂存档改直接写；从没成功过就记成 false。
 *   授权错（NotAllowedError／SecurityError）照丢，不退回。
 * 直接写时的实况：createWritable 照规格是先写进浏览器自己的暂存、close() 才换上，所以「已存在」的 project.json
 *   不会被读到半截；但「第一次建」时 getFileHandle(create) 会先生出一个空的 project.json，到 close() 前外面读得到空档。
 *   较旧 Safari 的 OPFS 走 SyncAccessHandle（就地截断再写）不是原子的——OPFS 只有这个网页自己读得到，用户的 AI 碰不到。
 */
async function writeProjectText(root: FileSystemDirectoryHandle, data: Blob, opfsPath: string[] | null, state: { canMove?: boolean }): Promise<void> {
  if (state.canMove !== false) {
    const tmp = (await root.getFileHandle(PROJECT_JSON_TMP, { create: true })) as MovableHandle
    if (typeof tmp.move !== 'function') {
      state.canMove = false
      await root.removeEntry(PROJECT_JSON_TMP).catch(() => {})
    } else {
      await writeFile(root, PROJECT_JSON_TMP, data, opfsPath)
      try {
        await tmp.move(root, PROJECT_JSON)
        state.canMove = true
        return
      } catch (e) {
        if (isPermissionErr(e)) throw e
        if (state.canMove !== true) state.canMove = false
        await root.removeEntry(PROJECT_JSON_TMP).catch(() => {})
      }
    }
  }
  await writeFile(root, PROJECT_JSON, data, opfsPath)
}

export interface HandleStoreOptions {
  backend: StorageBackend
  /** 给人看的位置（资料夹名）；OPFS 给空字串。 */
  label: string
  /** OPFS 时这个工程根相对 OPFS 根的路径段（Safari 写档退路用）；资料夹给 null。 */
  opfsPath: string[] | null
}

/** 用一个目录句柄开出 ProjectStore（资料夹与 OPFS 同一份）。 */
export function createHandleStore(root: FileSystemDirectoryHandle, opts: HandleStoreOptions): ProjectStore {
  let lastWrittenText: string | null = null
  let known: number | null | undefined          // watch 已知的 project.json 修改时间（undefined＝还没量过）
  let writing = 0
  // 本会话看到的 project.json 版本（上次 readJSON〔非 peek〕或写时）：安全写拿它比对。undefined＝这个会话还没读写过。
  let seen: { mtime: number | null; text: string | null } | undefined
  let reported: number | null = null            // 已经报给 watch 回调的那个外部版本（免得同一版报两次）
  const watchers = new Set<(c: ExternalChange) => void>()
  const moveState: { canMove?: boolean } = {}       // 这个浏览器的档案句柄能不能 move（写 project.json 用暂存档换上）

  /** 外面改过（跟 seen 不同）⇒ 回现在的修改时间；没改过／档不在 ⇒ null。只差修改时间、内容与 seen 一字不差 ⇒ 算没改（顺手把 seen 的时间更新）。 */
  const outsideChange = async (): Promise<number | null> => {
    const f = await projectFile()
    if (!f) return null
    const lm = f.lastModified
    if (seen && lm === seen.mtime) return null
    if (seen && seen.text !== null && (await f.text()) === seen.text) { seen = { mtime: lm, text: seen.text }; return null }
    return lm
  }
  const reportOutside = (lm: number) => {
    known = lm                                   // watch 下一轮不再为同一版另报
    if (reported === lm) return
    reported = lm
    lastWrittenText = null
    for (const cb of [...watchers]) { try { cb({ lastModified: lm }) } catch { /* 回调自己的错不影响存档结果 */ } }
  }

  const projectFile = async (): Promise<File | null> => {
    try { return await (await root.getFileHandle(PROJECT_JSON)).getFile() } catch (e) { if (isNotFound(e)) return null; return wrapErr(e) }
  }
  const assetsDir = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    try { return await root.getDirectoryHandle(ASSETS_DIR, { create }) } catch (e) { if (isNotFound(e)) return null; return wrapErr(e) }
  }
  const assetsPath = () => (opts.opfsPath ? [...opts.opfsPath, ASSETS_DIR] : null)

  const store: ProjectStore = {
    backend: opts.backend,
    label: opts.label,
    async readJSON<T>(ro?: ReadJSONOptions) {
      const f = await projectFile()
      if (!f) { if (!ro?.peek) seen = { mtime: null, text: null }; return null }
      const text = await f.text()
      let v: T
      try { v = JSON.parse(text) as T } catch (e) { throw new StudioError('bad_json', (e as Error).message) }
      if (!ro?.peek) seen = { mtime: f.lastModified, text }
      return v
    },
    async writeJSON(value) {
      const text = JSON.stringify(value, null, 2) + '\n'
      writing++
      try {
        await writeProjectText(root, new Blob([text], { type: 'application/json' }), opts.opfsPath, moveState)
        lastWrittenText = text
        const f = await projectFile()
        known = f ? f.lastModified : null
        seen = { mtime: known, text }
      } catch (e) { wrapErr(e) } finally { writing-- }
    },
    async writeJSONSafe(value, wo) {
      if (!wo?.force) {
        const lm = await outsideChange()
        if (lm !== null) { reportOutside(lm); return { written: false, reason: 'changed-outside', lastModified: lm } }
      }
      await store.writeJSON(value)
      return { written: true }
    },
    async changedOutside() {
      const lm = await outsideChange()
      if (lm === null) return false
      reportOutside(lm)
      return true
    },
    async lastModified() {
      const f = await projectFile()
      return f ? f.lastModified : null
    },
    async readAsset(name) {
      checkAssetName(name)
      const d = await assetsDir(false)
      if (!d) return null
      try { return await (await d.getFileHandle(name)).getFile() } catch (e) { if (isNotFound(e)) return null; return wrapErr(e) }
    },
    async writeAsset(name, data) {
      checkAssetName(name)
      try {
        const d = (await assetsDir(true))!
        await writeFile(d, name, await toBlob(data), assetsPath())
      } catch (e) { wrapErr(e) }
    },
    async writeExtra(name, data) {
      checkAssetName(name)
      if (name === PROJECT_JSON || name === PROJECT_JSON_TMP || name === ASSETS_DIR) throw new StudioError('bad_asset_name', name)
      try { await writeFile(root, name, typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data, opts.opfsPath) } catch (e) { wrapErr(e) }
    },
    async listAssets() {
      const d = await assetsDir(false)
      if (!d) return []
      const out: AssetInfo[] = []
      try {
        for await (const h of dirValues(d)) {
          if (h.kind !== 'file') continue
          const f = await (h as FileSystemFileHandle).getFile()
          out.push({ name: h.name, size: f.size, lastModified: f.lastModified, type: f.type })
        }
      } catch (e) { wrapErr(e) }
      return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))   // 按码位排（各浏览器一致）
    },
    async deleteAsset(name) {
      checkAssetName(name)
      const d = await assetsDir(false)
      if (!d) return
      try { await d.removeEntry(name) } catch (e) { if (isNotFound(e)) return; wrapErr(e) }
    },
    watch(cb: (c: ExternalChange) => void, intervalMs = WATCH_INTERVAL_MS) {
      let stopped = false
      let busy = false
      const tick = async () => {
        if (stopped || busy || writing) return
        busy = true
        try {
          const f = await projectFile()
          const lm = f ? f.lastModified : null
          if (known === undefined) { known = lm; return }
          if (lm === known || lm === null || !f) { known = lm; return }
          if (writing) return                       // 量的时候自己正在写 ⇒ 下一轮再看
          const text = await f.text()
          known = lm
          if (lastWrittenText !== null && text === lastWrittenText) return   // 只是时间变了、内容是自己写的那份
          lastWrittenText = null
          if (reported === lm) return               // 安全写已经替这一版报过
          reported = lm
          if (!stopped) cb({ lastModified: lm })
        } catch { /* 授权掉了／暂时读不到：这一轮跳过，Shell 存档时会接到 permission 错 */ } finally { busy = false }
      }
      watchers.add(cb)
      void tick()
      const timer = setInterval(() => { void tick() }, intervalMs)
      return () => { stopped = true; watchers.delete(cb); clearInterval(timer) }
    },
  }
  return store
}

/** 资料夹工程。 */
export function folderStore(dir: DirHandle): ProjectStore {
  return createHandleStore(dir, { backend: 'folder', label: dir.name, opfsPath: null })
}

/** OPFS 工程：<OPFS 根>/dilin-studio/<app>/<id>/（不存在就建）。 */
export async function opfsStore(app: StudioAppId, id: string): Promise<ProjectStore> {
  const path = [OPFS_ROOT, app, id]
  let d = await navigator.storage.getDirectory()
  for (const p of path) d = await d.getDirectoryHandle(p, { create: true })
  return createHandleStore(d, { backend: 'opfs', label: '', opfsPath: path })
}

/** 删掉 OPFS 里某个工程（从清单移除 OPFS 工程时用）。 */
export async function deleteOpfsProject(app: StudioAppId, id: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const appDir = await (await root.getDirectoryHandle(OPFS_ROOT)).getDirectoryHandle(app)
    await appDir.removeEntry(id, { recursive: true })
  } catch (e) { if (!isNotFound(e)) throw e }
}

/** 把一个 store 的全部内容（project.json＋全部素材）复制到另一个（换资料夹用）。目标多出来的素材会删掉。 */
export async function copyProject(from: ProjectStore, to: ProjectStore): Promise<void> {
  const json = await from.readJSON({ peek: true })
  const assets = await from.listAssets()
  const keep = new Set(assets.map(a => a.name))
  for (const a of assets) {
    const b = await from.readAsset(a.name)
    if (b) await to.writeAsset(a.name, b)
  }
  for (const a of await to.listAssets()) if (!keep.has(a.name)) await to.deleteAsset(a.name)
  if (json !== null) await to.writeJSON(json)
}

class Refused extends Error {
  constructor(readonly result: Extract<SafeWriteResult, { written: false }>) { super('changed-outside') }
}

/**
 * 编辑器的自动存用这支包住自己的 format.save：
 *
 *   const r = await saveProjectSafe(store, s => format.save(s, doc))            // 自动存
 *   const r = await saveProjectSafe(store, s => format.save(s, doc), { force: true })   // 明确存档／flush（照写）
 *   if (!r.written) { 留着「未存」；Shell 已经收到「外面改过」、会问使用者 }
 *
 * 做法：先 changedOutside() 挡（外面改过 ⇒ 素材也一个都不写）；没改过才跑 save，并把 save 里的 writeJSON 换成安全写
 * （比对与 save 之间外面又改了 ⇒ 照样不写 project.json、回 changed-outside；那之前已写的素材留着，不会被 project.json 引用到的就是多出来的档）。
 * save 丢的其他错照丢。
 */
export async function saveProjectSafe(store: ProjectStore, save: (s: ProjectStore) => Promise<void>, o?: { force?: boolean }): Promise<SafeWriteResult> {
  if (o?.force) { await save(store); return { written: true } }
  if (await store.changedOutside()) {
    const lm = await store.lastModified()
    return { written: false, reason: 'changed-outside', lastModified: lm ?? 0 }
  }
  const view: ProjectStore = {
    backend: store.backend,
    label: store.label,
    readJSON: r => store.readJSON(r),
    writeJSON: async v => { const r = await store.writeJSONSafe(v); if (!r.written) throw new Refused(r) },
    writeJSONSafe: (v, w) => store.writeJSONSafe(v, w),
    changedOutside: () => store.changedOutside(),
    lastModified: () => store.lastModified(),
    readAsset: n => store.readAsset(n),
    writeAsset: (n, d) => store.writeAsset(n, d),
    listAssets: () => store.listAssets(),
    deleteAsset: n => store.deleteAsset(n),
    writeExtra: store.writeExtra && ((n, x) => store.writeExtra!(n, x)),
    watch: (cb, i) => store.watch(cb, i),
  }
  try { await save(view) } catch (e) { if (e instanceof Refused) return e.result; throw e }
  return { written: true }
}

/** 资料夹里有什么：有没有 project.json、有没有别的东西（新开时挑到非空资料夹要先问）。 */
export async function inspectFolder(dir: FileSystemDirectoryHandle): Promise<{ hasProjectJson: boolean; otherEntries: number }> {
  let hasProjectJson = false
  let otherEntries = 0
  for await (const h of dirValues(dir)) {
    if (h.name === PROJECT_JSON && h.kind === 'file') hasProjectJson = true
    else if (!h.name.startsWith('.')) otherEntries++
  }
  return { hasProjectJson, otherEntries }
}
