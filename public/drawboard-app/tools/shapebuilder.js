/* 形状生成器（AI Shift+M）——照 VectorCraft 原始码逐段翻译：
     tools/src/builder.rs:1-273   名字常数、is_live_paint、leaf_shapes（隐藏的／参考线／剪切路径不算，编组往下找，实时上色组＝它的面）、node_outline、
                                  shapes_for、sorted_roots、sample_polyline、hatch（灰色斜线网）、RegionCache（按「文件＋选取」快取区域、at＝外框内且绕数≠0）
     tools/src/builder.rs:275-384 ShapeBuilderTool：Move＝悬停的区域；Down（没选东西＝什么都不做）开始拖、记下 Alt；Drag 每移 tol(1) 记一点、
                                  沿折线每 tol(2) 取样碰到的区域；Up 补最后一点，碰到区域才发 shapeBuilder.merge{ids（后→前）, points, erase: Alt}；
                                  overlays：拖曳中＝碰到的区域，否则＝悬停区域；斜线网（间距 tol(4)）＋轮廓，Alt 拖＝红色、否则灰；拖曳折线；游标十字
     engine/src/cmd/buildcmds.rs:34-53、159-344  shapeBuilder.merge／shapeBuilder.regions 登记与正文（sb_merge：区域＝平面分割；取样步长＝
                                  max(选取外框长边/2000, 0.25)；碰到的区域联集；被碰到的来源各自减掉联集（剩下的留原外观）；没碰到的来源原样（换新 id）；
                                  不是 Alt ⇒ 联集变一个新形状，外观照「第一个碰到的区域最上面那个来源」、插在那个来源后面；fill 参数可改填色；
                                  replace_roots：拿掉全部来源、新的一串插在最前面那个来源原本的位置；选中全部新形状）
     pathops/src/pathfinder.rs:53-71、250-265  Region{path, sources}、top()、regions、merge_regions（联集）
   平面分割：原码 po::regions 用 linesweeper；我们照 pathfinder.rs 测试里的 regions_one_mask_at_a_time（原码断言跟 regions_of 完全一样）——
     先用 ai-object 的 AiR3.livePaint.planar 把全部轮廓切成平面图、每个面取一个里面的点算「被哪些来源盖住」（mask），
     再对每种 mask 跑 AIObj.arrangement(来源, m ⇒ m == mask) 拿到边界环、按套叠深度分组（偶数层＝外圈、奇数层＝洞）＝一个个区域。
     联集／差集也用 AIObj.arrangement（boolean.rs 的替代实作，见 menus/impl/ai-object.js 档头）；环拟合回曲线用 AIObj.tidyLoop。
   我们这边的对应：选取＝VecSel（矢量层最上层的物件）；形状与区域都在图层坐标，滑鼠点是文件坐标 ⇒ 减 L.x/L.y；
     命令吃文件坐标（agent 跟滑鼠同一条路）。
   共用：本档挂 window.BuildKit（区域、取样、斜线网、实时上色组的查找）给 livepaint.js／livepaintselect.js 读。 */
(function(){
'use strict';
const R3 = () => window.AiR3, O = () => window.AIObj;
const HATCH = '#808080', HIGHLIGHT_RED = '#ff2a2a';            // builder.rs:31-33
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polyArea = P => { let s = 0; for (let i = 0; i < P.length; i++){ const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const bboxOf = polys => { let r = null; for (const P of polys) for (const p of P){ if (!r) r = {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}; else { r.x0 = Math.min(r.x0, p[0]); r.y0 = Math.min(r.y0, p[1]); r.x1 = Math.max(r.x1, p[0]); r.y1 = Math.max(r.y1, p[1]); } } return r; };
const inBox = (b, p, e) => !!b && p[0] >= b.x0 - e && p[0] <= b.x1 + e && p[1] >= b.y0 - e && p[1] <= b.y1 + e;

/* 点在多边形组里（path_contains：nonzero／evenodd） */
function inside(polys, rule, p){
  let w = 0, c = 0;
  for (const P of polys) for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a[1] <= p[1]) !== (b[1] <= p[1])){ const x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]); if (x > p[0]){ c++; w += b[1] > a[1] ? 1 : -1; } }
  }
  return rule === 'evenodd' ? (c % 2 === 1) : w !== 0;
}
/* interior_point（buildcmds.rs:209-252）的扩充：几条水平线上「在里面」的区间中点，按区间宽度由大到小全部列出 */
function interiorPoints(polys, rule){
  const b = bboxOf(polys); if (!b) return [];
  const out = [];
  for (const f of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875, 0.0625, 0.9375, 0.03125, 0.96875, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125]){
    const y = b.y0 + (b.y1 - b.y0) * f, xs = [];
    for (const P of polys) for (let i = 0; i < P.length; i++){ const a = P[i], c = P[(i + 1) % P.length]; if ((a[1] <= y) !== (c[1] <= y)) xs.push(a[0] + (y - a[1]) / (c[1] - a[1]) * (c[0] - a[0])); }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i++){ const m = [(xs[i] + xs[i + 1]) / 2, y]; if (xs[i + 1] - xs[i] > 1e-9 && inside(polys, rule, m)) out.push([xs[i + 1] - xs[i], m]); }
  }
  out.sort((u, v) => v[0] - u[0]);
  return out.map(x => x[1]);
}

/* ── builder.rs:35-160 ── */
const LIVE_PAINT_PREFIX = 'Live Paint';
const isLP = n => !!n && n.type === 'group' && !n.clip && typeof n.name === 'string' && n.name.startsWith(LIVE_PAINT_PREFIX);
/* leaf_shapes：路径、复合路径（当一个形状）；参考线、剪切路径、隐藏的跳过；编组往下（实时上色组＝面＋边，来源组是藏起来的） */
function leafShapes(n, out){
  if (!n || n.visible === false) return out;
  if (n.type === 'compound') out.push(n);
  else if (R3().isLeaf(n)){ if (!n.guide && !n.clipping) out.push(n); }
  else if (n.type === 'group') (n.children || []).forEach(c => leafShapes(c, out));
  return out;
}
/* node_outline：填色用的折线组与填色规则（开放子路径也当闭合，同 fill_bezpath） */
/* opt（形状生成器工具选项才给；livepaint 不给＝原样）：AI 2020「将开放的填色路径视为闭合」——
   开放子路径没有填色（或这项关掉）⇒ 不补闭合线，只当分隔线（折线去了又回、面积 0、不盖住任何区域）；ends 收开放端点给间隙检测 */
const paintedFill = f => !!f && f !== 'none' && !(typeof f === 'object' && f.none);
function nodeOutline(n, opt){
  const polys = [], ends = [], cuts = [];
  for (const v of R3().subviews(n)){
    let P = O().flatten(v); if (P.length < 2) continue;
    if (!v.closed && opt){
      let len = 0; for (let i = 1; i < P.length; i++) len += dist(P[i - 1], P[i]);
      ends.push({p:P[0], pi:polys.length, at:0}, {p:P[P.length - 1], pi:polys.length, at:len});
      if (!paintedFill(n.fill) || opt.openAsClosed === false){ cuts.push(P); P = P.concat(P.slice(1, -1).reverse()); }
    }
    polys.push(P);
  }
  return {polys, ends, cuts, rule:n.type === 'compound' && n.rule === 'evenodd' ? 'evenodd' : 'nonzero'};
}
/* shapes_for：roots（后→前）→ 平面分割的输入与它们来自哪个叶子
   cuts／cutter（AI 2020，原码没有）：只当分隔线的开放子路径（原折线）；整个叶子都是这种＝分割线（直线段工具画的线），见 splitByCutters／cutterPieces */
function shapesFor(roots, opt){
  const lv = []; roots.forEach(r => leafShapes(r, lv));
  const shapes = [];
  for (const l of lv){
    const o = nodeOutline(l, opt);
    if (o.polys.length && o.polys.every(P => P.every(p => isFinite(p[0]) && isFinite(p[1]))))
      shapes.push({polys:o.polys, rule:o.rule, leaf:l, ends:o.ends, cuts:o.cuts, cutter:o.cuts.length > 0 && o.cuts.length === o.polys.length});
  }
  return shapes;
}
/* ── AI 2020：没填色的开放路径（直线段、钢笔线）在形状生成器里是「分割线」──
   例：两个同心圆＋四条竖线，全选 Shift+M ⇒ 圆环被竖线切成一块块（左边 C、缺口、竖条、右边 D），各自能合并／Alt 删掉。
   VectorCraft 原码（builder.rs leaf_shapes＋fill_bezpath）把开放路径当闭合填色、面积 0 ⇒ 不切任何区域；这里照 AI 补：
   ① splitByCutters：区域被分割线穿过 ⇒ 用 livePaint.planar 把「区域边界＋分割线」切成平面图，每个有界面跟区域取交集＝一小块（同一组来源）；
   ② cutterPieces：分割线在跟别的轮廓（含别的分割线）的交点处断开成一段段（AI：动过形状生成器之后线上交点多了锚点、每段是独立路径） */
