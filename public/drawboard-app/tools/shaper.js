/* 堤麟画板 · AI Shaper 工具（ai.shaper，AI 版面 Shift+N）
   照 VectorCraft 原码逐段翻：
     tools/src/extra.rs:219-296 ShaperTool  按下收第一点、拖曳每移 ≥1.5 屏幕像素收一点（放开不补点）；放开把整笔交给 recognize：
         直线 ⇒ shape.line；矩形 ⇒ shape.rectangle；椭圆 ⇒ shape.ellipse；正多边形 ⇒ shape.polygon（中心、半径、边数、旋转）；
         乱涂（Scribble）⇒ 每个取样点做一次点选命中（hit_test），命中的「顶层物件」去重后 select.set＋edit.clear 删掉；认不出 ⇒ 什么都不做。
         叠画＝拖过的折线（BLUE #4a7cff、1.5px）；Esc 清掉这一笔。
     geom/src/recognize.rs 全档 recognize：
         外框最长边 size < 2 ⇒ 不认；Douglas–Peucker（容差 size·0.08）后 >120° 的急转弯 ≥3 次且笔长 > 3·size ⇒ 乱涂；
         头尾距离 chord > 0.5·size、每点离弦 < 0.08·chord、笔长 < 1.3·chord ⇒ 直线；chord > 0.25·size ⇒ 开放的，不认；
         闭合：笔加回起点做 DP（size·0.12）得角点（头尾 <0.15·size 并一个），fill＝笔围面积／外框面积：
           3 角 ⇒ 三角形（半径＝角点到外框中心平均、旋转＝最上面那个角的方向 +90°）；4 角且 fill>0.86 ⇒ 矩形；4 角且 0.4≤fill<0.62 ⇒ 菱形（4 边形）；
           5..8 角且 0.6<fill<0.85 且笔贴着角点连成的直边（平均离边 <0.02·size）⇒ 正 n 边形；其余 fill>0.6 ⇒ 椭圆；矩形与椭圆长宽差 <10% 就吸成正方形／正圆。
     engine/src/cmd/create.rs:166-187 rectangle／ellipse／polygon（活形状、现用填色描边＝add_art、选中新形状）、:302 shape.line（只描边）；edit.rs:193 clear。
   我们这边：矩形／椭圆／多边形用 engine 的 rect／ellipse／polygon 活形状（填色＝现用填色、描边＝现用描边色与宽）；直线走 tools/line.js 的 line.create（同一个 shape.line 翻译）；
     命中照 doc/hit.rs（direct.js 同一套）：由上往下，描边按宽度＋3 屏幕像素容差、有填色就看里面；编组／复合路径整个算一个顶层物件。整笔一步历史（乱涂的删除也是一步）。
   ── 没抄的 ──  AI 2020 Shaper 的「把重叠形状拼成 Shaper 群组、再涂抹去合并／挖洞」原码没有，没做；原码只有上面这几样。 */
