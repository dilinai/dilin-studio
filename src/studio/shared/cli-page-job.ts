// 单机版命令列（tools/docs-cli.mjs、tools/slides-cli.mjs）开的无头页：本机小服务交来的两种活，游客工程页（GuestProjectPage）先接、
//   不是这两种 ⇒ 回 null，照旧交给编辑器的 agentJob（read／edit／run）。
//   load   ＝ 换掉这页的工程（project.json＋assets/·base64）再重载编辑页——只认命令列开的页（网址带 cli=1），使用者自己开的页一律拒；
//   export ＝ 编辑器的 cliExport（要浏览器 DOM 的汇出：文件 Word、简报网页版／PowerPoint），回 base64 档。
import type { ProjectStore, StudioApp, StudioAgentReply, StudioT } from './types'

/** 这一页是命令列开的（…&cli=1）：载入时就读——开新工程会改网址（history.replaceState）把它拿掉 */
export const OPENED_BY_CLI: boolean = (() => { try { return new URLSearchParams(window.location.search).get('cli') === '1' } catch { return false } })()

const toB64 = async (b: Blob): Promise<string> => {
  const u = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string): Uint8Array => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }

export type CliPageCtx = {
  appDef: StudioApp<unknown>
  store: ProjectStore
  t: StudioT
  /** 页上手上的改动先存 */
  flush(): Promise<void>
  /** 从 store 重读、重画编辑页 */
  reload(): void
  /** 这页是命令列开的（测试换掉） */
  cli?: boolean
  /** project.json 多久不变算稳（毫秒·缺省 1500·测试换短） */
  settleMs?: number
}

/** 等 project.json 连续 ms 毫秒不变（最多 10 秒）⇒ 回那时的内容 */
async function settle(store: ProjectStore, ms = 1500): Promise<unknown> {
  const step = Math.max(10, Math.min(250, ms / 4))
  let last = JSON.stringify(await store.readJSON({ peek: true }).catch(() => null)), same = 0
  for (let waited = 0; same < ms && waited < 10_000; waited += step) {
    await new Promise((r) => setTimeout(r, step))
    const now = JSON.stringify(await store.readJSON({ peek: true }).catch(() => null))
    if (now === last) same += step; else { same = 0; last = now }
  }
  return last === undefined ? null : JSON.parse(last)
}

export async function cliPageJob(c: CliPageCtx, job: { kind?: unknown; format?: unknown; json?: unknown; assets?: unknown }): Promise<StudioAgentReply | null> {
  if (job.kind === 'export') {
    const run = c.appDef.cliExport
    if (!run) return { ok: false, error: 'not_available', message: 'this editor has no page-side export' }
    try {
      await c.flush()
      const r = await run(c.store, String(job.format ?? ''), c.t)
      const files = []
      for (const f of r.files) files.push({ name: f.name, mime: f.blob.type || 'application/octet-stream', base64: await toB64(f.blob), bytes: f.blob.size })
      return { ok: true, result: { files, notes: r.notes ?? [] } }
    } catch (e) { return { ok: false, error: 'command_failed', message: e instanceof Error ? e.message : String(e) } }
  }
  if (job.kind === 'load') {
    if (!(c.cli ?? OPENED_BY_CLI)) return { ok: false, error: 'not_available', message: 'only a page opened by the command-line tool can have its project replaced' }
    if (!job.json || typeof job.json !== 'object' || Array.isArray(job.json)) return { ok: false, error: 'bad_params', message: 'json must be the project.json object' }
    try {
      // 刚开的新工程页还会自己存第一次（排在后面的自动存）：先等 project.json 不再变，免得那一笔盖掉换进来的工程
      await c.flush()
      await settle(c.store, c.settleMs)
      const assets = (job.assets && typeof job.assets === 'object' ? job.assets : {}) as Record<string, unknown>
      for (const [n, b] of Object.entries(assets)) if (typeof b === 'string') await c.store.writeAsset(n, fromB64(b))
      const name = (job.json as { name?: unknown }).name
      for (let k = 0; ; k++) {
        await c.store.writeJSON(job.json)
        c.reload()
        // 重载后编辑页可能照它的规矩重存一次（正常）；名字被换回别的 ⇒ 是旧页那笔晚到的存档盖掉了 ⇒ 再写一次
        const now = await settle(c.store, c.settleMs) as { name?: unknown } | null
        if (!now || now.name === name || k >= 2) {
          if (now && now.name !== name) return { ok: false, error: 'command_failed', message: 'the page kept overwriting the project' }
          break
        }
      }
      return { ok: true, result: { loaded: true, assets: Object.keys(assets).length } }
    } catch (e) { return { ok: false, error: 'command_failed', message: e instanceof Error ? e.message : String(e) } }
  }
  return null
}
