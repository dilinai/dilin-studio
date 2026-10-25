// 网页剪辑页·素材区「音频」页签的内建音效（剪映「音频 › 音效素材」）：自己写的合成音效（不用素材档·浏览器里当场算成 WAV）。
// 每一款＝一支「取样率 ⇒ 单声道 PCM（-1..1）」的纯函数·固定种子（每次算出来一样）。点一款 ⇒ 页面算成 WAV、照本机汇入那条路进素材区、放在播放头的音频轨。
// 录音（麦克风）也在这一页·画在 video-edit/VeditAudioLib.tsx。⛔ 碰 DOM。

import { encodeWav } from './wav'

export type SfxCat = 'transition' | 'ui' | 'impact' | 'mood'
export type SfxDef = { id: string; cat: SfxCat; name: { tw: string; cn: string; en: string }; seconds: number; f: (sr: number) => Float32Array }

const TAU = Math.PI * 2
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1 } }
const buf = (sr: number, sec: number) => new Float32Array(Math.max(1, Math.round(sr * sec)))
/** 一阶低通（噪声上色用） */
function lp(x: number, st: { y: number }, a: number) { st.y += a * (x - st.y); return st.y }
/** 把最大值拉到 peak（避免破音） */
function norm(b: Float32Array, peak = 0.9) { let m = 0; for (const v of b) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < b.length; i++) b[i] = (b[i] / m) * peak; return b }
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d))

