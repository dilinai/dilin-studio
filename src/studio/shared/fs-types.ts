// File System Access／OPFS 里 TypeScript 内建 lib 还没收的那几个成员（Chrome／Edge 才有的 showDirectoryPicker、
// 授权查询、目录的非同步走访）。只当型别用；执行期一律先判断有没有。

export type PermissionMode = 'read' | 'readwrite'
export type PermissionStateLike = 'granted' | 'denied' | 'prompt'

export interface PermissionCapableHandle {
  queryPermission?(d?: { mode?: PermissionMode }): Promise<PermissionStateLike>
  requestPermission?(d?: { mode?: PermissionMode }): Promise<PermissionStateLike>
}

export type DirHandle = FileSystemDirectoryHandle & PermissionCapableHandle

/** 目录的非同步走访（lib.dom.asynciterable 才有，这里自己声明）。 */
export function dirValues(dir: FileSystemDirectoryHandle): AsyncIterable<FileSystemHandle> {
  return (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()
}

type PickerWindow = { showDirectoryPicker?: (o?: { mode?: PermissionMode; id?: string; startIn?: string }) => Promise<DirHandle> }

/** 这个浏览器能不能挑本机资料夹（Chrome／Edge 桌面版 ＝ 能；Safari／Firefox ＝ 不能）。 */
export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function'
}

/** 有没有 OPFS。 */
export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function'
}

/** 叫出挑资料夹视窗（要在使用者点击里叫）。使用者取消 ⇒ null。 */
export async function pickFolder(): Promise<DirHandle | null> {
  const w = window as unknown as PickerWindow
  if (!w.showDirectoryPicker) return null
  try {
    return await w.showDirectoryPicker({ mode: 'readwrite', id: 'dilin-studio' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/** 查（必要时请求）读写授权。request=true 要在使用者点击里叫。 */
export async function ensureFolderPermission(h: DirHandle, request: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' as const }
  if (!h.queryPermission) return true   // 没有这套 API 的浏览器（OPFS 句柄）＝不用授权
  if ((await h.queryPermission(opts)) === 'granted') return true
  if (!request || !h.requestPermission) return false
  return (await h.requestPermission(opts)) === 'granted'
}
