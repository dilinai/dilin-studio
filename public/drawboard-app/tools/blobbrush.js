/* 堤麟画板 · AI 斑点画笔工具（ai.blob-brush，AI 版面 Shift+B）＋「手绘家族」共用层 window.HandKit
   照 ArtCraft VectorCraft 原码逐段翻（vectorcraft/crates/）：
     tools/src/draw2/gesture.rs        GestureTool：按下收第一点、拖曳每移 ≥1 屏幕像素收一点、放开（离末点 ≥1 像素才补收）跑一条命令；
                                       Esc 取消；[ ] 改笔刷大小（1..1000、步 1）；叠画＝拖过的折线（斑点画笔线宽＝size·zoom、美工刀虚线、其余 1px 蓝）；
                                       选项 size（缺省 10，0.1..1000）、fidelity（平滑 2.5／铅笔 1.5）、fill、editWithin 12、closeWithin 15
     tools/src/draw2.rs:22-23,61-76    FEEDBACK 蓝 #4f9dff、points_json、polyline
     tools/src/settings.rs:31-33       选项要记住（换工具、存偏好）：blobBrush｛size｝、smooth｛fidelity｝、pencil｛fidelity, fill, editWithin, closeWithin｝
     engine/src/cmd/draw2.rs           path.blob／path.knife／path.eraseSegments／path.smoothRegion／path.joinScrub 与共用帮手：
                                       points_param(135)、dist_to_polyline(175)、poly_bounds(190)、brush_region(196)、target_paths(206)、
                                       set_geometry(236)、sibling_with(249)、replace_with_pieces(265)、components(286)、cut_subpath(320)、erase_outline(411)
     pathops/src/offset.rs:45-74       outline_stroke（描边轮廓＝去掉重叠的干净区域）
   布尔运算（po::boolean／unite_all／area）：原码 linesweeper 扫描线；这里借 menus/impl/ai-object.js 已照原码谓词做好的替代实作
     AIObj.strokePieces（描边覆盖片）＋ AIObj.arrangement（平面排列＋谓词：并 m.some、差 m0&&!m1、交 m0&&m1）＋ AIObj.tidyLoop（折线环拟合回曲线）。
   我们这边的对应：
     他们的「路径节点」＝矢量层里的叶子形状（bezier 与 rect／ellipse／star／polygon／path／line 活形状，几何看 VecSel.asBezier）；编组、复合路径往里走到叶子（原码 doc.walk 也走进复合路径的成员）。
     一条路径多个子路径（布尔后有洞）＝我们的复合路径 {type:'compound', rule:'nonzero', children:[无外观的 bezier…]}，同 id、外观留在复合路径上。
     命令收文件坐标，进来就换成那一层的图层坐标（铁律④）；「选取」＝VecSel 在那一层选中的形状；没事可做（plan 空）不推历史，跟原码 apply_plan 一样。
   斑点画笔（gesture.rs:127 ＋ draw2.rs:1126-1178 blob）：
     拖一笔＝圆头圆角、直径 size 的笔刷覆盖区（brush_region，单点＝点＋(0.01,0) 一小段）→ 填色＝描边色（没有就填色、再没有就黑）、无描边；
     merge（缺省开）：同一层「所有」路径（不看选取）里，外框碰到 poly_bounds(pts, size)、填色跟这笔相同、没有描边、闭合、且跟这笔交集面积 >1e-6 的，
     全部跟这笔联集成一个形状，留最上面那个（merge_ids 最后一个）的 id 与位置、其余删掉；选中它。没有可并的＝新加一个形状在最上面、选中它。
   ── 没抄的 ──
     压感（usePressure）原码也没有；斑点画笔原码只有 size 一个选项（AI 的「保持选定」「仅与选区合并」「保真度」原码没有，没加）。
     布尔是折线近似（拉平容差 0.02）再拟合回曲线，跟 linesweeper 精确曲线运算在小数点后会有出入（面积误差 <0.5%）；
     输出整理（boolean.rs Tidy：只并几乎共线的接点、留住输入锚点）改成 HandKit.tidyLoop 认角＋拟合（见那支函数的注释）；
     描边区域前先把笔迹做 0.02 的 Douglas–Peucker 去掉几乎共线的点（替代排列遇到一串几乎共线的细长矩形会接错环，原码精确运算不需要）。 */
