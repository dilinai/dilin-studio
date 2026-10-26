// 网页剪辑页·命令表（提案「剪辑页底下做成一套命令」·；第一期＝服务端）。
// 剪辑页现有动作收成一张命令表：每条有编号（clip.add…）、英文说明、参数型别／范围、可用条件（轨道锁了 ⇒ 白话拒）。
// 剪辑命令表：一批命令改一份剪辑工程（不必整份 JSON 重写）。网站的 video_edit_run、单机版本机 MCP 的 video_run、tools/video-cli.mjs 都用这一张。
// 做法：每条命令都直接调页面同一支纯函数（timeline.pure 的 appendMedia／planDrop／applyDrop／moveClip／trimClip／splitClip／removeClips…、
//   文字 applyTextPatch、动画、贴纸、滤镜、特效转场、比例、标记）·新片段／新轨编号同页面用 randomUUID ⇒ 命令做的＝人手在页面上做的。
// 规矩：
//   · 一批全有或全无：哪一步不合（参数错、片段不在、轨道锁了…）⇒ 整批不算·回第几步、白话原因（教角色怎么改）；
//   · 后面的步骤可用 "$<步号>"（0 起）指前面某步新建的编号（"$0"＝那步建的片段／轨；"$0.lane"＝那步片段落在哪条轨）；
//   · 时间一律秒·对齐到帧格（snapFrame）；
//   · 整批跑完：空了的非主轨收掉（同页面 pruneLanes）·再过 parseProject——会被丢掉或改值的 ⇒ 整批不算（存进去的＝这里算出来的）。
//   · 不过主轨磁吸（页面那颗是各人本机偏好·角色写的远端版页面也不磁吸·见 page.tsx commitRemoteTracks）。
// 本档只放纯函数（题直接跑·服务端与以后页面共用）。⛔ 碰 DOM／库。
import {
  IMAGE_DEFAULT_SECONDS, MAIN_LANE, MIN_CLIP, SPEED_MAX, SPEED_MIN, VOL_MAX,
  appendMedia, applyDrop, audioStart, canDetach, detachAudio, findClip, hasSound, laneControls, laneKindFor, mainIndex, moveClip, moveLane, newLane, pinMain, planDrop,
  pruneLanes, removeClips, replaceMedia, setClipVolume, setLaneFlag, snapFrame, splitAtPlayhead, splitClip, srcAt, timeOfSrc, timelineEnd, toggleClipFlag, trimClip,
  type Lane, type LaneKind, type MediaKindLike, type TextAnimSlot, type TlClip, type Tracks,
} from './timeline.pure'
import { VEDIT_PROGRAMS_EMBED_MAX, parseProject, type ProjectMedia, type ProjectMediaKind, type ProjectProgram, type VeditProject } from './project.pure'
import { l10n, newProgramClip, optValue, paramValue, parseManifest, type ProgramBundle, type ProgramManifest, type ProgramParamValue } from './program.pure' // 程序片段
import { BUILTIN_PROGRAMS, builtinProgram } from './programs.data'
import { PROJECT_ID_RE } from './id.pure'
import { TEXT_DEFAULT_SECONDS, TEXT_SIZE_MAX, TEXT_SIZE_MIN, fancyById, newTextClip } from './text.pure'
import { BG_SHAPES, LETTER_SPACING_MAX, LETTER_SPACING_MIN, LINE_SPACING_MAX, SCALE_MAX, SCALE_MIN, SHADOW_BLUR_MAX, SHADOW_DIST_MAX, STROKE_W_MAX, STROKE_W_MIN, TEXT_ALIGNS, TEXT_CONTENT_MAX, TEXT_FONTS, applyTextPatch, patchTexts, type TextPatch } from './text-style.pure'
import { ANIM_DUR, ANIM_LIB, ANIM_SLOTS, STAGGER, animDef } from './text-anim.pure'
import { SHAPE_DEFAULT_SECONDS, SHAPE_GROW_MAX, SHAPE_KINDS, SHAPE_WIDTH_MAX, SHAPE_WIDTH_MIN, SOLID_DEFAULT_SECONDS, addBackgroundAt, newBgfxClip, newShapeClip, newSolidClip, parseShape, patchBgfx, patchSolid, type ShapeKind } from './shape.pure'
import { BGFX_DEFAULT_SECONDS, BGFX_KINDS, BGFX_SEED_MAX, parseBgfx, type BgfxBody, type BgfxKind } from './bgfx.pure' // 动态背景
import { PUSH_DUR_MAX, PUSH_DUR_MIN, applyPushBox } from './push-box.pure' // 推到框
import { STICKER_DEFAULT_SECONDS, STICKER_SIZE_MAX, STICKER_SIZE_MIN, moveSticker, newStickerClip, resizeSticker, setStickerAnim, stickerById } from './sticker.pure'
import { STICKERS } from './stickers.data'
import { FILTER_DEFAULT_SECONDS, filterById, newFilterClip, setFilterStrength } from './filter.pure'
import { FILTERS } from './filters.data'
import { FANCY_TEXTS } from './fancy-text.data'
import { FX_ITEMS } from './fx.data'
import { FX_MAX_PER_CLIP, TRANS_MAX, TRANS_MIN, addEffect, decoratable, fxById, removeEffect, removeTransition, setEffectStrength, setTransition, transLimit } from './fx.pure'
import { PIN_KEYS, PIN_LIM, ROT3D_D_MAX, ROT3D_D_MIN, ROT3D_DEFAULT, ROT3D_LIM, rot3dToPin } from './corner-pin.pure' // 四角透视＋3D 旋转
import { ratioOf } from './ratio.pure'
import { bindFollow, followChoices } from './motion-track.pure' // 运动跟踪
import { ADJ_KEYS, BLEND_MODES, DB_MAX, DB_MIN, FADE_MAX, MASK_SHAPES, POS_LIM, SCALE_MAX as LOOK_SCALE_MAX, SCALE_MIN as LOOK_SCALE_MIN, VISUAL_ANIM_LIB, adjRange, lookOf, patchClips, type AdjKey, type LookPatch } from './clip-look.pure'
import { MASKS_MAX, MASK_OPS, MATTE_KINDS, MATTE_MODES, STRIPE_COUNT_MAX, STRIPE_EASES, laneAbove, matteFromKind, matteKindOf, parseMatte, type ClipMatte, type MatteKind } from './mask-matte.pure' // 条纹／多蒙版／轨道遮罩
import { COMPS_MAX, COMP_NAME_MAX, compDuration, compRefs, compWouldCycle, precompose, type Comps, type VeditComp } from './comp.pure' // 巢状合成
import { EASE_PRESETS, KF_ADJ_KEYS, KF_MASK_KEYS, kfDrop, kfIndexAt, kfPut, normalizeKf, type Kf, type KfEase, type KfProp, type KfTracks } from './keyframe.pure'
import { canGroup, expandGroups, groupClips, pruneGroups, ungroupClips } from './group.pure'
import { addMarker, markersOf, removeMarker, MARKER_CAP } from './toolbar.pure'
import { CUSTOM_MAX, CUSTOM_MIN, RATIO_PRESETS, type RatioPresetKey, type RatioSel } from './ratio.pure'
import { isFontId } from '../../shared/fonts/catalog'
import { WEB_SHOT_THEMES, WEB_SHOT_WIDTH_DEFAULT, WEB_SHOT_WIDTH_MAX, WEB_SHOT_WIDTH_MIN, WEB_SHOT_MAX_CSS_HEIGHT, parseWebShotOpts, type WebShotOpts } from './web-shot.pure' // 网页截图
import { SFX_LIB, sfxById } from './sfx-lib.pure' // 内建音效 sfx.add
import { TTS_EMOTIONS, TTS_MAX_CHARS, TTS_VOICES, parseTtsReq, type TtsReq } from './tts-req.pure' // 朗读配音 media.tts（与网页朗读同一份验值）
import { CAM_PROPS, CONE_MAX, CONE_MIN, D3_PROPS, FOV_MAX, FOV_MIN, INTENSITY_MAX, LIGHT_KINDS, LT_PROPS, NULL_PROPS, POS3_LIM, RIG_DEFAULT_SECONDS, ROT3_LIM, canChild, canParent, can3d, exprPropsFor, newCameraClip, newLightClip, newNullClip, parentLoops, patchRigClip, propValue, type LightKind, type RigPatch } from './rig.pure' // 空物件／父子连结／3D 摄影机灯光
import { compileExpr, exprStatus, setExprScene } from './expr.pure' // 表达式

/** 一批最多几步（同画板 drawboard_batch） */
export const VEDIT_STEPS_MAX = 80
/** 一批最多几条 media.tts／几条 sfx.add（这几种要网站先做好，一批不收太多） */
export const TTS_PER_CALL = 3
export const SFX_PER_CALL = 10
/** 时间参数上限（秒·24 小时） */
const TIME_MAX = 24 * 3600
/** 素材长度还没量（duration 0）时修剪的素材尾当作这么长（不限往外拉·页面开档量好后照常） */
const UNKNOWN_SRC_SECONDS = 1e7
const EPS = 1e-6

// ── 型别 ──
/** source＝素材或合成编号（clip.add） */
export type ParamType = 'number' | 'integer' | 'string' | 'boolean' | 'clip' | 'clips' | 'lane' | 'media' | 'comp' | 'source' | 'program' | 'object' | 'strings' | 'array'
/** 参数说明（listCommands 原样给角色看）：enum＝只收这几个字；min／max＝范围（含两端）；nullable＝可给 null（拿掉／回默认） */
export type ParamSpec = { name: string; type: ParamType; required?: boolean; enum?: readonly string[]; min?: number; max?: number; nullable?: boolean; note: string }
export type CommandInfo = { id: string; description: string; params: ParamSpec[]; requires?: string; readOnly?: boolean }
export type CommandStep = { command: string; params?: Record<string, unknown> }
/** 每步结果：id＝这步新建的主编号（片段／轨／素材）·ids＝这步建或动到的全部片段·lane＝片段落在哪条轨·data＝唯读命令回的资料 */
export type StepResult = { step: number; command: string; id?: string; ids?: string[]; lane?: string; note?: string; data?: unknown }
export type RunResult = { ok: true; project: VeditProject; results: StepResult[]; changed: boolean } | { ok: false; step: number; command?: string; error: string }
/** webShots＝media.webShot 那几步网站先截好、存进云盘的结果（步号 ⇒ 云盘档）·命令层本身不出网（见 media.webShot） */
export type WebShotDone = { driveId: string; name: string; truncated?: boolean }
/** tts＝media.tts 那几步网站先合成（同编辑器的「朗读」）、存进云盘的 mp3（步号 ⇒ 云盘档·seconds＝配音长度·credits＝这条用了几点） */
export type TtsDone = { driveId: string; name: string; seconds: number; credits?: number }
/** sfx＝sfx.add 那几步网站先算成 WAV、存进云盘的结果（步号 ⇒ 云盘档） */
export type SfxDone = { driveId: string; name: string }
export type RunOpts = { newId?: () => string; webShots?: Readonly<Record<number, WebShotDone>>; tts?: Readonly<Record<number, TtsDone>>; sfx?: Readonly<Record<number, SfxDone>> }

type Args = Record<string, unknown>
/** tracks＝现在改的那一层（主时间轴或 comp.enter 进的那份合成）；root＝主时间轴（进合成时先存这里）；level＝在哪份合成里（null＝主时间轴）；comps＝全部子合成 */
type Ctx = { tracks: Tracks; root: Tracks; level: string | null; comps: Comps; ratio: RatioSel; media: ProjectMedia[]; programs: Record<string, ProjectProgram>; newId: () => string; step: number; webShots?: Readonly<Record<number, WebShotDone>>; tts?: Readonly<Record<number, TtsDone>>; sfx?: Readonly<Record<number, SfxDone>> }
type Out = { id?: string; ids?: string[]; lane?: string; note?: string; data?: unknown }
type Def = CommandInfo & { check?: (c: Ctx, a: Args) => string | null; run: (c: Ctx, a: Args) => Out }

/** 药（只在 node 测试跑）：DILIN_NEG 含 vedit_split_snap_at ⇒ timeline.split 退回先把时刻对齐帧格再判压到哪几段（命令化第二期前） */
const negSplitSnap = () => typeof window === 'undefined' && ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? '').split(',').includes('vedit_split_snap_at')

class CmdError extends Error {}
const fail = (msg: string): never => { throw new CmdError(msg) }

// ── 小工具 ──
const r3 = (v: number) => Math.round(v * 1000) / 1000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const HEX_RE = /^#[0-9a-f]{6}$/i
const DRIVE_ID_RE = /^[0-9a-f-]{36}$/i
const endOf = (c: TlClip) => c.start + c.length
const mediaOf = (c: Ctx, id: string) => c.media.find((m) => m.id === id)
const kindOf = (c: Ctx) => (mid: string): MediaKindLike | undefined => mediaOf(c, mid)?.kind
const isMediaClip = (x: TlClip) => !!x.mediaId && !x.text && !x.sticker && !x.filter && !x.program
/** 画面片段（影片／图片素材段或合成段）：外观、动画、四角透视、轨道遮罩都收 */
const isPicClip = (x: TlClip) => isMediaClip(x) || !!x.comp
/** 现在这一层存回去（主时间轴 ⇒ root；合成 ⇒ comps） */
function stashLevel(c: Ctx): void {
  if (c.level) c.comps = { ...c.comps, [c.level]: { ...c.comps[c.level], tracks: c.tracks } }
  else c.root = c.tracks
}
/** 换到另一层改（null＝主时间轴） */
function enterLevel(c: Ctx, id: string | null): void {
  stashLevel(c)
  c.level = id
  c.tracks = id ? c.comps[id].tracks : c.root
}
const compOf = (c: Ctx, id: string): VeditComp => c.comps[id] ?? fail(`composition "${id}" not found — list them with comp.list.`)
/** 合成段在哪几段（全工程：主时间轴与每份合成）用到这份合成 */
function compUsers(c: Ctx, id: string): string[] {
  stashLevel(c)
  const out: string[] = []
  for (const tr of [c.root, ...Object.values(c.comps).map((x) => x.tracks)]) for (const l of tr) for (const x of l.clips) if (x.comp === id) out.push(x.id)
  return out
}
/** 命令参数的比例（project.setRatio／comp.create 共用） */
const ratioArg = (a: Args): RatioSel | undefined => { const r = str(a, 'ratio'); return r === undefined ? undefined : r === 'fit' ? { kind: 'fit' } : r === 'custom' ? { kind: 'custom', w: num(a, 'width')!, h: num(a, 'height')! } : { kind: 'preset', key: r as RatioPresetKey } }
const ratioArgBad = (a: Args): string | null => {
  const custom = str(a, 'ratio') === 'custom', has = a.width !== undefined || a.height !== undefined
  if (custom && (a.width === undefined || a.height === undefined)) return 'ratio "custom" needs both width and height (pixels).'
  if (!custom && has) return 'width/height only go with ratio "custom".'
  return null
}
/** 片段是哪一种（白话错误里用） */
function clipKind(c: Ctx, x: TlClip): string {
  if (x.text) return 'text'
  if (x.sticker) return 'sticker'
  if (x.filter) return 'filter'
  if (x.program) return 'program'
  if (x.shape) return 'shape'
  if (x.solid) return 'solid colour'
  if (x.bgfx) return `animated background (${x.bgfx.kind})`
  if (x.rig) return x.rig.kind === 'null' ? 'null object' : x.rig.kind === 'camera' ? 'camera' : `light (${x.rig.light})`
  if (x.adjust) return 'adjustment layer'
  if (x.comp) return `composition clip ("${c.comps[x.comp]?.name ?? x.comp}")`
  return mediaOf(c, x.mediaId)?.kind ?? 'media'
}
const laneOf = (c: Ctx, id: string): Lane => c.tracks.find((l) => l.id === id) ?? fail(`lane "${id}" not found — list lanes with timeline.list.`)
const clipOf = (c: Ctx, id: string) => findClip(c.tracks, id) ?? fail(`clip "${id}" not found — list clips with timeline.list.`)
const lockedMsg = (l: Lane) => `lane "${l.id}" is locked — unlock it first with lane.setFlag {"lane":"${l.id}","flag":"locked","on":false}, or leave it alone.`
/** 片段要能改：在、所在轨没锁 */
function editableClip(c: Ctx, id: string) {
  const f = clipOf(c, id)
  if (f.lane.locked) fail(lockedMsg(f.lane))
  return f
}
const num = (a: Args, k: string) => a[k] as number | undefined
const str = (a: Args, k: string) => a[k] as string | undefined
const ids = (a: Args, k: string) => a[k] as string[]

/** 放一段新片段（文字／贴纸／滤镜／素材共用）：指定了轨且那段空着 ⇒ 就放那条；其余照页面拖进轨道的落点规划（被占 ⇒ 贴着新增一条） */
function place(c: Ctx, kind: LaneKind, clip: TlClip, at: number, laneId?: string): Tracks {
  const start = snapFrame(Math.max(0, at))
  if (laneId) {
    const l = laneOf(c, laneId)
    const free = !l.clips.some((x) => start < endOf(x) - EPS && start + clip.length > x.start + EPS)
    if (free) return applyDrop(c.tracks, { lane: l.id, at: c.tracks.indexOf(l), kind, start, length: clip.length }, clip, c.newId())
  }
  return applyDrop(c.tracks, planDrop(c.tracks, kind, laneId ? { lane: laneId } : null, start, clip.length), clip, c.newId())
}
/** 背景类（纯色、动态背景）：指定了轨照 place；没指定 ⇒ 放最底（addBackgroundAt·主轨被占那段挪上一条） */
function placeBackground(c: Ctx, clip: TlClip, at: number, laneId?: string): Out {
  if (laneId) return placed(c, place(c, 'visual', clip, at, laneId), clip.id)
  const r = addBackgroundAt(c.tracks, clip, at, () => c.newId())
  return placed(c, r.tracks, clip.id, r.moved ? `put at the bottom (main lane): ${r.moved} main-lane clip(s) overlapping it moved up one lane, times unchanged.` : undefined)
}
/** 指定的轨要是这种、没锁 */
function laneFits(c: Ctx, laneId: string | undefined, kind: LaneKind, what: string): void {
  if (!laneId) return
  const l = laneOf(c, laneId)
  if (l.kind !== kind) fail(`lane "${l.id}" is a ${l.kind} lane; ${what} go on ${kind} lanes — omit lane to let the editor pick, or use a ${kind} lane.`)
  if (l.locked) fail(lockedMsg(l))
}
/** 新片段放好后：回结果（落在哪条轨·实际起点） */
function placed(c: Ctx, tracks: Tracks, id: string, note?: string): Out {
  const f = findClip(tracks, id)!
  c.tracks = tracks
  return { id, ids: [id], lane: f.lane.id, data: { start: r3(f.clip.start), length: r3(f.clip.length) }, ...(note ? { note } : {}) }
}

/**（第 6 条「配乐 duration=0 没量过·clip.add 不带 length 会出问题」）：长度没量的影音——服务端不去量（要整档拉下来再解·
 *  大档／档头不带时长的 WebM 都不稳），一律白话说清楚：clip.add 要带 length；页面下次开档会量好。media.add／media.list 先提醒，clip.add 不带 length 照拒。 */
const UNKNOWN_LEN_NOTE = (what: string) => `length not measured yet for ${what} — give clip.add a length (seconds) for these, or pass duration to media.add if you know it; the editor page measures the real length the next time the project is opened in it.`

// 形状参数（shape.add／shape.update 共用）
const SHAPE_PARAMS: ParamSpec[] = [
  { name: 'stroke', type: 'string', note: 'Stroke colour #rrggbb (default #ff3b30)' },
  { name: 'width', type: 'number', min: SHAPE_WIDTH_MIN, max: SHAPE_WIDTH_MAX, note: 'Stroke width as a fraction of the frame height (default 0.012)' },
  { name: 'fill', type: 'string', nullable: true, note: 'Fill colour #rrggbb for rect/ellipse; omit or null = no fill' },
  { name: 'radius', type: 'number', min: 0, max: 0.5, note: 'Rect corner radius as a fraction of the short side' },
  { name: 'w', type: 'number', min: 0.01, max: 4, note: 'Box width as a fraction of the frame width' },
  { name: 'h', type: 'number', min: 0.01, max: 4, note: 'Box height as a fraction of the frame height (arrow/line: only the head size uses the stroke width)' },
  { name: 'grow', type: 'number', min: 0, max: SHAPE_GROW_MAX, note: 'Stroke-grow entrance seconds (0 = off)' },
]
const shapeArgs = (a: Args): Record<string, unknown> => Object.fromEntries(['stroke', 'width', 'fill', 'radius', 'w', 'h', 'grow'].filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, a[k]]))
// 动态背景参数（bgfx.add／bgfx.update 共用）
const BGFX_PARAMS: ParamSpec[] = [
  { name: 'color', type: 'string', note: 'Particle colour #rrggbb (stars default #ffffff, bokeh #ffc36b)' },
  { name: 'bg', type: 'string', note: 'Background colour #rrggbb (fills the frame under the particles)' },
  { name: 'density', type: 'number', min: 0, max: 1, note: 'How many particles 0..1 (default 0.5)' },
  { name: 'speed', type: 'number', min: 0, max: 2, note: 'Drift / twinkle speed 0..2 (0 = still; default 1)' },
  { name: 'seed', type: 'integer', min: 0, max: BGFX_SEED_MAX, note: 'Random seed: same seed = same picture (default 1)' },
  { name: 'parallax', type: 'boolean', note: 'Whole layer slowly pans and zooms a little' },
]
const bgfxArgs = (a: Args): Partial<BgfxBody> => Object.fromEntries(['color', 'bg', 'density', 'speed', 'seed', 'parallax'].filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, typeof a[k] === 'string' ? (a[k] as string).toLowerCase() : a[k]])) as Partial<BgfxBody>
const bgfxArgsBad = (a: Args): string | null => { for (const k of ['color', 'bg']) if (a[k] !== undefined && !HEX_RE.test(str(a, k) ?? '')) return `${k} must be #rrggbb (got "${str(a, k)}").`; return null }
// ── 参数说明的常用块 ──
const P = {
  clip: (note = 'Clip id (from timeline.list, or "$<step>" for a clip made earlier in this batch)'): ParamSpec => ({ name: 'clip', type: 'clip', required: true, note }),
  clips: (): ParamSpec => ({ name: 'clips', type: 'clips', required: true, note: 'One clip id or an array of clip ids ("$<step>" allowed)' }),
  lane: (required = false, note = 'Lane id (from timeline.list, or "$<step>" for a lane made earlier in this batch)'): ParamSpec => ({ name: 'lane', type: 'lane', required, note }),
  at: (required: boolean, note: string): ParamSpec => ({ name: 'at', type: 'number', required, min: 0, max: TIME_MAX, note }),
  length: (def: number): ParamSpec => ({ name: 'length', type: 'number', min: MIN_CLIP, max: TIME_MAX, note: `Seconds on the timeline (default ${def})` }),
  x: (): ParamSpec => ({ name: 'x', type: 'number', min: 0, max: 1, note: 'Centre x as a fraction of the frame width (0 left … 1 right; default 0.5)' }),
  y: (): ParamSpec => ({ name: 'y', type: 'number', min: 0, max: 1, note: 'Centre y as a fraction of the frame height (0 top … 1 bottom; default 0.5)' }),
}
const PRESET_KEYS = Object.keys(RATIO_PRESETS) as RatioPresetKey[]
/** 合成的比例参数（comp.create／comp.update） */
const COMP_RATIO_PARAMS: ParamSpec[] = [{ name: 'ratio', type: 'string', enum: ['fit', ...PRESET_KEYS, 'custom'], note: '"fit" = same frame shape as the timeline that uses it (default); a preset; or "custom" with width/height' },
      { name: 'width', type: 'integer', min: CUSTOM_MIN, max: CUSTOM_MAX, note: 'Pixels (ratio "custom" only)' }, { name: 'height', type: 'integer', min: CUSTOM_MIN, max: CUSTOM_MAX, note: 'Pixels (ratio "custom" only)' }]