function splitByCutters(out, shapes){
  const cut = [];
  shapes.forEach(s => (s.cuts || []).forEach(P => cut.push({P, b:bboxOf([P])})));
  if (!cut.length) return out;
  const res = [];
  for (const r of out){
    const cs = cut.filter(c => c.b.x0 <= r.bb.x1 && c.b.x1 >= r.bb.x0 && c.b.y0 <= r.bb.y1 && c.b.y1 >= r.bb.y0);
    const step = Math.max(Math.max(r.bb.x1 - r.bb.x0, r.bb.y1 - r.bb.y0) / 400, 0.05);
    const through = cs.filter(c => samplePolyline(c.P, step).some(q => inBox(r.bb, q, 0) && inside(r.loops, 'evenodd', q)));
    if (!through.length){ res.push(r); continue; }
    const pl = R3().livePaint.planar([{polys:r.loops}].concat(through.map(c => ({polys:[c.P.concat(c.P.slice(1, -1).reverse())]}))));
    if (!pl){ res.push(r); continue; }
    const cyc = pl.faces.map(F => ({F, s:polyArea(F)})).filter(c => Math.abs(c.s) > 1e-9);
    const outerSign = cyc.reduce((m, c) => Math.abs(c.s) > Math.abs(m.s) ? c : m, {s:0}).s > 0 ? 1 : -1;
    const parts = [];
    for (const c of cyc){
      if (Math.sign(c.s) === outerSign) continue;                                   // 每个连通分量的外圈
      const loops = O().arrangement([{polys:r.loops, rule:'evenodd'}, {polys:[c.F], rule:'nonzero'}], m => m[0] && m[1]);
      if (loops.length) parts.push(loops);
    }
    if (parts.length <= 1){ res.push(r); continue; }                                // 只切一刀没断开（例如圆环只横过一条线）＝还是一块
    parts.forEach(loops => res.push({loops, sources:r.sources.slice(), bb:bboxOf(loops), area:loops.reduce((s, P, i) => s + (i ? -1 : 1) * Math.abs(polyArea(P)), 0)}));
  }
  return res;
}
const clampT = (t, a, b) => Math.max(a, Math.min(b, t));
/* 分割线 → 一段段（图层坐标）：[{si 第几个形状, pi 第几条子路径, pts 折线}] */
function cutterPieces(shapes){
  const segs = [];
  shapes.forEach((s, si) => s.polys.forEach(P => { for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; if (dist(a, b) > 1e-9) segs.push({a, b, si, x0:Math.min(a[0], b[0]), x1:Math.max(a[0], b[0]), y0:Math.min(a[1], b[1]), y1:Math.max(a[1], b[1])}); } }));
  const out = [];
  shapes.forEach((s, si) => {
    if (!s.cutter) return;
    s.cuts.forEach((P, pi) => {
      const us = [];
      for (let i = 0; i + 1 < P.length; i++){
        const a = P[i], b = P[i + 1], r = sub(b, a);
        const x0 = Math.min(a[0], b[0]) - 1e-9, x1 = Math.max(a[0], b[0]) + 1e-9, y0 = Math.min(a[1], b[1]) - 1e-9, y1 = Math.max(a[1], b[1]) + 1e-9;
        for (const e of segs){
          if (e.si === si || e.x0 > x1 || e.x1 < x0 || e.y0 > y1 || e.y1 < y0) continue;
          const sv = sub(e.b, e.a), den = r[0] * sv[1] - r[1] * sv[0]; if (Math.abs(den) < 1e-12) continue;
          const t = ((e.a[0] - a[0]) * sv[1] - (e.a[1] - a[1]) * sv[0]) / den, u = ((e.a[0] - a[0]) * r[1] - (e.a[1] - a[1]) * r[0]) / den;
          if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) us.push(i + clampT(t, 0, 1));
        }
      }
      const at = u => { const i = Math.min(Math.floor(u), P.length - 2), t = u - i; return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]; };
      us.sort((x, y) => x - y);
      const cutsAt = [];
      // 合并后的形状是拟合回来的曲线（tidyLoop 容差 0.03）⇒ 交点跟上次断开的端点差一点点；离端点／上一刀 MIN 以内的不算，免得切出一堆零长度的碎段
      const MIN = 0.25;
      for (const u of us){ const q = at(u); if (dist(q, P[0]) < MIN || dist(q, P[P.length - 1]) < MIN) continue; if (cutsAt.length && dist(at(cutsAt[cutsAt.length - 1]), q) < MIN) continue; cutsAt.push(u); }
      const bnd = [0].concat(cutsAt, [P.length - 1]);
      for (let k = 0; k + 1 < bnd.length; k++){
        const u0 = bnd[k], u1 = bnd[k + 1], pts = [at(u0)];
        for (let i = Math.floor(u0) + 1; i < u1 - 1e-12; i++) if (i > u0 + 1e-12) pts.push(P[i].slice());
        pts.push(at(u1));
        let len = 0; for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
        if (len > 1e-6) out.push({si, pi, pts, len});
      }
    });
  });
  return out;
}
/* 合并／删除过的形状是拟合回来的曲线（tidyLoop 容差 0.03），跟没动过的轮廓（例如内圈）差一点点 ⇒ 两者之间多出极细的碎区（厚度 ≪ 1 px）。
   AI 的几何是精确的、没有这种碎区；这里把「贴着这次碰到的区域」的碎区一起算进去（合并＝补进去、删除＝一起删），免得最后留一圈看不见的碎片。 */
function isSliverLoop(P){ let per = 0; for (let i = 0; i < P.length; i++) per += dist(P[i], P[(i + 1) % P.length]); return 2 * Math.abs(polyArea(P)) / Math.max(per, 1e-9) < 0.1 && Math.abs(polyArea(P)) < 4; }
function absorbSlivers(regs, touched){
  if (!touched.length) return;
  const perim = r => r.loops.reduce((s, P) => { for (let i = 0; i < P.length; i++) s += dist(P[i], P[(i + 1) % P.length]); return s; }, 0);
  const thin = regs.map((r, i) => !touched.includes(i) && r.sources.length > 0 && 2 * Math.abs(r.area) / Math.max(perim(r), 1e-9) < 0.25);
  if (!thin.some(Boolean)) return;
  const near = (r, q) => regs[q].loops.some(P => P.some((p, k) => { const a = p, b = P[(k + 1) % P.length]; return r.loops.some(R2 => R2.some(v => distToPolyline(v, [a, b]) < 0.3)); }));
  for (let pass = 0; pass < 2; pass++){
    const add = [];
    const ov = (a, b) => a.x0 <= b.x1 + 0.5 && b.x0 <= a.x1 + 0.5 && a.y0 <= b.y1 + 0.5 && b.y0 <= a.y1 + 0.5;
    regs.forEach((r, i) => { if (thin[i] && !touched.includes(i) && touched.some(t => ov(regs[t].bb, r.bb) && near(r, t))) add.push(i); });
    if (!add.length) break;
    add.forEach(i => touched.push(i));
  }
}
const distToPolyline = (q, pts) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++){ const a = pts[i], b = pts[i + 1], v = sub(b, a), L2 = v[0] * v[0] + v[1] * v[1]; const t = L2 ? clampT(((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / L2, 0, 1) : 0; d = Math.min(d, dist(q, [a[0] + v[0] * t, a[1] + v[1] * t])); } return d; };
/* 一段的两侧取样点（最长那一小段的中点往法向两边各 eps） */
function pieceSides(pts, eps){
  let bi = 0, bl = -1; for (let i = 0; i + 1 < pts.length; i++){ const l = dist(pts[i], pts[i + 1]); if (l > bl){ bl = l; bi = i; } }
  const a = pts[bi], b = pts[bi + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = bl > 0 ? [-(b[1] - a[1]) / bl, (b[0] - a[0]) / bl] : [0, 0], e = Math.min(eps, bl / 4 || eps);
  return [[m[0] + n[0] * e, m[1] + n[1] * e], [m[0] - n[0] * e, m[1] - n[1] * e]];
}
/* 间隙检测（AI 2020 形状生成器选项「间隙检测」）：开放端点离别的线（或另一个端点）在间隙长度内 ⇒ 补一条看不见的桥，
   只进平面分割（围出闭合的空区），不算来源、不盖住区域。回 [[a,b]…]（图层坐标） */
const GAP_LEN = {small:3, medium:6, large:12};            // AI：小 3 pt、中 6 pt、大 12 pt（本画板 1 pt＝1 px）
function gapBridges(shapes, gap){
  if (!(gap > 0)) return [];
  const segs = [], tot = new Map();                      // [a, b, 形状, 子路径, 弧长起点, 弧长终点]
  shapes.forEach((s, si) => s.polys.forEach((P, pi) => {
    let at = 0;
    for (let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length], l = dist(a, b); if (l > 1e-9) segs.push([a, b, si, pi, at, at + l]); at += l; }
    tot.set(si + ':' + pi, at);
  }));
  const near = (p, a, b) => { const d = sub(b, a), L2 = d[0] * d[0] + d[1] * d[1]; let t = L2 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2 : 0; t = Math.max(0, Math.min(1, t)); return [a[0] + d[0] * t, a[1] + d[1] * t]; };
  const out = [];
  shapes.forEach((s, si) => (s.ends || []).forEach(E => {
    const e = E.p, T = tot.get(si + ':' + E.pi) || 0;
    let best = null, bd = Infinity, touching = false;
    for (const [a, b, sj, pj, s0, s1] of segs){
      if (sj === si && pj === E.pi){                     // 自己这条线：沿线离端点 2×间隙以内的那几段不算（曲线拍平的小段）
        const m = (s0 + s1) / 2, d = Math.abs(m - E.at), arc = Math.min(d, T - d);
        if (arc - (s1 - s0) / 2 <= 2 * gap) continue;
      }
      const q = near(e, a, b), d = dist(q, e);
      if (d < 1e-6){ touching = true; break; }           // 端点已经碰到别的线（交点或接上）＝没间隙
      if (d <= gap && d < bd){ bd = d; best = q; }
    }
    if (!touching && best) out.push([e.slice(), best]);
  }));
  closedGapBridges(shapes, gap, near).forEach(b => out.push(b));
  return out;
}
/* 间隙检测 ②：两条闭合路径（不同物件、彼此不相交）边缘距离 ≤ 间隙长度的那一段＝窄缝 ⇒ 在窄缝的两头各补一条桥，
   窄缝变成一块封闭的空区、被几乎围住的区域也跟着封闭（AI 2020：间隙检测也认物件之间的缝，不只开放端点） */
function closedGapBridges(shapes, gap, near){
  const C = [];
  shapes.forEach((s, si) => {
    const open = new Set((s.ends || []).map(E => E.pi));
    s.polys.forEach((P, pi) => { if (!open.has(pi) && P.length >= 3) C.push({si, P, b:bboxOf([P])}); });
  });
  const out = [];
  const segsX = (P, Q) => {                                  // 两个环有没有相交（有＝本来就分好区，不算缝）
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i + 1) % P.length];
      for (let j = 0; j < Q.length; j++){
        const c = Q[j], d = Q[(j + 1) % Q.length];
        if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
        const r = sub(b, a), q = sub(d, c), den = r[0] * q[1] - r[1] * q[0]; if (Math.abs(den) < 1e-12) continue;
        const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++){
    const A = C[i], B = C[j]; if (A.si === B.si) continue;
    if (A.b.x0 - gap > B.b.x1 || B.b.x0 - gap > A.b.x1 || A.b.y0 - gap > B.b.y1 || B.b.y0 - gap > A.b.y1) continue;
    if (segsX(A.P, B.P)) continue;
    const step = Math.max(gap / 3, 0.05), S = [];             // A 沿边重取样（每 gap/3）
    for (let k = 0; k < A.P.length; k++){ const a = A.P[k], b = A.P[(k + 1) % A.P.length], n = Math.max(1, Math.ceil(dist(a, b) / step)); for (let m = 0; m < n; m++) S.push([a[0] + (b[0] - a[0]) * m / n, a[1] + (b[1] - a[1]) * m / n]); }
    if (S.length > 20000) continue;
    const nq = S.map(p => {
      if (!inBox(B.b, p, gap)) return null;
      if (inside([B.P], 'evenodd', p)) return null;            // 套在 B 里面＝不是缝
      let best = null, bd = gap;
      for (let k = 0; k < B.P.length; k++){ const q = near(p, B.P[k], B.P[(k + 1) % B.P.length]), d = dist(q, p); if (d <= bd){ bd = d; best = q; } }
      return best && bd > 1e-6 ? best : null;
    });
    const N = S.length, on = nq.map(Boolean);
    if (!on.some(Boolean) || on.every(Boolean)) continue;     // 没有窄缝；整圈都贴着（环＝本来就封闭）
    for (let k = 0; k < N; k++){
      if (!on[k]) continue;
      if (!on[(k - 1 + N) % N]) out.push([S[k].slice(), nq[k]]);          // 一段窄缝的开头（只有一点＝开头结尾同一条）
      else if (!on[(k + 1) % N]) out.push([S[k].slice(), nq[k]]);         // 结尾
    }
  }
  return out;
}
/* sorted_roots：选中的物件按文件顺序（后→前）；我们的 roots 就是图层最上层的物件，R3.roots 已按阵列顺序 */
function sortedRoots(L, ids){ return R3().roots(L, ids); }
/* sample_polyline（builder.rs:162-177）：沿折线每 step 取一点（顶点一定取） */
function samplePolyline(pts, step){
  const out = []; step = Math.max(step, 1e-3);
  pts.forEach((p, i) => {
    if (i > 0){ const a = pts[i - 1], n = Math.min(Math.ceil(dist(a, p) / step), 4000); for (let k = 1; k < n; k++) out.push([a[0] + (p[0] - a[0]) * k / n, a[1] + (p[1] - a[1]) * k / n]); }
    out.push(p);
  });
  return out;
}

