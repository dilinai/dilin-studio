// 游客版表格的资料层：整页（SheetPage）要的那几支资料操作，改成读写工程的 project.json（ProjectStore·格式见 ../FORMAT.md）。
//   回包照网站 API 的形状（ok／status／code＋内容），页面那套判断原样走：
//     新增／改名／删页签的规则用 engine/sheet-list 同一份（预设名、最后一张不能删、空名不收）；
//     每张页签有自己的版次（updated_at）：存档带的底版次跟现在的不同 ⇒ 409 零写（同网站）；
//     标题带 baseTitle 而现在的标题不同 ⇒ 409。
//   写档：每个动作排成一列（前一发写完才算下一发·各自从「当下那一份」改起，几张页签同时存也不会互相盖掉）；
//     走 saveProjectSafe——外面（例如用户自己的 AI）改过 project.json ⇒ 不写、回失败，外框会看到外部改档、问使用者；
//     外框要求「立刻存」时（withForce）才盖过去。写失败 ⇒ 记忆体里的那一份不动。
//   ⛔ 本档不 import React。

import type { ProjectStore, SaveState } from '../../shared/types'
import { saveProjectSafe } from '../../shared/store'
import { sheetKey, type SheetContent } from '../engine/formula'
import { renameSheetInContent } from '../engine/formula-refs'
import { addSheet as addTab, removeSheet, renameSheet as renameTab, sortSheets, type SheetTab } from '../engine/sheet-list'
import { sheetsFormat, newSheetId, SHEETS_MAX, type SheetsDoc } from '../format'
import type { SheetDocRec, SheetHostResult, SheetRow, SheetRewritten } from './host'

export type GuestSheetsDataOpts = {
  store: ProjectStore
  /** project.json 里没有 name 时标题栏显示什么（工程清单上的名字） */
  fallbackName?: () => string
  /** 存档状态（给外框） */
  onSaveState?: (state: SaveState, detail?: string) => void
  /** 标题改好了（外框拿去同步工程清单上的名字） */
  onTitleSaved?: (name: string) => void
  /** 测试用：版次时间 */
  now?: () => number
}

export type GuestSheetsData = ReturnType<typeof createGuestSheetsData>

const NAME_MAX = 120
type Fail = { ok: false; status: number; code?: string }
const fail = (status: number, code?: string): Fail => ({ ok: false, status, code })

