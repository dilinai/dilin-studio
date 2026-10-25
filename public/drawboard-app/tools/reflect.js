/* 堤麟画板 · 镜像工具（O）—— 照 ArtCraft VectorCraft 原码逐段翻译
   本档另挂 window.XformKit：给 shear.js（倾斜）、freetransform.js（自由变换）、reshape.js（整形）、puppetwarp.js（操控变形）、
   groupselect.js（编组选择）共用的选取／外框／命中／套矩阵／预览底座（多颗工具共用的算法放在第一支档、挂 window.<Name>）。
   原码：
     tools/src/xform/transform.rs（全档 435 行：TransformTool，Reflect 与 Shear 两支；参考点、拖曳矩阵、Alt 复制、对话框、吸附、叠画、游标）
     tools/src/xform.rs:47-60（CYAN、target_overlays：参考点靶心＝半径 0.6r 的圆＋长 r 的十字）
     tools/src/select.rs:58-66（selection_bounds＝选取的几何外框；selection_box＝跟着物件角度转的外框）
     tools/src/guides.rs snap_pick（点下的参考点吸到选中物件或游标下物件的锚点／中心，容差 5 屏幕像素）——rotate.js 已翻过，这里照抄
     doc/src/hit.rs:60-188（hit_test／hit_children／hit_leaf：由上往下、剪切组只在剪切路径里算、编组往下钻、复合路径当叶子）
     engine/src/cmd/object.rs:187-225（origin_of、apply_transform：copy＝先 duplicate_in 再套、记 Transform Again）、279-299（reflect／shear 命令）
     ui-egui/src/dialogs/tools.rs:35-49（reflect 预设 {axis:"vertical"}、shear 预设 {angle:0, axis:"horizontal"}，并入工具给的 origin）
     ui-egui/src/dialogs/transform.rs:79-91（确定＝object.reflect {axis, copy, origin}／object.shear {angle, axis, copy, origin}）
   镜像（transform.rs:111-118）：拖曳时以「参考点→游标」为镜射轴（Shift 锁 45°），矩阵＝about(o, R(θ)·S(1,−1)·R(−θ))，读数＝−θ 的度数。
   行为（transform.rs:165-283）：没选东西＝什么都不做、游标禁止；Alt＋按下＝参考点设在那（吸附后）并开对话框；
     拖离 tol(3) 才开始；放开那一刻按着 Alt＝复制；没拖＝点一下设参考点（绑定当时的选取）；双击／Enter＝开对话框；拖时 Esc＝取消；换工具＝取消。
   我们这边：形状存图层坐标、矩阵一律文件坐标；选取走 VecSel（含 AiR3 的深层选取＝编组里面的物件）；
     菜单「对象 ▸ 变换 ▸ 对称／倾斜」（menus/impl/ai-object.js 的 ai.object.reflect／shear）只吃顶层物件，
     工具要能变换编组选择工具选到的深层物件 ⇒ 命令自己登记在 reflect.*／shear.*，矩阵与 object.rs 同一套。 */
