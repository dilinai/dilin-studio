// 网页剪辑工程档：存成一份「剪辑」档，边剪边自动存，打开就回到上次的样子；AI 改档时页面要即时看到变化。
//
// 落法：「新增剪輯」⇒ 在当下资料夹建一个专案资料夹（名＝剪辑名）·里面一份 <名>.dvedit（云盘档案·内容＝本档定义的 JSON）；
//   本机汇入的素材自动上传也进这个资料夹。工程档本身就是云盘里的一个档 ⇒ 搬移、丢回收站、还原、下载都走云盘现成那套。
// 素材两个位置都记：id＝本机储存（OPFS o-<id>）那份的键·driveId＝云盘档案编号；开档时云盘链接由服务端照 driveId 现取（⛔ 存签名链·会过期）。
// 角色（AI）用 get_video_edit／update_video_edit 读写同一份（服务端也过 parseProject）·剪辑页每 2 秒问一次版本 ⇒ 变了就换上（即时看到）。
// 本档只放纯函数（题直接跑·服务端与页面共用）。⛔ 碰 DOM／库。
import { parseShape, parseSolid, type ShapeBody, type SolidBody } from './shape.pure' // 形状／纯色片段
import { parseBgfx, type BgfxBody } from './bgfx.pure' // 动态背景片段
import { parseMosaics } from './mosaic.pure' // 追踪打码
import { parseFollow, parseMTracks } from './motion-track.pure' // 运动跟踪
import { parseAudio } from './audio.pure'
import { MAIN_LANE, type FilterBody, type Lane, type LaneKind, type ProgramBody, type StickerBody, type TextBody, type TlClip, type Tracks } from './timeline.pure'
import { parseRatio, type RatioSel } from './ratio.pure'
import { parseCloudProxy, type CloudProxy } from './cloud-proxy.pure' // 代理档存云盘共用
import { FX_ITEMS } from './fx.data'
import { parseLook } from './clip-look.pure' // 片段画面属性
import { ANIM_SLOTS, animDef, parseTextAnim } from './text-anim.pure'
import { STICKERS } from './stickers.data'
import { FILTERS } from './filters.data'
import { normalizeKf, parseKf, type KfProp, type KfTracks } from './keyframe.pure' // 关键帧
const TEXT_ONLY_KF: ReadonlySet<KfProp> = new Set<KfProp>(['tx', 'ty', 'ts', 'trot', 'top'])
/** 只留这种片段用得到的关键帧轨 */
const pickKf = (kf: KfTracks | undefined, ok: (p: KfProp) => boolean): KfTracks | undefined => (kf ? normalizeKf(Object.fromEntries(Object.entries(kf).filter(([p]) => ok(p as KfProp)))) : undefined)
import { curveAvg, parseCurve } from './curve-speed.pure' // 曲线变速
import { parseMarkers } from './toolbar.pure'
import { parseTextLook } from './text-style.pure'
import { fixStemLinks, linkOf } from './store.pure' // 编曲素材分轨
import { NULL_PROPS, fixParents, isRigKf, parseRig, parseRigFields, rigKfOk, type RigBody } from './rig.pure' // 空物件／父子／3D 摄影机灯光
import { COMPS_MAX, COMP_DEPTH_MAX, COMP_NAME_MAX, breakCompCycles, compNegOff, type Comps } from './comp.pure' // 巢状合成

export const VEDIT_PROJECT_EXT = '.dvedit'
export const VEDIT_PROJECT_MIME = 'application/vnd.dilin.vedit+json'
export const VEDIT_PROJECT_VERSION = 1
/** 内嵌上传程序包合计上限（超过的不内嵌·换台电脑那段写「找不到程序包」） */
export const VEDIT_PROGRAMS_EMBED_MAX = 4 * 1024 * 1024
/** 工程档本体（程序包以外：轨道、片段、素材清单）上限：素材是引用·正常几十 KB（终审②：上限压到实际需要） */
export const VEDIT_PROJECT_CORE_MAX = 1024 * 1024
/** 整份工程档上限＝本体＋内嵌程序包（终审②·原 8MB）；写多少都按差额记进云盘配额（迁移 380） */
export const VEDIT_PROJECT_MAX_BYTES = VEDIT_PROJECT_CORE_MAX + VEDIT_PROGRAMS_EMBED_MAX
/** 存档前量大小：本体超 ⇒ 'core'；程序包超 ⇒ 'programs'；都没超 ⇒ null（bytes＝整份 JSON 的 UTF-8 字节） */
export function projectSizeVerdict(p: VeditProject): { bytes: number; over: 'core' | 'programs' | null } {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
  const bytes = enc(p)
  const core = enc({ ...p, programs: {} })
  return { bytes, over: core > VEDIT_PROJECT_CORE_MAX ? 'core' : bytes - core > VEDIT_PROGRAMS_EMBED_MAX ? 'programs' : null }
}
/** 剪辑页多久问一次版本（角色改了 ⇒ 这么快看到） */
export const VEDIT_LIVE_POLL_MS = 2000
/** 改完多久自动存 */
export const VEDIT_SAVE_DEBOUNCE_MS = 1200

export type ProjectMediaKind = 'video' | 'audio' | 'image'
/** 素材：id＝本机储存键（也是轨道片段的 mediaId）；driveId＝云盘档案编号（有 ⇒ 别台电脑也拿得到）；duration 0＝还没量（页面开档时量） */
/** 编曲素材：stems＝这份（混好的）底下藏着的几份分轨（拖上轨道展开成几条）；stemOf＝我是哪份编曲素材的分轨（素材区不列） */
export type ProjectMedia = { id: string; name: string; kind: ProjectMediaKind; duration: number; from: 'local' | 'drive'; driveId?: string; noPicture?: boolean; stems?: string[]; stemOf?: string; /** 终端转好、存云盘的剪辑用小档／波形／缩图（换电脑共用·of≠driveId ⇒ 读时丢掉） */ cloudProxy?: CloudProxy }
export type ProjectProgram = { manifest: unknown; html: string }
/** comps＝子合成（巢状合成·见 comp.pure.ts·没有就不写这栏＝旧档一样） */
export type VeditProject = { v: number; ratio: RatioSel; tracks: Tracks; media: ProjectMedia[]; programs: Record<string, ProjectProgram>; comps?: Comps }

