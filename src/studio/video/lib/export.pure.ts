// 网页剪辑页·汇出成片的纯半（顶栏「匯出」开放——整条时间轴在浏览器里逐帧画成 MP4〔H.264＋AAC〕下载／存云盘）。
// 本档只算「要画什么」：成片多大（照播放器比例黑框·短边 1080／720）、第几帧在时间轴第几秒、这一刻由下往上每一层画哪段、素材取第几秒、
// 特效／转场／滤镜／文字／贴纸／程序片段各要的参数；真正解码、画布、编码在 video-edit/VeditExport.tsx。⛔ 碰 DOM。
// 规矩跟预览同一份：layersAt（隐藏的轨不画·停用的段不画）·素材秒数＝offset＋（t−start）×speed·特效转场 fxStateAt·滤镜 filterOverLayer。
import { adjustLayersOver } from './clip-look.pure' // 调节层
import type { Grade } from './grade.pure'
import { textBodyAt } from './text-kf.pure' // 文字关键帧
import { fxStateAt, type FxPass, type TransPass } from './fx.pure'
import { filterOverLayer } from './filter.pure'
import type { FilterParams } from './filters.data'
import { programTime } from './program.pure'
import { maskMatteNegOff, matteClipAt, matteLaneOf, matteLanesAt, type MatteMode } from './mask-matte.pure' // 轨道遮罩
import { COMP_DEPTH_MAX, compDuration, compNegOff, type Comps, type VeditComp } from './comp.pure' // 巢状合成
import { layersAt, timelineEnd, type LayerState, type MediaKindLike, type StickerBody, type TextBody, type TlClip, type Tracks } from './timeline.pure'

export const EXPORT_FPS = 30
/** 帧率选项（含 60fps） */
export const EXPORT_FPS_OPTS = [30, 60] as const
export type ExportFps = (typeof EXPORT_FPS_OPTS)[number]
/** 解析度选项：短边几像素（含 2K〔1440〕、4K〔2160〕） */
export type ExportRes = '2160' | '1440' | '1080' | '720'
export const EXPORT_RES: readonly ExportRes[] = ['2160', '1440', '1080', '720']
/** 解析度按钮上写的字 */
export const resLabel = (r: ExportRes) => (r === '2160' ? '4K' : r === '1440' ? '2K' : `${r}p`)
/** 长边上限（H.264 常见硬件编码器 4096 内都吃得下·太扁太长的自定义比例等比缩） */
export const EXPORT_MAX_SIDE = 3840
/** 声音取样率 */
export const EXPORT_SAMPLE_RATE = 48000

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2)
/** 成片宽高：照播放器比例（ratio＝宽／高·null ⇒ 16:9）·短边＝解析度·长边超过上限 ⇒ 整体等比缩·都取偶数（H.264 4:2:0 要偶数） */
export function exportSize(ratio: number | null, res: ExportRes): { w: number; h: number } {
  const r = ratio !== null && Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
  const short = Number(res)
  let w = r >= 1 ? short * r : short
  let h = r >= 1 ? short : short / r
  const k = Math.min(1, EXPORT_MAX_SIDE / Math.max(w, h))
  w *= k; h *= k
  return { w: even(w), h: even(h) }
}

/** 汇出哪一段：整条＝0..timelineEnd；合成子素材＝选中那几段的头尾（only＝只画这几段） */
export type ExportRange = { from: number; to: number; only?: ReadonlySet<string> }
export const wholeRange = (tr: Tracks): ExportRange => ({ from: 0, to: timelineEnd(tr) })
/** 只汇出选中的那几段（剪映「导出选中片段」）：头尾＝选中那几段最早的头到最晚的尾·只画那几段；没选到 ⇒ null */
export function selectionRange(tr: Tracks, ids: readonly string[]): ExportRange | null {
  const want = new Set(ids)
  const cs = tr.flatMap((l) => l.clips.filter((c) => want.has(c.id)))
  if (!cs.length) return null
  const from = Math.min(...cs.map((c) => c.start)), to = Math.max(...cs.map((c) => c.start + c.length))
  return to > from ? { from, to, only: new Set(cs.map((c) => c.id)) } : null
}
/** 一共几帧（尾巴不满一帧也算一帧·至少 1） */
export function frameCount(r: Pick<ExportRange, 'from' | 'to'>, fps = EXPORT_FPS): number {
  return Math.max(1, Math.ceil((r.to - r.from) * fps - 1e-6))
}
/** 第 i 帧在时间轴第几秒（取那一帧的开头·同播放头逐帧走的格子） */
export const frameTime = (r: Pick<ExportRange, 'from'>, i: number, fps = EXPORT_FPS): number => r.from + i / fps