(function(){
'use strict';
if (window.XformKit) return;

const CYAN = '#00a8ff', MAGENTA = '#ff3dfc', BLUE = '#4a7cff';
const fin = v => typeof v === 'number' && isFinite(v);
const LEAF = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line', 'bezier'];
const isLeaf = s => !!s && LEAF.includes(s.type);
const isCont = s => !!s && (s.type === 'group' || s.type === 'compound') && Array.isArray(s.children);
const painted = p => !!p && p !== 'none' && p !== '';
const T = k => (typeof Lang !== 'undefined' ? Lang.t(k) : k);

/* ───────── 仿射（kurbo Affine [a,b,c,d,e,f]：x' = a·x + c·y + e，y' = b·x + d·y + f）───────── */
const A = {
  I: [1, 0, 0, 1, 0, 0],
  mul(m, n){ return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]]; },
  translate(x, y){ return [1, 0, 0, 1, x, y]; },
  scale(x, y){ return [x, 0, 0, y === undefined ? x : y, 0, 0]; },
  rotate(th){ const c = Math.cos(th), s = Math.sin(th); return [c, s, -s, c, 0, 0]; },
  apply(m, p){ return [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]]; },
  det(m){ return m[0]*m[3] - m[1]*m[2]; },
  inverse(m){ const d = this.det(m), ia = m[3]/d, ib = -m[1]/d, ic = -m[2]/d, id = m[0]/d; return [ia, ib, ic, id, -(ia*m[4] + ic*m[5]), -(ib*m[4] + id*m[5])]; },
  about(o, a){ return this.mul(this.translate(o[0], o[1]), this.mul(a, this.translate(-o[0], -o[1]))); },          // object.rs:252 / transform.rs:78
  factor(m){ const k = Math.sqrt(Math.abs(this.det(m))); return Math.abs(k - 1) > 1e-9 ? k : null; },            // node.rs Scaling::factor
  toLayer(L, m){ return this.mul(this.translate(-L.x, -L.y), this.mul(m, this.translate(L.x, L.y))); },
  finite(m){ return Array.isArray(m) && m.length === 6 && m.every(v => fin(+v)); }
};
const normDeg = a => { a %= 360; if (a <= -180) a += 360; else if (a > 180) a -= 360; return a; };   // geom normalize_deg
/* geom/lib.rs:47-61 constrain_angle(v, step)：长度不变、角度四舍五入到 step 的倍数 */
function constrainAngle(v, stepDeg){
  const len = Math.hypot(v[0], v[1]); if (len < 1e-9) return v.slice();
  const st = stepDeg * Math.PI / 180, a = Math.round(Math.atan2(v[1], v[0]) / st) * st;
  return [Math.cos(a) * len, Math.sin(a) * len];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pt2 = v => (Array.isArray(v) && v.length >= 2 && fin(+v[0]) && fin(+v[1])) ? [+v[0], +v[1]] : null;

/* ───────── 形状树 ───────── */
/* 走遍：cb(s, arr, idx, parent, chain＝祖先[顶层…父]) */
function walk(arr, cb, parent, chain){
  chain = chain || [];
  (arr || []).forEach((s, i) => { cb(s, arr, i, parent || null, chain); if (isCont(s)) walk(s.children, cb, s, chain.concat([s])); });
}
function findDeep(L, id){
  if (!L || L.kind !== 'vector') return null;
  let hit = null;
  walk(L.data.shapes, (s, arr, idx, parent, chain) => { if (!hit && s.id === id) hit = {L, s, arr, idx, parent, chain:chain.slice()}; });
  return hit;
}
function vLayer(p){
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : ((window.VecSel && VecSel.layer()) || Doc.active());
  return (L && L.kind === 'vector') ? L : null;
}
/* edit.rs:155 selected_roots：选中的物件按绘制顺序；祖先也被选了的不算（随祖先一起动）；锁住／藏起来的不算 */
function roots(L, ids){
  if (!L) return [];
  const want = ids || ((VecSel.layerId === L.id) ? VecSel.shapes : []);
  if (!want.length) return [];
  const set = new Set(want), out = [];
  walk(L.data.shapes, (s, arr, i, par, chain) => {
    if (!set.has(s.id) || s.locked || s.visible === false) return;
    if (chain.some(a => set.has(a.id) || a.locked || a.visible === false)) return;
    out.push(s);
  });
  return out;
}
/* 目前选取（工具用）：{L, list} 或 null */
function selection(){
  if (!window.VecSel) return null;
  VecSel.prune();
  const L = VecSel.layer(); if (!L || L.kind !== 'vector' || !L.visible) return null;
  const list = roots(L, null);
  return list.length ? {L, list, ids:list.map(s => s.id)} : null;
}
function targets(p, C){
  const L = vLayer(p); if (!L) return {err:{ok:false, error:C + ': not a vector layer'}};
  const list = roots(L, Array.isArray(p.ids) ? p.ids : null);
  if (!list.length) return {err:{ok:false, error:C + ': nothing selected'}};
  return {L, list};
}

/* ───────── 外框 ───────── */
const docF = L => (p => [p[0] + L.x, p[1] + L.y]);
const union = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
const center = r => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
const inflate = (r, d) => r ? {x0:r.x0 - d, y0:r.y0 - d, x1:r.x1 + d, y1:r.y1 + d} : r;
const inRect = (r, p) => !!r && p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
/* 一维三次贝兹 (0,1) 内的极值参数 */
function extrema(p0, p1, p2, p3){
  const a = -p0 + 3*p1 - 3*p2 + p3, b = 2*(p0 - 2*p1 + p2), c = p1 - p0, out = [];
  if (Math.abs(a) < 1e-12){ if (Math.abs(b) > 1e-12){ const t = -c / b; if (t > 0 && t < 1) out.push(t); } return out; }
  const D = b*b - 4*a*c; if (D < 0) return out;
  const q = Math.sqrt(D); [(-b + q) / (2*a), (-b - q) / (2*a)].forEach(t => { if (t > 0 && t < 1) out.push(t); });
  return out;
}
/* 一条路径视图的紧外框（PathData::bounds），点先过 f */
function viewBounds(v, f){
  if (!v || !v.anchors || !v.anchors.length) return null;
  let r = null; const add = p => { r = union(r, {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}); };
  v.anchors.forEach(a => add(f([a.x, a.y])));
  for (const c0 of VecSel.segments(v)){
    const c = {p0:f(c0.p0), c1:f(c0.c1), c2:f(c0.c2), p3:f(c0.p3)};
    for (const k of [0, 1]) extrema(c.p0[k], c.c1[k], c.c2[k], c.p3[k]).forEach(t => add(VecSel.evalCubic(c, t)));
  }
  return r;
}
/* Node::geometric_bounds（visual＝含描边）：有 AIObj 就用它那份（编组／复合／网格／活物件都认得） */
function shapeBounds(s, f, visual){
  if (window.AIObj && AIObj.shapeBounds){ try { return AIObj.shapeBounds(s, f, !!visual); } catch (e){ /* 退回下面 */ } }
  if (isCont(s)) return s.children.reduce((r, c) => union(r, shapeBounds(c, f, visual)), null);
  const r = isLeaf(s) ? viewBounds(VecSel.asBezier(s), f) : null;
  return (visual && r && painted(s.stroke) && s.strokeWidth > 0) ? inflate(r, s.strokeWidth / 2) : r;
}
const boundsOf = (L, list, visual) => list.reduce((r, s) => union(r, shapeBounds(s, docF(L), visual)), null);   // lib.rs:849 bounds_of（文件坐标）
/* orient.rs:121 oriented_bounds（selection_box）→ {angle, rect, center} */
function orientedBox(L, list){
  if (window.AIObj && AIObj.orientedBox){ try { const b = AIObj.orientedBox(L, list, false); if (b) return b; } catch (e){ /* 退回 */ } }
  const r = boundsOf(L, list, false); return r ? {angle:0, rect:r, center:center(r)} : null;
}
/* 一个物件所有锚点（文件坐标；网格＝网格点） */
function anchorsOf(L, s, out){
  out = out || [];
  if (isCont(s)){ s.children.forEach(c => anchorsOf(L, c, out)); return out; }
  if (s.type === 'mesh' && s.mesh && s.mesh.points){ s.mesh.points.forEach(q => out.push([q.x + L.x, q.y + L.y])); return out; }
  const v = isLeaf(s) ? VecSel.asBezier(s) : null;
  if (v && v.anchors) v.anchors.forEach(a => out.push([a.x + L.x, a.y + L.y]));
  return out;
}

/* ───────── 命中（doc/src/hit.rs:60-188）───────── */
let _hctx = null;
const hctx = () => _hctx || (_hctx = document.createElement('canvas').getContext('2d'));
function addPath(c, s){
  const OR = window.ObjRender || (window.AIObj && AIObj.ObjRender);
  if (OR && OR.addPath){ try { OR.addPath(c, s, 1); return true; } catch (e){ /* 退回 */ } }
  if (isCont(s)){ s.children.forEach(k => addPath(c, k)); return true; }
  const v = isLeaf(s) ? VecSel.asBezier(s) : null; if (!v) return false;
  bezierPath(c, v, 1); return true;
}
/* hit_leaf：描边（画到的地方或轮廓 tol 内）→ 填色（有填色且在里面）；其余（网格、文字…）看外框 */
function hitLeaf(s, p, tol){
  const c = hctx();
  if (isLeaf(s) || s.type === 'compound'){
    c.beginPath(); if (!addPath(c, s)) return false;
    const sw = (painted(s.stroke) && s.strokeWidth > 0) ? s.strokeWidth : 0;
    c.lineWidth = sw + 2*tol; c.lineJoin = 'round'; c.lineCap = 'round';
    if (c.isPointInStroke(p[0], p[1])) return true;
    const rule = s.rule === 'evenodd' ? 'evenodd' : 'nonzero';
    if ((painted(s.fill) || s.type === 'compound') && c.isPointInPath(p[0], p[1], rule)) return painted(s.fill);
    return false;
  }
  return inRect(inflate(shapeBounds(s, q => q, false), tol), p);
}
function clipContains(clip, p){
  const c = hctx(); c.beginPath(); if (!addPath(c, clip)) return false;
  return c.isPointInPath(p[0], p[1], clip.rule === 'evenodd' ? 'evenodd' : 'nonzero');
}
/* hit_children：剪切组只在剪切路径里算；上面的先；编组往下钻；活物件（混合等）先看成员再看自己的外框 */
function hitChildren(parent, kids, p, tol, chain){
  if (parent && parent.type === 'group' && parent.clip && kids[0] && !clipContains(kids[0], p)) return null;
  for (let k = kids.length - 1; k >= 0; k--){
    const s = kids[k]; if (!s || s.visible === false || s.locked) continue;
    const b = shapeBounds(s, q => q, true);
    if (b && !inRect(inflate(b, tol), p)) continue;
    chain.push(s);
    let hit = null;
    if (s.type === 'group'){
      hit = hitChildren(s, s.children || [], p, tol, chain);
      if (!hit && s.live && inRect(inflate(b, tol), p)) hit = {leaf:s, chain:chain.slice()};
    } else if (hitLeaf(s, p, tol)) hit = {leaf:s, chain:chain.slice()};
    if (hit) return hit;
    chain.pop();
  }
  return null;
}
/* hit_test：所有看得见、没全锁的矢量层由上往下 → {L, leaf, chain:[顶层物件…叶子]}（pt 文件坐标） */
function hitTest(pt, tol){
  for (let li = Doc.layers.length - 1; li >= 0; li--){
    const L = Doc.layers[li];
    if (L.kind !== 'vector' || !L.visible || (L.locks && L.locks.all)) continue;
    if (window.Groups && Groups.ancestors && Groups.ancestors(L).some(G => !G.visible)) continue;
    const h = hitChildren(null, L.data.shapes, [pt[0] - L.x, pt[1] - L.y], tol, []);
    if (h) return {L, leaf:h.leaf, chain:h.chain};
  }
  return null;
}

/* ───────── Node::transform（node.rs:589-678）：编组／复合往下套；叶子用 rotate.js 的 rotTransformShape（同一份原码翻的）───────── */
function needRot(){ if (typeof rotTransformShape !== 'function' || typeof rotTransformedAngle !== 'function') throw new Error('XformKit: tools/rotate.js（rotTransformShape）没载入'); }
function xformNode(L, s, m, sc){
  if (isCont(s)){
    const ang = rotTransformedAngle(+s.bboxAngle || 0, m);
    if (s.type === 'compound'){
      const k = A.factor(m);
      if (k && sc.strokes && typeof s.strokeWidth === 'number') s.strokeWidth *= k;
      if (window.GradientFill){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); }
    }
    for (const c of s.children) if (!xformNode(L, c, m, sc)) return false;
    const lk = s.live && window.AiR3 && AiR3.live && AiR3.live[s.live]; if (lk && lk.transform) lk.transform(s, m);
    if (ang) s.bboxAngle = ang; else delete s.bboxAngle;
    return true;
  }
  if (isLeaf(s)) return rotTransformShape(L, s, m, sc);
  if (window.AiR3 && AiR3.xformDeep){ AiR3.xformDeep(s, m, sc); return true; }     // 网格等：AiR3 那份
  return false;
}
const allFinite = o => (typeof o === 'number') ? isFinite(o) : (o && typeof o === 'object') ? Object.values(o).every(allFinite) : true;
const reid = s => { const c = JSON.parse(JSON.stringify(s)); const go = n => { n.id = uid('S'); if (isCont(n)) n.children.forEach(go); }; go(c); return c; };
const K = {previewing:false};
/* object.rs:207-225 apply_transform：copy ⇒ duplicate_in（复制品插在原物件正上方（同一个父层里）、选取换成复制品），再逐个 Node::transform；
   不在预览中 ⇒ 记下 Transform Again（跟旋转工具、对象菜单共用同一个 last_transform） */
