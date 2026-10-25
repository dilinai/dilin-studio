/* 对象选择（W）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/retouch_ui.rs  71-95        finish_object_selection：拖出的矩形（宽或高 <2 ⇒ 什么都不做）；⌥ 减去、⇧ 增加、否则新选区；rect 四舍五入；取样所有图层
     ui-egui/src/retouch_ui.rs  203-210      选项栏：取样所有图层、「围着对象拖一个矩形」提示、「选择主体」钮
     ui-egui/src/tool_feedback.rs 52-60      selection_mode：⌥ 减去、⇧ 增加、否则 replace（不看选项栏）；标记在游标右下 (30,11)
     ui-egui/src/canvas.rs  1890-1901        拖曳预览＝行军蚁矩形（不画 W/H 读数，那只给选框）
     ui-egui/src/canvas.rs  1942-1964, 2110-2160  tool_move（Space＝整个框跟着走 shift_to；曼哈顿 >0.25 才记）、放开、finish_gesture → finish_object_selection(d.start, end, 按下时的修饰键)
     ui-egui/src/hold_keys.rs 103            拖着对象选择框时 Space＝重新定位（不变抓手）
     ui-egui/src/snap_ui.rs 80-95 ＋ engine/src/snap.rs   is_point_tool：框角吸附（文件边／中线、图层边／中线、选区边；拖的途中按 Ctrl 暂停）
     engine/src/smartselect_cmds.rs 106-120, 233-238   rect_param（负宽高＝往左上拖，正规化；floor／ceil）、object_selection（mode 预设 replace、可 intersect）
     algo/src/segment/grabcut.rs 1-118       GrabCut（矩形外＝确定背景、里面＝可能前景；每边 5 分量 GMM、γ=50、最多 8 回、改动 <1/2000 停）、object_select（外扩 15%（≥8）的窗、16 万像素工作解析度、
                                             clean_mask(0.1, 0.002)、全解析度沿边重切）
   分割核心（GMM／最大流／finish_region／combine_region…）在 tools/quickselect.js 的 window.SmartSeg（已照 segment/*.rs 翻好），这里读它。
   ── 加的（原码无·照 PS 2020）：选项栏「模式：矩形／套索」 ──
     PS 2020 对象选择工具的选项栏有「模式」下拉：矩形（拖框，同原码）／套索（围着对象手绘一圈粗略的套索）。原码 select.object 只收 rect，
     套索模式照 PS 行为做：套索外＝确定背景、套索内＝可能前景跑同一套 GrabCut（跟矩形同样外扩 15%／≥8 的工作窗、16 万像素工作解析度、clean_mask、沿边重切），
     最后再裁回套索内（套索外的像素一定不选）。修饰键同矩形（⇧ 增加、⌥ 减去）；拖曳中 Space＝整圈跟着走；不吸附（PS 套索不吸附）；不到 3 点或外框宽高 <2＝什么都不做。
   🔴 改文件的事全走 CMD：objectselect.select（＝select.object，进历史；给 rect 或 lasso）、objectselect.options。 */
