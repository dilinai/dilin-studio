/* 自由钢笔工具（PS P 那格 ps.pen-freeform）——PhotoCraft 没有这颗；照 VectorCraft 的「铅笔」（手绘拟合成贝兹路径，就是 PS 自由钢笔做的事）逐段翻：
   vectorcraft/crates/
   - tools/src/draw2/gesture.rs（pencil 那支）：按下＝收点、起点靠近「选中的开放路径」端点（编辑范围 12 屏幕像素）＝接着画那条；
       拖＝每移动 ≥1 屏幕像素收一点、第一次拖就 Begin、每次都 Preview（拟合后的路径现场显示）；放开＝最后一点也收、
       Alt 放开 或（不是接着画 且 点数>2 且 头尾在「闭合范围」15 屏幕像素内）＝闭合，Commit；Esc＝取消；换工具＝照最后一次预览收下
       选项：fidelity（拟合容差，缺省 1.5）、fill（填色，缺省关）、editWithin 12、closeWithin 15（gesture.rs:234-253）
   - engine/src/cmd/draw2.rs:443-550  fit_freehand（去抖：点距 < max(tol·0.3, 0.05) 丢掉、最后一点一定留；转角 >~100° 的点当直角；
       Catmull-Rom 样条；再 simplify_with(tol, 转角 60°)）、freehand（path.freehand：新路径＝描边色（没有就黑）、描边宽、fill 才填；
       extend＝接到既有开放路径的末端／起端：起点换成那端、头尾近（max(tol·4, 6)）就闭合、把手接好）
   - tools/src/draw2.rs:36-59 catmull_rom（转角点／开放路径两端／不到 3 点＝没有把手；其余把手＝(下一点−上一点)/6）
   - pathops/src/edit.rs:10-104 simplify_with（按转角分段、每段按弧长取样、最小二乘拟合三次贝兹、近直线变直线、不比原来点多）、
     pathops/src/fit.rs 全档（fit_cubics／fit_rec／fit_single／generate／newton／max_error／is_straight／sample、start_tangent／end_tangent）、
     pathops/src/boolean.rs:379-407 segs_to_subpath
   我们这边：路径＝当前矢量层里的一个 bezier 形状（不是矢量层就新建一层，同钢笔）；「选中的开放路径」＝VecSel 选中的形状（画完自动选中，跟原码一样）。
   描边宽 0（我们右面板的缺省）时用 1px（原码 max(0.1)；VectorCraft 新文件的描边宽是 1）。
   ── 另加（原码无·照 PS 2020）：「磁性的」选项 ──
     PS 自由钢笔选项栏勾「磁性的」⇒ 变成磁性钢笔：齿轮里有 宽度（1..256 px，预设 10）、对比（1..100%，10）、频率（0..100，57）、钢笔压力（预设关）。
     手势照 PS：按一下放起点 → 不必按着，移动游标路径就自己贴着宽度内最明显的边走、按频率自动放紧固点；按一下＝手动紧固点；
     Backspace／Delete＝退上一个紧固点（退光＝取消）；Enter＝结束成开放路径；按两下＝最后一段贴边闭合、Alt+按两下＝直线闭合；按回起点＝闭合；
     途中 Alt+按一下＝直线段、Alt+按着拖＝手绘段；Esc 取消；Caps Lock＝游标画成宽度圆圈；开「钢笔压力」⇒ 绘图笔压得越重宽度越窄。
     找边／贴边算法借 tools/magneticlasso.js 露出的 window.MagneticKit（Sobel 梯度＋走廊里 Dijkstra live-wire、宽度内吸最强边、同一套压感公式）。
     定案＝贴边折线（像素中心）交给同一条 freeformpen.draw 按「曲线拟合」拟合成贝兹（一步历史）。磁性模式不接既有开放路径（PS 磁性钢笔也是从新路径起）。 */

