// ═══════════════════════════════════════════════════════════════════════════════════════════
// 网页剪辑页·时间轴纯半：视频、图片、音频轨与逐帧预览的基础剪辑算法。
// 片段＝{ 起点 start·长度 length·素材内入点 offset }（秒·按 30 帧格）；同轨片段不重叠。
// （照剪映）：轨道改成可变多条——一开始只有一条主轨（画面类）在时间轴垂直正中；拖素材下来落点被占 ⇒ 图片、影片（以后文字）
//   往上新增一条轨·音频往下新增；空了的非主轨自动收掉；每条轨有锁（不能拖／改）、眼睛（隐藏·有声的连声音一起关）、喇叭（只静音）——
//   没声音的轨（只放图片的、文字轨）不放喇叭·音频轨不放眼睛。拖进来时「即将占位」的地方先画灰底（planDrop 算落点·页面照画）。
// 缩到最小＝整段内容放得进可见宽度（zoomFloor）；：轨道右边无上限（canvasSeconds：尾巴后永远多留至少一个可见宽度）。
//   时间轴分上下两区（zoneOf／audioStart）——上区各种轨之间片段互拖（落到别种轨 ⇒ 贴着新增一条自己这种轨·moveGroup）、轨道上下顺序自由拖（moveLane·叠层跟着变）；
//   音频区自己多轨；两区之间不跨（拖过头停在区边）；主轨永远留着。
// 拖位／拉两端修剪／分割／删除／吸附／复原重做／剪映快捷键／落点规划都在这里算——页面（video-edit/page.tsx）只管画与接事件。⛔ 碰 DOM。
// ═══════════════════════════════════════════════════════════════════════════════════════════
import type { ShapeBody, SolidBody } from './shape.pure'
import type { BgfxBody } from './bgfx.pure' // 动态背景（只引型别）
import type { Clip3d, RigBody } from './rig.pure' // 空物件／摄影机／灯光·3D（只引型别）
import type { ClipExpr } from './expr.pure' // 表达式（只引型别）
import { unusedCopyGroupId } from './id.pure'
import type { ClipLook } from './clip-look.pure' // 片段画面属性（只引型别）
import type { KfTracks } from './keyframe.pure' // 关键帧（只引型别）
import type { ClipAudio } from './audio.pure' // 声音处理（只引型别）
import type { Mosaic } from './mosaic.pure' // 追踪打码（只引型别）
import type { ClipFollow, MTrack } from './motion-track.pure' // 运动跟踪（只引型别）
import { cropCurve, curveAvg, curveCum, curveInv, type SpeedCurve } from './curve-speed.pure' // 曲线变速

export const FPS = 30
export const FRAME = 1 / FPS
/** 片段最短一帧（拉两端修剪不能拉没） */
export const MIN_CLIP = FRAME
/** 图片放上轨道先给的长度（之后拉两端改·不设秒数框） */
export const IMAGE_DEFAULT_SECONDS = 3
/** 时间轴缩放（每秒几像素）：放到最大一帧约 20 像素·逐帧修剪拉得准；ZOOM_MIN 是「片不长时」的下限——片长到放不进可见宽度时下限再往下降（zoomFloor） */
export const ZOOM_MIN = 10
export const ZOOM_MAX = 600
export const ZOOM_DEFAULT = 40
/** 缩到最小时整段两边留的空（像素） */
export const FIT_PAD = 24
/** 吸附距离（像素·页面按缩放换成秒） */
export const SNAP_PX = 8
/** 复原最多记几步 */
export const HIST_CAP = 100

/** 轨道种类：visual＝画面类（影片＋图片·剪映的视频轨）；audio＝音频；text＝文字（以后的字幕／文字·先留着种类） */
export type LaneKind = 'visual' | 'audio' | 'text' | 'sticker' | 'filter' | 'program' // program＝程序片段轨； sticker＝贴纸轨；filter＝滤镜轨
export type MediaKindLike = 'video' | 'audio' | 'image'
/** 片段：volume＝这一段的音量倍数（缺＝1＝100%·0～VOL_MAX）；muted＝静音这段（照放画面·不出声）；
 *  disabled＝停用这段（不画也不出声·留在轨道上）；detached＝影片的声音已分离成音频轨上另一段（这段只剩画面）——后三者右键选单 */
/** 文字片段的内容（花字库）：content＝字；fancy＝花字款式编号（缺＝素白字）；x／y＝字块中心在画面的位置（0～1）；size＝字高占画面高的比例 */
export type TextBody = { content: string; fancy?: string; x: number; y: number; size: number } & TextLookFields
/** 文字片段「人工」面板调的属性（照剪映文本属性面板）——全部可选·缺＝跟花字款式（没花字＝素白字）·旧工程档没有这些栏照常开。
 *  范围与默认、画法都在 text-style.pure.ts（resolveTextLook：画面叠字与汇出用同一份）。 */
export type TextFont = 'sans' | 'serif' | 'mono'
export type TextAlign = 'left' | 'center' | 'right'
export type TextLookFields = {
  /** 字体：浏览器一定有的黑体／明体（宋体）／等宽·或站上字体编号（core/lib/fonts 那 12 款） */ font?: TextFont | (string & {})
  /** 粗体／斜体（缺＝跟款式）；底线（缺＝没有） */ bold?: boolean; italic?: boolean; underline?: boolean
  /** 字色 #rrggbb（有 ⇒ 字面改成这个实色·盖掉款式的渐层） */ color?: string
  /** 字间距、行间距（em·加在款式原本的上面） */ letterSpacing?: number; lineSpacing?: number
  /** 多行对齐（缺＝置中） */ align?: TextAlign
  /** 缩放倍数（乘在 size 上）·平面旋转（度·顺时针）·不透明度 0～1 */ scale?: number; rotate?: number; opacity?: number
  /** 描边（加在款式描边的最外圈·width＝em） */ stroke?: { color: string; width: number }
  /** 背景块（盖掉款式自带的背景）·shape＝气泡形状（缺＝圆角方块） */ bg?: { color: string; opacity: number; shape?: 'pill' | 'speech' | 'thought' }
  /** 阴影（angle＝度·0＝往右、90＝往下·dist／blur＝em）·发光（strength 0～1）·竖排（一字一行·多行＝由右往左排成几直行） */
  shadow?: { color: string; opacity: number; angle: number; dist: number; blur: number }; glow?: { color: string; strength: number }; vertical?: boolean
  /** 动画（照剪映 入场／出场／循环）：id＝动画库编号（text-anim.pure）·dur＝秒（循环＝一圈几秒）·款式与画法见 text-anim.pure */
  anim?: TextAnimSet
}
/** 一款文字动画：id＝动画库编号；dur＝秒；stagger＝逐字款（in-pc-*／out-pc-*）每字间隔秒（缺＝0.06·别款不存） */
export type TextAnim = { id: string; dur: number; stagger?: number }
export type TextAnimSlot = 'in' | 'out' | 'loop'
export type TextAnimSet = { [K in TextAnimSlot]?: TextAnim }
/** 贴纸片段的内容：sticker＝贴纸编号（stickers.data）；x／y＝中心在画面的位置（0～1）；size＝长边占画面高的比例 */
export type StickerBody = { sticker: string; x: number; y: number; size: number }
/** 滤镜片段的内容：filter＝滤镜编号（filters.data）；strength＝强度 0～1（界面 0～100%） */
export type FilterBody = { filter: string; strength: number }
/** 程序片段的内容：pkg＝程序包编号（b-＝网站自带·u-＝使用者上传）；version＝包版本；params＝本段参数（只存改过的·缺的用包里默认） */
export type ProgramBody = { pkg: string; version: string; params: Record<string, string | number | boolean> }
/** 素材片段身上的特效（标在原有素材上）：fx＝特效编号（fx.data·fx-…）；strength＝强度 0～1·整段都套（前后各淡入淡出一点） */
export type ClipFx = { fx: string; strength: number }
/** 这段跟同轨前一段（尾接头）接缝上的转场：tr＝转场编号（tr-…）；length＝秒·横跨切点两侧各一半 */
export type TransBody = { tr: string; length: number }
export type TlClip = { id: string; mediaId: string; start: number; length: number; offset: number; volume?: number; muted?: boolean; disabled?: boolean; detached?: boolean; /** 有 ⇒ 这是文字片段（放文字轨·mediaId 空） */ text?: TextBody; /** 有 ⇒ 这是贴纸片段（放贴纸轨·mediaId 空） */ sticker?: StickerBody; /** 有 ⇒ 这是滤镜片段（放滤镜轨·mediaId 空·那段时间底下的画面套色） */ filter?: FilterBody; /** 有 ⇒ 这是程序片段（放程序轨·mediaId 空·offset＝剪开后接着播的起点秒） */ program?: ProgramBody
  /** （剪映选中影片片段的右栏·放进「人工」）：speed＝变速倍数（缺＝1·素材每秒走 speed 秒·时间轴上的长度跟着变）；pitch＝声音跟着变调（缺＝保持原音高）；
   *  fadeIn／fadeOut＝声音淡入／淡出秒数；look＝画面属性（位置大小、旋转、混合、不透明度、蒙版、调色·见 clip-look.pure.ts）；anim＝画面入场／出场／循环动画（款式同文字动画库） */
  speed?: number; pitch?: boolean; fadeIn?: number; fadeOut?: number; look?: ClipLook; anim?: TextAnimSet
  /** 同一个编号的几段是一组（点一段整组选起来·一起拖、删、复制·见 group.pure.ts） */
  group?: string
  /** kf＝关键帧（各数值一条轨·时刻＝素材第几秒·见 keyframe.pure.ts）；
   *  curve＝曲线变速（有 ⇒ speed 存这条曲线的平均速度·素材时刻照曲线积分·见 curve-speed.pure.ts） */
  kf?: KfTracks; curve?: SpeedCurve
  /** reverse＝倒放（素材那段从尾放到头·不跟曲线变速并用）；freeze＝定格（整段停在素材第 offset 秒那一帧·没声音） */
  reverse?: boolean; freeze?: boolean
  /** 调节层（滤镜轨上的片段·mediaId 空·调色存在 look 里·那段时间底下的画面都套） */
  adjust?: boolean
  /** 声音处理（降噪／响度统一／变调／声道／声音效果·见 audio.pure.ts） */
  aud?: ClipAudio
  /** 追踪打码：这段身上的打码轨（素材秒＋画面坐标·见 mosaic.pure.ts） */
  mosaic?: Mosaic[]
  /** 运动跟踪：影片片段身上的跟踪路径（见 motion-track.pure.ts）；follow＝文字／贴纸片段跟着哪条路径走 */
  mtrack?: MTrack[]; follow?: ClipFollow
  /** 画面轨素材片段身上的特效（可几个·由上往下依序套） */ fx?: ClipFx[]; /** 跟同轨前一段接缝上的转场；前面没接着别段 ⇒ 片头转场（从黑场进场·见 fx.pure fxStateAt） */ transIn?: TransBody
  /** 形状片段（画面轨·mediaId 空·见 shape.pure.ts）；纯色片段（画面轨·mediaId 空·整个画面一块颜色） */ shape?: ShapeBody; solid?: SolidBody
  /** 程序画的动态背景片段（画面轨·mediaId 空·星空粒子／光斑漂移·见 bgfx.pure.ts） */ bgfx?: BgfxBody
  /** 空物件／摄影机／灯光（画面轨·mediaId 空·自己不画·见 rig.pure.ts）；parent＝父层片段 id（位移缩放旋转沿父链级联）·parentAlpha＝连不透明度也跟；
   *  d3＝开 3D（z、x／y／z 旋转·经摄影机透视投影、受灯光）；expr＝各属性的表达式（见 expr.pure.ts） */
  rig?: RigBody; parent?: string; parentAlpha?: boolean; d3?: Clip3d; expr?: ClipExpr
  /** 合成段（画面轨·mediaId 空）：放的是工程里哪份子合成（offset＝从合成第几秒起·变速倒放定格同素材片段·见 comp.pure.ts） */ comp?: string }
