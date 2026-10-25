// 网页剪辑·成片渲染核心（浏览器里逐帧画、mediabunny＝WebCodecs 编码）：
// · 画面：每一帧照 lib/export.pure.ts framePlan 由下往上画——影片（逐帧解码·原档优先·解不开退预览档）、图片、画面属性、特效与转场（离屏 WebGL2）、
//   滤镜、文字（text-draw）、贴纸、程序片段（看不见的沙盒 iframe·canvas 变成 ImageBitmap 传回来）；比例＝播放器比例（放不满补黑边）。
// · 声音：照 mix.ts mixSubClip 混（OfflineAudioContext 48kHz）·编 AAC（浏览器没有 ⇒ @mediabunny/aac-encoder；再不行退 Opus；都没有 ⇒ 无声并明说）。
// · 写去哪：缺 sink ⇒ 整份留在记忆体回 blob；给 sink ⇒ 边编边写进它（登入版「边编边传」用·sink 由调用方造）。
import { EXPORT_FPS, EXPORT_FPS_OPTS, EXPORT_RES, EXPORT_SAMPLE_RATE, blendOp, resLabel, selectionRange, type ExportFps, containRect, exportNameDefault, exportNameFrom, exportProgress, exportSize, frameCount, frameTime, framePlan, otherTime, withCaptureBridge, withTimeout, guardStep, exportLatencyMode, ENCODER_STALL_MS, ENCODER_FINALIZE_MS, imageNeedsCors, SOURCE_READ_MS, IMAGE_LOAD_MS, audioBlockers, audioBlockerList, visualUses, visualBlockers, type DrawOp, type ExportRange, type ExportRes } from '../lib/export.pure'
import { adjActive, bgBlurPx, clipAnimPose, cornerPx, cropBox, frameIn, lookGrade, lookOf, lookXform, masksSvg, shadowPx, borderRing, paintFramed, glowPx } from '../lib/clip-look.pure'
import { drawMatteOps } from './matte-draw' // 轨道遮罩（同预览那支）
import { pinMatrix, warpPixels, type Mat3 } from '../lib/corner-pin.pure' // 四角透视
import { followAffine, followAt } from '../lib/motion-track.pure' // 运动跟踪：跟随（同预览 followCssMatrix 那份）
import { applyGradeLut, bakeGradeLut, gradeActive } from '../lib/grade.pure' // 调色抠像
import { adjustPixels } from '../lib/adjust-px.pure'
import { fxById, type FxPass } from '../lib/fx.pure'
import { FX_COPY_FRAG, FX_SAMPLERS, FX_SCALE_FRAG, FX_VERT, fxFragment, needsRel } from '../lib/fx-gl.pure'
import { applyFilter } from '../lib/filters.data'
import { mblurActive, drawDirSamples, mblurDirSamples, mblurKeep, mblurModeOf, mblurPlan, mblurSize, type Ctx2DLite } from '../lib/motion-blur.pure' // 运动模糊＋方向性快门模糊
import { mosaicsAt } from '../lib/mosaic.pure' // 追踪打码
import { drawMosaics } from '../lib/mosaic-draw'
import { drawTextBody } from '../lib/text-draw'
import { webFontsIn } from '../lib/text-style.pure' // 站上字体
import { ensureFontLoaded } from '../../shared/fonts/load'
import { fontStack } from '../../shared/fonts/catalog'
import { allClips } from '../lib/timeline.pure'
import { quietSource } from '../lib/store.pure' // 读档器后台预读出错不漏成未处理拒绝（这一份读不动 ⇒ 换下一份）

/** 汇出前把文字用到的站上字体载好（切片字体只拉这几段字用到的那几片）·最多等 FONT_WAIT_MS·等不到就照退回字体画 */
const FONT_WAIT_MS = 10_000
export async function loadTextFonts(tracks: Tracks): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const texts = allClips(tracks).filter((c) => c.text).map((c) => c.text!)
  const jobs: Promise<unknown>[] = []
  for (const id of webFontsIn(texts)) {
    ensureFontLoaded(id)
    const stack = fontStack(id)!
    const sample = texts.filter((b) => b.font === id).map((b) => b.content).join('').slice(0, 2000) || 'A'
    for (const w of [400, 700]) jobs.push(document.fonts.load(`${w} 40px ${stack}`, sample).catch(() => null))
  }
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, FONT_WAIT_MS))])
}
import { drawVectorClip } from '../lib/shape.pure'
import { stickerBox, stickerById, stickerPose, stickerSrc } from '../lib/sticker.pure'
import { subClipPlan } from '../lib/group.pure'
import { effectiveParams, withBridge, type ProgramBundle } from '../lib/program.pure'
import type { MediaKindLike, Tracks } from '../lib/timeline.pure'
import { mixSubClip } from './mix'
import { encodeWav } from '../lib/wav'
import { tracksToSrt } from '../lib/clip-ops.pure'
import { alphaGate, alphaSampleFrame, exportSpec, hasTransparentPixel, makeOutputFormat, noTransparentArea, paintBackdrop, probeAlphaSupport, videoSourceConfig, type AlphaSupport, type ExportVideoCodec } from '../lib/export-alpha.pure' // 透明背景
import { exportUrls } from '../lib/cloud-proxy.pure' // 出片读原档

type MB = typeof import('mediabunny')
type VideoSample = import('mediabunny').VideoSample
type VideoSampleSink = import('mediabunny').VideoSampleSink
type Input = import('mediabunny').Input

/** 页面给的素材资料：url＝现在播放用的那份（预览档／原档暂时链接／云盘链接）；originalOf＝本机储存里的原档（没有 ⇒ null） */
export type ExportMedia = { id: string; kind: MediaKindLike; url: string; duration: number; missing?: boolean; /** 挡下汇出时那句白话里叫它什么 */ name?: string
  /** url 是剪辑用小档（proxied）时·remote＝云盘原档链接（本机储存没原档 ⇒ 出片读它·⛔ 拿小档出片） */ proxied?: boolean; remote?: string }
export type ExportEnv = {
  tracks: Tracks
  mediaOf: (id: string) => ExportMedia | null
  originalOf: (id: string) => Promise<Blob | null>
  programOf: (pkg: string) => ProgramBundle | null
}
/**（审 R5）边编边传：upload＝startStreamUpload 那只（它失败不打断渲染·写不进去就不再喂它）；keepLocal＝另留整档在本机（下载／再按一次存雲盤用） */
/** 边编边写的去处：writable 收 mediabunny StreamTarget 的写入；commit 回成片（keepLocal 的那份）；drop＝放弃 */
export type RenderSink = { writable: WritableStream<{ type: 'write'; data: Uint8Array<ArrayBuffer>; position: number }>; commit(mime?: string): Blob; drop(): void }
/** alpha＝透明背景：出 WebM（VP9 透明＋Opus）·没放素材的地方保留透明（见 _lib/export-alpha.pure） */
export type RenderOpts = { range: ExportRange; w: number; h: number; fps?: number; signal?: AbortSignal; onProgress?: (p: number, info: { frame: number; total: number; phase: 'audio' | 'frames' | 'done' }) => void; sink?: RenderSink; alpha?: boolean }
/** audioLost＝时间轴上有声音但这个浏览器没有声音编码器（成片无声）；边编边传且 keepLocal=false ⇒ blob 是空的；
 *  noAlphaArea＝选了透明但抽看的每一帧都被素材盖满（这片没有透明区域）；mime／ext＝成片格式（MP4 或透明 WebM） */
