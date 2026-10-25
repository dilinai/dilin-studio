// 单机版：开着的编辑器页跟本机小服务（tools/serve.mjs＋tools/agent-mcp.mjs）的本机 MCP 接上——AI 经 MCP 下的命令排到这页、在这页的引擎里跑、结果交回。
//   先 GET /_agent/hello 探一次：不是单机小服务（网站游客版、Perl／Python 版小服务）⇒ 什么都不做。
//   接上后一直 GET /_agent/poll 长轮询取活（带这页是哪种编辑器、哪份工程、看不看得见）→ handle 跑 → POST /_agent/reply 交回；关页 ⇒ /_agent/leave。
//   只用同源 fetch（小服务只认同源）·不碰 React。

export type AgentEditor = import('./types').StudioAppId
export type AgentJob = { id: string; kind: string } & Record<string, unknown>
export type AgentReply = { ok: true; result: unknown } | { ok: false; error: string; message?: string }
export type AgentLinkOpts = {
  editor: AgentEditor
  /** 这页开着哪份工程（每次取活前问） */
  project: () => { id: string; title?: string } | null
  handle: (job: AgentJob) => Promise<AgentReply>
  /** 测试换掉 */
  fetch?: typeof fetch
  base?: string
  retryMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// AI 已经经本机 MCP 在这页动手了（接到第一件活起）：右栏「先选存放位置」那层挡板就收起来（AIPanel FolderGate）——
// AI 在画、页面还挡着人要位置，不合理；作品照常先存这个浏览器，右栏那行「還沒選存放位置」留着提醒。
let agentActive = false
const agentSubs = new Set<() => void>()
export const agentLinkActive = (): boolean => agentActive
export function subscribeAgentActive(cb: () => void): () => void { agentSubs.add(cb); return () => { agentSubs.delete(cb) } }
function markAgentActive() { if (agentActive) return; agentActive = true; for (const cb of [...agentSubs]) cb() }
/** 测试用：回到没接过活 */
export function resetAgentActive() { agentActive = false }
const pageId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`)

/** 开始接活·回停止函数（卸页时叫）。小服务不是单机版那支 ⇒ 探一次就停 */
export function startAgentLink(o: AgentLinkOpts): () => void {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const base = o.base ?? ''
  const retry = o.retryMs ?? 3000
  const page = pageId()
  let stop = false
  let ctl: AbortController | null = null
  let linked = false
  const leave = () => {
    if (!linked) return
    linked = false
    const body = JSON.stringify({ page })
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) navigator.sendBeacon(`${base}/_agent/leave`, new Blob([body], { type: 'application/json' }))
      else void f(`${base}/_agent/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    } catch { /* 关页时送不出就算了：小服务那头几秒没人来取也当关了 */ }
  }
  const onHide = () => leave()
  void (async () => {
    try {
      const r = await f(`${base}/_agent/hello`, { cache: 'no-store' })
      const j = (await r.json().catch(() => null)) as { name?: unknown } | null
      if (!r.ok || !j || j.name !== 'dilin-studio-agent') return
    } catch { return }
    if (stop) return
    linked = true
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide)
    while (!stop) {
      const p = o.project()
      const q = new URLSearchParams({
        page, editor: o.editor, project: p?.id ?? '', title: p?.title ?? '',
        vis: typeof document === 'undefined' || document.visibilityState === 'visible' ? 'visible' : 'hidden',
        focus: typeof document !== 'undefined' && document.hasFocus?.() ? '1' : '0',
      })
      let job: AgentJob | null = null
      try {
        ctl = new AbortController()
        const r = await f(`${base}/_agent/poll?${q}`, { cache: 'no-store', signal: ctl.signal })
        if (r.status === 200) job = (await r.json()) as AgentJob
        else if (r.status !== 204) await sleep(retry)
      } catch {
        if (stop) break
        await sleep(retry)
        continue
      }
      if (!job || stop) continue
      let reply: AgentReply
      markAgentActive()
      try { reply = await o.handle(job) } catch (e) { reply = { ok: false, error: 'command_failed', message: e instanceof Error ? e.message : String(e) } }
      try {
        await f(`${base}/_agent/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, id: job.id, reply }) })
      } catch { /* 小服务关了：下一圈取活会失败、等一下再试 */ }
    }
  })()
  return () => {
    stop = true
    ctl?.abort()
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide)
    leave()
  }
}