/** markers＝时间尺上的标记（秒·对齐帧格·由小到大）——只主轨带（的加标记·放主轨上＝复原栈与工程档跟着轨道走；缺＝没有） */
export type Lane = { id: string; kind: LaneKind; clips: TlClip[]; locked: boolean; hidden: boolean; muted: boolean; markers?: number[] }
/** 所有轨道·由上到下排；主轨（id＝MAIN_LANE）永远在（空了也留）。
 * 分上下两区——上区（画面区）＝非音频的各种轨（画面／文字／贴纸／滤镜／程序）排在前面·
 *  下区（音频区）＝音频轨排在后面；上区里各种轨（含主轨）上下顺序自由、上面的盖下面的；片段只在自己那一区里换轨。 */
export type Tracks = Lane[]
export const MAIN_LANE = 'main'
export const newLane = (id: string, kind: LaneKind): Lane => ({ id, kind, clips: [], locked: false, hidden: false, muted: false })
/** 一开始就一条主轨 */
export const EMPTY_TRACKS: Tracks = [newLane(MAIN_LANE, 'visual')]

const EPS = 1e-6
/** 判两段接没接上等用的容差（同 EPS·给特效转场那档用） */
export const EPS_TIME = EPS
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** 对齐到帧格 */
export const snapFrame = (t: number) => Math.round(t * FPS) / FPS
const endOf = (c: TlClip) => c.start + c.length
/** 片段变速倍数（缺＝1）：素材时刻＝offset＋（时间轴上过了几秒）×speed */
export const SPEED_MIN = 0.1
export const SPEED_MAX = 100
export const speedOf = (c: Pick<TlClip, 'speed'>): number => (c.speed && Number.isFinite(c.speed) && c.speed > 0 ? c.speed : 1)
const byStart = (a: TlClip, b: TlClip) => a.start - b.start

/** 素材种类 ⇒ 落哪种轨（影片、图片进画面轨·音频进音频轨） */
export function laneKindFor(kind: MediaKindLike | 'text' | 'sticker' | 'filter' | 'program'): LaneKind {
  return kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : kind === 'sticker' ? 'sticker' : kind === 'filter' ? 'filter' : kind === 'program' ? 'program' : 'visual'
}
/** 这种轨往哪边长：音频往下·其余往上 */
const growsDown = (k: LaneKind) => k === 'audio'

export const allClips = (tr: Tracks): TlClip[] => tr.flatMap((l) => l.clips)
export const mainIndex = (tr: Tracks): number => Math.max(0, tr.findIndex((l) => l.id === MAIN_LANE))

// ── 上下两区──
/** upper＝上区（画面区·非音频的各种轨）；audio＝下区（音频区） */
export type LaneZone = 'upper' | 'audio'
export const zoneOf = (k: LaneKind): LaneZone => (k === 'audio' ? 'audio' : 'upper')
/** 音频区从第几条起（＝上区有几条）；没有音频轨 ⇒ tracks.length */
export function audioStart(tr: Tracks): number {
  const i = tr.findIndex((l) => l.kind === 'audio')
  return i < 0 ? tr.length : i
}
/** 这一区占 tracks 的哪一段 [lo, hi]（含两端·空区 hi＜lo） */
export function zoneRange(tr: Tracks, z: LaneZone): [number, number] {
  const a = audioStart(tr)
  return z === 'audio' ? [a, tr.length - 1] : [0, a - 1]
}
/**
 *  主轨钉在上区最底下（紧贴音频区）·种类恒为 visual；别的上区轨都在它上面。已经在位 ⇒ 原物件 */
export function pinMain(tr: Tracks): Tracks {
  const i = tr.findIndex((l) => l.id === MAIN_LANE)
  if (i < 0) return tr
  const main = tr[i].kind === 'visual' ? tr[i] : { ...tr[i], kind: 'visual' as LaneKind }
  const rest = tr.filter((_, k) => k !== i)
  const a = rest.findIndex((l) => l.kind === 'audio')
  const at = a < 0 ? rest.length : a
  if (at === i && main === tr[i]) return tr
  rest.splice(at, 0, main)
  return rest
}
/** 片段在哪条轨（片段编号全时间轴唯一） */
export function findClip(tr: Tracks, id: string): { lane: Lane; clip: TlClip } | null {
  for (const lane of tr) { const clip = lane.clips.find((c) => c.id === id); if (clip) return { lane, clip } }
  return null
}
/** 这个片段能不能拖／改（所在轨锁了 ⇒ 不能） */
export function editable(tr: Tracks, id: string): boolean {
  const f = findClip(tr, id)
  return !!f && !f.lane.locked
}
const withClips = (l: Lane, clips: TlClip[]): Lane => ({ ...l, clips: [...clips].sort(byStart) })
const mapLane = (tr: Tracks, laneId: string, f: (l: Lane) => Lane): Tracks => tr.map((l) => (l.id === laneId ? f(l) : l))

/** 整条时间轴多长（最后一个片段的尾） */
export function timelineEnd(tr: Tracks): number {
  return Math.max(0, ...allClips(tr).map(endOf))
}

/** t 这一刻这条轨上在播哪个片段·素材内播到哪（左闭右开） */
export function clipAt(list: readonly TlClip[], t: number): { clip: TlClip; local: number } | null {
  const c = list.find((x) => t >= x.start - EPS && t < endOf(x) - EPS)
  return c ? { clip: c, local: srcAt(c, t) } : null
}
/** 时间轴第 t 秒＝这段素材的第几秒：常规变速＝offset＋过了几秒×倍数；曲线变速＝offset＋长度×∫₀^{过了几成} v */
export function srcAt(c: Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve'> & Partial<Pick<TlClip, 'reverse' | 'freeze'>>, t: number): number {
  const tau = Math.max(0, t - c.start)
  if (c.freeze) return c.offset // 定格
  if (c.reverse) return c.offset + Math.max(0, c.length - tau) * speedOf(c) // 倒放：片头＝素材那段的尾
  if (c.curve && c.length > 0) return c.offset + c.length * curveCum(c.curve, tau / c.length)
  return c.offset + tau * speedOf(c)
}
/** srcAt 反过来：素材第 src 秒落在时间轴第几秒（曲线变速照曲线反查·超出这段照常规倍数往外推） */
export function timeOfSrc(c: Pick<TlClip, 'start' | 'length' | 'offset' | 'speed' | 'curve'> & Partial<Pick<TlClip, 'reverse' | 'freeze'>>, src: number): number {
  if (c.freeze) return c.start
  if (c.reverse) return c.start + c.length - (src - c.offset) / speedOf(c)
  const total = c.curve && c.length > 0 ? c.length * curveAvg(c.curve) : 0
  const y = total > 0 ? (src - c.offset) / total : NaN
  return y >= 0 && y <= 1 ? c.start + curveInv(c.curve!, y) * c.length : c.start + (src - c.offset) / speedOf(c)
}
/** 这一刻的瞬间速度（曲线变速才会变·播放器 playbackRate 用） */
export function rateAt(c: Pick<TlClip, 'start' | 'length' | 'speed' | 'curve'> & Partial<Pick<TlClip, 'reverse' | 'freeze'>>, t: number): number {
  if (c.freeze) return 0 // 定格／倒放：播放器停着照播放头跳格（vedit-media-sync）
  if (c.reverse) return -speedOf(c)
  if (!c.curve || !(c.length > 0)) return speedOf(c)
  const x = Math.min(1, Math.max(0, (t - c.start) / c.length)), h = 1e-3
  return (curveCum(c.curve, Math.min(1, x + h)) - curveCum(c.curve, Math.max(0, x - h))) / (Math.min(1, x + h) - Math.max(0, x - h))
}

// ── 预览要照轨道状态：隐藏的不画也不出声·静音的只不出声；多条画面轨上面的盖下面的 ──
/** show＝这层要画；sound＝这层要出声；gain＝出声时这段的音量倍数（不出声 ⇒ 0） */
export type LayerState = { lane: Lane; hit: { clip: TlClip; local: number } | null; show: boolean; sound: boolean; gain: number }
/** 每条轨这一刻的状态（由上到下·跟 tracks 同序）；片段停用 ⇒ 不画不出声；片段静音／声音已分离 ⇒ 照画不出声 */
export function layersAt(tr: Tracks, t: number): LayerState[] {
  return tr.map((lane) => {
    const hit = clipAt(lane.clips, t)
    const c = hit?.clip
    const sound = !!c && !lane.hidden && !lane.muted && !c.muted && !c.disabled && !c.detached && !c.freeze && !c.reverse // 定格没声音·倒放的声音只在成片里倒着放（预览元素停着跳格）
    return { lane, hit, show: !!c && lane.kind !== 'audio' && !lane.hidden && !c.disabled, sound, gain: sound ? clipGain(c!) : 0 }
  })
}
/** 这一刻画面上看得到的最上面那一层（没有 ⇒ null） */
export function topVisualAt(tr: Tracks, t: number): LayerState | null {
  return layersAt(tr, t).find((s) => s.show) ?? null
}

/** 轨道头放哪几颗钮（锁每条都有）：眼睛＝不是音频轨；喇叭＝这条轨会出声（音频轨·放了影片或还空着的画面轨；只放图片的画面轨、文字轨没声音 ⇒ 不放） */
export function laneControls(lane: Lane, kindOf: (mediaId: string) => MediaKindLike | undefined): { eye: boolean; speaker: boolean } {
  const imagesOnly = lane.clips.length > 0 && lane.clips.every((c) => kindOf(c.mediaId) === 'image')
  return { eye: lane.kind !== 'audio', speaker: lane.kind === 'audio' || (lane.kind === 'visual' && !imagesOnly) }
}
/** 锁／隐藏／静音开关 */
export function setLaneFlag(tr: Tracks, laneId: string, flag: 'locked' | 'hidden' | 'muted', on: boolean): Tracks {
  const l = tr.find((x) => x.id === laneId)
  if (!l || l[flag] === on) return tr
  return mapLane(tr, laneId, (x) => ({ ...x, [flag]: on }))
}
/** 空了的非主轨收掉（照剪映）；没东西可收 ⇒ 原物件 */
export function pruneLanes(tr: Tracks): Tracks {
  const next = tr.filter((l) => l.id === MAIN_LANE || l.clips.length > 0)
  return pinMain(next.length === tr.length ? tr : next)   // 主轨钉在上区最底下
}