const TEXT_STYLE_PARAMS: ParamSpec[] = [
  { name: 'content', type: 'string', note: `New text (\\n for line breaks; max ${TEXT_CONTENT_MAX} chars; empty is not allowed — delete the clip instead)` },
  { name: 'fancy', type: 'string', nullable: true, note: 'Fancy text style id (catalog.list kind "fancy"); null = plain white text' },
  P.x(), P.y(),
  { name: 'size', type: 'number', min: TEXT_SIZE_MIN, max: TEXT_SIZE_MAX, note: 'Text height as a fraction of the frame height (default 0.1)' },
  { name: 'font', type: 'string', nullable: true, note: '"sans", "serif", "mono" or a site font id; null = follow the style' },
  { name: 'bold', type: 'boolean', nullable: true, note: 'null = follow the style' },
  { name: 'italic', type: 'boolean', nullable: true, note: 'null = follow the style' },
  { name: 'underline', type: 'boolean', nullable: true, note: 'Underline' },
  { name: 'color', type: 'string', nullable: true, note: 'Fill colour "#rrggbb" (replaces the style\'s fill); null = style fill' },
  { name: 'letterSpacing', type: 'number', nullable: true, min: LETTER_SPACING_MIN, max: LETTER_SPACING_MAX, note: 'Extra letter spacing in em' },
  { name: 'lineSpacing', type: 'number', nullable: true, min: 0, max: LINE_SPACING_MAX, note: 'Extra line spacing in em' },
  { name: 'align', type: 'string', nullable: true, enum: TEXT_ALIGNS, note: 'Alignment of several lines (default center)' },
  { name: 'scale', type: 'number', nullable: true, min: SCALE_MIN, max: SCALE_MAX, note: 'Scale (multiplies size)' },
  { name: 'rotate', type: 'number', nullable: true, min: -360, max: 360, note: 'Rotation in degrees, clockwise' },
  { name: 'opacity', type: 'number', nullable: true, min: 0, max: 1, note: 'Opacity' },
  { name: 'stroke', type: 'object', nullable: true, note: `Outline {color:"#rrggbb", width: ${STROKE_W_MIN}..${STROKE_W_MAX} em}` },
  { name: 'bg', type: 'object', nullable: true, note: `Background box {color:"#rrggbb", opacity?: 0..1, shape?: ${BG_SHAPES.map((s) => `"${s}"`).join('|')}}` },
  { name: 'shadow', type: 'object', nullable: true, note: `Shadow {color:"#rrggbb", opacity?: 0..1, angle?: 0..360 (0 = right, 90 = down), dist?: 0..${SHADOW_DIST_MAX} em, blur?: 0..${SHADOW_BLUR_MAX} em}` },
  { name: 'glow', type: 'object', nullable: true, note: 'Glow {color:"#rrggbb", strength: 0.01..1}' },
  { name: 'vertical', type: 'boolean', nullable: true, note: 'Vertical writing (one character per line)' },
]
const ANIM_PARAMS = (lib: string): ParamSpec[] => [
  { name: 'slot', type: 'string', required: true, enum: ANIM_SLOTS, note: '"in" (entrance), "out" (exit) or "loop"' },
  { name: 'anim', type: 'string', required: true, nullable: true, note: `Animation id (catalog.list kind "anim-in" / "anim-out" / "anim-loop"${lib}); null = remove that slot` },
  { name: 'dur', type: 'number', min: ANIM_DUR.in.min, max: ANIM_DUR.loop.max, note: `Seconds (in/out ${ANIM_DUR.in.min}..${ANIM_DUR.in.max}, default ${ANIM_DUR.in.def}; loop = one cycle ${ANIM_DUR.loop.min}..${ANIM_DUR.loop.max}, default ${ANIM_DUR.loop.def})` },
]

/** 套一款动画时的秒数：给了照给的（夹那一格的范围要报错）·没给 ⇒ 这格原本的秒数·再没有 ⇒ 默认 */
function animDur(slot: TextAnimSlot, dur: number | undefined, cur: number | undefined): number {
  const r = ANIM_DUR[slot]
  if (dur === undefined) return cur ?? r.def
  if (dur < r.min - EPS || dur > r.max + EPS) fail(`dur for "${slot}" must be between ${r.min} and ${r.max} seconds (got ${dur}).`)
  return dur
}

// ── 文字属性：逐栏验值（范围外报错·⛔ 默默夹）⇒ TextPatch ──
function textPatchOf(a: Args): TextPatch {
  const p: Record<string, unknown> = {}
  for (const s of TEXT_STYLE_PARAMS) if (a[s.name] !== undefined) p[s.name] = a[s.name]
  if (typeof p.content === 'string') { const t = p.content.trim(); if (!t) fail('content must not be empty — delete the clip with clip.delete instead.'); if (t.length > TEXT_CONTENT_MAX) fail(`content is longer than ${TEXT_CONTENT_MAX} characters.`) }
  if (typeof p.fancy === 'string' && !fancyById(p.fancy)) fail(`unknown fancy style "${p.fancy}" — see catalog.list {"kind":"fancy"}.`)
  if (typeof p.font === 'string' && !TEXT_FONTS.includes(p.font as never) && !isFontId(p.font)) fail(`unknown font "${p.font}" — use "sans", "serif", "mono" or a site font id.`)
  if (typeof p.color === 'string' && !HEX_RE.test(p.color)) fail(`color must look like "#rrggbb" (got "${p.color}").`)
  const color = (o: Record<string, unknown>, k: string) => { if (typeof o.color !== 'string' || !HEX_RE.test(o.color)) fail(`${k}.color must look like "#rrggbb".`) }
  const range = (o: Record<string, unknown>, k: string, f: string, lo: number, hi: number, need: boolean) => {
    const v = o[f]
    if (v === undefined && !need) return
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo - EPS || v > hi + EPS) fail(`${k}.${f} must be a number between ${lo} and ${hi}${v === undefined ? '' : ` (got ${JSON.stringify(v)})`}.`)
  }
  const keys = (o: Record<string, unknown>, k: string, ok: string[]) => { const bad = Object.keys(o).filter((x) => !ok.includes(x)); if (bad.length) fail(`${k} has unknown field ${bad.join(', ')} — allowed: ${ok.join(', ')}.`) }
  for (const k of ['stroke', 'bg', 'shadow', 'glow'] as const) {
    const o = p[k]
    if (o === null || o === undefined) continue
    if (!isObj(o)) fail(`${k} must be an object or null.`)
    const v = o as Record<string, unknown>
    color(v, k)
    if (k === 'stroke') { keys(v, k, ['color', 'width']); range(v, k, 'width', STROKE_W_MIN, STROKE_W_MAX, true) }
    if (k === 'bg') { keys(v, k, ['color', 'opacity', 'shape']); range(v, k, 'opacity', 0, 1, false); if (v.shape !== undefined && !(BG_SHAPES as readonly unknown[]).includes(v.shape)) fail(`bg.shape must be one of ${BG_SHAPES.join(', ')}.`) }
    if (k === 'shadow') { keys(v, k, ['color', 'opacity', 'angle', 'dist', 'blur']); range(v, k, 'opacity', 0, 1, false); range(v, k, 'angle', 0, 360, false); range(v, k, 'dist', 0, SHADOW_DIST_MAX, false); range(v, k, 'blur', 0, SHADOW_BLUR_MAX, false) }
    if (k === 'glow') { keys(v, k, ['color', 'strength']); range(v, k, 'strength', 0.01, 1, true) }
  }
  return p as TextPatch
}

// ── 画面外观／关键帧／淡入淡出／复制／换素材——验值与小工具 ──
/** 一段换成新的（只动这一段） */
const swapClip = (c: Ctx, id: string, fn: (x: TlClip) => TlClip) => { c.tracks = c.tracks.map((l) => (l.clips.some((x) => x.id === id) ? { ...l, clips: l.clips.map((x) => (x.id === id ? fn(x) : x)) } : l)) }
const LOOK_SCALE = { min: LOOK_SCALE_MIN, max: LOOK_SCALE_MAX }
const MASK_RANGE: Record<string, [number, number]> = { x: [-POS_LIM, POS_LIM], y: [-POS_LIM, POS_LIM], w: [0.02, 4], h: [0.02, 4], rot: [-360, 360], feather: [0, 100], radius: [0, 100], progress: [0, 1], count: [1, STRIPE_COUNT_MAX], gap: [0, 0.95], stagger: [0, 1] } // 后四个＝条纹
const inRange = (k: string, v: unknown, lo: number, hi: number) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo - EPS || v > hi + EPS) fail(`${k} must be a number between ${r3(lo)} and ${r3(hi)}${v === undefined ? '' : ` (got ${JSON.stringify(v)})`}.`) }
const onlyKeys = (o: Record<string, unknown>, k: string, ok: readonly string[]) => { const bad = Object.keys(o).filter((x) => !ok.includes(x)); if (bad.length) fail(`${k} has unknown field ${bad.join(', ')} — allowed: ${ok.join(', ')}.`) }
/** 画面外观参数 ⇒ 一笔 LookPatch（缩放分开那两栏要看这段现在的值·调用方补） */
function lookPatchOf(a: Args): LookPatch {
  const p: LookPatch = {}
  for (const k of ['x', 'y', 'rot', 'opacity', 'corner'] as const) if (num(a, k) !== undefined) p[k] = num(a, k)
  if (str(a, 'blend') !== undefined) p.blend = str(a, 'blend') as LookPatch['blend']
  for (const k of ['flipH', 'flipV'] as const) if (a[k] !== undefined) p[k] = a[k] as boolean
  if (a.crop !== undefined) {
    if (a.crop === null) p.crop = null
    else {
      const o = a.crop as Record<string, unknown>
      onlyKeys(o, 'crop', ['l', 't', 'r', 'b'])
      for (const k of ['l', 't', 'r', 'b']) if (o[k] !== undefined) inRange(`crop.${k}`, o[k], 0, 0.9)
      const v = (k: string) => (o[k] as number | undefined) ?? 0
      if (v('l') + v('r') > 0.95 + EPS || v('t') + v('b') > 0.95 + EPS) fail('crop: left + right and top + bottom must each leave at least 5% of the picture (sum ≤ 0.95).')
      p.crop = { l: v('l'), t: v('t'), r: v('r'), b: v('b') }
    }
  }
  for (const k of ['glow', 'border', 'mblur'] as const) {
    const v = a[k]
    if (v === undefined) continue
    if (v === null) { p[k] = null; continue }
    if (typeof v !== 'object' || Array.isArray(v)) fail(`${k} must be an object or null.`)
    const o = v as Record<string, unknown>
    if (k === 'glow') { onlyKeys(o, k, ['color', 'radius', 'strength']); for (const f of ['radius', 'strength']) if (o[f] !== undefined) inRange(`glow.${f}`, o[f], 1, 100) }
    if (k === 'border') { onlyKeys(o, k, ['color', 'width']); if (o.width !== undefined) inRange('border.width', o.width, 1, 100) }
    if (k === 'mblur') { onlyKeys(o, k, ['amount', 'blend', 'passes', 'mode']); for (const f of ['amount', 'blend']) inRange(`mblur.${f}`, o[f], 1, 100); if (o.passes !== undefined) inRange('mblur.passes', o.passes, 1, 4); if (o.mode !== undefined && o.mode !== 'frames' && o.mode !== 'dir') fail('mblur.mode must be "frames" or "dir".') }
    if ((k === 'glow' || k === 'border') && o.color !== undefined && !(typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color))) fail(`${k}.color must be "#rrggbb".`)
    ;(p as Record<string, unknown>)[k] = { ...o }
  }
  const maskOf = (o: Record<string, unknown>, k: string) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) fail(`${k} must be an object.`)
    onlyKeys(o, k, ['shape', ...Object.keys(MASK_RANGE), 'invert', 'ease'])
    if (o.shape !== undefined && !(MASK_SHAPES as readonly unknown[]).includes(o.shape)) fail(`${k}.shape must be one of ${MASK_SHAPES.join(', ')}.`)
    for (const [f, [lo, hi]] of Object.entries(MASK_RANGE)) if (o[f] !== undefined) inRange(`${k}.${f}`, o[f], lo, hi)
    if (o.invert !== undefined && typeof o.invert !== 'boolean') fail(`${k}.invert must be true or false.`)
    if (o.ease !== undefined && !(STRIPE_EASES as readonly unknown[]).includes(o.ease)) fail(`${k}.ease must be one of ${STRIPE_EASES.join(', ')}.`)
    return o
  }
  if (a.mask !== undefined) p.mask = a.mask === null ? null : (maskOf(a.mask as Record<string, unknown>, 'mask') as LookPatch['mask'])
  // 多蒙版／合成方式／轨道遮罩
  if (a.masks !== undefined) {
    if (a.masks === null) p.masks = null
    else {
      if (!Array.isArray(a.masks) || a.masks.length > MASKS_MAX) fail(`masks must be an array of at most ${MASKS_MAX} masks (or null).`)
      p.masks = (a.masks as Record<string, unknown>[]).map((o, i) => { maskOf(o, `masks[${i}]`); if (!(MASK_SHAPES as readonly unknown[]).includes(o.shape)) fail(`masks[${i}].shape is required.`); return o }) as unknown as LookPatch['masks']
    }
  }
  if (a.maskOp !== undefined) { if (!(MASK_OPS as readonly unknown[]).includes(a.maskOp)) fail(`maskOp must be one of ${MASK_OPS.join(', ')}.`); p.maskOp = a.maskOp as LookPatch['maskOp'] }
  if (a.matte !== undefined) {
    if (a.matte === null) p.matte = null
    else {
      const o = a.matte as Record<string, unknown>
      if (!o || typeof o !== 'object' || Array.isArray(o)) fail('matte must be an object or null.')
      onlyKeys(o, 'matte', ['lane', 'clip', 'mode', 'invert', 'show'])
      if (o.mode !== undefined && !(MATTE_MODES as readonly unknown[]).includes(o.mode)) fail(`matte.mode must be one of ${MATTE_MODES.join(', ')}.`)
      if (o.lane !== undefined && typeof o.lane !== 'string') fail('matte.lane must be a lane id string.')
      if (o.clip !== undefined && (typeof o.clip !== 'string' || !PROJECT_ID_RE.test(o.clip))) fail('matte.clip must be a clip id string.')
      if (o.clip !== undefined && o.lane !== undefined) fail('give matte.clip or matte.lane, not both.')
      for (const k of ['invert', 'show']) if (o[k] !== undefined && typeof o[k] !== 'boolean') fail(`matte.${k} must be true or false.`)
      p.matte = parseMatte(o)!
    }
  }
  if (a.adjust !== undefined) {
    const o = a.adjust as Record<string, unknown>
    onlyKeys(o, 'adjust', ADJ_KEYS)
    for (const k of Object.keys(o) as AdjKey[]) { const [lo, hi] = adjRange(k); inRange(`adjust.${k}`, o[k], lo, hi) }
    p.adj = o as LookPatch['adj']
  }
  return p
}
/** 关键帧各项的范围与白话（单位同那一项本身） */
const KF_INFO: Record<string, [number, number, string]> = {
  sx: [LOOK_SCALE.min, LOOK_SCALE.max, 'scale (1 = fit); while scaling is uniform sy follows sx'], sy: [LOOK_SCALE.min, LOOK_SCALE.max, 'vertical scale (only when scaling is not uniform)'],
  x: [-POS_LIM, POS_LIM, 'picture centre offset in frame widths (0 = centred, + = right)'], y: [-POS_LIM, POS_LIM, 'picture centre offset in frame heights (0 = centred, + = up)'],
  rot: [-3600, 3600, 'rotation in degrees, clockwise'], opacity: [0, 1, 'opacity'], vol: [DB_MIN, DB_MAX, `volume in dB (0 = original, ${DB_MIN} = silent)`], flt: [0, 1, 'filter strength'],
  tx: [0, 1, 'text centre x (0 left … 1 right)'], ty: [0, 1, 'text centre y (0 top … 1 bottom)'], ts: [0.05, 20, 'text scale (multiplies size)'], trot: [-3600, 3600, 'text rotation in degrees'], top: [0, 1, 'text opacity'],
  ...Object.fromEntries(KF_MASK_KEYS.map((k) => [`mask.${k}`, [...MASK_RANGE[k], `mask ${k} (same units as clip.setLook mask)`]])),
  ...Object.fromEntries(KF_ADJ_KEYS.map((k) => [`adj.${k}`, [...adjRange(k), `colour adjustment ${k}`]])),
  ...Object.fromEntries(PIN_KEYS.map((k) => [`pin.${k}`, [-PIN_LIM, PIN_LIM, `corner pin ${k} (same units as clip.setCornerPin)`]])),
  'd3.z': [-POS3_LIM, POS3_LIM, '3D depth in frame heights (+ = farther from the camera)'], 'd3.rx': [-ROT3_LIM, ROT3_LIM, '3D tilt around x in degrees (+ = bottom edge goes away)'],
  'd3.ry': [-ROT3_LIM, ROT3_LIM, '3D turn around y in degrees (+ = right edge goes away)'], 'd3.rz': [-ROT3_LIM, ROT3_LIM, '3D roll around z in degrees, clockwise'],
  ...Object.fromEntries((['x', 'y', 'z', 'tx', 'ty', 'tz'] as const).map((k) => [`cam.${k}`, [-POS3_LIM, POS3_LIM, `camera ${k.length > 1 ? `target ${k[1]}` : `position ${k}`} in frame heights (origin = frame centre, y up, z + = into the picture)`]])),
  'cam.fov': [FOV_MIN, FOV_MAX, 'camera vertical field of view in degrees'], 'lt.int': [0, INTENSITY_MAX, 'light intensity (1 = 100%)'],
  ...Object.fromEntries((['x', 'y', 'z'] as const).map((k) => [`lt.${k}`, [-POS3_LIM, POS3_LIM, `light position ${k} in frame heights (same axes as the camera)`]])),
}
/** 这段能打哪几项关键帧（同页面关键帧面板·读档 parseProject 留得住的那几项）；不能 ⇒ 白话原因 */
function kfPropsFor(c: Ctx, f: { clip: TlClip; lane: Lane }): KfProp[] | string {
  const x = f.clip
  const pinP: KfProp[] = x.look?.pin ? PIN_KEYS.map((k) => `pin.${k}` as KfProp) : [] // 四角透视开着才收
  const d3P: KfProp[] = x.d3 ? [...D3_PROPS] : [] // 开了 3D 才收 d3.*
  if (x.rig) return x.rig.kind === 'null' ? [...NULL_PROPS, ...d3P] : x.rig.kind === 'camera' ? [...CAM_PROPS] : [...LT_PROPS] // 空物件／摄影机／灯光
  if (x.sticker && (pinP.length || d3P.length)) return [...pinP, ...d3P]
  if (x.sticker) return 'stickers have no keyframes in the editor yet — move or resize them with sticker.update.'
  if (x.program) return 'program clips have no keyframes.'
  if (x.text) return ['tx', 'ty', 'ts', 'trot', 'top', ...pinP, ...d3P]
  if (x.filter) return ['flt']
  if (x.adjust) return 'adjustment layers have no keyframes through commands yet — set their colour with clip.setLook adjust.'
  if (x.shape || x.solid || x.bgfx) return ['sx', 'sy', 'x', 'y', 'rot', 'opacity', ...d3P] // 形状／纯色：位置大小旋转不透明度（同 lookOf）
  if (x.freeze) return 'a freeze-frame clip stands still on one frame — keyframes have nothing to follow.'
  if (f.lane.kind === 'audio') return ['vol']
  const pic: KfProp[] = ['sx', 'sy', 'x', 'y', 'rot', 'opacity', ...(x.look?.mask ? KF_MASK_KEYS.map((k) => `mask.${k}` as KfProp) : []), ...KF_ADJ_KEYS.map((k) => `adj.${k}` as KfProp), ...pinP, ...d3P]
  return mediaOf(c, x.mediaId)?.kind === 'video' ? [...pic, 'vol'] : pic
}
/** timeline.list 里的关键帧：每项一串 {at 时间轴秒, v, ease} */
function kfList(x: TlClip): Record<string, Array<{ at: number; v: number; ease?: unknown }>> | undefined {
  if (!x.kf) return undefined
  const o = Object.fromEntries(Object.entries(x.kf as KfTracks).filter(([, tr]) => tr?.length).map(([p, tr]) => [p, (tr as Kf[]).map((k) => ({ at: r3(timeOfSrc(x, k.t)), v: k.v, ...(k.e ? { ease: k.e } : {}) })).sort((a, b) => a.at - b.at)]))
  return Object.keys(o).length ? o : undefined
}

// ── 摄影机／灯光（camera.add／update·light.add／update）──
const POS3 = (k: string, what: string): ParamSpec => ({ name: k, type: 'number', min: -POS3_LIM, max: POS3_LIM, note: `${what} in frame heights (origin = frame centre, y up, z + = into the picture)` })
const CAM_PARAMS: ParamSpec[] = [POS3('x', 'Camera position x'), POS3('y', 'Camera position y'), POS3('z', 'Camera position z (default −1.3737 = the picture plane looks exactly like 2D at fov 40)'),
  POS3('tx', 'Point of interest x'), POS3('ty', 'Point of interest y'), POS3('tz', 'Point of interest z'),
  { name: 'fov', type: 'number', min: FOV_MIN, max: FOV_MAX, note: 'Vertical field of view in degrees (default 40; smaller = telephoto)' },
  { name: 'aperture', type: 'number', min: 0, max: 100, note: 'Depth of field 0..100 (0 = off): layers away from the focus distance get blurred' },
  { name: 'focus', type: 'number', min: 0.01, max: POS3_LIM, note: 'Focus distance from the camera in frame heights (default = distance to the picture plane)' }]
const LIGHT_PARAMS: ParamSpec[] = [{ name: 'color', type: 'string', note: 'Light colour #rrggbb (default #ffffff)' },
  { name: 'intensity', type: 'number', min: 0, max: INTENSITY_MAX, note: 'Intensity (1 = 100%; ambient lights add evenly, others by the angle to each 3D layer)' },
  POS3('x', 'Light position x'), POS3('y', 'Light position y'), POS3('z', 'Light position z (− = in front of the picture, towards the camera)'),
  POS3('tx', 'Where a parallel / spot light points: x'), POS3('ty', 'Where it points: y'), POS3('tz', 'Where it points: z'),
  { name: 'cone', type: 'number', min: CONE_MIN, max: CONE_MAX, note: 'Spot light cone angle in degrees (default 60)' },
  { name: 'feather', type: 'number', min: 0, max: 100, note: 'Spot light soft edge 0..100 (default 50)' }]
