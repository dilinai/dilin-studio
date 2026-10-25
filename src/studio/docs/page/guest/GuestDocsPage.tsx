'use client'
// 游客版文件编辑器：渲染跟登入版同一份整页（../DocsPage.tsx），宿主换成这台电脑上的工程（ProjectStore：project.json＋assets/）。
//   要后端的（分享、上架、云盘档案卡、配图生成、回滚历史、角色对话、服务端 PDF／Word、汇入 Word）has() 回 false，页面就不画。
//   左栏「硬碟」那格＝工程清单＋存放位置、右栏对话那格＝复制给 AI——两格由外框给的底座宿主（props.host）画。
//   存档：页面的存档队列照旧一发一发送 putDoc，这里把它写进 project.json（自动存走安全写：外面改过就不写、交外框问）。

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GuestPageProps, StudioPageHost } from '../../../shared/page-host'
import { useStudioT } from '../../../shared/StudioT'
import { studioHref } from '../../../shared/host'
import type { StudioT } from '../../../shared/types'
import { ownAssetName, srcFromAssetName } from '../../format'
import DocsPage from '../DocsPage'
import type { DocsLoadFail, DocsPageHost } from '../host'
import { videoCardNode } from '../media/video/video-node'
import { audioCardNode } from '../media/audio/audio-node'
import { AssetProvider, createAssetResolver } from './assets'
import { createAssetJanitor } from './asset-janitor'
import { withAssetSrc } from './asset-src'
import { assetSrcBack } from './html'
import { GUEST_DOCS_MEDIA } from './media'
import { downloadBlob, guestDocxBlob } from './export-docx'
import { createGuestDocIO } from './doc-io'

const FONT_SCALE_KEY = 'dilin-studio-docs-font-scale'

function safeBase(name: string, fallback: string): string {
  const b = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 120)
  return b || fallback
}

/** 外框还没给底座宿主时（旧外框）两格先放占位。 */
const PLACEHOLDER_BASE: StudioPageHost = {
  kind: 'guest',
  renderHomeBrand: () => <a href={studioHref.root()} className="text-sm font-semibold text-[#4A3528] shrink-0" data-testid="scribe-home">Dilin Studio</a>,
  renderDriveSlot: () => <div className="flex-1 p-3 text-xs text-gray-400" data-testid="docs-drive-slot-placeholder">…</div>,
  renderChatSlot: () => <div className="flex-1 p-3 text-xs text-gray-400" data-testid="docs-chat-slot-placeholder">…</div>,
  has: () => false,
}

function GuestLoadFail({ t }: { t: StudioT }) {
  return (
    <div className="h-screen flex items-center justify-center p-6" data-testid="docs-load-error">
      <div className="max-w-md text-center">
        <p className="text-base font-semibold text-gray-800">{t('scribe_load_failed')}</p>
        <p className="mt-2 text-sm text-gray-500">{t('scribe_load_failed_desc')}</p>
      </div>
    </div>
  )
}

