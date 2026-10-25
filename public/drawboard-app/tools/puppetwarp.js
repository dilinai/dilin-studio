/* 堤麟画板 · 操控变形工具 —— 照 ArtCraft VectorCraft 原码逐段翻译
   原码：
     tools/src/distort/puppet.rs（全档 749 行：mesh_input／outlines_of、rest_and_pins、PinSet（of／rest_of／turn_of／params／mesh_path）、warp_from_rest、
                                  PuppetWarpTool（按下：Alt 近选中图钉＝转、点图钉＝选／拖、点图稿＝加图钉、点网格外＝提示；拖＝预览；放开＝Commit；
                                  Delete／Backspace 删选中图钉；叠画：网格、图钉、转动虚圈、网格外提示；游标；选项 showMesh／expand／selectAllPins））
     tools/src/distort/arap.rs（全档 823 行：BandMatrix 带状 Cholesky、Mesh::build（规则格三角网、留下中心在填色内或靠近路径的格子）、locate／bary／map／contains／unmap／turn_at、
                                Pin.constraints（锁住转角＝多两个一格外的点）、deform 两步（相似变换＋缩放修正）、fit_angle、default_pins（中心＋每条肢体末端，至少三根）、spread_pins、geodesic）
     tools/src/distort.rs:48-119（warp_node_with：路径丢掉活形状参数、锚点与把手逐点映射；编组往下；其余＝中心处的仿射近似；collect_points）
     doc/src/puppet.rs:36-40（PuppetPins::holds：图钉属于这几个物件、而且物件还是上次变形留下的那样）
     engine/src/cmd/distortcmds.rs:68-82（object.puppetWarp／object.puppetWarp.pins 规格）、637-680（puppet_warp：rest＝工具的图钉，从静止形状重算、图钉存进文件随 Undo 走）
   我们这边：
     图钉存在矢量层 L.data.puppet = {ids, rest:[物件快照], result:[变形后物件的 JSON], pins:[{rest:[x,y], at:[x,y], angle:弧度|null}]}（图层坐标）——
       跟着历史快照走（Undo 连图钉一起退），holds 用 JSON 比对代替他们的指标比对。他们图钉不存档，我们存进工程档（多一栏，读回来没有坏处）。
     命令收／回文件坐标；内部一律图层坐标。贝兹曲线的绕数用拉平成折线算（kurbo 用解析的 winding）。 */
(function(){
'use strict';
const K = window.XformKit;
if (!K){ console.error('puppetwarp.js: tools/reflect.js（XformKit）没载入'); return; }
const {A, BLUE, fin, dist} = K;
const T = k => (typeof Lang !== 'undefined' ? Lang.t(k) : k);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cross = (a, b) => a[0]*b[1] - a[1]*b[0], dot = (a, b) => a[0]*b[0] + a[1]*b[1];
const clone = o => JSON.parse(JSON.stringify(o));

/* ═════════════ arap.rs：BandMatrix（带状对称正定，下三角带逐行存）═════════════ */
function Band(n, bw){ this.n = n; this.bw = bw; this.a = new Float64Array(n * (bw + 1)); }
Band.prototype.add = function(i, j, v){ if (i < j){ const t = i; i = j; j = t; } this.a[i * (this.bw + 1) + j + this.bw - i] += v; };
Band.prototype.factor = function(){
  const n = this.n, bw = this.bw, a = this.a, W = bw + 1;
  for (let i = 0; i < n; i++){
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++){
      let s = a[i*W + j + bw - i];
      const k0 = Math.max(j0, j - bw);
      for (let k = k0; k < j; k++) s -= a[i*W + k + bw - i] * a[j*W + k + bw - j];
      if (i === j){ if (s <= 0 || !isFinite(s)) return false; a[i*W + bw] = Math.sqrt(s); }
      else a[i*W + j + bw - i] = s / a[j*W + bw];
    }
  }
  return true;
};
Band.prototype.solve = function(b){
  const n = this.n, bw = this.bw, a = this.a, W = bw + 1;
  for (let i = 0; i < n; i++){
    let s = b[i]; const k0 = Math.max(0, i - bw);
    for (let k = k0; k < i; k++) s -= a[i*W + k + bw - i] * b[k];
    b[i] = s / a[i*W + bw];
  }
  for (let i = n - 1; i >= 0; i--){
    let s = b[i]; const k1 = Math.min(i + bw + 1, n);
    for (let k = i + 1; k < k1; k++) s -= a[k*W + i + bw - k] * b[k];
    b[i] = s / a[i*W + bw];
  }
};

/* ═════════════ 外形（puppet.rs:30-50 outlines_of、distort.rs:103-119 collect_points）═════════════ */
const FLAT = 24;        // 绕数用：每段曲线拉平成 24 段折线
function outlineOf(v){
  const segs = VecSel.segments(v), closed = !!v.closed;
  const bb = K.viewBounds(v, q => q);
  const seg = segs.map(c => {
    const xs = [c.p0[0], c.c1[0], c.c2[0], c.p3[0]], ys = [c.p0[1], c.c1[1], c.c2[1], c.p3[1]];
    return {c, box:{x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)}};
  });
  let poly = null;
  if (closed && segs.length){ poly = []; for (const c of segs) for (let i = 0; i < FLAT; i++) poly.push(VecSel.evalCubic(c, i / FLAT)); }
  return {seg, closed, bb, poly};
}
/* nodes：图层坐标的物件 → {outlines, bounds} 或 null（没有点） */
function outlinesOf(nodes){
  const outlines = [], pts = [];
  const go = n => {
    if (!n) return;
    if (K.isLeaf(n)){
      const v = VecSel.asBezier(n); if (!v || !v.anchors) return;
      v.anchors.forEach(a => { pts.push([a.x, a.y]); pts.push(VecSel.hIn(a)); pts.push(VecSel.hOut(a)); });
      if (v.anchors.length) outlines.push(outlineOf(v));
      return;
    }
    if (K.isCont(n)){ n.children.forEach(go); return; }
    const b = K.shapeBounds(n, q => q, false); if (b){ pts.push([b.x0, b.y0]); pts.push([b.x1, b.y1]); }
  };
  nodes.forEach(go);
  if (!pts.length) return null;
  let b = {x0:pts[0][0], y0:pts[0][1], x1:pts[0][0], y1:pts[0][1]};
  pts.forEach(p => { b = K.union(b, {x0:p[0], y0:p[1], x1:p[0], y1:p[1]}); });
  return {outlines, bounds:b};
}
/* closed_winding：闭合子路径在 p 的绕数（开放的不算） */
function winding(o, p){
  if (!o.closed || !o.poly) return 0;
  const P = o.poly; let w = 0;
  for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length];
    if (a[1] <= p[1]){ if (b[1] > p[1] && cross(sub(b, a), sub(p, a)) > 0) w++; }
    else if (b[1] <= p[1] && cross(sub(b, a), sub(p, a)) < 0) w--;
  }
  return w;
}
function near(o, c, r){
  for (const s of o.seg){
    if (c[0] < s.box.x0 - r || c[0] > s.box.x1 + r || c[1] < s.box.y0 - r || c[1] > s.box.y1 + r) continue;
    if (VecSel.nearestOnCubic(s.c, c).d <= r) return true;
  }
  return false;
}

