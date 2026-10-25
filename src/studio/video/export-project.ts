// 剪辑工程档汇出（Shell「匯出工程檔」的两个勾选）：
//   · 只打包用到的片段（used-only）：project.json 的 media 只留时间轴用到的（含编曲分轨），assets/ 只放这些素材的档；
//   · 素材压成小档（preview）：影片换成这个浏览器快取里的剪辑用小预览档（长边 960 的 H.264），档名照旧、project.json 不动；
//     快取里没有小档的（还没转好、浏览器转不了、换了浏览器）或小档没比原档小的，照放原档。图片、音频一律放原档。
//   · 附 Final Cut／达芬奇工程（fcpxml）：zip 根目录多一份 <工程名>.fcpxml（lib/fcpxml.pure.ts·带得过去与带不过去的见那里）。
//   · 附剪映草稿（jianying）：zip 根目录多 draft_content.json＋draft_meta_info.json（lib/jianying.pure.ts）。
//   · 附 Premiere 工程（premiere）：zip 根目录多一份 <工程名>.xml（FCP7 xmeml·lib/xmeml.pure.ts）。
//   · 附 EDL（edl）／OTIO（otio）：zip 根目录多 <工程名>.edl（CMX3600·lib/edl.pure.ts）／<工程名>.otio（lib/otio.pure.ts）。
//   都不勾 ⇒ 跟底座整份打包一样（project.json 原样、assets/ 全部）。
import type { AssetInfo, ProjectStore } from '../shared/types'
import { StudioError } from '../shared/types'
import type { ProjectPayload } from '../shared/zip'
import { checkProjectHeader } from '../shared/project-file'
import { mediaStoreKey } from './lib/store.pure'
import { readProxy } from './lib/opfs-cache'
import { VIDEO_FORMAT_VERSION, docFromJson, usedMediaIds, type VideoDoc } from './format'
import { docToFcpxml } from './lib/fcpxml.pure'
import { JY_CONTENT, JY_META, docToJianying } from './lib/jianying.pure'
import { docToXmeml } from './lib/xmeml.pure'
import { docToEdl } from './lib/edl.pure'
import { docToOtio } from './lib/otio.pure'
import { safeFileBase } from '../shared/zip'

export const EXPORT_USED_ONLY = 'used-only'
export const EXPORT_PREVIEW = 'preview'
/** 附一份 FCPXML（Final Cut Pro／DaVinci Resolve「汇入时间线」）在 zip 根目录·素材指到同 zip 的 assets/ */
export const EXPORT_FCPXML = 'fcpxml'
/** 附剪映专业版草稿（draft_content.json＋draft_meta_info.json 在 zip 根目录·解压出的整夹放进剪映草稿目录就开得起来·Windows 剪映 11.6 开得起来；Mac 剪映 11.6 打不开） */
export const EXPORT_JIANYING = 'jianying'
/** 附 Premiere XML（FCP7 xmeml·Premiere Pro「汇入」认得）在 zip 根目录·素材指到同 zip 的 assets/ */
export const EXPORT_PREMIERE = 'premiere'
/** 附 EDL（CMX3600·主轨＋音频轨）／OTIO（OpenTimelineIO·整条时间线）在 zip 根目录 */
export const EXPORT_EDL = 'edl'
export const EXPORT_OTIO = 'otio'

/** 原档指纹（大小＋修改时间）：外面换了档内容 ⇒ 快取键跟着变·⛔ 拿旧的预览档 */
export const assetSig = (a: Pick<AssetInfo, 'size' | 'lastModified'>): string => `-${a.size.toString(36)}-${Math.round(a.lastModified).toString(36)}`
/** 一份素材在这个浏览器快取里的键（编辑器与汇出共用同一条规则） */
export const cacheKeyOf = (mediaId: string, sig: string, projectId: string): string => mediaStoreKey({ id: `${mediaId}${sig}`, from: 'drive' }, projectId)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const fcpxmlFile = (doc: VideoDoc) => ({ name: `${safeFileBase(doc.name || 'project')}.fcpxml`, text: docToFcpxml(doc).xml })
const premiereFile = (doc: VideoDoc) => ({ name: `${safeFileBase(doc.name || 'project')}.xml`, text: docToXmeml(doc).xml })
const edlFile = (doc: VideoDoc) => ({ name: `${safeFileBase(doc.name || 'project')}.edl`, text: docToEdl(doc).edl })
const otioFile = (doc: VideoDoc) => ({ name: `${safeFileBase(doc.name || 'project')}.otio`, text: docToOtio(doc).otio })

