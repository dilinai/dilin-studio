'use client'
// 表格编辑器整页（登入版 /ai-sheet/<id> 与游客版 /studio/sheets/<工程> 共用这一份）。
//   顶栏（品牌｜雲端硬碟｜标题｜存档状态·xlsx·匯出 csv·匯入 xlsx／csv）／左栏两页签（表格清单｜硬碟）＋拖宽＋收起窄栏／中栏工具栏＋网格／右栏对话＋拖宽＋收起窄条。
//   跟网站有关的一律经宿主（./host.ts）：资料存取、登入、云盘区块（renderDriveSlot）、对话格（renderChatSlot）、AI 编辑保护遮罩、即时跟进。
//   三栏配色：顶栏＋左栏 editorShell.beigeSurface·右栏 chatSurface·中栏白。
//   撤销／重做栈放在本页（整本工作簿一栈·切页签也撤得回·Excel 口径）；网格每次改动带 label 交进来（engine/history·深度 100·新改动丢 redo 分支）；
//     撤／重做走同一条防抖存档路；重载后栈清空。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStudioT, useStudioLang } from '../../shared/StudioT'
import { registerDesktopBeforeClose } from '../../shared/desktop-before-close'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { PanelCollapseButton, PanelCollapsedEdge } from '../../shared/ported/PanelCollapseHandle'  // 左右栏收合钮贴在栏自己身上·不放工具栏
import { confirmDialog, alertDialog } from '../../shared/dialog-store'
import { sortSheets, type SheetTab } from '../engine/sheet-list'
import { applySheetDrafts, mergeSheetDraft, sheetDraftChanges } from '../engine/draft-merge'
import { orphanContent, restoreAdd, restoreFinishApply, restoreFinishOrphan, type SheetRestoreState, type RestoreEntry } from '../engine/restore-state'   // 「套回」条状态：每份稿带 id·异步收尾只摘自己那几份   // AI 编辑保护遮罩：没存进库的稿按「我改了哪些格」并到新版上
import { sheetKey, type SheetContent, type BookSheet } from '../engine/formula'
import { renameSheetInContent } from '../engine/formula-refs'   // 页签改名 ⇒ 公式里的跨表引用跟着换
import { xrefBegin, xrefStep, type XrefAction, type XrefEdit, type XrefResume } from '../engine/formula-edit'   // 编公式时点别的分页 ⇒ 带去那张点格插 表名!A1
import { sheetLiveDiff, sheetLiveFollowTarget } from '../engine/sheet-live'   // 别人每写一格就跟着出现
import type { AgentContent } from '../engine/agent-ops'
import { ZOOM_DEFAULT, clampZoom, formatZoom, readStoredZoom, writeStoredZoom } from '../engine/zoom'
import { SHEET_CELLS_REF_EVENT, buildCellsToken, isSheetAltA, type SheetCellsRefDetail } from '../engine/sheet-chat-ref.pure'
import { emptyHistory, pushHistory, undoSteps, redoSteps, recentSteps, dropSheet, mapHistory, type HistoryState, type HistoryLabel, type HistoryApply } from '../engine/history'
import SheetTabList from '../ui/SheetTabList'
import SheetGrid, { type SheetGridHandle, type ChangeMeta } from '../ui/SheetGrid'
import SheetToolbar, { EMPTY_SELECTION_STATE, type SelectionState, type HistoryView } from '../ui/SheetToolbar'
import { SHEET_DRIVE_TREE_MIN, sheetLeftClamp } from './sheet-left-width.pure' // 两页签同一个栏宽、一起缩·硬碟树自留最窄宽
import SheetLeftRail from './SheetLeftRail'   // 左栏收起时表格清单仍可点（窄栏图标）
import { SHEET_FEATURES, type SheetDocRec, type SheetRow, type SheetsPageHost } from './host'
import { SHEET_IMPORT_ACCEPT, SHEET_IMPORT_FAIL_KEY, buildSheetCsv, runSheetImport, sheetIoButtons } from './sheet-io'   // 顶栏「匯出 csv」「匯入 xlsx／csv」
import SheetPrintDialog, { PrinterIcon } from '../ui/SheetPrintDialog'   // 顶栏「列印」：Excel 版面设定同款对话框＋预览＋浏览器列印
import type { SheetPrint } from '../engine/print'

const LEFT_DEFAULT = 208, LEFT_MAX = 420   // 同云文档页 LEFT_PANEL_*·下限两页签同一个（sheet-left-width.pure）
const RIGHT_DEFAULT = 300, RIGHT_MIN = 260, RIGHT_MAX = 560
const SAVE_DEBOUNCE_MS = 800
const LEFT_COLLAPSED_KEY = 'aisheet:leftCollapsed'   // 左栏收起态·浏览器 localStorage 单键（全站一个·不分档·'1'＝收起）

export type SheetPageProps = { host: SheetsPageHost }