export const EMPTY_PROJECT: VeditProject = { v: VEDIT_PROJECT_VERSION, ratio: { kind: 'fit' }, tracks: [{ id: MAIN_LANE, kind: 'visual', clips: [], locked: false, hidden: false, muted: false }], media: [], programs: {} }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
import { PROJECT_ID_RE as ID_RE, legacyCopyGroupAnchor, unusedCopyGroupId } from './id.pure'
const LANE_KINDS: readonly LaneKind[] = ['visual', 'audio', 'text', 'sticker', 'filter', 'program']
const MEDIA_KINDS: readonly ProjectMediaKind[] = ['video', 'audio', 'image']
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const FX_KINDS = new Map(FX_ITEMS.map((x) => [x.id, x.kind]))
const STICKER_IDS = new Set(STICKERS.map((s) => s.id))
const FILTER_IDS = new Set(FILTERS.map((f) => f.id))
/** anim 里不认得的那几格（slot:id）——parseTextAnim 会默默略过，读档要报出来 */
function unknownAnims(v: unknown): string[] {
  if (!isObj(v)) return []
  const out: string[] = []
  for (const k of ANIM_SLOTS) { const a = v[k]; if (isObj(a) && (typeof a.id !== 'string' || !animDef(k, a.id))) out.push(`${k}:${String(a.id)}`) }
  return out
}
/** 每种轨放得进哪种片段（null＝素材片段） */
const BODY_OF: Record<LaneKind, 'media' | 'text' | 'sticker' | 'filter' | 'program'> = { visual: 'media', audio: 'media', text: 'text', sticker: 'sticker', filter: 'filter', program: 'program' }

/** 工程档名 ⇒ 剪辑名（去掉 .dvedit） */
export function projectTitle(fileName: string): string {
  const n = fileName.trim()
  return n.toLowerCase().endsWith(VEDIT_PROJECT_EXT) ? n.slice(0, -VEDIT_PROJECT_EXT.length) : n
}
export const isProjectFileName = (name: string | null | undefined): boolean => !!name && name.toLowerCase().endsWith(VEDIT_PROJECT_EXT)
/** 剪辑名最多几个字（建档、顶栏双击改名同一把尺） */
export const VEDIT_NAME_MAX = 80
/** 剪辑名 ⇒ 资料夹与档名可用的字（去掉斜线等·空 ⇒ 缺省名） */
export function safeProjectName(raw: string, fallback: string): string {
  const s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, VEDIT_NAME_MAX)
  return s || fallback
}

function parseText(v: unknown): TextBody | null {
  if (!isObj(v) || typeof v.content !== 'string' || !v.content.trim()) return null
  const x = num(v.x), y = num(v.y), size = num(v.size)
  // 文字栏的属性（字体、粗斜底线、字色、间距、对齐、缩放、旋转、不透明度、描边、背景）：全部可选·旧档没有照常开·值过 parseTextLook 夹范围
  return { content: v.content.slice(0, 2000), x: clamp(x ?? 0.5, 0, 1), y: clamp(y ?? 0.5, 0, 1), size: clamp(size ?? 0.1, 0.03, 0.5), ...(typeof v.fancy === 'string' && v.fancy ? { fancy: v.fancy } : {}), ...parseTextLook(v) }
}
function parseSticker(v: unknown): StickerBody | null {
  if (!isObj(v) || typeof v.sticker !== 'string' || !v.sticker) return null
  return { sticker: v.sticker, x: clamp(num(v.x) ?? 0.5, 0, 1), y: clamp(num(v.y) ?? 0.5, 0, 1), size: clamp(num(v.size) ?? 1 / 3, 0.05, 1.5) }
}
function parseFilter(v: unknown): FilterBody | null {
  if (!isObj(v) || typeof v.filter !== 'string' || !v.filter) return null
  return { filter: v.filter, strength: clamp(num(v.strength) ?? 1, 0, 1) }
}
function parseProgramBody(v: unknown): ProgramBody | null {
  if (!isObj(v) || typeof v.pkg !== 'string' || !v.pkg) return null
  const params: Record<string, string | number | boolean> = {}
  if (isObj(v.params)) for (const [k, x] of Object.entries(v.params)) if (typeof x === 'string' || typeof x === 'boolean' || num(x) !== null) params[k] = x as string | number | boolean
  return { pkg: v.pkg, version: typeof v.version === 'string' ? v.version : String(v.version ?? '1'), params }
}

/** 读档时丢掉或改掉的一条：code＋几个参数（给人看的字由各页面按语言取；dropZh＝服务端回给角色那句中文） */
export type DropCode = 'media_bad_id' | 'media_dup' | 'media_bad_kind' | 'media_no_drive' | 'lane_bad_id' | 'lane_bad_kind' | 'clip_bad_shape'
  | 'clip_no_media' | 'clip_no_body' | 'clip_overlap' | 'group_bad' | 'group_renamed' | 'lane_moved_audio'
  // 片段指到库里没有的特效／转场／动画（已拿掉）·贴纸／滤镜（片段留着但画不出来）
  | 'ref_unknown' | 'ref_unknown_kept' | 'ratio_unknown'
  // 父层指不到／不能当父层·父子连结绕成圈·表达式读不懂（都只拿掉那一栏）
  | 'parent_bad' | 'parent_loop' | 'expr_bad'
  // 巢状合成：合成段指到没有的合成·合成编号／内容不合法·绕回自己·套太深；轨道遮罩指到同一份时间轴里没有的片段
  | 'clip_no_comp' | 'comp_bad' | 'comp_cycle' | 'comp_deep' | 'matte_bad_ref'
export type DropIssue = { code: DropCode; id?: string; ids?: string; lane?: string; body?: string; old?: string; group?: string }
const DROP_ZH: Record<DropCode, (d: DropIssue) => string> = {
  media_bad_id: () => '有一份素材的 id 不合法',
  media_dup: (d) => `素材 ${d.id} 重复`,
  media_bad_kind: (d) => `素材 ${d.id} 的 kind 要是 video／audio／image`,
  media_no_drive: (d) => `云盘素材 ${d.id} 缺 driveId`,
  lane_bad_id: () => '有一条轨道的 id 不合法或重复',
  lane_bad_kind: (d) => `轨道 ${d.id} 的 kind 不认得`,
  clip_bad_shape: (d) => `轨道 ${d.lane} 有一段的 id／start／length 不合法`,
  clip_no_media: (d) => `片段 ${d.id} 指到的素材不在素材清单里`,
  clip_no_body: (d) => `片段 ${d.id} 缺 ${d.body} 内容`,
  clip_overlap: (d) => `片段 ${d.id} 跟同轨前一段重叠`,
  group_bad: (d) => `片段 ${d.ids} 的群組編號不合法，已取消群組`,
  group_renamed: (d) => `舊副本群組 ${d.old} 已換成相容編號 ${d.group}，成員保持不變`,
  lane_moved_audio: (d) => `轨道 ${d.id} 挪到音频区（下面）`,
  ref_unknown: (d) => `片段 ${d.id} 的 ${d.body}「${d.old}」不在库里，已拿掉`,
  ref_unknown_kept: (d) => `片段 ${d.id} 的 ${d.body}「${d.old}」不在库里，画不出来`,
  ratio_unknown: (d) => `画面比例 ${d.old} 不认得，已改成「适应」`,
  parent_bad: (d) => `片段 ${d.id} 的父层「${d.old}」不在或不能当父层，已拿掉父子连结`,
  parent_loop: (d) => `片段 ${d.id} 的父子连结绕成一圈（经过「${d.old}」），已拿掉这一段的连结`,
  expr_bad: (d) => `片段 ${d.id} 的 ${d.body} 表达式读不懂或这段没有这一项，已拿掉`,
  clip_no_comp: (d) => `合成段 ${d.id} 指到的合成 ${d.old} 不在工程里`,
  comp_bad: (d) => `合成 ${d.id} 的编号或内容不合法`,
  comp_cycle: (d) => `合成段 ${d.id} 放的合成 ${d.old} 会绕回自己（合成里不能套自己），已拿掉`,
  comp_deep: (d) => `合成段 ${d.id} 底下套的合成超过 ${COMP_DEPTH_MAX} 层，已拿掉`,
  matte_bad_ref: (d) => `片段 ${d.id} 的轨道遮罩指到的片段 ${d.old} 不在同一条时间轴的上方各轨，已拿掉遮罩`,
}
export const dropZh = (d: DropIssue): string => DROP_ZH[d.code](d)