(function(){
'use strict';

const fin = v => typeof v === 'number' && isFinite(v);
const sub = (a, b) => [a[0]-b[0], a[1]-b[1]], add = (a, b) => [a[0]+b[0], a[1]+b[1]], mul = (a, k) => [a[0]*k, a[1]*k];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1], cross = (a, b) => a[0]*b[1] - a[1]*b[0];
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const lerp = (a, b, t) => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t];
const clone = o => JSON.parse(JSON.stringify(o));
const LEAF = ['rect', 'ellipse', 'star', 'polygon', 'path', 'line', 'bezier'];
const painted = p => !!p && p !== 'none' && p !== '';

const HK = {
  FEEDBACK: '#4f9dff',                                   // draw2.rs:23
  BLUE: '#4a7cff',                                       // xform.rs:50（Shaper 叠画）
  fin, sub, add, mul, dot, cross, dist, lerp, clone,
  /* ToolContext::tol：屏幕像素 → 文件单位 */
  tol(px){ return px / Math.max((window.UI && UI.zoom) || 1, 1e-9); },
  AO(){ if (!window.AIObj) throw new Error('menus/impl/ai-object.js（AIObj）没载入'); return window.AIObj; },
  /* f64_or：是有限数字才用，否则缺省 */
  f64(p, k, d){ return (p && fin(p[k])) ? p[k] : d; },

  /* draw2.rs:135-150 points_param：[[x,y]…] 或 [{x,y}…]，非有限的丢掉；一个都没有＝错 → {pts} 或 {err} */
  pointsParam(p, key, C){
    const a = p ? p[key] : undefined;
    if (!Array.isArray(a)) return {err:{ok:false, error:`${C}: missing array \`${key}\``}};
    const pts = [];
    for (const v of a){
      let x, y;
      if (Array.isArray(v)){ x = v[0]; y = v[1]; } else if (v && typeof v === 'object'){ x = v.x; y = v.y; } else continue;
      if (fin(x) && fin(y)) pts.push([x, y]);
    }
    if (!pts.length) return {err:{ok:false, error:`${C}: need at least one point`}};
    return {pts};
  },
  /* 命令作用的矢量层：layerId → 节点选取那层 → 当前层（同 engine Locks 的 vec 规则） */
  layerOf(p){
    const L = (p && p.layerId) ? Doc.byId(p.layerId) : ((window.VecSel && VecSel.layer()) || Doc.active());
    return (L && L.kind === 'vector') ? L : null;
  },
  /* 图层锁（锁像素／全锁＝矢量层内容不能改）：被挡回 Locks.fail，否则 null */
  lockFail(L, C){
    if (!window.Locks || !L) return null;
    const k = Locks.blocks(L, 'pixels'); if (!k) return null;
    Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, C);
  },
  toLayerPts(L, pts){ return pts.map(q => [q[0] - L.x, q[1] - L.y]); },
  selIds(L){ return (window.VecSel && VecSel.layerId === L.id) ? VecSel.shapes.slice() : []; },

  /* ── 形状树 ── 叶子路径（NodeKind::Path）；锁住／隐藏的（连祖先）不算（doc.is_editable） */
  isPath(s){ return !!s && LEAF.includes(s.type) && !!(window.VecSel && VecSel.asBezier(s)); },
  /* cb({s, arr, parent, root})：arr＝它所在的阵列、parent＝所在的编组／复合路径、root＝顶层那个物件 */
  walkTree(arr, parent, root, cb){
    for (const s of arr){
      if (!s || s.locked || s.visible === false) continue;
      const r = root || s;
      if ((s.type === 'group' || s.type === 'compound') && Array.isArray(s.children)) this.walkTree(s.children, s, r, cb);
      else if (this.isPath(s)) cb({s, arr, parent, root:r});
    }
  },
  /* 一条叶子路径的几何（图层坐标）：[{anchors, closed}]（我们的叶子只有一个子路径） */
  pdOf(s){ const v = VecSel.asBezier(s); return v ? [{anchors:clone(v.anchors), closed:!!v.closed}] : []; },
  /* PathData::control_bounds：锚点＋把手 */
  ctrlBounds(pd){
    let r = null;
    const addp = q => { if (!q) return; r = r ? {x0:Math.min(r.x0, q[0]), y0:Math.min(r.y0, q[1]), x1:Math.max(r.x1, q[0]), y1:Math.max(r.y1, q[1])} : {x0:q[0], y0:q[1], x1:q[0], y1:q[1]}; };
    for (const sp of pd) for (const a of sp.anchors){ addp([a.x, a.y]); addp(a.in); addp(a.out); }
    return r;
  },
  /* draw2.rs:190-193 poly_bounds */
  polyBounds(pts, pad){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts){ x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    return {x0:x0 - pad, y0:y0 - pad, x1:x1 + pad, y1:y1 + pad};
  },
  /* draw2.rs:206-227 target_paths：没选取＝整层全部路径，有选取＝选中物件底下的路径；外框（放大 0.5）跟 area 交集面积 >0，或外框是零宽／零高 */
  targetPaths(L, selIds, area){
    const out = [];
    const push = e => {
      if (out.some(o => o.s === e.s)) return;
      const b = this.ctrlBounds(this.pdOf(e.s)); if (!b) return;
      const w = Math.min(b.x1 + 0.5, area.x1) - Math.max(b.x0 - 0.5, area.x0), h = Math.min(b.y1 + 0.5, area.y1) - Math.max(b.y0 - 0.5, area.y0);
      if ((w > 0 && h > 0) || b.x1 - b.x0 === 0 || b.y1 - b.y0 === 0) out.push(e);
    };
    if (!selIds || !selIds.length) this.walkTree(L.data.shapes, null, null, push);
    else for (const id of selIds){ const s = L.data.shapes.find(x => x.id === id); if (s) this.walkTree([s], null, null, push); }
    // walkTree([s]) 时顶层那个的 arr 是临时阵列 ⇒ 没有 parent 的（顶层）换回真正所在的 L.data.shapes
    out.forEach(e => { if (!e.parent) e.arr = L.data.shapes; });
    return out;
  },

  /* ── 几何（draw2.rs 的帮手）── */
  /* draw2.rs:175-188 dist_to_polyline */
  distToPolyline(pts, q){
    if (pts.length === 1) return dist(pts[0], q);
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++){
      const a = pts[i], b = pts[i + 1], ab = sub(b, a), l2 = dot(ab, ab);
      const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2));
      best = Math.min(best, dist(add(a, mul(ab, t)), q));
    }
    return best;
  },
  /* Anchor::with_handles（geom path.rs:124）：把手等于锚点＝null；两支共线反向＝smooth */
  withHandles(p, hin, hout){
    const a = {x:p[0], y:p[1], in:dist(hin, p) > 1e-9 ? [hin[0], hin[1]] : null, out:dist(hout, p) > 1e-9 ? [hout[0], hout[1]] : null};
    a.kind = VecSel.anchorKind(Object.assign({}, a, {kind:undefined}));
    return a;
  },
  segIsLine(sp, i){ const A = sp.anchors, a = A[i], b = A[(i + 1) % A.length]; return !a.out && !b.in; },
  /* kurbo CubicBez::subsegment(t0..t1) */
  subseg(c, t0, t1){
    let a = t1 >= 1 ? c : VecSel.splitCubic(c, t1)[0];
    if (t0 <= 0) return a;
    return VecSel.splitCubic(a, t1 > 1e-12 ? Math.min(1, t0 / t1) : 0)[1];
  },
  /* draw2.rs:319-407 cut_subpath：remove(点) 为真的地方切掉，回剩下的开放片段；没切到回 null */
  cutSubpath(sp, remove){
    const nseg = VecSel.segCount(sp);
    if (nseg === 0){ const a = sp.anchors[0]; return (a && remove([a.x, a.y])) ? [] : null; }
    const K = 24, runs = []; let cur = [], any = false;
    for (let i = 0; i < nseg; i++){
      const c = VecSel.segment(sp, i);
      let prevT = 0, prevRm = remove(VecSel.evalCubic(c, 0));
      let start = prevRm ? null : 0;
      if (prevRm){ any = true; if (cur.length){ runs.push(cur); cur = []; } }
      for (let k = 1; k <= K; k++){
        const t = k / K, rm = remove(VecSel.evalCubic(c, t));
        if (rm !== prevRm){
          let lo = prevT, hi = t;
          for (let j = 0; j < 30; j++){ const m = 0.5 * (lo + hi); if (remove(VecSel.evalCubic(c, m)) === prevRm) lo = m; else hi = m; }
          const b = 0.5 * (lo + hi);
          if (prevRm) start = b;
          else { any = true; if (start !== null){ cur.push([i, start, b]); start = null; } runs.push(cur); cur = []; }
        }
        prevT = t; prevRm = rm;
      }
      if (start !== null) cur.push([i, start, 1]);
    }
    if (cur.length) runs.push(cur);
    const R = runs.filter(r => r.length);
    if (!any) return null;
    // 闭合路径：最后一段与第一段在锚点 0 接起来
    if (sp.closed && R.length >= 2){
      const fs = R[0][0], lr = R[R.length - 1], le = lr[lr.length - 1];
      if (fs[0] === 0 && fs[1] === 0 && le[0] + 1 === nseg && le[2] === 1){ const first = R.shift(); R[R.length - 1] = R[R.length - 1].concat(first); }
    }
    const out = [];
    for (const r of R){
      if (!(r.length > 1 || r[0][2] - r[0][1] > 1e-4)) continue;
      const A = [];
      for (const [i, t0, t1] of r){
        const c = this.subseg(VecSel.segment(sp, i), t0, t1), line = this.segIsLine(sp, i);
        const h1 = line ? c.p0 : c.c1, h2 = line ? c.p3 : c.c2;
        if (A.length) A[A.length - 1].out = h1; else A.push({p:c.p0, in:c.p0, out:h1});
        A.push({p:c.p3, in:h2, out:c.p3});
      }
      const anchors = A.map(a => this.withHandles(a.p, a.in, a.out));
      if (anchors.length >= 2) out.push({anchors, closed:false});
    }
    return out;
  },
  /* draw2.rs:409-433 erase_outline：每个输出物件一份几何（原本只有一个子路径＝每片一个物件）；没变回 null */
  eraseOutline(pd, remove){
    let changed = false; const subs = [];
    for (const sp of pd){ const r = this.cutSubpath(sp, remove); if (r){ changed = true; subs.push(...r); } else subs.push(sp); }
    if (!changed) return null;
    if (pd.length === 1) return subs.map(s => [s]);
    return subs.length ? [subs] : [];
  },

  /* ── 区域运算（po::outline_stroke／boolean／unite_all／area 的替代，见档头）── 环＝折线 [[x,y]…]（图层坐标） */
  polyArea(P){ let a = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; a += p[0]*q[1] - q[0]*p[1]; } return a / 2; },
  regionArea(loops){ return Math.abs(loops.reduce((s, P) => s + this.polyArea(P), 0)); },
  winding(P, q){
    let w = 0;
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i + 1) % P.length], c = cross(sub(b, a), sub(q, a));
      if (a[1] <= q[1]){ if (b[1] > q[1] && c > 0) w++; } else if (b[1] <= q[1] && c < 0) w--;
    }
    return w;
  },
  /* 一份几何拉平成填色用的折线（fill_bezpath：开放子路径当闭合） */
  flatPd(pd){ return pd.map(sp => this.AO().flatten(sp)).filter(P => P.length >= 2); },
  /* offset.rs:45 outline_stroke：折线 pts 描边（宽 w）的覆盖区 → 边界环 */
  strokeLoops(pts, w, cap, join){
    // 先把几乎共线的点去掉（Douglas–Peucker 0.02＝拉平容差）：滑鼠取样带浮点抖动，一串几乎共线的细长矩形叠在一起，替代的平面排列会接错环（刀口 0.05 宽时整条刀口消失）
    const P = this.rdp(pts.filter((q, i) => i === 0 || dist(pts[i - 1], q) > 1e-12), 0.02);
    const pieces = this.AO().strokePieces(P, false, w, join, cap, 4);
    return pieces.length ? this.AO().arrangement([{polys:pieces, rule:'nonzero'}], m => m[0]) : [];
  },
  /* Douglas–Peucker（开放折线，头尾留着） */
  rdp(P, tol){
    if (P.length < 3) return P.slice();
    const keep = P.map(() => false); keep[0] = keep[P.length - 1] = true;
    const st = [[0, P.length - 1]];
    while (st.length){
      const [a, b] = st.pop(), ch = sub(P[b], P[a]), l = Math.hypot(ch[0], ch[1]);
      let bd = 0, bi = -1;
      for (let i = a + 1; i < b; i++){ const d = l < 1e-12 ? dist(P[i], P[a]) : Math.abs(cross(sub(P[i], P[a]), ch)) / l; if (d > bd){ bd = d; bi = i; } }
      if (bi >= 0 && bd > tol){ keep[bi] = true; st.push([a, bi], [bi, b]); }
    }
    return P.filter((_, i) => keep[i]);
  },
  /* draw2.rs:195-202 brush_region：直径 size 的圆笔刷沿 pts 涂过的区域（单点＝补一个 +0.01 的点） */
  brushRegion(pts, size){
    const P = pts.slice(); if (P.length === 1) P.push(add(P[0], [0.01, 0]));
    return this.strokeLoops(P, size, 'round', 'round');
  },
  /* draw2.rs:285-317 components：填色区按连通拆开（每个外环带它的洞）→ [[环…]…] */
  components(loops){
    if (loops.length <= 1) return loops.length ? [loops] : [];
    const n = loops.length, samples = loops.map(P => lerp(P[0], P[1], 0.5));
    const inside = (j, i) => this.winding(loops[j], samples[i]) !== 0;
    const depth = loops.map((_, i) => { let c = 0; for (let j = 0; j < n; j++) if (j !== i && inside(j, i)) c++; return c; });
    const areas = loops.map(P => Math.abs(this.polyArea(P)));
    const outers = []; for (let i = 0; i < n; i++) if (depth[i] % 2 === 0) outers.push(i);
    const groups = outers.map(o => [loops[o]]);
    for (let h = 0; h < n; h++){
      if (depth[h] % 2 === 0) continue;
      let best = -1;
      outers.forEach((o, k) => { if (depth[o] + 1 === depth[h] && inside(o, h) && (best < 0 || areas[o] < areas[outers[best]])) best = k; });
      if (best >= 0) groups[best].push(loops[h]);
    }
    return groups;
  },
  /* 折线环 → 曲线子路径（boolean.rs:372-458 tidy_bezpath／tidy_segments 的替代）：
     原码只把「几乎共线（叉积 <0.02）」的接点并掉、其余接点（输入的锚点、扫描线切出的交点）都留成角；我们拿到的是拉平后的折线，所以要先认出哪些是真的角：
       转 >30°；或 转角×较短邻边 >0.32（拉平容差 0.02 的曲线，一个接点的 转角×边长 ≤ 0.16，超过两倍就不是拉平出来的）；
       一串很短（<0.2）的边（例如刀口 0.05 宽的圆角接合）当一个接点看：整串的总转角×两侧长边 >0.32 ⇒ 这串的头尾都是角。
     角与角之间：全部贴着弦（≤0.015）＝直线；否则用 fit_cubics（容差 0.03）拟合（AIObj.tidyLoop 那套，长直边先加密）。 */
  tidyLoop(P0){
    const P = []; for (const q of P0) if (!P.length || dist(P[P.length - 1], q) > 1e-9) P.push(q);
    if (P.length > 1 && dist(P[0], P[P.length - 1]) <= 1e-9) P.pop();
    const n = P.length; if (n < 3) return null;
    const len = P.map((q, i) => dist(q, P[(i + 1) % n]));
    const turn = i => { const a = sub(P[i], P[(i - 1 + n) % n]), b = sub(P[(i + 1) % n], P[i]); return Math.atan2(cross(a, b), dot(a, b)); };
    const T = P.map((_, i) => turn(i));
    const corner = P.map((_, i) => Math.abs(T[i]) > Math.PI / 6 || Math.abs(T[i]) * Math.min(len[(i - 1 + n) % n], len[i]) > 0.32);
    const SHORT = 0.2;
    for (let i = 0; i < n; i++){
      if (len[i] >= SHORT || len[(i - 1 + n) % n] < SHORT) continue;        // 一串短边从 i 开始（i 前面那条是长边）
      let j = (i + 1) % n, tot = T[i], guard = n;
      while (len[j] < SHORT && j !== i && guard--){ tot += T[j]; j = (j + 1) % n; }
      if (j === i) break;
      tot += T[j];
      if (Math.abs(tot) * Math.min(len[(i - 1 + n) % n], len[j]) > 0.32){ corner[i] = true; corner[j] = true; }
    }
    let C = []; for (let i = 0; i < n; i++) if (corner[i]) C.push(i);
    const rot = C.length ? C[0] : 0, Q = P.slice(rot).concat(P.slice(0, rot));
    C = C.length ? C.map(c => (c - rot + n) % n).sort((a, b) => a - b) : [0];
    C.push(n);
    const Fit = this.AO().Fit, segs = [];
    const unitv = v => { const l = Math.hypot(v[0], v[1]); return l > 1e-12 ? [v[0] / l, v[1] / l] : null; };
    for (let w = 0; w + 1 < C.length; w++){
      const run = []; for (let i = C[w]; i <= C[w + 1]; i++) run.push(Q[i % n]);
      const a = run[0], b = run[run.length - 1], ch = sub(b, a), cl = Math.hypot(ch[0], ch[1]);
      if (run.length === 2 || (cl > 1e-12 && run.every(q => Math.abs(cross(sub(q, a), ch)) / cl <= 0.015))){ segs.push({c:{p0:a, c1:a, c2:b, p3:b}, line:true}); continue; }
      const pts = [run[0]];
      for (let i = 1; i < run.length; i++){ const u = run[i - 1], v = run[i], k = Math.ceil(dist(u, v) / 2); for (let j = 1; j <= k; j++) pts.push(lerp(u, v, j / k)); }
      const t0 = unitv(sub(run[1], run[0])) || [1, 0], t1 = unitv(sub(run[run.length - 1], run[run.length - 2])) || [1, 0];
      for (const c of Fit.fitCubics(pts, t0, t1, 0.03)) segs.push(Fit.isStraight(c, 1e-3) ? {c:{p0:c.p0, c1:c.p0, c2:c.p3, p3:c.p3}, line:true} : {c, line:false});
    }
    // boolean.rs:379-407 segs_to_subpath（闭合）
    const m = segs.length; if (m < 2) return null;
    const anchors = segs.map((s, i) => { const pv = segs[(i + m - 1) % m], p = s.c.p0; return this.withHandles(p, pv.line ? p : pv.c.c2, s.line ? p : s.c.c1); });
    return {anchors, closed:true};
  },
  /* 环 → 几何 */
  loopsToPd(loops){ return loops.map(P => this.tidyLoop(P)).filter(Boolean); },

  /* ── 改文件 ── */
  member(sp){ return {id:uid('S'), type:'bezier', anchors:sp.anchors, closed:!!sp.closed, fill:'none', stroke:'none', strokeWidth:0}; },
  /* draw2.rs:234-246 set_geometry（丢掉活形状参数）：一个子路径＝bezier；多个＝复合路径（同 id、外观留着）；本来就是复合路径＝重建成员 */
  setGeometry(s, pd){
    if (s.type === 'compound'){ s.children = pd.map(sp => this.member(sp)); return s; }
    VecSel.GEOM_KEYS.forEach(k => { delete s[k]; });
    if (pd.length === 1){ s.type = 'bezier'; s.anchors = pd[0].anchors; s.closed = !!pd[0].closed; delete s.children; delete s.rule; }
    else { delete s.anchors; delete s.closed; s.type = 'compound'; s.rule = s.rule || 'nonzero'; s.children = pd.map(sp => this.member(sp)); }
    VecSel._cache.delete(s);
    return s;
  },
  /* draw2.rs:263-279 replace_with_pieces：第一片留原 id、其余（换新 id、同外观）插在它正上方；没有片＝删掉 → 新 id 们 */
  replaceWithPieces(e, pieces){
    const {s, arr} = e, idx = arr.indexOf(s);
    if (idx < 0) return [];
    if (!pieces.length){ arr.splice(idx, 1); return []; }
    if (e.parent && e.parent.type === 'compound'){
      // 复合路径的成员：每个子路径一个成员（我们的成员不能自己再带多个子路径）
      const subs = [].concat(...pieces), ids = [s.id];
      subs.slice(1).forEach((sp, k) => { const m = this.member(sp); arr.splice(idx + 1 + k, 0, m); ids.push(m.id); });
      this.setGeometry(s, [subs[0]]);
      return ids;
    }
    const ids = [s.id];
    pieces.slice(1).forEach((pd, k) => {
      const c = clone(s); c.id = uid('S'); delete c.name;
      this.setGeometry(c, pd); arr.splice(idx + 1 + k, 0, c); ids.push(c.id);
    });
    this.setGeometry(s, pieces[0]);
    return ids;
  },
  /* 顶层 id（VecSel 只记顶层物件）：形状在编组／复合路径里＝它的顶层祖先 */
  rootIds(L, ids){
    const out = [];
    const find = id => { let r = null; const go = (arr, root) => { for (const s of arr){ if (r) return; if (s.id === id){ r = root || s; return; } if (Array.isArray(s.children)) go(s.children, root || s); } }; go(L.data.shapes, null); return r; };
    ids.forEach(id => { const r = find(id); if (r && !out.includes(r.id)) out.push(r.id); });
    return out;
  },
  select(L, ids){ VecSel.setShapes(L.id, this.rootIds(L, ids)); },
  /* draw2.rs:869-882 apply_plan：plan＝[[entry, pieces]…]；空＝{ids:[]} 不推历史 */
  applyPlan(L, plan){
    if (!plan.length) return {ok:true, ids:[]};
    History.push();
    const all = [];
    for (const [e, pieces] of plan) all.push(...this.replaceWithPieces(e, pieces));
    Layer.invalidate(L);
    this.select(L, all);
    return {ok:true, ids:all, layerId:L.id};
  },

  /* ── 手势（gesture.rs pointer）──：cfg {step: 收点间距（屏幕像素，缺省 1）, upAdd: 放开补收末点（缺省 true）, finish(pts, e)} */
  gesture(cfg){
    const G = {
      points:[], active:false,
      down(e, pt){
        if (e && e.button !== undefined && e.button !== 0) return;
        G.points = [[pt[0], pt[1]]]; G.active = true; UI.draw();
      },
      move(e, pt, P){
        if (!G.active || !(P && P.down)) return;
        const l = G.points[G.points.length - 1];
        if (l && dist(l, pt) < HK.tol(cfg.step || 1)) return;
        G.points.push([pt[0], pt[1]]); UI.draw();
      },
      up(e, pt){
        if (!G.active) return;
        const l = G.points[G.points.length - 1];
        if (cfg.upAdd !== false && l && dist(l, pt) >= HK.tol(cfg.step || 1)) G.points.push([pt[0], pt[1]]);
        const pts = G.points; G.reset();
        try { cfg.finish(pts, e || {}); } finally { UI.draw(); }
      },
      reset(){ G.points = []; G.active = false; },
      key(e){ if (e.key === 'Escape' && G.active){ G.reset(); UI.draw(); return true; } return false; },
      /* overlays（gesture.rs:220-230）：线宽 widthPx（屏幕像素）、dashed */
      draw(ctx, s, color, widthPx, dashed){
        if (!G.active || G.points.length < 2) return;
        const dpr = s / Math.max(UI.zoom || 1, 1e-9);
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(widthPx, 0.5) * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.setLineDash(dashed ? [5 * dpr, 4 * dpr] : []);
        ctx.beginPath(); G.points.forEach((q, i) => i ? ctx.lineTo(q[0] * s, q[1] * s) : ctx.moveTo(q[0] * s, q[1] * s)); ctx.stroke();
        ctx.restore();
      }
    };
    return G;
  },
  /* settings.rs：工具选项要记住（换工具不丢、存进偏好＝localStorage） */
  loadOpts(id, def){ try { const v = JSON.parse(localStorage.getItem('dl.toolopt.' + id) || 'null'); return Object.assign({}, def, v && typeof v === 'object' ? v : {}); } catch (e){ return Object.assign({}, def); } },
  saveOpts(id, o){ try { localStorage.setItem('dl.toolopt.' + id, JSON.stringify(o)); } catch (e){} },
  clamp(v, a, b, d){ return Math.max(a, Math.min(b, fin(v) ? v : d)); }
};
window.HandKit = HK;

