// 编曲／拆曲「原曲＋分轨」进素材区：原曲已经在素材区 ⇒ 重用那一张（只补分轨）·⛔ 再加一张同名的
//   情形：拆曲面板另选一首（或同一首再拆一次）⇒ 原曲在素材区多出一张同名的。

/** 认得这份档的那几栏（File 也合这个形） */
export type FileSig = { name: string; size: number; lastModified: number }
export type ReuseCand = { id: string; name: string; stemOf?: string; stems?: readonly string[] }

/** 素材区里哪一张就是这份原曲：①同一个 File（汇入时存的原档）②名字＋大小＋修改时间都一样（又从电脑挑了同一份）
 *  ③名字＋大小一样且那张本来就是拆过的原曲（影片抽出来的 WAV 每次都是新做的·修改时间不同）。分轨本身不算。没有 ⇒ null */
export function reusableMix(media: readonly ReuseCand[], f: FileSig, fileOf: (id: string) => FileSig | undefined): string | null {
  for (const m of media) {
    if (m.stemOf || m.name !== f.name) continue
    const o = fileOf(m.id)
    if (!o) continue
    if (o === f) return m.id
    if (o.size !== f.size) continue
    if (o.lastModified === f.lastModified || (m.stems?.length ?? 0) > 0) return m.id
  }
  return null
}