/* ── 平面分割的面（po::regions；照 regions_one_mask_at_a_time）── */
const maskKey = m => m.map(b => b ? 1 : 0).join('');
function regions(shapes, opt){
  if (!shapes.length) return [];
  const holes = !!(opt && opt.holes);
  const bridges = (opt && opt.gap > 0) ? gapBridges(shapes, opt.gap) : [];
  const pl = R3().livePaint.planar(shapes.map(s => ({polys:s.polys})).concat(bridges.map(b => ({polys:[b]}))));
  if (!pl) return [];
  // ① 每种 mask：平面图的每个面挑一个「不在更小的面里」的内点（更小的面＝套在里面的别的分量），看被哪些来源盖住
  const cyc = pl.faces.map(F => ({F, s:polyArea(F), b:bboxOf([F])})).map(c => Object.assign(c, {a:Math.abs(c.s)})).filter(c => c.a > 1e-9);
  // 外圈（每个连通分量的外框环）跟里面的面方向相反；最大的那个一定是外圈（livePaint.build 同一招）
  const outerSign = cyc.reduce((m, c) => c.a > m.a ? c : m, {a:0, s:1}).s > 0 ? 1 : -1;
  const masks = new Map(), gaps = [];
  for (const c of cyc){
    for (const m of interiorPoints([c.F], 'evenodd')){
      if (cyc.some(g => g !== c && g.a < c.a - 1e-9 && inBox(g.b, m, 0) && inside([g.F], 'evenodd', m))) continue;
      const mask = shapes.map(s => inside(s.polys, s.rule, m));
      if (mask.some(Boolean)){
        const k = maskKey(mask), had = masks.get(k);
        if (had) had.bb = {x0:Math.min(had.bb.x0, c.b.x0), y0:Math.min(had.bb.y0, c.b.y0), x1:Math.max(had.bb.x1, c.b.x1), y1:Math.max(had.bb.y1, c.b.y1)};
        else masks.set(k, {mask, bb:Object.assign({}, c.b)});
      } else if (holes && Math.sign(c.s) !== outerSign) gaps.push(c);      // 被路径围起来、没有来源盖住的空隙（AI 形状生成器也能点它上色）
      break;
    }
  }
  // ② 每种 mask 的边界环 → 按套叠深度分组成一个个区域（外圈＋洞）
  //    加速（例：32 个圆整组一起算要 18 秒 → 只算局部）：这种 mask 的面都在 bb 里；外框碰不到 bb（放宽一点）的来源在 bb 里覆盖数都是 0，
  //    ⇒ 只拿碰得到的来源、再加一个 bb 方框当「必须在里面」，求出来的环跟整组一起算一样（区域严格在放宽的方框里，方框边不会出现在环上）
  const sets = shapes.map(s => ({polys:s.polys, rule:s.rule, b:bboxOf(s.polys)}));
  const out = [];
  const local = (bb, mask) => {
    const e = 1 + 1e-3 * Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0), B = {x0:bb.x0 - e, y0:bb.y0 - e, x1:bb.x1 + e, y1:bb.y1 + e};
    const idx = sets.map((s, i) => i).filter(i => mask[i] || (sets[i].b && sets[i].b.x0 <= B.x1 && sets[i].b.x1 >= B.x0 && sets[i].b.y0 <= B.y1 && sets[i].b.y1 >= B.y0));
    const sub = idx.map(i => ({polys:sets[i].polys, rule:sets[i].rule})).concat([{polys:[[[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]]], rule:'nonzero'}]);
    const k = idx.map(i => mask[i] ? 1 : 0).join('') + '1';
    return O().arrangement(sub, m => maskKey(m) === k);
  };
  const group = (polys, sources, keep) => {
    const loops = polys.map(P => ({P, a:Math.abs(polyArea(P)), b:bboxOf([P])}));
    loops.sort((x, y) => y.a - x.a);
    for (const l of loops){
      const rep = interiorPoints([l.P], 'evenodd')[0] || l.P[0];
      let parent = null;
      for (const q of loops){ if (q === l || q.a <= l.a || !q.done) continue; if (inBox(q.b, rep, 0) && inside([q.P], 'evenodd', rep) && (!parent || q.a < parent.a)) parent = q; }
      l.depth = parent ? parent.depth + 1 : 0; l.done = true;
      if (l.depth % 2 === 0){ l.region = {loops:[l.P], sources:sources.slice()}; if (!keep || keep(rep)) out.push(l.region); }
      else { l.region = parent.region; l.region.loops.push(l.P); }
    }
  };
  for (const {mask, bb} of masks.values()) group(local(bb, mask), mask.map((b, i) => b ? i : -1).filter(i => i >= 0));
  // 空隙：方框里「谁都没盖住」的环，只留代表点落在这个面里的那块（外头那圈不要）；面里另有孤岛就成洞
  const none = shapes.map(() => false);
  if (bridges.length){
    // 有间隙桥：桥不在来源里、arrangement 看不到 ⇒ 空区直接用平面图的面（外圈）＋套在里面、方向跟外圈一样的面当洞
    for (const g of gaps){
      const r = {loops:[g.F], sources:[]};
      for (const c of cyc) if (c !== g && Math.sign(c.s) === outerSign && c.a < g.a && inBox(g.b, c.F[0], 0) && inside([g.F], 'evenodd', c.F[0]) && !c.F.some(q => g.F.includes(q))) r.loops.push(c.F);
      out.push(r);
    }
  } else for (const g of gaps) group(local(g.b, none), [], rep => inside([g.F], 'evenodd', rep));
  out.forEach(r => { r.bb = bboxOf(r.loops); r.area = r.loops.reduce((s, P, i) => s + (i ? -1 : 1) * Math.abs(polyArea(P)), 0); });
  return splitByCutters(out, shapes);
}
const top = r => r.sources.length ? r.sources[r.sources.length - 1] : null;                 // Region::top
/* RegionCache::at：外框内、而且在面里 */
const regionAt = (regs, p) => regs.findIndex(r => inBox(r.bb, p, 1e-6) && inside(r.loops, 'evenodd', p));