export type RenderResult = { blob: Blob; audio: boolean; audioLost: boolean; skipped: number; noAlphaArea?: boolean; mime: string; ext: string }

const abortErr = () => Object.assign(new Error('canceled'), { name: 'AbortError' })
const FX_MAX_SIDE = 1920
const mkCanvas = (w = 1, h = 1) => Object.assign(document.createElement('canvas'), { width: w, height: h })

/** 浏览器能不能在网页里编影片（WebCodecs） */
export const canExportVideo = () => typeof window !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
/** 浏览器能不能出透明 WebM（WebCodecs＋Worker＋VP9 编得了这个大小）·问不到当不行 */
export async function alphaExportSupport(w: number, h: number, fps?: number): Promise<AlphaSupport> {
  try { return await probeAlphaSupport(await import('mediabunny'), w, h, fps) } catch { return 'no_vp9' }
}

// ── 影片逐帧取（一段一只游标·时间往前走就接着解·往回跳或跳很远才重开）──
class FrameCursor {
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null
  private cur: VideoSample | null = null
  private ended = false
  constructor(private sink: VideoSampleSink) {}
  private async reset(ts: number) {
    try { await this.iter?.return() } catch { /* 已关 */ }
    this.cur?.close(); this.cur = null; this.ended = false
    this.iter = this.sink.samples(Math.max(0, ts))
  }
  async at(ts: number): Promise<VideoSample | null> {
    if (!this.iter || (this.cur && (ts < this.cur.timestamp - 1e-4 || ts > this.cur.timestamp + 3))) await this.reset(ts)
    for (;;) {
      if (this.cur && ts < this.cur.timestamp + Math.max(this.cur.duration, 1e-3) - 1e-6) return this.cur
      if (this.ended) return this.cur
      const n = await this.iter!.next()
      if (n.done) { this.ended = true; return this.cur }
      this.cur?.close()
      this.cur = n.value
    }
  }
  async close() { try { await this.iter?.return() } catch { /* 已关 */ } this.cur?.close(); this.cur = null; this.iter = null }
}

// ── 特效／转场／滤镜（同预览 VeditFxCanvas／VeditFilterCanvas 那几支着色器·一条轨一份离屏 WebGL2）──
class LaneGl {
  readonly canvas = mkCanvas()
  private gl: WebGL2RenderingContext
  private vbo: WebGLBuffer | null
  private progs = new Map<string, WebGLProgram | null>()
  private copyProg: WebGLProgram | null
  private scaleProg: WebGLProgram | null
  /** 转场另一段套它自己的特效／缩放用 */
  private opp: WebGLTexture[]
  private ring: WebGLTexture[]
  private head = 0
  private filled = 0
  private lastKey = ''
  private otherTex: WebGLTexture
  private pp: WebGLTexture[]
  private fbo: WebGLFramebuffer | null
  private ppW = 0
  private ppH = 0
  static create(): LaneGl | null {
    try { const g = new LaneGl(); return g } catch { return null }
  }
  private constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('no-webgl2')
    this.gl = gl
    this.vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.copyProg = this.compile(FX_COPY_FRAG)
    this.scaleProg = this.compile(FX_SCALE_FRAG)
    this.ring = [this.mkTex(), this.mkTex(), this.mkTex(), this.mkTex(), this.mkTex()]
    this.otherTex = this.mkTex()
    this.pp = [this.mkTex(), this.mkTex()]
    this.opp = [this.mkTex(), this.mkTex()]
    this.fbo = gl.createFramebuffer()
  }
  private mkTex() {
    const g = this.gl, tx = g.createTexture()!
    g.bindTexture(g.TEXTURE_2D, tx)
    for (const [k, v] of [[g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE], [g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR]] as const) g.texParameteri(g.TEXTURE_2D, k, v)
    return tx
  }
  private compile(frag: string): WebGLProgram | null {
    const g = this.gl
    const sh = (type: number, src: string) => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { g.deleteShader(s); return null } return s }
    const v = sh(g.VERTEX_SHADER, FX_VERT), f = sh(g.FRAGMENT_SHADER, frag)
    if (!v || !f) return null
    const p = g.createProgram()!
    g.attachShader(p, v); g.attachShader(p, f); g.bindAttribLocation(p, 0, 'in_pos'); g.linkProgram(p)
    return g.getProgramParameter(p, g.LINK_STATUS) ? p : null
  }
  private progOf(id: string) {
    if (!this.progs.has(id)) { const it = fxById(id); this.progs.set(id, it ? this.compile(fxFragment(it)) : null) }
    return this.progs.get(id) ?? null
  }
  private draw(prog: WebGLProgram, out: WebGLTexture | null, w: number, h: number, tex: Record<string, WebGLTexture>, uni: Record<string, number | [number, number]>) {
    const g = this.gl
    g.useProgram(prog)
    if (out) { g.bindFramebuffer(g.FRAMEBUFFER, this.fbo); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, out, 0) } else g.bindFramebuffer(g.FRAMEBUFFER, null)
    g.viewport(0, 0, w, h)
    FX_SAMPLERS.forEach((n, i) => {
      const loc = g.getUniformLocation(prog, n)
      if (!loc) return
      g.activeTexture(g.TEXTURE0 + i); g.bindTexture(g.TEXTURE_2D, tex[n] ?? tex.tTex); g.uniform1i(loc, i)
    })
    for (const [k, v] of Object.entries(uni)) {
      const loc = g.getUniformLocation(prog, k)
      if (!loc) continue
      if (Array.isArray(v)) g.uniform2f(loc, v[0], v[1]); else g.uniform1f(loc, v)
    }
    g.bindBuffer(g.ARRAY_BUFFER, this.vbo); g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
  }
  /** 套一帧：src＝原片这一帧（w×h）·srcKey 变了才进残影轮盘；回画好的画布（画不出 ⇒ null·照原片画） */
  run(src: TexImageSource, w: number, h: number, srcKey: string, effects: readonly FxPass[],
    trans: { tr: string; progress: number; live: 'from' | 'to'; other: TexImageSource | null; otherFx?: readonly FxPass[]; rel?: readonly [number, number] } | null,
    filter: { params: import('../lib/filters.data').FilterParams; strength: number; seed: number } | null, t: number): HTMLCanvasElement | null {
    const g = this.gl
    try {
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
      if (this.ppW !== w || this.ppH !== h) {
        for (const tx of [...this.pp, ...this.opp]) { g.bindTexture(g.TEXTURE_2D, tx); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null) }
        this.ppW = w; this.ppH = h
      }
      if (srcKey !== this.lastKey) {
        this.head = (this.head + 1) % this.ring.length
        this.filled = Math.min(this.ring.length, this.filled + 1)
        g.bindTexture(g.TEXTURE_2D, this.ring[this.head])
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src)
        this.lastKey = srcKey
      }
      const prevTex = (k: number) => this.ring[(this.head - Math.min(k, this.filled - 1) + this.ring.length * 2) % this.ring.length]
      let cur: WebGLTexture = this.ring[this.head]
      let side = 0
      const base = { ratio: w / h, res: [w, h] as [number, number], seed: 1 }
      for (const e of effects) {
        const it = fxById(e.fx)
        const prog = it ? this.progOf(e.fx) : null
        if (!it || !prog) continue
        const out = this.pp[side]
        this.draw(prog, out, w, h, { tTex: cur, tFrom: cur, tTo: cur, tP1: prevTex(1), tP2: prevTex(2), tP3: prevTex(3), tP4: prevTex(4) }, { ...it.params, ...base, progress: e.progress, amount: e.amount, time: e.time })
        cur = out; side ^= 1
      }
      if (trans?.other) {
        const it = fxById(trans.tr)
        const prog = it ? this.progOf(trans.tr) : null
        if (it && prog) {
          g.bindTexture(g.TEXTURE_2D, this.otherTex)
          g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
          g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, trans.other)
          // 另一段也套它自己身上的特效、照它自己的缩放放进来（同预览 VeditFxCanvas）
          let oTex: WebGLTexture = this.otherTex, oSide = 0
          for (const e of trans.otherFx ?? []) {
            const ei = fxById(e.fx), ep = ei ? this.progOf(e.fx) : null
            if (!ei || !ep) continue
            this.draw(ep, this.opp[oSide], w, h, { tTex: oTex, tFrom: oTex, tTo: oTex, tP1: oTex, tP2: oTex, tP3: oTex, tP4: oTex }, { ...ei.params, ...base, progress: e.progress, amount: e.amount, time: e.time })
            oTex = this.opp[oSide]; oSide ^= 1
          }
          if (this.scaleProg && needsRel(trans.rel)) { this.draw(this.scaleProg, this.opp[oSide], w, h, { tTex: oTex }, { rel: [trans.rel[0], trans.rel[1]] }); oTex = this.opp[oSide]; oSide ^= 1 }
          const out = this.pp[side]
          const from = trans.live === 'from' ? cur : oTex, to = trans.live === 'to' ? cur : oTex
          this.draw(prog, out, w, h, { tFrom: from, tTo: to, tTex: cur }, { ...it.params, ...base, progress: trans.progress, amount: 1, time: t })
          cur = out; side ^= 1
        }
      }
      if (filter) {
        // 滤镜读中间结果（第 0 行＝画面顶·同直接上传的元素）·画到画布本身（applyFilter 自己处理上下）
        g.bindFramebuffer(g.FRAMEBUFFER, null)
        g.viewport(0, 0, w, h)
        applyFilter(g, cur, filter.params, filter.strength, { seed: filter.seed })
      } else {
        if (!this.copyProg) throw new Error('copy')
        this.draw(this.copyProg, null, w, h, { tTex: cur }, {})
      }
      if (g.getError() !== g.NO_ERROR) throw new Error('gl')
      return this.canvas
    } catch { return null }
  }
  dispose() { try { this.gl.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* 已失效 */ } }
}

