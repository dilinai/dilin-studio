'use client'
// 游客版剪辑（/studio/video/<编号>）的宿主：同一份整页（VideoEditPage），资料全在这台电脑——
//   工程＝工程资料夹（或这个浏览器的 OPFS）里的 project.json＋assets/（格式见 ../FORMAT.md·读写走 ../format.ts）；
//   素材原档写进 assets/·剪辑用小预览档与波形是这个浏览器的快取；收藏记在这个浏览器。
//   要网站后端的（云盘、上传、角色对话、终端、朗读、别台导出、历史版本、最近草稿）一律不给 ⇒ 页面不画那几颗钮。
//   Alt+A 加進對話：没有角色对话 ⇒ 小卡插进右栏底下那个输入框（../../shared/ui/InlineCardBox·记号与画法同登入版），一鍵複製后贴给自己的 AI。
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GuestPageProps, StudioPageHost } from '../../shared/page-host'
import type { EditorProps, ProjectStore } from '../../shared/types'
import { StudioTProvider, useStudioLang, useStudioT } from '../../shared/StudioT'
import { createInlineBox, type InlineBox } from '../../shared/inline-box'
import { saveProjectSafe } from '../../shared/store'
import { writeProjectName } from '../../shared/project-file'
import { updateProject } from '../../shared/projects'
import { studioHref } from '../../shared/host'
import { errorText } from '../../shared/ui/common'
import { VIDEO_FORMAT_VERSION, assetNameFor, emptyVideoDoc, loadVideoDoc, saveVideoDoc, type VideoDoc, type VideoMedia } from '../format'
import { assetSig, cacheKeyOf } from '../export-project'
import { dropText } from '../drop-text'
import { forgetStored } from '../lib/opfs-cache'
import { VEDIT_PROJECT_VERSION, projectTitle, type VeditProject } from '../lib/project.pure'
import { buildMarkerToken, buildMediaToken, buildTransToken, clipCountLabel, clipsTokenOf, type RefLang } from '../lib/chat-token.pure'
import { makeVideoCardNode } from '../lib/chat-card-dom'
import VeditSettingsDialog from '../ui/SettingsDialog'
import VideoEditPage from './VideoEditPage'
import { guestWords } from './guest-words'
import { VEDIT_FEATURES, type AiShieldHandle, type ProjGet, type VideoChatHost, type VideoPageHost } from './host'

/** 游客版功能表（StudioApp.guestFeatures）：第三方授權小窗；云盘那几颗（上传、最近草稿、历史版本、眼睛钮）要后端 ⇒ 不列＝没有 */
export const VIDEO_GUEST_FEATURES: Readonly<Record<string, boolean>> = { [VEDIT_FEATURES.licenses]: true }
const NO_SHIELD: AiShieldHandle = { locked: false }
const FAVS_KEY = 'dilin.studio.video.favs.v1'


/** 这份工程的素材档名、快取键与「存好才删」的旧档（跨页面渲染留着） */
type GuestState = {
  name: string
  /** 素材编号 ⇒ assets/ 里的档名 */ files: Map<string, string>
  /** 素材编号 ⇒ 原档大小＋修改时间（快取键用：外面换了档内容 ⇒ 键跟着变） */ sigs: Map<string, string>
  /** 还在写进 assets/ 的（存 project.json 前等它们写好） */ writing: Map<string, Promise<boolean>>
  /** 拿掉的素材档：下一次 project.json 存好（不再指到它）才删 */ trash: Set<string>
  /** 最后读进来／存进去的那份（改名时 project.json 还不在就照它写） */ last: VideoDoc
  /** 开不到的原因（给人看的一句） */ openErr: string
}

/** 右栏输入框的小卡画法（同登入版那几颗·游客版点卡没有弹窗 ⇒ 提示字不加「點一下打開」） */
export function makeGuestVideoBox(lang: () => RefLang): InlineBox {
  return createInlineBox((doc, raw) => makeVideoCardNode(doc, raw, { countLabel: (n) => clipCountLabel(n, lang()), openTitle: '' }))
}
/** Alt+A 加進對話（游客版）：记号同登入版那几支·插进右栏输入框（还没挂上 ⇒ 排着）；没有角色可选 ⇒ adopt 不做事 */
export function makeGuestVideoChat(box: InlineBox, lang: () => RefLang): VideoChatHost {
  return {
    clipsToken: (tr, ids, nameOf) => clipsTokenOf(tr, ids, nameOf, lang()),
    transToken: (start, tr, length) => buildTransToken(start, tr, length, lang()),
    markerToken: (at) => buildMarkerToken(at, lang()),
    mediaToken: (m) => buildMediaToken(m, lang()),
    insert: (token) => box.insert(token),
    adopt: () => {},
  }
}

