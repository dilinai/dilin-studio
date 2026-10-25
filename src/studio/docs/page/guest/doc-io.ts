// 游客版：页面的「读这份文件／存回这份文件」接到工程 project.json。
//   页面照登入版那样一发一发送 PUT（部分栏位：title／content／layers／paper_settings…），这里合进记忆体那份、整份写回。
//   自动存走安全写：外面（使用者自己的 AI）在这个会话读写之后改过 project.json ⇒ 不写、回 409（页面留着「未存」，外框会问要不要重新载入）；
//   外框要先存（汇出、换存放位置）＝明确存档 ⇒ withForce 里那几发照写。几发之间排队，不会两发同时写。
import type { ProjectStore, SaveState } from '../../../shared/types'
import { docsDocToJson, docsFormat, saveDocs, type DocsDoc } from '../../format'
import { resolvePaperSettings } from '../../core/paper-size'
import { sanitizeDocLayers } from '../../core/doc-layers/types'
import type { HostResponse } from '../host'
import type { AssetJanitor } from './asset-janitor'

/** 工程里的这份文件 ⇒ 网站云文档 GET 回的那个形状（页面照原样读）。 */
export function docRecord(doc: DocsDoc, updatedAt: string): Record<string, unknown> {
  return {
    title: doc.name,
    content: doc.content,
    paper_settings: doc.paper,
    paper_pref: doc.paper.paper,
    layers: doc.layers,
    updated_at: updatedAt,
  }
}

export function hostResponse(status: number, body: unknown): HostResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(JSON.stringify(body ?? null)),
    clone: () => hostResponse(status, body),
    blob: async () => new Blob([JSON.stringify(body ?? null)], { type: 'application/json' }),
  }
}

/** 页面 PUT 的栏位合进这份文件（认得的才动）；回 null＝这发没碰到文件本身（例如分享、上架那类栏位）。 */
export function applyDocPut(cur: DocsDoc, body: Record<string, unknown>): DocsDoc | null {
  const touched = ['title', 'content', 'layers', 'paper_settings'].some(k => k in body)
  if (!touched) return null
  const next: DocsDoc = { ...cur }
  if (typeof body.title === 'string') next.name = body.title
  if (typeof body.content === 'string') next.content = body.content
  if ('layers' in body) {
    const l = sanitizeDocLayers(body.layers)
    next.layers = l && l.items.length ? l : null
  }
  if ('paper_settings' in body) next.paper = resolvePaperSettings(body.paper_settings, body.paper_pref)
  return next
}

export interface GuestDocIO {
  getDoc(): Promise<HostResponse>
  putDoc(body: Record<string, unknown>): Promise<HostResponse>
  /** 里面送出的几发＝明确存档（不比对外面改过没有）。 */
  withForce<T>(fn: () => Promise<T>): Promise<T>
}

export function createGuestDocIO(o: {
  store: ProjectStore
  janitor: AssetJanitor
  onSaveState?: (s: SaveState, detail?: string) => void
}): GuestDocIO {
  const { store, janitor } = o
  let doc: DocsDoc | null = null
  let loading: Promise<DocsDoc> | null = null
  let chain: Promise<unknown> = Promise.resolve()
  let force = 0
  let seq = 0
  const stamp = () => `${new Date().toISOString()}#${++seq}`

  const load = (): Promise<DocsDoc> => {
    if (!loading) {
      loading = docsFormat.load(store).then((d) => {
        doc = d
        // 刚打开的文件还没有撤销历史 ⇒ 正文没提到的编辑器自命名档都可以清
        chain = chain.then(() => janitor.sweep(d.content, true)).catch(() => undefined)
        return d
      })
    }
    return loading
  }

  return {
    async getDoc() {
      const d = doc ?? await load()
      return hostResponse(200, docRecord(d, stamp()))
    },
    putDoc(body) {
      const run = chain.then(async () => {
        const cur = doc ?? await load()
        const next = applyDocPut(cur, body)
        if (!next) return hostResponse(200, { title: cur.name })
        // 一字没变（例如刚打开那一拍的例行存档）⇒ 不写档
        if (JSON.stringify(docsDocToJson(next)) === JSON.stringify(docsDocToJson(cur))) return hostResponse(200, { title: next.name, updated_at: stamp() })
        o.onSaveState?.('saving')
        try {
          await janitor.restore(next.content)
          const r = await saveDocs(store, next, { force: force > 0 })
          if (!r.written) {
            o.onSaveState?.('dirty')
            return hostResponse(409, { error: 'changed outside' })
          }
          doc = next
        } catch (e) {
          o.onSaveState?.('error', String((e as Error)?.message || e))
          throw e
        }
        try { await janitor.sweep(next.content) } catch { /* 下一次存档再清 */ }
        return hostResponse(200, { title: next.name, updated_at: stamp() })
      })
      chain = run.catch(() => undefined)
      return run
    },
    async withForce(fn) {
      force++
      try { return await fn() } finally { force-- }
    },
  }
}