/* ═════════════ arap.rs:101-364 Mesh ═════════════ */
function buildMesh(outlines, bounds, opt){
  const res = opt.resolution || 20, ex = Math.max(opt.expand, 0);
  const side = Math.max(Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) + 2 * ex, 1e-3);
  const cell = Math.max(side / Math.max(res, 1), 1e-3);
  const pad = ex + cell * 0.01;
  const b = K.inflate(bounds, pad);
  const nx = Math.max(Math.ceil((b.x1 - b.x0) / cell), 1), ny = Math.max(Math.ceil((b.y1 - b.y0) / cell), 1);
  const origin = [b.x0, b.y0], reach = cell * 0.75 + ex;
  const keep = c => {
    if (!outlines.length) return 2;
    if (outlines.some(o => winding(o, c) !== 0 || near(o, c, cell * 0.25))) return 2;
    return outlines.some(o => {
      const bb = K.inflate(o.bb, reach);
      if (!bb || !K.inRect(bb, c)) return false;
      if (winding(o, c) !== 0) return true;
      return near(o, c, reach);
    }) ? 1 : 0;
  };
  const kept = new Array(nx * ny).fill(false), core = new Array(nx * ny).fill(false);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const k = keep([origin[0] + (i + 0.5) * cell, origin[1] + (j + 0.5) * cell]);
    kept[j*nx + i] = k > 0; core[j*nx + i] = k === 2;
  }
  const vid = new Array((nx + 1) * (ny + 1)).fill(-1), verts = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++){
    const used = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]].some(([ci, cj]) => ci >= 0 && cj >= 0 && ci < nx && cj < ny && kept[cj*nx + ci]);
    if (used){ vid[j*(nx + 1) + i] = verts.length; verts.push([origin[0] + i * cell, origin[1] + j * cell]); }
  }
  const tris = [], cells = new Array(nx * ny).fill(null);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    if (!kept[j*nx + i]) continue;
    const v = (di, dj) => vid[(j + dj)*(nx + 1) + i + di];
    const v00 = v(0, 0), v10 = v(1, 0), v01 = v(0, 1), v11 = v(1, 1), t0 = tris.length;
    tris.push([v00, v10, v11]); tris.push([v00, v11, v01]);
    cells[j*nx + i] = [t0, t0 + 1];
  }
  return new Mesh(verts, tris, origin, cell, nx, ny, cells, core);
}
function Mesh(verts, tris, origin, cell, nx, ny, cells, core){ Object.assign(this, {verts, tris, origin, cell, nx, ny, cells, core}); }
Mesh.prototype = {
  vertexBand(){ let m = 0; for (const t of this.tris) m = Math.max(m, Math.max(...t) - Math.min(...t)); return m; },
  cellCentre(k){ return [this.origin[0] + ((k % this.nx) + 0.5) * this.cell, this.origin[1] + (Math.floor(k / this.nx) + 0.5) * this.cell]; },
  cellAt(p){
    const fi = Math.floor((p[0] - this.origin[0]) / this.cell), fj = Math.floor((p[1] - this.origin[1]) / this.cell);
    return (fi >= 0 && fj >= 0 && fi < this.nx && fj < this.ny) ? fj * this.nx + fi : -1;
  },
  contains(p){ const k = this.cellAt(p); return k >= 0 && !!this.cells[k]; },
  bary(t, p){
    const [a, b, c] = this.tris[t].map(i => this.verts[i]);
    const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(p, a), den = cross(v0, v1);
    if (Math.abs(den) < 1e-18) return [1, 0, 0];
    const l1 = cross(v2, v1) / den, l2 = cross(v0, v2) / den;
    return [1 - l1 - l2, l1, l2];
  },
  /* locate：p 所在的三角形与重心坐标（网格外＝最近的格子外插） */
  locate(p){
    let k = this.cellAt(p);
    if (k < 0 || !this.cells[k]){
      let best = -1, bd = Infinity;
      for (let q = 0; q < this.cells.length; q++){ if (!this.cells[q]) continue; const c = this.cellCentre(q), d = (c[0]-p[0])**2 + (c[1]-p[1])**2; if (d < bd){ bd = d; best = q; } }
      if (best < 0) return null; k = best;
    }
    const [ta, tb] = this.cells[k], v00 = this.verts[this.tris[ta][0]];
    const lx = (p[0] - v00[0]) / this.cell, ly = (p[1] - v00[1]) / this.cell;
    const t = lx >= ly ? ta : tb;
    return {t, w:this.bary(t, p)};
  },
  map(def, p){
    const l = this.locate(p); if (!l) return p.slice();
    const [a, b, c] = this.tris[l.t].map(i => def[i]), w = l.w;
    return [a[0]*w[0] + b[0]*w[1] + c[0]*w[2], a[1]*w[0] + b[1]*w[1] + c[1]*w[2]];
  },
  /* unmap：变形后的网格在 q 显示的是静止形状上的哪一点（网格外＝null；网格折叠处取 q 在里面最深的三角形） */
  unmap(def, q){
    let best = null;
    for (const t of this.tris){
      const [a, b, c] = t.map(i => def[i] || this.verts[i]);
      const den = cross(sub(b, a), sub(c, a)); if (Math.abs(den) < 1e-18) continue;
      const l1 = cross(sub(q, a), sub(c, a)) / den, l2 = cross(sub(b, a), sub(q, a)) / den, w = [1 - l1 - l2, l1, l2];
      const depth = Math.min(...w);
      if (depth >= -1e-9 && (!best || depth > best.d)){
        const [ra, rb, rc] = t.map(i => this.verts[i]);
        best = {d:depth, p:[ra[0]*w[0] + rb[0]*w[1] + rc[0]*w[2], ra[1]*w[0] + rb[1]*w[1] + rc[1]*w[2]]};
      }
    }
    return best ? best.p : null;
  },
  turnAt(def, p){
    const l = this.locate(p); if (!l) return null;
    const tri = this.tris[l.t]; if (!tri.every(i => def[i])) return null;
    return fitAngle(tri.map(i => this.verts[i]), tri.map(i => def[i]));
  },
  pinCells(){ const any = this.core.some(Boolean); return this.cells.map((c, k) => !!c && (this.core[k] || !any)); },
  neighbours(k){
    const out = [], i = k % this.nx, j = Math.floor(k / this.nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < this.nx && b < this.ny) out.push([b * this.nx + a, (di && dj) ? Math.SQRT2 : 1]);
    }
    return out;
  },
  geodesic(inside, sources){
    const dist = new Array(this.cells.length).fill(Infinity);
    for (const [k, d] of sources) if (k >= 0 && k < dist.length) dist[k] = Math.min(dist[k], d);
    const ins = k => !!inside[k];
    let changed = true;
    while (changed){
      changed = false;
      for (let k = 0; k < dist.length; k++){
        if (!ins(k) || !isFinite(dist[k])) continue;
        for (const [m, st] of this.neighbours(k)) if (ins(m) && dist[k] + st < dist[m] - 1e-12){ dist[m] = dist[k] + st; changed = true; }
      }
    }
    return dist;
  }
};
const centroid = P => [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3];
/* fit_angle：rest → cur 的最小平方旋转（绕各自重心） */
function fitAngle(rest, cur){
  const rc = centroid(rest), cc = centroid(cur); let sc = 0, ss = 0;
  for (let k = 0; k < 3; k++){ const r = sub(rest[k], rc), c = sub(cur[k], cc); sc += dot(r, c); ss += cross(r, c); }
  return Math.atan2(ss, sc);
}
const PIN_WEIGHT = 1e5, REG = 1e-7;
/* Pin.constraints：图钉本身；锁住转角的再多两个点（静止时一格外的 x、y 方向，绕目标转 angle） */
function constraints(pin, reach){
  const out = [[pin.rest, pin.target]];
  if (pin.angle !== null && pin.angle !== undefined && isFinite(pin.angle)){
    const s = Math.sin(pin.angle), c = Math.cos(pin.angle);
    for (const d of [[reach, 0], [0, reach]]) out.push([add(pin.rest, d), add(pin.target, [d[0]*c - d[1]*s, d[0]*s + d[1]*c])]);
  }
  return out;
}
/* arap.rs:429-538 deform：两步 ARAP → 变形后的顶点 */
function deform(mesh, pins){
  const n = mesh.verts.length;
  if (!n || !pins.length) return mesh.verts.map(v => v.slice());
  const located = [];
  for (const p of pins) for (const [rest, target] of constraints(p, mesh.cell)){ const l = mesh.locate(rest); if (l) located.push([l.t, l.w, target]); }
  const vb = mesh.vertexBand();
  // 第一步：相似变换不变的误差（2n 个未知数交错 x0,y0,x1,y1…）
  const g = new Band(2*n, 2*vb + 1);
  for (const tri of mesh.tris){
    for (let k = 0; k < 3; k++){
      const a = tri[k], b = tri[(k + 1) % 3], c = tri[(k + 2) % 3];
      const pa = mesh.verts[a], pb = mesh.verts[b], pc = mesh.verts[c];
      const e = sub(pb, pa), l2 = dot(e, e); if (l2 < 1e-18) continue;
      const d = sub(pc, pa), x = dot(d, e) / l2, y = dot(d, [-e[1], e[0]]) / l2;
      const vars = [2*a, 2*a + 1, 2*b, 2*b + 1, 2*c, 2*c + 1];
      const rx = [x - 1, -y, -x, y, 1, 0], ry = [y, x - 1, -y, -x, 0, 1];
      for (const r of [rx, ry]) for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++){ const v = r[i]*r[j]; if (v !== 0) g.add(vars[i], vars[j], v); }
    }
  }
  const rhs = new Float64Array(2*n);
  for (const [t, w, target] of located){
    const tri = mesh.tris[t];
    for (let comp = 0; comp < 2; comp++) for (let i = 0; i < 3; i++){
      for (let j = 0; j <= i; j++) g.add(2*tri[i] + comp, 2*tri[j] + comp, PIN_WEIGHT * w[i] * w[j]);
      rhs[2*tri[i] + comp] += PIN_WEIGHT * w[i] * target[comp];
    }
  }
  mesh.verts.forEach((v, i) => { g.add(2*i, 2*i, REG); g.add(2*i + 1, 2*i + 1, REG); rhs[2*i] += REG * v[0]; rhs[2*i + 1] += REG * v[1]; });
  if (!g.factor()) return mesh.verts.map(v => v.slice());
  g.solve(rhs);
  const step1 = []; for (let i = 0; i < n; i++) step1.push([rhs[2*i], rhs[2*i + 1]]);
  // 第二步：每个三角形刚体贴合，再让每条边向量对上贴合的三角形（x、y 分开解）
  const l = new Band(n, vb), bx = new Float64Array(n), by = new Float64Array(n);
  for (const tri of mesh.tris){
    const rest = tri.map(i => mesh.verts[i]), cur = tri.map(i => step1[i]);
    const rc = centroid(rest), cc = centroid(cur), th = fitAngle(rest, cur), s = Math.sin(th), co = Math.cos(th);
    const fit = rest.map(r => { const d = sub(r, rc); return [cc[0] + d[0]*co - d[1]*s, cc[1] + d[0]*s + d[1]*co]; });
    for (let k = 0; k < 3; k++){
      const i = tri[k], j = tri[(k + 1) % 3], e = sub(fit[k], fit[(k + 1) % 3]);
      l.add(i, i, 1); l.add(j, j, 1); l.add(i, j, -1);
      bx[i] += e[0]; bx[j] -= e[0]; by[i] += e[1]; by[j] -= e[1];
    }
  }
  for (const [t, w, target] of located){
    const tri = mesh.tris[t];
    for (let i = 0; i < 3; i++){
      for (let j = 0; j <= i; j++) l.add(tri[i], tri[j], PIN_WEIGHT * w[i] * w[j]);
      bx[tri[i]] += PIN_WEIGHT * w[i] * target[0]; by[tri[i]] += PIN_WEIGHT * w[i] * target[1];
    }
  }
  step1.forEach((v, i) => { l.add(i, i, REG); bx[i] += REG * v[0]; by[i] += REG * v[1]; });
  if (!l.factor()) return step1;
  l.solve(bx); l.solve(by);
  const out = []; for (let i = 0; i < n; i++) out.push([bx[i], by[i]]);
  return out;
}
/* arap.rs:565-636 centre_of／default_pins／spread_pins */
function centreOf(mesh){
  const pc = mesh.pinCells(), cells = []; pc.forEach((c, k) => { if (c) cells.push(k); });
  if (!cells.length) return null;
  const s = cells.reduce((a, k) => add(a, mesh.cellCentre(k)), [0, 0]), c = [s[0] / cells.length, s[1] / cells.length];
  let k = cells[0], bd = Infinity;
  for (const q of cells){ const cc = mesh.cellCentre(q), d = (cc[0]-c[0])**2 + (cc[1]-c[1])**2; if (d < bd){ bd = d; k = q; } }
  return {k, p:mesh.contains(c) ? c : mesh.cellCentre(k)};
}
const MAX_AUTO_PINS = 12;
function spreadPins(mesh, out, count){
  const centres = []; mesh.pinCells().forEach((c, k) => { if (c) centres.push(mesh.cellCentre(k)); });
  while (out.length < Math.min(count, centres.length)){
    let best = null, bd = -Infinity;
    for (const a of centres){ const d = Math.min(...out.map(o => (o[0]-a[0])**2 + (o[1]-a[1])**2)); if (d >= bd){ bd = d; best = a; } }   // max_by：一样大取后面那个
    if (!best) break;
    out.push(best);
  }
}
function defaultPins(mesh){
  const C = centreOf(mesh); if (!C) return [];
  const inside = mesh.pinCells();
  const edge = []; for (let k = 0; k < inside.length; k++){ if (!inside[k]) continue; const nb = mesh.neighbours(k); if (nb.length < 8 || nb.some(([m]) => !inside[m])) edge.push([k, 0.5]); }
  const radius = mesh.geodesic(inside, edge).filter(d => isFinite(d)).reduce((a, d) => Math.max(a, d), 0);
  const fromC = mesh.geodesic(inside, [[C.k, 0]]);
  const ends = [];
  for (let k = 0; k < inside.length; k++){
    const d = fromC[k];
    if (inside[k] && isFinite(d) && d >= 1.5 * radius && mesh.neighbours(k).every(([m]) => !inside[m] || fromC[m] <= d)) ends.push(k);
  }
  ends.sort((a, b) => fromC[b] - fromC[a]);
  const apart = 2.2 * radius * mesh.cell, out = [C.p], tips = [];
  for (const k of ends){
    const p = mesh.cellCentre(k);
    if (out.length >= MAX_AUTO_PINS || tips.some(q => dist(q, p) < apart)) continue;
    tips.push(p);
    const cap = [];
    for (let m = 0; m < inside.length; m++){ if (inside[m] && fromC[m] >= fromC[k] - radius){ const q = mesh.cellCentre(m); if (dist(q, p) < apart) cap.push(q); } }
    const s = cap.reduce((a, q) => add(a, q), [0, 0]), mid = [s[0] / Math.max(cap.length, 1), s[1] / Math.max(cap.length, 1)];
    out.push(mesh.contains(mid) ? mid : p);
  }
  spreadPins(mesh, out, 3);
  return out;
}

