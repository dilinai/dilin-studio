/* 堤麟画板 · 比例缩放（S）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/xform/transform.rs（TransformTool，TransformKind::Scale 那一支）
   命令正文：engine/src/cmd/object.rs:187-277（origin_of／scaling／apply_transform／transform／scale）
             doc/src/node.rs:132-151、164-186、589-624（LiveShape::transform／keep_corners、Scaling::factor、Node::transform）
             doc/src/appearance.rs:780-789（scale_strokes：描边粗细跟着平均缩放倍率）
             engine/src/cmd/edit.rs:338-349（duplicate_in：Alt 复制＝在原物件正上方插一份、选取换成复制品）
             tools/src/guides.rs:79-105、174-185（snap_pick：参考点吸到选中物件／游标下物件的锚点或中心）
             tools/src/xform.rs:47-60（target_overlays：青色参考点靶心）
             ui-egui/src/dialogs/transform.rs（比例缩放对话框：水平／垂直％、等比、缩放圆角、缩放描边和效果、复制）
             engine/src/lib.rs:526-527（预设：缩放圆角 off、缩放描边 off）、engine/src/tooling.rs:33-37（吸附到点 on）
   手势（transform.rs:165-222）：
     按下：没有选取 ⇒ 什么都不做（游标 not-allowed）。Alt＋按下 ⇒ 参考点设在按下处（吸附后）并开对话框。
     拖过 tol(3) 才开始：绕参考点缩放（d0＝按下点−参考点、d1＝游标−参考点，sx＝d1.x/d0.x、sy＝d1.y/d0.y；Shift ＝ 等比 k＝d1·d0/|d0|²）。
     放开：拖过 ⇒ 正式跑一次 scale.transform（一步历史；放开那一刻按着 Alt ＝ 复制）；没拖过（点一下）⇒ 参考点设在点下处（吸附后）。
     双击／Enter ⇒ 在参考点开对话框；拖时 Esc ⇒ 取消。参考点只对「设它时的那组选取」有效，选取换了就回到选取外框中心。
   拖曳走 Begin／Preview／Commit（同 direct.js）：拖时每一下先回底稿再套一次矩阵（不进历史），放开回底稿后 CMD.run 一次。
   坐标：Pointer 给文件坐标；矩阵与参考点都是文件坐标；形状存图层坐标（命令里把矩阵换算到图层坐标再套）。 */

