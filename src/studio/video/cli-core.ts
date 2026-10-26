// Dilin Studio · 剪辑命令列版的核心（tools/video-cli.mjs 用；tools/build.mjs 另打成 app/video-cli-core.mjs·node 跑）。
//   剪辑的读档检查、命令表、FCPXML／剪映草稿汇出本来就是纯函数 ⇒ 不用开浏览器：读 project.json → 检查 → 跑命令 → 写回／汇出。
//   跟编辑页同一套：读档＝format.docFromJson（parseProjectIssues）、命令＝commands.pure applyCommandsState（同网站 video_edit_run）、
//   汇出＝fcpxml.pure／jianying.pure／xmeml.pure（同汇出对话框那三格）；汇入别家工程＝import-project.pure（同剪辑页选进工程档那条路）。
//   做不了的（要网站后端：配音、网页截图、音效；加删素材档）照实拒、什么都不动。
import { checkProjectHeader, formatTag } from '../shared/project-file'
import { docFromJson, docToJson, VIDEO_FORMAT_VERSION, type VideoDoc, type VideoDrop } from './format'
import { applyCommandsState, listCommands, type CommandStep } from './lib/commands.pure'
import { dropZh } from './lib/project.pure'
import { WEBSITE_ONLY } from './lib/agent-job.pure'
import { docToFcpxml } from './lib/fcpxml.pure'
import { docToJianying, JY_CONTENT, JY_META } from './lib/jianying.pure'
import { docToXmeml } from './lib/xmeml.pure'
import { docToEdl } from './lib/edl.pure'
import { docToOtio } from './lib/otio.pure'
import { tracksToAss, tracksToVtt } from './lib/subtitle-io.pure'
import { tracksToSrt } from './lib/clip-ops.pure'
import { addSubtitles, decodeSubtitleBytes, parseSubtitles } from './lib/text.pure'
import { fcpxmlSize } from './lib/fcpxml.pure'
import { importProject, importedToTracks, importNoteText, type ImportedMedia, type ImportedProject } from './lib/import-project.pure'
import { assetNameFor } from './format'

export { assetNameFor, importNoteText }

export type CliIssue = { code: string; text: string }
export type CliFile = { name: string; text: string }

const dropText = (d: VideoDrop): string =>
  d.code === 'media_not_object' ? 'media 里有一项不是物件'
    : d.code === 'media_bad_file' ? `素材 ${(d as { id: string }).id} 的 file 不是 assets/ 里合法的档名`
      : d.code === 'not_json' ? '工程档不是合法的 JSON'
        : d.code === 'not_object' ? '工程档不是一个物件'
          : dropZh(d as Parameters<typeof dropZh>[0])

/** 读 project.json（字串或物件）⇒ doc＋读档报告（编辑页开档时会丢掉／改掉的每一条） */
export function cliLoad(raw: unknown): { doc: VideoDoc; issues: CliIssue[] } {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw
  checkProjectHeader(j, 'video', VIDEO_FORMAT_VERSION)
  const doc = docFromJson(j as Record<string, unknown>)
  return { doc, issues: doc.drops.map((d) => ({ code: d.code, text: dropText(d) })) }
}

/** doc ⇒ project.json 全文（表头在前） */
export function cliSave(doc: VideoDoc): string {
  return JSON.stringify({ format: formatTag('video'), version: VIDEO_FORMAT_VERSION, ...docToJson(doc) }, null, 2) + '\n'
}

export function cliCommands(filter?: string) {
  const f = (filter ?? '').trim().toLowerCase()
  const all = listCommands()
  return f ? all.filter((c) => c.id.toLowerCase().includes(f) || c.description.toLowerCase().includes(f) || c.params.some((p) => p.name.toLowerCase().includes(f))) : all
}

let seq = 0
const newId = () => `cli${Date.now().toString(36)}${(++seq).toString(36)}`

/** 跑一批命令（全有或全无）⇒ 新 doc＋每步结果；出错回哪一步、为什么 */
export function cliRun(doc: VideoDoc, steps: CommandStep[]): { ok: true; doc: VideoDoc; results: unknown[] } | { ok: false; error: string } {
  const web = steps.findIndex((s) => s && WEBSITE_ONLY.has(String(s.command).trim()))
  if (web >= 0) return { ok: false, error: `Step ${web} (${steps[web].command}) needs the website (voice-overs, web screenshots and sound effects). Nothing was applied.` }
  const r = applyCommandsState({ tracks: doc.tracks, ratio: doc.ratio, media: doc.media.map((m) => ({ ...m, from: 'local' as const })), programs: doc.programs, ...(doc.comps ? { comps: doc.comps } : {}) }, steps, { newId })
  if (!r.ok) return { ok: false, error: `${r.step >= 0 ? `Step ${r.step}${r.command ? ` (${r.command})` : ''} failed: ` : ''}${r.error}\nNothing was applied (all steps apply together or not at all).` }
  if (JSON.stringify(r.state.media.map((m) => m.id)) !== JSON.stringify(doc.media.map((m) => m.id))) return { ok: false, error: 'Adding or removing media files is not available from the command line: copy the file into assets/ and add it to "media" in project.json. Nothing was applied.' }
  // 再过一次读档检查（同编辑页入账前那道）：命令做出编辑页读不进的东西 ⇒ 当错
  const next = docFromJson(JSON.parse(cliSave({ ...doc, tracks: r.state.tracks, ratio: r.state.ratio, comps: r.state.comps, programs: { ...(r.state.programs ?? doc.programs) } }))) // 子合成（comp.* 命令）一起写回
  return { ok: true, doc: next, results: r.results }
}