/* RegionCache（builder.rs:241-273）：按「选取那层＋选中的物件内容」快取 */
function makeCache(opt){
  return {
    key:null, regs:[], L:null,
    get(){
      const L = VecSel.layer();
      if (!L || L.kind !== 'vector' || !window.AiR3 || !window.AIObj){ this.key = null; this.regs = []; this.L = null; return this.regs; }
      const roots = sortedRoots(L), o = typeof opt === 'function' ? opt() : opt;     // opt 可以是函数（形状生成器：跟着工具选项变）
      const key = L.id + '|' + JSON.stringify(roots) + '|' + JSON.stringify(o || null);
      if (key !== this.key){ this.key = key; this.L = L; this.shapes = roots.length ? shapesFor(roots, typeof opt === 'function' ? o : undefined) : []; this.regs = this.shapes.length ? regions(this.shapes, o) : []; this.pieces = null; }
      return this.regs;
    },
    /* p：文件坐标 → 区域索引（-1＝没有） */
    at(p){ const regs = this.get(); if (!this.L) return -1; return regionAt(regs, [p[0] - this.L.x, p[1] - this.L.y]); },
    /* p：文件坐标 → 离游标 tol 以内的分割线段索引（-1＝没有；AI：Alt 停在线上＝那一段亮红） */
    edgeAt(p, tol){
      this.get(); if (!this.L || !this.shapes) return -1;
      if (!this.pieces) this.pieces = this.shapes.some(s => s.cutter) ? cutterPieces(this.shapes) : [];
      const q = [p[0] - this.L.x, p[1] - this.L.y]; let best = -1, bd = tol;
      this.pieces.forEach((pc, k) => { const d = distToPolyline(q, pc.pts); if (d <= bd){ bd = d; best = k; } });
      return best;
    },
    reset(){ this.key = null; }
  };
}

/* hatch（builder.rs:179-239）：把区域转 −45° 让斜线变水平扫描线，每隔 gap 一条、取交点两两成对，再转回来 */
function hatch(loops, gap){
  const out = [], s = Math.SQRT1_2;
  const rot = p => [(p[0] + p[1]) * s, (p[1] - p[0]) * s], unrot = p => [(p[0] - p[1]) * s, (p[0] + p[1]) * s];
  const edges = [];
  for (const P of loops) for (let i = 0; i < P.length; i++) edges.push([rot(P[i]), rot(P[(i + 1) % P.length])]);
  if (!edges.length) return out;
  let y0 = Infinity, y1 = -Infinity;
  for (const [a, c] of edges){ y0 = Math.min(y0, a[1], c[1]); y1 = Math.max(y1, a[1], c[1]); }
  gap = Math.max(gap, (y1 - y0) / 400, 1e-6);
  for (let y = Math.floor(y0 / gap) * gap + gap * 0.5; y < y1; y += gap){
    const xs = [];
    for (const [a, c] of edges) if ((a[1] <= y) !== (c[1] <= y)) xs.push(a[0] + (y - a[1]) / (c[1] - a[1]) * (c[0] - a[0]));
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([unrot([xs[i], y]), unrot([xs[i + 1], y])]);
  }
  return out;
}

/* shape_node（pathops.rs:262-281）：一个环＝路径、多个＝复合路径（nonzero）；Style::of(src)＝外观＋不透明度＋混合模式（我们：几何、结构以外的栏位全抄） */
const NOT_STYLE = ['id', 'type', 'x', 'y', 'w', 'h', 'radius', 'cx', 'cy', 'rx', 'ry', 'r1', 'r2', 'points', 'rotation', 'anchors', 'closed', 'children', 'rule',
  'name', 'live', 'r3helper', 'visible', 'locked', 'guide', 'clipping', 'mesh', 'clip'];
function shapeNode(loops, src){
  const subs = loops.map(P => O().tidyLoop(P)).filter(Boolean);
  if (!subs.length) return null;
  const R = R3(), st = {};
  if (src) Object.keys(src).forEach(k => { if (!NOT_STYLE.includes(k)) st[k] = R.clone(src[k]); });
  else Object.assign(st, {fill:'none', stroke:'none', strokeWidth:0});
  if (subs.length === 1) return Object.assign({id:R.newId(), type:'bezier', anchors:subs[0].anchors, closed:true}, st);
  return Object.assign({id:R.newId(), type:'compound', rule:'nonzero', children:subs.map(v => ({id:R.newId(), type:'bezier', anchors:v.anchors, closed:true, fill:'none', stroke:'none', strokeWidth:0}))}, st);
}
/* replace_roots（buildcmds.rs:327-344）：拿掉全部 roots，新的一串插在最前面那个 root 原本的位置（扣掉它前面被拿掉的） */
function replaceRoots(L, roots, nodes){
  const S = L.data.shapes, topR = roots[roots.length - 1], idx = S.indexOf(topR);
  const before = roots.filter(r => r !== topR && S.indexOf(r) >= 0 && S.indexOf(r) < idx).length;
  L.data.shapes = S.filter(s => !roots.includes(s));
  L.data.shapes.splice(idx - before, 0, ...nodes);
  return nodes.map(n => n.id);
}
/* fill_param（buildcmds.rs:256-264）："#rrggbb" | "none" | {color} | {none:true} | {gradient}／渐变物件 */
function fillParam(v, C){
  if (v === undefined || v === null) return {v:undefined};
  if (typeof v === 'string'){ if (v === 'none' || /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v)) return {v}; return {err:`${C}: bad fill ${v}`}; }
  if (typeof v === 'object'){
    if (v.none) return {v:'none'};
    if (typeof v.color === 'string') return fillParam(v.color, C);
    if (v.gradient && typeof v.gradient === 'object') return {v:R3().clone(v.gradient)};
    if (v.type === 'linear' || v.type === 'radial') return {v:R3().clone(v)};
  }
  return {err:`${C}: bad fill ${JSON.stringify(v)}`};
}
const finitePt = q => Array.isArray(q) && q.length >= 2 && isFinite(+q[0]) && isFinite(+q[1]) && Math.abs(+q[0]) <= 1e7 && Math.abs(+q[1]) <= 1e7;