const ScaleTool = {
  // 偏好：scaleStrokes／scaleCorners 预设 false（lib.rs:526-527）；吸附＝View 的 snap_to_point || smart_guides，预设 true（tooling.rs:33-37）
  opts: {strokes:false, corners:false, snap:true},
  origin: null,      // 自订参考点 {p:[x,y] 文件坐标, layerId, ids:[形状 id…]}（transform.rs:71 origin: Option<(Point, Vec<NodeId>)>）
  drag: null,        // {start, pick, origin, began, bounds, last:矩阵, copy}
  base: null,        // Begin 时的底稿 {L, shapes, vsel}
  measure: null,     // {p, text}（Overlay::Measure）
  hover: null,       // {p, kind:'anchor'|'center'}（snap_pick 的标签）
  dialog: null,

  /* ── 选取 ── selected_roots：VecSel 选中的形状（部分选中锚点的也算整个物件） */
  sel(){
    VecSel.prune();
    const L = VecSel.layer();
    if (!L || L.kind !== 'vector') return null;
    const ids = VecSel.shapes.filter(id => L.data.shapes.some(x => x.id === id));
    return ids.length ? {L, ids} : null;
  },
  sameIds(a, b){ return a.length === b.length && a.every((x, i) => x === b[i]); },   // Vec<NodeId> == ：顺序也要一样

  /* ── 外框（geometric bounds；Use Preview Bounds 预设 off ⇒ 不含描边）── 回文件坐标 {x0,y0,x1,y1} */
  cubicExt(p0, c1, c2, p3, out){
    const ext = (i) => {
      const a = -p0[i] + 3*c1[i] - 3*c2[i] + p3[i], b = 2*(p0[i] - 2*c1[i] + c2[i]), c = c1[i] - p0[i];
      const ts = [];
      if (Math.abs(a) < 1e-12){ if (Math.abs(b) > 1e-12) ts.push(-c / b); }
      else { const D = b*b - 4*a*c; if (D >= 0){ const q = Math.sqrt(D); ts.push((-b + q) / (2*a), (-b - q) / (2*a)); } }
      return ts.filter(t => t > 0 && t < 1);
    };
    const ev = t => { const mt = 1 - t; return [0, 1].map(i => mt*mt*mt*p0[i] + 3*mt*mt*t*c1[i] + 3*mt*t*t*c2[i] + t*t*t*p3[i]); };
    [p0, p3].concat(ext(0).map(ev), ext(1).map(ev)).forEach(q => out.push(q));
  },
  shapeBounds(L, s){
    const v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) return null;
    const pts = [[v.anchors[0].x, v.anchors[0].y]];
    VecSel.segments(v).forEach(c => this.cubicExt(c.p0, c.c1, c.c2, c.p3, pts));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    return {x0:x0 + L.x, y0:y0 + L.y, x1:x1 + L.x, y1:y1 + L.y};
  },
  bounds(L, ids){
    let b = null;
    for (const id of ids){
      const s = L.data.shapes.find(x => x.id === id), r = s && this.shapeBounds(L, s); if (!r) continue;
      b = b ? {x0:Math.min(b.x0, r.x0), y0:Math.min(b.y0, r.y0), x1:Math.max(b.x1, r.x1), y1:Math.max(b.y1, r.y1)} : r;
    }
    return b;
  },
  center(b){ return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; },

  /* transform.rs:94-102 reference_point：自订的那点（只要它是给现在这组选取设的），否则选取外框中心 */
  referencePoint(){
    const S = this.sel(); if (!S) return null;
    const o = this.origin;
    if (o && o.layerId === S.L.id && o.ids.length && this.sameIds(o.ids, S.ids)) return o.p.slice();
    const b = this.bounds(S.L, S.ids);
    return b ? this.center(b) : null;
  },

  /* transform.rs:119-133 matrix_for（Scale）→ {m, sx, sy} */
  matrixFor(o, start, p, shift){
    const d0 = [start[0] - o[0], start[1] - o[1]], d1 = [p[0] - o[0], p[1] - o[1]];
    const ratio = (a, b) => Math.abs(a) > 1e-6 ? b / a : 1;
    let sx = ratio(d0[0], d1[0]), sy = ratio(d0[1], d1[1]);
    if (shift){
      const l2 = d0[0]*d0[0] + d0[1]*d0[1];
      const k = l2 > 1e-12 ? (d1[0]*d0[0] + d1[1]*d0[1]) / l2 : 1;
      sx = k; sy = k;
    }
    // clamp：|s|<1e-4 ⇒ 1e-4 带原来的正负号（copysign，-0 也算负）
    const clamp = s => Math.abs(s) < 1e-4 ? ((s < 0 || Object.is(s, -0)) ? -1e-4 : 1e-4) : s;
    sx = clamp(sx); sy = clamp(sy);
    return {m:scaleAbout(o, sx, sy), sx, sy, text:`W: ${(sx*100).toFixed(1)}%\nH: ${(sy*100).toFixed(1)}%`};
  },

  /* ── 吸附（guides.rs:174-185 snap_pick）：选中物件＋游标下那个物件，外框碰到游标附近 tol(5) 的，取它们的锚点与外框中心，最近且在 tol 内的就吸过去 ── */
  _hc: null,
  hitTest(L, pt, tol){
    // doc/hit.rs hit_test：由上往下，描边（宽＋容差）或填色内
    const c = this._hc || (this._hc = document.createElement('canvas').getContext('2d'));
    const p = VecSel.toLayer(L, pt), S = L.data.shapes;
    for (let k = S.length - 1; k >= 0; k--){
      const s = S[k], v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) continue;
      const path = new Path2D(); bezierPath(path, v, 1);
      const sw = (s.stroke && s.stroke !== 'none') ? (s.strokeWidth || 0) : 0;
      c.lineWidth = sw + 2*tol; c.lineJoin = 'round'; c.lineCap = 'round';
      if (c.isPointInStroke(path, p[0], p[1])) return s;
      if (s.fill && s.fill !== 'none' && c.isPointInPath(path, p[0], p[1])) return s;
    }
    return null;
  },
  snapPick(pt){
    if (!this.opts.snap) return {p:pt.slice(), kind:null};
    const tol = VecSel.tol(5);
    const roots = [];
    const S = this.sel();
    if (S) S.ids.forEach(id => roots.push({L:S.L, s:S.L.data.shapes.find(x => x.id === id)}));
    const HL = (Doc.active() && Doc.active().kind === 'vector' && Doc.active().visible) ? Doc.active() : (S ? S.L : null);
    if (HL){ const h = this.hitTest(HL, pt, tol); if (h && !roots.some(r => r.s === h)) roots.push({L:HL, s:h}); }
    const near = {x0:pt[0] - tol, y0:pt[1] - tol, x1:pt[0] + tol, y1:pt[1] + tol};
    let best = null;
    const consider = (q, kind) => { const d = Math.hypot(q[0] - pt[0], q[1] - pt[1]); if (d <= tol && (!best || d < best.d)) best = {p:q, kind, d}; };
    for (const {L, s} of roots){
      if (!s || !L.visible) continue;
      const b = this.shapeBounds(L, s); if (!b) continue;
      if (b.x0 > near.x1 || b.x1 < near.x0 || b.y0 > near.y1 || b.y1 < near.y0) continue;
      VecSel.asBezier(s).anchors.forEach(a => consider([a.x + L.x, a.y + L.y], 'anchor'));
      consider(this.center(b), 'center');
    }
    return best ? {p:best.p, kind:best.kind} : {p:pt.slice(), kind:null};
  },

  /* ── Begin／Preview／Commit ── */
  begin(L){ this.base = {L, shapes:JSON.parse(JSON.stringify(L.data.shapes)), vsel:VecSel.snapshot()}; },
  resetToBase(){
    const b = this.base; if (!b) return;
    b.L.data.shapes = JSON.parse(JSON.stringify(b.shapes)); VecSel.restore(b.vsel); Layer.invalidate(b.L);
  },
  preview(params){
    if (!this.base) return;
    this.resetToBase();
    try { scaleTransformCmd(params); } catch (err){ console.error(err); }
    UI.draw();
  },
  cancel(){
    if (this.base) this.resetToBase();
    this.base = null; this.drag = null; this.measure = null;
  },

  /* ── 滑鼠（transform.rs:165-222）── */
  down(e, pt){
    if (e.button !== undefined && e.button !== 0) return;
    const S = this.sel(); const bounds = S && this.bounds(S.L, S.ids);
    if (!bounds) return;                                               // selection_bounds 没有 ⇒ 什么都不做
    this.hover = null;
    const pick = this.snapPick(pt).p;
    if (e.altKey){                                                     // Alt＋按下：设参考点、开对话框
      this.origin = {p:pick, layerId:S.L.id, ids:S.ids.slice()};
      this.drag = null;
      this.openDialog(pick);
      return;
    }
    const origin = this.referencePoint() || this.center(bounds);
    this.drag = {start:pt.slice(), pick, origin, began:false, bounds, last:[1, 0, 0, 1, 0, 0], L:S.L};
  },
  move(e, pt){
    const d = this.drag; if (!d) return;
    if (!d.began){
      if (Math.hypot(pt[0] - d.start[0], pt[1] - d.start[1]) < VecSel.tol(3)) return;
      d.began = true; this.begin(d.L);                                 // Action::Begin("Scale")
    }
    const r = this.matrixFor(d.origin, d.start, pt, e.shiftKey);
    d.last = r.m;
    this.measure = {p:pt.slice(), text:r.text};
    this.preview(this.params(r.m, e.altKey));                          // Preview object.transform {matrix, copy: alt}
  },
  up(e){
    const d = this.drag; this.drag = null; this.measure = null;
    if (!d) return;
    if (d.began){
      // 放开那一刻的 Alt 决定是不是复制；回底稿后正式跑一次 ⇒ 一步历史
      if (this.base) this.resetToBase();
      this.base = null;
      CMD.run('scale.transform', this.params(d.last, e.altKey));
    } else {
      const S = this.sel();                                            // 点一下：设参考点
      if (S) this.origin = {p:d.pick, layerId:S.L.id, ids:S.ids.slice()};
    }
  },
  /* 预览与提交用同一组参数：缩放圆角／描边照偏好写进参数（lib.rs:1101 noted：日志记下当时的选项，重放结果一样） */
  params(m, copy){ return {matrix:m.slice(), copy:!!copy, strokes:this.opts.strokes, corners:this.opts.corners}; },
  busy(){ return !!(this.drag && this.drag.began); },

  /* ── 对话框（dialogs/transform.rs；Action::Dialog("scale", {sx:100, sy:100, origin})）── */
  openDialog(origin){
    this.closeDialog();
    const back = document.createElement('div');
    back.id = 'scaleDialog';
    back.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#2b2f36;color:#e6e8ec;border:1px solid #444a55;border-radius:6px;padding:14px 16px;min-width:260px;font:13px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)';
    const title = document.createElement('div');
    title.textContent = Lang.t('tool.scale'); title.style.cssText = 'font-weight:600;margin-bottom:10px';
    box.appendChild(title);
    const f = {};
    const num = (k, label, v) => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0';
      const sp = document.createElement('span'); sp.textContent = Lang.t(label); l.appendChild(sp);
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = v; inp.dataset.k = k;
      inp.style.cssText = 'width:90px;background:#1d2026;color:#e6e8ec;border:1px solid #444a55;border-radius:3px;padding:3px 6px';
      const pc = document.createElement('span'); pc.textContent = '%';
      const w = document.createElement('span'); w.appendChild(inp); w.appendChild(pc);
      l.appendChild(w); box.appendChild(l); f[k] = inp;
    };
    const chk = (k, label, v) => {
      const l = document.createElement('label'); l.style.cssText = 'display:flex;align-items:center;gap:6px;margin:6px 0';
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!v; c.dataset.k = k;
      l.appendChild(c); const sp = document.createElement('span'); sp.textContent = Lang.t(label); l.appendChild(sp);
      box.appendChild(l); f[k] = c;
    };
    // 欄位：sx、sy（form::grid；origin 不显示）→ 等比（tool 开的对话框没给 uniform ⇒ 预设不勾）→ 缩放圆角、缩放描边和效果（起始值＝偏好）→ 复制
    num('sx', 'ui.scaleSx', 100);
    num('sy', 'ui.scaleSy', 100);
    chk('uniform', 'ui.scaleUniform', false);
    chk('corners', 'opt.scaleCorners', this.opts.corners);
    chk('strokes', 'opt.scaleStrokes', this.opts.strokes);
    chk('copy', 'ui.scaleCopy', false);
    const syncU = () => { f.sy.disabled = f.uniform.checked; f.sy.style.opacity = f.uniform.checked ? .5 : 1; };
    f.uniform.onchange = syncU;
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const mkBtn = (key, fn) => { const b = document.createElement('button'); b.textContent = Lang.t(key); b.dataset.act = key; b.onclick = fn; bar.appendChild(b); return b; };
    // state.rs Dialog::f64：解析不了用预设 100
    const n = (inp, dflt) => { const v = parseFloat(String(inp.value).replace('%', '')); return isFinite(v) ? v : dflt; };
    const ok = () => {
      const sx = n(f.sx, 100), sy = f.uniform.checked ? sx : n(f.sy, 100);
      const strokes = f.strokes.checked, corners = f.corners.checked, copy = f.copy.checked;
      this.closeDialog();
      // with_scale_options：对话框的两个选项同时写回偏好（跟变换面板、偏好设置共用）
      CMD.run('scale.options', {strokes, corners});
      const r = CMD.run('scale.apply', {sx, sy, copy, strokes, corners, origin});
      if (r && r.ok === false) console.warn(r.error);
      UI.buildOptions('scale');
      UI.draw();
    };
    mkBtn('ui.scaleCancel', () => this.closeDialog());
    mkBtn('ui.scaleOk', ok);
    box.appendChild(bar);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); ok(); }
      else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); this.closeDialog(); }
    });
    back.appendChild(box);
    back.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(back);
    this.dialog = {el:back, origin};
    // 按下时就开的（Alt 点）：随后 mousedown 的预设动作会把焦点抢回画布 ⇒ 下一轮再聚焦一次
    const focus = () => { if (this.dialog && this.dialog.el === back){ f.sx.focus(); f.sx.select(); } };
    focus(); setTimeout(focus, 0);
  },
  closeDialog(){
    if (this.dialog){ this.dialog.el.remove(); this.dialog = null; }
    UI.draw();
  },
  cursor(){ return this.sel() ? 'crosshair' : 'not-allowed'; }          // transform.rs:258-266
};
window.ScaleTool = ScaleTool;