function applyTransform(L, list, m, p){
  needRot();
  p = p || {};
  const copy = !!p.copy;
  const sc = A.factor(m) ? {strokes:!!p.strokes, corners:!!p.corners} : {strokes:false, corners:false};
  let tg = list;
  if (copy){
    tg = [];
    for (const s of list){ const h = findDeep(L, s.id); if (!h) continue; const c = reid(s); h.arr.splice(h.idx + 1, 0, c); tg.push(c); }
    VecSel.setShapes(L.id, tg.map(s => s.id));
  }
  const ml = A.toLayer(L, m);
  for (const s of tg){
    if (!xformNode(L, s, ml, sc)) return {ok:false, error:'cannot transform object ' + s.id};
    if (!allFinite(s)) return {ok:false, error:'transform gives non-finite coordinates'};
  }
  Layer.invalidate(L);
  if (!K.previewing){
    const lt = {matrix:m.slice(), copy};
    if (window.RotTool) RotTool.lastTransform = lt;
    if (window.AIObj && AIObj.state) AIObj.state.lastTransform = {matrix:m.slice(), copy};
  }
  return {ok:true, ids:tg.map(s => s.id), layerId:L.id};
}

/* ───────── 图层锁：工具自己的命令自己挡（不只靠 engine Locks 规则表）───────── */
function guard(L, what, cmd){
  if (!window.Locks || !L) return null;
  const k = Locks.blocks(L, what); if (!k) return null;
  if (CMD._depth <= 1 && !K.previewing) Locks.notify(Locks.message(L, k));
  return Locks.fail(L, k, cmd);
}

