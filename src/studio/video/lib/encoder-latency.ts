// 网页剪辑页·转预览档时让 Safari（WebKit）的 H.264 编码器走低延迟模式（一直不动）。
// 根因同汇出那边（export.pure exportLatencyMode）：Safari 的 H.264 编码器默认 'quality' 吃进几帧就不再出帧、flush 永不回；
// 汇出自己建编码器能直接带 latencyMode，转预览档走 mediabunny Conversion·它不给这一格 ⇒ 转档那段时间把 VideoEncoder.configure 包一层：
// 设定没写 latencyMode 就补 'realtime'（写了的照原样）·只在 WebKit 上包·转完（含多份同时转）最后一份放手就还原。Chrome／Edge／Firefox 不动。
import { exportLatencyMode, withLatencyMode } from './export.pure'

type EncCtor = { prototype: { configure: (cfg: VideoEncoderConfig) => void } }
let holders = 0
let original: ((cfg: VideoEncoderConfig) => void) | null = null
let patchedOn: EncCtor | null = null

/** 开始转档前调·回一个放手函数（转完必调·调多次只算一次） */
export function holdEncoderLatency(ua: string, Enc: EncCtor | undefined = (globalThis as { VideoEncoder?: EncCtor }).VideoEncoder): () => void {
  const mode = exportLatencyMode(ua)
  if (!mode || !Enc) return () => {}
  if (holders++ === 0) {
    const orig = Enc.prototype.configure
    original = orig; patchedOn = Enc
    Enc.prototype.configure = function (this: unknown, cfg: VideoEncoderConfig) { return orig.call(this, withLatencyMode(cfg, mode)) }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holders === 0 && patchedOn && original) { patchedOn.prototype.configure = original; original = null; patchedOn = null }
  }
}
