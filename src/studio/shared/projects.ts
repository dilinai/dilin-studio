// 工程编号与绑机：这台浏览器上有哪些工程，记在 IndexedDB（库 dilin-studio、表 projects）。
//   编号＝128 位随机（32 个小写十六进位字），网址 /studio/<app>/<编号>。别台／别的浏览器没有这笔纪录 ⇒ 打不开（只显示提示）。
//   资料夹工程把 FileSystemDirectoryHandle 一起存进去（浏览器允许结构化复制），重开要 requestPermission。

import type { StorageBackend, StudioAppId } from './types'
import type { DirHandle } from './fs-types'

export interface ProjectRecord {
  id: string
  app: StudioAppId
  name: string
  backend: StorageBackend
  /** backend＝folder 时的资料夹句柄。 */
  handle?: DirHandle
  createdAt: number
  updatedAt: number
  /** true＝开出来时是空工程（不是汇入的、也不是资料夹里原有的）。配合 updatedAt===createdAt 判「刚开、没动过」。 */
  blank?: boolean
}

const DB_NAME = 'dilin-studio'
const DB_VERSION = 1
const STORE = 'projects'

export const PROJECT_ID_RE = /^[0-9a-f]{32}$/
export function isProjectId(x: unknown): x is string {
  return typeof x === 'string' && PROJECT_ID_RE.test(x)
}

/** 128 位随机编号（crypto.getRandomValues）。 */
export function newProjectId(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('app', 'app')
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { dbp = null; reject(r.error) }
  })
  return dbp
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await db()).transaction(STORE, mode).objectStore(STORE)
}

/** 这台浏览器上某个编辑器的工程（最近改的在前）。 */
export async function listProjects(app: StudioAppId): Promise<ProjectRecord[]> {
  const s = await tx('readonly')
  const all = await req(s.index('app').getAll(app) as IDBRequest<ProjectRecord[]>)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  if (!isProjectId(id)) return null
  const s = await tx('readonly')
  return ((await req(s.get(id))) as ProjectRecord | undefined) ?? null
}

export async function putProject(rec: ProjectRecord): Promise<void> {
  const s = await tx('readwrite')
  await req(s.put(rec))
}

/** 改名／改存放位置／记最后修改。 */
export async function updateProject(id: string, patch: Partial<Omit<ProjectRecord, 'id' | 'app'>>): Promise<ProjectRecord | null> {
  const cur = await getProject(id)
  if (!cur) return null
  const next = { ...cur, ...patch }
  await putProject(next)
  return next
}

export async function removeProject(id: string): Promise<void> {
  const s = await tx('readwrite')
  await req(s.delete(id))
}

/** 工程清单的读写口（浏览器用 IndexedDB 那组；单测换成记忆体那份）。 */
export interface ProjectRegistry {
  /** 某个编辑器的工程（最近改的在前）。 */
  list(app: StudioAppId): Promise<ProjectRecord[]>
  get(id: string): Promise<ProjectRecord | null>
  put(rec: ProjectRecord): Promise<void>
  update(id: string, patch: Partial<Omit<ProjectRecord, 'id' | 'app'>>): Promise<ProjectRecord | null>
  remove(id: string): Promise<void>
}

export const idbRegistry: ProjectRegistry = {
  list: listProjects, get: getProject, put: putProject, update: updateProject, remove: removeProject,
}

/** 记忆体清单（单测用；排序规则同 listProjects）。 */
export function memoryRegistry(seed: ProjectRecord[] = []): ProjectRegistry & { all(): ProjectRecord[] } {
  const m = new Map<string, ProjectRecord>(seed.map(r => [r.id, { ...r }]))
  return {
    all: () => [...m.values()],
    list: async app => [...m.values()].filter(r => r.app === app).sort((a, b) => b.updatedAt - a.updatedAt),
    get: async id => m.get(id) ?? null,
    put: async rec => { m.set(rec.id, { ...rec }) },
    update: async (id, patch) => { const cur = m.get(id); if (!cur) return null; const next = { ...cur, ...patch }; m.set(id, next); return next },
    remove: async id => { m.delete(id) },
  }
}