/* ───────── 矩阵（kurbo Affine [a,b,c,d,e,f]：x' = a·x + c·y + e，y' = b·x + d·y + f）───────── */
/* transform.rs:78-80 about(o, scale_non_uniform(sx, sy)) */
function scaleAbout(o, sx, sy){ return [sx, 0, 0, sy, o[0] - sx*o[0], o[1] - sy*o[1]]; }
/* 文件坐标的矩阵 → 图层坐标（图层位移 L.x/L.y）：M_l = T(−L)·M·T(L) */
function scaleToLayerMatrix(m, L){
  const [a, b, c, d, e, f] = m, lx = L.x || 0, ly = L.y || 0;
  return [a, b, c, d, e + a*lx + c*ly - lx, f + b*lx + d*ly - ly];
}
const scaleApplyPt = (m, q) => [m[0]*q[0] + m[2]*q[1] + m[4], m[1]*q[0] + m[3]*q[1] + m[5]];

/* node.rs:182-185 Scaling::factor：平均缩放倍率 √|det|，不是 1 才算「有缩放」 */
function scaleFactor(m){ const k = Math.sqrt(Math.abs(m[0]*m[3] - m[1]*m[2])); return Math.abs(k - 1) > 1e-9 ? k : null; }

/* appearance.transform_gradients：填色／描边若是渐变物件（渐变工具定的 {x1,y1,x2,y2…}），端点跟着矩阵走、半径乘平均倍率 */
function scaleXformPaint(s, key, m){
  const g = s[key]; if (!g || typeof g !== 'object') return;
  if (window.GradientFill && (GradientFill.isGrad(g) || (GradientFill.isFree && GradientFill.isFree(g)))){ GradientFill.transform(g, m); return; }   // 渐变单定稿的格式走它自己的 GradientGeom::transform（任意形状渐变：点逐个套）

  [['x1', 'y1'], ['x2', 'y2'], ['cx', 'cy'], ['fx', 'fy']].forEach(([kx, ky]) => {
    if (typeof g[kx] === 'number' && typeof g[ky] === 'number'){ const q = scaleApplyPt(m, [g[kx], g[ky]]); g[kx] = q[0]; g[ky] = q[1]; }
  });
  const mean = Math.sqrt(Math.abs(m[0]*m[3] - m[1]*m[2]));
  ['r', 'r1', 'r2'].forEach(k => { if (typeof g[k] === 'number') g[k] *= mean; });
}