export function createGuestSheetsData(o: GuestSheetsDataOpts) {
  let doc: SheetsDoc | null = null
  let stamps: Record<string, string> = {}
  let lastStamp = 0
  let chain: Promise<unknown> = Promise.resolve()
  let force = 0
  const now = o.now ?? (() => Date.now())
  /** 新版次：时间戳（ISO）·同一毫秒连发也严格递增 */
  const stamp = () => { lastStamp = Math.max(now(), lastStamp + 1); return new Date(lastStamp).toISOString() }

  const tabsOf = (d: SheetsDoc): SheetTab[] => d.sheets.map((s, i) => ({ id: s.id, name: s.name, position: i }))
  const rowsOf = (d: SheetsDoc): SheetRow[] => d.sheets.map((s, i) => ({ id: s.id, name: s.name, position: i, content: s.content, updated_at: stamps[s.id] }))
  const recOf = (d: SheetsDoc): SheetDocRec => ({ title: d.name || (o.fallbackName?.() ?? '').trim(), readonly: false, editor_agent_key: null, sheets: rowsOf(d) })

  async function load(): Promise<SheetsDoc> {
    const d = await sheetsFormat.load(o.store)
    doc = d
    const s = stamp()
    stamps = Object.fromEntries(d.sheets.map(x => [x.id, s]))
    return d
  }
  /** 排进队伍跑（读也排队：读到的一定是前面写完之后的那一份） */
  function queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn)
    chain = run.catch(() => {})
    return run
  }
  const current = async (): Promise<SheetsDoc> => doc ?? load()

  /** 一个写动作：从当下那一份算出新的一份（或回失败）⇒ 写进 project.json ⇒ 成功才换上、再收尾。 */
  function mutate<T>(plan: (d: SheetsDoc) => Fail | { next: SheetsDoc; done: (next: SheetsDoc) => T }): Promise<SheetHostResult<T>> {
    return queued(async () => {
      let d: SheetsDoc
      try { d = await current() } catch { return fail(0) }
      const p = plan(d)
      if ('ok' in p) return p
      o.onSaveState?.('saving')
      try {
        const r = await saveProjectSafe(o.store, s => sheetsFormat.save(s, p.next), { force: force > 0 })
        if (!r.written) { o.onSaveState?.('dirty'); return fail(0, 'err_changed_outside') }
      } catch (e) {
        o.onSaveState?.('error', e instanceof Error ? e.message : String(e))
        return fail(0)
      }
      doc = p.next
      o.onSaveState?.('saved')
      return { ok: true as const, status: 200, data: p.done(p.next) }
    })
  }

  return {
    getDoc(opts?: { fresh?: boolean }): Promise<SheetDocRec | null> {
      return queued(async () => recOf(opts?.fresh ? await load() : await current())).catch(() => null)
    },

    listSheets(): Promise<SheetRow[] | null> {
      return queued(async () => rowsOf(await current())).catch(() => null)
    },

    putTitle(title: string, baseTitle?: string): Promise<SheetHostResult<{ title?: string } | null>> {
      const name = title.trim().slice(0, NAME_MAX)
      return mutate(d => {
        if (baseTitle !== undefined && baseTitle !== d.name) return fail(409, 'err_title_stale')
        return { next: { ...d, name }, done: () => { o.onTitleSaved?.(name); return { title: name } } }
      })
    },

    addSheet(b: { name?: string; prefix: string; content?: SheetContent }): Promise<SheetHostResult<{ sheet: SheetTab & { updated_at?: string }; sheets: SheetRow[] }>> {
      return mutate(d => {
        if (d.sheets.length >= SHEETS_MAX) return fail(400, 'err_sheet_too_many')
        const id = newSheetId()
        const { added } = addTab(tabsOf(d), id, b.name, b.prefix || undefined)
        const next: SheetsDoc = { ...d, sheets: [...d.sheets, { id, name: added.name, content: b.content ?? { cells: {} } }] }
        return { next, done: n => { stamps[id] = stamp(); return { sheet: { ...added, position: n.sheets.length - 1, updated_at: stamps[id] }, sheets: rowsOf(n) } } }
      })
    },

    renameSheet(id: string, name: string): Promise<SheetHostResult<{ sheets: SheetTab[]; updated_at?: string | null; rewritten?: SheetRewritten[] }>> {
      return mutate(d => {
        const r = renameTab(tabsOf(d), id, name)
        if (!r.ok) return r.reason === 'not_found' ? fail(404) : fail(400, 'err_sheet_empty_name')
        const nm = r.list.find(s => s.id === id)!.name
        // 跨表引用跟着改名（同网站 sheets PUT：引用真指到这张才换·同名几张时只有排最前那张是被引用的）
        const old = d.sheets.find(s => s.id === id)!.name
        const holder = d.sheets.find(s => sheetKey(s.name) === sheetKey(old))
        const follow = old !== nm && holder?.id === id
        const changed = new Set<string>()
        const sheets = d.sheets.map(s => {
          const c = follow ? renameSheetInContent(s.content, old, nm) : null
          if (c) changed.add(s.id)
          return s.id === id ? { ...s, name: nm, ...(c ? { content: c } : {}) } : c ? { ...s, content: c } : s
        })
        const next: SheetsDoc = { ...d, sheets }
        return { next, done: n => {
          stamps[id] = stamp()
          for (const sid of changed) if (sid !== id) stamps[sid] = stamp()
          return { sheets: tabsOf(n), updated_at: stamps[id], rewritten: [...changed].map(sid => ({ id: sid, updated_at: stamps[sid] })) }
        } }
      })
    },

    deleteSheet(id: string): Promise<SheetHostResult<{ sheets: SheetTab[] }>> {
      return mutate(d => {
        const r = removeSheet(tabsOf(d), id)
        if (!r.ok) return r.reason === 'last_sheet' ? fail(400, 'err_sheet_last') : fail(404)
        const next: SheetsDoc = { ...d, sheets: d.sheets.filter(s => s.id !== id) }
        return { next, done: n => { delete stamps[id]; return { sheets: sortSheets(tabsOf(n)) } } }
      })
    },

    saveSheet(id: string, content: SheetContent, baseUpdatedAt?: string): Promise<SheetHostResult<{ updated_at?: string | null } | null>> {
      return mutate(d => {
        if (!d.sheets.some(s => s.id === id)) return fail(404)
        if (baseUpdatedAt && stamps[id] && baseUpdatedAt !== stamps[id]) return fail(409, 'err_sheet_stale')
        const next: SheetsDoc = { ...d, sheets: d.sheets.map(s => (s.id === id ? { ...s, content } : s)) }
        return { next, done: () => { stamps[id] = stamp(); return { updated_at: stamps[id] } } }
      })
    },

    /** 外框要求「立刻存」：这段期间的写档不比对外面改过没有、照写。 */
    async withForce<T>(fn: () => Promise<T>): Promise<T> {
      force++
      try { return await fn() } finally { force-- }
    },

    /** 目前记忆体里的那一份（测试用） */
    current(): SheetsDoc | null { return doc },
  }
}
