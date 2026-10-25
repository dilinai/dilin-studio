// 网页剪辑页·编曲「拆曲」（·选「直接在网页里拆…两个都做：有壳走壳，没壳走网页（先做网页那条）」）。
// 做法（与 BS-RoFormer 对照·人声比 12.3 dB）：UVR-MDX-NET-Inst_HQ_3（ONNX·约 67MB·出纯伴奏）——
// 一首歌 44.1kHz 立体声 ⇒ 切成约 5.9 秒一块（前后各垫 3072 点·块间重叠 25%·汉宁窗接起来）⇒ 每块做 STFT
// ⇒ 模型出伴奏的频谱 ⇒ 反 STFT ⇒ 伴奏；人声＝原曲 − 伴奏 × 1.022。整首先除以峰值再算、算完乘回。
// 模型在 Worker 里跑（onnxruntime-web·先显卡 WebGPU·没有退回处理器）；STFT 在页面这边分批算（本档纯函数·题直接跑）。⛔ 碰 DOM。
import { asrViaNpm } from './asr.pure'

export const SPLIT_SR = 44100
export const SPLIT_NFFT = 6144
export const SPLIT_HOP = 1024
export const SPLIT_DIMF = 3072
export const SPLIT_DIMT = 256
/** 人声＝原曲 − 伴奏 × 这个数（UVR 该模型的补偿值） */
export const SPLIT_COMPENSATE = 1.022
export const SPLIT_OVERLAP = 0.25
/** 一块多长（点）＝hop ×（帧数 − 1） */
export const SPLIT_CHUNK = SPLIT_HOP * (SPLIT_DIMT - 1)
export const SPLIT_TRIM = SPLIT_NFFT / 2

/** 模型档：Hugging Face seanghay/uvr_models 钉住版本（UVR 项目·MIT） */
export const SPLIT_MODEL = { repo: 'seanghay/uvr_models', revision: '6f4fc0cfb0717c9033ffed12471a53008f145b20', file: 'UVR-MDX-NET-Inst_HQ_3.onnx', bytes: 66_759_214 } as const
/** onnxruntime-web 用识别字幕那份同一版（陆版镜像已有它的 wasm·只要再补这一支入口） */
export const SPLIT_ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort.webgpu.min.mjs'
/** 模型网址：host＝asrModelHost 给的根（台版 Hugging Face·陆版镜像·没有 ⇒ null＝不开放） */
export const splitModelUrl = (host: string | null): string | null => (host ? `${host}${SPLIT_MODEL.repo}/resolve/${SPLIT_MODEL.revision}/${SPLIT_MODEL.file}` : null)
export const splitOrtUrl = (npmBase: string | null): string => asrViaNpm(SPLIT_ORT_URL, npmBase)

// ── 傅立叶（6144＝3 × 2048：先拆三份各做 2048 点基 2·再合）──
export class Fft {
  readonly n: number
  private readonly m: number
  private readonly rev: Uint32Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly bufR: Float64Array[]
  private readonly bufI: Float64Array[]
  constructor(n: number) {
    if (n % 3 !== 0 || !Number.isInteger(Math.log2(n / 3))) throw new Error('Fft: n 要是 3 × 2 的次方')
    this.n = n
    const m = (this.m = n / 3)
    const bits = Math.log2(m)
    this.rev = new Uint32Array(m)
    for (let i = 0; i < m; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r }
    this.cos = new Float64Array(n); this.sin = new Float64Array(n)
    for (let k = 0; k < n; k++) { this.cos[k] = Math.cos((2 * Math.PI * k) / n); this.sin[k] = Math.sin((2 * Math.PI * k) / n) }
    this.bufR = [0, 1, 2].map(() => new Float64Array(m)); this.bufI = [0, 1, 2].map(() => new Float64Array(m))
  }
  /** 就地做 n 点复数傅立叶（inverse ⇒ 反变换·⛔ 除以 n） */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const { n, m, rev } = this
    const sg = inverse ? 1 : -1
    for (let j = 0; j < 3; j++) {
      const R = this.bufR[j], I = this.bufI[j]
      for (let i = 0; i < m; i++) { R[rev[i]] = re[3 * i + j]; I[rev[i]] = im[3 * i + j] }
      for (let size = 2; size <= m; size <<= 1) {
        const half = size >> 1, step = n / size
        for (let s = 0; s < m; s += size) {
          for (let k = 0; k < half; k++) {
            const wr = this.cos[k * step], wi = sg * this.sin[k * step]
            const a = s + k, b = a + half
            const tr = R[b] * wr - I[b] * wi, ti = R[b] * wi + I[b] * wr
            R[b] = R[a] - tr; I[b] = I[a] - ti; R[a] += tr; I[a] += ti
          }
        }
      }
    }
    const [R0, R1, R2] = this.bufR, [I0, I1, I2] = this.bufI
    for (let k = 0; k < n; k++) {
      const q = k % m
      const c1 = this.cos[k], s1 = sg * this.sin[k], k2 = (2 * k) % n, c2 = this.cos[k2], s2 = sg * this.sin[k2]
      re[k] = R0[q] + R1[q] * c1 - I1[q] * s1 + R2[q] * c2 - I2[q] * s2
      im[k] = I0[q] + R1[q] * s1 + I1[q] * c1 + R2[q] * s2 + I2[q] * c2
    }
  }
}

