/* 堤麟画板 · 矢量节点选取共用层
   给 直接选择(A)／加锚点(+)／删锚点(−)／锚点工具(Shift+C)／剪刀(C) 五颗工具共用；钢笔也可用。
   抄自 ArtCraft VectorCraft：
     doc/src/selection.rs   Selection { objects（选中的物件·按选取顺序）, anchors（每条路径「部分选中」的锚点；路径在 objects 里但 anchors 没条目＝整条选中）}
     tools/src/draw2.rs     candidate_paths（先选中的、再其余最上层优先）、hit_anchor（容差内最近锚点·第一条有命中的路径就停）、hit_segment（容差内最近线段点）
     geom/src/path.rs       PathData::nearest（逐段 kurbo nearest → (subpath, seg, t, point, dist)）、Anchor{p, in, out, kind: Corner|Smooth}
   我们这边的对应：
     一个 bezier 形状 ＝ 他们一条只有一个 subpath 的路径（si 永远 0）；
     shape.anchors[i] = {x, y, in:[x,y]|null, out:[x,y]|null, kind?:'corner'|'smooth'}，把手是绝对坐标（图层坐标），null＝没有把手（他们是「把手等于 p」）。
     kind 缺省时按几何推（两支把手共线反向＝smooth）。
     选取状态进历史：History.snap/restore 存取 VecSel.snapshot/restore。
   活形状（rect／ellipse／star／polygon／path／line）也当路径编辑——抄 VectorCraft：
     doc/src/node.rs:72-131       LiveShape：矩形／椭圆／多边形本身就是路径，参数在 live 里，to_path 由参数重生路径
     geom/src/shapes.rs:10-84     KAPPA、rectangle／rounded_rectangle／ellipse／polygon／star 的锚点排法
     engine/src/cmd/path.rs:111-120、cmd/draw2.rs:156-165  path_mut：`*live = None; // editing anchors expands a live shape`
   我们这边：asBezier(s) 给一个不改原物件的几何视图（命中、叠画、选锚点都用它，回传的 s 仍是原物件）；
     真要动锚点的命令里先 ensureBezier(L, s) 就地换成 bezier（＝他们的 path_mut 丢掉 live），算在那条命令的历史步里。
   🔴 这支档是共用层：改它会影响上面几颗工具，个别工具的需要别直接加在这里。 */

