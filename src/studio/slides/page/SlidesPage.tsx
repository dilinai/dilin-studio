'use client'


// 简报编辑整页（顶栏、左栏「投影片｜大綱｜雲端硬碟」、中栏工具列＋画布＋本页设定与元件清单、右栏、弹窗、快捷键）。
//   登入版与游客版渲染同一份；网站的东西（接口、登入、云盘、角色对话、AI 编辑保护罩、媒体签名网址）全经宿主 host（./host.ts）。
//   游客版宿主见 ./guest-page.tsx（接口那一层在 ./local-api.ts：浏览器里对本机工程档做跟网站接口同形的处理）。

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { EditorLoadingArt } from '../../shared/ported/EditorLoadingArt'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { registerDesktopBeforeClose } from '../../shared/desktop-before-close'
import { isSlidesVisibility, type SlidesVisibility } from '../share-visibility'
import { injectEditScript, stripEditScript, exportSlidesHtml, playSlidesHtml, extractSlides } from '../html-utils'
import type { Slide } from '../html-utils'
import { safeRandomUUID } from '../../shared/ported/safe-uuid'
import { useResponsiveLayout } from '../../shared/ported/useResponsiveLayout'
import DeckSlotPanel from '../editor/DeckSlotPanel'
import { LoadingPlaceholder } from '../../shared/ported/LoadingPlaceholder'
import { PanelCollapseButton, PanelCollapsedEdge } from '../../shared/ported/PanelCollapseHandle'
import SlidesFormatToolbar, { type SlidesSelState } from '../editor/SlidesFormatToolbar'
import { findFont, fontCssHref } from '../../shared/fonts/catalog'
import { slidesRestoreMode, slidesDraftText, isFlushableSlidesOp, splitReplayOps, combineSlidesDrafts, finishSlidesRestore, type SlidesFlushDraft, type SlidesFlushOp } from '../flush-draft'
import { promptDialog, alertDialog, confirmDialog } from '../../shared/dialog-store'
import { flushDeckBeforeSnapshot } from '../templates/flush-before-snapshot'
import { createEditDoneGate, type EditDoneOutcome } from '../templates/edit-done-gate'
import TemplatePickerModal, { type UserTemplate, type UserTemplateOps } from './TemplatePickerModal'
import { withoutDeckTemplates, type TemplateEntry } from '../templates/catalog'
import { themeCssFontIds, themeGoogleFamilies } from '../kit/themes'
import { CANVAS_WIDTH } from '../kit/types'
import ComponentCanvas, { type CanvasDrop, type FrameChange } from '../editor/ComponentCanvas'
import { History as CompHistory, buildEntry, duplicateOps, makeClip, newPlaceholder, pasteOps, type Clip as CompClip, type Step as CompStep } from '../editor/history'
import { groupBox, groupZMoves, moveGroup, resizeGroup } from '../editor/transform'
import { isDeckShortcutTarget, modKey } from '../editor/keys'
import { playKeyAction, targetPage } from '../editor/playKeys'
import SlidesPlayer, { type SlidesPlayerHandle } from '../editor/SlidesPlayer'
import { slideChangeIndex } from '../editor/slide-msg'
import { signedShape, slidesDisplayHtml } from '../window-mode'
import { skStepsFactory } from '../kit/components/steps'
import ComponentListPanel from '../editor/ComponentListPanel'
import LayoutPickerDialog from '../editor/LayoutPickerDialog'
import { fitStage, clampPanelH, dragPanelH, parsePanelH, PANEL_H_KEY } from '../editor/stage-fit'
import AnimationDialog from '../editor/AnimationDialog'
import { componentLabel, pageSummaryLines, placeholderKey, pptxReportLines } from '../editor/labels'
import { allComponentIds, applyComponentOp, deckThemeOf } from '../deck-components'
import PageSettingsPanel from '../editor/PageSettingsPanel'
import { SLIDES_LIVE_POLL_MS, deckWithDrafts, holdDraft, paragraphsText, shouldHoldAfterFailure, slidesLiveVerdict, type HeldDraft } from '../slides-live'
import { readFocusedRichEditor } from '../editor/RichTextEditor'
import { pageComponents } from '../kit/components/derive'
import { catalogFontIdsOf, resolveCtx } from '../kit/components/resolve'
import type { ComponentOp, Frame, SlideComponent, ZMove } from '../kit/components/types'
import { parseDeckV2, isDeckV2Marked, deckRevision, createSerialTaskQueue, createDocIssueGeneration, remapPageIndexAfterTocRebuild, remapQueuedOpForExec, resolveDeleteTarget, resolveConfirmedDelete, createDeckConflictGuard, nextDeckPanelIdentity, adoptDeckPanelIdentity, htmlSaveStatusFromResponse, createSaveStatusTimer, manualLayoutPageIndexes, type SaveStatusTimer, type OwnedSaveHandle, type DeckDataV2, type DeckPanelIdentity, type SlotEditInput } from '../deck-edit'
import type { EditorLoadFail, SlidesPageHost, UploadedAttachment } from './host'

type DeckPatchOp =
  | { kind: 'edit_slots'; pageIndex: number; pageId?: string; slots: SlotEditInput }
  | { kind: 'add_page'; afterIndex: number; afterPageId?: string; pageType: 'content' | 'transition' }
  | { kind: 'delete_page'; pageIndex: number; pageId?: string }
  | { kind: 'rename'; title: string }
  | { kind: 'edit_page_html'; pageIndex: number; pageId?: string; html: string }
  | { kind: 'set_theme'; themeId: string }
  | { kind: 'apply_template'; templateId: string }
  | { kind: 'apply_user_template'; sourceSlideId: string }
  | ComponentOp

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  images?: string[]
  files?: string[]
  versionId?: string
  steps?: { step: string }[]
  startedAt?: number
  finishedAt?: number
  streaming?: boolean
  failed?: boolean
  currentStep?: string
}

type SlidesLeftTab = 'slides' | 'outline' | 'drive'

const THUMB_W = 1024
const THUMB_H = THUMB_W * 9 / 16
const THUMB_OVERRIDE = `<style>html,body{overflow:hidden!important}section.slide,div.slide,[data-thumb-root]{display:flex!important;flex-direction:column}[data-step]{opacity:1!important;transform:none!important}*{animation:none!important;transition:none!important}.sk-stage{transform:scale(${THUMB_W / CANVAS_WIDTH})!important;transform-origin:center center!important}</style>`