/** 周期汉宁窗（同 torch.hann_window periodic） */
export function hannPeriodic(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

/** 一块（左右声道各 SPLIT_CHUNK 点）⇒ 模型输入 [4][DIMF][DIMT]（左实、左虚、右实、右虚）·照 torch.stft center=True（前后反射垫 n_fft/2）·最低 3 格清零。
 *  两声道合成一个复数做一次傅立叶（左＝实部·右＝虚部）再拆开。frames 给了 ⇒ 只算 [from, to) 那几帧（分批让页面不卡） */
export function stftChunk(L: Float32Array, R: Float32Array, out: Float32Array, fft: Fft, win: Float64Array, from = 0, to = SPLIT_DIMT): void {
  const N = SPLIT_NFFT, P = N / 2, len = L.length
  const re = new Float64Array(N), im = new Float64Array(N)
  const at = (x: Float32Array, i: number) => { let j = i - P; if (j < 0) j = -j; if (j >= len) j = 2 * (len - 1) - j; return x[j] }
  const plane = SPLIT_DIMF * SPLIT_DIMT
  for (let t = from; t < to; t++) {
    const s = t * SPLIT_HOP
    for (let i = 0; i < N; i++) { re[i] = at(L, s + i) * win[i]; im[i] = at(R, s + i) * win[i] }
    fft.transform(re, im)
    for (let f = 0; f < SPLIT_DIMF; f++) {
      const g = f === 0 ? 0 : N - f
      const xr = re[f], xi = im[f], yr = re[g], yi = -im[g] // y＝conj(X[N-f])
      const o = f * SPLIT_DIMT + t
      const keep = f >= 3 ? 1 : 0
      out[o] = keep * 0.5 * (xr + yr); out[plane + o] = keep * 0.5 * (xi + yi) // 左＝(X+conj)/2
      out[2 * plane + o] = keep * 0.5 * (xi - yi); out[3 * plane + o] = keep * -0.5 * (xr - yr) // 右＝(X−conj)/(2i)
    }
  }
}

/** 模型输出 [4][DIMF][DIMT] ⇒ 左右各 len 点（反 STFT·窗平方归一·去掉前面 n_fft/2）·高于 DIMF 的格当 0 */
export function istftChunk(spec: Float32Array, len: number, fft: Fft, win: Float64Array): [Float32Array, Float32Array] {
  const N = SPLIT_NFFT, P = N / 2, plane = SPLIT_DIMF * SPLIT_DIMT
  const total = N + SPLIT_HOP * (SPLIT_DIMT - 1)
  const yl = new Float64Array(total), yr = new Float64Array(total), ws = new Float64Array(total)
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let t = 0; t < SPLIT_DIMT; t++) {
    re.fill(0); im.fill(0)
    // Z＝左 + i·右（两边都是厄米谱）⇒ 反变换后实部＝左、虚部＝右
    for (let f = 0; f < SPLIT_DIMF; f++) {
      const o = f * SPLIT_DIMT + t
      const lr = spec[o], li = spec[plane + o], rr = spec[2 * plane + o], ri = spec[3 * plane + o]
      re[f] += lr - ri; im[f] += li + rr
      if (f > 0) { const g = N - f; re[g] += lr + ri; im[g] += -li + rr } // 左 conj + i·右 conj
    }
    fft.transform(re, im, true)
    const s = t * SPLIT_HOP
    for (let i = 0; i < N; i++) { yl[s + i] += (re[i] / N) * win[i]; yr[s + i] += (im[i] / N) * win[i]; ws[s + i] += win[i] * win[i] }
  }
  const L = new Float32Array(len), R = new Float32Array(len)
  for (let i = 0; i < len; i++) { const w = ws[P + i]; const d = w > 1e-11 ? w : 1; L[i] = yl[P + i] / d; R[i] = yr[P + i] / d }
  return [L, R]
}