(function(){
'use strict';
const HK = window.HandKit;
const {sub, dot, cross, dist} = HK;

/* ── recognize.rs ── 点＝[x,y] */
function bbox(P){ let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of P){ x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return {x0, y0, x1, y1, w:x1 - x0, h:y1 - y0}; }
const pathLen = P => { let l = 0; for (let i = 1; i < P.length; i++) l += dist(P[i - 1], P[i]); return l; };
function distSeg(p, a, b){ const ab = sub(b, a), l2 = dot(ab, ab); if (l2 < 1e-12) return dist(p, a); const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)); return dist(p, [a[0] + ab[0]*t, a[1] + ab[1]*t]); }
/* recognize.rs:51-70 Douglas–Peucker（递回版，照原码） */
function simplify(P, tol){
  if (P.length < 3) return P.slice();
  const a = P[0], b = P[P.length - 1];
  let i = 0, d = 0;
  for (let k = 1; k < P.length - 1; k++){ const e = distSeg(P[k], a, b); if (e > d){ i = k; d = e; } }
  if (d <= tol) return [a, b];
  const left = simplify(P.slice(0, i + 1), tol), right = simplify(P.slice(i), tol);
  left.pop(); return left.concat(right);
}
const area = P => { let s = 0; for (let i = 0; i < P.length; i++){ s += cross(P[i], P[(i + 1) % P.length]); } return Math.abs(s) / 2; };
/* recognize.rs:77-86 reversals */
function reversals(P, minSeg){
  const s = simplify(P, minSeg); let c = 0;
  for (let i = 0; i + 2 < s.length; i++){
    const u = sub(s[i + 1], s[i]), v = sub(s[i + 2], s[i + 1]), lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu > minSeg && lv > minSeg && dot(u, v) / (lu * lv) < -0.5) c++;
  }
  return c;
}
/* recognize.rs:156-161 is_polygonal */
function isPolygonal(P, C, size){
  const n = C.length; let sum = 0;
  for (const p of P){ let m = Infinity; for (let i = 0; i < n; i++) m = Math.min(m, distSeg(p, C[i], C[(i + 1) % n])); sum += m; }
  return sum / P.length < 0.02 * size;
}
/* recognize.rs:89-152 recognize → {kind:'line'|'rectangle'|'ellipse'|'polygon'|'scribble', …} 或 null */
function recognize(P){
  if (P.length < 2) return null;
  const b = bbox(P), size = Math.max(b.w, b.h);
  if (size < 2) return null;
  const len = pathLen(P), first = P[0], last = P[P.length - 1];
  if (reversals(P, size * 0.08) >= 3 && len > 3 * size) return {kind:'scribble', rect:b};
  const chord = dist(first, last);
  const maxDev = P.reduce((m, p) => Math.max(m, distSeg(p, first, last)), 0);
  if (chord > 0.5 * size && maxDev < 0.08 * Math.max(chord, 1) && len < 1.3 * chord) return {kind:'line', a:first, b:last};
  if (chord > 0.25 * size) return null;
  const closed = P.concat([first]);
  const corners = simplify(closed, size * 0.12);
  if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < size * 0.15) corners.pop();
  const fill = area(P) / Math.max(b.w * b.h, 1e-9);
  const center = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const square = r => { if (Math.abs(r.w - r.h) < 0.1 * Math.max(r.w, r.h)){ const s = (r.w + r.h) / 2; return {x0:center[0] - s/2, y0:center[1] - s/2, w:s, h:s}; } return {x0:r.x0, y0:r.y0, w:r.w, h:r.h}; };
  const n = corners.length, avgR = () => corners.reduce((s, p) => s + dist(p, center), 0) / n;
  if (n === 3){
    const top = corners.reduce((m, p) => (p[1] < m[1] ? p : m), corners[0]);
    const rot = Math.atan2(top[1] - center[1], top[0] - center[0]) * 180 / Math.PI + 90;
    return {kind:'polygon', center, radius:avgR(), sides:3, rotation:rot};
  }
  if (n === 4 && fill > 0.86) return {kind:'rectangle', rect:square(b)};
  if (n === 4 && fill >= 0.4 && fill < 0.62) return {kind:'polygon', center, radius:avgR(), sides:4, rotation:0};
  if (n >= 5 && n <= 8 && fill > 0.6 && fill < 0.85 && isPolygonal(P, corners, size)) return {kind:'polygon', center, radius:avgR(), sides:n, rotation:0};
  if (fill > 0.6) return {kind:'ellipse', rect:square(b)};
  return null;
}

