// 网页剪辑页·编曲的钢琴发声：照 _lib/vedit-arrange.pure.ts 的 pianoVoice 参数用 Web Audio 叠泛音出声。
// 弹琴（即时）、播放（排程）、汇出（离线算成 WAV）都走同一支 strike ⇒ 三处同一个声音。
// 音频音轨：汇出时导入的声音照音轨音量直接混进去（不过琴的总音量与压缩）。
// 加笛子：strike 带乐器（piano／flute）与音量；笛子照 fluteVoice 吹（起音慢、按着一直响、气声、颤音）。
// 四种乐器都改放真乐器录音（SAMPLE_SETS·loadSamples）；
// 录音还没载好（或载不到）⇒ 照旧用上面合成的声音顶着（钢琴／越南筝＝合成钢琴·笛子／二胡＝合成笛子）·⛔ 不出声。汇出前先等录音载好。
import { SAMPLE_SETS, arrangeSeconds, audibleTracks, encodeWav, piecePlan, piecesOf, fluteVoice, nearestSample, pianoVoice, sampleUrl, stepSec, type Arrangement, type InstrumentId } from '../lib/arrange.pure'

export type Voice = { release: (at?: number) => void }

/** 主线：音量 → 压缩（多个音一起按不爆音）→ 出口 */
export function makeBus(ctx: BaseAudioContext): AudioNode {
  const g = ctx.createGain()
  g.gain.value = 0.32
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2
  g.connect(comp); comp.connect(ctx.destination)
  return g
}

let noiseBuf: { ctx: BaseAudioContext; buf: AudioBuffer } | null = null
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.ctx === ctx) return noiseBuf.buf
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  noiseBuf = { ctx, buf }
  return buf
}

// ── 真乐器录音：每种乐器整组载一次（解好的声音放记忆体·弹的、播的、汇出的共用·AudioBuffer 不绑音讯环境）──
const sampleBufs = new Map<string, AudioBuffer>()
const sampleLoads = new Map<InstrumentId, Promise<boolean>>()
const sampleKey = (inst: InstrumentId, midi: number) => `${inst}:${midi}`
/** 这种乐器的录音载好了没 */
export const samplesReady = (inst: InstrumentId): boolean => SAMPLE_SETS[inst].notes.every((n) => sampleBufs.has(sampleKey(inst, n)))
/** 载这种乐器的录音（同一种只载一次·载不到 ⇒ false·下次再叫会重试） */
export function loadSamples(inst: InstrumentId): Promise<boolean> {
  if (samplesReady(inst)) return Promise.resolve(true)
  const had = sampleLoads.get(inst)
  if (had) return had
  const job = (async () => {
    const C = typeof OfflineAudioContext === 'undefined' ? null : OfflineAudioContext
    if (!C || typeof fetch === 'undefined') return false
    const dec = new C(1, 1, 44100)
    const ok = await Promise.all(SAMPLE_SETS[inst].notes.map(async (n) => {
      if (sampleBufs.has(sampleKey(inst, n))) return true
      try {
        const r = await fetch(sampleUrl(inst, n))
        if (!r.ok) return false
        sampleBufs.set(sampleKey(inst, n), await dec.decodeAudioData(await r.arrayBuffer()))
        return true
      } catch { return false }
    }))
    return ok.every(Boolean)
  })()
  sampleLoads.set(inst, job)
  void job.then((ok) => { if (!ok) sampleLoads.delete(inst) })
  return job
}

/** 录音整体音量（录音都调到跟钢琴录音一样响·再接主线的总音量与压缩） */
const SAMPLE_GAIN = 4.2

