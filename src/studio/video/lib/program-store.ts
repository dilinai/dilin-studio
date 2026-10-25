// 网页剪辑页·使用者上传程序包：从电脑选一个 .zip（manifest.json＋入口 html＋资源）⇒ 解开、校验、
// 资源嵌成 data: 网址、存本机储存（OPFS g-<id>.json）＋本机清单；读回给剪辑页用。⛔ 包里的程序只在沙盒 iframe 里跑（VeditProgramFrame）。
import { readStored, storeProgramBundle } from './opfs-cache'
import { PROGRAM_ZIP_MAX, VEDIT_PROGRAMS_KEY, inlineAssets, parseManifest, parseStoredPrograms, programBundleName, stripCommonRoot, type ProgramBundle, type StoredProgram } from './program.pure'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain' }
const mimeOf = (p: string) => MIME[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

export type UnpackResult = { ok: true; bundle: ProgramBundle } | { ok: false; err: string }

/** 解开一个程序包 zip（不存档）：找 manifest.json（容许整包多包一层夹）·入口要在·资源嵌进入口页 */
export async function unpackProgramZip(file: Blob, id: string): Promise<UnpackResult> {
  if (file.size > PROGRAM_ZIP_MAX) return { ok: false, err: `程序包太大（上限 ${PROGRAM_ZIP_MAX / 1024 / 1024}MB）` }
  const JSZip = (await import('jszip')).default
  let zip: InstanceType<typeof JSZip>
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()) } catch { return { ok: false, err: '这不是能解开的 zip 档' } }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  const { rel } = stripCommonRoot(names)
  const byRel = new Map(names.map((n) => [rel(n), n]))
  const mf = byRel.get('manifest.json')
  if (!mf) return { ok: false, err: '包里没有 manifest.json' }
  const pm = parseManifest(await zip.files[mf].async('string'))
  if (!pm.ok) return pm
  const entry = byRel.get(pm.manifest.entry)
  if (!entry) return { ok: false, err: `manifest 写的入口 ${pm.manifest.entry} 不在包里` }
  const assets = new Map<string, string>()
  for (const [r, n] of byRel) {
    if (r === 'manifest.json' || r === pm.manifest.entry) continue
    const b64 = await zip.files[n].async('base64')
    assets.set(r, `data:${mimeOf(r)};base64,${b64}`)
  }
  const html = inlineAssets(await zip.files[entry].async('string'), assets)
  return { ok: true, bundle: { id, manifest: pm.manifest, html, builtin: false } }
}

export function listUploadedPrograms(): StoredProgram[] {
  try { return parseStoredPrograms(window.localStorage.getItem(VEDIT_PROGRAMS_KEY)) } catch { return [] }
}
/** 存进本机（本体进 OPFS·清单进 localStorage·新的在前）；存不进 ⇒ false */
export async function saveUploadedProgram(b: ProgramBundle): Promise<boolean> {
  const ok = await storeProgramBundle(programBundleName(b.id), JSON.stringify({ manifest: b.manifest, html: b.html }))
  if (!ok) return false
  const list = [{ id: b.id, name: b.manifest.name, version: b.manifest.version }, ...listUploadedPrograms().filter((x) => x.id !== b.id)]
  try { window.localStorage.setItem(VEDIT_PROGRAMS_KEY, JSON.stringify(list)) } catch { return false }
  return true
}
/** 读回一个上传包（读不到／坏了 ⇒ null） */
export async function loadUploadedProgram(id: string): Promise<ProgramBundle | null> {
  const f = await readStored(programBundleName(id))
  if (!f) return null
  try {
    const v = JSON.parse(await f.text()) as { manifest?: unknown; html?: unknown }
    const pm = parseManifest(v.manifest)
    if (!pm.ok || typeof v.html !== 'string') return null
    return { id, manifest: pm.manifest, html: v.html, builtin: false }
  } catch { return null }
}