/* ── 命令 ── */
/* 区域选项：参数没给就照工具选项（间隙检测、开放填色路径当闭合） */
function gapPx(len, custom){ return typeof len === 'number' ? len : len === 'custom' ? +custom : (GAP_LEN[len] || GAP_LEN.small); }
function sbOpt(p){
  const S = window.ShapeBuilderTool || {}, det = p.gapDetect !== undefined ? !!p.gapDetect : !!S.gapDetect;
  const len = p.gapLength !== undefined ? (isFinite(+p.gapLength) && typeof p.gapLength !== 'string' ? +p.gapLength : p.gapLength) : S.gapLength;
  return {holes:p.gaps !== false, gap:det ? Math.max(0, gapPx(len, S.gapCustom) || 0) : 0, openAsClosed:p.openAsClosed !== undefined ? !!p.openAsClosed : S.openAsClosed !== false};
}
function needMenus(C){ return (!window.AiR3 || !window.AIObj || !AiR3.livePaint) ? {ok:false, error:C + ': menus/impl/ai-object.js 没载入'} : null; }
function targetRoots(p, C){
  const R = R3(), L = R.vLayer(p); if (!L) return {err:{ok:false, error:C + ': not a vector layer'}};
  const ids = Array.isArray(p.ids) ? p.ids : (p.id !== undefined ? [p.id] : null);
  if (ids){ const bad = ids.find(id => !R.findDeep(id, L)); if (bad !== undefined) return {err:{ok:false, error:`${C}: no such object ${bad}`}}; }
  const roots = sortedRoots(L, ids);
  if (!roots.length) return {err:{ok:false, error:'nothing selected'}};
  return {L, roots};
}
CMD.reg('shapebuilder.merge', {i18n:'', undoable:true,
  params:'{points:[[x,y]…] 文件坐标（拖曳轨迹；一个点＝点一下）, erase?:false（true＝Alt 拖：碰到的区域删掉）, fill?:"#rrggbb"|"none"|{color}|{none:true}|渐变物件（缺省＝第一个碰到的区域最上面那个物件的外观）, ids?:[id…]（缺省＝选中的物件）, layerId?, gaps?:true（被路径围起来、没被盖住的空隙也算区域，AI 行为；false＝照原码只算有来源的）, gapDetect?, gapLength?:"small"|"medium"|"large"|数字 px, openAsClosed?（这三个缺省＝工具选项，见 shapebuilder.options）} '
    + '形状生成器（buildcmds.rs:266-325 shapeBuilder.merge）：选中物件的平面分割里，轨迹（每 max(外框长边/2000, 0.25) 取样）碰到的区域合成一个新形状、'
    + '被碰到的物件各自减掉这块（剩下的留原外观）、没碰到的原样留着（换新 id）；一个区域都没碰到＝报错不留历史。全部新形状取代原物件、插在最前面那个原物件的位置、全部选中。'
    + 'AI 2020 补：没填色的开放路径（直线段）是分割线——把穿过的区域切开；动过之后在交点断成一段段，合并后的内部边、删掉区域里悬空的段、跟形状轮廓重叠的段会拿掉，圆外的线头留着；'
    + 'erase 时轨迹离某段 ≤ tol?（缺省 3 屏幕像素）＝删掉那段（只点一下而且点在线上＝只删线不删区域） → {ok, ids, merged, regions, edges}'}, p => {
  const C = 'shapebuilder.merge', miss = needMenus(C); if (miss) return miss;
  if (!Array.isArray(p.points) || !p.points.length || !p.points.every(finitePt)) return {ok:false, error:C + ': points must be a non-empty list of finite [x,y]'};
  const erase = !!p.erase, f = fillParam(p.fill, C); if (f.err) return {ok:false, error:f.err};
  const t = targetRoots(p, C); if (t.err) return t.err;
  const {L, roots} = t, R = R3();
  const o = sbOpt(p), shapes = shapesFor(roots, o);
  if (!shapes.length) return {ok:false, error:'Shape Builder: select paths or compound paths'};
  const regs = regions(shapes, o);
  const bb = R.geoBounds(roots), step = Math.max((bb ? Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) : 100) / 2000, 0.25);
  const pts = p.points.map(q => [+q[0] - L.x, +q[1] - L.y]);
  const samples = samplePolyline(pts, step);
  let touched = [];
  for (const q of samples){ const i = regionAt(regs, q); if (i >= 0 && !touched.includes(i)) touched.push(i); }
  // AI 2020：分割线断成一段段；Alt 点／拖过某一段（游标离线 tol 以内）＝删掉那段（例：Alt 拖过圆外多出来的线头）；
  //   单纯点一下而且点在线上 ⇒ 只删那段线、不删底下的区域（AI 游标停在边上时只亮那条边）
  const pieces = shapes.some(s => s.cutter) ? cutterPieces(shapes) : [];
  const tol = typeof p.tol === 'number' && p.tol >= 0 ? p.tol : (window.VecSel ? VecSel.tol(3) : 3);
  const hitE = new Set();
  if (erase && pieces.length) pieces.forEach((pc, k) => { if (samples.some(q => distToPolyline(q, pc.pts) <= tol)) hitE.add(k); });
  let dragLen = 0; for (let i = 1; i < pts.length; i++) dragLen += dist(pts[i - 1], pts[i]);
  if (hitE.size && dragLen <= tol) touched = [];
  if (!touched.length && !hitE.size) return {ok:false, error:'Shape Builder: no region under the pointer'};
  if (erase && !hitE.size && touched.every(i => !regs[i].sources.length)) return {ok:false, error:'Shape Builder: nothing to delete'};
  absorbSlivers(regs, touched);
  const picked = touched.map(i => regs[i]);
  const union = picked.length ? O().arrangement(picked.map(r => ({polys:r.loops, rule:'evenodd'})), m => m.some(Boolean)) : [];          // merge_regions
  const affected = shapes.map((_, i) => picked.some(r => r.sources.includes(i)));
  const firstSrc = touched.find(i => regs[i].sources.length), styleSrc = firstSrc === undefined ? null : top(regs[firstSrc]);   // 第一块是空隙（没来源）⇒ 往后找有来源的那块
  const per = shapes.map(() => []); let merged = null, tail = null;
  shapes.forEach((sh, i) => {
    if (sh.cutter && pieces.length) return;                // 分割线：等闭合的都算好再决定每段去留（下面）
    if (!affected[i]) per[i].push(R.reid(sh.leaf));
    else {
      const rest = O().arrangement([{polys:sh.polys, rule:sh.rule}, {polys:union, rule:'evenodd'}], m => m[0] && !m[1])   // po::boolean Difference
        .filter(P => !isSliverLoop(P));                    // 拟合误差留下的极细碎环（厚度 < 0.2 px）不留（AI 几何精确、不会有）
      const n = rest.length ? shapeNode(rest, sh.leaf) : null; if (n) per[i].push(n);
    }
    if (!erase && i === styleSrc && union.length){
      const m = shapeNode(union, sh.leaf);
      if (m){ if (f.v !== undefined) m.fill = f.v; merged = m.id; per[i].push(m); }
    }
  });
  if (!erase && styleSrc === null && union.length){       // 只碰到空隙：新形状＝目前的填色／描边（AI），放最上面
    const m = shapeNode(union, null);
    if (m){ m.fill = f.v !== undefined ? f.v : (window.UI ? UI.fill() : 'none'); if (window.UI && UI.strokeW() > 0){ m.stroke = UI.stroke(); m.strokeWidth = UI.strokeW(); } merged = m.id; tail = m; }
  }
  if (pieces.length){
    // 每段去留（AI：合并／删除之后不留重复的边、不留悬空在删掉区域里的线；圆外的线头没被碰到就留着）：
    //   被 Alt 点／拖到 ⇒ 删；两侧都在这次动到的区域里（合并后的内部边）⇒ 删；
    //   两侧被「剩下的闭合形状」盖住的情形一样 ⇒ 还在切区域、留；不一样 ⇒ 边已经由形状自己的轮廓画了、删；
    //   两侧都没被盖住 ⇒ 这次动到的区域旁边（删掉区域里悬空）删、否则（本来就在外头的线头）留
    const closed = [];
    per.forEach(list => list.forEach(n => { const ps = R.subviews(n).map(v => O().flatten(v)).filter(P => P.length >= 3); if (ps.length) closed.push({polys:ps, rule:n.type === 'compound' && n.rule === 'evenodd' ? 'evenodd' : 'nonzero', b:bboxOf(ps)}); }));
    if (tail){ const ps = R.subviews(tail).map(v => O().flatten(v)); closed.push({polys:ps, rule:'nonzero', b:bboxOf(ps)}); }
    const maskAt = q => closed.map(c => inBox(c.b, q, 0) && inside(c.polys, c.rule, q) ? 1 : 0).join('');
    const inU = q => union.length > 0 && inside(union, 'nonzero', q);
    const before = shapes.filter(s => !s.cutter).map(s => ({polys:s.polys, rule:s.rule, b:bboxOf(s.polys)}));
    const coveredBefore = q => before.some(c => inBox(c.b, q, 0) && inside(c.polys, c.rule, q));
    const nodeOf = (pc, src) => { const st = {}; Object.keys(src).forEach(k => { if (!NOT_STYLE.includes(k)) st[k] = R.clone(src[k]); }); return Object.assign({id:R.newId(), type:pc.pts.length === 2 ? 'line' : 'path', points:pc.pts.map(q => q.slice()), closed:false}, st); };
    shapes.forEach((sh, i) => {
      if (!sh.cutter) return;
      const my = pieces.map((pc, k) => [pc, k]).filter(([pc]) => pc.si === i);
      const keep = my.filter(([pc, k]) => {
        if (hitE.has(k)) return false;
        const [a, b] = pieceSides(pc.pts, 0.2), ua = inU(a), ub = inU(b);
        if (ua && ub) return false;
        if (!coveredBefore(a) && !coveredBefore(b)) return true;    // 本来两边都没被闭合形状盖住（线自己围出空隙、或圆外的线头）⇒ 留着（点空隙上色时四条线原样）
        const ma = maskAt(a), mb = maskAt(b);
        if (!ma.includes('1') && !mb.includes('1')) return !(ua || ub);
        return ma === mb;
      });
      if (keep.length === my.length && my.length === sh.cuts.length) per[i].push(R.reid(sh.leaf));     // 没被切开也没删＝原样
      else keep.forEach(([pc]) => per[i].push(nodeOf(pc, sh.leaf)));
    });
  }
  const nodes = [].concat(...per); if (tail) nodes.push(tail);
  const ids = replaceRoots(L, roots, nodes);
  VecSel.setShapes(L.id, ids); if (window.AiSel) AiSel.text = [];
  Layer.invalidate(L);
  return {ok:true, ids, merged, regions:touched.length, edges:hitE.size, layerId:L.id};
});
CMD.reg('shapebuilder.regions', {i18n:'',
  params:'{ids?, layerId?} 形状生成器的区域（buildcmds.rs:346-363 shapeBuilder.regions）：选中物件平面分割的每一块 → {ok, regions:[{bounds:[x0,y0,x1,y1] 文件坐标, area, sources:[id…]}]}'}, p => {
  const C = 'shapebuilder.regions', miss = needMenus(C); if (miss) return miss;
  const t = targetRoots(p || {}, C); if (t.err) return t.err;
  const o = sbOpt(p || {}), shapes = shapesFor(t.roots, o), L = t.L;
  return {ok:true, regions:regions(shapes, o).map(r => ({bounds:[r.bb.x0 + L.x, r.bb.y0 + L.y, r.bb.x1 + L.x, r.bb.y1 + L.y], area:r.area, sources:r.sources.map(i => shapes[i].leaf.id)}))};
});

/* ── AI 2020 形状生成器选项「在合并模式中单击描边分割路径」──
   合并模式下单击（不是拖）落在某条路径的描边上 ⇒ 点到的那一段边（两个交点之间：跟别的选中物件轮廓的交点，没有就到端点）切成独立的一条路径：
   闭合路径＝在两个交点处切成两条开放路径（只有一个交点＝从那里打开）；开放路径＝切成最多三段。外观照原路径，插在原路径正上方 */