function docToProject(doc: VideoDoc): VeditProject {
  return { v: VEDIT_PROJECT_VERSION, ratio: doc.ratio, tracks: doc.tracks, programs: doc.programs, media: doc.media.map(({ file: _f, ...m }) => { void _f; return { ...m, from: 'local' as const } }), ...(doc.comps ? { comps: doc.comps } : {}) }
}

export function makeVideoGuestHost(o: { base: StudioPageHost; store: ProjectStore; projectId: string; props: Pick<EditorProps, 'onDirtyChange' | 'onSaveStateChange' | 'registerFlush'>; t: (k: string, v?: Record<string, string | number>) => string; st: GuestState; outside?: Set<() => void>; chat?: VideoChatHost | null }): VideoPageHost {
  const { base, store, projectId, props, t, st, outside } = o
  const appName = t('studio_app_video')
  const keyOf = (id: string) => cacheKeyOf(id, st.sigs.get(id) ?? '', projectId)
  const openDoc = async (): Promise<{ ok: true; d: ProjGet } | { ok: false; fail: 'failed' }> => {
    try {
      const doc = await loadVideoDoc(store)
      const infos = await store.listAssets().catch(() => [])
      const info = new Map(infos.map((a) => [a.name, a]))
      st.files.clear(); st.sigs.clear()
      for (const m of doc.media) { st.files.set(m.id, m.file); const a = info.get(m.file); if (a) st.sigs.set(m.id, assetSig(a)) }
      st.name = doc.name
      st.last = doc
      const missing = doc.media.filter((m) => !info.has(m.file)).length
      const note = [
        ...(doc.drops.length ? [t('vedit_guest_load_drops', { n: doc.drops.length, first: dropText(t, doc.drops[0]) })] : []),
        ...(missing ? [t('vedit_guest_missing_assets', { n: missing })] : []),
      ].join(' ')
      const at = await store.lastModified().catch(() => null)
      return { ok: true, d: { id: projectId, title: doc.name, folder_id: null, updated_at: String(at ?? 0), project: docToProject(doc), media_urls: {}, ...(note ? { note } : {}) } }
    } catch (e) {
      st.openErr = errorText(t, e, appName, 'video', VIDEO_FORMAT_VERSION)
      return { ok: false, fail: 'failed' }
    }
  }
  const docOf = (p: VeditProject): VideoDoc => ({
    name: st.name, ratio: p.ratio, tracks: p.tracks, programs: p.programs, ...(p.comps ? { comps: p.comps } : {}), drops: [],
    media: p.media.flatMap((m): VideoMedia[] => {
      const file = st.files.get(m.id)
      if (!file) return []
      const { from: _f, driveId: _d, cloudProxy: _c, ...rest } = m
      void _f; void _d; void _c
      return [{ ...rest, file }]
    }),
  })
  return {
    ...base,
    kind: 'guest',
    homeHref: studioHref.root(),
    renderDriveEye: null,
    overlayOpen: () => false,
    checkGate: () => Promise.resolve(true),
    renderGateClosed: () => null,
    renderLoadFail: () => (
      <div className="h-screen bg-neutral-900 text-neutral-300 flex flex-col items-center justify-center gap-4 px-6 text-center" data-testid="vedit-guest-open-fail">
        <p className="text-sm text-amber-300 max-w-lg break-words">{st.openErr}</p>
        <a href={studioHref.app('video')} className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm">{t('vedit_back_home')}</a>
      </div>
    ),
    project: {
      urlId: () => projectId,
      validId: () => true,
      open: () => openDoc(),
      get: async () => { const r = await openDoc(); return r.ok ? { status: 200, d: r.d } : { status: 500 } },
      head: null,
      save: async (_id, body, force) => {
        props.onSaveStateChange?.('saving')
        // 素材还在写进 assets/ ⇒ 等写好（⛔ 存出指向不存在档的素材）
        await Promise.all([...st.writing.values()])
        const doc = docOf(body.project)
        try {
          const r = await saveProjectSafe(store, (s) => saveVideoDoc(s, doc), { force })
          if (!r.written) { props.onSaveStateChange?.('dirty'); return { status: 412, j: {} } }
        } catch (e) {
          props.onSaveStateChange?.('error', errorText(t, e, appName, 'video', VIDEO_FORMAT_VERSION))
          throw e
        }
        st.last = doc
        // project.json 不再指到的旧素材档这时才删
        const still = new Set(doc.media.map((m) => m.file))
        for (const f of [...st.trash]) { st.trash.delete(f); if (!still.has(f)) await store.deleteAsset(f).catch(() => {}) }
        props.onSaveStateChange?.('saved')
        props.onDirtyChange(false)
        const at = await store.lastModified().catch(() => null)
        return { status: 200, j: { updated_at: String(at ?? Date.now()) } }
      },
      create: null,
      rename: async (_id, fileName) => {
        const n = projectTitle(fileName).trim().slice(0, 120)
        if (!n) return { ok: false, status: 400, j: {} }
        await Promise.all([...st.writing.values()])
        const r = await writeProjectName(store, n)
        if (!r.written && r.reason === 'changed-outside') return { ok: false, status: 412, j: {} }
        st.name = n
        st.last = { ...st.last, name: n }
        if (!r.written && r.reason === 'no-project') await saveVideoDoc(store, st.last)
        await updateProject(projectId, { name: n }).catch(() => null)
        return { ok: true, status: 200, j: { name: fileName } }
      },
      setUrlId: () => {},
      openOther: (id) => { window.location.assign(studioHref.project('video', id)) },
      dirty: (d) => { props.onDirtyChange(d); if (d) props.onSaveStateChange?.('dirty') },
      registerFlush: (f) => props.registerFlush?.(f),
      ...(outside ? { onOutsideChange: (f: () => void) => { outside.add(f); return () => { outside.delete(f) } } } : {}),
    },
    media: {
      keyOf: (m) => keyOf(m.id),
      storeOriginal: (m, blob) => {
        const had = st.files.get(m.id)
        const file = had ?? assetNameFor(m.name, new Set(st.files.values()))
        st.files.set(m.id, file)
        if (!had) st.sigs.set(m.id, assetSig({ size: blob.size, lastModified: blob instanceof File ? blob.lastModified : Date.now() }))
        const p = (async () => {
          try {
            await store.writeAsset(file, blob)
            const a = (await store.listAssets().catch(() => [])).find((x) => x.name === file)
            if (a) st.sigs.set(m.id, assetSig(a)) // 快取键改按 assets/ 里那份（写进去后修改时间变了）
            return true
          } catch { if (!had) st.files.delete(m.id); return false } finally { st.writing.delete(m.id) }
        })()
        st.writing.set(m.id, p)
        return p
      },
      readOriginal: async (m) => {
        await st.writing.get(m.id)
        const file = st.files.get(m.id)
        return file ? store.readAsset(file).catch(() => null) : null
      },
      forget: (gone, keep) => {
        const keepFiles = new Set(keep.map((m) => st.files.get(m.id)).filter((x): x is string => !!x))
        for (const g of gone) {
          const file = st.files.get(g.id)
          void forgetStored(keyOf(g.id))
          st.files.delete(g.id); st.sigs.delete(g.id)
          if (file && !keepFiles.has(file)) st.trash.add(file)
        }
      },
      rememberList: false,
    },
    drive: null,
    shell: null,
    // 识别字幕／拆曲的模型站：网站设了镜像就用它；没设 ⇒ 网页里识别／拆曲先不开放（缺省模型站要宿主设定给）
    asr: { modelHost: (process.env.NEXT_PUBLIC_VEDIT_ASR_MODEL_HOST || '').trim() ? `${(process.env.NEXT_PUBLIC_VEDIT_ASR_MODEL_HOST || '').trim().replace(/\/?$/, '/')}` : null, npmBase: (process.env.NEXT_PUBLIC_VEDIT_ASR_MODEL_HOST || '').trim() ? `${(process.env.NEXT_PUBLIC_VEDIT_ASR_MODEL_HOST || '').trim().replace(/\/+$/, '')}/npm/` : null },
    favs: {
      load: async (keys) => {
        try { const all = JSON.parse(window.localStorage.getItem(FAVS_KEY) || '{}') as Record<string, unknown>; return Object.fromEntries(keys.map((k) => [k, all[k]])) } catch { return null }
      },
      save: async (key, ids) => {
        const all = (() => { try { return JSON.parse(window.localStorage.getItem(FAVS_KEY) || '{}') as Record<string, unknown> } catch { return {} } })()
        window.localStorage.setItem(FAVS_KEY, JSON.stringify({ ...all, [key]: [...ids] }))
      },
    },
    tts: null,
    webShot: null, // 要网站后端（服务器截图）·游客版没有
    cloudAsr: null,
    chat: o.chat ?? null,
    useAiShield: () => NO_SHIELD,
    renderAiShieldPill: () => null,
    renderAiShield: () => null,
    startRelay: null,
    offload: null,
    exportDrive: () => null,
    renderProjectsDialog: null,
    renderHistoryDialog: null,
    renderSettingsDialog: (s) => <VeditSettingsDialog value={s.value} drive={null} compute={null} onChange={s.onChange} onClose={s.onClose} />,
  }
}