/** 读一份工程档（服务端存之前、页面开档、角色改之后都过这一道）：
 *  不合规的条目丢掉（issues＝代码与参数·drops＝同一份转成中文白话）·一定有主轨·同轨重叠的后者丢掉·素材片段要指到清单里有的素材。
 *  整份不是物件 ⇒ ok=false。 */
export function parseProject(raw: unknown): { ok: true; project: VeditProject; drops: string[] } | { ok: false; err: string } {
  const r = parseProjectIssues(raw)
  return r.ok ? { ok: true, project: r.project, drops: r.issues.map(dropZh) } : { ok: false, err: r.err }
}

/** 同 parseProject·但丢掉的条目回代码＋参数（游客版按界面语言显示）·整份读不了另回 code */
export function parseProjectIssues(raw: unknown): { ok: true; project: VeditProject; issues: DropIssue[] } | { ok: false; err: string; code: 'not_json' | 'not_object' } {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return { ok: false, err: '工程档不是合法的 JSON', code: 'not_json' } } }
  if (!isObj(v)) return { ok: false, err: '工程档不是一个物件', code: 'not_object' }
  const issues: DropIssue[] = []
  const drop = (d: DropIssue) => { issues.push(d) }
  // 动画：认得的照收；不认得的格报出来（不再默默略过）
  const animOf = (raw: unknown, id: string) => { for (const old of unknownAnims(raw)) drop({ code: 'ref_unknown', id, body: 'anim', old }); return parseTextAnim(raw) }
  // 素材
  const media: ProjectMedia[] = []
  const mediaIds = new Set<string>()
  for (const m of Array.isArray(v.media) ? v.media : []) {
    if (!isObj(m) || typeof m.id !== 'string' || !ID_RE.test(m.id)) { drop({ code: 'media_bad_id' }); continue }
    if (mediaIds.has(m.id)) { drop({ code: 'media_dup', id: m.id }); continue }
    if (!MEDIA_KINDS.includes(m.kind as ProjectMediaKind)) { drop({ code: 'media_bad_kind', id: m.id }); continue }
    const driveId = typeof m.driveId === 'string' && /^[0-9a-f-]{36}$/i.test(m.driveId) ? m.driveId : undefined
    const from = m.from === 'drive' ? 'drive' : 'local'
    if (from === 'drive' && !driveId) { drop({ code: 'media_no_drive', id: m.id }); continue }
    const d = num(m.duration)
    mediaIds.add(m.id)
    const cloudProxy = parseCloudProxy(m.cloudProxy, driveId)
    media.push({ id: m.id, name: typeof m.name === 'string' && m.name.trim() ? m.name.slice(0, 200) : m.id, kind: m.kind as ProjectMediaKind, duration: d !== null && d > 0 ? d : 0, from, ...(driveId ? { driveId } : {}), ...(m.noPicture === true ? { noPicture: true } : {}), ...linkOf(m), ...(cloudProxy ? { cloudProxy } : {}) })
  }
  // 编曲素材：分轨的指向只留指得到的（指不到的拿掉·照常开）
  fixStemLinks(media)
  // 子合成：先认编号（轨道里的合成段要指得到）·各自的轨道同主时间轴一样读（片段编号全工程唯一）
  const compRaw: Array<[string, Record<string, unknown>]> = []
  if (isObj(v.comps) && !compNegOff()) for (const [k, c] of Object.entries(v.comps)) {
    if (!ID_RE.test(k) || !isObj(c) || compRaw.length >= COMPS_MAX) { drop({ code: 'comp_bad', id: k.slice(0, 64) }); continue }
    compRaw.push([k, c])
  }
  const compIds = new Set(compRaw.map(([k]) => k))
  const clipIds = new Set<string>()
  const root = parseTracksIn(v.tracks, { mediaIds, clipIds, compIds, drop, animOf })
  const comps: Comps = {}
  for (const [k, c] of compRaw) {
    const len = num(c.length)
    const ratio = parseRatio(isObj(c.ratio) ? JSON.stringify(c.ratio) : null)
    comps[k] = { name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, COMP_NAME_MAX) : k, ratio, ...(len !== null && len > 0 ? { length: clamp(len, FRAME_SEC, 24 * 3600) } : {}), tracks: parseTracksIn(c.tracks, { mediaIds, clipIds, compIds, drop, animOf }) }
  }
  // 绕回自己（A 里放 A、A→B→A）或套太深的合成段拿掉
  const cyc = breakCompCycles(root, comps)
  for (const d of cyc.dropped) drop({ code: d.why === 'cycle' ? 'comp_cycle' : 'comp_deep', id: d.clip, old: d.comp })
  // 程序包（内嵌的上传包）
  const programs: Record<string, ProjectProgram> = {}
  if (isObj(v.programs)) for (const [k, p] of Object.entries(v.programs)) if (/^u-[A-Za-z0-9-]{8,64}$/.test(k) && isObj(p) && typeof p.html === 'string' && isObj(p.manifest)) programs[k] = { manifest: p.manifest, html: p.html }
  const ratio = parseRatio(isObj(v.ratio) ? JSON.stringify(v.ratio) : null)
  // 写了比例却读成「适应」（例：旧档的字串 "21:9"、库里没有的 preset 键）⇒ 报出来，别默默丢
  if (v.ratio !== undefined && v.ratio !== null && ratio.kind === 'fit' && !(isObj(v.ratio) && v.ratio.kind === 'fit')) drop({ code: 'ratio_unknown', old: JSON.stringify(v.ratio).slice(0, 60) })
  return { ok: true, project: { v: VEDIT_PROJECT_VERSION, ratio, tracks: cyc.root, media, programs, ...(Object.keys(cyc.comps).length ? { comps: cyc.comps } : {}) }, issues }
}

