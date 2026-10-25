'use client'
// 编辑 UI 里「要宿主出的东西」：加媒体那颗钮、从别处拖进画布的条目。
//   游客版：LocalMediaUploader（只选本机档，宿主把档存进工程的 assets/）、不收别处拖进来的条目。
//   有云盘的宿主：换成自己的上传元件（同一组 props）＋自己的拖放判读。
//   没包 Provider ⇒ 用游客版那套（编辑器单独拿去用也能跑）。

import { createContext, useContext, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useStudioT } from '../../shared/StudioT'

/** 选到的一份媒体：url＝写进工程的位置（游客版是 assets/<档名>）；displayUrl＝画面显示用（可省）。 */
export type MediaAttachment = { url: string; displayUrl?: string; name?: string; mime?: string }

/** 加媒体那颗钮的 props（与网站上传元件同形的子集）。 */
export type MediaUploaderProps = {
  onAttach: (atts: MediaAttachment[]) => void
  accept?: string
  size?: 'sm' | 'md'
  /** 选到本机档后交给它处理（存档、转成网址）；回传要放进工程的媒体。 */
  customLocalHandler?: (files: FileList) => Promise<MediaAttachment[]>
}

/** 从编辑器以外拖进画布的条目（宿主自己认得的格式）。 */
export type ExternalDragItem = { id: string; kind: string; name: string; mime?: string | null }

export type SlidesHost = {
  MediaUploader: ComponentType<MediaUploaderProps>
  /** 拖进画布的东西是不是宿主认得的条目；不给 ⇒ 只收本机档 */
  externalDrag?: { has(dt: DataTransfer | null | undefined): boolean; read(dt: DataTransfer | null | undefined): ExternalDragItem | null }
}

/** 游客版加媒体钮：一颗「选档」，选好交给 customLocalHandler。 */
export function LocalMediaUploader({ onAttach, accept = 'image/*', size = 'md', customLocalHandler }: MediaUploaderProps) {
  const t = useStudioT()
  const ref = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const cls = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'
  return (
    <>
      <button type="button" disabled={busy} data-testid="slides-local-media-pick"
        className={`${cls} rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50`}
        onClick={() => ref.current?.click()}>
        {busy ? t('studio_slides_media_saving') : t('studio_slides_media_pick')}
      </button>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={async (e) => {
          const files = e.target.files
          if (!files || !files.length || !customLocalHandler) return
          setBusy(true)
          try { onAttach(await customLocalHandler(files)) } finally { setBusy(false); e.target.value = '' }
        }} />
    </>
  )
}

const DEFAULT_HOST: SlidesHost = { MediaUploader: LocalMediaUploader }
const Ctx = createContext<SlidesHost>(DEFAULT_HOST)

export function SlidesHostProvider({ host, children }: { host: SlidesHost; children: ReactNode }) {
  return <Ctx.Provider value={host}>{children}</Ctx.Provider>
}
export function useSlidesHost(): SlidesHost { return useContext(Ctx) }