// ── 程序片段（看不见的沙盒 iframe·同预览 VeditProgramFrame 只给 allow-scripts·另插回传桥）──
class ProgramHost {
  private frame: HTMLIFrameElement
  private ready: Promise<boolean>
  private seq = 0
  private waits = new Map<number, (b: ImageBitmap | null) => void>()
  private onMsg: (e: MessageEvent) => void
  constructor(html: string, w: number, h: number) {
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts')
    f.setAttribute('aria-hidden', 'true')
    f.style.cssText = `position:fixed;left:-${w + 100}px;top:0;width:${w}px;height:${h}px;border:0;pointer-events:none;opacity:0`
    let readyRes: (v: boolean) => void = () => {}
    this.ready = new Promise<boolean>((r) => { readyRes = r; setTimeout(() => r(false), 8000) })
    this.onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow) return
      const d = e.data as { type?: string; seq?: number; bitmap?: ImageBitmap | null } | null
      if (d?.type === 'dilin-program-ready') readyRes(true)
      if (d?.type === 'dilin-program-frame' && typeof d.seq === 'number') { const w0 = this.waits.get(d.seq); if (w0) { this.waits.delete(d.seq); w0(d.bitmap ?? null) } else d.bitmap?.close() }
    }
    window.addEventListener('message', this.onMsg)
    f.srcdoc = withBridge(withCaptureBridge(html))
    document.body.appendChild(f)
    this.frame = f
  }
  async capture(t: number, params: Record<string, unknown>, size: { w: number; h: number }): Promise<ImageBitmap | null> {
    if (!(await this.ready) || !this.frame.contentWindow) return null
    const seq = ++this.seq
    return new Promise<ImageBitmap | null>((res) => {
      const timer = setTimeout(() => { this.waits.delete(seq); res(null) }, 4000)
      this.waits.set(seq, (b) => { clearTimeout(timer); res(b) })
      this.frame.contentWindow!.postMessage({ type: 'dilin-program-capture', seq, t, params, size }, '*')
    })
  }
  dispose() { window.removeEventListener('message', this.onMsg); for (const w of this.waits.values()) w(null); this.waits.clear(); this.frame.remove() }
}

// Safari 有时 onload／onerror 都不来 ⇒ 等满 IMAGE_LOAD_MS 当载不到（调用方换下一份来源）
const loadImageOnce = (src: string, cors: boolean) => withTimeout(new Promise<HTMLImageElement | null>((res) => {
  const im = new Image()
  im.decoding = 'async'
  if (cors) im.crossOrigin = 'anonymous' // 云盘图不带这个 ⇒ 画布被污染·new VideoFrame 抛 tainted
  im.onload = () => res(im)
  im.onerror = () => res(null)
  im.src = src
}), IMAGE_LOAD_MS, null)
/** 外站图跨站载；载不到（例：浏览器拿了先前预览时没带许可头的快取）⇒ 不走快取另抓一份成 blob 再载 */
const loadImage = async (src: string): Promise<HTMLImageElement | null> => {
  if (!imageNeedsCors(src)) return loadImageOnce(src, false)
  const im = await loadImageOnce(src, true)
  if (im) return im
  const blob = await withTimeout(fetch(src, { mode: 'cors', cache: 'no-store' }).then((r) => (r.ok ? r.blob() : null)), IMAGE_LOAD_MS, null)
  if (!blob) return null
  const u = URL.createObjectURL(blob)
  try { return await loadImageOnce(u, false) } finally { URL.revokeObjectURL(u) }
}
/** 本机储存里的原档（Safari 读 OPFS 偶尔不回 ⇒ 等满 SOURCE_READ_MS 当没有·改用云盘那份） */
const readOriginal = (env: ExportEnv, id: string) => withTimeout(env.originalOf(id), SOURCE_READ_MS, null)

/** 混音要用的素材都取到、解开了才往下算；音频读不到／解不开 ⇒ 抛 code 'audio_unreadable'（list＝白话清单）·⛔ 静音汇出 */
async function mixForExport(env: ExportEnv, plan: NonNullable<ReturnType<typeof subClipPlan>>, from: number, seconds: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const mixed = await mixSubClip(plan, (id) => { const m = env.mediaOf(id); return m && !m.missing && m.url ? m.url : null }, { sampleRate: EXPORT_SAMPLE_RATE, from, seconds, signal })
  const bs = audioBlockers(mixed.failed, plan, (id) => { const m = env.mediaOf(id); return m ? { kind: m.kind, name: m.name ?? id } : undefined }, from)
  if (bs.length) throw Object.assign(new Error(audioBlockerList(bs)), { code: 'audio_unreadable', list: audioBlockerList(bs) })
  return mixed.buffer
}