// ── 播放时钟──
// 旧做法：播放头按墙钟（rAF 的 dt）自己往前走·影片元素落后超过 0.3 秒就把它 seek 到播放头。影片一缓冲／seek 本身要花 >0.3 秒
// （云端 mp4 要发区段请求＋从关键帧解码）⇒ 刚 seek 完又落后 0.3 秒 ⇒ 再 seek ⇒ 永远在 seek ⇒ 画面一顿一顿像幻灯片。
// 新做法：有影音片段在放 ⇒ 播放头跟着影音元素自己的时刻走（元素卡就一起等·不去追它）；图片／空档／元素还没换到这个片段 ⇒ 才用墙钟。
/** 元素时刻离这个片段多远还算「在放这个片段」（超出 ⇒ 元素还没换好位置·改用墙钟、由同步那头 seek 一次） */
export const FOLLOW_SLACK = 0.3
/** 影音元素播到 mediaTime ⇒ 换算成时间轴上的时刻；元素位置不在这个片段里（差超过 FOLLOW_SLACK）⇒ null */
export function followTime(clip: TlClip, mediaTime: number): number | null {
  if (!Number.isFinite(mediaTime)) return null
  const t = timeOfSrc(clip, mediaTime)
  return t >= clip.start - FOLLOW_SLACK && t <= endOf(clip) + FOLLOW_SLACK ? t : null
}
/** （转场处声音顿）：
 *  播放头只照墙钟走·影音元素各自去对齐播放头——
 *   ① 元素在载入／跳转（busy）⇒ 不动它（等它好）；
 *   ② 差一点（SYNC_SOFT～SYNC_HARD）⇒ 稍快／稍慢放追上（最多 ±SYNC_NUDGE）·不跳＝声音不断；
 *   ③ 差太多（> SYNC_HARD：拖播放头、切段）⇒ 跳过去·往前多跳一次跳转要花的时间（seekCost）·跳完正好对上·不会一直跳（一卡一卡）。 */
/** 每一段片段自己一个播放器——
 *  正在放的那段＋接下来 PREROLL 秒内要开始的（先载好、停在入点等·时间到直接开播）＋刚放完 PREROLL_BEHIND 秒内的（免得来回拖时一直重建）；照时间排 */
export const PREROLL = 3
export const PREROLL_BEHIND = 0.5
export function prerollClips(clips: readonly TlClip[], t: number): TlClip[] {
  return clips.filter((c) => c.start <= t + PREROLL && endOf(c) >= t - PREROLL_BEHIND)
}
export const SYNC_SOFT = 0.03
export const SYNC_START = 0.1
export const SYNC_HARD = 1
export const SYNC_NUDGE_SMALL = 0.06
export const SYNC_NUDGE = 0.2
export const SYNC_BIG_LAG = 0.4
/**（在工作站 Firefox 预览声音断断续续）：旧判法按差多少「按比例」调速度——Firefox 报的播放进度本身抖几十毫秒、
 *  加上声卡延迟·差值一直在门槛附近来回 ⇒ 每帧都改一次 playbackRate；Firefox 每改一次就重起一次重采样 ⇒ 声音一截一截。（Chrome 改速度是平滑的·所以不卡）
 *  改成回滞＋固定两档：差到 SYNC_START 才开始追（差得多用 SYNC_NUDGE·少用 SYNC_NUDGE_SMALL）·追的途中速度不变·
 *  追到 SYNC_SOFT 内或追过头才回原速 ⇒ 一段播放只改几次速度。prevNudge＝上一拍的追速（1＝没在追·元素上记着）。 */
export function mediaSync(p: { cur: number; target: number; busy: boolean; seekCost: number; prevNudge?: number }): { seek: number | null; nudge: number } {
  if (p.busy) return { seek: null, nudge: 1 }
  const d = p.cur - p.target
  if (Math.abs(d) > SYNC_HARD) return { seek: Math.max(0, p.target + clamp(p.seekCost, 0, 1)), nudge: 1 }
  const prev = p.prevNudge ?? 1
  const step = (lag: number) => (Math.abs(lag) > SYNC_BIG_LAG ? SYNC_NUDGE : SYNC_NUDGE_SMALL)
  const toward = (lag: number) => (lag > 0 ? 1 - step(lag) : 1 + step(lag))
  if (Math.abs(prev - 1) < 1e-9) return { seek: null, nudge: Math.abs(d) <= SYNC_START ? 1 : toward(d) }
  // 正在追：追上了或追过头 ⇒ 回原速；差距又拉大到大档 ⇒ 换大档；其余不动（⛔ 每帧改速度）
  const overshot = prev > 1 ? d >= 0 : d <= 0
  if (Math.abs(d) <= SYNC_SOFT || overshot) return { seek: null, nudge: 1 }
  if (Math.abs(d) > SYNC_BIG_LAG && Math.abs(prev - 1) < SYNC_NUDGE - 1e-9) return { seek: null, nudge: toward(d) }
  return { seek: null, nudge: prev }
}

/** 变速超过这个倍数 ⇒ 预览改「跳格」——
 *  元素停着、照播放头一格一格跳过去（同剪映快转预览）；不硬让浏览器实时解 12 倍速（4K 原档实时解不动 ⇒ 一直落后、一直跳、看起来乱跑） */
export const SCRUB_RATE = 4
/**（剪辑页整页崩：「playbackRate (38.35) is not in the supported playback range」）：
 *  浏览器影音元素只收这段倍速（Chrome／Safari 0.0625–16·超了直接抛错）——片段变速再高也只设到边上（高倍本来就走跳格预览）。 */
export const MEDIA_RATE_MIN = 0.0625
export const MEDIA_RATE_MAX = 16
/** 设进 HTMLMediaElement.playbackRate 的安全值：夹进浏览器范围；非数／≤0 ⇒ 1。 */
export function safeMediaRate(r: number): number {
  if (!Number.isFinite(r) || r <= 0) return 1
  return Math.min(MEDIA_RATE_MAX, Math.max(MEDIA_RATE_MIN, r))
}
/** 跳格这一拍要不要跳、跳到哪：载入／跳转中不动；差不到一格不动；否则跳到播放头往前多算「跳一次要花的时间×倍速」（夹 0.3 秒内） */
export function scrubSeek(p: { cur: number; target: number; busy: boolean; seekCost: number; rate: number }): number | null {
  if (p.busy) return null
  const ahead = p.target + clamp(p.seekCost, 0, 0.3) * p.rate
  // 倒放（rate<0）往前跳一点等着播放头倒退过来；定格（rate=0）停在那一帧
  const waiting = p.rate >= 0 ? p.cur <= ahead + 1e-9 : p.cur >= ahead - 1e-9
  return Math.abs(p.cur - p.target) < FRAME && waiting ? null : Math.max(0, ahead)
}

/** 所有片段的头尾＋0（剪映上下键跳的「编辑点」） */
export function edgesOf(tr: Tracks): number[] {
  const s = new Set<number>([0])
  for (const c of allClips(tr)) { s.add(snapFrame(c.start)); s.add(snapFrame(endOf(c))) }
  return [...s].sort((a, b) => a - b)
}

/** 上一个／下一个编辑点（没有 ⇒ 0／整条尾） */
export function nextEdge(tr: Tracks, t: number, dir: 1 | -1): number {
  const e = edgesOf(tr)
  if (dir === 1) return e.find((x) => x > t + EPS) ?? timelineEnd(tr)
  return [...e].reverse().find((x) => x < t - EPS) ?? 0
}

/** 逐帧前后（剪映 ←／→）·Shift 时一次一秒；夹在 [0, end] */
export function stepTime(t: number, dir: 1 | -1, end: number, unit: number = FRAME): number {
  return clamp(snapFrame(snapFrame(t) + dir * unit), 0, Math.max(0, end))
}

/** 吸附：离哪个点在 threshold 秒内就贴过去（取最近）；都不近 ⇒ 原值 */
export function snapTo(v: number, points: readonly number[], threshold: number): number {
  let best = v
  let d = threshold + EPS
  for (const p of points) { const x = Math.abs(p - v); if (x < d) { d = x; best = p } }
  return best
}

/** 拖动片段时的吸附：片头或片尾哪个离吸附点近就贴哪个 */
export function snapMove(start: number, length: number, points: readonly number[], threshold: number): number {
  const a = snapTo(start, points, threshold)
  const b = snapTo(start + length, points, threshold) - length
  const da = Math.abs(a - start), db = Math.abs(b - start)
  if (da === 0 && db === 0) return start
  if (da === 0) return b
  if (db === 0) return a
  return da <= db ? a : b
}

/** 吸附点：0、播放头、别的片段头尾（拖哪个／哪一批就除掉哪些） */
export function snapPoints(tr: Tracks, playhead: number, ignore: string | null | ReadonlySet<string>): number[] {
  const skip = (id: string) => (typeof ignore === 'string' || ignore === null ? id === ignore : ignore.has(id))
  const pts = [0, playhead]
  for (const c of allClips(tr)) if (!skip(c.id)) pts.push(c.start, endOf(c))
  return pts
}

/** 跟这几段最多叠了几秒（没叠 ⇒ 0） */
function overlapsBy(list: readonly TlClip[], start: number, length: number): number {
  let m = 0
  for (const c of list) m = Math.max(m, Math.min(start + length, endOf(c)) - Math.max(start, c.start))
  return m
}
function overlaps(list: readonly TlClip[], start: number, length: number, ignoreId: string | null): boolean {
  return list.some((c) => c.id !== ignoreId && start < endOf(c) - EPS && start + length > c.start + EPS)
}

/** 想放在 want、长 length ⇒ 离 want 最近、不跟同轨别的片段重叠、不小于 0 的位置（同轨不叠·照剪映主轨） */
export function placeFree(list: readonly TlClip[], ignoreId: string | null, want: number, length: number): number {
  const cands = [Math.max(0, want)]
  for (const c of list) if (c.id !== ignoreId) cands.push(endOf(c), c.start - length)
  let best = Infinity
  let bestD = Infinity
  for (const x0 of cands) {
    const x = Math.max(0, x0)
    if (overlaps(list, x, length, ignoreId)) continue
    const d = Math.abs(x - want)
    if (d < bestD - EPS) { bestD = d; best = x }
  }
  return Number.isFinite(best) ? best : Math.max(0, ...list.map(endOf))
}

// ── 拖素材进来：算「即将占位」落在哪——页面拖着时画灰底、放手时照它放 ──
/** 滑鼠在哪：某条轨上／最上面那片空白（top）／最下面那片空白（bottom）／不知道（null） */
export type DropHint = { lane: string } | { edge: 'top' | 'bottom' } | null
/** lane＝放进这条现有轨；lane 为 null ⇒ 在 tracks 第 at 位新增一条 kind 轨放它 */
export type DropPlan = { lane: string | null; at: number; kind: LaneKind; start: number; length: number }

/** 这种素材没指定轨时的「家」：画面类＝主轨；音频＝音频区最上面那条音频轨；别的＝上区里离主轨最近的同种轨（先找主轨上面·再找主轨下面）；没有 ⇒ null */
function homeLane(tr: Tracks, kind: LaneKind): Lane | null {
  const mi = mainIndex(tr)
  if (kind === 'visual') return tr[mi] ?? null
  const [lo, hi] = zoneRange(tr, zoneOf(kind))
  if (growsDown(kind)) { for (let i = lo; i <= hi; i++) if (tr[i].kind === kind) return tr[i]; return null }
  for (let i = Math.min(mi, hi + 1) - 1; i >= lo; i--) if (tr[i].kind === kind) return tr[i]
  for (let i = mi + 1; i <= hi; i++) if (tr[i].kind === kind) return tr[i]
  return null
}

/** 落点规划：想放的轨（滑鼠下那条同种轨·不同种 ⇒ 它的家）那段时间空着又没锁 ⇒ 放进去；被占／锁了 ⇒ 画面类在它上面新增一条·音频在它下面新增一条；
 *  拖到最上／最下那片空白（同一侧）⇒ 在最外面新增一条；主轨还空着 ⇒ 画面素材一律先进主轨（初始就一条）。
 *  （上区叠层自由）：滑鼠在上区一条别种轨上（例：文字拖到影片轨）⇒ 就在那条上面新增一条这种轨（叠在它上面）；在另一区的轨上 ⇒ 当没指定·去家。 */