type TracksCtx = { mediaIds: ReadonlySet<string>; clipIds: Set<string>; compIds: ReadonlySet<string>; drop: (d: DropIssue) => void; animOf: (raw: unknown, id: string) => ReturnType<typeof parseTextAnim> }
const FRAME_SEC = 1 / 30
/** 一份轨道（主时间轴或一份子合成）：不合规的条目丢掉·一定有主轨·同轨重叠的后者丢掉·素材片段要指到清单里有的素材·合成段要指到有的合成 */
function parseTracksIn(rawTracks: unknown, x: TracksCtx): Tracks {
  const { mediaIds, clipIds, compIds, drop, animOf } = x
  const tracks: Tracks = []
  const laneIds = new Set<string>()
  // 只收已通過全部片段校形的舊群組成員；不能把會被丟掉的同名片段當作相容依據。
  const legacyGroups = new Map<string, TlClip[]>()
  for (const l of Array.isArray(rawTracks) ? rawTracks : []) {
    if (!isObj(l) || typeof l.id !== 'string' || !ID_RE.test(l.id) || laneIds.has(l.id)) { drop({ code: 'lane_bad_id' }); continue }
    const kind = l.id === MAIN_LANE ? 'visual' : l.kind as LaneKind
    if (!LANE_KINDS.includes(kind)) { drop({ code: 'lane_bad_kind', id: l.id }); continue }
    laneIds.add(l.id)
    const body = BODY_OF[kind]
    const clips: TlClip[] = []
    const raw = (Array.isArray(l.clips) ? l.clips : []).filter(isObj).slice().sort((a, b) => (num(a.start) ?? 0) - (num(b.start) ?? 0))
    for (const c of raw) {
      const id = typeof c.id === 'string' && ID_RE.test(c.id) && !clipIds.has(c.id) ? c.id : null
      const start = num(c.start), length = num(c.length)
      if (!id || start === null || start < 0 || length === null || length <= 0) { drop({ code: 'clip_bad_shape', lane: l.id }); continue }
      const clip: TlClip = { id, mediaId: '', start, length, offset: Math.max(0, num(c.offset) ?? 0) }
      /** 这段能打哪几项关键帧（各分支设·表达式也只收这几项） */
      let kfOk: (p: KfProp) => boolean = () => false
      // 形状／纯色片段（画面轨·mediaId 空）：内容验值＋位置大小旋转不透明度（look 只收这几项）＋关键帧（同几项）＋动画
      //   空物件／摄影机／灯光（rig）同一格：空物件同形状；摄影机／灯光没有 look、动画·关键帧只收 cam.*／lt.*
      const vec = kind === 'visual' && !c.mediaId ? (c.shape !== undefined ? parseShape(c.shape) : c.solid !== undefined ? parseSolid(c.solid) : c.bgfx !== undefined ? parseBgfx(c.bgfx) : c.rig !== undefined ? parseRig(c.rig) : null) : null
      if (vec) {
        if (c.shape !== undefined) clip.shape = vec as ShapeBody; else if (c.solid !== undefined) clip.solid = vec as SolidBody; else if (c.bgfx !== undefined) clip.bgfx = vec as BgfxBody; else clip.rig = vec as RigBody
        clip.offset = 0
        const ctl = clip.rig && clip.rig.kind !== 'null' // 摄影机／灯光
        const lk = ctl ? undefined : parseLook(c.look)
        if (lk) { const o: Record<string, unknown> = {}; for (const k of ['sx', 'sy', 'uniform', 'x', 'y', 'rot', 'opacity'] as const) if (lk[k] !== undefined) o[k] = lk[k]; if (Object.keys(o).length) clip.look = o as TlClip['look'] }
        const kf = pickKf(parseKf(c.kf), kfOk = clip.rig ? rigKfOk(clip.rig) : (p) => NULL_PROPS.includes(p))
        if (kf) clip.kf = kf
        const anim = ctl ? undefined : animOf(c.anim, id)
        if (anim) clip.anim = anim
      } else if (body === 'media') {
        // 合成段（画面轨·mediaId 空·comp＝子合成编号）：其余栏位照素材片段读（变速、倒放、定格、外观、特效转场、关键帧、动画…）
        if (kind === 'visual' && !c.mediaId && typeof c.comp === 'string') {
          if (!compIds.has(c.comp)) { drop({ code: 'clip_no_comp', id, old: c.comp.slice(0, 64) }); continue }
          clip.comp = c.comp
        } else {
          if (typeof c.mediaId !== 'string' || !mediaIds.has(c.mediaId)) { drop({ code: 'clip_no_media', id }); continue }
          clip.mediaId = c.mediaId
        }
        const vol = num(c.volume)
        if (vol !== null) clip.volume = clamp(vol, 0, 10)
        if (c.muted === true) clip.muted = true
        if (c.detached === true) clip.detached = true
        // （选中影片片段的「人工」页）：变速、变调、淡入淡出；画面轨另有画面属性与动画
        const sp = num(c.speed)
        // 曲线变速：有曲线 ⇒ speed＝平均速度（四位小数）
        const curve = parseCurve(c.curve)
        if (curve) { clip.curve = curve; clip.speed = Math.round(clamp(sp ?? curveAvg(curve), 0.1, 100) * 10000) / 10000 }
        else if (sp !== null && Math.abs(sp - 1) > 1e-6) clip.speed = Math.round(clamp(sp, 0.1, 100) * 100) / 100
        if (c.pitch === true) clip.pitch = true
    const aud = parseAudio(c.aud); if (aud) clip.aud = aud // 声音处理
    const mz = parseMosaics(c.mosaic); if (mz) clip.mosaic = mz // 追踪打码
    if (kind === 'visual') { const mt = parseMTracks(c.mtrack); if (mt) clip.mtrack = mt } // 运动跟踪路径
    // 倒放（不跟曲线变速并用）·定格（画面轨才有）
    if (c.reverse === true && !clip.curve) clip.reverse = true
    if (c.freeze === true && kind === 'visual') { clip.freeze = true; delete clip.reverse; delete clip.curve; delete clip.speed }
        // 关键帧（画面轨才收画面那几项）
        const kf = pickKf(parseKf(c.kf), kfOk = (p) => p === 'vol' || (kind === 'visual' && !TEXT_ONLY_KF.has(p) && p !== 'flt' && !isRigKf(p)))
        if (kf) clip.kf = kf
        for (const k of ['fadeIn', 'fadeOut'] as const) { const f = num(c[k]); if (f !== null && f > 0) clip[k] = Math.round(clamp(f, 0, Math.min(10, length)) * 10) / 10 }
        if (kind === 'visual') {
          const look = parseLook(c.look)
          if (look) clip.look = look
          const anim = animOf(c.anim, id)
          if (anim) clip.anim = anim
        }
        // 特效标在素材片段身上·转场标在接缝（存后一段）——只认库里有的款（画面轨才有）
        if (kind === 'visual') {
          for (const x of (Array.isArray(c.fx) ? c.fx : []).filter(isObj)) if (FX_KINDS.get(String(x.fx)) !== 'effect') drop({ code: 'ref_unknown', id, body: 'fx', old: String(x.fx) })
          if (isObj(c.transIn) && FX_KINDS.get(String(c.transIn.tr)) !== 'transition') drop({ code: 'ref_unknown', id, body: 'transIn', old: String(c.transIn.tr) })
          const fx = (Array.isArray(c.fx) ? c.fx : []).filter(isObj).filter((x) => FX_KINDS.get(String(x.fx)) === 'effect').slice(0, 4)
            .map((x) => ({ fx: String(x.fx), strength: clamp(num(x.strength) ?? 1, 0, 1) })).filter((x, i, a) => a.findIndex((y) => y.fx === x.fx) === i)
          if (fx.length) clip.fx = fx
          if (isObj(c.transIn) && FX_KINDS.get(String(c.transIn.tr)) === 'transition') clip.transIn = { tr: String(c.transIn.tr), length: clamp(num(c.transIn.length) ?? 0.8, 0.2, 3) }
        }
      } else if (body === 'filter' && c.adjust === true) {
        // 调节层：调色在 look·关键帧只收调整那几项
        clip.adjust = true
        const look = parseLook(c.look)
        if (look) { const { hsl, curves, wheels, lut, adj } = look; const g = { ...(hsl ? { hsl } : {}), ...(curves ? { curves } : {}), ...(wheels ? { wheels } : {}), ...(lut ? { lut } : {}), ...(adj ? { adj } : {}) }; if (Object.keys(g).length) clip.look = g }
        const kf = pickKf(parseKf(c.kf), kfOk = (p) => p.startsWith('adj.'))
        if (kf) clip.kf = kf
      } else {
        const b = body === 'text' ? parseText(c.text) : body === 'sticker' ? parseSticker(c.sticker) : body === 'filter' ? parseFilter(c.filter) : parseProgramBody(c.program)
        if (!b) { drop({ code: 'clip_no_body', id, body }); continue }
        ;(clip as Record<string, unknown>)[body] = b
        if (body === 'sticker' && !STICKER_IDS.has((b as StickerBody).sticker)) drop({ code: 'ref_unknown_kept', id, body: 'sticker', old: (b as StickerBody).sticker })
        if (body === 'filter' && !FILTER_IDS.has((b as FilterBody).filter)) drop({ code: 'ref_unknown_kept', id, body: 'filter', old: (b as FilterBody).filter })
        // 文字（位置／缩放／旋转／不透明度）、滤镜（强度）关键帧
        const isPin = (p: string) => p.startsWith('pin.')
        kfOk = body === 'text' ? (p) => TEXT_ONLY_KF.has(p) || isPin(p) : body === 'sticker' ? isPin : body === 'filter' ? (p) => p === 'flt' : () => false
        const kf = body === 'program' ? undefined : pickKf(parseKf(c.kf), kfOk)
        if (kf) clip.kf = kf
        // 四角透视：文字／贴纸也能套（look 只收 pin）
        if (body === 'text' || body === 'sticker') { const pin = parseLook(c.look)?.pin; if (pin) clip.look = { pin } }
        if (body === 'text' || body === 'sticker') { const fo = parseFollow(c.follow); if (fo) clip.follow = fo } // 运动跟踪：跟随
        // 贴纸动画：入场／出场／循环存在片段身上（同画面片段 anim）
        if (body === 'sticker') { const anim = animOf(c.anim, id); if (anim) clip.anim = anim }
      }
      // 父子连结（指不指得到最后才验·fixParents）·3D·表达式（只收这段能打关键帧的那几项＋3D 项）
      for (const p of parseRigFields(c, clip, kind, kfOk).badExpr) drop({ code: 'expr_bad', id, body: p })
      if (c.disabled === true) clip.disabled = true
      if (typeof c.group === 'string' && ID_RE.test(c.group)) clip.group = c.group //
      const prev = clips[clips.length - 1]
      if (prev && prev.start + prev.length > start + 1e-6) { drop({ code: 'clip_overlap', id }); continue }
      clipIds.add(id)
      clips.push(clip)
      if (typeof c.group === 'string' && c.group && !ID_RE.test(c.group)) {
        const members = legacyGroups.get(c.group) ?? []
        members.push(clip); legacyGroups.set(c.group, members)
      }
    }
    const lane: Lane = { id: l.id, kind, clips, locked: l.locked === true, hidden: l.hidden === true, muted: l.muted === true }
    // 时间尺上的标记存在主轨（旧档没有这栏 ⇒ 照常开·没标记）
    const marks = l.id === MAIN_LANE ? parseMarkers(l.markers) : null
    if (marks) lane.markers = marks
    tracks.push(lane)
  }
  // 父子连结：父层指不到／不能当父层 ⇒ 拿掉；绕成圈 ⇒ 拿掉形成圈那段的连结（片段本身照留）
  for (const x of fixParents(tracks)) drop({ code: x.loop ? 'parent_loop' : 'parent_bad', id: x.id, old: x.old })
  // 相容 d67a5ce2 生成的 copy-group:<副本id>[:正整數]：固定副本必須真的在同一原組。
  // 只換編號、不猜或合併成員；先保留全部合法組，碰名另取短尾碼。已丟失 group 的檔不補猜。
  const usedGroups = new Set(tracks.flatMap((l) => l.clips.flatMap((c) => c.group ? [c.group] : [])))
  for (const [old, members] of [...legacyGroups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const anchor = legacyCopyGroupAnchor(old)
    if (!anchor || !members.some((c) => c.id === anchor)) {
      drop({ code: 'group_bad', ids: members.map((c) => c.id).join('、') })
      continue
    }
    const group = unusedCopyGroupId(anchor, usedGroups)
    usedGroups.add(group)
    for (const c of members) c.group = group
    drop({ code: 'group_renamed', old, group })
  }
  // 一定有主轨（缺 ⇒ 补在上区最下面＝旧档的位置）。：上区（非音频的各种轨·含主轨）在前、音频区在后；
  // 上区里谁上谁下照档里原顺序（叠层自由·主轨也不必在区界）；音频轨排进上区的挪到下面（各区照原顺序）。旧档主轨本来就在区界 ⇒ 读出来一样。
  const upperEnd = () => tracks.reduce((n, l, i) => (l.kind !== 'audio' ? i : n), -1)
  if (!tracks.some((l) => l.id === MAIN_LANE)) tracks.splice(upperEnd() + 1, 0, { id: MAIN_LANE, kind: 'visual', clips: [], locked: false, hidden: false, muted: false })
  const lastUpper = upperEnd()
  tracks.forEach((l, i) => { if (l.kind === 'audio' && i < lastUpper) drop({ code: 'lane_moved_audio', id: l.id }) })
  // 主轨钉在上区最底下（紧贴音频区）
  const upperNoMain = tracks.filter((l) => l.kind !== 'audio' && l.id !== MAIN_LANE)
  const ordered = [...upperNoMain, ...tracks.filter((l) => l.id === MAIN_LANE), ...tracks.filter((l) => l.kind === 'audio')]
  // 轨道遮罩指定的片段要在同一份轨道里（上区·不是自己那条轨）·指不到 ⇒ 拿掉遮罩
  for (const l of ordered) for (const c of l.clips) {
    const mc = c.look?.matte?.clip
    if (!mc) continue
    const src = ordered.find((y) => y.clips.some((z) => z.id === mc))
    if (src && src.id !== l.id && src.kind !== 'audio' && src.kind !== 'filter' && src.kind !== 'program') continue
    const { matte: _m, ...look } = c.look!
    void _m
    if (Object.keys(look).length) c.look = look; else delete c.look
    drop({ code: 'matte_bad_ref', id: c.id, old: mc })
  }
  return ordered
}

const cloudProxyPart = (m: { cloudProxy?: CloudProxy; driveId?: string }) => { const c = parseCloudProxy(m.cloudProxy, m.driveId); return c ? { cloudProxy: c } : {} }
/** 页面现况 ⇒ 要存的工程档（只存用到或在素材区的素材·暂时栏位不进档） */
export function buildProject(p: { ratio: RatioSel; tracks: Tracks; media: ReadonlyArray<{ id: string; name: string; kind: ProjectMediaKind; duration: number; from: 'local' | 'drive'; driveId?: string; noPicture?: boolean; stems?: string[]; stemOf?: string; cloudProxy?: CloudProxy }>; programs?: Record<string, ProjectProgram>; comps?: Comps }): VeditProject {
  return {
    v: VEDIT_PROJECT_VERSION,
    ratio: p.ratio,
    tracks: p.tracks,
    media: p.media.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.duration, from: m.from, ...(m.driveId ? { driveId: m.driveId } : {}), ...(m.noPicture ? { noPicture: true } : {}), ...(m.stems?.length ? { stems: [...m.stems] } : {}), ...(m.stemOf ? { stemOf: m.stemOf } : {}), ...cloudProxyPart(m) })),
    programs: p.programs ?? {},
    ...(p.comps && Object.keys(p.comps).length ? { comps: p.comps } : {}),
  }
}

