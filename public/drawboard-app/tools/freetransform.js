/* 堤麟画板 · 自由变换工具（E）—— 照 ArtCraft VectorCraft 原码逐段翻译
   原码：
     tools/src/xform/free.rs（全档 382 行：FreeTransformTool、DistortMode Free／Perspective／Distort、shear_for_side、distort_quad、classify、preview、overlays、cursor、options）
     tools/src/bbox.rs（150 行：Handle 八个把手顺时针由左上起、pos／opposite／is_corner／axes、hit_handle（方形容差）、in_rotate_zone（角外 inner..outer）、
                       scale_for_drag（Shift 等比、Alt 从中心、夹掉 0 缩放）、rotate_for_drag（Shift 45°）、move_delta（Shift 45°））
     engine/src/cmd/xform.rs:56-170（Projective::from_rect／apply／affine_near、warp_node、object.distort：把 from 外框的四角映到 corners 四点，锚点与把手逐点过投影）
     tools/src/lib.rs:269-275（size_label「W: …\nH: …」、offset_label「dX: …\ndY: …」）
     （原码的 xform/freeform.rs 是渐变工具的「任意形状渐变」批注器，跟自由变换无关，没抄）
   行为（free.rs）：
     按下：把手（tol(5) 方块）→ 角把手按着 Ctrl＋Alt＋Shift＝透视扭曲、按着 Ctrl＝自由扭曲，否则照工具选项 mode；
           Free 模式：边把手＋Ctrl＝沿那条边倾斜（Alt＝绕中心），其余把手＝缩放（Shift／Constrain 等比、Alt 从中心）；
           Perspective 模式：边把手＝缩放、角把手＝透视（沿主方向移、同边另一角反向）；Distort 模式：角／边把手＝那些角各自移动；
           Free 模式下角外 tol(5)..tol(18)＝旋转（绕外框中心，Shift 45°）；外框里面＝移动（Shift 45°）
     拖：离 tol(2) 才开始；Begin 标签 Move／Scale／Shear／Rotate／Distort；仿射走 object.transform、四角走 object.distort（都在 Begin 时的底稿上预览）
     放开：拖过＝Commit（一步历史）；Esc＝取消；换工具＝取消
     叠画：外框（拖时＝变形中的四边形）蓝线、四角与（非透视模式）四边中点空心方把手、读数
     游标：旋转／移动／上下／左右／斜向缩放；扭曲＝十字；没选东西＝箭头
     选项：mode（free／perspective／distort）、constrain（画面上的「强制」开关＝一直按着 Shift） */