export function planDrop(tr: Tracks, kind: LaneKind, hint: DropHint, want: number, length: number): DropPlan {
  const start = snapFrame(Math.max(0, want))
  const mi = mainIndex(tr)
  const main = tr[mi]
  const down = growsDown(kind)
  const plan = (lane: string | null, at: number): DropPlan => ({ lane, at, kind, start, length })
  if (kind === 'visual' && main && !main.locked && main.clips.length === 0) return plan(main.id, mi)
  if (hint && 'edge' in hint && (hint.edge === 'bottom') === down) return plan(null, down ? tr.length : 0)
  let target: Lane | null = null
  if (hint && 'lane' in hint) {
    const h = tr.find((l) => l.id === hint.lane)
    if (h && h.kind === kind) target = h
    else if (h && zoneOf(h.kind) === zoneOf(kind)) return plan(null, tr.indexOf(h))
  }
  if (!target) target = homeLane(tr, kind)
  if (!target) return plan(null, down ? audioStart(tr) : mi)
  const ti = tr.indexOf(target)
  if (!target.locked && !overlaps(target.clips, start, length, null)) return plan(target.id, ti)
  return plan(null, down ? ti + 1 : ti)
}

/** 照落点规划放进去（新轨用 newLaneId） */
export function applyDrop(tr: Tracks, p: DropPlan, clip: TlClip, newLaneId: string): Tracks {
  const c = { ...clip, start: p.start, length: p.length }
  if (p.lane !== null) return mapLane(tr, p.lane, (l) => withClips(l, [...l.clips, c]))
  const at = clamp(p.at, 0, tr.length)
  return [...tr.slice(0, at), withClips(newLane(newLaneId, p.kind), [c]), ...tr.slice(at)]
}

/** 双击素材 ⇒ 接到它家那条轨的尾巴（家锁了／没有 ⇒ 在那一侧新增一条） */
export function appendMedia(tr: Tracks, kind: LaneKind, clip: TlClip, newLaneId: string): Tracks {
  const home = homeLane(tr, kind)
  if (home && !home.locked) return mapLane(tr, home.id, (l) => withClips(l, [...l.clips, { ...clip, start: Math.max(0, ...l.clips.map(endOf)) }]))
  // 家锁了 ⇒ 贴着它新增（音频在下·其余在上）；没有家 ⇒ 音频进音频区最上面·其余在主轨上面（主轨不一定在区界）
  const at = home ? tr.indexOf(home) + (growsDown(kind) ? 1 : 0) : growsDown(kind) ? audioStart(tr) : mainIndex(tr)
  return applyDrop(tr, { lane: null, at, kind, start: 0, length: clip.length }, clip, newLaneId)
}

/** 拖位：want＝新片头（调用方先 snapMove）·toLane＝滑鼠移到的那条轨（同种、没锁才换过去）·撞到别的片段就挪到最近的空位 */
export function moveClip(tr: Tracks, id: string, want: number, toLane?: string | null): Tracks {
  const f = findClip(tr, id)
  if (!f) return tr
  const { lane: from, clip: c } = f
  let to = toLane ? tr.find((l) => l.id === toLane) ?? from : from
  if (to.kind !== from.kind || to.locked) to = from
  const start = placeFree(to.clips, id, snapFrame(Math.max(0, want)), c.length)
  if (to === from) {
    if (Math.abs(start - c.start) < EPS) return tr
    return mapLane(tr, from.id, (l) => withClips(l, l.clips.map((x) => (x.id === id ? { ...x, start } : x))))
  }
  return tr.map((l) => (l.id === from.id ? { ...l, clips: l.clips.filter((x) => x.id !== id) }
    : l.id === to.id ? withClips(l, [...l.clips, { ...c, start }]) : l))
}

/** 拉两端修剪（图片也一样拉）：side 'l' 拉片头·'r' 拉片尾·to＝那一端想到的时间轴时刻。
 * 限制：不短于一帧；不撞前后片段；影音不超出素材本身（片头拉不到素材 0 之前·片尾拉不过素材尾）；图片（srcDur＝Infinity）两端随便拉。 */
export function trimClip(tr: Tracks, id: string, side: 'l' | 'r', to: number, srcDur: number): Tracks {
  const f = findClip(tr, id)
  if (!f) return tr
  const c = f.clip
  const others = f.lane.clips.filter((x) => x.id !== id)
  const end = endOf(c)
  let next: TlClip
  if (side === 'l') {
    const prevEnd = Math.max(0, ...others.filter((x) => endOf(x) <= c.start + EPS).map(endOf))
    const sp = speedOf(c)
    // 曲线变速：曲线只画在这段里 ⇒ 只能往里修（往外没有曲线可延）·修掉的那截曲线一起截掉
    // 定格：两端随便拉（停在同一帧）；倒放：片头拉的是素材那段的尾（offset 不动·往外拉到素材尾为止）
    const lo = c.curve ? c.start : c.freeze ? prevEnd : c.reverse ? Math.max(prevEnd, Number.isFinite(srcDur) ? end - (srcDur - c.offset) / sp : 0, 0) : Math.max(prevEnd, Number.isFinite(srcDur) ? c.start - c.offset / sp : 0, 0)
    const ns = clamp(snapFrame(to), lo, end - MIN_CLIP)
    next = { ...c, start: ns, length: end - ns, offset: !Number.isFinite(srcDur) ? 0 : c.freeze || c.reverse ? c.offset : Math.max(0, c.curve ? srcAt(c, ns) : c.offset + (ns - c.start) * sp), ...cropClipCurve(c, (ns - c.start) / c.length, 1) }
  } else {
    const nextStart = Math.min(Infinity, ...others.filter((x) => x.start >= end - EPS).map((x) => x.start))
    const sp = speedOf(c)
    // 倒放：片尾拉的是素材那段的头（offset 跟着挪·往外拉到素材 0 秒为止）；定格：随便拉
    const hi = c.curve ? end : c.freeze ? nextStart : c.reverse ? Math.min(nextStart, Number.isFinite(srcDur) ? end + c.offset / sp : Infinity) : Math.min(nextStart, Number.isFinite(srcDur) ? c.start + (srcDur - c.offset) / sp : Infinity)
    const ne = clamp(snapFrame(to), c.start + MIN_CLIP, hi)
    next = { ...c, length: ne - c.start, ...(c.reverse && Number.isFinite(srcDur) ? { offset: Math.max(0, c.offset + (c.length - (ne - c.start)) * sp) } : {}), ...cropClipCurve(c, 0, (ne - c.start) / c.length) }
  }
  if (Math.abs(next.start - c.start) < EPS && Math.abs(next.length - c.length) < EPS) return tr
  return mapLane(tr, f.lane.id, (l) => withClips(l, l.clips.map((x) => (x.id === id ? next : x))))
}

/** 曲线变速片段截出 a～b 成（修剪、切开）：回新曲线与它的平均速度；不是曲线变速 ⇒ 不改 */
function cropClipCurve(c: TlClip, a: number, b: number): Partial<TlClip> {
  if (!c.curve || (a <= 1e-6 && b >= 1 - 1e-6)) return {}
  const curve = cropCurve(c.curve, a, b)
  return { curve, speed: Math.round(curveAvg(curve) * 10000) / 10000 }
}

/** 在 at 把片段切成两段（at 要离两头至少一帧）；切不了 ⇒ 原样 */
export function splitClip(tr: Tracks, id: string, at: number, newId: string): Tracks {
  const f = findClip(tr, id)
  if (!f) return tr
  const c = f.clip
  const t = snapFrame(at)
  if (t < c.start + MIN_CLIP - EPS || t > endOf(c) - MIN_CLIP + EPS) return tr
  // 文字动画：前段只留入场、后段只留出场（照剪映·切开那一刀不多出一次出场／入场）；循环两段都带（后段接着播）
  const keepAnim = (keep: TextAnimSlot): Partial<TlClip> => {
    const a = c.text?.anim
    if (!c.text || !a) return {}
    const next: TextAnimSet = {}
    for (const k of [keep, 'loop'] as const) if (a[k]) next[k] = a[k]
    const { anim: _a, ...body } = c.text
    void _a
    return { text: Object.keys(next).length ? { ...body, anim: next } : body }
  }
  const keepClipAnim = (keep: TextAnimSlot): Partial<TlClip> => {
    const a = c.anim
    if (!a) return {}
    const next: TextAnimSet = {}
    for (const k of [keep, 'loop'] as const) if (a[k]) next[k] = a[k]
    return { anim: Object.keys(next).length ? next : undefined }
  }
  const { fadeOut: _fo, ...cL } = c
  void _fo
  const f0 = (t - c.start) / c.length // 曲线变速：两段各截自己那截曲线
  const left: TlClip = { ...cL, length: t - c.start, ...keepAnim('in'), ...keepClipAnim('in'), ...cropClipCurve(c, 0, f0), ...(c.reverse ? { offset: srcAt(c, t) } : {}) } // 倒放：前段放的是素材那段的后半
  // 后段不带前段那个接缝的转场（转场标在接缝上）；特效两段都带
  const { transIn: _drop, ...rest } = c
  void _drop
  // 变速片段的后段入点照素材走了几秒算；声音淡入只留前段、淡出只留后段；画面入场／出场动画同文字
  const { fadeIn: _fi, ...restR } = rest
  void _fi
  const right: TlClip = { ...restR, id: newId, start: t, length: endOf(c) - t, offset: c.reverse ? c.offset : srcAt(c, t), ...keepAnim('out'), ...keepClipAnim('out'), ...cropClipCurve(c, f0, 1) }
  return mapLane(tr, f.lane.id, (l) => withClips(l, [...l.clips.filter((x) => x.id !== id), left, right]))
}

/** 剪映 Ctrl+B：选中的（可多选）有被播放头压到的 ⇒ 只切那几段；否则切播放头压到的所有片段。锁了的轨一律不切。 */
export function splitAtPlayhead(tr: Tracks, at: number, picked: string | readonly string[] | null, newId: () => string): Tracks {
  const under = (l: Lane, c: TlClip) => !l.locked && at > c.start + EPS && at < endOf(c) - EPS
  const ids = picked === null ? [] : typeof picked === 'string' ? [picked] : picked
  const mine = ids.filter((id) => { const f = findClip(tr, id); return !!f && under(f.lane, f.clip) })
  let out = tr
  if (mine.length) { for (const id of mine) out = splitClip(out, id, at, newId()); return out }
  for (const l of tr) for (const c of l.clips) if (under(l, c)) out = splitClip(out, c.id, at, newId())
  return out
}

export function removeClip(tr: Tracks, id: string): Tracks {
  const f = findClip(tr, id)
  if (!f) return tr
  return mapLane(tr, f.lane.id, (l) => ({ ...l, clips: l.clips.filter((x) => x.id !== id) }))
}

// ── 复原／重做 ──
export type Hist = { past: Tracks[]; future: Tracks[] }
export const EMPTY_HIST: Hist = { past: [], future: [] }
/** 改动成立前把旧状态记一笔（新动作清掉重做） */
export function commitHist(h: Hist, prev: Tracks): Hist {
  return { past: [...h.past, prev].slice(-HIST_CAP), future: [] }
}
export function undoHist(h: Hist, cur: Tracks): { hist: Hist; tracks: Tracks } | null {
  if (!h.past.length) return null
  return { hist: { past: h.past.slice(0, -1), future: [cur, ...h.future] }, tracks: h.past[h.past.length - 1] }
}
export function redoHist(h: Hist, cur: Tracks): { hist: Hist; tracks: Tracks } | null {
  if (!h.future.length) return null
  return { hist: { past: [...h.past, cur], future: h.future.slice(1) }, tracks: h.future[0] }
}