const FreehandFit = (() => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0], hyp = a => Math.hypot(a[0], a[1]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const EPS = 1e-9;
  /* fit.rs:11-14 unit */
  const unit = v => { const l = hyp(v); return (l > 1e-12 && isFinite(l)) ? [v[0] / l, v[1] / l] : null; };
  const startT = c => unit(sub(c.p1, c.p0)) || unit(sub(c.p2, c.p0)) || unit(sub(c.p3, c.p0)) || [1, 0];
  const endT = c => unit(sub(c.p3, c.p2)) || unit(sub(c.p3, c.p1)) || unit(sub(c.p3, c.p0)) || [1, 0];
  const cub = (p0, p1, p2, p3) => ({p0, p1, p2, p3});
  const evalC = (c, t) => { const u = 1 - t, a = u*u*u, b = 3*u*u*t, d = 3*u*t*t, e = t*t*t; return [a*c.p0[0] + b*c.p1[0] + d*c.p2[0] + e*c.p3[0], a*c.p0[1] + b*c.p1[1] + d*c.p2[1] + e*c.p3[1]]; };
  /* kurbo arclen：64 段折线近似（只拿来定取样数） */
  const arclen = c => { let s = 0, q = c.p0; for (let i = 1; i <= 64; i++){ const r = evalC(c, i / 64); s += dist(q, r); q = r; } return s; };
  /* fit.rs:187-193 sample */
  const sample = (c, n, out, inc) => { for (let i = inc ? 0 : 1; i <= n; i++) out.push(evalC(c, i / n)); };
  /* fit.rs:172-185 is_straight */
  function isStraight(c, tol){
    const ch = sub(c.p3, c.p0), len = hyp(ch);
    if (len < 1e-12) return dist(c.p1, c.p0) <= tol && dist(c.p2, c.p0) <= tol;
    const dir = mul(ch, 1 / len);
    return [c.p1, c.p2].every(h => { const v = sub(h, c.p0), al = dot(v, dir); return Math.abs(cross(v, dir)) <= tol && al >= -tol && al <= len + tol; });
  }
  /* fit.rs:92-106 chord_params */
  function chord(pts){
    const u = [0]; let acc = 0;
    for (let i = 1; i < pts.length; i++){ acc += dist(pts[i-1], pts[i]); u.push(acc); }
    return acc > 0 ? u.map(x => x / acc) : u;
  }
  const bern = t => { const s = 1 - t; return [s*s*s, 3*s*s*t, 3*s*t*t, t*t*t]; };
  /* fit.rs:114-142 generate：固定两端切线、解 2×2 法方程求把手长 */
  function generate(pts, u, t0, t1){
    const p0 = pts[0], p3 = pts[pts.length - 1], dirIn = mul(t1, -1);
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < pts.length; i++){
      const b = bern(u[i]), a0 = mul(t0, b[1]), a1 = mul(dirIn, b[2]);
      c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
      const tmp = sub(pts[i], add(mul(p0, b[0] + b[1]), mul(p3, b[2] + b[3])));
      x0 += dot(a0, tmp); x1 += dot(a1, tmp);
    }
    const det = c00 * c11 - c01 * c01, seg = dist(p0, p3), eps = 1e-6 * seg;
    let al, ar;
    if (Math.abs(det) > 1e-12){ al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; } else { al = seg / 3; ar = seg / 3; }
    if (!isFinite(al) || !isFinite(ar) || al < eps || ar < eps){ al = seg / 3; ar = seg / 3; }
    const cap = seg * 4 + 1e-9; al = Math.min(al, cap); ar = Math.min(ar, cap);
    return cub(p0, add(p0, mul(t0, al)), add(p3, mul(dirIn, ar)), p3);
  }
  /* fit.rs:144-155 max_error */
  function maxError(pts, c, u){
    let e = 0, idx = Math.floor(pts.length / 2);
    for (let i = 0; i < pts.length; i++){ const d = dist(evalC(c, u[i]), pts[i]); if (d > e){ e = d; idx = i; } }
    return [e, idx];
  }
  /* fit.rs:157-170 newton */
  function newton(c, p, t){
    const q0 = mul(sub(c.p1, c.p0), 3), q1 = mul(sub(c.p2, c.p1), 3), q2 = mul(sub(c.p3, c.p2), 3);
    const u = 1 - t, d1 = add(add(mul(q0, u*u), mul(q1, 2*u*t)), mul(q2, t*t));
    const d2 = add(mul(mul(sub(q1, q0), 2), u), mul(mul(sub(q2, q1), 2), t));
    const q = sub(evalC(c, t), p), num = dot(q, d1), den = dot(d1, d1) + dot(q, d2);
    if (Math.abs(den) < 1e-12) return t;
    const nt = t - num / den;
    return isFinite(nt) ? Math.max(0, Math.min(1, nt)) : t;
  }
  /* fit.rs:71-90 fit_single（最多 6 轮牛顿重新参数化） */
  function fitSingle(pts, t0, t1){
    const u = chord(pts);
    let best = generate(pts, u, t0, t1), [be, bs] = maxError(pts, best, u);
    for (let k = 0; k < 6; k++){
      for (let i = 0; i < u.length; i++) u[i] = newton(best, pts[i], u[i]);
      const c = generate(pts, u, t0, t1), [e, s] = maxError(pts, c, u);
      if (e < be){ best = c; be = e; bs = s; } else break;
    }
    return [best, be, bs];
  }
  /* fit.rs:50-67 fit_rec */
  function fitRec(pts, t0, t1, tol, out, depth){
    const n = pts.length;
    if (n === 2){ const d = dist(pts[0], pts[1]) / 3; out.push(cub(pts[0], add(pts[0], mul(t0, d)), sub(pts[1], mul(t1, d)), pts[1])); return; }
    const [c, err, sp0] = fitSingle(pts, t0, t1);
    if (err <= tol || depth > 40){ out.push(c); return; }
    const sp = Math.max(1, Math.min(n - 2, sp0));
    const tc = unit(sub(pts[sp + 1], pts[sp - 1])) || t0;
    fitRec(pts.slice(0, sp + 1), t0, tc, tol, out, depth + 1);
    fitRec(pts.slice(sp), tc, t1, tol, out, depth + 1);
  }
  /* fit.rs:30-48 fit_cubics（先去掉重复点） */
  function fitCubics(pts, t0, t1, tol){
    const v = [];
    for (const p of pts) if (!v.length || dist(v[v.length - 1], p) > 1e-12) v.push(p);
    const out = [];
    if (v.length < 2) return out;
    fitRec(v, t0, t1, Math.max(tol, 1e-9), out, 0);
    return out;
  }
  /* 我们的锚点 ⇄ 段（把手 null＝等于锚点） */
  const P = a => [a.x, a.y], hOut = a => a.out || [a.x, a.y], hIn = a => a.in || [a.x, a.y];
  const withHandles = (p, hi, ho) => ({x:p[0], y:p[1], in:dist(hi, p) > EPS ? [hi[0], hi[1]] : null, out:dist(ho, p) > EPS ? [ho[0], ho[1]] : null});
  function segCount(sp){ const n = sp.anchors.length; return n < 2 ? 0 : sp.closed ? n : n - 1; }
  function segsOf(sp){
    const A = sp.anchors, out = [];
    for (let i = 0; i < segCount(sp); i++){ const a = A[i], b = A[(i + 1) % A.length]; out.push({c:cub(P(a), hOut(a), hIn(b), P(b)), line:!a.out && !b.in}); }
    return out;
  }
  const lineSeg = (a, b) => ({c:cub(a, a, b, b), line:true});
  /* boolean.rs:379-407 segs_to_subpath */
  function segsToSubpath(segs, closed){
    if (!segs.length) return null;
    const n = segs.length, A = [];
    for (let i = 0; i < n; i++){
      const s = segs[i], p = s.c.p0, ho = s.line ? p : s.c.p1;
      let hi;
      if (i === 0 && !closed) hi = p;
      else { const pv = segs[(i + n - 1) % n]; hi = pv.line ? p : pv.c.p2; }
      A.push(withHandles(p, hi, ho));
    }
    if (!closed){ const l = segs[n - 1], p = l.c.p3; A.push(withHandles(p, l.line ? p : l.c.p2, p)); }
    if (closed && A.length < 2) return null;
    return {anchors:A, closed};
  }
  /* edit.rs:41-44 turn_deg */
  const turnDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(endT(a.c), startT(b.c))))) * 180 / Math.PI;
  /* edit.rs:47-104 simplify_with（单一子路径；straight_lines＝false） */
  function simplify(sp, tolerance, cornerDeg){
    const tol = Math.max(tolerance, 1e-6);
    let segs = segsOf(sp); const n = segs.length;
    if (!n) return sp;
    const cornerAt = i => (!sp.closed && (i === 0 || i === n)) ? true : turnDeg(segs[(i + n - 1) % n], segs[i % n]) > cornerDeg;
    let corners = []; for (let i = 0; i < n; i++) if (cornerAt(i)) corners.push(i);
    if (sp.closed){
      if (corners.length){ const k = corners[0]; segs = segs.slice(k).concat(segs.slice(0, k)); corners = corners.map(c => c - k); }
      else corners = [0];
      corners.push(n);
    } else if (corners[corners.length - 1] !== n) corners.push(n);
    const result = [];
    for (let w = 0; w + 1 < corners.length; w++){
      const run = segs.slice(corners[w], corners[w + 1]); if (!run.length) continue;
      const pts = [];
      run.forEach((s, k) => { const m = Math.max(4, Math.min(256, Math.ceil(arclen(s.c) / (tol * 0.5)))); sample(s.c, m, pts, k === 0); });
      const t0 = startT(run[0].c), t1 = endT(run[run.length - 1].c);
      for (const c of fitCubics(pts, t0, t1, tol)){ const line = isStraight(c, tol * 0.02); result.push(line ? lineSeg(c.p0, c.p3) : {c, line}); }
    }
    const s = segsToSubpath(result, sp.closed);
    if (!s) return sp;
    return s.anchors.length > sp.anchors.length ? sp : s;            // no_worse：不比原来点多
  }
  /* draw2.rs:39-59 catmull_rom：pts＝[{p:[x,y], corner}] */
  function catmullRom(pts, closed){
    const n = pts.length, A = [];
    for (let i = 0; i < n; i++){
      const p = pts[i].p, ends = !closed && (i === 0 || i + 1 === n);
      if (pts[i].corner || ends || n < 3){ A.push({x:p[0], y:p[1], in:null, out:null}); continue; }
      const prev = pts[(i + n - 1) % n].p, next = pts[(i + 1) % n].p, t = mul(sub(next, prev), 1 / 6);
      if (hyp(t) < 1e-9){ A.push({x:p[0], y:p[1], in:null, out:null}); continue; }
      A.push({x:p[0], y:p[1], in:sub(p, t), out:add(p, t)});
    }
    return {anchors:A, closed:closed && n > 2};
  }
  /* draw2.rs:447-482 fit_freehand */
  function fitFreehand(pts, tol, closed){
    const min = Math.max(tol * 0.3, 0.05);
    if (!pts.length) return {anchors:[], closed};
    const p0 = pts[0], pn = pts[pts.length - 1], kept = [p0];
    for (let i = 1; i < pts.length; i++) if (dist(kept[kept.length - 1], pts[i]) >= min) kept.push(pts[i]);
    if (kept.length > 1) kept[kept.length - 1] = pn;                  // 最后一点一定是收尾
    else if (pts.length > 1) kept.push(pn);
    const n = kept.length;
    const marked = kept.map((p, i) => {
      let corner = false;
      if (i > 0 && i + 1 < n){ const a = sub(kept[i], kept[i-1]), b = sub(kept[i+1], kept[i]); corner = dot(a, b) / Math.max(hyp(a) * hyp(b), 1e-12) < -0.2; }   // 转 >~100°
      return {p, corner};
    });
    const sp = catmullRom(marked, closed);
    if (sp.anchors.length < 3) return sp;
    const f = simplify(sp, tol, 60);
    return f.anchors.length >= 2 ? f : sp;
  }
  const reverse = sp => ({closed:sp.closed, anchors:sp.anchors.slice().reverse().map(a => ({x:a.x, y:a.y, in:a.out, out:a.in}))});
  return {fitFreehand, catmullRom, simplify, fitCubics, segsToSubpath, isStraight, reverse, withHandles, dist};
})();
window.FreehandFit = FreehandFit;

