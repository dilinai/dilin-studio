// 网页剪辑页·片段的声音处理（剪映右栏「音频」页）：
// 降噪（滤掉低频嗡嗡声与高频嘶声）、响度统一（照波形峰值表估这段的响度·拉到同一个目标）、变调（不改速度·半音 -12～12）、
// 声道（立体声／只留左／只留右／合成单声道／左右对调）、声音效果（回声、大厅、电话、收音机、机器人、水下、扩音器）。
// 这里只放「参数怎么算」的纯函数与变调处理器的原始码（字串·题里 new Function 跑、页面塞进 AudioWorklet）；
// 真的接 Web Audio 节点在 video-edit/vedit-audio-fx.ts（预览 AudioContext 与汇出 OfflineAudioContext 用同一支 buildAudioFx）。⛔ 碰 DOM。

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const AUDIO_CHANS = ['stereo', 'left', 'right', 'mono', 'swap'] as const
export type AudioChan = (typeof AUDIO_CHANS)[number]
export const AUDIO_SFX = ['echo', 'hall', 'phone', 'radio', 'robot', 'underwater', 'megaphone'] as const
export type AudioSfx = (typeof AUDIO_SFX)[number]
/** denoise 0～100（0＝关）·norm＝响度统一·semi＝变调半音 -12～12·chan＝声道·sfx＝声音效果（缺＝没有） */
export type ClipAudio = { denoise?: number; norm?: boolean; semi?: number; chan?: AudioChan; sfx?: AudioSfx }

/** 验值：全缺省 ⇒ undefined（不存） */
export function parseAudio(v: unknown): ClipAudio | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const a: ClipAudio = {}
  const dn = Math.round(clamp(num(o.denoise) ?? 0, 0, 100)); if (dn) a.denoise = dn
  if (o.norm === true) a.norm = true
  const st = Math.round(clamp(num(o.semi) ?? 0, -12, 12)); if (st) a.semi = st
  if ((AUDIO_CHANS as readonly string[]).includes(String(o.chan)) && o.chan !== 'stereo') a.chan = o.chan as AudioChan
  if ((AUDIO_SFX as readonly string[]).includes(String(o.sfx))) a.sfx = o.sfx as AudioSfx
  return Object.keys(a).length ? a : undefined
}
/** 一笔改动并上去（null／缺省值＝拿掉那一项） */
export function mergeAudio(cur: ClipAudio | undefined, p: Partial<Record<keyof ClipAudio, unknown>> | null): ClipAudio | undefined {
  if (p === null) return undefined
  const o: Record<string, unknown> = { ...(cur ?? {}) }
  for (const [k, v] of Object.entries(p)) { if (v === undefined) continue; if (v === null) delete o[k]; else o[k] = v }
  return parseAudio(o)
}
/** 要不要接节点（响度统一只乘音量·不用接） */
export const audioFxActive = (a: ClipAudio | undefined | null) => !!a && (!!a.denoise || !!a.semi || (!!a.chan && a.chan !== 'stereo') || !!a.sfx)
/** 节点链的指纹（预览换链才重接） */
export const audioFxKey = (a: ClipAudio | undefined | null) => (audioFxActive(a) ? `${a!.denoise ?? 0}|${a!.semi ?? 0}|${a!.chan ?? 'stereo'}|${a!.sfx ?? ''}` : '')

// ── 降噪：高通把低频嗡嗡声（冷气、电流）切掉·低通把高频嘶声压下（越强切越多） ──
export const denoiseFilters = (amount: number) => {
  const a = clamp(amount, 0, 100) / 100
  return { highpass: Math.round(60 + a * 140), lowpass: Math.round(16000 - a * 9000), q: 0.707 }
}

// ── 响度统一：照波形峰值表（vedit-timeline PEAKS_PER_SEC 格）这段的峰值算均方根当响度·乘到目标·夹在 0.25～4 倍 ──
export const NORM_TARGET = 0.25
/** peaks＝素材整份峰值表（每格 0..1）·from／to＝这段用到素材第几秒到第几秒；没有声音 ⇒ 1 */
export function normGain(peaks: ArrayLike<number> | null | undefined, from: number, to: number, perSec = 50): number {
  if (!peaks || !peaks.length) return 1
  const a = Math.max(0, Math.floor(Math.min(from, to) * perSec)), z = Math.min(peaks.length, Math.ceil(Math.max(from, to) * perSec))
  let s = 0, n = 0
  for (let i = a; i < z; i++) { const p = peaks[i]; if (p > 0.003) { s += p * p; n++ } } // 静音的格不算（不然有停顿的被拉太大）
  if (!n) return 1
  const rms = Math.sqrt(s / n)
  return Math.round(clamp(NORM_TARGET / rms, 0.25, 4) * 1000) / 1000
}