// ── 剪映快捷键──
export type KeyAct = 'play' | 'frame-prev' | 'frame-next' | 'sec-prev' | 'sec-next' | 'edge-prev' | 'edge-next'
  | 'split' | 'delete' | 'undo' | 'redo' | 'zoom-in' | 'zoom-out' | 'home' | 'end'
  | 'copy' | 'cut' | 'paste' | 'add-chat' | 'select-all'
  | 'tool-select' | 'tool-blade' | 'select-left' | 'select-right' | 'trim-left' | 'trim-right' | 'marker' | 'escape'
  | 'nudge-prev' | 'nudge-next'   // Alt（⌥）＋←→＝选中片段前后挪一帧
  | 'copy-attr' | 'paste-attr'   // Ctrl／⌘＋Alt＋C／V＝复制／粘贴属性
/** code＝实体键位（KeyboardEvent.code）：Mac 上 Option+A 打出来的 key 是「å」·要靠 code 认 */
export type KeyLike = { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }
/** （剪映时间轴上方工具列）：单键（不按 Ctrl／Alt／Shift）——A 选择·B 分割（刀片）·[ 向左全选·] 向右全选·Q 向左裁剪·W 向右裁剪·M 加标记 */
const PLAIN_KEY: Record<string, KeyAct> = { a: 'tool-select', b: 'tool-blade', '[': 'select-left', ']': 'select-right', q: 'trim-left', w: 'trim-right', m: 'marker' }
/** 打出来的不是英文字（俄文键盘、输入法）⇒ 照实体键位认（打出别的英文字＝别种键盘排法·照打出来的字认·不看键位） */
const PLAIN_CODE: Record<string, KeyAct> = { KeyA: 'tool-select', KeyB: 'tool-blade', BracketLeft: 'select-left', BracketRight: 'select-right', KeyQ: 'trim-left', KeyW: 'trim-right', KeyM: 'marker' }
/** 键 ⇒ 动作；正在打字（输入框／对话框）⇒ null（⛔ 吃键）。
 * Ctrl／⌘＋C／X／V＝复制／剪下／贴上；：Ctrl／⌘＋A＝选中全部片段（锁了的轨由 liveSelection 筛掉）；：Alt（⌥）＋A＝加進對話（按 code 认·Mac 打出 å 也算）。
 * 单键 A／B／[／]／Q／W／M 见 PLAIN_KEY；Esc＝'escape'（刀片模式回选择·页面没事可做就不吃键）。 */
/** 不用打字的输入框种类（滑杆、勾选、色盘、按钮）：焦点停在上面时 Ctrl／⌘ 组合键照样归页面 */
export const NON_TEXT_INPUT: ReadonlySet<string> = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file', 'image'])
/** Alt（⌥）＋A 单按（不带 Ctrl／⌘／Shift）·按实体键位认（Mac 打出 å） */
const isAltA = (e: KeyLike) => !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyA'
export function keyAction(e: KeyLike, typing: boolean): KeyAct | null {
  //   Alt＋A 不是打字用的键 ⇒ 焦点在对话框（或别的输入框）里照样归「加進對話」（页面那边做了才吃键·吃了就不会打出 å）；其余快捷键打字时照旧一律不吃
  if (isAltA(e)) return 'add-chat'
  if (typing) return null
  const mod = !!(e.ctrlKey || e.metaKey)
  if (e.altKey) {
    if (mod && !e.shiftKey && e.code === 'KeyC') return 'copy-attr'
    if (mod && !e.shiftKey && e.code === 'KeyV') return 'paste-attr'
    if (mod || e.shiftKey) return null
    if (e.code === 'KeyA') return 'add-chat'
    // （←→ 单按照旧＝播放头前后一帧）
    if (e.key === 'ArrowLeft') return 'nudge-prev'
    if (e.key === 'ArrowRight') return 'nudge-next'
    return null
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod) {
    if (!e.shiftKey && (k === 'c' || e.code === 'KeyC')) return 'copy'
    if (!e.shiftKey && (k === 'x' || e.code === 'KeyX')) return 'cut'
    if (!e.shiftKey && (k === 'v' || e.code === 'KeyV')) return 'paste'
    if (!e.shiftKey && (k === 'a' || e.code === 'KeyA')) return 'select-all'
    if (k === 'b') return 'split'
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
    if (k === 'y') return 'redo'
    if (k === '=' || k === '+') return 'zoom-in'
    if (k === '-' || k === '_') return 'zoom-out'
    return null
  }
  switch (k) {
    case ' ': return 'play'
    case 'ArrowLeft': return e.shiftKey ? 'sec-prev' : 'frame-prev'
    case 'ArrowRight': return e.shiftKey ? 'sec-next' : 'frame-next'
    case 'ArrowUp': return 'edge-prev'
    case 'ArrowDown': return 'edge-next'
    case 'Delete': case 'Backspace': return 'delete'
    case 'Home': return 'home'
    case 'End': return 'end'
    case 'Escape': return 'escape'
  }
  if (e.shiftKey) return null
  return /^[\x20-\x7e]$/.test(e.key) ? PLAIN_KEY[k] ?? null : (e.code && PLAIN_CODE[e.code]) || null
}

// ── 缩放与右边无上限──
/** 「整段刚好放得进可见宽度」那一档（每秒几像素）；没内容 ⇒ ZOOM_MIN */
export function zoomFit(end: number, viewW: number): number {
  if (!(end > 0) || !(viewW > 0)) return ZOOM_MIN
  return Math.min(ZOOM_MAX, Math.max(1e-9, Math.floor((Math.max(1, viewW - FIT_PAD) / end) * 1e9) / 1e9))
}
/** 缩到最小时整段占可见宽度的几分之一 */
export const ZOOM_FLOOR_SHARE = 10
/** 缩放下限：整段占可见宽度 1/ZOOM_FLOOR_SHARE 那一档（片长片短都同一个比例）；没内容 ⇒ ZOOM_MIN */
export function zoomFloor(end: number, viewW: number): number {
  if (!(end > 0) || !(viewW > 0)) return ZOOM_MIN
  return Math.max(1e-9, Math.floor((zoomFit(end, viewW) / ZOOM_FLOOR_SHARE) * 1e9) / 1e9)
}
/** 缩放：factor 乘上去夹在 [floor, ZOOM_MAX] */
export function zoomBy(px: number, factor: number, floor: number = ZOOM_MIN): number {
  return clamp(Math.round(px * factor * 1e9) / 1e9, Math.min(floor, ZOOM_MAX), ZOOM_MAX)
}
/** 时间轴画多长（秒）：尾巴后永远多留至少一个可见宽度（viewSec＝可见宽度折成秒·至少 10 秒）——片段往右拖、尾巴变长，画布跟着变长＝右边无上限 */
export function canvasSeconds(end: number, viewSec: number): number {
  return Math.ceil(Math.max(0, end) + Math.max(10, Number.isFinite(viewSec) ? viewSec : 10))
}
/** 时间尺刻度：小刻度间距至少 10 像素·大刻度（带字）至少 70 像素且是小刻度的整数倍（各挑最小够格的那档秒数） */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000, 86400]
export function rulerStep(px: number): { major: number; minor: number } {
  const last = TICK_STEPS[TICK_STEPS.length - 1]
  const minor = TICK_STEPS.find((s) => s * px >= 10) ?? last
  const major = TICK_STEPS.find((s) => s * px >= 70 && s % minor === 0) ?? last
  return { major, minor }
}
/** 以游标为锚缩放后的新捲动位置（游标下那一刻不跑） */
export function zoomScroll(scrollLeft: number, cursorX: number, oldPx: number, newPx: number): number {
  return Math.max(0, (scrollLeft + cursorX) * (newPx / oldPx) - cursorX)
}
/** 播放时时间轴跟着播放头捲：
 * 播放头跑出可见区 ⇒ 回新的 scrollLeft（播放头放在左边 margin 处）；还在画面里 ⇒ null（不动）。
 * 使用者自己捲过（userScrolled）就不再叫它·直到再按播放或点尺规。 */
export function followScroll(headX: number, scrollLeft: number, viewW: number, margin = 40): number | null {
  if (headX >= scrollLeft && headX <= scrollLeft + viewW - margin) return null
  return Math.max(0, headX - margin)
}
/** 捲动事件是不是使用者捲的：不是我们刚自动捲到的那个位置（差 1 像素内算我们的）⇒ 是使用者 */
export function userScrolled(actual: number, autoSet: number | null): boolean {
  return autoSet === null || Math.abs(actual - autoSet) > 1
}
/** 预览窗捏合缩放：1～4 倍 */
export function previewScale(cur: number, wheelDeltaY: number): number {
  return clamp(Math.round(cur * Math.exp(-wheelDeltaY * 0.01) * 100) / 100, 1, 4)
}

// ════════ ：多选、框选、整批移动跨轨、复制剪下贴上、Alt 拖复制、右键选单 ════════
type Found = { lane: Lane; clip: TlClip }
const found = (tr: Tracks, ids: readonly string[]): Found[] => ids.map((id) => findClip(tr, id)).filter((f): f is Found => !!f)
const laneIndex = (tr: Tracks, id: string) => tr.findIndex((l) => l.id === id)

/** 选取跟着轨道走：删掉的、所在轨锁了的自动掉出去；没变 ⇒ 原阵列 */
export function liveSelection(tr: Tracks, sel: readonly string[]): readonly string[] {
  const next = sel.filter((id) => editable(tr, id))
  return next.length === sel.length ? sel : next
}
/** 点片段：additive（Ctrl／⌘＋点）⇒ 把它加入／移出选取；否则只选它。锁了的轨上的片段不进选取（普通点 ⇒ 清空、Ctrl 点 ⇒ 不变） */
export function clickSelect(tr: Tracks, sel: readonly string[], id: string, additive: boolean): string[] {
  if (!editable(tr, id)) return additive ? [...sel] : []
  if (!additive) return [id]
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
}
/** 框选（轨道空白处按住拉框）：框到的那几条轨上、时间跟 [t0,t1] 有交集的片段（锁了的轨不算）·base＝按着 Ctrl 拉框时并进去的原选取 */
export function boxSelect(tr: Tracks, laneIds: readonly string[], t0: number, t1: number, base: readonly string[] = []): string[] {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1)
  const out = [...base]
  for (const l of tr) {
    if (l.locked || !laneIds.includes(l.id)) continue
    for (const c of l.clips) if (c.start < hi - EPS && endOf(c) > lo + EPS && !out.includes(c.id)) out.push(c.id)
  }
  return out
}
/** 右键点到哪段 ⇒ 选单对谁：点在选取里 ⇒ 整批；不在 ⇒ 只对它（剪映同样） */
export function menuTargets(sel: readonly string[], id: string): string[] {
  return sel.includes(id) ? [...sel] : [id]
}

/** 整批移动的选项：copy＝Alt 拖复制；newId(旧编号)＝复制出来那段的编号；
 *  edge＝滑鼠在轨道区最上／最下那片空白；newLaneId(来源轨编号)＝要新增轨时那条新轨的编号（页面整趟拖动固定同一组·免得每动一下换编号） */
export type MoveOpts = { copy?: boolean; newId?: (oldId: string) => string; edge?: 'top' | 'bottom'; newLaneId?: (fromLaneId: string) => string
  /** 这条轨上原有的片段不挡路（主轨磁吸：落进主轨可以先叠着·由 magnet.pure 的 magnetPack 照落点插进去再排紧） */
  free?: string
  /** 落点撞到那条轨上别的片段 ⇒ 紧贴那条轨在它上面新开一条（同种）放进去·不再挪去最近空位 */
  overlapNew?: boolean }