const VecSel = {
  layerId: null,
  shapes: [],          // 选中的形状 id（selection.objects）
  anchors: {},         // shapeId -> [锚点索引…]（selection.anchors）；形状在 shapes 里但这里没条目＝整条选中

  snapshot(){ return {layerId:this.layerId, shapes:this.shapes.slice(), anchors:JSON.parse(JSON.stringify(this.anchors))}; },
  restore(s){
    if (!s){ this.clear(); return; }
    this.layerId = s.layerId || null; this.shapes = (s.shapes || []).slice(); this.anchors = JSON.parse(JSON.stringify(s.anchors || {}));
  },
  clear(){ this.layerId = null; this.shapes = []; this.anchors = {}; },
  isEmpty(){ return !this.shapes.length; },

  /* ── 整条形状（select.set／add／toggle 语义）── */
  setShapes(layerId, ids){ this.layerId = ids.length ? layerId : null; this.shapes = ids.slice(); this.anchors = {}; },
  addShape(layerId, id){
    if (this.layerId !== layerId) this.setShapes(layerId, []);
    if (!this.shapes.includes(id)) this.shapes.push(id);
    delete this.anchors[id]; this.layerId = layerId;
  },
  removeShape(id){ this.shapes = this.shapes.filter(x => x !== id); delete this.anchors[id]; if (!this.shapes.length) this.layerId = null; },
  isShapeSelected(id){ return this.shapes.includes(id); },
  isShapeFullySelected(id){ return this.shapes.includes(id) && !this.anchors[id]; },

  /* ── 锚点（select.anchors 语义：把某形状「部分选中」的锚点集合设成 idxs）── */
  setAnchors(layerId, shapeId, idxs){
    if (this.layerId !== layerId){ this.clear(); this.layerId = layerId; }
    if (!this.shapes.includes(shapeId)) this.shapes.push(shapeId);
    const u = Array.from(new Set(idxs)).sort((a, b) => a - b);
    if (!u.length){ this.removeShape(shapeId); return; }
    this.anchors[shapeId] = u;
  },
  addAnchor(layerId, shapeId, idx){
    if (this.isShapeFullySelected(shapeId) && this.layerId === layerId) return;      // 整条已选，不用加
    const cur = (this.layerId === layerId && this.anchors[shapeId]) ? this.anchors[shapeId] : [];
    this.setAnchors(layerId, shapeId, cur.concat([idx]));
  },
  toggleAnchor(layerId, shapeId, idx){
    if (this.layerId === layerId && this.isAnchorSelected(shapeId, idx)){
      const cur = this.anchors[shapeId];
      if (!cur){ const v = this.asBezier(this.findShape(shapeId)), n = v ? v.anchors.length : 0;this.setAnchors(layerId, shapeId, [...Array(n).keys()].filter(i => i !== idx)); }
      else this.setAnchors(layerId, shapeId, cur.filter(i => i !== idx));
    } else this.addAnchor(layerId, shapeId, idx);
  },
  isAnchorSelected(shapeId, idx){
    if (!this.shapes.includes(shapeId)) return false;
    const a = this.anchors[shapeId]; return !a || a.includes(idx);
  },
  /* 所有选中的锚点 [{s, idx}]（整条选中的展开成全部锚点）。s 是原物件；非 bezier 的活形状按 asBezier 视图的索引算，
     要动它的锚点先 ensureBezier(L, s)（转出来的索引跟视图一样） */
  selectedAnchors(){
    const L = this.layer(); if (!L) return [];
    const out = [];
    for (const id of this.shapes){
      const s = L.data.shapes.find(x => x.id === id), v = this.asBezier(s); if (!v) continue;
      const a = this.anchors[id];
      (a || v.anchors.map((_, i) => i)).forEach(i => { if (v.anchors[i]) out.push({s, idx:i}); });
    }
    return out;
  },

  layer(){ return this.layerId ? Doc.byId(this.layerId) : null; },
  findShape(id){ const L = this.layer(); return L ? (L.data.shapes.find(x => x.id === id) || null) : null; },
  /* 形状或图层没了就把失效的条目剔掉（删形状、换文件、undo 之后）*/
  prune(){
    const L = this.layer();
    if (!L || L.kind !== 'vector'){ this.clear(); return; }
    this.shapes = this.shapes.filter(id => L.data.shapes.some(x => x.id === id));
    for (const id of Object.keys(this.anchors)){
      if (!this.shapes.includes(id)){ delete this.anchors[id]; continue; }
      const v = this.asBezier(L.data.shapes.find(x => x.id === id));
      this.anchors[id] = this.anchors[id].filter(i => v && v.anchors && v.anchors[i]);
      if (!this.anchors[id].length) this.removeShape(id);
    }
    if (!this.shapes.length) this.layerId = null;
  },

  /* ── 坐标 ── */
  toDoc(L, p){ return [p[0] + L.x, p[1] + L.y]; },
  toLayer(L, p){ return [p[0] - L.x, p[1] - L.y]; },
  tol(px){ return (px === undefined ? 4 : px) / UI.zoom; },      // ToolContext::tol(4.0)＝4 屏幕像素换成文件单位

  /* ── 几何（抄 geom/src/path.rs；坐标都是图层坐标）── */
  anchorKind(a){
    if (a.kind) return a.kind;
    if (!a.in || !a.out) return 'corner';
    const u = [a.in[0] - a.x, a.in[1] - a.y], v = [a.out[0] - a.x, a.out[1] - a.y];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-9 || lv < 1e-9) return 'corner';
    const cross = u[0]*v[1] - u[1]*v[0], dot = u[0]*v[0] + u[1]*v[1];
    return (Math.abs(cross) <= 1e-6 * lu * lv && dot < 0) ? 'smooth' : 'corner';
  },
  hOut(a){ return a.out || [a.x, a.y]; },
  hIn(a){ return a.in || [a.x, a.y]; },
  /* 给了活形状（type 不是 bezier）就换成它的视图；没 type 的（工具自己拼的 {anchors, closed}）当路径 */
  _geo(s){ return (s && s.type && s.type !== 'bezier') ? (this.asBezier(s) || {anchors:[], closed:false}) : s; },
  segCount(s){ s = this._geo(s); const n = (s.anchors || []).length; return n < 2 ? 0 : (s.closed ? n : n - 1); },   // SubPath::segment_count
  segment(s, i){
    s = this._geo(s);
    const A = s.anchors, a = A[i], b = A[(i + 1) % A.length];
    return {p0:[a.x, a.y], c1:this.hOut(a), c2:this.hIn(b), p3:[b.x, b.y], i0:i, i1:(i + 1) % A.length};
  },
  segments(s){ s = this._geo(s); const out = []; for (let i = 0; i < this.segCount(s); i++) out.push(this.segment(s, i)); return out; },
  evalCubic(c, t){
    const mt = 1 - t, a = mt*mt*mt, b = 3*mt*mt*t, cc = 3*mt*t*t, d = t*t*t;
    return [a*c.p0[0] + b*c.c1[0] + cc*c.c2[0] + d*c.p3[0], a*c.p0[1] + b*c.c1[1] + cc*c.c2[1] + d*c.p3[1]];
  },
  derivCubic(c, t){
    const mt = 1 - t;
    return [3*mt*mt*(c.c1[0]-c.p0[0]) + 6*mt*t*(c.c2[0]-c.c1[0]) + 3*t*t*(c.p3[0]-c.c2[0]),
            3*mt*mt*(c.c1[1]-c.p0[1]) + 6*mt*t*(c.c2[1]-c.c1[1]) + 3*t*t*(c.p3[1]-c.c2[1])];
  },
  /* kurbo CubicBez::nearest(p, accuracy)：32 等分粗找，再牛顿法细修 → {t, d, q} */
  nearestOnCubic(c, p){
    let bt = 0, bd = Infinity; const N = 32;
    for (let i = 0; i <= N; i++){ const t = i / N, q = this.evalCubic(c, t), d = Math.hypot(q[0]-p[0], q[1]-p[1]); if (d < bd){ bd = d; bt = t; } }
    let t = bt;
    for (let k = 0; k < 8; k++){
      const q = this.evalCubic(c, t), dq = this.derivCubic(c, t);
      const f = (q[0]-p[0])*dq[0] + (q[1]-p[1])*dq[1];
      // t 贴着 1 时往回取差分点，不然 t2==t、df=0 就不细修了（线段末端 1/32 内的点会被吸到锚点上）
      const h = 1e-4, t2 = (t + h <= 1) ? t + h : t - h, q2 = this.evalCubic(c, t2), dq2 = this.derivCubic(c, t2);
      const f2 = (q2[0]-p[0])*dq2[0] + (q2[1]-p[1])*dq2[1], df = (f2 - f) / (t2 - t);
      if (Math.abs(df) < 1e-12) break;
      const nt = Math.max(0, Math.min(1, t - f / df));
      if (Math.abs(nt - t) < 1e-9){ t = nt; break; }
      t = nt;
    }
    const q = this.evalCubic(c, t), d = Math.hypot(q[0]-p[0], q[1]-p[1]);
    return d < bd ? {t, d, q} : {t:bt, d:bd, q:this.evalCubic(c, bt)};
  },
  /* PathData::nearest：整条形状上最近的点 → {seg, t, q, d} */
  nearestOnShape(s, p){
    s = this._geo(s);
    let best = null;
    for (let i = 0; i < this.segCount(s); i++){ const n = this.nearestOnCubic(this.segment(s, i), p); if (!best || n.d < best.d) best = {seg:i, t:n.t, q:n.q, d:n.d}; }
    return best;
  },
  /* de Casteljau 在 t 切一刀 → [前段, 后段]（加锚点、剪刀用）*/
  splitCubic(c, t){
    const L = (a, b) => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t];
    const p01 = L(c.p0, c.c1), p12 = L(c.c1, c.c2), p23 = L(c.c2, c.p3), p012 = L(p01, p12), p123 = L(p12, p23), m = L(p012, p123);
    return [{p0:c.p0, c1:p01, c2:p012, p3:m}, {p0:m, c1:p123, c2:p23, p3:c.p3}];
  },

  /* ── 活形状 → 贝兹（抄 geom/src/shapes.rs；几何与 engine.js drawShape 画的同一个形状）── 坐标都是图层坐标 */
  KAPPA: 0.5522847498307936,                                       // shapes.rs:10 KAPPA（四分之一圆弧的把手比）
  // 活形状的几何参数栏位：ensureBezier 换成 anchors/closed 时删掉，其余（id、fill、stroke、strokeWidth…外观）原样留着
  GEOM_KEYS: ['x', 'y', 'w', 'h', 'radius', 'cx', 'cy', 'rx', 'ry', 'r1', 'r2', 'points', 'rotation'],
  _cache: new WeakMap(),                                            // 形状物件 → {key, view}；几何栏位变了 key 就变、重算
  /* 他们「把手等于 p」＝我们 null */
  _h(p, h){ return Math.hypot(h[0] - p[0], h[1] - p[1]) > 1e-9 ? [h[0], h[1]] : null; },
  /* Anchor { p, h_in, h_out, kind } → 我们的锚点 */
  _anc(p, hin, hout, kind){ return {x:p[0], y:p[1], in:this._h(p, hin), out:this._h(p, hout), kind}; },
  /* SubPath::polyline（geom/src/path.rs:194-196）：每点一个 Anchor::corner（path.rs:117-119） */
  _poly(pts, closed){ return {anchors:pts.map(q => ({x:q[0], y:q[1], in:null, out:null, kind:'corner'})), closed}; },
  _fin(...v){ return v.every(x => typeof x === 'number' && isFinite(x)); },
  /* 由活形状的参数算锚点（不碰原物件）；转不了回 null */
  _liveToBezier(s){
    const t = s.type;
    if (t === 'rect'){
      if (!this._fin(s.x, s.y, s.w, s.h)) return null;
      // shapes.rs:13-16 rectangle／19-39 rounded_rectangle：先 abs()；radius 夹在 0..短边一半（Chrome roundRect 对等长半径也是这样缩）
      const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
      const rad = Math.min(Math.max(+s.radius || 0, 0), (x1 - x0) / 2, (y1 - y0) / 2);
      if (!(rad > 1e-9)) return this._poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);   // 4 个直角点、左上起顺时针
      const k = rad * this.KAPPA, a = (p, hin, hout) => this._anc(p, hin, hout, 'corner');    // 8 个点，全是 Corner（shapes.rs:27）
      return {closed:true, anchors:[
        a([x0 + rad, y0], [x0 + rad - k, y0], [x0 + rad, y0]),
        a([x1 - rad, y0], [x1 - rad, y0], [x1 - rad + k, y0]),
        a([x1, y0 + rad], [x1, y0 + rad - k], [x1, y0 + rad]),
        a([x1, y1 - rad], [x1, y1 - rad], [x1, y1 - rad + k]),
        a([x1 - rad, y1], [x1 - rad + k, y1], [x1 - rad, y1]),
        a([x0 + rad, y1], [x0 + rad, y1], [x0 + rad - k, y1]),
        a([x0, y1 - rad], [x0, y1 - rad + k], [x0, y1 - rad]),
        a([x0, y0 + rad], [x0, y0 + rad], [x0, y0 + rad - k])]};
    }
    if (t === 'ellipse'){
      if (!this._fin(s.x, s.y, s.w, s.h)) return null;
      // shapes.rs:42-57 ellipse：4 个 Smooth（左、上、右、下），h_in = p + hin、h_out = p − hin，把手长 κ·半径
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2, rx = Math.abs(s.w / 2), ry = Math.abs(s.h / 2), kx = rx * this.KAPPA, ky = ry * this.KAPPA;
      const sm = (p, v) => this._anc(p, [p[0] + v[0], p[1] + v[1]], [p[0] - v[0], p[1] - v[1]], 'smooth');
      return {closed:true, anchors:[sm([cx - rx, cy], [0, ky]), sm([cx, cy - ry], [-kx, 0]), sm([cx + rx, cy], [0, -ky]), sm([cx, cy + ry], [kx, 0])]};
    }
    if (t === 'star' || t === 'polygon'){
      // shapes.rs:60-84 polygon／star：直角点、第一点朝上；n、r2、旋转照 drawShape（engine.js:103-114）算，画出来才一样
      const n = s.points || (t === 'star' ? 5 : 6), steps = t === 'star' ? n * 2 : n;
      const r1 = s.r1, r2 = t === 'star' ? s.r2 : r1, rot = (s.rotation || 0) * Math.PI / 180 - Math.PI / 2;
      if (!this._fin(s.cx, s.cy, r1, r2, rot) || !(steps >= 2) || !Number.isInteger(steps)) return null;
      const pts = [];
      for (let i = 0; i < steps; i++){
        const r = (t === 'star' && i % 2) ? r2 : r1, a = rot + i * Math.PI * 2 / steps;
        pts.push([s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r]);
      }
      return this._poly(pts, true);
    }
    if (t === 'path' || t === 'line'){
      // LiveShape::Line → shapes.rs:93-95 line（开放折线）；我们的 path 是任意折线，closed 照原栏位
      const P = s.points || [];
      if (P.length < 2 || !P.every(q => q && this._fin(q[0], q[1]))) return null;
      return this._poly(P, !!s.closed);
    }
    return null;
  },
  /* 几何视图：bezier 原样回；能转的活形状回 {type:'bezier', anchors, closed}（共用的，⛔ 别改它）；转不了回 null */
  asBezier(s){
    if (!s) return null;
    if (s.type === 'bezier') return s;
    if (!['rect', 'ellipse', 'star', 'polygon', 'path', 'line'].includes(s.type)) return null;
    const key = JSON.stringify([s.type, s.closed].concat(this.GEOM_KEYS.map(k => s[k])));
    const c = this._cache.get(s);
    if (c && c.key === key) return c.view;
    const g = this._liveToBezier(s);
    const view = g ? {type:'bezier', anchors:g.anchors, closed:g.closed} : null;
    this._cache.set(s, {key, view});
    return view;
  },
  /* path_mut 的 `*live = None`：就地把活形状改成 bezier（id 与外观栏位都留着、几何参数删掉），回 s；已是 bezier 直接回；转不了回 null。
     只在命令里叫（算那条命令的历史步）。 */
  ensureBezier(L, s){
    if (!s) return null;
    if (s.type === 'bezier') return s;
    const v = this.asBezier(s); if (!v) return null;
    const A = JSON.parse(JSON.stringify(v.anchors));
    this.GEOM_KEYS.forEach(k => { delete s[k]; });
    s.type = 'bezier'; s.anchors = A; s.closed = !!v.closed;
    this._cache.delete(s);
    if (L) Layer.invalidate(L);
    return s;
  },
  /* 拖曳预览用：整个形状物件拍一张、再原地还原（还原后仍是同一个物件，参照不断） */
  cloneShape(s){ return JSON.parse(JSON.stringify(s)); },
  restoreShape(s, snap){ Object.keys(s).forEach(k => { delete s[k]; }); Object.assign(s, JSON.parse(JSON.stringify(snap))); this._cache.delete(s); return s; },

  /* ── 命中（抄 draw2.rs）── pt 一律文件坐标；回传里的几何是图层坐标；回传的 s 一律是原物件（活形状也是），几何按 asBezier 视图算 */
  candidatePaths(L){
    if (!L || L.kind !== 'vector') return [];
    const S = L.data.shapes.filter(s => { if (s.locked || s.visible === false) return false; const g = this.asBezier(s); return g && g.anchors && g.anchors.length; });   // 活形状也是路径（node.rs:72-73）；锁住／隐藏的点不中（对象菜单的锁定／隐藏）
    const v = [];
    if (this.layerId === L.id) for (const id of this.shapes){ const s = S.find(x => x.id === id); if (s) v.push(s); }
    for (let i = S.length - 1; i >= 0; i--) if (!v.includes(S[i])) v.push(S[i]);
    return v;
  },
  hitAnchor(L, pt, tol, selectedOnly){
    const p = this.toLayer(L, pt); let best = null;
    for (const s of this.candidatePaths(L)){
      if (selectedOnly && !this.isShapeSelected(s.id)) continue;
      this.asBezier(s).anchors.forEach((a, i) => { const d = Math.hypot(a.x - p[0], a.y - p[1]); if (d <= tol && (!best || d < best.d - 1e-9)) best = {s, idx:i, d}; });
      if (best) break;
    }
    return best;
  },
  hitSegment(L, pt, tol){
    const p = this.toLayer(L, pt);
    for (const s of this.candidatePaths(L)){ const n = this.nearestOnShape(s, p); if (n && n.d <= tol) return {s, seg:n.seg, t:n.t, q:n.q, d:n.d}; }
    return null;
  },
  /* 把手：只看「显示着把手」的锚点（选中的锚点）→ {s, idx, out:true|false, d} */
  hitHandle(L, pt, tol){
    const p = this.toLayer(L, pt); let best = null;
    for (const {s, idx} of this.selectedAnchors()){
      const a = this.asBezier(s).anchors[idx];
      [[a.out, true], [a.in, false]].forEach(([h, out]) => { if (!h) return; const d = Math.hypot(h[0]-p[0], h[1]-p[1]); if (d <= tol && (!best || d < best.d)) best = {s, idx, out, d}; });
    }
    return best;
  },

  /* ── 叠画：选中路径的轮廓、锚点与把手（Illustrator：选中锚点实心、未选空心；只有选中锚点才显示把手）── s＝文件坐标→画布像素倍率 */
  drawOverlay(ctx, s){
    if (window.AiView && AiView.edgesHidden()) return;   // AI 视图 ▸ 隐藏边缘
    this.prune();
    const L = this.layer(); if (!L || !L.visible) return;
    const blue = '#2f7fd8', r = 3.5;
    ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([]);
    for (const id of this.shapes){
      const raw = L.data.shapes.find(x => x.id === id);
      if (raw && (raw.type === 'group' || raw.type === 'compound') && window.AIObj){ const b = AIObj.shapeBounds(raw, p => [(p[0] + L.x) * s, (p[1] + L.y) * s], false); if (b){ ctx.strokeStyle = blue; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); } continue; }   // 编组／复合路径（对象菜单建的）画外框
      const sh = this.asBezier(raw); if (!sh || !sh.anchors) continue;   // 活形状画它的视图
      const docA = sh.anchors.map(a => ({x:a.x + L.x, y:a.y + L.y, in:a.in ? [a.in[0] + L.x, a.in[1] + L.y] : null, out:a.out ? [a.out[0] + L.x, a.out[1] + L.y] : null}));
      ctx.strokeStyle = blue; ctx.beginPath(); bezierPath(ctx, {anchors:docA, closed:sh.closed}, s); ctx.stroke();
      docA.forEach((a, i) => {
        const sel = this.isAnchorSelected(id, i), x = a.x * s, y = a.y * s;
        if (sel) [a.in, a.out].forEach(h => {
          if (!h) return; const hx = h[0] * s, hy = h[1] * s;
          ctx.strokeStyle = blue; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.fillStyle = blue; ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, Math.PI * 2); ctx.fill();
        });
        ctx.beginPath(); ctx.rect(x - r, y - r, 2*r, 2*r); ctx.fillStyle = sel ? blue : '#fff'; ctx.fill(); ctx.strokeStyle = blue; ctx.stroke();
      });
    }
    ctx.restore();
  }
};
window.VecSel = VecSel;

