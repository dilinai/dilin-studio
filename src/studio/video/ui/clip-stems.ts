'use client'
// 网页剪辑页·时间轴片段右键「分离人声」的取声音与拆：
// ① decodeRange：素材解成 44.1kHz 立体声、只取那一截（长度照取样数截齐）；
// ② separateRange：有终端 ⇒ 那截存成 WAV 交给终端拆六轨（runShellJob·同编曲「交給終端」）⇒ 取回人声＋其余五轨加成伴奏；
//    没有 ⇒ 用编曲「拆人声」那支浏览器模型（SplitEngine／splitSong）拆成人声、纯伴奏。两条都回两份 WAV（长度跟那截一样·放回轨道才对得齐）。
import { encodeWav } from '../lib/arrange.pure'
import { ACCOMP_STEMS, fitLength, mixStems, stemsSampleCount } from '../lib/clip-stems.pure'
import type { MediaDevice } from '../lib/shell-media.pure'
import { SPLIT_SR } from '../lib/split.pure'
import { ShellJobError, type ShellPhase, type VeditShellApi } from '../lib/shell-job'
import { splitSong, type SplitEngine } from './split-client'

/** 素材解码（解成 44.1kHz）⇒ 从 from 秒起取 n 个取样（不够补零）·单声道复制成两边 */
export async function decodeRange(blob: Blob, from: number, n: number): Promise<[Float32Array, Float32Array]> {
  const ctx = new OfflineAudioContext(2, 1, SPLIT_SR)
  const ab = await ctx.decodeAudioData(await blob.arrayBuffer())
  const i0 = Math.max(0, Math.round(from * SPLIT_SR))
  const cut = (ch: Float32Array) => fitLength(ch.slice(i0, i0 + n), n)
  const L = cut(ab.getChannelData(0))
  return [L, ab.numberOfChannels > 1 ? cut(ab.getChannelData(1)) : L.slice()]
}

/** 跑着的样子：prep＝取声音·shell＝交终端（ShellPhase）·model／run＝浏览器拆（下载模型／第几块）·finish＝取回结果、加伴奏 */
export type ClipStemsPhase = { kind: 'prep' } | { kind: 'shell'; ph: ShellPhase } | { kind: 'model'; loaded: number; total: number } | { kind: 'run'; done: number; of: number } | { kind: 'finish' }
export type StemsVia = { shell: { dev: Pick<MediaDevice, 'role' | 'deviceId'>; put: (f: File, onP: (p: number) => void) => Promise<{ fileId: string; folderId: string | null }>; api: Pick<VeditShellApi, 'runShellJob' | 'fetchDriveBlob'> } } | { web: SplitEngine }

/** 拆那一截：回人声、伴奏两份 WAV（44.1kHz 立体声·长度＝那截的取样数）；cancelled() 真 ⇒ 抛 ShellJobError('cancelled') */
export async function separateRange(o: {
  blob: Blob; range: { from: number; to: number }; name: string; via: StemsVia
  onPhase: (p: ClipStemsPhase) => void; cancelled: () => boolean
}): Promise<{ vocals: Uint8Array; inst: Uint8Array }> {
  const stop = () => { if (o.cancelled()) throw new ShellJobError('cancelled') }
  const n = stemsSampleCount(o.range, SPLIT_SR)
  o.onPhase({ kind: 'prep' })
  const [L, R] = await decodeRange(o.blob, o.range.from, n)
  stop()
  if ('web' in o.via) {
    o.onPhase({ kind: 'model', loaded: 0, total: 0 })
    await o.via.web.load()
    stop()
    try {
      return await splitSong(o.via.web, L, R, { onStep: (done, of) => o.onPhase({ kind: 'run', done, of }), cancelled: o.cancelled })
    } catch (e) {
      if (o.cancelled() || (e as Error)?.message === 'cancelled') throw new ShellJobError('cancelled')
      throw e
    }
  }
  const file = new File([encodeWav([L, R], SPLIT_SR) as BlobPart], `${o.name}.wav`, { type: 'audio/wav' })
  const res = await o.via.shell.api.runShellJob({ dev: o.via.shell.dev, kind: 'stems', file, put: o.via.shell.put, onPhase: (ph) => o.onPhase({ kind: 'shell', ph }), cancelled: o.cancelled })
  if (res.kind !== 'stems') throw new ShellJobError('failed')
  stop()
  o.onPhase({ kind: 'finish' })
  const api = o.via.shell.api
  const one = async (id: string) => decodeRange(await api.fetchDriveBlob(id), 0, n)
  const [voc, ...rest] = await Promise.all([one(res.files.vocals), ...ACCOMP_STEMS.map((k) => one(res.files[k]))])
  stop()
  return { vocals: encodeWav(voc, SPLIT_SR), inst: encodeWav(mixStems(rest, n), SPLIT_SR) }
}