export default function SheetPage({ host }: SheetPageProps) {
  const docId = host.docId
  const t = useStudioT()
  const language = useStudioLang()
  const { shieldWriteAllowed } = host

  // ── 登录／档 ──
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [authSlow, setAuthSlow] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [title, setTitle] = useState('')
  const [readonly, setReadonly] = useState(false)
  const [sheets, setSheets] = useState<SheetRow[]>([])
  const sheetsRef = useRef(sheets)
  sheetsRef.current = sheets
  const [currentSheetId, setCurrentSheetId] = useState<string | null>(null)
  const currentSheetIdRef = useRef(currentSheetId)   // 实时拉新版那拍读（effect 不随切页重订）
  currentSheetIdRef.current = currentSheetId
  const [contents, setContents] = useState<Record<string, SheetContent>>({})
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [editorAgentKey, setEditorAgentKey] = useState<string | null>(null)
  const titleRef = useRef('')
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const contentsRef = useRef<Record<string, SheetContent>>({})   // 最新内容（撤销栈取 before 用·同一拍连发两次也读得到上一次）
  const [history, setHistory] = useState<HistoryState<SheetContent>>(() => emptyHistory<SheetContent>())
  const historyRef = useRef(history)
  // AI 编辑保护遮罩：罩期挡一切写（左栏表格清单增删改名在中栏 inert 块外·撤销／重做也走 persist）·钩子在下方·这里先立 ref 给各写函数读
  const aiLockedRef = useRef(false)
  // 版次与草稿：serverStampRef＝每张页签库里那一版的 updated_at（人工保存带着当 base_updated_at·撞版 409 零写）；
  //   serverBaseRef＝最后一次确认在库的内容（草稿「改了哪些格」的比对底）；restore＝没存进库、等用户点「套回」的稿：
  //   存「底＋稿」（改动集）不存并好的整张——点「套回」那刻才对库里**当时的最新版**重新合并·写回带的版次就是合并用的那一版；
  //   页签已被删的稿＝孤立稿（orphans·同页签所有份并在一起）·给「另存成新表格」；标题稿记着出条那刻库里的标题（seen）·之后被改过就不盖。
  //   🔴 每份稿带 id（draftSeqRef）·套回／另存的异步收尾只按 id 摘自己那几份（engine/restore-state）——⛔ 拿发起时的快照整份 set 回去
  const serverStampRef = useRef<Record<string, string | undefined>>({})
  const serverBaseRef = useRef<Record<string, SheetContent>>({})
  const titleDraftRef = useRef<string | null>(null)
  const [restore, setRestore] = useState<SheetRestoreState<SheetContent> | null>(null)
  const draftSeqRef = useRef(0)
  const restoreBusyRef = useRef(false)
  const reloadSeqRef = useRef(0)
  const reloadDocRef = useRef<() => Promise<void>>(async () => {})
  const flushSavesRef = useRef<() => Promise<boolean>>(async () => true)
  // 罩落那一刻的补存窗：格子编辑框失焦提交（persist 放行）＋防抖里没存的＋标题框里没失焦的字 ⇒ 当场存进库（排在 AI 动笔之前）·存败弹提示
  const titleNowRef = useRef('')
  titleNowRef.current = title
  const shieldFlush = host.useShieldFlush({
    run: async () => {
      const ok = await flushSaves()   // 带版次（base_updated_at）·AI 若已先写 ⇒ 409 零写·稿留在 unsavedRef（掀罩时并到新版·给「套回」）
      const nm = titleNowRef.current.trim()
      if (!nm || nm === titleRef.current) return ok
      let tok = false
      try {
        // 标题版次（base_title）：AI 若已改名 ⇒ 409 零写
        const res = await host.putTitle(nm, titleRef.current)
        if (res.ok) { const j = res.data; titleRef.current = j?.title || nm; setTitle(titleRef.current) }
        tok = res.ok
      } catch { tok = false }
      if (!tok) titleDraftRef.current = nm   // 掀罩重载后进「套回」条
      return ok && tok
    },
    onFail: () => { void alertDialog(t('ai_shield_flush_failed')) },
  })

  useEffect(() => {
    if (authed !== null) { setAuthSlow(false); return }
    const timer = setTimeout(() => setAuthSlow(true), 6000)
    return () => clearTimeout(timer)
  }, [authed])

  // 首载只看换了哪份（docId）：宿主经 ref 叫现在那份——宿主或语言换一份不算换档，重读会把手上没存的格子盖回读到的那版
  const loadHostRef = useRef(host)
  loadHostRef.current = host
  useEffect(() => {
    if (!docId) return
    const host = loadHostRef.current
    let alive = true
    ;(async () => {
      const auth = await host.checkAuth()
      if (!alive) return
      if (auth !== 'ok') { setAuthed(false); return }
      setAuthed(true)
      const rec = await host.getDoc()
      if (!alive) return
      if (!rec) { setNotFound(true); return }
      applyDocRef.current(rec, true)
    })()
    return () => { alive = false }
  }, [docId])
  // 档回包进状态（首载与「AI 改完拉新版」共用一份·别各写一遍漂移）；first＝首载才把当前 sheet 切到第一张·重拉时留在原张（还在的话）
  const applyDocRef = useRef<(rec: SheetDocRec, first: boolean) => void>(() => {})
  applyDocRef.current = (rec, first) => {
    setTitle(rec.title || t('sheet_untitled')); titleRef.current = rec.title || ''
    setReadonly(!!rec.readonly)
    setEditorAgentKey(typeof rec.editor_agent_key === 'string' && rec.editor_agent_key ? rec.editor_agent_key : null)
    const list = sortSheets(rec.sheets ?? []) as SheetRow[]
    setSheets(list)
    const c: Record<string, SheetContent> = {}
    for (const s of rec.sheets ?? []) c[s.id] = (s.content && typeof s.content === 'object' ? s.content : { cells: {} }) as SheetContent
    for (const s of rec.sheets ?? []) { serverStampRef.current[s.id] = s.updated_at; serverBaseRef.current[s.id] = c[s.id] }
    contentsRef.current = c
    setContents(c)
    setCurrentSheetId(prev => (!first && prev && list.some(s => s.id === prev)) ? prev : (list[0]?.id ?? null))
  }

  // ── 标题（失焦即存·同网站页） ──
  const saveTitle = useCallback(async () => {
    if (readonly || aiLockedRef.current) return
    const nm = title.trim()
    if (!nm || nm === titleRef.current) { if (!nm) setTitle(titleRef.current); return }
    const res = await host.putTitle(nm)
    if (res.ok) { const j = res.data; const saved = j?.title || nm; titleRef.current = saved; setTitle(saved) }
    else setTitle(titleRef.current)
  }, [host, readonly, title])

  // ── sheet 清单动作（规则在 engine/sheet-list.ts·宿主存取那边同一份） ──
  const addSheet = useCallback(async () => {
    if (readonly || aiLockedRef.current) return
    const res = await host.addSheet({ prefix: t('drive_sheet_default_tab') })
    if (!res.ok) { await alertDialog(t('drive_share_retry')); return }
    const j = res.data
    serverStampRef.current[j.sheet.id] = j.sheet.updated_at; serverBaseRef.current[j.sheet.id] = { cells: {} }   // 新页签的版次（之后存内容带着）
    setSheets(sortSheets(j.sheets) as SheetRow[])
    contentsRef.current = { ...contentsRef.current, [j.sheet.id]: { cells: {} } }
    setContents(prev => ({ ...prev, [j.sheet.id]: { cells: {} } }))
    setCurrentSheetId(j.sheet.id)
  }, [host, readonly, t])

  const renameSheet = useCallback(async (id: string, name: string): Promise<boolean> => {
    if (readonly || aiLockedRef.current) return false
    // 改页签名也会换这张页签的版次（updated_at）⇒ 先把没存的内容按旧版次存掉·改完名记下新版次（否则下一发存内容撞版＝假冲突）
    await flushSavesRef.current()
    if (aiLockedRef.current) return false
    const res = await host.renameSheet(id, name)
    if (!res.ok) {
      await alertDialog(res.code === 'err_ai_editing' ? t('ai_shield_blocked') : t('drive_share_retry')); return false
    }
    const j = res.data
    if (j.updated_at) serverStampRef.current[id] = j.updated_at
    // 跨表引用跟着改名：宿主已把库里各张公式里的旧名换掉（rewritten＝换过的页签与新版次）⇒ 本页的画面／底版／没存的稿／撤销栈照同一条规则换
    const oldName = sheetsRef.current.find(s => s.id === id)?.name
    const newName = j.sheets.find(s => s.id === id)?.name
    const holder = oldName === undefined ? undefined : sheetsRef.current.find(s => sheetKey(s.name) === sheetKey(oldName))   // 同名几张 ⇒ 引用指的是排最前那张·改的不是它就不换
    if (oldName !== undefined && newName !== undefined && oldName !== newName && holder?.id === id) {
      const ren = (c: SheetContent) => renameSheetInContent(c, oldName, newName)
      for (const r of j.rewritten ?? []) {
        if (r.updated_at) { serverStampRef.current[r.id] = r.updated_at; ownStampsRef.current.add(r.updated_at) }
        const b = serverBaseRef.current[r.id]; if (b) serverBaseRef.current[r.id] = ren(b) ?? b
      }
      for (const [sid, d] of Object.entries(unsavedRef.current)) { const n = ren(d); if (n) unsavedRef.current[sid] = n }
      let changed = false
      const next = { ...contentsRef.current }
      for (const [sid, c] of Object.entries(next)) { const n = ren(c); if (n) { next[sid] = n; changed = true } }
      if (changed) { contentsRef.current = next; setContents(next) }
      historyRef.current = mapHistory(historyRef.current, ren); setHistory(historyRef.current)
    }
    setSheets(prev => sortSheets(j.sheets.map(s => ({ ...s, content: prev.find(p => p.id === s.id)?.content }))) as SheetRow[])
    return true
  }, [host, readonly, t])

  const deleteSheet = useCallback(async (id: string) => {
    if (readonly || aiLockedRef.current) return
    if (sheets.length <= 1) { await alertDialog(t('sheet_delete_last')); return }
    const ok = await confirmDialog(t('sheet_delete_confirm'))
    if (!ok) return
    if (aiLockedRef.current) { await alertDialog(t('ai_shield_blocked')); return }   // 确认框开着时罩落了 ⇒ 不删（存取那边同样挡）
    const res = await host.deleteSheet(id)
    if (!res.ok) {
      await alertDialog(res.code === 'err_sheet_last' ? t('sheet_delete_last') : res.code === 'err_ai_editing' ? t('ai_shield_blocked') : t('drive_share_retry'))
      return
    }
    const j = res.data
    const next = sortSheets(j.sheets) as SheetRow[]
    setSheets(next)
    setContents(prev => { const n = { ...prev }; delete n[id]; return n })
    { const n = { ...contentsRef.current }; delete n[id]; contentsRef.current = n }
    if (saveTimers.current[id]) { clearTimeout(saveTimers.current[id]); delete saveTimers.current[id] }
    delete unsavedRef.current[id]   // 删掉的那张不再有「没存的内容」（否则「xlsx」钮会一直判存不上）
    syncUnsaved()
    historyRef.current = dropSheet(historyRef.current, id); setHistory(historyRef.current)   // 删掉的 sheet 撤不回去·它的步一并拿掉
    if (currentSheetId === id) {
      // Excel 口径：删掉当前这张 ⇒ 切右邻·没右邻取左邻
      const before = sheets.findIndex(s => s.id === id)
      setCurrentSheetId(next[Math.min(before, next.length - 1)]?.id ?? next[0]?.id ?? null)
    }
  }, [currentSheetId, host, readonly, sheets, t])

  // ── 内容：改动即本地更新·防抖存库（每张 sheet 各自一支计时器）·撤销／重做也走这一条 ──
  //   unsavedRef＝还没确认存进库的最新内容（存成功且没被更新的改动盖过才销）·inflightRef＝在途的存档请求；
  //   顶栏「xlsx」钮下载前经 flushSaves 把两者清空（等存完再下·存失败不下旧的）。
  const unsavedRef = useRef<Record<string, SheetContent>>({})
  const inflightRef = useRef<Record<string, Promise<boolean>>>({})
  const ownStampsRef = useRef(new Set<string>())   // 逐格即时：本页写回成功收到的戳（轮询见到它＝自己写的·不当别人改）
  /** 有没有没存的改动 ⇒ 告诉宿主（游客版外框拿来提示离开前未存） */
  const syncUnsaved = useCallback(() => { host.onUnsavedChange?.(Object.keys(unsavedRef.current).length > 0) }, [host])
  const saveNow = useCallback((sheetId: string): Promise<boolean> => {
    // 同一张页签的存档排成一列（前一发回来才发下一发·版次才接得上）；每发带 base_updated_at＝库里那一版·撞版 ⇒ 409 零写（⛔ 整张旧稿盖掉别人刚写的格）
    const prev = inflightRef.current[sheetId]
    const p = (async () => {
      if (prev) { try { await prev } catch { /* 前一发的成败各自回报 */ } }
      try {
        // 真要送的那一刻才取「最新待存稿＋它的底版戳」成对送——轮询合进别人新写的格后，待存稿已换成合并稿、戳换成新版；
        //   ⛔ 用改格那刻捕捉的旧整张配新戳（新戳过得了版次条件·旧整张会把刚合进来的格盖掉）。稿已不在（存过／被重载收进「套回」条）⇒ 不送
        const next = unsavedRef.current[sheetId]
        if (!next) return true
        const base = serverStampRef.current[sheetId]
        const res = await host.saveSheet(sheetId, next, base)
        if (res.ok) {
          const j = res.data
          if (j?.updated_at) { serverStampRef.current[sheetId] = j.updated_at; ownStampsRef.current.add(j.updated_at); if (ownStampsRef.current.size > 16) ownStampsRef.current.delete(ownStampsRef.current.values().next().value as string) }
          serverBaseRef.current[sheetId] = next
          if (unsavedRef.current[sheetId] === next) delete unsavedRef.current[sheetId]
          syncUnsaved()
          setSaveStatus('saved')
          return true
        }
        setSaveStatus('error')
        // 撞版（别人／AI 已写了新版）：稿留在 unsavedRef；罩外 ⇒ 当场载入新版并挂「套回我的修改」；罩期 ⇒ 掀罩那次重载一并处理
        if (res.status === 409 && !aiLockedRef.current) void reloadDocRef.current()
        return false
      } catch { setSaveStatus('error'); return false }
    })()
    inflightRef.current[sheetId] = p
    void p.finally(() => { if (inflightRef.current[sheetId] === p) delete inflightRef.current[sheetId] })
    return p
  }, [host, syncUnsaved])
  const persist = useCallback((sheetId: string, next: SheetContent, o?: { commit?: boolean }) => {
    // 罩期不写；补存窗开着时只放「罩落前就在编辑框里那格的失焦提交」（commit）·罩落后的新动作（删图／调行高／框线／撤销…）⛔
    if (readonly || !shieldWriteAllowed({ locked: aiLockedRef.current, flushOpen: shieldFlush.isOpen(), commit: o?.commit })) return
    contentsRef.current = { ...contentsRef.current, [sheetId]: next }
    setContents(prev => ({ ...prev, [sheetId]: next }))
    unsavedRef.current[sheetId] = next
    syncUnsaved()
    setSaveStatus('saving')
    const timers = saveTimers.current
    if (timers[sheetId]) clearTimeout(timers[sheetId])
    timers[sheetId] = setTimeout(() => { delete timers[sheetId]; void saveNow(sheetId) }, SAVE_DEBOUNCE_MS)   // 到点取最新合并稿（⛔ 捕捉这一刻的 next）
  }, [readonly, saveNow, shieldWriteAllowed, syncUnsaved])
  /** 立刻存掉所有没存的（不等防抖）·等在途的存完；存失败的再补存一次。回 true＝库里已是页面上的最新内容 */
  const flushSaves = useCallback(async (): Promise<boolean> => {
    const timers = saveTimers.current
    for (const id of Object.keys(timers)) { clearTimeout(timers[id]); delete timers[id] }
    await Promise.all(Object.values(inflightRef.current))
    const left = Object.entries(unsavedRef.current)
    if (left.length) await Promise.all(left.map(([id]) => inflightRef.current[id] ?? saveNow(id)))
    return Object.keys(unsavedRef.current).length === 0
  }, [saveNow])
  flushSavesRef.current = flushSaves
  // Desktop app: save before the tab closes (shared/desktop-before-close)
  useEffect(() => registerDesktopBeforeClose(() => flushSavesRef.current()), [])
  useEffect(() => {
    if (!host.registerFlush) return
    host.registerFlush(() => flushSavesRef.current())
    return () => host.registerFlush?.(null)
  }, [host])

  // ── 顶栏「xlsx」钮：点了会下载这份表格（全部分页）──
  //   先把没存的存完 ⇒ 向宿主取全部分页（读权同打开本页·唯读分享者也能下）⇒
  //   动态载入 engine/xlsx-io 的 buildXlsxBytes（SheetJS 不进主包）在浏览器生成 ⇒ 直接下载。
  //   有图 ⇒ 交宿主的 xlsxWithImages（取图、合成下层图）；存失败 ⇒ 提示·⛔ 下库里的旧内容冒充新的。
  const [xlsxBusy, setXlsxBusy] = useState(false)
  const xlsxBusyRef = useRef(false)
  const downloadXlsx = useCallback(async () => {
    if (xlsxBusyRef.current) return
    xlsxBusyRef.current = true; setXlsxBusy(true)
    try {
      if (!(await flushSaves())) { await alertDialog(t('sheet_xlsx_unsaved')); return }
      const rows = await host.listSheets()
      if (!rows) throw new Error('sheets')
      const list = sortSheets(rows) as SheetRow[]
      const { buildXlsxBytes, exportFileName, XLSX_MIME } = await import('../engine/xlsx-io')
      const sheetsIn = list.map(s => ({ name: s.name, content: (s.content && typeof s.content === 'object' ? s.content : { cells: {} }) as AgentContent }))
      // 有图 ⇒ 交宿主生成（取图要过归属闸·下层多张要合成）·回位元组＋两个数；没图 ⇒ 照旧浏览器里生成
      let blob: Blob
      let below = 0, skipped = 0
      if (sheetsIn.some(s => Array.isArray(s.content.images) && s.content.images.length > 0)) {
        const r = await host.xlsxWithImages(sheetsIn)
        blob = r.blob
        below = r.below
        skipped = r.skipped
      } else {
        blob = new Blob([buildXlsxBytes(sheetsIn) as Uint8Array<ArrayBuffer>], { type: XLSX_MIME })
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName(title.trim() || titleRef.current || t('sheet_untitled'))
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      if (skipped) await alertDialog(t('sheet_xlsx_images_skipped').replace('{n}', String(skipped)))
      if (below) await alertDialog(t('sheet_xlsx_below_note'))   // 表格底下的图只在屏幕上看得到、打印时没有
    } catch {
      await alertDialog(t('sheet_xlsx_failed'))
    } finally {
      xlsxBusyRef.current = false; setXlsxBusy(false)
    }
  }, [flushSaves, host, t, title])
  useEffect(() => () => { for (const k of Object.keys(saveTimers.current)) clearTimeout(saveTimers.current[k]) }, [])

  // ── 顶栏「匯出 csv」：只出目前这张·画面上的内容（含还没存进库的改动）·浏览器里直接下载 ──
  //    「匯入 xlsx／csv」：选档 ⇒ 浏览器先读一遍 ⇒ 宿主建成同资料夹里的新表格档 ⇒ 开新分页（被挡就在提示里给连结）
  const io = sheetIoButtons(host)
  /** 匯入钮的提示：登入版存成云盘里的新表格·游客版存成这个浏览器里的新工程 */
  const importTitle = host.kind === 'guest' ? t('sheet_import_title_guest') : t('sheet_import_title')
  const [ioNotice, setIoNotice] = useState<{ text: string; href?: string } | null>(null)
  useEffect(() => { if (!ioNotice) return; const h = setTimeout(() => setIoNotice(null), ioNotice.href ? 12000 : 5000); return () => clearTimeout(h) }, [ioNotice])
  const downloadCsv = useCallback(async () => {
    try {
      const sid = currentSheetIdRef.current
      const sheet = sheetsRef.current.find(s => s.id === sid)
      if (!sid || !sheet) return
      const { text, fileName } = buildSheetCsv({ docTitle: title.trim() || titleRef.current || t('sheet_untitled'), sheetName: sheet.name, content: contentsRef.current[sid], lang: language,
        book: sheetsRef.current.map(s => ({ name: s.name, content: contentsRef.current[s.id] ?? null })) })
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      await alertDialog(t('sheet_csv_failed'))
    }
  }, [language, t, title])
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importBusy, setImportBusy] = useState(false)
  const importBusyRef = useRef(false)
  const importFile = useCallback(async (file: File) => {
    if (importBusyRef.current) return
    importBusyRef.current = true; setImportBusy(true)
    try {
      const r = await runSheetImport(host, file)
      if (!r.ok) { await alertDialog(t(SHEET_IMPORT_FAIL_KEY[r.reason])); return }
      const w = window.open(r.href, '_blank')
      if (w) { try { w.opener = null } catch { /* 跨源设不了就算了 */ } }
      const msg = (w ? t('sheet_import_done') : t('sheet_import_done_open')).replace('{name}', r.title)
      setIoNotice(w ? { text: msg } : { text: msg, href: r.href })
      if (r.imagesSkipped) await alertDialog(t('sheet_import_images_skipped'))
    } finally {
      importBusyRef.current = false; setImportBusy(false)
    }
  }, [host, t])
  /** 网格改动：进撤销栈（与改动前那份不同才进·同 group 并成一步）＋存 */
  const onContentChange = useCallback((sheetId: string, next: SheetContent, meta?: ChangeMeta) => {
    if (readonly || !shieldWriteAllowed({ locked: aiLockedRef.current, flushOpen: shieldFlush.isOpen(), commit: meta?.commit })) return   // 同 persist（只放失焦提交）
    const before = contentsRef.current[sheetId] ?? { cells: {} }
    if (JSON.stringify(before) === JSON.stringify(next)) return
    if (meta) { historyRef.current = pushHistory(historyRef.current, { sheetId, label: meta.label, before, after: next, group: meta.group }); setHistory(historyRef.current) }
    persist(sheetId, next, { commit: meta?.commit })
  }, [persist, readonly, shieldWriteAllowed])
  // ── 撤销／重做：撤到别张 sheet 的改动 ⇒ 先切过去（Excel 口径） ──
  const applyHistory = useCallback((res: { state: HistoryState<SheetContent>; apply: HistoryApply<SheetContent>[]; focusSheet: string | null }) => {
    historyRef.current = res.state; setHistory(res.state)
    for (const a of res.apply) persist(a.sheetId, a.content)
    if (res.focusSheet) { const f = res.focusSheet; setCurrentSheetId(cur => (cur === f ? cur : f)) }
  }, [persist])
  const undo = useCallback((steps = 1) => { if (!readonly) applyHistory(undoSteps(historyRef.current, steps)) }, [applyHistory, readonly])
  const redo = useCallback(() => { if (!readonly) applyHistory(redoSteps(historyRef.current, 1)) }, [applyHistory, readonly])
  // ── 顶栏「列印」：开对话框那刻记下选取（「目前选取」用）·设定存进这张表的 content.print（进撤销栈·跟着存档） ──
  const [printOpen, setPrintOpen] = useState(false)
  const [printSel, setPrintSel] = useState<string | null>(null)
  const openPrint = useCallback(() => { setPrintSel(gridRef.current?.selectionRange() ?? null); setPrintOpen(true) }, [])
  const savePrint = useCallback((print: SheetPrint) => {
    const sid = currentSheetIdRef.current
    if (!sid) return
    onContentChange(sid, { ...(contentsRef.current[sid] ?? { cells: {} }), print }, { label: { k: 'print' } })
  }, [onContentChange])
  // 右上动作钮的下拉：export＝匯出（xlsx／csv）·more＝窄屏「⋯」（匯出两项＋匯入＋列印）
  const [ioMenu, setIoMenu] = useState<null | 'export' | 'more'>(null)
  const labelText = useCallback((l: HistoryLabel) => (t(`sheet_hist_${l.k}`) ?? l.k).replace('{a}', l.a ?? ''), [t])
  const historyView = useMemo<HistoryView>(() => ({
    canUndo: history.undo.length > 0, canRedo: history.redo.length > 0,
    recent: recentSteps(history).map(e => ({ id: e.id, label: labelText(e.label) })),
  }), [history, labelText])

  // ── 网格缩放系数：按档记在浏览器 localStorage（键 aisheet:zoom:<docId>·不同步远端·100% 不存）；工具栏右侧显「100%」可点归位 ──
  const [zoom, setZoomState] = useState(ZOOM_DEFAULT)
  useEffect(() => { if (docId) setZoomState(readStoredZoom(docId)) }, [docId])
  const setZoom = useCallback((z: number) => {
    const v = clampZoom(z)
    setZoomState(v)
    if (docId) writeStoredZoom(docId, v)
  }, [docId])

  // ── 右栏角色接线（宿主的 setEditorAgent） ──
  const changeEditorAgent = useCallback(async (key: string | null): Promise<boolean> => {
    if (!docId) return false
    try {
      const r = await host.setEditorAgent(key)
      if (!r.ok) return false
      setEditorAgentKey(r.key)
      return true
    } catch { return false }
  }, [docId, host])

  // ── 左栏：两页签（表格清單／硬碟）＋拖宽＋收起（同云文档页／网站页） ──
  const [leftTab, setLeftTab] = useState<'sheets' | 'drive'>('sheets')
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT)
  const [leftCollapsed, setLeftCollapsedState] = useState(false)
  // 收起态记在 localStorage 单键（读写失败＝照默认展开·不报错）
  useEffect(() => { try { if (window.localStorage.getItem(LEFT_COLLAPSED_KEY) === '1') setLeftCollapsedState(true) } catch { /* 无痕／禁存 ⇒ 默认展开 */ } }, [])
  const setLeftCollapsed = useCallback((v: boolean) => {
    setLeftCollapsedState(v)
    try { if (v) window.localStorage.setItem(LEFT_COLLAPSED_KEY, '1'); else window.localStorage.removeItem(LEFT_COLLAPSED_KEY) } catch { /* 存不了就只记本页 */ }
  }, [])
  const [rightCollapsed, setRightCollapsed] = useState(false)  // 右栏也可收（页头角色名左边那颗）·收起态只记本页内存·不落 storage（左栏另记 localStorage）
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false); const lastXRef = useRef(0); const leftWidthRef = useRef(LEFT_DEFAULT)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const dx = e.clientX - lastXRef.current; lastXRef.current = e.clientX
      leftWidthRef.current = sheetLeftClamp(leftWidthRef.current + dx, LEFT_MAX) // 两页签同一个宽
      if (leftPanelRef.current) leftPanelRef.current.style.width = leftWidthRef.current + 'px'
    }
    const onUp = () => { if (!resizingRef.current) return; resizingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; setLeftWidth(leftWidthRef.current) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)
  const startRightResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX, startWidth = rightWidth
    const prevCursor = document.body.style.cursor, prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) => setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(startWidth - (ev.clientX - startX)))))
    const stop = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); document.body.style.cursor = prevCursor; document.body.style.userSelect = prevSelect }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop)
  }

  const currentSheet = useMemo(() => sheets.find(s => s.id === currentSheetId) ?? null, [sheets, currentSheetId])
  // ── 工具栏 ⇄ 网格：钮发命令经 ref 进网格·网格回报选区状态给钮的按下态 ──
  const gridRef = useRef<SheetGridHandle>(null)
  const [selState, setSelState] = useState<SelectionState>(EMPTY_SELECTION_STATE)
  const currentContent = useMemo<SheetContent>(() => (currentSheetId && contents[currentSheetId]) || { cells: {} }, [contents, currentSheetId])
  // 跨表引用（表格2!A1）：整份文件各页签名＋画面上的内容（含没存的）·任一张一改换一份 ⇒ 引用它的那张跟着重算；页签删了 ⇒ 名单里没了 ⇒ #REF!
  const book = useMemo<BookSheet[]>(() => sheets.map(s => ({ name: s.name, content: contents[s.id] ?? null })), [sheets, contents])
  // ── 选中格子按 Alt+A（跟剪辑页一样）：选中的格子（单格／一块）⇒ 一颗「儲存格 表格1!C5:C9」小卡插在右栏输入框光标处；
  //   焦点在对话框里也照样收·正在编辑格子／公式栏 ⛔ 抢键；还没选角色 ⇒ 小卡先排着、选好角色输入框一挂上就插。点卡（输入框或气泡上）⇒ 切回那个分页、把那块选回来。
  //   宿主没有可插的对话框（insert 不给）⇒ Alt+A 不拦 ──
  const { insert: chatInsert, attach: chatAttach } = host.useSheetChatInline(t('sheet_cells_open'))
  const [chatNotice, setChatNotice] = useState<string | null>(null)
  useEffect(() => { if (!chatNotice) return; const h = setTimeout(() => setChatNotice(null), 4000); return () => clearTimeout(h) }, [chatNotice])
  const altARef = useRef<() => boolean>(() => false)
  altARef.current = () => {
    const g = gridRef.current
    if (!chatInsert || !g || g.isEditing() || !currentSheet) return false
    const token = buildCellsToken(currentSheet.name, currentSheet.id, g.selectionRange(), language)
    if (!token) return false
    if (!chatInsert(token)) setChatNotice(t('sheet_ref_pick_role'))
    return true
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (isSheetAltA(e) && altARef.current()) { e.preventDefault(); e.stopPropagation() } }
    window.addEventListener('keydown', down, true)   // 捕获段：先于输入框收键（⌥A 不会打出 å）
    return () => window.removeEventListener('keydown', down, true)
  }, [])
  // ── 跨页签点格带入（Excel）：编着公式（光标处能插引用）点别的分页 ⇒ 切过去、不结束编辑；那张点格／拖选插 表名!A1；
  //   Enter ⇒ 回原表原格提交·Esc ⇒ 取消回原表·点回原表分页 ⇒ 回原格接着编。状态机在 engine/formula-edit xrefStep（有题）──
  const [xref, setXref] = useState<XrefEdit | null>(null)
  const [xrefResume, setXrefResume] = useState<XrefResume | null>(null)
  const xrefRef = useRef(xref); xrefRef.current = xref
  const xrefApply = useCallback((o: { xref: XrefEdit | null; show: string; resume?: XrefResume }) => {
    setXref(o.xref)
    if (o.resume) setXrefResume(o.resume)
    setCurrentSheetId(o.show)
  }, [])
  const onXref = useCallback((a: XrefAction) => {
    const x = xrefRef.current; if (!x) return
    const o = xrefStep(x, a, sheets.find(s => s.id === x.homeId)?.name ?? '')
    xrefRef.current = o.xref   // 拖选时一格一发 ⇒ 下一发要看到这次插的那段（不等重画）
    xrefApply(o)
  }, [sheets, xrefApply])
  /** 页签／窄栏点了某张：借着点格中 ⇒ 交给状态机；正编着能带的公式且点的是别张 ⇒ 带过去；否则照常切 */
  const selectSheet = useCallback((id: string) => {
    if (xrefRef.current) { onXref({ t: 'tab', id }); return }
    if (currentSheetId && id !== currentSheetId) {
      const c = gridRef.current?.carryFormula()
      const x = c ? xrefBegin(currentSheetId, c.key, c.text, c.caret, c.live, id) : null
      if (x) { xrefRef.current = x; setXref(x); setCurrentSheetId(id); return }
    }
    setCurrentSheetId(id)
  }, [currentSheetId, onXref])
  const holdTabFocus = useCallback(() => !!xrefRef.current || !!gridRef.current?.canCarryFormula(), [])
  // 原表被删了／别的路径（对话框小卡、AI 跟随）把画面切回原表 ⇒ 借着点格就此作罢
  useEffect(() => {
    if (!xref) return
    if (!sheets.some(s => s.id === xref.homeId) || currentSheetId === xref.homeId) setXref(null)
  }, [xref, sheets, currentSheetId])
  const xrefHome = xref ? sheets.find(s => s.id === xref.homeId)?.name ?? '' : ''

  const pendingRangeRef = useRef<string | null>(null)
  useEffect(() => {
    const onRef = (e: Event) => {
      const d = (e as CustomEvent<SheetCellsRefDetail>).detail
      if (!d) return
      if (d.sheetId === currentSheetId) { gridRef.current?.selectRange(d.range); return }
      if (!sheets.some(s => s.id === d.sheetId)) { setChatNotice(t('sheet_cells_gone')); return }
      pendingRangeRef.current = d.range
      setCurrentSheetId(d.sheetId)
    }
    window.addEventListener(SHEET_CELLS_REF_EVENT, onRef)
    return () => window.removeEventListener(SHEET_CELLS_REF_EVENT, onRef)
  }, [currentSheetId, sheets, t])
  useEffect(() => {
    const r = pendingRangeRef.current
    if (!r) return
    const h = requestAnimationFrame(() => { if (gridRef.current?.selectRange(r)) pendingRangeRef.current = null })
    return () => cancelAnimationFrame(h)
  }, [currentSheetId, currentContent])
  // ── AI 编辑保护遮罩：宿主说「AI 正在编辑这份表格」⇒ 中栏（工具栏＋网格）挡写＋罩层·标题只读·改完拉新版才掀 ──
  //   AI 那一轮到终态 ⇒ 拉最新版换进网格；本地撤销栈与没存的改动都是 AI 改之前那版的 ⇒ 一起清掉（留着的话按一下撤销就把 AI 的改动盖回去）
  //   没存进库的稿（补存失败／撞版）⛔ 丢：按「我改了哪些格」并到新版上·挂「套回我的修改／捨棄」条
  const reloadDoc = useCallback(async () => {
    if (!docId) return
    const seq = ++reloadSeqRef.current
    const rec = await host.getDoc({ fresh: true })
    if (!rec) return
    if (seq !== reloadSeqRef.current) return   // 之后又发起了一次重载（下一轮）⇒ 这份较旧的回包不铺·稿留给那一次处理
    const timers = saveTimers.current
    for (const k of Object.keys(timers)) { clearTimeout(timers[k]); delete timers[k] }
    const live = new Set((rec.sheets ?? []).map(x => x.id))
    const entries: RestoreEntry<SheetContent>[] = []
    for (const [sid, draft] of Object.entries(unsavedRef.current)) {
      const base = serverBaseRef.current[sid] ?? { cells: {} }
      const ch = sheetDraftChanges(base, draft)
      if (!ch.cells.length && !ch.fields.length) continue   // 稿与底一样（没改东西）⇒ 不挂条
      entries.push({ id: ++draftSeqRef.current, sheetId: sid, base, draft })   // 页签没了的由 restoreAdd 并进孤立稿（⛔ 默默丢）
    }
    // 页签名在 applyDoc 之前记下（之后屏上清单就没有被删的那张了）；孤立稿起点＝serverBaseRef（applyDoc 只刷还在的页签·被删那张留着最后已知的库里内容）
    const namesBefore = new Map(sheetsRef.current.map(x => [x.id, x.name] as const))
    const nameOf = (sid: string) => namesBefore.get(sid) ?? ''
    const startOf = (sid: string) => serverBaseRef.current[sid] ?? { cells: {} }
    unsavedRef.current = {}
    historyRef.current = emptyHistory<SheetContent>(); setHistory(historyRef.current)
    syncUnsaved()
    applyDocRef.current(rec, false)
    setSaveStatus('idle')   // 屏上已是库里新版·没存进去的稿在「套回」条里（顶栏那句「操作失敗」不再适用）
    const td = titleDraftRef.current
    titleDraftRef.current = null
    const title = td && td !== (rec.title || '') ? { id: ++draftSeqRef.current, draft: td, seen: rec.title || '' } : undefined   // 标题补存没存进去 ⇒ 也进「套回」条
    setRestore(prev => restoreAdd(prev, { entries, live, nameOf, startOf, title }))
  }, [docId, host, syncUnsaved])
  reloadDocRef.current = reloadDoc
  //   「套回」：先把这页上之后又改的存掉（各按自己的版次）⇒ 现拉库里最新版 ⇒ 按改动集对它重新合并 ⇒ 写回带**合并用的那一版**的版次（⛔ 拿出条那刻并好的整张配最新戳盲写）；
  //   写回那一下库里又变了 ⇒ 409 零写·条留着·提示再点（下次再按那时的最新合并）。标题：出条后库里标题又被改过 ⇒ 不盖·提示。
  //   🔴 收尾只摘这次写成的那几份（按 id）·期间 reload 新加进来的稿原样留着；写成之后用户这一路又敲的字按「底→新版」重新并上再排存（⛔ 拿新版整张盖掉）。
  const applyRestore = useCallback(async () => {
    if (aiLockedRef.current || !restore || restoreBusyRef.current) return   // 罩期不套（条在中栏 inert 块里·这里再挡一道）
    restoreBusyRef.current = true
    const done = new Set<number>(), gone = new Set<number>()
    let titleDone: number | undefined
    let stale = false, failed = false
    const namesAtStart = new Map(sheetsRef.current.map(x => [x.id, x.name] as const))
    const nameOf = (sid: string) => namesAtStart.get(sid) ?? sheetsRef.current.find(x => x.id === sid)?.name ?? ''
    const startOf = (sid: string) => serverBaseRef.current[sid] ?? { cells: {} }
    try {
      const r = restore
      if (!(await flushSavesRef.current())) { failed = true; return }
      const rec = await host.getDoc({ fresh: true }).catch(() => null)
      if (!rec || aiLockedRef.current) { failed = true; return }
      for (const sid of [...new Set(r.sheets.map(e => e.sheetId))]) {
        const entries = r.sheets.filter(e => e.sheetId === sid)
        const srv = (rec.sheets ?? []).find(x => x.id === sid)
        if (!srv) { for (const e of entries) gone.add(e.id); continue }   // 页签已不在 ⇒ 转孤立稿
        const cur = (srv.content && typeof srv.content === 'object' ? srv.content : { cells: {} }) as SheetContent
        const merged = applySheetDrafts(cur, entries)
        const put = await host.saveSheet(sid, merged, srv.updated_at || undefined).catch(() => null)
        if (put?.ok) {
          const j = put.data
          const oldBase = serverBaseRef.current[sid] ?? { cells: {} }
          if (j?.updated_at) serverStampRef.current[sid] = j.updated_at
          serverBaseRef.current[sid] = merged
          for (const e of entries) done.add(e.id)
          const typed = unsavedRef.current[sid]
          if (typed) persist(sid, mergeSheetDraft(oldBase, typed, merged) as SheetContent)   // 套回途中又敲的字：并到套回后的新版上再存
          else { contentsRef.current = { ...contentsRef.current, [sid]: merged }; setContents(prev => ({ ...prev, [sid]: merged })) }
        } else { failed = true; if (put?.status === 409) stale = true }
      }
      if (r.title) {
        if ((rec.title || '') !== r.title.seen) stale = true   // 出条之后标题又被改过 ⇒ 不盖
        else {
          const tr = await host.putTitle(r.title.draft, r.title.seen).catch(() => null)
          if (tr?.ok) { const j = tr.data; titleRef.current = j?.title || r.title.draft; setTitle(titleRef.current); titleDone = r.title.id }
          else { failed = true; if (tr?.status === 409) stale = true }
        }
      }
    } finally {
      restoreBusyRef.current = false
      setRestore(prev => restoreFinishApply(prev, { done, gone, titleDone, nameOf, startOf }))
      if (stale) void alertDialog(t('ai_shield_restore_stale'))
      else if (failed) void alertDialog(t('ai_shield_restore_failed'))
    }
  }, [restore, host, persist, t])
  // 孤立稿（页签已被删）⇒ 另存成一张新页签：内容＝那张页签最后已知的库里内容＋所有份稿的改动·建表与写内容同一发（不留空壳）；
  //   收尾只摘这次并进去的那几份（期间又并进来的同页签稿留着）
  const saveOrphan = useCallback(async (sheetId: string) => {
    if (aiLockedRef.current || readonly || restoreBusyRef.current) return
    const o = restore?.orphans.find(x => x.sheetId === sheetId)
    if (!o) return
    restoreBusyRef.current = true
    const consumed = new Set(o.entries.map(e => e.id))
    const content = orphanContent(o) as SheetContent
    let ok = false
    try {
      const res = await host.addSheet({ ...(o.name ? { name: o.name } : {}), prefix: t('drive_sheet_default_tab'), content }).catch(() => null)
      if (!res?.ok) { await alertDialog(res?.code === 'err_ai_editing' ? t('ai_shield_blocked') : t('ai_shield_restore_failed')); return }
      const j = res.data
      serverStampRef.current[j.sheet.id] = j.sheet.updated_at; serverBaseRef.current[j.sheet.id] = content
      contentsRef.current = { ...contentsRef.current, [j.sheet.id]: content }
      setContents(prev => ({ ...prev, [j.sheet.id]: content }))
      setSheets(sortSheets(j.sheets) as SheetRow[])
      setCurrentSheetId(j.sheet.id)
      ok = true
    } finally {
      restoreBusyRef.current = false
      if (ok) setRestore(prev => restoreFinishOrphan(prev, sheetId, consumed))
    }
  }, [restore, host, readonly, t])
  useEffect(() => { setRestore(null) }, [docId])   // 换档 ⇒ 上一份的条不跟过来
  // ── 别人每写一格就跟着出现（宿主有 live 才开）──
  //   每拍问一次整档各页签·哪张的 updated_at 比本页记着的新 ⇒ 合进画面（engine/sheet-live：没存的格留着·其余照库里；
  //   自己写回的戳不算；本页写在飞那拍不判；页签被删交给 reloadDoc）。别人改过的格进了画面 ⇒ 撤销栈对不上 ⇒ 清。
  //   节拍与推送订阅归宿主（startLive）：分页藏着就停、切回前台补一拍；订上推送 ⇒ 有变才拉、轮询放宽。
  useEffect(() => {
    if (authed !== true || notFound || !docId || !host.has(SHEET_FEATURES.live)) return
    let alive = true
    const pullOnce = async (): Promise<void> => {
      try {
        const rows = await host.listSheets({ fresh: true })
        if (!alive || !rows) return
        const j = { sheets: rows }
        const server = (j.sheets ?? []).map(s => ({ id: s.id, name: s.name, position: s.position, content: s.content, updated_at: s.updated_at ?? null }))
        const plan = sheetLiveDiff({
          server, stamps: serverStampRef.current, base: serverBaseRef.current, unsaved: unsavedRef.current,
          tabs: sheetsRef.current.map(x => ({ id: x.id, name: x.name, position: x.position })),
          ownStamps: ownStampsRef.current, inflight: Object.keys(inflightRef.current).length, empty: { cells: {} } as SheetContent,
        })
        if (!plan) return
        if (plan.reloadNeeded) { void reloadDocRef.current(); return }
        for (const id of plan.stampOnly) serverStampRef.current[id] = plan.stamps[id]
        for (const id of plan.changed) {
          if (plan.stamps[id]) serverStampRef.current[id] = plan.stamps[id]
          serverBaseRef.current[id] = plan.base[id]
          if (id in plan.unsaved) unsavedRef.current[id] = plan.unsaved[id]
        }
        if (plan.changed.length) {
          contentsRef.current = { ...contentsRef.current, ...plan.contents }
          setContents(prev => ({ ...prev, ...plan.contents }))
          historyRef.current = emptyHistory<SheetContent>(); setHistory(historyRef.current)
        }
        if (plan.tabsChanged) setSheets(sortSheets(j.sheets ?? []) as SheetRow[])
        // 别人改的是别张 ⇒ 画面跟过去（正在打字／当前那张有没存的格 ⇒ 不抢）
        const cur = currentSheetIdRef.current
        const ae = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null
        const typing = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
        const follow = sheetLiveFollowTarget({ changed: plan.changed, stamps: plan.stamps, tabOrder: sortSheets(j.sheets ?? []).map(x => x.id), current: cur, busy: typing || (!!cur && cur in unsavedRef.current) })
        if (follow) setCurrentSheetId(follow)
      } catch { /* 下一拍再试 */ }
    }
    const stop = host.startLive({ docId, pullOnce, aiLockedRef })
    return () => { alive = false; stop() }
  }, [authed, notFound, docId, host])
  const centerRef = useRef<HTMLDivElement>(null)
  // 绑定角色的工作态·页面级订（⛔ 跟右栏开合：右栏收起也照收）——一轮没回完（busy）⇒ 罩撑住不掀；名册同一份递给右栏
  const roleBusyOn = authed === true && !!docId
  const { busy: roleBusy, roster: roleRoster } = host.useEditorRoleBusy({ editorAgentKey, enabled: roleBusyOn })
  const aiShield = host.useEditorAIShield({ kind: 'sheet', id: docId, enabled: authed === true && !readonly && !notFound, onRelease: reloadDoc, containerRef: centerRef, onLock: shieldFlush.onLock, hold: roleBusy })
  const aiLocked = aiShield.locked
  aiLockedRef.current = aiLocked

  if (authed === null) return (
    <host.BlockingStatus art="sheet" title={t('sheet_loading')} description={authSlow ? t('bf_mysite_auth_slow_desc') : t('bf_mysite_auth_checking')}
      actions={authSlow ? [{ href: `/login?next=/ai-sheet/${docId}`, label: t('bf_mysite_login') }, { href: '/', label: t('bf_mysite_back_home'), variant: 'secondary' }] : []} />
  )
  if (!authed) return (
    <host.BlockingStatus showSpinner={false} title={t('myst_login_required')} description={t('bf_mysite_login_desc')}
      actions={[{ href: `/login?next=/ai-sheet/${docId}`, label: t('myst_go_login') }, { href: '/', label: t('bf_mysite_back_home'), variant: 'secondary' }]} />
  )
  if (notFound) return (
    <host.BlockingStatus showSpinner={false} title={t('sheet_not_found')} actions={[{ href: '/my-drive', label: t('bf_scribe_drive') }, { href: '/', label: t('bf_mysite_back_home'), variant: 'secondary' }]} />
  )
  if (!currentSheetId) return <host.EditorLoadingScreen kind="sheet" label={t('sheet_loading')} className={editorShell.loadingScreen} />

  return (
    <div className={`h-screen ${editorShell.root} flex flex-col overflow-hidden`} style={editorShell.rootFont} data-testid="sheet-shell">
      {/* ── 顶栏（云文档页同款骨架：品牌｜雲端硬碟｜标题｜已儲存·唯讀）·米色 ── */}
      <header className={`${editorShell.headerBar} px-4 py-2.5 flex items-center gap-3 shrink-0 relative`} style={editorShell.beigeSurface} data-testid="sheet-topbar">
        {/* 左上角品牌（登入版回首页；游客版回 /studio） */}
        {host.renderHomeBrand({ testId: 'sheet-home' })}
        <div className={editorShell.headerDivider} />
        {host.has(SHEET_FEATURES.driveLink) && (
          <>
            <a href="/my-drive" target="_blank" rel="noopener noreferrer" title={t('scribe_drive_title')} className={editorShell.headerLink}>{t('bf_scribe_drive')}</a>
            <div className={editorShell.headerDivider} />
          </>
        )}
        <input value={title} readOnly={readonly || aiLocked} data-testid="sheet-title-input"
          onChange={e => { if (!readonly && !aiLocked) setTitle(e.target.value) }}
          onBlur={() => { if (!aiLocked) void saveTitle() }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder={t('scribe_title_ph')}
          className={`flex-1 ${editorShell.titleInput}`} />
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {readonly && <span className={`text-xs ${editorShell.hintText}`}>{t('sheet_readonly')}</span>}
          {!readonly && saveStatus !== 'idle' && (
            <span className={`text-xs ${saveStatus === 'error' ? 'text-red-500' : editorShell.mutedText}`} data-testid="sheet-save-status">
              {saveStatus === 'saving' ? t('myst_saving') : saveStatus === 'saved' ? t('myst_saved') : t('drive_share_retry')}
            </span>
          )}
          {/* 右上动作钮（有框＋图示）：「匯出 ▾」（Excel／CSV）·「匯入」（xlsx／csv）·「列印」；窄屏收进「⋯」 */}
          <div className="hidden sm:flex items-center gap-1.5" data-testid="sheet-io-bar">
            <button type="button" onClick={() => setIoMenu(m => (m === 'export' ? null : 'export'))} data-testid="sheet-export-menu"
              aria-haspopup="menu" aria-expanded={ioMenu === 'export'} title={t('sheet_export_title')} aria-label={t('sheet_export_title')}
              className={editorShell.headerActionBtn}>
              <IoIcon d={ICON_DOWNLOAD} />{xlsxBusy ? `${t('sheet_export_label')}…` : t('sheet_export_label')}<IoIcon d={ICON_CHEVRON} small />
            </button>
            {io.importOn && (
              <button type="button" onClick={() => importInputRef.current?.click()} disabled={importBusy} data-testid="sheet-import"
                title={importTitle} aria-label={importTitle} className={editorShell.headerActionBtn}>
                <IoIcon d={ICON_UPLOAD} />{importBusy ? t('sheet_import_busy') : <>{t('sheet_import_btn')}<span className={editorShell.headerActionHint}>{t('sheet_import_hint')}</span></>}
              </button>
            )}
            <button type="button" onClick={openPrint} data-testid="sheet-print" title={t('sheet_print_title')} aria-label={t('sheet_print_title')} className={editorShell.headerActionBtn}>
              <PrinterIcon className="w-3.5 h-3.5" />{t('sheet_print_label')}
            </button>
          </div>
          <button type="button" onClick={() => setIoMenu(m => (m === 'more' ? null : 'more'))} data-testid="sheet-more" aria-haspopup="menu" aria-expanded={ioMenu === 'more'}
            title={t('sheet_more')} aria-label={t('sheet_more')} className={`sm:hidden ${editorShell.headerActionBtn} !px-1.5`}>
            <IoIcon d={ICON_MORE} />
          </button>
          {/* 下拉：匯出两项（宽屏「匯出」与窄屏「⋯」共用这一份）＋窄屏另列匯入、列印 */}
          {ioMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIoMenu(null)} />
              <div role="menu" className={`absolute right-3 top-full mt-1 z-50 min-w-[230px] ${editorShell.menu}`} data-testid="sheet-io-menu">
                <button type="button" role="menuitem" onClick={() => { setIoMenu(null); void downloadXlsx() }} disabled={xlsxBusy} data-testid="sheet-download-xlsx"
                  title={t('sheet_xlsx_title')} className={`${editorShell.menuItem} flex items-center gap-2.5 disabled:opacity-60`}>
                  <FileBadge text="XLSX" tone="green" />
                  <span className="flex flex-col"><span>{t('sheet_export_xlsx')}</span><span className={editorShell.headerActionHint}>{t('sheet_export_xlsx_hint')}</span></span>
                </button>
                {/* 「CSV」：目前这张工作表下载成 csv（宿主 has('csvExport') 才有） */}
                {io.csvOn && (
                  <button type="button" role="menuitem" onClick={() => { setIoMenu(null); void downloadCsv() }} data-testid="sheet-download-csv"
                    title={t('sheet_csv_title')} className={`${editorShell.menuItem} flex items-center gap-2.5`}>
                    <FileBadge text="CSV" tone="blue" />
                    <span className="flex flex-col"><span>{t('sheet_export_csv')}</span><span className={editorShell.headerActionHint}>{t('sheet_export_csv_hint')}</span></span>
                  </button>
                )}
                {ioMenu === 'more' && (
                  <>
                    <div className={`my-1 border-t ${editorShell.divider}`} />
                    {io.importOn && (
                      <button type="button" role="menuitem" onClick={() => { setIoMenu(null); importInputRef.current?.click() }} disabled={importBusy} data-testid="sheet-import-menuitem"
                        title={importTitle} className={`${editorShell.menuItem} flex items-center gap-2.5 disabled:opacity-60`}>
                        <IoIcon d={ICON_UPLOAD} />{importBusy ? t('sheet_import_busy') : <>{t('sheet_import_btn')}<span className={editorShell.headerActionHint}>{t('sheet_import_hint')}</span></>}
                      </button>
                    )}
                    <button type="button" role="menuitem" onClick={() => { setIoMenu(null); openPrint() }} data-testid="sheet-print-menuitem"
                      title={t('sheet_print_title')} className={`${editorShell.menuItem} flex items-center gap-2.5`}>
                      <PrinterIcon className="w-3.5 h-3.5" />{t('sheet_print_label')}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {/* 匯入的选档框（宿主 has('xlsxImport')＋给了 importWorkbook 才有；登入版＝云盘里的新档·游客版＝这个浏览器里的新工程） */}
          {io.importOn && (
            <input ref={importInputRef} type="file" accept={SHEET_IMPORT_ACCEPT} className="hidden" data-testid="sheet-import-input"
              onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void importFile(f) }} />
          )}
        </div>
        {/* AI 编辑保护遮罩：提示条「〈名〉正在編輯…·已 N 秒」放顶栏正中 */}
        <host.EditorAIShieldPill shield={aiShield} testId="sheet-ai-shield" />
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左栏：表格清單／硬碟 两页签·米色 ── */}
        {leftCollapsed ? (
          /* 收起态＝窄栏（展开钮／每表一图标·点了切表／＋新增／硬碟图标·点了展开到硬碟页） */
          <SheetLeftRail sheets={sheets} currentId={currentSheetId} readonly={readonly}
            onExpand={() => setLeftCollapsed(false)} onSelect={selectSheet} holdFocus={holdTabFocus} onAdd={() => { void addSheet() }}
            onOpenDrive={() => { setLeftTab('drive'); setLeftCollapsed(false) }} />
        ) : (
          <>
            <aside ref={leftPanelRef} className={editorShell.sideCol} style={{ width: leftWidth, ...editorShell.beigeSurface }} data-testid="sheet-left">
              <div className="flex border-b border-black/5">
                <button onClick={() => setLeftTab('sheets')} data-testid="sheet-tab-sheets"
                  className={`flex-1 min-w-0 px-0.5 py-2 text-xs font-medium text-center whitespace-nowrap transition-colors ${leftTab === 'sheets' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
                  ▦ {t('sheet_tab_list')}
                </button>
                <button onClick={() => setLeftTab('drive')} data-testid="sheet-tab-drive"
                  className={`flex-1 min-w-0 px-0.5 py-2 text-xs font-medium text-center whitespace-nowrap transition-colors ${leftTab === 'drive' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
                  {host.driveSlotLabel ?? t('bf_scribe_drive_tab')}
                </button>
                {/* 收合箭头放硬碟页签右边的正方形小块 */}
                <PanelCollapseButton side="left" onCollapse={() => setLeftCollapsed(true)} title={t('scribe_collapse')} testId="sheet-left-collapse" />
              </div>
              {leftTab === 'sheets' ? (
                <SheetTabList sheets={sheets} currentId={currentSheetId} readonly={readonly || aiLocked}
                  onSelect={selectSheet} holdFocus={holdTabFocus} onAdd={() => { void addSheet() }} onRename={renameSheet} onDelete={id => { void deleteSheet(id) }} />
              ) : (
                /* 栏比树最窄还窄 ⇒ 树维持最窄宽、在栏里左右卷；内容＝宿主的云盘区块（登入版云盘树·游客版工程清单与存放位置） */
                <div className="flex-1 min-h-0 flex flex-col overflow-x-auto overflow-y-hidden" data-testid="sheet-left-drive-scroll">
                <div className="flex-1 min-h-0 flex flex-col" style={{ minWidth: SHEET_DRIVE_TREE_MIN }}>
                {host.renderDriveSlot()}
                </div>
                </div>
              )}
            </aside>
            <div className={editorShell.resizeHandle} title={t('bf_scribe_left_resize_aria')}
              onMouseDown={e => { e.preventDefault(); resizingRef.current = true; lastXRef.current = e.clientX; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}>
              <div className={editorShell.resizeHandleLine} />
              <div className={editorShell.resizeHandleGrip} />
            </div>
          </>
        )}

        {/* ── 中栏：表格工具栏（格式组四组＋插入图片）＋表格编辑器 ── */}
        <div ref={centerRef} className={`flex flex-col flex-1 min-w-0 overflow-hidden relative ${editorShell.centerCol}`} data-testid="sheet-center">
          {/* 中栏不整块 inert——网格照常滚动／缩放／选格子（SheetGrid locked 只挡进入编辑／贴上／填充／格式）·工具栏写钮按 readonly 灰掉·玻璃罩层叠在后面 */}
          <div className="flex flex-col flex-1 min-h-0" data-testid="sheet-center-body">
          {restore && (
            <host.EditorRestoreBar testId="sheet-restore-bar" onApply={() => { void applyRestore() }} onDiscard={() => setRestore(null)} applyLabel={restore.sheets.length || restore.title ? undefined : null}>
              {restore.title && <span className="font-medium" data-testid="sheet-restore-title">「{restore.title.draft}」</span>}
              {restore.title?.older?.length ? <span className="text-amber-800/70" data-testid="sheet-restore-title-older">{t('ai_shield_restore_older_title')}{restore.title.older.map(x => `「${x}」`).join('')}</span> : null}
              {restore.orphans.map(o => (
                <span key={o.sheetId} className="inline-flex items-center gap-2" data-testid="sheet-restore-orphan">
                  <span>{t('ai_shield_restore_orphan').replace('{name}', o.name || t('sheet_untitled'))}</span>
                  <button type="button" onClick={() => { void saveOrphan(o.sheetId) }} data-testid="sheet-restore-orphan-save" className="rounded-md bg-amber-600 px-2.5 py-1 keep-white hover:bg-amber-700">{t('ai_shield_restore_orphan_save')}</button>
                </span>
              ))}
            </host.EditorRestoreBar>
          )}
          {/* 工具栏不整块 inert（缩放重设要能按）·写钮由 SheetToolbar readonly 灰掉 */}
          <div className={`flex items-center gap-0.5 px-3 py-1.5 ${editorShell.toolbarBar} shrink-0 flex-wrap`} data-testid="sheet-toolbar">
            {/* 收合箭头不在工具栏·做在左右栏自己身上（PanelCollapseHandle） */}
            <SheetToolbar state={selState} readonly={readonly || aiLocked} onCommand={cmd => gridRef.current?.exec(cmd)}
              history={historyView} onUndo={undo} onRedo={redo} />
            <button type="button" onClick={() => setZoom(ZOOM_DEFAULT)} title={t('sheet_zoom_reset')} aria-label={t('sheet_zoom_reset')}
              data-testid="sheet-zoom" className={`ml-auto ${editorShell.toolbarTextBtn} font-mono tabular-nums`}>{formatZoom(zoom)}</button>
          </div>
          <SheetGrid key={currentSheetId} ref={gridRef} content={currentContent} book={book} readonly={readonly} locked={aiLocked} sheetName={currentSheet?.name}
            zoom={zoom} onZoomChange={setZoom}
            onChange={(next, meta) => onContentChange(currentSheetId, next, meta)} onSelectionState={setSelState}
            onUndo={() => undo(1)} onRedo={redo}
            xref={xref && xref.sheetId === currentSheetId ? { text: xref.text, caret: xref.caret, home: `${xrefHome}!${xref.key}` } : null} onXref={onXref}
            resume={xrefResume && xrefResume.homeId === currentSheetId ? xrefResume : null} onResumed={() => setXrefResume(null)} />
          </div>
          <host.EditorAIShield shield={aiShield} testId="sheet-ai-shield" />
        </div>

        {/* ── 中栏 ↔ 右栏拖宽把手＋右栏对话格（宿主的 renderChatSlot·浅米） ── */}
        {rightCollapsed ? (
          <PanelCollapsedEdge side="right" onExpand={() => setRightCollapsed(false)} title={host.chatSlotLabel ?? t('side_chat_pick_role')} testId="sheet-right-collapsed" />
        ) : (
          <>
            <div role="separator" aria-orientation="vertical" aria-valuemin={RIGHT_MIN} aria-valuemax={RIGHT_MAX} aria-valuenow={rightWidth}
              onPointerDown={startRightResize} title={t('bf_scribe_right_resize_title')} className={editorShell.resizeHandle}>
              <div className={editorShell.resizeHandleLine} />
              <div className={editorShell.resizeHandleGrip} />
            </div>
            <div className="shrink-0 flex flex-col min-h-0" style={{ width: rightWidth, ...editorShell.chatSurface }} data-testid="sheet-side-chat">
              {host.renderChatSlot({
                sheet: { docId, docTitle: title, activeSheet: currentSheet ? { id: currentSheet.id, name: currentSheet.name } : null, editorAgentKey, onEditorAgentKeyChange: changeEditorAgent, rosterFrom: roleBusyOn ? roleRoster : undefined, attach: chatAttach },
                title: host.chatSlotLabel ?? t('side_chat_pick_role'),
                /* 页头角色名左边那格＝收合箭头（收起右栏） */
                titleIcon: <PanelCollapseButton side="right" onCollapse={() => setRightCollapsed(true)} title={t('scribe_collapse')} testId="sheet-right-collapse" />,
              })}
            </div>
          </>
        )}
      </div>

      {chatNotice && (
        <div role="status" data-testid="sheet-chat-notice" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-neutral-800/90 px-3 py-2 text-sm text-white shadow">{chatNotice}</div>
      )}
      {ioNotice && (
        <div role="status" data-testid="sheet-io-notice" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-neutral-800/90 px-3 py-2 text-sm text-white shadow">
          {ioNotice.text}
          {ioNotice.href && <a href={ioNotice.href} target="_blank" rel="noopener noreferrer" data-testid="sheet-io-notice-open" className="ml-2 underline keep-white" onClick={() => setIoNotice(null)}>{t('sheet_import_open')}</a>}
        </div>
      )}
      {printOpen && currentSheetId && (
        <SheetPrintDialog content={contents[currentSheetId] ?? { cells: {} }} book={book} sheetName={currentSheet?.name ?? ''} docTitle={title.trim() || titleRef.current || t('sheet_untitled')}
          selection={printSel} readonly={readonly || aiLocked} onSave={savePrint} onClose={() => setPrintOpen(false)} />
      )}
      {host.renderPageExtras?.()}
    </div>
  )
}

// ── 右上动作钮的图示（Heroicons 24 outline·MIT）与档案类型小标 ──
const ICON_DOWNLOAD = 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3'
const ICON_UPLOAD = 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5'
const ICON_CHEVRON = 'm19.5 8.25-7.5 7.5-7.5-7.5'
const ICON_MORE = 'M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z'
function IoIcon({ d, small }: { d: string; small?: boolean }) {
  return (
    <svg className={small ? 'w-3 h-3 text-gray-400' : 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={small ? 2 : 1.6} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}
function FileBadge({ text, tone }: { text: string; tone: 'green' | 'blue' }) {
  return <span className={`inline-flex w-9 justify-center rounded px-1 py-0.5 text-[9px] font-bold tracking-wide ${tone === 'green' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{text}</span>
}
