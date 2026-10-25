/* eslint-disable @typescript-eslint/no-explicit-any, no-var */
/**
 * slide-kit · 组件化 · 换页切换执行器：淡化／推入／擦除／缩放／平滑（语义对齐 PowerPoint 的「切換」）
 *
 *   一份码三处用：
 *     ① deck-html 产物（放映／分享页／html 下载）：TRANSITION_SCRIPT＝把本工厂函数原文（toString）塞进 <script>·install() 盯着
 *        section.slide 的 active 换手（不碰现成两套导航脚本·它们换页照旧；本脚本只在换手那一刻把旧页留着叠在底下做补间）；
 *     ② 编辑页「切換」面板的预览：直接 import 工厂·run(旧画布, 新画布, 设定)；
 *     ③ 单测：match／lerpFrame／bgFillMatrix 等纯函数。
 *   🔴 工厂函数体必须自足（toString 后单独跑）：⛔ 引用模块外的东西、⛔ 展开语法／可选链（编译器可能换成外部 helper）。
 *
 *   画布 DOM 契约（render.tsx 出）：
 *     [data-sk-canvas] > [data-sk-bg]（页底层：底色＋底图＋底片 <video data-sk-bgv>）
 *     每个组件外框 [data-sk-f="x,y,w,h,rotate"]（组合的子件外框在组外框里面）：
 *       data-sk-mk 配对键·data-sk-nm 「!!」名称·data-sk-type 种类·data-sk-sig 内容指纹·data-sk-th 文字指纹·data-sk-op 透明度·data-sk-grp 组合
 *     幻灯片背景填充那层 [data-sk-bgf]（transform＝页面 ⇒ 形状局部·补间中每一格重算）
 *   section 上：data-tr 种类·data-tr-dur 毫秒·data-tr-dir 方向。
 *
 *   平滑（morph）：两页同键配对 ⇒ 新页那件从旧位置补间到新位置（x,y,w,h·角度取最短那一边·透明度）；
 *     内容指纹相同 ⇒ 旧的那件先藏起来（只看到一件在动）；不同 ⇒ 旧的那件跟着一起动、新的叠在上面淡入（＝颜色／图片／字交叉淡化）；
 *     组合配对 ⇒ 组框补间（子件跟着组中心绕＝沿环转）·组内再按键配对补间；只在一边的淡出／淡入；
 *     新页页底层暂时搬进旧画布、垫在旧组件底下淡入（页底交叉淡化·不盖住旧组件）。
 *   新页的自动动画在切换期间暂停（切换完才开始·同 PowerPoint）；prefers-reduced-motion ⇒ 直接换。
 */