(function(){
'use strict';
const K = window.XformKit;
if (!K){ console.error('freetransform.js: tools/reflect.js（XformKit）没载入'); return; }
const {A, BLUE, fin, dist, pt2, center, constrainAngle} = K;
const T = k => (typeof Lang !== 'undefined' ? Lang.t(k) : k);

/* ───────── bbox.rs ───────── */
const HANDLES = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];          // Handle::ALL（顺时针由左上起）
const isCorner = h => HANDLES.indexOf(h) % 2 === 0;
const opposite = h => HANDLES[(HANDLES.indexOf(h) + 4) % 8];
function hpos(h, r){
  const c = center(r);
  return {tl:[r.x0, r.y0], t:[c[0], r.y0], tr:[r.x1, r.y0], r:[r.x1, c[1]], br:[r.x1, r.y1], b:[c[0], r.y1], bl:[r.x0, r.y1], l:[r.x0, c[1]]}[h];
}
const axes = h => (h === 't' || h === 'b') ? [false, true] : (h === 'l' || h === 'r') ? [true, false] : [true, true];
function hitHandle(r, p, tol){ return HANDLES.find(h => { const q = hpos(h, r); return Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol; }) || null; }
const contains = (r, p) => p[0] >= r.x0 && p[0] < r.x1 && p[1] >= r.y0 && p[1] < r.y1;        // kurbo Rect::contains（右下不含）
function inRotateZone(r, p, inner, outer){
  return ['tl', 'tr', 'br', 'bl'].find(h => { const d = dist(p, hpos(h, r)); return d > inner && d <= outer && !contains(r, p); }) || null;
}
function scaleForDrag(r, h, p, proportional, fromCenter){
  const o = fromCenter ? center(r) : hpos(opposite(h), r), st = hpos(h, r), [ax, ay] = axes(h);
  const d0 = [st[0] - o[0], st[1] - o[1]], d1 = [p[0] - o[0], p[1] - o[1]];
  let sx = (ax && Math.abs(d0[0]) > 1e-9) ? d1[0] / d0[0] : 1, sy = (ay && Math.abs(d0[1]) > 1e-9) ? d1[1] / d0[1] : 1;
  const sg = v => v > 0 ? 1 : v < 0 ? -1 : 1;          // f64::signum（0 → 1）
  if (proportional){
    if (isCorner(h)){ const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = Math.abs(s) * sg(sx); sy = Math.abs(s) * sg(sy); }
    else if (ax) sy = Math.abs(sx); else sx = Math.abs(sy);
  }
  const clamp = s => Math.abs(s) < 1e-4 ? 1e-4 * (s < 0 ? -1 : 1) : s;
  return A.about(o, A.scale(clamp(sx), clamp(sy)));
}
function rotateForDrag(c, from, to, snap){
  let a = Math.atan2(to[1] - c[1], to[0] - c[0]) - Math.atan2(from[1] - c[1], from[0] - c[0]);
  if (snap){ const st = Math.PI / 4; a = Math.round(a / st) * st; }
  return {m:A.about(c, A.rotate(a)), deg:-a * 180 / Math.PI};
}
const moveDelta = (from, to, shift) => { const d = [to[0] - from[0], to[1] - from[1]]; return shift ? constrainAngle(d, 45) : d; };

/* ───────── free.rs ───────── */
/* shear_for_side：拖 h 那条边 d，绕对边（Alt＝中心） */
function shearForSide(r, h, d, fromCenter){
  const o = fromCenter ? center(r) : hpos(opposite(h), r), hp = hpos(h, r);
  let m;
  if (h === 't' || h === 'b'){ const lever = hp[1] - o[1]; const k = Math.abs(lever) > 1e-9 ? d[0] / lever : 0; m = [1, 0, k, 1, 0, 0]; }
  else { const lever = hp[0] - o[0]; const k = Math.abs(lever) > 1e-9 ? d[1] / lever : 0; m = [1, k, 0, 1, 0, 0]; }
  return A.about(o, m);
}
const cornerIndex = h => ({tl:0, tr:1, br:2, bl:3})[h];
const rectCorners = r => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
/* distort_quad：Perspective＝沿主方向移、同一边的另一角反向移；其余＝角自己移；边把手＝那条边的两角一起移 */
function distortQuad(r, h, d, mode){
  const q = rectCorners(r), i = cornerIndex(h);
  if (i !== undefined && mode === 'perspective'){
    if (Math.abs(d[0]) >= Math.abs(d[1])){ const pr = [1, 0, 3, 2][i]; q[i][0] += d[0]; q[pr][0] -= d[0]; }
    else { const pr = [3, 2, 1, 0][i]; q[i][1] += d[1]; q[pr][1] -= d[1]; }
  } else if (i !== undefined){ q[i][0] += d[0]; q[i][1] += d[1]; }
  else {
    const [a, b] = ({t:[0, 1], r:[1, 2], b:[2, 3]})[h] || [3, 0];
    q[a][0] += d[0]; q[a][1] += d[1]; q[b][0] += d[0]; q[b][1] += d[1];
  }
  return q;
}

/* ───────── engine cmd/xform.rs:56-132：Projective（单位方块→四边形的单应）、warp_node ───────── */
function projective(src, q){
  const [p0, p1, p2, p3] = q;
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  let g = 0, h = 0;
  if (!(Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12)){
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) >= 1e-12){ g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  }
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1];
  const sw = src.x1 - src.x0, sh = src.y1 - src.y0;
  const P = {
    apply(p){
      const u = Math.abs(sw) > 1e-12 ? (p[0] - src.x0) / sw : 0, v = Math.abs(sh) > 1e-12 ? (p[1] - src.y0) / sh : 0;
      let w = g * u + h * v + 1; if (Math.abs(w) < 1e-9) w = w < 0 ? -1e-9 : 1e-9;
      return [(a * u + b * v + p0[0]) / w, (d * u + e * v + p0[1]) / w];
    },
    /* affine_near：在 p 点的仿射近似（文字、图片等没有锚点的物件用；渐变也照它走） */
    affineNear(p){
      const eps = 1, o = this.apply(p), ex = this.apply([p[0] + eps, p[1]]), ey = this.apply([p[0], p[1] + eps]);
      const lin = [(ex[0] - o[0]) / eps, (ex[1] - o[1]) / eps, (ey[0] - o[0]) / eps, (ey[1] - o[1]) / eps, 0, 0];
      return A.mul(A.translate(o[0], o[1]), A.mul(lin, A.translate(-p[0], -p[1])));
    }
  };
  return P;
}
/* warp_node：路径＝丢掉活形状参数（live=None）、锚点与把手逐点过投影；编组／复合往下；其余＝在外框中心的仿射近似。
   渐变跟着在物件中心的仿射近似走（原码 warp_gradients 是在渐变自己的中心取近似；我们渐变向量是 GradientFill 管的，取物件中心）。 */
