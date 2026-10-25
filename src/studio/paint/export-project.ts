// Dilin Studio · Paint — what "Export project" and the standalone "Save for other apps" add for Photoshop / Illustrator:
//   a layered project.psd and a layered project.ai written by the engine on screen (agent-export.ts psdBlob / aiFile).
//   No drawboard open ⇒ nothing extra (never a blank file).
import type { ProjectPayload, ProjectStore, StudioExportContext } from '../shared/types'
import { readAll } from '../shared/zip'
import { AI_FILE, aiFile, liveSite, psdBlob, PSD_FILE } from './page/agent-export'

export const EXPORT_PSD = 'psd'
export const EXPORT_AI = 'ai'

export async function buildPaintExport(store: ProjectStore, ctx: StudioExportContext): Promise<ProjectPayload> {
  const p = await readAll(store)
  const site = liveSite()
  if (!site || (!ctx.options.has(EXPORT_PSD) && !ctx.options.has(EXPORT_AI))) return p
  const extras = [...(p.extras ?? [])]
  if (ctx.options.has(EXPORT_PSD)) extras.push({ name: PSD_FILE, text: psdBlob(site) })
  if (ctx.options.has(EXPORT_AI)) extras.push({ name: AI_FILE, text: (await aiFile(site)).blob })
  return { ...p, extras }
}

export async function savePsdForOtherApps(): Promise<{ name: string; text: Blob }[]> {
  const site = liveSite()
  if (!site) throw new Error('the drawboard is not open')
  return [{ name: PSD_FILE, text: psdBlob(site) }, { name: AI_FILE, text: (await aiFile(site)).blob }]
}