/* node.rs:589-624 Node::transform（Path 那支）：几何套矩阵；活形状留住活参数（LiveShape::transform 把矩阵乘进它的 xf）。
   我们的活形状没有 xf：矩形／椭圆只能表达轴向缩放、星形／多边形只能表达等比（含翻转），表达不了的就先转成贝兹（path_mut 的 live=None）再套。
   sc = {strokes, corners}；m 是图层坐标矩阵 */
function scaleShape(L, s, m, sc){
  const k = scaleFactor(m);
  if (k && sc.strokes && s.strokeWidth) s.strokeWidth *= k;          // appearance.scale_strokes(k)
  scaleXformPaint(s, 'fill', m); scaleXformPaint(s, 'stroke', m);
  const [a, b, c, d] = m;
  const axis = Math.abs(b) < 1e-12 && Math.abs(c) < 1e-12;
  const uniform = axis && Math.abs(Math.abs(a) - Math.abs(d)) < 1e-9;
  const P = q => scaleApplyPt(m, q);
  const toBez = () => {
    if (!VecSel.ensureBezier(L, s)) return;
    s.anchors.forEach(an => { const q = P([an.x, an.y]); an.x = q[0]; an.y = q[1]; if (an.in) an.in = P(an.in); if (an.out) an.out = P(an.out); });
  };
  const box = () => {                                                  // 轴向：x、y、w、h 直接对应（翻转后再摆正成正宽高）
    const p0 = P([s.x, s.y]), p1 = P([s.x + s.w, s.y + s.h]);
    s.x = Math.min(p0[0], p1[0]); s.y = Math.min(p0[1], p1[1]); s.w = Math.abs(p1[0] - p0[0]); s.h = Math.abs(p1[1] - p0[1]);
  };
  if (s.type === 'bezier'){
    // path.transform(a)：锚点与两支把手都套
    (s.anchors || []).forEach(an => { const q = P([an.x, an.y]); an.x = q[0]; an.y = q[1]; if (an.in) an.in = P(an.in); if (an.out) an.out = P(an.out); });
  } else if (s.type === 'path' || s.type === 'line'){
    s.points = (s.points || []).map(P);                                 // LiveShape::Line { a, b } 两端各自套
  } else if (s.type === 'rect'){
    // Scale Corners 关（keep_corners）：圆角先除以平均倍率，套完矩阵后看起来一样大（node.rs:141-151、617-622）
    let r = +s.radius || 0;
    if (r > 0 && k && k > 1e-12 && !sc.corners) r = r / k;
    if (axis && (r <= 0 || uniform)){
      box();
      if (r > 0) s.radius = r * Math.abs(a);
    } else {
      if (r > 0) s.radius = r;
      toBez();                                                         // 不等比的圆角＝椭圆角，我们的活矩形表达不了 ⇒ 转路径
    }
  } else if (s.type === 'ellipse'){
    if (axis) box(); else toBez();
  } else if (s.type === 'star' || s.type === 'polygon'){
    if (uniform){
      const q = P([s.cx, s.cy]); s.cx = q[0]; s.cy = q[1];
      const f = Math.abs(a);
      if (typeof s.r1 === 'number') s.r1 *= f;
      if (typeof s.r2 === 'number') s.r2 *= f;
      // 翻转：左右镜像 θ→π−θ ⇒ rotation → −rotation；上下镜像 θ→−θ ⇒ 180−rotation；两个都翻＝转 180°
      let rot = s.rotation || 0;
      if (a < 0 && d < 0) rot += 180; else if (a < 0) rot = -rot; else if (d < 0) rot = 180 - rot;
      rot = ((rot % 360) + 360) % 360;
      if (rot || s.rotation !== undefined) s.rotation = rot;
    } else toBez();
  } else toBez();
}

