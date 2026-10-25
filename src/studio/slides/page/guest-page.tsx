'use client'
// 游客版简报编辑页（/studio/slides/<编号>）：渲染跟登入版同一份整页（SlidesPage.tsx），宿主换成本机这套。
//   底座给的宿主（props.host）出左上角品牌、左栏「雲端硬碟」那格（工程清单＋存放位置）、右栏那格（复制给 AI）与 has()；
//   这里补简报自己的：接口（local-api.ts，对本机工程档）、网址参数、媒体网址，其余网站才有的（登入、AI 编辑保护罩、角色）一律空着。

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GuestPageProps, StudioPageHost } from '../../shared/page-host'
import type { EditorProps } from '../../shared/types'
import { useStudioT } from '../../shared/StudioT'
import { defaultLang, studioHref } from '../../shared/host'
import { acceptAssetUrls } from '../format'
import { setSlideTitleLabel } from '../html-utils'
import SlidesPage from './SlidesPage'
import { LocalSlidesApi } from './local-api'
import type { EditorLoadFail, SlidesPageHost } from './host'

const NO_SHIELD = { locked: false }
const NO_FLUSH = { onLock: () => {}, isOpen: () => false, track: <T,>(p: Promise<T>) => p }

/** 工程编号＝32 个十六进位字 */
const PROJECT_ID_RE = /^[0-9a-f]{32}$/

function guestLoadFail(status: number | null): EditorLoadFail {
  if (status === 400) return 'bad_id'
  if (status === 404) return 'not_found'
  return 'error'
}

function GuestGate({ kind }: { kind: 'not_found' | 'bad_id' }) {
  const t = useStudioT()
  return (
    <div className="h-screen flex items-center justify-center bg-[#FAFAF8] p-6" data-testid="slides-gate">
      <div className="max-w-md w-full rounded-2xl border border-[#E7DCBE] bg-white p-6 text-center">
        <div className="text-base font-semibold text-[#4A3528]">{kind === 'bad_id' ? t('slides_bad_id') : t('slides_not_found')}</div>
        <div className="mt-2 text-sm text-gray-500">{kind === 'bad_id' ? t('slides_bad_id_desc') : t('slides_not_found_desc')}</div>
        <a href={studioHref.app('slides')} className="mt-4 inline-block px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">{t('studio_slides_back_projects')}</a>
      </div>
    </div>
  )
}

/** 换了存放位置（存到资料夹）⇒ 换一份 store：整页重挂，接口跟着换（旧那份浏览器储存会被清掉） */
const storeKeys = new WeakMap<object, number>()
let storeSeq = 0
function storeKey(store: object): number {
  let k = storeKeys.get(store)
  if (k === undefined) { k = ++storeSeq; storeKeys.set(store, k) }
  return k
}

export default function SlidesGuestPage(props: GuestPageProps) {
  return <SlidesGuestPageInner key={storeKey(props.store)} {...props} />
}

