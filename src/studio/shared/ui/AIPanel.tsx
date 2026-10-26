'use client'
// 「交給你的 AI」（游客宿主 renderChatSlot 的内容·放在登入版角色对话框那一格）：右栏要干净——
//   ① 一句短话＋「複製」：网站游客版复制短网址（还没建立 ⇒ 先建立、网址换成 /s/<码>·share-sync.ts；建立中「建立中…」、
//      失败白话一句并改复制当下网址）；开源单机版复制当下页面网址。短网址那份另有：只读提示、AI 要求编辑时的 6 位验证码
//      （大字＋倒数＋「複製」钮：写剪贴簿、写不进就把码选起来让人自己复制，按后「已複製」约 2 秒）、已配对时「收回 AI 編輯權」。怎么用、工程档格式、改完怎么交回，全写在页面服务端输出的
//      HTML 里给 AI 读（ui/AIBrief.tsx），由 AI 来教用户；右栏不再摆长段说明。
//   ⓪ 「複製」只复制网址；要不要在服务器暂存一份，由「工程檔放哪」决定——
//      「本機資料夾」（選擇資料夾·本机 AI 直接改）／「伺服器」（网站游客版才有·按了才建短网址、网址换成 /s/<码>·网页版 AI 也能改）。
//   ①b 「複製網址」下面：「選擇工程檔存放位置」（按了直接跳出选资料夹视窗）＋一行存在哪（选了这份就存进那个资料夾·本机 AI 直接改 project.json；不能挑资料夹的浏览器只一句提示）；
//      两版都有「下載到電腦」（存成可再打开的工程档 zip）。原在左栏。
//   ② 下面一排「前往 GitHub」「給個星星」：host.ts STUDIO_OSS_REPO_PUBLIC=true ⇒ 新分页开仓页；false ⇒ 照常显示、按了没反应。
//   ③ 两颗钮下面一行注册广告（studio_ad → SIGNUP_HREF·同分页开）：括号前后固定拆两行（adLines），括号不被折断。
//   ⑤ requireFolder（开源单机版）：还没选存放位置前整页盖一层透明挡板，点哪、按键都弹窗要先选（点到「選擇工程檔存放位置」那颗照样直接开选资料夹视窗、
//   点到「複製網址」照样复制）；有别的对话框（dialog-store·例如资料夹非空要不要建）排着时挡板整个让开，免得把确认钮吃掉；
//      不能挑资料夹的浏览器只说请换 Chrome、Edge。单机版不存浏览器、也不给「下載到電腦」。
//      AI 已经经本机 MCP 在这页动手（agent-link agentLinkActive）⇒ 挡板收起，右栏那行「還沒選存放位置」照留。
//   ④ 上面这组（短话、複製、两钮、注册）在栏内上下左右置中、四周留白（studio-ai-body：外层可捲、内层 my-auto 置中·内容比栏高时照常从顶捲）。
//   ⑥ inlineBox（编辑器给了才有）：栏底一块输入框——Alt+A 把选中的内容做成小卡插进来、旁边「一鍵複製」连字带卡复制、下面一句说明（./InlineCardBox.tsx）。
//      上下两段不互盖：上面清单区 flex-1 min-h-0 自己捲、输入框那块 flex-none 在底下占位；清单捲不完时输入框上缘一道阴影。
//   页头照登入版对话框那一行（titleIcon＝收合钮、title、headerExtra）；底色同对话框（editorShell.chatSurface）。

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { currentDialog, subscribeDialogs } from '../dialog-store'
import { agentLinkActive, subscribeAgentActive } from '../agent-link'
import type { StorageBackend } from '../types'
import { useStudioT } from '../StudioT'
import { SIGNUP_HREF, neutralServiceNames, shareEnabled } from '../host'
import type { ShareController, SharePairCode, ShareState } from '../share-sync'
import { buildAIPrompt, aiUsageKeys } from '../ai-prompt'
import { aiPanelCopyText, GATE_PASS_SELECTOR, gatePassKey, openStudioRepo, studioNeg } from '../ai-panel.pure'
import { editorShell } from '../theme/editor-shell-theme'
import type { ChatSlotOptions } from '../page-host'
import InlineCardBox, { copyText } from './InlineCardBox'