/* object.rs:205-225 apply_transform ＋ 227-234 transform：ids 缺省＝选中的形状；copy＝先 duplicate_in（原物件正上方、选取换成复制品）再套 */
function scaleTransformCmd(p){
  const m = p.matrix;
  if (!Array.isArray(m) || m.length !== 6 || !m.every(v => typeof v === 'number' && isFinite(v))) return {ok:false, error:'scale.transform: matrix must be [a,b,c,d,e,f] (6 finite numbers)'};
  if (Math.abs(m[0]*m[3] - m[1]*m[2]) < 1e-12) return {ok:false, error:'scale.transform: matrix is not invertible'};
  const T = scaleTargets(p); if (!T.ok) return T;
  const {L} = T; let ids = T.ids;
  const strokes = p.strokes !== undefined ? !!p.strokes : ScaleTool.opts.strokes;
  const corners = p.corners !== undefined ? !!p.corners : ScaleTool.opts.corners;
  if (p.copy){
    const out = [];
    for (const id of ids){
      const i = L.data.shapes.findIndex(x => x.id === id); if (i < 0) continue;
      const cp = JSON.parse(JSON.stringify(L.data.shapes[i])); cp.id = uid('S');
      L.data.shapes.splice(i + 1, 0, cp); out.push(cp.id);
    }
    VecSel.setShapes(L.id, out);
    ids = out;
  }
  const ml = scaleToLayerMatrix(m, L);
  for (const id of ids){ const s = L.data.shapes.find(x => x.id === id); if (s) scaleShape(L, s, ml, {strokes, corners}); }
  Layer.invalidate(L);
  return {ok:true, ids, layerId:L.id, strokes, corners};
}
/* 目标：ids 给了就用（layerId 缺省＝节点选取那层→当前层），没给＝VecSel 选中的形状（selected_roots） */
function scaleTargets(p){
  if (p.ids){
    const cands = p.layerId ? [Doc.byId(p.layerId)] : [VecSel.layer(), Doc.active()].concat(Doc.layers);
    for (const L of cands){
      if (!L || L.kind !== 'vector') continue;
      const ids = p.ids.filter(id => L.data.shapes.some(x => x.id === id));
      if (ids.length) return {ok:true, L, ids};
    }
    return {ok:false, error:'scale: no such shapes'};
  }
  const S = ScaleTool.sel();
  return S ? {ok:true, L:S.L, ids:S.ids} : {ok:false, error:'scale: nothing selected'};
}