function SlidesGuestPageInner({ host: base, store, projectId, onDirtyChange, onSaveStateChange, registerFlush }: GuestPageProps) {
  const t = useStudioT()
  const events = useRef({ onDirtyChange, onSaveStateChange })
  events.current = { onDirtyChange, onSaveStateChange }
  const baseRef = useRef(base)
  baseRef.current = base

  // 拆页缺页名时的字跟界面语言走
  setSlideTitleLabel((k) => t(k))

  const [api] = useState(() => new LocalSlidesApi(store, projectId, () => events.current))
  useEffect(() => () => api.dispose(), [api])
  useEffect(() => {
    registerFlush?.(() => api.flush())
    return () => { registerFlush?.(null) }
  }, [api, registerFlush])
  // 编辑器挂着时：工程素材 assets/<档名> 算合法媒体网址
  useEffect(() => { acceptAssetUrls(true); return () => acceptAssetUrls(false) }, [])

  const [host] = useState<SlidesPageHost>(() => {
    const params = { get: (k: string) => (k === 'id' ? projectId : null) }
    const router = { push: (href: string) => { window.location.href = href } }
    return {
      kind: 'guest',
      api,
      has: (f) => baseRef.current.has(f),
      renderHomeBrand: (o) => baseRef.current.renderHomeBrand(o),
      chatSlotLabel: baseRef.current.chatSlotLabel,
      driveSlotLabel: baseRef.current.driveSlotLabel,
      renderDriveSlot: (o) => baseRef.current.renderDriveSlot(o),
      // 右栏那格的标题与「这份简报由哪只角色编辑」是登入版角色对话才用的；游客版那格自己有标题
      renderChatSlot: (o) => baseRef.current.renderChatSlot({ titleIcon: o?.titleIcon, dense: o?.dense, headerExtra: o?.headerExtra }),
      useSearchParams: () => params,
      useRouter: () => router,
      urlDocId: () => projectId,
      replaceDeckUrl: () => {},
      openDeck: () => {},
      isEditorId: (id) => PROJECT_ID_RE.test(id),
      editorLoadFail: guestLoadFail,
      checkAuth: () => Promise.resolve(true),
      slideLang: defaultLang() === 'zh-CN' ? 'zh-CN' : 'zh-TW',
      shareOptions: () => ['private'],
      shareUrl: () => '',
      uploadTooLarge: () => null,
      mediaUrl: (src) => api.mediaUrl(src),
      loadLegacyPptx: () => Promise.reject(new Error('unsupported')),
      editorKeyFromUrl: () => null,
      resolveDriveDrop: async () => ({ ok: false }),
      useEditorRoleBusy: () => ({ busy: false, roster: undefined }),
      useEditorAIShield: () => NO_SHIELD,
      useShieldFlush: () => NO_FLUSH,
      shieldReloadQuiet: () => true,
      useSignedMediaRefresh: () => {},
      renderGate: (kind): ReactNode => (kind === 'not_found' || kind === 'bad_id' ? <GuestGate kind={kind} /> : null),
      renderShieldPill: () => null,
      renderShield: () => null,
      renderRestoreBar: () => null,
    }
  })

  return <SlidesPage host={host} />
}

// ── 底座的游客宿主还没接上时（外框只认 Editor）：两格先放占位，整页照样能用 ──
function PendingSlot({ label, titleIcon }: { label: string; titleIcon?: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 h-full flex flex-col" style={{ background: '#FAF9F5' }} data-testid="slides-slot-pending">
      {titleIcon ? <div className="px-3 py-2 border-b border-[#E7E0D2] shrink-0 flex items-center gap-1.5">{titleIcon}</div> : null}
      <div className="flex-1 flex items-center justify-center p-4 text-center text-xs text-gray-400">{label}</div>
    </div>
  )
}

function PendingBrand({ iconOnly, testId }: { iconOnly?: boolean; testId?: string }) {
  const t = useStudioT()
  return (
    <a href={studioHref.root()} data-testid={testId} className="flex items-center gap-1.5 text-sm font-semibold rounded-md px-1.5 py-1 -my-1 -ml-1.5 text-[#2B2722] hover:bg-black/5 shrink-0">
      {!iconOnly && t('studio_slides_brand')}
    </a>
  )
}

const PENDING_HOST: StudioPageHost = {
  kind: 'guest',
  has: () => false,
  renderHomeBrand: (o) => <PendingBrand iconOnly={o?.iconOnly} testId={o?.testId} />,
  renderDriveSlot: () => <PendingSlotT k="studio_slides_slot_projects" />,
  renderChatSlot: (o) => <PendingSlotT k="studio_slides_slot_ai" titleIcon={o?.titleIcon} />,
}
function PendingSlotT({ k, titleIcon }: { k: string; titleIcon?: ReactNode }) {
  const t = useStudioT()
  return <PendingSlot label={t(k)} titleIcon={titleIcon} />
}

/** 外框只认 Editor 时用这个：整页＋占位宿主 */
export function SlidesGuestEditor(props: EditorProps) {
  return <SlidesGuestPage {...props} host={PENDING_HOST} />
}
