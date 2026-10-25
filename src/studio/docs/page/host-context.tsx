'use client'
// 整页里的小元件（正文节点的画面：上传占位、可缩放图片…）要摸宿主时从这里拿：页面在最外层包一次 Provider。
//   tiptap 的 React 节点画面渲染在 EditorContent 底下，拿得到这层 context。
import { createContext, useContext, type ReactNode } from 'react'
import type { DocsPageHost } from './host'

const Ctx = createContext<DocsPageHost | null>(null)

export function DocsHostProvider({ host, children }: { host: DocsPageHost; children: ReactNode }) {
  return <Ctx.Provider value={host}>{children}</Ctx.Provider>
}

export function useDocsHost(): DocsPageHost {
  const h = useContext(Ctx)
  if (!h) throw new Error('DocsHostProvider missing')
  return h
}