/* ───────── 命令（agent 走这几条做得到跟滑鼠一样的事）───────── */
CMD.reg('scale.transform', {i18n:'', undoable:true,
  params:'{matrix:[a,b,c,d,e,f] 文件坐标（x\'=a·x+c·y+e, y\'=b·x+d·y+f）, copy?:bool, ids?:[shapeId…], layerId?, strokes?:bool, corners?:bool} ' +
         '对选中的形状（或 ids）套一个仿射矩阵（照 object.transform；比例缩放工具拖曳放开时跑的就是这条）。copy＝先在原形状正上方复制、选取换成复制品再套。' +
         'strokes＝缩放描边和效果（描边粗细乘平均倍率 √|det|）；corners＝缩放圆角（关＝圆角大小不变）；缺省照工具选项（scale.options）。' +
         '矩形／椭圆遇轴向缩放、星形／多边形遇等比缩放（含翻转）仍是活形状，其余先转成路径再套 → {ok, ids, layerId, strokes, corners}'},
  p => scaleTransformCmd(p || {}));
CMD.reg('scale.apply', {i18n:'', undoable:true,
  params:'{sx:% (必填), sy?:%（缺省＝sx）, origin?:[x,y] 文件坐标（缺省＝选取外框中心）, copy?:bool, strokes?:bool, corners?:bool, ids?, layerId?} ' +
         '按百分比绕参考点缩放选中的形状（照 object.scale；对话框按确定跑的就是这条）。sx、sy 不可为 0；负数＝翻转 → {ok, ids, layerId, strokes, corners, origin}'},
  p => {
    p = p || {};
    const sx = +p.sx;
    if (p.sx === undefined || !isFinite(sx)) return {ok:false, error:'scale.apply: missing sx (percent)'};
    const sy = p.sy === undefined ? sx : +p.sy;
    if (!isFinite(sy)) return {ok:false, error:'scale.apply: bad sy'};
    if (sx === 0 || sy === 0) return {ok:false, error:'scale.apply: scale must be non-zero'};
    const T = scaleTargets(p); if (!T.ok) return T;
    let o = p.origin;
    if (!(Array.isArray(o) && o.length === 2 && o.every(v => typeof v === 'number' && isFinite(v)))){
      const b = ScaleTool.bounds(T.L, T.ids); if (!b) return {ok:false, error:'scale.apply: selection has no bounds'};
      o = ScaleTool.center(b);
    }
    const r = scaleTransformCmd(Object.assign({}, p, {matrix:scaleAbout(o, sx / 100, sy / 100)}));
    if (r && r.ok) r.origin = o.slice();
    return r;
  });
