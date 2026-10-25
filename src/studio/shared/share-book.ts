// 本机的短网址登记：哪个码对上这台浏览器的哪一份工程、手上有没有页面票、上次对上的服务器版本。
//   存 localStorage（键 dilin-studio-shares·一张 码→登记 的表）：页面票只存在这台浏览器；跟工程清单（IndexedDB）分开写，
//   免得跟外框改名／记最后修改那几笔同时写、互相盖掉。单测换 memoryShareBook。

import type { StudioAppId } from './types'

export interface ShareEntry {
  code: string
  /** 本机工程编号（projects.ts 那份清单的 id）。 */
  projectId: string
  app: StudioAppId
  /** 页面票（建立或认领拿到的）；没有 ⇒ 只读（别的浏览器先认领了）。 */
  token?: string
  /** 本机这份对上的服务器版本（推新版的 base_version）。 */
  version: number
}

export interface ShareBook {
  get(code: string): ShareEntry | null
  byProject(projectId: string): ShareEntry | null
  put(e: ShareEntry): void
  update(code: string, patch: Partial<Omit<ShareEntry, 'code'>>): ShareEntry | null
  remove(code: string): void
}

export const SHARE_BOOK_KEY = 'dilin-studio-shares'

function fromTable(read: () => Record<string, ShareEntry>, write: (t: Record<string, ShareEntry>) => void): ShareBook {
  return {
    get: code => read()[code] ?? null,
    byProject: id => Object.values(read()).find(e => e.projectId === id) ?? null,
    put: e => { const t = read(); t[e.code] = { ...e }; write(t) },
    update: (code, patch) => { const t = read(); const cur = t[code]; if (!cur) return null; const next = { ...cur, ...patch, code }; t[code] = next; write(t); return next },
    remove: code => { const t = read(); delete t[code]; write(t) },
  }
}

export const localShareBook: ShareBook = fromTable(
  () => {
    try {
      const v = JSON.parse(localStorage.getItem(SHARE_BOOK_KEY) || '{}')
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, ShareEntry> : {}
    } catch { return {} }
  },
  t => { try { localStorage.setItem(SHARE_BOOK_KEY, JSON.stringify(t)) } catch { /* 存不了：这次开着的分页照常，重开要重新认领 */ } },
)

export function memoryShareBook(seed: ShareEntry[] = []): ShareBook & { all(): ShareEntry[] } {
  let t: Record<string, ShareEntry> = Object.fromEntries(seed.map(e => [e.code, { ...e }]))
  const b = fromTable(() => ({ ...t }), n => { t = n })
  return { ...b, all: () => Object.values(t) }
}
