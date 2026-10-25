/* 磁性套索（PS 版面 ps.lasso-magnetic）——原码没有·照 PS 2020 写
   PhotoCraft 的 enum Tool 只有套索／多边形套索，没有磁性套索 ⇒ 照 Photoshop 2020 的实际行为：
     · 按一下放下第一个「紧固点」，之后不用按着、移动滑鼠，边界线就自己贴着游标附近最明显的边走（按着拖也一样）
     · 宽度（1..256 px，预设 10）：只在游标这么远以内找边；对比度（1..100%，预设 10%）：比这弱的边不理；频率（0..100，预设 57）：多快自动放紧固点（0＝不自动放）
     · 按一下＝手动放一个紧固点；Backspace／Delete＝退掉上一个紧固点（退光＝取消）；Esc＝取消
     · 闭合：按回起点、按两下、或 Enter（最后一段也走磁性边）；Alt+按两下＝最后一段用直线闭合
     · 途中按住 Alt：Alt+按一下＝多边形直线段、Alt+按着拖＝手绘段（暂时换成多边形套索／套索），放开 Alt 回到磁性
     · 起手那一下的 Shift／Alt／Shift+Alt＝添加／减去／交叉；否则看选项栏四钮（跟选框、套索共用一份：MarqueeTool.opt 的 mode／feather／antiAlias）
     · [ ／ ]＝宽度 −1／+1；Caps Lock 开着＝游标画成宽度圆圈（PS 的「精确光标」）
     · 「使用绘图板压力以更改钢笔宽度」（选项栏笔形钮，预设关）：开着时绘图笔压得越重、找边宽度越窄
       （有效宽度＝max(1, round(宽度 ×(1 − 0.9×压力)))；只认 pointerType＝pen 的 PointerEvent.pressure，滑鼠不算；笔悬空压力 0＝原宽度）
   找边：取当前像素层（层被移动过照样按文件坐标对齐，铁律④；不是像素层＝合成图）的颜色梯度（Sobel、RGB 三通道合成，step 0→1 的硬边＝1.0），
         沿「上个紧固点 → 游标附近最强的边点」在宽度走廊里跑最短路（Dijkstra，8 邻；越强的边越便宜，弱于对比度的不算边）——经典的 Intelligent Scissors／Live-wire 做法。
   闭合后的多边形交给套索的 lasso.select（同一套奇偶填满、消除锯齿、羽化、模式合成）。
   🔴 改文件的事全走 CMD：magneticlasso.select（进历史）；magneticlasso.pointer（agent 送同一串滑鼠／按键事件）、magneticlasso.trace（只算贴边路径、不改文件）、magneticlasso.options。 */
