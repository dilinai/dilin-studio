/* eslint-disable @typescript-eslint/no-explicit-any, no-var */
/**
 * slide-kit · 组件化 · 同页「下一步」驱动程序动画与影片步骤的执行器（B）
 *
 *   一份码三处用（同 transition.ts 的做法）：
 *     ① deck-html 产物（放映／分享页／html 下载／画布小窗播放器）：stepsScript()＝把本工厂原文（toString）塞进 <script>；
 *        install() 盯着页里的记号 <i data-sk-act> 亮不亮（导航脚本照旧按 data-step 组点亮·⛔ 改两套导航脚本本体），
 *        并把全域 nextStep／prevStep 包一层：本页单击组都走完了 ⇒ 再交给程序组件的「隐式步骤」走，走完才回 false（＝换页）；
 *        上一步先退隐式步骤。整组都是空步（程序步骤超过程序回报的 N）⇒ 自动跳过不白按。
 *     ② 编辑页预览（组件版画布·不跑 CSS 动画）：controller(win, getRoot)＝只走影片／程序记号与隐式步骤的小播放器。
 *     ③ 单测：parseMsg／frameOf／implicitCount／groupNoop 等。
 *   🔴 工厂函数体必须自足（toString 后单独跑）：⛔ 引用模块外的东西、⛔ 展开语法／可选链（编译器可能换成外部 helper）。
 *
 *   记号契约（render.tsx 出）：
 *     <i data-sk-act="media|program" data-sk-target="<组件编号>" data-sk-anim="<动画编号>"
 *        data-step="<组>"｜data-sk-auto｜data-sk-cue  data-sk-delay="<毫秒>"
 *        data-sk-idx="<程序第几步>"  data-sk-effect="play|pause|seek" data-sk-seek="<秒>">
 *     程序 iframe：<iframe data-sk-prog="<组件编号>" data-sk-steps="<声明步数>" data-sk-explicit="<显式步数>" data-sk-cues='[{"step":1,"atSec":2,"anims":["a1"]}]'>
 *     影片：[data-sk-id="<组件编号>"] 里的 <video>；书签点名的基础动画壳：.sk-cue[data-sk-anim]。
 *   自动播放影片：组件标了 autoplay（背景／装饰片）⇒ 进页（activate）主动从头放（静音·loop 照属性）、
 *     离页（deactivate）停、不在当下这页的被 autoplay 属性带起来就当场停——「进到该页才播」不靠浏览器对 autoplay 属性的临场判断。
 *     排了影片步骤的那支照旧（回开头·autoplay 才放·步骤 play／pause 再接手）。页底影片（data-sk-bgv／bgfv）归 transition.ts。
 *   讯号（program-types.ts）：程序 → 外层 {__dlp:1,type:'ready'|'steps'|'stepDone'}；外层 → 程序 {__dlp:1,type:'step',index,animate}。
 *   🔴 只认 e.source 正是本范围里某个程序 iframe 的 contentWindow 的讯号（别的来源一律不理）。
 */