// ── 这一刻要画的东西（由下往上）──
/** media：影片／图片（source＝素材第几秒）·fx＝特效转场（fxStateAt·没有 ⇒ null）·filter＝套在它上面的滤镜；
 *  text／sticker：照片段内容画；program：程序片段（t＝叫 render 的秒·params＝本段参数·包的默认值由画的那头补） */
export type FilterOp = { id: string; params: FilterParams; strength: number }
/** otherKind 'comp'＝转场另一边是合成段（otherComp＝哪份·otherMedia 空） */
export type TransOp = TransPass & { otherMedia: string; otherKind: 'video' | 'image' | 'comp'; otherComp?: string }
/** media 'comp'＝合成段：comp＝哪份子合成·source＝画合成里第几秒（null＝出了合成长度·这一刻透明）·mediaId 空 */
export type MediaOp = { kind: 'media'; laneId: string; clip: TlClip; mediaId: string; media: 'video' | 'image' | 'comp'; comp?: string; source: number; effects: FxPass[]; trans: TransOp | null; filter: FilterOp | null
    /** 盖在上面的调节层（由近到远） */ adjust: Grade[]
    /** 轨道遮罩：遮罩轨这一刻要画的东西（画进遮罩画布·matteAlpha 转成遮罩）·没挂 ⇒ 缺 */ matte?: MatteOp }
export type DrawOp =
  | MediaOp
  | { kind: 'text'; laneId: string; clip: TlClip; body: TextBody; at: { t: number; length: number; offset: number } }
  | { kind: 'sticker'; laneId: string; clip: TlClip; body: StickerBody }
  | { kind: 'vector'; laneId: string; clip: TlClip } // 形状／纯色片段（画法＝shape.pure drawVectorClip·同预览）
  | { kind: 'program'; laneId: string; clip: TlClip; pkg: string; t: number; params: Record<string, string | number | boolean> }

/** 轨道遮罩：遮罩轨这一刻的画法（ops 空＝那条此刻没东西 ⇒ 全挡·反相则全露）；
 *  文字／贴纸 ⇒ ui/matte-draw drawMatteOps 画；画面层（影片／图片／形状／合成段·不带它自己的遮罩）⇒ 汇出那支照画面层画进遮罩画布 */
export type MatteOp = { laneId: string; mode: MatteMode; invert: boolean; ops: Array<Extract<DrawOp, { kind: 'text' | 'sticker' | 'vector' | 'media' }>> }
const tsOpOf = (s: LayerState, t: number): Extract<DrawOp, { kind: 'text' | 'sticker' }> | null => {
  const c = s.hit?.clip
  if (!s.show || !c) return null
  if (s.lane.kind === 'text' && c.text) return { kind: 'text', laneId: s.lane.id, clip: c, body: textBodyAt(c, t) ?? c.text, at: { t: s.hit!.local - c.offset, length: c.length, offset: c.offset } }
  if (s.lane.kind === 'sticker' && c.sticker) return { kind: 'sticker', laneId: s.lane.id, clip: c, body: c.sticker }
  return null
}
type KindOf = (mediaId: string) => MediaKindLike | undefined
/** 画面轨这一层这一刻的画法（影片／图片／合成段 ⇒ media·形状纯色动态背景 ⇒ vector·别的 ⇒ null）；遮罩另由调用方挂 */
function visualOpOf(layers: LayerState[], s: LayerState, t: number, kindOf: KindOf, only: ReadonlySet<string> | undefined, comps: Comps | undefined): Extract<DrawOp, { kind: 'vector' | 'media' }> | null {
  const c = s.hit?.clip
  if (!c || s.lane.kind !== 'visual') return null
  const laneId = s.lane.id
  if (c.rig) return null // 空物件／摄影机／灯光：自己不画（rig.pure）
  if (c.shape || c.solid || c.bgfx) return { kind: 'vector', laneId, clip: c }
  const comp = c.comp && !compNegOff() ? comps?.[c.comp] : undefined
  const k = comp ? 'comp' : c.mediaId ? kindOf(c.mediaId) : undefined
  if (k !== 'video' && k !== 'image' && k !== 'comp') return null
  const st = fxStateAt(s.lane, t)
  let trans: TransOp | null = null
  if (st?.trans?.head) trans = { ...st.trans, otherMedia: '', otherKind: 'image' } // 片头转场：另一边＝黑场（不取素材）
  else if (st?.trans && (!only || only.has(st.trans.other.clip.id))) {
    const oc = st.trans.other.clip
    if (oc.comp && comps?.[oc.comp] && !compNegOff()) trans = { ...st.trans, otherMedia: '', otherKind: 'comp', otherComp: oc.comp }
    else { const ok = kindOf(oc.mediaId); if (ok === 'video' || ok === 'image') trans = { ...st.trans, otherMedia: oc.mediaId, otherKind: ok } }
  }
  const f = filterOverLayer(layers, laneId)
  return { kind: 'media', laneId, clip: c, mediaId: c.mediaId, media: k, ...(comp ? { comp: c.comp } : {}), source: k === 'image' ? 0 : s.hit!.local, effects: st?.effects ?? [], trans, filter: f ? { id: f.item.id, params: f.item.params, strength: f.strength } : null, adjust: adjustLayersOver(layers, laneId, t) }
}
/** 轨道遮罩：画面片段 c（在 laneId）这一刻的遮罩画法（预览与汇出同一份）；没挂或找不到遮罩轨 ⇒ undefined；药 ⇒ undefined。
 *  kindOf 不给 ⇒ 画面轨当遮罩的那层不出（预览文字／贴纸遮罩那条只要形状图） */
