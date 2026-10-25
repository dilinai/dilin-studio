/* 快速选择（W）——照 ArtCraft／PhotoCraft 的 Rust 原码逐段翻译
   对照源（photocraft/crates/…）：
     ui-egui/src/retouch_ui.rs  51-58        finish_stroke：收笔叫 select.quick（points、size＝共用笔刷直径、mode＝⌥ 减去否则增加、enhanceEdge、sampleAllLayers）
     ui-egui/src/retouch_ui.rs  194-201      选项栏：取样所有图层、增强边缘、「⌥ 减去」提示、「选择主体」钮
     ui-egui/src/tool_feedback.rs 41-51,95-100  selection_mode：快速选择永远是增加（⌥＝减去）；模式标记画在笔尖圈正中
     ui-egui/src/canvas.rs 214-216, 1601-1611, 1878-1886  笔尖圈游标（不画中心十字）、拖曳中半透明白色足迹（alpha 40）
     ui-egui/src/paint_mouse.rs 53 ＋ brush_resize.rs 1-80    跟笔刷一样收拖曳点；Ctrl+Alt 拖＝改笔刷直径／硬度
     engine/src/smartselect_cmds.rs 1-110, 220-232   with_sampler（当前层；没像素或 sampleAllLayers＝合成）、apply（找不到又是加／减＝选区与历史都不动）、quick_selection、ENHANCE 参数
     algo/src/segment/quick.rs  1-247        quick_select、segment、broad_model、stroke_mask、blur3、geodesic（测地距离当背景取样＋数据项）
     algo/src/segment/mod.rs    46-638       RgbImage（透明叠中灰、方框缩小）、scale_for、contrast_beta、grid_cut、data_costs、components／keep_seeded／clean_mask、
                                             antialias_u8、trim_region、finish_region／refine_band（192 块＋12 晕边全解析度重切）、Rng、subsample
     algo/src/segment/gmm.rs    1-254        高斯混合（k-means++、Lloyd、3 步 EM、refit、neg_log）
     algo/src/segment/maxflow.rs 1-363       Boykov–Kolmogorov 最大流／最小割
     algo/src/segment/grabcut.rs 1-118       GrabCut（对象选择用；放在这里的 SmartSeg 一起给 objectselect.js 读）
     algo/src/selection.rs      230-243, 365-404   Region、combine_region（只动区域外框；全空＝取消选择）
     algo/src/matting.rs        24-40, 373-440     增强边缘＝refine_mask(radius 4 智能、平滑 15、对比 25)——这段已由 menus/impl/ps-select.js 翻好（PsSelect.algo.refineMask），执行时借用，不改它
   ── 原码无·照 PS 2020 加：边拖边长 ──
     原码只在放开时叫一次 select.quick，拖曳中只画白色足迹。PS 是拖着就即时往外长、画面上蚂蚁线跟着变。照 PS 做：
     按下时记住旧选区与取样像素；拖曳中每收到新点就（节流：上次算花多久就至少隔多久、最少 60 ms）把「到目前为止整条笔画」跑同一个 quickSelect
     （同样的工作解析度 ⇒ 放开时提交的结果跟最后一次预览一致），跟旧选区按模式合成成「暂定选区」，画蚂蚁线；Doc.sel 与历史在放开前都不动，
     放开＝照旧 quickselect.select 一步进历史；Esc＝丢掉暂定。增强边缘只在放开时做（预览不跑，太慢）。agent 用 quickselect.live 拿同一份暂定结果（不改文件）。
   🔴 改文件的事全走 CMD：quickselect.select（＝select.quick，进历史）、quickselect.options（选项与笔刷大小）；quickselect.live 只算不改。
   分割演算法放 window.SmartSeg（objectselect.js 也读它；PsSelect 里那份是私有的，没露出来）。 */
(function(){
'use strict';

/* ═══════════════════════ SmartSeg：algo/src/segment/* 原样翻译 ═══════════════════════
   RgbImage = {w, h, px:Float32Array(w*h*3)}（0..1）；Rect = [x0, y0, x1, y1]；Region = {bbox:Rect, mask:Uint8Array(bw*bh)} */
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const rEmpty = r => r[2] <= r[0] || r[3] <= r[1];
const rInter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const rInflate = (a, m) => [a[0] - m, a[1] - m, a[2] + m, a[3] + m];
const rW = r => Math.max(0, r[2] - r[0]), rH = r => Math.max(0, r[3] - r[1]);
const d2i = (a, i, b, j) => { const x = a[i] - b[j], y = a[i + 1] - b[j + 1], z = a[i + 2] - b[j + 2]; return x * x + y * y + z * z; };

/* mod.rs RgbImage::from_rgba：straight RGBA → RGB，透明像素叠在中灰上（透明也是一种模型分得开的颜色） */
/* Sampler：src＝整张文件大小的 RGBA8（文件坐标）；读到文件外＝全 0（ImageSampler 同） */
function makeSampler(src, W, H){
  return {
    rgb(r){
      const w = rW(r), h = rH(r), px = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        const X = r[0] + x, Y = r[1] + y, o = (y * w + x) * 3;
        let R = 0, G = 0, B = 0, A = 0;
        if (X >= 0 && Y >= 0 && X < W && Y < H){ const s = (Y * W + X) * 4; R = src[s] / 255; G = src[s + 1] / 255; B = src[s + 2] / 255; A = src[s + 3] / 255; }
        const a = clamp01(A);
        px[o] = clamp01(R) * a + 0.5 * (1 - a); px[o + 1] = clamp01(G) * a + 0.5 * (1 - a); px[o + 2] = clamp01(B) * a + 0.5 * (1 - a);
      }
      return {w, h, px};
    },
    /* rgb_scaled：分条读再方框缩小——条的边界都对齐 step 的倍数，所以跟整块读再缩小结果一样。
       直接从 RGBA8 边读边平均（不先造整块全解析度的浮点图）；每格先 fround 成 f32 再加，跟 downsample(rgb(r)) 逐位一样，只是快 */
    rgbScaled(r, step){
      if (step <= 1) return this.rgb(r);
      const w = rW(r), h = rH(r), ow = Math.ceil(w / step), oh = Math.ceil(h / step), px = new Float32Array(ow * oh * 3), fr = Math.fround;
      for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++){
        let a0 = 0, a1 = 0, a2 = 0, n = 0;
        const ye = Math.min((oy + 1) * step, h), xe = Math.min((ox + 1) * step, w);
        for (let y = oy * step; y < ye; y++){
          const Y = r[1] + y, inY = Y >= 0 && Y < H;
          for (let x = ox * step; x < xe; x++){
            const X = r[0] + x;
            if (inY && X >= 0 && X < W){
              const s = (Y * W + X) * 4, a = src[s + 3] / 255, b = 0.5 * (1 - a);
              a0 += fr(src[s] / 255 * a + b); a1 += fr(src[s + 1] / 255 * a + b); a2 += fr(src[s + 2] / 255 * a + b);
            } else { a0 += 0.5; a1 += 0.5; a2 += 0.5; }
            n++;
          }
        }
        const o = (oy * ow + ox) * 3; px[o] = a0 / n; px[o + 1] = a1 / n; px[o + 2] = a2 / n;
      }
      return {w:ow, h:oh, px};
    }
  };
}
/* RgbImage::downsample：整数 step 方框平均（输出 ceil(w/step)×ceil(h/step)） */
function downsample(img, step){
  if (step <= 1) return img;
  const ow = Math.ceil(img.w / step), oh = Math.ceil(img.h / step), px = new Float32Array(ow * oh * 3);
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++){
    let a0 = 0, a1 = 0, a2 = 0, n = 0;
    for (let y = oy * step; y < Math.min((oy + 1) * step, img.h); y++) for (let x = ox * step; x < Math.min((ox + 1) * step, img.w); x++){
      const i = (y * img.w + x) * 3; a0 += img.px[i]; a1 += img.px[i + 1]; a2 += img.px[i + 2]; n++;
    }
    const o = (oy * ow + ox) * 3; px[o] = a0 / n; px[o + 1] = a1 / n; px[o + 2] = a2 / n;
  }
  return {w:ow, h:oh, px};
}
/* scale_for：让 area 大约不超过 max_px 像素的整数步长 */
const scaleFor = (area, maxPx) => Math.max(1, Math.ceil(Math.sqrt(rW(area) * rH(area) / Math.max(1, maxPx))));

/* ── mod.rs Rng（xorshift，确定性）＋ subsample ── */
const M64 = (1n << 64n) - 1n;
function Rng(seed){ this.s = ((BigInt(seed) * 0x9E3779B97F4A7C15n) & M64) | 1n; }
Rng.prototype.next = function(){ let x = this.s; x ^= (x << 13n) & M64; x ^= x >> 7n; x ^= (x << 17n) & M64; this.s = x; return x; };
Rng.prototype.f32 = function(){ return Number(this.next() >> 40n) / 16777216; };
const subsample = (v, max) => { if (v.length <= max) return v.slice(); const k = Math.ceil(v.length / max), o = []; for (let i = 0; i < v.length; i += k) o.push(v[i]); return o; };

/* ── gmm.rs ── */
const sd2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function nearestC(cs, z){ let best = 0, bd = Infinity; for (let i = 0; i < cs.length; i++){ const d = sd2(cs[i], z); if (d < bd){ bd = d; best = i; } } return best; }
/* kmeans：k-means++ 播种（种子 0x5EED＋样本数）、Lloyd、丢掉空群 */
function kmeans(samples, k, iters){
  const rng = new Rng(0x5EED + samples.length);
  let centers = [samples[Number(rng.next() % BigInt(samples.length))]];
  const dist = samples.map(z => sd2(z, centers[0]));
  while (centers.length < k){
    let total = 0; for (const d of dist) total += d;
    if (total <= 1e-12) break;
    let t = rng.f32() * total, pick = samples.length - 1;
    for (let i = 0; i < dist.length; i++){ t -= dist[i]; if (t <= 0){ pick = i; break; } }
    const c = samples[pick]; centers.push(c);
    for (let i = 0; i < dist.length; i++) dist[i] = Math.min(dist[i], sd2(samples[i], c));
  }
  for (let it = 0; it < iters; it++){
    const sums = centers.map(() => [[0, 0, 0], 0]);
    for (const z of samples){ const i = nearestC(centers, z); for (let c = 0; c < 3; c++) sums[i][0][c] += z[c]; sums[i][1]++; }
    const nw = sums.filter(s => s[1] > 0).map(([s, n]) => s.map(v => v / n));
    const done = nw.length === centers.length && nw.every((c, i) => c[0] === centers[i][0] && c[1] === centers[i][1] && c[2] === centers[i][2]);
    centers = nw; if (done) break;
  }
  return centers;
}
/* Component::new：协方差对角加 reg、3×3 求逆、log_norm＝ln w − ½ ln det − 3/2 ln 2π */
function component(weight, mean, cov, reg){
  const c = cov.map(r => r.slice()); for (let i = 0; i < 3; i++) c[i][i] += reg;
  const det = c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1]) - c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0]) + c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0]);
  if (det <= 1e-30 || weight <= 0) return null;
  const inv = [[(c[1][1] * c[2][2] - c[1][2] * c[2][1]) / det, (c[0][2] * c[2][1] - c[0][1] * c[2][2]) / det, (c[0][1] * c[1][2] - c[0][2] * c[1][1]) / det],
    [(c[1][2] * c[2][0] - c[1][0] * c[2][2]) / det, (c[0][0] * c[2][2] - c[0][2] * c[2][0]) / det, (c[0][2] * c[1][0] - c[0][0] * c[1][2]) / det],
    [(c[1][0] * c[2][1] - c[1][1] * c[2][0]) / det, (c[0][1] * c[2][0] - c[0][0] * c[2][1]) / det, (c[0][0] * c[1][1] - c[0][1] * c[1][0]) / det]];
  return {weight, mean:mean.slice(), inv, logNorm:Math.log(weight) - 0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI)};
}
/* log_weighted：ln(w·N(z; μ, Σ)) */
function logW(c, z){
  const a = z[0] - c.mean[0], b = z[1] - c.mean[1], d = z[2] - c.mean[2], m = c.inv;
  return c.logNorm - 0.5 * (a * (m[0][0] * a + m[0][1] * b + m[0][2] * d) + b * (m[1][0] * a + m[1][1] * b + m[1][2] * d) + d * (m[2][0] * a + m[2][1] * b + m[2][2] * d));
}
const newAcc = () => ({n:0, s:[0, 0, 0], ss:[[0, 0, 0], [0, 0, 0], [0, 0, 0]]});
function accAdd(a, z, w){ a.n += w; for (let i = 0; i < 3; i++){ a.s[i] += w * z[i]; for (let j = 0; j < 3; j++) a.ss[i][j] += w * z[i] * z[j]; } }
function accComp(a, total, reg){
  if (a.n <= 0) return null;
  const m = a.s.map(v => v / a.n);
  return component(a.n / total, m, [0, 1, 2].map(i => [0, 1, 2].map(j => a.ss[i][j] / a.n - m[i] * m[j])), reg);
}
const DEFAULT_REG = 2e-5;
function fromLabels(samples, labels, k, reg){
  const acc = Array.from({length:k}, newAcc); samples.forEach((z, i) => accAdd(acc[labels[i]], z, 1));
  const comps = acc.map(a => accComp(a, samples.length, reg)).filter(Boolean);
  return comps.length ? {comps, reg} : null;
}
function emStep(g, samples){
  const acc = g.comps.map(newAcc), lw = new Array(g.comps.length);
  for (const z of samples){
    let mx = -Infinity; for (let i = 0; i < g.comps.length; i++){ lw[i] = logW(g.comps[i], z); mx = Math.max(mx, lw[i]); }
    let sum = 0; for (let i = 0; i < lw.length; i++){ lw[i] = Math.exp(lw[i] - mx); sum += lw[i]; }
    for (let i = 0; i < lw.length; i++){ const r = lw[i] / sum; if (r > 1e-6) accAdd(acc[i], z, r); }
  }
  const comps = acc.map(a => accComp(a, samples.length, g.reg)).filter(Boolean);
  return comps.length ? {comps, reg:g.reg} : null;
}
/* Gmm::fit ＝ fit_em(…, 3)：k 夹到 1..样本数；k-means 10 次；硬指派建初值；3 步 EM */
function gmmFit(samples, k, reg, emIters){
  if (!samples.length) return null;
  k = Math.min(Math.max(k, 1), samples.length);
  const cs = kmeans(samples, k, 10);
  let g = fromLabels(samples, samples.map(z => nearestC(cs, z)), cs.length, reg); if (!g) return null;
  const n = emIters === undefined ? 3 : emIters;
  for (let i = 0; i < n; i++) g = emStep(g, samples) || g;
  return g;
}
function componentOf(g, z){ let best = 0, bv = -Infinity; for (let i = 0; i < g.comps.length; i++){ const v = logW(g.comps[i], z); if (v > bv){ bv = v; best = i; } } return best; }
const refit = (g, samples) => fromLabels(samples, samples.map(z => componentOf(g, z)), g.comps.length, g.reg);
function logProb(g, z){
  const n = Math.min(g.comps.length, 16); let mx = -Infinity; const v = new Array(n);
  for (let i = 0; i < n; i++){ v[i] = logW(g.comps[i], z); mx = Math.max(mx, v[i]); }
  let s = 0; for (let i = 0; i < n; i++) s += Math.exp(v[i] - mx);
  return mx + Math.log(s);
}
const negLog = (g, z) => Math.min(200, Math.max(-50, -logProb(g, z)));

