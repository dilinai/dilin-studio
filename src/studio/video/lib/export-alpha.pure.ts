// 剪辑汇出·透明背景（【D 剪辑：导出带透明通道的影片】）——纯半：选了「透明背景」时成片用什么容器／编码／副档名、
//   画布要不要开透明、底要不要填黑、编码器参数带 alpha:'keep'、浏览器支不支持、整片有没有透明的地方。
//   ⛔ 碰 DOM；真正的画布与编码在 video-edit/VeditExport.tsx（renderVideo／frameDrawer）。本档零 import（浏览器题直载）。
// 规矩：
//   · 不透明（照旧）：MP4（avc／vp9／hevc／av1 先能编哪个用哪个）＋AAC（退 Opus）·画布不开透明·每帧先填黑底。
//   · 透明：WebM（VP9＋透明层·mediabunny 另开一只编码器编透明层、写进 WebM 的 BlockAdditions·ffprobe 看得到 alpha_mode=1）＋Opus（WebM 只收 Opus）·
//     画布开透明·每帧先清空（⛔ 填黑）——没放素材的地方保留透明；素材自己的「背景填充」是使用者设的那一层，照画。
//   · 透明那份一律整份编完再存（WebM 收尾要回头写片长与索引·边编边传只往后写 ⇒ 不走边编边传）。

/** mediabunny 认的影片编码名（只列用得到的） */
export type ExportVideoCodec = 'avc' | 'vp9' | 'hevc' | 'av1'
export type ExportAudioCodec = 'aac' | 'opus'

export type ExportSpec = {
  alpha: boolean
  container: 'mp4' | 'webm'
  /** 副档名（不带点） */ ext: 'mp4' | 'webm'
  mime: 'video/mp4' | 'video/webm'
  /** 依序试·第一个编得了的用它 */ videoCodecs: readonly ExportVideoCodec[]
  audioCodecs: readonly ExportAudioCodec[]
  /** 编码器参数的 alpha（mediabunny VideoEncodingConfig.alpha） */ encodeAlpha: 'keep' | 'discard'
  /** 画布 getContext('2d', { alpha }) */ canvasAlpha: boolean
  /** 每帧先铺的底色（null＝清空成透明） */ backdrop: string | null
  /** 能不能边编边传（只往后写）：MP4 fragmented 可以；透明 WebM 要回头写片长与索引 ⇒ 不行 */ streamable: boolean
}

const MP4_SPEC: ExportSpec = {
  alpha: false, container: 'mp4', ext: 'mp4', mime: 'video/mp4',
  videoCodecs: ['avc', 'vp9', 'hevc', 'av1'], audioCodecs: ['aac', 'opus'],
  encodeAlpha: 'discard', canvasAlpha: false, backdrop: '#000', streamable: true,
}
const ALPHA_SPEC: ExportSpec = {
  alpha: true, container: 'webm', ext: 'webm', mime: 'video/webm',
  videoCodecs: ['vp9'], audioCodecs: ['opus'],
  encodeAlpha: 'keep', canvasAlpha: true, backdrop: null, streamable: false,
}
/** 选了透明背景 ⇒ WebM（VP9 透明）＋Opus；没选 ⇒ 照旧 MP4 */
export const exportSpec = (alpha: boolean): ExportSpec => (alpha ? ALPHA_SPEC : MP4_SPEC)

/** 每帧先铺底（frameDrawer 每帧开头、转场另一段的暂存画布都用它）：不透明 ⇒ 填黑；透明 ⇒ 清空（⛔ 填色） */
export function paintBackdrop(c: { fillStyle: unknown; fillRect(x: number, y: number, w: number, h: number): void; clearRect(x: number, y: number, w: number, h: number): void }, spec: ExportSpec, w: number, h: number): void {
  if (spec.backdrop) { c.fillStyle = spec.backdrop; c.fillRect(0, 0, w, h) } else c.clearRect(0, 0, w, h)
}

/** CanvasSource 的编码参数（同 renderVideo 那份）：透明 ⇒ alpha:'keep'；WebKit 另带 latencyMode（见 export.pure exportLatencyMode） */
export function videoSourceConfig<C extends string, Q>(spec: ExportSpec, codec: C, quality: Q, latencyMode?: 'realtime'): { codec: C; quality: Q; keyFrameInterval: number; alpha: 'keep' | 'discard'; latencyMode?: 'realtime' } {
  return { codec, quality, keyFrameInterval: 2, alpha: spec.encodeAlpha, ...(latencyMode ? { latencyMode } : {}) }
}

