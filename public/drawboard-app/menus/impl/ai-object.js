/* 堤麟画板 · Illustrator ▸ 对象（Object）菜单实作 —— 照 ArtCraft VectorCraft 原码逐条翻成 JS
   原码（vectorcraft/crates/）：
     engine/src/cmd/object.rs     变换（transform／move／rotate／scale／reflect／shear／transformAgain）、排列、编组、锁定、隐藏、复合路径、剪切蒙版、对齐、扩展形状
     engine/src/cmd/menucmds.rs   上方所有图稿／其它图层、分别变换（transformEach）、重置定界框、转换为形状（detect_shape）
     engine/src/cmd/path.rs       连接（join）、平均（average）、反转路径方向（reverse）
     engine/src/cmd/pathops.rs    轮廓化描边、偏移路径、简化、添加锚点、分割下方对象、分割为网格、清理
     engine/src/cmd/expand.rs     扩展（对象／填色渐变／描边）
     engine/src/cmd/docinfo.rs    使像素完美（snap_xf）
     engine/src/cmd/edit.rs       selected_roots（按绘制顺序）、duplicate_in（复制品插在原物件正上方）
     doc/src/marks.rs             创建裁切标记（TrimMarks::lines）
     pathops/src/edit.rs、fit.rs  简化（simplify_with、最小二乘三次贝兹拟合）、添加锚点、分割为网格
     pathops/src/offset.rs、boolean.rs  偏移／轮廓化描边／布尔：原码用 kurbo 描边器＋linesweeper 扫描线拓扑；
                                  我们改成「曲线拉平成折线 → 全部线段两两求交切开 → 每段两侧取样算各输入的绕数 → 按谓词留边界 → 接成环 → 再拟合回曲线」，
                                  谓词跟原码 Arrangement::contours(|m| …) 同一套（并集 m0||m1、交集 m0&&m1、差集 m0&&!m1）。
     ui-egui/src/dialogs/{transform,transform_each,path_ops,expand}.rs、ui-egui/src/menus.rs:2216-2231（菜单开哪个对话框、栏位预设）
   命令一律 ai.<原码 id>；要对话框的另登记 ai.<原码 id>.dialog（只开对话框、不改文件；确定＝跑那条命令）。
   资料模型（矢量层 L.data.shapes 里，图层坐标）——这几样 engine 渲染要接；没接之前本档在下面临时包一层 drawShape／shiftShape：
     s.visible === false  ＝ 隐藏（Node.visible）；s.locked ＝ 锁定（Node.locked）
     编组      {id, type:'group', children:[形状…], clip?:true}；clip 时 children[0] 是剪切路径（clipping:true、外观清空）
     复合路径  {id, type:'compound', children:[无外观的路径…], fill, stroke, strokeWidth, rule:'nonzero'|'evenodd'} */
(function(){
'use strict';
if (window.AIObj) return;

/* ═════════════ 小工具 ═════════════ */
const fin = v => typeof v === 'number' && isFinite(v);
const num = (v, d) => { if (v === undefined || v === null || v === '') return d; const n = +(typeof v === 'string' ? parseFloat(v) : v); return isFinite(n) ? n : d; };
const bool = (v, d) => v === undefined || v === null ? d : !!v;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sub = (a, b) => [a[0]-b[0], a[1]-b[1]], add = (a, b) => [a[0]+b[0], a[1]+b[1]], mul = (a, k) => [a[0]*k, a[1]*k];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1], cross = (a, b) => a[0]*b[1] - a[1]*b[0];
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const lerp = (a, b, t) => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t];
const unit = v => { const l = Math.hypot(v[0], v[1]); return (l > 1e-12 && isFinite(l)) ? [v[0]/l, v[1]/l] : null; };   // fit.rs:11 unit
const clone = o => JSON.parse(JSON.stringify(o));
const LEAF = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line', 'bezier'];   // 我们的「路径」种类（NodeKind::Path，活形状也算）
const LIVE = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line'];             // 活形状（Path { live: Some(_) }）
const isLeaf = s => !!s && LEAF.includes(s.type);
const isCont = s => !!s && (s.type === 'group' || s.type === 'compound') && Array.isArray(s.children);
const painted = p => !!p && p !== 'none' && p !== '';
const hasStroke = s => painted(s.stroke) && (s.strokeWidth || 0) > 0;
const newId = () => uid('S');
const T = k => (window.Lang ? Lang.t(k) : k);

/* 仿射（kurbo Affine [a,b,c,d,e,f]：x' = a·x + c·y + e）——乘法、旋转与 Node::transform 用 tools/rotate.js 的 RotAff／rotTransformShape（同一份原码翻的） */
const A = {
  I: [1, 0, 0, 1, 0, 0],
  mul(m, n){ return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]]; },
  translate(x, y){ return [1, 0, 0, 1, x, y]; },
  scale(x, y){ return [x, 0, 0, y === undefined ? x : y, 0, 0]; },
  rotate(th){ const c = Math.cos(th), s = Math.sin(th); return [c, s, -s, c, 0, 0]; },
  apply(m, p){ return [m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]]; },
  det(m){ return m[0]*m[3] - m[1]*m[2]; },
  inverse(m){ const d = this.det(m), ia = m[3]/d, ib = -m[1]/d, ic = -m[2]/d, id = m[0]/d; return [ia, ib, ic, id, -(ia*m[4] + ic*m[5]), -(ib*m[4] + id*m[5])]; },
  about(o, a){ return this.mul(this.translate(o[0], o[1]), this.mul(a, this.translate(-o[0], -o[1]))); },   // object.rs:252
  factor(m){ const k = Math.sqrt(Math.abs(this.det(m))); return Math.abs(k - 1) > 1e-9 ? k : null; },      // node.rs Scaling::factor
  /* 文件坐标矩阵 → 图层坐标：T(−L)·M·T(L) */
  toLayer(L, m){ return this.mul(this.translate(-L.x, -L.y), this.mul(m, this.translate(L.x, L.y))); }
};
const normDeg = a => { a %= 360; if (a <= -180) a += 360; else if (a > 180) a -= 360; return a; };   // geom normalize_deg
function needRot(){ if (typeof rotTransformShape !== 'function' || typeof rotTransformedAngle !== 'function') throw new Error('ai.object: tools/rotate.js（rotTransformShape）没载入'); }

/* 走遍一棵形状树：cb(s, parentArray, index, depth) */
function walk(arr, cb, depth){ (arr || []).forEach((s, i) => { cb(s, arr, i, depth || 0); if (isCont(s)) walk(s.children, cb, (depth || 0) + 1); }); }
/* 换新 id（duplicate_in 的 d.reid）——整棵子树 */
function reid(s){ const c = clone(s); const go = n => { n.id = newId(); if (isCont(n)) n.children.forEach(go); }; go(c); return c; }
/* 外观（Style::of：appearance）——我们的外观只有 fill／stroke／strokeWidth */
function styleOf(s){ return {fill:clone(s.fill === undefined ? 'none' : s.fill), stroke:clone(s.stroke === undefined ? 'none' : s.stroke), strokeWidth:s.strokeWidth || 0}; }
const NO_PAINT = {fill:'none', stroke:'none', strokeWidth:0};
function allFinite(o){ if (typeof o === 'number') return isFinite(o); if (o && typeof o === 'object') return Object.values(o).every(allFinite); return true; }

/* ═════════════ 选取（edit.rs:155 selected_roots：选中的物件、按绘制顺序；锁定／隐藏的不算）═════════════ */
function vLayer(p){
  const L = (p && p.layerId) ? Doc.byId(p.layerId) : (VecSel.layer() || Doc.active());
  return (L && L.kind === 'vector') ? L : null;
}
function roots(L, ids){
  const want = ids || ((VecSel.layerId === L.id) ? VecSel.shapes : []);
  return L.data.shapes.filter(s => want.includes(s.id) && !s.locked && s.visible !== false);
}
function targets(p, C){
  const L = vLayer(p); if (!L) return {err:{ok:false, error:C + ': not a vector layer'}};
  const R = roots(L, Array.isArray(p.ids) ? p.ids : null);
  if (!R.length) return {err:{ok:false, error:C + ': nothing selected'}};
  return {L, R};
}
const selectIds = (L, ids) => VecSel.setShapes(L.id, ids.filter(id => L.data.shapes.some(s => s.id === id)));
const vectorLayers = () => Doc.layers.filter(L => L.kind === 'vector');

/* ═════════════ 几何 ═════════════ */
const view = s => (isLeaf(s) ? VecSel.asBezier(s) : null);
/* 一维三次贝兹 (0,1) 内的极值参数 */
function extrema(p0, p1, p2, p3){
  const a = -p0 + 3*p1 - 3*p2 + p3, b = 2*(p0 - 2*p1 + p2), c = p1 - p0, out = [];
  if (Math.abs(a) < 1e-12){ if (Math.abs(b) > 1e-12){ const t = -c / b; if (t > 0 && t < 1) out.push(t); } return out; }
  const D = b*b - 4*a*c; if (D < 0) return out;
  const q = Math.sqrt(D); [(-b + q) / (2*a), (-b - q) / (2*a)].forEach(t => { if (t > 0 && t < 1) out.push(t); });
  return out;
}
const union = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
const center = r => [(r.x0 + r.x1)/2, (r.y0 + r.y1)/2];
const inflate = (r, d) => r && d ? {x0:r.x0 - d, y0:r.y0 - d, x1:r.x1 + d, y1:r.y1 + d} : r;
/* 一条路径视图（anchors, closed）过 f 之后的紧外框（PathData::bounds） */
function viewBounds(v, f){
  if (!v || !v.anchors || !v.anchors.length) return null;
  let r = null; const addp = p => { r = union(r, {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}); };
  v.anchors.forEach(a => addp(f([a.x, a.y])));
  for (const c0 of VecSel.segments(v)){
    const c = {p0:f(c0.p0), c1:f(c0.c1), c2:f(c0.c2), p3:f(c0.p3)};
    for (const k of [0, 1]) extrema(c.p0[k], c.c1[k], c.c2[k], c.p3[k]).forEach(t => addp(VecSel.evalCubic(c, t)));
  }
  return r;
}
/* Node::geometric_bounds／visual_bounds（visual＝含描边）。f：图层坐标 → 想要的坐标（刚体） */
function shapeBounds(s, f, visual){
  if (!s) return null;
  if (s.type === 'group'){
    const kids = (s.clip && s.children.length) ? [s.children[0]] : s.children;    // 剪切组的外框＝剪切路径
    return kids.reduce((r, k) => union(r, shapeBounds(k, f, visual)), null);
  }
  if (s.type === 'compound'){
    const r = s.children.reduce((r, k) => union(r, viewBounds(view(k), f)), null);
    return visual && hasStroke(s) ? inflate(r, s.strokeWidth / 2) : r;
  }
  if (s.type === 'mesh' && s.mesh && s.mesh.points){
    return s.mesh.points.reduce((r, q) => { const p = f([q.x, q.y]); return union(r, {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}); }, null);
  }
  const r = viewBounds(view(s), f);
  return visual && hasStroke(s) ? inflate(r, s.strokeWidth / 2) : r;
}
const docF = L => (p => [p[0] + L.x, p[1] + L.y]);
const boundsOf = (L, list, visual) => list.reduce((r, s) => union(r, shapeBounds(s, docF(L), visual)), null);   // lib.rs:849 bounds_of（文件坐标）
/* orient.rs:114 bbox_angle：共同的外框角度，不一致就 0 */
function bboxAngle(list){
  if (!list.length) return 0;
  const a0 = +list[0].bboxAngle || 0;
  return list.every(s => Math.abs(normDeg((+s.bboxAngle || 0) - a0)) <= 1e-6) ? a0 : 0;
}
/* orient.rs:121 oriented_bounds → {angle, rect, center(文件坐标)} */
function orientedBox(L, list, visual){
  const angle = bboxAngle(list);
  if (angle === 0){ const r = boundsOf(L, list, visual); return r ? {angle:0, rect:r, center:center(r)} : null; }
  const toDoc = A.rotate(-angle * Math.PI / 180), toLocal = A.inverse(toDoc);
  const f = p => A.apply(toLocal, [p[0] + L.x, p[1] + L.y]);
  const r = list.reduce((r, s) => union(r, shapeBounds(s, f, visual)), null);
  return r ? {angle, rect:r, center:A.apply(toDoc, center(r))} : null;
}
/* lib.rs:69 reference_point：九宫格（0 左上 … 4 中心 … 8 右下） */
const refPoint = (r, i) => [[r.x0, (r.x0 + r.x1)/2, r.x1][i % 3], [r.y0, (r.y0 + r.y1)/2, r.y1][Math.min(2, Math.floor(i / 3))]];

/* ═════════════ Node::transform（node.rs:589-678）：编组／复合路径往下套；路径叶子用 rotate.js 的 rotTransformShape ═════════════ */
function xform(L, s, m, sc){
  if (isCont(s)){
    const ang = rotTransformedAngle(+s.bboxAngle || 0, m);
    if (s.type === 'compound'){
      const k = A.factor(m);
      if (k && sc.strokes && typeof s.strokeWidth === 'number') s.strokeWidth *= k;
      if (window.GradientFill){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); }
    }
    for (const c of s.children) if (!xform(L, c, m, sc)) return false;
    if (ang) s.bboxAngle = ang; else delete s.bboxAngle;
    return true;
  }
  return rotTransformShape(L, s, m, sc);
}
const AO = {lastTransform:null};
/* object.rs:207-225 apply_transform：copy ⇒ duplicate_in（复制品插在正上方、选取换成复制品），再逐个 Node::transform；记下再次变换 */
function applyTransform(L, list, m, p, record){
  needRot();
  const copy = !!p.copy;
  // object.rs:197-203 scaling：strokes／corners 缺省照偏好（lib.rs:526-527 两个都是 false）；没缩放就用 Scaling::default
  const sc = A.factor(m) ? {strokes:p.strokes === undefined ? false : !!p.strokes, corners:p.corners === undefined ? false : !!p.corners} : {strokes:false, corners:false};
  let tg = list;
  if (copy){
    tg = [];
    for (const s of list){ const i = L.data.shapes.indexOf(s); if (i < 0) continue; const c = reid(s); L.data.shapes.splice(i + 1, 0, c); tg.push(c); }
    selectIds(L, tg.map(s => s.id));
  }
  const ml = A.toLayer(L, m);
  for (const s of tg){
    if (!xform(L, s, ml, sc)) return {ok:false, error:'cannot transform object ' + s.id};
    if (!allFinite(s)) return {ok:false, error:'transform gives non-finite coordinates'};
  }
  Layer.invalidate(L);
  if (record !== false){
    AO.lastTransform = {matrix:m.slice(), copy};
    if (window.RotTool) RotTool.lastTransform = {matrix:m.slice(), copy};      // 跟旋转工具共用同一个「上一次变换」（原码只有一个 last_transform）
  }
  return {ok:true, ids:tg.map(s => s.id), layerId:L.id};
}
const pt = v => (Array.isArray(v) && v.length >= 2 && isFinite(+v[0]) && isFinite(+v[1])) ? [+v[0], +v[1]] : null;
/* object.rs:187 origin_of：给了 origin 就用，否则 transform_box 的中心 */
function originOf(L, R, p){ const o = pt(p.origin); if (o) return o; const b = orientedBox(L, R, false); return b ? b.center : null; }

/* ═════════════ 拟合（pathops/src/fit.rs 全段照翻）═════════════ */
const Fit = {
  startTan(c){ return unit(sub(c.c1, c.p0)) || unit(sub(c.c2, c.p0)) || unit(sub(c.p3, c.p0)) || [1, 0]; },
  endTan(c){ return unit(sub(c.p3, c.c2)) || unit(sub(c.p3, c.c1)) || unit(sub(c.p3, c.p0)) || [1, 0]; },
  ev(c, t){ return VecSel.evalCubic(c, t); },
  d1(c, t){ return VecSel.derivCubic(c, t); },
  d2(c, t){ const a = add(sub(c.c2, mul(c.c1, 2)), c.p0), b = add(sub(c.p3, mul(c.c2, 2)), c.c1); return add(mul(a, 6*(1 - t)), mul(b, 6*t)); },
  fitCubics(pts, t0, t1, tol){
    const out = [], P = [];
    for (const p of pts) if (!P.length || dist(P[P.length-1], p) > 1e-12) P.push(p);
    if (P.length < 2) return out;
    this.rec(P, t0, t1, Math.max(tol, 1e-9), out, 0);
    return out;
  },
  rec(P, t0, t1, tol, out, depth){
    const n = P.length;
    if (n === 2){ const d = dist(P[0], P[1]) / 3; out.push({p0:P[0], c1:add(P[0], mul(t0, d)), c2:sub(P[1], mul(t1, d)), p3:P[1]}); return; }
    const [c, err, split0] = this.fitSingle(P, t0, t1);
    if (err <= tol || depth > 40){ out.push(c); return; }
    const split = clamp(split0, 1, n - 2);
    const tc = unit(sub(P[split + 1], P[split - 1])) || t0;
    this.rec(P.slice(0, split + 1), t0, tc, tol, out, depth + 1);
    this.rec(P.slice(split), tc, t1, tol, out, depth + 1);
  },
  fitSingle(P, t0, t1){
    let u = this.chord(P), best = this.generate(P, u, t0, t1), [be, bs] = this.maxError(P, best, u);
    for (let k = 0; k < 6; k++){
      u = u.map((ui, i) => this.newton(best, P[i], ui));
      const c = this.generate(P, u, t0, t1), [e, s] = this.maxError(P, c, u);
      if (e < be){ best = c; be = e; bs = s; } else break;
    }
    return [best, be, bs];
  },
  chord(P){ const u = [0]; let acc = 0; for (let i = 1; i < P.length; i++){ acc += dist(P[i-1], P[i]); u.push(acc); } return acc > 0 ? u.map(x => x / acc) : u; },
  bern(t){ const s = 1 - t; return [s*s*s, 3*s*s*t, 3*s*t*t, t*t*t]; },
  generate(P, u, t0, t1){
    const p0 = P[0], p3 = P[P.length - 1], dIn = mul(t1, -1);
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    P.forEach((p, i) => {
      const b = this.bern(u[i]), a0 = mul(t0, b[1]), a1 = mul(dIn, b[2]);
      c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
      const tmp = sub(p, add(mul(p0, b[0] + b[1]), mul(p3, b[2] + b[3])));
      x0 += dot(a0, tmp); x1 += dot(a1, tmp);
    });
    const det = c00*c11 - c01*c01, seg = dist(p0, p3), eps = 1e-6 * seg;
    let al, ar;
    if (Math.abs(det) > 1e-12){ al = (x0*c11 - x1*c01) / det; ar = (c00*x1 - c01*x0) / det; } else { al = seg/3; ar = seg/3; }
    if (!isFinite(al) || !isFinite(ar) || al < eps || ar < eps){ al = seg/3; ar = seg/3; }
    const cap = seg*4 + 1e-9; al = Math.min(al, cap); ar = Math.min(ar, cap);
    return {p0, c1:add(p0, mul(t0, al)), c2:add(p3, mul(dIn, ar)), p3};
  },
  maxError(P, c, u){ let e = 0, idx = Math.floor(P.length / 2); P.forEach((p, i) => { const d = dist(this.ev(c, u[i]), p); if (d > e){ e = d; idx = i; } }); return [e, idx]; },
  newton(c, p, t){
    const q = sub(this.ev(c, t), p), q1 = this.d1(c, t), q2 = this.d2(c, t);
    const nu = dot(q, q1), de = dot(q1, q1) + dot(q, q2);
    if (Math.abs(de) < 1e-12) return t;
    const nt = t - nu / de; return isFinite(nt) ? clamp(nt, 0, 1) : t;
  },
  isStraight(c, tol){
    const ch = sub(c.p3, c.p0), len = Math.hypot(ch[0], ch[1]);
    if (len < 1e-12) return dist(c.c1, c.p0) <= tol && dist(c.c2, c.p0) <= tol;
    const d = [ch[0]/len, ch[1]/len];
    return [c.c1, c.c2].every(h => { const v = sub(h, c.p0), al = dot(v, d); return Math.abs(cross(v, d)) <= tol && al >= -tol && al <= len + tol; });
  },
  sample(c, n, out, inclStart){ for (let i = inclStart ? 0 : 1; i <= n; i++) out.push(this.ev(c, i / n)); },
  arclen(c){ let l = 0, prev = c.p0; for (let i = 1; i <= 32; i++){ const q = this.ev(c, i / 32); l += dist(prev, q); prev = q; } return l; }
};
/* 线段（boolean.rs:350 Seg）：{c, line} */
const segLine = (a, b) => ({c:{p0:a, c1:a, c2:b, p3:b}, line:true});
function segsOf(v){
  const out = [], An = v.anchors;
  for (let i = 0; i < VecSel.segCount(v); i++){ const a = An[i], b = An[(i + 1) % An.length]; out.push({c:VecSel.segment(v, i), line:!a.out && !b.in}); }
  return out;
}
const hnd = (p, h) => VecSel._h(p, h);
/* boolean.rs:379 segs_to_subpath → 我们的 {anchors, closed} */
function segsToAnchors(segs, closed){
  if (!segs.length) return null;
  const n = segs.length, An = [];
  for (let i = 0; i < n; i++){
    const s = segs[i], p = s.c.p0;
    const out = s.line ? p : s.c.c1;
    let hin = p;
    if (!(i === 0 && !closed)){ const pv = segs[(i + n - 1) % n]; hin = pv.line ? p : pv.c.c2; }
    An.push({x:p[0], y:p[1], in:hnd(p, hin), out:hnd(p, out)});
  }
  if (!closed){ const l = segs[n - 1], p = l.c.p3; An.push({x:p[0], y:p[1], in:hnd(p, l.line ? p : l.c.c2), out:null}); }
  if (closed && An.length < 2) return null;
  return {anchors:An, closed};
}
const turnDeg = (a, b) => Math.acos(clamp(dot(Fit.endTan(a.c), Fit.startTan(b.c)), -1, 1)) * 180 / Math.PI;
/* Ramer–Douglas–Peucker（edit.rs:107 rdp） */
function rdp(P, tol){
  if (P.length < 3) return P.slice();
  const keep = P.map(() => false); keep[0] = keep[P.length - 1] = true;
  const st = [[0, P.length - 1]];
  while (st.length){
    const [a, b] = st.pop(), ch = sub(P[b], P[a]), len = Math.hypot(ch[0], ch[1]);
    let best = [0, a];
    for (let i = a + 1; i < b; i++){ const d = len < 1e-12 ? dist(P[i], P[a]) : Math.abs(cross(sub(P[i], P[a]), ch)) / len; if (d > best[0]) best = [d, i]; }
    if (best[0] > tol){ keep[best[1]] = true; st.push([a, best[1]], [best[1], b]); }
  }
  return P.filter((_, i) => keep[i]);
}
/* edit.rs:47 simplify_with：一条子路径 v {anchors, closed} → 新的 {anchors, closed} */
function simplifyView(v, o){
  const tol = Math.max(o.tolerance, 1e-6);
  let segs = segsOf(v); const n = segs.length;
  if (!n) return {anchors:clone(v.anchors), closed:!!v.closed};
  const cornerAt = i => (!v.closed && (i === 0 || i === n)) ? true : turnDeg(segs[(i + n - 1) % n], segs[i % n]) > o.cornerAngle;
  let corners = []; for (let i = 0; i < n; i++) if (cornerAt(i)) corners.push(i);
  if (v.closed){
    if (corners.length){ const k = corners[0]; segs = segs.slice(k).concat(segs.slice(0, k)); corners = corners.map(c => c - k); }
    else corners = [0];
    corners.push(n);
  } else if (corners[corners.length - 1] !== n) corners.push(n);
  const res = [];
  for (let w = 0; w + 1 < corners.length; w++){
    const run = segs.slice(corners[w], corners[w + 1]); if (!run.length) continue;
    const pts = [];
    run.forEach((s, k) => { const m = clamp(Math.ceil(Fit.arclen(s.c) / (tol * 0.5)), 4, 256); Fit.sample(s.c, m, pts, k === 0); });
    if (o.straightLines){ const keep = rdp(pts, tol); for (let i = 0; i + 1 < keep.length; i++) res.push(segLine(keep[i], keep[i + 1])); continue; }
    const t0 = Fit.startTan(run[0].c), t1 = Fit.endTan(run[run.length - 1].c);
    for (const c of Fit.fitCubics(pts, t0, t1, tol)){ const line = Fit.isStraight(c, tol * 0.02); res.push(line ? segLine(c.p0, c.p3) : {c, line}); }
  }
  const s = segsToAnchors(res, !!v.closed);
  if (!s) return null;
  return (!o.straightLines && s.anchors.length > v.anchors.length) ? {anchors:clone(v.anchors), closed:!!v.closed} : s;   // no_worse
}

/* ═════════════ 拉平、描边轮廓、布尔（offset.rs／boolean.rs 的替代实作，见档头）═════════════ */
const FLAT = 0.02;                 // 拉平容差（文件单位）
function flatCubic(c, tol, out, depth){
  const ch = sub(c.p3, c.p0), len = Math.hypot(ch[0], ch[1]);
  const dev = len < 1e-12 ? Math.max(dist(c.c1, c.p0), dist(c.c2, c.p0)) : Math.max(Math.abs(cross(sub(c.c1, c.p0), ch)), Math.abs(cross(sub(c.c2, c.p0), ch))) / len;
  if (dev <= tol || depth > 18){ out.push(c.p3); return; }
  const [l, r] = VecSel.splitCubic(c, 0.5);
  flatCubic(l, tol, out, depth + 1); flatCubic(r, tol, out, depth + 1);
}
/* 一条子路径 → 折线点（闭合的不重复起点） */
function flatten(v, tol){
  if (!v || !v.anchors || !v.anchors.length) return [];
  const out = [[v.anchors[0].x, v.anchors[0].y]];
  for (const s of segsOf(v)){ if (s.line) out.push(s.c.p3); else flatCubic(s.c, tol || FLAT, out, 0); }
  if (v.closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-9) out.pop();
  return out;
}
const polyArea = P => { let a = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; };   // 正＝画面顺时针（y 朝下），同 SubPath::signed_area
const polyPerim = P => { let l = 0; for (let i = 0; i < P.length; i++) l += dist(P[i], P[(i + 1) % P.length]); return l; };
const positive = P => polyArea(P) < 0 ? P.slice().reverse() : P;
/* 圆弧点（不含起点）：从角 a0 转 sweep 弧度，半径 r */
function arcPts(c, r, a0, sweep, tol){
  const step = r > tol ? 2 * Math.acos(clamp(1 - tol / r, -1, 1)) : Math.PI / 2;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3)));
  const out = []; for (let i = 1; i <= n; i++){ const a = a0 + sweep * i / n; out.push([c[0] + Math.cos(a)*r, c[1] + Math.sin(a)*r]); }
  return out;
}
/* 一条折线描边（宽 w）的覆盖区＝各段的矩形 ∪ 转角外侧的接合片 ∪ 端帽；全部转成同一个方向（非零绕数下就是联集）
   join：'miter'|'round'|'bevel'；cap：'butt'|'round'|'square'（kurbo Stroke 的 Join／Cap） */
function strokePieces(P, closed, w, join, cap, miterLimit){
  const h = w / 2, out = [], n = P.length;
  if (n < 2 || !(h > 0)) return out;
  const segN = closed ? n : n - 1;
  const dirs = [];
  for (let i = 0; i < segN; i++){
    const a = P[i], b = P[(i + 1) % n], d = unit(sub(b, a)); if (!d){ dirs.push(null); continue; }
    dirs.push(d);
    const nr = [-d[1]*h, d[0]*h];
    out.push(positive([add(a, nr), add(b, nr), sub(b, nr), sub(a, nr)]));
  }
  const nb = (d) => [-d[1], d[0]];
  const joinAt = (p, d1, d2) => {
    if (!d1 || !d2) return;
    const cr = cross(d1, d2), dt = dot(d1, d2); if (Math.abs(cr) < 1e-12 && dt > 0) return;
    const s = cr > 0 ? -1 : 1;                                   // 外侧：转弯的反方向那一侧
    const n1 = mul(nb(d1), s*h), n2 = mul(nb(d2), s*h), a = add(p, n1), b = add(p, n2);
    const turn = Math.atan2(Math.abs(cr), dt);                   // 外角
    if (join === 'round'){
      const a0 = Math.atan2(n1[1], n1[0]); let sw = Math.atan2(n2[1], n2[0]) - a0;
      while (sw > Math.PI) sw -= 2*Math.PI; while (sw < -Math.PI) sw += 2*Math.PI;
      out.push(positive([p, a].concat(arcPts(p, h, a0, sw, FLAT))));
    } else if (join === 'miter' && 1 / Math.cos(turn / 2) <= miterLimit){
      const mid = unit(add(n1, n2)); if (!mid){ out.push(positive([p, a, b])); return; }
      out.push(positive([p, a, add(p, mul(mid, h / Math.cos(turn / 2))), b]));
    } else out.push(positive([p, a, b]));
  };
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) joinAt(P[i], dirs[(i - 1 + segN) % segN], dirs[i % segN]);
  if (!closed){
    const ends = [[P[0], dirs[0] && mul(dirs[0], -1)], [P[n - 1], dirs[segN - 1]]];
    for (const [p, d] of ends){
      if (!d || cap === 'butt') continue;
      const nr = mul(nb(d), h);
      // nr ＝ d 转 +90°，所以从 nr 往 −π 方向转半圈会经过 d（往外的那一头）
      if (cap === 'round'){ const a0 = Math.atan2(nr[1], nr[0]); out.push(positive([add(p, nr)].concat(arcPts(p, h, a0, -Math.PI, FLAT)))); }
      else out.push(positive([add(p, nr), add(add(p, nr), mul(d, h)), add(sub(p, nr), mul(d, h)), sub(p, nr)]));
    }
  }
  return out;
}
/* 平面排列＋谓词（boolean.rs Arrangement::contours 的替代）：sets=[{polys:[[x,y]…][], rule:'nonzero'|'evenodd'}]，pred(mask:bool[]) → 边界环（每个环里面都在同一侧） */
function arrangement(sets, pred){
  const E = [];
  sets.forEach((S, si) => S.polys.forEach(P => { for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if (dist(a, b) > 1e-12) E.push({a, b, s:si}); } }));
  if (!E.length) return [];
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  E.forEach(e => { e.x0 = Math.min(e.a[0], e.b[0]); e.x1 = Math.max(e.a[0], e.b[0]); e.y0 = Math.min(e.a[1], e.b[1]); e.y1 = Math.max(e.a[1], e.b[1]);
                   X0 = Math.min(X0, e.x0); X1 = Math.max(X1, e.x1); Y0 = Math.min(Y0, e.y0); Y1 = Math.max(Y1, e.y1); });
  const scale = Math.max(1, X1 - X0, Y1 - Y0), ET = 1e-9 * scale;
  // ① 两两求交、记下切点参数
  const cuts = E.map(() => [0, 1]);
  const ord = E.map((_, i) => i).sort((i, j) => E[i].x0 - E[j].x0);
  for (let oi = 0; oi < ord.length; oi++){
    const i = ord[oi], e = E[i];
    for (let oj = oi + 1; oj < ord.length; oj++){
      const j = ord[oj], f = E[j];
      if (f.x0 > e.x1 + ET) break;
      if (f.y0 > e.y1 + ET || f.y1 < e.y0 - ET) continue;
      const r = sub(e.b, e.a), s = sub(f.b, f.a), qp = sub(f.a, e.a), den = cross(r, s);
      const lr = Math.hypot(r[0], r[1]), ls = Math.hypot(s[0], s[1]);
      if (Math.abs(den) <= 1e-12 * lr * ls){
        if (Math.abs(cross(qp, r)) / lr > ET) continue;           // 平行不共线
        const rr = dot(r, r), ss = dot(s, s);
        [f.a, f.b].forEach(q => { const t = dot(sub(q, e.a), r) / rr; if (t > 1e-12 && t < 1 - 1e-12) cuts[i].push(t); });
        [e.a, e.b].forEach(q => { const u = dot(sub(q, f.a), s) / ss; if (u > 1e-12 && u < 1 - 1e-12) cuts[j].push(u); });
        continue;
      }
      const t = cross(qp, s) / den, u = cross(qp, r) / den, tt = ET / lr, tu = ET / ls;
      if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) continue;
      cuts[i].push(clamp(t, 0, 1)); cuts[j].push(clamp(u, 0, 1));
    }
  }
  // ② 切成小段、顶点合并（网格吸附＋邻格查找）
  const V = [], grid = new Map(), G = Math.max(1e-7 * scale, 1e-9);
  const vid = p => {
    const gx = Math.round(p[0] / G), gy = Math.round(p[1] / G);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
      const L = grid.get((gx + dx) + ',' + (gy + dy)); if (L) for (const k of L) if (dist(V[k], p) <= 1.5 * G) return k;
    }
    V.push(p); const key = gx + ',' + gy; (grid.get(key) || grid.set(key, []).get(key)).push(V.length - 1); return V.length - 1;
  };
  const pieces = [], seen = new Set();
  E.forEach((e, i) => {
    const ts = cuts[i].sort((x, y) => x - y);
    let prev = vid(e.a);
    for (let k = 1; k < ts.length; k++){
      if (ts[k] - ts[k - 1] < 1e-12 && k < ts.length - 1) continue;
      const v = k === ts.length - 1 ? vid(e.b) : vid(lerp(e.a, e.b, ts[k]));
      if (v !== prev){ const key = Math.min(prev, v) + '_' + Math.max(prev, v); if (!seen.has(key)){ seen.add(key); pieces.push([prev, v]); } }
      prev = v;
    }
  });
  // ③ 每段两侧各输入的绕数——不取样（取样遇到比取样距离还薄的碎缝会判错），改成精确算：
  //    从段中点 m 沿（大致）法向射一条水平或铅直射线，跟这段不共线的边照常数穿越；跟这段共线（盖住它）的边只有「射线穿过这条线的那一侧」才算。
  const NB = Math.max(1, Math.min(1024, Math.ceil(E.length / 4)));
  const mkBuckets = (lo, hi, k0, k1) => { const w = (hi - lo) / NB || 1, B = Array.from({length:NB}, () => []);
    E.forEach(e => { const b0 = clamp(Math.floor((e[k0] - lo) / w), 0, NB - 1), b1 = clamp(Math.floor((e[k1] - lo) / w), 0, NB - 1); for (let b = b0; b <= b1; b++) B[b].push(e); });
    return v => B[clamp(Math.floor((v - lo) / w), 0, NB - 1)]; };
  const byY = mkBuckets(Y0, Y1, 'y0', 'y1'), byX = mkBuckets(X0, X1, 'x0', 'x1');
  const tolL = 1e-9 * scale;
  const sides = (a, b, nrm) => {
    const m = lerp(a, b, 0.5), horiz = Math.abs(nrm[0]) >= Math.abs(nrm[1]);
    const r = horiz ? [Math.sign(nrm[0]), 0] : [0, Math.sign(nrm[1])], rv = [-r[1], r[0]];
    const base = sets.map(() => 0), cont = sets.map(() => 0), d = sub(b, a), len = Math.hypot(d[0], d[1]);
    for (const e of (horiz ? byY(m[1]) : byX(m[0]))){
      const ed = sub(e.b, e.a), el = Math.hypot(ed[0], ed[1]);
      const sg = cross(r, ed) > 0 ? 1 : -1;
      // 共线而且盖住这段？（两个端点都在这条边上）
      if (Math.abs(cross(ed, sub(a, e.a))) / el <= tolL && Math.abs(cross(ed, sub(b, e.a))) / el <= tolL){
        const ta = dot(sub(a, e.a), ed) / (el * el), tb = dot(sub(b, e.a), ed) / (el * el);
        if (Math.min(ta, tb) >= -1e-9 && Math.max(ta, tb) <= 1 + 1e-9){ cont[e.s] += sg; continue; }
        continue;                                              // 共线但不重叠：射线沿法向，碰不到
      }
      const av = dot(sub(e.a, m), rv), bv = dot(sub(e.b, m), rv);
      if ((av <= 0) === (bv <= 0)) continue;
      const au = dot(sub(e.a, m), r), bu = dot(sub(e.b, m), r), u = au + (0 - av) / (bv - av) * (bu - au);
      if (u > 0) base[e.s] += sg;
    }
    const ins = w => w.map((x, i) => sets[i].rule === 'evenodd' ? (x % 2 !== 0) : x !== 0);
    // 射线方向跟法向同侧 ⇒ 法向那一侧（左）的点射出去碰不到共线边，右侧的点会穿过
    return [ins(base), ins(base.map((x, i) => x + cont[i]))];
  };
  // ④ 留下两侧谓词不同的段，转成「里面在左法向那一侧」
  const out = new Map(), used = new Set(), keep = [];
  for (const [va, vb] of pieces){
    const a = V[va], b = V[vb], d = sub(b, a), len = Math.hypot(d[0], d[1]); if (len < 1e-12) continue;
    const nrm = [-d[1]/len, d[0]/len], [mA, mB] = sides(a, b, nrm);
    const iA = pred(mA), iB = pred(mB);
    if (iA === iB) continue;
    const k = keep.length; keep.push(iA ? [va, vb] : [vb, va]);
    const from = keep[k][0]; (out.get(from) || out.set(from, []).get(from)).push(k);
  }
  // ⑤ 接成环
  const loops = [];
  for (let k0 = 0; k0 < keep.length; k0++){
    if (used.has(k0)) continue;
    const loop = []; let k = k0, guard = keep.length + 5;
    while (k !== undefined && !used.has(k) && guard--){
      used.add(k); loop.push(V[keep[k][0]]);
      const end = keep[k][1]; if (end === keep[k0][0]) break;
      const cand = (out.get(end) || []).filter(x => !used.has(x));
      if (cand.length <= 1){ k = cand[0]; continue; }
      const din = sub(V[end], V[keep[k][0]]);                         // 多条出边：挑最往左转的那条
      let best = null, ba = -Infinity;
      for (const c of cand){ const dd = sub(V[keep[c][1]], V[end]), ang = Math.atan2(cross(din, dd), dot(din, dd)); if (ang > ba){ ba = ang; best = c; } }
      k = best;
    }
    // 去掉共线点、太细的碎片（is_sliver：2·面积／周长 < 精度 0.01）
    const P = [];
    for (let i = 0; i < loop.length; i++){
      const p = loop[i], a = P.length ? P[P.length - 1] : loop[loop.length - 1], b = loop[(i + 1) % loop.length];
      if (Math.abs(cross(sub(p, a), sub(b, p))) <= 1e-12 * scale * scale && dot(sub(p, a), sub(b, p)) > 0) continue;
      P.push(p);
    }
    if (P.length >= 3 && 2 * Math.abs(polyArea(P)) / polyPerim(P) >= 0.01) loops.push(P);
  }
  return loops;
}
/* 折线环 → 拟合回曲线（boolean.rs Tidy 的替代）：转角（>30°）处断开，每段用 fit_cubics 拟合；长直边先加密免得拟合飘掉 */
function tidyLoop(P){
  const n = P.length, tol = 0.03;
  if (n < 3) return null;
  const turn = i => { const a = unit(sub(P[i], P[(i - 1 + n) % n])), b = unit(sub(P[(i + 1) % n], P[i])); return (!a || !b) ? 0 : Math.acos(clamp(dot(a, b), -1, 1)) * 180 / Math.PI; };
  let corners = []; for (let i = 0; i < n; i++) if (turn(i) > 30) corners.push(i);
  const rot = corners.length ? corners[0] : 0, Q = P.slice(rot).concat(P.slice(0, rot));
  corners = corners.length ? corners.map(c => (c - rot + n) % n).sort((a, b) => a - b) : [0];
  corners.push(n);
  const segs = [];
  for (let w = 0; w + 1 < corners.length; w++){
    const run = []; for (let i = corners[w]; i <= corners[w + 1]; i++) run.push(Q[i % n]);
    if (run.length === 2){ segs.push(segLine(run[0], run[1])); continue; }
    const pts = [run[0]];
    for (let i = 1; i < run.length; i++){ const a = run[i - 1], b = run[i], k = Math.ceil(dist(a, b) / 2); for (let j = 1; j <= k; j++) pts.push(lerp(a, b, j / k)); }
    const t0 = unit(sub(run[1], run[0])) || [1, 0], t1 = unit(sub(run[run.length - 1], run[run.length - 2])) || [1, 0];
    for (const c of Fit.fitCubics(pts, t0, t1, tol)) segs.push(Fit.isStraight(c, 1e-3) ? segLine(c.p0, c.p3) : {c, line:false});
  }
  return segsToAnchors(segs, true);
}
/* 形状 → 填色用的折线集（fill_bezpath：开放子路径也当闭合）与填色规则（node_path） */
function fillPolys(s, f){
  const subs = s.type === 'compound' ? s.children.map(view) : [view(s)];
  const polys = subs.filter(v => v && v.anchors && v.anchors.length >= 2).map(v => { let P = flatten(v); if (f) P = P.map(f); return P; }).filter(P => P.length >= 2);
  return {polys, rule:s.type === 'compound' && s.rule === 'evenodd' ? 'evenodd' : 'nonzero'};
}
const subviews = s => (s.type === 'compound' ? s.children.map(view) : [view(s)]).filter(v => v && v.anchors && v.anchors.length >= 2);
/* shape_node（pathops.rs:262）：一个环＝路径，多个＝复合路径；外观照 src */
function shapeNode(loops, src){
  const subs = loops.map(tidyLoop).filter(Boolean);
  if (!subs.length) return null;
  const st = src ? styleOf(src) : NO_PAINT;
  if (subs.length === 1) return Object.assign({id:newId(), type:'bezier', anchors:subs[0].anchors, closed:true}, st);
  return Object.assign({id:newId(), type:'compound', rule:'nonzero', children:subs.map(v => Object.assign({id:newId(), type:'bezier', anchors:v.anchors, closed:true}, NO_PAINT))}, st);
}
/* 描边覆盖区（stroke_region）：一个形状所有子路径的描边轮廓，回边界环 */
function strokeRegion(s, w, join, cap, miterLimit){
  const pieces = [];
  for (const v of subviews(s)) pieces.push(...strokePieces(flatten(v), !!v.closed, w, join, cap, miterLimit));
  return pieces.length ? arrangement([{polys:pieces, rule:'nonzero'}], m => m[0]) : [];
}

/* ═════════════ 叶子（pathops.rs:248 leaves：路径、复合路径；剪切路径跳过）与就地替换（replace_leaves）═════════════ */
function leavesOf(s, out){
  if (s.type === 'group') s.children.forEach(c => leavesOf(c, out));
  else if ((isLeaf(s) && !s.clipping) || s.type === 'compound') out.push(s);
  return out;
}
/* 把 root 底下每个叶子换成 f(leaf)（null＝不换）→ {id（现在代表 root 的）, changed} */
function replaceLeaves(L, root, f){
  let rep = root.id, changed = 0;
  for (const l of leavesOf(root, [])){
    const nw = f(l); if (!nw) continue;
    let hit = null; walk(L.data.shapes, (s, arr, i) => { if (!hit && s === l) hit = [arr, i]; });
    if (!hit) continue;
    hit[0].splice(hit[1], 1, nw); changed++;
    if (l === root) rep = nw.id;
  }
  return {id:rep, changed};
}
/* outline_strokes（pathops.rs:529）：有描边的叶子 ⇒ [填色副本, 描边轮廓] 编组，或只有轮廓 */
function outlineLeaf(l){
  if (!hasStroke(l)) return null;
  const loops = strokeRegion(l, l.strokeWidth, 'round', 'round', 4);     // engine.js drawShape 描边是圆角接合、圆头（lineJoin/lineCap round）
  const parts = [];
  if (painted(l.fill)){ const c = reid(l); c.stroke = 'none'; c.strokeWidth = 0; delete c.name; if (LIVE.includes(c.type)) VecSel.ensureBezier(null, c); parts.push(c); }   // styled_copy
  const o = shapeNode(loops, null);
  if (o){ o.fill = clone(l.stroke); o.stroke = 'none'; o.strokeWidth = 0; parts.push(o); }
  if (!parts.length) return null;
  const r = parts.length === 1 ? parts[0] : {id:newId(), type:'group', children:parts};   // assemble
  if (l.name) r.name = l.name;
  return r;
}

/* ═════════════ 命令登记 ═════════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
/* 原码「没事可做就不推历史」那几条：不登记成 undoable，要动文件前自己推一步 */
function regEdit(id, meta, fn){
  CMD.reg(id, Object.assign({i18n:''}, meta, {undoable:false}), p => {
    let pushed = false; const touch = () => { if (!pushed){ History.push(); pushed = true; } };
    try { const r = fn(p || {}, touch); if (pushed && r && r.ok === false) History.restoreInPlace(History.past.pop()); return r; }
    catch (e){ if (pushed) History.restoreInPlace(History.past.pop()); throw e; }
  });
}
const done = (L, extra) => { Layer.invalidate(L); return Object.assign({ok:true}, extra || {}); };

/* ── 变换（object.rs:227-309、menucmds.rs:182-317）── */
reg('ai.object.transform', {undoable:true,
  params:'{matrix:[a,b,c,d,e,f] 文件坐标仿射, copy?, ids?, layerId?, strokes?:bool=false, corners?:bool=false} 照 object.transform：把仿射套到选中的物件（编组／复合路径整棵套）→ {ok, ids}'}, p => {
  if (!(Array.isArray(p.matrix) && p.matrix.length === 6 && p.matrix.every(v => isFinite(+v)))) return {ok:false, error:'ai.object.transform: missing matrix [a,b,c,d,e,f]'};
  const t = targets(p, 'ai.object.transform'); if (t.err) return t.err;
  return applyTransform(t.L, t.R, p.matrix.map(Number), p);
});
reg('ai.object.move', {undoable:true, params:'{dx, dy, copy?} 照 object.move（移动…）：选中的物件平移 (dx,dy)（文件单位，y 朝下为正）；copy＝先复制再移 → {ok, ids}'}, p => {
  const t = targets(p, 'ai.object.move'); if (t.err) return t.err;
  return applyTransform(t.L, t.R, A.translate(num(p.dx, 0), num(p.dy, 0)), p);
});
reg('ai.object.rotate', {undoable:true,
  params:'{angle:度（逆时针为正）, absolute?:bool（angle 是外框的新角度）, origin?:[x,y]（缺省＝选取外框中心）, copy?} 照 object.rotate → {ok, ids, origin, angle}'}, p => {
  const t = targets(p, 'ai.object.rotate'); if (t.err) return t.err;
  const o = originOf(t.L, t.R, p); if (!o) return {ok:false, error:'selection has no bounds'};
  let ang = num(p.angle, 0);
  if (p.absolute) ang = normDeg(ang - bboxAngle(t.R));
  const r = applyTransform(t.L, t.R, A.about(o, A.rotate(-ang * Math.PI / 180)), p);   // 逆时针、y 朝下 ⇒ 取负（object.rs:263）
  return r.ok ? Object.assign(r, {origin:o, angle:ang}) : r;
});
reg('ai.object.scale', {undoable:true,
  params:'{sx:%, sy?:%（缺省＝sx）, origin?:[x,y], copy?, strokes?:bool（比例缩放描边和效果）=false, corners?:bool（缩放圆角）=false} 照 object.scale → {ok, ids}'}, p => {
  if (!fin(num(p.sx, NaN))) return {ok:false, error:'ai.object.scale: missing sx'};
  const sx = num(p.sx) / 100, sy = num(p.sy, sx * 100) / 100;
  if (sx === 0 || sy === 0) return {ok:false, error:'ai.object.scale: scale must be non-zero'};
  const t = targets(p, 'ai.object.scale'); if (t.err) return t.err;
  const o = originOf(t.L, t.R, p); if (!o) return {ok:false, error:'selection has no bounds'};
  return applyTransform(t.L, t.R, A.about(o, A.scale(sx, sy)), p);
});
function reflectM(axis){
  if (typeof axis === 'string' && axis.trim() !== '' && isFinite(+axis)) axis = +axis;
  if (axis === 'horizontal') return A.scale(1, -1);
  if (typeof axis === 'number'){ const t = -axis * Math.PI / 180; return A.mul(A.rotate(t), A.mul(A.scale(1, -1), A.rotate(-t))); }
  return A.scale(-1, 1);
}
reg('ai.object.reflect', {undoable:true,
  params:'{axis:"vertical"(缺省，左右翻)|"horizontal"(上下翻)|角度, origin?, copy?} 照 object.reflect（对称…）→ {ok, ids}'}, p => {
  const t = targets(p, 'ai.object.reflect'); if (t.err) return t.err;
  const o = originOf(t.L, t.R, p); if (!o) return {ok:false, error:'selection has no bounds'};
  return applyTransform(t.L, t.R, A.about(o, reflectM(p.axis)), p);
});
reg('ai.object.shear', {undoable:true,
  params:'{angle:度（夹在 ±89）, axis?:"horizontal"(缺省)|"vertical", origin?, copy?} 照 object.shear（倾斜…）→ {ok, ids}'}, p => {
  const t = targets(p, 'ai.object.shear'); if (t.err) return t.err;
  const o = originOf(t.L, t.R, p); if (!o) return {ok:false, error:'selection has no bounds'};
  const k = Math.tan(clamp(num(p.angle, 0), -89, 89) * Math.PI / 180);
  const m = p.axis === 'vertical' ? [1, k, 0, 1, 0, 0] : [1, 0, -k, 1, 0, 0];
  return applyTransform(t.L, t.R, A.about(o, m), p);
});
reg('ai.object.transformAgain', {undoable:true, params:'{} 照 object.transformAgain（再次变换 Ctrl+D）：把上一次的变换矩阵（同样复不复制）再套到目前的选取 → {ok, ids}'}, p => {
  const lt = (window.RotTool && RotTool.lastTransform) || AO.lastTransform;
  if (!lt) return {ok:false, error:'no previous transform'};
  const t = targets(p, 'ai.object.transformAgain'); if (t.err) return t.err;
  return applyTransform(t.L, t.R, lt.matrix, {copy:lt.copy});
});
/* menucmds.rs:262 xorshift64* */
function rng(seed){
  let s = BigInt.asUintN(64, BigInt(seed)); if (s === 0n) s = 1n;
  return () => { s ^= s >> 12n; s = BigInt.asUintN(64, s ^ (s << 25n)); s ^= s >> 27n; return Number(BigInt.asUintN(64, s * 0x2545F4914F6CDD1Dn) >> 11n) / 2 ** 53; };
}
reg('ai.object.transformEach', {undoable:true,
  params:'{scaleH?:%=100, scaleV?:%=100, moveH?:=0, moveV?:=0（y 朝下为正）, rotate?:度（逆时针）=0, reflectX?:bool（上下翻）, reflectY?:bool（左右翻）, random?:bool, seed?:整数, reference?:0..8（九宫格，4＝中心）, copy?, strokes?, corners?} ' +
         '照 object.transformEach（分别变换…）：每个物件绕自己外框的参考点各自变换 → {ok, ids}'}, p => {
  needRot();
  const sh = clamp(num(p.scaleH, 100), -1e5, 1e5), sv = clamp(num(p.scaleV, 100), -1e5, 1e5);
  const mh = clamp(num(p.moveH, 0), -1e7, 1e7), mv = clamp(num(p.moveV, 0), -1e7, 1e7), rot = num(p.rotate, 0);
  const rx = !!p.reflectX, ry = !!p.reflectY, random = !!p.random, refi = Math.min(8, Math.max(0, Math.floor(num(p.reference, 4)))), copy = !!p.copy;
  if (sh === 0 || sv === 0) return {ok:false, error:'ai.object.transformEach: scale must be non-zero'};
  const t = targets(p, 'ai.object.transformEach'); if (t.err) return t.err;
  const L = t.L;
  let seed = 0x9E3779B97F4A7C15n; try { if (p.seed !== undefined && p.seed !== null) seed = BigInt(Math.floor(+p.seed)); } catch (e){}
  const next = rng(seed);
  const sc = (sh !== 100 || sv !== 100) ? {strokes:!!p.strokes, corners:!!p.corners} : {strokes:false, corners:false};
  let tg = t.R;
  if (copy){ tg = []; for (const s of t.R){ const i = L.data.shapes.indexOf(s); const c = reid(s); L.data.shapes.splice(i + 1, 0, c); tg.push(c); } selectIds(L, tg.map(s => s.id)); }
  for (const s of tg){
    const b = shapeBounds(s, docF(L), false); if (!b) continue;
    let [ksh, ksv, kmh, kmv, krot] = [sh, sv, mh, mv, rot];
    if (random){ ksh = 100 + (sh - 100) * next(); ksv = 100 + (sv - 100) * next(); kmh = mh * (next() * 2 - 1); kmv = mv * (next() * 2 - 1); krot = rot * (next() * 2 - 1); }
    const o = refPoint(b, refi), refl = A.scale(ry ? -1 : 1, rx ? -1 : 1);
    const m = A.mul(A.translate(kmh, kmv), A.about(o, A.mul(A.rotate(-krot * Math.PI / 180), A.mul(refl, A.scale(ksh / 100, ksv / 100)))));
    if (!xform(L, s, A.toLayer(L, m), sc)) return {ok:false, error:'cannot transform object ' + s.id};
  }
  return done(L, {ids:tg.map(s => s.id)});
});
regEdit('ai.object.resetBoundingBox', {params:'{} 照 object.resetBoundingBox（重置定界框）：转过的物件外框回正（几何不动）；有改才进一步历史（没转过的不占历史）→ {ok, changed}'}, (p, touch) => {
  const t = targets(p, 'ai.object.resetBoundingBox'); if (t.err) return t.err;
  const turned = t.R.filter(s => +s.bboxAngle);
  if (turned.length){ touch(); turned.forEach(s => { delete s.bboxAngle; }); Layer.invalidate(t.L); }
  return {ok:true, changed:turned.length};
});

/* ── 排列（object.rs:318-374）── */
function arrange(how){
  return p => {
    const t = targets(p, 'ai.object.arrange'); if (t.err) return t.err;
    const S = t.L.data.shapes, ids = t.R.slice();
    if (how === 'front' || how === 'forward') ids.reverse();
    ids.forEach((s, k) => {
      const idx = S.indexOf(s), last = S.length - 1;
      const to = how === 'front' ? Math.max(0, last - k) : how === 'back' ? Math.min(k, last)
               : how === 'forward' ? Math.max(Math.min(idx + 1, Math.max(0, last - k)), idx)
               : Math.max(Math.max(0, idx - 1), Math.min(k, idx));
      if (to !== idx){ S.splice(idx, 1); S.splice(Math.min(to, S.length), 0, s); }
    });
    return done(t.L);
  };
}
reg('ai.object.arrange.bringToFront', {undoable:true, params:'{} 照 object.arrange.bringToFront：选中的物件移到本层最上面（保持彼此顺序）'}, arrange('front'));
reg('ai.object.arrange.bringForward', {undoable:true, params:'{} 照 object.arrange.bringForward：选中的物件往上移一个'}, arrange('forward'));
reg('ai.object.arrange.sendBackward', {undoable:true, params:'{} 照 object.arrange.sendBackward：选中的物件往下移一个'}, arrange('backward'));
reg('ai.object.arrange.sendToBack', {undoable:true, params:'{} 照 object.arrange.sendToBack：选中的物件移到本层最下面'}, arrange('back'));
reg('ai.object.arrange.sendToCurrentLayer', {undoable:true,
  params:'{layerId?（目标层，缺省＝当前图层）} 照 object.arrange.sendToCurrentLayer：选中的物件搬到当前图层的最上面（位置不变；选取跟过去）→ {ok, layerId}'}, p => {
  const src = VecSel.layer(); if (!src || src.kind !== 'vector') return {ok:false, error:'nothing selected'};
  const R = roots(src, null); if (!R.length) return {ok:false, error:'nothing selected'};
  const dst = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!dst || dst.kind !== 'vector') return {ok:false, error:'no current layer'};
  src.data.shapes = src.data.shapes.filter(s => !R.includes(s));
  R.forEach(s => { shiftShape(s, src.x - dst.x, src.y - dst.y); dst.data.shapes.push(s); });
  Layer.invalidate(src); Layer.invalidate(dst);
  selectIds(dst, R.map(s => s.id));
  return {ok:true, layerId:dst.id};
});

/* ── 对齐（object.rs:735-804）── */
reg('ai.object.align', {undoable:true,
  params:'{horizontal?:"left"|"center"|"right", vertical?:"top"|"center"|"bottom", to?:"selection"(缺省)|"artboard"（＝画布）, bounds?:"geometric"(缺省)|"preview"（含描边）} 照 object.align：选中的物件对齐（对齐选取时以全部选取的外框为准）'}, p => {
  const preview = p.bounds === 'preview' ? true : p.bounds === undefined || p.bounds === 'geometric' ? false : null;
  if (preview === null) return {ok:false, error:'bounds must be "preview" or "geometric"'};
  if (p.to === 'key') return {ok:false, error:'no key object'};
  const t = targets(p, 'ai.object.align'); if (t.err) return t.err;
  const r = p.to === 'artboard' ? {x0:0, y0:0, x1:Doc.width, y1:Doc.height} : boundsOf(t.L, t.R, preview);
  if (!r) return {ok:false, error:'nothing to align'};
  needRot();
  for (const s of t.R){
    const b = shapeBounds(s, docF(t.L), preview); if (!b) continue;
    const dx = p.horizontal === 'left' ? r.x0 - b.x0 : p.horizontal === 'center' ? center(r)[0] - center(b)[0] : p.horizontal === 'right' ? r.x1 - b.x1 : 0;
    const dy = p.vertical === 'top' ? r.y0 - b.y0 : p.vertical === 'center' ? center(r)[1] - center(b)[1] : p.vertical === 'bottom' ? r.y1 - b.y1 : 0;
    if (dx || dy) xform(t.L, s, A.translate(dx, dy), {strokes:false, corners:false});
  }
  return done(t.L);
});

/* ── 编组（object.rs:376-425）── */
/* 把 list 换成 node（放在 list 里最上面那个的位置） */
function replaceWith(L, list, node){
  const S = L.data.shapes, top = list[list.length - 1], out = [];
  for (const s of S){ if (s === top) out.push(node); else if (!list.includes(s)) out.push(s); }
  L.data.shapes = out;
}
reg('ai.object.group', {undoable:true, params:'{} 照 object.group（编组 Ctrl+G）：选中的物件（照绘制顺序）收进一个编组，编组放在最上面那个的位置并被选中 → {ok, id}'}, p => {
  const t = targets(p, 'ai.object.group'); if (t.err) return t.err;
  const g = {id:newId(), type:'group', children:t.R.slice()};
  replaceWith(t.L, t.R, g);
  selectIds(t.L, [g.id]);
  return done(t.L, {id:g.id});
});
reg('ai.object.ungroup', {undoable:true, params:'{} 照 object.ungroup（取消编组 Ctrl+Shift+G）：编组拆开、成员放回原位置；剪切组的剪切路径变回普通路径（不上色）；选取＝拆出来的成员与其余选中物件'}, p => {
  const t = targets(p, 'ai.object.ungroup'); if (t.err) return t.err;
  const S = t.L.data.shapes, sel = [];
  for (const s of t.R){
    if (s.type !== 'group'){ sel.push(s.id); continue; }
    const i = S.indexOf(s), kids = s.children.slice();
    if (s.clip && kids[0] && kids[0].clipping) delete kids[0].clipping;
    S.splice(i, 1, ...kids); kids.forEach(k => sel.push(k.id));
  }
  selectIds(t.L, sel);
  return done(t.L);
});

/* ── 锁定／隐藏（object.rs:427-491、menucmds.rs:201-257）── */
reg('ai.object.lock', {undoable:true, params:'{} 照 object.lock（锁定所选对象 Ctrl+2）：选中的物件锁住（s.locked）、选取清掉'}, p => {
  const t = targets(p, 'ai.object.lock'); if (t.err) return t.err;
  t.R.forEach(s => { s.locked = true; }); VecSel.clear(); return done(t.L);
});
reg('ai.object.hide', {undoable:true, params:'{} 照 object.hide（隐藏所选对象 Ctrl+3）：选中的物件藏起来（s.visible=false）、选取清掉'}, p => {
  const t = targets(p, 'ai.object.hide'); if (t.err) return t.err;
  t.R.forEach(s => { s.visible = false; }); VecSel.clear(); return done(t.L);
});
/* collect_flag：所有矢量层里（含编组里面）带这个旗的物件；清旗、能选的（顶层、同一层）选起来 */
function clearFlag(test, set){
  let n = 0, selL = null; const sel = [];
  for (const L of vectorLayers()){
    walk(L.data.shapes, (s, arr, i, depth) => { if (!test(s)) return; set(s); n++; if (!depth && (!selL || selL === L)){ selL = L; sel.push(s.id); } });
    Layer.invalidate(L);
  }
  if (selL) selectIds(selL, sel); else VecSel.clear();
  return {ok:true, count:n};
}
reg('ai.object.unlockAll', {undoable:true, params:'{} 照 object.unlockAll（全部解锁 Ctrl+Alt+2）：所有锁住的物件解锁并选起来 → {ok, count}'},
  () => clearFlag(s => !!s.locked, s => { delete s.locked; }));
reg('ai.object.showAll', {undoable:true, params:'{} 照 object.showAll（显示全部 Ctrl+Alt+3）：所有藏起来的物件显示并选起来 → {ok, count}'},
  () => clearFlag(s => s.visible === false, s => { delete s.visible; }));
/* menucmds.rs:201 above：同一层里在上面、外框重叠（或盖住中心）的物件 */
function above(lock){
  return p => {
    const t = targets(p, lock ? 'ai.object.lock.above' : 'ai.object.hide.above'); if (t.err) return t.err;
    const S = t.L.data.shapes, hits = [];
    for (const r of t.R){
      const b = shapeBounds(r, docF(t.L), true); if (!b) continue;
      const c = center(b);
      for (const n of S.slice(S.indexOf(r) + 1)){
        if (t.R.includes(n) || hits.includes(n)) continue;
        const nb = shapeBounds(n, docF(t.L), true); if (!nb) continue;
        const ix = Math.min(nb.x1, b.x1) - Math.max(nb.x0, b.x0), iy = Math.min(nb.y1, b.y1) - Math.max(nb.y0, b.y0);
        if ((ix > 0 && iy > 0) || (c[0] >= nb.x0 && c[0] <= nb.x1 && c[1] >= nb.y0 && c[1] <= nb.y1)) hits.push(n);
      }
    }
    hits.forEach(n => { if (lock) n.locked = true; else n.visible = false; });
    return done(t.L, {count:hits.length});
  };
}
reg('ai.object.lock.above', {undoable:true, params:'{} 照 object.lock.above（上方所有图稿）：同一层里在选取上面、跟它重叠的物件锁住 → {ok, count}'}, above(true));
reg('ai.object.hide.above', {undoable:true, params:'{} 照 object.hide.above（上方所有图稿）：同一层里在选取上面、跟它重叠的物件藏起来 → {ok, count}'}, above(false));
reg('ai.object.lock.otherLayers', {undoable:true, params:'{} 照 object.lock.otherLayers（其它图层）：没有选中物件的图层全部锁住（图层的 L.locks.all，跟 PS 图层菜单的锁定同一个栏位）→ {ok, count}'}, () => {
  const L = VecSel.layer(); if (!L || VecSel.isEmpty()) return {ok:false, error:'nothing selected'};
  const others = Doc.layers.filter(x => x !== L);
  others.forEach(x => { x.locks = Object.assign({transparency:false, pixels:false, position:false, artboard:false, all:false}, x.locks || {}, {all:true}); });
  return {ok:true, count:others.length};
});
reg('ai.object.hide.otherLayers', {undoable:true, params:'{} 照 object.hide.otherLayers（其它图层）：没有选中物件的图层全部隐藏 → {ok, count}'}, () => {
  const L = VecSel.layer(); if (!L || VecSel.isEmpty()) return {ok:false, error:'nothing selected'};
  const others = Doc.layers.filter(x => x !== L);
  others.forEach(x => { x.visible = false; });
  return {ok:true, count:others.length};
});

/* ── 复合路径（object.rs:493-557）── */
reg('ai.object.compoundPath.make', {undoable:true,
  params:'{} 照 object.compoundPath.make（建立复合路径 Ctrl+8）：选中的路径（编组里的路径、已有复合路径的成员也收）合成一个复合路径，外观取最上面那个、成员外观清掉、活形状转路径；非零绕数 → {ok, id}'}, p => {
  const t = targets(p, 'ai.object.compoundPath.make'); if (t.err) return t.err;
  const top = t.R[t.R.length - 1], paths = [];
  for (const s of t.R){
    if (isLeaf(s)) paths.push(s);
    else if (s.type === 'compound') paths.push(...s.children);
    else if (s.type === 'group') walk(s.children, c => { if (isLeaf(c)) paths.push(c); });
    else return {ok:false, error:'compound paths can only contain paths'};
  }
  const kids = paths.map(s => { const c = clone(s); delete c.clipping; delete c.locked; delete c.visible; if (c.type !== 'bezier') VecSel.ensureBezier(null, c); return Object.assign(c, NO_PAINT); });
  const cp = Object.assign({id:newId(), type:'compound', rule:'nonzero'}, top.type === 'group' ? NO_PAINT : styleOf(top), {children:kids});
  replaceWith(t.L, t.R, cp);
  selectIds(t.L, [cp.id]);
  return done(t.L, {id:cp.id});
});
reg('ai.object.compoundPath.release', {undoable:true, params:'{} 照 object.compoundPath.release（释放复合路径）：复合路径拆回各条路径，每条带复合路径的外观；选取＝拆出来的'}, p => {
  const t = targets(p, 'ai.object.compoundPath.release'); if (t.err) return t.err;
  const S = t.L.data.shapes, out = [];
  for (const s of t.R){
    if (s.type !== 'compound') continue;
    const kids = s.children.map(c => Object.assign(clone(c), styleOf(s)));
    S.splice(S.indexOf(s), 1, ...kids); kids.forEach(k => out.push(k.id));
  }
  selectIds(t.L, out);
  return done(t.L);
});

/* ── 剪切蒙版（object.rs:559-622）── */
reg('ai.object.clippingMask.make', {undoable:true,
  params:'{} 照 object.clippingMask.make（建立剪切蒙版 Ctrl+7）：选中的最上面那个（路径或复合路径，外观清掉）剪住其余的；做成剪切组并选中 → {ok, id}'}, p => {
  const t = targets(p, 'ai.object.clippingMask.make'); if (t.err) return t.err;
  if (t.R.length < 2) return {ok:false, error:'select two or more objects'};
  const top = t.R[t.R.length - 1];
  if (!(isLeaf(top) || top.type === 'compound')) return {ok:false, error:'the top object must be a path or compound path to use as a clipping mask'};
  Object.assign(top, NO_PAINT); if (isLeaf(top)) top.clipping = true;            // as_clipping_path
  const g = {id:newId(), type:'group', clip:true, children:[top].concat(t.R.slice(0, -1))};
  replaceWith(t.L, t.R, g);
  selectIds(t.L, [g.id]);
  return done(t.L, {id:g.id});
});
reg('ai.object.clippingMask.release', {undoable:true, params:'{} 照 object.clippingMask.release（释放剪切蒙版）：选中的剪切组变成普通编组；剪切路径留着（没上色）'}, p => {
  const t = targets(p, 'ai.object.clippingMask.release'); if (t.err) return t.err;
  for (const s of t.R){ if (s.type !== 'group' || !s.clip) continue; delete s.clip; if (s.children[0]) delete s.children[0].clipping; }
  return done(t.L);
});

/* ── 路径（path.rs）── */
const pathOf = (L, s) => (s.type === 'bezier' ? s : VecSel.ensureBezier(L, s));     // path_mut：活形状转路径
const revAnchors = An => An.slice().reverse().map(a => Object.assign({}, a, {in:a.out || null, out:a.in || null}));   // SubPath::reverse
reg('ai.path.join', {undoable:true, params:'{} 照 path.join（连接 Ctrl+J）：选一条开放路径＝把它闭合（首尾重合就并成一点）；选两条＝在最近的两端接成一条（端点重合就并成一点）'}, p => {
  const L = vLayer(p); if (!L) return {ok:false, error:'not a vector layer'};
  const ids = VecSel.layerId === L.id ? VecSel.shapes : [];
  const P = ids.map(id => L.data.shapes.find(s => s.id === id)).filter(s => isLeaf(s) && !s.locked && s.visible !== false);
  if (!P.length) return {ok:false, error:'select paths to join'};
  if (P.length === 1){
    const v = view(P[0]); if (!v || v.closed) return {ok:false, error:'path is already closed'};
    const s = pathOf(L, P[0]), An = s.anchors;
    if (An.length > 2 && dist([An[0].x, An[0].y], [An[An.length-1].x, An[An.length-1].y]) < 1e-6){ const last = An.pop(); An[0].in = last.in || null; }
    s.closed = true;
    return done(L);
  }
  const [a, b] = P, va = view(a), vb = view(b);
  if (!va || !vb || va.closed || vb.closed) return {ok:false, error:'join needs open paths'};
  let x = clone(va.anchors), y = clone(vb.anchors);
  const e = (An, last) => { const q = An[last ? An.length - 1 : 0]; return [q.x, q.y]; };
  const cands = [[dist(e(x,1), e(y,0)), false, false], [dist(e(x,1), e(y,1)), false, true], [dist(e(x,0), e(y,0)), true, false], [dist(e(x,0), e(y,1)), true, true]];
  const [, rx, ry] = cands.reduce((m, c) => c[0] < m[0] ? c : m);
  if (rx) x = revAnchors(x);
  if (ry) y = revAnchors(y);
  if (dist(e(x,1), e(y,0)) < 1e-6){ const f = y.shift(); x[x.length - 1].out = f.out || null; }
  const s = pathOf(L, a); s.anchors = x.concat(y); s.closed = false;
  L.data.shapes = L.data.shapes.filter(q => q !== b);
  selectIds(L, [a.id]);
  return done(L);
});
regEdit('ai.path.average', {params:'{axis?:"horizontal"(同一 y)|"vertical"(同一 x)|"both"(缺省，并到中心)} 照 path.average（平均…）：选中的锚点（整条选中＝全部锚点）移到它们的平均位置（把手跟着）'}, (p, touch) => {
  const sel = VecSel.selectedAnchors().filter(({s}) => isLeaf(s) && !s.locked);
  if (!sel.length) return {ok:true};
  const c = [0, 1].map(k => sel.reduce((acc, {s, idx}) => { const a = view(s).anchors[idx]; return acc + (k ? a.y : a.x); }, 0) / sel.length);
  const axis = p.axis || 'both';
  touch();
  const L = VecSel.layer();
  sel.forEach(({s}) => pathOf(L, s));
  for (const {s, idx} of sel){
    const a = s.anchors[idx]; if (!a) continue;
    const tx = axis === 'horizontal' ? a.x : c[0], ty = axis === 'vertical' ? a.y : c[1], dx = tx - a.x, dy = ty - a.y;
    a.x += dx; a.y += dy; if (a.in) a.in = [a.in[0] + dx, a.in[1] + dy]; if (a.out) a.out = [a.out[0] + dx, a.out[1] + dy];
  }
  Layer.invalidate(L); return {ok:true};
});
/* path.rs:232 paths_in：选中物件子树里的每条路径 */
const pathsIn = list => { const out = []; list.forEach(s => walk([s], c => { if (isLeaf(c)) out.push(c); })); return out; };
reg('ai.path.reverse', {undoable:true,
  params:'{ids?, reversed?:bool（true＝每条子路径改成画面逆时针、false＝顺时针；不给＝每条翻过来）} 照 path.reverse（反转路径方向）：选中的路径（编组、复合路径里的也算）→ {ok, changed}'}, p => {
  const t = targets(p, 'ai.path.reverse'); if (t.err) return t.err;
  const ids = pathsIn(t.R); if (!ids.length) return {ok:false, error:'ai.path.reverse: select paths'};
  let changed = 0;
  for (const s of ids){
    const v = view(s); if (!v) continue;
    const ccw = polyArea(flatten(v)) < 0;                      // signed_area < 0 ＝ 画面逆时针
    if (p.reversed !== undefined && ccw === !!p.reversed) continue;
    const b = pathOf(t.L, s); b.anchors = revAnchors(b.anchors); changed++;
  }
  return done(t.L, {changed});
});

/* ── Object → Path（pathops.rs）── */
function editPaths(p, C, f){
  const t = targets(p, C); if (t.err) return t.err;
  const ids = pathsIn(t.R); if (!ids.length) return {ok:false, error:C + ': select paths'};
  let before = 0, after = 0;
  for (const s of ids){
    const v = view(s); if (!v) continue;
    before += v.anchors.length;
    const nv = f(v);
    if (!nv || (!nv.anchors.length && v.anchors.length)){ after += v.anchors.length; continue; }
    after += nv.anchors.length;
    const b = pathOf(t.L, s); b.anchors = nv.anchors; b.closed = nv.closed;
  }
  return done(t.L, {ids:ids.map(s => s.id), before, after});
}
reg('ai.object.path.simplify', {undoable:true,
  params:'{tolerance?:=1（容差，文件单位）, cornerAngle?:度=30（转超过这角度的锚点留成角点）, straightLines?:bool} 照 object.path.simplify（简化…）：最小二乘重新拟合，锚点只会变少 → {ok, ids, before, after}'}, p =>
  editPaths(p, 'ai.object.path.simplify', v => simplifyView(v, {tolerance:clamp(num(p.tolerance, 1), 1e-4, 1e4), cornerAngle:clamp(num(p.cornerAngle, 30), 0, 180), straightLines:!!p.straightLines})));
reg('ai.object.path.addAnchorPoints', {undoable:true, params:'{} 照 object.path.addAnchorPoints（添加锚点）：每一段中点（t=0.5）加一个锚点（曲线段的是平滑点）→ {ok, ids, before, after}'}, p =>
  editPaths(p, 'ai.object.path.addAnchorPoints', v => {
    const An = clone(v.anchors), n0 = An.length, segN = VecSel.segCount(v);
    for (let seg = segN - 1; seg >= 0; seg--){                      // SubPath::insert_anchor（path.rs:254），由后往前
      const n = An.length, i0 = seg % n, i1 = (seg + 1) % n, a = An[i0], b = An[i1];
      const c = {p0:[a.x, a.y], c1:a.out || [a.x, a.y], c2:b.in || [b.x, b.y], p3:[b.x, b.y]};
      const [l, r] = VecSel.splitCubic(c, 0.5);
      let mid;
      if (!a.out && !b.in) mid = {x:l.p3[0], y:l.p3[1], in:null, out:null, kind:'corner'};
      else { a.out = hnd(c.p0, l.c1); b.in = hnd(c.p3, r.c2); mid = {x:l.p3[0], y:l.p3[1], in:hnd(l.p3, l.c2), out:hnd(l.p3, r.c1), kind:'smooth'}; }
      An.splice(seg + 1, 0, mid);
    }
    return n0 ? {anchors:An, closed:!!v.closed} : null;
  }));
reg('ai.object.path.outlineStroke', {undoable:true,
  params:'{} 照 object.path.outlineStroke（轮廓化描边）：有描边的路径／复合路径（编组里的也算）把描边换成填色的轮廓（圆角接合、圆头，跟画布上画的一样）；原本有填色的留一份填色副本在下面、两者编组 → {ok, ids}'}, p => {
  const t = targets(p, 'ai.object.path.outlineStroke'); if (t.err) return t.err;
  const sel = []; let changed = 0;
  for (const r of t.R){ const x = replaceLeaves(t.L, r, outlineLeaf); sel.push(x.id); changed += x.changed; }
  if (!changed) return {ok:false, error:'Outline Stroke: no stroked paths selected'};
  selectIds(t.L, sel);
  return done(t.L, {ids:sel});
});
reg('ai.object.path.offsetPath', {undoable:true,
  params:'{offset?:=10（负＝往内缩）, joins?:"miter"(缺省)|"round"|"bevel", miterLimit?:=4} 照 object.path.offsetPath（偏移路径…）：在每个物件正上方新建偏移后的路径（外观照原物件；闭合的当填色区域、开放的当宽 2|offset| 的平头描边），选取换成新的 → {ok, ids}'}, p => {
  const delta = num(p.offset, 10);
  if (Math.abs(delta) > 1e5) return {ok:false, error:'ai.object.path.offsetPath: offset out of range'};
  const join = ({round:'round', bevel:'bevel'})[String(p.joins || '').toLowerCase()] || 'miter', miter = clamp(num(p.miterLimit, 4), 1, 500), d = Math.abs(delta);
  const t = targets(p, 'ai.object.path.offsetPath'); if (t.err) return t.err;
  const S = t.L.data.shapes, out = [];
  for (const r of t.R){
    const made = [];
    for (const l of leavesOf(r, [])){
      const vs = subviews(l), closed = vs.filter(v => v.closed && v.anchors.length > 1), open = vs.filter(v => !v.closed && v.anchors.length > 1);
      const fill = closed.map(v => flatten(v)), ring = [], ob = [];
      if (d > 0){ closed.forEach(v => ring.push(...strokePieces(flatten(v), true, 2*d, join, 'butt', miter))); open.forEach(v => ob.push(...strokePieces(flatten(v), false, 2*d, join, 'butt', miter))); }
      const sets = [{polys:fill, rule:l.type === 'compound' && l.rule === 'evenodd' ? 'evenodd' : 'nonzero'}, {polys:ring, rule:'nonzero'}, {polys:ob, rule:'nonzero'}];
      const loops = arrangement(sets, delta >= 0 ? (m => m[0] || m[1] || m[2]) : (m => m[0] && !m[1]));
      const n = shapeNode(loops, l); if (n) made.push(n);
    }
    if (!made.length) continue;
    const nw = (made.length === 1 && r.type !== 'group') ? made[0] : {id:newId(), type:'group', children:made};
    S.splice(S.indexOf(r) + 1, 0, nw); out.push(nw.id);
  }
  if (!out.length) return {ok:false, error:'Offset Path: select paths'};
  selectIds(t.L, out);
  return done(t.L, {ids:out});
});
reg('ai.object.path.divideObjectsBelow', {undoable:true,
  params:'{} 照 object.path.divideObjectsBelow（分割下方对象）：只能选一条路径当刀；它下面（本层下面的物件、下面各矢量层）外框跟它重叠、没锁没藏的闭合路径／复合路径，各切成「刀外」「刀内」两块（外观照原物件）；刀删掉 → {ok, ids}'}, p => {
  const t = targets(p, 'ai.object.path.divideObjectsBelow'); if (t.err) return t.err;
  if (t.R.length !== 1) return {ok:false, error:'Divide Objects Below: select exactly one path'};
  const cutter = t.R[0], CL = t.L;
  if (!(isLeaf(cutter) || cutter.type === 'compound')) return {ok:false, error:'Divide Objects Below: select a path'};
  const cdoc = fillPolys(cutter, q => [q[0] + CL.x, q[1] + CL.y]);
  const cb = shapeBounds(cutter, docF(CL), false); if (!cb || !cdoc.polys.length) return {ok:false, error:'empty cutter'};
  const out = [], li = Doc.layers.indexOf(CL);
  Doc.layers.forEach((L, k) => {
    if (L.kind !== 'vector' || !L.visible || k > li) return;
    const ci = k === li ? L.data.shapes.indexOf(cutter) : Infinity;
    const tg = [];
    // 本层只看刀下面的（绘制顺序在前的）顶层物件与它们的子树；下面各层全部
    const below = L.data.shapes.filter((s, i) => i < ci);
    walk(below, (s, arr0) => {
      const arr = arr0 === below ? L.data.shapes : arr0;
      if (s === cutter || s.locked || s.visible === false || s.clipping) return;
      if (!((isLeaf(s) && view(s) && view(s).closed) || s.type === 'compound')) return;
      const b = shapeBounds(s, docF(L), false); if (!b) return;
      if (Math.min(b.x1, cb.x1) - Math.max(b.x0, cb.x0) > 0 && Math.min(b.y1, cb.y1) - Math.max(b.y0, cb.y0) > 0) tg.push([s, arr]);
    });
    // 是否在隐藏／锁住的编组里：往上看祖先（is_editable／is_visible）
    const blocked = new Set(); walk(L.data.shapes, s => { if (isCont(s) && (s.locked || s.visible === false)) walk(s.children, c => blocked.add(c)); });
    const cut = {polys:cdoc.polys.map(P => P.map(q => [q[0] - L.x, q[1] - L.y])), rule:cdoc.rule};
    for (const [s, arr] of tg){
      if (blocked.has(s)) continue;
      const A0 = fillPolys(s);
      const inside = arrangement([A0, cut], m => m[0] && m[1]), outside = arrangement([A0, cut], m => m[0] && !m[1]);
      if (!inside.length || !outside.length) continue;
      const pieces = [shapeNode(outside, s), shapeNode(inside, s)].filter(Boolean);
      arr.splice(arr.indexOf(s), 1, ...pieces);
      pieces.forEach(x => out.push({L, id:x.id, top:arr === L.data.shapes}));
      Layer.invalidate(L);
    }
  });
  CL.data.shapes = CL.data.shapes.filter(s => s !== cutter);
  const sel = out.filter(o => o.L === CL && o.top).map(o => o.id);
  if (sel.length) selectIds(CL, sel); else VecSel.clear();
  return done(CL, {ids:out.map(o => o.id)});
});
reg('ai.object.path.splitIntoGrid', {undoable:true,
  params:'{rows?:1..500=2, columns?:1..500=2, gutter?:=12} 照 object.path.splitIntoGrid（分割为网格…）：每条选中的路径按它的外框切成 行×列 个矩形（间距 gutter，外观照原物件），原物件删掉 → {ok, ids}'}, p => {
  const rows = Math.round(num(p.rows, 2)), cols = Math.round(num(p.columns, 2)), gutter = Math.max(0, num(p.gutter, 12));
  if (!(rows >= 1 && rows <= 500 && cols >= 1 && cols <= 500)) return {ok:false, error:'ai.object.path.splitIntoGrid: rows and columns must be 1..500'};
  const t = targets(p, 'ai.object.path.splitIntoGrid'); if (t.err) return t.err;
  const S = t.L.data.shapes, out = [];
  for (const s of t.R){
    if (!(isLeaf(s) || s.type === 'compound')) continue;
    const b = shapeBounds(s, q => q, false); if (!b) continue;
    const w = (b.x1 - b.x0 - gutter * (cols - 1)) / cols, h = (b.y1 - b.y0 - gutter * (rows - 1)) / rows;   // edit.rs:358 split_into_grid
    if (!(w > 0 && h > 0)) continue;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){
      const x = b.x0 + c * (w + gutter), y = b.y0 + r * (h + gutter);
      cells.push(Object.assign({id:newId(), type:'bezier', closed:true, anchors:[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(q => ({x:q[0], y:q[1], in:null, out:null, kind:'corner'}))}, styleOf(s)));
    }
    S.splice(S.indexOf(s), 1, ...cells); cells.forEach(c => out.push(c.id));
  }
  if (!out.length) return {ok:false, error:'Split Into Grid: select paths large enough for the grid'};
  selectIds(t.L, out);
  return done(t.L, {ids:out});
});
regEdit('ai.object.path.cleanUp', {params:'{strayPoints?:bool=true（游离点：只有一个锚点的路径）, unpaintedObjects?:bool=true（没填色也没描边的路径）, emptyTextPaths?:bool=true} 照 object.path.cleanUp（清理…）：全文件找出来删掉（锁住、藏起来的不动；剪切路径不动）；没东西可删不占历史 → {ok, removed}'}, (p, touch) => {
  const stray = bool(p.strayPoints, true), unp = bool(p.unpaintedObjects, true);
  const found = [];
  const ok = s => !s.locked && s.visible !== false;
  const visit = (s, arr, inCompound, firstOfClip) => {
    if (!ok(s)) return;
    if (isLeaf(s)){
      if (s.clipping || firstOfClip) return;
      const v = view(s), n = v ? v.anchors.length : (s.points || []).length;
      if ((stray && n <= 1) || (unp && !inCompound && !painted(s.fill) && !hasStroke(s))) found.push([s, arr]);
    } else if (s.type === 'compound'){
      if (unp && !firstOfClip && !painted(s.fill) && !hasStroke(s)){ found.push([s, arr]); return; }
      s.children.forEach(c => visit(c, s.children, true, false));
    } else if (s.type === 'group') s.children.forEach((c, i) => visit(c, s.children, false, !!s.clip && i === 0));
  };
  const Ls = vectorLayers().filter(L => L.visible);
  Ls.forEach(L => L.data.shapes.forEach(s => visit(s, L.data.shapes, false, false)));
  if (!found.length) return {ok:true, removed:0};
  touch();
  for (const [s, arr] of found){ const i = arr.indexOf(s); if (i >= 0) arr.splice(i, 1); }
  Ls.forEach(L => Layer.invalidate(L)); VecSel.prune();
  return {ok:true, removed:found.length};
});

/* ── 形状（object.rs:932、menucmds.rs:637-708）── */
reg('ai.object.expandShape', {undoable:true, params:'{} 照 object.expandShape（扩展形状）：选中的活形状（矩形／椭圆／星形／多边形／折线）就地转成一般路径，外观不变'}, p => {
  const t = targets(p, 'ai.object.expandShape'); if (t.err) return t.err;
  t.R.forEach(s => { if (LIVE.includes(s.type)) VecSel.ensureBezier(t.L, s); });
  return done(t.L);
});
/* detect_shape：认出矩形（4 个直角点、无把手）或椭圆（4 点在外框四边中点、把手切线长约 κ·半径）。我们的活矩形不能转角度 ⇒ 只收轴向的 */
function detectShape(s){
  if (s.type !== 'bezier' || !s.closed || s.anchors.length !== 4) return null;
  const a = s.anchors, P = a.map(q => [q.x, q.y]);
  const b = viewBounds(s, q => q); if (!b) return null;
  const W = b.x1 - b.x0, H = b.y1 - b.y0, tol = 1e-3 * Math.max(W, H, 1);
  if (a.every(q => !q.in && !q.out)){
    const e0 = sub(P[1], P[0]), e1 = sub(P[2], P[1]), e2 = sub(P[3], P[2]);
    const w = Math.hypot(e0[0], e0[1]), h = Math.hypot(e1[0], e1[1]);
    if (w < 1e-9 || h < 1e-9) return null;
    if (Math.abs(dot(e0, e1)) > tol * (w + h) || Math.hypot(e2[0] + e0[0], e2[1] + e0[1]) > tol) return null;
    if (!(Math.abs(e0[1]) <= tol || Math.abs(e0[0]) <= tol)) return null;   // 转过角度的矩形：我们的 rect 没有 xf，不转
    return {type:'rect', x:b.x0, y:b.y0, w:W, h:H};
  }
  const c = center(b), mids = [[c[0], b.y0], [b.x1, c[1]], [c[0], b.y1], [b.x0, c[1]]], k = 0.5523;
  for (const q of a){
    const p0 = [q.x, q.y];
    if (!mids.some(m => dist(p0, m) < tol)) return null;
    const horiz = Math.abs(q.y - b.y0) < tol || Math.abs(q.y - b.y1) < tol, want = horiz ? k * W / 2 : k * H / 2;
    for (const hd of [q.in || p0, q.out || p0]){
      const v = sub(hd, p0), along = Math.abs(horiz ? v[0] : v[1]), across = Math.abs(horiz ? v[1] : v[0]);
      if (across > tol * 10 || Math.abs(along - want) > want * 0.05 + tol) return null;
    }
  }
  return {type:'ellipse', x:b.x0, y:b.y0, w:W, h:H};
}
reg('ai.object.shape.convertToShape', {undoable:true, params:'{} 照 object.shape.convertToShape（转换为形状）：是矩形（轴向）或轴向椭圆的一般路径转回活形状 → {ok, converted}'}, p => {
  const t = targets(p, 'ai.object.shape.convertToShape'); if (t.err) return t.err;
  let n = 0;
  for (const s of t.R){
    const l = detectShape(s); if (!l) continue;
    delete s.anchors; delete s.closed; Object.assign(s, l); n++;
  }
  if (!n) return {ok:false, error:'Convert to Shape: no rectangles or ellipses selected'};
  return done(t.L, {converted:n});
});

/* ── 扩展（expand.rs）── */
function expandable(R){
  const e = {live:false, fill:false, stroke:false};
  R.forEach(r => walk([r], c => {
    if (LIVE.includes(c.type)) e.live = true;
    const shape = isLeaf(c) || c.type === 'compound';
    if (shape && hasStroke(c)) e.stroke = true;
    if (shape && c.fill && typeof c.fill === 'object' && window.GradientFill && GradientFill.isGrad(c.fill)) e.fill = true;
  }));
  return {object:e.live, fill:e.fill, stroke:e.stroke};
}
/* expand.rs:338 Frame（线性／径向渐变铺满物件外框）＋ pieces（指定数目的实色条／同心椭圆） */
function gradientPieces(g, b, n){
  const GF = window.GradientFill, st = GF.stops(g), geo = GF.geom(g), radial = g.type === 'radial';
  const along = dist(geo.start, geo.end) < 1e-9 ? [1, 0] : sub(geo.end, geo.start), al = Math.hypot(along[0], along[1]);
  const normal = [-along[1] / al, along[0] / al], across = radial ? mul(normal, al * geo.aspect) : normal;
  const C = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  const range = f => C.reduce((r, c) => [Math.min(r[0], f(c)), Math.max(r[1], f(c))], [Infinity, -Infinity]);
  let [t0, t1] = range(c => dot(sub(c, geo.start), along) / (al * al));
  const [s0, s1] = range(c => dot(sub(c, geo.start), normal));
  const focal = geo.focal || geo.start;
  if (radial){
    const Mi = A.inverse([along[0], along[1], across[0], across[1], 0, 0]);
    t0 = 0; t1 = range(c => Math.hypot(...A.apply(Mi, sub(c, geo.start))))[1] * (1 + dist(focal, geo.start) / al);
  }
  t1 = Math.max(t1, t0 + 1e-6);
  const step = (t1 - t0) / n, opaque = st.every(s => s.opacity >= 1);
  const color = k => { const c = GF.sample(st, t0 + (k + 0.5) * step); return GF.rgba(c); };
  const at = (t, s) => add(add(geo.start, mul(along, t)), mul(across, s));
  const out = [];
  if (radial){
    const ell = t => { const c = add(focal, mul(sub(geo.start, focal), t)), m = [along[0]*t, along[1]*t, across[0]*t, across[1]*t, c[0], c[1]];
      const K = VecSel.KAPPA, pts = [[-1, 0, 0, K], [0, -1, -K, 0], [1, 0, 0, -K], [0, 1, K, 0]];
      return pts.map(([x, y, hx, hy]) => { const p = A.apply(m, [x, y]); return {x:p[0], y:p[1], in:A.apply(m, [x + hx, y + hy]), out:A.apply(m, [x - hx, y - hy]), kind:'smooth'}; }); };
    for (let k = n - 1; k >= 0; k--){
      const outer = {id:newId(), type:'bezier', closed:true, anchors:ell((k + 1) * step), fill:color(k), stroke:'none', strokeWidth:0};
      if (!opaque && k > 0) out.push({id:newId(), type:'compound', rule:'nonzero', fill:color(k), stroke:'none', strokeWidth:0,
        children:[Object.assign(outer, NO_PAINT), {id:newId(), type:'bezier', closed:true, anchors:revAnchors(ell(k * step)), fill:'none', stroke:'none', strokeWidth:0}]});
      else out.push(outer);
    }
    return out;
  }
  for (let k = 0; k < n; k++){
    const a = t0 + k * step, bb = opaque ? t1 : a + step;
    out.push({id:newId(), type:'bezier', closed:true, anchors:[at(a, s0), at(bb, s0), at(bb, s1), at(a, s1)].map(q => ({x:q[0], y:q[1], in:null, out:null, kind:'corner'})), fill:color(k), stroke:'none', strokeWidth:0});
  }
  return out;
}
/* expand_fills：渐变填色 ⇒ 剪切组（形状的副本当剪切路径＋实色条），描边留在一份副本上，两者编组 */
function expandFillLeaf(l, steps){
  if (!(l.fill && typeof l.fill === 'object' && window.GradientFill && GradientFill.isGrad(l.fill))) return null;
  const b = shapeBounds(l, q => q, false); if (!b) return null;
  const clip = reid(l); Object.assign(clip, NO_PAINT); delete clip.name; if (LIVE.includes(clip.type)) VecSel.ensureBezier(null, clip); if (isLeaf(clip)) clip.clipping = true;
  const art = {id:newId(), type:'group', clip:true, children:[clip].concat(gradientPieces(l.fill, b, steps))};
  const parts = [art];
  if (hasStroke(l)){ const c = reid(l); c.fill = 'none'; delete c.name; if (LIVE.includes(c.type)) VecSel.ensureBezier(null, c); parts.push(c); }
  const r = parts.length === 1 ? art : {id:newId(), type:'group', children:parts};
  if (l.name) r.name = l.name;
  return r;
}
reg('ai.object.expand.info', {params:'{} 照 object.expand.info：选取里有没有东西可以给「扩展」的各选项 → {object（活形状）, fill（渐变填色）, stroke（描边）}'}, p => {
  const t = targets(p, 'ai.object.expand.info'); if (t.err) return t.err;
  return Object.assign({ok:true}, expandable(t.R));
});
reg('ai.object.expand', {undoable:true,
  params:'{object?:bool=true（活形状 → 路径）, fill?:bool=true（渐变填色 → 剪切组里 steps 条实色条／同心椭圆）, stroke?:bool=true（描边 → 填色轮廓）, gradient?:"objects"(缺省)|"mesh"（我们没做）, steps?:1..1000=255} ' +
         '照 object.expand（扩展…）：一步历史；什么都没得扩展＝失败 → {ok, ids}'}, p => {
  const object = bool(p.object, true), fill = bool(p.fill, true), stroke = bool(p.stroke, true);
  const steps = Math.round(num(p.steps, 255));
  if (!(steps >= 1 && steps <= 1000)) return {ok:false, error:'ai.object.expand: steps must be 1..1000'};
  const gm = p.gradient || 'objects';
  if (gm !== 'objects' && gm !== 'mesh') return {ok:false, error:'gradient must be "objects" or "mesh"'};
  const t = targets(p, 'ai.object.expand'); if (t.err) return t.err;
  const L = t.L, e = expandable(t.R); let changed = 0, cur = t.R.slice();
  if (object && e.object) cur.forEach(r => walk([r], c => { if (LIVE.includes(c.type)){ VecSel.ensureBezier(L, c); changed++; } }));      // drop_live
  if (stroke && e.stroke){ cur = cur.map(r => { const x = replaceLeaves(L, r, outlineLeaf); changed += x.changed; return L.data.shapes.find(s => s.id === x.id) || r; }); }
  if (fill && e.fill){
    if (gm === 'mesh') return {ok:false, error:'ai.object.expand: gradient → mesh is not supported yet'};
    cur = cur.map(r => { const x = replaceLeaves(L, r, l => expandFillLeaf(l, steps)); changed += x.changed; return L.data.shapes.find(s => s.id === x.id) || r; });
  }
  if (!changed) return {ok:false, error:'Expand: nothing to expand'};
  selectIds(L, cur.map(s => s.id));
  return done(L, {ids:cur.map(s => s.id)});
});

/* ── 其余对象菜单项 ── */
reg('ai.object.makePixelPerfect', {undoable:true, params:'{ids?} 照 object.makePixelPerfect（使像素完美）：描边宽四舍五入（至少 1）、物件外框边缘吸到整像素（奇数描边吸到半像素）、宽高取整 → {ok, count}'}, p => {
  needRot();
  const t = targets(p, 'ai.object.makePixelPerfect'); if (t.err) return t.err;
  for (const s of t.R){
    let odd = false;
    if (hasStroke(s)){ s.strokeWidth = Math.max(1, Math.round(s.strokeWidth)); odd = s.strokeWidth % 2 === 1; }
    const b = shapeBounds(s, docF(t.L), false); if (!b) continue;
    const off = odd ? 0.5 : 0, snap = v => Math.round(v - off) + off, W = b.x1 - b.x0, H = b.y1 - b.y0;   // docinfo.rs:328 snap_xf
    const w = W > 0 ? Math.max(1, Math.round(W)) : 0, h = H > 0 ? Math.max(1, Math.round(H)) : 0;
    const m = A.mul(A.translate(snap(b.x0), snap(b.y0)), A.mul(A.scale(W > 1e-9 ? w / W : 1, H > 1e-9 ? h / H : 1), A.translate(-b.x0, -b.y0)));
    if (!xform(t.L, s, A.toLayer(t.L, m), {strokes:false, corners:false})) return {ok:false, error:'cannot transform object ' + s.id};
  }
  return done(t.L, {count:t.R.length});
});
/* marks.rs:74 TrimMarks::lines */
function trimLines(r, o){
  const l = o.length, out = [], corners = [[r.x0, r.y0, -1, -1], [r.x1, r.y0, 1, -1], [r.x1, r.y1, 1, 1], [r.x0, r.y1, -1, 1]];
  if (o.style === 'japanese'){
    const b = o.bleed;
    for (const [x, y, sx, sy] of corners){
      out.push([[x + sx*b, y], [x + sx*(b + l), y]], [[x, y + sy*b], [x, y + sy*(b + l)]], [[x, y + sy*b], [x + sx*(b + l), y + sy*b]], [[x + sx*b, y], [x + sx*b, y + sy*(b + l)]]);
    }
    const c = center(r);
    for (const [q, dx, dy] of [[[c[0], r.y0], 0, -1], [[r.x1, c[1]], 1, 0], [[c[0], r.y1], 0, 1], [[r.x0, c[1]], -1, 0]]){
      const at = d => [q[0] + dx*d, q[1] + dy*d], m = at(b + l/2);
      out.push([at(b), at(b + l)], [[m[0] - dy*l/2, m[1] - dx*l/2], [m[0] + dy*l/2, m[1] + dx*l/2]]);
    }
  } else {
    const o9 = o.offset;
    for (const [x, y, sx, sy] of corners) out.push([[x + sx*o9, y], [x + sx*(o9 + l), y]], [[x, y + sy*o9], [x, y + sy*(o9 + l)]]);
  }
  return out;
}
reg('ai.object.createTrimMarks', {undoable:true,
  params:'{style?:"roman"(缺省)|"japanese", allArtboards?:bool（缺省：没选东西＝对画布）, offset?:=9, length?:=18, bleed?:=8.5, weight?:=0.3} 照 object.createTrimMarks（创建裁切标记）：在选取外框（或画布）四角画裁切线（黑色描边、编组名 Trim Marks），放在当前矢量层最上面并选中 → {ok, id, ids}'}, p => {
  const o = {style:p.style === 'japanese' ? 'japanese' : 'roman', offset:Math.max(0, num(p.offset, 9)), length:Math.max(0.1, num(p.length, 18)), bleed:Math.max(0, num(p.bleed, 3 * 72 / 25.4)), weight:Math.max(0.01, num(p.weight, 0.3))};
  if (p.style && !['roman', 'japanese'].includes(String(p.style).toLowerCase())) return {ok:false, error:'`style` must be roman or japanese'};
  const SL = VecSel.layer(), R = (SL && SL.kind === 'vector') ? roots(SL, null) : [];
  const all = bool(p.allArtboards, !R.length);
  const rect = all ? {x0:0, y0:0, x1:Doc.width, y1:Doc.height} : boundsOf(SL, R, true);
  if (!rect) return {ok:false, error:'nothing to mark'};
  const L = (SL && SL.kind === 'vector') ? SL : activeVector(true);
  const g = {id:newId(), type:'group', name:'Trim Marks', children:trimLines(rect, o).map(([a, b]) => ({id:newId(), type:'line', points:[[a[0] - L.x, a[1] - L.y], [b[0] - L.x, b[1] - L.y]], closed:false, fill:'none', stroke:'#000000', strokeWidth:o.weight}))};
  L.data.shapes.push(g);
  selectIds(L, [g.id]);
  return done(L, {id:g.id, ids:[g.id]});
});

/* ═════════════ 对话框（ui-egui dialogs；栏位与预设照 menus.rs:2216-2231 menu_dialog）═════════════ */
const STYLE = `
#aiObjDialog{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;font:13px sans-serif}
#aiObjDialog .box{background:#2b2f36;color:#e6e8eb;padding:14px 18px;border-radius:6px;min-width:260px;box-shadow:0 8px 30px rgba(0,0,0,.5)}
#aiObjDialog .hd{font-weight:bold;margin-bottom:10px}
#aiObjDialog .sh{color:#8a93a0;font-size:12px;margin:8px 0 4px}
#aiObjDialog .grid{display:grid;grid-template-columns:auto 120px;gap:7px 10px;align-items:center}
#aiObjDialog .grid span{color:#aab0ba}
#aiObjDialog input[type=number],#aiObjDialog select{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px}
#aiObjDialog label.ck{display:flex;gap:6px;align-items:center;margin-top:6px}
#aiObjDialog label.ck.off{opacity:.45}
#aiObjDialog .ref{display:inline-grid;grid-template-columns:repeat(3,16px);gap:2px;vertical-align:middle;margin-right:6px}
#aiObjDialog .ref input{margin:0}
#aiObjDialog .row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
#aiObjDialog .err{color:#ff8a80;font-size:12px;margin-top:6px;min-height:0}`;
function ensureStyle(){ if (!document.getElementById('aiObjStyle')){ const s = document.createElement('style'); s.id = 'aiObjStyle'; s.textContent = STYLE; document.head.appendChild(s); } }
const Dlg = {
  isOpen(){ return !!document.getElementById('aiObjDialog'); },
  close(){ const d = document.getElementById('aiObjDialog'); if (d) d.remove(); },
  /* fields：[{key, label, type:'number'|'check'|'select'|'radio'|'ref'|'head', value, options:[[值, 字串键]], enabled}] */
  open(kind, title, fields, onOk){
    this.close(); ensureStyle();
    const bg = document.createElement('div'); bg.id = 'aiObjDialog'; bg.dataset.kind = kind;
    const box = document.createElement('div'); box.className = 'box'; bg.appendChild(box);
    const hd = document.createElement('div'); hd.className = 'hd'; hd.textContent = T(title); box.appendChild(hd);
    let grid = null;
    const ensureGrid = () => { if (!grid){ grid = document.createElement('div'); grid.className = 'grid'; box.appendChild(grid); } return grid; };
    for (const f of fields){
      if (f.type === 'head'){ grid = null; const h = document.createElement('div'); h.className = 'sh'; h.textContent = T(f.label); box.appendChild(h); continue; }
      if (f.type === 'check'){
        grid = null;
        const l = document.createElement('label'); l.className = 'ck' + (f.enabled === false ? ' off' : '');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = f.key; cb.checked = !!f.value; cb.disabled = f.enabled === false;
        const sp = document.createElement('span'); sp.textContent = T(f.label);
        l.appendChild(cb); l.appendChild(sp); box.appendChild(l); continue;
      }
      if (f.type === 'radio'){
        grid = null;
        for (const [v, lk, en] of f.options){
          const l = document.createElement('label'); l.className = 'ck' + (en === false ? ' off' : '');
          const r = document.createElement('input'); r.type = 'radio'; r.name = f.key; r.value = v; r.checked = v === f.value; r.disabled = en === false;
          const sp = document.createElement('span'); sp.textContent = T(lk);
          l.appendChild(r); l.appendChild(sp); box.appendChild(l);
        }
        continue;
      }
      if (f.type === 'ref'){
        grid = null;
        const l = document.createElement('div'); l.className = 'ck';
        const g = document.createElement('span'); g.className = 'ref';
        for (let i = 0; i < 9; i++){ const r = document.createElement('input'); r.type = 'radio'; r.name = f.key; r.value = String(i); r.checked = i === f.value; g.appendChild(r); }
        const sp = document.createElement('span'); sp.textContent = T(f.label);
        l.appendChild(g); l.appendChild(sp); box.appendChild(l); continue;
      }
      const G = ensureGrid();
      const lab = document.createElement('span'); lab.textContent = T(f.label);
      let inp;
      if (f.type === 'select'){ inp = document.createElement('select'); for (const [v, lk] of f.options){ const o = document.createElement('option'); o.value = v; o.textContent = T(lk); inp.appendChild(o); } inp.value = f.value; }
      else { inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.value = f.value; }
      inp.name = f.key; G.appendChild(lab); G.appendChild(inp);
    }
    const err = document.createElement('div'); err.className = 'err'; box.appendChild(err);
    const row = document.createElement('div'); row.className = 'row';
    const bNo = document.createElement('button'); bNo.textContent = T('aio.cancel'); bNo.dataset.act = 'cancel';
    const bOk = document.createElement('button'); bOk.textContent = T('aio.ok'); bOk.dataset.act = 'ok';
    row.appendChild(bNo); row.appendChild(bOk); box.appendChild(row);
    document.body.appendChild(bg);
    const read = () => {
      const v = {};
      for (const f of fields){
        if (f.type === 'head') continue;
        if (f.type === 'check'){ v[f.key] = !!box.querySelector(`input[name="${f.key}"]`).checked; continue; }
        if (f.type === 'radio' || f.type === 'ref'){ const r = box.querySelector(`input[name="${f.key}"]:checked`); v[f.key] = r ? (f.type === 'ref' ? +r.value : r.value) : f.value; continue; }
        const el = box.querySelector(`[name="${f.key}"]`);
        v[f.key] = f.type === 'select' ? el.value : num(el.value, f.value);
      }
      return v;
    };
    const ok = () => {
      let r; try { r = onOk(read()); } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; }
      if (r && r.ok === false){ err.textContent = r.error || ''; return; }
      this.close(); if (window.UI) UI.draw();
    };
    const no = () => { this.close(); if (window.UI) UI.draw(); };
    bOk.onclick = ok; bNo.onclick = no;
    bg.addEventListener('pointerdown', e => { if (e.target === bg) no(); });
    bg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); ok(); } else if (e.key === 'Escape'){ e.preventDefault(); no(); } });
    const first = box.querySelector('input[type=number],select,input');
    if (first){ first.focus(); if (first.select) first.select(); }
    return bg;
  }
};
const run = (id, params) => CMD.run(id, params);
/* 开对话框的命令：不改文件（选取空＝原码菜单灰着，我们回失败不开） */
function regDialog(id, cmd, needSel, build){
  reg(id, {params:'{} 开「' + cmd + '」的对话框（确定＝跑 ' + cmd + '；栏位照原码 dialogs）→ {ok, dialog}'}, p => {
    if (needSel){ const t = targets(p, id); if (t.err) return t.err; }
    const d = build(p); Dlg.open(d.kind, d.title, d.fields, d.ok);
    return {ok:true, dialog:d.kind};
  });
}
regDialog('ai.object.move.dialog', 'ai.object.move', true, () => ({kind:'move', title:'aio.move', fields:[
  {key:'dx', label:'aio.horizontal', type:'number', value:0}, {key:'dy', label:'aio.vertical', type:'number', value:0}, {key:'copy', label:'aio.copy', type:'check', value:false}],
  ok:v => run('ai.object.move', v)}));
regDialog('ai.object.rotate.dialog', 'ai.object.rotate', true, () => ({kind:'rotate', title:'aio.rotate', fields:[
  {key:'angle', label:'aio.angle', type:'number', value:0}, {key:'copy', label:'aio.copy', type:'check', value:false}],
  ok:v => run('ai.object.rotate', v)}));
regDialog('ai.object.scale.dialog', 'ai.object.scale', true, () => ({kind:'scale', title:'aio.scale', fields:[
  {key:'sx', label:'aio.scaleH', type:'number', value:100}, {key:'sy', label:'aio.scaleV', type:'number', value:100},
  {key:'uniform', label:'aio.uniform', type:'check', value:true}, {key:'corners', label:'aio.corners', type:'check', value:false},
  {key:'strokes', label:'aio.strokes', type:'check', value:false}, {key:'copy', label:'aio.copy', type:'check', value:false}],
  ok:v => run('ai.object.scale', {sx:v.sx, sy:v.uniform ? v.sx : v.sy, copy:v.copy, corners:v.corners, strokes:v.strokes})}));   // transform.rs:81-84
regDialog('ai.object.reflect.dialog', 'ai.object.reflect', true, () => ({kind:'reflect', title:'aio.reflect', fields:[
  {key:'axis', label:'aio.axis', type:'select', value:'vertical', options:[['vertical', 'aio.vertical'], ['horizontal', 'aio.horizontal'], ['angle', 'aio.angle']]},
  {key:'angle', label:'aio.angle', type:'number', value:90}, {key:'copy', label:'aio.copy', type:'check', value:false}],
  ok:v => run('ai.object.reflect', {axis:v.axis === 'angle' ? v.angle : v.axis, copy:v.copy})}));
regDialog('ai.object.shear.dialog', 'ai.object.shear', true, () => ({kind:'shear', title:'aio.shear', fields:[
  {key:'angle', label:'aio.shearAngle', type:'number', value:0},
  {key:'axis', label:'aio.axis', type:'select', value:'horizontal', options:[['horizontal', 'aio.horizontal'], ['vertical', 'aio.vertical']]},
  {key:'copy', label:'aio.copy', type:'check', value:false}],
  ok:v => run('ai.object.shear', v)}));
regDialog('ai.object.transformEach.dialog', 'ai.object.transformEach', true, () => ({kind:'transformEach', title:'aio.transformEach', fields:[
  {label:'aio.scale', type:'head'}, {key:'scaleH', label:'aio.horizontal', type:'number', value:100}, {key:'scaleV', label:'aio.vertical', type:'number', value:100},
  {label:'aio.move', type:'head'}, {key:'moveH', label:'aio.horizontal', type:'number', value:0}, {key:'moveV', label:'aio.vertical', type:'number', value:0},
  {label:'aio.rotate', type:'head'}, {key:'rotate', label:'aio.angle', type:'number', value:0},
  {label:'aio.options', type:'head'}, {key:'corners', label:'aio.corners', type:'check', value:false}, {key:'strokes', label:'aio.strokes', type:'check', value:false},
  {key:'reflectX', label:'aio.reflectX', type:'check', value:false}, {key:'reflectY', label:'aio.reflectY', type:'check', value:false},
  {key:'reference', label:'aio.reference', type:'ref', value:4}, {key:'random', label:'aio.random', type:'check', value:false}, {key:'copy', label:'aio.copy', type:'check', value:false}],
  ok:v => run('ai.object.transformEach', v)}));
regDialog('ai.path.average.dialog', 'ai.path.average', false, () => ({kind:'average', title:'aio.average', fields:[
  {key:'axis', type:'radio', value:'both', options:[['horizontal', 'aio.horizontal'], ['vertical', 'aio.vertical'], ['both', 'aio.both']]}],
  ok:v => run('ai.path.average', v)}));
regDialog('ai.object.path.offsetPath.dialog', 'ai.object.path.offsetPath', true, () => ({kind:'offsetPath', title:'aio.offsetPath', fields:[
  {key:'offset', label:'aio.offset', type:'number', value:10},
  {key:'joins', label:'aio.joins', type:'select', value:'miter', options:[['miter', 'aio.miter'], ['round', 'aio.round'], ['bevel', 'aio.bevel']]},
  {key:'miterLimit', label:'aio.miterLimit', type:'number', value:4}],
  ok:v => run('ai.object.path.offsetPath', v)}));
regDialog('ai.object.path.simplify.dialog', 'ai.object.path.simplify', true, () => ({kind:'simplify', title:'aio.simplify', fields:[
  {key:'tolerance', label:'aio.tolerance', type:'number', value:1}],
  ok:v => run('ai.object.path.simplify', v)}));
regDialog('ai.object.path.splitIntoGrid.dialog', 'ai.object.path.splitIntoGrid', true, () => ({kind:'splitIntoGrid', title:'aio.splitIntoGrid', fields:[
  {key:'rows', label:'aio.rows', type:'number', value:2}, {key:'columns', label:'aio.columns', type:'number', value:2}, {key:'gutter', label:'aio.gutter', type:'number', value:12}],
  ok:v => run('ai.object.path.splitIntoGrid', v)}));
regDialog('ai.object.path.cleanUp.dialog', 'ai.object.path.cleanUp', false, () => ({kind:'cleanUp', title:'aio.cleanUp', fields:[
  {key:'strayPoints', label:'aio.strayPoints', type:'check', value:true}, {key:'unpaintedObjects', label:'aio.unpainted', type:'check', value:true},
  {key:'emptyTextPaths', label:'aio.emptyText', type:'check', value:true}],
  ok:v => run('ai.object.path.cleanUp', v)}));
regDialog('ai.object.expand.dialog', 'ai.object.expand', true, () => {
  const info = run('ai.object.expand.info', {});
  return {kind:'expand', title:'aio.expand', fields:[
    {label:'aio.expand', type:'head'},
    {key:'object', label:'aio.object', type:'check', value:true, enabled:!!info.object}, {key:'fill', label:'aio.fill', type:'check', value:true, enabled:!!info.fill},
    {key:'stroke', label:'aio.stroke', type:'check', value:true, enabled:!!info.stroke},
    {label:'aio.expandGradientTo', type:'head'},
    {key:'gradient', type:'radio', value:'objects', options:[['mesh', 'aio.gradientMesh', false], ['objects', 'aio.specify', !!info.fill]]},
    {key:'steps', label:'aio.objects', type:'number', value:255}],
    ok:v => run('ai.object.expand', {object:v.object && !!info.object, fill:v.fill && !!info.fill, stroke:v.stroke && !!info.stroke, gradient:v.gradient, steps:v.steps})};
});
regDialog('ai.object.mesh.create.dialog', 'mesh.create', true, () => ({kind:'meshCreate', title:'aio.meshCreate', fields:[     // menus.rs:1636 cp(..., {rows:4, cols:4, appearance:"flat", highlight:100})
  {key:'rows', label:'aio.rows', type:'number', value:4}, {key:'cols', label:'aio.columns', type:'number', value:4},
  {key:'appearance', label:'aio.appearance', type:'select', value:'flat', options:[['flat', 'aio.flat'], ['center', 'aio.toCenter'], ['edge', 'aio.toEdge']]},
  {key:'highlight', label:'aio.highlight', type:'number', value:100}],
  ok:v => run('mesh.create', v)}));

/* ═════════════ 渲染：隐藏、编组、剪切组、复合路径（engine.js drawShape 要接的钩子）═════════════ */
const ObjRender = {
  handles(s){ return !!s && (s.visible === false || s.type === 'group' || s.type === 'compound'); },
  draw(ctx, s, S){
    if (!s || s.visible === false) return;
    if (s.type === 'group') return this.group(ctx, s, S);
    if (s.type === 'compound') return this.compound(ctx, s, S);
  },
  /* 一个形状的轮廓加进目前的 path（复合路径＝全部成员） */
  addPath(ctx, s, S){
    if (isCont(s)){ s.children.forEach(c => this.addPath(ctx, c, S)); return; }
    const v = view(s); if (v && v.anchors && v.anchors.length) bezierPath(ctx, v, S);
  },
  style(ctx, s, S, which){ const p = s[which]; return (p && typeof p === 'object') ? (window.GradientFill ? GradientFill.toCanvas(ctx, s, S, which) : 'rgba(0,0,0,0)') : p; },
  fillStroke(ctx, s, S, rule, part){
    if ((part !== 'stroke') && painted(s.fill)){ ctx.fillStyle = this.style(ctx, s, S, 'fill'); ctx.fill(rule); }
    if ((part !== 'fill') && hasStroke(s)){ ctx.strokeStyle = this.style(ctx, s, S, 'stroke'); ctx.lineWidth = s.strokeWidth * S; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  },
  rule(s){ return s.type === 'compound' && s.rule === 'evenodd' ? 'evenodd' : 'nonzero'; },
  compound(ctx, s, S){
    ctx.save(); ctx.beginPath(); this.addPath(ctx, s, S); this.fillStroke(ctx, s, S, this.rule(s)); ctx.restore();
  },
  group(ctx, s, S){
    const kids = s.children || [], drawK = k => window.drawShape(ctx, k, S);
    if (!s.clip || !kids.length){ kids.forEach(drawK); return; }
    // 剪切组：children[0] 剪住其余；剪切路径之后上的色＝填色在内容后面、描边在上面（object.rs:104）
    const c = kids[0], r = this.rule(c);
    ctx.save();
    ctx.beginPath(); this.addPath(ctx, c, S);
    if (c.visible !== false) this.fillStroke(ctx, c, S, r, 'fill');
    ctx.clip(r);
    kids.slice(1).forEach(drawK);
    ctx.restore();
    if (c.visible !== false && hasStroke(c)){ ctx.save(); ctx.beginPath(); this.addPath(ctx, c, S); this.fillStroke(ctx, c, S, r, 'stroke'); ctx.restore(); }
  },
  /* 导出 SVG 用（engine Project.toSVG 要接）：一个形状（含编组／复合路径／藏起来的）→ SVG 片段 */
  toSVG(s){
    if (!s || s.visible === false) return '';
    const esc = v => String(v).replace(/"/g, '&quot;');
    let defs = '';
    const paint = (x, k) => (x && typeof x === 'object') ? (window.GradientFill ? (defs += GradientFill.toSVG(x, s.id + '_' + k), `url(#${s.id}_${k})`) : 'none') : esc(x || 'none');
    const dOf = n => isCont(n) ? n.children.map(dOf).join(' ') : (view(n) ? bezierD(view(n)) : '');
    if (s.type === 'group'){
      const kids = s.children || [];
      if (s.clip && kids.length) return `<clipPath id="${s.id}_clip"><path d="${dOf(kids[0])}" clip-rule="${this.rule(kids[0])}"/></clipPath><g clip-path="url(#${s.id}_clip)">${kids.slice(1).map(k => this.toSVG(k)).join('')}</g>`;
      return `<g>${kids.map(k => this.toSVG(k)).join('')}</g>`;
    }
    const pa = `fill="${paint(s.fill, 'f')}" stroke="${paint(s.stroke, 's')}" stroke-width="${s.strokeWidth || 0}"`;
    const body = s.type === 'compound' ? `<path d="${dOf(s)}" fill-rule="${this.rule(s)}" ${pa}/>` : `<path d="${dOf(s)}" ${pa}/>`;
    return (defs ? `<defs>${defs}</defs>` : '') + body;
  }
};
window.ObjRender = ObjRender;
/* 🔴 暂时的包装（engine.js 接上这组钩子后自动不再包：看原函数里有没有 ObjRender／children 字样） */
if (typeof drawShape === 'function' && !drawShape.__objRender && !/ObjRender/.test(String(drawShape))){
  const orig = drawShape;
  const w = function(ctx, s, scale){ if (window.ObjRender && ObjRender.handles(s)) return ObjRender.draw(ctx, s, scale); return orig(ctx, s, scale); };
  w.__objRender = true;
  w.toString = () => String(orig);      // 别的测试会拿 drawShape 的原始码文字去改（自测-gradient B23），给它原文
  window.drawShape = w;
}
if (typeof shiftShape === 'function' && !/children/.test(String(shiftShape))){
  const origS = shiftShape;
  window.shiftShape = function(s, dx, dy){
    if (s && Array.isArray(s.children) && (s.type === 'group' || s.type === 'compound')){
      if (!dx && !dy) return s;
      s.children.forEach(c => window.shiftShape(c, dx, dy));
      if (window.GradientFill){ GradientFill.shift(s.fill, dx, dy); GradientFill.shift(s.stroke, dx, dy); }
      return s;
    }
    return origS(s, dx, dy);
  };
}

/* ═════════════ 三语字串（照 AI 2020 繁／简中介面的对话框用语）═════════════ */
const STR = {
  'zh-Hant':{'aio.ok':'確定', 'aio.cancel':'取消', 'aio.copy':'拷貝', 'aio.move':'移動', 'aio.rotate':'旋轉', 'aio.scale':'縮放', 'aio.reflect':'鏡射', 'aio.shear':'傾斜',
    'aio.transformEach':'個別變形', 'aio.horizontal':'水平', 'aio.vertical':'垂直', 'aio.angle':'角度', 'aio.shearAngle':'傾斜角度', 'aio.axis':'座標軸',
    'aio.scaleH':'水平 (%)', 'aio.scaleV':'垂直 (%)', 'aio.uniform':'等比例', 'aio.corners':'縮放邊角', 'aio.strokes':'縮放筆畫和效果', 'aio.options':'選項',
    'aio.reflectX':'鏡射 X', 'aio.reflectY':'鏡射 Y', 'aio.reference':'參考點', 'aio.random':'隨機', 'aio.average':'平均', 'aio.both':'兩者',
    'aio.offsetPath':'位移路徑', 'aio.offset':'位移', 'aio.joins':'轉角', 'aio.miter':'尖角', 'aio.round':'圓角', 'aio.bevel':'斜角', 'aio.miterLimit':'尖角限度',
    'aio.simplify':'簡化', 'aio.tolerance':'容許度', 'aio.splitIntoGrid':'分割為網格', 'aio.rows':'橫欄數', 'aio.columns':'直欄數', 'aio.gutter':'間距',
    'aio.cleanUp':'清除', 'aio.strayPoints':'獨立的錨點', 'aio.unpainted':'未上色物件', 'aio.emptyText':'空白文字路徑',
    'aio.expand':'展開', 'aio.object':'物件', 'aio.fill':'填色', 'aio.stroke':'筆畫', 'aio.expandGradientTo':'展開漸層為', 'aio.gradientMesh':'漸層網格', 'aio.specify':'指定', 'aio.objects':'物件數',
    'aio.meshCreate':'建立漸層網格', 'aio.appearance':'外觀', 'aio.flat':'平面', 'aio.toCenter':'至中央', 'aio.toEdge':'至邊緣', 'aio.highlight':'亮度 (%)'},
  'zh-Hans':{'aio.ok':'确定', 'aio.cancel':'取消', 'aio.copy':'复制', 'aio.move':'移动', 'aio.rotate':'旋转', 'aio.scale':'比例缩放', 'aio.reflect':'镜像', 'aio.shear':'倾斜',
    'aio.transformEach':'分别变换', 'aio.horizontal':'水平', 'aio.vertical':'垂直', 'aio.angle':'角度', 'aio.shearAngle':'倾斜角度', 'aio.axis':'轴',
    'aio.scaleH':'水平 (%)', 'aio.scaleV':'垂直 (%)', 'aio.uniform':'等比', 'aio.corners':'比例缩放圆角', 'aio.strokes':'比例缩放描边和效果', 'aio.options':'选项',
    'aio.reflectX':'对称 X', 'aio.reflectY':'对称 Y', 'aio.reference':'参考点', 'aio.random':'随机', 'aio.average':'平均', 'aio.both':'两者兼有',
    'aio.offsetPath':'偏移路径', 'aio.offset':'位移', 'aio.joins':'连接', 'aio.miter':'斜接', 'aio.round':'圆角', 'aio.bevel':'斜角', 'aio.miterLimit':'斜接限制',
    'aio.simplify':'简化', 'aio.tolerance':'容差', 'aio.splitIntoGrid':'分割为网格', 'aio.rows':'行数', 'aio.columns':'列数', 'aio.gutter':'栏间距',
    'aio.cleanUp':'清理', 'aio.strayPoints':'游离点', 'aio.unpainted':'未上色对象', 'aio.emptyText':'空文本路径',
    'aio.expand':'扩展', 'aio.object':'对象', 'aio.fill':'填充', 'aio.stroke':'描边', 'aio.expandGradientTo':'将渐变扩展为', 'aio.gradientMesh':'渐变网格', 'aio.specify':'指定', 'aio.objects':'对象数',
    'aio.meshCreate':'创建渐变网格', 'aio.appearance':'外观', 'aio.flat':'平淡色', 'aio.toCenter':'至中心', 'aio.toEdge':'至边缘', 'aio.highlight':'高光 (%)'},
  'en':{'aio.ok':'OK', 'aio.cancel':'Cancel', 'aio.copy':'Copy', 'aio.move':'Move', 'aio.rotate':'Rotate', 'aio.scale':'Scale', 'aio.reflect':'Reflect', 'aio.shear':'Shear',
    'aio.transformEach':'Transform Each', 'aio.horizontal':'Horizontal', 'aio.vertical':'Vertical', 'aio.angle':'Angle', 'aio.shearAngle':'Shear Angle', 'aio.axis':'Axis',
    'aio.scaleH':'Horizontal (%)', 'aio.scaleV':'Vertical (%)', 'aio.uniform':'Uniform', 'aio.corners':'Scale Corners', 'aio.strokes':'Scale Strokes & Effects', 'aio.options':'Options',
    'aio.reflectX':'Reflect X', 'aio.reflectY':'Reflect Y', 'aio.reference':'Reference Point', 'aio.random':'Random', 'aio.average':'Average', 'aio.both':'Both',
    'aio.offsetPath':'Offset Path', 'aio.offset':'Offset', 'aio.joins':'Joins', 'aio.miter':'Miter', 'aio.round':'Round', 'aio.bevel':'Bevel', 'aio.miterLimit':'Miter limit',
    'aio.simplify':'Simplify', 'aio.tolerance':'Tolerance', 'aio.splitIntoGrid':'Split Into Grid', 'aio.rows':'Rows', 'aio.columns':'Columns', 'aio.gutter':'Gutter',
    'aio.cleanUp':'Clean Up', 'aio.strayPoints':'Stray Points', 'aio.unpainted':'Unpainted Objects', 'aio.emptyText':'Empty Text Paths',
    'aio.expand':'Expand', 'aio.object':'Object', 'aio.fill':'Fill', 'aio.stroke':'Stroke', 'aio.expandGradientTo':'Expand Gradient To', 'aio.gradientMesh':'Gradient Mesh', 'aio.specify':'Specify:', 'aio.objects':'Objects',
    'aio.meshCreate':'Create Gradient Mesh', 'aio.appearance':'Appearance', 'aio.flat':'Flat', 'aio.toCenter':'To Center', 'aio.toEdge':'To Edge', 'aio.highlight':'Highlight (%)'}
};
if (window.Lang) Lang.add(STR);

window.AIObj = {Dlg, ObjRender, A, Fit, arrangement, strokePieces, flatten, tidyLoop, simplifyView, shapeBounds, orientedBox, detectShape, state:AO};
})();

/* ═════════════════════════════════════════════════════════════════════════════
   对象菜单里其余原码有实作的项，照 VectorCraft 原码抄。
   以下每一段是一个独立 IIFE（档头列原码档:行）；本段是共用底座 window.AiR3：
     · 小工具（照上面那段的私有工具抄一份：targets／roots／reid／selectIds…，上面的段落不动）
     · 「活」物件渲染登记 AiR3.live[种类] = {draw(ctx, s, S), svg(s)} ——链式包 ObjRender.handles／draw／toSVG 一次，按 s.live 分派
       活物件一律存成 {type:'group', live:'<种类>', children:[来源物件…], <种类>:{参数}}：移动、变换、外框、存档、Ctrl+Z 走现成的编组路径
     · 文件级资料 Doc.aiR3（画板、切片、资源、透视网格、图案…）：进历史快照、进工程档、开新档清空（钩子装在 ai-view 段，因为要包 AiView.docSnap／docRestore）
     · 画面叠画登记 AiR3.overlays（fn(ctx, s)；ai-view 段把它接进 AiView.drawOverlays）
     · 深层选取：原码 selection 可以选编组里面的物件（剪切蒙版的编辑内容、选择 ▸ 对象 ▸ 剪切蒙版）；
       VecSel.prune 会把不是顶层的 id 剔掉 ⇒ 链式包一层：在本层树里找得到的深层 id 留着
   ═════════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if (window.AiR3) return;
const clone = o => JSON.parse(JSON.stringify(o));
const num = (v, d) => { if (v === undefined || v === null || v === '') return d; const n = +(typeof v === 'string' ? parseFloat(v) : v); return isFinite(n) ? n : d; };
const bool = (v, d) => v === undefined || v === null ? d : !!v;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const newId = () => uid('S');
const LEAF = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line', 'bezier'];
const LIVE = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line'];
const isLeaf = s => !!s && LEAF.includes(s.type);
const isCont = s => !!s && (s.type === 'group' || s.type === 'compound') && Array.isArray(s.children);
const painted = p => !!p && p !== 'none' && p !== '';
const hasStroke = s => painted(s.stroke) && (s.strokeWidth || 0) > 0;
function walk(arr, cb, depth, parent){ (arr || []).forEach((s, i) => { cb(s, arr, i, depth || 0, parent || null); if (isCont(s)) walk(s.children, cb, (depth || 0) + 1, s); }); }
function reid(s){ const c = clone(s); const go = n => { n.id = newId(); if (isCont(n)) n.children.forEach(go); }; go(c); return c; }
function vLayer(p){ const L = (p && p.layerId) ? Doc.byId(p.layerId) : (VecSel.layer() || Doc.active()); return (L && L.kind === 'vector') ? L : null; }
function roots(L, ids){ const want = ids || ((VecSel.layerId === L.id) ? VecSel.shapes : []); return L.data.shapes.filter(s => want.includes(s.id) && !s.locked && s.visible !== false); }
function targets(p, C){
  const L = vLayer(p); if (!L) return {err:{ok:false, error:C + ': not a vector layer'}};
  const R = roots(L, Array.isArray(p.ids) ? p.ids : null);
  if (!R.length) return {err:{ok:false, error:C + ': nothing selected'}};
  return {L, R};
}
const selectIds = (L, ids) => VecSel.setShapes(L.id, ids);
/* 在一层（或所有矢量层）的树里找一个物件 → {L, s, arr, idx, parent} */
function findDeep(id, L0){
  for (const L of (L0 ? [L0] : Doc.layers)){
    if (!L || L.kind !== 'vector') continue;
    let hit = null; walk(L.data.shapes, (s, arr, i, d, par) => { if (!hit && s.id === id) hit = {L, s, arr, idx:i, parent:par}; });
    if (hit) return hit;
  }
  return null;
}
const docF = L => (p => [p[0] + L.x, p[1] + L.y]);
const boundsOf = (L, list, visual) => list.reduce((r, s) => { const b = AIObj.shapeBounds(s, docF(L), visual); return !r ? b : !b ? r : {x0:Math.min(r.x0, b.x0), y0:Math.min(r.y0, b.y0), x1:Math.max(r.x1, b.x1), y1:Math.max(r.y1, b.y1)}; }, null);
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));
/* 原码「没事可做就不推历史」那几条：不登记成 undoable，要动文件前自己 touch() 推一步 */
function regEdit(id, meta, fn){
  CMD.reg(id, Object.assign({i18n:''}, meta, {undoable:false}), p => {
    let pushed = false; const touch = () => { if (!pushed){ History.push(); pushed = true; } };
    try { const r = fn(p || {}, touch); if (pushed && r && r.ok === false) History.restoreInPlace(History.past.pop()); return r; }
    catch (e){ if (pushed) History.restoreInPlace(History.past.pop()); throw e; }
  });
}
const done = (L, extra) => { if (L) Layer.invalidate(L); return Object.assign({ok:true}, extra || {}); };
const invalidateAll = () => Doc.layers.forEach(L => { if (L.kind === 'vector') Layer.invalidate(L); });
/* 开对话框的命令（不改文件；needSel 时选取空就失败不开） */
function regDialog(id, cmd, needSel, build){
  reg(id, {params:'{} 开「' + cmd + '」的对话框（确定＝跑 ' + cmd + '；栏位照原码 dialogs）→ {ok, dialog}'}, p => {
    if (needSel){ const t = targets(p, id); if (t.err) return t.err; }
    const d = build(p); if (d && d.ok === false) return d;
    AIObj.Dlg.open(d.kind, d.title, d.fields, d.ok);
    return {ok:true, dialog:d.kind};
  });
}
/* 一个形状的贝兹视图（活形状照 VecSel.asBezier；复合路径＝各成员） */
const subviews = s => (s.type === 'compound' ? s.children.map(c => VecSel.asBezier(c)) : (isLeaf(s) ? [VecSel.asBezier(s)] : [])).filter(v => v && v.anchors && v.anchors.length);
/* 叶子（路径、复合路径；剪切路径跳过） */
function leavesOf(s, out){ out = out || []; if (s.type === 'group') s.children.forEach(c => leavesOf(c, out)); else if ((isLeaf(s) && !s.clipping) || s.type === 'compound') out.push(s); return out; }
/* 把一个形状变成 bezier（就地；活形状丢掉 live） */
function toBezier(s){ if (LIVE.includes(s.type)) VecSel.ensureBezier(null, s); return s; }
const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth'];

const AiR3 = window.AiR3 = {
  clone, num, bool, clamp, newId, LEAF, LIVE, isLeaf, isCont, painted, hasStroke, walk, reid, vLayer, roots, targets, selectIds, findDeep,
  docF, boundsOf, reg, regEdit, done, invalidateAll, regDialog, subviews, leavesOf, toBezier, STYLE_KEYS, form, helperOf, kidsOf, mkHelper, geoBounds, xformDeep, cloneXf, drawXf, SVGM,
  onShift: [],         // 画布原点挪动（画板 0 改位置＝crop.apply 平移各层）时，文件级坐标跟着平移：fn(dx, dy)
  live: {},            // 活物件渲染：kind → {draw(ctx, s, S), svg(s)}
  overlays: [],        // 画面叠画：fn(ctx, s)（文件坐标 × s）
  /* 文件级资料（Doc.aiR3[key]）：缺省值工厂 */
  docDefaults: {},
  doc(key){ if (!Doc.aiR3 || typeof Doc.aiR3 !== 'object') Doc.aiR3 = {}; if (Doc.aiR3[key] === undefined) Doc.aiR3[key] = this.docDefaults[key] ? this.docDefaults[key]() : null; return Doc.aiR3[key]; },
  /* 深层选取：选中编组里面的物件（原码 Selection 可以） */
  selectDeep(L, ids){ if (window.AiSel) AiSel.text = []; if (!ids.length) VecSel.clear(); else VecSel.setShapes(L.id, ids); },
  T: k => (window.Lang ? Lang.t(k) : k)
};

/* ── 通用对话框（AIObj.Dlg 没有文字栏；同一个 #aiObjDialog 外观，测试的 H.dialog 也能用）──
   fields：[{key, label, type:'number'|'text'|'textarea'|'check'|'select'|'radio'|'color'|'head'|'note', value, options:[[值, 字串键]], enabled, min, max}]
   onOk(values) 回 {ok:false, error} 就不关、显示错误 */
const R3STYLE = `#aiObjDialog input[type=text],#aiObjDialog textarea{width:100%;box-sizing:border-box;background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:3px 6px;font:12px sans-serif}
#aiObjDialog .note{color:#8a93a0;font-size:12px;margin:4px 0;max-width:340px}
#aiObjDialog input[type=color]{width:100%;height:24px;background:#1e2126;border:1px solid #444a54}`;
function form(kind, title, fields, onOk){
  AIObj.Dlg.open(kind, title, [], () => ({ok:true}));       // 借它的外框、样式、确定／取消钮与 Enter／Esc
  if (!document.getElementById('aiR3Style')){ const st = document.createElement('style'); st.id = 'aiR3Style'; st.textContent = R3STYLE; document.head.appendChild(st); }
  const bg = document.getElementById('aiObjDialog'), box = bg.querySelector('.box'), anchor = box.querySelector('.err');
  const T = k => (window.Lang ? Lang.t(k) : k);
  let grid = null;
  const ensureGrid = () => { if (!grid){ grid = document.createElement('div'); grid.className = 'grid'; box.insertBefore(grid, anchor); } return grid; };
  for (const f of fields){
    if (f.type === 'head' || f.type === 'note'){ grid = null; const h = document.createElement('div'); h.className = f.type === 'head' ? 'sh' : 'note'; h.textContent = T(f.label); if (f.key) h.dataset.key = f.key; box.insertBefore(h, anchor); continue; }
    if (f.type === 'check'){
      grid = null;
      const l = document.createElement('label'); l.className = 'ck' + (f.enabled === false ? ' off' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = f.key; cb.checked = !!f.value; cb.disabled = f.enabled === false;
      const sp = document.createElement('span'); sp.textContent = T(f.label); l.appendChild(cb); l.appendChild(sp); box.insertBefore(l, anchor); continue;
    }
    if (f.type === 'radio'){
      grid = null;
      if (f.label){ const h = document.createElement('div'); h.className = 'sh'; h.textContent = T(f.label); box.insertBefore(h, anchor); }
      for (const [v, lk, en] of f.options){
        const l = document.createElement('label'); l.className = 'ck' + (en === false ? ' off' : '');
        const r = document.createElement('input'); r.type = 'radio'; r.name = f.key; r.value = v; r.checked = v === f.value; r.disabled = en === false;
        const sp = document.createElement('span'); sp.textContent = T(lk); l.appendChild(r); l.appendChild(sp); box.insertBefore(l, anchor);
      }
      continue;
    }
    const G = ensureGrid();
    const lab = document.createElement('span'); lab.textContent = T(f.label);
    let inp;
    if (f.type === 'select'){ inp = document.createElement('select'); for (const [v, lk] of f.options){ const o = document.createElement('option'); o.value = v; o.textContent = T(lk); inp.appendChild(o); } inp.value = f.value; }
    else if (f.type === 'textarea'){ inp = document.createElement('textarea'); inp.rows = f.rows || 4; inp.value = f.value === undefined ? '' : f.value; }
    else { inp = document.createElement('input'); inp.type = f.type === 'text' ? 'text' : f.type === 'color' ? 'color' : 'number'; if (inp.type === 'number') inp.step = 'any'; inp.value = f.value === undefined ? '' : f.value; }
    if (f.enabled === false) inp.disabled = true;
    inp.name = f.key; G.appendChild(lab); G.appendChild(inp);
  }
  const read = () => {
    const v = {};
    for (const f of fields){
      if (f.type === 'head' || f.type === 'note') continue;
      if (f.type === 'check'){ v[f.key] = !!box.querySelector(`input[name="${f.key}"]`).checked; continue; }
      if (f.type === 'radio'){ const r = box.querySelector(`input[name="${f.key}"]:checked`); v[f.key] = r ? r.value : f.value; continue; }
      const el = box.querySelector(`[name="${f.key}"]`);
      v[f.key] = (f.type === 'number') ? num(el.value, f.value) : el.value;
    }
    return v;
  };
  const err = box.querySelector('.err'), okBtn = box.querySelector('button[data-act=ok]');
  const ok = () => {
    let r; try { r = onOk(read()); } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; }
    if (r && r.ok === false){ err.textContent = r.error || ''; return; }
    AIObj.Dlg.close(); if (window.UI) UI.draw();
  };
  okBtn.onclick = ok;
  bg.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); e.stopImmediatePropagation(); ok(); } }, true);
  const first = box.querySelector('input[type=number],input[type=text],select,textarea,input'); if (first){ first.focus(); if (first.select) first.select(); }
  return bg;
}

/* ── 活物件的几何小工具 ──
   活物件跟着变换走的参数（重复的中心、对称轴、封套的网格点…）存成一个看不见的辅助路径子物件（r3helper:true、visible:false），
   这样既有的移动／旋转／缩放／对称／倾斜（ai-object 的 xform 往编组里面套）会把它一起变换，不用改既有段落。 */
function helperOf(s){ return (s && Array.isArray(s.children)) ? s.children.find(c => c && c.r3helper) || null : null; }
function kidsOf(s){ return (s && Array.isArray(s.children)) ? s.children.filter(c => c && !c.r3helper) : []; }
function mkHelper(pts){ return {id:newId(), type:'path', points:pts.map(p => [p[0], p[1]]), closed:false, fill:'none', stroke:'none', strokeWidth:0, visible:false, r3helper:true}; }
/* 几何外框联集（图层坐标；live::nodes_bounds） */
function geoBounds(list){ return list.reduce((r, s) => { const b = AIObj.shapeBounds(s, p => p, false); return !r ? b : !b ? r : {x0:Math.min(r.x0, b.x0), y0:Math.min(r.y0, b.y0), x1:Math.max(r.x1, b.x1), y1:Math.max(r.y1, b.y1)}; }, null); }
/* 就地把仿射 m（图层坐标）套到一个形状（编组／复合路径往下套；叶子用 rotate.js 的 rotTransformShape；不缩描边） */
function xformDeep(s, m, sc){
  sc = sc || {strokes:false, corners:false};
  if (isCont(s)){
    if (s.type === 'compound' && window.GradientFill){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); }
    s.children.forEach(c => xformDeep(c, m, sc));
    const k = s.live && AiR3.live[s.live]; if (k && k.transform) k.transform(s, m);
    return s;
  }
  if (s.type === 'mesh' && s.mesh){                          // 渐变网格：点与把手（把手是相对位移）
    const lin = v => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
    s.mesh.points.forEach(q => { const p = AIObj.A.apply(m, [q.x, q.y]); q.x = p[0]; q.y = p[1]; if (Array.isArray(q.handles)) q.handles = q.handles.map(h => Array.isArray(h) ? lin(h) : h); });   // 把手是相对向量：只套线性部分
    return s;
  }
  if (typeof rotTransformShape === 'function') rotTransformShape(null, s, m, sc);
  return s;
}
/* 复制一份并套 m（新 id） */
function cloneXf(s, m){ return xformDeep(reid(s), m); }
/* 在 ctx 上用仿射 m（图层坐标）画一个形状：有 ctx.transform 就直接变换画布，否则（轮廓模式的 shim）画变换后的复制品 */
function drawXf(ctx, s, m, S){
  if (typeof ctx.transform === 'function' && typeof ctx.save === 'function'){
    ctx.save(); ctx.transform(m[0], m[1], m[2], m[3], m[4] * S, m[5] * S); window.drawShape(ctx, s, S); ctx.restore();
  } else window.drawShape(ctx, cloneXf(s, m), S);
}
function SVGM(m){ return `matrix(${m.map(v => +(+v).toFixed(6)).join(' ')})`; }

/* ── 活物件渲染：链式包一次 ObjRender ── */
(function hookRender(){
  const OR = window.ObjRender; if (!OR || OR.__r3) return;
  OR.__r3 = true;
  const prevH = OR.handles, prevD = OR.draw, prevS = OR.toSVG;
  const kind = s => s && s.live && AiR3.live[s.live];
  OR.handles = function(s){ return !!kind(s) || prevH.call(this, s); };
  OR.draw = function(ctx, s, S){ const k = kind(s); if (k){ if (s.visible === false) return; return k.draw(ctx, s, S); } return prevD.call(this, ctx, s, S); };
  OR.toSVG = function(s){ const k = kind(s); if (k){ if (!s || s.visible === false) return ''; return k.svg ? k.svg(s) : (s.children || []).map(c => prevS.call(this, c)).join(''); } return prevS.call(this, s); };
})();

/* ── 深层选取：VecSel.prune 留下本层树里找得到的深层 id；叠画在 ai-view 段 ── */
if (window.VecSel && !VecSel.__r3Deep){
  VecSel.__r3Deep = true;
  const prune = VecSel.prune;
  VecSel.prune = function(){
    const L = this.layer();
    const deep = (L && L.kind === 'vector') ? this.shapes.filter(id => !L.data.shapes.some(x => x.id === id) && findDeep(id, L)) : [];
    const r = prune.apply(this, arguments);
    if (deep.length){ this.layerId = L.id; deep.forEach(id => { if (!this.shapes.includes(id)) this.shapes.push(id); }); }
    return r;
  };
}
})();

/*剪切蒙版 ▸ 编辑内容／编辑剪切路径：照 vectorcraft engine/src/cmd/object.rs:117-135（登记）、626-649 clip_edit
   选中物件（或它往上的祖先）若是剪切组：编辑内容＝选它被剪的内容（children[1..]）、编辑剪切路径＝选剪切路径（children[0]）。
   被选的是编组里面的物件 ⇒ 走 AiR3 深层选取（VecSel 里留深层 id、ai-view 段画轮廓）。选取不进历史（Session::select）。 */
(function(){
'use strict';
if (window.__aiR3_clipEdit) return; window.__aiR3_clipEdit = true;
const R3 = window.AiR3;
function clipEdit(cmd, mask){
  const L = VecSel.layer();
  if (!L || L.kind !== 'vector' || VecSel.isEmpty()) return {ok:false, error:cmd + ': select a clip group'};
  const ids = [];
  for (const id of VecSel.shapes){
    // 从选中的物件往上找第一个剪切组（object.rs:630-641）
    let cur = R3.findDeep(id, L);
    while (cur){
      if (cur.s.type === 'group' && cur.s.clip && cur.s.children.length){
        if (mask) ids.push(cur.s.children[0].id); else cur.s.children.slice(1).forEach(c => ids.push(c.id));
        break;
      }
      cur = cur.parent ? R3.findDeep(cur.parent.id, L) : null;
    }
  }
  const out = ids.filter((x, i) => ids.indexOf(x) === i);      // ids.dedup()
  if (!out.length) return {ok:false, error:'select a clip group'};
  R3.selectDeep(L, out);
  return {ok:true, count:out.length, ids:out, layerId:L.id};
}
R3.reg('ai.object.clippingMask.editContents', {params:'{} 照 object.clippingMask.editContents（剪切蒙版 ▸ 编辑内容）：选中的剪切组（或选中物件所在的剪切组）里被剪的内容改成选取（深层选取）→ {ok, count, ids}'},
  () => clipEdit('ai.object.clippingMask.editContents', false));
R3.reg('ai.object.clippingMask.editMask', {params:'{} 照 object.clippingMask.editMask（剪切蒙版 ▸ 编辑剪切路径）：选中的剪切组的剪切路径改成选取（深层选取）→ {ok, count, ids}'},
  () => clipEdit('ai.object.clippingMask.editMask', true));
})();

/*对象 ▸ 切片／画板／收集以导出（照 VectorCraft 原码）
     engine/src/cmd/slices.rs 1-717     object.slice.make／release／fromGuides／fromSelection／duplicate／combine／divide／deleteAll／options／clipToArtboard、
                                        slice.list、object.slice.create／setRect／move／delete／select、select.object.slices、view.slices.hide／lock
     doc/src/slices.rs 1-315            SliceOptions（种类 image／noImage／htmlText、名称、URL、目标、信息、替代文字、单元格文字、背景、水平／垂直对齐）、
                                        用户切片／对象切片（物件的 slice 选项，跟着物件可见外框）／自动切片（auto_slices：一行一行切开没盖到的区间）、编号左到右上到下
     ui-egui/src/dialogs/slices.rs      切片选项…、划分切片…（预设：行／列各 2、按数量；按大小＝第一个切片宽高的一半）
     ui-egui/src/canvas.rs:966-1011     切片叠画（线色 #ff3f3f、选中 2 点、自动切片 55% 虚线、左上角编号牌）
     engine/src/cmd/menucmds.rs:138-156, 712-776  artboard.convertToArtboards（每个选中物件的几何外框变成新画板、物件删掉）、artboard.rearrange（grid_origins 排格子、物件中心在哪个画板就跟着搬）
     engine/src/cmd/newdoc.rs:347-371   grid_origins
     engine/src/cmd/layer.rs:40-49, 318-342  artboard.setProps／fitToArt（art_bounds：可见图稿外框）／fitToSelection（选取可见外框）
     engine/src/cmd/assets.rs 1-227     assets.add（multiple：每个物件一个资源，否则全部一个；已收过的不重复；名字＝物件名或「资源 N」）／remove／rename／list／export
   我们这边：
     · 画板 0 ＝ 画布（Doc.width/height）。其余画板存 Doc.aiR3.artboards.extra（文件坐标）。改画板 0 的位置／大小＝叫 crop.apply（不删像素）平移各层，
       文件级坐标（其余画板、切片、参考线…）照 AiR3.onShift 跟着平移；crop.apply 会把宽高四舍五入成整数。
     · 切片、资源存 Doc.aiR3.slices／assets（进历史、进工程档）；对象切片＝物件上的 s.slice 选项。切片选取（Selection.slices）是 session 状态 AiR3.sliceSel。
     · 资源导出（assets.export）：每个资源单独画、裁到它的外框，用 engine 的 download() 存 PNG（🔴 网站版要覆写 ai.assets.export）。 */
(function(){
'use strict';
if (window.__aiR3_slices) return; window.__aiR3_slices = true;
const R3 = window.AiR3, {clone, num, bool, reg, regEdit, done} = R3;
const EPS = 1e-6, MAX_PIECES = 1000;
const T = k => (window.Lang ? Lang.t(k) : k);
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const rect = (x0, y0, x1, y1) => ({x0:Math.min(x0, x1), y0:Math.min(y0, y1), x1:Math.max(x0, x1), y1:Math.max(y0, y1)});
const validRect = r => !!r && [r.x0, r.y0, r.x1, r.y1].every(isFinite) && r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS;
const MAX_COORD = 1.6e7;
const sliceRectOk = r => validRect(r) && [r.x0, r.y0, r.x1, r.y1].every(v => Math.abs(v) <= MAX_COORD);
const unionR = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
const interR = (a, b) => ({x0:Math.max(a.x0, b.x0), y0:Math.max(a.y0, b.y0), x1:Math.min(a.x1, b.x1), y1:Math.min(a.y1, b.y1)});
const shiftR = (r, dx, dy) => ({x0:r.x0 + dx, y0:r.y0 + dy, x1:r.x1 + dx, y1:r.y1 + dy});

/* ═════ 文件级资料 ═════ */
R3.docDefaults.slices = () => ({list:[], clip:true});          // doc lib.rs:639 slices_clip_to_artboard 预设开
R3.docDefaults.artboards = () => ({extra:[], name0:'', next:2});
R3.docDefaults.assets = () => ({list:[], next:1});
const SL = () => R3.doc('slices'), AB = () => R3.doc('artboards'), AS = () => R3.doc('assets');
R3.sliceSel = {ids:[], stamp:'[]'};                              // Selection.slices（选物件就清掉：set/add 会 slices.clear()）
const vstamp = () => JSON.stringify(window.VecSel ? VecSel.shapes : []);

/* ═════ 画板 ═════ */
function artboards(){
  const a = AB();
  return [{index:0, id:1, name:a.name0 || artboardName(1), rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}]
    .concat(a.extra.map((x, i) => ({index:i + 1, id:x.id, name:x.name, rect:clone(x.rect)})));
}
function artboardName(id){ const n = {'zh-Hant':'工作區域 ', 'zh-Hans':'画板 ', en:'Artboard '}; return (n[window.Lang && Lang.cur] || n.en) + id; }
R3.artboards = artboards;
const artboardsUnion = () => artboards().map(a => a.rect).reduce(unionR, null);   // slice_clip
/* 画布原点挪动：文件级坐标跟着平移 */
R3.onShift.push((dx, dy) => {
  const a = AB(); a.extra.forEach(x => { x.rect = shiftR(x.rect, dx, dy); });
  const s = SL(); s.list.forEach(x => { x.rect = shiftR(x.rect, dx, dy); });
  if (window.AiView) AiView.guides().forEach(g => { g.pos += g.vertical ? dx : dy; });
});
/* 设画板 0 的矩形＝改画布：crop.apply（不删像素、不另推历史）＋文件级坐标跟着平移 */
function setCanvasRect(r){
  const c = CMD.map['crop.apply']; if (!c) return {ok:false, error:'crop.apply missing'};
  const x = Math.round(r.x0), y = Math.round(r.y0), w = Math.max(1, Math.round(r.x1 - r.x0)), h = Math.max(1, Math.round(r.y1 - r.y0));
  const res = c.run({x, y, width:w, height:h, deleteCroppedPixels:false});
  if (res && res.ok === false) return res;
  if (x || y) R3.onShift.forEach(f => f(-x, -y));
  return {ok:true, x, y, width:w, height:h};
}
/* 可见图稿外框（Document::art_bounds：各层 visual_bounds 联集） */
function artBounds(){
  let b = null;
  for (const L of Doc.layers){
    if (!L.visible) continue;
    if (L.kind === 'vector') L.data.shapes.forEach(s => { if (s.visible !== false && !s.guide) b = unionR(b, AIObj.shapeBounds(s, R3.docF(L), true)); });
    else if (L.kind === 'text') b = unionR(b, window.AiSel ? AiSel.textBounds(L) : null);
    else b = unionR(b, {x0:L.x, y0:L.y, x1:L.x + L.data.canvas.width, y1:L.y + L.data.canvas.height});
  }
  return b;
}
R3.artBounds = artBounds;
function setArtboard(i, p){
  const all = artboards(); if (!all[i]) return {ok:false, error:'no such artboard'};
  const cur = all[i].rect;
  const x = num(p.x, cur.x0), y = num(p.y, cur.y0), w = num(p.width, cur.x1 - cur.x0), h = num(p.height, cur.y1 - cur.y0);   // rect_from
  const r = rect(x, y, x + w, y + h);
  if (typeof p.name === 'string'){ if (i === 0) AB().name0 = p.name; else AB().extra[i - 1].name = p.name; }
  if (i === 0) return setCanvasRect(r);
  AB().extra[i - 1].rect = r;
  return {ok:true};
}
reg('ai.artboard.setProps', {undoable:true, params:'{index（0＝画布）, name?, x?, y?, width?, height?} 画板选项（layer.rs:318-329）：改画板的位置／大小／名称；画板 0＝改画布（crop.apply 平移各层、不删像素、宽高取整）→ {ok}'}, p => {
  const i = Math.floor(num(p.index, 0)); return setArtboard(i, p);
});
reg('ai.artboard.list', {params:'{} 画板清单（0＝画布）→ {ok, artboards:[{index, id, name, rect:{x0,y0,x1,y1}}]}'}, () => ({ok:true, artboards:artboards()}));
reg('ai.artboard.fitToArt', {undoable:true, params:'{index?=0} 对象 ▸ 画板 ▸ 适合图稿边界（layer.rs:331-335）：画板改成可见图稿的外框（含描边）；画板 0＝改画布 → {ok}'}, p => {
  const b = artBounds(); if (!b) return {ok:false, error:'no artwork'};
  return setArtboard(Math.floor(num(p.index, 0)), {x:b.x0, y:b.y0, width:b.x1 - b.x0, height:b.y1 - b.y0});
});
reg('ai.artboard.fitToSelection', {undoable:true, params:'{index?=0} 对象 ▸ 画板 ▸ 适合选中的图稿（layer.rs:337-342）：画板改成选中物件的外框（含描边）→ {ok}'}, p => {
  const L = VecSel.layer(), R = (L && L.kind === 'vector') ? R3.roots(L, null) : [];
  const b = R.length ? R3.boundsOf(L, R, true) : null; if (!b) return {ok:false, error:'no selection bounds'};
  return setArtboard(Math.floor(num(p.index, 0)), {x:b.x0, y:b.y0, width:b.x1 - b.x0, height:b.y1 - b.y0});
});
reg('ai.artboard.convertToArtboards', {undoable:true, params:'{} 对象 ▸ 画板 ▸ 转换为画板（menucmds.rs:712-739）：每个选中物件的几何外框变成一个新画板（物件删掉、选取清空）→ {ok, artboards:n}'}, p => {
  const t = R3.targets(p, 'artboard.convertToArtboards'); if (t.err) return t.err;
  const a = AB(); let n = 0;
  for (const s of t.R){
    const b = AIObj.shapeBounds(s, R3.docF(t.L), false);
    if (!b || !(b.x1 - b.x0 > 0) || !(b.y1 - b.y0 > 0)) continue;
    const id = Math.max(1, ...a.extra.map(x => x.id)) + 1;                               // next_artboard_id
    a.extra.push({id, name:artboardName(id), rect:b});
    t.L.data.shapes.splice(t.L.data.shapes.indexOf(s), 1);
    n++;
  }
  if (!n) return {ok:false, error:'Convert to Artboards: selection has no area'};
  VecSel.clear();
  return done(t.L, {artboards:n});
});
/* newdoc.rs:347-371 grid_origins */
function gridOrigins(sizes, origin, columns, spacing, byColumn){
  const n = sizes.length, cols = Math.min(Math.max(columns, 1), Math.max(n, 1)), rows = Math.max(Math.ceil(n / cols), 1);
  const cell = i => byColumn ? [i % rows, Math.floor(i / rows)] : [Math.floor(i / cols), i % cols];
  const colW = new Array(cols).fill(0), rowH = new Array(rows).fill(0);
  sizes.forEach(([w, h], i) => { const [r, c] = cell(i); if (c < cols && r < rows){ colW[c] = Math.max(colW[c], w); rowH[r] = Math.max(rowH[r], h); } });
  const off = (spans, k) => spans.slice(0, k).reduce((s, v) => s + v + spacing, 0);
  return sizes.map((_, i) => { const [r, c] = cell(i); return [origin[0] + off(colW, c), origin[1] + off(rowH, r)]; });
}
reg('ai.artboard.rearrange', {undoable:true, params:'{columns?=2, spacing?=20, byColumn?=false, moveArtwork?=true} 对象 ▸ 画板 ▸ 重新排列所有画板…（menucmds.rs:741-776）：画板排成格子（第一个不动）；moveArtwork＝中心落在某画板里的顶层物件跟着那画板搬 → {ok}'}, p => {
  const all = artboards(), n = Math.max(all.length, 1);
  const cols = Math.floor(Math.min(Math.max(num(p.columns, 2), 1), n)), spacing = Math.min(Math.max(num(p.spacing, 20), -1e5), 1e5);
  const byCol = bool(p.byColumn, false), moveArt = bool(p.moveArtwork, true);
  const rects = all.map(a => a.rect), first = rects[0];
  const origins = gridOrigins(rects.map(r => [r.x1 - r.x0, r.y1 - r.y0]), [first.x0, first.y0], cols, spacing, byCol);
  const deltas = rects.map((r, i) => [origins[i][0] - r.x0, origins[i][1] - r.y0]);
  if (moveArt){
    for (const L of Doc.layers){
      if (L.kind !== 'vector') continue;
      let moved = false;
      for (const s of L.data.shapes){
        const b = AIObj.shapeBounds(s, R3.docF(L), false); if (!b) continue;
        const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        const i = rects.findIndex(r => c[0] >= r.x0 && c[0] <= r.x1 && c[1] >= r.y0 && c[1] <= r.y1);
        if (i >= 0 && (deltas[i][0] || deltas[i][1])){ shiftShape(s, deltas[i][0], deltas[i][1]); moved = true; }
      }
      if (moved) Layer.invalidate(L);
    }
  }
  AB().extra.forEach((x, k) => { const d = deltas[k + 1]; x.rect = shiftR(x.rect, d[0], d[1]); });
  return {ok:true};
});
R3.regDialog('ai.artboard.rearrange.dialog', 'ai.artboard.rearrange', false, () => ({kind:'rearrangeArtboards', title:'ai3s.rearrange', fields:[   // dialogs/command.rs：参数对话框（spacing 是长度）
  {key:'columns', label:'ai3s.columns', type:'number', value:2}, {key:'spacing', label:'ai3s.spacing', type:'number', value:20},
  {key:'byColumn', label:'ai3s.byColumn', type:'check', value:false}, {key:'moveArtwork', label:'ai3s.moveArtwork', type:'check', value:true}],
  ok:v => CMD.run('ai.artboard.rearrange', v)}));

/* ═════ 切片 ═════ */
/* 物件切片：看得见的物件（整棵树）里带 s.slice 的，外框＝可见外框（object_slices） */
function objectSlices(){
  const out = [];
  for (const L of Doc.layers){
    if (L.kind !== 'vector' || !L.visible) continue;
    const go = arr => arr.forEach(s => { if (s.visible === false) return; if (s.slice){ const b = AIObj.shapeBounds(s, R3.docF(L), true); if (b) out.push({id:s.id, rect:b, s, L}); } if (R3.isCont(s)) go(s.children); });
    go(L.data.shapes);
  }
  return out;
}
const allObjectSliceIds = () => { const ids = []; Doc.layers.forEach(L => { if (L.kind === 'vector') R3.walk(L.data.shapes, s => { if (s.slice) ids.push(s.id); }); }); return ids; };
const userSlice = id => SL().list.find(x => x.id === id) || null;
const isSlice = id => !!userSlice(id) || !!(R3.findDeep(id) && R3.findDeep(id).s.slice);
function sliceBounds(id){ const u = userSlice(id); if (u) return clone(u.rect); const h = R3.findDeep(id); return (h && h.s.slice) ? AIObj.shapeBounds(h.s, R3.docF(h.L), true) : null; }
function sliceOptions(id){ const u = userSlice(id); if (u) return u.options; const h = R3.findDeep(id); return h && h.s.slice ? h.s.slice : null; }
const sliceIds = () => SL().list.map(x => x.id).concat(objectSlices().map(x => x.id));
/* 选中的切片：切片选取＋选中物件里是对象切片的 */
function selectedSlices(){
  const ss = R3.sliceSel.stamp === vstamp() ? R3.sliceSel.ids.filter(isSlice) : [];
  const L = VecSel.layer();
  const objs = (L && L.kind === 'vector') ? VecSel.shapes.filter(id => { const h = R3.findDeep(id, L); return h && h.s.slice; }) : [];
  return ss.concat(objs).filter((x, i, a) => a.indexOf(x) === i);
}
function setSliceSel(ids){ VecSel.clear(); if (window.AiSel) AiSel.text = []; R3.sliceSel = {ids:ids.slice(), stamp:vstamp()}; }
R3.selectedSlices = selectedSlices; R3.setSliceSel = setSliceSel; R3.sliceIds = sliceIds;
function sliceTargets(p, C){
  if (Array.isArray(p.slices)){ const bad = p.slices.find(id => !isSlice(id)); if (bad !== undefined) return {err:err(C, `${bad} is not a slice`)}; return {ids:p.slices.filter((x, i, a) => a.indexOf(x) === i)}; }
  return {ids:selectedSlices()};
}
function addSlice(r, options){ const id = uid('SL'); SL().list.push({id, rect:clone(r), options:clone(options || {})}); return id; }
function removeSlice(id){ const s = SL(); const n = s.list.length; s.list = s.list.filter(x => x.id !== id); if (s.list.length === n){ const h = R3.findDeep(id); if (h){ delete h.s.slice; Layer.invalidate(h.L); } } }
/* doc/src/slices.rs:240-315 auto_slices */
function autoSlices(region, cut){
  if (!validRect(region)) return [];
  const inside = cut.map(r => interR(region, r)).filter(validRect);
  let ys = inside.flatMap(r => [r.y0, r.y1]).concat([region.y0, region.y1]).sort((a, b) => a - b);
  ys = ys.filter((v, i) => i === 0 || Math.abs(v - ys[i - 1]) > EPS);
  let open = [], doneR = [];
  for (let k = 0; k + 1 < ys.length; k++){
    const y0 = ys[k], y1 = ys[k + 1], mid = (y0 + y1) / 2;
    const spans = inside.filter(r => r.y0 < mid && mid < r.y1).map(r => [r.x0, r.x1]).sort((a, b) => a[0] - b[0]);
    const free = []; let x = region.x0;
    for (const [a, b] of spans){ if (a - x > EPS) free.push([x, a]); x = Math.max(x, b); }
    if (region.x1 - x > EPS) free.push([x, region.x1]);
    const next = [];
    for (const [a, b] of free){
      const i = open.findIndex(r => Math.abs(r.x0 - a) <= EPS && Math.abs(r.x1 - b) <= EPS);
      if (i >= 0){ const r = open[i]; open[i] = open[open.length - 1]; open.pop(); r.y1 = y1; next.push(r); }
      else next.push({x0:a, y0, x1:b, y1});
    }
    doneR = doneR.concat(open); open = next;
  }
  return doneR.concat(open);
}
/* slice_layout：用户＋对象切片（开剪切到画板时裁到画板联集）＋自动切片，左到右上到下编号 */
function sliceLayout(){
  const s = SL(), clip = s.clip ? artboardsUnion() : null;
  const clipped = r => { if (!clip) return r; const c = interR(clip, r); return validRect(c) ? c : r; };
  const cut = s.list.map(x => ({id:x.id, source:'user', rect:clipped(x.rect)})).concat(objectSlices().map(x => ({id:x.id, source:'object', rect:clipped(x.rect)})));
  if (!cut.length) return [];
  const region = (s.clip ? artboardsUnion() : null) || cut.reduce((acc, c) => unionR(acc, c.rect), artBounds());
  const autos = region ? autoSlices(region, cut.map(c => c.rect)) : [];
  const out = cut.concat(autos.map(r => ({id:null, source:'auto', rect:r})));
  out.sort((a, b) => (a.rect.y0 - b.rect.y0) || (a.rect.x0 - b.rect.x0));
  out.forEach((a, i) => { a.number = i + 1; });
  return out;
}
R3.sliceLayout = sliceLayout;
const KINDS = ['image', 'noImage', 'htmlText'], HAL = ['default', 'left', 'center', 'right'], VAL = ['default', 'top', 'middle', 'baseline', 'bottom'];
const optionsJson = o => ({kind:o.kind || 'image', name:o.name || '', url:o.url || '', target:o.target || '', message:o.message || '', alt:o.alt || '', text:o.text || '', background:o.background || '', hAlign:o.hAlign || 'default', vAlign:o.vAlign || 'default'});
const pick = (list, v) => { const s = String(v).trim().toLowerCase(); return list.find(k => k.toLowerCase() === s) || null; };

regEdit('ai.object.slice.make', {params:'{ids?} 对象 ▸ 切片 ▸ 建立（slices.rs:280-299）：每个选中物件（或 ids）变成对象切片（切片跟着物件的可见外框）；已经是的跳过、没有新的不进历史 → {ok, ids}'}, (p, touch) => {
  const L = R3.vLayer(p); if (!L) return err('ai.object.slice.make', 'not a vector layer');
  const R = R3.roots(L, Array.isArray(p.ids) ? p.ids : null);
  const made = R.filter(s => !s.slice);
  if (!made.length) return {ok:true, ids:[]};
  touch(); made.forEach(s => { s.slice = {}; });
  return done(L, {ids:made.map(s => s.id)});
});
reg('ai.object.slice.release', {undoable:true, params:'{} 对象 ▸ 切片 ▸ 释放（slices.rs:301-327）：选中的切片——对象切片＝物件留着、拿掉切片选项；用户切片＝变成一个没上色的矩形（放在当前矢量层最上面）；结果物件选中 → {ok, ids}'}, p => {
  const tg = selectedSlices(); if (!tg.length) return err('ai.object.slice.release', 'no slice selected');
  let L = R3.vLayer({}); const out = [];
  for (const id of tg){
    const u = userSlice(id);
    if (u){
      if (!L) return {ok:false, error:'Release: no layer to put the rectangle in'};
      SL().list = SL().list.filter(x => x.id !== id);
      const s = {id:R3.newId(), type:'rect', x:u.rect.x0 - L.x, y:u.rect.y0 - L.y, w:u.rect.x1 - u.rect.x0, h:u.rect.y1 - u.rect.y0, fill:'none', stroke:'none', strokeWidth:1};
      L.data.shapes.push(s); out.push(s.id);
    } else { removeSlice(id); out.push(id); }
  }
  R3.sliceSel = {ids:[], stamp:'[]'};
  if (L){ R3.selectDeep(L, out.filter(id => R3.findDeep(id, L))); Layer.invalidate(L); }
  return {ok:true, ids:out};
});
reg('ai.object.slice.fromGuides', {undoable:true, params:'{} 对象 ▸ 切片 ▸ 从参考线创建（slices.rs:329-350）：用标尺参考线把画板联集切成格子，取代所有用户切片（两条直、两条横＝9 个）→ {ok, ids}'}, () => {
  const region = artboardsUnion(); if (!region) return {ok:false, error:'Create from Guides: the document has no artboard'};
  const G = window.AiView ? AiView.guides() : [];
  const cuts = (vertical, lo, hi) => { const v = G.filter(g => !!g.vertical === vertical && g.pos > lo && g.pos < hi).map(g => g.pos).concat([lo, hi]).sort((a, b) => a - b); return v.filter((x, i) => i === 0 || x !== v[i - 1]); };
  const xs = cuts(true, region.x0, region.x1), ys = cuts(false, region.y0, region.y1);
  const rects = []; for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++){ const r = {x0:xs[i], y0:ys[j], x1:xs[i + 1], y1:ys[j + 1]}; if (validRect(r)) rects.push(r); }
  if (rects.length > MAX_PIECES) return {ok:false, error:`Create from Guides: the guides make more than ${MAX_PIECES} slices`};
  SL().list = [];
  const ids = rects.map(r => addSlice(r, {}));
  return {ok:true, ids};
});
reg('ai.object.slice.fromSelection', {undoable:true, params:'{ids?} 对象 ▸ 切片 ▸ 从所选对象创建（slices.rs:352-363）：选中物件的可见外框做一个用户切片，选中它 → {ok, id}'}, p => {
  const t = R3.targets(p, 'object.slice.fromSelection'); if (t.err) return t.err;
  const r = R3.boundsOf(t.L, t.R, true);
  if (!sliceRectOk(r)) return {ok:false, error:'Create from Selection: the selection has no area'};
  const id = addSlice(r, {}); setSliceSel([id]);
  return {ok:true, id};
});
reg('ai.object.slice.duplicate', {undoable:true, params:'{dx?=10, dy?=10} 对象 ▸ 切片 ▸ 复制切片（slices.rs:365-381）：选中的切片复制成用户切片（带选项）、位移 dx,dy；复制品选中 → {ok, ids}'}, p => {
  const tg = selectedSlices(); if (!tg.length) return err('ai.object.slice.duplicate', 'no slice selected');
  const dx = num(p.dx, 10), dy = num(p.dy, 10), out = [];
  for (const id of tg){
    const r = sliceBounds(id), o = sliceOptions(id); if (!r || !o) continue;
    const r2 = shiftR(r, dx, dy); if (!sliceRectOk(r2)) return err('ai.object.slice.duplicate', 'the copy would leave the canvas');
    out.push(addSlice(r2, o));
  }
  setSliceSel(out); return {ok:true, ids:out};
});
reg('ai.object.slice.combine', {undoable:true, params:'{} 对象 ▸ 切片 ▸ 组合切片（slices.rs:383-402）：两个以上选中的切片换成一个盖住它们外框的用户切片（用第一个的选项；对象切片释放）→ {ok, id}'}, () => {
  const tg = selectedSlices(); if (tg.length < 2) return err('ai.object.slice.combine', 'select two or more slices to combine');
  const r = tg.map(sliceBounds).filter(Boolean).reduce(unionR, null); if (!r) return {ok:false, error:'Combine Slices: the slices have no bounds'};
  const o = clone(sliceOptions(tg[0]) || {});
  tg.forEach(removeSlice);
  const id = addSlice(r, o); setSliceSel([id]);
  return {ok:true, id};
});
/* slices.rs:404-425 splits */
function splits(lo, hi, count, size){
  const len = hi - lo; let n;
  if (count !== null) n = count;
  else if (size !== null){ if (!(isFinite(size) && size > 0)) return 'a slice size must be a positive number of points'; n = Math.min(Math.max(Math.ceil(len / size - 1e-9), 1), MAX_PIECES + 1); }
  else n = 1;
  if (n === 0 || n > MAX_PIECES) return `divide into 1 to ${MAX_PIECES} slices`;
  const step = (count === null && size !== null) ? size : len / n;
  const out = []; for (let i = 0; i <= n; i++) out.push(i === n ? hi : lo + step * i);
  return out;
}
reg('ai.object.slice.divide', {undoable:true, params:'{rows?: 往下切几个, rowHeight?: 每个高, columns?: 横向切几个, columnWidth?: 每个宽} 对象 ▸ 切片 ▸ 划分切片…（slices.rs:427-458）：选中的每个切片切成格子用户切片（按数量平均、或按大小最后一个较小；对象切片释放；只有第一块留名字）；切出来的选中 → {ok, ids}'}, p => {
  const C = 'ai.object.slice.divide';
  const tg = selectedSlices(); if (!tg.length) return err(C, 'no slice selected');
  const cnt = k => { if (p[k] === undefined || p[k] === null) return {v:null}; const v = +p[k]; return (Number.isInteger(v) && v >= 0) ? {v} : {e:`\`${k}\` must be a whole number`}; };
  const siz = k => { if (p[k] === undefined || p[k] === null) return {v:null}; const v = +p[k]; return isFinite(v) ? {v} : {e:`\`${k}\` must be a number of points`}; };
  const rows = cnt('rows'), rowH = siz('rowHeight'), cols = cnt('columns'), colW = siz('columnWidth');
  for (const x of [rows, rowH, cols, colW]) if (x.e) return err(C, x.e);
  if (rows.v === null && rowH.v === null && cols.v === null && colW.v === null) return err(C, 'give rows, rowHeight, columns or columnWidth');
  const out = [];
  for (const id of tg){
    const r = sliceBounds(id), o = sliceOptions(id); if (!r || !o) continue;
    const ys = splits(r.y0, r.y1, rows.v, rowH.v), xs = splits(r.x0, r.x1, cols.v, colW.v);
    if (typeof ys === 'string') return err(C, ys); if (typeof xs === 'string') return err(C, xs);
    if ((ys.length - 1) * (xs.length - 1) + out.length > MAX_PIECES) return err(C, `that makes more than ${MAX_PIECES} slices`);
    const oc = clone(o); removeSlice(id);
    let k = 0;
    for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++){
      const oo = k === 0 ? clone(oc) : Object.assign(clone(oc), {name:''}); k++;
      out.push(addSlice({x0:xs[i], y0:ys[j], x1:xs[i + 1], y1:ys[j + 1]}, oo));
    }
  }
  setSliceSel(out); return {ok:true, ids:out};
});
reg('ai.object.slice.deleteAll', {undoable:true, params:'{} 对象 ▸ 切片 ▸ 全部删除（slices.rs:460-472）：删掉所有用户切片、释放所有对象切片 → {ok, count}'}, () => {
  const objs = allObjectSliceIds(), n = SL().list.length + objs.length;
  if (!n) return {ok:false, error:'the document has no slices'};
  SL().list = []; objs.forEach(removeSlice);
  return {ok:true, count:n};
});
regEdit('ai.object.slice.options', {params:'{kind?: "image"|"noImage"|"htmlText"（只给文字物件的对象切片）, name?, url?, target?, message?, alt?（图像）, text?（无图像：单元格文字，可含 HTML）, background?: ""|"matte"|"#rrggbb", hAlign?: "default"|"left"|"center"|"right", vAlign?: "default"|"top"|"middle"|"baseline"|"bottom"} 对象 ▸ 切片 ▸ 切片选项…（slices.rs:476-566）：设选中切片的选项（一步历史）；什么都不给＝只读 → 第一个切片的选项 {kind,name,url,target,message,alt,text,background,hAlign,vAlign,htmlText}'}, (p, touch) => {
  const C = 'ai.object.slice.options';
  const tg = selectedSlices(); if (!tg.length) return err(C, 'no slice selected');
  const e = {};
  if (p.kind !== undefined){ const k = pick(KINDS, p.kind) || ({'no image':'noImage', 'html text':'htmlText'})[String(p.kind).trim().toLowerCase()]; if (!k) return err(C, '`kind` must be image, noImage or htmlText'); e.kind = k; }
  if (p.hAlign !== undefined){ const k = pick(HAL, p.hAlign); if (!k) return err(C, '`hAlign` must be default, left, center or right'); e.hAlign = k; }
  if (p.vAlign !== undefined){ const k = pick(VAL, p.vAlign); if (!k) return err(C, '`vAlign` must be default, top, middle, baseline or bottom'); e.vAlign = k; }
  if (p.background !== undefined){
    const b = String(p.background).trim(), lb = b.toLowerCase();
    if (lb === '' || lb === 'none') e.background = ''; else if (lb === 'matte') e.background = 'matte';
    else if (/^#?[0-9a-f]{6}$/i.test(b)) e.background = '#' + b.replace('#', '').toLowerCase(); else return err(C, '`background` must be "", "matte" or #rrggbb');
  }
  for (const k of ['name', 'url', 'target', 'message', 'alt', 'text']){
    if (p[k] === undefined) continue;
    if (typeof p[k] !== 'string') return err(C, `\`${k}\` must be a string`);
    e[k] = ['text', 'alt', 'message'].includes(k) ? p[k] : p[k].trim();
  }
  // HTML 文字只给文字物件的对象切片（我们的文字物件是文字层，不能当对象切片 ⇒ 永远不行）
  const htmlOk = () => tg.every(id => { const h = R3.findDeep(id); return !userSlice(id) && h && h.s.type === 'text'; });
  if (e.kind === 'htmlText' && !htmlOk()) return err(C, 'HTML Text applies to object slices of type only');
  if (Object.keys(e).length){ touch(); tg.forEach(id => { const o = sliceOptions(id); if (o) Object.assign(o, e); }); }   // 只读＝不进历史
  const o = optionsJson(sliceOptions(tg[0]) || {});
  return Object.assign({ok:true}, o, {htmlText:htmlOk()});
});
regEdit('ai.object.slice.clipToArtboard', {params:'{on?: bool} 对象 ▸ 切片 ▸ 剪切到画板（slices.rs:568-577；预设开）：开＝切片裁到画板、自动切片填满画板；关＝自动切片盖住图稿与切片；有改才进历史 → {ok, on}'}, (p, touch) => {
  const s = SL(), on = typeof p.on === 'boolean' ? p.on : !s.clip;
  if (on !== s.clip){ touch(); SL().clip = on; }
  return {ok:true, on};
});
reg('ai.object.slice.list', {params:'{} 切片清单（slice.list，排好编号的版面）→ {ok, slices:[{number, id|null, source:"user"|"object"|"auto", name, x, y, width, height, options, selected}], clipToArtboard, hidden, locked}'}, () => {
  const sel = selectedSlices();
  return {ok:true, slices:sliceLayout().map(a => ({number:a.number, id:a.id, source:a.source, name:(a.id && sliceOptions(a.id) && sliceOptions(a.id).name) || `Untitled_${String(a.number).padStart(2, '0')}`,
    x:a.rect.x0, y:a.rect.y0, width:a.rect.x1 - a.rect.x0, height:a.rect.y1 - a.rect.y0, options:optionsJson((a.id && sliceOptions(a.id)) || {}), selected:!!a.id && sel.includes(a.id)})),
    clipToArtboard:SL().clip, hidden:!!(window.AiView && AiView.flags.slicesHidden), locked:!!(window.AiView && AiView.flags.slicesLocked)};
});
reg('ai.object.slice.create', {undoable:true, params:'{x, y, width, height} 一个用户切片（切片工具拖出来的那一下），选中它 → {ok, id}'}, p => {
  const x = +p.x, y = +p.y, r = rect(x, y, x + (+p.width), y + (+p.height));
  if (!sliceRectOk(r)) return err('ai.object.slice.create', 'the rectangle needs a size and must lie on the canvas');
  const id = addSlice(r, {}); setSliceSel([id]); return {ok:true, id};
});
reg('ai.object.slice.setRect', {undoable:true, params:'{id: 用户切片, x, y, width, height} 移动／改大小一个用户切片 → {ok, id}'}, p => {
  const u = userSlice(p.id); if (!u) return err('ai.object.slice.setRect', `${p.id} is not a user slice`);
  const x = +p.x, y = +p.y, r = rect(x, y, x + (+p.width), y + (+p.height));
  if (!sliceRectOk(r)) return err('ai.object.slice.setRect', 'the rectangle needs a size and must lie on the canvas');
  u.rect = r; return {ok:true, id:u.id};
});
reg('ai.object.slice.move', {undoable:true, params:'{slices?: [id…]（缺省＝选中的切片）, dx, dy} 移动切片：用户切片移动、对象切片移动它的物件 → {ok, ids}'}, p => {
  const t = sliceTargets(p, 'ai.object.slice.move'); if (t.err) return t.err;
  const dx = num(p.dx, 0), dy = num(p.dy, 0);
  for (const id of t.ids){ const u = userSlice(id); if (u) u.rect = shiftR(u.rect, dx, dy); else { const h = R3.findDeep(id); if (h){ shiftShape(h.s, dx, dy); Layer.invalidate(h.L); } } }
  return {ok:true, ids:t.ids};
});
reg('ai.object.slice.delete', {undoable:true, params:'{slices?: [id…]（缺省＝选中的切片）} 删掉用户切片、释放对象切片（物件留着）→ {ok, count}'}, p => {
  const t = sliceTargets(p, 'ai.object.slice.delete'); if (t.err) return t.err;
  t.ids.forEach(removeSlice); R3.sliceSel = {ids:[], stamp:'[]'};
  return {ok:true, count:t.ids.length};
});
reg('ai.object.slice.select', {params:'{slices?: [id…]（不给＝取消切片选取）, toggle?: bool（Shift：没选的加上、选了的拿掉）} 像切片选择工具那样选切片；物件选取清掉 → {ok, selected}'}, p => {
  const t = sliceTargets(p, 'ai.object.slice.select'); if (t.err) return t.err;
  let ids = Array.isArray(p.slices) ? t.ids : [];
  if (p.toggle){ const cur = selectedSlices(); ids = cur.filter(x => !ids.includes(x)).concat(ids.filter(x => !cur.includes(x))); }
  setSliceSel(ids); return {ok:true, selected:ids.slice()};
});
/* 对话框：切片选项…（dialogs/slices.rs:46-130）、划分切片…（:30-44, 132-189） */
R3.reg('ai.object.slice.options.dialog', {params:'{} 开「切片选项」对话框（确定＝ai.object.slice.options）→ {ok, dialog}'}, () => {
  const o = CMD.map['ai.object.slice.options'].run({}); if (!o || o.ok === false) return o;
  const kinds = [['image', 'ai3s.kImage'], ['noImage', 'ai3s.kNoImage']].concat(o.htmlText ? [['htmlText', 'ai3s.kHtml']] : []);
  const bgv = ({'':'none', matte:'matte', '#ffffff':'white', '#000000':'black'})[o.background] || 'other';
  R3.form('sliceOptions', 'ai3s.optTitle', [
    {key:'kind', label:'ai3s.kind', type:'select', value:o.kind, options:kinds},
    {key:'name', label:'ai3s.name', type:'text', value:o.name}, {key:'url', label:'ai3s.url', type:'text', value:o.url}, {key:'target', label:'ai3s.target', type:'text', value:o.target},
    {key:'message', label:'ai3s.message', type:'text', value:o.message}, {key:'alt', label:'ai3s.alt', type:'text', value:o.alt},
    {key:'text', label:'ai3s.cellText', type:'textarea', value:o.text},
    {key:'hAlign', label:'ai3s.hAlign', type:'select', value:o.hAlign, options:HAL.map(k => [k, 'ai3s.a.' + k])},
    {key:'vAlign', label:'ai3s.vAlign', type:'select', value:o.vAlign, options:VAL.map(k => [k, 'ai3s.a.' + k])},
    {key:'bg', label:'ai3s.background', type:'select', value:bgv, options:[['none', 'ai3s.bNone'], ['matte', 'ai3s.bMatte'], ['white', 'ai3s.bWhite'], ['black', 'ai3s.bBlack'], ['other', 'ai3s.bOther']]},
    {key:'bgColor', label:'ai3s.bColor', type:'color', value:/^#[0-9a-f]{6}$/i.test(o.background) ? o.background : '#808080'}
  ], v => {
    const bg = ({none:'', matte:'matte', white:'#ffffff', black:'#000000'})[v.bg];
    const q = {kind:v.kind, hAlign:v.hAlign, vAlign:v.vAlign, background:bg === undefined ? v.bgColor : bg};
    if (v.kind === 'image') Object.assign(q, {name:v.name, url:v.url, target:v.target, message:v.message, alt:v.alt}); else if (v.kind === 'noImage') q.text = v.text;
    return CMD.run('ai.object.slice.options', q);
  });
  return {ok:true, dialog:'sliceOptions'};
});
R3.reg('ai.object.slice.divide.dialog', {params:'{} 开「划分切片」对话框（确定＝ai.object.slice.divide）→ {ok, dialog}'}, () => {
  const tg = selectedSlices(); if (!tg.length) return err('ai.object.slice.divide', 'no slice selected');
  const r = sliceBounds(tg[0]), w = r ? (r.x1 - r.x0) / 2 : 50, h = r ? (r.y1 - r.y0) / 2 : 50;
  R3.form('divideSlices', 'ai3s.divTitle', [
    {key:'divideRows', label:'ai3s.divRows', type:'check', value:true},
    {key:'rowMode', type:'radio', value:'count', options:[['count', 'ai3s.byCount'], ['size', 'ai3s.bySize']]},
    {key:'rows', label:'ai3s.rows', type:'number', value:2}, {key:'rowHeight', label:'ai3s.perSlice', type:'number', value:h},
    {key:'divideColumns', label:'ai3s.divCols', type:'check', value:true},
    {key:'columnMode', type:'radio', value:'count', options:[['count', 'ai3s.byCount'], ['size', 'ai3s.bySize']]},
    {key:'columns', label:'ai3s.columns', type:'number', value:2}, {key:'columnWidth', label:'ai3s.perSlice', type:'number', value:w}
  ], v => {
    const q = {};
    if (v.divideRows){ if (v.rowMode === 'size') q.rowHeight = v.rowHeight; else q.rows = Math.max(1, Math.round(v.rows)); }
    if (v.divideColumns){ if (v.columnMode === 'size') q.columnWidth = v.columnWidth; else q.columns = Math.max(1, Math.round(v.columns)); }
    if (!Object.keys(q).length) return {ok:false, error:'choose a direction to divide in'};
    return CMD.run('ai.object.slice.divide', q);
  });
  return {ok:true, dialog:'divideSlices'};
});

/* ═════ 收集以导出（assets.rs） ═════ */
const MAX_NAME = 255;
const cleanName = n => { const s = String(n || '').trim().slice(0, MAX_NAME); return s || null; };
function assetName(){ const base = {'zh-Hant':'資產 ', 'zh-Hans':'资源 ', en:'Asset '}[window.Lang && Lang.cur] || 'Asset '; const a = AS(); let i = 1; while (a.list.some(x => x.name === base + i)) i++; return base + i; }
reg('ai.assets.add', {params:'{ids?: [id…]（缺省＝选中物件）, multiple?: true（每个物件一个资源；false＝全部一个）, name?（只做一个资源时）} 对象 ▸ 收集以导出 ▸ 作为单个／多个资源（assets.rs:81-125）：已收过同一组物件的不重复（全都收过＝不进历史）→ {ok, assets:[资源 id…], added}'}, p => {
  const C = 'ai.assets.add';
  const L = R3.vLayer(p); const R = L ? R3.roots(L, Array.isArray(p.ids) ? p.ids : null) : [];
  if (!R.length) return err(C, 'select the art to collect (or give its ids)');
  const ids = R.map(s => s.id), name = p.name !== undefined ? cleanName(p.name) : null;
  const sets = bool(p.multiple, true) ? ids.map(id => [id]) : [ids];
  if (name && sets.length > 1) return err(C, 'a name names one asset: give multiple: false, or one object');
  const a = AS(), existing = nodes => { const x = a.list.find(v => JSON.stringify(v.nodes) === JSON.stringify(nodes)); return x ? x.id : null; };
  if (sets.every(s => existing(s) !== null)) return {ok:true, assets:sets.map(existing), added:0};
  History.push();
  const out = []; let added = 0;
  for (const nodes of sets){
    const e = existing(nodes); if (e !== null){ out.push(e); continue; }
    const own = nodes.length === 1 ? cleanName((L.data.shapes.find(s => s.id === nodes[0]) || {}).name) : null;
    const id = AS().next++;
    AS().list.push({id, name:name || own || assetName(), nodes, layerId:L.id});
    out.push(id); added++;
  }
  return {ok:true, assets:out, added};
});
const assetNodes = x => x.nodes.map(id => R3.findDeep(id)).filter(Boolean);
reg('ai.assets.list', {params:'{} 资源导出面板的资源 → {ok, assets:[{id, name, nodes, bounds:[x,y,w,h]|null}]}'}, () => ({ok:true, assets:AS().list.map(x => {
  const b = assetNodes(x).map(h => AIObj.shapeBounds(h.s, R3.docF(h.L), true)).reduce(unionR, null);
  return {id:x.id, name:x.name, nodes:x.nodes.filter(id => R3.findDeep(id)), bounds:b ? [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0] : null};
})}));
reg('ai.assets.remove', {undoable:true, params:'{assets:[资源 id…]} 从资源导出面板拿掉资源（物件留着）→ {ok, removed}'}, p => {
  const ids = Array.isArray(p.assets) ? p.assets.map(Number) : null; if (!ids) return err('ai.assets.remove', '`assets` must be an array of asset ids (see ai.assets.list)');
  const n = AS().list.filter(x => ids.includes(x.id)).length; if (!n) return err('ai.assets.remove', 'no such assets (see ai.assets.list)');
  AS().list = AS().list.filter(x => !ids.includes(x.id)); return {ok:true, removed:n};
});
reg('ai.assets.rename', {undoable:true, params:'{asset: id, name} 资源改名 → {ok}'}, p => {
  const x = AS().list.find(v => v.id === +p.asset); if (!x) return err('ai.assets.rename', `no asset ${p.asset}`);
  const n = cleanName(p.name); if (!n) return err('ai.assets.rename', 'give the asset a name');
  x.name = n; return {ok:true};
});
/* 一个资源单独画、裁到它的外框 → canvas */
function renderAsset(x, scale){
  const hs = assetNodes(x); if (!hs.length) return null;
  const b = hs.map(h => AIObj.shapeBounds(h.s, R3.docF(h.L), true)).reduce(unionR, null); if (!b) return null;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil((b.x1 - b.x0) * scale)); c.height = Math.max(1, Math.ceil((b.y1 - b.y0) * scale));
  const ctx = c.getContext('2d');
  for (const h of hs){ ctx.save(); ctx.translate((h.L.x - b.x0) * scale, (h.L.y - b.y0) * scale); drawShape(ctx, h.s, scale); ctx.restore(); }
  return c;
}
R3.renderAsset = renderAsset;
reg('ai.assets.export', {params:'{assets?: [资源 id…]（缺省全部）, scale?=1, render?: bool（true＝不下载、回 dataURL 给 agent 看）} 导出资源（assets.rs:198-213 assets.export）：每个资源单独画、裁到它的外框，各存一张 PNG（档名＝资源名）。🔴 网站版要覆写这条（存进云盘）→ {ok, files:[{name, width, height, dataURL?}]}'}, p => {
  const all = AS().list; if (!all.length) return err('ai.assets.export', 'no assets yet: collect art for export first (ai.assets.add)');
  const ids = Array.isArray(p.assets) ? p.assets.map(Number) : all.map(x => x.id), scale = Math.max(0.01, num(p.scale, 1));
  const files = [];
  for (const x of all.filter(v => ids.includes(v.id))){
    const c = renderAsset(x, scale); if (!c) continue;
    const f = {name:x.name + '.png', width:c.width, height:c.height};
    if (p.render) f.dataURL = c.toDataURL('image/png');
    else c.toBlob(b => { if (b && typeof download === 'function') download(b, f.name); }, 'image/png');
    files.push(f);
  }
  return {ok:true, files};
});

Lang.add({
  'zh-Hant':{'ai3s.rearrange':'重新排列所有工作區域', 'ai3s.columns':'欄數', 'ai3s.spacing':'間距', 'ai3s.byColumn':'依欄排列', 'ai3s.moveArtwork':'隨工作區域移動圖稿',
    'ai3s.optTitle':'切片選項', 'ai3s.kind':'切片類型', 'ai3s.kImage':'影像', 'ai3s.kNoImage':'無影像', 'ai3s.kHtml':'HTML 文字', 'ai3s.name':'名稱', 'ai3s.url':'URL', 'ai3s.target':'目標', 'ai3s.message':'訊息', 'ai3s.alt':'替代文字',
    'ai3s.cellText':'顯示在儲存格中的文字', 'ai3s.hAlign':'水平', 'ai3s.vAlign':'垂直', 'ai3s.background':'背景', 'ai3s.bNone':'無', 'ai3s.bMatte':'邊緣調合', 'ai3s.bWhite':'白色', 'ai3s.bBlack':'黑色', 'ai3s.bOther':'其他', 'ai3s.bColor':'其他顏色',
    'ai3s.a.default':'預設', 'ai3s.a.left':'左', 'ai3s.a.center':'中', 'ai3s.a.right':'右', 'ai3s.a.top':'上', 'ai3s.a.middle':'中央', 'ai3s.a.baseline':'基線', 'ai3s.a.bottom':'下',
    'ai3s.divTitle':'分割切片', 'ai3s.divRows':'水平分割為', 'ai3s.divCols':'垂直分割為', 'ai3s.byCount':'個切片，平均分配', 'ai3s.bySize':'每個切片的大小', 'ai3s.rows':'向下切片數', 'ai3s.perSlice':'每片', },
  'zh-Hans':{'ai3s.rearrange':'重新排列所有画板', 'ai3s.columns':'列数', 'ai3s.spacing':'间距', 'ai3s.byColumn':'按列排列', 'ai3s.moveArtwork':'随画板移动图稿',
    'ai3s.optTitle':'切片选项', 'ai3s.kind':'切片类型', 'ai3s.kImage':'图像', 'ai3s.kNoImage':'无图像', 'ai3s.kHtml':'HTML 文本', 'ai3s.name':'名称', 'ai3s.url':'URL', 'ai3s.target':'目标', 'ai3s.message':'信息', 'ai3s.alt':'替代文本',
    'ai3s.cellText':'显示在单元格中的文本', 'ai3s.hAlign':'水平', 'ai3s.vAlign':'垂直', 'ai3s.background':'背景', 'ai3s.bNone':'无', 'ai3s.bMatte':'杂边', 'ai3s.bWhite':'白色', 'ai3s.bBlack':'黑色', 'ai3s.bOther':'其它', 'ai3s.bColor':'其它颜色',
    'ai3s.a.default':'默认', 'ai3s.a.left':'左', 'ai3s.a.center':'居中', 'ai3s.a.right':'右', 'ai3s.a.top':'顶部', 'ai3s.a.middle':'中间', 'ai3s.a.baseline':'基线', 'ai3s.a.bottom':'底部',
    'ai3s.divTitle':'划分切片', 'ai3s.divRows':'水平划分为', 'ai3s.divCols':'垂直划分为', 'ai3s.byCount':'个纵向切片，均匀分隔', 'ai3s.bySize':'像素／切片', 'ai3s.rows':'切片数', 'ai3s.perSlice':'每片大小'},
  en:{'ai3s.rearrange':'Rearrange All Artboards', 'ai3s.columns':'Columns', 'ai3s.spacing':'Spacing', 'ai3s.byColumn':'Arrange By Column', 'ai3s.moveArtwork':'Move Artwork with Artboard',
    'ai3s.optTitle':'Slice Options', 'ai3s.kind':'Slice Type', 'ai3s.kImage':'Image', 'ai3s.kNoImage':'No Image', 'ai3s.kHtml':'HTML Text', 'ai3s.name':'Name', 'ai3s.url':'URL', 'ai3s.target':'Target', 'ai3s.message':'Message', 'ai3s.alt':'Alt',
    'ai3s.cellText':'Text Displayed in Cell', 'ai3s.hAlign':'Horizontal', 'ai3s.vAlign':'Vertical', 'ai3s.background':'Background', 'ai3s.bNone':'None', 'ai3s.bMatte':'Matte', 'ai3s.bWhite':'White', 'ai3s.bBlack':'Black', 'ai3s.bOther':'Other', 'ai3s.bColor':'Other color',
    'ai3s.a.default':'Default', 'ai3s.a.left':'Left', 'ai3s.a.center':'Center', 'ai3s.a.right':'Right', 'ai3s.a.top':'Top', 'ai3s.a.middle':'Middle', 'ai3s.a.baseline':'Baseline', 'ai3s.a.bottom':'Bottom',
    'ai3s.divTitle':'Divide Slices', 'ai3s.divRows':'Divide Horizontally Into', 'ai3s.divCols':'Divide Vertically Into', 'ai3s.byCount':'slices, evenly spaced', 'ai3s.bySize':'size per slice', 'ai3s.rows':'Slices', 'ai3s.perSlice':'per slice'}
});
})();

/*对象 ▸ 重复（径向／网格／镜像／释放／选项…）：照 VectorCraft 原码
     engine/src/cmd/patterncmds.rs:91-140（登记）、617-801 make_repeat／repeat_radial／grid／mirror／release／expand／options
     doc/src/pattern.rs:357-520  RepeatKind（Radial{instances,radius,center,reverseOverlap,startAngle,endAngle}／Grid{hSpacing,vSpacing,rows,cols,gridType,flipRows,flipCols}／Mirror{angle,center}）、
                                 reflect_about、repeat_transforms（每个副本的仿射）、RepeatSpec::radial（中心在来源下方、半径＝来源宽高较大者×1.2 至少 10）／grid（间距＝来源宽高的 ¼、3×3）／mirror（轴在来源右边 offset 处）
     doc/src/pattern.rs:44-160   TileType（网格／砖形按行／按列／六边形按列／按行）与 tile_offset
     doc/src/live.rs:1015        nodes_bounds（来源的几何外框联集）
     ui-egui/src/menus.rs:2248-2255、panels/pattern_options.rs:197-214  选项…＝参数对话框（照选中重复的种类给栏位）
   资料：{type:'group', live:'repeat', children:[来源物件…, 辅助路径], repeat:{kind, …}}
     辅助路径（看不见）存会跟着变换走的参数：径向＝[中心, 中心+(半径,0)]、镜像＝[轴上一点, 轴上一点+轴方向]、网格＝[原点, 原点+(1,0)]（量缩放倍数，间距跟着缩，同 RepeatSpec::transform）。
     画的时候现算副本（来源改了副本跟着变，同原码「evaluated on demand」）；释放＝放回来源物件。 */
(function(){
'use strict';
if (window.__aiR3_repeat) return; window.__aiR3_repeat = true;
const R3 = window.AiR3, A = AIObj.A, {num, bool, reg, done, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const center = b => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const frac = v => v - Math.floor(v);
/* pattern.rs:120-133 tile_offset */
function tileOffset(gt, w, h, i, j){
  const t = gt && gt.type || 'grid', o = gt && typeof gt.offset === 'number' ? gt.offset : 0.5;
  if (t === 'brickByRow') return [i * w + frac(j * o) * w, j * h];
  if (t === 'brickByColumn') return [i * w, j * h + frac(i * o) * h];
  if (t === 'hexByColumn') return [i * w * 0.75, j * h + (((i % 2) + 2) % 2 === 1 ? h / 2 : 0)];
  if (t === 'hexByRow') return [i * w + (((j % 2) + 2) % 2 === 1 ? w / 2 : 0), j * h * 0.75];
  return [i * w, j * h];
}
const TILE_IDS = ['grid', 'brickByRow', 'brickByColumn', 'hexByColumn', 'hexByRow'];
function parseTile(s, offset){
  const k = String(s).toLowerCase().replace(/[-_ ]/g, ''), o = typeof offset === 'number' && isFinite(offset) ? offset : 0.5;
  if (k === 'grid') return {type:'grid'};
  if (['brickbyrow', 'brickrow', 'brick'].includes(k)) return {type:'brickByRow', offset:o};
  if (['brickbycolumn', 'brickcolumn', 'brickcol'].includes(k)) return {type:'brickByColumn', offset:o};
  if (['hexbycolumn', 'hexcolumn', 'hexcol', 'hex'].includes(k)) return {type:'hexByColumn'};
  if (['hexbyrow', 'hexrow'].includes(k)) return {type:'hexByRow'};
  return null;
}
R3.tileOffset = tileOffset; R3.parseTile = parseTile; R3.TILE_IDS = TILE_IDS;
/* pattern.rs:418-423 reflect_about：过 c、方向角 deg 的直线 */
function reflectAbout(c, deg){
  const t = 2 * deg * Math.PI / 180, s2 = Math.sin(t), c2 = Math.cos(t);
  return A.mul(A.translate(c[0], c[1]), A.mul([c2, s2, s2, -c2, 0, 0], A.translate(-c[0], -c[1])));
}
R3.reflectAbout = reflectAbout;
/* 从辅助路径读回会变换的参数 */
function params(s){
  const r = s.repeat, h = R3.helperOf(s), P = h && h.points ? h.points : null;
  if (r.kind === 'radial'){ const c = P ? P[0] : [0, 0]; return Object.assign({}, r, {center:c, radius:P ? Math.hypot(P[1][0] - c[0], P[1][1] - c[1]) : 0}); }
  if (r.kind === 'mirror'){ const c = P ? P[0] : [0, 0], d = P ? [P[1][0] - c[0], P[1][1] - c[1]] : [0, 1]; return Object.assign({}, r, {center:c, angle:Math.atan2(d[1], d[0]) * 180 / Math.PI}); }
  const k = P ? Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) : 1;
  return Object.assign({}, r, {hSpacing:r.hSpacing0 * k, vSpacing:r.vSpacing0 * k, scale:k});
}
/* pattern.rs:426-474 repeat_transforms（来源空间 → 文件；我们是图层坐标），按绘制顺序 */
function transforms(s){
  const b = R3.geoBounds(R3.kidsOf(s)) || {x0:0, y0:0, x1:1, y1:1}, q = params(s);
  if (q.kind === 'radial'){
    const n = Math.min(Math.max(Math.floor(q.instances), 1), 1000), c0 = center(b);
    let d = [c0[0] - q.center[0], c0[1] - q.center[1]];
    if (Math.hypot(d[0], d[1]) < 1e-9) d = [0, -1];
    const dl = Math.hypot(d[0], d[1]), r = Math.max(q.radius, 0);
    const pre = A.translate(q.center[0] + d[0] / dl * r - c0[0], q.center[1] + d[1] / dl * r - c0[1]);
    const sweep = q.endAngle - q.startAngle, full = Math.abs(Math.abs(sweep) - 360) < 1e-9;
    const step = (full || n === 1) ? sweep / n : sweep / (n - 1);
    const v = [];
    for (let k = 0; k < n; k++){ const a = (q.startAngle + step * k) * Math.PI / 180; v.push(A.mul(A.about(q.center, A.rotate(a)), pre)); }
    if (q.reverseOverlap) v.reverse();
    return v;
  }
  if (q.kind === 'grid'){
    const w = Math.max(b.x1 - b.x0 + q.hSpacing, 1e-3), h = Math.max(b.y1 - b.y0 + q.vSpacing, 1e-3), c = center(b), v = [];
    for (let j = 0; j < Math.min(Math.max(q.rows, 1), 500); j++) for (let i = 0; i < Math.min(Math.max(q.cols, 1), 500); i++){
      const o = tileOffset(q.gridType, w, h, i, j);
      let flip = A.I;
      if (q.flipCols && i % 2 === 1) flip = A.mul(reflectAbout(c, 90), flip);
      if (q.flipRows && j % 2 === 1) flip = A.mul(reflectAbout(c, 0), flip);
      v.push(A.mul(A.translate(o[0], o[1]), flip));
    }
    return v;
  }
  return [A.I, reflectAbout(q.center, q.angle)];
}
R3.repeatTransforms = transforms;
R3.live.repeat = {
  draw(ctx, s, S){ const src = R3.kidsOf(s); for (const m of transforms(s)) for (const c of src) R3.drawXf(ctx, c, m, S); },
  svg(s){ const src = R3.kidsOf(s); return '<g>' + transforms(s).map(m => `<g transform="${R3.SVGM(m)}">${src.map(c => ObjRender.toSVG(c)).join('')}</g>`).join('') + '</g>'; }
};
/* 来源 → 新的重复（RepeatSpec::radial／grid／mirror 的预设） */
function makeSpec(kind, src, p){
  const b = R3.geoBounds(src) || {x0:0, y0:0, x1:10, y1:10}, c = center(b);
  if (kind === 'radial'){
    const r = (p.radius !== undefined && isFinite(+p.radius) && +p.radius >= 0) ? +p.radius : Math.max(Math.max(b.y1 - b.y0, b.x1 - b.x0) * 1.2, 10);
    const C = [c[0], c[1] + r];
    return {spec:{kind:'radial', instances:Math.floor(num(p.instances, 8)), reverseOverlap:false, startAngle:0, endAngle:360}, helper:[C, [C[0] + r, C[1]]]};
  }
  if (kind === 'grid'){
    const hs = num(p.hSpacing, (b.x1 - b.x0) / 4), vs = num(p.vSpacing, (b.y1 - b.y0) / 4);
    const rows = p.rows !== undefined ? Math.min(Math.max(Math.floor(+p.rows), 1), 500) : 3, cols = p.cols !== undefined ? Math.min(Math.max(Math.floor(+p.cols), 1), 500) : 3;
    return {spec:{kind:'grid', hSpacing0:hs, vSpacing0:vs, rows, cols, gridType:{type:'grid'}, flipRows:false, flipCols:false}, helper:[[b.x0, b.y0], [b.x0 + 1, b.y0]]};
  }
  const ang = num(p.angle, 90), off = num(p.offset, 10), C = [b.x1 + off, c[1]], t = ang * Math.PI / 180;
  return {spec:{kind:'mirror'}, helper:[C, [C[0] + Math.cos(t), C[1] + Math.sin(t)]]};
}
const isRepeat = s => !!s && s.type === 'group' && s.live === 'repeat';
function selectedRepeats(){
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return {L:null, R:[]};
  return {L, R:R3.roots(L, null).filter(isRepeat)};
}
/* patterncmds.rs:617-648 make_repeat：选中正好一个重复＝换种类；否则把选中物件收成新的重复（放在最上面那个的位置） */
function makeRepeat(C, kind, p){
  const ex = selectedRepeats();
  if (!Array.isArray(p.ids) && ex.R.length === 1){
    const s = ex.R[0], src = R3.kidsOf(s), m = makeSpec(kind, src, p);
    s.repeat = m.spec; const h = R3.helperOf(s); h.points = m.helper;
    return done(ex.L, {id:s.id});
  }
  const t = R3.targets(p, C); if (t.err) return {ok:false, error:'select the art to repeat'};
  const L = t.L, S = L.data.shapes, top = t.R[t.R.length - 1], idx = S.indexOf(top);
  const src = t.R.map(s => s), m = makeSpec(kind, src, p);
  const g = {id:R3.newId(), type:'group', live:'repeat', children:src.concat([R3.mkHelper(m.helper)]), repeat:m.spec};
  S.splice(idx + 1, 0, g);
  L.data.shapes = S.filter(s => !t.R.includes(s));
  R3.selectIds(L, [g.id]);
  return done(L, {id:g.id});
}
reg('ai.object.repeat.radial', {undoable:true, params:'{ids?, instances?: 个数 (8，1..1000), radius?: 半径} 对象 ▸ 重复 ▸ 径向（patterncmds.rs:650-657）：选取变成径向重复（选中一个重复＝改成径向）→ {ok, id}'}, p => {
  const n = num(p.instances, 8); if (!(n >= 1 && n <= 1000)) return err('ai.object.repeat.radial', 'instances must be 1..1000');
  return makeRepeat('ai.object.repeat.radial', 'radial', p);
});
reg('ai.object.repeat.grid', {undoable:true, params:'{ids?, hSpacing?, vSpacing?（缺省＝来源宽高的 ¼）, rows?: 行 (3), cols?: 列 (3)} 对象 ▸ 重复 ▸ 网格（patterncmds.rs:659-672）→ {ok, id}'}, p => makeRepeat('ai.object.repeat.grid', 'grid', p));
reg('ai.object.repeat.mirror', {undoable:true, params:'{ids?, angle?: 度（90＝直轴）, offset?: 轴离来源右边 (10)} 对象 ▸ 重复 ▸ 镜像（patterncmds.rs:674-678）→ {ok, id}'}, p => makeRepeat('ai.object.repeat.mirror', 'mirror', p));
reg('ai.object.repeat.release', {undoable:true, params:'{} 对象 ▸ 重复 ▸ 释放（patterncmds.rs:680-697）：选中的重复放回它的来源物件（选中来源）→ {ok, ids}'}, () => {
  const {L, R} = selectedRepeats(); if (!R.length) return err('ai.object.repeat.release', 'select a repeat');
  const out = [];
  for (const r of R){ const S = L.data.shapes, i = S.indexOf(r), src = R3.kidsOf(r); S.splice(i, 1, ...src); src.forEach(c => out.push(c.id)); }
  R3.selectIds(L, out); return done(L, {ids:out});
});
reg('ai.object.repeat.expand', {undoable:true, params:'{} 扩展重复（patterncmds.rs:711-735 object.repeat.expand）：选中的重复变成一般编组（每个副本一组、来源已变换），编组留原 id → {ok, ids}'}, () => {
  const {L, R} = selectedRepeats(); if (!R.length) return err('ai.object.repeat.expand', 'select a repeat');
  for (const r of R){
    const src = R3.kidsOf(r), g = {id:r.id, type:'group', children:transforms(r).map(m => ({id:R3.newId(), type:'group', children:src.map(c => R3.cloneXf(c, m))}))};
    if (r.name) g.name = r.name;
    L.data.shapes.splice(L.data.shapes.indexOf(r), 1, g);
  }
  R3.selectIds(L, R.map(r => r.id)); return done(L, {ids:R.map(r => r.id)});
});
R3.regEdit('ai.object.repeat.options', {params:'{径向：instances?, radius?, reverseOverlap?, startAngle?, endAngle?, center?:[x,y] | 网格：hSpacing?, vSpacing?, rows?, cols?, gridType?: "grid"|"brickByRow"|"brickByColumn"|"hexByColumn"|"hexByRow", brickOffset?, flipRows?, flipCols? | 镜像：angle?, center?} 对象 ▸ 重复 ▸ 选项…（patterncmds.rs:737-801）：设选中重复的选项（一步历史）；不给参数＝读目前的值（不进历史）→ {ok, …}'}, (p, touch) => {
  const C = 'ai.object.repeat.options';
  const {L, R} = selectedRepeats(); if (!R.length) return err(C, 'select a repeat');
  const n = k => (p[k] !== undefined && p[k] !== null && isFinite(+p[k])) ? +p[k] : null, f = k => typeof p[k] === 'boolean' ? p[k] : null;
  if (n('instances') !== null && !(n('instances') >= 1 && n('instances') <= 1000)) return err(C, 'instances must be 1..1000');
  let gt = null; if (typeof p.gridType === 'string'){ gt = parseTile(p.gridType, n('brickOffset')); if (!gt) return err(C, `unknown gridType \`${p.gridType}\``); }
  const cen = Array.isArray(p.center) && p.center.length >= 2 && p.center.every(v => isFinite(+v)) ? [+p.center[0] - L.x, +p.center[1] - L.y] : null;
  const keys = ['instances', 'radius', 'reverseOverlap', 'startAngle', 'endAngle', 'center', 'hSpacing', 'vSpacing', 'rows', 'cols', 'gridType', 'flipRows', 'flipCols', 'angle'];
  if (!keys.some(k => p[k] !== undefined)){ const q = params(R[0]); return Object.assign({ok:true}, readOut(q, L)); }
  touch();
  for (const r of R){
    const s = r.repeat, h = R3.helperOf(r), P = h.points;
    if (s.kind === 'radial'){
      if (n('instances') !== null) s.instances = Math.floor(n('instances'));
      if (f('reverseOverlap') !== null) s.reverseOverlap = f('reverseOverlap');
      if (n('startAngle') !== null) s.startAngle = n('startAngle');
      if (n('endAngle') !== null) s.endAngle = n('endAngle');
      const c = cen || P[0], rad = n('radius') !== null ? Math.max(n('radius'), 0) : Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
      h.points = [c, [c[0] + rad, c[1]]];
    } else if (s.kind === 'grid'){
      const k = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) || 1;
      if (n('hSpacing') !== null) s.hSpacing0 = n('hSpacing') / k;
      if (n('vSpacing') !== null) s.vSpacing0 = n('vSpacing') / k;
      if (n('rows') !== null) s.rows = Math.min(Math.max(Math.floor(n('rows')), 1), 500);
      if (n('cols') !== null) s.cols = Math.min(Math.max(Math.floor(n('cols')), 1), 500);
      if (gt) s.gridType = gt;
      if (f('flipRows') !== null) s.flipRows = f('flipRows');
      if (f('flipCols') !== null) s.flipCols = f('flipCols');
    } else {
      const q = params(r), c = cen || q.center, a = n('angle') !== null ? n('angle') : q.angle, t = a * Math.PI / 180;
      h.points = [c, [c[0] + Math.cos(t), c[1] + Math.sin(t)]];
    }
  }
  return done(L);
});
function readOut(q, L){
  if (q.kind === 'radial') return {kind:'radial', instances:q.instances, radius:q.radius, startAngle:q.startAngle, endAngle:q.endAngle, reverseOverlap:q.reverseOverlap, center:[q.center[0] + L.x, q.center[1] + L.y]};
  if (q.kind === 'grid') return {kind:'grid', hSpacing:q.hSpacing, vSpacing:q.vSpacing, rows:q.rows, cols:q.cols, gridType:q.gridType.type, flipRows:q.flipRows, flipCols:q.flipCols};
  return {kind:'mirror', angle:q.angle, center:[q.center[0] + L.x, q.center[1] + L.y]};
}
/* 选项…：参数对话框，栏位照选中重复的种类（pattern_options.rs:197-214 repeat_fields） */
R3.reg('ai.object.repeat.options.dialog', {params:'{} 开「重复选项」对话框（栏位照选中重复的种类；确定＝ai.object.repeat.options）→ {ok, dialog}'}, () => {
  const {L, R} = selectedRepeats(); if (!R.length) return err('ai.object.repeat.options', 'select a repeat');
  const q = params(R[0]);
  const F = q.kind === 'radial' ? [{key:'instances', label:'ai3r.instances', type:'number', value:q.instances}, {key:'radius', label:'ai3r.radius', type:'number', value:+q.radius.toFixed(4)},
      {key:'startAngle', label:'ai3r.startAngle', type:'number', value:q.startAngle}, {key:'endAngle', label:'ai3r.endAngle', type:'number', value:q.endAngle}, {key:'reverseOverlap', label:'ai3r.reverseOverlap', type:'check', value:q.reverseOverlap}]
    : q.kind === 'grid' ? [{key:'hSpacing', label:'ai3r.hSpacing', type:'number', value:+q.hSpacing.toFixed(4)}, {key:'vSpacing', label:'ai3r.vSpacing', type:'number', value:+q.vSpacing.toFixed(4)},
      {key:'rows', label:'ai3r.rows', type:'number', value:q.rows}, {key:'cols', label:'ai3r.cols', type:'number', value:q.cols},
      {key:'gridType', label:'ai3r.gridType', type:'select', value:q.gridType.type, options:TILE_IDS.map(k => [k, 'ai3r.t.' + k])},
      {key:'flipRows', label:'ai3r.flipRows', type:'check', value:q.flipRows}, {key:'flipCols', label:'ai3r.flipCols', type:'check', value:q.flipCols}]
    : [{key:'angle', label:'ai3r.angle', type:'number', value:+q.angle.toFixed(4)}];
  R3.form('repeatOptions', 'ai3r.title', F, v => CMD.run('ai.object.repeat.options', v));
  return {ok:true, dialog:'repeatOptions'};
});
Lang.add({
  'zh-Hant':{'ai3r.title':'重複選項', 'ai3r.instances':'實例數', 'ai3r.radius':'半徑', 'ai3r.startAngle':'起始角度', 'ai3r.endAngle':'結束角度', 'ai3r.reverseOverlap':'反轉重疊', 'ai3r.hSpacing':'水平間距', 'ai3r.vSpacing':'垂直間距',
    'ai3r.rows':'列數', 'ai3r.cols':'欄數', 'ai3r.gridType':'格點類型', 'ai3r.flipRows':'翻轉列', 'ai3r.flipCols':'翻轉欄', 'ai3r.angle':'軸角度',
    'ai3r.t.grid':'格點', 'ai3r.t.brickByRow':'依列磚紋', 'ai3r.t.brickByColumn':'依欄磚紋', 'ai3r.t.hexByColumn':'依欄六角形', 'ai3r.t.hexByRow':'依列六角形'},
  'zh-Hans':{'ai3r.title':'重复选项', 'ai3r.instances':'实例数', 'ai3r.radius':'半径', 'ai3r.startAngle':'起始角度', 'ai3r.endAngle':'结束角度', 'ai3r.reverseOverlap':'反向重叠', 'ai3r.hSpacing':'水平间距', 'ai3r.vSpacing':'垂直间距',
    'ai3r.rows':'行数', 'ai3r.cols':'列数', 'ai3r.gridType':'网格类型', 'ai3r.flipRows':'翻转行', 'ai3r.flipCols':'翻转列', 'ai3r.angle':'轴角度',
    'ai3r.t.grid':'网格', 'ai3r.t.brickByRow':'砖形（按行）', 'ai3r.t.brickByColumn':'砖形（按列）', 'ai3r.t.hexByColumn':'十六进制（按列）', 'ai3r.t.hexByRow':'十六进制（按行）'},
  en:{'ai3r.title':'Repeat Options', 'ai3r.instances':'Number of instances', 'ai3r.radius':'Radius', 'ai3r.startAngle':'Start angle', 'ai3r.endAngle':'End angle', 'ai3r.reverseOverlap':'Reverse Overlap', 'ai3r.hSpacing':'Horizontal spacing', 'ai3r.vSpacing':'Vertical spacing',
    'ai3r.rows':'Rows', 'ai3r.cols':'Columns', 'ai3r.gridType':'Grid type', 'ai3r.flipRows':'Flip rows', 'ai3r.flipCols':'Flip columns', 'ai3r.angle':'Axis angle',
    'ai3r.t.grid':'Grid', 'ai3r.t.brickByRow':'Brick by Row', 'ai3r.t.brickByColumn':'Brick by Column', 'ai3r.t.hexByColumn':'Hex by Column', 'ai3r.t.hexByRow':'Hex by Row'}
});
})();

/*对象 ▸ 混合（建立／释放／混合选项…／扩展／替换混合轴／反向混合轴／反向堆叠）：照 VectorCraft 原码
     engine/src/cmd/live.rs:25-122（登记）、283-903  roots_param／selected_of／wrap／replace_with、spacing_param（smooth|steps|distance，预设 5 步／10 点）、
         orientation_param、starts_param、merge_keys（混合里再混合＝收它的关键物件）、blend_make／release（混合轴留成不上色的路径、放在关键物件下面）／
         options（没选混合＝设新混合的预设，不进历史）／info／expand（关键物件＋步骤编组、留原 id）／keys_to_spine／pin／reverse_spine／
         replace_spine（选中的路径当混合轴、路径吃掉、关键物件按弧长平均排上去）／reverse_spine（关键物件互换位置）／reverse_stack（堆叠顺序反过来）
     doc/src/blend.rs 1-1155  lerp_color／lerp_paint（实色、渐变：色标重取样成共同一组）、lerp_appearance、PathPair（子路径依序配对、少的从中心长出来、
         grow 劈最长的线段补锚点、闭合路径同绕向＋best_rotation 找最不扭的起点、starts 指定起点）、Lerp（编组按堆叠配对、复合路径、其它＝复制较近的那个缩进内插外框）、
         blend_step_count（平滑颜色：颜色差 ×255/2 步，颜色一样按距离/2，夹 1..256；指定步数；指定距离＝round(长/距)-1）、
         Spine（拉平 0.1、弧长）、blend_spine／pin_spine、Rail（步骤沿混合轴按弧长放、对齐路径时转到轴的方向）、blend_expand
     doc/src/live.rs:41-88   BlendSpacing（预设 平滑颜色）、BlendOrientation（预设 对齐页面）、BlendSpec
     ui-egui/src/dialogs/blend_options.rs  混合选项对话框（间距：平滑颜色／指定的步数／指定的距离＋值；取向：对齐页面／对齐路径）
   资料：{type:'group', live:'blend', children:[关键物件…, 混合轴（有存的才有：看不见的辅助路径 r3spine）], blend:{spacing:{mode, value}, orientation, keyAnchors, starts}}
     步骤画的时候现算（来源改了跟着变）。
   我们没做的：新混合是「挖空组」（半透明步骤不互相透出来）——我们的渲染没有挖空组，半透明步骤会叠出来；渐变内插时色标中点不跟着内插；
     「混合里再加关键物件」时原混合存的混合轴改回关键物件中心连线（原码 extend_spine 会把新物件接到旧轴两端）。 */
(function(){
'use strict';
if (window.__aiR3_blend) return; window.__aiR3_blend = true;
const R3 = window.AiR3, A = AIObj.A, {num, bool, reg, regEdit, done, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const DEFAULT_STEPS = 5, DEFAULT_DISTANCE = 10;
const lerpN = (x, y, t) => x + (y - x) * t;
const lerpP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ═════ 颜色（lerp_color：显示 RGB 内插） ═════ */
const _cc = document.createElement('canvas').getContext('2d');
function rgba(c){
  if (!c || c === 'none') return null;
  _cc.fillStyle = '#000'; _cc.fillStyle = String(c); const v = _cc.fillStyle;
  if (v[0] === '#') return [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
  const m = v.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const q = m[1].split(',').map(x => parseFloat(x)); return [q[0] / 255, q[1] / 255, q[2] / 255, q.length > 3 ? q[3] : 1];
}
const hex2 = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
const css = c => c[3] >= 1 ? '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${+c[3].toFixed(4)})`;
const isGrad = p => !!(window.GradientFill && GradientFill.isGrad(p));
const isSolid = p => typeof p === 'string' && !!rgba(p);
/* 渐变在 offset 的颜色（线性，色标间） */
function gradAt(g, o){
  const S = g.stops.slice().sort((a, b) => a.offset - b.offset);
  if (o <= S[0].offset) return [rgba(S[0].color), S[0].opacity === undefined ? 1 : S[0].opacity];
  for (let i = 0; i + 1 < S.length; i++){
    const a = S[i], b = S[i + 1];
    if (o <= b.offset){ const t = (o - a.offset) / Math.max(b.offset - a.offset, 1e-9); const ca = rgba(a.color), cb = rgba(b.color); return [ca.map((v, k) => lerpN(v, cb[k], t)), lerpN(a.opacity === undefined ? 1 : a.opacity, b.opacity === undefined ? 1 : b.opacity, t)]; }
  }
  const z = S[S.length - 1]; return [rgba(z.color), z.opacity === undefined ? 1 : z.opacity];
}
/* blend.rs:89-136 common_stops＋lerp_gradient：两边色标重取样到共同的位置，再逐个内插（几何也内插） */
function lerpGrad(a, b, t){
  const offs = [...new Set(a.stops.map(s => +s.offset).concat(b.stops.map(s => +s.offset)))].sort((x, y) => x - y);
  const base = clone(t < 0.5 ? a : b);
  base.stops = offs.map(o => { const [ca, oa] = gradAt(a, o), [cb, ob] = gradAt(b, o); const c = ca.map((v, k) => lerpN(v, cb[k], t)); return {offset:o, color:css([c[0], c[1], c[2], 1]), opacity:lerpN(oa, ob, t)}; });
  for (const k of ['x1', 'y1', 'x2', 'y2', 'r', 'aspect', 'fx', 'fy']) if (typeof a[k] === 'number' && typeof b[k] === 'number') base[k] = lerpN(a[k], b[k], t);
  return base;
}
const solidGrad = (c, like) => Object.assign(clone(like), {stops:like.stops.map(s => ({offset:s.offset, color:c, opacity:1}))});
/* blend.rs:138-157 lerp_paint */
function lerpPaint(a, b, t){
  if (isSolid(a) && isSolid(b)){ const x = rgba(a), y = rgba(b); return css(x.map((v, k) => lerpN(v, y[k], t))); }
  if (isGrad(a) && isGrad(b)) return lerpGrad(a, b, t);
  if (isSolid(a) && isGrad(b)) return lerpGrad(solidGrad(a, b), b, t);
  if (isGrad(a) && isSolid(b)) return lerpGrad(a, solidGrad(b, a), t);
  return clone(t < 0.5 ? a : b);
}
/* blend.rs:227-268 lerp_appearance（我们的外观＝一个填色＋一个描边） */
function lerpLook(n, a, b, t){
  if (a.fill !== undefined || b.fill !== undefined) n.fill = lerpPaint(a.fill === undefined ? 'none' : a.fill, b.fill === undefined ? 'none' : b.fill, t);
  if (a.stroke !== undefined || b.stroke !== undefined) n.stroke = lerpPaint(a.stroke === undefined ? 'none' : a.stroke, b.stroke === undefined ? 'none' : b.stroke, t);
  if (typeof a.strokeWidth === 'number' || typeof b.strokeWidth === 'number') n.strokeWidth = lerpN(+a.strokeWidth || 0, +b.strokeWidth || 0, t);
  if (typeof a.opacity === 'number' || typeof b.opacity === 'number') n.opacity = lerpN(typeof a.opacity === 'number' ? a.opacity : 1, typeof b.opacity === 'number' ? b.opacity : 1, t);
  delete n.name; delete n.locked; n.visible = true;
}

/* ═════ 路径（PathPair） ═════ */
const fromView = v => ({closed:!!v.closed, A:v.anchors.map(a => ({p:[a.x, a.y], hi:a.in ? [a.in[0], a.in[1]] : [a.x, a.y], ho:a.out ? [a.out[0], a.out[1]] : [a.x, a.y]}))});
const toView = sp => ({closed:sp.closed, anchors:sp.A.map(a => ({x:a.p[0], y:a.p[1], in:same(a.hi, a.p) ? null : a.hi.slice(), out:same(a.ho, a.p) ? null : a.ho.slice()}))});
const cloneSp = sp => ({closed:sp.closed, A:sp.A.map(a => ({p:a.p.slice(), hi:a.hi.slice(), ho:a.ho.slice()}))});
const segN = sp => sp.A.length < 2 ? 0 : (sp.closed ? sp.A.length : sp.A.length - 1);
const seg = (sp, i) => { const a = sp.A[i], b = sp.A[(i + 1) % sp.A.length]; return {p0:a.p, c1:a.ho, c2:b.hi, p3:b.p}; };
const ev = (c, t) => VecSel.evalCubic(c, t);
function insertAnchor(sp, i, t){
  const c = seg(sp, i), [l, r] = VecSel.splitCubic(c, t), j = (i + 1) % sp.A.length;
  sp.A[i].ho = l.c1.slice(); sp.A[j].hi = r.c2.slice();
  sp.A.splice(i + 1, 0, {p:l.p3.slice(), hi:l.c2.slice(), ho:r.c1.slice()});
  return i + 1;
}
/* blend.rs:301-320 grow：劈最长（弦长）的那段 */
function grow(sp, n){
  let guard = 0;
  while (sp.A.length < n && guard++ < 20000){
    if (segN(sp) === 0){ const a = sp.A[sp.A.length - 1]; if (!a) return; sp.A.push({p:a.p.slice(), hi:a.p.slice(), ho:a.p.slice()}); continue; }
    let best = 0, bl = -1; for (let i = 0; i < segN(sp); i++){ const c = seg(sp, i), l = dist(c.p0, c.p3); if (l > bl){ bl = l; best = i; } }
    insertAnchor(sp, best, 0.5);
  }
}
function spReverse(sp){ sp.A.reverse(); sp.A.forEach(a => { const h = a.hi; a.hi = a.ho; a.ho = h; }); }
function startAt(sp, i){ const n = sp.A.length; if (i >= n) return; if (sp.closed) sp.A = sp.A.slice(i).concat(sp.A.slice(0, i)); else if (i + 1 === n && n > 1) spReverse(sp); }
function reverseClosed(sp){ spReverse(sp); sp.A.unshift(sp.A.pop()); }
function spArea(sp){                                         // 带号面积（拉平）
  const P = []; for (let i = 0; i < segN(sp); i++){ const c = seg(sp, i); for (let k = 0; k < 8; k++) P.push(ev(c, k / 8)); }
  if (!segN(sp)) return 0; let s = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2;
}
function spBounds(list){
  let r = null; const U = p => { r = r ? {x0:Math.min(r.x0, p[0]), y0:Math.min(r.y0, p[1]), x1:Math.max(r.x1, p[0]), y1:Math.max(r.y1, p[1])} : {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}; };
  for (const sp of list){ sp.A.forEach(a => U(a.p)); for (let i = 0; i < segN(sp); i++){ const c = seg(sp, i); for (let k = 1; k < 16; k++) U(ev(c, k / 16)); } }
  return r;
}
function normalised(sp){
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  sp.A.forEach(a => { lo = [Math.min(lo[0], a.p[0]), Math.min(lo[1], a.p[1])]; hi = [Math.max(hi[0], a.p[0]), Math.max(hi[1], a.p[1])]; });
  const c = lerpP(lo, hi, 0.5), s = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-9);
  return sp.A.map(a => [(a.p[0] - c[0]) / s, (a.p[1] - c[1]) / s]);
}
/* blend.rs:362-377 best_rotation */
function bestRotation(a, b){
  const qa = normalised(a), qb = normalised(b), m = Math.min(qa.length, qb.length); if (m < 2) return 0;
  const cost = s => { let c = 0; for (let j = 0; j < m; j++){ const d = [qa[j][0] - qb[(j + s) % m][0], qa[j][1] - qb[(j + s) % m][1]]; c += d[0] * d[0] + d[1] * d[1]; } return c; };
  const stride = Math.ceil(m / 512);
  let best = 0, bc = Infinity; for (let s = 0; s < m; s += stride){ const c = cost(s); if (c < bc){ bc = c; best = s; } }
  if (stride > 1){ for (let s = best + m - stride; s <= best + m + stride; s++){ const c = cost(s % m); if (c < bc){ bc = c; best = s % m; } } }
  return best;
}
/* blend.rs:388-426 PathPair::new */
function pathPair(a, b, starts){
  const n = Math.max(a.length, b.length), ba = spBounds(a), bb = spBounds(b);
  const ca = ba ? [(ba.x0 + ba.x1) / 2, (ba.y0 + ba.y1) / 2] : [0, 0], cb = bb ? [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2] : [0, 0];
  const degen = (like, c) => ({closed:like.closed, A:Array.from({length:Math.max(like.A.length, 1)}, () => ({p:c.slice(), hi:c.slice(), ho:c.slice()}))});
  const va = [], vb = [];
  for (let i = 0; i < n; i++){
    let sa, sb;
    if (a[i] && b[i]){ sa = cloneSp(a[i]); sb = cloneSp(b[i]); } else if (a[i]){ sa = cloneSp(a[i]); sb = degen(a[i], cb); } else if (b[i]){ sa = degen(b[i], ca); sb = cloneSp(b[i]); } else continue;
    const explicit = i === 0 && (starts[0] !== null || starts[1] !== null);
    if (explicit){ if (starts[0] !== null) startAt(sa, starts[0]); if (starts[1] !== null) startAt(sb, starts[1]); }
    const closed = sa.closed && sb.closed && sa.A.length > 2 && sb.A.length > 2;
    if (closed && spArea(sa) * spArea(sb) < 0) reverseClosed(sb);
    const m = Math.max(sa.A.length, sb.A.length); grow(sa, m); grow(sb, m);
    if (closed && !explicit){ const r = bestRotation(sa, sb); sb.A = sb.A.slice(r).concat(sb.A.slice(0, r)); }
    va.push(sa); vb.push(sb);
  }
  return {a:va, b:vb, at(t){ return this.a.map((sa, k) => { const sb = this.b[k]; return {closed:t < 0.5 ? sa.closed : sb.closed, A:sa.A.map((x, j) => { const y = sb.A[j]; return {p:lerpP(x.p, y.p, t), hi:lerpP(x.hi, y.hi, t), ho:lerpP(x.ho, y.ho, t)}; })}; }); }};
}
/* node_path（blend.rs:448-470）：路径＝一条子路径（活形状照 VecSel 视图）、复合路径＝成员接起来 */
function nodePath(n){
  if (R3.isLeaf(n)){ const v = VecSel.asBezier(n); return v && v.anchors ? {subs:[fromView(v)], rule:'nonzero', counts:null} : null; }
  if (n.type === 'compound'){ const vs = n.children.map(c => VecSel.asBezier(c)).filter(v => v && v.anchors); return {subs:vs.map(fromView), rule:n.rule || 'nonzero', counts:vs.map(() => 1)}; }
  return null;
}
const centerOf = n => { const b = AIObj.shapeBounds(n, p => p, false); return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0, 0]; };
/* collapsed：只有一边有的成员，从另一边的中心长出来 */
const collapsed = (n, c) => { const x = clone(n), b = AIObj.shapeBounds(n, p => p, false); if (b){ const bc = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; R3.xformDeep(x, A.mul(A.translate(c[0], c[1]), A.mul(A.scale(1e-6), A.translate(-bc[0], -bc[1])))); } return x; };
const plainGroup = n => n && n.type === 'group' && !n.live;
/* blend.rs:508-628 Lerp */
function mkLerp(a, b, starts){
  let shape;
  if (plainGroup(a) && plainGroup(b) && !!a.clip === !!b.clip && !(a.clip && a.children.length !== b.children.length)){
    const oa = centerOf(a), ob = centerOf(b), n = Math.max(a.children.length, b.children.length), kids = [];
    for (let i = 0; i < n; i++){ const x = a.children[i], y = b.children[i]; if (x && y) kids.push(mkLerp(x, y, [null, null])); else if (x) kids.push(mkLerp(x, collapsed(x, ob), [null, null])); else if (y) kids.push(mkLerp(collapsed(y, oa), y, [null, null])); }
    shape = {kind:'group', kids, clip:!!a.clip};
  } else {
    const pa = nodePath(a), pb = nodePath(b);
    shape = (pa && pb) ? {kind:'path', pair:pathPair(pa.subs, pb.subs, starts), rules:[pa.rule, pb.rule], members:(pa.counts && pb.counts) ? [pa.counts, pb.counts] : null} : {kind:'other'};
  }
  return {a, b, shape, at(t){
    const base = t < 0.5 ? a : b; let n;
    if (shape.kind === 'group'){ n = {type:'group', children:shape.kids.map(k => k.at(t))}; if (shape.clip) n.clip = true; }
    else if (shape.kind === 'path'){
      const subs = shape.pair.at(t), rule = t < 0.5 ? shape.rules[0] : shape.rules[1];
      if (shape.members) n = {type:'compound', rule, children:subs.map(sp => Object.assign({id:R3.newId(), type:'bezier'}, toView(sp), {fill:'none', stroke:'none', strokeWidth:0}))};
      else n = Object.assign({type:'bezier'}, toView(subs[0] || {closed:false, A:[]}));
      if (subs.length > 1 && !shape.members) n = {type:'compound', rule, children:subs.map(sp => Object.assign({id:R3.newId(), type:'bezier'}, toView(sp), {fill:'none', stroke:'none', strokeWidth:0}))};
    } else {                                                 // 其它：较近那个的复制品，移动＋缩放到内插的外框
      n = clone(base);
      const ba = AIObj.shapeBounds(a, p => p, false), bb = AIObj.shapeBounds(b, p => p, false), bn = AIObj.shapeBounds(base, p => p, false);
      if (ba && bb && bn){
        const w = lerpN(ba.x1 - ba.x0, bb.x1 - bb.x0, t), h = lerpN(ba.y1 - ba.y0, bb.y1 - bb.y0, t);
        const c = lerpP([(ba.x0 + ba.x1) / 2, (ba.y0 + ba.y1) / 2], [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2], t), cn = [(bn.x0 + bn.x1) / 2, (bn.y0 + bn.y1) / 2];
        const sx = bn.x1 - bn.x0 > 1e-9 ? w / (bn.x1 - bn.x0) : 1, sy = bn.y1 - bn.y0 > 1e-9 ? h / (bn.y1 - bn.y0) : 1;
        R3.xformDeep(n, A.mul(A.translate(c[0], c[1]), A.mul(A.scale(sx, sy), A.translate(-cn[0], -cn[1]))));
      }
    }
    n.id = R3.newId();
    lerpLook(n, a, b, t);
    return n;
  }};
}
/* ═════ 步数（blend.rs:704-758） ═════ */
function colorDistance(a, b){
  let d = 0;
  const cols = p => isSolid(p) ? [rgba(p)] : isGrad(p) ? p.stops.map(s => rgba(s.color)).filter(Boolean) : [];
  const cmp = (x, y) => { const cx = cols(x), cy = cols(y); cx.forEach((c, i) => { const o = cy[i] || cy[0]; if (o) for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(c[k] - o[k])); }); };
  cmp(a.fill, b.fill); cmp(a.stroke, b.stroke);
  return d;
}
function stepCount(a, b, sp, len){
  if (sp.mode === 'steps') return Math.min(Math.max(Math.floor(sp.value), 1), 1000);
  if (sp.mode === 'distance'){ const d = Math.max(sp.value, 0.01); return Math.min(Math.max(Math.round(len / d) - 1, 0), 1000); }
  const cd = colorDistance(a, b);
  if (cd > 1 / 255) return Math.min(Math.max(Math.ceil(cd * 255 / 2), 1), 256);
  const ba = AIObj.shapeBounds(a, p => p, false), bb = AIObj.shapeBounds(b, p => p, false);
  const dd = (ba && bb) ? Math.max(Math.abs(ba.x0 - bb.x0), Math.abs(ba.x1 - bb.x1), Math.abs(ba.y0 - bb.y0), Math.abs(ba.y1 - bb.y1)) : len;
  return Math.min(Math.max(Math.ceil(dd / 2), 1), 256);
}
/* ═════ 混合轴（blend.rs:760-984 Spine／blend_spine／pin_spine／Rail） ═════ */
function mkSpine(sp){
  const pts = [], cum = [], anchors = [];
  for (let i = 0; i < segN(sp); i++){
    anchors.push(cum.length ? cum[cum.length - 1] : 0);
    const c = seg(sp, i), P = [c.p0];
    const straight = same(c.c1, c.p0) && same(c.c2, c.p3);
    if (straight) P.push(c.p3); else { const out = []; (function fl(cc, d){ const ch = [cc.p3[0] - cc.p0[0], cc.p3[1] - cc.p0[1]], L = Math.hypot(ch[0], ch[1]); const dev = L < 1e-12 ? Math.max(dist(cc.c1, cc.p0), dist(cc.c2, cc.p0)) : Math.max(Math.abs((cc.c1[0] - cc.p0[0]) * ch[1] - (cc.c1[1] - cc.p0[1]) * ch[0]), Math.abs((cc.c2[0] - cc.p0[0]) * ch[1] - (cc.c2[1] - cc.p0[1]) * ch[0])) / L; if (dev <= 0.1 || d > 16){ out.push(cc.p3); return; } const [l, r] = VecSel.splitCubic(cc, 0.5); fl(l, d + 1); fl(r, d + 1); })(c, 0); P.push(...out); }
    for (const p of P){ if (!isFinite(p[0]) || !isFinite(p[1])) continue; if (pts.length && dist(pts[pts.length - 1], p) <= 1e-9) continue; cum.push(pts.length ? cum[cum.length - 1] + dist(pts[pts.length - 1], p) : 0); pts.push(p); }
  }
  if (!sp.closed) anchors.push(cum.length ? cum[cum.length - 1] : 0);
  if (pts.length < 2) return null;
  const S = {pts, cum, anchors, closed:sp.closed, length(){ return cum[cum.length - 1]; },
    at(f){ return this.atLength(Math.min(Math.max(f, 0), 1) * this.length()); },
    atLength(s){
      const last = pts.length - 2; s = isFinite(s) ? Math.min(Math.max(s, 0), this.length()) : 0;
      let i = 0; while (i < last && cum[i + 1] <= s) i++;
      const u = Math.min(Math.max((s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-12), 0), 1), d = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      return [lerpP(pts[i], pts[i + 1], u), Math.atan2(d[1], d[0])];
    }};
  return S;
}
const spineChild = s => (s.children || []).find(c => c && c.r3spine) || null;
const keysOf = s => R3.kidsOf(s);
function storedSpine(s){ const c = spineChild(s); if (!c) return null; const v = VecSel.asBezier(c); return v && v.anchors && v.anchors.length >= 2 ? fromView(v) : null; }
function pinned(spec, k, n){ const ka = spec.keyAnchors || []; return (ka.length === k && k >= 2 && ka.every(a => a < n)) ? ka.slice() : null; }
/* blend_spine → {sp, anchors|null} */
function blendSpine(keys, s){
  if (keys.length < 2) return null;
  const st = storedSpine(s);
  if (!st){ const cs = keys.map(centerOf); return {sp:{closed:false, A:cs.map(c => ({p:c.slice(), hi:c.slice(), ho:c.slice()}))}, anchors:keys.map((_, i) => i)}; }
  const ka = pinned(s.blend, keys.length, st.A.length); if (!ka) return {sp:st, anchors:null};
  keys.forEach((k, i) => { const a = st.A[ka[i]], c = centerOf(k), d = [c[0] - a.p[0], c[1] - a.p[1]]; [a.p, a.hi, a.ho].forEach(q => { q[0] += d[0]; q[1] += d[1]; }); });
  return {sp:st, anchors:ka};
}
/* anchor_at_length：弧长 s 那里的锚点（有现成的 0.01 内就用、否则劈开那段） */
function anchorAtLength(sp, s){
  const S = mkSpine(sp); if (!S) return null;
  const n = segN(sp); let k = 0; for (let i = n - 1; i >= 0; i--) if (S.anchors[i] !== undefined && S.anchors[i] <= s){ k = i; break; }
  const from = S.anchors[k] || 0, to = S.anchors[k + 1] !== undefined ? S.anchors[k + 1] : S.length();
  if (s - from < 0.01) return k;
  if (to - s < 0.01) return (k + 1) % Math.max(sp.A.length, 1);
  const c = seg(sp, k), N = 64, L = [0]; let prev = c.p0;
  for (let i = 1; i <= N; i++){ const q = ev(c, i / N); L.push(L[i - 1] + dist(prev, q)); prev = q; }
  const want = (s - from) / Math.max(to - from, 1e-12) * L[N];
  let i = 0; while (i < N && L[i + 1] < want) i++;
  const t = Math.min(Math.max((i + (want - L[i]) / Math.max(L[i + 1] - L[i], 1e-12)) / N, 1e-4), 1 - 1e-4);
  return insertAnchor(sp, k, t);
}
function pinSpine(keys, s){
  const bs = blendSpine(keys, s); if (!bs) return null;
  if (bs.anchors) return bs;
  const k = keys.length, S = mkSpine(bs.sp); if (!S) return null;
  const total = S.length(), out = [0];
  for (let i = 1; i < k - 1; i++){ const a = anchorAtLength(bs.sp, total * i / (k - 1)); if (a === null) return null; out.push(a); }
  out.push(bs.sp.closed ? 0 : bs.sp.A.length - 1);
  return {sp:bs.sp, anchors:out};
}
function mkRail(keys, s){
  const rotate = s.blend.orientation === 'path';
  if (!storedSpine(s) && !rotate) return null;
  const bs = blendSpine(keys, s); if (!bs) return null;
  const S = mkSpine(bs.sp); if (!S) return null;
  const total = S.length(), k = keys.length;
  let stops;
  if (bs.anchors){ stops = []; for (const a of bs.anchors){ let v = S.anchors[a] || 0; if (S.closed && stops.length && v <= stops[stops.length - 1] + 1e-9) v += total; stops.push(v); } }
  else stops = keys.map((_, i) => total * i / Math.max(k - 1, 1));
  const centers = keys.map(centerOf);
  return {S, stops, centers, rotate,
    len(i){ return (stops[i] !== undefined && stops[i + 1] !== undefined) ? Math.abs(stops[i + 1] - stops[i]) : 0; },
    place(n, i, t){
      let s0 = stops[i], c0 = centers[i], sl = s0, base = c0;
      if (t > 0 && stops[i + 1] !== undefined){ sl = lerpN(s0, stops[i + 1], t); base = lerpP(c0, centers[i + 1], t); }
      const [p, ang] = S.atLength(S.closed ? ((sl % Math.max(S.length(), 1e-12)) + S.length()) % Math.max(S.length(), 1e-12) : sl);
      const off = [p[0] - base[0], p[1] - base[1]];
      let m = Math.hypot(off[0], off[1]) > 1e-9 ? A.translate(off[0], off[1]) : A.I;
      if (rotate && Math.abs(ang) > 1e-12){ const cn = centerOf(n), c = [cn[0] + off[0], cn[1] + off[1]]; m = A.mul(A.about(c, A.rotate(ang)), m); }
      if (m !== A.I) R3.xformDeep(n, m);
    }};
}
/* blend.rs:1015-1050 blend_expand：关键物件与步骤，按绘制顺序 */
function blendExpand(s){
  const keys = keysOf(s), k = keys.length;
  if (k < 2) return keys.map(clone);
  const rail = mkRail(keys, s), spec = s.blend, out = [], st = i => (spec.starts && spec.starts[i] !== undefined && spec.starts[i] !== null) ? spec.starts[i] : null;
  keys.forEach((a, i) => {
    const key = clone(a); if (rail) rail.place(key, i, 0); out.push(key);
    const b = keys[i + 1]; if (!b) return;
    const len = rail ? rail.len(i) : dist(centerOf(a), centerOf(b));
    const n = stepCount(a, b, spec.spacing || {mode:'smooth'}, len), lp = mkLerp(a, b, [st(i), st(i + 1)]);
    for (let j = 1; j <= n; j++){ const t = j / (n + 1), m = lp.at(t); if (rail) rail.place(m, i, t); out.push(m); }
  });
  return out;
}
R3.blendExpand = blendExpand;
const _cache = new WeakMap();
function evaluated(s){
  const key = JSON.stringify([s.children, s.blend]);
  const c = _cache.get(s); if (c && c.key === key) return c.nodes;
  const nodes = blendExpand(s); _cache.set(s, {key, nodes}); return nodes;
}
R3.live.blend = {
  draw(ctx, s, S){ for (const n of evaluated(s)) window.drawShape(ctx, n, S); },
  svg(s){ return '<g>' + evaluated(s).map(n => ObjRender.toSVG(n)).join('') + '</g>'; }
};

/* ═════ 命令 ═════ */
R3.blendDefaults = {spacing:{mode:'smooth'}, orientation:'page'};     // prefs.blend_options（session）
const isBlend = s => !!s && s.type === 'group' && s.live === 'blend';
/* selected_of(is_blend)：选中的混合（或选中物件的祖先是混合） */
function selectedBlends(){
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return {L:null, R:[]};
  const out = [];
  for (const id of VecSel.shapes){ let h = R3.findDeep(id, L), hit = null; while (h){ if (isBlend(h.s)) hit = h.s; h = h.parent ? R3.findDeep(h.parent.id, L) : null; } if (hit && !out.includes(hit)) out.push(hit); }
  return {L, R:out};
}
function spacingParam(p, C, cur){
  const n = k => (p[k] !== undefined && p[k] !== null && isFinite(+p[k])) ? +p[k] : null;
  let sp;
  const mode = typeof p.spacing === 'string' ? p.spacing : null, value = n('value');
  if (mode === 'smooth' || mode === 'smoothColor') sp = {mode:'smooth'};
  else if (mode === 'steps') sp = {mode:'steps', value:Math.floor(value !== null ? value : n('steps') !== null ? n('steps') : DEFAULT_STEPS)};
  else if (mode === 'distance') sp = {mode:'distance', value:value !== null ? value : n('distance') !== null ? n('distance') : DEFAULT_DISTANCE};
  else if (mode) return {err:err(C, `unknown spacing \`${mode}\` (smooth|steps|distance)`)};
  else if (n('steps') !== null) sp = {mode:'steps', value:Math.floor(n('steps'))};
  else if (n('distance') !== null) sp = {mode:'distance', value:n('distance')};
  else if (p.smooth === true) sp = {mode:'smooth'};
  else sp = clone(cur);
  if (sp.mode === 'steps' && !(sp.value >= 1 && sp.value <= 1000)) return {err:err(C, 'steps must be 1..1000')};
  if (sp.mode === 'distance' && !(isFinite(sp.value) && sp.value > 0)) return {err:err(C, 'distance must be > 0')};
  return {sp};
}
const orientParam = (p, cur) => (p.orientation === 'path' || p.orientation === 'alignToPath') ? 'path' : (p.orientation === 'page' || p.orientation === 'alignToPage') ? 'page' : cur;
reg('ai.object.blend.make', {undoable:true, params:'{ids?, steps?: n | distance?: 点 | smooth?: bool, spacing?: "smooth"|"steps"|"distance", value?, orientation?: "page"|"path"（缺省＝混合选项的预设：平滑颜色、对齐页面）, starts?: [每个物件第一条子路径的起点锚点 | null…]} 对象 ▸ 混合 ▸ 建立（live.rs:500-534）：选中的物件（按绘制顺序，至少两个）做成活的混合；其中若有混合＝把其它物件收进它当更多关键物件 → {ok, id}'}, p => {
  const C = 'ai.object.blend.make';
  const t = R3.targets(p, C); if (t.err) return err(C, 'select at least two objects');
  if (t.R.length < 2) return err(C, 'select at least two objects');
  const base = t.R.find(isBlend) || null;
  const cur = base ? {spacing:base.blend.spacing, orientation:base.blend.orientation} : R3.blendDefaults;
  const sp = spacingParam(p, C, cur.spacing); if (sp.err) return sp.err;
  const orientation = orientParam(p, cur.orientation);
  let starts = [];
  if (p.starts !== undefined && p.starts !== null){
    if (!Array.isArray(p.starts)) return err(C, '`starts` must be an array of anchor indices (or nulls)');
    const owners = Array.isArray(p.ids) ? p.ids : t.R.map(s => s.id), m = new Map();
    for (let i = 0; i < Math.min(owners.length, p.starts.length); i++){ const a = p.starts[i]; if (a === null) continue; if (!(Number.isInteger(a) && a >= 0)) return err(C, 'a start must be an anchor index ≥ 0 or null'); m.set(owners[i], a); }
    starts = m;
  }
  // merge_keys
  const keys = [], st = [];
  for (const n of t.R){
    if (isBlend(n)){ keysOf(n).forEach((c, i) => { keys.push(c); st.push(n.blend.starts && n.blend.starts[i] !== undefined ? n.blend.starts[i] : null); }); }
    else { keys.push(n); st.push(starts instanceof Map && starts.has(n.id) ? starts.get(n.id) : null); }
  }
  const S = t.L.data.shapes, top = t.R[t.R.length - 1], idx = S.indexOf(top);
  const g = base ? Object.assign(clone(base), {children:keys}) : {id:R3.newId(), type:'group', live:'blend', children:keys};
  g.blend = {spacing:sp.sp, orientation, keyAnchors:[], starts:st.every(x => x === null) ? [] : st};
  S.splice(idx + 1, 0, g);
  t.L.data.shapes = S.filter(s => !t.R.includes(s));
  R3.selectIds(t.L, [g.id]);
  return done(t.L, {id:g.id});
});
reg('ai.object.blend.release', {undoable:true, params:'{} 对象 ▸ 混合 ▸ 释放（live.rs:536-582）：选中的混合放回关键物件，混合轴留成一条不上色的路径放在它们下面；有名字的混合放回成编组（留名字）→ {ok, ids:[关键物件], spines, groups}'}, () => {
  const C = 'ai.object.blend.release';
  const {L, R} = selectedBlends(); if (!R.length) return err(C, 'select a blend');
  const keys = [], spines = [], groups = [];
  for (const b of R){
    const ks = keysOf(b), bs = blendSpine(ks, b), nodes = [];
    if (bs){ const sp = Object.assign({id:R3.newId(), type:'bezier'}, toView(bs.sp), {fill:'none', stroke:'none', strokeWidth:0}); spines.push(sp.id); nodes.push(sp); }
    ks.forEach(k => keys.push(k.id)); nodes.push(...ks);
    let put = nodes;
    if (b.name){ const g = {id:b.id, type:'group', name:b.name, children:nodes}; groups.push(g.id); put = [g]; }
    const h = R3.findDeep(b.id, L); h.arr.splice(h.idx, 1, ...put);
  }
  R3.selectDeep(L, groups.length ? groups : spines.concat(keys));
  return done(L, {ids:keys, spines, groups});
});
reg('ai.object.blend.expand', {undoable:true, params:'{} 对象 ▸ 混合 ▸ 扩展（live.rs:757-800）：选中的混合换成关键物件＋步骤的一般编组（留原 id、名字）→ {ok, ids}'}, () => {
  const {L, R} = selectedBlends(); if (!R.length) return err('ai.object.blend.expand', 'select a blend');
  for (const b of R){ const g = {id:b.id, type:'group', children:blendExpand(b).map(n => R3.reid(n))}; if (b.name) g.name = b.name; const h = R3.findDeep(b.id, L); h.arr.splice(h.idx, 1, g); }
  R3.selectDeep(L, R.map(b => b.id)); return done(L, {ids:R.map(b => b.id)});
});
const optJson = (sp, o) => ({spacing:sp.mode, steps:sp.mode === 'steps' ? sp.value : DEFAULT_STEPS, distance:sp.mode === 'distance' ? sp.value : DEFAULT_DISTANCE, orientation:o});
reg('ai.object.blend.info', {params:'{} 第一个选中混合的选项（没选混合＝新混合的预设）→ {ok, target:"blend"|"defaults", id?, spacing, steps, distance, orientation, keys?, starts?, spine?}'}, () => {
  const {R} = selectedBlends();
  if (!R.length) return Object.assign({ok:true, target:'defaults'}, optJson(R3.blendDefaults.spacing, R3.blendDefaults.orientation));
  const b = R[0], ks = keysOf(b), v = Object.assign({ok:true, target:'blend', id:b.id}, optJson(b.blend.spacing, b.blend.orientation));
  v.keys = ks.map(k => k.id); v.starts = ks.map((_, i) => (b.blend.starts || [])[i] === undefined ? null : b.blend.starts[i]);
  const bs = blendSpine(ks, b); if (bs) v.spine = Object.assign(toView(bs.sp), {keyAnchors:bs.anchors, explicit:!!storedSpine(b)});
  return v;
});
R3.regEdit('ai.object.blend.options', {params:'{spacing?: "smooth"|"steps"|"distance", value?, steps?, distance?, orientation?: "page"|"path"} 对象 ▸ 混合 ▸ 混合选项…（live.rs:701-718）：设选中混合的选项（一步历史）；没选混合＝设新混合的预设（不进历史）→ {ok, defaults?}'}, (p, touch) => {
  const C = 'ai.object.blend.options';
  const {L, R} = selectedBlends();
  if (!R.length){ const d = R3.blendDefaults, sp = spacingParam(p, C, d.spacing); if (sp.err) return sp.err; R3.blendDefaults = {spacing:sp.sp, orientation:orientParam(p, d.orientation)}; return {ok:true, defaults:true}; }
  const sp = spacingParam(p, C, R[0].blend.spacing); if (sp.err) return sp.err;
  const o = orientParam(p, R[0].blend.orientation);
  touch(); R.forEach(b => { b.blend.spacing = clone(sp.sp); b.blend.orientation = o; });
  return done(L);
});
/* keys_to_spine：关键物件搬到混合轴上（钉在锚点上的到锚点，否则按弧长平均） */
function keysToSpine(b){
  const sp = storedSpine(b); if (!sp) return;
  const ks = keysOf(b), k = ks.length, ka = pinned(b.blend, k, sp.A.length), S = mkSpine(sp);
  ks.forEach((c, i) => {
    const pt = ka ? (sp.A[ka[i]] ? sp.A[ka[i]].p : null) : (S ? S.at(k > 1 ? i / (k - 1) : 0)[0] : null);
    const cc = centerOf(c); if (pt) R3.xformDeep(c, A.translate(pt[0] - cc[0], pt[1] - cc[1]));
  });
}
function setSpine(b, sp){
  b.children = b.children.filter(c => !c.r3spine);
  if (sp) b.children.push(Object.assign({id:R3.newId(), type:'bezier'}, toView(sp), {fill:'none', stroke:'none', strokeWidth:0, visible:false, r3helper:true, r3spine:true}));
}
function pin(b){ const ps = pinSpine(keysOf(b), b); if (!ps) return false; setSpine(b, ps.sp); b.blend.keyAnchors = ps.anchors; return true; }
reg('ai.object.blend.replaceSpine', {undoable:true, params:'{} 对象 ▸ 混合 ▸ 替换混合轴（live.rs:842-869）：同时选中一个混合与一条路径 ⇒ 路径变成混合轴（路径吃掉），关键物件按弧长平均排上去 → {ok}'}, () => {
  const C = 'Replace Spine: select a blend and a path';
  const {L, R} = selectedBlends(); if (!R.length) return {ok:false, error:C};
  const b = R[0];
  const pid = VecSel.shapes.find(id => { const h = R3.findDeep(id, L); if (!h || isBlend(h.s) || !(R3.isLeaf(h.s))) return false; let x = h; while (x){ if (x.s === b) return false; x = x.parent ? R3.findDeep(x.parent.id, L) : null; } return true; });
  if (!pid) return {ok:false, error:C};
  const h = R3.findDeep(pid, L), v = VecSel.asBezier(h.s); if (!v || !v.anchors || v.anchors.length < 2) return {ok:false, error:C};
  h.arr.splice(h.idx, 1);
  setSpine(b, fromView(v)); b.blend.keyAnchors = []; keysToSpine(b);
  R3.selectIds(L, [b.id]); return done(L);
});
reg('ai.object.blend.reverseSpine', {undoable:true, params:'{} 对象 ▸ 混合 ▸ 反向混合轴（live.rs:871-887）：关键物件沿混合轴的先后反过来（有存的混合轴＝轴反向、关键物件跟着锚点；否则关键物件互换位置）→ {ok}'}, () => {
  const {L, R} = selectedBlends(); if (!R.length) return err('ai.object.blend.reverseSpine', 'select a blend');
  for (const b of R){
    if (storedSpine(b) && pin(b)){ const ka = b.blend.keyAnchors.slice(), sp = storedSpine(b); spReverse(sp); setSpine(b, sp); b.blend.keyAnchors = ka; keysToSpine(b); }   // 关键物件留在自己的锚点编号上，编号改从另一头数
    else { const ks = keysOf(b), cs = ks.map(centerOf), n = ks.length; ks.forEach((k, i) => R3.xformDeep(k, A.translate(cs[n - 1 - i][0] - cs[i][0], cs[n - 1 - i][1] - cs[i][1]))); }
  }
  return done(L);
});
reg('ai.object.blend.reverseFrontToBack', {undoable:true, params:'{} 对象 ▸ 混合 ▸ 反向堆叠（live.rs:889-903）：选中混合的堆叠顺序反过来（各关键物件留在原位、起点跟着）→ {ok}'}, () => {
  const {L, R} = selectedBlends(); if (!R.length) return err('ai.object.blend.reverseFrontToBack', 'select a blend');
  for (const b of R){
    const ks = keysOf(b).reverse(), hs = b.children.filter(c => c.r3helper);
    b.children = ks.concat(hs);
    const sp = b.blend;
    if (sp.starts && sp.starts.length){ while (sp.starts.length < ks.length) sp.starts.push(null); sp.starts.reverse(); }
    sp.keyAnchors = (sp.keyAnchors || []).slice().reverse();
    const s0 = storedSpine(b); if (s0){ spReverse(s0); const n = s0.A.length; setSpine(b, s0); sp.keyAnchors = sp.keyAnchors.map(a => Math.max(0, n - 1 - a)); }
  }
  return done(L);
});
/* 混合选项…（blend_options.rs） */
R3.reg('ai.object.blend.options.dialog', {params:'{} 开「混合选项」对话框（照选中混合的选项；没选混合＝改新混合的预设；确定＝ai.object.blend.options）→ {ok, dialog}'}, () => {
  const f = CMD.map['ai.object.blend.info'].run({});
  R3.form('blendOptions', 'ai3b.title', [
    {key:'spacing', label:'ai3b.spacing', type:'select', value:f.spacing, options:[['smooth', 'ai3b.smooth'], ['steps', 'ai3b.steps'], ['distance', 'ai3b.distance']]},
    {key:'steps', label:'ai3b.stepsN', type:'number', value:f.steps}, {key:'distance', label:'ai3b.distanceV', type:'number', value:f.distance},
    {key:'orientation', label:'ai3b.orientation', type:'radio', value:f.orientation, options:[['page', 'ai3b.page'], ['path', 'ai3b.path']]}
  ], v => {
    const q = {spacing:v.spacing, orientation:v.orientation};
    if (v.spacing === 'steps') q.steps = Math.min(Math.max(Math.round(v.steps), 1), 1000); else if (v.spacing === 'distance') q.distance = v.distance;
    return CMD.run('ai.object.blend.options', q);
  });
  return {ok:true, dialog:'blendOptions'};
});
Lang.add({
  'zh-Hant':{'ai3b.title':'漸變選項', 'ai3b.spacing':'間距', 'ai3b.smooth':'平滑顏色', 'ai3b.steps':'指定階數', 'ai3b.distance':'指定距離', 'ai3b.stepsN':'階數', 'ai3b.distanceV':'距離', 'ai3b.orientation':'方向', 'ai3b.page':'對齊頁面', 'ai3b.path':'對齊路徑'},
  'zh-Hans':{'ai3b.title':'混合选项', 'ai3b.spacing':'间距', 'ai3b.smooth':'平滑颜色', 'ai3b.steps':'指定的步数', 'ai3b.distance':'指定的距离', 'ai3b.stepsN':'步数', 'ai3b.distanceV':'距离', 'ai3b.orientation':'取向', 'ai3b.page':'对齐页面', 'ai3b.path':'对齐路径'},
  en:{'ai3b.title':'Blend Options', 'ai3b.spacing':'Spacing', 'ai3b.smooth':'Smooth Color', 'ai3b.steps':'Specified Steps', 'ai3b.distance':'Specified Distance', 'ai3b.stepsN':'Steps', 'ai3b.distanceV':'Distance', 'ai3b.orientation':'Orientation', 'ai3b.page':'Align to Page', 'ai3b.path':'Align to Path'}
});
})();

/*对象 ▸ 封套扭曲（用变形建立／重置、用网格建立／重置、用顶层对象建立、释放、封套选项…、扩展、编辑内容）：照 VectorCraft 原码
     engine/src/cmd/live.rs:125-210（登记）、905-1305  warp_kind（样式 15 种、弯曲／水平／垂直扭曲 -100..100、预设 arc 50）、envelope_defaults（新封套：保真度 50、扭曲外观开）、
         rows_cols（1..50，预设 4×4）、env_make_warp／mesh（网格＝内容外框上的平均格点）／top（最上面的路径当封套、路径吃掉）、reshaped／reset_warp／reset_mesh（保持封套形状＝沿目前曲面取样带把手）、
         env_info、envelope_shape（释放时还回来的封套形状：顶层对象＝灰色路径；变形／网格＝灰色渐变网格）、env_release、env_options（没选封套＝改新封套的预设）、
         expand_envelope（内容推过映射、成编组留原 id）、env_edit_contents（切换「编辑内容」：选内容／选封套）
     doc/src/live.rs:95-205  EnvelopeKind／EnvelopeOptions（NEW：扭曲外观开）、278-376 WarpStyle／warp_point、377-446 map_nonlinear（线段切小段＝长度/块 夹 1..64、控制点映射）、
         483-572 Coons（外框在离外接框四角最近处切成四边）、1015-1120 grid_points／grid_eval（Catmull-Rom＋边外线性外插）／surface_of／envelope_mapper、
         1122-1175 smooth_handles／envelope_grid／mesh_at、1183-1196 envelope_overlay（选中封套画网格线）、1198-1288 envelope_frame／EnvelopeMap、1356-1412 map_node、1528-1550 expand_envelope（块长＝对角线/(8+fid·56)）
     ui-egui/src/dialogs/envelope.rs  变形选项（样式、水平／垂直、弯曲、扭曲 水平／垂直）、封套网格（行、列、重置时「保持封套形状」）、封套选项（消除锯齿、保留形状方式、保真度、扭曲外观、扭曲线性渐变、扭曲图案填色）；
         选中封套时「用变形建立／用网格建立」开的是「重置」那一版
   资料：{type:'group', live:'envelope', children:[内容…, 辅助], envelope:{kind:'warp'|'mesh'|'top', style,bend,h,v,horizontal | rows,cols,handles:bool, fidelity, options, editing}}
     辅助子物件（看不见、跟着变换走）：变形＝[O, O+(1,0), O+(0,1)]（封套的 frame：转过／翻过才用，同 envelope_frame）；网格＝格点（＋有把手时每点四个把手端点）；顶层对象＝那条路径本身（r3top）。
   我们简化的：扭曲外观＝描边先轮廓化再扭曲（原码还有活效果一起扭）；渐变不扭（「扭曲线性渐变」存着但不起作用）；图案、影像不扭；释放不搬透明度（我们的物件没有透明度栏位）。 */
(function(){
'use strict';
if (window.__aiR3_envelope) return; window.__aiR3_envelope = true;
const R3 = window.AiR3, A = AIObj.A, {num, bool, reg, done, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const lerpP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STYLES = ['arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
R3.WARP_STYLES = STYLES;
/* live.rs:322-375 warp_point（正规化座标 [-1,1]²） */
function warpPoint(style, b, dh, dv, x, y){
  const PI = Math.PI, t = (y + 1) / 2, par = 1 - x * x; let x2, y2;
  switch (style){
    case 'arc':
      if (Math.abs(b) < 1e-6){ x2 = x; y2 = y; break; }
      { const sweep = Math.abs(b) * PI, r0 = 2 / sweep, yy = b > 0 ? y : -y, a = x / r0, r = r0 - yy, nx = r * Math.sin(a), ny = r0 - r * Math.cos(a); x2 = nx; y2 = b > 0 ? ny : -ny; }
      break;
    case 'arcLower': x2 = x; y2 = y + b * par * t; break;
    case 'arcUpper': x2 = x; y2 = y - b * par * (1 - t); break;
    case 'arch': x2 = x; y2 = y - b * par; break;
    case 'bulge': x2 = x; y2 = y + b * par * y; break;
    case 'shellLower': x2 = x * (1 - 0.5 * b * (1 - t)); y2 = y + b * par * t; break;
    case 'shellUpper': x2 = x * (1 - 0.5 * b * t); y2 = y - b * par * (1 - t); break;
    case 'flag': x2 = x; y2 = y + 0.5 * b * Math.sin(PI * x); break;
    case 'wave': x2 = x + 0.1 * b * Math.sin(PI * y); y2 = y + 0.3 * b * Math.sin(2 * PI * x) * (0.5 + 0.5 * t); break;
    case 'fish': x2 = x; y2 = y * (1 + 0.5 * b * Math.sin(0.75 * PI * (x + 1))); break;
    case 'rise': x2 = x; y2 = y - b * Math.pow((x + 1) / 2, 2) * 2 + b; break;
    case 'fisheye': { const r2 = x * x + y * y, s = r2 < 1 ? 1 + 0.5 * b * (1 - r2) : 1; x2 = x * s; y2 = y * s; break; }
    case 'inflate': x2 = x * (1 + 0.5 * b * (1 - y * y)); y2 = y * (1 + 0.5 * b * par); break;
    case 'squeeze': x2 = x * (1 - 0.5 * b * (1 - y * y)); y2 = y * (1 + 0.3 * b * par); break;
    case 'twist': { const r = Math.sqrt(x * x + y * y), a = -b * PI * 0.5 * Math.max(1 - r / Math.SQRT2, 0); x2 = x * Math.cos(a) - y * Math.sin(a); y2 = x * Math.sin(a) + y * Math.cos(a); break; }
    default: x2 = x; y2 = y;
  }
  if (dh !== 0) y2 *= Math.max(1 + dh * x2 * 0.5, 0);
  if (dv !== 0) x2 *= Math.max(1 + dv * y2 * 0.5, 0);
  return [x2, y2];
}
R3.warpPoint = warpPoint;
/* ── Coons（live.rs:483-572） ── */
const SIDE = 65;
function resample(poly, m){
  if (!poly.length) return new Array(m).fill([0, 0]); if (poly.length === 1) return new Array(m).fill(poly[0]);
  const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
  const total = cum[cum.length - 1], out = []; let i = 0;
  for (let k = 0; k < m; k++){ const s = m > 1 ? total * k / (m - 1) : 0; while (i + 2 < cum.length && cum[i + 1] < s) i++; out.push(lerpP(poly[i], poly[i + 1], clamp((s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-12), 0, 1))); }
  return out;
}
const segsOf = g => { const A0 = g.anchors || [], n = A0.length, cnt = n < 2 ? 0 : (g.closed ? n : n - 1), o = []; for (let i = 0; i < cnt; i++){ const a = A0[i], b = A0[(i + 1) % n]; o.push({p0:[a.x, a.y], c1:a.out || [a.x, a.y], c2:b.in || [b.x, b.y], p3:[b.x, b.y]}); } return o; };
function geomBounds(g){ let r = null; const U = p => { r = r ? {x0:Math.min(r.x0, p[0]), y0:Math.min(r.y0, p[1]), x1:Math.max(r.x1, p[0]), y1:Math.max(r.y1, p[1])} : {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}; }; (g.anchors || []).forEach(a => U([a.x, a.y])); for (const c of segsOf(g)) for (let k = 1; k < 64; k++) U(VecSel.evalCubic(c, k / 64)); return r; }
function flattenG(g, tol){ const pts = []; const push = p => { if (!pts.length || dist(pts[pts.length - 1], p) > 1e-9) pts.push(p); }; if (g.anchors && g.anchors.length) push([g.anchors[0].x, g.anchors[0].y]);
  for (const c of segsOf(g)){ const dd = Math.max(Math.hypot(c.p0[0] - 2 * c.c1[0] + c.c2[0], c.p0[1] - 2 * c.c1[1] + c.c2[1]), Math.hypot(c.c1[0] - 2 * c.c2[0] + c.p3[0], c.c1[1] - 2 * c.c2[1] + c.p3[1])); const n = clamp(Math.ceil(Math.sqrt(0.75 * dd / Math.max(tol, 1e-9))), 1, 1000); for (let k = 1; k <= n; k++) push(VecSel.evalCubic(c, k / n)); } return pts; }
function coonsRect(r){ const line = (a, b) => { const v = []; for (let i = 0; i < SIDE; i++) v.push(lerpP(a, b, i / (SIDE - 1))); return v; }; const tl = [r.x0, r.y0], tr = [r.x1, r.y0], br = [r.x1, r.y1], bl = [r.x0, r.y1]; return {top:line(tl, tr), right:line(tr, br), bottom:line(bl, br), left:line(tl, bl)}; }
function coonsFromGeom(geo){
  if (!geo || !geo.anchors || geo.anchors.length < 2) return null;
  const r = geomBounds(geo); if (!r) return null;
  let poly = flattenG(geo, Math.max((r.x1 - r.x0) + (r.y1 - r.y0), 1e-6) / 2000);
  if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < 1e-9) poly.pop();
  if (poly.length < 3) return coonsRect(r);
  let area = 0; for (let i = 0; i < poly.length; i++){ const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
  if (area < 0) poly = poly.slice().reverse();
  const near = c => { let bi = 0, bd = Infinity; poly.forEach((p, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd){ bd = d; bi = i; } }); return bi; };
  const tl = near([r.x0, r.y0]), tr = near([r.x1, r.y0]), br = near([r.x1, r.y1]), bl = near([r.x0, r.y1]), n = poly.length;
  const arc = (i, j) => { const v = [poly[i]]; let k = i; while (k !== j){ k = (k + 1) % n; v.push(poly[k]); } return v; };
  return {top:resample(arc(tl, tr), SIDE), right:resample(arc(tr, br), SIDE), bottom:resample(arc(br, bl), SIDE).reverse(), left:resample(arc(bl, tl), SIDE).reverse()};
}
const sideAt = (side, u) => { const s = u * (side.length - 1), i = Math.min(Math.max(Math.floor(s), 0), side.length - 2); return lerpP(side[i], side[i + 1], s - i); };
function coonsEval(co, u, v){
  const t = sideAt(co.top, u), b = sideAt(co.bottom, u), l = sideAt(co.left, v), rr = sideAt(co.right, v);
  const p00 = co.top[0], p10 = co.top[SIDE - 1], p01 = co.bottom[0], p11 = co.bottom[SIDE - 1];
  return [0, 1].map(i => (1 - v) * t[i] + v * b[i] + (1 - u) * l[i] + u * rr[i] - ((1 - u) * (1 - v) * p00[i] + u * (1 - v) * p10[i] + (1 - u) * v * p01[i] + u * v * p11[i]));
}
/* ── 网格（live.rs:1019-1170） ── */
const gridPoints = (r, rows, cols) => { const v = []; for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) v.push([r.x0 + (r.x1 - r.x0) * j / Math.max(cols, 1), r.y0 + (r.y1 - r.y0) * i / Math.max(rows, 1)]); return v; };
const catmull = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return [0, 1].map(k => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)); };
function gridEval(rows, cols, pts, u, v){
  const at = (r, c) => {
    const rr = clamp(r, 0, rows), cc = clamp(c, 0, cols), base = pts[rr * (cols + 1) + cc], er = r - rr, ec = c - cc; let p = base.slice();
    if (er !== 0 && rows >= 1){ const inner = clamp(rr - Math.sign(er), 0, rows), q = pts[inner * (cols + 1) + cc]; p = [p[0] + (base[0] - q[0]) * Math.abs(er), p[1] + (base[1] - q[1]) * Math.abs(er)]; }
    if (ec !== 0 && cols >= 1){ const inner = clamp(cc - Math.sign(ec), 0, cols), q = pts[rr * (cols + 1) + inner]; p = [p[0] + (base[0] - q[0]) * Math.abs(ec), p[1] + (base[1] - q[1]) * Math.abs(ec)]; }
    return p;
  };
  const su = u * cols, sv = v * rows, ci = clamp(Math.floor(su), 0, cols - 1), ri = clamp(Math.floor(sv), 0, rows - 1), fu = su - ci, fv = sv - ri;
  const rv = [0, 1, 2, 3].map(k => { const r = ri - 1 + k; return catmull(at(r, ci - 1), at(r, ci), at(r, ci + 1), at(r, ci + 2), fu); });
  return catmull(rv[0], rv[1], rv[2], rv[3], fv);
}
function smoothHandles(rows, cols, pts){
  const at = (r, c) => pts[r * (cols + 1) + c], out = [];
  const tan = (prev, p, next) => (prev && next) ? [(next[0] - prev[0]) / 2, (next[1] - prev[1]) / 2] : next ? [next[0] - p[0], next[1] - p[1]] : prev ? [p[0] - prev[0], p[1] - prev[1]] : [0, 0];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++){
    const p = at(r, c), du = tan(c > 0 ? at(r, c - 1) : null, p, c < cols ? at(r, c + 1) : null).map(x => x / 3), dv = tan(r > 0 ? at(r - 1, c) : null, p, r < rows ? at(r + 1, c) : null).map(x => x / 3);
    out.push([c < cols ? du : [0, 0], c > 0 ? [-du[0], -du[1]] : [0, 0], r < rows ? dv : [0, 0], r > 0 ? [-dv[0], -dv[1]] : [0, 0]]);
  }
  return out;
}
const toMesh = (rows, cols, pts, hs, color) => ({rows, cols, points:pts.map((p, i) => ({x:p[0], y:p[1], color:color || '#000000', opacity:1, handles:(hs && hs[i]) ? hs[i].map(h => h.slice()) : [[0, 0], [0, 0], [0, 0], [0, 0]]}))});
function meshAt(m, u, v){ const rows = Math.max(m.rows, 1), cols = Math.max(m.cols, 1), su = u * cols, sv = v * rows, c = clamp(Math.floor(su), 0, cols - 1), r = clamp(Math.floor(sv), 0, rows - 1); return MeshMath.eval(m, r, c, su - c, sv - r); }
/* GradientMesh::from_surface（live.rs:593-625；跟 MeshMath.fromGrid 同） */
const surfaceMesh = (surf, rows, cols, color) => MeshMath.fromGrid(MeshMath.evenSteps(cols), MeshMath.evenSteps(rows), (u, v) => surf(u, v), () => [color, 1]);

/* ── 封套资料（辅助子物件） ── */
const isEnv = s => !!s && s.type === 'group' && s.live === 'envelope';
const contentOf = s => R3.kidsOf(s);
const helper = s => (s.children || []).find(c => c && c.r3helper);
/* 网格封套的点与把手（从辅助路径读回；把手存成端点＝点+把手） */
function meshData(s){
  const e = s.envelope, P = helper(s).points, n = (e.rows + 1) * (e.cols + 1);
  const pts = P.slice(0, n).map(p => p.slice());
  const hs = e.handles ? pts.map((p, i) => [0, 1, 2, 3].map(k => { const q = P[n + i * 4 + k]; return [q[0] - p[0], q[1] - p[1]]; })) : null;
  return {pts, hs};
}
function setMeshData(s, pts, hs){
  const pp = pts.map(p => p.slice()); if (hs) pts.forEach((p, i) => hs[i].forEach(h => pp.push([p[0] + h[0], p[1] + h[1]])));
  helper(s).points = pp; s.envelope.handles = !!hs;
}
/* envelope_frame：辅助三点给出的仿射；轴还是正的（没转、没翻、没斜）＝单位 */
function frameOf(s){
  const P = helper(s).points, m = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[2][0] - P[0][0], P[2][1] - P[0][1], P[0][0], P[0][1]];
  return (Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12 && m[0] > 0 && m[3] > 0) ? A.I : m;
}
/* EnvelopeMap：内容外框（frame 里）→ [0,1]² → 曲面 */
function envMap(s){
  const e = s.envelope, content = contentOf(s); if (!content.length) return null;
  let F = A.I, src;
  if (e.kind === 'warp'){ F = frameOf(s); }
  if (F === A.I) src = R3.geoBounds(content);
  else { const inv = A.inverse(F); src = R3.geoBounds(content.map(c => R3.cloneXf(c, inv))); }
  if (!src) return null;
  let surf;
  const flat = (u, v) => A.apply(F, [src.x0 + u * (src.x1 - src.x0), src.y0 + v * (src.y1 - src.y0)]);
  if (e.kind === 'warp'){
    const b = clamp(e.bend, -100, 100) / 100, dh = clamp(e.h, -100, 100) / 100, dv = clamp(e.v, -100, 100) / 100, c = [(src.x0 + src.x1) / 2, (src.y0 + src.y1) / 2], hw = (src.x1 - src.x0) / 2, hh = (src.y1 - src.y0) / 2;
    const st = STYLES.includes(e.style) ? e.style : 'arc';
    surf = (u, v) => { const x = 2 * u - 1, y = 2 * v - 1; let q; if (e.horizontal !== false) q = warpPoint(st, b, dh, dv, x, y); else { const w = warpPoint(st, b, dh, dv, y, x); q = [w[1], w[0]]; } return A.apply(F, [c[0] + q[0] * hw, c[1] + q[1] * hh]); };
  } else if (e.kind === 'mesh'){
    const {pts, hs} = meshData(s);
    if (hs){ const m = toMesh(e.rows, e.cols, pts, hs); surf = (u, v) => meshAt(m, u, v); }
    else if (e.rows >= 1 && e.cols >= 1 && pts.length === (e.rows + 1) * (e.cols + 1)) surf = (u, v) => gridEval(e.rows, e.cols, pts, u, v);
    else surf = flat;
  } else {
    const co = coonsFromGeom(VecSel.asBezier(helper(s)));
    surf = co ? (u, v) => coonsEval(co, u, v) : flat;
  }
  const inv = A.inverse(F), w = Math.max(src.x1 - src.x0, 1e-9), h = Math.max(src.y1 - src.y0, 1e-9);
  return {src, F, surf, map(p){ const q = A.apply(inv, p); return surf((q[0] - src.x0) / w, (q[1] - src.y0) / h); }};
}
R3.envMap = envMap;
/* ── map_nonlinear（live.rs:401-446） ── */
function subCubic(c, t0, t1){
  const [, r] = t0 > 0 ? VecSel.splitCubic(c, t0) : [null, c];
  const u = t0 >= 1 ? 1 : (t1 - t0) / (1 - t0);
  return u >= 1 ? r : VecSel.splitCubic(r, u)[0];
}
function mapView(v, maxPiece, f){
  maxPiece = Math.max(maxPiece, 1e-3);
  const An = v.anchors, n = An.length; if (!n) return {anchors:[], closed:!!v.closed};
  const segs = n < 2 ? 0 : (v.closed ? n : n - 1), res = []; let pending = null;
  for (let i = 0; i < n; i++){
    const a = An[i], ap = [a.x, a.y], hi = pending || f(a.in || ap); pending = null;
    res.push({p:f(ap), hi, ho:f(a.out || ap)});
    if (i < segs){
      const b = An[(i + 1) % n], line = !a.out && !b.in;
      let c = {p0:ap, c1:a.out || ap, c2:b.in || [b.x, b.y], p3:[b.x, b.y]};
      if (line) c = {p0:c.p0, c1:lerpP(c.p0, c.p3, 1 / 3), c2:lerpP(c.p0, c.p3, 2 / 3), p3:c.p3};
      const pl = dist(c.p0, c.c1) + dist(c.c1, c.c2) + dist(c.c2, c.p3), k = clamp(Math.ceil(pl / maxPiece), 1, 64);
      for (let j = 0; j < k; j++){
        const sb = subCubic(c, j / k, (j + 1) / k);
        res[res.length - 1].ho = f(sb.c1);
        if (j + 1 < k) res.push({p:f(sb.p3), hi:f(sb.c2), ho:f(sb.p3)}); else pending = f(sb.c2);
      }
    }
  }
  if (pending && v.closed) res[0].hi = pending;
  return {closed:!!v.closed, anchors:res.map(a => ({x:a.p[0], y:a.p[1], in:a.hi, out:a.ho}))};
}
/* 描边轮廓化（扭曲外观：描边先变成填色的轮廓再一起扭）——跟 ai-object 的 outline_strokes 同一套替代实作 */
function outlineStroke(l){
  const views = R3.subviews(l); if (!views.length) return null;
  const pieces = []; for (const v of views) pieces.push(...AIObj.strokePieces(AIObj.flatten(v), !!v.closed, l.strokeWidth, 'round', 'round', 4));
  if (!pieces.length) return null;
  const loops = AIObj.arrangement([{polys:pieces, rule:'nonzero'}], m => m[0]).map(AIObj.tidyLoop).filter(Boolean);
  if (!loops.length) return null;
  const st = {fill:clone(l.stroke), stroke:'none', strokeWidth:0};
  return loops.length === 1 ? Object.assign({id:R3.newId(), type:'bezier', anchors:loops[0].anchors, closed:true}, st)
    : Object.assign({id:R3.newId(), type:'compound', rule:'nonzero', children:loops.map(v => ({id:R3.newId(), type:'bezier', anchors:v.anchors, closed:true, fill:'none', stroke:'none', strokeWidth:0}))}, st);
}
/* map_node（live.rs:1356-1412） */
function mapNode(n, W, depth){
  if (W.distortAppearance && depth < 16 && (R3.isLeaf(n) || n.type === 'compound') && R3.hasStroke(n) && !n.r3outlined){
    const o = outlineStroke(n);
    if (o){ const parts = []; if (R3.painted(n.fill)){ const c = clone(n); c.stroke = 'none'; c.strokeWidth = 0; parts.push(c); } parts.push(o); parts.forEach(p => { p.r3outlined = true; }); return mapNode({id:n.id, type:'group', children:parts}, W, depth + 1); }
  }
  if (n.live && depth < 16){
    if (n.live === 'blend' && R3.blendExpand) return mapNode({id:n.id, type:'group', children:R3.blendExpand(n)}, W, depth + 1);
    if (n.live === 'repeat' && R3.repeatTransforms){ const src = R3.kidsOf(n); return mapNode({id:n.id, type:'group', children:R3.repeatTransforms(n).map(m => ({id:R3.newId(), type:'group', children:src.map(c => R3.cloneXf(c, m))}))}, W, depth + 1); }
    if (n.live === 'envelope') return mapNode({id:n.id, type:'group', children:expandEnv(n)}, W, depth + 1);
  }
  const out = clone(n); delete out.r3outlined;
  if (R3.isLeaf(out)){ const v = VecSel.asBezier(n), mv = mapView(v, W.piece, W.f); R3.LEAF.forEach(() => {}); ['x', 'y', 'w', 'h', 'radius', 'cx', 'cy', 'r1', 'r2', 'points', 'rotation', 'rx', 'ry'].forEach(k => delete out[k]); out.type = 'bezier'; out.anchors = mv.anchors; out.closed = mv.closed; delete out.bboxAngle; return out; }
  if (R3.isCont(out)){ out.children = n.children.filter(c => !c.r3helper).map(c => mapNode(c, W, depth)); delete out.live; return out; }
  if (out.type === 'mesh' && out.mesh){ out.mesh.points.forEach(q => { const p = [q.x, q.y], m = W.f(p); q.handles = (q.handles || []).map(h => { const e = W.f([p[0] + h[0], p[1] + h[1]]); return [e[0] - m[0], e[1] - m[1]]; }); q.x = m[0]; q.y = m[1]; }); return out; }
  return out;
}
/* expand_envelope（live.rs:1534-1550） */
function expandEnv(s){
  const map = envMap(s), content = contentOf(s); if (!map) return content.map(clone);
  const e = s.envelope, fid = isFinite(e.fidelity) ? clamp(e.fidelity, 0, 100) / 100 : 0.5, src = map.src;
  const W = {f:p => map.map(p), piece:Math.max(Math.hypot(src.x1 - src.x0, src.y1 - src.y0), 1e-6) / (8 + fid * 56), distortAppearance:!!(e.options && e.options.distortAppearance)};
  return content.map(c => mapNode(c, W, 0));
}
R3.expandEnv = expandEnv;
const _cache = new WeakMap();
function evaluated(s){ const key = JSON.stringify([s.children, s.envelope]), c = _cache.get(s); if (c && c.key === key) return c.nodes; const nodes = expandEnv(s); _cache.set(s, {key, nodes}); return nodes; }
R3.live.envelope = {
  draw(ctx, s, S){ for (const n of evaluated(s)) window.drawShape(ctx, n, S); },
  svg(s){ return '<g>' + evaluated(s).map(n => ObjRender.toSVG(n)).join('') + '</g>'; }
};
/* 选中封套的叠画（envelope_overlay：变形＝4×4 曲面线、网格＝自己的格线、顶层对象＝它的路径） */
R3.overlays.push(function(ctx, S){
  if (!window.VecSel || VecSel.isEmpty() || !window.AiView || !AiView.flags.edges) return;
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return;
  const envs = VecSel.shapes.map(id => R3.findDeep(id, L)).filter(h => h && isEnv(h.s)).map(h => h.s); if (!envs.length) return;
  ctx.save(); ctx.translate(L.x * S, L.y * S); ctx.strokeStyle = '#2f7fd8'; ctx.lineWidth = 1;
  for (const s of envs){
    const map = envMap(s); if (!map) continue;
    ctx.beginPath();
    if (s.envelope.kind === 'top'){ bezierPath(ctx, VecSel.asBezier(helper(s)), S); }
    else {
      const m = s.envelope.kind === 'mesh' ? (() => { const {pts, hs} = meshData(s); return toMesh(s.envelope.rows, s.envelope.cols, pts, hs || smoothHandles(s.envelope.rows, s.envelope.cols, pts)); })() : surfaceMesh(map.surf, 4, 4, '#000000');
      for (let r = 0; r <= m.rows; r++) for (let c = 0; c < m.cols; c++){ const e = MeshMath.edgeU(m, r, c); ctx.moveTo(e.p0[0] * S, e.p0[1] * S); ctx.bezierCurveTo(e.c1[0] * S, e.c1[1] * S, e.c2[0] * S, e.c2[1] * S, e.p3[0] * S, e.p3[1] * S); }
      for (let c = 0; c <= m.cols; c++) for (let r = 0; r < m.rows; r++){ const e = MeshMath.edgeV(m, r, c); ctx.moveTo(e.p0[0] * S, e.p0[1] * S); ctx.bezierCurveTo(e.c1[0] * S, e.c1[1] * S, e.c2[0] * S, e.c2[1] * S, e.p3[0] * S, e.p3[1] * S); }
    }
    ctx.stroke();
  }
  ctx.restore();
});

/* ═════ 命令 ═════ */
const NEW_OPTIONS = {antiAlias:true, preserveShape:'clippingMask', distortAppearance:true, distortLinearGradients:false, distortPatternFills:false};   // EnvelopeOptions::NEW
R3.envDefaults = {options:clone(NEW_OPTIONS), fidelity:50};
function selectedEnvs(){
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return {L:null, R:[]};
  const out = [];
  for (const id of VecSel.shapes){ let h = R3.findDeep(id, L), hit = null; while (h){ if (isEnv(h.s)) hit = h.s; h = h.parent ? R3.findDeep(h.parent.id, L) : null; } if (hit && !out.includes(hit)) out.push(hit); }
  return {L, R:out};
}
function warpKind(p, C, cur){
  let k = cur && cur.kind === 'warp' ? {style:cur.style, bend:cur.bend, h:cur.h, v:cur.v, horizontal:cur.horizontal !== false} : {style:'arc', bend:50, h:0, v:0, horizontal:true};
  if (typeof p.style === 'string'){ const s = p.style.replace(/^warp\./, ''); if (!STYLES.includes(s)) return {err:err(C, `unknown warp style \`${s}\``)}; k.style = s; }
  k.bend = clamp(num(p.bend, k.bend), -100, 100);
  k.h = clamp(num(p.h, num(p.horizontalDistortion, k.h)), -100, 100);
  k.v = clamp(num(p.v, num(p.verticalDistortion, k.v)), -100, 100);
  k.horizontal = p.orientation === 'vertical' ? false : p.orientation === 'horizontal' ? true : bool(p.horizontal, k.horizontal);
  return {k};
}
function rowsCols(p, C, d){
  const rows = num(p.rows, d[0]), cols = num(p.cols, num(p.columns, d[1]));
  if (!(rows >= 1 && rows <= 50 && cols >= 1 && cols <= 50)) return {err:err(C, 'rows and cols must be 1..50')};
  return {rows:Math.floor(rows), cols:Math.floor(cols)};
}
/* wrap：选中物件收进新封套，放在最上面那个的位置 */
function wrapEnv(t, env, helperNode){
  const S = t.L.data.shapes, top = t.R[t.R.length - 1], idx = S.indexOf(top);
  const g = {id:R3.newId(), type:'group', live:'envelope', children:t.R.concat([helperNode]), envelope:Object.assign(env, {fidelity:R3.envDefaults.fidelity, options:clone(R3.envDefaults.options), editing:false})};
  S.splice(idx + 1, 0, g);
  t.L.data.shapes = S.filter(s => !t.R.includes(s));
  R3.selectIds(t.L, [g.id]);
  return done(t.L, {id:g.id});
}
reg('ai.object.envelope.makeWithWarp', {undoable:true, params:'{ids?, style?: "arc"|"arcLower"|"arcUpper"|"arch"|"bulge"|"shellLower"|"shellUpper"|"flag"|"wave"|"fish"|"rise"|"fisheye"|"inflate"|"squeeze"|"twist"（预设 arc）, bend?: -100..100 (50), h?, v?: 扭曲 -100..100, horizontal?: bool | orientation?: "horizontal"|"vertical"} 对象 ▸ 封套扭曲 ▸ 用变形建立（live.rs:947-958）→ {ok, id}'}, p => {
  const C = 'ai.object.envelope.makeWithWarp', w = warpKind(p, C, null); if (w.err) return w.err;
  const t = R3.targets(p, C); if (t.err) return err(C, 'nothing selected');
  return wrapEnv(t, Object.assign({kind:'warp'}, w.k), R3.mkHelper([[0, 0], [1, 0], [0, 1]]));
});
reg('ai.object.envelope.makeWithMesh', {undoable:true, params:'{ids?, rows?: 1..50 (4), cols?|columns?: 1..50 (4)} 对象 ▸ 封套扭曲 ▸ 用网格建立（live.rs:969-981）：内容外框上铺平均格点 → {ok, id}'}, p => {
  const C = 'ai.object.envelope.makeWithMesh', rc = rowsCols(p, C, [4, 4]); if (rc.err) return rc.err;
  const t = R3.targets(p, C); if (t.err) return err(C, 'selection has no bounds');
  const src = R3.geoBounds(t.R); if (!src) return err(C, 'selection has no bounds');
  return wrapEnv(t, {kind:'mesh', rows:rc.rows, cols:rc.cols, handles:false}, R3.mkHelper(gridPoints(src, rc.rows, rc.cols)));
});
reg('ai.object.envelope.makeWithTopObject', {undoable:true, params:'{ids?} 对象 ▸ 封套扭曲 ▸ 用顶层对象建立（live.rs:993-1010）：最上面的路径当封套形状（路径吃掉），下面的物件是内容 → {ok, id}'}, p => {
  const C = 'ai.object.envelope.makeWithTopObject';
  const t = R3.targets(p, C); if (t.err || t.R.length < 2) return err(C, 'select the content and a path on top');
  const top = t.R[t.R.length - 1];
  let v = null;
  if (R3.isLeaf(top)) v = VecSel.asBezier(top);
  else if (top.type === 'compound'){ const vs = top.children.map(c => VecSel.asBezier(c)).filter(Boolean); v = vs.sort((a, b) => { const ba = geomBounds(a), bb = geomBounds(b); return ((bb.x1 - bb.x0) * (bb.y1 - bb.y0)) - ((ba.x1 - ba.x0) * (ba.y1 - ba.y0)); })[0]; }
  if (!v || !v.anchors || v.anchors.length < 2 || !geomBounds(v)) return err(C, 'the top object must be a path');
  t.L.data.shapes = t.L.data.shapes.filter(s => s !== top);
  const h = {id:R3.newId(), type:'bezier', anchors:clone(v.anchors), closed:!!v.closed, fill:'none', stroke:'none', strokeWidth:0, visible:false, r3helper:true, r3top:true};
  return wrapEnv({L:t.L, R:t.R.slice(0, -1)}, {kind:'top'}, h);
});
reg('ai.object.envelope.resetWithWarp', {undoable:true, params:'{style?, bend?, h?, v?, horizontal?|orientation?} 对象 ▸ 封套扭曲 ▸ 用变形重置（live.rs:1038-1042）：选中的封套改成变形（没给的栏位沿用目前的变形）→ {ok}'}, p => {
  const C = 'ai.object.envelope.resetWithWarp';
  const {L, R} = selectedEnvs(); if (!R.length) return err(C, 'select an envelope');
  for (const s of R){
    const w = warpKind(p, C, s.envelope); if (w.err) return w.err;
    const keep = {fidelity:s.envelope.fidelity, options:s.envelope.options, editing:s.envelope.editing};
    s.envelope = Object.assign({kind:'warp'}, w.k, keep);
    s.children = contentOf(s).concat([R3.mkHelper([[0, 0], [1, 0], [0, 1]])]);
  }
  return done(L);
});
reg('ai.object.envelope.resetWithMesh', {undoable:true, params:'{rows?, cols?（缺省＝目前网格的或 4×4）, maintainShape?: bool=true（沿目前曲面取样、带把手＝保持形状；false＝内容外框上的平均格点）} 对象 ▸ 封套扭曲 ▸ 用网格重置（live.rs:1044-1058）→ {ok}'}, p => {
  const C = 'ai.object.envelope.resetWithMesh';
  const {L, R} = selectedEnvs(); if (!R.length) return err(C, 'select an envelope');
  const maintain = bool(p.maintainShape, true);
  for (const s of R){
    const own = s.envelope.kind === 'mesh' ? [s.envelope.rows, s.envelope.cols] : [4, 4], rc = rowsCols(p, C, own); if (rc.err) return rc.err;
    const map = envMap(s); if (!map) return err(C, "the envelope's content has no bounds");
    const keep = {fidelity:s.envelope.fidelity, options:s.envelope.options, editing:s.envelope.editing};
    s.envelope = Object.assign({kind:'mesh', rows:rc.rows, cols:rc.cols, handles:false}, keep);
    s.children = contentOf(s).concat([R3.mkHelper([[0, 0]])]);
    if (maintain){ const m = surfaceMesh(map.surf, rc.rows, rc.cols, '#000000'); setMeshData(s, m.points.map(q => [q.x, q.y]), m.points.map(q => q.handles)); }
    else setMeshData(s, gridPoints(map.src, rc.rows, rc.cols).map(q => A.apply(map.F, q)), null);
  }
  return done(L);
});
reg('ai.object.envelope.info', {params:'{} 第一个选中封套的种类、参数与选项（没选＝新封套的预设）→ {ok, id|null, type?, style?, bend?, h?, v?, horizontal?, rows?, cols?, fidelity, antiAlias, preserveShape, distortAppearance, distortLinearGradients, distortPatternFills, editing?}'}, () => {
  const {R} = selectedEnvs();
  if (!R.length) return Object.assign({ok:true, id:null, fidelity:R3.envDefaults.fidelity}, R3.envDefaults.options);
  const e = R[0].envelope, v = {ok:true, id:R[0].id, type:e.kind === 'top' ? 'topObject' : e.kind, editing:!!e.editing, fidelity:e.fidelity};
  if (e.kind === 'warp') Object.assign(v, {style:e.style, bend:e.bend, h:e.h, v:e.v, horizontal:e.horizontal !== false});
  if (e.kind === 'mesh') Object.assign(v, {rows:e.rows, cols:e.cols});
  return Object.assign(v, e.options);
});
/* envelope_shape（live.rs:1107-1124）：释放时还回来的灰色封套形状 */
const GREY = '#404040';
function envelopeShape(s){
  const e = s.envelope;
  if (e.kind === 'top'){ const h = helper(s); return {id:R3.newId(), type:'bezier', anchors:clone(h.anchors), closed:!!h.closed, fill:GREY, stroke:'none', strokeWidth:0}; }
  if (e.kind === 'mesh'){ const {pts, hs} = meshData(s); return {id:R3.newId(), type:'mesh', fill:'none', stroke:'none', strokeWidth:0, mesh:toMesh(e.rows, e.cols, pts, hs || smoothHandles(e.rows, e.cols, pts), GREY)}; }
  const map = envMap(s); if (!map) return null;
  return {id:R3.newId(), type:'mesh', fill:'none', stroke:'none', strokeWidth:0, mesh:surfaceMesh(map.surf, 4, 4, GREY)};
}
reg('ai.object.envelope.release', {undoable:true, params:'{} 对象 ▸ 封套扭曲 ▸ 释放（live.rs:1149-1167）：内容放回来（没扭的原样），封套形状还回来成一个灰色物件（顶层对象＝路径；变形／网格＝渐变网格），全部选中 → {ok, ids}'}, () => {
  const {L, R} = selectedEnvs(); if (!R.length) return err('ai.object.envelope.release', 'select an envelope');
  const out = [];
  for (const s of R){ const nodes = contentOf(s).slice(), sh = envelopeShape(s); if (sh) nodes.push(sh); const h = R3.findDeep(s.id, L); h.arr.splice(h.idx, 1, ...nodes); nodes.forEach(n => out.push(n.id)); }
  R3.selectDeep(L, out); return done(L, {ids:out});
});
reg('ai.object.envelope.expand', {undoable:true, params:'{} 对象 ▸ 封套扭曲 ▸ 扩展（live.rs:1207-1249）：选中的封套换成扭曲后的内容编组（留原 id；扭曲外观开着时描边已轮廓化）→ {ok, ids}'}, () => {
  const {L, R} = selectedEnvs(); if (!R.length) return err('ai.object.envelope.expand', 'select an envelope');
  for (const s of R){ const g = {id:s.id, type:'group', children:expandEnv(s).map(n => R3.reid(n))}; if (s.name) g.name = s.name; const h = R3.findDeep(s.id, L); h.arr.splice(h.idx, 1, g); }
  R3.selectDeep(L, R.map(s => s.id)); return done(L, {ids:R.map(s => s.id)});
});
R3.regEdit('ai.object.envelope.options', {params:'{fidelity?: 0..100, antiAlias?, preserveShape?: "clippingMask"|"transparency", distortAppearance?, distortLinearGradients?, distortPatternFills?（变形封套也收 style／bend／h／v／horizontal）} 对象 ▸ 封套扭曲 ▸ 封套选项…（live.rs:1169-1205）：设选中封套的选项（一步历史）；没选封套＝改新封套的预设（不进历史）→ {ok}'}, (p, touch) => {
  const C = 'ai.object.envelope.options';
  if (p.fidelity !== undefined && !(+p.fidelity >= 0 && +p.fidelity <= 100)) return err(C, 'fidelity must be 0..100');
  if (p.preserveShape !== undefined && !['clippingMask', 'transparency'].includes(p.preserveShape)) return err(C, 'preserveShape must be clippingMask|transparency');
  const opt = cur => ({antiAlias:bool(p.antiAlias, cur.antiAlias), preserveShape:p.preserveShape || cur.preserveShape, distortAppearance:bool(p.distortAppearance, cur.distortAppearance),
    distortLinearGradients:bool(p.distortLinearGradients, cur.distortLinearGradients), distortPatternFills:bool(p.distortPatternFills, cur.distortPatternFills)});
  const {L, R} = selectedEnvs();
  if (!R.length){ R3.envDefaults = {options:opt(R3.envDefaults.options), fidelity:p.fidelity !== undefined ? +p.fidelity : R3.envDefaults.fidelity}; return {ok:true, defaults:true}; }
  const ups = [];
  for (const s of R){ let k = null; if (s.envelope.kind === 'warp'){ const w = warpKind(p, C, s.envelope); if (w.err) return w.err; k = w.k; } ups.push([s, k]); }
  touch();
  for (const [s, k] of ups){ if (k) Object.assign(s.envelope, k); s.envelope.options = opt(s.envelope.options || NEW_OPTIONS); if (p.fidelity !== undefined) s.envelope.fidelity = +p.fidelity; }
  return done(L);
});
reg('ai.object.envelope.editContents', {undoable:true, params:'{editing?: bool（缺省＝切换）} 对象 ▸ 封套扭曲 ▸ 编辑内容（live.rs:1251-1273）：进入＝选取改成封套的内容（深层选取，可以改内容）；再点＝回到选封套 → {ok, editing}'}, p => {
  const {L, R} = selectedEnvs(); if (!R.length) return err('ai.object.envelope.editContents', 'select an envelope');
  const want = bool(p.editing, !R[0].envelope.editing), ids = [];
  R.forEach(s => { s.envelope.editing = want; contentOf(s).forEach(c => ids.push(c.id)); });
  R3.selectDeep(L, want ? ids : R.map(s => s.id));
  return done(L, {editing:want});
});
/* ── 对话框（dialogs/envelope.rs） ── */
function warpDialog(reset){
  const info = CMD.map['ai.object.envelope.info'].run({}), w = info.type === 'warp';
  R3.form('envelopeWarp', 'ai3e.warpTitle', [
    {key:'style', label:'ai3e.style', type:'select', value:w ? info.style : 'arc', options:STYLES.map(s => [s, 'ai3e.s.' + s])},
    {key:'orient', type:'radio', value:(!w || info.horizontal) ? 'horizontal' : 'vertical', options:[['horizontal', 'ai3e.horizontal'], ['vertical', 'ai3e.vertical']]},
    {key:'bend', label:'ai3e.bend', type:'number', value:w ? info.bend : 50},
    {label:'ai3e.distortion', type:'head'}, {key:'h', label:'ai3e.horizontal', type:'number', value:w ? info.h : 0}, {key:'v', label:'ai3e.vertical', type:'number', value:w ? info.v : 0}
  ], v => CMD.run(reset ? 'ai.object.envelope.resetWithWarp' : 'ai.object.envelope.makeWithWarp', {style:v.style, horizontal:v.orient === 'horizontal', bend:v.bend, h:v.h, v:v.v}));
  return {ok:true, dialog:'envelopeWarp'};
}
function meshDialog(reset){
  const info = CMD.map['ai.object.envelope.info'].run({}), m = info.type === 'mesh';
  R3.form('envelopeMesh', reset ? 'ai3e.resetMeshTitle' : 'ai3e.meshTitle', [
    {key:'rows', label:'ai3e.rows', type:'number', value:m ? info.rows : 4}, {key:'cols', label:'ai3e.cols', type:'number', value:m ? info.cols : 4}]
    .concat(reset ? [{key:'maintainShape', label:'ai3e.maintain', type:'check', value:true}] : []),
  v => { const q = {rows:Math.min(Math.max(Math.round(v.rows), 1), 50), cols:Math.min(Math.max(Math.round(v.cols), 1), 50)}; if (reset) q.maintainShape = v.maintainShape; return CMD.run(reset ? 'ai.object.envelope.resetWithMesh' : 'ai.object.envelope.makeWithMesh', q); });
  return {ok:true, dialog:'envelopeMesh'};
}
const hasEnv = () => selectedEnvs().R.length > 0;
R3.reg('ai.object.envelope.makeWithWarp.dialog', {params:'{} 开「变形选项」对话框（选中封套时＝用变形重置）→ {ok, dialog}'}, () => { if (!hasEnv() && R3.targets({}, 'x').err) return err('ai.object.envelope.makeWithWarp', 'nothing selected'); return warpDialog(hasEnv()); });
R3.reg('ai.object.envelope.resetWithWarp.dialog', {params:'{} 开「变形选项」对话框（重置选中的封套）→ {ok, dialog}'}, () => hasEnv() ? warpDialog(true) : err('ai.object.envelope.resetWithWarp', 'select an envelope'));
R3.reg('ai.object.envelope.makeWithMesh.dialog', {params:'{} 开「封套网格」对话框（选中封套时＝用网格重置）→ {ok, dialog}'}, () => { if (!hasEnv() && R3.targets({}, 'x').err) return err('ai.object.envelope.makeWithMesh', 'nothing selected'); return meshDialog(hasEnv()); });
R3.reg('ai.object.envelope.resetWithMesh.dialog', {params:'{} 开「重置封套网格」对话框 → {ok, dialog}'}, () => hasEnv() ? meshDialog(true) : err('ai.object.envelope.resetWithMesh', 'select an envelope'));
R3.reg('ai.object.envelope.options.dialog', {params:'{} 开「封套选项」对话框（没选封套＝改新封套的预设）→ {ok, dialog}'}, () => {
  const i = CMD.map['ai.object.envelope.info'].run({});
  R3.form('envelopeOptions', 'ai3e.optTitle', [
    {label:'ai3e.rasters', type:'head'}, {key:'antiAlias', label:'ai3e.antiAlias', type:'check', value:i.antiAlias},
    {key:'preserveShape', label:'ai3e.preserve', type:'radio', value:i.preserveShape, options:[['clippingMask', 'ai3e.clip'], ['transparency', 'ai3e.transparency']]},
    {key:'fidelity', label:'ai3e.fidelity', type:'number', value:i.fidelity},
    {key:'distortAppearance', label:'ai3e.distortAppearance', type:'check', value:i.distortAppearance},
    {key:'distortLinearGradients', label:'ai3e.distortGrad', type:'check', value:i.distortLinearGradients},
    {key:'distortPatternFills', label:'ai3e.distortPattern', type:'check', value:i.distortPatternFills}
  ], v => CMD.run('ai.object.envelope.options', v));
  return {ok:true, dialog:'envelopeOptions'};
});
const SN = {arc:['弧形', '弧形', 'Arc'], arcLower:['下弧形', '下弧形', 'Arc Lower'], arcUpper:['上弧形', '上弧形', 'Arc Upper'], arch:['拱形', '拱形', 'Arch'], bulge:['凸出', '凸出', 'Bulge'],
  shellLower:['下凹殼', '凹壳', 'Shell Lower'], shellUpper:['上凸殼', '凸壳', 'Shell Upper'], flag:['旗形', '旗形', 'Flag'], wave:['波形', '波形', 'Wave'], fish:['魚形', '鱼形', 'Fish'],
  rise:['上升', '上升', 'Rise'], fisheye:['魚眼', '鱼眼', 'Fisheye'], inflate:['膨脹', '膨胀', 'Inflate'], squeeze:['擠壓', '挤压', 'Squeeze'], twist:['扭轉', '扭转', 'Twist']};
const sn = k => Object.fromEntries(STYLES.map(s => ['ai3e.s.' + s, SN[s][k]]));
Lang.add({
  'zh-Hant':Object.assign({'ai3e.warpTitle':'彎曲選項', 'ai3e.style':'樣式', 'ai3e.horizontal':'水平', 'ai3e.vertical':'垂直', 'ai3e.bend':'彎曲 (%)', 'ai3e.distortion':'扭曲', 'ai3e.meshTitle':'封套網格', 'ai3e.resetMeshTitle':'重設封套網格',
    'ai3e.rows':'橫欄', 'ai3e.cols':'直欄', 'ai3e.maintain':'保留封套形狀', 'ai3e.optTitle':'封套選項', 'ai3e.rasters':'點陣', 'ai3e.antiAlias':'消除鋸齒', 'ai3e.preserve':'保留形狀使用：', 'ai3e.clip':'剪裁遮色片', 'ai3e.transparency':'透明度',
    'ai3e.fidelity':'精確度', 'ai3e.distortAppearance':'扭曲外觀', 'ai3e.distortGrad':'扭曲線性漸層填色', 'ai3e.distortPattern':'扭曲圖樣填色'}, sn(0)),
  'zh-Hans':Object.assign({'ai3e.warpTitle':'变形选项', 'ai3e.style':'样式', 'ai3e.horizontal':'水平', 'ai3e.vertical':'垂直', 'ai3e.bend':'弯曲 (%)', 'ai3e.distortion':'扭曲', 'ai3e.meshTitle':'封套网格', 'ai3e.resetMeshTitle':'重置封套网格',
    'ai3e.rows':'行数', 'ai3e.cols':'列数', 'ai3e.maintain':'保持封套形状', 'ai3e.optTitle':'封套选项', 'ai3e.rasters':'栅格', 'ai3e.antiAlias':'消除锯齿', 'ai3e.preserve':'保留形状，使用：', 'ai3e.clip':'剪切蒙版', 'ai3e.transparency':'透明度',
    'ai3e.fidelity':'保真度', 'ai3e.distortAppearance':'扭曲外观', 'ai3e.distortGrad':'扭曲线性渐变填充', 'ai3e.distortPattern':'扭曲图案填充'}, sn(1)),
  en:Object.assign({'ai3e.warpTitle':'Warp Options', 'ai3e.style':'Style', 'ai3e.horizontal':'Horizontal', 'ai3e.vertical':'Vertical', 'ai3e.bend':'Bend (%)', 'ai3e.distortion':'Distortion', 'ai3e.meshTitle':'Envelope Mesh', 'ai3e.resetMeshTitle':'Reset Envelope Mesh',
    'ai3e.rows':'Rows', 'ai3e.cols':'Columns', 'ai3e.maintain':'Maintain Envelope Shape', 'ai3e.optTitle':'Envelope Options', 'ai3e.rasters':'Rasters', 'ai3e.antiAlias':'Anti-Alias', 'ai3e.preserve':'Preserve Shape Using:', 'ai3e.clip':'Clipping Mask', 'ai3e.transparency':'Transparency',
    'ai3e.fidelity':'Fidelity', 'ai3e.distortAppearance':'Distort Appearance', 'ai3e.distortGrad':'Distort Linear Gradient Fills', 'ai3e.distortPattern':'Distort Pattern Fills'}, sn(2))
});
})();

/*对象 ▸ 文本绕排（建立／释放／文本绕排选项…）：照 VectorCraft 原码
     engine/src/cmd/textwrap.rs 1-225  make（选中物件带 wrap 选项：位移 6、反向绕排 关）／release（没有绕排物件＝失败）／options（不给参数＝读目前的值）、
         outline（绕排物件的轮廓：路径＝它的子路径（闭合或 3 点以上）；编组／复合路径往下收；剪切组＝剪切路径；其它＝外框矩形）、
         refresh（每个区域文字取它「上面」的绕排物件）
     doc/src/text.rs:310-321   TextWrap 预设（位移 6 点、反向 关）
     text/src/layout.rs:207-330 poly_intervals（奇偶）／union／subtract／intersect、Region::intervals（绕排形状上下各取 ±位移、±位移/2 共 5 条线、左右再外扩位移；反向＝取交集）、
         spans（一行的上下缘之间取 5 条线，绕排时每条线都空着的部分才算，左到右排）；layout.rs:440-470 Pen::place（放不下的行往下挪一个行距、跨在物件两边的行先排左段再排右段）
     ui-egui/src/menus.rs:2313-2321  文本绕排选项…＝参数对话框（位移、反向绕排）
   我们这边：
     · 绕排物件＝矢量层里带 s.wrap={offset, invert} 的物件；区域文字＝文字层（有 box 的）。原码是「同一层、物件在文字上面」；我们文字是独立图层 ⇒ 取「画在这个文字层上面」的所有可见矢量层里的绕排物件。
     · 排版：链式包 window.renderLayer：文字层有绕排物件挡到时，照上面的 span 规则自己排（每个 span 贪心塞字，空白／中日韩字之间可断）、自己画；没有就照旧。
     · 🔴 文字工具的游标／选取框还是照没绕排的版面算（tools/text.js 的 layout 要接这里的版面才会对）。 */
(function(){
'use strict';
if (window.__aiR3_textWrap) return; window.__aiR3_textWrap = true;
const R3 = window.AiR3, {num, bool, reg, regEdit, done, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const DEF = {offset:6, invert:false};
const wrapParam = (p, base) => ({offset:Math.min(Math.max(num(p.offset, base.offset), -1000), 1000), invert:bool(p.invert, base.invert)});
function tg(p, C){
  const L = R3.vLayer(p); if (!L) return {err:err(C, 'not a vector layer')};
  const R = R3.roots(L, Array.isArray(p.ids) ? p.ids : null);
  if (!R.length) return {err:err(C, 'nothing selected')};
  return {L, R};
}
reg('ai.object.textWrap.make', {undoable:true, params:'{offset?: 点 (6), invert?: bool, ids?} 对象 ▸ 文本绕排 ▸ 建立（textwrap.rs:53-67）：选中的物件变成绕排物件——画在它下面的区域文字（有框的文字层）绕开它排 → {ok, ids}'}, p => {
  const t = tg(p, 'ai.object.textWrap.make'); if (t.err) return t.err;
  const w = wrapParam(p, DEF); t.R.forEach(s => { s.wrap = clone(w); });
  invalidateText(); return done(t.L, {ids:t.R.map(s => s.id)});
});
reg('ai.object.textWrap.release', {undoable:true, params:'{ids?} 对象 ▸ 文本绕排 ▸ 释放（textwrap.rs:69-87）：选中的绕排物件拿掉绕排；一个都不是＝失败 → {ok, ids}'}, p => {
  const t = tg(p, 'ai.object.textWrap.release'); if (t.err) return t.err;
  const R = t.R.filter(s => s.wrap); if (!R.length) return {ok:false, error:'Text Wrap: select a wrap object'};
  R.forEach(s => { delete s.wrap; }); invalidateText(); return done(t.L, {ids:R.map(s => s.id)});
});
regEdit('ai.object.textWrap.options', {params:'{offset?, invert?, ids?} 对象 ▸ 文本绕排 ▸ 文本绕排选项…（textwrap.rs:89-111）：设选中物件的绕排选项（一步历史）；不给参数＝读目前的值 → {ok, offset, invert}'}, (p, touch) => {
  const t = tg(p, 'ai.object.textWrap.options'); if (t.err) return t.err;
  const cur = (t.R.find(s => s.wrap) || {}).wrap || DEF;
  if (p.offset === undefined && p.invert === undefined) return {ok:true, offset:cur.offset, invert:cur.invert};
  const w = wrapParam(p, cur); touch(); t.R.forEach(s => { s.wrap = clone(w); });
  invalidateText(); return done(t.L, {offset:w.offset, invert:w.invert});
});
R3.reg('ai.object.textWrap.options.dialog', {params:'{} 开「文本绕排选项」对话框（位移、反向绕排；确定＝ai.object.textWrap.options）→ {ok, dialog}'}, () => {
  const o = CMD.map['ai.object.textWrap.options'].run({}); if (!o || o.ok === false) return o;
  R3.form('textWrapOptions', 'ai3w.title', [{key:'offset', label:'ai3w.offset', type:'number', value:o.offset}, {key:'invert', label:'ai3w.invert', type:'check', value:o.invert}],
    v => CMD.run('ai.object.textWrap.options', v));
  return {ok:true, dialog:'textWrapOptions'};
});

/* ── 绕排物件的轮廓（textwrap.rs:113-135；文件坐标折线） ── */
function outline(L, n, out){
  const F = p => [p[0] + L.x, p[1] + L.y];
  if (R3.isLeaf(n) && !n.guide){ const v = VecSel.asBezier(n); if (v && v.anchors && (v.closed || v.anchors.length > 2)){ const P = AIObj.flatten(v).map(F); if (P.length >= 3) out.push(P); } return; }
  if (n.type === 'compound' || (n.type === 'group' && !n.clip)){ (n.children || []).filter(c => c.visible !== false && !c.r3helper).forEach(c => outline(L, c, out)); return; }
  if (n.type === 'group' && n.clip){ if (n.children[0]) outline(L, n.children[0], out); return; }
  const b = AIObj.shapeBounds(n, F, false); if (b) out.push([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]);
}
/* 文字层 T 上面的可见矢量层里的绕排物件 → [{polys, offset, invert}] */
function wrapsFor(T){
  const i = Doc.layers.indexOf(T), out = [];
  for (const L of Doc.layers.slice(i + 1)){
    if (L.kind !== 'vector' || !L.visible) continue;
    const go = arr => arr.forEach(s => { if (s.visible === false) return; if (s.wrap){ const P = []; outline(L, s, P); if (P.length) out.push({polys:P, offset:Math.max(+s.wrap.offset || 0, 0), invert:!!s.wrap.invert}); return; } if (s.type === 'group' && !s.live) go(s.children || []); });
    go(L.data.shapes);
  }
  return out;
}
R3.textWrapsFor = wrapsFor;
function invalidateText(){ Doc.layers.forEach(L => { if (L.kind === 'text') Layer.invalidate(L); }); }
/* layout.rs:207-265 区间运算 */
function polyIntervals(polys, y){
  const xs = []; for (const P of polys) for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
  xs.sort((a, b) => a - b); const out = []; for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]); return out;
}
function unionIv(v){ v = v.slice().sort((a, b) => a[0] - b[0]); const out = []; for (const [a, b] of v){ const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); } return out; }
function subIv(A, B){ const out = []; for (let [s, e] of A){ for (const [c, d] of B){ if (d <= s || c >= e) continue; if (c > s) out.push([s, c]); s = Math.max(s, d); } if (e > s) out.push([s, e]); } return out; }
function interIv(A, B){ const out = []; for (const [s, e] of A) for (const [c, d] of B){ const x = Math.max(s, c), y = Math.min(e, d); if (y > x) out.push([x, y]); } return out; }
/* Region::intervals＋spans（矩形框） */
function spans(box, wraps, top, bottom){
  const iv = y => { let v = [[box.x0, box.x1]]; for (const w of wraps){ const off = w.offset, ys = off > 0 ? [y - off, y - off * 0.5, y, y + off * 0.5, y + off] : [y]; const W = unionIv(ys.flatMap(yy => polyIntervals(w.polys, yy)).map(([a, b]) => [a - off, b + off])); v = w.invert ? interIv(v, W) : subIv(v, W); } return v; };
  const rows = [0, 1, 2, 3, 4].map(k => iv(top + (bottom - top) * k / 4));
  const mid = rows.splice(2, 1)[0];
  return rows.reduce((acc, r) => interIv(acc, r), mid).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
}
/* ── 绕排排版（Pen::place 的矩形框版）：一行一行，span 不够宽（≤ ascent）就跳过；每个 span 贪心塞字 ── */
const _mc = document.createElement('canvas').getContext('2d');
const isSp = c => /\s/.test(c);
const isCJK = c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u.test(c);
function wrapLayout(T, wraps){
  const d = T.data, b = d.box, font = `${d.weight || 'normal'} ${d.size}px ${d.font}`; _mc.font = font;
  const m = _mc.measureText('Mg'), asc = m.fontBoundingBoxAscent || d.size * 0.8, desc = m.fontBoundingBoxDescent || d.size * 0.2, lead = d.size * 1.25;
  const box = {x0:b.x + T.x, y0:b.y + T.y, x1:b.x + b.w + T.x, y1:b.y + b.h + T.y};
  const cs = Array.from(String(d.text)), out = [];
  let i = 0, baseline = d.y + T.y, guard = 0;
  while (i <= cs.length && guard++ < 2000){
    if (baseline + desc > box.y1 + 0.5) break;
    const sp = spans(box, wraps, baseline - asc, baseline + desc).filter(([a, c]) => c - a > Math.max(asc, 1));
    for (const [x0, x1] of sp){
      if (i >= cs.length) break;
      if (cs[i] === '\n'){ break; }
      let j = i, last = -1;
      while (j < cs.length && cs[j] !== '\n'){
        if (j > i && (isSp(cs[j - 1]) || isCJK(cs[j - 1]) || isCJK(cs[j]))) last = j;
        if (!isSp(cs[j]) && _mc.measureText(cs.slice(i, j + 1).join('')).width > x1 - x0){ j = last > i ? last : (j > i ? j : j + 1); break; }
        j++;
      }
      let e = j; while (e > i && isSp(cs[e - 1])) e--;
      const s = cs.slice(i, e).join(''), w = _mc.measureText(s).width;
      const x = d.align === 'center' ? (x0 + x1) / 2 - w / 2 : d.align === 'right' ? x1 - w : x0;
      out.push({text:s, x, baseline});
      i = j; while (i < cs.length && cs[i] === ' ') i++;
    }
    if (i < cs.length && cs[i] === '\n') i++;
    else if (i >= cs.length) break;
    baseline += lead;
  }
  return out;
}
R3.textWrapLayout = wrapLayout;
/* 链式包 renderLayer：有绕排挡到的区域文字自己排、自己画 */
if (typeof window.renderLayer === 'function' && !window.renderLayer.__r3wrap){
  const prev = window.renderLayer;
  const w = function(L, scale){
    if (L && L.kind === 'text' && L.data && L.data.box && !(window.TouchType && TouchType.touched(L))){
      const wraps = wrapsFor(L);
      const key = JSON.stringify(wraps);
      if (L._r3wrapKey !== key){ L._r3wrapKey = key; L._cache = null; L._cacheScale = 0; }
      if (wraps.length){
        if (L._cache && L._cacheScale === scale) return L._cache;
        const W = Math.max(1, Math.round(Doc.width * scale)), H = Math.max(1, Math.round(Doc.height * scale));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d'), d = L.data;
        x.fillStyle = d.color; x.font = `${d.weight || 'normal'} ${d.size * scale}px ${d.font}`; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
        for (const ln of wrapLayout(L, wraps)) x.fillText(ln.text, ln.x * scale, ln.baseline * scale);
        L._cache = c; L._cacheScale = scale;
        return c;
      }
    }
    return prev.apply(this, arguments);
  };
  w.__r3wrap = true; w.toString = () => String(prev);
  window.renderLayer = w;
}
/* 绕排物件改了（移动、改大小…）文字层要重排：每次画之前比对上面那把 key（renderLayer 里做了），这里只要矢量层一失效就让文字层也失效 */
const inv0 = Layer.invalidate;
Layer.invalidate = function(L){ const r = inv0.apply(this, arguments); if (L && L.kind === 'vector') Doc.layers.forEach(T => { if (T.kind === 'text' && T.data && T.data.box && T._r3wrapKey) { T._cache = null; T._cacheScale = 0; } }); return r; };
Lang.add({
  'zh-Hant':{'ai3w.title':'繞圖排文選項', 'ai3w.offset':'位移', 'ai3w.invert':'反轉繞圖排文'},
  'zh-Hans':{'ai3w.title':'文本绕排选项', 'ai3w.offset':'位移', 'ai3w.invert':'反向绕排'},
  en:{'ai3w.title':'Text Wrap Options', 'ai3w.offset':'Offset', 'ai3w.invert':'Invert Wrap'}
});
})();

/*对象 ▸ 图表（类型…／数据…）＋图表工具那条 graph.create：照 VectorCraft 原码
     engine/src/cmd/graph.rs 1-640  parse_csv（第一列有非数字＝标题列（系列名）、每行第一格非数字＝类别名）／to_csv／apply_data、series_paint（黑、再各级灰）、
         nice_axis、generate（九种：柱形／堆积柱形／条形／堆积条形／折线／面积／散点／饼图／雷达；坐标轴＋刻度＋标签、每个系列一组（连图例色块）、图例文字一组）、
         regenerate（使用者移过／缩放过就把绘图区跟着调，记 placed）、create（没给资料＝范例资料）、target（选中的图表或选中物件所在的图表）、set_data（没给＝读 csv）、set_type（没给＝读目前选项）
     doc/src/graph.rs 1-116         GraphKind、GraphSpec 预设（柱宽 90%、群集宽 80%、图例 开、刻度 自动、标记点 开、连接点 开）
     ui-egui/src/menus.rs:1792, 2267-2275  类型…／数据…＝参数对话框（数据＝csv 一栏）；设计…／柱形图…／标记…原码是 todo
   资料：图表＝{type:'group', name:'Column Graph', graph:{kind, rect:[x0,y0,x1,y1], series, categories, rows, columnWidth, clusterWidth, legend, ticks, axisMin, axisMax, markPoints, connectPoints, placed}, children:[生成的]}（图层坐标）
   标签文字：原码产生文字节点；我们矢量层没有文字形状 ⇒ 补一个最小的 {type:'text', x, y（基线）, text, size, font, fill, align}，链式包 ObjRender 画它、包 shiftShape／rotTransformShape 让它能跟着移动变换。 */
(function(){
'use strict';
if (window.__aiR3_graph) return; window.__aiR3_graph = true;
const R3 = window.AiR3, {num, bool, reg, done, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const LABEL = 9;
/* ── 文字形状（图表标签用） ── */
(function hookText(){
  const OR = window.ObjRender; if (!OR || OR.__r3text) return; OR.__r3text = true;
  const h0 = OR.handles, d0 = OR.draw, s0 = OR.toSVG;
  OR.handles = function(s){ return (s && s.type === 'text') || h0.call(this, s); };
  OR.draw = function(ctx, s, S){
    if (!s || s.type !== 'text') return d0.call(this, ctx, s, S);
    if (s.visible === false || typeof ctx.fillText !== 'function') return;
    ctx.save(); ctx.font = `${s.weight || 'normal'} ${(s.size || LABEL) * S}px ${s.font || 'sans-serif'}`; ctx.textAlign = s.align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = (typeof s.fill === 'string' && s.fill !== 'none') ? s.fill : '#000'; ctx.fillText(String(s.text), s.x * S, s.y * S); ctx.restore();
  };
  OR.toSVG = function(s){
    if (!s || s.type !== 'text') return s0.call(this, s);
    if (s.visible === false) return '';
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<text x="${s.x}" y="${s.y}" font-size="${s.size || LABEL}" font-family="${esc(s.font || 'sans-serif')}" text-anchor="${({left:'start', center:'middle', right:'end'})[s.align || 'left']}" fill="${esc(s.fill || '#000')}">${esc(s.text)}</text>`;
  };
  if (typeof window.shiftShape === 'function'){ const sh = window.shiftShape; window.shiftShape = function(s, dx, dy){ if (s && s.type === 'text'){ s.x += dx; s.y += dy; return s; } return sh.apply(this, arguments); }; }
  if (typeof window.rotTransformShape === 'function'){ const rt = window.rotTransformShape; window.rotTransformShape = function(L, s, m, sc){ if (s && s.type === 'text'){ const p = AIObj.A.apply(m, [s.x, s.y]); s.x = p[0]; s.y = p[1]; const k = Math.sqrt(Math.abs(AIObj.A.det(m))); if (k > 0) s.size = (s.size || LABEL) * k; return true; } return rt.apply(this, arguments); }; }
})();

/* ── 资料（graph.rs:51-135） ── */
const fmtValue = v => Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
function parseCsv(csv){
  const rows = String(csv).split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).map(l => l.split(l.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"+|"+$/g, '')));
  if (!rows.length) return {series:[], categories:[], rows:[]};
  const isNum = c => c.trim() !== '' && isFinite(+c);
  const first = rows[0], header = first[0] === '' || first.slice(1).some(c => !isNum(c));
  const series = header ? first.slice(1) : [], categories = [], values = [];
  for (const r of rows.slice(header ? 1 : 0)){ const lab = r.length && !isNum(r[0]); categories.push(lab ? r[0] : ''); values.push(r.slice(lab ? 1 : 0).map(c => isNum(c) ? +c : 0)); }
  return {series, categories:categories.every(c => !c) ? [] : categories, rows:values};
}
function toCsv(g){
  let out = ''; if (g.series.length) out += ',' + g.series.join(',') + '\n';
  g.rows.forEach((r, i) => { if (g.categories[i] !== undefined) out += g.categories[i] + ','; out += r.map(fmtValue).join(',') + '\n'; });
  return out;
}
function applyData(g, p){
  let changed = false;
  if (typeof p.csv === 'string'){ Object.assign(g, parseCsv(p.csv)); changed = true; }
  const strs = v => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : JSON.stringify(x)) : null;
  if (strs(p.series)){ g.series = strs(p.series); changed = true; }
  if (strs(p.categories)){ g.categories = strs(p.categories); changed = true; }
  if (Array.isArray(p.rows)){ g.rows = p.rows.map(r => Array.isArray(r) ? r.map(v => isFinite(+v) ? +v : 0) : []); changed = true; }
  g.rows = g.rows.filter(r => r.length);
  return changed;
}
const KINDS = ['column', 'stackedColumn', 'bar', 'stackedBar', 'line', 'area', 'scatter', 'pie', 'radar'];
const LABELS = {column:'Column', stackedColumn:'Stacked Column', bar:'Bar', stackedBar:'Stacked Bar', line:'Line', area:'Area', scatter:'Scatter', pie:'Pie', radar:'Radar'};
const parseKind = s => { s = String(s).replace(/Graph$/, ''); return KINDS.find(k => k.toLowerCase() === s.toLowerCase()) || null; };
const DEFAULT_SPEC = () => ({kind:'column', rect:[0, 0, 200, 150], series:[], categories:[], rows:[[1]], columnWidth:90, clusterWidth:80, legend:true, ticks:0, axisMin:null, axisMax:null, markPoints:true, connectPoints:true, placed:null});
/* graph.rs:112-118 series_paint */
const LEVELS = [0.0, 0.55, 0.8, 0.3, 0.68, 0.15, 0.9, 0.42];
const seriesPaint = i => { const v = Math.round(LEVELS[i % LEVELS.length] * 255).toString(16).padStart(2, '0'); return '#' + v + v + v; };
/* graph.rs:122-130 nice_axis */
function niceAxis(lo, hi, ticks){
  if (Math.abs(hi - lo) < 1e-12){ const l = Math.min(lo, 0), h = Math.max(lo, 0) + 1; lo = l; hi = h; }
  const n = ticks === 0 ? 5 : Math.min(Math.max(ticks, 1), 100), raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-12) || 10 * mag;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
}
/* ── 生成（graph.rs:179-475） ── */
function generate(g){
  const out = [], P = (pts, closed, fill, stroke, w) => ({id:R3.newId(), type:'path', points:pts.map(p => [p[0], p[1]]), closed:!!closed, fill, stroke, strokeWidth:w});
  const line = (a, b) => P([a, b], false, 'none', '#000000', 0.5);
  const text = (at, s, align) => ({id:R3.newId(), type:'text', x:at[0], y:at[1], text:s, size:LABEL, font:'sans-serif', fill:'#000000', align, stroke:'none', strokeWidth:0});
  const group = (name, children) => ({id:R3.newId(), type:'group', name, children});
  const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const marker = (p, s) => P(rectPts(p[0] - s / 2, p[1] - s / 2, p[0] + s / 2, p[1] + s / 2), true, null, 'none', 0);
  const r = {x0:g.rect[0], y0:g.rect[1], x1:g.rect[2], y1:g.rect[3]}, W = r.x1 - r.x0, Ht = r.y1 - r.y0;
  const nser = Math.max(1, Math.max(0, ...g.rows.map(x => x.length))), ncat = Math.max(1, g.rows.length);
  const series = Array.from({length:nser}, () => []);
  const val = (c, s) => (g.rows[c] && g.rows[c][s] !== undefined) ? g.rows[c][s] : 0;
  const stacked = ['stackedColumn', 'stackedBar', 'area'].includes(g.kind), horizontal = ['bar', 'stackedBar'].includes(g.kind);
  if (g.kind === 'pie'){
    const w = W / ncat, rad = Math.max(Math.min(w, Ht) / 2 * 0.9, 1);
    for (let c = 0; c < ncat; c++){
      const ce = [r.x0 + w * (c + 0.5), r.y0 + Ht / 2]; let total = 0; for (let s = 0; s < nser; s++) total += Math.max(val(c, s), 0);
      let a0 = -Math.PI / 2;
      series.forEach((items, s) => {
        const v = Math.max(val(c, s), 0); if (total <= 0 || v <= 0) return;
        const sweep = v / total * Math.PI * 2, n = Math.max(2, Math.ceil(sweep / (Math.PI / 2))), anchors = [{x:ce[0], y:ce[1], in:null, out:null}];
        const k = 4 / 3 * Math.tan(sweep / n / 4);
        for (let i = 0; i <= n; i++){ const a = a0 + sweep * i / n, p = [ce[0] + Math.cos(a) * rad, ce[1] + Math.sin(a) * rad], t = [-Math.sin(a) * rad * k, Math.cos(a) * rad * k];
          anchors.push({x:p[0], y:p[1], in:i > 0 ? [p[0] - t[0], p[1] - t[1]] : null, out:i < n ? [p[0] + t[0], p[1] + t[1]] : null}); }
        items.push({id:R3.newId(), type:'bezier', anchors, closed:true, fill:seriesPaint(s), stroke:'#ffffff', strokeWidth:0.5});
        a0 += sweep;
      });
      if (g.categories[c]) out.push(text([ce[0], ce[1] + rad + LABEL * 1.6], g.categories[c], 'center'));
    }
  } else if (g.kind === 'radar'){
    const ce = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], rad = Math.max(Math.min(W, Ht) / 2, 1);
    const hi0 = g.axisMax !== null && g.axisMax !== undefined ? g.axisMax : Math.max(0, ...g.rows.flat());
    const [lo, hi, step] = niceAxis(g.axisMin !== null && g.axisMin !== undefined ? g.axisMin : 0, hi0, g.ticks);
    const at = (c, v) => { const a = -Math.PI / 2 + Math.PI * 2 * c / ncat, t = Math.min(Math.max((v - lo) / (hi - lo), 0), 1); return [ce[0] + Math.cos(a) * rad * t, ce[1] + Math.sin(a) * rad * t]; };
    const axes = [];
    for (let c = 0; c < ncat; c++){
      axes.push(line(ce, at(c, hi)));
      if (g.categories[c]){ const e = at(c, hi), d = [e[0] - ce[0], e[1] - ce[1]], l = Math.hypot(d[0], d[1]) || 1, q = [e[0] + d[0] / l * LABEL * 1.2, e[1] + d[1] / l * LABEL * 1.2]; axes.push(text([q[0], q[1] + LABEL * 0.35], g.categories[c], 'center')); }
    }
    for (let v = lo + step; v <= hi + step * 1e-6; v += step) axes.push(P(Array.from({length:ncat}, (_, c) => at(c, v)), true, 'none', '#999999', 0.25));
    out.push(group('Axes', axes));
    series.forEach((items, s) => { const pts = Array.from({length:ncat}, (_, c) => at(c, val(c, s))); items.push(P(pts, true, 'none', seriesPaint(s), 1)); pts.forEach(p => { const m = marker(p, 4); m.fill = seriesPaint(s); items.push(m); }); });
  } else {
    let lo = 0, hi = 0, xlo = Infinity, xhi = -Infinity; const scatter = g.kind === 'scatter';
    for (let c = 0; c < ncat; c++){
      if (stacked){ let pos = 0, neg = 0; for (let s = 0; s < nser; s++){ pos += Math.max(val(c, s), 0); neg += Math.min(val(c, s), 0); } hi = Math.max(hi, pos); lo = Math.min(lo, neg); }
      else if (scatter){ for (let s = 0; s < nser; s += 2){ hi = Math.max(hi, val(c, s)); lo = Math.min(lo, val(c, s)); xlo = Math.min(xlo, val(c, s + 1)); xhi = Math.max(xhi, val(c, s + 1)); } }
      else for (let s = 0; s < nser; s++){ hi = Math.max(hi, val(c, s)); lo = Math.min(lo, val(c, s)); }
    }
    const nn = v => v !== null && v !== undefined;
    const ax = niceAxis(nn(g.axisMin) ? g.axisMin : lo, nn(g.axisMax) ? g.axisMax : hi, g.ticks); lo = ax[0]; hi = ax[1]; const step = ax[2];
    const vpos = v => { const t = (v - lo) / (hi - lo); return horizontal ? r.x0 + t * W : r.y1 - t * Ht; };
    const axes = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step){
      const q = vpos(v);
      if (horizontal){ axes.push(line([q, r.y1], [q, r.y1 + 4])); axes.push(text([q, r.y1 + 4 + LABEL * 1.1], fmtValue(v), 'center')); }
      else { axes.push(line([r.x0 - 4, q], [r.x0, q])); axes.push(text([r.x0 - 6, q + LABEL * 0.35], fmtValue(v), 'right')); }
    }
    const z = vpos(Math.min(Math.max(0, lo), hi));
    if (horizontal){ axes.push(line([r.x0, r.y1], [r.x1, r.y1])); axes.push(line([z, r.y0], [z, r.y1])); }
    else { axes.push(line([r.x0, r.y0], [r.x0, r.y1])); axes.push(line([r.x0, z], [r.x1, z])); }
    const span = horizontal ? Ht : W, catW = span / ncat, catStart = c => (horizontal ? r.y0 : r.x0) + c * catW;
    const pointsMode = ['line', 'area'].includes(g.kind), catMid = c => (pointsMode && ncat > 1) ? r.x0 + W * c / (ncat - 1) : catStart(c) + catW / 2;
    if (!scatter){
      for (let c = 0; c < ncat; c++) if (g.categories[c]) axes.push(horizontal ? text([r.x0 - 6, catMid(c) + LABEL * 0.35], g.categories[c], 'right') : text([catMid(c), r.y1 + LABEL * 1.4], g.categories[c], 'center'));
    } else {
      const [xl, xh, xs] = niceAxis(xlo === Infinity ? 0 : Math.min(xlo, 0), xhi === -Infinity ? 1 : xhi, g.ticks);
      for (let x = xl; x <= xh + xs * 1e-6; x += xs){ const q = r.x0 + (x - xl) / (xh - xl) * W; axes.push(line([q, r.y1], [q, r.y1 + 4])); axes.push(text([q, r.y1 + 4 + LABEL * 1.1], fmtValue(x), 'center')); }
      for (let s = 0, si = 0; s < nser; s += 2, si++){
        const pts = Array.from({length:ncat}, (_, c) => [r.x0 + (val(c, s + 1) - xl) / (xh - xl) * W, vpos(val(c, s))]);
        if (g.connectPoints && pts.length > 1) series[si].push(P(pts, false, 'none', seriesPaint(si), 1));
        if (g.markPoints) pts.forEach(p => { const m = marker(p, 5); m.fill = seriesPaint(si); series[si].push(m); });
      }
    }
    out.push(group('Axes', axes));
    const rect = (x0, y0, x1, y1, fill, stroke, w) => P(rectPts(x0, y0, x1, y1), true, fill, stroke, w);
    if (g.kind === 'column' || g.kind === 'bar'){
      const cluster = catW * Math.min(Math.max(g.clusterWidth / 100, 0.01), 1), slot = cluster / nser, bar = slot * Math.min(Math.max(g.columnWidth / 100, 0.01), 1);
      for (let c = 0; c < ncat; c++){ const c0 = catStart(c) + (catW - cluster) / 2;
        series.forEach((items, s) => { const a = c0 + slot * s + (slot - bar) / 2, v0 = vpos(Math.min(Math.max(0, lo), hi)), v1 = vpos(val(c, s));
          items.push(horizontal ? rect(Math.min(v0, v1), a, Math.max(v0, v1), a + bar, seriesPaint(s), 'none', 0) : rect(a, Math.min(v0, v1), a + bar, Math.max(v0, v1), seriesPaint(s), 'none', 0)); }); }
    } else if (g.kind === 'stackedColumn' || g.kind === 'stackedBar'){
      const bar = Math.min(catW * Math.min(Math.max(g.columnWidth / 100, 0.01), 1) * Math.min(Math.max(g.clusterWidth / 100, 0.01), 1) * 1.2, catW);
      for (let c = 0; c < ncat; c++){ const a = catStart(c) + (catW - bar) / 2; let pos = 0, neg = 0;
        series.forEach((items, s) => { const v = val(c, s), base = v >= 0 ? pos : neg, v0 = vpos(base), v1 = vpos(base + v); if (v >= 0) pos += v; else neg += v;
          items.push(horizontal ? rect(Math.min(v0, v1), a, Math.max(v0, v1), a + bar, seriesPaint(s), '#ffffff', 0.25) : rect(a, Math.min(v0, v1), a + bar, Math.max(v0, v1), seriesPaint(s), '#ffffff', 0.25)); }); }
    } else if (g.kind === 'line'){
      series.forEach((items, s) => { const pts = Array.from({length:ncat}, (_, c) => [catMid(c), vpos(val(c, s))]);
        if (g.connectPoints && pts.length > 1) items.push(P(pts, false, 'none', seriesPaint(s), 1));
        if (g.markPoints) pts.forEach(p => { const m = marker(p, 5); m.fill = seriesPaint(s); items.push(m); }); });
    } else if (g.kind === 'area'){
      let below = new Array(ncat).fill(0);
      series.forEach((items, s) => { const above = below.map((b, c) => b + val(c, s)); const pts = above.map((v, c) => [catMid(c), vpos(v)]).concat(below.map((v, c) => [catMid(c), vpos(v)]).reverse());
        items.push(P(pts, true, seriesPaint(s), '#ffffff', 0.25)); below = above; });
    }
  }
  /* 图例 */
  const legendSeries = g.kind === 'scatter' ? Math.ceil(nser / 2) : nser, labels = [];
  if (g.legend && g.series.length){
    const x = r.x1 + 14;
    series.slice(0, legendSeries).forEach((items, s) => {
      const label = g.kind === 'scatter' ? (g.series[s * 2] || '') : (g.series[s] || ''); if (!label) return;
      const y = r.y0 + s * (LABEL * 1.8);
      items.push(P(rectPts(x, y, x + 8, y + 8), true, seriesPaint(s), 'none', 0));
      labels.push(text([x + 12, y + 7.5], label, 'left'));
    });
  }
  series.forEach((items, s) => { if (items.length) out.push(group((g.series[s] || '') || `Series ${s + 1}`, items)); });
  if (labels.length) out.push(group('Legend', labels));
  return out;
}
const kidsBounds = kids => R3.geoBounds(kids);
/* graph.rs:477-503 regenerate（移过／缩放过就把绘图区跟着调） */
function regenerate(node, spec){
  const now = kidsBounds(node.children || []), pl = spec.placed;
  if (pl && now && pl[2] - pl[0] > 1e-9 && pl[3] - pl[1] > 1e-9 && Math.abs(pl[0] - now.x0) + Math.abs(pl[1] - now.y0) + Math.abs(pl[2] - now.x1) + Math.abs(pl[3] - now.y1) > 1e-6){
    const sx = (now.x1 - now.x0) / (pl[2] - pl[0]), sy = (now.y1 - now.y0) / (pl[3] - pl[1]), f = (x, y) => [now.x0 + (x - pl[0]) * sx, now.y0 + (y - pl[1]) * sy];
    const a = f(spec.rect[0], spec.rect[1]), b = f(spec.rect[2], spec.rect[3]); spec.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  node.children = generate(spec);
  const pb = kidsBounds(node.children); spec.placed = pb ? [pb.x0, pb.y0, pb.x1, pb.y1] : null;
  node.graph = spec;
}
R3.graphGenerate = generate;
reg('ai.graph.create', {undoable:true, params:'{type?: "column"|"stackedColumn"|"bar"|"stackedBar"|"line"|"area"|"scatter"|"pie"|"radar"（预设 column）, x, y, width?=200, height?=150（文件坐标）, series?, categories?, rows?, csv?} 建一个图表（graph.rs:505-529 graph.create＝图表工具点一下；没给资料＝范例资料）放在当前矢量层最上面并选中 → {ok, id}'}, p => {
  const C = 'ai.graph.create';
  const kind = p.type !== undefined ? parseKind(p.type) : 'column'; if (!kind) return err(C, `unknown graph type \`${p.type}\``);
  if (!isFinite(+p.x) || !isFinite(+p.y)) return err(C, 'missing x / y');
  const L = R3.vLayer(p) || Doc.active(); if (!L || L.kind !== 'vector') return err(C, 'not a vector layer');
  const w = Math.max(Math.abs(num(p.width, 200)), 1), h = Math.max(Math.abs(num(p.height, 150)), 1), x = +p.x - L.x, y = +p.y - L.y;
  const spec = Object.assign(DEFAULT_SPEC(), {kind, rect:[x, y, x + w, y + h]});
  if (!applyData(spec, p)) Object.assign(spec, {series:['Series 1', 'Series 2'], categories:['A', 'B', 'C', 'D'], rows:[[3, 2], [5, 4], [4, 6], [7, 5]]});
  const g = {id:R3.newId(), type:'group', name:`${LABELS[kind]} Graph`, children:[]};
  L.data.shapes.push(g); regenerate(g, spec);
  R3.selectIds(L, [g.id]); return done(L, {id:g.id});
});
/* graph.rs:532-546 target */
function target(p, C){
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return {err:err(C, 'select a graph')};
  for (const id of (p.id ? [p.id] : []).concat(VecSel.shapes)){ let h = R3.findDeep(id, L); while (h){ if (h.s.graph) return {L, g:h.s}; h = h.parent ? R3.findDeep(h.parent.id, L) : null; } }
  return {err:err(C, 'select a graph')};
}
R3.regEdit('ai.graph.setData', {params:'{id?, series?, categories?, rows?, csv?: 第一列＝系列名（第一格空），之后每列＝类别名, 数值…} 对象 ▸ 图表 ▸ 数据…（graph.rs:552-560）：换图表的资料、原地重新生成（一步历史）；不给资料＝读目前的 {csv, series, categories, rows} → {ok, id}'}, (p, touch) => {
  const t = target(p, 'ai.graph.setData'); if (t.err) return t.err;
  const spec = clone(t.g.graph);
  if (!applyData(spec, p)) return {ok:true, csv:toCsv(spec), series:spec.series, categories:spec.categories, rows:spec.rows};
  touch(); regenerate(t.g, spec); return done(t.L, {id:t.g.id});
});
R3.regEdit('ai.graph.setType', {params:'{id?, type?, columnWidth?: % (1..1000), clusterWidth?: % (1..100), legend?: bool, markPoints?: bool, connectPoints?: bool, ticks?: n, axisMin?, axisMax?} 对象 ▸ 图表 ▸ 类型…（graph.rs:562-602）：换图表种类与选项、原地重新生成（一步历史）；不给＝读目前选项 → {ok, id}'}, (p, touch) => {
  const C = 'ai.graph.setType', t = target(p, C); if (t.err) return t.err;
  const spec = clone(t.g.graph), keys = ['type', 'columnWidth', 'clusterWidth', 'legend', 'markPoints', 'connectPoints', 'ticks', 'axisMin', 'axisMax'];
  if (!keys.some(k => p[k] !== undefined)) return {ok:true, type:spec.kind, columnWidth:spec.columnWidth, clusterWidth:spec.clusterWidth, legend:spec.legend, markPoints:spec.markPoints, connectPoints:spec.connectPoints, ticks:spec.ticks};
  if (p.type !== undefined){ const k = parseKind(p.type); if (!k) return err(C, `unknown graph type \`${p.type}\``); spec.kind = k; }
  spec.columnWidth = Math.min(Math.max(num(p.columnWidth, spec.columnWidth), 1), 1000);
  spec.clusterWidth = Math.min(Math.max(num(p.clusterWidth, spec.clusterWidth), 1), 100);
  spec.legend = bool(p.legend, spec.legend); spec.markPoints = bool(p.markPoints, spec.markPoints); spec.connectPoints = bool(p.connectPoints, spec.connectPoints);
  if (p.ticks !== undefined && Number.isInteger(+p.ticks) && +p.ticks >= 0) spec.ticks = Math.min(+p.ticks, 100);
  if (p.axisMin !== undefined) spec.axisMin = isFinite(+p.axisMin) && p.axisMin !== null ? +p.axisMin : null;
  if (p.axisMax !== undefined) spec.axisMax = isFinite(+p.axisMax) && p.axisMax !== null ? +p.axisMax : null;
  touch(); regenerate(t.g, spec);
  if (/ Graph$/.test(t.g.name || '')) t.g.name = `${LABELS[spec.kind]} Graph`;
  return done(t.L, {id:t.g.id});
});
R3.reg('ai.graph.setType.dialog', {params:'{} 开「图表类型」对话框（照选中图表目前的选项；确定＝ai.graph.setType）→ {ok, dialog}'}, () => {
  const o = CMD.map['ai.graph.setType'].run({}); if (!o || o.ok === false) return o;
  R3.form('graphType', 'ai3g.typeTitle', [
    {key:'type', label:'ai3g.type', type:'select', value:o.type, options:KINDS.map(k => [k, 'ai3g.k.' + k])},
    {key:'columnWidth', label:'ai3g.columnWidth', type:'number', value:o.columnWidth}, {key:'clusterWidth', label:'ai3g.clusterWidth', type:'number', value:o.clusterWidth},
    {key:'ticks', label:'ai3g.ticks', type:'number', value:o.ticks},
    {key:'legend', label:'ai3g.legend', type:'check', value:o.legend}, {key:'markPoints', label:'ai3g.markPoints', type:'check', value:o.markPoints}, {key:'connectPoints', label:'ai3g.connectPoints', type:'check', value:o.connectPoints}
  ], v => CMD.run('ai.graph.setType', Object.assign(v, {ticks:Math.max(0, Math.round(v.ticks))})));
  return {ok:true, dialog:'graphType'};
});
R3.reg('ai.graph.setData.dialog', {params:'{} 开「图表数据」对话框（csv 一栏：第一列系列名、之后每列类别＋数值；确定＝ai.graph.setData）→ {ok, dialog}'}, () => {
  const o = CMD.map['ai.graph.setData'].run({}); if (!o || o.ok === false) return o;
  R3.form('graphData', 'ai3g.dataTitle', [{key:'csv', label:'ai3g.csv', type:'textarea', rows:8, value:o.csv}], v => CMD.run('ai.graph.setData', {csv:v.csv}));
  return {ok:true, dialog:'graphData'};
});
const KN = {column:['長條圖', '柱形图', 'Column'], stackedColumn:['堆疊長條圖', '堆积柱形图', 'Stacked Column'], bar:['橫條圖', '条形图', 'Bar'], stackedBar:['堆疊橫條圖', '堆积条形图', 'Stacked Bar'],
  line:['折線圖', '折线图', 'Line'], area:['區域圖', '面积图', 'Area'], scatter:['散佈圖', '散点图', 'Scatter'], pie:['圓形圖', '饼图', 'Pie'], radar:['雷達圖', '雷达图', 'Radar']};
const kn = i => Object.fromEntries(KINDS.map(k => ['ai3g.k.' + k, KN[k][i]]));
Lang.add({
  'zh-Hant':Object.assign({'ai3g.typeTitle':'圖表類型', 'ai3g.type':'類型', 'ai3g.columnWidth':'長條寬度 (%)', 'ai3g.clusterWidth':'叢集寬度 (%)', 'ai3g.ticks':'刻度數（0＝自動）', 'ai3g.legend':'加入圖例', 'ai3g.markPoints':'標記資料點', 'ai3g.connectPoints':'連接資料點', 'ai3g.dataTitle':'圖表資料', 'ai3g.csv':'資料（CSV）'}, kn(0)),
  'zh-Hans':Object.assign({'ai3g.typeTitle':'图表类型', 'ai3g.type':'类型', 'ai3g.columnWidth':'列宽 (%)', 'ai3g.clusterWidth':'簇宽度 (%)', 'ai3g.ticks':'刻度数（0＝自动）', 'ai3g.legend':'添加图例', 'ai3g.markPoints':'标记数据点', 'ai3g.connectPoints':'连接数据点', 'ai3g.dataTitle':'图表数据', 'ai3g.csv':'数据（CSV）'}, kn(1)),
  en:Object.assign({'ai3g.typeTitle':'Graph Type', 'ai3g.type':'Type', 'ai3g.columnWidth':'Column Width (%)', 'ai3g.clusterWidth':'Cluster Width (%)', 'ai3g.ticks':'Tick marks (0 = auto)', 'ai3g.legend':'Add Legend', 'ai3g.markPoints':'Mark Data Points', 'ai3g.connectPoints':'Connect Data Points', 'ai3g.dataTitle':'Graph Data', 'ai3g.csv':'Data (CSV)'}, kn(2))
});
})();

/*对象 ▸ 实时上色（建立／合并／释放／扩展）＋即时上色油漆桶那几条命令：照 VectorCraft 原码
     engine/src/cmd/buildcmds.rs:1-11（资料：实时上色组＝名字以「Live Paint」开头的一般编组；第一个子物件是藏起来的「Live Paint Sources」编组装原路径；
         再来是面（名「Face」、只有填色）与边（名「Edge」、开放路径、只有描边））、52-110（登记）、168-186 root_ids、368-418 build_children（面＝平面分割的区域，
         填色＝盖住它最上面那个来源的填色；边＝所有轮廓在交点切开，描边＝那条来源的描边）、420-439 make_live／lp_make、441-503 lp_merge（并进来时
         原本面／边上的颜色用「面内一点／边中点」找回新的面／边）、505-550 release／expand（扩展＝拿掉来源组、没上色的面、没描边的边）、552-623 fill／strokeEdge／info
     tools/src/builder.rs:23-160  名字常数、is_live_paint、face_at（画的顺序最后一个包含该点的面）、edge_near、leaf_shapes（隐藏的、参考线、剪切路径不算）、node_outline
     间隙选项…：原码 ui-egui/src/menus.rs:1749 todo("Gap Options…")，没有实作 ⇒ 不抄。
   平面分割：原码 pathops po::regions／pathfinder(Outline) 用 linesweeper；我们用替代实作——各轮廓拉平成折线 → 两两求交切开 → 合并端点成平面图 →
     每个顶点按角度排序、沿「最左转」走出每个面（半边结构）→ 有界的面用 AIObj.tidyLoop 拟合回曲线；面内取一点判断被哪些来源盖住（各来源自己的填色规则）。
     限制：互不相交、整个包在别的面里的小块，大面不会挖洞（大面先画、小面后画，画面上一样；面依面积由大到小排）。 */
(function(){
'use strict';
if (window.__aiR3_livePaint) return; window.__aiR3_livePaint = true;
const R3 = window.AiR3, {num, bool, reg, done, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const PREFIX = 'Live Paint', NAME = 'Live Paint Group', SOURCES = 'Live Paint Sources', FACE = 'Face', EDGE = 'Edge';
const isLP = n => !!n && n.type === 'group' && !n.clip && typeof n.name === 'string' && n.name.startsWith(PREFIX);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], cross = (a, b) => a[0] * b[1] - a[1] * b[0], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const area = P => { let s = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
/* 点在多边形组里（规则 nonzero／evenodd） */
function inside(polys, rule, p){
  let w = 0, c = 0;
  for (const P of polys) for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a[1] <= p[1]) !== (b[1] <= p[1])){ const x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]); if (x > p[0]){ c++; w += b[1] > a[1] ? 1 : -1; } }
  }
  return rule === 'evenodd' ? (c % 2 === 1) : w !== 0;
}
/* interior_point（buildcmds.rs:214-252）：几条水平线上找最宽的「在里面」区间中点 */
function interiorPoint(polys, rule){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; polys.forEach(P => P.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
  let best = null;
  for (const f of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875, 0.0625, 0.9375]){
    const y = y0 + (y1 - y0) * f, xs = [];
    for (const P of polys) for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i++){ const m = [(xs[i] + xs[i + 1]) / 2, y], w = xs[i + 1] - xs[i]; if (w > (best ? best[0] : 0) && inside(polys, rule, m)) best = [w, m]; }
  }
  return best ? best[1] : null;
}
/* leaf_shapes＋node_outline：一个来源 → 叶子（路径／复合路径）的折线组与填色规则 */
function leaves(n, out){
  if (n.visible === false) return out;
  if ((R3.isLeaf(n) && !n.guide && !n.clipping) || n.type === 'compound') out.push(n);
  else if (n.type === 'group') (n.children || []).filter(c => !c.r3helper).forEach(c => leaves(c, out));
  return out;
}
const polysOf = n => R3.subviews(n).map(v => AIObj.flatten(v)).filter(P => P.length >= 2);
/* ── 平面分割（po::regions／Outline 的替代实作） ── */
function planar(shapes){
  const E = [];
  shapes.forEach((sh, si) => sh.polys.forEach((P, pi) => { for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if (dist(a, b) > 1e-9) E.push({a, b, s:si, poly:pi, k:i}); } }));
  if (!E.length) return null;
  let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity;
  E.forEach(e => { e.x0 = Math.min(e.a[0], e.b[0]); e.x1 = Math.max(e.a[0], e.b[0]); e.y0 = Math.min(e.a[1], e.b[1]); e.y1 = Math.max(e.a[1], e.b[1]); X0 = Math.min(X0, e.x0); X1 = Math.max(X1, e.x1); Y0 = Math.min(Y0, e.y0); Y1 = Math.max(Y1, e.y1); });
  const scale = Math.max(1, X1 - X0, Y1 - Y0), ET = 1e-9 * scale, cuts = E.map(() => [0, 1]);
  const ord = E.map((_, i) => i).sort((i, j) => E[i].x0 - E[j].x0);
  for (let oi = 0; oi < ord.length; oi++){
    const i = ord[oi], e = E[i];
    for (let oj = oi + 1; oj < ord.length; oj++){
      const j = ord[oj], f = E[j]; if (f.x0 > e.x1 + ET) break; if (f.y0 > e.y1 + ET || f.y1 < e.y0 - ET) continue;
      const r = sub(e.b, e.a), s = sub(f.b, f.a), qp = sub(f.a, e.a), den = cross(r, s), lr = Math.hypot(r[0], r[1]), ls = Math.hypot(s[0], s[1]);
      if (Math.abs(den) <= 1e-12 * lr * ls){
        if (Math.abs(cross(qp, r)) / lr > ET) continue;
        [f.a, f.b].forEach(q => { const t = ((q[0] - e.a[0]) * r[0] + (q[1] - e.a[1]) * r[1]) / (lr * lr); if (t > 1e-12 && t < 1 - 1e-12) cuts[i].push(t); });
        [e.a, e.b].forEach(q => { const u = ((q[0] - f.a[0]) * s[0] + (q[1] - f.a[1]) * s[1]) / (ls * ls); if (u > 1e-12 && u < 1 - 1e-12) cuts[j].push(u); });
        continue;
      }
      const t = cross(qp, s) / den, u = cross(qp, r) / den, tt = ET / lr, tu = ET / ls;
      if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) continue;
      cuts[i].push(Math.min(Math.max(t, 0), 1)); cuts[j].push(Math.min(Math.max(u, 0), 1));
    }
  }
  const V = [], grid = new Map(), G = Math.max(1e-7 * scale, 1e-9);
  const vid = p => { const gx = Math.round(p[0] / G), gy = Math.round(p[1] / G); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){ const l = grid.get((gx + dx) + ',' + (gy + dy)); if (l) for (const k of l) if (dist(V[k], p) <= 1.5 * G) return k; } V.push(p); const key = gx + ',' + gy; (grid.get(key) || grid.set(key, []).get(key)).push(V.length - 1); return V.length - 1; };
  const adj = new Map(), edgeSet = new Map();       // 无向边 key → {u, v, srcs:Set}
  const chains = shapes.map(sh => sh.polys.map(() => []));   // 每条来源折线按顺序经过的顶点
  E.forEach((e, i) => {
    const ts = cuts[i].sort((x, y) => x - y); let prev = vid(e.a);
    const ch = chains[e.s][e.poly]; if (!ch.length || ch[ch.length - 1] !== prev) ch.push(prev);
    for (let k = 1; k < ts.length; k++){
      if (ts[k] - ts[k - 1] < 1e-12 && k < ts.length - 1) continue;
      const v = k === ts.length - 1 ? vid(e.b) : vid([e.a[0] + (e.b[0] - e.a[0]) * ts[k], e.a[1] + (e.b[1] - e.a[1]) * ts[k]]);
      if (v !== prev){
        const key = Math.min(prev, v) + '_' + Math.max(prev, v);
        if (!edgeSet.has(key)){ edgeSet.set(key, {u:prev, v, srcs:new Set()}); (adj.get(prev) || adj.set(prev, []).get(prev)).push(v); (adj.get(v) || adj.set(v, []).get(v)).push(prev); }
        edgeSet.get(key).srcs.add(e.s);
        if (ch[ch.length - 1] !== v) ch.push(v);
      }
      prev = v;
    }
  });
  // 每个顶点的邻居按角度排序；半边 u→v 的下一条＝在 v 处从 v→u 方向顺时针转过去的下一个邻居（走出左手边的面）
  const ang = (u, w) => Math.atan2(V[w][1] - V[u][1], V[w][0] - V[u][0]);
  adj.forEach((ns, u) => { const uniq = [...new Set(ns)]; uniq.sort((a, b) => ang(u, a) - ang(u, b)); adj.set(u, uniq); });
  const used = new Set(), faces = [];
  for (const [u, ns] of adj) for (const v of ns){
    if (used.has(u + '>' + v)) continue;
    const cyc = []; let a = u, b = v, guard = 0;
    while (!used.has(a + '>' + b) && guard++ < 1e6){
      used.add(a + '>' + b); cyc.push(a);
      const nb = adj.get(b), i = nb.indexOf(a), next = nb[(i - 1 + nb.length) % nb.length];
      a = b; b = next;
    }
    if (cyc.length >= 3) faces.push(cyc.map(k => V[k]));
  }
  return {V, adj, faces, chains};
}
/* build_children：来源 → [来源组, 面…, 边…] */
function buildChildren(sources){
  const lv = []; sources.forEach(n => leaves(n, lv));
  const shapes = lv.map(l => ({polys:polysOf(l), rule:l.type === 'compound' && l.rule === 'evenodd' ? 'evenodd' : 'nonzero', fill:l.fill === undefined ? 'none' : clone(l.fill), stroke:l.stroke === undefined ? 'none' : clone(l.stroke), w:R3.hasStroke(l) ? l.strokeWidth : (l.strokeWidth || 1)})).filter(s => s.polys.length);
  if (!shapes.length) return {err:'Live Paint: select paths or compound paths'};
  const pl = planar(shapes); if (!pl) return {err:'Live Paint: select paths or compound paths'};
  const src = {id:R3.newId(), type:'group', name:SOURCES, visible:false, children:sources};
  // 有界面：面积号跟「整个分量的外圈」相反的那些
  let maxA = 0, outerSign = 1; pl.faces.forEach(F => { const a = area(F); if (Math.abs(a) > maxA){ maxA = Math.abs(a); outerSign = Math.sign(a); } });
  const fs = [];
  for (const F of pl.faces){
    const a = area(F); if (Math.sign(a) === outerSign || Math.abs(a) < 1e-6) continue;
    const P = a < 0 ? F.slice().reverse() : F, ip = interiorPoint([P], 'nonzero'); if (!ip) continue;
    let top = -1; for (let i = shapes.length - 1; i >= 0; i--) if (inside(shapes[i].polys, shapes[i].rule, ip)){ top = i; break; }
    if (top < 0) continue;                                               // 不在任何来源里面（来源之间围出来的空地）不是面
    const v = AIObj.tidyLoop(P); if (!v) continue;
    fs.push({area:Math.abs(a), node:{id:R3.newId(), type:'bezier', name:FACE, anchors:v.anchors, closed:true, fill:clone(shapes[top].fill), stroke:'none', strokeWidth:0}});
  }
  fs.sort((x, y) => y.area - x.area);
  // 边：每条来源轮廓在度数 > 2 的顶点切开
  const es = [];
  shapes.forEach((sh, si) => pl.chains[si].forEach(ch => {
    const c = ch.slice(); if (c.length > 1 && c[0] === c[c.length - 1]) c.pop();
    if (c.length < 2) return;
    const deg = k => (pl.adj.get(k) || []).length;
    const start = c.findIndex(k => deg(k) > 2), closedLoop = start < 0;
    const seq = closedLoop ? c.concat([c[0]]) : c.slice(start).concat(c.slice(0, start)).concat([c[start]]);
    let cur = [seq[0]];
    for (let i = 1; i < seq.length; i++){
      cur.push(seq[i]);
      if (i === seq.length - 1 || (!closedLoop && deg(seq[i]) > 2)){
        if (cur.length >= 2) es.push({id:R3.newId(), type:'path', name:EDGE, points:cur.map(k => pl.V[k].slice()), closed:false, fill:'none', stroke:clone(sh.stroke), strokeWidth:sh.w});
        cur = [seq[i]];
      }
    }
  }));
  return {children:[src].concat(fs.map(f => f.node), es), faces:fs.length, edges:es.length};
}
const sourcesOf = g => { const s = (g.children || []).find(c => c.name === SOURCES); return s ? s.children : []; };
const facesOf = g => (g.children || []).filter(c => c.name === FACE);
const edgesOf = g => (g.children || []).filter(c => c.name === EDGE);
const sourceNodes = n => isLP(n) ? sourcesOf(n) : [n];
/* face_at：画的顺序最后一个包含该点的面（图层坐标） */
function faceAt(g, p){ const F = facesOf(g); for (let i = F.length - 1; i >= 0; i--){ if (inside(polysOf(F[i]), 'nonzero', p)) return F[i]; } return null; }
function edgeNear(g, p, tol){
  let best = null;
  for (const e of edgesOf(g)){ const P = e.points; for (let i = 0; i + 1 < P.length; i++){ const a = P[i], b = P[i + 1], d = sub(b, a), L2 = d[0] * d[0] + d[1] * d[1]; const t = L2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2, 0), 1) : 0; const q = [a[0] + d[0] * t, a[1] + d[1] * t], dd = dist(p, q); if (dd <= tol && (!best || dd < best[0])) best = [dd, e]; } }
  return best ? best[1] : null;
}
R3.livePaint = {isLP, faceAt, edgeNear, buildChildren, planar};
function rootIds(p, C){
  const L = R3.vLayer(p); if (!L) return {err:err(C, 'not a vector layer')};
  const ids = Array.isArray(p.ids) ? p.ids : p.id ? [p.id] : null;
  const R = R3.roots(L, ids); if (!R.length) return {err:{ok:false, error:'nothing selected'}};
  return {L, R};
}
function makeLive(L, R){
  const sources = []; R.forEach(n => sources.push(...sourceNodes(n)));
  const b = buildChildren(sources); if (b.err) return {err:{ok:false, error:b.err}};
  const g = {id:R3.newId(), type:'group', name:NAME, children:b.children};
  const S = L.data.shapes, idx = Math.min(...R.map(r => S.indexOf(r)));
  L.data.shapes = S.filter(s => !R.includes(s)); L.data.shapes.splice(idx, 0, g);
  R3.selectIds(L, [g.id]);
  return {g, faces:b.faces, edges:b.edges};
}
reg('ai.livePaint.make', {undoable:true, params:'{ids?} 对象 ▸ 实时上色 ▸ 建立（buildcmds.rs:435-439；Ctrl+Alt+X）：选中的路径做成实时上色组（来源藏在里面、面＝平面分割的区域、边＝交点切开的轮廓）→ {ok, id, faces, edges}'}, p => {
  const t = rootIds(p, 'ai.livePaint.make'); if (t.err) return t.err;
  const m = makeLive(t.L, t.R); if (m.err) return m.err;
  return done(t.L, {id:m.g.id, faces:m.faces, edges:m.edges});
});
reg('ai.livePaint.merge', {undoable:true, params:'{ids?} 对象 ▸ 实时上色 ▸ 合并（buildcmds.rs:441-503）：把其它选中的路径（与实时上色组）并进第一个实时上色组，原本面／边的颜色留着 → {ok, id, faces, edges}'}, p => {
  const t = rootIds(p, 'ai.livePaint.merge'); if (t.err) return t.err;
  const tg = t.R.find(isLP); if (!tg) return {ok:false, error:'Live Paint Merge: select a Live Paint group and the paths to add'};
  const keepF = facesOf(tg).filter(f => R3.painted(f.fill)).map(f => [interiorPoint(polysOf(f), 'nonzero'), clone(f.fill)]).filter(x => x[0]);
  const keepE = edgesOf(tg).map(e => { const P = e.points; if (P.length < 2) return null; const m = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2]; return [m, {stroke:clone(e.stroke), strokeWidth:e.strokeWidth}]; }).filter(Boolean);
  let sources = sourcesOf(tg).slice(); t.R.filter(r => r !== tg).forEach(r => sources.push(...sourceNodes(r)));
  const b = buildChildren(sources); if (b.err) return {ok:false, error:b.err};
  tg.children = b.children;
  for (const [pt, f] of keepF){ const fc = faceAt(tg, pt); if (fc) fc.fill = f; }
  for (const [pt, a] of keepE){ const e = edgeNear(tg, pt, 0.5); if (e) Object.assign(e, a); }
  t.L.data.shapes = t.L.data.shapes.filter(s => s === tg || !t.R.includes(s));
  R3.selectIds(t.L, [tg.id]); return done(t.L, {id:tg.id, faces:b.faces, edges:b.edges});
});
function liveTargets(p, C){ const t = rootIds(p, C); if (t.err) return t; const R = t.R.filter(isLP); if (!R.length) return {err:{ok:false, error:'select a Live Paint group'}}; return {L:t.L, R}; }
reg('ai.livePaint.release', {undoable:true, params:'{id?|ids?} 对象 ▸ 实时上色 ▸ 释放（buildcmds.rs:515-528）：实时上色组换回原本的路径 → {ok, ids}'}, p => {
  const t = liveTargets(p, 'ai.livePaint.release'); if (t.err) return t.err;
  const out = [];
  for (const g of t.R){ const S = t.L.data.shapes, i = S.indexOf(g), src = sourcesOf(g); S.splice(i, 1, ...src); src.forEach(s => out.push(s.id)); }
  R3.selectIds(t.L, out); return done(t.L, {ids:out});
});
reg('ai.livePaint.expand', {undoable:true, params:'{id?|ids?} 对象 ▸ 实时上色 ▸ 扩展（buildcmds.rs:530-550）：变成一般编组——拿掉来源组、没上色的面、没描边的边 → {ok, ids}'}, p => {
  const t = liveTargets(p, 'ai.livePaint.expand'); if (t.err) return t.err;
  for (const g of t.R){ delete g.name; g.children = g.children.filter(c => c.name === SOURCES ? false : c.name === FACE ? R3.painted(c.fill) : c.name === EDGE ? (R3.painted(c.stroke) && (c.strokeWidth || 0) > 0) : true); }
  R3.selectIds(t.L, t.R.map(g => g.id)); return done(t.L, {ids:t.R.map(g => g.id)});
});
const toLayerPt = (L, p) => [+p[0] - L.x, +p[1] - L.y];
reg('ai.livePaint.fill', {undoable:true, params:'{group?: id | ids?:[…]（先做成实时上色）, point:[x,y] 文件坐标, color?: "#rrggbb"|"none"（缺省＝目前填色）} 实时上色油漆桶（buildcmds.rs:552-578 livePaint.fill）：点到的那个面上色 → {ok, group, face}'}, p => {
  const C = 'ai.livePaint.fill';
  if (!Array.isArray(p.point) || !p.point.every(v => isFinite(+v))) return err(C, 'missing point [x,y]');
  const paint = p.color !== undefined ? String(p.color) : (window.UI ? UI.fill() : '#000000');   // 缺省＝目前填色（工具栏填色钮）
  let L, g;
  if (p.group){ const h = R3.findDeep(p.group); if (!h || !isLP(h.s)) return err(C, `${p.group} is not a Live Paint group`); L = h.L; g = h.s; }
  else {
    const t = rootIds(p, C); if (t.err) return t.err; L = t.L;
    g = t.R.find(r => isLP(r) && faceAt(r, toLayerPt(L, p.point)));
    if (!g){ const m = makeLive(L, t.R); if (m.err) return m.err; g = m.g; }
  }
  const f = faceAt(g, toLayerPt(L, p.point)); if (!f) return {ok:false, error:'no Live Paint face at that point'};
  f.fill = paint; return done(L, {group:g.id, face:f.id});
});
reg('ai.livePaint.strokeEdge', {undoable:true, params:'{group: id, point:[x,y] 文件坐标, color?: "#rrggbb"|"none"（缺省＝目前描边）, width?: 点（缺省＝目前描边粗细）, tolerance?: 点 (4)} 实时上色油漆桶（描边）（buildcmds.rs:580-602）：离点最近的边上描边 → {ok, group, edge}'}, p => {
  const C = 'ai.livePaint.strokeEdge';
  if (!Array.isArray(p.point) || !p.point.every(v => isFinite(+v))) return err(C, 'missing point [x,y]');
  const h = p.group ? R3.findDeep(p.group) : null; if (!h || !isLP(h.s)) return err(C, `${p.group} is not a Live Paint group`);
  const w = num(p.width, window.UI ? UI.strokeW() : 1); if (!(w >= 0 && w <= 1000)) return err(C, 'width out of range');
  const e = edgeNear(h.s, toLayerPt(h.L, p.point), Math.min(Math.max(num(p.tolerance, 4), 0), 1000)); if (!e) return {ok:false, error:'no Live Paint edge near that point'};
  e.stroke = p.color !== undefined ? String(p.color) : (window.UI ? UI.stroke() : '#000000'); e.strokeWidth = w;
  return done(h.L, {group:h.s.id, edge:e.id});
});
reg('ai.livePaint.info', {params:'{group} 实时上色组的面与边 → {ok, faces:[{id, fill, bounds}], edges:[{id, stroke, width}], sources}'}, p => {
  const h = (p.group || p.id) ? R3.findDeep(p.group || p.id) : null; if (!h || !isLP(h.s)) return err('ai.livePaint.info', `${p.group} is not a Live Paint group`);
  return {ok:true, faces:facesOf(h.s).map(f => { const b = AIObj.shapeBounds(f, R3.docF(h.L), false); return {id:f.id, fill:f.fill, bounds:b ? [b.x0, b.y0, b.x1, b.y1] : null}; }),
    edges:edgesOf(h.s).map(e => ({id:e.id, stroke:e.stroke, width:e.strokeWidth})), sources:sourcesOf(h.s).length};
});
})();


/*对象 ▸ 图案（建立／编辑图案／拼贴边缘颜色…）：照 VectorCraft 原码
     engine/src/cmd/patterncmds.rs:23-90（登记）、151-166 editing／can_edit_pattern、211-277 unique_pattern_name／next_pattern_name／add_pattern／
         enter_edit（图案的拼贴图稿复制一份进临时顶层「图案编辑模式」、隔离到这层、选中复制品）／leave_edit／after_edit_mode／tile_type_param、
         281-615 pattern_make／pattern_edit／pattern_done／pattern_cancel／pattern_save_copy／pattern_options／rename_pattern_uses／pattern_delete／
         pattern_list／pattern_transform
     doc/src/pattern.rs:42-355  TileType（网格／砖形按行／砖形按列／十六进制按列／按行，parse、steps）、tile_offset、brick_repeat、tile_period、Overlap、
         PatternDef（new：拼贴＝图稿几何外框；fit_tile_to_art；offsets_covering：盖到某区域的副本、按「前后」排绘制顺序；preview_offsets）、
         PatternEdit、pattern_paint（xf＝单位矩阵＝拼贴锚在原点）、uses_pattern、transform_pattern_paints
     render/src/pattern.rs:1-221  set_pattern_paint（超级拼贴＝一个周期，按装置比例取 2 的次方点阵化、上限 2048 像素，当重复的图样画；缺图案＝灰）、
         raster_scale、rasterize、with_tile_renderer（嵌套最多 3 层）、draw_pattern_edit（只画编辑层＋周围按「副本变暗」画的副本＋拼贴边缘细线＋色板边界虚线）
     svg/src/export.rs:673-712  pattern_def（<pattern> 一个周期、userSpaceOnUse、patternTransform）
     ui-egui/src/dialogs/tile_edge_color.rs 全档（栏位 color：预设名或 #rrggbb；确定＝prefs.set patternTileEdgeColor）、doc/src/node.rs:33-61 LAYER_COLORS 27 色、
     engine/src/lib.rs:428-431、620-623（偏好 patternTileEdgeColor，预设＝LAYER_COLORS[0] 淡蓝色 #4f80ff）
   资料：Doc.aiR3.patterns＝[{name, tile:{x0,y0,x1,y1}, tileType:{type, offset?}, art:[形状…（文件坐标）], overlap:{rightInFront, bottomInFront},
           sizeTileToArt, hSpacing, vSpacing, copies, dimCopies, showTileEdge, showSwatchBounds}]（进历史快照、进工程档）
         Doc.aiR3.patternEdit＝{pattern, layerId, original|null, prevActive}（编辑模式，跟着 undo 走）
         图案填色＝形状的 fill／stroke 放 {type:'pattern', pattern:名字, xf:[a,b,c,d,e,f]}（图案空间 → 图层坐标；我们的渐变也存图层坐标，原码是文件坐标）
   跟原码不同：原码新增图案时也加一个色板（swatches）——我们的色板面板只有颜色，图案色板就是 Doc.aiR3.patterns 本身（ai.pattern.list 列）；
         图案编辑模式隔离：原码 renderer 只画编辑层，我们链式包 window.composite（其它层画的时候暂时当看不见）＋ renderLayer（编辑层底下画变暗的副本）。 */
(function(){
'use strict';
if (window.__aiR3_pattern) return; window.__aiR3_pattern = true;
const R3 = window.AiR3, {num, reg, clone} = R3;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const I6 = [1, 0, 0, 1, 0, 0];
const T = k => (window.Lang ? Lang.t(k) : k);

/* ═════ pattern.rs：拼贴种类与几何 ═════ */
const TILE_IDS = ['grid', 'brickByRow', 'brickByColumn', 'hexByColumn', 'hexByRow'];
/* TileType::parse（pattern.rs:88-98） */
function parseTile(s, offset){
  const o = offset === null || offset === undefined ? 0.5 : offset;
  switch (String(s).toLowerCase().replace(/[-_ ]/g, '')){
    case 'grid': return {type:'grid'};
    case 'brickbyrow': case 'brickrow': case 'brick': return {type:'brickByRow', offset:o};
    case 'brickbycolumn': case 'brickcolumn': case 'brickcol': return {type:'brickByColumn', offset:o};
    case 'hexbycolumn': case 'hexcolumn': case 'hexcol': case 'hex': return {type:'hexByColumn'};
    case 'hexbyrow': case 'hexrow': return {type:'hexByRow'};
  }
  return null;
}
const steps = (tt, w, h) => tt.type === 'hexByColumn' ? [w * 0.75, h] : tt.type === 'hexByRow' ? [w, h * 0.75] : [w, h];
const frac = v => v - Math.floor(v);
const rem2 = i => ((i % 2) + 2) % 2;
/* tile_offset（pattern.rs:112-122） */
function tileOffset(tt, w, h, i, j){
  switch (tt.type){
    case 'brickByRow': return [i * w + frac(j * tt.offset) * w, j * h];
    case 'brickByColumn': return [i * w, j * h + frac(i * tt.offset) * h];
    case 'hexByColumn': return [i * w * 0.75, j * h + (rem2(i) === 1 ? h / 2 : 0)];
    case 'hexByRow': return [i * w + (rem2(j) === 1 ? w / 2 : 0), j * h * 0.75];
    default: return [i * w, j * h];
  }
}
/* brick_repeat（pattern.rs:125-133） */
function brickRepeat(offset){ for (let q = 1; q <= 24; q++){ const v = q * offset; if (Math.abs(v - Math.round(v)) < 1e-6) return q; } return 24; }
/* tile_period（pattern.rs:136-144） */
function tilePeriod(tt, w, h){
  switch (tt.type){
    case 'brickByRow': return [w, h * brickRepeat(tt.offset)];
    case 'brickByColumn': return [w * brickRepeat(tt.offset), h];
    case 'hexByColumn': return [w * 1.5, h];
    case 'hexByRow': return [w, h * 1.5];
    default: return [w, h];
  }
}
const pw = d => Math.max(d.tile.x1 - d.tile.x0, 1e-3), ph = d => Math.max(d.tile.y1 - d.tile.y0, 1e-3);
const period = d => tilePeriod(d.tileType, pw(d), ph(d));
const offsetOf = (d, i, j) => tileOffset(d.tileType, pw(d), ph(d), i, j);
const union = (r, b) => !r ? b : !b ? r : {x0:Math.min(r.x0, b.x0), y0:Math.min(r.y0, b.y0), x1:Math.max(r.x1, b.x1), y1:Math.max(r.y1, b.y1)};
const geoBounds = list => list.reduce((r, s) => union(r, AIObj.shapeBounds(s, p => p, false)), null);         // live::nodes_bounds
const artBounds = d => d.art.reduce((r, s) => union(r, AIObj.shapeBounds(s, p => p, true)), null);           // PatternDef::art_bounds（含描边）
/* PatternDef::new（pattern.rs:193-209） */
function newDef(name, art){
  const b = geoBounds(art) || {x0:0, y0:0, x1:10, y1:10};
  return {name, tile:{x0:b.x0, y0:b.y0, x1:b.x1, y1:b.y1}, tileType:{type:'grid'}, art, overlap:{rightInFront:false, bottomInFront:false},
    sizeTileToArt:false, hSpacing:0, vSpacing:0, copies:5, dimCopies:70, showTileEdge:true, showSwatchBounds:false};
}
/* fit_tile_to_art（pattern.rs:221-225） */
function fitTile(d){ const b = geoBounds(d.art); if (b) d.tile = {x0:b.x0 - d.hSpacing / 2, y0:b.y0 - d.vSpacing / 2, x1:b.x1 + d.hSpacing / 2, y1:b.y1 + d.vSpacing / 2}; }
/* offsets_covering（pattern.rs:245-269）：region 是图案空间（拼贴左上角在原点） */
function offsetsCovering(d, region){
  const w = pw(d), h = ph(d), t = d.tile;
  const a0 = union(artBounds(d) || t, t), ab = {x0:a0.x0 - t.x0, y0:a0.y0 - t.y0, x1:a0.x1 - t.x0, y1:a0.y1 - t.y0};
  const [sx, sy] = steps(d.tileType, w, h);
  const i0 = Math.floor((region.x0 - ab.x1 - w) / sx) - 1, i1 = Math.ceil((region.x1 - ab.x0 + w) / sx) + 1;
  const j0 = Math.floor((region.y0 - ab.y1 - h) / sy) - 1, j1 = Math.ceil((region.y1 - ab.y0 + h) / sy) + 1;
  if ((i1 - i0) * (j1 - j0) > 250000) return [];
  const range = (a, b, fwd) => { const v = []; for (let k = a; k <= b; k++) v.push(k); return fwd ? v : v.reverse(); };
  const out = [];
  for (const j of range(j0, j1, d.overlap.bottomInFront)) for (const i of range(i0, i1, d.overlap.rightInFront)){
    const o = offsetOf(d, i, j);
    if (ab.x0 + o[0] < region.x1 && ab.x1 + o[0] > region.x0 && ab.y0 + o[1] < region.y1 && ab.y1 + o[1] > region.y0) out.push(o);
  }
  return out;
}
/* preview_offsets（pattern.rs:272-283） */
function previewOffsets(d){
  const k = Math.floor(Math.min(Math.max(d.copies, 1), 15) / 2), out = [];
  for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) if (i || j) out.push(offsetOf(d, i, j));
  return out;
}
const swatchBounds = d => { const [w, h] = period(d); return {x0:d.tile.x0, y0:d.tile.y0, x1:d.tile.x0 + w, y1:d.tile.y0 + h}; };
const tileJson = tt => tt.type;
const isPat = p => !!p && typeof p === 'object' && p.type === 'pattern' && typeof p.pattern === 'string';
const patternPaint = name => ({type:'pattern', pattern:name, xf:I6.slice()});

/* ═════ 文件级资料 ═════ */
R3.docDefaults.patterns = () => [];
/* 工程档存 Doc.aiR3 由 ai-view.js 的 AiR3 共用段（v0）包 Project.serialize／load；这里只再包一层 load：读回来后清掉图案的渲染快取。
   🔴 要包在 ai-view 那层「外面」（它在 load 之后才放回 Doc.aiR3；包在里面的话，原 load 画的那次图案还不在、灰色被矢量层快取住）
   ⇒ 等 DOMContentLoaded（ai-view.js 已载入）才包，见档尾 hookLate */
function hookProjectLoad(){
  if (typeof Project === 'undefined' || !Project || Project.__r3PatHook) return;
  Project.__r3PatHook = true;
  const load = Project.load;
  Project.load = async function(){
    const r = await load.apply(this, arguments);
    R3.invalidateAll(); _tiles.clear();
    if (window.UI) UI.draw();
    return r;
  };
}
const pats = () => R3.doc('patterns');
const findPat = name => ((Doc.aiR3 && Array.isArray(Doc.aiR3.patterns)) ? Doc.aiR3.patterns : []).find(d => d.name === name) || null;
function editing(){
  const pe = Doc.aiR3 && Doc.aiR3.patternEdit; if (!pe) return null;
  return Doc.byId(pe.layerId) ? pe : null;
}
const editLayer = () => { const pe = editing(); return pe ? Doc.byId(pe.layerId) : null; };
/* 所有矢量层（＋图案图稿）里用到某图案的形状 */
function eachShape(cb){
  for (const L of Doc.layers) if (L.kind === 'vector') R3.walk(L.data.shapes, s => cb(s));
  for (const d of pats()) R3.walk(d.art, s => cb(s));
}
const usesPattern = (s, name) => ['fill', 'stroke'].some(k => isPat(s[k]) && (name === null || name === undefined || s[k].pattern === name));
/* unique_pattern_name／next_pattern_name（patterncmds.rs:211-220） */
function uniqueName(base){ if (!findPat(base)) return base; for (let i = 2; ; i++){ const n = `${base} ${i}`; if (!findPat(n)) return n; } }
function nextName(){ for (let i = 1; ; i++){ const n = `New Pattern ${i}`; if (!findPat(n)) return n; } }
/* 形状（图层坐标）→ 文件坐标的深拷贝、新 id */
function toDocCopy(s, L){ const c = R3.reid(s); if (L && (L.x || L.y)) shiftShape(c, L.x, L.y); return c; }
/* tile_type_param（patterncmds.rs:267-277） */
function tileTypeParam(p, C, cur){
  let off = (p.brickOffset !== undefined && p.brickOffset !== null && isFinite(+p.brickOffset)) ? +p.brickOffset : null;
  if (off !== null && off > 1) off /= 100;
  if (typeof p.tileType === 'string'){ const t = parseTile(p.tileType, off); return t ? {tt:t} : {err:err(C, `unknown tileType \`${p.tileType}\` (${TILE_IDS.join('|')})`)}; }
  if ((cur.type === 'brickByRow' || cur.type === 'brickByColumn') && off !== null) return {tt:{type:cur.type, offset:off}};
  return {tt:clone(cur)};
}

/* ═════ 编辑模式（enter_edit／leave_edit／after_edit_mode） ═════ */
function enterEdit(name, original){
  const d = findPat(name); if (!d) return null;
  const L = Layer.vector(T('ai3pat.editLayer'));
  L.data.shapes = d.art.map(s => R3.reid(s));
  const prevActive = Doc.activeId;
  Doc.layers.push(L);
  Doc.aiR3.patternEdit = {pattern:name, layerId:L.id, original:original ? clone(original) : null, prevActive};
  Doc.activeId = L.id;                                              // after_edit_mode：现用层＝编辑层（隔离）
  R3.selectIds(L, L.data.shapes.map(s => s.id));
  return L;
}
function leaveEdit(){
  const pe = editing(); if (!pe) return null;
  const L = Doc.byId(pe.layerId);
  const art = L.data.shapes.map(s => toDocCopy(s, L));
  Doc.layers.splice(Doc.layers.indexOf(L), 1);
  Doc.aiR3.patternEdit = null;
  Doc.activeId = (pe.prevActive && Doc.byId(pe.prevActive)) ? pe.prevActive : (Doc.layers.length ? Doc.layers[Doc.layers.length - 1].id : null);
  VecSel.clear();
  return {pe, art};
}
const allDirty = () => { R3.invalidateAll(); _tiles.clear(); };

/* ═════ 命令 ═════ */
reg('ai.object.pattern.make', {undoable:true, params:'{ids?, name?, tileType?: "grid"|"brickByRow"|"brickByColumn"|"hexByColumn"|"hexByRow", brickOffset?: 0..1 (0.5), width?, height?（拼贴大小，缺省＝图稿几何外框）, edit?: bool (true)} 对象 ▸ 图案 ▸ 建立（patterncmds.rs:281-319）：选中的物件复制一份成新的图案（名字缺省「New Pattern n」），并进图案编辑模式（临时顶层，完成＝ai.object.pattern.done、取消＝ai.object.pattern.cancel）→ {ok, name}'}, p => {
  const C = 'ai.object.pattern.make';
  if (editing()) return err(C, 'already in pattern editing mode');
  const t = R3.targets(p, C); if (t.err) return err(C, 'select the art for the pattern tile');
  const tt = tileTypeParam(p, C, {type:'grid'}); if (tt.err) return tt.err;
  const w = p.width === undefined || p.width === null ? null : +p.width, h = p.height === undefined || p.height === null ? null : +p.height;
  if ((w !== null && !(isFinite(w) && w > 0)) || (h !== null && !(isFinite(h) && h > 0))) return err(C, 'width/height must be > 0');
  const edit = p.edit === undefined ? true : !!p.edit;
  const name = typeof p.name === 'string' && p.name ? uniqueName(p.name) : nextName();
  const def = newDef(name, t.R.map(s => toDocCopy(s, t.L)));
  def.tileType = tt.tt;
  const cx = (def.tile.x0 + def.tile.x1) / 2, cy = (def.tile.y0 + def.tile.y1) / 2;
  const W = Math.max(w !== null ? w : def.tile.x1 - def.tile.x0, 1e-3), H = Math.max(h !== null ? h : def.tile.y1 - def.tile.y0, 1e-3);
  def.tile = {x0:cx - W / 2, y0:cy - H / 2, x1:cx + W / 2, y1:cy + H / 2};
  pats().push(def);                                                 // add_pattern
  if (edit) enterEdit(name, null);
  allDirty();
  return {ok:true, name};
});
/* 选中物件（往编组里找）的填色／描边图案名 */
function selectedPatternName(){
  const L = VecSel.layer(); if (!L || L.kind !== 'vector') return null;
  let hit = null;
  for (const id of VecSel.shapes){
    const h = R3.findDeep(id, L); if (!h) continue;
    R3.walk([h.s], s => { if (hit) return; for (const k of ['fill', 'stroke']) if (!hit && isPat(s[k])) hit = s[k].pattern; });
    if (hit) break;
  }
  return hit;
}
reg('ai.object.pattern.edit', {undoable:true, params:'{name?} 对象 ▸ 图案 ▸ 编辑图案（patterncmds.rs:321-345）：进图案编辑模式（缺省＝选中物件的填色／描边图案）；编辑层里改图稿，完成＝ai.object.pattern.done → {ok, name}'}, p => {
  const C = 'ai.object.pattern.edit';
  if (editing()) return err(C, 'already editing a pattern');
  if (!pats().length) return err(C, 'the document has no patterns');
  const name = typeof p.name === 'string' && p.name ? p.name : selectedPatternName();
  if (!name) return err(C, 'give a pattern name or select an object painted with a pattern');
  const orig = findPat(name); if (!orig) return err(C, `no pattern \`${name}\``);
  enterEdit(name, orig);
  allDirty();
  return {ok:true, name};
});
reg('ai.object.pattern.done', {undoable:true, params:'{} 图案编辑模式 ▸ 完成（patterncmds.rs:354-367）：编辑层的图稿存回图案（勾了「将拼贴调整为图稿大小」就重算拼贴）、拿掉编辑层 → {ok, name}'}, () => {
  const C = 'ai.object.pattern.done';
  const r = leaveEdit(); if (!r) return err(C, 'not in pattern editing mode');
  const d = findPat(r.pe.pattern);
  if (d){ d.art = r.art; if (d.sizeTileToArt) fitTile(d); }
  allDirty();
  return {ok:true, name:r.pe.pattern};
});
reg('ai.object.pattern.cancel', {undoable:true, params:'{} 图案编辑模式 ▸ 取消（patterncmds.rs:369-387）：丢掉这次的改动（编辑既有图案＝回原定义；「建立」进来的＝连图案一起删）→ {ok}'}, () => {
  const C = 'ai.object.pattern.cancel';
  const r = leaveEdit(); if (!r) return err(C, 'not in pattern editing mode');
  const list = pats(), i = list.findIndex(d => d.name === r.pe.pattern);
  if (r.pe.original){ if (i >= 0) list[i] = clone(r.pe.original); }
  else if (i >= 0) list.splice(i, 1);
  allDirty();
  return {ok:true};
});
reg('ai.object.pattern.saveCopy', {undoable:true, params:'{name?} 图案编辑模式 ▸ 存储副本（patterncmds.rs:389-405）：目前的拼贴另存成新图案（缺省「<名字> copy」），继续编辑原图案 → {ok, name}'}, p => {
  const C = 'ai.object.pattern.saveCopy';
  const pe = editing(); if (!pe) return err(C, 'not in pattern editing mode');
  const src = findPat(pe.pattern); if (!src) return err(C, 'pattern missing');
  const L = Doc.byId(pe.layerId), def = clone(src);
  def.name = uniqueName(typeof p.name === 'string' && p.name ? p.name : `${pe.pattern} copy`);
  def.art = L.data.shapes.map(s => toDocCopy(s, L));
  if (def.sizeTileToArt) fitTile(def);
  pats().push(def);
  return {ok:true, name:def.name};
});
/* rename_pattern_uses（patterncmds.rs:482-512） */
function renameUses(old, nn){
  eachShape(s => { for (const k of ['fill', 'stroke']) if (isPat(s[k]) && s[k].pattern === old) s[k].pattern = nn; });
  const pe = Doc.aiR3.patternEdit; if (pe && pe.pattern === old) pe.pattern = nn;
}
reg('ai.pattern.options', {undoable:true, params:'{name?（缺省＝正在编辑的图案）, newName?, tileType?, brickOffset?, width?, height?, hSpacing?, vSpacing?, sizeTileToArt?: bool, overlap?: {h: "left"|"right", v: "top"|"bottom"}, copies?: 3|5|7|9, dimCopies?: %, showTileEdge?: bool, showSwatchBounds?: bool} 窗口 ▸ 图案选项（patterncmds.rs:407-479）：改图案的拼贴类型、大小、间距、重叠、编辑模式的副本数与变暗 → {ok, name}'}, p => {
  const C = 'ai.pattern.options';
  const pe = editing();
  const name = typeof p.name === 'string' && p.name ? p.name : (pe ? pe.pattern : null);
  if (!name) return err(C, 'give `name` (or edit a pattern)');
  const cur = findPat(name); if (!cur) return err(C, `no pattern \`${name}\``);
  const tt = tileTypeParam(p, C, cur.tileType); if (tt.err) return tt.err;
  const n = k => (p[k] !== undefined && p[k] !== null && p[k] !== '' && isFinite(+p[k])) ? +p[k] : null;
  for (const k of ['width', 'height']) if (p[k] !== undefined && p[k] !== null && !(isFinite(+p[k]) && +p[k] > 0)) return err(C, `${k} must be > 0`);
  const newName = typeof p.newName === 'string' && p.newName && p.newName !== name ? p.newName : null;
  if (newName && findPat(newName)) return err(C, `a pattern named \`${newName}\` exists`);
  const def = cur;
  def.tileType = tt.tt;
  if (p.overlap && typeof p.overlap === 'object'){
    if (typeof p.overlap.h === 'string') def.overlap.rightInFront = p.overlap.h === 'right';
    if (typeof p.overlap.v === 'string') def.overlap.bottomInFront = p.overlap.v === 'bottom';
  }
  if (n('hSpacing') !== null) def.hSpacing = n('hSpacing');
  if (n('vSpacing') !== null) def.vSpacing = n('vSpacing');
  if (typeof p.sizeTileToArt === 'boolean') def.sizeTileToArt = p.sizeTileToArt;
  if (n('copies') !== null) def.copies = Math.min(Math.max(Math.trunc(n('copies')), 1), 15) | 1;
  if (n('dimCopies') !== null) def.dimCopies = Math.min(Math.max(n('dimCopies'), 0), 100);
  if (typeof p.showTileEdge === 'boolean') def.showTileEdge = p.showTileEdge;
  if (typeof p.showSwatchBounds === 'boolean') def.showSwatchBounds = p.showSwatchBounds;
  if (def.sizeTileToArt){
    const L = pe && pe.pattern === name ? Doc.byId(pe.layerId) : null;            // 编辑中＝拿编辑层的图稿量
    const saved = def.art; if (L) def.art = L.data.shapes.map(s => toDocCopy(s, L)); fitTile(def); def.art = saved;
  } else if (n('width') !== null || n('height') !== null){
    const cx = (def.tile.x0 + def.tile.x1) / 2, cy = (def.tile.y0 + def.tile.y1) / 2;
    const W = n('width') !== null ? n('width') : def.tile.x1 - def.tile.x0, H = n('height') !== null ? n('height') : def.tile.y1 - def.tile.y0;
    def.tile = {x0:cx - W / 2, y0:cy - H / 2, x1:cx + W / 2, y1:cy + H / 2};
  }
  if (newName){ def.name = newName; renameUses(name, newName); }
  allDirty();
  return {ok:true, name:newName || name};
});
reg('ai.pattern.delete', {undoable:true, params:'{name} 删除图案色板（patterncmds.rs:524-557）：用到它的填色／描边变成无 → {ok, unpainted}'}, p => {
  const C = 'ai.pattern.delete';
  if (typeof p.name !== 'string' || !p.name) return err(C, 'missing name');
  if (!findPat(p.name)) return err(C, `no pattern \`${p.name}\``);
  const pe = editing(); if (pe && pe.pattern === p.name) return err(C, 'finish editing the pattern first');
  Doc.aiR3.patterns = pats().filter(d => d.name !== p.name);
  let n = 0;
  eachShape(s => { let hit = false; for (const k of ['fill', 'stroke']) if (isPat(s[k]) && s[k].pattern === p.name){ s[k] = 'none'; hit = true; } if (hit) n++; });
  allDirty();
  return {ok:true, unpainted:n};
});
reg('ai.pattern.list', {params:'{} 列出图案（patterncmds.rs:559-587）→ {ok, patterns:[{name, tileType, brickOffset, tile:[x,y,w,h], width, height, hSpacing, vSpacing, sizeTileToArt, overlap, copies, dimCopies, showTileEdge, showSwatchBounds, artCount}], editing:{name, layer}|null}'}, () => {
  const out = ((Doc.aiR3 && Doc.aiR3.patterns) || []).map(d => ({name:d.name, tileType:tileJson(d.tileType), brickOffset:d.tileType.offset !== undefined ? d.tileType.offset : 0.5,
    tile:[d.tile.x0, d.tile.y0, d.tile.x1 - d.tile.x0, d.tile.y1 - d.tile.y0], width:d.tile.x1 - d.tile.x0, height:d.tile.y1 - d.tile.y0, hSpacing:d.hSpacing, vSpacing:d.vSpacing,
    sizeTileToArt:d.sizeTileToArt, overlap:{h:d.overlap.rightInFront ? 'right' : 'left', v:d.overlap.bottomInFront ? 'bottom' : 'top'}, copies:d.copies, dimCopies:d.dimCopies,
    showTileEdge:d.showTileEdge, showSwatchBounds:d.showSwatchBounds, artCount:d.art.length}));
  const pe = editing();
  return {ok:true, patterns:out, editing:pe ? {name:pe.pattern, layer:pe.layerId} : null};
});
const mul6 = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
reg('ai.pattern.transform', {undoable:true, params:'{ids?, layerId?, matrix: [a,b,c,d,e,f]} 变换图案（patterncmds.rs:589-615）：只动选中物件（含编组成员）图案填色的摆放 xf ← matrix·xf（图层坐标）→ {ok, count}'}, p => {
  const C = 'ai.pattern.transform';
  const m = Array.isArray(p.matrix) && p.matrix.length === 6 && p.matrix.every(v => isFinite(+v)) ? p.matrix.map(Number) : null;
  if (!m) return err(C, 'missing `matrix` [a,b,c,d,e,f]');
  const t = R3.targets(p, C); if (t.err) return err(C, 'nothing selected');
  let n = 0;
  R3.walk(t.R, s => { let hit = false; for (const k of ['fill', 'stroke']) if (isPat(s[k])){ s[k].xf = mul6(m, s[k].xf || I6); hit = true; } if (hit) n++; });
  R3.done(t.L);
  return {ok:true, count:n};
});
/* paint.setFill／setStroke 的 {pattern}（engine/src/cmd/paint.rs）：选中物件（编组往下套到每个成员）的填色／描边改成图案 */
reg('ai.paint.setPattern', {undoable:true, params:'{pattern: 名字, stroke?: bool（缺省＝填色）, ids?, layerId?} 把选中物件（编组里每个路径／复合路径）的填色（或描边）设成图案（拼贴锚在原点）→ {ok, count}'}, p => {
  const C = 'ai.paint.setPattern';
  if (typeof p.pattern !== 'string' || !findPat(p.pattern)) return err(C, `no pattern \`${p.pattern}\``);
  const t = R3.targets(p, C); if (t.err) return t.err;
  const key = p.stroke ? 'stroke' : 'fill', leaves = [];
  t.R.forEach(s => R3.leavesOf(s, leaves));
  leaves.forEach(s => { s[key] = patternPaint(p.pattern); if (key === 'stroke' && !(s.strokeWidth > 0)) s.strokeWidth = 1; });
  R3.done(t.L);
  return {ok:true, count:leaves.length};
});

/* ═════ 渲染：图案填色（render/src/pattern.rs set_pattern_paint） ═════ */
const MAX_TILE_PX = 2048;
const rasterScale = (s, p) => { s = Math.min(Math.max(s, 1e-3), 1e3); const p2 = Math.pow(2, Math.ceil(Math.log2(s))); return Math.max(Math.min(p2, MAX_TILE_PX / Math.max(p[0], p[1], 1e-6)), 1e-3); };
const _tiles = new Map();
let _depth = 0;
/* rasterize：图案空间的 region 画进 w×h 的画布 */
function rasterize(d, region, w, h){
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d'), kx = c.width / Math.max(region.x1 - region.x0, 1e-9), ky = c.height / Math.max(region.y1 - region.y0, 1e-9);
  _depth++;
  try {
    for (const o of offsetsCovering(d, region)){
      x.setTransform(kx, 0, 0, ky, (o[0] - d.tile.x0 - region.x0) * kx, (o[1] - d.tile.y0 - region.y0) * ky);
      for (const a of d.art) window.drawShape(x, a, 1);
    }
  } finally { _depth--; }
  return c;
}
function patternStyle(ctx, p, S){
  const d = findPat(p.pattern);
  if (!d) return 'rgb(128,128,128)';                                // 缺图案＝灰
  if (!d.art.length) return 'rgba(0,0,0,0)';
  if (_depth >= 3) return 'rgb(128,128,128)';                       // 图案里套图案太深
  const xf = Array.isArray(p.xf) && p.xf.length === 6 ? p.xf : I6;
  const M = ctx.getTransform ? ctx.getTransform() : new DOMMatrix();
  const dev = Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) * S * Math.sqrt(Math.abs(xf[0] * xf[3] - xf[1] * xf[2]));
  const per = period(d), scale = rasterScale(dev, per);
  const w = Math.min(Math.max(Math.ceil(per[0] * scale), 1), 4096), h = Math.min(Math.max(Math.ceil(per[1] * scale), 1), 4096);
  const key = JSON.stringify([d.art, d.tile, d.tileType, d.overlap, w, h]);
  let e = _tiles.get(d.name);
  if (!e || e.key !== key){
    if (_tiles.size > 64) _tiles.clear();
    e = {key, canvas:rasterize(d, {x0:0, y0:0, x1:per[0], y1:per[1]}, w, h)};
    _tiles.set(d.name, e);
  }
  const pat = ctx.createPattern(e.canvas, 'repeat');
  if (!pat) return 'rgba(0,0,0,0)';
  pat.setTransform(new DOMMatrix([S, 0, 0, S, 0, 0]).multiply(new DOMMatrix(xf)).scale(per[0] / w, per[1] / h));
  return pat;
}
/* SVG：一个周期的 <pattern>（svg/src/export.rs:673-712） */
const f4 = v => +(+v).toFixed(4);
function patternSVG(p, id){
  const d = findPat(p.pattern); if (!d) return '';
  if (_depth > 4) return '';
  const per = period(d), xf = Array.isArray(p.xf) && p.xf.length === 6 ? p.xf : I6;
  let body = '';
  _depth++;
  try {
    for (const o of offsetsCovering(d, {x0:0, y0:0, x1:per[0], y1:per[1]})){
      body += `<g transform="translate(${f4(o[0] - d.tile.x0)} ${f4(o[1] - d.tile.y0)})">` + d.art.map(a => {
        const c = R3.clone(a); R3.walk([c], n => { n.id = id + '_' + n.id; });            // 图案里的 defs id 不撞
        return ObjRender.toSVG(c);
      }).join('') + '</g>';
    }
  } finally { _depth--; }
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f4(per[0])}" height="${f4(per[1])}" patternTransform="matrix(${xf.map(f4).join(' ')})">${body}</pattern>`;
}
(function hookPaint(){
  const GF = window.GradientFill; if (!GF || GF.__r3pattern) return;
  GF.__r3pattern = true;
  const prevC = GF.toCanvas, prevS = GF.toSVG;
  GF.toCanvas = function(ctx, shape, scale, which){
    const p = (which && typeof which === 'object') ? which : shape && shape[which === 'stroke' ? 'stroke' : 'fill'];
    if (isPat(p)) return patternStyle(ctx, p, isFinite(scale) ? scale : 1);
    return prevC.apply(this, arguments);
  };
  GF.toSVG = function(p, id){ if (isPat(p)) return patternSVG(p, id); return prevS.apply(this, arguments); };
})();

/* ═════ 图案编辑模式的画面（render/src/pattern.rs:187-221 draw_pattern_edit） ═════ */
(function hookEditView(){
  if (window.__r3patternView) return; window.__r3patternView = true;
  const c0 = window.composite, rl0 = window.renderLayer;
  /* 只画编辑层：其它层画的时候暂时当看不见 */
  window.composite = function(scale, target){
    const L = editLayer(); if (!L) return c0.apply(this, arguments);
    const hidden = Doc.layers.filter(x => x !== L && x.visible);
    hidden.forEach(x => { x.visible = false; });
    try { return c0.apply(this, arguments); } finally { hidden.forEach(x => { x.visible = true; }); }
  };
  /* 编辑层：先画变暗的副本（整组一个不透明度），再画拼贴图稿本身 */
  window.renderLayer = function(L, scale){
    const pe = editing();
    if (!pe || !L || L.id !== pe.layerId || L.kind !== 'vector') return rl0.apply(this, arguments);
    if (L._cache && L._cacheScale === scale && L._r3patKey === patKey(pe)) return L._cache;
    const d = findPat(pe.pattern);
    const W = Math.max(1, Math.round(Doc.width * scale)), H = Math.max(1, Math.round(Doc.height * scale));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    if (d && L.data.shapes.length){
      const g = document.createElement('canvas'); g.width = W; g.height = H;
      const gx = g.getContext('2d');
      for (const o of previewOffsets(d)){ gx.setTransform(1, 0, 0, 1, (L.x + o[0]) * scale, (L.y + o[1]) * scale); L.data.shapes.forEach(s => window.drawShape(gx, s, scale)); }
      x.globalAlpha = Math.min(Math.max(d.dimCopies / 100, 0), 1); x.drawImage(g, 0, 0); x.globalAlpha = 1;
    }
    x.translate(L.x * scale, L.y * scale);
    L.data.shapes.forEach(s => window.drawShape(x, s, scale));
    L._cache = c; L._cacheScale = scale; L._r3patKey = patKey(pe);
    return c;
  };
  const patKey = pe => { const d = findPat(pe.pattern); return d ? JSON.stringify([d.tile, d.tileType, d.copies, d.dimCopies]) : ''; };
})();
/* 拼贴边缘（细线）与色板边界（虚线），颜色＝偏好 patternTileEdgeColor；顺手同步编辑模式的「完成／取消／存储副本」条 */
/* 偏好 patternTileEdgeColor：有 AiEdit.prefs（menus/impl/ai-edit.js 首选项）就用它；那档没载入时读写同一个 localStorage 键 dlcanvas.ai.prefs（它载入后照样读得到） */
const PREF_KEY = 'dlcanvas.ai.prefs', EDGE_DEFAULT = '#4f80ff';             // LAYER_COLORS[0] 淡蓝色
function lsPrefs(){ try { const o = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e){ return {}; } }
function edgeColor(){
  const v = window.AiEdit && AiEdit.prefs ? AiEdit.prefs.get('patternTileEdgeColor') : lsPrefs().patternTileEdgeColor;
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : EDGE_DEFAULT;
}
function setEdgeColor(hex){
  if (CMD.map['ai.prefs.set']) return CMD.run('ai.prefs.set', {key:'patternTileEdgeColor', value:hex});
  const o = lsPrefs(); o.patternTileEdgeColor = hex;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); } catch (e){ return {ok:false, error:String(e)}; }
  return {ok:true};
}
R3.patternEdgeColor = edgeColor;
function drawEdges(ctx, s){
  syncBar();
  const pe = editing(); if (!pe) return;
  const L = Doc.byId(pe.layerId), d = findPat(pe.pattern); if (!d || !L) return;
  const col = edgeColor(), rect = (r, dash) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.strokeRect(Math.round((r.x0 + L.x) * s) + .5, Math.round((r.y0 + L.y) * s) + .5, Math.round((r.x1 - r.x0) * s), Math.round((r.y1 - r.y0) * s)); ctx.restore(); };
  if (d.showTileEdge) rect(d.tile, []);
  if (d.showSwatchBounds) rect(swatchBounds(d), [4, 3]);
}
/* 晚挂：impl 档比 ui.js 先载入（那时还没有 UI）。拼贴边缘要画在 UI.overlays（选取框、工具叠画之后，不被盖住），Project.load 要包在 ai-view 那层外面 */
function hookLate(){
  if (window.UI && Array.isArray(UI.overlays) && !UI.overlays.includes(drawEdges)) UI.overlays.push(drawEdges);
  hookProjectLoad();
}
if (window.UI && Array.isArray(UI.overlays)) hookLate();
else window.addEventListener('DOMContentLoaded', () => setTimeout(hookLate, 0));
/* 编辑模式条（Illustrator 文件窗顶上那条：图案名＋完成／取消／存储副本） */
function syncBar(){
  const pe = editing();
  let bar = document.getElementById('aiR3PatternBar');
  if (!pe){ if (bar) bar.style.display = 'none'; return; }
  if (!bar){
    bar = document.createElement('div'); bar.id = 'aiR3PatternBar';
    bar.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:900;background:#2b2f36;color:#e6e8eb;border:1px solid #444a54;border-radius:4px;padding:4px 8px;font:12px sans-serif;display:flex;gap:8px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    bar.innerHTML = '<span data-k="name"></span><button data-act="done"></button><button data-act="saveCopy"></button><button data-act="cancel"></button>';
    bar.querySelectorAll('button').forEach(b => { b.style.cssText = 'background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:2px 10px;cursor:pointer;font:12px sans-serif'; b.onclick = () => { CMD.run('ai.object.pattern.' + b.dataset.act, {}); if (window.UI) UI.draw(); }; });
    document.body.appendChild(bar);
  }
  bar.style.display = 'flex';
  bar.querySelector('[data-k=name]').textContent = T('ai3pat.editing') + '：' + pe.pattern;
  bar.querySelector('[data-act=done]').textContent = T('ai3pat.done');
  bar.querySelector('[data-act=saveCopy]').textContent = T('ai3pat.saveCopy');
  bar.querySelector('[data-act=cancel]').textContent = T('ai3pat.cancel');
}

/* ═════ 拼贴边缘颜色…（dialogs/tile_edge_color.rs） ═════ */
const LAYER_COLORS = [['Light Blue', '#4f80ff'], ['Red', '#ff4f4f'], ['Green', '#4fff4f'], ['Blue', '#4f4fff'], ['Yellow', '#ffff4f'], ['Magenta', '#ff4fff'], ['Cyan', '#4fffff'],
  ['Gray', '#808080'], ['Black', '#000000'], ['Orange', '#ff6600'], ['Dark Green', '#008000'], ['Teal', '#008080'], ['Tan', '#cc9966'], ['Brown', '#993300'], ['Violet', '#9933ff'],
  ['Gold', '#ff9900'], ['Dark Blue', '#000080'], ['Pink', '#ff99cc'], ['Lavender', '#9999ff'], ['Brick Red', '#990000'], ['Olive Green', '#666600'], ['Peach', '#ff9999'],
  ['Burgundy', '#990033'], ['Grass Green', '#99cc00'], ['Ochre', '#996600'], ['Purple', '#660099'], ['Light Gray', '#bbbbbb']];
/* resolve：预设名（不分大小写）或 #rrggbb／rrggbb */
function resolveColor(c){
  const s = String(c === undefined || c === null ? '' : c).trim();
  const pr = LAYER_COLORS.find(x => x[0].toLowerCase() === s.toLowerCase()); if (pr) return pr[1];
  const m = s.match(/^#?([0-9a-f]{6})$/i); if (m) return '#' + m[1].toLowerCase();
  const m3 = s.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i); if (m3) return ('#' + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3]).toLowerCase();
  return null;
}
const presetKey = n => 'ai3pat.c.' + n.replace(/ /g, '');
reg('ai.ui.tileEdgeColor', {params:'{color: "#rrggbb" 或预设名（"Light Blue"、"Red"…图层颜色 27 色）} 对象 ▸ 图案 ▸ 拼贴边缘颜色 的确定（tile_edge_color.rs:59-63）：设偏好 patternTileEdgeColor（图案编辑模式的拼贴边缘与色板边界颜色；不进历史）→ {ok, color}'}, p => {
  const C = 'ai.ui.tileEdgeColor';
  const hex = resolveColor(p.color); if (!hex) return err(C, `\`${p.color}\` is not a colour (#rrggbb or a preset name)`);
  const r = setEdgeColor(hex);
  if (r && r.ok === false) return r;
  if (window.UI) UI.draw();
  return {ok:true, color:hex};
});
reg('ai.ui.tileEdgeColor.dialog', {params:'{} 开「拼贴边缘颜色」对话框（颜色：图层颜色预设下拉＋自定颜色；确定＝ai.ui.tileEdgeColor）→ {ok, dialog}'}, () => {
  const cur = edgeColor(), pre = LAYER_COLORS.find(x => x[1] === cur.toLowerCase());
  const bg = R3.form('tileEdgeColor', 'ai3pat.tileEdgeTitle', [
    {key:'preset', label:'ai3pat.color', type:'select', value:pre ? pre[0] : 'Custom', options:LAYER_COLORS.map(x => [x[0], presetKey(x[0])]).concat([['Custom', 'ai3pat.custom']])},
    {key:'color', label:'ai3pat.custom', type:'color', value:cur}
  ], v => CMD.run('ai.ui.tileEdgeColor', {color:v.color}));
  // 下拉选预设＝颜色跟着换；颜色改了＝下拉跳到对应的预设（没有就「自定」）
  const sel = bg.querySelector('select[name=preset]'), inp = bg.querySelector('input[name=color]');
  sel.addEventListener('change', () => { const x = LAYER_COLORS.find(c => c[0] === sel.value); if (x) inp.value = x[1]; });
  inp.addEventListener('input', () => { const x = LAYER_COLORS.find(c => c[1] === inp.value.toLowerCase()); sel.value = x ? x[0] : 'Custom'; });
  return {ok:true, dialog:'tileEdgeColor'};
});

/* ═════ 三语 ═════ */
const CN = {
  'Light Blue':['淺藍色', '淡蓝色'], 'Red':['紅色', '红色'], 'Green':['綠色', '绿色'], 'Blue':['藍色', '蓝色'], 'Yellow':['黃色', '黄色'], 'Magenta':['洋紅色', '洋红色'], 'Cyan':['青色', '青色'],
  'Gray':['灰色', '灰色'], 'Black':['黑色', '黑色'], 'Orange':['橙色', '橙色'], 'Dark Green':['深綠色', '深绿色'], 'Teal':['藍綠色', '青绿色'], 'Tan':['棕褐色', '棕褐色'], 'Brown':['褐色', '褐色'],
  'Violet':['紫羅蘭色', '紫罗兰色'], 'Gold':['金色', '金色'], 'Dark Blue':['深藍色', '深蓝色'], 'Pink':['粉紅色', '粉红色'], 'Lavender':['淡紫色', '淡紫色'], 'Brick Red':['磚紅色', '砖红色'],
  'Olive Green':['橄欖綠色', '橄榄绿色'], 'Peach':['桃紅色', '桃红色'], 'Burgundy':['酒紅色', '紫红色'], 'Grass Green':['草綠色', '草绿色'], 'Ochre':['土黃色', '赭色'], 'Purple':['紫色', '紫色'], 'Light Gray':['淺灰色', '淡灰色']};
const colorStr = k => Object.fromEntries(LAYER_COLORS.map(x => [presetKey(x[0]), k < 2 ? CN[x[0]][k] : x[0]]));
Lang.add({
  'zh-Hant':Object.assign({'ai3pat.tileEdgeTitle':'拼貼邊緣色彩', 'ai3pat.color':'顏色', 'ai3pat.custom':'自訂', 'ai3pat.editLayer':'圖樣編輯模式', 'ai3pat.editing':'圖樣編輯模式', 'ai3pat.done':'完成', 'ai3pat.cancel':'取消', 'ai3pat.saveCopy':'儲存拷貝'}, colorStr(0)),
  'zh-Hans':Object.assign({'ai3pat.tileEdgeTitle':'拼贴边缘颜色', 'ai3pat.color':'颜色', 'ai3pat.custom':'自定', 'ai3pat.editLayer':'图案编辑模式', 'ai3pat.editing':'图案编辑模式', 'ai3pat.done':'完成', 'ai3pat.cancel':'取消', 'ai3pat.saveCopy':'存储副本'}, colorStr(1)),
  en:Object.assign({'ai3pat.tileEdgeTitle':'Tile Edge Color', 'ai3pat.color':'Color', 'ai3pat.custom':'Custom', 'ai3pat.editLayer':'Pattern Editing Mode', 'ai3pat.editing':'Pattern Editing Mode', 'ai3pat.done':'Done', 'ai3pat.cancel':'Cancel', 'ai3pat.saveCopy':'Save a Copy'}, colorStr(2))
});
R3.pattern = {findPat, offsetsCovering, period, previewOffsets, tileOffset, tilePeriod, parseTile, editing};
})();


/*对象 ▸ 图像描摹（建立…／建立并扩展…／释放／扩展）、创建对象马赛克…、矢量半调…、裁剪图像：照 VectorCraft 原码
     trace/src/lib.rs 1-328        TraceParams（预设值、polygon_tolerance／fit_tolerance／corner_angle）、12 个预设、trace()（按面积排层、邻接／重叠、忽略白色、小洞丢掉）
     trace/src/quantize.rs 1-339   luma、黑白阈值、灰度一维 k-means、彩色 15 位直方图＋中位切分＋加权 k-means、compact、denoise（四连通小块并进最多的邻色）
     trace/src/contour.rs 1-185    四连通标号、像素裂缝边（里面在右手边）、鞍点右转、只留转折点、外圈顺时针／洞逆时针
     trace/src/fit.rs 1-156        dejag（阶梯中点）、Douglas–Peucker 多边形、simplify_with 拟合（用 AIObj.simplifyView＝pathops/src/edit.rs:47 的 JS 版）、snap_to_lines
     trace/src/mosaic.rs 1-35      每格平均色（按 alpha 加权）
     engine/src/cmd/buildcmds.rs:117-157, 625-751  imageTrace.make／makeAndExpand／release／expand／presets（trace_params：预设＋覆写、名称或 Custom）
     engine/src/cmd/menucmds.rs:102-120, 440-555  object.createObjectMosaic（格子矩形、间距按点换成像素、灰度、删除栅格）、object.cropImage（缺省裁到图像中心所在的画板、保持像素密度）
     engine/src/cmd/halftone.rs 1-331  object.vectorHalftone（网格按网屏角度转、每格 3×3 取样色调、点面积跟色调走、整颗在轮廓内不剪、跨边的跟轮廓求交；CMYK 四个网屏 正片叠底）
     ui-egui/src/dialogs/halftone.rs 1-56（栏位与预设）、ui-egui/src/panels/image_trace.rs 1-180（描摹面板的栏位）、ui-egui/src/menus.rs:1634-1642, 1757-1760, 2203-2212（菜单预设参数→参数对话框）
   我们的资料模型：
     · AI 的「影像」＝像素层。命令用 {image: 像素层 id} 指定；缺省＝现用层若是像素层就它，否则现用层下方最近的可见像素层。
     · 图像描摹物件＝矢量层里的编组 {type:'group', name:'Image Trace', trace:{preset, params, image:像素层 id}, children:[描摹出的路径…]}；
       原码把影像藏成编组第一个子物件，我们的影像是图层 ⇒ 来源像素层设成隐藏（visible:false）、编组记它的 id。释放＝层显示回来、编组删掉；扩展＝层删掉、编组变一般编组。
     · 描摹／马赛克／半调（对影像）的结果放进「影像上方紧邻的矢量层」最下面（原码插在影像正上方）；上方紧邻的不是矢量层就新开一个矢量层。
     · 马赛克半透明格子用 s.opacity、CMYK 半调网屏用 s.blend:'multiply'（跟 menus/impl/ai-window.js 透明度面板同一套栏位，渲染靠它的 drawShape 补丁）。
   没照抄的：半调 CMYK 分色原码走色彩管理（ICC 分色），我们用简单的 k=1−max(r,g,b) 分色；CMYK 油墨显示色用纯 #00ffff／#ff00ff／#ffff00／#000000；
     半调对话框的即时预览没做；描摹编组被移动后再「建立」重描，结果回到影像原位（原码影像在编组里跟着移动）。 */
(function(){
'use strict';
if (window.__aiR3_trace) return; window.__aiR3_trace = true;
const R3 = window.AiR3, {clone, num, bool, reg, done} = R3;
const AA = AIObj.A;
const err = (C, m) => ({ok:false, error:`${C}: ${m}`});
const T = k => (window.Lang ? Lang.t(k) : k);
const TRANSPARENT = 65535;
const hex2 = v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
const hex = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
const NO_PAINT = {fill:'none', stroke:'none', strokeWidth:0};
const TRACE_NAME = 'Image Trace';

/* ═════ 影像（像素层）与结果放哪 ═════ */
function imageLayer(p){
  const id = p.image !== undefined ? p.image : null;
  if (id !== null){ const L = Doc.byId(id); return (L && L.kind === 'raster') ? L : null; }
  const A = Doc.active(); if (A && A.kind === 'raster') return A;
  const i = A ? Doc.index(A.id) : Doc.layers.length;
  for (let k = i - 1; k >= 0; k--){ const L = Doc.layers[k]; if (L.kind === 'raster' && L.visible) return L; }
  return null;
}
const imgBounds = R => ({x0:R.x, y0:R.y, x1:R.x + R.data.canvas.width, y1:R.y + R.data.canvas.height});   // node.geometric_bounds（影像的框）
/* 影像正上方：上面紧邻的是矢量层＝放它最下面，否则新开一个矢量层 */
function destAbove(R, name){
  const i = Doc.index(R.id), up = Doc.layers[i + 1];
  if (up && up.kind === 'vector') return up;
  const V = Layer.vector(name); Doc.layers.splice(i + 1, 0, V); return V;
}
/* 删一个像素层但不动现用层（Doc.remove 会改 activeId） */
function dropLayer(L){ const a = Doc.activeId; const i = Doc.index(L.id); if (i >= 0) Doc.layers.splice(i, 1); Doc.activeId = Doc.byId(a) ? a : (Doc.layers.length ? Doc.layers[Math.min(i, Doc.layers.length - 1)].id : null); }
const rasterOf = R => { const c = R.data.canvas; return {w:c.width, h:c.height, d:R.data.ctx.getImageData(0, 0, c.width, c.height).data}; };
/* 顶层物件（所有矢量层） */
function findTop(id){ for (const L of Doc.layers){ if (L.kind !== 'vector') continue; const i = L.data.shapes.findIndex(s => s.id === id); if (i >= 0) return {L, s:L.data.shapes[i], idx:i}; } return null; }

/* ═════════════ trace/src/lib.rs：参数与预设 ═════════════ */
const PRESET_NAMES = ['Default', 'High Fidelity Photo', 'Low Fidelity Photo', '3 Colors', '6 Colors', '16 Colors', 'Shades of Gray', 'Black and White Logo', 'Sketched Art', 'Silhouettes', 'Line Art', 'Technical Drawing'];
const DEF = () => ({mode:'blackAndWhite', threshold:128, colors:6, paths:50, corners:75, noise:25, method:'abutting', ignoreWhite:false, snapCurvesToLines:false});
function preset(name){
  const key = String(name).trim().replace(/^\[+/, '').replace(/\]+$/, '').toLowerCase();
  const d = DEF();
  const color = (colors, paths, corners, noise, method) => Object.assign(DEF(), {mode:'color', colors, paths, corners, noise, method});
  const bw = (threshold, paths, corners, noise, snap) => Object.assign(DEF(), {mode:'blackAndWhite', threshold, paths, corners, noise, ignoreWhite:true, snapCurvesToLines:snap});
  switch (key){
    case 'default': return d;
    case 'high fidelity photo': return color(64, 90, 25, 4, 'overlapping');
    case 'low fidelity photo': return color(20, 60, 50, 12, 'overlapping');
    case '3 colors': return color(3, 60, 60, 20, 'abutting');
    case '6 colors': return color(6, 65, 60, 16, 'abutting');
    case '16 colors': return color(16, 70, 55, 10, 'abutting');
    case 'shades of gray': return Object.assign(d, {mode:'grayscale', colors:8, paths:60, corners:50, noise:10, method:'overlapping'});
    case 'black and white logo': return bw(128, 95, 80, 8, true);
    case 'sketched art': return bw(150, 50, 50, 100, false);
    case 'silhouettes': return bw(200, 40, 60, 30, false);
    case 'line art': return bw(128, 80, 70, 10, false);
    case 'technical drawing': return bw(128, 95, 90, 4, true);
  }
  return null;
}
const MODE_ALIAS = {blackAndWhite:'blackAndWhite', bw:'blackAndWhite', blackWhite:'blackAndWhite', 'Black and White':'blackAndWhite', grayscale:'grayscale', gray:'grayscale', Grayscale:'grayscale', color:'color', Color:'color'};
/* buildcmds.rs:631 trace_params：预设＋params 覆写（serde 反序列化的型别检查照做） */
function traceParams(p, C){
  const name = typeof p.preset === 'string' ? p.preset : 'Default';
  const base = preset(name); if (!base) throw err(C, `unknown preset \`${name}\` (see imageTrace.presets)`);
  const over = p.params; if (over === undefined || over === null) return base;
  if (typeof over !== 'object' || Array.isArray(over)) throw err(C, 'params must be an object');
  const o = Object.assign(base, over), bad = m => { throw err(C, m); };
  if (!MODE_ALIAS[o.mode]) bad(`unknown variant \`${o.mode}\`, expected one of \`blackAndWhite\`, \`grayscale\`, \`color\``);
  o.mode = MODE_ALIAS[o.mode];
  if (o.method !== 'abutting' && o.method !== 'overlapping') bad(`unknown variant \`${o.method}\`, expected \`abutting\` or \`overlapping\``);
  const uint = (k, max) => { if (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > max) bad(`invalid value for ${k}: ${JSON.stringify(o[k])}`); };
  uint('threshold', 255); uint('colors', 4294967295); uint('noise', 4294967295);
  for (const k of ['paths', 'corners']) if (typeof o[k] !== 'number' || !isFinite(o[k])) bad(`invalid value for ${k}: ${JSON.stringify(o[k])}`);
  for (const k of ['ignoreWhite', 'snapCurvesToLines']) if (typeof o[k] !== 'boolean') bad(`invalid type for ${k}: expected a boolean`);
  const out = DEF(); for (const k of Object.keys(out)) out[k] = o[k];       // 只留 TraceParams 的栏位（serde 忽略多余的键）
  return out;
}
const clamp01 = v => Math.min(1, Math.max(0, v));
const polygonTol = P => 0.55 + 0.75 * (1 - clamp01(P.paths / 100));
const fitTol = P => 0.2 + 1.6 * (1 - clamp01(P.paths / 100));
const cornerAngle = P => 150 - 115 * clamp01(P.corners / 100);

/* ═════════════ trace/src/quantize.rs ═════════════ */
const luma = (r, g, b) => Math.floor((r * 299 + g * 587 + b * 114 + 500) / 1000);
function quantize(img, P){
  const {w, h, d} = img, n = w * h, labels = new Uint16Array(n);
  if (P.mode === 'blackAndWhite'){
    const t = P.threshold;
    for (let i = 0; i < n; i++){ const k = i * 4; labels[i] = d[k + 3] < 128 ? TRANSPARENT : (luma(d[k], d[k + 1], d[k + 2]) < t ? 1 : 0); }
    return {labels, palette:[[255, 255, 255], [0, 0, 0]]};
  }
  if (P.mode === 'grayscale'){
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++){ const k = i * 4; if (d[k + 3] >= 128) hist[luma(d[k], d[k + 1], d[k + 2])]++; }
    const levels = kmeans1d(hist, Math.min(256, Math.max(2, P.colors)));
    const lut = new Uint16Array(256); for (let v = 0; v < 256; v++) lut[v] = nearest1d(levels, v);
    for (let i = 0; i < n; i++){ const k = i * 4; labels[i] = d[k + 3] < 128 ? TRANSPARENT : lut[luma(d[k], d[k + 1], d[k + 2])]; }
    const palette = levels.map(l => { const g = Math.min(255, Math.max(0, Math.round(l))); return [g, g, g]; });
    return compact(labels, palette);
  }
  // 彩色：15 位直方图，每格存总和（精确的格平均）
  const bn = new Float64Array(1 << 15), bs = new Float64Array(3 << 15);
  const key = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  for (let i = 0; i < n; i++){ const k = i * 4; if (d[k + 3] >= 128){ const b = key(d[k], d[k + 1], d[k + 2]); bn[b]++; bs[b * 3] += d[k]; bs[b * 3 + 1] += d[k + 1]; bs[b * 3 + 2] += d[k + 2]; } }
  const used = [];
  for (let i = 0; i < (1 << 15); i++) if (bn[i] > 0){ const m = Math.max(1, bn[i]); used.push([i, [bs[i * 3] / m, bs[i * 3 + 1] / m, bs[i * 3 + 2] / m], bn[i]]); }
  const centers = kmeansRgb(used, Math.min(256, Math.max(2, P.colors)));
  const lut = new Uint16Array(1 << 15); for (const [i, c] of used) lut[i] = nearestRgb(centers, c);
  for (let i = 0; i < n; i++){ const k = i * 4; labels[i] = d[k + 3] < 128 ? TRANSPARENT : lut[key(d[k], d[k + 1], d[k + 2])]; }
  const palette = centers.map(c => [Math.min(255, Math.max(0, Math.round(c[0]))), Math.min(255, Math.max(0, Math.round(c[1]))), Math.min(255, Math.max(0, Math.round(c[2])))]);
  return compact(labels, palette);
}
/* 去掉没用到的色、合并重复的 */
function compact(labels, palette){
  const used = palette.map(() => false);
  for (let i = 0; i < labels.length; i++) if (labels[i] !== TRANSPARENT) used[labels[i]] = true;
  const remap = palette.map(() => 0), out = [];
  palette.forEach((c, i) => {
    if (!used[i]) return;
    const j = out.findIndex(o => o[0] === c[0] && o[1] === c[1] && o[2] === c[2]);
    if (j >= 0) remap[i] = j; else { out.push(c); remap[i] = out.length - 1; }
  });
  for (let i = 0; i < labels.length; i++) if (labels[i] !== TRANSPARENT) labels[i] = remap[labels[i]];
  return {labels, palette:out};
}
function nearest1d(levels, v){ let bd = Infinity, bi = 0; levels.forEach((l, i) => { const dd = Math.abs(l - v); if (dd < bd){ bd = dd; bi = i; } }); return bi; }
/* 一维 k-means（Lloyd，起点均匀分布） */
function kmeans1d(hist, k){
  let lo = 0, hi = 255;
  { let f = -1, l = -1; for (let v = 0; v < 256; v++) if (hist[v] > 0){ if (f < 0) f = v; l = v; } lo = f < 0 ? 0 : f; hi = l < 0 ? 255 : l; }
  const levels = []; for (let i = 0; i < k; i++) levels.push(k === 1 ? lo : lo + (hi - lo) * i / (k - 1));
  for (let it = 0; it < 20; it++){
    const sum = new Array(k).fill(0), cnt = new Array(k).fill(0);
    for (let v = 0; v < 256; v++) if (hist[v] > 0){ const j = nearest1d(levels, v); sum[j] += v * hist[v]; cnt[j] += hist[v]; }
    let moved = false;
    for (let j = 0; j < k; j++) if (cnt[j] > 0){ const m = sum[j] / cnt[j]; moved = moved || Math.abs(m - levels[j]) > 0.01; levels[j] = m; }
    if (!moved) break;
  }
  return levels;
}
const dist2 = (a, b) => { const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return 2 * dr * dr + 4 * dg * dg + 3 * db * db; };   // 略带感知权重
function nearestRgb(cs, c){ let bd = Infinity, bi = 0; cs.forEach((m, i) => { const dd = dist2(m, c); if (dd < bd){ bd = dd; bi = i; } }); return bi; }
/* 中位切分定初始色盘，再对直方图格子做加权 k-means */
function kmeansRgb(used, k){
  if (!used.length) return [[255, 255, 255]];
  const boxes = [used.map((_, i) => i)];
  while (boxes.length < k){
    let best = null;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let wsum = 0;
      for (const i of b){ for (let ch = 0; ch < 3; ch++){ lo[ch] = Math.min(lo[ch], used[i][1][ch]); hi[ch] = Math.max(hi[ch], used[i][1][ch]); } wsum += used[i][2]; }
      let ch = 0, range = -1; for (let c = 0; c < 3; c++) if (hi[c] - lo[c] > range){ ch = c; range = hi[c] - lo[c]; }
      if (range <= 0) return;
      const score = range * Math.sqrt(wsum);
      if (!best || score > best[0]) best = [score, bi, ch];
    });
    if (!best) break;
    const [, bi, ch] = best;
    const b = boxes[bi]; boxes[bi] = boxes[boxes.length - 1]; boxes.pop();      // Vec::swap_remove
    b.sort((x, y) => used[x][1][ch] - used[y][1][ch]);
    const total = b.reduce((a, i) => a + used[i][2], 0);
    let acc = 0, cut = 1;
    for (let j = 0; j < b.length; j++){ acc += used[b[j]][2]; if (acc >= total / 2){ cut = Math.min(Math.max(j + 1, 1), b.length - 1); break; } }
    const tail = b.splice(cut);
    boxes.push(b); boxes.push(tail);
  }
  const centers = boxes.map(b => { const s = [0, 0, 0]; let w = 0; for (const i of b){ for (let c = 0; c < 3; c++) s[c] += used[i][1][c] * used[i][2]; w += used[i][2]; } return [s[0] / w, s[1] / w, s[2] / w]; });
  for (let it = 0; it < 12; it++){
    const sum = centers.map(() => [0, 0, 0]), cnt = centers.map(() => 0);
    for (const [, c, n] of used){ const j = nearestRgb(centers, c); for (let ch = 0; ch < 3; ch++) sum[j][ch] += c[ch] * n; cnt[j] += n; }
    let moved = 0;
    for (let j = 0; j < centers.length; j++) if (cnt[j] > 0){ const m = [sum[j][0] / cnt[j], sum[j][1] / cnt[j], sum[j][2] / cnt[j]]; moved = Math.max(moved, dist2(m, centers[j])); centers[j] = m; }
    if (moved < 0.25) break;
  }
  return centers;
}
/* 四连通、同色、小于 minArea 像素的块并进它最多的邻色（透明不动） */
function denoise(labels, w, h, minArea){
  if (minArea <= 1 || !w || !h) return;
  const seen = new Uint8Array(w * h), stack = [], comp = [], neigh = [];
  for (let start = 0; start < w * h; start++){
    if (seen[start] || labels[start] === TRANSPARENT) continue;
    const l = labels[start];
    comp.length = 0; neigh.length = 0;
    stack.push(start); seen[start] = 1;
    let small = true;
    while (stack.length){
      const i = stack.pop();
      if (small){ comp.push(i); if (comp.length >= minArea) small = false; }
      const x = i % w, y = (i / w) | 0;
      const visit = j => {
        const lj = labels[j];
        if (lj === l){ if (!seen[j]){ seen[j] = 1; stack.push(j); } }
        else if (lj !== TRANSPARENT){ const e = neigh.find(q => q[0] === lj); if (e) e[1]++; else neigh.push([lj, 1]); }
      };
      if (x > 0) visit(i - 1);
      if (x + 1 < w) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y + 1 < h) visit(i + w);
    }
    if (small && neigh.length){
      // max_by_key((count, MAX − label))：数量最多、平手取编号小的
      let to = neigh[0]; for (const q of neigh) if (q[1] > to[1] || (q[1] === to[1] && q[0] < to[0])) to = q;
      for (const i of comp) labels[i] = to[0];
    }
  }
}

/* ═════════════ trace/src/contour.rs ═════════════ */
const DR = 1, DD = 2, DL = 4, DU = 8;
const rightOf = d => d === DR ? DD : d === DD ? DL : d === DL ? DU : DR;
const stepOf = d => d === DR ? [1, 0] : d === DD ? [0, 1] : d === DL ? [-1, 0] : [0, -1];
const pop = v => ((v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1));
function labelComps(mask, w, h){
  const comp = new Int32Array(w * h).fill(-1), sizes = [], stack = [];
  for (let s = 0; s < w * h; s++){
    if (!mask[s] || comp[s] !== -1) continue;
    const id = sizes.length; let n = 0;
    comp[s] = id; stack.push(s);
    while (stack.length){
      const i = stack.pop(); n++;
      const x = i % w, y = (i / w) | 0;
      const go = j => { if (mask[j] && comp[j] === -1){ comp[j] = id; stack.push(j); } };
      if (x > 0) go(i - 1);
      if (x + 1 < w) go(i + 1);
      if (y > 0) go(i - w);
      if (y + 1 < h) go(i + w);
    }
    sizes.push(n);
  }
  return {comp, sizes};
}
function traceMask(mask, w, h){
  const {comp, sizes} = labelComps(mask, w, h);
  const vw = w + 1, dirs = new Uint8Array(vw * (h + 1));
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    if (!mask[y * w + x]) continue;
    if (!inside(x, y - 1)) dirs[y * vw + x] |= DR;
    if (!inside(x + 1, y)) dirs[y * vw + x + 1] |= DD;
    if (!inside(x, y + 1)) dirs[(y + 1) * vw + x + 1] |= DL;
    if (!inside(x - 1, y)) dirs[(y + 1) * vw + x] |= DU;
  }
  const outers = sizes.map(() => null), holes = sizes.map(() => []);
  for (let start = 0; start < dirs.length; start++){
    // 每个环都有一条 R 边（某个里面像素的上边）：从那里起步，环才会刚好闭合
    while (dirs[start] & DR){
      const sx = start % vw, sy = (start / vw) | 0;
      const owner = comp[sy * w + sx];
      dirs[start] &= ~DR;
      const pts = [[sx, sy]];
      let x = sx + 1, y = sy, d = DR, area2 = 0, prev = [sx, sy];
      for (;;){
        area2 += prev[0] * y - x * prev[1];
        prev = [x, y];
        const v = y * vw + x, atStart = x === sx && y === sy;
        let cand = dirs[v]; if (atStart) cand |= DR;
        const next = pop(cand) === 1 ? cand : (cand & rightOf(d)) ? rightOf(d) : (cand & d) ? d : rightOf(rightOf(rightOf(d)));
        if (atStart && next === DR) break;
        if (next === 0 || !(dirs[v] & next)) break;       // 不正常（合法的遮罩不会发生）：安全停下
        dirs[v] &= ~next;
        if (next !== d) pts.push([x, y]);                  // 只留转折点
        const [dx, dy] = stepOf(next); x += dx; y += dy; d = next;
      }
      if (owner < 0) continue;
      const l = {pts, area2};
      if (area2 > 0) outers[owner] = l; else holes[owner].push(l);
    }
  }
  const out = [];
  outers.forEach((o, i) => { if (o) out.push({outer:o, holes:holes[i], pixels:sizes[i]}); });
  return out;
}

/* ═════════════ trace/src/fit.rs ═════════════ */
function segDist(p, a, b){
  const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (l2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t));
}
function rdpMark(pts, a, b, tol, keep){
  const st = [[a, b]];
  while (st.length){
    const [a, b] = st.pop();
    if (b <= a + 1) continue;
    const pa = pts[a], pb = pts[b % pts.length];
    let bd = 0, bi = a;
    for (let i = a + 1; i < b; i++){ const dd = segDist(pts[i], pa, pb); if (dd > bd){ bd = dd; bi = i; } }
    if (bd > tol){ keep[bi] = true; st.push([a, bi]); st.push([bi, b]); }
  }
}
/* 像素阶梯的小台阶换成它的中点 */
function dejag(v){
  const n = v.length;
  const edge = i => { const a = v[i % n], b = v[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
  const turn = i => { const a = edge((i + n - 1) % n), b = edge(i); return Math.sign(a[0] * b[1] - a[1] * b[0]); };
  const jog = []; for (let i = 0; i < n; i++){ const e = edge(i); jog.push(Math.abs(e[0]) + Math.abs(e[1]) === 1 && turn(i) * turn(i + 1) < 0); }
  const out = [];
  for (let i = 0; i < n; i++){
    if (!jog[i] && !jog[(i + n - 1) % n]) out.push([v[i][0], v[i][1]]);
    if (jog[i]){ const a = v[i], b = v[(i + 1) % n]; out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  }
  return out;
}
function polygon(loopPts, tol){
  const raw = loopPts.map(p => [p[0], p[1]]);
  if (raw.length < 4) return raw;
  let pts = dejag(loopPts); if (pts.length < 3) pts = raw.slice();
  const n = pts.length; if (n < 4) return pts;
  // 在 0 号点与离它最远的点把闭合环切两半（max_by 平手取最后一个）
  let far = n >> 1, fd = -Infinity;
  for (let i = 1; i < n; i++){ const dd = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (dd >= fd){ fd = dd; far = i; } }
  const ext = pts.concat([pts[0]]), keep = new Array(n + 1).fill(false);
  keep[0] = true; keep[far] = true;
  rdpMark(ext, 0, far, tol, keep); rdpMark(ext, far, n, tol, keep);
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  if (out.length > 3 && segDist(out[0], out[out.length - 1], out[1]) <= tol * 0.5) out.shift();   // 0 号点是硬留的，用不着就拿掉
  return out.length < 3 ? raw : out;
}
const hasOut = a => !!a.out, hasIn = a => !!a.in;
/* 贴近弦的曲线把手收回（变直线） */
function snapToLines(sp, tol){
  const A = sp.anchors, n = A.length, segN = sp.closed ? n : n - 1;
  for (let i = 0; i < segN; i++){
    const j = (i + 1) % n, a = A[i], b = A[j];
    if (!hasOut(a) && !hasIn(b)) continue;
    const p0 = [a.x, a.y], p3 = [b.x, b.y], c = {p0, c1:a.out || p0, c2:b.in || p3, p3};
    let all = true; for (let k = 1; k < 8; k++) if (segDist(VecSel.evalCubic(c, k / 8), p0, p3) > tol){ all = false; break; }
    if (all){ A[i].out = null; A[j].in = null; }
  }
}
function fitLoop(l, o){
  const poly = polygon(l.pts, o.polygonTol);
  if (poly.length < 3) return null;
  const v = {anchors:poly.map(p => ({x:p[0], y:p[1], in:null, out:null})), closed:true};     // SubPath::polyline
  const sp = AIObj.simplifyView(v, {tolerance:o.fitTol, cornerAngle:o.cornerAngle, straightLines:false});
  if (!sp || sp.anchors.length < 2) return null;
  if (o.snapLines) snapToLines(sp, Math.max(o.fitTol * 2, 1.5));
  return sp;
}
const isWhite = c => c.every(v => v >= 245);
/* lib.rs:264 trace：结果由下到上 [{subs:[{anchors, closed}], color:[r,g,b], pixels}] */
function trace(img, P){
  const {w, h} = img, out = {paths:[], palette:[]};
  if (!w || !h) return out;
  const q = quantize(img, P);
  denoise(q.labels, w, h, P.noise);
  const counts = q.palette.map(() => 0);
  for (let i = 0; i < q.labels.length; i++) if (q.labels[i] !== TRANSPARENT) counts[q.labels[i]]++;
  const order = q.palette.map((_, i) => i).filter(i => counts[i] > 0).sort((a, b) => (counts[b] - counts[a]) || (a - b));   // 面积大的在下
  const rank = q.palette.map(() => Infinity); order.forEach((i, r) => { rank[i] = r; });
  const o = {polygonTol:polygonTol(P), fitTol:fitTol(P), cornerAngle:cornerAngle(P), snapLines:P.snapCurvesToLines};
  const minHole = Math.max(1, P.noise), overlapping = P.method === 'overlapping';
  const mask = new Uint8Array(w * h);
  order.forEach((ci, r) => {
    const color = q.palette[ci];
    if (P.ignoreWhite && isWhite(color)) return;
    for (let i = 0; i < mask.length; i++){ const l = q.labels[i]; mask[i] = (l !== TRANSPARENT && (overlapping ? rank[l] >= r : l === ci)) ? 1 : 0; }
    for (const comp of traceMask(mask, w, h)){
      const first = fitLoop(comp.outer, o); if (!first) continue;
      const subs = [first];
      for (const hole of comp.holes){
        if (Math.trunc(Math.abs(hole.area2) / 2) < minHole && P.noise > 0) continue;
        const sp = fitLoop(hole, o); if (sp) subs.push(sp);
      }
      out.paths.push({subs, color, pixels:comp.pixels});
    }
    if (!out.palette.some(c => c[0] === color[0] && c[1] === color[1] && c[2] === color[2])) out.palette.push(color);
  });
  return out;
}
const anchorCount = res => res.paths.reduce((a, p) => a + p.subs.reduce((b, s) => b + s.anchors.length, 0), 0);
/* 一个 PathData（多条子路径）→ 我们的形状：一条＝bezier，多条＝复合路径（nonzero） */
function pathShape(subs, style){
  const mk = (v, st) => Object.assign({id:R3.newId(), type:'bezier', anchors:v.anchors, closed:!!v.closed}, st);
  if (subs.length === 1) return mk(subs[0], style);
  return Object.assign({id:R3.newId(), type:'compound', rule:'nonzero', children:subs.map(v => mk(v, NO_PAINT))}, style);
}
const moveSub = (v, dx, dy) => { v.anchors.forEach(a => { a.x += dx; a.y += dy; if (a.in) a.in = [a.in[0] + dx, a.in[1] + dy]; if (a.out) a.out = [a.out[0] + dx, a.out[1] + dy]; }); return v; };
const isTraceGroup = s => !!s && s.type === 'group' && s.name === TRACE_NAME && !!s.trace && Array.isArray(s.children);
function traceRefs(layerId, except){ let n = 0; for (const L of Doc.layers) if (L.kind === 'vector') R3.walk(L.data.shapes, s => { if (s !== except && isTraceGroup(s) && s.trace.image === layerId) n++; }); return n; }

/* ═════════════ buildcmds.rs:644 trace_make ═════════════ */
/* 目标：{id}（描摹物件或像素层 id）→ 选取里的描摹物件 → 影像（{image} 或缺省那层） */
function traceTarget(p, C){
  if (p.id !== undefined && p.id !== null){
    const t = findTop(p.id); if (t && isTraceGroup(t.s)) return {group:t};
    const L = Doc.byId(p.id); if (L && L.kind === 'raster') return {image:L};
    throw err(C, 'select an image (or an Image Trace group)');
  }
  if (p.image === undefined){
    const V = R3.vLayer(p);
    if (V){ const g = R3.roots(V, Array.isArray(p.ids) ? p.ids : null).find(isTraceGroup); if (g) return {group:{L:V, s:g, idx:V.data.shapes.indexOf(g)}}; }
  }
  const R = imageLayer(p); if (R) return {image:R};
  throw err(C, 'select an image (or an Image Trace group)');
}
function traceMake(p, expand){
  const C = 'ai.imageTrace.make';
  try {
    const P = traceParams(p, C);
    const named = typeof p.preset === 'string' ? p.preset : 'Default', b = preset(named);
    const label = (b && JSON.stringify(b) === JSON.stringify(P)) ? named : 'Custom';
    const tg = traceTarget(p, C);
    let R, V, at;
    if (tg.group){ R = Doc.byId(tg.group.s.trace.image); if (!R || R.kind !== 'raster') return err(C, 'Image Trace: the traced image is missing'); V = tg.group.L; at = tg.group.idx; }
    else R = tg.image;
    const res = trace(rasterOf(R), P);
    if (!V){ V = destAbove(R, T('ai3t.traceLayer')); at = 0; }
    const dx = R.x - V.x, dy = R.y - V.y;
    const children = res.paths.map(tp => pathShape(tp.subs.map(v => moveSub(v, dx, dy)), {fill:hex(tp.color), stroke:'none', strokeWidth:0}));
    const g = {id:R3.newId(), type:'group', children};
    if (!expand){ g.name = TRACE_NAME; g.trace = {preset:label, params:P, image:R.id}; }
    if (tg.group) V.data.shapes.splice(at, 1, g); else V.data.shapes.splice(at, 0, g);
    if (expand){ if (!traceRefs(R.id, null)) dropLayer(R); }
    else R.visible = false;                                    // 影像藏起来（原码：编组第一个子物件 visible=false）
    Layer.invalidate(V); Layer.invalidate(R);
    Doc.activeId = V.id; R3.selectIds(V, [g.id]);
    return {ok:true, id:g.id, layerId:V.id, paths:res.paths.length, anchors:anchorCount(res), colors:res.palette.length};
  } catch (e){ if (e && e.ok === false) return e; throw e; }
}
const TRACE_P = '{id?: 描摹物件 id 或像素层 id（缺省：选中的描摹物件；否则 image）, image?: 像素层 id（缺省：现用层是像素层就它，否则现用层下方最近的可见像素层）, preset?: 预设名（ai.imageTrace.presets；缺省 Default）, params?: {mode: "blackAndWhite"|"grayscale"|"color", threshold: 0-255, colors: 2-256, paths: 0-100, corners: 0-100, noise: 像素, method: "abutting"|"overlapping", ignoreWhite, snapCurvesToLines}（覆写预设）}';
reg('ai.imageTrace.make', {undoable:true, params:TRACE_P + ' 对象 ▸ 图像描摹 ▸ 建立：描摹影像（量化→去杂色→跟边界→多边形→贝兹拟合）成描摹物件（矢量层里的编组 Image Trace，记着预设与参数；来源像素层藏起来）；对描摹物件再跑＝用新参数重描 → {ok, id, layerId, paths, anchors, colors}'}, p => traceMake(p, false));
reg('ai.imageTrace.makeAndExpand', {undoable:true, params:'同 ai.imageTrace.make，然后扩展（只留描摹出的路径，来源像素层删掉）→ {ok, id, layerId, paths, anchors, colors}'}, p => traceMake(p, true));
reg('ai.imageTrace.presets', {params:'{} 描摹预设 → {ok, presets:[{name, params}]}'}, () => ({ok:true, presets:PRESET_NAMES.map(n => ({name:n, params:preset(n)}))}));
/* buildcmds.rs:720 trace_targets */
function traceTargets(p, C){
  if (p.id !== undefined && p.id !== null){ const t = findTop(p.id); if (t && isTraceGroup(t.s)) return [t]; throw err(C, 'select an Image Trace object'); }
  const V = R3.vLayer(p); const R = V ? R3.roots(V, Array.isArray(p.ids) ? p.ids : null).filter(isTraceGroup) : [];
  if (!R.length) throw err(C, 'select an Image Trace object');
  return R.map(s => ({L:V, s, idx:V.data.shapes.indexOf(s)}));
}
reg('ai.imageTrace.release', {undoable:true, params:'{id?: 描摹物件 id（缺省：选中的）} 对象 ▸ 图像描摹 ▸ 释放：来源影像放回来（像素层显示）、描摹物件删掉 → {ok, ids:[像素层 id]}'}, p => {
  const C = 'ai.imageTrace.release';
  let tg; try { tg = traceTargets(p, C); } catch (e){ return e; }
  const out = [];
  for (const t of tg){
    const R = Doc.byId(t.s.trace.image); if (!R) return err(C, 'Image Trace: the traced image is missing');
    const i = t.L.data.shapes.indexOf(t.s); if (i >= 0) t.L.data.shapes.splice(i, 1);
    R.visible = true; Layer.invalidate(R); Layer.invalidate(t.L); out.push(R.id);
  }
  VecSel.clear();
  return {ok:true, ids:out};
});
reg('ai.imageTrace.expand', {undoable:true, params:'{id?: 描摹物件 id（缺省：选中的）} 对象 ▸ 图像描摹 ▸ 扩展：只留描摹出的路径（编组变一般编组；来源像素层删掉，别的描摹物件还用它就留着）→ {ok, ids}'}, p => {
  const C = 'ai.imageTrace.expand';
  let tg; try { tg = traceTargets(p, C); } catch (e){ return e; }
  for (const t of tg){
    const img = t.s.trace.image;
    delete t.s.name; delete t.s.trace;
    const R = Doc.byId(img); if (R && R.kind === 'raster' && !traceRefs(img, null)) dropLayer(R);
    Layer.invalidate(t.L);
  }
  R3.selectIds(tg[0].L, tg.map(t => t.s.id));
  return {ok:true, ids:tg.map(t => t.s.id)};
});

/* ── 建立…／建立并扩展… 对话框：menus.rs:1757-1758 菜单带预设（黑白徽标／6 色）→ 参数对话框；栏位照描摹面板 image_trace.rs ── */
function traceDialog(cmd, defPreset){
  return p => {
    const C = cmd + '.dialog';
    let tg; try { tg = traceTarget(p, C); } catch (e){ return e; }
    let name = defPreset, P = preset(defPreset);
    if (tg.group){ const st = tg.group.s.trace; P = Object.assign(DEF(), st.params); name = PRESET_NAMES.includes(st.preset) ? st.preset : 'Default'; }
    const kind = cmd === 'ai.imageTrace.make' ? 'imageTrace' : 'imageTraceExpand';
    const bg = R3.form(kind, cmd === 'ai.imageTrace.make' ? 'ai3t.make' : 'ai3t.makeAndExpand', [
      {key:'preset', label:'ai3t.preset', type:'select', value:name, options:PRESET_NAMES.map(n => [n, 'ai3t.p.' + n])},
      {key:'mode', label:'ai3t.mode', type:'select', value:P.mode, options:[['blackAndWhite', 'ai3t.bw'], ['grayscale', 'ai3t.gray'], ['color', 'ai3t.color']]},
      {key:'threshold', label:'ai3t.threshold', type:'number', value:P.threshold},
      {key:'colors', label:'ai3t.colors', type:'number', value:P.colors},
      {type:'head', label:'ai3t.advanced'},
      {key:'paths', label:'ai3t.paths', type:'number', value:P.paths},
      {key:'corners', label:'ai3t.corners', type:'number', value:P.corners},
      {key:'noise', label:'ai3t.noise', type:'number', value:P.noise},
      {key:'method', label:'ai3t.method', type:'radio', value:P.method, options:[['abutting', 'ai3t.abutting'], ['overlapping', 'ai3t.overlapping']]},
      {key:'snapCurvesToLines', label:'ai3t.snap', type:'check', value:P.snapCurvesToLines},
      {key:'ignoreWhite', label:'ai3t.ignoreWhite', type:'check', value:P.ignoreWhite}
    ], v => {
      const q = {preset:v.preset, params:{mode:v.mode, threshold:Math.min(255, Math.max(0, Math.round(v.threshold))), colors:Math.min(256, Math.max(2, Math.round(v.colors))),
        paths:Math.min(100, Math.max(0, v.paths)), corners:Math.min(100, Math.max(0, v.corners)), noise:Math.max(0, Math.round(v.noise)), method:v.method, ignoreWhite:!!v.ignoreWhite, snapCurvesToLines:!!v.snapCurvesToLines}};
      if (tg.group) q.id = tg.group.s.id; else q.image = tg.image.id;
      return CMD.run(cmd, q);
    });
    // 换预设＝其它栏位换成那个预设的值（面板 Preset 下拉的行为）
    const sel = bg.querySelector('select[name="preset"]');
    if (sel) sel.addEventListener('change', () => {
      const Q = preset(sel.value); if (!Q) return;
      for (const k of ['mode', 'threshold', 'colors', 'paths', 'corners', 'noise']){ const e = bg.querySelector(`[name="${k}"]`); if (e) e.value = Q[k]; }
      bg.querySelectorAll('input[name="method"]').forEach(r => { r.checked = r.value === Q.method; });
      for (const k of ['snapCurvesToLines', 'ignoreWhite']){ const e = bg.querySelector(`input[name="${k}"]`); if (e) e.checked = !!Q[k]; }
    });
    return {ok:true, dialog:kind};
  };
}
reg('ai.imageTrace.make.dialog', {params:'{id?, image?} 开「图像描摹 ▸ 建立」对话框（预设缺省「黑白徽标」；选中描摹物件＝带它存的设置；确定＝ai.imageTrace.make）→ {ok, dialog}'}, traceDialog('ai.imageTrace.make', 'Black and White Logo'));
reg('ai.imageTrace.makeAndExpand.dialog', {params:'{id?, image?} 开「图像描摹 ▸ 建立并扩展」对话框（预设缺省「6 色」；确定＝ai.imageTrace.makeAndExpand）→ {ok, dialog}'}, traceDialog('ai.imageTrace.makeAndExpand', '6 Colors'));

/* ═════════════ menucmds.rs:450 object_mosaic ＋ trace/src/mosaic.rs ═════════════ */
function mosaic(img, cols, rows){
  cols = Math.max(1, cols); rows = Math.max(1, rows);
  const {w, h, d} = img, out = [];
  for (let r = 0; r < rows; r++){
    const y0 = Math.floor(r * h / rows), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((r + 1) * h / rows)));
    for (let c = 0; c < cols; c++){
      const x0 = Math.floor(c * w / cols), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((c + 1) * w / cols)));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let y = y0; y < Math.min(h, Math.max(y1, y0 + 1)); y++) for (let x = x0; x < Math.min(w, Math.max(x1, x0 + 1)); x++){
        const k = (y * w + x) * 4, a = d[k + 3];
        sr += d[k] * a; sg += d[k + 1] * a; sb += d[k + 2] * a; sa += a; n++;
      }
      out.push(sa > 0 ? [Math.floor(sr / sa), Math.floor(sg / sa), Math.floor(sb / sa), Math.floor(sa / Math.max(1, n))] : [0, 0, 0, 0]);
    }
  }
  return out;
}
const uintOr = (v, d) => (Number.isInteger(v) && v >= 0) ? v : d;            // Value::as_u64
const f64Or = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;      // f64_or
reg('ai.object.createObjectMosaic', {undoable:true, params:'{image?: 像素层 id（缺省：现用层是像素层就它，否则现用层下方最近的可见像素层）, columns=10, rows=10（1–1000）, width?, height?（新尺寸，点；缺省＝影像的）, spacingX=0, spacingY=0（格间距，点）, gray?: bool, deleteRaster?: bool} 对象 ▸ 创建对象马赛克：影像按格子取平均色，变成一组矩形（编组 Object Mosaic，放在影像正上方；透明格不做、半透明格设不透明度）→ {ok, id, tiles}'}, p => {
  const C = 'ai.object.createObjectMosaic';
  const R = imageLayer(p); if (!R) return err(C, 'select an image');
  const cols = Math.min(1000, Math.max(1, uintOr(p.columns, 10))), rows = Math.min(1000, Math.max(1, uintOr(p.rows, 10)));
  const gray = bool(p.gray, false), img = rasterOf(R);
  const colors = mosaic(img, cols, rows);
  const b = imgBounds(R), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const nw = Math.max(0.1, f64Or(p.width, bw)), nh = Math.max(0.1, f64Or(p.height, bh));
  const resize = AA.mul(AA.translate(b.x0, b.y0), AA.mul(AA.scale(nw / Math.max(bw, 1e-9), nh / Math.max(bh, 1e-9)), AA.translate(-b.x0, -b.y0)));
  const xf = AA.mul(resize, AA.translate(R.x, R.y));                         // im.xf：像素 → 文件（一像素一点）
  const tw = img.w / cols, th = img.h / rows;
  const o0 = AA.apply(xf, [0, 0]), ppx = Math.max(1e-9, Math.hypot(...[0, 1].map(k => AA.apply(xf, [1, 0])[k] - o0[k]))), ppy = Math.max(1e-9, Math.hypot(...[0, 1].map(k => AA.apply(xf, [0, 1])[k] - o0[k])));
  const gx = Math.min(Math.max(0, f64Or(p.spacingX, 0)) / ppx, tw * 0.9), gy = Math.min(Math.max(0, f64Or(p.spacingY, 0)) / ppy, th * 0.9);
  const del = bool(p.deleteRaster, false);
  const V = destAbove(R, T('ai3t.mosaicLayer')), tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){
    const [cr, cg, cb, ca] = colors[r * cols + c]; if (ca === 0) continue;
    const x0 = c * tw + gx / 2, y0 = r * th + gy / 2;
    const quad = [[x0, y0], [x0 + tw - gx, y0], [x0 + tw - gx, y0 + th - gy], [x0, y0 + th - gy]].map(q => { const d = AA.apply(xf, q); return [d[0] - V.x, d[1] - V.y]; });
    let fill;
    if (gray){ const l = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255; fill = hex([l * 255, l * 255, l * 255]); } else fill = hex([cr, cg, cb]);
    const tile = {id:R3.newId(), type:'path', points:quad, closed:true, fill, stroke:'none', strokeWidth:0};
    if (ca < 255) tile.opacity = ca / 255;
    tiles.push(tile);
  }
  const g = {id:R3.newId(), type:'group', name:'Object Mosaic', children:tiles};
  V.data.shapes.splice(0, 0, g);
  if (del) dropLayer(R);
  Layer.invalidate(V); Doc.activeId = V.id; R3.selectIds(V, [g.id]);
  return {ok:true, id:g.id, layerId:V.id, tiles:tiles.length};
});
/* menus.rs:1637-1640：菜单带预设参数 → 参数对话框（栏位＝那几个参数） */
reg('ai.object.createObjectMosaic.dialog', {params:'{image?} 开「创建对象马赛克」对话框（栏位：拼贴数量 宽／高＝10、拼贴间距 宽／高＝0、灰度、删除栅格；确定＝ai.object.createObjectMosaic）→ {ok, dialog}'}, p => {
  const C = 'ai.object.createObjectMosaic.dialog';
  const R = imageLayer(p); if (!R) return err(C, 'select an image');
  R3.form('objectMosaic', 'ai3t.mosaic', [
    {type:'head', label:'ai3t.tileNumber'},
    {key:'columns', label:'ai3t.columns', type:'number', value:10}, {key:'rows', label:'ai3t.rows', type:'number', value:10},
    {type:'head', label:'ai3t.tileSpacing'},
    {key:'spacingX', label:'ai3t.spacingX', type:'number', value:0}, {key:'spacingY', label:'ai3t.spacingY', type:'number', value:0},
    {key:'gray', label:'ai3t.grayResult', type:'check', value:false},
    {key:'deleteRaster', label:'ai3t.deleteRaster', type:'check', value:false}
  ], v => CMD.run('ai.object.createObjectMosaic', {image:R.id, columns:Math.round(v.columns), rows:Math.round(v.rows), spacingX:v.spacingX, spacingY:v.spacingY, gray:v.gray, deleteRaster:v.deleteRaster}));
  return {ok:true, dialog:'objectMosaic'};
});

/* ═════════════ menucmds.rs:524 crop_image ═════════════ */
reg('ai.object.cropImage', {undoable:true, params:'{image?: 像素层 id（缺省：现用层是像素层就它，否则现用层下方最近的可见像素层）, rect?: [x, y, 宽, 高]（文件坐标；缺省＝影像中心所在的画板）} 对象 ▸ 裁剪图像：像素层的画布裁成与 rect 相交的部分（层位置挪到裁剪框左上角）→ {ok, id, width, height}'}, p => {
  const C = 'ai.object.cropImage';
  const R = imageLayer(p); if (!R) return err(C, 'select an image');
  const ib = imgBounds(R);
  let rect;
  if (Array.isArray(p.rect)){
    if (p.rect.length !== 4 || !p.rect.every(v => typeof v === 'number' && isFinite(v))) return err(C, 'rect must be [x, y, width, height]');
    const [x, y, w, h] = p.rect; rect = {x0:Math.min(x, x + w), y0:Math.min(y, y + h), x1:Math.max(x, x + w), y1:Math.max(y, y + h)};
  } else if (p.rect !== undefined && p.rect !== null) return err(C, 'rect must be [x, y, width, height]');
  else {
    const cx = (ib.x0 + ib.x1) / 2, cy = (ib.y0 + ib.y1) / 2;
    const abs = R3.artboards ? R3.artboards() : [{rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}];
    const ab = abs.find(a => cx >= a.rect.x0 && cx <= a.rect.x1 && cy >= a.rect.y0 && cy <= a.rect.y1);   // artboard_at
    if (!ab) return err(C, 'the image is not on an artboard; pass rect');
    rect = ab.rect;
  }
  const r = {x0:Math.max(rect.x0, ib.x0), y0:Math.max(rect.y0, ib.y0), x1:Math.min(rect.x1, ib.x1), y1:Math.min(rect.y1, ib.y1)};
  if (r.x1 - r.x0 <= 0 || r.y1 - r.y0 <= 0) return err(C, "crop rectangle doesn't overlap the image");
  const E = 1e-6;
  if (Math.abs(r.x0 - ib.x0) < E && Math.abs(r.y0 - ib.y0) < E && Math.abs(r.x1 - ib.x1) < E && Math.abs(r.y1 - ib.y1) < E) return err(C, 'nothing to crop');
  // 保持像素密度（我们一像素＝一点 ⇒ scale 1）；裁剪框左上角对齐到像素格
  const ox = Math.round(r.x0 - R.x), oy = Math.round(r.y0 - R.y);
  const w = Math.max(1, Math.round(r.x1 - r.x0)), h = Math.max(1, Math.round(r.y1 - r.y0));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d', {willReadFrequently:true}); cx.drawImage(R.data.canvas, -ox, -oy);
  R.data = {canvas:c, ctx:cx}; R.x += ox; R.y += oy;
  Layer.invalidate(R);
  return {ok:true, id:R.id, width:w, height:h};
});

/* ═════════════ halftone.rs ═════════════ */
const MAX_CELLS = 100000, MAX_SAMPLE_PIXELS = 16e6, MIN_TONE = 0.01, KAPPA = 0.5522847498307936;
const DOTS = ['circle', 'ellipse', 'square', 'diamond', 'line'];
const DOT_ALIAS = {circle:'circle', round:'circle', dot:'circle', ellipse:'ellipse', square:'square', diamond:'diamond', line:'line', lines:'line'};
const rectPts = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];       // shapes::rectangle（中心在原点）
/* DotShape::path：色调 t、格宽 s、中心在原点 → {pts:[角点]} 或 {ell:[rx, ry]} */
function dotLocal(shape, t, s){
  if (shape === 'circle'){ const r = s * Math.sqrt(t / Math.PI); return {ell:[r, r]}; }
  if (shape === 'ellipse'){ const r = s * Math.sqrt(t / Math.PI); return {ell:[1.3 * r, r / 1.3]}; }
  if (shape === 'square') return {pts:rectPts(s * Math.sqrt(t), s * Math.sqrt(t))};
  if (shape === 'diamond'){ const q = Math.PI / 4, c = Math.cos(q), sn = Math.sin(q); return {pts:rectPts(s * Math.sqrt(t), s * Math.sqrt(t)).map(([x, y]) => [x * c - y * sn, x * sn + y * c])}; }
  return {pts:rectPts(s * 1.001, s * t)};                                    // 线：一行的格子连成一条，粗细＝色调
}
/* 放到格子中心、转网屏角度 → 子路径 {anchors, closed}（文件坐标） */
function dotPath(loc, m){
  const ap = q => AA.apply(m, q);
  if (loc.pts) return {anchors:loc.pts.map(q => { const p = ap(q); return {x:p[0], y:p[1], in:null, out:null}; }), closed:true};
  const [rx, ry] = loc.ell, k = KAPPA, P = [[rx, 0], [0, ry], [-rx, 0], [0, -ry]];
  const H = [[[rx, -k * ry], [rx, k * ry]], [[k * rx, ry], [-k * rx, ry]], [[-rx, k * ry], [-rx, -k * ry]], [[-k * rx, -ry], [k * rx, -ry]]];   // [进, 出]
  return {anchors:P.map((q, i) => { const p = ap(q); return {x:p[0], y:p[1], in:ap(H[i][0]), out:ap(H[i][1])}; }), closed:true};
}
const ctrlBounds = v => v.anchors.reduce((r, a) => [[a.x, a.y], a.in, a.out].filter(Boolean).reduce((r, q) => ({x0:Math.min(r.x0, q[0]), y0:Math.min(r.y0, q[1]), x1:Math.max(r.x1, q[0]), y1:Math.max(r.y1, q[1])}), r), {x0:Infinity, y0:Infinity, x1:-Infinity, y1:-Infinity});
/* 绕数（多边形） */
function winding(polys, q){
  let w = 0;
  for (const P of polys) for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length];
    if (a[1] <= q[1]){ if (b[1] > q[1] && (b[0] - a[0]) * (q[1] - a[1]) - (q[0] - a[0]) * (b[1] - a[1]) > 0) w++; }
    else if (b[1] <= q[1] && (b[0] - a[0]) * (q[1] - a[1]) - (q[0] - a[0]) * (b[1] - a[1]) < 0) w--;
  }
  return w;
}
const inSet = (S, q) => { const w = winding(S.polys, q); return S.rule === 'evenodd' ? (w % 2 !== 0) : w !== 0; };
/* 图稿轮廓（effects/clip.rs clip_outline：路径＝它的外形、复合路径留洞、编组＝成员联集；影像＝框）→ [{polys, rule}]（文件坐标；多个＝联集） */
function outlineSets(art){
  if (art.image){ const b = imgBounds(art.image); return [{polys:[[[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]], rule:'nonzero'}]; }
  const f = R3.docF(art.L), out = [];
  for (const s of art.R) for (const leaf of R3.leavesOf(s)){
    const polys = R3.subviews(leaf).map(v => AIObj.flatten(v).map(f)).filter(P => P.length >= 2);
    if (polys.length) out.push({polys, rule:(leaf.type === 'compound' && leaf.rule === 'evenodd') ? 'evenodd' : 'nonzero'});
  }
  return out;
}
/* 简单分色：RGB → CMYK 墨量（0–1） */
function inks(r, g, b){ const k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 1]; return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]; }
function screenDots(S, bounds, cell, sc, shape, outline){
  const th = sc.angle * Math.PI / 180, rot = AA.rotate(th), inv = AA.inverse(rot);
  const cs = [[bounds.x0, bounds.y0], [bounds.x1, bounds.y0], [bounds.x1, bounds.y1], [bounds.x0, bounds.y1]].map(q => AA.apply(inv, q));
  const lo = [Math.min(...cs.map(q => q[0])), Math.min(...cs.map(q => q[1]))], hi = [Math.max(...cs.map(q => q[0])), Math.max(...cs.map(q => q[1]))];
  const i0 = Math.floor(lo[0] / cell) - 1, i1 = Math.ceil(hi[0] / cell) + 1, j0 = Math.floor(lo[1] / cell) - 1, j1 = Math.ceil(hi[1] / cell) + 1;
  const near = {x0:bounds.x0 - cell, y0:bounds.y0 - cell, x1:bounds.x1 + cell, y1:bounds.y1 + cell};
  const inside = [], edge = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
    const c = AA.apply(rot, [(i + 0.5) * cell, (j + 0.5) * cell]);
    if (!(c[0] >= near.x0 && c[0] < near.x1 && c[1] >= near.y0 && c[1] < near.y1)) continue;   // Rect::contains
    const t = Math.min(1, Math.max(0, S.cellTone(c, cell, rot, sc.channel)));
    if (t < MIN_TONE) continue;
    const dot = dotPath(dotLocal(shape, t, cell), AA.mul(AA.translate(c[0], c[1]), rot));
    let whole = true;
    if (outline && outline.length){ const b = ctrlBounds(dot); whole = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].every(q => outline.some(Sx => inSet(Sx, q))); }
    (whole ? inside : edge).push(dot);
  }
  const count = inside.length + edge.length, subs = inside.slice();
  if (outline && outline.length && edge.length){
    // 跨轮廓的点跟轮廓求交（po::boolean Intersect；平面排列替代实作见 ai-object 档头）
    const loops = AIObj.arrangement([{polys:edge.map(v => AIObj.flatten(v)), rule:'nonzero'}].concat(outline), m => m[0] && m.slice(1).some(Boolean));
    loops.map(AIObj.tidyLoop).filter(Boolean).forEach(v => subs.push(v));
  } else subs.push(...edge);
  return {subs, count};
}
reg('ai.object.vectorHalftone', {undoable:true, params:'{shape?: "circle"|"ellipse"|"square"|"diamond"|"line"（circle）, frequency?: 每英寸线数 1–300（20）, angle?: 度（45；CMYK＝黑版的，青 −30°、洋红 +30°、黄 −45°）, mode?: "mono"|"cmyk"（mono）, color?: 单色网点颜色（"#000000"）, invert?: bool（亮处出网点）, clip?: true（网点剪到图稿外形）, keepOriginal?: false, ids?, layerId?, image?: 像素层 id（没选矢量物件时：缺省现用层下方最近的可见像素层）} 对象 ▸ 矢量半调：选中的图稿按色调变成矢量网点，每个网屏一条复合路径、收进编组 Vector Halftone（CMYK 网屏正片叠底），放在图稿正上方，一步历史 → {ok, id, dots}'}, p => {
  const C = 'ai.object.vectorHalftone';
  let shape = 'circle';
  if (p.shape !== undefined){ shape = DOT_ALIAS[String(p.shape).toLowerCase()]; if (!shape) return err(C, `unknown shape \`${p.shape}\` (circle|ellipse|square|diamond|line)`); }
  const frequency = f64Or(p.frequency, 20);
  if (!(frequency >= 1 && frequency <= 300)) return err(C, 'frequency must be between 1 and 300 lines per inch');
  const angle = p.angle === undefined ? 45 : +p.angle;
  if (!isFinite(angle)) return err(C, 'invalid angle');
  const modeS = p.mode === undefined ? 'mono' : p.mode;
  if (modeS !== 'mono' && modeS !== 'cmyk') return err(C, `unknown mode \`${modeS}\` (mono|cmyk)`);
  const mono = modeS === 'mono';
  let color = '#000000';
  if (p.color !== undefined){ const cx = document.createElement('canvas').getContext('2d'); cx.fillStyle = '#010203'; cx.fillStyle = String(p.color); const v1 = cx.fillStyle; cx.fillStyle = '#030201'; cx.fillStyle = String(p.color); if (v1 !== cx.fillStyle) return err(C, 'invalid color'); color = v1; }
  const invert = bool(p.invert, false), clip = bool(p.clip, true), keep = bool(p.keepOriginal, false);
  const cell = 72 / frequency;
  // 图稿：选中的矢量物件；没选就是影像
  let art;
  { const V = R3.vLayer(p), Rs = V ? R3.roots(V, Array.isArray(p.ids) ? p.ids : null) : [];
    if (Rs.length && p.image === undefined) art = {L:V, R:Rs};
    else { const I = imageLayer(p); if (!I) return err(C, 'nothing selected'); art = {image:I}; } }
  const b = art.image ? imgBounds(art.image) : R3.boundsOf(art.L, art.R, true);
  if (!b) return err(C, 'the selection has no bounds');
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  if (bw <= 0 || bh <= 0 || !isFinite(bw * bh)) return err(C, 'the selection has no area');
  if ((bw + bh) ** 2 / 2 / (cell * cell) > MAX_CELLS) return err(C, 'too many dots for this size: lower the frequency');
  const outline = clip ? outlineSets(art) : null;
  // 每格约 4 像素取样
  const scale = Math.min(16, Math.max(0.01, Math.min(4 / cell, Math.sqrt(MAX_SAMPLE_PIXELS / (bw * bh)))));
  const region = {x0:b.x0 - cell, y0:b.y0 - cell, x1:b.x1 + cell, y1:b.y1 + cell};
  const w = Math.max(1, Math.round((region.x1 - region.x0) * scale)), h = Math.max(1, Math.round((region.y1 - region.y0) * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', {willReadFrequently:true});
  if (mono){ cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h); }           // render_region(white)
  if (art.image){ const I = art.image, c = I.data.canvas; cx.drawImage(c, (I.x - region.x0) * scale, (I.y - region.y0) * scale, c.width * scale, c.height * scale); }
  else { cx.save(); cx.translate((art.L.x - region.x0) * scale, (art.L.y - region.y0) * scale); art.R.forEach(s => window.drawShape(cx, Object.assign(clone(s), {visible:true}), scale)); cx.restore(); }
  const px = cx.getImageData(0, 0, w, h).data;
  let ink = null;
  if (!mono){ ink = new Float32Array(w * h * 4); for (let i = 0; i < w * h; i++){ const a = px[i * 4 + 3] / 255; if (!a) continue; const q = inks(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255); for (let k = 0; k < 4; k++) ink[i * 4 + k] = q[k] * a; } }
  const S = {
    tone(q, ch){
      const x = Math.floor((q[0] - region.x0) * scale), y = Math.floor((q[1] - region.y0) * scale);
      if (!(x >= 0 && y >= 0 && x < w && y < h)) return invert ? 1 : 0;
      const i = (y * w + x) * 4;
      const t = mono ? 1 - (0.2126 * px[i] / 255 + 0.7152 * px[i + 1] / 255 + 0.0722 * px[i + 2] / 255) : ink[i + ch];
      return invert ? 1 - t : t;
    },
    cellTone(c, s, rot, ch){ let sum = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++){ const off = AA.apply(rot, [(i - 1) * s / 3, (j - 1) * s / 3]); sum += this.tone([c[0] + off[0], c[1] + off[1]], ch); } return sum / 9; }
  };
  const screens = mono ? [{paint:color, angle, channel:0}] : [
    {paint:'#ffff00', angle:angle - 45, channel:2}, {paint:'#ff00ff', angle:angle + 30, channel:1},
    {paint:'#00ffff', angle:angle - 30, channel:0}, {paint:'#000000', angle, channel:3}];       // 由下到上：黄、洋红、青、黑
  const layers = []; let dots = 0;
  for (const sc of screens){ const r = screenDots(S, b, cell, sc, shape, outline); dots += r.count; if (r.subs.length) layers.push([r.subs, sc.paint]); }
  if (!layers.length) return err(C, 'the art is too light for any dots');
  // 放进去：图稿正上方
  let V, at;
  if (art.image){ V = destAbove(art.image, T('ai3t.halftoneLayer')); at = 0; }
  else { V = art.L; at = V.data.shapes.indexOf(art.R[art.R.length - 1]) + 1; }
  const children = layers.map(([subs, paint]) => {
    const n = pathShape(subs.map(v => moveSub(v, -V.x, -V.y)), {fill:paint, stroke:'none', strokeWidth:0});
    if (!mono) n.blend = 'multiply';
    return n;
  });
  const g = {id:R3.newId(), type:'group', name:'Vector Halftone', children};
  V.data.shapes.splice(at, 0, g);
  if (!keep){ if (art.image) dropLayer(art.image); else art.R.forEach(s => { const i = V.data.shapes.indexOf(s); if (i >= 0) V.data.shapes.splice(i, 1); }); }
  Layer.invalidate(V); Doc.activeId = V.id; R3.selectIds(V, [g.id]);
  return {ok:true, id:g.id, layerId:V.id, dots};
});
/* 矢量半调…（dialogs/halftone.rs：栏位与预设照抄；即时预览没做） */
reg('ai.object.vectorHalftone.dialog', {params:'{} 开「矢量半调」对话框（形状 圆形、频率 20 lpi、角度 45°、网屏 单色、颜色 #000000、反相 否、剪切到图稿 是、保留原稿 否；确定＝ai.object.vectorHalftone）→ {ok, dialog}'}, p => {
  const C = 'ai.object.vectorHalftone.dialog';
  const V = R3.vLayer(p), Rs = V ? R3.roots(V, null) : [];
  if (!Rs.length && !imageLayer(p)) return err(C, 'nothing selected');
  R3.form('vectorHalftone', 'ai3t.halftone', [
    {key:'shape', label:'ai3t.shape', type:'select', value:'circle', options:DOTS.map(d => [d, 'ai3t.s.' + d])},
    {key:'frequency', label:'ai3t.frequency', type:'number', value:20},
    {key:'angle', label:'ai3t.angle', type:'number', value:45},
    {key:'mode', label:'ai3t.screens', type:'select', value:'mono', options:[['mono', 'ai3t.mono'], ['cmyk', 'ai3t.cmyk']]},
    {key:'color', label:'ai3t.dotColor', type:'text', value:'#000000'},
    {key:'invert', label:'ai3t.invert', type:'check', value:false},
    {key:'clip', label:'ai3t.clip', type:'check', value:true},
    {key:'keepOriginal', label:'ai3t.keep', type:'check', value:false}
  ], v => {
    const q = {shape:v.shape, frequency:Math.min(150, Math.max(1, v.frequency)), angle:Math.min(90, Math.max(-90, v.angle)), mode:v.mode, invert:v.invert, clip:v.clip, keepOriginal:v.keepOriginal};
    if (v.mode !== 'cmyk') q.color = v.color;
    return CMD.run('ai.object.vectorHalftone', q);
  });
  return {ok:true, dialog:'vectorHalftone'};
});

/* ═════ 三语（照 AI 中文版正名） ═════ */
const PN = {
  'zh-Hant':['[預設]', '高保真度相片', '低保真度相片', '3 色', '6 色', '16 色', '灰階', '黑白標誌', '素描圖稿', '剪影', '線條圖', '技術繪圖'],
  'zh-Hans':['[默认]', '高保真度照片', '低保真度照片', '3 色', '6 色', '16 色', '灰阶', '黑白徽标', '素描图稿', '剪影', '线稿图', '技术绘图'],
  en:['[Default]', 'High Fidelity Photo', 'Low Fidelity Photo', '3 Colors', '6 Colors', '16 Colors', 'Shades of Gray', 'Black and White Logo', 'Sketched Art', 'Silhouettes', 'Line Art', 'Technical Drawing']
};
const S3 = {
  'zh-Hant':{'ai3t.make':'影像描圖', 'ai3t.makeAndExpand':'影像描圖（製作並展開）', 'ai3t.preset':'預設集', 'ai3t.mode':'模式', 'ai3t.bw':'黑白', 'ai3t.gray':'灰階', 'ai3t.color':'彩色', 'ai3t.threshold':'臨界值', 'ai3t.colors':'顏色',
    'ai3t.advanced':'進階', 'ai3t.paths':'路徑', 'ai3t.corners':'轉角', 'ai3t.noise':'雜色', 'ai3t.method':'方法', 'ai3t.abutting':'鄰接', 'ai3t.overlapping':'重疊', 'ai3t.snap':'將曲線靠齊線條', 'ai3t.ignoreWhite':'忽略白色',
    'ai3t.traceLayer':'影像描圖', 'ai3t.mosaicLayer':'物件馬賽克', 'ai3t.halftoneLayer':'向量網屏',
    'ai3t.mosaic':'建立物件馬賽克', 'ai3t.tileNumber':'拼貼數目', 'ai3t.columns':'寬度', 'ai3t.rows':'高度', 'ai3t.tileSpacing':'拼貼間距', 'ai3t.spacingX':'寬度', 'ai3t.spacingY':'高度', 'ai3t.grayResult':'結果：灰階', 'ai3t.deleteRaster':'刪除點陣',
    'ai3t.halftone':'向量網屏', 'ai3t.shape':'形狀', 'ai3t.s.circle':'圓形', 'ai3t.s.ellipse':'橢圓形', 'ai3t.s.square':'方形', 'ai3t.s.diamond':'菱形', 'ai3t.s.line':'線條', 'ai3t.frequency':'網線數（lpi）', 'ai3t.angle':'角度',
    'ai3t.screens':'網屏', 'ai3t.mono':'單色', 'ai3t.cmyk':'CMYK', 'ai3t.dotColor':'顏色', 'ai3t.invert':'反轉', 'ai3t.clip':'剪裁至圖稿', 'ai3t.keep':'保留原稿'},
  'zh-Hans':{'ai3t.make':'图像描摹', 'ai3t.makeAndExpand':'图像描摹（建立并扩展）', 'ai3t.preset':'预设', 'ai3t.mode':'模式', 'ai3t.bw':'黑白', 'ai3t.gray':'灰度', 'ai3t.color':'彩色', 'ai3t.threshold':'阈值', 'ai3t.colors':'颜色',
    'ai3t.advanced':'高级', 'ai3t.paths':'路径', 'ai3t.corners':'边角', 'ai3t.noise':'杂色', 'ai3t.method':'方法', 'ai3t.abutting':'邻接', 'ai3t.overlapping':'重叠', 'ai3t.snap':'将曲线与线条对齐', 'ai3t.ignoreWhite':'忽略白色',
    'ai3t.traceLayer':'图像描摹', 'ai3t.mosaicLayer':'对象马赛克', 'ai3t.halftoneLayer':'矢量半调',
    'ai3t.mosaic':'创建对象马赛克', 'ai3t.tileNumber':'拼贴数量', 'ai3t.columns':'宽度', 'ai3t.rows':'高度', 'ai3t.tileSpacing':'拼贴间距', 'ai3t.spacingX':'宽度', 'ai3t.spacingY':'高度', 'ai3t.grayResult':'结果：灰度', 'ai3t.deleteRaster':'删除栅格',
    'ai3t.halftone':'矢量半调', 'ai3t.shape':'形状', 'ai3t.s.circle':'圆形', 'ai3t.s.ellipse':'椭圆', 'ai3t.s.square':'方形', 'ai3t.s.diamond':'菱形', 'ai3t.s.line':'线条', 'ai3t.frequency':'频率（lpi）', 'ai3t.angle':'角度',
    'ai3t.screens':'网屏', 'ai3t.mono':'单色', 'ai3t.cmyk':'CMYK', 'ai3t.dotColor':'颜色', 'ai3t.invert':'反相', 'ai3t.clip':'剪切到图稿', 'ai3t.keep':'保留原稿'},
  en:{'ai3t.make':'Image Trace', 'ai3t.makeAndExpand':'Image Trace (Make and Expand)', 'ai3t.preset':'Preset', 'ai3t.mode':'Mode', 'ai3t.bw':'Black and White', 'ai3t.gray':'Grayscale', 'ai3t.color':'Color', 'ai3t.threshold':'Threshold', 'ai3t.colors':'Colors',
    'ai3t.advanced':'Advanced', 'ai3t.paths':'Paths', 'ai3t.corners':'Corners', 'ai3t.noise':'Noise', 'ai3t.method':'Method', 'ai3t.abutting':'Abutting', 'ai3t.overlapping':'Overlapping', 'ai3t.snap':'Snap Curves To Lines', 'ai3t.ignoreWhite':'Ignore White',
    'ai3t.traceLayer':'Image Trace', 'ai3t.mosaicLayer':'Object Mosaic', 'ai3t.halftoneLayer':'Vector Halftone',
    'ai3t.mosaic':'Create Object Mosaic', 'ai3t.tileNumber':'Number of Tiles', 'ai3t.columns':'Width', 'ai3t.rows':'Height', 'ai3t.tileSpacing':'Tile Spacing', 'ai3t.spacingX':'Width', 'ai3t.spacingY':'Height', 'ai3t.grayResult':'Result: Gray', 'ai3t.deleteRaster':'Delete Raster',
    'ai3t.halftone':'Vector Halftone', 'ai3t.shape':'Shape', 'ai3t.s.circle':'Circle', 'ai3t.s.ellipse':'Ellipse', 'ai3t.s.square':'Square', 'ai3t.s.diamond':'Diamond', 'ai3t.s.line':'Line', 'ai3t.frequency':'Frequency (lpi)', 'ai3t.angle':'Angle',
    'ai3t.screens':'Screens', 'ai3t.mono':'Mono', 'ai3t.cmyk':'CMYK', 'ai3t.dotColor':'Color', 'ai3t.invert':'Invert', 'ai3t.clip':'Clip to Art', 'ai3t.keep':'Keep Original'}
};
for (const lg of Object.keys(PN)) PRESET_NAMES.forEach((n, i) => { S3[lg]['ai3t.p.' + n] = PN[lg][i]; });
Lang.add(S3);
R3.trace = {trace, quantize, denoise, traceMask, polygon, dejag, preset, PRESET_NAMES, mosaic};    // 给测试与别段用（AiR3.trace）
})();


/*persp（对象 ▸ 透视 ＋ 透视网格模型 window.AiPersp）：照 vectorcraft 原码抄
     tools/src/distort/perspective.rs:36-815      Plane、PerspectiveGrid（栏位／预设／单应／网格线／小部件位置）、attachment／attached_roots／set_attachment／release、mapped_bounds、in_quad
     tools/src/distort/perspective/define.rs:1-390 内建预设 BUILTINS、station／set_station、foreshortening、reconcile、GridDefinition（定义网格栏位）、with_definition
     tools/src/distort/perspective/view.rs:1-104   吸附（snap_plane／snap_offset）、格线颜色、标尺
     tools/src/distort/perspective/widget.rs:74-111 平面切换小部件几何
     tools/src/distort.rs:46-120                   project_node／warp_node／collect_points；doc/src/live.rs:1307 affine_near
     geom/src/projective.rs:1-120                   Homography；doc/src/perspective.rs 物件上的附加纪录（plane／depth／projection／editing）；doc/src/lib.rs:100-200 Unit
     engine/src/cmd/distortcmds.rs:85-193、693-1165 命令：perspective.attach／release／plane.set／plane.move／plane.matchObject／move／transform／nudge／draw／editText
   我们的资料：网格存 Doc.aiR3.perspectiveGrid（＝原码 Document.unknown["perspectiveGrid"]，AiR3 共用钩子已接进历史快照与工程档）；
     物件附加纪录存在物件上：矢量形状 s.perspective = {plane, depth}；文字层 L.data.perspective = {plane, depth, projection:[9]}（文字保持平的、画的时候透过 projection 投影）。 */
(function(){
'use strict';
if (window.__aiR3_perspO) return; window.__aiR3_perspO = true;
const R3 = window.AiR3;
const clone = o => JSON.parse(JSON.stringify(o));
const fin = v => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const KEY = 'perspectiveGrid';
const PLANES = ['left', 'right', 'ground'];
const err = (c, m) => ({ok:false, error:c + ': ' + m});

/* ═══════════ Homography（geom/src/projective.rs）：3×3 row-major，作用在 (x, y, 1) ═══════════ */
const Hm = {
  I: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  fromCols(c1, c2, c3){ return [[c1[0], c2[0], c3[0]], [c1[1], c2[1], c3[1]], [c1[2], c2[2], c3[2]]]; },
  /* 仿射 [a,b,c,d,e,f]（kurbo 系数：x' = a x + c y + e、y' = b x + d y + f） */
  fromAffine(a){ return [[a[0], a[2], a[4]], [a[1], a[3], a[5]], [0, 0, 1]]; },
  fromArray(v){
    if (!Array.isArray(v) || v.length !== 9 || v.some(x => !fin(x))) return null;
    const h = [[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]];
    return Math.abs(Hm.det(h)) > 1e-15 ? h : null;
  },
  toArray(m){ return [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]]; },
  /* 落在地平线上或后面（w ≤ 0）回 null */
  apply(m, p){
    const x = m[0][0] * p[0] + m[0][1] * p[1] + m[0][2], y = m[1][0] * p[0] + m[1][1] * p[1] + m[1][2], w = m[2][0] * p[0] + m[2][1] * p[1] + m[2][2];
    if (!(w > 1e-9) || !isFinite(x) || !isFinite(y)) return null;
    return [x / w, y / w];
  },
  det(m){ return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); },
  inverse(m){
    const d = Hm.det(m); if (!(Math.abs(d) >= 1e-15) || !isFinite(d)) return null;
    const c = (r0, c0, r1, c1) => m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
    const adj = [[c(1, 1, 2, 2), -c(0, 1, 2, 2), c(0, 1, 1, 2)], [-c(1, 0, 2, 2), c(0, 0, 2, 2), -c(0, 0, 1, 2)], [c(1, 0, 2, 1), -c(0, 0, 2, 1), c(0, 0, 1, 1)]];
    return adj.map(row => row.map(v => v / d));
  },
  /* a ∘ b：b 先 */
  then(a, b){ const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[r][k] = a[r][0] * b[0][k] + a[r][1] * b[1][k] + a[r][2] * b[2][k]; return o; },
  conjugated(m, a){ const dt = a[0] * a[3] - a[1] * a[2]; if (Math.abs(dt) < 1e-15) return null; return Hm.then(Hm.then(Hm.fromAffine(a), m), Hm.fromAffine(Aff.inv(a))); },
  mapRectBBox(m, r){
    let o = null;
    for (const p of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]){
      const q = Hm.apply(m, p); if (!q) return null;
      o = o ? {x0:Math.min(o.x0, q[0]), y0:Math.min(o.y0, q[1]), x1:Math.max(o.x1, q[0]), y1:Math.max(o.y1, q[1])} : {x0:q[0], y0:q[1], x1:q[0], y1:q[1]};
    }
    return o;
  }
};
const Aff = {
  translate: (x, y) => [1, 0, 0, 1, x, y],
  mul(a, b){ return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; },
  inv(a){ const d = a[0] * a[3] - a[1] * a[2]; return [a[3] / d, -a[1] / d, -a[2] / d, a[0] / d, (a[2] * a[5] - a[3] * a[4]) / d, (a[1] * a[4] - a[0] * a[5]) / d]; },
  det: a => a[0] * a[3] - a[1] * a[2]
};
/* live.rs:1307 affine_near：f 在 p 处的一阶仿射近似（中心差分） */
function affineNear(f, p, eps){
  const o = f(p), ax = f([p[0] + eps, p[1]]), bx = f([p[0] - eps, p[1]]), ay = f([p[0], p[1] + eps]), by = f([p[0], p[1] - eps]);
  const ex = [(ax[0] - bx[0]) / (2 * eps), (ax[1] - bx[1]) / (2 * eps)], ey = [(ay[0] - by[0]) / (2 * eps), (ay[1] - by[1]) / (2 * eps)];
  return Aff.mul(Aff.mul(Aff.translate(o[0], o[1]), [ex[0], ex[1], ey[0], ey[1], 0, 0]), Aff.translate(-p[0], -p[1]));
}

/* ═══════════ 单位（doc/src/lib.rs:100-200 Unit） ═══════════ */
const UNITS = [['points', 'Points', 'pt', 1], ['picas', 'Picas', 'p', 12], ['inches', 'Inches', 'in', 72], ['millimeters', 'Millimeters', 'mm', 72 / 25.4],
  ['centimeters', 'Centimeters', 'cm', 72 / 2.54], ['pixels', 'Pixels', 'px', 1], ['feetInches', 'Feet & Inches', 'ft', 864], ['meters', 'Meters', 'm', 72 / 0.0254],
  ['yards', 'Yards', 'yd', 2592], ['feet', 'Feet', 'ft', 864]].map(([key, label, suffix, points]) => ({key, label, suffix, points}));
const letters = s => String(s).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
/* Unit::named：名称、缩写或键（不分大小写、忽略空白与标点） */
const unitNamed = n => { const g = letters(n); return UNITS.find(u => letters(u.label) === g || u.suffix === g) || null; };
const unitOf = n => unitNamed(n) || UNITS[0];
/* Unit::number：三位小数、去掉尾零 */
function unitNumber(u, pt){ let s = (pt / u.points).toFixed(3); s = s.replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' ? '0' : s; }

/* ═══════════ 平面（perspective.rs:36-75） ═══════════ */
const PLANE_COLOR = {left:[0x33, 0x66, 0xff], right:[0xff, 0x8c, 0x1a], ground:[0x2e, 0xb8, 0x4a], none:[0x99, 0x99, 0x99]};
const planeParse = s => ({left:'left', right:'right', ground:'ground', horizontal:'ground', none:'none'})[s] || null;
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
/* Rgb::parse：#rrggbb 或 rrggbb → '#rrggbb' 小写；不合法回 null */
function rgbParse(s){ if (typeof s !== 'string') return null; const h = s.trim().replace(/^#+/, ''); return /^[0-9a-fA-F]{6}$/.test(h) ? '#' + h.toLowerCase() : null; }
const rgbOf = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* ═══════════ 网格模型（PerspectiveGrid） ═══════════ */
const LETTER = {x0:0, y0:0, x1:612, y1:792};
const DEFAULT_ANGLE = 45, MAX_LEN = 4.0e6, MAX_DEPTH = 1.0e6, SNAP = 0.25;
const BUILTINS = [['[1P-Normal View]', 1, 0.42], ['[1P-Low View]', 1, 0.66], ['[1P-High View]', 1, 0.12], ['[2P-Normal View]', 2, 0.42], ['[2P-Low View]', 2, 0.66],
  ['[2P-High View]', 2, 0.12], ['[3P-Normal View]', 3, 0.42], ['[3P-Low View]', 3, 0.66]];
const isBuiltin = n => BUILTINS.some(b => b[0].toLowerCase() === String(n).trim().toLowerCase());
const FIELDS = ['kind', 'origin', 'horizon', 'vpLeft', 'vpRight', 'vpVertical', 'distance', 'cell', 'extent', 'height', 'visible', 'plane', 'name', 'angle', 'units', 'scale',
  'leftColor', 'rightColor', 'groundColor', 'opacity', 'leftOffset', 'rightOffset', 'groundOffset', 'locked', 'lockStation', 'snap', 'rulers', 'extentRight'];
/* serde 缺省值（perspective.rs:93-172） */
const SERDE_DEF = () => ({kind:2, visible:true, plane:'left', name:'', angle:null, units:'points', scale:[1, 1], leftColor:hex(PLANE_COLOR.left), rightColor:hex(PLANE_COLOR.right),
  groundColor:hex(PLANE_COLOR.ground), opacity:50, leftOffset:0, rightOffset:0, groundOffset:0, locked:false, lockStation:false, snap:true, rulers:false, extentRight:null});

/* perspective.rs:176-214 preset：照 Illustrator 的预设套到画板上 */
function preset(kind, ab){
  const w = Math.max(ab.x1 - ab.x0, 1), h = Math.max(ab.y1 - ab.y0, 1);
  kind = clamp(kind, 1, 3);
  const horizon = ab.y0 + 0.42 * h, ground = ab.y0 + 0.78 * h;
  const ox = kind === 1 ? ab.x0 + 0.3 * w : ab.x0 + 0.5 * w;
  const [vl, vr] = kind === 1 ? [ab.x0 + 0.55 * w, ab.x1] : [ab.x0 + 0.02 * w, ab.x1 - 0.02 * w];
  return Object.assign(SERDE_DEF(), {kind, origin:[ox, ground], horizon, vpLeft:vl, vpRight:vr, vpVertical:[ox, horizon - 3 * (ground - horizon)],
    distance:0.5 * w, cell:Math.round(Math.max(w / 30, 1)), extent:0.6 * w, height:(ground - ab.y0) * 0.8, visible:true, plane:'left'});
}
/* define.rs:230-245 builtin／normal */
function builtin(name, ab){
  const b = BUILTINS.find(x => x[0].toLowerCase() === String(name).trim().toLowerCase()); if (!b) return null;
  const g = preset(b[1], ab), ground = g.origin[1];
  g.horizon = ab.y0 + b[2] * Math.max(ab.y1 - ab.y0, 1);
  g.vpVertical = [g.vpVertical[0], g.horizon - 3 * (ground - g.horizon)];
  g.name = b[0];
  setStation(g, station(g), DEFAULT_ANGLE);
  return g;
}
function normal(kind, ab){ const b = BUILTINS.find(x => x[1] === clamp(kind, 1, 3)); return (b && builtin(b[0], ab)) || preset(kind, ab); }
const viewingAngle = g => g.angle == null ? DEFAULT_ANGLE : g.angle;
/* define.rs:255-279 站点（观者）：视觉中心 x 与到画面的距离 */
function station(g){
  const w = g.vpRight - g.vpLeft;
  if (g.kind === 1) return {x:g.vpLeft, distance:g.distance};
  if (g.angle != null && w > 0){ const a = g.angle * Math.PI / 180, s = Math.sin(a), c = Math.cos(a); return {x:g.vpLeft + w * c * c, distance:w * s * c}; }
  return {x:(g.vpLeft + g.vpRight) / 2, distance:Math.abs(w) > 1e-9 ? Math.abs(w) / 2 : g.distance};
}
function setStation(g, st, angle){
  g.distance = st.distance; g.angle = angle;
  if (g.kind === 1) g.vpLeft = st.x;
  else { const t = Math.tan(angle * Math.PI / 180); g.vpLeft = st.x - st.distance / t; g.vpRight = st.x + st.distance * t; }
}
/* define.rs:283-291 左、右、竖轴的透视缩短（1／观者到消失点的距离） */
function foreshortening(g){
  const u = 1 / Math.max(g.distance, 1e-9);
  if (g.kind === 1 || g.angle == null || g.vpRight <= g.vpLeft) return [u, u, u];
  const st = station(g);
  const to = (x, y) => 1 / Math.max(Math.sqrt(st.distance * st.distance + (x - st.x) ** 2 + (y - g.horizon) ** 2), 1e-9);
  return [to(g.vpLeft, g.horizon), to(g.vpRight, g.horizon), to(g.vpVertical[0], g.vpVertical[1])];
}
/* perspective.rs:366-376 轴的无穷远点的像 */
function axisCol(g, axis){
  const [ll, lr, lu] = foreshortening(g);
  if (axis === 'X') return g.kind === 1 ? [1, 0, 0] : [g.vpRight * lr, g.horizon * lr, lr];
  if (axis === 'Y') return g.kind === 3 ? [g.vpVertical[0] * lu, g.vpVertical[1] * lu, lu] : [0, -1, 0];
  return [g.vpLeft * ll, g.horizon * ll, ll];
}
/* perspective.rs:379-388 平面的轴 [u, v, 法线] */
function axes(g, plane){
  if (!PLANES.includes(plane)) return null;
  if (g.kind === 1) return plane === 'left' ? ['X', 'Y', 'Z'] : plane === 'right' ? ['Z', 'Y', 'X'] : ['X', 'Z', 'Y'];
  return plane === 'left' ? ['Z', 'Y', 'X'] : plane === 'right' ? ['X', 'Y', 'Z'] : ['X', 'Z', 'Y'];
}
const offset = (g, plane) => plane === 'left' ? g.leftOffset : plane === 'right' ? g.rightOffset : plane === 'ground' ? g.groundOffset : 0;
function setOffset(g, plane, v){ if (plane === 'left') g.leftOffset = v; else if (plane === 'right') g.rightOffset = v; else if (plane === 'ground') g.groundOffset = v; }
function frameH(g, u, v, at){
  if (!fin(at[1])) return null;
  const c = axisCol(g, at[0]);
  const o = [g.origin[0] + at[1] * c[0], g.origin[1] + at[1] * c[1], 1 + at[1] * c[2]];
  if (o[2] <= 1e-9) return null;
  const h = Hm.fromCols(axisCol(g, u), axisCol(g, v), o);
  return Math.abs(Hm.det(h)) > 1e-15 ? h : null;
}
function homographyAt(g, plane, depth){ const a = axes(g, plane); return a ? frameH(g, a[0], a[1], [a[2], depth]) : null; }
const homography = (g, plane) => homographyAt(g, plane, offset(g, plane));
function planeDelta(g, plane, depth, from, to){
  const h = homographyAt(g, plane, depth), hi = h && Hm.inverse(h); if (!hi) return null;
  const a = Hm.apply(hi, to), b = Hm.apply(hi, from); return a && b ? [a[0] - b[0], a[1] - b[1]] : null;
}
/* perspective.rs:425-431 depth_at：垂直于平面拖曳到达的深度 */
function depthAt(g, plane, depth, from, to){
  const a = axes(g, plane); if (!a) return null;
  const h = homographyAt(g, plane, depth), hi = h && Hm.inverse(h), q = hi && Hm.apply(hi, from); if (!q) return null;
  const f = frameH(g, a[2], a[1], [a[0], q[0]]), ci = f && Hm.inverse(f); if (!ci) return null;
  const t = Hm.apply(ci, to), s = Hm.apply(ci, from); if (!t || !s) return null;
  const d = depth + (t[0] - s[0]);
  return fin(d) && Math.abs(d) <= MAX_DEPTH ? d : null;
}
/* H(depth + dz) · m · H(depth)⁻¹ */
function transformMap(g, plane, depth, m, dz){
  const h = homographyAt(g, plane, depth), to = homographyAt(g, plane, depth + dz), hi = h && Hm.inverse(h);
  return (h && to && hi) ? Hm.then(Hm.then(to, Hm.fromAffine(m)), hi) : null;
}
const rightExtent = g => g.extentRight == null ? g.extent : g.extentRight;
/* perspective.rs:469-476 平面的平面坐标范围 */
function domain(g, plane){
  if (plane === 'ground') return g.kind === 1 ? {x0:0, y0:0, x1:g.extent, y1:rightExtent(g)} : {x0:0, y0:0, x1:rightExtent(g), y1:g.extent};
  if (plane === 'right') return {x0:0, y0:0, x1:rightExtent(g), y1:g.height};
  return {x0:0, y0:0, x1:g.extent, y1:g.height};
}
/* view.rs:20-38 吸附：四分之一格以内吸到格线 */
function gridlineNear(g, v){ const line = Math.round(v / g.cell) * g.cell; return Math.abs(line - v) <= SNAP * g.cell ? line : null; }
function snapPlane(g, q){ const a = gridlineNear(g, q[0]), b = gridlineNear(g, q[1]); return [a == null ? q[0] : a, b == null ? q[1] : b]; }
function snapOffset(g, b, d){
  const axis = (lo, hi, dd) => {
    const pulls = [lo + dd, hi + dd].map(e => { const l = gridlineNear(g, e); return l == null ? null : l - e; }).filter(v => v != null);
    if (!pulls.length) return dd;
    return dd + pulls.reduce((m, v) => Math.abs(v) < Math.abs(m) ? v : m);
  };
  return [axis(b.x0, b.x1, d[0]), axis(b.y0, b.y1, d[1])];
}
/* perspective.rs:513-524 attach_homography：外框的左上与右下两角保持不动（snap 时落在最近的格线上） */
function attachHomography(g, plane, b, snap){
  const h = homography(g, plane), hi = h && Hm.inverse(h); if (!hi) return null;
  const sn = q => snap ? snapPlane(g, q) : q;
  const a0 = Hm.apply(hi, [b.x0, b.y0]), c0 = Hm.apply(hi, [b.x1, b.y1]); if (!a0 || !c0) return null;
  const a = sn(a0), c = sn(c0), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  let sx = Math.abs(bw) > 1e-9 ? (c[0] - a[0]) / bw : 1;
  const sy = Math.abs(bh) > 1e-9 ? (c[1] - a[1]) / bh : Math.abs(sx) * (c[1] < a[1] ? -1 : 1);
  sx = Math.abs(bw) > 1e-9 ? sx : Math.abs(sy);
  return Hm.then(h, Hm.fromAffine([sx, 0, 0, sy, a[0] - b.x0 * sx, a[1] - b.y0 * sy]));
}
/* perspective.rs:530-539 size_homography（对话框点一下定尺寸的形状：平面单位保留尺寸） */
function sizeHomography(g, plane, at, snap){
  const h = homography(g, plane), hi = h && Hm.inverse(h); if (!hi) return null;
  let q = Hm.apply(hi, at); if (!q) return null;
  if (snap) q = snapPlane(g, q);
  const p = Hm.apply(h, q), px = Hm.apply(h, [q[0] + 1, q[1]]), py = Hm.apply(h, [q[0], q[1] + 1]); if (!p || !px || !py) return null;
  const sx = px[0] < p[0] ? -1 : 1, sy = py[1] < p[1] ? -1 : 1;
  return Hm.then(h, Hm.fromAffine([sx, 0, 0, sy, q[0] - sx * p[0], q[1] - sy * p[1]]));
}
/* perspective.rs:553-580 一个平面的格线（文件坐标线段） */
function lines(g, plane){
  const h = homography(g, plane); if (!h) return [];
  const d = domain(g, plane), W = d.x1 - d.x0, Hh = d.y1 - d.y0, out = [];
  const step = len => { let s = g.cell; while (len / s > 120) s *= 2; return s; };
  const su = step(W), sv = step(Hh);
  for (let u = 0; u <= W + 1e-9; u += su){ const a = Hm.apply(h, [u, 0]), b = Hm.apply(h, [u, Hh]); if (a && b) out.push([a, b]); }
  for (let v = 0; v <= Hh + 1e-9; v += sv){ const a = Hm.apply(h, [0, v]), b = Hm.apply(h, [W, v]); if (a && b) out.push([a, b]); }
  return out;
}
/* perspective.rs:599-608 三个平面小部件（菱形）的位置 */
function planeWidgets(g){
  const e = g.extent / 2, out = [];
  for (const pl of PLANES){ const h = homography(g, pl), q = h && Hm.apply(h, pl === 'ground' ? [e, e] : [e, 0]); if (q) out.push([pl, q]); }
  return out;
}
/* widget.rs:76-102 平面切换小部件（无视窗时以第一个画板代替视窗；tol＝每个萤幕像素的文件单位） */
const WSIZE = 40, WMARGIN = 10;
function widgetAt(g, ab, tol, corner){
  corner = corner || 'topLeft';
  const right = corner === 'topRight' || corner === 'bottomRight', bottom = corner === 'bottomLeft' || corner === 'bottomRight';
  const inset = WMARGIN + WSIZE / 2; tol = Math.max(tol, 1e-9);
  const w = (ab.x1 - ab.x0) / tol, h = (ab.y1 - ab.y0) / tol;
  const c = [right ? w - inset : inset, bottom ? h - inset : inset];
  const p = (dx, dy) => [ab.x0 + (c[0] + dx * WSIZE) * tol, ab.y0 + (c[1] + dy * WSIZE) * tol];
  const faces = [['left', [p(-0.5, -0.25), p(0, 0), p(0, 0.5), p(-0.5, 0.25)]], ['right', [p(0, 0), p(0.5, -0.25), p(0.5, 0.25), p(0, 0.5)]],
    ['ground', [p(0, -0.5), p(0.5, -0.25), p(0, 0), p(-0.5, -0.25)]]];
  const sx = right ? -0.62 : 0.62, sy = bottom ? -0.62 : 0.62;
  return {faces, dot:[p(sx, sy), 0.12 * WSIZE * tol]};
}
/* perspective.rs:747-762 in_quad */
function inQuad(q, p){
  let sign = 0;
  for (let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 1) % 4], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false;
  }
  return true;
}
function widgetHit(g, ab, tol, corner, p){
  const W = widgetAt(g, ab, tol, corner), c = W.dot[0];
  if (Math.hypot(p[0] - c[0], p[1] - c[1]) <= W.dot[1] * 1.5) return 'none';
  const f = W.faces.find(x => inQuad(x[1], p)); return f ? f[0] : null;
}
/* view.rs:61-74 格线颜色 */
const planeColor = (g, pl) => pl === 'left' ? rgbOf(g.leftColor) : pl === 'right' ? rgbOf(g.rightColor) : pl === 'ground' ? rgbOf(g.groundColor) : PLANE_COLOR.none;
const lineColor = (g, pl) => planeColor(g, pl).concat([Math.round(clamp(g.opacity, 0, 100) * 2.55)]);

/* perspective.rs:326-358 ＋ define.rs:310-330 验证：回错误字串或 null */
function validate(g){
  if (![1, 2, 3].includes(g.kind)) return 'kind must be 1, 2 or 3';
  const nums = [g.origin[0], g.origin[1], g.horizon, g.vpLeft, g.vpRight, g.vpVertical[0], g.vpVertical[1], g.distance, g.cell, g.extent, g.height];
  if (nums.some(v => !fin(v) || Math.abs(v) > 4.0e6)) return 'grid values must be finite';
  if (g.distance <= 0 || g.cell <= 0 || g.extent <= 0 || g.height <= 0) return 'distance, cell, extent and height must be positive';
  if (Math.abs(g.origin[1] - g.horizon) < 1e-6) return 'ground level must differ from the horizon';
  const behind = p => { const a = axes(g, p); return !!a && 1 + offset(g, p) * axisCol(g, a[2])[2] <= 1e-9; };
  if (PLANES.some(p => !fin(offset(g, p)) || Math.abs(offset(g, p)) > MAX_DEPTH || behind(p))) return 'a plane is moved too far (behind the viewer)';
  if (g.angle != null && !(g.angle > 0 && g.angle < 90)) return 'the viewing angle must be between 0 and 90°';
  if (g.kind !== 1 && g.angle != null && g.vpRight <= g.vpLeft) return 'the right vanishing point must be right of the left one';
  if (!unitNamed(g.units)) return `unknown unit \`${g.units}\``;
  if (!(Array.isArray(g.scale) && g.scale.length === 2 && g.scale.every(s => fin(s) && s > 0 && s <= 1e6))) return 'scale must be two positive numbers [artboard, real world]';
  if (!(g.opacity >= 0 && g.opacity <= 100)) return 'opacity must be 0–100';
  if (g.extentRight != null && !(g.extentRight > 0 && g.extentRight <= MAX_LEN)) return 'extentRight must be positive';
  return null;
}
/* serde 反序列化那一步的型别检查（合法就就地正规化），回错误字串或 null */
function typeCheck(g){
  const isPt = v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number');
  if (!Number.isInteger(g.kind) || g.kind < 0 || g.kind > 255) return 'kind: invalid type';
  for (const k of ['horizon', 'vpLeft', 'vpRight', 'distance', 'cell', 'extent', 'height', 'opacity', 'leftOffset', 'rightOffset', 'groundOffset'])
    if (typeof g[k] !== 'number') return `${k}: invalid type`;
  for (const k of ['origin', 'vpVertical', 'scale']) if (!isPt(g[k])) return `${k}: invalid type`;
  for (const k of ['visible', 'locked', 'lockStation', 'snap', 'rulers']) if (typeof g[k] !== 'boolean') return `${k}: invalid type`;
  if (g.angle != null && typeof g.angle !== 'number') return 'angle: invalid type';
  if (g.extentRight != null && typeof g.extentRight !== 'number') return 'extentRight: invalid type';
  if (typeof g.name !== 'string' || typeof g.units !== 'string') return 'name/units: invalid type';
  const pl = planeParse(g.plane); if (!pl) return `unknown plane \`${g.plane}\``; g.plane = pl;
  for (const k of ['leftColor', 'rightColor', 'groundColor']){ const c = rgbParse(g[k]); if (!c) return `\`${g[k]}\` isn't a #rrggbb colour`; g[k] = c; }
  return null;
}
/* define.rs:296-307 reconcile：新视角／视距／类型绕旧站点移动消失点 */
function reconcile(g, old, patch){
  const has = k => patch && patch[k] !== undefined;
  const camera = has('angle') || (has('distance') && g.kind !== 1);
  if (!(has('vpLeft') || has('vpRight')) && (camera || g.kind !== old.kind)){
    const st = station(old);
    setStation(g, {x:st.x, distance:has('distance') ? g.distance : st.distance}, viewingAngle(g));
  }
  if (g.kind !== 1 && g.angle != null && g.vpRight > g.vpLeft) g.distance = station(g).distance;
}
/* perspective.rs:310-324 merged：把 patch 合进网格 → {g} 或 {err} */
function merged(g, patch){
  const n = clone(g);
  for (const k of Object.keys(patch || {})) if (k !== 'ids' && k !== 'attached' && FIELDS.includes(k)) n[k] = clone(patch[k]);
  const e = typeCheck(n); if (e) return {err:e};
  reconcile(n, g, patch || {});
  const v = validate(n); return v ? {err:v} : {g:n};
}

/* ═══════════ 定义网格栏位（define.rs:119-226、332-390） ═══════════ */
const ratio = d => unitOf(d.units).points * d.scale[0] / d.scale[1];
function definition(g){
  const d = {name:g.name, kind:g.kind, units:g.units, scale:g.scale.slice(), gridline:0, angle:viewingAngle(g), distance:0, horizonHeight:0, thirdVp:[0, 0],
    leftColor:g.leftColor, rightColor:g.rightColor, groundColor:g.groundColor, opacity:g.opacity};
  const r = ratio(d), st = station(g);
  d.gridline = g.cell / r; d.distance = st.distance / r; d.horizonHeight = (g.origin[1] - g.horizon) / r;
  d.thirdVp = [(g.vpVertical[0] - st.x) / r, (g.horizon - g.vpVertical[1]) / r];
  return d;
}
function defValidate(d){
  if (![1, 2, 3].includes(d.kind)) return 'kind must be 1, 2 or 3';
  if (!unitNamed(d.units)) return `unknown unit \`${d.units}\``;
  if (!(Array.isArray(d.scale) && d.scale.length === 2 && d.scale.every(s => fin(s) && s > 0 && s <= 1e6))) return 'scale must be two positive numbers [artboard, real world]';
  const r = ratio(d);
  if ([d.gridline, d.distance, d.horizonHeight, d.thirdVp[0], d.thirdVp[1]].some(v => !fin(v * r) || Math.abs(v * r) > MAX_LEN)) return 'grid lengths must be finite';
  if (d.gridline * r <= 0 || d.distance * r <= 0) return 'gridline spacing and viewing distance must be positive';
  if (Math.abs(d.horizonHeight * r) < 1e-6) return "the horizon height can't be 0";
  if (!(d.angle > 0 && d.angle < 90)) return 'the viewing angle must be between 0 and 90°';
  if (!(d.opacity >= 0 && d.opacity <= 100)) return 'opacity must be 0–100';
  return null;
}
const DEF_KEYS = ['name', 'kind', 'units', 'scale', 'gridline', 'angle', 'distance', 'horizonHeight', 'thirdVp', 'leftColor', 'rightColor', 'groundColor', 'opacity'];
/* GridDefinition::merged：只认定义栏位（别的键略过） → {d} 或 {err} */
function defMerged(d0, patch){
  const d = clone(d0);
  for (const k of Object.keys(patch || {})) if (DEF_KEYS.includes(k)) d[k] = clone(patch[k]);
  for (const k of ['kind', 'gridline', 'angle', 'distance', 'horizonHeight', 'opacity']) if (typeof d[k] !== 'number') return {err:`${k}: invalid type`};
  if (!Number.isInteger(d.kind)) return {err:'kind: invalid type'};
  if (typeof d.name !== 'string' || typeof d.units !== 'string') return {err:'name/units: invalid type'};
  for (const k of ['scale', 'thirdVp']) if (!(Array.isArray(d[k]) && d[k].length === 2 && d[k].every(x => typeof x === 'number'))) return {err:`${k}: invalid type`};
  for (const k of ['leftColor', 'rightColor', 'groundColor']){ const c = rgbParse(d[k]); if (!c) return {err:`\`${d[k]}\` isn't a #rrggbb colour`}; d[k] = c; }
  const u = unitNamed(d.units); if (!u) return {err:`unknown unit \`${d.units}\``};
  d.units = u.key;
  const e = defValidate(d); return e ? {err:e} : {d};
}
const nearR = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b), 1);
/* define.rs:214-225 same：同一个网格（名字不算、长度换成点比较） */
function defSame(a, o){
  const r = ratio(a), s = ratio(o);
  return a.kind === o.kind && nearR(a.gridline * r, o.gridline * s) && nearR(a.distance * r, o.distance * s) && nearR(a.horizonHeight * r, o.horizonHeight * s)
    && (a.kind !== 3 || (nearR(a.thirdVp[0] * r, o.thirdVp[0] * s) && nearR(a.thirdVp[1] * r, o.thirdVp[1] * s)))
    && (a.kind === 1 || nearR(a.angle, o.angle))
    && a.leftColor === o.leftColor && a.rightColor === o.rightColor && a.groundColor === o.groundColor && nearR(a.opacity, o.opacity);
}
/* define.rs:361-389 with_definition：只改跟现在不同的部分 → {g} 或 {err} */
function withDefinition(g0, def){
  const e = defValidate(def); if (e) return {err:e};
  const cur = definition(g0), r = ratio(def), cr = ratio(cur), g = clone(g0);
  g.name = def.name; g.units = unitOf(def.units).key; g.scale = def.scale.slice();
  g.leftColor = def.leftColor; g.rightColor = def.rightColor; g.groundColor = def.groundColor; g.opacity = def.opacity;
  g.kind = def.kind;
  if (!nearR(def.gridline * r, cur.gridline * cr)) g.cell = def.gridline * r;
  if (!nearR(def.horizonHeight * r, cur.horizonHeight * cr)) g.horizon = g.origin[1] - def.horizonHeight * r;
  if (def.kind !== g0.kind || !nearR(def.distance * r, cur.distance * cr) || (def.kind !== 1 && !nearR(def.angle, cur.angle))){
    const st = station(g0); setStation(g, {x:st.x, distance:def.distance * r}, def.angle);
  }
  if (!(nearR(def.thirdVp[0] * r, cur.thirdVp[0] * cr) && nearR(def.thirdVp[1] * r, cur.thirdVp[1] * cr)) || g.horizon !== g0.horizon){
    const x = station(g).x; g.vpVertical = [x + def.thirdVp[0] * r, g.horizon - def.thirdVp[1] * r];
  }
  const v = validate(g); return v ? {err:v} : {g};
}

/* ═══════════ 文件里的网格（distortcmds.rs:693-716、perspective.rs:237-298） ═══════════ */
function ab0(){ try { const a = R3.artboards && R3.artboards()[0]; if (a && a.rect) return clone(a.rect); } catch (e){} return {x0:0, y0:0, x1:Doc.width, y1:Doc.height}; }
/* 存的网格（缺栏位照 serde 缺省补；缺必要栏位＝没定义） */
function stored(){
  const v = Doc.aiR3 && Doc.aiR3[KEY]; if (!v || typeof v !== 'object') return null;
  const g = Object.assign(SERDE_DEF(), clone(v));
  if (['origin', 'horizon', 'vpLeft', 'vpRight', 'vpVertical', 'distance', 'cell', 'extent', 'height'].some(k => g[k] === undefined)) return null;
  if (typeCheck(g)) return null;
  delete g.attached;
  return g;
}
/* PerspectiveGrid::current：没定义过就用第一个画板的两点正常视图（隐藏） */
function current(){ return stored() || Object.assign(normal(2, ab0()), {visible:false}); }
const defined = () => !!stored();
/* 存进文件（附加纪录在物件上，网格本身不存 attached） */
function store(g){ if (!Doc.aiR3 || typeof Doc.aiR3 !== 'object') Doc.aiR3 = {}; const c = clone(g); delete c.attached; Doc.aiR3[KEY] = c; }
const sameGrid = (a, b) => JSON.stringify(FIELDS.map(k => a[k])) === JSON.stringify(FIELDS.map(k => b[k]));
const redraw = () => { if (window.UI && UI.draw) UI.draw(); };

/* ═══════════ 物件：形状（矢量层）与文字层 ═══════════ */
/* 目标：{kind:'shape', L, s} 或 {kind:'text', L}；id＝形状 id 或文字层 id */
const tid = t => t.kind === 'shape' ? t.s.id : t.L.id;
const owner = t => t.kind === 'shape' ? t.s : t.L.data;
function resolve(id){
  const L = Doc.byId && Doc.byId(id);
  if (L && L.kind === 'text') return {kind:'text', L};
  const h = R3.findDeep(id); return h ? {kind:'shape', L:h.L, s:h.s} : null;
}
/* roots：给 ids／id 用给的；否则用目前的选取（矢量层选中的顶层物件＋选中的文字物件） */
function rootsOf(p){
  const ids = Array.isArray(p.ids) ? p.ids : (p.id != null ? [p.id] : null);
  if (ids) return ids.map(resolve).filter(Boolean);
  const out = [];
  const L = VecSel.layer && VecSel.layer();
  if (L && L.kind === 'vector') for (const s of R3.roots(L)) out.push({kind:'shape', L, s});
  if (window.AiSel) for (const id of AiSel.text){ const T = Doc.byId(id); if (T && T.kind === 'text') out.push({kind:'text', L:T}); }
  return out;
}
/* perspective.rs:683-686 attachment */
function attachment(o){ const a = o && o.perspective; if (!a) return null; const pl = planeParse(a.plane); return pl && pl !== 'none' ? [pl, fin(a.depth) ? a.depth : 0] : null; }
const attachmentOf = t => attachment(owner(t));
/* perspective.rs:704-717 set_attachment／release */
function setAttachment(t, plane, depth){ const o = owner(t); const rec = o.perspective || (o.perspective = {}); rec.plane = plane; rec.depth = fin(depth) ? depth : 0; }
function releaseRec(t){ const o = owner(t), rec = o.perspective; if (rec && rec.projection) o.perspective = {projection:rec.projection}; else delete o.perspective; }
/* 编辑文字（Edit Text）进行中的文字层：session 状态，不进文件（原码 serde(skip) editing） */
const PS = {editing:null};
function projectionOf(L){
  const a = L && L.data && L.data.perspective; if (!a || !a.projection) return null;
  if (PS.editing && PS.editing.id === L.id && a.editing === PS.editing.token) return null;
  return Hm.fromArray(a.projection);
}
/* 文字层平的外框（文件坐标）：AiSel.textBounds 被我们包过，这里叫包之前那一支 */
let flatTextBounds = L => (window.AiSel && AiSel.textBounds) ? AiSel.textBounds(L) : null;
/* 几何外框（文件坐标；透视中的文字＝投影后的外框，node.projected） */
function geoBounds(t){
  if (t.kind === 'shape') return AIObj.shapeBounds(t.s, R3.docF(t.L), false);
  const b = flatTextBounds(t.L); if (!b) return null;
  const h = projectionOf(t.L); return h ? (Hm.mapRectBBox(h, b) || b) : b;
}
/* distort.rs:103-120 collect_points（文件坐标） */
function collectPoints(t){
  const out = [];
  if (t.kind === 'text'){ const b = geoBounds(t); if (b) out.push([b.x0, b.y0], [b.x1, b.y1]); return out; }
  const L = t.L;
  const go = s => {
    if ((s.type === 'group' && !s.live) || s.type === 'compound'){ (s.children || []).forEach(go); return; }
    const v = (R3.LEAF.includes(s.type)) ? VecSel.asBezier(s) : null;
    if (v && v.anchors){ for (const a of v.anchors){ const p = [a.x, a.y]; [p, a.in || p, a.out || p].forEach(q => out.push([q[0] + L.x, q[1] + L.y])); } return; }
    const b = AIObj.shapeBounds(s, R3.docF(L), false); if (b) out.push([b.x0, b.y0], [b.x1, b.y1]);
  };
  go(t.s);
  return out;
}
/* distort.rs:46-101 project_node／warp_node（图层坐标的点映射 f） */
function warpShape(s, f){
  const b = AIObj.shapeBounds(s, p => p, false);
  const eps = b ? Math.max(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.05, 0.5) : 0.5;
  const ctr = b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : null;
  const grads = m => { if (window.GradientFill && GradientFill.transform){ if (s.fill && typeof s.fill === 'object') GradientFill.transform(s.fill, m); if (s.stroke && typeof s.stroke === 'object') GradientFill.transform(s.stroke, m); } };
  if ((s.type === 'group' && !s.live) || s.type === 'compound'){            // 容器：往下套；容器自己的渐变（复合路径）跟着中心的近似仿射
    s.children.forEach(c => warpShape(c, f));
    if (ctr) grads(affineNear(f, ctr, eps));
    return;
  }
  if (R3.LEAF.includes(s.type) && VecSel.ensureBezier(null, s)){          // 路径：每个锚点与把手都映射；活形状变成一般路径（live = None）
    for (const a of s.anchors){
      const q = f([a.x, a.y]), hi = a.in ? f(a.in) : null, ho = a.out ? f(a.out) : null;
      a.x = q[0]; a.y = q[1]; a.in = hi; a.out = ho;
    }
    if (ctr) grads(affineNear(f, ctr, eps));
    return;
  }
  if (ctr) R3.xformDeep(s, affineNear(f, ctr, eps));                     // 其余（网格、活物件…）：中心处的仿射近似
}
/* distortcmds.rs:771-780 warp_checked：有点会越过地平线就失败 → null 或错误字串 */
function warpChecked(t, h){
  if (collectPoints(t).some(q => !Hm.apply(h, q))) return 'the object would cross the horizon of the perspective plane';
  if (t.kind === 'text'){
    const rec = t.L.data.perspective || (t.L.data.perspective = {});
    const had = (rec.projection && Hm.fromArray(rec.projection)) || Hm.I();
    rec.projection = Hm.toArray(Hm.then(h, had));
  } else {
    const L = t.L;
    warpShape(t.s, p => { const q = Hm.apply(h, [p[0] + L.x, p[1] + L.y]); return q ? [q[0] - L.x, q[1] - L.y] : p; });
  }
  Layer.invalidate(t.L);
  return null;
}
/* distortcmds.rs:784-792 attach_in */
function attachIn(g, t, plane, snap, map){
  const b = geoBounds(t); if (!b) return 'the object has no geometry';
  const m = map || attachHomography(g, plane, b, snap); if (!m) return "the object is beyond the plane's horizon";
  const e = warpChecked(t, m); if (e) return e;
  setAttachment(t, plane, offset(g, plane));
  return null;
}
function planeParam(g, p, C){
  let plane = g.plane;
  if (p.plane !== undefined){ plane = planeParse(p.plane); if (!plane) return {err:err(C, 'plane must be left|right|ground')}; }
  if (plane === 'none') return {err:err(C, 'no active perspective plane')};
  return {plane};
}
/* perspective.rs:689-701 attached_roots：所有透视中的物件（不在别的透视物件里面的） */
function attachedRoots(){
  const out = [];
  for (const L of Doc.layers){
    if (L.kind === 'vector'){
      const go = s => { const a = attachment(s); if (a) out.push({t:{kind:'shape', L, s}, plane:a[0], depth:a[1]}); else if (R3.isCont(s)) s.children.forEach(go); };
      L.data.shapes.forEach(go);
    } else if (L.kind === 'text'){ const a = attachment(L.data); if (a) out.push({t:{kind:'text', L}, plane:a[0], depth:a[1]}); }
  }
  return out;
}
/* perspective.rs:721-745 mapped_bounds：物件经 hi 映射后的外框（路径用映射后的曲线） */
function mappedBounds(t, hi){
  if (t.kind === 'text'){ const b = geoBounds(t); return b ? Hm.mapRectBBox(hi, b) : null; }
  const L = t.L; let acc = null, ok = true;
  const uni = b => { if (b) acc = acc ? {x0:Math.min(acc.x0, b.x0), y0:Math.min(acc.y0, b.y0), x1:Math.max(acc.x1, b.x1), y1:Math.max(acc.y1, b.y1)} : b; };
  const mp = q => { const r = Hm.apply(hi, [q[0] + L.x, q[1] + L.y]); if (!r){ ok = false; return [q[0] + L.x, q[1] + L.y]; } return r; };
  const go = s => {
    if ((s.type === 'group' && !s.live) || s.type === 'compound'){ s.children.forEach(go); return; }
    const v = R3.LEAF.includes(s.type) ? VecSel.asBezier(s) : null;
    if (v && v.anchors){
      const A = v.anchors.map(a => { const p = mp([a.x, a.y]); return {x:p[0], y:p[1], in:a.in ? mp(a.in) : null, out:a.out ? mp(a.out) : null}; });
      uni(AIObj.shapeBounds({type:'bezier', anchors:A, closed:v.closed}, q => q, false)); return;
    }
    const b = AIObj.shapeBounds(s, R3.docF(L), false); if (b){ const m = Hm.mapRectBBox(hi, b); if (m) uni(m); else ok = false; }
  };
  go(t.s);
  return ok ? acc : null;
}
/* perspective.rs:449-464 plane_bounds：第一个物件那个平面上的物件联集外框（平面坐标） */
function planeBounds(g, ts){
  let out = null;
  for (const t of ts){
    const a = attachmentOf(t); if (!a) continue;
    if (out && out.plane !== a[0]) continue;
    const h = homographyAt(g, a[0], a[1]), hi = h && Hm.inverse(h); if (!hi) continue;
    const b = mappedBounds(t, hi); if (!b) continue;
    out = out ? {plane:out.plane, depth:out.depth, rect:{x0:Math.min(out.rect.x0, b.x0), y0:Math.min(out.rect.y0, b.y0), x1:Math.max(out.rect.x1, b.x1), y1:Math.max(out.rect.y1, b.y1)}}
              : {plane:a[0], depth:a[1], rect:b};
  }
  return out;
}
/* 复制（Alt 拖曳）：形状复制一份放在原物件上面、新 id；文字层复制整层 */
function duplicate(t){
  if (t.kind === 'shape'){
    const h = R3.findDeep(t.s.id); const c = R3.reid(t.s); h.arr.splice(h.idx + 1, 0, c); Layer.invalidate(t.L); return {kind:'shape', L:t.L, s:c};
  }
  const r = CMD.map['layer.duplicate'] && CMD.map['layer.duplicate'].run({id:t.L.id});
  const nid = r && (r.id || r.layerId); const NL = nid ? Doc.byId(nid) : null;
  return NL && NL.kind === 'text' ? {kind:'text', L:NL} : null;
}
const jIds = ts => ts.map(tid);
const selectTargets = ts => {
  const sh = ts.filter(t => t.kind === 'shape'), tx = ts.filter(t => t.kind === 'text');
  if (sh.length) VecSel.setShapes(sh[0].L.id, sh.filter(t => t.L === sh[0].L).map(t => t.s.id));
  if (window.AiSel && tx.length) AiSel.text = tx.map(t => t.L.id);
};

/* ═══════════ 命令 ═══════════ */
const reg = (id, meta, fn) => CMD.reg(id, Object.assign({i18n:''}, meta), p => fn(p || {}));

/* distortcmds.rs:794-806 attach */
reg('ai.perspective.attach', {undoable:true, params:'{ids?:[形状 id 或文字层 id]（缺省＝目前选取：选中的物件＋选中的文字物件）, plane?: left|right|ground（缺省＝现用平面）} 对象 ▸ 透视 ▸ 附加到现用平面：把物件投影到平面上（外框左上与右下两角不动；路径的每个锚点与把手都映射、活形状变一般路径；文字保持文字、透过投影画）→ {ok, ids, plane}'}, p => {
  const C = 'ai.perspective.attach';
  const ts = rootsOf(p); if (!ts.length) return err(C, 'nothing selected');
  const g = current(); const pp = planeParam(g, p, C); if (pp.err) return pp.err;
  for (const t of ts){ const e = attachIn(g, t, pp.plane, false, null); if (e) return err(C, e); }
  store(g); redraw();
  return {ok:true, ids:jIds(ts), plane:pp.plane};
});
/* distortcmds.rs:808-822 release */
reg('ai.perspective.release', {undoable:true, params:'{ids?}（缺省＝目前选取）对象 ▸ 透视 ▸ 通过透视释放：物件脱离网格（几何不变；文字保留投影）→ {ok, ids}'}, p => {
  const C = 'ai.perspective.release';
  const ts = rootsOf(p); if (!ts.length) return err(C, 'nothing selected');
  const g = current();
  for (const t of ts){ releaseRec(t); Layer.invalidate(t.L); }
  store(g); redraw();
  return {ok:true, ids:jIds(ts)};
});
/* distortcmds.rs:744-748 plane.set（平面切换小部件；视图状态、不进历史） */
reg('ai.perspective.plane.set', {undoable:false, params:'{plane: left|right|ground|none} 现用透视平面（平面切换小部件；数字键 1 左、2 水平、3 右、4 无）。视图状态、不进历史 → {ok, plane}'}, p => {
  const plane = planeParse(p.plane); if (!plane) return err('ai.perspective.plane.set', 'plane must be left|right|ground|none');
  const g = current(); g.plane = plane; store(g); redraw();
  return {ok:true, plane};
});
/* distortcmds.rs:968-1011 plane.move */
reg('ai.perspective.plane.move', {undoable:true, params:'{plane?: left|right|ground（缺省＝现用平面）, offset?: 点（沿法线的位置；0＝网格定义的原位）| by?: 点, objects?: none|move|copy（缺省 none：平面上的物件留着；move：跟着平面走＝Shift 拖平面小部件；copy：复制品跟着走＝Alt 拖）} 移动平面 → {ok, plane, offset, ids}'}, p => {
  const C = 'ai.perspective.plane.move';
  const old = current(); const pp = planeParam(old, p, C); if (pp.err) return pp.err;
  const plane = pp.plane, from = offset(old, plane);
  let to;
  if (fin(p.offset)) to = p.offset; else if (fin(p.by)) to = from + p.by; else return err(C, 'give offset or by');
  const objects = p.objects == null ? 'none' : p.objects;
  if (!['none', 'move', 'copy'].includes(objects)) return err(C, 'objects must be none, move or copy');
  const g = clone(old); setOffset(g, plane, to);
  const v = validate(g); if (v) return err(C, v);
  let ids = [];
  if (objects !== 'none'){
    let on = attachedRoots().filter(r => r.plane === plane && Math.abs(r.depth - from) < 1e-6 && !(r.t.kind === 'shape' && r.t.s.locked)).map(r => r.t);
    if (objects === 'copy') on = on.map(duplicate).filter(Boolean);
    const m = transformMap(old, plane, from, [1, 0, 0, 1, 0, 0], to - from); if (!m) return err(C, "the pointer is beyond the plane's horizon");
    for (const t of on){ const e = warpChecked(t, m); if (e) return err(C, e); setAttachment(t, plane, to); }
    ids = jIds(on);
  }
  store(g); redraw();
  return {ok:true, plane, offset:to, ids};
});
/* distortcmds.rs:1013-1028 plane.matchObject */
reg('ai.perspective.plane.matchObject', {undoable:true, params:'{id?（缺省＝选取里的第一个物件）} 对象 ▸ 透视 ▸ 移动平面以匹配对象：把物件所附加的平面移到物件那里、并设成现用平面 → {ok, plane, offset}'}, p => {
  const C = 'ai.perspective.plane.matchObject';
  const t = p.id != null ? resolve(p.id) : rootsOf({})[0];
  if (!t) return err(C, 'select an object in perspective');
  const g = current(); const a = attachmentOf(t); if (!a) return err(C, "the object isn't in perspective");
  setOffset(g, a[0], a[1]); g.plane = a[0];
  const v = validate(g); if (v) return err(C, v);
  store(g); redraw();
  return {ok:true, plane:a[0], offset:a[1]};
});
/* distortcmds.rs:838-871 persp_edit：每个物件按自己的平面与深度做 step；不在透视里的先附加到 fallback */
function perspEdit(C, ts, fallback, copy, step){
  if (!ts.length) return {err:err(C, 'select the objects to transform in perspective')};
  const g = current();
  const targets = copy ? ts.map(duplicate).filter(Boolean) : ts;
  let first = null;
  for (const t of targets){
    let a = attachmentOf(t);
    if (!a){
      if (!fallback) return {err:err(C, "the object isn't on a perspective plane")};
      const e = attachIn(g, t, fallback, false, null); if (e) return {err:err(C, e)};
      a = [fallback, offset(g, fallback)];
    }
    if (!first) first = a;
    const r = step(g, a[0], a[1]); if (r.err) return {err:err(C, r.err)};
    const e = warpChecked(t, r.h); if (e) return {err:err(C, e)};
    setAttachment(t, a[0], r.depth);
  }
  store(g); if (copy) selectTargets(targets);
  return {targets, first};
}
const beyond = "the pointer is beyond the plane's horizon";
const pt2 = v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number') ? v : null;
/* perspgrid.rs:422-430 snap_fix */
function snapFix(ts, p, from, to){
  const g = current();
  if (!(p.snap === undefined ? g.snap : !!p.snap)) return null;
  const pb = planeBounds(g, ts); if (!pb) return null;
  const dv = planeDelta(g, pb.plane, pb.depth, from, to); if (!dv) return null;
  const so = snapOffset(g, pb.rect, dv);
  return {plane:pb.plane, depth:pb.depth, fix:[so[0] - dv[0], so[1] - dv[1]]};
}
PS.again = null;
/* distortcmds.rs:893-934 persp_move */
reg('ai.perspective.move', {undoable:true, params:'{ids?, from:[x,y], to:[x,y]（文件坐标）, plane?, copy?: bool（移动复制品＝Alt 拖）, perpendicular?: bool（沿平面法线移动＝拖曳时按 5）, snap?: bool（缺省＝视图 ▸ 透视网格 ▸ 对齐网格）} 在平面内滑动物件（没附加的先附加到 plane／现用平面）；吸附让联集外框较近的边在四分之一格内落到格线 → {ok, ids}'}, p => {
  const C = 'ai.perspective.move';
  const ts = rootsOf(p), from = pt2(p.from), to = pt2(p.to);
  if (!from) return err(C, 'missing from'); if (!to) return err(C, 'missing to');
  if (![...from, ...to].every(fin)) return err(C, 'from and to must be finite');
  const pp = planeParam(current(), p, C), fallback = pp.err ? null : pp.plane;
  const perp = !!p.perpendicular, copy = !!p.copy;
  const fx = perp ? null : snapFix(ts, p, from, to);
  const snapped = (pl, depth, dv) => (fx && fx.plane === pl && fx.depth === depth) ? [dv[0] + fx.fix[0], dv[1] + fx.fix[1]] : dv;
  const step = (g, pl, depth) => {
    if (perp){
      const td = depthAt(g, pl, depth, from, to); if (td == null) return {err:beyond};
      const h = transformMap(g, pl, depth, [1, 0, 0, 1, 0, 0], td - depth); return h ? {h, depth:td} : {err:beyond};
    }
    const d0 = planeDelta(g, pl, depth, from, to); if (!d0) return {err:beyond};
    const dv = snapped(pl, depth, d0), h = transformMap(g, pl, depth, Aff.translate(dv[0], dv[1]), 0);
    return h ? {h, depth} : {err:beyond};
  };
  const r = perspEdit(C, ts, fallback, copy, step); if (r.err) return r.err;
  if (r.first){
    const g = current(), [pl, depth] = r.first;
    if (perp){ const d = depthAt(g, pl, depth, from, to); if (d != null) PS.again = {matrix:[1, 0, 0, 1, 0, 0], depth:d - depth, copy}; }
    else { const dv = planeDelta(g, pl, depth, from, to); if (dv){ const s = snapped(pl, depth, dv); PS.again = {matrix:Aff.translate(s[0], s[1]), copy}; } }
  }
  redraw();
  return {ok:true, ids:jIds(r.targets)};
});
/* distortcmds.rs:936-956 persp_transform */
reg('ai.perspective.transform', {undoable:true, params:'{ids?, matrix:[a,b,c,d,e,f]（平面坐标里的仿射：u 沿平面、v 向上或向远）, depth?: 沿法线移动的点数（缺省 0）, copy?: bool, plane?} 在物件自己的平面内变换（透视选区工具的把手；没附加的先附加）→ {ok, ids}'}, p => {
  const C = 'ai.perspective.transform';
  const m = p.matrix, dz = p.depth === undefined ? 0 : p.depth;
  if (!(Array.isArray(m) && m.length === 6)) return err(C, 'missing matrix [a,b,c,d,e,f]');
  if (!m.every(fin) || Math.abs(Aff.det(m)) < 1e-12 || !fin(dz)) return err(C, 'matrix must be finite and invertible, depth finite');
  const ts = rootsOf(p), pp = planeParam(current(), p, C), fallback = pp.err ? null : pp.plane, copy = !!p.copy;
  const step = (g, pl, depth) => {
    const to = depth + dz; if (Math.abs(to) > MAX_DEPTH) return {err:'the objects would leave the grid'};
    const h = transformMap(g, pl, depth, m, dz); return h ? {h, depth:to} : {err:beyond};
  };
  const r = perspEdit(C, ts, fallback, copy, step); if (r.err) return r.err;
  PS.again = {matrix:m.slice(), depth:dz, copy};
  redraw();
  return {ok:true, ids:jIds(r.targets)};
});
/* distortcmds.rs:1050-1080 persp_draw：跑一条 shape.* 命令、把结果附加到平面（snap 时角落吸到格线）；整个手势一步历史 */
reg('ai.perspective.draw', {undoable:true, params:'{command: shape.* 命令 id, params:{…那条命令的参数}, plane?, snap?: bool（缺省＝对齐网格）, at?:[x,y]（点一下定尺寸的对话框：从这点起保留平面单位的尺寸）} 在透视中绘制 → {ok, id, plane}'}, p => {
  const C = 'ai.perspective.draw';
  const command = typeof p.command === 'string' && p.command.startsWith('shape.') ? p.command : null;
  if (!command || !CMD.map[command]) return err(C, 'command must be a shape.* command');
  const g = current(); const pp = planeParam(g, p, C); if (pp.err) return pp.err;
  const snap = p.snap === undefined ? g.snap : !!p.snap;
  let map = null;
  if (p.at !== undefined){ const at = pt2(p.at); map = at && sizeHomography(g, pp.plane, at, snap); if (!map) return err(C, beyond); }
  const r = CMD.map[command].run(clone(p.params || {}));               // 直接叫实作：不另推历史（一个手势一步）
  if (!r || r.ok === false || !r.id) return err(C, `${command} didn't create an object` + (r && r.error ? ' (' + r.error + ')' : ''));
  const t = resolve(r.id); if (!t) return err(C, `${command} didn't create an object`);
  const e = attachIn(g, t, pp.plane, snap, map); if (e) return err(C, e);
  store(g); redraw();
  return {ok:true, id:r.id, plane:pp.plane};
});
/* distortcmds.rs:1114-1141 editText：透视中的文字在画的地方摊平给人改；结束（Esc／取消选取）再投影回去 */
reg('ai.perspective.editText', {undoable:true, params:'{id?（文字层 id；缺省＝选中的文字）} 对象 ▸ 透视 ▸ 编辑文本：透视中的文字摊平显示在它画的位置上供编辑（文字工具、text.* 命令）；按 Esc 或取消选取（或 ai.perspective.editText.finish）就再投影回去 → {ok, id}'}, p => {
  const C = 'ai.perspective.editText';
  const id = p.id != null ? p.id : (window.AiSel && AiSel.text[0]);
  const L = id != null ? Doc.byId(id) : null;
  if (!L || L.kind !== 'text' || !projectionOf(L)) return err(C, 'select type in perspective');
  const h = projectionOf(L), flat = flatTextBounds(L), drawn = flat && Hm.mapRectBBox(h, flat);
  const tok = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (flat && drawn){
    // 平的文字搬到画的地方，投影往反方向搬，画面不变
    const dx = (drawn.x0 + drawn.x1) / 2 - (flat.x0 + flat.x1) / 2, dy = (drawn.y0 + drawn.y1) / 2 - (flat.y0 + flat.y1) / 2;
    L.data.x += dx; L.data.y += dy;
    if (L.data.box && typeof L.data.box === 'object'){ ['x', 'x0', 'x1'].forEach(k => { if (fin(L.data.box[k])) L.data.box[k] += dx; }); ['y', 'y0', 'y1'].forEach(k => { if (fin(L.data.box[k])) L.data.box[k] += dy; }); }
    L.data.perspective.projection = Hm.toArray(Hm.then(h, Hm.fromAffine(Aff.translate(-dx, -dy))));
  }
  L.data.perspective.editing = tok;
  PS.editing = {id:L.id, token:tok};
  Layer.invalidate(L);
  Doc.activeId = L.id;
  if (window.AiSel) AiSel.text = [L.id];
  if (window.VecSel) VecSel.clear();
  redraw();
  return {ok:true, id:L.id};
});
/* distortcmds.rs:1145-1165 finish_edit_text：再投影回去（不是一步历史） */
function finishEditText(){
  const e = PS.editing; if (!e) return false;
  PS.editing = null;
  const L = Doc.byId(e.id);
  if (L && L.data && L.data.perspective && L.data.perspective.editing === e.token) delete L.data.perspective.editing;
  if (L) Layer.invalidate(L);
  redraw();
  return true;
}
reg('ai.perspective.editText.finish', {undoable:false, params:'{} 结束「编辑文本」（＝退出隔离模式、Esc）：文字再投影回透视 → {ok, finished}'}, () => ({ok:true, finished:finishEditText()}));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PS.editing) finishEditText(); });

/* ═══════════ 渲染：透视中的文字透过投影画（逐像素反查平的那张，双线性取样） ═══════════ */
function warpCanvas(flat, P, scale, fb){
  const W = flat.width, H = flat.height;
  const S = [[scale, 0, 0], [0, scale, 0], [0, 0, 1]], Si = [[1 / scale, 0, 0], [0, 1 / scale, 0], [0, 0, 1]];
  const Ps = Hm.then(Hm.then(S, P), Si), inv = Hm.inverse(Ps);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  if (!inv || !fb) return out;
  const pad = 2, src = {x0:Math.max(0, Math.floor(fb.x0 * scale) - pad), y0:Math.max(0, Math.floor(fb.y0 * scale) - pad), x1:Math.min(W, Math.ceil(fb.x1 * scale) + pad), y1:Math.min(H, Math.ceil(fb.y1 * scale) + pad)};
  if (src.x1 <= src.x0 || src.y1 <= src.y0) return out;
  const db = Hm.mapRectBBox(Ps, src); if (!db) return out;
  const x0 = Math.max(0, Math.floor(db.x0)), y0 = Math.max(0, Math.floor(db.y0)), x1 = Math.min(W, Math.ceil(db.x1)), y1 = Math.min(H, Math.ceil(db.y1));
  if (x1 <= x0 || y1 <= y0) return out;
  const sw = src.x1 - src.x0, sh = src.y1 - src.y0;
  const sd = flat.getContext('2d').getImageData(src.x0, src.y0, sw, sh).data;
  const oc = out.getContext('2d'), img = oc.createImageData(x1 - x0, y1 - y0), od = img.data;
  const m = inv;
  for (let y = y0; y < y1; y++){
    for (let x = x0; x < x1; x++){
      const px = x + 0.5, py = y + 0.5, w = m[2][0] * px + m[2][1] * py + m[2][2]; if (!(w > 1e-9)) continue;
      const u = (m[0][0] * px + m[0][1] * py + m[0][2]) / w - 0.5 - src.x0, v = (m[1][0] * px + m[1][1] * py + m[1][2]) / w - 0.5 - src.y0;
      if (u < -1 || v < -1 || u > sw || v > sh) continue;
      const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv, o = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
      for (let c = 0; c < 4; c++){
        const at = (i, j) => (i < 0 || j < 0 || i >= sw || j >= sh) ? 0 : (c === 3 ? sd[(j * sw + i) * 4 + 3] : sd[(j * sw + i) * 4 + c] * sd[(j * sw + i) * 4 + 3]);
        od[o + c] = (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
      }
      const a = od[o + 3]; if (a > 0){ od[o] = od[o] / a; od[o + 1] = od[o + 1] / a; od[o + 2] = od[o + 2] / a; }   // 预乘取样再除回来，字边不发黑
    }
  }
  oc.putImageData(img, x0, y0);
  return out;
}
/* 只包一次：installHooks 会叫三回（载入当下、DOMContentLoaded、setTimeout），中间后载的档（ai-type）又在外面包了一层、
   最外层就看不到 __r3persp 记号 ⇒ 以前会再包一次，透视文字被投影两次（编辑文本／Esc 后画面全空）。改用本段自己的旗子 */
let hookedRL = false, hookedTB = false;
function installHooks(){
  /* renderLayer：透视中的文字层先叫前一支画平的，再透过投影扭过去（缓存照铁律③） */
  if (!hookedRL && typeof window.renderLayer === 'function' && !window.renderLayer.__r3persp){
    hookedRL = true;
    const prev = window.renderLayer;
    const w = function(L, scale){
      const P = (L && L.kind === 'text') ? projectionOf(L) : null;
      if (!P) return prev.apply(this, arguments);
      const key = JSON.stringify([L.data.perspective.projection, scale]);
      if (L._cache && L._cache === L._ppOut && L._ppKey === key && L._cacheScale === scale) return L._cache;
      if (L._cache === L._ppOut){ L._cache = null; L._cacheScale = 0; }
      const flat = prev.apply(this, arguments);
      const out = warpCanvas(flat, P, scale, flatTextBounds(L));
      L._cache = out; L._cacheScale = scale; L._ppOut = out; L._ppKey = key;
      return out;
    };
    w.__r3persp = true; w.toString = () => String(prev);
    window.renderLayer = w;
  }
  /* AiSel.textBounds：透视中的文字回投影后的外框（node.projected） */
  if (!hookedTB && window.AiSel && AiSel.textBounds && !AiSel.textBounds.__r3persp){
    hookedTB = true;
    const tb = AiSel.textBounds;
    flatTextBounds = L => tb.call(AiSel, L);
    const w = function(L){ const b = tb.apply(this, arguments); const h = projectionOf(L); return (h && b) ? (Hm.mapRectBBox(h, b) || b) : b; };
    w.__r3persp = true; AiSel.textBounds = w;
  }
}
installHooks();
document.addEventListener('DOMContentLoaded', () => setTimeout(installHooks, 0));
setTimeout(installHooks, 0);

/* 画布原点挪动（画板 0 改位置）：网格与文字的投影跟着平移（perspective.rs:886-894 translated） */
R3.onShift.push((dx, dy) => {
  const g = stored();
  if (g){ g.origin = [g.origin[0] + dx, g.origin[1] + dy]; g.horizon += dy; g.vpLeft += dx; g.vpRight += dx; g.vpVertical = [g.vpVertical[0] + dx, g.vpVertical[1] + dy]; store(g); }
  for (const L of Doc.layers){
    const a = L.kind === 'text' && L.data && L.data.perspective, h = a && a.projection && Hm.fromArray(a.projection);
    if (h){ const c = Hm.conjugated(h, Aff.translate(dx, dy)); if (c){ a.projection = Hm.toArray(c); Layer.invalidate(L); } }
  }
});

/* ── 三语（AI 2020 繁／简中介面）── */
Lang.add({
  'zh-Hant':{'ai3persp.define':'定義透視格點', 'ai3persp.save':'將格點儲存為預設集', 'ai3persp.name':'名稱：', 'ai3persp.preset':'預設集：', 'ai3persp.custom':'[自訂]',
    'ai3persp.settings':'透視格點設定', 'ai3persp.type':'類型：', 'ai3persp.units':'單位：', 'ai3persp.scale':'縮放：', 'ai3persp.scaleA':'工作區域：', 'ai3persp.scaleR':'真實世界：',
    'ai3persp.gridline':'格線間隔：', 'ai3persp.angle':'視角：', 'ai3persp.distance':'視距：', 'ai3persp.horizon':'水平高度：', 'ai3persp.vp3x':'第三個消失點 X：', 'ai3persp.vp3y':'第三個消失點 Y：',
    'ai3persp.colors':'格點顏色與不透明度', 'ai3persp.left':'左側格點：', 'ai3persp.right':'右側格點：', 'ai3persp.ground':'水平格點：', 'ai3persp.opacity':'不透明度：', 'ai3persp.savePreset':'儲存預設集…',
    'ai3persp.k1':'1 點透視', 'ai3persp.k2':'2 點透視', 'ai3persp.k3':'3 點透視', 'ai3persp.u.points':'點', 'ai3persp.u.picas':'派卡', 'ai3persp.u.inches':'英吋', 'ai3persp.u.millimeters':'公釐',
    'ai3persp.u.centimeters':'公分', 'ai3persp.u.pixels':'像素', 'ai3persp.u.meters':'公尺', 'ai3persp.u.yards':'碼', 'ai3persp.u.feet':'英呎', 'ai3persp.scaleCustom':'自訂'},
  'zh-Hans':{'ai3persp.define':'定义透视网格', 'ai3persp.save':'将网格存储为预设', 'ai3persp.name':'名称：', 'ai3persp.preset':'预设：', 'ai3persp.custom':'[自定]',
    'ai3persp.settings':'透视网格设置', 'ai3persp.type':'类型：', 'ai3persp.units':'单位：', 'ai3persp.scale':'缩放：', 'ai3persp.scaleA':'画板：', 'ai3persp.scaleR':'真实世界：',
    'ai3persp.gridline':'网格线间隔：', 'ai3persp.angle':'视角：', 'ai3persp.distance':'视距：', 'ai3persp.horizon':'水平高度：', 'ai3persp.vp3x':'第三个消失点 X：', 'ai3persp.vp3y':'第三个消失点 Y：',
    'ai3persp.colors':'网格颜色和不透明度', 'ai3persp.left':'左侧网格：', 'ai3persp.right':'右侧网格：', 'ai3persp.ground':'水平网格：', 'ai3persp.opacity':'不透明度：', 'ai3persp.savePreset':'存储预设…',
    'ai3persp.k1':'一点透视', 'ai3persp.k2':'两点透视', 'ai3persp.k3':'三点透视', 'ai3persp.u.points':'点', 'ai3persp.u.picas':'派卡', 'ai3persp.u.inches':'英寸', 'ai3persp.u.millimeters':'毫米',
    'ai3persp.u.centimeters':'厘米', 'ai3persp.u.pixels':'像素', 'ai3persp.u.meters':'米', 'ai3persp.u.yards':'码', 'ai3persp.u.feet':'英尺', 'ai3persp.scaleCustom':'自定'},
  en:{'ai3persp.define':'Define Perspective Grid', 'ai3persp.save':'Save Grid as Preset', 'ai3persp.name':'Name:', 'ai3persp.preset':'Preset:', 'ai3persp.custom':'[Custom]',
    'ai3persp.settings':'Perspective Grid Settings', 'ai3persp.type':'Type:', 'ai3persp.units':'Units:', 'ai3persp.scale':'Scale:', 'ai3persp.scaleA':'Artboard:', 'ai3persp.scaleR':'Real World:',
    'ai3persp.gridline':'Gridline every:', 'ai3persp.angle':'Viewing Angle:', 'ai3persp.distance':'Viewing Distance:', 'ai3persp.horizon':'Horizon Height:', 'ai3persp.vp3x':'Third Vanishing Point X:', 'ai3persp.vp3y':'Third Vanishing Point Y:',
    'ai3persp.colors':'Grid Color & Opacity', 'ai3persp.left':'Left Grid:', 'ai3persp.right':'Right Grid:', 'ai3persp.ground':'Horizontal Grid:', 'ai3persp.opacity':'Opacity:', 'ai3persp.savePreset':'Save Preset…',
    'ai3persp.k1':'One Point Perspective', 'ai3persp.k2':'Two Point Perspective', 'ai3persp.k3':'Three Point Perspective', 'ai3persp.u.points':'Points', 'ai3persp.u.picas':'Picas', 'ai3persp.u.inches':'Inches',
    'ai3persp.u.millimeters':'Millimeters', 'ai3persp.u.centimeters':'Centimeters', 'ai3persp.u.pixels':'Pixels', 'ai3persp.u.meters':'Meters', 'ai3persp.u.yards':'Yards', 'ai3persp.u.feet':'Feet', 'ai3persp.scaleCustom':'Custom'}
});

/* ── 匯出给视图段（透视网格菜单、叠画、对话框）与 agent ── */
window.AiPersp = {
  KEY, PLANES, PLANE_COLOR, BUILTINS, UNITS, LETTER, Hm, Aff, PS,
  unitNamed, unitOf, unitNumber, rgbParse, planeParse, isBuiltin,
  preset, builtin, normal, station, setStation, viewingAngle, foreshortening, axisCol, axes, offset, setOffset,
  homography, homographyAt, planeDelta, depthAt, transformMap, domain, rightExtent, snapPlane, snapOffset, attachHomography, sizeHomography,
  lines, planeWidgets, widgetAt, widgetHit, planeColor, lineColor, validate, merged, definition, defMerged, defValidate, defSame, withDefinition, ratio,
  ab0, stored, current, defined, store, sameGrid, attachedRoots, attachment, finishEditText, projectionOf, rootsOf, warpChecked,
  planeBounds, mappedBounds, attachmentOf
};
})();

/*flatten：对象 ▸ 拼合透明度… 与 对象 ▸ 增效工具 ▸ 安装增效工具…，照 vectorcraft 原码（vectorcraft/crates/）
   拼合透明度：
     engine/src/cmd/flatten.rs 1-1563     object.flattenTransparency（预设 109-252、flatten 254-269、预设命令 338-448、target_roots 452-471、
                                           plan 810-841、flatten_group 845-896、region_fill 900-934、render_raster 939-996、opaque 999-1013、apply 1039-1099、
                                           kept_work／stroked／overprints 1126-1163、plain 1178-1227、reach 1262-1272、overlapping 1275-1311、
                                           Builder 1362-1454、Composer 1472-1563）
     color/src/blend.rs 99-213            blend_rgb／composite（16 种混合模式，W3C／PDF 公式）
     doc/src/node.rs 945-1000、1093-1110  passes_knockout_through、blends_through、shows_transparency
     ui-egui/src/dialogs/flatten.rs 1-260  对话框：预设（改了显示 [Custom]）、存储预设…、栅格/矢量平衡、两个分辨率、六个勾选、预览（一开始关）
     ui-egui/src/menus.rs:298-301、993、1411  ui.flattenTransparencyDialog（有选取才亮）
     替代实作：
       · pathops::regions（linesweeper 平面图分割成原子区域）→ 本档 regions：照抄 AIObj.arrangement 的①②③（切段、精确算两侧各输入的绕数），
         再按「覆盖集合」分组接环；同一组覆盖集合的不相连碎块并成一个区域（颜色本来就一样），所以区域数会比原码少（栅格/矢量平衡的门槛照原码公式）。
         曲线先拉平成折线（AIObj.flatten），区域留折线（相邻区域共用同一组边，不会有缝）。
       · 描边轮廓化（outline_strokes）→ AIObj.strokePieces（圆角接合、圆头，跟画布上画的一样）
       · 影像（NodeKind::Image）：我们的矢量层没有 ⇒ 照原码建最小资料：{type:'group', live:'image', children:[看不见的四角辅助路径], image:{src(PNG dataURL), width, height}}，
         活物件链式渲染；移动／变换走编组路径（辅助路径跟着变换）。
       · 文字（文字层）不在矢量层里，「将所有文本转换为轮廓」对矢量层没有对象可转；CMYK 文档的分版合成没抄（我们文档只有 RGB 合成）。
       · 活物件（混合、封套、重复…）与有效果的物件当「没有单一颜色」的区域栅格化（原码先展开活物件，我们没有共用的展开函数）。
   增效工具：
     engine/src/cmd/plugin.rs 1-238       plugin.install／list／info／remove／run／reload
     plugins/src/runtime.rs 1-275         ABI v1：vc_abi_version／vc_manifest／vc_alloc／vc_run、(len<<32)|ptr、没有任何 host import
     plugins/src/manifest.rs 1-275        清单校验、参数说明 params_doc、resolve_params（缺省、夹范围、整数四舍五入、型别不对报错）
     plugins/src/objects.rs 1-594         filter_targets、encode、decode（坐标／颜色／色标夹范围）、apply_output（更新、删除、新物件插在前一个旁边）
     plugins/src/registry.rs 1-111        进程级登记（同 id 覆盖、serial）
     ui-egui/src/dialogs/plugin.rs 1-120  对象 ▸ 增效工具：已装的滤镜、分隔线、安装…、重新载入；有参数的滤镜开照清单生成的对话框（预览）
     ui-egui/src/io.rs:20-30、78-88       install_plugin：网页版开浏览器的选档框，读到的 .wasm 用 dataBase64 装
     替代实作：原码用 wasmi 解释器＋指令配额（fuel）；浏览器里用原生 WebAssembly，每次在新的 Web Worker 里开一个全新实例，
       指令配额改成墙钟时限（安装 10 秒、执行 60 秒，逾时 terminate 掉 worker），内存上限执行后检查（512 MiB）。
     plugin.reload 没抄：原码网页版（wasm32）plugin.rs:148-151 load_folder 回 "plug-in folders are not available on the web"，reload 在 :163-164 把它当错误回。 */
(function(){
'use strict';
if (window.__aiR3_flatten) return; window.__aiR3_flatten = true;
const R3 = window.AiR3, AO = window.AIObj;
const {clone, num, clamp, newId, isLeaf, isCont, painted, hasStroke, reg, regEdit, done} = R3;
const T = k => (window.Lang ? Lang.t(k) : k);
const err = (c, m) => ({ok:false, error:c + ': ' + m});
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dot = (a, b) => a[0]*b[0] + a[1]*b[1], cross = (a, b) => a[0]*b[1] - a[1]*b[0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), lerp = (a, b, t) => [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t];
const polyArea = P => { let a = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; };
const polyPerim = P => { let l = 0; for (let i = 0; i < P.length; i++) l += dist(P[i], P[(i + 1) % P.length]); return l; };
const unionR = (a, b) => !a ? b : !b ? a : {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)};
const inflate = (r, d) => r && {x0:r.x0 - d, y0:r.y0 - d, x1:r.x1 + d, y1:r.y1 + d};
const rectPoly = r => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
const invalidateAll = () => Doc.layers.forEach(L => { if (L.kind === 'vector') Layer.invalidate(L); });

/* ═════════════ 颜色：字串 ⇄ [r,g,b,a]（0..1） ═════════════ */
let _cx = null;
function rgba(c){
  if (typeof c !== 'string' || !painted(c)) return null;
  if (!_cx){ _cx = document.createElement('canvas').getContext('2d'); }
  _cx.fillStyle = '#000000'; _cx.fillStyle = c; const v = _cx.fillStyle;
  if (v[0] === '#') return [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
  const m = v.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const q = m[1].split(',').map(x => parseFloat(x)); return [q[0] / 255, q[1] / 255, q[2] / 255, q.length > 3 ? q[3] : 1];
}
const h2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
const hex = c => '#' + h2(c[0]) + h2(c[1]) + h2(c[2]);

/* ═════════════ 混合模式（color/src/blend.rs:99-213） ═════════════ */
const LUM = [0.3, 0.59, 0.11];
const lum = c => LUM[0]*c[0] + LUM[1]*c[1] + LUM[2]*c[2];
const sat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
const EPS = 1.1920929e-7;
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  if (n < 0) c = (l - n > EPS) ? c.map(v => l + (v - l) * l / (l - n)) : c.map(v => Math.max(v, 0));
  if (x > 1) c = (x - l > EPS) ? c.map(v => l + (v - l) * (1 - l) / (x - l)) : c.map(v => Math.min(v, 1));
  return c;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor(c.map(v => v + d)); };
const setSat = (c, s) => { const n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]); if (x <= n) return [0, 0, 0]; return c.map(v => (v - n) * s / (x - n)); };
const screen = (b, s) => b + s - b * s;
const hardLight = (b, s) => s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1);
const SEP = {
  normal:(b, s) => s, multiply:(b, s) => b * s, screen, overlay:(b, s) => hardLight(s, b), darken:Math.min, lighten:Math.max,
  colorDodge:(b, s) => b <= 0 ? 0 : s >= 1 ? 1 : Math.min(b / (1 - s), 1),
  colorBurn:(b, s) => b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min((1 - b) / s, 1),
  hardLight,
  softLight:(b, s) => { if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b); const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b); return b + (2 * s - 1) * (d - b); },
  difference:(b, s) => Math.abs(b - s), exclusion:(b, s) => b + s - 2 * b * s
};
function blendRgb(mode, b, s){
  const f = SEP[mode];
  if (f) return [0, 1, 2].map(i => f(clamp(b[i], 0, 1), clamp(s[i], 0, 1)));
  if (mode === 'hue') return setLum(setSat(s, sat(b)), lum(b));
  if (mode === 'saturation') return setLum(setSat(b, sat(s)), lum(b));
  if (mode === 'color') return setLum(s, lum(b));
  if (mode === 'luminosity') return setLum(b, lum(s));
  return s.slice(0, 3);
}
/* blend.rs:151 composite：直通（非预乘）RGBA */
function composite(mode, bd, src){
  const ab = clamp(bd[3], 0, 1), as = clamp(src[3], 0, 1), ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const mixed = blendRgb(mode, bd, src);
  const c = i => ((1 - ab) * src[i] + ab * mixed[i]) * as + (1 - as) * ab * bd[i];
  return [c(0) / ao, c(1) / ao, c(2) / ao, ao];
}

/* ═════════════ 拼合器选项与预设（flatten.rs:109-252、338-448） ═════════════ */
const PRESETS = ['high', 'medium', 'low'];
const PLABEL = {high:'High Resolution', medium:'Medium Resolution', low:'Low Resolution'};
const NUM_KEYS = ['balance', 'lineArtPpi', 'gradientPpi'];
const BOOL_KEYS = ['textToOutlines', 'strokesToOutlines', 'clipComplexRegions', 'antiAlias', 'preserveAlpha', 'preserveOverprints'];
const OPT_KEYS = NUM_KEYS.concat(BOOL_KEYS);
function builtin(id){
  const [balance, lineArtPpi, gradientPpi, clipComplexRegions, antiAlias] =
    id === 'high' ? [100, 1200, 300, true, false] : id === 'medium' ? [75, 300, 300, false, true] : [75, 300, 150, false, true];
  return {balance, lineArtPpi, gradientPpi, textToOutlines:false, strokesToOutlines:false, clipComplexRegions, antiAlias, preserveAlpha:false, preserveOverprints:true};
}
/* 存的预设＝原码 prefs.flattener_presets；我们放 localStorage（跟偏好一样跨文件） */
const STORE = 'dilin.ai.flattenerPresets';
const Saved = {
  list:null,
  get(){ if (!this.list){ try { this.list = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e){ this.list = []; } if (!Array.isArray(this.list)) this.list = []; } return this.list; },
  put(){ try { localStorage.setItem(STORE, JSON.stringify(this.list || [])); } catch (e){} }
};
function presetById(name){ const key = String(name).trim().toLowerCase(); const id = PRESETS.find(i => key === i || PLABEL[i].toLowerCase() === key); return id ? builtin(id) : null; }
const savedIndex = name => Saved.get().findIndex(q => q.name.toLowerCase() === String(name).trim().toLowerCase());
function findPreset(name){ const b = presetById(name); if (b) return b; const i = savedIndex(name); return i >= 0 ? Object.assign(builtin('medium'), clone(Saved.get()[i].options)) : null; }
function allPresets(){ return PRESETS.map(id => ({name:PLABEL[id], builtIn:true, options:builtin(id)})).concat(Saved.get().map(q => ({name:q.name, builtIn:false, options:Object.assign(builtin('medium'), clone(q.options))}))); }
/* from_params_with（flatten.rs:219）：preset 打底，顶层或 options 里的选项盖上去；型别不对、范围不对报错 */
function fromParams(p){
  let o;
  if (p.preset !== undefined && p.preset !== null){ o = findPreset(p.preset); if (!o) throw new Error(`unknown preset \`${p.preset}\` (high, medium, low or a saved one: see flattener.presets.list)`); }
  else o = builtin('medium');
  for (const src of [p, p.options]){
    if (!src || typeof src !== 'object') continue;
    for (const k of OPT_KEYS){
      if (src[k] === undefined) continue;
      const v = src[k];
      if (NUM_KEYS.includes(k)){ if (typeof v !== 'number' || !isFinite(v)) throw new Error(`invalid type: \`${k}\` must be a number`); }
      else if (typeof v !== 'boolean') throw new Error(`invalid type: \`${k}\` must be true or false`);
      o[k] = v;
    }
  }
  if (!(o.balance >= 0 && o.balance <= 100)) throw new Error('balance must be between 0 and 100');
  if (![o.lineArtPpi, o.gradientPpi].every(r => r >= 1 && r <= 2400)) throw new Error('resolutions must be between 1 and 2400 ppi');
  return o;
}
/* rasterize_all（flatten.rs:249） */
const rasterizeAll = (o, n) => o.balance <= 0 || (o.balance < 100 && n > Math.pow(10, o.balance / 20));
const sameOpts = (a, b) => OPT_KEYS.every(k => a[k] === b[k]);
function newPresetName(){ for (let i = 1; ; i++){ const n = 'Flattener Preset ' + i; if (!presetById(n) && savedIndex(n) < 0) return n; } }

reg('ai.flattener.presets.list', {params:'{} 照 flattener.presets.list（flatten.rs:338）：内建三个预设（高／中／低分辨率），再接存过的 → {ok, presets:[{name, builtIn, options}]}'},
  () => ({ok:true, presets:allPresets()}));
reg('ai.flattener.presets.save', {params:'{name?: 缺省＝新的「Flattener Preset N」, newName?: 改名, preset?: 从哪个预设开始（缺省＝存过的同名预设，否则中分辨率）, …选项（object.flattenTransparency 的键，顶层或 options 里）} 照 flattener.presets.save（flatten.rs:347）：新建或改一个存的预设（内建的不能改）→ {ok, name, options, created}'}, p => {
  const C = 'ai.flattener.presets.save';
  let name = p.name === undefined ? newPresetName() : String(p.name).trim();
  if (!name) return err(C, '`name` is empty');
  if (presetById(name)) return err(C, `\`${name}\` is a built-in preset and can't change: save it under another name`);
  const at = savedIndex(name), q = Object.assign({}, p);
  if (at >= 0 && p.preset === undefined) q.preset = Saved.get()[at].name;
  let options; try { options = fromParams(q); } catch (e){ return err(C, e.message); }
  if (p.newName !== undefined){
    const n = String(p.newName).trim(); if (!n) return err(C, '`newName` is empty');
    if (presetById(n) || (savedIndex(n) >= 0 && savedIndex(n) !== at)) return err(C, `a preset named \`${n}\` exists`);
    name = n;
  } else if (at >= 0) name = Saved.get()[at].name;
  const preset = {name, options:clone(options)};
  if (at >= 0) Saved.get()[at] = preset; else Saved.get().push(preset);
  Saved.put();
  return {ok:true, name, options, created:at < 0};
});
reg('ai.flattener.presets.delete', {params:'{name} 照 flattener.presets.delete（flatten.rs:378）：删一个存的预设（内建的留着）→ {ok, deleted}'}, p => {
  const C = 'ai.flattener.presets.delete';
  if (p.name === undefined) return err(C, 'missing `name`');
  if (presetById(p.name)) return err(C, `\`${p.name}\` is a built-in preset and stays`);
  const i = savedIndex(p.name); if (i < 0) return err(C, `no saved preset named \`${p.name}\``);
  const d = Saved.get().splice(i, 1)[0]; Saved.put();
  return {ok:true, deleted:d.name};
});

/* ═════════════ 平面图分割成原子区域（pathops::regions 的替代，见档头） ═════════════
   sets=[{polys, rule}] → [{loops:[[x,y]…][], sources:[集合序号…（递增）]}]：每个区域里各点被同一组集合覆盖 */
function regions(sets){
  const E = [];
  sets.forEach((S, si) => S.polys.forEach(P => { for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if (dist(a, b) > 1e-12) E.push({a, b, s:si}); } }));
  if (!E.length) return [];
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  E.forEach(e => { e.x0 = Math.min(e.a[0], e.b[0]); e.x1 = Math.max(e.a[0], e.b[0]); e.y0 = Math.min(e.a[1], e.b[1]); e.y1 = Math.max(e.a[1], e.b[1]);
                   X0 = Math.min(X0, e.x0); X1 = Math.max(X1, e.x1); Y0 = Math.min(Y0, e.y0); Y1 = Math.max(Y1, e.y1); });
  const scale = Math.max(1, X1 - X0, Y1 - Y0), ET = 1e-9 * scale;
  // ① 两两求交、记下切点参数（同 AIObj.arrangement）
  const cuts = E.map(() => [0, 1]);
  const ord = E.map((_, i) => i).sort((i, j) => E[i].x0 - E[j].x0);
  for (let oi = 0; oi < ord.length; oi++){
    const i = ord[oi], e = E[i];
    for (let oj = oi + 1; oj < ord.length; oj++){
      const j = ord[oj], f = E[j];
      if (f.x0 > e.x1 + ET) break;
      if (f.y0 > e.y1 + ET || f.y1 < e.y0 - ET) continue;
      const r = sub(e.b, e.a), s = sub(f.b, f.a), qp = sub(f.a, e.a), den = cross(r, s);
      const lr = Math.hypot(r[0], r[1]), ls = Math.hypot(s[0], s[1]);
      if (Math.abs(den) <= 1e-12 * lr * ls){
        if (Math.abs(cross(qp, r)) / lr > ET) continue;
        const rr = dot(r, r), ss = dot(s, s);
        [f.a, f.b].forEach(q => { const t = dot(sub(q, e.a), r) / rr; if (t > 1e-12 && t < 1 - 1e-12) cuts[i].push(t); });
        [e.a, e.b].forEach(q => { const u = dot(sub(q, f.a), s) / ss; if (u > 1e-12 && u < 1 - 1e-12) cuts[j].push(u); });
        continue;
      }
      const t = cross(qp, s) / den, u = cross(qp, r) / den, tt = ET / lr, tu = ET / ls;
      if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) continue;
      cuts[i].push(clamp(t, 0, 1)); cuts[j].push(clamp(u, 0, 1));
    }
  }
  // ② 切成小段、顶点合并
  const V = [], grid = new Map(), G = Math.max(1e-7 * scale, 1e-9);
  const vid = p => {
    const gx = Math.round(p[0] / G), gy = Math.round(p[1] / G);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
      const L = grid.get((gx + dx) + ',' + (gy + dy)); if (L) for (const k of L) if (dist(V[k], p) <= 1.5 * G) return k;
    }
    V.push(p); const key = gx + ',' + gy; (grid.get(key) || grid.set(key, []).get(key)).push(V.length - 1); return V.length - 1;
  };
  const pieces = [], seen = new Set();
  E.forEach((e, i) => {
    const ts = cuts[i].sort((x, y) => x - y);
    let prev = vid(e.a);
    for (let k = 1; k < ts.length; k++){
      if (ts[k] - ts[k - 1] < 1e-12 && k < ts.length - 1) continue;
      const v = k === ts.length - 1 ? vid(e.b) : vid(lerp(e.a, e.b, ts[k]));
      if (v !== prev){ const key = Math.min(prev, v) + '_' + Math.max(prev, v); if (!seen.has(key)){ seen.add(key); pieces.push([prev, v]); } }
      prev = v;
    }
  });
  // ③ 每段两侧各集合的覆盖（精确算绕数，同 AIObj.arrangement）
  const NB = Math.max(1, Math.min(1024, Math.ceil(E.length / 4)));
  const mkBuckets = (lo, hi, k0, k1) => { const w = (hi - lo) / NB || 1, B = Array.from({length:NB}, () => []);
    E.forEach(e => { const b0 = clamp(Math.floor((e[k0] - lo) / w), 0, NB - 1), b1 = clamp(Math.floor((e[k1] - lo) / w), 0, NB - 1); for (let b = b0; b <= b1; b++) B[b].push(e); });
    return v => B[clamp(Math.floor((v - lo) / w), 0, NB - 1)]; };
  const byY = mkBuckets(Y0, Y1, 'y0', 'y1'), byX = mkBuckets(X0, X1, 'x0', 'x1');
  const tolL = 1e-9 * scale;
  const sides = (a, b, nrm) => {
    const m = lerp(a, b, 0.5), horiz = Math.abs(nrm[0]) >= Math.abs(nrm[1]);
    const r = horiz ? [Math.sign(nrm[0]), 0] : [0, Math.sign(nrm[1])], rv = [-r[1], r[0]];
    const base = sets.map(() => 0), cont = sets.map(() => 0);
    for (const e of (horiz ? byY(m[1]) : byX(m[0]))){
      const ed = sub(e.b, e.a), el = Math.hypot(ed[0], ed[1]);
      const sg = cross(r, ed) > 0 ? 1 : -1;
      if (Math.abs(cross(ed, sub(a, e.a))) / el <= tolL && Math.abs(cross(ed, sub(b, e.a))) / el <= tolL){
        const ta = dot(sub(a, e.a), ed) / (el * el), tb = dot(sub(b, e.a), ed) / (el * el);
        if (Math.min(ta, tb) >= -1e-9 && Math.max(ta, tb) <= 1 + 1e-9) cont[e.s] += sg;
        continue;
      }
      const av = dot(sub(e.a, m), rv), bv = dot(sub(e.b, m), rv);
      if ((av <= 0) === (bv <= 0)) continue;
      const au = dot(sub(e.a, m), r), bu = dot(sub(e.b, m), r), u = au + (0 - av) / (bv - av) * (bu - au);
      if (u > 0) base[e.s] += sg;
    }
    const ins = w => w.map((x, i) => sets[i].rule === 'evenodd' ? (x % 2 !== 0) : x !== 0);
    return [ins(base), ins(base.map((x, i) => x + cont[i]))];
  };
  const key = m => m.map(x => x ? 1 : 0).join('');
  const sided = [], masks = new Map();
  for (const [va, vb] of pieces){
    const a = V[va], b = V[vb], d = sub(b, a), len = Math.hypot(d[0], d[1]); if (len < 1e-12) continue;
    const [mA, mB] = sides(a, b, [-d[1] / len, d[0] / len]), kA = key(mA), kB = key(mB);
    if (kA === kB) continue;
    sided.push({va, vb, kA, kB});
    [[kA, mA], [kB, mB]].forEach(([k, m]) => { if (m.some(Boolean) && !masks.has(k)) masks.set(k, m); });
  }
  // ④⑤ 每个覆盖集合：留下「一侧是它、另一侧不是」的段，转成里面在左法向那一侧，接成环
  const out = [];
  for (const [K, mask] of masks){
    const keep = [], from = new Map(), used = new Set();
    for (const s of sided){
      const iA = s.kA === K, iB = s.kB === K; if (iA === iB) continue;
      const k = keep.length; keep.push(iA ? [s.va, s.vb] : [s.vb, s.va]);
      (from.get(keep[k][0]) || from.set(keep[k][0], []).get(keep[k][0])).push(k);
    }
    const loops = [];
    for (let k0 = 0; k0 < keep.length; k0++){
      if (used.has(k0)) continue;
      const loop = []; let k = k0, guard = keep.length + 5;
      while (k !== undefined && !used.has(k) && guard--){
        used.add(k); loop.push(V[keep[k][0]]);
        const end = keep[k][1]; if (end === keep[k0][0]) break;
        const cand = (from.get(end) || []).filter(x => !used.has(x));
        if (cand.length <= 1){ k = cand[0]; continue; }
        const din = sub(V[end], V[keep[k][0]]);
        let best = null, ba = -Infinity;
        for (const c of cand){ const dd = sub(V[keep[c][1]], V[end]), ang = Math.atan2(cross(din, dd), dot(din, dd)); if (ang > ba){ ba = ang; best = c; } }
        k = best;
      }
      const P = [];
      for (let i = 0; i < loop.length; i++){
        const p = loop[i], a = P.length ? P[P.length - 1] : loop[loop.length - 1], b = loop[(i + 1) % loop.length];
        if (Math.abs(cross(sub(p, a), sub(b, p))) <= 1e-12 * scale * scale && dot(sub(p, a), sub(b, p)) > 0) continue;
        P.push(p);
      }
      if (P.length >= 3 && 2 * Math.abs(polyArea(P)) / polyPerim(P) >= 0.01) loops.push(P);
    }
    if (loops.length) out.push({loops, sources:mask.map((x, i) => x ? i : -1).filter(i => i >= 0)});
  }
  return out;
}
const loopsBounds = loops => loops.reduce((r, P) => P.reduce((q, p) => unionR(q, {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}), r), null);
/* po::area(po::boolean(a ∩ b))：两组环交集的面积 */
function interArea(a, b){
  const L = AO.arrangement([{polys:a, rule:'nonzero'}, {polys:b, rule:'nonzero'}], m => m[0] && m[1]);
  return L.reduce((s, P) => s + Math.abs(polyArea(P)), 0);
}

/* ═════════════ 物件的透明度性质（doc/src/node.rs） ═════════════ */
const visFx = s => Array.isArray(s.effects) && s.effects.some(e => e && e.visible !== false);
const opOf = s => (typeof s.opacity === 'number') ? clamp(s.opacity, 0, 1) : 1;
const blendOf = s => (s.blend && SEP[s.blend] !== undefined) || ['hue', 'saturation', 'color', 'luminosity'].includes(s && s.blend) ? s.blend : 'normal';
const isGrad = p => !!p && typeof p === 'object';
const gradSeeThrough = p => isGrad(p) && Array.isArray(p.stops) && p.stops.some(q => q.opacity !== undefined && q.opacity < 1);
const colorSeeThrough = p => typeof p === 'string' && painted(p) && (rgba(p) || [0, 0, 0, 1])[3] < 1;
/* shows_transparency（node.rs:1093）：物件或里面任何东西有不透明度 < 100%、混合模式、效果、半透明色标（我们的颜色字串带 alpha＝填色／描边的不透明度） */
function showsTransparency(s){
  if (!s || s.visible === false) return false;
  if (opOf(s) < 1 || blendOf(s) !== 'normal' || visFx(s)) return true;
  if (painted(s.fill) && (gradSeeThrough(s.fill) || colorSeeThrough(s.fill))) return true;
  if (hasStroke(s) && (gradSeeThrough(s.stroke) || colorSeeThrough(s.stroke))) return true;
  return isCont(s) && s.type !== 'compound' ? s.children.some(showsTransparency) : false;
}
/* blends_through（node.rs:987）：里面有不是正常的混合模式，而且一路没被隔离挡住 */
function blendsThrough(s){
  if (s.type === 'group' && Array.isArray(s.children)) return s.children.some(c => c.visible !== false && (blendOf(c) !== 'normal' || (!c.isolate && blendsThrough(c))));
  return false;     // 叶子：我们的填色／描边没有自己的混合模式
}
/* reach（flatten.rs:1262）：可见外框（编组＝成员的联集，剪切组／复合路径用自己的）＋效果外扩＋1 */
function reach(s){
  if (!s || s.visible === false) return null;
  let b;
  if (s.type === 'group' && !s.clip && !s.live) b = s.children.map(reach).reduce(unionR, null);
  else b = AO.shapeBounds(s, p => p, true);
  if (!b) return null;
  if (visFx(s)) b = unionR(b, fxReach(s, b));
  return inflate(b, 1);
}
/* effects::outset 的替代：有效果的物件画一次，量出像素实际盖到哪里 */
function fxReach(s, b){
  const m = Math.max(64, (b.x1 - b.x0) + (b.y1 - b.y0)), k = Math.min(1, 1500 / Math.max(b.x1 - b.x0 + 2 * m, b.y1 - b.y0 + 2 * m));
  const W = Math.ceil((b.x1 - b.x0 + 2 * m) * k), H = Math.ceil((b.y1 - b.y0 + 2 * m) * k);
  const c = document.createElement('canvas'); c.width = Math.max(1, W); c.height = Math.max(1, H);
  const x = c.getContext('2d'); x.translate(-(b.x0 - m) * k, -(b.y0 - m) * k);
  try { window.drawShape(x, s, k); } catch (e){ return b; }
  const d = x.getImageData(0, 0, c.width, c.height).data; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) if (d[(j * c.width + i) * 4 + 3]){ if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x0 === Infinity) return b;
  return {x0:(b.x0 - m) + x0 / k, y0:(b.y0 - m) + y0 / k, x1:(b.x0 - m) + (x1 + 1) / k, y1:(b.y0 - m) + (y1 + 1) / k};
}
/* overlapping（flatten.rs:1275）：外框（递移地）重叠的分成一组 */
function overlapping(bounds){
  const parent = bounds.map((_, i) => i);
  const find = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const order = bounds.map((b, i) => [i, b]).filter(x => x[1]).sort((a, b) => a[1].x0 - b[1].x0);
  let open = [];
  for (const [i, b] of order){
    open = open.filter(([, o]) => o.x1 >= b.x0);
    for (const [j, o] of open) if (o.y0 <= b.y1 && b.y0 <= o.y1){ const a = find(i), c = find(j); parent[Math.max(a, c)] = Math.min(a, c); }
    open.push([i, b]);
  }
  const groups = [], slot = new Map();
  for (let i = 0; i < bounds.length; i++){ const r = find(i); if (slot.has(r)) groups[slot.get(r)].push(i); else { slot.set(r, groups.length); groups.push([i]); } }
  return groups;
}

/* ═════════════ 合成器的物件（Builder，flatten.rs:1362-1454；plain 1178 的描边轮廓化并在这里） ═════════════ */
const FILL_TOL = 0.05;
const fillPolys = s => R3.subviews(s).map(v => AO.flatten(v, FILL_TOL)).filter(P => P.length >= 2);
const ruleOf = s => (s.type === 'compound' ? (s.rule === 'evenodd' ? 'evenodd' : 'nonzero') : (s.fillRule === 'evenOdd' ? 'evenodd' : 'nonzero'));
const JOIN = {miter:'miter', round:'round', bevel:'bevel'}, CAP = {butt:'butt', round:'round', square:'square', projecting:'square'};
function strokePolys(s){
  const out = [], join = JOIN[s.join] || 'round', cap = CAP[s.cap] || 'round', ml = +s.miterLimit || 10;
  for (const v of R3.subviews(s)) if (v.anchors.length > 1) out.push(...AO.strokePieces(AO.flatten(v, FILL_TOL), !!v.closed, s.strokeWidth, join, cap, ml));
  return out;
}
class Builder {
  constructor(){ this.shapes = []; this.kinds = []; }
  shape(polys, rule, kind){ if (!polys || !polys.length) return null; this.shapes.push({polys, rule}); this.kinds.push(kind); return this.shapes.length - 1; }
  rectShape(s, kind){ const r = reach(s); return r ? this.shape([rectPoly(r)], 'nonzero', kind) : null; }
  /* 一个填色项（实色＝合成用、渐变＝只占一个区域形状） */
  paintElem(polys, rule, paint, overprint){
    if (!painted(paint)) return this.wrap({}, {kind:'complex'});
    if (isGrad(paint)){ this.shape(polys, rule, 'gradient'); return this.wrap({}, {kind:'complex'}); }
    const c = rgba(paint); if (!c) return this.wrap({}, {kind:'complex'});
    const sh = this.shape(polys, rule, 'vector'); if (sh === null) return null;
    return this.wrap({}, {kind:'fills', shape:sh, fills:[{planes:[c[0], c[1], c[2]], opacity:c[3], blend:'normal', paint, overprint:!!overprint}]});
  }
  wrap(n, body){
    return {opacity:opOf(n), blend:blendOf(n), isolate:!!n.isolate, knockout:n.knockout || 'neutral', knockoutShape:!!n.knockoutShape,
            blends:blendsThrough(n), passThrough:!!n.passThrough, body};
  }
  elem(n){
    if (!n || n.visible === false) return null;
    let body;
    if (visFx(n) || n.live || n.type === 'mesh'){          // 有效果／活物件（见档头）／渐变网格：没有单一颜色
      if (this.rectShape(n, n.type === 'mesh' ? 'gradient' : 'other') === null) return null;
      body = {kind:'complex'};
    } else if (n.type === 'group'){
      let clip = null, rest = n.children;
      if (n.clip){
        const first = n.children[0]; if (!first) return null;
        const polys = first.type === 'group' ? R3.leavesOf(first).flatMap(fillPolys) : fillPolys(first);
        clip = this.shape(polys, ruleOf(first), 'vector'); if (clip === null) return null;     // 没东西可剪＝被剪的都看不见
        rest = n.children.slice(1);
      }
      body = {kind:'group', clip, children:rest.map(c => this.elem(c)).filter(Boolean)};
      const e = this.wrap(n, body);
      e.passThrough = !n.clip && opOf(n) >= 1 && blendOf(n) === 'normal' && !n.isolate && (n.knockout || 'neutral') === 'neutral' && !visFx(n);
      return e;
    } else if (isLeaf(n) || n.type === 'compound'){
      if (n.guide) return null;
      const polys = fillPolys(n), rule = ruleOf(n);
      const fillE = this.paintElem(polys, rule, n.fill, n.overprintFill);
      if (hasStroke(n)){                                     // plain：描边轮廓化，填色与描边成一个编组，带着物件的透明度（片与片不互相挖空）
        const strokeE = this.paintElem(strokePolys(n), 'nonzero', n.stroke, n.overprintStroke);
        const e = this.wrap(n, {kind:'group', clip:null, children:[fillE, strokeE].filter(Boolean)});
        e.knockout = 'off'; return e;
      }
      if (!fillE) return null;
      return Object.assign(fillE, {opacity:opOf(n), blend:blendOf(n)});
    } else {
      if (this.rectShape(n, 'other') === null) return null;
      body = {kind:'complex'};
    }
    return this.wrap(n, body);
  }
}

/* ═════════════ 合成器（Composer，flatten.rs:1472-1563）：一个原子区域里的颜色＝照渲染器的合成规则算一次 ═════════════ */
const CLEAR = [0, 0, 0, 0], WHITE = [1, 1, 1, 1];
const premul = p => [p[0] * p[3], p[1] * p[3], p[2] * p[3], p[3]];
const unpremul = q => q[3] <= 0 ? CLEAR.slice() : [q[0] / q[3], q[1] / q[3], q[2] / q[3], Math.min(q[3], 1)];
const koResolve = (k, enclosing) => k === 'on' ? true : k === 'off' ? false : enclosing;
class Composer {
  constructor(sources){ this.src = new Set(sources); this.top = null; }
  inside(i){ return this.src.has(i); }
  eval(elems, start){ return elems.reduce((acc, e) => this.draw(e, acc, false, false, false), start); }
  draw(e, b, enclosing, asShape, nested){
    const opacity = asShape ? 1 : e.opacity;
    const ko = e.body.kind === 'group' && koResolve(e.knockout, enclosing);
    if (opacity >= 1 && e.blend === 'normal' && !e.isolate && !ko) return this.content(e, b, ko, null, nested);
    if (e.blends && !e.isolate && !nested){
      const c = this.content(e, b, ko, b, false);
      if (e.blend === 'normal'){ const pb = premul(b), pc = premul(c); return unpremul([0, 1, 2, 3].map(i => pb[i] + (pc[i] - pb[i]) * opacity)); }
      const pc = premul(c), pa = premul(this.content(e, CLEAR, ko, null, false)), pb = premul(b);
      const keep = 1 - pa[3];
      const g0 = [0, 1, 2].map(i => clamp(pc[i] - keep * pb[i], 0, pa[3]));
      const g = unpremul([g0[0], g0[1], g0[2], pa[3]]);
      return composite(e.blend, b, [g[0], g[1], g[2], g[3] * opacity]);
    }
    const innerNested = !(e.blends && (e.isolate || !nested));
    const g = this.content(e, CLEAR, ko, null, innerNested);
    return composite(e.blend, b, [g[0], g[1], g[2], g[3] * opacity]);
  }
  content(e, b, ko, backdrop, nested){
    const B = e.body;
    if (B.kind === 'fills' && this.inside(B.shape)) return B.fills.reduce((acc, f) => { this.top = f; return composite(f.blend, acc, [f.planes[0], f.planes[1], f.planes[2], f.opacity]); }, b);
    if (B.kind === 'group' && (B.clip === null || this.inside(B.clip))){
      if (ko) return this.knockout(B.children, b, backdrop);
      return B.children.reduce((acc, c) => this.draw(c, acc, false, false, nested), b);
    }
    return b;
  }
  knockout(children, b, backdrop){
    const els = [], go = list => list.forEach(c => { if (c.body.kind === 'group' && c.passThrough) go(c.body.children); else els.push(c); });
    go(children);
    let acc = premul(b);
    for (const c of els){
      const s = this.draw(c, CLEAR, true, !c.knockoutShape, true)[3];
      const own = backdrop ? premul(this.draw(c, backdrop, true, false, true)).map(v => v * s) : premul(this.draw(c, CLEAR, true, false, true));
      acc = [0, 1, 2, 3].map(i => acc[i] * (1 - s) + own[i]);
    }
    return unpremul(acc);
  }
}
/* region_fill（flatten.rs:900）：没东西画＝null；只露出一个原样的颜色（不透明）＝留那个颜色与叠印 */
function regionFill(elems, sources, o){
  const c = new Composer(sources);
  const alone = c.eval(elems, CLEAR);
  if (alone[3] < 0.5 / 255) return null;
  let px;
  if (o.preserveAlpha) px = alone; else { c.top = null; px = c.eval(elems, WHITE); }
  const rgb = [px[0], px[1], px[2]];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
  const f = c.top, same = f && px[3] >= 1 - 1e-4 && near(f.planes, rgb);
  if (f && o.preserveOverprints && same) return {paint:f.paint, alpha:px[3], overprint:f.overprint};
  return {paint:hex(rgb), alpha:px[3], overprint:false};
}

/* ═════════════ 一组重叠物件 → 区域＋影像范围（flatten_group，flatten.rs:845-896） ═════════════ */
function flattenGroup(art, o){
  const b = new Builder();
  const elems = art.map(n => b.elem(n)).filter(Boolean);
  if (!b.shapes.length) return null;
  const whole = o.balance <= 0 && !o.clipComplexRegions;
  const regs = whole ? [] : regions(b.shapes);
  const all = !regs.length || rasterizeAll(o, regs.length);
  let vector = [], complex = [], gradientsOnly = !all;
  regs.forEach((r, k) => {
    if (all || r.sources.some(i => b.kinds[i] !== 'vector')){ gradientsOnly = gradientsOnly && r.sources.every(i => b.kinds[i] === 'gradient'); complex.push(k); }
    else { const f = regionFill(elems, r.sources, o); if (f) vector.push([k, f]); }
  });
  const bounds = ks => ks.map(k => loopsBounds(regs[k].loops)).reduce(unionR, null);
  if (!o.clipComplexRegions && !all){
    // 栅格的矩形把它碰到的区域都收进去
    for (;;){
      const r = bounds(complex); if (!r) break;
      const before = complex.length, rp = [rectPoly(r)];
      vector = vector.filter(([k]) => {
        const pb = loopsBounds(regs[k].loops);
        const ov = pb && Math.max(0, Math.min(pb.x1, r.x1) - Math.max(pb.x0, r.x0)) * Math.max(0, Math.min(pb.y1, r.y1) - Math.max(pb.y0, r.y0)) > 0;
        const hit = ov && interArea(regs[k].loops, rp) > 1e-6;
        if (hit) complex.push(k);
        return !hit;
      });
      if (complex.length === before) break;
      gradientsOnly = false;
    }
  }
  const rasterRect = all ? art.map(reach).reduce(unionR, null) : bounds(complex);
  const area = rasterRect ? {rect:rasterRect, ppi:gradientsOnly ? o.gradientPpi : o.lineArtPpi, whole:all,
    clip:o.clipComplexRegions ? (complex.flatMap(k => regs[k].loops)) : null} : null;
  if (area && area.clip && !area.clip.length) area.clip = null;
  return {vector:vector.map(([k, f]) => ({loops:regs[k].loops, fill:f})), area};
}

/* ═════════════ 影像（NodeKind::Image 的最小资料，见档头）═════════════ */
const IMG = new Map();      // src → 画布或 <img>（画的时候直接用；撤销／重开档后同一字串照样命中）
function imageSource(src){
  let im = IMG.get(src); if (im) return (im.complete === false) ? null : im;
  im = new Image(); im.onload = () => { invalidateAll(); if (window.UI) UI.draw(); }; im.src = src; IMG.set(src, im);
  return im.complete ? im : null;
}
const helperPts = s => { const h = R3.helperOf(s); return h && Array.isArray(h.points) && h.points.length >= 4 ? h.points : null; };
/* 影像像素 → 图层坐标的仿射（四角辅助路径：左上、右上、右下、左下） */
function imageXf(s){
  const P = helperPts(s), I = s.image; if (!P || !I || !(I.width > 0) || !(I.height > 0)) return null;
  return [(P[1][0] - P[0][0]) / I.width, (P[1][1] - P[0][1]) / I.width, (P[3][0] - P[0][0]) / I.height, (P[3][1] - P[0][1]) / I.height, P[0][0], P[0][1]];
}
if (!R3.live.image){
  R3.live.image = {
    draw(ctx, s, S){
      const m = imageXf(s), im = s.image && imageSource(s.image.src); if (!m || !im || typeof ctx.drawImage !== 'function') return;
      ctx.save(); ctx.globalAlpha *= opOf(s); ctx.transform(m[0] * S, m[1] * S, m[2] * S, m[3] * S, m[4] * S, m[5] * S);
      ctx.imageSmoothingEnabled = s.image.smooth !== false; ctx.drawImage(im, 0, 0); ctx.restore();
    },
    svg(s){ const m = imageXf(s); return m ? `<image xlink:href="${s.image.src}" width="${s.image.width}" height="${s.image.height}" transform="${R3.SVGM(m)}"${opOf(s) < 1 ? ` opacity="${opOf(s)}"` : ''}/>` : ''; }
  };
}
function imageNode(canvas, src, rect){
  IMG.set(src, canvas);
  const P = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]];
  return {id:newId(), type:'group', live:'image', name:'', image:{src, width:canvas.width, height:canvas.height}, children:[R3.mkHelper(P)]};
}
/* 折线环 → 我们的路径／复合路径（区域、剪切路径） */
const loopNode = P => ({id:newId(), type:'bezier', anchors:P.map(p => ({x:p[0], y:p[1], in:null, out:null})), closed:true, fill:'none', stroke:'none', strokeWidth:0});
function shapeOfLoops(loops, style){
  const st = Object.assign({fill:'none', stroke:'none', strokeWidth:0}, style || {});
  if (loops.length === 1) return Object.assign(loopNode(loops[0]), st);
  return Object.assign({id:newId(), type:'compound', rule:'nonzero', children:loops.map(loopNode)}, st);
}

/* ═════════════ render_raster（flatten.rs:939-996）：在白底上画（Preserve Alpha＝透明底），再用覆盖度把白底拿掉 ═════════════ */
const MAX_PIXELS = 64e6, MAX_SIDE = 16384;
function opaque(s){ s.opacity = 1; s.blend = 'normal'; ['fill', 'stroke'].forEach(k => { const c = rgba(s[k]); if (c && c[3] < 1) s[k] = hex(c); }); if (Array.isArray(s.children)) s.children.forEach(opaque); return s; }
function renderRaster(art, rect, ppi, clipLoops, o){
  let scale = ppi / 72;
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / Math.max(1, (rect.x1 - rect.x0) * (rect.y1 - rect.y0))), MAX_SIDE / Math.max(1e-9, rect.x1 - rect.x0 + 2), MAX_SIDE / Math.max(1e-9, rect.y1 - rect.y0 + 2));
  const px = 1 / scale, r = inflate(rect, px);
  let clip = clipLoops;
  if (clip){   // 剪切路径往外放一个像素（po::offset_path 的替代：环 ∪ 宽 2px 的描边）
    const ring = clip.flatMap(P => AO.strokePieces(P, true, 2 * px, 'miter', 'butt', 4));
    const grown = AO.arrangement([{polys:clip.concat(ring), rule:'nonzero'}], m => m[0]);
    if (grown.length) clip = grown;
  }
  const W = Math.max(1, Math.ceil((r.x1 - r.x0) * scale)), H = Math.max(1, Math.ceil((r.y1 - r.y0) * scale));
  const region = {x0:r.x0, y0:r.y0, x1:r.x0 + W / scale, y1:r.y0 + H / scale};
  const draw = (list, white) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    if (white){ x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); }
    x.translate(-region.x0 * scale, -region.y0 * scale);
    list.forEach(s => window.drawShape(x, s, scale));
    return c;
  };
  const img = draw(art, !o.preserveAlpha);
  if (!o.preserveAlpha || !o.antiAlias){
    const cover = draw(art.map(s => opaque(clone(s))), false);
    const ix = img.getContext('2d'), id = ix.getImageData(0, 0, W, H), cd = cover.getContext('2d').getImageData(0, 0, W, H).data, d = id.data;
    for (let i = 0; i < d.length; i += 4){
      const k = cd[i + 3], k2 = (o.antiAlias || k === 0 || k === 255) ? k : (k >= 128 ? 255 : 0);
      if (o.preserveAlpha){
        // 画布是预乘后再存成直通值：只缩 alpha 等于原码缩预乘的 RGBA
        const f = k2 / Math.max(k, 1); d[i + 3] = Math.min(255, Math.round(d[i + 3] * f));
      } else {
        const white = 255 - k2;
        for (let j = 0; j < 3; j++) d[i + j] = Math.min(Math.max(d[i + j] - white, 0), k2);
        d[i + 3] = k2;
        // 上面算出来的是预乘值（原码像素缓冲是预乘的）；画布存直通值 ⇒ 还原
        if (k2 > 0 && k2 < 255) for (let j = 0; j < 3; j++) d[i + j] = Math.min(255, Math.round(d[i + j] * 255 / k2));
      }
    }
    ix.putImageData(id, 0, 0);
  }
  return {canvas:img, src:img.toDataURL('image/png'), rect:region, clip, smooth:o.antiAlias};
}

/* ═════════════ target_roots（flatten.rs:452）：选中的顶层物件、按绘制顺序（藏起来、锁住的不算） ═════════════ */
function targetRoots(p){
  const L = R3.vLayer(p); if (!L) return {L:null, R:[]};
  return {L, R:R3.roots(L, Array.isArray(p.ids) ? p.ids : null)};
}

/* ═════════════ plan（flatten.rs:810）＋ apply（1039） ═════════════ */
function plan(R, o, render){
  const reaches = R.map(reach), see = R.map(showsTransparency);
  const out = {flat:[], kept:[], transparent:R.filter((_, i) => see[i]).map(s => s.id)};
  for (const g of overlapping(reaches)){
    const roots = g.map(i => R[i]);
    const grp = g.some(i => see[i]) ? flattenGroup(roots, o) : null;
    if (!grp){ out.kept.push(...roots.map(s => s.id)); continue; }
    const raster = (grp.area && render) ? renderRaster(roots, grp.area.rect, grp.area.ppi, grp.area.clip, o) : null;
    out.flat.push({roots:roots.map(s => s.id), regions:grp.vector, area:grp.area, raster});
  }
  return out;
}
const strokedDeep = s => (isLeaf(s) || s.type === 'compound') ? hasStroke(s) && !s.guide : (isCont(s) ? s.children.some(strokedDeep) : false);
const overprintsDeep = s => !!(s.overprintFill || s.overprintStroke) || (isCont(s) && s.children.some(overprintsDeep));
const keptWork = (s, o) => (o.strokesToOutlines && strokedDeep(s)) || (!o.preserveOverprints && overprintsDeep(s));
function dropOverprints(s){ delete s.overprintFill; delete s.overprintStroke; if (isCont(s)) s.children.forEach(dropOverprints); }
function applyPlan(L, pl, o){
  const S = L.data.shapes; let vector = 0, rasterized = 0; const ids = [];
  for (const f of pl.flat){
    const top = f.roots[f.roots.length - 1], children = [];
    if (f.raster){
      const im = imageNode(f.raster.canvas, f.raster.src, f.raster.rect); im.image.smooth = f.raster.smooth;
      children.push(f.raster.clip ? {id:newId(), type:'group', clip:true, children:[Object.assign(shapeOfLoops(f.raster.clip), {clipping:true}), im]} : im);
      rasterized++;
    }
    for (const r of f.regions){
      const n = shapeOfLoops(r.loops, {fill:r.fill.paint});
      if (r.fill.alpha < 1) n.opacity = Math.min(r.fill.alpha, 1);
      if (r.fill.overprint) n.overprintFill = true;
      children.push(n); vector++;
    }
    const g = {id:newId(), type:'group', children};
    const idx = S.findIndex(s => s.id === top);
    S.splice(idx + 1, 0, g);
    for (const id of f.roots){ const i = S.findIndex(s => s.id === id); if (i >= 0) S.splice(i, 1); }
    ids.push(g.id);
  }
  for (let id of pl.kept){
    const s = S.find(x => x.id === id); if (!s) continue;
    if (o.strokesToOutlines && strokedDeep(s)){
      try { const r = CMD.map['ai.object.path.outlineStroke'].run({ids:[id], layerId:L.id}); if (r && r.ok && r.ids && r.ids[0]) id = r.ids[0]; } catch (e){ console.error(e); }
    }
    const n = S.find(x => x.id === id);
    if (n && !o.preserveOverprints) dropOverprints(n);
    ids.push(id);
  }
  ids.sort((a, b) => S.findIndex(s => s.id === a) - S.findIndex(s => s.id === b));
  R3.selectIds(L, ids);
  Layer.invalidate(L);
  return {ids, vector, rasterized};
}
function flattenCore(p, touch){
  const C = 'ai.object.flattenTransparency';
  let o; try { o = fromParams(p); } catch (e){ return err(C, e.message); }
  const {L, R} = targetRoots(p);
  if (!L || !R.length) return {ok:false, error:'Flatten Transparency: select objects to flatten'};
  const pl = plan(R, o, true);
  if (!pl.flat.length && !pl.kept.some(id => { const s = R.find(x => x.id === id); return s && keptWork(s, o); }))
    return {ok:true, ids:R.map(s => s.id), rasterized:0, vector:0, options:o};
  touch();
  const r = applyPlan(L, pl, o);
  return {ok:true, ids:r.ids, rasterized:r.rasterized, vector:r.vector, options:o};
}
regEdit('ai.object.flattenTransparency', {params:'{preset?: "high"|"medium"|"low" 或存过的预设名（见 ai.flattener.presets.list；缺省 medium）, balance?: 0..100（栅格/矢量平衡；0＝全部栅格化）, lineArtPpi?: 1..2400, gradientPpi?: 1..2400（只有渐变与网格碰到的区域）, textToOutlines?, strokesToOutlines?, clipComplexRegions?（影像剪成区域的轮廓，否则是矩形）, antiAlias?, preserveAlpha?（合成在透明上而不是白底上）, preserveOverprints?（只露出一个原样颜色的区域留那个颜色与叠印；关＝清掉叠印）, options?: {同样的键}, ids?, layerId?} 照 object.flattenTransparency（flatten.rs:254）：选中的物件按外框重叠分组；有透明的一组切成原子区域，每个区域按渲染器的合成规则算出一个平面颜色，变成一个编组；渐变、网格、效果、活物件碰到的区域画成一张影像（PNG）放在区域下面；没透明的留着（只做轮廓化／去叠印）。一步历史 → {ok, ids, rasterized: 做出的影像数, vector: 做出的区域数, options}'},
  (p, touch) => flattenCore(p, touch));

/* ═════════════ 对话框（ui-egui/src/dialogs/flatten.rs） ═════════════ */
const CUSTOM = '[Custom]';
function openFlattenDialog(){
  const start = builtin('medium'), presetName = PLABEL.medium;
  let applied = presetName, previewed = false, committed = false;
  const presetOpts = () => [[CUSTOM, 'ai3f.custom']].concat(allPresets().map(q => { const id = PRESETS.find(i => PLABEL[i] === q.name); return [q.name, id ? 'ai3f.p.' + id : q.name]; }));
  const fields = [
    {key:'preset', label:'ai3f.preset', type:'select', value:presetName, options:presetOpts()},
    {key:'ai3fSaveRow', label:'', type:'note'},
    {key:'balance', label:'ai3f.balance', type:'number', value:start.balance},
    {key:'lineArtPpi', label:'ai3f.lineArt', type:'number', value:start.lineArtPpi},
    {key:'gradientPpi', label:'ai3f.gradient', type:'number', value:start.gradientPpi},
    {key:'textToOutlines', label:'ai3f.text', type:'check', value:start.textToOutlines},
    {key:'strokesToOutlines', label:'ai3f.strokes', type:'check', value:start.strokesToOutlines},
    {key:'clipComplexRegions', label:'ai3f.clip', type:'check', value:start.clipComplexRegions},
    {key:'antiAlias', label:'ai3f.aa', type:'check', value:start.antiAlias},
    {key:'preserveAlpha', label:'ai3f.alpha', type:'check', value:start.preserveAlpha},
    {key:'preserveOverprints', label:'ai3f.overprints', type:'check', value:start.preserveOverprints},
    {key:'preview', label:'ai3f.preview', type:'check', value:false}
  ];
  const revert = () => { if (previewed){ previewed = false; History.restoreInPlace(History.past.pop()); invalidateAll(); if (window.UI) UI.draw(); } };
  const bg = R3.form('flattenTransparency', 'ai3f.title', fields, v => {
    revert(); committed = true;
    const r = CMD.run('ai.object.flattenTransparency', params(v));
    if (r && r.ok === false){ committed = false; return r; }
    return r;
  });
  const box = bg.querySelector('.box'), q = n => box.querySelector(`[name="${n}"]`), errEl = box.querySelector('.err');
  const read = () => { const v = {}; NUM_KEYS.forEach(k => { v[k] = num(q(k).value, NaN); }); BOOL_KEYS.forEach(k => { v[k] = !!q(k).checked; }); v.preset = q('preset').value; return v; };
  const params = v => { const o = {}; OPT_KEYS.forEach(k => { o[k] = v[k]; }); if (v.preset && v.preset !== CUSTOM && v.preset !== applied){ const f = findPreset(v.preset); if (f) Object.assign(o, f); } return o; };
  const put = o => { NUM_KEYS.forEach(k => { q(k).value = o[k]; }); BOOL_KEYS.forEach(k => { q(k).checked = !!o[k]; }); };
  // 栅格/矢量平衡的滑杆（「栅格」——滑杆——「矢量」），跟数字栏同步
  const bal = q('balance'), sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 100; sl.step = 1; sl.value = start.balance; sl.name = 'balanceSlider';
  const srow = document.createElement('div'); srow.className = 'ck'; srow.style.gap = '6px';
  const l1 = document.createElement('span'); l1.textContent = T('ai3f.rasters'); const l2 = document.createElement('span'); l2.textContent = T('ai3f.vectors');
  srow.appendChild(l1); srow.appendChild(sl); srow.appendChild(l2);
  bal.closest('.grid').parentNode.insertBefore(srow, bal.closest('.grid'));
  sl.oninput = () => { bal.value = sl.value; changed(); };
  // 存储预设…：名字、存储、取消
  const prow = document.createElement('div'); prow.className = 'ck'; prow.style.gap = '6px';
  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.dataset.act = 'savePreset'; saveBtn.textContent = T('ai3f.savePreset');
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.name = 'presetName'; nameIn.style.display = 'none'; nameIn.style.width = '160px';
  const saveOk = document.createElement('button'); saveOk.type = 'button'; saveOk.dataset.act = 'savePresetOk'; saveOk.textContent = T('ai3f.save'); saveOk.style.display = 'none';
  prow.appendChild(saveBtn); prow.appendChild(nameIn); prow.appendChild(saveOk);
  box.querySelector('[data-key="ai3fSaveRow"]').appendChild(prow);
  saveBtn.onclick = () => { const on = nameIn.style.display === 'none'; nameIn.style.display = saveOk.style.display = on ? '' : 'none'; if (on){ nameIn.value = newPresetName(); nameIn.focus(); nameIn.select(); } };
  const doSave = () => {
    const v = read(), o = {}; OPT_KEYS.forEach(k => { o[k] = v[k]; });
    const r = CMD.run('ai.flattener.presets.save', Object.assign({name:nameIn.value}, o));
    if (!r || r.ok === false){ errEl.textContent = (r && r.error) || ''; return; }
    const sel = q('preset'); sel.innerHTML = ''; presetOpts().forEach(([val, lk]) => { const op = document.createElement('option'); op.value = val; op.textContent = T(lk); sel.appendChild(op); });
    sel.value = r.name; applied = r.name; nameIn.style.display = saveOk.style.display = 'none'; errEl.textContent = '';
  };
  saveOk.onclick = doSave;
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); e.stopImmediatePropagation(); doSave(); } }, true);
  // 改栏位：跟预设不同就显示 [Custom]；预览开着就重算
  let timer = null;
  function changed(){
    const v = read(); sl.value = isFinite(v.balance) ? v.balance : sl.value;
    const cur = findPreset(applied), sel = q('preset');
    let o = null; try { o = fromParams(params(v)); errEl.textContent = ''; } catch (e){ errEl.textContent = e.message; }
    if (o && cur && sameOpts(o, cur)) sel.value = applied; else sel.value = CUSTOM;
    schedule();
  }
  function schedule(){ clearTimeout(timer); timer = setTimeout(preview, 120); }
  function preview(){
    if (committed || !document.body.contains(bg)) return;
    revert();
    if (!q('preview').checked) return;
    let pr; try { pr = params(read()); fromParams(pr); } catch (e){ return; }
    History.push(); previewed = true;
    let r; try { r = flattenCore(pr, () => {}); } catch (e){ r = {ok:false}; }
    if (!r || r.ok === false){ revert(); return; }
    if (window.UI) UI.draw();
  }
  q('preset').onchange = () => {
    const name = q('preset').value; if (name === CUSTOM) return;
    const f = findPreset(name); if (!f) return;
    put(f); sl.value = f.balance; applied = name; schedule();
  };
  NUM_KEYS.forEach(k => q(k).addEventListener('input', changed));
  BOOL_KEYS.forEach(k => q(k).addEventListener('change', changed));
  q('preview').addEventListener('change', schedule);
  // 取消／关窗：预览退回去
  new MutationObserver((_, ob) => { if (!document.body.contains(bg)){ ob.disconnect(); clearTimeout(timer); if (!committed) revert(); } }).observe(document.body, {childList:true});
  return bg;
}
reg('ai.ui.flattenTransparencyDialog', {params:'{} 照 ui.flattenTransparencyDialog（menus.rs:298-301、993；dialogs/flatten.rs）：开「拼合透明度」对话框（预设＝中分辨率、预览一开始关；确定＝ai.object.flattenTransparency 一步历史；存储预设…＝ai.flattener.presets.save）；没选取不开 → {ok, dialog}'}, p => {
  const {L, R} = targetRoots(p);
  if (!L || !R.length) return {ok:false, error:'Flatten Transparency: select objects to flatten'};
  openFlattenDialog();
  return {ok:true, dialog:'flattenTransparency'};
});

/* ═════════════════════════════════ 增效工具（WebAssembly 插件，ABI v1） ═════════════════════════════════ */
const ABI_VERSION = 1, MAX_MODULE = 32 << 20, MAX_MEMORY = 512 << 20, MAX_OUTPUT = 64 << 20, MAX_MANIFEST = 64 * 1024, MAX_PARAMS = 64;
const MAX_COORD = 4.0e6, MAX_OBJECTS = 100000, MAX_ANCHORS = 4000000, MAX_ITEMS = 256, MAX_STROKE_WIDTH = 1000;
const LOAD_MS = 10000, RUN_MS = 60000;
/* lib.rs:34-57 Error 的显示字串 */
class PErr extends Error {}
const E = {
  Module:m => new PErr('not a valid plug-in module: ' + m), Abi:m => new PErr('plug-in ABI: ' + m), Manifest:m => new PErr('plug-in manifest: ' + m),
  Trap:m => new PErr('plug-in trapped: ' + m), Limit:m => new PErr('plug-in exceeded its ' + m), Params:m => new PErr('plug-in parameters: ' + m),
  Output:m => new PErr('plug-in output: ' + m), Failed:m => new PErr('plug-in failed: ' + m), NotFound:id => new PErr(`no plug-in ${JSON.stringify(id)} is installed`)
};
/* 沙箱：每次一个新的 Worker、新的实例（runtime.rs:195 instantiate、:249 run_inner），模组没有任何 import */
const WORKER_SRC = `'use strict';
const MAX_MANIFEST = ${MAX_MANIFEST}, MAX_OUTPUT = ${MAX_OUTPUT}, MAX_MEMORY = ${MAX_MEMORY};
const fail = (kind, msg) => { throw {kind, msg}; };
function fn(ex, name, arity){ const f = ex[name]; if (typeof f !== 'function') fail('Abi', 'export \`' + name + '\`: not found'); if (f.length !== arity) fail('Abi', 'export \`' + name + '\`: wrong number of parameters'); return f; }
function readPacked(mem, packed, what, max){
  if (typeof packed !== 'bigint') fail('Abi', what + ': must return an i64');
  const u = BigInt.asUintN(64, packed), ptr = Number(u & 0xffffffffn), len = Number(u >> 32n);
  if (len > max) fail('Limit', 'output size (' + what + ' is ' + len + ' bytes, limit ' + max + ')');
  if (ptr + len > mem.buffer.byteLength) fail('Abi', what + ' points outside memory');
  return new Uint8Array(mem.buffer.slice(ptr, ptr + len));
}
function call(f, args){ try { return f(...args); } catch (e){ if (e && e.kind) throw e; const m = String(e && e.message || e); if (/call stack/i.test(m)) fail('Trap', 'call stack exhausted'); fail('Trap', m); } }
onmessage = async ev => {
  const d = ev.data;
  try {
    let inst; try { inst = await WebAssembly.instantiate(d.module, {}); } catch (e){ fail('Trap', String(e && e.message || e)); }
    const ex = inst.exports, mem = ex.memory;
    if (!(mem instanceof WebAssembly.Memory)) fail('Abi', 'the module must export its linear memory as \`memory\`');
    if (mem.buffer.byteLength > MAX_MEMORY) fail('Limit', 'memory budget');
    if (d.op === 'load'){
      const v = call(fn(ex, 'vc_abi_version', 0), []);
      if (typeof v !== 'number') fail('Abi', 'export \`vc_abi_version\`: must return an i32');
      if (v !== ${ABI_VERSION}){ postMessage({ok:true, version:v}); return; }
      const packed = call(fn(ex, 'vc_manifest', 0), []);
      let text; try { text = readPacked(mem, packed, 'vc_manifest', MAX_MANIFEST); } catch (e){ if (e.kind === 'Limit') fail('Manifest', 'manifest is too long (limit ' + MAX_MANIFEST + ' bytes)'); throw e; }
      fn(ex, 'vc_alloc', 1); fn(ex, 'vc_run', 4);
      postMessage({ok:true, version:v, manifest:text}, [text.buffer]); return;
    }
    const alloc = fn(ex, 'vc_alloc', 1), run = fn(ex, 'vc_run', 4);
    const place = bytes => {
      const p = call(alloc, [Math.max(bytes.length, 1)]) >>> 0;
      if (p === 0) fail('Failed', 'vc_alloc returned 0 (out of memory)');
      if (p + bytes.length > mem.buffer.byteLength) fail('Abi', 'vc_alloc returned a block outside memory');
      new Uint8Array(mem.buffer, p, bytes.length).set(bytes); return p;
    };
    const ip = place(d.input), pp = place(d.params);
    const packed = call(run, [ip, d.input.length, pp, d.params.length]);
    if (typeof packed !== 'bigint') fail('Abi', 'export \`vc_run\`: must return an i64');
    if (packed < 0n) fail('Failed', 'vc_run returned error code ' + packed);
    if (mem.buffer.byteLength > MAX_MEMORY) fail('Limit', 'memory budget');
    const out = readPacked(mem, packed, 'the output', MAX_OUTPUT);
    postMessage({ok:true, output:out}, [out.buffer]);
  } catch (e){ postMessage({ok:false, kind:(e && e.kind) || 'Trap', msg:(e && e.msg) || String(e && e.message || e)}); }
};`;
let workerURL = null;
function sandbox(msg, ms){
  if (!workerURL) workerURL = URL.createObjectURL(new Blob([WORKER_SRC], {type:'text/javascript'}));
  return new Promise((res, rej) => {
    let w; try { w = new Worker(workerURL); } catch (e){ rej(E.Trap('cannot start the sandbox: ' + e.message)); return; }
    const t = setTimeout(() => { w.terminate(); rej(E.Limit('time budget')); }, ms);
    w.onmessage = ev => { clearTimeout(t); w.terminate(); const d = ev.data; if (d.ok) res(d); else rej((E[d.kind] || E.Trap)(d.msg)); };
    w.onerror = ev => { clearTimeout(t); w.terminate(); ev.preventDefault && ev.preventDefault(); rej(E.Trap(ev.message || 'the sandbox failed')); };
    w.postMessage(msg);
  });
}
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', {fatal:true});

/* manifest.rs：解析与校验 */
const validId = id => typeof id === 'string' && id.length >= 1 && id.length <= 64 && /^[A-Za-z0-9._-]+$/.test(id);
const validKey = k => k.length >= 1 && k.length <= 64 && /^[A-Za-z0-9_]+$/.test(k) && k[0] !== '_' && !['id', 'ids', 'params', 'preview'].includes(k);
const ctrl = s => /[\u0000-\u001f\u007f-\u009f]/.test(s);
function parseSpec(k, v){
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw E.Manifest(`manifest: parameter \`${k}\` must be an object`);
  const t = v.type, isNum = x => typeof x === 'number';
  if (t === 'number'){ if (!isNum(v.min) || !isNum(v.max) || !isNum(v.default)) throw E.Manifest(`manifest: parameter \`${k}\`: missing field`); return {type:'number', min:v.min, max:v.max, default:v.default}; }
  if (t === 'int'){ const g = (x, d) => x === undefined ? d : (Number.isInteger(x) ? x : (() => { throw E.Manifest(`manifest: parameter \`${k}\`: expected an integer`); })()); return {type:'int', min:g(v.min, -1000000), max:g(v.max, 1000000), default:g(v.default, 0)}; }
  if (t === 'bool'){ if (v.default !== undefined && typeof v.default !== 'boolean') throw E.Manifest(`manifest: parameter \`${k}\`: expected a boolean`); return {type:'bool', default:!!v.default}; }
  if (t === 'choice'){ if (!Array.isArray(v.options) || v.options.some(o => typeof o !== 'string')) throw E.Manifest(`manifest: parameter \`${k}\`: missing field \`options\``); return {type:'choice', options:v.options.slice(), default:(v.default === undefined || v.default === null) ? null : String(v.default)}; }
  throw E.Manifest(`manifest: unknown variant \`${t}\`, expected one of \`number\`, \`int\`, \`bool\`, \`choice\``);
}
function parseManifest(bytes){
  if (bytes.length > MAX_MANIFEST) throw E.Manifest(`manifest is ${bytes.length} bytes (limit ${MAX_MANIFEST})`);
  let text; try { text = dec.decode(bytes); } catch (e){ throw E.Manifest('manifest is not UTF-8'); }
  let j; try { j = JSON.parse(text); } catch (e){ throw E.Manifest('manifest: ' + e.message); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw E.Manifest('manifest: invalid type: expected struct Manifest');
  for (const f of ['id', 'name', 'kind']) if (j[f] === undefined) throw E.Manifest(`manifest: missing field \`${f}\``);
  if (!['filter', 'effect'].includes(j.kind)) throw E.Manifest(`manifest: unknown variant \`${j.kind}\`, expected \`filter\` or \`effect\``);
  const str = (v, f) => { if (v === undefined || v === null) return ''; if (typeof v !== 'string') throw E.Manifest(`manifest: \`${f}\` must be a string`); return v; };
  const m = {id:str(j.id, 'id'), name:str(j.name, 'name'), version:str(j.version, 'version'), kind:j.kind, description:str(j.description, 'description'), author:str(j.author, 'author'), params:[]};
  if (j.params !== undefined && j.params !== null){
    if (typeof j.params !== 'object' || Array.isArray(j.params)) throw E.Manifest('manifest: invalid type: expected an object of parameter specs');
    for (const [k, v] of Object.entries(j.params)){ if (m.params.length >= MAX_PARAMS) throw E.Manifest(`manifest: too many parameters (limit ${MAX_PARAMS})`); m.params.push([k, parseSpec(k, v)]); }
  }
  // validate（manifest.rs:126）
  if (!validId(m.id)) throw E.Manifest(`invalid id ${JSON.stringify(m.id)}: use 1-64 characters from A-Z a-z 0-9 . _ -`);
  const nm = m.name.trim(); if (!nm || [...nm].length > 64 || ctrl(nm)) throw E.Manifest('`name` must be 1-64 printable characters');
  if (m.version.length > 32 || m.description.length > 1024 || m.author.length > 128) throw E.Manifest('`version`, `description` or `author` is too long');
  for (const [k, s] of m.params){
    if (!validKey(k)) throw E.Manifest(`invalid parameter name ${JSON.stringify(k)}`);
    if (s.type === 'number' && (!(isFinite(s.min) && isFinite(s.max) && isFinite(s.default)) || s.min > s.max)) throw E.Manifest(`parameter \`${k}\`: bad range`);
    if (s.type === 'int' && s.min > s.max) throw E.Manifest(`parameter \`${k}\`: bad range`);
    if (s.type === 'choice'){
      if (!s.options.length || s.options.length > 64 || s.options.some(o => !o || o.length > 64 || ctrl(o))) throw E.Manifest(`parameter \`${k}\`: choices must be 1-64 non-empty, printable strings`);
      if (s.default !== null && !s.options.includes(s.default)) throw E.Manifest(`parameter \`${k}\`: default is not one of the options`);
    }
  }
  return m;
}
const defaultValue = s => s.type === 'choice' ? (s.default !== null ? s.default : (s.options[0] || '')) : s.default;
const fmtNum = v => String(v);
/* params_doc（manifest.rs:167） */
function paramsDoc(m){
  return '{' + m.params.map(([k, s]) => s.type === 'number' ? `${k}: ${fmtNum(s.min)}..${fmtNum(s.max)} (${fmtNum(s.default)})`
    : s.type === 'int' ? `${k}: int ${s.min}..${s.max} (${s.default})` : s.type === 'bool' ? `${k}: bool (${s.default})`
    : `${k}: ${s.options.map(o => JSON.stringify(o)).join('|')} (${defaultValue(s)})`).join(', ') + '}';
}
const defaults = m => Object.fromEntries(m.params.map(([k, s]) => [k, defaultValue(s)]));
const schemaJson = m => Object.fromEntries(m.params.map(([k, s]) => [k, clone(s.type === 'choice' && s.default === null ? {type:'choice', options:s.options, default:null} : s)]));
/* resolve_params（manifest.rs:192） */
function resolveParams(m, given){
  if (given === null || given === undefined) given = {};
  if (typeof given !== 'object' || Array.isArray(given)) throw E.Params('plug-in parameters must be a JSON object');
  const out = {};
  for (const [k, s] of m.params){
    const v = given[k];
    if (v === undefined || v === null){ out[k] = defaultValue(s); continue; }
    const wrong = w => E.Params(`\`${k}\` must be ${w}`);
    if (s.type === 'number'){ if (typeof v !== 'number' || !isFinite(v)) throw wrong('a number'); out[k] = clamp(v, s.min, s.max); }
    else if (s.type === 'int'){ if (typeof v !== 'number' || !isFinite(v)) throw wrong('a number'); out[k] = clamp(Math.round(v), s.min, s.max); }
    else if (s.type === 'bool'){ if (typeof v !== 'boolean') throw wrong('true or false'); out[k] = v; }
    else { if (typeof v !== 'string') throw wrong('a string'); if (!s.options.includes(v)) throw E.Params(`\`${k}\` must be one of ${s.options.join(', ')}`); out[k] = v; }
  }
  return out;
}

/* registry.rs：进程级（这个分页）登记 */
const Plugins = {map:new Map(), revision:0};
async function loadPlugin(bytes){
  if (bytes.length > MAX_MODULE) throw E.Module(`module is ${bytes.length} bytes (limit ${MAX_MODULE})`);
  if (!(bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d)) throw E.Module('not a WebAssembly binary (missing \\0asm header)');
  let module; try { module = await WebAssembly.compile(bytes); } catch (e){ throw E.Module(String(e && e.message || e)); }
  const imp = WebAssembly.Module.imports(module)[0];
  if (imp) throw E.Abi(`the module imports \`${imp.module}.${imp.name}\`, but plug-ins get no host imports (no WASI, files or network)`);
  const r = await sandbox({op:'load', module}, LOAD_MS);
  if (r.version !== ABI_VERSION) throw E.Abi(`vc_abi_version returned ${r.version}; this host implements version ${ABI_VERSION}`);
  return {manifest:parseManifest(new Uint8Array(r.manifest)), module, size:bytes.length, source:null, serial:0};
}
function install(p){ p.serial = ++Plugins.revision; Plugins.map.set(p.manifest.id, p); syncMenu(); return p; }
const sortedPlugins = () => [...Plugins.map.values()].sort((a, b) => a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0);
/* plugin.rs:22 describe */
function describe(p){
  const m = p.manifest;
  const v = {id:m.id, name:m.name, version:m.version, kind:m.kind, author:m.author, description:m.description, params:paramsDoc(m), paramsSchema:schemaJson(m), size:p.size, source:p.source};
  if (m.kind === 'effect') v.effect = 'plugin.' + m.id;
  return v;
}
async function runPlugin(p, input, params){
  const total = input.length + params.length;
  if (total > 2147483647 || total > MAX_MEMORY / 2) throw E.Limit('memory budget (the selection is too large to hand over)');
  const r = await sandbox({op:'run', module:p.module, input, params}, RUN_MS);
  return new Uint8Array(r.output);
}
function b64bytes(s){
  const t = String(s).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(t)) return null;
  try { const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch (e){ return null; }
}
const MAX_DATA_CHARS = Math.floor((32 << 20) / 3) * 4 + 4;
/* plugin.rs:88 install */
async function installCmd(p){
  const C = 'ai.plugin.install';
  try {
    let bytes;
    if (p.dataBase64 !== undefined && p.dataBase64 !== null){
      if (String(p.dataBase64).length > MAX_DATA_CHARS) return err(C, '`dataBase64` is larger than the module limit');
      bytes = b64bytes(p.dataBase64); if (!bytes) return err(C, '`dataBase64` is not valid base64');
    } else if (p.bytes instanceof Uint8Array || p.bytes instanceof ArrayBuffer){ bytes = new Uint8Array(p.bytes); }
    else if (p.path) return {ok:false, error:'installing from a path is not available on the web; pass the module as `dataBase64`'};      // plugin.rs:116-119（wasm32）
    else return err(C, 'give `path` (a .wasm file) or `dataBase64` (the module)');
    const pl = await loadPlugin(bytes);
    if (p.name !== undefined && p.name !== null) pl.source = String(p.name);
    if (p.replace === false && Plugins.map.has(pl.manifest.id)) return err(C, `a plug-in with id ${JSON.stringify(pl.manifest.id)} is already installed`);
    return Object.assign({ok:true}, describe(install(pl)));
  } catch (e){ return {ok:false, error:e instanceof PErr ? e.message : String(e && e.message || e)}; }
}
reg('ai.plugin.install', {params:'{dataBase64: 模组（base64）, name?: 来源名, replace?: bool（缺省 true：同 id 的换掉）| path（网页版不支援，照原码回错）} 照 plugin.install（plugin.rs:88）：校验并装上一个 WebAssembly 增效工具（这个分页里有效）；非同步 → Promise<{ok, id, name, version, kind, author, description, params, paramsSchema, effect?, size, source}>'}, installCmd);
reg('ai.plugin.list', {params:'{} 照 plugin.list（plugin.rs:170）→ {ok, plugins:[describe…]（按 id 排）, folder:null（网页版没有增效工具资料夹）}'}, () => ({ok:true, plugins:sortedPlugins().map(describe), folder:null}));
reg('ai.plugin.info', {params:'{id} 照 plugin.info（plugin.rs:175）→ plugin.list 那一项加 {manifest, defaults, lastError}'}, p => {
  const pl = Plugins.map.get(p.id); if (p.id === undefined) return err('ai.plugin.info', 'missing `id` (see plugin.list)'); if (!pl) return {ok:false, error:E.NotFound(p.id).message};
  const m = pl.manifest;
  return Object.assign({ok:true}, describe(pl), {manifest:{id:m.id, name:m.name, version:m.version, kind:m.kind, description:m.description, author:m.author, params:schemaJson(m)}, defaults:defaults(m), lastError:null});
});
reg('ai.plugin.remove', {params:'{id} 照 plugin.remove（plugin.rs:184）：卸下一个增效工具 → {ok, removed}'}, p => {
  if (p.id === undefined) return err('ai.plugin.remove', 'missing `id`');
  if (!Plugins.map.delete(p.id)) return {ok:false, error:E.NotFound(p.id).message};
  Plugins.revision++; syncMenu(); return {ok:true, removed:p.id};
});

/* ── objects.rs：我们的形状 ⇄ 插件看到的 JSON ── */
function colorJson(c){ return {model:'rgb', r:c[0], g:c[1], b:c[2]}; }
function paintJson(p){
  if (!painted(p)) return null;
  if (isGrad(p)) return {type:'gradient', gradient:{kind:p.type === 'radial' ? 'Radial' : 'Linear', stops:(p.stops || []).map(q => { const c = rgba(q.color) || [0, 0, 0, 1]; return {offset:q.offset, color:colorJson(c), opacity:q.opacity === undefined ? 1 : q.opacity, midpoint:q.midpoint === undefined ? 0.5 : q.midpoint}; })},
    angle:0, geom:{start:[p.x1, p.y1], end:[p.x2, p.y2], aspect:p.aspect || 1}};
  const c = rgba(p); return c ? {type:'solid', color:colorJson(c)} : null;
}
const pathJson = (s, F) => ({subpaths:R3.subviews(s).map(v => ({closed:!!v.closed, anchors:v.anchors.map(a => { const o = {p:F([a.x, a.y])}; if (a.in) o.in = F(a.in); if (a.out) o.out = F(a.out); if (a.kind === 'smooth') o.kind = 'Smooth'; return o; })}))});
function geomBounds(pj){
  let r = null; pj.subpaths.forEach(sp => sp.anchors.forEach(a => [a.p, a.in, a.out].forEach(q => { if (q) r = unionR(r, {x0:q[0], y0:q[1], x1:q[0], y1:q[1]}); })));
  return r;
}
/* filter_targets（objects.rs:431）：选中的路径／复合路径，与选中编组里面的；藏起来、锁住、参考线、剪切路径不算；活物件里面不进去 */
function filterTargets(L, sel){
  const out = [];
  const visit = (list, inside) => list.forEach(n => {
    if (!n || n.visible === false || n.locked) return;
    const picked = inside || sel.includes(n.id);
    if ((isLeaf(n) && !n.guide && !n.clipping && !n.r3helper) || n.type === 'compound'){ if (picked) out.push(n); }
    else if (n.type === 'group' && !n.live) visit(n.children, picked);
  });
  visit(L.data.shapes, false);
  return out;
}
/* encode（objects.rs:88）：id 换成数字（原码是 u64） */
function encodeInput(L, inputs, numOf){
  const F = p => [p[0] + L.x, p[1] + L.y];
  return {objects:inputs.map(n => {
    const path = pathJson(n, F), o = {id:numOf.get(n.id), type:n.type === 'compound' ? 'compound' : 'path', path, fillRule:ruleOf(n),
      fills:painted(n.fill) ? [paintJson(n.fill)] : [], strokes:hasStroke(n) ? [{paint:paintJson(n.stroke), width:n.strokeWidth}] : [], opacity:opOf(n), bounds:(b => b ? [b.x0, b.y0, b.x1, b.y1] : null)(geomBounds(path))};
    if (n.name) o.name = n.name;
    return o;
  })};
}
const outErr = (at, m) => E.Output(at + ': ' + m);
function checkPoint(p, at){ if (!Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(v => typeof v === 'number' && isFinite(v) && Math.abs(v) <= MAX_COORD)) throw outErr(at, `coordinate out of range (limit ±${MAX_COORD} pt)`); }
function decodePath(v, at, cnt){
  if (!v || typeof v !== 'object' || !Array.isArray(v.subpaths)) throw outErr(at, 'missing field `subpaths`');
  const subs = v.subpaths.filter(sp => sp && Array.isArray(sp.anchors) && sp.anchors.length);
  for (const sp of subs){
    cnt.n += sp.anchors.length; if (cnt.n > MAX_ANCHORS) throw outErr(at, `too many anchor points (limit ${MAX_ANCHORS})`);
    for (const a of sp.anchors){ if (!a || typeof a !== 'object') throw outErr(at, 'invalid anchor'); checkPoint(a.p, at); if (a.in) checkPoint(a.in, at); if (a.out) checkPoint(a.out, at); }
  }
  if (!subs.length) throw outErr(at, 'the path has no anchor points');
  return subs.map(sp => ({closed:!!sp.closed, anchors:sp.anchors.map(a => ({p:a.p, in:a.in || null, out:a.out || null, smooth:a.kind === 'Smooth'}))}));
}
const unit = v => clamp(+v || 0, 0, 1);
/* 颜色模型 → sRGB（Lab 走 D50 → Bradford → D65 → sRGB） */
function colorToRgb(c, at){
  if (!c || typeof c !== 'object') throw outErr(at, 'invalid colour');
  const m = c.model;
  if (m === 'rgb') return [unit(c.r), unit(c.g), unit(c.b)];
  if (m === 'gray') return [1 - unit(c.k), 1 - unit(c.k), 1 - unit(c.k)];
  if (m === 'cmyk'){ const k = unit(c.k); return [(1 - unit(c.c)) * (1 - k), (1 - unit(c.m)) * (1 - k), (1 - unit(c.y)) * (1 - k)]; }
  if (m === 'lab'){
    const L = clamp(+c.l || 0, 0, 100), A = clamp(+c.a || 0, -128, 127), B = clamp(+c.b || 0, -128, 127);
    const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200, e = 216 / 24389, k = 24389 / 27;
    const inv = f => f * f * f > e ? f * f * f : (116 * f - 16) / k;
    const X = 0.96422 * inv(fx), Y = L > k * e ? Math.pow(fy, 3) : L / k, Z = 0.82521 * inv(fz);
    const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z, y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z, z = 0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z;
    const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.9692660 * x + 1.8760108 * y + 0.0415560 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
    return lin.map(v => unit(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }
  throw outErr(at, `unknown colour model ${JSON.stringify(m)}`);
}
/* decode_paint（objects.rs:163）：夹范围；渐变的几何留原来的（我们的渐变几何在图层坐标） */
function decodePaint(v, at){
  if (v === null || v === undefined) return {none:true};
  if (typeof v !== 'object') throw outErr(at, 'invalid paint');
  if (v.type === 'solid'){
    let c = colorToRgb(v.color, at); const tint = v.tint === undefined ? 1 : unit(v.tint);
    if (tint < 1) c = c.map(x => 1 - (1 - x) * tint);
    return {solid:hex(c)};
  }
  if (v.type === 'gradient'){
    const g = v.gradient || {}, stops = g.stops;
    if (!Array.isArray(stops) || !stops.length || stops.length > MAX_ITEMS) throw outErr(at, `a gradient needs 1-${MAX_ITEMS} stops`);
    const S = stops.map(q => ({offset:unit(q.offset), color:hex(colorToRgb(q.color, at)), opacity:q.opacity === undefined ? 1 : unit(q.opacity), midpoint:clamp(q.midpoint === undefined ? 0.5 : +q.midpoint || 0.5, 0.13, 0.87)})).sort((a, b) => a.offset - b.offset);
    if (v.geom){ checkPoint(v.geom.start, at); checkPoint(v.geom.end, at); if (v.geom.focal) checkPoint(v.geom.focal, at); }
    return {gradient:{kind:g.kind === 'Radial' ? 'radial' : 'linear', stops:S}};
  }
  if (v.type === 'pattern') throw outErr(at, `the document has no pattern ${JSON.stringify(v.pattern)}`);
  throw outErr(at, 'unknown paint type');
}
function decodeObject(v, at, cnt){
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw outErr(at, 'an object must be a JSON object');
  const opt = k => (v[k] === null || v[k] === undefined) ? undefined : v[k];
  const o = {};
  if (opt('id') !== undefined){ if (!Number.isInteger(v.id) || v.id < 0) throw outErr(at, '`id` must be the id of an input object'); o.id = v.id; }
  if (opt('type') !== undefined){ if (v.type === 'path') o.compound = false; else if (v.type === 'compound') o.compound = true; else throw outErr(at, '`type` must be "path" or "compound"'); }
  if ('name' in v){ if (v.name === null) o.name = ''; else if (typeof v.name !== 'string') throw outErr(at, '`name` must be a string'); else o.name = [...v.name].filter(ch => !ctrl(ch)).slice(0, 256).join(''); }
  if (opt('path') !== undefined) o.path = decodePath(v.path, at + '.path', cnt);
  if (opt('fillRule') !== undefined){ const r = String(v.fillRule).toLowerCase(); if (r !== 'nonzero' && r !== 'evenodd') throw outErr(at, '`fillRule` must be "nonzero" or "evenodd"'); o.rule = r; }
  const list = k => { const x = opt(k); if (x === undefined) return undefined; if (!Array.isArray(x) || x.length > MAX_ITEMS) throw outErr(at, `\`${k}\` must be an array of at most ${MAX_ITEMS} entries`); return x; };
  const fills = list('fills'); if (fills) o.fills = fills.map((f, i) => ({raw:f, paint:decodePaint(f, `${at}.fills[${i}]`)}));
  const strokes = list('strokes');
  if (strokes) o.strokes = strokes.map((s, i) => {
    const a = `${at}.strokes[${i}]`; if (!s || typeof s !== 'object') throw outErr(a, 'a stroke must be {"paint", "width"}');
    let width; if (s.width !== undefined && s.width !== null){ if (typeof s.width !== 'number') throw outErr(a, '`width` must be a number'); width = clamp(s.width, 0, MAX_STROKE_WIDTH); }
    return {raw:s.paint === undefined ? null : s.paint, paint:decodePaint(s.paint === undefined ? null : s.paint, a), width};
  });
  if (opt('opacity') !== undefined){ if (typeof v.opacity !== 'number') throw outErr(at, '`opacity` must be a number'); o.opacity = unit(v.opacity); }
  return o;
}
/* decode（objects.rs:287）：{"error": …}＝插件自己婉拒 */
function decodeOutput(bytes){
  let v; try { v = JSON.parse(dec.decode(bytes)); } catch (e){ throw E.Output('not JSON: ' + e.message); }
  if (v && v.error !== undefined && v.error !== null){ const m = (typeof v.error === 'string' ? v.error : JSON.stringify(v.error)); throw E.Failed([...m].filter(ch => !ctrl(ch)).slice(0, 300).join('')); }
  if (!v || !Array.isArray(v.objects)) throw E.Output('expected {"objects": [...]}');
  if (v.objects.length > MAX_OBJECTS) throw E.Output(`${v.objects.length} objects (limit ${MAX_OBJECTS})`);
  const cnt = {n:0};
  return v.objects.map((o, i) => decodeObject(o, `objects[${i}]`, cnt));
}
/* 把插件的 path（文件坐标）变成我们的贝兹（图层坐标） */
const toAnchors = (sp, L) => sp.anchors.map(a => ({x:a.p[0] - L.x, y:a.p[1] - L.y, in:a.in ? [a.in[0] - L.x, a.in[1] - L.y] : null, out:a.out ? [a.out[0] - L.x, a.out[1] - L.y] : null, kind:a.smooth ? 'smooth' : 'corner'}));
const LIVE_KEYS = ['x', 'y', 'w', 'h', 'radius', 'cx', 'cy', 'r1', 'r2', 'rotation', 'points', 'corners', 'live'];
function setPath(n, subs, rule, compound, L){
  const NOP = {fill:'none', stroke:'none', strokeWidth:0};
  if (compound || subs.length > 1){       // 我们的路径只有一条子路径 ⇒ 多条子路径的「路径」做成复合路径（同一个填色规则）
    const old = n.type === 'compound' ? n.children : [];
    LIVE_KEYS.forEach(k => delete n[k]); delete n.anchors; delete n.closed; delete n.fillRule;
    n.type = 'compound'; n.rule = rule;
    n.children = subs.map((sp, i) => Object.assign({id:old[i] ? old[i].id : newId(), type:'bezier', anchors:toAnchors(sp, L), closed:sp.closed}, NOP));
  } else {
    LIVE_KEYS.forEach(k => delete n[k]); delete n.children; delete n.rule;
    n.type = 'bezier'; n.anchors = toAnchors(subs[0], L); n.closed = subs[0].closed;
    if (rule === 'evenodd') n.fillRule = 'evenOdd'; else delete n.fillRule;
  }
}
/* 从解出来的 paint 做出我们的填色（跟原来那一格一样＝留原样） */
function admit(paint, raw, was){
  if (paint.none) return 'none';
  if (was !== undefined && JSON.stringify(paintJson(was)) === JSON.stringify(raw)) return clone(was);
  if (paint.solid) return paint.solid;
  const g = isGrad(was) ? clone(was) : null, out = g || {type:'linear', x1:0, y1:0, x2:100, y2:0};
  out.type = paint.gradient.kind; out.stops = paint.gradient.stops;
  return out;
}
/* write（objects.rs:382） */
function writeObj(n, o, L){
  const curCompound = n.type === 'compound', compound = o.compound === undefined ? curCompound : o.compound, rule = o.rule || ruleOf(n);
  if (o.path) setPath(n, o.path, rule, compound, L);
  else if (compound !== curCompound){
    const subs = R3.subviews(n).map(v => ({closed:!!v.closed, anchors:v.anchors.map(a => ({p:[a.x + L.x, a.y + L.y], in:a.in ? [a.in[0] + L.x, a.in[1] + L.y] : null, out:a.out ? [a.out[0] + L.x, a.out[1] + L.y] : null, smooth:a.kind === 'smooth'}))}));
    if (subs.length) setPath(n, subs, rule, compound, L);
  } else if (n.type === 'compound') n.rule = rule;
  else if (o.rule){ if (rule === 'evenodd') n.fillRule = 'evenOdd'; else delete n.fillRule; }
  // 我们的外观只有一个填色、一个描边：取最上面那一项（原码依序设每一项）
  if (o.fills){ const f = o.fills[o.fills.length - 1]; n.fill = f ? admit(f.paint, f.raw, n.fill) : 'none'; }
  if (o.strokes){
    const s = o.strokes[o.strokes.length - 1];
    if (!s) n.stroke = 'none';
    else { n.stroke = admit(s.paint, s.raw, n.stroke); if (s.width !== undefined) n.strokeWidth = s.width; else if (!(n.strokeWidth > 0)) n.strokeWidth = 1; }
  }
  if (o.opacity !== undefined){ if (o.opacity >= 1) delete n.opacity; else n.opacity = o.opacity; }
  if (o.name !== undefined){ if (o.name.trim()) n.name = o.name; else delete n.name; }
}
/* apply_output（objects.rs:525）：先全部算好、验过，再一次改文件 */
function applyOutput(L, inputs, numOf, out){
  const byNum = new Map(inputs.map(n => [numOf.get(n.id), n]));
  const originals = new Map(inputs.map(n => [n.id, n]));
  const replace = new Map(), before = new Map(), after = new Map(), result = [];
  let run = [], prev = null, top = null;
  out.forEach((o, i) => {
    const at = `objects[${i}]`;
    if (o.id !== undefined){
      const src = byNum.get(o.id);
      if (!src || !originals.has(src.id)) throw outErr(at, `${o.id} ${src ? 'is listed twice' : 'is not the id of an input object'}`);
      originals.delete(src.id);
      const n = clone(src); writeObj(n, o, L);
      if (run.length){ if (prev) after.set(prev, run); else before.set(src.id, run); run = []; }
      replace.set(src.id, n); prev = src.id; result.push(src.id);
    } else {
      if (!o.path) throw outErr(at, 'a new object needs a `path`');
      const n = {id:newId(), type:'bezier', anchors:[], closed:false, fill:'none', stroke:'none', strokeWidth:0};
      writeObj(n, o, L); result.push(n.id); run.push(n);
    }
  });
  if (run.length){ if (prev) after.set(prev, run); else if (inputs.length) before.set(inputs[0].id, run); else top = run; }
  const del = new Set(originals.keys());
  return {result, commit(){
    const list = arr => { const outA = []; for (const c of arr){
      (before.get(c.id) || []).forEach(x => outA.push(x));
      if (del.has(c.id)){}
      else if (replace.has(c.id)) outA.push(replace.get(c.id));
      else { if (c.type === 'group' && !c.live && Array.isArray(c.children)) c.children = list(c.children); outA.push(c); }
      (after.get(c.id) || []).forEach(x => outA.push(x));
    } return outA; };
    L.data.shapes = list(L.data.shapes);
    if (top) L.data.shapes.push(...top);
  }};
}
const artboardAt = (pt) => { const A = R3.artboards ? R3.artboards() : [{rect:{x0:0, y0:0, x1:Doc.width, y1:Doc.height}}]; const a = (pt && A.find(a => pt[0] >= a.rect.x0 && pt[0] <= a.rect.x1 && pt[1] >= a.rect.y0 && pt[1] <= a.rect.y1)) || A[0]; return a ? [a.rect.x0, a.rect.y0, a.rect.x1, a.rect.y1] : null; };
/* plugin.rs:54 run：一步历史、全有或全无 */
async function pluginRun(p, opt){
  const C = 'ai.plugin.run';
  if (p.id === undefined) return err(C, 'missing `id` (see plugin.list)');
  const pl = Plugins.map.get(p.id); if (!pl) return {ok:false, error:E.NotFound(p.id).message};
  const m = pl.manifest;
  if (m.kind !== 'filter') return err(C, `\`${m.id}\` is a live effect: apply it with effect.apply {"effect": "plugin.${m.id}"}`);
  let params; try {
    const given = p.params !== undefined ? p.params : Object.fromEntries(Object.entries(p).filter(([k]) => !['id', 'ids', 'layerId'].includes(k)));
    params = resolveParams(m, given);
  } catch (e){ return err(C, e.message); }
  const L = R3.vLayer(p); if (!L) return err(C, 'not a vector layer');
  const sel = Array.isArray(p.ids) ? p.ids : (VecSel.layerId === L.id ? VecSel.shapes.slice() : []);
  const inputs = filterTargets(L, sel), numOf = new Map(inputs.map((n, i) => [n.id, i + 1]));
  const input = encodeInput(L, inputs, numOf);
  const b = input.objects.map(o => o.bounds && {x0:o.bounds[0], y0:o.bounds[1], x1:o.bounds[2], y1:o.bounds[3]}).reduce(unionR, null);
  params._context = {mode:'filter', bounds:b ? [b.x0, b.y0, b.x1, b.y1] : null, artboard:artboardAt(b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : null)};
  const rev = Plugins.revision;
  try {
    const outBytes = await runPlugin(pl, enc.encode(JSON.stringify(input)), enc.encode(JSON.stringify(params)));
    const out = decodeOutput(outBytes);
    if (opt && opt.stale && opt.stale()) return {ok:false, error:'stale'};
    if (!Doc.layers.includes(L)) return err(C, 'the layer is gone');
    const plan = applyOutput(L, inputs, numOf, out);
    if (!(opt && opt.noHistory)) History.push();
    plan.commit();
    R3.selectDeep(L, plan.result);
    Layer.invalidate(L); if (window.UI){ UI.refresh && UI.refresh(); UI.draw(); }
    return {ok:true, plugin:m.id, ids:plan.result, revision:rev};
  } catch (e){ return {ok:false, error:e instanceof PErr ? e.message : String(e && e.message || e)}; }
}
reg('ai.plugin.run', {params:'{id, params?: {…}（插件自己的参数；也可以放顶层；缺的取预设，见 ai.plugin.info）, ids?: [..]（缺省＝选取）, layerId?} 照 plugin.run（plugin.rs:54）：对选中的路径与复合路径（选中编组里面的也算；藏起来、锁住、参考线、剪切路径不算）跑物件滤镜：插件可以改、删、加物件；一步历史；结果被选中。沙箱里跑（新的 Worker、新的实例、没有 import、60 秒时限）；非同步 → Promise<{ok, plugin, ids}>'}, p => pluginRun(p));

/* ── 对话框（dialogs/plugin.rs）：照清单的参数生成栏位、预览；没参数或给了 params 就直接跑 ── */
function openPluginDialog(pl){
  const m = pl.manifest, d = defaults(m);
  const fields = [];
  if (m.description) fields.push({type:'note', label:m.description});
  m.params.forEach(([k, s]) => {
    if (s.type === 'bool') fields.push({key:k, label:k, type:'check', value:d[k]});
    else if (s.type === 'choice') fields.push({key:k, label:k, type:'select', value:d[k], options:s.options.map(o => [o, o])});
    else fields.push({key:k, label:k, type:'number', value:d[k]});
  });
  fields.push({key:'preview', label:'ai3f.preview', type:'check', value:true});
  let previewed = false, committed = false, gen = 0;
  const revert = () => { gen++; if (previewed){ previewed = false; History.restoreInPlace(History.past.pop()); invalidateAll(); if (window.UI) UI.draw(); } };
  const values = v => { const o = {}; m.params.forEach(([k]) => { if (v[k] !== undefined) o[k] = v[k]; }); return o; };
  const bg = R3.form('plugin', m.name.replace(/…$/, ''), fields, v => {
    revert(); committed = true;
    const r = CMD.run('ai.plugin.run', {id:m.id, params:values(v)});
    if (r && typeof r.then === 'function') r.then(x => { if (x && x.ok === false && window.UI && UI.toast) UI.toast(x.error); });
    return {ok:true};
  });
  bg.dataset.plugin = m.id;
  const box = bg.querySelector('.box'), q = n => box.querySelector(`[name="${n}"]`);
  m.params.forEach(([k, s]) => { const el = q(k); if (el && el.type === 'number'){ if (s.min !== undefined) el.min = s.min; if (s.max !== undefined) el.max = s.max; if (s.type === 'int') el.step = 1; } });
  const read = () => { const v = {}; m.params.forEach(([k, s]) => { const el = q(k); v[k] = s.type === 'bool' ? el.checked : s.type === 'choice' ? el.value : num(el.value, d[k]); }); return v; };
  let timer = null;
  const preview = async () => {
    if (committed || !document.body.contains(bg)) return;
    revert(); if (!q('preview').checked) return;
    const my = ++gen;
    History.push(); previewed = true;
    const r = await pluginRun({id:m.id, params:read()}, {noHistory:true, stale:() => my !== gen || committed});
    if (my !== gen || committed){ return; }
    if (!r || r.ok === false){ revert(); }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(preview, 150); };
  box.querySelectorAll('input,select').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', schedule));
  schedule();
  new MutationObserver((_, ob) => { if (!document.body.contains(bg)){ ob.disconnect(); clearTimeout(timer); if (!committed) revert(); } }).observe(document.body, {childList:true});
  return bg;
}
reg('ai.plugin.dialog', {params:'{id, params?} 照 plugin.dialog（dialogs/plugin.rs:66）：滤镜没参数或给了 params ＝直接跑 ai.plugin.run；否则开照清单生成的对话框（预设值、预览开着；确定＝ai.plugin.run 一步历史）→ {ok, dialog} 或 ai.plugin.run 的 Promise'}, p => {
  if (p.id === undefined) return err('ai.plugin.dialog', 'missing `id` (see plugin.list)');
  const pl = Plugins.map.get(p.id); if (!pl) return {ok:false, error:`no plug-in ${JSON.stringify(p.id)} is installed`};
  const m = pl.manifest;
  if (m.kind !== 'filter') return {ok:false, error:`${m.name} is a live effect (Effect › Plug-ins)`};
  const given = p.params && typeof p.params === 'object' && Object.keys(p.params).length ? p.params : null;
  if (!m.params.length || given) return CMD.run('ai.plugin.run', {id:m.id, params:given || {}});
  openPluginDialog(pl);
  return {ok:true, dialog:'plugin'};
});

/* ── 对象 ▸ 增效工具 ▸ 安装增效工具…（io.rs:78 install_plugin：网页版开浏览器的选档框，读到的 .wasm 装上） ── */
function pickWasm(){
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.wasm,application/wasm'; inp.style.display = 'none';
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); res(f || null); };
    document.body.appendChild(inp); inp.click();
  });
}
reg('ai.ui.installPlugin', {params:'{dataBase64?: 模组, name?} 照 ui.installPlugin（menus.rs:546-549、1092；io.rs:78）：给了 dataBase64＝直接 ai.plugin.install；否则开浏览器的选档框挑一个 .wasm 装上（这个分页里有效）；装好状态列报一句 → Promise<ai.plugin.install 的结果>'}, async p => {
  let q = p;
  if (p.dataBase64 === undefined && !p.path){
    const f = await pickWasm(); if (!f) return {ok:false, error:'cancelled'};
    q = {bytes:new Uint8Array(await f.arrayBuffer()), name:f.name};
  }
  const r = await installCmd(q);
  if (window.UI && UI.toast) UI.toast(r.ok ? T('ai3p.installed') + ' ' + r.name : r.error);
  return r;
});

/* ── 菜单：对象 ▸ 增效工具 ＝ 已装的滤镜（或「没有」）、分隔线、安装…、重新载入（dialogs/plugin.rs:33 object_menu） ── */
function syncMenu(){
  if (!window.MenuTrees || !MenuTrees.ai || !MenuTrees.ai.object) return;
  let parent = null;
  MenuTrees.walk('ai', (it, path) => { if (!parent && it.id === 'ui.installPlugin' && path.length > 1) parent = path[path.length - 1]; });
  if (!parent || !Array.isArray(parent.sub)) return;
  const fixed = parent.sub.filter(it => it.id === 'ui.installPlugin' || it.id === 'plugin.reload');
  const filters = sortedPlugins().filter(p => p.manifest.kind === 'filter').map(p => {
    const nm = p.manifest.name + (p.manifest.params.length && !p.manifest.name.endsWith('…') ? '…' : '');
    return {n:{'zh-Hant':nm, 'zh-Hans':nm, en:nm}, id:'plugin.dialog.' + p.manifest.id, impl:{cmd:'ai.plugin.dialog', params:{id:p.manifest.id}}};
  });
  const items = filters.length ? filters : [{header:true, n:{'zh-Hant':'未安裝濾鏡增效模組', 'zh-Hans':'未安装滤镜增效工具', en:'No filter plug-ins installed'}}];
  parent.sub.length = 0; parent.sub.push(...items, {sep:true}, ...fixed);
}
syncMenu(); window.addEventListener('DOMContentLoaded', syncMenu);

/* ═════════════ 三语字串（AI 2020 繁／简中介面正名） ═════════════ */
const STR = {
  'ai3f.title':['透明度平面化', '拼合透明度', 'Flatten Transparency'], 'ai3f.preset':['預設集：', '预设：', 'Preset:'], 'ai3f.custom':['[自訂]', '[自定]', '[Custom]'],
  'ai3f.p.high':['高解析度', '高分辨率', 'High Resolution'], 'ai3f.p.medium':['中解析度', '中分辨率', 'Medium Resolution'], 'ai3f.p.low':['低解析度', '低分辨率', 'Low Resolution'],
  'ai3f.savePreset':['儲存預設集…', '存储预设…', 'Save Preset…'], 'ai3f.save':['儲存', '存储', 'Save'],
  'ai3f.balance':['點陣/向量平衡：', '栅格/矢量平衡：', 'Raster/Vector Balance:'], 'ai3f.rasters':['點陣', '栅格', 'Rasters'], 'ai3f.vectors':['向量', '矢量', 'Vectors'],
  'ai3f.lineArt':['線條圖和文字解析度 (ppi)：', '线稿图和文本分辨率 (ppi)：', 'Line Art and Text Resolution (ppi):'], 'ai3f.gradient':['漸層和網格解析度 (ppi)：', '渐变和网格分辨率 (ppi)：', 'Gradient and Mesh Resolution (ppi):'],
  'ai3f.text':['將所有文字轉換為外框', '将所有文本转换为轮廓', 'Convert All Text to Outlines'], 'ai3f.strokes':['將所有線條轉換為外框', '将所有描边转换为轮廓', 'Convert All Strokes to Outlines'],
  'ai3f.clip':['裁剪複雜區域', '剪切复杂区域', 'Clip Complex Regions'], 'ai3f.aa':['消除點陣圖鋸齒', '消除栅格锯齿', 'Anti-alias Rasters'],
  'ai3f.alpha':['保留 Alpha 透明度', '保留 Alpha 透明度', 'Preserve Alpha Transparency'], 'ai3f.overprints':['保留特別色和疊印', '保留叠印和专色', 'Preserve Overprints and Spot Colors'],
  'ai3f.preview':['預視', '预览', 'Preview'], 'ai3p.installed':['已安裝增效模組', '已安装增效工具', 'Installed plug-in']
};
if (window.Lang){ const add = {'zh-Hant':{}, 'zh-Hans':{}, en:{}}; Object.entries(STR).forEach(([k, [a, b, c]]) => { add['zh-Hant'][k] = a; add['zh-Hans'][k] = b; add.en[k] = c; }); Lang.add(add); }
window.AiFlatten = {composite, blendRgb, regions, fromParams, Plugins, describe};
})();

/* ═════════════ 对象菜单的快捷键（AI 模式＝当前层是矢量层时；照菜单树上写的 key：Ctrl+G 编组、Ctrl+Shift+G 取消编组、Ctrl+D 再次变换、Ctrl+] 前移……）
   对象菜单的键在这里接（不接的话 Ctrl+G 没反应、Ctrl+D 被 ui.js 当成取消选取）。
   AI 的 Ctrl+D＝再次变换（取消选取是 Ctrl+Shift+A）；还没做过任何变换时让给 ui.js 原本的取消选取（旧行为不变）。 ═════════════ */
(function(){
const typing = t => !!t && (t.isContentEditable || /^(input|select|textarea)$/i.test(t.tagName));
window.addEventListener('keydown', e => {
  if (!window.Menubar || Menubar.app !== 'ai' || !window.AiSel || !AiSel.keyFor || typing(e.target)) return;
  if (document.querySelector('.aidlg-back,.aifdlg-back,.aivdlg-back,#ellipseDlg')) return;
  const it = AiSel.keyFor('object', e); if (!it) return;
  if (it.id === 'object.transformAgain' && !((window.RotTool && RotTool.lastTransform) || (window.AIObj && AIObj.state && AIObj.state.lastTransform))) return;
  e.preventDefault(); e.stopImmediatePropagation();
  Menubar.run(it);
  if (window.UI) UI.draw();
}, true);
})();