/* ═════════════ distort.rs warp_node_with：f 是图层坐标 → 图层坐标 ═════════════ */
function affineNear(f, p, eps){
  const o = f(p), ex = sub(f([p[0] + eps, p[1]]), o), ey = sub(f([p[0], p[1] + eps]), o);
  const lin = [ex[0] / eps, ex[1] / eps, ey[0] / eps, ey[1] / eps, 0, 0];
  return A.mul(A.translate(o[0], o[1]), A.mul(lin, A.translate(-p[0], -p[1])));
}
function warpNodeWith(L, n, f){
  const b = K.shapeBounds(n, q => q, false);
  const eps = b ? Math.max(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.05, 0.5) : 0.5;
  const nearM = () => b ? affineNear(f, K.center(b), eps) : null;
  if (K.isLeaf(n)){
    const m = nearM();
    if (!VecSel.ensureBezier(null, n)) return;
    n.anchors = (n.anchors || []).map(a => { const p = f([a.x, a.y]); return Object.assign({}, a, {x:p[0], y:p[1], in:a.in ? f(a.in) : null, out:a.out ? f(a.out) : null}); });
    if (m && window.GradientFill){ GradientFill.transform(n.fill, m); GradientFill.transform(n.stroke, m); }
    delete n.bboxAngle;
    return;
  }
  if (K.isCont(n)){
    n.children.forEach(c => warpNodeWith(L, c, f));
    const m = nearM(); if (n.type === 'compound' && m && window.GradientFill){ GradientFill.transform(n.fill, m); GradientFill.transform(n.stroke, m); }
    delete n.bboxAngle;
    return;
  }
  const m = nearM(); if (m) K.xformNode(L, n, m, {strokes:false, corners:false});
}