/* ── maxflow.rs（Boykov–Kolmogorov）：两棵搜寻树、增广、孤儿领养 ── */
const NONE = -1, TERMINAL = -2, ORPHAN = -3, EPSF = 1e-5;
function Graph(nodes, edges){
  this.first = new Int32Array(nodes).fill(NONE); this.trCap = new Float64Array(nodes); this.parent = new Int32Array(nodes).fill(NONE);
  this.isSink = new Uint8Array(nodes); this.ts = new Int32Array(nodes); this.dist = new Int32Array(nodes); this.active = new Uint8Array(nodes);
  const m = Math.max(edges * 2, 2);
  this.head = new Int32Array(m); this.next = new Int32Array(m); this.rCap = new Float64Array(m); this.na = 0; this.flow = 0;
}
Graph.prototype.grow = function(){
  const n = this.head.length * 2, g = (A, T) => { const B = new T(n); B.set(A); return B; };
  this.head = g(this.head, Int32Array); this.next = g(this.next, Int32Array); this.rCap = g(this.rCap, Float64Array);
};
/* add_tweights：每个节点只留源／汇容量的差，共同部分直接算进流量 */
Graph.prototype.addTweights = function(i, cs, ct){ const d = this.trCap[i]; if (d > 0) cs += d; else ct -= d; this.flow += Math.min(cs, ct); this.trCap[i] = cs - ct; };
Graph.prototype.addEdge = function(i, j, cap, rev){
  if (this.na + 2 > this.head.length) this.grow();
  const a = this.na; this.na += 2;
  this.head[a] = j; this.next[a] = this.first[i]; this.rCap[a] = cap; this.first[i] = a;
  this.head[a + 1] = i; this.next[a + 1] = this.first[j]; this.rCap[a + 1] = rev; this.first[j] = a + 1;
};
Graph.prototype.inSource = function(i){ return this.parent[i] !== NONE && !this.isSink[i]; };
function Deque(){ this.a = []; this.h = 0; }
Deque.prototype.pushBack = function(v){ this.a.push(v); };
Deque.prototype.pushFront = function(v){ if (this.h > 0) this.a[--this.h] = v; else this.a.unshift(v); };
Deque.prototype.popFront = function(){ if (this.h >= this.a.length) return undefined; const v = this.a[this.h++]; if (this.h > 4096 && this.h * 2 > this.a.length){ this.a = this.a.slice(this.h); this.h = 0; } return v; };
Graph.prototype.maxflow = function(){
  const n = this.first.length, queue = new Deque(), orphans = new Deque();
  for (let i = 0; i < n; i++){
    this.active[i] = 0; this.ts[i] = 0;
    if (Math.abs(this.trCap[i]) > EPSF){ this.isSink[i] = this.trCap[i] < 0 ? 1 : 0; this.parent[i] = TERMINAL; this.dist[i] = 1; this.active[i] = 1; queue.pushBack(i); }
    else this.parent[i] = NONE;
  }
  let time = 0, i;
  while ((i = queue.popFront()) !== undefined){
    this.active[i] = 0;
    if (this.parent[i] === NONE) continue;
    // 成长：沿有余量的弧把自由节点收进树；碰到另一棵树＝接触点
    let contact = NONE; const sink = this.isSink[i];
    for (let a = this.first[i]; a !== NONE; a = this.next[a]){
      const j = this.head[a], cap = sink ? this.rCap[a ^ 1] : this.rCap[a];
      if (cap > EPSF){
        if (this.parent[j] === NONE){
          this.isSink[j] = sink; this.parent[j] = a ^ 1; this.ts[j] = this.ts[i]; this.dist[j] = this.dist[i] + 1;
          if (!this.active[j]){ this.active[j] = 1; queue.pushBack(j); }
        } else if (this.isSink[j] !== sink){ contact = sink ? a ^ 1 : a; break; }
        else if (this.ts[j] <= this.ts[i] && this.dist[j] > this.dist[i]){ this.parent[j] = a ^ 1; this.ts[j] = this.ts[i]; this.dist[j] = this.dist[i] + 1; }
      }
    }
    if (contact === NONE) continue;
    if (!this.active[i]){ this.active[i] = 1; queue.pushFront(i); }
    time++;
    this.augment(contact, orphans);
    let o; while ((o = orphans.popFront()) !== undefined) this.adopt(o, time, queue, orphans);
  }
  return this.flow;
};
Graph.prototype.augment = function(m, orphans){
  const u = this.head[m ^ 1], v = this.head[m];
  let b = this.rCap[m], x = u;
  for (;;){ const a = this.parent[x]; if (a === TERMINAL) break; b = Math.min(b, this.rCap[a ^ 1]); x = this.head[a]; }
  b = Math.min(b, this.trCap[x]);
  x = v;
  for (;;){ const a = this.parent[x]; if (a === TERMINAL) break; b = Math.min(b, this.rCap[a]); x = this.head[a]; }
  b = Math.min(b, -this.trCap[x]);
  this.rCap[m ^ 1] += b; this.rCap[m] -= b;
  x = u;
  for (;;){ const a = this.parent[x]; if (a === TERMINAL) break; this.rCap[a] += b; this.rCap[a ^ 1] -= b; const up = this.head[a]; if (this.rCap[a ^ 1] <= EPSF){ this.parent[x] = ORPHAN; orphans.pushBack(x); } x = up; }
  this.trCap[x] -= b; if (this.trCap[x] <= EPSF){ this.parent[x] = ORPHAN; orphans.pushBack(x); }
  x = v;
  for (;;){ const a = this.parent[x]; if (a === TERMINAL) break; this.rCap[a ^ 1] += b; this.rCap[a] -= b; const up = this.head[a]; if (this.rCap[a] <= EPSF){ this.parent[x] = ORPHAN; orphans.pushBack(x); } x = up; }
  this.trCap[x] += b; if (this.trCap[x] >= -EPSF){ this.parent[x] = ORPHAN; orphans.pushBack(x); }
  this.flow += b;
};
Graph.prototype.adopt = function(i, time, queue, orphans){
  const sink = this.isSink[i]; let best = NONE, dMin = Infinity;
  for (let a = this.first[i]; a !== NONE; a = this.next[a]){
    const cap = sink ? this.rCap[a] : this.rCap[a ^ 1], j = this.head[a];
    if (cap > EPSF && this.isSink[j] === sink && this.parent[j] !== NONE){
      let d = 0, k = j;
      for (;;){
        if (this.ts[k] === time){ d += this.dist[k]; break; }
        const pa = this.parent[k]; d++;
        if (pa === TERMINAL){ this.ts[k] = time; this.dist[k] = 1; break; }
        if (pa === ORPHAN){ d = Infinity; break; }
        k = this.head[pa];
      }
      if (d < Infinity){
        if (d < dMin){ best = a; dMin = d; }
        let kk = j, dd = d;
        while (this.ts[kk] !== time){ this.ts[kk] = time; this.dist[kk] = dd; dd--; kk = this.head[this.parent[kk]]; }
      }
    }
  }
  if (best !== NONE){ this.parent[i] = best; this.ts[i] = time; this.dist[i] = dMin + 1; return; }
  this.parent[i] = NONE;
  for (let a = this.first[i]; a !== NONE; a = this.next[a]){
    const j = this.head[a], pj = this.parent[j];
    if (this.isSink[j] === sink && pj !== NONE){
      const cap = sink ? this.rCap[a] : this.rCap[a ^ 1];
      if (cap > EPSF && !this.active[j]){ this.active[j] = 1; queue.pushBack(j); }
      if (pj !== TERMINAL && pj !== ORPHAN && this.head[pj] === i){ this.parent[j] = ORPHAN; orphans.pushBack(j); }
    }
  }
};

/* ── mod.rs：contrast_beta、grid_cut、data_costs ── */
const NB = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]];      // 8 连通的 4 个前向邻居与长度
/* β ＝ 1 / (2 ⟨‖z_m − z_n‖²⟩) */
function contrastBeta(img){
  const {w, h, px} = img; let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [dx, dy] of NB){
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < w && ny < h){ sum += d2i(px, (y * w + x) * 3, px, (ny * w + nx) * 3); n++; }
  }
  return (n === 0 || sum <= 1e-12) ? 0 : n / (2 * sum);
}
const FREE = 0, HARD_FG = 1, HARD_BG = 2;
/* grid_cut：一次最小割（Boykov & Jolly 2001）。只有自由像素成节点；连到固定邻居的边并进端点容量。回 1＝前景 */
function gridCut(img, cfg, cbg, fixed, gamma, beta){
  const {w, h, px} = img, n = w * h, idx = new Int32Array(n).fill(-1);
  let count = 0; for (let i = 0; i < n; i++) if (fixed[i] === FREE) idx[i] = count++;
  const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = fixed[i] === HARD_FG ? 1 : 0;
  if (!count) return out;
  const g = new Graph(count, count * 4);
  for (let i = 0; i < n; i++) if (idx[i] >= 0) g.addTweights(idx[i], cbg[i], cfg[i]);
  const fixLink = (node, f, wt) => { if (f === HARD_FG) g.addTweights(node, wt, 0); else g.addTweights(node, 0, wt); };   // add_fixed_link
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x;
    for (const [dx, dy, len] of NB){
      const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx, wt = gamma * Math.exp(-beta * d2i(px, i * 3, px, j * 3)) / len;
      const fi = idx[i] >= 0, fj = idx[j] >= 0;
      if (fi && fj) g.addEdge(idx[i], idx[j], wt, wt); else if (fi) fixLink(idx[i], fixed[j], wt); else if (fj) fixLink(idx[j], fixed[i], wt);
    }
  }
  g.maxflow();
  for (let i = 0; i < n; i++) if (idx[i] >= 0) out[i] = g.inSource(idx[i]) ? 1 : 0;
  return out;
}
const pxAt = (img, i) => [img.px[i * 3], img.px[i * 3 + 1], img.px[i * 3 + 2]];
function dataCosts(img, fg, bg){
  const n = img.w * img.h, cf = new Float64Array(n), cb = new Float64Array(n);
  for (let i = 0; i < n; i++){ const p = pxAt(img, i); cf[i] = negLog(fg, p); cb[i] = negLog(bg, p); }
  return [cf, cb];
}
/* components（8 连通）／components4 */
function components(mask, w, h, eight){
  const lab = new Int32Array(w * h), sizes = [0], stack = [];
  for (let s = 0; s < w * h; s++){
    if (!mask[s] || lab[s]) continue;
    const l = sizes.length; sizes.push(0); lab[s] = l; stack.push(s);
    while (stack.length){
      const i = stack.pop(); sizes[l]++;
      const x = i % w, y = (i / w) | 0;
      if (eight){
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx; if (mask[j] && !lab[j]){ lab[j] = l; stack.push(j); }
        }
      } else for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1])
        if (j >= 0 && mask[j] && !lab[j]){ lab[j] = l; stack.push(j); }
    }
  }
  return {lab, sizes};
}
/* keep_seeded：只留含种子像素的连通块 */
function keepSeeded(mask, seeds, w, h){
  const {lab, sizes} = components(mask, w, h, true), keep = new Uint8Array(sizes.length);
  for (let i = 0; i < lab.length; i++) if (seeds[i] && lab[i]) keep[lab[i]] = 1;
  const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = (lab[i] && keep[lab[i]]) ? 1 : 0;
  return out;
}
/* clean_mask：留下 ≥ 最大块 frac 的块；补上不碰边框、≤ 面积 hole_frac 的四连通洞 */
function cleanMask(mask, w, h, frac, holeFrac){
  const {lab, sizes} = components(mask, w, h, true);
  let largest = 0; for (let i = 1; i < sizes.length; i++) largest = Math.max(largest, sizes[i]);
  const out = new Uint8Array(w * h); if (!largest) return out;
  const min = Math.ceil(largest * frac); let area = 0;
  for (let i = 0; i < out.length; i++) if (lab[i] && sizes[lab[i]] >= min){ out[i] = 1; area++; }
  const maxHole = Math.floor(area * holeFrac), inv = Uint8Array.from(out, v => v ? 0 : 1), H4 = components(inv, w, h, false), touches = new Uint8Array(H4.sizes.length);
  for (let x = 0; x < w; x++){ touches[H4.lab[x]] = 1; touches[H4.lab[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++){ touches[H4.lab[y * w]] = 1; touches[H4.lab[y * w + w - 1]] = 1; }
  for (let i = 0; i < out.length; i++){ const l = H4.lab[i]; if (l && !touches[l] && H4.sizes[l] <= maxHole) out[i] = 1; }
  return out;
}
/* antialias_u8：硬 0/255 遮罩的边缘像素跟 3×3 平均混（同魔术棒消除锯齿） */
function antialiasU8(mask, w, h){
  const src = mask.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const v = src[y * w + x]; let sum = 0, edge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      const X = x + dx, Y = y + dy, nv = (X < 0 || Y < 0 || X >= w || Y >= h) ? v : src[Y * w + X];
      if (nv !== v) edge = true; sum += nv;
    }
    if (edge){ const avg = sum / (9 * 255), f = v > 127 ? 0.5 + 0.5 * avg : 0.5 * avg; mask[y * w + x] = Math.round(f * 255); }
  }
}
/* trim_region：外框缩到非零像素（空＝null） */
function trimRegion(r){
  const w = rW(r.bbox); if (!w) return null;
  const h = (r.mask.length / w) | 0;
  let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++){
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (r.mask[y * w + x]){ if (a < 0) a = x; b = x; }
    if (a >= 0){ x0 = Math.min(x0, a); x1 = Math.max(x1, b + 1); y0 = Math.min(y0, y); y1 = y + 1; }
  }
  if (x0 === Infinity) return null;
  if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return r;
  const nw = x1 - x0, mask = new Uint8Array(nw * (y1 - y0));
  for (let y = y0; y < y1; y++) mask.set(r.mask.subarray(y * w + x0, y * w + x1), (y - y0) * nw);
  const b = r.bbox;
  return {bbox:[b[0] + x0, b[1] + y0, b[0] + x1, b[1] + y1], mask};
}
/* finish_region：工作解析度标签放大回全解析度；step>1 时在边界带（每块 192＋晕 12）用两边 GMM＋弱先验重切；最后反锯齿一圈、缩外框 */
function finishRegion(sampler, win, step, low, lw, lh, models){
  const w = rW(win), h = rH(win), mask = new Uint8Array(w * h);
  if (step <= 1){ for (let i = 0; i < mask.length; i++) mask[i] = low[i] ? 255 : 0; }
  else {
    const band = new Uint8Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
      const v = low[y * lw + x];
      outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < lw && ny < lh && low[ny * lw + nx] !== v){ band[y * lw + x] = 1; break outer; }
      }
    }
    for (let y = 0; y < h; y++){ const ly = Math.min((y / step) | 0, lh - 1); for (let x = 0; x < w; x++) mask[y * w + x] = low[ly * lw + Math.min((x / step) | 0, lw - 1)] ? 255 : 0; }
    if (models) refineBand(sampler, win, step, low, band, lw, lh, models[0], models[1], mask);
  }
  antialiasU8(mask, w, h);
  return trimRegion({bbox:win.slice(), mask});
}
function refineBand(sampler, win, step, low, band, lw, lh, fg, bg, mask){
  const T = 192, HALO = 12, w = rW(win);
  const block = (x, y) => Math.min(((y - win[1]) / step) | 0, lh - 1) * lw + Math.min(((x - win[0]) / step) | 0, lw - 1);
  for (let ty = win[1]; ty < win[3]; ty += T) for (let tx = win[0]; tx < win[2]; tx += T){
    const t = [tx, ty, Math.min(tx + T, win[2]), Math.min(ty + T, win[3])];
    const bx0 = ((t[0] - win[0]) / step) | 0, by0 = ((t[1] - win[1]) / step) | 0;
    const bx1 = Math.min(((t[2] - 1 - win[0]) / step) | 0, lw - 1), by1 = Math.min(((t[3] - 1 - win[1]) / step) | 0, lh - 1);
    let any = false; for (let by = by0; by <= by1 && !any; by++) for (let bx = bx0; bx <= bx1; bx++) if (band[by * lw + bx]){ any = true; break; }
    if (!any) continue;
    const r = rInter(rInflate(t, HALO), win);
    const img = sampler.rgb(r), rw = rW(r), rh = rH(r), fixed = new Uint8Array(rw * rh), cfg = new Float64Array(rw * rh), cbg = new Float64Array(rw * rh);
    for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++){
      const i = yy * rw + xx, b = block(r[0] + xx, r[1] + yy), lab = low[b];
      if (!band[b]){ fixed[i] = lab ? HARD_FG : HARD_BG; continue; }
      const p = pxAt(img, i);
      cfg[i] = negLog(fg, p) + (lab ? 0 : 0.4); cbg[i] = negLog(bg, p) + (lab ? 0.4 : 0);   // 颜色似然＋往工作解析度标签靠的弱先验
    }
    const cut = gridCut(img, cfg, cbg, fixed, 50, contrastBeta(img));
    for (let yy = t[1]; yy < t[3]; yy++) for (let xx = t[0]; xx < t[2]; xx++) mask[(yy - win[1]) * w + (xx - win[0])] = cut[(yy - r[1]) * rw + (xx - r[0])] ? 255 : 0;
  }
}