/* 让 agent／测试能读到与清掉选取状态；各工具自己的 select.* 命令在各自的档里登记 */
CMD.reg('vsel.get',   {i18n:'', params:'{} → {layerId, shapes:[id…], anchors:{id:[idx…]}} 目前的矢量节点选取（anchors 没条目的形状＝整条选中）'}, () => Object.assign({ok:true}, VecSel.snapshot()));
CMD.reg('vsel.clear', {i18n:'', params:'{} 清掉矢量节点选取', undoable:true}, () => { VecSel.clear(); return {ok:true}; });
/* 活形状 → 一般路径（他们 path_mut 的 `*live = None`；五颗节点工具动锚点时自己会转，这条给 agent 单独用） */
CMD.reg('vsel.toBezier', {i18n:'', undoable:true,
  params:'{shapeId, layerId?} 把矩形（含圆角）／椭圆／星形／多边形／折线就地转成钢笔路径（type:"bezier"），画出来的样子不变：' +
         '矩形＝左上起顺时针 4 个直角点（有圆角＝8 个点、把手长 κ·radius）；椭圆＝左上右下 4 个平滑点（把手长 κ·半径，κ=0.5523）；星形／多边形／折线＝每个顶点一个直角点。' +
         'id、填色、描边等外观留着，几何参数栏位删掉。layerId 缺省＝节点选取那层→当前层→任一矢量层。→ {ok, changed, shapeId, layerId, anchors, closed}'}, p => {
  const tryL = L => (L && L.kind === 'vector') ? L.data.shapes.find(x => x.id === p.shapeId) : null;
  let L = null, s = null;
  if (p.layerId){ L = Doc.byId(p.layerId); s = tryL(L); }
  else for (const C of [VecSel.layer(), Doc.active()].concat(Doc.layers)){ s = tryL(C); if (s){ L = C; break; } }
  if (!s) return {ok:false, error:'vsel.toBezier: no such shape'};
  const changed = s.type !== 'bezier';
  if (!VecSel.ensureBezier(L, s)) return {ok:false, error:'vsel.toBezier: cannot convert type ' + s.type};
  return {ok:true, changed, shapeId:s.id, layerId:L.id, anchors:s.anchors.length, closed:!!s.closed};
});