/* ═════════════ puppet.rs：静止形状、图钉组 ═════════════ */
const MESH_OPT = expand => ({resolution:20, expand});
const meshOf = (nodes, expand) => { const o = outlinesOf(nodes); return o ? buildMesh(o.outlines, o.bounds, MESH_OPT(expand)) : null; };
const sameIds = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
const atRest = pins => pins.every(q => q.rest[0] === q.at[0] && q.rest[1] === q.at[1] && (q.angle === null || q.angle === undefined || q.angle === 0));
const solverPins = pins => pins.map(q => ({rest:q.rest, target:q.at, angle:(q.angle === null || q.angle === undefined) ? null : q.angle}));
function currentNodes(L, ids){ const out = []; for (const id of ids){ const h = K.findDeep(L, id); if (!h) return null; out.push(h.s); } return out; }
/* puppet.rs:81-88 rest_and_pins → {rest:[物件], pins:[…]|null} */
function restAndPins(L, ids){
  const cur = currentNodes(L, ids); if (!cur) return null;
  const P = L.data.puppet;
  if (P && sameIds(P.ids, ids)){
    const holds = P.result && P.result.length === ids.length && cur.every((n, i) => JSON.stringify(n) === P.result[i]);   // doc/puppet.rs:36 holds
    if (holds) return {rest:P.rest, pins:clone(P.pins)};
    return {rest:cur, pins:P.pins.map(q => ({rest:q.at.slice(), at:q.at.slice(), angle:(q.angle === null || q.angle === undefined) ? null : 0}))};
  }
  return {rest:cur, pins:null};
}
/* puppet.rs:103-145 PinSet */
function pinSet(L, ids, expand){
  const rp = restAndPins(L, ids); if (!rp) return null;
  const mesh = meshOf(rp.rest, expand); if (!mesh) return null;
  const auto = !rp.pins;
  const pins = rp.pins || defaultPins(mesh).map(p => ({rest:p, at:p.slice(), angle:null}));
  const warped = !atRest(pins);
  const deformed = warped ? deform(mesh, solverPins(pins)) : mesh.verts.map(v => v.slice());
  return {
    L, ids:ids.slice(), pins, auto, mesh, deformed, warped,
    restOf(q){ return this.warped ? this.mesh.unmap(this.deformed, q) : (this.mesh.contains(q) ? q.slice() : null); },
    turnOf(i){ const q = this.pins[i]; if (!q) return 0; if (q.angle !== null && q.angle !== undefined) return q.angle; const t = this.mesh.turnAt(this.deformed, q.rest); return t === null ? 0 : t; },
    /* object.puppetWarp 参数（文件坐标） */
    params(pins, ex){
      const D = q => [q[0] + L.x, q[1] + L.y];
      return {rest:true, layerId:L.id, ids:this.ids.slice(), pins:pins.map(q => D(q.rest)), moved:pins.map(q => D(q.at)),
              angles:pins.map(q => (q.angle === null || q.angle === undefined) ? null : q.angle * 180 / Math.PI), expand:ex};
    }
  };
}
/* puppet.rs:150-171 warp_from_rest（图层坐标）→ 错误字串或 null */
function warpFromRest(L, ids, pins, expand){
  const rp = restAndPins(L, ids); if (!rp) return 'nothing to warp';
  let rest;
  if (!pins.length) rest = currentNodes(L, ids).map(clone);
  else {
    const mesh = meshOf(rp.rest, expand); if (!mesh) return 'nothing to warp';
    const bad = pins.findIndex(q => !mesh.contains(q.rest));
    if (bad >= 0) return `pin ${bad} is off the artwork (outside its mesh)`;
    const def = deform(mesh, solverPins(pins)), f = q => mesh.map(def, q);
    rest = rp.rest.map(clone);
    ids.forEach((id, i) => {
      const n = clone(rest[i]); warpNodeWith(L, n, f);
      const h = K.findDeep(L, id); if (h) h.arr[h.idx] = n;
    });
  }
  const result = currentNodes(L, ids); if (!result) return 'the artwork is gone';
  L.data.puppet = {ids:ids.slice(), rest, result:result.map(n => JSON.stringify(n)), pins:clone(pins)};
  Layer.invalidate(L);
  return null;
}