export const CLI_EXPORT_FORMATS = ['fcpxml', 'premiere', 'jianying', 'capcut', 'edl', 'otio', 'srt', 'vtt', 'ass'] as const
export type CliExportFormat = typeof CLI_EXPORT_FORMATS[number]
/** 汇出：fcpxml＝<名>.fcpxml；premiere＝<名>.xml（FCP7 xmeml）；jianying／capcut＝剪映／CapCut 草稿两档（mediaRoot＝素材所在资料夹的绝对路径·剪映要绝对路径才接得上）；
 *  edl＝<名>.edl（CMX3600）；otio＝<名>.otio；srt／vtt／ass＝文字轨上的字幕 */
export function cliExport(doc: VideoDoc, format: CliExportFormat, o: { mediaRoot?: string; os?: 'windows' | 'mac'; assetBase?: string } = {}): { files: CliFile[]; notes: string[] } {
  const base = (doc.name || 'project').replace(/[\\/:*?"<>|]/g, '_')
  if (format === 'edl') { const r = docToEdl(doc, { assetBase: o.assetBase }); return { files: [{ name: `${base}.edl`, text: r.edl }], notes: r.notes } }
  if (format === 'otio') { const r = docToOtio(doc, { assetBase: o.assetBase }); return { files: [{ name: `${base}.otio`, text: r.otio }], notes: r.notes } }
  if (format === 'srt' || format === 'vtt' || format === 'ass') {
    const text = format === 'srt' ? tracksToSrt(doc.tracks) : format === 'vtt' ? tracksToVtt(doc.tracks) : tracksToAss(doc.tracks, fcpxmlSize(doc.ratio), { title: doc.name })
    return { files: text ? [{ name: `${base}.${format}`, text: format === 'vtt' ? text : '\ufeff' + text }] : [], notes: text ? [] : ['no-text'] }
  }
  if (format === 'fcpxml') {
    const r = docToFcpxml(doc, { assetBase: o.assetBase })
    return { files: [{ name: `${(doc.name || 'project').replace(/[\\/:*?"<>|]/g, '_')}.fcpxml`, text: r.xml }], notes: r.notes }
  }
  if (format === 'premiere') {
    const r = docToXmeml(doc, { assetBase: o.assetBase })
    return { files: [{ name: `${(doc.name || 'project').replace(/[\\/:*?"<>|]/g, '_')}.xml`, text: r.xml }], notes: r.notes }
  }
  const jy = docToJianying(doc, { mediaRoot: o.mediaRoot, os: o.os, now: Date.now() * 1000, app: format === 'capcut' ? 'capcut' : 'jianying' })
  return { files: [{ name: JY_CONTENT, text: JSON.stringify(jy.content) }, { name: JY_META, text: JSON.stringify(jy.meta) }], notes: jy.notes }
}

/** 汇入：读一份别家工程（FCPXML／Premiere XML／剪映草稿·文字全文）⇒ 中间结果（素材清单要另外对档）；读不了丢 ImportBad（白话原因） */
export function cliImport(name: string, text: string): ImportedProject {
  return importProject(name, text)
}

/** 汇入第二步：files＝素材 key ⇒ 已拷进 assets/ 的档名（找不到的不给）⇒ 新工程 doc；missing＝没对上档的素材（那些片段拿掉） */
export function cliImportDoc(p: ImportedProject, files: Readonly<Record<string, string>>): { doc: VideoDoc; missing: ImportedMedia[]; clips: number; notes: string[] } {
  const r = importedToTracks(p, (m) => (files[m.key] ? m.key : null), newId)
  const media = p.media.filter((m) => files[m.key]).map((m) => ({ id: m.key, name: m.name, kind: m.kind, duration: m.duration, file: files[m.key] }))
  const doc = docFromJson({ name: p.name.slice(0, 120), ratio: p.ratio, media, tracks: r.tracks, programs: {} })
  return { doc, missing: r.missing, clips: r.clips, notes: p.notes }
}

/** 字幕档（SRT／VTT／ASS·位元组）⇒ 一句一段排上一条文字轨（同剪辑页「匯入本機字幕」）；n＝放了几句 */
export function cliAddSubtitles(doc: VideoDoc, bytes: Uint8Array): { doc: VideoDoc; n: number } {
  const r = addSubtitles(doc.tracks, parseSubtitles(decodeSubtitleBytes(bytes, 'zh-CN')), { id: newId, laneId: newId })
  return { doc: { ...doc, tracks: r.tracks }, n: r.ids.length }
}
