// 网页剪辑页·影片画面编码判据。
// Chrome 153（Linux·无硬件解码）下：HEVC（hvc1／hev1／10bit）与 MPEG-4 Part 2 的 mp4 放进 <video> ⇒ loadedmetadata 照来、
//   videoWidth＝0、不报错、声音照放（＝有声黑屏）；mediabunny 的 canDecode 也是 false ⇒ 旧 makeProxy 直接回 null 照放原档 ⇒ 黑屏。
//   H.264 4:4:4／4:2:2／10bit、VP9、AV1 在这台 Chrome 都解得开；但别家浏览器（Safari／Firefox 走系统解码）未必 ⇒ 不是「人人能放」那种 H.264 一律转。
// 本档只放纯函数（题直接跑）；真 I/O 在 vedit-store.ts、页面在 video-edit/page.tsx。
import { PROXY_LONG_SIDE, proxyPlan } from './store.pure'

/** H.264 8bit 4:2:0（Baseline 66／Main 77／Extended 88／High 100）＝各家浏览器都放得出画面的那种。
 *  codec 参数串照 WebCodecs 形（avc1.PPCCLL·PP＝profile_idc 十六进位）；High 10（110）／High 4:2:2（122）／High 4:4:4（244）⇒ 不算。 */
export function isPlainAvc(codecString: string | null | undefined): boolean {
  const m = /^avc[13]\.([0-9a-f]{2})[0-9a-f]{4}$/i.exec((codecString ?? '').trim())
  if (!m) return false
  return [0x42, 0x4d, 0x58, 0x64].includes(parseInt(m[1], 16))
}

export type ProxyDecision =
  | { do: 'skip' } // 本来就是 H.264 8bit 4:2:0 又小 ⇒ 直接放原档
  | { do: 'convert'; size: { width: number } | { height: number } } // 转成 H.264 预览档（长边 ≤960·⛔ 放大）
  | { do: 'undecodable' } // 这个浏览器解不开画面 ⇒ 转不了·页面要明说

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** 这支影片的预览档怎么做：解不开 ⇒ undecodable；不是 H.264 8bit 4:2:0 ⇒ 不论大小一律转（长边取 min(原长边, 960)）；是 ⇒ 照旧 proxyPlan（小的不转）。 */
export function proxyDecision(v: { codecString: string | null; canDecode: boolean; width?: number; height?: number; sizeBytes?: number; duration?: number }): ProxyDecision {
  if (!v.canDecode) return { do: 'undecodable' }
  const w = v.width ?? 0, h = v.height ?? 0
  if (isPlainAvc(v.codecString)) {
    const p = proxyPlan({ kind: 'video', width: w, height: h, sizeBytes: v.sizeBytes, duration: v.duration })
    return p ? { do: 'convert', size: p } : { do: 'skip' }
  }
  const long = Math.max(w, h)
  const side = even(long > 0 ? Math.min(long, PROXY_LONG_SIDE) : PROXY_LONG_SIDE)
  return { do: 'convert', size: h > w ? { height: side } : { width: side } }
}

/** 转档前看会丢哪条轨：丢了画面 ⇒ 转出来只有声音（又是黑屏）·丢了声音 ⇒ 没声音的预览档比没有更糟；两样都 ⇒ 不做这份预览档 */
export function proxyRejectReason(discardedTypes: readonly string[]): 'video' | 'audio' | null {
  if (discardedTypes.includes('video')) return 'video'
  if (discardedTypes.includes('audio')) return 'audio'
  return null
}

/** <video> 读到 metadata 时有没有画面（影片 videoWidth＝0 ⇒ 这个浏览器把画面那条轨丢了·只剩声音） */
export function hasPicture(kind: 'video' | 'audio' | 'image', videoWidth: number): boolean {
  return kind !== 'video' || videoWidth > 0
}

/** 素材卡与播放器要不要明说「画面解不开」：影片·<video> 量过没画面·也没转出可放的预览档·背景也没在忙它（忙完才下定论） */
export function showNoPicture(m: { kind: 'video' | 'audio' | 'image'; noPicture?: boolean; proxied?: boolean; work?: unknown; /** 终端正在转剪辑用小档（转好就有画面） */ shellPx?: unknown }): boolean {
  return m.kind === 'video' && m.noPicture === true && m.proxied !== true && !m.work && !m.shellPx
}

/** 讲给人听的编码名（mediabunny 的 codec 名）；认不出 ⇒ 空字串（文案就不带括号那段） */
export function codecLabel(codec: string | null | undefined): string {
  switch (codec) {
    case 'hevc': return 'HEVC/H.265'
    case 'avc': return 'H.264'
    case 'vp8': return 'VP8'
    case 'vp9': return 'VP9'
    case 'av1': return 'AV1'
    default: return ''
  }
}