const pickArgs = (a: Args, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, typeof a[k] === 'string' ? (a[k] as string).toLowerCase() : a[k]]))
const CAM_KEYS = ['x', 'y', 'z', 'tx', 'ty', 'tz', 'fov', 'aperture', 'focus'] as const
const LIGHT_KEYS = ['color', 'intensity', 'x', 'y', 'z', 'tx', 'ty', 'tz', 'cone', 'feather'] as const
const colorBad = (a: Args) => (a.color !== undefined && !HEX_RE.test(str(a, 'color') ?? '') ? `color must be #rrggbb (got "${str(a, 'color')}").` : null)
function rigCommands(): Def[] {
  return [
    {
      id: 'camera.add',
      params: [P.at(true, 'Start on the timeline (seconds)'), P.length(RIG_DEFAULT_SECONDS), ...CAM_PARAMS, P.lane(false, 'Visual lane to use; omit = the editor picks')],
      requires: 'A chosen lane must be a visual lane and not locked.',
      description: 'Add a camera clip (on a visual lane; draws nothing): while it is on the timeline, all 3D layers (clip.set3d) are seen through it — position, point of interest, field of view, optional depth of field. Only the camera on the topmost lane counts when several overlap. Animate it with clip.setKeyframe cam.x / cam.y / cam.z / cam.tx / cam.ty / cam.tz / cam.fov (or clip.setExpression), or parent it to a null with clip.setParent to orbit.',
      check: (c, a) => { laneFits(c, str(a, 'lane'), 'visual', 'cameras'); return null },
      run: (c, a) => {
        const clip = newCameraClip(c.newId(), pickArgs(a, CAM_KEYS))
        clip.length = snapFrame(num(a, 'length') ?? RIG_DEFAULT_SECONDS)
        return placed(c, place(c, 'visual', clip, num(a, 'at')!, str(a, 'lane')), clip.id)
      },
    },
    {
      id: 'camera.update',
      params: [P.clip('Camera clip id'), ...CAM_PARAMS],
      requires: 'A camera clip; lane not locked.',
      description: 'Change a camera: position, point of interest, field of view, depth of field (aperture 0 = off). Properties with keyframes follow their keyframes instead.',
      check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (f.clip.rig?.kind !== 'camera') return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a camera.`; return Object.keys(a).some((k) => k !== 'clip') ? null : 'give at least one property.' },
      run: (c, a) => { const id = str(a, 'clip')!; c.tracks = patchRigClip(c.tracks, id, { rig: pickArgs(a, CAM_KEYS) as RigPatch['rig'] }); return { id, ids: [id] } },
    },
    {
      id: 'light.add',
      params: [{ name: 'kind', type: 'string', required: true, enum: LIGHT_KINDS, note: 'parallel = sun-like, from its position towards its target; point = from a point in all directions; spot = cone from its position towards its target; ambient = even light everywhere' },
        P.at(true, 'Start on the timeline (seconds)'), P.length(RIG_DEFAULT_SECONDS), ...LIGHT_PARAMS, P.lane(false, 'Visual lane to use; omit = the editor picks')],
      requires: 'A #rrggbb colour if given; a chosen lane must be a visual lane and not locked.',
      description: 'Add a light clip (on a visual lane; draws nothing). While any light is on, every 3D layer is shaded by simplified Lambert lighting: ambient adds evenly; parallel / point / spot light it by the angle between the layer and the light (spot also by its cone). 2D layers are not lit. Animate with clip.setKeyframe lt.int / lt.x / lt.y / lt.z.',
      check: (c, a) => { laneFits(c, str(a, 'lane'), 'visual', 'lights'); return colorBad(a) },
      run: (c, a) => {
        const clip = newLightClip(c.newId(), str(a, 'kind') as LightKind, pickArgs(a, LIGHT_KEYS))
        clip.length = snapFrame(num(a, 'length') ?? RIG_DEFAULT_SECONDS)
        return placed(c, place(c, 'visual', clip, num(a, 'at')!, str(a, 'lane')), clip.id)
      },
    },
    {
      id: 'light.update',
      params: [P.clip('Light clip id'), { name: 'kind', type: 'string', enum: LIGHT_KINDS, note: 'Change the kind' }, ...LIGHT_PARAMS],
      requires: 'A light clip; lane not locked.',
      description: 'Change a light: kind, colour, intensity, position, target, spot cone / soft edge.',
      check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (f.clip.rig?.kind !== 'light') return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a light.`; if (!Object.keys(a).some((k) => k !== 'clip')) return 'give at least one property.'; return colorBad(a) },
      run: (c, a) => { const id = str(a, 'clip')!; c.tracks = patchRigClip(c.tracks, id, { rig: { ...pickArgs(a, LIGHT_KEYS), ...(a.kind !== undefined ? { light: a.kind as LightKind } : {}) } as RigPatch['rig'] }); return { id, ids: [id] } },
    },
  ]
}

