/* 旋转视图（PS：R，与抓手同一格）—— 原码没有·照 PS 2020 写
   ArtCraft PhotoCraft 里没有旋转视图工具（grep RotateView／rotate_view 只在 engine/src/prefs.rs:644 有一个「触控板旋转视图」偏好开关，没有实作）。
   照 Photoshop 2020 的行为：
     · 拖曳＝绕「视窗正中」转动画布的显示（只转画面，不改像素、不进历史，跟抓手／缩放一样是视角）
     · 拖曳时画面正中出现罗盘：红色指针指着文件的「上」
     · 按住 Shift 拖＝以 15° 为一级
     · Esc ／选项栏「复位视图」＝转回 0°
     · 选项栏：旋转角度（数字栏，−180…180，可直接打）、「复位视图」钮、「旋转所有窗口」勾选（我们只有一个文件视窗，勾了也只转这一个，状态照存）
     · 换新文件（PS 的新视窗）＝角度回 0
     · 按住 R 拖（或按住超过 0.5 秒）＝临时旋转，放开 R 回原工具；只按一下 R＝换成旋转视图（PS 弹簧键）
   转过后别的档要画面↔文件换算，一律用 RotView.toDoc／toScreen（aiui.js 游标、ctxmenu.js 右键、ps-view 标尺参考线、scrollbars.js 外接框）。
   角度约定：正数＝画面顺时针转（同 CSS rotate）。

   我们的画面：#view 是一张画布，HandView（hand.js）用 CSS translate 平移、PsView（menus/impl/ps-view.js）水平翻转时接 scaleX(-1)。
   这一档用挂钩做完、不改共用层：
     ① 包 HandView.apply：在 translate 之后、scaleX(-1) 之前插入 rotate(θdeg)（transform-origin＝画布正中）
     ② 包 Pointer.onDown/onMove/onUp/onDblClick：ui.js 的 toDoc 用 getBoundingClientRect（转过就是外接框、会错），
        转角≠0 时改由 client 坐标反转回「没转之前」的文件点再交下去（翻转与吸附仍由里面 ps-view 那层处理）
     ③ 包 ZoomView.toDoc／toScreen：缩放工具、Ctrl＋滚轮绕游标缩放在转过的画面上照样钉住游标下那一点
     ④ 包 UI.overlayCtx：放大模式（>100%）的叠画层另画在一张不转的画布上，转角≠0 时把旋转并进它的底矩阵，锚点、选区、笔尖圈跟着画面转
   挂钩一律在 window 'load' 时才装（ps-view 的挂钩在 DOMContentLoaded 前后装好）⇒ 我们这层在最外面；转角＝0 时全部原样直通，不碰旧行为。 */