/** 成片要画到的影片／图片逐份打开（同 frameDrawer 开档那条·开过的照用）；打不开 ⇒ 抛 code 'video_unreadable'（list＝白话清单） */
async function preflightVisual(env: ExportEnv, fd: Awaited<ReturnType<typeof frameDrawer>>, range: ExportRange): Promise<void> {
  const kindOf = (id: string) => env.mediaOf(id)?.kind
  const uses = visualUses(env.tracks, range, kindOf)
  const failed: string[] = []
  await Promise.all([...uses.keys()].map(async (id) => { if (!(await fd.probe(id))) failed.push(id) }))
  const bs = visualBlockers(failed, uses, (id) => { const m = env.mediaOf(id); return m ? { name: m.name ?? id, missing: m.missing } : undefined })
  if (bs.length) throw Object.assign(new Error(audioBlockerList(bs)), { code: 'video_unreadable', list: audioBlockerList(bs) })
}

/** 把时间轴 range 那一段画成 MP4（画面＋声音）；signal 取消 ⇒ 抛 AbortError */
export async function renderVideo(env: ExportEnv, opts: RenderOpts): Promise<RenderResult> {
  const { range, w: W, h: H } = opts
  const fps = opts.fps ?? EXPORT_FPS
  const signal = opts.signal
  const check = () => { if (signal?.aborted) throw abortErr() }
  const mb: MB = await import('mediabunny')
  const kindOf = (id: string) => env.mediaOf(id)?.kind
  const total = frameCount(range, fps)
  const seconds = total / fps
  const report = (phase: 'audio' | 'frames' | 'done', frame = 0) => opts.onProgress?.(exportProgress(phase, frame, total), { frame, total, phase })

  // ① 声音：同合成子素材的混音（只算画得到的那几段·range.only）
  report('audio')
  const ids = range.only ? [...range.only] : env.tracks.flatMap((l) => l.clips.map((c) => c.id))
  const plan = subClipPlan(env.tracks, ids, kindOf)
  let audioBuf: AudioBuffer | null = null
  if (plan && plan.segs.length) {
    audioBuf = await mixForExport(env, plan, range.from, seconds, signal)
  }
  check()

  // ② 编码器
  // 透明背景 ⇒ WebM（VP9 透明＋Opus）·画布开透明·不填黑底（spec 见 _lib/export-alpha.pure）
  const spec = exportSpec(!!opts.alpha)
  const fd = await frameDrawer(env, W, H, { alpha: spec.alpha })
  // （ov_tw 6 段抠绿浮层整段没进成片也没报错）：画面素材也比照声音——这次要画到的影片／图片先逐份打开，打不开就挡下并点名哪段·⛔ 漏掉照汇
  try { await preflightVisual(env, fd, range) } catch (e) { await fd.dispose(); throw e }
  check()
  const canvas = fd.canvas
  //（审 R5）边编边传 ⇒ fragmented（只往后写·写出去的片不会回头改）；只下载 ⇒ 照旧 in-memory（moov 在前）；透明 ⇒ WebM
  const format = makeOutputFormat(mb, spec, !!opts.sink)
  const vcodec = await mb.getFirstEncodableVideoCodec(format.getSupportedVideoCodecs().filter((c): c is ExportVideoCodec => (spec.videoCodecs as readonly string[]).includes(c)).sort((a, b) => spec.videoCodecs.indexOf(a) - spec.videoCodecs.indexOf(b)), { width: W, height: H, frameRate: fps })
  if (!vcodec) { await fd.dispose(); throw Object.assign(new Error('no video encoder'), { code: spec.alpha ? 'alpha_unsupported' : 'unsupported' }) }
  if (audioBuf && spec.audioCodecs.includes('aac')) await ensureAacEncoder(mb)
  const acodec = audioBuf ? await mb.getFirstEncodableAudioCodec([...spec.audioCodecs], { numberOfChannels: 2, sampleRate: EXPORT_SAMPLE_RATE }) : null
  // 边编边传：每笔写入同时进本机整档（keepLocal）与上传器；上传器抛（它自己已失败／取消）⇒ 之后不再喂它·渲染照跑（_lib/vedit-export-tee）
  const tee = opts.sink ?? null
  const buffered = tee ? null : new mb.BufferTarget()
  const target = buffered ?? new mb.StreamTarget(tee!.writable)
  const output = new mb.Output({ format, target })
  // Safari 的 H.264 默认模式吃 4 帧就挂 ⇒ WebKit 改低延迟模式（exportLatencyMode）
  const latencyMode = exportLatencyMode(typeof navigator !== 'undefined' ? navigator.userAgent : '')
  const vsrc = new mb.CanvasSource(canvas, videoSourceConfig(spec, vcodec, mb.QUALITY_HIGH, latencyMode))
  output.addVideoTrack(vsrc, { frameRate: fps, ...(spec.alpha ? { canBeTransparent: true } : {}) })
  // 透明：抽几帧看有没有透明的地方（一帧都没有 ⇒ 完成时提示「这片没有透明区域」）
  const seen = { sampled: 0, transparent: 0 }
  const asrc = acodec && audioBuf ? new mb.AudioBufferSource({ codec: acodec, quality: mb.QUALITY_HIGH }) : null
  if (asrc) output.addAudioTrack(asrc)

  // 声音切成一秒一块跟着画面交错送（mp4 照时间交错写）
  const audioChunk = (i: number): AudioBuffer | null => {
    if (!audioBuf) return null
    const rate = audioBuf.sampleRate, a = Math.round(i * rate), b = Math.min(audioBuf.length, Math.round((i + 1) * rate))
    if (b <= a) return null
    const out = new AudioBuffer({ length: b - a, numberOfChannels: audioBuf.numberOfChannels, sampleRate: rate })
    for (let ch = 0; ch < audioBuf.numberOfChannels; ch++) out.copyToChannel(audioBuf.getChannelData(ch).subarray(a, b), ch)
    return out
  }

  // 编码各步加时限（挂住 ⇒ encoder_stalled 报错）·取消当场生效（⛔ 等编码器回来才认）
  const step = <T,>(p: Promise<T>, ms = ENCODER_STALL_MS) => guardStep(p, ms, signal)
  try {
    await step(output.start())
    let sentSec = 0
    const sendAudio = async (upto: number) => {
      if (!asrc) return
      while (sentSec < upto) { const ch = audioChunk(sentSec); sentSec++; if (ch) await step(asrc.add(ch)) }
    }
    for (let i = 0; i < total; i++) {
      check()
      const t = frameTime(range, i, fps)
      await fd.frame(t, range.only)
      if (spec.alpha && alphaSampleFrame(i, total)) { seen.sampled++; if (fd.transparentNow()) seen.transparent++ }
      await sendAudio(Math.ceil((i + 1) / fps) + 1)
      await step(vsrc.add(i / fps, 1 / fps))
      if (i % 3 === 0 || i === total - 1) report('frames', i + 1)
    }
    await sendAudio(Math.ceil(seconds) + 1)
    check()
    await step(output.finalize(), ENCODER_FINALIZE_MS)
    const buf = buffered ? buffered.buffer : null
    if (buffered && !buf) throw new Error('empty output')
    report('done', total)
    // 编码途中才打不开的（预检时开得了·后来那份没了）⇒ 同样挡下·⛔ 交出缺段的片
    const late = visualBlockers(fd.skippedIds(), visualUses(env.tracks, range, kindOf), (id) => { const m = env.mediaOf(id); return m ? { name: m.name ?? id, missing: m.missing } : undefined })
    if (late.length) throw Object.assign(new Error(audioBlockerList(late)), { code: 'video_unreadable', list: audioBlockerList(late) })
    // 核过了才送最后一片＋complete（⛔ 缺段的片先进了云盘）
    const blob = buf ? new Blob([buf], { type: spec.mime }) : tee!.commit(spec.mime)
    return { blob, audio: !!asrc, audioLost: !!audioBuf && !asrc, skipped: fd.skipped(), mime: spec.mime, ext: spec.ext, ...(spec.alpha ? { noAlphaArea: noTransparentArea(seen) } : {}) }
  } catch (e) {
    // 挂住的编码器 cancel 自己也可能不回 ⇒ 最多等 3 秒（cancel 会关掉编码器）
    if (output.state !== 'finalized' && output.state !== 'canceled') await withTimeout(output.cancel().catch(() => {}), 3000, undefined)
    // 渲染失败／取消 ⇒ 这次的上传一并作废（abort 会话）、本机那份放掉
    tee?.drop()
    throw e
  } finally {
    await fd.dispose()
  }
}