(function(){
'use strict';

const MODES = ['replace', 'add', 'subtract', 'intersect'];
const CLOSE_PX = 8;             // 回到起点这么多萤幕点内＝闭合（同多边形套索 canvas.rs:2077）
const DASH = 4;
const own = {mode:0, feather:0, antiAlias:true};
const shared = () => (window.MarqueeTool && MarqueeTool.opt) || own;
function selectionMode(bar, m){
  if (m.shift && m.alt) return 'intersect';
  if (m.shift) return 'add';
  if (m.alt) return 'subtract';
  return MODES[Math.min(3, Math.max(0, bar | 0))];
}

/* ═══════════ 找边 ═══════════ */
function samplePixels(all){
  const L = Doc.active(), W = Doc.width, H = Doc.height;
  if (!all && L && L.kind === 'raster' && L.data && L.data.ctx) return L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), W, H).data;
  return composite(1).getContext('2d').getImageData(0, 0, W, H).data;
}
/* 梯度：透明叠中灰（同 SmartSeg）→ 每通道 Sobel/4 → √(Σ通道²/3)。硬边 0→1 ＝ 1.0，对比 c 的边 ≈ c */
function edgeMap(src, W, H){
  const rgb = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++){ const a = src[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) rgb[i * 3 + c] = src[i * 4 + c] / 255 * a + 0.5 * (1 - a); }
  const g = new Float32Array(W * H);
  const at = (x, y, c) => rgb[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3 + c];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    let s = 0;
    for (let c = 0; c < 3; c++){
      const gx = (at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c)) - (at(x - 1, y - 1, c) + 2 * at(x - 1, y, c) + at(x - 1, y + 1, c));
      const gy = (at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c)) - (at(x - 1, y - 1, c) + 2 * at(x, y - 1, c) + at(x + 1, y - 1, c));
      s += (gx * gx + gy * gy) / 16;
    }
    g[y * W + x] = Math.sqrt(s / 3);
  }
  return {W, H, g};
}
const pix = pt => [Math.floor(pt[0]), Math.floor(pt[1])];
const ctr = q => [q[0] + 0.5, q[1] + 0.5];
/* 游标宽度圆内最强的边点（弱于对比度＝没有 ⇒ null）；一样强取离游标近的 */
function snapEdge(E, pt, width, thr){
  const [cx, cy] = pix(pt), R = Math.max(1, width);
  let best = null, bv = -Infinity;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(E.H - 1, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(E.W - 1, Math.ceil(cx + R)); x++){
      const d = Math.hypot(x - cx, y - cy); if (d > R) continue;
      const v = E.g[y * E.W + x]; if (v < thr) continue;
      const score = v - d * 1e-4;
      if (score > bv){ bv = score; best = [x, y]; }
    }
  return best;
}
/* Live-wire：from→to（像素格）在「离 from–to 线段 ≤ 宽度+2」的走廊里最短路；格的花费＝0.02＋(1−边强度/走廊最强)，弱于对比度＝边强度 0 */
function liveWire(E, from, to, width, thr){
  const clampP = q => [Math.min(E.W - 1, Math.max(0, q[0])), Math.min(E.H - 1, Math.max(0, q[1]))];
  from = clampP(from); to = clampP(to);
  if (from[0] === to[0] && from[1] === to[1]) return [from];
  const R = Math.max(1, width) + 2;
  const x0 = Math.max(0, Math.min(from[0], to[0]) - R), y0 = Math.max(0, Math.min(from[1], to[1]) - R);
  const x1 = Math.min(E.W - 1, Math.max(from[0], to[0]) + R), y1 = Math.min(E.H - 1, Math.max(from[1], to[1]) + R);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
  const dx = to[0] - from[0], dy = to[1] - from[1], len2 = dx * dx + dy * dy;
  const ok = new Uint8Array(n), cost = new Float32Array(n);
  let gmax = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const X = x + x0, Y = y + y0, t = Math.min(1, Math.max(0, ((X - from[0]) * dx + (Y - from[1]) * dy) / len2));
    if (Math.hypot(from[0] + t * dx - X, from[1] + t * dy - Y) <= R){ ok[y * w + x] = 1; const v = E.g[Y * E.W + X]; if (v >= thr && v > gmax) gmax = v; }
  }
  for (let i = 0; i < n; i++) if (ok[i]){
    const v = E.g[((i / w) | 0) * E.W + y0 * E.W + (i % w) + x0];
    cost[i] = 0.02 + (1 - (v >= thr && gmax > 0 ? Math.min(1, v / gmax) : 0));
  }
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const s = (from[1] - y0) * w + (from[0] - x0), goal = (to[1] - y0) * w + (to[0] - x0);
  dist[s] = 0;
  const hd = [0], hv = [s];
  const push = (d, v) => { let i = hd.length; hd.push(d); hv.push(v); while (i > 0){ const p = (i - 1) >> 1; if (hd[p] <= hd[i]) break; [hd[p], hd[i]] = [hd[i], hd[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const d = hd[0], v = hv[0], ld = hd.pop(), lv = hv.pop(); if (hd.length){ hd[0] = ld; hv[0] = lv; let i = 0; for (;;){ const l = 2 * i + 1, r = l + 1; let m = i; if (l < hd.length && hd[l] < hd[m]) m = l; if (r < hd.length && hd[r] < hd[m]) m = r; if (m === i) break; [hd[m], hd[i]] = [hd[i], hd[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [d, v]; };
  while (hd.length){
    const [d, u] = pop(); if (done[u]) continue; done[u] = 1; if (u === goal) break;
    const ux = u % w, uy = (u / w) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++){
      if (!ox && !oy) continue;
      const vx = ux + ox, vy = uy + oy; if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
      const v = vy * w + vx; if (!ok[v] || done[v]) continue;
      const nd = d + (ox && oy ? Math.SQRT2 : 1) * 0.5 * (cost[u] + cost[v]);
      if (nd < dist[v]){ dist[v] = nd; prev[v] = u; push(nd, v); }
    }
  }
  if (prev[goal] < 0) return [from, to];
  const out = []; for (let v = goal; v >= 0; v = prev[v]) out.push([(v % w) + x0, ((v / w) | 0) + y0]);
  return out.reverse();
}
const pathLen = p => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
/* 压感 → 有效宽度（PS「增加光笔压力会使边缘宽度减小」） */
const pressureWidth = (w, pr) => (pr === null || pr === undefined || !isFinite(+pr)) ? w : Math.max(1, Math.round(w * (1 - 0.9 * Math.min(1, Math.max(0, +pr)))));
/* 频率 → 自动紧固点间距（文件像素）：0＝不自动；57（预设）≈ 38 px；100＝每 4 px */
const spacingOf = f => f <= 0 ? Infinity : 4 + (100 - Math.min(100, f)) * 0.8;

/* ═══════════ 工具状态 ═══════════ */
const ML = window.MagneticLassoTool = {
  opt: {width:10, contrast:10, frequency:57, penPressure:false},
  pressure: null,  // 最近一次绘图笔压力（滑鼠＝null）
  active: false,
  pts: [],        // 已定的边界点（像素格，整数）；最后一点＝目前的紧固点
  anchors: [],    // 紧固点在 pts 里的索引（Backspace 用）
  live: [],       // 目前紧固点 → 游标的贴边路径（不含起点）
  press: {shift:false, alt:false},
  E: null, btn: false, alt: null, hover: null, held: {shift:false, alt:false},
  thr(){ return this.opt.contrast / 100; },
  /* 有效宽度：开了压感且有笔压 ⇒ 按压力缩窄 */
  width(){ return this.opt.penPressure ? pressureWidth(this.opt.width, this.pressure) : this.opt.width; },
  setPressure(m){ if (m && m.pressure !== undefined) this.pressure = (m.pressure === null || !isFinite(+m.pressure)) ? null : Math.min(1, Math.max(0, +m.pressure)); },
  zoom(){ return Math.max((window.UI && UI.zoom) || 1, 0.01); },
  anchor(){ return this.pts[this.pts.length - 1]; },
  reset(){ this.active = false; this.pts = []; this.anchors = []; this.live = []; this.E = null; this.btn = false; this.alt = null; },
  target(pt){ return snapEdge(this.E, pt, this.width(), this.thr()) || pix(pt); },
  /* 游标移动：贴边路径跟着走；路径长过间距就沿路自动放紧固点 */
  update(pt){
    if (!this.active) return;
    const tg = this.target(pt), sp = spacingOf(this.opt.frequency);
    let path = liveWire(this.E, this.anchor(), tg, this.width(), this.thr());
    for (let guard = 0; guard < 64 && pathLen(path) > sp; guard++){
      let acc = 0, k = path.length - 1;
      for (let i = 1; i < path.length; i++){ acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc >= sp){ k = i; break; } }
      if (k <= 0 || k >= path.length - 1) break;
      for (let i = 1; i <= k; i++) this.pts.push(path[i]);
      this.anchors.push(this.pts.length - 1);
      path = liveWire(this.E, this.anchor(), tg, this.width(), this.thr());
    }
    this.live = path.slice(1);
  },
  commitLive(){ for (const q of this.live) this.pts.push(q); this.live = []; if (this.anchors[this.anchors.length - 1] !== this.pts.length - 1) this.anchors.push(this.pts.length - 1); },
  start(pt, m){
    this.reset();
    this.E = edgeMap(samplePixels(false), Doc.width, Doc.height);
    this.active = true; this.press = {shift:!!m.shift, alt:!!m.alt};
    this.pts = [this.target(pt)]; this.anchors = [0];
  },
  nearStart(pt){ const p0 = this.pts[0]; return p0 && this.pts.length + this.live.length >= 3 && Math.hypot(p0[0] + 0.5 - pt[0], p0[1] + 0.5 - pt[1]) < CLOSE_PX / this.zoom(); },
  /* 按下（滑鼠与 pointer 命令共用） */
  down(pt, m){
    this.btn = true; this.hover = pt; this.setPressure(m);
    if (!this.active){ this.start(pt, m); return null; }
    if (m.alt){                                             // Alt：暂时多边形／手绘
      this.live = []; this.pts.push(pix(pt)); this.anchors.push(this.pts.length - 1); this.alt = {moved:false}; return null;
    }
    if (this.nearStart(pt)) return this.close(true);       // 按回起点＝闭合
    this.update(pt); this.commitLive(); return null;       // 手动紧固点
  },
  move(pt, m){
    this.hover = pt; this.setPressure(m);
    if (!this.active) return;
    if (this.btn && this.alt){                              // Alt+拖＝手绘段
      const q = pix(pt), a = this.anchor();
      if (Math.hypot(q[0] - a[0], q[1] - a[1]) >= 1){ this.pts.push(q); this.alt.moved = true; }
      return;
    }
    this.update(pt);
  },
  up(pt){
    this.btn = false;
    if (this.alt){ if (this.anchors[this.anchors.length - 1] !== this.pts.length - 1) this.anchors.push(this.pts.length - 1); this.alt = null; }
  },
  /* 按两下：第二下按下已补了一个几乎同位置的点 ⇒ 先把尾巴上重复的去掉 */
  dbl(m){
    if (!this.active) return null;
    const tol = CLOSE_PX / this.zoom();
    while (this.anchors.length > 1){
      const a = this.pts[this.anchors[this.anchors.length - 1]], b = this.pts[this.anchors[this.anchors.length - 2]];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < tol){ this.anchors.pop(); this.pts.length = this.anchors[this.anchors.length - 1] + 1; } else break;
    }
    this.live = [];
    return this.close(!m.alt);
  },
  back(){
    if (!this.active) return;
    if (this.anchors.length <= 1){ this.reset(); return; }
    this.anchors.pop(); this.pts.length = this.anchors[this.anchors.length - 1] + 1;
    if (this.hover) this.update(this.hover); else this.live = [];
  },
  /* 闭合：magnetic＝最后一段贴边回起点；否则直线 */
  close(magnetic){
    if (!this.active) return null;
    if (magnetic && this.pts.length){
      this.commitLive();
      const seg = liveWire(this.E, this.anchor(), this.pts[0], this.width(), this.thr());
      for (let i = 1; i < seg.length - 1; i++) this.pts.push(seg[i]);
    } else this.commitLive();
    const poly = this.pts.map(ctr), press = this.press;
    this.reset();
    if (poly.length < 3) return null;
    const o = shared();
    return CMD.run('magneticlasso.select', {points:poly, mode:selectionMode(o.mode, press), antiAlias:o.antiAlias !== false, feather:o.feather || 0});
  },
  key(k){
    if (!this.active) return false;
    if (k === 'Enter'){ this.close(true); return true; }
    if (k === 'Escape'){ this.reset(); return true; }
    if (k === 'Backspace' || k === 'Delete'){ this.back(); return true; }
    return false;
  }
};

/* ═══════════ 命令 ═══════════ */
CMD.reg('magneticlasso.select', {i18n:'tool.magneticlasso', undoable:true,
  params:'{points:[[x,y]…] 文件坐标 ≥3 点（闭合多边形）, mode="replace|add|subtract|intersect"="replace", antiAlias=true, feather=0..1000 px} 磁性套索定案：跟套索的 lasso.select 同一套（奇偶填满、消除锯齿、羽化、跟现有选区合成，全空＝取消选择） → {ok, selected, selection}'},
  p => {
    const f = CMD.map['lasso.select'];
    if (!f) return {ok:false, error:'magneticlasso.select: lasso.select (tools/lasso.js) not loaded'};
    return f.run(p);
  });
CMD.reg('magneticlasso.trace', {i18n:'',
  params:'{from:[x,y], to:[x,y] 文件坐标, width?=选项宽度 px, contrast?=选项对比度 %, snapTo?=true（终点先吸到宽度内最强的边）, sampleAllLayers?=false} 只算一段磁性贴边路径、不改文件（给 agent 预看或自己组多边形） → {ok, path:[[x,y]…] 像素中心, snapped:[x,y]|null}'},
  p => {
    const a = p.from, b = p.to;
    if (!Array.isArray(a) || !Array.isArray(b)) return {ok:false, error:'magneticlasso.trace: needs from/to'};
    const width = isFinite(+p.width) && p.width !== undefined ? Math.min(256, Math.max(1, +p.width)) : ML.opt.width;
    const thr = (isFinite(+p.contrast) && p.contrast !== undefined ? Math.min(100, Math.max(1, +p.contrast)) : ML.opt.contrast) / 100;
    const E = edgeMap(samplePixels(p.sampleAllLayers === true), Doc.width, Doc.height);
    const s0 = snapEdge(E, [+a[0], +a[1]], width, thr) || pix([+a[0], +a[1]]);
    const sn = p.snapTo === false ? null : snapEdge(E, [+b[0], +b[1]], width, thr);
    const path = liveWire(E, s0, sn || pix([+b[0], +b[1]]), width, thr).map(ctr);
    return {ok:true, path, snapped:sn ? ctr(sn) : null};
  });
CMD.reg('magneticlasso.options', {i18n:'',
  params:'{width?=1..256 px（游标多远内找边，预设 10）, penPressure?=bool（使用绘图板压力以更改钢笔宽度，预设关）, contrast?=1..100 %（比这弱的边不理，预设 10）, frequency?=0..100（自动紧固点频率，0＝不自动，预设 57）, mode?=0..3 或 "replace|add|subtract|intersect", feather?=0..1000 px, antiAlias?=bool}（mode／feather／antiAlias 跟选框、套索共用） → 目前全部选项'},
  p => {
    const o = shared(), m = ML.opt, num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v)));
    if (p.width !== undefined && isFinite(+p.width)) m.width = num(p.width, 1, 256);
    if (p.contrast !== undefined && isFinite(+p.contrast)) m.contrast = num(p.contrast, 1, 100);
    if (p.frequency !== undefined && isFinite(+p.frequency)) m.frequency = num(p.frequency, 0, 100);
    if (p.mode !== undefined){ const i = typeof p.mode === 'string' ? MODES.indexOf(p.mode) : (p.mode | 0); if (i >= 0 && i <= 3) o.mode = i; }
    if (p.feather !== undefined && isFinite(+p.feather)) o.feather = Math.min(1000, Math.max(0, +p.feather));
    if (typeof p.antiAlias === 'boolean') o.antiAlias = p.antiAlias;
    if (typeof p.penPressure === 'boolean') m.penPressure = p.penPressure;
    if (window.UI && ToolState.cur === 'magneticlasso') UI.buildOptions('magneticlasso');
    return {width:m.width, penPressure:m.penPressure, contrast:m.contrast, frequency:m.frequency, mode:MODES[o.mode | 0], feather:o.feather || 0, antiAlias:o.antiAlias !== false};
  });
