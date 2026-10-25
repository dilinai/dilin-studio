'use client'
// 表格画面对「宿主」的要求：取字、界面语言、站别、插图存放、图片网址。
//   取字与语言走底座的 StudioTProvider（useStudioT／useStudioLang）；本档另给插图与图片网址的注入口。
//   登入版与游客版各包一层 SheetHostProvider 把自己那套喂进来。
//   不包 ⇒ 站别读底座宿主设定、插图不可用（insertImage 报失败）、图片网址原样用。
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { isSimplifiedSite } from '../../shared/host'
import type { StudioLang } from '../../shared/types'
import type { SheetTKey } from '../i18n'

export type SheetImageUpload = { url: string; displayUrl?: string }

export type SheetHost = {
  /** 站别：cn ＝ 货币预设 ¥、不显示民國紀年；不给 ⇒ 读底座宿主设定 */
  region?: 'tw' | 'cn'
  /** 插一张图：把档存好、回它的网址（存进 images[].url） */
  uploadImage?: (file: File) => Promise<SheetImageUpload>
  /** images[].url ⇒ <img src>（游客版把 assets/ 相对路径换成本机 blob 网址） */
  imageSrc?: (url: string) => string
  /** <img> 载入失败时（登入版重签网址） */
  onImageError?: (el: HTMLImageElement) => void
}

const SheetHostContext = createContext<SheetHost>({})

export function SheetHostProvider({ value, children }: { value: SheetHost; children: ReactNode }) {
  return <SheetHostContext.Provider value={value}>{children}</SheetHostContext.Provider>
}

export function useSheetHost(): SheetHost & { region: 'tw' | 'cn' } {
  const h = useContext(SheetHostContext)
  return useMemo(() => ({ ...h, region: h.region ?? (isSimplifiedSite() ? 'cn' : 'tw') }), [h])
}
export function useSheetLanguage(): { language: StudioLang } {
  return { language: useStudioLang() }
}
export function useSheetT(): (key: SheetTKey) => string {
  const t = useStudioT()
  return useCallback((key: SheetTKey) => t(key), [t])
}