export function matteOpOf(tr: Tracks, t: number, laneId: string, c: TlClip, kindOf?: KindOf, comps?: Comps): MatteOp | undefined {
  const m = c.look?.matte
  if (!m || maskMatteNegOff()) return undefined
  const mlId = matteLaneOf(tr, laneId, m)
  if (!mlId) return undefined
  const layers = layersAt(tr, t)
  const ml = layers.find((x) => x.lane.id === mlId)
  const hit = matteClipAt(tr, mlId, m, t)
  let mo: MatteOp['ops'][number] | null = null
  if (ml && hit && ml.show) {
    if (ml.lane.kind === 'visual') { const v = kindOf ? visualOpOf(layers, ml, t, kindOf, undefined, comps) : null; mo = v ? (v.kind === 'media' ? { ...v, trans: null } : v) : null }
    else mo = tsOpOf(ml, t)
  }
  return { laneId: mlId, mode: m.mode, invert: !!m.invert, ops: mo ? [mo] : [] }
}
/** 时间轴 t 这一刻由下往上要画的每一层（音频轨、滤镜轨本身不画）；only 给了 ⇒ 只画那几段（滤镜也只认那几段里的）；comps＝子合成（合成段要它） */
export function framePlan(tr: Tracks, t: number, kindOf: KindOf, only?: ReadonlySet<string>, comps?: Comps): DrawOp[] {
  const layers = layersAt(tr, t).map((s) => (only && s.hit && !only.has(s.hit.clip.id) ? { ...s, hit: null, show: false } : s))
  const out: DrawOp[] = []
  // 轨道遮罩：被拿来当遮罩的轨本身不画（matteLanesAt·预览同一份）·它的画法挂到用它的画面片段上
  const mattes = matteLanesAt(tr, t)
  const tsOp = (s: LayerState) => tsOpOf(s, t)
  for (let i = layers.length - 1; i >= 0; i--) {
    const s = layers[i]
    if (!s.show || !s.hit) continue
    const c = s.hit.clip
    const laneId = s.lane.id
    if (mattes.has(laneId)) continue
    if (s.lane.kind === 'text' || s.lane.kind === 'sticker') { const o = tsOp(s); if (o) out.push(o); continue }
    if (s.lane.kind === 'program') { if (c.program) out.push({ kind: 'program', laneId, clip: c, pkg: c.program.pkg, t: programTime(c, s.hit.local), params: c.program.params }); continue }
    const v = visualOpOf(layers, s, t, kindOf, only, comps)
    if (!v) continue
    if (v.kind === 'vector') { out.push(v); continue }
    const matte = c.look?.matte ? matteOpOf(tr, t, laneId, c, kindOf, comps) : undefined
    out.push({ ...v, ...(matte ? { matte } : {}) })
  }
  return out
}
/** 合成段画合成里第几秒：media 'comp' 的 source 就是（srcAt）·出了合成长度 ⇒ 这一刻合成里没东西（透明） */
export const compShows = (op: Pick<MediaOp, 'source'>, comp: Pick<VeditComp, 'length' | 'tracks'>): boolean => op.source >= -1e-6 && op.source < compDuration(comp) - 1e-6
/** 转场另一边是合成段：取合成里第几秒（夹进 [0, 合成长−0.04]·同影片 otherTime） */
export const compOtherTime = (source: number, comp: Pick<VeditComp, 'length' | 'tracks'>): number => Math.min(Math.max(0, source), Math.max(0, compDuration(comp) - 0.04))