export function skTransitionFactory(): any {
  function num(v: any): number { var n = parseFloat(v); return isFinite(n) ? n : 0 }
  function parseF(el: any): any {
    var s = el && el.getAttribute ? el.getAttribute('data-sk-f') : null
    if (!s) return null
    var a = String(s).split(',')
    return { x: num(a[0]), y: num(a[1]), w: num(a[2]), h: num(a[3]), r: num(a[4]) }
  }
  function curF(el: any): any { return el.__skf || parseF(el) }
  function mul(m1: number[], m2: number[]): number[] {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]]
  }
  function inv(m: number[]): number[] {
    var det = m[0] * m[3] - m[1] * m[2]
    if (!det) return [1, 0, 0, 1, 0, 0]
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
  }
  function frameMat(f: any): number[] {
    var r = (f.r || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
    var cx = f.x + f.w / 2, cy = f.y + f.h / 2
    return [c, s, -s, c, cx - c * f.w / 2 + s * f.h / 2, cy - s * f.w / 2 - c * f.h / 2]
  }
  function chainMat(fs: any[]): number[] {
    var m = [1, 0, 0, 1, 0, 0]
    for (var i = 0; i < fs.length; i++) m = mul(m, frameMat(fs[i]))
    return m
  }
  /** 页面 ⇒ 最内层框局部（幻灯片背景填充） */
  function bgFillMatrix(fs: any[]): number[] { return inv(chainMat(fs)) }
  function angDelta(a: number, b: number): number { var d = ((b - a) % 360 + 360) % 360; return d > 180 ? d - 360 : d }
  function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
  function lerpFrame(a: any, b: any, t: number): any {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), r: a.r + angDelta(a.r, b.r) * t }
  }
  function ease(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }

  /**
   * 配对：① 名称都以 !! 开头且相同 ② 配对键相同 ③ 文字组件字相同（PowerPoint 也会这样认）。各取第一个还没配到的。
   * items＝{mk, nm, type, th}·回 [[旧序, 新序], …]
   */
  function match(outs: any[], ins: any[]): number[][] {
    var pairs: number[][] = [], usedO: any = {}, usedI: any = {}
    function pass(eq: (a: any, b: any) => boolean) {
      for (var j = 0; j < ins.length; j++) {
        if (usedI[j]) continue
        for (var i = 0; i < outs.length; i++) {
          if (usedO[i]) continue
          if (eq(outs[i], ins[j])) { usedO[i] = 1; usedI[j] = 1; pairs.push([i, j]); break }
        }
      }
    }
    pass(function (a, b) { return !!a.nm && a.nm.indexOf('!!') === 0 && a.nm === b.nm })
    pass(function (a, b) { return !!a.mk && a.mk === b.mk && a.type === b.type })
    pass(function (a, b) { return a.type === 'text' && b.type === 'text' && !!a.th && a.th === b.th })
    return pairs
  }

  function opOf(el: any): number { var v = el.getAttribute('data-sk-op'); return v === null || v === '' ? 1 : num(v) }
  function framedParent(el: any, stop: any): any {
    var p = el.parentElement
    while (p && p !== stop) { if (p.hasAttribute && p.hasAttribute('data-sk-f')) return p; p = p.parentElement }
    return null
  }
  /** scope 这一层自己的组件外框（root＝画布：取顶层；scope＝组外框：取它的子件） */
  function ownItems(scope: any, root: any): any[] {
    var all = scope.querySelectorAll('[data-sk-f]'), out: any[] = []
    for (var i = 0; i < all.length; i++) if (framedParent(all[i], root) === (scope === root ? null : scope)) out.push(all[i])
    return out
  }
  function describe(el: any): any {
    return { mk: el.getAttribute('data-sk-mk') || '', nm: el.getAttribute('data-sk-nm') || '', type: el.getAttribute('data-sk-type') || '', th: el.getAttribute('data-sk-th') || '' }
  }

  /** 平滑的补间清单：{el, fa, fb, oa, ob, kind: 'geo'（跟着动·透明度 oa→ob）|'fadeIn'（跟着动·0→ob）|'out'（淡出）|'in'（淡入）|'hide'} */
  function planMorph(outRoot: any, inRoot: any, outScope: any, inScope: any, tracks: any[]): void {
    var A = ownItems(outScope, outRoot), B = ownItems(inScope, inRoot)
    var pairs = match(A.map(describe), B.map(describe))
    var gotA: any = {}, gotB: any = {}
    for (var k = 0; k < pairs.length; k++) {
      var a = A[pairs[k][0]], b = B[pairs[k][1]]
      gotA[pairs[k][0]] = 1; gotB[pairs[k][1]] = 1
      var fa = parseF(a), fb = parseF(b), oa = opOf(a), ob = opOf(b)
      if (a.hasAttribute('data-sk-grp') && b.hasAttribute('data-sk-grp')) {
        tracks.push({ el: b, fa: fa, fb: fb, oa: oa, ob: ob, kind: 'geo' })
        tracks.push({ el: a, fa: fa, fb: fb, oa: oa, ob: ob, kind: 'geo' })
        planMorph(outRoot, inRoot, a, b, tracks)
      } else if (a.getAttribute('data-sk-sig') && a.getAttribute('data-sk-sig') === b.getAttribute('data-sk-sig')) {
        tracks.push({ el: b, fa: fa, fb: fb, oa: oa, ob: ob, kind: 'geo' })
        tracks.push({ el: a, kind: 'hide' })
      } else {
        tracks.push({ el: a, fa: fa, fb: fb, oa: oa, ob: oa, kind: 'geo' })
        tracks.push({ el: b, fa: fa, fb: fb, oa: 0, ob: ob, kind: 'fadeIn' })
      }
    }
    for (var i = 0; i < A.length; i++) if (!gotA[i]) tracks.push({ el: A[i], oa: opOf(A[i]), ob: 0, kind: 'out' })
    for (var j = 0; j < B.length; j++) if (!gotB[j]) tracks.push({ el: B[j], oa: 0, ob: opOf(B[j]), kind: 'in' })
  }

  function setFrame(el: any, f: any): void {
    el.__skf = f
    var s = el.style
    s.left = f.x + 'px'; s.top = f.y + 'px'; s.width = f.w + 'px'; s.height = f.h + 'px'
    s.transform = f.r ? 'rotate(' + f.r + 'deg)' : 'none'
  }
  function setOp(el: any, o: number): void { el.style.opacity = String(Math.max(0, Math.min(1, o))) }
  function updateBgFills(root: any): void {
    var list = root.querySelectorAll('[data-sk-bgf]')
    for (var i = 0; i < list.length; i++) {
      var el = list[i], chain: any[] = [], p = el.parentElement
      while (p && p !== root) { if (p.hasAttribute && p.hasAttribute('data-sk-f')) chain.unshift(curF(p)); p = p.parentElement }
      el.style.transform = 'matrix(' + bgFillMatrix(chain).join(',') + ')'
    }
  }
  function bgLayer(canvas: any): any {
    var k = canvas ? canvas.children : []
    for (var i = 0; i < k.length; i++) if (k[i].hasAttribute('data-sk-bg')) return k[i]
    return null
  }
  var MIRROR: any = { left: 'right', right: 'left', up: 'down', down: 'up' }

  /**
   * 跑一次切换：outCanvas／inCanvas＝两页的 [data-sk-canvas]（调用方负责把两页叠好：新页在上）。
   * spec＝{type, durationMs, direction}·opts＝{reduced, onDone, now, raf, caf}；回 {finish()}（立刻跳到尾）。
   */
  function run(outCanvas: any, inCanvas: any, spec: any, opts: any): any {
    opts = opts || {}
    var type = spec && spec.type ? spec.type : 'none'
    var dur = spec && spec.durationMs > 0 ? spec.durationMs : 0
    var saved: any[] = [], moved: any = null, done = false, rafId = 0, tracks: any[] = []
    var raf = opts.raf || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (f: any) { return setTimeout(function () { f(Date.now()) }, 16) })
    var caf = opts.caf || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)
    var now = opts.now || function () { return typeof performance !== 'undefined' ? performance.now() : Date.now() }
    function keep(el: any) { if (el && !el.__skSaved) { el.__skSaved = 1; saved.push([el, el.getAttribute('style')]) } }
    function finish() {
      if (done) return
      done = true
      if (rafId) caf(rafId)
      for (var i = 0; i < saved.length; i++) {
        var el = saved[i][0]
        if (saved[i][1] === null) el.removeAttribute('style'); else el.setAttribute('style', saved[i][1])
        delete el.__skSaved; delete el.__skf
      }
      if (moved) { if (moved.ph.parentNode) { moved.ph.parentNode.insertBefore(moved.el, moved.ph); moved.ph.parentNode.removeChild(moved.ph) } }
      if (outCanvas) updateBgFills(outCanvas)
      if (inCanvas) updateBgFills(inCanvas)
      if (opts.onDone) opts.onDone()
    }
    if (!outCanvas || !inCanvas || type === 'none' || !dur || opts.reduced) { finish(); return { finish: finish } }
    var dir = spec.direction || 'right'
    var VEC: any = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }
    var vec: any = VEC[dir] || [1, 0]
    keep(inCanvas); keep(outCanvas)
    if (type === 'morph') {
      var ob = bgLayer(outCanvas), ib = bgLayer(inCanvas)
      if (ob && ib) {
        var ph = inCanvas.ownerDocument.createComment('sk-bg')
        ib.parentNode.insertBefore(ph, ib)
        ob.parentNode.insertBefore(ib, ob.nextSibling)
        moved = { el: ib, ph: ph }
        keep(ib)
      }
      planMorph(outCanvas, inCanvas, outCanvas, inCanvas, tracks)
      for (var t = 0; t < tracks.length; t++) keep(tracks[t].el)
    }
    function apply(e: number) {
      var s = inCanvas.style, so = outCanvas.style
      if (type === 'fade') setOp(inCanvas, e)
      else if (type === 'zoom') { setOp(inCanvas, e); s.transform = 'scale(' + (0.8 + 0.2 * e) + ')'; s.transformOrigin = '50% 50%' }
      else if (type === 'push') {
        s.transform = 'translate(' + (vec[0] * (1 - e) * 100) + '%,' + (vec[1] * (1 - e) * 100) + '%)'
        so.transform = 'translate(' + (-vec[0] * e * 100) + '%,' + (-vec[1] * e * 100) + '%)'
      } else if (type === 'wipe') {
        var r = (1 - e) * 100
        // 新页从 dir 那一边露出来（right＝由右往左擦）
        s.clipPath = dir === 'right' ? 'inset(0 0 0 ' + r + '%)' : dir === 'left' ? 'inset(0 ' + r + '% 0 0)' : dir === 'down' ? 'inset(' + r + '% 0 0 0)' : 'inset(0 0 ' + r + '% 0)'
      } else if (type === 'morph') {
        if (moved) setOp(moved.el, e)
        for (var i = 0; i < tracks.length; i++) {
          var k = tracks[i]
          if (k.kind === 'hide') { k.el.style.visibility = 'hidden'; continue }
          if (k.fa && k.fb) setFrame(k.el, lerpFrame(k.fa, k.fb, e))
          if (k.kind === 'out') setOp(k.el, k.oa * (1 - e))
          else setOp(k.el, lerp(k.oa, k.ob, e))
        }
        updateBgFills(outCanvas); updateBgFills(inCanvas)
      }
    }
    var t0 = now()
    apply(0)
    function tick() {
      if (done) return
      var p = Math.min(1, (now() - t0) / dur)
      apply(ease(p))
      if (p >= 1) { finish(); return }
      rafId = raf(tick)
    }
    rafId = raf(tick)
    return { finish: finish }
  }

  /* ── 底片（页底影片）：进页开播（与切换同步）·不循环＝播完停最后一格·endSec 停／回 startSec·同一支接续 ── */
  function bgVideo(sec: any): any { return sec ? sec.querySelector('[data-sk-bgv]') : null }
  function seek(v: any, t: number) {
    function go() { try { v.currentTime = t } catch (e) { /* 还不能跳 */ } }
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true })
  }
  /** 幻灯片背景填充形状里那几支同片：跟着页底那支走（播／停／跳·偏差超过 0.25 秒拉回） */
  function followers(v: any): any[] { return v.__skSec ? Array.prototype.slice.call(v.__skSec.querySelectorAll('[data-sk-bgfv]')) : [] }
  function mirror(v: any, play: boolean) {
    var fs = followers(v)
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i]
      f.muted = true
      if (Math.abs((f.currentTime || 0) - v.currentTime) > 0.25) seek(f, v.currentTime)
      if (play && f.paused) { var p = f.play(); if (p && p.catch) p.catch(function () { /* */ }) }
      if (!play && !f.paused) f.pause()
    }
  }
  function bindVideo(v: any) {
    if (v.__skb) return
    v.__skb = 1
    v.muted = true
    v.addEventListener('play', function () { mirror(v, true) })
    v.addEventListener('pause', function () { mirror(v, false) })
    v.addEventListener('seeked', function () { mirror(v, !v.paused) })
    v.addEventListener('timeupdate', function () { mirror(v, !v.paused) })
    var start = function () { return num(v.getAttribute('data-start')) }
    v.addEventListener('timeupdate', function () {
      var end = v.getAttribute('data-end')
      if (end === null || v.currentTime < num(end)) return
      if (v.hasAttribute('data-loop')) seek(v, start()); else v.pause()
    })
    v.addEventListener('ended', function () { if (v.hasAttribute('data-loop')) { seek(v, start()); var p = v.play(); if (p && p.catch) p.catch(function () { /* 不给播 */ }) } })
  }
  /** 进页：同一支底片＋平滑＋这页没给 startSec ⇒ 接着旧页的时间播；否则从 startSec（不给＝0） */
  function startBgVideo(prev: any, nxt: any, spec: any) {
    var v = bgVideo(nxt)
    if (!v) return
    v.__skSec = nxt
    bindVideo(v)
    var pv = bgVideo(prev)
    var cont = !!pv && pv !== v && !!spec && spec.type === 'morph' && pv.getAttribute('data-src') === v.getAttribute('data-src') && !v.hasAttribute('data-start')
    seek(v, cont ? pv.currentTime : num(v.getAttribute('data-start')))
    var p = v.play()
    if (p && p.catch) p.catch(function () { /* 不给自动播（静音理应可以）·停在封面 */ })
  }
  function pauseBgVideo(sec: any) {
    var v = sec && sec.querySelector ? sec.querySelector('[data-sk-bgv]') : null
    if (v) try { v.pause() } catch (e) { /* */ }
    var fs = sec && sec.querySelectorAll ? sec.querySelectorAll('[data-sk-bgfv]') : []
    for (var i = 0; i < fs.length; i++) try { fs[i].pause() } catch (e) { /* */ }
  }

  function readSpec(sec: any): any {
    var type = sec ? sec.getAttribute('data-tr') : null
    if (!type) return null
    var d = sec.getAttribute('data-tr-dir')
    return { type: type, durationMs: num(sec.getAttribute('data-tr-dur')) || 700, direction: d || undefined }
  }

  /** 放映产物：盯着 active 换手（两套导航脚本都只是换 class）·旧页留着叠在下面做切换 */
  function install(win: any, doc: any) {
    if (!doc || !doc.body || typeof MutationObserver === 'undefined' || win.__skTrans) return
    win.__skTrans = 1
    var st = doc.createElement('style')
    st.id = '__sk_trans_css__'
    st.textContent = '.sk-tr-in .sk-a{animation-play-state:paused!important}.sk-tr-out .sk-a{animation:none!important}.sk-tr-gone{opacity:0!important}'
    doc.head ? doc.head.appendChild(st) : doc.body.appendChild(st)
    var reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches)
    function sections() { return Array.prototype.slice.call(doc.querySelectorAll('section.slide,div.slide')) }
    function activeSec() { return doc.querySelector('section.slide.active,div.slide.active') }
    function canvasOf(sec: any) { return sec ? sec.querySelector('[data-sk-canvas]') : null }
    var cur = activeSec(), ctl: any = null
    startBgVideo(null, cur, null)
    function change(prev: any, nxt: any, restore: any[]) {
      if (ctl) ctl.finish()
      var list = sections(), pi = list.indexOf(prev), ni = list.indexOf(nxt)
      var back = pi >= 0 && ni >= 0 && ni < pi
      var spec = readSpec(back ? prev : nxt)
      // 往回翻＝倒放离开的那页的切换（方向反过来）
      if (spec && back && spec.direction) spec.direction = MIRROR[spec.direction] || spec.direction
      startBgVideo(prev, nxt, spec)
      if (!prev || !spec || spec.type === 'none' || reduced || !canvasOf(prev) || !canvasOf(nxt)) { pauseBgVideo(prev); return }
      // 旧页的行内样式整段记下（编辑层导航会写 display:none!important）·切完原样放回
      var pCss = prev.getAttribute('style'), nCss = nxt.getAttribute('style')
      prev.style.setProperty('display', 'flex', 'important')
      prev.style.position = 'absolute'; prev.style.left = '0'; prev.style.top = '0'; prev.style.zIndex = '0'
      nxt.style.position = 'relative'; nxt.style.zIndex = '1'
      prev.classList.add('sk-tr-out')
      var gone: any[] = []
      for (var i = 0; i < restore.length; i++) { restore[i].classList.add('visible'); if (restore[i].classList.contains('sk-a-exit')) { restore[i].classList.add('sk-tr-gone'); gone.push(restore[i]) } }
      var autoExit = prev.querySelectorAll('.sk-a-exit.sk-auto')
      for (var j = 0; j < autoExit.length; j++) { autoExit[j].classList.add('sk-tr-gone'); gone.push(autoExit[j]) }
      nxt.classList.add('sk-tr-in')
      ctl = run(canvasOf(prev), canvasOf(nxt), spec, {
        reduced: reduced,
        onDone: function () {
          for (var a = 0; a < restore.length; a++) restore[a].classList.remove('visible')
          for (var b = 0; b < gone.length; b++) gone[b].classList.remove('sk-tr-gone')
          prev.classList.remove('sk-tr-out')
          nxt.classList.remove('sk-tr-in')
          if (pCss === null) prev.removeAttribute('style'); else prev.setAttribute('style', pCss)
          if (nCss === null) nxt.removeAttribute('style'); else nxt.setAttribute('style', nCss)
          pauseBgVideo(prev)
          ctl = null
        },
      })
    }
    var mo = new MutationObserver(function (recs: any[]) {
      var nxt = activeSec()
      if (!nxt || nxt === cur) return
      var prev = cur
      cur = nxt
      var restore: any[] = []
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i], el = r.target
        if (r.attributeName !== 'class' || !prev || el === prev || !prev.contains(el)) continue
        if (r.oldValue && /(^|\s)visible(\s|$)/.test(r.oldValue) && !el.classList.contains('visible') && restore.indexOf(el) < 0) restore.push(el)
      }
      change(prev, nxt, restore)
    })
    mo.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  }

  return { match: match, lerpFrame: lerpFrame, angDelta: angDelta, ease: ease, bgFillMatrix: bgFillMatrix, frameMat: frameMat, chainMat: chainMat, planMorph: planMorph, run: run, install: install, startBgVideo: startBgVideo, readSpec: readSpec }
}

/** deck-html 产物里那段脚本（工厂原文＋install） */
export function transitionScript(): string {
  return `<script id="__sk_trans__">(${skTransitionFactory.toString()})().install(window,document);</script>`
}
