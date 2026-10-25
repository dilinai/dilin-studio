// 打开 /s/<码>（ui/SharePage.tsx 接）：GET 取作品 ⇒ 本机登记有这个码、那份工程也还在 ⇒ 沿用；
//   否则存成这个浏览器里新的一份（素材一并下载）、记进登记。手上没有页面票 ⇒ POST claim：
//   拿到 ⇒ 记下（这台浏览器就是编辑那份的页）；409（别的浏览器先认领了）⇒ 只读。404 ⇒ 过期或删了。

import type { ProjectStore, StudioApp, StudioAppId } from './types'
import { StudioError, isStudioAppId } from './types'
import type { ProjectRecord } from './projects'
import { createOpfsProject, type ProjectEnv } from './project-actions'
import { checkProjectHeader } from './project-file'
import { isShareHttpError, type ShareApi } from './share-api'
import type { ShareBook, ShareEntry } from './share-book'

export type ShareOpenResult =
  | { kind: 'gone'; app: StudioAppId | null }
  | { kind: 'ready'; def: StudioApp<unknown>; rec: ProjectRecord; store: ProjectStore; readonly: boolean }

export interface ShareOpenDeps {
  api: ShareApi
  book: ShareBook
  env: ProjectEnv
  loadApp(app: StudioAppId): Promise<StudioApp<unknown>>
  /** 工程名缺省（project.json 里没有 name 时用）。 */
  defaultName(app: StudioAppId): string
}

export async function openSharedProject(code: string, d: ShareOpenDeps): Promise<ShareOpenResult> {
  let got
  try { got = await d.api.get(code) } catch (e) {
    if (isShareHttpError(e, 404)) return { kind: 'gone', app: d.book.get(code)?.app ?? null }
    throw e
  }
  if (!isStudioAppId(got.app)) throw new StudioError('bad_format', String(got.app))
  const app = got.app
  const def = await d.loadApp(app)
  let entry: ShareEntry | null = d.book.get(code)

  // 本机已有这一份 ⇒ 沿用（比服务器旧的话，同步层轮询会拉新版）
  let rec: ProjectRecord | null = null
  let store: ProjectStore | null = null
  if (entry && entry.app === app) {
    const r = await d.env.registry.get(entry.projectId)
    if (r && r.app === app && r.backend === 'opfs') {
      try {
        const s = await d.env.openOpfs(app, r.id)
        if ((await s.readJSON({ peek: true })) !== null) { rec = r; store = s }
      } catch { /* 读不了 ⇒ 重存一份 */ }
    }
  }
  if (!rec || !store) {
    const json = checkProjectHeader(got.project, app, def.format.version)
    const assets: { name: string; data: Blob }[] = []
    for (const [name, url] of Object.entries(got.assets ?? {})) assets.push({ name, data: await d.api.download(url) })
    rec = await createOpfsProject(d.env, def, d.defaultName(app), { json, assets })
    store = await d.env.openOpfs(app, rec.id)
    entry = { code, projectId: rec.id, app, ...(entry?.token ? { token: entry.token } : {}), version: Number(got.version) || 1 }
    d.book.put(entry)
  }
  const e = entry!
  let token = e.token
  if (!token) {
    try {
      token = await d.api.claim(code)
      d.book.update(code, { token })
    } catch {
      token = undefined                                     // 409＝别的浏览器先认领了 ⇒ 只读（连不上也先只读，重开再认领）
    }
  }
  return { kind: 'ready', def, rec, store, readonly: !token }
}