// ── 程序片段（program.define／program.add／program.update·程序动画一条条命令放·⛔ 只能整份工程重写）──
/** 内嵌程序包的键（同 parseProject 收 programs 那把尺） */
const PKG_ID_RE = /^u-[A-Za-z0-9-]{8,64}$/
const PROGRAM_TEXT_MAX = 2000
const utf8Len = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
/** 程序包：网站内建（b-…）或这份工程内嵌的（u-…·manifest 读得懂才算） */
function bundleOf(c: Ctx, id: string): ProgramBundle | null {
  const b = builtinProgram(id)
  if (b) return b
  const p = c.programs[id]
  if (!p) return null
  const m = parseManifest(p.manifest)
  return m.ok ? { id, manifest: m.manifest, html: p.html, builtin: false } : null
}
const pkgOf = (c: Ctx, id: string): ProgramBundle => bundleOf(c, id) ?? fail(`program package "${id}" is neither built in nor in this project — see catalog.list {"kind":"program"}, or register your own with program.define first.`)
/** 程序参数：只收 manifest 列的 key·型别不对报错·数字超出 min～max 夹进范围（回一句说明）·null ⇒ 拿掉（回包里默认） */
function programParamsOf(m: ProgramManifest, raw: Record<string, unknown>): { set: Record<string, ProgramParamValue>; unset: string[]; clamped: string[] } {
  const set: Record<string, ProgramParamValue> = {}, unset: string[] = [], clamped: string[] = []
  const keys = m.params.map((s) => s.key)
  for (const [k, v] of Object.entries(raw)) {
    const s = m.params.find((x) => x.key === k)
    if (!s) fail(`program param "${k}" is not in this package — it takes ${keys.length ? keys.join(', ') : 'no params'} (see catalog.list {"kind":"program"}).`)
    if (v === null) { unset.push(k); continue }
    const bad = (want: string): never => fail(`program param "${k}" must be ${want} (got ${JSON.stringify(v)?.slice(0, 80)}).`)
    switch (s!.type) {
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) bad('a number')
        const x = paramValue(s!, v) as number
        if (x !== v) clamped.push(`${k} ${v} → ${x}`)
        set[k] = x
        break
      }
      case 'text': if (typeof v !== 'string') bad('a string'); if ((v as string).length > PROGRAM_TEXT_MAX) bad(`at most ${PROGRAM_TEXT_MAX} characters`); set[k] = v as string; break
      case 'color': if (typeof v !== 'string' || !HEX_RE.test(v)) bad('"#rrggbb"'); set[k] = v as string; break
      case 'bool': if (typeof v !== 'boolean') bad('true or false'); set[k] = v as boolean; break
      case 'select': { const ok = s!.options.map(optValue); if (typeof v !== 'string' || !ok.includes(v)) bad(`one of ${ok.map((x) => `"${x}"`).join(', ')}`); set[k] = v as string; break }
    }
  }
  return { set, unset, clamped }
}
const clampNote = (cl: string[]) => (cl.length ? `clamped to the package's range: ${cl.join(', ')}.` : undefined)
/** catalog.list 里一个程序包：编号、英文名、内建还是工程内嵌、缺省秒数、每项参数（型别、缺省、范围、选项） */
const programRow = (b: ProgramBundle) => ({
  id: b.id, name: l10n(b.manifest.name, 'en'), builtin: b.builtin, version: b.manifest.version, defaultLength: b.manifest.defaultLength,
  params: b.manifest.params.map((s) => ({ key: s.key, label: l10n(s.label, 'en'), type: s.type, default: s.default, ...(s.type === 'number' ? { ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}) } : {}), ...(s.type === 'select' ? { options: s.options.map(optValue) } : {}) })),
})
const PROGRAM_PARAMS_NOTE = 'Program params {key: value} from the package\'s manifest (catalog.list {"kind":"program"}): text = string, color = "#rrggbb", number (outside min..max is clamped), select = one of its options, bool; omitted = the package default'
function programCommands(): Def[] {
  return [
    {
      id: 'program.define',
      params: [
        { name: 'id', type: 'string', note: 'Package id "u-<8..64 letters, digits or ->" (omit = a new one); a program.add later in the same batch can use "$<this step>"' },
        { name: 'manifest', type: 'object', required: true, note: '{name, version, defaultLength (sec), params:[{key, label?, type:"text"|"color"|"number"|"select"|"bool", default, min?, max?, step?, options?}]} — same as manifest.json of an uploaded package (engine html; alpha default true)' },
        { name: 'html', type: 'string', required: true, note: `The whole page, assets inlined as data: URLs; it must set window.dilinProgram = {render(t, params, size)} (t = seconds since the clip start, size = {w, h}; draw only from t — no clock, no network). Embedded packages together at most ${VEDIT_PROGRAMS_EMBED_MAX / 1024 / 1024} MB` },
        { name: 'replace', type: 'boolean', note: 'true = overwrite a package with this id that has different content (default: refuse)' },
      ],
      requires: 'A valid manifest; html that sets window.dilinProgram; size within the limit; an existing id with different content needs replace:true.',
      description: 'Register a program package you wrote (manifest + html) in this project, so program.add can place it. Returns its package id. The same id with exactly the same content changes nothing. It runs in the editor\'s sandbox (no network), in preview and export alike. A package no clip uses is dropped the next time the editor saves. To put a program animation on the timeline use program.define + program.add — do not rewrite the whole project with update_video_edit.',
      run: (c, a) => {
        const id = (str(a, 'id') ?? `u-prog-${c.newId().replace(/[^A-Za-z0-9-]/g, '-')}`).trim()
        if (!PKG_ID_RE.test(id)) fail(`id must look like "u-" + 8..64 letters, digits or "-" (got "${id}").`)
        const pm = parseManifest(a.manifest)
        if (!pm.ok) fail(`manifest is not valid: ${(pm as { err: string }).err}.`)
        const manifest = (pm as { manifest: ProgramManifest }).manifest
        const html = str(a, 'html')!
        if (!/dilinProgram/.test(html)) fail('html must set window.dilinProgram = { render(t, params, size) { … } } — the editor calls it for every frame.')
        const entry: ProjectProgram = { manifest, html }
        const had = c.programs[id]
        if (had && JSON.stringify(canon(had)) === JSON.stringify(canon(entry))) return { id, note: 'already in this project with the same content — nothing changed.' }
        if (had && a.replace !== true) fail(`program package "${id}" is already in this project with different content — pass replace:true to overwrite it (clips using it will draw with the new one), or use another id.`)
        const next = { ...c.programs, [id]: entry }
        const bytes = utf8Len(next) - utf8Len({})
        if (bytes > VEDIT_PROGRAMS_EMBED_MAX) fail(`embedded program packages would total ${Math.ceil(bytes / 1024)} KB, over the ${VEDIT_PROGRAMS_EMBED_MAX / 1024} KB limit — make the html smaller.`)
        c.programs = next
        return { id, data: programRow({ id, manifest, html, builtin: false }), ...(had ? { note: 'replaced the old content.' } : {}) }
      },
    },
    {
      id: 'program.add',
      params: [
        { name: 'pkg', type: 'program', required: true, note: 'Program package id: built in (catalog.list {"kind":"program"}), already in this project, or "$<step>" of a program.define in this batch' },
        P.at(true, 'Start on the timeline (seconds)'),
        { name: 'length', type: 'number', min: MIN_CLIP, max: TIME_MAX, note: 'Seconds on the timeline (default = the package\'s defaultLength)' },
        { name: 'params', type: 'object', note: PROGRAM_PARAMS_NOTE },
        P.lane(false, 'Program lane to use; omit = the editor picks (nearest program lane above main; busy there ⇒ a new program lane)'),
      ],
      requires: 'A known package; params from its manifest; a chosen lane must be a program lane and not locked.',
      description: 'Add a program clip: an animated overlay drawn by a program package (HTML/canvas, transparent background) on a program lane. Use a built-in package or one registered with program.define. Change its params later with program.update; move / trim / split / delete it with clip.move, clip.trim, clip.split, clip.delete.',
      check: (c, a) => { laneFits(c, str(a, 'lane'), 'program', 'program clips'); return null },
      run: (c, a) => {
        const b = pkgOf(c, str(a, 'pkg')!)
        const pp = programParamsOf(b.manifest, (a.params as Args | undefined) ?? {})
        const clip = newProgramClip(c.newId(), b)
        if (num(a, 'length') !== undefined) clip.length = snapFrame(num(a, 'length')!)
        clip.program = { ...clip.program!, params: pp.set }
        return placed(c, place(c, 'program', clip, num(a, 'at')!, str(a, 'lane')), clip.id, clampNote(pp.clamped))
      },
    },
    {
      id: 'program.update',
      params: [P.clip('Program clip id'), { name: 'params', type: 'object', required: true, note: `${PROGRAM_PARAMS_NOTE}; only the keys you give change; null = back to the package default` }],
      requires: 'A program clip whose package is built in or in this project; lane not locked.',
      description: 'Change the params of a program clip (text, colour, size, speed… whatever its package offers). Times: clip.move / clip.trim.',
      check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (!f.clip.program) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a program clip.`; pkgOf(c, f.clip.program.pkg); return Object.keys(a.params as Args).length ? null : 'give at least one param.' },
      run: (c, a) => {
        const id = str(a, 'clip')!, cur = findClip(c.tracks, id)!.clip.program!
        const b = pkgOf(c, cur.pkg)
        const pp = programParamsOf(b.manifest, a.params as Args)
        const params = { ...cur.params, ...pp.set }
        for (const k of pp.unset) delete params[k]
        swapClip(c, id, (x) => ({ ...x, program: { ...cur, version: b.manifest.version, params } }))
        return { id, ids: [id], ...(clampNote(pp.clamped) ? { note: clampNote(pp.clamped) } : {}) }
      },
    },
  ]
}

// ═══════════════════════════════ 命令表 ═══════════════════════════════
const DEFS: Def[] = [
  // ── 唯读 ──
  {
    id: 'media.list', readOnly: true, params: [],
    description: 'List the media in this project (id, name, kind, duration in seconds; 0 = not measured yet — then clip.add needs length). Use the id with clip.add.',
    run: (c) => {
      const unknown = c.media.filter((m) => m.kind !== 'image' && !(m.duration > 0)).map((m) => `"${m.name}" (${m.id})`)
      return { data: c.media.map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: r3(m.duration), from: m.from, ...(m.driveId ? { driveId: m.driveId } : {}) })), ...(unknown.length ? { note: UNKNOWN_LEN_NOTE(unknown.join(', ')) } : {}) }
    },
  },
  {
    id: 'timeline.list', readOnly: true, params: [],
    description: 'List the lanes (top to bottom) and their clips with ids, times and what each clip is — including look (position/scale/…, track matte), animations, fades, keyframes (each property: [{at timeline seconds, v, ease}]), speed, volume, effects and transitions; also the total length, frame ratio and markers. After comp.enter it lists that composition\'s lanes (data.composition says which).',
    run: (c) => ({
      data: {
        duration: r3(timelineEnd(c.tracks)), ratio: c.level ? c.comps[c.level].ratio : c.ratio, markers: markersOf(c.tracks),
        // 在哪一层（comp.enter 进了合成 ⇒ 那份合成·列的是它的轨道）
        ...(c.level ? { composition: { id: c.level, name: c.comps[c.level].name } } : {}), ...(Object.keys(c.comps).length ? { compositions: Object.keys(c.comps).length } : {}),
        lanes: c.tracks.map((l) => ({
          id: l.id, kind: l.kind, ...(l.id === MAIN_LANE ? { main: true } : {}), locked: l.locked, hidden: l.hidden, muted: l.muted,
          clips: l.clips.map((x) => ({
            id: x.id, what: clipKind(c, x), start: r3(x.start), length: r3(x.length),
            ...(isMediaClip(x) ? { mediaId: x.mediaId, name: mediaOf(c, x.mediaId)?.name, offset: r3(x.offset) } : {}),
            ...(x.comp ? { comp: x.comp, name: c.comps[x.comp]?.name, offset: r3(x.offset) } : {}),
            ...(x.text ? { text: x.text.content.slice(0, 60), ...(x.text.fancy ? { fancy: x.text.fancy } : {}) } : {}),
            ...(x.shape ? { shape: x.shape } : {}), ...(x.solid ? { solid: x.solid.color } : {}), ...(x.bgfx ? { bgfx: x.bgfx } : {}),
            ...(x.sticker ? { sticker: x.sticker.sticker } : {}), ...(x.filter ? { filter: x.filter.filter, strength: x.filter.strength } : {}), ...(x.program ? { program: x.program } : {}),
            ...(x.speed !== undefined ? { speed: x.speed } : {}), ...(x.volume !== undefined ? { volume: x.volume } : {}),
            ...(x.muted ? { muted: true } : {}), ...(x.disabled ? { disabled: true } : {}), ...(x.detached ? { detached: true } : {}),
            ...(x.fx?.length ? { fx: x.fx.map((f) => f.fx) } : {}), ...(x.transIn ? { transition: x.transIn.tr } : {}), ...(x.group ? { group: x.group } : {}),
            // 外观、动画、淡入淡出、关键帧、倒放定格曲线变速、文字／贴纸位置都列出来
            ...(x.text ? { textLook: { x: x.text.x, y: x.text.y, size: x.text.size, ...(x.text.scale !== undefined ? { scale: x.text.scale } : {}), ...(x.text.rotate !== undefined ? { rotate: x.text.rotate } : {}), ...(x.text.opacity !== undefined ? { opacity: x.text.opacity } : {}) } } : {}),
            ...(x.sticker ? { stickerLook: { x: x.sticker.x, y: x.sticker.y, size: x.sticker.size } } : {}),
            ...(x.look ? { look: x.look } : {}), ...(x.anim ? { anim: x.anim } : {}), ...(x.text?.anim ? { anim: x.text.anim } : {}),
            ...(x.fadeIn ? { fadeIn: x.fadeIn } : {}), ...(x.fadeOut ? { fadeOut: x.fadeOut } : {}),
            ...(x.reverse ? { reverse: true } : {}), ...(x.freeze ? { freeze: true } : {}), ...(x.curve ? { speedCurve: true } : {}), ...(x.adjust ? { adjust: true } : {}),
            ...(kfList(x) ? { keyframes: kfList(x) } : {}),
            // 空物件／摄影机／灯光·父子连结·3D·表达式
            ...(x.rig ? { rig: x.rig } : {}), ...(x.parent ? { parent: x.parent, ...(x.parentAlpha ? { parentAlpha: true } : {}) } : {}), ...(x.d3 ? { d3: x.d3 } : {}), ...(x.expr ? { expr: x.expr } : {}),
          })),
        })),
      },
    }),
  },
  {
    id: 'catalog.list', readOnly: true,
    params: [
      { name: 'kind', type: 'string', required: true, enum: ['sticker', 'filter', 'fancy', 'effect', 'transition', 'anim-in', 'anim-out', 'anim-loop', 'sfx', 'program'], note: 'Which library' },
      { name: 'filter', type: 'string', note: 'Only ids / English names containing this text' },
    ],
    description: 'List the ids of a built-in library (stickers, filters, fancy text styles, clip effects, transitions, text/clip animations, sound effects, program packages) with English names; sound effects also give their length in seconds (use them with sfx.add); "program" lists the built-in program packages and the ones in this project (u-…) with defaultLength and every param (type, default, min/max, options) — use them with program.add.',
    run: (c, a) => {
      const k = str(a, 'kind')!
      const rows: Array<{ id: string; name: string; seconds?: number }> =
        k === 'program' ? [...BUILTIN_PROGRAMS, ...Object.keys(c.programs).sort().map((id) => bundleOf(c, id)).filter((b): b is ProgramBundle => !!b)].map(programRow)
        : k === 'sfx' ? SFX_LIB.map((s) => ({ id: s.id, name: s.name.en, seconds: s.seconds }))
        : k === 'sticker' ? STICKERS.map((s) => ({ id: s.id, name: s.name.en }))
        : k === 'filter' ? FILTERS.map((s) => ({ id: s.id, name: s.name.en }))
        : k === 'fancy' ? FANCY_TEXTS.map((s) => ({ id: s.id, name: s.name.en }))
        : k === 'effect' || k === 'transition' ? FX_ITEMS.filter((x) => x.kind === k).map((s) => ({ id: s.id, name: s.name.en }))
        : ANIM_LIB[k.slice(5) as TextAnimSlot].map((s) => ({ id: s.id, name: s.name.en }))
      const q = (str(a, 'filter') ?? '').trim().toLowerCase()
      return { data: q ? rows.filter((r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) : rows }
    },
  },
  // ── 素材 ──
  {
    id: 'media.add',
    params: [
      { name: 'drive_id', type: 'string', required: true, note: 'Drive file id of a video, audio or image (from list_drive)' },
      { name: 'kind', type: 'string', required: true, enum: ['video', 'audio', 'image'], note: 'What the file is' },
      { name: 'name', type: 'string', note: 'Name shown in the media panel (default: the drive id)' },
      { name: 'duration', type: 'number', min: 0, max: TIME_MAX, note: 'Seconds (video/audio; 0 or omitted = unknown — then clip.add needs length)' },
    ],
    description: 'Add a drive file to the project\'s media so clips can use it. Returns its media id. A file already in the media list is not added twice (you get the existing id).',
    run: (c, a) => {
      const driveId = str(a, 'drive_id')!.trim()
      if (!DRIVE_ID_RE.test(driveId)) fail(`drive_id "${driveId}" is not a drive file id — use an id from list_drive.`)
      const kind = str(a, 'kind') as ProjectMediaKind
      const had = c.media.find((m) => m.driveId?.toLowerCase() === driveId.toLowerCase())
      if (had) {
        if (had.kind !== kind) fail(`that drive file is already in the media list as ${had.kind} (media id "${had.id}").`)
        return { id: had.id, note: 'already in the media list' }
      }
      const id = c.newId()
      const name = (str(a, 'name') ?? '').trim().slice(0, 200) || driveId
      const d = kind === 'image' ? 0 : num(a, 'duration') ?? 0
      c.media = [...c.media, { id, name, kind, duration: d, from: 'drive', driveId }]
      return { id, ...(kind !== 'image' && !(d > 0) ? { note: UNKNOWN_LEN_NOTE(`"${name}"`) } : {}) }
    },
  },
  {
    // 网页截图：命令层是纯函数、不出网 ⇒ 真截图由网站在套命令前先做（planWebShots 挑出这几步、截好存进云盘·步号 ⇒ 云盘档），
    //   这里只把那张图像 media.add 一样加进素材；没先截（例如直接 applyCommands）⇒ 白话拒。
    id: 'media.webShot',
    params: [
      { name: 'url', type: 'string', required: true, note: 'Public http(s) web page address' },
      { name: 'scale', type: 'integer', min: 2, max: 3, note: 'Pixel ratio 2 or 3 (default 2)' },
      { name: 'theme', type: 'string', enum: WEB_SHOT_THEMES, note: 'Ask the page for its light or dark color scheme (default light)' },
      { name: 'width', type: 'integer', min: WEB_SHOT_WIDTH_MIN, max: WEB_SHOT_WIDTH_MAX, note: `Browser width in CSS px (default ${WEB_SHOT_WIDTH_DEFAULT})` },
      { name: 'full', type: 'boolean', note: 'true = whole page as one tall image (default); false = only the first screen' },
      { name: 'name', type: 'string', note: 'Name shown in the media panel (default: 網頁截圖-<host>.png)' },
      { name: 'folder_id', type: 'string', note: 'Drive folder to save the image in (default: the folder of this .dvedit project)' },
    ],
    description: `Take a high-resolution screenshot of a public web page on the server (headless browser), save it to the drive and add it to the media as an image. Returns its media id. Free (no credits). Private / internal addresses are refused. A full page taller than ${WEB_SHOT_MAX_CSS_HEIGHT} CSS px (less at 3x or very wide) is cut there — the step note says so. At most 3 per call; each takes up to 20 seconds.`,
    run: (c, a) => {
      const shot = c.webShots?.[c.step]
      if (!shot) fail('media.webShot only runs through video_edit_run (the server takes the screenshot before the batch is applied).')
      const s = shot as WebShotDone
      if (!DRIVE_ID_RE.test(s.driveId)) fail('the screenshot was not saved to the drive.')
      const name = (str(a, 'name') ?? '').trim().slice(0, 200) || s.name
      const id = c.newId()
      c.media = [...c.media, { id, name, kind: 'image', duration: 0, from: 'drive', driveId: s.driveId }]
      return { id, ...(s.truncated ? { note: `the page was taller than the height limit, so the image stops there (drive file ${s.driveId}).` } : { note: `saved to drive file ${s.driveId}` }) }
    },
  },
  {
    // 朗读配音：同 media.webShot——命令层不出网；网站套命令前先挑出这几步（planTts 验参）、
    //   照编辑器「朗读」那条路合成·mp3 存云盘·步号 ⇒ 云盘档与长度。单机版与命令列版没有这条，照实拒。
    id: 'media.tts',
    params: [
      { name: 'text', type: 'string', required: true, note: `What to read aloud (max ${TTS_MAX_CHARS} characters; must contain letters or digits)` },
      { name: 'voice', type: 'string', enum: TTS_VOICES, note: 'Voice (default female-shaonv)' },
      { name: 'speed', type: 'number', min: 0.5, max: 2, note: 'Speaking speed 0.5..2 (default 1)' },
      { name: 'pitch', type: 'integer', min: -12, max: 12, note: 'Pitch in semitones -12..12 (default 0)' },
      { name: 'emotion', type: 'string', enum: TTS_EMOTIONS, note: 'Tone of voice (default auto = picked from the text)' },
      { name: 'name', type: 'string', note: 'Name shown in the media panel (default: <first words>-朗读.mp3)' },
      { name: 'folder_id', type: 'string', note: 'Drive folder to save the mp3 in (default: the folder of this .dvedit project)' },
    ],
    description: `Make a voice-over from text on the server (same as "Read aloud" in the editor), save the mp3 to the drive and add it to the media as audio with its length. Returns its media id — put it on an audio lane with clip.add {"media":"$<step>","at":<seconds>}. COSTS CREDITS every time: charged per character like Read aloud in the editor (Chinese characters count double), refunded if the voice-over fails; the text is checked by content moderation first. At most ${TTS_PER_CALL} per call. The mp3 stays in the drive (and the credits stay spent) even if a later step fails.`,
    run: (c, a) => {
      const t = c.tts?.[c.step]
      if (!t) fail('media.tts only runs through video_edit_run (the server makes the voice-over before the batch is applied).')
      const s = t as TtsDone
      if (!DRIVE_ID_RE.test(s.driveId)) fail('the voice-over was not saved to the drive.')
      if (!(s.seconds > 0)) fail('the voice-over came back empty.')
      const name = (str(a, 'name') ?? '').trim().slice(0, 200) || s.name
      const id = c.newId()
      c.media = [...c.media, { id, name, kind: 'audio', duration: r3(s.seconds), from: 'drive', driveId: s.driveId }]
      return { id, data: { seconds: r3(s.seconds), ...(s.credits !== undefined ? { credits: s.credits } : {}) }, note: `saved to drive file ${s.driveId}${s.credits !== undefined ? `; ${s.credits} credits charged` : ''}` }
    },
  },
  {
    // 内建音效：音效是纯函数算出来的（sfx-lib.pure）·网站先算成 WAV 存云盘（同页面音频页签点一款）·这里进素材、放到 at 那一秒的音频轨
    //   （指定的轨那段空着 ⇒ 放那条；其余照页面 planDrop／applyDrop·被占 ⇒ 往下开一条）。同一批同一款只存一份、素材也只一条。
    id: 'sfx.add',
    params: [
      { name: 'sfx', type: 'string', required: true, note: 'Sound effect id (catalog.list kind "sfx")' },
      P.at(true, 'Start on the timeline (seconds)'),
      P.lane(false, 'Put it on this audio lane; if that time is taken a new lane is added. Omit = the editor picks (a free audio lane, or a new one)'),
      { name: 'name', type: 'string', note: 'Name shown in the media panel (default: the effect\'s name)' },
      { name: 'folder_id', type: 'string', note: 'Drive folder to save the .wav in (default: the folder of this .dvedit project)' },
    ],
    requires: 'The chosen lane is an audio lane and not locked.',
    description: `Add a built-in sound effect (whoosh, ding, pop, boom…; list them with catalog.list {"kind":"sfx"}) at a time on an audio lane: the server renders it as a WAV, saves it to the drive, adds it to the media and places the clip. Returns the clip id (data.mediaId = the media id). Free (no credits). At most ${SFX_PER_CALL} per call.`,
    check: (c, a) => { if (!sfxById(str(a, 'sfx')!)) return `unknown sound effect "${str(a, 'sfx')}" — see catalog.list {"kind":"sfx"}.`; laneFits(c, str(a, 'lane'), 'audio', 'sound effects'); return null },
    run: (c, a) => {
      const def = sfxById(str(a, 'sfx')!)!
      const done = c.sfx?.[c.step]
      if (!done) fail('sfx.add only runs through video_edit_run (the server renders the sound before the batch is applied).')
      const s = done as SfxDone
      if (!DRIVE_ID_RE.test(s.driveId)) fail('the sound effect was not saved to the drive.')
      let m = c.media.find((x) => x.driveId?.toLowerCase() === s.driveId.toLowerCase())
      if (!m) {
        m = { id: c.newId(), name: (str(a, 'name') ?? '').trim().slice(0, 200) || s.name, kind: 'audio', duration: def.seconds, from: 'drive', driveId: s.driveId }
        c.media = [...c.media, m]
      }
      // 片长对齐帧格、不超出音效本身（超出那截只是静音）
      let length = snapFrame(def.seconds)
      if (length > def.seconds + EPS) length = Math.max(MIN_CLIP, snapFrame(length - MIN_CLIP))
      const clip: TlClip = { id: c.newId(), mediaId: m.id, start: 0, length, offset: 0 }
      const out = placed(c, place(c, 'audio', clip, num(a, 'at')!, str(a, 'lane')), clip.id)
      return { ...out, data: { ...(out.data as object), mediaId: m.id } }
    },
  },
  // ── 片段 ──
  {
    id: 'clip.add',
    params: [
      { name: 'media', type: 'source', required: true, note: 'Media id (from media.list / media.add, or "$<step>") — or a composition id (comp.list / comp.create / comp.fromClips) to place a composition clip on a visual lane (in = seconds into the composition; length defaults to the rest of it)' },
      P.at(false, 'Start on the timeline (seconds). Omit = append to the end of its lane (like double-clicking the media)'),
      P.lane(false, 'Put it on this lane (same kind: video/image → visual, audio → audio). If that time is taken a new lane is added next to it. Omit = the editor picks (main lane for video/image)'),
      { name: 'in', type: 'number', min: 0, max: TIME_MAX, note: 'Where in the source to start (seconds; video/audio only; default 0)' },
      P.length(IMAGE_DEFAULT_SECONDS),
    ],
    requires: 'The media is in the project (or the composition exists and does not contain the timeline you are adding to); the chosen lane fits and is not locked; for video/audio, in + length stays inside the source.',
    description: 'Place a video, image or audio from the project media on the timeline (like dragging it from the media panel), or a composition (comp) as a composition clip on a visual lane. Length defaults to the whole source (images 3 s).',
    check: (c, a) => {
      if (!mediaOf(c, str(a, 'media')!)) {
        const id = str(a, 'media')!
        const comp = compOf(c, id)
        if (id === c.level || compWouldCycle(c.comps, c.level, id)) return `composition "${id}" can't go inside ${c.level ? `composition "${c.level}"` : 'itself'} — it would contain itself.`
        laneFits(c, str(a, 'lane'), 'visual', 'composition clips')
        const d = compDuration(comp), inP = num(a, 'in') ?? 0
        if (!(d > 0)) return `composition "${id}" is empty (length 0) — add clips to it first (comp.enter) or give it a length with comp.update.`
        if (inP >= d - MIN_CLIP + EPS) return `in (${inP}) is past the end of composition "${comp.name}" (${r3(d)} s).`
        const len = num(a, 'length')
        if (len !== undefined && inP + snapFrame(len) > d + EPS) return `in + length (${r3(inP + snapFrame(len))} s) runs past the end of composition "${comp.name}" (${r3(d)} s).`
        return null
      }
      const m = mediaOf(c, str(a, 'media')!)!
      laneFits(c, str(a, 'lane'), laneKindFor(m.kind), `${m.kind} clips`)
      if (m.kind === 'image' && num(a, 'in')) return '"in" only applies to video/audio — leave it out for images.'
      const inP = num(a, 'in') ?? 0
      const len = num(a, 'length')
      if (m.kind !== 'image' && m.duration > 0) {
        if (inP >= m.duration - MIN_CLIP + EPS) return `in (${inP}) is past the end of "${m.name}" (${r3(m.duration)} s).`
        if (len !== undefined && inP + snapFrame(len) > m.duration + EPS) return `in + length (${r3(inP + snapFrame(len))} s) runs past the end of "${m.name}" (${r3(m.duration)} s) — shorten length or move in.`
      }
      if (m.kind !== 'image' && !(m.duration > 0) && len === undefined) return `the duration of "${m.name}" is not known yet — pass length (seconds) to say how long the clip should be; the editor page measures the real length the next time the project is opened in it.`
      return null
    },
    run: (c, a) => {
      if (!mediaOf(c, str(a, 'media')!)) {
        const id = str(a, 'media')!, d = compDuration(c.comps[id])
        const inP = num(a, 'in') ?? 0
        const length = num(a, 'length') !== undefined ? snapFrame(num(a, 'length')!) : snapFrame(d - inP)
        if (length < MIN_CLIP - EPS) fail(`length must be at least one frame (${r3(MIN_CLIP)} s).`)
        const clip: TlClip = { id: c.newId(), mediaId: '', comp: id, start: 0, length, offset: inP }
        const laneId = str(a, 'lane'), at = num(a, 'at')
        if (at === undefined && !laneId) return placed(c, appendMedia(c.tracks, 'visual', clip, c.newId()), clip.id)
        return placed(c, place(c, 'visual', clip, at ?? Math.max(0, ...laneOf(c, laneId!).clips.map(endOf)), laneId), clip.id)
      }
      const m = mediaOf(c, str(a, 'media')!)!
      const kind = laneKindFor(m.kind)
      const inP = m.kind === 'image' ? 0 : num(a, 'in') ?? 0
      const lenIn = num(a, 'length')
      const length = lenIn !== undefined ? snapFrame(lenIn) : m.kind === 'image' ? IMAGE_DEFAULT_SECONDS : m.duration - inP
      if (length < MIN_CLIP - EPS) fail(`length must be at least one frame (${r3(MIN_CLIP)} s).`)
      const clip: TlClip = { id: c.newId(), mediaId: m.id, start: 0, length, offset: inP }
      const laneId = str(a, 'lane'), at = num(a, 'at')
      if (at === undefined && !laneId) return placed(c, appendMedia(c.tracks, kind, clip, c.newId()), clip.id)
      const start = at ?? Math.max(0, ...laneOf(c, laneId!).clips.map(endOf))
      return placed(c, place(c, kind, clip, start, laneId), clip.id)
    },
  },
  {
    id: 'clip.move',
    params: [P.clip(), P.at(true, 'New start on the timeline (seconds)'), P.lane(false, 'Move it to this lane (same kind as its current lane); omit = stay on its lane')],
    requires: 'The clip\'s lane and the target lane are not locked; the target lane is the same kind.',
    description: 'Move one clip to a new start time and/or another lane of the same kind. If the spot is taken it goes to the nearest free spot on that lane (the reply says where). Group members are not moved along.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      const to = str(a, 'lane')
      if (to) { const l = laneOf(c, to); if (l.kind !== f.lane.kind) return `can't move a clip from a ${f.lane.kind} lane to a ${l.kind} lane — clips only change lanes of the same kind.`; if (l.locked) return lockedMsg(l) }
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, want = snapFrame(num(a, 'at')!)
      c.tracks = moveClip(c.tracks, id, want, str(a, 'lane') ?? null)
      const f = findClip(c.tracks, id)!
      return { id, ids: [id], lane: f.lane.id, data: { start: r3(f.clip.start) }, ...(Math.abs(f.clip.start - want) > EPS ? { note: `that spot was taken; placed at ${r3(f.clip.start)} s (nearest free spot)` } : {}) }
    },
  },
  {
    id: 'clip.split',
    params: [P.clip(), P.at(true, 'Where to cut, on the timeline (seconds); must be at least one frame inside the clip')],
    requires: 'The clip\'s lane is not locked.',
    description: 'Cut one clip in two at a time. The left part keeps the clip id; the new right part\'s id is returned as id ("$<step>").',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      const t = snapFrame(num(a, 'at')!)
      if (t < f.clip.start + MIN_CLIP - EPS || t > endOf(f.clip) - MIN_CLIP + EPS) return `at must be inside the clip, between ${r3(f.clip.start + MIN_CLIP)} and ${r3(endOf(f.clip) - MIN_CLIP)} s (got ${r3(t)}).`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, right = c.newId()
      c.tracks = splitClip(c.tracks, id, num(a, 'at')!, right)
      return { id: right, ids: [id, right], lane: findClip(c.tracks, right)!.lane.id }
    },
  },
  {
    id: 'timeline.split',
    params: [P.at(true, 'Where to cut (seconds)'), { name: 'clips', type: 'clips', note: 'Only cut these clips if any of them is under that time (like Ctrl+B with clips selected); none of them under it, or omitted = cut every clip under it' }],
    requires: 'At least one clip on an unlocked lane covers that time.',
    description: 'Cut every clip under a time on all unlocked lanes (like Ctrl+B with nothing selected), or only the given clips that are under it (Ctrl+B with a selection). Returns the new right-hand clip ids.',
    run: (c, a) => {
      // 第二期：剪辑页 Ctrl+B 也走这条（播放头不在帧格上也一样）——时刻原样交给 splitAtPlayhead（切口在 splitClip 里对齐帧格·离片头片尾不到一帧的照旧不切）
      const raw = num(a, 'at')!, at = snapFrame(raw)
      const before = new Set(c.tracks.flatMap((l) => l.clips.map((x) => x.id)))
      const out = splitAtPlayhead(c.tracks, negSplitSnap() ? at : raw, a.clips ? ids(a, 'clips') : null, c.newId)
      const made = out.flatMap((l) => l.clips.map((x) => x.id)).filter((x) => !before.has(x))
      if (!made.length) fail(`no clip on an unlocked lane covers ${r3(at)} s (cuts must be at least one frame inside a clip).`)
      c.tracks = out
      return { id: made[0], ids: made }
    },
  },
  {
    id: 'clip.delete',
    params: [P.clips()],
    requires: 'None of the clips is on a locked lane.',
    description: 'Delete clips. A lane left empty disappears (except the main lane); a group left with one clip is ungrouped.',
    check: (c, a) => { for (const id of ids(a, 'clips')) editableClip(c, id); return null },
    run: (c, a) => { c.tracks = pruneGroups(removeClips(c.tracks, ids(a, 'clips'))); return { ids: [...ids(a, 'clips')] } },
  },
  {
    id: 'clip.trim',
    params: [P.clip(), { name: 'side', type: 'string', required: true, enum: ['start', 'end'], note: 'Which end to drag' }, P.at(true, 'Where that end should be on the timeline (seconds)')],
    requires: 'The clip\'s lane is not locked.',
    description: 'Drag the start or end of a clip (like pulling its edge): it stops at neighbouring clips, at the source\'s start/end for video/audio, and at one frame long. The reply gives the resulting start/length.',
    check: (c, a) => { editableClip(c, str(a, 'clip')!); return null },
    run: (c, a) => {
      const id = str(a, 'clip')!
      const f = findClip(c.tracks, id)!
      const m = isMediaClip(f.clip) ? mediaOf(c, f.clip.mediaId) : undefined
      const cp = f.clip.comp ? c.comps[f.clip.comp] : undefined // 合成段：素材尾＝合成长度
      const srcDur = cp ? compDuration(cp) : !m || m.kind === 'image' ? Infinity : m.duration > 0 ? m.duration : UNKNOWN_SRC_SECONDS
      const want = snapFrame(num(a, 'at')!)
      c.tracks = trimClip(c.tracks, id, str(a, 'side') === 'start' ? 'l' : 'r', want, srcDur)
      const g = findClip(c.tracks, id)!.clip
      const got = str(a, 'side') === 'start' ? g.start : endOf(g)
      return { id, ids: [id], data: { start: r3(g.start), length: r3(g.length), offset: r3(g.offset) }, ...(Math.abs(got - want) > EPS ? { note: `stopped at ${r3(got)} s (a neighbouring clip, the source's edge or the one-frame minimum is in the way)` } : {}) }
    },
  },
  {
    id: 'clip.setVolume',
    params: [P.clips(), { name: 'volume', type: 'number', required: true, min: 0, max: VOL_MAX, note: 'Volume multiplier: 1 = 100%, 0 = silent, up to 10 = 1000%' }],
    requires: 'Every clip has sound (video/audio, audio not detached) and is not on a locked lane.',
    description: 'Set the volume of video/audio clips.',
    check: (c, a) => {
      for (const id of ids(a, 'clips')) { const f = editableClip(c, id); if (!hasSound(f.clip, kindOf(c))) return `clip "${id}" (${clipKind(c, f.clip)}) has no sound to set — only video/audio clips (whose audio is not detached) do.` }
      return null
    },
    run: (c, a) => { const k = kindOf(c); c.tracks = setClipVolume(c.tracks, ids(a, 'clips'), num(a, 'volume')!, (x) => hasSound(x, k)); return { ids: [...ids(a, 'clips')] } },
  },
  {
    id: 'clip.setFlag',
    params: [P.clips(), { name: 'flag', type: 'string', required: true, enum: ['muted', 'disabled'], note: '"muted" = keep the picture, no sound; "disabled" = clip stays on the lane but is not shown or heard' }, { name: 'on', type: 'boolean', required: true, note: 'true = set, false = clear' }],
    requires: 'Clips are not on a locked lane; "muted" only for clips with sound.',
    description: 'Mute / un-mute or disable / enable clips (right-click menu "Mute" / "Disable").',
    check: (c, a) => {
      for (const id of ids(a, 'clips')) { const f = editableClip(c, id); if (str(a, 'flag') === 'muted' && !hasSound(f.clip, kindOf(c))) return `clip "${id}" (${clipKind(c, f.clip)}) has no sound to mute.` }
      return null
    },
    run: (c, a) => {
      const flag = str(a, 'flag') as 'muted' | 'disabled', on = a.on as boolean
      for (const id of ids(a, 'clips')) if (!!findClip(c.tracks, id)!.clip[flag] !== on) c.tracks = toggleClipFlag(c.tracks, [id], flag)
      return { ids: [...ids(a, 'clips')] }
    },
  },
  {
    id: 'clip.setSpeed',
    params: [P.clip(), { name: 'speed', type: 'number', required: true, min: SPEED_MIN, max: SPEED_MAX, note: 'Source seconds per timeline second (2 = twice as fast, the clip gets half as long)' }],
    requires: 'A video/audio clip, not a freeze frame, lane not locked.',
    description: 'Change the speed of a video/audio clip. Its timeline length follows; clips right behind it are pushed so nothing overlaps. Replaces a curve speed.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      const k = f.clip.comp ? 'video' : isMediaClip(f.clip) ? mediaOf(c, f.clip.mediaId)?.kind : undefined
      if (k !== 'video' && k !== 'audio') return `clip "${f.clip.id}" is ${clipKind(c, f.clip)} — only video/audio clips have a speed (composition clips too).`
      if (f.clip.freeze) return `clip "${f.clip.id}" is a freeze frame — it has no speed.`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!
      const k = kindOf(c)
      c.tracks = patchClips(c.tracks, [id], { speed: num(a, 'speed')! }, (x) => k(x.mediaId) !== 'image')
      const g = findClip(c.tracks, id)!.clip
      return { id, ids: [id], data: { length: r3(g.length), speed: g.speed ?? 1 } }
    },
  },
  {
    id: 'clip.setFx',
    params: [P.clip(), { name: 'fx', type: 'string', required: true, note: 'Effect id (catalog.list kind "effect")' }, { name: 'strength', type: 'number', min: 0, max: 1, note: 'Strength 0..1 (new effects start at 1)' }, { name: 'remove', type: 'boolean', note: 'true = take this effect off the clip' }],
    requires: `A video/image clip on a visual lane, lane not locked; at most ${FX_MAX_PER_CLIP} effects per clip.`,
    description: 'Put an effect on a video/image clip (or change its strength, or remove it with remove:true).',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      if (!decoratable(f.lane, f.clip)) return `effects only go on video/image clips on visual lanes ("${f.clip.id}" is ${clipKind(c, f.clip)} on a ${f.lane.kind} lane).`
      const fx = str(a, 'fx')!
      if (fxById(fx)?.kind !== 'effect') return `unknown effect "${fx}" — see catalog.list {"kind":"effect"}.`
      const has = !!f.clip.fx?.some((x) => x.fx === fx)
      if (a.remove === true) return has ? null : `clip "${f.clip.id}" doesn't have effect "${fx}".`
      if (!has && (f.clip.fx?.length ?? 0) >= FX_MAX_PER_CLIP) return `clip "${f.clip.id}" already has ${FX_MAX_PER_CLIP} effects — remove one first.`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, fx = str(a, 'fx')!
      if (a.remove === true) { c.tracks = removeEffect(c.tracks, id, fx); return { id, ids: [id] } }
      if (!findClip(c.tracks, id)!.clip.fx?.some((x) => x.fx === fx)) c.tracks = addEffect(c.tracks, id, fx)
      const s = num(a, 'strength')
      if (s !== undefined) c.tracks = setEffectStrength(c.tracks, id, fx, s)
      return { id, ids: [id] }
    },
  },
  {
    id: 'clip.setTransition',
    params: [P.clip('The LATER clip of the seam; a clip with no clip right before it gets an opening transition (in from black)'), { name: 'transition', type: 'string', required: true, nullable: true, note: 'Transition id (catalog.list kind "transition"); null = remove the transition' }, { name: 'length', type: 'number', min: TRANS_MIN, max: TRANS_MAX, note: 'Seconds across the cut (default: the transition\'s own length, about 0.8); limited by the two clips\' lengths' }],
    requires: 'A video/image clip on a visual lane; lane not locked; clip(s) long enough.',
    description: 'Put a transition on the seam between a clip and the clip right before it on the same lane (or remove it with transition:null). If nothing ends exactly where the clip starts (e.g. the first clip), it is an opening transition: the clip comes in from black over its first `length` seconds (e.g. tr-slats as an opener).',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      if (!decoratable(f.lane, f.clip)) return `transitions only go between video/image clips on visual lanes ("${f.clip.id}" is ${clipKind(c, f.clip)} on a ${f.lane.kind} lane).`
      const t = a.transition
      if (t === null) return f.clip.transIn ? null : `clip "${f.clip.id}" has no transition to remove.`
      if (fxById(t as string)?.kind !== 'transition') return `unknown transition "${String(t)}" — see catalog.list {"kind":"transition"}.`
      const lim = transLimit(f.lane, f.clip)
      if (lim < TRANS_MIN - EPS) return `the clip(s) are too short for a transition (at most ${r3(lim)} s fits, minimum ${TRANS_MIN} s).`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!
      if (a.transition === null) { c.tracks = removeTransition(c.tracks, id); return { id, ids: [id] } }
      const want = num(a, 'length')
      c.tracks = setTransition(c.tracks, id, a.transition as string, want)
      const got = findClip(c.tracks, id)!.clip.transIn!.length
      return { id, ids: [id], data: { length: r3(got) }, ...(want !== undefined && Math.abs(got - snapFrame(want)) > EPS ? { note: `length limited to ${r3(got)} s by the clips' lengths` } : {}) }
    },
  },
  {
    id: 'clip.setAnim',
    params: [P.clip(), ...ANIM_PARAMS('; typewriter ones are text-only')],
    requires: 'A video/image clip on a visual lane or a sticker clip; lane not locked.',
    description: 'Give a video/image clip or a sticker an entrance, exit or loop animation (same library as text animations, without the typewriter ones), or remove one with anim:null. Sticker moves are measured in sticker sizes (a slide moves it about 3 times its long side).',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      //（第 4 条）：贴纸也收·款式同画面片段
      const okSticker = (f.lane.kind === 'sticker' && !!f.clip.sticker) || (f.lane.kind === 'visual' && f.clip.rig?.kind === 'null') // 空物件也收（父层的动画带着子层走）
      if (!okSticker && (f.lane.kind !== 'visual' || !isPicClip(f.clip))) return `clip animations are for video/image clips on visual lanes and for stickers ("${f.clip.id}" is ${clipKind(c, f.clip)}; text clips use text.setAnim).`
      const slot = str(a, 'slot') as TextAnimSlot, an = a.anim
      if (an !== null && !VISUAL_ANIM_LIB[slot].some((d) => d.id === an)) return `unknown ${slot} animation "${String(an)}" for clips — see catalog.list {"kind":"anim-${slot}"} (typewriter ones are text-only).`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, slot = str(a, 'slot') as TextAnimSlot
      const cur = findClip(c.tracks, id)!.clip.anim?.[slot]
      const anim = a.anim === null ? null : { id: a.anim as string, dur: animDur(slot, num(a, 'dur'), cur?.dur) }
      if (findClip(c.tracks, id)!.clip.sticker) { c.tracks = setStickerAnim(c.tracks, id, slot, anim); return { id, ids: [id] } }
      const k = kindOf(c)
      c.tracks = patchClips(c.tracks, [id], { anim: { slot, anim } }, (x) => k(x.mediaId) !== 'image')
      return { id, ids: [id] }
    },
  },
  // ── 画面外观／关键帧／声音淡入淡出／复制／换素材 ──
  {
    id: 'clip.setLook',
    params: [P.clips(),
      { name: 'x', type: 'number', min: -POS_LIM, max: POS_LIM, note: 'Picture centre offset in frame widths (0 = centred, + = right)' },
      { name: 'y', type: 'number', min: -POS_LIM, max: POS_LIM, note: 'Picture centre offset in frame heights (0 = centred, + = up)' },
      { name: 'scale', type: 'number', min: LOOK_SCALE_MIN, max: LOOK_SCALE_MAX, note: 'Uniform scale (1 = fit the frame); makes scaling uniform again' },
      { name: 'sx', type: 'number', min: LOOK_SCALE_MIN, max: LOOK_SCALE_MAX, note: 'Horizontal scale only (makes scaling non-uniform; the other axis keeps its value)' },
      { name: 'sy', type: 'number', min: LOOK_SCALE_MIN, max: LOOK_SCALE_MAX, note: 'Vertical scale only (makes scaling non-uniform)' },
      { name: 'rot', type: 'number', min: -360, max: 360, note: 'Rotation in degrees, clockwise' },
      { name: 'opacity', type: 'number', min: 0, max: 1, note: 'Opacity' },
      { name: 'blend', type: 'string', enum: BLEND_MODES, note: 'Blend mode with the layers below' },
      { name: 'flipH', type: 'boolean', note: 'Mirror left–right' },
      { name: 'flipV', type: 'boolean', note: 'Mirror top–bottom' },
      { name: 'corner', type: 'number', min: 0, max: 100, note: 'Rounded corners 0..100' },
      { name: 'crop', type: 'object', nullable: true, note: 'Crop {l, t, r, b}: fraction cut from each side 0..0.9 (l+r and t+b ≤ 0.95); null = no crop' },
      { name: 'mask', type: 'object', nullable: true, note: `Mask {shape: ${MASK_SHAPES.join('|')}, x?, y? (−${POS_LIM}..${POS_LIM}), w?, h? (0.02..4, frame fractions), rot?, feather? 0..100, radius? 0..100, invert?; stripes only: count? 1..${STRIPE_COUNT_MAX}, gap? 0..0.95 (fraction of each band left empty), progress? 0..1 (0 = all closed, 1 = all open; keyframe it with mask.progress for a blinds reveal), stagger? 0..1 (0 = all bands together, 1 = one after another), ease? ${STRIPE_EASES.join('|')}; angle = rot}; edits the FIRST mask; fields left out keep the current mask (or defaults); null = remove the first mask` },
      { name: 'masks', type: 'array', nullable: true, note: `Replace the whole mask list (up to ${MASKS_MAX}, each like mask with shape required); null = remove all masks. Keyframes (mask.*) apply to the first one` },
      { name: 'maskOp', type: 'string', enum: MASK_OPS, note: 'How several masks combine: and = intersection (default, visible only where every mask keeps it), or = union' },
      { name: 'matte', type: 'object', nullable: true, note: 'Track matte {clip?: id of a clip on another upper lane, lane?: text/sticker/visual lane id (default: nearest text/sticker lane above), mode: alpha|luma, invert?, show?}: this clip shows only through that layer at the same moment; the matte layer itself is not drawn while used (unless show); null = remove. clip.setMatte does the same with checks' },
      { name: 'adjust', type: 'object', note: `Colour adjustments merged in, e.g. {"bright": 20, "sat": -10}: ${ADJ_KEYS.join(', ')} (−100..100; sharpen/clarity/grain/fade 0..100; 0 = off)` },
      { name: 'glow', type: 'object', nullable: true, note: 'Outer glow {color:"#rrggbb", radius 1..100, strength 1..100}; null = off' },
      { name: 'border', type: 'object', nullable: true, note: 'Border {color:"#rrggbb", width 1..100} drawn on the inner edge of the visible picture (follows crop and rounded corners); null = off' },
      { name: 'mblur', type: 'object', nullable: true, note: 'Motion blur {amount 1..100, blend 1..100, passes? 1..4, mode?: "frames" (video: blend previous frames) | "dir" (directional shutter blur along keyframed motion; images always use this)}; null = off' },
    ],
    requires: 'Video/image clips on visual lanes (an adjustment layer takes only "adjust"); lanes not locked.',
    description: 'Change how video/image clips look in the picture: position, scale, rotation, opacity, blend mode, mirror, rounded corners, crop, mask and colour adjustments. These are the base values; a property that has keyframes follows its keyframes instead (see clip.setKeyframe). Fade the picture in/out with clip.setAnim (in-fade / out-fade).',
    check: (c, a) => {
      const given = Object.keys(a).filter((k) => k !== 'clips')
      if (!given.length) return 'give at least one property to change (x, y, scale, sx, sy, rot, opacity, blend, flipH, flipV, corner, crop, mask, masks, maskOp, matte, adjust, glow, border, mblur).'
      if (a.scale !== undefined && (a.sx !== undefined || a.sy !== undefined)) return 'give either scale (uniform) or sx / sy (non-uniform), not both.'
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        if (f.clip.adjust) { if (given.some((k) => k !== 'adjust')) return `clip "${id}" is an adjustment layer — only "adjust" applies to it.`; continue }
        if (f.lane.kind === 'visual' && (f.clip.shape || f.clip.solid || f.clip.bgfx || f.clip.rig?.kind === 'null')) { const bad = given.filter((k) => !['x', 'y', 'scale', 'sx', 'sy', 'rot', 'opacity'].includes(k)); if (bad.length) return `clip "${id}" is ${clipKind(c, f.clip)} — only x, y, scale, sx, sy, rot, opacity apply (not ${bad.join(', ')}).`; continue }
        if (f.lane.kind !== 'visual' || !isPicClip(f.clip)) return `clip "${id}" is ${clipKind(c, f.clip)}; clip.setLook is for video/image clips (and composition clips) on visual lanes (text uses text.update, stickers sticker.update).`
      }
      lookPatchOf(a)
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips'), base = lookPatchOf(a)
      for (const id of list) {
        const x = findClip(c.tracks, id)!.clip, cur = lookOf(x)
        const look: LookPatch = { ...base }
        if (num(a, 'scale') !== undefined) { look.sx = look.sy = num(a, 'scale'); look.uniform = true }
        if (num(a, 'sx') !== undefined || num(a, 'sy') !== undefined) { look.sx = num(a, 'sx') ?? cur.sx; look.sy = num(a, 'sy') ?? (cur.uniform ? cur.sx : cur.sy); look.uniform = false }
        c.tracks = patchClips(c.tracks, [id], { look }, () => false)
      }
      const keyed = list.filter((id) => { const x = findClip(c.tracks, id)!.clip; return !!x.kf && Object.keys(x.kf).some((p) => ['x', 'y', 'rot', 'opacity'].includes(p) && a[p] !== undefined || (p === 'sx' || p === 'sy') && (a.scale !== undefined || a[p] !== undefined)) })
      return { id: list[0], ids: list, ...(keyed.length ? { note: `${keyed.join(', ')} already ${keyed.length > 1 ? 'have' : 'has'} keyframes on some of these properties — those follow the keyframes, not this base value (change them with clip.setKeyframe).` } : {}) }
    },
  },
  {
    // 轨道遮罩（AE Track Matte）：这段只从遮罩那层同一刻的形状／亮度里露出来·四种＝alpha／alphaInv／luma／lumaInv·遮罩那层本身缺省不画
    id: 'clip.setMatte',
    params: [P.clips(),
      { name: 'mode', type: 'string', enum: MATTE_KINDS, note: 'alpha = show through the matte\'s shape; alphaInv = cut the shape out; luma = show through its brightness; lumaInv = through its darkness (default alpha)' },
      { name: 'matte', type: 'clip', note: 'The clip to use as the matte (on another upper lane of the same timeline: video, image, shape, composition, text or sticker). Give matte, lane or above' },
      { name: 'lane', type: 'lane', note: 'Use whatever is on this lane at each moment (text, sticker or visual lane)' },
      { name: 'above', type: 'boolean', note: 'true = use the lane right above the clip\'s lane (like After Effects)' },
      { name: 'show', type: 'boolean', note: 'true = still draw the matte layer itself (default false: hidden while used)' },
      { name: 'remove', type: 'boolean', note: 'true = take the track matte off' },
    ],
    requires: 'Video/image/composition clips on visual lanes, lanes not locked; the matte is on a different upper lane and is not itself matted by these clips.',
    description: 'Set a track matte on clips: each clip only shows where the matte layer is (alpha), is not (alphaInv), is bright (luma) or dark (lumaInv) at the same moment. The matte layer is hidden while it is used (show:true keeps it). Give exactly one of matte (clip id), lane, above:true — or none for the nearest text/sticker lane above. remove:true takes it off.',
    check: (c, a) => {
      const srcs = ['matte', 'lane', 'above'].filter((k) => a[k] !== undefined && a[k] !== false)
      if (a.remove === true) { if (srcs.length || a.mode !== undefined || a.show !== undefined) return 'remove:true takes no other params.' }
      else if (srcs.length > 1) return 'give only one of matte, lane, above.'
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        if (f.lane.kind !== 'visual' || !isPicClip(f.clip) || f.clip.adjust) return `clip "${id}" is ${clipKind(c, f.clip)}; track mattes are for video/image/composition clips on visual lanes.`
        if (a.remove === true) continue
        const src = a.matte !== undefined ? findClip(c.tracks, str(a, 'matte')!)!.lane : a.lane !== undefined ? laneOf(c, str(a, 'lane')!) : a.above === true ? (laneAbove(c.tracks, f.lane.id) ? laneOf(c, laneAbove(c.tracks, f.lane.id)!) : null) : null
        if (a.above === true && !src) return `there is no text, sticker or visual lane right above lane "${f.lane.id}" — add one, or name the matte clip with matte.`
        if (src) {
          if (src.id === f.lane.id) return `the matte must be on a different lane than clip "${id}".`
          if (src.kind !== 'visual' && src.kind !== 'text' && src.kind !== 'sticker') return `lane "${src.id}" is a ${src.kind} lane — mattes come from visual, text or sticker lanes.`
          const mc = a.matte !== undefined ? findClip(c.tracks, str(a, 'matte')!)!.clip : null
          const back = (mc ? [mc] : src.clips).some((x) => { const m = x.look?.matte; return !!m && (m.clip ? f.lane.clips.some((y) => y.id === m.clip) : m.lane === f.lane.id) })
          if (back) return `the matte layer itself uses lane "${f.lane.id}" as its matte — two layers can't matte each other.`
        }
      }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      for (const id of list) {
        const f = findClip(c.tracks, id)!
        let matte: ClipMatte | null = null
        if (a.remove !== true) {
          const kindArg = (str(a, 'mode') as MatteKind | undefined) ?? (f.clip.look?.matte ? matteKindOf(f.clip.look.matte) : 'alpha')
          matte = { ...matteFromKind(kindArg) } as ClipMatte
          if (a.matte !== undefined) matte.clip = str(a, 'matte')
          else if (a.lane !== undefined) matte.lane = str(a, 'lane')
          else if (a.above === true) matte.lane = laneAbove(c.tracks, f.lane.id)!
          if (a.show === true) matte.show = true
        }
        c.tracks = patchClips(c.tracks, [id], { look: { matte } }, () => false)
      }
      return { id: list[0], ids: list }
    },
  },
  {
    id: 'clip.setCornerPin',
    params: [P.clips(),
      { name: 'pin', type: 'object', nullable: true, required: true, note: `Corner pin {x0?,y0?,x1?,y1?,x2?,y2?,x3?,y3?}: offset of each frame corner (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) in frame widths (x) / heights (y, + = down), −${PIN_LIM}..${PIN_LIM}; fields left out keep their value (0 when turning it on); {} = on with no warp; null = off. Corners with keyframes (pin.x0..pin.y3, see clip.setKeyframe) follow the keyframes.` }],
    requires: 'Video/image clips on visual lanes, or text / sticker clips; lanes not locked.',
    description: 'Perspective-warp (corner pin) the whole rendered layer of a clip: drag each of its four corners anywhere, e.g. to put it on a slanted screen. Preview and export use the same homography.',
    check: (c, a) => {
      const pin = a.pin
      if (pin !== null && (typeof pin !== 'object' || Array.isArray(pin))) return 'pin must be an object {x0..y3} or null.'
      if (pin) for (const [k, v] of Object.entries(pin as Record<string, unknown>)) {
        if (!(PIN_KEYS as readonly string[]).includes(k)) return `unknown pin field "${k}" (use ${PIN_KEYS.join(', ')}).`
        if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > PIN_LIM) return `pin.${k} must be a number in −${PIN_LIM}..${PIN_LIM}.`
      }
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        const ok = (f.lane.kind === 'visual' && isPicClip(f.clip) && !f.clip.adjust) || (f.lane.kind === 'text' && !!f.clip.text) || (f.lane.kind === 'sticker' && !!f.clip.sticker)
        if (!ok) return `clip "${id}" is ${clipKind(c, f.clip)}; clip.setCornerPin is for video/image, text and sticker clips.`
      }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      c.tracks = patchClips(c.tracks, list, { look: { pin: a.pin === null ? null : { ...(a.pin as Record<string, number>) } } }, () => false)
      return { id: list[0], ids: list }
    },
  },
  {
    id: 'clip.setRotateXY',
    params: [P.clips(),
      { name: 'rotX', type: 'number', min: -ROT3D_LIM, max: ROT3D_LIM, note: 'Tilt around the horizontal axis in degrees (+ = bottom edge goes away)' },
      { name: 'rotY', type: 'number', min: -ROT3D_LIM, max: ROT3D_LIM, note: 'Turn around the vertical axis in degrees (+ = right edge goes away)' },
      { name: 'dist', type: 'number', min: ROT3D_D_MIN, max: ROT3D_D_MAX, note: `Perspective distance in frame heights (smaller = stronger perspective; default ${ROT3D_DEFAULT.d})` },
      { name: 'off', type: 'boolean', note: 'true = remove 3D rotation and corner pin' }],
    requires: 'Video/image clips on visual lanes; lanes not locked.',
    description: 'Rotate video/image clips in 3D (rotX / rotY + perspective distance). Converted into the four corner-pin corners (look.pin, same as clip.setCornerPin) using the frame ratio; keyframe the result with pin.x0..pin.y3. Preview and export use the same homography.',
    check: (c, a) => {
      if (a.off !== true && num(a, 'rotX') === undefined && num(a, 'rotY') === undefined) return 'give rotX and/or rotY (degrees), or off: true.'
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        if (!(f.lane.kind === 'visual' && isPicClip(f.clip) && !f.clip.adjust)) return `clip "${id}" is ${clipKind(c, f.clip)}; clip.setRotateXY is for video/image/composition clips.`
      }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      const aspect = ratioOf(c.ratio, null) ?? 16 / 9
      for (const id of list) {
        const cur = lookOf(findClip(c.tracks, id)!.clip).rot3d ?? ROT3D_DEFAULT
        const r = { x: num(a, 'rotX') ?? cur.x, y: num(a, 'rotY') ?? cur.y, d: num(a, 'dist') ?? cur.d }
        c.tracks = patchClips(c.tracks, [id], { look: a.off === true ? { rot3d: null, pin: null } : { rot3d: r, pin: rot3dToPin(r, aspect) } }, () => false)
      }
      return { id: list[0], ids: list }
    },
  },
  {
    id: 'clip.followTrack',
    params: [P.clips(),
      { name: 'track', type: 'string', nullable: true, required: true, note: 'Motion-tracking path id (mtrack[].id on a video clip, see timeline.list / project JSON); null = stop following.' },
      P.at(false, 'Timeline time at which the clip stays exactly where it is now (default: start of each clip)')],
    requires: 'Text or sticker clips; lanes not locked; a video clip carrying that tracking path (made in the editor\'s Tracking tab).',
    description: 'Make text / sticker clips follow a motion-tracking path: the whole layer moves (and scales about the tracked point) with the tracked area; content, font and style stay editable. Preview and export use the same calculation.',
    check: (c, a) => {
      const track = a.track
      if (track !== null && typeof track !== 'string') return 'track must be a path id string or null.'
      const host = typeof track === 'string' ? followChoices(c.tracks).find((x) => x.track === track) : null
      if (typeof track === 'string' && !host) return `no motion-tracking path "${track}" on any video clip (paths: ${followChoices(c.tracks).map((x) => x.track).join(', ') || 'none'}).`
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        if (!((f.lane.kind === 'text' && f.clip.text) || (f.lane.kind === 'sticker' && f.clip.sticker))) return `clip "${id}" is ${clipKind(c, f.clip)}; clip.followTrack is for text and sticker clips.`
      }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      const host = typeof a.track === 'string' ? followChoices(c.tracks).find((x) => x.track === a.track)! : null
      for (const id of list) {
        const f = editableClip(c, id)
        const fo = host ? bindFollow(c.tracks, host.clip, host.track, typeof a.at === 'number' ? a.at : f.clip.start) : null
        c.tracks = patchClips(c.tracks, [id], { follow: fo }, () => false)
      }
      return { id: list[0], ids: list }
    },
  },
  // ── 空物件／父子连结／表达式／3D 摄影机灯光（rig.pure·expr.pure）──
  {
    id: 'null.add',
    params: [P.at(true, 'Start on the timeline (seconds)'), P.length(RIG_DEFAULT_SECONDS),
      { name: 'x', type: 'number', min: -POS_LIM, max: POS_LIM, note: 'Offset from the frame centre in frame widths (+ = right; default 0)' },
      { name: 'y', type: 'number', min: -POS_LIM, max: POS_LIM, note: 'Offset from the frame centre in frame heights (+ = up; default 0)' },
      { name: 'd3', type: 'boolean', note: 'true = make it a 3D null (so 3D children follow its depth and 3D rotation)' },
      P.lane(false, 'Visual lane to use; omit = the editor picks')],
    requires: 'A chosen lane must be a visual lane and not locked.',
    description: 'Add a null object: an invisible controller clip on a visual lane (the editor preview shows a dashed box; export draws nothing). Animate it with clip.setLook / clip.setKeyframe / clip.setAnim (x, y, sx, sy, rot, opacity) and attach other clips to it with clip.setParent — they then move, scale and rotate with it.',
    check: (c, a) => { laneFits(c, str(a, 'lane'), 'visual', 'null objects'); return null },
    run: (c, a) => {
      const clip = newNullClip(c.newId())
      clip.length = snapFrame(num(a, 'length') ?? RIG_DEFAULT_SECONDS)
      const look: Record<string, number> = {}
      if (num(a, 'x')) look.x = num(a, 'x')!
      if (num(a, 'y')) look.y = num(a, 'y')!
      if (Object.keys(look).length) clip.look = look
      if (a.d3 === true) clip.d3 = {}
      return placed(c, place(c, 'visual', clip, num(a, 'at')!, str(a, 'lane')), clip.id)
    },
  },
  {
    id: 'clip.setParent',
    params: [P.clips(), { name: 'parent', type: 'clip', required: true, nullable: true, note: 'Parent clip id (a video/image, shape, text, sticker or null-object clip); null = detach' },
      { name: 'alpha', type: 'boolean', note: 'true = the parent\'s opacity multiplies into these clips too (default false: only position / scale / rotation)' }],
    requires: 'Video/image, shape/solid/animated-background, text, sticker or null-object clips (cameras and lights may have a parent but cannot be one); lanes not locked; no loops.',
    description: 'Parent clips to another clip: the parent\'s position, scale and rotation at every moment (base values, keyframes, expressions and clip animations) cascade down to them, through the whole parent chain. The child keeps its own transform on top, relative to the parent at rest (parent at its default position/scale/rotation = no change). A chain that would loop back to itself is refused. 3D parents also carry depth and 3D rotation to 3D children.',
    check: (c, a) => {
      const pid = a.parent === null ? null : str(a, 'parent')!
      const pf = pid ? clipOf(c, pid) : null
      if (pf && !canParent(pf.clip, pf.lane.kind)) return `clip "${pid}" is ${clipKind(c, pf.clip)} — it can't be a parent (use a video/image, shape, text, sticker or null-object clip).`
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        if (!canChild(f.clip, f.lane.kind)) return `clip "${id}" is ${clipKind(c, f.clip)}; clip.setParent is for video/image, shape, text, sticker, null-object, camera and light clips.`
        if (pid === id) return `clip "${id}" can't be its own parent.`
        if (pid && parentLoops(c.tracks, id, pid)) return `parenting "${id}" to "${pid}" would make a loop ("${pid}" is already under "${id}") — detach one of them first.`
      }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips'), pid = a.parent === null ? null : str(a, 'parent')!
      for (const id of list) c.tracks = patchRigClip(c.tracks, id, { parent: pid, ...(pid ? { parentAlpha: a.alpha === true } : {}) })
      return { id: list[0], ids: list }
    },
  },
  {
    id: 'clip.setExpression',
    params: [P.clip(), { name: 'prop', type: 'string', required: true, note: 'Property to drive — any keyframable property of this clip (same names as clip.setKeyframe values; 3D layers also d3.z, d3.rx, d3.ry, d3.rz; cameras cam.*; lights lt.*)' },
      { name: 'expr', type: 'string', required: true, nullable: true, note: 'Expression (max 1000 chars); null = remove. Language: numbers, + - * / % **, comparisons, && || !, a ? b : c, var/let/const x = …; (last statement = result). Names: time (timeline seconds), value (the keyframed / base value), thisClip, clip("id"), Math.*, PI. Functions: wiggle(freq, amp, octaves?, ampMult?, t?), loopOut("cycle"|"pingpong", numKeyframes?), linear/ease/easeIn/easeOut(t, tMin, tMax, v1, v2) or (t, v1, v2), clamp(v, lo, hi), noise(x), sin/cos/abs/min/max/… . Clip handles: .start .length .end .offset and any property (.x .y .sx .rot .opacity .tx … .z .rx .ry .rz) or .prop("name", t?) = that clip\'s value now (or at t).' }],
    requires: 'A clip with that keyframable property; lane not locked; the expression must parse.',
    description: 'Drive one property of a clip with an expression, evaluated every frame in a sandbox (no globals, no network, step and time limits). If it fails at some moment the property falls back to its keyframed / base value there (the editor panel shows the error in red). Examples: "wiggle(2, 0.03)" on x; "value + time * 30" on rot; "loopOut(\'pingpong\')"; "clip(\'abc\').x * -1".',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!), p = str(a, 'prop')!
      const can = exprPropsFor(f.clip, f.lane.kind)
      if (!can.includes(p as KfProp)) return can.length ? `"${p}" can't take an expression on this ${clipKind(c, f.clip)} clip — it takes ${can.join(', ')}.` : `clip "${f.clip.id}" (${clipKind(c, f.clip)}) has no properties that take expressions.`
      if (a.expr !== null) { const r = compileExpr(str(a, 'expr')!); if (!r.ok) return `the expression doesn't parse: ${r.err}.` }
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, p = str(a, 'prop') as KfProp
      c.tracks = patchRigClip(c.tracks, id, { expr: { prop: p, src: a.expr === null ? null : str(a, 'expr')! } })
      if (a.expr === null) return { id, ids: [id] }
      // 试算一次（片段开头）：执行错照存（回原值）·回报给角色
      setExprScene(c.tracks)
      const x = findClip(c.tracks, id)!.clip
      const st = exprStatus(x, p, x.start, srcAt(x, x.start), 0)
      const v = st && st.ok ? propValue(x, p, x.start) : null
      return { id, ids: [id], ...(st && !st.ok ? { note: `saved, but at the clip start it fails (${st.err}) — there it falls back to the keyframed / base value.` } : { data: { at: r3(x.start), value: v === null ? null : r3(v) } }) }
    },
  },
  {
    id: 'clip.set3d',
    params: [P.clips(), { name: 'on', type: 'boolean', note: 'false = back to a 2D layer (removes depth, 3D rotation and their keyframes / expressions); default true' },
      { name: 'z', type: 'number', min: -POS3_LIM, max: POS3_LIM, note: 'Depth in frame heights (+ = farther from the camera; 0 = on the picture plane)' },
      { name: 'rx', type: 'number', min: -ROT3_LIM, max: ROT3_LIM, note: 'Tilt around x in degrees (+ = bottom edge goes away)' },
      { name: 'ry', type: 'number', min: -ROT3_LIM, max: ROT3_LIM, note: 'Turn around y in degrees (+ = right edge goes away)' },
      { name: 'rz', type: 'number', min: -ROT3_LIM, max: ROT3_LIM, note: 'Roll around z in degrees, clockwise' }],
    requires: 'Video/image, shape/solid/animated-background, text, sticker or null-object clips; lanes not locked.',
    description: 'Make clips 3D layers: each becomes a flat card in 3D space, seen through the active camera (camera.add; without one a default camera shows depth 0 exactly as 2D) with true perspective, drawn far-to-near among neighbouring 3D layers, and lit by lights (light.add; without lights 3D layers are unlit = unchanged). Keyframe d3.z / d3.rx / d3.ry / d3.rz with clip.setKeyframe. Preview, export and video_edit_frame use the same projection.',
    check: (c, a) => {
      if (a.on !== false && ['z', 'rx', 'ry', 'rz', 'on'].every((k) => a[k] === undefined)) return 'give on, z, rx, ry and/or rz.'
      for (const id of ids(a, 'clips')) { const f = editableClip(c, id); if (!can3d(f.clip, f.lane.kind)) return `clip "${id}" is ${clipKind(c, f.clip)}; only video/image, shape, text, sticker and null-object clips can be 3D.` }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      const d3: Record<string, number> = {}
      for (const k of ['z', 'rx', 'ry', 'rz']) if (num(a, k) !== undefined) d3[k] = num(a, k)!
      for (const id of list) c.tracks = patchRigClip(c.tracks, id, { d3: a.on === false ? null : d3 })
      return { id: list[0], ids: list }
    },
  },
  ...rigCommands(),
  {
    id: 'clip.setKeyframe',
    params: [P.clip(), P.at(true, 'Timeline time of the keyframe (seconds; inside the clip)'),
      { name: 'values', type: 'object', required: true, note: `{property: value}. Video/image clips: sx, sy, x, y, rot, opacity, pin.<x0..y3> (when corner pin is on; text/sticker clips too), mask.<x|y|w|h|rot|feather|radius> (when the clip has a mask), adj.<${KF_ADJ_KEYS.join('|')}>, vol (video only, dB ${DB_MIN}..${DB_MAX}); audio clips: vol; text clips: tx, ty (0..1 like text x/y), ts (scale), trot (degrees), top (opacity); filter clips: flt (strength). Same units as the matching look / text values.` },
      { name: 'ease', type: 'string', enum: EASE_PRESETS, note: 'Easing from this keyframe to the next (default: keep / same as the keyframe before; "linear", "in", "out", "inout", "in2", "out2", "inout2", "backIn", "backOut", "hold")' }],
    requires: 'A video/image, audio, text or filter clip; lane not locked; at inside the clip.',
    description: 'Put a keyframe on a clip (or change the one already at that time). Once a property has keyframes it follows them over the whole clip (before the first / after the last it holds that value). Use two or more keyframes to animate, e.g. scale 1.08 at the start and 1 at +0.4 s with ease "out". Keyframes stay with the clip\'s media time, so they move with the clip.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!), x = f.clip, at = num(a, 'at')!
      const can = kfPropsFor(c, f)
      if (typeof can === 'string') return `clip "${x.id}": ${can}`
      if (at < x.start - EPS || at > endOf(x) + EPS) return `at (${at}) is outside clip "${x.id}" (${r3(x.start)}..${r3(endOf(x))} s).`
      const vals = a.values as Record<string, unknown>
      if (!Object.keys(vals).length) return 'values is empty — give at least one {property: value}.'
      for (const [p, v] of Object.entries(vals)) {
        if (!can.includes(p as KfProp)) return `"${p}" can't be keyframed on this ${clipKind(c, x)} clip — it takes ${can.join(', ')}.`
        const [lo, hi, what] = KF_INFO[p]
        inRange(`values.${p} (${what})`, v, lo, hi)
      }
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, x = findClip(c.tracks, id)!.clip, s = srcAt(x, snapFrame(num(a, 'at')!))
      const kf: KfTracks = { ...(x.kf ?? {}) }
      const e = str(a, 'ease') as Kf['e'] | undefined
      for (const [p, v] of Object.entries(a.values as Record<string, number>)) kf[p as KfProp] = kfPut(kf[p as KfProp], s, v, e)
      swapClip(c, id, (y) => { const n = { ...y }; const k = normalizeKf(kf); if (k) n.kf = k; else delete n.kf; return n })
      const vals = a.values as Record<string, unknown>
      const uni = vals.sy !== undefined && x.look?.uniform !== false
      return { id, ids: [id], ...(uni ? { note: 'scaling on this clip is uniform, so sy follows sx — make it non-uniform first with clip.setLook sx/sy if you need sy separately.' } : {}) }
    },
  },
  {
    id: 'clip.removeKeyframe',
    params: [P.clip(), P.at(true, 'Timeline time of the keyframe to remove (seconds)'), { name: 'props', type: 'strings', note: 'Only these properties (e.g. ["sx","sy"]); omit = every property keyed at that time' }],
    requires: 'Lane not locked; a keyframe at that time.',
    description: 'Remove keyframes at one time on a clip (timeline.list shows each clip\'s keyframes). When a property loses its last keyframe it goes back to its base value.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!), x = f.clip, s = srcAt(x, snapFrame(num(a, 'at')!))
      const props = (a.props as string[] | undefined) ?? Object.keys(x.kf ?? {})
      if (!props.some((p) => kfIndexAt(x.kf?.[p as KfProp], s) >= 0)) return `clip "${x.id}" has no keyframe${a.props ? ` on ${props.join(', ')}` : ''} at ${num(a, 'at')} s — timeline.list shows where its keyframes are.`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, x = findClip(c.tracks, id)!.clip, s = srcAt(x, snapFrame(num(a, 'at')!))
      const props = (a.props as string[] | undefined) ?? Object.keys(x.kf ?? {})
      const kf: KfTracks = { ...(x.kf ?? {}) }
      for (const p of props) if (kfIndexAt(kf[p as KfProp], s) >= 0) kf[p as KfProp] = kfDrop(kf[p as KfProp], s)
      swapClip(c, id, (y) => { const n = { ...y }; const k = normalizeKf(kf); if (k) n.kf = k; else delete n.kf; return n })
      return { id, ids: [id] }
    },
  },
  {
    id: 'clip.pushToBox',
    params: [P.clip('Video/image (or shape / solid / animated background) clip id on a visual lane'), P.at(true, 'Timeline time where the push starts (seconds; inside the clip) — the first keyframe holds the current look'),
      { name: 'box', type: 'object', required: true, note: 'Area of the frame to push into {x, y, w, h}: centre x / y and width / height as fractions of the output frame as it looks at that moment (0..1; x 0 = left, y 0 = top)' },
      { name: 'duration', type: 'number', min: PUSH_DUR_MIN, max: PUSH_DUR_MAX, note: `Seconds of the push (default 1; stops at the clip end)` },
      { name: 'ease', type: 'string', enum: EASE_PRESETS, note: 'Easing of the push (default "inout")' }],
    requires: 'A video/image clip on a visual lane that can take scale / position keyframes; lane not locked; at inside the clip.',
    description: 'Push in ("zoom to box"): puts sx / sy / x / y keyframes on the clip — at "at" the current values, at "at + duration" the values that make the given box exactly fill the frame (uniform scale that fits the box inside the frame, box centre moved to the frame centre). The clip\'s existing position / scale / rotation at that moment is taken into account, so pushing an already zoomed clip again works. Keyframes of these four properties between the two times are replaced.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!), x = f.clip, at = num(a, 'at')!
      const can = kfPropsFor(c, f)
      if (f.lane.kind !== 'visual' || typeof can === 'string' || !can.includes('sx')) return `clip "${x.id}" is ${clipKind(c, f.clip)}; clip.pushToBox needs a picture clip on a visual lane${typeof can === 'string' ? ` (${can})` : ''}.`
      if (at < x.start - EPS || at >= endOf(x) - 1 / 30) return `at (${at}) must be inside clip "${x.id}" (${r3(x.start)}..${r3(endOf(x))} s) with at least one frame left.`
      const b = a.box as Record<string, unknown>
      onlyKeys(b, 'box', ['x', 'y', 'w', 'h'])
      for (const k of ['x', 'y']) inRange(`box.${k}`, b[k], 0, 1)
      for (const k of ['w', 'h']) inRange(`box.${k}`, b[k], 0.01, 1)
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, b = a.box as { x: number; y: number; w: number; h: number }
      const aspect = ratioOf(c.ratio, null) ?? 16 / 9
      const next = applyPushBox(c.tracks, id, snapFrame(num(a, 'at')!), b, num(a, 'duration') ?? 1, (str(a, 'ease') ?? 'inout') as KfEase, aspect)
      if (!next) fail(`clip "${id}" can't be pushed at ${num(a, 'at')} s.`)
      c.tracks = next!
      const x = findClip(c.tracks, id)!.clip
      return { id, ids: [id], data: { keyframes: kfList(x) } }
    },
  },
  {
    id: 'clip.setFade',
    params: [P.clips(), { name: 'in', type: 'number', min: 0, max: FADE_MAX, note: 'Sound fade-in seconds (0 = none; rounded to 0.1 s; at most the clip length)' },
      { name: 'out', type: 'number', min: 0, max: FADE_MAX, note: 'Sound fade-out seconds (0 = none)' }],
    requires: 'Clips with sound (audio, or video with sound); lanes not locked.',
    description: 'Fade a clip\'s sound in and/or out. (To fade the picture, use clip.setAnim in-fade / out-fade.)',
    check: (c, a) => {
      if (num(a, 'in') === undefined && num(a, 'out') === undefined) return 'give in and/or out (seconds).'
      for (const id of ids(a, 'clips')) { const f = editableClip(c, id); if (!hasSound(f.clip, kindOf(c))) return `clip "${id}" (${clipKind(c, f.clip)}) has no sound to fade — for pictures use clip.setAnim in-fade / out-fade.` }
      return null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      c.tracks = patchClips(c.tracks, list, { ...(num(a, 'in') !== undefined ? { fadeIn: num(a, 'in') } : {}), ...(num(a, 'out') !== undefined ? { fadeOut: num(a, 'out') } : {}) }, () => false)
      const capped = list.filter((id) => { const x = findClip(c.tracks, id)!.clip; return (num(a, 'in') ?? 0) > x.length + EPS || (num(a, 'out') ?? 0) > x.length + EPS })
      return { id: list[0], ids: list, ...(capped.length ? { note: `fade limited to the clip length on ${capped.join(', ')}` } : {}) }
    },
  },
  {
    id: 'clip.duplicate',
    params: [P.clip(), { name: 'count', type: 'integer', min: 1, max: 50, note: 'How many copies (default 1)' },
      P.at(false, 'Start of the first copy (seconds); default = right after the original. Copies follow one after another')],
    requires: 'The clip\'s lane is not locked.',
    description: 'Copy a clip (everything: media, in point, look, animations, keyframes, effects, text, sticker…) one or more times, laid end to end on the same lane; a copy that does not fit there goes to a new lane like a drop. Returns the copies\' ids (id = the first copy). Copies are not put in the original\'s group.',
    run: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!), src = f.clip
      let at = num(a, 'at') ?? endOf(src)
      const made: string[] = []
      for (let i = 0; i < (num(a, 'count') ?? 1); i++) {
        const copy: TlClip = { ...(JSON.parse(JSON.stringify(src)) as TlClip), id: c.newId() }
        delete copy.group
        c.tracks = place(c, f.lane.kind, copy, at, f.lane.id)
        at = endOf(findClip(c.tracks, copy.id)!.clip)
        made.push(copy.id)
      }
      return { id: made[0], ids: made, lane: findClip(c.tracks, made[0])!.lane.id, data: made.map((id) => { const g = findClip(c.tracks, id)!; return { id, lane: g.lane.id, start: r3(g.clip.start) } }) }
    },
  },
  {
    id: 'clip.setMedia',
    params: [P.clips(), { name: 'media', type: 'media', required: true, note: 'Media id to put in (media.list, or "$<step>" from media.add)' }],
    requires: 'Video/image/audio clips; lanes not locked. Picture lanes take video/image, audio lanes take video/audio; a video/audio must be at least as long as the clip.',
    description: 'Swap the media inside clips, keeping their place, length, look, animations, keyframes and effects (the replace-media action). The new media plays from its start (in point 0). Clips the media does not fit are skipped (the reply says how many).',
    check: (c, a) => { for (const id of ids(a, 'clips')) { const f = editableClip(c, id); if (!isMediaClip(f.clip)) return `clip "${id}" is ${clipKind(c, f.clip)} — only video/image/audio clips hold media.` } return null },
    run: (c, a) => {
      const list = ids(a, 'clips'), m = mediaOf(c, str(a, 'media')!)!
      const r = replaceMedia(c.tracks, list, { id: m.id, kind: m.kind, duration: m.kind === 'image' ? 0 : m.duration > 0 ? m.duration : Number.MAX_SAFE_INTEGER })
      if (!r.replaced) fail(`"${m.name}" (${m.kind}${m.duration > 0 ? `, ${r3(m.duration)} s` : ''}) fits none of these clips — picture lanes take video/image, audio lanes take video/audio, and a video/audio must be at least as long as the clip.`)
      c.tracks = r.tracks
      return { id: list[0], ids: list, ...(r.skipped ? { note: `${r.skipped} clip${r.skipped > 1 ? 's' : ''} skipped (lane kind or media too short)` } : {}), ...(m.kind !== 'image' && !(m.duration > 0) ? { note: `the length of "${m.name}" is not measured yet — if it is shorter than a clip, that clip will run past its end` } : {}) }
    },
  },
  // ── 编组／解组、分离音频：照页面右键「群组」「取消群组」「分离音频」同一支纯函数 ──
  {
    id: 'clip.group',
    params: [{ name: 'clips', type: 'clips', required: true, note: 'Two or more clip ids ("$<step>" allowed)' }],
    requires: 'At least two clips; none on a locked lane.',
    description: 'Group clips (right-click "Group"): they then select, move, copy and delete together in the editor. A clip already in another group brings that whole group along (the groups merge). Returns the group id in data and all member clip ids in ids.',
    check: (c, a) => {
      for (const id of ids(a, 'clips')) editableClip(c, id)
      return ids(a, 'clips').length < 2 ? 'give at least two clips to group.' : null
    },
    run: (c, a) => {
      const list = ids(a, 'clips')
      if (!canGroup(c.tracks, list)) return { ids: expandGroups(c.tracks, list), data: { group: findClip(c.tracks, list[0])!.clip.group }, note: 'these clips are already one group — nothing changed' }
      const gid = c.newId() // 页面：groupClips(tracks, ids, crypto.randomUUID())
      c.tracks = groupClips(c.tracks, list, gid)
      return { ids: c.tracks.flatMap((l) => l.clips.filter((x) => x.group === gid).map((x) => x.id)), data: { group: gid } }
    },
  },
  {
    id: 'clip.ungroup',
    params: [P.clips()],
    requires: 'At least one of the clips is in a group; none on a locked lane.',
    description: 'Ungroup (right-click "Ungroup"): every group these clips belong to is dissolved — all its members lose the group, not only the clips named. The clips themselves stay where they are. Returns the clips that were ungrouped.',
    check: (c, a) => {
      for (const id of ids(a, 'clips')) editableClip(c, id)
      return ids(a, 'clips').some((id) => !!findClip(c.tracks, id)!.clip.group) ? null : 'none of these clips is in a group (timeline.list shows each clip\'s group).'
    },
    run: (c, a) => {
      const gs = new Set(ids(a, 'clips').map((id) => findClip(c.tracks, id)!.clip.group).filter((g): g is string => !!g))
      const members = c.tracks.flatMap((l) => l.clips.filter((x) => !!x.group && gs.has(x.group)).map((x) => x.id))
      c.tracks = ungroupClips(c.tracks, ids(a, 'clips'))
      return { ids: members }
    },
  },
  {
    id: 'clip.detachAudio',
    params: [P.clips()],
    requires: 'Video clips on picture lanes whose sound is not detached yet; lanes not locked.',
    description: 'Detach the sound of video clips (right-click "Detach audio"): each gets a new audio clip with the same media, start, length, in point, volume, mute, speed and sound fades, placed on an audio lane (the one nearest the main lane; if that time is taken a new audio lane is added below). The video clip stays as picture only (timeline.list shows detached: true) and is silent from then on; edit the sound through the new audio clip. Returns the new audio clip ids (id = the first; "$<step>" refers to it).',
    check: (c, a) => {
      for (const id of ids(a, 'clips')) {
        const f = editableClip(c, id)
        if (canDetach(c.tracks, id, kindOf(c))) continue
        if (f.clip.detached) return `clip "${id}" has already had its sound detached — its sound is the separate audio clip.`
        return `clip "${id}" is ${clipKind(c, f.clip)} on a ${f.lane.kind} lane — only video clips on picture lanes have sound to detach.`
      }
      return null
    },
    run: (c, a) => {
      const r = detachAudio(c.tracks, ids(a, 'clips'), kindOf(c), c.newId, c.newId) // 页面：T.detachAudio(tracks, ids, kindOfMedia, uid, uid)
      c.tracks = r.tracks
      const at = r.ids.map((id) => { const g = findClip(c.tracks, id)!; return { id, lane: g.lane.id, start: r3(g.clip.start), length: r3(g.clip.length) } })
      return { id: r.ids[0], ids: r.ids, lane: at[0].lane, data: at }
    },
  },
  // ── 轨道 ──
  {
    id: 'lane.add',
    params: [{ name: 'kind', type: 'string', required: true, enum: ['visual', 'audio', 'text', 'sticker', 'filter'], note: 'Lane kind' }, { name: 'index', type: 'integer', min: 0, max: 999, note: 'Position top→bottom (0 = top). Non-audio lanes stay above the main lane, audio lanes below it. Default: right above the main lane (audio: at the bottom)' }],
    description: 'Add an empty lane and return its id. Put clips on it in the same batch — empty lanes are removed when the batch ends (like the editor).',
    run: (c, a) => {
      const kind = str(a, 'kind') as LaneKind, i = num(a, 'index')
      const tr = c.tracks, mi = mainIndex(tr)
      const at = kind === 'audio' ? Math.min(tr.length, Math.max(audioStart(tr), i ?? tr.length)) : Math.min(mi, Math.max(0, i ?? mi))
      const id = c.newId()
      c.tracks = pinMain([...tr.slice(0, at), newLane(id, kind), ...tr.slice(at)])
      return { id, lane: id, data: { index: c.tracks.findIndex((l) => l.id === id) } }
    },
  },
  {
    id: 'lane.remove',
    params: [P.lane(true)],
    requires: 'Not the main lane; not locked.',
    description: 'Remove a lane together with all its clips.',
    check: (c, a) => { const l = laneOf(c, str(a, 'lane')!); if (l.id === MAIN_LANE) return 'the main lane can\'t be removed (delete its clips with clip.delete instead).'; return l.locked ? lockedMsg(l) : null },
    run: (c, a) => {
      const l = laneOf(c, str(a, 'lane')!)
      const gone = l.clips.map((x) => x.id)
      c.tracks = pruneGroups(removeClips(c.tracks, gone)).filter((x) => x.id !== l.id)
      return { ids: gone, lane: l.id }
    },
  },
  {
    id: 'lane.move',
    params: [P.lane(true), { name: 'index', type: 'integer', required: true, min: 0, max: 999, note: 'New position top→bottom (0 = top); kept inside its zone (non-audio lanes above main, audio lanes below)' }],
    requires: 'Not the main lane (it stays fixed); not locked.',
    description: 'Change a lane\'s stacking order (upper lanes cover lower ones in the picture).',
    check: (c, a) => { const l = laneOf(c, str(a, 'lane')!); if (l.id === MAIN_LANE) return 'the main lane stays fixed — move the other lanes around it.'; return l.locked ? lockedMsg(l) : null },
    run: (c, a) => {
      const id = str(a, 'lane')!, want = num(a, 'index')!
      c.tracks = moveLane(c.tracks, id, want)
      const got = c.tracks.findIndex((l) => l.id === id)
      return { lane: id, data: { index: got }, ...(got !== want ? { note: `kept inside its zone: now at index ${got}` } : {}) }
    },
  },
  {
    id: 'lane.setFlag',
    params: [P.lane(true), { name: 'flag', type: 'string', required: true, enum: ['locked', 'hidden', 'muted'], note: '"locked" = can\'t be edited; "hidden" = not shown (nor heard); "muted" = not heard' }, { name: 'on', type: 'boolean', required: true, note: 'true = set, false = clear' }],
    requires: '"hidden" not for audio lanes; "muted" only for lanes that can make sound (audio lanes, visual lanes that are empty or hold video).',
    description: 'Lock / hide / mute a whole lane (the lane-header buttons).',
    check: (c, a) => {
      const l = laneOf(c, str(a, 'lane')!)
      const ctl = laneControls(l, kindOf(c))
      if (str(a, 'flag') === 'hidden' && !ctl.eye) return 'audio lanes can\'t be hidden — use "muted".'
      if (str(a, 'flag') === 'muted' && !ctl.speaker) return `lane "${l.id}" makes no sound (${l.kind === 'visual' ? 'only images' : `${l.kind} lane`}) — use "hidden" instead.`
      return null
    },
    run: (c, a) => { const id = str(a, 'lane')!; c.tracks = setLaneFlag(c.tracks, id, str(a, 'flag') as 'locked' | 'hidden' | 'muted', a.on as boolean); return { lane: id } },
  },
  // ── 文字 ──
  {
    id: 'text.add',
    params: [
      { name: 'content', type: 'string', required: true, note: `The text (\\n for line breaks; max ${TEXT_CONTENT_MAX} chars)` },
      P.at(true, 'Start on the timeline (seconds)'), P.length(TEXT_DEFAULT_SECONDS),
      { name: 'fancy', type: 'string', note: 'Fancy text style id (catalog.list kind "fancy"); omit = plain white text' },
      P.x(), P.y(), { name: 'size', type: 'number', min: TEXT_SIZE_MIN, max: TEXT_SIZE_MAX, note: 'Text height as a fraction of the frame height (default 0.1)' },
      P.lane(false, 'Text lane to use; omit = the editor picks (taken ⇒ a new text lane above)'),
    ],
    requires: 'A chosen lane must be a text lane and not locked.',
    description: 'Add a text clip (like the "Default text" card). Style it further with text.update / text.setAnim using "$<step>".',
    check: (c, a) => { laneFits(c, str(a, 'lane'), 'text', 'text clips'); textPatchOf({ content: a.content, fancy: a.fancy }); return null },
    run: (c, a) => {
      const clip = newTextClip(c.newId(), str(a, 'content')!.trim(), str(a, 'fancy') ?? null)
      clip.length = snapFrame(num(a, 'length') ?? TEXT_DEFAULT_SECONDS)
      const pos: Record<string, number> = {}
      for (const k of ['x', 'y', 'size'] as const) if (num(a, k) !== undefined) pos[k] = num(a, k)!
      if (Object.keys(pos).length) clip.text = applyTextPatch(clip.text!, pos)
      return placed(c, place(c, 'text', clip, num(a, 'at')!, str(a, 'lane')), clip.id)
    },
  },
  {
    id: 'text.update',
    params: [P.clip('Text clip id'), ...TEXT_STYLE_PARAMS],
    requires: 'A text clip; lane not locked; at least one field.',
    description: 'Change a text clip\'s words, position, size, style or look (the "Manual" text panel). Give only the fields to change; null puts a field back to the style default.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      if (!f.clip.text) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not text.`
      if (!TEXT_STYLE_PARAMS.some((s) => a[s.name] !== undefined)) return `give at least one field to change (${TEXT_STYLE_PARAMS.map((s) => s.name).join(', ')}).`
      textPatchOf(a)
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!
      const next = patchTexts(c.tracks, [id], textPatchOf(a))
      const note = next === c.tracks ? 'nothing changed (already like that)' : undefined
      c.tracks = next
      return { id, ids: [id], ...(note ? { note } : {}) }
    },
  },
  {
    id: 'text.setAnim',
    params: [P.clip('Text clip id'), ...ANIM_PARAMS(''), { name: 'stagger', type: 'number', min: STAGGER.min, max: STAGGER.max, note: `Per-letter ids (in-pc-* / out-pc-*) only: seconds between one letter and the next (default: automatic = dur × 0.7 ÷ letters, kept within 0.03..0.5); dur stays the whole span` }],
    requires: 'A text clip; lane not locked.',
    description: 'Give a text clip an entrance, exit or loop animation, or remove one with anim:null. Per-letter animations (in-pc-* / out-pc-*: letters fade in, spin, fold, stand up, pop — each letter flips on its own with a 3D look) play letter by letter with "stagger" seconds between letters.',
    check: (c, a) => {
      const f = editableClip(c, str(a, 'clip')!)
      if (!f.clip.text) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not text${isMediaClip(f.clip) ? ' — use clip.setAnim' : ''}.`
      const slot = str(a, 'slot') as TextAnimSlot
      if (a.anim !== null && !animDef(slot, a.anim as string)) return `unknown ${slot} animation "${String(a.anim)}" — see catalog.list {"kind":"anim-${slot}"}.`
      return null
    },
    run: (c, a) => {
      const id = str(a, 'clip')!, slot = str(a, 'slot') as TextAnimSlot
      const cur = findClip(c.tracks, id)!.clip.text!.anim?.[slot]
      const st = num(a, 'stagger') ?? (cur?.id === a.anim ? cur?.stagger : undefined)
      const v = a.anim === null ? null : { id: a.anim as string, dur: animDur(slot, num(a, 'dur'), cur?.dur), ...(st !== undefined ? { stagger: st } : {}) }
      c.tracks = patchTexts(c.tracks, [id], { anim: { [slot]: v } as TextPatch['anim'] })
      return { id, ids: [id] }
    },
  },
  // ── 贴纸／滤镜 ──
  {
    id: 'sticker.add',
    params: [{ name: 'sticker', type: 'string', required: true, note: 'Sticker id (catalog.list kind "sticker")' }, P.at(true, 'Start on the timeline (seconds)'), P.length(STICKER_DEFAULT_SECONDS), P.x(), P.y(),
      { name: 'size', type: 'number', min: STICKER_SIZE_MIN, max: STICKER_SIZE_MAX, note: 'Long side as a fraction of the frame height (default 1/3)' }, P.lane(false, 'Sticker lane to use; omit = the editor picks')],
    requires: 'A known sticker id; a chosen lane must be a sticker lane and not locked.',
    description: 'Add a sticker clip.',
    check: (c, a) => { if (!stickerById(str(a, 'sticker'))) return `unknown sticker "${str(a, 'sticker')}" — see catalog.list {"kind":"sticker"}.`; laneFits(c, str(a, 'lane'), 'sticker', 'stickers'); return null },
    run: (c, a) => {
      const clip = newStickerClip(c.newId(), str(a, 'sticker')!)
      clip.length = snapFrame(num(a, 'length') ?? STICKER_DEFAULT_SECONDS)
      let tr = place(c, 'sticker', clip, num(a, 'at')!, str(a, 'lane'))
      const b = clip.sticker!
      if (num(a, 'x') !== undefined || num(a, 'y') !== undefined) tr = moveSticker(tr, clip.id, num(a, 'x') ?? b.x, num(a, 'y') ?? b.y)
      if (num(a, 'size') !== undefined) tr = resizeSticker(tr, clip.id, num(a, 'size')!)
      return placed(c, tr, clip.id)
    },
  },
  {
    id: 'sticker.update',
    params: [P.clip('Sticker clip id'), P.x(), P.y(), { name: 'size', type: 'number', min: STICKER_SIZE_MIN, max: STICKER_SIZE_MAX, note: 'Long side as a fraction of the frame height' }],
    requires: 'A sticker clip; lane not locked.',
    description: 'Move or resize a sticker in the picture.',
    check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (!f.clip.sticker) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a sticker.`; return ['x', 'y', 'size'].some((k) => a[k] !== undefined) ? null : 'give x, y and/or size.' },
    run: (c, a) => {
      const id = str(a, 'clip')!, b = findClip(c.tracks, id)!.clip.sticker!
      if (num(a, 'x') !== undefined || num(a, 'y') !== undefined) c.tracks = moveSticker(c.tracks, id, num(a, 'x') ?? b.x, num(a, 'y') ?? b.y)
      if (num(a, 'size') !== undefined) c.tracks = resizeSticker(c.tracks, id, num(a, 'size')!)
      return { id, ids: [id] }
    },
  },
  // ── 形状／纯色（画面轨·位置大小旋转不透明度走 clip.setLook／clip.setKeyframe）──
  {
    id: 'shape.add',
    params: [{ name: 'shape', type: 'string', required: true, enum: [...SHAPE_KINDS], note: 'rect = rectangle frame, ellipse = circle/ellipse frame, arrow, line' }, P.at(true, 'Start on the timeline (seconds)'), P.length(SHAPE_DEFAULT_SECONDS), ...SHAPE_PARAMS, P.lane(false, 'Visual lane to use; omit = the editor picks')],
    requires: 'A chosen lane must be a visual lane and not locked.',
    description: 'Add a shape clip (rectangle / ellipse frame, arrow or line) on a visual lane. Move / scale / rotate / fade it with clip.setLook and clip.setKeyframe (x, y, sx, sy, rot, opacity) like a picture clip; grow = seconds of the "stroke grow" entrance (the outline is drawn from its start point to its end). Preview and export draw it with the same code.',
    check: (c, a) => { laneFits(c, str(a, 'lane'), 'visual', 'shapes'); return null },
    run: (c, a) => {
      const clip = newShapeClip(c.newId(), str(a, 'shape') as ShapeKind)
      clip.length = snapFrame(num(a, 'length') ?? SHAPE_DEFAULT_SECONDS)
      clip.shape = parseShape({ ...clip.shape, ...shapeArgs(a) }) ?? clip.shape
      return placed(c, place(c, 'visual', clip, num(a, 'at')!, str(a, 'lane')), clip.id)
    },
  },
  {
    id: 'shape.update',
    params: [P.clip('Shape clip id'), { name: 'shape', type: 'string', enum: [...SHAPE_KINDS], note: 'Change the kind' }, ...SHAPE_PARAMS],
    requires: 'A shape clip; lane not locked.',
    description: 'Change a shape clip: kind, stroke colour / width, fill (null = no fill), corner radius, box size, stroke-grow seconds (0 = off).',
    check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (!f.clip.shape) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a shape.`; return Object.keys(a).some((k) => k !== 'clip') ? null : 'give at least one property.' },
    run: (c, a) => {
      const id = str(a, 'clip')!, cur = findClip(c.tracks, id)!.clip.shape!
      const next: Record<string, unknown> = { ...cur, ...shapeArgs(a), ...(a.shape !== undefined ? { shape: a.shape } : {}) }
      if (a.fill === null) delete next.fill
      c.tracks = c.tracks.map((l) => ({ ...l, clips: l.clips.map((x) => (x.id === id ? { ...x, shape: parseShape(next) ?? cur } : x)) }))
      return { id, ids: [id] }
    },
  },
  {
    id: 'solid.add',
    params: [{ name: 'color', type: 'string', required: true, note: 'Colour #rrggbb (e.g. #000000 black, #ffffff white)' }, P.at(true, 'Start on the timeline (seconds)'), P.length(SOLID_DEFAULT_SECONDS), P.lane(false, 'Visual lane to use; omit = bottom of the picture (main lane; main-lane clips overlapping it move up one lane)')],
    requires: 'A #rrggbb colour; a chosen lane must be a visual lane and not locked.',
    description: 'Add a solid-colour clip that fills the whole frame (a black / white / any colour background — no image needed). Change the colour with solid.update.',
    check: (c, a) => { if (!HEX_RE.test(str(a, 'color') ?? '')) return `color must be #rrggbb (got "${str(a, 'color')}").`; laneFits(c, str(a, 'lane'), 'visual', 'solid colours'); return null },
    run: (c, a) => {
      const clip = newSolidClip(c.newId(), str(a, 'color')!)
      clip.length = snapFrame(num(a, 'length') ?? SOLID_DEFAULT_SECONDS)
      return placeBackground(c, clip, num(a, 'at')!, str(a, 'lane'))
    },
  },
  {
    id: 'solid.update',
    params: [P.clip('Solid-colour clip id'), { name: 'color', type: 'string', required: true, note: 'Colour #rrggbb' }],
    requires: 'A solid-colour clip; lane not locked.',
    description: 'Change the colour of a solid-colour clip.',
    check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (!f.clip.solid) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a solid colour.`; return HEX_RE.test(str(a, 'color') ?? '') ? null : 'color must be #rrggbb.' },
    run: (c, a) => { const id = str(a, 'clip')!; c.tracks = patchSolid(c.tracks, id, str(a, 'color')!); return { id, ids: [id] } },
  },
  // ── 动态背景（程序画·确定性伪随机：同 seed 同一时刻画面一样·预览汇出同一支画法）──
  {
    id: 'bgfx.add',
    params: [{ name: 'kind', type: 'string', required: true, enum: [...BGFX_KINDS], note: 'stars = twinkling star particles drifting slowly; bokeh = soft light blobs drifting' }, P.at(true, 'Start on the timeline (seconds)'), P.length(BGFX_DEFAULT_SECONDS), ...BGFX_PARAMS, P.lane(false, 'Visual lane to use; omit = bottom of the picture (main lane; main-lane clips overlapping it move up one lane)')],
    requires: 'A chosen lane must be a visual lane and not locked.',
    description: 'Add an animated background clip drawn by code (no media needed): "stars" (star particles twinkling and drifting) or "bokeh" (soft light blobs drifting). It fills the frame with bg and draws the particles on top; same seed = same picture at the same time. Move / scale / fade it with clip.setLook / clip.setKeyframe like a picture clip; change it with bgfx.update.',
    check: (c, a) => { laneFits(c, str(a, 'lane'), 'visual', 'animated backgrounds'); return bgfxArgsBad(a) },
    run: (c, a) => {
      const clip = newBgfxClip(c.newId(), str(a, 'kind') as BgfxKind, num(a, 'seed') ?? 1)
      clip.length = snapFrame(num(a, 'length') ?? BGFX_DEFAULT_SECONDS)
      clip.bgfx = parseBgfx({ ...clip.bgfx!, ...bgfxArgs(a) }) ?? clip.bgfx
      return placeBackground(c, clip, num(a, 'at')!, str(a, 'lane'))
    },
  },
  {
    id: 'bgfx.update',
    params: [P.clip('Animated background clip id'), { name: 'kind', type: 'string', enum: [...BGFX_KINDS], note: 'Change the kind' }, ...BGFX_PARAMS],
    requires: 'An animated background clip; lane not locked.',
    description: 'Change an animated background clip: kind, particle colour, background colour, density, speed, seed, parallax.',
    check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); if (!f.clip.bgfx) return `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not an animated background.`; if (!Object.keys(a).some((k) => k !== 'clip')) return 'give at least one property.'; return bgfxArgsBad(a) },
    run: (c, a) => { const id = str(a, 'clip')!; c.tracks = patchBgfx(c.tracks, id, { ...bgfxArgs(a), ...(a.kind !== undefined ? { kind: a.kind as BgfxKind } : {}) }); return { id, ids: [id] } },
  },
  {
    id: 'filter.add',
    params: [{ name: 'filter', type: 'string', required: true, note: 'Filter id (catalog.list kind "filter")' }, P.at(true, 'Start on the timeline (seconds)'), P.length(FILTER_DEFAULT_SECONDS),
      { name: 'strength', type: 'number', min: 0, max: 1, note: 'Strength 0..1 (default 1)' }, P.lane(false, 'Filter lane to use; omit = the editor picks')],
    requires: 'A known filter id; a chosen lane must be a filter lane and not locked.',
    description: 'Add a filter clip: during its time, the picture on the visual lanes below it is colour-graded.',
    check: (c, a) => { if (!filterById(str(a, 'filter'))) return `unknown filter "${str(a, 'filter')}" — see catalog.list {"kind":"filter"}.`; laneFits(c, str(a, 'lane'), 'filter', 'filters'); return null },
    run: (c, a) => {
      const clip = newFilterClip(c.newId(), str(a, 'filter')!)
      clip.length = snapFrame(num(a, 'length') ?? FILTER_DEFAULT_SECONDS)
      let tr = place(c, 'filter', clip, num(a, 'at')!, str(a, 'lane'))
      if (num(a, 'strength') !== undefined) tr = setFilterStrength(tr, clip.id, num(a, 'strength')!)
      return placed(c, tr, clip.id)
    },
  },
  {
    id: 'filter.update',
    params: [P.clip('Filter clip id'), { name: 'strength', type: 'number', required: true, min: 0, max: 1, note: 'Strength 0..1' }],
    requires: 'A filter clip; lane not locked.',
    description: 'Change a filter clip\'s strength.',
    check: (c, a) => { const f = editableClip(c, str(a, 'clip')!); return f.clip.filter ? null : `clip "${f.clip.id}" is ${clipKind(c, f.clip)}, not a filter.` },
    run: (c, a) => { const id = str(a, 'clip')!; c.tracks = setFilterStrength(c.tracks, id, num(a, 'strength')!); return { id, ids: [id] } },
  },
  // ── 巢状合成（precomp）：合成＝另一份轨道·画面轨上一段 {comp} 当影片段放·comp.enter 进去照常用各条命令改 ──
  {
    id: 'comp.list', readOnly: true, params: [],
    description: 'List the nested compositions (precomps) of this project: id, name, ratio, length, how many clips, which composition clips use it; also which timeline the following commands work on (main or the composition entered with comp.enter).',
    run: (c) => {
      stashLevel(c)
      return { data: { level: c.level ?? 'main', comps: Object.entries(c.comps).map(([id, x]) => ({ id, name: x.name, ratio: x.ratio, ...(x.length ? { length: x.length } : {}), duration: r3(compDuration(x)), clips: x.tracks.reduce((n, l) => n + l.clips.length, 0), usedBy: compUsers(c, id), contains: compRefs(x.tracks) })) } }
    },
  },
  {
    id: 'comp.create',
    params: [{ name: 'name', type: 'string', required: true, note: `Name (max ${COMP_NAME_MAX} chars)` }, ...COMP_RATIO_PARAMS,
      { name: 'length', type: 'number', min: MIN_CLIP, max: TIME_MAX, note: 'Seconds (default: end of its last clip)' }],
    requires: `At most ${COMPS_MAX} compositions.`,
    description: 'Make a new empty composition (its own lanes, length and frame ratio). Returns its id; fill it with comp.enter + the usual commands, place it with clip.add {"comp": id}.',
    check: (c, a) => (Object.keys(c.comps).length >= COMPS_MAX ? `there are already ${COMPS_MAX} compositions.` : ratioArgBad(a)),
    run: (c, a) => {
      const id = c.newId()
      const len = num(a, 'length')
      c.comps = { ...c.comps, [id]: { name: str(a, 'name')!.trim().slice(0, COMP_NAME_MAX), ratio: ratioArg(a) ?? { kind: 'fit' }, ...(len !== undefined ? { length: snapFrame(len) } : {}), tracks: [newLane(MAIN_LANE, 'visual')] } }
      return { id }
    },
  },
  {
    id: 'comp.fromClips',
    params: [P.clips(), { name: 'name', type: 'string', note: 'Name of the new composition (default "Comp <n>")' }],
    requires: 'Clips on the current timeline, lanes not locked.',
    description: 'Pre-compose: move these clips (with their lanes, times relative to the earliest one) into a new composition and put one composition clip in their place (on the topmost visual lane among them, or a new lane if that time is taken). Returns the composition id; data.clip = the new composition clip id, lane = its lane.',
    check: (c, a) => {
      if (Object.keys(c.comps).length >= COMPS_MAX) return `there are already ${COMPS_MAX} compositions.`
      for (const id of ids(a, 'clips')) editableClip(c, id)
      return null
    },
    run: (c, a) => {
      const compId = c.newId(), clipId = c.newId()
      const r = precompose(c.tracks, ids(a, 'clips'), { compId, clipId, newId: () => c.newId(), name: (str(a, 'name') ?? '').trim() || `Comp ${Object.keys(c.comps).length + 1}` })
      if (!r) fail('nothing to pre-compose (the clips must cover some time).')
      c.comps = { ...c.comps, [compId]: r!.comp }
      c.tracks = r!.tracks
      const f = findClip(c.tracks, clipId)!
      return { id: compId, ids: [clipId], lane: f.lane.id, data: { clip: clipId, start: r3(f.clip.start), length: r3(f.clip.length) } }
    },
  },
  {
    id: 'comp.update',
    params: [{ name: 'comp', type: 'comp', required: true, note: 'Composition id' }, { name: 'name', type: 'string', note: 'New name' }, ...COMP_RATIO_PARAMS,
      { name: 'length', type: 'number', nullable: true, min: MIN_CLIP, max: TIME_MAX, note: 'Seconds; null = follow its last clip' }],
    description: 'Rename a composition or change its frame ratio or length. Composition clips that use it keep their own start/length.',
    check: (_c, a) => (a.name === undefined && a.ratio === undefined && a.length === undefined ? 'give name, ratio or length.' : ratioArgBad(a)),
    run: (c, a) => {
      const id = str(a, 'comp')!
      stashLevel(c)
      const cur = c.comps[id]
      const next: VeditComp = { ...cur, ...(a.name !== undefined ? { name: str(a, 'name')!.trim().slice(0, COMP_NAME_MAX) } : {}), ...(a.ratio !== undefined ? { ratio: ratioArg(a)! } : {}) }
      if (a.length === null) delete next.length; else if (a.length !== undefined) next.length = snapFrame(num(a, 'length')!)
      c.comps = { ...c.comps, [id]: next }
      if (c.level === id) c.tracks = next.tracks
      return { id, data: { duration: r3(compDuration(next)) } }
    },
  },
  {
    id: 'comp.delete',
    params: [{ name: 'comp', type: 'comp', required: true, note: 'Composition id' }],
    requires: 'No composition clip uses it (delete those clips first) and you are not inside it.',
    description: 'Delete a composition that is no longer used.',
    check: (c, a) => {
      const id = str(a, 'comp')!
      if (c.level === id) return 'you are inside this composition — comp.exit first.'
      const users = compUsers(c, id)
      return users.length ? `composition "${id}" is still used by clip(s) ${users.join(', ')} — delete them first.` : null
    },
    run: (c, a) => { const id = str(a, 'comp')!; stashLevel(c); const { [id]: _d, ...rest } = c.comps; void _d; c.comps = rest; return { id } },
  },
  {
    id: 'comp.enter',
    params: [{ name: 'comp', type: 'comp', required: true, note: 'Composition id' }],
    description: 'Work inside a composition: the following commands of this call (timeline.list, clip.add, text.add, clip.setLook…) read and change that composition\'s lanes instead of the main timeline, until comp.exit or another comp.enter. Like double-clicking a composition clip in the editor.',
    run: (c, a) => { const id = str(a, 'comp')!; enterLevel(c, id); return { id, data: { composition: { id, name: c.comps[id].name } } } },
  },
  {
    id: 'comp.exit', params: [],
    description: 'Go back to the main timeline after comp.enter.',
    run: (c) => { enterLevel(c, null); return { data: { level: 'main' } } },
  },
  ...programCommands(),
  // ── 工程 ──
  {
    id: 'project.setRatio',
    params: [{ name: 'ratio', type: 'string', required: true, enum: ['fit', ...PRESET_KEYS, 'custom'], note: '"fit" = follow the first picture on the main lane; a preset; or "custom" with width/height' },
      { name: 'width', type: 'integer', min: CUSTOM_MIN, max: CUSTOM_MAX, note: 'Pixels (ratio "custom" only)' }, { name: 'height', type: 'integer', min: CUSTOM_MIN, max: CUSTOM_MAX, note: 'Pixels (ratio "custom" only)' }],
    description: 'Set the frame ratio of the video.',
    check: (_c, a) => ratioArgBad(a),
    run: (c, a) => {
      c.ratio = ratioArg(a)!
      return { data: { ratio: c.ratio } }
    },
  },
  {
    id: 'marker.add',
    params: [P.at(true, 'Time of the marker (seconds)')],
    requires: `At most ${MARKER_CAP} markers.`,
    description: 'Put a marker flag on the time ruler.',
    run: (c, a) => {
      const t = snapFrame(num(a, 'at')!)
      const cur = markersOf(c.tracks)
      if (cur.some((x) => Math.abs(x - t) < EPS)) return { data: { at: r3(t) }, note: 'there is already a marker there' }
      if (cur.length >= MARKER_CAP) fail(`there are already ${MARKER_CAP} markers — remove some first.`)
      c.tracks = addMarker(c.tracks, t)
      return { data: { at: r3(t) } }
    },
  },
  {
    id: 'marker.remove',
    params: [P.at(true, 'Time of the marker to remove (seconds)')],
    requires: 'A marker exists at that frame.',
    description: 'Remove the marker at a time.',
    check: (c, a) => { const t = snapFrame(num(a, 'at')!); return markersOf(c.tracks).some((x) => Math.abs(x - t) < EPS) ? null : `no marker at ${r3(t)} s (markers: ${markersOf(c.tracks).map(r3).join(', ') || 'none'}).` },
    run: (c, a) => { const t = snapFrame(num(a, 'at')!); c.tracks = removeMarker(c.tracks, markersOf(c.tracks).find((x) => Math.abs(x - t) < EPS)!); return { data: { at: r3(t) } } },
  },
]
const BY_ID = new Map(DEFS.map((d) => [d.id, d]))

/** 命令表（给角色看：编号、说明、参数、可用条件） */
export function listCommands(): CommandInfo[] {
  return DEFS.map(({ id, description, params, requires, readOnly }) => ({ id, description, params: params.map((p) => ({ ...p })), ...(requires ? { requires } : {}), ...(readOnly ? { readOnly } : {}) }))
}

// ── 参数验值（型别、范围、编号在不在·"$n" 换成前面那步建的编号） ──
const REF_RE = /^\$(\d+)(?:\.(lane))?$/
function resolveRef(v: string, kind: 'clip' | 'lane' | 'media' | 'comp' | 'program', step: number, results: StepResult[]): string {
  const m = REF_RE.exec(v.trim())
  if (!m) return v.trim()
  const n = Number(m[1])
  if (n >= step) fail(`"${v}" refers to step ${n}, which has not run yet (steps count from 0; this is step ${step}).`)
  const r = results[n]
  // "$n.lane"＝那步片段落在哪条轨；轨道参数给 "$n" ⇒ 那步的轨（lane.add 建的那条·或那步片段所在的轨）；其余 ⇒ 那步建的主编号
  const wantLane = m[2] === 'lane' || kind === 'lane'
  const got = m[2] === 'lane' ? r.lane : kind === 'lane' ? (r.lane ?? r.id) : r.id
  if (!got) fail(`"${v}": step ${n} (${r.command}) made no ${wantLane ? 'lane' : 'id'} to refer to.`)
  return got as string
}
function validate(def: Def, raw: unknown, c: Ctx, step: number, results: StepResult[]): Args {
  if (raw !== undefined && raw !== null && !isObj(raw)) fail('params must be an object.')
  const given = (raw ?? {}) as Record<string, unknown>
  const names = def.params.map((p) => p.name)
  const unknown = Object.keys(given).filter((k) => !names.includes(k))
  if (unknown.length) fail(`unknown param ${unknown.map((k) => `"${k}"`).join(', ')} — ${def.id} takes ${names.length ? names.join(', ') : 'no params'}.`)
  const out: Args = {}
  for (const p of def.params) {
    let v = given[p.name]
    if (v === undefined) { if (p.required) fail(`missing param "${p.name}" (${p.note}).`); continue }
    if (v === null) { if (!p.nullable) fail(`"${p.name}" can't be null (${p.note}).`); out[p.name] = null; continue }
    const bad = (want: string): never => fail(`"${p.name}" must be ${want} (got ${JSON.stringify(v)?.slice(0, 80)}).`)
    switch (p.type) {
      case 'number': case 'integer': {
        if (typeof v !== 'number' || !Number.isFinite(v)) bad(p.type === 'integer' ? 'a whole number' : 'a number')
        if (p.type === 'integer' && !Number.isInteger(v)) bad('a whole number')
        if ((p.min !== undefined && (v as number) < p.min - EPS) || (p.max !== undefined && (v as number) > p.max + EPS)) bad(`between ${r3(p.min ?? -Infinity)} and ${r3(p.max ?? Infinity)}`)
        break
      }
      case 'boolean': if (typeof v !== 'boolean') bad('true or false'); break
      case 'string': {
        if (typeof v !== 'string' || !v.trim()) bad('a non-empty string')
        if (p.enum && !p.enum.includes(v as string)) bad(`one of ${p.enum.map((x) => `"${x}"`).join(', ')}`)
        break
      }
      case 'object': if (!isObj(v)) bad('an object'); break
      case 'array': if (!Array.isArray(v)) bad('an array'); break
      case 'strings': {
        const list = typeof v === 'string' ? [v] : Array.isArray(v) ? v : bad('a string or an array of strings')
        if (!(list as unknown[]).length || (list as unknown[]).some((x) => typeof x !== 'string' || !x.trim())) bad('a non-empty string or array of non-empty strings')
        v = [...new Set((list as string[]).map((x) => x.trim()))]
        break
      }
      case 'clip': case 'lane': case 'media': case 'comp': case 'source': case 'program': {
        if (typeof v !== 'string' || !v.trim()) bad(`a ${p.type === 'comp' ? 'composition' : p.type === 'source' ? 'media' : p.type} id`)
        v = resolveRef(v as string, p.type === 'source' ? 'media' : p.type, step, results)
        if (p.type === 'clip') clipOf(c, v as string)
        else if (p.type === 'lane') laneOf(c, v as string)
        else if (p.type === 'comp') compOf(c, v as string)
        else if (p.type === 'program') pkgOf(c, v as string)
        else if (p.type === 'source' && c.comps[v as string] && !mediaOf(c, v as string)) { /* 合成编号 */ }
        else if (!mediaOf(c, v as string)) fail(`media "${v}" is not in this project — add it with media.add, or pick one from media.list.`)
        break
      }
      case 'clips': {
        const list = typeof v === 'string' ? [v] : Array.isArray(v) ? v : bad('a clip id or an array of clip ids')
        if (!(list as unknown[]).length || (list as unknown[]).length > 200) bad('1 to 200 clip ids')
        const res = (list as unknown[]).map((x) => { if (typeof x !== 'string' || !x.trim()) bad('clip id strings'); return resolveRef(x as string, 'clip', step, results) })
        for (const id of res) clipOf(c, id)
        v = [...new Set(res)]
        break
      }
    }
    out[p.name] = v
  }
  return out
}