/* ── 命中（doc/hit.rs hit_test → top_object；跟 direct.js hitTest 同一套）── pt 文件坐标 → 顶层形状或 null */
let hctx = null;
function leafHit(c, s, p, tol, look){
  const v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) return false;
  c.beginPath(); bezierPath(c, v, 1);
  const sw = (painted(look.stroke) && (look.strokeWidth || 0) > 0) ? look.strokeWidth : 0;
  c.lineWidth = sw + 2 * tol; c.lineJoin = 'round'; c.lineCap = 'round';
  if (c.isPointInStroke(p[0], p[1])) return true;
  return painted(look.fill) && c.isPointInPath(p[0], p[1], 'nonzero');
}
const painted = x => !!x && x !== 'none';
function shapeHit(c, s, p, tol){
  if (!s || s.visible === false) return false;
  if (s.type === 'group' && Array.isArray(s.children)) return s.children.some(k => shapeHit(c, k, p, tol));
  if (s.type === 'compound' && Array.isArray(s.children)){
    c.beginPath(); s.children.forEach(k => { const v = VecSel.asBezier(k); if (v) bezierPath(c, v, 1); });
    const sw = (painted(s.stroke) && (s.strokeWidth || 0) > 0) ? s.strokeWidth : 0;
    c.lineWidth = sw + 2 * tol; c.lineJoin = 'round'; c.lineCap = 'round';
    if (c.isPointInStroke(p[0], p[1])) return true;
    return painted(s.fill) && c.isPointInPath(p[0], p[1], s.rule === 'evenodd' ? 'evenodd' : 'nonzero');
  }
  return leafHit(c, s, p, tol, s);
}
function hitTop(L, pt, tol){
  const c = hctx || (hctx = document.createElement('canvas').getContext('2d'));
  const p = [pt[0] - L.x, pt[1] - L.y], S = L.data.shapes;
  for (let k = S.length - 1; k >= 0; k--){ const s = S[k]; if (s.locked) continue; if (shapeHit(c, s, p, tol)) return s; }
  return null;
}