/* ── quick.rs ── */
const QREG = 6e-4;       // 笔画样本少：协方差加约 6 阶的岭
const EDGE = 0.06;       // 测地距离超过这么多（颜色单位、扣掉纹理）＝在边的后面
const MIN_STEP = 0.03;   // 邻差低于这个永远不算边
const KAPPA = 2.0;       // 测地距离在数据项里的权重（每 EDGE 几 nats）
const Q_GAMMA = 50.0;
const WORK_PX = 160000;  // 一笔的工作解析度上限
/* broad_model：RGB 立方体 8 个角拟一个分量＝近乎均匀的密度 */
let _broad = null;
function broadModel(){
  if (_broad) return _broad;
  const corners = []; for (let i = 0; i < 8; i++) corners.push([i & 1, (i >> 1) & 1, (i >> 2) & 1]);
  return (_broad = gmmFit(corners, 1, 0));
}
/* stroke_mask：离折线 radius 内的工作像素＋每一点自己那格 */
function strokeMask(pts, radius, w, h){
  const m = new Uint8Array(w * h);
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  for (const [a, b] of segs){
    const x0 = Math.max(Math.floor(Math.min(a[0], b[0]) - radius), 0), y0 = Math.max(Math.floor(Math.min(a[1], b[1]) - radius), 0);
    const x1 = Math.min(Math.max(Math.ceil(Math.max(a[0], b[0]) + radius), 0), w), y1 = Math.min(Math.max(Math.ceil(Math.max(a[1], b[1]) + radius), 0), h);
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
      const px = x + 0.5, py = y + 0.5;
      const t = len2 > 0 ? clamp01(((px - a[0]) * dx + (py - a[1]) * dy) / len2) : 0;
      const qx = a[0] + t * dx - px, qy = a[1] + t * dy - py;
      if (qx * qx + qy * qy <= radius * radius) m[y * w + x] = 1;
    }
  }
  for (const [x, y] of pts) if (x >= 0 && y >= 0 && Math.floor(x) < w && Math.floor(y) < h) m[Math.floor(y) * w + Math.floor(x)] = 1;
  return m;
}
/* tipDabs（原码无·照 PS 画笔设置）：沿笔画按间距盖章的中心与半径 [[x,y,r]…]（文件坐标）。
   tip＝{spacing（直径的倍数）, spacingEnabled（false＝每个事件点盖一个）, angle（度，逆时针）, roundness（0..1）, hardness（0..1，缺省 1）,
        sizeControl:"pen|wheel"（钢笔压力／钢笔斜度／光笔轮：点的第三格＝那一刻的大小比例 0..1，半径跟着缩；滑鼠没有第三格＝不缩）}
   硬度（照 PS 快速选择的画笔硬度）：软笔尖只有 50% 轮廓以内算「刷到」——种子半径＝r·(0.5＋0.5·硬度)（跟游标圈同一个圈） */
const ctlOn = tip => !!tip && (tip.sizeControl === 'pen' || tip.sizeControl === 'wheel');
const hardF = tip => tip && isFinite(tip.hardness) && tip.hardness < 1 ? 0.5 + 0.5 * Math.max(0, tip.hardness) : 1;
function tipDabs(points, size, tip){
  const pen = ctlOn(tip), hf = hardF(tip), rOf = q => Math.max(0.5, size / 2 * hf * (pen && isFinite(q[2]) ? Math.min(1, Math.max(0.01, q[2])) : 1));
  const P0 = points.filter(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])); if (!P0.length) return [];
  const out = [[P0[0][0], P0[0][1], rOf(P0[0])]];
  if (tip && tip.spacingEnabled === false){ for (let i = 1; i < P0.length; i++) out.push([P0[i][0], P0[i][1], rOf(P0[i])]); return out; }
  const sp = tip && tip.spacing > 0 ? tip.spacing : 0.25;
  let need = Math.max(0.5, 2 * out[0][2] / hf * sp);               // 沿整条路径量距离，每「目前直径×间距」盖一个（跨点累计；直径不打硬度折扣）
  for (let i = 1; i < P0.length; i++){
    const a = P0[i - 1], b = P0[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!d) continue;
    let pos = 0;
    while (d - pos >= need){
      pos += need; const t = pos / d, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (isFinite(a[2]) ? a[2] : 1) + ((isFinite(b[2]) ? b[2] : 1) - (isFinite(a[2]) ? a[2] : 1)) * t];
      const r = rOf(q); out.push([q[0], q[1], r]); need = Math.max(0.5, 2 * r / hf * sp);
    }
    need -= d - pos;
  }
  return out;
}
/* tipIsRound：缺省笔尖（圆、硬度 100%、间距 25%、间距开、大小不受控）⇒ 走原码的胶囊形 strokeMask */
const tipIsRound = tip => !tip || ((tip.roundness === undefined || tip.roundness >= 1) && !tip.angle && (tip.spacing === undefined || Math.abs(tip.spacing - 0.25) < 1e-9) && tip.spacingEnabled !== false && !ctlOn(tip) && hardF(tip) === 1);
/* strokeMaskTip：工作解析度上按 tipDabs 盖椭圆笔尖（长轴＝直径、短轴＝直径·圆度、转 angle）；每颗中心那格一定算 */
function strokeMaskTip(dabs, tip, w, h, step, ox, oy){
  const m = new Uint8Array(w * h), ro = tip && tip.roundness < 1 ? Math.max(0.01, tip.roundness) : 1, an = tip && tip.angle ? -tip.angle * Math.PI / 180 : 0, ca = Math.cos(an), sa = Math.sin(an);
  for (const [dx0, dy0, rd] of dabs){
    const cx = (dx0 - ox) / step, cy = (dy0 - oy) / step, r = Math.max(rd / step, 0.75), rr = Math.max(r * ro, 0.5) / r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = dx * ca + dy * sa, v = (dy * ca - dx * sa) / rr;
      if (u * u + v * v <= r * r) m[y * w + x] = 1;
    }
    if (cx >= 0 && cy >= 0 && Math.floor(cx) < w && Math.floor(cy) < h) m[Math.floor(cy) * w + Math.floor(cx)] = 1;
  }
  return m;
}
/* blur3：3 格方框，先横后直（边缘夹住） */
function blur3(img){
  const {w, h} = img, src = img.px, tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const l = (y * w + Math.max(x - 1, 0)) * 3, c = (y * w + x) * 3, r = (y * w + Math.min(x + 1, w - 1)) * 3;
    for (let k = 0; k < 3; k++) tmp[c + k] = (src[l + k] + src[c + k] + src[r + k]) / 3;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const u = (Math.max(y - 1, 0) * w + x) * 3, c = (y * w + x) * 3, d = (Math.min(y + 1, h - 1) * w + x) * 3;
    for (let k = 0; k < 3; k++) out[c + k] = (tmp[u + k] + tmp[c + k] + tmp[d + k]) / 3;
  }
  return {w, h, px:out};
}
/* geodesic：屏障图（平滑后颜色梯度超过笔画底下纹理水平的部分）上的测地距离；光栅扫描近似（前后各扫两遍、8 邻） */
function geodesic(img, seeds){
  const {w, h} = img, sm = blur3(blur3(img)), P = sm.px;
  const near = new Uint8Array(w * h);
  for (let i = 0; i < seeds.length; i++) if (seeds[i]){
    const x = i % w, y = (i / w) | 0;
    for (let yy = Math.max(y - 2, 0); yy < Math.min(y + 3, h); yy++) near.fill(1, yy * w + Math.max(x - 2, 0), yy * w + Math.min(x + 3, w));
  }
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const l = (y * w + Math.max(x - 1, 0)) * 3, r = (y * w + Math.min(x + 1, w - 1)) * 3;
    const u = (Math.max(y - 1, 0) * w + x) * 3, dn = (Math.min(y + 1, h - 1) * w + x) * 3;
    g[y * w + x] = Math.sqrt((d2i(P, l, P, r) + d2i(P, u, P, dn)) * 0.25);
  }
  const diffs = []; for (let i = 0; i < w * h; i++) if (near[i]) diffs.push(g[i]);
  let tau = 0;
  if (diffs.length){ diffs.sort((a, b) => a - b); tau = diffs[diffs.length >> 1]; }     // select_nth_unstable(mid)＝中位数
  const thr = Math.max(2 * tau, MIN_STEP);
  const e = new Float32Array(w * h); for (let i = 0; i < e.length; i++) e[i] = Math.max(g[i] - thr, 0);
  const cost = (a, b, len) => len * (0.5 * (e[a] + e[b]) + 1e-6);
  const d = new Float64Array(w * h); for (let i = 0; i < d.length; i++) d[i] = seeds[i] ? 0 : Infinity;
  const sq = Math.SQRT2;
  for (let pass = 0; pass < 2; pass++){
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + cost(i, i - 1, 1));
      if (y > 0){
        v = Math.min(v, d[i - w] + cost(i, i - w, 1));
        if (x > 0) v = Math.min(v, d[i - w - 1] + cost(i, i - w - 1, sq));
        if (x + 1 < w) v = Math.min(v, d[i - w + 1] + cost(i, i - w + 1, sq));
      }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--){
      const i = y * w + x; let v = d[i];
      if (x + 1 < w) v = Math.min(v, d[i + 1] + cost(i, i + 1, 1));
      if (y + 1 < h){
        v = Math.min(v, d[i + w] + cost(i, i + w, 1));
        if (x + 1 < w) v = Math.min(v, d[i + w + 1] + cost(i, i + w + 1, sq));
        if (x > 0) v = Math.min(v, d[i + w - 1] + cost(i, i + w - 1, sq));
      }
      d[i] = v;
    }
  }
  return d;
}
/* segment：工作解析度的分割 → [前景模型, 背景模型, 标签] */
function segment(img, seeds, maxSamples){          // maxSamples：拖动中的粗算拿少一点样本拟高斯混合（原码 20000）
  const {w:lw, h:lh} = img, n = lw * lh, ms = maxSamples || 20000;
  const geo = geodesic(img, seeds);
  let fs = [], bs = [];
  for (let i = 0; i < n; i++){ if (seeds[i]) fs.push(pxAt(img, i)); if (geo[i] > EDGE) bs.push(pxAt(img, i)); }
  fs = subsample(fs, ms); bs = subsample(bs, ms);
  const fg = gmmFit(fs, Math.min(Math.max((fs.length / 40) | 0, 1), 4), QREG) || broadModel();
  const bg = bs.length >= 30 ? gmmFit(bs, 6, QREG) : null;
  const cf = new Float64Array(n), cb = new Float64Array(n);
  for (let i = 0; i < n; i++){
    const p = pxAt(img, i);
    cf[i] = negLog(fg, p) + KAPPA * Math.min(geo[i] / EDGE, 4);
    cb[i] = bg ? -Math.log(0.85 * Math.exp(logProb(bg, p)) + 0.15) : 0;      // 背景＝GMM 混 15% 均匀离群密度
  }
  const fixed = Uint8Array.from(seeds, s => s ? HARD_FG : FREE);
  const cut = gridCut(img, cf, cb, fixed, Q_GAMMA, contrastBeta(img));
  const low = keepSeeded(cut, seeds, lw, lh);
  return [fg, bg || broadModel(), low];
}
/* quick_select：笔画（文件像素、笔刷直径 size）长出的新区域；笔画碰不到画布＝null。
   tip（可省；照 PS 画笔设置）：间距／角度／圆度／大小钢笔压力 ⇒ 硬前景种子＝沿笔画按间距盖的椭圆笔尖（tipDabs），不是缺省的圆胶囊 */