(function(){
if (window.RotView) return;

const STRINGS = {
  'zh-Hant':{'tool.rotateview':'旋轉檢視', 'opt.rvAngle':'旋轉角度：', 'ui.rvReset':'重設檢視', 'opt.rvAll':'旋轉所有視窗',
             'ui.rvHint':'拖曳以旋轉畫面（不改像素）· Shift＝15° 一級 · Esc＝重設'},
  'zh-Hans':{'tool.rotateview':'旋转视图', 'opt.rvAngle':'旋转角度：', 'ui.rvReset':'复位视图', 'opt.rvAll':'旋转所有窗口',
             'ui.rvHint':'拖动以旋转画面（不改像素）· Shift＝15° 一级 · Esc＝复位'},
  'en':{'tool.rotateview':'Rotate View', 'opt.rvAngle':'Rotation Angle:', 'ui.rvReset':'Reset View', 'opt.rvAll':'Rotate All Windows',
        'ui.rvHint':'Drag to rotate the view (pixels unchanged) · Shift = 15° steps · Esc = reset'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

const RAD = Math.PI / 180;
/* 角度归一到 (−180, 180] */
const norm = a => { if (!isFinite(a)) return 0; let v = ((a % 360) + 360) % 360; if (v > 180) v -= 360; return Math.abs(v) < 1e-9 ? 0 : v; };
const flipped = () => !!(window.PsView && PsView.flipped && PsView.flipped());

const RotView = window.RotView = {
  angle: 0,                 // 画面顺时针转几度
  rotateAll: false,         // 选项栏「旋转所有窗口」（只有一个视窗：记着而已）
  drag: null,               // {pivot:[cx,cy] 画面点, a0 按下时的角度, p0 按下时指针对 pivot 的方位角}
  serial: null,             // 角度属于哪一份文件（Doc.serial）；换文件回 0
  el(){ return document.getElementById('view'); },
  wrap(){ return document.getElementById('canvasWrap'); },
  /* 画布正中（画面坐标）：转动绕正中、外接框正中＝画布正中 */
  center(){ const b = this.el().getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; },
  /* 视窗正中（画面坐标）＝PS 转视图的轴心 */
  viewCenter(){ const r = this.wrap().getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  /* 画面点 → 「还没翻转」的文件点（＝没转时 ui.js toDoc 会给的那个） */
  toLayoutDoc(cx, cy){
    const C = this.center(), z = UI.zoom || 1, a = -this.angle * RAD;
    const dx = cx - C[0], dy = cy - C[1];
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    return [rx / z + Doc.width / 2, ry / z + Doc.height / 2];
  },
  /* 画面点 → 文件点（含翻转） */
  toDoc(cx, cy){ const d = this.toLayoutDoc(cx, cy); if (flipped()) d[0] = Doc.width - d[0]; return d; },
  /* 文件点 → 画面点（含翻转与旋转） */
  toScreen(d){
    const C = this.center(), z = UI.zoom || 1, a = this.angle * RAD;
    const x = ((flipped() ? Doc.width - d[0] : d[0]) - Doc.width / 2) * z, y = (d[1] - Doc.height / 2) * z;
    return [C[0] + x * Math.cos(a) - y * Math.sin(a), C[1] + x * Math.sin(a) + y * Math.cos(a)];
  },
  /* 设角度：绕 pivot（画面点，缺省＝视窗正中）转，pivot 底下那个文件点不动 */
  set(angle, pivot){
    const na = norm(angle), d = na - this.angle;
    this.serial = Doc.serial;
    if (!d){ this.apply(); return na; }
    const P = pivot || this.viewCenter(), C = this.center();
    const vx = C[0] - P[0], vy = C[1] - P[1], c = Math.cos(d * RAD), s = Math.sin(d * RAD);
    this.angle = na;
    // 画布正中绕轴心转 d 度：平移补上差额（HandView 的平移是画面空间的，转不转都一样）
    const nx = vx * c - vy * s, ny = vx * s + vy * c;
    if (window.HandView && (Math.abs(nx - vx) > 1e-9 || Math.abs(ny - vy) > 1e-9)) HandView.panBy(nx - vx, ny - vy);
    this.apply();
    return na;
  },
  reset(){ return this.set(0); },
  apply(){
    if (window.HandView) HandView.apply(); else this.decorate();
    if (window.UI && UI.ctx) UI.drawView();
    this.syncField();
  },
  /* 在 HandView 设好的 transform 上插入 rotate（翻转的 scaleX(-1) 放最后：先翻、再转、再平移） */
  decorate(){
    const v = this.el(); if (!v) return;
    let t = (v.style.transform || '').replace(/\s*rotate\([^)]*\)/g, '');
    const flip = /scaleX\(-1\)/.test(t);
    t = t.replace(/\s*scaleX\(-1\)/g, '').trim();
    if (this.angle) t = (t + ` rotate(${this.angle}deg)`).trim();
    if (flip) t = (t + ' scaleX(-1)').trim();
    v.style.transform = t;
  },
  syncField(){ const f = document.getElementById('rvAngle'); if (f && document.activeElement !== f) f.value = String(Math.round(this.angle * 100) / 100); },
  info(){ return {angle:this.angle, rotateAllWindows:this.rotateAll}; },

  /* ── 拖曳（滑鼠与 rotateview.drag 命令共用）：方位角＝指针对轴心的 atan2 ── */
  dragStart(p){ if (Spring.prev) Spring.used = true; const P = this.viewCenter(); this.drag = {pivot:P, a0:this.angle, p0:Math.atan2(p[1] - P[1], p[0] - P[0]) / RAD}; Compass.show(); },
  dragMove(p, shift){
    const g = this.drag; if (!g) return;
    let a = g.a0 + (Math.atan2(p[1] - g.pivot[1], p[0] - g.pivot[0]) / RAD - g.p0);
    if (shift) a = Math.round(a / 15) * 15;           // Shift：15° 一级
    this.set(a, g.pivot);
    Compass.show();
  },
  dragEnd(p, shift){ if (p) this.dragMove(p, shift); this.drag = null; Compass.hide(); if (Spring.pending) setTimeout(() => Spring.revert(), 0); }
};

/* ── 按住 R 临时旋转（PS 的「弹簧键」：按一下 R＝换成旋转视图；按住 R 拖／按久了，放开 R 回原工具） ── */
const SPRING_MS = 500;   // 按住超过这么久（没拖也算）放开就回原工具
const Spring = window.RotViewSpring = {
  prev: null, t0: 0, used: false, pending: false,
  isR(e){ return (e.key === 'r' || e.key === 'R' || e.code === 'KeyR') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey; },
  typing(e){ const t = e.target; return !!(t && (/input|select|textarea/i.test(t.tagName || '') || t.isContentEditable)); },
  revert(){
    const p = this.prev; this.prev = null; this.pending = false; this.used = false;
    if (p && ToolState.cur === 'rotateview' && Tools.get(p)) UI.setTool(p);
  }
};
window.addEventListener('keydown', e => {
  if (!Spring.isR(e) || Spring.typing(e)) return;
  if (e.repeat){ if (Spring.prev){ e.preventDefault(); e.stopImmediatePropagation(); } return; }   // 按住时的连发不再换工具
  const cur = window.ToolState && ToolState.cur;
  if (!cur || cur === 'rotateview') return;
  Spring.prev = cur; Spring.t0 = Date.now(); Spring.used = false; Spring.pending = false;
  // 照常往下交给工具列快捷键（换成旋转视图）；换不过去（例如矢量模式下 R 是别的工具）⇒ 不算弹簧
  setTimeout(() => { if (Spring.prev === cur && ToolState.cur !== 'rotateview') Spring.prev = null; }, 0);
}, true);
window.addEventListener('keyup', e => {
  if (!(e.key === 'r' || e.key === 'R' || e.code === 'KeyR') || !Spring.prev) return;
  if (ToolState.cur !== 'rotateview'){ Spring.prev = null; return; }
  if (!(Spring.used || Date.now() - Spring.t0 >= SPRING_MS)){ Spring.prev = null; return; }   // 只是按一下：留在旋转视图
  if (RotView.drag) Spring.pending = true; else Spring.revert();   // 还在拖：放开滑鼠再回
}, true);
window.addEventListener('blur', () => { if (Spring.prev && !RotView.drag){ if (Spring.used) Spring.revert(); else Spring.prev = null; } });

/* ── 罗盘（PS 拖曳时画面正中那个：圆盘＋红针指着文件的上方） ── */
const Compass = window.RotViewCompass = {
  el: null,
  ensure(){
    if (this.el && this.el.isConnected) return this.el;
    const NS = 'http://www.w3.org/2000/svg', w = RotView.wrap(); if (!w) return null;
    const s = document.createElementNS(NS, 'svg'); s.id = 'rvCompass';
    s.setAttribute('width', '120'); s.setAttribute('height', '120'); s.setAttribute('viewBox', '-60 -60 120 120');
    s.style.cssText = 'position:absolute;pointer-events:none;z-index:6;display:none;overflow:visible';
    s.innerHTML = '<circle r="52" fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.85)" stroke-width="1.5"/>' +
      '<g id="rvNeedle"><polygon points="0,-48 7,0 -7,0" fill="#e0302a"/><polygon points="0,48 7,0 -7,0" fill="#ddd"/><circle r="3" fill="#222"/></g>';
    w.appendChild(s); this.el = s; return s;
  },
  show(){
    const s = this.ensure(); if (!s) return;
    const w = RotView.wrap().getBoundingClientRect(), P = RotView.viewCenter();
    s.style.left = (P[0] - w.left - 60) + 'px'; s.style.top = (P[1] - w.top - 60) + 'px';
    s.querySelector('#rvNeedle').setAttribute('transform', `rotate(${RotView.angle})`);
    s.style.display = '';
  },
  hide(){ if (this.el) this.el.style.display = 'none'; },
  shown(){ return !!(this.el && this.el.style.display !== 'none'); }
};

/* ── 挂钩（load 时装：在 ps-view 等的挂钩外面） ── */
function install(){
  if (RotView._installed || !window.UI || !UI.canvas) return;
  RotView._installed = true;
  RotView.serial = Doc.serial;
  // ① HandView.apply：插入 rotate
  if (window.HandView){
    const ap = HandView.apply;
    HandView.apply = function(){ const r = ap.apply(this, arguments); RotView.decorate(); return r; };
  }
  // ② Pointer：转过的画面上用 client 坐标反算文件点
  if (window.Pointer){
    ['onDown', 'onMove', 'onUp', 'onDblClick'].forEach(k => {
      const o = Pointer[k];
      Pointer[k] = function(e, pt){
        if (RotView.angle && e && typeof e.clientX === 'number' && pt) pt = RotView.toLayoutDoc(e.clientX, e.clientY);
        return o.call(this, e, pt);
      };
    });
  }
  // ③ ZoomView：缩放锚点
  if (window.ZoomView){
    const td = ZoomView.toDoc, ts = ZoomView.toScreen;
    ZoomView.toDoc = function(p){ return RotView.angle ? RotView.toDoc(p[0], p[1]) : td.call(this, p); };
    ZoomView.toScreen = function(d){ return RotView.angle ? RotView.toScreen(d) : ts.call(this, d); };
  }
  // ④ 放大模式的叠画层：把旋转并进底矩阵（照抄 ui.js overlayCtx 的代理，只换 B）
  const oc0 = UI.overlayCtx;
  UI.overlayCtx = function(s){
    if (!s || !RotView.angle) return oc0.apply(this, arguments);
    const r0 = oc0.apply(this, arguments); if (!r0) return r0;
    const oc = this._ov, real = oc.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wr = this.wrap.getBoundingClientRect(), C = RotView.center();
    const B = new DOMMatrix().translate((C[0] - wr.left - this.wrap.clientLeft) * dpr, (C[1] - wr.top - this.wrap.clientTop) * dpr)
      .rotate(RotView.angle).scale(flipped() ? -1 : 1, 1).translate(-Doc.width * s / 2, -Doc.height * s / 2);
    real.setTransform(B);
    const self = this, fake = {width:Math.round(Doc.width * s), height:Math.round(Doc.height * s), style:oc.style,
      getBoundingClientRect:() => self.canvas.getBoundingClientRect()};
    const toM = a => a.length === 1 ? DOMMatrix.fromMatrix(a[0]) : (a.length ? new DOMMatrix(a) : new DOMMatrix());
    return new Proxy(real, {
      get(t, k){
        if (k === 'canvas') return fake;
        if (k === 'setTransform') return (...a) => t.setTransform(B.multiply(toM(a)));
        if (k === 'resetTransform') return () => t.setTransform(B);
        if (k === 'getTransform') return () => B.inverse().multiply(t.getTransform());
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v){ t[k] = v; return true; }
    });
  };
  // ⑤ 换文件（PS 的新视窗）＝角度回 0
  const rf = UI.refresh;
  UI.refresh = function(){
    if (RotView.angle && RotView.serial !== Doc.serial){ RotView.angle = 0; RotView.serial = Doc.serial; RotView.decorate(); }
    else if (RotView.serial !== Doc.serial) RotView.serial = Doc.serial;
    return rf.apply(this, arguments);
  };
  RotView.decorate();
}
if (document.readyState === 'complete') install(); else window.addEventListener('load', install);

/* ── 命令：视角不是文件内容 ⇒ 不进历史（同 hand.*／zoom.*） ── */
const num = v => (v === undefined || v === null || v === '' || !isFinite(Number(v))) ? null : Number(v);
CMD.reg('rotateview.set', {i18n:'tool.rotateview',
  params:'{angle} 度数（正＝画面顺时针；归一到 −180…180）＝选项栏「旋转角度」打数字：绕视窗正中转画面显示，不改像素、不进历史 → {angle, rotateAllWindows}'},
  p => { const a = num(p.angle); if (a === null) return Object.assign({ok:false, error:'angle required'}, RotView.info()); install(); RotView.set(a); return RotView.info(); });
CMD.reg('rotateview.rotateBy', {i18n:'',
  params:'{delta, shift=false} 在目前角度上再转 delta 度（shift＝结果取到 15° 一级，同按 Shift 拖）→ {angle, rotateAllWindows}'},
  p => {
    const d = num(p.delta); if (d === null) return Object.assign({ok:false, error:'delta required'}, RotView.info());
    install(); let a = RotView.angle + d; if (p.shift) a = Math.round(a / 15) * 15;
    RotView.set(a); return RotView.info();
  });
CMD.reg('rotateview.drag', {i18n:'',
  params:'{from:[dx,dy], to:[dx,dy] 指针相对视窗正中的画面像素, shift=false} 同滑鼠按住拖：角度 += to 的方位角 − from 的方位角（shift＝15° 一级）→ {angle, rotateAllWindows}'},
  p => {
    const f = Array.isArray(p.from) ? p.from.map(Number) : null, t = Array.isArray(p.to) ? p.to.map(Number) : null;
    if (!f || !t || ![...f, ...t].every(isFinite)) return Object.assign({ok:false, error:'from/to required'}, RotView.info());
    install(); const P = RotView.viewCenter();
    RotView.dragStart([P[0] + f[0], P[1] + f[1]]); RotView.dragEnd([P[0] + t[0], P[1] + t[1]], !!p.shift);
    return RotView.info();
  });
CMD.reg('rotateview.reset', {i18n:'', params:'{} 选项栏「复位视图」／Esc：角度回 0（视窗正中对着的文件点不动）→ {angle, rotateAllWindows}'},
  () => { install(); RotView.reset(); return RotView.info(); });
CMD.reg('rotateview.options', {i18n:'', params:'{rotateAllWindows?:bool} 选项栏勾选（我们只有一个文件视窗：只记状态）；{} 只读 → {angle, rotateAllWindows}'},
  p => {
    if (typeof p.rotateAllWindows === 'boolean') RotView.rotateAll = p.rotateAllWindows;
    const cb = document.getElementById('rvAll'); if (cb) cb.checked = RotView.rotateAll;
    return RotView.info();
  });
CMD.reg('rotateview.info', {i18n:'', params:'{} 读目前视图旋转角度 → {angle, rotateAllWindows}'}, () => RotView.info());

/* ── 工具 ── */
Tools.reg({
  id:'rotateview', icon:'⟲', group:'misc', order:35, for:'raster', opts:[], cursor:'grab',
  strings:STRINGS,
  buildOptions(box, add, mk){
    const f = mk('number', {min:-180, max:180, step:'any', value:String(Math.round(RotView.angle * 100) / 100)});
    f.id = 'rvAngle'; f.style.width = '64px';
    f.onchange = () => { const v = Number(f.value); if (isFinite(v)) CMD.run('rotateview.set', {angle:v}); f.value = String(Math.round(RotView.angle * 100) / 100); };
    add('rvAngle', f);
    const b = document.createElement('button'); b.type = 'button'; b.id = 'rvReset'; b.textContent = Lang.t('ui.rvReset');
    b.onclick = () => CMD.run('rotateview.reset'); box.appendChild(b);
    const cb = mk('checkbox', {checked:RotView.rotateAll}); cb.id = 'rvAll';
    cb.onchange = () => CMD.run('rotateview.options', {rotateAllWindows:cb.checked});
    add('rvAll', cb);
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.rvHint'); box.appendChild(h);
  },
  onDown(e){
    if (e.button !== undefined && e.button !== 0) return;
    install();
    RotView.dragStart([e.clientX, e.clientY]);
    UI.canvas.style.cursor = 'grabbing';
  },
  onMove(e, pt, P){
    if (!P.down || !RotView.drag) return;
    RotView.dragMove([e.clientX, e.clientY], e.shiftKey);
  },
  onUp(e){
    if (!RotView.drag) return;
    RotView.dragEnd([e.clientX, e.clientY], e.shiftKey);
    UI.canvas.style.cursor = 'grab';
  },
  onKey(e){
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault();
      if (RotView.drag){ RotView.drag = null; Compass.hide(); }
      CMD.run('rotateview.reset'); return true;
    }
    return false;
  },
  onDeactivate(){ if (RotView.drag){ RotView.drag = null; Compass.hide(); } }
});
})();
