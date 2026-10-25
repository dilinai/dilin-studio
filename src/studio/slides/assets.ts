// 工程素材（assets/）：存新档、把 "assets/<档名>" 换成画面能显示的网址。
//   画布在本页（同源）⇒ 用 blob: 网址；放映、匯出 html 的那份在沙盒框里（不同源读不到本页的 blob:）⇒ 内嵌成 data: 网址。

import type { ProjectStore } from '../shared/types'
import type { DeckDataV2 } from './deck-edit'
import type { SlideComponent } from './kit/components/types'
import { ASSET_PREFIX, assetNameOf, isAssetSrc } from './format'

/** 档名收成安全字元（字母、数字、中日韩字、. _ -），别的换成 _；太长截掉（保留副档名）。 */
export function safeAssetName(raw: string): string {
  const base = (raw || 'file').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '_').replace(/_+/g, '_')
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(base)!
  const stem = (m[1] || 'file').slice(0, 120)
  return `${stem}${m[2] ?? ''}`
}

/** 跟已有的档名不撞：photo.png ⇒ photo-2.png …（taken 用小写比） */
export function uniqueAssetName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i < 10000; i++) { const n = `${stem}-${i}${ext}`; if (!taken.has(n.toLowerCase())) return n }
  return `${stem}-${Date.now()}${ext}`
}

/** 一份 deck 里所有引用到的 assets/ 档名 */
export function assetNamesInDeck(deck: DeckDataV2): string[] {
  const out = new Set<string>()
  const add = (v: unknown) => { if (isAssetSrc(v)) out.add(assetNameOf(v)) }
  const walk = (cs: readonly SlideComponent[] | undefined) => {
    for (const c of cs ?? []) {
      if (c.type === 'image') add(c.src)
      else if (c.type === 'video') { add(c.src); add(c.poster) }
      else if (c.type === 'group') walk(c.children)
    }
  }
  for (const p of deck.pages) {
    walk(p.components)
    add(p.background?.imageUrl); add(p.background?.videoUrl); add(p.background?.poster)
    for (const v of Object.values(p.images ?? {})) add(typeof v === 'string' ? v : (v as { url?: unknown } | null)?.url)
  }
  return [...out]
}

/** 本页用的 blob: 网址快取（同一个档只开一次；dispose 时全部收回） */
export class AssetUrlCache {
  private urls = new Map<string, string>()
  private pending = new Map<string, Promise<string | null>>()
  constructor(private store: ProjectStore) {}

  /** 已经开好的网址（没有 ⇒ null，调用方先 ensure） */
  peek(name: string): string | null { return this.urls.get(name) ?? null }

  /** 读档开网址；档不在 ⇒ null */
  ensure(name: string): Promise<string | null> {
    const have = this.urls.get(name)
    if (have) return Promise.resolve(have)
    const p0 = this.pending.get(name)
    if (p0) return p0
    const p = this.store.readAsset(name).then((b) => {
      this.pending.delete(name)
      if (!b) return null
      const u = URL.createObjectURL(b)
      this.urls.set(name, u)
      return u
    }, () => { this.pending.delete(name); return null })
    this.pending.set(name, p)
    return p
  }

  /** 刚存进去的档：直接用手上那份开网址 */
  put(name: string, blob: Blob): string {
    const old = this.urls.get(name)
    if (old) URL.revokeObjectURL(old)
    const u = URL.createObjectURL(blob)
    this.urls.set(name, u)
    return u
  }

  dispose(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
    this.pending.clear()
  }
}

/** 本机档 ⇒ 存进 assets/（档名收安全、不撞名）；回写进工程的 src 与显示网址 */
export async function saveAssetFiles(store: ProjectStore, cache: AssetUrlCache, files: readonly File[]): Promise<Array<{ url: string; displayUrl: string; name: string; mime: string }>> {
  const taken = new Set((await store.listAssets()).map((a) => a.name.toLowerCase()))
  const out: Array<{ url: string; displayUrl: string; name: string; mime: string }> = []
  for (const f of files) {
    const name = uniqueAssetName(safeAssetName(f.name), taken)
    taken.add(name.toLowerCase())
    await store.writeAsset(name, f)
    out.push({ url: ASSET_PREFIX + name, displayUrl: cache.put(name, f), name: f.name, mime: f.type })
  }
  return out
}

export async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`
}

/** 整份 HTML 里的 "assets/<档名>" 换成 data: 网址（放映、匯出 html 用）；读不到的档原样留着 */
export async function inlineAssetsInHtml(html: string, store: ProjectStore, names: readonly string[]): Promise<string> {
  let out = html
  // 长的档名先换（免得 a.png 先把 a.png.bak 的前半截换掉）
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const src = ASSET_PREFIX + name
    if (!out.includes(src)) continue
    const b = await store.readAsset(name).catch(() => null)
    if (!b) continue
    const data = await blobToDataUrl(b)
    out = out.split(src).join(data)
  }
  return out
}
