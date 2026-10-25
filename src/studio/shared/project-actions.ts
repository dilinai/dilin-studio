// 工程清单的动作：直开（不问存哪）、新开到资料夹、汇入成新工程、切换、改名、移除、关掉后去哪。
//   不碰画面；储存与清单都从 ProjectEnv 进来（浏览器用 browserProjectEnv，单测换成记忆体清单＋假目录）。
//
// 「刚开、没动过」的空工程（isPristineProject）：存在浏览器里（OPFS）、开出来时就是空的（blank）、updatedAt 还等于 createdAt。
//   Shell 只有在编辑器真的报过「有改动」之后存档才更新 updatedAt（载入时报的「已存」不算），改名、汇入、换资料夹也会更新它。
//   直开时这个编辑器有这样一份 ⇒ 沿用它（取最近的那份），不再多开一份空的。

import type { ProjectPayload, ProjectStore, StudioApp, StudioAppId } from './types'
import { ensureFolderPermission, type DirHandle } from './fs-types'
import { deleteOpfsProject, folderStore, inspectFolder, opfsStore } from './store'
import { idbRegistry, newProjectId, type ProjectRecord, type ProjectRegistry } from './projects'
import { applyPayload } from './zip'
import { checkProjectHeader, projectNameOf, writeProjectName } from './project-file'
import { studioHref } from './host'
import { studioNeg } from './ai-panel.pure'

export interface ProjectEnv {
  registry: ProjectRegistry
  openOpfs(app: StudioAppId, id: string): Promise<ProjectStore>
  deleteOpfs(app: StudioAppId, id: string): Promise<void>
  openFolder(dir: DirHandle): ProjectStore
  /** 资料夹读写授权（request＝可以在使用者这一下点击里问）。 */
  folderAllowed(dir: DirHandle, request: boolean): Promise<boolean>
  now(): number
  newId(): string
}

export const browserProjectEnv: ProjectEnv = {
  registry: idbRegistry,
  openOpfs: opfsStore,
  deleteOpfs: deleteOpfsProject,
  openFolder: folderStore,
  folderAllowed: ensureFolderPermission,
  now: () => Date.now(),
  newId: newProjectId,
}

/** 开新工程只要用到编辑器的这两格。 */
export type ProjectAppDef = Pick<StudioApp<unknown>, 'app' | 'format'>

/** 刚开、没动过的空工程（直开时沿用）。 */
export function isPristineProject(rec: ProjectRecord): boolean {
  return rec.backend === 'opfs' && rec.blank === true && rec.updatedAt === rec.createdAt
}

/** 在这个浏览器（OPFS）开一份新工程：没给 payload ⇒ 空工程；给了 ⇒ 汇入的内容（名字用工程档里的 name）。 */
export async function createOpfsProject(env: ProjectEnv, def: ProjectAppDef, name: string, payload?: ProjectPayload | null): Promise<ProjectRecord> {
  const id = env.newId()
  const now = env.now()
  const store = await env.openOpfs(def.app, id)
  let n = name
  if (payload) {
    await applyPayload(store, payload)
    n = projectNameOf(payload.json) ?? name
  } else {
    await def.format.save(store, def.format.emptyProject())
  }
  const rec: ProjectRecord = { id, app: def.app, name: n, backend: 'opfs', createdAt: now, updatedAt: now, ...(payload ? {} : { blank: true }) }
  await env.registry.put(rec)
  return rec
}

/**
 * 直开：这个编辑器有「刚开、没动过」的空工程 ⇒ 回最近那份（工程档不见了就补一份空的）；没有 ⇒ 在浏览器里新开一份。
 * forceNew（网址 ?new=1·/dilin 顶栏图示带的）⇒ 一律新开一份，不沿用清单里任何一份（上一份留在原网址与清单里）。
 * 回的纪录拿去换网址进编辑页。
 */