function quickSelect(sampler, canvas, points, size, workPx, tip, coarse){       // coarse＝拖动中的粗算：工作解析度放大回去就好，不沿边全解析度重切
  if (!points.length) return null;
  size = Math.max(size, 1);
  const r = size / 2, dabs = tipIsRound(tip) ? null : tipDabs(points, size, tip);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (dabs) for (const [x, y, rd] of dabs){ x0 = Math.min(x0, x - rd); y0 = Math.min(y0, y - rd); x1 = Math.max(x1, x + rd); y1 = Math.max(y1, y + rd); }
  else for (const [x, y] of points){ x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
  const bbox = rInter([Math.floor(x0), Math.floor(y0), Math.ceil(x1) + 1, Math.ceil(y1) + 1], canvas);
  if (rEmpty(bbox)) return null;
  const margin = Math.trunc(Math.max(size * 6, 512));
  let win = rInter(rInflate(bbox, margin), canvas);
  const fixed = coarse && coarse.step;                             // 粗算给了固定 step：窗口对齐到 step 的格子（才能直接从整张的缩小图裁）
  if (fixed) win = rInter([Math.floor(win[0] / fixed) * fixed, Math.floor(win[1] / fixed) * fixed, Math.ceil(win[2] / fixed) * fixed, Math.ceil(win[3] / fixed) * fixed], canvas);
  const step = fixed || scaleFor(win, workPx || WORK_PX);
  const img = sampler.rgbScaled(win, step), lw = img.w, lh = img.h;
  const pts = points.map(([x, y]) => [(x - win[0]) / step, (y - win[1]) / step]);
  const seeds = dabs ? strokeMaskTip(dabs, tip, lw, lh, step, win[0], win[1]) : strokeMask(pts, Math.max(r / step, 0.75), lw, lh);
  if (!seeds.some(v => v)) return null;
  const [fg, bg, low] = segment(img, seeds, coarse ? LIVE_SAMPLES : 0);
  if (!low.some(v => v)) return null;
  if (coarse) return {coarse:true, win, step, low, lw, lh};         // 粗算：直接回工作解析度标签（liveGrow 自己一格格铺回去）
  return finishRegion(sampler, win, step, low, lw, lh, [fg, bg]);
}

/* ── 边拖边长的增量分割（原码无·照 PS 跟手；「每次整条重跑」的做法 3000×2000 一次要 1.2～1.6 秒，太慢） ──
   拖动中：只拿「上次算到之后新进的点（连上一点）」当这一小段笔画，在它附近的窗口（外框＋max(6·直径, 512)）用粗工作解析度（≈4 万像素）
   跑同一个 quickSelect、不做全解析度沿边重切；长出来的跟前面累积的取大（PS 拖着只会往外长）。每次只动这一小段的窗口，跟笔画多长无关。
   停笔（LIVE_SETTLE ms 没新点）：整条笔画照放开时一样的算法（全工作解析度＋沿边重切）精修一次换上，留着；放开时笔画没再变 ⇒ 直接用这份、不重算（先粗后精）。
   粗算的结果不放大重切：工作解析度每个前景格直接铺成 step×step 的实心块进 acc（预览看得出是块状，停笔精修／放开才贴边）。
   st＝liveInit(src, W, H)；liveGrow 回这次「真的有变」的像素外框 [x0,y0,x1,y1]（或 null；长出来的大多早就选到了 ⇒ 通常很小）；st.acc＝累积的区域（整张文件大小 8 位） */
const LIVE_PX = 8000, LIVE_SAMPLES = 600, LIVE_SETTLE = 250;
const liveInit = (src, W, H) => ({src, W, H, acc:null, done:0});
function liveGrow(st, pts, size, tip){
  if (pts.length <= st.done) return null;
  const tail = pts.slice(Math.max(0, st.done - 1)); st.done = pts.length;
  const W = st.W, H = st.H;
  // 整条笔画固定一个 step（照「一颗笔尖＋两边 margin」那么大的窗口算）；整张先缩小一次（第一次用到才做），之后每次只从里面裁
  if (!st.pyr || st.pyr.size !== size){
    const side = size + 2 * Math.trunc(Math.max(size * 6, 512)), step = scaleFor([0, 0, Math.min(W, side), Math.min(H, side)], LIVE_PX);
    const full = makeSampler(st.src, W, H).rgbScaled([0, 0, W, H], step), fw = full.w;
    st.pyr = {size, step, rgbScaled(win, s){
      const ox = win[0] / s, oy = win[1] / s, ow = Math.ceil(rW(win) / s), oh = Math.ceil(rH(win) / s), px = new Float32Array(ow * oh * 3);
      for (let y = 0; y < oh; y++) px.set(full.px.subarray(((oy + y) * fw + ox) * 3, ((oy + y) * fw + ox + ow) * 3), y * ow * 3);
      return {w:ow, h:oh, px};
    }};
  }
  const r = quickSelect(st.pyr, [0, 0, W, H], tail, size, LIVE_PX, tip, {step:st.pyr.step});
  if (!r) return null;
  const acc = st.acc || (st.acc = new Uint8Array(W * H)), {win, step, low, lw, lh} = r;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let cy = 0; cy < lh; cy++){
    const Y0 = win[1] + cy * step, Y1 = Math.min(win[3], Y0 + step);
    for (let cx = 0; cx < lw; cx++){
      if (!low[cy * lw + cx]) continue;
      const X0 = win[0] + cx * step, X1 = Math.min(win[2], X0 + step);
      for (let y = Y0; y < Y1; y++){ const row = y * W; for (let x = X0; x < X1; x++) if (acc[row + x] !== 255){ acc[row + x] = 255; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    }
  }
  if (x1 < 0) return null;
  const b = [x0, y0, x1 + 1, y1 + 1];
  st.box = st.box ? [Math.min(st.box[0], b[0]), Math.min(st.box[1], b[1]), Math.max(st.box[2], b[2]), Math.max(st.box[3], b[3])] : b.slice();
  return b;
}
/* 分块轮廓（给拖动中的蚂蚁线）：跟 SelMask.outline 同样的边（覆盖度 >127 的边界），但切成 128×128 的块各自记、只重算有变的块 ⇒ 每次只花在改到的地方。
   ot＝{W, H, tiles:Map}；data＝整张文件大小 8 位；U＝有变的外框（null＝不动）；回全部线段 */
const OT = 128;
function outlineTiles(ot, data, U){
  const W = ot.W, H = ot.H, nx = Math.ceil(W / OT);
  if (U){
    const tx0 = Math.max(0, Math.floor((U[0] - 1) / OT)), ty0 = Math.max(0, Math.floor((U[1] - 1) / OT)), tx1 = Math.min(nx - 1, Math.floor(U[2] / OT)), ty1 = Math.min(Math.ceil(H / OT) - 1, Math.floor(U[3] / OT));
    const ins = (x, y) => x >= 0 && y >= 0 && x < W && y < H && data[y * W + x] > 127;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++){
      const X0 = tx * OT, Y0 = ty * OT, X1 = Math.min(W, X0 + OT), Y1 = Math.min(H, Y0 + OT), Ye = Y1 === H ? H : Y1 - 1, Xe = X1 === W ? W : X1 - 1, segs = [];
      for (let y = Y0; y <= Ye; y++){ let run = null; for (let x = X0; x <= X1; x++){ const e = x < X1 && ins(x, y) !== ins(x, y - 1); if (e && run === null) run = x; else if (!e && run !== null){ segs.push([[run, y], [x, y]]); run = null; } } }
      for (let x = X0; x <= Xe; x++){ let run = null; for (let y = Y0; y <= Y1; y++){ const e = y < Y1 && ins(x, y) !== ins(x - 1, y); if (e && run === null) run = y; else if (!e && run !== null){ segs.push([[x, run], [x, y]]); run = null; } } }
      if (segs.length) ot.tiles.set(ty * nx + tx, segs); else ot.tiles.delete(ty * nx + tx);
    }
    ot.flat = null;
  }
  if (!ot.flat){ ot.flat = []; for (const s of ot.tiles.values()) for (const q of s) ot.flat.push(q); }
  return ot.flat;
}
/* 停笔精修：整条照放开时算（结果跟 quickselect.select 逐位一样）；累积区域换成它 → 回整张要重合成的外框 */
function liveSettle(st, pts, size, tip){
  const W = st.W, H = st.H, reg = quickSelect(makeSampler(st.src, W, H), [0, 0, W, H], pts, size, WORK_PX, tip);
  const ob = st.box; st.acc = new Uint8Array(W * H); st.done = pts.length; st.settled = {n:pts.length, reg}; st.box = null;
  if (reg){ const b = reg.bbox, bw = rW(b); for (let y = b[1]; y < b[3]; y++) st.acc.set(reg.mask.subarray((y - b[1]) * bw, (y - b[1] + 1) * bw), y * W + b[0]); st.box = b.slice(); }
  const U = st.box, V = ob;
  return !U ? V : !V ? U.slice() : [Math.min(U[0], V[0]), Math.min(U[1], V[1]), Math.max(U[2], V[2]), Math.max(U[3], V[3])];
}

/* ── grabcut.rs（对象选择） ── */
const GC_BG = 0, GC_FG = 1, GC_PR_BG = 2, GC_PR_FG = 3, isFg = t => t === GC_FG || t === GC_PR_FG;
function grabcut(img, trimap, iters){
  const beta = contrastBeta(img), fixed = Uint8Array.from(trimap, t => t === GC_FG ? HARD_FG : t === GC_BG ? HARD_BG : FREE);
  let models = null;
  for (let it = 0; it < Math.max(iters, 1); it++){
    const fs = [], bs = [];
    for (let i = 0; i < trimap.length; i++) (isFg(trimap[i]) ? fs : bs).push(pxAt(img, i));
    const f2 = subsample(fs, 40000), b2 = subsample(bs, 40000);
    let fg, bg;
    if (!models){ fg = gmmFit(f2, 5, DEFAULT_REG); bg = gmmFit(b2, 5, DEFAULT_REG); if (!fg || !bg) return null; }
    else { fg = refit(models[0], f2) || models[0]; bg = refit(models[1], b2) || models[1]; }
    const [cf, cb] = dataCosts(img, fg, bg), cut = gridCut(img, cf, cb, fixed, 50, beta);
    let changed = 0;
    for (let i = 0; i < trimap.length; i++) if (trimap[i] === GC_PR_BG || trimap[i] === GC_PR_FG){
      const nt = cut[i] ? GC_PR_FG : GC_PR_BG; if (nt !== trimap[i]) changed++; trimap[i] = nt;
    }
    models = [fg, bg];
    if (changed * 2000 < trimap.length) break;
  }
  return models;
}
/* object_select：矩形外＝背景、里面＝可能前景的 GrabCut；在约 work_px 的工作副本上跑，再全解析度沿边重切 */
function objectSelect(sampler, canvas, rect, workPx){
  rect = rInter(rect, canvas);
  if (rW(rect) < 2 || rH(rect) < 2) return null;
  const margin = Math.max(Math.ceil(Math.max(rW(rect), rH(rect)) * 0.15), 8);
  const win = rInter(rInflate(rect, margin), canvas);
  const step = scaleFor(win, workPx || 160000);
  const img = sampler.rgbScaled(win, step), lw = img.w, lh = img.h;
  const trimap = new Uint8Array(lw * lh).fill(GC_BG);
  const inside = (x, y) => { const cx = win[0] + x * step + (step >> 1), cy = win[1] + y * step + (step >> 1); return cx >= rect[0] && cx < rect[2] && cy >= rect[1] && cy < rect[3]; };
  let anyBg = false;
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){ if (inside(x, y)) trimap[y * lw + x] = GC_PR_FG; else anyBg = true; }
  if (!anyBg){
    // 矩形盖满整张画布：外圈一条细边当背景
    const ring = Math.max((Math.min(lw, lh) / 50) | 0, 1);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (x < ring || y < ring || x + ring >= lw || y + ring >= lh) trimap[y * lw + x] = GC_BG;
  }
  const models = grabcut(img, trimap, 8); if (!models) return null;
  const low = cleanMask(Uint8Array.from(trimap, t => isFg(t) ? 1 : 0), lw, lh, 0.1, 0.002);
  return finishRegion(sampler, win, step, low, lw, lh, models);
}