/** 库函数回了错：PostgREST 真的回了一个带错误码的回包（交易确定回滚了）⇒ true；
 *  传输失联／回包丢失（code 空、status 0、闸道 5xx 没码）⇒ false＝结果不明（可能已提交）。
 *  补审 F2／F3：存档口只有「确定没写」才做清理（删新物件／删资料夹）；结果不明 ⛔ 删（宁留孤物件·⛔ 删到已提交的）。 */
export function dbErrorDefinite(r: { error?: { code?: unknown } | null; status?: unknown }): boolean {
  const code = r.error?.code
  return typeof code === 'string' && code.length > 0 && typeof r.status === 'number' && r.status >= 400
}

/** 两份工程档内容一不一样（自动存只在真的变了才送） */
export const sameProject = (a: VeditProject, b: VeditProject): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 角色读档时一并给的使用说明（工具回包带着·角色照这个写） */
export const PROJECT_SCHEMA_HINT = [
  'Project JSON: { v:1, ratio:{kind:"fit"}|{kind:"preset",key:"16:9"|"4:3"|"2.35:1"|"2:1"|"1.85:1"|"9:16"|"3:4"|"5.8in"|"1:1"|"1:2"}|{kind:"custom",w,h}, tracks:[lane…], media:[media…], programs:{} }.',
  'lane = { id, kind:"visual"|"audio"|"text"|"sticker"|"filter"|"program", clips:[clip…], locked, hidden, muted }; lanes are top→bottom, the lane with id "main" must exist, audio lanes go below it and every other kind above it. The main lane may also carry markers:[sec…] = flags on the time ruler (sorted, frame-aligned).',
  'clip = { id, start(sec), length(sec), offset(sec into the source), mediaId? , volume?, muted?, disabled?, text?{content,x,y,size,fancy?}, sticker?{sticker,x,y,size}, filter?{filter,strength}, program?{pkg,version,params} }; clips in one lane must not overlap. Sticker clips may also carry anim?{in?,out?,loop?:{id,dur}} (same ids as clip animations).',
  'text may also carry (all optional, omit = follow the fancy style): font:"sans"|"serif"|"mono", bold, italic, underline, color:"#rrggbb", letterSpacing(em -1..2), lineSpacing(em 0..2), align:"left"|"center"|"right", scale(0.1..5, multiplies size), rotate(deg), opacity(0..1), stroke:{color:"#rrggbb",width(em 0.003..0.3)}, bg:{color:"#rrggbb",opacity 0..1}; content may contain \\n for several lines. Text anim?{in?,out?,loop?:{id,dur,stagger?}}: per-letter ids in-pc-*/out-pc-* (fade, spin, fold, standup, pop; each letter flips in 3D) play letter by letter, dur = whole span, stagger = seconds between letters 0..1 (default automatic: dur × 0.7 ÷ letters, within 0.03..0.5).',
  'Visual lanes may also hold shape clips {id,start,length,offset:0,shape:{shape:"rect"|"ellipse"|"arrow"|"line",stroke:"#rrggbb",width(stroke width, fraction of frame height 0.002..0.1),fill?:"#rrggbb"(rect/ellipse; absent = no fill),radius(rect corner, fraction of short side 0..0.5),w,h(box size, fraction of frame width/height; centred),grow?(sec of the stroke-grow entrance: outline drawn from start to end)}} and solid-colour clips {id,start,length,offset:0,solid:{color:"#rrggbb"}} (fills the whole frame) and animated-background clips {id,start,length,offset:0,bgfx:{kind:"stars"(twinkling star particles drifting slowly)|"bokeh"(soft light blobs drifting),color:"#rrggbb"(particle colour),bg:"#rrggbb"(background),density 0..1,speed 0..2(0 = still),seed(integer; same seed = same picture),parallax?:true(whole layer slowly pans/zooms)}}; all three have no mediaId and may carry look?{x,y,sx,sy,uniform,rot,opacity}, kf? on those props and anim? like picture clips. ',
  `On video/image clips of visual lanes: fx?:[{fx,strength 0..1}] = effects on the clip (max 4); transIn?:{tr,length sec 0.2..3} = transition on the seam with the previous clip (that clip ends exactly where this one starts); if no clip ends there (e.g. the first clip) it is an opening transition: the clip comes in from black over its first length seconds. Effect ids: ${FX_ITEMS.filter((x) => x.kind === 'effect').map((x) => `${x.id}(${x.name.cn})`).join(' ')}. Transition ids: ${FX_ITEMS.filter((x) => x.kind === 'transition').map((x) => `${x.id}(${x.name.cn})`).join(' ')}.`,
  'Video/audio clips may also carry: speed?(0.1..100, source seconds per timeline second; length is timeline length, so a 10s source at speed 2 has length 5), pitch?(true = pitch follows speed), fadeIn?/fadeOut?(sec of audio fade). Visual clips may carry look?{sx,sy(scale, 1=100%),uniform?(false=non-uniform),x,y(offset from centre as a fraction of canvas width/height, y up),rot(deg),blend?:"normal"|"darken"|"multiply"|"color-burn"|"lighten"|"screen"|"color-dodge"|"overlay"|"soft-light"|"hard-light"|"difference"|"exclusion",opacity(0..1),mask?{shape:"linear"|"mirror"|"circle"|"rect"|"star"|"heart"|"pen"|"stripes",x,y,w,h,rot,feather 0..100,radius 0..100,invert; stripes: count 1..60,gap 0..0.95,progress 0..1 (keyframe mask.progress = blinds reveal, bands open one after another),stagger 0..1,ease:"linear"|"in"|"out"|"inout"; angle=rot},masks?[mask,...](2..8 masks; when present mask = masks[0] for older readers; keyframes mask.* drive masks[0]),maskOp?:"and"|"or"(combine several masks: and=intersection default, or=union),matte?{clip?(id of a clip on another upper lane of the same timeline: video/image/shape/composition/text/sticker),lane?(text/sticker/visual lane id; default nearest text/sticker lane above),mode:"alpha"|"luma",invert?,show?}(track matte: clip shows only through that clip/lane at the same moment — alpha = its shape, luma = its brightness, invert = cut it out instead; the matte layer is not drawn itself while used unless show:true; if the named clip is not on screen at that moment nothing shows through (inverted: everything shows); blend modes also composite with text layers below),adj?{temp,tint,sat,vib,bright,contrast,highlight,shadow,white,black,light,vignette: -100..100; sharpen,clarity,grain,fade: 0..100}} and anim?{in?,out?,loop?:{id,dur}} (same ids as text animations, except typewriter ones). ' +
    'Video/audio clips may carry kf?{<prop>:[{t,v,e?}]} keyframes: t = source-media seconds (same unit as offset), v = value, e = ease of the segment to the next key ("linear"|"in"|"out"|"inout"|"in2"|"out2"|"inout2"|"backIn"|"backOut"|"hold" or bezier handles [x1,y1,x2,y2]); props: sx,sy,x,y,rot,opacity, mask.x|y|w|h|rot|feather|radius, adj.<adjust key>, vol (dB, -40 = mute; audio too); text clips: tx,ty (centre 0..1), ts (scale), trot (deg), top (opacity 0..1); filter clips: flt (strength 0..1). ' +
    'Visual (video) clips may carry mtrack?:[{id,pts:[[srcSec,x,y,scale],...](motion-tracking path computed in the editor; x/y = tracked centre as fraction of output frame; scale relative to the start box),w,h}]; text/sticker clips may carry follow?:{clip(video clip id),track(mtrack id),at(srcSec of the path at bind time)} = the whole text/sticker layer moves (and scales about the tracked point) with that path; content/style stay editable; remove follow to stop following (command clip.followTrack). ' +
    'Visual clips may carry mosaic?:[{id,pts:[[srcSec,x,y],...](user-recorded tracking path; x/y = centre as fraction of output frame; srcSec = media seconds like keyframes),shape:"rect"|"round"|"ellipse",mode:"pixel"|"blur"|"solid",w,h(box size as fraction of frame width/height),strength(1..100),color:"#rrggbb"(solid)}] = tracked censoring boxes applied on the composited frame; change style fields freely, keep pts unless asked; to move/scale the whole path edit pts; points >2s apart are treated as a break (box hidden between). ' +
    'Video/audio clips may carry aud?{denoise?(0..100),norm?:true(loudness normalize),semi?(-12..12 pitch shift without speed change),chan?:"left"|"right"|"mono"|"swap",sfx?:"echo"|"hall"|"phone"|"radio"|"robot"|"underwater"|"megaphone"}. ' +
    'reverse?:true = play backwards (source range offset..offset+length*speed, from its end to its start); freeze?:true = freeze frame (whole clip shows the source frame at offset, no sound; visual lanes only). ' +
      'Filter lanes may also hold adjustment layers: {id,start,length,offset:0,adjust:true,look?{adj?,hsl?,curves?,wheels?,lut?}} (graded onto every visual lane below during that time; adj sharpen/clarity/grain/vignette do not apply there). ' +
      'Visual clip look may also carry hsl?{red|orange|yellow|green|cyan|blue|purple|magenta:{h?,s?,l?(-100..100)}}, curves?{rgb?|r?|g?|b?:[[in 0..1,out 0..1],...]}, wheels?{lift?|gamma?|gain?|offset?:{x,y(point in unit disc, angle=hue),l(-100..100)}}, lut?{id:"teal-orange"|"film"|"kodak"|"bleach"|"mono"|"vintage"|"cool"|"warm"|"cyber"|"matte",strength 0..100}, key?{color:"#rrggbb",sim,soft,spill 0..100} (chroma key), corner?(0..100 rounded corners), shadow?{color,opacity,blur,dist(0..100),angle(deg)}; mask shape may be "pen" with pts:[[x,y] in -0.5..0.5 of mask box],sharp?. ' +
      'Video/image clips on visual lanes may carry look.mblur?{amount 0..100 (shutter / trail length), blend 0..100, passes 1..4, mode?:"frames"|"dir"} = motion blur: "frames" = each frame blended with the previous frames (video only; default for video when mode is absent); "dir" = directional shutter blur along the clip\'s current position/scale keyframe motion (video or image; default for images); only shows when the picture moves. ' +
      'Video/image clip look may also carry glow?{color:"#rrggbb",radius 1..100,strength 1..100} (outer glow), border?{color:"#rrggbb",width 1..100} (inner border following crop + rounded corners), rot3d?{x,y(deg -80..80),d(perspective distance in frame heights 0.5..10)} = 3D rotation helper remembered by the panel; what renders is look.pin (rot3d is converted into the four pin corners — when setting rot3d also set pin, or use command clip.setRotateXY). ' +
      'Visual clips (video/image/text/sticker) may carry look.pin?{x0,y0,x1,y1,x2,y2,x3,y3} = corner pin (perspective warp of the whole rendered layer): offset of each frame corner (0 top-left,1 top-right,2 bottom-right,3 bottom-left) as a fraction of frame width/height, y down, -2..2; absent = no warp; keyframe props pin.x0..pin.y3. ' +
      'Visual clip look may also carry flipH?/flipV?:true (mirror), crop?{l,t,r,b} (fraction of the source cut from each side, 0..0.9), bg?{kind:"color",color:"#rrggbb"}|{kind:"blur",amount:1..4} (fill behind the clip where it does not cover the frame). ' +
      'curve?{id:"custom"|"montage"|"hero"|"bullet"|"jump"|"flashIn"|"flashOut",pts:[[x 0..1 of clip length, speed 0.1..10],...]} = curve speed (replaces speed; length = source seconds / average speed).',
  'Rig (AE-style null / parenting / expressions / 3D): visual lanes may hold rig clips {id,start,length,offset:0,rig:{kind:"null"}|{kind:"camera",x,y,z,tx,ty,tz,fov(5..150 vertical deg, default 40),aperture?(0..100 depth of field),focus?(distance)}|{kind:"light",light:"parallel"|"point"|"spot"|"ambient",color:"#rrggbb",intensity(0..10, 1=100%),x,y,z,tx,ty,tz(target),cone(1..170 deg, spot),feather(0..100)}} — they draw nothing (preview shows a null as a dashed box); a null carries look{x,y,sx,sy,uniform,rot,opacity}, kf and anim like a shape; camera kf props cam.x|y|z|tx|ty|tz|fov, light kf props lt.int|x|y|z. Camera/light positions are in frame heights, origin = frame centre, y up, z + = into the picture; the default camera (no camera clip) sits at z = -0.5/tan(20°) ≈ -1.3737 so depth 0 looks exactly 2D; the topmost lane\'s camera covering the time wins. ' +
    'Any video/image, shape/solid/bgfx, text, sticker or null clip may carry parent:"<clip id>" (+ parentAlpha?:true): the parent\'s position/scale/rotation at that moment (base + keyframes + expressions + clip anim) cascade to it through the chain, relative to the parent at rest; cameras/lights may have a parent but cannot be one; loops and missing parents are dropped on load. ' +
    'The same clips may carry d3:{z?,rx?,ry?,rz?} (present = 3D layer; z frame heights + = farther; rx + = bottom edge away, ry + = right edge away, rz clockwise; kf props d3.z|rx|ry|rz): rendered as a flat card in 3D through the camera with perspective, consecutive 3D layers sorted far-to-near, shaded by lights (simplified Lambert, per layer; no lights = unlit). ' +
    'Any keyframable property may carry an expression: expr:{<prop>:"<expression>"} (max 1000 chars; sandboxed: numbers, arithmetic, comparisons, ?:, var/let/const; names time, value, thisClip, clip("id"), Math.*; functions wiggle(freq,amp,oct?,mult?,t?), loopOut("cycle"|"pingpong",n?), linear/ease/easeIn/easeOut(t,tMin,tMax,v1,v2), clamp, noise; clip handles .start .length .end .offset and property names e.g. clip("a").x, .prop("d3.z", t?)); on an error that moment falls back to the keyframed/base value.',
  'Nested compositions (precomps): top-level comps?{<compId>:{name,ratio(same shapes as the project ratio; {kind:"fit"} = same as the parent frame),length?(sec; default = end of its last clip),tracks:[lane…](same rules as the main tracks, needs its own "main" lane)}}. A clip on a visual lane with comp:"<compId>" and no mediaId places that composition like a video clip: start/length/offset(sec into the composition)/speed/reverse/freeze/look/kf/anim/fx/transIn/matte all apply; areas the composition does not cover are transparent. Compositions may contain composition clips of other compositions but never themselves (directly or through others: such clips are dropped on load). Clip ids are unique across the whole project. Sound inside a composition is mixed into the export when the composition clip has normal speed. ',
  'Program clips (program lanes): program:{pkg, version, params:{<key>:value}} = an animated overlay drawn by a program package (HTML/canvas in a sandbox, transparent background); pkg = a built-in id (b-title-pop) or a key of programs; programs = {"u-<8..64 letters, digits or ->": {manifest:{name, version, defaultLength, params:[{key, label, type:"text"|"color"|"number"|"select"|"bool", default, min?, max?, options?}]}, html (sets window.dilinProgram = {render(t, params, size)})}} — embedded packages, at most 4 MB together. To put a program animation in, use video_edit_run step by step: program.define (register manifest + html) then program.add (place it; params checked against the manifest, numbers clamped), program.update (change params) — do not rewrite the whole project for it.',
  'media = { id, name, kind:"video"|"audio"|"image", duration(sec, 0 if unknown), from:"local"|"drive", driveId?, cloudProxy? (editor-managed small editing copy made from driveId — keep it as is; it is dropped automatically if you point driveId elsewhere) }; to use a Drive file add { id:<new id>, from:"drive", driveId:<drive file id>, kind, name, duration } and reference it by mediaId.',
  'Pass base_updated_at from get_video_edit to update_video_edit so you never overwrite the user\'s newer edits; the editor shows your change within ~2 seconds.',
].join('\n')

