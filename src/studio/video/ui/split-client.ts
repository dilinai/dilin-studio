'use client'
// 网页剪辑页·编曲拆曲：
// ① SplitEngine：开一只 module Worker（SPLIT_WORKER_SOURCE·从 CDN 载 onnxruntime-web）·下载／读缓存模型（报进度）·一块一块跑；取消＝terminate；
// ② splitSong：解码成 44.1kHz 立体声 ⇒ 切块 ⇒ 页面这边分批做 STFT（让出主执行绪·不卡）⇒ 送 Worker ⇒ 反 STFT 接回 ⇒ 纯伴奏、人声两份 WAV。
// 声音只在这台电脑上算·⛔ 上传。
import { encodeWav } from '../lib/arrange.pure'
import { Fft, hannPeriodic, hanningSym, istftChunk, SPLIT_CHUNK, SPLIT_COMPENSATE, SPLIT_DIMF, SPLIT_DIMT, SPLIT_SR, SPLIT_TRIM, SPLIT_WORKER_SOURCE, splitPlan, stftChunk } from '../lib/split.pure'

type Pending = { resolve: (o: Float32Array) => void; reject: (e: Error) => void }
export class SplitEngine {
  private worker: Worker | null = null
  private url: string | null = null
  private ready: Promise<'webgpu' | 'wasm'> | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private onFail: ((e: Error) => void) | null = null
  constructor(private ortUrl: string, private modelUrl: string, private onProgress: (loaded: number, total: number) => void) {}
  load(): Promise<'webgpu' | 'wasm'> {
    if (this.ready) return this.ready
    this.url = URL.createObjectURL(new Blob([SPLIT_WORKER_SOURCE], { type: 'text/javascript' }))
    const w = new Worker(this.url, { type: 'module' })
    this.worker = w
    this.ready = new Promise<'webgpu' | 'wasm'>((resolve, reject) => {
      this.onFail = reject
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; id?: number; loaded?: number; total?: number; output?: Float32Array; device?: 'webgpu' | 'wasm'; message?: string }
        if (m.type === 'progress') this.onProgress(m.loaded ?? 0, m.total ?? 0)
        else if (m.type === 'ready') { this.onFail = null; resolve(m.device === 'webgpu' ? 'webgpu' : 'wasm') }
        else if (m.type === 'result' && m.id !== undefined && m.output) { this.pending.get(m.id)?.resolve(m.output); this.pending.delete(m.id) }
        else if (m.type === 'error') {
          const err = new Error(m.message || 'split error')
          if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)!.reject(err); this.pending.delete(m.id) }
          else this.onFail?.(err)
        }
      }
      w.onerror = (e) => { const err = new Error(e.message || 'worker error'); this.onFail?.(err); for (const p of this.pending.values()) p.reject(err); this.pending.clear() }
    })
    this.ready.catch(() => this.dispose())
    w.postMessage({ type: 'load', ort: this.ortUrl, model: this.modelUrl })
    return this.ready
  }
  run(input: Float32Array): Promise<Float32Array> {
    const w = this.worker
    if (!w) return Promise.reject(new Error('not loaded'))
    const id = ++this.seq
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ type: 'run', id, input }, [input.buffer])
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

const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

/** 解码成 44.1kHz 立体声（单声道复制成两边） */
export async function decodeStereo(file: Blob): Promise<[Float32Array, Float32Array]> {
  const buf = await file.arrayBuffer()
  const probe = new OfflineAudioContext(2, 1, SPLIT_SR)
  const ab = await probe.decodeAudioData(buf)
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(ab.duration * SPLIT_SR)), SPLIT_SR)
  const src = ctx.createBufferSource()
  src.buffer = ab
  src.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  const L = out.getChannelData(0)
  return [L, out.numberOfChannels > 1 ? out.getChannelData(1) : L.slice()]
}

/** 整首拆成纯伴奏＋人声（WAV 位元组）；onStep(第几块, 共几块)·cancelled() 真 ⇒ 丢 cancelled */
export async function splitSong(engine: SplitEngine, L0: Float32Array, R0: Float32Array, opt: { onStep?: (done: number, of: number) => void; cancelled?: () => boolean } = {}): Promise<{ vocals: Uint8Array; inst: Uint8Array }> {
  const n = L0.length
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L0[i]), Math.abs(R0[i]))
  const scale = peak > 0 ? 1 / peak : 1
  const { padded, starts } = splitPlan(n)
  const ML = new Float32Array(padded), MR = new Float32Array(padded)
  for (let i = 0; i < n; i++) { ML[SPLIT_TRIM + i] = L0[i] * scale; MR[SPLIT_TRIM + i] = R0[i] * scale }
  const accL = new Float32Array(padded), accR = new Float32Array(padded), div = new Float32Array(padded)
  const fft = new Fft(6144), win = hannPeriodic(6144)
  const cl = new Float32Array(SPLIT_CHUNK), cr = new Float32Array(SPLIT_CHUNK)
  for (let k = 0; k < starts.length; k++) {
    if (opt.cancelled?.()) throw new Error('cancelled')
    opt.onStep?.(k, starts.length)
    const s = starts[k], e = Math.min(s + SPLIT_CHUNK, padded), have = e - s
    cl.fill(0); cr.fill(0); cl.set(ML.subarray(s, e)); cr.set(MR.subarray(s, e))
    const spec = new Float32Array(4 * SPLIT_DIMF * SPLIT_DIMT)
    for (let t = 0; t < SPLIT_DIMT; t += 32) { stftChunk(cl, cr, spec, fft, win, t, Math.min(SPLIT_DIMT, t + 32)); await breathe() }
    const out = await engine.run(spec)
    if (opt.cancelled?.()) throw new Error('cancelled')
    const [yl, yr] = istftChunk(out, SPLIT_CHUNK, fft, win)
    const w = hanningSym(have)
    for (let i = 0; i < have; i++) { accL[s + i] += yl[i] * w[i]; accR[s + i] += yr[i] * w[i]; div[s + i] += w[i] }
    await breathe()
  }
  opt.onStep?.(starts.length, starts.length)
  const instL = new Float32Array(n), instR = new Float32Array(n)
  for (let i = 0; i < n; i++) { const j = SPLIT_TRIM + i, d = div[j] > 0 ? div[j] : 1; instL[i] = (accL[j] / d) * peak; instR[i] = (accR[j] / d) * peak }
  const vocals = new Float32Array(n)
  const vocalsR = new Float32Array(n)
  for (let i = 0; i < n; i++) { vocals[i] = L0[i] - instL[i] * SPLIT_COMPENSATE; vocalsR[i] = R0[i] - instR[i] * SPLIT_COMPENSATE }
  return { vocals: encodeWav([vocals, vocalsR], SPLIT_SR), inst: encodeWav([instL, instR], SPLIT_SR) }
}
