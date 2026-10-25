// project.json 的表头（format／version／name）检查与读写。各编辑器的 format.load／save 建议直接用这两支：
//
//   load: async store => { const j = await readProjectJson(store, 'sheets', 1); return j ? toDoc(j) : empty() }
//   save: (store, doc) => writeProjectJson(store, 'sheets', 1, { name: doc.name, sheets: doc.sheets })
//
// 表头规矩：format 必须正好是 "dilin-studio/<app>"；version 是正整数且 ≤ 这版网页认得的版本（大于 ⇒ 'too_new' 拒收）。

import type { ProjectHeader, ProjectStore, SafeWriteResult, StudioAppId } from './types'
import { StudioError } from './types'

export function formatTag(app: StudioAppId): `dilin-studio/${StudioAppId}` {
  return `dilin-studio/${app}`
}

/** 检查一份已解析的 project.json：合格 ⇒ 回原物件（带表头型别）；不合格 ⇒ 丢 StudioError。 */
export function checkProjectHeader(json: unknown, app: StudioAppId, maxVersion: number): ProjectHeader & Record<string, unknown> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new StudioError('bad_format', typeof json)
  const o = json as Record<string, unknown>
  if (o.format !== formatTag(app)) throw new StudioError('bad_format', typeof o.format === 'string' ? o.format : String(o.format))
  const v = o.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new StudioError('bad_format', `version=${String(v)}`)
  if (v > maxVersion) throw new StudioError('too_new', String(v))
  return o as ProjectHeader & Record<string, unknown>
}

/** 读 project.json 并检查表头；不存在 ⇒ null。 */
export async function readProjectJson(store: ProjectStore, app: StudioAppId, maxVersion: number): Promise<(ProjectHeader & Record<string, unknown>) | null> {
  const j = await store.readJSON()
  if (j === null) return null
  return checkProjectHeader(j, app, maxVersion)
}

/** 写 project.json：表头（format、version）放最前面，body 里同名栏位会被表头盖掉。 */
export async function writeProjectJson(store: ProjectStore, app: StudioAppId, version: number, body: Record<string, unknown>): Promise<void> {
  const { format: _f, version: _v, ...rest } = body
  void _f; void _v
  await store.writeJSON({ format: formatTag(app), version, ...rest })
}

export type RenameResult = SafeWriteResult | { written: false; reason: 'no-project' | 'unchanged' }

/**
 * 顶栏改名写回 project.json 的 name（其余栏位原样）：旁路读（peek）现在那份、走安全写——
 * 外面在本会话上次读写之后改过 ⇒ 不写、回 changed-outside（Shell 提示再改一次）。
 * project.json 还不在／不是物件 ⇒ no-project；name 本来就是这个 ⇒ unchanged（都不写）。
 */
export async function writeProjectName(store: ProjectStore, name: string): Promise<RenameResult> {
  const j = await store.readJSON({ peek: true })
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { written: false, reason: 'no-project' }
  if ((j as Record<string, unknown>).name === name) return { written: false, reason: 'unchanged' }
  return store.writeJSONSafe({ ...(j as Record<string, unknown>), name })
}

/** 只取 name（清单显示用）：读不到／不合格 ⇒ undefined。 */
export function projectNameOf(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined
  const n = (json as Record<string, unknown>).name
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 120) : undefined
}
