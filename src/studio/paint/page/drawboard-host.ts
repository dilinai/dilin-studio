// 画板页的「接线层」：画板页（DrawboardPage.tsx）跟同源 iframe 里的画板本体（/drawboard-app/·⛔ 改它）之间那一层。
//   只碰 DOM·不碰 React、不打网络（登入版要后端的那几样——工程档口、云盘上传、云盘放图、角色中继、桌面版列印——
//   留在网站那边，经宿主进来）。登入版与游客版共用这一份。
//   画板把 CMD／UI／Lang… 收成 window.__dlSite（site-bridge.js）⇒ 这里：
//     ① 改四条命令：file.saveProject＝存档（宿主决定存去哪）；file.openProject＝开档；file.exportPNG／exportPNG2x＝导出；
//        file.exportSVG 照旧下载。命令还是同一个 id ⇒ 菜单、Ctrl+S、agent 走的都是新的。
//     ② 菜单列最左「堤麟画板」前加品牌图标＋名字·点了回宿主给的首页。
//     ③ 左栏包一层：上面一条页签（云盘｜工具·画板页的元件盖在这条上）＋工具栏＋云盘那格占位。
//     ④ 改了没存（dirty）：包 History.push／undo／redo；④b 自动存；云档分页、多页命令、分页之间互报存档。
//   ⛔ 用 @/ 别名（单测直接按相对路径载）。
import { DRAWBOARD_FORMAT, DRAWBOARD_PAGES_MAX, defaultPageName, drawboardPageLabel, joinDrawboardPages, splitDrawboardPages, type DrawboardProject } from './drawboard-file.pure'
import type { DrawboardTab } from './drawboard-layout.pure'
import { FOLD_CLASS, MORE_ID, MORE_KEY, NARROW_CSS, NARROW_STYLE_ID, moreTitle, planMenubar, statusTier } from './drawboard-narrow.pure'

type Params = Record<string, unknown>
/** 负控开关（只在 node 测试跑·正式页面恒 false）：环境变量 DILIN_NEG 含处名 ⇒ 退回修前行为 */
function neg(site: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return !!env?.DILIN_NEG && env.DILIN_NEG.split(',').includes(site) && typeof window === 'undefined'
}
export type DlCmd = { id: string; run: (p: Params) => unknown; i18n?: string; params?: string; undoable?: boolean }
export type DlSite = {
  CMD: { map: Record<string, DlCmd>; reg(id: string, meta: Params, fn: (p: Params) => unknown): void; run(id: string, p?: Params): unknown }
  UI: { draw(): void; fit(): void; refresh(): void; canvas?: HTMLCanvasElement; zoom?: number } | null
  Lang: { cur: string; set(l: string): void } | null
  /** serializeAsync({reuse:true})＝增量序列化（像素层没改就沿用上次编好的 dataURL·编码间让出主线程）·旧画板没有 ⇒ 退回 serialize */
  Project: { serialize(): unknown; serializeAsync?(opts?: { reuse?: boolean }): Promise<unknown>; load(json: unknown): Promise<void> }
  /** 歷史動作所屬頁是否為雲檔宿主；舊 bridge 未提供時保留原通知。 */
  isHostActive?: () => boolean
  History: { push(): void; undo(): boolean; redo(): boolean; clear(): void; past: unknown[] }
  composite: ((scale: number) => HTMLCanvasElement) | null
  /** serial＝画板自己的文件序号（每开／新建一份 +1·各分页各记各的）·网站这层只读来比对（等图的中间换了分页 ⇒ 画板本体丢掉晚到的图）
   *  layers＝前面那份的图层（只读来看载档后像素层的画布多大·判旧格式） */
  Doc?: { width: number; height: number; serial?: number; layers?: Array<{ id?: unknown; kind?: unknown; data?: { canvas?: { width: number; height: number } | null } | null }> } | null
  /** 画板分页列（上游 Docs）给宿主用的接口（site-bridge.js）·旧画板没有 ⇒ null */
  Tabs?: DlTabs | null
  /** 接线档没给·siteOf 补上（画板那份 document） */
  doc?: Document
}
/** 画板分页列（site-bridge.js 的 Tabs）：云档分页一律挂上游的 host 旗标（可不只一份）·上游自己开的照旧是暂存分页 */
export type DlTabs = {
  activeId(): string | null
  has(id: string): boolean
  ids(): string[]
  /** 分页序号或 id ⇒ id */
  resolve(ref: string | number): string | null
  activate(id: string): boolean
  host(id: string, on: boolean): void
  /** 不在前面那份收起时留的工程档（在前面＝null） */
  json(id: string): unknown | null
  /** 新分页载入一份云档（空档＝白底；bg＝null 透明）⇒ 分页 id */
  open(json: unknown, name: string, bg?: string | null): Promise<string>
  /** 前面那份的分页名 */
  name(name: string): void
  /** 多页：改任一分页的名字（收起的也改） */
  label?(id: string, name: string): boolean
  /** 多页：静静拿掉一个分页（删一页）⇒ 拿掉了回 true */
  close?(id: string): Promise<boolean>
}
type DlWindow = Window & { __dlSite?: DlSite; __dlSiteReady?: boolean }

/** iframe 里的画板起好了没（接线档在 DOMContentLoaded 挂 __dlSiteReady） */
export function siteOf(frame: HTMLIFrameElement | null): DlSite | null {
  const w = frame?.contentWindow as DlWindow | null | undefined
  try {
    if (!(w && w.__dlSiteReady && w.__dlSite && w.__dlSite.CMD)) return null
    // 分页列（docs.js）在 window load 才登记第一个分页 ⇒ 还没有就当没起好（⛔ 网站拿不到分页 id 登记云档分页）
    if (w.__dlSite.Tabs && !w.__dlSite.Tabs.activeId()) return null
    w.__dlSite.doc = w.document
    return w.__dlSite
  } catch { return null }
}