/**（工作站远端导出的成片音轨是 Opus·Threads／IG／脸书只收 AAC）：Linux 的 Chrome 自带 WebCodecs 没有 AAC 编码器 ⇒
 *  自带编不了 AAC 才补装 mediabunny 官方扩展（FFmpeg AAC-LC 的 WASM·约 1MB·要用才载）；装不上照旧退 Opus。一个分页只装一次。 */
let aacEncoderReady: Promise<void> | null = null
function ensureAacEncoder(mb: MB): Promise<void> {
  aacEncoderReady ??= (async () => {
    try {
      if (await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: EXPORT_SAMPLE_RATE })) return
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
      registerAacEncoder()
    } catch (e) {
      console.warn('[vedit-export] AAC 编码扩展载不起来·退 Opus', e)
    }
  })()
  return aacEncoderReady
}

/** 一帧一帧画时间轴（汇出成片与汇出静帧共用）：frame(t, only) 把时间轴第 t 秒画进 canvas（只画 only 那几段·缺＝全部）；
 *  素材来源每份开一次·每段一只解码游标（放完的段关掉）·每条轨一份 WebGL·每条程序轨一只 iframe；用完 dispose
 *  o.alpha（透明背景）：画布开透明、每帧先清空（⛔ 填黑底）·转场另一段的黑边也改透明 */