function strokeHitAt(roots, p, tol){
  const lv = []; roots.forEach(r => leafShapes(r, lv));
  for (let i = lv.length - 1; i >= 0; i--){
    const s = lv[i]; if (!R3().isLeaf(s) || s.locked) continue;                // 复合路径不切
    const v = VecSel.asBezier(s); if (!v || !v.anchors || v.anchors.length < 2) continue;
    const w = (s.stroke && s.stroke !== 'none' && s.strokeWidth > 0) ? s.strokeWidth / 2 : 0;
    let best = null, bd = tol + w;
    VecSel.segments(v).forEach((c, si) => { for (let k = 0; k <= 64; k++){ const d = dist(VecSel.evalCubic(c, k / 64), p); if (d <= bd){ bd = d; best = {seg:si, t:k / 64, c}; } } });
    if (!best) continue;
    let lo = Math.max(0, best.t - 1 / 64), hi = Math.min(1, best.t + 1 / 64);      // 细找最近点
    for (let it = 0; it < 30; it++){ const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (dist(VecSel.evalCubic(best.c, m1), p) < dist(VecSel.evalCubic(best.c, m2), p)) hi = m2; else lo = m1; }
    return {s, lv, u:best.seg + (lo + hi) / 2};
  }
  return null;
}
/* 路径 v 跟别的轮廓的交点（参数 u＝段号＋段内 t） */
function strokeCuts(v, others){
  const N = 48, out = [], segs = VecSel.segments(v);
  const lines = []; others.forEach(o => { const n = o.P.length; for (let i = 0; i < (o.closed ? n : n - 1); i++) lines.push([o.P[i], o.P[(i + 1) % n]]); });
  segs.forEach((c, si) => {
    let prev = VecSel.evalCubic(c, 0);
    for (let k = 1; k <= N; k++){
      const q = VecSel.evalCubic(c, k / N), r = sub(q, prev);
      for (const [a, b] of lines){
        if (Math.max(a[0], b[0]) < Math.min(prev[0], q[0]) - 1e-9 || Math.min(a[0], b[0]) > Math.max(prev[0], q[0]) + 1e-9 || Math.max(a[1], b[1]) < Math.min(prev[1], q[1]) - 1e-9 || Math.min(a[1], b[1]) > Math.max(prev[1], q[1]) + 1e-9) continue;
        const sv = sub(b, a), den = r[0] * sv[1] - r[1] * sv[0]; if (Math.abs(den) < 1e-12) continue;
        const t = ((a[0] - prev[0]) * sv[1] - (a[1] - prev[1]) * sv[0]) / den, u = ((a[0] - prev[0]) * r[1] - (a[1] - prev[1]) * r[0]) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(si + (k - 1 + t) / N);
      }
      prev = q;
    }
  });
  out.sort((x, y) => x - y);
  return out.filter((x, i) => i === 0 || x - out[i - 1] > 1e-6);
}
function splitStroke(L, roots, p, tol){
  const hit = strokeHitAt(roots, p, tol); if (!hit) return {ok:false, error:'Shape Builder: no stroke under the pointer'};
  const s = hit.s, R = R3();
  VecSel.ensureBezier(L, s);
  const closed = !!s.closed, nSeg = VecSel.segCount(s);
  const others = [];
  hit.lv.forEach(l => { if (l !== s) R.subviews(l).forEach(v => { const P = O().flatten(v); if (P.length >= 2) others.push({P, closed:!!v.closed}); }); });
  const cuts = strokeCuts({anchors:s.anchors, closed}, others).filter(u => !closed ? (u > 1e-6 && u < nSeg - 1e-6) : true);
  const u0 = hit.u;
  let a = null, b = null;
  for (const u of cuts){ if (u < u0) a = u; else if (b === null && u > u0) b = u; }
  if (closed){ if (!cuts.length) return {ok:false, error:'Shape Builder: this stroke has no intersections to split at'}; if (a === null) a = cuts[cuts.length - 1]; if (b === null) b = cuts[0]; }
  else if (a === null && b === null) return {ok:false, error:'Shape Builder: this stroke has no intersections to split at'};
  // 在交点插锚点（由后往前插，前面的索引不变；同一段里第二刀换算成剩下那截的 t）
  const A = s.anchors.map(x => Scissors.clone(x)), marks = {};
  let coverSeg = -1, cover = 1;
  [...new Set([a, b].filter(x => x !== null))].sort((x, y) => y - x).forEach(u => {
    let seg = Math.floor(u), t = u - seg; if (seg >= nSeg){ seg = nSeg - 1; t = 1; }
    const tl = seg === coverSeg ? t / cover : t;
    let obj;
    if (tl <= 1e-6) obj = A[seg % A.length];
    else if (tl >= 1 - 1e-6) obj = A[(seg + 1) % A.length];
    else obj = A[Scissors.insertAnchor(A, closed, seg, tl)];
    coverSeg = seg; cover = t; marks[u] = obj;
  });
  const cl = x => Scissors.clone(x), ends = P => { P[0] = Object.assign(cl(P[0]), {in:null, kind:'corner'}); P[P.length - 1] = Object.assign(cl(P[P.length - 1]), {out:null, kind:'corner'}); return P; };
  let pieces, clickedIdx;
  if (closed){
    const ia = A.indexOf(marks[a]), Rr = A.slice(ia).concat(A.slice(0, ia)).map(cl), ib = (A.indexOf(marks[b]) - ia + A.length) % A.length;
    if (a === b || ib === 0) pieces = [Rr.concat([cl(Rr[0])])];
    else pieces = [Rr.slice(0, ib + 1), Rr.slice(ib).concat([cl(Rr[0])])];
    clickedIdx = 0;
  } else {
    const ia = a === null ? 0 : A.indexOf(marks[a]), ib = b === null ? A.length - 1 : A.indexOf(marks[b]);
    pieces = [];
    if (ia > 0) pieces.push(A.slice(0, ia + 1).map(cl));
    clickedIdx = pieces.length; pieces.push(A.slice(ia, ib + 1).map(cl));
    if (ib < A.length - 1) pieces.push(A.slice(ib).map(cl));
  }
  pieces = pieces.filter(P => P.length >= 2).map(ends);
  const h = window.XformKit ? XformKit.findDeep(L, s.id) : null; if (!h) return {ok:false, error:'Shape Builder: path vanished'};
  const props = JSON.parse(JSON.stringify(s)); delete props.id;
  s.anchors = pieces[0]; s.closed = false;
  const made = pieces.slice(1).map(P => Object.assign(JSON.parse(JSON.stringify(props)), {id:R.newId(), type:'bezier', anchors:P, closed:false}));
  h.arr.splice(h.idx + 1, 0, ...made);
  const ids = [s.id].concat(made.map(m => m.id));
  const top = h.arr === L.data.shapes;
  const sel = roots.map(r => r.id).concat(top ? made.map(m => m.id) : []);
  VecSel.setShapes(L.id, sel); if (window.AiSel) AiSel.text = [];
  Layer.invalidate(L);
  return {ok:true, ids, clicked:ids[clickedIdx] || ids[0], cuts:[a, b].filter(x => x !== null).length, layerId:L.id};
}
CMD.reg('shapebuilder.splitStroke', {i18n:'', undoable:true,
  params:'{x, y（文件坐标）, ids?, layerId?, tol?（缺省 3 屏幕像素）} 形状生成器「在合并模式中单击描边分割路径」：点到的那段描边（两个交点之间：跟别的选中物件轮廓的交点）切成独立路径——'
    + '闭合路径在两个交点处切成两条开放路径（一个交点＝从那里打开）、开放路径切成最多三段；外观照原路径、新段插在原路径正上方 → {ok, ids:[原路径…新路径], clicked:点到那段的 id, cuts}'}, p => {
  const C = 'shapebuilder.splitStroke', miss = needMenus(C); if (miss) return miss;
  if (!window.Scissors) return {ok:false, error:C + ': tools/scissors.js 没载入'};
  if (!finitePt([p.x, p.y])) return {ok:false, error:C + ': x, y are required numbers'};
  const t = targetRoots(p, C); if (t.err) return t.err;
  const L = t.L, tol = typeof p.tol === 'number' ? p.tol : VecSel.tol(3);
  return splitStroke(L, t.roots, [+p.x - L.x, +p.y - L.y], tol);
});