// ── 结果过 parseProject：比对用的规范字串（键排序·undefined 去掉） ──
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])]))
  return v
}
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (isObj(a) && isObj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d } }
  if (Array.isArray(a) && Array.isArray(b)) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d } }
  return path || '(root)'
}
const defaultId = () => globalThis.crypto.randomUUID()

/** 命令改的那几样（轨道、比例、素材清单）——角色那条（applyCommands·整份工程档）与剪辑页人手那条（第二期·页面现况）共用同一支 applyCommandsState */
/** comps＝子合成（缺＝没有·页面人手那条只改眼前那一层·不带） */
export type CmdState = { tracks: Tracks; ratio: RatioSel; media: readonly ProjectMedia[]; comps?: Comps; programs?: Readonly<Record<string, ProjectProgram>> }
/** programs＝工程内嵌的程序包（u-…·program.define 加·program.add 认）；页面那条没给 ⇒ 当没有 */
export type StateResult = { ok: true; state: CmdState; results: StepResult[] } | { ok: false; step: number; command?: string; error: string }
/** 对一份现况跑一批命令（全有或全无·⛔ 收空轨、⛔ 过 parseProject——那两道由调用方做：角色那条在 applyCommands、页面那条在页面入账） */
export function applyCommandsState(state: CmdState, steps: readonly CommandStep[], opts: RunOpts = {}): StateResult {
  if (!Array.isArray(steps) || !steps.length) return { ok: false, step: -1, error: 'steps must be a non-empty array of {command, params}.' }
  if (steps.length > VEDIT_STEPS_MAX) return { ok: false, step: -1, error: `at most ${VEDIT_STEPS_MAX} steps per call (got ${steps.length}) — split the work into several calls.` }
  const newId = opts.newId ?? defaultId
  const c: Ctx = { tracks: state.tracks, root: state.tracks, level: null, comps: { ...(state.comps ?? {}) }, ratio: state.ratio, media: [...state.media], programs: { ...(state.programs ?? {}) }, newId: () => { const id = newId(); if (!PROJECT_ID_RE.test(id)) throw new Error(`bad id ${id}`); return id }, step: 0, ...(opts.webShots ? { webShots: opts.webShots } : {}), ...(opts.tts ? { tts: opts.tts } : {}), ...(opts.sfx ? { sfx: opts.sfx } : {}) }
  const results: StepResult[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as CommandStep | undefined
    const name = isObj(s) && typeof s.command === 'string' ? s.command.trim() : ''
    const def = BY_ID.get(name)
    if (!def) return { ok: false, step: i, ...(name ? { command: name } : {}), error: name ? `unknown command "${name}" — list them with video_edit_commands.` : 'each step needs {"command": "<id>", "params": {…}}.' }
    c.step = i
    try {
      const args = validate(def, (s as CommandStep).params, c, i, results)
      const why = def.check ? def.check(c, args) : null
      if (why) fail(why)
      const out = def.run(c, args)
      results.push({ step: i, command: name, ...out })
    } catch (e) {
      if (e instanceof CmdError) return { ok: false, step: i, command: name, error: e.message }
      throw e
    }
  }
  stashLevel(c) // 停在合成里也照样存回（下一批从主时间轴起）
  return { ok: true, state: { tracks: c.root, ratio: c.ratio, media: c.media, programs: c.programs, ...(state.comps || Object.keys(c.comps).length ? { comps: c.comps } : {}) }, results }
}

