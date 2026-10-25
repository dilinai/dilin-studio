'use client'
// 网页剪辑页·播放器上一层画面的特效与转场（标在原有素材片段上）：
// 那一层的 <video>／<img> 当纹理·照 fxStateAt 算好的进度跑的 GLSL（WebGL2）：先套这段身上的特效（依序·前 4 帧留着给残影）、
// 在接缝窗内再跟另一段做转场（另一段用一只看不见的元素取那一帧·没手柄就停在头／尾那一帧）·最后画到盖在上面的画布。
// 画得出来才把原元素调成透明；浏览器没有 WebGL2／着色器编不过／跨域素材读不了 ⇒ 原元素照显（不黑屏）。
// 画布宽高＝原片像素（长边超过 1280 就等比缩·模糊类着色器采样多）。滤镜（VeditFilterCanvas）要再套就读这张画布（data-ready=1 才算画好）。
import { useEffect, useRef } from 'react'
import { fxById, type FxPass, type TransPass } from '../lib/fx.pure'
import { FX_COPY_FRAG, FX_SAMPLERS, FX_SCALE_FRAG, FX_VERT, fxFragment, needsRel } from '../lib/fx-gl.pure'
import { framePending, frameKey } from './frame-ready'

/** blank＝片头转场的另一边（全黑一格·同汇出 export-render） */
export type FxOther = { url: string; kind: 'video' | 'image'; time: number } | { url: ''; kind: 'blank'; time: 0 } | null
const MAX_SIDE = 1280