/* ───────── 工具（gesture.rs，pencil 那支） ───────── */
const FreeformPen = {
  points: [], active: false, began: false, extend: null,
  fidelity: 1.5, fill: false, editWithin: 12, closeWithin: 15,      // gesture.rs:47-58 预设
  alt: false,

  tol(px){ return px / Math.max(UI.zoom, 1e-9); },                   // ToolContext::tol
  /* gesture.rs:80-97 find_extend：选中的开放路径、哪一端在编辑范围内（末端先） */
  findExtend(p){
    const L = Doc.active(); if (!L || L.kind !== 'vector' || !window.VecSel || VecSel.layerId !== L.id) return null;
    const tol = this.tol(this.editWithin);
    for (const id of VecSel.shapes){
      const s = L.data.shapes.find(x => x.id === id); if (!s || s.locked) continue;
      const v = VecSel.asBezier(s); if (!v || v.closed || !v.anchors || !v.anchors.length) continue;
      const f = v.anchors[0], l = v.anchors[v.anchors.length - 1];
      if (Math.hypot(p[0] - (l.x + L.x), p[1] - (l.y + L.y)) <= tol) return {layerId:L.id, shapeId:id, end:'end'};
      if (Math.hypot(p[0] - (f.x + L.x), p[1] - (f.y + L.y)) <= tol) return {layerId:L.id, shapeId:id, end:'start'};
    }
    return null;
  },
  params(closed){
    const v = {points:this.points.map(q => [q[0], q[1]]), fidelity:this.fidelity, closed, fill:this.fill};
    if (this.extend) v.extend = this.extend;
    return v;
  },
  down(e, pt){
    this.points = [[pt[0], pt[1]]]; this.active = true; this.began = false; this.alt = !!e.altKey;
    this.extend = this.findExtend(pt);
  },
  drag(e, pt){
    if (!this.active) return false;
    this.alt = !!e.altKey;
    const l = this.points[this.points.length - 1];
    if (Math.hypot(l[0] - pt[0], l[1] - pt[1]) < this.tol(1)) return false;
    this.points.push([pt[0], pt[1]]);
    this.began = true;                                                // Action::Begin("Pencil")＋Preview
    return true;
  },
  up(e, pt){
    if (!this.active) return;
    const l = this.points[this.points.length - 1];
    if (Math.hypot(l[0] - pt[0], l[1] - pt[1]) >= this.tol(1)) this.points.push([pt[0], pt[1]]);
    const out = this.finish(!!e.altKey);
    this.reset();
    return out;
  },
  /* gesture.rs:114-126 finish（pencil）：没开始画＝什么都不做；Alt 或（不是接着画 且 头尾近）＝闭合 */
  finish(alt){
    if (!this.began) return null;
    const P = this.points, near = P.length > 2 && Math.hypot(P[0][0] - P[P.length-1][0], P[0][1] - P[P.length-1][1]) <= this.tol(this.closeWithin);
    const closed = alt || (!this.extend && near);
    return CMD.run('freeformpen.draw', this.params(closed));
  },
  reset(){ this.active = false; this.began = false; this.points = []; this.extend = null; },
  /* 预览（原码是 Preview 直接改文件；我们画在叠画层：拟合后的路径照真外观＋蓝线） */
  preview(){
    if (!this.active || !this.began || this.points.length < 2) return null;
    const tol = Math.max(0.05, Math.min(100, this.fidelity));
    const docPts = this.points;
    if (this.extend){
      const L = Doc.byId(this.extend.layerId), s = L && L.data.shapes.find(x => x.id === this.extend.shapeId), v = s && VecSel.asBezier(s);
      if (v) return {ext:true, sp:ffExtendPath(v, L, docPts, tol, this.extend.end === 'start'), s};
    }
    return {sp:FreehandFit.fitFreehand(docPts, tol, false)};
  }
};
window.FreeformPen = FreeformPen;