/** 网站语言 ⇒ 画板语言（画板 i18n.js 用 zh-Hant／zh-Hans／en） */
export const SITE_LANG: Record<'zh-TW' | 'zh-CN' | 'en', string> = { 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans', en: 'en' }
export function applyLanguage(site: DlSite, lang: 'zh-TW' | 'zh-CN' | 'en', opts?: { hideLangSel?: boolean }): void {
  const want = SITE_LANG[lang]
  if (site.Lang && site.Lang.cur !== want) site.Lang.set(want)
  // 画板右上那个语言下拉（Lang.set 不会顺手改它）跟着显示现在的语言
  const sel = site.doc?.getElementById('langSel') as HTMLSelectElement | null | undefined
  if (sel && sel.value !== want) sel.value = want
  // 陆站只出简体：语言下拉藏起来（台站／英文照旧显示）
  if (sel && opts?.hideLangSel) sel.style.display = 'none'
}

// ── ① 命令 ────────────────────────────────────────────────────────────────────────
export type HostHandlers = {
  save: () => Promise<Params>
  open: (p: { id?: string }) => Promise<Params> | Params
  /** name＝角色／呼叫方指定的档名（⛔ 吞掉它改用画板名）·没给＝画板名 */
  exportPng: (scale: number, name?: string) => Promise<Params>
  /** 存档、汇出落在哪：drive＝云盘（登入版）；local＝这份工程／这台电脑（游客版、单机版·没有云盘）。没给＝drive。
   *  只影响命令说明（AI 读 paint_list_commands 看到的那句），免得单机版说「存进云端硬碟」 */
  where?: 'drive' | 'local'
  /** 宿主那份被「檔案▸關閉／關閉全部」换成空白新图、或被「開啟為」换成另一张图后叫（见 installHostClose）·没给＝不装 */
  hostClosed?: () => void
  /** 「存储副本」（ps.file.saveACopy／ai.file.saveCopy）存工程档 ⇒ 在云盘另建一份（⛔ 写回原档）·现在这页仍绑原档 */
  saveCopy?: (name?: string) => Promise<Params>
  /** 分层 PSD 交给宿主（登入版存进云盘同资料夹；游客版下载）·没给 ⇒ PSD 照画板原本那支（下载） */
  exportPsd?: (name?: string) => Promise<Params>
}
/** 存储副本那两条命令（上游存 .dlcanvas 时都转叫 file.saveProject {name}——网站那支原本不看 name、直接写回原档） */
export const SAVE_COPY_CMDS = ['ps.file.saveACopy', 'ai.file.saveCopy'] as const
/** 网站版换掉的命令（id 不变·菜单与快捷键照旧点得到） */
export const OVERRIDDEN_CMDS = ['file.saveProject', 'file.openProject', 'file.exportPNG', 'file.exportPNG2x'] as const
export function installCommands(site: DlSite, h: HostHandlers): void {
  const meta = (id: string, params: string): Params => ({ i18n: site.CMD.map[id]?.i18n ?? '', params })
  // 存储副本跑着的时候（copying>0）上游转叫的 file.saveProject {name} ⇒ 另建一份（⛔ 写回原档）
  let copying = 0
  const local = h.where === 'local'
  site.CMD.reg('file.saveProject', meta('file.saveProject', local
    ? '{} 存進這份工程（選了資料夾＝寫回資料夾裡的 project.json；還沒選＝存在這個瀏覽器；所有頁一起存）→ {ok}'
    : '{} 存进雲端硬碟（這份畫板的 .dlcanvas，所有頁一起存）→ {ok, id, bytes}'), (p) =>
    copying > 0 && h.saveCopy ? h.saveCopy(typeof p?.name === 'string' && p.name.trim() ? p.name : undefined) : redrawTabsAfter(site, h.save()))
  if (h.saveCopy) for (const id of SAVE_COPY_CMDS) {
    const orig = site.CMD.map[id]
    if (!orig || (orig as DlCmd & { __dlCopy?: boolean }).__dlCopy) continue
    const m: Params = { ...orig, __dlCopy: true }
    delete m.id; delete m.run
    site.CMD.reg(id, m, (p) => {
      // 存储副本选 PSD（没挑本机档位置）⇒ 交宿主（登入版进云盘）·⛔ 走画板原本的下载
      if (h.exportPsd && String(p?.format ?? '').toLowerCase().replace(/^\./, '') === 'psd' && !p?._handle) return h.exportPsd(typeof p?.name === 'string' && p.name.trim() ? p.name : undefined)
      copying++
      let r: unknown
      try { r = orig.run.call(orig, p) } catch (e) { copying--; throw e }
      if (r && typeof (r as Promise<unknown>).then === 'function') return (r as Promise<unknown>).finally(() => { copying-- })
      copying--
      return r
    })
  }
  site.CMD.reg('file.openProject', meta('file.openProject', local
    ? '{} 切到左邊的工程清單，讓使用者點要開哪一份'
    : '{id?} 從雲端硬碟開一份畫板（id＝.dlcanvas 的雲端硬碟檔 id；不給＝切到左邊雲端硬碟頁籤讓人點）'), (p) => h.open({ id: typeof p.id === 'string' ? p.id : undefined }))
  site.CMD.reg('file.exportPNG', meta('file.exportPNG', local
    ? '{scale=1, name?} 匯出 PNG，由瀏覽器下載到這台電腦（name＝檔名，不給＝畫板名）→ {ok, name}'
    : '{scale=1, name?} 匯出 PNG 存進雲端硬碟（跟這份畫板同一個資料夾；name＝檔名，不給＝畫板名）→ {ok, id, name, width, height, bytes}'), (p) => h.exportPng(typeof p.scale === 'number' && p.scale > 0 ? p.scale : 1, typeof p.name === 'string' && p.name.trim() ? p.name : undefined))
  site.CMD.reg('file.exportPNG2x', meta('file.exportPNG2x', local ? '{} 兩倍大匯出 PNG，由瀏覽器下載到這台電腦' : '{} 兩倍大匯出 PNG 存進雲端硬碟'), () => h.exportPng(2))
  const ep = h.exportPsd
  if (ep) site.CMD.reg('file.exportPSD', { i18n: '', params: '{name?} 匯出分層 PSD（Photoshop 每層都在）存進雲端硬碟（跟這份畫板同一個資料夾；name＝檔名，不給＝畫板名）→ {ok, id, name, bytes}', undoable: false }, (p) => ep(typeof p?.name === 'string' && p.name.trim() ? p.name : undefined))
  installHostSave(site)
  if (h.hostClosed) installHostClose(site, h.hostClosed)
}

/** 宿主那份（云盘开的 .dlcanvas）按「檔案▸關閉／關閉全部」⇒ 画板把宿主换成一张空白新图（closeNow → file.new），
 *  网站这层却还绑着原云盘档 ⇒ 之后在空白图上画一笔，自动存就把「空白＋那一笔」写回原档、原图被盖掉（选「不儲存」也一样）。
 *  ⇒ 包 ps.file.close／ps.file.closeAll：关的是宿主那份且真关了（没按取消）⇒ 叫 onClosed 解绑（之后要存＝另建一份）。
 *  关的是暂存／子分页（宿主没被换）⇒ 不动。包在画板多文件层（docs.js 改 .run）之外或之内都成立：只看关前宿主在不在前台与回包。
 *  「檔案▸開啟為」（ps.file.openAs：菜单 {ui:true} 先挑档再问存不存；agent／WIA「開成文件」直叫）同样就地换掉目前这份
 *  ⇒ 宿主在前台、真换了（没取消挑档、没在「要不要存」按取消、没回 ok:false）⇒ 一样叫 onClosed 解绑（⛔ Ctrl+S／自动存把新开的图写回原云盘档）。
 *  「開啟舊檔」（ps.document.open）是先开新分页再在里头叫 ps.file.openAs ⇒ 那时前台是新分页（不是宿主）⇒ 不解绑。 */
export const HOST_CLOSE_CMDS = ['ps.file.close', 'ps.file.closeAll'] as const
export const HOST_OPEN_AS_CMD = 'ps.file.openAs'
export function installHostClose(site: DlSite, onClosed: () => void): void {
  for (const id of [...HOST_CLOSE_CMDS, HOST_OPEN_AS_CMD]) {
    const orig = site.CMD.map[id]
    if (!orig || (orig as DlCmd & { __dlHostClose?: boolean }).__dlHostClose) continue
    const meta: Params = { ...orig, __dlHostClose: true }
    delete meta.id; delete meta.run
    site.CMD.reg(id, meta, (p) => {
      // 关闭全部最后一定换掉宿主；单关／开启为只在宿主在前台时换掉它（叫的当下取样·挑档期间不会切分页）
      const hostHit = id === 'ps.file.closeAll' || site.isHostActive?.() !== false
      const done = (r: unknown) => {
        const x = r as { ok?: boolean; cancelled?: boolean } | null | undefined
        if (hostHit && !(x && (x.cancelled || x.ok === false))) onClosed()
        return r
      }
      const r = orig.run.call(orig, p)
      return r && typeof (r as Promise<unknown>).then === 'function' ? (r as Promise<unknown>).then(done) : done(r)
    })
  }
}

/** 存档是异步的——画板分页条只在 CMD.run 同步回来后排一次重画（docs.js Docs._schedule·60ms），
 *  存档回来、afterSaved 记「存过」时分页早画完了 ⇒ 分页名后的「*」要等下一个命令才消。
 *  ⇒ 存档 resolve／失败后再排一次：本 then 先跑、afterSaved 的记「存过」紧接（微任务），60ms 后重画时已是存过。 */
export function redrawTabsAfter<T>(site: DlSite, r: Promise<T>): Promise<T> {
  const redraw = () => { try { (site.doc?.defaultView as (Window & { Docs?: { _schedule?: () => void } }) | null | undefined)?.Docs?._schedule?.() } catch { /* 画板已卸 */ } }
  return r.then(v => { redraw(); return v }, e => { redraw(); throw e })
}

/** 自动存存成了、存的就是现在画面上这份（没有再改）⇒ 告诉画板「这份存过了」并重画分页列：
 *  分页名后的「*」看画板自己的 PsFile.isDirty()，只有 Ctrl+S 那条（画板的 file.saveProject 包装）会标存过——
 *  自动存走宿主自己的 PUT，不标 ⇒ 顶栏写「已儲存」、分页还挂着「*」。 */
export function markEngineSaved(site: DlSite | null): void {
  try {
    const w = site?.doc?.defaultView as (Window & { PsFile?: { markSaved?: () => void }; Docs?: { _schedule?: () => void } }) | null | undefined
    w?.PsFile?.markSaved?.()
    w?.Docs?._schedule?.()
  } catch { /* 画板已卸 */ }
}

/** PS 菜单「儲存檔案」／Ctrl+S（ps.file.save {ui:true}）在有 showSaveFilePicker 的浏览器（Chrome／Edge）会先开系统「另存新檔」只写本机
 *  ——画板 fsaOK() 只认 file.exportData 有没有被换，网站没换它（换了会把转存／存储副本／图层导出全改道）。
 *  ⇒ 只包 ps.file.save 的界面分支：现在这页是宿主（云盘那份）、也不在编辑智能对象内容 ⇒ 改跑 file.saveProject（＝存回云盘·出「已存進雲端硬碟」）；
 *     暂存分页／智能对象子页／agent 直叫（没 ui）照画板原本那支。本地独立版没有宿主 ⇒ 不装这层、行为不变。 */
export const HOST_SAVE_CMD = 'ps.file.save'
export function installHostSave(site: DlSite): void {
  const orig = site.CMD.map[HOST_SAVE_CMD]
  if (!orig || (orig as DlCmd & { __dlHostSave?: boolean }).__dlHostSave) return
  const upstream = orig.run
  const meta: Params = { ...orig, __dlHostSave: true }
  delete meta.id; delete meta.run
  site.CMD.reg(HOST_SAVE_CMD, meta, (p) => {
    const win = site.doc?.defaultView as (Window & { Smart?: { session?: unknown } }) | null | undefined
    const cloud = p?.ui === true && site.isHostActive?.() !== false && !win?.Smart?.session
    return cloud ? site.CMD.run('file.saveProject', {}) : upstream(p)
  })
}

/** 压平成 PNG（矢量层按 scale 重画）；画布被跨源图污染 ⇒ 抛 Error('tainted') */
export async function canvasPng(site: DlSite, scale: number): Promise<{ blob: Blob; width: number; height: number }> {
  if (!site.composite) throw new Error('no composite')
  const c = site.composite(scale)
  const blob = await new Promise<Blob | null>((res, rej) => { try { c.toBlob(res, 'image/png') } catch (e) { rej(e) } })
    .catch((e: unknown) => { throw (e instanceof Error && e.name === 'SecurityError') ? new Error('tainted') : e })
  if (!blob) throw new Error('empty')
  return { blob, width: c.width, height: c.height }
}

// ── ④ 改了没存 ───────────────────────────────────────────────────────────────────
/** 引擎照 PS：layer.set 只带 id／visible（图层面板点眼睛）不进历史、不占一步 Ctrl+Z（engine.js CMD._run 那条例外） */
export function isVisibilityOnly(id: string, p: Params | undefined): boolean {
  return id === 'layer.set' && !!p && 'visible' in p && Object.keys(p).every((k) => k === 'id' || k === 'visible')
}

export function watchDirty(site: DlSite, onChange: () => void): void {
  // 只切可见不进历史 ⇒ 下面包 History 收不到 ⇒ 那条命令跑成了另报一次（不然点眼睛等多久都不存·要等下一笔别的改动才连带存进去）
  const C = site.CMD as DlSite['CMD'] & { __dlVisWrapped?: boolean }
  if (!C.__dlVisWrapped) {
    C.__dlVisWrapped = true
    const run0 = C.run.bind(C)
    C.run = (id: string, p?: Params) => {
      if (!isVisibilityOnly(id, p)) return run0(id, p)
      const host = site.isHostActive?.() !== false
      const r = run0(id, p)
      const done = (v: unknown) => { if (host && !(v && typeof v === 'object' && (v as Params).ok === false)) onChange() }
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(done, () => {})
      else done(r)
      return r
    }
  }
  const H = site.History as DlSite['History'] & { __dlWrapped?: boolean }
  if (H.__dlWrapped) return
  H.__dlWrapped = true
  for (const k of ['push', 'undo', 'redo'] as const) {
    const orig = H[k].bind(H) as () => unknown
    ;(H as unknown as Record<string, () => unknown>)[k] = () => {
      // 共用 History 也包含暫存頁；只在動作當下通知宿主。
      // 不能到排程存檔時才查：宿主改完切去暫存頁，仍須存下剛才的修改。
      const host = site.isHostActive?.() !== false
      const r = orig()
      if (host) onChange()
      return r
    }
  }
}

// ── ④b 自动存（同文件／表格／简报那一套）──────────────────────────────────────────────
//   同文件／表格／简报那一套：改了停手几秒自动存、同一时刻只一发在飞、存档中又改 ⇒ 存完再补一发（尾值）、标题列显示储存中／已储存。
//   整份 .dlcanvas 一次 PUT（服务端没有「只改某层」的口）·编码走 serializeAsync({reuse:true})：没改的像素层沿用上次编好的、不重编、不卡画面。
//   一张 2K 图整份约 6～10MB ⇒ 停手 AUTOSAVE_DEBOUNCE_MS 才存、两发之间至少 AUTOSAVE_MIN_GAP_MS（连续画不会一笔一传）。
//   409（云端那份被别处改过）／额度满／档太大 ⇒ 自动存停手、标题列明示，等使用者 Ctrl+S 决定（⛔ 自动存默默盖掉别人的版本）；
//   其余失败（断网…）⇒ 过 AUTOSAVE_RETRY_MS 再试。换开别份（begin）⇒ 世代 +1：序列化跨过换档的那发作废（⛔ 新那份的内容写进旧那份）。
export const AUTOSAVE_DEBOUNCE_MS = 3000
export const AUTOSAVE_MIN_GAP_MS = 10_000
export const AUTOSAVE_RETRY_MS = 30_000
/** 开到旧格式档（像素层整张文件大）⇒ 载完停这么久静默存一发换新格式（开档后先让画面、手边的操作走） */
export const AUTOSAVE_UPGRADE_MS = 5000
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'blocked' | 'offline'
export type AutosaveResult = { ok: true; id: string; bytes: number } | { ok: false; err: ApiErr }
/** 这发是「只为换新格式」的静默存档、内容跟 prev 那版一模一样（开档后没改过一笔）——别的分页基准正是 prev ⇒ 直接换基准、⛔ 当成「有新版」 */
export type SavedInfo = { same: true; prev: string | null }
type Put = (id: string, base: string | null, project: unknown) => Promise<{ ok: true; updated_at: string; bytes: number } | { ok: false; err: ApiErr }>
export type AutosaverDeps = {
  /** 这一刻存进哪份（没有＝还没进云盘·自动存不建档） */
  target: () => { id: string; base: string | null } | null
  serialize: () => Promise<unknown>
  put: Put
  /** 存成了：id 那份的新 updated_at（调用侧只在 id 仍是开着那份时更新基准）·info＝换格式那发且内容没变 */
  onSaved: (id: string, updatedAt: string, info?: SavedInfo) => void
  onStatus: (s: AutosaveStatus, err?: ApiErr) => void
  /** 一发真要打出去了（on＝true）／没存成就收场（false·存成走 onSaved）——页面拿来告诉同一份的别的分页「这份正在存、等它落地再拉」 */
  onSending?: (id: string, on: boolean) => void
  debounceMs?: number; minGapMs?: number; retryMs?: number; upgradeMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}
export type Autosaver = {
  /** 画板改了一笔（History push／undo／redo） */
  change(): void
  /** 马上存（Ctrl+S、换档前、切到背景）：等在飞那发、再发最新的；base 给了＝照它覆盖（409 后使用者确认盖掉）；
   *  ifDirty＝轮到它时内容已经存过了（在飞那发就是这些改动）⇒ 不再发（切背景、交出主位各叫一次 ⇒ 只存一发） */
  flush(opts?: { base?: string | null; ifDirty?: boolean }): Promise<AutosaveResult>
  /** 换开别份：开始载之前叫（作废跨过去的那发）、载完再叫一次（新那份算已存） */
  begin(): void
  /** 云端已有更新的版本（别的分页存过）⇒ 本份基准是旧的：自动存停手、不带 base 的 flush 也不发（只有「保留我的」带新基准才发） */
  stale(err: ApiErr): void
  /** 刚载完的是旧格式（载档时像素层被裁小了）⇒ 标「待转新格式」：
   *  有改动要存（自动存／Ctrl+S）那发本来就照新格式存 ⇒ 顺带转好、不多存；开了只看不改 ⇒ 停 upgradeMs 静默存一发（照现在的基准走乐观锁）。
   *  静默那发：⛔ 算没存的改动（dirty 不变·关页不拦）、⛔ 出标题列状态；云端已有更新版（409／别页存过／停手中）⇒ 作罢（⛔ 盖掉、⛔ 出「有新版」）。
   *  on＝false：取消（别的分页已经替这份转好了）。 */
  upgrade(on?: boolean): void
  /** 还待转新格式（还没存成任何一发） */
  readonly upgrading: boolean
  readonly dirty: boolean
  readonly busy: boolean
}
const BLOCKING = new Set(['drawboard_quota', 'drawboard_too_large'])
export function createAutosaver(d: AutosaverDeps): Autosaver {
  const now = d.now ?? (() => Date.now())
  const setT = d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearT = d.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>))
  const debounce = d.debounceMs ?? AUTOSAVE_DEBOUNCE_MS, minGap = d.minGapMs ?? AUTOSAVE_MIN_GAP_MS, retry = d.retryMs ?? AUTOSAVE_RETRY_MS, upgradeMs = d.upgradeMs ?? AUTOSAVE_UPGRADE_MS
  let rev = 0, savedRev = 0, gen = 0, lastEnd = -Infinity, blocked = false, running = 0
  /** 待转新格式（upgrade）·quiet＝正在飞的是只为换格式的静默那发 */
  let upgrading = false, quietNow = false
  let timer: unknown = null
  /** 云端比本份基准新（别页存过／撞过 409）·清掉＝存成或换开别份 */
  let conflict: ApiErr | null = null, lastErr: ApiErr | undefined
  let chain: Promise<unknown> = Promise.resolve()
  const schedule = (ms: number) => {
    if (timer !== null) clearT(timer)
    const wait = Math.max(ms, lastEnd + minGap - now())
    timer = setT(() => { timer = null; void enqueue(false) }, wait)
  }
  const once = async (manual: boolean, base?: string | null, ifDirty = false): Promise<AutosaveResult> => {
    const myGen = gen
    const t = d.target()
    // 只为换新格式的那发（没改动·定时器叫的）——静默：⛔ 出状态；停手中／基准旧 ⇒ 作罢
    const quiet = !manual && upgrading && rev === savedRev
    if (!t) { if (quiet) upgrading = false; if (rev !== savedRev) d.onStatus('offline'); return { ok: false, err: { status: 0, code: 'no_target' } } }
    if (quiet && (blocked || conflict)) { upgrading = false; return { ok: true, id: t.id, bytes: 0 } }
    // 基准是旧的 ⇒ 挡下（自动存、切背景、关分页前那发都一样·⛔ 拿旧版盖掉新版）；只放带新基准的「保留我的」
    if (conflict && base === undefined) { d.onStatus('blocked', conflict); return { ok: false, err: conflict } }
    if (!manual && (blocked || (rev === savedRev && !quiet))) return { ok: true, id: t.id, bytes: 0 }
    // 「有改动才存」那种（切背景、交出主位）：排在前一发后面·轮到时那些改动已经存上去了 ⇒ 不再发同样的内容（负控 drawboard_flush_resend）
    if (ifDirty && rev === savedRev && !neg('drawboard_flush_resend')) return { ok: true, id: t.id, bytes: 0 }
    // 告诉同一份的别的分页「这份正在存」（接手那页等它落地再拉）·存成由 onSaved 报、没存成在这里收场
    let landed = false
    d.onSending?.(t.id, true)
    try { return await send(t, myGen, quiet, manual, base, () => { landed = true }) } finally { if (!landed) d.onSending?.(t.id, false) }
  }
  const send = async (t: { id: string; base: string | null }, myGen: number, quiet: boolean, manual: boolean, base: string | null | undefined, land: () => void): Promise<AutosaveResult> => {
    const snap = rev
    const useBase = base !== undefined ? base : t.base
    if (quiet) quietNow = true
    else d.onStatus('saving')
    let r: Awaited<ReturnType<Put>>
    try {
      const project = await d.serialize()
      if (myGen !== gen) return { ok: false, err: { status: 0, code: 'switched' } }   // 序列化跨过换档 ⇒ 内容是新那份·⛔ 写进旧那份
      r = await d.put(t.id, useBase, project)
    } catch (e) { r = { ok: false, err: { status: 0, error: e instanceof Error ? e.message : String(e) } } }
    finally { if (quiet) quietNow = false }
    lastEnd = now()
    if (myGen !== gen) return r.ok ? { ok: true, id: t.id, bytes: r.bytes } : r
    if (quiet && !r.ok) {
      // 换格式没存成：⛔ 停手、⛔ 记冲突、⛔ 出状态（没有使用者的改动会丢）·作罢——之后真有改动那发照常走乐观锁（撞了才出「有新版」）
      upgrading = false
      return r
    }
    if (r.ok) {
      upgrading = false   // 存成任何一发＝已照新格式存回
      blocked = false; conflict = null; lastErr = undefined
      // 静默那发从头到尾没人改（rev 没动）⇒ 内容＝载进来那版·告诉别的分页「只是换了格式」
      land()
      d.onSaved(t.id, r.updated_at, quiet && rev === snap ? { same: true, prev: useBase } : undefined)
      if (snap > savedRev) savedRev = snap
      if (rev !== savedRev) { d.onStatus('pending'); schedule(debounce) } else if (!quiet) d.onStatus('saved')
      return { ok: true, id: t.id, bytes: r.bytes }
    }
    if (r.err.status === 409 || BLOCKING.has(r.err.code ?? '')) { blocked = true; lastErr = r.err; if (r.err.status === 409) conflict = r.err; d.onStatus('blocked', r.err) }
    else { d.onStatus('error', r.err); if (!manual) schedule(retry) }
    return r
  }
  const enqueue = (manual: boolean, base?: string | null, ifDirty = false): Promise<AutosaveResult> => {
    running++
    const p = chain.then(() => once(manual, base, ifDirty))
    chain = p.catch(() => undefined)
    return p.finally(() => { running-- })
  }
  return {
    change() {
      rev++
      if (blocked) { d.onStatus('blocked', lastErr); return }   // 再报一次（页面跟着知道「有没存的改动」）
      d.onStatus('pending')
      schedule(debounce)
    },
    flush(opts) {
      if (timer !== null) { clearT(timer); timer = null }
      return enqueue(true, opts?.base, !!opts?.ifDirty)
    },
    begin() {
      gen++
      if (timer !== null) { clearT(timer); timer = null }
      rev = savedRev = 0; blocked = false; conflict = null; lastErr = undefined; upgrading = false
      d.onStatus('idle')
    },
    stale(err) {
      if (timer !== null) { clearT(timer); timer = null }
      blocked = true; conflict = err; lastErr = err; upgrading = false
      d.onStatus('blocked', err)
    },
    upgrade(on = true) {
      if (!on) { upgrading = false; return }
      if (blocked || conflict) return   // 停手中（冲突／额度）⇒ 不排
      upgrading = true
      if (timer === null) schedule(upgradeMs)   // 已排着有改动的那发 ⇒ 那发就照新格式存·⛔ 多排
    },
    get upgrading() { return upgrading },
    get dirty() { return rev !== savedRev },
    // 静默换格式那发在飞 ⇒ 不算（关页⛔ 为它拦；中途关掉＝下次开再转）
    get busy() { return running > (quietNow ? 1 : 0) },
  }
}