CMD.reg('magneticlasso.pointer', {i18n:'',
  params:'{events:[{kind:"down"|"move"|"up"|"dblclick"|"key", x, y 文件坐标, shift?, alt?, pressure?=0..1（绘图笔压力；选项 penPressure 开着才影响宽度；null＝滑鼠）, key?:"Enter"|"Escape"|"Backspace"}…]} 跟人拿滑鼠同一组手势：第一个 down 放起点（它的 shift/alt 定添加／减去／交叉）；move（不必按着）贴边走、自动放紧固点；' +
         '之后 down＝手动紧固点、down 在起点 8 萤幕点内＝闭合；alt+down＝直线点、alt 按着 move＝手绘；dblclick 闭合（alt＝直线闭合）；key Enter 闭合／Escape 取消／Backspace 退上一个紧固点 → {ok, active, points, anchors, selection}'},
  p => {
    for (const e of (Array.isArray(p.events) ? p.events : [])){
      const pt = [Number(e.x) || 0, Number(e.y) || 0], m = {shift:!!e.shift, alt:!!e.alt};
      if (e.pressure !== undefined) m.pressure = e.pressure;
      if (e.kind === 'down') ML.down(pt, m);
      else if (e.kind === 'move') ML.move(pt, m);
      else if (e.kind === 'up') ML.up(pt);
      else if (e.kind === 'dblclick') ML.dbl(m);
      else if (e.kind === 'key') ML.key(e.key);
    }
    if (window.UI) UI.draw();
    return {ok:true, active:ML.active, width:ML.width(), points:ML.pts.concat(ML.live).map(ctr), anchors:ML.anchors.map(i => ctr(ML.pts[i])), selection:Doc.sel};
  });