/** 跑一批命令（全有或全无）：project＝读到的那份工程；成功回新工程＋每步结果；哪步不合 ⇒ 回第几步与白话原因（工程不动） */
export function applyCommands(project: unknown, steps: readonly CommandStep[], opts: RunOpts = {}): RunResult {
  if (!Array.isArray(steps) || !steps.length) return { ok: false, step: -1, error: 'steps must be a non-empty array of {command, params}.' }
  if (steps.length > VEDIT_STEPS_MAX) return { ok: false, step: -1, error: `at most ${VEDIT_STEPS_MAX} steps per call (got ${steps.length}) — split the work into several calls.` }
  const base = parseProject(project)
  if (!base.ok) return { ok: false, step: -1, error: `the project could not be read: ${base.err}` }
  const ran = applyCommandsState({ tracks: base.project.tracks, ratio: base.project.ratio, media: base.project.media, programs: base.project.programs, ...(base.project.comps ? { comps: base.project.comps } : {}) }, steps, opts)
  if (!ran.ok) return ran
  const { state: c, results } = ran
  // 合成里的空轨也收（同主时间轴）
  const comps = c.comps && Object.keys(c.comps).length ? Object.fromEntries(Object.entries(c.comps).map(([k, x]) => [k, { ...x, tracks: pruneLanes(x.tracks) }])) : undefined
  const { comps: _bc, ...baseRest } = base.project
  void _bc
  const draft: VeditProject = { ...baseRest, ratio: c.ratio, media: [...c.media], tracks: pruneLanes(c.tracks), programs: { ...(c.programs ?? {}) }, ...(comps ? { comps } : {}) }
  const check = parseProject(JSON.parse(JSON.stringify(draft)))
  if (!check.ok) return { ok: false, step: steps.length - 1, error: `the result failed the project check: ${check.err}` }
  if (check.drops.length) return { ok: false, step: steps.length - 1, error: `the result would lose items when saved: ${check.drops.slice(0, 5).join('; ')}` }
  const d = firstDiff(canon(JSON.parse(JSON.stringify(draft))), canon(check.project))
  if (d) return { ok: false, step: steps.length - 1, error: `the result would be changed when saved (at ${d}) — nothing was applied.` }
  return { ok: true, project: check.project, results, changed: JSON.stringify(canon(check.project)) !== JSON.stringify(canon(base.project)) }
}