/** 标题列（画板菜单列·logo 右边）那句存档状态；text 空＝藏起来 */
export const SAVE_BADGE_ID = 'dlSaveStatus'
export function setSaveBadge(doc: Document, text: string, tone: 'muted' | 'error' = 'muted'): void {
  let el = doc.getElementById(SAVE_BADGE_ID)
  if (!el) {
    const home = doc.getElementById(IDS.home)
    if (!home || !home.parentNode) return
    el = doc.createElement('span')
    el.id = SAVE_BADGE_ID
    el.setAttribute('data-testid', 'drawboard-save-status')
    home.parentNode.insertBefore(el, home.nextSibling)
  }
  el.textContent = text
  // 冲突那句（「雲端有新版，自動存檔先停…」）很长·原本不准缩 ⇒ 窄菜单列里把菜单挤扁、折行。
  //   ⇒ 这句先让（缩的比重远大于菜单）·放不下就省略号收尾·整句放滑过提示（title）
  el.title = text
  el.setAttribute('style', `display:${text ? 'block' : 'none'};align-self:center;min-width:0;flex:0 1000 auto;overflow:hidden;text-overflow:ellipsis;padding:0 10px;font-size:12px;white-space:nowrap;color:${tone === 'error' ? '#f87171' : '#a3a3a3'}`)
}

/** 等图下载、存档的期间网站页与画板里（含 #canvasWrap·工具游标）一律转圈；
 *  计数式（两张同时拖·先好的那张⛔ 把另一张的圈收掉）·fn 成败都收。 */
const busyCount = new WeakMap<Document, number>()
export async function withBusyCursor<T>(docs: (Document | null | undefined)[], fn: () => Promise<T>): Promise<T> {
  const list = docs.filter((x): x is Document => !!x)
  for (const doc of list) {
    const n = (busyCount.get(doc) ?? 0) + 1
    busyCount.set(doc, n)
    if (n === 1 && !doc.getElementById('dlBusyCursor')) {
      const st = doc.createElement('style')
      st.id = 'dlBusyCursor'
      st.textContent = '*,*::before,*::after{cursor:progress!important}'
      ;(doc.head ?? doc.documentElement).appendChild(st)
    }
  }
  try { return await fn() } finally {
    for (const doc of list) {
      const n = (busyCount.get(doc) ?? 1) - 1
      busyCount.set(doc, n)
      if (n <= 0) doc.getElementById('dlBusyCursor')?.remove()
    }
  }
}

// ── ②③ 版面 ─────────────────────────────────────────────────────────────────────
export const IDS = { home: 'dlHome', left: 'dlLeft', tabSlot: 'dlTabSlot', driveSlot: 'dlDriveSlot' } as const
/** 左栏顶那条标签多高（网站页把标签元件盖在这条上） */
export const TAB_STRIP_H = 30
export type ChromeOpts = { homeHref: string; homeLabel: string; homeTitle: string; logoSrc: string }

/**
 * 宿主给的网址（logo、回总页）是照外层网页写的——开源单页版是相对路径（logo.png、index.html）。
 * 写进画板 iframe 的元素前先照外层网页的网址展开成绝对网址：不然会照 iframe 的 drawboard-app/index.html 解析（logo 404、回总页落到画板引擎页）。
 */
export function hostUrl(u: string, base: string | undefined = typeof document === 'undefined' ? undefined : document.baseURI): string {
  if (!base) return u
  try { return new URL(u, base).href } catch { return u }
}

export function installChrome(doc: Document, o: ChromeOpts): void {
  // ② logo：插在「堤麟画板」那格前面（Menubar.build 只清 .mb·不会把它冲掉）·点了整页（⛔ 只有 iframe）回首页
  const bar = doc.getElementById('menubar')
  if (bar && !doc.getElementById(IDS.home)) {
    const a = doc.createElement('a')
    a.id = IDS.home; a.href = hostUrl(o.homeHref); a.target = '_top'; a.title = o.homeTitle
    a.setAttribute('style', 'display:flex;align-items:center;gap:6px;padding:0 12px 0 10px;color:#fff;font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap;flex-shrink:0')
    const img = doc.createElement('img')
    img.src = hostUrl(o.logoSrc); img.alt = ''; img.width = 20; img.height = 20
    img.setAttribute('style', 'width:20px;height:20px;object-fit:contain;display:block')
    a.append(img, doc.createTextNode(o.homeLabel))
    bar.insertBefore(a, bar.querySelector('.brand') ?? bar.firstChild)
  } else if (bar) {
    const a = doc.getElementById(IDS.home) as HTMLAnchorElement
    a.title = o.homeTitle
    if (a.lastChild) a.lastChild.textContent = o.homeLabel
  }
  // 选项栏的字在画板变窄时（右边多了对话框）会一字一行折下来 ⇒ 不准折（放不下的照画板原样被右边裁掉）
  if (!doc.getElementById('dlSiteStyle')) {
    const st = doc.createElement('style')
    st.id = 'dlSiteStyle'
    st.textContent = '#optBody label,#optBody > *{white-space:nowrap;flex-shrink:0}'
    doc.head.appendChild(st)
  }
  // 窄窗：菜单列不折行·放不下收进「⋯」；状态栏藏次要栏（drawboard-narrow.pure.ts）
  installNarrowFit(doc)
  // 右栏分页钮「历史记录」：上游写死简体 ⇒ 照画板语言换字、跟着切换
  installRightTabsI18n(doc)
  // ③ 左栏：#toolbar 包进 #dlLeft（上标签占位·中工具栏·下云盘树占位）
  const tb = doc.getElementById('toolbar')
  if (tb && !doc.getElementById(IDS.left)) {
    const left = doc.createElement('div')
    left.id = IDS.left
    left.setAttribute('style', 'display:flex;flex-direction:column;flex-shrink:0;min-height:0;background:var(--bg2,#262626);border-right:1px solid var(--line,#333)')
    const slot = doc.createElement('div')
    slot.id = IDS.tabSlot
    slot.setAttribute('style', `height:${TAB_STRIP_H}px;flex-shrink:0`)
    const drive = doc.createElement('div')
    drive.id = IDS.driveSlot
    drive.setAttribute('style', 'display:none;flex:1;min-height:0')
    tb.parentElement!.insertBefore(left, tb)
    left.append(slot, tb, drive)
    tb.style.flex = '1'
    tb.style.minHeight = '0'
  }
}

// ── 右栏分页钮三语───────────────────────────────────────────────────────────
// 上游 index.html 的 #rpTabs 只有「图层」走 data-i18n；「历史记录」写死简体（rp-tabs.js 若有跑会改成繁「步驟記錄」）。
// ⛔ 改上游静态档 ⇒ 这里照画板语言（Lang.cur，退回 <html lang>）盖字，并看着按钮与 <html lang>：上游改回去／换语言就再盖。
/** 右栏要网站这层盖字的分页钮（data-tab ⇒ 繁／简／英）；「图层」已走 data-i18n 不在这里 */
export const RIGHT_TAB_LABELS: Record<string, readonly [string, string, string]> = {
  history: ['歷史記錄', '历史记录', 'History'],
}
export const RIGHT_TABS_SEL = '#rpTabs'
/** 画板语言（zh-Hant／zh-Hans／en）⇒ 分页钮的字；认不得的语言当繁体（画板 i18n.js 缺省 zh-Hant） */
export function rightTabLabel(tab: string, lang: string | null | undefined): string | null {
  const l = RIGHT_TAB_LABELS[tab]
  if (!l) return null
  return lang === 'zh-Hans' ? l[1] : lang === 'en' ? l[2] : l[0]
}
type RtWin = Window & { __dlSite?: { Lang?: { cur: string } | null }; MutationObserver?: typeof MutationObserver; __dlRtI18n?: () => void }
const rtLang = (doc: Document): string => (doc.defaultView as RtWin | null)?.__dlSite?.Lang?.cur || doc.documentElement?.getAttribute('lang') || 'zh-Hant'
/** 照现在的画板语言盖一次字（字一样就不动·免得自己的观察者无限触发）⇒ 盖了几颗 */
export function relabelRightTabs(doc: Document): number {
  if (neg('drawboard_rptab_no_i18n')) return 0
  const box = doc.querySelector(RIGHT_TABS_SEL)
  if (!box) return 0
  const lang = rtLang(doc)
  let n = 0
  for (const b of Array.from(box.querySelectorAll<HTMLElement>('[data-tab]'))) {
    const want = rightTabLabel(b.dataset.tab ?? '', lang)
    if (want && b.textContent !== want) { b.textContent = want; n++ }
  }
  return n
}
/** 装一次（重进只重盖）：#rpTabs 还没出来 ⇒ 看整份文件等它；出来后看它的字（上游 rp-tabs.js 换语言会改回去）与 <html lang>（Lang.set 会改） */
export function installRightTabsI18n(doc: Document): void {
  const win = doc.defaultView as RtWin | null
  if (win?.__dlRtI18n) { win.__dlRtI18n(); return }
  const fix = () => { try { relabelRightTabs(doc) } catch { /* 画板还没起好·下次再盖 */ } }
  fix()
  const MO = win?.MutationObserver
  if (!win || typeof MO !== 'function' || !doc.documentElement) return
  win.__dlRtI18n = fix
  // <html lang> 变＝换语言
  new MO(fix).observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] })
  // 看着按钮那格：上游 rp-tabs.js 换语言时会写回自己的字 ⇒ 再盖（字一样就不写·不会来回打）
  const watch = (): boolean => {
    const box = doc.querySelector(RIGHT_TABS_SEL)
    if (!box) return false
    new MO(fix).observe(box, { childList: true, subtree: true, characterData: true })
    fix()
    return true
  }
  // #rpTabs 晚出现 ⇒ 先看整份文件等它·出来就收掉这个观察者
  if (!watch()) {
    const wait = new MO(() => { if (watch()) wait.disconnect() })
    wait.observe(doc.documentElement, { childList: true, subtree: true })
  }
  win.addEventListener('load', fix)
}

// ── 窄窗排版：菜单列放不下收进「⋯」、AI 那句缩短、状态栏藏次要栏 ─────────────────
type NarrowMenubar = {
  app: string; openKey: string | null
  panel(items: unknown[], level: number): HTMLElement
  fit(dd: HTMLElement): void
  close(): void
  _outside(e: Event): void
}
type NarrowWin = Window & {
  __dlSite?: { Menubar?: NarrowMenubar | null; Lang?: { cur: string } | null }
  MenuTrees?: Record<string, Record<string, { n?: unknown; items?: unknown[] }>>
  ResizeObserver?: typeof ResizeObserver
  MutationObserver?: typeof MutationObserver
  __dlNarrow?: () => void
}
const outerW = (el: Element, win: Window): number => {
  const cs = win.getComputedStyle(el)
  return el.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0)
}

/** 量菜单列、照 planMenubar 排（每次先全放出来再量·量完马上收·同一帧里不会闪） */
export function fitMenubar(doc: Document): void {
  const win = doc.defaultView as NarrowWin | null
  const bar = doc.getElementById('menubar')
  if (!win || !bar) return
  const spacer = bar.querySelector('.spacer')
  let more = doc.getElementById(MORE_ID)
  if (!more) {
    // class 带 mb：上游的「点外面就收」「顶菜单开着时滑过别格就换」都认得它；Menubar.build 清 .mb 会连它清掉 ⇒ 每次量都补回
    more = doc.createElement('div')
    more.id = MORE_ID
    more.className = 'mb'
    more.setAttribute('data-testid', 'drawboard-menu-more')
    more.innerHTML = '<span class="mbt">⋯</span>'
    more.addEventListener('mousedown', (e) => {
      e.stopPropagation(); e.preventDefault()
      const M = win.__dlSite?.Menubar
      if (M && M.openKey === MORE_KEY) M.close(); else openMoreMenu(doc)
    })
    more.addEventListener('mouseenter', () => { const M = win.__dlSite?.Menubar; if (M && M.openKey && M.openKey !== MORE_KEY) openMoreMenu(doc) })
  }
  if (more.parentNode !== bar || more.nextSibling !== spacer) bar.insertBefore(more, spacer)
  more.title = moreTitle(win.__dlSite?.Lang?.cur ?? 'zh-Hant')
  const menus = Array.from(bar.querySelectorAll<HTMLElement>('.mb[data-menu]'))
  const brand = bar.querySelector<HTMLElement>('.brand')
  const hint = doc.getElementById('agentHint')
  const badge = doc.getElementById(SAVE_BADGE_ID)
  // 先全放出来再量
  for (const m of menus) m.classList.remove(FOLD_CLASS)
  more.classList.remove(FOLD_CLASS)
  brand?.classList.remove(FOLD_CLASS)
  hint?.classList.remove('dl-short')
  const hintFull = hint ? outerW(hint, win) : 0
  hint?.classList.add('dl-short')
  const hintShort = hint ? outerW(hint, win) : 0
  hint?.classList.remove('dl-short')
  let fixed = 0
  for (const el of Array.from(bar.children)) {
    if (el === more || el === brand || el === hint || el === spacer || menus.includes(el as HTMLElement)) continue
    // 存档状态句会自己缩（省略号）·只留一段给它（冲突／额度那句至少露个头）
    if (el === badge) { fixed += (el as HTMLElement).style.display === 'none' ? 0 : Math.min(el.scrollWidth, 140); continue }
    fixed += outerW(el, win)
  }
  const plan = planMenubar({
    avail: bar.clientWidth, fixed, brand: brand ? outerW(brand, win) : 0, hintFull, hintShort,
    menus: menus.map((m) => outerW(m, win)), more: outerW(more, win),
  })
  if (hint) {
    hint.classList.toggle('dl-short', plan.hintShort)
    if (plan.hintShort) hint.title = (hint.textContent ?? '').replace(/^\s*⌁\s*/, '').trim()
    else if (hint.title) hint.title = ''
  }
  brand?.classList.toggle(FOLD_CLASS, plan.hideBrand)
  menus.forEach((m, i) => m.classList.toggle(FOLD_CLASS, i >= plan.visible))
  more.classList.toggle(FOLD_CLASS, plan.visible >= menus.length)
}