/* ───────── Begin／Preview／Commit（tools/lib.rs Action；engine lib.rs begin_interaction：预览都在 Begin 时的底稿上跑）───────── */
function makeSession(){
  return {
    base:null, last:null,
    begin(L){ this.base = {L, data:JSON.stringify(L.data), vsel:VecSel.snapshot()}; this.last = null; },
    reset(){
      const b = this.base; if (!b) return;
      const d = JSON.parse(b.data);
      b.L.data.shapes = d.shapes;
      if ('puppet' in d) b.L.data.puppet = d.puppet; else delete b.L.data.puppet;
      VecSel.restore(b.vsel); Layer.invalidate(b.L);
    },
    preview(cmd, params){
      if (!this.base) return null;
      this.reset();
      K.previewing = true; let r = null;
      try { r = CMD.map[cmd].run(params); } catch (err){ console.error(err); }
      finally { K.previewing = false; }
      this.last = {cmd, params};
      return r;
    },
    commit(){
      const last = this.last;
      if (this.base) this.reset();
      this.base = null; this.last = null;
      return last ? CMD.run(last.cmd, last.params) : null;
    },
    cancel(){ if (this.base) this.reset(); this.base = null; this.last = null; },
    active(){ return !!this.base; }
  };
}

/* ───────── 叠画小工具（s＝文件坐标→画布像素倍率；dpr＝屏幕像素）───────── */
const Draw = {
  dpr(s){ return s / UI.zoom; },
  target(ctx, s, r){                                   // xform.rs:53-60 target_overlays(p, tol(8))
    const d = this.dpr(s), x = r[0]*s, y = r[1]*s, R = 8*d;
    ctx.strokeStyle = CYAN; ctx.lineWidth = d; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, R*0.6, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - R, y); ctx.lineTo(x + R, y); ctx.moveTo(x, y - R); ctx.lineTo(x, y + R); ctx.stroke();
  },
  label(ctx, s, p, text, color){                       // Overlay::Label
    const d = this.dpr(s), x = p[0]*s, y = p[1]*s;
    ctx.fillStyle = color || MAGENTA; ctx.beginPath(); ctx.arc(x, y, 2.5*d, 0, Math.PI*2); ctx.fill();
    ctx.font = `${11*d}px sans-serif`; ctx.textBaseline = 'bottom'; ctx.fillText(text, x + 5*d, y - 3*d);
  },
  measure(ctx, s, p, text){                            // Overlay::Measure：游标右下 tol(12)，多行
    const d = this.dpr(s), x = p[0]*s + 12*d, y = p[1]*s + 12*d, lines = String(text).split('\n');
    ctx.font = `${11*d}px sans-serif`; ctx.textBaseline = 'top';
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12*d, h = lines.length * 13*d + 8*d;
    ctx.fillStyle = 'rgba(64,64,64,0.92)';
    if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, w, h, 3*d); ctx.fill(); } else ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff'; lines.forEach((l, i) => ctx.fillText(l, x + 6*d, y + 4*d + i*13*d));
  },
  /* 深层选取（编组里面的物件）的轮廓：VecSel.drawOverlay 只画顶层的 */
  deep(ctx, s){
    const L = VecSel.layer(); if (!L || L.kind !== 'vector' || !L.visible) return;
    const deep = VecSel.shapes.filter(id => !L.data.shapes.some(x => x.id === id)).map(id => findDeep(L, id)).filter(Boolean);
    if (!deep.length) return;
    ctx.save(); ctx.translate(L.x * s, L.y * s); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1; ctx.setLineDash([]);
    for (const h of deep){
      ctx.beginPath();
      const OR = window.ObjRender || (window.AIObj && AIObj.ObjRender);
      if (OR && OR.addPath) OR.addPath(ctx, h.s, s); else { const v = VecSel.asBezier(h.s); if (v) bezierPath(ctx, v, s); }
      ctx.stroke();
    }
    ctx.restore();
  },
  selection(ctx, s){ VecSel.drawOverlay(ctx, s); this.deep(ctx, s); }
};