/** 游客版整页（StudioApp.guestPage）：外框给的宿主（工程清单那一格、复制给 AI 那一格、左上角品牌）＋这里的工程读写 */
export default function VideoGuestPage(props: GuestPageProps) {
  const t = useStudioT()
  const st = useRef<GuestState>({ name: '', files: new Map(), sigs: new Map(), writing: new Map(), trash: new Set(), last: emptyVideoDoc(), openErr: '' }).current
  const live = useRef(props)
  live.current = props
  const lang = useStudioLang()
  const langRef = useRef(lang)
  langRef.current = lang
  const box = useMemo(() => makeGuestVideoBox(() => langRef.current), [])
  const chat = useMemo(() => makeGuestVideoChat(box, () => langRef.current), [box])
  // 外框的底座宿主经 ref 读：它换一份（例如改名后）时本页的宿主不跟着重做（整页的 effect 拿宿主当依赖）
  const base = useMemo<StudioPageHost>(() => ({
    kind: 'guest',
    renderHomeBrand: (o) => live.current.host.renderHomeBrand(o),
    renderDriveSlot: (o) => live.current.host.renderDriveSlot(o),
    renderChatSlot: (o) => live.current.host.renderChatSlot({ ...o, inlineBox: box }),
    has: (k) => live.current.host.has(k),
    get driveSlotLabel() { return live.current.host.driveSlotLabel },
    get chatSlotLabel() { return live.current.host.chatSlotLabel },
  }), [box])
  // 外框报外面改了 project.json（手上没未存改动 ⇒ revision 递增、不重挂）⇒ 交给整页读回换上
  const outside = useRef(new Set<() => void>()).current
  const lastRev = useRef(props.revision)
  useEffect(() => {
    if (props.revision === lastRev.current) return
    lastRev.current = props.revision
    for (const f of [...outside]) f()
  }, [props.revision, outside])
  const host = useMemo(() => makeVideoGuestHost({
    base, store: props.store, projectId: props.projectId, t, st, outside, chat,
    props: {
      onDirtyChange: (d) => live.current.onDirtyChange(d),
      onSaveStateChange: (s, d) => live.current.onSaveStateChange?.(s, d),
      registerFlush: (f) => live.current.registerFlush?.(f),
    },
  }), [base, props.store, props.projectId, t, st, outside, chat])
  const tGuest = useMemo(() => guestWords(t), [t])
  return <StudioTProvider t={tGuest} lang={lang}><VideoEditPage host={host} /></StudioTProvider>
}

