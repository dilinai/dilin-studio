// WAV 编码（16 位 PCM·小端）：几条声道交错写进一份 .wav。
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const ch = Math.max(1, channels.length)
  const len = channels[0]?.length ?? 0
  const data = len * ch * 2
  const buf = new ArrayBuffer(44 + data)
  const dv = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + data, true); str(8, 'WAVE')
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true)
  str(36, 'data'); dv.setUint32(40, data, true)
  let o = 44
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const x = clamp(channels[c]?.[i] ?? 0, -1, 1)
    dv.setInt16(o, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true); o += 2
  }
  return new Uint8Array(buf)
}
