'use client'
// 游客版表格整页：拿外框给的宿主（工程清单、复制给 AI、回 /studio 的品牌）＋本档补的表格资料操作，渲染同一份 SheetPage。
//   资料＝工程的 project.json（./guest-data.ts）；插图写进工程的 assets/、表格里存 assets/<档名>；xlsx 在浏览器本机产（含图）。
//   要后端的挂点给空的：AI 编辑保护遮罩（永远没罩）、角色工作态、Alt+A 插进对话框（这里的对话格是「复制给 AI」·没有输入框）、
//     即时跟进（has 回 false；外面改了 project.json 由外框的外部改档提示接手）。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EditorProps, SaveState } from '../../shared/types'
import type { GuestPageProps, StudioPageHost } from '../../shared/page-host'
import { useStudioT } from '../../shared/StudioT'
import { getProject, updateProject } from '../../shared/projects'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { studioHref } from '../../shared/host'
import { SheetHostProvider, type SheetHost } from '../ui/host'
import SheetPage from './SheetPage'
import { createGuestSheetsData } from './guest-data'
import { guestSheetIoHost } from './guest-import'
import type { SheetBlockingProps, SheetRestoreBarProps, SheetShieldFlush, SheetShieldHandle, SheetsPageHost } from './host'

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' }

