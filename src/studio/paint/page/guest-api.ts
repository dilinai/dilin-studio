// 游客版画板的工程档读写（PaintProjectApi）：同一份画板整页的存档／开档／导出，改走本机工程——
//   工程＝shared/store.ts 的 ProjectStore（这台浏览器的 OPFS 或使用者挑的资料夹）·格式照 format.ts（project.json「dilin-studio/paint」v1＋assets/）。
//   get：读 project.json＋assets/ ⇒ 引擎 JSON（多页档整份带回·每页的图都从 assets/ 换回来）；没有 project.json ⇒ 空白画板。
//        每次读都照引擎的读法检查一遍，写 project.check.json 到工程夹（check.pure.ts：哪些画不出来、哪些栏位没读）。
//   put：先比对「外面有没有改过」（你的 AI 直接改了 project.json）——改过且不是照那一版盖（base 对不上）⇒ 回 409，
//        页面出「套用最新版／保留我的」（同登入版别处存过新版那条）；否则存进去（图写进 assets/、project.json 只写路径）。
//   updated_at＝project.json 的修改时间（ISO）：页面拿它当「这一版」的记号。
//   upload：导出的 PNG、另存的副本 ⇒ 浏览器下载（没有云盘可存）。create 不给：游客版一个页面就是一个工程。
import type { ProjectStore } from '../../shared/types'
import { isStudioError } from '../../shared/types'
import { readProjectJson } from '../../shared/project-file'
import { downloadBlob } from '../../shared/zip'
import { savePaint } from '../format'
import { ASSETS_DIR, PAINT_VERSION, bodyToEngine, checkProject, emptyProject, fromFolder } from '../project-folder.pure'
import { CHECK_FILE, checkProjectFile, reportText, type CheckReport } from '../check.pure'
import type { ApiErr, ProjGet } from './drawboard-host'
import type { PaintProjectApi } from './host'

export type GuestApiOpts = {
  store: ProjectStore
  projectId: string
  /** 工程没名字时的标题 */
  untitled: () => string
  /** 工程清单里这份的名字（project.json 没写 name 时用它） */
  listedName?: () => Promise<string | undefined>
  /** 读档时缺了哪些素材（那几层先空着） */
  onMissing?: (files: string[]) => void
  /** 每次读档后的检查结果（错几处、哪几处）·页面可拿来提示 */
  onCheck?: (r: CheckReport) => void
  /** 读进一版或存好一版之后（页面拿来在画好后写回预览图与图层外框） */
  onSettled?: (why: 'load' | 'save') => void
  /** 现在时间（测试换掉） */
  now?: () => Date
  /** 下载（测试换掉） */
  download?: (blob: Blob, name: string) => void
}

const iso = (ms: number | null): string => (ms === null ? '' : new Date(ms).toISOString())
const fail = (status: number, code: string, error?: string): { ok: false; err: ApiErr } => ({ ok: false, err: { status, code, error, updated_at: null } })
const errOf = (e: unknown): { ok: false; err: ApiErr } => (isStudioError(e) ? fail(0, e.code, e.detail ?? e.message) : fail(0, 'error', e instanceof Error ? e.message : String(e)))
const blobBytes = async (b: Blob | null): Promise<Uint8Array | null> => (b ? new Uint8Array(await b.arrayBuffer()) : null)

export function createGuestApi(o: GuestApiOpts): PaintProjectApi & { readonly name: string | undefined } {
  const { store } = o
  // project.json 里的工程名（引擎不留它）·每次存档写回去
  let name: string | undefined
  return {
    get name() { return name },
    async get(id) {
      if (id !== o.projectId) return fail(404, 'not_found')
      try {
        const json = await readProjectJson(store, 'paint', PAINT_VERSION)
        const at = iso(await store.lastModified())
        const listed = await o.listedName?.().catch(() => undefined)
        if (json === null) {
          name = undefined
          return { ok: true, data: { id, title: listed || store.label || o.untitled(), folder_id: null, updated_at: at, project: emptyProject() as unknown as ProjGet['project'] } }
        }
        // 照引擎的读法检查一遍、写成 project.check.json 放工程夹（AI 改完读回来看哪里没生效）·写不了（存放不支援）就算了
        const have = new Set((await store.listAssets()).map((a) => a.name))
        const report = checkProjectFile(json, have, (o.now ?? (() => new Date()))())
        o.onCheck?.(report)
        if (store.writeExtra) await store.writeExtra(CHECK_FILE, reportText(report)).catch(() => {})
        const c = checkProject(json)
        if (!c.ok) return fail(422, 'bad_format', c.error)
        const { name: n, ...body } = json as Record<string, unknown>
        name = typeof n === 'string' ? n : undefined
        const { project, missing } = await fromFolder(body, async (p) => blobBytes(await store.readAsset(p.slice(ASSETS_DIR.length + 1))))
        if (missing.length) o.onMissing?.(missing)
        const title = (name && name.trim()) || listed || store.label || o.untitled()
        o.onSettled?.('load')
        return { ok: true, data: { id, title, folder_id: null, updated_at: at, project: bodyToEngine(project as Record<string, unknown>) as unknown as ProjGet['project'] } }
      } catch (e) { return errOf(e) }
    },
    async put(id, base, project) {
      if (id !== o.projectId) return fail(404, 'not_found')
      try {
        const at = iso(await store.lastModified())
        // 外面改过、又不是照外面那一版盖（「保留我的」会带那一版的时戳）⇒ 不写
        if (at && base !== at && await store.changedOutside()) return { ok: false, err: { status: 409, code: 'drawboard_conflict', updated_at: at } }
        const r = await savePaint(store, project as Record<string, unknown>, undefined, name !== undefined ? { name } : undefined)
        o.onSettled?.('save')
        return { ok: true, updated_at: iso(await store.lastModified()), bytes: JSON.stringify(r.json).length }
      } catch (e) { return errOf(e) }
    },
    async upload(blob, fileName) {
      try {
        ;(o.download ?? downloadBlob)(blob, fileName)
        return { ok: true, id: '', name: fileName }
      } catch (e) { return errOf(e) }
    },
  }
}
