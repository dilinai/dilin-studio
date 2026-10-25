'use client'
// ═══════════════════════════════════════════════════════════════════════════════════════════
// 画板整页（登入版 /drawboard 与游客版 /studio/paint/<工程> 共用这一份·差别全经宿主 host.ts 进来）
//   画板本体＝同步进 public/drawboard-app/ 的静态档（纯前端零建置·类 PS／AI）·这页用同源 iframe 开它
//   （画板有自己的全局样式与全局键盘／DOMContentLoaded 启动·⛔ 直接塞进 React 页）·接线全在 drawboard-host.ts。
// 版面：
//   ┌─画板（iframe：菜单列最左＝品牌回首页｜选项栏｜左栏［雲盤｜工具］页签＋工具栏或云盘那格｜画布｜图层面板）─┐┃┌─对话栏─┐
//   左栏「雲盤」页签＝宿主的云盘那格（登入版云盘树；游客版工程清单＋存放位置）盖在 iframe 左栏占位上·右缘拖拉条调宽；
//   图层面板与对话栏之间一条拖拉条调对话栏宽；宽度存本机。
// 存档／开档／导出：file.saveProject＝存回这份（宿主的 api.put）；file.openProject＝切到左栏让人点；
//   file.exportPNG＝导出交给宿主（登入版存进云盘同资料夹；游客版下载）。改一笔停手几秒自动存（drawboard-host createAutosaver）。
// 对话栏：宿主的对话那格·页头角色名左边＝收合钮·收起留右缘窄条点开；收起时对话栏只藏不拆（打到一半的字不丢）·存本机。
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { registerDesktopBeforeClose } from '../../shared/desktop-before-close'
import { isSimplifiedSite, studioStaticHref } from '../../shared/host'
import { PanelCollapseButton, PanelCollapsedEdge } from '../../shared/ported/PanelCollapseHandle'
import { DRAWBOARD_MIME, drawboardOldLayout, drawboardTitle, exportPngName, isDrawboardFileName, isDrawboardImage } from './drawboard-file.pure'
import { DRAWBOARD_LAYOUT_DEFAULT, DRAWBOARD_LAYOUT_KEY, clampLayout, dragLayout, parseLayout, type DrawboardLayout, type DrawboardTab } from './drawboard-layout.pure'
import { TAB_STRIP_H, applyLanguage, canvasPng, markEngineSaved, createCloudTabs, createDocLock, installCloudTabs, installPageCommands, setSaveBadge, withBusyCursor, type AutosaveStatus, type SavedChannel, installChrome, installCommands, leftRect, openSavedChannel, popupOver, setLeft, siteOf, startDrag, watchDirty, type ApiErr, type CloudTab, type DlSite, type Rect } from './drawboard-host'
import type { PaintLoadFail, PaintPageHost } from './host'
import { psdBlob } from './agent-export'

type Proj = { id: string; title: string; folder_id: string | null }
type DriveDrop = { id: string; kind: string; name: string; mime?: string | null }

/** 画板本体（同步来的静态档·开源单页版走相对路径） */
export const DRAWBOARD_APP_SRC = studioStaticHref('/drawboard-app/index.html')