/** 素材在成片里放哪（照比例放进整个画面·置中·放不满补黑边·同预览 max-w-full max-h-full／object-contain） */
export function containRect(W: number, H: number, sw: number, sh: number): { x: number; y: number; w: number; h: number } {
  if (!(sw > 0 && sh > 0 && W > 0 && H > 0)) return { x: 0, y: 0, w: W, h: H }
  const s = Math.min(W / sw, H / sh)
  const w = sw * s, h = sh * s
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}
/** 混合模式 ⇒ 画布的 globalCompositeOperation（CSS 名字跟画布同名·normal ⇒ source-over） */
export const blendOp = (b: string): GlobalCompositeOperation => (b === 'normal' || !b ? 'source-over' : (b as GlobalCompositeOperation))
/** 转场另一段取第几秒：图片 ⇒ 0；影片夹进 [0, 素材长−0.04]（同预览 VeditFxCanvas 的 other） */
export function otherTime(kind: 'video' | 'image', source: number, duration: number): number {
  return kind === 'image' ? 0 : Math.min(Math.max(0, source), Math.max(0, (Number.isFinite(duration) && duration > 0 ? duration : Infinity) - 0.04))
}

/** 档名：<工程名>-月日-时分.mp4（去掉档名不准的字） */
export function exportFileName(title: string, d: Date, ext = 'mp4'): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const base = title.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'video'
  return `${base}-${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`
}
/** 汇出框「檔名」栏的默认值：＝原自动档名去掉副档名 */
export function exportNameDefault(title: string, d: Date): string {
  return exportFileName(title, d).replace(/\.mp4$/, '')
}
/** 汇出框填的档名 ⇒ 真档名：去掉档名不准的字与控制字、去头尾空白与开头的点、使用者自己打的同副档名（不分大小写）不重复补；
 *  清完是空的 ⇒ 退回自动档名（<工程名>-月日-时分）。声音／字幕／静帧用同一个名字换副档名 */
export function exportNameFrom(input: string, title: string, d: Date, ext = 'mp4'): string {
  let base = input.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').trim()
  const tail = `.${ext}`
  if (base.toLowerCase().endsWith(tail.toLowerCase())) base = base.slice(0, -tail.length).trim()
  base = base.replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 80).trim()
  return base ? `${base}.${ext}` : exportFileName(title, d, ext)
}
/** 进度：声音混好占前 5%·画面逐帧占 5%～99%·收尾 100%（0～1） */
export function exportProgress(phase: 'audio' | 'frames' | 'done', frame = 0, total = 1): number {
  if (phase === 'audio') return 0.02
  if (phase === 'done') return 1
  return Math.min(0.99, 0.05 + 0.94 * (total > 0 ? frame / total : 0))
}

/** 程序片段汇出用的回传桥（只给汇出那只看不见的沙盒 iframe 插·预览那只不插）：收 dilin-program-capture ⇒ 照样叫 render(t, params, size)·
 *  画好把页里最大那张 canvas 变成 ImageBitmap 传回（transfer·不经网路）·没 canvas／出错 ⇒ 回 null（那一帧这层不画） */
export const PROGRAM_CAPTURE_BRIDGE = `<script>(function(){addEventListener('message',function(e){var m=e.data;if(!m||m.type!=='dilin-program-capture')return;var done=function(b){try{parent.postMessage({type:'dilin-program-frame',seq:m.seq,bitmap:b||null},'*',b?[b]:[])}catch(x){parent.postMessage({type:'dilin-program-frame',seq:m.seq,bitmap:null},'*')}};Promise.resolve().then(function(){var p=window.dilinProgram;if(!p||typeof p.render!=='function')return;return p.render(m.t,m.params,m.size)}).then(function(){var cs=document.getElementsByTagName('canvas'),best=null;for(var i=0;i<cs.length;i++){var c=cs[i];if(c.width>0&&c.height>0&&(!best||c.width*c.height>best.width*best.height))best=c}return best?createImageBitmap(best):null}).then(done,function(){done(null)})})})()</script>`
/** 入口页插上回传桥（插在 </body> 前·包里程序之后跑） */
export function withCaptureBridge(html: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>')
  return i >= 0 ? html.slice(0, i) + PROGRAM_CAPTURE_BRIDGE + html.slice(i) : html + PROGRAM_CAPTURE_BRIDGE
}