export default function VeditFxCanvas({ source, effects, trans, other, t, canvasRef }: {
  /** 有调色时是调色画布（VeditGradeCanvas·看 data-ready／data-frame） */
  source: () => HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null
  effects: readonly FxPass[]
  trans: TransPass | null
  /** 转场另一段的素材（网址＋种类＋取第几秒）·没转场 ⇒ null */
  other: FxOther
  /** 时间轴这一刻（图片也要随时间动） */
  t: number
  canvasRef?: (el: HTMLCanvasElement | null) => void
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ effects, trans, other, t })
  live.current = { effects, trans, other, t }
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let gl: WebGL2RenderingContext | null = null
    try { gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false }) } catch { gl = null }
    if (!gl) { cv.dataset.err = 'no-webgl2'; return }
    const g = gl
    const vbo = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, vbo)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
    const mkTex = () => {
      const tx = g.createTexture()!
      g.bindTexture(g.TEXTURE_2D, tx)
      for (const [k, v] of [[g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE], [g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR]] as const) g.texParameteri(g.TEXTURE_2D, k, v)
      return tx
    }
    const compile = (frag: string): WebGLProgram | null => {
      const sh = (type: number, src: string) => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { console.warn('[vedit-fx]', g.getShaderInfoLog(s)); g.deleteShader(s); return null } return s }
      const v = sh(g.VERTEX_SHADER, FX_VERT), f = sh(g.FRAGMENT_SHADER, frag)
      if (!v || !f) return null
      const p = g.createProgram()!
      g.attachShader(p, v); g.attachShader(p, f); g.bindAttribLocation(p, 0, 'in_pos'); g.linkProgram(p)
      return g.getProgramParameter(p, g.LINK_STATUS) ? p : null
    }
    const progs = new Map<string, WebGLProgram | null>()
    const progOf = (id: string) => {
      if (!progs.has(id)) { const it = fxById(id); progs.set(id, it ? compile(fxFragment(it)) : null) }
      return progs.get(id) ?? null
    }
    const copyProg = compile(FX_COPY_FRAG)
    const scaleProg = compile(FX_SCALE_FRAG)
    // 原片纹理轮着放 5 张（这一帧＋前 4 帧·残影用）；另一段 1 张；中间结果两张来回画；另一段套它自己的特效／缩放再两张
    const ring = [mkTex(), mkTex(), mkTex(), mkTex(), mkTex()]
    let head = 0, filled = 0
    const otherTex = mkTex()
    const pp = [mkTex(), mkTex()]
    const opp = [mkTex(), mkTex()]
    const fbo = g.createFramebuffer()
    let ppW = 0, ppH = 0
    // 另一段：看不见的元素（影片 seek 到那一秒·停着）＋一张 2D 画布把它等比放进同样大小（黑边）
    const oVid = document.createElement('video')
    oVid.muted = true; oVid.playsInline = true; oVid.preload = 'auto'
    oVid.crossOrigin = 'anonymous' // 另一段也按跨源模式载（同时间轴原元素·⛔ 混用无跨源载入让浏览器快取到没许可头的那份）·画进 WebGL 才不被污染
    const oImg = new Image()
    oImg.crossOrigin = 'anonymous'
    const oCv = document.createElement('canvas')
    const o2d = oCv.getContext('2d')
    let oKey = ''
    let raf = 0, last = '', hidden: HTMLElement | null = null, frameN = 0
    // 暫停時網址／時間不變，另一段載好或 seek 完仍須補畫；沿既有 rAF 讀最新來源。
    const otherChanged = () => { last = ''; oKey = '' }
    const videoReadyEvents = ['loadeddata', 'seeked'] as const
    oImg.addEventListener('load', otherChanged)
    for (const event of videoReadyEvents) oVid.addEventListener(event, otherChanged)
    const show = (el: HTMLElement | null) => {
      if (hidden && hidden !== el) hidden.style.opacity = ''
      hidden = el
      if (el) el.style.opacity = '0'
    }
    const fail = (why: string) => { cv.style.visibility = 'hidden'; cv.dataset.ready = '0'; cv.dataset.err = why; show(null); last = '' }
    const draw = (prog: WebGLProgram, out: WebGLTexture | null, w: number, h: number, tex: Record<string, WebGLTexture>, uni: Record<string, number | [number, number]>) => {
      g.useProgram(prog)
      if (out) { g.bindFramebuffer(g.FRAMEBUFFER, fbo); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, out, 0) } else g.bindFramebuffer(g.FRAMEBUFFER, null)
      g.viewport(0, 0, w, h)
      FX_SAMPLERS.forEach((n, i) => {
        const loc = g.getUniformLocation(prog, n)
        if (!loc) return
        g.activeTexture(g.TEXTURE0 + i); g.bindTexture(g.TEXTURE_2D, tex[n] ?? tex.tTex); g.uniform1i(loc, i)
      })
      for (const [k, v] of Object.entries(uni)) {
        const loc = g.getUniformLocation(prog, k)
        if (!loc) continue
        if (Array.isArray(v)) g.uniform2f(loc, v[0], v[1]); else g.uniform1f(loc, v)
      }
      g.bindBuffer(g.ARRAY_BUFFER, vbo); g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    }
    const otherReady = (o: NonNullable<FxOther>, w: number, h: number): boolean => {
      if (o.kind === 'blank') {
        const key = `blank|${w}x${h}`
        if (key === oKey) return true
        if (!o2d) return false
        if (oCv.width !== w || oCv.height !== h) { oCv.width = w; oCv.height = h }
        o2d.fillStyle = '#000'; o2d.fillRect(0, 0, w, h)
        g.bindTexture(g.TEXTURE_2D, otherTex); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, oCv)
        oKey = key
        return true
      }
      const el: HTMLVideoElement | HTMLImageElement = o.kind === 'video' ? oVid : oImg
      if (o.kind === 'video') {
        if (oVid.dataset.src !== o.url) { oVid.dataset.src = o.url; oVid.src = o.url }
        const want = Math.min(Math.max(0, o.time), Math.max(0, (oVid.duration || Infinity) - 0.04))
        if (oVid.readyState >= 1 && !oVid.seeking && Math.abs(oVid.currentTime - want) > 0.02) oVid.currentTime = want
        if (oVid.readyState < 2 || oVid.seeking) return false
      } else {
        if (oImg.dataset.src !== o.url) { oImg.dataset.src = o.url; oImg.src = o.url }
        if (!oImg.complete || !oImg.naturalWidth) return false
      }
      const key = `${o.url}|${o.kind === 'video' ? oVid.currentTime.toFixed(3) : ''}|${w}x${h}`
      if (key === oKey) return true
      const sw = o.kind === 'video' ? oVid.videoWidth : oImg.naturalWidth, sh = o.kind === 'video' ? oVid.videoHeight : oImg.naturalHeight
      if (!sw || !sh || !o2d) return false
      if (oCv.width !== w || oCv.height !== h) { oCv.width = w; oCv.height = h }
      const s = Math.min(w / sw, h / sh)
      o2d.fillStyle = '#000'; o2d.fillRect(0, 0, w, h)
      o2d.drawImage(el, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s)
      g.bindTexture(g.TEXTURE_2D, otherTex)
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, oCv)
      oKey = key
      return true
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const src = source()
      const isVid = src instanceof HTMLVideoElement
      const isCv = src instanceof HTMLCanvasElement
      const sw = isVid ? src.videoWidth : isCv ? src.width : (src as HTMLImageElement | null)?.naturalWidth ?? 0
      const sh = isVid ? src.videoHeight : isCv ? src.height : (src as HTMLImageElement | null)?.naturalHeight ?? 0
      if (src && framePending(src) && cv.style.visibility === 'visible') { show(src); return } // 原片跳转中／还没解出 ⇒ 留着上一张（⛔ 露出原片·⛔ 旧帧配新时间）
      if (!src || !sw || !sh || (isVid && src.readyState < 2) || (isCv && src.dataset.ready !== '1') || (!isVid && !isCv && !(src as HTMLImageElement).complete)) { cv.style.visibility = 'hidden'; cv.dataset.ready = '0'; show(null); return }
      const L = live.current
      const s = Math.min(1, MAX_SIDE / Math.max(sw, sh))
      const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s))
      const srcKey = `${frameKey(src)}`
      const key = `${srcKey}|${w}x${h}|${L.t.toFixed(4)}|${JSON.stringify(L.effects)}|${L.trans ? `${L.trans.tr}:${L.trans.progress.toFixed(4)}:${L.trans.live}:${JSON.stringify(L.trans.other.fx ?? [])}:${(L.trans.other.rel ?? [1, 1]).map((v) => v.toFixed(4))}` : ''}|${L.other ? `${L.other.url}@${L.other.time.toFixed(3)}` : ''}`
      if (key === last) return
      try {
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
        if (ppW !== w || ppH !== h) {
          for (const tx of [...pp, ...opp]) { g.bindTexture(g.TEXTURE_2D, tx); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null) }
          ppW = w; ppH = h
        }
        // 原片这一帧进轮盘（时间变了才进·前 4 帧往后挪）
        const curKey = srcKey
        if (cv.dataset.srcKey !== curKey) {
          head = (head + 1) % ring.length
          filled = Math.min(ring.length, filled + 1)
          g.bindTexture(g.TEXTURE_2D, ring[head])
          g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
          g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src)
          cv.dataset.srcKey = curKey
        }
        const prevTex = (k: number) => ring[(head - Math.min(k, filled - 1) + ring.length * 2) % ring.length]
        let cur: WebGLTexture = ring[head]
        let side = 0
        const base = { ratio: w / h, res: [w, h] as [number, number], seed: 1 }
        for (const e of L.effects) {
          const it = fxById(e.fx)
          const prog = it ? progOf(e.fx) : null
          if (!it || !prog) continue
          const out = pp[side]
          draw(prog, out, w, h, { tTex: cur, tFrom: cur, tTo: cur, tP1: prevTex(1), tP2: prevTex(2), tP3: prevTex(3), tP4: prevTex(4) }, { ...it.params, ...base, progress: e.progress, amount: e.amount, time: e.time })
          cur = out; side ^= 1
        }
        if (L.trans && L.other) {
          const it = fxById(L.trans.tr)
          const prog = it ? progOf(L.trans.tr) : null
          if (it && prog && otherReady(L.other, w, h)) {
            // 另一段也套它自己身上的特效、照它自己的缩放放进来（不然接缝那几格前片会突然没柔光、跟着这段放大）
            let oTex: WebGLTexture = otherTex, oSide = 0
            for (const e of L.trans.other.fx ?? []) {
              const ei = fxById(e.fx), ep = ei ? progOf(e.fx) : null
              if (!ei || !ep) continue
              draw(ep, opp[oSide], w, h, { tTex: oTex, tFrom: oTex, tTo: oTex, tP1: oTex, tP2: oTex, tP3: oTex, tP4: oTex }, { ...ei.params, ...base, progress: e.progress, amount: e.amount, time: e.time })
              oTex = opp[oSide]; oSide ^= 1
            }
            const rel = L.trans.other.rel
            if (scaleProg && needsRel(rel)) { draw(scaleProg, opp[oSide], w, h, { tTex: oTex }, { rel: [rel[0], rel[1]] }); oTex = opp[oSide]; oSide ^= 1 }
            const out = pp[side]
            const from = L.trans.live === 'from' ? cur : oTex, to = L.trans.live === 'to' ? cur : oTex
            draw(prog, out, w, h, { tFrom: from, tTo: to, tTex: cur }, { ...it.params, ...base, progress: L.trans.progress, amount: 1, time: L.t })
            cur = out; side ^= 1
          }
        }
        if (!copyProg) throw new Error('copy')
        draw(copyProg, null, w, h, { tTex: cur }, {})
        const err = g.getError()
        if (err !== g.NO_ERROR) throw new Error(`gl ${err}`)
        last = key
        frameN++
        cv.dataset.frame = String(frameN)
        cv.dataset.ready = '1'
        cv.dataset.err = ''
        cv.style.visibility = 'visible'
        show(src)
      } catch (e) {
        // 画不出来（跨域素材、着色器失败…）⇒ 原元素照显
        fail(e instanceof Error ? e.message.slice(0, 60) : 'err')
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf); show(null)
      oImg.removeEventListener('load', otherChanged)
      for (const event of videoReadyEvents) oVid.removeEventListener(event, otherChanged)
      oVid.removeAttribute('src'); try { oVid.load() } catch { /* 已卸 */ }
      try { for (const tx of [...ring, otherTex, ...pp, ...opp]) g.deleteTexture(tx); g.deleteFramebuffer(fbo); for (const p of progs.values()) if (p) g.deleteProgram(p) } catch { /* 已失效 */ }
    }
  }, [source])
  return <canvas ref={(el) => { ref.current = el; canvasRef?.(el) }} data-testid="vedit-fx-canvas" data-effects={effects.map((e) => e.fx).join(',')} data-trans={trans ? `${trans.tr}:${trans.live}:${trans.progress.toFixed(2)}` : ''}
    className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{ visibility: 'hidden' }} />
}