function warpNode(L, s, P){
  const toDoc = q => [q[0] + L.x, q[1] + L.y], f = q => { const r = P.apply(toDoc(q)); return [r[0] - L.x, r[1] - L.y]; };
  const b = K.shapeBounds(s, toDoc, false);
  const near = () => b ? A.toLayer(L, P.affineNear(center(b))) : null;
  if (K.isCont(s)){
    s.children.forEach(c => warpNode(L, c, P));
    if (s.type === 'compound' && window.GradientFill){ const m = near(); if (m){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); } }
    delete s.bboxAngle;
    return true;
  }
  if (K.isLeaf(s)){
    const m = near();
    if (!VecSel.ensureBezier(L, s)) return false;
    s.anchors = (s.anchors || []).map(a => Object.assign({}, a, (() => { const p = f([a.x, a.y]); return {x:p[0], y:p[1], in:a.in ? f(a.in) : null, out:a.out ? f(a.out) : null}; })()));
    if (m && window.GradientFill){ GradientFill.transform(s.fill, m); GradientFill.transform(s.stroke, m); }
    delete s.bboxAngle;
    return true;
  }
  const m = near(); if (!m) return true;
  return K.xformNode(L, s, m, {strokes:false, corners:false});
}

/* ───────── 工具本体 ───────── */
const ses = K.makeSession();
const FT = {
  mode: 'free',        // DistortMode
  constrain: false,    // 画面上的 Constrain 开关（＝按着 Shift）
  drag: null,          // {op:{k:'move'|'scale'|'shear'|'rotate'|'corners', h, mode}, rect, start, began, L}
  quad: null,          // 拖时变形中的四边形
  measure: null,
  hoverMods: {shift:false, alt:false, ctrl:false},
  ses,
  len(v){ return (Math.round(v * 100) / 100) + ' px'; },
  sel(){ const S = K.selection(); if (!S) return null; const r = K.boundsOf(S.L, S.list, false); return r ? Object.assign(S, {rect:r}) : null; },
  /* free.rs:128-149 classify */
  classify(r, p, m){
    const tol = VecSel.tol(5), h = hitHandle(r, p, tol);
    if (h){
      const mode = (isCorner(h) && m.ctrl && m.alt && m.shift) ? 'perspective' : (isCorner(h) && m.ctrl) ? 'distort' : this.mode;
      if (mode === 'free') return {k:(!isCorner(h) && m.ctrl) ? 'shear' : 'scale', h};
      if (mode === 'perspective' && !isCorner(h)) return {k:'scale', h};
      return {k:'corners', h, mode};
    }
    if (this.mode === 'free' && inRotateZone(r, p, tol, VecSel.tol(18))) return {k:'rotate'};
    return contains(r, p) ? {k:'move'} : null;
  },
  mods(e){ return {shift:!!e.shiftKey, alt:!!e.altKey, ctrl:!!(e.ctrlKey || e.metaKey)}; },
  /* free.rs:151-182 preview → {cmd, params} */
  compute(d, p, m){
    const shift = m.shift || this.constrain, delta = [p[0] - d.start[0], p[1] - d.start[1]], op = d.op;
    if (op.k === 'corners'){
      const q = distortQuad(d.rect, op.h, delta, op.mode);
      return {cmd:'freetransform.distort', params:{corners:q, from:[d.rect.x0, d.rect.y0, d.rect.x1, d.rect.y1]}, quad:q, measure:null};
    }
    let xf, measure = null;
    if (op.k === 'move'){ const v = moveDelta(d.start, p, shift); xf = A.translate(v[0], v[1]); measure = 'dX: ' + this.len(v[0]) + '\ndY: ' + this.len(v[1]); }
    else if (op.k === 'scale'){
      xf = scaleForDrag(d.rect, op.h, p, shift, m.alt);
      const pts = rectCorners(d.rect).map(c => A.apply(xf, c)), xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      measure = 'W: ' + this.len(Math.max(...xs) - Math.min(...xs)) + '\nH: ' + this.len(Math.max(...ys) - Math.min(...ys));
    }
    else if (op.k === 'shear') xf = shearForSide(d.rect, op.h, delta, m.alt);
    else { const r = rotateForDrag(center(d.rect), d.start, p, shift); xf = r.m; measure = (-r.deg).toFixed(1) + '°'; }
    return {cmd:'freetransform.transform', params:{matrix:xf, copy:false}, quad:rectCorners(d.rect).map(c => A.apply(xf, c)), measure};
  },
  label(op){ return {move:'Move', scale:'Scale', shear:'Shear', rotate:'Rotate', corners:'Distort'}[op.k]; },
  busy(){ return !!(this.drag && this.drag.began); },
  cancel(){ ses.cancel(); this.drag = null; this.quad = null; this.measure = null; },

  down(e, pt){
    this.drag = null;
    const S = this.sel(); if (!S) return;
    const op = this.classify(S.rect, pt, this.mods(e));
    if (op) this.drag = {op, rect:S.rect, start:pt.slice(), began:false, L:S.L};
  },
  move(e, pt){
    this.hoverMods = this.mods(e);
    const d = this.drag; if (!d) return;
    if (!d.began){
      if (dist(pt, d.start) < VecSel.tol(2)) return;
      if (window.Locks && Locks.deny(d.L, 'position')){ this.drag = null; return; }
      d.began = true; ses.begin(d.L);
    }
    const c = this.compute(d, pt, this.mods(e));
    this.quad = c.quad;
    this.measure = c.measure ? {p:pt.slice(), text:c.measure} : null;
    ses.preview(c.cmd, c.params);
    UI.draw();
  },
  up(){
    const d = this.drag; this.drag = null; this.quad = null; this.measure = null;
    if (d && d.began) ses.commit();
  },
  key(e){
    if (e.key === 'Escape' && this.busy()){ e.preventDefault(); this.cancel(); return true; }
    return false;
  },
  /* free.rs:267-281 cursor */
  cursor(p, m){
    const S = this.sel(); if (!S) return 'default';
    const op = this.drag ? this.drag.op : (p ? this.classify(S.rect, p, m || this.hoverMods) : null);
    if (!op) return 'default';
    if (op.k === 'rotate') return (typeof ROT_CURSOR !== 'undefined') ? ROT_CURSOR : 'alias';
    if (op.k === 'move') return 'move';
    if (op.k === 'corners') return 'crosshair';
    return ({t:'ns-resize', b:'ns-resize', l:'ew-resize', r:'ew-resize', tl:'nwse-resize', br:'nwse-resize', tr:'nesw-resize', bl:'nesw-resize'})[op.h];
  },
  syncCursor(p, e){ if (window.UI && UI.canvas && ToolState.cur === 'freetransform') UI.canvas.style.cursor = this.cursor(p, e ? this.mods(e) : null); },
  /* free.rs:246-265 overlays */
  drawOverlay(ctx, s){
    K.Draw.selection(ctx, s);
    const S = this.sel(), quad = this.quad || (S ? rectCorners(S.rect) : null); if (!quad) return;
    const dp = K.Draw.dpr(s);
    ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = BLUE; ctx.lineWidth = dp;
    ctx.beginPath(); quad.forEach((q, i) => i ? ctx.lineTo(q[0]*s, q[1]*s) : ctx.moveTo(q[0]*s, q[1]*s)); ctx.closePath(); ctx.stroke();
    const sq = q => { const h = 3*dp; ctx.fillStyle = '#fff'; ctx.fillRect(q[0]*s - h, q[1]*s - h, 2*h, 2*h); ctx.strokeRect(q[0]*s - h, q[1]*s - h, 2*h, 2*h); };
    for (let i = 0; i < 4; i++){
      const a = quad[i], b = quad[(i + 1) % 4];
      sq(a);
      if (this.mode !== 'perspective') sq([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    if (this.measure) K.Draw.measure(ctx, s, this.measure.p, this.measure.text);
    ctx.restore();
  }
};
window.FreeTransformTool = FT;

/* ───────── 命令 ───────── */
CMD.reg('freetransform.transform', {i18n:'', undoable:true,
  params:'{matrix:[a,b,c,d,e,f] 文件坐标仿射, copy?:bool, ids?, layerId?} 照 object.transform：自由变换的移动／缩放／旋转／倾斜都走这条（编组整棵套）→ {ok, ids, layerId}'}, p => {
  p = p || {};
  if (!A.finite(p.matrix)) return {ok:false, error:'freetransform.transform: missing matrix [a,b,c,d,e,f]'};
  const t = K.targets(p, 'freetransform.transform'); if (t.err) return t.err;
  const g = K.guard(t.L, 'position', 'freetransform.transform'); if (g) return g;
  return K.applyTransform(t.L, t.list, p.matrix.map(Number), p);
});
CMD.reg('freetransform.distort', {i18n:'', undoable:true,
  params:'{corners:[[x,y]×4]（左上、右上、右下、左下的新位置，文件坐标）, from?:[x0,y0,x1,y1]（缺省＝选取外框）, ids?, layerId?} ' +
         '照 object.distort（自由扭曲／透视扭曲）：把 from 外框的四角投影到 corners 四点，路径的锚点与把手逐点过投影（活形状先转成钢笔路径）；没锚点的物件用中心处的仿射近似 → {ok, ids}'}, p => {
  p = p || {};
  const q = Array.isArray(p.corners) ? p.corners.map(pt2).filter(Boolean) : [];
  if (q.length !== 4) return {ok:false, error:'freetransform.distort: corners must be 4 [x,y] points (TL, TR, BR, BL)'};
  const t = K.targets(p, 'freetransform.distort'); if (t.err) return t.err;
  let src;
  if (Array.isArray(p.from)){
    if (p.from.length !== 4 || !p.from.every(v => fin(+v))) return {ok:false, error:'freetransform.distort: from must be [x0,y0,x1,y1]'};
    src = {x0:+p.from[0], y0:+p.from[1], x1:+p.from[2], y1:+p.from[3]};
  } else { src = K.boundsOf(t.L, t.list, false); if (!src) return {ok:false, error:'nothing to distort'}; }
  if (Math.abs(src.x1 - src.x0) < 1e-9 || Math.abs(src.y1 - src.y0) < 1e-9) return {ok:false, error:'cannot distort a zero-size bounding box'};
  const g = K.guard(t.L, 'position', 'freetransform.distort'); if (g) return g;
  const P = projective(src, q);
  for (const s of t.list){
    if (!warpNode(t.L, s, P)) return {ok:false, error:'cannot distort object ' + s.id};
    const bad = JSON.stringify(s, (k, v) => (typeof v === 'number' && !isFinite(v)) ? '__NaN__' : v).includes('__NaN__');
    if (bad) return {ok:false, error:'distort gives non-finite coordinates'};
  }
  Layer.invalidate(t.L);
  return {ok:true, ids:t.list.map(s => s.id)};
});
CMD.reg('freetransform.drag', {i18n:'', undoable:true,
  params:'{x0, y0 按下点, x1, y1 放开点（文件坐标）, shift?, alt?, ctrl?（Ctrl／⌘）, mode?:"free"|"perspective"|"distort"（缺省＝工具选项）} ' +
         '＝用自由变换工具从 (x0,y0) 拖到 (x1,y1)：按下点在把手上＝缩放（Shift 等比、Alt 从中心；边把手＋Ctrl＝倾斜）／角外＝旋转／外框里＝移动；' +
         '角把手＋Ctrl＝自由扭曲、＋Ctrl＋Alt＋Shift＝透视扭曲；mode 不是 free 时角把手就扭曲 → {ok, op, handle?, ids}'}, p => {
  p = p || {};
  if (![p.x0, p.y0, p.x1, p.y1].every(fin)) return {ok:false, error:'freetransform.drag: x0,y0,x1,y1 are required numbers'};
  const S = FT.sel(); if (!S) return {ok:false, error:'freetransform.drag: nothing selected'};
  const keep = FT.mode; if (p.mode) FT.mode = String(p.mode) === 'freeDistort' ? 'distort' : String(p.mode);
  const m = {shift:!!p.shift, alt:!!p.alt, ctrl:!!p.ctrl};
  try {
    const op = FT.classify(S.rect, [p.x0, p.y0], m);
    if (!op) return {ok:false, error:'freetransform.drag: (x0,y0) is not on the bounding box'};
    const c = FT.compute({op, rect:S.rect, start:[p.x0, p.y0]}, [p.x1, p.y1], m);
    const r = CMD.map[c.cmd].run(c.params);
    return r && r.ok ? Object.assign(r, {op:op.k, handle:op.h || null, mode:op.mode || FT.mode}) : r;
  } finally { FT.mode = keep; }
});
CMD.reg('freetransform.options', {i18n:'',
  params:'{mode?:"free"|"perspective"|"distort", constrain?:bool} 自由变换工具选项（工具列：自由变换／透视扭曲／自由扭曲、强制＝等比／45°）；不给＝只读 → {mode, constrain}'}, p => {
  p = p || {};
  if (p.mode !== undefined) FT.mode = p.mode === 'perspective' ? 'perspective' : (p.mode === 'distort' || p.mode === 'freeDistort') ? 'distort' : 'free';
  if (p.constrain !== undefined) FT.constrain = !!p.constrain;
  if (window.UI) UI.draw();
  return {ok:true, mode:FT.mode, constrain:FT.constrain};
});

const FT_STRINGS = {
  'zh-Hant':{'ui.freetransformHint':'拖把手＝縮放（Shift／強制＝等比、Alt＝從中心）· 角外＝旋轉 · 框內＝移動 · Ctrl＋拖邊把手＝傾斜 · Ctrl＋拖角＝隨意扭曲 · Ctrl＋Alt＋Shift＋拖角＝透視扭曲 · Esc 取消',
             'opt.ftMode':'模式', 'ui.ftFree':'任意變形', 'ui.ftPerspective':'透視扭曲', 'ui.ftDistort':'隨意扭曲', 'opt.ftConstrain':'強制'},
  'zh-Hans':{'ui.freetransformHint':'拖把手＝缩放（Shift／限制＝等比、Alt＝从中心）· 角外＝旋转 · 框内＝移动 · Ctrl＋拖边把手＝倾斜 · Ctrl＋拖角＝自由扭曲 · Ctrl＋Alt＋Shift＋拖角＝透视扭曲 · Esc 取消',
             'opt.ftMode':'模式', 'ui.ftFree':'自由变换', 'ui.ftPerspective':'透视扭曲', 'ui.ftDistort':'自由扭曲', 'opt.ftConstrain':'限制'},
  'en':{'ui.freetransformHint':'Drag a handle to scale (Shift / Constrain: proportional, Alt: from centre) · outside a corner rotates · inside moves · Ctrl+drag a side shears · Ctrl+drag a corner: Free Distort · Ctrl+Alt+Shift+drag a corner: Perspective Distort · Esc cancels',
        'opt.ftMode':'Mode', 'ui.ftFree':'Free Transform', 'ui.ftPerspective':'Perspective Distort', 'ui.ftDistort':'Free Distort', 'opt.ftConstrain':'Constrain'}
};
if (typeof Lang !== 'undefined') Lang.add(FT_STRINGS);

Tools.reg({
  id:'freetransform', group:'vector', order:66, for:'vector', opts:[], cursor:'default', hint:'ui.freetransformHint',
  onDown(e, pt){ FT.down(e, pt); FT.syncCursor(pt, e); UI.draw(); },
  onMove(e, pt){ FT.move(e, pt); FT.syncCursor(pt, e); if (!FT.busy()) UI.draw(); },
  onUp(e, pt){ FT.up(e, pt); FT.syncCursor(pt, e); UI.draw(); },
  onKey(e){ const r = FT.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ FT.cancel(); },
  buildOptions(box, add, mk){
    const sel = document.createElement('select');
    [['free', 'ui.ftFree'], ['perspective', 'ui.ftPerspective'], ['distort', 'ui.ftDistort']].forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.textContent = T(k); sel.appendChild(o); });
    sel.value = FT.mode; sel.onchange = () => CMD.run('freetransform.options', {mode:sel.value});
    add('ftMode', sel);
    const cb = mk('checkbox', {checked:FT.constrain});
    cb.onchange = () => CMD.run('freetransform.options', {constrain:cb.checked});
    add('ftConstrain', cb);
  },
  drawOverlay(ctx, s){ FT.drawOverlay(ctx, s); }
});
})();