/* draw2.rs:490-541 freehand 的 extend 分支（纯几何）：v＝既有路径的视图（图层坐标），pts＝文件坐标 → 文件坐标的新子路径 */
function ffExtendPath(v, L, pts, tol, atStart){
  const m = q => q ? [q[0] + L.x, q[1] + L.y] : null;
  let sp = {closed:false, anchors:v.anchors.map(a => ({x:a.x + L.x, y:a.y + L.y, in:m(a.in), out:m(a.out)}))};
  if (atStart) sp = FreehandFit.reverse(sp);
  const A = sp.anchors, first = [A[0].x, A[0].y], end = [A[A.length-1].x, A[A.length-1].y];
  pts = pts.map(q => [q[0], q[1]]); pts[0] = end;
  if (pts.length < 2) return atStart ? FreehandFit.reverse(sp) : sp;
  const closeTol = Math.max(tol * 4, 6);
  const closing = A.length >= 2 && FreehandFit.dist(pts[pts.length-1], first) <= closeTol;
  if (closing) pts[pts.length-1] = first;
  const fit = FreehandFit.fitFreehand(pts, tol, false), add = fit.anchors.slice();
  if (add.length) A[A.length-1].out = add[0].out;
  add.shift();
  A.push(...add);
  if (closing && A.length > 2){ const l = A.pop(); A[0].in = l.in; sp.closed = true; }
  sp.anchors = A.map(a => FreehandFit.withHandles([a.x, a.y], a.in || [a.x, a.y], a.out || [a.x, a.y]));
  if (atStart && !sp.closed) sp = FreehandFit.reverse(sp);
  return sp;
}