/* ── selection.rs combine_region：只在区域外框里动；replace／add(无旧)＝新的；减／交(无旧)＝无；全空＝取消选择。整张文件大小的 8 位进出 ── */
function combineRegion(old, reg, mode, W, H){
  const b = reg ? reg.bbox : [0, 0, 0, 0], bw = rW(b), any = a => { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; };
  const each = f => { for (let y = Math.max(b[1], 0); y < Math.min(b[3], H); y++) for (let x = Math.max(b[0], 0); x < Math.min(b[2], W); x++) f(y * W + x, reg.mask[(y - b[1]) * bw + (x - b[0])]); };
  if (mode === 'replace' || (mode === 'add' && !old)){
    if (!reg || rEmpty(b) || !any(reg.mask)) return null;
    const o = new Uint8Array(W * H); each((i, v) => { o[i] = v; }); return any(o) ? o : null;
  }
  if (!old) return null;
  if (mode === 'intersect'){
    const o = new Uint8Array(W * H); if (reg) each((i, v) => { o[i] = Math.min(old[i], v); }); return any(o) ? o : null;
  }
  const o = Uint8Array.from(old);
  if (rEmpty(b)) return any(o) ? o : null;
  each((i, v) => { o[i] = mode === 'add' ? Math.max(old[i], v) : Math.max(0, old[i] - v); });
  return any(o) ? o : null;
}

/* smartselect_cmds.rs with_sampler：当前层的像素（层被移动过 ⇒ 按 L.x/L.y 读，层外＝透明，铁律④）；sampleAllLayers 或当前层没像素 ⇒ 合成图 */
function samplePixels(all){
  const L = Doc.active(), W = Doc.width, H = Doc.height;
  if (!all && L && L.kind === 'raster' && L.data && L.data.ctx) return L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), W, H).data;
  return composite(1).getContext('2d').getImageData(0, 0, W, H).data;
}
/* apply：区域跟目前选区按 mode 合成，写回 Doc.sel；找不到又是加／减 ⇒ 选区与历史都不动（这一步的历史退掉） */
function applyRegion(reg, mode){
  const W = Doc.width, H = Doc.height;
  if (!reg && (mode === 'add' || mode === 'subtract')){
    if (CMD._depth === 1 && History.past.length) History.past.pop();     // 原码 apply：没进 s.edit ⇒ 不占一步历史
    return {ok:true, selected:!!Doc.sel, changed:false};
  }
  const old = Doc.sel && window.SelMask ? SelMask.bytes() : null;
  const out = combineRegion(old, reg, mode, W, H);
  Doc.sel = out ? SelMask.fromBytes(out) : null;
  const bounds = reg ? [reg.bbox[0], reg.bbox[1], rW(reg.bbox), rH(reg.bbox)] : null;
  return {ok:true, selected:!!Doc.sel, changed:true, bounds, selection:Doc.sel};
}
/* 增强边缘：matting::refine_mask(ENHANCE)。演算法借 PsSelect.algo.refineMask（ps-select.js 已照 matting.rs 翻好）；P 的衍生量照它的 refineParams 公式 */
const ENHANCE = {radius:4, smartRadius:true, smooth:15, feather:0, contrast:25, shiftEdge:0};
function refineP(e){
  const P = Object.assign({}, e);
  P.gfRadius = Math.min(64, Math.max(1, Math.ceil(P.radius)));
  P.smoothSigma = Math.min(100, Math.max(0, P.smooth)) / 100 * 4;
  P.featherSigma = Math.max(0, P.feather) / 2;
  P.shiftPx = Math.min(64, Math.max(-64, Math.round(P.shiftEdge / 100 * Math.max(P.radius, 4))));
  P.usesImage = P.radius > 0;
  const g = P.gfRadius;
  P.halo = (P.usesImage ? Math.max(Math.ceil(P.radius), 2 * g + (P.smartRadius ? g + 1 : 0)) : 0) + Math.ceil(3 * P.smoothSigma) + Math.ceil(3 * P.featherSigma) + Math.abs(P.shiftPx) + 2;
  P.spread = (P.usesImage ? Math.ceil(P.radius) : 0) + Math.ceil(3 * P.smoothSigma) + Math.ceil(3 * P.featherSigma) + Math.max(0, P.shiftPx) + 1;
  return P;
}
function enhanceRegion(reg, src, W, H){
  const rm = window.PsSelect && PsSelect.algo && PsSelect.algo.refineMask;
  if (!rm || !reg) return reg;
  const full = new Uint8Array(W * H), bw = rW(reg.bbox);
  for (let y = reg.bbox[1]; y < reg.bbox[3]; y++) for (let x = reg.bbox[0]; x < reg.bbox[2]; x++) full[y * W + x] = reg.mask[(y - reg.bbox[1]) * bw + (x - reg.bbox[0])];
  const rgb = makeSampler(src, W, H).rgb([0, 0, W, H]).px;
  const out = rm(full, rgb, W, H, refineP(ENHANCE));
  return out ? trimRegion({bbox:[0, 0, W, H], mask:out}) : null;
}

const SmartSeg = window.SmartSeg = {
  makeSampler, downsample, scaleFor, Rng, subsample, kmeans, gmmFit, refit, negLog, logProb, Graph, contrastBeta, gridCut, dataCosts,
  components, keepSeeded, cleanMask, antialiasU8, trimRegion, finishRegion, broadModel, strokeMask, tipDabs, strokeMaskTip, blur3, geodesic, segment, quickSelect,
  grabcut, objectSelect, combineRegion, samplePixels, applyRegion, enhanceRegion, WORK_PX, liveInit, liveGrow, liveSettle, LIVE_PX, LIVE_SETTLE, ctlFactor, outlineTiles
};

/* ═══════════════════════ 命令（smartselect_cmds.rs quick_selection） ═══════════════════════ */
const parsePts = a => (Array.isArray(a) ? a : []).map(q => Array.isArray(q) ? (isFinite(q[2]) && typeof q[2] === 'number' ? [q[0], q[1], q[2]] : [q[0], q[1]]) : (q && (isFinite(q.pressure) ? [q.x, q.y, q.pressure] : [q.x, q.y])))
  .filter(q => q && typeof q[0] === 'number' && typeof q[1] === 'number' && isFinite(q[0]) && isFinite(q[1]));
/* 画笔设置参数（PS 快速选择的画笔选取器）：spacing 1..1000 %=25、spacingEnabled=true、angle -180..180°=0、roundness 1..100 %=100、hardness 0..100 %=100、
   sizeControl "off|pen|wheel"="off"（关／钢笔压力／钢笔斜度／光笔轮） */
const SIZE_CTLS = ['off', 'pen', 'wheel'];
const parseTip = p => {
  const n = (k, d) => isFinite(+p[k]) && p[k] !== null && p[k] !== undefined && p[k] !== '' ? +p[k] : d;
  return {spacing:Math.min(10, Math.max(0.01, n('spacing', 25) / 100)), spacingEnabled:p.spacingEnabled !== false, angle:Math.min(180, Math.max(-180, n('angle', 0))),
          roundness:Math.min(1, Math.max(0.01, n('roundness', 100) / 100)), hardness:Math.min(1, Math.max(0, n('hardness', 100) / 100)),
          sizeControl:SIZE_CTLS.includes(p.sizeControl) ? p.sizeControl : 'off'};
};
/* quickselect.select 的参数 → 算法实际用的 {pts, size, tip} 与快取键（停笔精修的结果按这个键给放开时直接用） */
function selectKey(p){
  const pts = parsePts(p.points), size = Math.min(5000, Math.max(1, isFinite(+p.size) && p.size !== undefined && p.size !== null ? +p.size : 30)), tip = parseTip(p);
  return {pts, size, tip, key:JSON.stringify([pts, size, tip, p.sampleAllLayers === true])};
}
/* 指针事件 → 这一刻的大小比例（照 PS「大小」控制）：pen＝pressure；tilt＝笔身离垂直的角度（tiltX／tiltY 或 altitudeAngle，0°＝最小、≥60°＝满）；
   wheel＝光笔轮（喷枪笔的 tangentialPressure −1..1 → 0..1）。滑鼠／没这项资料＝null（PS：没有这种输入就没作用、照原大小） */
function ctlFactor(e, ctl){
  if (!e || !ctl || ctl === 'off' || !e.pointerType || e.pointerType === 'mouse') return null;
  if (ctl === 'pen') return e.pressure > 0 ? Math.min(1, e.pressure) : null;
  if (ctl === 'tilt'){
    let deg = null;
    if (isFinite(e.tiltX) && isFinite(e.tiltY) && (e.tiltX || e.tiltY)){ const tx = Math.tan(e.tiltX * Math.PI / 180), ty = Math.tan(e.tiltY * Math.PI / 180); deg = Math.atan(Math.hypot(tx, ty)) * 180 / Math.PI; }
    else if (isFinite(e.altitudeAngle) && e.altitudeAngle < Math.PI / 2 - 1e-6) deg = 90 - e.altitudeAngle * 180 / Math.PI;
    return deg === null ? null : Math.min(1, Math.max(0.01, deg / 60));
  }
  if (ctl === 'wheel') return isFinite(e.tangentialPressure) && e.tangentialPressure !== 0 ? Math.min(1, Math.max(0.01, (e.tangentialPressure + 1) / 2)) : null;
  return null;
}
CMD.reg('quickselect.select', {i18n:'tool.quickselect', undoable:true,
  params:'{points:[[x,y,pressure?]…] 文件坐标（笔画经过的点，至少 1 点）, size=30 px（笔刷直径 1..5000）, mode:"add|subtract|replace"="add"（"new" 同 replace）, sampleAllLayers=false（false＝当前像素层，层被移动过照样对；当前层不是像素层＝合成图）, enhanceEdge=false, ' +
         'spacing:1..1000 %=25, spacingEnabled=true（false＝每个点盖一个）, angle:-180..180°=0, roundness:1..100 %=100, hardness:0..100 %=100（软笔尖只算 50% 轮廓以内）, sizeControl:"off|pen|wheel"="off"（钢笔压力／钢笔斜度／光笔轮：点的第三格＝大小比例 0..1）（PS 画笔设置：笔尖照这个椭圆沿笔画盖章当种子）} ' +
         '同 PhotoCraft select.quick：笔画像素当硬前景、测地距离（越过边才远）在边后面取背景样本、两边高斯混合＋对比敏感图割贴边，只留碰到笔画的连通块；大图先在约 16 万像素的工作解析度算、再沿边全解析度重切；' +
         '增强边缘＝选择并遮住（半径 4 智能、平滑 15、对比 25）。找不到又是加／减＝选区与历史都不动 → {ok, selected, changed, bounds:[x,y,w,h]|null}'},
  p => {
    const {pts, size, tip, key} = selectKey(p);
    if (!pts.length) return {ok:false, error:'select.quick: needs at least one point'};
    const m0 = typeof p.mode === 'string' ? p.mode : 'add';
    const mode = m0 === 'subtract' ? 'subtract' : (m0 === 'replace' || m0 === 'new') ? 'replace' : 'add';
    const W = Doc.width, H = Doc.height;
    const src = samplePixels(p.sampleAllLayers === true);
    // 停笔时已经整条精修过、笔画没再变 ⇒ 直接用那份（逐位一样）：工具＝QS.settled（只给这一下放开用）；选择并遮住工作区＝regCache（工作区开着时影像不会变，整段重算时旧笔画也不用再算）
    const pre = QS.settled, cache = SmartSeg.regCache;
    let reg;
    if (pre && QS.busy && pre.key === key) reg = pre.reg;
    else if (cache && cache.has(key)) reg = cache.get(key);
    else { reg = quickSelect(makeSampler(src, W, H), [0, 0, W, H], pts, size, WORK_PX, tip); cachePut(key, reg); }
    QS.settled = null;
    if (p.enhanceEdge === true && reg) reg = enhanceRegion(reg, src, W, H);
    return applyRegion(reg, mode);
  });

/* regCache：选择并遮住工作区开着时挂一个 Map（最多记 16 笔，旧的先丢） */
function cachePut(key, reg){ const c = SmartSeg.regCache; if (!c) return; c.delete(key); c.set(key, reg); while (c.size > 16) c.delete(c.keys().next().value); }
SmartSeg.selectKey = selectKey; SmartSeg.parseTip = parseTip; SmartSeg.cachePut = cachePut; SmartSeg.regCache = null;
if (window.__segWorker) return; // worker shares these exact algorithms; no DOM or tools in its realm

/* Each job owns a worker. Terminate cancels the graph cut immediately; results never mutate a document themselves. */
const workerUrl = new URL('quickselect-worker.js', document.currentScript ? document.currentScript.src : new URL('tools/quickselect.js', document.baseURI));
SmartSeg.workerUrl = workerUrl.href;
SmartSeg.canAsync = () => typeof Worker !== 'undefined' && Doc.width * Doc.height > 500000;
SmartSeg.asyncJob = function(payload){
  let worker, rejectJob, watchdog, done = false;
  const promise = new Promise((resolve, reject) => {
    rejectJob = reject;
    try {
      worker = new Worker(SmartSeg.workerUrl);
      worker.onmessage = e => { if (done) return; done = true; clearTimeout(watchdog); worker.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); };
      worker.onerror = e => { if (done) return; done = true; clearTimeout(watchdog); worker.terminate(); reject(new Error(e.message || 'Selection worker failed')); };
      watchdog=setTimeout(()=>{if(done)return;done=true;worker.terminate();reject(new Error('Selection calculation timed out'));},30000);
      worker.postMessage(payload);
    } catch(e){ done = true; if (worker) worker.terminate(); reject(e); }
  });
  return {promise, cancel(){ if (done) return; done = true; clearTimeout(watchdog); if (worker) worker.terminate(); rejectJob(Object.assign(new Error('cancelled'), {cancelled:true})); }};
};
const layerSourceStamp=L=>[L,L.data,L.data&&L.data.canvas&&L.data.canvas.__dlPx,L.x,L.y,L.visible,L.opacity,L.blend,L.mask,L.mask&&L.mask.data&&L.mask.data.canvas&&L.mask.data.canvas.__dlPx];
SmartSeg.documentStamp=()=>({id:window.Docs?Docs.activeId():null,serial:Doc.serial,w:Doc.width,h:Doc.height,layers:Doc.layers.map(layerSourceStamp),active:Doc.activeId});
SmartSeg.sameDocument=s=>!!s&&s.id===(window.Docs?Docs.activeId():null)&&s.serial===Doc.serial&&s.w===Doc.width&&s.h===Doc.height&&s.active===Doc.activeId&&s.layers.length===Doc.layers.length&&s.layers.every((q,i)=>layerSourceStamp(Doc.layers[i]).every((v,j)=>v===q[j]));
SmartSeg.replaceLiveRegion = function(st, reg, n){
  const W = st.W, H = st.H, old = st.box; st.acc = new Uint8Array(W * H); st.done = n; st.settled = {n, reg}; st.box = reg ? reg.bbox.slice() : null;
  if (reg){ const b = reg.bbox, bw = b[2]-b[0]; for(let y=b[1];y<b[3];y++) st.acc.set(reg.mask.subarray((y-b[1])*bw,(y-b[1]+1)*bw),y*W+b[0]); }
  return rcU(old,st.box);
};