/* ═══════════ 画 ═══════════ */
function ants(ctx, pts, closed, dpr){
  if (pts.length < 2) return;
  ctx.save(); ctx.lineWidth = 1; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath();
  ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
}
function drawBadge(ctx, p, mode, dpr){
  if (mode === 'replace') return;
  const c = [p[0] + 30 * dpr, p[1] + 11 * dpr], h = 3.5 * dpr;
  let segs;
  if (mode === 'add') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]], [[c[0], c[1] - h], [c[0], c[1] + h]]];
  else if (mode === 'subtract') segs = [[[c[0] - h, c[1]], [c[0] + h, c[1]]]];
  else { const k = h * 0.8; segs = [[[c[0] - k, c[1] - k], [c[0] + k, c[1] + k]], [[c[0] - k, c[1] + k], [c[0] + k, c[1] - k]]]; }
  ctx.save();
  for (const [w, col] of [[3, 'rgba(0,0,0,0.78)'], [1.2, '#fff']]){ ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath(); segs.forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke(); }
  ctx.restore();
}

const STRINGS = {
  'zh-Hant':{'ui.mlNew':'新增選取範圍', 'ui.mlAdd':'增加至選取範圍  (Shift)', 'ui.mlSub':'從選取範圍中減去  (Alt)', 'ui.mlInt':'與選取範圍相交  (Shift+Alt)',
    'opt.mlFeather':'羽化', 'opt.mlAntiAlias':'消除鋸齒', 'opt.mlWidth':'寬度', 'opt.mlContrast':'對比', 'opt.mlFrequency':'頻率', 'ui.mlPressure':'使用繪圖板壓力以變更筆寬度',
    'ui.mlHint':'按一下開始，沿邊緣移動 · 按一下加固定點 · Backspace 刪上一個固定點 · 按兩下或 Enter 閉合（Alt+按兩下＝直線閉合） · Esc 取消 · 途中 Alt 按一下／拖曳＝直線／手繪 · [ ] 寬度'},
  'zh-Hans':{'ui.mlNew':'新选区', 'ui.mlAdd':'添加到选区  (Shift)', 'ui.mlSub':'从选区减去  (Alt)', 'ui.mlInt':'与选区交叉  (Shift+Alt)',
    'opt.mlFeather':'羽化', 'opt.mlAntiAlias':'消除锯齿', 'opt.mlWidth':'宽度', 'opt.mlContrast':'对比度', 'opt.mlFrequency':'频率', 'ui.mlPressure':'使用绘图板压力以更改钢笔宽度',
    'ui.mlHint':'单击开始，沿边缘移动 · 单击加紧固点 · Backspace 删上一个紧固点 · 双击或 Enter 闭合（Alt+双击＝直线闭合） · Esc 取消 · 途中 Alt 单击／拖动＝直线／手绘 · [ ] 宽度'},
  'en':{'ui.mlNew':'New selection', 'ui.mlAdd':'Add to selection  (Shift)', 'ui.mlSub':'Subtract from selection  (Alt)', 'ui.mlInt':'Intersect with selection  (Shift+Alt)',
    'opt.mlFeather':'Feather', 'opt.mlAntiAlias':'Anti-alias', 'opt.mlWidth':'Width', 'opt.mlContrast':'Contrast', 'opt.mlFrequency':'Frequency', 'ui.mlPressure':'Use tablet pressure to change pen width',
    'ui.mlHint':'Click to start, move along the edge  ·  click adds a fastening point  ·  Backspace removes the last one  ·  double-click or Enter closes (Alt+double-click: straight)  ·  Esc cancels  ·  Alt click/drag: straight/freehand  ·  [ ] width'}
};