/** 建容器（mb＝import('mediabunny')·只用到这两个类）：MP4 边编边传 ⇒ fragmented、否则 moov 在前；
 *  WebM 照常写（收尾回头补片长与索引）·万一被要求边编边传 ⇒ appendOnly（没片长·拖动较慢·但不坏档） */
export function makeOutputFormat<M, W>(mb: { Mp4OutputFormat: new (o: { fastStart: 'fragmented' | 'in-memory' }) => M; WebMOutputFormat: new (o: { appendOnly?: boolean }) => W }, spec: ExportSpec, streaming: boolean): M | W {
  return spec.container === 'webm' ? new mb.WebMOutputFormat(streaming ? { appendOnly: true } : {}) : new mb.Mp4OutputFormat({ fastStart: streaming ? 'fragmented' : 'in-memory' })
}

/** 这个浏览器能不能出透明影片：要有 WebCodecs（VideoEncoder／VideoFrame）、Worker（mediabunny 拆透明层在 Worker 里做）、能编 VP9。
 *  canVp9＝mediabunny canEncodeVideo('vp9', …)（调用方问·问不到当不行） */
export type AlphaSupport = 'ok' | 'no_webcodecs' | 'no_worker' | 'no_vp9'
export function alphaSupportOf(o: { webcodecs: boolean; worker: boolean; canVp9: boolean }): AlphaSupport {
  if (!o.webcodecs) return 'no_webcodecs'
  if (!o.worker) return 'no_worker'
  return o.canVp9 ? 'ok' : 'no_vp9'
}
/** 汇出框「透明背景」给不给选：这台导出 ⇒ 这台浏览器要支持（还在问 ⇒ 先不给）；别台导出 ⇒ 给（那台的导出页自己核·编不了回白话失败） */
export const alphaGate = (here: boolean, support: AlphaSupport | null): boolean => (here ? support === 'ok' : true)
/** 问浏览器（mb＝import('mediabunny')）：会出错的一律当不支持 */
export async function probeAlphaSupport(mb: { canEncodeVideo: (c: 'vp9', o: { width: number; height: number; frameRate?: number; alpha: 'keep' }) => Promise<boolean> }, w: number, h: number, fps?: number): Promise<AlphaSupport> {
  const webcodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  const worker = typeof Worker !== 'undefined'
  let canVp9 = false
  if (webcodecs && worker) { try { canVp9 = await mb.canEncodeVideo('vp9', { width: w, height: h, ...(fps ? { frameRate: fps } : {}), alpha: 'keep' }) } catch { canVp9 = false } }
  return alphaSupportOf({ webcodecs, worker, canVp9 })
}

// ── 整片有没有透明的地方（选了透明却每格都被素材盖满 ⇒ 提示「这片没有透明区域」）──
/** 透明度低于这个（0–255）才算「透明的地方」（边缘反锯齿那一两像素不算） */
export const ALPHA_SEEN_BELOW = 250
/** 每隔几帧抽一帧看（头一帧、最后一帧一定看） */
export const ALPHA_SAMPLE_EVERY = 15
export const alphaSampleFrame = (i: number, total: number, every = ALPHA_SAMPLE_EVERY): boolean => i === 0 || i === total - 1 || i % every === 0
/** 一帧的 RGBA 像素里有没有透明的地方（隔 stride 个像素看一个·透明区域一般成片·不必逐点） */
export function hasTransparentPixel(rgba: ArrayLike<number>, stride = 2, below = ALPHA_SEEN_BELOW): boolean {
  const step = Math.max(1, Math.floor(stride)) * 4
  for (let i = 3; i < rgba.length; i += step) if (rgba[i] < below) return true
  return false
}
/** 抽看过的帧一帧都没有透明 ⇒ 这片没有透明区域（一帧都没看 ⇒ 不下结论） */
export const noTransparentArea = (seen: { sampled: number; transparent: number }): boolean => seen.sampled > 0 && seen.transparent === 0
