// 画板「生成式 AI」接到画板本体的那一层：画板（menus/impl/genai.js）只认 window.__dlGenAI，这里把宿主给的挂上去。
//   生成式填充／扩展／移除、文字转向量要扣点数 ⇒ 只有登入版网站的宿主给 provider（网站那支在网站码里·这里不打网络）；
//   游客版（免登入）与单机版不给 ⇒ signedIn:false，画板一律出「需登入堤麟」的说明、不送任何东西。
//   AI 去背／选择主体（AI）在浏览器本地跑、不扣点：segment＝模型与 onnxruntime-web 的网址（宿主算好给·没给 ⇒ 画板退回传统演算法）；
//   宿主也可以给 runner 自己跑（例如单机版走本机）。
//   ⛔ 用 @/ 别名（单测直接按相对路径载）。

/** 送生图服务的规格：比例档模型给 ratio（'16:9'）、像素档模型给 size（'1536x1024'） */
export type GenAiSpec = { ratio?: string; size?: string }
export type GenAiCaps = { ok: true; model: string; modelLabel: string; ratios: string[]; sizes: string[]; refLimit: number } | GenAiFail
/** 报价票绑的规格（route 回的 quote：模型、size／比例、画质档、参考图张数、计费方式、点数）＋参考图尺寸·给人／agent 看 */
export type GenAiQuoteSpec = Record<string, unknown> & { refDims?: [number, number][] }
export type GenAiQuote = { ok: true; ticket: unknown; count: number; credits: number; billingMode: 'precharge' | 'postcharge'; model: string; modelLabel: string; spec?: GenAiQuoteSpec } | GenAiFail
/** 没成的那张点数现况（审 116180 F5）：refunded 已退／not_charged 没扣／pending 还在生成（会照扣）／refund_pending 失败、还没看到退款／charged 已扣（图在云盘）／unknown 不确定 */
export type GenAiCredit = 'refunded' | 'not_charged' | 'pending' | 'refund_pending' | 'charged' | 'unknown'
export type GenAiResult = { ok: true; blob: Blob; fileId: string | null } | { ok: false; error: string; refunded: boolean; credit?: GenAiCredit }
export type GenAiRun = { ok: true; results: GenAiResult[] } | GenAiFail
export type GenAiFail = { ok: false; code: string; error: string; message?: string; credits?: number }

/** 登入版网站给的生图那一组（画板 genai.js 照这三支叫） */
export interface PaintGenAiProvider {
  /** 只问：现在这位用户的生图模型认得哪些比例／尺寸、收几张参考图（⛔ 扣点） */
  caps(q: { prompt: string; refImages: number }): Promise<GenAiCaps>
  /** 图先传上去、照真下单同一份内容问价（⛔ 扣点）⇒ ticket（run 拿它下单·票绑全套规格与张数 count·下单时 route 核，对不上拒） */
  quote(q: { prompt: string; images: Blob[]; spec: GenAiSpec; count?: number; refDims?: [number, number][] }): Promise<GenAiQuote>
  /** 照 ticket 下 count 张（要等于问价时的张数·每张一笔·失败由服务端自动退）·等结果 */
  run(ticket: unknown, o: { count: number; onProgress?: (done: number, of: number) => void }): Promise<GenAiRun>
}

/** 本地去背：模型档与 onnxruntime-web 的网址（第一次用才下载·存进浏览器快取）；或宿主自己跑（runner：CHW float32 1×3×size×size ⇒ size×size 的前景分数） */
export type PaintSegmentConfig =
  | { ort: string; model: string; bytes?: number; name?: string }
  | { runner: (input: Float32Array, size: number) => Promise<Float32Array> ; name?: string }

export type DlGenAI = {
  version: 1
  signedIn: boolean
  caps?: PaintGenAiProvider['caps']
  quote?: PaintGenAiProvider['quote']
  run?: PaintGenAiProvider['run']
  segment: PaintSegmentConfig | null
}

/** 挂到画板 iframe 的 window（每次画板起好都挂一次·provider 为 null ＝没登入） */
export function installGenAi(win: Window, provider: PaintGenAiProvider | null, segment: PaintSegmentConfig | null): DlGenAI {
  const g: DlGenAI = provider
    ? { version: 1, signedIn: true, caps: (q) => provider.caps(q), quote: (q) => provider.quote(q), run: (t, o) => provider.run(t, o), segment }
    : { version: 1, signedIn: false, segment }
  ;(win as Window & { __dlGenAI?: DlGenAI }).__dlGenAI = g
  return g
}

/** 去背模型（ormbg·Apache-2.0·ISNet 架构·1024×1024 输入、÷255 不做 normalize）：Hugging Face onnx-community/ormbg-ONNX 钉住版本的 int8 量化档 */
export const SEG_MODEL = { repo: 'onnx-community/ormbg-ONNX', revision: '034e2d884afbab897e10e78fc5bb566b29533fd6', file: 'onnx/model_quantized.onnx', bytes: 44_315_205, name: 'ormbg (Apache-2.0)' } as const
/** 模型网址：host＝模型站的根（宿主给·台版 Hugging Face、陆版镜像·没有 ⇒ null＝不开放本地去背） */
export const segModelUrl = (host: string | null): string | null => (host ? `${host.replace(/\/?$/, '/')}${SEG_MODEL.repo}/resolve/${SEG_MODEL.revision}/${SEG_MODEL.file}` : null)
/** onnxruntime-web：钉剪辑页拆曲同一版（video/lib/split.pure.ts 的 SPLIT_ORT_URL·陆版镜像已有它的 wasm）·画板不跨编辑器 import ⇒ 这里另写一份同值 */
export const SEG_ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort.webgpu.min.mjs'
const JSDELIVR_NPM = 'https://cdn.jsdelivr.net/npm/'
/** 设了镜像（npmBase＝<镜像根>/npm/）⇒ onnxruntime 也从镜像取；没设照原网址 */
export const segOrtUrl = (npmBase: string | null): string => (npmBase ? npmBase + SEG_ORT_URL.slice(JSDELIVR_NPM.length) : SEG_ORT_URL)
/** 模型根＋onnxruntime-web 网址 ⇒ 画板要的 segment（没模型根 ⇒ null） */
export function segConfigFor(host: string | null, ortUrl: string): PaintSegmentConfig | null {
  const model = segModelUrl(host)
  return model ? { ort: ortUrl, model, bytes: SEG_MODEL.bytes, name: SEG_MODEL.name } : null
}