/** 底座的整页外框还没接上之前：StudioShell 照旧载 Editor ⇒ 这只把同一份整页盖满整个视窗（两格先放占位） */
export function GuestEditorAdapter(props: EditorProps) {
  const t = useStudioT()
  const base = useMemo<StudioPageHost>(() => ({
    kind: 'guest',
    has: (k) => VIDEO_GUEST_FEATURES[k] === true,
    renderHomeBrand: (o) => (
      <a href={studioHref.app('video')} data-testid={o?.testId} className={`text-sm font-semibold ${o?.tone === 'dark' ? 'text-neutral-100' : 'text-[#4A3528]'}`}>Dilin Studio</a>
    ),
    renderDriveSlot: () => <SlotPlaceholder dark text={t('vedit_guest_slot_projects')} />,
    renderChatSlot: () => <SlotPlaceholder text={t('vedit_guest_slot_ai')} />,
  }), [t])
  useEffect(() => { document.documentElement.style.overflow = 'hidden'; return () => { document.documentElement.style.overflow = '' } }, [])
  return (
    <div className="fixed inset-0 z-40" data-testid="vedit-guest-adapter">
      <VideoGuestPage {...props} host={base} />
    </div>
  )
}

function SlotPlaceholder({ text, dark }: { text: string; dark?: boolean }): ReactNode {
  return <div className={`h-full w-full flex items-center justify-center p-4 text-center text-xs leading-relaxed ${dark ? 'text-neutral-500' : 'text-neutral-400'}`} data-testid="vedit-guest-slot-placeholder">{text}</div>
}
