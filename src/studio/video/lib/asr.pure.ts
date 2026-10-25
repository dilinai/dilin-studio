// 网页剪辑页·在网页里跑（·
// 「是的「在网页里下载识别模型，用你电脑的显卡直接在浏览器里跑」」·）。
// 做法：transformers.js＋whisper-large-v3-turbo 编码器／解码器都 q4（约 760MB·浏览器缓存）·
// 只走 WebGPU（纯 CPU 太慢·小模型在显卡上会重复同一句）。声音＝时间轴上会出声的那些片段混成一条 16kHz 单声道（照轨道静音／隐藏／片段音量）·
// 分段送进 Worker 识别·一句一段排上文字轨（同「匯入本機字幕」那条 addSubtitles）。⛔ 上传声音（在使用者自己电脑跑）。
// 「有壳给壳」那条另做（壳要带识别引擎）·云端那条之后再说。本档只放纯函数与 Worker 源码字串（题直接跑）·⛔ 碰 DOM。
import type { SubtitleCue } from './text.pure'
import type { Tracks } from './timeline.pure'

export const ASR_MODEL = 'onnx-community/whisper-large-v3-turbo'
/** 钉住模型版本·上游改了档也不会悄悄换掉 */
export const ASR_REVISION = '360ebcde2559d60bb474678be3c1de9ef347d01a'
export const ASR_DTYPE = { encoder_model: 'q4', decoder_model_merged: 'q4' } as const
/** 第一次要下载多大（编码器 q4 425MB＋解码器 q4 334MB） */
export const ASR_MODEL_BYTES = 759_089_997
export const ASR_LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js' // 自带 onnxruntime（web.min 版会去 import 裸名 onnxruntime-web·浏览器解不了）
/** 繁简只换字不换词：繁＝cn→tw（字形）·简＝tw→cn */
export const ASR_OPENCC = {
  tw: { url: 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/esm/cn2t.js', from: 'cn', to: 'tw' },
  cn: { url: 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/esm/t2cn.js', from: 'tw', to: 'cn' },
} as const
export const ASR_SAMPLE_RATE = 16000
/** 一次送进模型多长（秒）：分段才看得到进度、能中途取消；段里照 30 秒一窗、前后重叠 5 秒 */
export const ASR_BLOCK_SEC = 240
/** 一次最多识别多长（秒） */
export const ASR_MAX_SEC = 2 * 3600

export type AsrLang = 'zh' | 'en'
export type AsrScope = 'all' | 'sel'
/** 一段要混进来的声音：素材第 offset 秒起 length 秒·放在时间轴 at 秒·音量 gain */
export type AsrSource = { mediaId: string; at: number; offset: number; length: number; gain: number }

/** 时间轴上会出声的片段（同预览：轨道静音／隐藏、片段静音／停用、声音已分离的不算；只要影片、音频）；only 给了 ⇒ 只要这几段 */
export function asrSources(tr: Tracks, kindOf: (mediaId: string) => string | undefined, only?: readonly string[]): AsrSource[] {
  const out: AsrSource[] = []
  for (const lane of tr) {
    if (lane.kind !== 'visual' && lane.kind !== 'audio') continue
    for (const c of lane.clips) {
      if (only && !only.includes(c.id)) continue
      const k = kindOf(c.mediaId)
      if (k !== 'video' && k !== 'audio') continue
      if (lane.hidden || lane.muted || c.muted || c.disabled || c.detached || !(c.length > 0)) continue
      const gain = Math.max(0, c.volume ?? 1)
      if (gain <= 0) continue
      out.push({ mediaId: c.mediaId, at: c.start, offset: c.offset, length: c.length, gain })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
/** 要识别的那一段时间轴（最早一段的头～最晚一段的尾）；没有 ⇒ null */
export function asrSpan(src: readonly AsrSource[]): { start: number; end: number } | null {
  if (!src.length) return null
  return { start: Math.min(...src.map((s) => s.at)), end: Math.max(...src.map((s) => s.at + s.length)) }
}
/** 切段（秒·相对整段开头）：每段 block 秒·最后一段不足 2 秒就并进前一段 */
export function asrBlocks(total: number, block = ASR_BLOCK_SEC): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let s = 0; s < total - 1e-6; s += block) out.push([s, Math.min(total, s + block)])
  if (out.length > 1 && out[out.length - 1][1] - out[out.length - 1][0] < 2) { const last = out.pop()!; out[out.length - 1][1] = last[1] }
  return out
}

/** Whisper 中文常见的空转幻觉（静音段会冒出来）——整句是这些就丢 */
export const ASR_JUNK = [/字幕由.{0,12}(提供|製作|制作)/, /amara\.org/i, /請不吝點贊|请不吝点赞|訂閱|订阅|轉發|转发|打賞|打赏/, /明鏡與點點|明镜与点点/, /^(謝謝觀看|谢谢观看|感謝觀看|感谢观看)[!！。.]*$/]
export type AsrChunk = { timestamp: [number, number | null]; text: string }
/** 一段的识别结果 ⇒ 字幕句（时间加上这段在时间轴的起点·没尾巴的用下一句头或段尾·空句、幻觉句丢掉·连着一模一样的句子合成一句） */
export function chunksToCues(chunks: readonly AsrChunk[], base: number, blockLen: number): SubtitleCue[] {
  const out: SubtitleCue[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const text = (c.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text || ASR_JUNK.some((r) => r.test(text))) continue
    const s = Math.max(0, Math.min(blockLen, Number(c.timestamp?.[0]) || 0))
    const nextStart = chunks[i + 1]?.timestamp?.[0]
    const e0 = c.timestamp?.[1] ?? (typeof nextStart === 'number' ? nextStart : blockLen)
    const e = Math.max(s, Math.min(blockLen, Number(e0)))
    if (e - s < 0.05) continue
    const prev = out[out.length - 1]
    if (prev && prev.text === text && base + s - prev.end < 1) { prev.end = base + e; continue }
    out.push({ start: base + s, end: base + e, text })
  }
  // Whisper 在 30 秒窗交界常给出很短的时间（一长句只给零点几秒）⇒ 按字数给最短显示时间：先往后延到下一句头／段尾·不够再往前借到上一句尾
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    const want = asrMinDur(c.text)
    if (c.end - c.start >= want) continue
    const ceil = i + 1 < out.length ? out[i + 1].start : base + blockLen
    c.end = Math.max(c.end, Math.min(ceil, c.start + want))
    const floor = i > 0 ? out[i - 1].end : base
    if (c.end - c.start < want) c.start = Math.max(floor, Math.min(c.start, c.end - want))
  }
  return out
}
/** 一句字幕至少显示多久（秒）：每字约 0.12 秒·0.6～4 秒 */
export const asrMinDur = (text: string): number => Math.min(4, Math.max(0.6, [...text.replace(/\s+/g, '')].length * 0.12))

/** 识别模型与程式库从哪里取（宿主给：modelHost＝模型根网址·没有 ⇒ 网页里识别／拆曲不开放；npmBase＝程式库镜像根·没有 ⇒ 缺省 CDN） */
export type AsrEnv = { modelHost: string | null; npmBase: string | null }
export type AsrAvail = 'checking' | 'ok' | 'no-webgpu' | 'no-model'
export function asrAvailability(p: { webgpu: boolean | null; host: string | null }): AsrAvail {
  if (!p.host) return 'no-model'
  if (p.webgpu === null) return 'checking'
  return p.webgpu ? 'ok' : 'no-webgpu'
}
/** 程式库（transformers.js／opencc-js／onnxruntime 的显卡运算档）缺省从 jsDelivr 取；陆版 jsDelivr 慢到不能用（onnxruntime 那份约 28MB）⇒
 *  设了模型镜像就一并从同站 `<镜像根>/npm/` 取 */
export const ASR_JSDELIVR_NPM = 'https://cdn.jsdelivr.net/npm/'
export function asrNpmBase(configuredModelHost: string | undefined): string | null {
  const c = (configuredModelHost ?? '').trim()
  return c ? `${c.replace(/\/+$/, '')}/npm/` : null
}
/** jsDelivr 网址 ⇒ 换到镜像（没镜像照原样） */
export const asrViaNpm = (url: string, npmBase: string | null): string => (npmBase && url.startsWith(ASR_JSDELIVR_NPM) ? npmBase + url.slice(ASR_JSDELIVR_NPM.length) : url)
/** 介面语言 ⇒ 缺省识别语言 */
export const asrDefaultLang = (ui: string): AsrLang => (ui === 'en' ? 'en' : 'zh')
/** 识别语言＋介面语言 ⇒ 交给 Worker 的设定：whisper 语言、要不要繁简转换 */
export function asrRunOpts(lang: AsrLang, ui: string, npmBase: string | null = null): { language: 'chinese' | 'english'; opencc: { url: string; from: string; to: string } | null } {
  if (lang === 'en') return { language: 'english', opencc: null }
  const o = ui === 'zh-CN' ? ASR_OPENCC.cn : ASR_OPENCC.tw
  return { language: 'chinese', opencc: { ...o, url: asrViaNpm(o.url, npmBase) } }
}
/** 下载进度（0～1）：各档已收／总量；总量还没报齐时拿模型总大小当分母 */
export const asrLoadRatio = (loaded: number, total: number): number => Math.max(0, Math.min(1, loaded / Math.max(total, ASR_MODEL_BYTES, 1)))

/** 识别 Worker（module·从 CDN 载 transformers.js·⛔ 打包进网站）：
 *  进 {type:'load', lib, host, npm, model, revision, dtype} ⇒（npm＝镜像的 npm 根·有就把 onnxruntime 运算档也改从那里取） 出 progress{loaded,total}…／ready｜error；
 *  进 {type:'run', id, audio, language, opencc} ⇒ 出 result{id, chunks}｜error{id}。取消＝页面直接 terminate。 */
export const ASR_WORKER_SOURCE = `
const JSD = '${ASR_JSDELIVR_NPM}'
let asr = null
const convs = {}
self.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      const T = await import(m.lib)
      T.env.allowLocalModels = false
      if (m.host) T.env.remoteHost = m.host
      // 取设定档时库不认 revision 选项（会去拿 resolve/main/）⇒ 版本号直接写进取档路径·台版真正钉住·陆版镜像只放了这一版
      if (m.revision) T.env.remotePathTemplate = '{model}/resolve/' + m.revision + '/'
      const wasm = T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm
      if (m.npm && wasm && wasm.wasmPaths && typeof wasm.wasmPaths === 'object') {
        const to = (u) => (typeof u === 'string' && u.startsWith(JSD) ? m.npm + u.slice(JSD.length) : u)
        wasm.wasmPaths = { mjs: to(wasm.wasmPaths.mjs), wasm: to(wasm.wasmPaths.wasm) }
      }
      const files = {}
      asr = await T.pipeline('automatic-speech-recognition', m.model, {
        device: 'webgpu', dtype: m.dtype, revision: m.revision,
        progress_callback: (p) => {
          if (p && p.status === 'progress' && p.file) {
            files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 }
            let l = 0, t = 0
            for (const f of Object.values(files)) { l += f.loaded; t += f.total }
            self.postMessage({ type: 'progress', loaded: l, total: t })
          }
        },
      })
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'run') {
      let conv = null
      if (m.opencc) {
        // 繁简转换载不到 ⇒ 照原样出字（⛔ 让整次识别失败）
        if (!(m.opencc.url in convs)) { try { const O = await import(m.opencc.url); convs[m.opencc.url] = O.Converter({ from: m.opencc.from, to: m.opencc.to }) } catch (err) { convs[m.opencc.url] = null } }
        conv = convs[m.opencc.url]
      }
      const out = await asr(m.audio, { language: m.language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
      const chunks = (out.chunks || []).map((c) => ({ timestamp: c.timestamp, text: conv ? conv(c.text || '') : (c.text || '') }))
      self.postMessage({ type: 'result', id: m.id, chunks })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err).slice(0, 300) })
  }
}
`