export const SFX_LIB: readonly SfxDef[] = [
  { id: 'whoosh', cat: 'transition', name: { tw: '咻（轉場）', cn: '咻（转场）', en: 'Whoosh' }, seconds: 0.9, f: (sr) => {
    const b = buf(sr, 0.9), r = rng(7), st = { y: 0 }
    for (let i = 0; i < b.length; i++) { const t = i / sr, p = t / 0.9; const cut = 0.02 + 0.25 * Math.sin(Math.PI * p); b[i] = lp(r(), st, cut) * Math.sin(Math.PI * p) ** 2 }
    return norm(b)
  } },
  { id: 'swoosh-up', cat: 'transition', name: { tw: '上揚', cn: '上扬', en: 'Riser' }, seconds: 1.6, f: (sr) => {
    const b = buf(sr, 1.6), r = rng(11), st = { y: 0 }
    let ph = 0
    for (let i = 0; i < b.length; i++) { const t = i / sr, p = t / 1.6; ph += (TAU * (200 + 1400 * p * p)) / sr; b[i] = (0.5 * Math.sin(ph) + 0.5 * lp(r(), st, 0.05 + 0.4 * p)) * p * p * (p > 0.95 ? (1 - p) / 0.05 : 1) }
    return norm(b)
  } },
  { id: 'swish', cat: 'transition', name: { tw: '刷（快速）', cn: '刷（快速）', en: 'Swish' }, seconds: 0.35, f: (sr) => {
    const b = buf(sr, 0.35), r = rng(3), st = { y: 0 }
    for (let i = 0; i < b.length; i++) { const p = i / b.length; b[i] = (r() - lp(r(), st, 0.3)) * Math.sin(Math.PI * p) ** 3 }
    return norm(b)
  } },
  { id: 'ding', cat: 'ui', name: { tw: '叮', cn: '叮', en: 'Ding' }, seconds: 1.4, f: (sr) => {
    const b = buf(sr, 1.4)
    for (let i = 0; i < b.length; i++) { const t = i / sr; b[i] = (Math.sin(TAU * 1318.5 * t) + 0.45 * Math.sin(TAU * 2637 * t) + 0.2 * Math.sin(TAU * 3955.5 * t)) * env(t, 0.004, 0.35) }
    return norm(b, 0.8)
  } },
  { id: 'pop', cat: 'ui', name: { tw: '啵', cn: '啵', en: 'Pop' }, seconds: 0.18, f: (sr) => {
    const b = buf(sr, 0.18); let ph = 0
    for (let i = 0; i < b.length; i++) { const t = i / sr; ph += (TAU * (900 * Math.exp(-t * 40) + 180)) / sr; b[i] = Math.sin(ph) * env(t, 0.002, 0.03) }
    return norm(b)
  } },
  { id: 'click', cat: 'ui', name: { tw: '喀（點擊）', cn: '咔（点击）', en: 'Click' }, seconds: 0.06, f: (sr) => {
    const b = buf(sr, 0.06), r = rng(5)
    for (let i = 0; i < b.length; i++) { const t = i / sr; b[i] = (0.6 * r() + Math.sin(TAU * 2400 * t)) * env(t, 0.0005, 0.006) }
    return norm(b, 0.7)
  } },
  { id: 'shutter', cat: 'ui', name: { tw: '快門', cn: '快门', en: 'Shutter' }, seconds: 0.25, f: (sr) => {
    const b = buf(sr, 0.25), r = rng(9), st = { y: 0 }
    for (let i = 0; i < b.length; i++) { const t = i / sr; b[i] = lp(r(), st, 0.5) * (env(t, 0.001, 0.015) + 0.8 * (t > 0.09 ? env(t - 0.09, 0.001, 0.02) : 0)) }
    return norm(b)
  } },
  { id: 'type', cat: 'ui', name: { tw: '打字', cn: '打字', en: 'Typing' }, seconds: 1.5, f: (sr) => {
    const b = buf(sr, 1.5), r = rng(21), hits = [0.02, 0.15, 0.27, 0.36, 0.52, 0.61, 0.74, 0.9, 1.01, 1.14, 1.22, 1.38]
    for (let i = 0; i < b.length; i++) { const t = i / sr; let v = 0; for (const h of hits) if (t >= h && t < h + 0.03) v += r() * env(t - h, 0.0005, 0.005) + 0.5 * Math.sin(TAU * 1800 * (t - h)) * env(t - h, 0.0005, 0.003); b[i] = v }
    return norm(b, 0.7)
  } },
  { id: 'boom', cat: 'impact', name: { tw: '轟（重擊）', cn: '轰（重击）', en: 'Boom' }, seconds: 2, f: (sr) => {
    const b = buf(sr, 2), r = rng(13), st = { y: 0 }; let ph = 0
    for (let i = 0; i < b.length; i++) { const t = i / sr; ph += (TAU * (40 + 90 * Math.exp(-t * 8))) / sr; b[i] = Math.sin(ph) * env(t, 0.003, 0.5) + 0.5 * lp(r(), st, 0.04) * env(t, 0.002, 0.25) }
    return norm(b)
  } },
  { id: 'hit', cat: 'impact', name: { tw: '咚（打擊）', cn: '咚（打击）', en: 'Hit' }, seconds: 0.6, f: (sr) => {
    const b = buf(sr, 0.6), r = rng(17); let ph = 0
    for (let i = 0; i < b.length; i++) { const t = i / sr; ph += (TAU * (60 + 140 * Math.exp(-t * 30))) / sr; b[i] = Math.sin(ph) * env(t, 0.001, 0.12) + 0.3 * r() * env(t, 0.0005, 0.01) }
    return norm(b)
  } },
  { id: 'glitch', cat: 'impact', name: { tw: '故障', cn: '故障', en: 'Glitch' }, seconds: 0.5, f: (sr) => {
    const b = buf(sr, 0.5), r = rng(29)
    let hold = 0, v = 0
    for (let i = 0; i < b.length; i++) { if (--hold <= 0) { hold = Math.floor(sr * (0.004 + 0.02 * Math.abs(r()))); v = Math.sign(r()) * (0.3 + 0.7 * Math.abs(r())) } b[i] = v * Math.sin(TAU * (i / sr) * (300 + 2000 * Math.abs(v))) }
    return norm(b, 0.6)
  } },
  { id: 'heartbeat', cat: 'mood', name: { tw: '心跳', cn: '心跳', en: 'Heartbeat' }, seconds: 1.6, f: (sr) => {
    const b = buf(sr, 1.6)
    for (let i = 0; i < b.length; i++) { const t = i / sr; let v = 0; for (const [h, a] of [[0.05, 1], [0.32, 0.7], [0.85, 1], [1.12, 0.7]] as const) if (t >= h) v += a * Math.sin(TAU * 55 * (t - h)) * env(t - h, 0.004, 0.06); b[i] = v }
    return norm(b)
  } },
  { id: 'sparkle', cat: 'mood', name: { tw: '閃亮', cn: '闪亮', en: 'Sparkle' }, seconds: 1.4, f: (sr) => {
    const b = buf(sr, 1.4), notes = [2093, 2637, 3136, 3951, 4186, 3136, 3951]
    for (let i = 0; i < b.length; i++) { const t = i / sr; let v = 0; notes.forEach((f, k) => { const h = k * 0.12; if (t >= h) v += Math.sin(TAU * f * (t - h)) * env(t - h, 0.002, 0.18) }); b[i] = v }
    return norm(b, 0.6)
  } },
  { id: 'wind', cat: 'mood', name: { tw: '風聲', cn: '风声', en: 'Wind' }, seconds: 4, f: (sr) => {
    const b = buf(sr, 4), r = rng(31), st = { y: 0 }, st2 = { y: 0 }
    for (let i = 0; i < b.length; i++) { const t = i / sr; const g = 0.5 + 0.5 * Math.sin(TAU * 0.35 * t) * Math.sin(TAU * 0.13 * t + 1); b[i] = (lp(r(), st, 0.03 + 0.04 * g) - 0.5 * lp(r(), st2, 0.005)) * g * Math.min(1, t / 0.4, (4 - t) / 0.4) }
    return norm(b, 0.7)
  } },
]
export const SFX_CATS: readonly SfxCat[] = ['transition', 'ui', 'impact', 'mood']
export const sfxById = (id: string) => SFX_LIB.find((s) => s.id === id)
export const sfxIn = (cat: SfxCat) => SFX_LIB.filter((s) => s.cat === cat)
/** 合成音效的取样率 */
export const SFX_RATE = 44100
/** 一款音效算成 WAV 位元组（同页面音频页签：单声道 PCM 复制成两声道·SFX_RATE）——服务端 sfx.add 也用这支 */
export function sfxWav(id: string): Uint8Array | null {
  const d = sfxById(id)
  if (!d) return null
  const pcm = d.f(SFX_RATE)
  return encodeWav([pcm, pcm], SFX_RATE)
}