/** 整批移动（片段间相对位置不变）：dt＝想挪的秒数·laneShift＝往下挪几条轨（负＝往上）·copy＝Alt 拖复制（原片段留着·挪的是新的一份·newId 给编号）。
 *  跨轨（改的规矩）：每条来源轨挪到「自己那条＋laneShift」——
 *   ① 只在自己那一区：上区（画面区）的片段不进音频区、音频片段不进上区；整批挪过头 ⇒ 位移夹到区边（停在区边·不报错）；
 *   ② 落到同种轨 ⇒ 进那条；落到上区别种轨（例：文字拖到影片轨）⇒ 贴着那条新增一条自己这种轨（往下拖 ⇒ 新轨在它下面·往上拖 ⇒ 在它上面）＝叠层跟着落点走；
 *   ③ 落到锁了的轨 ⇒ 整批不换轨、只挪时间（锁了的轨不动）；
 *   ④ edge 拖到上区最上那片空白（整批都是上区片段）／音频区最下那片空白（整批都是音频）⇒ 每条来源轨在最外面各新增一条（上下顺序照旧）；拖错边 ⇒ 夹到区边。
 *  落点被占：整批找离想要位移最近、每段都不撞别的片段、都不小于 0 的那个位移（同单段 placeFree 的规矩）。锁了的轨上的片段不动。没动 ⇒ 原物件。
 *  拖走后空了的非主轨由页面放手时 pruneLanes 收掉。 */
export function moveGroup(tr: Tracks, ids: readonly string[], dt: number, laneShift: number, opts: MoveOpts = {}): Tracks {
  const copy = !!opts.copy
  const items = found(tr, ids).filter((f) => !f.lane.locked)
  if (!items.length) return tr
  const idx = (l: Lane) => tr.indexOf(l)
  const srcLanes = [...new Set(items.map((f) => f.lane))].sort((a, b) => idx(a) - idx(b))
  const edgeNew = opts.edge === 'top' ? srcLanes.every((l) => zoneOf(l.kind) === 'upper') : opts.edge === 'bottom' ? srcLanes.every((l) => zoneOf(l.kind) === 'audio') : false
  // ① 区界：位移夹到每条来源轨都留在自己那一区（各区间都含 0 ⇒ 依序夹完仍在交集里）
  let shift = edgeNew ? 0 : opts.edge ? (opts.edge === 'top' ? -tr.length : tr.length) : Number.isFinite(laneShift) ? Math.trunc(laneShift) : 0
  for (const l of srcLanes) { const [lo, hi] = zoneRange(tr, zoneOf(l.kind)); const i = idx(l); shift = clamp(shift, lo - i, hi - i) }
  type Dest = { lane: Lane } | { fresh: string; pos: number; kind: LaneKind }
  const mkLaneId = (from: Lane) => (opts.newLaneId ? opts.newLaneId(from.id) : `${from.id}-n`)
  const dest = new Map<Lane, Dest>()
  for (const l of srcLanes) {
    const i = idx(l)
    if (edgeNew) { dest.set(l, { fresh: mkLaneId(l), pos: (opts.edge === 'top' ? -1 : tr.length) + i / (tr.length + 1), kind: l.kind }); continue }
    const t = tr[i + shift]
    if (shift === 0 || t === l) { dest.set(l, { lane: l }); continue }
    if (t.locked) { dest.clear(); break } // ③
    dest.set(l, t.kind === l.kind ? { lane: t } : { fresh: mkLaneId(l), pos: i + shift + (shift > 0 ? 0.5 : -0.5), kind: l.kind }) // ②
  }
  if (!dest.size) for (const l of srcLanes) dest.set(l, { lane: l })
  const moving = new Set(items.map((f) => f.clip.id))
  if (opts.overlapNew) {
    const want0 = snapFrame(Math.max(-Math.min(...items.map((f) => f.clip.start)), dt))
    for (const l of srcLanes) {
      const to = dest.get(l)!
      if (!('lane' in to) || to.lane.id === opts.free) continue
      const bl = copy ? to.lane.clips : to.lane.clips.filter((c) => !moving.has(c.id))
      //   ① 吸附到别段头尾＝贴着放（素材长度不是整帧·对齐到帧会叠进去不到一帧 ⇒ 不算撞）；② 真撞到 ⇒ 拖的那段去新轨·开在离主轨远的那一边（上区开在上面·音频区开在下面）＝原来那条轨与上面的片段都不换轨
      if (items.some((f) => f.lane === l && overlapsBy(bl, f.clip.start + want0, f.clip.length) > FRAME / 2)) dest.set(l, { fresh: mkLaneId(l), pos: idx(to.lane) + (growsDown(l.kind) ? 0.5 : -0.5), kind: l.kind })
    }
  }
  const destOf = (f: Found) => dest.get(f.lane)!
  const blockers = (f: Found): readonly TlClip[] => { const t = destOf(f); return 'lane' in t && t.lane.id !== opts.free ? (copy ? t.lane.clips : t.lane.clips.filter((c) => !moving.has(c.id))) : [] }
  const minStart = Math.min(...items.map((f) => f.clip.start))
  const want = snapFrame(Math.max(-minStart, dt))
  const ok = (d: number) => d >= -minStart - EPS && items.every((f) => !overlaps(blockers(f), f.clip.start + d, f.clip.length, null))
  const cands = [want, -minStart]
  for (const f of items) for (const o of blockers(f)) cands.push(endOf(o) - f.clip.start, o.start - endOf(f.clip))
  let best: number | null = null
  for (const d of cands) if (ok(d) && (best === null || Math.abs(d - want) < Math.abs(best - want) - EPS)) best = d
  if (best === null) return tr
  const laneChanged = srcLanes.some((l) => { const t = dest.get(l)!; return !('lane' in t) || t.lane !== l })
  if (!copy && !laneChanged && Math.abs(best) < EPS) return tr
  const d = best
  // 对齐到帧会叠进别段（贴着不是整帧的头尾）⇒ 照贴着的那一点放（直接吸附）
  const startOf = (f: Found) => { const raw = Math.max(0, f.clip.start + d), s = Math.max(0, snapFrame(raw)); return overlaps(blockers(f), s, f.clip.length, null) && !overlaps(blockers(f), raw, f.clip.length, null) ? raw : s }
  const placed = items.map((f) => ({ to: destOf(f), clip: { ...f.clip, id: copy ? (opts.newId ? opts.newId(f.clip.id) : `${f.clip.id}~`) : f.clip.id, start: startOf(f) } }))
  // Alt 副本自成新組；取同組副本中最小的固定片段編號，拖動重算或選取順序改變都不換組。
  // 編號必須照工程存讀契約（英數/_/-、最多64字），否則保存後 group 會被校形拿掉。
  if (copy) {
    const used = new Set(tr.flatMap((l) => l.clips.flatMap((c) => c.group ? [c.group] : [])))
    const anchors = new Map<string, string>()
    for (const { clip } of placed) if (clip.group) {
      const at = anchors.get(clip.group)
      if (!at || clip.id < at) anchors.set(clip.group, clip.id)
    }
    const regroup = new Map<string, string>()
    for (const [old, anchor] of [...anchors].sort(([ga, a], [gb, b]) => a < b ? -1 : a > b ? 1 : ga < gb ? -1 : ga > gb ? 1 : 0)) {
      const group = unusedCopyGroupId(anchor, used)
      used.add(group); regroup.set(old, group)
    }
    for (const { clip } of placed) if (clip.group) clip.group = regroup.get(clip.group)!
  }
  const rows: { pos: number; lane: Lane }[] = tr.map((l, i) => {
    const keep = copy ? l.clips : l.clips.filter((c) => !moving.has(c.id))
    const add = placed.filter((p) => 'lane' in p.to && p.to.lane === l).map((p) => p.clip)
    return { pos: i, lane: keep.length === l.clips.length && !add.length ? l : withClips(l, [...keep, ...add]) }
  })
  const fresh = new Map<string, { pos: number; kind: LaneKind; clips: TlClip[] }>()
  for (const p of placed) {
    if ('lane' in p.to) continue
    const e = fresh.get(p.to.fresh) ?? { pos: p.to.pos, kind: p.to.kind, clips: [] }
    e.clips.push(p.clip)
    fresh.set(p.to.fresh, e)
  }
  for (const [id, e] of fresh) rows.push({ pos: e.pos, lane: withClips(newLane(id, e.kind), e.clips) })
  return pinMain(rows.sort((a, b) => a.pos - b.pos).map((r) => r.lane))   // 新开的轨不会落到主轨下面
}

/** 换轨道上下顺序：
 *  把 laneId 那条挪到第 to 位（先拿掉它再插进去的位置）；只在自己那一区里挪（拖过区界 ⇒ 停在区边）；主轨也能挪（上区里）；锁了的轨不动；没变 ⇒ 原物件。
 *  上区顺序＝预览叠层（上面的盖下面的·layersAt 由上到下）。 */
export function moveLane(tr: Tracks, laneId: string, to: number): Tracks {
  const from = tr.findIndex((l) => l.id === laneId)
  if (from < 0 || tr[from].locked || tr[from].id === MAIN_LANE || !Number.isFinite(to)) return tr   // 主轨本身不能拖
  const [lo, hi0] = zoneRange(tr, zoneOf(tr[from].kind))
  const hi = zoneOf(tr[from].kind) === 'upper' ? Math.min(hi0, mainIndex(tr) - (from < mainIndex(tr) ? 1 : 0)) : hi0   // 上区的轨不能挪到主轨下面
  const at = clamp(Math.trunc(to), lo, hi)
  if (at === from) return tr
  const rest = tr.filter((_, i) => i !== from)
  rest.splice(at, 0, tr[from])
  return rest
}

/** 复制下来的东西：片段本身＋原本在哪条轨（贴上时优先回原轨）＋轨道种类；照起点（同起点照轨道由上到下）排 */
export type ClipBoard = { items: { clip: TlClip; laneId: string; kind: LaneKind }[] }
/** 复制：锁了的轨上的也能复制（只读不改）；一段都没有 ⇒ null */
export function copyClips(tr: Tracks, ids: readonly string[]): ClipBoard | null {
  const items = found(tr, ids).map((f) => ({ clip: { ...f.clip }, laneId: f.lane.id, kind: f.lane.kind }))
  if (!items.length) return null
  items.sort((a, b) => a.clip.start - b.clip.start || laneIndex(tr, a.laneId) - laneIndex(tr, b.laneId))
  return { items }
}
/** 贴上（贴在播放头）：整批最早那段的头对齐 at·相对位置不变；每段优先回原轨（还在、种类对、没锁、那段时间空着）·
 *  不然照拖素材进来的落点规划（被占 ⇒ 画面往上、音频往下新增一条）·同一条原轨来的几段跟着进同一条新轨。回新轨道与新片段编号（贴完选取它们）。 */
