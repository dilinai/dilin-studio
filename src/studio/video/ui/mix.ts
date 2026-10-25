'use client'
// 网页剪辑页·「合成子素材」：
// 选中那几段照时间轴位置混成一条立体声 WAV（44.1kHz·OfflineAudioContext）——音量、淡入淡出、变速都照片段设定；中间空的就是没声音。
// 计划（哪几段、放在第几秒）在 _lib/group.pure.ts subClipPlan；本档只做解码与混音。变速时声音会跟着变调（离线混音保持不了原音高）。
//  汇出成片：混音拆成 mixSubClip（回 AudioBuffer·可指定取样率与从时间轴第几秒起算）·汇出（48kHz·从 0 秒起）与子素材共用同一份。
import { encodeWav } from '../lib/wav'
import type { SubPlan, SubSeg } from '../lib/group.pure'
import { curveAvg, curveCum, curveSpeedAt } from '../lib/curve-speed.pure'
import { PEAKS_PER_SEC, accumulatePeaks } from '../lib/timeline.pure'
import { normGain } from '../lib/audio.pure'
import { buildAudioFx, warmPitch } from './audio-fx'

export const SUB_SAMPLE_RATE = 44100

/** 防部分浏览器汇出开头 0–5 秒整段静音（开场那支 mp3 没波形）：素材取档一律不读快取（cache:'reload'）——
 * 页上若先有不带跨源的 <audio> 载过同一条云盘网址，快取里那份没许可头 ⇒ 跨源 fetch 被挡（默认 fetch 会「Failed to fetch」、reload 照取得到）；
 * 取不到再试（网路一时断）。回 'fetch'＝取不到；回 bytes＝取到了。 */
export const MIX_FETCH_TRIES = 3
export async function fetchMixBytes(url: string, signal?: AbortSignal, waitMs = 800): Promise<ArrayBuffer | 'fetch'> {
  for (let i = 0; i < MIX_FETCH_TRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, waitMs * i))
    if (signal?.aborted) throw Object.assign(new Error('canceled'), { name: 'AbortError' })
    try {
      const r = await fetch(url, { signal, cache: 'reload' })
      if (r.ok) return await r.arrayBuffer()
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) return 'fetch' // 链接过期／没权限 ⇒ 再试也一样
    } catch (e) { if (signal?.aborted) throw e }
  }
  return 'fetch'
}

/** 混音时哪份素材没进来：missing＝没有可用链接（缺素材）；fetch＝取不到；decode＝取到了但解不开（影片多半是没声轨） */
export type MixFail = { mediaId: string; why: 'missing' | 'fetch' | 'decode' }

/** 混一份声音：urlOf 给不出／取不到／解不开的素材不混（回 skipped 几份、failed 哪几份与原因·由调用方决定要不要挡下）；
 * from＝成品第 0 秒对应时间轴第几秒（缺＝plan.start）·seconds＝成品多长（缺＝到 plan.end） */