CMD.reg('scale.options', {i18n:'',
  params:'{strokes?:bool 缩放描边和效果, corners?:bool 缩放圆角, snap?:bool 参考点吸附到锚点／中心} 比例缩放工具的选项（＝偏好 scaleStrokes／scaleCorners，预设都关；吸附预设开）；不给参数＝只读 → {strokes, corners, snap}'},
  p => {
    p = p || {};
    ['strokes', 'corners', 'snap'].forEach(k => { if (p[k] !== undefined) ScaleTool.opts[k] = !!p[k]; });
    if (window.UI) UI.draw();
    return Object.assign({ok:true}, ScaleTool.opts);
  });
CMD.reg('scale.setOrigin', {i18n:'',
  params:'{origin:[x,y]|null} 设比例缩放的参考点（文件坐标；null＝回到选取外框中心）。参考点只对现在这组选取有效（选取一换就回中心）＝人用比例缩放工具点一下 → {ok, origin}'},
  p => {
    p = p || {};
    const o = p.origin;
    if (o === null || o === undefined){ ScaleTool.origin = null; if (window.UI) UI.draw(); return {ok:true, origin:null}; }
    if (!(Array.isArray(o) && o.length === 2 && o.every(v => typeof v === 'number' && isFinite(v)))) return {ok:false, error:'scale.setOrigin: origin must be [x,y]'};
    const S = ScaleTool.sel(); if (!S) return {ok:false, error:'scale.setOrigin: nothing selected'};
    ScaleTool.origin = {p:o.slice(), layerId:S.L.id, ids:S.ids.slice()};
    if (window.UI) UI.draw();
    return {ok:true, origin:o.slice()};
  });
CMD.reg('scale.reference', {i18n:'',
  params:'{} 看比例缩放现在的参考点 → {ok, reference:[x,y]|null, custom:bool（是不是点出来的自订点）, bounds:{x0,y0,x1,y1}|null（选取外框，文件坐标）}'},
  () => {
    const S = ScaleTool.sel(), ref = ScaleTool.referencePoint(), o = ScaleTool.origin;
    const custom = !!(S && o && o.layerId === S.L.id && ScaleTool.sameIds(o.ids, S.ids));
    return {ok:true, reference:ref, custom, bounds:S ? ScaleTool.bounds(S.L, S.ids) : null};
  });

const SCALE_STRINGS = {
  'zh-Hant':{
    'tool.scale':'縮放',
    'opt.scaleStrokes':'縮放筆畫和效果', 'opt.scaleCorners':'縮放圓角', 'opt.scaleSnap':'參考點吸附錨點／中心',
    'ui.scaleHint':'先用直接選擇（A）選物件 · 點一下＝設參考點 · 拖＝繞參考點縮放（Shift 等比、放開時按 Alt＝複製）· Alt 點／雙擊／Enter＝輸入數值 · 拖時 Esc 取消',
    'ui.scaleSx':'水平', 'ui.scaleSy':'垂直', 'ui.scaleUniform':'等比', 'ui.scaleCopy':'複製（做一份變形後的副本）',
    'ui.scaleOk':'確定', 'ui.scaleCancel':'取消', 'ui.scaleAnchor':'錨點', 'ui.scaleCenter':'中心'
  },
  'zh-Hans':{
    'tool.scale':'比例缩放',
    'opt.scaleStrokes':'缩放描边和效果', 'opt.scaleCorners':'缩放圆角', 'opt.scaleSnap':'参考点吸附锚点／中心',
    'ui.scaleHint':'先用直接选择（A）选对象 · 点一下＝设参考点 · 拖＝绕参考点缩放（Shift 等比、放开时按 Alt＝复制）· Alt 点／双击／Enter＝输入数值 · 拖时 Esc 取消',
    'ui.scaleSx':'水平', 'ui.scaleSy':'垂直', 'ui.scaleUniform':'等比', 'ui.scaleCopy':'复制（做一份变换后的副本）',
    'ui.scaleOk':'确定', 'ui.scaleCancel':'取消', 'ui.scaleAnchor':'锚点', 'ui.scaleCenter':'中心'
  },
  'en':{
    'tool.scale':'Scale',
    'opt.scaleStrokes':'Scale Strokes & Effects', 'opt.scaleCorners':'Scale Corners', 'opt.scaleSnap':'Snap reference point',
    'ui.scaleHint':'Select objects first (Direct Selection, A) · Click to set the reference point · Drag to scale about it (Shift: uniform; Alt at release: copy) · Alt-click / double-click / Enter: Scale dialog · Esc cancels a drag',
    'ui.scaleSx':'Horizontal', 'ui.scaleSy':'Vertical', 'ui.scaleUniform':'Uniform', 'ui.scaleCopy':'Copy (make a transformed copy)',
    'ui.scaleOk':'OK', 'ui.scaleCancel':'Cancel', 'ui.scaleAnchor':'anchor', 'ui.scaleCenter':'center'
  }
};
if (typeof Lang !== 'undefined') Lang.add(SCALE_STRINGS);

