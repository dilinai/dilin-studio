// 表格图工具：从图档开头几 KB 读出真实宽高（PNG／JPEG／GIF／WebP）·纯函数（题直测）。
// 读不出 ⇒ null（调用方用缺省 200×150）。⛔ 解整张图。
export function imageDims(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1]
  const u16le = (i: number) => b[i] | (b[i + 1] << 8)
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null)
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(u32be(16), u32be(20))
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(u16le(6), u16le(8))
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8X') return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)))
    if (kind === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
    if (kind === 'VP8L') { const x = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return ok((x & 0x3fff) + 1, ((x >> 14) & 0x3fff) + 1) }
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue }
      const len = u16be(i + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(i + 7), u16be(i + 5))
      i += 2 + len
    }
  }
  return null
}

/** 放进表格的缺省大小：最宽 320（同网页工具栏插图 IMAGE_MAX_W）·等比缩·不小于 16 */
export function fitImageSize(d: { w: number; h: number } | null, maxW = 320): { w: number; h: number } {
  if (!d) return { w: 200, h: 150 }
  const k = Math.min(1, maxW / d.w)
  return { w: Math.max(16, Math.min(4000, Math.round(d.w * k))), h: Math.max(16, Math.min(4000, Math.round(d.h * k))) }
}