/* 边拖边长（原码无·照 PS）：笔画到目前为止长出的区域跟 base（按下时的旧选区 8 位，或 null）按 mode 合成 ⇒ 暂定选区（不写 Doc） */
function liveSelection(src, base, pts, size, mode){
  const W = Doc.width, H = Doc.height;
  const reg = quickSelect(makeSampler(src, W, H), [0, 0, W, H], pts, Math.min(5000, Math.max(1, size)), WORK_PX);
  if (!reg && (mode === 'add' || mode === 'subtract')) return {sel:base ? SelMask.fromBytes(base) : null, reg:null};
  const out = combineRegion(base, reg, mode, W, H);
  return {sel:out ? SelMask.fromBytes(out) : null, reg};
}
CMD.reg('quickselect.live', {i18n:'',
  params:'{points:[[x,y]…], size=30, mode="add|subtract|replace"="add", sampleAllLayers=false} 边拖边长的暂定选区：跟 quickselect.select 同一套算法与同样的合成，但只回结果、不改 Doc.sel、不进历史（工具拖曳中画的蚂蚁线就是这个） → {ok, selected, bounds:[x,y,w,h]|null, region:[x,y,w,h]|null, area（覆盖度>0.5 的像素数）}'},
  p => {
    const pts = parsePts(p.points);
    if (!pts.length) return {ok:false, error:'quickselect.live: needs at least one point'};
    const size = isFinite(+p.size) && p.size !== undefined && p.size !== null ? +p.size : 30;
    const m0 = typeof p.mode === 'string' ? p.mode : 'add';
    const mode = m0 === 'subtract' ? 'subtract' : (m0 === 'replace' || m0 === 'new') ? 'replace' : 'add';
    const base = Doc.sel && window.SelMask ? SelMask.bytes() : null;
    const r = liveSelection(samplePixels(p.sampleAllLayers === true), base, pts, size, mode), sel = r.sel;
    let area = 0; if (sel){ const b = SelMask.bytes(sel); for (let i = 0; i < b.length; i++) if (b[i] > 127) area++; }
    return {ok:true, selected:!!sel, bounds:sel ? [sel.x, sel.y, sel.w, sel.h] : null, region:r.reg ? [r.reg.bbox[0], r.reg.bbox[1], rW(r.reg.bbox), rH(r.reg.bbox)] : null, area};
  });

/* ═══════════════════════ 工具本体 ═══════════════════════ */
const MAX_SIDE = 1024, TRAIL_ALPHA = 40;      // canvas.rs:1881 快速选择的足迹 from_white_alpha(40)
const HARDNESS_TRAVEL = 200;
const QS = window.QuickSelectTool = {
  opt: {sampleAllLayers:false, enhanceEdge:false},      // ToolOptions 的 sample_all_layers／enhance_edge（预设都关）
  /* PS 选项栏的画笔设置（快速选择自己一份，不跟画笔共用）：硬度 %、间距 %（＋勾选框）、角度°、圆度 %、大小控制；直径＝ToolState.size（照原码共用） */
  tip: {hardness:100, spacing:25, spacingEnabled:true, angle:0, roundness:100, sizeControl:'off'},
  drag: null, trail: null, resize: null, hover: null, held: {alt:false, shift:false}, busy: false, settled: null, tipPanel: null,
  live: null,          // 边拖边长：{src, base, mode, inc（增量分割状态）, out（暂定选区 8 位）, n, sel, segs, timer, idle, cost, last, runs, costs}
  mode(m){ return m.alt ? 'subtract' : 'add'; },       // tool_feedback.rs:44-50
};
/* stroke_trail.rs：拖曳足迹（覆盖取最大、重叠不加深；大文件降采样） */
function trailNew(){
  const k = Math.max(1, Math.ceil(Math.max(Doc.width, Doc.height) / MAX_SIDE));
  const w = Math.max(1, Math.ceil(Doc.width / k)), h = Math.max(1, Math.ceil(Doc.height / k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return {c, x:c.getContext('2d'), k, w, h, cov:new Uint8Array(w * h), fed:0, dirty:null};
}
function trailCapsule(t, a, b, r){
  if (![a[0], a[1], b[0], b[1], r].every(isFinite)) return;
  const x0 = Math.max(Math.floor(Math.min(a[0], b[0]) - r - 1), 0), y0 = Math.max(Math.floor(Math.min(a[1], b[1]) - r - 1), 0);
  const x1 = Math.min(Math.ceil(Math.max(a[0], b[0]) + r + 1), t.w), y1 = Math.min(Math.ceil(Math.max(a[1], b[1]) + r + 1), t.h);
  if (x1 <= x0 || y1 <= y0) return;
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const px = x + 0.5 - a[0], py = y + 0.5 - a[1];
    const s = len2 > 0 ? clamp01((px * dx + py * dy) / len2) : 0;
    const c = Math.round(clamp01(r + 0.5 - Math.hypot(px - s * dx, py - s * dy)) * 255), i = y * t.w + x;
    if (c > t.cov[i]) t.cov[i] = c;
  }
  const D = t.dirty || (t.dirty = [x0, y0, x1, y1]);
  t.dirty = [Math.min(D[0], x0), Math.min(D[1], y0), Math.max(D[2], x1), Math.max(D[3], y1)];
}
function trailFeed(t, points, diameter){
  if (!t || t.fed >= points.length) return;
  const r = (Math.max(diameter, 1) / 2) / t.k, m = q => [q[0] / t.k, q[1] / t.k];
  for (let i = t.fed; i < points.length; i++){ const b = m(points[i]), a = i > 0 ? m(points[i - 1]) : b; trailCapsule(t, a, b, r); }
  t.fed = points.length;
  if (t.dirty){
    const [x0, y0, x1, y1] = t.dirty, w = x1 - x0, h = y1 - y0, img = t.x.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.floor(t.cov[(y0 + y) * t.w + x0 + x] * TRAIL_ALPHA / 255); }
    t.x.putImageData(img, x0, y0); t.dirty = null;
  }
}
/* brush_resize.rs resized：左右＝直径（圈边跟着游标）、上下＝硬度 */
function resized(start, dx, dy, zoom){
  dx = isFinite(dx) ? dx : 0; dy = isFinite(dy) ? dy : 0; zoom = (isFinite(zoom) && zoom > 0) ? zoom : 1;
  return [Math.min(Math.max(Math.round(start[0] + 2 * dx), 1), 5000), Math.round(clamp01(start[1] + dy * zoom / HARDNESS_TRAVEL) * 100) / 100];
}

/* 选项（quickselect.options：选项栏、Ctrl+Alt 拖、[ ] 键都只叫这条） */
CMD.reg('quickselect.options', {i18n:'',
  params:'{size?=1..5000 px（笔刷直径，跟笔刷共用 ToolState.size）, hardness?=0..100 %（快速选择自己的；软笔尖只算 50% 轮廓以内）, spacing?=1..1000 %, spacingEnabled?=bool, angle?=-180..180°, roundness?=1..100 %, ' +
         'sizeControl?="off|pen|wheel"（大小：关／钢笔压力／钢笔斜度／光笔轮；滑鼠＝没作用）, sampleAllLayers?=bool, enhanceEdge?=bool}（PS 选项栏的画笔设置；拖着就照这些取样） → 目前全部选项'},
  p => {
    const t = QS.tip, lim = {hardness:[0, 100], spacing:[1, 1000], angle:[-180, 180], roundness:[1, 100]};
    if (p.size !== undefined && isFinite(+p.size)) ToolState.size = Math.min(5000, Math.max(1, Math.round(+p.size)));
    for (const f in lim) if (p[f] !== undefined && p[f] !== null && p[f] !== '' && isFinite(+p[f])) t[f] = Math.min(lim[f][1], Math.max(lim[f][0], Math.round(+p[f])));
    if (typeof p.spacingEnabled === 'boolean') t.spacingEnabled = p.spacingEnabled;
    if (SIZE_CTLS.includes(p.sizeControl)) t.sizeControl = p.sizeControl;
    if (typeof p.sampleAllLayers === 'boolean') QS.opt.sampleAllLayers = p.sampleAllLayers;
    if (typeof p.enhanceEdge === 'boolean') QS.opt.enhanceEdge = p.enhanceEdge;
    if (window.UI && ToolState.cur === 'quickselect' && !QS.resize){ if (QS.tipPanel) tipSync(); else UI.buildOptions('quickselect'); }
    return Object.assign({size:ToolState.size}, t, {sampleAllLayers:QS.opt.sampleAllLayers, enhanceEdge:QS.opt.enhanceEdge});
  });
/* 送给 quickselect.select 的画笔设置（跟面板一样的单位：% 与 °） */
const tipParams = () => Object.assign({}, QS.tip);

/* 边拖边长：节流排程（上次算花多久就至少隔多久、最少 60 ms）；增量分割（liveGrow）只算新进的那一小段；停笔 LIVE_SETTLE ms 整条精修一次 */
function liveStart(press){
  if(QS.pending){ QS.pending.hold=true; if(QS.pending.job) QS.pending.job.cancel(); QS.pending.job=null; }
  const src = samplePixels(QS.opt.sampleAllLayers), W = Doc.width, H = Doc.height, base = Doc.sel && window.SelMask ? SelMask.bytes() : null;
  QS.live = {src, base, mode:QS.mode(press), inc:liveInit(src, W, H), out:base ? Uint8Array.from(base) : new Uint8Array(W * H),
             stamp:SmartSeg.documentStamp(), n:0, sel:null, segs:null, timer:0, idle:0, cost:0, last:0, runs:0, costs:[], settles:[]};
  QS.settled = null;
  liveSchedule();
}
function liveSchedule(){
  const lv = QS.live; if (!lv || lv.timer) return;
  clearTimeout(lv.idle); lv.idle = 0; if (lv.job){ lv.job.cancel(); lv.job = null; }
  const wait = Math.max(0, Math.max(60, lv.cost) - (performance.now() - lv.last));
  lv.timer = setTimeout(() => { lv.timer = 0; liveRun(); }, wait);
}
/* 累积区域 acc 的 U 那块跟按下时的旧选区合成进暂定选区（加＝取大、减＝扣掉） */
function liveCompose(lv, U){
  if (!U) return;
  const W = Doc.width, acc = lv.inc.acc, base = lv.base, out = lv.out, sub = lv.mode === 'subtract';
  for (let y = Math.max(0, U[1]); y < Math.min(Doc.height, U[3]); y++) for (let x = Math.max(0, U[0]); x < Math.min(W, U[2]); x++){
    const i = y * W + x, o = base ? base[i] : 0, v = acc ? acc[i] : 0;
    out[i] = sub ? Math.max(0, o - v) : Math.max(o, v);
  }
}
/* 暂定选区的蚂蚁线：分块轮廓只重算 U 那几块（第一次＝旧选区外框也算进来）。
   lv.sel：拖动中＝遮罩就是 lv.out、外框用累积的大概外框（不扫整张）；停笔精修后（tight）＝SelMask.fromBytes 的准外框（跟放开提交的一样） */
