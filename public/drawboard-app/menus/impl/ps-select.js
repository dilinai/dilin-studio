/* 堤麟画板 · Photoshop ▸ 选择 菜单的实作
   对照源（photocraft/crates/…，逐段翻成 JS）：
     engine/src/commands.rs 299-318              select.deselect／select.inverse（1−覆盖度）
     engine/src/extra_cmds.rs 284-295, 584-591   select.reselect：有选区时不能用；往回翻历史找最近一份选区
     engine/src/selection_cmds.rs 1-361          colorRange／modify.*／grow／similar，与共用的 sample_pixels、set_selection、current_mask
     algo/src/selection.rs 76-151                coverage8、combine（8 位量化；全空＝取消选择）
     algo/src/selection.rs 432-539               color_range_samples、hue_chroma、hue_range、tone_range
     algo/src/selection.rs 541-636               dt1／edt（Felzenszwalb 距离变换）、expand、contract、border、smooth、feather
     algo/src/selection_blur.rs 1-579            smooth＝边缘复制的方框平均＋(v−½)·4+½；feather＝截在 ⌈3σ⌉ 的高斯（σ=半径/2、画布外当 0），
                                                 宽核用 5 项余弦级数滑动和（最小平方拟合，误差 >0.3/255 退回直接卷积）
     engine/src/select_extra_cmds.rs 76-210      isolateLayers、transformSelection（参考点、四角、矩阵、缩放／旋转／斜切／位移）
     engine/src/transform_cmds.rs 36-66          warp_gray：选区只变形遮罩，框外当 0
     algo/src/transform.rs 16-250                Homography（apply／mul／inverse／rect_to_quad）、warp_surface 的反向取样（最近／双线性／Catmull-Rom）
     engine/src/layer_multi_cmds.rs 120-135, 750-760   deselectLayers、findLayers
     engine/src/channel_cmds.rs 178-411, 657-805       存储／载入选区（Alpha 通道、透明度、合成亮度、颜色通道、选区、快速蒙版）、快速蒙版进出
     ui-egui/src/filter_dialog.rs 147-369        select.modify.* 的对话框（一格半径；范围与预设照命令说明）
     ui-egui/src/color_range_ui.rs 1-492         色彩范围对话框：选择下拉、本地化颜色簇、颜色容差、范围、阴影／高光／中间调范围、
                                                 三支吸管（Shift 加 Alt 减）、预览（选区／图像，跑在缩小的代理图上）、反相
     ui-egui/src/view_cmds.rs 911-955            存储／载入选区对话框的栏位
     ui-egui/src/menus.rs 328-335, 515           变换选区、隔离图层、选择并遮住从菜单进来的路
     engine/src/smartselect_cmds.rs 1-271        focusArea、refineEdge（选择并遮住）的参数、with_sampler、apply
     algo/src/segment/mod.rs 46-480, 602-636     RgbImage（透明叠中灰、方框缩小）、scale_for、components／components4、clean_mask、trim_region、Rng、subsample
     algo/src/segment/focus.rs 1-86              焦点区域：拉普拉斯锐利度、99 百分位、彩色导向滤波、清碎块、软边放大
     algo/src/segment/sky.rs 1-216               天空：颜色先验×平滑度、上缘种子长区域、GMM 补缝、亮度导向滤波修边
     algo/src/segment/gmm.rs 1-254               高斯混合（k-means++ 播种、Lloyd、EM）
     algo/src/matting.rs 24-560                  box_mean、guided_filter_gray／color、gaussian_blur、morph、running_extreme、edge_width、refine_buffer、refine_mask、decontaminate、masked_copy
     engine/src/select_extra_cmds.rs 47-74       select.sky
     engine/src/vector_cmds.rs 1053-1065 ＋ vector/src/trace.rs 1-399   转换为形状：marching squares 等值线、角点、Schneider 贝兹拟合
   选区格式沿用 tools/marquee.js 的 SelMask：Doc.sel = {x,y,w,h, shape?:'mask'} ＋ 不可列举的 mask（整张文件的 8 位覆盖度）。
   🔴 改文件的事全走 CMD（命令 ps.<原码 id>）；要弹对话框的项另有 ps.<原码 id>.dialog（只开对话框，确定＝跑那条命令）。 */
(function(){
'use strict';
if (window.PsSelect) return;                     // index.html 与 menus/ps-select.js 都可能挂这支档：只跑一次
const PS = window.PsSelect = {};

/* ═══════════ 共用小工具 ═══════════ */
const MODES = ['replace', 'add', 'subtract', 'intersect'];
const parseMode = m => (m === 'add' || m === 'subtract' || m === 'intersect') ? m : 'replace';   // SelectionMode::parse
const coverage8 = v => (v > 0) ? Math.floor(Math.min(1, v) * 255 + 0.5) : 0;                    // selection.rs:78（NaN → 0）
const num = (p, k, d) => (typeof p[k] === 'number' && !isNaN(p[k])) ? p[k] : d;                 // selection_cmds.rs:20 f()
const bool = (p, k, d) => typeof p[k] === 'boolean' ? p[k] : d;                                 // selection_cmds.rs:23 b()
const fail = msg => ({ok:false, error:msg});
const W = () => Doc.width, H = () => Doc.height;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const T = k => Lang.t('pssel.' + k);
const redraw = () => { if (window.UI && UI.draw){ if(Tools.modal&&Tools.modal.id==='selectAndMask'&&UI.drawView) UI.drawView(); else UI.draw(); } };

/* mask_from_surface(doc.selection, area)：目前选区 → 整张文件的 0..1 覆盖度（没选区全 0） */
function currentMask(){
  const n = W() * H(), m = new Float32Array(n);
  const bytes = (window.SelMask && Doc.sel) ? SelMask.bytes() : null;
  if (bytes) for (let i = 0; i < n; i++) m[i] = bytes[i] / 255;
  return m;
}
/* 8 位覆盖度的外框 [x0,y0,x1,y1)（content_bounds）；全空回 null */
function bytesBounds(bytes, w, h){
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++){ const o = y * w; for (let x = 0; x < w; x++) if (bytes[o + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/* selection.rs:127-151 combine：新遮罩先量化到 8 位格（q），再跟旧选区逐格合成；replace 直接写；全空 ⇒ null */
function combine(old, mask, mode){
  const n = W() * H(), out = new Uint8Array(n);
  const get = i => i < mask.length ? mask[i] : 0;                       // 遮罩太短的部分读成 0
  const q = v => coverage8(v) / 255, at = i => old ? old[i] / 255 : 0;
  if (mode === 'add')            for (let i = 0; i < n; i++) out[i] = coverage8(Math.max(at(i), q(get(i))));
  else if (mode === 'subtract')  for (let i = 0; i < n; i++) out[i] = coverage8(Math.max(at(i) - q(get(i)), 0));
  else if (mode === 'intersect') for (let i = 0; i < n; i++) out[i] = coverage8(Math.min(at(i), q(get(i))));
  else                           for (let i = 0; i < n; i++) out[i] = coverage8(get(i));
  for (let i = 0; i < n; i++) if (out[i]) return out;
  return null;
}
/* selection_cmds.rs:45-51 set_selection */
function setSelection(mask, mode){
  const out = combine(mode === 'replace' ? null : (Doc.sel ? SelMask.bytes() : null), mask, mode);
  Doc.sel = out ? SelMask.fromBytes(out) : null;
  return {ok:true, selected:!!Doc.sel, selection:Doc.sel};
}

/* selection_cmds.rs:30-43 sample_pixels：没勾所有图层且当前是像素层 ⇒ 那一层（铁律④：按 L.x/L.y 对到文件坐标，层外＝透明）；否则合成图。
   回 straight RGBA8（整张文件）；算法里一律 /255 当 0..1 用 */
function samplePixels(all){
  if (window.__segWorker) return window.__segPixels;
  const L = Doc.active(), w = W(), h = H();
  if (!all && L && L.kind === 'raster') return L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), w, h).data;
  return composite(1).getContext('2d').getImageData(0, 0, w, h).data;
}
const hasSel = () => !!Doc.sel;

/* ═══════════ 距离变换与修改（algo/selection.rs 541-623） ═══════════ */
/* 1D 平方距离变换（Felzenszwalb & Huttenlocher） */
function dt1(f, n, out, v, z){
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++){
    for (;;){
      const p = v[k];
      const s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p));
      if (s <= z[k] && k > 0){ k--; continue; }
      if (s <= z[k]){ v[0] = q; z[0] = -Infinity; z[1] = Infinity; break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity; break;
    }
  }
  k = 0;
  for (let q = 0; q < n; q++){
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}
/* 到最近一个 true 像素的欧氏距离 */
function edt(inside, w, h){
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = inside[i] ? 0 : 1e20;
  const n = Math.max(w, h, 1);
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++){
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, h, o, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = o[y];
  }
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1(f, w, o, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(o[x]);
  }
  return g;
}
/* expand：中心离最近已选中心 d 的像素在 d ≤ r 时选上（小数半径给部分覆盖） */
function expand(m, w, h, r){
  const inside = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) inside[i] = m[i] >= 0.5 ? 1 : 0;
  const d = edt(inside, w, h), out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = Math.max(m[i], clamp01(r + 1 - d[i]));
  return out;
}
function contract(m, w, h, r){
  const inv = new Float32Array(m.length); for (let i = 0; i < m.length; i++) inv[i] = 1 - m[i];
  const e = expand(inv, w, h, r);
  for (let i = 0; i < e.length; i++) e[i] = 1 - e[i];
  return e;
}
/* border：跨在选区边上、宽 r 的一条带 */
function border(m, w, h, r){
  const o = expand(m, w, h, r / 2), i = contract(m, w, h, r / 2), out = new Float32Array(m.length);
  for (let k = 0; k < m.length; k++) out[k] = Math.max(o[k] - i[k], 0);
  return out;
}

/* ═══════════ selection_blur.rs：smooth 与 feather ═══════════ */
const TERMS = 5, DIRECT_MAX_R = 12, FIT_TOL = 0.3 / 255, MAX_SIGMA = 100000, MAX_BOX_R = 1 << 24;

/* 非 0 样本的外框（NaN 也算非 0）；全 0 回 null */
function nonzeroBounds(m, w, h){
  let b = null;
  for (let y = 0; y < h; y++){
    const o = y * w; let a = -1, z = -1;
    for (let x = 0; x < w; x++) if (m[o + x] !== 0){ if (a < 0) a = x; z = x; }
    if (a < 0) continue;
    if (!b) b = {x0:a, x1:z + 1, y0:y, y1:y + 1};
    else { b.x0 = Math.min(b.x0, a); b.x1 = Math.max(b.x1, z + 1); b.y1 = y + 1; }
  }
  return b;
}
const growWin = (b, g, w, h) => ({x0:Math.max(0, b.x0 - g), x1:Math.min(w, b.x1 + g), y0:Math.max(0, b.y0 - g), y1:Math.min(h, b.y1 + g)});

/* smooth：方框平均（半径 round(r)，边缘复制），再过对比曲线 (v−½)·4+½ ⇒ 边缘变硬、小斑点掉光。
   原码只在「非 0 外框外扩 r+1」的窗口里算（窗口边落在 0 上，复制等于外面的 0）——跟整张画布算结果一样，这里直接整张算 */
function boxLine(get, n, r, put){
  if (r === 0){ for (let x = 0; x < n; x++) put(x, get(x)); return; }
  const at = i => get(i < 0 ? 0 : i >= n ? n - 1 : i);
  const inside = Math.min(r, n - 1);
  let acc = r * get(0);
  for (let i = 0; i <= inside; i++) acc += get(i);
  acc += (r - inside) * get(n - 1);
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < n; x++){ put(x, acc * norm); acc += at(x + r + 1) - at(x - r); }
}
function smooth(m, w, h, r){
  const curve = v => clamp01((v - 0.5) * 4 + 0.5);
  const n = w * h;
  const R = isFinite(r) ? Math.min(Math.round(Math.max(0, r)), MAX_BOX_R) : (r > 0 ? MAX_BOX_R : 0);
  const out = new Float32Array(n);
  if (!nonzeroBounds(m, w, h)) return out;                               // curve(0) = 0
  const tmp = new Float64Array(n);
  for (let y = 0; y < h; y++){ const o = y * w; boxLine(i => m[o + i], w, R, (x, v) => { tmp[o + x] = v; }); }
  for (let x = 0; x < w; x++) boxLine(i => tmp[i * w + x], h, R, (y, v) => { out[y * w + x] = curve(v); });
  return out;
}

/* 小线性方程组（部分主元高斯消去）；奇异回 null */
function solve(a, b){
  const n = b.length;
  for (let c = 0; c < n; c++){
    let p = c;
    for (let i = c; i < n; i++) if (Math.abs(a[i][c]) >= Math.abs(a[p][c])) p = i;   // max_by：同大取后面那个
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let i = c + 1; i < n; i++){
      const f = a[i][c] / a[c][c];
      for (let j = c; j < n; j++) a[i][j] -= f * a[c][j];
      b[i] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--){
    let s = 0; for (let j = i + 1; j < n; j++) s += a[i][j] * x[j];
    x[i] = (b[i] - s) / a[i][i];
  }
  return x.every(isFinite) ? x : null;
}
/* Kernel::new：羽化核（σ、截断半径 r）用在长 n 的线上 */
function makeKernel(sigma, r, n){
  const g = j => Math.exp(-(j * j) / (2 * sigma * sigma));
  let total = 1; for (let j = 1; j <= r; j++) total += 2 * g(j);          // 照直接定义：整个截断窗归一
  const jr = Math.min(r, Math.max(0, n - 1));                             // 只有线内的位移有用
  if (jr === 0) return {direct:Float32Array.of(1 / total)};
  const taps = []; for (let j = 0; j <= jr; j++) taps.push(g(j) / total);
  const direct = () => ({direct:Float32Array.from({length:2 * jr + 1}, (_, i) => taps[Math.abs(i - jr)])});
  if (jr <= DIRECT_MAX_R) return direct();
  // 最小平方（j = -jr..=jr 对称：j>0 权重 2）
  const l = jr + 1;
  const omega = Array.from({length:TERMS}, (_, k) => Math.PI * (k + 1) / l);
  const basis = (q, j) => q === 0 ? 1 : Math.cos(omega[q - 1] * j);
  const wt = j => j === 0 ? 1 : 2;
  const a = Array.from({length:TERMS + 1}, () => new Array(TERMS + 1).fill(0)), bb = new Array(TERMS + 1).fill(0);
  taps.forEach((t, j) => {
    const phi = []; for (let q = 0; q <= TERMS; q++) phi.push(basis(q, j));
    for (let p = 0; p <= TERMS; p++){ bb[p] += wt(j) * phi[p] * t; for (let q = 0; q <= TERMS; q++) a[p][q] += wt(j) * phi[p] * phi[q]; }
  });
  const c = solve(a, bb); if (!c) return direct();
  // 每一趟的误差上界：级数与核的 L1 距离的一半
  let err = 0;
  taps.forEach((t, j) => { let s = 0; for (let q = 0; q <= TERMS; q++) s += c[q] * basis(q, j); err += wt(j) * Math.abs(s - t); });
  err /= 2;
  if (!isFinite(err) || err > FIT_TOL) return direct();
  const full = omega.map(w => { let s = 1; for (let j = 1; j <= jr; j++) s += 2 * Math.cos(w * j); return s; });
  return {cos:{r:jr, a0:c[0], a:c.slice(1), omega, full,
    rot:omega.map(w => [Math.cos(w), -Math.sin(w)]),
    outW:omega.map(w => [Math.cos(w * jr), -Math.sin(w * jr)]),
    inW:omega.map(w => [Math.cos(w * jr), Math.sin(w * jr)])}};
}
/* Kernel::line：一条线（线外当 0）卷进 dst */
function kernelLine(K, src, dst){
  const n = Math.min(src.length, dst.length);
  if (K.direct){
    const taps = K.direct, r = taps.length >> 1;
    dst.fill(0, 0, n);
    for (let i = 0; i < taps.length; i++){
      const k = taps[i];
      const d0 = i >= r ? 0 : r - i, s0 = i >= r ? i - r : 0;               // 输出 x 读 src[x + i - r]
      if (d0 >= n || s0 >= n) continue;
      const len = Math.min(n - d0, n - s0);
      for (let t = 0; t < len; t++) dst[d0 + t] += k * src[s0 + t];
    }
    return;
  }
  cosLine(K.cos, src, dst, n);
}
/* CosKernel::line：滑动余弦级数；整个窗都是同一个值就直接写（0 可以跑出线外，非 0 不行） */
function cosLine(k, src, dst, n){
  const r = k.r;
  const runs = new Int32Array(n).fill(n);
  for (let i = n - 2; i >= 0; i--) runs[i] = src[i] === src[i + 1] ? runs[i + 1] : i + 1;
  const at = i => i < n ? src[i] : 0;
  let have = false, sb = 0;
  const sre = new Float64Array(TERMS), sim = new Float64Array(TERMS);
  for (let x = 0; x < n; x++){
    const lo = Math.max(0, x - r), hi = Math.min(x + r + 1, n), c = src[lo];
    if (runs[lo] >= hi && (c === 0 || (x >= r && x + r < n))){
      dst[x] = c; sb = c * (2 * r + 1);
      for (let t = 0; t < TERMS; t++){ sre[t] = c * k.full[t]; sim[t] = 0; }
      have = true; continue;
    }
    if (have){
      // 从 x-1 滑过来：丢 src[x-1-r]、收 src[x+r]
      const gone = x > r ? at(x - 1 - r) : 0, come = at(x + r);
      sb += come - gone;
      for (let t = 0; t < TERMS; t++){
        const re = sre[t] - gone * k.outW[t][0], im = sim[t] - gone * k.outW[t][1];
        const [cr, ci] = k.rot[t];
        sre[t] = re * cr - im * ci + come * k.inW[t][0];
        sim[t] = re * ci + im * cr + come * k.inW[t][1];
      }
    } else {
      sb = 0; sre.fill(0); sim.fill(0);
      for (let i = lo; i < hi; i++){
        const v = src[i]; if (v === 0) continue;
        const j = i - x; sb += v;
        for (let t = 0; t < TERMS; t++){ sre[t] += v * Math.cos(k.omega[t] * j); sim[t] += v * Math.sin(k.omega[t] * j); }
      }
      have = true;
    }
    let v = k.a0 * sb; for (let t = 0; t < TERMS; t++) v += k.a[t] * sre[t];
    dst[x] = v;
  }
}
/* feather：只在非 0 外框外扩 r 的窗里算；横一趟、直一趟；滑动和的舍入残渣（<1e-7）不算覆盖 */
function feather(m, w, h, radius){
  const n = w * h;
  let sigma = isFinite(radius) ? Math.fround(Math.max(0, radius) / 2) : (radius > 0 ? MAX_SIGMA : 0);
  if (sigma < 0.1 || m.length !== n || n === 0) return Float32Array.from(m);
  sigma = Math.min(sigma, MAX_SIGMA);
  const r = Math.ceil(Math.fround(sigma * 3));
  const b = nonzeroBounds(m, w, h); if (!b) return Float32Array.from(m);
  const win = growWin(b, r, w, h), gw = win.x1 - win.x0, gh = win.y1 - win.y0, bh = b.y1 - b.y0, off = b.y0 - win.y0;
  const kh = makeKernel(sigma, r, gw), kv = makeKernel(sigma, r, gh);
  const tmp = new Float32Array(bh * gw), line = new Float32Array(gw);
  for (let y = 0; y < bh; y++){
    const o = (b.y0 + y) * w + win.x0;
    for (let x = 0; x < gw; x++) line[x] = m[o + x];
    kernelLine(kh, line, tmp.subarray(y * gw, (y + 1) * gw));
  }
  const col = new Float32Array(gh), res = new Float32Array(gh), out = new Float32Array(n);
  for (let x = 0; x < gw; x++){
    for (let yy = 0; yy < gh; yy++){ const rr = yy - off; col[yy] = (rr >= 0 && rr < bh) ? tmp[rr * gw + x] : 0; }
    kernelLine(kv, col, res);
    for (let yy = 0; yy < gh; yy++){ const v = res[yy]; out[(win.y0 + yy) * w + win.x0 + x] = Math.abs(v) < 1e-7 ? 0 : v; }
  }
  return out;
}
PS.algo = {expand, contract, border, smooth, feather, edt};

/* ═══════════ 命令：重新选择／反选 ═══════════ */
/* extra_cmds.rs:284-291 reselect_target：现在有选区 ⇒ 没东西可重选；否则往回翻历史找最近一份选区 */
function reselectTarget(){
  if (Doc.sel) return null;
  for (let i = History.past.length - 1; i >= 0; i--){ const s = History.past[i]; if (s && s.sel) return s.sel; }
  return null;
}
CMD.reg('ps.select.reselect', {i18n:'', undoable:true,
  params:'{} 重新选择（Ctrl+Shift+D）：现在没有选区时，把历史里最近一份选区找回来（现在有选区＝不能用） → {ok, selected}'},
  () => {
    const m = reselectTarget();
    if (!m) return fail('there is no selection to restore');
    Doc.sel = m;                                                   // 选区物件从不原地改 ⇒ 直接沿用那份参照
    return {ok:true, selected:true, selection:Doc.sel};
  });

/* commands.rs:306-318 select.inverse：整张画布 1−覆盖度 */
CMD.reg('ps.select.inverse', {i18n:'', undoable:true,
  params:'{} 反选：选区变成 1−覆盖度（整张画布；羽化过的边一样反过来）。没有选区＝不能用 → {ok, selected, selection}'},
  () => {
    if (!hasSel()) return fail('no selection');
    const old = SelMask.bytes(), out = new Uint8Array(old.length);
    for (let i = 0; i < old.length; i++) out[i] = 255 - old[i];
    Doc.sel = SelMask.fromBytes(out);
    return {ok:true, selected:!!Doc.sel, selection:Doc.sel};
  });

/* ═══════════ 命令：修改 ▸ 边界／平滑／扩展／收缩／羽化（selection_cmds.rs:226-255） ═══════════ */
const MOD = {
  border:  {max:200,  min:1,   fn:border,   spec:'1..200=1'},
  smooth:  {max:500,  min:1,   fn:smooth,   spec:'1..500=1'},
  expand:  {max:500,  min:1,   fn:expand,   spec:'1..500=1'},
  contract:{max:500,  min:1,   fn:contract, spec:'1..500=1'},
  feather: {max:1000, min:0.1, fn:feather,  spec:'0.1..1000=1'}
};
const MOD_DOC = {
  border:'边界：跨在选区边上、宽 radius 的一条带（外扩 r/2 减内缩 r/2）',
  smooth:'平滑：边缘复制的方框平均（半径 round(r)）再过 (v−½)·4+½，去小斑点、磨圆角',
  expand:'扩展：距离变换，离选区 ≤ r 的像素选上（小数半径给部分覆盖）',
  contract:'收缩：反过来的扩展',
  feather:'羽化：σ＝半径/2 的高斯，截在 3σ，画布外当 0'
};
/* PS「应用画布边界的效果」（平滑／扩展／收缩／羽化对话框那一格，缺省不勾）：
   不勾＝选区当作越过画布边继续延伸（画布外照边上那一格复制）⇒ 贴着画布边的选区边不会被收缩／羽化进来；
   勾了＝画布外当「没选」⇒ 贴边的地方也照样收缩／羽化。原码各支对画布外的假设不一（羽化当 0、收缩／平滑等于复制），
   这里统一：选区碰到画布边、且两种假设算得不一样时，先往外垫一圈（复制或 0）再算、算完裁回来 */
const BOUNDS_NATIVE = {smooth:'replicate', expand:'any', contract:'replicate', feather:'zero'};
function touchesEdge(m, w, h){
  for (let x = 0; x < w; x++) if (m[x] > 0 || m[(h - 1) * w + x] > 0) return true;
  for (let y = 0; y < h; y++) if (m[y * w] > 0 || m[y * w + w - 1] > 0) return true;
  return false;
}
function modifyAtBounds(op, m, w, h, r, atBounds){
  const fn = MOD[op].fn, want = atBounds ? 'zero' : 'replicate', nat = BOUNDS_NATIVE[op];
  if (nat === 'any' || nat === want || !touchesEdge(m, w, h)) return fn(m, w, h, r);
  const pad = Math.min(Math.ceil(op === 'feather' ? r * 1.5 : r) + 2, 4096), pw = w + 2 * pad, ph = h + 2 * pad;
  const big = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++){
    const sy = y - pad, iy = sy < 0 ? 0 : sy >= h ? h - 1 : sy, inY = sy >= 0 && sy < h;
    for (let x = 0; x < pw; x++){
      const sx = x - pad, inX = sx >= 0 && sx < w;
      if (inX && inY) big[y * pw + x] = m[sy * w + sx];
      else if (want === 'replicate') big[y * pw + x] = m[iy * w + (sx < 0 ? 0 : sx >= w ? w - 1 : sx)];
    }
  }
  const o = fn(big, pw, ph, r), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = o[(y + pad) * pw + x + pad];
  return out;
}
function modify(p, op){
  if (!hasSel()) return fail('no selection');
  const o = MOD[op];
  const r0 = typeof p.radius === 'number' ? Math.fround(p.radius) : 1;          // 原码是 f32
  if (!isFinite(r0) || r0 > o.max) return fail(`select.modify.${op}: radius must be a number in 0..${o.max}`);   // 超范围整条拒收，不偷偷夹
  const r = Math.max(0, r0), w = W(), h = H();
  const m = currentMask();
  const out = op in BOUNDS_NATIVE ? modifyAtBounds(op, m, w, h, r, bool(p, 'applyAtCanvasBounds', false)) : o.fn(m, w, h, r);
  return setSelection(out, 'replace');
}
for (const op of Object.keys(MOD)){
  CMD.reg(`ps.select.modify.${op}`, {i18n:'', undoable:true,
    params:`{radius:${MOD[op].spec} px${op in BOUNDS_NATIVE ? ', applyAtCanvasBounds=false（PS「应用画布边界的效果」：不勾＝贴画布边的选区边不动、勾＝画布外当没选）' : ''}} ${MOD_DOC[op]}；结果取代原选区；超出范围或不是有限数＝拒收、选区不动；没有选区＝不能用 → {ok, selected, selection}`},
    p => modify(p, op));
}

/* ═══════════ 命令：扩大选取／选取相似（selection_cmds.rs:257-298） ═══════════ */
function growSimilar(p, contiguous){
  if (!hasSel()) return fail('no selection');
  const tol = num(p, 'tolerance', 32) / 255;
  const px = samplePixels(bool(p, 'sampleAllLayers', false)), m = currentMask(), w = W(), h = H(), n = w * h;
  const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) if (m[i] >= 0.5) for (let c = 0; c < 4; c++){ const v = px[i * 4 + c] / 255; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  if (lo[0] > hi[0]) return fail('selection is empty');
  const inside = i => { for (let c = 0; c < 4; c++){ const v = px[i * 4 + c] / 255; if (!(v >= lo[c] - tol - 1e-6 && v <= hi[c] + tol + 1e-6)) return false; } return true; };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = m[i] >= 0.5 ? 1 : 0;
  if (contiguous){
    const stack = []; for (let i = 0; i < n; i++) if (out[i] > 0) stack.push(i);
    while (stack.length){
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1];
      for (const j of nb) if (j >= 0 && out[j] === 0 && inside(j)){ out[j] = 1; stack.push(j); }
    }
  } else for (let i = 0; i < n; i++) if (inside(i)) out[i] = 1;
  return setSelection(out, 'replace');
}
CMD.reg('ps.select.grow', {i18n:'', undoable:true,
  params:'{tolerance:0..255=32, sampleAllLayers=false} 扩大选取：取已选像素（覆盖度 ≥0.5）四通道的颜色范围、上下各放宽 tolerance，从选区往外 4 连通长出去；没有选区＝不能用 → {ok, selected, selection}'},
  p => growSimilar(p, true));
CMD.reg('ps.select.similar', {i18n:'', undoable:true,
  params:'{tolerance:0..255=32, sampleAllLayers=false} 选取相似：同扩大选取的颜色范围，但整张图不论连不连通都选 → {ok, selected, selection}'},
  p => growSimilar(p, false));

/* ═══════════ 命令：色彩范围（selection_cmds.rs:85-224 ＋ selection.rs:432-539） ═══════════ */
/* parse_color：'#rrggbb' 或 [r,g,b]（0..1）；读不出来的通道当 0 */
function parseColor(c){
  if (Array.isArray(c) && c.length >= 3) return [0, 1, 2].map(i => typeof c[i] === 'number' ? c[i] : 0);
  if (typeof c === 'string'){
    const h = c.replace(/^#+/, '');
    const g = i => { const s = h.substr(i, 2); return /^[0-9a-fA-F]{2}$/.test(s) ? parseInt(s, 16) / 255 : 0; };
    return [g(0), g(2), g(4)];
  }
  return [0, 0, 0];
}
function hueChroma(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d <= 0) return [0, 0];
  let hh;
  if (mx === r) hh = (((g - b) / d) % 6 + 6) % 6;
  else if (mx === g) hh = (b - r) / d + 2;
  else hh = (r - g) / d + 4;
  return [hh * 60, d];
}
const remE = (a, m) => ((a % m) + m) % m;
/* 吸管样本：[[x,y]…] 文件像素 → {color, at}；不是 [x,y]、不是有限数、落在画布外 ⇒ 整条拒收 */
function eyedropperSamples(p, key, px, w, h){
  if (p[key] === undefined) return [];
  const pts = p[key];
  if (!Array.isArray(pts)) return {error:`\`${key}\` must be [[x, y], …]`};
  const out = [];
  for (const pt of pts){
    const ok = Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number' && isFinite(pt[0]) && isFinite(pt[1]);
    if (!ok) return {error:`bad point ${JSON.stringify(pt)} in \`${key}\` (want [x, y])`};
    const xi = Math.floor(pt[0]), yi = Math.floor(pt[1]);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return {error:`point [${pt[0]}, ${pt[1]}] in \`${key}\` is outside the canvas`};
    const i = (yi * w + xi) * 4;
    out.push({color:[px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], at:[xi, yi]});
  }
  return out;
}
/* color_range_samples：每个像素取所有样本里最像的；本地化时样本再按离取样点的距离淡掉 */
function colorRangeSamples(px, w, h, samples, fuzz, localized){
  const f = Math.max(0, fuzz) + 1, n = w * h, out = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const a = px[i * 4 + 3]; if (a <= 0) continue;
    const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255, x = i % w, y = (i / w) | 0;
    let best = 0;
    for (const s of samples){
      const d = Math.max(Math.abs(r - s.color[0]) * 255, Math.abs(g - s.color[1]) * 255, Math.abs(b - s.color[2]) * 255);
      let k = clamp01(1 - d / f);
      if (localized !== null && s.at){ const dist = Math.hypot(x - s.at[0], y - s.at[1]); k *= clamp01(1 - dist / Math.max(localized, 1)); }
      if (k > best) best = k;
    }
    out[i] = best;
  }
  return out;
}
/* hue_range：离家族色相越近、彩度越高越选（60° 外归 0；中性色永远不选） */
function hueRange(px, n, center){
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++){
    if (px[i * 4 + 3] <= 0) continue;
    const [hh, chroma] = hueChroma(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255);
    let dh = remE(hh - center, 360); dh = Math.min(dh, 360 - dh);
    out[i] = clamp01(clamp01(1 - dh / 60) * chroma);
  }
  return out;
}
/* tone_range：Rec.601 亮度 0..255 落在 lo..hi 全选，外面在 falloff 级内线性淡出 */
function toneRange(px, n, lo, hi, falloff){
  const ramp = Math.max(falloff, 1e-3), out = new Float32Array(n);
  for (let i = 0; i < n; i++){
    if (px[i * 4 + 3] <= 0) continue;
    const l = clamp01((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255) * 255;
    const o = l < lo ? lo - l : l > hi ? l - hi : 0;
    out[i] = clamp01(1 - o / ramp);
  }
  return out;
}
const HUES = {reds:0, yellows:60, greens:120, cyans:180, blues:240, magentas:300};
const fgColor = () => { const el = document.getElementById('fillColor'); return parseColor(el ? el.value : '#000000'); };
/* color_range 的主体：px 是 w×h 的 straight RGBA8；对话框预览拿缩小的代理图跑同一支 → {mask} | {error} */
function colorRangeCore(px, w, h, p, fg){
  const preset = p.select === undefined ? 'sampledColors' : p.select;
  if (typeof preset !== 'string') return {error:'`select` must be a string'};
  const fuzz = d => Math.max(0, num(p, 'fuzziness', d)), n = w * h;
  let mask;
  if (preset === 'sampledColors'){
    let samples = eyedropperSamples(p, 'points', px, w, h); if (samples.error) return samples;
    const minus = eyedropperSamples(p, 'subtractPoints', px, w, h); if (minus.error) return minus;
    if (p.colors !== undefined){
      if (!Array.isArray(p.colors)) return {error:'`colors` must be a list of colours'};
      for (const c of p.colors) samples.push({color:parseColor(c), at:null});
    }
    if (p.color !== undefined || !samples.length) samples.push({color:p.color !== undefined ? parseColor(p.color) : fg, at:null});
    let localized = null;
    if (bool(p, 'localized', false)){
      if (!samples.concat(minus).some(s => s.at)) return {error:'localized clusters need eyedropper `points`'};
      localized = Math.min(100, Math.max(0, num(p, 'range', 100))) / 100 * Math.max(w, h);
    }
    mask = colorRangeSamples(px, w, h, samples, fuzz(40), localized);
    if (minus.length){                                                      // 减去吸管：同一个容差，像减去样本的颜色掉出去
      const cut = colorRangeSamples(px, w, h, minus, fuzz(40), localized);
      for (let i = 0; i < n; i++) mask[i] *= 1 - cut[i];
    }
  } else if (preset in HUES){
    mask = hueRange(px, n, HUES[preset]);
  } else if (preset === 'highlights' || preset === 'midtones' || preset === 'shadows'){
    const level = v => (typeof v === 'number' && v >= 0 && v <= 255) ? v : null;
    const r = p.tonalRange; let lo, hi;
    if (r === undefined) [lo, hi] = preset === 'shadows' ? [0, 65] : preset === 'highlights' ? [190, 255] : [105, 150];
    else if (preset === 'shadows'){ if (level(r) === null) return {error:`tonalRange: want a level 0..255 (got ${JSON.stringify(r)})`}; [lo, hi] = [0, r]; }
    else if (preset === 'highlights'){ if (level(r) === null) return {error:`tonalRange: want a level 0..255 (got ${JSON.stringify(r)})`}; [lo, hi] = [r, 255]; }
    else {
      if (!(Array.isArray(r) && r.length === 2 && level(r[0]) !== null && level(r[1]) !== null && r[0] <= r[1])) return {error:`tonalRange: want [low, high] levels 0..255 (got ${JSON.stringify(r)})`};
      [lo, hi] = r;
    }
    mask = toneRange(px, n, lo, hi, Math.min(fuzz(20), 100) / 100 * 255);
  } else if (preset === 'outOfGamut'){
    return {error:'select `outOfGamut` needs a proof setup (View › Proof Setup), which this app does not have'};
  } else return {error:`unknown select \`${preset}\` (sampledColors, reds, yellows, greens, cyans, blues, magentas, highlights, midtones, shadows)`};
  if (bool(p, 'invert', false)) for (let i = 0; i < n; i++) mask[i] = 1 - mask[i];
  return {mask};
}
CMD.reg('ps.select.colorRange', {i18n:'', undoable:true,
  params:'{select:"sampledColors|reds|yellows|greens|cyans|blues|magentas|highlights|midtones|shadows"="sampledColors", color:"#rrggbb"|[r,g,b 0..1]=前景色, colors:["#rrggbb",…]?, ' +
         'points:[[x,y],…]?（吸管取样点，文件坐标）, subtractPoints:[[x,y],…]?（减去吸管）, fuzziness:0..200=40（阴影／中间调／高光时是 0..100 %=20）, ' +
         'localized=false（本地化颜色簇，要有 points）, range:0..100=100（长边的 %）, tonalRange:色阶|[lo,hi]（阴影 65、高光 190、中间调 [105,150]）, invert=false, ' +
         'sampleAllLayers=true, mode:"replace|add|subtract|intersect"="replace", withinSelection=true} 色彩范围：取样颜色＝每格跟最像的样本比各通道最大差、在容差内线性淡出；' +
         '色系＝色相近度×彩度；色调＝Rec.601 亮度落在范围内全选、外面按容差淡出；跟原选区按 mode 合成。' +
         '照 PS：已经有选区时（mode=replace）只在那个选区里面挑（结果×原选区覆盖度，框外一格都不会选到）；withinSelection:false＝整张图重挑 → {ok, selected, selection, withinSelection}'},
  p => {
    const r = colorRangeCore(samplePixels(bool(p, 'sampleAllLayers', true)), W(), H(), p, fgColor());
    if (r.error) return fail(r.error);
    const mode = parseMode(p.mode), within = mode === 'replace' && hasSel() && bool(p, 'withinSelection', true);
    if (within){ const old = SelMask.bytes(); for (let i = 0; i < r.mask.length; i++) r.mask[i] *= old[i] / 255; }
    return Object.assign(setSelection(r.mask, mode), {withinSelection:within});
  });

/* ═══════════ 命令：变换选区（select_extra_cmds.rs:101-203 ＋ transform.rs） ═══════════ */
const Hm = {
  I:[1, 0, 0, 0, 1, 0, 0, 0, 1],
  apply(m, x, y){ const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; },
  mul(a, b){ const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return r; },
  inverse(m){
    const c = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
               m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
               m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
    const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
    return Math.abs(det) < 1e-12 ? null : c.map(v => v / det);
  },
  /* 单位正方形 → 四边形（角序 (0,0)(1,0)(1,1)(0,1)） */
  squareToQuad(q){
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  },
  rectToQuad(r, q){
    const w = r[2] - r[0], h = r[3] - r[1];
    if (w <= 0 || h <= 0) return null;
    const s = this.squareToQuad(q); if (!s) return null;
    return this.mul(s, [1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1]);
  }
};
const REFS = ['center', 'topLeft', 'top', 'topRight', 'left', 'right', 'bottomLeft', 'bottom', 'bottomRight'];
function referencePoint(p, r){
  const [x0, y0, x1, y1] = r, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const v = p.reference;
  if (Array.isArray(v) && v.length >= 2) return [typeof v[0] === 'number' ? v[0] : cx, typeof v[1] === 'number' ? v[1] : cy];
  return ({topLeft:[x0, y0], top:[cx, y0], topRight:[x1, y0], left:[x0, cy], right:[x1, cy], bottomLeft:[x0, y1], bottom:[cx, y1], bottomRight:[x1, y1]})[v] || [cx, cy];
}
function quadParam(p){
  const a = p.quad !== undefined ? p.quad : p.corners;
  if (!Array.isArray(a) || a.length !== 4) return null;
  const q = [];
  for (const c of a){ if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null; q.push([c[0], c[1]]); }
  return q;
}
/* affine_params：绕参考点 缩放→斜切→旋转，再位移 */
function affineParams(p, r){
  const [px, py] = referencePoint(p, r);
  const sx = num(p, 'scaleX', 100) / 100, sy = num(p, 'scaleY', 100) / 100;
  const a = num(p, 'rotate', 0) * Math.PI / 180;
  const kx = Math.tan(num(p, 'skewX', 0) * Math.PI / 180), ky = Math.tan(num(p, 'skewY', 0) * Math.PI / 180);
  const dx = num(p, 'dx', num(p, 'x', 0)), dy = num(p, 'dy', num(p, 'y', 0));
  const t = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1];
  const sa = Math.sin(a), ca = Math.cos(a);
  const rot = [ca, -sa, 0, sa, ca, 0, 0, 0, 1], skew = [1, kx, 0, ky, 1, 0, 0, 0, 1], scale = [sx, 0, 0, 0, sy, 0, 0, 0, 1];
  return [t(px + dx, py + dy), rot, skew, scale, t(-px, -py)].reduce((m, x) => Hm.mul(m, x));
}
const parseInterp = s => (s === 'nearest' || s === 'nearestNeighbor') ? 'nearest' : s === 'bilinear' ? 'bilinear' : 'bicubic';
const catmullRom = t => { const t2 = t * t, t3 = t2 * t; return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]; };
/* warp_gray（框外当 0）＋ warp_surface 的反向取样：把遮罩 m 的 src 框按 h 变过去；只留在画布里的部分 */
function warpMask(m, w, h, src, hm, interp){
  const out = new Float32Array(w * h);
  const inv = Hm.inverse(hm); if (!inv) return out;
  const [sx0, sy0, sx1, sy1] = src;
  const cs = [[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]].map(([x, y]) => Hm.apply(hm, x, y));
  if (cs.some(c => !isFinite(c[0]) || !isFinite(c[1]))) return out;
  const bx0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[0]))) - 1), by0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[1]))) - 1);
  const bx1 = Math.min(w, Math.ceil(Math.max(...cs.map(c => c[0]))) + 1), by1 = Math.min(h, Math.ceil(Math.max(...cs.map(c => c[1]))) + 1);
  const inside = (x, y) => x >= sx0 && y >= sy0 && x < sx1 && y < sy1;     // 内容框里 alpha=1，框外 0
  const g = (x, y) => inside(x, y) ? m[y * w + x] : 0, a = (x, y) => inside(x, y) ? 1 : 0;
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++){
    let [u, v] = Hm.apply(inv, x + 0.5, y + 0.5); u -= 0.5; v -= 0.5;
    if (u < sx0 - 1 || v < sy0 - 1 || u > sx1 || v > sy1) continue;
    let ag = 0, aa = 0;
    if (interp === 'nearest'){
      const ix = Math.floor(u + 0.5), iy = Math.floor(v + 0.5); ag = g(ix, iy); aa = a(ix, iy);
    } else if (interp === 'bilinear'){
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      for (const [dy, wy] of [[0, 1 - fy], [1, fy]]) for (const [dx, wx] of [[0, 1 - fx], [1, fx]]){ ag += g(ix + dx, iy + dy) * wx * wy; aa += a(ix + dx, iy + dy) * wx * wy; }
    } else {
      const ix = Math.floor(u), iy = Math.floor(v), wx = catmullRom(u - ix), wy = catmullRom(v - iy);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){ const k = wx[i] * wy[j]; ag += g(ix - 1 + i, iy - 1 + j) * k; aa += a(ix - 1 + i, iy - 1 + j) * k; }
    }
    const al = clamp01(aa); if (al <= 0) continue;
    out[y * w + x] = clamp01(ag / al) * al;                               // 灰＋alpha 摊回预设值 0：p0·p1
  }
  return out;
}
/* 算出变换后的遮罩，不动文件（命令与对话框预览共用） → {mask, changed} | {error} */
function transformCompute(p){
  if (!Doc.sel) return {error:'no selection'};
  const w = W(), h = H(), bytes = SelMask.bytes(), b = bytesBounds(bytes, w, h);
  if (!b) return {error:'no selection'};
  const rect = (Array.isArray(p.rect) && p.rect.length === 4) ? p.rect.map(v => typeof v === 'number' ? v : 0) : b;
  const interp = parseInterp(typeof p.interpolation === 'string' ? p.interpolation : 'bilinear');
  if (['warp', 'style', 'mesh', 'grid'].some(k => p[k] !== undefined)) return {error:'select.transformSelection: warp is not supported here (use quad / matrix / scale / rotate / skew / move)'};
  let hm;
  const q = quadParam(p);
  if (q){ hm = Hm.rectToQuad(rect, q); if (!hm) return {error:'select.transformSelection: degenerate quad'}; }
  else if (p.matrix !== undefined){
    const v = Array.isArray(p.matrix) ? p.matrix.filter(x => typeof x === 'number') : [];
    if (v.length !== 6) return {error:'select.transformSelection: matrix must be [a, b, c, d, e, f]'};
    hm = [v[0], v[2], v[4], v[1], v[3], v[5], 0, 0, 1];
  } else hm = affineParams(p, rect);
  if (!Hm.inverse(hm)) return {error:'select.transformSelection: the transform collapses the selection'};
  if (hm.every((x, i) => Math.abs(x - Hm.I[i]) < 1e-12)) return {changed:false};
  const m = new Float32Array(w * h); for (let i = 0; i < m.length; i++) m[i] = bytes[i] / 255;
  return {changed:true, mask:warpMask(m, w, h, b, hm, interp)};
}
CMD.reg('ps.select.transformSelection', {i18n:'', undoable:true,
  params:'{rect:[x0,y0,x1,y1]?（框；预设＝选区外框）, quad|corners:[[x,y]×4]?（框的四角要去哪：扭曲／透视）, matrix:[a,b,c,d,e,f]?（同 canvas setTransform）, ' +
         'scaleX:%=100, scaleY:%=100, rotate:度=0, skewX:度=0, skewY:度=0, dx:px=0, dy:px=0, reference:"center|topLeft|top|topRight|left|right|bottomLeft|bottom|bottomRight"|[x,y]="center", ' +
         'interpolation:"bilinear|bicubic|nearest"="bilinear"} 变换选区：只变形选区遮罩、不动像素；跑出画布的部分切掉 → {ok, changed, selected, bounds:[x,y,w,h]|null}'},
  p => {
    const r = transformCompute(p);
    if (r.error) return fail(r.error);
    if (!r.changed) return {ok:true, changed:false, selected:true};
    const s = setSelection(r.mask, 'replace');
    return {ok:true, changed:true, selected:s.selected, bounds:Doc.sel ? [Doc.sel.x, Doc.sel.y, Doc.sel.w, Doc.sel.h] : null, selection:Doc.sel};
  });

/* ═══════════ 命令：图层（取消选择图层／查找图层／隔离图层） ═══════════ */
/* 我们的图层面板一次只有一个「当前层」（没有多选）⇒ 原码的「选中的图层集合」在这里就是当前那一层 */
CMD.reg('ps.select.deselectLayers', {i18n:'', undoable:false,
  params:'{} 取消选择图层：没有当前层（图层面板一层都不亮）；选图层不是编辑、不进历史 → {ok}'},
  () => {
    if (!Doc.active()) return fail('no layer selected');
    Doc.activeId = null;
    return {ok:true};
  });
/* layer_multi_cmds.rs:132-143 find_layers：名字含这串（不分大小写）的层；我们只能有一个当前层 ⇒ 选中最上面那个，全部命中的 id 都回 */
CMD.reg('ps.select.findLayers', {i18n:'', undoable:false,
  params:'{name:str（不分大小写的子串）} 查找图层：名字含这串的层；最上面那个变成当前层（本画板没有多选），命中的全部 id 由上到下回传 → {ok, selected:[id…]}'},
  p => {
    if (typeof p.name !== 'string') return fail('select.findLayers: missing `name`');
    const needle = p.name.toLowerCase();
    const ids = [...Doc.layers].reverse().filter(L => String(L.name).toLowerCase().includes(needle)).map(L => L.id);
    if (!ids.length) return fail(`no layer name contains "${needle}"`);
    Doc.activeId = ids[0];
    return {ok:true, selected:ids};
  });
/* select_extra_cmds.rs:78-84 isolate_layers：图层面板只列出开启那一刻选中的层（视图状态、不进历史） */
const ISO = {serial:-1, ids:[]};
const isolated = () => { if (ISO.serial !== Doc.serial){ ISO.serial = Doc.serial; ISO.ids = []; } return ISO.ids; };
PS.isolated = () => isolated().length > 0;
CMD.reg('ps.select.isolateLayers', {i18n:'', undoable:false,
  params:'{on?:bool（不给＝切换）} 隔离图层：图层面板只列出当前层（再按一次恢复全部）；视图状态、不进历史 → {ok, isolated, layers:[id…]}'},
  p => {
    const L = Doc.active();
    if (!L) return fail('no active layer');
    const on = typeof p.on === 'boolean' ? p.on : isolated().length === 0;
    ISO.ids = on ? [L.id] : []; ISO.serial = Doc.serial;
    return {ok:true, isolated:ISO.ids.length > 0, layers:ISO.ids.slice()};
  });

/* ═══════════ 快速蒙版（channel_cmds.rs:746-805） ═══════════
   原码：文件多一个临时通道 quick_mask（白＝选中），进出各是一步历史；进的时候选区收进通道、出来时通道变回选区。
   我们没有通道 ⇒ 用一个「隐藏的像素层」当这个通道（灰阶：白＝选中、黑＝遮住）：
     · 它是当前层，画笔／橡皮擦／油漆桶照常画在它上面（黑＝加遮罩、白＝擦掉遮罩；擦成透明＝当白）
     · 画面上照 PS 的预设，把「遮住的地方」盖一层 50% 红（UI.draw 之后叠画，见下面 drawExtras）
     · 进出都走 CMD、进历史（图层、选区、当前层都在快照里），撤销回得去 */
const QM = {ids:new Set(), prev:null};
function qmLayer(){ return Doc.layers.find(L => QM.ids.has(L.id)) || null; }
PS.quickMaskOn = () => !!qmLayer();
/* 快速蒙版层 → 0..1（透明的地方当白），文件坐标 */
function layerGray(L){
  const w = W(), h = H(), d = L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++){
    const a = d[i * 4 + 3] / 255, lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    out[i] = lum * a + (1 - a);
  }
  return out;
}
CMD.reg('ps.select.editInQuickMaskMode', {i18n:'', undoable:true,
  params:'{on?:bool（不给＝切换）} 以快速蒙版模式编辑（Q）：进＝选区变成一张灰阶蒙版层（白＝选中；没选区＝全白），没选到的地方盖 50% 红，可用画笔黑／白去改；' +
         '出＝蒙版变回选区（全白＝没选区），那层拿掉、回到原来的当前层；进出各一步历史 → {ok, quickMask}'},
  p => {
    const L0 = qmLayer(), on = !!L0;
    const want = typeof p.on === 'boolean' ? p.on : !on;
    if (want === on) return {ok:true, quickMask:on};
    const w = W(), h = H();
    if (want){
      // quick_mask_from：有选区＝覆盖度；没选区＝全白（什么都没遮）
      const bytes = Doc.sel ? SelMask.bytes() : null;
      const L = Layer.raster(T('qmLayer'));
      const img = L.data.ctx.createImageData(w, h), d = img.data;
      for (let i = 0; i < w * h; i++){ const v = bytes ? bytes[i] : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
      L.data.ctx.putImageData(img, 0, 0);
      L.visible = false;                                                       // 画面上用红色叠画代替（不进合成）
      QM.prev = Doc.activeId;
      Doc.add(L);                                                              // 放最上面、变成当前层
      QM.ids.add(L.id);
      Doc.sel = null;
    } else {
      // selection_from：全白（每格 ≥ 1−0.5/255）＝没选区；否则就是那张灰阶
      const vals = layerGray(L0);
      let all = true; for (let i = 0; i < vals.length; i++) if (vals[i] < 1 - 0.5 / 255){ all = false; break; }
      const prev = QM.prev;
      Doc.remove(L0.id);
      if (prev && Doc.byId(prev)) Doc.activeId = prev;
      Doc.sel = all ? null : (() => { const b = combine(null, vals, 'replace'); return b ? SelMask.fromBytes(b) : null; })();
    }
    return {ok:true, quickMask:want};
  });

/* ═══════════ 存储／载入选区（channel_cmds.rs:657-744） ═══════════
   原码存进文件的 Alpha 通道。我们没有通道面板 ⇒ 存在这份文件（Doc.serial）专属的一张通道表，名字照 PS「Alpha 1」「Alpha 2」…；
   ⚠️ 通道表不在 History 快照里：撤销「存储选区」不会把通道拿掉。 */
const CH = {serial:-1, list:[]};
const channels = () => { if (CH.serial !== Doc.serial){ CH.serial = Doc.serial; CH.list = []; } return CH.list; };
PS.channels = () => channels().map(c => c.name);
PS.channelList = () => channels();   // 通道面板（ps-window）要新建／删除／复制／改名：直接给表本身（阵列，元素 {name, data:Uint8Array}）
const nextAlphaName = () => { const L = channels(); for (let n = 1; n <= L.length + 1; n++){ const s = `Alpha ${n}`; if (!L.some(c => c.name === s)) return s; } return 'Alpha'; };
/* 通道参照：数字＝第几个 Alpha 通道；字串＝Alpha 名字，或 composite|red|green|blue|transparency|mask|quickMask|selection */
function channelIndex(v){
  const L = channels();
  if (typeof v === 'number') return (Number.isInteger(v) && v >= 0 && v < L.length) ? v : -1;
  if (typeof v === 'string') return L.findIndex(c => c.name === v);
  return -1;
}
CMD.reg('ps.select.saveSelection', {i18n:'', undoable:false,
  params:'{name?:str, channel:"new"|序号|名字="new", operation:"new|replace|add|subtract|intersect"="new"} 存储选区：存成这份文件的一个 Alpha 通道（白＝选中）；' +
         '存到已有通道时照 operation 取代／加／减／交集；没有选区＝不能用 → {ok, channel:序号, name}'},
  p => {
    const op = typeof p.operation === 'string' ? p.operation : 'new';
    if (!['new', 'replace', 'add', 'subtract', 'intersect'].includes(op)) return fail(`select.saveSelection: unknown operation \`${op}\``);
    if (!hasSel()) return fail('no selection');
    const sel = SelMask.bytes(), L = channels();
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
    let existing = null;
    if (p.channel !== undefined && p.channel !== null && p.channel !== 'new'){
      const i = channelIndex(p.channel);
      if (i < 0) return fail('select.saveSelection: `channel` must be "new" or an existing alpha channel');
      existing = i;
    }
    if (existing === null || op === 'new'){
      L.push({name:name || nextAlphaName(), data:Uint8Array.from(sel)});
      return {ok:true, channel:L.length - 1, name:L[L.length - 1].name};
    }
    const c = L[existing], old = c.data, out = new Uint8Array(old.length);
    for (let i = 0; i < out.length; i++){
      const a = old[i], b = sel[i];
      out[i] = op === 'add' ? Math.max(a, b) : op === 'subtract' ? Math.max(a - b, 0) : op === 'intersect' ? Math.min(a, b) : b;
    }
    c.data = out; if (name) c.name = name;
    return {ok:true, channel:existing, name:c.name};
  });
/* ref_planes／gray_plane：一张 0..1 灰阶（合成＝亮度 0.299/0.587/0.114） */
function channelPlane(v, layerId){
  const w = W(), h = H(), n = w * h, out = new Float32Array(n);
  const i = channelIndex(v);
  if (i >= 0){ const d = channels()[i].data; for (let k = 0; k < n; k++) out[k] = d[k] / 255; return {plane:out}; }
  if (v === 'selection'){ return {plane:currentMask()}; }
  if (v === 'quickMask'){ const L = qmLayer(); if (!L) return {error:'not in Quick Mask mode'}; return {plane:layerGray(L)}; }
  // transparency／mask 可指定 layer（图层 id；图层面板 Ctrl＋点缩图用，PS：读那层、不切当前层）；没给＝当前层
  const L = layerId !== undefined && layerId !== null ? Doc.byId(layerId) : Doc.active();
  if (layerId !== undefined && layerId !== null && !L && (v === 'transparency' || v === 'mask')) return {error:`select.loadSelection: no layer \`${layerId}\``};
  if (v === 'transparency'){
    if (!L) return {error:'transparency needs a layer'};
    // 像素层读自己的 alpha；矢量／文字层读渲染出来的 alpha（原码的调整／填充层没有表面＝全 1；我们的矢量／文字层有形状，照形状载入）
    const d = L.kind === 'raster' ? L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), w, h).data
                                  : renderLayer(L, 1).getContext('2d').getImageData(0, 0, w, h).data;
    for (let k = 0; k < n; k++) out[k] = d[k * 4 + 3] / 255;
    return {plane:out};
  }
  if (v === 'mask'){
    if (!L) return {error:'layer mask needs a layer'};
    if (!L.mask) return {error:`layer "${L.name}" has no mask`};
    const d = renderLayer(L.mask, 1).getContext('2d').getImageData(0, 0, w, h).data;   // 我们的蒙版＝destination-in 的 alpha
    for (let k = 0; k < n; k++) out[k] = d[k * 4 + 3] / 255;
    return {plane:out};
  }
  const ci = {red:0, green:1, blue:2}[v];
  if (v === 'composite' || ci !== undefined){
    const d = composite(1).getContext('2d').getImageData(0, 0, w, h).data;
    for (let k = 0; k < n; k++) out[k] = ci !== undefined ? d[k * 4 + ci] / 255 : (0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2]) / 255;
    return {plane:out};
  }
  return {error:'select.loadSelection: unknown `channel`'};
}
CMD.reg('ps.select.loadSelection', {i18n:'', undoable:true,
  params:'{channel:序号|Alpha 名字|"composite"|"red"|"green"|"blue"|"transparency"|"mask"|"quickMask"|"selection", layer?:图层id, invert=false, operation:"new|add|subtract|intersect"="new"} ' +
         '载入选区：那张灰阶（白＝选中；合成＝亮度；透明度＝那层 alpha，文字／形状／组读渲染后的 alpha；layer 缺省＝当前层，给了也不切当前层）跟现有选区照 operation 合成 → {ok, selected, selection}'},
  p => {
    const opName = typeof p.operation === 'string' ? p.operation : 'new';
    const mode = ({new:'replace', replace:'replace', add:'add', subtract:'subtract', intersect:'intersect'})[opName];
    if (!mode) return fail(`select.loadSelection: unknown operation \`${opName}\``);
    if (p.channel === undefined) return fail('select.loadSelection: missing `channel`');
    const r = channelPlane(p.channel, p.layer);
    if (r.error) return fail(r.error);
    if (bool(p, 'invert', false)) for (let k = 0; k < r.plane.length; k++) r.plane[k] = 1 - r.plane[k];
    return setSelection(r.plane, mode);
  });

/* ═══════════ 焦点区域／天空（algo/src/segment/{mod,focus,sky,gmm}.rs ＋ matting.rs 的 box_mean／guided_filter） ═══════════ */
/* RgbImage::from_rgba：straight RGBA8 → RGB 0..1（透明的地方叠在中灰上，模型才分得出透明） */
function rgbOf(px, n){
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    const a = clamp01(px[i * 4 + 3] / 255);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp01(px[i * 4 + c] / 255) * a + 0.5 * (1 - a);
  }
  return out;
}
/* RgbImage::downsample：整数 step 方框平均（输出 ⌈w/step⌉×⌈h/step⌉）；rgb_scaled 分条读的结果跟整张一样 */
function downsample(rgb, w, h, step){
  if (step <= 1) return {w, h, px:rgb};
  const ow = Math.ceil(w / step), oh = Math.ceil(h / step), out = new Float32Array(ow * oh * 3);
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++){
    let a0 = 0, a1 = 0, a2 = 0, n = 0;
    for (let y = oy * step; y < Math.min((oy + 1) * step, h); y++) for (let x = ox * step; x < Math.min((ox + 1) * step, w); x++){
      const i = (y * w + x) * 3; a0 += rgb[i]; a1 += rgb[i + 1]; a2 += rgb[i + 2]; n++;
    }
    const o = (oy * ow + ox) * 3; out[o] = a0 / n; out[o + 1] = a1 / n; out[o + 2] = a2 / n;
  }
  return {w:ow, h:oh, px:out};
}
const scaleFor = (w, h, maxPx) => Math.max(1, Math.ceil(Math.sqrt(w * h / Math.max(1, maxPx))));
const luma3 = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
/* matting.rs box_mean：半径 r 的方框平均（窗口夹在图里、除以实际像素数） */
function boxMean(src, w, h, r){
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), pre = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++){
    const o = y * w;
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[o + x];
    for (let x = 0; x < w; x++){ const lo = Math.max(0, x - r), hi = Math.min(w, x + r + 1); tmp[o + x] = (pre[hi] - pre[lo]) / (hi - lo); }
  }
  const col = new Float64Array((h + 1) * w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) col[(y + 1) * w + x] = col[y * w + x] + tmp[y * w + x];
  for (let y = 0; y < h; y++){
    const lo = Math.max(0, y - r), hi = Math.min(h, y + r + 1), n = hi - lo;
    for (let x = 0; x < w; x++) out[y * w + x] = (col[hi * w + x] - col[lo * w + x]) / n;
  }
  return out;
}
/* guided_filter_gray：灰阶导引图的导向滤波（He, Sun & Tang） */
function guidedGray(guide, p, w, h, r, eps){
  const n = w * h, ip = new Float32Array(n), ii = new Float32Array(n);
  for (let i = 0; i < n; i++){ ip[i] = guide[i] * p[i]; ii[i] = guide[i] * guide[i]; }
  const mi = boxMean(guide, w, h, r), mp = boxMean(p, w, h, r), mip = boxMean(ip, w, h, r), mii = boxMean(ii, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const v = mii[i] - mi[i] * mi[i], c = mip[i] - mi[i] * mp[i];
    a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mi[i];
  }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ma[i] * guide[i] + mb[i];
  return out;
}
/* guided_filter_color：彩色导引图（式 19–21：a_k = (Σ_k + εU)⁻¹ cov_k(I, p)） */
function guidedColor(rgb, p, w, h, r, eps){
  const n = w * h, ch = [0, 1, 2].map(c => { const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = rgb[i * 3 + c]; return v; });
  const m = ch.map(c => boxMean(c, w, h, r)), mp = boxMean(p, w, h, r);
  const mul = (a, b) => { const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = a[i] * b[i]; return v; };
  const mip = ch.map(c => boxMean(mul(c, p), w, h, r));
  const mii = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(([a, b]) => boxMean(mul(ch[a], ch[b]), w, h, r));
  const av = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], bv = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const mu = [m[0][i], m[1][i], m[2][i]], s = (k, a, b) => mii[k][i] - mu[a] * mu[b];
    const rr = s(0, 0, 0) + eps, rg = s(1, 0, 1), rb = s(2, 0, 2), gg = s(3, 1, 1) + eps, gb = s(4, 1, 2), bb = s(5, 2, 2) + eps;
    const cov = [mip[0][i] - mu[0] * mp[i], mip[1][i] - mu[1] * mp[i], mip[2][i] - mu[2] * mp[i]];
    const i00 = gg * bb - gb * gb, i01 = gb * rb - rg * bb, i02 = rg * gb - gg * rb, i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    let a0 = 0, a1 = 0, a2 = 0;
    if (Math.abs(det) >= 1e-30){
      a0 = (i00 * cov[0] + i01 * cov[1] + i02 * cov[2]) / det;
      a1 = (i01 * cov[0] + i11 * cov[1] + i12 * cov[2]) / det;
      a2 = (i02 * cov[0] + i12 * cov[1] + i22 * cov[2]) / det;
    }
    av[0][i] = a0; av[1][i] = a1; av[2][i] = a2; bv[i] = mp[i] - a0 * mu[0] - a1 * mu[1] - a2 * mu[2];
  }
  const ma = av.map(a => boxMean(a, w, h, r)), mb = boxMean(bv, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ma[0][i] * ch[0][i] + ma[1][i] * ch[1][i] + ma[2][i] * ch[2][i] + mb[i];
  return out;
}
/* components（8 连通）／components4：标号（0＝背景）与各块大小 */
function labelComponents(mask, w, h, eight){
  const lab = new Uint32Array(w * h), sizes = [0], stack = [];
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
      } else {
        for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1])
          if (j >= 0 && mask[j] && !lab[j]){ lab[j] = l; stack.push(j); }
      }
    }
  }
  return {lab, sizes};
}
/* clean_mask：留下至少最大块 frac 的连通块，补上不碰边、小于留下面积 hole_frac 的洞 */
function cleanMask(mask, w, h, frac, holeFrac){
  const {lab, sizes} = labelComponents(mask, w, h, true);
  let largest = 0; for (let i = 1; i < sizes.length; i++) largest = Math.max(largest, sizes[i]);
  const out = new Uint8Array(w * h);
  if (!largest) return out;
  const min = Math.ceil(Math.fround(largest * frac));
  let area = 0;
  for (let i = 0; i < out.length; i++) if (lab[i] && sizes[lab[i]] >= min){ out[i] = 1; area++; }
  const maxHole = Math.floor(Math.fround(area * holeFrac));
  const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = out[i] ? 0 : 1;
  const H4 = labelComponents(inv, w, h, false), touches = new Uint8Array(H4.sizes.length);
  for (let x = 0; x < w; x++){ touches[H4.lab[x]] = 1; touches[H4.lab[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++){ touches[H4.lab[y * w]] = 1; touches[H4.lab[y * w + w - 1]] = 1; }
  for (let i = 0; i < out.length; i++){ const l = H4.lab[i]; if (l && !touches[l] && H4.sizes[l] <= maxHole) out[i] = 1; }
  return out;
}
/* focus.rs sharpness：局部拉普拉斯能量，按 99 百分位归一，再扣掉杂色底 */
function sharpness(img, noise){
  const {w, h, px} = img, n = w * h, y = new Float32Array(n), lap = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = luma3(px, i * 3);
  const at = (x, yy) => y[yy * w + x];
  for (let yy = 0; yy < h; yy++) for (let x = 0; x < w; x++){
    const c = at(x, yy);
    lap[yy * w + x] = Math.abs(2 * c - at(Math.max(0, x - 1), yy) - at(Math.min(w - 1, x + 1), yy)) + Math.abs(2 * c - at(x, Math.max(0, yy - 1)) - at(x, Math.min(h - 1, yy + 1)));
  }
  const r = Math.max(3, Math.floor(Math.min(w, h) / 60)), e = boxMean(lap, w, h, r);
  const sorted = Float32Array.from(e).sort(), k = Math.min(Math.floor(Math.fround(n * 0.99)), n - 1), p99 = sorted[k];
  const floor = clamp01(noise) * 0.5, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(Math.min(e[i] / Math.max(p99, 1e-6), 1) - floor, 0) / Math.max(1 - floor, 1e-3);
  return out;
}
/* focus.rs focus_area：在 ≤100 万像素的工作图上门槛、用彩色导向滤波贴着物件边、清掉碎块，再软边放大回整张 → 整张文件的 8 位遮罩或 null */
function focusArea(px, W0, H0, range, noise){
  if (W0 < 4 || H0 < 4) return null;
  const step = scaleFor(W0, H0, 1000000), img = downsample(rgbOf(px, W0 * H0), W0, H0, step), {w, h} = img;
  const s = sharpness(img, noise), t = 0.05 + 0.9 * Math.pow(1 - clamp01(range), 2);
  const bin = new Float32Array(w * h); for (let i = 0; i < bin.length; i++) bin[i] = s[i] >= t ? 1 : 0;
  const r = Math.max(2, Math.floor(Math.min(w, h) / 50));
  const sm = guidedColor(img.px, bin, w, h, r, 1e-2);
  const raw = new Uint8Array(w * h); for (let i = 0; i < raw.length; i++) raw[i] = sm[i] >= 0.5 ? 1 : 0;
  const mask = cleanMask(raw, w, h, 0.05, 0.02);
  if (!mask.some(v => v)) return null;
  const field = new Float32Array(w * h);
  for (let i = 0; i < field.length; i++) field[i] = mask[i] ? Math.min(1, Math.max(0.5, sm[i])) : Math.min(0.5, Math.max(0, sm[i]));
  const out = new Uint8Array(W0 * H0);
  for (let yy = 0; yy < H0; yy++){
    const fy = Math.min(h - 1, Math.max(0, (yy + 0.5) / step - 0.5)), y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(y0 + 1, h - 1);
    for (let xx = 0; xx < W0; xx++){
      const fx = Math.min(w - 1, Math.max(0, (xx + 0.5) / step - 0.5)), x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(x0 + 1, w - 1);
      const top = field[y0 * w + x0] * (1 - tx) + field[y0 * w + x1] * tx, bot = field[y1 * w + x0] * (1 - tx) + field[y1 * w + x1] * tx;
      const v = top * (1 - ty) + bot * ty;
      out[yy * W0 + xx] = Math.round(clamp01((v - 0.5) * 3 + 0.5) * 255);
    }
  }
  return out;
}

/* ── gmm.rs：三维高斯混合（k-means++ 播种用确定的 xorshift 乱数、Lloyd、再几步 EM） ── */
const M64 = (1n << 64n) - 1n;
function Rng(seed){ this.s = ((BigInt(seed) * 0x9E3779B97F4A7C15n) & M64) | 1n; }
Rng.prototype.next = function(){ let x = this.s; x ^= (x << 13n) & M64; x ^= x >> 7n; x ^= (x << 17n) & M64; this.s = x; return x; };
Rng.prototype.f32 = function(){ return Number(this.next() >> 40n) / 16777216; };
const fr = Math.fround;
const d2f = (a, b) => { const x = fr(a[0] - b[0]), y = fr(a[1] - b[1]), z = fr(a[2] - b[2]); return fr(fr(fr(x * x) + fr(y * y)) + fr(z * z)); };
function nearestC(centers, z){ let best = 0, bd = 3.4028234663852886e38; centers.forEach((c, i) => { const d = d2f(c, z); if (d < bd){ bd = d; best = i; } }); return best; }
function kmeans(samples, k, iters){
  const rng = new Rng(0x5EED + samples.length);
  let centers = [samples[Number(rng.next() % BigInt(samples.length))]];
  const dist = samples.map(z => d2f(z, centers[0]));
  while (centers.length < k){
    let total = 0; for (const d of dist) total += d;
    if (total <= 1e-12) break;
    let t = rng.f32() * total, pick = samples.length - 1;
    for (let i = 0; i < dist.length; i++){ t -= dist[i]; if (t <= 0){ pick = i; break; } }
    const c = samples[pick]; centers.push(c);
    for (let i = 0; i < dist.length; i++) dist[i] = Math.min(dist[i], d2f(samples[i], c));
  }
  for (let it = 0; it < iters; it++){
    const sums = centers.map(() => [[0, 0, 0], 0]);
    for (const z of samples){ const i = nearestC(centers, z); for (let c = 0; c < 3; c++) sums[i][0][c] += z[c]; sums[i][1]++; }
    const nw = sums.filter(s => s[1] > 0).map(([s, n]) => s.map(v => fr(v / n)));
    const done = nw.length === centers.length && nw.every((c, i) => c[0] === centers[i][0] && c[1] === centers[i][1] && c[2] === centers[i][2]);
    centers = nw;
    if (done) break;
  }
  return centers;
}
function gmmComponent(weight, mean, cov, reg){
  const c = cov.map(r => r.slice()); for (let i = 0; i < 3; i++) c[i][i] += reg;
  const det = c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1]) - c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0]) + c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0]);
  if (det <= 1e-30 || weight <= 0) return null;
  const inv = [
    [(c[1][1] * c[2][2] - c[1][2] * c[2][1]) / det, (c[0][2] * c[2][1] - c[0][1] * c[2][2]) / det, (c[0][1] * c[1][2] - c[0][2] * c[1][1]) / det],
    [(c[1][2] * c[2][0] - c[1][0] * c[2][2]) / det, (c[0][0] * c[2][2] - c[0][2] * c[2][0]) / det, (c[0][2] * c[1][0] - c[0][0] * c[1][2]) / det],
    [(c[1][0] * c[2][1] - c[1][1] * c[2][0]) / det, (c[0][1] * c[2][0] - c[0][0] * c[2][1]) / det, (c[0][0] * c[1][1] - c[0][1] * c[1][0]) / det]];
  return {mean:mean.map(fr), inv, logNorm:Math.log(weight) - 0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI)};
}
function logWeighted(c, z){
  const d = [z[0] - c.mean[0], z[1] - c.mean[1], z[2] - c.mean[2]], m = c.inv;
  const q = d[0] * (m[0][0] * d[0] + m[0][1] * d[1] + m[0][2] * d[2]) + d[1] * (m[1][0] * d[0] + m[1][1] * d[1] + m[1][2] * d[2]) + d[2] * (m[2][0] * d[0] + m[2][1] * d[1] + m[2][2] * d[2]);
  return c.logNorm - 0.5 * q;
}
const newAcc = () => ({n:0, s:[0, 0, 0], ss:[[0, 0, 0], [0, 0, 0], [0, 0, 0]]});
function accAdd(a, z, w){ a.n += w; for (let i = 0; i < 3; i++){ a.s[i] += w * z[i]; for (let j = 0; j < 3; j++) a.ss[i][j] += w * z[i] * z[j]; } }
function accComp(a, total, reg){
  if (a.n <= 0) return null;
  const m = a.s.map(v => v / a.n), c = [0, 1, 2].map(i => [0, 1, 2].map(j => a.ss[i][j] / a.n - m[i] * m[j]));
  return gmmComponent(a.n / total, m, c, reg);
}
function gmmFit(samples, k, reg){
  if (!samples.length) return null;
  k = Math.min(Math.max(k, 1), samples.length);
  const centers = kmeans(samples, k, 10);
  const acc = centers.map(newAcc);
  for (const z of samples) accAdd(acc[nearestC(centers, z)], z, 1);
  let comps = acc.map(a => accComp(a, samples.length, reg)).filter(Boolean);
  if (!comps.length) return null;
  for (let it = 0; it < 3; it++){                                         // em_step ×3（失败就留着上一份）
    const ac = comps.map(newAcc), lw = new Array(comps.length);
    for (const z of samples){
      let mx = -Infinity; comps.forEach((c, i) => { lw[i] = logWeighted(c, z); mx = Math.max(mx, lw[i]); });
      let sum = 0; for (let i = 0; i < lw.length; i++){ lw[i] = Math.exp(lw[i] - mx); sum += lw[i]; }
      for (let i = 0; i < lw.length; i++){ const r = lw[i] / sum; if (r > 1e-6) accAdd(ac[i], z, r); }
    }
    const nc = ac.map(a => accComp(a, samples.length, reg)).filter(Boolean);
    if (nc.length) comps = nc;
  }
  return comps;
}
function gmmNegLog(comps, z){
  const n = Math.min(comps.length, 16); let mx = -Infinity; const v = [];
  for (let i = 0; i < n; i++){ v.push(logWeighted(comps[i], z)); mx = Math.max(mx, v[i]); }
  let s = 0; for (const x of v) s += Math.exp(x - mx);
  return fr(Math.min(200, Math.max(-50, -(mx + Math.log(s)))));
}
const subsample = (v, max) => { if (v.length <= max) return v.slice(); const k = Math.ceil(v.length / max), o = []; for (let i = 0; i < v.length; i += k) o.push(v[i]); return o; };

/* ── sky.rs ── */
const sstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/* colour_prior：蓝天（蓝明显大于红、不比绿低太多）／阴天云雾（亮而近中性）／夕照（亮而暖，权重低些） */
function colourPrior(r, g, b){
  const y = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 1e-4 ? (mx - mn) / mx : 0;
  const blue = sstep(0.02, 0.12, b - r) * sstep(-0.12, 0, b - g) * sstep(0.18, 0.4, y);
  const white = sstep(0.5, 0.75, y) * (1 - sstep(0.12, 0.3, sat));
  const warm = 0.6 * sstep(0.55, 0.8, y) * sstep(0, 0.1, r - b) * (1 - sstep(0.05, 0.25, g - b - 0.2));
  return Math.max(blue, white, warm);
}
/* likelihood：颜色先验 × 平滑度（天空梯度小） */
function skyLikelihood(img){
  const {w, h, px} = img, n = w * h, y = new Float32Array(n), grad = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = luma3(px, i * 3);
  const at = (x, yy) => y[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let yy = 0; yy < h; yy++) for (let x = 0; x < w; x++){
    const gx = (at(x + 1, yy - 1) + 2 * at(x + 1, yy) + at(x + 1, yy + 1)) - (at(x - 1, yy - 1) + 2 * at(x - 1, yy) + at(x - 1, yy + 1));
    const gy = (at(x - 1, yy + 1) + 2 * at(x, yy + 1) + at(x + 1, yy + 1)) - (at(x - 1, yy - 1) + 2 * at(x, yy - 1) + at(x + 1, yy - 1));
    grad[yy * w + x] = Math.sqrt(gx * gx + gy * gy) / 8;
  }
  const tex = boxMean(grad, w, h, 2), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = colourPrior(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]) * (1 - sstep(0.015, 0.07, tex[i]));
  return out;
}
/* sky_mask_low：上缘几列的像天空像素当种子，往四邻「颜色渐变」地长；缝里的天空用长出来那片的 GMM 补；清碎块 */
function skyMaskLow(img, threshold){
  const {w, h, px} = img;
  if (w < 2 || h < 2) return null;
  const like = skyLikelihood(img), t = 0.12 + 0.6 * (Math.min(100, Math.max(0, threshold)) / 100);
  const top = Math.max(1, Math.floor(h / 40)), mask = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < top * w; i++) if (like[i] > t){ mask[i] = 1; stack.push(i); }
  if (stack.length * 20 < top * w) return null;                            // 上缘不到 5% 像天空
  while (stack.length){
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1]){
      if (j < 0 || mask[j] || like[j] <= t) continue;
      const d = Math.sqrt((px[i * 3] - px[j * 3]) ** 2 + (px[i * 3 + 1] - px[j * 3 + 1]) ** 2 + (px[i * 3 + 2] - px[j * 3 + 2]) ** 2);
      if (d < 0.12){ mask[j] = 1; stack.push(j); }
    }
  }
  const samples = []; for (let i = 0; i < w * h; i++) if (mask[i]) samples.push([px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]);
  if (samples.length >= 16){
    const g = gmmFit(subsample(samples, 4000), 3, fr(1e-4));
    if (g){
      const nl = subsample(samples, 2000).map(p => gmmNegLog(g, p)).sort((a, b) => a - b);
      const cut = nl[Math.min(Math.floor(nl.length * 95 / 100), nl.length - 1)];
      for (let i = 0; i < w * h; i++) if (!mask[i] && like[i] > t + 0.1 && gmmNegLog(g, [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]) <= cut) mask[i] = 1;
    }
  }
  const m = cleanMask(mask, w, h, 0.002, 0.01);
  return m.some(v => v) ? m : null;
}
/* select_sky：工作图（≤16 万像素）上找天空，放大后每 256 块用亮度导向滤波在全解析度修边（只有混合的块才滤） → 整张 8 位遮罩或 null */
function selectSky(px, W0, H0, threshold, softness){
  if (W0 < 4 || H0 < 4) return null;
  const n0 = W0 * H0, rgb = rgbOf(px, n0), step = scaleFor(W0, H0, 160000), img = downsample(rgb, W0, H0, step), lw = img.w, lh = img.h;
  const low = skyMaskLow(img, threshold); if (!low) return null;
  const soft = Math.min(100, Math.max(0, softness)) / 100;
  const r = Math.max(3, Math.ceil(fr(step * (1 + 2 * soft)))), eps = 1e-4 + 4e-3 * soft, k = 0.08 + 0.42 * soft;
  const g = (xx, yy) => low[Math.floor(Math.min(lh - 1, Math.max(0, yy))) * lw + Math.floor(Math.min(lw - 1, Math.max(0, xx)))];
  const coarse = (x, y) => {
    const fx = (x + 0.5) / step - 0.5, fy = (y + 0.5) / step - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const top = g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax, bot = g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax;
    return top * (1 - ay) + bot * ay;
  };
  const out = new Uint8Array(n0), T = 256;
  for (let ty = 0; ty < H0; ty += T) for (let tx = 0; tx < W0; tx += T){
    const t1x = Math.min(tx + T, W0), t1y = Math.min(ty + T, H0);
    const wx0 = Math.max(0, tx - r), wy0 = Math.max(0, ty - r), wx1 = Math.min(W0, t1x + r), wy1 = Math.min(H0, t1y + r), ww = wx1 - wx0, wh = wy1 - wy0;
    const pm = new Float32Array(ww * wh); let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pm.length; i++){ const v = coarse(wx0 + i % ww, wy0 + ((i / ww) | 0)); pm[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi <= 0 || lo >= 1){ const v = lo >= 1 ? 255 : 0; for (let y = ty; y < t1y; y++) out.fill(v, y * W0 + tx, y * W0 + t1x); continue; }
    const guide = new Float32Array(ww * wh);
    for (let i = 0; i < guide.length; i++){ const X = wx0 + i % ww, Y = wy0 + ((i / ww) | 0); guide[i] = luma3(rgb, (Y * W0 + X) * 3); }
    const q = guidedGray(guide, pm, ww, wh, r, eps);
    for (let y = ty; y < t1y; y++) for (let x = tx; x < t1x; x++) out[y * W0 + x] = Math.round(sstep(0.5 - k, 0.5 + k, q[(y - wy0) * ww + (x - wx0)]) * 255);
  }
  return out.some(v => v) ? out : null;
}
PS.algo.focusArea = focusArea; PS.algo.selectSky = selectSky; PS.algo.colourPrior = colourPrior;

/* combine_region（selection.rs:363-404）：region 是整张文件的 8 位遮罩（或 null） */
function combineRegionFull(old, region, mode){
  const any = a => { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; };
  const empty = !region || !any(region);
  if (mode === 'replace' || (mode === 'add' && !old)) return empty ? null : region;
  if (!old) return null;
  if (mode === 'intersect'){ if (empty) return null; const o = new Uint8Array(old.length); for (let i = 0; i < o.length; i++) o[i] = Math.min(old[i], region[i]); return any(o) ? o : null; }
  if (empty) return any(old) ? old : null;
  const o = new Uint8Array(old.length);
  for (let i = 0; i < o.length; i++) o[i] = mode === 'add' ? Math.max(old[i], region[i]) : Math.max(0, old[i] - region[i]);
  return any(o) ? o : null;
}
/* smartselect_cmds.rs:58-71 apply：没找到又是加／减 ⇒ 选区不动 */
function applyRegion(region, mode){
  if (!region && (mode === 'add' || mode === 'subtract')) return {ok:true, selected:!!Doc.sel, changed:false};
  const out = combineRegionFull(Doc.sel ? SelMask.bytes() : null, region, mode);
  Doc.sel = out ? SelMask.fromBytes(out) : null;
  const b = region ? bytesBounds(region, W(), H()) : null;
  return {ok:true, selected:!!Doc.sel, changed:true, bounds:b ? [b[0], b[1], b[2] - b[0], b[3] - b[1]] : null, selection:Doc.sel};
}
const smartMode = p => { const m = typeof p.mode === 'string' ? p.mode : 'replace'; return parseMode(m === 'new' ? 'replace' : m); };
CMD.reg('ps.select.focusArea', {i18n:'', undoable:true,
  params:'{range:0..1=0.5（对焦范围，越大越宽松）, noise:0..1=0（图像杂色级别）, sampleAllLayers=true, mode:"replace|add|subtract|intersect"="replace"} 焦点区域：' +
         '局部拉普拉斯能量（锐利度）按 99 百分位归一、扣杂色底后过门槛，彩色导向滤波贴边、清碎块、软边放大 → {ok, selected, changed, bounds}'},
  p => {
    const range = clamp01(num(p, 'range', 0.5)), noise = clamp01(num(p, 'noise', 0));
    return applyRegion(focusArea(samplePixels(bool(p, 'sampleAllLayers', true)), W(), H(), range, noise), smartMode(p));
  });
CMD.reg('ps.select.sky', {i18n:'', undoable:true,
  params:'{mode:"replace|add|subtract|intersect"="replace", sampleAllLayers=true, threshold:0..100=50（越高越严）, softness:0..100=50（边缘柔和度）} 天空：' +
         '颜色先验（蓝天／阴天／夕照）×平滑度，从上缘长出天空、GMM 补树缝里的天、全解析度导向滤波修边；找不到天空＝选区不动、回 message → {ok, selected, changed, coverage, bounds}'},
  p => {
    const w = W(), h = H();
    const params = {threshold:num(p, 'threshold', 50), softness:num(p, 'softness', 50)};
    const region = selectSky(samplePixels(bool(p, 'sampleAllLayers', true)), w, h, params.threshold, params.softness);
    if (!region) return {ok:true, selected:!!Doc.sel, changed:false, coverage:0, message:'No sky was detected'};   // PS：「未检测到天空」，选区不动
    let tot = 0; for (let i = 0; i < region.length; i++) tot += region[i] / 255;
    const r = applyRegion(region, smartMode(p));
    r.coverage = tot / Math.max(1, w * h);
    return r;
  });

/* ═══════════ 转换为形状（engine/src/vector_cmds.rs:1053-1065 selection_to_shape ＋ vector/src/trace.rs） ═══════════ */
/* contours：像素中心上 0.5 等值线（marching squares，沿格边线性插值，鞍点看格平均），封闭、不自交；里面在左手边 */
function traceContours(values, rw, rh, ox, oy){
  const get = (x, y) => (x < 0 || y < 0 || x >= rw || y >= rh) ? 0 : values[y * rw + x];
  const KW = rw + 2, key = (x, y, d) => ((y + 1) * KW + (x + 1)) * 2 + d;   // 照 (y, x, 方向) 排序
  const unkey = k => { const d = k & 1, q = k >> 1; return [q % KW - 1, Math.floor(q / KW) - 1, d]; };
  const point = (ax, ay, bx, by) => {
    const va = get(ax, ay), vb = get(bx, by);
    const t = Math.abs(vb - va) > 1e-9 ? clamp01((0.5 - va) / (vb - va)) : 0.5;
    return [ox + ax + 0.5 + (bx - ax) * t, oy + ay + 0.5 + (by - ay) * t];
  };
  const next = new Map();
  for (let cy = -1; cy < rh; cy++) for (let cx = -1; cx < rw; cx++){
    const tl = get(cx, cy) >= 0.5, tr = get(cx + 1, cy) >= 0.5, br = get(cx + 1, cy + 1) >= 0.5, bl = get(cx, cy + 1) >= 0.5;
    const idx = (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const top = key(cx, cy, 0), bottom = key(cx, cy + 1, 0), left = key(cx, cy, 1), right = key(cx + 1, cy, 1);
    const seg = (a, b) => next.set(a, b);
    const centre = () => (get(cx, cy) + get(cx + 1, cy) + get(cx + 1, cy + 1) + get(cx, cy + 1)) / 4;
    switch (idx){
      case 1: seg(left, top); break;        case 2: seg(top, right); break;     case 3: seg(left, right); break;
      case 4: seg(right, bottom); break;
      case 5: if (centre() >= 0.5){ seg(left, bottom); seg(right, top); } else { seg(left, top); seg(right, bottom); } break;
      case 6: seg(top, bottom); break;      case 7: seg(left, bottom); break;   case 8: seg(bottom, left); break;
      case 9: seg(bottom, top); break;
      case 10: if (centre() >= 0.5){ seg(top, left); seg(bottom, right); } else { seg(top, right); seg(bottom, left); } break;
      case 11: seg(bottom, right); break;   case 12: seg(right, left); break;   case 13: seg(right, top); break;
      case 14: seg(top, left); break;
    }
  }
  const edgePoint = k => { const [x, y, d] = unkey(k); return d === 0 ? point(x, y, x + 1, y) : point(x, y, x, y + 1); };
  const keys = [...next.keys()].sort((a, b) => a - b), out = [];
  for (const start of keys){
    if (!next.has(start)) continue;
    const lp = []; let cur = start;
    while (next.has(cur)){ const n = next.get(cur); next.delete(cur); lp.push(edgePoint(cur)); cur = n; if (cur === start) break; }
    const dd = []; for (const p of lp){ const q = dd[dd.length - 1]; if (!q || Math.abs(q[0] - p[0]) >= 1e-9 || Math.abs(q[1] - p[1]) >= 1e-9) dd.push(p); }   // 去掉相邻重复点
    if (dd.length >= 3) out.push(dd);
  }
  return out;
}
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1]], vadd = (a, b) => [a[0] + b[0], a[1] + b[1]], vmul = (a, k) => [a[0] * k, a[1] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1], vlen = a => Math.hypot(a[0], a[1]);
const vnorm = a => { const l = vlen(a); return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]; };
/* walk：在封闭圈上从 i 往前／往后走 window 像素弧长的那一点 */
function walkLoop(lp, i, win, fwd){
  const n = lp.length; let acc = 0, cur = i;
  for (let k = 0; k < n; k++){
    const nx = fwd ? (cur + 1) % n : (cur + n - 1) % n, d = vlen(vsub(lp[nx], lp[cur]));
    if (acc + d >= win) return vadd(lp[cur], vmul(vsub(lp[nx], lp[cur]), (win - acc) / Math.max(d, 1e-12)));
    acc += d; cur = nx;
  }
  return lp[cur];
}
/* corners：±1.5 px 内方向转超过 60° 的局部最小（同值取前一个） */
function loopCorners(lp){
  const n = lp.length, win = 1.5, cosT = Math.cos(60 * Math.PI / 180);
  const turn = lp.map((p, i) => vdot(vnorm(vsub(p, walkLoop(lp, i, win, false))), vnorm(vsub(walkLoop(lp, i, win, true), p))));
  const out = [];
  for (let i = 0; i < n; i++){
    if (turn[i] >= cosT) continue;
    let isMin = true, acc = 0, j = i;
    while (acc < win){ const nx = (j + 1) % n; acc += vlen(vsub(lp[nx], lp[j])); j = nx; if (j === i) break; if (turn[j] < turn[i]){ isMin = false; break; } }
    acc = 0; j = i;
    while (isMin && acc < win){ const pv = (j + n - 1) % n; acc += vlen(vsub(lp[j], lp[pv])); j = pv; if (j === i) break; if (turn[j] <= turn[i]) isMin = false; }
    if (isMin) out.push(i);
  }
  return out;
}
const bez = (b, t) => { const mt = 1 - t, a = mt * mt * mt, bb = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t; return [a * b[0][0] + bb * b[1][0] + c * b[2][0] + d * b[3][0], a * b[0][1] + bb * b[1][1] + c * b[2][1] + d * b[3][1]]; };
const bezD1 = (b, t) => { const mt = 1 - t; return vadd(vadd(vmul(vmul(vsub(b[1], b[0]), 3), mt * mt), vmul(vmul(vsub(b[2], b[1]), 3), 2 * mt * t)), vmul(vmul(vsub(b[3], b[2]), 3), t * t)); };
const bezD2 = (b, t) => vadd(vmul(vmul(vadd(vsub(b[2], vmul(b[1], 2)), b[0]), 6), 1 - t), vmul(vmul(vadd(vsub(b[3], vmul(b[2], 2)), b[1]), 6), t));
function chordParams(pts){
  const u = new Array(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) u[i] = u[i - 1] + vlen(vsub(pts[i], pts[i - 1]));
  const tot = u[pts.length - 1]; if (tot > 0) for (let i = 0; i < u.length; i++) u[i] /= tot;
  return u;
}
/* generate：端点切线固定的最小平方控制点 */
function bezGenerate(pts, u, t1, t2){
  const p0 = pts[0], p3 = pts[pts.length - 1]; let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  u.forEach((t, i) => {
    const mt = 1 - t, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, a1 = vmul(t1, b1), a2 = vmul(t2, b2);
    c00 += vdot(a1, a1); c01 += vdot(a1, a2); c11 += vdot(a2, a2);
    const tmp = vsub(pts[i], vadd(vmul(p0, mt * mt * mt + b1), vmul(p3, b2 + t * t * t)));
    x0 += vdot(a1, tmp); x1 += vdot(a2, tmp);
  });
  const det = c00 * c11 - c01 * c01, det0 = c00 * x1 - c01 * x0, det1 = x0 * c11 - x1 * c01;
  let al = 0, ar = 0; if (Math.abs(det) > 1e-12){ al = det1 / det; ar = det0 / det; }
  const seg = vlen(vsub(p3, p0)), eps = 1e-6 * seg;
  if (al < eps || ar < eps){ al = seg / 3; ar = seg / 3; }
  return [p0, vadd(p0, vmul(t1, al)), vadd(p3, vmul(t2, ar)), p3];
}
function bezMaxError(pts, b, u){ let best = [0, pts.length >> 1]; for (let i = 1; i < pts.length - 1; i++){ const d = vsub(bez(b, u[i]), pts[i]), e = vdot(d, d); if (e >= best[0]) best = [e, i]; } return best; }
function bezReparam(pts, u, b){ return pts.map((p, i) => { const t = u[i], q = bez(b, t), d1 = bezD1(b, t), d2 = bezD2(b, t), num = vdot(vsub(q, p), d1), den = vdot(d1, d1) + vdot(vsub(q, p), d2); return Math.abs(den) < 1e-12 ? t : Math.min(1, Math.max(0, t - num / den)); }); }
/* fit_cubic（Schneider 1990）：误差超过就在最差点切开递回 */
function fitCubic(pts, t1, t2, err2, out, depth){
  const n = pts.length;
  if (n === 2 || depth > 40){ const d = vlen(vsub(pts[n - 1], pts[0])) / 3; out.push([pts[0], vadd(pts[0], vmul(t1, d)), vadd(pts[n - 1], vmul(t2, d)), pts[n - 1]]); return; }
  let u = chordParams(pts), b = bezGenerate(pts, u, t1, t2), [e, split] = bezMaxError(pts, b, u);
  if (e < err2){ out.push(b); return; }
  if (e < err2 * 16){
    for (let k = 0; k < 6; k++){
      const u2 = bezReparam(pts, u, b), b2 = bezGenerate(pts, u2, t1, t2), [e2, s2] = bezMaxError(pts, b2, u2);
      u = u2; b = b2; e = e2; split = s2;
      if (e < err2){ out.push(b); return; }
    }
  }
  split = Math.min(n - 2, Math.max(1, split));
  let tc = vnorm(vsub(pts[split - 1], pts[split + 1]));
  if (vlen(tc) < 0.5) tc = vnorm(vsub(pts[split - 1], pts[split]));
  fitCubic(pts.slice(0, split + 1), t1, tc, err2, out, depth + 1);
  fitCubic(pts.slice(split), vmul(tc, -1), t2, err2, out, depth + 1);
}
/* fit_closed：在角点切段（没有角点＝整圈一段、接缝共切线）→ 我们的钢笔锚点 {x,y,in,out}（把手绝对坐标） */
function fitClosed(lp, tol){
  const n = lp.length, cs = loopCorners(lp), segs = [];
  if (!cs.length){
    const pts = lp.concat([lp[0]]), t = vnorm(vsub(lp[1 % n], lp[n - 1]));
    fitCubic(pts, t, vmul(t, -1), tol * tol, segs, 0);
  } else cs.forEach((c, k) => {
    const end = cs[(k + 1) % cs.length], pts = [lp[c]]; let j = c;
    for (;;){ j = (j + 1) % n; pts.push(lp[j]); if (j === end) break; }
    const m = pts.length;
    fitCubic(pts, vnorm(vsub(pts[Math.min(1, m - 1)], pts[0])), vnorm(vsub(pts[Math.max(0, m - 2)], pts[m - 1])), tol * tol, segs, 0);
  });
  const anchors = segs.map(s => ({x:s[0][0], y:s[0][1], in:null, out:[s[1][0], s[1][1]]}));
  segs.forEach((s, i) => { anchors[(i + 1) % segs.length].in = [s[2][0], s[2][1]]; });
  return anchors;
}
/* 圈的有号面积（y 朝下）与「点在不在圈里」（奇偶规则）——用来认出哪些圈是洞 */
function insideLoop(lp, p){
  let inside = false;
  for (let i = 0, j = lp.length - 1; i < lp.length; j = i++){
    const a = lp[i], b = lp[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
CMD.reg('ps.select.convertToShape', {i18n:'', undoable:true,
  params:'{tolerance:0.5..10 px=2, fill:"#rrggbb"=前景色, name?:str} 转换为形状：选区 0.5 等值线（marching squares）用三次贝兹拟合（角点 ±1.5px 转 >60° 切段，Schneider 最小平方＋牛顿重参数），' +
         '放进一个新的矢量层，每个外圈一个钢笔形状；外圈里有洞（口、日这种）＝外圈连同它的洞做成一个复合形状（奇偶规则，洞是空的，同 PS「排除」子路径） → {ok, id:图层 id, shapes, holes}'},
  p => {
    if (!hasSel()) return fail('no selection');
    const tol = Math.min(10, Math.max(0.5, num(p, 'tolerance', 2)));
    const w = W(), h = H(), bytes = SelMask.bytes(), b = bytesBounds(bytes, w, h);
    if (!b) return fail('no selection');
    const rw = b[2] - b[0], rh = b[3] - b[1], vals = new Float32Array(rw * rh);   // 外框外都是 0 ⇒ 只描外框，结果跟描整张一样
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) vals[y * rw + x] = bytes[(y + b[1]) * w + x + b[0]] / 255;
    const loops = traceContours(vals, rw, rh, b[0], b[1]).filter(lp => lp.length >= 3);
    const fill = typeof p.fill === 'string' ? p.fill : (document.getElementById('fillColor') || {}).value || '#000000';
    const ftol = Math.max(tol * 0.5, 0.05);
    const depth = loops.map((lp, i) => loops.reduce((d, o, j) => d + (j !== i && insideLoop(o, lp[0]) ? 1 : 0), 0));
    let holes = 0; const shapes = [];
    loops.forEach((lp, i) => {
      if (depth[i] % 2) return;                                            // 奇数层＝洞，跟着它的外圈走
      const own = loops.filter((o, j) => depth[j] === depth[i] + 1 && insideLoop(lp, o[0]));   // 直接挖在这一圈里的洞
      holes += own.length;
      if (!own.length){ shapes.push({type:'bezier', anchors:fitClosed(lp, ftol), closed:true, fill, stroke:'none', strokeWidth:0}); return; }
      shapes.push({type:'compound', rule:'evenodd', fill, stroke:'none', strokeWidth:0,
        children:[lp].concat(own).map(o => ({id:uid('S'), type:'bezier', anchors:fitClosed(o, ftol), closed:true, fill:'none', stroke:'none', strokeWidth:0}))});
    });
    if (!shapes.length) return fail('the selection has no outline to trace');
    const L = Layer.vector(typeof p.name === 'string' && p.name.trim() ? p.name.trim() : T('shapeName') + ' ' + (Doc.layers.length + 1));
    for (const s of shapes){ s.id = uid('S'); L.data.shapes.push(s); }
    Doc.add(L); Layer.invalidate(L);
    return {ok:true, id:L.id, shapes:shapes.length, holes};
  });
/* 建立工作路径用：选区等值线全部拟合成子路径（外圈＋洞都留；路径没有「一个形状一条子路径」的限制）。
   洞的方向跟外圈相反（非零绕数填充／载入选区时洞照样是空的，同 PS 从选区生成的路径） → [{closed:true, anchors, hole}] */
PS.traceSelection = function(tol){
  if (!hasSel()) return null;
  tol = Math.min(10, Math.max(0.5, isFinite(tol) ? tol : 2));
  const w = W(), h = H(), bytes = SelMask.bytes(), b = bytesBounds(bytes, w, h);
  if (!b) return null;
  const rw = b[2] - b[0], rh = b[3] - b[1], vals = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) vals[y * rw + x] = bytes[(y + b[1]) * w + x + b[0]] / 255;
  const loops = traceContours(vals, rw, rh, b[0], b[1]), out = [];
  const area = lp => { let s = 0; for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) s += (lp[j][0] - lp[i][0]) * (lp[j][1] + lp[i][1]); return s; };
  loops.forEach((lp, i) => {
    if (lp.length < 3) return;
    const hole = loops.reduce((d, o, j) => d + (j !== i && insideLoop(o, lp[0]) ? 1 : 0), 0) % 2 === 1;
    const want = hole ? -1 : 1, lp2 = Math.sign(area(lp)) === want ? lp : lp.slice().reverse();
    out.push({closed:true, hole, anchors:fitClosed(lp2, Math.max(tol * 0.5, 0.05))});
  });
  return out;
};

/* ═══════════ 选择并遮住（engine/src/smartselect_cmds.rs:132-210 refine_edge ＋ algo/src/matting.rs 24-87, 187-428, 481-560） ═══════════ */
function refineParams(p){
  const c = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const P = {radius:c(num(p, 'radius', 0), 0, 250), smartRadius:bool(p, 'smartRadius', false), smooth:c(num(p, 'smooth', 0), 0, 100),
             feather:c(num(p, 'feather', 0), 0, 1000), contrast:c(num(p, 'contrast', 0), 0, 100), shiftEdge:c(num(p, 'shiftEdge', 0), -100, 100)};
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
/* gaussian_blur：可分离高斯（边缘夹住），σ<0.1 不动 */
function gaussianBlur(src, w, h, sigma){
  if (sigma < 0.1) return Float32Array.from(src);
  const r = Math.ceil(fr(sigma * 3)); let k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const s = k.reduce((a, b) => a + b, 0); k = k.map(v => v / s);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ let a = 0; for (let i = 0; i < k.length; i++) a += src[y * w + Math.min(w - 1, Math.max(0, x + i - r))] * k[i]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ let a = 0; for (let i = 0; i < k.length; i++) a += tmp[Math.min(h - 1, Math.max(0, y + i - r)) * w + x] * k[i]; out[y * w + x] = a; }
  return out;
}
/* morph：灰阶膨胀（grow）／侵蚀约 r 格，3×3 方形与十字交替（八角形结构元素） */
function morph(src, w, h, r, grow){
  let cur = Float32Array.from(src), nxt = Float32Array.from(src);
  for (let k = 0; k < r; k++){
    const square = k % 2 === 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      let v = cur[y * w + x];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        if ((dx && dy && !square) || (!dx && !dy)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h){ const q = cur[ny * w + nx]; v = grow ? Math.max(v, q) : Math.min(v, q); }
      }
      nxt[y * w + x] = v;
    }
    [cur, nxt] = [nxt, cur];
  }
  return cur;
}
/* running_extreme（van Herk / Gil–Werman）＋ max_square：方窗滑动最大／最小（边缘夹住） */
function runningExtreme(src, n, r, max){
  const k = 2 * r + 1, pad = max ? -Infinity : Infinity, f = max ? Math.max : Math.min, m = Math.ceil((n + 2 * r) / k) * k;
  const p = j => (j >= r && j < r + n) ? src[j - r] : pad, g = new Float32Array(m), hb = new Float32Array(m), out = new Float32Array(n);
  for (let j = 0; j < m; j++) g[j] = j % k === 0 ? p(j) : f(g[j - 1], p(j));
  for (let j = m - 1; j >= 0; j--) hb[j] = (j % k === k - 1 || j === m - 1) ? p(j) : f(hb[j + 1], p(j));
  for (let i = 0; i < n; i++) out[i] = f(hb[i], g[i + 2 * r]);
  return out;
}
function maxSquare(src, w, h, r, max){
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), col = new Float32Array(h);
  for (let y = 0; y < h; y++) tmp.set(runningExtreme(src.subarray(y * w, (y + 1) * w), w, r, max), y * w);
  for (let x = 0; x < w; x++){ for (let y = 0; y < h; y++) col[y] = tmp[y * w + x]; const res = runningExtreme(col, h, r, max); for (let y = 0; y < h; y++) out[y * w + x] = res[y]; }
  return out;
}
/* edge_width：亮度的局部范围 ÷ 局部最大梯度（锐利的边 ~2、宽 L 的渐变 ~L） */
function edgeWidth(rgb, w, h, r){
  const y = new Float32Array(w * h), g = new Float32Array(w * h);
  for (let i = 0; i < y.length; i++) y[i] = luma3(rgb, i * 3);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++){
    const gx = (y[yy * w + Math.min(w - 1, xx + 1)] - y[yy * w + Math.max(0, xx - 1)]) / 2, gy = (y[Math.min(h - 1, yy + 1) * w + xx] - y[Math.max(0, yy - 1) * w + xx]) / 2;
    g[yy * w + xx] = Math.sqrt(gx * gx + gy * gy);
  }
  const gm = maxSquare(g, w, h, r, true), hi = maxSquare(y, w, h, r, true), lo = maxSquare(y, w, h, r, false), out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (hi[i] - lo[i]) / Math.max(gm[i], 1e-4);
  return out;
}
/* refine_buffer：边缘带里用导向滤波（影像当导引）贴出柔边 → 平滑 → 羽化 → 对比度 → 移动边缘
   ov（选择并遮住工作区的调整边缘画笔；NaN＝没刷到）：边缘检测之后、全局调整之前，刷过的地方换成抠出来的 alpha（Alt 擦回＝原来的边） */
function refineBuffer(rgb, m, w, h, P, ov){
  let a = Float32Array.from(m);
  if (P.usesImage && rgb){
    const boundary = new Uint8Array(w * h); let any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x, v = m[i] >= 0.5;
      const d = (x > 0 && (m[i - 1] >= 0.5) !== v) || (x + 1 < w && (m[i + 1] >= 0.5) !== v) || (y > 0 && (m[i - w] >= 0.5) !== v) || (y + 1 < h && (m[i + w] >= 0.5) !== v);
      if (d){ boundary[i] = 1; any = true; }
    }
    if (any){
      const dist = edt(boundary, w, h), q = guidedColor(rgb, m, w, h, P.gfRadius, 1e-4), widths = P.smartRadius ? edgeWidth(rgb, w, h, P.gfRadius) : null;
      for (let i = 0; i < w * h; i++){
        const reff = widths ? Math.min(Math.max(1.5, P.radius), Math.max(1.5, widths[i])) : P.radius;
        const wgt = clamp01(reff + 1 - dist[i]);
        if (wgt > 0) a[i] = m[i] + (clamp01(q[i]) - m[i]) * wgt;
      }
    }
  }
  if (ov) for (let i = 0; i < a.length; i++) if (ov[i] === ov[i]) a[i] = ov[i];
  const ss = P.smoothSigma;
  if (ss >= 0.3){ a = gaussianBlur(a, w, h, ss); const gain = 1 + ss; for (let i = 0; i < a.length; i++) a[i] = clamp01((a[i] - 0.5) * gain + 0.5); }
  a = gaussianBlur(a, w, h, P.featherSigma);
  if (P.contrast > 0){ const gain = 1 / (1 - 0.99 * Math.min(100, P.contrast) / 100); for (let i = 0; i < a.length; i++) a[i] = clamp01((a[i] - 0.5) * gain + 0.5); }
  if (P.shiftPx) a = morph(a, w, h, Math.abs(P.shiftPx), P.shiftPx > 0);
  return a;
}
/* refine_mask：只处理选区外框外扩 spread 的那块，每 256 格一块、各带 halo 读周围；整块都是 0 或 1 的直接抄 → 整张 8 位遮罩或 null */
function refineMask(mask, rgb, W0, H0, P, ov){
  let cb = bytesBounds(mask, W0, H0);
  const ob = ov ? ovBounds(ov, W0, H0) : null;
  if (ob) cb = cb ? [Math.min(cb[0], ob[0]), Math.min(cb[1], ob[1]), Math.max(cb[2], ob[2]), Math.max(cb[3], ob[3])] : ob;
  if (!cb) return null;
  const bx0 = Math.max(0, cb[0] - P.spread), by0 = Math.max(0, cb[1] - P.spread), bx1 = Math.min(W0, cb[2] + P.spread), by1 = Math.min(H0, cb[3] + P.spread);
  const out = new Uint8Array(W0 * H0), TILE = 256;
  for (let ty = by0; ty < by1; ty += TILE) for (let tx = bx0; tx < bx1; tx += TILE){
    const t1x = Math.min(tx + TILE, bx1), t1y = Math.min(ty + TILE, by1);
    const rx0 = Math.max(0, tx - P.halo), ry0 = Math.max(0, ty - P.halo), rx1 = Math.min(W0, t1x + P.halo), ry1 = Math.min(H0, t1y + P.halo), rw = rx1 - rx0, rh = ry1 - ry0;
    const m = new Float32Array(rw * rh); let same = true;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++){ const v = mask[(ry0 + y) * W0 + rx0 + x] / 255; m[y * rw + x] = v; }
    const first = m[0]; for (let i = 1; i < m.length && same; i++) if (m[i] !== first) same = false;
    let ovs = null;
    if (ob && !(ob[2] <= rx0 || ob[0] >= rx1 || ob[3] <= ry0 || ob[1] >= ry1)){
      ovs = new Float32Array(rw * rh); for (let y = 0; y < rh; y++) ovs.set(ov.subarray((ry0 + y) * W0 + rx0, (ry0 + y) * W0 + rx1), y * rw);
      same = false;
    }
    const q = v => Math.round(clamp01(v) * 255);
    if (same && (first === 0 || first === 1)){ for (let y = ty; y < t1y; y++) out.fill(q(first), y * W0 + tx, y * W0 + t1x); continue; }
    let sub = null;
    if (P.usesImage){ sub = new Float32Array(rw * rh * 3); for (let y = 0; y < rh; y++) sub.set(rgb.subarray(((ry0 + y) * W0 + rx0) * 3, ((ry0 + y) * W0 + rx1) * 3), y * rw * 3); }
    const res = refineBuffer(sub, m, rw, rh, P, ovs);
    for (let y = ty; y < t1y; y++) for (let x = tx; x < t1x; x++) out[y * W0 + x] = q(res[(y - ry0) * rw + (x - rx0)]);
  }
  return out.some(v => v) ? out : null;
}
/* decontaminate：柔边上的颜色往附近全选像素的平均色靠（正规化卷积，半径 max(radius,3)，附近没有就放宽 ×4），按 amount 与透明度 */
function decontaminate(px, alpha, w, h, radius, amount){
  const n = w * h, rad = Math.ceil(Math.max(radius, 3)), amt = Math.min(100, Math.max(0, amount)) / 100, soft = a => a > 0.02 && a < 0.98;
  const wts = new Float32Array(n); for (let i = 0; i < n; i++) wts[i] = alpha[i] / 255 >= 0.98 ? px[i * 4 + 3] / 255 : 0;
  const den = boxMean(wts, w, h, rad), den2 = boxMean(wts, w, h, rad * 4), out = new Uint8ClampedArray(px);
  const nums = [0, 1, 2].map(c => { const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = wts[i] * px[i * 4 + c] / 255; return [boxMean(v, w, h, rad), boxMean(v, w, h, rad * 4)]; });
  for (let i = 0; i < n; i++){
    const a = alpha[i] / 255; if (!soft(a)) continue;
    const k = amt * clamp01((1 - a) * 4); if (!k) continue;
    for (let c = 0; c < 3; c++){
      const v = px[i * 4 + c] / 255, f = den[i] > 1e-4 ? nums[c][0][i] / den[i] : den2[i] > 1e-4 ? nums[c][1][i] / den2[i] : v;
      out[i * 4 + c] = Math.round((v + (f - v) * k) * 255);
    }
  }
  return out;
}
PS.algo.refineMask = refineMask;
function ovBounds(ov, w, h){
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ov[y * w + x] === ov[y * w + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
/* ── 选择并遮住工作区的笔画（PS：调整边缘画笔 R、画笔 B；Alt＝反过来）──
   stroke = {tool:'refine'|'brush'|'refineHair'|'quickSelect'|'lasso'|'objectSelect', subtract?, size, hardness?, pts:[[x,y]…], rect?}（文件坐标；笔尖＝直径 size 的圆，点与点之间每 r/2 盖一个）
   画笔：直接在原选区上加（255）／减（0），hardness<1＝软边笔尖；调整边缘画笔：记进 ref 图（1＝要抠、2＝Alt 擦回原边）；
   refineHair：PS「调整细线」——只在边缘带里判断为毛发／细节的地方自动刷（hairZones）；
   quickSelect／lasso／objectSelect：工作区左边的快速选择／套索／对象选择，直接对原选区加／减（走 quickselect.select／lasso.select／objectselect.select 同一套算法） */
/* tip＝PS 画笔设置的 {spacing（直径的倍数，缺省 0.25）, spacingEnabled（false＝间距勾掉：每个事件点盖一个）, angle（度，逆时针）, roundness（0..1，缺省 1）,
   sizeControl:"pen"（大小：钢笔压力——点的第三格＝压力 0..1，那颗的直径＝size·压力）}：笔尖＝长轴 size、短轴 size·圆度、转 angle 的椭圆。回盖到的外框 [x0,y0,x1,y1]（或 null） */
function stampPts(map, w, h, pts, size, val, hardness, tip, walk){   // walk＝{i, need}：拖动中接着上次盖到的地方往下盖（跟整条重盖一模一样）
  const hard = typeof hardness === 'number' && hardness < 1 ? Math.max(0, hardness) : 1;
  const ro = tip && tip.roundness < 1 ? Math.max(0.01, tip.roundness) : 1, an = tip && tip.angle ? -tip.angle * Math.PI / 180 : 0, ca = Math.cos(an), sa = Math.sin(an);
  const dist2 = ro === 1 && !an ? (dx, dy) => dx * dx + dy * dy : (dx, dy) => { const u = dx * ca + dy * sa, v = (dy * ca - dx * sa) / ro; return u * u + v * v; };
  const pen = !!tip && SAM_CTLS.includes(tip.sizeControl) && tip.sizeControl !== 'off', rOf = q => Math.max(0.5, size / 2 * (pen && isFinite(q[2]) ? Math.min(1, Math.max(0.01, q[2])) : 1));   // 钢笔压力／斜度／光笔轮：第三格＝大小比例
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  const dab = (cx, cy, r) => {
    const r2 = r * r, r0 = r * hard;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    if (x0 < bx0) bx0 = x0; if (y0 < by0) by0 = y0; if (x1 > bx1) bx1 = x1; if (y1 > by1) by1 = y1;
    if (hard >= 1){ for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){ if (dist2(x + 0.5 - cx, y + 0.5 - cy) <= r2) map[y * w + x] = val; } return; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){       // 软边：r·硬度以内全量，往外线性淡到 0；加＝取大、减＝取小
      const d = Math.sqrt(dist2(x + 0.5 - cx, y + 0.5 - cy)); if (d > r) continue;
      const k = d <= r0 ? 1 : (r - d) / Math.max(1e-6, r - r0), i = y * w + x;
      map[i] = val ? Math.max(map[i], Math.round(val * k)) : Math.min(map[i], Math.round(255 * (1 - k)));
    }
  };
  const P0 = pts.filter(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])); if (!P0.length) return null;
  const pr = q => isFinite(q[2]) ? q[2] : 1, from = walk && walk.i >= 0 ? walk.i + 1 : 1;
  if (from === 1) dab(P0[0][0], P0[0][1], rOf(P0[0]));
  if (tip && tip.spacingEnabled === false){ for (let i = from; i < P0.length; i++) dab(P0[i][0], P0[i][1], rOf(P0[i])); }
  else {
    const sp = tip && tip.spacing > 0 ? tip.spacing : 0.25;
    let need = from === 1 ? Math.max(0.5, 2 * rOf(P0[0]) * sp) : walk.need;   // 沿整条路径量距离，每「目前直径×间距」盖一个（跨点累计，PS 的间距）
    for (let i = from; i < P0.length; i++){
      const a = P0[i - 1], b = P0[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!d) continue;
      let pos = 0;
      while (d - pos >= need){
        pos += need; const t = pos / d, r = rOf([0, 0, pr(a) + (pr(b) - pr(a)) * t]);
        dab(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r); need = Math.max(0.5, 2 * r * sp);
      }
      need -= d - pos;
    }
    if (walk) walk.need = need;
  }
  if (walk) walk.i = P0.length - 1;
  return bx1 < 0 ? null : [bx0, by0, bx1 + 1, by1 + 1];
}
/* 调整边缘画笔刷过的地方怎么抠（PS「颜色识别」：前景／背景颜色分得开时最准）：刷到的＝未知，没刷到的照原选区当已知前景（≥½）／背景；
   每个未知像素取附近（半径 R，找不到放宽 ×4、再找不到用整块平均）已知前景、背景的平均色 F、B，alpha＝(I−B)·(F−B)／|F−B|²（投影到 F–B 那条线上）。
   F、B 太像（|F−B| < 0.05）就分不出 ⇒ 照原选区。
   「对象识别」（毛发跟背景颜色接近、背景有纹理时）：局部颜色模型＝前景／背景各自在两个尺度（R、4R）的平均色与协方差，
   沿 F−B 方向看两边的散布 σF、σB：投影值落在背景 2σB 以内＝背景、落在前景 2σF 以内＝前景、中间线性（纹理杂讯不再一颗颗漏成半透明）；
   影像取两个版本（原图、σ=1 柔化：杂讯降、细发丝还在）× 两个尺度，按分离度（|F−B|²／(|F−B|²+4(σF²+σB²))）信心串接：前一个可靠就听它、不可靠的份额往下传；
   最后剩的份额给多尺度导向滤波（原选区当输入、影像当导引，半径 R／4 与 R）的物体形状先验。
   回 Float32（整张；NaN＝没刷到；Alt 擦回的地方＝原选区值） */
function brushMatte(mask, ref, rgb, w, h, R, objectAware){
  const ov = new Float32Array(w * h).fill(NaN);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x, v = ref[i]; if (!v) continue;
    if (v === 2){ ov[i] = mask[i] / 255; continue; }
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0 || !rgb) return ov;
  const ex = 4 * R, bx0 = Math.max(0, x0 - ex), by0 = Math.max(0, y0 - ex), bx1 = Math.min(w, x1 + 1 + ex), by1 = Math.min(h, y1 + 1 + ex);
  const cw = bx1 - bx0, ch = by1 - by0, n = cw * ch;
  const wf = new Float32Array(n), wb = new Float32Array(n), cf = [0, 1, 2].map(() => new Float32Array(n)), cbk = [0, 1, 2].map(() => new Float32Array(n));
  const gF = [0, 0, 0, 0], gB = [0, 0, 0, 0];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){
    const k = y * cw + x, i = (y + by0) * w + x + bx0; if (ref[i] === 1) continue;
    const fg = mask[i] >= 128, arr = fg ? cf : cbk, g = fg ? gF : gB;
    (fg ? wf : wb)[k] = 1; g[3]++;
    for (let c = 0; c < 3; c++){ arr[c][k] = rgb[i * 3 + c]; g[c] += rgb[i * 3 + c]; }
  }
  const means = r => ({f:boxMean(wf, cw, ch, r), b:boxMean(wb, cw, ch, r), F:cf.map(a => boxMean(a, cw, ch, r)), B:cbk.map(a => boxMean(a, cw, ch, r))});
  const M1 = means(R), M2 = means(4 * R);
  let gq = null, OBJ = null;
  if (objectAware){
    const sub = new Float32Array(n * 3), m = new Float32Array(n);
    for (let y = 0; y < ch; y++){ sub.set(rgb.subarray(((y + by0) * w + bx0) * 3, ((y + by0) * w + bx1) * 3), y * cw * 3); for (let x = 0; x < cw; x++) m[y * cw + x] = mask[(y + by0) * w + x + bx0] / 255; }
    const g1 = guidedColor(sub, m, cw, ch, Math.min(64, Math.max(2, Math.round(R / 4))), 1e-3), g2 = guidedColor(sub, m, cw, ch, Math.min(64, Math.max(2, R)), 1e-4);
    gq = new Float32Array(n); for (let k = 0; k < n; k++) gq[k] = 0.5 * clamp01(g1[k]) + 0.5 * clamp01(g2[k]);
    // 影像两个版本：原图（细）与 σ=1 高斯（杂讯降约 3.5 倍、细发丝还在）；各自在 R、4R 两个尺度算前景／背景的平均与二阶矩（rr rg rb gg gb bb）
    const soft = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++){ const v = new Float32Array(n); for (let k = 0; k < n; k++) v[k] = sub[k * 3 + c]; const b = gaussianBlur(v, cw, ch, 1); for (let k = 0; k < n; k++) soft[k * 3 + c] = b[k]; }
    const PAIRS = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
    const stats = img => {
      const side = wt => [0, 1, 2].map(c => { const v = new Float32Array(n); for (let k = 0; k < n; k++) v[k] = wt[k] * img[k * 3 + c]; return v; });
      const Fc = side(wf), Bc = side(wb);
      const mom = (arr, r) => PAIRS.map(([a, b]) => { const v = new Float32Array(n); for (let k = 0; k < n; k++) v[k] = arr[a][k] * arr[b][k]; return boxMean(v, cw, ch, r); });
      const at = (r, Mr) => ({M:{f:Mr.f, b:Mr.b, F:Fc.map(a => boxMean(a, cw, ch, r)), B:Bc.map(a => boxMean(a, cw, ch, r))}, S:{F:mom(Fc, r), B:mom(Bc, r)}});
      return [Object.assign({img}, at(R, M1)), Object.assign({img}, at(4 * R, M2))];
    };
    const [r1, r4] = stats(sub), [s1, s4] = stats(soft);
    OBJ = [r1, r4, s1, s4];                                          // 信心串接的顺序：原图细尺度 → 原图粗尺度 → 柔化细 → 柔化粗
  }
  /* 对象识别：一个版本、一个尺度的局部颜色模型 → [alpha, 分离度]；那个尺度附近没有前景或背景样本 ⇒ null */
  const objAt = (k, E) => {
    const M = E.M, S = E.S, img = E.img;
    const df = M.f[k], db = M.b[k]; if (df <= 1e-4 || db <= 1e-4) return null;
    const F = [0, 1, 2].map(c => M.F[c][k] / df), B = [0, 1, 2].map(c => M.B[c][k] / db), d = [F[0] - B[0], F[1] - B[1], F[2] - B[2]];
    const L = Math.hypot(d[0], d[1], d[2]); if (L < 1e-3) return [0.5, 0];
    const u = d.map(v => v / L);
    const vu = (Sm, mu, wsum) => {                                  // 沿 u 的变异：uᵀ(E[ccᵀ]−μμᵀ)u
      const e = Sm.map(a => a[k] / wsum), C = [[e[0], e[1], e[2]], [e[1], e[3], e[4]], [e[2], e[4], e[5]]];
      let v = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += u[a] * u[b] * (C[a][b] - mu[a] * mu[b]);
      return Math.max(0, v);
    };
    const vF = vu(S.F, F, df), vB = vu(S.B, B, db);
    const t = (img[k * 3] - B[0]) * u[0] + (img[k * 3 + 1] - B[1]) * u[1] + (img[k * 3 + 2] - B[2]) * u[2];
    const lo = Math.min(2 * Math.sqrt(vB), 0.45 * L), hi = L - Math.min(2 * Math.sqrt(vF), 0.45 * L);
    return [clamp01((t - lo) / Math.max(1e-4, hi - lo)), L * L / (L * L + 4 * (vF + vB) + 1e-5)];
  };
  const pick = (k, c, fg) => {
    const d1 = fg ? M1.f[k] : M1.b[k], d2 = fg ? M2.f[k] : M2.b[k], g = fg ? gF : gB;
    if (d1 > 1e-4) return (fg ? M1.F : M1.B)[c][k] / d1;
    if (d2 > 1e-4) return (fg ? M2.F : M2.B)[c][k] / d2;
    return g[3] ? g[c] / g[3] : (fg ? 1 : 0);
  };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){
    const k = y * cw + x, i = (y + by0) * w + x + bx0; if (ref[i] !== 1) continue;
    let a;
    if (gq){
      // 信心串接：前面那个估计分离度高就几乎全听它，剩下的份额才往后（柔化、粗尺度）传，最后剩的给物体形状先验
      let left = 1; a = 0;
      for (const E of OBJ){ const o = objAt(k, E); if (!o) continue; const wgt = left * o[1] * o[1]; a += wgt * o[0]; left -= wgt; }
      a += left * clamp01(gq[k]);
    } else {
      let dd = 0, num_ = 0;
      for (let c = 0; c < 3; c++){ const F = pick(k, c, true), B = pick(k, c, false), d = F - B; dd += d * d; num_ += (rgb[i * 3 + c] - B) * d; }
      a = dd < 0.0025 ? mask[i] / 255 : clamp01(num_ / dd);
    }
    ov[i] = a < 0.03 ? 0 : a > 0.97 ? 1 : a;
  }
  return ov;
}
/* 原选区上的整片操作（工作区按钮）：subject＝选择主体（取代）、clear＝清除选区、invert＝反相 */
function applyBaseOps(bytes, ops){
  for (const op of ops){
    if (op === 'clear') bytes.fill(0);
    else if (op === 'invert'){ for (let i = 0; i < bytes.length; i++) bytes[i] = 255 - bytes[i]; }
    else if (op === 'subject' && CMD.map['ps.select.subject']){
      const keep = Doc.sel; Doc.sel = null;
      try { CMD.map['ps.select.subject'].run({}); bytes.set(Doc.sel ? SelMask.bytes() : new Uint8Array(bytes.length)); } finally { Doc.sel = keep; }
    }
  }
  return bytes;
}
/* 调整细线的「毛发／细节区」（PS 只在它判断为毛发的边缘自动处理，平滑的边不动）：选区边缘带（离边 ≤ wd）里找
   ① 细结构对比＝亮度与 R／G／B 各自的白顶帽＋黑顶帽（半径 2 的开／闭运算差：1–4px 的细线才有，平直或圆滑的阶梯边几乎 0），取最大；
   ② 颜色方差＝3×3 邻域 RGB 方差和（纯色平涂里的微弱渐层不算）；
   两样都过门槛（顶帽 ≥ 0.06、方差 ≥ 0.0015）＝细节像素；邻域（半径 max(4, wd/2)）里细节像素占 ≥ 2% 的边缘带＝毛发区。只算边缘带外框那块。
   回整张 Uint8Array（1＝毛发区）或 null */
function hairZones(mask, rgb, w, h, wd){
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const edge = i => { const x = i % w, y = (i - x) / w, v = mask[i] >= 128;
    return (x > 0 && (mask[i - 1] >= 128) !== v) || (x + 1 < w && (mask[i + 1] >= 128) !== v) || (y > 0 && (mask[i - w] >= 128) !== v) || (y + 1 < h && (mask[i + w] >= 128) !== v); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edge(y * w + x)){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0 || !rgb) return null;
  const R = Math.max(4, Math.round(wd / 2)), pad = Math.ceil(wd) + R + 4;
  const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad), cx1 = Math.min(w, x1 + 1 + pad), cy1 = Math.min(h, y1 + 1 + pad), cw = cx1 - cx0, ch = cy1 - cy0, n = cw * ch;
  const b = new Uint8Array(n), chan = [0, 1, 2, 3].map(() => new Float32Array(n));
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){
    const k = y * cw + x, i = (y + cy0) * w + x + cx0;
    if (edge(i)) b[k] = 1;
    for (let c = 0; c < 3; c++) chan[c][k] = rgb[i * 3 + c];
    chan[3][k] = luma3(rgb, i * 3);
  }
  const th = new Float32Array(n);
  for (const v of chan){
    const op = maxSquare(maxSquare(v, cw, ch, 2, false), cw, ch, 2, true), cl = maxSquare(maxSquare(v, cw, ch, 2, true), cw, ch, 2, false);
    for (let k = 0; k < n; k++){ const t = (v[k] - op[k]) + (cl[k] - v[k]); if (t > th[k]) th[k] = t; }
  }
  const vr = new Float32Array(n);
  for (let c = 0; c < 3; c++){
    const v = chan[c], sq = new Float32Array(n); for (let k = 0; k < n; k++) sq[k] = v[k] * v[k];
    const m = boxMean(v, cw, ch, 1), m2 = boxMean(sq, cw, ch, 1);
    for (let k = 0; k < n; k++) vr[k] += Math.max(0, m2[k] - m[k] * m[k]);
  }
  const det = new Float32Array(n); for (let k = 0; k < n; k++) det[k] = th[k] >= 0.06 && vr[k] >= 0.0015 ? 1 : 0;
  const dens = boxMean(det, cw, ch, R), dist = edt(b, cw, ch), out = new Uint8Array(w * h); let any = false;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){ const k = y * cw + x; if (dist[k] <= wd && dens[k] >= 0.02){ out[(y + cy0) * w + x + cx0] = 1; any = true; } }
  return any ? out : null;
}
PS.algo.hairZones = hairZones;
/* 工作区左边的快速选择／套索／对象选择：对原选区加／减（借那三颗工具的命令算，Doc.sel 临时换成 mask、算完换回；
   CMD._depth 先加一层：它们「找不到」时会退掉一步历史，不能退到外面这条命令的） */
const SAM_SEL_CMDS = {quickSelect:'quickselect.select', lasso:'lasso.select', objectSelect:'objectselect.select'};
/* 快速选择笔画 → quickselect.select 的参数（拖动中的增量预览、停笔精修也用同一份，键才对得上） */
function qsCmdParams(s){
  const q = {points:s.pts, size:Math.min(5000, Math.max(1, num(s, 'size', 30)))};
  for (const f of ['spacing', 'spacingEnabled', 'angle', 'roundness', 'sizeControl']) if (s[f] !== undefined) q[f] = s[f];
  if (s.hardness !== undefined) q.hardness = num(s, 'hardness', 1) * 100;   // 笔画记 0..1、命令收 %
  return q;
}
function selToolApply(mask, s, all){
  if (window.__segWorker){ window.__segApply(mask,s,all); return; }
  const c = CMD.map[SAM_SEL_CMDS[s.tool]]; if (!c) return;
  const q = {mode:s.subtract ? 'subtract' : 'add', sampleAllLayers:all};
  if (s.tool === 'objectSelect' && Array.isArray(s.rect)) q.rect = s.rect;
  else if (!Array.isArray(s.pts)) return;
  else if (s.tool === 'quickSelect') Object.assign(q, qsCmdParams(s));   // 快速选择照笔画的画笔设置（硬度、间距、角度、圆度、大小控制）取样
  else if (s.tool === 'lasso'){ if (s.pts.length < 3) return; q.points = s.pts; }
  else { if (s.pts.length < 3) return; q.lasso = s.pts; }
  const keep = Doc.sel; let any = false; for (let i = 0; i < mask.length && !any; i++) if (mask[i]) any = true;
  Doc.sel = any ? SelMask.fromBytes(mask) : null;
  CMD._depth++;
  try { const r = c.run(q); if (r && r.ok !== false){ if (Doc.sel) mask.set(SelMask.bytes()); else mask.fill(0); } }
  finally { CMD._depth--; Doc.sel = keep; }
}
/* 笔画与按钮动作 → {mask（改过的原选区）, ov（调整边缘画笔的抠图结果）, rgbF()（影像，用到才读）}；跟边缘检测／全局调整的栏位无关 ⇒ 工作区拖滑杆时可以重用 */
function refinePrep(p, base){
  const w = W(), h = H(), n = w * h;
  let mask = base ? Uint8Array.from(base) : (hasSel() ? Uint8Array.from(SelMask.bytes()) : new Uint8Array(n));
  if (!base && Array.isArray(p.ops)) applyBaseOps(mask, p.ops.filter(o => typeof o === 'string'));
  const all = bool(p, 'sampleAllLayers', false);
  let rgbC = null; const rgbF = () => rgbC || (rgbC = rgbOf(samplePixels(all), n));
  const S = {mask, ref:null, maxR:0, w, h, all, rgbF};
  for (const s of Array.isArray(p.strokes) ? p.strokes : []) prepStroke(S, s);
  const ref = S.ref, brush = !!(ref && ref.includes(1));
  const ov = ref ? brushMatte(mask, ref, brush ? rgbF() : null, w, h, Math.ceil(S.maxR) + 2, p.refineMode === 'object') : null;
  return {mask, ov, rgbF, ref, maxR:S.maxR};
}
/* 笔画的画笔设置（PS 画笔设置面板：间距 %＋勾选框、角度°、圆度 %、大小：关／钢笔压力／钢笔斜度／光笔轮；缺省 25%／开／0°／100%／关＝圆笔尖）；
   hardness（0..1）只给快速选择的分割用（画笔的软边另由 stampPts 的 hardness 参数管） */
const SAM_CTLS = ['off', 'pen', 'tilt', 'wheel'];
function strokeTip(s){
  return {spacing:Math.min(10, Math.max(0.01, num(s, 'spacing', 25) / 100)), spacingEnabled:s.spacingEnabled !== false, angle:Math.min(180, Math.max(-180, num(s, 'angle', 0))),
          roundness:Math.min(1, Math.max(0.01, num(s, 'roundness', 100) / 100)), sizeControl:SAM_CTLS.includes(s.sizeControl) ? s.sizeControl : 'off',
          hardness:Math.min(1, Math.max(0, num(s, 'hardness', 1)))};
}
/* 一笔套到 S＝{mask, ref, maxR, w, h, all, rgbF}（refinePrep 与工作区拖动中的预览共用） */
function prepStroke(S, s){
  if (!s || typeof s !== 'object') return;
  const w = S.w, h = S.h, n = w * h;
  if (s.tool === 'refineHair'){
    const wd = Math.min(100, Math.max(2, num(s, 'width', Math.max(6, Math.round(Math.min(w, h) * 0.03)))));
    const z = hairZones(S.mask, S.rgbF(), w, h, wd); if (!z) return;
    S.ref = S.ref || new Uint8Array(n);
    for (let i = 0; i < n; i++) if (z[i] && S.ref[i] !== 2) S.ref[i] = 1;
    S.maxR = Math.max(S.maxR, wd); return;
  }
  if (SAM_SEL_CMDS[s.tool]){ selToolApply(S.mask, s, S.all); return; }
  if (!Array.isArray(s.pts)) return;
  const size = Math.min(5000, Math.max(1, num(s, 'size', 20))), tip = strokeTip(s);
  if (s.tool === 'brush') return stampPts(S.mask, w, h, s.pts, size, s.subtract ? 0 : 255, num(s, 'hardness', 1), tip);
  S.ref = S.ref || new Uint8Array(n); S.maxR = Math.max(S.maxR, size / 2);
  return stampPts(S.ref, w, h, s.pts, size, s.subtract ? 2 : 1, 1, tip);
}
/* refine 结果（不动文件；命令与工作区预览共用）。base＝工作区已经套过 baseOps 的原选区（给了就不再跑 baseOps）；prep＝工作区留着的 refinePrep 结果 */
function refineCompute(p, base, prep){
  const P = refineParams(p), w = W(), h = H(), pr = prep || refinePrep(p, base);
  return {P, base:pr.mask, region:refineMask(pr.mask, P.usesImage ? pr.rgbF() : null, w, h, P, pr.ov)};
}
PS.algo.refineCompute = refineCompute;
Object.assign(PS.algo,{refinePrep,refineParams,brushMatte,rgbOf,refineProxy});
if(window.__segWorker) return;

/* 工作区的低解析度预览（没勾「高品质预览」、拖滑杆时）：原选区／抠图结果／影像缩成 1/k（方框平均），半径、平滑、羽化跟着 ÷k，算完双线性放回原尺寸 */
function refineProxy(p, pr, k){
  const w = W(), h = H(), sw = Math.ceil(w / k), sh = Math.ceil(h / k), sn = sw * sh;
  const ms = new Float32Array(sn), cnt = new Float32Array(sn), ovs = pr.ov ? new Float32Array(sn) : null, ovn = pr.ov ? new Float32Array(sn) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x, j = ((y / k) | 0) * sw + ((x / k) | 0);
    ms[j] += pr.mask[i]; cnt[j]++;
    if (ovs && pr.ov[i] === pr.ov[i]){ ovs[j] += pr.ov[i]; ovn[j]++; }
  }
  const m8 = new Uint8Array(sn); for (let j = 0; j < sn; j++) m8[j] = Math.round(ms[j] / cnt[j]);
  let ov = null; if (ovs){ ov = new Float32Array(sn).fill(NaN); for (let j = 0; j < sn; j++) if (ovn[j] * 2 >= cnt[j]) ov[j] = ovs[j] / ovn[j]; }
  const q = Object.assign({}, p, {radius:num(p, 'radius', 0) / k, smooth:num(p, 'smooth', 0) / k, feather:num(p, 'feather', 0) / k}), P = refineParams(q);
  const rgb = P.usesImage ? downsample(pr.rgbF(), w, h, k).px : null;
  return upsampleU8(refineMask(m8, rgb, sw, sh, P, ov), sw, sh, k, w, h);
}
/* 小图（sw×sh，1/k）双线性放回 w×h；small＝null ⇒ 全 0 */
function upsampleU8(small, sw, sh, k, w, h){
  const out = new Uint8Array(w * h);
  if (!small) return out;
  for (let y = 0; y < h; y++){
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / k - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++){
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / k - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = small[y0 * sw + x0] * (1 - tx) + small[y0 * sw + x1] * tx, b = small[y1 * sw + x0] * (1 - tx) + small[y1 * sw + x1] * tx;
      out[y * w + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}
const SAM_OUTPUTS = ['selection', 'layerMask', 'newLayer', 'newLayerWithMask', 'newDocument', 'newDocumentWithMask'];
CMD.reg('ps.select.selectAndMask', {i18n:'', undoable:true,
  params:'{radius:0..250 px=0（边缘检测半径；0＝不看影像）, smartRadius=false, smooth:0..100=0, feather:0..1000 px=0, contrast:0..100=0, shiftEdge:-100..100=0（% of max(radius,4px)）, ' +
         'decontaminate=false, amount:0..100=100, output:"selection|layerMask|newLayer|newLayerWithMask|newDocument|newDocumentWithMask"="selection", sampleAllLayers=false, refineMode:"color|object"="color", ' +
         'ops?:["subject"|"clear"|"invert"…]（先对原选区做：选择主体／清除选区／反相）, strokes?:[{tool:"refine"|"brush"|"refineHair"|"quickSelect"|"lasso"|"objectSelect", subtract?, size, hardness?, spacing?:1..1000 %=25, spacingEnabled?=true（false＝每个点盖一个）, angle?:°=0, roundness?:1..100 %=100, sizeControl?:"off|pen"="off"（pen＝点的第三格压力缩放大小）, pts:[[x,y,pressure?]…], rect?:[x,y,w,h], width?}]' +
         '（工作区的调整边缘画笔／画笔／调整细线（只处理判断为毛发的边缘）／快速选择／套索／对象选择，文件坐标，按顺序套）} ' +
         '选择并遮住（原码 select.refineEdge ＋ PS 工作区）：选区边上半径内用导向滤波（影像当导引）贴出柔边；调整边缘画笔刷过的地方照前景／背景颜色抠出 alpha（Alt 刷＝擦回原边）；' +
         '再平滑、羽化（σ=羽化/2）、对比度、移动边缘（灰阶膨胀／侵蚀）。output：selection＝选区；layerMask＝当前层加图层蒙版；newLayer＝按结果复制成新层；newLayerWithMask＝复制成新层＋图层蒙版（新层两种都把原层隐藏）；' +
         'newDocument／newDocumentWithMask＝开一份新文件（新分页，原文件不动、不进历史），里面一层＝抠好的（或带图层蒙版的）像素。' +
         '勾净化颜色时 selection／layerMask 不能用、照 PS 改成 newLayerWithMask。没有选区也能跑（全遮住起算） → {ok, output, selected | layer, document?}'},
  p => {
    let output = typeof p.output === 'string' ? p.output : 'selection';
    if (!SAM_OUTPUTS.includes(output)) return fail('select.refineEdge: output must be ' + SAM_OUTPUTS.join('|'));
    const dec = bool(p, 'decontaminate', false);
    if (dec && (output === 'selection' || output === 'layerMask')) output = 'newLayerWithMask';
    const L = Doc.active();
    if (output !== 'selection'){
      if (!L) return fail('no active layer');
      if (output !== 'layerMask' && L.kind !== 'raster') return fail(`the active layer is a ${L.kind} layer without pixels`);
    }
    const ready = PS.previewReady;
    const r = ready && window.SmartSeg && SmartSeg.sameDocument(ready.stamp) && ready.w === W() && ready.h === H() && ready.key === JSON.stringify(p) ? {P:refineParams(p),base:ready.prep.mask,region:ready.region} : refineCompute(p); PS.previewReady=null; if (r.error) return fail(r.error);
    const w = W(), h = H(), alpha = r.region || new Uint8Array(w * h);
    if (output === 'selection'){
      Doc.sel = r.region ? SelMask.fromBytes(r.region) : null;
      return {ok:true, output, selected:!!Doc.sel, selection:Doc.sel};
    }
    const addMask = (T_, bytes) => {   // 用结果当选区、走「显示选区」加蒙版（图层位移照那条命令处理），再取消选区（PS 输出到蒙版后没有选区）
      Doc.sel = r.region ? SelMask.fromBytes(bytes) : null;
      if (Doc.sel) CMD.map['ps.layer.layerMask.revealSelection'].run({id:T_.id}); else CMD.map['ps.layer.layerMask.hideAll'].run({id:T_.id});
      Doc.sel = null;
    };
    if (output === 'layerMask'){ addMask(L, alpha); return {ok:true, output, layer:L.id, selected:false}; }
    let px = L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), w, h).data;
    if (dec) px = decontaminate(px, alpha, w, h, Math.max(r.P.radius, 3), num(p, 'amount', 100));
    const withMask = output === 'newLayerWithMask' || output === 'newDocumentWithMask';
    const fillCopy = img => { for (let i = 0; i < w * h; i++){ for (let c = 0; c < 3; c++) img.data[i * 4 + c] = px[i * 4 + c]; img.data[i * 4 + 3] = withMask ? px[i * 4 + 3] : Math.round(px[i * 4 + 3] * alpha[i] / 255); } return img; };   // masked_copy
    if (output === 'newDocument' || output === 'newDocumentWithMask'){
      // PS：输出到新建文档＝开一份新文件，原文件（像素、选区、历史）都不动。多文件分页走 menus/impl/docs.js 的 ps.document.new（同步开好新分页、换成它）
      if (!window.Docs || !CMD.map['ps.document.new']) return fail('select.refineEdge: opening a new document needs the document tabs (menus/impl/docs.js)');
      if (CMD._depth === 1 && History.past.length) History.past.pop();     // 原文件不留一步空的 Ctrl+Z（在开新分页、收起原文件之前退掉）
      const name = L.name, before = Docs.activeId();
      const opened = CMD.run('ps.document.new', {width:w, height:h, background:null});
      if (Docs.activeId() === before) return fail('select.refineEdge: could not open a new document');
      const N = Doc.active() && Doc.active().kind === 'raster' ? Doc.active() : (() => { const x = Layer.raster(name); Doc.add(x); return x; })();
      N.name = name; N.x = 0; N.y = 0;
      N.data.ctx.putImageData(fillCopy(N.data.ctx.createImageData(w, h)), 0, 0);
      if (window.Layer && Layer.invalidate) Layer.invalidate(N);
      if (withMask) addMask(N, alpha);
      Doc.sel = null; Doc.activeId = N.id; History.clear();
      const docInfo = () => ({ok:true, output, layer:N.id, selected:false, document:Docs.cur, id:Docs.activeId()});
      return opened && typeof opened.then === 'function' ? opened.then(docInfo) : docInfo();
    }
    const N = Layer.raster(L.name + ' copy'), img = fillCopy(N.data.ctx.createImageData(w, h));
    N.data.ctx.putImageData(img, 0, 0);
    Doc.add(N, Doc.index(L.id) + 1);
    L.visible = false; Doc.sel = null;
    if (withMask) addMask(N, alpha);
    Doc.activeId = N.id;
    return {ok:true, output, layer:N.id, selected:false};
  });

/* ═══════════ 对话框 ═══════════ */
const CSS = `
.pssel-back{position:fixed;inset:0;z-index:400;background:#0003;display:flex;align-items:flex-start;justify-content:center}
.pssel-dlg{margin-top:80px;background:var(--bg2,#262626);border:1px solid var(--line,#3a3a3a);box-shadow:0 14px 36px #000c;color:var(--fg,#d6d6d6);font-size:12.5px;border-radius:4px;user-select:none}
.pssel-dlg .hd{padding:7px 12px;background:var(--bg3,#2f2f2f);border-bottom:1px solid var(--line,#3a3a3a);font-weight:600}
.pssel-dlg .bd{padding:12px 14px;display:flex;gap:16px;align-items:flex-start}
.pssel-dlg .col{display:flex;flex-direction:column;gap:8px;min-width:220px}
.pssel-dlg .btns{display:flex;flex-direction:column;gap:6px;min-width:84px}
.pssel-dlg button{background:var(--bg3,#2f2f2f);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:4px 12px;cursor:pointer;font-size:12.5px}
.pssel-dlg button:hover{border-color:#5a5f66}
.pssel-dlg button.pri{background:var(--accent,#2f7fd8);color:#fff;border-color:var(--accent,#2f7fd8)}
.pssel-dlg .row{display:flex;align-items:center;gap:6px}
.pssel-dlg .row>.l{min-width:96px;color:var(--fg2,#9a9a9a)}
.pssel-dlg .unit{color:var(--fg2,#9a9a9a)}
.pssel-dlg input[type=number],.pssel-dlg input[type=text],.pssel-dlg select{background:var(--bg3,#2f2f2f);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:2px 5px;font-size:12.5px}
.pssel-dlg input[type=number]{width:72px}
.pssel-dlg input[type=text]{width:160px}
.pssel-dlg input[type=range]{width:150px}
.pssel-dlg .err{color:#e8735f;min-height:15px;font-size:12px;padding:0 14px 8px;max-width:420px}
.pssel-dlg fieldset{border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:6px 10px 8px;margin:0;display:flex;flex-direction:column;gap:6px}
.pssel-dlg legend{color:var(--fg2,#9a9a9a);padding:0 4px}
.pssel-dlg .dis{opacity:.42;pointer-events:none}
.pssel-dlg .note{color:var(--fg2,#9a9a9a);font-size:11.5px}
.pssel-dlg .eyes{display:flex;gap:4px}
.pssel-dlg .eyes button{padding:3px 7px}
.pssel-dlg .eyes button.on{background:var(--accent,#2f7fd8);color:#fff;border-color:var(--accent,#2f7fd8)}
.pssel-cr-prev{width:200px;height:200px;background:#141414;border:1px solid var(--line,#3a3a3a);cursor:crosshair;display:block}
`;
function injectCSS(){ if (document.getElementById('pssel-css')) return; const s = document.createElement('style'); s.id = 'pssel-css'; s.textContent = CSS; document.head.appendChild(s); }
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

let DLG = null;                                   // 目前开着的对话框 {root, close, …}
PS.dialog = () => DLG ? DLG.root : null;
function closeDialog(){ if (DLG){ const d = DLG; DLG = null; d.back.remove(); if (d.onClose) d.onClose(); } }
/* 开一个对话框：o = {cmd, title, build(col, api), ok() → 结果（ok:false ⇒ 留着、显示错误）, cancel()} */
function openDialog(o){
  injectCSS(); closeDialog();
  if (window.Menubar && Menubar.close) Menubar.close();
  const back = el('div', 'pssel-back'), root = el('div', 'pssel-dlg');
  root.dataset.cmd = o.cmd; root.tabIndex = -1;
  const hd = el('div', 'hd', o.title); root.appendChild(hd);
  hd.style.cursor = 'move';                                                  // 标题列拖得动（PS 对话框可以移开、看底下的图）
  hd.addEventListener('mousedown', e => {
    if (e.button !== 0) return; e.preventDefault();
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(root.style.transform || ''), bx = m ? +m[1] : 0, by = m ? +m[2] : 0, sx = e.clientX, sy = e.clientY;
    const mv = ev => { root.style.transform = `translate(${bx + ev.clientX - sx}px, ${by + ev.clientY - sy}px)`; };
    const up = () => { window.removeEventListener('mousemove', mv, true); window.removeEventListener('mouseup', up, true); };
    window.addEventListener('mousemove', mv, true); window.addEventListener('mouseup', up, true);
  });
  const bd = el('div', 'bd'), col = el('div', 'col'), btns = el('div', 'btns'), err = el('div', 'err');
  const okB = el('button', 'pri', T('ok')), caB = el('button', '', T('cancel'));
  okB.type = caB.type = 'button'; okB.dataset.act = 'ok'; caB.dataset.act = 'cancel';
  btns.append(okB, caB); bd.append(col, btns); root.append(bd, err); back.appendChild(root);
  document.body.appendChild(back);
  const api = {root, back, col, err, onClose:o.onClose || null,
    setError(m){ err.textContent = m || ''; },
    doOK(){
      let r;
      try { r = o.ok(); } catch(e){ r = {ok:false, error:String(e && e.message || e)}; }
      if (r && r.ok === false){ api.setError(r.error || 'failed'); return r; }
      closeDialog(); redraw(); return r;
    },
    doCancel(){ if (o.cancel) o.cancel(); closeDialog(); redraw(); }
  };
  okB.onclick = () => api.doOK(); caB.onclick = () => api.doCancel();
  root.addEventListener('keydown', e => {
    e.stopPropagation();                                                     // 对话框里的键不给画布／工具
    if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')){ e.preventDefault(); api.doOK(); }
    else if (e.key === 'Escape'){ e.preventDefault(); api.doCancel(); }
  });
  DLG = api;
  o.build(col, api);
  const first = root.querySelector('input:not([disabled]),select:not([disabled])');
  (first || root).focus(); if (first && first.select) try { first.select(); } catch(_){}
  return api;
}
/* 一列：标签＋数字格＋单位 */
function numRow(parent, label, key, value, o){
  const r = el('div', 'row'), l = el('label', 'l', label), n = document.createElement('input');
  n.type = 'number'; n.value = value; n.dataset.k = key;
  if (o && o.min !== undefined) n.min = o.min; if (o && o.max !== undefined) n.max = o.max; n.step = (o && o.step) || 'any';
  r.append(l, n); if (o && o.unit) r.appendChild(el('span', 'unit', o.unit));
  parent.appendChild(r); return n;
}
function selectRow(parent, label, key, options, value){
  const r = el('div', 'row'), l = el('label', 'l', label), s = document.createElement('select');
  s.dataset.k = key;
  for (const [v, t] of options){ const op = document.createElement('option'); op.value = v; op.textContent = t; if (v === value) op.selected = true; s.appendChild(op); }
  r.append(l, s); parent.appendChild(r); return s;
}
function checkRow(parent, label, key, checked){
  const r = el('label', 'row'), c = document.createElement('input');
  c.type = 'checkbox'; c.checked = !!checked; c.dataset.k = key;
  r.append(c, el('span', '', label)); parent.appendChild(r); return c;
}
function radioGroup(parent, legend, key, options, value){
  const fs = el('fieldset'); fs.appendChild(el('legend', '', legend)); fs.dataset.k = key;
  const name = 'pssel-' + key + '-' + Math.random().toString(36).slice(2, 7);
  const inputs = options.map(([v, t]) => {
    const r = el('label', 'row'), c = document.createElement('input');
    c.type = 'radio'; c.name = name; c.value = v; c.checked = v === value; c.dataset.k = key + ':' + v;
    r.append(c, el('span', '', t)); fs.appendChild(r); return c;
  });
  parent.appendChild(fs);
  return {fs, inputs, value(){ const c = inputs.find(i => i.checked); return c ? c.value : value; }};
}

/* ── 修改 ▸ 五个（filter_dialog.rs：一格 radius，范围／预设照命令说明；PS 会记住上次的值） ── */
const MOD_LAST = {border:1, smooth:1, expand:1, contract:1, feather:1};
const MOD_BOUNDS = {smooth:false, expand:false, contract:false, feather:false};     // 「应用画布边界的效果」也记住
function modifyDialog(op){
  if (!hasSel()) return fail('no selection');
  const cmd = `ps.select.modify.${op}`;
  openDialog({cmd, title:T('mod.' + op), build(col){
    numRow(col, T('mod.' + op + '.r'), 'radius', MOD_LAST[op], {min:MOD[op].min, max:MOD[op].max, step:op === 'feather' ? 0.1 : 1, unit:T('px')});
    if (op in MOD_BOUNDS) checkRow(col, T('mod.atBounds'), 'applyAtCanvasBounds', MOD_BOUNDS[op]);
  }, ok(){
    const v = parseFloat(DLG.root.querySelector('[data-k="radius"]').value);
    if (!isFinite(v)) return fail(T('badNumber'));
    const p = {radius:v}, cb = DLG.root.querySelector('[data-k="applyAtCanvasBounds"]');
    if (cb) p.applyAtCanvasBounds = cb.checked;
    const r = CMD.run(cmd, p);
    if (r && r.ok !== false){ MOD_LAST[op] = v; if (cb) MOD_BOUNDS[op] = cb.checked; }
    return r;
  }});
  return {ok:true, dialog:cmd};
}
for (const op of Object.keys(MOD)){
  CMD.reg(`ps.select.modify.${op}.dialog`, {i18n:'', undoable:false,
    params:`{} 打开「${({border:'边界', smooth:'平滑', expand:'扩展', contract:'收缩', feather:'羽化'})[op]}选区」对话框（一格半径${op in MOD_BOUNDS ? '＋「应用画布边界的效果」勾选格' : ''}，记住上次的值）；确定＝跑 ps.select.modify.${op}。没有选区＝不开`},
    () => modifyDialog(op));
}

/* ── 查找图层 ── */
CMD.reg('ps.select.findLayers.dialog', {i18n:'', undoable:false, params:'{} 打开「查找图层」对话框（名称）；确定＝跑 ps.select.findLayers'},
  () => {
    openDialog({cmd:'ps.select.findLayers', title:T('find'), build(col){
      const r = el('div', 'row'), t = document.createElement('input'); t.type = 'text'; t.dataset.k = 'name';
      r.append(el('label', 'l', T('name')), t); col.appendChild(r);
    }, ok(){ return CMD.run('ps.select.findLayers', {name:DLG.root.querySelector('[data-k="name"]').value}); }});
    return {ok:true, dialog:'ps.select.findLayers'};
  });

/* ── 色彩范围（color_range_ui.rs） ── */
const CR_SELECTS = ['sampledColors', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'highlights', 'midtones', 'shadows'];   // 溢色（outOfGamut）要校样设定，我们没有
const crControls = f => {
  const sampled = f.select === 'sampledColors', tonal = ['highlights', 'midtones', 'shadows'].includes(f.select);
  return {fuzziness:sampled || tonal, sampling:sampled, range:sampled && !!f.localized, tonal};
};
/* params()：只送这个模式用得到的 */
function crParams(f){
  const c = crControls(f), p = {select:f.select, invert:!!f.invert};
  if (c.sampling){
    p.fuzziness = f.fuzziness;
    if (f.points.length) p.points = f.points.map(q => q.slice());
    if (f.subtractPoints.length) p.subtractPoints = f.subtractPoints.map(q => q.slice());
    if (c.range && (f.points.length || f.subtractPoints.length)){ p.localized = true; p.range = f.range; }   // 本地化要有取样点才算
  } else if (c.tonal){
    p.fuzziness = f.toneFuzziness;
    p.tonalRange = f.select === 'shadows' ? f.shadowsLevel : f.select === 'highlights' ? f.highlightsLevel
                 : [Math.min(f.midtonesLow, f.midtonesHigh), Math.max(f.midtonesLow, f.midtonesHigh)];
  }
  return p;
}
/* 吸管点一下：普通吸管＝取代样本；＋（或 Shift）加一个；−（或 Alt）减一个 */
function crPick(f, at, mods){
  const x = Math.min(W() - 1, Math.max(0, at[0])), y = Math.min(H() - 1, Math.max(0, at[1]));
  const tool = mods.shift ? 'add' : mods.alt ? 'subtract' : f.tool;
  if (tool === 'add') f.points.push([x, y]);
  else if (tool === 'subtract') f.subtractPoints.push([x, y]);
  else { f.points = [[x, y]]; f.subtractPoints = []; }
}
const PREVIEW = 200;
/* PS 会记住上次的设定（再开时沿用上次的值）：选择、容差、本地化、范围、色调范围、反相、预览、选区预览；取样点不记 */
const CR_LAST = {select:'sampledColors', fuzziness:40, localized:false, range:100, toneFuzziness:20, shadowsLevel:65, highlightsLevel:190,
                 midtonesLow:105, midtonesHigh:150, invert:false, view:'selection', docPreview:'none'};
const CR_DOCPREV = ['none', 'grayscale', 'blackMatte', 'whiteMatte', 'quickMask'];
let CR_LIVE = null;                               // 对话框开着时文件视窗上的「选区预览」：{mode, canvas}
PS._crLive = () => CR_LIVE;
/* 文件视窗的「选区预览」叠层（PS：灰度＝遮罩本身、黑／白色杂边＝没选的地方盖黑／白、快速蒙版＝没选的地方盖 50% 红） */
function crOverlay(mask, mode, w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++){
    const m = clamp01(mask[i]), o = i * 4;
    if (mode === 'grayscale'){ const v = Math.round(m * 255); d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
    else if (mode === 'blackMatte'){ d[o + 3] = Math.round((1 - m) * 255); }
    else if (mode === 'whiteMatte'){ d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round((1 - m) * 255); }
    else { d[o] = 255; d[o + 3] = Math.round((1 - m) * 0.5 * 255); }
  }
  x.putImageData(img, 0, 0);
  return c;
}
/* 画面上的一点（clientX/Y）→ 文件像素；不在看得到的画布上回 null（同 ui.js bindCanvas 的 toDoc） */
function docAtClient(cx, cy){
  if (!window.UI || !UI.canvas) return null;
  const b = UI.canvas.getBoundingClientRect(), wr = UI.wrap ? UI.wrap.getBoundingClientRect() : b;
  if (cx < Math.max(b.left, wr.left) || cy < Math.max(b.top, wr.top) || cx >= Math.min(b.right, wr.right) || cy >= Math.min(b.bottom, wr.bottom)) return null;
  const x = Math.floor((cx - b.left) / UI.zoom), y = Math.floor((cy - b.top) / UI.zoom);
  return (x >= 0 && y >= 0 && x < W() && y < H()) ? [x, y] : null;
}
function colorRangeDialog(){
  const f = Object.assign(JSON.parse(JSON.stringify(CR_LAST)), {points:[], subtractPoints:[], tool:'sample'});
  // 已经有选区（影片：先用矩形选框框住字）⇒ 照 PS 只看选区里面：预览只显示选区外框那一块、结果×原选区
  const w = W(), h = H(), selB = hasSel() ? SelMask.bytes() : null, sb = selB ? bytesBounds(selB, w, h) : null;
  const R0 = sb || [0, 0, w, h], rw = R0[2] - R0[0], rh = R0[3] - R0[1];
  // 代理图（proxy_document）：那一块的长边缩到 ≤200，预览在它上面跑同一支 colorRangeCore
  const k = Math.max(1, Math.ceil(Math.max(rw, rh) / PREVIEW)), pw = Math.ceil(rw / k), ph = Math.ceil(rh / k);
  const full = composite(1);
  const proxy = document.createElement('canvas'); proxy.width = pw; proxy.height = ph;
  { const x = proxy.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(full, R0[0], R0[1], rw, rh, 0, 0, rw / k, rh / k); }
  const ppx = proxy.getContext('2d').getImageData(0, 0, pw, ph).data;
  let pcov = null;                                                           // 代理图每格的原选区覆盖度
  if (selB){ pcov = new Float32Array(pw * ph); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++){ const X = Math.min(R0[2] - 1, R0[0] + x * k + (k >> 1)), Y = Math.min(R0[3] - 1, R0[1] + y * k + (k >> 1)); pcov[y * pw + x] = selB[Y * w + X] / 255; } }
  const fpx = full.getContext('2d').getImageData(0, 0, w, h).data;         // 文件视窗预览用的整张（同 sampleAllLayers 缺省）
  const fg = fgColor();
  let cv = null, status = null, colRef = null, docTimer = 0;
  const setErr = m => { if (DLG) DLG.setError(m); };                         // build 跑在 openDialog 回传之前 ⇒ 用 DLG
  const remember = () => { for (const key of Object.keys(CR_LAST)) CR_LAST[key] = f[key]; };
  const api = openDialog({cmd:'ps.select.colorRange', title:T('cr.title'), build(col){ colRef = col; render(col); },
    ok(){ const r = CMD.run('ps.select.colorRange', crParams(f)); if (r && r.ok !== false) remember(); return r; },
    onClose(){ clearTimeout(docTimer); CR_LIVE = null; }});
  PS._cr = f;                                                                // 测试用：对话框目前的栏位
  PS._crRegion = R0.slice();
  // PS 的色彩范围对话框不挡图：靠右放、不压暗；在文件视窗上点＝用目前的吸管取样（Shift 加、Alt 减）
  api.back.style.background = 'transparent'; api.back.style.justifyContent = 'flex-end'; api.root.style.marginRight = '24px';
  api.back.addEventListener('mousedown', e => {
    if (e.target !== api.back || e.button !== 0 || !crControls(f).sampling) return;
    const at = docAtClient(e.clientX, e.clientY); if (!at) return;
    e.preventDefault(); crPick(f, at, {shift:e.shiftKey, alt:e.altKey}); render(colRef);
  });
  api.back.addEventListener('mousemove', e => { api.back.style.cursor = (e.target === api.back && crControls(f).sampling && docAtClient(e.clientX, e.clientY)) ? 'crosshair' : ''; });
  function render(col){
    col.innerHTML = '';
    const c = crControls(f);
    const sel = selectRow(col, T('cr.select'), 'select', CR_SELECTS.map(v => [v, T('cr.' + v)]), f.select);
    sel.onchange = () => { f.select = sel.value; render(col); };
    const loc = checkRow(col, T('cr.localized'), 'localized', f.localized);
    if (!c.sampling) loc.parentNode.classList.add('dis');
    loc.onchange = () => { f.localized = loc.checked; render(col); };
    const slider = (label, key, min, max, unit, dis) => {
      const r = el('div', 'row' + (dis ? ' dis' : '')), rg = document.createElement('input'), n = document.createElement('input');
      rg.type = 'range'; rg.min = min; rg.max = max; rg.step = 1; rg.value = f[key]; n.type = 'number'; n.min = min; n.max = max; n.value = f[key];
      n.dataset.k = key; rg.dataset.k = key + 'Slider';
      const set = v => { v = Math.min(max, Math.max(min, Math.round(+v))); if (!isFinite(v)) return; f[key] = v; rg.value = v; n.value = v; update(); };
      rg.oninput = () => set(rg.value); n.onchange = () => set(n.value);
      r.append(el('label', 'l', label), rg, n); if (unit) r.appendChild(el('span', 'unit', unit));
      col.appendChild(r);
    };
    if (c.tonal) slider(T('cr.fuzziness'), 'toneFuzziness', 0, 100, '%', false);
    else slider(T('cr.fuzziness'), 'fuzziness', 0, 200, '', !c.fuzziness);
    if (c.sampling) slider(T('cr.range'), 'range', 0, 100, '%', !c.range);    // PS：范围一直在，没勾本地化颜色簇时灰掉
    if (c.tonal){
      if (f.select === 'shadows') slider(T('cr.shadowsTo'), 'shadowsLevel', 0, 255, '', false);
      else if (f.select === 'highlights') slider(T('cr.highlightsFrom'), 'highlightsLevel', 0, 255, '', false);
      else { slider(T('cr.midFrom'), 'midtonesLow', 0, 255, '', false); slider(T('cr.midTo'), 'midtonesHigh', 0, 255, '', false); }
    }
    // 预览＋右边一栏（吸管、样本数、清除、反相）
    const box = el('div', 'row'); box.style.alignItems = 'flex-start'; box.style.gap = '12px';
    cv = document.createElement('canvas'); cv.className = 'pssel-cr-prev'; cv.width = PREVIEW; cv.height = PREVIEW;
    cv.title = T('cr.preview');
    cv.onmousedown = e => {
      if (!c.sampling) return;
      const r = cv.getBoundingClientRect(), sc = Math.min(PREVIEW / pw, PREVIEW / ph);
      const ox = (PREVIEW - pw * sc) / 2, oy = (PREVIEW - ph * sc) / 2;
      const lx = (e.clientX - r.left) * PREVIEW / r.width - ox, ly = (e.clientY - r.top) * PREVIEW / r.height - oy;
      if (lx < 0 || ly < 0 || lx >= pw * sc || ly >= ph * sc) return;
      crPick(f, [R0[0] + Math.min(rw - 1, Math.floor(lx / sc) * k + (k >> 1)), R0[1] + Math.min(rh - 1, Math.floor(ly / sc) * k + (k >> 1))], {shift:e.shiftKey, alt:e.altKey});
      e.preventDefault(); render(col);
    };
    const side = el('div', 'col'); side.style.minWidth = '150px'; side.style.gap = '6px';
    const eyes = el('div', 'eyes' + (c.sampling ? '' : ' dis'));
    [['sample', '✎', 'cr.eye'], ['add', '✎+', 'cr.eyeAdd'], ['subtract', '✎−', 'cr.eyeSub']].forEach(([id, t, key]) => {
      const bt = el('button', f.tool === id ? 'on' : '', t); bt.type = 'button'; bt.title = T(key); bt.dataset.tool = id;
      bt.onclick = () => { f.tool = id; render(col); }; eyes.appendChild(bt);
    });
    side.appendChild(eyes);
    status = el('div', 'note'); status.dataset.k = 'samples';
    const a = f.points.length, s = f.subtractPoints.length;
    status.textContent = !a && !s ? T('cr.sampleFg') : s ? T('cr.samplesSub').replace('{n}', a).replace('{m}', s) : T('cr.samples').replace('{n}', a);
    if (!c.sampling) status.classList.add('dis');
    side.appendChild(status);
    if (c.sampling && a + s > 0){
      const cl = el('button', '', T('cr.clear')); cl.type = 'button'; cl.dataset.act = 'clearSamples';
      cl.onclick = () => { f.points = []; f.subtractPoints = []; render(col); }; side.appendChild(cl);
    }
    const inv = checkRow(side, T('cr.invert'), 'invert', f.invert);
    inv.onchange = () => { f.invert = inv.checked; update(); };
    box.append(cv, side); col.appendChild(box);
    const views = radioGroup(col, T('cr.view'), 'view', [['selection', T('cr.viewSel')], ['image', T('cr.viewImg')]], f.view);
    views.inputs.forEach(i => i.onchange = () => { f.view = views.value(); update(); });
    const dp = selectRow(col, T('cr.docPreview'), 'docPreview', CR_DOCPREV.map(v => [v, T('cr.dp.' + v)]), f.docPreview);
    dp.onchange = () => { f.docPreview = dp.value; update(); };
    update();
  }
  /* 文件视窗的选区预览：整张图跑同一支 colorRangeCore（×原选区），合并成一次重画 */
  function updateDoc(){
    clearTimeout(docTimer);
    if (f.docPreview === 'none'){ if (CR_LIVE){ CR_LIVE = null; redraw(); } return; }
    docTimer = setTimeout(() => {
      if (!DLG || DLG !== api) return;
      const r = colorRangeCore(fpx, w, h, crParams(f), fg);
      if (r.error){ CR_LIVE = null; redraw(); return; }
      if (selB) for (let i = 0; i < r.mask.length; i++) r.mask[i] *= selB[i] / 255;
      CR_LIVE = {mode:f.docPreview, canvas:crOverlay(r.mask, f.docPreview, w, h)};
      redraw();
    }, 16);
  }
  /* 预览：选区＝灰阶遮罩、图像＝代理图本身（color_range_ui.rs:226-286） */
  function update(){
    updateDoc();
    if (!cv) return;
    const x = cv.getContext('2d'); x.clearRect(0, 0, PREVIEW, PREVIEW);
    const sc = Math.min(PREVIEW / pw, PREVIEW / ph), dw = pw * sc, dh = ph * sc, ox = (PREVIEW - dw) / 2, oy = (PREVIEW - dh) / 2;
    if (f.view === 'image'){ x.imageSmoothingEnabled = true; x.drawImage(proxy, ox, oy, dw, dh); setErr(''); return; }
    const p = crParams(f);
    for (const key of ['points', 'subtractPoints']) if (p[key]) p[key] = p[key].map(([a, b]) => [Math.min(pw - 1, Math.max(0, Math.floor((a - R0[0]) / k))), Math.min(ph - 1, Math.max(0, Math.floor((b - R0[1]) / k)))]);
    const r = colorRangeCore(ppx, pw, ph, p, fg);
    if (r.error){ setErr(T('cr.previewErr') + r.error); return; }
    setErr('');
    if (pcov) for (let i = 0; i < pw * ph; i++) r.mask[i] *= pcov[i];
    const t = document.createElement('canvas'); t.width = pw; t.height = ph;
    const tx = t.getContext('2d'), img = tx.createImageData(pw, ph);
    for (let i = 0; i < pw * ph; i++){ const v = Math.floor(clamp01(r.mask[i]) * 255 + 0.5); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    tx.putImageData(img, 0, 0);
    x.imageSmoothingEnabled = true; x.drawImage(t, ox, oy, dw, dh);
  }
  return {ok:true, dialog:'ps.select.colorRange'};
}
CMD.reg('ps.select.colorRange.dialog', {i18n:'', undoable:false,
  params:'{} 打开「色彩范围」对话框（PS 版面：选择下拉、本地化颜色簇、颜色容差、范围／色调范围、三支吸管在预览上或直接在文件视窗上点（Shift 加 Alt 减）、选区／图像预览、' +
         '文件视窗的选区预览（无／灰度／黑色杂边／白色杂边／快速蒙版）、反相；已有选区时只看选区里面（预览只显示那一块）；设定记住上次的）；确定＝跑 ps.select.colorRange（一步历史），取消不动文件'},
  () => colorRangeDialog());

/* ── 变换选区：PS 是在画布上拖框；我们给一张数字对话框（选项栏那几格：位移、宽高 %、角度、斜切、参考点、插值），边改边在画布上预览 ── */
CMD.reg('ps.select.transformSelection.dialog', {i18n:'', undoable:false,
  params:'{} 打开「变换选区」对话框（水平／垂直位移、宽／高 %、角度、水平／垂直斜切、参考点、插值），改的同时画布上预览；确定＝跑 ps.select.transformSelection，取消＝选区回原样。没有选区＝不开'},
  () => {
    if (!hasSel()) return fail('no selection');
    const orig = Doc.sel;
    const fields = [['dx', 'tf.dx', 0, T('px')], ['dy', 'tf.dy', 0, T('px')], ['scaleX', 'tf.sx', 100, '%'], ['scaleY', 'tf.sy', 100, '%'],
                    ['rotate', 'tf.rot', 0, '°'], ['skewX', 'tf.kx', 0, '°'], ['skewY', 'tf.ky', 0, '°']];
    const read = () => {
      const R = DLG.root, p = {};
      for (const [k, , d] of fields){ const v = parseFloat(R.querySelector(`[data-k="${k}"]`).value); p[k] = isFinite(v) ? v : d; }
      p.reference = R.querySelector('[data-k="reference"]').value;
      p.interpolation = R.querySelector('[data-k="interpolation"]').value;
      return p;
    };
    const preview = () => {
      Doc.sel = orig;
      const r = transformCompute(read());
      if (r.error){ DLG.setError(r.error); redraw(); return; }
      DLG.setError('');
      if (r.changed){ const b = combine(null, r.mask, 'replace'); Doc.sel = b ? SelMask.fromBytes(b) : null; }
      redraw();
    };
    openDialog({cmd:'ps.select.transformSelection', title:T('tf.title'), build(col){
      for (const [k, key, d, unit] of fields){ const n = numRow(col, T(key), k, d, {unit, step:k.startsWith('scale') ? 1 : 0.1}); n.oninput = preview; }
      const rf = selectRow(col, T('tf.ref'), 'reference', REFS.map(v => [v, T('ref.' + v)]), 'center'); rf.onchange = preview;
      const ip = selectRow(col, T('tf.interp'), 'interpolation', [['bilinear', T('ip.bilinear')], ['bicubic', T('ip.bicubic')], ['nearest', T('ip.nearest')]], 'bilinear'); ip.onchange = preview;
      col.appendChild(el('div', 'note', T('tf.note')));
    }, ok(){
      const p = read(); Doc.sel = orig;                                      // 先把预览收回来，历史快照才是原选区
      return CMD.run('ps.select.transformSelection', p);
    }, cancel(){ Doc.sel = orig; }});
    return {ok:true, dialog:'ps.select.transformSelection'};
  });

/* ── 焦点区域…（原码走命令说明生成的对话框：range 0..1=0.5、noise 0..1=0；我们加画布预览） ── */
CMD.reg('ps.select.focusArea.dialog', {i18n:'', undoable:false,
  params:'{} 打开「焦点区域」对话框（对焦范围、图像杂色级别 0..1、预览）；勾预览时画布上直接显示结果；确定＝跑 ps.select.focusArea，取消＝选区回原样'},
  () => {
    const orig = Doc.sel; let timer = 0;
    const read = () => { const R = DLG.root, g = k => parseFloat(R.querySelector(`[data-k="${k}"]`).value); return {range:clamp01(g('range') || 0), noise:clamp01(g('noise') || 0)}; };
    const preview = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!DLG || DLG.root.dataset.cmd !== 'ps.select.focusArea') return;
        Doc.sel = orig;
        if (DLG.root.querySelector('[data-k="preview"]').checked){
          const p = read(), reg = focusArea(samplePixels(true), W(), H(), p.range, p.noise);
          Doc.sel = reg ? SelMask.fromBytes(reg) : null;
          DLG.setError(reg ? '' : T('fa.none'));
        }
        redraw();
      }, 120);
    };
    openDialog({cmd:'ps.select.focusArea', title:T('fa.title'), build(col){
      const sl = (key, label, val) => {
        const r = el('div', 'row'), rg = document.createElement('input'), n = document.createElement('input');
        rg.type = 'range'; rg.min = 0; rg.max = 1; rg.step = 0.01; rg.value = val; n.type = 'number'; n.min = 0; n.max = 1; n.step = 0.01; n.value = val; n.dataset.k = key;
        rg.oninput = () => { n.value = rg.value; preview(); }; n.oninput = () => { rg.value = n.value; preview(); };
        r.append(el('label', 'l', label), rg, n); col.appendChild(r);
      };
      sl('range', T('fa.range'), 0.5); sl('noise', T('fa.noise'), 0);
      const pv = checkRow(col, T('preview'), 'preview', true); pv.onchange = preview;
      preview();
    }, ok(){ clearTimeout(timer); const p = read(); Doc.sel = orig; return CMD.run('ps.select.focusArea', p); },
       cancel(){ clearTimeout(timer); Doc.sel = orig; }});
    return {ok:true, dialog:'ps.select.focusArea'};
  });

/* ── 选择并遮住…（PS 2020 工作区；原码 menus.rs:328 只开 select.refineEdge 的参数对话框，这里照 PS 补成工作区）──
   右边属性面板（不挡画布）：视图模式（洋葱皮 O／闪烁虚线 M／叠加 V／黑底 A／白底 T／黑白 K／图层上 Y、显示边缘 J、显示原稿 P、实时调整、高品质预览）、
   不透明度、叠加的颜色与「表示：被蒙版区域／所选区域」、记住设置、调整模式（颜色识别／对象识别）、边缘检测、全局调整（＋清除选区、反相）、输出设置。
   上面一排＝工作区工具：调整边缘画笔 R、画笔 B（＋／−、大小、[ ]）、选择主体、调整细线。
   画布上直接刷（Alt＝反过来，调整边缘画笔 Alt＝擦回原边）；Ctrl+Z／Ctrl+Shift+Z 退／进一笔；Enter＝确定、Esc＝取消。
   确定＝把这次的笔画、按钮动作连同栏位一起交给 ps.select.selectAndMask 跑（一步历史；agent 照同样参数跑结果一样） */
const SAM_VIEWS = [['onionSkin', 'o'], ['marchingAnts', 'm'], ['overlay', 'v'], ['onBlack', 'a'], ['onWhite', 't'], ['blackWhite', 'k'], ['onLayers', 'y']];
const SAM_OPACITY = {onionSkin:50, overlay:50, onBlack:75, onWhite:75};
const SAM_STORE = 'dilin.ps.selectAndMask';
const SAM_NUMS = [['radius', 0, 250, 1, 'sam.radius', 'px'], ['smooth', 0, 100, 1, 'sam.smooth', ''], ['feather', 0, 1000, 0.1, 'sam.feather', 'px'],
                  ['contrast', 0, 100, 1, 'sam.contrast', '%'], ['shiftEdge', -100, 100, 1, 'sam.shift', '%'], ['amount', 0, 100, 1, 'sam.amount', '%']];
let SAM = null;
const SAM_CSS = `
.pssel-back.sam{background:none;pointer-events:none;justify-content:flex-end}
.pssel-back.sam .pssel-dlg{pointer-events:auto;margin:56px 10px 0 0;max-height:calc(100vh - 70px);overflow:auto;width:300px}
.pssel-back.sam .pssel-dlg .bd{flex-direction:column;gap:8px}
.pssel-back.sam .pssel-dlg .btns{flex-direction:row;justify-content:flex-end}
.pssel-dlg .samtools{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding-bottom:6px;border-bottom:1px solid var(--line,#3a3a3a)}
.pssel-dlg .samtools button{padding:3px 7px}
.pssel-dlg button.on{background:#2f4f8a;border-color:#4a6fb0}
.pssel-dlg .samtools input[type=number]{width:52px}
.pssel-dlg .seg{display:flex;gap:0}.pssel-dlg .seg button{flex:1;border-radius:0}
.pssel-dlg .row input[type=range]{width:110px}
#optBody .samopt{background:var(--bg3,#2f2f2f);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:3px;padding:2px 9px;cursor:pointer;font-size:12.5px}
#optBody .samopt.on{background:#2f4f8a;border-color:#4a6fb0}
#optBody .samsp{flex:1}
#toolbar[data-layout=selectAndMask] .tbgrid{grid-template-columns:34px}
#toolbar[data-layout=selectAndMask] .tb[data-sam-tool=lasso]{position:relative}
#toolbar[data-layout=selectAndMask] .tb[data-sam-tool=lasso]::after{content:'';position:absolute;right:2px;bottom:2px;border:3px solid transparent;border-right-color:currentColor;border-bottom-color:currentColor;opacity:.6}
.samfly{position:fixed;z-index:10050;background:var(--bg2,#262626);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:4px;padding:3px 0;box-shadow:0 4px 14px rgba(0,0,0,.5);font-size:12.5px}
.samfly .it{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 8px;cursor:pointer;white-space:nowrap}
.samfly .it:hover{background:#2f4f8a}.samfly .it.on{font-weight:bold}.samfly .it .k{margin-left:auto;padding-left:16px;opacity:.7}
.samtip{position:fixed;z-index:10050;background:var(--bg2,#262626);color:var(--fg,#d6d6d6);border:1px solid var(--line,#3a3a3a);border-radius:4px;padding:8px 10px;box-shadow:0 4px 14px rgba(0,0,0,.5);font-size:12.5px;display:flex;flex-direction:column;gap:6px;width:230px}
.samtip .r{display:flex;align-items:center;gap:6px}.samtip .r>span:first-child{width:48px}.samtip input[type=range]{flex:1;min-width:0}.samtip input[type=number]{width:50px}
.samtip canvas{align-self:center;background:#fff;border-radius:3px}
#optBody .samopt.tip{display:inline-flex;align-items:center;gap:4px}
.pssel-back.samsave{z-index:10060;background:rgba(0,0,0,.35);justify-content:center}
.pssel-back.samsave .pssel-dlg{min-width:320px;margin-top:160px}
.pssel-back.samsave .pssel-dlg .bd{flex-direction:row}
.pssel-back.samsave .pssel-dlg .col{min-width:0}
`;
const SAM_PROXY_PX = 250000;                       // 没勾高品质预览：拖滑杆时预览缩到约 25 万像素算
/* 左边工作区工具（PS 2020 选择并遮住：快速选择 W、调整边缘画笔 R、画笔 B、对象选择 W、套索 L、抓手 H、缩放 Z） */
const SAM_TB = [['quickSelect', 'quick-select', 'W'], ['refine', null, 'R'], ['brush', 'brush', 'B'], ['objectSelect', 'object-select', 'W'], ['lasso', 'lasso', 'L'], ['hand', 'hand', 'H'], ['zoom', 'zoom', 'Z']];
const SAM_SIZED = ['quickSelect', 'refine', 'brush'], SAM_MODED = ['quickSelect', 'refine', 'brush', 'objectSelect', 'lasso'];
const SAM_DEFAULTS = {view:'onionSkin', opac:{}, overlayColor:'#ff0000', indicates:'masked', refineMode:'color', radius:0, smartRadius:false, smooth:0, feather:0, contrast:0, shiftEdge:0,
                      decontaminate:false, amount:100, output:'selection', sampleAllLayers:false, size:40};
/* 三颗笔刷类工具各记各的笔尖（PS：工具各自的画笔设置）：间距 %（＋勾选框）、角度°、圆度 %、大小：关／钢笔压力／钢笔斜度／光笔轮，三颗都有；
   硬度：画笔、快速选择有（调整边缘画笔 PS 本来就没有） */
const SAM_TIP_DEF = {spacing:25, spacingEnabled:true, angle:0, roundness:100, sizeControl:'off'};
const samTipsInit = (size, saved) => {
  const t = {quickSelect:Object.assign({size, hardness:1}, SAM_TIP_DEF), refine:Object.assign({size}, SAM_TIP_DEF), brush:Object.assign({size, hardness:1}, SAM_TIP_DEF)};
  if (saved && typeof saved === 'object') for (const k of SAM_SIZED) if (saved[k] && typeof saved[k] === 'object')
    for (const f of Object.keys(t[k])){
      const sv = saved[k][f];
      if (f === 'spacingEnabled'){ if (typeof sv === 'boolean') t[k][f] = sv; }
      else if (f === 'sizeControl'){ if (SAM_CTLS.includes(sv) && !(k === 'quickSelect' && sv === 'tilt')) t[k][f] = sv; }
      else { const v = +sv; if (sv !== undefined && sv !== null && isFinite(v)) t[k][f] = v; }
    }
  return t;
};
/* 大小控制那一刻的比例：钢笔压力＝pressure、钢笔斜度＝tiltX／tiltY、光笔轮＝tangentialPressure（算法跟主工具列的快速选择共用 SmartSeg.ctlFactor）；
   滑鼠或没那项资料＝null（照原大小，PS 同） */
const samPressure = (e, ctl) => {
  ctl = ctl || 'pen';
  if (window.SmartSeg && SmartSeg.ctlFactor) return SmartSeg.ctlFactor(e, ctl);
  return ctl === 'pen' && e && e.pointerType && e.pointerType !== 'mouse' && e.pressure > 0 ? Math.min(1, e.pressure) : null;
};
const samTip = t => SAM && SAM.tips[t || SAM.tool];
const SAM_PRESETS = 'dilin.ps.selectAndMask.presets';
const samPresets = () => { try { return JSON.parse(localStorage.getItem(SAM_PRESETS) || '{}') || {}; } catch(_){ return {}; } };
const samRemembered = () => { try { return JSON.parse(localStorage.getItem(SAM_STORE) || 'null'); } catch(_){ return null; } };
function samSettings(){
  if (!SAM) return {};
  const R = SAM.dlg.root, q = k => R.querySelector(`[data-k="${k}"]`), p = {};
  for (const [k] of SAM_NUMS){ const v = parseFloat(q(k).value); p[k] = isFinite(v) ? v : (k === 'amount' ? 100 : 0); }
  for (const k of ['smartRadius', 'decontaminate', 'sampleAllLayers']) p[k] = q(k).checked;
  p.output = q('output').value; p.refineMode = SAM.refineMode;
  return p;
}
function samParams(){
  const p = samSettings();
  p.ops = SAM.ops.slice(); p.strokes = JSON.parse(JSON.stringify(SAM.strokes));
  return p;
}
/* 重算预览：笔画／按钮动作没变就重用上次的 refinePrep（拖滑杆只重跑边缘检测＋全局调整）；proxy＝低解析度预览 */
function samRecompute(proxy){
  if (!SAM) return;
  if(window.SmartSeg && SmartSeg.canAsync() && !proxy){ samBackground(); return; }
  const p = samParams(), n = W() * H();
  samPrep(p);
  const k = proxy ? Math.ceil(Math.sqrt(n / SAM_PROXY_PX)) : 1;
  SAM.previewScale = k;
  if (k > 1) SAM.region = refineProxy(p, SAM.prep, k);
  else SAM.region = refineCompute(p, SAM.base, SAM.prep).region || new Uint8Array(n);
  SAM.regionKey = k > 1 ? null : SAM.prepKey + '|' + JSON.stringify(samSettings());   // 全解析度结果对得上哪组笔画＋栏位（拖下一笔时拿来当增量预览的起点）
  samRender();
}
/* 栏位拖动中（滑杆 input、数字格打字）：实时调整关掉＝先不算（放手 samCommit 才算）；开着＝高品质预览全解析度、没勾＝大图先用低解析度 */

function samCancelJob(){ if(SAM&&SAM.job){ SAM.job.cancel(); SAM.job=null; SAM.pending=false; } }
function samBackground(cur){
  if(!SAM) return null;
  if(SAM.documentStamp&&!SmartSeg.sameDocument(SAM.documentStamp)){samCancelJob();SAM.dlg.setError('請回到開啟選擇並遮住的原文件，或取消工作區。');return Promise.resolve(fail('workspace belongs to another document'));}
  const owner=SAM, p=samParams(); if(cur) p.strokes.push(JSON.parse(JSON.stringify(cur)));
  const key=JSON.stringify(p), stamp=SmartSeg.documentStamp();
  samCancelJob();
  const src=samplePixels(!!p.sampleAllLayers), job=owner.job=SmartSeg.asyncJob({kind:'sam',src,w:W(),h:H(),base:owner.base,p,cache:window.SmartSeg&&SmartSeg.regCache ? [...SmartSeg.regCache] : []});
  owner.pending=true;
  job.promise.then(r=>{
    if(SAM!==owner||owner.job!==job||!SmartSeg.sameDocument(stamp)||JSON.stringify(samParamsWithCur())!==key) return;
    owner.prep=r.prep; owner.prep.rgbF=()=> owner.prep.rgb || (owner.prep.rgb=rgbOf(src,W()*H()));
    owner.prepKey=JSON.stringify([p.ops,p.strokes,p.refineMode,p.sampleAllLayers]);
    owner.region=r.region; owner.regionKey=owner.prepKey+'|'+JSON.stringify(samSettings()); owner.previewScale=1;
    for(const [k,reg] of r.cache||[]) SmartSeg.cachePut(k,reg);
    owner.readyKey=key; owner.ready=r; owner.readyStamp=stamp;
    samRender();
    (owner.settleCosts=owner.settleCosts||[]).push(r.cost);
  },e=>{ if(!e.cancelled&&SAM===owner){ owner.asyncError=e.message; owner.dlg.setError('選取精修未能執行：'+e.message); } }).finally(()=>{if(owner.job===job){owner.job=null;owner.pending=false;}});
  return job.promise;
}
function samParamsWithCur(){const p=samParams();if(SAM.cur)p.strokes.push(JSON.parse(JSON.stringify(SAM.cur)));return p;}
function samLive(){
  if (!SAM) return; const R = SAM.dlg.root;
  if (!R.querySelector('[data-k="realtime"]').checked) return;
  clearTimeout(SAM.timer);
  const proxy = !R.querySelector('[data-k="hq"]').checked && W() * H() > SAM_PROXY_PX;
  SAM.timer = setTimeout(() => samRecompute(proxy), proxy ? 15 : 120);
}
function samCommit(){ if (!SAM) return; clearTimeout(SAM.timer); samRecompute(false); }
/* 笔画／按钮动作没变就留着上次的 refinePrep */
function samPrep(p){
  p = p || samParams();
  const key = JSON.stringify([p.ops, p.strokes, p.refineMode, p.sampleAllLayers]);
  if (!SAM.prep || SAM.prepKey !== key){ SAM.prep = refinePrep(p, SAM.base); SAM.prepKey = key; SAM.small = null; }
  return SAM.prep;
}
/* 边拖边预览（PS：快速选择边拖边长；画笔／调整边缘画笔拖动中就看到结果）。节流照主工具列的快速选择：上次算多久就至少隔多久、最少 60 ms。
   快速选择一直开；画笔类要「实时调整」开着。没勾高品质预览、图又大 ⇒ 拖动中用 1/k 的小图算（跟拖滑杆一样），放手才全解析度 */
function samLiveOn(tool){
  if (tool === 'quickSelect') return true;
  return (tool === 'brush' || tool === 'refine') && SAM.dlg.root.querySelector('[data-k="realtime"]').checked;
}
function samStrokeLive(){
  const lv = SAM && SAM.live; if (!lv || lv.timer) return;
  clearTimeout(lv.idle); lv.idle = 0;
  const wait = Math.max(0, Math.max(60, lv.cost) - (performance.now() - lv.last));
  lv.timer = setTimeout(() => { lv.timer = 0; samStrokeRun(); }, wait);
}
function samStrokeStop(){ if (SAM && SAM.live){ clearTimeout(SAM.live.timer); clearTimeout(SAM.live.idle);if(SAM.live.coarseJob)SAM.live.coarseJob.cancel(); SAM.live = null; } }
function samStrokeRun(){
  if (!SAM || !SAM.live || !SAM.cur) return;
  if(SAM.cur.tool==='quickSelect'&&window.SmartSeg&&SmartSeg.canAsync()){samQsLiveAsync();return;}
  const lv = SAM.live, st = SAM.cur; if (st.pts.length === lv.n) return;
  const t0 = performance.now(); lv.n = st.pts.length;
  const p = samSettings(), w = W(), h = H(), n = w * h;
  const k = !SAM.dlg.root.querySelector('[data-k="hq"]').checked && n > SAM_PROXY_PX ? Math.ceil(Math.sqrt(n / SAM_PROXY_PX)) : 1;
  const fresh = !lv.inc || lv.inc.k !== k || lv.inc.key !== JSON.stringify(p);
  if (fresh) lv.inc = st.tool === 'quickSelect' && window.SmartSeg && SmartSeg.canAsync() ? samCoarseInit(p,k) : samIncInit(p, samPrep(), k, st);           // 按下后第一次（或中途换了高品质预览／栏位）：整片算一次当起点
  const t1 = performance.now(), D = samIncStroke(lv.inc, st);     // 这次新进的点改到的地方（文件坐标外框）
  const t2 = performance.now(), rect = D ? samIncUpdate(lv.inc, D) : null;   // 只重算受影响的那块：抠图 ±4R、边缘检测／全局调整 ±halo
  SAM.region = lv.inc.full; SAM.regionKey = null;
  SAM.previewScale = k; lv.runs++;
  const t3 = performance.now(); samRender(fresh ? null : rect || 'none');
  lv.last = performance.now(); lv.cost = lv.last - t0; SAM.liveCosts.push(+lv.cost.toFixed(1));
  (SAM.liveParts = SAM.liveParts || []).push([t1 - t0, t2 - t1, t3 - t2, lv.last - t3].map(v => +v.toFixed(1)));   // 起点／笔画／局部重算／画
  if (SAM && SAM.cur && SAM.live === lv && SAM.cur.pts.length !== lv.n) samStrokeLive();   // 算的期间又进了点
  else if (SAM && SAM.cur && SAM.live === lv && st.tool === 'quickSelect'){ clearTimeout(lv.idle); lv.idle = setTimeout(samQsSettle, window.SmartSeg ? SmartSeg.LIVE_SETTLE : 250); }   // 停笔：整条精修
}
function samQsLiveAsync(){
  const owner=SAM,lv=SAM.live,st=SAM.cur;if(lv.failed||lv.coarseJob||st.pts.length===lv.n||!SmartSeg.sameDocument(owner.documentStamp))return;
  const p=samSettings(),n=W()*H(),k=!SAM.dlg.root.querySelector('[data-k="hq"]').checked&&n>SAM_PROXY_PX?Math.ceil(Math.sqrt(n/SAM_PROXY_PX)):1;
  const inc=lv.inc||(lv.inc=samCoarseInit(p,k));if(!inc.src)inc.src=samplePixels(inc.S.all);if(!inc.qs)inc.qs=SmartSeg.liveInit(inc.src,W(),H());
  const q=Object.assign(qsCmdParams(st),{sampleAllLayers:inc.S.all}),job=lv.coarseJob=SmartSeg.asyncJob({kind:'coarse',src:inc.src,w:W(),h:H(),q,acc:inc.qs.acc,done:inc.qs.done,box:inc.qs.box});
  job.promise.then(r=>{
    if(SAM!==owner||SAM.cur!==st||SAM.live!==lv||lv.coarseJob!==job||!SmartSeg.sameDocument(owner.documentStamp))return;
    const t0=performance.now();lv.n=r.n;inc.qs.acc=r.acc;inc.qs.done=r.n;inc.qs.box=r.box;
    const D=samQsApply(inc,st,r.U),rect=D?samIncUpdate(inc,D):null;
    SAM.region=inc.full;SAM.regionKey=null;SAM.previewScale=k;lv.runs++;samRender(rect||'none');
    lv.last=performance.now();lv.cost=lv.last-t0;SAM.liveCosts.push(+lv.cost.toFixed(1));(SAM.workerLiveCosts||(SAM.workerLiveCosts=[])).push(r.cost);
  },e=>{if(!e.cancelled&&SAM===owner){lv.failed=true;owner.asyncError=e.message;owner.dlg.setError(e.message);}}).finally(()=>{
    if(lv.coarseJob!==job)return;lv.coarseJob=null;if(SAM!==owner||SAM.cur!==st||SAM.live!==lv||lv.failed)return;
    if(st.pts.length!==lv.n)samStrokeLive();else lv.idle=setTimeout(samQsSettle,SmartSeg.LIVE_SETTLE);
  });
}
/* ── 拖动中的增量预览（原码无·照 PS 拖着跟手）：按下后第一次整片算好留着（全解析度：上一笔放开时那份结果直接接着用），
   之后每次只把新进的点盖上去（快速选择：上次长出来那块还原、换成这次长的），再只重算受影响的那块——
   调整边缘画笔的抠图（brushMatte）在 改动 ±4R 里重抠（读 ±8R），边缘检测＋全局调整（refineMask）在 那块 ±halo 里重算（读 ±2·halo）；
   没勾高品质预览的大图：这些都在 1/k 小图上做，小图只更新改到的格子、放大回原尺寸也只放那块。放开后照旧整片全解析度重算 */
const rcInfl = (r, d, w, h) => [Math.max(0, r[0] - d), Math.max(0, r[1] - d), Math.min(w, r[2] + d), Math.min(h, r[3] + d)];
const rcUnion = (a, b) => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
function cropArr(src, W0, r, ch, Ctor){
  const cw = r[2] - r[0], out = new Ctor(cw * (r[3] - r[1]) * ch);
  for (let y = r[1]; y < r[3]; y++) out.set(src.subarray(((y * W0) + r[0]) * ch, ((y * W0) + r[2]) * ch), (y - r[1]) * cw * ch);
  return out;
}
/* src＝外框 sr 那块的裁切；把其中 r 那块贴回整张 dst */
function pasteRect(dst, W0, r, src, sr){
  const sw = sr[2] - sr[0], n = r[2] - r[0];
  for (let y = r[1]; y < r[3]; y++){ const o = (y - sr[1]) * sw + (r[0] - sr[0]); dst.set(src.subarray(o, o + n), y * W0 + r[0]); }
}
const samRgbSmall = (pr, k) => (SAM.small && SAM.small.k === k) ? SAM.small.px : (SAM.small = {k, px:downsample(pr.rgbF(), W(), H(), k).px}).px;

function samCoarseInit(p,k){
  const w=W(),h=H(),pr=SAM.prep,mask=pr&&pr.mask ? pr.mask : SAM.base;
  const S={mask:Uint8Array.from(mask),w,h,all:!!p.sampleAllLayers};
  return {coarse:true,k,key:JSON.stringify(p),S,base:Uint8Array.from(mask),src:null,full:SAM.region ? Uint8Array.from(SAM.region) : Uint8Array.from(mask)};
}
function samIncInit(p, pr, k, st){
  const w = W(), h = H(), n = w * h, obj = p.refineMode === 'object';
  const S = {mask:Uint8Array.from(pr.mask), ref:pr.ref ? Uint8Array.from(pr.ref) : null, maxR:pr.maxR || 0, w, h, all:!!p.sampleAllLayers, rgbF:pr.rgbF};
  if (st.tool === 'refine'){ S.ref = S.ref || new Uint8Array(n); S.maxR = Math.max(S.maxR, Math.min(5000, Math.max(1, num(st, 'size', 20))) / 2); }
  const R = Math.ceil(S.maxR) + 2, sameR = R === Math.ceil(pr.maxR || 0) + 2;
  const inc = {k, key:JSON.stringify(p), obj, S, base:pr.mask, R, walk:{}, qsBox:null, src:null, hasRef:!!(pr.ref && pr.ref.some(v => v))};
  if (k === 1){
    inc.w = w; inc.h = h; inc.mask = S.mask; inc.ref = S.ref; inc.P = refineParams(p); inc.Rw = R;
    inc.rgb = inc.P.usesImage || S.ref ? pr.rgbF() : null;
    inc.ov = S.ref ? (pr.ov && sameR ? Float32Array.from(pr.ov) : brushMatte(S.mask, S.ref, inc.hasRef ? inc.rgb : null, w, h, R, obj)) : null;
    const reuse = sameR && SAM.region && SAM.regionKey === SAM.prepKey + '|' + inc.key;   // 上一笔放开时的全解析度结果就是起点
    inc.region = reuse ? Uint8Array.from(SAM.region) : (refineMask(S.mask, inc.P.usesImage ? inc.rgb : null, w, h, inc.P, inc.ov) || new Uint8Array(n));
    inc.full = inc.region;
  } else {
    const sw = Math.ceil(w / k), sh = Math.ceil(h / k);
    inc.w = sw; inc.h = sh; inc.mask = new Uint8Array(sw * sh); inc.ref = S.ref ? new Uint8Array(sw * sh) : null;
    samIncShrink(inc, [0, 0, w, h]);
    inc.P = refineParams(Object.assign({}, p, {radius:num(p, 'radius', 0) / k, smooth:num(p, 'smooth', 0) / k, feather:num(p, 'feather', 0) / k})); inc.Rw = Math.ceil(R / k) + 2;
    inc.rgb = inc.P.usesImage || S.ref ? samRgbSmall(pr, k) : null;
    inc.ov = inc.ref ? brushMatte(inc.mask, inc.ref, inc.hasRef ? inc.rgb : null, sw, sh, inc.Rw, obj) : null;
    inc.region = refineMask(inc.mask, inc.P.usesImage ? inc.rgb : null, sw, sh, inc.P, inc.ov) || new Uint8Array(sw * sh);
    inc.full = upsampleU8(inc.region, sw, sh, k, w, h);
  }
  return inc;
}
/* 小图（1/k）的格子照原尺寸重算（原选区＝方框平均；刷痕：有 1＝1、否则有 2＝2）：D＝原尺寸外框 → 回小图外框 */
function samIncShrink(inc, D){
  const k = inc.k, S = inc.S, w = S.w, h = S.h, sw = inc.w;
  const r = [Math.floor(D[0] / k), Math.floor(D[1] / k), Math.min(inc.w, Math.ceil(D[2] / k)), Math.min(inc.h, Math.ceil(D[3] / k))];
  for (let cy = r[1]; cy < r[3]; cy++) for (let cx = r[0]; cx < r[2]; cx++){
    let s = 0, c = 0, rv = 0;
    for (let y = cy * k; y < Math.min(h, (cy + 1) * k); y++) for (let x = cx * k; x < Math.min(w, (cx + 1) * k); x++){
      const i = y * w + x; s += S.mask[i]; c++;
      if (S.ref){ const v = S.ref[i]; if (v === 1) rv = 1; else if (v === 2 && rv !== 1) rv = 2; }
    }
    inc.mask[cy * sw + cx] = Math.round(s / c); if (inc.ref) inc.ref[cy * sw + cx] = rv;
  }
  return r;
}
/* 快速选择累积区域（inc.qs.acc）的 U 那块跟按下时的原选区合成进 S.mask（加＝取大、减＝扣掉）→ 真的有变的格子的外框或 null */
function samQsApply(inc, st, U){
  if (!U) return null;
  const S = inc.S, w = S.w, h = S.h, acc = inc.qs.acc;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = Math.max(0, U[1]); y < Math.min(h, U[3]); y++) for (let x = Math.max(0, U[0]); x < Math.min(w, U[2]); x++){
    const i = y * w + x, o = inc.base[i], v = acc ? acc[i] : 0, nv = st.subtract ? Math.max(0, o - v) : Math.max(o, v);
    if (nv !== S.mask[i]){ S.mask[i] = nv; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
/* 停笔精修（快速选择）：整条照放开时一样算（结果记进 regCache，放开时直接用）→ 增量预览照常只重算改到的那块 */
function samQsSettle(){
  if(SAM && SAM.cur && window.SmartSeg && SmartSeg.canAsync()){ samBackground(SAM.cur); return; }
  const lv = SAM && SAM.live, st = SAM && SAM.cur, SS = window.SmartSeg;
  if (!lv || !st || st.tool !== 'quickSelect' || !lv.inc || !lv.inc.qs || !SS || lv.timer) return;
  lv.idle = 0;
  if (st.pts.length !== lv.n || (lv.inc.qs.settled && lv.inc.qs.settled.n === lv.n)) return;
  const t0 = performance.now(), q = Object.assign(qsCmdParams(st), {sampleAllLayers:lv.inc.S.all}), k = SS.selectKey(q);
  const U = SS.liveSettle(lv.inc.qs, k.pts, k.size, k.tip);
  SS.cachePut(k.key, lv.inc.qs.settled.reg);
  const D = samQsApply(lv.inc, st, U), rect = D ? samIncUpdate(lv.inc, D) : null;
  SAM.region = lv.inc.full; SAM.regionKey = null; lv.runs++;
  samRender(rect || 'none');
  (SAM.settleCosts = SAM.settleCosts || []).push(+(performance.now() - t0).toFixed(1));
}
/* 这次新进的点套到原尺寸的原选区／刷痕图 → 改到的外框（原尺寸）或 null */
function samIncStroke(inc, st){
  const S = inc.S, w = S.w, h = S.h;
  if (st.tool === 'quickSelect'){                                  // 跟主工具列的快速选择同一套增量分割（SmartSeg.liveGrow：只算新进的那一小段），影像按下时读一次；笔尖照画笔设置
    const SS = window.SmartSeg; if (!SS) return null;
    if (!inc.src) inc.src = SS.samplePixels(S.all);
    if (!inc.qs) inc.qs = SS.liveInit(inc.src, w, h);
    const k = SS.selectKey(qsCmdParams(st));
    return samQsApply(inc, st, SS.liveGrow(inc.qs, k.pts, k.size, k.tip));
  }
  const size = Math.min(5000, Math.max(1, num(st, 'size', 20))), tip = strokeTip(st);
  if (st.tool === 'brush') return stampPts(S.mask, w, h, st.pts, size, st.subtract ? 0 : 255, num(st, 'hardness', 1), tip, inc.walk);
  const D = stampPts(S.ref, w, h, st.pts, size, st.subtract ? 2 : 1, 1, tip, inc.walk);
  if (D) inc.hasRef = true;
  return D;
}
/* 只重算受影响的那块 → 预览（原尺寸）改到的外框 */
function samIncUpdate(inc, D){
  if(inc.coarse){
    for(let y=D[1];y<D[3];y++) inc.full.set(inc.S.mask.subarray(y*inc.S.w+D[0],y*inc.S.w+D[2]),y*inc.S.w+D[0]);
    return D;
  }
  const k = inc.k, w = inc.w, h = inc.h, S = inc.S;
  const Dw = k > 1 ? samIncShrink(inc, D) : D;
  if (Dw[0] >= Dw[2] || Dw[1] >= Dw[3]) return null;
  let C = Dw;
  if (inc.ref && inc.hasRef){                                      // 抠图：box 平均最远看 4R（对象识别再加 σ=1 柔化）
    const R = inc.Rw, O = rcInfl(Dw, 4 * R + 1, w, h), X = rcInfl(O, 4 * R + 4, w, h), cw = X[2] - X[0], ch = X[3] - X[1];
    const ovc = brushMatte(cropArr(inc.mask, w, X, 1, Uint8Array), cropArr(inc.ref, w, X, 1, Uint8Array), inc.rgb ? cropArr(inc.rgb, w, X, 3, Float32Array) : null, cw, ch, R, inc.obj);
    pasteRect(inc.ov, w, O, ovc, X);
    C = O;
  }
  const P = inc.P, Q = rcInfl(C, P.halo, w, h), X2 = rcInfl(Q, P.halo, w, h), cw2 = X2[2] - X2[0], ch2 = X2[3] - X2[1];
  const rc = refineMask(cropArr(inc.mask, w, X2, 1, Uint8Array), P.usesImage ? cropArr(inc.rgb, w, X2, 3, Float32Array) : null, cw2, ch2, P, inc.ov ? cropArr(inc.ov, w, X2, 1, Float32Array) : null);
  if (rc) pasteRect(inc.region, w, Q, rc, X2); else for (let y = Q[1]; y < Q[3]; y++) inc.region.fill(0, y * w + Q[0], y * w + Q[2]);
  if (k === 1) return Q;
  const F = [Math.max(0, (Q[0] - 1) * k), Math.max(0, (Q[1] - 1) * k), Math.min(S.w, (Q[2] + 1) * k), Math.min(S.h, (Q[3] + 1) * k)];   // 双线性要邻格 ⇒ 多放一格
  upsampleInto(inc.region, w, h, k, S.w, inc.full, F);
  return F;
}
/* upsampleU8 的局部版：只放回原尺寸外框 F 那块 */
function upsampleInto(small, sw, sh, k, w, out, F){
  for (let y = F[1]; y < F[3]; y++){
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / k - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = F[0]; x < F[2]; x++){
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / k - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = small[y0 * sw + x0] * (1 - tx) + small[y0 * sw + x1] * tx, b = small[y1 * sw + x0] * (1 - tx) + small[y1 * sw + x1] * tx;
      out[y * w + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
}
let _samChk = null;
/* rect＝只有这块变了（拖动中的增量预览；[x0,y0,x1,y1]），'none'＝什么都没变；显示原稿／显示边缘时照旧整张 */
function samRender(rect){
  if (!SAM || rect === 'none' || (SAM.documentStamp && !SmartSeg.sameDocument(SAM.documentStamp))) return;
  const w = W(), h = H(), n = w * h, R = SAM.dlg.root, q = k => R.querySelector(`[data-k="${k}"]`);
  const view = q('view').value, op = Math.min(100, Math.max(0, parseFloat(q('opacity').value) || 0)) / 100;
  const showOrig = q('showOriginal').checked, showEdge = q('showEdge').checked;
  if (showOrig || showEdge || !Array.isArray(rect)) rect = null;
  let A = showOrig ? SAM.base : SAM.region; A = A || SAM.base;
  if (showEdge){ const E = new Uint8Array(n); for (let i = 0; i < n; i++){ const v = SAM.region[i]; E[i] = (v > 2 && v < 253) || v !== SAM.base[i] ? v : 0; } A = E; }
  Doc.sel = SelMask.fromBytes(A);                                  // 选区＝目前结果（全空＝null）（闪烁虚线就是它；关掉工作区还原）
  for (const [k, fs] of [['opacity', ['onionSkin', 'overlay', 'onBlack', 'onWhite']], ['overlayColor', ['overlay']], ['indicates', ['overlay']]])
    q(k).closest('.row').style.display = fs.includes(view) ? '' : 'none';
  if (view === 'marchingAnts'){ SAM.prev = null; redraw(); return; }
  const scale=Math.max(1,Math.ceil(1/Math.max(0.01,UI.zoom*Math.min(window.devicePixelRatio||1,2)))), rw=Math.ceil(w/scale),rh=Math.ceil(h/scale);
  const c = SAM.prev || (SAM.prev = document.createElement('canvas'));
  if (c.width !== rw || c.height !== rh){ c.width = rw; c.height = rh; rect = null; } SAM.renderScale=scale;
  const sig = [view, op, q('overlayColor').value, q('indicates').value].join('|');
  if (SAM.prevSig !== sig) rect = null;                            // 视图／不透明度／颜色换了 ⇒ 整张重画
  SAM.prevSig = sig;
  const fullB=rect||[0,0,w,h], B=[Math.floor(fullB[0]/scale),Math.floor(fullB[1]/scale),Math.min(rw,Math.ceil(fullB[2]/scale)),Math.min(rh,Math.ceil(fullB[3]/scale))], bw = B[2] - B[0], bh = B[3] - B[1]; if (bw <= 0 || bh <= 0){ redraw(); return; }
  const x = c.getContext('2d'), img = x.createImageData(bw, bh), d = img.data, src = SAM.comp;
  const chk = (px, py) => ((px >> 3) + (py >> 3)) & 1 ? 204 : 255;
  const col = q('overlayColor').value, cr = parseInt(col.slice(1, 3), 16), cg = parseInt(col.slice(3, 5), 16), cbv = parseInt(col.slice(5, 7), 16), masked = q('indicates').value !== 'selected';
  const bgOf = view === 'onBlack' ? () => 0 : view === 'onWhite' ? () => 255 : chk;
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++){
    const px = Math.min(w-1,Math.floor((B[0]+xx+0.5)*scale)), py = Math.min(h-1,Math.floor((B[1]+yy+0.5)*scale)), i = py * w + px, o = (yy * bw + xx) * 4;
    if (view === 'overlay'){ const a = masked ? 255 - A[i] : A[i]; d[o] = cr; d[o + 1] = cg; d[o + 2] = cbv; d[o + 3] = Math.round(a * op); }
    else if (view === 'blackWhite'){ d[o] = d[o + 1] = d[o + 2] = A[i]; d[o + 3] = 255; }
    else {
      const sa = src[i * 4 + 3] / 255, k = view === 'onLayers' ? A[i] / 255 : A[i] / 255 + (1 - A[i] / 255) * (1 - op), t = sa * k, bg = bgOf(px, py);
      for (let ch = 0; ch < 3; ch++) d[o + ch] = Math.round(src[i * 4 + ch] * t + bg * (1 - t));
      d[o + 3] = 255;
    }
  }
  x.putImageData(img, B[0], B[1]);
  redraw();
}
/* 工作区开着时画布的「工具」：Tools.modal（tools/_registry.js：Tools.current() 先回它） */
const SAM_TOOL = {
  id:'selectAndMask', cursor:'crosshair',
  onDown(e, pt, P){
    if (!SAM) return;
    const nav = (SAM.tool === 'hand' || SAM.tool === 'zoom') && Tools.get(SAM.tool);   // 抓手／缩放：交给那两颗工具本身
    if (nav){ if (nav.onDown) nav.onDown(e, pt, P); return; }
    if (e.button) return;
    const q = [+pt[0].toFixed(2), +pt[1].toFixed(2)], c = SAM.cur;
    if (c && c.tool === 'lasso' && c.poly){                         // 多边形套索进行中：点一下加一点；点回起点／双击＝闭合；按住 Alt 拖＝这段手绘
      const now = performance.now(), z = UI.zoom || 1, p0 = c.pts[0], pl = c.pts[c.pts.length - 1];
      const dbl = now - (c.lastT || 0) < 400 && Math.hypot(q[0] - pl[0], q[1] - pl[1]) * z <= 4;
      c.lastT = now;
      if ((c.pts.length >= 3 && Math.hypot(q[0] - p0[0], q[1] - p0[1]) * z <= 6) || dbl){ samLassoFinish(); return; }
      c.pts.push(q); c.free = !!e.altKey; redraw(); return;
    }
    samCancelJob();
    const sub = (SAM.mode === 'sub') !== !!e.altKey, t = SAM.tool;
    SAM.cur = {tool:t, subtract:sub, pts:[q]};
    if (t === 'lasso'){ SAM.cur.poly = SAM.lassoKind === 'poly'; SAM.cur.free = !SAM.cur.poly; SAM.cur.lastT = performance.now(); }
    const tip = SAM_SIZED.includes(t) && samTip(t);
    if (tip){
      SAM.cur.size = tip.size;
      if ((t === 'brush' || t === 'quickSelect') && tip.hardness < 1) SAM.cur.hardness = tip.hardness;
      for (const f of Object.keys(SAM_TIP_DEF)) if (tip[f] !== SAM_TIP_DEF[f]) SAM.cur[f] = tip[f];
      const pr = tip.sizeControl !== 'off' && samPressure(e, tip.sizeControl); if (pr) q.push(+pr.toFixed(3));   // 大小：钢笔压力／斜度／光笔轮 ⇒ 点带第三格比例
    }
    samStrokeStop();
    if (tip && samLiveOn(t)){ SAM.live = {n:0, timer:0, cost:0, last:0, runs:0, src:null}; SAM.liveCosts = []; SAM.liveParts = []; SAM.settleCosts = []; samStrokeLive(); }
    redraw();
  },
  onMove(e, pt, P){
    if (!SAM) return;
    const nav = (SAM.tool === 'hand' || SAM.tool === 'zoom') && Tools.get(SAM.tool);
    if (nav){ if (nav.onMove) nav.onMove(e, pt, P); return; }
    const c = SAM.cur, q = [+pt[0].toFixed(2), +pt[1].toFixed(2)];
    if(c && Pointer.down) samCancelJob();
    if (c && c.tool === 'lasso'){
      c.rub = q;
      if (Pointer.down && c.free) c.pts.push(q);
    } else if (c && Pointer.down){
      const pr = c.sizeControl && c.sizeControl !== 'off' && samPressure(e, c.sizeControl); if (pr) q.push(+pr.toFixed(3));
      if (c.tool === 'objectSelect' && SAM.objMode !== 'lasso') c.pts[1] = q; else c.pts.push(q);
      if (SAM.live) samStrokeLive();
    }
    redraw();
  },
  onUp(e, pt, P){
    if (!SAM) return;
    const nav = (SAM.tool === 'hand' || SAM.tool === 'zoom') && Tools.get(SAM.tool);
    if (nav){ if (nav.onUp) nav.onUp(e, pt, P); return; }
    if (!SAM.cur) return;
    const c = SAM.cur;
    if (c.tool === 'lasso'){
      // 套索拖着按 Alt 放开＝换成多边形接着点（PS）；多边形里按 Alt 拖的那段放开＝回到点击；多边形要点回起点／双击／Enter 才闭合
      if (c.poly){ c.free = false; redraw(); return; }
      if (e.altKey){ c.poly = true; c.free = false; redraw(); return; }
    }
    samStrokeStop();
    const st = SAM.cur; SAM.cur = null;
    delete st.poly; delete st.free; delete st.rub; delete st.lastT;
    if (st.tool === 'objectSelect' && SAM.objMode !== 'lasso'){          // 对象选择（矩形模式）：拖的框；框太小＝不算
      const a = st.pts[0], b = st.pts[1] || a, r = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
      if (r[2] < 3 || r[3] < 3){ redraw(); return; }
      delete st.pts; st.rect = r.map(v => +v.toFixed(2));
    } else if ((st.tool === 'lasso' || st.tool === 'objectSelect') && st.pts.length < 3){ redraw(); return; }
    SAM.strokes.push(st); SAM.redo = [];
    samRecompute();
  },
  onUndoKey(e){
    if (!SAM) return false;
    if (e.shiftKey){ if (SAM.redo.length) SAM.strokes.push(SAM.redo.pop()); }
    else if (SAM.strokes.length) SAM.redo.push(SAM.strokes.pop());
    samRecompute(); return true;
  },
  onKey(e){
    if (!SAM) return false;
    if (e.ctrlKey || e.metaKey) return false;
    const k = e.key.toLowerCase(), R = SAM.dlg.root, poly = SAM.cur && SAM.cur.tool === 'lasso' && SAM.cur.poly;
    if (poly && (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete')){   // 多边形套索：Enter 闭合、Esc 放弃、Backspace 退一点
      e.preventDefault();
      if (e.key === 'Enter') samLassoFinish();
      else if (e.key === 'Escape') SAM.cur = null;
      else if (SAM.cur.pts.length > 1) SAM.cur.pts.pop(); else SAM.cur = null;
      redraw(); return true;
    }
    if (e.key === 'Enter'){ e.preventDefault(); SAM.dlg.doOK(); return true; }
    if (e.key === 'Escape'){ e.preventDefault(); SAM.dlg.doCancel(); return true; }
    if (e.key === '[' || e.key === ']'){
      const tip = SAM_SIZED.includes(SAM.tool) && samTip(); if (!tip) return true;
      const s = tip.size, st = s <= 10 ? 1 : s <= 50 ? 5 : s <= 100 ? 10 : 25;
      samSetSize(e.key === ']' ? s + st : s - st); return true;
    }
    if (k === 'l' && e.shiftKey){ samSetLassoKind(SAM.lassoKind === 'poly' ? 'free' : 'poly'); samSetTool('lasso'); return true; }   // Shift+L 在套索／多边形套索间轮换（PS）
    if (k === 'r') samSetTool('refine'); else if (k === 'b') samSetTool('brush'); else if (k === 'l') samSetTool('lasso');
    else if (k === 'h') samSetTool('hand'); else if (k === 'z') samSetTool('zoom');
    else if (k === 'w') samSetTool(e.shiftKey ? (SAM.tool === 'quickSelect' ? 'objectSelect' : 'quickSelect') : (SAM.tool === 'objectSelect' ? 'objectSelect' : 'quickSelect'));   // W／Shift+W 在快速选择、对象选择间轮换（PS）
    else if (k === 'j' || k === 'p'){ const c = R.querySelector(`[data-k="${k === 'j' ? 'showEdge' : 'showOriginal'}"]`); c.checked = !c.checked; samRender(); }
    else { const v = SAM_VIEWS.find(([, key]) => key === k); if (v) samSetView(v[0]); }
    return true;                                                   // 工作区开着：其他单键不换工具
  },
  drawOverlay(ctx, s){
    if (!SAM) return;
    if(SAM.prev && SAM.renderScale!==Math.max(1,Math.ceil(1/Math.max(0.01,UI.zoom*Math.min(window.devicePixelRatio||1,2)))) && !SAM.renderTimer) SAM.renderTimer=setTimeout(()=>{if(SAM){SAM.renderTimer=0;samRender();}},0);
    if (SAM.prev){ ctx.save(); ctx.imageSmoothingEnabled = s < 1; ctx.drawImage(SAM.prev, 0, 0, W() * s, H() * s); ctx.restore(); }
    const st = SAM.cur;
    if (st && st.pts.length && (st.tool === 'lasso' || st.tool === 'objectSelect')){   // 套索／对象选择：虚线框或手绘圈
      ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
      if (st.tool === 'objectSelect' && SAM.objMode !== 'lasso'){ const a = st.pts[0], b = st.pts[1] || a; ctx.rect(Math.min(a[0], b[0]) * s + 0.5, Math.min(a[1], b[1]) * s + 0.5, Math.abs(b[0] - a[0]) * s, Math.abs(b[1] - a[1]) * s); }
      else { ctx.moveTo(st.pts[0][0] * s, st.pts[0][1] * s); for (const q of st.pts) ctx.lineTo(q[0] * s, q[1] * s); if (st.poly && !st.free && st.rub) ctx.lineTo(st.rub[0] * s, st.rub[1] * s); }
      ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
    } else if (st && st.pts.length){
      ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, st.size * s);
      ctx.strokeStyle = st.tool === 'brush' ? (st.subtract ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)') : st.tool === 'quickSelect' ? (st.subtract ? 'rgba(255,90,90,.3)' : 'rgba(120,255,140,.3)') : (st.subtract ? 'rgba(80,160,255,.3)' : 'rgba(255,220,80,.3)');
      ctx.beginPath(); ctx.moveTo(st.pts[0][0] * s, st.pts[0][1] * s); for (const q of st.pts) ctx.lineTo(q[0] * s, q[1] * s);
      if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] * s + 0.01, st.pts[0][1] * s);
      ctx.stroke(); ctx.restore();
    }
    const hv = Pointer.hover;
    if (hv && SAM_SIZED.includes(SAM.tool)){                      // 游标＝笔尖形状（圆度、角度照画笔设置）
      const tip = samTip(), r = tip.size / 2 * s, ro = tip.roundness / 100, an = -tip.angle * Math.PI / 180;
      ctx.save(); ctx.lineWidth = 1;
      ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.ellipse(hv[0] * s, hv[1] * s, r, r * ro, an, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.ellipse(hv[0] * s, hv[1] * s, Math.max(0, r - 1), Math.max(0, r * ro - 1), an, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
};
function samSetTool(t){
  if (!SAM || !SAM_TB.some(([id]) => id === t)) return;
  const prev = SAM.tool, pt = (prev === 'hand' || prev === 'zoom') && prev !== t && Tools.get(prev);
  if (pt && pt.onDeactivate) pt.onDeactivate();
  samStrokeStop(); samTipClose(); samFlyClose();
  SAM.tool = t; SAM.cur = null;
  document.querySelectorAll('#toolbar [data-sam-tool]').forEach(b => b.classList.toggle('on', b.dataset.samTool === t));
  if (UI.canvas) UI.canvas.style.cursor = t === 'hand' ? 'grab' : t === 'zoom' ? 'zoom-in' : 'crosshair';
  samOptions(); redraw();
}
function samSetMode(m){ if (!SAM) return; SAM.mode = m; document.querySelectorAll('#optBody [data-sam-mode]').forEach(b => b.classList.toggle('on', b.dataset.samMode === m)); }
/* 改笔尖（目前这颗工具自己的；t 给了就改那颗）：选项栏的大小格、笔尖钮、画笔设置面板跟着 */
function samSetTip(f, v, t){
  if (!SAM) return; const tip = samTip(t); if (!tip || !(f in tip)) return;
  if (f === 'spacingEnabled' || f === 'sizeControl'){
    tip[f] = f === 'spacingEnabled' ? !!v : (SAM_CTLS.includes(v) ? v : 'off');
    if (!t || t === SAM.tool) samTipSync();
    return;
  }
  if (!isFinite(v)) return;
  const lim = {size:[1, 5000, 1], hardness:[0, 1, 0.01], spacing:[1, 1000, 1], angle:[-180, 180, 1], roundness:[1, 100, 1]}[f];
  tip[f] = Math.min(lim[1], Math.max(lim[0], Math.round(v / lim[2]) * lim[2]));
  if (!t || t === SAM.tool) samTipSync();
  redraw();
}
function samSetSize(v){ samSetTip('size', v); }
function samTipSync(){
  const tip = samTip(); if (!tip) return;
  const s = document.querySelector('#optBody [data-k="brushSize"]'); if (s) s.value = tip.size;
  const hd = document.querySelector('#optBody [data-k="brushHardness"]'); if (hd && tip.hardness !== undefined) hd.value = Math.round(tip.hardness * 100);
  const lb = document.querySelector('#optBody [data-sam-act="tip"] .n'); if (lb) lb.textContent = tip.size;
  const pn = SAM.tipPanel;
  if (pn){
    for (const f of Object.keys(tip)){
      const val = f === 'hardness' ? Math.round(tip[f] * 100) : tip[f];
      pn.querySelectorAll(`[data-k="tip.${f}"]`).forEach(i => { if (i.type === 'checkbox') i.checked = !!val; else if (document.activeElement !== i) i.value = val; });
    }
    pn.querySelectorAll('[data-k="tip.spacing"]').forEach(i => { i.disabled = tip.spacingEnabled === false; });   // 间距勾掉＝滑杆变灰（PS）
    samTipDraw();
  }
}
/* 选项栏点笔尖弹出的画笔设置（PS 画笔预设选取器：大小、硬度、间距、角度、圆度，下面画笔尖形状） */
function samTipOpen(anchor){
  samTipClose(); if (!SAM || !SAM_SIZED.includes(SAM.tool)) return;
  const tip = samTip(), pn = el('div', 'samtip'); pn.dataset.samTool = SAM.tool;
  const row = (f, label, min, max, unit) => {
    const r = el('div', 'r'), rg = document.createElement('input'), nm = document.createElement('input');
    rg.type = 'range'; nm.type = 'number'; rg.min = nm.min = min; rg.max = nm.max = max; rg.dataset.k = nm.dataset.k = 'tip.' + f;
    rg.value = nm.value = f === 'hardness' ? Math.round(tip[f] * 100) : tip[f];
    const set = v => samSetTip(f, f === 'hardness' ? v / 100 : v);
    rg.oninput = () => set(parseFloat(rg.value)); nm.onchange = () => set(parseFloat(nm.value));
    nm.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape'){ ev.preventDefault(); if (ev.key === 'Enter') set(parseFloat(nm.value)); samTipClose(); } });
    const lb = el('span', '', label);
    if (f === 'spacing'){                                          // PS：间距前面一个勾选框；勾掉＝照拖动速度（每个事件点）盖章
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.k = 'tip.spacingEnabled'; cb.checked = tip.spacingEnabled !== false;
      cb.onchange = () => samSetTip('spacingEnabled', cb.checked);
      lb.textContent = ''; const l = document.createElement('label'); l.append(cb, label); lb.appendChild(l);
      rg.disabled = nm.disabled = tip.spacingEnabled === false;
    }
    r.append(lb, rg, nm, el('span', '', unit)); pn.appendChild(r);
  };
  row('size', T('sam.size'), 1, 500, 'px');
  if (tip.sizeControl !== undefined){                              // PS：大小底下「大小：关／钢笔压力」（有压感笔时照压力缩放）
    const r = el('div', 'r'), s = document.createElement('select'); s.dataset.k = 'tip.sizeControl';
    for (const [v, k] of [['off', 'sam.ctlOff'], ['pen', 'sam.ctlPen'], ['tilt', 'sam.ctlTilt'], ['wheel', 'sam.ctlWheel']].filter(([v])=>SAM.tool !== 'quickSelect' || v !== 'tilt')){ const o = document.createElement('option'); o.value = v; o.textContent = T(k); s.appendChild(o); }
    s.value = tip.sizeControl; s.onchange = () => samSetTip('sizeControl', s.value);
    s.addEventListener('keydown', ev => ev.stopPropagation());
    r.append(el('span', '', T('sam.sizeCtl')), s); pn.appendChild(r);
  }
  if (tip.hardness !== undefined) row('hardness', T('sam.hardness'), 0, 100, '%');
  if (tip.spacing !== undefined){
    const cv = document.createElement('canvas'); cv.width = 90; cv.height = 60; cv.dataset.k = 'tipShape'; pn.appendChild(cv);
    row('spacing', T('sam.spacing'), 1, 1000, '%'); row('angle', T('sam.angle'), -180, 180, '°'); row('roundness', T('sam.roundness'), 1, 100, '%');
  }
  document.body.appendChild(pn); SAM.tipPanel = pn;
  const b = anchor.getBoundingClientRect(); pn.style.left = Math.round(b.left) + 'px'; pn.style.top = Math.round(b.bottom + 4) + 'px';
  samTipDraw();
  setTimeout(() => { if (SAM && SAM.tipPanel === pn) document.addEventListener('pointerdown', SAM.tipOff = ev => { if (!pn.contains(ev.target) && !anchor.contains(ev.target)) samTipClose(); }, true); }, 0);
}
function samTipClose(){
  if (!SAM || !SAM.tipPanel) return;
  SAM.tipPanel.remove(); SAM.tipPanel = null;
  if (SAM.tipOff){ document.removeEventListener('pointerdown', SAM.tipOff, true); SAM.tipOff = null; }
}
function samTipDraw(){
  const cv = SAM && SAM.tipPanel && SAM.tipPanel.querySelector('[data-k="tipShape"]'), tip = samTip(); if (!cv || !tip) return;
  const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height);
  const r = 22, ro = tip.roundness / 100, an = -tip.angle * Math.PI / 180;
  x.fillStyle = '#222'; x.beginPath(); x.ellipse(cv.width / 2, cv.height / 2, r, Math.max(0.5, r * ro), an, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#2f7fd8'; x.beginPath(); x.moveTo(cv.width / 2, cv.height / 2); x.lineTo(cv.width / 2 + Math.cos(an) * (r + 6), cv.height / 2 + Math.sin(an) * (r + 6)); x.stroke();
}
/* 套索那格（PS：套索／多边形套索同一格；右键或按住叫出小选单、Shift+L 轮换） */
function samSetLassoKind(k){
  if (!SAM || (k !== 'free' && k !== 'poly')) return;
  SAM.lassoKind = k; if (SAM.cur && SAM.cur.tool === 'lasso') SAM.cur = null;
  const b = document.querySelector('#toolbar [data-sam-tool="lasso"]');
  if (b && window.Icons){ b.innerHTML = Icons.svg(k === 'poly' ? 'lasso-poly' : 'lasso'); b.dataset.tip = T(k === 'poly' ? 'sam.t.polyLasso' : 'sam.t.lasso'); b.dataset.lassoKind = k; }
  if (SAM.tool === 'lasso'){ const nm = document.getElementById('optToolName'); if (nm) nm.textContent = T(k === 'poly' ? 'sam.t.polyLasso' : 'sam.t.lasso'); }
  redraw();
}
function samFlyOpen(anchor){
  samFlyClose(); if (!SAM) return;
  const fl = el('div', 'samfly');
  for (const [k, icon, lab] of [['free', 'lasso', 'sam.t.lasso'], ['poly', 'lasso-poly', 'sam.t.polyLasso']]){
    const it = el('div', 'it' + (SAM.lassoKind === k ? ' on' : '')); it.dataset.samLasso = k;
    it.innerHTML = window.Icons ? Icons.svg(icon) : ''; it.append(el('span', '', T(lab)), el('span', 'k', 'L'));
    it.onclick = ev => { ev.stopPropagation(); samSetLassoKind(k); samSetTool('lasso'); samFlyClose(); };
    fl.appendChild(it);
  }
  document.body.appendChild(fl); SAM.fly = fl;
  const b = anchor.getBoundingClientRect(); fl.style.left = Math.round(b.right + 4) + 'px'; fl.style.top = Math.round(b.top) + 'px';
  setTimeout(() => { if (SAM && SAM.fly === fl) document.addEventListener('pointerdown', SAM.flyOff = ev => { if (!fl.contains(ev.target)) samFlyClose(); }, true); }, 0);
}
function samFlyClose(){
  if (!SAM || !SAM.fly) return;
  SAM.fly.remove(); SAM.fly = null;
  if (SAM.flyOff){ document.removeEventListener('pointerdown', SAM.flyOff, true); SAM.flyOff = null; }
}
/* 多边形套索闭合 ⇒ 跟套索一样交给 lasso.select（点就是多边形的角） */
function samLassoFinish(){
  if (!SAM || !SAM.cur) return;
  const st = SAM.cur; SAM.cur = null;
  if (st.pts.length < 3){ redraw(); return; }
  SAM.strokes.push({tool:'lasso', subtract:st.subtract, pts:st.pts}); SAM.redo = [];
  samRecompute();
}
/* 存储预设…（PS：弹出小窗输入名称，确定／取消） */
function samPresetSaveDialog(){
  if (!SAM || document.querySelector('.pssel-back.samsave')) return;
  const back = el('div', 'pssel-back samsave'), root = el('div', 'pssel-dlg');
  root.dataset.cmd = 'ps.select.selectAndMask.preset';
  root.appendChild(el('div', 'hd', T('sam.pSaveT')));
  const bd = el('div', 'bd'), col = el('div', 'col'), btns = el('div', 'btns'), err = el('div', 'err');
  const r = el('div', 'row'), inp = document.createElement('input'); inp.type = 'text'; inp.dataset.k = 'presetName';
  const P = samPresets(); let i = 1; while (P[T('sam.pNameDef') + ' ' + i]) i++;
  inp.value = T('sam.pNameDef') + ' ' + i;
  r.append(el('label', 'l', T('sam.pName') + '：'), inp); col.appendChild(r);
  const ok = el('button', 'pri', T('ok')), ca = el('button', '', T('cancel'));
  ok.type = ca.type = 'button'; ok.dataset.samAct = 'presetSave'; ca.dataset.samAct = 'presetCancel';
  btns.append(ok, ca); bd.append(col, btns); root.append(bd, err); back.appendChild(root); document.body.appendChild(back);
  const close = () => { back.remove(); if (SAM) samPresetMenu(); };
  ok.onclick = () => { const res = samPresetOp({action:'save', name:inp.value}); if (res.ok) close(); else err.textContent = res.error; };
  ca.onclick = close;
  root.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter'){ ev.preventDefault(); ok.click(); } else if (ev.key === 'Escape'){ ev.preventDefault(); close(); }
  });
  inp.focus(); inp.select();
}
/* 左工具栏整个换成工作区工具（PS 2020）；关掉工作区由 Toolbar.build 还原 */
function samToolbar(){
  const tb = document.getElementById('toolbar'); if (!tb || !window.Icons) return;
  if (window.Toolbar){ try { Toolbar.closeFlyout(); Toolbar.closeDrawer(); Toolbar.hideTip(); } catch(_){} }
  tb.innerHTML = ''; tb.dataset.layout = 'selectAndMask';
  const grid = el('div', 'tbgrid'); tb.appendChild(grid);
  const refineIcon = `<svg class="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Icons.inner('brush')}<path d="M2.5 10.5a8 8 0 0 1 8-8" stroke-dasharray="2 2"/></svg>`;
  for (const [id, icon, key] of SAM_TB){
    const b = el('div', 'tb'); b.dataset.samTool = id; b.dataset.tip = T('sam.t.' + id); b.dataset.tipKey = key;
    b.innerHTML = icon ? Icons.svg(icon) : refineIcon;
    b.addEventListener('click', e => { e.stopPropagation(); if (b.__held) { b.__held = false; return; } samSetTool(id); });
    if (id === 'lasso'){                                           // 套索格：右键或按住半秒叫出套索／多边形套索
      b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); samFlyOpen(b); });
      let hold = 0;
      b.addEventListener('pointerdown', e => { if (e.button) return; clearTimeout(hold); hold = setTimeout(() => { b.__held = true; samFlyOpen(b); }, 500); });
      for (const ev of ['pointerup', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(hold));
    }
    grid.appendChild(b);
  }
  tb.querySelectorAll('[data-sam-tool]').forEach(b => b.classList.toggle('on', b.dataset.samTool === SAM.tool));
  samSetLassoKind(SAM.lassoKind);
}
/* 上面选项栏换成工作区这颗工具的选项（＋／−、大小、硬度、对象选择的模式、抓手／缩放的 100%／适合屏幕；右边固定「选择主体」「调整细线」） */
function samOptions(){
  if (!SAM) return;
  const nm = document.getElementById('optToolName'), box = document.getElementById('optBody'); if (!box) return;
  if (nm) nm.textContent = T('sam.t.' + (SAM.tool === 'lasso' && SAM.lassoKind === 'poly' ? 'polyLasso' : SAM.tool));
  samTipClose();
  box.innerHTML = ''; box.dataset.sam = SAM.tool;
  const btn = (txt, attrs, fn, title) => { const b = el('button', 'samopt', txt); b.type = 'button'; Object.assign(b.dataset, attrs); if (title) b.title = title; b.onclick = fn; box.appendChild(b); return b; };
  const lab = (txt, input) => { const l = document.createElement('label'); l.appendChild(el('span', '', txt)); l.appendChild(input); box.appendChild(l); return input; };
  const t = SAM.tool, tip = SAM_SIZED.includes(t) && samTip(t);
  if (SAM_MODED.includes(t)){ btn('＋', {samMode:'add'}, () => samSetMode('add'), T('sam.add')); btn('−', {samMode:'sub'}, () => samSetMode('sub'), T('sam.sub')); }
  if (tip){
    // 笔尖钮（PS 选项栏的画笔预设选取器：点了弹出画笔设置）＋大小格；每颗工具各记各的
    const tb = btn('', {samAct:'tip'}, () => SAM.tipPanel ? samTipClose() : samTipOpen(tb), T('sam.tip')); tb.classList.add('tip');
    tb.append(el('span', '', '●'), el('span', 'n', String(tip.size)), el('span', '', '▾'));
    const sz = document.createElement('input'); sz.type = 'number'; sz.min = 1; sz.max = 5000; sz.value = tip.size; sz.dataset.k = 'brushSize';
    sz.onchange = () => samSetSize(parseFloat(sz.value) || tip.size); lab(T('sam.size'), sz);
  }
  if (t === 'brush'){
    const hd = document.createElement('input'); hd.type = 'number'; hd.min = 0; hd.max = 100; hd.value = Math.round(tip.hardness * 100); hd.dataset.k = 'brushHardness';
    hd.onchange = () => { const v = parseFloat(hd.value); if (isFinite(v)) samSetTip('hardness', v / 100); hd.value = Math.round(samTip('brush').hardness * 100); };
    lab(T('sam.hardness'), hd); box.appendChild(el('span', '', '%'));
  }
  if (t === 'objectSelect'){
    const s = document.createElement('select'); s.dataset.k = 'objMode';
    for (const [v, k] of [['rect', 'sam.objRect'], ['lasso', 'sam.objLasso']]){ const o = document.createElement('option'); o.value = v; o.textContent = T(k); if (v === SAM.objMode) o.selected = true; s.appendChild(o); }
    s.onchange = () => { SAM.objMode = s.value; }; lab(T('sam.objMode'), s);
  }
  if (t === 'zoom'){ btn(T('sam.zoomIn'), {samAct:'zoomIn'}, () => CMD.run('zoom.click', {})); btn(T('sam.zoomOut'), {samAct:'zoomOut'}, () => CMD.run('zoom.click', {out:true})); }
  if (t === 'hand' || t === 'zoom'){ btn('100%', {samAct:'zoomActual'}, () => CMD.run('zoom.actual')); btn(T('sam.fit'), {samAct:'zoomFit'}, () => CMD.run('zoom.fit')); }
  box.appendChild(el('span', 'samsp'));
  btn(T('sam.subject'), {samAct:'subject'}, () => samBaseOp('subject'));
  btn(T('sam.refineHair'), {samAct:'refineHair'}, () => { SAM.strokes.push({tool:'refineHair'}); SAM.redo = []; samRecompute(); });
  samSetMode(SAM.mode);
}
/* 把一组设置（默认值／记住的／某个预设）套进属性面板 */
function samApply(S){
  if (!SAM) return; const R = SAM.dlg.root, q = k => R.querySelector(`[data-k="${k}"]`);
  S = Object.assign({}, SAM_DEFAULTS, S || {});
  SAM.opac = Object.assign({}, S.opac || {});
  const v = SAM_VIEWS.some(([x]) => x === S.view) ? S.view : 'onionSkin';
  q('view').value = v; q('opacity').value = SAM.opac[v] !== undefined ? SAM.opac[v] : (SAM_OPACITY[v] || 100);
  q('overlayColor').value = /^#[0-9a-f]{6}$/i.test(S.overlayColor || '') ? S.overlayColor : '#ff0000';
  q('indicates').value = S.indicates === 'selected' ? 'selected' : 'masked';
  for (const [k] of SAM_NUMS){ const x = +S[k]; q(k).value = isFinite(x) ? x : SAM_DEFAULTS[k]; const sl = q(k + 'Slider'); if (sl) sl.value = q(k).value; }
  for (const k of ['smartRadius', 'decontaminate', 'sampleAllLayers']) q(k).checked = !!S[k];
  const os = q('output');
  for (const op of os.options) op.disabled = !!S.decontaminate && (op.value === 'selection' || op.value === 'layerMask');
  os.value = SAM_OUTPUTS.includes(S.output) ? S.output : 'selection';
  if (S.decontaminate && (os.value === 'selection' || os.value === 'layerMask')) os.value = 'newLayerWithMask';
  SAM.tips = samTipsInit(isFinite(+S.size) && +S.size > 0 ? +S.size : 40, S.tips);   // 旧存档只有一个 size ⇒ 三颗都用它
  samTipSync();
  SAM.refineMode = S.refineMode === 'object' ? 'object' : 'color';
  R.querySelectorAll('[data-sam-rmode]').forEach(b => b.classList.toggle('on', b.dataset.samRmode === SAM.refineMode));
  samCommit();
}
/* 目前面板上的设置（记住设置、存储预设用） */
function samSnapshot(){
  const R = SAM.dlg.root, q = k => R.querySelector(`[data-k="${k}"]`);
  SAM.opac[q('view').value] = parseFloat(q('opacity').value);
  return Object.assign(samSettings(), {view:q('view').value, opac:Object.assign({}, SAM.opac), overlayColor:q('overlayColor').value, indicates:q('indicates').value, tips:JSON.parse(JSON.stringify(SAM.tips))});
}
/* 预设下拉（PS：默认值、记住的设置、自己存的预设；存储预设…、删除预设…） */
function samPresetMenu(){
  if (!SAM) return; const s = SAM.dlg.root.querySelector('[data-k="preset"]'); if (!s) return;
  const P = samPresets(), cur = SAM.preset;
  s.innerHTML = '';
  const add = (v, txt, dis) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; if (dis) o.disabled = true; s.appendChild(o); return o; };
  add('default', T('sam.pDefault'));
  if (samRemembered()) add('remembered', T('sam.pRemembered'));
  for (const name of Object.keys(P)) add('user:' + name, name);
  add('-', '──────', true);
  add('__save', T('sam.pSave'));
  add('__delete', T('sam.pDelete'), !/^user:/.test(cur || ''));
  s.value = [...s.options].some(o => o.value === cur) ? cur : 'default';
}
function samPresetPick(v){
  if (!SAM) return;
  if (v === '__save'){ samPresetMenu(); samPresetSaveDialog(); return; }
  if (v === '__delete'){ if (/^user:/.test(SAM.preset || '')) samPresetOp({action:'delete', name:SAM.preset.slice(5)}); else samPresetMenu(); return; }
  samPresetOp({action:'load', name:v === 'default' || v === 'remembered' ? v : v.replace(/^user:/, '')});
}
/* 预设动作（面板与 ps.select.selectAndMask.preset 共用）：save／load／delete／list */
function samPresetOp(p){
  const P = samPresets(), name = typeof p.name === 'string' ? p.name.trim() : '';
  const put = o => { try { localStorage.setItem(SAM_PRESETS, JSON.stringify(o)); } catch(_){} };
  if (p.action === 'list') return {ok:true, presets:Object.keys(P), remembered:!!samRemembered(), current:SAM ? SAM.preset : null};
  if (p.action === 'save'){
    if (!name || name === 'default' || name === 'remembered') return fail('preset name required');
    const S = SAM ? samSnapshot() : (p.settings && typeof p.settings === 'object' ? p.settings : null);
    if (!S) return fail('the Select and Mask workspace is not open (or give settings)');
    P[name] = S; put(P);
    if (SAM){ SAM.preset = 'user:' + name; samPresetMenu(); }
    return {ok:true, preset:name, presets:Object.keys(P)};
  }
  if (p.action === 'delete'){
    if (!P[name]) return fail('no preset ' + name);
    delete P[name]; put(P);
    if (SAM){ if (SAM.preset === 'user:' + name) SAM.preset = 'default'; samPresetMenu(); }
    return {ok:true, presets:Object.keys(P)};
  }
  if (p.action === 'load'){
    if (!SAM) return fail('the Select and Mask workspace is not open');
    const S = name === 'default' ? {} : name === 'remembered' ? samRemembered() : P[name];
    if (!S) return fail('no preset ' + name);
    SAM.preset = name === 'default' || name === 'remembered' ? name : 'user:' + name;
    samApply(S); samPresetMenu();
    return {ok:true, preset:name};
  }
  return fail('action must be save|load|delete|list');
}
function samSetRefineMode(m){ if (!SAM) return; SAM.refineMode = m; SAM.dlg.root.querySelectorAll('[data-sam-rmode]').forEach(b => b.classList.toggle('on', b.dataset.samRmode === m)); samRecompute(); }
function samSetView(v){
  if (!SAM) return; const R = SAM.dlg.root, s = R.querySelector('[data-k="view"]');
  SAM.opac[s.value] = parseFloat(R.querySelector('[data-k="opacity"]').value);
  s.value = v; R.querySelector('[data-k="opacity"]').value = SAM.opac[v] !== undefined ? SAM.opac[v] : (SAM_OPACITY[v] || 100);
  samRender();
}
function samBaseOp(op){
  if (!SAM) return;
  SAM.ops.push(op); applyBaseOps(SAM.base, [op]);
  samRecompute();
}
function samSave(){
  if (!SAM) return; const R = SAM.dlg.root, q = k => R.querySelector(`[data-k="${k}"]`);
  try {
    if (!q('remember').checked){ localStorage.removeItem(SAM_STORE); return; }
    localStorage.setItem(SAM_STORE, JSON.stringify(samSnapshot()));
  } catch(_){}
}
CMD.reg('ps.select.selectAndMask.dialog', {i18n:'', undoable:false,
  params:'{} 打开「选择并遮住」工作区（PS 2020）：左边工具栏换成工作区工具（快速选择 W、调整边缘画笔 R、画笔 B、对象选择 W、套索 L、抓手 H、缩放 Z），上面选项栏换成该工具的选项（＋／−、大小、硬度…、选择主体、调整细线）；' +
         '右边属性面板（预设、视图模式、实时调整、高品质预览、不透明度、颜色、表示、记住设置、调整模式、边缘检测、全局调整、输出设置）；' +
         '画布上直接刷／圈（Alt 反过来）、Ctrl+Z 退一笔；确定（Enter）＝跑 ps.select.selectAndMask（带这次的笔画与按钮动作），取消（Esc）＝选区不变；关掉后工具栏、选项栏还原。没有选区也能开（全遮住起算）'},
  () => {
    if (SAM && SAM.dlg) SAM.dlg.doCancel();
    const saved = samRemembered();
    const S = Object.assign({}, SAM_DEFAULTS, saved || {});
    const orig = Doc.sel, w = W(), h = H();
    const keepCursor = UI.canvas && UI.canvas.style.cursor;
    SAM = {orig, documentStamp:window.SmartSeg ? SmartSeg.documentStamp() : null, base:orig ? Uint8Array.from(SelMask.bytes()) : new Uint8Array(w * h), ops:[], strokes:[], redo:[], cur:null, prev:null, region:null,
           tool:'quickSelect', mode:'add', tips:samTipsInit(S.size || 40, S.tips), lassoKind:'free', live:null, small:null, tipPanel:null, fly:null, objMode:'rect', refineMode:S.refineMode === 'object' ? 'object' : 'color', opac:Object.assign({}, S.opac || {}),
           preset:saved ? 'remembered' : 'default', timer:0, prep:null, prepKey:null, previewScale:1,
           comp:composite(1).getContext('2d').getImageData(0, 0, w, h).data};
    if (window.SmartSeg) SmartSeg.regCache = new Map();             // 工作区开着时影像不变：快速选择每笔的分割结果按参数记着（拖着停笔精修过的、整段重算的旧笔画都不用再算）
    if (!document.getElementById('pssel-sam-css')){ const st = document.createElement('style'); st.id = 'pssel-sam-css'; st.textContent = SAM_CSS; document.head.appendChild(st); }
    const dlg = openDialog({cmd:'ps.select.selectAndMask', title:T('sam.title'), build(col, api){
      SAM.dlg = api; api.back.classList.add('sam');
      api.root.addEventListener('keydown', e => {          // 点过面板（焦点在面板上、不在栏位里）：工作区的键照样有效
        if (!SAM || /input|select|textarea/i.test(e.target.tagName) || e.key === 'Enter' || e.key === 'Escape') return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); SAM_TOOL.onUndoKey(e); return; }
        SAM_TOOL.onKey(e);
      });
      const btn = (parent, txt, attrs, fn, title) => { const b = el('button', '', txt); b.type = 'button'; Object.assign(b.dataset, attrs); if (title) b.title = title; b.onclick = fn; parent.appendChild(b); return b; };
      // 预设（PS：默认值／记住的／自己存的；存储预设…、删除预设…）
      const pr = selectRow(col, T('sam.preset'), 'preset', [['default', T('sam.pDefault')]], 'default');
      pr.onchange = () => samPresetPick(pr.value);
      // 视图模式
      const fs = leg => { const f = el('fieldset'); f.appendChild(el('legend', '', T(leg))); col.appendChild(f); return f; };
      const vf = fs('sam.viewMode');
      const vs = selectRow(vf, T('sam.view'), 'view', SAM_VIEWS.map(([v, k]) => [v, T('sam.v.' + v) + ' (' + k.toUpperCase() + ')']), SAM_VIEWS.some(([v]) => v === S.view) ? S.view : 'onionSkin');
      vs.onchange = () => samSetView(vs.value);
      checkRow(vf, T('sam.showEdge') + ' (J)', 'showEdge', false).onchange = samRender;
      checkRow(vf, T('sam.showOriginal') + ' (P)', 'showOriginal', false).onchange = samRender;
      checkRow(vf, T('sam.realtime'), 'realtime', true);
      checkRow(vf, T('sam.hq'), 'hq', false);
      const v0 = vs.value, opIn = numRow(vf, T('sam.opacity'), 'opacity', SAM.opac[v0] !== undefined ? SAM.opac[v0] : (SAM_OPACITY[v0] || 100), {min:0, max:100, step:1, unit:'%'});
      opIn.oninput = samRender;
      const cr = el('div', 'row'), cIn = document.createElement('input'); cIn.type = 'color'; cIn.dataset.k = 'overlayColor'; cIn.value = /^#[0-9a-f]{6}$/i.test(S.overlayColor || '') ? S.overlayColor : '#ff0000';
      cIn.oninput = samRender; cr.append(el('label', 'l', T('sam.color')), cIn); vf.appendChild(cr);
      selectRow(vf, T('sam.indicates'), 'indicates', [['masked', T('sam.masked')], ['selected', T('sam.selected')]], S.indicates === 'selected' ? 'selected' : 'masked').onchange = samRender;
      checkRow(col, T('sam.remember'), 'remember', !!saved);
      // 调整模式
      const mf = fs('sam.refineModeL'), seg = el('div', 'seg'); mf.appendChild(seg);
      btn(seg, T('sam.colorAware'), {samRmode:'color'}, () => samSetRefineMode('color'));
      btn(seg, T('sam.objectAware'), {samRmode:'object'}, () => samSetRefineMode('object'));
      // 边缘检测／全局调整／输出
      // 一列＝标签＋滑杆＋数字格：拖动／打字中走 samLive（看实时调整、高品质预览），放手／打完走 samCommit（全解析度重算）
      const numIn = (f, [k, min, max, step, lab, unit]) => {
        const n = numRow(f, T(lab), k, S[k] !== undefined ? S[k] : SAM_DEFAULTS[k], {min, max, step, unit:unit === 'px' ? T('px') : unit});
        const rg = document.createElement('input'); rg.type = 'range'; rg.min = min; rg.max = Math.min(max, k === 'feather' ? 250 : max); rg.step = step; rg.value = n.value; rg.dataset.k = k + 'Slider';
        n.parentNode.insertBefore(rg, n);
        rg.oninput = () => { n.value = rg.value; samLive(); }; rg.onchange = () => { n.value = rg.value; samCommit(); };
        n.oninput = () => { rg.value = n.value; samLive(); }; n.onchange = () => { rg.value = n.value; samCommit(); };
      };
      const e = fs('sam.edge'); numIn(e, SAM_NUMS[0]); checkRow(e, T('sam.smart'), 'smartRadius', !!S.smartRadius).onchange = samCommit;
      const g = fs('sam.global'); SAM_NUMS.slice(1, 5).forEach(x => numIn(g, x));
      const gb = el('div', 'samtools'); g.appendChild(gb);
      btn(gb, T('sam.clearSel'), {samAct:'clear'}, () => samBaseOp('clear'));
      btn(gb, T('sam.invert'), {samAct:'invert'}, () => samBaseOp('invert'));
      const o = fs('sam.out');
      const outSel = () => R0().querySelector('[data-k="output"]');
      const R0 = () => api.root;
      checkRow(o, T('sam.decon'), 'decontaminate', !!S.decontaminate).onchange = ev => {   // PS：勾净化颜色 ⇒ 选区／图层蒙版不能选、自动换成「新建带有图层蒙版的图层」
        const s = outSel(), on = ev.target.checked;
        for (const op of s.options) if (op.value === 'selection' || op.value === 'layerMask') op.disabled = on;
        if (on && (s.value === 'selection' || s.value === 'layerMask')) s.value = 'newLayerWithMask';
        samCommit();
      };
      numIn(o, SAM_NUMS[5]);
      const os = selectRow(o, T('sam.outTo'), 'output', SAM_OUTPUTS.map(v => [v, T('sam.out.' + v)]), SAM_OUTPUTS.includes(S.output) ? S.output : 'selection');
      if (S.decontaminate) for (const op of os.options) if (op.value === 'selection' || op.value === 'layerMask') op.disabled = true;
      checkRow(o, T('sam.all'), 'sampleAllLayers', !!S.sampleAllLayers).onchange = samCommit;
      const rs = el('div', 'samtools'); col.appendChild(rs);
      btn(rs, '↺ ' + T('sam.reset'), {samAct:'reset'}, () => {
        SAM.ops = []; SAM.strokes = []; SAM.redo = []; SAM.prep = null; SAM.base = SAM.orig ? Uint8Array.from((Doc.sel = SAM.orig, SelMask.bytes())) : new Uint8Array(w * h);
        for (const [k] of SAM_NUMS){ R0().querySelector(`[data-k="${k}"]`).value = SAM_DEFAULTS[k]; R0().querySelector(`[data-k="${k}Slider"]`).value = SAM_DEFAULTS[k]; }
        samRecompute();
      });
    }, ok(){
      if(SAM.documentStamp&&!SmartSeg.sameDocument(SAM.documentStamp)) return fail('workspace belongs to another document');
      clearTimeout(SAM.timer); const p = samParams(); samSave();
      if(SAM.readyKey===JSON.stringify(p)&&SmartSeg.sameDocument(SAM.readyStamp)) PS.previewReady={key:SAM.readyKey,stamp:SAM.readyStamp,w:W(),h:H(),prep:SAM.ready.prep,region:SAM.ready.region};
      Doc.sel = orig; PS.samLast = p;
      return CMD.run('ps.select.selectAndMask', p);
    }, cancel(){ clearTimeout(SAM.timer); if(!SAM.documentStamp||SmartSeg.sameDocument(SAM.documentStamp)) Doc.sel = orig; },
    onClose(){
      if (SAM){ clearTimeout(SAM.timer); clearTimeout(SAM.renderTimer); samCancelJob(); samStrokeStop(); samTipClose(); samFlyClose(); }
      document.querySelectorAll('.pssel-back.samsave').forEach(b => b.remove());
      const nav = SAM && (SAM.tool === 'hand' || SAM.tool === 'zoom') && Tools.get(SAM.tool); if (nav && nav.onDeactivate) nav.onDeactivate();
      if (Tools.modal === SAM_TOOL) Tools.modal = null; SAM = null;
      if (window.SmartSeg) SmartSeg.regCache = null;
      // 工具栏、选项栏还原成工作区前的样子（照目前图层种类重建）
      const ob = document.getElementById('optBody'); if (ob) delete ob.dataset.sam;
      try { if (window.Toolbar) Toolbar.build(Toolbar.kind); if (UI.buildOptions) UI.buildOptions(ToolState.cur); } catch(e){ console.error(e); }
      if (UI.canvas) UI.canvas.style.cursor = keepCursor || '';
    }});
    const syncOK=dlg.doOK;
    dlg.doOK=()=>{
      if(SAM&&SAM.documentStamp&&!SmartSeg.sameDocument(SAM.documentStamp)){dlg.setError('請回到開啟選擇並遮住的原文件，或取消工作區。');return fail('workspace belongs to another document');}
      if(!SAM || !window.SmartSeg || !SmartSeg.canAsync() || (SAM.readyKey===JSON.stringify(samParams())&&SmartSeg.sameDocument(SAM.readyStamp))) return syncOK();
      const owner=SAM,key=JSON.stringify(samParams());
      return samBackground().then(()=>{
        if(SAM===owner && owner.readyKey===key && JSON.stringify(samParams())===key) return syncOK();
        return fail('selection changed while refining');
      },e=>{if(!e.cancelled&&SAM===owner) dlg.setError(e.message);return fail(e.message);});
    };
    samToolbar();
    samSetTool('quickSelect'); samSetMode('add'); samPresetMenu();
    Tools.modal = SAM_TOOL;
    if (document.activeElement && dlg.root.contains(document.activeElement)) document.activeElement.blur();   // 键盘留给画布（W／R／B／L／H／Z／[ ]／O…／Enter／Esc）
    samSetRefineMode(SAM.refineMode);                                // 顺便算第一次预览
    return {ok:true, dialog:'ps.select.selectAndMask'};
  });
CMD.redirects.push((id,p)=>{
  if(/^(?:ps\.)?document\.(?:new|open|activate|close|copyLayers)$/.test(id)||/^file\.(?:new|open)$/.test(id)){
    if(SAM&&SAM.dlg)SAM.dlg.doCancel();
    if(window.QuickSelectTool&&QuickSelectTool.drag){const q=Tools.get('quickselect');if(q&&q.onDeactivate)q.onDeactivate();}
  }
  return null;
});
CMD.reg('ps.select.selectAndMask.state', {i18n:'', undoable:false, refresh:'none',
  params:'{} 工作区开着时回目前的状态：{open, tool, mode, size（目前这颗工具的；不是笔刷类＝null）, hardness（画笔的）, tip（目前这颗的画笔设置）, tips（三颗各自的）, lassoKind, lassoPts（多边形套索点到第几点）, live（这一笔拖动中预览算了几次）, liveCosts（最近一笔拖动中每次预览花几 ms）,objMode, view, refineMode, realtime, hq, previewScale（最近一次预览的缩小倍数，1＝全解析度）, preset, strokes（笔画数）, ops, params（确定时会送给 ps.select.selectAndMask 的参数）}'},
  () => {
    if (!SAM) return {ok:true, open:false};
    const q = k => SAM.dlg.root.querySelector(`[data-k="${k}"]`);
    const tip = SAM_SIZED.includes(SAM.tool) ? samTip() : null;
    return {ok:true, open:true, tool:SAM.tool, mode:SAM.mode, size:tip ? tip.size : null, hardness:samTip('brush').hardness, tip:tip ? Object.assign({}, tip) : null, tips:JSON.parse(JSON.stringify(SAM.tips)),
            lassoKind:SAM.lassoKind, lassoPts:SAM.cur && SAM.cur.tool === 'lasso' ? SAM.cur.pts.length : 0, live:SAM.live ? SAM.live.runs : 0, objMode:SAM.objMode, view:q('view').value, refineMode:SAM.refineMode,
            realtime:q('realtime').checked, hq:q('hq').checked, previewScale:SAM.previewScale, preset:SAM.preset, liveCosts:(SAM.liveCosts || []).slice(), liveParts:(SAM.liveParts || []).slice(), settleCosts:(SAM.settleCosts || []).slice(),
            pending:!!SAM.pending, asyncError:SAM.asyncError||null, strokes:SAM.strokes.length, ops:SAM.ops.slice(), params:samParams()};
  });
CMD.reg('ps.select.selectAndMask.tool', {i18n:'', undoable:false,
  params:'{tool?:"quickSelect|refine|brush|objectSelect|lasso|hand|zoom", lassoKind?:"free|poly"（套索格：套索／多边形套索）, mode?:"add|sub", size?, hardness?:0..100（画笔；目前是快速选择＝快速选择的）, spacing?:1..1000 %, spacingEnabled?:bool, angle?:-180..180°, roundness?:1..100 %, sizeControl?:"off|pen|tilt|wheel"（关／钢笔压力／钢笔斜度／光笔轮；快速选择、调整边缘画笔、画笔）, objMode?:"rect|lasso"} ' +
         '工作区开着时换左边的工作区工具／改选项栏与画笔设置（＝点工具栏、选项栏；大小等只改目前这颗工具自己的，三颗笔刷类工具各记各的） → state'},
  p => {
    if (!SAM) return fail('the Select and Mask workspace is not open');
    if (p.tool !== undefined){ if (!SAM_TB.some(([id]) => id === p.tool)) return fail('unknown workspace tool ' + p.tool); samSetTool(p.tool); }
    if (p.lassoKind === 'free' || p.lassoKind === 'poly') samSetLassoKind(p.lassoKind);
    if (p.mode === 'add' || p.mode === 'sub') samSetMode(p.mode);
    if (typeof p.size === 'number') samSetSize(p.size);
    if (typeof p.hardness === 'number') samSetTip('hardness', p.hardness / 100, SAM.tool === 'quickSelect' ? 'quickSelect' : 'brush');   // 目前是快速选择＝改它的，否则改画笔的
    for (const f of ['spacing', 'angle', 'roundness']) if (typeof p[f] === 'number') samSetTip(f, p[f]);
    if (typeof p.spacingEnabled === 'boolean') samSetTip('spacingEnabled', p.spacingEnabled);
    if (SAM_CTLS.includes(p.sizeControl)) samSetTip('sizeControl', SAM.tool === 'quickSelect' && p.sizeControl === 'tilt' ? 'off' : p.sizeControl);
    if (p.objMode === 'rect' || p.objMode === 'lasso') SAM.objMode = p.objMode;
    samOptions();
    return CMD.map['ps.select.selectAndMask.state'].run({});
  });
CMD.reg('ps.select.selectAndMask.preset', {i18n:'', undoable:false,
  params:'{action:"list|save|load|delete", name?, settings?} 选择并遮住的预设（PS 属性面板「预设」下拉）：save＝把工作区目前的设置存成 name（工作区没开可给 settings）；load＝套用（"default"＝默认值、"remembered"＝记住的设置）；delete＝删掉 → {ok, presets…}'},
  p => samPresetOp(p || {}));
if (typeof Lang !== 'undefined') Lang.add({
  'zh-Hant':{'pssel.sam.refineBrush':'調整邊緣筆刷工具', 'pssel.sam.brush':'筆刷工具', 'pssel.sam.add':'增加至選取範圍', 'pssel.sam.sub':'從選取範圍中減去', 'pssel.sam.size':'大小',
    'pssel.sam.subject':'選取主體', 'pssel.sam.refineHair':'調整毛髮', 'pssel.sam.viewMode':'檢視模式', 'pssel.sam.view':'檢視',
    'pssel.sam.v.onionSkin':'描圖紙', 'pssel.sam.v.marchingAnts':'動態虛線', 'pssel.sam.v.overlay':'覆蓋', 'pssel.sam.v.onBlack':'黑底', 'pssel.sam.v.onWhite':'白底', 'pssel.sam.v.blackWhite':'黑白', 'pssel.sam.v.onLayers':'圖層上',
    'pssel.sam.showEdge':'顯示邊緣', 'pssel.sam.showOriginal':'顯示原始', 'pssel.sam.realtime':'即時調整', 'pssel.sam.hq':'高品質預視', 'pssel.sam.opacity':'不透明度', 'pssel.sam.color':'顏色',
    'pssel.sam.indicates':'指示', 'pssel.sam.masked':'遮色區域', 'pssel.sam.selected':'選取區域', 'pssel.sam.remember':'記住設定', 'pssel.sam.refineModeL':'調整模式',
    'pssel.sam.colorAware':'色彩感知', 'pssel.sam.objectAware':'物件感知', 'pssel.sam.clearSel':'清除選取範圍', 'pssel.sam.invert':'反轉', 'pssel.sam.reset':'重設工作區',
    'pssel.sam.out.selection':'選取範圍', 'pssel.sam.out.layerMask':'圖層遮色片', 'pssel.sam.out.newLayer':'新增圖層', 'pssel.sam.out.newLayerWithMask':'新增含圖層遮色片的圖層',
    'pssel.sam.out.newDocument':'新增文件', 'pssel.sam.out.newDocumentWithMask':'新增含圖層遮色片的文件',
    'pssel.sam.t.quickSelect':'快速選取工具', 'pssel.sam.t.refine':'調整邊緣筆刷工具', 'pssel.sam.t.brush':'筆刷工具', 'pssel.sam.t.objectSelect':'物件選取工具', 'pssel.sam.t.lasso':'套索工具', 'pssel.sam.t.hand':'手形工具', 'pssel.sam.t.zoom':'縮放顯示工具',
    'pssel.sam.hardness':'硬度', 'pssel.sam.objMode':'模式', 'pssel.sam.objRect':'矩形', 'pssel.sam.objLasso':'套索', 'pssel.sam.zoomIn':'放大', 'pssel.sam.zoomOut':'縮小', 'pssel.sam.fit':'適合螢幕',
    'pssel.sam.preset':'預設集', 'pssel.sam.pDefault':'預設', 'pssel.sam.pRemembered':'記住的設定', 'pssel.sam.pSave':'儲存預設集…', 'pssel.sam.pDelete':'刪除預設集', 'pssel.sam.pName':'預設集名稱',
    'pssel.sam.pSaveT':'儲存預設集', 'pssel.sam.pNameDef':'預設集', 'pssel.sam.t.polyLasso':'多邊形套索工具', 'pssel.sam.tip':'筆刷設定', 'pssel.sam.spacing':'間距', 'pssel.sam.angle':'角度', 'pssel.sam.roundness':'圓度', 'pssel.sam.sizeCtl':'尺寸', 'pssel.sam.ctlOff':'關', 'pssel.sam.ctlPen':'筆的壓力', 'pssel.sam.ctlTilt':'筆的傾斜', 'pssel.sam.ctlWheel':'光筆滾輪'},
  'zh-Hans':{'pssel.sam.refineBrush':'调整边缘画笔工具', 'pssel.sam.brush':'画笔工具', 'pssel.sam.add':'添加到选区', 'pssel.sam.sub':'从选区减去', 'pssel.sam.size':'大小',
    'pssel.sam.subject':'选择主体', 'pssel.sam.refineHair':'调整细线', 'pssel.sam.viewMode':'视图模式', 'pssel.sam.view':'视图',
    'pssel.sam.v.onionSkin':'洋葱皮', 'pssel.sam.v.marchingAnts':'闪烁虚线', 'pssel.sam.v.overlay':'叠加', 'pssel.sam.v.onBlack':'黑底', 'pssel.sam.v.onWhite':'白底', 'pssel.sam.v.blackWhite':'黑白', 'pssel.sam.v.onLayers':'图层',
    'pssel.sam.showEdge':'显示边缘', 'pssel.sam.showOriginal':'显示原稿', 'pssel.sam.realtime':'实时调整', 'pssel.sam.hq':'高品质预览', 'pssel.sam.opacity':'不透明度', 'pssel.sam.color':'颜色',
    'pssel.sam.indicates':'表示', 'pssel.sam.masked':'被蒙版区域', 'pssel.sam.selected':'所选区域', 'pssel.sam.remember':'记住设置', 'pssel.sam.refineModeL':'调整模式',
    'pssel.sam.colorAware':'颜色识别', 'pssel.sam.objectAware':'对象识别', 'pssel.sam.clearSel':'清除选区', 'pssel.sam.invert':'反相', 'pssel.sam.reset':'复位工作区',
    'pssel.sam.out.selection':'选区', 'pssel.sam.out.layerMask':'图层蒙版', 'pssel.sam.out.newLayer':'新建图层', 'pssel.sam.out.newLayerWithMask':'新建带有图层蒙版的图层',
    'pssel.sam.out.newDocument':'新建文档', 'pssel.sam.out.newDocumentWithMask':'新建带有图层蒙版的文档',
    'pssel.sam.t.quickSelect':'快速选择工具', 'pssel.sam.t.refine':'调整边缘画笔工具', 'pssel.sam.t.brush':'画笔工具', 'pssel.sam.t.objectSelect':'对象选择工具', 'pssel.sam.t.lasso':'套索工具', 'pssel.sam.t.hand':'抓手工具', 'pssel.sam.t.zoom':'缩放工具',
    'pssel.sam.hardness':'硬度', 'pssel.sam.objMode':'模式', 'pssel.sam.objRect':'矩形', 'pssel.sam.objLasso':'套索', 'pssel.sam.zoomIn':'放大', 'pssel.sam.zoomOut':'缩小', 'pssel.sam.fit':'适合屏幕',
    'pssel.sam.preset':'预设', 'pssel.sam.pDefault':'默认值', 'pssel.sam.pRemembered':'记住的设置', 'pssel.sam.pSave':'存储预设…', 'pssel.sam.pDelete':'删除预设', 'pssel.sam.pName':'预设名称',
    'pssel.sam.pSaveT':'存储预设', 'pssel.sam.pNameDef':'预设', 'pssel.sam.t.polyLasso':'多边形套索工具', 'pssel.sam.tip':'画笔设置', 'pssel.sam.spacing':'间距', 'pssel.sam.angle':'角度', 'pssel.sam.roundness':'圆度', 'pssel.sam.sizeCtl':'大小', 'pssel.sam.ctlOff':'关', 'pssel.sam.ctlPen':'钢笔压力', 'pssel.sam.ctlTilt':'钢笔斜度', 'pssel.sam.ctlWheel':'光笔轮'},
  en:{'pssel.sam.refineBrush':'Refine Edge Brush Tool', 'pssel.sam.brush':'Brush Tool', 'pssel.sam.add':'Add to selection', 'pssel.sam.sub':'Subtract from selection', 'pssel.sam.size':'Size',
    'pssel.sam.subject':'Select Subject', 'pssel.sam.refineHair':'Refine Hair', 'pssel.sam.viewMode':'View Mode', 'pssel.sam.view':'View',
    'pssel.sam.v.onionSkin':'Onion Skin', 'pssel.sam.v.marchingAnts':'Marching Ants', 'pssel.sam.v.overlay':'Overlay', 'pssel.sam.v.onBlack':'On Black', 'pssel.sam.v.onWhite':'On White', 'pssel.sam.v.blackWhite':'Black & White', 'pssel.sam.v.onLayers':'On Layers',
    'pssel.sam.showEdge':'Show Edge', 'pssel.sam.showOriginal':'Show Original', 'pssel.sam.realtime':'Real-Time Refinement', 'pssel.sam.hq':'High Quality Preview', 'pssel.sam.opacity':'Opacity', 'pssel.sam.color':'Color',
    'pssel.sam.indicates':'Indicates', 'pssel.sam.masked':'Masked Areas', 'pssel.sam.selected':'Selected Areas', 'pssel.sam.remember':'Remember Settings', 'pssel.sam.refineModeL':'Refine Mode',
    'pssel.sam.colorAware':'Color Aware', 'pssel.sam.objectAware':'Object Aware', 'pssel.sam.clearSel':'Clear Selection', 'pssel.sam.invert':'Invert', 'pssel.sam.reset':'Reset the Workspace',
    'pssel.sam.out.selection':'Selection', 'pssel.sam.out.layerMask':'Layer Mask', 'pssel.sam.out.newLayer':'New Layer', 'pssel.sam.out.newLayerWithMask':'New Layer with Layer Mask',
    'pssel.sam.out.newDocument':'New Document', 'pssel.sam.out.newDocumentWithMask':'New Document with Layer Mask',
    'pssel.sam.t.quickSelect':'Quick Selection Tool', 'pssel.sam.t.refine':'Refine Edge Brush Tool', 'pssel.sam.t.brush':'Brush Tool', 'pssel.sam.t.objectSelect':'Object Selection Tool', 'pssel.sam.t.lasso':'Lasso Tool', 'pssel.sam.t.hand':'Hand Tool', 'pssel.sam.t.zoom':'Zoom Tool',
    'pssel.sam.hardness':'Hardness', 'pssel.sam.objMode':'Mode', 'pssel.sam.objRect':'Rectangle', 'pssel.sam.objLasso':'Lasso', 'pssel.sam.zoomIn':'Zoom In', 'pssel.sam.zoomOut':'Zoom Out', 'pssel.sam.fit':'Fit Screen',
    'pssel.sam.preset':'Preset', 'pssel.sam.pDefault':'Default', 'pssel.sam.pRemembered':'Remembered Settings', 'pssel.sam.pSave':'Save Preset…', 'pssel.sam.pDelete':'Delete Preset', 'pssel.sam.pName':'Preset name',
    'pssel.sam.pSaveT':'Save Preset', 'pssel.sam.pNameDef':'Preset', 'pssel.sam.t.polyLasso':'Polygonal Lasso Tool', 'pssel.sam.tip':'Brush Settings', 'pssel.sam.spacing':'Spacing', 'pssel.sam.angle':'Angle', 'pssel.sam.roundness':'Roundness', 'pssel.sam.sizeCtl':'Size', 'pssel.sam.ctlOff':'Off', 'pssel.sam.ctlPen':'Pen Pressure', 'pssel.sam.ctlTilt':'Pen Tilt', 'pssel.sam.ctlWheel':'Stylus Wheel'}});

/* ── 存储选区（view_cmds.rs:943-947：channel=new|已有、name、operation） ── */
CMD.reg('ps.select.saveSelection.dialog', {i18n:'', undoable:false,
  params:'{} 打开「存储选区」对话框（通道：新建／已有 Alpha、名称、操作：新建／替换／添加／减去／交叉）；确定＝跑 ps.select.saveSelection。没有选区＝不开'},
  () => {
    if (!hasSel()) return fail('no selection');
    let ops = null;
    openDialog({cmd:'ps.select.saveSelection', title:T('save.title'), build(col){
      const fs = el('fieldset'); fs.appendChild(el('legend', '', T('save.dest')));
      const ch = selectRow(fs, T('channel'), 'channel', [['new', T('new')]].concat(channels().map((c, i) => [String(i), c.name])), 'new');
      const nr = el('div', 'row'), nm = document.createElement('input'); nm.type = 'text'; nm.dataset.k = 'name';
      nr.append(el('label', 'l', T('name')), nm); fs.appendChild(nr); col.appendChild(fs);
      ops = radioGroup(col, T('operation'), 'operation', [['new', T('save.new')], ['replace', T('save.replace')], ['add', T('save.add')], ['subtract', T('save.sub')], ['intersect', T('save.int')]], 'new');
      const sync = () => {                                                  // 新建通道只能「新建」；存到已有通道才有另外四种
        const isNew = ch.value === 'new';
        ops.inputs.forEach(i => { const off = isNew ? i.value !== 'new' : i.value === 'new'; i.disabled = off; i.parentNode.classList.toggle('dis', off); });
        const cur = ops.value();
        if (isNew) ops.inputs.find(i => i.value === 'new').checked = true;
        else if (cur === 'new') ops.inputs.find(i => i.value === 'replace').checked = true;
      };
      ch.onchange = sync; sync();
    }, ok(){
      const R = DLG.root, cv = R.querySelector('[data-k="channel"]').value, name = R.querySelector('[data-k="name"]').value;
      const p = {channel:cv === 'new' ? 'new' : +cv, operation:ops.value()};
      if (name.trim()) p.name = name.trim();
      return CMD.run('ps.select.saveSelection', p);
    }});
    return {ok:true, dialog:'ps.select.saveSelection'};
  });

/* ── 载入选区（view_cmds.rs:948-954：channel、invert、operation） ── */
function loadChoices(){
  const L = Doc.active(), out = channels().map((c, i) => [String(i), c.name]);
  out.push(['composite', 'RGB'], ['red', T('ch.red')], ['green', T('ch.green')], ['blue', T('ch.blue')]);
  if (L) out.push(['transparency', T('ch.transparency').replace('{layer}', L.name)]);
  if (L && L.mask) out.push(['mask', T('ch.mask')]);
  if (qmLayer()) out.push(['quickMask', T('ch.quickMask')]);
  if (Doc.sel) out.push(['selection', T('ch.selection')]);
  return out;
}
CMD.reg('ps.select.loadSelection.dialog', {i18n:'', undoable:false,
  params:'{} 打开「载入选区」对话框（通道：Alpha 通道／RGB／红绿蓝／当前层透明度／图层蒙版／快速蒙版／选区，反相，操作：新建／添加／减去／交叉）；确定＝跑 ps.select.loadSelection'},
  () => {
    let ops = null;
    const choices = loadChoices();
    openDialog({cmd:'ps.select.loadSelection', title:T('load.title'), build(col){
      const fs = el('fieldset'); fs.appendChild(el('legend', '', T('load.src')));
      selectRow(fs, T('channel'), 'channel', choices, choices[0][0]);
      checkRow(fs, T('invert'), 'invert', false);
      col.appendChild(fs);
      ops = radioGroup(col, T('operation'), 'operation', [['new', T('load.new')], ['add', T('load.add')], ['subtract', T('load.sub')], ['intersect', T('load.int')]], 'new');
      if (!Doc.sel) ops.inputs.forEach(i => { if (i.value !== 'new'){ i.disabled = true; i.parentNode.classList.add('dis'); } });   // 没选区时 PS 只给「新建选区」
    }, ok(){
      const R = DLG.root, v = R.querySelector('[data-k="channel"]').value;
      return CMD.run('ps.select.loadSelection', {channel:/^\d+$/.test(v) ? +v : v, invert:R.querySelector('[data-k="invert"]').checked, operation:ops.value()});
    }});
    return {ok:true, dialog:'ps.select.loadSelection'};
  });

/* ═══════════ 画面：快速蒙版的红色、非选取工具时的选区边界 ═══════════ */
let qmCanvas = null;
function drawQuickMask(ctx, L, s){
  const w = W(), h = H();
  if (!qmCanvas) qmCanvas = document.createElement('canvas');
  if (qmCanvas.width !== w || qmCanvas.height !== h){ qmCanvas.width = w; qmCanvas.height = h; }
  const x = qmCanvas.getContext('2d'), img = x.createImageData(w, h), d = img.data, g = layerGray(L);
  for (let i = 0; i < g.length; i++){ d[i * 4] = 255; d[i * 4 + 3] = Math.round(0.5 * 255 * (1 - g[i])); }   // PS 预设：遮住的地方 50% 红
  x.putImageData(img, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = s < 1; ctx.drawImage(qmCanvas, 0, 0, w * s, h * s); ctx.restore();
}
const SEL_TOOLS = ['marquee', 'lasso', 'wand'];                 // 这三颗自己会画遮罩选区的边界
function drawExtras(){
  if (!window.UI || !UI.ctx) return;
  const ctx = UI.octx || UI.ctx, dpr = Math.min(window.devicePixelRatio || 1, 2), s = UI.zoom * dpr;
  const L = qmLayer(); if (L) drawQuickMask(ctx, L, s);
  if (CR_LIVE && CR_LIVE.canvas.width === W() && CR_LIVE.canvas.height === H()){             // 色彩范围的「选区预览」
    ctx.save(); ctx.imageSmoothingEnabled = s < 1; ctx.drawImage(CR_LIVE.canvas, 0, 0, W() * s, H() * s); ctx.restore();
    return;                                                                                  // 预览时不画蚂蚁线（PS 同）
  }
  const sel = Doc.sel;
  // 选择并遮住工作区开着：只有「闪烁虚线」视图才画蚂蚁线（PS 同；其他视图看预览本身，拖动中也省掉整圈轮廓重算）
  const samNoAnts = SAM && SAM.dlg && (q => q && q.value !== 'marchingAnts')(SAM.dlg.root.querySelector('[data-k="view"]'));
  if (sel && sel.mask && window.SelMask && !SEL_TOOLS.includes(ToolState.cur) && !(window.QuickSelectTool&&QuickSelectTool.live) && !samNoAnts){
    const sc = p => [Math.round(p[0] * s) + 0.5, Math.round(p[1] * s) + 0.5];
    ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
    SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
    ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.restore();
  }
}
/* 隔离图层：图层面板只留被隔离的那几列（ui.js drawLayerList 是由上到下画 [...Doc.layers].reverse()） */
function filterLayerList(){
  const ids = isolated(); if (!ids.length) return;
  const live = ids.filter(id => Doc.byId(id)); if (!live.length){ ISO.ids = []; return; }
  const rows = document.querySelectorAll('#layerList .lrow'), order = [...Doc.layers].reverse();
  rows.forEach((r, i) => { const L = order[i]; if (L && !live.includes(L.id)) r.style.display = 'none'; });
}
/* 挂在 UI 上（不改 ui.js：包一层；之后可改成 ui.js 里正式的挂点） */
function hookUI(){
  if (!window.UI || UI.__psSelectHook) return;
  UI.__psSelectHook = true;
  const draw = UI.draw, list = UI.drawLayerList;
  UI.draw = function(){ const r = draw.apply(this, arguments); try { drawExtras(); } catch(e){ console.error(e); } return r; };
  UI.drawLayerList = function(){ const r = list.apply(this, arguments); try { filterLayerList(); } catch(e){ console.error(e); } return r; };
}
if (window.UI) hookUI(); else window.addEventListener('DOMContentLoaded', hookUI);

/* ═══════════ 快捷键：菜单上标的键（menubar.js 不分派键盘；ui.js 把 Ctrl+Shift+D 也当成 Ctrl+D ⇒ 在 window 捕获阶段先接） ═══════════ */
const typing = t => !!t && (t.isContentEditable || /^(input|select|textarea)$/i.test(t.tagName));
window.addEventListener('keydown', e => {
  if (DLG || typing(e.target)) return;
  if (!(window.Menubar && Menubar.app === 'ps')) return;                  // 只在 PS 菜单（像素／文字层）时
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  let cmd = null;
  if (ctrl && e.shiftKey && !e.altKey && k === 'd') cmd = 'ps.select.reselect';
  else if (!ctrl && e.shiftKey && !e.altKey && e.key === 'F6') cmd = 'ps.select.modify.feather.dialog';
  else if (ctrl && e.altKey && e.shiftKey && k === 'f') cmd = 'ps.select.findLayers.dialog';
  else if (!ctrl && !e.altKey && !e.shiftKey && k === 'q') cmd = 'ps.select.editInQuickMaskMode';
  if (!cmd) return;
  e.preventDefault(); e.stopPropagation();
  try { CMD.run(cmd); } catch(err){ console.error(err); }
  redraw();
}, true);

/* ═══════════ 三语 ═══════════ */
const STRINGS = {
  'zh-Hant':{
    'pssel.preview':'預視', 'pssel.fa.title':'焦點區域', 'pssel.fa.range':'焦點內範圍', 'pssel.fa.noise':'影像雜訊層級', 'pssel.fa.none':'找不到對焦清楚的區域',
    'pssel.shapeName':'形狀', 'pssel.sam.title':'選取並遮住', 'pssel.sam.edge':'邊緣偵測', 'pssel.sam.radius':'半徑', 'pssel.sam.smart':'智慧型半徑', 'pssel.sam.global':'全域調整', 'pssel.sam.smooth':'平滑', 'pssel.sam.feather':'羽化', 'pssel.sam.contrast':'對比', 'pssel.sam.shift':'移動邊緣', 'pssel.sam.out':'輸出設定', 'pssel.sam.decon':'淨化顏色', 'pssel.sam.amount':'總量', 'pssel.sam.outTo':'輸出至', 'pssel.sam.outSel':'選取範圍', 'pssel.sam.outLayer':'新增圖層', 'pssel.sam.all':'取樣全部圖層',
    'pssel.ok':'確定', 'pssel.cancel':'取消', 'pssel.px':'像素', 'pssel.badNumber':'請輸入數字', 'pssel.name':'名稱', 'pssel.channel':'色版',
    'pssel.new':'新增', 'pssel.operation':'操作', 'pssel.invert':'負片效果', 'pssel.qmLayer':'快速遮色片', 'pssel.find':'尋找圖層',
    'pssel.mod.border':'邊界選取範圍', 'pssel.mod.border.r':'寬度', 'pssel.mod.smooth':'平滑選取範圍', 'pssel.mod.smooth.r':'取樣強度',
    'pssel.mod.expand':'擴張選取範圍', 'pssel.mod.expand.r':'擴張', 'pssel.mod.contract':'縮減選取範圍', 'pssel.mod.contract.r':'縮減',
    'pssel.mod.feather':'羽化選取範圍', 'pssel.mod.feather.r':'羽化強度',
    'pssel.cr.title':'顏色範圍', 'pssel.cr.select':'選取', 'pssel.cr.sampledColors':'取樣的顏色', 'pssel.cr.reds':'紅色', 'pssel.cr.yellows':'黃色',
    'pssel.cr.greens':'綠色', 'pssel.cr.cyans':'青色', 'pssel.cr.blues':'藍色', 'pssel.cr.magentas':'洋紅', 'pssel.cr.highlights':'亮部',
    'pssel.cr.midtones':'中間調', 'pssel.cr.shadows':'陰影', 'pssel.cr.localized':'當地化顏色叢集', 'pssel.cr.fuzziness':'朦朧', 'pssel.cr.range':'範圍',
    'pssel.cr.shadowsTo':'陰影上限', 'pssel.cr.highlightsFrom':'亮部下限', 'pssel.cr.midFrom':'中間調起點', 'pssel.cr.midTo':'中間調終點',
    'pssel.cr.preview':'顏色範圍預視（在這裡或直接在影像上點按取樣：Shift 增加、Alt 減去）', 'pssel.cr.eye':'滴管', 'pssel.cr.eyeAdd':'增加至樣本', 'pssel.cr.eyeSub':'從樣本中減去',
    'pssel.cr.sampleFg':'樣本：前景色', 'pssel.cr.samples':'{n} 個樣本', 'pssel.cr.samplesSub':'{n} 個樣本、減去 {m} 個', 'pssel.cr.clear':'清除樣本',
    'pssel.cr.invert':'負片效果', 'pssel.cr.view':'預視', 'pssel.cr.viewSel':'選取範圍', 'pssel.cr.viewImg':'影像', 'pssel.cr.previewErr':'無法預視：', 'pssel.cr.docPreview':'選取範圍預視', 'pssel.cr.dp.none':'無', 'pssel.cr.dp.grayscale':'灰階', 'pssel.cr.dp.blackMatte':'黑色邊緣調合', 'pssel.cr.dp.whiteMatte':'白色邊緣調合', 'pssel.cr.dp.quickMask':'快速遮色片', 'pssel.mod.atBounds':'套用版面邊界的效果',
    'pssel.tf.title':'變形選取範圍', 'pssel.tf.dx':'水平移動', 'pssel.tf.dy':'垂直移動', 'pssel.tf.sx':'寬度', 'pssel.tf.sy':'高度', 'pssel.tf.rot':'旋轉',
    'pssel.tf.kx':'水平傾斜', 'pssel.tf.ky':'垂直傾斜', 'pssel.tf.ref':'參考點', 'pssel.tf.interp':'內插補點', 'pssel.tf.note':'只變形選取範圍的外框，不動像素；邊改邊在畫面上預視。',
    'pssel.ref.center':'中心', 'pssel.ref.topLeft':'左上', 'pssel.ref.top':'上', 'pssel.ref.topRight':'右上', 'pssel.ref.left':'左', 'pssel.ref.right':'右',
    'pssel.ref.bottomLeft':'左下', 'pssel.ref.bottom':'下', 'pssel.ref.bottomRight':'右下',
    'pssel.ip.bilinear':'縱橫增值', 'pssel.ip.bicubic':'環迴增值', 'pssel.ip.nearest':'最接近像素',
    'pssel.save.title':'儲存選取範圍', 'pssel.save.dest':'目的地', 'pssel.save.new':'新增色版', 'pssel.save.replace':'取代色版', 'pssel.save.add':'增加至色版',
    'pssel.save.sub':'從色版中減去', 'pssel.save.int':'與色版相交',
    'pssel.load.title':'載入選取範圍', 'pssel.load.src':'來源', 'pssel.load.new':'新增選取範圍', 'pssel.load.add':'增加至選取範圍', 'pssel.load.sub':'從選取範圍中減去', 'pssel.load.int':'與選取範圍相交',
    'pssel.ch.red':'紅', 'pssel.ch.green':'綠', 'pssel.ch.blue':'藍', 'pssel.ch.transparency':'{layer} 透明', 'pssel.ch.mask':'圖層遮色片', 'pssel.ch.quickMask':'快速遮色片', 'pssel.ch.selection':'選取範圍'},
  'zh-Hans':{
    'pssel.preview':'预览', 'pssel.fa.title':'焦点区域', 'pssel.fa.range':'焦点对准范围', 'pssel.fa.noise':'图像杂色级别', 'pssel.fa.none':'没有找到对焦清楚的区域',
    'pssel.shapeName':'形状', 'pssel.sam.title':'选择并遮住', 'pssel.sam.edge':'边缘检测', 'pssel.sam.radius':'半径', 'pssel.sam.smart':'智能半径', 'pssel.sam.global':'全局调整', 'pssel.sam.smooth':'平滑', 'pssel.sam.feather':'羽化', 'pssel.sam.contrast':'对比度', 'pssel.sam.shift':'移动边缘', 'pssel.sam.out':'输出设置', 'pssel.sam.decon':'净化颜色', 'pssel.sam.amount':'数量', 'pssel.sam.outTo':'输出到', 'pssel.sam.outSel':'选区', 'pssel.sam.outLayer':'新建图层', 'pssel.sam.all':'对所有图层取样',
    'pssel.ok':'确定', 'pssel.cancel':'取消', 'pssel.px':'像素', 'pssel.badNumber':'请输入数字', 'pssel.name':'名称', 'pssel.channel':'通道',
    'pssel.new':'新建', 'pssel.operation':'操作', 'pssel.invert':'反相', 'pssel.qmLayer':'快速蒙版', 'pssel.find':'查找图层',
    'pssel.mod.border':'边界选区', 'pssel.mod.border.r':'宽度', 'pssel.mod.smooth':'平滑选区', 'pssel.mod.smooth.r':'取样半径',
    'pssel.mod.expand':'扩展选区', 'pssel.mod.expand.r':'扩展量', 'pssel.mod.contract':'收缩选区', 'pssel.mod.contract.r':'收缩量',
    'pssel.mod.feather':'羽化选区', 'pssel.mod.feather.r':'羽化半径',
    'pssel.cr.title':'色彩范围', 'pssel.cr.select':'选择', 'pssel.cr.sampledColors':'取样颜色', 'pssel.cr.reds':'红色', 'pssel.cr.yellows':'黄色',
    'pssel.cr.greens':'绿色', 'pssel.cr.cyans':'青色', 'pssel.cr.blues':'蓝色', 'pssel.cr.magentas':'洋红', 'pssel.cr.highlights':'高光',
    'pssel.cr.midtones':'中间调', 'pssel.cr.shadows':'阴影', 'pssel.cr.localized':'本地化颜色簇', 'pssel.cr.fuzziness':'颜色容差', 'pssel.cr.range':'范围',
    'pssel.cr.shadowsTo':'阴影上限', 'pssel.cr.highlightsFrom':'高光下限', 'pssel.cr.midFrom':'中间调起点', 'pssel.cr.midTo':'中间调终点',
    'pssel.cr.preview':'色彩范围预览（在这里或直接在图像上单击取样：Shift 添加、Alt 减去）', 'pssel.cr.eye':'吸管工具', 'pssel.cr.eyeAdd':'添加到取样', 'pssel.cr.eyeSub':'从取样中减去',
    'pssel.cr.sampleFg':'取样：前景色', 'pssel.cr.samples':'{n} 个取样', 'pssel.cr.samplesSub':'{n} 个取样、减去 {m} 个', 'pssel.cr.clear':'清除取样',
    'pssel.cr.invert':'反相', 'pssel.cr.view':'预览', 'pssel.cr.viewSel':'选择范围', 'pssel.cr.viewImg':'图像', 'pssel.cr.previewErr':'无法预览：', 'pssel.cr.docPreview':'选区预览', 'pssel.cr.dp.none':'无', 'pssel.cr.dp.grayscale':'灰度', 'pssel.cr.dp.blackMatte':'黑色杂边', 'pssel.cr.dp.whiteMatte':'白色杂边', 'pssel.cr.dp.quickMask':'快速蒙版', 'pssel.mod.atBounds':'应用画布边界的效果',
    'pssel.tf.title':'变换选区', 'pssel.tf.dx':'水平移动', 'pssel.tf.dy':'垂直移动', 'pssel.tf.sx':'宽度', 'pssel.tf.sy':'高度', 'pssel.tf.rot':'旋转',
    'pssel.tf.kx':'水平斜切', 'pssel.tf.ky':'垂直斜切', 'pssel.tf.ref':'参考点', 'pssel.tf.interp':'插值', 'pssel.tf.note':'只变换选区的轮廓，不动像素；改的同时画布上预览。',
    'pssel.ref.center':'中心', 'pssel.ref.topLeft':'左上', 'pssel.ref.top':'上', 'pssel.ref.topRight':'右上', 'pssel.ref.left':'左', 'pssel.ref.right':'右',
    'pssel.ref.bottomLeft':'左下', 'pssel.ref.bottom':'下', 'pssel.ref.bottomRight':'右下',
    'pssel.ip.bilinear':'两次线性', 'pssel.ip.bicubic':'两次立方', 'pssel.ip.nearest':'邻近',
    'pssel.save.title':'存储选区', 'pssel.save.dest':'目标', 'pssel.save.new':'新建通道', 'pssel.save.replace':'替换通道', 'pssel.save.add':'添加到通道',
    'pssel.save.sub':'从通道中减去', 'pssel.save.int':'与通道交叉',
    'pssel.load.title':'载入选区', 'pssel.load.src':'源', 'pssel.load.new':'新建选区', 'pssel.load.add':'添加到选区', 'pssel.load.sub':'从选区中减去', 'pssel.load.int':'与选区交叉',
    'pssel.ch.red':'红', 'pssel.ch.green':'绿', 'pssel.ch.blue':'蓝', 'pssel.ch.transparency':'{layer} 透明', 'pssel.ch.mask':'图层蒙版', 'pssel.ch.quickMask':'快速蒙版', 'pssel.ch.selection':'选区'},
  'en':{
    'pssel.preview':'Preview', 'pssel.fa.title':'Focus Area', 'pssel.fa.range':'In-Focus Range', 'pssel.fa.noise':'Image Noise Level', 'pssel.fa.none':'No in-focus area found',
    'pssel.shapeName':'Shape', 'pssel.sam.title':'Select and Mask', 'pssel.sam.edge':'Edge Detection', 'pssel.sam.radius':'Radius', 'pssel.sam.smart':'Smart Radius', 'pssel.sam.global':'Global Refinements', 'pssel.sam.smooth':'Smooth', 'pssel.sam.feather':'Feather', 'pssel.sam.contrast':'Contrast', 'pssel.sam.shift':'Shift Edge', 'pssel.sam.out':'Output Settings', 'pssel.sam.decon':'Decontaminate Colors', 'pssel.sam.amount':'Amount', 'pssel.sam.outTo':'Output To', 'pssel.sam.outSel':'Selection', 'pssel.sam.outLayer':'New Layer', 'pssel.sam.all':'Sample All Layers',
    'pssel.ok':'OK', 'pssel.cancel':'Cancel', 'pssel.px':'pixels', 'pssel.badNumber':'Enter a number', 'pssel.name':'Name', 'pssel.channel':'Channel',
    'pssel.new':'New', 'pssel.operation':'Operation', 'pssel.invert':'Invert', 'pssel.qmLayer':'Quick Mask', 'pssel.find':'Find Layers',
    'pssel.mod.border':'Border Selection', 'pssel.mod.border.r':'Width', 'pssel.mod.smooth':'Smooth Selection', 'pssel.mod.smooth.r':'Sample Radius',
    'pssel.mod.expand':'Expand Selection', 'pssel.mod.expand.r':'Expand By', 'pssel.mod.contract':'Contract Selection', 'pssel.mod.contract.r':'Contract By',
    'pssel.mod.feather':'Feather Selection', 'pssel.mod.feather.r':'Feather Radius',
    'pssel.cr.title':'Color Range', 'pssel.cr.select':'Select', 'pssel.cr.sampledColors':'Sampled Colors', 'pssel.cr.reds':'Reds', 'pssel.cr.yellows':'Yellows',
    'pssel.cr.greens':'Greens', 'pssel.cr.cyans':'Cyans', 'pssel.cr.blues':'Blues', 'pssel.cr.magentas':'Magentas', 'pssel.cr.highlights':'Highlights',
    'pssel.cr.midtones':'Midtones', 'pssel.cr.shadows':'Shadows', 'pssel.cr.localized':'Localized Color Clusters', 'pssel.cr.fuzziness':'Fuzziness', 'pssel.cr.range':'Range',
    'pssel.cr.shadowsTo':'Shadows up to', 'pssel.cr.highlightsFrom':'Highlights from', 'pssel.cr.midFrom':'Midtones from', 'pssel.cr.midTo':'Midtones to',
    'pssel.cr.preview':'Color Range preview (click here or on the image to sample: Shift adds, Alt subtracts)', 'pssel.cr.eye':'Eyedropper', 'pssel.cr.eyeAdd':'Add to Sample', 'pssel.cr.eyeSub':'Subtract from Sample',
    'pssel.cr.sampleFg':'Sample: foreground colour', 'pssel.cr.samples':'{n} samples', 'pssel.cr.samplesSub':'{n} samples, {m} subtracted', 'pssel.cr.clear':'Clear Samples',
    'pssel.cr.invert':'Invert', 'pssel.cr.view':'Preview', 'pssel.cr.viewSel':'Selection', 'pssel.cr.viewImg':'Image', 'pssel.cr.previewErr':'Preview unavailable: ', 'pssel.cr.docPreview':'Selection Preview', 'pssel.cr.dp.none':'None', 'pssel.cr.dp.grayscale':'Grayscale', 'pssel.cr.dp.blackMatte':'Black Matte', 'pssel.cr.dp.whiteMatte':'White Matte', 'pssel.cr.dp.quickMask':'Quick Mask', 'pssel.mod.atBounds':'Apply effect at canvas bounds',
    'pssel.tf.title':'Transform Selection', 'pssel.tf.dx':'Move X', 'pssel.tf.dy':'Move Y', 'pssel.tf.sx':'Width', 'pssel.tf.sy':'Height', 'pssel.tf.rot':'Rotate',
    'pssel.tf.kx':'Horizontal Skew', 'pssel.tf.ky':'Vertical Skew', 'pssel.tf.ref':'Reference Point', 'pssel.tf.interp':'Interpolation', 'pssel.tf.note':'Transforms the selection outline only (not pixels); previews on the canvas as you type.',
    'pssel.ref.center':'Center', 'pssel.ref.topLeft':'Top Left', 'pssel.ref.top':'Top', 'pssel.ref.topRight':'Top Right', 'pssel.ref.left':'Left', 'pssel.ref.right':'Right',
    'pssel.ref.bottomLeft':'Bottom Left', 'pssel.ref.bottom':'Bottom', 'pssel.ref.bottomRight':'Bottom Right',
    'pssel.ip.bilinear':'Bilinear', 'pssel.ip.bicubic':'Bicubic', 'pssel.ip.nearest':'Nearest Neighbor',
    'pssel.save.title':'Save Selection', 'pssel.save.dest':'Destination', 'pssel.save.new':'New Channel', 'pssel.save.replace':'Replace Channel', 'pssel.save.add':'Add to Channel',
    'pssel.save.sub':'Subtract from Channel', 'pssel.save.int':'Intersect with Channel',
    'pssel.load.title':'Load Selection', 'pssel.load.src':'Source', 'pssel.load.new':'New Selection', 'pssel.load.add':'Add to Selection', 'pssel.load.sub':'Subtract from Selection', 'pssel.load.int':'Intersect with Selection',
    'pssel.ch.red':'Red', 'pssel.ch.green':'Green', 'pssel.ch.blue':'Blue', 'pssel.ch.transparency':'{layer} Transparency', 'pssel.ch.mask':'Layer Mask', 'pssel.ch.quickMask':'Quick Mask', 'pssel.ch.selection':'Selection'}
};
if (typeof Lang !== 'undefined') Lang.add(STRINGS);

})();

/* ═══════════════════════════════════════════════════════════════════════════════
   选择 ▸ 所有图层、选择 ▸ 主体
   对照源（photocraft/crates/…，逐段翻成 JS）：
     engine/src/layer_multi_cmds.rs 36-59, 116-130, 751   set_selection、is_locked_background、select_all_layers（锁住的背景层不选；当前层留着或换成最上面那层；选图层不是编辑、不进历史）
     engine/src/smartselect_cmds.rs 37-71, 122-125, 242    with_sampler（sampleAllLayers 预设 true＝合成图）、apply（没找到又是加／减＝选区不动）、select_subject
     algo/src/segment/subject.rs 1-270     Select Subject：SLIC 超像素 → 背景连通度（测地距离 Dijkstra）＋背景加权对比 → 最小平方显著性最佳化（Gauss–Seidel 200 次）
                                           ＋频率调谐显著性（模糊 Lab 离平均色的距离）→ Otsu 门槛做 GrabCut 三分图 → 清碎块补小洞 → 全解析度沿边重切
     algo/src/segment/slic.rs 1-174        SLIC（CIELAB D65、2S 窗、梯度最低处播种、连通性强制）
     algo/src/segment/grabcut.rs 1-71      GrabCut 迭代（每边 5 个全协方差高斯、γ=50、β 由邻差平均）
     algo/src/segment/gmm.rs 1-254         高斯混合（k-means++ 播种、Lloyd、3 步 EM、refit）
     algo/src/segment/maxflow.rs 1-327     Boykov–Kolmogorov 最大流／最小割
     algo/src/segment/mod.rs 46-638        RgbImage（透明叠中灰、方框缩小）、scale_for、contrast_beta、grid_cut（8 邻、固定点并进端点容量）、data_costs、
                                           components／components4、clean_mask、antialias_u8、trim_region、finish_region／refine_band（192 块＋12 晕边）、Rng、subsample
     algo/src/selection.rs 363-404         combine_region（只动区域外框；全空＝取消选择）
   原码自己写明：PS 用学习模型，它用的是经典演算法（显著性＋GrabCut），这里照抄演算法。
   公开 PsSelect.selectSubject(rgba, W, H) → {mask:Uint8Array(W*H) 0..255, bbox:[x,y,w,h]} | null（图层菜单「蒙版所有对象」共用）。 */
(function(){
'use strict';
const PS = window.PsSelect || (window.PsSelect = {});
if (PS._round3) return;                         // 防双载
PS._round3 = true;
const fail = msg => ({ok:false, error:msg});
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* ═══════════ 选择 ▸ 所有图层（layer_multi_cmds.rs:120 select_all_layers） ═══════════ */
const isLockedBg = L => !!(L && (window.PsLayer && PsLayer.isBackground ? PsLayer.isBackground(L) : L.isBackground));
CMD.reg('ps.select.allLayers', {i18n:'', undoable:false,
  params:'{} 所有图层（Ctrl+Alt+A）：除了锁住的背景层，全部图层选上（写进 Doc.selectedIds，由下到上）；当前层还在里面就留着，否则换成最上面那层；选图层不是编辑、不进历史 → {ok, selected, ids}'},
  () => {
    const ids = Doc.layers.filter(L => !isLockedBg(L)).map(L => L.id);
    if (!ids.length) return fail('there are no layers to select');
    const active = ids.includes(Doc.activeId) ? Doc.activeId : ids[ids.length - 1];
    Doc.selectedIds = ids.slice(); if (!Doc.selectedIds.includes(active)) Doc.selectedIds.push(active);
    Doc.activeId = active;
    return {ok:true, selected:ids.length, ids:ids.slice()};
  });
/* 菜单上标的键 Ctrl+Alt+A（只在 PS 菜单时；打字时不接） */
window.addEventListener('keydown', e => {
  const t = e.target; if (t && (t.isContentEditable || /^(input|select|textarea)$/i.test(t.tagName))) return;
  if (!(window.Menubar && Menubar.app === 'ps') || !(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey || e.key.toLowerCase() !== 'a') return;
  e.preventDefault(); e.stopPropagation();
  try { CMD.run('ps.select.allLayers'); } catch (err){ console.error(err); }
  if (window.UI && UI.refresh) UI.refresh();
}, true);

/* ═══════════ 选择 ▸ 主体 ═══════════ */
const d2 = (a, i, b, j) => { const x = a[i] - b[j], y = a[i + 1] - b[j + 1], z = a[i + 2] - b[j + 2]; return x * x + y * y + z * z; };
/* RgbImage::from_rgba（straight RGBA8 → 0..1，透明叠在中灰上） */
function rgbRect(src, W, x0, y0, w, h){
  const px = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const s = ((y + y0) * W + x + x0) * 4, o = (y * w + x) * 3, a = clamp01(src[s + 3] / 255);
    for (let c = 0; c < 3; c++) px[o + c] = clamp01(src[s + c] / 255) * a + 0.5 * (1 - a);
  }
  return {w, h, px};
}
function downsample(img, step){
  if (step <= 1) return img;
  const ow = Math.ceil(img.w / step), oh = Math.ceil(img.h / step), px = new Float32Array(ow * oh * 3);
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++){
    let a0 = 0, a1 = 0, a2 = 0, n = 0;
    for (let y = oy * step; y < Math.min((oy + 1) * step, img.h); y++) for (let x = ox * step; x < Math.min((ox + 1) * step, img.w); x++){ const i = (y * img.w + x) * 3; a0 += img.px[i]; a1 += img.px[i + 1]; a2 += img.px[i + 2]; n++; }
    const o = (oy * ow + ox) * 3; px[o] = a0 / n; px[o + 1] = a1 / n; px[o + 2] = a2 / n;
  }
  return {w:ow, h:oh, px};
}
const scaleFor = (w, h, maxPx) => Math.max(1, Math.ceil(Math.sqrt(w * h / Math.max(1, maxPx))));
/* slic.rs rgb_to_lab（D65） */
function rgbToLab65(r, g, b, out, o){
  const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B, z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz);
}
/* slic_lab ＋ enforce_connectivity */
function slicLab(lab, w, h, target, compactness, iters){
  const n = w * h, s = Math.max(Math.sqrt(n / Math.max(target, 1)), 1);
  const at = (x, y) => (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * 3;
  const grad = (x, y) => d2(lab, at(Math.max(x - 1, 0), y), lab, at(x + 1, y)) + d2(lab, at(x, Math.max(y - 1, 0)), lab, at(x, y + 1));
  const C = [];
  for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s){
    const cx = Math.floor(x), cy = Math.floor(y); let bx = cx, by = cy, bg = Infinity;
    for (let yy = Math.max(cy - 1, 0); yy <= Math.min(cy + 1, h - 1); yy++) for (let xx = Math.max(cx - 1, 0); xx <= Math.min(cx + 1, w - 1); xx++){ const g = grad(xx, yy); if (g < bg){ bx = xx; by = yy; bg = g; } }
    const i = (by * w + bx) * 3; C.push([lab[i], lab[i + 1], lab[i + 2], bx, by]);
  }
  const labels = new Int32Array(n).fill(-1), dist = new Float64Array(n), wxy = (compactness / s) ** 2, r = Math.ceil(s);
  for (let it = 0; it < Math.max(iters, 1); it++){
    dist.fill(Infinity);
    C.forEach((c, k) => {
      const cx = Math.round(c[3]), cy = Math.round(c[4]);
      for (let yy = Math.max(cy - r, 0); yy < Math.min(cy + r + 1, h); yy++) for (let xx = Math.max(cx - r, 0); xx < Math.min(cx + r + 1, w); xx++){
        const i = yy * w + xx, dl = (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2, dx = xx - c[3], dy = yy - c[4];
        const d = dl + (dx * dx + dy * dy) * wxy;
        if (d < dist[i]){ dist[i] = d; labels[i] = k; }
      }
    });
    const sums = C.map(() => [0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < n; i++){ const l = labels[i]; if (l < 0) continue; const S = sums[l]; S[0] += lab[i * 3]; S[1] += lab[i * 3 + 1]; S[2] += lab[i * 3 + 2]; S[3] += i % w; S[4] += Math.floor(i / w); S[5]++; }
    C.forEach((c, k) => { const S = sums[k]; if (S[5] > 0) for (let j = 0; j < 5; j++) c[j] = S[j] / S[5]; });
  }
  for (let i = 0; i < n; i++) if (labels[i] < 0) labels[i] = i > 0 ? labels[i - 1] : 0;
  /* enforce_connectivity：四连通重编号，太小的块并进前面相邻那块 */
  const minSize = Math.floor(s * s / 4), out = new Int32Array(n).fill(-1);
  let next = 0; const comp = [];
  for (let st = 0; st < n; st++){
    if (out[st] >= 0) continue;
    const sx = st % w, sy = Math.floor(st / w); let adj = -1;
    if (sx > 0 && out[st - 1] >= 0) adj = out[st - 1];
    if (sy > 0 && out[st - w] >= 0) adj = out[st - w];
    comp.length = 0; comp.push(st); out[st] = next;
    for (let k = 0; k < comp.length; k++){
      const i = comp[k], x = i % w, y = Math.floor(i / w);
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1])
        if (j >= 0 && out[j] < 0 && labels[j] === labels[st]){ out[j] = next; comp.push(j); }
    }
    if (adj >= 0 && comp.length < minSize) for (const i of comp) out[i] = adj; else next++;
  }
  return {labels:out, count:next};
}
/* 二元堆积（Dijkstra 用；小的先出） */
function dijkstra(src, adj, wt, dist){
  dist.fill(Infinity); dist[src] = 0;
  const hd = [0], hv = [src];
  const push = (d, v) => { let i = hd.length; hd.push(d); hv.push(v); while (i > 0){ const p = (i - 1) >> 1; if (hd[p] <= hd[i]) break; [hd[p], hd[i]] = [hd[i], hd[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const d = hd[0], v = hv[0], ld = hd.pop(), lv = hv.pop(); if (hd.length){ hd[0] = ld; hv[0] = lv; let i = 0; for (;;){ const l = 2 * i + 1, r = l + 1; let m = i; if (l < hd.length && hd[l] < hd[m]) m = l; if (r < hd.length && hd[r] < hd[m]) m = r; if (m === i) break; [hd[m], hd[i]] = [hd[i], hd[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [d, v]; };
  while (hd.length){
    const [d, u] = pop(); if (d > dist[u]) continue;
    for (const v of adj[u]){ const nd = d + wt(u, v); if (nd < dist[v]){ dist[v] = nd; push(nd, v); } }
  }
}
function otsu(v){
  const hist = new Float64Array(256); for (const x of v) hist[Math.round(clamp01(x) * 255)]++;
  const total = v.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wb = 0, sb = 0, best = -1, bt = 0;
  for (let t = 0; t < 256; t++){
    wb += hist[t]; if (wb === 0) continue;
    const wf = total - wb; if (wf === 0) break;
    sb += t * hist[t];
    const mb = sb / wb, mf = (sum - sb) / wf, between = wb * wf * (mb - mf) * (mb - mf);
    if (between > best){ best = between; bt = t; }
  }
  return (bt + 0.5) / 255;
}
const SIGMA_CLR = 10, SIGMA_SPA = 0.25;
/* subject.rs saliency：每像素 0..1 */
function saliency(img){
  const {w, h} = img, n = w * h, lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgbToLab65(img.px[i * 3], img.px[i * 3 + 1], img.px[i * 3 + 2], lab, i * 3);
  const target = Math.min(Math.max(Math.floor(n / 150), 16), 400);
  const sp = slicLab(lab, w, h, target, 10, 8), N = sp.count;
  const mean = new Float64Array(N * 3), pos = new Float64Array(N * 2), cnt = new Float64Array(N), onB = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x, l = sp.labels[i];
    for (let k = 0; k < 3; k++) mean[l * 3 + k] += lab[i * 3 + k];
    pos[l * 2] += x / w; pos[l * 2 + 1] += y / h; cnt[l]++;
    if (x === 0 || y === 0 || x + 1 === w || y + 1 === h) onB[l] = 1;
  }
  for (let l = 0; l < N; l++){ const c = Math.max(cnt[l], 1); for (let k = 0; k < 3; k++) mean[l * 3 + k] = Math.fround(mean[l * 3 + k] / c); pos[l * 2] /= c; pos[l * 2 + 1] /= c; }
  const dapp = (a, b) => Math.sqrt(d2(mean, a * 3, mean, b * 3));
  const adj = Array.from({length:N}, () => []);
  const link = (a, b) => { if (a !== b && !adj[a].includes(b)){ adj[a].push(b); adj[b].push(a); } };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const l = sp.labels[y * w + x]; if (x + 1 < w) link(l, sp.labels[y * w + x + 1]); if (y + 1 < h) link(l, sp.labels[(y + 1) * w + x]); }
  const wbg = new Float64Array(N), geo = new Float64Array(N);
  for (let p = 0; p < N; p++){
    dijkstra(p, adj, dapp, geo);
    let area = 0, len = 0;
    for (let q = 0; q < N; q++){ const s = Math.exp(-geo[q] * geo[q] / (2 * SIGMA_CLR * SIGMA_CLR)); area += s; if (onB[q]) len += s; }
    const bnd = len / Math.sqrt(Math.max(area, 1e-6));
    wbg[p] = 1 - Math.exp(-bnd * bnd / 2);
  }
  const wctr = new Float64Array(N);
  for (let p = 0; p < N; p++){ let s = 0; for (let q = 0; q < N; q++){ const dx = pos[p * 2] - pos[q * 2], dy = pos[p * 2 + 1] - pos[q * 2 + 1]; s += dapp(p, q) * Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA_SPA * SIGMA_SPA)) * wbg[q]; } wctr[p] = s; }
  let mx = 0; for (let p = 0; p < N; p++) mx = Math.max(mx, wctr[p]); mx = Math.max(mx, 1e-6);
  const wfg = Array.from(wctr, v => v / mx);
  const wij = adj.map((a, p) => a.map(q => Math.exp(-(dapp(p, q) ** 2) / (2 * SIGMA_CLR * SIGMA_CLR)) + 0.1));
  const s = wfg.slice();
  for (let it = 0; it < 200; it++) for (let p = 0; p < N; p++){
    let num = wfg[p], den = wbg[p] + wfg[p];
    for (let k = 0; k < adj[p].length; k++){ num += wij[p][k] * s[adj[p][k]]; den += wij[p][k]; }
    s[p] = num / Math.max(den, 1e-6);
  }
  const ma = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) ma[k] += lab[i * 3 + k];
  for (let k = 0; k < 3; k++) ma[k] = Math.fround(ma[k] / n);
  const bl = blurLab(lab, w, h), ft = new Float64Array(n);
  let ftmax = 0; for (let i = 0; i < n; i++){ ft[i] = Math.sqrt(d2(bl, i * 3, ma, 0)); ftmax = Math.max(ftmax, ft[i]); } ftmax = Math.max(ftmax, 1e-6);
  let smin = Infinity, smax = -Infinity; for (const v of s){ smin = Math.min(smin, v); smax = Math.max(smax, v); }
  const sr = Math.max(smax - smin, 1e-6), out = new Float64Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++){ out[i] = 0.75 * (s[sp.labels[i]] - smin) / sr + 0.25 * ft[i] / ftmax; lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
  const r = Math.max(hi - lo, 1e-6); for (let i = 0; i < n; i++) out[i] = (out[i] - lo) / r;
  return out;
}
function blurLab(lab, w, h){
  let cur = Float32Array.from(lab);
  for (let pass = 0; pass < 2; pass++){
    const tmp = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const l = (y * w + Math.max(x - 1, 0)) * 3, c = (y * w + x) * 3, r = (y * w + Math.min(x + 1, w - 1)) * 3; for (let k = 0; k < 3; k++) tmp[c + k] = (cur[l + k] + 2 * cur[c + k] + cur[r + k]) / 4; }
    const nx = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const u = (Math.max(y - 1, 0) * w + x) * 3, c = (y * w + x) * 3, d = (Math.min(y + 1, h - 1) * w + x) * 3; for (let k = 0; k < 3; k++) nx[c + k] = (tmp[u + k] + 2 * tmp[c + k] + tmp[d + k]) / 4; }
    cur = nx;
  }
  return cur;
}
/* ── gmm.rs ── */
const M64 = (1n << 64n) - 1n;
function Rng(seed){ this.s = ((BigInt(seed) * 0x9E3779B97F4A7C15n) & M64) | 1n; }
Rng.prototype.next = function(){ let x = this.s; x ^= (x << 13n) & M64; x ^= x >> 7n; x ^= (x << 17n) & M64; this.s = x; return x; };
Rng.prototype.f32 = function(){ return Number(this.next() >> 40n) / 16777216; };
const subsample = (v, max) => { if (v.length <= max) return v.slice(); const k = Math.ceil(v.length / max), o = []; for (let i = 0; i < v.length; i += k) o.push(v[i]); return o; };
const sd2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function nearestC(cs, z){ let best = 0, bd = Infinity; for (let i = 0; i < cs.length; i++){ const d = sd2(cs[i], z); if (d < bd){ bd = d; best = i; } } return best; }
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
function component(weight, mean, cov, reg){
  const c = cov.map(r => r.slice()); for (let i = 0; i < 3; i++) c[i][i] += reg;
  const det = c[0][0] * (c[1][1] * c[2][2] - c[1][2] * c[2][1]) - c[0][1] * (c[1][0] * c[2][2] - c[1][2] * c[2][0]) + c[0][2] * (c[1][0] * c[2][1] - c[1][1] * c[2][0]);
  if (det <= 1e-30 || weight <= 0) return null;
  const inv = [[(c[1][1] * c[2][2] - c[1][2] * c[2][1]) / det, (c[0][2] * c[2][1] - c[0][1] * c[2][2]) / det, (c[0][1] * c[1][2] - c[0][2] * c[1][1]) / det],
    [(c[1][2] * c[2][0] - c[1][0] * c[2][2]) / det, (c[0][0] * c[2][2] - c[0][2] * c[2][0]) / det, (c[0][2] * c[1][0] - c[0][0] * c[1][2]) / det],
    [(c[1][0] * c[2][1] - c[1][1] * c[2][0]) / det, (c[0][1] * c[2][0] - c[0][0] * c[2][1]) / det, (c[0][0] * c[1][1] - c[0][1] * c[1][0]) / det]];
  return {mean:mean.slice(), inv, logNorm:Math.log(weight) - 0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI)};
}
function logW(c, z){
  const d0 = z[0] - c.mean[0], d1 = z[1] - c.mean[1], d2v = z[2] - c.mean[2], m = c.inv;
  return c.logNorm - 0.5 * (d0 * (m[0][0] * d0 + m[0][1] * d1 + m[0][2] * d2v) + d1 * (m[1][0] * d0 + m[1][1] * d1 + m[1][2] * d2v) + d2v * (m[2][0] * d0 + m[2][1] * d1 + m[2][2] * d2v));
}
const newAcc = () => ({n:0, s:[0, 0, 0], ss:[[0, 0, 0], [0, 0, 0], [0, 0, 0]]});
function accAdd(a, z, w){ a.n += w; for (let i = 0; i < 3; i++){ a.s[i] += w * z[i]; for (let j = 0; j < 3; j++) a.ss[i][j] += w * z[i] * z[j]; } }
function accComp(a, total, reg){ if (a.n <= 0) return null; const m = a.s.map(v => v / a.n); return component(a.n / total, m, [0, 1, 2].map(i => [0, 1, 2].map(j => a.ss[i][j] / a.n - m[i] * m[j])), reg); }
const DEFAULT_REG = Math.fround(2e-5);
function fromLabels(samples, labels, k, reg){
  const acc = Array.from({length:k}, newAcc); samples.forEach((z, i) => accAdd(acc[labels[i]], z, 1));
  const comps = acc.map(a => accComp(a, samples.length, reg)).filter(Boolean);
  return comps.length ? {comps, reg} : null;
}
function emStep(g, samples){
  const acc = g.comps.map(newAcc), lw = new Array(g.comps.length);
  for (const z of samples){
    let mx = -Infinity; g.comps.forEach((c, i) => { lw[i] = logW(c, z); mx = Math.max(mx, lw[i]); });
    let sum = 0; for (let i = 0; i < lw.length; i++){ lw[i] = Math.exp(lw[i] - mx); sum += lw[i]; }
    for (let i = 0; i < lw.length; i++){ const r = lw[i] / sum; if (r > 1e-6) accAdd(acc[i], z, r); }
  }
  const comps = acc.map(a => accComp(a, samples.length, g.reg)).filter(Boolean);
  return comps.length ? {comps, reg:g.reg} : null;
}
function gmmFit(samples, k, reg){
  if (!samples.length) return null;
  k = Math.min(Math.max(k, 1), samples.length);
  const cs = kmeans(samples, k, 10);
  let g = fromLabels(samples, samples.map(z => nearestC(cs, z)), cs.length, reg); if (!g) return null;
  for (let i = 0; i < 3; i++) g = emStep(g, samples) || g;
  return g;
}
function componentOf(g, z){ let best = 0, bv = -Infinity; g.comps.forEach((c, i) => { const v = logW(c, z); if (v > bv){ bv = v; best = i; } }); return best; }
const refit = (g, samples) => fromLabels(samples, samples.map(z => componentOf(g, z)), g.comps.length, g.reg);
function negLog(g, z){
  const n = Math.min(g.comps.length, 16); let mx = -Infinity; const v = [];
  for (let i = 0; i < n; i++){ v.push(logW(g.comps[i], z)); mx = Math.max(mx, v[i]); }
  let s = 0; for (const x of v) s += Math.exp(x - mx);
  return Math.min(200, Math.max(-50, -(mx + Math.log(s))));
}
/* ── maxflow.rs（Boykov–Kolmogorov） ── */
const NONE = -1, TERMINAL = -2, ORPHAN = -3, EPSF = 1e-5;
function Graph(nodes, edges){
  this.first = new Int32Array(nodes).fill(NONE); this.trCap = new Float64Array(nodes); this.parent = new Int32Array(nodes).fill(NONE);
  this.isSink = new Uint8Array(nodes); this.ts = new Int32Array(nodes); this.dist = new Int32Array(nodes); this.active = new Uint8Array(nodes);
  this.head = new Int32Array(Math.max(edges * 2, 2)); this.next = new Int32Array(Math.max(edges * 2, 2)); this.rCap = new Float64Array(Math.max(edges * 2, 2)); this.na = 0; this.flow = 0;
}
Graph.prototype.grow = function(){
  const n = this.head.length * 2, g = (A, T) => { const B = new T(n); B.set(A); return B; };
  this.head = g(this.head, Int32Array); this.next = g(this.next, Int32Array); this.rCap = g(this.rCap, Float64Array);
};
Graph.prototype.addTweights = function(i, cs, ct){ const d = this.trCap[i]; if (d > 0) cs += d; else ct -= d; this.flow += Math.min(cs, ct); this.trCap[i] = cs - ct; };
Graph.prototype.addEdge = function(i, j, cap, rev){
  if (this.na + 2 > this.head.length) this.grow();
  const a = this.na; this.na += 2;
  this.head[a] = j; this.next[a] = this.first[i]; this.rCap[a] = cap; this.first[i] = a;
  this.head[a + 1] = i; this.next[a + 1] = this.first[j]; this.rCap[a + 1] = rev; this.first[j] = a + 1;
};
Graph.prototype.inSource = function(i){ return this.parent[i] !== NONE && !this.isSink[i]; };
/* 双端伫列（push_front 只在接触点用） */
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
const NB = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]];
function contrastBeta(img){
  const {w, h, px} = img; let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [dx, dy] of NB){ const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < w && ny < h){ sum += d2(px, (y * w + x) * 3, px, (ny * w + nx) * 3); n++; } }
  return (n === 0 || sum <= 1e-12) ? 0 : n / (2 * sum);
}
const FREE = 0, HARD_FG = 1, HARD_BG = 2;
function gridCut(img, cfg, cbg, fixed, gamma, beta){
  const {w, h, px} = img, n = w * h, idx = new Int32Array(n).fill(-1);
  let count = 0; for (let i = 0; i < n; i++) if (fixed[i] === FREE) idx[i] = count++;
  const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = fixed[i] === HARD_FG ? 1 : 0;
  if (!count) return out;
  const g = new Graph(count, count * 4);
  for (let i = 0; i < n; i++) if (idx[i] >= 0) g.addTweights(idx[i], cbg[i], cfg[i]);
  const fixLink = (node, f, wt) => { if (f === HARD_FG) g.addTweights(node, wt, 0); else g.addTweights(node, 0, wt); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x;
    for (const [dx, dy, len] of NB){
      const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx, wt = gamma * Math.exp(-beta * d2(px, i * 3, px, j * 3)) / len;
      const fi = idx[i] >= 0, fj = idx[j] >= 0;
      if (fi && fj) g.addEdge(idx[i], idx[j], wt, wt); else if (fi) fixLink(idx[i], fixed[j], wt); else if (fj) fixLink(idx[j], fixed[i], wt);
    }
  }
  g.maxflow();
  for (let i = 0; i < n; i++) if (idx[i] >= 0) out[i] = g.inSource(idx[i]) ? 1 : 0;
  return out;
}
const pxAt = (img, i) => [img.px[i * 3], img.px[i * 3 + 1], img.px[i * 3 + 2]];
function dataCosts(img, fg, bg){ const n = img.w * img.h, cf = new Float64Array(n), cb = new Float64Array(n); for (let i = 0; i < n; i++){ const p = pxAt(img, i); cf[i] = negLog(fg, p); cb[i] = negLog(bg, p); } return [cf, cb]; }
/* ── grabcut.rs ── */
const BG = 0, FG = 1, PR_BG = 2, PR_FG = 3, isFg = t => t === FG || t === PR_FG;
function grabcut(img, trimap, iters){
  const beta = contrastBeta(img), fixed = Uint8Array.from(trimap, t => t === FG ? HARD_FG : t === BG ? HARD_BG : FREE);
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
    for (let i = 0; i < trimap.length; i++) if (trimap[i] === PR_BG || trimap[i] === PR_FG){ const nt = cut[i] ? PR_FG : PR_BG; if (nt !== trimap[i]) changed++; trimap[i] = nt; }
    models = [fg, bg];
    if (changed * 2000 < trimap.length) break;
  }
  return models;
}
/* ── components／clean_mask ── */
function components(mask, w, h, eight){
  const lab = new Int32Array(w * h), sizes = [0], stack = [];
  for (let s = 0; s < w * h; s++){
    if (!mask[s] || lab[s]) continue;
    const l = sizes.length; sizes.push(0); lab[s] = l; stack.push(s);
    while (stack.length){
      const i = stack.pop(); sizes[l]++;
      const x = i % w, y = Math.floor(i / w);
      if (eight){ for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (mask[j] && !lab[j]){ lab[j] = l; stack.push(j); } } }
      else for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1]) if (j >= 0 && mask[j] && !lab[j]){ lab[j] = l; stack.push(j); }
    }
  }
  return {lab, sizes};
}
function cleanMask(mask, w, h, frac, holeFrac){
  const {lab, sizes} = components(mask, w, h, true);
  let largest = 0; for (let i = 1; i < sizes.length; i++) largest = Math.max(largest, sizes[i]);
  const out = new Uint8Array(w * h); if (!largest) return out;
  const min = Math.ceil(Math.fround(largest * frac)); let area = 0;
  for (let i = 0; i < out.length; i++) if (lab[i] && sizes[lab[i]] >= min){ out[i] = 1; area++; }
  const maxHole = Math.floor(Math.fround(area * holeFrac)), inv = Uint8Array.from(out, v => v ? 0 : 1), H4 = components(inv, w, h, false), touches = new Uint8Array(H4.sizes.length);
  for (let x = 0; x < w; x++){ touches[H4.lab[x]] = 1; touches[H4.lab[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++){ touches[H4.lab[y * w]] = 1; touches[H4.lab[y * w + w - 1]] = 1; }
  for (let i = 0; i < out.length; i++){ const l = H4.lab[i]; if (l && !touches[l] && H4.sizes[l] <= maxHole) out[i] = 1; }
  return out;
}
/* antialias_u8：边缘像素跟 3×3 平均混 */
function antialiasU8(mask, w, h){
  const src = mask.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const v = src[y * w + x]; let sum = 0, edge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const X = x + dx, Y = y + dy, nv = (X < 0 || Y < 0 || X >= w || Y >= h) ? v : src[Y * w + X]; if (nv !== v) edge = true; sum += nv; }
    if (edge){ const avg = sum / (9 * 255), f = v > 127 ? 0.5 + 0.5 * avg : 0.5 * avg; mask[y * w + x] = Math.round(f * 255); }
  }
}
/* finish_region：工作解析度的标签放大；step>1 时在边界带（每块 192＋晕 12）用两边的 GMM＋弱先验在全解析度重切；最后反锯齿、缩到外框 */
function finishRegion(sample, win, step, low, lw, lh, models){
  const w = win[2] - win[0], h = win[3] - win[1], mask = new Uint8Array(w * h);
  if (step <= 1) for (let i = 0; i < mask.length; i++) mask[i] = low[i] ? 255 : 0;
  else {
    const band = new Uint8Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
      const v = low[y * lw + x];
      outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < lw && ny < lh && low[ny * lw + nx] !== v){ band[y * lw + x] = 1; break outer; } }
    }
    for (let y = 0; y < h; y++){ const ly = Math.min(Math.floor(y / step), lh - 1); for (let x = 0; x < w; x++) mask[y * w + x] = low[ly * lw + Math.min(Math.floor(x / step), lw - 1)] ? 255 : 0; }
    if (models) refineBand(sample, win, step, low, band, lw, lh, models[0], models[1], mask);
  }
  antialiasU8(mask, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  return {bbox:[win[0] + x0, win[1] + y0, win[0] + x1 + 1, win[1] + y1 + 1], full:mask, win};
}
function refineBand(sample, win, step, low, band, lw, lh, fg, bg, mask){
  const T = 192, HALO = 12, w = win[2] - win[0];
  const block = (x, y) => Math.min(Math.floor((y - win[1]) / step), lh - 1) * lw + Math.min(Math.floor((x - win[0]) / step), lw - 1);
  for (let ty = win[1]; ty < win[3]; ty += T) for (let tx = win[0]; tx < win[2]; tx += T){
    const t = [tx, ty, Math.min(tx + T, win[2]), Math.min(ty + T, win[3])];
    const bx0 = Math.floor((t[0] - win[0]) / step), by0 = Math.floor((t[1] - win[1]) / step), bx1 = Math.min(Math.floor((t[2] - 1 - win[0]) / step), lw - 1), by1 = Math.min(Math.floor((t[3] - 1 - win[1]) / step), lh - 1);
    let any = false; for (let by = by0; by <= by1 && !any; by++) for (let bx = bx0; bx <= bx1; bx++) if (band[by * lw + bx]){ any = true; break; }
    if (!any) continue;
    const r = [Math.max(t[0] - HALO, win[0]), Math.max(t[1] - HALO, win[1]), Math.min(t[2] + HALO, win[2]), Math.min(t[3] + HALO, win[3])];
    const img = sample(r), rw = r[2] - r[0], rh = r[3] - r[1], fixed = new Uint8Array(rw * rh), cfg = new Float64Array(rw * rh), cbg = new Float64Array(rw * rh);
    for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++){
      const i = yy * rw + xx, b = block(r[0] + xx, r[1] + yy), lab = low[b];
      if (!band[b]){ fixed[i] = lab ? HARD_FG : HARD_BG; continue; }
      const p = pxAt(img, i);
      cfg[i] = negLog(fg, p) + (lab ? 0 : 0.4); cbg[i] = negLog(bg, p) + (lab ? 0.4 : 0);
    }
    const cut = gridCut(img, cfg, cbg, fixed, 50, contrastBeta(img));
    for (let yy = t[1]; yy < t[3]; yy++) for (let xx = t[0]; xx < t[2]; xx++) mask[(yy - win[1]) * w + (xx - win[0])] = cut[(yy - r[1]) * rw + (xx - r[0])] ? 255 : 0;
  }
}
/* subject.rs select_subject */
const WORK_PX = 110000;
function selectSubject(rgba, W, H){
  if (W < 4 || H < 4) return null;
  const step = scaleFor(W, H, WORK_PX), full = rgbRect(rgba, W, 0, 0, W, H), img = downsample(full, step), {w, h} = img;
  const sal = saliency(img), t = Math.min(Math.max(otsu(sal), 0.15), 0.85), trimap = new Uint8Array(w * h);
  let anyFg = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x, border = x === 0 || y === 0 || x + 1 === w || y + 1 === h;
    trimap[i] = sal[i] >= t ? (anyFg = true, PR_FG) : (border || sal[i] < 0.4 * t) ? BG : PR_BG;
  }
  if (!anyFg) return null;
  const models = grabcut(img, trimap, 6); if (!models) return null;
  const low = cleanMask(Uint8Array.from(trimap, v => (v === PR_FG || v === FG) ? 1 : 0), w, h, 0.2, 0.05);
  if (!low.some(v => v)) return null;
  const sample = r => rgbRect(rgba, W, r[0], r[1], r[2] - r[0], r[3] - r[1]);
  const reg = finishRegion(sample, [0, 0, W, H], step, low, w, h, models);
  if (!reg) return null;
  return {mask:reg.full, bbox:[reg.bbox[0], reg.bbox[1], reg.bbox[2] - reg.bbox[0], reg.bbox[3] - reg.bbox[1]]};
}
PS.selectSubject = selectSubject;
PS.algo = PS.algo || {};
Object.assign(PS.algo, {selectSubject, saliency, slicLab, grabcut, gridCut, gmmFit, otsu});

/* combine_region（selection.rs:365）：只动区域外框；replace／add(无旧)＝新的；减／交(无旧)＝无；全空＝取消选择 */
function combineRegion(old, reg, mode){
  const n = Doc.width * Doc.height, any = a => { for (let i = 0; i < a.length; i++) if (a[i]) return true; return false; };
  const nw = reg ? reg.mask : null, b = reg ? reg.bbox : null, inB = i => { const x = i % Doc.width, y = Math.floor(i / Doc.width); return b && x >= b[0] && y >= b[1] && x < b[0] + b[2] && y < b[1] + b[3]; };
  if (mode === 'replace' || (mode === 'add' && !old)){ if (!nw || !any(nw)) return null; const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = inB(i) ? nw[i] : 0; return o; }
  if (!old) return null;
  const o = Uint8Array.from(old);
  if (mode === 'intersect'){ for (let i = 0; i < n; i++) o[i] = inB(i) ? Math.min(old[i], nw[i]) : 0; return any(o) ? o : null; }
  if (!b) return any(old) ? o : null;
  for (let i = 0; i < n; i++) if (inB(i)) o[i] = mode === 'add' ? Math.max(old[i], nw[i]) : Math.max(0, old[i] - nw[i]);
  return any(o) ? o : null;
}
function samplePixels(all){
  const L = Doc.active(), W = Doc.width, H = Doc.height;
  if (!all && L && L.kind === 'raster') return L.data.ctx.getImageData(-Math.round(L.x || 0), -Math.round(L.y || 0), W, H).data;   // 铁律④：层外＝透明
  return composite(1).getContext('2d').getImageData(0, 0, W, H).data;
}
CMD.reg('ps.select.subject', {i18n:'', undoable:true,
  params:'{sampleAllLayers=true, mode:"replace|add|subtract|intersect"="replace"} 主体：经典演算法（原码 subject.rs：SLIC 超像素＋背景连通度／对比显著性最佳化＋频率调谐显著性 → Otsu → GrabCut → 清碎块 → 全解析度沿边重切）选出最显著的物件；' +
         '找不到＝加／减时选区不动 → {ok, selected, changed, bounds}'},
  p => {
    p = p || {};
    const m0 = typeof p.mode === 'string' ? p.mode : 'replace', mode = (m0 === 'add' || m0 === 'subtract' || m0 === 'intersect') ? m0 : 'replace';
    const reg = selectSubject(samplePixels(typeof p.sampleAllLayers === 'boolean' ? p.sampleAllLayers : true), Doc.width, Doc.height);
    if (!reg && (mode === 'add' || mode === 'subtract')) return {ok:true, selected:!!Doc.sel, changed:false};
    const out = combineRegion(Doc.sel && window.SelMask ? SelMask.bytes() : null, reg, mode);
    Doc.sel = out ? SelMask.fromBytes(out) : null;
    return {ok:true, selected:!!Doc.sel, changed:true, bounds:reg ? reg.bbox : null};
  });
})();