/* 叠画小帮手：图层坐标的环／线 → 画布 */
function pathLoops(ctx, L, loops, s, close){
  ctx.beginPath();
  for (const P of loops){ P.forEach((q, i) => { const x = (q[0] + L.x) * s, y = (q[1] + L.y) * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (close !== false) ctx.closePath(); }
}

window.BuildKit = {HATCH, HIGHLIGHT_RED, isLP, inside, interiorPoints, leafShapes, nodeOutline, shapesFor, sortedRoots, samplePolyline, regions, regionAt, top, makeCache, hatch, shapeNode, pathLoops, cutterPieces};

/* ── 工具（builder.rs:275-384 ShapeBuilderTool）── */
/* pickFrom：形状生成器工具选项「拾色来源」（AI：双击工具开的对话框；缺省＝色板 ⇒ 合并出来的形状填「目前的填色」，
   例：色板点橙色 → 拖过几个圆 ⇒ 合成一块橙色；VectorCraft 原码没有这个选项、一律照原物件外观＝「图稿」） */
/* AI 2020「形状生成器工具选项」对话框（双击工具图示）：间隙检测（间隙长度 小／中／大／自定）、将开放的填色路径视为闭合、
   在合并模式中单击描边分割路径、拾色来源（色板／图稿）＋光标色板预览、突出显示（填充、可编辑时突出显示描边、颜色） */
const HL_COLORS = {lightRed:'#ff5f5f', red:'#ff0000', orange:'#ff9900', yellow:'#ffe100', green:'#3ac83a', lightBlue:'#4faaff', blue:'#0033ff', magenta:'#ff3dfc', black:'#000000'};
const SB_DEF = {gapDetect:false, gapLength:'small', gapCustom:3, openAsClosed:true, clickStrokeSplits:false, pickFrom:'swatches', cursorSwatch:false,
  highlightFill:true, highlightStroke:true, highlightColor:'lightRed'};
const SB = Object.assign({hover:-1, hoverEdge:-1, points:[], touched:[], touchedEdges:[], dragging:false, alt:false, pt:null}, SB_DEF);
SB.cache = makeCache(() => sbOpt({}));
SB.defaults = SB_DEF;
const SB_KEYS = Object.keys(SB_DEF);
CMD.reg('shapebuilder.options', {i18n:'', params:'{pickFrom?:"swatches"|"artwork", gapDetect?:bool（间隙检测，缺省关）, gapLength?:"small"(3)|"medium"(6)|"large"(12)|"custom", gapCustom?:px（自定间隙长度）, openAsClosed?:bool（将开放的填色路径视为闭合，缺省开；没填色的开放路径一律只当分隔线）, clickStrokeSplits?:bool（在合并模式中单击描边分割路径：开着时单击描边＝shapebuilder.splitStroke）, cursorSwatch?:bool（光标色板预览）, highlightFill?:bool（悬停区域网纹，缺省开）, highlightStroke?:bool（突出显示描边，缺省开）, highlightColor?:"lightRed"|"red"|"orange"|"yellow"|"green"|"lightBlue"|"blue"|"magenta"|"black"|"#rrggbb", reset?:bool} 形状生成器工具选项（AI 2020 双击工具图示的对话框）；拾色来源＝色板（缺省：合并的形状填目前的填色）／图稿（照第一个碰到的区域最上面那个物件的外观）；不给＝只读 → {ok, …全部选项}'}, p => {
  p = p || {};
  const C = 'shapebuilder.options', bad = m => ({ok:false, error:C + ': ' + m});
  if (p.reset) Object.assign(SB, SB_DEF);
  if (p.pickFrom !== undefined && !['swatches', 'artwork'].includes(p.pickFrom)) return bad('pickFrom must be swatches|artwork');
  if (p.gapLength !== undefined && !['small', 'medium', 'large', 'custom'].includes(p.gapLength)) return bad('gapLength must be small|medium|large|custom');
  if (p.gapCustom !== undefined && !(isFinite(+p.gapCustom) && +p.gapCustom > 0 && +p.gapCustom <= 1000)) return bad('gapCustom must be a number in (0, 1000]');
  if (p.highlightColor !== undefined && !HL_COLORS[p.highlightColor] && !/^#[0-9a-f]{6}$/i.test(p.highlightColor)) return bad('bad highlightColor');
  ['gapDetect', 'openAsClosed', 'clickStrokeSplits', 'cursorSwatch', 'highlightFill', 'highlightStroke'].forEach(k => { if (p[k] !== undefined) SB[k] = !!p[k]; });
  ['pickFrom', 'gapLength', 'highlightColor'].forEach(k => { if (p[k] !== undefined) SB[k] = p[k]; });
  if (p.gapCustom !== undefined) SB.gapCustom = +p.gapCustom;
  if (p.gapCustom !== undefined && p.gapLength === undefined) SB.gapLength = 'custom';
  SB.cache.reset();
  if (window.UI && UI.ctx) UI.draw();
  const out = {ok:true}; SB_KEYS.forEach(k => out[k] = SB[k]); out.gapPx = gapPx(SB.gapLength, SB.gapCustom);
  return out;
});
const hlColor = () => HL_COLORS[SB.highlightColor] || SB.highlightColor || HL_COLORS.lightRed;

/* 选项对话框 */
const L3 = (a, b, c) => (typeof Lang !== 'undefined' && Lang.cur === 'zh-Hant') ? a : (typeof Lang !== 'undefined' && Lang.cur === 'en') ? c : b;
function openOptionsDialog(){
  const old = document.getElementById('sbOptDlg'); if (old) old.remove();
  const mk = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt !== undefined) e.textContent = txt; return e; };
  const bg = mk('div', 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25)'); bg.id = 'sbOptDlg';
  const box = mk('div', 'background:var(--bg2,#262626);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:6px;padding:14px 16px;min-width:360px;font:13px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)');
  box.appendChild(mk('div', 'font-weight:bold;margin-bottom:10px', L3('形狀建立程式工具選項', '形状生成器工具选项', 'Shape Builder Tool Options')));
  const v = {}; SB_KEYS.forEach(k => v[k] = SB[k]);
  const sec = t => { const f = mk('fieldset', 'border:1px solid var(--line,#3a3a3a);border-radius:4px;margin:6px 0;padding:6px 10px'); f.appendChild(mk('legend', 'padding:0 4px;color:var(--fg2,#9a9a9a)', t)); box.appendChild(f); return f; };
  const row = (par, css) => { const r = mk('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;' + (css || '')); par.appendChild(r); return r; };
  const chk = (par, k, label, css) => { const r = row(par, css), c = mk('input'); c.type = 'checkbox'; c.name = k; c.checked = !!v[k]; const l = mk('label', '', label); l.prepend(c); r.appendChild(l); c.onchange = () => { v[k] = c.checked; sync(); }; return c; };
  const sel = (par, k, label, opts, css) => { const r = row(par, css); r.appendChild(mk('span', 'min-width:96px', label)); const s = mk('select'); s.name = k;
    opts.forEach(([val, t]) => { const o = mk('option', '', t); o.value = val; s.appendChild(o); }); s.value = v[k]; s.onchange = () => { v[k] = s.value; sync(); }; r.appendChild(s); return s; };
  // 间隙检测
  const g = sec(L3('間隙偵測', '间隙检测', 'Gap Detection'));
  const gd = chk(g, 'gapDetect', ' ' + L3('間隙偵測', '间隙检测', 'Gap Detection'));
  const gl = sel(g, 'gapLength', L3('間隙長度：', '间隙长度：', 'Gap Length:'), [['small', L3('小', '小', 'Small')], ['medium', L3('中', '中', 'Medium')], ['large', L3('大', '大', 'Large')], ['custom', L3('自訂', '自定', 'Custom')]], 'padding-left:20px');
  const gc = mk('input', 'width:64px'); gc.type = 'text'; gc.name = 'gapCustom'; gl.parentNode.appendChild(gc); gl.parentNode.appendChild(mk('span', '', 'px'));
  gc.onchange = () => { const n = parseFloat(gc.value); if (isFinite(n) && n > 0 && n <= 1000 && Math.abs(n - gapPx(v.gapLength, v.gapCustom)) > 1e-9){ v.gapCustom = n; v.gapLength = 'custom'; } sync(); };
  // 选项
  const o = sec(L3('選項', '选项', 'Options'));
  chk(o, 'openAsClosed', ' ' + L3('將開放填色路徑視為封閉', '将开放的填色路径视为闭合', 'Consider Open Filled Path as Closed'));
  chk(o, 'clickStrokeSplits', ' ' + L3('在合併模式中，按一下筆畫以分割路徑', '在合并模式中，单击“描边”分割路径', 'In Merge Mode, Clicking Stroke Splits the Path'));
  const pf = sel(o, 'pickFrom', L3('挑選顏色從：', '拾色来源：', 'Pick Color From:'), [['swatches', L3('色票', '颜色色板', 'Color Swatches')], ['artwork', L3('圖稿', '图稿', 'Artwork')]]);
  const cs = chk(o, 'cursorSwatch', ' ' + L3('游標色票預視', '光标色板预览', 'Cursor Swatch Preview'), 'padding-left:20px');
  // 突出显示
  const h = sec(L3('反白', '突出显示', 'Highlight'));
  chk(h, 'highlightFill', ' ' + L3('填色', '填充', 'Fill'));
  const hs = chk(h, 'highlightStroke', ' ' + L3('可編輯時反白筆畫', '可编辑时突出显示描边', 'Highlight Stroke When Editable'));
  const CN = {lightRed:['淺紅色', '淡红色', 'Light Red'], red:['紅色', '红色', 'Red'], orange:['橙色', '橙色', 'Orange'], yellow:['黃色', '黄色', 'Yellow'], green:['綠色', '绿色', 'Green'],
    lightBlue:['淺藍色', '淡蓝色', 'Light Blue'], blue:['藍色', '蓝色', 'Blue'], magenta:['洋紅色', '洋红色', 'Magenta'], black:['黑色', '黑色', 'Black']};
  const hc = sel(h, 'highlightColor', L3('顏色：', '颜色：', 'Color:'), Object.keys(HL_COLORS).map(k => [k, L3(...CN[k])]), 'padding-left:20px');
  const sw = mk('span', 'display:inline-block;width:14px;height:14px;border:1px solid #777'); hc.parentNode.appendChild(sw);
  function sync(){
    gl.disabled = gc.disabled = !v.gapDetect; gl.value = v.gapLength; gc.value = String(+gapPx(v.gapLength, v.gapCustom).toFixed(3));
    cs.disabled = v.pickFrom !== 'swatches'; pf.value = v.pickFrom; hc.disabled = !v.highlightStroke; sw.style.background = HL_COLORS[v.highlightColor] || v.highlightColor;
  }
  sync();
  const btns = mk('div', 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px');
  const btn = (name, label, primary) => { const b = mk('button', 'padding:4px 14px;border-radius:3px;border:1px solid var(--line,#3a3a3a);cursor:pointer;color:#fff;background:' + (primary ? 'var(--accent,#2f7fd8)' : 'var(--bg3,#2f2f2f)'), label); b.name = name; btns.appendChild(b); return b; };
  const rs = btn('reset', L3('重設', '重置', 'Reset')); rs.style.marginRight = 'auto';
  const cancel = btn('cancel', L3('取消', '取消', 'Cancel')), ok = btn('ok', L3('確定', '确定', 'OK'), true);
  box.appendChild(btns); bg.appendChild(box); document.body.appendChild(bg);
  const close = () => bg.remove();
  const done = () => { gc.onchange(); const prm = {}; SB_KEYS.forEach(k => prm[k] = v[k]); CMD.run('shapebuilder.options', prm); close(); if (window.UI && UI.buildOptions && ToolState.cur === 'shapebuilder') UI.buildOptions('shapebuilder'); };
  rs.onclick = e => { e.stopPropagation(); Object.assign(v, SB_DEF); box.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = !!v[c.name]); sync(); };
  cancel.onclick = e => { e.stopPropagation(); close(); };
  ok.onclick = e => { e.stopPropagation(); done(); };
  bg.addEventListener('pointerdown', e => { if (e.target === bg){ e.stopPropagation(); close(); } });
  bg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); done(); } else if (e.key === 'Escape'){ e.preventDefault(); close(); } });
  gd.focus();
  return bg;
}
SB.openDialog = openOptionsDialog; window.BuildKit.gapBridges = gapBridges;
CMD.reg('shapebuilder.optionsDialog', {i18n:'', params:'{} 打开「形状生成器工具选项」对话框（＝双击工具列上的形状生成器图示）→ {ok}'}, () => { openOptionsDialog(); return {ok:true}; });
/* 双击工具列上的形状生成器图示（AI：双击工具＝工具选项） */
//   单击会重画工具列（按钮换新元素，浏览器的 dblclick 接不上）⇒ 自己认「450ms 内在形状生成器图示上按两下」
let tbLast = 0;
document.addEventListener('pointerdown', e => {
  const b = e.target && e.target.closest && e.target.closest('#toolbar .tb[data-tool="shapebuilder"]');
  if (!b || e.button !== 0){ tbLast = 0; return; }
  const now = performance.now();
  if (now - tbLast < 450){ tbLast = 0; setTimeout(openOptionsDialog, 0); } else tbLast = now;
}, true);

/* 游标（AI 2020）：箭头带「＋」＝合并；按着 Alt 带「−」＝删除 */
const CUR = sign => 'url("data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L13 11 Z" fill="#000" stroke="#fff" stroke-width="1"/>'
  + '<rect x="14" y="14" width="9" height="9" fill="#fff" stroke="#000" stroke-width="1"/><path d="M15.5 18.5 H21.5' + (sign === '+' ? ' M18.5 15.5 V21.5' : '') + '" stroke="#000" stroke-width="1.5"/></svg>') + '") 2 2, ' + (sign === '+' ? 'copy' : 'default');