export async function frameDrawer(env: ExportEnv, W: number, H: number, o: { alpha?: boolean } = {}) {
  await loadTextFonts(env.tracks) // 站上字体先载好·不然头几格会画成退回字体
  const mb: MB = await import('mediabunny')
  const kindOf = (id: string) => env.mediaOf(id)?.kind
  let skipped = 0
  const skippedIds = new Set<string>()
  const skip = (id: string) => { if (!skippedIds.has(id)) { skippedIds.add(id); skipped++ } }
  const spec = exportSpec(!!o.alpha)
  const canvas = mkCanvas(W, H)
  const ctx = canvas.getContext('2d', { alpha: spec.canvasAlpha })!
  /** 先铺底：不透明 ⇒ 黑；透明 ⇒ 清空 */
  const backdrop = (c: CanvasRenderingContext2D, w: number, h: number) => paintBackdrop(c, spec, w, h)
  // 素材来源（每份素材开一次）·每段一只游标·每条轨一份 WebGL·每条程序轨一只 iframe
  type VSrc = { input: Input; sink: VideoSampleSink; duration: number } | null
  const inputs: Input[] = []
  const vids = new Map<string, Promise<VSrc>>()
  const openVideo = (id: string): Promise<VSrc> => {
    let p = vids.get(id)
    if (!p) {
      p = (async () => {
        const m = env.mediaOf(id)
        if (!m || m.missing) return null
        const cands: Array<Blob | string> = []
        const orig = await readOriginal(env, id)
        if (orig) cands.push(orig)
        cands.push(...exportUrls(m)) // 小档走云盘时这台没原档 ⇒ 读云盘原档（按需分段读）·最后才退回播放那份
        for (const c of cands) {
          let input: Input | null = null
          try {
            const source = typeof c === 'string' ? (c.startsWith('blob:') || c.startsWith('data:') ? new mb.BlobSource(await (await fetch(c)).blob(), quietSource()) : new mb.UrlSource(c, { ...quietSource(), requestInit: { cache: 'reload' } })) : new mb.BlobSource(c, quietSource())
            input = new mb.Input({ source, formats: mb.ALL_FORMATS })
            const track = await input.getPrimaryVideoTrack()
            if (track && (await track.canDecode())) { inputs.push(input); return { input, sink: new mb.VideoSampleSink(track), duration: await input.computeDuration().catch(() => m.duration) } }
          } catch { /* 换下一份 */ }
          input?.dispose()
        }
        return null
      })()
      vids.set(id, p)
    }
    return p
  }
  const imgs = new Map<string, Promise<HTMLImageElement | null>>()
  const blobUrls: string[] = []
  const openImage = (id: string) => {
    let p = imgs.get(id)
    if (!p) {
      p = (async () => {
        const m = env.mediaOf(id)
        if (!m || m.missing) return null
        const orig = await readOriginal(env, id)
        if (orig) { const u = URL.createObjectURL(orig); blobUrls.push(u); const im = await loadImage(u); if (im) return im }
        return m.url ? loadImage(m.url) : null
      })()
      imgs.set(id, p)
    }
    return p
  }
  const stickerImgs = new Map<string, Promise<HTMLImageElement | null>>()
  const stickerImg = (file: string) => { let p = stickerImgs.get(file); if (!p) { p = loadImage(file); stickerImgs.set(file, p) } return p }
  const maskImgs = new Map<string, Promise<HTMLImageElement | null>>()
  const maskImg = (svg: string) => { let p = maskImgs.get(svg); if (!p) { p = loadImage(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`); maskImgs.set(svg, p) } return p }
  const cursors = new Map<string, FrameCursor>()
  const gls = new Map<string, LaneGl | null>()
  const hosts = new Map<string, ProgramHost | null>()
  const scratch = mkCanvas(), s2d = scratch.getContext('2d')!
  const otherCv = mkCanvas(), o2d = otherCv.getContext('2d')!
  const layerCv = mkCanvas(W, H), l2d = layerCv.getContext('2d', { willReadFrequently: true })! // 调节要读回像素
  const mtCv = mkCanvas(W, H), mt2d = mtCv.getContext('2d')!, mkCv = mkCanvas(W, H), mk2d = mkCv.getContext('2d', { willReadFrequently: true })! // 轨道遮罩：整层暂存＋遮罩
  // 四角透视：整层先画进 pinCv（照原本的位置／旋转）·再照 pinMatrix（同预览 pinCssMatrix 那个矩阵）逐像素投影进 pinOut·最后才带不透明度／混合贴上去
  let pinCv: ReturnType<typeof mkCanvas> | null = null, pinOut: ReturnType<typeof mkCanvas> | null = null
  const pinLayer = (H3: Mat3, draw: (c: CanvasRenderingContext2D) => void): ReturnType<typeof mkCanvas> => {
    pinCv ??= mkCanvas(W, H); pinOut ??= mkCanvas(W, H)
    const p2 = pinCv.getContext('2d', { willReadFrequently: true })! as CanvasRenderingContext2D
    p2.setTransform(1, 0, 0, 1, 0, 0); p2.globalAlpha = 1; p2.globalCompositeOperation = 'source-over'; p2.clearRect(0, 0, W, H)
    p2.save(); draw(p2); p2.restore()
    const o2 = pinOut.getContext('2d')! as CanvasRenderingContext2D
    const a = p2.getImageData(0, 0, W, H), b = o2.createImageData(W, H)
    warpPixels(a.data, b.data, W, H, H3)
    o2.putImageData(b, 0, 0)
    return pinOut
  }

  // 外发光（同预览外框 glowCss：passes 个 drop-shadow(0 0 blur color) 串起来·每一个都对「上一步的结果」发光）：
  //   每层 ＝ 只画影子（原图挪到画面外、影子挪回来）＋原图盖上去
  const fulls: Array<ReturnType<typeof mkCanvas>> = []
  const scratchFull = (i: number) => (fulls[i] ??= mkCanvas(W, H))
  const glowLayer = (src: ReturnType<typeof mkCanvas>, gp: NonNullable<ReturnType<typeof glowPx>>): ReturnType<typeof mkCanvas> => {
    let cur = src
    for (let k = 0; k < gp.passes; k++) {
      const dst = scratchFull(1 + (k % 2)), d2 = dst.getContext('2d')! as CanvasRenderingContext2D
      d2.setTransform(1, 0, 0, 1, 0, 0); d2.globalAlpha = 1; d2.globalCompositeOperation = 'source-over'; d2.clearRect(0, 0, W, H)
      d2.save(); d2.shadowColor = gp.color; d2.shadowBlur = gp.canvasBlur; d2.shadowOffsetX = W * 4; d2.shadowOffsetY = 0; d2.drawImage(cur, -W * 4, 0); d2.restore()
      d2.drawImage(cur, 0, 0)
      cur = dst
    }
    return cur
  }

  /** 一段影片在素材第 ts 秒那一帧（解不开 ⇒ null） */
  const videoFrame = async (key: string, mediaId: string, ts: number, used: Set<string>): Promise<VideoSample | null> => {
    const v = await openVideo(mediaId)
    if (!v) { skip(mediaId); return null }
    used.add(key)
    let cur = cursors.get(key)
    if (!cur) { cur = new FrameCursor(v.sink); cursors.set(key, cur) }
    return cur.at(ts)
  }

  /** 运动模糊：每段影片最近几格（没叠过的原格·时间轴时刻） */
  const mbHist = new Map<string, Array<{ t: number; cv: HTMLCanvasElement }>>()
  const mbUsed = new Set<string>()
  const drawMedia = async (op: Extract<DrawOp, { kind: 'media' }>, t: number, used: Set<string>) => {
    let src: CanvasImageSource | VideoSample | null = null
    let sw = 0, sh = 0
    if (op.media === 'video') {
      const s = await videoFrame(`c:${op.clip.id}`, op.mediaId, op.source, used)
      if (s) { src = s; sw = s.displayWidth; sh = s.displayHeight }
    } else {
      const im = await openImage(op.mediaId)
      if (im) { src = im; sw = im.naturalWidth; sh = im.naturalHeight } else skip(op.mediaId)
    }
    if (!src || !sw || !sh) return
    const lk = lookOf(op.clip, t)
    // 调色（HSL／曲线／色轮／LUT）、抠像、上面盖的调节层 ⇒ 先烤成一张 3D 查表（同预览 VeditGradeCanvas 那张）·原片像素照表改过再往下走
    const grades = [lookGrade(lk), ...op.adjust]
    if (grades.some(gradeActive)) {
      const k = Math.min(1, FX_MAX_SIDE / Math.max(sw, sh))
      const gw = Math.max(1, Math.round(sw * k)), gh = Math.max(1, Math.round(sh * k))
      const gcv = mkCanvas(gw, gh), g2d = gcv.getContext('2d', { willReadFrequently: true })!
      if (src instanceof HTMLImageElement) g2d.drawImage(src, 0, 0, gw, gh); else (src as VideoSample).draw(g2d, 0, 0, gw, gh)
      const px = g2d.getImageData(0, 0, gw, gh)
      applyGradeLut(px.data, bakeGradeLut(grades))
      g2d.putImageData(px, 0, 0)
      src = gcv; sw = gw; sh = gh
    }
    // 运动模糊（同预览 VeditMotionBlurCanvas）：这一格（调色后）先抄进这段的历史·再照 mblurPlan 跟前面几格叠成拖影·只对影片
    const mbFrames = mblurModeOf(lk.mblur, op.media) === 'frames' // 写了 mode 'dir' 的影片改走方向模糊（下面）
    if (op.media === 'video' && mblurActive(lk.mblur)) { if (mbFrames) {
      const mb = lk.mblur
      const { w: mw, h: mh } = mblurSize(sw, sh)
      const curCv = mkCanvas(mw, mh), c2 = curCv.getContext('2d')!
      if (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement) c2.drawImage(src, 0, 0, mw, mh); else (src as VideoSample).draw(c2, 0, 0, mw, mh)
      let hist = mbHist.get(op.clip.id) ?? []
      if (hist.length && (hist[0].cv.width !== mw || hist[0].cv.height !== mh)) hist = []
      const k = mblurKeep(hist.map((x) => x.t), t, mb)
      hist = k.reset ? [] : k.keep.map((i) => hist[i])
      const out = mkCanvas(mw, mh), o2 = out.getContext('2d')!
      for (const p of mblurPlan(mb, hist.map((x) => t - x.t))) { o2.globalAlpha = p.alpha; o2.drawImage(p.i < 0 ? curCv : hist[p.i].cv, 0, 0, mw, mh) }
      o2.globalAlpha = 1
      hist.push({ t, cv: curCv })
      mbHist.set(op.clip.id, hist); mbUsed.add(op.clip.id)
      src = out; sw = mw; sh = mh
    } }
    // 特效／转场／滤镜：原片像素（长边超过上限等比缩）画进暂存画布 ⇒ WebGL 套完再当这一层的画面
    if (op.effects.length || op.trans || op.filter) {
      const k = Math.min(1, FX_MAX_SIDE / Math.max(sw, sh))
      const fw = Math.max(1, Math.round(sw * k)), fh = Math.max(1, Math.round(sh * k))
      if (scratch.width !== fw || scratch.height !== fh) { scratch.width = fw; scratch.height = fh }
      s2d.clearRect(0, 0, fw, fh)
      if (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement) s2d.drawImage(src, 0, 0, fw, fh); else (src as VideoSample).draw(s2d, 0, 0, fw, fh)
      let other: HTMLCanvasElement | null = null
      if (op.trans?.head) {
        // 片头转场：另一边＝空白一格（不透明铺黑·同预览 VeditFxCanvas 的 blank other；透明汇出则留空）
        if (otherCv.width !== fw || otherCv.height !== fh) { otherCv.width = fw; otherCv.height = fh }
        backdrop(o2d, fw, fh)
        other = otherCv
      } else if (op.trans) {
        const om = env.mediaOf(op.trans.otherMedia)
        const ot = otherTime(op.trans.otherKind, op.trans.other.source, om?.duration ?? Infinity)
        const os = op.trans.otherKind === 'video' ? await videoFrame(`o:${op.trans.other.clip.id}`, op.trans.otherMedia, ot, used) : await openImage(op.trans.otherMedia)
        const ow = os ? (os instanceof HTMLImageElement ? os.naturalWidth : os.displayWidth) : 0, oh = os ? (os instanceof HTMLImageElement ? os.naturalHeight : os.displayHeight) : 0
        if (os && ow && oh) {
          if (otherCv.width !== fw || otherCv.height !== fh) { otherCv.width = fw; otherCv.height = fh }
          backdrop(o2d, fw, fh)
          const r = containRect(fw, fh, ow, oh)
          if (os instanceof HTMLImageElement) o2d.drawImage(os, r.x, r.y, r.w, r.h); else os.draw(o2d, r.x, r.y, r.w, r.h)
          other = otherCv
        }
      }
      let gl = gls.get(op.laneId)
      if (gl === undefined) { gl = LaneGl.create(); gls.set(op.laneId, gl) }
      const done = gl?.run(scratch, fw, fh, `${op.clip.id}@${op.source.toFixed(4)}`, op.effects,
        op.trans ? { tr: op.trans.tr, progress: op.trans.progress, live: op.trans.live, other, otherFx: op.trans.other.fx, rel: op.trans.other.rel } : null,
        op.filter ? { params: op.filter.params, strength: op.filter.strength, seed: op.media === 'video' ? Math.round(op.source * 30) : 0 } : null, t) ?? null
      src = done ?? scratch; sw = fw; sh = fh
    }
    // 画面属性：位置大小／旋转／不透明度／混合模式＋动画姿势（同预览 lookStyle）·蒙版（同预览 maskSvg·对着素材那块）
    // 关键帧照这一帧的时刻取值（lookOf 带 t·同预览）；调节 16 项照预览那串 SVG 滤镜逐像素算（adjustPixels）
    const xf = lookXform(lk, clipAnimPose(op.clip, t))
    if (xf.opacity <= 0) return
    const r = containRect(W, H, sw, sh)
    // 裁剪＝只画素材那块里留下的部分（位置不动）；背景填充＝这段底下先铺满整个画面（纯色或同一画面放大模糊·不跟着变形）
    const cb = cropBox({ x: r.x, y: r.y, w: r.w, h: r.h }, lk.crop)
    const draw0 = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => { if (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement) c.drawImage(src, x, y, w, h); else (src as VideoSample).draw(c, x, y, w, h) }
    // 圆角：对着留下那块（同预览 cropClipPath 的 round）
    const rad = lk.corner > 0 ? cornerPx(lk.corner, cb.w, cb.h) : 0
    // 描边：同预览 borderRing（贴着留下那块的内缘·半径同圆角）
    const ring = borderRing({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H }, lk.crop, lk.corner, lk.border, W / H)
    const put = (c: CanvasRenderingContext2D) => paintFramed(c, (x, y, w, h) => draw0(c, x, y, w, h), r, cb, rad, ring, H)
    if (lk.bg) {
      ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      if (lk.bg.kind === 'color') { ctx.fillStyle = lk.bg.color; ctx.fillRect(0, 0, W, H) }
      else {
        const k = Math.max(W / sw, H / sh) * 1.1, bw = sw * k, bh = sh * k
        ctx.filter = `blur(${bgBlurPx(lk.bg.amount, Math.min(W, H))}px)`
        draw0(ctx, (W - bw) / 2, (H - bh) / 2, bw, bh)
        ctx.filter = 'none'
      }
      ctx.restore()
    }
    let layer: (c: CanvasRenderingContext2D) => void = put
    const adj = adjActive(lk.adj)
    const m = lk.masks.length ? await maskImg(masksSvg(lk.masks, lk.maskOp, W / H, frameIn(W / H, sw / sh))) : null // 多蒙版合成（同预览 masksUrl）
    if (adj || m || lk.shadow || rad || ring) { // 有阴影／圆角也先画进这一层（阴影要照整层的轮廓·不被裁剪框切掉）
      l2d.setTransform(1, 0, 0, 1, 0, 0); l2d.globalCompositeOperation = 'source-over'; l2d.globalAlpha = 1
      l2d.clearRect(0, 0, W, H); put(l2d)
      if (adj) {
        const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h))
        if (x1 > x0 && y1 > y0) { const px = l2d.getImageData(x0, y0, x1 - x0, y1 - y0); adjustPixels(px.data, x1 - x0, y1 - y0, lk.adj); l2d.putImageData(px, x0, y0) }
      }
      if (m) { l2d.globalCompositeOperation = 'destination-in'; l2d.drawImage(m, 0, 0, W, H); l2d.globalCompositeOperation = 'source-over' }
      layer = (c) => c.drawImage(layerCv, 0, 0)
    }
    const xfm = (c: CanvasRenderingContext2D) => {
      c.translate(W / 2 + (xf.tx / 100) * W, H / 2 + (xf.ty / 100) * H)
      if (xf.rot) c.rotate((xf.rot * Math.PI) / 180)
      if (xf.sx !== 1 || xf.sy !== 1) c.scale(xf.sx, xf.sy)
      c.translate(-W / 2, -H / 2)
    }
    const pinH = pinMatrix(lk.pin)
    // 方向性快门模糊（同预览 DirBlurCanvas）：快门里几刻的变形（关键帧＋动画·同 lookXform）⇒ mblurDirSamples ⇒ drawDirSamples 叠
    const pose = (tt: number) => lookXform(lookOf(op.clip, tt), clipAnimPose(op.clip, tt))
    const dirS = mblurModeOf(lk.mblur, op.media) === 'dir' && lk.mblur ? mblurDirSamples(lk.mblur, pose, t) : null
    const gp = glowPx(lk.glow, H)
    // 摆好位置的整层（不带不透明度／混合）：方向模糊 ⇒ 叠样本；不然照旧 xfm
    const placed = (c: CanvasRenderingContext2D) => { if (dirS) drawDirSamples(c as unknown as Ctx2DLite, dirS, xf, W, H, (cc) => layer(cc as unknown as CanvasRenderingContext2D)); else { xfm(c); layer(c) } }
    // 轨道遮罩：整层（变形、阴影后·画面座标·同预览挂在外框的 mask-image）先画进暂存·再 destination-in 遮罩·最后照混合模式贴上
    const mt = op.matte && lk.matte ? op.matte : null
    const tgt = mt ? (mt2d.setTransform(1, 0, 0, 1, 0, 0), mt2d.globalAlpha = 1, mt2d.globalCompositeOperation = 'source-over', mt2d.clearRect(0, 0, W, H), mt2d) : ctx
    { // 有轨道遮罩 ⇒ 这一段的 ctx 换成暂存那张
      const ctx = tgt
      ctx.save()
      ctx.globalAlpha = xf.opacity
      ctx.globalCompositeOperation = mt ? 'source-over' : blendOp(lk.blend)
      if (dirS || gp) {
        // 先画成一张整画面大小的图（四角透视、外发光都在这张上做）·再带不透明度／混合／阴影贴上去（同预览：外发光在阴影那层框里面、阴影在最外）
        let full = pinH ? pinLayer(pinH, placed) : (() => { const f = scratchFull(0); const f2 = f.getContext('2d')!; f2.setTransform(1, 0, 0, 1, 0, 0); f2.globalAlpha = 1; f2.clearRect(0, 0, W, H); f2.save(); placed(f2); f2.restore(); return f })()
        if (gp) full = glowLayer(full, gp)
        if (lk.shadow) { const sp = shadowPx(lk.shadow, H); ctx.shadowColor = sp.color; ctx.shadowBlur = sp.canvasBlur; ctx.shadowOffsetX = sp.dx; ctx.shadowOffsetY = sp.dy }
        ctx.drawImage(full, 0, 0)
      } else {
        if (!pinH) xfm(ctx)
        // 阴影：偏移不跟着变形转（同预览外框的 drop-shadow·画面座标）
        if (lk.shadow) { const sp = shadowPx(lk.shadow, H); ctx.shadowColor = sp.color; ctx.shadowBlur = sp.canvasBlur; ctx.shadowOffsetX = sp.dx; ctx.shadowOffsetY = sp.dy }
        if (pinH) ctx.drawImage(pinLayer(pinH, (c) => { xfm(c); layer(c) }), 0, 0)
        else layer(ctx)
      }
      ctx.restore()
    }
    if (mt) {
      const imgs = new Map<string, HTMLImageElement | null>()
      for (const o of mt.ops) if (o.kind === 'sticker') { const it = stickerById(o.body.sticker); if (it) imgs.set(stickerSrc(it), await stickerImg(stickerSrc(it))) }
      drawMatteOps(mk2d, mt, W, H, t, env.tracks, (f) => imgs.get(f) ?? null)
      mt2d.globalCompositeOperation = 'destination-in'; mt2d.drawImage(mkCv, 0, 0); mt2d.globalCompositeOperation = 'source-over'
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = blendOp(lk.blend); ctx.drawImage(mtCv, 0, 0); ctx.restore()
    }
  }

  const drawOp = async (op: DrawOp, t: number, used: Set<string>) => {
    if (op.kind === 'media') return drawMedia(op, t, used)
    if (op.kind === 'vector') { drawVectorClip(ctx, op.clip, t, W, H); return } // 形状／纯色：同预览 VeditVectorCanvas
    if (op.kind === 'text' || op.kind === 'sticker') {
      // 文字／贴纸画进 c（照原本的位置）；四角透视 ⇒ 先画进 pinCv 再投影（同画面片段·同预览 pinCssMatrix 那个矩阵）
      let im: CanvasImageSource | null = null, it: ReturnType<typeof stickerById> = null
      if (op.kind === 'sticker') { it = stickerById(op.body.sticker); im = it ? await stickerImg(stickerSrc(it)) : null; if (!it || !im) return }
      const drawTS = (ctx: CanvasRenderingContext2D) => {
        if (op.kind === 'text') { drawTextBody(ctx, op.body, W, H, op.at); return }
        const b = stickerBox(it!, op.body.size)
        const bw = b.w * H, bh = b.h * H
        // 贴纸动画：姿势同预览（stickerPose）
        const sp = stickerPose(op.body, clipAnimPose(op.clip, t))
        ctx.globalAlpha = sp.alpha
        ctx.translate(op.body.x * W + sp.dx * H, op.body.y * H + sp.dy * H)
        if (sp.rot) ctx.rotate((sp.rot * Math.PI) / 180)
        if (sp.sx !== 1 || sp.sy !== 1) ctx.scale(sp.sx, sp.sy)
        ctx.drawImage(im!, -bw / 2, -bh / 2, bw, bh)
      }
      const pinT = pinMatrix(lookOf(op.clip, t).pin)
      // 运动跟踪：整层跟着路径平移／缩放（followAt 同预览）·套在四角透视外面
      const fo = followAt(env.tracks, op.clip, t, W / H)
      ctx.save()
      if (fo) ctx.transform(...followAffine(fo, W, H))
      if (pinT) ctx.drawImage(pinLayer(pinT, drawTS), 0, 0); else drawTS(ctx)
      ctx.restore()
      return
    }
    const key = `${op.laneId}:${op.pkg}`
    let host = hosts.get(key)
    const bundle = env.programOf(op.pkg)
    if (host === undefined) { host = bundle ? new ProgramHost(bundle.html, W, H) : null; hosts.set(key, host) }
    if (!host || !bundle) return
    const bmp = await host.capture(op.t, effectiveParams(bundle.manifest, op.params), { w: W, h: H })
    if (bmp) { ctx.drawImage(bmp, 0, 0, W, H); bmp.close() }
  }

  const frame = async (t: number, only?: ReadonlySet<string>) => {
    const used = new Set<string>()
    mbUsed.clear()
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    backdrop(ctx, W, H)
    for (const op of framePlan(env.tracks, t, kindOf, only)) await drawOp(op, t, used)
    drawMosaics(ctx, mosaicsAt(env.tracks, t, only), W, H) // 追踪打码：打在合成好的整格画面上
    for (const [k, c] of cursors) if (!used.has(k)) { cursors.delete(k); await c.close() }   // 放完的段关掉解码器
    for (const k of [...mbHist.keys()]) if (!mbUsed.has(k)) mbHist.delete(k) // 放完的段丢掉运动模糊历史
  }
  const dispose = async () => {
    for (const c of cursors.values()) await c.close()
    for (const g of gls.values()) g?.dispose()
    for (const h of hosts.values()) h?.dispose()
    for (const i of inputs) i.dispose()
    for (const u of blobUrls) URL.revokeObjectURL(u)
  }
  /**  预检：这份画面素材打得开吗（影片＝能解第一条视频轨·图片＝载得到）；打不开也记进 skipped */
  const probe = async (id: string): Promise<boolean> => {
    const k = kindOf(id)
    const okv = k === 'video' ? !!(await openVideo(id)) : k === 'image' ? !!(await openImage(id)) : true
    if (!okv) skip(id)
    return okv
  }
  /** 透明背景：刚画好的这一帧有没有透明的地方（读回整格像素·只在抽样帧叫）；不透明画布 ⇒ false */
  const transparentNow = (): boolean => {
    if (!spec.canvasAlpha) return false
    try { return hasTransparentPixel(ctx.getImageData(0, 0, W, H).data) } catch { return true } // 读不回（不该发生）⇒ 不下「没透明」的结论
  }
  return { canvas, frame, dispose, probe, transparentNow, skipped: () => skipped, skippedIds: () => [...skippedIds] }
}

/** 汇出静帧（剪映「导出静帧」）：时间轴第 t 秒那一帧画成 PNG */
export async function renderStill(env: ExportEnv, t: number, W: number, H: number, o: { alpha?: boolean } = {}): Promise<{ blob: Blob; skipped: number }> {
  const fd = await frameDrawer(env, W, H, o) // 选了透明背景 ⇒ 静帧 PNG 也保留透明
  try {
    await fd.frame(t)
    const blob = await new Promise<Blob>((ok, no) => fd.canvas.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png'))
    return { blob, skipped: fd.skipped() }
  } finally { await fd.dispose() }
}

/** 浏览器下载一份档 */
export function downloadBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: u, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 60_000)
}

export const fmtDur = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }

/** 汇出音频：range 那段的混音（同成片的声音）编成 WAV；没声音 ⇒ null */
export async function renderAudio(env: ExportEnv, range: ExportRange, signal?: AbortSignal): Promise<Blob | null> {
  const kindOf = (id: string) => env.mediaOf(id)?.kind
  const ids = range.only ? [...range.only] : env.tracks.flatMap((l) => l.clips.map((c) => c.id))
  const plan = subClipPlan(env.tracks, ids, kindOf)
  if (!plan || !plan.segs.length) return null
  const buffer = await mixForExport(env, plan, range.from, range.to - range.from, signal)
  const chs = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return new Blob([new Uint8Array(encodeWav(chs, buffer.sampleRate))], { type: 'audio/wav' })
}

