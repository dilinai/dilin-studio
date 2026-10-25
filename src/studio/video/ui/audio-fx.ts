'use client'
// 网页剪辑页·把片段的声音处理接成一串 Web Audio 节点：降噪 → 变调 → 声音效果 → 声道。
// 预览（页面的 AudioContext·影音元素接进来）与汇出（vedit-mix 的 OfflineAudioContext）都用这一支 buildAudioFx ⇒ 两边同一套声音。
// 参数与变调处理器原始码在 _lib/audio.pure.ts。变调要先 ensurePitchWorklet（每个 context 一次）；载不起来 ⇒ 跳过变调（其余照接）。
import { PITCH_PROCESSOR, PITCH_WORKLET_SRC, SFX_SPEC, audioFxActive, chanMatrix, denoiseFilters, driveCurve, hallImpulse, type ClipAudio } from '../lib/audio.pure'

const ready = new WeakMap<BaseAudioContext, Promise<boolean>>()
/** 变调处理器装进这个 context（装过就回同一个结果） */
export function ensurePitchWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = ready.get(ctx)
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) return false
      const url = URL.createObjectURL(new Blob([PITCH_WORKLET_SRC], { type: 'text/javascript' }))
      try { await ctx.audioWorklet.addModule(url); return true } catch { return false } finally { URL.revokeObjectURL(url) }
    })()
    ready.set(ctx, p)
  }
  return p
}
/** 已装好了吗（同步判·预览每帧用） */
const pitchOk = new WeakSet<BaseAudioContext>()
export async function warmPitch(ctx: BaseAudioContext) { if (await ensurePitchWorklet(ctx)) pitchOk.add(ctx) }

export type AudioFx = { input: AudioNode; output: AudioNode; dispose: () => void; pitched: boolean }
/** 照 a 接一串节点（没有要处理的 ⇒ null）；input 接来源·output 接音量节点 */
export function buildAudioFx(ctx: BaseAudioContext, a: ClipAudio | undefined | null): AudioFx | null {
  if (!audioFxActive(a)) return null
  const nodes: AudioNode[] = []
  const osc: OscillatorNode[] = []
  const add = <N extends AudioNode>(n: N) => { nodes.push(n); return n }
  const input = add(ctx.createGain())
  let cur: AudioNode = input
  const chain = (n: AudioNode) => { cur.connect(n); cur = n }
  if (a!.denoise) {
    const f = denoiseFilters(a!.denoise)
    const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = f.highpass; hp.Q.value = f.q; chain(hp)
    const lp = add(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = f.lowpass; lp.Q.value = f.q; chain(lp)
  }
  let pitched = false
  if (a!.semi && pitchOk.has(ctx)) {
    try {
      const w = add(new AudioWorkletNode(ctx, PITCH_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { semi: a!.semi } }))
      chain(w); pitched = true
    } catch { /* 处理器没装上 ⇒ 不变调 */ }
  }
  if (a!.sfx) {
    const s = SFX_SPEC[a!.sfx]
    if (s.kind === 'echo' || s.kind === 'hall') {
      const dry = add(ctx.createGain()), wet = add(ctx.createGain()), sum = add(ctx.createGain())
      dry.gain.value = 1 - s.wet * 0.4; wet.gain.value = s.wet
      cur.connect(dry).connect(sum)
      if (s.kind === 'echo') {
        const d = add(ctx.createDelay(2)); d.delayTime.value = s.delay
        const fb = add(ctx.createGain()); fb.gain.value = s.feedback
        cur.connect(d); d.connect(fb).connect(d); d.connect(wet)
      } else {
        const cv = add(ctx.createConvolver())
        const [l, r] = hallImpulse(ctx.sampleRate, s.seconds, s.decay) as [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]
        const ir = ctx.createBuffer(2, l.length, ctx.sampleRate); ir.copyToChannel(l, 0); ir.copyToChannel(r, 1)
        cv.buffer = ir; cur.connect(cv); cv.connect(wet)
      }
      wet.connect(sum); cur = sum
    } else if (s.kind === 'band') {
      const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = s.lo; chain(hp)
      const lp = add(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = s.hi; chain(lp)
      if (s.drive > 0) { const ws = add(ctx.createWaveShaper()); ws.curve = driveCurve(s.drive) as Float32Array<ArrayBuffer>; ws.oversample = '2x'; chain(ws) }
    } else if (s.kind === 'robot') {
      // 环形调制：声音乘上一支低频正弦（gain 吃振荡器）
      const rm = add(ctx.createGain()); rm.gain.value = 0
      const o = ctx.createOscillator(); o.frequency.value = s.freq; o.connect(rm.gain); o.start(); osc.push(o)
      chain(rm)
    } else {
      const lp = add(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = s.freq; lp.Q.value = s.q; chain(lp)
    }
  }
  if (a!.chan && a!.chan !== 'stereo') {
    const [ll, lr, rl, rr] = chanMatrix(a!.chan)
    const sp = add(ctx.createChannelSplitter(2)), mg = add(ctx.createChannelMerger(2))
    const up = add(ctx.createGain()); up.channelCount = 2; up.channelCountMode = 'explicit'; up.channelInterpretation = 'speakers' // 单声道素材先撑成两声道
    cur.connect(up).connect(sp)
    const route = (from: number, to: number, g: number) => { if (!g) return; const n = add(ctx.createGain()); n.gain.value = g; sp.connect(n, from); n.connect(mg, 0, to) }
    route(0, 0, ll); route(1, 0, lr); route(0, 1, rl); route(1, 1, rr)
    cur = mg
  }
  const output = cur
  return {
    input, output, pitched,
    dispose: () => { for (const o of osc) { try { o.stop() } catch { /* 已停 */ } } for (const n of nodes) { try { n.disconnect() } catch { /* 已断 */ } } },
  }
}