Tools.reg({
  id:'scale', icon:'⤡', key:'S', group:'vector', order:60, for:'vector', opts:[],
  hint:'ui.scaleHint', cursor:'crosshair',
  strings: SCALE_STRINGS,
  onDown(e, pt){ ScaleTool.down(e, pt); UI.draw(); },
  onMove(e, pt, P){
    if (P.down && ScaleTool.drag){ ScaleTool.move(e, pt); return; }
    // PointerKind::Move：没在拖、有选取 ⇒ 吸附标签（anchor／center）
    const hv = (!ScaleTool.drag && ScaleTool.sel()) ? ScaleTool.snapPick(pt) : null;
    const nh = hv && hv.kind ? {p:hv.p, kind:hv.kind} : null;
    const changed = JSON.stringify(nh) !== JSON.stringify(ScaleTool.hover);
    ScaleTool.hover = nh;
    UI.canvas.style.cursor = ScaleTool.cursor();
    if (changed) UI.draw();
  },
  onUp(e){ ScaleTool.up(e); UI.draw(); },
  onDblClick(){
    ScaleTool.cancel();
    const o = ScaleTool.referencePoint();
    if (o) ScaleTool.openDialog(o);
  },
  onKey(e){
    if (ScaleTool.dialog) return false;
    if (e.key === 'Escape' && ScaleTool.busy()){ e.preventDefault(); ScaleTool.cancel(); UI.draw(); return true; }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey){
      if (ScaleTool.busy()) return true;
      const o = ScaleTool.referencePoint(); if (!o) return false;
      e.preventDefault(); ScaleTool.openDialog(o); return true;
    }
    return false;
  },
  onDeactivate(){ ScaleTool.cancel(); ScaleTool.hover = null; if (ScaleTool.dialog) ScaleTool.closeDialog(); },
  /* 选项栏：缩放圆角、缩放描边和效果（偏好；对话框里也有同样两格，按确定时写回）、参考点吸附 */
  buildOptions(box, add, mk){
    const cb = (key, opt) => {
      const c = mk('checkbox', {checked:ScaleTool.opts[opt]}); c.id = 'scaleOpt_' + opt;
      c.onchange = () => CMD.run('scale.options', {[opt]:c.checked});
      add(key, c);
    };
    cb('scaleCorners', 'corners');
    cb('scaleStrokes', 'strokes');
    cb('scaleSnap', 'snap');
  },
  /* 叠画（transform.rs:236-256）：选取（VecSel）＋ 青色参考点靶心（圆半径 0.6r、十字 ±r，r＝8 屏幕像素）＋ 吸附标签 ＋ 量尺寸 W/H% */
  drawOverlay(ctx, s){
    UI.canvas.style.cursor = ScaleTool.cursor();
    VecSel.drawOverlay(ctx, s);
    const dpr = s / UI.zoom;
    const ref = ScaleTool.drag ? ScaleTool.drag.origin : ScaleTool.referencePoint();
    ctx.save(); ctx.setLineDash([]);
    if (ref){
      const r = 8 * dpr, x = ref[0] * s, y = ref[1] * s;
      ctx.strokeStyle = '#00a8ff'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
    }
    const h = ScaleTool.hover;
    if (h){                                                            // Overlay::Label（MAGENTA）
      ctx.fillStyle = '#ff3dfc'; ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'bottom';
      ctx.fillText(Lang.t(h.kind === 'anchor' ? 'ui.scaleAnchor' : 'ui.scaleCenter'), h.p[0]*s + 4*dpr, h.p[1]*s - 3*dpr);
      ctx.beginPath(); ctx.arc(h.p[0]*s, h.p[1]*s, 2.5*dpr, 0, Math.PI*2); ctx.fill();
    }
    const m = ScaleTool.measure;
    if (m){                                                            // Overlay::Measure：游标右下 tol(12)
      const lines = m.text.split('\n');
      ctx.font = `${11*dpr}px sans-serif`; ctx.textBaseline = 'top';
      const tw = Math.max(...lines.map(t => ctx.measureText(t).width));
      const x = m.p[0]*s + 12*dpr, y = m.p[1]*s + 12*dpr, lh = 14*dpr;
      ctx.fillStyle = 'rgba(30,34,40,.85)'; ctx.fillRect(x, y, tw + 10*dpr, lh*lines.length + 6*dpr);
      ctx.fillStyle = '#fff'; lines.forEach((t, i) => ctx.fillText(t, x + 5*dpr, y + 3*dpr + i*lh));
    }
    ctx.restore();
  }
});