/* ═════════════ 工具（puppet.rs:173-523）═════════════ */
const TURN_REACH_PX = 24, TURN_RING_PX = 16, WARN = '#d93f3f';
const ses = K.makeSession();
const PW = {
  ids: [], selected: [], drag: null, start: null, hover: null, offMesh: null,
  showMesh: true, expand: 3, _cache: null, ses,
  selObjs(){
    if (!window.VecSel) return null;
    VecSel.prune();
    const L = VecSel.layer(); if (!L || L.kind !== 'vector' || !L.visible) return null;
    const ids = VecSel.shapes.filter(id => K.findDeep(L, id));
    return ids.length ? {L, ids} : null;
  },
  /* 选取上的图钉（快取：物件、图钉、Expand 没变就不重算） */
  pins(){
    const S = this.selObjs(); if (!S) return null;
    const key = JSON.stringify([S.L.id, S.ids, currentNodes(S.L, S.ids), S.L.data.puppet || null, this.expand]);
    if (this._cache && this._cache.key === key) return this._cache;
    const set = pinSet(S.L, S.ids, this.expand); if (!set) return null;
    this._cache = {key, set};
    return this._cache;
  },
  sync(){ const S = this.selObjs(), ids = S ? S.ids : []; if (!sameIds(ids, this.ids)){ this.ids = ids.slice(); this.selected = []; } },
  pinAt(set, p){
    const tol = VecSel.tol(7); let best = -1, bd = Infinity;
    set.pins.forEach((q, i) => { const d = dist(q.at, p); if (d <= tol && d < bd){ bd = d; best = i; } });
    return best;
  },
  turnPinAt(set, p){
    if (this.pinAt(set, p) >= 0) return -1;
    const reach = VecSel.tol(TURN_REACH_PX); let best = -1, bd = Infinity;
    for (const i of this.selected){ const q = set.pins[i]; if (!q) continue; const d = dist(q.at, p); if (d <= reach && d < bd){ bd = d; best = i; } }
    return best;
  },
  targetsOf(set, g){
    return set.pins.map((q, i) => {
      const r = {rest:q.rest.slice(), at:q.at.slice(), angle:q.angle};
      if (g.k === 'move' && this.selected.includes(i)) r.at = add(r.at, sub(g.to, g.from));
      if (g.k === 'turn' && g.pin === i) r.angle = g.base + g.angle;
      return r;
    });
  },
  apply(set, pins){ const r = CMD.run('puppetwarp.warp', set.params(pins, this.expand)); this.notify(); return r; },
  pick(i, shift){
    const k = this.selected.indexOf(i);
    if (shift){ if (k >= 0){ this.selected.splice(k, 1); return false; } this.selected.push(i); return true; }
    if (k >= 0) return true;
    this.selected = [i]; return true;
  },
  notify(){ this.sync(); const c = this.pins(), n = c ? c.set.pins.length : 0; this.selected = this.selected.filter(i => i < n); },
  local(L, pt){ return [pt[0] - L.x, pt[1] - L.y]; },
  busy(){ return !!this.drag; },
  cancel(){ ses.cancel(); this.drag = null; this.start = null; },

  down(e, pt){
    this.sync(); this.offMesh = null;
    const c = this.pins();
    if (!c){
      const h = K.hitTest(pt, VecSel.tol(3));                         // 点物件＝选它（顶层物件），图钉马上出现
      if (h){ CMD.run('groupselect.select' in CMD.map ? 'groupselect.select' : 'direct.select', {ids:[h.chain[0].id], layerId:h.L.id}); this.notify(); }
      return;
    }
    const set = c.set, L = set.L, p = this.local(L, pt);
    if (e.altKey){
      const i = this.turnPinAt(set, p);
      if (i >= 0){
        if (window.Locks && Locks.deny(L, 'position')) return;
        const q = set.pins[i];
        this.drag = {k:'turn', pin:i, base:set.turnOf(i), from:Math.atan2(p[1] - q.at[1], p[0] - q.at[0]), angle:0};
        this.start = c; ses.begin(L); return;
      }
    }
    const i = this.pinAt(set, p);
    if (i >= 0){
      if (!this.pick(i, !!e.shiftKey)) return;
      if (window.Locks && Locks.deny(L, 'position')) return;
      this.drag = {k:'move', from:p, to:p};
      this.start = c; ses.begin(L); return;
    }
    const rest = set.restOf(p);
    if (rest){
      const pins = set.pins.map(q => ({rest:q.rest.slice(), at:q.at.slice(), angle:q.angle}));
      pins.push({rest, at:p.slice(), angle:null});
      this.pick(pins.length - 1, !!e.shiftKey);
      this.apply(set, pins);
    } else {
      this.offMesh = pt.slice();                                       // 网格外：钉不了（提示）
      if (!e.shiftKey) this.selected = [];
    }
  },
  move(e, pt){
    this.hover = {p:pt.slice(), alt:!!e.altKey};
    if (this.offMesh && dist(this.offMesh, pt) > VecSel.tol(6)) this.offMesh = null;
    const g = this.drag, c = this.start; if (!g || !c) return;
    const p = this.local(c.set.L, pt);
    if (g.k === 'move') g.to = p;
    else { const q = c.set.pins[g.pin]; if (!q) return; g.angle = Math.atan2(p[1] - q.at[1], p[0] - q.at[0]) - g.from; }
    ses.preview('puppetwarp.warp', c.set.params(this.targetsOf(c.set, g), this.expand));
    UI.draw();
  },
  up(){
    if (!this.drag) return;
    this.drag = null; this.start = null;
    ses.commit(); this.notify();
  },
  claimsKey(e){
    if (!(e.key === 'Delete' || e.key === 'Backspace') || this.drag) return false;
    const S = this.selObjs(); if (!S || !sameIds(S.ids, this.ids)) return false;
    const c = this.pins(); return !!c && this.selected.some(i => i < c.set.pins.length);
  },
  key(e){
    if (e.key === 'Escape' && this.drag){ e.preventDefault(); this.cancel(); return true; }
    if (!this.claimsKey(e)) return false;
    e.preventDefault();
    const c = this.pins(), gone = this.selected; this.selected = [];
    this.apply(c.set, c.set.pins.filter((q, i) => !gone.includes(i)));
    return true;
  },
  cursor(pt, alt){
    const c = this.pins(); if (!c || !pt) return 'default';
    const p = this.local(c.set.L, pt);
    if (alt && this.turnPinAt(c.set, p) >= 0) return (typeof ROT_CURSOR !== 'undefined') ? ROT_CURSOR : 'alias';
    if (this.pinAt(c.set, p) >= 0) return 'move';
    if (c.set.restOf(p)) return 'crosshair';
    return 'not-allowed';
  },
  syncCursor(pt, e){ if (window.UI && UI.canvas && ToolState.cur === 'puppetwarp') UI.canvas.style.cursor = this.cursor(pt, e && e.altKey); },
  drawOverlay(ctx, s){
    K.Draw.selection(ctx, s);
    const c = this.pins(), dp = K.Draw.dpr(s);
    ctx.save(); ctx.setLineDash([]);
    if (c){
      const set = c.set, L = set.L, X = q => (q[0] + L.x) * s, Y = q => (q[1] + L.y) * s;
      if (this.showMesh){
        ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 0.5 * dp; ctx.beginPath();
        for (const t of set.mesh.tris){ const [a, b, cc] = t.map(i => set.deformed[i] || set.mesh.verts[i]); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.lineTo(X(cc), Y(cc)); ctx.closePath(); }
        ctx.stroke();
      }
      const r = 5 * dp, same = sameIds(this.selObjs() ? this.selObjs().ids : [], this.ids);
      set.pins.forEach((q, i) => {
        const sel = this.selected.includes(i) && same;
        ctx.strokeStyle = BLUE; ctx.lineWidth = (sel ? 3 : 1.5) * dp;
        ctx.beginPath(); ctx.arc(X(q.at), Y(q.at), r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = sel ? BLUE : '#fff'; ctx.beginPath(); ctx.arc(X(q.at), Y(q.at), 1.5 * dp, 0, Math.PI * 2); ctx.fill();
      });
      let ring = -1;
      if (this.drag && this.drag.k === 'turn') ring = this.drag.pin;
      else if (!this.drag && this.hover && this.hover.alt) ring = this.turnPinAt(set, this.local(L, this.hover.p));
      if (ring >= 0 && set.pins[ring]){
        const q = set.pins[ring]; ctx.strokeStyle = BLUE; ctx.lineWidth = dp; ctx.setLineDash([3*dp, 3*dp]);
        ctx.beginPath(); ctx.arc(X(q.at), Y(q.at), TURN_RING_PX * dp, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (this.offMesh) K.Draw.label(ctx, s, this.offMesh, T('ui.pwOffMesh'), WARN);
    ctx.restore();
  }
};
window.PuppetWarpTool = PW;
window.PuppetKit = {Band, buildMesh, deform, defaultPins, outlinesOf, meshOf, pinSet, restAndPins, warpFromRest, warpNodeWith, fitAngle};

/* ═════════════ 命令（distortcmds.rs:68-82、637-680）═════════════ */
function ptsOf(v){ if (!Array.isArray(v)) return null; const out = v.map(K.pt2); return out.every(Boolean) ? out : null; }
CMD.reg('puppetwarp.warp', {i18n:'', undoable:true,
  params:'{ids?|id?（缺省＝选取）, pins:[[x,y]…]（图钉现在的位置）, moved:[[x,y]…]（要拉到哪，长度同 pins）, angles?:[度|null…]（同长：图稿绕那根图钉转多少，null＝不锁）, expand?=3（扩展网格，点）, rest?:bool, layerId?}（文件坐标） ' +
         '照 object.puppetWarp：尽量刚性（ARAP）网格变形锚点与把手。rest:true＝操控变形工具的图钉：pins 是图钉在「起始形状」上的位置（puppetwarp.pins 读得到），每根都要在网格上；' +
         '变形从起始形状重算（不叠加），图钉跟文件一起存、随 Undo 走；空清单＝拿掉全部图钉、图稿保持现状 → {ok, ids}'}, p => {
  p = p || {};
  const C = 'puppetwarp.warp';
  const pins = ptsOf(p.pins), moved = ptsOf(p.moved), rest = !!p.rest;
  if (!pins) return {ok:false, error:C + ': pins must be [[x,y]…]'};
  if (!moved) return {ok:false, error:C + ': moved must be [[x,y]…]'};
  if ((!pins.length && !rest) || pins.length !== moved.length) return {ok:false, error:C + ': pins and moved must be non-empty lists of the same length'};
  const L = K.vLayer(p); if (!L) return {ok:false, error:C + ': not a vector layer'};
  let ids;
  if (Array.isArray(p.ids) && p.ids.length) ids = p.ids.slice();
  else if (p.id) ids = [p.id];
  else ids = rest ? ((VecSel.layerId === L.id) ? VecSel.shapes.filter(id => K.findDeep(L, id)) : []) : K.roots(L, null).map(s => s.id);
  if (!ids.length) return {ok:false, error:'select the artwork to warp'};
  if (!ids.every(id => K.findDeep(L, id))) return {ok:false, error:C + ': no such object'};
  const ex = Math.max(0, Math.min(1000, fin(+p.expand) && p.expand !== null && p.expand !== '' ? +p.expand : 3));
  let angles;
  if (p.angles === undefined || p.angles === null) angles = pins.map(() => null);
  else if (Array.isArray(p.angles) && p.angles.length === pins.length) angles = p.angles.map(a => (a !== null && fin(+a)) ? +a * Math.PI / 180 : null);
  else return {ok:false, error:C + ': angles must be a list as long as pins (degrees or null)'};
  const g = K.guard(L, 'position', C); if (g) return g;
  const loc = q => [q[0] - L.x, q[1] - L.y];
  if (rest){
    const P = pins.map((r, i) => ({rest:loc(r), at:loc(moved[i]), angle:angles[i]}));
    const err = warpFromRest(L, ids, P, ex);
    return err ? {ok:false, error:C + ': ' + err} : {ok:true, ids};
  }
  const nodes = currentNodes(L, ids), mesh = meshOf(nodes, ex); if (!mesh) return {ok:false, error:'nothing to warp'};
  const def = deform(mesh, pins.map((r, i) => ({rest:loc(r), target:loc(moved[i]), angle:angles[i]}))), f = q => mesh.map(def, q);
  nodes.forEach(n => warpNodeWith(L, n, f));
  Layer.invalidate(L);
  return {ok:true, ids};
});
CMD.reg('puppetwarp.pins', {i18n:'',
  params:'{ids?|id?（缺省＝选取）, expand?=3, layerId?} → {ids, pins, moved, angles, expand, rest:true, auto} 图稿上的操控变形图钉（文件坐标）：pins＝在起始形状上的位置、moved＝现在的位置、angles＝锁住的转角（度，null＝自由）；' +
         'auto＝还没钉过（工具自动给的：中心＋每条肢体末端）。改 moved／angles（或增删图钉）再丢回 puppetwarp.warp'}, p => {
  p = p || {};
  const L = K.vLayer(p); if (!L) return {ok:false, error:'puppetwarp.pins: not a vector layer'};
  const ids = (Array.isArray(p.ids) && p.ids.length) ? p.ids : p.id ? [p.id] : ((VecSel.layerId === L.id) ? VecSel.shapes.filter(id => K.findDeep(L, id)) : []);
  if (!ids.length) return {ok:false, error:'select the artwork to warp'};
  const ex = Math.max(0, Math.min(1000, fin(+p.expand) ? +p.expand : 3));
  const set = pinSet(L, ids, ex); if (!set) return {ok:false, error:'nothing to warp'};
  return Object.assign({ok:true}, set.params(set.pins, ex), {auto:set.auto});
});
CMD.reg('puppetwarp.options', {i18n:'',
  params:'{showMesh?:bool, expand?:点（0..1000，0 可以）, selectAllPins?:bool（false＝全部取消选取）} 操控变形工具列；不给＝只读 → {showMesh, expand, pins:[[x,y]…]（文件坐标）, selected:[索引…]}'}, p => {
  p = p || {};
  if (p.showMesh !== undefined) PW.showMesh = !!p.showMesh;
  if (p.expand !== undefined && p.expand !== null && fin(+p.expand) && typeof p.expand !== 'boolean') PW.expand = Math.max(0, Math.min(1000, +p.expand));
  const c = PW.pins();
  if (p.selectAllPins !== undefined){ PW.sync(); const n = c ? c.set.pins.length : 0; PW.selected = p.selectAllPins === false ? [] : [...Array(n).keys()]; }
  if (window.UI) UI.draw();
  const L = c ? c.set.L : null;
  return {ok:true, showMesh:PW.showMesh, expand:PW.expand, pins:c ? c.set.pins.map(q => [q.at[0] + L.x, q.at[1] + L.y]) : [], selected:PW.selected.slice()};
});
CMD.reg('puppetwarp.selectPins', {i18n:'', params:'{indices:[索引…]} 选这几根图钉（＝点图钉／Shift 点；之后 Delete 删、拖一根全部一起动）→ {ok, selected}'}, p => {
  p = p || {};
  PW.sync(); const c = PW.pins(), n = c ? c.set.pins.length : 0;
  PW.selected = (Array.isArray(p.indices) ? p.indices : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < n);
  if (window.UI) UI.draw();
  return {ok:true, selected:PW.selected.slice()};
});

const PW_STRINGS = {
  'zh-Hant':{'ui.puppetwarpHint':'選取圖稿就出現圖釘 · 點圖稿＝加圖釘 · 拖圖釘＝彎曲（Shift 點＝多選一起拖）· Alt＋拖選中圖釘旁邊＝繞它旋轉 · Delete 刪選中圖釘',
             'opt.pwShowMesh':'顯示網紋', 'opt.pwExpand':'擴展網紋', 'ui.pwSelectAll':'選取全部圖釘', 'ui.pwOffMesh':'圖釘要放在圖稿上'},
  'zh-Hans':{'ui.puppetwarpHint':'选中图稿就出现图钉 · 点图稿＝加图钉 · 拖图钉＝变形（Shift 点＝多选一起拖）· Alt＋拖选中图钉旁边＝绕它旋转 · Delete 删选中图钉',
             'opt.pwShowMesh':'显示网格', 'opt.pwExpand':'扩展网格', 'ui.pwSelectAll':'选择全部图钉', 'ui.pwOffMesh':'图钉要放在图稿上'},
  'en':{'ui.puppetwarpHint':'Select art and its pins appear · click the art to add a pin · drag a pin to warp (Shift-click to select several) · Alt-drag near a selected pin to turn the art around it · Delete removes the selected pins',
        'opt.pwShowMesh':'Show Mesh', 'opt.pwExpand':'Expand Mesh', 'ui.pwSelectAll':'Select All Pins', 'ui.pwOffMesh':'Pins go on the artwork'}
};
if (typeof Lang !== 'undefined') Lang.add(PW_STRINGS);

Tools.reg({
  id:'puppetwarp', group:'vector', order:67, for:'vector', opts:[], cursor:'default', hint:'ui.puppetwarpHint',
  onDown(e, pt){ PW.down(e, pt); PW.syncCursor(pt, e); UI.draw(); },
  onMove(e, pt){ PW.move(e, pt); PW.syncCursor(pt, e); if (!PW.drag) UI.draw(); },
  onUp(e, pt){ PW.up(e, pt); PW.syncCursor(pt, e); UI.draw(); },
  onKey(e){ const r = PW.key(e); if (r) UI.draw(); return r; },
  onDeactivate(){ if (PW.drag){ PW.drag = null; PW.start = null; ses.commit(); } PW.selected = []; PW.hover = null; PW.offMesh = null; PW._cache = null; },   // puppet.rs:513-522：拖到一半换工具＝Commit
  buildOptions(box, add, mk){
    const cb = mk('checkbox', {checked:PW.showMesh}); cb.onchange = () => CMD.run('puppetwarp.options', {showMesh:cb.checked}); add('pwShowMesh', cb);
    const n = document.createElement('input'); n.type = 'number'; n.min = 0; n.max = 1000; n.step = 1; n.value = PW.expand; n.style.width = '56px';
    n.onchange = () => { CMD.run('puppetwarp.options', {expand:parseFloat(n.value)}); n.value = PW.expand; }; add('pwExpand', n);
    const b = document.createElement('button'); b.textContent = T('ui.pwSelectAll'); b.onclick = () => CMD.run('puppetwarp.options', {selectAllPins:true}); box.appendChild(b);
  },
  drawOverlay(ctx, s){ PW.drawOverlay(ctx, s); }
});
})();
