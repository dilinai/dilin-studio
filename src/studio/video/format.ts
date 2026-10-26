// 游客版剪辑的工程档：<工程根>/project.json ＋ <工程根>/assets/<素材原档>。栏位说明见同目录 FORMAT.md。
//   轨道、片段、素材清单沿用 lib/project.pure（与登入版 .dvedit 同一套检查）；游客版素材多一栏 file＝assets/ 里的档名，
//   不认云盘栏位（driveId／cloudProxy 读时丢掉）。剪辑用的小预览档、波形只当这个浏览器的快取，不进工程资料夹。
import type { ProjectStore, StudioFormat, StudioLang } from '../shared/types'
import { readProjectJson, writeProjectJson } from '../shared/project-file'
import { checkAssetName } from '../shared/store'
import { EMPTY_PROJECT, parseProjectIssues, type DropIssue, type ProjectMedia, type ProjectProgram } from './lib/project.pure'
import { MAIN_LANE, type Tracks } from './lib/timeline.pure'
import type { RatioSel } from './lib/ratio.pure'
import type { Comps } from './lib/comp.pure'

export const VIDEO_FORMAT_VERSION = 1

/** 读不懂的一条：解析器那几种＋游客版自己的两种（素材不是物件、file 档名不合法）＋整份读不了 */
export type VideoDrop = DropIssue | { code: 'media_not_object' } | { code: 'media_bad_file'; id: string } | { code: 'not_json' | 'not_object' }