export function pasteClips(tr: Tracks, board: ClipBoard, at: number, newId: () => string, newLaneId: () => string): { tracks: Tracks; ids: string[] } {
  if (!board.items.length) return { tracks: tr, ids: [] }
  const dt = snapFrame(Math.max(0, at)) - Math.min(...board.items.map((x) => x.clip.start))
  let out = tr
  const ids: string[] = []
  const rehomed = new Map<string, string>()
  const regroup = new Map<string, string>() // 贴出来的那几段自成新组·⛔ 跟原组同一个编号
  for (const it of board.items) {
    const start = Math.max(0, snapFrame(it.clip.start + dt))
    const g = it.clip.group ? (regroup.get(it.clip.group) ?? regroup.set(it.clip.group, newId()).get(it.clip.group)!) : undefined
    const c: TlClip = { ...it.clip, id: newId(), start, ...(g ? { group: g } : {}) }
    const free = (laneId: string | undefined) => {
      const l = laneId ? out.find((x) => x.id === laneId) : undefined
      return l && l.kind === it.kind && !l.locked && !overlaps(l.clips, start, c.length, null) ? l : null
    }
    const lane = free(it.laneId) ?? free(rehomed.get(it.laneId))
    if (lane) out = mapLane(out, lane.id, (l) => withClips(l, [...l.clips, c]))
    else {
      const hintLane = rehomed.get(it.laneId) ?? it.laneId
      const plan = planDrop(out, it.kind, out.some((l) => l.id === hintLane) ? { lane: hintLane } : null, start, c.length)
      const lid = plan.lane ?? newLaneId()
      out = applyDrop(out, plan, c, lid)
      if (plan.lane === null) rehomed.set(it.laneId, lid)
    }
    ids.push(c.id)
  }
  return { tracks: out, ids }
}
/** 原地复制一份：整批复制·贴在这一批最后那段的尾巴 */
export function duplicateClips(tr: Tracks, ids: readonly string[], newId: () => string, newLaneId: () => string): { tracks: Tracks; ids: string[] } {
  const board = copyClips(tr, ids)
  if (!board) return { tracks: tr, ids: [] }
  return pasteClips(tr, board, Math.max(...board.items.map((x) => endOf(x.clip))), newId, newLaneId)
}
/** 整批删（剪下＝复制＋删）：锁了的轨上的不删 */
export function removeClips(tr: Tracks, ids: readonly string[]): Tracks {
  const kill = new Set(ids.filter((id) => editable(tr, id)))
  if (!kill.size) return tr
  return tr.map((l) => (l.clips.some((c) => kill.has(c.id)) ? { ...l, clips: l.clips.filter((c) => !kill.has(c.id)) } : l))
}

/** 这一段会不会出声：素材是影片／音频·而且没把声音分离出去 */
export function hasSound(c: TlClip, kindOf: (mediaId: string) => MediaKindLike | undefined): boolean {
  const k = kindOf(c.mediaId)
  return (k === 'video' || k === 'audio') && !c.detached && !c.freeze // 定格没声音
}
/** 能不能分离音频：没锁、画面轨上、素材是影片、还没分离过 */
export function canDetach(tr: Tracks, id: string, kindOf: (mediaId: string) => MediaKindLike | undefined): boolean {
  const f = findClip(tr, id)
  return !!f && !f.lane.locked && f.lane.kind === 'visual' && !f.clip.detached && kindOf(f.clip.mediaId) === 'video'
}
/** 能不能分离人声：没锁、是素材片段（影片／音频）、此刻会出声（声音没分离出去、不是定格）——画面轨、音频轨上的都行 */
export function canSeparateVocals(tr: Tracks, id: string, kindOf: (mediaId: string) => MediaKindLike | undefined): boolean {
  const f = findClip(tr, id)
  return !!f && !f.lane.locked && isMediaClip(f.clip) && hasSound(f.clip, kindOf)
}
/** 分离音频：同素材、同起点长度入点音量的一段放进音频轨·原片段标 detached（只剩画面）；
 *  音频落点照拖素材进来的规划（主轨下面离主轨最近那条音频轨·那段被占 ⇒ 往下新增一条）。回新轨道与新音频片段编号。 */
export function detachAudio(tr: Tracks, ids: readonly string[], kindOf: (mediaId: string) => MediaKindLike | undefined, newId: () => string, newLaneId: () => string): { tracks: Tracks; ids: string[] } {
  let out = tr
  const made: string[] = []
  for (const id of ids) {
    if (!canDetach(out, id, kindOf)) continue
    const { lane, clip: c } = findClip(out, id)!
    out = mapLane(out, lane.id, (l) => ({ ...l, clips: l.clips.map((x) => (x.id === id ? { ...x, detached: true } : x)) }))
    const a: TlClip = { id: newId(), mediaId: c.mediaId, start: c.start, length: c.length, offset: c.offset, ...(c.volume !== undefined ? { volume: c.volume } : {}), ...(c.muted ? { muted: true } : {}),
      ...(c.speed !== undefined ? { speed: c.speed } : {}), ...(c.pitch ? { pitch: true } : {}), ...(c.fadeIn ? { fadeIn: c.fadeIn } : {}), ...(c.fadeOut ? { fadeOut: c.fadeOut } : {}) }
    out = applyDrop(out, planDrop(out, 'audio', null, c.start, c.length), a, newLaneId())
    made.push(a.id)
  }
  return { tracks: out, ids: made }
}

export type ClipFlag = 'muted' | 'disabled'
const withFlag = (c: TlClip, flag: ClipFlag, on: boolean): TlClip => {
  if (on) return { ...c, [flag]: true }
  const next = { ...c }
  delete next[flag]
  return next
}
/** 这几段（没锁的·applies 过滤）是不是全都已经设了这个旗 */
export function allFlagged(tr: Tracks, ids: readonly string[], flag: ClipFlag, applies: (c: TlClip) => boolean = () => true): boolean {
  const live = found(tr, ids).filter((f) => !f.lane.locked && applies(f.clip))
  return live.length > 0 && live.every((f) => !!f.clip[flag])
}
/** 静音这段／停用这段（留在轨道上）：选的那几段（没锁的）全都已经是 ⇒ 全部取消；否则全部设上 */
export function toggleClipFlag(tr: Tracks, ids: readonly string[], flag: ClipFlag, applies: (c: TlClip) => boolean = () => true): Tracks {
  const live = found(tr, ids).filter((f) => !f.lane.locked && applies(f.clip))
  if (!live.length) return tr
  const on = !live.every((f) => !!f.clip[flag])
  const hit = new Set(live.map((f) => f.clip.id))
  return tr.map((l) => (l.clips.some((c) => hit.has(c.id)) ? { ...l, clips: l.clips.map((c) => (hit.has(c.id) ? withFlag(c, flag, on) : c)) } : l))
}
/** 替换素材（换一个素材·位置长度不变）：入点归 0；画面轨只收影片／图片·音频轨只收有声音的（影片／音频）；
 *  新素材（影音）比片段短 ⇒ 那段不换（skipped）；声音分离的标记拿掉（换了素材·新的声音照放）。 */
export function replaceMedia(tr: Tracks, ids: readonly string[], media: { id: string; kind: MediaKindLike; duration: number }): { tracks: Tracks; replaced: number; skipped: number } {
  let replaced = 0, skipped = 0
  const next = new Map<string, TlClip>()
  for (const f of found(tr, ids)) {
    if (f.lane.locked) continue
    const fitsLane = f.lane.kind === 'audio' ? media.kind !== 'image' : f.lane.kind === 'visual' && media.kind !== 'audio'
    if (!fitsLane || (media.kind !== 'image' && media.duration < f.clip.length - EPS)) { skipped++; continue }
    const c: TlClip = { ...f.clip, mediaId: media.id, offset: 0 }
    delete c.detached
    next.set(c.id, c)
    replaced++
  }
  if (!next.size) return { tracks: tr, replaced, skipped }
  return { tracks: tr.map((l) => (l.clips.some((c) => next.has(c.id)) ? { ...l, clips: l.clips.map((c) => next.get(c.id) ?? c) } : l)), replaced, skipped }
}

// ── 右键选单（常用项·每项右边标快捷键·Mac ⌘／⌥·Windows Ctrl／Alt·没快捷键的不标）──
export type MenuAct = 'copy' | 'cut' | 'paste' | 'delete' | 'duplicate' | 'split' | 'detach' | 'mute' | 'disable' | 'replace' | 'find' | 'add-chat' | 'group' | 'ungroup' | 'subclip' | 'merge'
  | 'freeze' | 'reverse' | 'mirror' | 'copy-attr' | 'paste-attr'
  | 'stems' // 分离人声（复用 AI 分轨·人声／伴奏放回音频轨·见 vedit-clip-stems.pure）
  | 'precomp' // 打包成合成（巢状合成·见 comp.pure precompose）
/** group＝分隔线分的段；on＝静音／停用这几段已经全是（选单写成「取消静音」「启用这段」） */
export type MenuItem = { act: MenuAct; group: number; enabled: boolean; on?: boolean }
const isMediaClip = (c: TlClip) => !!c.mediaId && !c.text && !c.sticker && !c.filter && !c.program
export function clipMenu(tr: Tracks, ids: readonly string[], ctx: { kindOf: (mediaId: string) => MediaKindLike | undefined; canPaste: boolean; playhead: number; canGroup?: boolean; canUngroup?: boolean; canPasteAttr?: boolean }): MenuItem[] {
  const fs = found(tr, ids)
  const live = fs.filter((f) => !f.lane.locked)
  const sounding = (c: TlClip) => hasSound(c, ctx.kindOf)
  const under = live.some((f) => ctx.playhead > f.clip.start + EPS && ctx.playhead < endOf(f.clip) - EPS)
  return [
    { act: 'copy', group: 0, enabled: fs.length > 0 },
    { act: 'cut', group: 0, enabled: live.length > 0 },
    { act: 'paste', group: 0, enabled: ctx.canPaste },
    { act: 'delete', group: 0, enabled: live.length > 0 },
    { act: 'duplicate', group: 0, enabled: fs.length > 0 },
    { act: 'split', group: 1, enabled: under },
    { act: 'detach', group: 1, enabled: live.some((f) => canDetach(tr, f.clip.id, ctx.kindOf)) },
    { act: 'stems', group: 1, enabled: live.some((f) => canSeparateVocals(tr, f.clip.id, ctx.kindOf)) },
    { act: 'mute', group: 2, enabled: live.some((f) => sounding(f.clip)), on: allFlagged(tr, ids, 'muted', sounding) },
    { act: 'disable', group: 2, enabled: live.length > 0, on: allFlagged(tr, ids, 'disabled') },
    // 文字片段没有素材 ⇒ 替换素材／在素材区找到它 不适用
    { act: 'replace', group: 3, enabled: live.some((f) => !f.clip.text && !f.clip.sticker && !f.clip.filter && !f.clip.program) },
    { act: 'find', group: 3, enabled: fs.some((f) => !f.clip.text && !f.clip.sticker && !f.clip.filter && !f.clip.program) },
    // 成组／取消群组（判法在 group.pure）·合成子素材＝有一段出声的就能合
    { act: 'group', group: 4, enabled: !!ctx.canGroup },
    { act: 'ungroup', group: 4, enabled: !!ctx.canUngroup },
    { act: 'subclip', group: 4, enabled: live.some((f) => sounding(f.clip)) },
    // 两段以上就亮（有画面的按了会说明还合不了）
    { act: 'merge', group: 4, enabled: live.length >= 2 },
    { act: 'precomp', group: 4, enabled: live.length > 0 },
    { act: 'add-chat', group: 5, enabled: fs.length > 0 },
    // 定格（播放头压在画面轨影片上）·倒放（影片／音频）·镜像（画面轨素材）·复制／粘贴属性
    { act: 'freeze', group: 6, enabled: live.some((f) => f.lane.kind === 'visual' && !f.clip.freeze && isMediaClip(f.clip) && ctx.kindOf(f.clip.mediaId) === 'video' && ctx.playhead >= f.clip.start - EPS && ctx.playhead <= endOf(f.clip) + EPS) },
    { act: 'reverse', group: 6, enabled: live.some((f) => !f.clip.freeze && isMediaClip(f.clip) && (ctx.kindOf(f.clip.mediaId) === 'video' || ctx.kindOf(f.clip.mediaId) === 'audio')), on: live.length > 0 && live.every((f) => !!f.clip.reverse) },
    { act: 'mirror', group: 6, enabled: live.some((f) => f.lane.kind === 'visual' && isMediaClip(f.clip)) },
    { act: 'copy-attr', group: 7, enabled: fs.some((f) => isMediaClip(f.clip)) },
    { act: 'paste-attr', group: 7, enabled: !!ctx.canPasteAttr && live.some((f) => isMediaClip(f.clip)) },
  ]
}
const SHORTCUT: Partial<Record<MenuAct, { mod?: boolean; alt?: boolean; key: string }>> = {
  copy: { mod: true, key: 'C' }, cut: { mod: true, key: 'X' }, paste: { mod: true, key: 'V' }, delete: { key: 'Delete' },
  'copy-attr': { mod: true, alt: true, key: 'C' }, 'paste-attr': { mod: true, alt: true, key: 'V' },
  split: { mod: true, key: 'B' }, 'add-chat': { alt: true, key: 'A' },
}
/** 选单项右边那格快捷键字（Mac ⌘C／⌥A／⌫·Windows Ctrl+C／Alt+A／Delete）；没快捷键 ⇒ null（不标） */
export function shortcutLabel(act: MenuAct, mac: boolean): string | null {
  const s = SHORTCUT[act]
  if (!s) return null
  if (s.key === 'Delete') return mac ? '⌫' : 'Delete'
  if (s.mod && s.alt) return mac ? `⌥⌘${s.key}` : `Ctrl+Alt+${s.key}`
  if (s.mod) return mac ? `⌘${s.key}` : `Ctrl+${s.key}`
  if (s.alt) return mac ? `⌥${s.key}` : `Alt+${s.key}`
  return s.key
}
/** navigator.platform／userAgentData.platform ⇒ 是不是苹果（Mac／iPad／iPhone） */
export const isMacPlatform = (platform: string | null | undefined) => /mac|iphone|ipad|ipod/i.test(platform ?? '')

