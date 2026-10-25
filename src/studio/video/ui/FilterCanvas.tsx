'use client'
// 网页剪辑页·播放器上一层画面套滤镜（滤镜轨）：把那一层的 <video>／<img> 当纹理·照那支 applyFilter（WebGL2）画到盖在上面的画布·
// 画得出来才把原元素调成透明（影片照常播放、出声、同步）；浏览器没有 WebGL2／画失败 ⇒ 原元素照显（不套色·不黑屏）。
// 画布尺寸＝原片像素（锐化、颗粒照原片像素算·同汇出）；显示用 object-contain 跟原元素同一个框。影片每一帧都画（只在画面时间或参数变了才重画）。
import { useEffect, useRef } from 'react'
import { applyFilter, type FilterParams } from '../lib/filters.data'
import { framePending, frameKey } from './frame-ready'

export default function VeditFilterCanvas({ source, params, strength, filterId }: {
  /** 被套色的那个元素（同一层里的 video 或 img·有特效转场时是特效画布 VeditFxCanvas） */
  source: () => HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null
  params: FilterParams
  strength: number
  filterId: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ params, strength, filterId })
  live.current = { params, strength, filterId }
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let gl: WebGL2RenderingContext | null = null
    try { gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false }) } catch { gl = null }
    if (!gl) return
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v)
    let raf = 0, last = '', hidden: HTMLElement | null = null
    const show = (el: HTMLElement | null) => {
      if (hidden && hidden !== el) hidden.style.opacity = ''
      hidden = el
      if (el) el.style.opacity = '0'
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const src = source()
      const isVid = src instanceof HTMLVideoElement
      const isCv = src instanceof HTMLCanvasElement
      const w = isVid ? src.videoWidth : isCv ? src.width : (src as HTMLImageElement | null)?.naturalWidth ?? 0
      const h = isVid ? src.videoHeight : isCv ? src.height : (src as HTMLImageElement | null)?.naturalHeight ?? 0
      if (src && framePending(src) && cv.style.visibility === 'visible') { show(src); return } // 原片跳转中／还没解出 ⇒ 留着上一张（⛔ 露出原片·⛔ 旧帧配新时间）
      if (!src || !w || !h || (isVid && src.readyState < 2) || (isCv && src.dataset.ready !== '1') || (!isVid && !isCv && !(src as HTMLImageElement).complete)) { cv.style.visibility = 'hidden'; show(null); return }
      const L = live.current
      const key = `${frameKey(src)}|${w}x${h}|${L.filterId}|${L.strength.toFixed(3)}`
      if (key === last) return
      try {
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
        gl!.bindTexture(gl!.TEXTURE_2D, tex)
        gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false)
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, src)
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
        gl!.viewport(0, 0, w, h)
        applyFilter(gl!, tex!, L.params, L.strength, { seed: isVid ? Math.round((src as HTMLVideoElement).currentTime * 30) : 0 })
        last = key
        cv.style.visibility = 'visible'
        show(src)
      } catch {
        // 画不出来（跨域素材、着色器失败…）⇒ 原元素照显
        cv.style.visibility = 'hidden'; show(null); last = ''
      }
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); show(null); try { gl!.deleteTexture(tex) } catch { /* 已失效 */ } }
  }, [source])
  return <canvas ref={ref} data-testid="vedit-filter-canvas" data-filter-id={filterId} data-strength={strength.toFixed(2)} className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{ visibility: 'hidden' }} />
}