export interface AIPanelProps extends ChatSlotOptions {
  appName: string
  /** 网址里的编辑器代号（docs／sheets／…）。 */
  app: string
  store: { backend: StorageBackend; label: string }
  /** 编辑器的格式重点（format.summaryForAI）·只在负控退回修前画面时用。 */
  summary: string
  /** 短网址代存（网站游客版才有；开源单机版不给 ⇒ 「複製」照旧复制当下网址）。 */
  share?: ShareController | null
  /** 「下載到電腦」：存正在开的这份（工程档 zip）。 */
  onDownload?(): void
  /** 存在哪＋「選擇資料夾」（网站游客版与开源单机版都给）。 */
  folder?: AIPanelFolder
  busy?: boolean
  /** 开源单机版：选好存放位置前不能用（整页挡住）。 */
  requireFolder?: boolean
  /** 开源单机版「存给别家软件」：存在资料夹里才出（写进那个资料夹根目录）。 */
  otherApps?: { label: string; onSave(): void }
}

export interface AIPanelFolder {
  /** 这个浏览器能不能挑资料夹（showDirectoryPicker）。 */
  ok: boolean
  /** 这份现在存在资料夹里（否则存在浏览器里）。 */
  inFolder: boolean
  /** 资料夹名（inFolder 时显示）。 */
  label: string
  onPick(): void
}

const NO_SHARE: ShareState = { status: 'idle', code: null, aiPaired: false, pair: null, createFailed: false, gone: false }
const noShareSub = () => () => {}
const noShareGet = () => NO_SHARE

/** 倒数显示 m:ss。 */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 把元素里的字选起来（剪贴簿写不进时让人自己按复制）。 */
function selectText(el: HTMLElement | null) {
  if (!el) return
  try {
    const sel = window.getSelection(); const range = document.createRange()
    range.selectNodeContents(el); sel?.removeAllRanges(); sel?.addRange(range)
  } catch { /* 选不了就算了 */ }
}

/** 验证码那格：大字＋「複製」＋倒数（过期就不画）。 */
function PairBox({ pair }: { pair: SharePairCode }) {
  const t = useStudioT()
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const codeEl = useRef<HTMLParagraphElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h) }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const left = pair.expiresAt - now
  if (left <= 0) return null
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(pair.code) } catch { selectText(codeEl.current) }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex flex-col items-center gap-1.5 text-center" data-testid="studio-share-pair">
      <p className="text-[13px] font-semibold text-[#4A3528]">{t('studio_share_pair_title')}</p>
      <p ref={codeEl} className="text-[34px] leading-none font-bold tracking-[0.25em] text-[#4A3528] tabular-nums select-all" data-testid="studio-share-pair-code">{pair.code}</p>
      <button type="button" onClick={() => { void onCopy() }} data-testid="studio-share-pair-copy"
        className="h-8 px-4 rounded-xl border border-[#E7DCBE] bg-white text-[12px] font-semibold text-[#4A3528] hover:bg-[#F6F1E6]">
        {copied ? t('studio_share_pair_copied') : t('studio_share_pair_copy')}
      </button>
      <p className="text-[12px] text-[#6E5B45] leading-relaxed">{t('studio_share_pair_hint')}</p>
      <p className="text-[12px] text-amber-700 tabular-nums" data-testid="studio-share-pair-countdown">{t('studio_share_pair_countdown', { time: fmtCountdown(left) })}</p>
    </div>
  )
}

/** GitHub 官方猫标（Octicons mark-github）。 */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#F5B301" stroke="#D99A00" strokeWidth="1.2" strokeLinejoin="round" d="M12 2.8l2.75 5.57 6.15.9-4.45 4.34 1.05 6.12L12 16.84l-5.5 2.89 1.05-6.12L3.1 9.27l6.15-.9L12 2.8z" /></svg>
  )
}