/** 「⋯」打开：收进去的那几个顶菜单排成一层·滑过展开各自整棵（用上游 Menubar.panel 画·点项照常跑命令） */
export function openMoreMenu(doc: Document): boolean {
  const win = doc.defaultView as NarrowWin | null
  const M = win?.__dlSite?.Menubar
  const more = doc.getElementById(MORE_ID)
  const trees = win?.MenuTrees?.[M?.app ?? '']
  if (!win || !M || !more || !trees) return false
  const keys = Array.from(doc.querySelectorAll<HTMLElement>(`#menubar .mb[data-menu].${FOLD_CLASS}`)).map((m) => m.dataset.menu ?? '')
  const items = keys.filter((k) => trees[k]).map((k) => ({ id: `dlMore.${k}`, n: trees[k].n, sub: trees[k].items ?? [] }))
  if (!items.length) return false
  M.close()
  const dd = M.panel(items, 1)
  const r = more.getBoundingClientRect()
  dd.style.left = `${r.left}px`; dd.style.top = `${r.bottom}px`
  doc.body.appendChild(dd)
  M.fit(dd)
  more.classList.add('open')
  M.openKey = MORE_KEY
  win.setTimeout(() => doc.addEventListener('mousedown', M._outside, true), 0)
  return true
}

/** 状态栏：照宽度分级（full／narrow／tiny）·回复档那句整句放 title */
export function fitStatusbar(doc: Document): void {
  const bar = doc.getElementById('statusbar')
  if (!bar) return
  const tier = statusTier(bar.clientWidth)
  bar.classList.toggle('dl-narrow', tier === 'narrow')
  bar.classList.toggle('dl-tiny', tier === 'tiny')
  const rec = doc.getElementById('pse3Recover')
  const txt = rec?.firstElementChild?.textContent ?? ''
  if (rec && rec.title !== txt) rec.title = txt
}

/** 装一次（重进 installChrome 只重排）：注样式、看菜单列／状态栏的大小与内容变化·下一帧重排 */
export function installNarrowFit(doc: Document): void {
  const win = doc.defaultView as NarrowWin | null
  if (!win || typeof win.ResizeObserver !== 'function' || typeof win.MutationObserver !== 'function' || !doc.head) return
  if (win.__dlNarrow) { win.__dlNarrow(); return }
  if (!doc.getElementById(NARROW_STYLE_ID)) {
    const st = doc.createElement('style')
    st.id = NARROW_STYLE_ID
    st.textContent = NARROW_CSS
    doc.head.appendChild(st)
  }
  // 菜单列与状态栏各排各的：座标每动一下滑鼠就变·⛔ 让它带着菜单列一起重量
  const later = (fn: (d: Document) => void) => {
    let raf = 0
    return () => { if (!raf) raf = win.requestAnimationFrame(() => { raf = 0; try { fn(doc) } catch { /* 画板还没起好·下次再排 */ } }) }
  }
  const menu = later(fitMenubar), status = later(fitStatusbar)
  const all = () => { menu(); status() }
  win.__dlNarrow = all
  const mb = doc.getElementById('menubar'), sb = doc.getElementById('statusbar')
  if (mb) {
    new win.ResizeObserver(menu).observe(mb)
    // 换图层种类（PS／AI 菜单）、换语言、存档状态句变长变短 ⇒ 重排
    new win.MutationObserver(menu).observe(mb, { childList: true, subtree: true, characterData: true })
  }
  if (sb) {
    new win.ResizeObserver(status).observe(sb)
    new win.MutationObserver(status).observe(sb, { childList: true })   // 回复档那句插进来／拿掉
  }
  win.addEventListener('load', all)
  if (doc.fonts?.ready) doc.fonts.ready.then(all, () => {})
  try { fitMenubar(doc); fitStatusbar(doc) } catch { /* 同上 */ }
}

/** 切左栏：工具 ⇒ 露工具栏；云盘 ⇒ 藏工具栏·占位撑到 driveW（网站页的云盘树盖上去）。画布区宽度跟着变 ⇒ 叫画板重画 */
export function setLeft(doc: Document, site: DlSite | null, tab: DrawboardTab, driveW: number): void {
  const tb = doc.getElementById('toolbar')
  const drive = doc.getElementById(IDS.driveSlot)
  const left = doc.getElementById(IDS.left)
  if (!tb || !drive || !left) return
  tb.style.display = tab === 'tools' ? '' : 'none'
  drive.style.display = tab === 'drive' ? 'block' : 'none'
  left.style.width = tab === 'drive' ? `${driveW}px` : ''
  site?.UI?.draw()
}