// ── 网页截图：video_edit_run 套命令前先挑出 media.webShot 那几步、验好参数（服务端照这份去截） ──
export const WEB_SHOTS_PER_CALL = 3
export type WebShotPlan = { step: number; opts: WebShotOpts; name: string | null; folderId: string | null }
/** 挑出一批里的 media.webShot：参数不合 ⇒ 回第几步与白话原因（什么都不截）；超过每批上限 ⇒ 拒 */
export function planWebShots(steps: readonly unknown[]): { ok: true; plans: WebShotPlan[] } | { ok: false; step: number; error: string } {
  const plans: WebShotPlan[] = []
  if (!Array.isArray(steps)) return { ok: true, plans }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isObj(s) || typeof s.command !== 'string' || s.command.trim() !== 'media.webShot') continue
    const p = isObj(s.params) ? s.params : {}
    const r = parseWebShotOpts({ url: p.url, scale: p.scale, theme: p.theme, width: p.width, full: p.full })
    if (!r.ok) return { ok: false, step: i, error: `media.webShot: ${WEB_SHOT_PARAM_TEXT[r.code]}` }
    const folder = typeof p.folder_id === 'string' && p.folder_id.trim() ? p.folder_id.trim() : null
    if (folder && !DRIVE_ID_RE.test(folder)) return { ok: false, step: i, error: `media.webShot: folder_id "${folder}" is not a drive folder id — use one from list_drive.` }
    plans.push({ step: i, opts: r.opts, name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 200) : null, folderId: folder })
  }
  if (plans.length > WEB_SHOTS_PER_CALL) return { ok: false, step: plans[WEB_SHOTS_PER_CALL].step, error: `at most ${WEB_SHOTS_PER_CALL} media.webShot steps per call — split them into several calls.` }
  return { ok: true, plans }
}
const WEB_SHOT_PARAM_TEXT: Record<string, string> = {
  bad_body: 'params must be an object.',
  url_missing: 'missing param "url" (a public http(s) address).',
  url_too_long: 'url is too long.',
  url_invalid: 'url is not a valid address.',
  url_protocol: 'only http:// and https:// pages can be captured.',
  bad_scale: '"scale" must be 2 or 3.',
  bad_theme: '"theme" must be "light" or "dark".',
  bad_width: `"width" must be a whole number between ${WEB_SHOT_WIDTH_MIN} and ${WEB_SHOT_WIDTH_MAX}.`,
  bad_full: '"full" must be true or false.',
}