/** 单机版右栏「存一份 Final Cut／达芬奇／Premiere 工程档」：读现在的 project.json（旁路读）转成 .fcpxml＋.xml＋.otio＋.edl，外框写进工程资料夹根目录（素材就在旁边 assets/）。 */
export async function buildOtherAppFiles(store: ProjectStore): Promise<{ name: string; text: string }[]> {
  const raw = await store.readJSON({ peek: true })
  if (raw === null) throw new StudioError('no_project_json')
  const doc = docFromJson(checkProjectHeader(raw, 'video', VIDEO_FORMAT_VERSION))
  return [fcpxmlFile(doc), premiereFile(doc), otioFile(doc), edlFile(doc)]
}

export async function buildVideoExport(
  store: ProjectStore,
  ctx: { projectId: string; options: ReadonlySet<string> },
  deps: { readProxy: (key: string) => Promise<Blob | null> } = { readProxy },
): Promise<ProjectPayload> {
  // 旁路读（peek）：⛔ 动编辑器自动存的比对基准；Shell 叫这支之前已 flush 过
  const raw = await store.readJSON({ peek: true })
  if (raw === null) throw new StudioError('no_project_json')
  const json = checkProjectHeader(raw, 'video', VIDEO_FORMAT_VERSION)
  const usedOnly = ctx.options.has(EXPORT_USED_ONLY)
  const preview = ctx.options.has(EXPORT_PREVIEW)
  const doc = docFromJson(json)
  const keep = usedOnly ? usedMediaIds(doc) : null
  const media = keep ? doc.media.filter((m) => keep.has(m.id)) : doc.media
  const out: Record<string, unknown> = { ...json }
  if (keep && Array.isArray(json.media)) out.media = json.media.filter((m) => isObj(m) && typeof m.id === 'string' && keep.has(m.id))
  const files = keep ? new Set(media.map((m) => m.file)) : null
  // 同一个档被几份素材共用：有一份是影片就当影片（换小档）
  const videoOf = new Map<string, string>()
  for (const m of media) if (m.kind === 'video' && !videoOf.has(m.file)) videoOf.set(m.file, m.id)
  const assets: ProjectPayload['assets'] = []
  for (const a of await store.listAssets()) {
    if (files && !files.has(a.name)) continue
    const vid = preview ? videoOf.get(a.name) : undefined
    const small = vid ? await deps.readProxy(cacheKeyOf(vid, assetSig(a), ctx.projectId)).catch(() => null) : null
    const data = small && small.size < a.size ? small : await store.readAsset(a.name) // 小档没比原档小（原档本来就很小）⇒ 放原档
    if (data) assets.push({ name: a.name, data })
  }
  const extras = ctx.options.has(EXPORT_FCPXML) ? [fcpxmlFile(doc)] : []
  if (ctx.options.has(EXPORT_PREMIERE)) extras.push(premiereFile(doc))
  if (ctx.options.has(EXPORT_OTIO)) extras.push(otioFile(doc))
  if (ctx.options.has(EXPORT_EDL)) extras.push(edlFile(doc))
  if (ctx.options.has(EXPORT_JIANYING)) {
    const jy = docToJianying(doc, { seed: ctx.projectId, now: Date.now() * 1000 })
    extras.push({ name: JY_CONTENT, text: JSON.stringify(jy.content) }, { name: JY_META, text: JSON.stringify(jy.meta) })
  }
  return extras.length ? { json: out, assets, extras } : { json: out, assets }
}