/**（Mac Safari 汇出停在 6%、合并没反应）：素材来源（本机储存读原档、图片解码）在 Safari 偶尔永远不回 ⇒ 整趟挂住。
 *  等满 ms 还没回 ⇒ 当没拿到（回 fallback），调用方再改用云盘那份；出错同样回 fallback。 */
export const SOURCE_READ_MS = 8000
export const IMAGE_LOAD_MS = 20000
// Safari 27：Safari 的 H.264 High／Main 编码器在默认 latencyMode 'quality' 下吃进 4 帧就不再出帧、flush 永不回
// （isConfigSupported 照回 true·事先挡不掉）；'realtime'、Baseline、VP9 都正常 ⇒ 只有 WebKit 引擎（Mac Safari、iPhone／iPad 上所有浏览器）改走 'realtime'。
// Chrome／Edge／Firefox 照默认（'quality' 画质较好）。
/** 这个浏览器汇出编码要不要改用低延迟模式（只认 WebKit 引擎·Chrome 系与 Firefox ⇒ undefined＝照默认） */
export function exportLatencyMode(ua: string): 'realtime' | undefined {
  return /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(ua) ? 'realtime' : undefined
}
/** 转预览档走 mediabunny Conversion·它不给填 latencyMode ⇒ 编码器设定没写 latencyMode 时按这个浏览器补上（WebKit ⇒ realtime）·写了的照原样 */
export function withLatencyMode<C extends { latencyMode?: 'quality' | 'realtime' }>(cfg: C, mode: 'realtime' | undefined): C {
  return mode && cfg.latencyMode === undefined ? { ...cfg, latencyMode: mode } : cfg
}
/** 编码器送一帧／收尾最多等多久（超过＝编码器挂住·报错收场·⛔ 一直等） */
export const ENCODER_STALL_MS = 20000
export const ENCODER_FINALIZE_MS = 60000
/** 等一个可能永远不回的编码步骤：到时限 ⇒ 抛 code='encoder_stalled'；signal 取消 ⇒ 当场抛 AbortError（⛔ 等那步回来才认取消） */
export function guardStep<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((res, rej) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const abort = () => { done(); rej(Object.assign(new Error('canceled'), { name: 'AbortError' })) }
    if (signal?.aborted) { abort(); return }
    timer = setTimeout(() => { done(); rej(Object.assign(new Error('encoder stalled'), { code: 'encoder_stalled' })) }, ms)
    signal?.addEventListener('abort', abort, { once: true })
    p.then((v) => { done(); res(v) }, (e) => { done(); rej(e) })
  })
}
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((res) => {
    const timer = setTimeout(() => res(fallback), ms)
    p.then((v) => { clearTimeout(timer); res(v) }, () => { clearTimeout(timer); res(fallback) })
  })
}

/**（Chrome 汇出报 VideoFrame tainted）：云盘等外站图要按跨站方式载（crossOrigin=anonymous），否则画布被污染、出不了影格；
 * 本机的 blob:／data: 不用。 */
export function imageNeedsCors(src: string): boolean {
  return !/^(blob|data):/i.test(src.trim())
}

/** 防部分浏览器汇出开头 0–5 秒整段静音：混音时没进来的素材里，哪些要挡下这次汇出（⛔ 静音汇出）——
 * 音频素材：取不到／解不开／缺素材都挡；影片：取不到／缺素材挡，解不开不挡（多半是没有声轨的影片·那段本来就没声音）。
 * 回每份要挡的素材名与它在成品里出声的时段（成品秒数·已扣掉 from）·没有 ⇒ 空阵列。 */