export default function DrawboardPage({ host }: { host: PaintPageHost }) {
  const t = useStudioT()
  const language = useStudioLang()
  const hostRef = useRef(host)
  hostRef.current = host
  const [gate, setGate] = useState<'checking' | 'ok' | 'no'>('checking')
  useEffect(() => {
    let alive = true
    void hostRef.current.gate().then((ok) => { if (alive) setGate(ok ? 'ok' : 'no') })
    return () => { alive = false }
  }, [])

  // ── 版面（页签、两条宽度·存本机）──
  const [layout, setLayout] = useState<DrawboardLayout>(DRAWBOARD_LAYOUT_DEFAULT)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  useEffect(() => { try { setLayout(parseLayout(window.localStorage.getItem(DRAWBOARD_LAYOUT_KEY))) } catch { /* 读不到用缺省 */ } }, [])
  const saveLayout = useCallback((l: DrawboardLayout) => { try { window.localStorage.setItem(DRAWBOARD_LAYOUT_KEY, JSON.stringify(l)) } catch { /* 存不进只影响下次开页 */ } }, [])
  const patchLayout = useCallback((p: Partial<DrawboardLayout>) => setLayout((l) => { const n = clampLayout({ ...l, ...p }, window.innerWidth); saveLayout(n); return n }), [saveLayout])
  const setTab = useCallback((tab: DrawboardTab) => patchLayout({ tab }), [patchLayout])

  // ── 画板 iframe ──
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [site, setSite] = useState<DlSite | null>(null)
  const siteRef = useRef<DlSite | null>(null)
  /** 角色正在画（遮罩罩着）⇒ 页面挡人手切档、放图（值由宿主那组角色动手画的元件每次渲染写进来·没有那组＝一直 false） */
  const aiLockedRef = useRef(false)
  siteRef.current = site
  const onFrameLoad = useCallback(() => {
    // 画板 UI.init 挂在 DOMContentLoaded·load 一般已起好；万一还没 ⇒ 每 100ms 再看一次（最多 60 秒·第一次编译慢）
    let n = 0
    const tick = () => { const s = siteOf(frameRef.current); if (s) setSite(s); else if (++n < 600) setTimeout(tick, 100) }
    tick()
  }, [])
  // iframe 的 load 可能比 React 接上 onLoad 还早（新分页开时撞到过）⇒ 一挂上就自己也看一次
  useEffect(() => { if (gate === 'ok') onFrameLoad() }, [gate, onFrameLoad])

  // ── 提示条 ──
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = useCallback((s: string, ms = 3500) => {
    setNotice(s)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), ms)
  }, [])

  // ── 这一份画板＝前面那个云档分页（每个分页各绑各的档、各自自动存）──
  const [proj, setProj] = useState<Proj | null>(null)
  const projRef = useRef<Proj | null>(null)
  // 对话那格的角色钩子（那格渲染时才挂上来）先挂个口——存档建新档（adopt）与中继来活（note）在它之前定义
  const roleHooksRef = useRef<{ adopt: (id: string) => void; note: (key: string) => void; key?: () => string | null }>({ adopt: () => {}, note: () => {} })
  projRef.current = proj
  const [loading, setLoading] = useState(false)
  // 起好时要开的那份开不到 ⇒ 整页明说是哪种（⛔ 留一张空白画板·按存档另建一份）
  const [urlFail, setUrlFail] = useState<PaintLoadFail | null>(null)
  const lastLoadErrRef = useRef<ApiErr | null>(null)   // 最近一次开档没成的回应（起好时那份开完马上读它分种类）
  const errText = useCallback((e: ApiErr) => (e.code === 'drawboard_quota' ? t('drawboard_quota') : e.code === 'drawboard_too_large' ? t('drawboard_too_large') : (e.error || e.code || `HTTP ${e.status}`)), [t])
  // 改一笔 ⇒ 停手几秒自动存回那份（串行·尾值·标题列显示状态·见 drawboard-host createAutosaver）
  //   每个云档分页各一只（createCloudTabs）·标题列显示前面那份的
  const statusText = useRef<{ t: typeof t; errText: typeof errText; say: typeof say }>({ t, errText, say })
  statusText.current = { t, errText, say }
  // 同一张画板别的分页存过新版 ⇒ 这里出「有新版·載入」（ask＝按了存档·问套用最新版／保留我的；dirty＝本份有没存的改动）
  const [stale, setStale] = useState<{ doc: string; ask: boolean; dirty: boolean } | null>(null)
  const savedChan = useRef<SavedChannel | null>(null)
  const [cloud] = useState(() => createCloudTabs({
    tabs: () => siteRef.current?.Tabs ?? null,
    get: (id) => withBusyCursor([document, siteRef.current?.doc], () => hostRef.current.api.get(id)),
    // 空檔與非空檔都經 bridge：先切回宿主分页，再載入或建立白底。
    loadHere: async (p) => {
      const s = siteRef.current
      if (!s) throw new Error('not_ready')
      await s.Project.load(p)
      s.History.clear()
    },
    serializeActive: async () => {
      const s = siteRef.current
      if (!s) throw new Error('not_ready')
      return s.Project.serializeAsync ? s.Project.serializeAsync({ reuse: true }) : s.Project.serialize()
    },
    serializeActiveSync: () => { const s = siteRef.current; if (!s) throw new Error('not_ready'); return s.Project.serialize() },
    put: (id, base, project) => hostRef.current.api.put(id, base, project),
    name: (title) => drawboardTitle(hostRef.current.displayName(title)),
    // 还没绑档那份的分页标签、新页缺省名照画板语言
    untitled: () => statusText.current.t('drawboard_untitled'),
    lang: () => siteRef.current?.Lang?.cur ?? null,
    // ref 当下就换（⛔ 等 React 重画）：中继核「这页开着哪份」读的是它·合法 batch 里 file.openProject 之后下一步就要看到新那份
    onCurrent: (tab: CloudTab | null) => {
      const prev = projRef.current
      const next = tab?.proj ? { ...tab.proj } : null
      projRef.current = next; setProj(next)
      // 没档 ⇒ 没档（页面起好时登记第一个分页）⛔ 动网址：起好时那份还等着载
      const want = hostRef.current.pageHref?.(next ? next.id : null)
      if (want !== undefined && (next || prev) && window.location.pathname + window.location.search !== want) window.history.replaceState(null, '', want)
    },
    onStatus: (st: AutosaveStatus, err?: ApiErr) => {
      hostRef.current.saveState?.(st, cloud.dirty)
      // 存成了且前面这份没再改 ⇒ 分页名后的「*」跟着消（自动存不经画板的存档命令·见 markEngineSaved）
      if (st === 'saved' && !cloud.current()?.auto.dirty) markEngineSaved(siteRef.current)
      const doc = siteRef.current?.doc
      if (!doc) return
      const { t: tt, errText: et } = statusText.current
      const text = st === 'pending' || st === 'saving' ? tt('drawboard_autosave_saving')
        : st === 'saved' ? tt('drawboard_autosave_saved')
        : st === 'offline' ? tt('drawboard_autosave_offline')
        : st === 'blocked' ? (err?.status === 409 ? tt('drawboard_autosave_conflict') : tt('drawboard_autosave_stopped') + (err ? et(err) : ''))
        : st === 'error' ? tt('drawboard_autosave_error') : ''
      setSaveBadge(doc, text, st === 'error' || st === 'blocked' ? 'error' : 'muted')
    },
    onSaved: (id, at, info) => savedChan.current?.post(id, at, info),
    // 一发存档打出去了／没存成 ⇒ 告诉别的分页（接手那页等这发落地再拉最新）
    onSending: (id, on) => savedChan.current?.saving(id, on),
    // 刚载完的那页（在前面）像素层被载档裁小了 ⇒ 旧格式（整张大的 PNG·开档慢）⇒ 那份档待转新格式（drawboard-host createAutosaver.upgrade）
    oldLayout: (page) => {
      const layers = siteRef.current?.Doc?.layers
      if (!Array.isArray(layers)) return false
      const size = new Map<string, [number, number]>()
      for (const L of layers) { const c = L?.data?.canvas; if (typeof L?.id === 'string' && L.kind === 'raster' && c && !size.has(L.id)) size.set(L.id, [c.width, c.height]) }
      return drawboardOldLayout(page, (id) => size.get(id) ?? null)
    },
    onStale: (tab) => setStale((p) => {
      if (!tab) return null
      const ask = p?.doc === tab.doc && p.ask, dirty = tab.auto.dirty
      return p && p.doc === tab.doc && p.ask === ask && p.dirty === dirty ? p : { doc: tab.doc, ask, dirty }
    }),
    onLoading: setLoading,
    onLoadFailed: (e) => { lastLoadErrRef.current = e; const u = statusText.current; u.say(u.t('drawboard_load_failed') + u.errText(e), 6000) },
    onError: (e) => { const u = statusText.current; u.say(u.t('drawboard_load_failed') + (e instanceof Error ? e.message : String(e)), 6000) },
  }))

  const save = useCallback(async (): Promise<Record<string, unknown>> => {
    const s = siteRef.current
    if (!s) return { ok: false, error: 'not_ready' }
    const tab = cloud.current()
    if (!tab) return { ok: false, error: 'not_ready' }
    const api = hostRef.current.api
    say(t('drawboard_saving'), 60_000)
    try {
      let cur = tab.proj
      if (!cur) {
        // 还没绑档（登入版直接开 /drawboard）⇒ 第一次存档才建一份；宿主不建档（游客版）⇒ 没地方存
        if (!api.create) { say(t('drawboard_save_failed') + 'not_ready', 6000); return { ok: false, error: 'not_ready' } }
        const c = await api.create(null, t('drawboard_untitled'))
        if (!c.ok) { say(t('drawboard_save_failed') + errText(c.err), 6000); return { ok: false, error: c.err.code ?? c.err.error } }
        cur = { id: c.id, title: c.title, folder_id: c.folder_id }
        roleHooksRef.current.adopt(c.id)   // 建好前已选的角色记到这份上
        cloud.bind(tab, cur, c.updated_at)
      }
      // 跟自动存同一条队（⛔ 两发并飞·乱序落库）：等在飞那发、再存最新的
      // 有新版（别页存过／409）⇒ autosaver 不发·改问「套用最新版／保留我的」（⛔ 直接盖掉新版）
      const r = await tab.auto.flush()
      if (!r.ok && r.err.status === 409) {
        setStale({ doc: tab.doc, ask: true, dirty: tab.auto.dirty })
        say(t('drawboard_remote_ask'), 5000)
        return { ok: false, error: 'drawboard_conflict', message: 'a newer version was saved elsewhere; the user must choose 套用最新版 / 保留我的' }
      }
      if (!r.ok) { say(t('drawboard_save_failed') + errText(r.err), 6000); return { ok: false, error: r.err.code ?? r.err.error } }
      say(t('drawboard_saved'))
      return { ok: true, id: cur.id, bytes: r.bytes }
    } catch (e) {
      say(t('drawboard_save_failed') + (e instanceof Error ? e.message : String(e)), 6000)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [cloud, errText, say, t])

  const openFromDrive = useCallback((id: string): Promise<Record<string, unknown>> => cloud.open(id), [cloud])

  /** 「存储副本」存工程档 ⇒ 另建一份（整份档、所有页）·现在这页仍绑原档（⛔ 写回原档）。
   *  宿主不建档（游客版）⇒ 整份交给宿主的 upload（下载一份 .dlcanvas） */
  const saveCopy = useCallback(async (name?: string): Promise<Record<string, unknown>> => {
    const tab = cloud.current()
    if (!tab) return { ok: false, error: 'not_ready' }
    const api = hostRef.current.api
    say(t('drawboard_saving'), 60_000)
    try {
      const project = await cloud.serializeFile(tab)
      const base = tab.proj ? drawboardTitle(hostRef.current.displayName(tab.proj.title)) : t('drawboard_untitled')
      if (!api.create) {
        const blob = new Blob([JSON.stringify(project)], { type: DRAWBOARD_MIME })
        const u = await api.upload(blob, `${drawboardTitle(name || `${base} copy`)}.dlcanvas`, tab.proj?.folder_id ?? null)
        if (!u.ok) { say(t('drawboard_copy_failed') + errText(u.err), 6000); return { ok: false, error: u.err.code ?? u.err.error } }
        say(t('drawboard_copy_saved') + u.name, 5000)
        return { ok: true, name: u.name, bytes: blob.size, copy: true }
      }
      const c = await api.create(tab.proj?.folder_id ?? null, name || `${base} copy`)
      if (!c.ok) { say(t('drawboard_copy_failed') + errText(c.err), 6000); return { ok: false, error: c.err.code ?? c.err.error } }
      const r = await api.put(c.id, c.updated_at, project)
      if (!r.ok) { say(t('drawboard_copy_failed') + errText(r.err), 6000); return { ok: false, id: c.id, error: r.err.code ?? r.err.error } }
      say(t('drawboard_copy_saved') + c.title, 5000)
      hostRef.current.driveChanged?.()
      return { ok: true, id: c.id, name: c.title, bytes: r.bytes, copy: true }
    } catch (e) {
      say(t('drawboard_copy_failed') + (e instanceof Error ? e.message : String(e)), 6000)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [cloud, errText, say, t])

  // 「有新版」那条的两颗钮：套用（载入）最新版＝丢掉本份没存的改动换成最新那版；保留我的＝照新版的时戳盖过去
  const loadLatest = useCallback(async () => {
    const doc = stale?.doc
    if (!doc) return
    const r = await docLock.cut(() => cloud.reload(doc))
    if (r.value.ok) { setStale(null); say(t('drawboard_remote_loaded')) }
  }, [cloud, say, stale?.doc, t])
  const keepMine = useCallback(async () => {
    const tab = stale ? cloud.get(stale.doc) : undefined
    if (!tab || !tab.stale) return
    say(t('drawboard_saving'), 60_000)
    const r = await tab.auto.flush({ base: tab.stale === '?' ? null : tab.stale })
    if (r.ok) { setStale(null); say(t('drawboard_saved')) } else say(t('drawboard_save_failed') + errText(r.err), 6000)
  }, [cloud, errText, say, stale, t])

  /** 使用者自己（云盘那格点／拖画板档）开档 ⇒ 走「这份画板正被谁动」那把锁的 cut：马上开、之后的活等载完。
   *  角色活里合法的 file.openProject 走命令那支（已在锁里·⛔ 再排）。 */
  const [docLock] = useState(createDocLock)
  // 开档⛔ 等角色手上那件——马上开；那件若在等图下载、图到时前面已换成新分页 ⇒ 画板本体按 Doc.serial 丢掉、那件回角色失败。
  const openFromDriveUser = useCallback(async (id: string): Promise<void> => {
    if (aiLockedRef.current) { say(t('drawboard_ai_busy'), 4000); return }   // 角色正在画 ⇒ 不准经页面开档（罩期左栏只给看）
    await docLock.cut(() => openFromDrive(id))
  }, [docLock, openFromDrive, say, t])

  const exportPng = useCallback(async (scale: number, name?: string): Promise<Record<string, unknown>> => {
    const s = siteRef.current
    if (!s) return { ok: false, error: 'not_ready' }
    say(t('drawboard_exporting'), 60_000)
    try {
      const { blob, width, height } = await canvasPng(s, scale)
      const r = await hostRef.current.api.upload(blob, exportPngName(projRef.current?.title || t('drawboard_untitled'), scale, name), projRef.current?.folder_id ?? null)
      if (!r.ok) { say(t('drawboard_export_failed') + errText(r.err), 6000); return { ok: false, error: r.err.code ?? r.err.error } }
      say(t('drawboard_exported') + r.name, 5000)
      hostRef.current.driveChanged?.()
      return { ok: true, id: r.id, name: r.name, width, height, bytes: blob.size }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      say(m === 'tainted' ? t('drawboard_export_tainted') : t('drawboard_export_failed') + m, 6000)
      return { ok: false, error: m }
    }
  }, [errText, say, t])

  /** 云盘图放进画板（双击＝置中·拖进画布＝图心对准放手那点）·插在当前图层上面 */
  const placeImage = useCallback((id: string, title: string, at: [number, number] | null) => {
    const s = siteRef.current
    const place = hostRef.current.placeImage
    if (!s || !place) return
    if (aiLockedRef.current) { say(t('drawboard_ai_busy'), 4000); return }   // 角色正在画 ⇒ 人手放图挡掉（角色自己放图走命令·不经这里）
    // 图下载要时间 ⇒ 同排那把锁（下载中切档会等它放好·⛔ 晚到的图掉进新那份）；下载与放图期间游标转圈（页面＋画板里）·放好或失败都收
    const shown = hostRef.current.displayName(title)
    withBusyCursor([document, s.doc], () => docLock.run(() => place(s, id, shown, at))).then(() => say(t('drawboard_placed') + shown), (e: unknown) => say(t('drawboard_place_failed') + (e instanceof Error ? e.message : String(e)), 6000))
  }, [docLock, say, t])
  /** 云盘条目拖进画板：图＝放进当前图层上面；画板档＝开它；其余（云文档、影片…）＝提示拖到右边对话栏 */
  const dropDrive = useCallback((item: DriveDrop, at: [number, number] | null) => {
    if (item.kind === 'file' && isDrawboardFileName(item.name)) { void openFromDriveUser(item.id); return }
    if (item.kind === 'file' && isDrawboardImage(item.mime ?? null, item.name)) { placeImage(item.id, item.name, at); return }
    say(t('drawboard_drop_to_chat'), 5000)
  }, [openFromDriveUser, placeImage, say, t])

  // 命令处理器经 ref 递（命令只装一次·拿到的永远是最新那只）
  // 宿主那份被换成空白（關閉／開啟為）＝前面那个分页 ⇒ 解开它和档的绑定
  const detach = useCallback(() => {
    const doc = siteRef.current?.Tabs?.activeId() ?? cloud.current()?.doc
    if (doc) cloud.unbind(doc)
    hostRef.current.afterHostClosed?.()
  }, [cloud])
  /** 关一个云档分页（别的云档分页还在）前先存回去；存不成（断网、还没绑档…）才问要不要丢 */
  const beforeCloseTab = useCallback(async (doc: string): Promise<boolean> => {
    const tab = cloud.get(doc)
    if (!tab || !tab.auto.dirty) return true
    if ((await tab.auto.flush()).ok) return true
    return window.confirm(t('drawboard_close_unsaved_confirm'))
  }, [cloud, t])
  /** 起好时那份开不到 ⇒ 记下种类（页面改画整页明说）·放掉画板本体（site＝null ⇒ 命令中继停、存档／另存口拿不到画板＝角色也动不了手） */
  const urlFailed = useCallback((k: PaintLoadFail) => { setUrlFail(k); setSite(null) }, [])
  const exportPsd = useCallback(async (name?: string): Promise<Record<string, unknown>> => {
    const s = siteRef.current
    if (!s) return { ok: false, error: 'not_ready' }
    say(t('drawboard_exporting'), 60_000)
    try {
      const blob = psdBlob(s)
      const r = await hostRef.current.api.upload(blob, exportPngName(projRef.current?.title || t('drawboard_untitled'), 1, name?.replace(/\.psd$/i, '')).replace(/\.png$/, '.psd'), projRef.current?.folder_id ?? null)
      if (!r.ok) { say(t('drawboard_export_failed') + errText(r.err), 6000); return { ok: false, error: r.err.code ?? r.err.error } }
      say(t('drawboard_exported') + r.name, 5000)
      hostRef.current.driveChanged?.()
      return { ok: true, id: r.id, name: r.name, bytes: blob.size }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      say(t('drawboard_export_failed') + m, 6000)
      return { ok: false, error: m }
    }
  }, [say, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const handlers = useRef({ save, saveCopy, openFromDrive, exportPng, exportPsd, setTab, say, t, dropDrive, docLock, cloud, detach, beforeCloseTab, urlFailed })
  handlers.current = { save, saveCopy, openFromDrive, exportPng, exportPsd, setTab, say, t, dropDrive, docLock, cloud, detach, beforeCloseTab, urlFailed }

  // ── 画板起好：装品牌／左栏／命令／改了没存·开起好时那份 ──
  const [rect, setRect] = useState<Rect | null>(null)
  const rectRef = useRef<Rect | null>(null)
  const [popupHidden, setPopupHidden] = useState(false)
  useEffect(() => {
    const s = site
    const doc = frameRef.current?.contentDocument
    const win = frameRef.current?.contentWindow as (Window & typeof globalThis) | null | undefined
    if (!s || !doc || !win) return
    const h0 = hostRef.current
    installChrome(doc, h0.chrome(handlers.current.t))
    installCommands(s, {
      save: () => handlers.current.save(),
      open: (p) => {
        if (p.id) return handlers.current.openFromDrive(p.id)
        handlers.current.setTab('drive'); handlers.current.say(handlers.current.t('drawboard_open_hint'), 5000)
        return { ok: true, opened: false }
      },
      exportPng: (scale, name) => handlers.current.exportPng(scale, name),
      exportPsd: (name) => handlers.current.exportPsd(name),
      // 宿主那份被关掉换成空白图 ⇒ 解开和原档的绑定（⛔ 自动存把空白图写回原档）·之后要存＝另建一份
      hostClosed: () => handlers.current.detach(),
      saveCopy: (name) => handlers.current.saveCopy(name),
      // 没有建档（游客版、单机版·没有云盘）⇒ 命令说明照实说存进工程／下载，不说云端硬碟
      where: h0.api.create ? 'drive' : 'local',
    })
    // 宿主自己要装的（登入版：桌面版画板「列印」改走主页面 print）
    h0.install?.(s, win)
    // 画板分页列的每个云档分页各绑一份档（页面起好时那个分页先登记·还没绑档）；分页切了／关了跟着换「现在这份」
    const tabs = s.Tabs
    const hc = handlers.current
    hc.cloud.adopt(tabs?.activeId() ?? 'main')
    installCloudTabs(s, {
      isCloud: (d) => !!handlers.current.cloud.get(d),
      beforeClose: (d) => handlers.current.beforeCloseTab(d),
      closed: (d) => handlers.current.cloud.remove(d),
      switching: () => handlers.current.cloud.switching,
      // 多页：关一份多页档＝所有页一起关（先存）·人手按 × 先问一句
      pagesOf: (d) => handlers.current.cloud.pagesOf(d),
      confirmCloseFile: (n) => window.confirm(handlers.current.t('drawboard_close_file_confirm').replace(/\{n\}/g, String(n))),
    })
    // 多页命令 page.*（加页、切页、改名、删页、并入别份）·人手从分页列「＋」／右键进来带 ui:true
    installPageCommands(s, {
      cloud: () => handlers.current.cloud,
      prompt: (msg, def) => window.prompt(msg, def),
      confirm: (msg) => window.confirm(msg),
      text: (k, n, name) => k === 'name'
        ? handlers.current.t('drawboard_page_name_prompt').replace(/\{n\}/g, String(n))
        : handlers.current.t('drawboard_page_delete_confirm').replace(/\{n\}/g, String(n)).replace(/\{name\}/g, name ? `「${name}」` : ''),
    })
    const onDocs = () => handlers.current.cloud.sync()
    win.addEventListener('dl:docs', onDocs)
    watchDirty(s, () => handlers.current.cloud.change())
    const offDrop = h0.installDrop ? h0.installDrop(doc, s, (item, at) => handlers.current.dropDrive(item, at)) : () => {}
    setLeft(doc, s, layoutRef.current.tab, layoutRef.current.driveW)
    // 左栏位置跟着画板版面走（工具栏单／双栏、视窗变大小）；画板弹出来的东西压到左栏 ⇒ 把盖在上面的元件暂时藏起来
    // （⛔ requestAnimationFrame：分页在背景时不跑·新分页一开就量不到）
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const r = leftRect(doc)
        rectRef.current = r
        setRect((prev) => (prev && r && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height ? prev : r))
        // 只看真被盖住的那块：云盘页签＝整条左栏；工具页签＝顶上那条页签
        setPopupHidden(!!r && popupOver(doc, layoutRef.current.tab === 'drive' ? r : { ...r, height: TAB_STRIP_H }))
      }, 16)
    }
    const ro = new win.ResizeObserver(measure)
    const left = doc.getElementById('dlLeft')
    if (left) ro.observe(left)
    ro.observe(doc.documentElement)
    const mo = new win.MutationObserver(measure)
    if (doc.body) mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    measure()
    // 起好时那份只在画板起好时开一次（⛔ 跟着语言变又重开一次·会冲掉没存的改动）
    const id = h0.initialId()
    // 编号格式不对 ⇒ 不读·整页明说；开不到（找不到／没登入／一时失败）⇒ 按回应码整页明说·⛔ 留一张空白画板
    lastLoadErrRef.current = null
    if (id && !h0.isId(id)) hc.urlFailed('bad_id')
    else if (id) void hc.docLock.run(() => hc.cloud.open(id, { here: true }))   // 同排那把锁：载档的中间⛔ 让角色的活落在半载的那份·载进页面刚起时那个分页
      .then((r) => { if (r.ok && !r.value.ok) handlers.current.urlFailed(hostRef.current.loadFail(r.value.error === 'load_failed' ? lastLoadErrRef.current?.status ?? null : null)) },
        () => handlers.current.urlFailed(hostRef.current.loadFail(null)))
    return () => { ro.disconnect(); mo.disconnect(); clearTimeout(timer); offDrop(); win.removeEventListener('dl:docs', onDocs) }
  }, [site])

  // 语言跟着页面走（画板菜单、工具名也换）
  useEffect(() => {
    const doc = frameRef.current?.contentDocument
    if (!site || !doc) return
    applyLanguage(site, language, { hideLangSel: isSimplifiedSite() })
    installChrome(doc, hostRef.current.chrome(t))
  }, [site, language, t])

  // Desktop app: save before the tab closes (shared/desktop-before-close) — unsaved edits go out on the autosave queue
  useEffect(() => registerDesktopBeforeClose(async () => { const tab = cloud.current(); if (tab && tab.proj && (tab.auto.dirty || cloud.busy)) await tab.auto.flush() }), [cloud])
  // 页面的 flush／重读交给宿主（游客版：外框汇出／换存放位置前先存、外面改了档要重读）
  useEffect(() => {
    const h = hostRef.current
    if (!h.connect) return
    h.connect({
      flush: async () => { const tab = cloud.current(); if (tab && tab.proj && tab.auto.dirty) { const r = await tab.auto.flush(); if (!r.ok) throw new Error(r.err.code ?? r.err.error ?? `HTTP ${r.err.status}`) } },
      reload: async () => { const tab = cloud.current(); if (tab && tab.proj) await docLock.cut(() => cloud.reload(tab.doc)) },
    })
    return () => { h.connect?.(null) }
  }, [cloud, docLock])

  // 标签／云盘宽度 ⇒ 画板左栏
  useEffect(() => {
    const doc = frameRef.current?.contentDocument
    if (site && doc) setLeft(doc, site, layout.tab, layout.driveW)
  }, [site, layout.tab, layout.driveW])
  useEffect(() => { if (layout.tab === 'drive' && gate === 'ok') hostRef.current.onDriveTab?.() }, [layout.tab, gate])

  // 画板同源时把视窗面板放进本页 <body> 尾巴（data-dl-panels 图层·z-index 盖过对话栏）。
  // 离开画板页（React 拆 iframe）⇒ 先叫画板收回、再把外层残留图层清掉（画板自己也会在 pagehide 清·这里保险）。
  useEffect(() => {
    if (!site) return
    return () => {
      try { (site.doc?.defaultView as (Window & { DilinCanvas?: { panels?: { detach?: () => void } } }) | null | undefined)?.DilinCanvas?.panels?.detach?.() } catch { /* 画板已拆 */ }
      document.querySelectorAll('[data-dl-panels]').forEach((n) => n.remove())
    }
  }, [site])

  // 浏览器分页之间互报「存成了哪版」·别页存了同一份 ⇒ 本页记 stale、挡旧基准的自动存；
  //   也互报「正在存」（cloud.remoteSaving）⇒ 接手那页知道别页那发还在路上、先等它落地再拉；
  //   转背景那一刻报「这份马上存」（cloud.remoteLeaving）⇒ 一变前台的那页当场挡手（⛔ 等中继回包那 0.3～1 秒）
  useEffect(() => {
    const ch = openSavedChannel((id, at, info) => { cloud.remoteSaved(id, at, info) }, undefined, (id, on) => { cloud.remoteSaving(id, on) }, (id, on) => { cloud.remoteLeaving(id, on) })
    savedChan.current = ch
    return () => { savedChan.current = null; ch.close() }
  }, [cloud])

  // 改了没存（或正在存）就要关页 ⇒ 浏览器问一声；切到别的分页／缩到背景 ⇒ 马上存（不等停手那几秒）
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (cloud.dirty || cloud.busy) { e.preventDefault(); e.returnValue = '' } }
    // 转背景（hidden·同步）：有没存的改动／正在存 ⇒ 先经频道报别页「马上存」再存·存完报完（cloud.leaveDirty）
    const vis = () => {
      if (document.visibilityState !== 'hidden' || !(cloud.dirty || cloud.busy)) return
      cloud.leaveDirty({ leave: (id) => savedChan.current?.leaving(id, true), done: (id) => savedChan.current?.leaving(id, false) })
    }
    window.addEventListener('beforeunload', h)
    document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('beforeunload', h); document.removeEventListener('visibilitychange', vis) }
  }, [cloud])
  // 起好时那份开不到 ⇒ 页上整页明说的那句（下面 urlFail 那段同用这一句）·分页标题也跟着换成它
  const urlFailTitle = urlFail === null ? null : urlFail === 'login' ? t('myst_login_required') : urlFail === 'bad_id' ? t('drawboard_bad_id') : urlFail === 'not_found' ? t('drawboard_not_found') : t('drawboard_open_failed')
  useEffect(() => { document.title = hostRef.current.tabTitle(urlFailTitle, proj?.title || t('drawboard_untitled'), t) }, [urlFailTitle, proj?.title, t])

  // ── 两条拖拉条 ──
  const onSplitDown = useCallback((which: 'drive' | 'chat') => (e: ReactPointerEvent) => {
    const start = layoutRef.current
    startDrag(e, {
      frames: [frameRef.current],
      onMove: (dx) => setLayout(dragLayout(start, which, dx, window.innerWidth)),
      onEnd: () => saveLayout(layoutRef.current),
    })
  }, [saveLayout])

  // ── 左栏云盘那格（宿主给内容）──
  const driveAll = layout.driveAll
  const setDriveAll = useCallback((on: boolean) => patchLayout({ driveAll: on }), [patchLayout])
  const openFile = useCallback((id: string) => { void openFromDriveUser(id) }, [openFromDriveUser])

  // ── 右边对话栏（宿主给内容）──
  const projId = proj?.id ?? null, projTitle = proj?.title ?? null
  const chatPane = useMemo(() => host.renderChatSlot({
    dense: true, title: t('drawboard_chat_title'), placeholder: t('drawboard_chat_placeholder'),
    proj: projId ? { id: projId, title: projTitle ?? '' } : null, roleHooks: roleHooksRef,
    titleIcon: <PanelCollapseButton side="right" onCollapse={() => patchLayout({ chatCollapsed: true })} title={t('drawboard_chat_collapse')} testId="drawboard-chat-collapse" />,
  }), [host, t, patchLayout, projId, projTitle])

  if (gate === 'checking') return <div className="h-screen bg-neutral-900" data-testid="drawboard-gate-checking" />
  if (gate === 'no') return <>{host.renderGateClosed(t)}</>
  // 起好时那份开不到 ⇒ 整页明说·⛔ 画画板（屏上没有可动手的地方·存档建新档那条走不到）
  if (urlFail) return <>{host.renderLoadFail({ kind: urlFail, title: urlFailTitle ?? '', t })}</>

  // 工具栏双栏才 78px 宽：放不下「图示＋字」⇒ 只放字（单栏 46px 再窄 ⇒ 只放图示·字在滑过提示里）
  const tabW = rect?.width ?? 0
  const tabIcon = tabW >= 110 || tabW < 64
  const tabText = tabW >= 64
  const tabBtn = (tab: DrawboardTab) => {
    const on = layout.tab === tab
    return (
      <button key={tab} type="button" data-testid={`drawboard-tab-${tab}`} aria-pressed={on}
        title={tab === 'drive' ? host.driveSlotLabel ?? t('drawboard_tab_drive_title') : t('drawboard_tab_tools_title')}
        onClick={() => setTab(tab)}
        className={`flex-1 min-w-0 flex items-center justify-center gap-1 text-[11px] leading-none border-b-2 transition-colors ${on ? 'text-[#ffffff] border-sky-500 bg-neutral-800' : 'text-neutral-400 border-transparent hover:text-neutral-200 hover:bg-neutral-800/60'}`}>
        {tabIcon && (tab === 'drive'
          ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0"><path d="M5.5 16a3.5 3.5 0 0 1-.369-6.98 4 4 0 1 1 7.753-1.977A4.5 4.5 0 1 1 13.5 16h-8Z" /></svg>
          : <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0"><path fillRule="evenodd" d="M14.5 2a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 14.5 2ZM3.06 15.88l7.6-7.6 1.06 1.06-7.6 7.6a.75.75 0 1 1-1.06-1.06Z" clipRule="evenodd" /></svg>)}
        {tabText && <span className="truncate">{tab === 'drive' ? host.driveSlotLabel ?? t('drawboard_tab_drive') : t('drawboard_tab_tools')}</span>}
      </button>
    )
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#1e1e1e]" data-testid="drawboard-page" data-host={host.kind}>
      {/* 画板（iframe）＋盖在它左栏上的页签与云盘那格 */}
      <div className="relative flex-1 min-w-0 h-full">
        <iframe ref={frameRef} src={DRAWBOARD_APP_SRC} onLoad={onFrameLoad} title="drawboard" data-testid="drawboard-frame"
          className="absolute inset-0 w-full h-full border-0 block" />
        {site && rect && (
          <div data-testid="drawboard-left-overlay"
            className="absolute z-10 flex flex-col bg-[#262626] border-r border-[#333]"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: layout.tab === 'drive' ? rect.height : TAB_STRIP_H, visibility: popupHidden ? 'hidden' : 'visible' }}>
            <div className="flex shrink-0" style={{ height: TAB_STRIP_H }}>
              {tabBtn('drive')}
              {tabBtn('tools')}
            </div>
            {layout.tab === 'drive' && (
              <div className="flex-1 min-h-0" data-testid="drawboard-drive-pane">
                {host.renderDriveSlot({ variant: 'dark', currentId: proj?.id ?? null, driveAll, setDriveAll, openFile, placeImage, say })}
              </div>
            )}
            {layout.tab === 'drive' && (
              <div role="separator" aria-orientation="vertical" title={t('drawboard_resize')} data-testid="drawboard-drive-resize"
                onPointerDown={onSplitDown('drive')}
                className="absolute top-0 -right-1 w-2 h-full cursor-col-resize hover:bg-sky-500/40 active:bg-sky-500/60" />
            )}
          </div>
        )}
        {(loading || notice) && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-8 z-20 px-3 py-1.5 rounded-md bg-neutral-800/95 border border-neutral-700 text-xs text-neutral-100 shadow-lg pointer-events-none" data-testid="drawboard-notice">
            {loading ? t('drawboard_loading') : notice}
          </div>
        )}
        {/* 别的分页存过新版 ⇒ 「有新版·載入」；有没存的改动／按了存档 ⇒ 「套用最新版／保留我的」 */}
        {stale && (
          // 画板那格窄（对话栏拉宽）时 left-1/2 绝对定位的条只剩右半宽 ⇒ 字一字一行、钮被挤扁。
          //   ⇒ 宽度按内容（w-max）但不超过那格（max-w）·放不下时钮整颗换到下一行（flex-wrap·钮不折字）
          <div className="absolute left-1/2 -translate-x-1/2 top-10 z-30 w-max max-w-[calc(100%-1rem)] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 py-1.5 rounded-md bg-sky-950/95 border border-sky-600 text-xs text-neutral-100 shadow-lg" data-testid="drawboard-remote-bar">
            <span className="min-w-0 text-center">{t(stale.ask ? 'drawboard_remote_ask' : 'drawboard_remote_newer')}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-[#ffffff]" data-testid="drawboard-remote-apply" onClick={() => { void loadLatest() }}>
                {t(stale.ask || stale.dirty ? 'drawboard_remote_apply' : 'drawboard_remote_load')}
              </button>
              {(stale.ask || stale.dirty) && (
                <button type="button" className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded border border-sky-400 hover:bg-sky-900" data-testid="drawboard-remote-keep" onClick={() => { void keepMine() }}>{t('drawboard_remote_keep')}</button>
              )}
            </span>
          </div>
        )}
        {/* 角色动手画那一组（同一份在别的分页开着的提示、玻璃罩＋顶上「〈角色〉正在編輯…」）·宿主给（登入版才有） */}
        {host.renderLive?.({ site, enabled: gate === 'ok', frameRef, siteRef, projRef, docLock, cloud, say, roleHooks: roleHooksRef, locked: aiLockedRef, staleShown: !!stale })}
      </div>
      {/* 图层面板（iframe 右缘）与对话栏之间的拖拉条 */}
      {!layout.chatCollapsed && (
        <div role="separator" aria-orientation="vertical" title={t('drawboard_resize')} data-testid="drawboard-chat-resize"
          onPointerDown={onSplitDown('chat')}
          className="w-1.5 shrink-0 h-full cursor-col-resize bg-[#333] hover:bg-sky-500/50 active:bg-sky-500/70" />
      )}
      {/* 收起＝只藏不拆（打到一半的字、选的角色都留着） */}
      <div className={`shrink-0 h-full min-h-0 flex-col overflow-hidden ${layout.chatCollapsed ? 'hidden' : 'flex'}`} style={{ width: layout.chatW }} data-testid="drawboard-chat">
        {chatPane}
      </div>
      {layout.chatCollapsed && (
        <PanelCollapsedEdge side="right" onExpand={() => patchLayout({ chatCollapsed: false })} title={t('drawboard_chat_expand')} testId="drawboard-chat-collapsed" />
      )}
    </div>
  )
}
