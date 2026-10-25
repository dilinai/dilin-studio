/* 堤麟画板 · 网格工具（U）—— 照 ArtCraft VectorCraft 原码逐段翻译
   主体：vectorcraft/crates/tools/src/meshblend.rs（MeshTool：按下／拖曳／放开、叠画、游标、deactivate）
         vectorcraft/crates/tools/src/meshedit.rs （MeshEdit：focus／drag、hit（先焦点把手再网格点）、press／drag_to／release、叠画把手）
   命令：vectorcraft/crates/engine/src/cmd/live.rs（object.mesh.create／setPointColor／movePoint／addLine／deletePoint／expand，226-279 参数说明、1306-1472 正文）
   资料结构与几何：vectorcraft/crates/doc/src/live.rs（GradientMesh／MeshPoint 206-237、Coons 481-572、GradientMesh impl 578-1008、mesh_quad_nodes 1574）
   命中：vectorcraft/crates/doc/src/hit.rs（hit_leaf：路径＝描边／轮廓／填色；Mesh＝外框轮廓 tol 内或外框里面 171-177）
   着色：vectorcraft/crates/render/src/live.rs（mesh_level 77-80：每片细分 clamp(ceil(片宽像素/5), 2, 32)；draw_mesh 162-202：一小块一小块实色四边形、每块沿边外扩半个装置像素免接缝）

   🔴 网格资料存在 shape 上（图层坐标，跟其他形状一样）：
     { id, type:'mesh', fill:'none', stroke:'none', strokeWidth:0,
       mesh:{ rows, cols,                                 // rows×cols 片，(rows+1)×(cols+1) 个点
              points:[ {x, y, color:'#rrggbb', opacity:0..1,
                        handles:[[dx,dy],[dx,dy],[dx,dy],[dx,dy]]} …] } }   // 逐列（row-major）；handles＝相对点的位移：0 右(下一栏) 1 左 2 下(下一列) 3 上（live.rs:206-210 H_RIGHT…）
     原形状（rect／ellipse／star／polygon／path／line／bezier）建网格时就地换成 type:'mesh'（id 不变；他们 Node::new(n.id, NodeKind::Mesh(m)) 也丢掉原外观）。
   渲染：MeshRender.draw(ctx, shape, scale) —— engine.js 的 drawShape 认得 type:'mesh' 后叫它；
         engine 还没接上时，这颗工具选着的时候在 drawOverlay 里先把网格画上去（暂时的，engine 接上后自动不画）。 */