// ════════ （剪映：片段里画声音波形·上面一条横向音量线·拖上拖下调这一段的音量）════════
/** 音量上限＝1000%（剪映同）；下限 0 */
export const VOL_MAX = 10
/** 音量线的刻度按分贝走（耳朵听的是分贝）：最底＝静音·往上 -60 dB → +20 dB（＝1000%）；100%（0 dB）落在高度的 3/4 */
export const VOL_DB_MIN = -60
export const VOL_DB_MAX = 20
/** 这一段的音量倍数（缺＝1） */
export function clipGain(c: Pick<TlClip, 'volume'>): number {
  const v = c.volume ?? 1
  return Number.isFinite(v) ? clamp(v, 0, VOL_MAX) : 1
}
/** 音量倍数 ⇒ 音量线离片段底多高（0..1） */
export function gainToFrac(g: number): number {
  if (!(g > 0)) return 0
  const db = 20 * Math.log10(Math.min(g, VOL_MAX))
  return clamp((db - VOL_DB_MIN) / (VOL_DB_MAX - VOL_DB_MIN), 0, 1)
}
/** 音量线高度（0..1）⇒ 音量倍数（贴到最底＝0·对到 1% 一格·贴近 100% 吸过去） */
export function fracToGain(f: number): number {
  if (!(f > 0.005)) return 0
  const db = VOL_DB_MIN + clamp(f, 0, 1) * (VOL_DB_MAX - VOL_DB_MIN)
  const g = Math.round(Math.pow(10, db / 20) * 100) / 100
  return clamp(Math.abs(g - 1) <= 0.03 ? 1 : g, 0, VOL_MAX)
}
/** 拖音量线换算用的最小高度（像素）：轨道矮（音频轨片段里那块才二十几像素）时一像素会跳三四个分贝·太粗 ⇒ 至少照 80 像素算（约一像素一分贝） */
export const VOL_DRAG_MIN_PX = 80
/** 拖音量线：按下时 g0·往下拖了 dy 像素（往上为负）·那块高 h 像素（不足 VOL_DRAG_MIN_PX 照它算）⇒ 新音量倍数（夹在 0～1000%） */
export function dragVolume(g0: number, dy: number, h: number): number {
  if (!(h > 0)) return clipGain({ volume: g0 })
  return fracToGain(gainToFrac(g0) - dy / Math.max(h, VOL_DRAG_MIN_PX))
}
/** 音量线旁那个数字（125%） */
export const volumeLabel = (g: number) => `${Math.round(clamp(g, 0, VOL_MAX) * 100)}%`
/** 设这几段的音量（多选时一起调·锁了的轨不动·applies 过滤没声音的）；没变 ⇒ 原物件 */
export function setClipVolume(tr: Tracks, ids: readonly string[], g: number, applies: (c: TlClip) => boolean = () => true): Tracks {
  const v = Math.round(clamp(Number.isFinite(g) ? g : 1, 0, VOL_MAX) * 100) / 100
  const hit = new Set(found(tr, ids).filter((f) => !f.lane.locked && applies(f.clip) && Math.abs(clipGain(f.clip) - v) > 1e-9).map((f) => f.clip.id))
  if (!hit.size) return tr
  const put = (c: TlClip): TlClip => { if (v !== 1) return { ...c, volume: v }; const n = { ...c }; delete n.volume; return n }
  return tr.map((l) => (l.clips.some((c) => hit.has(c.id)) ? { ...l, clips: l.clips.map((c) => (hit.has(c.id) ? put(c) : c)) } : l))
}
/** 预览时影音元素怎么出这个音量：元素自己的 volume 只到 100%·超过要接一个增益节点（Web Audio）——
 *  已接过 ⇒ 元素开满、全交给增益节点；≤100% ⇒ 用元素 volume；>100% 且能接（同源档·本机储存／预览档的 blob 链接）⇒ 接上；
 *  接不了（云盘链接·跨网域接了会整段没声音）⇒ 先开到 100%（等本机那份下载好换成 blob 链接再接）。 */
export function elementGain(g: number, s: { wired: boolean; canWire: boolean }): { volume: number; boost: number | null; wire: boolean } {
  const v = clamp(Number.isFinite(g) ? g : 1, 0, VOL_MAX)
  if (s.wired) return { volume: 1, boost: v, wire: false }
  if (v <= 1) return { volume: v, boost: null, wire: false }
  if (s.canWire) return { volume: 1, boost: v, wire: true }
  return { volume: 1, boost: null, wire: false }
}

/** 汇出混音的清单：每段会出声的——轨没隐藏没静音、片段没静音没停用没分离、素材有声音——
 *  照起点排·gain＝这段的音量倍数（0 的不列）。汇出那层照这份逐段取声音、乘 gain 再混（预览走 layersAt 的 gain·同一份规矩）。 */
export type MixSeg = { clipId: string; laneId: string; mediaId: string; start: number; length: number; offset: number; gain: number; speed: number; pitch: boolean; fadeIn: number; fadeOut: number }
export function audioMix(tr: Tracks, kindOf: (mediaId: string) => MediaKindLike | undefined): MixSeg[] {
  const out: MixSeg[] = []
  for (const l of tr) {
    if (l.hidden || l.muted) continue
    for (const c of l.clips) {
      if (c.muted || c.disabled || !hasSound(c, kindOf)) continue
      const gain = clipGain(c)
      if (gain <= 0) continue
      out.push({ clipId: c.id, laneId: l.id, mediaId: c.mediaId, start: c.start, length: c.length, offset: c.offset, gain, speed: speedOf(c), pitch: !!c.pitch, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0 })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// ── 声音波形（片段里画·剪映截图）：素材的声音先算成「每秒 PEAKS_PER_SEC 格」的峰值表（0..1）·片段照它的入点与长度取那一段画 ──
export const PEAKS_PER_SEC = 50
/** 一块解出来的声音（各声道一条 Float32 PCM·从素材第 t0 秒起）⇒ 并进峰值表（每格取绝对值最大）；超出表尾的丢掉 */
export function accumulatePeaks(peaks: Float32Array, sampleRate: number, t0: number, channels: readonly Float32Array[]): void {
  if (!(sampleRate > 0) || !channels.length) return
  const n = channels[0].length
  const step = sampleRate / PEAKS_PER_SEC
  for (let i = 0; i < n; i++) {
    const cell = Math.floor((t0 + i / sampleRate) * PEAKS_PER_SEC + 1e-9)
    if (cell < 0) continue
    if (cell >= peaks.length) break
    let m = 0
    for (const ch of channels) { const a = Math.abs(ch[i] ?? 0); if (a > m) m = a }
    if (m > peaks[cell]) peaks[cell] = Math.min(1, m)
    // 一格里样本很多：跳着看也够画（每格最多看 ~200 个样本）·省时间
    if (step > 400) i += Math.floor(step / 200) - 1
  }
}
/** 波形一根画多高（0..1）：按分贝画（下限 -48 dB）·小声的素材也看得出起伏；乘上这段的音量（调大／调小波形跟着变） */
export const WAVE_DB_FLOOR = -48
export function waveHeight(peak: number, gain: number = 1): number {
  const a = peak * Math.max(0, gain)
  if (!(a > 0)) return 0
  return clamp((20 * Math.log10(a) - WAVE_DB_FLOOR) / -WAVE_DB_FLOOR, 0, 1)
}
/** 片段要画的那一段：素材 offset 起 length 秒·切成 bars 根·每根取那一段的最大峰值（没有表 ⇒ 空） */
export function peaksWindow(peaks: ArrayLike<number> | null | undefined, offset: number, length: number, bars: number): number[] {
  if (!peaks || !peaks.length || !(length > 0) || bars < 1) return []
  const out: number[] = []
  const per = (length * PEAKS_PER_SEC) / bars
  for (let b = 0; b < bars; b++) {
    const a = Math.floor(offset * PEAKS_PER_SEC + b * per)
    const z = Math.max(a + 1, Math.floor(offset * PEAKS_PER_SEC + (b + 1) * per))
    let m = 0
    for (let i = Math.max(0, a); i < Math.min(peaks.length, z); i++) if (peaks[i] > m) m = peaks[i]
    out.push(m)
  }
  return out
}

/** 横跨轨道区的竖线（播放头、对齐线）捲到左边轨道头底下的那截要裁掉——
 *  left＝竖线在画布里的 x（含轨道头宽）；labelW＝轨道头宽；捲动量由页面写进 CSS 变量 --tl-sl。回 clip-path 值（裁掉的部分也点不到）。 */
export function underHeadClip(left: number, labelW: number): string {
  return `inset(0 0 0 max(0px, calc(var(--tl-sl, 0px) + ${Math.round((labelW - left) * 100) / 100}px)))`
}

/** 拖着东西（播放头）碰到轨道区边缘 ⇒ 每帧捲几像素。x＝滑鼠；left／right＝轨道区可见的左右边（左边扣掉轨道头）。
 *  离边 edge 像素内开始捲·越往外越快（出了边一个 edge 就到最快 max）；在中间 ⇒ 0。负＝往左。 */
export function edgeScrollStep(x: number, left: number, right: number, edge = 32, max = 24): number {
  if (!(right - left > 2 * edge)) return 0
  if (x < left + edge) return -Math.ceil(max * Math.min(1, (left + edge - x) / (2 * edge)))
  if (x > right - edge) return Math.ceil(max * Math.min(1, (x - (right - edge)) / (2 * edge)))
  return 0
}

/** Ctrl／⌘＋滚轮（或触控板捏合）一下缩放几倍。
 * 行数制／页数制先换成像素；每一下最多算 WHEEL_ZOOM_CAP 像素 ⇒ 滑鼠滚一格（约 100 像素）只放大缩小约两成（原本约 2.7 倍）；
 * 触控板捏合每下本来就只有几像素·不受上限影响·手感照旧。往上滚（负）＝放大。 */
export const WHEEL_ZOOM_K = 0.01
export const WHEEL_ZOOM_CAP = 18
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1)
  return Math.exp(-clamp(px, -WHEEL_ZOOM_CAP, WHEEL_ZOOM_CAP) * WHEEL_ZOOM_K)
}