function buildThumbDoc(headInner: string, sectionHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${headInner}${THUMB_OVERRIDE}</head><body>${sectionHtml}</body></html>`
}

function SlideThumb({ doc, width }: { doc: string; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [boxW, setBoxW] = useState(width)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setVisible(true)
    }, { rootMargin: '200px' })
    io.observe(el)
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0) setBoxW(el.clientWidth) })
    ro.observe(el)
    return () => { io.disconnect(); ro.disconnect() }
  }, [])
  const scale = boxW / THUMB_W
  return (
    <div ref={ref} className={`relative w-full overflow-hidden rounded-lg ${editorShell.softSurface} pointer-events-none`} style={{ aspectRatio: '16 / 9' }} data-testid="slides-thumb">
      {visible ? (
        <iframe
          srcDoc={doc}
          sandbox=""
          tabIndex={-1}
          scrolling="no"
          aria-hidden
          className="border-0 select-none"
          style={{ width: THUMB_W, height: THUMB_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      ) : (
        <div className={`absolute inset-0 ${editorShell.maskColor} animate-pulse`} />
      )}
    </div>
  )
}

const EDIT_DONE_TIMEOUT_MS = 3000

const SAVE_FAILED_STATES: ReadonlySet<string> = new Set(['conflict', 'save_conflict', 'edit_failed', 'page_gone', 'page_ambiguous', 'restore_failed', 'restore_unverified'])

export default function SlidesPage({ host }: { host: SlidesPageHost }) {
  const searchParams = host.useSearchParams()
  const router = host.useRouter()
  const language = useStudioLang()
  const t = useStudioT()
  const { isNarrow } = useResponsiveLayout()
  const slideLang: 'zh-TW' | 'zh-CN' = host.slideLang

  const [authed, setAuthed]           = useState<boolean | null>(null)
  const [, setMessages]       = useState<Message[]>([])
  const [loading, ]         = useState(false)
  const [htmlContent, setHtmlContent] = useState('')
  const [slides, setSlides]           = useState<Slide[]>([])
  const [currentSlide, setCurrentSlide] = useState(0)
  const currentSlideRef = useRef(0)
  currentSlideRef.current = currentSlide
  const [editMode, setEditMode]       = useState(false)
  const [selState, setSelState]       = useState<SlidesSelState>({})
  const [painterActive, setPainterActive] = useState(false)
  const [mediaUploading, setMediaUploading] = useState(false)
  const [signedSrc, setSignedSrc]     = useState<Record<string, string>>({})
  const patchDeckRef = useRef<((op: DeckPatchOp) => Promise<boolean>) | null>(null)
  const [dragOver, setDragOver]       = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [clipboard, setClipboard]     = useState<{ html: string; action: 'copy' | 'cut' } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ pageIndex: number; pageId?: string; docId?: string | null; deckAtOpen?: DeckDataV2 | null; epochAtOpen: number } | null>(null)
  const deleteConfirmRef = useRef<typeof deleteConfirm>(null)
  const updateDeleteConfirm = useCallback((v: { pageIndex: number; pageId?: string; docId?: string | null; deckAtOpen?: DeckDataV2 | null; epochAtOpen: number } | null) => {
    deleteConfirmRef.current = v
    setDeleteConfirm(v)
  }, [])
  useEffect(() => { deleteConfirmRef.current = deleteConfirm }, [deleteConfirm])
  const deckConflictGuardRef = useRef(createDeckConflictGuard())
  const [leftWidth, setLeftWidth]     = useState(224)
  const [rightWidth, setRightWidth]   = useState(320)
  const [leftTab, setLeftTab]         = useState<SlidesLeftTab>('slides')
  const [leftCollapsed, setLeftCollapsed]   = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [slideId, setSlideId]         = useState<string | null>(null)
  const [title, setTitle]             = useState(() => t('asld_untitled'))
  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saving' | 'saved' | 'restore_failed' | 'restore_unverified' | 'conflict' | 'save_conflict' | 'edit_failed' | 'page_gone' | 'page_ambiguous' | 'delete_confirm_stale'>('idle')
  useEffect(() => { saveStatusRef.current = saveStatus }, [saveStatus])
  const titleFocusRef = useRef('')
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions]         = useState<{ id: string; title: string; trigger_msg: string | null; created_at: string }[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [restoringId, setRestoringId]   = useState<string | null>(null)
  const restoreActiveRef = useRef(false)
  const restoreSeqRef    = useRef(0)
  const [visibility, setVisibility]     = useState<SlidesVisibility>('private')
  const [showShareModal, setShowShareModal] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const dirtyWaitersRef = useRef(new Map<string, (idx: number[] | null) => void>())
  const editDoneGateRef = useRef(createEditDoneGate())
  const editModeRef = useRef(false)
  const [visDropdownOpen, setVisDropdownOpen] = useState(false)
  const [copyDone, setCopyDone]         = useState(false)
  const [authSlow, setAuthSlow]         = useState(false)
  const [, setConvId]             = useState<string | null>(null)
  const [idLoad, setIdLoad] = useState<'idle' | 'loading' | 'ok' | 'failed'>(
    () => (searchParams.get('id') ? 'loading' : 'idle'),
  )
  const [idFail, setIdFail] = useState<EditorLoadFail | null>(null)
  const [deckData, setDeckDataState] = useState<DeckDataV2 | null>(null)
  const deckDataRef = useRef<DeckDataV2 | null>(null)
  const setDeck = useCallback((d: DeckDataV2 | null) => { deckDataRef.current = d; setDeckDataState(d) }, [])
  const [deckBroken, setDeckBroken] = useState(false)
  const deckMarkedRef = useRef(false)
  const serverDeckRef = useRef<DeckDataV2 | null>(null)
  const optimisticRef = useRef<ComponentOp[]>([])
  const applyDeckPayload = useCallback((raw: unknown) => {
    const marked = isDeckV2Marked(raw)
    const parsed = parseDeckV2(raw)
    deckMarkedRef.current = marked
    serverDeckRef.current = parsed
    setDeck(parsed)
    setDeckBroken(marked && parsed === null)
  }, [setDeck])
  const recomputeOptimistic = useCallback(() => {
    let d = serverDeckRef.current
    if (d) for (const op of optimisticRef.current) { const r = applyComponentOp(d, op); if (r.ok) d = r.deck }
    setDeck(d)
  }, [setDeck])
  const [selectedCompIds, setSelectedCompIds] = useState<string[]>([])
  const selectedCompId = selectedCompIds.length === 1 ? selectedCompIds[0] : null
  const setSelectedCompId = useCallback((id: string | null) => setSelectedCompIds(id ? [id] : []), [])
  const compHistoryRef = useRef(new CompHistory())
  const compClipRef = useRef<CompClip | null>(null)
  const [expandedCompId, setExpandedCompId] = useState<string | null>(null)
  const [animCompId, setAnimCompId] = useState<string | null>(null)
  const [relayoutFor, setRelayoutFor] = useState<number | null>(null)
  const [previewOp, setPreviewOp] = useState<ComponentOp | null>(null)
  const [remoteNewer, setRemoteNewer] = useState<number | null>(null)
  const previewOpRef = useRef<ComponentOp | null>(null)
  const deckEditBusyRef = useRef(false)
  const liveGateRef = useRef(false)
  const compSeqRef = useRef(0)
  const heldDraftsRef = useRef<HeldDraft<ComponentOp>[]>([])
  const [heldDrafts, setHeldDrafts] = useState<HeldDraft<ComponentOp>[]>([])
  const [liveStash, setLiveStash] = useState<ComponentOp[] | null>(null)
  const setTypingOp = useCallback((op: ComponentOp | null) => { previewOpRef.current = op; setPreviewOp(op) }, [])
  const setHeld = useCallback((next: HeldDraft<ComponentOp>[]) => { heldDraftsRef.current = next; setHeldDrafts(next) }, [])
  const [saveAsBusy, setSaveAsBusy] = useState(false)
  const [panelResetKey, setPanelResetKey] = useState(0)
  const panelIdRef = useRef<DeckPanelIdentity | null>(null)
  const resetPanelBuffer = useCallback(() => {
    panelIdRef.current = null
    setPanelResetKey(k => 1 + k)
  }, [])
  const panelIdentity = nextDeckPanelIdentity(panelIdRef.current, deckData?.pages[currentSlide]?.pid, currentSlide)
  useEffect(() => {
    panelIdRef.current = nextDeckPanelIdentity(panelIdRef.current, deckData?.pages[currentSlide]?.pid, currentSlide)
  })
  const [deckEditBusy, setDeckEditBusy] = useState(false)
  const deckEditQueueRef = useRef(createSerialTaskQueue(() => setDeckEditBusy(false)))
  const deckPatchFailSeqRef = useRef(0)
  const saveStatusRef = useRef<string>('idle')
  const deckIssueGenRef = useRef(createDocIssueGeneration())
  const [blankState, setBlankState] = useState<'idle' | 'creating' | 'failed'>('idle')
  const blankDeckIdRef = useRef<string | null>(null)
  const blankBusyRef = useRef(false)

  const iframeRef      = useRef<HTMLIFrameElement | null>(null)
  const dragFromRef    = useRef<number | null>(null)
  const pendingTargetRef    = useRef<number>(0)
  const latestHtmlRef       = useRef('')
  const resizingRef    = useRef<'left' | 'right' | null>(null)
  const lastXRef       = useRef(0)
  const leftPanelRef   = useRef<HTMLDivElement>(null)
  const rightPanelRef  = useRef<HTMLDivElement>(null)
  const leftWidthRef   = useRef(224)
  const rightWidthRef  = useRef(320)
  const saveCtlRef     = useRef<SaveStatusTimer | null>(null)
  const copyTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedIdRef    = useRef<string | null>(null)
  const prevConvSlideRef = useRef<string | null>(null)
  const convSlideRef     = useRef<string | null>(null)
  const sendCtrlRef      = useRef<AbortController | null>(null)
  const chatEpochRef     = useRef(0)

  const saveCtl = useCallback(() => {
    if (!saveCtlRef.current) saveCtlRef.current = createSaveStatusTimer({ set: setSaveStatus })
    return saveCtlRef.current
  }, [])

  useEffect(() => {
    if (authed !== null) { setAuthSlow(false); return }
    const timer = setTimeout(() => setAuthSlow(true), 6000)
    return () => clearTimeout(timer)
  }, [authed])

  const loadSeqRef = useRef(0)
  const idLoadRef = useRef<'idle' | 'loading' | 'ok' | 'failed'>(searchParams.get('id') ? 'loading' : 'idle')
  const markIdLoad = useCallback((v: 'idle' | 'loading' | 'ok' | 'failed') => {
    idLoadRef.current = v
    setIdLoad(v)
  }, [])
  const versionsSeqRef = useRef(0)
  const lastUrlIdRef = useRef<string | null | undefined>(undefined)
  const idLandedRef  = useRef<string | null>(null)
  const docWinRef = useRef<Window | null>(null)
  const [docEpoch, setDocEpoch] = useState(0)
  const stampRef = useRef<string | null>(null)
  const loadedTitleRef = useRef('')
  const slidesRestoreBusyRef = useRef(false)
  const finishEditRef = useRef<() => Promise<unknown>>(async () => {})
  const flushDraftRef = useRef<SlidesFlushDraft | null>(null)
  const [slidesRestore, setSlidesRestore] = useState<SlidesFlushDraft | null>(null)

  const loadById = useCallback(async (id: string, seq?: number, quiet = false) => {
    const mySeq = seq ?? ++loadSeqRef.current
    if (!quiet) markIdLoad('loading')
    if (!host.isEditorId(id)) { setIdFail('bad_id'); markIdLoad('failed'); return }
    try {
      const res = await host.api.getSlide(id)
      if (mySeq !== loadSeqRef.current) return
      if (!res.ok) { if (quiet) return; setIdFail(host.editorLoadFail(res.status)); markIdLoad('failed'); return }
      const rec = await res.json()
      if (mySeq !== loadSeqRef.current) return
      if (!quiet) {
        docWinRef.current = null
        setDocEpoch(e => e + 1)
      }
      setSlideId(rec.id)
      stampRef.current = typeof rec.updated_at === 'string' ? rec.updated_at : null
      loadedTitleRef.current = typeof rec.title === 'string' ? rec.title : ''
      setEditorAgentKey(typeof rec.editor_agent_key === 'string' && rec.editor_agent_key ? rec.editor_agent_key : null)
      setTitle(rec.title || t('asld_untitled'))
      const rawHtml = rec.html_content || ''
      const idx = rawHtml.indexOf('##HTML##')
      const cleanHtml = idx !== -1 ? rawHtml.slice(idx + 8).trim() : rawHtml
      setHtmlContent(cleanHtml)
      latestHtmlRef.current = cleanHtml
      const nextSlides = extractSlides(cleanHtml)
      setSlides(nextSlides)
      const target = quiet ? Math.max(0, Math.min(currentSlideRef.current, nextSlides.length - 1)) : 0
      pendingTargetRef.current = target
      setCurrentSlide(target)
      if (isSlidesVisibility(rec.visibility)) setVisibility(rec.visibility)
      applyDeckPayload(rec.deck_data)
      resetPanelBuffer()
      idLandedRef.current = rec.id
      markIdLoad('ok')
    } catch {
      if (mySeq !== loadSeqRef.current) return
      if (quiet) return
      setIdFail(host.editorLoadFail(null))
      markIdLoad('failed')
    }
  }, [t, markIdLoad, applyDeckPayload, resetPanelBuffer, host])
  const [editorAgentKey, setEditorAgentKey] = useState<string | null>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const reloadDeck = useCallback(async () => {
    if (!slideId) return
    await loadById(slideId, undefined, host.shieldReloadQuiet({ id: slideId, landedId: idLandedRef.current, idLoad: idLoadRef.current }))
    const d = flushDraftRef.current
    flushDraftRef.current = null
    if (d && d.id === slideId && (d.html || d.ops.length)) {
      const fresh = { ...d, stamp: stampRef.current, rev: deckDataRef.current ? deckRevision(deckDataRef.current) : null, title0: loadedTitleRef.current }
      setSlidesRestore(prev => combineSlidesDrafts(prev, fresh))
    }
  }, [slideId, loadById, host])
  useEffect(() => { setSlidesRestore(null) }, [slideId])
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleNowRef = useRef('')
  titleNowRef.current = title
  const shieldFlush = host.useShieldFlush({
    run: async () => {
      const oks: boolean[] = []
      if (editModeRef.current) await finishEditBeforeTheme()
      const tNow = titleNowRef.current
      if (document.activeElement === titleInputRef.current && tNow !== titleFocusRef.current) {
        titleFocusRef.current = tNow
        if (deckDataRef.current) oks.push(await patchDeck({ kind: 'rename', title: tNow }))
        else if (!deckMarkedRef.current && latestHtmlRef.current) oks.push((await savePresentation(latestHtmlRef.current, extractSlides(latestHtmlRef.current), tNow)) !== null)
      }
      return oks.every(Boolean)
    },
    onFail: () => { void alertDialog(t('ai_shield_flush_failed')) },
  })
  const roleBusyOn = authed === true && !!slideId
  const { busy: roleBusy, roster: roleRoster } = host.useEditorRoleBusy({ editorAgentKey, enabled: roleBusyOn })
  const aiShield = host.useEditorAIShield({ kind: 'slides', id: slideId, enabled: authed === true && !!slideId, onRelease: reloadDeck, containerRef: centerRef, onLock: shieldFlush.onLock, hold: roleBusy })
  const aiLocked = aiShield.locked
  const aiLockedRef = useRef(false)
  aiLockedRef.current = aiLocked
  const changeEditorAgent = useCallback(async (key: string | null): Promise<boolean> => {
    if (!slideId) return false
    try {
      const res = await host.api.setEditorAgent(slideId, key)
      if (!res.ok) return false
      const j = (await res.json().catch(() => null)) as { editor_agent_key?: unknown } | null
      setEditorAgentKey(typeof j?.editor_agent_key === 'string' && j.editor_agent_key ? j.editor_agent_key : null)
      return true
    } catch { return false }
  }, [slideId, host])

  const editorFromUrlDoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!slideId || idLoad !== 'ok' || editorFromUrlDoneRef.current === slideId) return
    editorFromUrlDoneRef.current = slideId
    const want = host.editorKeyFromUrl(editorAgentKey)
    if (want) void changeEditorAgent(want)
  }, [slideId, idLoad, editorAgentKey, changeEditorAgent, searchParams, host])

  useEffect(() => {
    const id = searchParams.get('id')
    const idChanged = id !== lastUrlIdRef.current
    lastUrlIdRef.current = id
    if (idChanged && loadedIdRef.current !== id) {
      saveCtl().invalidate()
      deckConflictGuardRef.current.bump()
      if (deleteConfirmRef.current !== null) updateDeleteConfirm(null)
      liveGateRef.current = false
      heldDraftsRef.current = []
      setHeldDrafts([])
      setLiveStash(null)
      setRemoteNewer(null)
      deckEditQueueRef.current.detach()
      deckEditQueueRef.current = createSerialTaskQueue(() => setDeckEditBusy(false))
      setDeckEditBusy(false)
      deckIssueGenRef.current.bump()
    }
    if (!id) {
      ++loadSeqRef.current
      ++versionsSeqRef.current
      if (loadedIdRef.current !== null) {
        loadedIdRef.current = null
        idLandedRef.current = null
        docWinRef.current = null
        setSlideId(null)
        setHtmlContent('')
        latestHtmlRef.current = ''
        setSlides([])
        setCurrentSlide(0)
        setTitle(t('asld_untitled'))
        setVisibility('private')
        applyDeckPayload(null)
        blankDeckIdRef.current = null
        setBlankState('idle')
        setShowVersions(false)
        setVersions([])
        markIdLoad('idle')
      } else if (idLoadRef.current !== 'idle') {
        markIdLoad('idle')
      }
    }
    const wantLoad = !!id && id !== idLandedRef.current
    if (id && idChanged && !wantLoad) {
      ++loadSeqRef.current
      ++versionsSeqRef.current
      loadedIdRef.current = id
      markIdLoad('ok')
    }
    const seq = wantLoad ? ++loadSeqRef.current : 0
    if (wantLoad) {
      markIdLoad('loading')
      ++versionsSeqRef.current
      setShowVersions(false)
      setVersions([])
    }
    void host.checkAuth().then((signedIn) => {
      if (!signedIn) { setAuthed(false); return }
      setAuthed(true)
      if (!wantLoad || seq !== loadSeqRef.current) return
      loadedIdRef.current = id as string
      void loadById(id as string, seq)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadById])

  useEffect(() => {
    const prev = prevConvSlideRef.current
    prevConvSlideRef.current = slideId
    setConvId(null)
    convSlideRef.current = null
    if (prev !== null) setMessages([])
    if (!slideId) return
    return () => {
      if (slideId !== null) {
        chatEpochRef.current += 1
        sendCtrlRef.current?.abort()
        sendCtrlRef.current = null
      }
    }
  }, [slideId])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const dx = e.clientX - lastXRef.current
      lastXRef.current = e.clientX
      if (resizingRef.current === 'left') {
        leftWidthRef.current = Math.max(150, Math.min(420, leftWidthRef.current + dx))
        if (leftPanelRef.current) leftPanelRef.current.style.width = leftWidthRef.current + 'px'
      } else {
        rightWidthRef.current = Math.max(250, Math.min(520, rightWidthRef.current - dx))
        if (rightPanelRef.current) rightPanelRef.current.style.width = rightWidthRef.current + 'px'
      }
    }
    const onUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (iframeRef.current) iframeRef.current.style.pointerEvents = ''
      setLeftWidth(leftWidthRef.current)
      setRightWidth(rightWidthRef.current)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data) return
      if (e.source !== docWinRef.current || !docWinRef.current) return
      if (e.data.type === 'slideChange') {
        const i = slideChangeIndex(e.data, e.source, docWinRef.current, Number.POSITIVE_INFINITY)
        if (i !== null) setCurrentSlide(i)
      }
      if (e.data.type === 'slideAppended' && typeof e.data.count === 'number') {
        setSlides(prev => {
          if (e.data.count <= prev.length) return prev
          return [...prev, { title: `${t('asld_page_pre')}${e.data.count}${t('asld_page_suf')}`, index: e.data.count - 1 }]
        })
        if (e.data.count === 1) setCurrentSlide(0)
      }
      if (e.data.type === 'selState') { setSelState(e.data as SlidesSelState); return }
      if (e.data.type === 'dirtyPages') {
        const w = dirtyWaitersRef.current.get(String(e.data.reqId))
        if (w) { dirtyWaitersRef.current.delete(String(e.data.reqId)); w(Array.isArray(e.data.indexes) ? (e.data.indexes as unknown[]).filter((x): x is number => typeof x === 'number') : []) }
        return
      }
      if (e.data.type === 'painterState') { setPainterActive(!!e.data.active); return }
      if (e.data.type === 'htmlUpdated' && e.data.html) {
        const releaseEditDone = (o: 'confirmed' | 'lost' = 'confirmed') => editDoneGateRef.current.settle(o)
        if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') { releaseEditDone('lost'); return }
        setSelState({}); setPainterActive(false)
        if (deckDataRef.current) {
          setEditMode(false)
          const pages = Array.isArray(e.data.pages) ? (e.data.pages as Array<{ index: number; html: string }>) : []
          const deckNow = deckDataRef.current
          for (const pg of pages) {
            if (typeof pg.index !== 'number' || typeof pg.html !== 'string') continue
            const pid = deckNow.pages[pg.index]?.pid
            void patchDeckRef.current?.({ kind: 'edit_page_html', pageIndex: pg.index, ...(pid ? { pageId: pid } : {}), html: pg.html })
          }
          releaseEditDone()
          return
        }
        if (deckMarkedRef.current) { setEditMode(false); releaseEditDone('lost'); return }
        const clean = stripEditScript(e.data.html as string)
        pendingTargetRef.current = currentSlide
        setHtmlContent(clean); latestHtmlRef.current = clean
        setEditMode(false)
        savePresentation(clean, extractSlides(clean))
        releaseEditDone()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, slideId, title])


  useEffect(() => {
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    saveCtl().resume()
    return () => {
      saveCtlRef.current?.dispose()
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [saveCtl])

  const savePresentationRaw = useCallback(async (html: string, slideList: Slide[], newTitle?: string, base?: string | null): Promise<string | null> => {
    if (!html) return null
    if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return null
    if (deckDataRef.current || deckMarkedRef.current) return null
    const usedTitle = newTitle ?? title
    const owned = saveCtl().acquire()
    try {
      const body = { title: usedTitle, html_content: html, slide_count: slideList.length }
      const currentId = slideId
      if (currentId) {
        const res = await host.api.putSlide(currentId, base ? { ...body, base_updated_at: base } : body)
        const st = htmlSaveStatusFromResponse(res.ok, res.status)
        if (st === 'saved') {
          const j = await res.json().catch(() => null) as { updated_at?: unknown } | null
          if (typeof j?.updated_at === 'string' && loadedIdRef.current === currentId) stampRef.current = j.updated_at
        }
        owned.settle(st)
        return st === 'saved' ? currentId : null
      } else {
        const res = await host.api.createSlide(body)
        if (res.ok) {
          const rec = await res.json()
          setSlideId(rec.id)
          loadedIdRef.current = rec.id
          idLandedRef.current = rec.id
          host.replaceDeckUrl(rec.id)
          owned.settle('saved')
          return rec.id
        }
        const st = htmlSaveStatusFromResponse(false, res.status)
        owned.settle(st)
        return null
      }
    } catch {
      owned.reset()
      return null
    }
  }, [slideId, title, saveCtl, host])
  const savePresentation = useCallback((html: string, slideList: Slide[], newTitle?: string): Promise<string | null> => {
    if (!aiLockedRef.current) return savePresentationRaw(html, slideList, newTitle)
    if (!shieldFlush.isOpen()) return Promise.resolve(null)
    if (!html || deckDataRef.current || deckMarkedRef.current || idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return Promise.resolve(null)
    const sid = slideId
    const usedTitle = newTitle ?? titleNowRef.current
    const p = savePresentationRaw(html, slideList, newTitle, stampRef.current).then(v => {
      if (v === null && sid) { const prev = flushDraftRef.current && flushDraftRef.current.id === sid ? flushDraftRef.current : null; flushDraftRef.current = { id: sid, html, title: usedTitle, ops: prev?.ops ?? [] } }
      return v
    })
    return shieldFlush.track(p, v => v !== null)
  }, [savePresentationRaw, shieldFlush, slideId])

  const createBlankDeck = useCallback(async () => {
    if (blankBusyRef.current) return
    blankBusyRef.current = true
    setBlankState('creating')
    const stillCreating = () =>
      typeof window !== 'undefined'
      && !host.urlDocId()
      && loadedIdRef.current === null
    try {
      if (!blankDeckIdRef.current) blankDeckIdRef.current = safeRandomUUID()
      const res = await host.api.createDeck({ deckId: blankDeckIdRef.current, lang: slideLang })
      if (!stillCreating()) return
      if (!res.ok) { setBlankState('failed'); return }
      const rec = await res.json() as { id: string; title?: string; html_content?: string; deck_data?: unknown }
      if (!stillCreating()) return
      loadedIdRef.current = rec.id
      idLandedRef.current = rec.id
      setTitle(rec.title || t('asld_untitled'))
      const html = rec.html_content || ''
      pendingTargetRef.current = 0
      setHtmlContent(html)
      latestHtmlRef.current = html
      setSlides(extractSlides(html))
      setCurrentSlide(0)
      applyDeckPayload(rec.deck_data)
      resetPanelBuffer()
      markIdLoad('ok')
      setSlideId(rec.id)
      host.replaceDeckUrl(rec.id)
      setBlankState('idle')
    } catch {
      if (stillCreating()) setBlankState('failed')
    } finally {
      blankBusyRef.current = false
    }
  }, [slideLang, t, markIdLoad, applyDeckPayload, resetPanelBuffer, host])

  useEffect(() => {
    if (authed !== true) return
    if (searchParams.get('id') || slideId) return
    void createBlankDeck()
  }, [authed, searchParams, slideId, createBlankDeck])

  const applyDeckRow = useCallback((
    rec: { title?: unknown; html_content?: unknown; deck_data?: unknown },
    targetIndex: number,
    resetPanel: boolean,
  ) => {
    const html = typeof rec.html_content === 'string' ? rec.html_content : ''
    const stamp = (rec as { updated_at?: unknown }).updated_at
    if (typeof stamp === 'string') stampRef.current = stamp
    const newSlides = extractSlides(html)
    const target = Math.max(0, Math.min(targetIndex, newSlides.length - 1))
    pendingTargetRef.current = target
    setHtmlContent(html)
    latestHtmlRef.current = html
    setSlides(newSlides)
    setCurrentSlide(target)
    if (typeof rec.title === 'string') setTitle(rec.title || t('asld_untitled'))
    applyDeckPayload(rec.deck_data)
    if (resetPanel) resetPanelBuffer()
  }, [t, applyDeckPayload, resetPanelBuffer])

  // Desktop app: before the tab closes, wait for queued deck edits to finish sending (shared/desktop-before-close)
  useEffect(() => registerDesktopBeforeClose(async () => { await deckEditQueueRef.current.enqueue(async () => true) }), [])
  const patchDeckRaw = useCallback((rawOp: DeckPatchOp, onRec?: (rec: { componentId?: unknown; childIds?: unknown }) => void): Promise<boolean> => {
    const sid = slideId
    if (!sid || !deckDataRef.current) return Promise.resolve(false)
    if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return Promise.resolve(false)
    const enqueueDeck = deckDataRef.current
    const issueGen = deckIssueGenRef.current.now()
    const staleIssue = () => !deckIssueGenRef.current.isCurrent(issueGen) || loadedIdRef.current !== sid
    const myQueue = deckEditQueueRef.current
    setDeckEditBusy(true)
    return myQueue.enqueue(async (): Promise<boolean> => {
      if (staleIssue() || !deckDataRef.current) return false
      if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return false
      const op: DeckPatchOp = deckDataRef.current !== enqueueDeck
        ? remapQueuedOpForExec(rawOp, enqueueDeck, deckDataRef.current)
        : rawOp
      const owned = saveCtl().acquire()
      const notify = (s: 'saved' | 'conflict' | 'edit_failed' | 'page_gone' | 'page_ambiguous') => owned.settle(s)
      try {
        const beforeDeck = deckDataRef.current
        const res = await host.api.patchDeck({ slideId: sid, expectedRevision: deckRevision(beforeDeck), op })
        if (staleIssue()) { owned.reset(); return false }
        const fallbackTarget = op.kind === 'add_page' ? op.afterIndex + 1
          : op.kind === 'delete_page' ? op.pageIndex
          : currentSlideRef.current
        if (res.status === 409) {
          deckConflictGuardRef.current.bump()
          myQueue.cancelPending()
          const j = await res.json().catch(() => null) as { code?: unknown; current?: { title?: unknown; html_content?: unknown; deck_data?: unknown } | null } | null
          if (staleIssue()) { owned.reset(); return false }
          if (j?.current) {
            applyDeckRow(j.current, currentSlideRef.current, true)
            compHistoryRef.current.clearAll()
          } else {
            try {
              const r2 = await host.api.getSlide(sid)
              if (r2.ok) {
                const row = await r2.json() as { title?: unknown; html_content?: unknown; deck_data?: unknown }
                if (staleIssue()) { owned.reset(); return false }
                applyDeckRow(row, currentSlideRef.current, true)
              }
            } catch {  }
          }
          notify(j?.code === 'err_aislides_page_gone' ? 'page_gone'
            : j?.code === 'err_aislides_page_ambiguous' ? 'page_ambiguous'
            : 'conflict')
          if (deleteConfirmRef.current !== null) {
            updateDeleteConfirm(null)
            owned.settle('delete_confirm_stale')
          }
          return false
        }
        if (!res.ok) { notify('edit_failed'); return false }
        const rec = await res.json() as { title?: unknown; html_content?: unknown; deck_data?: unknown; targetPageIndex?: unknown; componentId?: unknown; childIds?: unknown }
        if (staleIssue()) { owned.reset(); return false }
        onRec?.(rec)
        let target = (op.kind === 'add_page' || op.kind === 'delete_page' || op.kind === 'page_add' || op.kind === 'page_move' || op.kind === 'apply_template' || op.kind === 'apply_user_template') && typeof rec.targetPageIndex === 'number'
          ? rec.targetPageIndex
          : fallbackTarget
        let resetPanel = op.kind !== 'edit_slots'
        if (op.kind === 'edit_slots') {
          const afterDeck = parseDeckV2(rec.deck_data)
          if (beforeDeck && afterDeck) {
            const structureChanged = afterDeck.pages.length !== beforeDeck.pages.length
            if (currentSlideRef.current === op.pageIndex) {
              if (structureChanged && typeof rec.targetPageIndex === 'number') target = rec.targetPageIndex
            } else {
              if (structureChanged) target = remapPageIndexAfterTocRebuild(beforeDeck, afterDeck, currentSlideRef.current)
              const beforeViewed = beforeDeck.pages[currentSlideRef.current]
              const afterViewed = afterDeck.pages[target]
              resetPanel = JSON.stringify(beforeViewed?.draft ?? null) !== JSON.stringify(afterViewed?.draft ?? null)
            }
          }
          if (afterDeck) {
            panelIdRef.current = adoptDeckPanelIdentity(panelIdRef.current, afterDeck.pages[target]?.pid, target, beforeDeck)
          }
        }
        applyDeckRow(rec, target, resetPanel)
        notify('saved')
        return true
      } catch {
        if (!staleIssue()) notify('edit_failed')
        else owned.reset()
        return false
      }
    }).then((r) => { if (r !== true) deckPatchFailSeqRef.current += 1; return r ?? false })
  }, [slideId, applyDeckRow, saveCtl, host])
  const patchDeck = useCallback((rawOp: DeckPatchOp, onRec?: (rec: { componentId?: unknown; childIds?: unknown }) => void): Promise<boolean> => {
    if (!aiLockedRef.current) return patchDeckRaw(rawOp, onRec)
    if (!shieldFlush.isOpen()) return Promise.resolve(false)
    const sid = slideId
    const p = patchDeckRaw(rawOp, onRec).then(ok => {
      if (!ok && sid && isFlushableSlidesOp(rawOp)) {
        const d = flushDraftRef.current && flushDraftRef.current.id === sid ? flushDraftRef.current : { id: sid, ops: [] }
        flushDraftRef.current = { ...d, ops: [...d.ops, rawOp] }
      }
      return ok
    })
    return shieldFlush.track(p)
  }, [patchDeckRaw, shieldFlush, slideId])
  patchDeckRef.current = patchDeck
  const slidesRestoreModeNow = slidesRestore ? slidesRestoreMode(slidesRestore, { isV2: !!deckData, isV2Marked: !!deckData || deckBroken }) : 'text'
  const applySlidesRestore = useCallback(async () => {
    const r = slidesRestore
    if (!r || r.id !== slideId || aiLockedRef.current || slidesRestoreBusyRef.current) return
    slidesRestoreBusyRef.current = true
    const applied = new Set<SlidesFlushOp>(), staleOps = new Set<SlidesFlushOp>()
    let htmlApplied = false, staleHtml = false, failed = false
    try {
      if (editModeRef.current) await finishEditRef.current()
      const mode = slidesRestoreMode(r, { isV2: !!deckDataRef.current, isV2Marked: deckMarkedRef.current })
      if (mode === 'replay') {
        const split = splitReplayOps(r.ops, { revNow: deckRevision(deckDataRef.current), rev0: r.rev, titleNow: loadedTitleRef.current, title0: r.title0 })
        for (const op of split.leftover) staleOps.add(op)
        for (const op of split.replay) { if (await patchDeck(op as DeckPatchOp)) applied.add(op); else failed = true }
      } else if (mode === 'overwrite' && r.html) {
        const cur = await host.api.getSlide(r.id, { cache: 'no-store' }).then(x => (x.ok ? x.json() : null)).catch(() => null) as { updated_at?: unknown } | null
        if (!cur) failed = true
        else if (typeof r.stamp !== 'string' || cur.updated_at !== r.stamp) staleHtml = true
        else if ((await savePresentationRaw(r.html, extractSlides(r.html), r.title, r.stamp)) !== null) { htmlApplied = true; await loadById(r.id) }
        else failed = true
      }
    } finally {
      slidesRestoreBusyRef.current = false
      setSlidesRestore(prev => finishSlidesRestore(prev, r, { applied, htmlApplied, staleOps, staleHtml }))
      if (staleOps.size || staleHtml) void alertDialog(t('ai_shield_restore_stale'))
      else if (failed) void alertDialog(t('ai_shield_restore_failed'))
    }
  }, [slidesRestore, slideId, patchDeck, savePresentationRaw, loadById, t, host])

  const OPTIMISTIC_KINDS = useMemo(() => new Set<ComponentOp['kind']>(['component_update', 'component_frame', 'component_order', 'component_delete', 'animation_set', 'animation_order', 'component_group', 'component_ungroup', 'page_update', 'transition_all']), [])
  const sendCompOp = useCallback((op: ComponentOp, onRec?: (rec: { componentId?: unknown; childIds?: unknown }) => void): Promise<boolean> => {
    const optimistic = OPTIMISTIC_KINDS.has(op.kind)
    const seq = ++compSeqRef.current
    if (optimistic && liveGateRef.current) {
      setHeld(holdDraft(heldDraftsRef.current, { seq, op }))
      return Promise.resolve(true)
    }
    const epochAtSend = deckConflictGuardRef.current.epochNow()
    const docAtSend = loadedIdRef.current
    if (optimistic && deckDataRef.current) {
      const r = applyComponentOp(deckDataRef.current, op)
      if (!r.ok) return Promise.resolve(false)
      optimisticRef.current.push(op)
      setDeck(r.deck)
    }
    return patchDeck(op, onRec).then((ok) => {
      if (optimistic) {
        const i = optimisticRef.current.indexOf(op)
        if (i >= 0) optimisticRef.current.splice(i, 1)
        recomputeOptimistic()
        if (!ok && shouldHoldAfterFailure({ epochAtSend, epochNow: deckConflictGuardRef.current.epochNow(), docAtSend, docNow: loadedIdRef.current })) {
          setHeld(holdDraft(heldDraftsRef.current, { seq, op }))
          liveGateRef.current = true
          setRemoteNewer(deckRevision(deckDataRef.current) ?? 0)
        }
      }
      return ok
    })
  }, [OPTIMISTIC_KINDS, patchDeck, recomputeOptimistic, setDeck, setHeld])

  const loadVersions = useCallback(async () => {
    if (!slideId) return
    if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return
    const sid = slideId
    const seq = ++versionsSeqRef.current
    setVersionsLoading(true)
    try {
      const res = await host.api.listVersions(sid)
      if (seq !== versionsSeqRef.current || loadedIdRef.current !== sid) return
      if (!res.ok) { setVersions([]); return }
      const rows = await res.json()
      if (seq !== versionsSeqRef.current || loadedIdRef.current !== sid) return
      setVersions(rows)
    } catch {
      if (seq === versionsSeqRef.current && loadedIdRef.current === sid) setVersions([])
    } finally {
      if (seq === versionsSeqRef.current) setVersionsLoading(false)
    }
  }, [slideId, host])

  const restoreVersion = useCallback(async (versionId: string) => {
    if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return
    if (aiLockedRef.current) return
    const sid = slideId
    if (!sid) return
    if (restoreActiveRef.current) return
    restoreActiveRef.current = true
    const mySeq = ++restoreSeqRef.current
    setRestoringId(versionId)
    const restoreGen = deckIssueGenRef.current.now()
    const staleRestore = () => !deckIssueGenRef.current.isCurrent(restoreGen) || restoreSeqRef.current !== mySeq
    let putSent = false
    let versionHtml: string | null = null
    let ownedRestore: OwnedSaveHandle | null = null
    const reconcileFromDb = async (sid2: string) => {
      const notify = (s: 'saved' | 'restore_failed' | 'restore_unverified') => ownedRestore?.settle(s)
      try {
        const syncRes = await host.api.getSlide(sid2)
        if (staleRestore()) return
        if (!syncRes.ok) { notify('restore_unverified'); return }
        const row = await syncRes.json() as { html_content?: string; title?: string; deck_data?: unknown }
        if (staleRestore()) return
        const nowSync = idLoadRef.current as 'idle' | 'loading' | 'ok' | 'failed'
        if (loadedIdRef.current !== sid2 || nowSync === 'loading' || nowSync === 'failed') {
          ownedRestore?.reset(); return
        }
        deckIssueGenRef.current.bump()
        const dbHtml = typeof row.html_content === 'string' ? row.html_content : ''
        if (dbHtml !== latestHtmlRef.current) {
          docWinRef.current = null
          setDocEpoch(e => e + 1)
          pendingTargetRef.current = 0
          setHtmlContent(dbHtml); latestHtmlRef.current = dbHtml
          setSlides(extractSlides(dbHtml))
          setCurrentSlide(0)
        }
        applyDeckPayload(row.deck_data)
        resetPanelBuffer()
        if (typeof row.title === 'string' && row.title) setTitle(row.title)
        if (versionHtml !== null && dbHtml === versionHtml) {
          setShowVersions(false)
          notify('saved')
        } else {
          notify('restore_failed')
        }
      } catch {
        if (staleRestore()) return
        notify('restore_unverified')
      }
    }
    try {
      const res = await host.api.getVersion(versionId)
      if (staleRestore()) return
      if (!res.ok) return
      const v = await res.json()
      if (staleRestore()) return
      if (v.slide_id !== sid) return
      const nowLoad = idLoadRef.current as 'idle' | 'loading' | 'ok' | 'failed'
      if (loadedIdRef.current !== sid || nowLoad === 'loading' || nowLoad === 'failed') return
      versionHtml = typeof v.html_content === 'string' ? v.html_content : ''
      ownedRestore = saveCtl().acquire()
      putSent = true
      const putRes = await host.api.restoreVersion(versionId)
      if (staleRestore()) return
      if (!putRes.ok) { await reconcileFromDb(sid); return }
      const written = await putRes.json().catch(() => null) as { restored?: boolean; title?: string | null; deck_data?: unknown } | null
      if (staleRestore()) return
      const afterPut = idLoadRef.current as 'idle' | 'loading' | 'ok' | 'failed'
      if (loadedIdRef.current !== sid || afterPut === 'loading' || afterPut === 'failed') {
        ownedRestore?.reset(); return
      }
      deckIssueGenRef.current.bump()
      docWinRef.current = null
      setDocEpoch(e => e + 1)
      const newSlides = extractSlides(v.html_content)
      pendingTargetRef.current = 0
      setHtmlContent(v.html_content); latestHtmlRef.current = v.html_content
      setSlides(newSlides)
      setCurrentSlide(0)
      applyDeckPayload(written && 'deck_data' in written ? written.deck_data : (v as { deck_data?: unknown }).deck_data)
      resetPanelBuffer()
      setTitle((written && typeof written.title === 'string' && written.title) || v.title || t('asld_untitled'))
      setShowVersions(false)
      ownedRestore?.settle('saved')
    } catch {
      if (staleRestore()) return
      if (!putSent) { ownedRestore?.reset(); return }
      await reconcileFromDb(sid)
    } finally {
      if (restoreSeqRef.current === mySeq) {
        restoreActiveRef.current = false
        setRestoringId(null)
      }
    }
  }, [slideId, t, applyDeckPayload, resetPanelBuffer, saveCtl, host])

  const gotoSlide = useCallback((index: number) => {
    setCurrentSlide(index)
    iframeRef.current?.contentWindow?.postMessage({ type: 'goto', index }, '*')
  }, [])

  const stepForward  = useCallback(() => iframeRef.current?.contentWindow?.postMessage({ type: 'nextStep' }, '*'), [])
  const stepBackward = useCallback(() => iframeRef.current?.contentWindow?.postMessage({ type: 'prevStep' }, '*'), [])

  const updateVisibility = useCallback(async (v: SlidesVisibility) => {
    if (!slideId) return
    if (idLoadRef.current === 'loading' || idLoadRef.current === 'failed') return
    const prev = visibility
    setVisibility(v)
    setVisDropdownOpen(false)
    const res = await host.api.putSlide(slideId, { visibility: v }).catch(() => null)
    if (res?.ok) { const j = await res.json().catch(() => null) as { updated_at?: unknown } | null; if (typeof j?.updated_at === 'string' && loadedIdRef.current === slideId) stampRef.current = j.updated_at }
    else if (loadedIdRef.current === slideId) setVisibility(prev)
  }, [slideId, visibility, host])

  const downloadHtml = useCallback(async () => {
    if (!htmlContent) return
    let source = htmlContent
    if (deckDataRef.current && loadedIdRef.current) {
      try {
        const r = await host.api.deckHtml(loadedIdRef.current)
        const j = r.ok ? await r.json() as { html?: unknown } : null
        if (typeof j?.html === 'string' && j.html) source = j.html
      } catch {  }
    }
    const clean = exportSlidesHtml(source)
    const blob = new Blob([clean], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [htmlContent, title, host])

  const slidesVisLabel = (v: SlidesVisibility) =>
    v === 'public' ? t('asld_vis_public') : v === 'unlisted' ? t('drive_share_unlisted') : t('asld_vis_private')

  const copyShareLink = useCallback(() => {
    if (!slideId) return
    navigator.clipboard.writeText(host.shareUrl(slideId))
    setCopyDone(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyDone(false), 2000)
  }, [slideId, host])

  const handleIframeLoad = useCallback(() => {
    docWinRef.current = iframeRef.current?.contentWindow ?? null
    const target = pendingTargetRef.current
    pendingTargetRef.current = 0
    if (target === 0) return
    setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'goto', index: target }, '*')
    }, 50)
  }, [])

  const toggleEditMode = () => {
    if (!iframeRef.current?.contentWindow) return
    if (aiLockedRef.current) return
    if (editMode) iframeRef.current.contentWindow.postMessage({ type: 'disableEdit' }, '*')
    else { setEditMode(true); iframeRef.current.contentWindow.postMessage({ type: 'enableEdit' }, '*') }
  }

  const postToDoc = useCallback((msg: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [])
  const ensureEditMode = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return false
    if (aiLockedRef.current) return false
    if (!editMode) { setEditMode(true); postToDoc({ type: 'enableEdit' }) }
    return true
  }, [editMode, postToDoc])
  const sendFormat = useCallback((cmd: string, value?: string | number) => {
    if (!ensureEditMode()) return
    if (cmd === 'fontName') {
      const f = findFont(value)
      postToDoc({ type: 'format', cmd, value: f ? f.stack : '', fontId: f?.id ?? '', fontHref: f ? fontCssHref(f) : '' })
      return
    }
    postToDoc({ type: 'format', cmd, value })
  }, [ensureEditMode, postToDoc])
  const copyFormat = useCallback(() => {
    if (!ensureEditMode()) return
    if (painterActive) { postToDoc({ type: 'cancelPainter' }); setPainterActive(false); return }
    postToDoc({ type: 'copyFormat' })
  }, [ensureEditMode, painterActive, postToDoc])
  const uploadAndInsert = useCallback(async (file: File, kind: 'image' | 'video') => {
    if (!ensureEditMode()) return
    const tooLarge = host.uploadTooLarge(file)
    if (tooLarge) { await alertDialog(tooLarge); return }
    setMediaUploading(true)
    try {
      const res = await host.api.uploadMedia(file)
      const j = await res.json().catch(() => null) as { url?: string; display_url?: string; error?: string } | null
      if (!res.ok || !j?.url) { await alertDialog(j?.error || t('asld_tb_upload_failed')); return }
      const key = j.url.split('/').slice(3).join('/')
      setSignedSrc(prev => ({ ...prev, [j.url as string]: j.display_url || (j.url as string) }))
      postToDoc({ type: 'insertMedia', kind, src: j.url, key, display: j.display_url || j.url })
    } catch { await alertDialog(t('asld_tb_upload_failed')) }
    finally { setMediaUploading(false) }
  }, [ensureEditMode, postToDoc, t, host])
  const insertVideoByUrl = useCallback(async () => {
    const url = await promptDialog({ message: t('asld_tb_video_url_prompt'), defaultValue: '' })
    if (!url) return
    const u = url.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) { await alertDialog(t('asld_tb_video_url_bad')); return }
    if (!ensureEditMode()) return
    postToDoc({ type: 'insertMedia', kind: 'video', src: u })
  }, [ensureEditMode, postToDoc, t])

  const reorderSlides = (from: number, to: number) => {
    if (from === to || !latestHtmlRef.current) return
    const doc = new DOMParser().parseFromString(latestHtmlRef.current, 'text/html')
    const slideEls = Array.from(doc.querySelectorAll('section.slide'))
    if (slideEls.length < 2) return
    const parent = slideEls[0].parentNode!
    const anchor = parent.querySelector('script')
    slideEls.forEach(el => parent.removeChild(el))
    const newOrder = [...slideEls]
    const [moved] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, moved)
    newOrder.forEach((el, i) => el.classList.toggle('active', i === 0))
    newOrder.forEach(el => anchor ? parent.insertBefore(el, anchor) : parent.appendChild(el))
    const newHtml = '<!DOCTYPE html>' + doc.documentElement.outerHTML
    const newSlides = newOrder.map((el, i) => ({ title: el.getAttribute('data-title') || `${t('asld_page_pre')}${i + 1}${t('asld_page_suf')}`, index: i }))
    pendingTargetRef.current = 0
    setHtmlContent(newHtml); latestHtmlRef.current = newHtml
    setSlides(newSlides)
    setCurrentSlide(0)
    savePresentation(newHtml, newSlides)
  }

  useEffect(() => { editModeRef.current = editMode }, [editMode])
  const queryDirtyPages = useCallback((): Promise<number[] | null> => {
    if (!editModeRef.current || !iframeRef.current?.contentWindow) return Promise.resolve([])
    const reqId = `q${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    return new Promise(resolve => {
      dirtyWaitersRef.current.set(reqId, resolve)
      postToDoc({ type: 'queryDirty', reqId })
      setTimeout(() => { if (dirtyWaitersRef.current.delete(reqId)) resolve(null) }, 1500)
    })
  }, [postToDoc])
  const confirmTemplateApply = useCallback(async (entry: TemplateEntry): Promise<boolean> => {
    if (entry.load.kind === 'deck' && deckDataRef.current) return confirmDialog({ message: t('tpl_confirm_deck'), confirmLabel: t('tpl_continue'), danger: true })
    if (entry.load.kind !== 'theme' || !deckDataRef.current) return true
    const dirty = await queryDirtyPages()
    const pages = manualLayoutPageIndexes(deckDataRef.current, dirty ?? [])
    if (pages.length === 0 && dirty !== null) return true
    const list = pages.map(i => String(i + 1)).join(t('tpl_manual_pages_sep'))
    const message = pages.length ? `${t('tpl_confirm_manual')}\n${t('tpl_manual_pages').replace('{pages}', list)}` : t('tpl_confirm_manual')
    return confirmDialog({ message, confirmLabel: t('tpl_continue'), danger: true })
  }, [queryDirtyPages, t])
  const finishEditBeforeTheme = useCallback((): Promise<EditDoneOutcome> => {
    if (!editModeRef.current) return Promise.resolve('none')
    if (!iframeRef.current?.contentWindow) return Promise.resolve('lost')
    const w = editDoneGateRef.current.wait(EDIT_DONE_TIMEOUT_MS)
    postToDoc({ type: 'disableEdit' })
    return w
  }, [postToDoc])
  finishEditRef.current = finishEditBeforeTheme

  const applyTemplate = useCallback(async (entry: TemplateEntry): Promise<boolean> => {
    if (entry.load.kind !== 'theme' && entry.load.kind !== 'deck') return false
    if (aiLockedRef.current) return false
    if (!deckDataRef.current) { await alertDialog(t('tpl_not_v2')); return false }
    await finishEditBeforeTheme()
    const ok = await patchDeck(entry.load.kind === 'deck'
      ? { kind: 'apply_template', templateId: entry.load.id }
      : { kind: 'set_theme', themeId: entry.load.themeId })
    if (ok && entry.load.kind === 'deck') compHistoryRef.current.clearAll()
    if (!ok) await alertDialog(t('tpl_apply_failed'))
    return ok
  }, [patchDeck, finishEditBeforeTheme, t])

  const userTemplateOps = useMemo<UserTemplateOps | undefined>(() => (!host.has('userTemplates') || !slideId || !deckData ? undefined : {
    list: async () => {
      try { const r = await host.api.listUserTemplates(); return r.ok ? ((await r.json()) as UserTemplate[]) : null } catch { return null }
    },
    html: async (id) => {
      const r = await host.api.getSlide(id)
      const d = (r.ok ? await r.json() : null) as { html_content?: unknown } | null
      return typeof d?.html_content === 'string' ? d.html_content : ''
    },
    save: async () => {
      const name = await promptDialog({ message: t('tpl_save_name_prompt'), defaultValue: title || '' })
      if (name === null || !name.trim()) return null
      const flushed = await flushDeckBeforeSnapshot({
        finishEdit: finishEditBeforeTheme,
        queue: deckEditQueueRef.current,
        failSeq: () => deckPatchFailSeqRef.current,
        failedNow: () => SAVE_FAILED_STATES.has(saveStatusRef.current),
        revision: () => deckRevision(deckDataRef.current),
      })
      if (!flushed.ok) { await alertDialog(t('tpl_save_unsaved')); return null }
      try {
        const r = await host.api.saveUserTemplate({ slideId, name, expectedRevision: flushed.revision })
        const j = await r.json().catch(() => null) as (UserTemplate & { error?: string }) | null
        if (!r.ok || !j?.id) { await alertDialog(`${t('tpl_save_failed')}${j?.error ? `：${j.error}` : ''}`); return null }
        return j
      } catch { await alertDialog(t('tpl_save_failed')); return null }
    },
    remove: async (tpl) => {
      try { const r = await host.api.deleteUserTemplate(tpl.id); return r.ok } catch { return false }
    },
    apply: async (tpl) => {
      await finishEditBeforeTheme()
      const ok = await patchDeck({ kind: 'apply_user_template', sourceSlideId: tpl.id })
      if (ok) compHistoryRef.current.clearAll()
      else await alertDialog(t('tpl_apply_failed'))
      return ok
    },
  }), [slideId, deckData, title, t, patchDeck, finishEditBeforeTheme, host])

  const addSlide = (afterIndex: number) => {
    if (!latestHtmlRef.current) return
    const doc = new DOMParser().parseFromString(latestHtmlRef.current, 'text/html')
    const slideEls = Array.from(doc.querySelectorAll('section.slide'))
    if (slideEls.length === 0) return
    const parent = slideEls[0].parentNode!
    const newSec = doc.createElement('section')
    newSec.className = 'slide'
    newSec.setAttribute('data-title', t('asld_new_page'))
    newSec.setAttribute('style', 'width:100%;height:100vh;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e293b,#0f172a);color:white;')
    newSec.innerHTML = `<h1 style="font-size:clamp(1.6rem,5vw,3.5rem);margin:0;font-family:inherit">${t('asld_new_page')}</h1><p style="font-size:clamp(0.8rem,1.8vw,1.1rem);margin-top:1em;opacity:0.5">${t('asld_new_page_hint')}</p>`
    if (afterIndex < slideEls.length - 1) {
      parent.insertBefore(newSec, slideEls[afterIndex + 1])
    } else {
      const anchor = parent.querySelector('script')
      if (anchor) parent.insertBefore(newSec, anchor)
      else parent.appendChild(newSec)
    }
    Array.from(doc.querySelectorAll('section.slide')).forEach((el, i) => {
      el.classList.toggle('active', i === 0)
      ;(el as HTMLElement).style.removeProperty('display')
    })
    const newHtml = '<!DOCTYPE html>' + doc.documentElement.outerHTML
    const newSlides = extractSlides(newHtml)
    const newIdx = afterIndex + 1
    pendingTargetRef.current = newIdx
    setHtmlContent(newHtml); latestHtmlRef.current = newHtml
    setSlides(newSlides)
    setCurrentSlide(newIdx)
    savePresentation(newHtml, newSlides)
    setTimeout(() => gotoSlide(newIdx), 100)
  }

  const copySlide = (index: number) => {
    if (!latestHtmlRef.current) return
    const doc = new DOMParser().parseFromString(latestHtmlRef.current, 'text/html')
    const slideEls = Array.from(doc.querySelectorAll('section.slide'))
    if (index >= slideEls.length) return
    setClipboard({ html: slideEls[index].outerHTML, action: 'copy' })
  }

  const cutSlide = (index: number) => {
    if (!latestHtmlRef.current) return
    const doc = new DOMParser().parseFromString(latestHtmlRef.current, 'text/html')
    const slideEls = Array.from(doc.querySelectorAll('section.slide'))
    if (index >= slideEls.length) return
    setClipboard({ html: slideEls[index].outerHTML, action: 'cut' })
  }

  const pasteSlide = (afterIndex: number) => {
    if (!clipboard || !latestHtmlRef.current) return
    const doc = new DOMParser().parseFromString(latestHtmlRef.current, 'text/html')
    let slideEls = Array.from(doc.querySelectorAll('section.slide'))
    if (slideEls.length === 0) return
    const parent = slideEls[0].parentNode!
    const tmp = doc.createElement('div')
    tmp.innerHTML = clipboard.html
    const newSec = tmp.querySelector('section')
    if (!newSec) return
    newSec.classList.remove('active')
    newSec.style.removeProperty('display')
    if (afterIndex < slideEls.length - 1) {
      parent.insertBefore(newSec, slideEls[afterIndex + 1])
    } else {
      const anchor = parent.querySelector('script')
      if (anchor) parent.insertBefore(newSec, anchor)
      else parent.appendChild(newSec)
    }
    if (clipboard.action === 'cut') {
      slideEls = Array.from(doc.querySelectorAll('section.slide'))
      const newSecIdx = Array.from(slideEls).indexOf(newSec)
      const origHTML = clipboard.html
      for (let i = 0; i < slideEls.length; i++) {
        if (i !== newSecIdx && slideEls[i].outerHTML === origHTML) {
          slideEls[i].remove(); break
        }
      }
      setClipboard(null)
    }
    Array.from(doc.querySelectorAll('section.slide')).forEach((el, i) => {
      el.classList.toggle('active', i === 0)
      ;(el as HTMLElement).style.removeProperty('display')
    })
    const newHtml = '<!DOCTYPE html>' + doc.documentElement.outerHTML
    const newSlideList = extractSlides(newHtml)
    const newIdx = afterIndex + 1
    pendingTargetRef.current = newIdx
    setHtmlContent(newHtml); latestHtmlRef.current = newHtml
    setSlides(newSlideList)
    setCurrentSlide(newIdx)
    savePresentation(newHtml, newSlideList)
    setTimeout(() => gotoSlide(newIdx), 100)
  }

  const deleteSlide = (index: number) => {
    if (!latestHtmlRef.current) return
    const doc = new DOMParser().parseFromString(latestHtmlRef.current, 'text/html')
    const slideEls = Array.from(doc.querySelectorAll('section.slide'))
    if (slideEls.length <= 1) return
    slideEls[index].remove()
    Array.from(doc.querySelectorAll('section.slide')).forEach((el, i) => {
      el.classList.toggle('active', i === 0)
      ;(el as HTMLElement).style.removeProperty('display')
    })
    const newHtml = '<!DOCTYPE html>' + doc.documentElement.outerHTML
    const newSlideList = extractSlides(newHtml)
    const newIdx = Math.min(index, newSlideList.length - 1)
    pendingTargetRef.current = newIdx
    setHtmlContent(newHtml); latestHtmlRef.current = newHtml
    setSlides(newSlideList)
    setCurrentSlide(newIdx)
    savePresentation(newHtml, newSlideList)
  }

  const mediaSrcs = useMemo(() => {
    if (!htmlContent) return [] as string[]
    const out = new Set<string>()
    const re = /\sdata-src="([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(htmlContent)) !== null) { if (/^https?:\/\//.test(m[1])) out.add(m[1]) }
    return [...out]
  }, [htmlContent])
  useEffect(() => {
    const want = mediaSrcs.filter(u => !(u in signedSrc))
    if (want.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await host.api.signMedia(want.slice(0, 200))
        const j = res.ok ? await res.json() as { urls?: Record<string, string> } : null
        if (cancelled) return
        const got = j?.urls ?? {}
        const next: Record<string, string> = {}
        for (const u of want) next[u] = got[u] ?? u
        pendingTargetRef.current = currentSlide
        setSignedSrc(prev => ({ ...prev, ...next }))
      } catch {  }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSrcs])
  const displayHtml = useMemo(() => slidesDisplayHtml(htmlContent, mediaSrcs, signedSrc), [htmlContent, mediaSrcs, signedSrc])
  const signedSrcRef = useRef(signedSrc)
  signedSrcRef.current = signedSrc
  const mediaShape = useMemo(() => signedShape(mediaSrcs, signedSrc), [mediaSrcs, signedSrc])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frameHtml = useMemo(() => slidesDisplayHtml(htmlContent, mediaSrcs, signedSrcRef.current), [htmlContent, mediaSrcs, mediaShape])

  const [pptxBusy, setPptxBusy] = useState(false)
  const pptxBusyRef = useRef(false)
  const downloadPptx = useCallback(async () => {
    if (!htmlContent || pptxBusyRef.current) return
    pptxBusyRef.current = true; setPptxBusy(true)
    try {
      if (deckDataRef.current) {
        const { buildComponentPptx } = await import('../pptx/pptx-components')
        const { blob, report } = await buildComponentPptx({ deck: deckDataRef.current, title, mediaUrl: (u) => signedSrc[u] ?? host.mediaUrl(u), proxy: host.pptxProxy })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${title || t('asld_untitled')}.pptx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
        const lines = pptxReportLines(report, (k) => t(k))
        if (lines.length) await alertDialog(`${t('slc_pptx_report_head')}\n${lines.map((l) => `· ${l}`).join('\n')}`)
        return
      }
      const { buildSlidesPptx } = await host.loadLegacyPptx()
      const { blob, stats } = await buildSlidesPptx({ html: stripEditScript(displayHtml), title, proxy: host.pptxProxy })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || t('asld_untitled')}.pptx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      if (stats.imagesSkipped > 0) await alertDialog(t('asld_pptx_img_skipped').replace('{n}', String(stats.imagesSkipped)))
    } catch {
      await alertDialog(t('asld_pptx_failed'))
    } finally {
      pptxBusyRef.current = false; setPptxBusy(false)
    }
  }, [displayHtml, htmlContent, t, title, signedSrc, host])

  const thumbDocs = useMemo(() => {
    if (typeof window === 'undefined' || !htmlContent) return []
    try {
      const doc = new DOMParser().parseFromString(stripEditScript(displayHtml), 'text/html')
      doc.querySelectorAll('script').forEach(s => s.remove())
      const headInner = doc.head ? doc.head.innerHTML : ''
      let els = Array.from(doc.querySelectorAll('section.slide'))
      if (els.length === 0) els = Array.from(doc.querySelectorAll('div.slide'))
      if (els.length === 0) {
        els = Array.from(doc.querySelectorAll('[class*="slide"]:not(style):not(script)'))
        els.forEach(el => el.setAttribute('data-thumb-root', ''))
      }
      if (els.length === 0) return [buildThumbDoc(headInner, doc.body ? doc.body.innerHTML : '')]
      return els.map(el => buildThumbDoc(headInner, el.outerHTML))
    } catch { return [] }
  }, [htmlContent, displayHtml])

  const thumbW = Math.max(110, leftWidth - 46)

  const [stageAreaEl, setStageAreaEl] = useState<HTMLDivElement | null>(null)
  const [panelNatEl, setPanelNatEl] = useState<HTMLDivElement | null>(null)
  const [stageFit, setStageFit] = useState<{ w: number; h: number } | null>(null)
  const stageListMode = deckData !== null
  const [panelH, setPanelH] = useState<number | null>(null)
  useEffect(() => { try { setPanelH(parsePanelH(localStorage.getItem(PANEL_H_KEY))) } catch {  } }, [])
  const startPanelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stageAreaEl || !stageFit || e.button !== 0) return
    e.preventDefault()
    const ah = stageAreaEl.clientHeight - 2
    const startH = clampPanelH(ah - stageFit.h, ah)
    const startY = e.clientY
    const bar = e.currentTarget
    bar.setPointerCapture(e.pointerId)
    let last = startH
    const move = (ev: PointerEvent) => { last = dragPanelH(startH, startY, ev.clientY, ah); setPanelH(last) }
    const up = () => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      bar.removeEventListener('pointercancel', up)
      try { localStorage.setItem(PANEL_H_KEY, String(last)) } catch {  }
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
  }
  const resetPanelH = () => { setPanelH(null); try { localStorage.removeItem(PANEL_H_KEY) } catch {  } }
  useEffect(() => {
    if (!stageAreaEl) return
    const FRAME = 2
    const compute = () => {
      const fit = fitStage({
        aw: stageAreaEl.clientWidth - FRAME,
        ah: stageAreaEl.clientHeight - FRAME,
        panelNatH: panelNatEl ? panelNatEl.offsetHeight : 0,
        listMode: stageListMode,
        panelH,
      })
      if (!fit) return
      setStageFit(prev => (prev && prev.w === fit.w && prev.h === fit.h ? prev : fit))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(stageAreaEl)
    if (panelNatEl && !stageListMode) ro.observe(panelNatEl)
    return () => ro.disconnect()
  }, [stageAreaEl, panelNatEl, stageListMode, panelH])
  const creatingNew = !slideId && !searchParams.get('id')
  const deckKindPending = !htmlContent && (idLoad === 'loading' || creatingNew)
  const showLeftPanel = slides.length > 0 || leftTab === 'drive' || deckKindPending
  const isV2 = deckData !== null || deckBroken

  const compMode = deckData !== null
  const displayDeck = useMemo(() => deckWithDrafts(deckData, heldDrafts, previewOp, applyComponentOp), [deckData, heldDrafts, previewOp])
  const deckLang = displayDeck?.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'
  const curPage = displayDeck?.pages[currentSlide] ?? null
  const curComps = useMemo<SlideComponent[]>(() => (curPage ? pageComponents(curPage, currentSlide, deckLang) : []), [curPage, currentSlide, deckLang])
  const deckTheme = useMemo(() => (displayDeck ? deckThemeOf(displayDeck) : null), [displayDeck])
  const curCtx = useMemo(() => (deckTheme && curPage ? resolveCtx(deckTheme, curPage.draft.type) : null), [deckTheme, curPage])
  const compNameOf = useCallback((id: string) => { const c = curComps.flatMap((x) => (x.type === 'group' ? [x, ...x.children] : [x])).find((x) => x.id === id); return c ? componentLabel(c, (k) => t(k)) : id }, [curComps, t])
  useEffect(() => { setSelectedCompId(null); setExpandedCompId(null); setAnimCompId(null) }, [currentSlide, slideId, setSelectedCompId])
  useEffect(() => { setRelayoutFor(null) }, [slideId])
  useEffect(() => { compHistoryRef.current.clearAll() }, [slideId])
  useEffect(() => {
    const live = new Set(allComponentIds(curComps))
    if (selectedCompIds.some((id) => !live.has(id))) setSelectedCompIds((ids) => ids.filter((id) => live.has(id)))
    if (expandedCompId && !live.has(expandedCompId)) setExpandedCompId(null)
    if (selectedCompIds.length > 1 && expandedCompId) setExpandedCompId(null)
  }, [curComps, selectedCompIds, expandedCompId])

  const canvasFontHrefs = useMemo(() => {
    if (!deckTheme || !displayDeck) return [] as string[]
    const fam = (name: string, w: string) => `${encodeURIComponent(name)}:wght@${w}`
    const gf = themeGoogleFamilies(deckTheme)
    const gfs = [gf.heading ? fam(gf.heading, '400;600;700') : null, gf.body ? fam(gf.body, '400;500') : null].filter(Boolean)
    const out = gfs.length ? [`https://fonts.googleapis.com/css2?${gfs.map((f) => `family=${f}`).join('&')}&display=swap`] : []
    for (const id of [...themeCssFontIds(deckTheme), ...catalogFontIdsOf(curComps)]) { const f = findFont(id); if (f && !out.includes(fontCssHref(f))) out.push(fontCssHref(f)) }
    return out
  }, [deckTheme, displayDeck, curComps])
  useEffect(() => {
    for (const href of canvasFontHrefs) {
      if (document.head.querySelector(`link[data-slc-font="${CSS.escape(href)}"]`)) continue
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-slc-font', href); l.crossOrigin = 'anonymous'
      document.head.appendChild(l)
    }
  }, [canvasFontHrefs])

  const canvasMediaUrl = useCallback((u: string) => signedSrc[u] ?? host.mediaUrl(u), [signedSrc, host])
  const canvasPlaceholder = useCallback((c: SlideComponent) => { const k = placeholderKey(c); return k ? t(k) : undefined }, [t])

  const runCompSteps = useCallback(async (steps: readonly CompStep[]): Promise<string[] | null> => {
    const h = compHistoryRef.current
    const created: string[] = []
    const inflight: Promise<boolean>[] = []
    for (const st of steps) {
      const op = h.resolveOp(st.op)
      if (op.kind === 'component_add') {
        if (!(await Promise.all(inflight)).every(Boolean)) return null
        inflight.length = 0
        let newId: string | null = null
        let childIds: string[] | null = null
        const ok = await sendCompOp(op, (rec) => {
          if (typeof rec.componentId === 'string') newId = rec.componentId
          if (Array.isArray(rec.childIds) && rec.childIds.every((x) => typeof x === 'string')) childIds = rec.childIds as string[]
        })
        if (!ok || !newId) return null
        if (st.restores) h.bindRestored(st.restores, newId)
        // 重新新增回来的是整组 ⇒ 子件也换了编号·逐个记别名（后面挂子件动画那几步才找得到）
        if (st.restoresChildren && childIds) st.restoresChildren.forEach((old, k) => { const nid = (childIds as string[])[k]; if (nid) h.bindRestored(old, nid) })
        created.push(newId)
      } else {
        inflight.push(sendCompOp(op))
      }
    }
    return (await Promise.all(inflight)).every(Boolean) ? created : null
  }, [sendCompOp])

  const runUserOps = useCallback(async (ops: readonly ComponentOp[]): Promise<string[] | null> => {
    if (!ops.length) return []
    const h = compHistoryRef.current
    const d = deckDataRef.current
    const placeholders = ops.map((o) => (o.kind === 'component_add' ? newPlaceholder() : undefined))
    const entry = d ? buildEntry(d, ops, placeholders) : null
    if (entry) h.push(entry)
    else if (d) {
      for (const o of ops) if ((o.kind === 'page_restore_layout' || o.kind === 'toc_rebuild' || o.kind === 'page_set_layout') && d.pages[o.pageIndex]) h.clearPage(d.pages[o.pageIndex].pid ?? `i${o.pageIndex}`)
    }
    const steps: CompStep[] = entry ? entry.forward : ops.map((op) => ({ op }))
    const created = await runCompSteps(steps)
    if (created === null && entry) h.clearPage(entry.page)
    return created
  }, [runCompSteps])

  const curPageKey = curPage ? (curPage.pid ?? `i${currentSlide}`) : null
  const undoRedo = useCallback(async (dir: 'undo' | 'redo') => {
    if (!curPageKey) return
    const h = compHistoryRef.current
    const e = dir === 'undo' ? h.takeUndo(curPageKey) : h.takeRedo(curPageKey)
    if (!e) return
    const created = await runCompSteps(dir === 'undo' ? e.inverse : e.forward)
    if (created === null) { h.clearPage(e.page); return }
    if (dir === 'undo') h.doneUndo(e); else h.doneRedo(e)
  }, [curPageKey, runCompSteps])

  const onCompOp = useCallback((op: ComponentOp) => {
    const page = currentSlide
    void runUserOps([op]).then((ids) => {
      if (op.kind !== 'component_add' || !ids?.length || currentSlideRef.current !== page) return
      setSelectedCompId(ids[0]); setExpandedCompId(ids[0])
    })
  }, [currentSlide, runUserOps, setSelectedCompId])

  const addCompsAndSelect = useCallback((ops: ComponentOp[]) => {
    const page = currentSlide
    void runUserOps(ops).then((ids) => {
      if (!ids?.length || currentSlideRef.current !== page) return
      setExpandedCompId(null); setSelectedCompIds(ids)
    })
  }, [currentSlide, runUserOps])

  const groupComps = useCallback((ids: readonly string[]) => {
    const top = ids.filter((id) => curComps.some((c) => c.id === id && c.type !== 'group' && c.type !== 'html'))
    if (top.length < 2) return
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    const gid = `g${(typeof c?.randomUUID === 'function' ? c.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 10)}`
    const page = currentSlide
    void runUserOps([{ kind: 'component_group', componentIds: top, groupId: gid }]).then((r) => {
      if (r === null || currentSlideRef.current !== page) return
      setExpandedCompId(null); setSelectedCompIds([gid])
    })
  }, [curComps, currentSlide, runUserOps])
  const ungroupComp = useCallback((id: string) => {
    const g = curComps.find((c) => c.id === id)
    if (!g || g.type !== 'group') return
    const kids = g.children.map((ch) => ch.id)
    const page = currentSlide
    void runUserOps([{ kind: 'component_ungroup', componentId: id }]).then((r) => {
      if (r === null || currentSlideRef.current !== page) return
      setExpandedCompId(null); setSelectedCompIds(kids)
    })
  }, [curComps, currentSlide, runUserOps])

  const onCanvasFrames = useCallback((changes: FrameChange[]) => {
    void runUserOps(changes.map((c) => ({ kind: 'component_frame', componentId: c.id, frame: c.frame }) as ComponentOp))
  }, [runUserOps])
  const onCanvasZ = useCallback((ids: string[], z: ZMove) => {
    if (ids.length === 1) { void runUserOps([{ kind: 'component_order', componentId: ids[0], z }]); return }
    if (typeof z === 'number') return
    const moves = groupZMoves(curComps.map((c) => c.id), new Set(ids), z)
    void runUserOps(moves.map((m) => ({ kind: 'component_order', componentId: m.id, z: m.z }) as ComponentOp))
  }, [curComps, runUserOps])
  const onCanvasDuplicate = useCallback((moved: Map<string, Frame>) => {
    const pid = deckDataRef.current?.pages[currentSlide]?.pid
    addCompsAndSelect(duplicateOps(curComps, moved, currentSlide, pid))
  }, [addCompsAndSelect, curComps, currentSlide])
  const onGroupFrame = useCallback((f: Partial<Frame>) => {
    const items = curComps.filter((c) => selectedCompIds.includes(c.id) && !c.locked).map((c) => ({ id: c.id, frame: c.frame }))
    if (items.length < 2) return
    const box = groupBox(items.map((i) => i.frame))
    let next = items
    if (f.x !== undefined || f.y !== undefined) next = moveGroup(items, (f.x ?? box.x) - box.x, (f.y ?? box.y) - box.y, [], 0, false).items
    else if (f.w !== undefined && box.w > 0) next = resizeGroup(items, box, 'se', f.w - box.w, 0)
    else if (f.h !== undefined && box.h > 0) next = resizeGroup(items, box, 'se', 0, f.h - box.h)
    const changes = next.map((n, i) => ({ id: n.id, frame: n.frame, before: items[i].frame })).filter((c) => JSON.stringify(c.frame) !== JSON.stringify(c.before))
    onCanvasFrames(changes.map((c) => ({ id: c.id, frame: c.frame })))
  }, [curComps, selectedCompIds, onCanvasFrames])

  const compKeysRef = useRef({ compMode: false, curComps: [] as SlideComponent[], selectedCompIds: [] as string[], curPageKey: null as string | null, currentSlide: 0, undoRedo, runUserOps, addCompsAndSelect, groupComps, ungroupComp })
  compKeysRef.current = { compMode: deckData !== null, curComps, selectedCompIds, curPageKey, currentSlide, undoRedo, runUserOps, addCompsAndSelect, groupComps, ungroupComp }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = compKeysRef.current
      if (!s.compMode || !s.curPageKey || e.defaultPrevented || !modKey(e) || e.altKey) return
      if (!isDeckShortcutTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'g') {
        if (!s.selectedCompIds.length) return
        e.preventDefault()
        if (e.shiftKey) { for (const id of s.selectedCompIds) if (s.curComps.some((c) => c.id === id && c.type === 'group')) s.ungroupComp(id) }
        else s.groupComps(s.selectedCompIds)
        return
      }
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        void s.undoRedo(k === 'y' || e.shiftKey ? 'redo' : 'undo')
        return
      }
      if (k === 'c' || k === 'x') {
        const txt = typeof window.getSelection === 'function' ? window.getSelection()?.toString() ?? '' : ''
        if (txt || !s.selectedCompIds.length) return
        const sel = new Set(s.selectedCompIds)
        const clip = makeClip(s.curPageKey, s.curComps, sel)
        if (!clip) return
        e.preventDefault()
        compClipRef.current = clip
        if (k === 'x') {
          const del = s.curComps.filter((c) => sel.has(c.id) && !c.locked).map((c) => ({ kind: 'component_delete', componentId: c.id }) as ComponentOp)
          if (del.length) { void s.runUserOps(del); setSelectedCompIds([]); setExpandedCompId(null) }
        }
        return
      }
      if (k === 'v') {
        const clip = compClipRef.current
        if (!clip) return
        e.preventDefault()
        const pid = deckDataRef.current?.pages[s.currentSlide]?.pid
        const r = pasteOps(clip, s.curPageKey, s.currentSlide, pid)
        clip.pasted = r.nextPasted
        s.addCompsAndSelect(r.ops)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const playerRef = useRef<SlidesPlayerHandle>(null)
  const [playing, setPlaying] = useState(false)
  const [playHtml, setPlayHtml] = useState('')
  const startPlay = useCallback(() => {
    if (!displayHtml || slides.length === 0) return
    setPlayHtml(playSlidesHtml(displayHtml))
    setPlaying(true)
    playerRef.current?.start(currentSlide)
  }, [displayHtml, slides.length, currentSlide])
  host.useSignedMediaRefresh({
    map: signedSrc,
    merge: (fresh) => setSignedSrc(prev => ({ ...prev, ...fresh })),
    frames: () => [iframeRef.current, playerRef.current?.frame()],
    root: () => document,
  })
  const onPlayExit = useCallback((index: number) => {
    setPlaying(false)
    setPlayHtml('')
    if (index >= 0 && index < slides.length && index !== currentSlide) gotoSlide(index)
  }, [slides.length, currentSlide, gotoSlide])

  const stepperRef = useRef<{ next: () => boolean; prev: () => boolean; destroy: () => void } | null>(null)
  const curPagePid = curPage?.pid
  useEffect(() => {
    if (!compMode) return
    const ctl = skStepsFactory().controller(window, () => document.querySelector('[data-testid=slides-canvas] [data-sk-canvas]'))
    stepperRef.current = ctl
    return () => { ctl.destroy(); if (stepperRef.current === ctl) stepperRef.current = null }
  }, [compMode, docEpoch, curPagePid, currentSlide])
  const previewStep = useCallback((dir: 1 | -1): boolean => {
    const s = stepperRef.current
    if (!s) return false
    return dir > 0 ? s.next() : s.prev()
  }, [])

  const previewNavRef = useRef({ compMode: false, selected: 0, cur: 0, count: 0, playing: false })
  previewNavRef.current = { compMode, selected: selectedCompIds.length, cur: currentSlide, count: slides.length, playing }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = previewNavRef.current
      if (s.playing || e.defaultPrevented || s.count <= 0) return
      if (document.querySelector('[aria-modal="true"]')) return
      const el = e.target as Element | null
      if (el && typeof el.closest === 'function' && el.closest('[role="dialog"],[role="alertdialog"]')) return
      const a = playKeyAction(e)
      if (!a) return
      if (s.compMode && s.selected > 0 && e.key.startsWith('Arrow')) return
      if (s.compMode && (a === 'nextStep' || a === 'prevStep') && previewStep(a === 'nextStep' ? 1 : -1)) { e.preventDefault(); return }
      const pageAct = s.compMode ? (a === 'nextStep' ? 'nextPage' : a === 'prevStep' ? 'prevPage' : a) : a
      const p = targetPage(pageAct, s.cur, s.count)
      e.preventDefault()
      if (p !== null) { if (p !== s.cur) gotoSlide(p); return }
      iframeRef.current?.contentWindow?.postMessage({ type: a === 'prevStep' ? 'prevStep' : 'nextStep' }, '*')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gotoSlide, previewStep])

  const uploadMediaFiles = useCallback(async (files: FileList | File[]): Promise<UploadedAttachment[]> => {
    const out: UploadedAttachment[] = []
    for (const file of Array.from(files)) {
      const tooLarge = host.uploadTooLarge(file)
      if (tooLarge) { await alertDialog(tooLarge); continue }
      const res = await host.api.uploadMedia(file)
      const j = await res.json().catch(() => null) as { url?: string; display_url?: string; error?: string } | null
      if (!res.ok || !j?.url) { await alertDialog(j?.error || t('asld_tb_upload_failed')); continue }
      setSignedSrc(prev => ({ ...prev, [j.url as string]: j.display_url || (j.url as string) }))
      out.push({ url: j.url, displayUrl: j.display_url, name: file.name, mime: file.type, source: 'local' })
    }
    return out
  }, [t, host])

  const onCanvasDrop = useCallback(async (drop: CanvasDrop, at: { x: number; y: number }) => {
    let att: UploadedAttachment | null = null
    if (drop.kind === 'drive') {
      if (drop.item.kind !== 'file') { await alertDialog(t('slc_drop_not_media')); return }
      const r = await host.resolveDriveDrop(drop.item.id, drop.item.name)
      if (!r.ok) { await alertDialog(t('slc_drop_failed')); return }
      att = r.attachment
    } else {
      const f = drop.files.find((x) => x.type.startsWith('image/') || x.type.startsWith('video/'))
      if (!f) { await alertDialog(t('slc_drop_not_media')); return }
      att = (await uploadMediaFiles([f]))[0] ?? null
    }
    if (!att) return
    const mime = att.mime || (drop.kind === 'drive' ? drop.item.mime ?? '' : '')
    const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : null
    if (!kind) { await alertDialog(t('slc_drop_not_media')); return }
    if (att.displayUrl) setSignedSrc(prev => ({ ...prev, [att!.url]: att!.displayUrl! }))
    const w = kind === 'video' ? 480 : 400, h = kind === 'video' ? 270 : 300
    onCompOp({
      kind: 'component_add', pageIndex: currentSlide, ...(deckDataRef.current?.pages[currentSlide]?.pid ? { pageId: deckDataRef.current.pages[currentSlide].pid } : {}),
      component: { type: kind, src: att.url, frame: { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h } },
    })
  }, [currentSlide, onCompOp, t, uploadMediaFiles, host])

  const pollBusyRef = useRef(false)
  const [liveSyncEpoch, setLiveSyncEpoch] = useState(0)
  type LatestDeckRow = { title?: unknown; html_content?: unknown; deck_data?: unknown }
  const fetchLatestDeckRow = useCallback(async (): Promise<LatestDeckRow | null> => {
    const sid = loadedIdRef.current
    if (!sid) return null
    const r = await host.api.getSlide(sid)
    if (!r.ok || loadedIdRef.current !== sid) return null
    const row = await r.json() as LatestDeckRow
    return loadedIdRef.current === sid ? row : null
  }, [host])
  const applyLatestDeckRow = useCallback((row: LatestDeckRow) => {
    applyDeckRow(row, currentSlideRef.current, true)
    compHistoryRef.current.clearAll()
    setRemoteNewer(null)
    setLiveSyncEpoch(n => n + 1)
  }, [applyDeckRow])
  const reloadLatestDeck = useCallback(async () => {
    const row = await fetchLatestDeckRow()
    if (row) applyLatestDeckRow(row)
  }, [fetchLatestDeckRow, applyLatestDeckRow])
  useEffect(() => { deckEditBusyRef.current = deckEditBusy }, [deckEditBusy])
  useEffect(() => { previewOpRef.current = previewOp }, [previewOp])
  useEffect(() => {
    if (!compMode || !slideId) return
    const tick = async () => {
      if (document.visibilityState !== 'visible' || pollBusyRef.current) return
      if (liveGateRef.current) return
      if (deckEditBusyRef.current || optimisticRef.current.length) return
      pollBusyRef.current = true
      try {
        const res = await host.api.deckRevision(slideId)
        if (!res.ok) return
        const j = await res.json() as { revision?: unknown }
        const remote = typeof j.revision === 'number' ? j.revision : null
        const verdict = slidesLiveVerdict({ remote, local: deckRevision(deckDataRef.current), hasDraft: !!previewOpRef.current || heldDraftsRef.current.length > 0 })
        if (verdict === 'prompt') { liveGateRef.current = true; setRemoteNewer(remote) }
        else if (verdict === 'reload') {
          const row = await fetchLatestDeckRow()
          if (!row || liveGateRef.current || deckEditBusyRef.current || optimisticRef.current.length) return
          const fe = readFocusedRichEditor(document)
          const v2 = slidesLiveVerdict({
            remote, local: deckRevision(deckDataRef.current), hasDraft: !!previewOpRef.current || heldDraftsRef.current.length > 0,
            focused: fe ? { componentId: fe.componentId, boxText: paragraphsText(fe.paragraphs) } : null, remoteDeck: row.deck_data,
          })
          if (v2 === 'prompt') {
            liveGateRef.current = true
            if (fe && !previewOpRef.current) {
              const isShape = deckDataRef.current?.pages.some(pg => pg.components?.some(c => c.id === fe.componentId && c.type === 'shape'))
              setHeld(holdDraft(heldDraftsRef.current, { seq: ++compSeqRef.current, op: { kind: 'component_update', componentId: fe.componentId, patch: isShape ? { paragraphs: fe.paragraphs, box: {} } : { paragraphs: fe.paragraphs } } }))
            }
            setRemoteNewer(remote)
          } else if (v2 === 'reload') applyLatestDeckRow(row)
        }
      } catch {  } finally { pollBusyRef.current = false }
    }
    const h = window.setInterval(() => { void tick() }, SLIDES_LIVE_POLL_MS)
    return () => window.clearInterval(h)
  }, [compMode, slideId, fetchLatestDeckRow, applyLatestDeckRow, setHeld, host])

  const takeRemoteDeck = useCallback(async () => {
    const mine = [...heldDraftsRef.current.map(h => h.op), ...(previewOpRef.current ? [previewOpRef.current] : [])]
    setHeld([])
    setTypingOp(null)
    setLiveStash(mine.length ? mine : null)
    await reloadLatestDeck()
    setRemoteNewer(null)
    liveGateRef.current = false
  }, [reloadLatestDeck, setHeld, setTypingOp])
  const keepMineDeck = useCallback(async () => {
    setRemoteNewer(null)
    await reloadLatestDeck()
    const mine = heldDraftsRef.current.map(h => h.op)
    setHeld([])
    liveGateRef.current = false
    for (const op of mine) await sendCompOp(op)
    if (mine.length) setLiveSyncEpoch(n => n + 1)
  }, [reloadLatestDeck, sendCompOp, setHeld])
  const restoreLiveStash = useCallback(async () => {
    const ops = liveStash
    setLiveStash(null)
    if (!ops) return
    for (const op of ops) await sendCompOp(op)
  }, [liveStash, sendCompOp])

  const saveAsComponents = useCallback(async () => {
    const sid = loadedIdRef.current
    if (!sid || saveAsBusy) return
    if (!await confirmDialog({ message: t('slc_save_as_confirm') })) return
    setSaveAsBusy(true)
    try {
      const res = await host.api.createDeck({ fromLegacyId: sid, lang: language === 'zh-CN' ? 'zh-CN' : 'zh-TW' })
      const j = await res.json().catch(() => null) as { id?: string; error?: string } | null
      if (!res.ok || !j?.id) { await alertDialog(j?.error || t('slc_save_as_failed')); return }
      host.openDeck(j.id)
    } finally { setSaveAsBusy(false) }
  }, [saveAsBusy, t, language, host])

  if (authed === null) return <>{host.renderGate(authSlow ? 'auth_slow' : 'auth_checking', searchParams.get('id'))}</>
  if (!authed || (idLoad === 'failed' && idFail === 'login')) return <>{host.renderGate('login', searchParams.get('id'))}</>
  if (idLoad === 'failed' && (idFail === 'not_found' || idFail === 'bad_id')) return <>{host.renderGate(idFail, searchParams.get('id'))}</>

  return (
    <div className={`relative flex flex-col h-screen ${editorShell.root} overflow-hidden select-none`} style={editorShell.rootFont} data-testid="slides-shell">

      <header className={`${editorShell.headerBar} px-4 py-2.5 flex items-center gap-3 shrink-0 relative`} style={editorShell.beigeSurface} data-testid="slides-topbar">
        {host.renderHomeBrand({ iconOnly: isNarrow, testId: 'slides-home' })}
        <div className={editorShell.headerDivider} />
        {host.has('drive') && (<>
        <a href="/my-drive" target="_blank" rel="noopener noreferrer" title={t('scribe_drive_title')} data-testid="slides-header-drive"
          className={editorShell.headerLink}>
          {isNarrow ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M2 6a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586l1.414 1.414a2 2 0 0 0 1.414.586H16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
            </svg>
          ) : (
            t('asld_drive')
          )}
        </a>
        <div className={editorShell.headerDivider} />
        </>)}
        <button type="button" onClick={() => setShowTemplates(true)} title={t('tpl_btn')} data-testid="slides-header-template"
          className={editorShell.headerLink}>
          {isNarrow ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v2.5A2.25 2.25 0 0 0 4.25 9h2.5A2.25 2.25 0 0 0 9 6.75v-2.5A2.25 2.25 0 0 0 6.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 2 13.25v2.5A2.25 2.25 0 0 0 4.25 18h2.5A2.25 2.25 0 0 0 9 15.75v-2.5A2.25 2.25 0 0 0 6.75 11h-2.5Zm9-9A2.25 2.25 0 0 0 11 4.25v2.5A2.25 2.25 0 0 0 13.25 9h2.5A2.25 2.25 0 0 0 18 6.75v-2.5A2.25 2.25 0 0 0 15.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 11 13.25v2.5A2.25 2.25 0 0 0 13.25 18h2.5A2.25 2.25 0 0 0 18 15.75v-2.5A2.25 2.25 0 0 0 15.75 11h-2.5Z" clipRule="evenodd" />
            </svg>
          ) : (
            t('tpl_btn')
          )}
        </button>
        <div className={editorShell.headerDivider} />
        <input
          ref={titleInputRef}
          value={title}
          readOnly={aiLocked}
          onChange={e => { if (!aiLocked) setTitle(e.target.value) }}
          onFocus={() => { titleFocusRef.current = title }}
          onBlur={() => {
            if (aiLocked) return
            if (title === titleFocusRef.current) return
            if (deckDataRef.current) void patchDeck({ kind: 'rename', title })
            else if (!deckMarkedRef.current && latestHtmlRef.current) savePresentation(latestHtmlRef.current, slides, title)
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={`flex-1 ${editorShell.titleInput} select-text`}
          placeholder={t('asld_untitled')}
          title={t('asld_rename_hint')}
        />
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-gray-500">
            {saveStatus === 'saving' ? t('asld_saving') : saveStatus === 'saved' ? t('asld_saved')
              : saveStatus === 'restore_failed' ? <span className="text-red-400">{t('asld_restore_failed')}</span>
              : saveStatus === 'restore_unverified' ? <span className="text-amber-400">{t('asld_restore_unverified')}</span>
              : saveStatus === 'conflict' ? <span className="text-amber-400">{t('asld_conflict_reloaded')}</span>
              : saveStatus === 'save_conflict' ? <span className="text-amber-400">{t('asld_save_conflict')}</span>
              : saveStatus === 'edit_failed' ? <span className="text-red-400">{t('asld_edit_failed')}</span>
              : saveStatus === 'page_gone' ? <span className="text-amber-400">{t('asld_page_gone')}</span>
              : saveStatus === 'page_ambiguous' ? <span className="text-amber-400">{t('asld_page_ambiguous')}</span>
              : saveStatus === 'delete_confirm_stale' ? <span className="text-amber-400">{t('asld_delete_confirm_stale')}</span>
              : `${t('asld_slides_label')}${slides.length}${t('asld_slides_label_suf')}`}
          </span>
          <button type="button" onClick={startPlay} disabled={!htmlContent || slides.length === 0} data-testid="slides-play-btn"
            className={`${editorShell.headerTextBtn} disabled:opacity-30 flex items-center gap-1`}
            title={t('asld_play_title')} aria-label={t('asld_play')}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden="true"><path d="M6 4.2v11.6a.7.7 0 0 0 1.06.6l9.3-5.8a.7.7 0 0 0 0-1.2l-9.3-5.8A.7.7 0 0 0 6 4.2Z" /></svg>
            {!isNarrow && t('asld_play')}
          </button>
          <button onClick={downloadHtml} disabled={!htmlContent} data-testid="slides-download-html"
            className={`${editorShell.headerTextBtn} disabled:opacity-30`}
            title={t('asld_download_html')} aria-label={t('asld_download_html')}>html</button>
          <button onClick={() => { void downloadPptx() }} disabled={!htmlContent || pptxBusy} data-testid="slides-download-pptx"
            className={`${editorShell.headerTextBtn} disabled:opacity-30`}
            title={t('asld_download_pptx')} aria-label={t('asld_download_pptx')}>{pptxBusy ? 'pptx…' : 'pptx'}</button>
          {host.has('share') && <button onClick={() => { setShowShareModal(true); setVisDropdownOpen(false) }} disabled={!slideId}
            className={`${editorShell.headerLinkBtn} disabled:opacity-30 flex items-center gap-1`}
            title={t('asld_share_slides')}>
            {isNarrow ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.518 2.518 0 0 1 0 .792l6.733 3.367a2.5 2.5 0 1 1-.671 1.341l-6.733-3.367a2.5 2.5 0 1 1 0-3.475l6.733-3.366A2.52 2.52 0 0 1 13 4.5Z" />
              </svg>
            ) : (
              t('asld_share')
            )}
          </button>}
        </div>
        {host.renderShieldPill(aiShield, 'slides-ai-shield')}
      </header>

      <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden">

      {showLeftPanel && leftCollapsed && (
        <PanelCollapsedEdge side="left" onExpand={() => setLeftCollapsed(false)} title={t('asld_tab_slides')} testId="slides-left-collapsed" />
      )}
      {showLeftPanel && !leftCollapsed && (
        <div ref={leftPanelRef} className={editorShell.sideCol} style={{ width: leftWidth, ...editorShell.beigeSurface }} data-testid="slides-left">
          <div className={`flex ${editorShell.headerBar} shrink-0`}>
            <button onClick={() => setLeftTab('slides')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${leftTab === 'slides' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
              {t('asld_tab_slides')}
            </button>
            <button onClick={() => setLeftTab('outline')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${leftTab === 'outline' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
              {t('asld_tab_outline')}
            </button>
            <button onClick={() => setLeftTab('drive')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${leftTab === 'drive' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
              {host.driveSlotLabel ?? t('asld_drive')}
            </button>
            <PanelCollapseButton side="left" onCollapse={() => setLeftCollapsed(true)} title={t('scribe_collapse')} testId="slides-left-collapse" />
          </div>

          {leftTab === 'slides' && (
            <>
              <div className="px-3 pt-2 text-[10px] text-gray-700 shrink-0">{t('asld_drag_hint')}</div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {slides.map((slide, i) => (
                <div key={i} draggable={!isV2 || compMode} data-testid="slides-thumb-row"
                  onDragStart={() => { if (!isV2 || compMode) dragFromRef.current = i }}
                  onDragOver={e => { if (isV2 && !compMode) return; if (compMode && dragFromRef.current === null) return; e.preventDefault(); setDragOver(i) }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => {
                    if (isV2 && !compMode) return
                    e.preventDefault()
                    const from = dragFromRef.current
                    if (from !== null && from !== i) {
                      if (compMode) onCompOp({ kind: 'page_move', pageIndex: from, ...(deckDataRef.current?.pages[from]?.pid ? { pageId: deckDataRef.current.pages[from].pid } : {}), to: i })
                      else reorderSlides(from, i)
                    }
                    dragFromRef.current = null; setDragOver(null)
                  }}
                  onDragEnd={() => { dragFromRef.current = null; setDragOver(null) }}
                  onClick={() => gotoSlide(i)}
                  onContextMenu={e => {
                    if (isV2 && !compMode) return
                    e.preventDefault()
                    const y = e.clientY + 220 > window.innerHeight ? e.clientY - 220 : e.clientY
                    setContextMenu({ x: e.clientX, y, index: i })
                  }}
                  className={`cursor-pointer p-1.5 rounded-xl transition-all select-none border ${
                    dragOver === i ? `border-blue-500 ${editorShell.softSurface}`
                    : currentSlide === i ? `border-transparent ${editorShell.driveFileRowCurrent}`
                    : `border-transparent ${editorShell.driveFileRowIdle}`
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-0.5">
                    <span className="text-[10px] text-gray-600 cursor-grab">⠿</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{t('asld_page_pre')}{i + 1}{t('asld_page_suf')}</span>
                    <span className="text-[10px] text-gray-400 truncate">{slide.title}</span>
                  </div>
                  {thumbDocs[i]
                    ? <SlideThumb doc={thumbDocs[i]} width={thumbW} />
                    : <div className={`w-full rounded-lg ${editorShell.softSurface}`} style={{ aspectRatio: '16 / 9' }} />}
                </div>
              ))}
              </div>
            </>
          )}

          {leftTab === 'outline' && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {deckData
                ? deckData.pages.map((p, i) => {
                    const d = p.draft
                    const ptypeKey = d.type === 'cover' ? 'asld_ptype_cover'
                      : d.type === 'contents' ? 'asld_ptype_contents'
                      : d.type === 'transition' ? 'asld_ptype_transition'
                      : d.type === 'content' ? 'asld_ptype_content' : 'asld_ptype_end'
                    const pageTitle = d.type === 'contents'
                      ? t('asld_ptype_contents')
                      : (d.title || slides[i]?.title || `${t('asld_page_pre')}${i + 1}${t('asld_page_suf')}`)
                    const compLines = pageSummaryLines(p.components)
                    const subLines: string[] = compLines ??
                      (d.type === 'content' ? d.items.map(it => it.heading || it.body).filter(Boolean).slice(0, 3)
                      : d.type === 'contents' ? d.items.slice(0, 5)
                      : d.type === 'cover' ? (d.subtitle ? [d.subtitle] : [])
                      : d.type === 'transition' ? (d.lead ? [d.lead] : [])
                      : (d.subtitle ? [d.subtitle] : []))
                    return (
                      <button key={p.pid ?? i} onClick={() => gotoSlide(i)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${currentSlide === i ? `border-transparent ${editorShell.driveFileRowCurrent}` : `border-transparent ${editorShell.driveFileRowIdle}`}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-500 shrink-0">{t('asld_page_pre')}{i + 1}{t('asld_page_suf')}</span>
                          <span className={`text-[9px] px-1 py-px rounded ${editorShell.softSurface} ${editorShell.hintText} shrink-0`}>{t(ptypeKey)}</span>
                        </div>
                        <div className="text-[12px] text-gray-200 truncate mt-0.5">{pageTitle}</div>
                        {subLines.map((s, j) => (
                          <div key={j} className="text-[10px] text-gray-500 truncate mt-0.5 pl-1">· {s}</div>
                        ))}
                      </button>
                    )
                  })
                : slides.map((s, i) => (
                    <button key={i} onClick={() => gotoSlide(i)}
                      className={`w-full text-left flex items-center gap-1.5 px-2.5 py-2 rounded-lg border transition-colors ${currentSlide === i ? `border-transparent ${editorShell.driveFileRowCurrent}` : `border-transparent ${editorShell.driveFileRowIdle}`}`}>
                      <span className="text-[10px] text-gray-500 shrink-0">{t('asld_page_pre')}{i + 1}{t('asld_page_suf')}</span>
                      <span className="text-[12px] text-gray-200 truncate">{s.title}</span>
                    </button>
                  ))}
            </div>
          )}

          {leftTab === 'drive' && (
            host.renderDriveSlot({ currentId: slideId })
          )}
        </div>
      )}

      {showLeftPanel && !leftCollapsed && (
        <div className={editorShell.resizeHandle}
          onMouseDown={e => { e.preventDefault(); resizingRef.current = 'left'; lastXRef.current = e.clientX; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; if (iframeRef.current) iframeRef.current.style.pointerEvents = 'none' }}>
        <div className={editorShell.resizeHandleLine} />
        <div className={editorShell.resizeHandleGrip} />
      </div>
      )}

      <div ref={centerRef} className={`flex-1 min-w-[300px] flex flex-col relative ${editorShell.centerCol}`} data-testid="slides-center">
        <div className="flex-1 min-h-0 flex flex-col" data-testid="slides-center-body">
        {slidesRestore && slidesRestore.id === slideId && (
          host.renderRestoreBar({
            testId: 'slides-restore-bar',
            onApply: () => { void applySlidesRestore() },
            onDiscard: () => setSlidesRestore(null),
            applyLabel: slidesRestoreModeNow === 'overwrite' ? t('ai_shield_restore_apply_overwrite') : slidesRestoreModeNow === 'replay' ? t('ai_shield_restore_apply') : null,
            children: slidesRestoreModeNow === 'text' && (
              <>
                <span className="max-w-[40ch] truncate" title={slidesDraftText(slidesRestore)} data-testid="slides-restore-text">{t('ai_shield_restore_text_only')}{slidesDraftText(slidesRestore)}</span>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(slidesDraftText(slidesRestore)).catch(() => {}) }} data-testid="slides-restore-bar-copy" className="rounded-md border border-amber-300 px-2.5 py-1 hover:bg-amber-100">{t('ai_shield_restore_copy')}</button>
              </>
            ),
          })
        )}
        <div className={`flex items-center gap-2 px-4 py-2 ${editorShell.toolbarBar} shrink-0`} data-testid="slides-toolbar">
          <span className="text-[11px] text-gray-500">{t('asld_preview')}</span>
          {slides.length > 0 && (
            <>
              <div className={editorShell.headerDivider} />
              <span className="text-[11px] text-gray-300 truncate max-w-[200px]">{slides[currentSlide]?.title}</span>
              <div className={editorShell.headerDivider} />
              <span className="text-[11px] text-gray-500">{currentSlide + 1} / {slides.length}</span>
              <div className="flex items-center gap-1.5 ml-auto">
                <button onClick={compMode ? () => { if (!previewStep(-1)) gotoSlide(Math.max(0, currentSlide - 1)) } : stepBackward} data-testid="slides-prev"
                  className={`w-7 h-6 justify-center ${editorShell.toolbarBtn} disabled:opacity-25`}>←</button>
                <button onClick={compMode ? () => { if (!previewStep(1)) gotoSlide(Math.min(slides.length - 1, currentSlide + 1)) } : stepForward} data-testid="slides-next"
                  className={`w-7 h-6 justify-center ${editorShell.toolbarBtn} disabled:opacity-25`}>→</button>
              </div>
            </>
          )}
        </div>

        {!compMode && !deckKindPending && <SlidesFormatToolbar
          enabled={!!htmlContent && slides.length > 0 && !deckBroken && idLoad !== 'loading' && idLoad !== 'failed'}
          editMode={editMode}
          painterActive={painterActive}
          sel={selState}
          onToggleEdit={toggleEditMode}
          onFormat={sendFormat}
          onCopyFormat={copyFormat}
          onInsertImage={(f) => { void uploadAndInsert(f, 'image') }}
          onInsertVideoFile={(f) => { void uploadAndInsert(f, 'video') }}
          onInsertVideoUrl={() => { void insertVideoByUrl() }}
          uploading={mediaUploading}
        />}
        {compMode && remoteNewer !== null && (
          <div className="px-4 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-[11px] text-blue-800 flex items-center gap-2" data-testid="slc-remote-newer">
            <span>{t('slc_remote_newer')}</span>
            <button type="button" className="px-2 py-0.5 rounded bg-blue-600 keep-white" data-testid="slc-remote-apply" onClick={() => { void takeRemoteDeck() }}>{t('slc_remote_apply')}</button>
            <button type="button" className="px-2 py-0.5 rounded border border-blue-300" data-testid="slc-remote-keep" onClick={() => { void keepMineDeck() }}>{t('slc_remote_keep')}</button>
          </div>
        )}
        {compMode && remoteNewer === null && liveStash && (
          <div className="px-4 py-1.5 bg-violet-500/10 border-b border-violet-500/20 text-[11px] text-violet-800 flex items-center gap-2" data-testid="slc-live-restore-bar">
            <span>{language === 'zh-CN' ? '已载入最新版 · 你原本的修改已暂存'
              : language === 'en' ? 'Latest version loaded · your changes were stashed'
              : '已載入最新版 · 你原本的修改已暫存'}</span>
            <button type="button" className="px-2 py-0.5 rounded bg-violet-600 keep-white" data-testid="slc-live-restore" onClick={() => { void restoreLiveStash() }}>{t('bf_scribe_editing_restore_btn')}</button>
            <button type="button" className="px-2 py-0.5 rounded border border-violet-300" onClick={() => setLiveStash(null)}>{t('bf_scribe_editing_restore_dismiss')}</button>
          </div>
        )}
        {editMode && (
          <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-700">
            {t('asld_edit_banner')}
          </div>
        )}

        <div ref={setStageAreaEl} className={`flex-1 min-h-0 flex flex-col ${editorShell.centerCol}`} data-testid="slides-stage-area">
        <div className={`shrink-0 flex justify-center ${editorShell.centerCol}`} style={stageFit ? { height: stageFit.h + 2 } : { aspectRatio: '16 / 9' }}>
        <div className={`${editorShell.centerCol} relative shrink-0 border ${editorShell.divider} shadow`} style={stageFit ? { width: stageFit.w, height: stageFit.h, boxSizing: 'content-box' } : { width: '100%', height: '100%' }} data-testid="slides-canvas"
          onContextMenu={e => {
            if (!compMode || deckEditBusy) return
            e.preventDefault()
            const y = e.clientY + 220 > window.innerHeight ? e.clientY - 220 : e.clientY
            setContextMenu({ x: e.clientX, y, index: currentSlide })
          }}>
          {htmlContent && compMode && deckTheme && curPage && stageFit ? (
            <ComponentCanvas
              key={`${docEpoch}:${curPage.pid ?? currentSlide}`}
              components={curComps} animations={curPage.animations} background={curPage.background}
              theme={deckTheme} pageType={curPage.draft.type} width={stageFit.w}
              selectedIds={selectedCompIds}
              onSelect={(ids) => { setSelectedCompIds(ids); if (ids.length !== 1) setExpandedCompId(null) }}
              onFrames={onCanvasFrames}
              onZ={onCanvasZ}
              onAnimate={(id) => setAnimCompId(id)}
              onJump={(id) => { setSelectedCompId(id); setExpandedCompId(id) }}
              onDuplicate={onCanvasDuplicate}
              onDrop={(drop, at) => { void onCanvasDrop(drop, at) }}
              mediaUrl={canvasMediaUrl}
              placeholderFor={canvasPlaceholder}
              onGroup={groupComps}
              onUngroup={ungroupComp}
              onRelayout={() => setRelayoutFor(currentSlide)}
            />
          ) : htmlContent ? (
            <>
              <iframe key={docEpoch}
                ref={el => { iframeRef.current = el; if (el?.contentWindow) docWinRef.current = el.contentWindow }}
                srcDoc={injectEditScript(frameHtml)}
                className="w-full h-full border-0" sandbox="allow-scripts" title={t('asld_preview_title')} onLoad={handleIframeLoad} />
              {!loading && slides.length === 1 && slides[0].fallback && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 ${editorShell.maskColor} pointer-events-none select-none`}>
                  <div className="text-2xl">⚠️</div>
                  <div className={`text-sm ${editorShell.hintText} text-center px-8`}>{t('asld_format_overlay')}</div>
                </div>
              )}
            </>
          ) : creatingNew ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 select-none">
              {blankState === 'failed' ? (
                <>
                  <div className="text-4xl">⚠️</div>
                  <div className="text-sm text-gray-500">{t('asld_blank_failed')}</div>
                  <button onClick={() => void createBlankDeck()}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 keep-white text-sm transition-colors">
                    {t('asld_blank_retry')}
                  </button>
                </>
              ) : (
                <>
                  <EditorLoadingArt kind="slides" />
                  <div className="text-sm font-medium text-gray-600">{t('asld_blank_creating')}</div>
                </>
              )}
            </div>
          ) : (idLoad === 'loading' || idLoad === 'failed') ? (
            <div className="absolute inset-0" />
          ) : (
            <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 ${editorShell.mutedText} pointer-events-none`}>
              <EditorLoadingArt kind="slides" idle />
              <div className="text-sm font-medium text-gray-600">{t('asld_empty_deck')}</div>
            </div>
          )}
        </div>
        </div>
        {compMode && stageFit && (
          <div role="separator" aria-orientation="horizontal" data-testid="slides-panel-splitter"
            title={language === 'zh-CN' ? '上下拖动调整预览与元件清单的高度 · 双击复原'
              : language === 'en' ? 'Drag to resize preview and component list · double-click to reset'
              : '上下拖動調整預覽與元件清單的高度 · 雙擊復原'}
            onPointerDown={startPanelDrag} onDoubleClick={resetPanelH}
            className={`shrink-0 h-2 -my-[3px] relative z-10 flex items-center justify-center cursor-row-resize group touch-none select-none`}>
            <div className="w-10 h-1 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors" />
          </div>
        )}
        <div className={`flex-1 min-h-0 overflow-y-auto ${slideId && htmlContent && idLoad !== 'loading' && idLoad !== 'failed' ? editorShell.softSurface : ''}`} data-testid="slides-panel-slot">
        <div ref={setPanelNatEl}>

        {slideId && htmlContent && idLoad !== 'loading' && idLoad !== 'failed' && compMode && curCtx && curPage && deckTheme && displayDeck && (
          <PageSettingsPanel
            key={`ps:${slideId}:${curPage.pid ?? currentSlide}`}
            pageIndex={currentSlide} pageId={curPage.pid}
            background={curPage.background} transition={curPage.transition}
            ctx={curCtx} theme={deckTheme}
            onOp={onCompOp}
            uploadMedia={uploadMediaFiles}
            onMediaShown={(url, display) => { if (display) setSignedSrc(prev => ({ ...prev, [url]: display })) }}
            mediaUrl={canvasMediaUrl}
            prev={currentSlide > 0 && displayDeck.pages[currentSlide - 1] ? {
              components: pageComponents(displayDeck.pages[currentSlide - 1], currentSlide - 1, deckLang),
              animations: displayDeck.pages[currentSlide - 1].animations,
              background: displayDeck.pages[currentSlide - 1].background,
              pageType: displayDeck.pages[currentSlide - 1].draft.type,
            } : null}
            cur={{ components: curComps, animations: curPage.animations, background: curPage.background, pageType: curPage.draft.type }}
            busy={deckEditBusy}
          />
        )}
        {slideId && htmlContent && idLoad !== 'loading' && idLoad !== 'failed' && compMode && curCtx && curPage && (
          <ComponentListPanel
            key={`${slideId}:${curPage.pid ?? currentSlide}`}
            components={curComps}
            pageIndex={currentSlide}
            pageId={curPage.pid}
            ctx={curCtx}
            isContentsPage={curPage.draft.type === 'contents'}
            materialized={Array.isArray(curPage.components)}
            selectedId={selectedCompId}
            selectedIds={selectedCompIds}
            expandedId={selectedCompIds.length > 1 ? null : expandedCompId}
            onSelect={setSelectedCompId}
            onToggle={(id) => { setExpandedCompId(null); setSelectedCompIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids.filter((x) => !curComps.find((c) => c.id === x)?.locked), id])) }}
            onGroupFrame={onGroupFrame}
            onExpand={setExpandedCompId}
            onOp={onCompOp}
            onPreview={setTypingOp}
            uploadMedia={uploadMediaFiles}
            onMediaShown={(url, display) => { if (display) setSignedSrc(prev => ({ ...prev, [url]: display })) }}
            busy={deckEditBusy}
            syncEpoch={liveSyncEpoch}
            onGroup={() => groupComps(selectedCompIds)}
            onUngroup={ungroupComp}
          />
        )}
        {slideId && htmlContent && idLoad === 'ok' && !isV2 && (
          <div className={`flex items-center gap-2 px-4 py-2 border-t ${editorShell.divider} text-[12px]`} data-testid="slc-legacy-bar">
            <span className={editorShell.hintText}>{t('slc_legacy_hint')}</span>
            <button type="button" disabled={saveAsBusy} data-testid="slc-save-as"
              className="ml-auto px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 keep-white text-[12px] disabled:opacity-50"
              onClick={() => { void saveAsComponents() }}>{saveAsBusy ? t('slc_save_as_busy') : t('slc_save_as')}</button>
          </div>
        )}
        {slideId && htmlContent && idLoad !== 'loading' && idLoad !== 'failed' && deckBroken && (
          <DeckSlotPanel
            key={`${panelIdentity.key}:${panelResetKey}`}
            deck={deckData}
            broken={deckBroken}
            pageIndex={currentSlide}
            busy={deckEditBusy}
            onEditSlots={(pageIndex, slots, pageId) => {
              const borrowed = panelIdRef.current?.pid && panelIdRef.current.pid !== pageId ? panelIdRef.current : null
              return patchDeck({
                kind: 'edit_slots',
                pageIndex: borrowed ? borrowed.index : pageIndex,
                pageId: borrowed?.pid ?? pageId ?? undefined,
                slots,
              })
            }}
            onAddPage={(afterIndex, pageType, afterPageId) => { void patchDeck({ kind: 'add_page', afterIndex, pageType, afterPageId }) }}
            onDeletePage={(pageIndex, pageId) => updateDeleteConfirm({ pageIndex, pageId, docId: loadedIdRef.current, deckAtOpen: deckDataRef.current, epochAtOpen: deckConflictGuardRef.current.epochNow() })}
          />
        )}
        </div>
        </div>
        </div>
        </div>
        {host.renderShield(aiShield, 'slides-ai-shield')}
      </div>

      {rightCollapsed && (
        <PanelCollapsedEdge side="right" onExpand={() => setRightCollapsed(false)} title={host.chatSlotLabel ?? t('side_chat_pick_role')} testId="slides-right-collapsed" />
      )}
      {!rightCollapsed && (<>
      <div className={editorShell.resizeHandle}
        onMouseDown={e => { e.preventDefault(); resizingRef.current = 'right'; lastXRef.current = e.clientX; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; if (iframeRef.current) iframeRef.current.style.pointerEvents = 'none' }}>
        <div className={editorShell.resizeHandleLine} />
        <div className={editorShell.resizeHandleGrip} />
      </div>

      <div ref={rightPanelRef} className={`shrink-0 select-text ${editorShell.colBorderL}`} style={{ width: rightWidth }} data-testid="slides-side-chat">
        {!slideId ? (
          <div className="flex h-full flex-col text-gray-800" style={editorShell.chatSurface} data-testid="slides-side-chat-pending">
            <div className="px-3 py-2 border-b border-[#E7E0D2] shrink-0 flex items-center gap-1.5 min-w-0">
              <PanelCollapseButton side="right" onCollapse={() => setRightCollapsed(true)} title={t('scribe_collapse')} testId="slides-right-collapse" />
              <span className="text-sm font-semibold text-[#4A3528] truncate">{host.chatSlotLabel ?? t('side_chat_pick_role')}</span>
            </div>
            <LoadingPlaceholder label={t('ld_placeholder_loading')} failed={blankState === 'failed' || idLoad === 'failed'} failedLabel={blankState === 'failed' ? t('asld_blank_failed') : t('asld_load_failed')} testId="slides-side-chat-pending-state" />
          </div>
        ) : (
        host.renderChatSlot({
          titleIcon: <PanelCollapseButton side="right" onCollapse={() => setRightCollapsed(true)} title={t('scribe_collapse')} testId="slides-right-collapse" />,
          slides: { docId: slideId, docTitle: title, editorAgentKey, onEditorAgentKeyChange: changeEditorAgent, slidesFormat: isV2 ? 'components' : 'legacy', roster: roleBusyOn ? roleRoster : undefined },
          title: host.chatSlotLabel ?? t('side_chat_pick_role'),
        })
        )}
      </div>
      </>)}

      </div>

      {contextMenu && compMode && (() => {
        const i = contextMenu.index
        const pid = deckDataRef.current?.pages[i]?.pid
        const addPage = (pageKind: 'blank' | 'content' | 'transition' | 'duplicate') => {
          setContextMenu(null)
          onCompOp({ kind: 'page_add', afterIndex: i, ...(pid ? { afterPageId: pid } : {}), pageKind, ...(pageKind === 'duplicate' ? { sourceIndex: i, ...(pid ? { sourcePageId: pid } : {}) } : {}) })
        }
        return (
          <div className={`fixed z-50 ${editorShell.menu} w-44`} data-testid="slc-page-menu"
            style={{ left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 190), top: contextMenu.y }}
            onClick={e => e.stopPropagation()}>
            <button className={editorShell.menuItem} data-testid="slc-page-add-blank" disabled={deckEditBusy} onClick={() => addPage('blank')}>{t('slc_page_add_blank')}</button>
            <button className={editorShell.menuItem} data-testid="slc-page-add-content" disabled={deckEditBusy} onClick={() => addPage('content')}>{t('slc_page_add_content')}</button>
            <button className={editorShell.menuItem} data-testid="slc-page-add-transition" disabled={deckEditBusy} onClick={() => addPage('transition')}>{t('slc_page_add_transition')}</button>
            <button className={editorShell.menuItem} data-testid="slc-page-duplicate" disabled={deckEditBusy} onClick={() => addPage('duplicate')}>{t('slc_page_duplicate')}</button>
            <button className={editorShell.menuItem} data-testid="slc-page-relayout" disabled={deckEditBusy} onClick={() => { setContextMenu(null); setRelayoutFor(i) }}>{t('slc_page_relayout')}</button>
            <div className={`my-1 border-t ${editorShell.divider}`} />
            <button onClick={() => { updateDeleteConfirm({ pageIndex: i, pageId: pid, docId: loadedIdRef.current, deckAtOpen: deckDataRef.current, epochAtOpen: deckConflictGuardRef.current.epochNow() }); setContextMenu(null) }}
              disabled={slides.length <= 1 || deckEditBusy} data-testid="slc-page-delete"
              className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              {t('asld_delete_page')}
            </button>
          </div>
        )
      })()}
      {contextMenu && !compMode && (
        <div
          className={`fixed z-50 ${editorShell.menu} w-44`}
          style={{ left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 190), top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { addSlide(contextMenu.index - 1); setContextMenu(null) }}
            className={editorShell.menuItem}>
            {t('asld_insert_above')}
          </button>
          <button onClick={() => { addSlide(contextMenu.index); setContextMenu(null) }}
            className={editorShell.menuItem}>
            {t('asld_insert_below')}
          </button>
          <div className={`my-1 border-t ${editorShell.divider}`} />
          <button onClick={() => { copySlide(contextMenu.index); setContextMenu(null) }}
            className={editorShell.menuItem}>
            {t('asld_copy')}
          </button>
          <button onClick={() => { cutSlide(contextMenu.index); setContextMenu(null) }}
            className={editorShell.menuItem}>
            {t('asld_cut')}
          </button>
          <button onClick={() => { pasteSlide(contextMenu.index); setContextMenu(null) }}
            disabled={!clipboard}
            className={`${editorShell.menuItem} disabled:opacity-30 disabled:cursor-not-allowed`}>
            {clipboard?.action === 'cut' ? t('asld_paste_move') : clipboard ? t('asld_paste_copy') : t('asld_paste')}
          </button>
          <div className={`my-1 border-t ${editorShell.divider}`} />
          <button onClick={() => { updateDeleteConfirm({ pageIndex: contextMenu.index, pageId: deckDataRef.current?.pages[contextMenu.index]?.pid, docId: loadedIdRef.current, deckAtOpen: deckDataRef.current, epochAtOpen: deckConflictGuardRef.current.epochNow() }); setContextMenu(null) }}
            disabled={slides.length <= 1}
            className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            {t('asld_delete_page')}
          </button>
        </div>
      )}

      {animCompId && compMode && deckTheme && curPage && (() => {
        const c = curComps.find(x => x.id === animCompId)
        if (!c) return null
        return (
          <AnimationDialog
            component={c} components={curComps} animations={curPage.animations ?? []}
            theme={deckTheme} pageType={curPage.draft.type} nameOf={compNameOf} mediaUrl={canvasMediaUrl}
            onApply={(set) => onCompOp({ kind: 'animation_set', componentId: c.id, ...set })}
            onReorder={(order) => onCompOp({ kind: 'animation_order', pageIndex: currentSlide, ...(curPage.pid ? { pageId: curPage.pid } : {}), order })}
            onClose={() => setAnimCompId(null)}
          />
        )
      })()}

      {relayoutFor !== null && compMode && deckTheme && deckData && deckData.pages[relayoutFor] && (
        <LayoutPickerDialog
          deck={deckData} pageIndex={relayoutFor} theme={deckTheme} mediaUrl={canvasMediaUrl}
          onPick={(layoutId) => {
            const i = relayoutFor
            const pid = deckDataRef.current?.pages[i]?.pid
            setRelayoutFor(null)
            onCompOp({ kind: 'page_set_layout', pageIndex: i, ...(pid ? { pageId: pid } : {}), layoutId })
          }}
          onClose={() => setRelayoutFor(null)}
        />
      )}

      {deleteConfirm !== null && (() => {
        const delView = resolveDeleteTarget(deleteConfirm, deleteConfirm.deckAtOpen, deckData)
        return (
        <div className={`fixed inset-0 z-50 flex items-center justify-center ${editorShell.modalMaskColor}`} onClick={() => updateDeleteConfirm(null)}>
          <div className={`${editorShell.modalCard} p-5 w-72`} onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white mb-2">{t('asld_delete_slide_title')}</div>
            <div className="text-[12px] text-gray-400 mb-5 leading-relaxed">
              {t('asld_delete_confirm_pre')}{delView.pageIndex + 1}{t('asld_delete_confirm_mid')}「{slides[delView.pageIndex]?.title}」{t('asld_delete_confirm_suf')}<br />{t('asld_delete_irreversible')}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => updateDeleteConfirm(null)}
                className={`${editorShell.toolbarTextBtn} rounded-lg`}>
                {t('asld_cancel')}
              </button>
              <button onClick={() => {
                const urlDocNow = host.urlDocId()
                const decision = resolveConfirmedDelete(deleteConfirm, deckConflictGuardRef.current, loadedIdRef.current, deckDataRef.current, urlDocNow)
                if (decision.kind === 'cancel_stale') {
                  updateDeleteConfirm(null)
                  saveCtl().preemptSettle('delete_confirm_stale')
                  return
                }
                if (deckData) {
                  void patchDeck({ kind: 'delete_page', ...decision.target })
                }
                else if (!deckBroken) deleteSlide(deleteConfirm.pageIndex)
                updateDeleteConfirm(null)
              }}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-red-600 hover:bg-red-500 keep-white transition-colors font-medium">
                {t('asld_confirm_delete')}
              </button>
            </div>
          </div>
        </div>
        )
      })()}
      <TemplatePickerModal kind="slides" open={showTemplates} onClose={() => setShowTemplates(false)} onApply={applyTemplate} hasExisting={false} beforeApply={confirmTemplateApply} mine={userTemplateOps} filter={host.has('deckTemplates') ? undefined : withoutDeckTemplates} />

      {showVersions && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center ${editorShell.modalMaskColor}`} onClick={() => setShowVersions(false)}>
          <div className={`${editorShell.modalCard} w-96 max-h-[70vh] flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${editorShell.divider}`}>
              <div className="text-sm font-semibold text-white">{t('asld_version_history')}</div>
              <button onClick={() => setShowVersions(false)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {versionsLoading
                ? <div className="text-center text-[12px] text-gray-500 py-8">{t('asld_loading')}</div>
                : versions.length === 0
                  ? <div className="text-center text-[12px] text-gray-600 py-8">{t('asld_no_versions')}<br/><span className="text-gray-700">{t('asld_auto_version_hint')}</span></div>
                  : versions.map(v => (
                    <div key={v.id} className={`flex items-start gap-3 px-3 py-2.5 rounded-xl ${editorShell.softSurface} ${editorShell.softSurfaceHover} transition-colors`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-gray-400 mb-0.5">
                          {new Date(v.created_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-[12px] text-gray-200 truncate">{v.trigger_msg || v.title}</div>
                      </div>
                      <button
                        onClick={() => restoreVersion(v.id)}
                        disabled={restoringId !== null}
                        className="shrink-0 text-[11px] px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 keep-white transition-colors font-medium">
                        {restoringId === v.id ? '...' : t('asld_restore')}
                      </button>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {host.has('share') && showShareModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20"
          onClick={() => { setShowShareModal(false); setVisDropdownOpen(false) }}>
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5 text-gray-900"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold">{t('asld_share_modal_title')}</span>
              <button onClick={() => { setShowShareModal(false); setVisDropdownOpen(false) }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            <div className="text-xs text-gray-500 mb-2">{t('asld_link_share')}</div>
            <div className="relative">
              <button onClick={() => setVisDropdownOpen(v => !v)}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
                <span className="text-base">{visibility === 'private' ? '🔒' : '🔗'}</span>
                <span className="flex-1 text-left text-sm font-medium">
                  {slidesVisLabel(visibility)}
                </span>
                <span className="text-gray-400 text-[11px]">▾</span>
              </button>
              <div className="text-[11px] text-gray-400 mt-1 ml-1">
                {visibility === 'public' ? t('asld_vis_public_desc') : visibility === 'unlisted' ? t('drive_share_unlisted_desc') : t('asld_vis_private_desc')}
              </div>

              {visDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-[11px] text-gray-400 font-medium">{t('asld_share_scope')}</div>
                    {host.shareOptions().map(v => (
                      <button key={v}
                        onClick={() => updateVisibility(v)}
                        className={`flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${visibility === v ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                        <span>{slidesVisLabel(v)}</span>
                        {visibility === v && <span className="text-blue-600">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={copyShareLink}
                disabled={!slideId || visibility === 'private'}
                title={visibility === 'private' ? t('asld_enable_share_first') : ''}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-gray-700 transition-colors font-medium">
                🔗 {copyDone ? t('asld_copied') : t('asld_copy_link')}
              </button>
              <button
                onClick={() => { if (slideId) window.open(host.shareUrl(slideId), '_blank') }}
                disabled={!slideId}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm text-gray-700 transition-colors font-medium">
                ↗ {t('asld_open_link')}
              </button>
            </div>
          </div>
        </div>
      )}

      {idLoad === 'loading' && (
        <div className={`absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 ${editorShell.maskColor} select-none`}>
          <EditorLoadingArt kind="slides" />
          <div className="text-sm font-medium text-gray-600">{t('asld_loading')}</div>
        </div>
      )}
      {idLoad === 'failed' && (
        <div className={`absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 ${editorShell.centerCol} select-none`}>
          <div className="text-4xl">⚠️</div>
          <div className="text-sm text-gray-500">{t('asld_load_failed')}</div>
          <button
            onClick={() => { const id = searchParams.get('id'); if (id) void loadById(id) }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 keep-white text-sm transition-colors"
          >{t('asld_retry')}</button>
        </div>
      )}
      <SlidesPlayer ref={playerRef} html={playHtml} count={slides.length} closeLabel={t('asld_play_exit')} onExit={onPlayExit} />
    </div>
  )
}