/* ═════════════ 斑点画笔 ═════════════ */
const BB = HK.loadOpts('blobbrush', {size:10});           // gesture.rs:55 size 10
const sameColor = (a, b) => (typeof a === 'string' && typeof b === 'string') ? a.trim().toLowerCase() === b.trim().toLowerCase() : JSON.stringify(a) === JSON.stringify(b);
const hasStroke = s => painted(s.stroke) && (s.strokeWidth || 0) > 0;

/* draw2.rs:1126-1178 blob */
CMD.reg('blobbrush.paint', {i18n:'', undoable:false,
  params:'{points:[[x,y]…] 文件坐标（单点也行）, size?:10（笔刷直径，文件单位，须 >0）, merge?:true, layerId?} ＝ path.blob 斑点画笔一笔：' +
         '圆头圆角笔刷涂过的区域变成「只有填色」的形状（填色＝描边色，描边为无就用填色，再没有就黑）；merge 时同层所有跟这笔重叠、同色、无描边的闭合形状一起联集成一个（留最上面那个的 id），选中结果；' +
         '不是矢量层就新建一层 → {ok, id, layerId, merged:[被并掉删除的 id…]}'}, p => {
  const C = 'blobbrush.paint';
  const r = HK.pointsParam(p, 'points', C); if (r.err) return r.err;
  const size = HK.f64(p, 'size', 10);
  if (!(fin(size) && size > 0)) return {ok:false, error:C + ': size must be positive'};
  // 填色：描边色 → 填色 → 黑（UI.stroke() 在描边宽 0 时就是 none）
  const paint = painted(UI.stroke()) ? UI.stroke() : painted(UI.fill()) ? UI.fill() : '#000000';
  let L = (p.layerId ? Doc.byId(p.layerId) : Doc.active());
  if (p.layerId && (!L || L.kind !== 'vector')) return {ok:false, error:C + ': not a vector layer'};
  if (!L || L.kind !== 'vector') L = null;
  if (L){ const f = HK.lockFail(L, C); if (f) return f; }
  const ox = L ? L.x : 0, oy = L ? L.y : 0, pts = r.pts.map(q => [q[0] - ox, q[1] - oy]);
  const region = HK.brushRegion(pts, size);
  if (!region.length) return {ok:false, error:C + ': empty brush stroke'};
  const merge = [];
  if (L && p.merge !== false){
    for (const e of HK.targetPaths(L, [], HK.polyBounds(pts, size))){
      const s = e.parent && e.parent.type === 'compound' ? null : e.s;   // 复合路径成员没有自己的外观（fill_paint 不会相同）
      if (!s || !sameColor(s.fill, paint) || hasStroke(s)) continue;
      const pd = HK.pdOf(s);
      if (!pd.every(sp => sp.closed)) continue;
      const inter = HK.AO().arrangement([{polys:HK.flatPd(pd), rule:'nonzero'}, {polys:region, rule:'nonzero'}], m => m[0] && m[1]);
      if (HK.regionArea(inter) > 1e-6) merge.push({e, pd});
    }
  }
  History.push();
  if (!merge.length){
    if (!L){ L = activeVector(true); }
    const pd = HK.loopsToPd(region);
    const sh = {id:uid('S'), fill:paint, stroke:'none', strokeWidth:0};
    HK.setGeometry(sh, pd);
    // 新形状画在区域算的那一层（新建的层 L.x=0）：pts 已经是那一层的坐标（L 原本不存在时 ox=oy=0）
    if (L.x !== ox || L.y !== oy) shiftShape(sh, ox - L.x, oy - L.y);
    L.data.shapes.push(sh); Layer.invalidate(L);
    VecSel.setShapes(L.id, [sh.id]);
    return {ok:true, id:sh.id, layerId:L.id, merged:[]};
  }
  // unite_all（区域＋每个可并的）→ 留最上面那个（walk 顺序＝由下到上，最后一个）
  const sets = [{polys:region, rule:'nonzero'}].concat(merge.map(m => ({polys:HK.flatPd(m.pd), rule:'nonzero'})));
  const merged = HK.loopsToPd(HK.AO().arrangement(sets, m => m.some(Boolean)));
  const keep = merge[merge.length - 1].e, others = merge.slice(0, -1).map(m => m.e);
  HK.setGeometry(keep.s, merged);
  for (const o of others){ const i = o.arr.indexOf(o.s); if (i >= 0) o.arr.splice(i, 1); }
  Layer.invalidate(L);
  HK.select(L, [keep.s.id]);
  return {ok:true, id:keep.s.id, layerId:L.id, merged:others.map(o => o.s.id)};
});
CMD.reg('blobbrush.options', {i18n:'',
  params:'{size?:0.1..1000（笔刷直径，缺省 10）} 斑点画笔选项（gesture.rs set_option）；不给参数＝只读 → {ok, size}'}, p => {
  if (p && p.size !== undefined) BB.size = HK.clamp(+p.size, 0.1, 1000, BB.size);
  HK.saveOpts('blobbrush', BB);
  if (ToolState.cur === 'blobbrush' && window.UI){ const n = document.getElementById('bb_size'); if (n && document.activeElement !== n) n.value = BB.size; UI.draw(); }
  return {ok:true, size:BB.size};
});