(function(){
'use strict';

const CLICK_DIST = 6, CLICK_TIME = 800;       // egui 点击距离／时间（同 marquee.js）
const SNAP_PX = 8, DASH = 4;
const MODES = ['replace', 'add', 'subtract', 'intersect'];
const Seg = () => window.SmartSeg;

/* ── 套索模式（原码无·照 PS 2020） ── */
const GC_BG = 0, GC_PR_FG = 3;                 // 同 SmartSeg 里 grabcut.rs 的 trimap 值
const rInter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const rW = r => Math.max(0, r[2] - r[0]), rH = r => Math.max(0, r[3] - r[1]);
function lassoParam(p){
  const a = (Array.isArray(p.lasso) ? p.lasso : []).map(q => Array.isArray(q) ? [+q[0], +q[1]] : (q && typeof q === 'object') ? [+q.x, +q.y] : null)
    .filter(q => q && isFinite(q[0]) && isFinite(q[1]));
  return a.length >= 3 ? a : null;
}
/* 奇偶规则扫描线填多边形：格 (i,j) 的中心＝(ox + i·step, oy + j·step)（文件坐标），在多边形内 ⇒ out[j*w+i]=1 */
function polyFill(poly, w, h, ox, oy, step){
  const out = new Uint8Array(w * h), n = poly.length, xs = [];
  for (let j = 0; j < h; j++){
    const Y = oy + j * step; xs.length = 0;
    for (let k = 0; k < n; k++){
      const a = poly[k], b = poly[(k + 1) % n];
      if ((a[1] <= Y) !== (b[1] <= Y)) xs.push(a[0] + (Y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2){
      const i0 = Math.max(0, Math.ceil((xs[k] - ox) / step)), i1 = Math.min(w - 1, Math.ceil((xs[k + 1] - ox) / step) - 1);
      for (let i = i0; i <= i1; i++) out[j * w + i] = 1;
    }
  }
  return out;
}
/* object_select 的套索版：trimap＝套索外 GC_BG、套索内 GC_PR_FG；其余照 grabcut.rs object_select；最后裁回套索内 */
function objectSelectLasso(S, sampler, canvas, poly, workPx){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const rect = rInter([Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)], canvas);
  if (rW(rect) < 2 || rH(rect) < 2) return null;
  const margin = Math.max(Math.ceil(Math.max(rW(rect), rH(rect)) * 0.15), 8);
  const win = rInter([rect[0] - margin, rect[1] - margin, rect[2] + margin, rect[3] + margin], canvas);
  const step = S.scaleFor(win, workPx || 160000);
  const img = sampler.rgbScaled(win, step), lw = img.w, lh = img.h;
  const half = (step >> 1) + 0.5, inside = polyFill(poly, lw, lh, win[0] + half, win[1] + half, step);
  const trimap = new Uint8Array(lw * lh);
  let anyFg = false, anyBg = false;
  for (let i = 0; i < trimap.length; i++){ if (inside[i]){ trimap[i] = GC_PR_FG; anyFg = true; } else { trimap[i] = GC_BG; anyBg = true; } }
  if (!anyFg) return null;
  if (!anyBg){ const ring = Math.max((Math.min(lw, lh) / 50) | 0, 1); for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (x < ring || y < ring || x + ring >= lw || y + ring >= lh) trimap[y * lw + x] = GC_BG; }
  const models = S.grabcut(img, trimap, 8); if (!models) return null;
  const low = S.cleanMask(Uint8Array.from(trimap, t => (t === 1 || t === GC_PR_FG) ? 1 : 0), lw, lh, 0.1, 0.002);
  const reg = S.finishRegion(sampler, win, step, low, lw, lh, models); if (!reg) return null;
  const bw = rW(reg.bbox), bh = rH(reg.bbox), clip = polyFill(poly, bw, bh, reg.bbox[0] + 0.5, reg.bbox[1] + 0.5, 1);
  for (let i = 0; i < reg.mask.length; i++) if (!clip[i]) reg.mask[i] = 0;
  return S.trimRegion(reg);
}

/* smartselect_cmds.rs rect_param：[x,y,w,h]，负宽高正规化，外框 floor／ceil */
function rectParam(p){
  const a = Array.isArray(p.rect) ? p.rect.map(Number).filter(v => isFinite(v)) : [];
  if (a.length < 4) return null;
  const x0 = Math.min(a[0], a[0] + a[2]), x1 = Math.max(a[0], a[0] + a[2]), y0 = Math.min(a[1], a[1] + a[3]), y1 = Math.max(a[1], a[1] + a[3]);
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
}
CMD.reg('objectselect.select', {i18n:'tool.objectselect', undoable:true,
  params:'{rect:[x,y,w,h] 文件坐标（负宽高＝往左上拖，自动正规化） 或 lasso:[[x,y]…] 文件坐标 ≥3 点（套索模式：围着对象的粗略圈，圈外一定不选；两个都给＝用 lasso）, mode:"replace|add|subtract|intersect"="replace"（"new" 同 replace）, sampleAllLayers=false（false＝当前像素层，层移过照样对；不是像素层＝合成图）} ' +
         '同 PhotoCraft select.object：矩形外当确定背景、里面当可能前景跑 GrabCut（每边 5 分量高斯混合、对比敏感图割、最多 8 回），清碎块补小洞，大图沿边全解析度重切；找不到又是加／减＝选区与历史都不动 → {ok, selected, changed, bounds:[x,y,w,h]|null}'},
  p => {
    const S = Seg(); if (!S) return {ok:false, error:'select.object: SmartSeg (tools/quickselect.js) not loaded'};
    const poly = lassoParam(p), rect = poly ? null : rectParam(p);
    if (!poly && !rect) return {ok:false, error:'select.object: needs "rect": [x, y, w, h] or "lasso": [[x, y]…] (≥3 points)'};
    const m0 = typeof p.mode === 'string' ? p.mode : 'replace', mode = m0 === 'new' ? 'replace' : (MODES.includes(m0) ? m0 : 'replace');
    const W = Doc.width, H = Doc.height;
    if (poly) return S.applyRegion(objectSelectLasso(S, S.makeSampler(S.samplePixels(p.sampleAllLayers === true), W, H), [0, 0, W, H], poly, 160000), mode);
    const reg = S.objectSelect(S.makeSampler(S.samplePixels(p.sampleAllLayers === true), W, H), [0, 0, W, H], rect, 160000);
    return S.applyRegion(reg, mode);
  });

/* ── 吸附（snap.rs from_document／nearest／snap_point；跟 marquee.js 同一套，选框那支档的是私有的 ⇒ 抄一份） ── */
function alphaBounds(cv, ox, oy){
  const w = cv.width, h = cv.height; if (!w || !h) return null;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++){ const row = y * w * 4; for (let x = 0; x < w; x++) if (d[row + x * 4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : [x0 + ox, y0 + oy, x1 + 1 + ox, y1 + 1 + oy];
}
const layerRect = L => L.kind === 'raster' ? alphaBounds(L.data.canvas, L.x, L.y) : alphaBounds(renderLayer(L, 1), 0, 0);
function addRect(t, r){ t.x.push(r[0], r[2], (r[0] + r[2]) / 2); t.y.push(r[1], r[3], (r[1] + r[3]) / 2); }
function buildTargets(){
  const t = {x:[], y:[]};
  addRect(t, [0, 0, Doc.width, Doc.height]);
  for (const L of Doc.layers){ if (!L.visible || !L.data) continue; try { const r = layerRect(L); if (r) addRect(t, r); } catch(_){} }
  const s = Doc.sel; if (s && s.w > 0 && s.h > 0){ t.x.push(s.x, s.x + s.w); t.y.push(s.y, s.y + s.h); }
  return t;
}
const nearest = (list, v, tol) => { let best = null, bd = Infinity; for (const a of list){ const d = Math.abs(a - v); if (d <= tol && d < bd){ bd = d; best = a; } } return best; };
const snapOn = () => !(window.MoveTool && MoveTool.opt && MoveTool.opt.snap === false);

/* ── 工具状态 ── */
const OS = window.ObjectSelectTool = {
  opt: {sampleAllLayers:false, drawMode:'rectangle'},   // drawMode：PS 选项栏「模式」矩形／套索
  drag: null,          // canvas.rs Drag：{start, points, press, reposition, moved, t0, client0}
  snap: null, hover: null, held: {shift:false, alt:false}, space: false,
  zoom(){ return Math.max((window.UI && UI.zoom) || 1, 0.01); },
  last(){ const d = this.drag; return d.points.length ? d.points[d.points.length - 1] : d.start; },
  /* tool_feedback.rs:52-60 */
  mode(m){ return m.alt ? 'subtract' : m.shift ? 'add' : 'replace'; },
  snapApply(p, ctrl){
    const s = this.snap; if (!s) return p;
    if (ctrl !== undefined && !this.lasso()) s.disabled = !!ctrl;
    if (s.disabled) return p;
    const tol = SNAP_PX / this.zoom(), a = nearest(s.t.x, p[0], tol), b = nearest(s.t.y, p[1], tol);
    return [a === null ? p[0] : a, b === null ? p[1] : b];
  },
  shiftTo(to){                                           // Drag::shift_to
    const d = this.drag, last = this.last(), dx = to[0] - last[0], dy = to[1] - last[1];
    if (!isFinite(dx) || !isFinite(dy)) return;
    d.start = [d.start[0] + dx, d.start[1] + dy];
    d.points = d.points.map(p => [p[0] + dx, p[1] + dy]);
  },
  lasso(){ return this.opt.drawMode === 'lasso'; },
  down(pt, m){
    this.snap = {t: (snapOn() && !this.lasso()) ? buildTargets() : {x:[], y:[]}, disabled:this.lasso()};
    const p = this.snapApply(pt);
    this.drag = {start:p, points:[p], press:{shift:!!m.shift, alt:!!m.alt}, reposition:!!m.space, moved:!!m.moved, t0:performance.now(), client0:m.client || null};
  },
  move(pt, m){
    const d = this.drag; if (!d) return;
    if (m.space !== undefined) d.reposition = !!m.space;
    const p = this.snapApply(pt, m.ctrl);
    if (d.reposition) this.shiftTo(p);
    else { const last = this.last(); if (Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 0.25) d.points.push(p); }
  },
  up(pt, m){
    const d = this.drag; if (!d) return null;
    this.drag = null;
    if (!d.moved){ this.snap = null; return null; }      // 点一下：宽高 0 ⇒ finish_object_selection 直接返回
    if (m.space !== undefined) d.reposition = !!m.space;
    this.drag = d; const p = this.snapApply(pt, m.ctrl); if (d.reposition) this.shiftTo(p); this.drag = null; this.snap = null;
    const last = d.points.length ? d.points[d.points.length - 1] : d.start;
    if (last[0] !== p[0] || last[1] !== p[1]) d.points.push(p);
    if (this.lasso()) return this.finishLasso(d.points, d.press);
    return this.finish(d.start, d.points[d.points.length - 1], d.press);
  },
  /* 套索模式（原码无·照 PS）：放开＝闭合这一圈跑对象选择 */
  finishLasso(points, mods){
    if (points.length < 3) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of points){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    return CMD.run('objectselect.select', {lasso:points.map(q => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]), mode:this.mode(mods), sampleAllLayers:this.opt.sampleAllLayers});
  },
  /* retouch_ui.rs finish_object_selection */
  finish(start, end, mods){
    const x = Math.min(start[0], end[0]), y = Math.min(start[1], end[1]), w = Math.abs(end[0] - start[0]), h = Math.abs(end[1] - start[1]);
    if (w < 2 || h < 2) return null;
    return CMD.run('objectselect.select', {rect:[Math.round(x), Math.round(y), Math.round(w), Math.round(h)], mode:this.mode(mods), sampleAllLayers:this.opt.sampleAllLayers});
  }
};

CMD.reg('objectselect.options', {i18n:'', params:'{sampleAllLayers?=bool, drawMode?="rectangle"|"lasso"（PS 选项栏「模式」：拖框／手绘套索圈）} → 目前选项'},
  p => {
    if (typeof p.sampleAllLayers === 'boolean') OS.opt.sampleAllLayers = p.sampleAllLayers;
    if (p.drawMode === 'rectangle' || p.drawMode === 'lasso') OS.opt.drawMode = p.drawMode;
    if (window.UI && ToolState.cur === 'objectselect') UI.buildOptions('objectselect');
    return Object.assign({}, OS.opt);
  });
/* agent 送同一串滑鼠事件（跟人拿滑鼠走同一组 down/move/up：Space 重新定位、吸附、按下时的修饰键定模式） */
CMD.reg('objectselect.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up", x, y 文件坐标, shift?, alt?（down 时：⇧ 增加、⌥ 减去）, ctrl?（拖的途中＝不吸附）, space?（拖的途中＝整个框跟着走）}…], snap?=true, drawMode?="rectangle"|"lasso"（不给＝目前选项；lasso＝down/move/up 走过的点围成套索）} 拖一个框（或圈）跑对象选择；没 move 就 up＝点一下＝什么都不做 → {ok, selection}'},
  p => {
    const evs = Array.isArray(p.events) ? p.events : [], MT = window.MoveTool, saved = MT && MT.opt ? MT.opt.snap : undefined, dm = OS.opt.drawMode;
    if (p.snap === false && saved !== undefined) MT.opt.snap = false;
    if (p.drawMode === 'rectangle' || p.drawMode === 'lasso') OS.opt.drawMode = p.drawMode;
    try {
      for (const e of evs){
        const pt = [Number(e.x) || 0, Number(e.y) || 0], m = {shift:!!e.shift, alt:!!e.alt, ctrl:!!e.ctrl, space:!!e.space};
        if (e.kind === 'down') OS.down(pt, m);
        else if (e.kind === 'move' && OS.drag){ OS.drag.moved = true; OS.move(pt, m); }
        else if (e.kind === 'up' && OS.drag) OS.up(pt, m);
      }
    } finally { if (saved !== undefined) MT.opt.snap = saved; OS.opt.drawMode = dm; }
    if (window.UI) UI.draw();
    return {ok:true, selection:Doc.sel};
  });

/* ── 画 ── */
function ants(ctx, pts, closed, dpr){
  if (pts.length < 2) return;
  ctx.save(); ctx.lineWidth = 1;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath();
  ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}
function drawBadge(ctx, p, mode, dpr){
  if (mode === 'replace') return;
  const c = [p[0] + 30 * dpr, p[1] + 11 * dpr], h = 3.5 * dpr;
  const segs = mode === 'add' ? [[[c[0] - h, c[1]], [c[0] + h, c[1]]], [[c[0], c[1] - h], [c[0], c[1] + h]]] : [[[c[0] - h, c[1]], [c[0] + h, c[1]]]];
  ctx.save();
  for (const [w, col] of [[3, 'rgba(0,0,0,0.78)'], [1.2, '#fff']]){ ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath(); segs.forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke(); }
  ctx.restore();
}

const STRINGS = {
  'zh-Hant':{'opt.osMode':'模式：', 'ui.osRect':'矩形', 'ui.osLasso':'套索', 'opt.osSampleAll':'取樣全部圖層', 'ui.osSubject':'選取主體', 'ui.osHint':'在物件周圍拖曳一個矩形（套索模式＝圈一圈） · Shift 增加 · Alt 減去 · 拖曳中 Space 移動框、Ctrl 暫停對齊'},
  'zh-Hans':{'opt.osMode':'模式：', 'ui.osRect':'矩形', 'ui.osLasso':'套索', 'opt.osSampleAll':'对所有图层取样', 'ui.osSubject':'选择主体', 'ui.osHint':'围着对象拖出一个矩形（套索模式＝圈一圈） · Shift 添加 · Alt 减去 · 拖动中 Space 移动框、Ctrl 暂停对齐'},
  'en':{'opt.osMode':'Mode:', 'ui.osRect':'Rectangle', 'ui.osLasso':'Lasso', 'opt.osSampleAll':'Sample All Layers', 'ui.osSubject':'Select Subject', 'ui.osHint':'Drag a rectangle (or a lasso loop) around the object  ·  Shift add  ·  Alt subtract  ·  while dragging: Space moves it, Ctrl no snapping'}
};

Tools.reg({
  id:'objectselect', icon:'⬚', group:'select', order:23, for:'raster', opts:[],
  strings:STRINGS, os:OS,
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0){ OS.drag = null; return; }
    handRep();
    OS.hover = pt; OS.held = {shift:e.shiftKey, alt:e.altKey};
    OS.down(pt, {shift:e.shiftKey, alt:e.altKey, space:OS.space, client:[e.clientX, e.clientY]});
  },
  onMove(e, pt, P){
    OS.hover = pt; OS.held = {shift:e.shiftKey, alt:e.altKey};
    const d = OS.drag;
    if (!P.down || !d){ UI.draw(); return; }
    if (!d.moved){
      const c = d.client0, far = c ? Math.hypot(e.clientX - c[0], e.clientY - c[1]) > CLICK_DIST : true;
      if (!far && performance.now() - d.t0 <= CLICK_TIME) return;
      d.moved = true;
    }
    OS.move(pt, {ctrl:e.ctrlKey && !e.metaKey, space:OS.space});
    UI.draw();
  },
  onUp(e, pt){
    const d = OS.drag;
    if (d && !d.moved && performance.now() - d.t0 > CLICK_TIME) d.moved = true;
    OS.up(pt, {ctrl:e.ctrlKey && !e.metaKey, space:OS.space});
    UI.draw();
  },
  onKey(e){ if (e.key === 'Escape' && OS.drag){ OS.drag = null; OS.snap = null; UI.draw(); return true; } return false; },
  onDeactivate(){ OS.drag = null; OS.snap = null; OS.hover = null; },
  drawOverlay(ctx, s){
    const dpr = s / OS.zoom(), sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
    const sel = Doc.sel;
    if (sel && sel.mask && window.SelMask){
      ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
      SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
      ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
    }
    const d = OS.drag;
    if (d && d.moved && OS.lasso()) ants(ctx, d.points.map(sc), true, dpr);   // 套索模式：手绘圈（虚线闭合回起点）
    else if (d && d.moved){
      const A = sc(d.start), B = sc(OS.last());
      const r = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1])];
      ants(ctx, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], true, dpr);
    }
    if (OS.hover) drawBadge(ctx, [OS.hover[0] * s, OS.hover[1] * s], OS.mode(d ? d.press : OS.held), dpr);
  },
  buildOptions(box, add, mk){
    const dm = document.createElement('select'); dm.dataset.opt = 'drawMode';
    for (const [v, k] of [['rectangle', 'ui.osRect'], ['lasso', 'ui.osLasso']]){ const o = document.createElement('option'); o.value = v; o.textContent = Lang.t(k); dm.appendChild(o); }
    dm.value = OS.opt.drawMode; dm.onchange = () => { CMD.run('objectselect.options', {drawMode:dm.value}); dm.blur(); }; add('osMode', dm);
    const sa = mk('checkbox', {checked:OS.opt.sampleAllLayers}); sa.dataset.opt = 'sampleAllLayers';
    sa.onchange = () => CMD.run('objectselect.options', {sampleAllLayers:sa.checked}); add('osSampleAll', sa);
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.osHint'); box.appendChild(h);
    const b = document.createElement('button'); b.type = 'button'; b.dataset.opt = 'selectSubject'; b.textContent = Lang.t('ui.osSubject');
    b.style.cssText = 'margin:0 6px;cursor:pointer'; b.disabled = !CMD.map['ps.select.subject'];
    b.onclick = () => { CMD.run('ps.select.subject', {}); UI.draw(); }; box.appendChild(b);
  }
});