/* ───────── 磁性的（原码无·照 PS 2020） ───────── */
const FreeformMagnetic = {
  opt: {magnetic:false, width:10, contrast:10, frequency:57, penPressure:false},
  active: false, pts: [], anchors: [], live: [], E: null, btn: false, alt: null, hover: null, pressure: null, caps: false,
  K(){ return window.MagneticKit; },
  thr(){ return this.opt.contrast / 100; },
  zoom(){ return Math.max((window.UI && UI.zoom) || 1, 0.01); },
  width(){ const K = this.K(); return this.opt.penPressure && K ? K.pressureWidth(this.opt.width, this.pressure) : this.opt.width; },
  setPressure(m){ if (m && m.pressure !== undefined) this.pressure = (m.pressure === null || !isFinite(+m.pressure)) ? null : Math.min(1, Math.max(0, +m.pressure)); },
  anchor(){ return this.pts[this.pts.length - 1]; },
  reset(){ this.active = false; this.pts = []; this.anchors = []; this.live = []; this.E = null; this.btn = false; this.alt = null; },
  target(pt){ const K = this.K(); return K.snapEdge(this.E, pt, this.width(), this.thr()) || K.pix(pt); },
  /* 同磁性套索 update：贴边路径跟着游标；长过频率间距就沿路放紧固点 */
  update(pt){
    if (!this.active) return;
    const K = this.K(), tg = this.target(pt), sp = K.spacingOf(this.opt.frequency);
    let path = K.liveWire(this.E, this.anchor(), tg, this.width(), this.thr());
    for (let guard = 0; guard < 64 && K.pathLen(path) > sp; guard++){
      let acc = 0, k = path.length - 1;
      for (let i = 1; i < path.length; i++){ acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc >= sp){ k = i; break; } }
      if (k <= 0 || k >= path.length - 1) break;
      for (let i = 1; i <= k; i++) this.pts.push(path[i]);
      this.anchors.push(this.pts.length - 1);
      path = K.liveWire(this.E, this.anchor(), tg, this.width(), this.thr());
    }
    this.live = path.slice(1);
  },
  commitLive(){ for (const q of this.live) this.pts.push(q); this.live = []; if (this.anchors[this.anchors.length - 1] !== this.pts.length - 1) this.anchors.push(this.pts.length - 1); },
  start(pt){
    const K = this.K(); this.reset();
    this.E = K.edgeMap(K.samplePixels(false), Doc.width, Doc.height);
    this.active = true; this.pts = [this.target(pt)]; this.anchors = [0];
  },
  nearStart(pt){ const p0 = this.pts[0]; return p0 && this.pts.length + this.live.length >= 3 && Math.hypot(p0[0] + 0.5 - pt[0], p0[1] + 0.5 - pt[1]) < this.K().CLOSE_PX / this.zoom(); },
  down(pt, m){
    if (!this.K()) return null;
    this.btn = true; this.hover = pt; this.setPressure(m);
    if (!this.active){ this.start(pt); return null; }
    if (m.alt){ this.live = []; this.pts.push(this.K().pix(pt)); this.anchors.push(this.pts.length - 1); this.alt = {moved:false}; return null; }
    if (this.nearStart(pt)) return this.finish(true, true);
    this.update(pt); this.commitLive(); return null;
  },
  move(pt, m){
    this.hover = pt; this.setPressure(m);
    if (!this.active) return;
    if (this.btn && this.alt){
      const q = this.K().pix(pt), a = this.anchor();
      if (Math.hypot(q[0] - a[0], q[1] - a[1]) >= 1){ this.pts.push(q); this.alt.moved = true; }
      return;
    }
    this.update(pt);
  },
  up(){ this.btn = false; if (this.alt){ if (this.anchors[this.anchors.length - 1] !== this.pts.length - 1) this.anchors.push(this.pts.length - 1); this.alt = null; } },
  dbl(m){
    if (!this.active) return null;
    const tol = this.K().CLOSE_PX / this.zoom();
    while (this.anchors.length > 1){
      const a = this.pts[this.anchors[this.anchors.length - 1]], b = this.pts[this.anchors[this.anchors.length - 2]];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < tol){ this.anchors.pop(); this.pts.length = this.anchors[this.anchors.length - 1] + 1; } else break;
    }
    this.live = [];
    return this.finish(true, !m.alt);
  },
  back(){
    if (!this.active) return;
    if (this.anchors.length <= 1){ this.reset(); return; }
    this.anchors.pop(); this.pts.length = this.anchors[this.anchors.length - 1] + 1;
    if (this.hover) this.update(this.hover); else this.live = [];
  },
  /* 定案：closed＝闭合（magnetic＝最后一段贴边回起点，否则直线）；开放＝到目前的贴边路径为止 */
  finish(closed, magnetic){
    if (!this.active) return null;
    this.commitLive();
    if (closed && magnetic && this.pts.length){
      const seg = this.K().liveWire(this.E, this.anchor(), this.pts[0], this.width(), this.thr());
      for (let i = 1; i < seg.length - 1; i++) this.pts.push(seg[i]);
    }
    const pts = this.pts.map(this.K().ctr);
    this.reset();
    if (pts.length < (closed ? 3 : 2)) return null;
    return (this.last = CMD.run('freeformpen.draw', {points:pts, fidelity:FreeformPen.fidelity, closed:!!closed, fill:FreeformPen.fill}));
  },
  key(k){
    if (!this.active) return false;
    if (k === 'Enter'){ this.finish(false, false); return true; }       // PS：Enter＝结束开放路径
    if (k === 'Escape'){ this.reset(); return true; }
    if (k === 'Backspace' || k === 'Delete'){ this.back(); return true; }
    return false;
  }
};
window.FreeformMagnetic = FreeformMagnetic;

