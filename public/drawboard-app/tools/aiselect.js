/* 堤麟画板 · AI 选择工具（V）—— 照 ArtCraft VectorCraft 原码逐段翻译
   AI 版面的「选择工具」若借 PS 的移动工具（tools/move.js：整层搬），点不到物件、Alt 拖不会复制物件、没有定界框可旋转／缩放、
   Ctrl+D 再制也就记不到位移 ⇒ 照 VectorCraft 的 SelectionTool 另做一颗。
   原码：
     tools/src/select.rs（全档 409 行：99-245 pointer、247-259 overlays、261-302 cursor／handle_cursor、304-409 tests）
     tools/src/bbox.rs（150 行：Handle、hit_handle、in_rotate_zone、scale_for_drag、rotate_for_drag、move_delta）
     doc/src/hit.rs:191-240 marquee（顶层物件只要碰到框就选：路径＝geom/hit.rs:28-54 intersects_rect；编组＝任一看得见的成员碰到）
     tools/src/lib.rs:276 hit_options（tol(3)）、269-275 size_label／offset_label
     engine/src/cmd/object.rs:207-225 apply_transform（copy＝先复制、记 Transform Again）——用 XformKit.applyTransform（同一份翻译）
   行为（select.rs:118-245）：
     按下：定界框（显示时）的把手 tol(5) ⇒ 缩放（Shift 等比、Alt 从中心；框跟着物件角度转、沿物件自己的轴缩放）；
           角外 tol(5)..tol(18) ⇒ 旋转（绕框中心，Shift 锁 45°）；
           点到物件（顶层物件）⇒ Shift＝加／减选；没选的＝只选它；然后准备拖；点空白 ⇒ 框选（Shift＝加选）
     拖：离 tol(3) 才开始；平移（Shift 锁 45°），每一刻按着 Alt＝复制（放开那一刻算数）；读数 dX／dY、W／H、角度
     放开：拖过＝一步历史（记进「再次变换」⇒ Ctrl+D 照样再来一次）；框选比 tol(3) 小＝（没按 Shift）全部取消选取
   我们这边：选取存 VecSel（一次一层）；物件在图层坐标、滑鼠点是文件坐标；改文件一律走命令 aiselect.transform（agent 叫同一条）。 */
