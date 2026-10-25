'use client'
// Project assets (assets/<name>) → object URLs for display. One cache per open project; URLs are
// revoked when the editor unmounts. Remote http(s) and data:image sources are shown as they are.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ProjectStore } from '../../../shared/types'
import { assetNameFromSrc } from '../../format'

export interface AssetResolver {
  /** Object URL / usable URL for a document src, or null when it cannot be shown. */
  resolve(src: string): Promise<string | null>
  /** Read the raw bytes of a document src (assets only). */
  blob(src: string): Promise<Blob | null>
  /** Forget a cached asset (after it was overwritten). */
  forget(name: string): void
  /** Serve an asset from memory (used while its file is deleted, so undo can still show it). */
  put(name: string, data: Blob): void
  dispose(): void
}

export function isDisplayableExternal(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src) || /^blob:/i.test(src)
}

export function createAssetResolver(store: ProjectStore): AssetResolver {
  const urls = new Map<string, Promise<string | null>>()
  const made: string[] = []
  return {
    resolve(src) {
      const name = assetNameFromSrc(src)
      if (!name) return Promise.resolve(isDisplayableExternal(src) ? src : null)
      let p = urls.get(name)
      if (!p) {
        p = store.readAsset(name).then(b => {
          if (!b) return null
          const u = URL.createObjectURL(b)
          made.push(u)
          return u
        }, () => null)
        urls.set(name, p)
      }
      return p
    },
    async blob(src) {
      const name = assetNameFromSrc(src)
      if (!name) return null
      try { return await store.readAsset(name) } catch { return null }
    },
    forget(name) { urls.delete(name) },
    put(name, data) {
      const u = URL.createObjectURL(data)
      made.push(u)
      urls.set(name, Promise.resolve(u))
    },
    dispose() { for (const u of made) URL.revokeObjectURL(u); made.length = 0; urls.clear() },
  }
}

const AssetCtx = createContext<AssetResolver | null>(null)

export function AssetProvider({ resolver, children }: { resolver: AssetResolver; children: ReactNode }) {
  return <AssetCtx.Provider value={resolver}>{children}</AssetCtx.Provider>
}

/** undefined = still loading; null = cannot be shown. */
export function useAssetUrl(src: string): string | null | undefined {
  const r = useContext(AssetCtx)
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setUrl(undefined)
    if (!r) { setUrl(isDisplayableExternal(src) ? src : null); return }
    r.resolve(src).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [r, src])
  return url
}