const BG = HK.gesture({finish(pts){ CMD.run('blobbrush.paint', {points:pts, size:BB.size}); }});
window.BlobBrush = {opts:BB, g:BG};

Tools.reg({
  id:'blobbrush', icon:'◍', group:'vector', order:40, for:'vector', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.bbHint',
  strings:{
    'zh-Hant':{'tool.blobbrush':'點滴筆刷工具', 'ui.bbHint':'拖曳＝塗出只有填色的形狀（同色重疊就合併）｜[ ] 改筆刷大小｜Esc 取消', 'opt.bbSize':'大小：'},
    'zh-Hans':{'tool.blobbrush':'斑点画笔工具', 'ui.bbHint':'拖曳＝涂出只有填色的形状（同色重叠就合并）｜[ ] 改笔刷大小｜Esc 取消', 'opt.bbSize':'大小：'},
    'en':{'tool.blobbrush':'Blob Brush Tool', 'ui.bbHint':'Drag to paint a filled shape (merges with overlapping same-colour blobs) | [ ] brush size | Esc: cancel', 'opt.bbSize':'Size:'}
  },
  buildOptions(box, add, mk){
    const n = mk('number', {min:0.1, max:1000, step:1, value:BB.size, id:'bb_size'}); n.style.width = '60px';
    n.onchange = () => CMD.run('blobbrush.options', {size:+n.value}); add('bbSize', n);
  },
  onDown(e, pt){ BG.down(e, pt); },
  onMove(e, pt, P){ BG.move(e, pt, P); },
  onUp(e, pt){ BG.up(e, pt); },
  onKey(e){
    if (BG.key(e)) return true;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    // gesture.rs:202-209 [ ]：大小 −1／+1（1..1000）
    if (e.key === '['){ CMD.run('blobbrush.options', {size:Math.max(BB.size - 1, 1)}); return true; }
    if (e.key === ']'){ CMD.run('blobbrush.options', {size:Math.min(BB.size + 1, 1000)}); return true; }
    return false;
  },
  onDeactivate(){ BG.reset(); },
  drawOverlay(ctx, s){ BG.draw(ctx, s, HK.FEEDBACK, BB.size * (UI.zoom || 1), false); }
});
})();