export default function GuestDocsPage(props: GuestPageProps) {
  const { store, projectId, onDirtyChange, onSaveStateChange, registerFlush } = props
  const base = props.host ?? PLACEHOLDER_BASE
  const t = useStudioT()
  const tRef = useRef(t)
  tRef.current = t

  const resolver = useMemo(() => createAssetResolver(store), [store])
  useEffect(() => () => resolver.dispose(), [resolver])
  const janitor = useMemo(() => createAssetJanitor(store, resolver), [store, resolver])

  const cbRef = useRef({ onDirtyChange, onSaveStateChange, registerFlush })
  cbRef.current = { onDirtyChange, onSaveStateChange, registerFlush }
  const dirtyRef = useRef(false)
  const setDirty = useCallback((d: boolean) => {
    if (dirtyRef.current === d) return
    dirtyRef.current = d
    cbRef.current.onDirtyChange(d)
  }, [])

  // 读写 project.json（页面一发一发送部分栏位·这里合进记忆体那份、整份写回）
  const io = useMemo(() => createGuestDocIO({ store, janitor, onSaveState: (st, detail) => cbRef.current.onSaveStateChange?.(st, detail) }), [store, janitor])

  // 外框的底座宿主经 ref 读：它换一份（例如改名后、换语言）时本页的宿主不跟着换——整页读工程的 effect 看宿主，换了会重读、盖掉手上的改动
  const baseRef = useRef(base)
  baseRef.current = base

  const host = useMemo<DocsPageHost>(() => ({
    kind: 'guest',
    renderHomeBrand: (o) => baseRef.current.renderHomeBrand(o),
    get chatSlotLabel() { return baseRef.current.chatSlotLabel },
    get driveSlotLabel() { return baseRef.current.driveSlotLabel },
    renderDriveSlot: (o) => baseRef.current.renderDriveSlot(o),
    // 右栏那格＝复制给 AI：页头用它自己的标题（登入版那句「選擇角色」是角色对话的）·收合钮照登入版放在标题左边
    renderChatSlot: (o) => baseRef.current.renderChatSlot({ ...o, title: undefined }),
    // 文件页那几个功能键都要后端（见 ../host.ts 开头）⇒ 游客版都没有；底座功能表（appDef.guestFeatures）没列的一律 false
    has: (k) => baseRef.current.has(k),

    navigate: (href) => { window.location.href = href },
    openDoc: () => {},
    getUser: async () => ({ email: null }),
    loginRedirect: () => {},
    loadFailOf: (): DocsLoadFail => 'error',

    getDoc: () => io.getDoc(),
    putDoc: (_id, body) => io.putDoc(body),

    loadEditorFontScale: async () => {
      try { const v = Number(localStorage.getItem(FONT_SCALE_KEY)); return Number.isFinite(v) && v > 0 ? v : null } catch { return null }
    },
    saveEditorFontScale: (s) => { try { localStorage.setItem(FONT_SCALE_KEY, String(s)) } catch { /* 存不了就算了 */ } },
    saveDocPaperPref: async () => {},

    media: GUEST_DOCS_MEDIA,
    videoNode: withAssetSrc(videoCardNode, 'video'),
    audioNode: withAssetSrc(audioCardNode, 'audio'),
    wrapMediaNode: (ext, tag) => withAssetSrc(ext, tag),
    saveHtml: assetSrcBack,
    uploadMedia: (file, onProgress) => {
      let aborted = false
      const done = (async () => {
        try {
          onProgress(10)
          const name = await ownAssetName(file, file.name || '')
          janitor.hold(name)
          let taken = false
          try { taken = (await store.listAssets()).some(a => a.name === name) } catch { taken = false }
          // 同名＝同内容（档名是内容杂凑）⇒ 已有就直接用
          if (!taken) { await store.writeAsset(name, file); resolver.forget(name) }
          if (aborted) { janitor.release(name); return null }
          onProgress(95)
          return { url: srcFromAssetName(name), isVideo: file.type.startsWith('video/'), isAudio: file.type.startsWith('audio/') }
        } catch {
          return null
        }
      })()
      return { done, abort: () => { aborted = true } }
    },
    transcodeStatus: async () => ({ status: 'error', transcodedUrl: null }),
    exceedsUploadLimit: () => false,

    exportDocAsWord: async (o) => {
      const blob = await guestDocxBlob({ md: o.content, paper: o.paper, resolver, t: tRef.current })
      downloadBlob(blob, `${safeBase(o.title, tRef.current('bf_docexport_file'))}.docx`)
    },
    exportDocAsMarkdown: (o) => {
      downloadBlob(new Blob([o.content], { type: 'text/markdown;charset=utf-8' }), `${safeBase(o.title, tRef.current('bf_docexport_file'))}.md`)
    },
    printPage: (win) => win.print(),

    useMeRoles: () => ({ isSeller: false }),
    useEditorRoleBusy: () => ({ busy: false, roster: undefined }),
    useEditorAIShield: () => GUEST_SHIELD,

    renderLoadFail: () => <GuestLoadFail t={tRef.current} />,

    onEdited: () => { setDirty(true); cbRef.current.onSaveStateChange?.('dirty') },
    onSaved: () => { setDirty(false); cbRef.current.onSaveStateChange?.('saved') },
    onSaveStatus: (s) => { if (s === 'saving') cbRef.current.onSaveStateChange?.('saving') },
    registerFlush: (fn) => {
      cbRef.current.registerFlush?.(fn ? () => io.withForce(fn) : null)
    },
  }), [io, store, janitor, resolver, setDirty])

  useEffect(() => { cbRef.current.onSaveStateChange?.('saved') }, [])

  return (
    <AssetProvider resolver={resolver}>
      <DocsPage host={host} docId={projectId} />
    </AssetProvider>
  )
}

const GUEST_SHIELD = { locked: false, by: '', ingest: () => {}, kick: () => {} }

/** 旧外框（StudioShell＋Editor）也能开：没有底座宿主 ⇒ 两格占位。 */
export function GuestDocsEditor(props: Omit<GuestPageProps, 'host'> & { host?: StudioPageHost; children?: ReactNode }) {
  return <GuestDocsPage {...props} host={props.host ?? PLACEHOLDER_BASE} />
}