export function skStepsFactory(): any {
  var MAXN = 50
  function num(v: any): number { var n = parseFloat(v); return isFinite(n) ? n : 0 }
  function attr(el: any, k: string): any { return el && el.getAttribute ? el.getAttribute(k) : null }
  function hasCls(el: any, c: string): boolean { return !!(el && el.classList && el.classList.contains(c)) }
  function toArr(l: any): any[] { return Array.prototype.slice.call(l || []) }

  /** 程序讯号判读：只认 __dlp:1 的 ready／steps／stepDone（步数夹在 0–50） */
  function parseMsg(d: any): any {
    if (!d || typeof d !== 'object' || d.__dlp !== 1) return null
    if (d.type === 'ready') return { type: 'ready' }
    if (d.type === 'steps') return { type: 'steps', steps: Math.max(0, Math.min(MAXN, Math.floor(num(d.steps)))) }
    if (d.type === 'stepDone') return { type: 'stepDone', index: Math.max(0, Math.floor(num(d.index))) }
    return null
  }
  /** 讯号来源核对：source 必须正是 frames 里某个 iframe 的 contentWindow（回那个 iframe·否则 null） */
  function frameOf(frames: any[], source: any): any {
    if (!source) return null
    for (var i = 0; i < frames.length; i++) {
      var w = null
      try { w = frames[i].contentWindow } catch (e) { w = null }
      if (w && w === source) return frames[i]
    }
    return null
  }
  /** 隐式步数＝程序步数 N − 页动画表里的显式步数（显式多于 N ⇒ 多的空步·没有隐式） */
  function implicitCount(n: number, explicit: number): number { return Math.max(0, n - explicit) }
  /**
   * 放映产物里的程序 iframe（data-sk-lazy）平时 sandbox=""（只画静态、作者码不跑）；
   * 进到这页才换成 allow-scripts 并重载 srcdoc（sandbox 改了要重新载入才生效）·离页换回 ""＋重载（作者码停掉）。
   * 回 true＝真换了（换了就把执行器记的状态归零：没 ready、步数回声明值、在第 0 步）。⛔ 给别的 token。
   */
  function setRun(el: any, on: boolean): boolean {
    // 这次放映里自己导走过的（盯 load 脚本标的 __skBlocked）⇒ 一律留在静态·不再放回 allow-scripts
    if (on && el.__skBlocked) on = false
    var want = on ? 'allow-scripts' : ''
    // 现在跑没跑以自己记的为准（没记过＝看属性：载入时就是 allow-scripts 的那份文件已经在跑）
    var live = el.__skRun === undefined ? attr(el, 'sandbox') === 'allow-scripts' : el.__skRun
    el.__skRun = on
    if (live === on) { if (attr(el, 'sandbox') !== want) el.setAttribute('sandbox', want); return false }
    el.setAttribute('sandbox', want)
    // 重载交给盯 load 脚本（PROGRAM_FRAME_WATCH_SCRIPT·在 <head>）：它记着「这次 load 是我们发起的」·上一次没载完就等载完再重载；
    //   没有那段脚本（旧产物没过补护）才直接重设 srcdoc
    var dv = el.ownerDocument && el.ownerDocument.defaultView
    var W = dv && dv.__skProgWatch
    if (W && typeof W.reload === 'function') W.reload(el)
    else { var d = attr(el, 'srcdoc'); if (d !== null) el.setAttribute('srcdoc', d) }
    var p = el.__skp
    if (p) { p.ready = false; p.cur = 0; p.n = Math.max(0, Math.min(MAXN, Math.floor(num(attr(el, 'data-sk-steps'))))) }
    return true
  }
  /** 这个范围里的 lazy 程序 iframe 一律开／关 */
  function runScope(scope: any, on: boolean) {
    var l = scope && scope.querySelectorAll ? toArr(scope.querySelectorAll('iframe[data-sk-lazy]')) : []
    for (var i = 0; i < l.length; i++) setRun(l[i], on)
  }
  function parseCues(s: any): any[] {
    if (!s) return []
    try { var a = JSON.parse(s); return Array.isArray(a) ? a : [] } catch (e) { return [] }
  }

  function seek(v: any, t: number) {
    function go() { try { v.currentTime = t } catch (e) { /* 还不能跳 */ } }
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true })
  }
  /** 放：有声被浏览器拦（没有使用者手势）⇒ 退成静音再放（总比不动好） */
  function play(v: any) {
    var p = null
    try { p = v.play() } catch (e) { p = null }
    if (p && p.catch) p.catch(function () { v.muted = true; var q = v.play(); if (q && q.catch) q.catch(function () { /* 真放不了 */ }) })
  }

  /**
   * 执行核心（一个「范围」＝放映的一页 section 或编辑画布的 [data-sk-canvas]）。
   * scopeAll()＝要找程序 iframe 的整个范围（放映＝整份文件；编辑器＝画布）。
   */
  function Engine(win: any, scopeAll: () => any) {
    function frames(): any[] { var r = scopeAll(); return r ? toArr(r.querySelectorAll('iframe[data-sk-prog]')) : [] }
    function rec(el: any): any {
      if (!el.__skp) {
        el.__skp = {
          el: el, id: attr(el, 'data-sk-prog'),
          n: Math.max(0, Math.min(MAXN, Math.floor(num(attr(el, 'data-sk-steps'))))),
          explicit: Math.max(0, Math.floor(num(attr(el, 'data-sk-explicit')))),
          cues: parseCues(attr(el, 'data-sk-cues')),
          cur: 0, ready: false, implicitDone: 0, timers: [],
        }
      }
      return el.__skp
    }
    /** 送「走到已做完 index 步」：没 ready 也先送（载入了就收得到）·ready 时再补送一次现况 */
    function send(p: any, index: number, animate: boolean) {
      p.cur = index
      var w = null
      try { w = p.el.contentWindow } catch (e) { w = null }
      if (w) try { w.postMessage({ __dlp: 1, type: 'step', index: index, animate: !!animate }, '*') } catch (e) { /* */ }
    }
    function onMsg(e: any) {
      var m = parseMsg(e.data)
      if (!m) return
      var el = frameOf(frames(), e.source)
      if (!el) return
      var p = rec(el)
      if (m.type === 'steps') p.n = m.steps
      else if (m.type === 'ready') { p.ready = true; if (p.cur > 0) send(p, p.cur, false) }
    }
    win.addEventListener('message', onMsg)

    function markers(scope: any): any[] { return toArr(scope.querySelectorAll('[data-sk-act]')) }
    function progs(scope: any): any[] { return toArr(scope.querySelectorAll('iframe[data-sk-prog]')).map(rec) }
    function progById(scope: any, id: any): any {
      var l = scope.querySelectorAll('iframe[data-sk-prog]')
      for (var i = 0; i < l.length; i++) if (attr(l[i], 'data-sk-prog') === id) return rec(l[i])
      return null
    }
    function videoById(scope: any, id: any): any {
      var l = scope.querySelectorAll('[data-sk-id]')
      for (var i = 0; i < l.length; i++) if (attr(l[i], 'data-sk-id') === id) return l[i].querySelector('video')
      return null
    }
    /** 本范围里的影片组件（组件外框里的 <video>·去重）；幻灯片背景填充那支同片（data-sk-bgfv）归 transition.ts 管·不算 */
    function compVideos(scope: any): any[] {
      var out: any[] = []
      var l = scope.querySelectorAll('[data-sk-id]')
      for (var i = 0; i < l.length; i++) {
        var vs = l[i].querySelectorAll('video')
        for (var k = 0; k < vs.length; k++) if (!vs[k].hasAttribute('data-sk-bgfv') && out.indexOf(vs[k]) < 0) out.push(vs[k])
      }
      return out
    }
    function animEls(scope: any, id: any): any[] {
      var out: any[] = []
      var l = scope.querySelectorAll('[data-sk-anim]')
      for (var i = 0; i < l.length; i++) if (attr(l[i], 'data-sk-anim') === id) out.push(l[i])
      return out
    }
    /** 书签：程序第 idx 步开始后 atSec 秒点亮点名的动画 */
    function fireCues(scope: any, p: any, idx: number) {
      for (var i = 0; i < p.cues.length; i++) {
        var c = p.cues[i]
        if (Math.floor(num(c.step)) !== idx) continue
        ;(function (c: any) {
          var t = setTimeout(function () {
            var ids = Array.isArray(c.anims) ? c.anims : []
            for (var k = 0; k < ids.length; k++) { var els = animEls(scope, ids[k]); for (var j = 0; j < els.length; j++) els[j].classList.add('visible') }
            reconcile(scope)
          }, Math.max(0, num(c.atSec)) * 1000)
          p.timers.push({ step: idx, t: t })
        })(c)
      }
    }
    /** 退回第 fromIdx 步之前：还没到点的书签取消·已点亮的熄掉 */
    function clearCues(scope: any, p: any, fromIdx: number) {
      var keep: any[] = []
      for (var i = 0; i < p.timers.length; i++) { if (p.timers[i].step >= fromIdx) clearTimeout(p.timers[i].t); else keep.push(p.timers[i]) }
      p.timers = keep
      for (var j = 0; j < p.cues.length; j++) {
        var c = p.cues[j]
        if (Math.floor(num(c.step)) < fromIdx) continue
        var ids = Array.isArray(c.anims) ? c.anims : []
        for (var k = 0; k < ids.length; k++) { var els = animEls(scope, ids[k]); for (var q = 0; q < els.length; q++) els[q].classList.remove('visible') }
      }
      reconcile(scope)
    }
    function isNoop(scope: any, m: any): boolean {
      if (attr(m, 'data-sk-act') !== 'program') return false
      var p = progById(scope, attr(m, 'data-sk-target'))
      var idx = Math.floor(num(attr(m, 'data-sk-idx')))
      return !p || idx < 1 || idx > p.n
    }
    function forward(scope: any, m: any) {
      var kind = attr(m, 'data-sk-act'), id = attr(m, 'data-sk-target')
      if (kind === 'program') {
        if (isNoop(scope, m)) return
        var p = progById(scope, id), idx = Math.floor(num(attr(m, 'data-sk-idx')))
        send(p, idx, true)
        fireCues(scope, p, idx)
      } else if (kind === 'media') {
        var v = videoById(scope, id)
        if (!v) return
        m.__skSnap = { t: v.currentTime || 0, paused: !!v.paused }
        var eff = attr(m, 'data-sk-effect'), s = attr(m, 'data-sk-seek')
        if (eff === 'play') { if (s !== null) seek(v, num(s)); play(v) }
        else if (eff === 'pause') v.pause()
        else if (eff === 'seek' && s !== null) seek(v, num(s))
      }
    }
    function reverse(scope: any, m: any) {
      var kind = attr(m, 'data-sk-act'), id = attr(m, 'data-sk-target')
      if (kind === 'program') {
        if (isNoop(scope, m)) return
        var p = progById(scope, id), idx = Math.floor(num(attr(m, 'data-sk-idx')))
        send(p, idx - 1, false)
        clearCues(scope, p, idx)
      } else if (kind === 'media') {
        var v = videoById(scope, id), snap = m.__skSnap
        if (!v || !snap) return
        seek(v, snap.t)
        if (snap.paused) v.pause(); else play(v)
      }
    }
    /** 对账：记号亮了没做的做（照文件顺序）·熄了做过的退（倒着退）；还在等延迟的直接取消 */
    function reconcile(scope: any) {
      var ms = markers(scope)
      for (var i = ms.length - 1; i >= 0; i--) {
        var m = ms[i]
        if (!m.__skOn || hasCls(m, 'visible')) continue
        m.__skOn = false
        if (m.__skT) { clearTimeout(m.__skT); m.__skT = 0 }
        if (m.__skDone) { m.__skDone = false; reverse(scope, m) }
      }
      for (var j = 0; j < ms.length; j++) {
        var n = ms[j]
        if (n.__skOn || !hasCls(n, 'visible')) continue
        n.__skOn = true
        ;(function (n: any) {
          var run = function () { n.__skT = 0; n.__skDone = true; forward(scope, n) }
          var d = num(attr(n, 'data-sk-delay'))
          if (d > 0) n.__skT = setTimeout(run, d); else run()
        })(n)
      }
    }
    /** 进页（或画布换了）：全部归零（程序回第 0 步·影片回开头·书签熄）再做自动那组 */
    function activate(scope: any) {
      var ms = markers(scope)
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i]
        if (m.__skT) { clearTimeout(m.__skT); m.__skT = 0 }
        m.__skOn = false; m.__skDone = false
        m.classList.remove('visible')
      }
      var cueEls = scope.querySelectorAll('.sk-cue.visible')
      for (var c = 0; c < cueEls.length; c++) cueEls[c].classList.remove('visible')
      var ps = progs(scope)
      for (var k = 0; k < ps.length; k++) {
        var p = ps[k]
        for (var q = 0; q < p.timers.length; q++) clearTimeout(p.timers[q].t)
        p.timers = []
        p.implicitDone = 0
        if (p.cur !== 0) send(p, 0, false)
      }
      scope.__skImp = []
      var seen: any[] = []
      for (var r = 0; r < ms.length; r++) {
        if (attr(ms[r], 'data-sk-act') !== 'media') continue
        var v = videoById(scope, attr(ms[r], 'data-sk-target'))
        if (!v || seen.indexOf(v) >= 0) continue
        seen.push(v)
        try { v.pause() } catch (e) { /* */ }
        seek(v, 0)
        if (v.autoplay) play(v)
      }
      // 标了自动播放的影片（背景／装饰片·没排影片步骤的）进页也主动从头放——⛔ 只靠 autoplay 属性：
      //   那是「文件载入」那一刻的事（不是「进到这页」）·浏览器还会按看不看得见自己停／不放 ⇒ 放映里封面那支停在 0 秒。
      //   排了影片步骤的上面那圈已处理（照旧：回开头·autoplay 才放·步骤再接手）。
      var cv = compVideos(scope)
      for (var w = 0; w < cv.length; w++) {
        var av = cv[w]
        if (seen.indexOf(av) >= 0 || !isAuto(av)) continue
        seen.push(av)
        try { av.pause() } catch (e) { /* */ }
        seek(av, 0)
        play(av)
      }
      for (var a = 0; a < ms.length; a++) if (ms[a].hasAttribute('data-sk-auto')) ms[a].classList.add('visible')
      reconcile(scope)
    }
    function isAuto(v: any): boolean { return !!(v && (v.autoplay || (v.hasAttribute && v.hasAttribute('autoplay')))) }
    /** 离开这页（放映换页）：这页的影片组件一律停（自动播放的、影片步骤放起来的、观众按控制列放的）；回来时 activate 再照规矩重来 */
    function deactivate(scope: any) {
      var cv = compVideos(scope)
      for (var i = 0; i < cv.length; i++) if (!cv[i].paused) try { cv[i].pause() } catch (e) { /* */ }
    }
    /** 这一组（data-step＝v）是不是全是空步（程序步骤超过程序回报的 N）·组里有别的东西（CSS 动画）或找不到 ⇒ 不是 */
    function groupNoop(scope: any, v: any): boolean {
      if (typeof v !== 'number' || !isFinite(v)) return false
      var els = scope.querySelectorAll('[data-step]'), any = false
      for (var i = 0; i < els.length; i++) {
        if (num(attr(els[i], 'data-step')) !== v || attr(els[i], 'data-step') === null) continue
        any = true
        if (!els[i].hasAttribute('data-sk-act') || !isNoop(scope, els[i])) return false
      }
      return any
    }
    /** 隐式步骤：本页单击组走完后·程序组件按叠层由下而上·每步一次 */
    function implicitNext(scope: any): boolean {
      var ps = progs(scope)
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]
        if (p.implicitDone >= implicitCount(p.n, p.explicit)) continue
        p.implicitDone++
        var idx = p.explicit + p.implicitDone
        if (!scope.__skImp) scope.__skImp = []
        scope.__skImp.push(p)
        send(p, idx, true)
        fireCues(scope, p, idx)
        return true
      }
      return false
    }
    function implicitPrev(scope: any): boolean {
      var st = scope.__skImp
      if (!st || !st.length) return false
      var p = st.pop()
      var idx = p.explicit + p.implicitDone
      p.implicitDone--
      send(p, idx - 1, false)
      clearCues(scope, p, idx)
      return true
    }
    function destroy() {
      win.removeEventListener('message', onMsg)
    }
    return { reconcile: reconcile, activate: activate, deactivate: deactivate, isAuto: isAuto, groupNoop: groupNoop, implicitNext: implicitNext, implicitPrev: implicitPrev, rec: rec, destroy: destroy, onMsg: onMsg }
  }

  /** 放映产物：盯 class 变化（换页＝section.active 换手·换步＝记号 .visible）＋包导航的 nextStep／prevStep */
  function install(win: any, doc: any) {
    if (!doc || !doc.body || typeof MutationObserver === 'undefined' || win.__skSteps) return
    win.__skSteps = 1
    var eng = Engine(win, function () { return doc })
    var cur: any = null
    function activeSec() { return doc.querySelector('section.slide.active,div.slide.active') }
    function check() {
      var s = activeSec()
      if (s !== cur) { var was = cur; cur = s; if (was) { eng.deactivate(was); runScope(was, false) } if (s) { runScope(s, true); eng.activate(s) } } else if (s) eng.reconcile(s)
    }
    // 别页（不是当下这页）上标了自动播放的影片·载好了被 autoplay 属性带起来 ⇒ 当场停（进到那页才由 activate 从头放）
    function secOf(el: any): any {
      for (var p = el; p; p = p.parentNode) if (p.classList && p.classList.contains('slide') && (p.tagName === 'SECTION' || p.tagName === 'DIV')) return p
      return null
    }
    function guard(e: any) {
      var v = e && e.target
      if (!v || v.tagName !== 'VIDEO' || !eng.isAuto(v) || v.hasAttribute('data-sk-bgv') || v.hasAttribute('data-sk-bgfv')) return
      var s = secOf(v)
      if (s && s !== activeSec()) try { v.pause() } catch (er) { /* */ }
    }
    if (doc.addEventListener) doc.addEventListener('play', guard, true)
    var mo = new MutationObserver(function () { check() })
    mo.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
    function wrap(): boolean {
      if (win.__skStepsWrapped) return true
      if (typeof win.nextStep !== 'function' || typeof win.prevStep !== 'function') return false
      win.__skStepsWrapped = 1
      var on = win.nextStep, op = win.prevStep
      win.nextStep = function () {
        var s = activeSec()
        for (var g = 0; g < 500; g++) {
          if (!on()) break
          check()
          if (!s || !eng.groupNoop(s, win.step)) return true
        }
        return s ? eng.implicitNext(s) : false
      }
      win.prevStep = function () {
        var s = activeSec()
        if (s && eng.implicitPrev(s)) return true
        for (var g = 0; g < 500; g++) {
          var before = win.step
          if (!op()) return false
          check()
          if (!s || !eng.groupNoop(s, before)) return true
        }
        return false
      }
      return true
    }
    if (!wrap()) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', wrap)
      setTimeout(wrap, 0)
    }
    check()
    // 开场：别页上已经被带起来的（脚本跑到这之前就载好开播的）一并停
    var all = doc.querySelectorAll('section.slide,div.slide')
    // 别页的程序 iframe 一律回静态（编辑层序列化回存时可能带着 allow-scripts 进库·这里兜底）
    for (var q = 0; q < all.length; q++) if (all[q] !== cur) { eng.deactivate(all[q]); runScope(all[q], false) }
  }

  /**
   * 编辑页预览用的小播放器（组件版画布不跑 CSS 动画 ⇒ 只走影片／程序记号与隐式步骤）。
   * getRoot()＝当下的画布根（[data-sk-canvas]）·换了（换页／重画）⇒ 从头开始。next()／prev() 回 false＝本页走完（交给宿主换页）。
   */
  function controller(win: any, getRoot: () => any) {
    var eng = Engine(win, getRoot)
    var root: any = null, step = 0
    function sync() {
      var r = getRoot()
      if (r !== root) { root = r; step = 0; if (r) eng.activate(r) }
      return r
    }
    function groups(r: any): number[] {
      var vals: number[] = []
      var ms = r.querySelectorAll('[data-sk-act][data-step]')
      for (var i = 0; i < ms.length; i++) { var v = num(attr(ms[i], 'data-step')); if (v > 0 && vals.indexOf(v) < 0) vals.push(v) }
      return vals.sort(function (a, b) { return a - b })
    }
    function setGroup(r: any, v: number, on: boolean) {
      var ms = r.querySelectorAll('[data-sk-act][data-step]')
      for (var i = 0; i < ms.length; i++) if (num(attr(ms[i], 'data-step')) === v) { if (on) ms[i].classList.add('visible'); else ms[i].classList.remove('visible') }
    }
    function next(): boolean {
      var r = sync()
      if (!r) return false
      var gs = groups(r)
      while (step < gs.length) {
        var v = gs[step]
        step++
        setGroup(r, v, true)
        eng.reconcile(r)
        if (!eng.groupNoop(r, v)) return true
      }
      return eng.implicitNext(r)
    }
    function prev(): boolean {
      var r = sync()
      if (!r) return false
      if (eng.implicitPrev(r)) return true
      var gs = groups(r)
      while (step > 0) {
        step--
        var v = gs[step]
        setGroup(r, v, false)
        eng.reconcile(r)
        if (!eng.groupNoop(r, v)) return true
      }
      return false
    }
    /** 这一页有没有东西可走（有记号或程序组件） */
    function has(): boolean {
      var r = sync()
      return !!r && !!r.querySelector('[data-sk-act],iframe[data-sk-prog]')
    }
    function reset() { root = null; sync() }
    sync()
    return { next: next, prev: prev, has: has, reset: reset, destroy: eng.destroy }
  }

  return { parseMsg: parseMsg, frameOf: frameOf, implicitCount: implicitCount, setRun: setRun, runScope: runScope, Engine: Engine, install: install, controller: controller }
}

/** deck-html 产物里那段脚本（工厂原文＋install·放在导航脚本之后；导航脚本被换到更后面也行——包导航等到 DOMContentLoaded） */
export function stepsScript(): string {
  return `<script id="__sk_steps__">(${skStepsFactory.toString()})().install(window,document);</script>`
}