export type Rect = { left: number; top: number; width: number; height: number }
/** 左栏在 iframe 里的位置（iframe 贴齐容器左上 ⇒ 就是网站页盖元件的位置） */
export function leftRect(doc: Document): Rect | null {
  const el = doc.getElementById(IDS.left)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

const BASE_IDS = new Set(['menubar', 'optionbar', 'main', 'fileInput', 'projInput'])
const hit = (a: Rect, b: DOMRect) => b.width > 0 && b.height > 0 && b.left < a.left + a.width && b.right > a.left && b.top < a.top + a.height && b.bottom > a.top
/** 画板自己弹出来的东西（顶菜单下拉、工具小箭头选单、对话框…）有没有压到左栏 ⇒ 有就让网站页暂时把盖在上面的元件藏起来（不然下拉被盖住） */
export function popupOver(doc: Document, rect: Rect): boolean {
  if (doc.querySelector('#menubar .mb.open')) return true
  for (const el of Array.from(doc.body?.children ?? [])) {
    if (BASE_IDS.has(el.id) || el.tagName === 'SCRIPT' || el.tagName === 'INPUT') continue
    if (hit(rect, el.getBoundingClientRect())) return true
  }
  return false
}

/** 拖拉条：按下后跟着滑鼠走（期间 iframe 不吃滑鼠·不然拖过画板就断了）·放开收尾 */
export function startDrag(e: { clientX: number; preventDefault(): void }, o: { frames: Array<HTMLIFrameElement | null>; onMove: (dx: number) => void; onEnd: () => void; win?: Window }): void {
  e.preventDefault()
  const w = o.win ?? window
  const x0 = e.clientX
  const frames = o.frames.filter((f): f is HTMLIFrameElement => !!f)
  frames.forEach((f) => { f.style.pointerEvents = 'none' })
  const prevSel = w.document.body.style.userSelect
  w.document.body.style.userSelect = 'none'
  const move = (ev: PointerEvent) => o.onMove(ev.clientX - x0)
  const up = () => {
    w.removeEventListener('pointermove', move)
    w.removeEventListener('pointerup', up)
    w.removeEventListener('pointercancel', up)
    frames.forEach((f) => { f.style.pointerEvents = '' })
    w.document.body.style.userSelect = prevSel
    o.onEnd()
  }
  w.addEventListener('pointermove', move)
  w.addEventListener('pointerup', up)
  w.addEventListener('pointercancel', up)
}

// ── 网络：工程档口、云盘上传 ───────────────────────────────────────────────────────
export type ProjGet = { id: string; title: string; folder_id: string | null; updated_at: string; project: DrawboardProject; warning?: string }
export type ApiErr = { status: number; code?: string; error?: string; updated_at?: string | null }

/** 画板命令可能跨 await（layer.addImageFromURL 等图下载）——等的中间换了档，晚到的结果会落进新那份。
 *  画板本体那头的世代判（Doc.serial 前后比）在上游；网站这层用一把「这份画板正被谁动」的锁挡住网站自己能开的口：
 *  角色的活（整件）、使用者放图都排这把锁；使用者切档走 cut（⛔ 等手上那件·下载中的图丢掉、那件回失败）·切完再来的活照 target 核。
 *  ⛔ 可重入：活里合法的 file.openProject 走命令那支（不再拿锁）。waitMs 内拿不到 ⇒ {ok:false}（fn 不跑）。 */
export type DocLock = {
  readonly busy: boolean
  run<T>(fn: () => Promise<T> | T, waitMs?: number): Promise<{ ok: true; value: T } | { ok: false }>
  /** 使用者切档 ⇒ 不等手上那件、马上跑（那件等图的中间换了档 ⇒ 画板本体按 Doc.serial 丢掉晚到的图、
   *  那件回失败）；之后再来的活照样等它载完（⛔ 落在半载的那份）。 */
  cut<T>(fn: () => Promise<T> | T): Promise<{ ok: true; value: T }>
}
export function createDocLock(): DocLock {
  let tail: Promise<void> = Promise.resolve()
  let held = 0
  return {
    get busy() { return held > 0 },
    async run<T>(fn: () => Promise<T> | T, waitMs?: number) {
      const prev = tail
      let release!: () => void
      const mine = new Promise<void>((r) => { release = r })
      tail = prev.then(() => mine)
      held++
      let timer: ReturnType<typeof setTimeout> | undefined
      const got = waitMs === undefined ? (await prev, true)
        : await Promise.race([prev.then(() => true), new Promise<boolean>((r) => { timer = setTimeout(() => r(false), waitMs) })])
      clearTimeout(timer)
      if (!got) { held--; release(); return { ok: false as const } }
      try { return { ok: true as const, value: await fn() } } finally { held--; release() }
    },
    async cut<T>(fn: () => Promise<T> | T) {
      const prev = tail
      let release!: () => void
      const mine = new Promise<void>((r) => { release = r })
      tail = Promise.all([prev, mine]).then(() => undefined)
      held++
      try { return { ok: true as const, value: await fn() } } finally { held--; release() }
    },
  }
}

// ── 云档分页：每份工程档各占画板分页列的一个分页 ─────────────────────────────────────────
//   点云盘里的画板（单击／双击／拖进画布）、角色的 file.openProject：已开着同一份 ⇒ 切到那个分页；否则新开一个分页载入那份。
//      当前这份原样留在自己的分页里（不先存、不问、不取消·旧的「同页换档」整条拿掉了）。
//   每个云档分页各一只自动存（createAutosaver）·各记各的云盘档号与基准：
//      在前面 ⇒ 序列化当下这份（serializeAsync·序列化的中间换了分页 ⇒ 改用收起时留的那份）；不在前面 ⇒ 收起时留的工程档（上游 capture 的 hostJSON）。
//   「现在这份」＝前面那个云档分页；前面是上游的暂存分页（开旧档、新建、智慧物件内容）⇒ 留着上一个云档分页（同改前：暂存页不改绑）。
export type CloudProj = { id: string; title: string; folder_id: string | null }
/** stale＝云端那份比本份基准新（别的分页存过／撞过 409）时那版的 updated_at·没有＝null */
/** 多页：一份云档可有好几页·每页各占一个分页——doc＝第 1 页那个分页（这份档的「代表」·map 的键）·pages＝各页分页 id（第 1 页在前）·
 *  names＝各页的名字（没有＝null）。自动存一份档存所有页（joinDrawboardPages）。删掉第 1 页 ⇒ 代表换成新的第 1 页（doc 跟着换）。 */
export type CloudTab = { doc: string; pages: string[]; names: Map<string, string | null>; proj: CloudProj | null; base: string | null; auto: Autosaver; status: AutosaveStatus; err?: ApiErr; stale: string | null }
export type CloudPageResult = Params & { ok: boolean; doc?: string; page?: number; error?: string }
type ProjGetR = { ok: true; data: ProjGet } | { ok: false; err: ApiErr }
export type CloudTabsDeps = {
  tabs: () => DlTabs | null
  get: (id: string) => Promise<ProjGetR>
  /** 网址那份：载进页面刚起时那个分页（＝ site.Project.load·宿主那份） */
  loadHere: (project: DrawboardProject) => Promise<void>
  serializeActive: () => Promise<unknown>
  serializeActiveSync: () => unknown
  put: Put
  /** 分页名（云盘档名去掉 .dlcanvas） */
  name: (title: string) => string
  /** 多页：还没进云盘的那份叫什么（分页标签用）·画板语言（新页缺省名） */
  untitled?: () => string
  lang?: () => string | null
  /** 「现在这份」换了、或它绑的云盘档变了（页面换 proj／网址／角色） */
  onCurrent: (tab: CloudTab | null) => void
  /** 现在这份的存档状态（标题列） */
  onStatus: (st: AutosaveStatus, err?: ApiErr) => void
  /** 存成了（页面经 BroadcastChannel 通知同一张画板的别的分页）·info＝静默换格式那发（内容没变） */
  onSaved?: (id: string, updatedAt: string, info?: SavedInfo) => void
  /** 一发存档打出去了／没存成收场（页面经 BroadcastChannel 告诉别的分页「正在存」） */
  onSending?: (id: string, on: boolean) => void
  /** 刚载完一页（它正在前面）·这页是不是旧格式（drawboardOldLayout：载档时像素层被裁小）⇒ 这份档标「待转新格式」·没给＝不判 */
  oldLayout?: (page: unknown) => boolean
  /** 现在这份有新版没载（tab）／没有了（null）·页面出「有新版·載入」 */
  onStale?: (tab: CloudTab | null) => void
  onLoading?: (on: boolean) => void
  onLoadFailed?: (err: ApiErr) => void
  onError?: (e: unknown) => void
  autosave?: Pick<AutosaverDeps, 'debounceMs' | 'minGapMs' | 'retryMs' | 'upgradeMs' | 'now' | 'setTimer' | 'clearTimer'>
}
export type CloudTabs = {
  /** 登记一个云档分页（页面起好时那个分页·还没进云盘＝proj null） */
  adopt(doc: string): CloudTab
  /** 开一份云盘画板：已开着 ⇒ 切过去；没开 ⇒ 新分页载入（here＝载进现在这个分页·只给网址那份） */
  open(id: string, opts?: { here?: boolean }): Promise<Params & { ok: boolean }>
  current(): CloudTab | null
  get(doc: string): CloudTab | undefined
  byCloud(id: string): CloudTab | undefined
  /** 画板分页切了／关了（dl:docs） */
  sync(): void
  /** 前面那份改了一笔 */
  change(): void
  /** 第一次存档建好云盘档 ⇒ 绑上 */
  bind(tab: CloudTab, proj: CloudProj, base: string): void
  /** 宿主那份被换成空白（關閉／開啟為）⇒ 解开它和云盘档的绑定 */
  unbind(doc: string): void
  /** 分页关掉了 */
  remove(doc: string): void
  /** 别的分页把云盘档 id 存成了 updatedAt ⇒ 开着同一份且基准较旧 ⇒ 记 stale、挡自动存（回 true＝记上了）
   *  info.same（别页只是静默换了格式·内容没变）且本份基准正是 info.prev ⇒ 只换基准、取消本份待转（⛔ 出「有新版」） */
  remoteSaved(id: string, updatedAt: string, info?: SavedInfo): boolean
  /** 别的分页说云盘档 id 那发存档打出去了（on）／没存成（off·存成走 remoteSaved） */
  remoteSaving(id: string, on: boolean): void
  /** 防切过去 0.3 秒内下笔挡不到：别的分页转背景那一刻说「id 这份有没存的改动、马上存」（on）／存完了（off）。
   *  on 到 off 之间一律算「别页还在存」（peerSaving）——中间先落地的那几发 saved ⇒ 不放（⛔ 拉到半截：交出前在途那发落地、补的那发还没打）。 */
  remoteLeaving(id: string, on: boolean): void
  /** 别的分页报「转背景·马上存」时叫 fn（id）·回传退订 */
  onPeerLeaving(fn: (id: string) => void): () => void
  /** 别的分页手上有一发 id 的存档还在路上（报了「正在存」、还没报存成或收场·最多算 PEER_SAVE_WAIT_MS） */
  peerSaving(id: string): boolean
  /** 等别的分页那发落地（或收场）·最多等 ms（缺省 PEER_SAVE_WAIT_MS）：落地 ⇒ true；等到逾时 ⇒ false */
  waitPeer(id: string, ms?: number): Promise<boolean>
  /** 「載入／套用最新版」：把云端最新那版载进 doc 那个分页（要在前面）·丢掉本份没存的改动 */
  reload(doc: string): Promise<Params & { ok: boolean }>
  /** 这页接手成主分页（切回前台） ⇒ 拉云端最新那版：跟本份基准同一版 ⇒ 什么都不动（⛔ 白载一次）；
   *  较新、本份没改动 ⇒ 载进来（同「載入最新版」·pulled）；本份有没存的改动 ⇒ ⛔ 盖掉·记 stale 出「套用最新版／保留我的」 */
  refresh(doc: string): Promise<Params & { ok: boolean }>
  /** 有分页正在载（Project.load 逐层 await·这时⛔ 切分页：剩下的层会落进切过去那份） */
  readonly switching: boolean
  readonly dirty: boolean
  readonly busy: boolean
  /** 没存的都马上存（交出主位） */
  flushDirty(): void
  /** 切到背景（visibilitychange hidden·在事件里同步叫）：有没存的改动或正在存的云档 ⇒ 当场 post.leave(id)（别页一变前台就先挡手·不等中继回包）、
   *  马上存；那份排着的存档全跑完（存成／没存成／不必存）⇒ post.done(id)（别页放手、拉最新）。回报了几份。负控 drawboard_hide_no_notice＝不报（只存）。 */
  leaveDirty(post: { leave(id: string): void; done(id: string): void }): number
  // ── 多页：一份 .dlcanvas 放好几页，每页一个分页 ──
  /** 这个分页（任一页）属于哪份云档 */
  fileOf(doc: string): CloudTab | undefined
  /** 这个分页那份档的所有页（第 1 页在前）·不是云档分页＝[] */
  pagesOf(doc: string): string[]
  /** 整份档（所有页）序列化（另存一份用） */
  serializeFile(tab: CloudTab): Promise<unknown>
  /** 前面那份档加一页（空白·尺寸照给）⇒ 切到新页 */
  addPage(o: { name?: string | null; width: number; height: number; bg?: string | null }): Promise<CloudPageResult>
  /** 把另一份云盘画板的所有页接到前面那份档后面 */
  importPages(id: string): Promise<CloudPageResult & { added?: number }>
  renamePage(doc: string, name: string | null): CloudPageResult
  deletePage(doc: string): Promise<CloudPageResult>
  activatePage(doc: string): Promise<CloudPageResult>
}
const HERE = 'main'
/** 别的分页报「正在存」后最多等它多久（一张 2K 图整份约 6～10MB·线上一发要几秒）·过了当它没下文 */
export const PEER_SAVE_WAIT_MS = 15_000
export function createCloudTabs(d: CloudTabsDeps): CloudTabs {
  const tabs = new Map<string, CloudTab>()
  /** 第 2 页起的分页 ⇒ 它那份档的代表分页（第 1 页） */
  const owner = new Map<string, string>()
  const leadOf = (doc: string): string | null => (tabs.has(doc) ? doc : owner.get(doc) ?? null)
  const fileLabel = (t: CloudTab) => (t.proj ? d.name(t.proj.title) : d.untitled?.() ?? '')
  const pageLabel = (t: CloudTab, doc: string) => {
    const i = t.pages.indexOf(doc), nm = t.names.get(doc) ?? null
    return drawboardPageLabel(fileLabel(t), nm ?? (i > 0 ? defaultPageName(d.lang?.() ?? null, i + 1) : null))
  }
  /** 删掉第 1 页／第 1 页的分页不见了 ⇒ 代表换成 nl（map 的键、各页的 owner、现在这份都跟着换） */
  const rekey = (t: CloudTab, nl: string) => {
    const old = t.doc
    tabs.delete(old); owner.delete(nl)
    t.doc = nl
    tabs.set(nl, t)
    for (const x of t.pages.slice(1)) owner.set(x, nl)
    if (cur === old) cur = nl
  }
  const pending = new Map<string, Promise<Params & { ok: boolean }>>()
  let cur: string | null = null, loading = 0, switching = 0, switches = 0, clicks = 0
  let shown: { ticket: number; doc: string } = { ticket: 0, doc: '' }
  let loadTail: Promise<unknown> = Promise.resolve()
  /** 别的分页正在存的云盘档：id ⇒ 算到几时（报了「正在存」却一直没下文——那页关了、断线——过了就不再等）·等它落地的那几位 */
  const peer = new Map<string, number>()
  /** 别的分页转背景时报「这份马上存」（remoteLeaving on）·到它报完（off）才算落地：id ⇒ 算到几时 */
  const leaving = new Map<string, number>()
  const leaveFns = new Set<(id: string) => void>()
  const peerWaiters = new Map<string, Array<() => void>>()
  const live = (m: Map<string, number>, id: string) => {
    const u = m.get(id)
    if (u === undefined) return false
    if (Date.now() < u) return true
    m.delete(id)
    return false
  }
  /** 那几发都落地了（两样记号都没了／过期）才叫醒等的人 */
  const peerSettle = (id: string) => {
    if (live(peer, id) || live(leaving, id)) return
    const ws = peerWaiters.get(id)
    peerWaiters.delete(id)
    ws?.forEach((w) => w())
  }
  const peerDone = (id: string) => { peer.delete(id); peerSettle(id) }
  const emitStale = () => { const t = cur ? tabs.get(cur) ?? null : null; d.onStale?.(t && t.stale ? t : null) }
  const emit = () => { const t = cur ? tabs.get(cur) ?? null : null; d.onCurrent(t); d.onStatus(t ? t.status : 'idle', t?.err); emitStale() }
  const markStale = (tab: CloudTab, at: string) => { tab.stale = at; if (cur === tab.doc) emitStale() }
  const setCur = (doc: string | null) => { if (cur !== doc) { cur = doc; emit() } }
  const serializeTab = async (doc: string): Promise<unknown> => {
    const T = d.tabs()
    if (!T || T.activeId() === doc) {
      const s0 = switches
      const j = await d.serializeActive()
      if (s0 === switches) return j
    }
    const kept = T?.json(doc)
    if (kept) return kept
    if (T && T.activeId() === doc) return d.serializeActiveSync()
    throw new Error('tab_closed')
  }
  /** 一份档存什么：只有一页又没名字 ⇒ 跟旧档一模一样（那一页本身）；否则逐页接起来（joinDrawboardPages） */
  const serializeFile = async (t: CloudTab): Promise<unknown> => {
    const pages = t.pages.slice()
    if (pages.length <= 1 && !t.names.get(t.doc)) return serializeTab(t.doc)
    const list: { name: string | null; project: unknown }[] = []
    for (const x of pages) list.push({ name: t.names.get(x) ?? null, project: await serializeTab(x) })
    return joinDrawboardPages(list)
  }
  const make = (doc: string): CloudTab => {
    const tab: CloudTab = { doc, pages: [doc], names: new Map([[doc, null]]), proj: null, base: null, status: 'idle', auto: null as unknown as Autosaver, stale: null }
    tab.auto = createAutosaver({
      ...d.autosave,
      target: () => (tab.proj ? { id: tab.proj.id, base: tab.base } : null),
      serialize: () => serializeFile(tab),
      put: d.put,
      onSaved: (id, at, info) => {
        if (tab.proj?.id !== id) return
        tab.base = at
        if (tab.stale) { tab.stale = null; if (cur === tab.doc) emitStale() }   // 保留我的存成 ⇒ 本份就是最新
        d.onSaved?.(id, at, info)
      },
      onSending: (id, on) => d.onSending?.(id, on),
      onStatus: (st, err) => {
        tab.status = st; tab.err = err
        // 撞了 409（别的装置／没收到通知的分页存过）⇒ 一样出「有新版」
        if (st === 'blocked' && err?.status === 409 && !tab.stale) tab.stale = err.updated_at || '?'
        if (cur === tab.doc) { d.onStatus(st, err); emitStale() }
      },
    })
    tabs.set(doc, tab)
    return tab
  }
  const drop = (doc: string) => {
    const t = tabs.get(doc)
    if (!t) return
    t.auto.begin()   // 待存那发作废（关前已先存完／选了丢掉）
    tabs.delete(doc)
    for (const x of t.pages) if (owner.get(x) === doc) owner.delete(x)
  }
  /** 刚载完的这页（在前面）是不是旧格式·判坏了当不是 */
  const isOld = (page: unknown): boolean => { try { return !!d.oldLayout?.(page) } catch { return false } }
  /** 新开几页接在 t 后面（每页一个新分页·载的中间算 switching ⇒ 挡人手切分页）·开完切回 back（没给＝停在最后那页）
   *  seen＝开档／载入最新版时顺手记「有没有旧格式的页」 */
  const openPages = async (T: DlTabs, t: CloudTab, list: { name: string | null; project: unknown; bg?: string | null }[], seen?: { old: boolean }): Promise<string[]> => {
    const made: string[] = []
    switching++
    try {
      for (const pg of list) {
        const n = t.pages.length + made.length
        const label = drawboardPageLabel(fileLabel(t), pg.name ?? (n > 0 ? defaultPageName(d.lang?.() ?? null, n + 1) : null))
        made.push(await T.open(pg.project, label, pg.bg))
        if (seen && !seen.old && isOld(pg.project)) seen.old = true
      }
    } catch (e) {
      // 载坏一页 ⇒ 这一趟开出来的几页都拿掉（⛔ 半份档留在分页列上没人管）
      for (const x of made) await T.close?.(x)
      throw e
    } finally { switching-- }
    made.forEach((x, i) => { t.pages.push(x); t.names.set(x, list[i].name); owner.set(x, t.doc) })
    return made
  }
  /** 把云端最新那版载进 doc 那个分页（reload＝使用者按「載入／套用最新版」）。
   *  ifNewer（refresh：切回前台那页接手时拉最新）⇒ 先取、跟本份基准比：同一版／较旧 ⇒ 不动（⛔ 切分页、⛔ 闪载入）；
   *  本份有没存的改动 ⇒ ⛔ 盖掉·照「别页存过」记 stale（出「套用最新版／保留我的」）；没前面这份 ⇒ 不动。 */
  const loadLatest = async (doc: string, ifNewer: boolean): Promise<Params & { ok: boolean }> => {
    const t = tabs.get(doc)
    const T = d.tabs()
    if (!t || !t.proj) return ifNewer ? { ok: true, skipped: 'no_target' } : { ok: false, error: 'no_target' }
    const id = t.proj.id
    let pre: ProjGetR | null = null
    if (ifNewer) {
      const a = T?.activeId() ?? null
      if (T && (!a || leadOf(a) !== doc)) return { ok: true, id, skipped: 'not_front' }   // 前面是暂存分页／别份 ⇒ ⛔ 抢画面
      const base = t.base, dirty = t.auto.dirty
      pre = await d.get(id)
      if (!pre.ok) { d.onLoadFailed?.(pre.err); return { ok: false, id, error: 'load_failed' } }
      if (tabs.get(doc) !== t || t.proj?.id !== id) return { ok: false, id, error: 'switched' }
      const at = pre.data.updated_at
      const x = Date.parse(at), y = base ? Date.parse(base) : NaN
      if (!at || at === base || (Number.isFinite(x) && Number.isFinite(y) && x <= y)) return { ok: true, id, unchanged: true }
      if (dirty || t.auto.dirty) { api.remoteSaved(id, at); return { ok: false, id, error: 'dirty', stale: at } }
    }
    if (T && T.activeId() !== doc) { await loadTail; if (!T.activate(doc)) return { ok: false, error: 'activate_failed' }; api.sync() }
    if (++loading === 1) d.onLoading?.(true)
    try {
      const r = pre ?? await d.get(id)
      if (!r.ok) { d.onLoadFailed?.(r.err); return { ok: false, id, error: 'load_failed' } }
      if (tabs.get(doc) !== t || t.proj?.id !== id) return { ok: false, id, error: 'switched' }
      t.auto.begin()   // 在飞／待存那发作废（⛔ 载的中间拿旧内容去存）
      // 多页：第 1 页载进代表分页·旧的第 2 页起整批拿掉、照云端那版重开
      const parts = splitDrawboardPages(r.data.project)
      const seen = { old: false }
      const turn = loadTail.then(async () => {
        // 载进前面这个分页：别的云档分页（各份的每一页）先摘 host（网站 Project.load 认第一个 host 分页·⛔ 载进别份）
        const others = T ? [...tabs.values()].flatMap((x) => x.pages).filter((x) => x !== doc && T.has(x)) : []
        switching++
        others.forEach((x) => T!.host(x, false))
        try { await d.loadHere(parts[0].project); seen.old = isOld(parts[0].project) } finally { others.forEach((x) => { if (T!.has(x)) T!.host(x, true) }); switching-- }
        if (!T) return
        const old = t.pages.slice(1)
        old.forEach((x) => { owner.delete(x); t.names.delete(x) })
        t.pages = [doc]; t.names = new Map([[doc, parts[0].name]])
        for (const x of old) await T.close?.(x)
        if (parts.length > 1) await openPages(T, t, parts.slice(1), seen)
        if (T.activeId() !== doc) T.activate(doc)
      })
      loadTail = turn.catch(() => undefined)
      await turn
      t.auto.begin()   // 刚载完＝已存（本份没存的改动照使用者选的丢掉）
      t.proj = { id: r.data.id, title: r.data.title, folder_id: r.data.folder_id }
      t.base = r.data.updated_at
      t.stale = null
      if (seen.old) t.auto.upgrade()   // 云端那版仍是旧格式 ⇒ 同开档
      if (cur === doc) emit()
      return ifNewer ? { ok: true, id, tab: doc, pulled: true } : { ok: true, id, tab: doc }
    } catch (e) {
      d.onError?.(e)
      return { ok: false, id, error: e instanceof Error ? e.message : String(e) }
    } finally {
      if (--loading === 0) d.onLoading?.(false)
    }
  }
  const api: CloudTabs = {
    adopt(doc) { const t = tabs.get(doc) ?? make(doc); if (!cur) setCur(doc); return t },
    async open(id, opts) {
      const T = d.tabs()
      if (!T && !opts?.here) return { ok: false, id, error: 'not_ready' }
      const ticket = ++clicks
      // 开完才落定的那份：更晚点的那份已经开好在前面 ⇒ 切回那份（后点的赢·⛔ 晚回来的 GET 把画面抢走）
      const settle = (doc: string) => {
        if (shown.ticket > ticket && T && T.has(shown.doc)) { if (T.activeId() !== shown.doc && T.activate(shown.doc)) api.sync(); return }
        shown = { ticket, doc }
      }
      const have = api.byCloud(id)
      if (have && (!T || T.has(have.doc))) {
        if (T && T.activeId() !== have.doc) {
          await loadTail   // 别份正在载 ⇒ 载完再切（⛔ 载到一半换分页）
          if (!T.activate(have.doc)) return { ok: false, id, error: 'activate_failed' }
        }
        api.sync()
        settle(have.doc)
        return { ok: true, id, tab: have.doc, reused: true }
      }
      const inFlight = pending.get(id)
      if (inFlight) {
        // 同一份连点两下 ⇒ 只开一个分页（⛔ 再 GET）；但这一下领的是新票：B→C→B 时 B 还在载，
        // 合并的那份落定后要用这张票再落定一次（切回 B·后点的赢）
        const r = await inFlight
        const doc = r.ok && typeof r.tab === 'string' ? r.tab : null
        if (!doc) return r
        if (T && shown.ticket <= ticket && T.has(doc) && T.activeId() !== doc) {
          await loadTail   // 别份正在载 ⇒ 载完再切（⛔ 载到一半换分页）
          if (shown.ticket <= ticket && T.has(doc) && T.activeId() !== doc && T.activate(doc)) api.sync()
        }
        settle(doc)
        return r
      }
      const run = (async (): Promise<Params & { ok: boolean }> => {
        if (++loading === 1) d.onLoading?.(true)
        try {
          const r = await d.get(id)
          if (!r.ok) { d.onLoadFailed?.(r.err); return { ok: false, id, error: 'load_failed' } }
          const name = d.name(r.data.title)
          // 改 Doc 那段一次只一段（⛔ 两份交错：后开那份的分页插进来时，前一份剩下的层会落进它）
          // here（网址那份·页面刚起只有一个分页）⛔ 算 switching：宿主 Project.load 自己会叫 ps.document.activate 切回宿主
          // 多页：第 1 页照旧（载进这一页／新分页）·第 2 页起各开一个分页·开完切回第 1 页
          const parts = splitDrawboardPages(r.data.project)
          const seen = { old: false }
          const turn = loadTail.then(async () => {
            const guard = !(opts?.here || !T)
            let doc: string
            if (guard) switching++
            try {
              if (opts?.here || !T) {
                await d.loadHere(parts[0].project)
                doc = T?.activeId() ?? HERE
                T?.name(drawboardPageLabel(name, parts[0].name))
              } else doc = await T.open(parts[0].project, drawboardPageLabel(name, parts[0].name))
              seen.old = isOld(parts[0].project)   // 刚载完、还在前面 ⇒ 看它的像素层被裁了没
            } finally { if (guard) switching-- }
            const tab = tabs.get(doc) ?? make(doc)
            // 同一个分页先前那份的页（网址那份重开）⇒ 不再算这份的
            for (const x of tab.pages.slice(1)) owner.delete(x)
            tab.pages = [doc]; tab.names = new Map([[doc, parts[0].name]])
            tab.proj = { id: r.data.id, title: r.data.title, folder_id: r.data.folder_id }
            if (T && parts.length > 1) {
              try { await openPages(T, tab, parts.slice(1), seen) } catch (e) {
                // 第 2 页起载坏 ⇒ 这份不绑云档（⛔ 之后自动存只存第 1 页、把别页盖掉）·新开的第 1 页分页也拿掉
                tab.proj = null; tab.auto.begin()
                if (guard) { drop(doc); await T.close?.(doc) }
                throw e
              }
              if (T.activeId() !== doc) T.activate(doc)
            }
            return doc
          })
          loadTail = turn.catch(() => undefined)
          const doc = await turn
          const tab = tabs.get(doc) ?? make(doc)
          tab.auto.begin()   // 刚载完＝已存
          tab.proj = { id: r.data.id, title: r.data.title, folder_id: r.data.folder_id }
          tab.base = r.data.updated_at
          tab.stale = null
          if (seen.old) tab.auto.upgrade()   // 旧格式 ⇒ 待转新格式（下一发存档顺带转·没改就静默存一发）
          cur = doc
          emit()
          settle(doc)
          return { ok: true, id, tab: doc }
        } catch (e) {
          d.onError?.(e)
          return { ok: false, id, error: e instanceof Error ? e.message : String(e) }
        } finally {
          pending.delete(id)
          if (--loading === 0) d.onLoading?.(false)
        }
      })()
      pending.set(id, run)
      return run
    },
    current: () => (cur ? tabs.get(cur) ?? null : null),
    get: (doc) => { const l = leadOf(doc); return l ? tabs.get(l) : undefined },
    byCloud: (id) => { for (const t of tabs.values()) if (t.proj?.id === id) return t; return undefined },
    sync() {
      switches++
      const T = d.tabs()
      if (!T) return
      for (const t of [...tabs.values()]) {
        const gone = t.pages.filter((x) => !T.has(x))
        if (!gone.length) continue
        const keep = t.pages.filter((x) => T.has(x))
        if (!keep.length) { drop(t.doc); continue }
        gone.forEach((x) => { owner.delete(x); t.names.delete(x) })
        t.pages = keep
        if (!T.has(t.doc)) rekey(t, keep[0])   // 第 1 页的分页不见了 ⇒ 下一页当代表（⛔ 整份档跟着丢）
      }
      const a = T.activeId()
      const l = a ? leadOf(a) : null
      if (l && tabs.has(l)) setCur(l)
      else if (cur && !tabs.has(cur)) setCur(tabs.keys().next().value ?? null)
    },
    change() {
      const a = d.tabs()?.activeId() ?? cur
      const l = a ? leadOf(a) : null
      if (l) tabs.get(l)?.auto.change()
    },
    bind(tab, proj, base) {
      tab.proj = proj; tab.base = base
      // 多页：第一次存档才有档名 ⇒ 各页分页标签换成「档名 · 页名」
      const T = d.tabs()
      if (T?.label && (tab.pages.length > 1 || tab.names.get(tab.doc))) for (const x of tab.pages) T.label(x, pageLabel(tab, x))
      if (cur === tab.doc) emit()
    },
    unbind(doc) {
      const t = api.get(doc)
      if (!t || !t.proj) return
      t.auto.begin()   // 待存那发作废（关闭时选了不儲存／已先存完）·在飞那发回来也不再认
      t.proj = null; t.base = null; t.stale = null
      if (cur === t.doc) emit()
    },
    remoteSaved(id, at, info) {
      peerDone(id)   // 那发落地了（等它的接手那页接着拉最新）
      const t = api.byCloud(id)
      if (!t || !at || t.base === at) return false
      // 别页只是把同一版静默换成新格式（内容没变）、本份正是那版 ⇒ 换基准就好·本份不必再转（⛔ 出「有新版」、⛔ 挡自动存）
      if (info?.same && !t.stale && t.base === info.prev) { t.base = at; t.auto.upgrade(false); return false }
      // 本份基准已经比通知那版新（自己后来又存过、通知晚到）⇒ 不算
      const a = Date.parse(at), b = t.base ? Date.parse(t.base) : NaN
      if (Number.isFinite(a) && Number.isFinite(b) && a <= b) return false
      t.auto.stale({ status: 409, code: 'drawboard_conflict', updated_at: at })
      markStale(t, at)
      return true
    },
    remoteSaving(id, on) {
      if (on) peer.set(id, Date.now() + PEER_SAVE_WAIT_MS)
      else peerDone(id)
    },
    remoteLeaving(id, on) {
      if (!on) { leaving.delete(id); peerSettle(id); return }
      leaving.set(id, Date.now() + PEER_SAVE_WAIT_MS)
      for (const fn of [...leaveFns]) { try { fn(id) } catch { /* 页面那头出错⛔ 挡别的 */ } }
    },
    onPeerLeaving(fn) { leaveFns.add(fn); return () => { leaveFns.delete(fn) } },
    peerSaving(id) {
      if (live(peer, id) || live(leaving, id)) return true
      peerSettle(id)
      return false
    },
    waitPeer(id, ms = PEER_SAVE_WAIT_MS) {
      if (!api.peerSaving(id)) return Promise.resolve(true)
      return new Promise<boolean>((res) => {
        const wait = Math.max(0, Math.min(ms, Math.max(peer.get(id) ?? 0, leaving.get(id) ?? 0) - Date.now()))
        const timer = setTimeout(() => {
          const ws = peerWaiters.get(id)
          if (ws) { const i = ws.indexOf(done); if (i >= 0) ws.splice(i, 1) }
          res(false)
        }, wait)
        const done = () => { clearTimeout(timer); res(true) }
        const ws = peerWaiters.get(id) ?? []
        ws.push(done)
        peerWaiters.set(id, ws)
      })
    },
    reload: (doc) => loadLatest(doc, false),
    refresh: (doc) => loadLatest(doc, true),
    remove(doc) {
      const o = owner.get(doc)
      if (o) {   // 第 2 页起的分页关掉了 ⇒ 只从那份档拿掉这一页
        const t = tabs.get(o)
        owner.delete(doc)
        if (t) { t.pages = t.pages.filter((x) => x !== doc); t.names.delete(doc) }
        return
      }
      drop(doc)
      if (cur !== doc) return
      cur = null
      const a = d.tabs()?.activeId()
      setCur(a && tabs.has(a) ? a : tabs.keys().next().value ?? null)
      if (!cur) emit()
    },
    fileOf: (doc) => api.get(doc),
    pagesOf: (doc) => api.get(doc)?.pages.slice() ?? [],
    serializeFile,
    async addPage(o) {
      const T = d.tabs()
      const t = api.current()
      const a = T?.activeId() ?? null
      if (!T || !t || !a || leadOf(a) !== t.doc) return { ok: false, error: 'not_cloud_page', message: 'the front tab is not a cloud drawboard page' }
      if (t.pages.length >= DRAWBOARD_PAGES_MAX) return { ok: false, error: 'too_many_pages', message: `a drawboard holds at most ${DRAWBOARD_PAGES_MAX} pages` }
      await loadTail
      const empty = { format: DRAWBOARD_FORMAT, version: 1, createdBy: '堤麟画板', width: o.width, height: o.height, layers: [] }
      const name = o.name && o.name.trim() ? o.name.trim() : defaultPageName(d.lang?.() ?? null, t.pages.length + 1)
      const turn = loadTail.then(() => openPages(T, t, [{ name, project: empty, bg: o.bg }]))
      loadTail = turn.catch(() => undefined)
      const [doc] = await turn
      api.sync()
      t.auto.change()
      return { ok: true, doc, page: t.pages.indexOf(doc) + 1, name }
    },
    async importPages(id) {
      const T = d.tabs()
      const t = api.current()
      const a = T?.activeId() ?? null
      if (!T || !t || !a || leadOf(a) !== t.doc) return { ok: false, error: 'not_cloud_page', message: 'the front tab is not a cloud drawboard page' }
      if (t.proj?.id === id) return { ok: false, error: 'same_file', message: 'that is this drawboard itself' }
      const r = await d.get(id)
      if (!r.ok) { d.onLoadFailed?.(r.err); return { ok: false, error: 'load_failed' } }
      const parts = splitDrawboardPages(r.data.project)
      if (t.pages.length + parts.length > DRAWBOARD_PAGES_MAX) return { ok: false, error: 'too_many_pages', message: `a drawboard holds at most ${DRAWBOARD_PAGES_MAX} pages` }
      // 来源档的第 1 页没名字 ⇒ 用来源档名（看得出是从哪份并进来的）
      const src = d.name(r.data.title)
      const list = parts.map((pg, i) => ({ name: pg.name ?? (i === 0 ? src : `${src} ${defaultPageName(d.lang?.() ?? null, i + 1)}`), project: pg.project }))
      const turn = loadTail.then(() => openPages(T, t, list))
      loadTail = turn.catch(() => undefined)
      const made = await turn
      api.sync()
      t.auto.change()
      return { ok: true, added: made.length, doc: made[0], page: t.pages.indexOf(made[0]) + 1 }
    },
    renamePage(doc, name) {
      const t = api.get(doc)
      if (!t) return { ok: false, error: 'not_cloud_page' }
      const nm = name && name.trim() ? name.trim().slice(0, 80) : null
      t.names.set(doc, nm)
      d.tabs()?.label?.(doc, pageLabel(t, doc))
      t.auto.change()
      return { ok: true, doc, page: t.pages.indexOf(doc) + 1, name: nm }
    },
    async deletePage(doc) {
      const T = d.tabs()
      const t = api.get(doc)
      if (!T || !t) return { ok: false, error: 'not_cloud_page' }
      if (t.pages.length <= 1) return { ok: false, error: 'last_page', message: 'a drawboard keeps at least one page' }
      if (!T.close) return { ok: false, error: 'not_supported' }
      await loadTail
      const i = t.pages.indexOf(doc)
      const nm = t.names.get(doc) ?? null
      t.pages.splice(i, 1); t.names.delete(doc); owner.delete(doc)
      if (i === 0) rekey(t, t.pages[0])
      switching++
      let gone = false
      try { gone = await T.close(doc) } finally { switching-- }
      if (!gone) {   // 没拿掉（对话框开着…）⇒ 还原
        if (i === 0) { t.pages.unshift(doc); t.names.set(doc, nm); rekey(t, doc) } else { t.pages.splice(i, 0, doc); t.names.set(doc, nm); owner.set(doc, t.doc) }
        return { ok: false, error: 'close_failed', message: 'close any open dialog in the drawboard and try again' }
      }
      // 新的第 1 页没名字时标签照档名（第 2 页起才带缺省页名）
      t.pages.forEach((x) => T.label?.(x, pageLabel(t, x)))
      api.sync()
      t.auto.change()
      return { ok: true, pages: t.pages.length }
    },
    async activatePage(doc) {
      const T = d.tabs()
      const t = api.get(doc)
      if (!T || !t) return { ok: false, error: 'not_cloud_page' }
      await loadTail
      if (T.activeId() !== doc && !T.activate(doc)) return { ok: false, error: 'activate_failed' }
      api.sync()
      return { ok: true, doc, page: t.pages.indexOf(doc) + 1 }
    },
    get switching() { return switching > 0 },
    get dirty() { for (const t of tabs.values()) if (t.auto.dirty) return true; return false },
    get busy() { for (const t of tabs.values()) if (t.auto.busy) return true; return false },
    // 切背景、交出主位各叫一次：前一发还在路上 ⇒ 排在它后面、轮到时内容已存过就不再发（ifDirty）
    flushDirty() { for (const t of tabs.values()) if (t.auto.dirty && t.proj) void t.auto.flush({ ifDirty: true }) },
    leaveDirty(post) {
      let n = 0
      for (const t of tabs.values()) {
        if (!t.proj || !(t.auto.dirty || t.auto.busy)) continue
        const id = t.proj.id
        const tell = !neg('drawboard_hide_no_notice')
        // 先报（同步·还在 hidden 事件里）再存：别页一变前台就知道要等
        if (tell) post.leave(id)
        n++
        // 排在在途那发后面（ifDirty：轮到时已存过就不再发）·整条跑完才报完
        const end = () => { if (tell) post.done(id) }
        t.auto.flush({ ifDirty: true }).then(end, end)
      }
      return n
    },
  }
  return api
}

/** 同一张画板开在两个浏览器分页：分页之间互报「哪份存成了哪版」（同源 BroadcastChannel·
 *  自己发的自己收不到）。收到 ⇒ 交给 cloud.remoteSaved。没有 BroadcastChannel（旧浏览器）⇒ 只剩服务端 409 那道。 */
export const DRAWBOARD_SAVED_CHANNEL = 'dilin-drawboard-saved'
/** same／prev＝静默换格式那发（内容跟 prev 那版一样）·saving＝一发打出去了（on）／没存成收场（off）——
 *  交出主位那页刚开始存、接手那页马上拉会拉到旧版 ⇒ 接手那页见「正在存」就先等它落地（onSaving 交给 cloud.remoteSaving） */
export type SavedMsg = { type: 'saved'; id: string; updated_at: string; same?: true; prev?: string | null }
export type SavingMsg = { type: 'saving'; id: string; on: boolean }
/** 转背景那一刻（hidden 同步）报「这份有没存的改动、马上存」（on）·那份排着的存档全跑完报 off（见 CloudTabs.leaveDirty） */
export type LeavingMsg = { type: 'leaving'; id: string; on: boolean }
export type SavedChannel = { post(id: string, updatedAt: string, info?: SavedInfo): void; saving(id: string, on: boolean): void; leaving(id: string, on: boolean): void; close(): void }
export function openSavedChannel(onRemote: (id: string, updatedAt: string, info?: SavedInfo) => void, BC: typeof BroadcastChannel | undefined = typeof BroadcastChannel === 'undefined' ? undefined : BroadcastChannel, onSaving?: (id: string, on: boolean) => void, onLeaving?: (id: string, on: boolean) => void): SavedChannel {
  if (!BC) return { post() {}, saving() {}, leaving() {}, close() {} }
  const ch = new BC(DRAWBOARD_SAVED_CHANNEL)
  ch.onmessage = (e: MessageEvent) => {
    const s = e.data as Partial<SavingMsg | LeavingMsg> | null
    if (s && (s.type === 'saving' || s.type === 'leaving') && typeof s.id === 'string' && typeof s.on === 'boolean') { (s.type === 'saving' ? onSaving : onLeaving)?.(s.id, s.on); return }
    const m = e.data as Partial<SavedMsg> | null
    if (!(m && m.type === 'saved' && typeof m.id === 'string' && typeof m.updated_at === 'string')) return
    if (m.same === true && (typeof m.prev === 'string' || m.prev === null)) onRemote(m.id, m.updated_at, { same: true, prev: m.prev })
    else onRemote(m.id, m.updated_at)
  }
  return {
    post(id, updatedAt, info) { const m: SavedMsg = { type: 'saved', id, updated_at: updatedAt, ...(info?.same ? { same: true as const, prev: info.prev } : {}) }; try { ch.postMessage(m) } catch { /* 已关 */ } },
    saving(id, on) { const m: SavingMsg = { type: 'saving', id, on }; try { ch.postMessage(m) } catch { /* 已关 */ } },
    leaving(id, on) { const m: LeavingMsg = { type: 'leaving', id, on }; try { ch.postMessage(m) } catch { /* 已关 */ } },
    close() { ch.close() },
  }
}

/** 云档分页的关闭与切换（包上游命令·id 不变·菜单、分页 ×、agent 走的都是这支）：
 *  ① 关一个云档分页、别的云档分页还在 ⇒ 先存回云盘（存不成问要不要丢）·摘掉 host 再照暂存分页关掉（上游关宿主＝换成空白·⛔ 拿掉）；
 *     只剩这一个云档分页 ⇒ 照原本（换成空白新图·installHostClose 解绑）。
 *  ② 關閉其他／關閉全部：上游跳过 host 分页 ⇒ 先把多出来的云档分页照 ① 关掉，再交上游。
 *  ③ 有分页正在载 ⇒ 切分页先挡掉（Project.load 逐层 await·切过去剩下的层会落进那份）。 */
export type CloudTabHooks = {
  isCloud: (doc: string) => boolean
  /** 关之前：先存；存不成问使用者（false＝不关） */
  beforeClose: (doc: string) => Promise<boolean>
  closed: (doc: string) => void
  switching: () => boolean
  /** 多页：这个分页那份档的所有页（第 1 页在前）·没给＝每份档只有一页 */
  pagesOf?: (doc: string) => string[]
  /** 多页：人手按 × 关一份多页档前问一句（n＝几页·false＝不关） */
  confirmCloseFile?: (n: number) => boolean
}
export const CLOUD_TAB_CMDS = ['ps.document.close', 'ps.file.close', 'ps.file.closeOthers', 'ps.file.closeAll', 'ps.document.activate'] as const
export function installCloudTabs(site: DlSite, h: CloudTabHooks): boolean {
  const T = site.Tabs
  const docClose = site.CMD.map['ps.document.close']
  if (!T || !docClose) return false
  const busy = { ok: false, error: 'loading' }
  const removeTab = async (doc: string): Promise<Params> => {
    if (!(await h.beforeClose(doc))) return { ok: false, cancelled: true }
    if (!T.has(doc)) return { ok: true, closed: 0 }
    T.host(doc, false)
    const r = await docClose.run.call(docClose, { document: doc, ui: false })
    if (T.has(doc)) { T.host(doc, true); return (r as Params) ?? { ok: false } }   // 没关成（对话框开着…）⇒ 还原
    h.closed(doc)
    return { ok: true, closed: 1 }
  }
  const others = (keep: string | null) => T.ids().filter((x) => x !== keep && h.isCloud(x))
  const pagesOf = (doc: string) => { const g = h.pagesOf?.(doc) ?? []; return g.length ? g : [doc] }
  /** 静静拿掉一个分页（不问·不存：已经先存过／整份档已解绑） */
  const dropPage = async (x: string) => {
    if (!T.has(x)) return
    T.host(x, false)
    await docClose.run.call(docClose, { document: x, ui: false, save: false, _page: true })
    if (T.has(x)) T.host(x, true)
    else h.closed(x)
  }
  /** 多页：关一份多页档＝所有页一起关（⛔ 只关一页：那等于默默删掉那一页）。先关第 1 页（存过才真关）·关成了才收第 2 页起 */
  const closeFile = async (orig: DlCmd, p: Params, grp: string[]): Promise<unknown> => {
    if (p.ui === true && h.confirmCloseFile && !h.confirmCloseFile(grp.length)) return { ok: false, cancelled: true }
    const lead = grp[0], rest = grp.slice(1)
    const otherFiles = T.ids().filter((x) => h.isCloud(x) && !grp.includes(x))
    let r: unknown
    if (otherFiles.length === 0) {
      // 只剩这份档：第 1 页照原本（上游换成空白新图·installHostClose 解绑）——先存回云盘（⛔ 解绑后第 2 页起的改动没地方存）
      if (!(await h.beforeClose(lead))) return { ok: false, cancelled: true }
      r = await docClose.run.call(docClose, { document: lead, ui: p.ui, save: p.save, _single: true })
      const x = r as { ok?: boolean; cancelled?: boolean } | null
      if (x && (x.cancelled || x.ok === false)) return r
    } else {
      r = await removeTab(lead)
      if ((r as Params).ok === false) return r
    }
    for (const x of rest) await dropPage(x)
    return { ok: true, closed: grp.length }
  }
  const closeOne = (orig: DlCmd, p: Params, doc: string | null) => {
    if (p._single || p._page) return orig.run.call(orig, p)   // 上游关宿主那支回叫 ps.file.close·照原本；_page＝网站自己删一页
    if (p.ui === true && h.switching()) return busy
    if (!doc || !h.isCloud(doc)) return orig.run.call(orig, p)
    const grp = pagesOf(doc)
    if (grp.length > 1) return closeFile(orig, p, grp)
    if (others(doc).length === 0) return orig.run.call(orig, p)
    return removeTab(doc)
  }
  /** 别份档（每份一个代表·keep 那份不算） */
  const otherLeads = (keep: string | null) => {
    const mine = keep ? pagesOf(keep) : []
    const seen = new Set<string>()
    for (const x of T.ids()) if (h.isCloud(x) && !mine.includes(x)) seen.add(pagesOf(x)[0])
    return [...seen]
  }
  /** 整份档关掉（关闭其他／全部用）：先存·第 1 页照 removeTab·再收其余页 */
  const removeFile = async (lead: string): Promise<Params> => {
    const grp = pagesOf(lead)
    const r = await removeTab(grp[0])
    if (r.ok === false) return r
    for (const x of grp.slice(1)) await dropPage(x)
    return r
  }
  const wraps: Record<(typeof CLOUD_TAB_CMDS)[number], (orig: DlCmd, p: Params) => unknown> = {
    'ps.document.close': (orig, p) => closeOne(orig, p, p.document === undefined ? T.activeId() : T.resolve(p.document as string | number)),
    'ps.file.close': (orig, p) => closeOne(orig, p, T.activeId()),
    'ps.file.closeOthers': async (orig, p) => {
      if (p.ui === true && h.switching()) return busy
      const keep = T.activeId()
      let n = 0
      for (const x of otherLeads(keep)) { const r = await removeFile(x); if (r.ok === false) return r; n++ }
      if (keep && T.activeId() !== keep) T.activate(keep)
      const r = (await orig.run.call(orig, p)) as Params | null
      return { ...(r ?? {}), closed: Number(r?.closed ?? 0) + n }
    },
    'ps.file.closeAll': async (orig, p) => {
      if (p.ui === true && h.switching()) return busy
      let n = 0
      const first = T.ids().find((y) => h.isCloud(y)) ?? null
      for (const x of otherLeads(first)) { const r = await removeFile(x); if (r.ok === false) return r; n++ }
      // 留下的那份档有好几页：先存·上游关全部（跳过 host 分页、换掉第 1 页）关成了才收其余页（⛔ 先收：按了取消就少了几页）
      const grp = first ? pagesOf(first) : []
      if (grp.length > 1 && !(await h.beforeClose(grp[0]))) return { ok: false, cancelled: true }
      const r = (await orig.run.call(orig, p)) as Params | null
      if (r && (r.cancelled || r.ok === false)) return r
      for (const x of grp.slice(1)) { await dropPage(x); n++ }
      return { ...(r ?? {}), closed: Number(r?.closed ?? 0) + n }
    },
    'ps.document.activate': (orig, p) => (h.switching() ? busy : orig.run.call(orig, p)),
  }
  for (const id of CLOUD_TAB_CMDS) {
    const orig = site.CMD.map[id]
    if (!orig || (orig as DlCmd & { __dlTabs?: boolean }).__dlTabs) continue
    const meta: Params = { ...orig, __dlTabs: true }
    delete meta.id; delete meta.run
    site.CMD.reg(id, meta, (p) => wraps[id](orig, p ?? {}))
  }
  return true
}

// ── 多页命令：一份 .dlcanvas 放多个文件分页·命令开得了新页、切页、改页名 ──
//   page.* 都对「前面那份云档」：page 参数＝第几页（1 起算）或页名；doc＝分页 id（右键菜单用）。人手（ui:true）改名／删页先问一句。
export type PageCmdHooks = {
  cloud: () => CloudTabs
  /** 人手改名：问新名字（null＝取消） */
  prompt?: (msg: string, def: string) => string | null
  confirm?: (msg: string) => boolean
  text: (k: 'name' | 'delete', n: number, name: string) => string
}
export const PAGE_CMDS = ['page.list', 'page.new', 'page.activate', 'page.rename', 'page.delete', 'page.import'] as const
export function installPageCommands(site: DlSite, h: PageCmdHooks): void {
  const T = () => site.Tabs ?? null
  const cur = () => h.cloud().current()
  const info = () => (site.CMD.map['ps.document.list'] ? site.CMD.run('ps.document.list', {}) as { documents?: Array<{ id: string; width: number; height: number }> } : null)
  const noFile = { ok: false, error: 'not_cloud_page', message: 'the front tab is not a cloud drawboard (open one from the drive first)' }
  /** page／doc 参数 ⇒ 那一页的分页 id（缺省＝前面那页） */
  const pick = (p: Params): string | null => {
    const t = cur()
    if (!t) return null
    if (typeof p.doc === 'string') return t.pages.includes(p.doc) ? p.doc : null
    if (p.page === undefined || p.page === null) { const a = T()?.activeId(); return a && t.pages.includes(a) ? a : null }
    if (typeof p.page === 'number') return t.pages[p.page - 1] ?? null
    const s = String(p.page).trim()
    if (/^\d+$/.test(s)) return t.pages[Number(s) - 1] ?? null
    for (const x of t.pages) if ((t.names.get(x) ?? '') === s) return x
    return null
  }
  const reg = (id: string, params: string, fn: (p: Params) => unknown) => site.CMD.reg(id, { i18n: '', params }, (p) => fn(p ?? {}))
  reg('page.list', '{} 這份畫板（.dlcanvas）的所有頁：{file, active（第幾頁）, pages:[{page（1 起算）, name, width, height, active}]}', () => {
    const t = cur()
    if (!t) return noFile
    const docs = info()?.documents ?? []
    const a = T()?.activeId()
    return {
      ok: true, file: t.proj?.id ?? null,
      active: t.pages.indexOf(a ?? '') + 1,
      pages: t.pages.map((x, i) => { const dd = docs.find((y) => y.id === x); return { page: i + 1, name: t.names.get(x) ?? null, width: dd?.width ?? null, height: dd?.height ?? null, active: x === a } }),
    }
  })
  reg('page.new', '{name?, width?, height?（缺省＝目前這頁的尺寸）, background?:"#rrggbb"|null（透明）="#ffffff"} 在這份畫板新增一頁（每頁尺寸、名字各自設·存在同一份 .dlcanvas）·切到新頁 → {page, name}', async (p) => {
    const t = cur()
    if (!t) return noFile
    const side = (v: unknown, def: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 20000 ? v : def)
    if ((p.width !== undefined && side(p.width, -1) < 0) || (p.height !== undefined && side(p.height, -1) < 0)) return { ok: false, error: 'bad_size', message: 'width/height are whole pixels 1..20000' }
    let name = typeof p.name === 'string' ? p.name : null
    if (p.ui === true && h.prompt) {
      const ask = h.prompt(h.text('name', t.pages.length + 1, ''), defaultPageName(site.Lang?.cur, t.pages.length + 1))
      if (ask === null) return { ok: false, cancelled: true }
      name = ask
    }
    const bg = p.background === null || p.background === 'transparent' ? null : typeof p.background === 'string' && /^#[0-9a-f]{6}$/i.test(p.background) ? p.background : '#ffffff'
    return h.cloud().addPage({ name, width: side(p.width, site.Doc?.width ?? 1200), height: side(p.height, site.Doc?.height ?? 675), bg })
  })
  reg('page.activate', '{page:第幾頁（1 起算）|頁名} 切到這份畫板的那一頁 → {page}', (p) => {
    const x = pick(p)
    if (!cur()) return noFile
    if (!x || p.page === undefined && p.doc === undefined) return { ok: false, error: 'no_page', message: 'give page (1-based number or page name)' }
    return h.cloud().activatePage(x)
  })
  reg('page.rename', '{page?（缺省＝目前這頁）, name（空字串＝拿掉頁名）} 改這一頁的名字 → {page, name}', (p) => {
    const t = cur()
    if (!t) return noFile
    const x = pick(p)
    if (!x) return { ok: false, error: 'no_page' }
    let name = typeof p.name === 'string' ? p.name : null
    if (p.ui === true && h.prompt) {
      const ask = h.prompt(h.text('name', t.pages.indexOf(x) + 1, t.names.get(x) ?? ''), t.names.get(x) ?? defaultPageName(site.Lang?.cur, t.pages.indexOf(x) + 1))
      if (ask === null) return { ok: false, cancelled: true }
      name = ask
    } else if (name === null) return { ok: false, error: 'no_name', message: 'give name' }
    return h.cloud().renamePage(x, name)
  })
  reg('page.delete', '{page:第幾頁|頁名（一定要給）} 從這份畫板刪掉那一頁（至少留一頁；刪了不能 Ctrl+Z 復原）→ {pages 剩幾頁}', async (p) => {
    const t = cur()
    if (!t) return noFile
    if (p.page === undefined && p.doc === undefined) return { ok: false, error: 'no_page', message: 'give page (1-based number or page name) to delete' }
    const x = pick(p)
    if (!x) return { ok: false, error: 'no_page' }
    if (p.ui === true && h.confirm && !h.confirm(h.text('delete', t.pages.indexOf(x) + 1, t.names.get(x) ?? ''))) return { ok: false, cancelled: true }
    return h.cloud().deletePage(x)
  })
  reg('page.import', '{id（另一份 .dlcanvas 的雲端硬碟檔 id）} 把那份畫板的所有頁接到這份後面（合併幾份畫板成一份多頁檔；來源那份不動）→ {added, page（第一張接進來的是第幾頁）}', (p) => {
    if (!cur()) return noFile
    if (typeof p.id !== 'string' || !p.id) return { ok: false, error: 'no_id', message: 'give id of another .dlcanvas in the drive' }
    return h.cloud().importPages(p.id)
  })
}

// ── AI 交来的画板命令在这一页的画板里跑（网站：/api/mcp 的 drawboard_* 工具；单机版：本机 MCP）──
//   活从 lib/drawboard-relay 经 /api/drawboard/relay 取来（drawboard-relay-client.ts）；跑完的结果原路交回。
//   单机版（游客整页·本机小服务 tools/serve.mjs 开的 MCP）也照这一支跑：活从 /_agent/poll 取来（shared/agent-link.ts）。
//   命令照画板自己的 CMD.run 跑 ⇒ 被网站改过的（file.saveProject 存进云盘、file.exportPNG 导进云盘）照样是改过的那支；可撤销的照样进 Ctrl+Z。
export type RelayJobIn = { id: string; target?: string | null; targetDoc?: number | null; kind: 'run' | 'list' | 'preview' | 'batch'; by?: string; byKey?: string; imageDenied?: boolean; command?: string; params?: Params; filter?: string; maxSize?: number; steps?: { command: string; params?: Params }[] }

/** 会换掉整份文件的命令（它自己就是要换档·⛔ 当成「中途被换」） */
const switchesDoc = (command: string) => /^(ps\.|ai\.)?file\.(new|open)/.test(command) || /^ps\.document\.(new|open)$/.test(command)   // 含「打开为」ps.file.openAs、开新分页 ps.document.open（PSD／SVG／PDF／.ai 照分层开）
/** 智能对象「编辑内容／存回／关掉内容」：画板把同一页的文件暂时换成内嵌档、存回再换回母文件（文件序号会变·云盘档 id 不变）
 *  ⇒ 只核云盘档 id 没换（序号一变就会被误报成「使用者换了画板」·其实步骤跑了） */
// 多页：page.*（加页、切页、删页、并入）换的是同一份档的另一页（序号变、云盘档 id 不变）⇒ 同样只核云盘档 id
const switchesInnerDoc = (command: string) => /^(ps\.)?layer\.smartObjects\.(editContents|saveContents|closeContents)$/.test(command) || /^page\.(new|activate|delete|import)$/.test(command)
type DocKey = { id: string | null; serial: unknown }
const keyOf = (site: DlSite, cur?: () => string | null): DocKey => ({ id: cur ? cur() : null, serial: site.Doc?.serial })
/** 同一份：画板序号没变；原本有档 id 就也要同一个（原本没 id＝还没存过·第一次存档才拿到 id·不算换档） */
const sameDoc = (a: DocKey, b: DocKey) => a.serial === b.serial && (a.id === null || a.id === b.id)
// 原本没档 id（还没存过）也要核：前后档 id 要一样（都没存过也算一样·中途开了别份已存的就挡）
const sameFile = (a: DocKey, b: DocKey) => a.id === b.id
/** 这条命令跑完（或抛错）后还算同一份：开档／新建不核；进出智能对象内嵌档只核云盘档 id；其余序号也要一样 */
const stillSame = (command: string, a: DocKey, b: DocKey) => switchesDoc(command) || (switchesInnerDoc(command) ? sameFile(a, b) : sameDoc(a, b))
export type RelayReplyOut = { ok: true; result: unknown } | { ok: false; error: string; message?: string; dropped?: true }

/** 命令等的中间（图下载）使用者换开别份 ⇒ 画板本体按 Doc.serial 拒掉晚到的结果——这件是「真丢了」 */
class SwitchDrop extends Error {}
/** 这件活的真结局是「切档时在途、被丢掉」（run／preview 回失败带 dropped；batch 停在那一步的 error 带 dropped）·页面照它才提示「图丢了」 */
export function relayReplyDropped(r: RelayReplyOut): boolean {
  if (!r.ok) return r.dropped === true
  const e = (r.result as { error?: unknown } | null | undefined)?.error
  return !!e && typeof e === 'object' && (e as { dropped?: unknown }).dropped === true
}

/** 结果交回服务端前压成纯 JSON（画布元素、函数之类丢掉·循环引用 ⇒ 字串） */
export function relayJsonSafe(v: unknown): unknown {
  if (v === undefined) return null
  try {
    return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' || (typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement) ? undefined : x)))
  } catch { return String(v) }
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** cur＝这页现在开着哪份画板（.dlcanvas id·还没存过＝null）：给了 ⇒ 两条都核——
 *  ① 指名 A（job.target）的活跑之前这页已是别份 ⇒ 不跑、回 drawboard_changed；
 *  ② 每条命令前后比画板序号：命令自己不是开档／新建、跑的中间文件却换了 ⇒ 回 command_failed（结果可能落到新那份·叫角色先看）；
 *     batch 两步之间被换（⛔ 是上一步自己合法 file.openProject）⇒ 停在那一步。 */
/** site-bridge.js 挂的参数规格（__dlSite.spec） */
export type SiteSpec = {
  check(id: string, params: Record<string, unknown>): { error?: string; message?: string; warnings?: string[] } | null
  list(filter?: string): unknown
}
/** 参数不合规格（命令不存在、参数名不认得、型别／范围／选项不对）：没跑 */
export class SpecError extends Error {}
export async function runRelayJob(site: DlSite, job: RelayJobIn, cur?: () => string | null): Promise<RelayReplyOut> {
  if (!job.imageDenied) return runRelayJobBody(site, job, cur)
  // 1025（审 116180 F7）：网站说下活的身分没有生图权限 ⇒ 这件活跑的期间，画板扣点的生成命令（genai.js 进门同步判 __dlSite.genaiDenied）一律回 image_not_allowed
  const gate = site as DlSite & { genaiDenied?: number }
  gate.genaiDenied = (gate.genaiDenied ?? 0) + 1
  try { return await runRelayJobBody(site, job, cur) } finally { gate.genaiDenied = Math.max(0, (gate.genaiDenied ?? 1) - 1) }
}
async function runRelayJobBody(site: DlSite, job: RelayJobIn, cur?: () => string | null): Promise<RelayReplyOut> {
  if (cur && job.target && cur() !== job.target) return { ok: false, error: 'drawboard_changed', message: `this tab now has drawboard ${cur() ?? '(unsaved)'} open, not ${job.target}` }
  // 排队时开着的是没存过的新档 ⇒ 绑的是它的文件序号；跑之前序号变了（使用者开了别份）⇒ 不跑（⛔ 写进／存进别份）
  if (typeof job.targetDoc === 'number' && site.Doc?.serial !== job.targetDoc) return { ok: false, error: 'drawboard_changed', message: `the unsaved drawboard that was open when this was queued has been replaced (this tab now has ${cur?.() ?? '(unsaved)'} open); nothing was run` }
  // 参数规格（site-bridge.js 的 __dlSite.spec）：命令／参数名／型别不对 ⇒ 当场回错、不跑；说明没列到的参数 ⇒ 照跑、结果附 warnings
  const spec = (site as { spec?: SiteSpec }).spec
  const vet = (command: string, params: Params): { warnings?: string[] } => {
    const c = spec ? spec.check(command, params) : null
    if (c && c.error) throw new SpecError(c.message || c.error)
    return c && c.warnings ? { warnings: c.warnings } : {}
  }
  const withWarn = (r: unknown, w: { warnings?: string[] }): unknown => (w.warnings && r && typeof r === 'object' && !Array.isArray(r) ? { ...(r as Record<string, unknown>), warnings: w.warnings } : r)
  const run = async (command: string, params: Params): Promise<unknown> => {
    const w = vet(command, params)
    return withWarn(await runRaw(command, params), w)
  }
  const runRaw = async (command: string, params: Params): Promise<unknown> => {
    const before = keyOf(site, cur)
    let r: unknown
    try { r = await site.CMD.run(command, params) } catch (e) {
      // 等的中间换了档、画板本体丢了结果 ⇒ 记成「真丢了」（页面照它提示）
      if (!stillSame(command, before, keyOf(site, cur))) throw new SwitchDrop(`the user switched to another drawboard while ${command} was running — it was dropped and not added to any drawboard (${errMsg(e)})`)
      throw e
    }
    if (!stillSame(command, before, keyOf(site, cur))) throw new Error(`the user switched to another drawboard while ${command} was running — this step was dropped (nothing should have been added to the newly opened drawboard); check drawboard_preview before retrying`)
    return r
  }
  try {
    if (job.kind === 'run') {
      if (!job.command) return { ok: false, error: 'bad_job', message: 'command missing' }
      return { ok: true, result: relayJsonSafe(await run(job.command, job.params ?? {})) }
    }
    if (job.kind === 'list') {
      const list = (site.CMD as { list?: (f?: string) => unknown }).list
      return { ok: true, result: relayJsonSafe(spec ? spec.list(job.filter) : list ? list.call(site.CMD, job.filter) : Object.keys(site.CMD.map)) }
    }
    if (job.kind === 'preview') {
      const k0 = keyOf(site, cur)
      // drawboard_preview 带 mode／rect／scale／grid ⇒ 同一件活里先 preview.set（只管这一次）再截·⛔ 角色先另跑一发 drawboard_run
      if (job.params && typeof job.params.mode === 'string') await runRaw('preview.set', { ...job.params, sticky: false })
      const shot = (await runRaw('doc.renderPreview', { maxSize: job.maxSize ?? 1200 })) as Record<string, unknown> | null
      const inspect = await runRaw('doc.inspect', {})
      if (!sameDoc(k0, keyOf(site, cur))) throw new Error('the drawboard was switched while taking the preview; take it again')
      return { ok: true, result: { ...(shot ?? {}), inspect: relayJsonSafe(inspect) } }
    }
    if (job.kind === 'batch') {
      const steps = job.steps ?? []
      const results: unknown[] = []
      let last = keyOf(site, cur)
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        // 每步都整张重合成（大图一次约 0.4 秒）·几十步连跑会把页面（含外层对话框）卡成「无响应」
        // ⇒ 两步之间让出一次主线程：浏览器先处理打字、重画画面再跑下一步（⛔ 用 requestAnimationFrame：背景分页不触发会卡死）
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 0))
        if (!sameDoc(last, keyOf(site, cur))) return { ok: true, result: { done: i, total: steps.length, results, error: { step: i, command: s.command, message: 'drawboard_changed: the user switched to a different drawboard between steps; the remaining steps were not run' } } }
        let r: unknown
        try { r = relayJsonSafe(await run(s.command, s.params ?? {})); last = keyOf(site, cur) }
        catch (e) { return { ok: true, result: { done: i, total: steps.length, results, error: { step: i, command: s.command, message: errMsg(e), ...(e instanceof SwitchDrop ? { dropped: true } : {}) } } } }
        // 画板命令办不成也可能不抛、回 {ok:false, …}（已自己退回命令前）⇒ 一样停在这一步
        if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === false) return { ok: true, result: { done: i, total: steps.length, results, error: { step: i, command: s.command, message: JSON.stringify(r).slice(0, 500) } } }
        results.push(r)
      }
      return { ok: true, result: { done: steps.length, total: steps.length, results } }
    }
    return { ok: false, error: 'bad_job', message: `unknown kind ${String((job as { kind?: unknown }).kind)}` }
  } catch (e) {
    if (e instanceof SpecError) return { ok: false, error: 'bad_params', message: e.message }
    return { ok: false, error: 'command_failed', message: errMsg(e), ...(e instanceof SwitchDrop ? { dropped: true as const } : {}) }
  }
}