/* ═════════════ TransformTool（transform.rs，Reflect／Shear 两支共用）═════════════ */
function makeTransformTool(kind){
  const label = {reflect:'Reflect', shear:'Shear'}[kind];
  const ses = makeSession();
  const tool = {
    kind,
    origin: null,        // 自订参考点 {p, layerId, ids}（transform.rs:71）
    drag: null,          // {start, pick, origin, began, bounds, last}（transform.rs:57-66）
    measure: null,       // {p, text}
    hover: [],           // 吸附回馈 [{p, text}]
    snap: true,          // Snap to Point／Smart Guides（ToolContext 预设开）
    ses,
    sameIds(a, b){ return a.length === b.length && a.every((x, i) => x === b[i]); },
    /* transform.rs:94-102 reference_point：自订的属于目前选取就用，否则选取外框（跟着角度转）的中心 */
    referencePoint(){
      const S = selection(); if (!S) return null;
      if (this.origin && this.origin.layerId === S.L.id && this.sameIds(this.origin.ids, S.ids)) return this.origin.p.slice();
      const b = orientedBox(S.L, S.list); return b ? b.center : null;
    },
    /* guides.rs snap_pick：选中的物件＋游标下的物件，外框碰到 p±tol 的，收锚点与外框中心；容差 tol(5) 内最近的 */
    snapPick(pt){
      if (!this.snap) return {p:pt.slice(), ov:[]};
      const tol = VecSel.tol(5), S = selection(), cand = [];
      if (S) S.list.forEach(s => cand.push({L:S.L, s}));
      const h = hitTest(pt, VecSel.tol(3));
      if (h && h.chain.length && !cand.some(c => c.s === h.chain[0])) cand.push({L:h.L, s:h.chain[0]});
      const pts = [];
      for (const {L, s} of cand){
        const b = shapeBounds(s, docF(L), false); if (!b) continue;
        if (b.x0 > pt[0] + tol || b.x1 < pt[0] - tol || b.y0 > pt[1] + tol || b.y1 < pt[1] - tol) continue;
        anchorsOf(L, s).forEach(q => pts.push({q, kind:'anchor'}));
        pts.push({q:center(b), kind:'center'});
      }
      let best = null;
      for (const t of pts){ const d = dist(t.q, pt); if (d <= tol && (!best || d < best.d)) best = {q:t.q, kind:t.kind, d}; }
      return best ? {p:best.q.slice(), ov:[{p:best.q.slice(), text:best.kind}]} : {p:pt.slice(), ov:[]};
    },
    /* transform.rs:105-149 matrix_for */
    matrixFor(o, start, p, shift, bounds){
      if (kind === 'reflect'){
        let v = [p[0] - o[0], p[1] - o[1]];
        if (shift) v = constrainAngle(v, 45);
        const th = Math.hypot(v[0], v[1]) < 1e-9 ? Math.PI / 2 : Math.atan2(v[1], v[0]);
        return {m:XformKit.reflectMatrix(o, th), text:normDeg(-th * 180 / Math.PI).toFixed(1) + '°', theta:th};
      }
      // Shear：轴跟着拖曳的主方向（Shift 永远锁在那个轴上——本来就是）
      const d = [p[0] - start[0], p[1] - start[1]];
      const horizontal = Math.abs(d[0]) >= Math.abs(d[1]);
      const lever = (a, fb) => Math.abs(a) > 1e-3 ? a : Math.max(fb, 1);
      const bw = bounds ? bounds.x1 - bounds.x0 : 0, bh = bounds ? bounds.y1 - bounds.y0 : 0;
      if (horizontal){
        const k = d[0] / lever(start[1] - o[1], bh / 2);
        return {m:A.about(o, [1, 0, k, 1, 0, 0]), text:(-Math.atan(k) * 180 / Math.PI).toFixed(1) + '°', k, axis:'horizontal'};
      }
      const k = d[1] / lever(start[0] - o[0], bw / 2);
      return {m:A.about(o, [1, k, 0, 1, 0, 0]), text:(-Math.atan(k) * 180 / Math.PI).toFixed(1) + '°', k, axis:'vertical'};
    },
    busy(){ return !!(this.drag && this.drag.began); },
    cancel(){ ses.cancel(); this.drag = null; this.measure = null; },

    /* ── 滑鼠（transform.rs:165-222）── */
    down(e, pt){
      const S = selection();
      const bounds = S ? boundsOf(S.L, S.list, false) : null;   // selection_bounds
      if (!bounds) return;                                       // 没选东西：什么都不做
      this.hover = [];
      const pick = this.snapPick(pt).p;
      if (e.altKey){                                             // Alt：参考点设在这、开对话框
        this.origin = {p:pick, layerId:S.L.id, ids:S.ids.slice()};
        this.drag = null;
        this.openDialog(pick);
        return;
      }
      const origin = this.referencePoint() || center(bounds);
      this.drag = {start:pt.slice(), pick, origin, began:false, bounds, last:A.I.slice(), L:S.L};
    },
    move(e, pt){
      const d = this.drag;
      if (!d){ const S = selection(); this.hover = S ? this.snapPick(pt).ov : []; return; }
      if (!d.began){
        if (dist(pt, d.start) < VecSel.tol(3)) return;
        if (window.Locks && Locks.deny(d.L, 'position')){ this.drag = null; return; }   // 锁位置：整个手势不给
        d.began = true; ses.begin(d.L);                           // Action::Begin(label)
      }
      const r = this.matrixFor(d.origin, d.start, pt, !!e.shiftKey, d.bounds);
      d.last = r.m;
      this.measure = {p:pt.slice(), text:r.text};
      ses.preview(kind + '.transform', {matrix:r.m, copy:!!e.altKey});
      UI.draw();
    },
    up(e, pt){
      const d = this.drag; this.drag = null;
      if (!d) return;
      this.measure = null;
      if (d.began){
        ses.last = {cmd:kind + '.transform', params:{matrix:d.last, copy:!!e.altKey}};   // 放开那一刻的 Alt 决定复不复制
        ses.commit();
      } else {
        const S = selection();                                   // 点一下＝设参考点（吸附后），绑定当时的选取
        this.origin = S ? {p:d.pick, layerId:S.L.id, ids:S.ids.slice()} : null;
      }
    },
    dblClick(){ this.cancel(); const o = this.referencePoint(); if (o) this.openDialog(o); },
    key(e){
      if (e.key === 'Escape' && this.busy()){ e.preventDefault(); this.cancel(); return true; }
      if (e.key === 'Enter' && !this.drag){ const o = this.referencePoint(); if (!o) return false; e.preventDefault(); this.openDialog(o); return true; }
      return false;
    },
    cursor(){ return selection() ? 'crosshair' : 'not-allowed'; },     // transform.rs:258-266
    syncCursor(){ if (window.UI && UI.canvas && ToolState.cur === kind) UI.canvas.style.cursor = this.cursor(); },

    /* ── 对话框（dialogs/tools.rs:35-49、dialogs/transform.rs:79-91）：外观借对象菜单的 AIObj.Dlg ── */
    openDialog(origin){
      const o = origin ? origin.slice() : null;
      const run = v => { const r = CMD.run(kind + '.apply', Object.assign(v, o ? {origin:o} : {})); if (window.UI) UI.draw(); return r; };
      if (!(window.AIObj && AIObj.Dlg)) return false;
      if (kind === 'reflect'){
        AIObj.Dlg.open('reflect', 'ui.xfReflectTitle', [
          {key:'axis', label:'ui.xfAxis', type:'select', value:'vertical', options:[['vertical', 'ui.xfVertical'], ['horizontal', 'ui.xfHorizontal'], ['angle', 'ui.xfAngle']]},
          {key:'angle', label:'ui.xfAngle', type:'number', value:90}, {key:'copy', label:'ui.xfCopy', type:'check', value:false}],
          v => run({axis:v.axis === 'angle' ? v.angle : v.axis, copy:v.copy}));
      } else {
        AIObj.Dlg.open('shear', 'ui.xfShearTitle', [
          {key:'angle', label:'ui.xfShearAngle', type:'number', value:0},
          {key:'axis', label:'ui.xfAxis', type:'select', value:'horizontal', options:[['horizontal', 'ui.xfHorizontal'], ['vertical', 'ui.xfVertical']]},
          {key:'copy', label:'ui.xfCopy', type:'check', value:false}],
          v => run({angle:v.angle, axis:v.axis, copy:v.copy}));
      }
      return true;
    },
    closeDialog(){ if (window.AIObj && AIObj.Dlg && document.querySelector('#aiObjDialog[data-kind="' + kind + '"]')) AIObj.Dlg.close(); },

    /* transform.rs:236-256 overlays */
    drawOverlay(ctx, s){
      Draw.selection(ctx, s);
      const d = this.drag, r = d ? d.origin : this.referencePoint();
      ctx.save(); ctx.setLineDash([]);
      if (r) Draw.target(ctx, s, r);
      for (const h of this.hover) Draw.label(ctx, s, h.p, h.text);
      const m = this.measure, dp = Draw.dpr(s);
      if (kind === 'reflect' && d && d.began && m){                // 参考点→游标的青色虚线（＝镜射轴）
        ctx.strokeStyle = CYAN; ctx.lineWidth = dp; ctx.setLineDash([4*dp, 3*dp]);
        ctx.beginPath(); ctx.moveTo(d.origin[0]*s, d.origin[1]*s); ctx.lineTo(m.p[0]*s, m.p[1]*s); ctx.stroke(); ctx.setLineDash([]);
      }
      if (m) Draw.measure(ctx, s, m.p, m.text);
      ctx.restore();
    }
  };

  /* ── 命令（agent 走这几条做得到跟滑鼠一样的事）── */
  const C = kind;
  CMD.reg(C + '.transform', {i18n:'', undoable:true,
    params:'{matrix:[a,b,c,d,e,f] 文件坐标仿射（x\'=a·x+c·y+e, y\'=b·x+d·y+f）, copy?:bool, ids?:[物件 id…（可以是编组里面的）], layerId?} ' +
           '照 object.transform：矩阵套到选中的物件（编组／复合路径整棵套；矩形／椭圆遇到非两轴对两轴、星形遇到非相似变换会先转成钢笔路径）；copy＝先在原物件正上方复制、选取换成复制品 → {ok, ids, layerId}'}, p => {
    p = p || {};
    if (!A.finite(p.matrix)) return {ok:false, error:C + '.transform: missing matrix [a,b,c,d,e,f]'};
    const t = targets(p, C + '.transform'); if (t.err) return t.err;
    const g = guard(t.L, 'position', C + '.transform'); if (g) return g;
    return applyTransform(t.L, t.list, p.matrix.map(Number), p);
  });
  if (kind === 'reflect'){
    CMD.reg('reflect.apply', {i18n:'', undoable:true,
      params:'{axis?:"vertical"(缺省，左右翻)|"horizontal"(上下翻)|角度（镜射轴与水平的夹角，逆时针度）, origin?:[x,y]（缺省＝选取外框中心）, copy?, ids?, layerId?} ' +
             '照 object.reflect（＝镜像工具对话框按确定）→ {ok, ids, origin}'}, p => {
      p = p || {};
      const t = targets(p, 'reflect.apply'); if (t.err) return t.err;
      const g = guard(t.L, 'position', 'reflect.apply'); if (g) return g;
      let o = pt2(p.origin); if (!o){ const b = orientedBox(t.L, t.list); if (!b) return {ok:false, error:'selection has no bounds'}; o = b.center; }
      const r = applyTransform(t.L, t.list, A.about(o, XformKit.reflectAxisMatrix(p.axis)), p);
      return r.ok ? Object.assign(r, {origin:o}) : r;
    });
  } else {
    CMD.reg('shear.apply', {i18n:'', undoable:true,
      params:'{angle:度（夹在 ±89）, axis?:"horizontal"(缺省)|"vertical", origin?:[x,y]（缺省＝选取外框中心）, copy?, ids?, layerId?} 照 object.shear（＝倾斜工具对话框按确定）→ {ok, ids, origin}'}, p => {
      p = p || {};
      const t = targets(p, 'shear.apply'); if (t.err) return t.err;
      const g = guard(t.L, 'position', 'shear.apply'); if (g) return g;
      let o = pt2(p.origin); if (!o){ const b = orientedBox(t.L, t.list); if (!b) return {ok:false, error:'selection has no bounds'}; o = b.center; }
      const r = applyTransform(t.L, t.list, A.about(o, XformKit.shearAxisMatrix(p.angle, p.axis)), p);
      return r.ok ? Object.assign(r, {origin:o}) : r;
    });
  }
  CMD.reg(C + '.drag', {i18n:'', undoable:true,
    params:'{x0, y0 按下点, x1, y1 放开点（文件坐标）, shift?:bool, alt?:bool（放开时按着 Alt＝复制）, origin?:[x,y]（缺省＝工具的参考点：点过的那点或选取外框中心）, ids?, layerId?} ' +
           (kind === 'reflect' ? '＝用镜像工具从 (x0,y0) 拖到 (x1,y1)：以「参考点→(x1,y1)」为镜射轴镜射（Shift 轴锁 45°）→ {ok, ids, origin, matrix, angle(轴的逆时针度数)}'
                               : '＝用倾斜工具从 (x0,y0) 拖到 (x1,y1)：拖曳主方向是水平＝水平倾斜（k＝dx／(y0−参考点 y)），否则垂直倾斜 → {ok, ids, origin, matrix, axis, angle}')}, p => {
    p = p || {};
    if (![p.x0, p.y0, p.x1, p.y1].every(fin)) return {ok:false, error:C + '.drag: x0,y0,x1,y1 are required numbers'};
    const t = targets(p, C + '.drag'); if (t.err) return t.err;
    const g = guard(t.L, 'position', C + '.drag'); if (g) return g;
    let o = pt2(p.origin);
    if (!o){
      const useTool = !Array.isArray(p.ids) && (!p.layerId || p.layerId === VecSel.layerId);
      o = useTool ? tool.referencePoint() : null;
      if (!o){ const b = orientedBox(t.L, t.list); if (!b) return {ok:false, error:'selection has no bounds'}; o = b.center; }
    }
    const r = tool.matrixFor(o, [p.x0, p.y0], [p.x1, p.y1], !!p.shift, boundsOf(t.L, t.list, false));
    const res = applyTransform(t.L, t.list, r.m, {copy:!!p.alt});
    if (!res.ok) return res;
    const extra = {origin:o, matrix:r.m};
    if (kind === 'reflect') extra.angle = normDeg(-r.theta * 180 / Math.PI); else { extra.axis = r.axis; extra.angle = -Math.atan(r.k) * 180 / Math.PI; }
    return Object.assign(res, extra);
  });
  CMD.reg(C + '.setOrigin', {i18n:'',
    params:'{origin:[x,y]|null} 设参考点（文件坐标；绑定目前的选取，选取一换就回到外框中心）；null＝回到外框中心。＝用这颗工具点一下（不吸附）→ {origin}'}, p => {
    p = p || {};
    const o = pt2(p.origin), S = selection();
    tool.origin = (o && S) ? {p:o, layerId:S.L.id, ids:S.ids.slice()} : null;
    if (window.UI) UI.draw();
    return {ok:true, origin:tool.origin ? tool.origin.p.slice() : null};
  });
  CMD.reg(C + '.options', {i18n:'',
    params:'{snap?:bool} 工具选项（snap＝参考点吸到锚点／中心，预设开）；不给＝只读 → {origin（自订的）, reference（实际会用的参考点）, snap}'}, p => {
    p = p || {};
    if (p.snap !== undefined) tool.snap = !!p.snap;
    return {ok:true, origin:tool.origin ? tool.origin.p.slice() : null, reference:tool.referencePoint(), snap:tool.snap};
  });
  CMD.reg(C + '.dialog', {i18n:'', params:'{origin?:[x,y]} 开数值对话框（＝Enter／双击／Alt＋点；确定＝跑 ' + C + '.apply）→ {ok}'}, p => {
    p = p || {};
    const o = pt2(p.origin) || tool.referencePoint(); if (!o) return {ok:false, error:C + '.dialog: nothing selected'};
    return {ok:tool.openDialog(o)};
  });

  Tools.reg({
    id:kind, group:'vector', order:kind === 'reflect' ? 61 : 63, for:'vector', opts:[],
    cursor:'crosshair', hint:'ui.' + kind + 'Hint',
    onDown(e, pt){ tool.down(e, pt); tool.syncCursor(); UI.draw(); },
    onMove(e, pt){ tool.move(e, pt); tool.syncCursor(); if (!tool.busy()) UI.draw(); },
    onUp(e, pt){ tool.up(e, pt); tool.syncCursor(); UI.draw(); },
    onDblClick(e, pt){ tool.dblClick(e, pt); UI.draw(); },
    onKey(e){ const r = tool.key(e); if (r){ tool.syncCursor(); UI.draw(); } return r; },
    onDeactivate(){ tool.cancel(); tool.hover = []; },            // transform.rs:281-283：拖到一半换工具＝取消
    buildOptions(box, add, mk){
      const cb = mk('checkbox', {checked:tool.snap});
      cb.onchange = () => CMD.run(C + '.options', {snap:cb.checked});
      add('xfSnap', cb);
      const b = document.createElement('button'); b.textContent = T('ui.xfDialogBtn');
      b.onclick = () => { const o = tool.referencePoint(); if (o) tool.openDialog(o); };
      box.appendChild(b);
      setTimeout(() => tool.syncCursor(), 0);
    },
    drawOverlay(ctx, s){ tool.drawOverlay(ctx, s); }
  });
  return tool;
}