/** 放一个录音音：最近那个录音调速补到 p；力度管大小；敲／拨的放开收得慢、吹／拉的放开就收 */
function playSample(ctx: BaseAudioContext, out: AudioNode, inst: InstrumentId, p: number, vel: number, t0: number, dur: number | undefined, gain: number): Voice | null {
  const set = SAMPLE_SETS[inst]
  const { midi, rate } = nearestSample(inst, p)
  const buf = sampleBufs.get(sampleKey(inst, midi))
  if (!buf) return null
  const src = ctx.createBufferSource()
  src.buffer = buf; src.playbackRate.value = rate
  const peak = SAMPLE_GAIN * set.gain * (0.3 + 0.7 * Math.max(0, Math.min(1, vel))) * gain
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, t0)
  amp.gain.linearRampToValueAtTime(peak, t0 + 0.004)
  src.connect(amp); amp.connect(out)
  src.start(t0)
  const natural = t0 + buf.duration / rate
  let done = false
  const release = (at?: number) => {
    if (done) return
    done = true
    const tr = Math.max(t0 + 0.01, at ?? ctx.currentTime)
    if (tr >= natural) return
    amp.gain.cancelScheduledValues(tr)
    amp.gain.setValueAtTime(peak, tr)
    amp.gain.setTargetAtTime(0, tr, set.release / 3)
    src.stop(Math.min(natural, tr + set.release * 3))
  }
  if (dur !== undefined) release(t0 + Math.max(0.03, dur))
  return { release }
}
/** 出一个音：t0 起响；dur 给了 ⇒ 到时自己放开（播放／汇出）；没给 ⇒ 等 release()（即时弹）；inst＝乐器；gain＝音轨音量 */
export function strike(ctx: BaseAudioContext, out: AudioNode, p: number, vel: number, t0: number, dur?: number, inst: InstrumentId = 'piano', gain = 1): Voice {
  const real = playSample(ctx, out, inst, p, vel, t0, dur, gain)
  if (real) return real
  if (inst === 'flute' || inst === 'erhu') return blow(ctx, out, p, vel, t0, dur, gain)
  const vc = pianoVoice(p, vel)
  const amp = ctx.createGain()
  amp.gain.value = gain
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.Q.value = 0.4
  lp.frequency.setValueAtTime(vc.cutoff0, t0)
  lp.frequency.setTargetAtTime(vc.cutoff1, t0 + 0.01, 0.35)
  lp.connect(amp); amp.connect(out)
  const oscs: OscillatorNode[] = []
  const gains: GainNode[] = []
  const peak = 0.55 * vel
  for (const pt of vc.partials) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = vc.freq * pt.ratio
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak * pt.gain, t0 + vc.attack)
    g.gain.setTargetAtTime(0, t0 + vc.attack, pt.decay / 3)
    o.connect(g); g.connect(lp)
    o.start(t0)
    oscs.push(o); gains.push(g)
  }
  // 琴槌敲弦那一下的「咚」：一小段滤过的杂音
  if (vc.hammer > 0) {
    const n = ctx.createBufferSource()
    n.buffer = noise(ctx)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, vc.freq * 4); bp.Q.value = 1.2
    const ng = ctx.createGain()
    ng.gain.value = vc.hammer
    n.connect(bp); bp.connect(ng); ng.connect(amp)
    n.start(t0)
  }
  let done = false
  const release = (at?: number) => {
    if (done) return
    done = true
    const tr = Math.max(t0 + vc.attack, at ?? ctx.currentTime)
    amp.gain.cancelScheduledValues(tr)
    amp.gain.setValueAtTime(gain, tr)
    amp.gain.setTargetAtTime(0, tr, vc.release / 3)
    for (const o of oscs) o.stop(tr + vc.release * 2.5)
  }
  if (dur !== undefined) release(t0 + Math.max(0.03, dur))
  return { release }
}

let breathBuf: { ctx: BaseAudioContext; buf: AudioBuffer } | null = null
/** 一秒长、能循环的白杂音（笛子的气声） */
function breathNoise(ctx: BaseAudioContext): AudioBuffer {
  if (breathBuf && breathBuf.ctx === ctx) return breathBuf.buf
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  breathBuf = { ctx, buf }
  return buf
}