SB.cursorFor = alt => CUR(alt ? '-' : '+');
function setCursor(alt){ if (window.UI && UI.canvas && ToolState.cur === 'shapebuilder') UI.canvas.style.cursor = SB.cursorFor(alt); }
['keydown', 'keyup'].forEach(t => window.addEventListener(t, e => { if (e.key === 'Alt' && ToolState.cur === 'shapebuilder'){ SB.altHeld = t === 'keydown'; setCursor(SB.altHeld); if (SB.pt && !SB.dragging) SB.hoverEdge = SB.altHeld ? SB.cache.edgeAt(SB.pt, VecSel.tol(3)) : -1; if (window.UI && UI.ctx) UI.draw(); } }));
function touch(from, to){
  const pts = from ? samplePolyline([from, to], VecSel.tol(2)) : [to];
  for (const q of pts){
    const i = SB.cache.at(q); if (i >= 0 && !SB.touched.includes(i)) SB.touched.push(i);
    if (SB.alt){ const k = SB.cache.edgeAt(q, VecSel.tol(3)); if (k >= 0 && !SB.touchedEdges.includes(k)) SB.touchedEdges.push(k); }   // Alt 拖过的分割线段
  }
}
window.ShapeBuilderTool = SB;

Tools.reg({
  id:'shapebuilder', icon:'⊕', group:'vector', order:60, for:'vector', opts:[], cursor:SB.cursorFor(false), hint:'ui.shapebuilderHint',
  strings:{
    'zh-Hant':{'tool.shapebuilder':'形狀建立程式工具', 'ui.shapebuilderHint':'先選取重疊的物件；拖過幾個區域＝合併成一個形狀，點一下＝把那一塊分出來（填上目前的填色）；按住 Alt 拖／點＝刪掉那幾塊；沒填色的線段會把區域切開，Alt 點／拖過線段＝刪掉那段線',
      'opt.sbPickFrom':'挑選顏色從', 'ui.sbSwatches':'色票', 'ui.sbArtwork':'圖稿'},
    'zh-Hans':{'tool.shapebuilder':'形状生成器工具', 'ui.shapebuilderHint':'先选中重叠的对象；拖过几个区域＝合并成一个形状，点一下＝把那一块分出来（填上当前的填色）；按住 Alt 拖／点＝删掉那几块；没填色的线段会把区域切开，Alt 点／拖过线段＝删掉那段线',
      'opt.sbPickFrom':'拾色来源', 'ui.sbSwatches':'色板', 'ui.sbArtwork':'图稿'},
    'en':{'tool.shapebuilder':'Shape Builder Tool', 'ui.shapebuilderHint':'Select overlapping objects first; drag across regions to merge them, click to split one out (painted with the current fill); Alt-drag / Alt-click deletes regions; unfilled line segments split regions, Alt-click / Alt-drag over a segment deletes that piece of line',
      'opt.sbPickFrom':'Pick Color From', 'ui.sbSwatches':'Color Swatches', 'ui.sbArtwork':'Artwork'}
  },
  buildOptions(box, add){
    const sel = document.createElement('select'); sel.dataset.k = 'sbPickFrom';
    [['swatches', 'ui.sbSwatches'], ['artwork', 'ui.sbArtwork']].forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t(k); sel.appendChild(o); });
    sel.value = SB.pickFrom; sel.onchange = () => CMD.run('shapebuilder.options', {pickFrom:sel.value});
    add('sbPickFrom', sel);
  },
  onMove(e, pt){
    SB.pt = pt.slice(); SB.altHeld = !!e.altKey; setCursor(SB.altHeld || (SB.dragging && SB.alt));
    if (SB.pickFrom === 'swatches' && SB.cursorSwatch && !SB.dragging) UI.draw();
    if (SB.dragging){
      const last = SB.points[SB.points.length - 1];
      if (!last || dist(last, pt) >= VecSel.tol(1)){ touch(last, pt); SB.points.push(pt); }
      UI.draw(); return;
    }
    const h = SB.cache.at(pt), he = SB.altHeld ? SB.cache.edgeAt(pt, VecSel.tol(3)) : -1;
    if (h !== SB.hover || he !== SB.hoverEdge){ SB.hover = h; SB.hoverEdge = he; UI.draw(); }
  },
  onDown(e, pt){
    if (VecSel.isEmpty()) return;                                      // cx.selection.is_empty() ⇒ vec![]
    SB.dragging = true; SB.alt = !!e.altKey; SB.points = [pt]; SB.touched = []; SB.touchedEdges = [];
    touch(null, pt); UI.draw();
  },
  onUp(e, pt){
    if (!SB.dragging){ UI.draw(); return; }
    SB.dragging = false;
    const last = SB.points[SB.points.length - 1];
    if (!last || last[0] !== pt[0] || last[1] !== pt[1]){ touch(last, pt); SB.points.push(pt); }
    const points = SB.points; SB.points = [];
    const hit = SB.touched.length + SB.touchedEdges.length; SB.touched = []; SB.touchedEdges = [];
    const erase = SB.alt || !!e.altKey;
    let len = 0; for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
    if (SB.clickStrokeSplits && !erase && len < VecSel.tol(3)){            // 选项「在合并模式中单击描边分割路径」：点在描边上＝切路径
      const L0 = VecSel.layer();
      if (L0){ const r = CMD.run('shapebuilder.splitStroke', {x:pt[0], y:pt[1], layerId:L0.id, ids:sortedRoots(L0).map(s => s.id)}); if (r && r.ok){ SB.cache.reset(); SB.hover = -1; UI.draw(); return; } }
    }
    if (!hit){ UI.draw(); return; }
    SB.cache.reset();
    const L = VecSel.layer();
    const ids = L ? sortedRoots(L).map(s => s.id) : [];
    const prm = {ids, layerId:L && L.id, points:points.map(q => [q[0], q[1]]), erase, tol:VecSel.tol(3)};
    if (!erase && SB.pickFrom === 'swatches') prm.fill = UI.fill();                 // 拾色来源＝色板：填目前的填色（无＝none）
    CMD.run('shapebuilder.merge', prm);
    SB.hover = -1; SB.hoverEdge = -1; UI.draw();
  },
  onDeactivate(){ SB.dragging = false; SB.points = []; SB.touched = []; SB.touchedEdges = []; SB.hover = -1; SB.hoverEdge = -1; SB.pt = null; SB.cache.reset(); },
  /* overlays（builder.rs:355-375；照 AI 2020）：游标下的区域＝网纹（两向斜线交叉的网点，突出显示 ▸ 填充）；
     区域边＝突出显示颜色（可编辑时突出显示描边，缺省淡红）；Alt 拖＝红色；拖曳折线；光标色板预览 */
  drawOverlay(ctx, s){
    VecSel.drawOverlay(ctx, s);
    const regs = SB.cache.regs, L = SB.cache.L;
    if (L){
      const del = (SB.dragging && SB.alt) || (!SB.dragging && SB.altHeld);
      const color = del ? HIGHLIGHT_RED : HATCH;
      const show = SB.dragging ? SB.touched : (SB.hover >= 0 && SB.hoverEdge < 0 ? [SB.hover] : []);
      ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeStyle = color;
      const gap = VecSel.tol(4), flip = P => P.map(q => [-q[0], q[1]]);
      for (const i of show){
        const r = regs[i]; if (!r) continue;
        if (SB.highlightFill){
          ctx.beginPath();
          for (const [a, b] of hatch(r.loops, gap)){ ctx.moveTo((a[0] + L.x) * s, (a[1] + L.y) * s); ctx.lineTo((b[0] + L.x) * s, (b[1] + L.y) * s); }
          for (const [a, b] of hatch(r.loops.map(flip), gap)){ ctx.moveTo((-a[0] + L.x) * s, (a[1] + L.y) * s); ctx.lineTo((-b[0] + L.x) * s, (b[1] + L.y) * s); }
          ctx.stroke();
        }
        if (SB.highlightStroke || SB.highlightFill){
          ctx.save(); if (SB.highlightStroke && !del){ ctx.strokeStyle = hlColor(); ctx.lineWidth = 2; }
          pathLoops(ctx, L, r.loops, s); ctx.stroke(); ctx.restore();
        }
      }
      // Alt 停在／拖过分割线段 ⇒ 那段亮红（AI：要删的边）
      const edges = SB.dragging ? (SB.alt ? SB.touchedEdges : []) : (SB.hoverEdge >= 0 ? [SB.hoverEdge] : []);
      if (edges.length && SB.cache.pieces){
        ctx.save(); ctx.strokeStyle = HIGHLIGHT_RED; ctx.lineWidth = 3 * s / UI.zoom; ctx.beginPath();
        for (const k of edges){ const pc = SB.cache.pieces[k]; if (pc) pc.pts.forEach((q, i) => { const x = (q[0] + L.x) * s, y = (q[1] + L.y) * s; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); }
        ctx.stroke(); ctx.restore();
      }
      if (SB.dragging && SB.points.length > 1){
        ctx.beginPath(); SB.points.forEach((q, i) => i ? ctx.lineTo(q[0] * s, q[1] * s) : ctx.moveTo(q[0] * s, q[1] * s)); ctx.stroke();
      }
      ctx.restore();
    }
    if (SB.pt && SB.pickFrom === 'swatches' && SB.cursorSwatch && !VecSel.isEmpty()){   // 光标色板预览：游标上方一格目前的填色
      const d = s / UI.zoom, x = SB.pt[0] * s - 6 * d, y = SB.pt[1] * s - 24 * d, f = UI.fill();
      ctx.save(); ctx.lineWidth = d; ctx.strokeStyle = '#000';
      if (f && f !== 'none' && typeof f === 'string'){ ctx.fillStyle = f; ctx.fillRect(x, y, 12 * d, 12 * d); }
      else { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 12 * d, 12 * d); ctx.strokeStyle = '#e00'; ctx.beginPath(); ctx.moveTo(x, y + 12 * d); ctx.lineTo(x + 12 * d, y); ctx.stroke(); ctx.strokeStyle = '#000'; }
      ctx.strokeRect(x, y, 12 * d, 12 * d); ctx.restore();
    }
  }
});
})();