/** 剪辑工程档那行的头（三语·＝ projectCtxLine 写的字面头）：AI 编辑保护遮罩认「这句话在改哪份工程档」用 */
export const PROJECT_CTX_HEADS: readonly string[] = ['【正在編輯剪輯工程檔·id=', '【正在编辑剪辑工程文件·id=', '[Editing video edit project file · id=']
/** 从发话正文认出剪辑工程档那行 ⇒ 档号（小写 uuid）；没有那行／档号不像 uuid ⇒ null（⛔ 猜）。同一句里剪辑页那行（id=video-edit）不算档。 */
export function parseProjectCtxLine(text: string): string | null {
  if (!text) return null
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    const head = PROJECT_CTX_HEADS.find((h) => l.startsWith(h))
    if (!head) continue
    const m = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?=\s?·|\]|】)/.exec(l.slice(head.length))
    return m ? m[1].toLowerCase() : null
  }
  return null
}

/** 带给角色的那行（剪辑页开着一份工程档时·接在剪辑页那行下面）：哪一份、用哪两支工具读改、改了使用者即时看到 */
export function projectCtxLine(lang: 'zh-TW' | 'zh-CN' | 'en', id: string, title: string): string {
  const t = title.replace(/[\n【】[\]·]/g, ' ')
  // 头照「【正在編輯…·id=…】」三样认行（lib/editor-agent isEditingContextLine）⇒ 气泡上藏·只给角色看
  // 一步一步改（不一次整份换掉）：改用逐条命令·一次只送一两步 ⇒ 剪辑页每 2 秒拉一次就一步一步看得到；整份写回只留给命令做不到的
  if (lang === 'en') return `[Editing video edit project file · id=${id} · "${t}" (.dvedit in their drive) · read it with get_video_edit (or timeline.list in video_edit_run) and change it with video_edit_run, one or two steps per call so the user sees each step (the editor shows each change within ~2 s) · use update_video_edit (whole project, pass base_updated_at) only for what no command covers]`
  if (lang === 'zh-CN') return `【正在编辑剪辑工程文件·id=${id}·「${t}」（云盘里的 .dvedit）·用 get_video_edit 读（或 video_edit_run 的 timeline.list）·用 video_edit_run 一次一两步地改（用户看得到每一步·剪辑页约 2 秒内就跟上）·命令做不到的才用 update_video_edit 整份写回（带 base_updated_at）】`
  return `【正在編輯剪輯工程檔·id=${id}·「${t}」（雲端硬碟裡的 .dvedit）·用 get_video_edit 讀（或 video_edit_run 的 timeline.list）·用 video_edit_run 一次一兩步地改（使用者看得到每一步·剪輯頁約 2 秒內就跟上）·命令做不到的才用 update_video_edit 整份寫回（帶 base_updated_at）】`
}