/** 整首怎么切：垫好的总长、每块起点（步长＝块长 ×（1 − 重叠））；n＝原曲点数 */
export function splitPlan(n: number): { padded: number; starts: number[] } {
  const gen = SPLIT_CHUNK - 2 * SPLIT_TRIM
  const pad = gen + SPLIT_TRIM - (n % gen)
  const padded = SPLIT_TRIM + n + pad
  const step = Math.floor((1 - SPLIT_OVERLAP) * SPLIT_CHUNK)
  const starts: number[] = []
  for (let i = 0; i < padded; i += step) starts.push(i)
  return { padded, starts }
}
/** 接块用的汉宁窗（同 numpy.hanning·两端为 0） */
export function hanningSym(n: number): Float32Array {
  const w = new Float32Array(n)
  if (n === 1) { w[0] = 1; return w }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/** 拆好的档名：<歌名>-人聲.wav／<歌名>-純伴奏.wav（标签照介面语言） */
export function splitFileNames(song: string, labels: { vocals: string; inst: string }): { vocals: string; inst: string } {
  const base = (song.replace(/\.[^.\/\\]{1,8}$/, '').trim() || 'song').slice(0, 80)
  return { vocals: `${base}-${labels.vocals}.wav`, inst: `${base}-${labels.inst}.wav` }
}
/** 进度（0～1）：下载占前 30%（已下过 ⇒ 不占）·拆分占后面 */
export const splitRatio = (p: { kind: 'model'; loaded: number; total: number } | { kind: 'run'; done: number; of: number }): number =>
  p.kind === 'model' ? 0.3 * Math.max(0, Math.min(1, p.loaded / Math.max(p.total, SPLIT_MODEL.bytes, 1))) : 0.3 + 0.7 * Math.max(0, Math.min(1, p.done / Math.max(1, p.of)))

/** 拆曲 Worker（module·从 CDN 载 onnxruntime-web·⛔ 打包进网站）：
 *  进 {type:'load', ort, model} ⇒ 模型先找浏览器缓存（dilin-vedit-split）·没有就下载（报 progress{loaded,total}）存起来 ⇒ 先试显卡（webgpu）再退处理器（wasm）⇒ ready{device}｜error；
 *  进 {type:'run', id, input} ⇒ result{id, output}｜error{id}。取消＝页面 terminate。 */
export const SPLIT_WORKER_SOURCE = `
let sess = null, ort = null
self.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      ort = await import(m.ort)
      let bytes = null, cache = null
      try { cache = await caches.open('dilin-vedit-split'); const hit = await cache.match(m.model); if (hit) bytes = new Uint8Array(await hit.arrayBuffer()) } catch (err) { cache = null }
      if (!bytes) {
        const r = await fetch(m.model)
        if (!r.ok || !r.body) throw new Error('model ' + r.status)
        const total = Number(r.headers.get('content-length')) || 0
        const rd = r.body.getReader(); const parts = []; let loaded = 0
        for (;;) { const x = await rd.read(); if (x.done) break; parts.push(x.value); loaded += x.value.length; self.postMessage({ type: 'progress', loaded, total }) }
        bytes = new Uint8Array(loaded); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length }
        if (cache) { try { await cache.put(m.model, new Response(bytes)) } catch (err) {} }
      }
      let device = 'webgpu'
      try { sess = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }) }
      catch (err) { device = 'wasm'; sess = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) }
      self.postMessage({ type: 'ready', device })
    } else if (m.type === 'run') {
      const out = await sess.run({ input: new ort.Tensor('float32', m.input, [1, 4, ${SPLIT_DIMF}, ${SPLIT_DIMT}]) })
      const data = new Float32Array(out.output.data)
      self.postMessage({ type: 'result', id: m.id, output: data }, [data.buffer])
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err).slice(0, 300) })
  }
}
`