export async function mixSubClip(plan: SubPlan, urlOf: (mediaId: string) => string | null, opts: { sampleRate?: number; from?: number; seconds?: number; signal?: AbortSignal } = {}): Promise<{ buffer: AudioBuffer; seconds: number; skipped: number; failed: MixFail[] }> {
  const rate = opts.sampleRate ?? SUB_SAMPLE_RATE
  const from = opts.from ?? plan.start
  const seconds = opts.seconds ?? plan.end - from
  const shift = plan.start - from   // 计划里的 at 从 plan.start 算 ⇒ 换成从 from 算
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * rate)), rate)
  const bufs = new Map<string, AudioBuffer>()
  const failed: MixFail[] = []
  for (const id of new Set(plan.segs.map((s) => s.mediaId))) {
    if (opts.signal?.aborted) throw Object.assign(new Error('canceled'), { name: 'AbortError' })
    const url = urlOf(id)
    if (!url) { failed.push({ mediaId: id, why: 'missing' }); continue }
    const bytes = await fetchMixBytes(url, opts.signal)
    if (bytes === 'fetch') { failed.push({ mediaId: id, why: 'fetch' }); continue }
    try { bufs.set(id, await ctx.decodeAudioData(bytes)) } catch (e) { if (opts.signal?.aborted) throw e; failed.push({ mediaId: id, why: 'decode' }) } // 没有声轨的影片
  }
  const skipped = failed.length
  // 要变调的先装处理器；响度统一照峰值表估（同预览那份峰值表的算法·每份素材算一次）
  if (plan.segs.some((s) => s.aud?.semi)) await warmPitch(ctx)
  const peakOf = new Map<string, Float32Array>()
  const peaksFor = (id: string, b: AudioBuffer) => {
    let p = peakOf.get(id)
    if (!p) { p = new Float32Array(Math.ceil(b.duration * PEAKS_PER_SEC) + 1); accumulatePeaks(p, b.sampleRate, 0, Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))); peakOf.set(id, p) }
    return p
  }
  for (const s of plan.segs) {
    const b0 = bufs.get(s.mediaId)
    if (!b0 || s.offset >= b0.duration) continue
    // 倒放：把素材那段倒过来另做一份·当成从 0 秒起的素材放（片段第 τ 秒＝倒过来那份第 τ×倍数 秒）
    const b = s.reverse ? reversedSlice(ctx, b0, s.offset, s.length * s.speed) : b0
    if (!b) continue
    const off = s.reverse ? 0 : s.offset
    const src = ctx.createBufferSource()
    src.buffer = b
    const g = ctx.createGain()
    const t0 = s.at + shift, t1 = t0 + s.length
    if (t1 <= 0) continue
    // 曲线变速 ⇒ 播放速度照曲线逐点走；音量关键帧 ⇒ 逐帧音量（乘淡入淡出）·都只排落在成品范围里的那截
    const [ca, cb] = [Math.max(0, -t0), s.length]
    if (s.curve && cb - ca > 1e-3) src.playbackRate.setValueCurveAtTime(rateCurve(s, ca, cb), t0 + ca, cb - ca)
    else src.playbackRate.value = s.speed
    if (s.env && cb - ca > 1e-3) g.gain.setValueCurveAtTime(gainCurve(s, ca, cb), t0 + ca, cb - ca)
    else {
      g.gain.setValueAtTime(s.fadeIn > 0 ? 0 : s.gain, Math.max(0, t0))
      if (s.fadeIn > 0) g.gain.linearRampToValueAtTime(s.gain, t0 + Math.min(s.fadeIn, s.length))
      if (s.fadeOut > 0) { g.gain.setValueAtTime(s.gain, Math.max(t0, t1 - s.fadeOut)); g.gain.linearRampToValueAtTime(0, t1) }
    }
    // 降噪／变调／声音效果／声道（同预览 buildAudioFx）→ 响度统一 → 音量
    const fx = buildAudioFx(ctx, s.aud)
    const ng = ctx.createGain()
    ng.gain.value = s.aud?.norm ? normGain(peaksFor(s.mediaId, b0), s.offset, s.offset + s.length * s.speed) : 1
    if (fx) { src.connect(fx.input); fx.output.connect(ng) } else src.connect(ng)
    ng.connect(g).connect(ctx.destination)
    // 片头在成品之前（t0<0）⇒ 从素材那一刻接着放（曲线变速照曲线算素材走到哪）
    const srcFrom = off + (ca > 0 ? (s.curve ? s.length * curveCum(s.curve, ca / s.length) : ca * s.speed) : 0)
    const srcLen = s.curve ? s.length * curveAvg(s.curve) : s.length * s.speed
    if (srcFrom >= b.duration) continue
    src.start(t0 + ca, srcFrom, Math.min(srcLen - (srcFrom - off), b.duration - srcFrom))
  }
  return { buffer: await ctx.startRendering(), seconds, skipped, failed }
}

/** 素材 from 秒起 seconds 秒那段倒过来（超出素材尾的部分不要）；一个取样都没有 ⇒ null */
export function reversedSlice(ctx: BaseAudioContext, b: AudioBuffer, from: number, seconds: number): AudioBuffer | null {
  const a = Math.max(0, Math.floor(from * b.sampleRate)), z = Math.min(b.length, Math.ceil((from + seconds) * b.sampleRate))
  if (z <= a) return null
  const out = ctx.createBuffer(b.numberOfChannels, z - a, b.sampleRate)
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const src = b.getChannelData(ch), dst = out.getChannelData(ch)
    for (let i = 0; i < z - a; i++) dst[i] = src[z - 1 - i]
  }
  return out
}

/** 曲线变速的播放速度（片段里 a～b 秒·每 1/50 秒一点） */
function rateCurve(s: SubSeg, a: number, b: number): Float32Array {
  const n = Math.max(2, Math.ceil((b - a) * 50) + 1)
  return Float32Array.from({ length: n }, (_, i) => { const x = (a + ((b - a) * i) / (n - 1)) / s.length; return Math.min(16, Math.max(0.0625, curveSpeedAt(s.curve!, x))) })
}
/** 音量关键帧的逐帧音量×淡入淡出（片段里 a～b 秒） */
function gainCurve(s: SubSeg, a: number, b: number): Float32Array {
  const env = s.env!, n = Math.max(2, Math.ceil((b - a) * 50) + 1)
  return Float32Array.from({ length: n }, (_, i) => {
    const tau = a + ((b - a) * i) / (n - 1)
    let j = 0
    while (j < env.length - 2 && env[j + 1][0] <= tau) j++
    const p = env[j], q = env[Math.min(env.length - 1, j + 1)]
    const g = q[0] > p[0] ? p[1] + ((q[1] - p[1]) * (tau - p[0])) / (q[0] - p[0]) : p[1]
    const fade = Math.min(1, s.fadeIn > 0 ? tau / s.fadeIn : 1, s.fadeOut > 0 ? (s.length - tau) / s.fadeOut : 1)
    return Math.max(0, g * Math.max(0, fade))
  })
}

/** 混一份子素材：回 WAV 位元组与长度（秒） */
export async function renderSubClip(plan: SubPlan, urlOf: (mediaId: string) => string | null): Promise<{ wav: Uint8Array; seconds: number; skipped: number }> {
  const { buffer: out, seconds, skipped } = await mixSubClip(plan, urlOf)
  return { wav: encodeWav([out.getChannelData(0), out.getChannelData(1)], SUB_SAMPLE_RATE), seconds, skipped }
}