/* ───────── 命令 path.freehand ───────── */
CMD.reg('freeformpen.draw', {i18n:'', undoable:true,
  params:'{points:[[x,y]…] 文件坐标（≥2 点）, fidelity?:1.5（拟合容差 0.05..100）, closed?:bool, fill?:bool（用填色；缺省不填）, ' +
         'extend?:{shapeId, layerId?, end:"start"|"end"}（接到这条开放路径的那一端）, layerId?} ' +
         '＝ 自由钢笔拖一笔（path.freehand）：去抖→Catmull-Rom→最小二乘拟合成贝兹；新路径画进当前矢量层（不是就新建一层）、描边＝描边色（无＝黑、宽 0＝1px）、选中它 → {ok, id, layerId, anchors}'}, p => {
  const C = 'freeformpen.draw';
  const pts = (Array.isArray(p.points) ? p.points : []).map(v => Array.isArray(v) ? [+v[0], +v[1]] : (v && typeof v === 'object') ? [+v.x, +v.y] : null)
    .filter(q => q && isFinite(q[0]) && isFinite(q[1]));
  if (!pts.length) return {ok:false, error:C + ': need at least one point'};
  const tol = Math.max(0.05, Math.min(100, p.fidelity === undefined ? 1.5 : (+p.fidelity || 1.5)));
  const closed = !!p.closed;
  if (p.extend && typeof p.extend === 'object'){
    const L = p.extend.layerId ? Doc.byId(p.extend.layerId) : (VecSel.layer() || Doc.active());
    const s = L && L.kind === 'vector' ? L.data.shapes.find(x => x.id === p.extend.shapeId) : null;
    if (!s) return {ok:false, error:C + ': extend: no such path'};
    const v = VecSel.asBezier(s);
    if (!v || v.closed || !v.anchors || !v.anchors.length) return {ok:false, error:C + ': path has no open end'};
    if (pts.length < 2) return {ok:true, id:s.id, layerId:L.id};
    const sp = ffExtendPath(v, L, pts, tol, p.extend.end === 'start');
    VecSel.ensureBezier(L, s);
    const m = q => q ? [q[0] - L.x, q[1] - L.y] : null;
    s.anchors = sp.anchors.map(a => ({x:a.x - L.x, y:a.y - L.y, in:m(a.in), out:m(a.out)}));
    s.closed = !!sp.closed;
    Layer.invalidate(L);
    VecSel.setShapes(L.id, [s.id]);
    return {ok:true, id:s.id, layerId:L.id, anchors:s.anchors.length, closed:s.closed};
  }
  if (pts.length < 2) return {ok:false, error:C + ': need at least two points'};
  const sp = FreehandFit.fitFreehand(pts, tol, closed);
  const stroke = UI.stroke() === 'none' ? '#000000' : UI.stroke();   // stroke_paint：没有描边就黑
  const fill = p.fill ? UI.fill() : 'none';
  const r = addShape({type:'bezier', anchors:sp.anchors, closed:!!sp.closed, fill, stroke, strokeWidth:UI.strokeW() || 1, layerId:p.layerId});
  if (!r || r.ok === false) return r;
  VecSel.setShapes(r.layerId, [r.id]);                               // 新画的路径就是选中的（接着画才接得上）
  return {ok:true, id:r.id, layerId:r.layerId, anchors:sp.anchors.length, closed:!!sp.closed};
});
CMD.reg('freeformpen.options', {i18n:'',
  params:'{fidelity?:0.05..100（曲线拟合，缺省 1.5）, fill?:bool, editWithin?:0..100 屏幕像素（12）, closeWithin?:0..100（15）, ' +
         'magnetic?:bool（PS「磁性的」，缺省关）, width?:1..256 px（磁性找边宽度 10）, contrast?:1..100 %（10）, frequency?:0..100（自动紧固点频率 57，0＝不自动）, penPressure?:bool（钢笔压力：笔压越重宽度越窄）} → 目前选项；不给参数＝只读（gesture.rs set_option）'}, p => {
  const F = FreeformPen, M = FreeformMagnetic.opt, cl = (v, a, b, d) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : d));
  if (p.magnetic !== undefined){ const on = !!p.magnetic; if (on !== M.magnetic){ FreeformMagnetic.reset(); F.reset(); } M.magnetic = on; }
  if (p.width !== undefined) M.width = Math.round(cl(p.width, 1, 256, M.width));
  if (p.contrast !== undefined) M.contrast = Math.round(cl(p.contrast, 1, 100, M.contrast));
  if (p.frequency !== undefined) M.frequency = Math.round(cl(p.frequency, 0, 100, M.frequency));
  if (p.penPressure !== undefined) M.penPressure = !!p.penPressure;
  if (p.fidelity !== undefined) F.fidelity = cl(p.fidelity, 0.05, 100, F.fidelity);
  if (p.fill !== undefined) F.fill = !!p.fill;
  if (p.editWithin !== undefined) F.editWithin = cl(p.editWithin, 0, 100, F.editWithin);
  if (p.closeWithin !== undefined) F.closeWithin = cl(p.closeWithin, 0, 100, F.closeWithin);
  if (ToolState.cur === 'freeformpen' && window.UI) UI.buildOptions('freeformpen');
  return {ok:true, fidelity:F.fidelity, fill:F.fill, editWithin:F.editWithin, closeWithin:F.closeWithin,
    magnetic:M.magnetic, width:M.width, contrast:M.contrast, frequency:M.frequency, penPressure:M.penPressure};
});
CMD.reg('freeformpen.magnetic', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up"|"dblclick"|"key", x, y 文件坐标, alt?, pressure?=0..1（绘图笔压力，penPressure 开着才影响宽度）, key?:"Enter"|"Escape"|"Backspace"}…], width?, contrast?, frequency?（只这次用）} ' +
         '磁性自由钢笔（不论选项栏磁性开没开）：第一个 down 放起点；move（不必按着）贴边走、自动放紧固点；之后 down＝手动紧固点、down 在起点 8 萤幕点内＝闭合；alt+down＝直线点、alt 按着 move＝手绘；' +
         'dblclick＝贴边闭合（alt＝直线闭合）；key Enter＝结束开放路径／Escape 取消／Backspace 退紧固点；定案走 freeformpen.draw（拟合成贝兹） → {ok, active, points, anchors, id?（定案的路径）}'}, p => {
  const FM = FreeformMagnetic, saved = Object.assign({}, FM.opt);
  if (!window.MagneticKit) return {ok:false, error:'freeformpen.magnetic: MagneticKit (tools/magneticlasso.js) not loaded'};
  for (const k of ['width', 'contrast', 'frequency']) if (p[k] !== undefined && isFinite(+p[k])) FM.opt[k] = +p[k];
  let made = null; FM.last = null;
  try {
    for (const e of (Array.isArray(p.events) ? p.events : [])){
      const pt = [Number(e.x) || 0, Number(e.y) || 0], m = {alt:!!e.alt};
      if (e.pressure !== undefined) m.pressure = e.pressure;
      if (e.kind === 'down') FM.down(pt, m);
      else if (e.kind === 'move') FM.move(pt, m);
      else if (e.kind === 'up') FM.up();
      else if (e.kind === 'dblclick') FM.dbl(m);
      else if (e.kind === 'key') FM.key(e.key);
      if (FM.last){ if (FM.last.id) made = FM.last; FM.last = null; }
    }
  } finally { for (const k of ['width', 'contrast', 'frequency']) FM.opt[k] = saved[k]; }
  if (window.UI) UI.draw();
  const ctr = MagneticKit.ctr;
  return {ok:true, active:FM.active, points:FM.pts.concat(FM.live).map(ctr), anchors:FM.anchors.map(i => ctr(FM.pts[i])), id:made ? made.id : null, layerId:made ? made.layerId : null};
});