(function(){
'use strict';
const K = () => {
  if (!window.XformKit) throw new Error('aiselect.js: tools/reflect.js（XformKit）没载入');
  return window.XformKit;
};
const T = k => (typeof Lang !== 'undefined' ? Lang.t(k) : k);
const fin = v => typeof v === 'number' && isFinite(v);

/* ───────── bbox.rs ───────── */
const HANDLES = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];          // Handle::ALL（顺时针由左上起）
const isCorner = h => HANDLES.indexOf(h) % 2 === 0;
const opposite = h => HANDLES[(HANDLES.indexOf(h) + 4) % 8];
const ctr = r => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
function hpos(h, r){
  const c = ctr(r);
  return {tl:[r.x0, r.y0], t:[c[0], r.y0], tr:[r.x1, r.y0], r:[r.x1, c[1]], br:[r.x1, r.y1], b:[c[0], r.y1], bl:[r.x0, r.y1], l:[r.x0, c[1]]}[h];
}
const axes = h => (h === 't' || h === 'b') ? [false, true] : (h === 'l' || h === 'r') ? [true, false] : [true, true];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function hitHandle(r, p, tol){ return HANDLES.find(h => { const q = hpos(h, r); return Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol; }) || null; }
const contains = (r, p) => p[0] >= r.x0 && p[0] < r.x1 && p[1] >= r.y0 && p[1] < r.y1;        // kurbo Rect::contains
function inRotateZone(r, p, inner, outer){
  return ['tl', 'tr', 'br', 'bl'].find(h => { const d = dist(p, hpos(h, r)); return d > inner && d <= outer && !contains(r, p); }) || null;
}
function scaleForDrag(r, h, p, proportional, fromCenter){
  const A = K().A;
  const o = fromCenter ? ctr(r) : hpos(opposite(h), r), st = hpos(h, r), [ax, ay] = axes(h);
  const d0 = [st[0] - o[0], st[1] - o[1]], d1 = [p[0] - o[0], p[1] - o[1]];
  let sx = (ax && Math.abs(d0[0]) > 1e-9) ? d1[0] / d0[0] : 1, sy = (ay && Math.abs(d0[1]) > 1e-9) ? d1[1] / d0[1] : 1;
  const sg = v => v < 0 ? -1 : 1;
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
  return {m:K().A.about(c, K().A.rotate(a)), deg:-a * 180 / Math.PI};
}
const moveDelta = (from, to, shift) => { const d = [to[0] - from[0], to[1] - from[1]]; return shift ? K().constrainAngle(d, 45) : d; };

/* OrientedBox（doc/src/orient.rs）：{angle（逆时针度）, rect（物件自己的座标）, center（文件）}；to_local／conjugate */
function frame(bx){
  const A = K().A, toDoc = A.rotate(-bx.angle * Math.PI / 180), toLocal = A.inverse(toDoc);
  return {
    local:p => A.apply(toLocal, p), doc:p => A.apply(toDoc, p),
    conjugate:a => A.mul(toDoc, A.mul(a, toLocal))
  };
}

/* ───────── marquee（doc/src/hit.rs:191-240 ＋ geom/hit.rs:28-54 intersects_rect）：r＝图层坐标 ───────── */
function segX(a, b, c, d){                                 // 两线段相交
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function pathTouches(s, r){
  const v = VecSel.asBezier(s); if (!v || !v.anchors || !v.anchors.length) return false;
  const kit = K(), b = kit.viewBounds(v, q => q); if (!b) return false;
  const ix0 = Math.max(b.x0, r.x0), iy0 = Math.max(b.y0, r.y0), ix1 = Math.min(b.x1, r.x1), iy1 = Math.min(b.y1, r.y1);
  const flat = b.x1 - b.x0 === 0 || b.y1 - b.y0 === 0;
  if (!(ix1 > ix0 && iy1 > iy0) && !flat) return false;
  const inR = p => p[0] >= r.x0 && p[0] < r.x1 && p[1] >= r.y0 && p[1] < r.y1;
  if (v.anchors.some(a => inR([a.x, a.y]))) return true;
  const E = [[[r.x0, r.y0], [r.x1, r.y0]], [[r.x1, r.y0], [r.x1, r.y1]], [[r.x1, r.y1], [r.x0, r.y1]], [[r.x0, r.y1], [r.x0, r.y0]]];
  const poly = [];
  for (const c of VecSel.segments(v)){
    let prev = c.p0; if (!poly.length) poly.push(prev);
    for (let i = 1; i <= 24; i++){
      const q = VecSel.evalCubic(c, i / 24);
      if (E.some(e => segX(prev, q, e[0], e[1]))) return true;
      poly.push(q); prev = q;
    }
  }
  if (!v.closed) return false;
  const m = ctr(r); let w = 0;                             // 框整个在闭合形状里面（nonzero）
  for (let i = 0; i < poly.length; i++){
    const a = poly[i], c = poly[(i + 1) % poly.length];
    if ((a[1] <= m[1]) !== (c[1] <= m[1])){ const x = a[0] + (m[1] - a[1]) / (c[1] - a[1]) * (c[0] - a[0]); if (x > m[0]) w += c[1] > a[1] ? 1 : -1; }
  }
  return w !== 0;
}
function touches(s, r){
  const kit = K();
  if (s.type === 'group' || s.type === 'compound') return (s.children || []).some(c => c.visible !== false && touches(c, r));
  if (kit.isLeaf(s)) return pathTouches(s, r);
  const b = kit.shapeBounds(s, q => q, false); if (!b) return false;
  const ix0 = Math.max(b.x0, r.x0), iy0 = Math.max(b.y0, r.y0), ix1 = Math.min(b.x1, r.x1), iy1 = Math.min(b.y1, r.y1);
  return (ix1 > ix0 && iy1 > iy0) || (b.x0 >= r.x0 && b.x0 < r.x1 && b.y0 >= r.y0 && b.y0 < r.y1);
}
function marqueeIds(L, r){
  const lr = {x0:r.x0 - L.x, y0:r.y0 - L.y, x1:r.x1 - L.x, y1:r.y1 - L.y};
  const I = isoGroup();                                    // 隔离模式：只框隔离编组里的物件
  if (I) return I.L.id === L.id ? I.kids.filter(s => s.visible !== false && !s.locked && touches(s, lr)).map(s => s.id) : [];
  return L.data.shapes.filter(s => s.visible !== false && !s.locked && touches(s, lr)).map(s => s.id);
}
function vecLayer(){
  const L = VecSel.layer();
  if (L && L.kind === 'vector') return L;
  const A = Doc.active(); return A && A.kind === 'vector' ? A : null;
}
function selectIds(L, ids, add){
  if (L.id !== Doc.activeId && CMD.map['layer.select']) CMD.run('layer.select', {id:L.id});
  if (add){
    if (VecSel.layerId !== L.id) VecSel.setShapes(L.id, []);
    VecSel.layerId = ids.length || VecSel.shapes.length ? L.id : VecSel.layerId;
    ids.forEach(id => { if (!VecSel.shapes.includes(id)) VecSel.shapes.push(id); delete VecSel.anchors[id]; });
    if (!VecSel.shapes.length) VecSel.layerId = null;
  } else VecSel.setShapes(L.id, ids);
  if (window.AiSel) AiSel.text = [];
}

/* ───────── 智能参考线（AI 2020：视图 ▸ 智能参考线开着时，拖物件会吸到别的物件的锚点／中心／路径，并对齐边与中心；洋红线＋标签）─────────
   目标照 rect.js collectTargets 那套（guides.rs Targets::collect：画板＋每个物件的锚点、外框四角与中心），但不含正在拖的物件；
   另加「路径」：抓住的那一点贴到别的物件的路径上。拖的那一方取：选取外框四角、中心、锚点、抓住的点。 */
const MAGENTA = '#ff3dfc';
const smartOn = () => !(window.AiView && AiView.flags && AiView.flags.smartGuides === false);
function leafPolys(s, f, out){
  if (s.visible === false) return out;
  if (s.type === 'group' || s.type === 'compound'){ (s.children || []).forEach(c => leafPolys(c, f, out)); return out; }
  if (!K().isLeaf(s)) return out;
  const v = VecSel.asBezier(s); if (!v || !v.anchors || v.anchors.length < 2) return out;
  const P = [f([v.anchors[0].x, v.anchors[0].y])];
  for (const c of VecSel.segments(v)) for (let i = 1; i <= 12; i++) P.push(f(VecSel.evalCubic(c, i / 12)));
  out.push(P); return out;
}
function smartTargets(exclude){
  const kit = K(), t = {points:[], xs:[], ys:[], polys:[]};
  const addRect = (r, kind) => {
    const c = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    for (const p of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]){ t.xs.push([p[0], p, kind]); t.ys.push([p[1], p, kind]); }
    t.points.push([c, 'center']); t.xs.push([c[0], c, 'center']); t.ys.push([c[1], c, 'center']);
  };
  addRect({x0:0, y0:0, x1:Doc.width, y1:Doc.height}, 'artboard');
  let budget = 20000;
  for (const L of Doc.layers){
    if (L.kind !== 'vector' || !L.visible) continue;
    const f = kit.docF(L);
    const visit = arr => arr.forEach(s => {
      if (s.visible === false || exclude.has(s.id) || budget <= 0) return;
      if (ST.iso && ST.iso.layerId === L.id && (s.type === 'group' || s.type === 'compound') && ST.iso.ids.includes(s.id)){ visit(s.children || []); return; }   // 隔离中：编组里的兄弟物件各自当目标
      kit.anchorsOf(L, s).forEach(a => { if (budget-- > 0) t.points.push([a, 'anchor']); });
      const b = kit.shapeBounds(s, f, false); if (b) addRect(b, 'edge');
      if (t.polys.length < 4000) leafPolys(s, f, t.polys);
    });
    visit(L.data.shapes);
  }
  return t;
}
/* 拖的一方（文件坐标、起始位置）：外框四角＋中心（kind＝中心）、锚点、抓住的那点 */
function movingPoints(S, grab){
  const kit = K(), out = [{p:grab.slice(), grab:true}];
  const b = kit.boundsOf(S.L, S.list, false);
  if (b){ [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].forEach(p => out.push({p})); out.push({p:ctr(b), center:true}); }
  let n = 0; for (const s of S.list) for (const a of kit.anchorsOf(S.L, s)){ if (n++ > 400) break; out.push({p:a}); }
  return out;
}
function nearestOnPolys(polys, p, tol){
  let best = null, bd = tol;
  for (const P of polys) for (let i = 1; i < P.length; i++){
    const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    if (Math.min(a[0], b[0]) - tol > p[0] || Math.max(a[0], b[0]) + tol < p[0] || Math.min(a[1], b[1]) - tol > p[1] || Math.max(a[1], b[1]) + tol < p[1]) continue;
    let u = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
    const q = [a[0] + dx * u, a[1] + dy * u], d = dist(q, p);
    if (d <= bd){ bd = d; best = q; }
  }
  return best;
}
/* 位移 d 吸附：先点对点（锚点／中心），再抓住点贴路径，再 x、y 各自对齐 → {d, guides:[{type:'line',a,b}|{type:'label',p,kind}]} */
function smartSnap(t, mv, d, tol){
  let best = null, bd = tol;
  for (const m of mv){
    const q = [m.p[0] + d[0], m.p[1] + d[1]];
    for (const [p, k] of t.points){ const dd = Math.abs(p[0] - q[0]) <= bd && Math.abs(p[1] - q[1]) <= bd ? dist(p, q) : Infinity; if (dd <= bd){ bd = dd; best = {m, p, k}; } }
  }
  if (best) return {d:[best.p[0] - best.m.p[0], best.p[1] - best.m.p[1]], guides:[{type:'label', p:best.p, kind:best.k}]};
  const g = mv[0], gq = [g.p[0] + d[0], g.p[1] + d[1]], on = nearestOnPolys(t.polys, gq, tol);
  if (on) return {d:[on[0] - g.p[0], on[1] - g.p[1]], guides:[{type:'label', p:on, kind:'path'}]};
  const out = d.slice(), gs = [];
  let bx = null, dx = tol, by = null, dy = tol;
  for (const m of mv){
    const q = [m.p[0] + d[0], m.p[1] + d[1]];
    for (const e of t.xs){ const v = Math.abs(e[0] - q[0]); if (v <= dx){ dx = v; bx = {e, m}; } }
    for (const e of t.ys){ const v = Math.abs(e[0] - q[1]); if (v <= dy){ dy = v; by = {e, m}; } }
  }
  if (bx) out[0] = bx.e[0] - bx.m.p[0];
  if (by) out[1] = by.e[0] - by.m.p[1];
  if (bx){ const q = [bx.m.p[0] + out[0], bx.m.p[1] + out[1]]; gs.push({type:'line', a:bx.e[1], b:q}); if (bx.e[2] === 'center' || bx.m.center) gs.push({type:'label', p:q, kind:'center'}); }
  if (by){ const q = [by.m.p[0] + out[0], by.m.p[1] + out[1]]; gs.push({type:'line', a:by.e[1], b:q}); if ((by.e[2] === 'center' || by.m.center) && !gs.some(x => x.type === 'label')) gs.push({type:'label', p:q, kind:'center'}); }
  return {d:out, guides:gs};
}
/* 缩放、旋转也吸智能参考线（AI 2020：首选项 ▸ 智能参考线 ▸「变换工具」开着时；缩放＝拖的边／中心对齐别的物件边／中心，旋转＝吸「结构参考线」角度） */
const aiPref = k => (window.AiEdit && AiEdit.prefs && AiEdit.prefs.values) ? AiEdit.prefs.values[k] : undefined;
const xformGuidesOn = () => smartOn() && aiPref('transformToolsGuides') !== false;
/* 缩放：pt＝游标（文件坐标）→ {pt（吸好的）, guides}；先角把手贴点，再（框没转过时）拖的边／新外框中心对齐 x、y */
function scaleSnap(t, bx, h, pt, fromCenter, tol){
  const r = bx.rect, [ax, ay] = axes(h), F = frame(bx);
  if (isCorner(h)){
    let best = null, bd = tol;
    for (const [p, k] of t.points){ if (Math.abs(p[0] - pt[0]) > bd || Math.abs(p[1] - pt[1]) > bd) continue; const d = dist(p, pt); if (d <= bd){ bd = d; best = [p, k]; } }
    if (best) return {pt:best[0].slice(), guides:[{type:'label', p:best[0], kind:best[1]}]};
  }
  if (Math.abs(((bx.angle || 0) % 360 + 360) % 360) > 1e-6 && Math.abs(((bx.angle || 0) % 360 + 360) % 360 - 360) > 1e-6) return {pt, guides:[]};
  const o = fromCenter ? ctr(r) : F.doc(hpos(opposite(h), r)), out = pt.slice(), gs = [];
  [[ax, t.xs, 0], [ay, t.ys, 1]].forEach(([on, list, k]) => {
    if (!on) return;
    let best = null, bd = tol;
    for (const e of list){
      const cands = [[e[0], 'edge']];                                       // 拖的那条边贴上
      if (fromCenter) cands.push([2 * o[k] - e[0], 'edge']);                // Alt：对边一起动，对边贴上也算
      else cands.push([2 * e[0] - o[k], 'center']);                         // 新外框中心对齐
      for (const [v, kind] of cands){ const d = Math.abs(v - pt[k]); if (d <= bd){ bd = d; best = {v, kind, e}; } }
    }
    if (best){ out[k] = best.v; best.k = k; gs.push(best); }
  });
  const guides = [];
  for (const g of gs){
    const k = g.k, q = out.slice();
    if (g.kind === 'center'){ q[k] = (o[k] + out[k]) / 2; q[1 - k] = (o[1 - k] + out[1 - k]) / 2; guides.push({type:'label', p:q.slice(), kind:'center'}); }
    else if (q[k] !== g.e[0]){ q[k] = 2 * o[k] - out[k]; }
    guides.push({type:'line', a:g.e[1], b:q});
  }
  return {pt:out, guides};
}
/* 旋转：「结构参考线」角度（首选项 Angles：90° & 45°／30°／45°／60°／90°／90° & 45° & 30°）的倍数 */
function snapAngles(){
  const s = String(aiPref('constructionAngles') || '90° & 45° Angles'), steps = (s.match(/\d+/g) || ['45']).map(Number).filter(n => n > 0);
  const set = new Set(); steps.forEach(n => { for (let a = 0; a < 360; a += n) set.add(a); }); return [...set];
}
function rotateSnap(c, from, to, tol){
  let a = Math.atan2(to[1] - c[1], to[0] - c[0]) - Math.atan2(from[1] - c[1], from[0] - c[0]);
  const deg = -a * 180 / Math.PI, rad = Math.max(dist(to, c), 1e-6), tolDeg = Math.min(5, Math.max(0.5, Math.atan(tol / rad) * 180 / Math.PI));
  let best = null, bd = tolDeg;
  for (const s of snapAngles()){ const d = Math.abs(((deg - s) % 360 + 540) % 360 - 180); if (d <= bd){ bd = d; best = s; } }
  if (best === null) return null;
  const k = Math.round((deg - best) / 360), snapped = best + 360 * k, ar = -snapped * Math.PI / 180;
  const dir = Math.atan2(to[1] - c[1], to[0] - c[0]) + (ar - a), end = [c[0] + Math.cos(dir) * rad, c[1] + Math.sin(dir) * rad];
  return {m:K().A.about(c, K().A.rotate(ar)), deg:snapped, guides:[{type:'line', a:c.slice(), b:end}, {type:'label', p:end, kind:'angle'}]};
}

/* ───────── 隔离模式（AI 2020：选择工具双击编组＝进隔离模式；其他物件变淡、不能选；画板上方灰条显示路径；Esc／双击空白处退出）───────── */
/* 隔离的东西（AI 2020 扩到：编组、复合路径、单一路径、符号实例（编辑符号定义）、图层（图层面板「进入隔离模式」））
   → {L, G（被隔离的物件；图层＝null）, kids（隔离中点得到／框得到的物件）} */
function isoGroup(){
  const I = ST.iso; if (!I) return null;
  const L = Doc.byId(I.layerId);
  const bad = () => { ST.iso = null; syncIsoBar(); return null; };
  if (!L || L.kind !== 'vector') return bad();
  if (!I.ids.length) return I.layer ? {L, G:null, kids:L.data.shapes} : bad();
  const h = K().findDeep(L, I.ids[I.ids.length - 1]); if (!h) return bad();
  const s = h.s;
  if (s.type === 'group' || s.type === 'compound') return {L, G:s, kids:s.children || []};
  if (K().isLeaf(s) || s.symbol) return {L, G:s, kids:[s]};                // 单一路径（或单一形状的符号实例）：只剩它自己点得到
  return bad();
}
const isoable = s => !!s && ((s.type === 'group' && (!s.clip || s.symbol)) || s.type === 'compound' || K().isLeaf(s) || !!s.symbol);
/* 只在隔离的编组里面命中（照 reflect.js hitChildren）：→ 编组内的链 [直接子物件…叶子] */
function hitInGroup(kids0, p, tol){
  const kit = K();
  const rec = (kids, chain) => {
    for (let k = kids.length - 1; k >= 0; k--){
      const s = kids[k]; if (!s || s.visible === false || s.locked) continue;
      const b = kit.shapeBounds(s, q => q, true);
      if (b && !kit.inRect(kit.inflate(b, tol), p)) continue;
      if (s.type === 'group'){ const h = rec(s.children || [], chain.concat([s])); if (h) return h; if (s.live) return chain.concat([s]); }
      else if (kit.hitLeaf(s, p, tol)) return chain.concat([s]);
    }
    return null;
  };
  return rec(kids0 || [], []);
}
function syncIsoBar(){
  let bar = document.getElementById('aiIsoBar');
  const g = ST.iso && Doc.byId(ST.iso.layerId);
  if (!g){ if (bar) bar.remove(); return; }
  const wrap = document.getElementById('canvasWrap'); if (!wrap) return;
  if (!bar){
    bar = document.createElement('div'); bar.id = 'aiIsoBar';
    bar.style.cssText = 'position:fixed;z-index:50;height:22px;display:flex;align-items:center;gap:6px;padding:0 8px;background:#b8b8b8;color:#222;font:12px sans-serif;border-bottom:1px solid #888;box-sizing:border-box;cursor:default';
    bar.addEventListener('dblclick', e => { if (e.target === bar){ e.stopPropagation(); CMD.run('ai.isolate.exit', {all:true}); } });
    document.body.appendChild(bar);
  }
  const r = wrap.getBoundingClientRect();
  Object.assign(bar.style, {left:r.left + 'px', top:r.top + 'px', width:r.width + 'px'});
  bar.innerHTML = '';
  const back = document.createElement('span'); back.textContent = '◀'; back.className = 'back'; back.title = T('ui.isoExit'); back.style.cssText = 'cursor:pointer;padding:0 4px';
  back.onclick = e => { e.stopPropagation(); CMD.run('ai.isolate.exit', {}); };
  bar.appendChild(back);
  const kindName = s => s.symbol ? T('ui.isoSymbol') + ' ' + s.symbol : s.type === 'group' ? '<' + T('ui.isoGroup') + '>' : s.type === 'compound' ? '<' + T('ui.isoCompound') + '>' : '<' + T('ui.isoPath') + '>';
  const L = g, names = [L.name].concat(ST.iso.ids.map(id => { const h = K().findDeep(L, id); return h ? (h.s.symbol ? kindName(h.s) : (h.s.name || kindName(h.s))) : '?'; }));
  const path = document.createElement('span'); path.className = 'path'; path.textContent = names.join('  ›  '); bar.appendChild(path);
}
window.addEventListener('resize', () => { if (ST.iso) syncIsoBar(); });
/* 隔离时其余物件变淡：整张盖一层半透明白、再把隔离的编组照常画一次在上面 */
function drawIsoDim(ctx, s){
  const I = isoGroup(); if (!I) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(0, 0, Doc.width * s, Doc.height * s);
  ctx.translate((I.L.x || 0) * s, (I.L.y || 0) * s); ctx.globalAlpha = I.L.opacity === undefined ? 1 : I.L.opacity;
  try { if (I.G) window.drawShape(ctx, I.G, s); else I.kids.forEach(k => { if (k.visible !== false) window.drawShape(ctx, k, s); }); } catch (e){ console.error(e); }
  ctx.restore();
}
const hookIso = () => { if (window.UI && Array.isArray(UI.overlays)) UI.overlays.unshift((ctx, s) => { if (ST.iso && ToolState.cur !== 'aiselect') drawIsoDim(ctx, s); }); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookIso); else setTimeout(hookIso, 0);

/* ───────── 工具本体（select.rs SelectionTool）───────── */
let ses = null;
const ST = {
  showBBox: true,     // 视图 ▸ 显示定界框（AI 预设开；Shift+Ctrl+B 由 ai.view.boundingBox 切换）
  st: null,           // {k:'move', start, began} | {k:'scale', h, bx} | {k:'rotate', center, start} | {k:'marquee', start, cur, add}
  measure: null,
  guides: [],         // 智能参考线回馈（拖曳中）
  iso: null,          // 隔离模式 {layerId, ids:[外→内 编组 id]}
  /* 点到的物件：隔离中只认隔离编组里的（回 {L, top}），否则顶层物件 */
  hitTop(pt, tol){
    const I = isoGroup();
    if (I){ const c = hitInGroup(I.kids, [pt[0] - I.L.x, pt[1] - I.L.y], tol); return c ? {L:I.L, top:c[0]} : null; }
    const h = K().hitTest(pt, tol);
    return h && h.chain.length ? {L:h.L, top:h.chain[0]} : null;
  },
  session(){ return ses || (ses = K().makeSession()); },
  sel(){ return K().selection(); },
  box(){ const S = this.sel(); if (!S) return null; const b = K().orientedBox(S.L, S.list); return b ? Object.assign({L:S.L}, b) : null; },
  /* select.rs:76-82 box_hit */
  boxHit(bx, p){
    const lp = frame(bx).local(p), tol = VecSel.tol(5);
    const h = hitHandle(bx.rect, lp, tol); if (h) return {k:'handle', h};
    return inRotateZone(bx.rect, lp, tol, VecSel.tol(18)) ? {k:'rotate'} : null;
  },
  /* 游标压在选中物件的路径上（AI：物件优先于定界框外的旋转区——竖直线的定界框宽 0，线上每一点都算「框外」；例：Alt 拖竖线复制） */
  onSelected(p){ const h = this.hitTop(p, VecSel.tol(3)); return !!h && VecSel.layerId === h.L.id && VecSel.shapes.includes(h.top.id); },
  busy(){ return !!this.st; },
  cancel(){ if (ses) ses.cancel(); this.st = null; this.measure = null; this.guides = []; },
  len(v){ return (Math.round(v * 100) / 100) + ' px'; },

  down(e, pt){
    this.measure = null;
    if (this.showBBox){
      const bx = this.box(), hit = bx && this.boxHit(bx, pt);
      if (hit && hit.k === 'handle'){ this.st = {k:'scale', h:hit.h, bx, start:pt.slice(), began:false, L:bx.L}; return; }
      if (hit && hit.k === 'rotate' && !this.onSelected(pt)){ this.st = {k:'rotate', center:bx.center.slice(), start:pt.slice(), began:false, L:bx.L}; return; }
    }
    const h = this.hitTop(pt, VecSel.tol(3));
    if (h){
      const top = h.top, selected = VecSel.layerId === h.L.id && VecSel.shapes.includes(top.id);
      if (e.shiftKey){
        CMD.run('aiselect.select', {ids:[top.id], layerId:h.L.id, mode:'toggle'});
        if (selected){ this.st = null; return; }
      } else if (!selected) CMD.run('aiselect.select', {ids:[top.id], layerId:h.L.id});
      this.st = {k:'move', start:pt.slice(), began:false, L:h.L};
      return;
    }
    this.st = {k:'marquee', start:pt.slice(), cur:pt.slice(), add:!!e.shiftKey};
  },
  move(e, pt){
    const st = this.st; if (!st) return;
    if (st.k === 'marquee'){ st.cur = pt.slice(); UI.draw(); return; }
    if (!st.began){
      if (st.k === 'move' && dist(pt, st.start) < VecSel.tol(3)) return;
      if (window.Locks && Locks.deny(st.L, 'position')){ this.st = null; return; }
      st.began = true;
      if (st.k === 'move' && smartOn()){                          // 智能参考线：拖之前记下目标（不含选中的）与拖的那一方
        const S = this.sel();
        if (S){ st.targets = smartTargets(new Set(S.list.map(s => s.id))); st.mv = movingPoints(S, st.start); }
      } else if (st.k === 'scale' && xformGuidesOn()){            // 缩放也吸（AI：智能参考线 ▸ 变换工具）
        const S = this.sel();
        if (S) st.targets = smartTargets(new Set(S.list.map(s => s.id)));
      }
      this.session().begin(st.L);                                  // Action::Begin("Move"|"Copy"|"Scale"|"Rotate")
    }
    let m;
    this.guides = [];
    if (st.k === 'move'){
      let d = moveDelta(st.start, pt, !!e.shiftKey);
      if (st.targets && smartOn() && !e.shiftKey && !(e.ctrlKey || e.metaKey)){ const r = smartSnap(st.targets, st.mv, d, VecSel.tol(5)); d = r.d; this.guides = r.guides; }
      m = K().A.translate(d[0], d[1]);
      this.measure = {p:pt.slice(), text:'dX: ' + this.len(d[0]) + '\ndY: ' + this.len(d[1])};
      this.session().preview('aiselect.transform', {matrix:m, copy:!!e.altKey});
    } else if (st.k === 'scale'){
      if (st.targets && xformGuidesOn() && !(e.ctrlKey || e.metaKey)){ const r = scaleSnap(st.targets, st.bx, st.h, pt, !!e.altKey, VecSel.tol(5)); pt = r.pt; this.guides = r.guides; }
      const F = frame(st.bx), a = scaleForDrag(st.bx.rect, st.h, F.local(pt), !!e.shiftKey, !!e.altKey);
      const r = st.bx.rect, pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(q => K().A.apply(a, q));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      this.measure = {p:pt.slice(), text:'W: ' + this.len(Math.max(...xs) - Math.min(...xs)) + '\nH: ' + this.len(Math.max(...ys) - Math.min(...ys))};
      this.session().preview('aiselect.transform', {matrix:F.conjugate(a), copy:false});
    } else {
      let r = rotateForDrag(st.center, st.start, pt, !!e.shiftKey);
      if (!e.shiftKey && xformGuidesOn() && aiPref('constructionGuides') !== false && !(e.ctrlKey || e.metaKey)){   // 吸结构参考线角度
        const q = rotateSnap(st.center, st.start, pt, VecSel.tol(5)); if (q){ r = q; this.guides = q.guides; }
      }
      this.measure = {p:pt.slice(), text:(-r.deg).toFixed(1) + '°'};
      this.session().preview('aiselect.transform', {matrix:r.m, copy:false});
    }
    UI.draw();
  },
  up(e, pt){
    const st = this.st; this.st = null; this.measure = null; this.guides = []; if (!st) return;
    if (st.k === 'marquee'){
      const r = {x0:Math.min(st.start[0], pt[0]), y0:Math.min(st.start[1], pt[1]), x1:Math.max(st.start[0], pt[0]), y1:Math.max(st.start[1], pt[1])};
      if (r.x1 - r.x0 < VecSel.tol(3) && r.y1 - r.y0 < VecSel.tol(3)){ if (!st.add) CMD.run('aiselect.selectNone', {}); return; }
      CMD.run('aiselect.marquee', {x0:r.x0, y0:r.y0, x1:r.x1, y1:r.y1, add:st.add});
      return;
    }
    if (st.began){ const s = this.session(); if (st.k === 'move' && s.last) s.last.params.copy = !!e.altKey; s.commit(); }
  },
  key(e){
    if (e.key === 'Escape' && this.st){ e.preventDefault(); this.cancel(); return true; }
    if (e.key === 'Escape' && this.iso){ e.preventDefault(); CMD.run('ai.isolate.exit', {all:true}); return true; }   // AI：Esc 退出隔离模式
    return false;
  },
  /* 双击：编组＝进隔离模式（首选项「双击以隔离」，缺省开）；隔离中双击里面的编组＝再往里一层；双击空白（隔离编组外）＝退出一层 */
  dbl(e, pt){
    if (this.st) return false;
    const pref = !(window.AiEdit && AiEdit.prefs && AiEdit.prefs.values && AiEdit.prefs.values.doubleClickToIsolate === false);
    const h = this.hitTop(pt, VecSel.tol(3));
    // AI 2020：编组、复合路径、单一路径、符号实例都能双击进隔离（符号＝编辑符号定义）；已经在隔离它本身就不再进
    const cur = this.iso && this.iso.ids[this.iso.ids.length - 1];
    if (h && pref && isoable(h.top) && h.top.id !== cur){ CMD.run('ai.isolate.enter', {id:h.top.id, layerId:h.L.id}); return true; }
    if (h && h.top.id === cur) return false;
    if (!h && this.iso){ CMD.run('ai.isolate.exit', {}); return true; }
    return false;
  },
  /* select.rs:261-302 cursor */
  cursor(p, e){
    const st = this.st;
    if (st && st.k === 'rotate') return (typeof ROT_CURSOR !== 'undefined') ? ROT_CURSOR : 'alias';
    if (st && st.k === 'scale') return this.handleCursor(st.h, st.bx.angle);
    if (st && st.k === 'move' && st.began) return 'default';
    if (this.showBBox){
      const bx = this.box(), hit = bx && this.boxHit(bx, p);
      if (hit && hit.k === 'handle') return this.handleCursor(hit.h, bx.angle);
      if (hit && hit.k === 'rotate' && !this.onSelected(p)) return (typeof ROT_CURSOR !== 'undefined') ? ROT_CURSOR : 'alias';
    }
    const h = this.hitTop(p, VecSel.tol(3));
    if (h && ((VecSel.layerId === h.L.id && VecSel.shapes.includes(h.top.id)) || (e && e.altKey))) return 'move';
    return 'default';
  },
  handleCursor(h, angle){
    const steps = isFinite(angle) ? Math.round(angle / 45) : 0;
    const k = ((HANDLES.indexOf(h) - steps) % 8 + 8) % 8, hh = HANDLES[k];
    return {t:'ns-resize', b:'ns-resize', l:'ew-resize', r:'ew-resize', tl:'nwse-resize', br:'nwse-resize', tr:'nesw-resize', bl:'nesw-resize'}[hh];
  },
  drawOverlay(ctx, s){
    const kit = K();
    if (this.iso) drawIsoDim(ctx, s);                     // 隔离模式：其余物件变淡（先盖，再画选取）
    kit.Draw.selection(ctx, s);
    if (this.guides.length){                               // 智能参考线：洋红线＋标签（锚点／中心／路径）
      const d = s / UI.zoom;
      ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = ctx.fillStyle = MAGENTA; ctx.lineWidth = d;
      for (const g of this.guides){
        if (g.type === 'line'){ ctx.beginPath(); ctx.moveTo(g.a[0] * s, g.a[1] * s); ctx.lineTo(g.b[0] * s, g.b[1] * s); ctx.stroke(); }
        else kit.Draw.label(ctx, s, g.p, T('ui.smart.' + g.kind), MAGENTA);
      }
      ctx.restore();
    }
    const dp = s / UI.zoom;
    const st = this.st;
    if (this.showBBox && !(st && st.began)){
      const bx = this.box();
      if (bx){
        const F = frame(bx), r = bx.rect;
        const P = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(q => F.doc(q));
        ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = kit.BLUE; ctx.lineWidth = dp;
        ctx.beginPath(); P.forEach((q, i) => i ? ctx.lineTo(q[0] * s, q[1] * s) : ctx.moveTo(q[0] * s, q[1] * s)); ctx.closePath(); ctx.stroke();
        const hw = 3 * dp;
        HANDLES.forEach(h => { const q = F.doc(hpos(h, r)); ctx.fillStyle = '#fff'; ctx.fillRect(q[0] * s - hw, q[1] * s - hw, 2 * hw, 2 * hw); ctx.strokeRect(q[0] * s - hw, q[1] * s - hw, 2 * hw, 2 * hw); });
        ctx.restore();
      }
    }
    if (st && st.k === 'marquee'){                         // Overlay::Marquee
      const x = Math.min(st.start[0], st.cur[0]) * s, y = Math.min(st.start[1], st.cur[1]) * s;
      const w = Math.abs(st.cur[0] - st.start[0]) * s, h = Math.abs(st.cur[1] - st.start[1]) * s;
      ctx.save(); ctx.lineWidth = dp; ctx.setLineDash([4 * dp, 3 * dp]); ctx.strokeStyle = '#2f7fd8'; ctx.fillStyle = 'rgba(47,127,216,0.08)';
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
    }
    if (this.measure){ ctx.save(); kit.Draw.measure(ctx, s, this.measure.p, this.measure.text); ctx.restore(); }
  }
};
window.AiSelectTool = ST;

/* ───────── 命令（select.rs 发的 Action 都对到这几条；agent 叫同样几条就能做到同样的事）───────── */
CMD.reg('aiselect.select', {i18n:'',
  params:'{ids:[顶层物件 id…（隔离模式＝隔离编组的直接子物件）], layerId?, mode?:"set"|"add"|"toggle"="set"} 选择工具点物件（select.set／select.add／select.toggle）→ {ok, selected}'}, p => {
  p = p || {};
  const L = p.layerId ? Doc.byId(p.layerId) : vecLayer();
  if (!L || L.kind !== 'vector') return {ok:false, error:'aiselect.select: not a vector layer'};
  const I = isoGroup(), pool = I && I.L.id === L.id ? I.kids : L.data.shapes;   // 隔离模式：编组里的直接子物件
  const ids = (Array.isArray(p.ids) ? p.ids : []).filter(id => pool.some(s => s.id === id));
  if (!ids.length) return {ok:false, error:'aiselect.select: no such object'};
  if (p.mode === 'toggle'){
    const on = VecSel.layerId === L.id ? VecSel.shapes.slice() : [];
    ids.forEach(id => { const i = on.indexOf(id); if (i >= 0) on.splice(i, 1); else on.push(id); });
    selectIds(L, on, false);
  } else selectIds(L, ids, p.mode === 'add');
  if (window.UI) UI.draw();
  return {ok:true, selected:VecSel.shapes.slice(), layerId:L.id};
});
CMD.reg('aiselect.selectNone', {i18n:'', params:'{} 选择工具点空白：全部取消选取（select.none）'}, () => { VecSel.clear(); if (window.AiSel) AiSel.text = []; if (window.UI) UI.draw(); return {ok:true}; });
CMD.reg('aiselect.marquee', {i18n:'',
  params:'{x0, y0, x1, y1（文件坐标）, add?:bool} 选择工具框选（doc/hit.rs marquee）：框碰到的顶层物件（路径碰到边、锚点在框里、或框整个在闭合形状里；编组＝任一成员碰到）全选；add＝加选 → {ok, selected}'}, p => {
  p = p || {};
  if (![p.x0, p.y0, p.x1, p.y1].every(v => fin(+v))) return {ok:false, error:'aiselect.marquee: x0,y0,x1,y1 are required numbers'};
  const L = vecLayer(); if (!L) return {ok:false, error:'aiselect.marquee: not a vector layer'};
  const r = {x0:Math.min(+p.x0, +p.x1), y0:Math.min(+p.y0, +p.y1), x1:Math.max(+p.x0, +p.x1), y1:Math.max(+p.y0, +p.y1)};
  const ids = marqueeIds(L, r);
  if (p.add) selectIds(L, ids, true); else if (ids.length) selectIds(L, ids, false); else VecSel.clear();
  if (window.UI) UI.draw();
  return {ok:true, selected:VecSel.shapes.slice()};
});
CMD.reg('aiselect.transform', {i18n:'', undoable:true,
  params:'{matrix:[a,b,c,d,e,f] 文件坐标仿射, copy?:bool（Alt 拖＝复制）, ids?, layerId?} 选择工具拖曳／定界框缩放旋转（object.transform）：套到选中的物件；记进「再次变换」（Ctrl+D）→ {ok, ids}'}, p => {
  p = p || {};
  const kit = K();
  if (!kit.A.finite(p.matrix)) return {ok:false, error:'aiselect.transform: missing matrix [a,b,c,d,e,f]'};
  const t = kit.targets(p, 'aiselect.transform'); if (t.err) return t.err;
  const g = kit.guard(t.L, 'position', 'aiselect.transform'); if (g) return g;
  return kit.applyTransform(t.L, t.list, p.matrix.map(Number), {copy:!!p.copy});
});

/* ── 符号编辑（AI 2020：双击符号实例＝进隔离模式编辑符号定义；退出时定义换成改过的图稿、所有实例跟着变）──
   我们的实例＝带 s.symbol 的物件（几何直接烤在实例里，menus/impl/ai-window.js ai.symbol.*）⇒ 进去时记下：
   每个别的实例跟这个实例外框左上角的位移、定义（Doc.aiSymbols）跟它的位移；退出时照位移把新图稿复制过去 */
const geomKey = s => JSON.stringify(s, (k, v) => k === 'id' ? undefined : v);
function eachDeep(arr, fn){ (arr || []).forEach(s => { if (fn(s) === true) return; if (Array.isArray(s.children)) eachDeep(s.children, fn); }); }
function symbolSnap(L, s){
  const kit = K(), b = kit.shapeBounds(s, kit.docF(L), false); if (!b || !s.symbol) return null;
  const name = s.symbol, others = [];
  Doc.layers.forEach(M => { if (M.kind !== 'vector') return; eachDeep(M.data.shapes, x => {
    if (x.symbol !== name) return; if (x.id === s.id) return true;
    const ob = kit.shapeBounds(x, kit.docF(M), false); if (ob) others.push({layerId:M.id, id:x.id, d:[ob.x0 - b.x0, ob.y0 - b.y0]}); return true; }); });
  const def = (Doc.aiSymbols || []).find(x => x.name === name);
  let dd = null;
  if (def && def.shapes && def.shapes.length){ const db = kit.shapeBounds({type:'group', children:def.shapes}, q => [q[0] + (def.x || 0), q[1] + (def.y || 0)], false); if (db) dd = [db.x0 - b.x0, db.y0 - b.y0]; }
  return {name, others, dd, before:geomKey(s)};
}
function symbolSync(L, id, snap){
  const kit = K(), A = kit.A, h = L && kit.findDeep(L, id); if (!h || !snap) return {ok:false, error:'ai.isolate.symbolSync: no such instance'};
  const s = h.s; if (geomKey(s) === snap.before) return {ok:true, updated:0};
  const sc = {strokes:false, corners:false};
  let n = 0;
  for (const o of snap.others){
    const M = Doc.byId(o.layerId), oh = M && kit.findDeep(M, o.id); if (!oh) continue;
    const c = kit.reid(s); c.id = o.id; c.symbol = snap.name;
    kit.xformNode(M, c, A.translate(o.d[0] + L.x - M.x, o.d[1] + L.y - M.y), sc);
    oh.arr[oh.idx] = c; Layer.invalidate(M); n++;
  }
  const def = (Doc.aiSymbols || []).find(x => x.name === snap.name);
  if (def){
    const kids = (s.type === 'group' && !s.clip) ? s.children : [s];
    const g = {type:'group', children:kids.map(k => { const c = kit.reid(k); delete c.symbol; return c; })};
    const dd = snap.dd || [0, 0];
    kit.xformNode(L, g, A.translate(dd[0] + L.x - (def.x || 0), dd[1] + L.y - (def.y || 0)), sc);
    def.shapes = g.children;
  }
  return {ok:true, updated:n};
}
CMD.reg('ai.isolate.symbolSync', {i18n:'', undoable:true,
  params:'{layerId, id:实例 id, snap:{name, others, dd, before}（ai.isolate.enter 进符号时记的）} 符号编辑模式退出时：定义换成这个实例改过的图稿、所有别的实例跟着换（照进去时的相对位置）；ai.isolate.exit 自己会叫 → {ok, updated}'},
  p => symbolSync(Doc.byId(p.layerId), p.id, p.snap));

/* 隔离模式（视图状态、不进历史；AI 2020 右键「隔离选定的组」／选择工具双击／图层面板「进入隔离模式」／Esc 或双击空白退出） */
CMD.reg('ai.isolate.enter', {i18n:'', undoable:false,
  params:'{id?:物件 id（编组／复合路径／单一路径／符号实例；缺省＝选中的那一个）, layer?:bool（true＝隔离整个图层，AI 图层面板「进入隔离模式」）, layerId?} 进隔离模式：其余物件变淡、不能选，选择工具只点得到隔离的东西里面的物件；'
    + '符号实例＝编辑符号定义（退出时所有实例跟着变）；可一层层往里进 → {ok, isolated:[物件 id 外→内], layer:bool, layerId}'}, p => {
  p = p || {};
  const kit = K();
  let L = p.layerId ? Doc.byId(p.layerId) : vecLayer(), id = p.id;
  if (!L || L.kind !== 'vector') return {ok:false, error:'ai.isolate.enter: not a vector layer'};
  if (p.layer && id === undefined){
    ST.cancel(); ST.iso = {layerId:L.id, ids:[], layer:true, syms:{}};
    if (L.id !== Doc.activeId && CMD.map['layer.select']) CMD.run('layer.select', {id:L.id});
    VecSel.clear(); if (window.AiSel) AiSel.text = [];
    syncIsoBar(); if (window.UI && UI.ctx) UI.draw();
    return {ok:true, isolated:[], layer:true, layerId:L.id};
  }
  if (id === undefined){ const S = kit.selection(); const g = S && S.list.length === 1 && S.list[0]; if (!g || !isoable(g)) return {ok:false, error:'ai.isolate.enter: select one group, path, compound path or symbol instance'}; id = g.id; L = S.L; }
  const h = kit.findDeep(L, id);
  if (!h || !isoable(h.s)) return {ok:false, error:'ai.isolate.enter: no such group/path/symbol ' + id};
  const chain = h.chain.map(c => c.id).concat([id]);                 // 外层编组也一起记（灰条显示整条路径）
  const keep = ST.iso && ST.iso.layerId === L.id ? ST.iso : null;    // 同一层里往里进：图层隔离、已记的符号都留着
  const syms = keep ? Object.assign({}, keep.syms || {}) : {};
  if (h.s.symbol && !syms[id]){ const sn = symbolSnap(L, h.s); if (sn) syms[id] = sn; }
  ST.cancel(); ST.iso = {layerId:L.id, ids:chain, layer:!!(keep && keep.layer), syms};
  if (L.id !== Doc.activeId && CMD.map['layer.select']) CMD.run('layer.select', {id:L.id});
  VecSel.clear(); if (window.AiSel) AiSel.text = [];
  syncIsoBar(); if (window.UI && UI.ctx) UI.draw();
  return {ok:true, isolated:chain.slice(), layer:ST.iso.layer, layerId:L.id, symbol:h.s.symbol || undefined};
});
CMD.reg('ai.isolate.exit', {i18n:'', undoable:false, params:'{all?:bool} 退出隔离模式（缺省退一层；all＝全部退出）；退出符号＝定义与所有实例跟着改（一步历史）；退出后选中刚才隔离的物件 → {ok, isolated:[…剩下的], updated?}'}, p => {
  p = p || {};
  const I = ST.iso; if (!I) return {ok:true, isolated:[]};
  const L = Doc.byId(I.layerId), last = I.ids[I.ids.length - 1], top = I.ids[0];
  const full = !!p.all || (I.layer ? I.ids.length === 0 : I.ids.length <= 1);   // 图层隔离：最后一层物件退完还留在图层隔离里
  const leaving = full ? I.ids.slice().reverse() : [last];
  ST.cancel();
  let updated;
  for (const id of leaving){
    const sn = I.syms && I.syms[id], h = sn && L && K().findDeep(L, id);
    if (h && geomKey(h.s) !== sn.before){ const r = CMD.run('ai.isolate.symbolSync', {layerId:L.id, id, snap:sn}); if (r && r.ok) updated = (updated || 0) + r.updated; }
    if (I.syms) delete I.syms[id];
  }
  if (full) ST.iso = null; else I.ids = I.ids.slice(0, -1);
  syncIsoBar();
  const pick = ST.iso ? last : top;
  if (L && pick !== undefined && K().findDeep(L, pick)) VecSel.setShapes(L.id, [pick]); else VecSel.clear();
  if (window.UI && UI.ctx) UI.draw();
  return {ok:true, isolated:ST.iso ? ST.iso.ids.slice() : [], updated};
});
CMD.reg('ai.isolate.state', {i18n:'', undoable:false, params:'{} → {ok, isolated:[物件 id 外→内], layer:bool（整个图层隔离）, layerId}'}, () => { isoGroup(); return {ok:true, isolated:ST.iso ? ST.iso.ids.slice() : [], layer:!!(ST.iso && ST.iso.layer), layerId:ST.iso ? ST.iso.layerId : null}; });

const STR = {
  'zh-Hant':{'tool.aiselect':'選取工具', 'ui.aiselectHint':'點物件＝選取（Shift 加／減選）· 拖空白＝框選 · 拖物件＝移動（Shift 45°、Alt＝拷貝，之後 Ctrl+D 再製）· 拖定界框把手＝縮放（Shift 等比、Alt 從中心）· 角外拖＝旋轉（Shift 45°）'},
  'zh-Hans':{'tool.aiselect':'选择工具', 'ui.aiselectHint':'点对象＝选中（Shift 加／减选）· 拖空白＝框选 · 拖对象＝移动（Shift 45°、Alt＝复制，之后 Ctrl+D 再制）· 拖定界框把手＝缩放（Shift 等比、Alt 从中心）· 角外拖＝旋转（Shift 45°）'},
  'en':{'tool.aiselect':'Selection Tool', 'ui.aiselectHint':'Click an object to select (Shift adds/removes) · drag empty space to marquee · drag an object to move (Shift 45°, Alt copies; then Ctrl+D repeats) · drag a bounding-box handle to scale (Shift proportional, Alt from centre) · drag just outside a corner to rotate (Shift 45°)'}
};
Object.assign(STR['zh-Hant'], {'ui.smart.anchor':'錨點', 'ui.smart.center':'中心點', 'ui.smart.path':'路徑', 'ui.isoExit':'退出隔離模式', 'ui.isoGroup':'群組', 'ui.isoMenu':'隔離選取的群組', 'ui.isoMenuExit':'結束隔離群組'});
Object.assign(STR['zh-Hans'], {'ui.smart.anchor':'锚点', 'ui.smart.center':'中心点', 'ui.smart.path':'路径', 'ui.isoExit':'退出隔离模式', 'ui.isoGroup':'编组', 'ui.isoMenu':'隔离选定的组', 'ui.isoMenuExit':'退出隔离组'});
Object.assign(STR.en, {'ui.smart.anchor':'anchor', 'ui.smart.center':'center', 'ui.smart.path':'path', 'ui.isoExit':'Exit Isolation Mode', 'ui.isoGroup':'Group', 'ui.isoMenu':'Isolate Selected Group', 'ui.isoMenuExit':'Exit Isolated Group'});
Object.assign(STR['zh-Hant'], {'ui.smart.angle':'角度', 'ui.isoPath':'路徑', 'ui.isoCompound':'複合路徑', 'ui.isoSymbol':'符號', 'ui.isoLayerMenu':'進入隔離模式', 'ui.isoLayerExit':'結束隔離模式'});
Object.assign(STR['zh-Hans'], {'ui.smart.angle':'角度', 'ui.isoPath':'路径', 'ui.isoCompound':'复合路径', 'ui.isoSymbol':'符号', 'ui.isoLayerMenu':'进入隔离模式', 'ui.isoLayerExit':'退出隔离模式'});
Object.assign(STR.en, {'ui.smart.angle':'angle', 'ui.isoPath':'Path', 'ui.isoCompound':'Compound Path', 'ui.isoSymbol':'Symbol', 'ui.isoLayerMenu':'Enter Isolation Mode', 'ui.isoLayerExit':'Exit Isolation Mode'});
['zh-Hant', 'zh-Hans', 'en'].forEach(k => STR[k]['ui.aiselectHint'] += {'zh-Hant':' · 按兩下群組＝隔離模式（Esc 退出）', 'zh-Hans':' · 双击编组＝隔离模式（Esc 退出）', en:' · double-click a group to isolate it (Esc exits)'}[k]);
if (typeof Lang !== 'undefined') Lang.add(STR);

Tools.reg({
  id:'aiselect', icon:'➤', group:'vector', order:5, for:'vector', opts:[], cursor:'default', hint:'ui.aiselectHint', strings:STR,
  onDown(e, pt){ ST.down(e, pt); if (UI.canvas) UI.canvas.style.cursor = ST.cursor(pt, e); UI.draw(); },
  onMove(e, pt){ ST.move(e, pt); if (UI.canvas) UI.canvas.style.cursor = ST.cursor(pt, e); if (!(ST.st && ST.st.began)) UI.draw(); },
  onUp(e, pt){ ST.up(e, pt); if (UI.canvas) UI.canvas.style.cursor = ST.cursor(pt, e); UI.draw(); },
  onKey(e){ const r = ST.key(e); if (r) UI.draw(); return r; },
  onDblClick(e, pt){ if (ST.dbl(e, pt)) UI.draw(); },
  onDeactivate(){ ST.cancel(); },
  drawOverlay(ctx, s){ ST.drawOverlay(ctx, s); }
});
})();
