'use client'
// 网页剪辑页·预览图片预载（算法与缘由见 _lib/image-preload.pure.ts）：
// 清单里的图各开一个 Image 载好并 decode，留着引用（浏览器才不会把解码好的图丢掉）；不在清单里的放掉。
import { useEffect, useRef } from 'react'

export function useImagePreload(urls: readonly string[]): void {
  const held = useRef(new Map<string, HTMLImageElement>())
  const key = urls.join('\n')
  useEffect(() => {
    const want = new Set(urls)
    for (const [u, im] of held.current) if (!want.has(u)) { im.src = ''; held.current.delete(u) }
    for (const u of urls) {
      if (held.current.has(u)) continue
      const im = new Image()
      im.decoding = 'async'
      im.crossOrigin = 'anonymous' // 與時間軸原圖同一載入模式，雲端圖才能供抠像／調色讀像素。
      im.src = u
      held.current.set(u, im)
      void im.decode().catch(() => { /* 载不到就算了·画面层照常自己载 */ })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const im of held.current.values()) im.src = ''; held.current.clear() }, [])
}