(function(){
  const H_RIGHT = 0, H_LEFT = 1, H_DOWN = 2, H_UP = 3;
  const FEEDBACK = '#4f9dff';                                         // meshblend.rs:21 FEEDBACK [0x4f,0x9d,0xff]
  const SIDE = 65;                                                    // live.rs:481

  /* ───────── 小向量 ───────── */
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const hyp = v => Math.hypot(v[0], v[1]);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ───────── 颜色（他们 Color 是 0..1 浮点；我们存 #rrggbb，算的时候换成 0..1）───────── */
  const _cc = document.createElement('canvas').getContext('2d');
  /* color_value：认得 CSS 颜色字串（#rgb、#rrggbb、rgb()、名字…）→ {rgb:[0..1×3], a}；认不得回 null（'none' 也是 null） */
  function parseColor(c){
    if (typeof c !== 'string' || !c.trim() || c === 'none') return null;
    _cc.fillStyle = '#000000'; _cc.fillStyle = c; const v1 = _cc.fillStyle;
    _cc.fillStyle = '#ffffff'; _cc.fillStyle = c; const v2 = _cc.fillStyle;
    if (v1 !== v2) return null;                                       // 两次结果不同＝没被接受
    let m = /^#([0-9a-f]{6})$/i.exec(v1);
    if (m){ const n = parseInt(m[1], 16); return {rgb:[(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255], a:1}; }
    m = /^rgba?\(([^)]+)\)$/i.exec(v1);
    if (m){ const p = m[1].split(',').map(s => parseFloat(s)); return {rgb:[p[0] / 255, p[1] / 255, p[2] / 255], a:p.length > 3 ? p[3] : 1}; }
    return null;
  }
  const hexCache = new Map();
  function rgbOf(hex){
    let v = hexCache.get(hex);
    if (!v){ const c = parseColor(hex); v = c ? c.rgb : [0, 0, 0]; if (hexCache.size > 4096) hexCache.clear(); hexCache.set(hex, v); }
    return v;
  }
  const hex2 = x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0');
  const toHex = rgb => '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);   // Color::to_hex
  const normHex = c => { const p = parseColor(c); return p ? toHex(p.rgb) : null; };
  /* lerp_color（blend.rs:35；RGB 对 RGB ＝ 逐分量线性） */
  const lerpRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /* ───────── 三次贝兹（kurbo CubicBez）───────── */
  function cubicAt(c, t){
    const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
    return [a * c.p0[0] + b * c.c1[0] + cc * c.c2[0] + d * c.p3[0], a * c.p0[1] + b * c.c1[1] + cc * c.c2[1] + d * c.p3[1]];
  }
  function cubicDeriv(c, t){
    const mt = 1 - t;
    return [3 * mt * mt * (c.c1[0] - c.p0[0]) + 6 * mt * t * (c.c2[0] - c.c1[0]) + 3 * t * t * (c.p3[0] - c.c2[0]),
            3 * mt * mt * (c.c1[1] - c.p0[1]) + 6 * mt * t * (c.c2[1] - c.c1[1]) + 3 * t * t * (c.p3[1] - c.c2[1])];
  }
  /* CubicBez::subsegment(t0..t1)：端点取曲线上的点，控制点沿导数 (t1−t0)/3 */
  function subseg(c, t0, t1){
    const p0 = cubicAt(c, t0), p3 = cubicAt(c, t1), s = (t1 - t0) / 3;
    return {p0, c1:add(p0, mul(cubicDeriv(c, t0), s)), c2:sub(p3, mul(cubicDeriv(c, t1), s)), p3};
  }

  /* ───────── GradientMesh（live.rs:584-1008）───────── 坐标一律图层坐标 */
  const GM = {
    idx(m, r, c){ return r * (m.cols + 1) + c; },
    isValid(m){ return !!m && m.rows >= 1 && m.cols >= 1 && Array.isArray(m.points) && m.points.length === (m.rows + 1) * (m.cols + 1); },
    pt(q){ return [q.x, q.y]; },
    h(q, k){ const v = q.handles && q.handles[k]; return v ? [+v[0] || 0, +v[1] || 0] : [0, 0]; },
    /* even_steps(n)：0, 1/n, …, 1（n 夹在 1..200） */
    evenSteps(n){ n = clamp(n | 0, 1, 200); const v = []; for (let i = 0; i <= n; i++) v.push(i / n); return v; },

    /* from_grid（live.rs:602-625）：曲面 s(u,v) 上的点；把手＝偏导数 × 到邻线距离的 1/3；边界朝外的把手留 0 */
    fromGrid(us, vs, s, color){
      const rows = vs.length - 1, cols = us.length - 1, eps = 1e-3, points = [];
      for (let r = 0; r < vs.length; r++){
        const v = vs[r];
        for (let c = 0; c < us.length; c++){
          const u = us[c], p = s(u, v);
          const ua = Math.max(u - eps, 0), ub = Math.min(u + eps, 1), va = Math.max(v - eps, 0), vb = Math.min(v + eps, 1);
          const dU = mul(sub(s(ub, v), s(ua, v)), 1 / (ub - ua));
          const dV = mul(sub(s(u, vb), s(u, va)), 1 / (vb - va));
          const hh = (d, from, to) => (to === undefined) ? [0, 0] : mul(d, (to - from) / 3);
          const handles = [hh(dU, u, us[c + 1]), hh(dU, u, c > 0 ? us[c - 1] : undefined), hh(dV, v, vs[r + 1]), hh(dV, v, r > 0 ? vs[r - 1] : undefined)];
          const [col, op] = color(r, c, p);
          points.push({x:p[0], y:p[1], color:col, opacity:op, handles});
        }
      }
      return {rows, cols, points};
    },
    /* for_path_with（live.rs:636-639）：外框在四个角切开成 Coons 面，每点取 colorAt(p) */
    forPathWith(geo, rows, cols, colorAt){
      const co = Coons.fromGeom(geo); if (!co) return null;
      return this.fromGrid(this.evenSteps(cols), this.evenSteps(rows), (u, v) => co.eval(u, v), (r, c, p) => colorAt(p));
    },
    /* for_path（live.rs:628-632）：全部点同一个底色，再按外观提亮 */
    forPath(geo, rows, cols, baseHex, appearance, highlight){
      const m = this.forPathWith(geo, rows, cols, () => [baseHex, 1]); if (!m) return null;
      this.highlight(m, appearance, highlight); return m;
    },
    /* highlight（live.rs:643-661）：flat 不变；center 越近中心越白；edge 越近边越白；最多 highlight % */
    highlight(m, appearance, highlight){
      const h = clamp(highlight / 100, 0, 1);
      for (let r = 0; r <= m.rows; r++) for (let c = 0; c <= m.cols; c++){
        const u = c / m.cols, v = r / m.rows;
        const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;      // 0 中心 … 1 边
        const w = appearance === 'center' ? (1 - d) * h : appearance === 'edge' ? d * h : 0;
        if (w > 0){ const q = m.points[this.idx(m, r, c)]; q.color = toHex(lerpRGB(rgbOf(q.color), [1, 1, 1], w)); }
      }
    },
    /* edge_u／edge_v（live.rs:664-672） */
    edgeU(m, r, c){
      const a = m.points[this.idx(m, r, c)], b = m.points[this.idx(m, r, c + 1)];
      return {p0:this.pt(a), c1:add(this.pt(a), this.h(a, H_RIGHT)), c2:add(this.pt(b), this.h(b, H_LEFT)), p3:this.pt(b)};
    },
    edgeV(m, r, c){
      const a = m.points[this.idx(m, r, c)], b = m.points[this.idx(m, r + 1, c)];
      return {p0:this.pt(a), c1:add(this.pt(a), this.h(a, H_DOWN)), c2:add(this.pt(b), this.h(b, H_UP)), p3:this.pt(b)};
    },
    /* eval（live.rs:675-685）：片 (r,c) 在 (u,v) 的 Coons 点 */
    eval(m, r, c, u, v){
      const t = cubicAt(this.edgeU(m, r, c), u), b = cubicAt(this.edgeU(m, r + 1, c), u);
      const l = cubicAt(this.edgeV(m, r, c), v), rr = cubicAt(this.edgeV(m, r, c + 1), v);
      const p00 = this.pt(m.points[this.idx(m, r, c)]), p10 = this.pt(m.points[this.idx(m, r, c + 1)]);
      const p01 = this.pt(m.points[this.idx(m, r + 1, c)]), p11 = this.pt(m.points[this.idx(m, r + 1, c + 1)]);
      const k = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
      return [0, 1].map(i => (1 - v) * t[i] + v * b[i] + (1 - u) * l[i] + u * rr[i] - (k[0] * p00[i] + k[1] * p10[i] + k[2] * p01[i] + k[3] * p11[i]));
    },
    /* color_at（live.rs:688-702）：四角双线性插色与不透明度 → [rgb, opacity] */
    colorAt(m, r, c, u, v){
      const q = [m.points[this.idx(m, r, c)], m.points[this.idx(m, r, c + 1)], m.points[this.idx(m, r + 1, c)], m.points[this.idx(m, r + 1, c + 1)]];
      const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
      const rgb = [0, 0, 0]; let op = 0;
      for (let k = 0; k < 4; k++){
        const cc = rgbOf(q[k].color);
        for (let i = 0; i < 3; i++) rgb[i] += cc[i] * w[k];
        op += (q[k].opacity === undefined ? 1 : +q[k].opacity) * w[k];
      }
      return [rgb, op];
    },
    /* quads(n)（live.rs:705-729）：每片切 n×n 小四边形，各取中心那点的颜色 */
    quads(m, n){
      if (!this.isValid(m)) return [];
      n = clamp(n | 0, 1, 64);
      const out = [], grid = new Array((n + 1) * (n + 1));
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++){
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid[j * (n + 1) + i] = this.eval(m, r, c, i / n, j / n);
        const g = (a, b) => grid[b * (n + 1) + a];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
          const [rgb, opacity] = this.colorAt(m, r, c, (i + 0.5) / n, (j + 0.5) / n);
          out.push({pts:[g(i, j), g(i + 1, j), g(i + 1, j + 1), g(i, j + 1)], rgb, opacity});
        }
      }
      return out;
    },
    /* outline（live.rs:732-758）：外框一圈的三次段（上→右→下(反)→左(反)） */
    outlineSegs(m){
      if (!this.isValid(m)) return [];
      const segs = [], rev = e => ({p0:e.p3, c1:e.c2, c2:e.c1, p3:e.p0});
      for (let c = 0; c < m.cols; c++) segs.push(this.edgeU(m, 0, c));
      for (let r = 0; r < m.rows; r++) segs.push(this.edgeV(m, r, m.cols));
      for (let c = m.cols - 1; c >= 0; c--) segs.push(rev(this.edgeU(m, m.rows, c)));
      for (let r = m.rows - 1; r >= 0; r--) segs.push(rev(this.edgeV(m, r, 0)));
      return segs;
    },
    /* 外框 → Path2D（S＝倍率，ox/oy＝先加的位移） */
    outlinePath(m, S, ox, oy){
      S = S || 1; ox = ox || 0; oy = oy || 0;
      const P = new Path2D(), X = q => (q[0] + ox) * S, Y = q => (q[1] + oy) * S, segs = this.outlineSegs(m);
      if (!segs.length) return P;
      P.moveTo(X(segs[0].p0), Y(segs[0].p0));
      for (const s of segs) P.bezierCurveTo(X(s.c1), Y(s.c1), X(s.c2), Y(s.c2), X(s.p3), Y(s.p3));
      P.closePath(); return P;
    },
    /* lines（live.rs:761-779）：全部列线与栏线 */
    lines(m){
      if (!this.isValid(m)) return [];
      const v = [];
      for (let r = 0; r <= m.rows; r++) for (let c = 0; c < m.cols; c++) v.push(this.edgeU(m, r, c));
      for (let c = 0; c <= m.cols; c++) for (let r = 0; r < m.rows; r++) v.push(this.edgeV(m, r, c));
      return v;
    },
    /* bounds（live.rs:782-786）：控制框（点与把手端） */
    bounds(m){
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of m.points || []){
        const ps = [this.pt(q)].concat([0, 1, 2, 3].map(k => add(this.pt(q), this.h(q, k))));
        for (const p of ps){ x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      }
      return isFinite(x0) ? {x0, y0, x1, y1} : null;
    },
    _hctx: null,
    hctx(){ return this._hctx || (this._hctx = document.createElement('canvas').getContext('2d')); },
    /* locate（live.rs:813-854）：p 在哪一片的 (u,v)；外框外回 null。先每片 17×17 粗找，再 12 轮四方向小步细修 */
    locate(m, p){
      if (!this.isValid(m)) return null;
      if (!this.hctx().isPointInPath(this.outlinePath(m), p[0], p[1], 'nonzero')) return null;   // winding(p) == 0
      const N = 16; let best = [Infinity, 0, 0, 0, 0];
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++)
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++){
          const u = i / N, v = j / N, d = d2(this.eval(m, r, c, u, v), p);
          if (d < best[0]) best = [d, r, c, u, v];
        }
      let [, r, c, u, v] = best, step = 0.5 / N;
      for (let k = 0; k < 12; k++){
        let improved = false;
        for (const [du, dv] of [[step, 0], [-step, 0], [0, step], [0, -step]]){
          const nu = clamp(u + du, 0, 1), nv = clamp(v + dv, 0, 1);
          if (d2(this.eval(m, r, c, nu, nv), p) < d2(this.eval(m, r, c, u, v), p)){ u = nu; v = nv; improved = true; }
        }
        if (!improved) step /= 2;
      }
      return [r, c, u, v];
    },
    /* point_near（live.rs:857-864）：tol 内最近的网格点（同距取前面那个） */
    pointNear(m, p, tol){
      let bi = null, bd = Infinity;
      (m.points || []).forEach((q, i) => { const d = dist(this.pt(q), p); if (d <= tol && d < bd){ bd = d; bi = i; } });
      return bi;
    },
    surfaceDu(m, r, c, u, v){ const e = 1e-3, a = Math.max(u - e, 0), b = Math.min(u + e, 1); return mul(sub(this.eval(m, r, c, b, v), this.eval(m, r, c, a, v)), 1 / (b - a)); },
    surfaceDv(m, r, c, u, v){ const e = 1e-3, a = Math.max(v - e, 0), b = Math.min(v + e, 1); return mul(sub(this.eval(m, r, c, u, b), this.eval(m, r, c, u, a)), 1 / (b - a)); },
    /* insert_row（live.rs:878-905）：在片列 r 的 v 处插一整列点；直边在 v 切开，新点的横把手＝等参线导数/3 */
    insertRow(m, r, v){
      const cols = m.cols; v = clamp(v, 0.01, 0.99);
      const row = [], ups = [];
      for (let c = 0; c <= cols; c++){
        const e = this.edgeV(m, r, c), l = subseg(e, 0, v), rr = subseg(e, v, 1);
        ups.push([sub(l.c1, l.p0), sub(rr.c2, rr.p3)]);
        const pc = Math.min(c, cols - 1), u = c === cols ? 1 : 0;
        const [rgb, opacity] = this.colorAt(m, r, pc, u, v);
        const right = c < cols ? mul(this.surfaceDu(m, r, c, 0, v), 1 / 3) : [0, 0];
        const left = c > 0 ? mul(this.surfaceDu(m, r, c - 1, 1, v), -1 / 3) : [0, 0];
        row.push({x:l.p3[0], y:l.p3[1], color:toHex(rgb), opacity, handles:[right, left, sub(rr.c1, rr.p0), sub(l.c2, l.p3)]});
      }
      ups.forEach(([down, up], c) => {
        const a = m.points[this.idx(m, r, c)], b = m.points[this.idx(m, r + 1, c)];
        a.handles = this.handlesOf(a); b.handles = this.handlesOf(b);
        a.handles[H_DOWN] = down; b.handles[H_UP] = up;
      });
      m.points.splice(this.idx(m, r + 1, 0), 0, ...row);
      m.rows += 1;
    },
    /* insert_col（live.rs:908-941）：在片栏 c 的 u 处插一整栏点 */
    insertCol(m, c, u){
      const rows = m.rows; u = clamp(u, 0.01, 0.99);
      const col = [];
      for (let r = 0; r <= rows; r++){
        const e = this.edgeU(m, r, c), l = subseg(e, 0, u), rr = subseg(e, u, 1);
        const pr = Math.min(r, rows - 1), v = r === rows ? 1 : 0;
        const [rgb, opacity] = this.colorAt(m, pr, c, u, v);
        const down = r < rows ? mul(this.surfaceDv(m, r, c, u, 0), 1 / 3) : [0, 0];
        const up = r > 0 ? mul(this.surfaceDv(m, r - 1, c, u, 1), -1 / 3) : [0, 0];
        col.push([{x:l.p3[0], y:l.p3[1], color:toHex(rgb), opacity, handles:[sub(rr.c1, rr.p0), sub(l.c2, l.p3), down, up]}, sub(l.c1, l.p0), sub(rr.c2, rr.p3)]);
      }
      const cols = m.cols, pts = [];
      col.forEach(([mp, right, left], r) => {
        for (let cc = 0; cc <= cols; cc++){
          const q = JSON.parse(JSON.stringify(m.points[r * (cols + 1) + cc])); q.handles = this.handlesOf(q);
          if (cc === c) q.handles[H_RIGHT] = right;
          if (cc === c + 1) q.handles[H_LEFT] = left;
          pts.push(q);
          if (cc === c) pts.push(JSON.parse(JSON.stringify(mp)));
        }
      });
      m.points = pts; m.cols += 1;
    },
    handlesOf(q){ return [0, 1, 2, 3].map(k => this.h(q, k)); },
    /* add_lines_at（live.rs:944-963）：网格工具点一下＝过那点加一列一栏；贴着既有线（<0.02 或 >0.98）就不加那条；回新点索引 */
    addLinesAt(m, p){
      const loc = this.locate(m, p); if (!loc) return null;
      const [r, c, u, v] = loc; let rr = r, cc = c;
      const rowNew = v > 0.02 && v < 0.98, colNew = u > 0.02 && u < 0.98;
      if (rowNew){ this.insertRow(m, r, v); rr = r + 1; } else if (v >= 0.98) rr = r + 1;
      if (colNew){ this.insertCol(m, c, u); cc = c + 1; } else if (u >= 0.98) cc = c + 1;
      return this.idx(m, rr, cc);
    },
    /* remove_point_lines（live.rs:966-1007）：Alt 点＝删过这点的内部列线／栏线（外框的线删不了）；上下（左右）两边接起来、把手各取 1/3 直线 */
    removePointLines(m, index){
      if (!(index >= 0 && index < m.points.length)) return false;
      let w = m.cols + 1;
      const r = Math.floor(index / w), c = index % w;
      let changed = false;
      if (r > 0 && r < m.rows){
        for (let cc = 0; cc < w; cc++){
          const A = m.points[this.idx(m, r - 1, cc)], B = m.points[this.idx(m, r + 1, cc)];
          A.handles = this.handlesOf(A); B.handles = this.handlesOf(B);
          A.handles[H_DOWN] = mul(sub(this.pt(B), this.pt(A)), 1 / 3);
          B.handles[H_UP] = mul(sub(this.pt(A), this.pt(B)), 1 / 3);
        }
        m.points.splice(r * w, w); m.rows -= 1; changed = true;
      }
      w = m.cols + 1;
      if (c > 0 && c < m.cols){
        for (let rr = 0; rr <= m.rows; rr++){
          const Lq = m.points[rr * w + c - 1], Rq = m.points[rr * w + c + 1];
          Lq.handles = this.handlesOf(Lq); Rq.handles = this.handlesOf(Rq);
          Lq.handles[H_RIGHT] = mul(sub(this.pt(Rq), this.pt(Lq)), 1 / 3);
          Rq.handles[H_LEFT] = mul(sub(this.pt(Lq), this.pt(Rq)), 1 / 3);
        }
        m.points = m.points.filter((_, k) => k % w !== c); m.cols -= 1; changed = true;
      }
      return changed;
    }
  };

  /* ───────── Coons 面（live.rs:483-572）：由封闭外框在离外接框四角最近处切成上／右／下／左四条边，各重取样成 65 点 ───────── */
  function resample(poly, m){
    if (!poly.length) return new Array(m).fill([0, 0]);
    if (poly.length === 1) return new Array(m).fill(poly[0]);
    const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
    const total = cum[cum.length - 1], out = []; let i = 0;
    for (let k = 0; k < m; k++){
      const s = m > 1 ? total * k / (m - 1) : 0;
      while (i + 2 < cum.length && cum[i + 1] < s) i++;
      const seg = Math.max(cum[i + 1] - cum[i], 1e-12);
      out.push(lerp(poly[i], poly[i + 1], clamp((s - cum[i]) / seg, 0, 1)));
    }
    return out;
  }
  /* 路径的段（锚点 in/out 为绝对坐标、null＝等于锚点；跟 _vecsel.js segment 同） */
  function geomSegs(g){
    const A = g.anchors || [], n = A.length, cnt = n < 2 ? 0 : (g.closed ? n : n - 1), out = [];
    for (let i = 0; i < cnt; i++){
      const a = A[i], b = A[(i + 1) % n];
      out.push({p0:[a.x, a.y], c1:a.out || [a.x, a.y], c2:b.in || [b.x, b.y], p3:[b.x, b.y]});
    }
    return out;
  }
  /* kurbo flatten 的替身：每段按「弦误差 ≤ tol」均分（误差 ≤ 0.75·|二阶差|·h²），点去重（> 1e-9） */
  function flattenGeom(g, tol){
    const S = geomSegs(g), pts = [];
    const push = p => { if (!pts.length || dist(pts[pts.length - 1], p) > 1e-9) pts.push(p); };
    if (g.anchors && g.anchors.length) push([g.anchors[0].x, g.anchors[0].y]);
    for (const c of S){
      const dd = Math.max(hyp(add(sub(c.p0, mul(c.c1, 2)), c.c2)), hyp(add(sub(c.c1, mul(c.c2, 2)), c.p3)));
      const n = clamp(Math.ceil(Math.sqrt(0.75 * dd / Math.max(tol, 1e-9))), 1, 1000);
      for (let k = 1; k <= n; k++) push(cubicAt(c, k / n));
    }
    return pts;
  }
  /* PathData::bounds（kurbo 紧框）：每段密取 64 点＋端点 */
  function geomBounds(g){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
    (g.anchors || []).forEach(a => take([a.x, a.y]));
    for (const c of geomSegs(g)) for (let k = 1; k < 64; k++) take(cubicAt(c, k / 64));
    return isFinite(x0) ? {x0, y0, x1, y1} : null;
  }
  const Coons = {
    make(top, right, bottom, left){
      const co = {top, right, bottom, left};
      co.eval = (u, v) => Coons.eval(co, u, v);
      return co;
    },
    rect(r){
      const line = (a, b) => { const v = []; for (let i = 0; i < SIDE; i++) v.push(lerp(a, b, i / (SIDE - 1))); return v; };
      const tl = [r.x0, r.y0], tr = [r.x1, r.y0], br = [r.x1, r.y1], bl = [r.x0, r.y1];
      return this.make(line(tl, tr), line(tr, br), line(bl, br), line(tl, bl));
    },
    /* from_path（live.rs:502-549）；geo＝{anchors, closed}（我们一条形状只有一个 subpath） */
    fromGeom(geo){
      if (!geo || !geo.anchors || geo.anchors.length < 2) return null;
      const r = geomBounds(geo); if (!r) return null;
      const tol = Math.max((r.x1 - r.x0) + (r.y1 - r.y0), 1e-6) / 2000;
      let poly = flattenGeom(geo, tol);
      if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < 1e-9) poly.pop();
      if (poly.length < 3) return this.rect(r);
      // y 朝下的顺时针（左上→右上→右下→左下）
      let area = 0;
      for (let i = 0; i < poly.length; i++){ const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
      if (area < 0) poly = poly.slice().reverse();
      const nearest = c => { let bi = 0, bd = Infinity; poly.forEach((p, i) => { const d = d2(p, c); if (d < bd){ bd = d; bi = i; } }); return bi; };
      const tl = nearest([r.x0, r.y0]), tr = nearest([r.x1, r.y0]), br = nearest([r.x1, r.y1]), bl = nearest([r.x0, r.y1]);
      const n = poly.length;
      const arc = (i, j) => { const v = [poly[i]]; let k = i; while (k !== j){ k = (k + 1) % n; v.push(poly[k]); } return v; };
      const top = resample(arc(tl, tr), SIDE), right = resample(arc(tr, br), SIDE);
      const bottom = resample(arc(br, bl), SIDE).reverse(), left = resample(arc(bl, tl), SIDE).reverse();
      return this.make(top, right, bottom, left);
    },
    /* sample（live.rs:553-557）：边上 u 处的点；超出两端沿端段直线延伸 */
    sample(side, u){
      const s = u * (side.length - 1), i = Math.min(Math.max(Math.floor(s), 0), side.length - 2);
      return lerp(side[i], side[i + 1], s - i);
    },
    /* eval（live.rs:560-566） */
    eval(co, u, v){
      const t = this.sample(co.top, u), b = this.sample(co.bottom, u), l = this.sample(co.left, v), rr = this.sample(co.right, v);
      const p00 = co.top[0], p10 = co.top[SIDE - 1], p01 = co.bottom[0], p11 = co.bottom[SIDE - 1];
      return [0, 1].map(i => (1 - v) * t[i] + v * b[i] + (1 - u) * l[i] + u * rr[i]
        - ((1 - u) * (1 - v) * p00[i] + u * (1 - v) * p10[i] + (1 - u) * v * p01[i] + u * v * p11[i]));
    }
  };

  /* ───────── 渐变填色取色（expand.rs:277 gradient_sampler 的简化版）─────────
     认渐变工具定的 fill 物件 {type:'linear'|'radial', stops:[{offset|pos|t, color, opacity?}…], x1,y1,x2,y2}（图层坐标；
     radial＝(x1,y1) 圆心、到 (x2,y2) 为半径）。端色延伸到两端外（the end colours continue past the ends）。 */
  function gradientSampler(f, bounds){
    const stops = (f.stops || []).map(s => Array.isArray(s) ? {t:+s[0], c:parseColor(s[1]), a:s[2]} : {t:+(s.offset !== undefined ? s.offset : s.pos !== undefined ? s.pos : s.t), c:parseColor(s.color), a:s.opacity})
      .filter(s => isFinite(s.t) && s.c).map(s => ({t:s.t > 1 ? s.t / 100 : s.t, rgb:s.c.rgb, a:s.a !== undefined ? +s.a : s.c.a}))
      .sort((a, b) => a.t - b.t);
    if (!stops.length) return () => ['#ffffff', 1];
    const b = bounds || {x0:0, y0:0, x1:1, y1:0};
    const x1 = f.x1 !== undefined ? +f.x1 : b.x0, y1 = f.y1 !== undefined ? +f.y1 : (b.y0 + b.y1) / 2;
    const x2 = f.x2 !== undefined ? +f.x2 : b.x1, y2 = f.y2 !== undefined ? +f.y2 : (b.y0 + b.y1) / 2;
    const param = f.type === 'radial'
      ? p => { const R = f.r !== undefined ? +f.r : Math.hypot(x2 - x1, y2 - y1); return R > 1e-9 ? Math.hypot(p[0] - x1, p[1] - y1) / R : 0; }
      : p => { const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy; return L2 > 1e-12 ? ((p[0] - x1) * dx + (p[1] - y1) * dy) / L2 : 0; };
    return p => {
      const t = param(p);
      if (t <= stops[0].t) return [toHex(stops[0].rgb), stops[0].a];
      const z = stops[stops.length - 1]; if (t >= z.t) return [toHex(z.rgb), z.a];
      for (let i = 1; i < stops.length; i++){
        const a = stops[i - 1], c = stops[i];
        if (t <= c.t){ const k = c.t - a.t > 1e-9 ? (t - a.t) / (c.t - a.t) : 1; return [toHex(lerpRGB(a.rgb, c.rgb, k)), a.a + (c.a - a.a) * k]; }
      }
      return [toHex(z.rgb), z.a];
    };
  }

  /* ───────── 渲染（render/src/live.rs:77-80、162-202）─────────
     MeshRender.draw(ctx, shape, scale)：ctx 已经平移到图层位移（renderLayer 做的），shape 坐标是图层坐标、乘 scale 画（铁律①：导出时按倍率重算）。 */
  const MeshRender = {
    /* mesh_level：每片约几装置像素宽 → 细分数 clamp(ceil(per/5), 2, 32) */
    level(m, boundsPx){ const per = boundsPx / Math.max(m.rows, m.cols, 1); return clamp(Math.ceil(per / 5), 2, 32); },
    draw(ctx, s, scale){
      const m = s && s.mesh; if (!GM.isValid(m)) return;
      const S = scale || 1;
      const b = GM.bounds(m); if (!b) return;
      const n = this.level(m, Math.max(b.x1 - b.x0, b.y1 - b.y0) * S);
      const quads = GM.quads(m, n), grow = 0.5;                       // grow＝半个装置像素（f.px*0.5；我们直接在装置像素里画）
      ctx.save();
      for (const q of quads){
        if (q.opacity <= 0) continue;
        ctx.beginPath();
        for (let i = 0; i < 4; i++){
          const p = q.pts[i];
          // 沿角上两条边往外推（细长的小块也会往横向长）
          let d = [0, 0];
          for (const nb of [q.pts[(i + 3) % 4], q.pts[(i + 1) % 4]]){ const e = sub(p, nb), l = hyp(e); if (l > 1e-12) d = add(d, mul(e, 1 / l)); }
          const x = p[0] * S + d[0] * grow, y = p[1] * S + d[1] * grow;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        const c = q.rgb.map(v => Math.round(clamp(v, 0, 1) * 255));
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${clamp(q.opacity, 0, 1)})`;
        ctx.fill();
      }
      ctx.restore();
    },
    /* SVG 导出用（svg export 照 expand_live：每片 8×8 实色四边形） → 一串 <polygon> */
    toSVG(s){
      const m = s && s.mesh; if (!GM.isValid(m)) return '';
      return GM.quads(m, 8).filter(q => q.opacity > 0).map(q => {
        const op = q.opacity < 1 ? ` fill-opacity="${+q.opacity.toFixed(4)}"` : '';
        return `  <polygon points="${q.pts.map(p => p.map(v => +v.toFixed(2)).join(',')).join(' ')}" fill="${toHex(q.rgb)}"${op}/>\n`;
      }).join('');
    },
    /* engine.js 的 drawShape 认不认得网格（engine 接上后就认得）——认得就不用工具叠画代画 */
    engineDraws(){ try { return /MeshRender/.test(String(window.drawShape)); } catch (e){ return false; } }
  };
  window.MeshRender = MeshRender;
  window.MeshMath = GM;

  /* ───────── 命令 ───────── */
  /* 由 id 找形状：给了 layerId 就只在那层找；没给就先找 VecSel 那层、再找当前层、再找全部矢量层（跟 direct.js dirFind 同） */
  function findShape(id, layerId){
    const tryL = L => (L && L.kind === 'vector') ? L.data.shapes.find(x => x.id === id) : null;
    if (layerId){ const L = Doc.byId(layerId), s = tryL(L); return s ? {L, s} : null; }
    for (const L of [VecSel.layer(), Doc.active()].concat(Doc.layers)){ const s = tryL(L); if (s) return {L, s}; }
    return null;
  }
  const num = v => (v === undefined || v === null || v === '' || !isFinite(+v)) ? null : +v;
  /* with_mesh（live.rs:1361-1377）：拿到 id 那个网格（不是网格就报错） */
  function withMesh(p, cmd){
    if (p.id === undefined || p.id === null) return {err:{ok:false, error:cmd + ': missing `id`'}};
    const f = findShape(p.id, p.layerId);
    if (!f) return {err:{ok:false, error:cmd + ': no such object ' + p.id}};
    if (f.s.type !== 'mesh' || !GM.isValid(f.s.mesh)) return {err:{ok:false, error:cmd + ': not a gradient mesh'}};
    return f;
  }
  /* index_param（live.rs:1390-1396）：要有、≥0、取整 */
  function indexParam(p, cmd){
    const i = num(p.index);
    if (i === null) return {err:{ok:false, error:cmd + ': missing `index`'}};
    if (i < 0) return {err:{ok:false, error:cmd + ': index must be ≥ 0'}};
    return {i:Math.floor(i)};
  }

  /* object.mesh.create（live.rs:1306-1357） */
  CMD.reg('mesh.create', {i18n:'', undoable:true,
    params:'{ids?:[shapeId…]（缺省＝矢量选取里的形状）, layerId?, rows?:1..50=4, cols?:1..50=4（也收 columns）, appearance?:"flat"|"center"|"edge"="flat", highlight?:0..100=100, at?:[x,y] 文件坐标} ' +
           '把路径（矩形／椭圆／星形／多边形／折线／钢笔路径）就地转成渐变网格（type:"mesh"，id 不变，原填色／描边丢掉）：每个点取原填色（渐变填色＝各点取渐变在那里的颜色；没填色＝白），' +
           'appearance center／edge＝越近中心／边缘越往白提亮，最多 highlight %；给了 at ＝先建 1×1 再过那点加一列一栏（网格工具点形状就是这样）。建完选取＝这些网格 → {ok, ids, index?（at 那点的点索引）, layerId}'}, p => {
    const C = 'mesh.create';
    const rows = num(p.rows) === null ? 4 : num(p.rows), cols = num(p.cols) !== null ? num(p.cols) : (num(p.columns) !== null ? num(p.columns) : 4);
    if (!(rows >= 1 && rows <= 50) || !(cols >= 1 && cols <= 50)) return {ok:false, error:C + ': rows and cols must be 1..50'};
    let app = 'flat';
    if (p.appearance !== undefined && p.appearance !== null){
      const a = String(p.appearance).toLowerCase();
      app = ({flat:'flat', center:'center', tocenter:'center', 'to center':'center', edge:'edge', toedge:'edge', 'to edge':'edge'})[a];
      if (!app) return {ok:false, error:C + ': appearance must be flat|center|edge'};
    }
    const highlight = clamp(num(p.highlight) === null ? 100 : num(p.highlight), 0, 100);
    const at = Array.isArray(p.at) && num(p.at[0]) !== null && num(p.at[1]) !== null ? [+p.at[0], +p.at[1]] : null;
    const R = at ? 1 : Math.floor(rows), Cc = at ? 1 : Math.floor(cols);
    // roots_param：给了 ids 就用 ids，否则用选取
    let L = p.layerId ? Doc.byId(p.layerId) : null, ids = Array.isArray(p.ids) ? p.ids.slice() : null;
    if (!ids){ L = L || VecSel.layer(); ids = (L && L.id === VecSel.layerId) ? VecSel.shapes.slice() : []; }
    const out = []; let index;
    for (const id of ids){
      const f = findShape(id, L ? L.id : undefined); if (!f) continue;
      const s = f.s, geo = VecSel.asBezier(s);                       // outline_of：路径才行（网格本身、认不得的种类跳过）
      if (!geo || !geo.anchors || geo.anchors.length < 2) continue;
      let m;
      if (s.fill && typeof s.fill === 'object'){                     // Paint::Gradient：各点取渐变在那里的颜色
        const sampler = gradientSampler(s.fill, geomBounds(geo));
        m = GM.forPathWith(geo, R, Cc, sampler); if (m) GM.highlight(m, app, highlight);
      } else {
        m = GM.forPath(geo, R, Cc, normHex(s.fill) || '#ffffff', app, highlight);   // p.color().unwrap_or(Color::WHITE)
      }
      if (!m) continue;
      if (at){ const i = GM.addLinesAt(m, VecSel.toLayer(f.L, at)); if (i !== null) index = i; }
      // Node::new(n.id, NodeKind::Mesh(m))：就地换掉（物件参照不变），只留 id 与名字
      const keep = {id:s.id}; if (s.name !== undefined) keep.name = s.name;
      Object.keys(s).forEach(k => { delete s[k]; });
      Object.assign(s, keep, {type:'mesh', fill:'none', stroke:'none', strokeWidth:0, mesh:m});
      Layer.invalidate(f.L);
      out.push({id:s.id, L:f.L});
    }
    if (!out.length) return {ok:false, error:C + ': select a path or compound path'};
    VecSel.setShapes(out[0].L.id, out.filter(o => o.L === out[0].L).map(o => o.id));   // sel.set(out)
    const r = {ok:true, ids:out.map(o => o.id), layerId:out[0].L.id};
    if (index !== undefined) r.index = index;
    return r;
  });

  /* object.mesh.setPointColor（live.rs:1398-1417） */
  CMD.reg('mesh.setPointColor', {i18n:'', undoable:true,
    params:'{id, index, color?, opacity?:0..1, layerId?} 改一个网格点的颜色／不透明度（两个至少给一个） → {ok}'}, p => {
    const C = 'mesh.setPointColor';
    const ix = indexParam(p, C); if (ix.err) return ix.err;
    const color = p.color !== undefined ? normHex(p.color) : null, op = num(p.opacity);
    if (color === null && op === null) return {ok:false, error:C + ': missing `color` or `opacity`'};
    const f = withMesh(p, C); if (f.err) return f.err;
    const q = f.s.mesh.points[ix.i]; if (!q) return {ok:false, error:C + ': index out of range'};
    if (color !== null) q.color = color;
    if (op !== null) q.opacity = clamp(op, 0, 1);
    Layer.invalidate(f.L); return {ok:true};
  });

  /* object.mesh.movePoint（live.rs:1419-1433） */
  CMD.reg('mesh.movePoint', {i18n:'', undoable:true,
    params:'{id, index, x, y 文件坐标, handle?:0 右|1 左|2 下|3 上, layerId?} 把网格点移到 (x,y)（它的把手跟着走）；给了 handle ＝ 把那支把手的端点放到 (x,y) → {ok}'}, p => {
    const C = 'mesh.movePoint';
    const ix = indexParam(p, C); if (ix.err) return ix.err;
    const x = num(p.x), y = num(p.y);
    if (x === null || y === null) return {ok:false, error:C + ': missing `x` or `y`'};
    let h = null;
    if (p.handle !== undefined && p.handle !== null){
      if (!(Number.isInteger(+p.handle) && +p.handle >= 0 && +p.handle <= 3)) return {ok:false, error:C + ': handle must be 0..3'};
      h = +p.handle;
    }
    const f = withMesh(p, C); if (f.err) return f.err;
    const q = f.s.mesh.points[ix.i]; if (!q) return {ok:false, error:C + ': index out of range'};
    const t = VecSel.toLayer(f.L, [x, y]);
    if (h === null){ q.x = t[0]; q.y = t[1]; }
    else { q.handles = GM.handlesOf(q); q.handles[h] = [t[0] - q.x, t[1] - q.y]; }
    Layer.invalidate(f.L); return {ok:true};
  });

  /* object.mesh.addLine（live.rs:1435-1447） */
  CMD.reg('mesh.addLine', {i18n:'', undoable:true,
    params:'{id, x, y 文件坐标, color?, layerId?} 过 (x,y) 给网格加一列一栏（贴着既有线就只加另一条）；新点颜色＝color（没给＝原地插出来的颜色） → {ok, index}'}, p => {
    const C = 'mesh.addLine';
    const x = num(p.x), y = num(p.y);
    if (x === null || y === null) return {ok:false, error:C + ': missing `x` or `y`'};
    const color = (p.color !== undefined && p.color !== null) ? normHex(p.color) : null;
    const f = withMesh(p, C); if (f.err) return f.err;
    const m = f.s.mesh, i = GM.addLinesAt(m, VecSel.toLayer(f.L, [x, y]));
    if (i === null) return {ok:false, error:C + ': point is outside the mesh'};
    if (color) m.points[i].color = color;
    Layer.invalidate(f.L); return {ok:true, index:i};
  });

  /* object.mesh.deletePoint（live.rs:1449-1456） */
  CMD.reg('mesh.deletePoint', {i18n:'', undoable:true,
    params:'{id, index, layerId?} 删掉过这个点的网格线（只有内部的列线／栏线删得掉；外框上的点报错） → {ok}'}, p => {
    const C = 'mesh.deletePoint';
    const ix = indexParam(p, C); if (ix.err) return ix.err;
    const f = withMesh(p, C); if (f.err) return f.err;
    if (!GM.removePointLines(f.s.mesh, ix.i)) return {ok:false, error:C + ': only interior mesh lines can be deleted'};
    if (MeshTool.focus && MeshTool.focus.id === f.s.id) MeshTool.focus = null;
    Layer.invalidate(f.L); return {ok:true};
  });

  /* object.mesh.expand（live.rs:1458-1472 ＋ doc live.rs:1574-1585 mesh_quad_nodes(m, 8)） */
  CMD.reg('mesh.expand', {i18n:'', undoable:true,
    params:'{ids?:[shapeId…]（缺省＝选中的网格）, layerId?} 把网格展开成一块块实色四边形（每片 8×8＝64 块，type:"path" 闭合、无描边、半透明点用 rgba 填色），放在原网格的位置；选取＝展开出来的块 → {ok, ids}'}, p => {
    const C = 'mesh.expand';
    let L = p.layerId ? Doc.byId(p.layerId) : null, ids = Array.isArray(p.ids) ? p.ids.slice() : null;
    if (!ids){ L = L || VecSel.layer(); ids = (L && L.id === VecSel.layerId) ? VecSel.shapes.slice() : []; }
    const metas = ids.map(id => findShape(id, L ? L.id : undefined)).filter(f => f && f.s.type === 'mesh' && GM.isValid(f.s.mesh));
    if (!metas.length) return {ok:false, error:C + ': select a gradient mesh'};
    const out = [];
    for (const {L: LL, s} of metas){
      const pieces = GM.quads(s.mesh, 8).map(q => {
        const c = q.rgb.map(v => Math.round(clamp(v, 0, 1) * 255));
        const fill = q.opacity >= 1 ? toHex(q.rgb) : `rgba(${c[0]},${c[1]},${c[2]},${+clamp(q.opacity, 0, 1).toFixed(4)})`;
        return {id:uid('S'), type:'path', points:q.pts.map(pt => [pt[0], pt[1]]), closed:true, fill, stroke:'none', strokeWidth:0};
      });
      const at = LL.data.shapes.indexOf(s);
      LL.data.shapes.splice(at, 1, ...pieces);
      Layer.invalidate(LL);
      pieces.forEach(x => out.push({id:x.id, L:LL}));
    }
    MeshTool.focus = null;
    VecSel.setShapes(out[0].L.id, out.filter(o => o.L === out[0].L).map(o => o.id));
    return {ok:true, ids:out.map(o => o.id)};
  });

  /* ───────── 工具（meshblend.rs MeshTool ＋ meshedit.rs MeshEdit）───────── */
  const MeshTool = {
    focus: null,       // MeshEdit.focus：{layerId, id, index}——最后点到的网格点（显示并能拖它的把手）
    drag: null,        // MeshEdit.drag：{layerId, id, index, handle|null}
    base: null, last: null,   // Begin／Preview／Commit
    opt: {rows:4, cols:4, appearance:'flat', highlight:100},   // 选项栏「建立网格」用（menus.rs:1636 Create Gradient Mesh 的预设）

    vecLayer(){ const L = Doc.active(); return (L && L.kind === 'vector' && L.visible) ? L : null; },
    /* MeshTool::meshes（meshblend.rs:151-166）：先选中的网格，再其余（最上层先） */
    meshes(L){
      if (!L) return [];
      const S = L.data.shapes.filter(s => s.type === 'mesh' && GM.isValid(s.mesh)), v = [];
      if (VecSel.layerId === L.id) for (const id of VecSel.shapes){ const s = S.find(x => x.id === id); if (s) v.push(s); }
      for (let i = S.length - 1; i >= 0; i--) if (!v.includes(S[i])) v.push(S[i]);
      return v;
    },
    focusShape(){
      const f = this.focus; if (!f) return null;
      const L = Doc.byId(f.layerId); if (!L || L.kind !== 'vector') return null;
      const s = L.data.shapes.find(x => x.id === f.id);
      return (s && s.type === 'mesh' && GM.isValid(s.mesh) && s.mesh.points[f.index]) ? {L, s, q:s.mesh.points[f.index]} : null;
    },
    /* MeshEdit::hit（meshedit.rs:47-61）：tol＝5 屏幕像素；先焦点那点的把手（长度 > 1e-6 的），再各网格的点 */
    hit(L, pt){
      if (!L) return null;
      const tol = VecSel.tol(5), p = VecSel.toLayer(L, pt), ms = this.meshes(L);
      const fs = this.focusShape();
      if (fs && fs.L === L && ms.includes(fs.s)){
        const q = fs.q;
        for (let h = 0; h < 4; h++){
          const hv = GM.h(q, h);
          if (hyp(hv) > 1e-6 && dist(add([q.x, q.y], hv), p) <= tol) return {layerId:L.id, id:fs.s.id, index:this.focus.index, handle:h};
        }
      }
      for (const s of ms){ const i = GM.pointNear(s.mesh, p, tol); if (i !== null) return {layerId:L.id, id:s.id, index:i, handle:null}; }
      return null;
    },
    /* hit_top（doc/hit.rs:60-180 由上往下第一个）：网格＝外框轮廓 tol 内或外框里面；路径＝看得见的描边（宽＋tol）或轮廓 tol 内、有填色且在里面 */
    hitTop(L, pt){
      if (!L) return null;
      const tol = VecSel.tol(3), p = VecSel.toLayer(L, pt), c = GM.hctx(), S = L.data.shapes;
      for (let k = S.length - 1; k >= 0; k--){
        const s = S[k];
        if (s.type === 'mesh'){
          if (!GM.isValid(s.mesh)) continue;
          const P = GM.outlinePath(s.mesh);
          c.lineWidth = 2 * tol; c.lineJoin = 'round'; c.lineCap = 'round';
          if (c.isPointInStroke(P, p[0], p[1]) || c.isPointInPath(P, p[0], p[1], 'nonzero')) return s;
          continue;
        }
        const g = VecSel.asBezier(s); if (!g || !g.anchors || !g.anchors.length) continue;
        const P = new Path2D(); bezierPath(P, g, 1);
        const sw = (s.stroke && s.stroke !== 'none') ? (+s.strokeWidth || 0) : 0;
        c.lineWidth = sw + 2 * tol; c.lineJoin = 'round'; c.lineCap = 'round';
        if (c.isPointInStroke(P, p[0], p[1])) return s;
        if (s.fill && s.fill !== 'none' && c.isPointInPath(P, p[0], p[1], 'nonzero')) return s;
      }
      return null;
    },

    /* ── Begin／Preview／Commit（跟 direct.js 同：Preview 回底稿再套一次命令、只上画面；放开时正式 CMD.run 一次＝一步历史）── */
    begin(L){ this.base = {L, shapes:JSON.parse(JSON.stringify(L.data.shapes))}; this.last = null; },
    resetToBase(){ const b = this.base; if (!b) return; b.L.data.shapes = JSON.parse(JSON.stringify(b.shapes)); Layer.invalidate(b.L); },
    preview(id, params){
      if (!this.base) return;
      this.resetToBase();
      try { CMD.map[id].run(params); } catch (err){ console.error(err); }
      this.last = {id, params}; UI.draw();
    },
    commit(){
      const last = this.last;
      if (this.base) this.resetToBase();
      this.base = null; this.last = null;
      if (last) CMD.run(last.id, last.params);
    },

    /* MeshEdit::press／drag_to／release／unfocus */
    press(g){ this.focus = {layerId:g.layerId, id:g.id, index:g.index}; this.drag = g; this.begin(Doc.byId(g.layerId)); },
    dragTo(pt){
      const g = this.drag; if (!g) return;
      const prm = {id:g.id, index:g.index, x:pt[0], y:pt[1], layerId:g.layerId};
      if (g.handle !== null) prm.handle = g.handle;
      this.preview('mesh.movePoint', prm);
    },
    release(){ if (!this.drag) return; this.drag = null; this.commit(); },
    unfocus(){ this.focus = null; },

    /* 点一下（meshblend.rs:180-213 的 Down 分支，拖曳以外的部分）——滑鼠与 agent（mesh.click）共用 */
    click(pt, alt, shift, color){
      const L = this.vecLayer(); if (!L) return {ok:false, error:'not a vector layer'};
      const g = this.hit(L, pt);
      if (g){
        if (alt && g.handle === null){                                // Alt 点网格点 ＝ 删点
          this.unfocus();
          return Object.assign({action:'deletePoint'}, CMD.run('mesh.deletePoint', {id:g.id, index:g.index, layerId:L.id}));
        }
        this.focus = {layerId:L.id, id:g.id, index:g.index};          // press：只是选上这点（不拖就不改文件）
        return {ok:true, action:'focus', id:g.id, index:g.index, handle:g.handle};
      }
      this.unfocus();
      const s = this.hitTop(L, pt); if (!s) return {ok:true, action:null};
      if (s.type === 'mesh'){                                          // 点网格里面 ＝ 加线；新点取当前填色（Shift ＝ 不取）
        const prm = {id:s.id, x:pt[0], y:pt[1], layerId:L.id};
        if (color && !shift) prm.color = color;
        const r = CMD.run('mesh.addLine', prm);
        if (r.ok) this.focus = null;
        return Object.assign({action:'addLine', id:s.id}, r);
      }
      // 点路径 ＝ 转成网格、过那点加线（object.mesh.create {ids:[id], at}）
      return Object.assign({action:'create'}, CMD.run('mesh.create', {ids:[s.id], at:[pt[0], pt[1]], layerId:L.id}));
    },

    down(e, pt){
      const L = this.vecLayer();
      const g = L ? this.hit(L, pt) : null;
      if (g && !(e.altKey && g.handle === null)){ this.press(g); return; }   // 网格点或焦点把手 ⇒ Begin("Move Mesh Point")
      CMD.run('mesh.click', {x:pt[0], y:pt[1], alt:!!e.altKey, shift:!!e.shiftKey});
    }
  };
  window.MeshTool = MeshTool;

  CMD.reg('mesh.click', {i18n:'',
    params:'{x, y 文件坐标, alt?, shift?, color?（缺省＝当前填色）} 网格工具点一下（跟滑鼠同一条路）：点到网格点＝选上那点（Alt＝删过它的网格线）；' +
           '点网格里面＝过那点加一列一栏、新点取 color（shift＝不取色、用插出来的颜色）；点路径＝转成网格并过那点加线。拖网格点／把手请用 mesh.movePoint → {ok, action:"focus"|"deletePoint"|"addLine"|"create"|null, …}'}, p => {
    const x = num(p.x), y = num(p.y);
    if (x === null || y === null) return {ok:false, error:'mesh.click: missing `x` or `y`'};
    let color = p.color !== undefined ? normHex(p.color) : null;
    if (p.color === undefined){ const f = window.UI ? UI.fill() : 'none'; color = normHex(f); }   // Paint::Solid 才有颜色
    return MeshTool.click([x, y], !!p.alt, !!p.shift, color);
  });
  CMD.reg('mesh.options', {i18n:'',
    params:'{rows?, cols?, appearance?:"flat"|"center"|"edge", highlight?} 选项栏「建立网格」用的预设（不改文件） → 现在的值'}, p => {
    const o = MeshTool.opt;
    if (num(p.rows) !== null) o.rows = clamp(Math.floor(+p.rows), 1, 50);
    if (num(p.cols) !== null) o.cols = clamp(Math.floor(+p.cols), 1, 50);
    if (['flat', 'center', 'edge'].includes(p.appearance)) o.appearance = p.appearance;
    if (num(p.highlight) !== null) o.highlight = clamp(+p.highlight, 0, 100);
    return Object.assign({ok:true}, o);
  });

  /* ── 游标（meshblend.rs:232-238）：网格点上＝移动（Alt＝删点笔）；其余＝加点笔。图形照 cursors.rs pen()（同 addanchor.js） ── */
  function penCursor(badge){
    const o = 2, P = (x, y) => `${x + o},${y + o}`;
    const ln = (a, b) => `<line x1="${a[0]+o}" y1="${a[1]+o}" x2="${b[0]+o}" y2="${b[1]+o}" stroke="#fff" stroke-width="3"/>` +
                         `<line x1="${a[0]+o}" y1="${a[1]+o}" x2="${b[0]+o}" y2="${b[1]+o}" stroke="#000" stroke-width="1.2"/>`;
    const poly = [P(0,0), P(4,12), P(8,16), P(16,8), P(12,4)].join(' ');
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
      `<polygon points="${poly}" fill="none" stroke="#fff" stroke-width="3"/>` +
      `<polygon points="${poly}" fill="#000" stroke="#000" stroke-width="1"/>` +
      `<circle cx="${6+o}" cy="${6+o}" r="1.4" fill="#fff"/>` + ln([10,14], [14,18]);
    const b = [16, 14];
    svg += ln([b[0], b[1]+3], [b[0]+6, b[1]+3]);
    if (badge === '+') svg += ln([b[0]+3, b[1]], [b[0]+3, b[1]+6]);
    svg += '</svg>';
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${o} ${o}, crosshair`;
  }
  const CUR_ADD = penCursor('+'), CUR_DEL = penCursor('-');
  MeshTool.CUR_ADD = CUR_ADD; MeshTool.CUR_DEL = CUR_DEL;
  let lastHover = null;
  function updateCursor(alt){
    if (!window.UI || !UI.canvas || ToolState.cur !== 'mesh') return;
    if (MeshTool.drag){ UI.canvas.style.cursor = 'move'; return; }
    const L = MeshTool.vecLayer(), g = (L && lastHover) ? MeshTool.hit(L, lastHover) : null;
    UI.canvas.style.cursor = g ? ((alt && g.handle === null) ? CUR_DEL : 'move') : CUR_ADD;
  }

  /* ── 叠画（meshblend.rs:219-231 ＋ meshedit.rs:95-105）── */
  function drawOverlay(ctx, s){
    VecSel.prune();
    // 暂时的：engine.js 还没认得 type:'mesh' 时，先在这里把各矢量层的网格画上（engine 接上后自动不画）
    if (!MeshRender.engineDraws()){
      for (const L of Doc.layers){
        if (L.kind !== 'vector' || !L.visible || L.opacity <= 0) continue;
        for (const sh of L.data.shapes){
          if (sh.type !== 'mesh') continue;
          ctx.save(); ctx.globalAlpha = L.opacity; ctx.translate(L.x * s, L.y * s); MeshRender.draw(ctx, sh, s); ctx.restore();
        }
      }
    }
    const L = VecSel.layer();
    ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeStyle = FEEDBACK;
    const X = (L0, p) => [(p[0] + L0.x) * s, (p[1] + L0.y) * s];
    const anchor = (p, filled, size) => {
      const h = size / 2; ctx.beginPath(); ctx.rect(p[0] - h, p[1] - h, size, size);
      ctx.fillStyle = filled ? FEEDBACK : '#fff'; ctx.fill(); ctx.strokeStyle = FEEDBACK; ctx.stroke();
    };
    if (L && L.visible){
      for (const id of VecSel.shapes){
        const sh = L.data.shapes.find(x => x.id === id); if (!sh || sh.type !== 'mesh' || !GM.isValid(sh.mesh)) continue;
        ctx.beginPath();
        for (const e of GM.lines(sh.mesh)){
          const a = X(L, e.p0), c1 = X(L, e.c1), c2 = X(L, e.c2), b = X(L, e.p3);
          ctx.moveTo(a[0], a[1]); ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1]);
        }
        ctx.strokeStyle = FEEDBACK; ctx.stroke();
        for (const q of sh.mesh.points) anchor(X(L, [q.x, q.y]), false, 5);
      }
    }
    // MeshEdit::overlays：焦点那点实心，长度 > 1e-6 的把手画线与端点
    const fs = MeshTool.focusShape();
    if (fs && fs.L.visible){
      const q = fs.q, P0 = X(fs.L, [q.x, q.y]);
      for (let k = 0; k < 4; k++){
        const hv = GM.h(q, k); if (hyp(hv) <= 1e-6) continue;
        const E = X(fs.L, add([q.x, q.y], hv));
        ctx.strokeStyle = FEEDBACK; ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.lineTo(E[0], E[1]); ctx.stroke();
        ctx.fillStyle = FEEDBACK; ctx.beginPath(); ctx.arc(E[0], E[1], 2.5, 0, Math.PI * 2); ctx.fill();
      }
      anchor(P0, true, 5);
    }
    ctx.restore();
  }

  /* 我们加的：网格点选上时，改填色（右面板的填色框）＝改那点的颜色（Illustrator 这样；原码没把 setPointColor 接到界面上） */
  function hookFill(){
    const el = document.getElementById('fillColor'); if (!el || el._meshHook) return;
    el._meshHook = true;
    el.addEventListener('change', () => {
      if (ToolState.cur !== 'mesh') return;
      const fs = MeshTool.focusShape(); if (!fs) return;
      CMD.run('mesh.setPointColor', {id:fs.s.id, index:MeshTool.focus.index, color:el.value, layerId:fs.L.id});
      UI.draw();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookFill); else hookFill();

  const S = {
    'zh-Hant':{'tool.mesh':'網格', 'ui.meshHint':'點形狀＝轉成漸層網格並過那點加線｜點網格裡面＝加一列一欄（新點取填色；Shift＝不取色）｜拖網格點／把手＝移動｜Alt＋點網格點＝刪過它的網格線｜選上網格點後改填色＝改那點的顏色',
               'opt.meshRows':'列', 'opt.meshCols':'欄', 'opt.meshAppearance':'外觀', 'opt.meshHighlight':'反白 %',
               'ui.meshFlat':'平坦', 'ui.meshCenter':'至中心', 'ui.meshEdge':'至邊緣', 'ui.meshCreate':'建立漸層網格', 'ui.meshExpand':'展開網格'},
    'zh-Hans':{'tool.mesh':'网格', 'ui.meshHint':'点形状＝转成渐变网格并过那点加线｜点网格里面＝加一列一栏（新点取填色；Shift＝不取色）｜拖网格点／把手＝移动｜Alt＋点网格点＝删过它的网格线｜选上网格点后改填色＝改那点的颜色',
               'opt.meshRows':'行', 'opt.meshCols':'列', 'opt.meshAppearance':'外观', 'opt.meshHighlight':'高光 %',
               'ui.meshFlat':'平淡色', 'ui.meshCenter':'至中心', 'ui.meshEdge':'至边缘', 'ui.meshCreate':'创建渐变网格', 'ui.meshExpand':'扩展网格'},
    'en':{'tool.mesh':'Mesh', 'ui.meshHint':'Click a shape to make it a gradient mesh with lines through the point | click inside a mesh to add a row and column (new point takes the fill colour; Shift: keep the blended colour) | drag a mesh point / handle to move it | Alt-click a mesh point to delete its lines | with a point selected, changing the fill colours it',
          'opt.meshRows':'Rows', 'opt.meshCols':'Columns', 'opt.meshAppearance':'Appearance', 'opt.meshHighlight':'Highlight %',
          'ui.meshFlat':'Flat', 'ui.meshCenter':'To Center', 'ui.meshEdge':'To Edge', 'ui.meshCreate':'Create Gradient Mesh', 'ui.meshExpand':'Expand Mesh'}
  };

  Tools.reg({
    id:'mesh', icon:'▦', key:'U', group:'vector', order:40, for:'vector', opts:[],
    cursor:CUR_ADD, hint:'ui.meshHint', strings:S,
    onDown(e, pt){ lastHover = pt; MeshTool.down(e, pt); updateCursor(!!e.altKey); UI.draw(); },
    onMove(e, pt, P){
      lastHover = pt;
      if (P.down && MeshTool.drag) MeshTool.dragTo(pt);                // PointerKind::Drag ⇒ Preview movePoint
      else updateCursor(!!e.altKey);
    },
    onUp(e, pt){ MeshTool.release(); updateCursor(!!e.altKey); UI.draw(); },   // PointerKind::Up ⇒ Commit
    onKey(e){ if (e.key === 'Alt') updateCursor(true); return false; },
    onKeyUp(e){ if (e.key === 'Alt') updateCursor(false); },
    /* deactivate（meshblend.rs:242-245）：忘掉焦点、拖到一半就提交 */
    onDeactivate(){ MeshTool.unfocus(); MeshTool.release(); },
    drawOverlay,
    /* 选项栏（我们加的）：他们「物件▸建立渐变网格…」对话框的四个栏位＋「展开」，因为我们没有物件菜单 */
    buildOptions(box, add, mk){
      const o = MeshTool.opt;
      const r = mk('number', {min:1, max:50, value:o.rows}); r.style.width = '46px'; r.onchange = () => CMD.run('mesh.options', {rows:+r.value}); add('meshRows', r);
      const c = mk('number', {min:1, max:50, value:o.cols}); c.style.width = '46px'; c.onchange = () => CMD.run('mesh.options', {cols:+c.value}); add('meshCols', c);
      const sel = document.createElement('select');
      [['flat', 'ui.meshFlat'], ['center', 'ui.meshCenter'], ['edge', 'ui.meshEdge']].forEach(([v, k]) => {
        const op = document.createElement('option'); op.value = v; op.textContent = Lang.t(k); if (o.appearance === v) op.selected = true; sel.appendChild(op);
      });
      sel.onchange = () => CMD.run('mesh.options', {appearance:sel.value}); add('meshAppearance', sel);
      const h = mk('number', {min:0, max:100, value:o.highlight}); h.style.width = '52px'; h.onchange = () => CMD.run('mesh.options', {highlight:+h.value}); add('meshHighlight', h);
      const btn = (k, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = Lang.t(k); b.dataset.meshBtn = k; b.onclick = fn; box.appendChild(b); };
      btn('ui.meshCreate', () => { CMD.run('mesh.create', {rows:o.rows, cols:o.cols, appearance:o.appearance, highlight:o.highlight}); UI.draw(); });
      btn('ui.meshExpand', () => { CMD.run('mesh.expand', {}); UI.draw(); });
    }
  });
})();