// ── 声道：输出左／右各取输入左／右几成（2×2 矩阵·[LL, LR, RL, RR]＝左出取左入、左出取右入、右出取左入、右出取右入） ──
export function chanMatrix(c: AudioChan | undefined): [number, number, number, number] {
  switch (c) {
    case 'left': return [1, 0, 1, 0]
    case 'right': return [0, 1, 0, 1]
    case 'mono': return [0.5, 0.5, 0.5, 0.5]
    case 'swap': return [0, 1, 1, 0]
    default: return [1, 0, 0, 1]
  }
}

// ── 声音效果参数（节点照这份接） ──
export type SfxSpec =
  | { kind: 'echo'; delay: number; feedback: number; wet: number }
  | { kind: 'hall'; seconds: number; decay: number; wet: number }
  | { kind: 'band'; lo: number; hi: number; drive: number; wet: 1 }
  | { kind: 'robot'; freq: number }
  | { kind: 'lowpass'; freq: number; q: number }
export const SFX_SPEC: Record<AudioSfx, SfxSpec> = {
  echo: { kind: 'echo', delay: 0.28, feedback: 0.42, wet: 0.45 },
  hall: { kind: 'hall', seconds: 2.4, decay: 2.6, wet: 0.4 },
  phone: { kind: 'band', lo: 300, hi: 3400, drive: 0.15, wet: 1 },
  radio: { kind: 'band', lo: 500, hi: 2800, drive: 0.45, wet: 1 },
  robot: { kind: 'robot', freq: 55 },
  underwater: { kind: 'lowpass', freq: 450, q: 6 },
  megaphone: { kind: 'band', lo: 700, hi: 3000, drive: 0.8, wet: 1 },
}
/** 大厅的回响（固定种子的衰减杂讯·两次算出来一样 ⇒ 预览与成片同一份） */
export function hallImpulse(sampleRate: number, seconds: number, decay: number): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(sampleRate * seconds))
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)]
  for (let ch = 0; ch < 2; ch++) {
    let s = 0x9e3779b9 ^ (ch * 0x85ebca6b)
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5
      const r = ((s >>> 0) / 4294967296) * 2 - 1
      out[ch][i] = r * Math.pow(1 - i / n, decay)
    }
  }
  return out
}
/** 失真曲线（收音机、扩音器那种破音） */
export function driveCurve(drive: number, n = 1024): Float32Array {
  const k = clamp(drive, 0, 1) * 50
  return Float32Array.from({ length: n }, (_, i) => { const x = (i / (n - 1)) * 2 - 1; return k ? ((1 + k) * x) / (1 + k * Math.abs(x)) : x })
}

// ── 变调（不改速度）：两个读头在一段延迟线里滑·交叉淡入淡出（sin²／cos²·加起来＝1）——经典「延迟线变调」·预览与汇出同一份 ──
/** 处理器原始码（纯 JS 字串·⛔ 引外部东西）：makeShifter(采样率) ⇒ { process(输入, 输出, 半音) } */
export const PITCH_DSP_SRC = `function makeShifter(sr) {
  var W = Math.max(64, Math.round(sr * 0.06)), N = W * 2 + 4, buf = new Float32Array(N), wp = 0, phase = 0
  function read(d) { var p = wp - 1 - d; while (p < 0) p += N; var i = Math.floor(p), f = p - i, a = buf[i % N], b = buf[(i + 1) % N]; return a + (b - a) * f }
  return { process: function (inp, out, semi) {
    var ratio = Math.pow(2, semi / 12), step = (1 - ratio) / W
    for (var k = 0; k < out.length; k++) {
      buf[wp] = inp ? (inp[k] || 0) : 0; wp = (wp + 1) % N
      if (semi === 0) { out[k] = buf[(wp - 1 + N) % N]; continue }
      phase += step; phase -= Math.floor(phase)
      var p2 = phase + 0.5; p2 -= Math.floor(p2)
      var s = Math.sin(Math.PI * phase), g1 = s * s
      out[k] = g1 * read(phase * W) + (1 - g1) * read(p2 * W)
    }
  } }
}`
/** AudioWorklet 那份（每个声道各一只 shifter·参数 semi） */
export const PITCH_WORKLET_SRC = `${PITCH_DSP_SRC}
class DilinPitch extends AudioWorkletProcessor {
  constructor(o) { super(); this.semi = (o && o.processorOptions && o.processorOptions.semi) || 0; this.sh = [] }
  process(inputs, outputs) {
    var inp = inputs[0] || [], out = outputs[0] || []
    for (var c = 0; c < out.length; c++) { if (!this.sh[c]) this.sh[c] = makeShifter(sampleRate); this.sh[c].process(inp[c] || inp[0], out[c], this.semi) }
    return true
  }
}
registerProcessor('dilin-pitch', DilinPitch)`
export const PITCH_PROCESSOR = 'dilin-pitch'