function randomTag(): string {
  const a = new Uint8Array(6)
  crypto.getRandomValues(a)
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}
function assetNameFor(mime: string, fallbackExt = 'png'): string {
  return `img-${Date.now().toString(36)}-${randomTag()}.${IMAGE_EXT[mime] ?? fallbackExt}`
}
/** 图位元组 ⇒ 浏览器画布能吃的图（解不了 ⇒ null） */
async function decodeImage(bytes: Uint8Array): Promise<ImageBitmap | null> {
  try { return await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>])) } catch { return null }
}
async function canvasPng(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Uint8Array | null> {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d')
  if (!ctx) return null
  draw(ctx)
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

// ── 要后端的挂点：空钩子／空元件（每次都回同一份，页面拿去当依赖也不会重跑）──
const NO_FLUSH: SheetShieldFlush = { onLock: () => {}, isOpen: () => false }
const NO_SHIELD: SheetShieldHandle = { locked: false }
const NO_ROLE = { busy: false, roster: undefined }
const NO_CHAT_INLINE = {}
function useNoShieldFlush(): SheetShieldFlush { return NO_FLUSH }
function useNoShield(): SheetShieldHandle { return NO_SHIELD }
function useNoRoleBusy() { return NO_ROLE }
function useNoChatInline(): { insert?: (text: string) => boolean; attach?: unknown } { return NO_CHAT_INLINE }
function NoShield() { return null }
/** 「套回」条只在跟别人同时写撞版时出现；游客版只有自己一个人写、外面改档由外框问，不会走到这里。 */
function NoRestoreBar(_p: SheetRestoreBarProps) { return null }

/** 载入中／读不到：同登入版位置的一张卡（登入版的「登入」「回首页」钮是网站的，这里换成回 /studio） */
function GuestBlocking(p: SheetBlockingProps) {
  const t = useStudioT()
  return (
    <div className={editorShell.loadingScreen} data-testid="sheet-blocking">
      <div className="text-center">
        <p className="text-base font-medium text-gray-700">{p.title}</p>
        {p.description && <p className="mt-1 text-sm text-gray-500">{p.description}</p>}
        {p.showSpinner === false && <a href={studioHref.root()} className="mt-4 inline-block text-sm underline">{t('studio_all_apps')}</a>}
      </div>
    </div>
  )
}
function GuestLoading({ label, className }: { kind: 'sheet'; label: string; className?: string }) {
  return <div className={className} data-testid="sheet-loading">{label}</div>
}

/** 外框的宿主还没接上时（旧外框把整页当 Editor 挂）用的最简宿主：品牌回 /studio、两格先放占位。 */
function fallbackBaseHost(): StudioPageHost {
  return {
    kind: 'guest',
    renderHomeBrand: o => <a href={studioHref.root()} data-testid={o?.testId} className="text-sm font-semibold shrink-0">Dilin Studio</a>,
    renderDriveSlot: () => <div className="flex-1 min-h-0 p-3 text-xs text-gray-400" data-testid="sheet-drive-slot-placeholder" />,
    renderChatSlot: o => <div className="flex-1 min-h-0 flex flex-col" data-testid="sheet-chat-slot-placeholder"><div className="flex items-center gap-1 px-2 py-1.5">{o?.titleIcon}</div></div>,
    has: () => false,
  }
}

export default function SheetsGuestPage(props: GuestPageProps) {
  const { store, projectId, host: base } = props
  // 外框每次重绘可能换一份新的回调 ⇒ 存进 ref，资料层只跟着 store 走（⛔ 因为回调换了就重读、把手上的改动洗掉）
  const cbRef = useRef(props)
  cbRef.current = props
  const unsavedRef = useRef(false)

  const [recordName, setRecordName] = useState('')
  const recordNameRef = useRef('')
  recordNameRef.current = recordName
  useEffect(() => { let alive = true; getProject(projectId).then(r => { if (alive && r?.name) setRecordName(r.name) }, () => {}); return () => { alive = false } }, [projectId])

  const data = useMemo(() => createGuestSheetsData({
    store,
    fallbackName: () => recordNameRef.current,
    onSaveState: (st: SaveState, detail?: string) => cbRef.current.onSaveStateChange?.(st === 'saved' && unsavedRef.current ? 'dirty' : st, detail),
    onTitleSaved: name => { if (name) void updateProject(projectId, { name }).catch(() => {}) },
  }), [store, projectId])

  // ── 本机素材（assets/）⇒ blob 网址 ──
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const assetUrlsRef = useRef<Record<string, string>>({})
  const pendingAssets = useRef(new Set<string>())
  const want = useCallback((name: string) => {
    if (assetUrlsRef.current[name] || pendingAssets.current.has(name)) return
    pendingAssets.current.add(name)
    store.readAsset(name).then(b => {
      pendingAssets.current.delete(name)
      if (!b) return
      const u = URL.createObjectURL(b)
      assetUrlsRef.current = { ...assetUrlsRef.current, [name]: u }
      setAssetUrls(assetUrlsRef.current)
    }, () => { pendingAssets.current.delete(name) })
  }, [store])
  useEffect(() => () => { for (const u of Object.values(assetUrlsRef.current)) URL.revokeObjectURL(u) }, [])

  const sheetHost = useMemo<SheetHost>(() => ({
    async uploadImage(file: File) {
      const name = assetNameFor(file.type)
      await store.writeAsset(name, file)
      const u = URL.createObjectURL(file)
      assetUrlsRef.current = { ...assetUrlsRef.current, [name]: u }
      setAssetUrls(assetUrlsRef.current)
      return { url: `assets/${name}`, displayUrl: u }
    },
    imageSrc: (url: string) => {
      if (!url.startsWith('assets/')) return url
      const name = url.slice('assets/'.length)
      const u = assetUrls[name]
      if (!u) want(name)
      return u ?? ''
    },
  }), [store, assetUrls, want])

  // 外框宿主会随「忙不忙／资料夹授权」换一份；本页的宿主不跟着换（整页拿它当依赖·换了会重载整份表格），两格每次重绘读最新那份
  const fallback = useMemo(fallbackBaseHost, [])
  const baseRef = useRef<StudioPageHost>(base ?? fallback)
  baseRef.current = base ?? fallback
  const host = useMemo<SheetsPageHost>(() => {
    const b = () => baseRef.current
    return {
      kind: 'guest',
      docId: projectId,
      has: f => b().has(f),
      renderHomeBrand: o => b().renderHomeBrand(o),
      chatSlotLabel: b().chatSlotLabel,
      driveSlotLabel: b().driveSlotLabel,
      renderDriveSlot: o => b().renderDriveSlot(o),
      // 这格是「复制给 AI」不是选角色 ⇒ 标题用那格自己的（登入版的「選擇角色」不适用）；收合钮照登入版放标题左边
      renderChatSlot: o => b().renderChatSlot(o ? { titleIcon: o.titleIcon, headerExtra: o.headerExtra, dense: o.dense } : undefined),

      checkAuth: async () => 'ok',
      getDoc: o => data.getDoc(o),
      putTitle: (title, baseTitle) => data.putTitle(title, baseTitle),
      addSheet: x => data.addSheet(x),
      renameSheet: (id, name) => data.renameSheet(id, name),
      deleteSheet: id => data.deleteSheet(id),
      saveSheet: (id, content, baseAt) => data.saveSheet(id, content, baseAt),
      listSheets: () => data.listSheets(),
      async xlsxWithImages(sheetsIn) {
        // 图在浏览器本机取（assets/ 读工程档·http(s) 照抓）、转 png、下层多张用画布合成
        const { resolveXlsxImages } = await import('../engine/xlsx-images')
        const { buildXlsxBytes, XLSX_MIME } = await import('../engine/xlsx-io')
        const r = await resolveXlsxImages(sheetsIn, {
          async fetchBytes(url) {
            if (url.startsWith('assets/')) { const bl = await store.readAsset(url.slice('assets/'.length)); return bl ? new Uint8Array(await bl.arrayBuffer()) : null }
            if (!/^https?:\/\//.test(url)) return null
            const res = await fetch(url).catch(() => null)
            return res && res.ok ? new Uint8Array(await res.arrayBuffer()) : null
          },
          async toPng(bytes) {
            const bmp = await decodeImage(bytes)
            if (!bmp) return null
            return canvasPng(bmp.width, bmp.height, ctx => ctx.drawImage(bmp, 0, 0))
          },
          async compose(width, height, layers) {
            const bmps = await Promise.all(layers.map(l => decodeImage(l.bytes)))
            return canvasPng(width, height, ctx => { layers.forEach((l, i) => { const bm = bmps[i]; if (bm) ctx.drawImage(bm, l.x, l.y, l.w, l.h) }) })
          },
        })
        return { blob: new Blob([buildXlsxBytes(sheetsIn, r.media) as Uint8Array<ArrayBuffer>], { type: XLSX_MIME }), below: r.below, skipped: r.skipped }
      },
      // 顶栏「匯入 xlsx／csv」：游客没有云盘 ⇒ 浏览器本机读档、建成这个浏览器里的一份新表格工程（./guest-import.ts·不打 /api）；
      //   「匯出 csv」纯前端·两颗钮的开关照外框功能表（index.ts guestFeatures 列了 xlsxImport／csvExport）
      ...guestSheetIoHost(),
      setEditorAgent: async () => ({ ok: false, key: null }),
      startLive: () => () => {},

      onUnsavedChange(unsaved) {
        if (unsavedRef.current === unsaved) return
        unsavedRef.current = unsaved
        cbRef.current.onDirtyChange(unsaved)
        if (unsaved) cbRef.current.onSaveStateChange?.('dirty')
      },
      registerFlush(flush) {
        // 外框的「立刻存」：等页面把手上的稿全存进去（这段期间写档照写、不比对外面改过没有）
        cbRef.current.registerFlush?.(flush ? async () => { await data.withForce(flush) } : null)
      },

      useShieldFlush: useNoShieldFlush,
      useEditorAIShield: useNoShield,
      useEditorRoleBusy: useNoRoleBusy,
      useSheetChatInline: useNoChatInline,
      shieldWriteAllowed: () => true,

      BlockingStatus: GuestBlocking,
      EditorLoadingScreen: GuestLoading,
      EditorAIShield: NoShield,
      EditorAIShieldPill: NoShield,
      EditorRestoreBar: NoRestoreBar,
    }
  }, [projectId, data, store])

  return (
    <SheetHostProvider value={sheetHost}>
      <SheetPage host={host} />
    </SheetHostProvider>
  )
}

/** 旧外框（StudioShell 把整页当 Editor 挂）用：没有外框宿主 ⇒ 用最简宿主。外框改成直接渲染 guestPage 之后就不走这里。 */
export function SheetsGuestEditor(props: EditorProps): ReactNode {
  return <SheetsGuestPage {...props} host={undefined as unknown as StudioPageHost} />
}