Tools.reg({
  id:'magneticlasso', icon:'🧲', group:'select', order:22.5, for:'raster', opts:[], strings:STRINGS, ml:ML,
  onDown(e, pt){
    if (e.button !== undefined && e.button !== 0) return;
    ML.held = {shift:e.shiftKey, alt:e.altKey};
    ML.down(pt, {shift:e.shiftKey, alt:e.altKey, pressure:penPressure(e)}); UI.draw();
  },
  onMove(e, pt){
    ML.held = {shift:e.shiftKey, alt:e.altKey}; ML.caps = !!(e.getModifierState && e.getModifierState('CapsLock'));
    ML.move(pt, {alt:e.altKey, pressure:penPressure(e)}); UI.draw();
  },
  onUp(e, pt){ ML.up(pt); UI.draw(); },
  onDblClick(e){ ML.dbl({alt:e.altKey}); UI.draw(); },
  onKey(e){
    if (!e.ctrlKey && !e.metaKey && ML.key(e.key)){ UI.draw(); return true; }
    if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey){
      CMD.run('magneticlasso.options', {width:ML.opt.width + (e.key === '[' ? -1 : 1)});
      if (ML.active && ML.hover) ML.update(ML.hover);
      UI.draw(); return true;
    }
    return false;
  },
  onDeactivate(){ ML.reset(); ML.hover = null; },
  drawOverlay(ctx, s){
    const dpr = s / ML.zoom(), S = q => [q[0] * s, q[1] * s], sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
    const sel = Doc.sel;
    if (sel && sel.mask && window.SelMask){
      ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
      SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
      ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
    }
    if (ML.active){
      ants(ctx, ML.pts.concat(ML.live).map(q => S(ctr(q))), false, dpr);
      const h = 2.5 * dpr;
      ctx.save(); ctx.lineWidth = dpr;
      for (const i of ML.anchors){ const p = S(ctr(ML.pts[i])); ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - h, p[1] - h, 2 * h, 2 * h); ctx.strokeStyle = '#000'; ctx.strokeRect(p[0] - h - 0.5 * dpr, p[1] - h - 0.5 * dpr, 2 * h + dpr, 2 * h + dpr); }
      ctx.restore();
    }
    if (ML.hover){
      if (ML.caps){                                            // Caps Lock：精确光标＝宽度圆圈
        const c = S(ML.hover); ctx.save(); ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(c[0], c[1], ML.width() * s + 0.5 * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(c[0], c[1], ML.width() * s, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      drawBadge(ctx, S(ML.hover), selectionMode(shared().mode, ML.active ? ML.press : ML.held), dpr);
    }
  },
  /* PS 2020 选项栏：四个模式钮、羽化、消除锯齿、宽度、对比度、频率、压感笔钮（使用绘图板压力以更改钢笔宽度） */
  buildOptions(box, add, mk){
    const o = shared(), m = ML.opt, set = p => { CMD.run('magneticlasso.options', p); UI.draw(); };
    const btn = (txt, tipKey, on, fn, data) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = Lang.t(tipKey);
      b.style.cssText = `margin:0 1px;min-width:24px;cursor:pointer;${on ? 'background:#2f7fd8;color:#fff;' : ''}`;
      Object.assign(b.dataset, data || {}); b.onclick = fn; box.appendChild(b); return b;
    };
    [['□', 'ui.mlNew'], ['＋', 'ui.mlAdd'], ['−', 'ui.mlSub'], ['⧉', 'ui.mlInt']].forEach(([t, k], i) => btn(t, k, (o.mode | 0) === i, () => set({mode:i}), {mode:MODES[i]}));
    const numIn = (key, v, lo, hi, w) => { const n = mk('number', {min:lo, max:hi, step:1, value:v}); n.style.width = w; n.dataset.opt = key; n.onchange = () => set({[key]:+n.value}); return n; };
    add('mlFeather', numIn('feather', o.feather || 0, 0, 1000, '56px'));
    const aa = mk('checkbox', {checked:o.antiAlias !== false}); aa.dataset.opt = 'antiAlias'; aa.onchange = () => set({antiAlias:aa.checked}); add('mlAntiAlias', aa);
    add('mlWidth', numIn('width', m.width, 1, 256, '52px'));
    add('mlContrast', numIn('contrast', m.contrast, 1, 100, '52px'));
    add('mlFrequency', numIn('frequency', m.frequency, 0, 100, '52px'));
    btn('✒', 'ui.mlPressure', !!m.penPressure, () => set({penPressure:!m.penPressure}), {opt:'penPressure'});
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.mlHint'); box.appendChild(h);
  }
});

/* 绘图笔压力：只认 pointerType＝pen（滑鼠按着时浏览器给 0.5，不能当压力） */
function penPressure(e){ return e && e.pointerType === 'pen' && typeof e.pressure === 'number' ? e.pressure : null; }
/* 给自由钢笔（磁性的）等借用的找边算法（同一单 G 的 freeformpen.js 读） */
window.MagneticKit = {samplePixels, edgeMap, snapEdge, liveWire, pathLen, spacingOf, pressureWidth, penPressure, pix, ctr, CLOSE_PX};

/* 修饰键即时换标记（ui.js 按着 Alt 时不把键交给工具） */
const mod = e => {
  if (e.key !== 'Shift' && e.key !== 'Alt' && e.key !== 'CapsLock') return;
  ML.held = {shift:e.shiftKey, alt:e.altKey}; ML.caps = !!(e.getModifierState && e.getModifierState('CapsLock'));
  if (ToolState.cur !== 'magneticlasso') return;
  if (e.type === 'keydown' && e.key === 'Alt') e.preventDefault();
  if (window.UI) UI.draw();
};
window.addEventListener('keydown', mod, true); window.addEventListener('keyup', mod, true);
window.addEventListener('blur', () => { ML.held = {shift:false, alt:false}; });

})();
