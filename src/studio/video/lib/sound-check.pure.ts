// 素材声音解不解得开（纯函数·页面与测试共用）：汇入时探一次声音轨、算波形时再看一次，解不开 ⇒ 素材标「无声」＋提示一次。
//   探测本身在 opfs-cache（probeSound／makePeaks·要浏览器的 AudioDecoder 与 mediabunny）；这里只管判定与「同一份只提示一次」。

/** 声音轨探测结果：ok＝能解；none＝档里没有声音轨（或整个读不出格式）；undecodable＝有声音轨但这台浏览器解不开（或解出 0 个样本）；unknown＝没法判断（没有 AudioDecoder、读档失败等·不提示） */
export type SoundProbe = 'ok' | 'none' | 'undecodable' | 'unknown'

/** 解不开提示停留的毫秒数（一般提示 4 秒就收·这句要使用者去转档，留久一点） */
export const SOUND_NOTICE_MS = 12000

/** 这份素材该不该标「声音解不开」：有声音轨却解不开 ⇒ 是；音频档连声音轨都读不到（坏档／副档名不对）⇒ 也是；影片没声音轨是常态 ⇒ 不算 */
export function soundUndecodable(kind: 'video' | 'audio' | 'image', probe: SoundProbe): boolean {
  if (kind === 'image') return false
  if (probe === 'undecodable') return true
  return kind === 'audio' && probe === 'none'
}

/** 一路解下来的样本格数 ⇒ 结果：一格都没解出来（解码器不报错却回空）当解不开 */
export function decodedProbe(frames: number): SoundProbe {
  return frames > 0 ? 'ok' : 'undecodable'
}

/** 同一条素材（key＝素材编号）只提示一次：第一次回 true 并记下，之后回 false；重试时先 seen.delete(key) 再判 */
export function firstSoundWarn(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