/** 单机版还没选存放位置：整页透明挡板＋弹窗（只在浏览器里画·服务端渲染不出）。 */
function FolderGate({ folder }: { folder: AIPanelFolder }) {
  const t = useStudioT()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const shield = useRef<HTMLDivElement | null>(null)
  const dialog = useRef<HTMLDivElement | null>(null)
  const other = useSyncExternalStore(subscribeDialogs, currentDialog, () => null)
  // AI 已经经本机 MCP 在这页动手 ⇒ 不挡（见 agent-link.ts agentLinkActive）
  const agent = useSyncExternalStore(subscribeAgentActive, agentLinkActive, () => false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (currentDialog() || agentLinkActive()) return
      if (e.key === 'Escape') { setOpen(false); return }
      if (gatePassKey(e)) return   // 重新整理、开发者工具照常

      if (dialog.current?.contains(e.target as Node)) return
      e.preventDefault(); e.stopPropagation(); setOpen(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  if (!mounted || other || agent) return null
  const onShieldClick = (e: { clientX: number; clientY: number }) => {
    // 点到右栏那颗「選擇工程檔存放位置」⇒ 直接开选资料夹视窗；点别处 ⇒ 弹窗
    const el = shield.current
    if (el) el.style.pointerEvents = 'none'
    const under = document.elementFromPoint(e.clientX, e.clientY)
    if (el) el.style.pointerEvents = ''
    if (folder.ok && under?.closest('[data-testid="studio-change-folder"]')) { folder.onPick(); return }
    const pass = under?.closest<HTMLElement>(GATE_PASS_SELECTOR)
    if (pass) { pass.click(); return }
    setOpen(true)
  }
  return createPortal(
    <div ref={shield} data-testid="studio-folder-gate" onClick={onShieldClick} className="fixed inset-0 z-[2147483000]">
      {open && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) setOpen(false) }}>
          <div ref={dialog} role="dialog" aria-modal="true" data-testid="studio-folder-gate-dialog"
            className="w-[340px] max-w-[90vw] rounded-2xl bg-white p-5 shadow-xl flex flex-col gap-3 text-center">
            <p className="text-[15px] font-semibold text-[#4A3528]">{t('studio_require_folder_title')}</p>
            <p className="text-[13px] leading-relaxed text-[#6E5B45]">{t(folder.ok ? 'studio_require_folder_body' : 'studio_require_folder_unsupported')}</p>
            {folder.ok && (
              <button type="button" onClick={() => { setOpen(false); folder.onPick() }} data-testid="studio-folder-gate-pick"
                className="h-9 w-full rounded-xl bg-[#4A3528] text-[13px] font-semibold text-white keep-white hover:bg-[#5C4434]">
                {t('studio_pick_folder')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/** 注册广告拆两行：括号前一行、括号连同里面一行（没括号就一行）。 */
export function adLines(text: string): string[] {
  const i = text.search(/[（(]/)
  return i > 0 ? [text.slice(0, i).trim(), text.slice(i).trim()] : [text]
}

export default function AIPanel(p: AIPanelProps) {
  const t = useStudioT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // 有底下输入框时：上面清单区捲不完（下面还有内容）⇒ 输入框上缘一道阴影，看得出是「往下捲」而不是被盖住
  const listRef = useRef<HTMLDivElement | null>(null)
  const [below, setBelow] = useState(false)
  const measureBelow = () => { const l = listRef.current; setBelow(!!l && l.scrollTop + l.clientHeight < l.scrollHeight - 1) }
  useEffect(() => {
    const l = listRef.current
    if (!p.inlineBox || !l || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measureBelow)
    ro.observe(l)
    if (l.firstElementChild) ro.observe(l.firstElementChild)
    measureBelow()
    return () => ro.disconnect()
  }, [p.inlineBox])
  const legacy = studioNeg('studio-ai-panel-lean')   // 负控：退回修前那一大段说明
  const share = shareEnabled() ? p.share ?? null : null
  const ss = useSyncExternalStore(share ? share.subscribe : noShareSub, share ? share.get : noShareGet, share ? share.get : noShareGet)
  const longPrompt = () => buildAIPrompt({ t, appName: p.appName, backend: p.store.backend, folderName: p.store.label, summary: p.summary })
  const done = () => { setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1500) }
  const onCopy = () => {
    // 网站游客版：还没建立 ⇒ 先建立短网址、网址换成 /s/<码> 再复制；建立失败 ⇒ 复制当下网址（右栏一句白话）
    if (share && ss.status === 'shared') { void share.copyLink().then(r => copyText(r.text)).then(done); return }
    void copyText(aiPanelCopyText(window.location, longPrompt())).then(done)
  }
  const creating = ss.status === 'creating'
  const onServer = () => { if (share && ss.status !== 'shared' && !creating) void share.copyLink() }
  const shared = ss.status === 'shared'
  const pad = p.dense ? 'px-4 py-5' : 'px-6 py-8'
  const gap = p.dense ? 'gap-3' : 'gap-4'
  const pill = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-semibold shadow-sm transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0 whitespace-nowrap'

  return (
    <div className="flex h-full flex-col text-gray-800" style={editorShell.chatSurface} data-testid="studio-ai-panel">
      {p.requireFolder && p.folder && !p.folder.inFolder && <FolderGate folder={p.folder} />}
      <div className="px-3 py-2 border-b border-[#E7E0D2] shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {p.titleIcon}
          <span className="text-sm font-semibold text-[#4A3528] truncate" data-testid="studio-ai-title">{p.title ?? t('studio_ai_repo_title')}</span>
        </div>
        {p.headerExtra && <div className="flex items-center gap-1.5 shrink-0">{p.headerExtra}</div>}
      </div>
      <div ref={listRef} onScroll={p.inlineBox ? measureBelow : undefined} className={`flex-1 min-h-0 overflow-y-auto flex flex-col text-sm ${pad}`} data-testid="studio-ai-list">
        <div className={`my-auto mx-auto w-full max-w-[340px] flex flex-col ${gap}`} data-testid="studio-ai-body">
        <section data-testid="studio-ai-url" className="flex flex-col gap-3">
          <p className="text-[13px] text-[#6E5B45] leading-relaxed text-center" data-testid="studio-ai-url-line">{t('studio_ai_url_line')}</p>
          {legacy && (
            <>
              <ol className="space-y-1 text-[13px] text-[#6E5B45] leading-relaxed">{aiUsageKeys(neutralServiceNames()).map(k => <li key={k}>{t(k)}</li>)}</ol>
              <pre className="max-h-64 overflow-auto p-3 text-[12px] whitespace-pre-wrap font-sans" data-testid="studio-ai-prompt">{longPrompt()}</pre>
            </>
          )}
          <button type="button" onClick={onCopy} data-testid="studio-ai-copy"
            className="h-9 w-full rounded-xl bg-[#4A3528] text-[13px] font-semibold text-white keep-white hover:bg-[#5C4434]">
            {copied ? t('studio_ai_copied') : t('studio_ai_copy')}
          </button>
        {(p.folder || p.onDownload || share || p.otherApps) && (
          <section className="flex flex-col gap-1.5" data-testid="studio-ai-save">
            {p.folder && (
              <>
                {p.folder.ok ? (
                  <button type="button" onClick={p.folder.onPick} disabled={p.busy} data-testid="studio-change-folder"
                    className="h-9 w-full rounded-xl border border-[#E7DCBE] bg-white text-[13px] font-semibold text-[#4A3528] hover:bg-[#F6F1E6] disabled:opacity-40">
                    {t('studio_pick_folder')}
                  </button>
                ) : (
                  <p className="text-[11px] leading-relaxed text-[#8A7B66]" data-testid="studio-pane-browser-only">{t('studio_browser_only')}</p>
                )}
              </>
            )}
            <p className="text-[12px] text-[#6E5B45] truncate text-center" data-testid="studio-pane-where" data-backend={p.folder?.inFolder ? 'folder' : shared ? 'server' : 'opfs'}>
              {/* 已改存到资料夹 ⇒ 显示那个资料夹（放过伺服器也一样：工程现在读写的是资料夹） */}
              {p.folder?.inFolder ? t('studio_where_folder', { name: p.folder.label }) : shared ? t('studio_where_server') : p.requireFolder ? t('studio_where_none') : t('studio_where_opfs')}
            </p>
            {share && !shared && (
              <button type="button" onClick={onServer} disabled={creating} aria-busy={creating || undefined} data-testid="studio-share-create"
                className="h-9 w-full rounded-xl border border-[#E7DCBE] bg-white text-[13px] font-semibold text-[#4A3528] hover:bg-[#F6F1E6] disabled:opacity-40">
                {creating ? t('studio_share_creating') : t('studio_pick_server')}
              </button>
            )}
            {ss.createFailed && <p className="text-[12px] text-red-600 leading-relaxed" role="status" data-testid="studio-share-failed">{t('studio_share_create_failed')}</p>}
          </section>
        )}
          {p.otherApps && p.folder?.inFolder && !shared && (
              <button type="button" onClick={p.otherApps.onSave} disabled={p.busy} data-testid="studio-other-apps"
                className="h-9 w-full rounded-xl border border-[#E7DCBE] bg-white text-[13px] font-semibold text-[#4A3528] hover:bg-[#F6F1E6] disabled:opacity-40">
                {p.otherApps.label}
              </button>
            )}
          {p.onDownload && (
              <button type="button" onClick={p.onDownload} disabled={p.busy} data-testid="studio-export"
                className="h-9 w-full rounded-xl border border-[#E7DCBE] bg-white text-[13px] font-semibold text-[#4A3528] hover:bg-[#F6F1E6] disabled:opacity-40">
                {t('studio_download')}
              </button>
            )}
          {ss.gone && <p className="text-[12px] text-amber-700 leading-relaxed" role="status" data-testid="studio-share-gone">{t('studio_share_gone_notice')}</p>}
          {ss.status === 'readonly' && <p className="text-[12px] text-amber-700 leading-relaxed" role="status" data-testid="studio-share-readonly">{t('studio_share_readonly')}</p>}
        </section>
        {ss.status === 'shared' && ss.pair && <PairBox pair={ss.pair} />}
        {ss.status === 'shared' && ss.aiPaired && (
          <section className="flex flex-col gap-2" data-testid="studio-share-paired">
            <p className="text-[12px] text-[#6E5B45] leading-relaxed">{t('studio_share_ai_paired')}</p>
            <button type="button" onClick={() => { void share?.revokeAi() }} data-testid="studio-share-revoke"
              className="h-8 w-full rounded-xl border border-red-200 bg-white text-[12px] font-semibold text-red-700 hover:bg-red-50">{t('studio_share_revoke')}</button>
          </section>
        )}
        <div className="flex items-center justify-center gap-2 flex-wrap" data-testid="studio-oss-buttons">
          <button type="button" onClick={() => { openStudioRepo(window) }} data-testid="studio-oss-github"
            className={`${pill} bg-[#24292F] text-white keep-white hover:bg-[#32383F]`}>
            <GithubMark />{t('studio_oss_github')}
          </button>
          <button type="button" onClick={() => { openStudioRepo(window) }} data-testid="studio-oss-star"
            className={`${pill} bg-[#FFF8E1] text-[#8A6100] border border-[#F3D98B] hover:bg-[#FFF1C7]`}>
            <StarIcon />{t('studio_oss_star')}
          </button>
        </div>
        {!studioNeg('studio-ai-signup-line') && (
          <a href={SIGNUP_HREF} target="_blank" rel="noopener" className="block rounded-xl bg-[#FBF8EF] border border-[#EEE4B8] px-3 py-2 text-center text-[13px] text-[#8A6D3B] hover:bg-[#F4ECD6]" data-testid="studio-ad">{adLines(t('studio_ad')).map((l, n) => <span key={n} className="block">{l}{n ? ' →' : ''}</span>)}</a>
        )}
        </div>
      </div>
      {p.inlineBox && below && (
        // 清单底边往上一段渐隐（零高占位·不吃版面）：捲不完时看得出「往下还有」
        <div className="relative h-0 flex-none" aria-hidden>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to bottom, transparent, ${editorShell.chatSurface.backgroundColor} 85%)` }} data-testid="studio-ai-list-fade" />
        </div>
      )}
      {p.inlineBox && <InlineCardBox box={p.inlineBox} app={p.app} dense={p.dense} below={below} />}
    </div>
  )
}