const fin = HK.fin;
/* 一笔 → 认形状、照结果改文件（一步历史） */
CMD.reg('shaper.stroke', {i18n:'', undoable:false,
  params:'{points:[[x,y]…] 文件坐标（手绘的一笔）, tolerance?:命中容差（文件单位，缺省 3 屏幕像素）, layerId?} ＝ Shaper 工具：把粗略的一笔认成干净的形状——' +
         '直线→直线段（只描边）；矩形→矩形；椭圆／圆→椭圆；三角形、菱形、5–8 边形→正多边形（都用现用填色与描边、选中新形状）；' +
         '来回乱涂→删掉涂过的顶层物件；认不出＝不改文件 → {ok, recognized:"line"|"rectangle"|"ellipse"|"polygon"|"scribble"|null, id?, sides?, deleted?}'}, p => {
  const C = 'shaper.stroke';
  const r = HK.pointsParam(p, 'points', C); if (r.err) return r.err;
  const rec = recognize(r.pts);
  if (!rec) return {ok:true, recognized:null};
  const look = {fill:UI.fill(), stroke:UI.stroke(), strokeWidth:UI.strokeW()};
  if (rec.kind === 'scribble'){
    const L = HK.layerOf(p); if (!L) return {ok:true, recognized:'scribble', deleted:[]};
    const tol = fin(p.tolerance) ? p.tolerance : HK.tol(3);
    const hits = [];
    for (const q of r.pts){ const s = hitTop(L, q, tol); if (s && !hits.includes(s)) hits.push(s); }
    if (!hits.length) return {ok:true, recognized:'scribble', deleted:[]};
    const f = HK.lockFail(L, C); if (f) return f;
    History.push();
    L.data.shapes = L.data.shapes.filter(s => !hits.includes(s));             // select.set ＋ edit.clear
    Layer.invalidate(L); VecSel.clear();
    return {ok:true, recognized:'scribble', deleted:hits.map(s => s.id), layerId:L.id};
  }
  // 新形状画进当前矢量层（不是矢量层就新建，同 addShape）
  const A = Doc.active();
  if (p.layerId){ const T = Doc.byId(p.layerId); if (!T || T.kind !== 'vector') return {ok:false, error:C + ': not a vector layer'}; }
  const tgt = p.layerId ? Doc.byId(p.layerId) : (A && A.kind === 'vector' ? A : null);
  if (tgt){ const f = HK.lockFail(tgt, C); if (f) return f; }
  History.push();
  let res;
  const lid = tgt ? {layerId:tgt.id} : {};
  if (rec.kind === 'line'){
    res = CMD.map['line.create'].run(Object.assign({x1:rec.a[0], y1:rec.a[1], x2:rec.b[0], y2:rec.b[1]}, lid));
  } else if (rec.kind === 'rectangle'){
    const b = rec.rect;
    res = addShape(Object.assign({type:'rect', x:b.x0, y:b.y0, w:b.w, h:b.h, radius:0}, look, lid));
  } else if (rec.kind === 'ellipse'){
    const b = rec.rect;
    res = addShape(Object.assign({type:'ellipse', x:b.x0, y:b.y0, w:b.w, h:b.h}, look, lid));
  } else {
    res = addShape(Object.assign({type:'polygon', cx:rec.center[0], cy:rec.center[1], r1:Math.abs(rec.radius), points:Math.max(3, Math.min(1000, rec.sides)), rotation:rec.rotation}, look, lid));
  }
  if (!res || res.ok === false || !res.id){ History.restoreInPlace(History.past.pop()); return res || {ok:false, error:C + ': failed'}; }
  VecSel.setShapes(res.layerId, [res.id]);                                    // add_art：sel.set([id])
  const out = {ok:true, recognized:rec.kind, id:res.id, layerId:res.layerId};
  if (rec.kind === 'polygon'){ out.sides = rec.sides; out.rotation = rec.rotation; out.center = rec.center; out.radius = rec.radius; }
  if (rec.rect) out.rect = {x:rec.rect.x0, y:rec.rect.y0, width:rec.rect.w, height:rec.rect.h};
  return out;
});
CMD.reg('shaper.recognize', {i18n:'',
  params:'{points:[[x,y]…]} 只认形状、不改文件（geom recognize.rs）→ {ok, recognized, …几何}'}, p => {
  const r = HK.pointsParam(p, 'points', 'shaper.recognize'); if (r.err) return r.err;
  const rec = recognize(r.pts);
  return Object.assign({ok:true, recognized:rec ? rec.kind : null}, rec || {});
});

const SG = HK.gesture({step:1.5, upAdd:false, finish(pts){ CMD.run('shaper.stroke', {points:pts}); }});
window.ShaperTool = {recognize, g:SG};

Tools.reg({
  id:'shaper', icon:'⬠', group:'vector', order:41, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.shaperHint',
  strings:{
    'zh-Hant':{'tool.shaper':'Shaper 工具', 'ui.shaperHint':'隨手畫矩形、圓、三角形、多邊形或直線＝變成工整的形狀｜在物件上來回亂塗＝刪掉它｜Esc 取消'},
    'zh-Hans':{'tool.shaper':'Shaper 工具', 'ui.shaperHint':'随手画矩形、圆、三角形、多边形或直线＝变成工整的形状｜在对象上来回乱涂＝删掉它｜Esc 取消'},
    'en':{'tool.shaper':'Shaper Tool', 'ui.shaperHint':'Sketch a rectangle, circle, triangle, polygon or line to get a clean shape | Scribble over art to delete it | Esc: cancel'}
  },
  onDown(e, pt){ SG.down(e, pt); },
  onMove(e, pt, P){ SG.move(e, pt, P); },
  onUp(e, pt){ SG.up(e, pt); },
  onKey(e){ return SG.key(e); },
  onDeactivate(){ SG.reset(); },
  drawOverlay(ctx, s){ SG.draw(ctx, s, HK.BLUE, 1.5, false); }
});
})();