/* 共用三语（变换类对话框与选项） */
const KIT_STRINGS = {
  'zh-Hant':{'ui.xfAxis':'軸', 'ui.xfVertical':'垂直', 'ui.xfHorizontal':'水平', 'ui.xfAngle':'角度', 'ui.xfShearAngle':'傾斜角度', 'ui.xfCopy':'拷貝（變換出一份複本）',
             'ui.xfReflectTitle':'鏡射', 'ui.xfShearTitle':'傾斜', 'opt.xfSnap':'貼齊錨點', 'ui.xfDialogBtn':'數值…'},
  'zh-Hans':{'ui.xfAxis':'轴', 'ui.xfVertical':'垂直', 'ui.xfHorizontal':'水平', 'ui.xfAngle':'角度', 'ui.xfShearAngle':'倾斜角度', 'ui.xfCopy':'复制（变换出一份副本）',
             'ui.xfReflectTitle':'镜像', 'ui.xfShearTitle':'倾斜', 'opt.xfSnap':'吸附锚点', 'ui.xfDialogBtn':'数值…'},
  'en':{'ui.xfAxis':'Axis', 'ui.xfVertical':'Vertical', 'ui.xfHorizontal':'Horizontal', 'ui.xfAngle':'Angle', 'ui.xfShearAngle':'Shear Angle', 'ui.xfCopy':'Copy (make a transformed copy)',
        'ui.xfReflectTitle':'Reflect', 'ui.xfShearTitle':'Shear', 'opt.xfSnap':'Snap to point', 'ui.xfDialogBtn':'Values…'}
};
if (typeof Lang !== 'undefined') Lang.add(KIT_STRINGS);