export type VideoMedia = Omit<ProjectMedia, 'from' | 'driveId' | 'cloudProxy'> & { /** assets/ 里的档名 */ file: string }
export type VideoDoc = {
  name: string
  ratio: RatioSel
  tracks: Tracks
  media: VideoMedia[]
  programs: Record<string, ProjectProgram>
  /** 子合成（巢状合成·见 lib/comp.pure.ts·没有 ⇒ 缺） */
  comps?: Comps
  /** 读档时丢掉或改掉的条目（代码＋参数·不存回去）：外面改坏的地方由编辑器按语言写给用户看（lib/drop-text.ts） */
  drops: VideoDrop[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function okAssetName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  try { checkAssetName(name); return true } catch { return false }
}

export function emptyVideoDoc(name = ''): VideoDoc {
  const p = EMPTY_PROJECT
  return { name, ratio: p.ratio, tracks: p.tracks.map((l) => ({ ...l, clips: [] })), media: [], programs: {}, drops: [] }
}

/** project.json（表头已验过）⇒ VideoDoc。素材缺 file 或档名不合法 ⇒ 那份素材连同指到它的片段一起丢（drops 写原因）。 */
export function docFromJson(j: Record<string, unknown>): VideoDoc {
  const drops: VideoDrop[] = []
  const files = new Map<string, string>()
  const media: unknown[] = []
  for (const m of Array.isArray(j.media) ? j.media : []) {
    if (!isObj(m)) { drops.push({ code: 'media_not_object' }); continue }
    if (!okAssetName(m.file)) { drops.push({ code: 'media_bad_file', id: String(m.id) }); continue }
    if (typeof m.id === 'string') files.set(m.id, m.file)
    media.push({ ...m, from: 'local' })
  }
  const r = parseProjectIssues({ ratio: j.ratio, tracks: j.tracks, media, programs: j.programs, comps: j.comps })
  if (!r.ok) return { ...emptyVideoDoc(nameOf(j)), drops: [...drops, { code: r.code }] }
  const p = r.project
  return {
    name: nameOf(j),
    ratio: p.ratio,
    tracks: p.tracks,
    media: p.media.map(({ from: _f, driveId: _d, cloudProxy: _c, ...m }) => { void _f; void _d; void _c; return { ...m, file: files.get(m.id)! } }),
    programs: p.programs,
    ...(p.comps ? { comps: p.comps } : {}),
    drops: [...drops, ...r.issues],
  }
}

const nameOf = (j: Record<string, unknown>) => (typeof j.name === 'string' ? j.name.trim().slice(0, 120) : '')

/** VideoDoc ⇒ project.json 的本体（表头另由 writeProjectJson 加）。栏位顺序固定·方便人和 AI 读 diff。 */
export function docToJson(doc: VideoDoc): Record<string, unknown> {
  return {
    name: doc.name,
    ratio: doc.ratio,
    media: doc.media.map((m) => ({
      id: m.id, name: m.name, kind: m.kind, duration: m.duration, file: m.file,
      ...(m.noPicture ? { noPicture: true } : {}), ...(m.stems?.length ? { stems: [...m.stems] } : {}), ...(m.stemOf ? { stemOf: m.stemOf } : {}),
    })),
    // 轨道栏位固定先后（clips 放最后）·读回来再存不会因键序变动而整份重写
    tracks: laneJson(doc.tracks),
    programs: doc.programs,
    // 子合成：栏位顺序同轨道（有才写·旧档读回再存一样）
    ...(doc.comps && Object.keys(doc.comps).length ? { comps: Object.fromEntries(Object.entries(doc.comps).map(([k, c]) => [k, { name: c.name, ratio: c.ratio, ...(c.length ? { length: c.length } : {}), tracks: laneJson(c.tracks) }])) } : {}),
  }
}

const laneJson = (tr: Tracks) => tr.map(({ id, kind, locked, hidden, muted, markers, clips, ...rest }) => ({ id, kind, locked, hidden, muted, ...(markers ? { markers } : {}), ...rest, clips }))

/** 键排过序的 JSON（比对用·不管键的先后） */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

/** 两份内容一不一样（drops 与键的先后不算）——自动存只在真的变了才写 */
export function sameDoc(a: VideoDoc, b: VideoDoc): boolean {
  return stableJson(docToJson(a)) === stableJson(docToJson(b))
}

/** 时间轴用到的素材编号（汇出「只打包用到的片段」用）：片段指到的＋它们的分轨／所属编曲素材 */
export function usedMediaIds(doc: Pick<VideoDoc, 'tracks' | 'media' | 'comps'>): Set<string> {
  const used = new Set<string>()
  // 子合成里的片段也算（合成段画到的素材）
  for (const tr of [doc.tracks, ...Object.values(doc.comps ?? {}).map((c) => c.tracks)]) for (const l of tr) for (const c of l.clips) if (c.mediaId) used.add(c.mediaId)
  for (const m of doc.media) {
    if (used.has(m.id)) for (const s of m.stems ?? []) used.add(s)
    if (m.stemOf && used.has(m.stemOf)) used.add(m.id)
  }
  return used
}

/** 只留用到的素材（汇出「只打包用到的片段」） */
export function pruneUnusedMedia(doc: VideoDoc): VideoDoc {
  const used = usedMediaIds(doc)
  return { ...doc, media: doc.media.filter((m) => used.has(m.id)) }
}

/** 本机档名 ⇒ assets/ 里不撞名的档名（去掉斜线与控制字元·太长截短·撞名加「 (2)」） */
export function assetNameFor(fileName: string, taken: ReadonlySet<string>): string {
  // eslint-disable-next-line no-control-regex
  let base = fileName.replace(/[\\/\u0000-\u001f]/g, '_').trim()
  if (!base || base === '.' || base === '..') base = 'media'
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot).slice(0, 16) : ''
  const fit = (s: string, tail: string) => s.slice(0, 200 - tail.length - ext.length) + tail + ext
  let name = fit(stem, '')
  for (let n = 2; taken.has(name); n++) name = fit(stem, ` (${n})`)
  return name
}

export async function loadVideoDoc(store: ProjectStore): Promise<VideoDoc> {
  const j = await readProjectJson(store, 'video', VIDEO_FORMAT_VERSION)
  return j ? docFromJson(j) : emptyVideoDoc()
}

export function saveVideoDoc(store: ProjectStore, doc: VideoDoc): Promise<void> {
  return writeProjectJson(store, 'video', VIDEO_FORMAT_VERSION, docToJson(doc))
}