Tools.reg({
  id:'freeformpen', icon:'✎', group:'vector', order:12, for:'common', needs:'vector', opts:[], cursor:'crosshair',
  hint:'ui.ffHint',
  strings:{
    'zh-Hant':{'tool.freeformpen':'創意筆工具', 'ui.ffHint':'拖曳＝手繪路徑（自動擬合成曲線）｜Alt 放開或回到起點附近＝封閉｜從選取的開放路徑端點拖＝接著畫｜Esc 取消',
               'opt.ffFidelity':'曲線擬合：', 'opt.ffFill':'填色', 'opt.ffEdit':'編輯範圍：', 'opt.ffClose':'封閉範圍：',
               'opt.ffMagnetic':'磁性的', 'opt.ffWidth':'寬度：', 'opt.ffContrast':'對比：', 'opt.ffFrequency':'頻率：', 'opt.ffPressure':'鋼筆壓力'},
    'zh-Hans':{'tool.freeformpen':'自由钢笔工具', 'ui.ffHint':'拖曳＝手绘路径（自动拟合成曲线）｜Alt 放开或回到起点附近＝闭合｜从选中的开放路径端点拖＝接着画｜Esc 取消',
               'opt.ffFidelity':'曲线拟合：', 'opt.ffFill':'填色', 'opt.ffEdit':'编辑范围：', 'opt.ffClose':'闭合范围：',
               'opt.ffMagnetic':'磁性的', 'opt.ffWidth':'宽度：', 'opt.ffContrast':'对比：', 'opt.ffFrequency':'频率：', 'opt.ffPressure':'钢笔压力'},
    'en':{'tool.freeformpen':'Freeform Pen Tool', 'ui.ffHint':'Drag to draw a freehand path (fitted to curves) | Release with Alt or end near the start: close | Drag from an end of the selected open path: continue it | Esc: cancel',
          'opt.ffFidelity':'Curve Fit:', 'opt.ffFill':'Fill', 'opt.ffEdit':'Edit within:', 'opt.ffClose':'Close within:',
               'opt.ffMagnetic':'Magnetic', 'opt.ffWidth':'Width:', 'opt.ffContrast':'Contrast:', 'opt.ffFrequency':'Frequency:', 'opt.ffPressure':'Pen Pressure'}
  },
  buildOptions(box, add, mk){
    const M = FreeformMagnetic.opt;
    const num = (key, k, min, max, step) => {
      const n = mk('number', {min, max, step, value:FreeformPen[k], id:'ff_' + k}); n.style.width = '56px';
      n.onchange = () => CMD.run('freeformpen.options', {[k]:+n.value}); add(key, n);
    };
    num('ffFidelity', 'fidelity', 0.05, 100, 0.5);
    const f = mk('checkbox', {checked:FreeformPen.fill, id:'ff_fill'}); f.onchange = () => { CMD.run('freeformpen.options', {fill:f.checked}); f.blur(); }; add('ffFill', f);
    num('ffEdit', 'editWithin', 0, 100, 1);
    num('ffClose', 'closeWithin', 0, 100, 1);
    /* PS：「磁性的」勾选＋（齿轮里的）宽度／对比／频率／钢笔压力 */
    const mg = mk('checkbox', {checked:M.magnetic, id:'ff_magnetic'}); mg.dataset.opt = 'magnetic';
    mg.onchange = () => { CMD.run('freeformpen.options', {magnetic:mg.checked}); mg.blur(); UI.draw(); }; add('ffMagnetic', mg);
    const mnum = (key, k, min, max) => {
      const n = mk('number', {min, max, step:1, value:M[k], id:'ff_' + k}); n.style.width = '52px'; n.dataset.opt = k; n.disabled = !M.magnetic;
      n.onchange = () => CMD.run('freeformpen.options', {[k]:+n.value}); add(key, n);
    };
    mnum('ffWidth', 'width', 1, 256); mnum('ffContrast', 'contrast', 1, 100); mnum('ffFrequency', 'frequency', 0, 100);
    const pr = mk('checkbox', {checked:M.penPressure, id:'ff_penPressure'}); pr.dataset.opt = 'penPressure'; pr.disabled = !M.magnetic;
    pr.onchange = () => { CMD.run('freeformpen.options', {penPressure:pr.checked}); pr.blur(); }; add('ffPressure', pr);
  },
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0) return;
    if (FreeformMagnetic.opt.magnetic && window.MagneticKit){ FreeformMagnetic.down(pt, {alt:e.altKey, pressure:MagneticKit.penPressure(e)}); UI.draw(); return; }
    FreeformPen.down(e, pt); UI.draw();
  },
  onMove(e, pt, P){
    const FM = FreeformMagnetic;
    if (FM.opt.magnetic && window.MagneticKit){
      FM.caps = !!(e.getModifierState && e.getModifierState('CapsLock'));
      FM.move(pt, {alt:e.altKey, pressure:MagneticKit.penPressure(e)}); UI.draw(); return;
    }
    if (!P.down || !FreeformPen.active) return; if (FreeformPen.drag(e, pt)) UI.draw();
  },
  onUp(e, pt){ if (FreeformMagnetic.opt.magnetic && window.MagneticKit){ FreeformMagnetic.up(); UI.draw(); return; } FreeformPen.up(e, pt); UI.draw(); },
  onDblClick(e){ if (FreeformMagnetic.opt.magnetic && FreeformMagnetic.active){ FreeformMagnetic.dbl({alt:e.altKey}); UI.draw(); } },
  onKey(e){
    if (FreeformMagnetic.active && !e.ctrlKey && !e.metaKey && FreeformMagnetic.key(e.key)){ UI.draw(); return true; }
    if (FreeformMagnetic.opt.magnetic && (e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey){   // 同磁性套索：[ ] 宽度 ∓1
      CMD.run('freeformpen.options', {width:FreeformMagnetic.opt.width + (e.key === '[' ? -1 : 1)});
      if (FreeformMagnetic.active && FreeformMagnetic.hover) FreeformMagnetic.update(FreeformMagnetic.hover);
      UI.draw(); return true;
    }
    if (e.key === 'Escape' && FreeformPen.active){ FreeformPen.reset(); UI.draw(); return true; }   // gesture.rs:195-201
    return false;
  },
  /* gesture.rs:213-219 deactivate：已开始画＝照最后一次预览（不闭合）收下；磁性的＝到目前的路径收成开放路径 */
  onDeactivate(){
    if (FreeformMagnetic.active) FreeformMagnetic.finish(false, false);
    FreeformMagnetic.reset(); FreeformMagnetic.hover = null;
    if (FreeformPen.active && FreeformPen.began) FreeformPen.finish(false); FreeformPen.reset();
  },
  drawOverlay(ctx, s){
    const FM = FreeformMagnetic;
    if (FM.opt.magnetic){
      const dpr = s / Math.max(UI.zoom, 1e-9), S = q => [(q[0] + 0.5) * s, (q[1] + 0.5) * s];
      ctx.save();
      if (FM.active){
        const all = FM.pts.concat(FM.live);
        ctx.strokeStyle = '#4f9dff'; ctx.lineWidth = dpr; ctx.setLineDash([]); ctx.beginPath();
        all.forEach((q, i) => { const p = S(q); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke();
        const h = 2.5 * dpr;
        for (const i of FM.anchors){ const p = S(FM.pts[i]); ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - h, p[1] - h, 2 * h, 2 * h); ctx.strokeStyle = '#4f9dff'; ctx.strokeRect(p[0] - h, p[1] - h, 2 * h, 2 * h); }
      }
      if (FM.hover && FM.caps){                                       // Caps Lock：宽度圆圈
        const c = [FM.hover[0] * s, FM.hover[1] * s]; ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(c[0], c[1], FM.width() * s + 0.5 * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(c[0], c[1], FM.width() * s, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const pv = FreeformPen.preview(); if (!pv) return;
    const dpr = s / Math.max(UI.zoom, 1e-9);
    ctx.save();
    const st = pv.ext ? {stroke:pv.s.stroke, strokeWidth:pv.s.strokeWidth, fill:pv.s.fill} :
      {stroke:UI.stroke() === 'none' ? '#000000' : UI.stroke(), strokeWidth:UI.strokeW() || 1, fill:FreeformPen.fill ? UI.fill() : 'none'};
    drawShape(ctx, Object.assign({type:'bezier', anchors:pv.sp.anchors, closed:pv.sp.closed}, st), s);
    ctx.strokeStyle = '#4f9dff'; ctx.lineWidth = dpr; ctx.setLineDash([]);
    ctx.beginPath(); bezierPath(ctx, pv.sp, s); ctx.stroke();
    ctx.restore();
  }
});
