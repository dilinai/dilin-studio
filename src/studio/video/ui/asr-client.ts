'use client'
// 网页剪辑页·识别字幕：
// ① mixTimelineAudio：把要识别的片段（素材某一截·放在时间轴某秒·音量）混成一条 16kHz 单声道（OfflineAudioContext·解码时就降到 16kHz）；
// ② AsrEngine：开一只 module Worker（ASR_WORKER_SOURCE·从 CDN 载 transformers.js）·载模型（报下载进度）·一段一段识别；取消＝terminate。
// 声音只在这台电脑上算·⛔ 上传。
import { ASR_DTYPE, ASR_LIB_URL, asrViaNpm, ASR_MODEL, ASR_REVISION, ASR_SAMPLE_RATE, ASR_WORKER_SOURCE, type AsrChunk, type AsrSource } from '../lib/asr.pure'

/** 这台浏览器能不能用显卡跑（WebGPU 拿得到转接器） */
export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (!gpu) return false
    return !!(await gpu.requestAdapter())
  } catch { return false }
}

/** 混声：span＝要的那段时间轴（秒）；urlOf 给不出／解不开的素材跳过（回 skipped 几份）；onStep(第几份, 共几份) */
export async function mixTimelineAudio(src: readonly AsrSource[], urlOf: (mediaId: string) => string | null, span: { start: number; end: number },
  opt: { onStep?: (done: number, of: number) => void; cancelled?: () => boolean } = {}): Promise<{ audio: Float32Array; skipped: number }> {
  const frames = Math.max(1, Math.ceil((span.end - span.start) * ASR_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(1, frames, ASR_SAMPLE_RATE)
  const ids = [...new Set(src.map((s) => s.mediaId))]
  const bufs = new Map<string, AudioBuffer>()
  let skipped = 0
  for (let i = 0; i < ids.length; i++) {
    if (opt.cancelled?.()) throw new Error('cancelled')
    opt.onStep?.(i, ids.length)
    const url = urlOf(ids[i])
    if (!url) { skipped++; continue }
    try {
      const r = await fetch(url, { cache: 'reload' }) // 不读快取（没带跨源载过的坏快取会让跨源 fetch 被挡·见 vedit-mix fetchMixBytes）
      if (!r.ok) throw new Error(String(r.status))
      bufs.set(ids[i], await ctx.decodeAudioData(await r.arrayBuffer()))
    } catch { skipped++ } // 没有声轨的影片、取不到的档
  }
  opt.onStep?.(ids.length, ids.length)
  for (const s of src) {
    const b = bufs.get(s.mediaId)
    if (!b || s.offset >= b.duration) continue
    const node = ctx.createBufferSource()
    node.buffer = b
    const g = ctx.createGain()
    g.gain.value = s.gain
    node.connect(g).connect(ctx.destination)
    node.start(Math.max(0, s.at - span.start), s.offset, Math.min(s.length, b.duration - s.offset))
  }
  if (opt.cancelled?.()) throw new Error('cancelled')
  const out = await ctx.startRendering()
  return { audio: out.getChannelData(0), skipped }
}

type Pending = { resolve: (c: AsrChunk[]) => void; reject: (e: Error) => void }
/** 识别 Worker 的外壳：load() 一次（第二次起直接回）；run() 送一段；dispose() 立刻停（模型也一起放掉） */
export class AsrEngine {
  private worker: Worker | null = null
  private url: string | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private onFail: ((e: Error) => void) | null = null
  /** npm＝程式库镜像根（陆版·没有＝jsDelivr） */
  constructor(private host: string, private npm: string | null, private onProgress: (loaded: number, total: number) => void) {}
  get loaded(): boolean { return !!this.worker && !!this.ready }
  load(): Promise<void> {
    if (this.ready) return this.ready
    this.url = URL.createObjectURL(new Blob([ASR_WORKER_SOURCE], { type: 'text/javascript' }))
    const w = new Worker(this.url, { type: 'module' })
    this.worker = w
    this.ready = new Promise<void>((resolve, reject) => {
      this.onFail = reject
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; loaded?: number; total?: number; chunks?: AsrChunk[]; message?: string }
        if (m.type === 'progress') this.onProgress(m.loaded ?? 0, m.total ?? 0)
        else if (m.type === 'ready') { this.onFail = null; resolve() }
        else if (m.type === 'result' && m.id !== undefined) { this.pending.get(m.id)?.resolve(m.chunks ?? []); this.pending.delete(m.id) }
        else if (m.type === 'error') {
          const err = new Error(m.message || 'asr error')
          if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)!.reject(err); this.pending.delete(m.id) }
          else this.onFail?.(err)
        }
      }
      w.onerror = (e) => { const err = new Error(e.message || 'worker error'); this.onFail?.(err); for (const p of this.pending.values()) p.reject(err); this.pending.clear() }
    })
    this.ready.catch(() => this.dispose())
    w.postMessage({ type: 'load', lib: asrViaNpm(ASR_LIB_URL, this.npm), npm: this.npm, host: this.host, model: ASR_MODEL, revision: ASR_REVISION, dtype: ASR_DTYPE })
    return this.ready
  }
  run(audio: Float32Array, language: string, opencc: { url: string; from: string; to: string } | null): Promise<AsrChunk[]> {
    const w = this.worker
    if (!w) return Promise.reject(new Error('not loaded'))
    const id = ++this.seq
    return new Promise<AsrChunk[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ type: 'run', id, audio, language, opencc }, [audio.buffer])
    })
  }
  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
    const err = new Error('cancelled')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.onFail = null
  }
}

/** 繁简转换（壳出原文·网页照站别转）：开一只小 module Worker 从 CDN 载 opencc-js（同识别 Worker 那份）·转完就关；载不到 ⇒ 照原样回 */
export async function convertTexts(texts: string[], cc: { url: string; from: string; to: string } | null): Promise<string[]> {
  if (!cc || !texts.length) return texts
  const src = `self.onmessage=async(e)=>{try{const O=await import(e.data.url);const c=O.Converter({from:e.data.from,to:e.data.to});self.postMessage({ok:true,t:e.data.t.map((s)=>c(s))})}catch(err){self.postMessage({ok:false})}}`
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  const w = new Worker(url, { type: 'module' })
  try {
    return await new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => resolve(texts), 20_000)
      w.onmessage = (e: MessageEvent) => { clearTimeout(timer); const m = e.data as { ok: boolean; t?: string[] }; resolve(m.ok && Array.isArray(m.t) && m.t.length === texts.length ? m.t : texts) }
      w.onerror = () => { clearTimeout(timer); resolve(texts) }
      w.postMessage({ url: cc.url, from: cc.from, to: cc.to, t: texts })
    })
  } finally { w.terminate(); URL.revokeObjectURL(url) }
}
