// 网页剪辑页·本机素材自动背景上传云盘＋「設定」：
// 汇入后马上能剪，并默认背景上传（素材右上角转圈·点开看进度、可取消；取消会提醒别台设备打开会找不到）；工程档云盘、本机两个路径都记，有一个就能剪；
// 「設定」里指定草稿位置、要不要自动上传（云盘满了自动关）、上传与汇出的位置。
// 本档只放纯函数（题直接跑）：设定的形状与读回、要不要自动传、云盘满了的判读、资料夹清单（挑位置用）与路径字。
// 真上传（带进度、可取消）在 store 的 startDriveUpload；画在剪辑页与设定小窗（ui/SettingsDialog.tsx）。

export type VeditSettings = {
  /** 本机素材汇入后自动在背景传一份进云盘（缺省开·云盘满了自动关） */
  autoUpload: boolean
  /** 自动上传存到云盘哪个资料夹（null＝根目录） */
  uploadFolderId: string | null
  /** 草稿（剪辑工程档）存哪（null＝根目录·工程档上线后照这里建） */
  draftFolderId: string | null
  /** 作品汇出存哪（null＝根目录·汇出上线后照这里存） */
  exportFolderId: string | null
}

export const VEDIT_SETTINGS_KEY = 'dilin.videoEdit.settings.v1'
export const SETTINGS_DEFAULT: VeditSettings = { autoUpload: true, uploadFolderId: null, draftFolderId: null, exportFolderId: null }

const ID_RE = /^[A-Za-z0-9-]{8,64}$/
const folderOrNull = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null)

/** 读回设定（坏的、缺的格子用缺省·⛔ 抛） */
export function parseSettings(raw: string | null): VeditSettings {
  if (!raw) return { ...SETTINGS_DEFAULT }
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { ...SETTINGS_DEFAULT } }
  if (!v || typeof v !== 'object') return { ...SETTINGS_DEFAULT }
  const o = v as Record<string, unknown>
  return {
    autoUpload: typeof o.autoUpload === 'boolean' ? o.autoUpload : SETTINGS_DEFAULT.autoUpload,
    uploadFolderId: folderOrNull(o.uploadFolderId),
    draftFolderId: folderOrNull(o.draftFolderId),
    exportFolderId: folderOrNull(o.exportFolderId),
  }
}

/** 这一份要不要自动背景上传：本机素材·还没传过·没在传·设定开着 */
export function shouldAutoUpload(m: { from: 'local' | 'drive'; driveId?: string; up?: unknown }, s: VeditSettings): boolean {
  return s.autoUpload && m.from === 'local' && !m.driveId && !m.up
}

/** 上传失败是不是「云盘满了」（一般上传口 413 err_common_storage_quota_exceeded；分片口 quota_exceeded 且 storage_full） */
export function isDriveFull(e: { status?: number; code?: string; reason?: string }): boolean {
  if (e.code === 'err_common_storage_quota_exceeded') return true
  return e.code === 'quota_exceeded' && e.reason !== 'active_sessions'
}

/** 上传失败是不是「别的上传还占着在途容量」（分片口 create 回 quota_exceeded＋active_sessions）：暂时忙·等一下再传，⛔ 当满、⛔ 关自动上传 */
export function isDriveBusy(e: { code?: string; reason?: string }): boolean {
  return e.code === 'quota_exceeded' && e.reason === 'active_sessions'
}

/** 上传进度 0～1（总量 0 ⇒ 0） */
export function uploadFrac(done: number, total: number): number {
  if (!(total > 0) || !(done > 0)) return 0
  return Math.min(1, done / total)
}

export type FolderLike = { id: string; name: string; parent_id: string | null }

/** 挑位置用的扁平清单（照树的先序·带层深）；坏的父指向（断链／绕圈）当根下 */
export function folderOptions(folders: readonly FolderLike[]): Array<{ id: string; name: string; depth: number }> {
  const ids = new Set(folders.map((f) => f.id))
  const kids = new Map<string | null, FolderLike[]>()
  for (const f of folders) {
    const p = f.parent_id && ids.has(f.parent_id) && f.parent_id !== f.id ? f.parent_id : null
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p)!.push(f)
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  const out: Array<{ id: string; name: string; depth: number }> = []
  const seen = new Set<string>()
  const walk = (p: string | null, depth: number) => {
    for (const f of kids.get(p) ?? []) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push({ id: f.id, name: f.name, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  // 绕圈的那几只（谁都不是根下）补在最后
  for (const f of folders) if (!seen.has(f.id)) { seen.add(f.id); out.push({ id: f.id, name: f.name, depth: 0 }) }
  return out
}

/** 设定里显示的路径字：「根目录 / 剪辑 / 素材」；夹不在了（被删）⇒ null（页面写「找不到这个资料夹」） */
export function folderPath(folders: readonly FolderLike[], id: string | null, rootLabel: string): string | null {
  if (id === null) return rootLabel
  const by = new Map(folders.map((f) => [f.id, f]))
  const names: string[] = []
  let cur = by.get(id)
  if (!cur) return null
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    names.unshift(cur.name)
    cur = cur.parent_id ? by.get(cur.parent_id) : undefined
  }
  return [rootLabel, ...names].join(' / ')
}