/** 吹一个笛子音（参数见 fluteVoice）：起音慢慢吹起来·按着一直响·颤音晚一点才进来·一直带一点气声 */
function blow(ctx: BaseAudioContext, out: AudioNode, p: number, vel: number, t0: number, dur: number | undefined, gain: number): Voice {
  const vc = fluteVoice(p, vel)
  const peak = 0.5 * Math.max(0.05, vel) * gain
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, t0)
  amp.gain.linearRampToValueAtTime(peak, t0 + vc.attack)
  amp.gain.setTargetAtTime(peak * vc.sustain, t0 + vc.attack, 0.12)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'; lp.frequency.value = vc.cutoff; lp.Q.value = 0.5
  lp.connect(amp); amp.connect(out)
  // 颤音：一支低频振荡接到每个泛音的频率上（深度照泛音倍数放大）·吹一会儿才渐渐出来
  const lfo = ctx.createOscillator()
  lfo.frequency.value = vc.vibratoHz
  const lfoAmt = ctx.createGain()
  lfoAmt.gain.setValueAtTime(0, t0)
  lfoAmt.gain.setValueAtTime(0, t0 + vc.vibratoDelay)
  lfoAmt.gain.linearRampToValueAtTime(vc.freq * vc.vibratoDepth, t0 + vc.vibratoDelay + 0.35)
  lfo.connect(lfoAmt)
  const srcs: AudioScheduledSourceNode[] = [lfo]
  for (const pt of vc.partials) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = vc.freq * pt.ratio
    const k = ctx.createGain(); k.gain.value = pt.ratio
    lfoAmt.connect(k); k.connect(o.frequency)
    const g = ctx.createGain(); g.gain.value = pt.gain
    o.connect(g); g.connect(lp)
    srcs.push(o)
  }
  // 气声：滤过的杂音·起音那一下多一点（吹口的「噗」）
  const n = ctx.createBufferSource()
  n.buffer = breathNoise(ctx); n.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, vc.freq * 2); bp.Q.value = 0.8
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(vc.breath * 3, t0)
  ng.gain.setTargetAtTime(vc.breath, t0 + vc.attack, 0.05)
  n.connect(bp); bp.connect(ng); ng.connect(amp)
  srcs.push(n)
  for (const s of srcs) s.start(t0)
  let done = false
  const release = (at?: number) => {
    if (done) return
    done = true
    const tr = Math.max(t0 + 0.02, at ?? ctx.currentTime)
    amp.gain.cancelScheduledValues(tr)
    amp.gain.setValueAtTime(peak * vc.sustain, tr)
    amp.gain.setTargetAtTime(0, tr, vc.release / 3)
    for (const s of srcs) s.stop(tr + vc.release * 3)
  }
  if (dur !== undefined) release(t0 + Math.max(0.05, dur))
  return { release }
}

/** 节拍器一下（重拍高一点） */
export function click(ctx: BaseAudioContext, out: AudioNode, t0: number, accent: boolean): void {
  const o = ctx.createOscillator()
  o.type = 'square'; o.frequency.value = accent ? 1760 : 1175
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(accent ? 0.18 : 0.1, t0 + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05)
  o.connect(g); g.connect(out)
  o.start(t0); o.stop(t0 + 0.06)
}

/** 离线把整首算成 WAV（汇出放进轨道）；clips＝音频音轨解好的声音（按档编号） */
export async function renderWav(a: Arrangement, seconds: number, clips?: ReadonlyMap<string, AudioBuffer>, sampleRate = 44100): Promise<Uint8Array> {
  const len = Math.max(1, Math.ceil(seconds * sampleRate))
  await Promise.all([...new Set(audibleTracks(a).filter((x) => x.notes.length).map((x) => x.inst))].map(loadSamples)) // 汇出前先把用到的录音载好
  const ctx = new OfflineAudioContext(2, len, sampleRate)
  const bus = makeBus(ctx)
  const st = stepSec(a.bpm)
  for (const tr of audibleTracks(a)) for (const n of tr.notes) strike(ctx, bus, n.p, n.v, n.s * st, n.l * st, tr.inst, tr.vol)
  const end = arrangeSeconds(a)
  // 音频轨剪成好几段 ⇒ 一段一段放（各自从档里第 off 秒起）
  for (const tr of audibleTracks(a)) {
    const b = tr.audio ? clips?.get(tr.audio.file) : undefined
    if (!b) continue
    const g = ctx.createGain()
    g.gain.value = tr.vol; g.connect(ctx.destination)
    for (const pc of piecesOf(tr)) {
      const plan = piecePlan(pc, 0, end)
      if (!plan) continue
      const src = ctx.createBufferSource()
      src.buffer = b; src.connect(g)
      src.start(plan.delay, plan.offset, plan.len)
    }
  }
  const buf = await ctx.startRendering()
  return encodeWav([buf.getChannelData(0), buf.getChannelData(1)], sampleRate)
}