// ── 朗读配音／内建音效：video_edit_run 套命令前先挑出 media.tts、sfx.add 那几步、验好参数（服务端照这份去合成／算 WAV） ──
export type TtsPlan = { step: number; req: TtsReq; name: string | null; folderId: string | null }
export type SfxPlan = { step: number; sfx: string; name: string; folderId: string | null }
const TTS_PARAM_TEXT: Record<string, string> = {
  bad: 'params must be an object.',
  empty: 'missing param "text" (what to read aloud).',
  too_long: `"text" is longer than ${TTS_MAX_CHARS} characters — split it into several media.tts steps (or calls).`,
  no_readable: '"text" has nothing that can be read aloud (only emoji, punctuation or spaces).',
}
const folderOf = (p: Record<string, unknown>, cmd: string, i: number): { ok: true; folder: string | null } | { ok: false; step: number; error: string } => {
  const folder = typeof p.folder_id === 'string' && p.folder_id.trim() ? p.folder_id.trim() : null
  if (p.folder_id !== undefined && typeof p.folder_id !== 'string') return { ok: false, step: i, error: `${cmd}: "folder_id" must be a drive folder id string.` }
  if (folder && !DRIVE_ID_RE.test(folder)) return { ok: false, step: i, error: `${cmd}: folder_id "${folder}" is not a drive folder id — use one from list_drive.` }
  return { ok: true, folder }
}
/** 挑出一批里的 media.tts：参数不合（范围外报错·⛔ 默默夹）⇒ 回第几步与白话原因（什么都不合成）；超过每批上限 ⇒ 拒 */
export function planTts(steps: readonly unknown[]): { ok: true; plans: TtsPlan[] } | { ok: false; step: number; error: string } {
  const plans: TtsPlan[] = []
  if (!Array.isArray(steps)) return { ok: true, plans }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isObj(s) || typeof s.command !== 'string' || s.command.trim() !== 'media.tts') continue
    if (s.params !== undefined && !isObj(s.params)) return { ok: false, step: i, error: `media.tts: ${TTS_PARAM_TEXT.bad}` }
    const p = isObj(s.params) ? s.params : {}
    const err = (m: string) => ({ ok: false as const, step: i, error: `media.tts: ${m}` })
    if (p.text !== undefined && typeof p.text !== 'string') return err('"text" must be a string.')
    if (p.voice !== undefined && !(TTS_VOICES as readonly unknown[]).includes(p.voice)) return err(`"voice" must be one of ${TTS_VOICES.join(', ')}.`)
    if (p.emotion !== undefined && !(TTS_EMOTIONS as readonly unknown[]).includes(p.emotion)) return err(`"emotion" must be one of ${TTS_EMOTIONS.join(', ')}.`)
    if (p.speed !== undefined && !(typeof p.speed === 'number' && Number.isFinite(p.speed) && p.speed >= 0.5 && p.speed <= 2)) return err('"speed" must be a number between 0.5 and 2.')
    if (p.pitch !== undefined && !(typeof p.pitch === 'number' && Number.isInteger(p.pitch) && p.pitch >= -12 && p.pitch <= 12)) return err('"pitch" must be a whole number between -12 and 12.')
    if (p.name !== undefined && typeof p.name !== 'string') return err('"name" must be a string.')
    const r = parseTtsReq({ text: p.text, voice: p.voice, speed: p.speed, pitch: p.pitch, emotion: p.emotion })
    if (!r.ok) return err(TTS_PARAM_TEXT[r.code] ?? TTS_PARAM_TEXT.bad)
    const f = folderOf(p, 'media.tts', i)
    if (!f.ok) return f
    plans.push({ step: i, req: r.req, name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 200) : null, folderId: f.folder })
  }
  if (plans.length > TTS_PER_CALL) return { ok: false, step: plans[TTS_PER_CALL].step, error: `at most ${TTS_PER_CALL} media.tts steps per call (each one costs credits) — split them into several calls.` }
  return { ok: true, plans }
}
/** 挑出一批里的 sfx.add：音效编号不认得 ⇒ 回第几步（什么都不存）；超过每批上限 ⇒ 拒。lang＝档名用哪一种名字 */
export function planSfx(steps: readonly unknown[], lang: 'tw' | 'cn' | 'en' = 'tw'): { ok: true; plans: SfxPlan[] } | { ok: false; step: number; error: string } {
  const plans: SfxPlan[] = []
  if (!Array.isArray(steps)) return { ok: true, plans }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isObj(s) || typeof s.command !== 'string' || s.command.trim() !== 'sfx.add') continue
    const p = isObj(s.params) ? s.params : {}
    const def = typeof p.sfx === 'string' ? sfxById(p.sfx.trim()) : undefined
    if (!def) return { ok: false, step: i, error: typeof p.sfx === 'string' && p.sfx.trim() ? `sfx.add: unknown sound effect "${p.sfx}" — see catalog.list {"kind":"sfx"}.` : 'sfx.add: missing param "sfx" (a sound effect id from catalog.list {"kind":"sfx"}).' }
    const f = folderOf(p, 'sfx.add', i)
    if (!f.ok) return f
    plans.push({ step: i, sfx: def.id, name: def.name[lang], folderId: f.folder })
  }
  if (plans.length > SFX_PER_CALL) return { ok: false, step: plans[SFX_PER_CALL].step, error: `at most ${SFX_PER_CALL} sfx.add steps per call — split them into several calls.` }
  return { ok: true, plans }
}
/** 合成／存档之前先空跑一次（假云盘档·每步一个·配音当成很长）：会挡住的错（编号不对、轨锁了、参数不合…）在真做之前就挡下 */
const DRY_RUN_TTS_SECONDS = 600
export const dryRunDriveId = (kind: 1 | 2 | 3, step: number) => `00000000-0000-4000-800${kind}-${String(step).padStart(12, '0')}`
export function dryRunOpts(webShotSteps: readonly number[], ttsSteps: readonly number[], sfxSteps: readonly number[]): RunOpts {
  const by = <T>(xs: readonly number[], v: (k: number) => T) => Object.fromEntries(xs.map((k) => [k, v(k)])) as Record<number, T>
  return {
    webShots: by(webShotSteps, (k) => ({ driveId: dryRunDriveId(1, k), name: 'dry-run.png' })),
    tts: by(ttsSteps, (k) => ({ driveId: dryRunDriveId(2, k), name: 'dry-run.mp3', seconds: DRY_RUN_TTS_SECONDS })),
    sfx: by(sfxSteps, (k) => ({ driveId: dryRunDriveId(3, k), name: 'dry-run.wav' })),
  }
}