function liveShow(lv, U, tight){
  if (!lv.ot){ lv.ot = {W:Doc.width, H:Doc.height, tiles:new Map()}; const s = Doc.sel; U = s ? rcU(U, [Math.max(0, Math.floor(s.x)), Math.max(0, Math.floor(s.y)), Math.min(Doc.width, Math.ceil(s.x + s.w)), Math.min(Doc.height, Math.ceil(s.y + s.h))]) : U; }
  lv.segs = outlineTiles(lv.ot, lv.out, U);
  if (U) lv.box = rcU(lv.box, U);
  if (tight) lv.sel = SelMask.fromBytes(Uint8Array.from(lv.out));
  else if (lv.segs.length && lv.box){
    lv.sel = {x:lv.box[0], y:lv.box[1], w:lv.box[2] - lv.box[0], h:lv.box[3] - lv.box[1], shape:'mask'};
    Object.defineProperty(lv.sel, 'mask', {value:{w:Doc.width, h:Doc.height, data:lv.out}, enumerable:false});
  } else lv.sel = null;
  lv.runs++;
  if (window.UI) (UI.drawView||UI.draw).call(UI);
}
const rcU = (a, b) => !a ? (b ? b.slice() : null) : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const livePts = d => parsePts(d.points);
function liveRun(){
  const lv = QS.live, d = QS.drag; if (!lv || !d || QS.live !== lv) return;
  if(!SmartSeg.sameDocument(lv.stamp)){ QS.drag=null;liveStop();return; }
  if(SmartSeg.canAsync()){liveRunAsync(lv,d);return;}
  if (d.points.length === lv.n) return;
  const t0 = performance.now();
  lv.n = d.points.length; QS.phase='coarse';
  const U = liveGrow(lv.inc, livePts(d), Math.min(5000, Math.max(1, ToolState.size)), parseTip(tipParams()));
  const t1=performance.now();QS.phase='compose';
  if(U||!lv.runs)liveCompose(lv,U);
  const t2=performance.now();QS.phase='render';
  if(U||!lv.runs)liveShow(lv,U);
  const t3=performance.now();QS.lastParts=[t1-t0,t2-t1,t3-t2];QS.phase='idle';
  lv.last = performance.now(); lv.cost = lv.last - t0; lv.costs.push(+lv.cost.toFixed(1));
  if (QS.drag && QS.drag.points.length !== lv.n) liveSchedule();     // 算的期间又进了点
  else lv.idle = setTimeout(liveSettleRun, LIVE_SETTLE);              // 停笔：整条精修
}
function liveRunAsync(lv,d){
  if(lv.failed||lv.coarseJob||d.points.length===lv.n)return;
  const q=Object.assign(tipParams(),{points:d.points,size:ToolState.size,sampleAllLayers:QS.opt.sampleAllLayers});
  const job=lv.coarseJob=SmartSeg.asyncJob({kind:'coarse',src:lv.src,w:lv.stamp.w,h:lv.stamp.h,q,acc:lv.inc.acc,done:lv.inc.done,box:lv.inc.box});
  job.promise.then(r=>{
    if(QS.live!==lv||QS.drag!==d||lv.coarseJob!==job||!SmartSeg.sameDocument(lv.stamp))return;
    const t0=performance.now();lv.n=r.n;lv.inc.acc=r.acc;lv.inc.done=r.n;lv.inc.box=r.box;
    liveCompose(lv,r.U);liveShow(lv,r.U);lv.cost=performance.now()-t0;lv.last=performance.now();lv.costs.push(+lv.cost.toFixed(1));(lv.workerCosts||(lv.workerCosts=[])).push(r.cost);
  },e=>{if(!e.cancelled){lv.failed=true;QS.asyncError=e.message;}}).finally(()=>{
    if(lv.coarseJob!==job)return;lv.coarseJob=null;
    if(QS.live!==lv||QS.drag!==d||lv.failed)return;
    if(d.points.length!==lv.n)liveSchedule();else lv.idle=setTimeout(liveSettleRun,LIVE_SETTLE);
  });
}
function liveSettleRun(){
  const lv = QS.live, d = QS.drag; if (!lv || !d || QS.live !== lv || !SmartSeg.sameDocument(lv.stamp)) return;
  lv.idle = 0; if (d.points.length !== lv.n || (lv.inc.settled && lv.inc.settled.n === lv.n)) return;
  const t0 = performance.now(), q = Object.assign(tipParams(), {points:d.points, size:ToolState.size, sampleAllLayers:QS.opt.sampleAllLayers}), {pts,size,tip,key} = selectKey(q);
  const accept = reg => { const U = SmartSeg.replaceLiveRegion(lv.inc,reg,pts.length); QS.settled = {key,reg}; liveCompose(lv,U); liveShow(lv,U,true); lv.settles.push(+(performance.now()-t0).toFixed(1)); };
  if (!SmartSeg.canAsync()){ accept(quickSelect(makeSampler(lv.src,Doc.width,Doc.height),[0,0,Doc.width,Doc.height],pts,size,WORK_PX,tip)); return; }
  if (lv.job) lv.job.cancel();
  QS.workerStarts=(QS.workerStarts||0)+1;
  const stamp = SmartSeg.documentStamp(), job = lv.job = SmartSeg.asyncJob({kind:'quick',src:lv.src,w:Doc.width,h:Doc.height,q});
  job.promise.then(r => { if (QS.live === lv && QS.drag === d && lv.job === job && d.points.length === pts.length && SmartSeg.sameDocument(stamp)) accept(r.reg); }, e => { if (!e.cancelled) QS.asyncError = e.message; }).finally(() => { if(lv.job === job) lv.job=null; });
}
function liveStop(){ const lv = QS.live; if (lv){ clearTimeout(lv.timer); clearTimeout(lv.idle); if(lv.job) lv.job.cancel();if(lv.coarseJob)lv.coarseJob.cancel(); QS.lastLive = {runs:lv.runs, costs:lv.costs, settles:lv.settles}; } QS.live = null; }

/* 收点：大小控制开着、这一下有那种输入（压力／斜度／光笔轮）⇒ 点带第三格＝大小比例 */
function ptCtl(pt, e){
  const f = ctlFactor(e, QS.tip.sizeControl), q = [pt[0], pt[1]];
  if (f !== null) q.push(+f.toFixed(3));
  return q;
}
/* retouch_ui.rs finish_stroke 的 QuickSelection 段（＋PS 画笔设置：笔尖形状、硬度、大小控制） */
function finishStroke(points, press, lv){
  if(lv&&!SmartSeg.sameDocument(lv.stamp)){QS.settled=null;return {ok:false,error:"stroke belongs to another document"};}
  if (lv && SmartSeg.canAsync()){
    const q = Object.assign(tipParams(), {points, size:ToolState.size, mode:QS.mode(press),sampleAllLayers:QS.opt.sampleAllLayers,enhanceEdge:QS.opt.enhanceEdge});
    const k = selectKey(q), pre = QS.settled;
    if (pre && pre.key === k.key && !q.enhanceEdge && !QS.pending){ QS.busy = true; try { return CMD.run('quickselect.select',q); } finally { QS.busy = false; QS.settled=null; } }
    if(!lv.inc.acc){ lv.inc.acc=strokeMaskTip(tipDabs(k.pts,k.size,k.tip),k.tip,Doc.width,Doc.height,1,0,0);lv.inc.box=[0,0,Doc.width,Doc.height]; }
    const reg = lv.inc.acc ? trimRegion({bbox:[0,0,Doc.width,Doc.height],mask:lv.inc.acc}) : null;
    const old = QS.pending, compatible = old && pendingMatches(old);
    if(old && old.job) old.job.cancel();
    const plan = compatible ? old.plan.slice() : [], base = compatible ? old.base : lv.base;
    const result = CMD.run('quickselect.applyRegion',{reg,mode:q.mode,outline:lv.segs});
    if (!result || result.ok === false || result.changed === false){ if(compatible){QS.pending=old;pendingResume();}else QS.pending=null; return result; }
    plan.push({q,ticket:History.past[History.past.length-1]});
    const pending = QS.pending = {plan,base,stamp:SmartSeg.documentStamp(),sel:Doc.sel,past:History.past.slice(),future:History.future.slice(),src:lv.src,sources:Object.assign({},compatible?(old.sources||{[String(old.plan[0].q.sampleAllLayers===true)]:old.src}):{}, {[String(q.sampleAllLayers===true)]:lv.src}),hold:false,job:null};
    pendingStart(pending);
    return result;
  }
  QS.busy = true;
  try {
    return CMD.run('quickselect.select', Object.assign(tipParams(), {points:points.map(q => q.length > 2 && isFinite(q[2]) ? [q[0], q[1], q[2]] : [q[0], q[1]]), size:ToolState.size, mode:QS.mode(press),
      enhanceEdge:QS.opt.enhanceEdge, sampleAllLayers:QS.opt.sampleAllLayers}));
  } finally { QS.busy = false; QS.settled = null; }
}


function pendingStart(pending){
  pending.hold=false;
  const job=pending.job=SmartSeg.asyncJob({kind:'sequence',src:pending.src,sources:pending.sources,w:pending.stamp.w,h:pending.stamp.h,base:pending.base,steps:pending.plan.map(x=>x.q)});
  job.promise.then(r=>{if(QS.pending===pending&&pending.job===job&&!pending.hold&&pendingMatches(pending))CMD.run('quickselect.refinePending',{pending,result:r});},e=>{if(!e.cancelled){QS.asyncError=e.message;if(window.Locks&&Locks.notify)Locks.notify('快速選擇精修未能執行：'+e.message);}}).finally(()=>{if(QS.pending===pending&&pending.job===job&&!pending.hold)QS.pending=null;});
}
function pendingResume(){const p=QS.pending;if(p&&p.hold){if(pendingMatches(p))pendingStart(p);else QS.pending=null;}}
function pendingMatches(p){ return SmartSeg.sameDocument(p.stamp) && Doc.sel === p.sel && History.past.length === p.past.length && History.future.length === p.future.length && p.past.every((x,i)=>History.past[i]===x) && p.future.every((x,i)=>History.future[i]===x); }
CMD.reg('quickselect.applyRegion',{i18n:'tool.quickselect',undoable:true,refresh:'view',params:'{reg,mode} Internal live selection commit'},p=>{const r=applyRegion(p.reg,p.mode);if(p.outline&&Doc.sel)SelMask._outline={sel:Doc.sel,segs:p.outline};return r;});
CMD.reg('quickselect.refinePending',{i18n:'',undoable:false,refresh:'view',params:'{} Internal background result'},p=>{
  if(!p.pending || QS.pending!==p.pending || !pendingMatches(p.pending)) return {ok:false,error:'stale selection result'};
  p.pending.plan.forEach((x,i)=>{ if(x.ticket) x.ticket.sel=p.result.before[i] ? SelMask.fromBytes(p.result.before[i]) : null; });
  Doc.sel=p.result.out ? SelMask.fromBytes(p.result.out) : null;
  if(Doc.sel)SelMask._outline={sel:Doc.sel,segs:p.result.outline||[]};
  return {ok:true};
});
const DASH = 4;
function drawSelOutline(ctx, s, dpr){
  const lv = QS.live && QS.live.runs ? QS.live : null;               // 边拖边长：画暂定选区（还没提交）
  const sel = lv ? lv.sel : Doc.sel; if (!(sel && window.SelMask && (sel.mask || lv))) return;     // 满格矩形 ui.js 已经画了
  const sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
  ctx.save(); ctx.lineWidth = 1;
  ctx.beginPath(); (lv ? lv.segs || [] : SelMask.outline(sel)).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
  ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([DASH * dpr, DASH * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}
/* tool_feedback.rs draw_badge（centred＝true：画在笔尖圈正中） */
function drawBadge(ctx, c, mode, dpr){
  if (mode === 'replace') return;
  const h = 3.5 * dpr;
  const segs = mode === 'add' ? [[[c[0] - h, c[1]], [c[0] + h, c[1]]], [[c[0], c[1] - h], [c[0], c[1] + h]]] : [[[c[0] - h, c[1]], [c[0] + h, c[1]]]];
  ctx.save();
  for (const [w, col] of [[3, 'rgba(0,0,0,0.78)'], [1.2, '#fff']]){
    ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath();
    segs.forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }); ctx.stroke();
  }
  ctx.restore();
}

/* ── 选项栏的画笔设置面板（PS 快速选择的画笔预设选取器：大小、硬度、间距（＋勾选框）、角度、圆度、大小控制，下面画笔尖形状）。
   全走 quickselect.options；样式跟选择并遮住工作区的 .samtip 一样（那份 CSS 只在工作区开着时才挂，这里自己挂一份） */
const QS_TIP_CSS = `.qstip{position:fixed;z-index:10050;background:var(--bg2,#262626);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:4px;padding:8px 10px;box-shadow:0 4px 14px rgba(0,0,0,.5);font-size:12.5px;display:flex;flex-direction:column;gap:6px;width:240px}
.qstip .r{display:flex;align-items:center;gap:6px}.qstip .r>span:first-child{width:52px}.qstip input[type=range]{flex:1;min-width:0}.qstip input[type=number]{width:50px}
.qstip canvas{align-self:center;background:#fff;border-radius:3px}`;
const TIP_ROWS = [['size', 'ui.qsSize', 1, 5000, 'px'], ['hardness', 'ui.qsHard', 0, 100, '%'], ['spacing', 'ui.qsSpacing', 1, 1000, '%'], ['angle', 'ui.qsAngle', -180, 180, '°'], ['roundness', 'ui.qsRound', 1, 100, '%']];
const tipVal = f => f === 'size' ? ToolState.size : QS.tip[f];
function tipOpen(anchor){
  tipClose();
  if (!document.getElementById('qs-tip-css')){ const st = document.createElement('style'); st.id = 'qs-tip-css'; st.textContent = QS_TIP_CSS; document.head.appendChild(st); }
  const pn = document.createElement('div'); pn.className = 'qstip'; pn.dataset.qsTip = '1';
  const span = t => { const s = document.createElement('span'); s.textContent = t; return s; };
  const row = ([f, lk, min, max, unit]) => {
    const r = document.createElement('div'); r.className = 'r';
    const rg = document.createElement('input'), nm = document.createElement('input');
    rg.type = 'range'; nm.type = 'number'; rg.min = nm.min = min; nm.max = max; rg.max = f === 'size' ? 500 : max; rg.dataset.k = nm.dataset.k = 'tip.' + f;
    rg.value = nm.value = tipVal(f);
    const set = v => { if (isFinite(v)) CMD.run('quickselect.options', {[f]:v}); };
    rg.oninput = () => set(parseFloat(rg.value)); nm.onchange = () => set(parseFloat(nm.value));
    nm.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape'){ ev.preventDefault(); if (ev.key === 'Enter') set(parseFloat(nm.value)); tipClose(); } });
    let lb = span(Lang.t(lk));
    if (f === 'spacing'){                                             // PS：间距前面一个勾选框；勾掉＝每个事件点盖一个
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.k = 'tip.spacingEnabled'; cb.checked = QS.tip.spacingEnabled !== false;
      cb.onchange = () => CMD.run('quickselect.options', {spacingEnabled:cb.checked});
      lb = document.createElement('span'); const l = document.createElement('label'); l.append(cb, Lang.t(lk)); lb.appendChild(l);
      rg.disabled = nm.disabled = QS.tip.spacingEnabled === false;
    }
    r.append(lb, rg, nm, span(unit)); pn.appendChild(r);
    if (f === 'size'){                                                // PS：大小底下「大小：关／钢笔压力／钢笔斜度／光笔轮」
      const r2 = document.createElement('div'); r2.className = 'r'; const s = document.createElement('select'); s.dataset.k = 'tip.sizeControl';
      for (const v of SIZE_CTLS){ const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('ui.qsCtl.' + v); s.appendChild(o); }
      s.value = QS.tip.sizeControl; s.onchange = () => CMD.run('quickselect.options', {sizeControl:s.value});
      s.addEventListener('keydown', ev => ev.stopPropagation());
      r2.append(span(Lang.t('ui.qsSizeCtl')), s); pn.appendChild(r2);
    }
    if (f === 'hardness'){ const cv = document.createElement('canvas'); cv.width = 90; cv.height = 60; cv.dataset.k = 'tipShape'; pn.appendChild(cv); }
  };
  TIP_ROWS.forEach(row);
  document.body.appendChild(pn); QS.tipPanel = pn;
  const b = anchor.getBoundingClientRect(); pn.style.left = Math.round(b.left) + 'px'; pn.style.top = Math.round(b.bottom + 4) + 'px';
  tipDraw();
  setTimeout(() => { if (QS.tipPanel === pn) document.addEventListener('pointerdown', QS.tipOff = ev => { if (!pn.contains(ev.target) && !anchor.contains(ev.target)) tipClose(); }, true); }, 0);
}
function tipClose(){
  if (!QS.tipPanel) return;
  QS.tipPanel.remove(); QS.tipPanel = null;
  if (QS.tipOff){ document.removeEventListener('pointerdown', QS.tipOff, true); QS.tipOff = null; }
}
function tipSync(){
  const pn = QS.tipPanel; if (!pn) return;
  for (const [f] of TIP_ROWS) pn.querySelectorAll(`[data-k="tip.${f}"]`).forEach(i => { if (document.activeElement !== i) i.value = tipVal(f); i.disabled = f === 'spacing' && QS.tip.spacingEnabled === false; });
  const cb = pn.querySelector('[data-k="tip.spacingEnabled"]'); if (cb) cb.checked = QS.tip.spacingEnabled !== false;
  const sc = pn.querySelector('[data-k="tip.sizeControl"]'); if (sc) sc.value = QS.tip.sizeControl;
  const lb = document.querySelector('#optBody [data-opt="brushTip"] .n'); if (lb) lb.textContent = ToolState.size;
  tipDraw();
}
/* 笔尖形状预览：硬度＝外圈渐层（50% 轮廓＝实际种子圈）、圆度／角度＝椭圆与方向线 */
function tipDraw(){
  const cv = QS.tipPanel && QS.tipPanel.querySelector('[data-k="tipShape"]'); if (!cv) return;
  const x = cv.getContext('2d'), r = 24, ro = Math.max(0.02, QS.tip.roundness / 100), an = -QS.tip.angle * Math.PI / 180, hd = QS.tip.hardness / 100, cx = cv.width / 2, cy = cv.height / 2;
  x.clearRect(0, 0, cv.width, cv.height);
  x.save(); x.translate(cx, cy); x.rotate(an); x.scale(1, ro);
  const g = x.createRadialGradient(0, 0, r * hd, 0, 0, r); g.addColorStop(0, 'rgba(34,34,34,1)'); g.addColorStop(1, 'rgba(34,34,34,0)');
  x.fillStyle = hd >= 1 ? '#222' : g; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); x.restore();
  x.strokeStyle = '#2f7fd8'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(an) * (r + 6), cy + Math.sin(an) * (r + 6)); x.stroke();
}