/* 修饰键（游标旁标记）与 Space（拖着时重新定位，hold_keys.rs:103）。
   抓手那支档的名单 HAND_REPOSITION_TOOLS 还没有 objectselect ⇒ 执行时加进去（不改它的档；之后可直接写进名单） */
function handRep(){ try { if (typeof HAND_REPOSITION_TOOLS !== 'undefined' && HAND_REPOSITION_TOOLS.add) HAND_REPOSITION_TOOLS.add('objectselect'); } catch(_){} }
handRep();
const typing = el => !!el && (el.isContentEditable || /^(input|select|textarea)$/i.test(el.tagName));
window.addEventListener('keydown', e => {
  if (typing(e.target)) return;
  if (e.key === 'Shift' || e.key === 'Alt'){
    OS.held = {shift:e.shiftKey, alt:e.altKey};
    if (ToolState.cur === 'objectselect'){ if (e.key === 'Alt') e.preventDefault(); if (window.UI) UI.draw(); }
    return;
  }
  if (e.code === 'Space' || e.key === ' '){
    handRep();
    OS.space = true; if (OS.drag && ToolState.cur === 'objectselect') OS.drag.reposition = true;
  }
}, true);
window.addEventListener('keyup', e => {
  if (e.key === 'Shift' || e.key === 'Alt'){ OS.held = {shift:e.shiftKey, alt:e.altKey}; if (ToolState.cur === 'objectselect' && window.UI) UI.draw(); return; }
  if (e.code === 'Space' || e.key === ' '){ OS.space = false; if (OS.drag) OS.drag.reposition = false; }
}, true);
window.addEventListener('blur', () => { OS.held = {shift:false, alt:false}; OS.space = false; });

})();
