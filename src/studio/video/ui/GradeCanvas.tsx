'use client'
// 网页剪辑页·播放器上一层画面的调色与抠像：HSL／曲线／色轮／LUT／色度抠像／盖在上面的调节层都烤成一张 3D 查表（_lib/grade.pure.ts bakeGradeLut）·
// 这里用 WebGL2 把那一层的 <video>／<img> 当纹理、照表（3D 纹理线性取样·同汇出 applyGradeLut 的三线性内插）画到盖在上面的画布·抠像的透明度乘进 alpha。
// 画得出来才把原元素调成透明（影片照常播放、出声、同步）；没有 WebGL2／画失败 ⇒ 原元素照显（不套色·不黑屏）。
// 画好的画布标 data-ready／data-frame·特效画布、滤镜画布、背景填充改拿它当来源（page.tsx layerSource）。
// 影片跳转中／还没解出这一帧 ⇒ 画布留着上一张抠好的、原元素照旧藏着（原先这时把画布收掉、原元素露出 ⇒ 起播与拖播放头先闪一下没抠的绿底）；
// 原元素一出场就由页面先藏（page.tsx GRADE_HIDE）·只有画不出来（没 WebGL2／着色器坏／跨域）才放原元素出来。
import { useEffect, useRef } from 'react'
import { GRADE_N } from '../lib/grade.pure'
import { framePending, frameKey } from './frame-ready'

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2((p.x+1.0)*0.5, (1.0-p.y)*0.5); gl_Position = vec4(p,0.0,1.0); }`
const FRAG = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform sampler3D lut; uniform float n;
void main(){
  vec4 c = texture(src, uv);
  vec3 q = c.rgb * ((n - 1.0) / n) + 0.5 / n;
  vec4 g = texture(lut, q);
  o = vec4(g.rgb, c.a * g.a);
}`

export default function VeditGradeCanvas({ source, lut, lutKey, canvasRef }: {
  /** 原元素（同一层里的 video 或 img） */
  source: () => HTMLVideoElement | HTMLImageElement | null
  /** 烤好的表（GRADE_N³·RGBA）与它的指纹（换表才重传） */
  lut: Uint8Array
  lutKey: string
  canvasRef?: (el: HTMLCanvasElement | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ lut, lutKey })
  live.current = { lut, lutKey }
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let raf = 0
    // 画不出来 ⇒ 一直放原元素出来（页面替它先藏了·换段的新元素也要放）
    const giveUp = (why: string) => {
      cv.dataset.err = why
      const loop = () => { raf = requestAnimationFrame(loop); const s = source(); if (s && s.style.opacity === '0') s.style.opacity = '' }
      loop()
      return () => cancelAnimationFrame(raf)
    }
    let gl: WebGL2RenderingContext | null = null
    try { gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true }) } catch { gl = null }
    if (!gl) return giveUp('no-webgl2')
    const sh = (type: number, code: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, code); gl!.compileShader(s); return s }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return giveUp('shader')
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    const srcTex = gl.createTexture(), lutTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.bindTexture(gl.TEXTURE_3D, lutTex)
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]] as const) gl.texParameteri(gl.TEXTURE_3D, k, v)
    let last = '', lutLoaded = '', frameN = 0, hidden: HTMLElement | null = null
    const show = (el: HTMLElement | null) => {
      if (hidden && hidden !== el) hidden.style.opacity = ''
      hidden = el
      if (el) el.style.opacity = '0'
    }
    const off = () => { cv.style.visibility = 'hidden'; cv.dataset.ready = '0'; show(null); last = '' }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const src = source()
      if (!src) { off(); return }
      // 跳转中／还没解出这一帧：留着上一张抠好的·原元素藏着（⛔ 露出没抠的原片＝闪绿；⛔ 拿旧帧配新时间画上去）
      if (framePending(src)) { show(src); return }
      const isVid = src instanceof HTMLVideoElement
      const w = isVid ? src.videoWidth : src.naturalWidth
      const h = isVid ? src.videoHeight : src.naturalHeight
      const L = live.current
      const key = `${frameKey(src)}|${w}x${h}|${L.lutKey}`
      if (key === last) return
      try {
        const g = gl!
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
        g.useProgram(prog)
        g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_3D, lutTex)
        if (lutLoaded !== L.lutKey) {
          g.pixelStorei(g.UNPACK_ALIGNMENT, 1)
          g.texImage3D(g.TEXTURE_3D, 0, g.RGBA8, GRADE_N, GRADE_N, GRADE_N, 0, g.RGBA, g.UNSIGNED_BYTE, L.lut)
          lutLoaded = L.lutKey
        }
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, srcTex)
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src)
        g.uniform1i(g.getUniformLocation(prog, 'src'), 0)
        g.uniform1i(g.getUniformLocation(prog, 'lut'), 1)
        g.uniform1f(g.getUniformLocation(prog, 'n'), GRADE_N)
        g.bindBuffer(g.ARRAY_BUFFER, buf); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
        g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, w, h)
        g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT)
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
        last = key
        cv.dataset.frame = String(++frameN)
        cv.dataset.ready = '1'
        cv.dataset.err = ''
        cv.style.visibility = 'visible'
        show(src)
      } catch { off(); cv.dataset.err = 'draw'; src.style.opacity = '' } // 跨域素材、显卡出错 ⇒ 原元素照显
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); show(null); cv.dataset.ready = '0'; try { gl!.deleteTexture(srcTex); gl!.deleteTexture(lutTex) } catch { /* 已失效 */ } }
  }, [source])
  return <canvas ref={(el) => { ref.current = el; canvasRef?.(el) }} data-testid="vedit-grade-canvas" data-lut={lutKey.length > 2 ? '1' : '0'} className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{ visibility: 'hidden' }} />
}