const XformKit = window.XformKit = {
  A, CYAN, BLUE, MAGENTA, LEAF, isLeaf, isCont, painted, fin, dist, pt2, normDeg, constrainAngle,
  walk, findDeep, vLayer, roots, selection, targets, docF, union, center, inflate, inRect, shapeBounds, boundsOf, orientedBox, viewBounds, anchorsOf,
  hitTest, hitLeaf, xformNode, applyTransform, guard, makeSession, Draw, makeTransformTool, reid, state:K,
  /* transform.rs:82-85 reflect_matrix：过 o、与水平夹 θ（屏幕坐标弧度）的直线镜射 */
  reflectMatrix(o, th){ return A.about(o, A.mul(A.rotate(th), A.mul(A.scale(1, -1), A.rotate(-th)))); },
  /* object.rs:279-291 reflect 的 axis：horizontal＝上下翻 S(1,−1)；数字＝逆时针度数的轴；其余（vertical）＝左右翻 S(−1,1) */
  reflectAxisMatrix(axis){
    if (typeof axis === 'string' && axis.trim() !== '' && isFinite(+axis)) axis = +axis;
    if (axis === 'horizontal') return A.scale(1, -1);
    if (typeof axis === 'number' && isFinite(axis)){ const t = -axis * Math.PI / 180; return A.mul(A.rotate(t), A.mul(A.scale(1, -1), A.rotate(-t))); }
    return A.scale(-1, 1);
  },
  /* object.rs:293-299 shear：t＝tan(clamp(angle, ±89°))；vertical＝[1,t,0,1]，否则 [1,0,−t,1] */
  shearAxisMatrix(angle, axis){
    let a = +angle; if (!isFinite(a)) a = 0;
    const t = Math.tan(Math.max(-89, Math.min(89, a)) * Math.PI / 180);
    return axis === 'vertical' ? [1, t, 0, 1, 0, 0] : [1, 0, -t, 1, 0, 0];
  }
};

/* ═════════════ 镜像工具本体 ═════════════ */
const REFLECT_STRINGS = {
  'zh-Hant':{'ui.reflectHint':'點一下＝設參考點（貼齊錨點／中心）· 拖＝以「參考點→游標」為軸鏡射（Shift 鎖 45°、放開時按 Alt＝拷貝）· Alt＋點／雙擊／Enter＝輸入數值 · 拖時 Esc 取消'},
  'zh-Hans':{'ui.reflectHint':'点一下＝设参考点（吸到锚点／中心）· 拖＝以「参考点→游标」为轴镜像（Shift 锁 45°、放开时按 Alt＝复制）· Alt＋点／双击／Enter＝输入数值 · 拖时 Esc 取消'},
  'en':{'ui.reflectHint':'Click to set the reference point (snaps to anchors / centres) · Drag to reflect across the line from it to the pointer (Shift: 45°, Alt at release: copy) · Alt+Click / double-click / Enter for exact values · Esc cancels a drag'}
};
if (typeof Lang !== 'undefined') Lang.add(REFLECT_STRINGS);
window.ReflectTool = makeTransformTool('reflect');
})();