const STRINGS = {
  'zh-Hant':{'opt.qsSampleAll':'取樣全部圖層', 'opt.qsEnhance':'自動增強', 'ui.qsSubject':'選取主體', 'ui.qsSubjectNA':'（選取主體未載入）',
    'ui.qsTip':'筆刷設定', 'ui.qsSize':'尺寸', 'ui.qsHard':'硬度', 'ui.qsSpacing':'間距', 'ui.qsAngle':'角度', 'ui.qsRound':'圓度', 'ui.qsSizeCtl':'尺寸',
    'ui.qsCtl.off':'關', 'ui.qsCtl.pen':'筆的壓力', 'ui.qsCtl.tilt':'筆的傾斜', 'ui.qsCtl.wheel':'光筆滾輪',
    'ui.qsHint':'拖曳塗過要選的區域（自動擴大到邊緣） · 每一筆都增加 · Alt 減去 · Ctrl+Alt 拖曳改筆刷大小 · [ ] 調整大小',
    'ui.qsDiameter':'直徑：', 'ui.qsHardness':'硬度：'},
  'zh-Hans':{'opt.qsSampleAll':'对所有图层取样', 'opt.qsEnhance':'增强边缘', 'ui.qsSubject':'选择主体', 'ui.qsSubjectNA':'（选择主体未载入）',
    'ui.qsTip':'画笔设置', 'ui.qsSize':'大小', 'ui.qsHard':'硬度', 'ui.qsSpacing':'间距', 'ui.qsAngle':'角度', 'ui.qsRound':'圆度', 'ui.qsSizeCtl':'大小',
    'ui.qsCtl.off':'关', 'ui.qsCtl.pen':'钢笔压力', 'ui.qsCtl.tilt':'钢笔斜度', 'ui.qsCtl.wheel':'光笔轮',
    'ui.qsHint':'拖动涂过要选的区域（自动扩展到边缘） · 每一笔都添加 · Alt 减去 · Ctrl+Alt 拖动改画笔大小 · [ ] 调整大小',
    'ui.qsDiameter':'直径：', 'ui.qsHardness':'硬度：'},
  'en':{'opt.qsSampleAll':'Sample All Layers', 'opt.qsEnhance':'Enhance Edge', 'ui.qsSubject':'Select Subject', 'ui.qsSubjectNA':'(Select Subject not loaded)',
    'ui.qsTip':'Brush Settings', 'ui.qsSize':'Size', 'ui.qsHard':'Hardness', 'ui.qsSpacing':'Spacing', 'ui.qsAngle':'Angle', 'ui.qsRound':'Roundness', 'ui.qsSizeCtl':'Size',
    'ui.qsCtl.off':'Off', 'ui.qsCtl.pen':'Pen Pressure', 'ui.qsCtl.tilt':'Pen Tilt', 'ui.qsCtl.wheel':'Stylus Wheel',
    'ui.qsHint':'Paint over the area to select (grows to edges)  ·  every stroke adds  ·  Alt subtracts  ·  Ctrl+Alt drag resizes the brush  ·  [ ] size',
    'ui.qsDiameter':'Diameter:', 'ui.qsHardness':'Hardness:'}
};

Tools.reg({
  id:'quickselect', icon:'◌', group:'select', order:24, for:'raster', opts:['size'],
  cursor:'none',                                     // canvas.rs：笔尖圈游标（自己画）
  strings:STRINGS, qs:QS,

  onDown(e, pt, P){
    if (e.button !== undefined && e.button !== 0){ QS.drag = null; return; }
    QS.hover = pt; QS.held = {alt:e.altKey, shift:e.shiftKey};
    // brush_resize::pointer：Ctrl+Alt 按下＝改笔刷，不选
    if (e.ctrlKey && e.altKey && !QS.drag){ QS.resize = {anchor:pt.slice(), start:[ToolState.size, QS.tip.hardness / 100]}; (UI.drawView||UI.draw).call(UI); return; }
    tipClose();
    QS.drag = {start:pt.slice(), points:[ptCtl(pt, e)], press:{alt:e.altKey, shift:e.shiftKey}};
    QS.trail = trailNew(); trailFeed(QS.trail, QS.drag.points, ToolState.size);
    liveStart(QS.drag.press);
    (UI.drawView||UI.draw).call(UI);
  },
  onMove(e, pt, P){
    QS.hover = pt; QS.held = {alt:e.altKey, shift:e.shiftKey};
    if (QS.resize){
      const r = QS.resize, [size, hardness] = resized(r.start, pt[0] - r.anchor[0], pt[1] - r.anchor[1], UI.zoom);
      CMD.map['quickselect.options'].run({size, hardness:hardness * 100}); (UI.drawView||UI.draw).call(UI); return;
    }
    const d = QS.drag;
    if (d && P.down){
      const last = d.points[d.points.length - 1];
      if (Math.abs(last[0] - pt[0]) + Math.abs(last[1] - pt[1]) > 0.25) d.points.push(ptCtl(pt, e));     // tool_move：曼哈顿 >0.25 才收
      trailFeed(QS.trail, d.points, ToolState.size);
      liveSchedule();
    }
    (UI.drawView||UI.draw).call(UI);
  },
  onUp(e, pt){
    if (QS.resize){ QS.resize = null; CMD.run('quickselect.options', {}); (UI.drawView||UI.draw).call(UI); return; }
    const d = QS.drag, lv = QS.live; QS.drag = null; QS.trail = null; liveStop();
    if (!d){ (UI.drawView||UI.draw).call(UI); return; }
    const last = d.points[d.points.length - 1];
    if (last[0] !== pt[0] || last[1] !== pt[1]) d.points.push(ptCtl(pt, e));
    finishStroke(d.points, d.press, lv);
    (UI.drawView||UI.draw).call(UI);
  },
  onKey(e){
    // PS：[ ] 调笔刷大小（原码的 shortcuts 对画笔类工具同样处理）
    if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey){
      const s = ToolState.size, step = s < 10 ? 1 : s < 100 ? 5 : s < 200 ? 10 : 25;
      CMD.run('quickselect.options', {size:e.key === '[' ? s - step : s + step}); (UI.drawView||UI.draw).call(UI); return true;
    }
    if (e.key === 'Escape' && QS.drag){ QS.drag = null; QS.trail = null; liveStop(); pendingResume(); (UI.drawView||UI.draw).call(UI); return true; }
    return false;
  },
  onKeyUp(e){ if (e.key === 'Alt' || e.key === 'Shift'){ QS.held = {alt:e.altKey, shift:e.shiftKey}; if (ToolState.cur === 'quickselect') (UI.drawView||UI.draw).call(UI); } },
  onDeactivate(){ QS.drag = null; QS.trail = null; QS.resize = null; QS.hover = null; liveStop(); pendingResume(); tipClose(); },

  drawOverlay(ctx, s){
    const z = UI.zoom, dpr = s / z, scr = q => [q[0] * s, q[1] * s];
    drawSelOutline(ctx, s, dpr);
    ctx.save();
    if (QS.trail){ ctx.imageSmoothingEnabled = true; ctx.drawImage(QS.trail.c, 0, 0, QS.trail.w * QS.trail.k * s, QS.trail.h * QS.trail.k * s); }
    const at = QS.resize ? QS.resize.anchor : QS.hover;
    if (at){
      const c = scr(at), full = Math.max(ToolState.size / 2 * z, 1);
      const r = Math.max(full * (0.5 + 0.5 * clamp01(QS.tip.hardness / 100)), 1) * dpr;     // NormalTip：50% 轮廓
      const ro = Math.max(0.01, QS.tip.roundness / 100), an = -QS.tip.angle * Math.PI / 180;   // 笔尖形状：圆度、角度
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(c[0], c[1], r + 0.5 * dpr, Math.max(0.5, r * ro + 0.5 * dpr), an, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.ellipse(c[0], c[1], r, Math.max(0.5, r * ro), an, 0, Math.PI * 2); ctx.stroke();
      if (QS.resize && QS.hover){
        const h = scr(QS.hover), t1 = `${Lang.t('ui.qsDiameter')} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t('ui.qsHardness')} ${Math.round(QS.tip.hardness)}%`;
        ctx.font = `${12 * dpr}px sans-serif`;
        const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12 * dpr;
        ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0] + 14 * dpr, h[1] + 14 * dpr, w, 38 * dpr);
        ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0] + 20 * dpr, h[1] + 29 * dpr); ctx.fillText(t2, h[0] + 20 * dpr, h[1] + 45 * dpr);
      } else drawBadge(ctx, c, QS.mode(QS.drag ? QS.drag.press : QS.held), dpr);   // 拖着时用按下那一刻的修饰键
    }
    ctx.restore();
  },

  /* retouch_ui.rs:194-201 选项栏（＋PS：前面一颗画笔预设选取器，点了弹出画笔设置） */
  buildOptions(box, add, mk){
    const o = QS.opt;
    tipClose();
    const tb = document.createElement('button'); tb.type = 'button'; tb.dataset.opt = 'brushTip'; tb.title = Lang.t('ui.qsTip');
    tb.style.cssText = 'margin:0 6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px';
    const dot = document.createElement('span'); dot.textContent = '●'; const n = document.createElement('span'); n.className = 'n'; n.textContent = ToolState.size; const ar = document.createElement('span'); ar.textContent = '▾';
    tb.append(dot, n, ar); tb.onclick = () => QS.tipPanel ? tipClose() : tipOpen(tb);
    box.appendChild(tb);
    const sa = mk('checkbox', {checked:o.sampleAllLayers}); sa.dataset.opt = 'sampleAllLayers';
    sa.onchange = () => CMD.run('quickselect.options', {sampleAllLayers:sa.checked}); add('qsSampleAll', sa);
    const en = mk('checkbox', {checked:o.enhanceEdge}); en.dataset.opt = 'enhanceEdge';
    en.onchange = () => CMD.run('quickselect.options', {enhanceEdge:en.checked}); add('qsEnhance', en);
    const b = document.createElement('button'); b.type = 'button'; b.dataset.opt = 'selectSubject';
    b.textContent = Lang.t('ui.qsSubject'); b.style.cssText = 'margin:0 6px;cursor:pointer';
    b.disabled = !CMD.map['ps.select.subject'];
    b.onclick = () => { CMD.run('ps.select.subject', {}); (UI.drawView||UI.draw).call(UI); };      // 原码 select.subject（预设取样所有图层）
    box.appendChild(b);
    const h = document.createElement('span'); h.style.cssText = 'color:#7a8290;margin-left:8px'; h.textContent = Lang.t('ui.qsHint'); box.appendChild(h);
  }
});

/* ui.js 按着 Alt 时不把键交给工具 ⇒ 自己听 Alt 的按下，好即时换 ＋／− 标记 */
window.addEventListener('keydown', e => {
  if (ToolState.cur !== 'quickselect' || (e.key !== 'Alt' && e.key !== 'Shift')) return;
  if (e.key === 'Alt') e.preventDefault();
  QS.held = {alt:e.altKey, shift:e.shiftKey}; if (window.UI) (UI.drawView||UI.draw).call(UI);
}, true);

})();