export type AudioBlocker = { mediaId: string; name: string; why: 'missing' | 'fetch' | 'decode'; spans: Array<[number, number]> }
export function audioBlockers(
  failed: ReadonlyArray<{ mediaId: string; why: 'missing' | 'fetch' | 'decode' }>,
  plan: { start: number; segs: ReadonlyArray<{ mediaId: string; at: number; length: number }> },
  media: (id: string) => { kind: string; name: string } | undefined,
  from = plan.start,
): AudioBlocker[] {
  const out: AudioBlocker[] = []
  for (const f of failed) {
    const m = media(f.mediaId)
    const kind = m?.kind ?? 'audio'
    if (kind === 'image') continue
    if (kind === 'video' && f.why === 'decode') continue
    const spans = plan.segs.filter((s) => s.mediaId === f.mediaId).map((s): [number, number] => {
      const a = plan.start + s.at - from
      return [Math.max(0, a), Math.max(0, a + s.length)]
    }).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
    if (spans.length) out.push({ mediaId: f.mediaId, name: m?.name ?? f.mediaId, why: f.why, spans })
  }
  return out
}
/** 挡下时那句白话里的素材清单：「名字」（0:00–0:05、0:12–0:15）·多份用顿号接 */
export function audioBlockerList(bs: ReadonlyArray<AudioBlocker>): string {
  const mmss = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
  return bs.map((b) => `「${b.name}」（${b.spans.slice(0, 3).map(([a, z]) => `${mmss(a)}–${mmss(z)}`).join('、')}${b.spans.length > 3 ? '…' : ''}）`).join('、')
}

/** （Mac Chrome 汇出 1e675943·ov_tw 6 段抠绿浮层整段没进成片也没报错·同 59727928 快取跨源根因）：
 * 成片里要画的影片／图片各在成品第几秒被用到（照 framePlan 同一套判法逐格取样·另在每段开头补一点免得短于取样间隔的漏掉）。
 * 回 mediaId ⇒ 成品秒数时段（已扣 range.from·相邻取样并成一段）。汇出前逐份打开·打不开 ⇒ visualBlockers 挡下。 */
export const VISUAL_SAMPLE_STEP = 0.25
export function visualUses(tr: Tracks, range: ExportRange, kindOf: (mediaId: string) => MediaKindLike | undefined, step = VISUAL_SAMPLE_STEP, comps?: Comps): Map<string, Array<[number, number]>> {
  const ts = new Set<number>()
  for (let t = range.from; t < range.to; t += step) ts.add(Math.round(t * 1000) / 1000)
  for (const l of tr) for (const c of l.clips) {
    const a = c.start + 0.001
    if (a >= range.from && a < range.to) ts.add(Math.round(a * 1000) / 1000)
  }
  const times = [...ts].sort((x, y) => x - y)
  const out = new Map<string, Array<[number, number]>>()
  const add = (id: string, t: number) => {
    const a = Math.max(0, t - range.from), b = Math.min(range.to - range.from, a + step)
    const sp = out.get(id) ?? []
    const last = sp[sp.length - 1]
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b); else sp.push([a, b])
    out.set(id, sp)
  }
  // 合成段（含遮罩层、转场另一边）：往下照合成里那一刻再取（递归·同汇出那支画到的素材）
  const walk = (ops: DrawOp[], t: number, depth: number) => {
    for (const op0 of ops) for (const op of [op0, ...(op0.kind === 'media' && op0.matte ? op0.matte.ops : [])]) {
      if (op.kind !== 'media') continue
      if (op.media === 'comp') {
        const comp = comps?.[op.comp!]
        if (comp && op.source < compDuration(comp) - 1e-6 && depth < COMP_DEPTH_MAX) walk(framePlan(comp.tracks, op.source, kindOf, undefined, comps), t, depth + 1)
      } else add(op.mediaId, t)
      if (op.trans && !op.trans.head) {
        if (op.trans.otherKind === 'comp') { const oc = comps?.[op.trans.otherComp!]; if (oc && depth < COMP_DEPTH_MAX) walk(framePlan(oc.tracks, compOtherTime(op.trans.other.source, oc), kindOf, undefined, comps), t, depth + 1) }
        else add(op.trans.otherMedia, t)
      }
    }
  }
  for (const t of times) walk(framePlan(tr, t, kindOf, range.only, comps), t, 0)
  return out
}
/** 打不开的画面素材 ⇒ 要挡下的清单（同 AudioBlocker 形状·清单白话用 audioBlockerList） */
export function visualBlockers(failed: ReadonlyArray<string>, uses: ReadonlyMap<string, Array<[number, number]>>, media: (id: string) => { name: string; missing?: boolean } | undefined): AudioBlocker[] {
  const out: AudioBlocker[] = []
  for (const id of failed) {
    const spans = uses.get(id)
    if (!spans?.length) continue
    const m = media(id)
    out.push({ mediaId: id, name: m?.name ?? id, why: m?.missing ? 'missing' : 'decode', spans: spans.map(([a, b]): [number, number] => [a, b]) })
  }
  return out.sort((x, y) => x.spans[0][0] - y.spans[0][0])
}