export async function openFreshProject(env: ProjectEnv, def: ProjectAppDef, name: string, opts?: { forceNew?: boolean }): Promise<ProjectRecord> {
  // 负控 DILIN_NEG=studio-entry-new ⇒ 退回修前（不认 ?new=1·照旧沿用）
  if (opts?.forceNew && !studioNeg('studio-entry-new')) return createOpfsProject(env, def, name)
  for (const r of await env.registry.list(def.app)) {
    if (!isPristineProject(r)) continue
    try {
      const store = await env.openOpfs(def.app, r.id)
      if ((await store.readJSON({ peek: true })) === null) await def.format.save(store, def.format.emptyProject())
      return r
    } catch { /* 这份读不了 ⇒ 看下一份，都不行就新开 */ }
  }
  return createOpfsProject(env, def, name)
}

/**
 * 新开到使用者挑的资料夹：
 *   同一个资料夹已经在清单里 ⇒ 回那份（existed）；资料夹里已有这个编辑器的工程档 ⇒ 收进清单、不改内容；
 *   别的编辑器的工程档 ⇒ 丢 bad_format；有别的档没工程档 ⇒ 先问（confirmNonEmpty 回 false ⇒ 回 null、什么都不做）；空资料夹 ⇒ 写一份空工程。
 */
export async function createFolderProject(
  env: ProjectEnv, def: ProjectAppDef, dir: DirHandle, confirmNonEmpty: (folderName: string) => Promise<boolean>,
): Promise<{ rec: ProjectRecord; existed: boolean } | null> {
  for (const p of await env.registry.list(def.app)) {
    if (p.backend === 'folder' && p.handle && (await p.handle.isSameEntry(dir).catch(() => false))) return { rec: p, existed: true }
  }
  const ins = await inspectFolder(dir)
  const store = env.openFolder(dir)
  let name = dir.name
  if (ins.hasProjectJson) {
    const j = checkProjectHeader(await store.readJSON({ peek: true }), def.app, def.format.version)
    name = projectNameOf(j) ?? name
  } else {
    if (ins.otherEntries > 0 && !(await confirmNonEmpty(dir.name))) return null
    await def.format.save(store, def.format.emptyProject())
  }
  const now = env.now()
  const rec: ProjectRecord = { id: env.newId(), app: def.app, name, backend: 'folder', handle: dir, createdAt: now, updatedAt: now }
  await env.registry.put(rec)
  return { rec, existed: false }
}

/** 切到清单里另一份：先把手上的改动存下去，再换网址（flush 丢错 ⇒ 不换、错照丢）。 */
export async function switchProject(flush: () => Promise<void>, navigate: (href: string) => void, app: StudioAppId, id: string): Promise<void> {
  await flush()
  navigate(studioHref.project(app, id))
}

/**
 * 改清单里「不是正在开的那份」的名字：清单名＋project.json 的 name 一起改（打开时清单名会跟着 project.json 走，只改清单会被盖回去）。
 *   资料夹工程拿不到读写授权、或工程档读不了 ⇒ 只改清单名。名字空白或没变 ⇒ 回 null、什么都不改。
 */
export async function renameProject(env: ProjectEnv, rec: ProjectRecord, raw: string): Promise<ProjectRecord | null> {
  const name = raw.trim().slice(0, 120)
  if (!name || name === rec.name) return null
  try {
    let store: ProjectStore | null = null
    if (rec.backend === 'opfs') store = await env.openOpfs(rec.app, rec.id)
    else if (rec.handle && (await env.folderAllowed(rec.handle, true))) store = env.openFolder(rec.handle)
    if (store) {
      await store.readJSON()          // 这一版当安全写的基准
      await writeProjectName(store, name)
    }
  } catch { /* 写不进工程档 ⇒ 只改清单名 */ }
  return env.registry.update(rec.id, { name, updatedAt: env.now() })
}

/** 从清单移除：存在浏览器里的连内容删掉；资料夹的只移出清单、资料夹原样留着。 */
export async function removeProjectEntry(env: ProjectEnv, rec: ProjectRecord): Promise<void> {
  if (rec.backend === 'opfs') await env.deleteOpfs(rec.app, rec.id)
  await env.registry.remove(rec.id)
}

/** 关掉这份（画板「檔案▸關閉」、移除正在开的那份）之后去哪：这个编辑器最近的另一份；一份都没有 ⇒ /studio 总页。 */
export async function leaveTarget(env: ProjectEnv, app: StudioAppId, currentId: string): Promise<string> {
  const other = (await env.registry.list(app)).find(r => r.id !== currentId)
  return other ? studioHref.project(app, other.id) : studioHref.root()
}
