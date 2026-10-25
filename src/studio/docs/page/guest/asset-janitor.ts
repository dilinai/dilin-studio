// Removes editor-named files from assets/ once the document no longer uses them (see staleOwnAssets in format.ts).
//
// - after every successful save: stale files are copied into memory, then deleted. If an undo (or anything else)
//   brings a reference back, restore() writes the file again before the next save. Files larger than
//   KEEP_MAX_BYTES are not deleted during a session (keeping them in memory for undo would cost too much);
// - when a document is opened: everything stale is deleted (nothing can be undone past this point);
// - a file the editor is inserting is held (never deleted) until a saved body mentions it, or release() is called
//   because the insert did not happen.
import type { ProjectStore } from '../../../shared/types'
import { ASSET_PREFIX, staleOwnAssets } from '../../format'

export const KEEP_MAX_BYTES = 32 * 1024 * 1024

export interface AssetJanitor {
  hold(name: string): void
  release(name: string): void
  /** Write back removed files that `content` references again. Call before saving `content`. */
  restore(content: string): Promise<void>
  /** Delete stale editor-named files. `opening` = the document was just loaded (no undo history yet). */
  sweep(content: string, opening?: boolean): Promise<string[]>
}

export function createAssetJanitor(store: ProjectStore, cache?: { put(name: string, data: Blob): void; forget(name: string): void }): AssetJanitor {
  const held = new Set<string>()
  const removed = new Map<string, Blob>()
  return {
    hold(name) { held.add(name) },
    release(name) { held.delete(name) },
    async restore(content) {
      for (const [name, data] of removed) {
        if (!content.includes(ASSET_PREFIX + name)) continue
        await store.writeAsset(name, data)
        removed.delete(name)
      }
    },
    async sweep(content, opening = false) {
      for (const h of [...held]) if (content.includes(ASSET_PREFIX + h)) held.delete(h)
      const files = await store.listAssets()
      const size = new Map(files.map(f => [f.name, f.size]))
      const done: string[] = []
      for (const name of staleOwnAssets(files.map(f => f.name), content)) {
        if (held.has(name)) continue
        if (!opening) {
          if ((size.get(name) ?? 0) > KEEP_MAX_BYTES) continue
          const file = await store.readAsset(name)
          if (!file) continue
          // copy the bytes: a blob backed by the file stops being readable once the file is gone
          const copy = new Blob([await file.arrayBuffer()], { type: file.type })
          removed.set(name, copy)
          cache?.put(name, copy)
        }
        try { await store.deleteAsset(name); done.push(name) } catch { removed.delete(name) /* the next sweep retries */ }
      }
      return done
    },
  }
}