const SUMMARY: Record<StudioLang, string> = {
  en: [
    'project.json: {"format":"dilin-studio/video","version":1,"name","ratio","media":[…],"tracks":[…],"programs":{}}.',
    'media item = {id, name, kind:"video"|"audio"|"image", duration (sec, 0 = unknown), file: name of the file in assets/}. To add a clip from a new file, copy the file into assets/ and add a media item. .m4a audio must be AAC (ffmpeg -c:a aac); browsers can\'t decode ALAC.',
    `tracks = lanes top→bottom; the lane with id "${MAIN_LANE}" must exist; audio lanes go below it, every other kind (visual, text, sticker, filter, program) above it.`,
    'lane = {id, kind, clips:[…], locked, hidden, muted}; clip = {id, start, length, offset (sec into the source), mediaId?} plus optional text/sticker/filter/look/fx/transIn/kf/speed/fadeIn/fadeOut… Clips in one lane must not overlap.',
    'Nested compositions: top-level "comps":{id:{name, ratio, length?, tracks}}; a visual clip {comp:id} (no mediaId) places one like a video clip. Track matte: look.matte {clip|lane, mode:"alpha"|"luma", invert?}.',
    'Full field list: FORMAT.md in the editor source. Save the file and the editor reloads within ~2 seconds.',
  ].join('\n'),
  'zh-CN': [
    'project.json：{"format":"dilin-studio/video","version":1,"name","ratio","media":[…],"tracks":[…],"programs":{}}。',
    '素材 media 每项＝{id, name, kind:"video"|"audio"|"image", duration（秒，0＝未知）, file：assets/ 里的档名}。要用新档：先把档复制进 assets/，再加一项素材。m4a 音频要用 AAC 编码（ffmpeg -c:a aac），ALAC 浏览器解不开。',
    `tracks＝轨道（由上到下）；一定要有 id 为 "${MAIN_LANE}" 的主轨；音频轨放在它下面，其他种类（visual、text、sticker、filter、program）放在它上面。`,
    '轨道＝{id, kind, clips:[…], locked, hidden, muted}；片段＝{id, start, length, offset（素材内入点秒）, mediaId?}，另可带 text／sticker／filter／look／fx／transIn／kf／speed／fadeIn／fadeOut…；同一条轨的片段不能重叠。',
    '巢状合成：顶层 "comps":{编号:{name, ratio, length?, tracks}}；画面轨片段写 {comp:编号}（不写 mediaId）就把那份合成当影片段放进来。轨道遮罩：look.matte {clip 或 lane, mode:"alpha"|"luma", invert?}。',
    '完整栏位见编辑器源码里的 FORMAT.md。存档后约 2 秒编辑器就会重新载入。',
  ].join('\n'),
  'zh-TW': [
    'project.json：{"format":"dilin-studio/video","version":1,"name","ratio","media":[…],"tracks":[…],"programs":{}}。',
    '素材 media 每項＝{id, name, kind:"video"|"audio"|"image", duration（秒，0＝未知）, file：assets/ 裡的檔名}。要用新檔：先把檔複製進 assets/，再加一項素材。m4a 音訊要用 AAC 編碼（ffmpeg -c:a aac），ALAC 瀏覽器解不開。',
    `tracks＝軌道（由上到下）；一定要有 id 為 "${MAIN_LANE}" 的主軌；音訊軌放在它下面，其他種類（visual、text、sticker、filter、program）放在它上面。`,
    '軌道＝{id, kind, clips:[…], locked, hidden, muted}；片段＝{id, start, length, offset（素材內入點秒）, mediaId?}，另可帶 text／sticker／filter／look／fx／transIn／kf／speed／fadeIn／fadeOut…；同一條軌的片段不能重疊。',
    '巢狀合成：頂層 "comps":{編號:{name, ratio, length?, tracks}}；畫面軌片段寫 {comp:編號}（不寫 mediaId）就把那份合成當影片段放進來。軌道遮罩：look.matte {clip 或 lane, mode:"alpha"|"luma", invert?}。',
    '完整欄位見編輯器原始碼裡的 FORMAT.md。存檔後約 2 秒編輯器就會重新載入。',
  ].join('\n'),
}

export const videoFormat: StudioFormat<VideoDoc> = {
  version: VIDEO_FORMAT_VERSION,
  emptyProject: () => emptyVideoDoc(),
  load: loadVideoDoc,
  save: saveVideoDoc,
  summaryForAI: (lang) => SUMMARY[lang],
}
