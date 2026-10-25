/* 堤麟画板 · Photoshop ▸ 滤镜（Filter）菜单的实作
   命令一律登记成 ps.<原码命令 id>（agent 走命令＝人点菜单＋对话框按确定）；带「…」的项 {dialog:true}＝开对话框（即时预览、取消还原、确定＝一步历史）。
   对照源（photocraft/crates/…，逐段翻；各段档头另有细目）：
     engine/src/filters.rs        1-331   params_for、apply_filter_to_surface、run_filter（选区外框当参考框、画布边重复边缘格、按覆盖度混回）、specs、last_filter
     engine/src/filters_ext.rs    1-597   扩充滤镜的 params_for、uses_colours／prepare（前景背景色写进参数）、置换图 resolve、镜头模糊深度＝蒙版、specs
     engine/src/extra_cmds.rs     59-257  map_pixels、平均、云彩、分层云彩（clouds_value 8 阶值杂讯）
     algo/src/lib.rs              86-959  FilterParams、halo／halo_ext、kernel 分派、output_area、apply_in／apply_tiled
     algo/src/image.rs、fxutil.rs、noise.rs:11   Image（read、read_clamped、取样）、窗口预乘、盒状／高斯、cell_point、hash01
     ui-egui/src/filter_dialog.rs 1-400   对话框照参数表生成（Range 滑杆〔宽范围用对数〕、Choice 下拉、Bool、Int、Grid 5×5、Doc）、预览＝同一条命令跑在目标上、params_of
     其余（各段自己的档头）：algo/src/blur.rs sharpen.rs noise.rs other.rs stylize.rs（10-basic）、distort.rs distort2.rs video.rs other2.rs（11-distort）、
       pixelate.rs stylize2.rs（12-pixstyle）、oil.rs render.rs denoise.rs（13-render）、blur2.rs gallery.rs（14-blur2）、artistic.rs artistic_fx.rs ＋ engine/gallery_cmds.rs ＋ ui-egui/gallery_ui.rs（15-gallery）、
       render2.rs ＋ engine/render_cmds.rs（16-render2）、lens.rs wideangle.rs ＋ engine/lens_cmds.rs ＋ ui-egui/wide_angle_ui.rs（17-lens）、camera_raw.rs ＋ ui-egui/camera_raw_ui.rs（18-cameraraw）、
       liquify.rs ＋ engine/distort_cmds.rs ＋ ui-egui/liquify_ui.rs（19-liquify）、vanishing.rs transform.rs ＋ engine/vp_cmds.rs（20-vanishing）
   我们的资料模型差异：只有 RGB 8 位一种模式（CMYK／Lab／灰阶分支只留 RGB 那条）；像素层画布有位移 L.x/L.y（铁律④：读进来就换成文件坐标）；
   没有智能对象（「转换为智能滤镜」与智能滤镜记录不做）、没有通道面板／Alpha 通道当目标、没有存的路径（火焰沿路径改吃参数 paths）。
   🔴 改文件全走 CMD；对话框预览只临时改图层像素、不进历史，按确定才跑命令（一步历史），取消还原。 */
(function(){
'use strict';
if (window.PsFilter) return;              // 防双载

/* ──────────────── 段：00-core.js ──────────────── */
/* ═══════════ 核心：区域、影像、取样（algo/src/image.rs、fxutil.rs、noise.rs:11 hash01） ═══════════
   约定（全档共用）：
   · 只有 RGB＋alpha 一种模式：每格 4 个浮点 [r,g,b,a]，直通（不预乘）、0..1；ctx.alpha 恒 true、ctx.mode 恒 'rgb'。
   · 坐标一律「文件坐标」（铁律④）：图层像素读进来时已加 L.x/L.y。
   · Rect＝{x0,y0,x1,y1}（半开区间，同 photocraft_geom::Rect）。 */
const R = (x0, y0, x1, y1) => ({x0, y0, x1, y1});
const RW = r => Math.max(0, r.x1 - r.x0), RH = r => Math.max(0, r.y1 - r.y0);
const rEmpty = r => r.x1 <= r.x0 || r.y1 <= r.y0;
const EMPTY = R(0, 0, 0, 0);
const rContains = (r, x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
function rInter(a, b){ const r = R(Math.max(a.x0, b.x0), Math.max(a.y0, b.y0), Math.min(a.x1, b.x1), Math.min(a.y1, b.y1)); return rEmpty(r) ? EMPTY : r; }
function rUnion(a, b){ if (rEmpty(a)) return b; if (rEmpty(b)) return a; return R(Math.min(a.x0, b.x0), Math.min(a.y0, b.y0), Math.max(a.x1, b.x1), Math.max(a.y1, b.y1)); }
const rInflate = (r, n) => R(r.x0 - n, r.y0 - n, r.x1 + n, r.y1 + n);
const rEq = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const remE = (x, m) => ((x % m) + m) % m;                      // Rust rem_euclid
const rround = v => Math.sign(v) * Math.round(Math.abs(v));      // Rust f32::round（.5 远离零）
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const EDGE = {Transparent:0, Repeat:1, Wrap:2};                   // image.rs Edge

/* image.rs Image：一块交错浮点样本（ch＝4） */
class Img {
  constructor(rect, ch, data){ this.rect = rect; this.ch = ch || 4; this.data = data || new Float32Array(RW(rect) * RH(rect) * this.ch); }
  w(){ return RW(this.rect); }
  index(x, y){ return ((y - this.rect.y0) * RW(this.rect) + (x - this.rect.x0)) * this.ch; }
  get(x, y, c){ const r = this.rect; return (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) ? this.data[((y - r.y0) * (r.x1 - r.x0) + (x - r.x0)) * this.ch + c] : 0; }
  /* 那一格的切片视图（Rust px，必须在里面） */
  px(x, y){ const i = this.index(x, y); return this.data.subarray(i, i + this.ch); }
  getEdge(x, y, c, edge, area){
    if (rContains(area, x, y)) return this.get(x, y, c);
    if (edge === EDGE.Repeat) return this.get(clamp(x, area.x0, area.x1 - 1), clamp(y, area.y0, area.y1 - 1), c);
    if (edge === EDGE.Wrap){ const w = Math.max(RW(area), 1), h = Math.max(RH(area), 1); return this.get(area.x0 + remE(x - area.x0, w), area.y0 + remE(y - area.y0, h), c); }
    return 0;
  }
  /* 双线性取样（像素中心在 .5），预乘平均后写回直通到 out（长度 ch） */
  sample(x, y, edge, area, alpha, out){
    const fx = x - 0.5, fy = y - 0.5, x0f = Math.floor(fx), y0f = Math.floor(fy), ax = fx - x0f, ay = fy - y0f, x0 = x0f | 0, y0 = y0f | 0, n = this.ch, nc = alpha ? n - 1 : n;
    for (let i = 0; i < out.length; i++) out[i] = 0;
    let accA = 0;
    for (let q = 0; q < 4; q++){                                     // 四个邻格 (0,0)(1,0)(0,1)(1,1)（不配阵列：放射／动感模糊每格取样几十次）
      const dx = q & 1, dy = q >> 1, wgt = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
      if (wgt <= 0) continue;
      const xx = x0 + dx, yy = y0 + dy, r = this.rect;
      if (xx >= area.x0 && xx < area.x1 && yy >= area.y0 && yy < area.y1 && xx >= r.x0 && xx < r.x1 && yy >= r.y0 && yy < r.y1){
        const i = ((yy - r.y0) * (r.x1 - r.x0) + (xx - r.x0)) * n, d = this.data, a = alpha ? d[i + n - 1] : 1;
        for (let c = 0; c < nc; c++) out[c] += d[i + c] * a * wgt;
        accA += a * wgt;
      } else {
        const a = alpha ? this.getEdge(xx, yy, n - 1, edge, area) : 1;
        for (let c = 0; c < nc; c++) out[c] += this.getEdge(xx, yy, c, edge, area) * a * wgt;
        accA += a * wgt;
      }
    }
    if (alpha){ if (accA > 0) for (let c = 0; c < n - 1; c++) out[c] /= accA; out[n - 1] = accA; }
  }
  crop(out){
    const res = new Float32Array(RW(out) * RH(out) * this.ch); let k = 0;
    for (let y = out.y0; y < out.y1; y++) for (let x = out.x0; x < out.x1; x++) for (let c = 0; c < this.ch; c++) res[k++] = this.get(x, y, c);
    return res;
  }
  static read(s, rect){ return new Img(rect, 4, s.readRegion(rect)); }
  /* 画布边以外重复最近的边缘格（image.rs:35 read_clamped） */
  static readClamped(s, rect, extent){
    const inner = rInter(rect, extent);
    if (rEmpty(inner) || rEq(inner, rect)) return Img.read(s, rect);
    const src = Img.read(s, inner), img = new Img(rect, 4), w = RW(rect);
    for (let y = rect.y0; y < rect.y1; y++){
      const sy = clamp(y, inner.y0, inner.y1 - 1), row = (y - rect.y0) * w * 4;
      for (let x = rect.x0; x < rect.x1; x++){
        const sx = clamp(x, inner.x0, inner.x1 - 1), d = row + (x - rect.x0) * 4, si = src.index(sx, sy);
        img.data[d] = src.data[si]; img.data[d + 1] = src.data[si + 1]; img.data[d + 2] = src.data[si + 2]; img.data[d + 3] = src.data[si + 3];
      }
    }
    return img;
  }
}
function premultiply(data, ch, alpha){ if (!alpha) return; for (let i = 0; i < data.length; i += ch){ const a = data[i + ch - 1]; for (let c = 0; c < ch - 1; c++) data[i + c] *= a; } }
function unpremultiply(data, ch, alpha){ if (!alpha) return; for (let i = 0; i < data.length; i += ch){ const a = data[i + ch - 1]; for (let c = 0; c < ch - 1; c++) data[i + c] = a > 1e-7 ? data[i + c] / a : 0; } }

/* Surf：一整块像素层（照 photocraft_raster::Surface 的用法；文件坐标、直通 RGBA 浮点；外面读到 0；写到外面会自己长大） */
class Surf {
  constructor(x0, y0, w, h, data){ this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.data = data || new Float32Array(w * h * 4); }
  rect(){ return R(this.x0, this.y0, this.x0 + this.w, this.y0 + this.h); }
  channels(){ return 4; }
  clone(){ return new Surf(this.x0, this.y0, this.w, this.h, this.data.slice()); }
  pixel(x, y){ x -= this.x0; y -= this.y0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0]; const i = (y * this.w + x) * 4, d = this.data; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
  writePixel(x, y, v){ this.ensure(R(x, y, x + 1, y + 1)); const i = ((y - this.y0) * this.w + (x - this.x0)) * 4; for (let c = 0; c < 4; c++) this.data[i + c] = v[c]; }
  readRegion(r){
    const w = RW(r), out = new Float32Array(w * RH(r) * 4);
    const ix = rInter(r, this.rect()); if (rEmpty(ix)) return out;
    for (let y = ix.y0; y < ix.y1; y++){
      const s = ((y - this.y0) * this.w + (ix.x0 - this.x0)) * 4, d = ((y - r.y0) * w + (ix.x0 - r.x0)) * 4;
      out.set(this.data.subarray(s, s + RW(ix) * 4), d);
    }
    return out;
  }
  /* 有需要就把画布长大（左上角可往负方向长） */
  ensure(r){
    const cur = this.rect(); if (rEmpty(r)) return;
    const u = rUnion(cur, r); if (rEq(u, cur)) return;
    const n = new Surf(u.x0, u.y0, RW(u), RH(u));
    for (let y = 0; y < this.h; y++){ const s = y * this.w * 4, d = ((y + this.y0 - u.y0) * n.w + (this.x0 - u.x0)) * 4; n.data.set(this.data.subarray(s, s + this.w * 4), d); }
    Object.assign(this, {x0:n.x0, y0:n.y0, w:n.w, h:n.h, data:n.data});
  }
  writeRegion(r, data){
    if (rEmpty(r)) return; this.ensure(r);
    const w = RW(r);
    for (let y = r.y0; y < r.y1; y++){
      const d = ((y - this.y0) * this.w + (r.x0 - this.x0)) * 4, s = (y - r.y0) * w * 4;
      for (let k = 0; k < w * 4; k++){ const v = data[s + k]; this.data[d + k] = v < 0 ? 0 : v > 1 ? 1 : v; }   // 8 位储存：写入即夹 0..1
    }
  }
  fillRect(r, c){ this.ensure(r); for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++){ const i = ((y - this.y0) * this.w + (x - this.x0)) * 4; for (let k = 0; k < 4; k++) this.data[i + k] = c[k]; } }
  /* 有不透明像素的外框（Surface::content_bounds；全透明＝空） */
  contentBounds(){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const d = this.data, w = this.w;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < x0 ? EMPTY : R(x0 + this.x0, y0 + this.y0, x1 + 1 + this.x0, y1 + 1 + this.y0);
  }
  prune(){}
  static fromLayer(L){
    const c = L.data.canvas, w = c.width, h = c.height, s = new Surf(Math.round(L.x || 0), Math.round(L.y || 0), w, h);
    if (!w || !h) return s;
    const d = L.data.ctx.getImageData(0, 0, w, h).data; for (let i = 0; i < d.length; i++) s.data[i] = d[i] / 255;
    return s;
  }
  /* 写回图层（画布尺寸／位移跟着 Surf；8 位四舍五入） */
  toLayer(L){
    const c = L.data.canvas;
    if (c.width !== this.w || c.height !== this.h){ c.width = this.w; c.height = this.h; }
    L.x = this.x0; L.y = this.y0;
    if (!this.w || !this.h) return;
    const img = L.data.ctx.createImageData(this.w, this.h), d = img.data;
    for (let i = 0; i < d.length; i++){ const v = this.data[i]; d[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
    L.data.ctx.putImageData(img, 0, 0);
  }
}

/* noise.rs:11 hash01：文件坐标的确定性杂凑 → [0,1)（结果不随分块变） */
function hash01(x, y, c, seed){
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(c | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

/* ── fxutil.rs（我们只有 RGB：ncol＝3、非减色、不走 Lab） ── */
const MAXC = 8;
const ncol = (ctx, n) => ctx.alpha ? n - 1 : n;
const subtractive = () => false;
const viaRgb = () => false;
const xyOf = (out, i) => { const w = RW(out); return [out.x0 + i % w, out.y0 + Math.floor(i / w)]; };          // fxutil xy
const rgbaOf = (ctx, px) => [px[0], px[1], px[2], px[3]];                                                     // fxutil rgba（RGB 模式＝原样）
function setRgba(ctx, px, c){ for (let k = 0; k < Math.min(4, px.length); k++) px[k] = c[k]; }               // fxutil set_rgba
const nativeOf = (ctx, c) => { const t = new Float32Array(MAXC); t[0] = c[0]; t[1] = c[1]; t[2] = c[2]; t[3] = c[3]; return t; };   // fxutil native
const lumaOf = (ctx, px) => 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];                                    // fxutil luma（Rec.601）
/* fxutil premul_window：win 范围的预乘副本（外面 0） */
function premulWindow(src, win, alpha){
  const n = src.ch, v = new Float32Array(RW(win) * RH(win) * n); let k = 0;
  for (let y = win.y0; y < win.y1; y++) for (let x = win.x0; x < win.x1; x++){
    const a = alpha ? src.get(x, y, n - 1) : 1;
    for (let c = 0; c < n; c++){ const s = src.get(x, y, c); v[k++] = (alpha && c < n - 1) ? s * a : s; }
  }
  return v;
}
function unpremulPx(px, alpha){ if (!alpha) return; const n = px.length, a = px[n - 1]; for (let c = 0; c < n - 1; c++) px[c] = a > 1e-7 ? px[c] / a : 0; }
/* fxutil box_rows_n／box_cols_n：滑动和（边缘夹住），f64 累加 */
function boxRowsN(buf, w, h, n, r){
  if (!r || !w) return; const norm = 1 / (2 * r + 1), sc = new Float64Array(w * n);
  for (let y = 0; y < h; y++){
    const base = y * w * n; for (let i = 0; i < w * n; i++) sc[i] = buf[base + i];
    for (let c = 0; c < n; c++){
      const at = x => sc[(x < 0 ? 0 : x >= w ? w - 1 : x) * n + c];
      let acc = 0; for (let x = -r; x <= r; x++) acc += at(x);
      for (let x = 0; x < w; x++){ buf[base + x * n + c] = acc * norm; acc += at(x + r + 1) - at(x - r); }
    }
  }
}
function boxColsN(buf, w, h, n, r){
  if (!r || !h) return; const norm = 1 / (2 * r + 1), sc = new Float64Array(h * n);
  for (let x = 0; x < w; x++){
    for (let y = 0; y < h; y++) for (let c = 0; c < n; c++) sc[y * n + c] = buf[(y * w + x) * n + c];
    for (let c = 0; c < n; c++){
      const at = y => sc[(y < 0 ? 0 : y >= h ? h - 1 : y) * n + c];
      let acc = 0; for (let y = -r; y <= r; y++) acc += at(y);
      for (let y = 0; y < h; y++){ buf[(y * w + x) * n + c] = acc * norm; acc += at(y + r + 1) - at(y - r); }
    }
  }
}
function boxBlurN(buf, w, h, n, r){ boxRowsN(buf, w, h, n, r); boxColsN(buf, w, h, n, r); }
function gaussBoxRadii(sigma){                                     // fxutil.rs:165（Kovesi 2010）
  const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl -= 1; wl = Math.max(wl, 1);
  const wu = wl + 2, m = clamp(rround((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), 0, n);
  return [0, 1, 2].map(i => i < m ? (wl - 1) / 2 : (wu - 1) / 2);
}
function gaussBlurN(buf, w, h, n, sigma){
  if (sigma < 0.3) return;
  for (const r of gaussBoxRadii(sigma)) boxRowsN(buf, w, h, n, r);
  for (const r of gaussBoxRadii(sigma)) boxColsN(buf, w, h, n, r);
}
const cellPoint = (cx, cy, cell, seed, origin) => [origin[0] + (cx + 0.1 + 0.8 * hash01(cx, cy, 11, seed)) * cell, origin[1] + (cy + 0.1 + 0.8 * hash01(cx, cy, 12, seed)) * cell];
function smoothstep(e0, e1, x){ if (e1 <= e0) return x >= e1 ? 1 : 0; const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
/* fxutil add_sample_premul：双线性（边缘夹 clip）预乘样本加进 acc */
function addSamplePremul(src, x, y, clip, alpha, acc){
  const n = src.ch, fx = clamp(x - 0.5, clip.x0, clip.x1 - 1), fy = clamp(y - 0.5, clip.y0, clip.y1 - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, clip.x1 - 1), y1 = Math.min(y0 + 1, clip.y1 - 1), ax = fx - x0, ay = fy - y0;
  const w = RW(src.rect), idx = (xx, yy) => ((yy - src.rect.y0) * w + (xx - src.rect.x0)) * n, d = src.data;
  const T4 = [[idx(x0, y0), (1 - ax) * (1 - ay)], [idx(x1, y0), ax * (1 - ay)], [idx(x0, y1), (1 - ax) * ay], [idx(x1, y1), ax * ay]];
  for (const [i, k] of T4){
    if (k <= 0) continue;
    const a = alpha ? d[i + n - 1] * k : k;
    if (alpha){ for (let c = 0; c < n - 1; c++) acc[c] += d[i + c] * a; acc[n - 1] += a; }
    else for (let c = 0; c < n; c++) acc[c] += d[i + c] * a;
  }
}

/* 演算法登记处：各段把自己的东西挂上来
   KERNELS[变体名] = (src:Img, out:Rect, ctx:{bounds,mode,alpha}, fp) => Float32Array(RW(out)*RH(out)*4)（lib.rs kernel 的一支）
   REACH[名] = 各档的 reach 函数（halo 要用） */
const KERNELS = {}, REACH = {};

/* ── 选区（文件坐标的覆盖度 0..1；SelMask＝tools/marquee.js；没载入就退回矩形） ── */
function rectBytes(s, W, H){
  const out = new Uint8Array(W * H);
  const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++){
    const ox = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)), oy = Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
    out[y * W + x] = Math.floor(Math.min(1, ox * oy) * 255 + 0.5);
  }
  return out;
}
/* selCoverage() → null（没选区）或 {W,H,bytes, get(x,y)→0..1（画布外 0）, bounds:有覆盖的外框（content_bounds）} */
function selCoverage(){
  if (!Doc.sel) return null;
  const W = Doc.width, H = Doc.height, b = window.SelMask ? SelMask.bytes() : rectBytes(Doc.sel, W, H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[y * W + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return {W, H, bytes:b, get:(x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? b[y * W + x] / 255 : 0, bounds:x1 < 0 ? EMPTY : R(x0, y0, x1 + 1, y1 + 1)};
}
/* 前景／背景色＝右面板的填色／描边色块（toolbar：前景／背景色块＝填色／描边），回 [r,g,b,1] */
const hexRGBA = (h, d) => { const s = String(h || '').replace(/^#+/, ''); return /^[0-9a-fA-F]{6}/.test(s) ? [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255).concat([1]) : d; };
const fgColor = () => hexRGBA((document.getElementById('fillColor') || {}).value, [0, 0, 0, 1]);
const bgColor = () => hexRGBA((document.getElementById('strokeColor') || {}).value, [1, 1, 1, 1]);
const hex2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
const hexOf = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);

/* 不走 kernel 的命令（直接改整块图层：平均、云彩、火焰／树／图片框、液化、镜头校正、自适应广角、Camera Raw、消失点…）
   SURF_OPS[原码 id] = (L 目前像素层, p 命令参数, opt {preview:bool}) => 结果物件（会回给 agent）；要报错就 throw new FltBad('…')
   PARAM_SPECS[原码 id] = 原码的参数说明字串（registry notation，对话框照它生成栏位、listCommands 也吐它）
   CUSTOM_DIALOGS[原码 id] = init => Dlg.open({...})   自订对话框（没登记的就用参数表自动生成）
   NO_DIALOG[原码 id] = true  不开对话框、点了直接做 */
class FltBad extends Error {}
const SURF_OPS = {}, PARAM_SPECS = {}, CUSTOM_DIALOGS = {}, NO_DIALOG = {};

/* ──────────────── 段：05-i18n.js ──────────────── */
/* ═══════════ 三语小工具（界面字串一律 S(繁, 简, 英)、显示时 tr() 取目前语言；不改 i18n.js） ═══════════ */
const S = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, en:c});
const tr = o => (o && (o[Lang.cur] || o.en)) || '';
const UI_STR = {preview:S('預視', '预览', 'Preview'), ok:S('確定', '确定', 'OK'), cancel:S('取消', '取消', 'Cancel'), error:S('無法完成：', '无法完成：', 'Could not complete: '),
  none:S('無', '无', 'None'), thisDoc:S('此文件（合併）', '本文件（合并）', 'This document (merged)'), mapLayer:S('置換圖圖層', '置换图图层', 'Map Layer'), pickMap:S('按確定後選取檔案…', '按确定后选择文件…', 'Choose a file after OK…'), mapFile:S('檔案：', '文件：', 'File: '), merged:S('合併', '合并', 'Merged'),
  lastFilter:S('上次濾鏡', '上次滤镜操作', 'Last Filter'), noLast:S('還沒套用過濾鏡', '还没用过滤镜', 'no filter applied yet'), randomize:S('隨機', '随机', 'Randomize')};
const t = k => tr(UI_STR[k]) || k;

/* ──────────────── 段：06-transform.js ──────────────── */
/* ═══════════ 共用：投影变换与重采样（algo/src/transform.rs 1-269、algo/src/resample.rs 1-185） ═══════════
   Homography：3×3 列主序 [x',y',w'] = H·[x,y,1]；warpSurface：逆映射、预乘取样（邻近／双线性／Catmull-Rom 双立方），大幅缩小先用 resizeSurface 预缩。 */
class Homography {
  constructor(m){ this.m = m; }
  static identity(){ return new Homography([1, 0, 0, 0, 1, 0, 0, 0, 1]); }
  apply(x, y){ const m = this.m, w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; }   // transform.rs:24
  mul(o){ const a = this.m, b = o.m, r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++){ let s = 0; for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j]; r[i * 3 + j] = s; } return new Homography(r); }
  inverse(){                                                       // transform.rs:41
    const m = this.m, c = [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
    const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
    if (Math.abs(det) < 1e-12) return null;
    return new Homography(c.map(v => v / det));
  }
  static squareToQuad(q){                                          // transform.rs:62
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return new Homography([x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]);
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return new Homography([x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]);
  }
  static rectToQuad(r, quad){                                      // transform.rs:81
    const w = r[2] - r[0], h = r[3] - r[1]; if (w <= 0 || h <= 0) return null;
    const s = Homography.squareToQuad(quad); if (!s) return null;
    return s.mul(new Homography([1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1]));
  }
  localScale(x, y){                                                // transform.rs:91
    const e = 0.5, a = this.apply(x - e, y), b = this.apply(x + e, y), c = this.apply(x, y - e), d = this.apply(x, y + e);
    const jx = [b[0] - a[0], b[1] - a[1]], jy = [d[0] - c[0], d[1] - c[1]];
    return Math.sqrt(Math.abs(jx[0] * jy[1] - jx[1] * jy[0]));
  }
}
const tf_catmullRom = t => { const t2 = t * t, t3 = t2 * t; return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]; };   // transform.rs:120
/* resample.rs:23-65 Resample 的支撑与权重 */
const TF_SUPPORT = {nearest:0.5, bilinear:1, bicubic:2, lanczos:3, preserveDetails:3};
function tf_weight(f, x){
  x = Math.abs(x);
  if (f === 'nearest') return x <= 0.5 ? 1 : 0;
  if (f === 'bilinear') return Math.max(1 - x, 0);
  if (f === 'bicubic'){ const a = -0.5; return x < 1 ? (a + 2) * x * x * x - (a + 3) * x * x + 1 : x < 2 ? a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a : 0; }
  if (x < 1e-9) return 1; if (x < 3){ const px = Math.PI * x; return 3 * Math.sin(px) * Math.sin(px / 3) / (px * px); } return 0;
}
/* resample.rs:75 taps：输出坐标 o → 来源 u = (o+.5)/scale − .5 的取样窗与正规化权重 */
function tf_taps(d0, d1, scale, f){
  const stretch = scale < 1 ? 1 / scale : 1, support = TF_SUPPORT[f] * stretch, out = [];
  for (let o = d0; o < d1; o++){
    const u = (o + 0.5) / scale - 0.5;
    if (f === 'nearest' && scale >= 1){ out.push({start:Math.floor(u + 0.5), w:[1]}); continue; }
    const lo = Math.ceil(u - support), hi = Math.floor(u + support), w = [];
    for (let i = lo; i <= hi; i++) w.push(tf_weight(f, (i - u) / stretch));
    const s = w.reduce((a, b) => a + b, 0); if (Math.abs(s) > 1e-12) for (let i = 0; i < w.length; i++) w[i] /= s;
    out.push({start:lo, w});
  }
  return out;
}
function scaledRect(r, sx, sy){ if (rEmpty(r)) return EMPTY; return R(Math.floor(r.x0 * sx), Math.floor(r.y0 * sy), Math.ceil(r.x1 * sx), Math.ceil(r.y1 * sy)); }   // resample.rs:99
/* resample.rs:108 resize_surface：绕文件原点缩放（可分离、预乘） */
function resizeSurface(s, sx, sy, f){
  const src = s.contentBounds(), dst = scaledRect(src, sx, sy), out = new Surf(dst.x0, dst.y0, Math.max(0, RW(dst)), Math.max(0, RH(dst)));
  if (rEmpty(dst)) return new Surf(0, 0, 0, 0);
  const n = 4, hx = tf_taps(dst.x0, dst.x1, sx, f), vy = tf_taps(dst.y0, dst.y1, sy, f);
  const xLo = Math.min(...hx.map(t => t.start)), xHi = Math.max(...hx.map(t => t.start + t.w.length));
  const yLo = Math.min(...vy.map(t => t.start)), yHi = Math.max(...vy.map(t => t.start + t.w.length));
  const read = R(xLo, yLo, xHi, yHi), rows = s.readRegion(read); premultiply(rows, n, true);
  const rw = RW(read), nrows = RH(read), dw = RW(dst), tmp = new Float32Array(nrows * dw * n);
  for (let r = 0; r < nrows; r++) for (let ox = 0; ox < dw; ox++){
    const t = hx[ox], d = (r * dw + ox) * n;
    for (let k = 0; k < t.w.length; k++){ const sp = (r * rw + (t.start + k - xLo)) * n, w = t.w[k]; for (let c = 0; c < n; c++) tmp[d + c] += rows[sp + c] * w; }
  }
  const res = new Float32Array(RH(dst) * dw * n);
  for (let oy = 0; oy < vy.length; oy++){
    const t = vy[oy];
    for (let k = 0; k < t.w.length; k++){ const r = t.start + k - yLo, w = t.w[k], sp = r * dw * n, dp = oy * dw * n; for (let i = 0; i < dw * n; i++) res[dp + i] += tmp[sp + i] * w; }
  }
  for (let j = 0; j < res.length; j += n) res[j + 3] = clamp(res[j + 3], 0, 1);
  unpremultiply(res, n, true);
  out.writeRegion(dst, res);
  return out;
}
/* transform.rs:129 warp_surface：把 src（内容在 srcRect）用 h（来源→文件）扭过去；四边形外透明 */
function warpSurface(src, srcRect, h, interp){
  interp = interp || 'bicubic';
  if (rEmpty(srcRect)) return new Surf(0, 0, 0, 0);
  const cx0 = (srcRect.x0 + srcRect.x1) / 2, cy0 = (srcRect.y0 + srcRect.y1) / 2, scale = h.localScale(cx0, cy0);
  if (interp !== 'nearest' && scale < 0.5 && scale > 0){              // 大幅缩小先预缩（双立方单独会锯齿）
    const f = Math.min(Math.pow(2, Math.ceil(Math.log2(scale))), 1);
    src = resizeSurface(src, f, f, 'bicubic');
    h = h.mul(new Homography([1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1]));
    srcRect = scaledRect(srcRect, f, f);
  }
  const inv = h.inverse(); if (!inv) return new Surf(0, 0, 0, 0);
  const corners = [[srcRect.x0, srcRect.y0], [srcRect.x1, srcRect.y0], [srcRect.x1, srcRect.y1], [srcRect.x0, srcRect.y1]].map(([x, y]) => h.apply(x, y));
  if (corners.some(c => !isFinite(c[0]) || !isFinite(c[1]))) return new Surf(0, 0, 0, 0);
  const lim = 1 << 20;
  const bx0 = Math.max(Math.floor(Math.min(...corners.map(c => c[0]))), -lim) - 1, by0 = Math.max(Math.floor(Math.min(...corners.map(c => c[1]))), -lim) - 1;
  const bx1 = Math.min(Math.ceil(Math.max(...corners.map(c => c[0]))), lim) + 1, by1 = Math.min(Math.ceil(Math.max(...corners.map(c => c[1]))), lim) + 1;
  const dst = R(bx0, by0, bx1, by1);
  const tc = [[dst.x0, dst.y0], [dst.x1, dst.y0], [dst.x1, dst.y1], [dst.x0, dst.y1]].map(([x, y]) => inv.apply(x, y));
  // 我们不分块：来源窗口＝目的框反映射外框（各边多 3 格）∩ srcRect
  let foot = rInter(R(Math.floor(Math.min(...tc.map(c => c[0]))) - 3, Math.floor(Math.min(...tc.map(c => c[1]))) - 3, Math.ceil(Math.max(...tc.map(c => c[0]))) + 3, Math.ceil(Math.max(...tc.map(c => c[1]))) + 3), srcRect);
  if (!isFinite(foot.x0) || rEmpty(foot)) foot = srcRect;
  const n = 4, px = src.readRegion(foot); premultiply(px, n, true);
  const fw = RW(foot), at = (x, y, c) => (x < foot.x0 || y < foot.y0 || x >= foot.x1 || y >= foot.y1) ? 0 : px[((y - foot.y0) * fw + (x - foot.x0)) * n + c];
  const w = RW(dst), outp = new Float32Array(w * RH(dst) * n), acc = new Float64Array(n);
  for (let y = dst.y0; y < dst.y1; y++) for (let x = dst.x0; x < dst.x1; x++){
    let [u, v] = inv.apply(x + 0.5, y + 0.5); u -= 0.5; v -= 0.5;
    if (u < srcRect.x0 - 1 || v < srcRect.y0 - 1 || u > srcRect.x1 || v > srcRect.y1) continue;
    acc.fill(0);
    if (interp === 'nearest'){ const ix = Math.floor(u + 0.5), iy = Math.floor(v + 0.5); for (let c = 0; c < n; c++) acc[c] = at(ix, iy, c); }
    else if (interp === 'bilinear'){
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      for (const [dy, wy] of [[0, 1 - fy], [1, fy]]) for (const [dx, wx] of [[0, 1 - fx], [1, fx]]) for (let c = 0; c < n; c++) acc[c] += at(ix + dx, iy + dy, c) * wx * wy;
    } else {
      const ix = Math.floor(u), iy = Math.floor(v), wx = tf_catmullRom(u - ix), wy = tf_catmullRom(v - iy);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){ const k = wx[i] * wy[j]; for (let c = 0; c < n; c++) acc[c] += at(ix - 1 + i, iy - 1 + j, c) * k; }
    }
    const al = clamp(acc[3], 0, 1); if (al <= 0) continue;
    const o = ((y - dst.y0) * w + (x - dst.x0)) * n;
    for (let c = 0; c < 3; c++) outp[o + c] = clamp(acc[c] / al, 0, 1);
    outp[o + 3] = al;
  }
  const out = new Surf(dst.x0, dst.y0, w, RH(dst)); out.writeRegion(dst, outp);
  return out;
}

/* ──────────────── 段：10-basic.js ──────────────── */
/* ═══════════ 基本滤镜：algo/src/blur.rs、sharpen.rs、noise.rs（add、median）、other.rs、stylize.rs ═══════════
   KERNELS：gaussianBlur、boxBlur、motionBlur、radialBlur、surfaceBlur、unsharpMask、smartSharpen、highPass、addNoise、median、
            dustAndScratches、minimum、maximum、offset、mosaic、emboss、findEdges、solarize、invert、desaturate（lib.rs:660-679 kernel() 分派）
   我们只有 RGB＋alpha：stylize.rs 的 luma／set_gray 走 RGB 那条（to_rgba／from_rgba 在 RGB 模式＝原样），算法不改。
   效能：热回圈（卷积、盒状三遍、表面模糊、中间值、最小／最大）都用预先配好的 Float32Array，不在每格里配置新阵列。 */

const bl_F32MAX = 3.4028234663852886e38, bl_F32MIN = -3.4028234663852886e38;   // f32::MAX／f32::MIN

/* ────────────────── blur.rs ────────────────── */

/* blur.rs:9 gaussian_kernel：标准差 sigma 的归一化高斯核（半径 3σ） */
function bl_gaussianKernel(sigma){
  if (sigma < 0.05) return new Float32Array([1]);
  const r = Math.ceil(sigma * 3) | 0;
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++){ k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

/* blur.rs:21 conv_sep：可分离卷积（内部预乘）；src 须盖住 out 外扩核半径 */
function bl_convSep(src, out, kx, ky, alpha){
  const n = src.ch;
  const rx = (kx.length / 2) | 0, ry = (ky.length / 2) | 0;
  const ow = RW(out), oh = RH(out);
  const th = oh + 2 * ry;
  // 需要的来源窗的预乘副本（fill＋premultiply＝核心 premulWindow）
  const win = R(out.x0 - rx, out.y0 - ry, out.x1 + rx, out.y1 + ry);
  const ww = RW(win);
  const p = premulWindow(src, win, alpha);
  // 水平一遍：(ow × th)
  const tmp = new Float32Array(ow * th * n), kl = kx.length;
  for (let ty = 0; ty < th; ty++){
    const row = ty * ww * n, dst = ty * ow * n;
    for (let ox = 0; ox < ow; ox++){
      const d = dst + ox * n;
      for (let c = 0; c < n; c++){
        let acc = 0;
        for (let i = 0, s = row + ox * n + c; i < kl; i++, s += n) acc += p[s] * kx[i];
        tmp[d + c] = acc;
      }
    }
  }
  // 垂直一遍
  const res = new Float32Array(ow * oh * n), rl = ow * n, kyl = ky.length;
  for (let oy = 0; oy < oh; oy++){
    const d = oy * rl;
    for (let i = 0; i < kyl; i++){
      const s = (oy + i) * rl, kv = ky[i];
      for (let j = 0; j < rl; j++) res[d + j] += tmp[s + j] * kv;
    }
  }
  unpremultiply(res, n, alpha);
  return res;
}

/* blur.rs:69 gaussian：小半径用精确核；大于 4 用三遍盒状近似（Kovesi 2010，成本与半径无关） */
function bl_gaussian(src, out, ctx, radius){
  if (radius <= 4){
    const k = bl_gaussianKernel(radius);
    return bl_convSep(src, out, k, k, ctx.alpha);
  }
  return bl_gaussianBoxes(src, out, ctx.alpha, radius);
}

/* blur.rs:80 boxes_for_gauss：n 次卷积后标准差为 sigma 的奇数盒宽 */
function bl_boxesForGauss(sigma, n){
  const nf = n;
  const wIdeal = Math.sqrt(12 * sigma * sigma / nf + 1);
  let wl = Math.floor(wIdeal) | 0;
  if (wl % 2 === 0) wl -= 1;
  wl = Math.max(wl, 1);
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - nf * (wl * wl) - 4 * nf * wl - 3 * nf) / (-4 * wl - 4);
  const m = clamp(rround(mIdeal), 0, nf);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
  return out;
}

/* blur.rs:95 box_rows ／ blur.rs:148 transpose：原码＝每行滑动和（边缘夹住）→ 转置 → 再每行 → 转回。
   转置后做行＝直接做列，所以用核心的 boxRowsN／boxColsN（同样的夹边滑动和，数学上相同），不再自写一份。 */

/* blur.rs:177 gaussian_boxes：在预乘窗上每轴三遍盒状模糊 */
function bl_gaussianBoxes(src, out, alpha, sigma){
  const n = src.ch;
  const boxes = bl_boxesForGauss(sigma, 3);
  let margin = 1;
  for (const w of boxes) margin += ((w - 1) / 2) | 0;
  const win = R(out.x0 - margin, out.y0 - margin, out.x1 + margin, out.y1 + margin);
  const ww = RW(win), wh = RH(win);
  const p = premulWindow(src, win, alpha);                         // fill＋premultiply
  for (const w of boxes) boxRowsN(p, ww, wh, n, (w - 1) / 2);
  for (const w of boxes) boxColsN(p, ww, wh, n, (w - 1) / 2);     // ＝ transpose → box_rows → transpose
  const ow = RW(out), oh = RH(out);
  const res = new Float32Array(ow * oh * n);
  for (let y = 0; y < oh; y++){
    const s = ((y + margin) * ww + margin) * n;
    res.set(p.subarray(s, s + ow * n), y * ow * n);
  }
  unpremultiply(res, n, alpha);
  return res;
}

/* blur.rs:218 boxed：(2r+1) 方盒均值 */
function bl_boxed(src, out, ctx, radius){
  const r = rround(Math.max(radius, 0)) | 0;
  const k = new Float32Array(2 * r + 1).fill(1 / (2 * r + 1));
  return bl_convSep(src, out, k, k, ctx.alpha);
}

/* blur.rs:224 average_samples：每格取一串取样点（双线性、外面透明）的预乘平均
   offsets(cx, cy, pts) 把点写进 pts（扁平 [x0,y0,x1,y1,…]）、回传点数 */
function bl_averageSamples(src, out, ctx, maxPts, offsets){
  const n = src.ch;
  const res = new Float32Array(RW(out) * RH(out) * n);
  const pts = new Float64Array(maxPts * 2);
  const tmp = new Float32Array(n), acc = new Float32Array(n);
  let p = 0;
  for (let y = out.y0; y < out.y1; y++){
    for (let x = out.x0; x < out.x1; x++){
      const cx = x + 0.5, cy = y + 0.5;
      const cnt = offsets(cx, cy, pts);
      acc.fill(0);
      for (let j = 0; j < cnt; j++){
        src.sample(pts[j * 2], pts[j * 2 + 1], EDGE.Transparent, src.rect, ctx.alpha, tmp);
        // 预乘累加
        const a = ctx.alpha ? tmp[n - 1] : 1;
        for (let c = 0; c < n; c++) acc[c] += (ctx.alpha && c < n - 1) ? tmp[c] * a : tmp[c];
      }
      const k = 1 / Math.max(cnt, 1);
      for (let c = 0; c < n; c++) acc[c] *= k;
      if (ctx.alpha){
        const a = acc[n - 1];
        for (let c = 0; c < n - 1; c++) acc[c] = a > 1e-7 ? acc[c] / a : 0;
      }
      res.set(acc, p); p += n;
    }
  }
  return res;
}

/* blur.rs:262 motion：沿角度方向、长 distance 的线段上平均 */
function bl_motion(src, out, ctx, angle, distance){
  const d = Math.abs(distance);
  if (d < 0.5) return src.crop(out);
  const s = Math.sin(angle * DEG), c = Math.cos(angle * DEG);
  const steps = Math.ceil(d) | 0;
  return bl_averageSamples(src, out, ctx, steps + 1, (x, y, pts) => {
    let k = 0;
    for (let i = 0; i <= steps; i++){
      const t = i / steps - 0.5;
      pts[k++] = x + c * d * t; pts[k++] = y - s * d * t;
    }
    return steps + 1;
  });
}

/* blur.rs:277 radial：旋转＝以像素为中心的 amount 度圆弧；缩放＝沿射线往中心至多 amount/2 % */
function bl_radial(src, out, ctx, amount, method, center){
  const b = ctx.bounds;
  const cx = b.x0 + RW(b) * center[0], cy = b.y0 + RH(b) * center[1];
  amount = clamp(amount, 0, 100);
  return bl_averageSamples(src, out, ctx, 65, (x, y, pts) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    let k = 0;
    if (method === 'spin'){
      // 以像素为中心、amount 度的圆弧
      const arc = amount * DEG;
      const n = clamp(Math.ceil(arc * r) | 0, 1, 64);
      for (let i = 0; i <= n; i++){
        const t = (i / n - 0.5) * arc;
        const s = Math.sin(t), c = Math.cos(t);
        pts[k++] = cx + dx * c - dy * s; pts[k++] = cy + dx * s + dy * c;
      }
      return n + 1;
    }
    // zoom：沿射线取样，最多往中心靠近 amount/2 %
    const span = amount / 200;
    const n = clamp(Math.ceil(span * r) | 0, 1, 64);
    for (let i = 0; i <= n; i++){
      const kk = 1 - span * i / n;
      pts[k++] = cx + dx * kk; pts[k++] = cy + dy * kk;
    }
    return n + 1;
  });
}

/* blur.rs:308 surface：表面模糊——方窗内按与中心值差距线性降权（透明格不算）
   （三个颜色通道在同一趟窗扫描里各自累加，加法顺序与原码逐通道相同） */
function bl_surface(src, out, ctx, radius, threshold){
  const n = src.ch;
  const cc = ctx.alpha ? n - 1 : n;
  const r = rround(Math.max(radius, 0)) | 0;
  const t = (Math.max(threshold, 1) / 255) * 2.5;
  const res = new Float32Array(RW(out) * RH(out) * n);
  const sr = src.rect, sw = RW(sr), sd = src.data;
  const acc = new Float64Array(cc), wsum = new Float64Array(cc), v0 = new Float32Array(n);
  let p = 0;
  // 常见情形（RGBA）：三个通道用区域变数累加，省掉阵列读写；逻辑与下面通用路径相同
  if (ctx.alpha && n === 4){
    for (let y = out.y0; y < out.y1; y++){
      for (let x = out.x0; x < out.x1; x++){
        const pi0 = src.index(x, y), r0 = sd[pi0], g0 = sd[pi0 + 1], b0 = sd[pi0 + 2];
        let ar = 0, ag = 0, ab = 0, wr = 0, wg = 0, wb = 0;
        for (let yy = y - r; yy <= y + r; yy++){
          if (yy < sr.y0 || yy >= sr.y1) continue;                  // 窗外读到 alpha 0 → 跳过
          const rb = (yy - sr.y0) * sw;
          const xa = Math.max(x - r, sr.x0), xb = Math.min(x + r, sr.x1 - 1);
          for (let xx = xa, i = (rb + xa - sr.x0) * 4; xx <= xb; xx++, i += 4){
            if (sd[i + 3] <= 0) continue;
            let v = sd[i], w = 1 - Math.abs(v - r0) / t; if (w < 0) w = 0; ar += v * w; wr += w;
            v = sd[i + 1]; w = 1 - Math.abs(v - g0) / t; if (w < 0) w = 0; ag += v * w; wg += w;
            v = sd[i + 2]; w = 1 - Math.abs(v - b0) / t; if (w < 0) w = 0; ab += v * w; wb += w;
          }
        }
        res[p] = wr > 0 ? ar / wr : r0; res[p + 1] = wg > 0 ? ag / wg : g0; res[p + 2] = wb > 0 ? ab / wb : b0; res[p + 3] = sd[pi0 + 3];
        p += 4;
      }
    }
    return res;
  }
  for (let y = out.y0; y < out.y1; y++){
    for (let x = out.x0; x < out.x1; x++){
      const pi0 = src.index(x, y);
      for (let c = 0; c < n; c++) v0[c] = sd[pi0 + c];
      acc.fill(0); wsum.fill(0);
      for (let yy = y - r; yy <= y + r; yy++){
        const rowIn = yy >= sr.y0 && yy < sr.y1, rb = (yy - sr.y0) * sw;
        for (let xx = x - r; xx <= x + r; xx++){
          const inside = rowIn && xx >= sr.x0 && xx < sr.x1, i = (rb + xx - sr.x0) * n;
          if (ctx.alpha && (inside ? sd[i + n - 1] : 0) <= 0) continue;
          for (let c = 0; c < cc; c++){
            const v = inside ? sd[i + c] : 0;
            const w = Math.max(1 - Math.abs(v - v0[c]) / t, 0);
            acc[c] += v * w;
            wsum[c] += w;
          }
        }
      }
      for (let c = 0; c < cc; c++) res[p + c] = wsum[c] > 0 ? acc[c] / wsum[c] : v0[c];
      if (ctx.alpha) res[p + n - 1] = v0[n - 1];
      p += n;
    }
  }
  return res;
}

/* ────────────────── sharpen.rs ────────────────── */

/* sharpen.rs:9 with_blur：原图与（精确核）高斯模糊逐颜色通道合成；透明格不动 */
function bl_withBlur(src, out, ctx, radius, f){
  const k = bl_gaussianKernel(radius);
  const blurred = bl_convSep(src, out, k, k, ctx.alpha);
  const res = src.crop(out);
  const n = src.ch;
  const cc = ctx.alpha ? n - 1 : n;
  for (let p = 0; p < res.length; p += n){
    if (ctx.alpha && res[p + n - 1] <= 0) continue;
    for (let c = 0; c < cc; c++) res[p + c] = f(res[p + c], blurred[p + c]);
  }
  return res;
}

/* sharpen.rs:26 unsharp：USM（差距达门槛才加强） */
function bl_unsharp(src, out, ctx, amount, radius, threshold){
  const k = amount / 100;
  const t = threshold / 255;
  return bl_withBlur(src, out, ctx, radius, (o, b) => {
    const d = o - b;
    return Math.abs(d) + 1e-6 >= t ? o + k * d : o;
  });
}

/* sharpen.rs:35 smart：智能锐化（基本版）——小（杂讯级）差距被压低 */
function bl_smart(src, out, ctx, amount, radius, reduceNoise){
  const k = amount / 100;
  const nr = clamp(reduceNoise / 100, 0, 1);
  return bl_withBlur(src, out, ctx, radius, (o, b) => {
    const d = o - b;
    const keep = 1 - nr * Math.exp(-(Math.abs(d) * 40));
    return o + k * d * keep;
  });
}

/* sharpen.rs:46 high_pass：0.5＋（原－模糊） */
function bl_highPass(src, out, ctx, radius){
  return bl_withBlur(src, out, ctx, radius, (o, b) => 0.5 + (o - b));
}

/* ────────────────── noise.rs（hash01 在核心） ────────────────── */

/* noise.rs:24 add：amount 100 %＝均匀 ±50 %；高斯以同 amount 为约 2σ */
function bl_addNoise(src, out, ctx, amount, dist, mono, seed){
  const n = src.ch;
  const cc = ctx.alpha ? n - 1 : n;
  const a = Math.max(amount, 0) / 100 * 0.5;
  const res = src.crop(out);
  const w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    if (ctx.alpha && res[p + n - 1] <= 0) continue;
    const x = out.x0 + i % w, y = out.y0 + ((i / w) | 0);
    for (let c = 0; c < cc; c++){
      const ch = mono ? 0 : c;
      let v;
      if (dist === 'gaussian'){
        const u1 = Math.max(hash01(x, y, ch * 2 + 101, seed), 1e-7);
        const u2 = hash01(x, y, ch * 2 + 102, seed);
        v = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2) * a * 0.5;
      } else v = (hash01(x, y, ch, seed) - 0.5) * 2 * a;
      // 整数储存写入时会夹住；浮点保留原值
      res[p + c] += v;
    }
  }
  return res;
}

/* 原码 select_nth_unstable_by(mid, total_cmp) 取第 k 小的值：就地快速选择（结果值唯一确定，与演算法无关） */
function bl_selectNth(a, len, k){
  let lo = 0, hi = len - 1;
  while (hi > lo){
    // 三数取中当枢轴
    const mid = (lo + hi) >> 1;
    let x = a[lo], y = a[mid], z = a[hi];
    const piv = x < y ? (y < z ? y : (x < z ? z : x)) : (x < z ? x : (y < z ? z : y));
    let i = lo, j = hi;
    while (i <= j){
      while (a[i] < piv) i++;
      while (a[j] > piv) j--;
      if (i <= j){ const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

/* noise.rs:54 median：半径 radius 圆盘（dx²+dy² ≤ r²+r）上的中间值；有 threshold 时只在与中间值差超过门槛才替换（灰尘与刮痕） */
function bl_median(src, out, radius, threshold){
  const n = src.ch;
  const r = rround(Math.max(radius, 0)) | 0;
  if (r === 0) return src.crop(out);
  const offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offs.push(dx, dy);
  const m = offs.length / 2;
  const offX = new Int32Array(m), offY = new Int32Array(m);
  for (let j = 0; j < m; j++){ offX[j] = offs[j * 2]; offY[j] = offs[j * 2 + 1]; }
  const t = threshold == null ? null : threshold / 255;
  const vals = new Float32Array(m), mid = (m / 2) | 0;
  const res = new Float32Array(RW(out) * RH(out) * n);
  const sr = src.rect, sw = RW(sr), sd = src.data;
  // 圆盘整个在 src 里面时直接用位移索引
  const rel = new Int32Array(m);
  for (let j = 0; j < m; j++) rel[j] = (offY[j] * sw + offX[j]) * n;
  let p = 0;
  for (let y = out.y0; y < out.y1; y++){
    const rowsIn = y - r >= sr.y0 && y + r < sr.y1;
    for (let x = out.x0; x < out.x1; x++){
      const inside = rowsIn && x - r >= sr.x0 && x + r < sr.x1;
      const base = inside ? src.index(x, y) : 0;
      for (let c = 0; c < n; c++){
        if (inside) for (let j = 0; j < m; j++) vals[j] = sd[base + rel[j] + c];
        else for (let j = 0; j < m; j++) vals[j] = src.get(x + offX[j], y + offY[j], c);
        const md = bl_selectNth(vals, m, mid);
        const o = src.get(x, y, c);
        res[p++] = (t !== null && Math.abs(o - md) <= t) ? o : md;
      }
    }
  }
  return res;
}

/* ────────────────── other.rs ────────────────── */

/* other.rs:10 min_max_preserve：保留方形（min_max）或圆度（min_max_round） */
function bl_minMaxPreserve(src, out, radius, max, preserve){
  return preserve === 'roundness' ? bl_minMaxRound(src, out, radius, max) : bl_minMax(src, out, radius, max);
}

/* other.rs:21 min_max_round：圆盘（dx²+dy² ≤ radius²）上的最小／最大；圆盘每行是一个水平窗，用 van Herk／Gil-Werman 滑动极值 */
function bl_minMaxRound(src, out, radius, max){
  const n = src.ch;
  const r = Math.max(radius, 0);
  const ri = Math.floor(r) | 0;
  if (ri === 0) return src.crop(out);
  const w = RW(out), h = RH(out);
  const res = new Float32Array(w * h * n).fill(max ? bl_F32MIN : bl_F32MAX);
  const cap = w + 2 * ri;
  const row = new Float32Array(cap), ext = new Float32Array(cap), pre = new Float32Array(cap), suf = new Float32Array(cap);
  const sr = src.rect, sd = src.data;
  for (let dy = -ri; dy <= ri; dy++){
    // 这一行圆盘的半宽（加 epsilon 让刚好的平方数成立，例如 r 5、dy 3 → 4）
    const hw = Math.floor(Math.sqrt(Math.max(r * r - dy * dy, 0)) + 1e-4) | 0;
    const len = w + 2 * hw;
    for (let y = out.y0; y < out.y1; y++){
      const o = (y - out.y0) * w * n;
      for (let c = 0; c < n; c++){
        const yy = y + dy, xs = out.x0 - hw;
        if (yy >= sr.y0 && yy < sr.y1 && xs >= sr.x0 && xs + len <= sr.x1){
          for (let i = 0, s = src.index(xs, yy) + c; i < len; i++, s += n) row[i] = sd[s];
        } else for (let i = 0; i < len; i++) row[i] = src.get(xs + i, yy, c);
        const cnt = bl_runningExtreme(row, len, 2 * hw + 1, max, ext, pre, suf);
        for (let x = 0; x < cnt; x++){
          const i = o + x * n + c, v = ext[x];
          res[i] = max ? (v > res[i] ? v : res[i]) : (v < res[i] ? v : res[i]);
        }
      }
    }
  }
  return res;
}

/* other.rs:53 running_extreme：out[i]＝v[i..i+k] 的极值（每个完整窗）；回传个数。
   v 只看前 len 个；out、pre、suf 是呼叫方配好的暂存（长度 ≥ len） */
function bl_runningExtreme(v, len, k, max, out, pre, suf){
  if (k <= 1){ for (let i = 0; i < len; i++) out[i] = v[i]; return len; }
  if (len < k) return 0;
  // pick＝f32::max／f32::min（无 NaN）；最大、最小各写一份免得每步走闭包
  for (let i = 0; i < len; i++){ pre[i] = v[i]; suf[i] = v[i]; }
  const cnt = len - k + 1;
  if (max){
    for (let i = 1; i < len; i++) if (i % k !== 0){ const a = pre[i - 1], b = v[i]; pre[i] = b > a ? b : a; }
    for (let i = len - 2; i >= 0; i--) if ((i + 1) % k !== 0){ const a = suf[i + 1], b = v[i]; suf[i] = b > a ? b : a; }
    for (let i = 0; i < cnt; i++){ const a = suf[i], b = pre[i + k - 1]; out[i] = b > a ? b : a; }
  } else {
    for (let i = 1; i < len; i++) if (i % k !== 0){ const a = pre[i - 1], b = v[i]; pre[i] = b < a ? b : a; }
    for (let i = len - 2; i >= 0; i--) if ((i + 1) % k !== 0){ const a = suf[i + 1], b = v[i]; suf[i] = b < a ? b : a; }
    for (let i = 0; i < cnt; i++){ const a = suf[i], b = pre[i + k - 1]; out[i] = b < a ? b : a; }
  }
  return cnt;
}

/* other.rs:80 min_max：方形窗的最小（扩张暗／透明区）或最大；可分离：先行后列 */
function bl_minMax(src, out, radius, max){
  const n = src.ch;
  const r = rround(Math.max(radius, 0)) | 0;
  if (r === 0) return src.crop(out);
  const win = R(out.x0, out.y0 - r, out.x1, out.y1 + r);
  const ww = RW(win);
  const tmp = new Float32Array(ww * RH(win) * n);
  const init = max ? bl_F32MIN : bl_F32MAX;
  const sr = src.rect, sw = RW(sr), sd = src.data;
  for (let y = win.y0; y < win.y1; y++){
    const rowIn = y >= sr.y0 && y < sr.y1, rb = (y - sr.y0) * sw;
    for (let x = win.x0; x < win.x1; x++){
      for (let c = 0; c < n; c++){
        let m = init;
        for (let xx = x - r; xx <= x + r; xx++){
          const v = (rowIn && xx >= sr.x0 && xx < sr.x1) ? sd[(rb + xx - sr.x0) * n + c] : 0;
          m = max ? (v > m ? v : m) : (v < m ? v : m);
        }
        tmp[((y - win.y0) * ww + (x - win.x0)) * n + c] = m;
      }
    }
  }
  const res = new Float32Array(RW(out) * RH(out) * n);
  let p = 0;
  for (let y = out.y0; y < out.y1; y++){
    for (let x = out.x0; x < out.x1; x++){
      for (let c = 0; c < n; c++){
        let m = init;
        for (let yy = y - r; yy <= y + r; yy++){
          const v = tmp[((yy - win.y0) * ww + (x - win.x0)) * n + c];
          m = max ? (v > m ? v : m) : (v < m ? v : m);
        }
        res[p++] = m;
      }
    }
  }
  return res;
}

/* other.rs:118 edge_of：未定义区域 → 边缘规则 */
function bl_edgeOf(u){ return u === 'repeat' ? EDGE.Repeat : u === 'transparent' ? EDGE.Transparent : EDGE.Wrap; }

/* other.rs:127 offset：bounds 内容整格位移 */
function bl_offset(src, out, ctx, dx, dy, undef){
  const n = src.ch;
  const edge = bl_edgeOf(undef);
  const res = new Float32Array(RW(out) * RH(out) * n);
  let p = 0;
  for (let y = out.y0; y < out.y1; y++) for (let x = out.x0; x < out.x1; x++) for (let c = 0; c < n; c++) res[p++] = src.getEdge(x - dx, y - dy, c, edge, ctx.bounds);
  return res;
}

/* ────────────────── stylize.rs ────────────────── */

/* stylize.rs:20 set_gray：把颜色换成灰 g（RGB 模式：from_rgba([g,g,g,a])＝原样），alpha 保留 */
function bl_setGray(ctx, px, n, p, g){
  const a = ctx.alpha ? px[p + n - 1] : 1;
  px[p] = g; px[p + 1] = g; px[p + 2] = g;
  if (n > 3) px[p + 3] = a;
}

/* stylize.rs:27 per_pixel：颜色通道过 f（alpha 不动） */
function bl_perPixel(src, out, ctx, f){
  const n = src.ch;
  const cc = ctx.alpha ? n - 1 : n;
  const res = src.crop(out);
  for (let p = 0; p < res.length; p += n) for (let c = 0; c < cc; c++) res[p + c] = f(res[p + c]);
  return res;
}

/* stylize.rs:39 desaturate：换成 Rec.601 亮度灰 */
function bl_desaturate(src, out, ctx){
  const n = src.ch;
  const res = src.crop(out);
  for (let p = 0; p < res.length; p += n){
    const g = lumaOf(ctx, res.subarray(p, p + n));
    bl_setGray(ctx, res, n, p, g);
  }
  return res;
}

/* stylize.rs:51 mosaic：格子以 bounds 原点为锚；每格＝它在 bounds 内部分的（预乘）平均
   原码只快取一格（每行重算）；这里把同一格列的格子留着重用，值完全相同 */
function bl_mosaic(src, out, ctx, cell){
  const n = src.ch;
  const cs = rround(Math.max(cell, 1)) | 0;
  const b = ctx.bounds;
  const res = new Float32Array(RW(out) * RH(out) * n);
  const cellAvg = (cx, cy) => {
    const r = rInter(R(b.x0 + cx * cs, b.y0 + cy * cs, b.x0 + (cx + 1) * cs, b.y0 + (cy + 1) * cs), b);
    const acc = new Float32Array(n);
    let count = 0;
    for (let yy = r.y0; yy < r.y1; yy++){
      for (let xx = r.x0; xx < r.x1; xx++){
        const a = ctx.alpha ? src.get(xx, yy, n - 1) : 1;
        for (let c = 0; c < n; c++){ const s = src.get(xx, yy, c); acc[c] += (ctx.alpha && c < n - 1) ? s * a : s; }
        count += 1;
      }
    }
    if (count > 0) for (let c = 0; c < n; c++) acc[c] /= count;
    if (ctx.alpha){
      const a = acc[n - 1];
      for (let c = 0; c < n - 1; c++) acc[c] = a > 1e-7 ? acc[c] / a : 0;
    }
    return acc;
  };
  let rowCy = null, rowCache = new Map(), p = 0;
  for (let y = out.y0; y < out.y1; y++){
    const cy = Math.floor((y - b.y0) / cs);
    if (cy !== rowCy){ rowCy = cy; rowCache = new Map(); }
    for (let x = out.x0; x < out.x1; x++){
      const cx = Math.floor((x - b.x0) / cs);
      let acc = rowCache.get(cx);
      if (!acc){ acc = cellAvg(cx, cy); rowCache.set(cx, acc); }
      res.set(acc, p); p += n;
    }
  }
  return res;
}

/* stylize.rs:94 emboss：沿光线角度的亮度差 → 灰色浮雕 */
function bl_emboss(src, out, ctx, angle, height, amount){
  const n = src.ch;
  const s = Math.sin(angle * DEG), c = Math.cos(angle * DEG);
  const h = Math.max(height, 1);
  const dx = rround(c * h) | 0, dy = rround(-s * h) | 0;
  const k = amount / 100;
  const res = src.crop(out);
  const tmp = new Float32Array(n);
  const lumAt = (x, y) => { for (let ci = 0; ci < n; ci++) tmp[ci] = src.get(x, y, ci); return lumaOf(ctx, tmp); };
  const w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + ((i / w) | 0);
    const g = 0.5 + k * (lumAt(x + dx, y + dy) - lumAt(x - dx, y - dy));
    bl_setGray(ctx, res, n, p, clamp(g, 0, 1));
  }
  return res;
}

/* stylize.rs:118 find_edges：每颜色通道 Sobel 幅度，白底暗边 */
function bl_findEdges(src, out, ctx){
  const n = src.ch;
  const cc = ctx.alpha ? n - 1 : n;
  const res = src.crop(out);
  const w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + ((i / w) | 0);
    for (let c = 0; c < cc; c++){
      const g_mm = src.get(x - 1, y - 1, c), g_0m = src.get(x, y - 1, c), g_pm = src.get(x + 1, y - 1, c);
      const g_m0 = src.get(x - 1, y, c), g_p0 = src.get(x + 1, y, c);
      const g_mp = src.get(x - 1, y + 1, c), g_0p = src.get(x, y + 1, c), g_pp = src.get(x + 1, y + 1, c);
      const gx = (g_pm + 2 * g_p0 + g_pp) - (g_mm + 2 * g_m0 + g_mp);
      const gy = (g_mp + 2 * g_0p + g_pp) - (g_mm + 2 * g_0m + g_pm);
      res[p + c] = clamp(1 - Math.sqrt(gx * gx + gy * gy) / 4, 0, 1);
    }
  }
  return res;
}

/* ────────────────── 登记（lib.rs:660-679 kernel() 分派） ────────────────── */
KERNELS.gaussianBlur = (src, out, ctx, fp) => bl_gaussian(src, out, ctx, fp.radius);
KERNELS.boxBlur = (src, out, ctx, fp) => bl_boxed(src, out, ctx, fp.radius);
KERNELS.motionBlur = (src, out, ctx, fp) => bl_motion(src, out, ctx, fp.angle, fp.distance);
KERNELS.radialBlur = (src, out, ctx, fp) => bl_radial(src, out, ctx, fp.amount, fp.method, [fp.centerX, fp.centerY]);
KERNELS.surfaceBlur = (src, out, ctx, fp) => bl_surface(src, out, ctx, fp.radius, fp.threshold);
KERNELS.unsharpMask = (src, out, ctx, fp) => bl_unsharp(src, out, ctx, fp.amount, fp.radius, fp.threshold);
KERNELS.smartSharpen = (src, out, ctx, fp) => bl_smart(src, out, ctx, fp.amount, fp.radius, fp.reduceNoise);
KERNELS.highPass = (src, out, ctx, fp) => bl_highPass(src, out, ctx, fp.radius);
KERNELS.addNoise = (src, out, ctx, fp) => bl_addNoise(src, out, ctx, fp.amount, fp.distribution, fp.monochromatic, fp.seed);
KERNELS.median = (src, out, ctx, fp) => bl_median(src, out, fp.radius, null);
KERNELS.dustAndScratches = (src, out, ctx, fp) => bl_median(src, out, fp.radius, fp.threshold);
KERNELS.minimum = (src, out, ctx, fp) => bl_minMaxPreserve(src, out, fp.radius, false, fp.preserve);
KERNELS.maximum = (src, out, ctx, fp) => bl_minMaxPreserve(src, out, fp.radius, true, fp.preserve);
KERNELS.offset = (src, out, ctx, fp) => bl_offset(src, out, ctx, fp.horizontal, fp.vertical, fp.undefinedAreas);
KERNELS.mosaic = (src, out, ctx, fp) => bl_mosaic(src, out, ctx, fp.cellSize);
KERNELS.emboss = (src, out, ctx, fp) => bl_emboss(src, out, ctx, fp.angle, fp.height, fp.amount);
KERNELS.findEdges = (src, out, ctx) => bl_findEdges(src, out, ctx);
KERNELS.solarize = (src, out, ctx) => bl_perPixel(src, out, ctx, v => v > 0.5 ? 1 - v : v);      // lib.rs:677
KERNELS.invert = (src, out, ctx) => bl_perPixel(src, out, ctx, v => 1 - v);                       // lib.rs:678
KERNELS.desaturate = (src, out, ctx) => bl_desaturate(src, out, ctx);

/* ──────────────── 段：11-distort.js ──────────────── */
/* ═══════════ 扭曲／视讯／其他（二）：algo/src/distort.rs（全档）、distort2.rs（全档）、video.rs（全档）、other2.rs（全档）＋ other.rs:118 edge_of ═══════════
   KERNELS：twirl、pinch、spherize、wave、ripple、polarCoordinates、displace、shear、zigZag、deInterlace、ntscColors、custom、hsbHsl
   我们只有 RGB＋alpha：ctx.mode 恒 'rgb'（原码 native 分支），CMYK／Lab／灰阶分支不用，算法不改。 */

/* other.rs:118 edge_of：未定义区域 → 取样边缘规则（别段也在翻 other.rs，这里自带一份） */
function ds_edgeOf(u){
  switch (u){
    case 'wrap': return EDGE.Wrap;
    case 'repeat': return EDGE.Repeat;
    case 'transparent': return EDGE.Transparent;
  }
  return EDGE.Wrap;
}
/* Rust f32::signum：+0 → 1、-0 → -1、NaN → NaN */
const ds_signum = v => v !== v ? NaN : (v > 0 || Object.is(v, 0)) ? 1 : -1;

/* ────────────────── distort.rs ────────────────── */

/* distort.rs:12 remap：逆映射＋双线性重取样（在 ctx.bounds 内照 edge 规则取样） */
function ds_remap(src, out, ctx, edge, f){
  const n = src.ch, res = new Float32Array(RW(out) * RH(out) * n), tmp = new Float32Array(n);
  let k = 0;
  for (let y = out.y0; y < out.y1; y++) for (let x = out.x0; x < out.x1; x++){
    const [sx, sy] = f(x + 0.5, y + 0.5);
    src.sample(sx, sy, edge, ctx.bounds, ctx.alpha, tmp);
    res.set(tmp, k); k += n;
  }
  return res;
}

/* distort.rs:26 centre：参考框中心与内切圆半径 */
function ds_centre(b){
  const w = RW(b), h = RH(b);
  return [b.x0 + w / 2, b.y0 + h / 2, Math.min(w, h) / 2];
}

/* distort.rs:31 twirl：越近中心转得越多 */
function ds_twirl(src, out, ctx, angle){
  const [cx, cy, rr] = ds_centre(ctx.bounds);
  const a = angle * DEG;
  return ds_remap(src, out, ctx, EDGE.Repeat, (x, y) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= rr || rr <= 0) return [x, y];
    const t = a * (1 - r / rr);
    const s = Math.sin(t), c = Math.cos(t);
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
}

/* distort.rs:46 pinch */
function ds_pinch(src, out, ctx, amount){
  const [cx, cy, rr] = ds_centre(ctx.bounds);
  const a = clamp(amount / 100, -1, 1);
  return ds_remap(src, out, ctx, EDGE.Repeat, (x, y) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= rr || r <= 0) return [x, y];
    const rs = rr * Math.pow(r / rr, 1 - a * 0.5);
    return [cx + dx * rs / r, cy + dy * rs / r];
  });
}

/* distort.rs:60 sphere_1d：rn∈[0,1)；正值放大中心（取样点往里靠） */
function ds_sphere1d(rn, a){
  const target = a >= 0 ? Math.asin(rn) * 2 / Math.PI : Math.sin(rn * (Math.PI / 2));
  return rn + Math.abs(a) * (target - rn);
}

/* distort.rs:66 spherize */
function ds_spherize(src, out, ctx, amount, mode){
  const b = ctx.bounds;
  const [cx, cy, rr] = ds_centre(b);
  const hx = RW(b) / 2, hy = RH(b) / 2;
  const a = clamp(amount / 100, -1, 1);
  return ds_remap(src, out, ctx, EDGE.Repeat, (x, y) => {
    const dx = x - cx, dy = y - cy;
    if (mode === 'horizontalOnly'){
      if (Math.abs(dx) >= hx) return [x, y];
      return [cx + ds_signum(dx) * hx * ds_sphere1d(Math.abs(dx) / hx, a), y];
    }
    if (mode === 'verticalOnly'){
      if (Math.abs(dy) >= hy) return [x, y];
      return [x, cy + ds_signum(dy) * hy * ds_sphere1d(Math.abs(dy) / hy, a)];
    }
    // Normal
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= rr || r <= 0) return [x, y];
    const rs = rr * ds_sphere1d(r / rr, a);
    return [cx + dx * rs / r, cy + dy * rs / r];
  });
}

/* distort.rs:108 shape：波形（相位 → −1..1） */
function ds_shape(t, phase){
  const p = remE(phase, TAU) / TAU;
  if (t === 'triangle') return 1 - 4 * Math.abs(p - 0.5);
  if (t === 'square') return p < 0.5 ? 1 : -1;
  return Math.sin(phase);                                         // Sine
}

/* distort.rs:123 wave（WaveSpec 摊平成 fp 栏位：generators、wavelengthMin/Max、amplitudeMin/Max、waveType、undefinedAreas、seed） */
function ds_wave(src, out, ctx, w){
  const n = clamp(w.generators, 1, 64);
  const lerp = (a, b, t) => a + Math.max(b - a, 0) * t;
  const gens = [];
  for (let i = 0; i < n; i++){
    const r = k => hash01(i, k, 7, w.seed);
    gens.push([Math.max(lerp(w.wavelengthMin, w.wavelengthMax, r(1)), 1), lerp(w.amplitudeMin, w.amplitudeMax, r(2)), r(3) * TAU, r(4) * TAU]);
  }
  const b = ctx.bounds;
  return ds_remap(src, out, ctx, ds_edgeOf(w.undefinedAreas), (x, y) => {
    const lx = x - b.x0, ly = y - b.y0;
    let dx = 0, dy = 0;
    for (const [len, amp, p1, p2] of gens){
      dx += amp * ds_shape(w.waveType, TAU * ly / len + p1);
      dy += amp * ds_shape(w.waveType, TAU * lx / len + p2);
    }
    return [x + dx / n, y + dy / n];
  });
}

/* distort.rs:144 ripple */
function ds_ripple(src, out, ctx, amount, size){
  const len = size === 'small' ? 8 : size === 'large' ? 32 : 16;
  const amp = amount / 100 * len / 8;
  const b = ctx.bounds;
  return ds_remap(src, out, ctx, EDGE.Repeat, (x, y) => {
    const lx = x - b.x0, ly = y - b.y0;
    return [x + amp * Math.sin(TAU * ly / len), y + amp * Math.sin(TAU * lx / len)];
  });
}

/* distort.rs:158 polar：极座标（外面透明） */
function ds_polar(src, out, ctx, mode){
  const b = ctx.bounds;
  const w = Math.max(RW(b), 1), h = Math.max(RH(b), 1);
  const cx = b.x0 + w / 2, cy = b.y0 + h / 2;
  const rmax = Math.min(w, h) / 2;
  return ds_remap(src, out, ctx, EDGE.Transparent, (x, y) => {
    if (mode === 'polarToRectangular'){
      const theta = (x - b.x0) / w * TAU;
      const r = (y - b.y0) / h * rmax;
      return [cx + r * Math.sin(theta), cy - r * Math.cos(theta)];
    }
    // RectangularToPolar：输出是极座标——从 12 点钟顺时针的角度 → 来源 x，半径 → 来源 y
    const dx = x - cx, dy = y - cy;
    const theta = remE(Math.atan2(dx, -dy), TAU);
    const r = Math.sqrt(dx * dx + dy * dy);
    return [b.x0 + theta / TAU * w, b.y0 + r / rmax * h];
  });
}

/* ────────────────── distort2.rs ────────────────── */

/* distort2.rs:11 100% 比例、满对比时的最大位移（px） */
const ds_DISPLACE_PX = 128;

/* distort2.rs:14 map_sample：在置换图本地坐标双线性读第 c 通道（边缘夹住） */
function ds_mapSample(map, u, v, c){
  const r = map.rect;
  const w = RW(r), h = RH(r);
  const fx = u - 0.5, fy = v - 0.5;
  const x0f = Math.floor(fx), y0f = Math.floor(fy);
  const ax = fx - x0f, ay = fy - y0f;
  const g = (x, y) => map.get(r.x0 + clamp(x, 0, w - 1), r.y0 + clamp(y, 0, h - 1), c);
  const x0 = x0f | 0, y0 = y0f | 0;
  const top = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * ax;
  const bot = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * ax;
  return top + (bot - top) * ay;
}

/* distort2.rs:31 displace：置换图第一通道管水平、第二通道（单通道图用第一）管垂直；中灰＝不动。
   置换图拉伸盖满 bounds，或从左上角拼贴。map 是 Img 或 null——null／空＝原样（照原码 return src.crop(out)） */
function ds_displace(src, out, ctx, scale, stretch, undefinedAreas, map){
  if (!map || rEmpty(map.rect)) return src.crop(out);
  const b = ctx.bounds;
  const mw = RW(map.rect), mh = RH(map.rect);
  const bw = Math.max(RW(b), 1), bh = Math.max(RH(b), 1);
  // 置换图的颜色通道（有 alpha 时排除：2＝灰＋alpha、4＝RGBA…）
  const vc = map.ch >= 3 ? 1 : 0;
  const sx = scale[0] / 100 * ds_DISPLACE_PX, sy = scale[1] / 100 * ds_DISPLACE_PX;
  return ds_remap(src, out, ctx, ds_edgeOf(undefinedAreas), (x, y) => {
    const lx = x - b.x0, ly = y - b.y0;
    const u = stretch ? lx / bw * mw : remE(lx, mw), v = stretch ? ly / bh * mh : remE(ly, mh);
    const dx = (ds_mapSample(map, u, v, 0) - 0.5) * 2 * sx;
    const dy = (ds_mapSample(map, u, v, vc) - 0.5) * 2 * sy;
    return [x + dx, y + dy];
  });
}

/* distort2.rs:49 curve_at：过已排序 (t, 值) 点的 Catmull–Rom 插值（两端夹住） */
function ds_curveAt(pts, t){
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0][1];
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts.length - 1;
  if (t >= pts[last][0]) return pts[last][1];
  let i = 0;
  for (let j = 0; j + 1 < pts.length; j++) if (t >= pts[j][0] && t <= pts[j + 1][0]){ i = j; break; }   // windows(2).position().unwrap_or(0)
  const p1 = pts[i], p2 = pts[i + 1];
  const p0 = i > 0 ? pts[i - 1] : p1;
  const p3 = i + 2 <= last ? pts[i + 2] : p2;
  const span = Math.max(p2[0] - p1[0], 1e-6);
  const s = (t - p1[0]) / span;
  // 切线照区间长缩放（非均匀 Catmull–Rom）
  const m1 = i > 0 ? (p2[1] - p0[1]) / Math.max(p2[0] - p0[0], 1e-6) * span : p2[1] - p1[1];
  const m2 = i + 2 <= last ? (p3[1] - p1[1]) / Math.max(p3[0] - p1[0], 1e-6) * span : p2[1] - p1[1];
  const s2 = s * s, s3 = s * s * s;
  return (2 * s3 - 3 * s2 + 1) * p1[1] + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2[1] + (s3 - s2) * m2;
}

/* Rust f32::total_cmp 的排序（NaN 排最后；只用在 shear 的点排序） */
const ds_totalCmp = (a, b) => a !== a ? (b !== b ? 0 : 1) : b !== b ? -1 : a < b ? -1 : a > b ? 1 : (Object.is(a, -0) && Object.is(b, 0)) ? -1 : (Object.is(a, 0) && Object.is(b, -0)) ? 1 : 0;

/* distort2.rs:79 shear：每一列照过 points 的曲线水平位移（[t, 位移]，t 由上到下，位移单位＝半宽） */
function ds_shear(src, out, ctx, points, undefinedAreas){
  const b = ctx.bounds;
  let pts = points.map(p => [clamp(p[0], 0, 1), clamp(p[1], -1, 1)]);
  pts.sort((a, c) => ds_totalCmp(a[0], c[0]));                   // sort_by 稳定排序
  // dedup_by：跟上一个留下的点比，t 差不到 1e-6 就丢
  const dd = [];
  for (const p of pts) if (!dd.length || !(Math.abs(p[0] - dd[dd.length - 1][0]) < 1e-6)) dd.push(p);
  pts = dd;
  const bw = Math.max(RW(b), 1), bh = Math.max(RH(b), 1);
  // 每列的位移由同列所有像素共用
  const rows = [];
  for (let y = out.y0; y < out.y1; y++) rows.push(ds_curveAt(pts, (y + 0.5 - b.y0) / bh) * bw / 2);
  return ds_remap(src, out, ctx, ds_edgeOf(undefinedAreas), (x, y) => {
    const i = clamp(Math.trunc(y - 0.5) - out.y0, 0, rows.length - 1);
    return [x - rows[i], y];
  });
}

/* distort2.rs:95 zigzag：bounds 内切圆里的同心波纹——绕中心（角向）、由中心向外（径向）或两者（池塘波纹） */
function ds_zigzag(src, out, ctx, amount, ridges, style){
  const [cx, cy, rr] = ds_centre(ctx.bounds);
  const a = clamp(amount / 100, -1, 1);
  const k = Math.max(clamp(ridges, 0, 20), 0.5);
  return ds_remap(src, out, ctx, EDGE.Repeat, (x, y) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= rr || r <= 0 || a === 0) return [x, y];
    const rn = r / rr;
    const wave = Math.sin(TAU * k * rn) * (1 - rn);
    let radial, angular;
    if (style === 'outFromCenter'){ radial = a * wave * rr / (4 * k); angular = 0; }
    else if (style === 'aroundCenter'){ radial = 0; angular = a * wave * Math.PI / (2 * k); }
    else { radial = a * wave * rr / (8 * k); angular = a * wave * Math.PI / (4 * k); }   // PondRipples
    const th = Math.atan2(dy, dx) + angular;
    const rs = Math.max(r + radial, 0);
    return [cx + rs * Math.cos(th), cy + rs * Math.sin(th)];
  });
}

/* ────────────────── video.rs ────────────────── */

/* video.rs:13 deinterlace：去掉一个场（奇数场＝从 bounds 顶算第 1、3、5… 列，即偏移为偶数），
   用相邻保留列复制或（预乘）插值补回 */
function ds_deinterlace(src, out, ctx, eliminateEven, interpolate){
  const n = src.ch, b = ctx.bounds;
  const res = src.crop(out);
  const acc = new Float32Array(MAXC);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    if (!rContains(b, x, y)) continue;
    // 以 1 起算的列号奇偶：偏移 0 是第 1 列（奇）
    const oddLine = (y - b.y0) % 2 === 0;
    if (oddLine === eliminateEven) continue;
    const above = y > b.y0 ? y - 1 : null;
    const below = y + 1 < b.y1 ? y + 1 : null;
    let rows, cnt;
    if (interpolate && above !== null && below !== null){ rows = [above, below]; cnt = 2; }
    else if (above !== null){ rows = [above, above]; cnt = 1; }
    else if (below !== null){ rows = [below, below]; cnt = 1; }
    else continue;
    acc.fill(0, 0, n);
    const k = 1 / cnt;
    for (let r = 0; r < cnt; r++){
      const yy = rows[r];
      const a = ctx.alpha ? src.get(x, yy, n - 1) : 1;
      for (let c = 0; c < n; c++){
        const s = src.get(x, yy, c);
        acc[c] += (ctx.alpha && c < n - 1 ? s * a : s) * k;
      }
    }
    const v = acc.subarray(0, n);
    unpremulPx(v, ctx.alpha);
    res.set(v, p);
  }
  return res;
}

/* video.rs:53 复合讯号上下限（7.5–100 IRE 亮度范围的比例）：广播安全＝−20…120 IRE，即 Y ± C 落在这之间 */
const ds_NTSC_MAX = (120 - 7.5) / 92.5;
const ds_NTSC_MIN = (-20 - 7.5) / 92.5;

/* video.rs:58 ntsc：在 YIQ 里缩色度让 Y ± C 不超广播限；色相、亮度保留（我们只有 RGB＝native 分支） */
function ds_ntsc(src, out, ctx){
  const n = src.ch;
  const res = src.crop(out);
  for (let p = 0; p < res.length; p += n){
    const c = [res[p], res[p + 1], res[p + 2], 1];
    const yy = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const ii = 0.595716 * c[0] - 0.274453 * c[1] - 0.321263 * c[2];
    const qq = 0.211456 * c[0] - 0.522591 * c[1] + 0.311135 * c[2];
    const chroma = Math.sqrt(ii * ii + qq * qq);
    if (chroma <= 1e-7) continue;
    let k = 1;
    if (yy + chroma > ds_NTSC_MAX) k = Math.min(k, Math.max((ds_NTSC_MAX - yy) / chroma, 0));
    if (yy - chroma < ds_NTSC_MIN) k = Math.min(k, Math.max((yy - ds_NTSC_MIN) / chroma, 0));
    if (k >= 1) continue;
    const i2 = ii * k, q2 = qq * k;
    res[p] = yy + 0.9563 * i2 + 0.6210 * q2;
    res[p + 1] = yy - 0.2721 * i2 - 0.6474 * q2;
    res[p + 2] = yy - 1.1070 * i2 + 1.7046 * q2;
  }
  return res;
}

/* ────────────────── other2.rs ────────────────── */

/* other2.rs:12 custom：每个颜色通道 Σ kernel·像素 / scale + offset/255（alpha 保留）；不足 25 项补 0 */
function ds_custom(src, out, ctx, kernel, scale, offset){
  const n = src.ch, cc = ncol(ctx, n);
  const k = [];
  for (let i = 0; i < 25; i++){
    const v = kernel[i];
    if (v !== undefined && v !== 0) k.push([i % 5 - 2, Math.trunc(i / 5) - 2, v]);
  }
  const s = scale === 0 ? 1 : scale;
  const off = offset / 255;
  const res = src.crop(out);
  if (!k.length) return res;
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    for (let c = 0; c < cc; c++){
      let sum = 0;
      for (const [dx, dy, w] of k) sum += src.get(x + dx, y + dy, c) * w;
      res[p + c] = sum / s + off;
    }
  }
  return res;
}

/* other2.rs:50 hue：0..1 */
function ds_hue(c, mx, d){
  if (d <= 0) return 0;
  let h;
  if (mx === c[0]) h = remE((c[1] - c[2]) / d, 6);
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  return h / 6;
}
/* other2.rs:34 rgb_to_hsb：全 0..1 */
function ds_rgbToHsb(c){
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  const h = ds_hue(c, mx, d);
  return [h, mx > 0 ? d / mx : 0, mx];
}
/* other2.rs:42 rgb_to_hsl：全 0..1 */
function ds_rgbToHsl(c){
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d <= 0 ? 0 : d / Math.max(1 - Math.abs(2 * l - 1), 1e-7);
  return [ds_hue(c, mx, d), clamp(s, 0, 1), l];
}
/* other2.rs:65 from_hcm：由色相、彩度与要加的最小值回 RGB */
function ds_fromHcm(h, chroma, m){
  const hp = remE(h, 1) * 6;
  const x = chroma * (1 - Math.abs(remE(hp, 2) - 1));
  let r, g, b;
  switch (Math.trunc(hp)){
    case 0: r = chroma; g = x; b = 0; break;
    case 1: r = x; g = chroma; b = 0; break;
    case 2: r = 0; g = chroma; b = x; break;
    case 3: r = 0; g = x; b = chroma; break;
    case 4: r = x; g = 0; b = chroma; break;
    default: r = chroma; g = 0; b = x;
  }
  return [r + m, g + m, b + m];
}
/* other2.rs:79 hsb_to_rgb */
function ds_hsbToRgb(c){ const chroma = c[2] * c[1]; return ds_fromHcm(c[0], chroma, c[2] - chroma); }
/* other2.rs:84 hsl_to_rgb */
function ds_hslToRgb(c){ const chroma = (1 - Math.abs(2 * c[2] - 1)) * c[1]; return ds_fromHcm(c[0], chroma, c[2] - chroma / 2); }

/* other2.rs:91 hsb_hsl：把三个颜色通道重新解读——RGB 编成 H、S、B/L 放进 R、G、B，或反过来解回 RGB（我们只有 RGB＝native 分支） */
function ds_hsbHsl(src, out, ctx, input, output){
  const n = src.ch;
  const res = src.crop(out);
  if (input === output) return res;
  for (let p = 0; p < res.length; p += n){
    const c = [clamp(res[p], 0, 1), clamp(res[p + 1], 0, 1), clamp(res[p + 2], 0, 1)];
    const rgb = input === 'hsb' ? ds_hsbToRgb(c) : input === 'hsl' ? ds_hslToRgb(c) : c;
    const o = output === 'hsb' ? ds_rgbToHsb(rgb) : output === 'hsl' ? ds_rgbToHsl(rgb) : rgb;
    res[p] = o[0]; res[p + 1] = o[1]; res[p + 2] = o[2];
  }
  return res;
}

/* ────────────────── 登记（lib.rs:680-697、738-742、819-822 kernel() 分派） ────────────────── */
KERNELS.twirl = (src, out, ctx, fp) => ds_twirl(src, out, ctx, fp.angle);
KERNELS.pinch = (src, out, ctx, fp) => ds_pinch(src, out, ctx, fp.amount);
KERNELS.spherize = (src, out, ctx, fp) => ds_spherize(src, out, ctx, fp.amount, fp.mode);
KERNELS.wave = (src, out, ctx, fp) => ds_wave(src, out, ctx, fp);
KERNELS.ripple = (src, out, ctx, fp) => ds_ripple(src, out, ctx, fp.amount, fp.size);
KERNELS.polarCoordinates = (src, out, ctx, fp) => ds_polar(src, out, ctx, fp.mode);
KERNELS.displace = (src, out, ctx, fp) => ds_displace(src, out, ctx, [fp.horizontal, fp.vertical], fp.stretch, fp.undefinedAreas, fp.map);
KERNELS.shear = (src, out, ctx, fp) => ds_shear(src, out, ctx, fp.points, fp.undefinedAreas);
KERNELS.zigZag = (src, out, ctx, fp) => ds_zigzag(src, out, ctx, fp.amount, fp.ridges, fp.style);
KERNELS.deInterlace = (src, out, ctx, fp) => ds_deinterlace(src, out, ctx, fp.eliminateEven, fp.interpolate);
KERNELS.ntscColors = (src, out, ctx, fp) => ds_ntsc(src, out, ctx);
KERNELS.custom = (src, out, ctx, fp) => ds_custom(src, out, ctx, fp.kernel, fp.scale, fp.offset);
KERNELS.hsbHsl = (src, out, ctx, fp) => ds_hsbHsl(src, out, ctx, fp.input, fp.output);

/* ──────────────── 段：12-pixstyle.js ──────────────── */
/* ═══════════ 像素化／风格化（二）：algo/src/pixelate.rs（全档）、stylize2.rs（全档） ═══════════
   KERNELS：colorHalftone、crystallize、facet、fragment、mezzotint、pointillize、diffuse、extrude、tiles、traceContour、wind
   REACH：extrude（stylize2.rs:80）、wind（stylize2.rs:348）
   我们只有 RGB＋alpha：ncol＝3、subtractive()＝false、viaRgb()＝false，原码的 CMYK／Lab 分支只留 RGB 那条，算法不改。 */

const px_FMAX = 3.4028234663852886e38;                              // f32::MAX
/* Rust f32::signum：+0 → 1、-0 → -1 */
const px_signum = v => v !== v ? NaN : (v > 0 || Object.is(v, 0)) ? 1 : -1;

/* ────────────────── pixelate.rs ────────────────── */

/* pixelate.rs:15 color_halftone：每个通道以自己的角度加网成圆点，点面积跟着墨量（加色模式＝1−值） */
function px_colorHalftone(src, out, ctx, maxRadius, angles){
  const n = src.ch, cc = ncol(ctx, n);
  const rmax = Math.max(maxRadius, 1);
  // 格子边长：满点刚好盖住格子四角
  const cell = rmax * Math.SQRT2;
  const sub = subtractive(ctx), rgb = viaRgb(ctx);
  const res = src.crop(out);
  const b = ctx.bounds, ox = b.x0, oy = b.y0;
  const rot = [];
  for (let c = 0; c < Math.max(cc, 3); c++){ const a = angles[Math.min(c, 3)] * DEG; rot.push([Math.sin(a), Math.cos(a)]); }
  const clip = rInter(b, src.rect);
  if (rEmpty(clip)) return res;
  // 一点的通道值＝五个取样点平均（我们只有 RGB，不走 via_rgb 那条）
  const value = (x, y, c) => {
    const d = cell * 0.25; let acc = 0;
    for (const [dx, dy] of [[0, 0], [-d, -d], [d, -d], [-d, d], [d, d]]){
      // 夹进 bounds，跨边的格子读真像素
      const ix = clamp(Math.floor(x + dx), clip.x0, clip.x1 - 1), iy = clamp(Math.floor(y + dy), clip.y0, clip.y1 - 1);
      acc += src.get(ix, iy, c);
    }
    return acc / 5;
  };
  const w = RW(out), chans = rgb ? 3 : cc, vals = new Float32Array(MAXC);
  const touch = Math.PI / 4;
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    const fx = x + 0.5 - ox, fy = y + 0.5 - oy;
    for (let c = 0; c < chans; c++){
      const [s, co] = rot[c];
      // 转进网屏坐标
      const u = fx * co + fy * s, w2 = -fx * s + fy * co;
      const cu = Math.floor(u / cell), cv = Math.floor(w2 / cell);
      let cov = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
        const mu = (cu + di + 0.5) * cell, mv = (cv + dj + 0.5) * cell;
        const d = Math.sqrt((u - mu) * (u - mu) + (w2 - mv) * (w2 - mv));
        if (d >= rmax + 0.5) continue;
        // 转回文件坐标读格子值
        const dx = mu * co - mv * s + ox, dy = mu * s + mv * co + oy;
        const raw = clamp(value(dx, dy, c), 0, 1);
        const ink = (sub && !rgb) ? raw : 1 - raw;
        // 点面积跟墨量：πr²＝ink·cell² 直到点相碰，之后长到盖住四角
        const r = ink <= touch ? cell * Math.sqrt(ink / Math.PI) : cell * (0.5 + (ink - touch) / (1 - touch) * (Math.SQRT1_2 - 0.5));
        // 小点盖不过自己的面积
        cov = Math.max(cov, Math.min(clamp(r - d + 0.5, 0, 1), Math.PI * r * r));
      }
      vals[c] = (sub && !rgb) ? cov : 1 - cov;
    }
    // 非 via_rgb 分支：只写颜色通道，alpha 原样
    for (let c = 0; c < cc; c++) res[p + c] = vals[c];
  }
  return res;
}

/* pixelate.rs:98 crystallize：抖动点的 Voronoi 格，每格填格内像素的（预乘）平均色 */
function px_crystallize(src, out, ctx, cellSize, seed){
  const n = src.ch, cell = Math.max(cellSize, 2), b = ctx.bounds, origin = [b.x0, b.y0];
  // 势力范围可能碰到 out 的格子，以及装得下它们全部像素的窗
  const c0 = [Math.trunc(Math.floor((out.x0 - b.x0) / cell)) - 2, Math.trunc(Math.floor((out.y0 - b.y0) / cell)) - 2];
  const c1 = [Math.trunc(Math.floor((out.x1 - b.x0) / cell)) + 2, Math.trunc(Math.floor((out.y1 - b.y0) / cell)) + 2];
  const gw = c1[0] - c0[0] + 1, gh = c1[1] - c0[1] + 1;
  const owner = (x, y) => {
    const fx = x + 0.5, fy = y + 0.5;
    const cx = Math.floor((fx - origin[0]) / cell), cy = Math.floor((fy - origin[1]) / cell);
    let bd = px_FMAX, bx = cx, by = cy;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      const [ppx, ppy] = cellPoint(cx + dx, cy + dy, cell, seed, origin);
      const d = (ppx - fx) * (ppx - fx) + (ppy - fy) * (ppy - fy);
      if (d < bd){ bd = d; bx = cx + dx; by = cy + dy; }
    }
    return [bx, by];
  };
  const acc = new Float32Array(gw * gh * (n + 1));
  const win = rInter(rInter(R(
    b.x0 + Math.floor(c0[0] * cell), b.y0 + Math.floor(c0[1] * cell),
    b.x0 + Math.ceil((c1[0] + 1) * cell), b.y0 + Math.ceil((c1[1] + 1) * cell)), src.rect), b);
  const ow = RW(out), owners = new Int32Array(ow * RH(out) * 2);
  for (let y = win.y0; y < win.y1; y++) for (let x = win.x0; x < win.x1; x++){
    const [cx, cy] = owner(x, y);
    if (rContains(out, x, y)){ const o = ((y - out.y0) * ow + (x - out.x0)) * 2; owners[o] = cx; owners[o + 1] = cy; }
    if (cx < c0[0] || cy < c0[1] || cx > c1[0] || cy > c1[1]) continue;
    const k = ((cy - c0[1]) * gw + (cx - c0[0])) * (n + 1);
    const a = ctx.alpha ? src.get(x, y, n - 1) : 1;
    for (let c = 0; c < n; c++){ const s = src.get(x, y, c); acc[k + c] += (ctx.alpha && c < n - 1) ? s * a : s; }
    acc[k + n] += 1;
  }
  // out 在 bounds 外的像素保留原值；窗外漏掉的另算归属
  const res = src.crop(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    if (!rContains(b, x, y)) continue;
    const [cx, cy] = rContains(win, x, y) ? [owners[i * 2], owners[i * 2 + 1]] : owner(x, y);
    if (cx < c0[0] || cy < c0[1] || cx > c1[0] || cy > c1[1]) continue;
    const k = ((cy - c0[1]) * gw + (cx - c0[0])) * (n + 1);
    const cnt = acc[k + n];
    if (cnt <= 0) continue;
    for (let c = 0; c < n; c++) res[p + c] = acc[k + c] / cnt;
    unpremulPx(res.subarray(p, p + n), ctx.alpha);
  }
  return res;
}

/* pixelate.rs:177 facet：半径 2 的 Kuwahara——取四个重叠象限里亮度变异最小者的平均 */
function px_facet(src, out, ctx){
  const n = src.ch, r = 2;
  const res = src.crop(out), tmp = new Float32Array(MAXC);
  const cnt = (r + 1) * (r + 1);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    let bestVar = px_FMAX, best = new Float32Array(MAXC);
    for (const [qx, qy] of [[-r, -r], [0, -r], [-r, 0], [0, 0]]){
      const sum = new Float32Array(MAXC);
      let s = 0, s2 = 0;
      for (let yy = y + qy; yy <= y + qy + r; yy++) for (let xx = x + qx; xx <= x + qx + r; xx++){
        for (let c = 0; c < n; c++){ tmp[c] = src.get(xx, yy, c); sum[c] += tmp[c]; }
        const l = lumaOf(ctx, tmp);
        s += l; s2 += l * l;
      }
      const vr = s2 / cnt - (s / cnt) * (s / cnt);
      if (vr < bestVar){
        for (let c = 0; c < MAXC; c++) sum[c] /= cnt;
        bestVar = vr; best = sum;
      }
    }
    for (let c = 0; c < n; c++) res[p + c] = best[c];
  }
  return res;
}

/* pixelate.rs:214 fragment：左右上下各偏 4 px 的四份副本取（预乘）平均 */
function px_fragment(src, out, ctx){
  const n = src.ch, res = new Float32Array(RW(out) * RH(out) * n), acc = new Float32Array(n);
  let p = 0;
  for (let y = out.y0; y < out.y1; y++) for (let x = out.x0; x < out.x1; x++){
    acc.fill(0);
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]){
      const a = ctx.alpha ? src.get(x + dx, y + dy, n - 1) : 1;
      for (let c = 0; c < n; c++){ const s = src.get(x + dx, y + dy, c); acc[c] += ((ctx.alpha && c < n - 1) ? s * a : s) * 0.25; }
    }
    unpremulPx(acc, ctx.alpha);
    res.set(acc, p); p += n;
  }
  return res;
}

/* pixelate.rs:236 mezzo_threshold：某种网线图案在某像素的随机门槛（div_euclid 的除数恒正＝floor 除） */
function px_mezzoThreshold(kind, x, y, c, seed){
  const lines = len => {
    const phase = Math.trunc(hash01(0, y, c + 40, seed) * len);
    return hash01(Math.floor((x + phase) / len), y, c, seed);
  };
  const strokes = len => {
    const d = x - y;
    const phase = Math.trunc(hash01(d, 0, c + 50, seed) * len);
    return hash01(Math.floor((x + y + phase) / len), d, c + 60, seed);
  };
  switch (kind){
    case 'fineDots': return hash01(x, y, c, seed);
    case 'mediumDots': return hash01(Math.floor(x / 2), Math.floor(y / 2), c, seed);
    case 'grainyDots': return 0.5 * hash01(x, y, c, seed) + 0.5 * hash01(Math.floor(x / 3), Math.floor(y / 3), c + 7, seed);
    case 'coarseDots': return hash01(Math.floor(x / 3), Math.floor(y / 3), c, seed);
    case 'shortLines': return lines(6);
    case 'mediumLines': return lines(14);
    case 'longLines': return lines(32);
    case 'shortStrokes': return strokes(5);
    case 'mediumStrokes': return strokes(10);
    case 'longStrokes': return strokes(20);
  }
  return hash01(x, y, c, seed);
}

/* pixelate.rs:262 mezzotint：每个颜色通道对随机图案取门槛，得纯通道值（非 via_rgb 分支） */
function px_mezzotint(src, out, ctx, kind, seed){
  const n = src.ch, cc = ncol(ctx, n);
  const res = src.crop(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    for (let k = 0; k < cc; k++) res[p + k] = res[p + k] > px_mezzoThreshold(kind, x, y, k, seed) ? 1 : 0;
  }
  return res;
}

/* pixelate.rs:286 pointillize：随机大小的圆点、取点心的影像色，画在背景色画布上 */
function px_pointillize(src, out, ctx, cellSize, seed, background){
  const n = src.ch, cell = Math.max(cellSize, 2), b = ctx.bounds, origin = [b.x0, b.y0];
  const bg = nativeOf(ctx, background);
  const res = src.crop(out), dot = new Float32Array(MAXC), canvas = new Float32Array(MAXC);
  const cc = ncol(ctx, n), sub = subtractive(ctx);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    const fx = x + 0.5, fy = y + 0.5;
    const cx = Math.floor((fx - origin[0]) / cell), cy = Math.floor((fy - origin[1]) / cell);
    // 像素陷得最深的那个点赢
    let best = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      const gx = cx + dx, gy = cy + dy;
      const [px0, py0] = cellPoint(gx, gy, cell, seed, origin);
      const rad = cell * (0.45 + 0.35 * hash01(gx, gy, 13, seed));
      const d = Math.sqrt((px0 - fx) * (px0 - fx) + (py0 - fy) * (py0 - fy));
      const depth = rad - d;
      if (depth > -0.5 && (best === null || depth > best[0])) best = [depth, gx, gy, px0, py0];
    }
    const aOrig = ctx.alpha ? res[p + n - 1] : 1;
    // 先铺画布，再把点（反锯齿边）盖上去
    canvas.fill(0);
    for (let c = 0; c < n; c++) canvas[c] = bg[c];
    if (ctx.alpha) canvas[n - 1] = Math.max(aOrig, Math.min(bg[n - 1], 1));
    if (best){
      const [depth, gx, gy, px0, py0] = best;
      const sx = Math.floor(px0), sy = Math.floor(py0);
      for (let c = 0; c < n; c++) dot[c] = src.get(sx, sy, c);
      // 每点轻微亮度抖动，像点彩笔触
      const j = (hash01(gx, gy, 17, seed) - 0.5) * 0.08;
      for (let c = 0; c < cc; c++) dot[c] = clamp(dot[c] + (sub ? -j : j), 0, 1);
      const k = clamp(depth + 0.5, 0, 1);
      for (let c = 0; c < n; c++) canvas[c] += (dot[c] - canvas[c]) * k;
    }
    for (let c = 0; c < n; c++) res[p + c] = canvas[c];
  }
  return res;
}

/* ────────────────── stylize2.rs ────────────────── */

/* stylize2.rs:10 read_px */
function px_readPx(src, x, y, buf, n){ for (let c = 0; c < n; c++) buf[c] = src.get(x, y, c); }

/* stylize2.rs:19 diffuse：每格换成 1 px 内的随机邻格；变暗／变亮只在更暗／更亮时换；各向异性取最像的邻格、走一半 */
const px_RING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function px_diffuse(src, out, ctx, mode, seed){
  const n = src.ch, res = src.crop(out), nb = new Float32Array(MAXC);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    const px = res.subarray(p, p + n);
    if (mode === 'anisotropic'){
      const me = lumaOf(ctx, px);
      let bd = px_FMAX, bx = 0, by = 0;
      // 随机起点，平手时不偏向某一方向
      const start = Math.trunc(hash01(x, y, 3, seed) * 8);
      for (let k = 0; k < 8; k++){
        const [dx, dy] = px_RING[(start + k) % 8];
        px_readPx(src, x + dx, y + dy, nb, n);
        const d = Math.abs(lumaOf(ctx, nb) - me);
        if (d < bd){ bd = d; bx = dx; by = dy; }
      }
      px_readPx(src, x + bx, y + by, nb, n);
      // 只走一半：各向异性扩散是柔化而非打乱
      for (let c = 0; c < n; c++) px[c] = 0.5 * (px[c] + nb[c]);
    } else {
      const dx = Math.trunc(hash01(x, y, 1, seed) * 3) - 1;
      const dy = Math.trunc(hash01(x, y, 2, seed) * 3) - 1;
      px_readPx(src, x + dx, y + dy, nb, n);
      if (ctx.alpha && nb[n - 1] <= 0 && px[n - 1] > 0 && mode !== 'normal') continue;
      const take = mode === 'darkenOnly' ? lumaOf(ctx, nb) < lumaOf(ctx, px) : mode === 'lightenOnly' ? lumaOf(ctx, nb) > lumaOf(ctx, px) : true;
      if (take) for (let c = 0; c < n; c++) px[c] = nb[c];
    }
  }
  return res;
}

/* stylize2.rs:80 extrude_reach：挤出块正面在画面上的最大位移（px） */
function px_extrudeReach(depth){ return clamp(depth, 0, 255) * 0.25; }

/* stylize2.rs:88 extrude：bounds 切成方格；块状＝正面离 bounds 中心外推（侧面打光）；金字塔＝四个打光三角面；高度随机或跟亮度
   spec＝ExtrudeSpec（stylize2.rs:69）：{kind, size, depth, levelBased, solidFront, maskIncomplete, seed} */
function px_extrude(src, out, ctx, spec){
  const n = src.ch;
  const cs = rround(clamp(spec.size, 2, 255));
  const b = ctx.bounds;
  const bcx = (b.x0 + b.x1) / 2, bcy = (b.y0 + b.y1) / 2;
  const halfDiag = Math.max(Math.hypot(RW(b), RH(b)) / 2, 1);
  const reach = px_extrudeReach(spec.depth);
  const res = src.crop(out);
  const cellRect = (gx, gy) => R(b.x0 + gx * cs, b.y0 + gy * cs, b.x0 + (gx + 1) * cs, b.y0 + (gy + 1) * cs);
  const incomplete = r => !rEq(rInter(r, b), r);
  // 一格的平均色与高度
  const cellInfo = (gx, gy) => {
    const r = rInter(cellRect(gx, gy), b);
    const acc = new Float32Array(MAXC); let cnt = 0;
    // 稀疏取样让大格也便宜；平均色只用来上色
    const step = Math.max(Math.trunc(cs / 8), 1);
    for (let yy = r.y0; yy < r.y1; yy += step) for (let xx = r.x0; xx < r.x1; xx += step){
      const a = ctx.alpha ? src.get(xx, yy, n - 1) : 1;
      for (let c = 0; c < n; c++){ const s = src.get(xx, yy, c); acc[c] += (ctx.alpha && c < n - 1) ? s * a : s; }
      cnt += 1;
    }
    if (cnt > 0) for (let c = 0; c < n; c++) acc[c] /= cnt;
    unpremulPx(acc.subarray(0, n), ctx.alpha);
    const h = spec.levelBased ? clamp(lumaOf(ctx, acc), 0, 1) : hash01(gx, gy, 21, spec.seed);
    return [acc, h];
  };
  const shade = (px, col, k) => {
    const cc = ncol(ctx, n), sub = subtractive(ctx);
    for (let c = 0; c < cc; c++) px[c] = clamp(sub ? 1 - (1 - col[c]) * k : col[c] * k, 0, 1);
    if (ctx.alpha) px[n - 1] = col[n - 1];
  };
  let cache = [];                                                    // [[gx,gy,info]]（每行清空，最多 64 笔）
  const info = (gx, gy) => {
    const hit = cache.find(e => e[0] === gx && e[1] === gy);
    if (hit) return hit[2];
    const v = cellInfo(gx, gy);
    if (cache.length >= 64) cache.shift();
    cache.push([gx, gy, v]);
    return v;
  };
  const w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    if (!rContains(b, x, y)) continue;
    if (i % w === 0) cache = [];
    const px = res.subarray(p, p + n);
    const fx = x + 0.5, fy = y + 0.5;
    const gx = Math.floor((x - b.x0) / cs), gy = Math.floor((y - b.y0) / cs);
    if (spec.kind === 'pyramids'){
      const r = cellRect(gx, gy);
      if (spec.maskIncomplete && incomplete(r)) continue;
      const [col, h] = info(gx, gy);
      const u = fx - (r.x0 + cs / 2), v = fy - (r.y0 + cs / 2);
      // 高 H、半边 s 的金字塔面法线；光从左上来
      const hgt = h * clamp(spec.depth, 1, 255) / 255 * cs;
      const s = cs / 2;
      const [nx, ny] = Math.abs(u) >= Math.abs(v) ? [px_signum(u) * hgt, 0] : [0, px_signum(v) * hgt];
      const norm = Math.sqrt(nx * nx + ny * ny + s * s);
      const lx = -0.5, ly = -0.5, lz = Math.SQRT1_2;
      const lambert = Math.max((nx * lx + ny * ly + s * lz) / norm, 0);
      shade(px, col, 0.35 + 0.9 * lambert);
    } else {
      // 候选块：自己这格，以及正面可能推到这里的邻格
      const k = Math.ceil(reach / cs) + 1;
      let best = null;                                               // [高度, gx, gy, 面：0 正面、1..4 侧面]
      for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++){
        const cx = gx + dx, cy = gy + dy;
        const r = cellRect(cx, cy);
        if (r.x1 <= b.x0 || r.y1 <= b.y0 || r.x0 >= b.x1 || r.y0 >= b.y1) continue;
        if (spec.maskIncomplete && incomplete(r)) continue;
        const h = info(cx, cy)[1];
        if (best && best[0] >= h) continue;
        // 正面位移随高度与离中心距离变大
        const mx = r.x0 + cs / 2, my = r.y0 + cs / 2;
        const off = reach * h / halfDiag;
        const ox = (mx - bcx) * off, oy = (my - bcy) * off;
        const half = cs / 2;
        // t ∈ [0,1] 从底扫到正面：有某个 t 让像素落在方块里就算在内
        const interval = (pp, m, o) => {
          // |p − (m + o t)| ≤ half
          if (Math.abs(o) < 1e-6) return Math.abs(pp - m) <= half ? [0, 1] : null;
          const a = (pp - m - half) / o, bb = (pp - m + half) / o;
          const lo = Math.max(Math.min(a, bb), 0), hi = Math.min(Math.max(a, bb), 1);
          return lo <= hi ? [lo, hi] : null;
        };
        const ix = interval(fx, mx, ox), iy = interval(fy, my, oy);
        if (!ix || !iy) continue;
        const lo = Math.max(ix[0], iy[0]), hi = Math.min(ix[1], iy[1]);
        if (lo > hi) continue;
        const face = hi >= 1 ? 0
          : ix[1] < iy[1] ? (ox > 0 ? 1 : 2)                         // 先从 x 边离开方块
          : oy > 0 ? 3 : 4;
        best = [h, cx, cy, face];
      }
      if (!best) continue;
      const [h, cx, cy, face] = best;
      const r = cellRect(cx, cy);
      const mx = r.x0 + cs / 2, my = r.y0 + cs / 2;
      const off = reach * h / halfDiag;
      const col = info(cx, cy)[0];
      if (face === 0){
        if (spec.solidFront) shade(px, col, 1);
        else {
          // 影像纹理跟着正面一起移
          const sx = clamp(Math.floor(fx - (mx - bcx) * off), r.x0, r.x1 - 1), sy = clamp(Math.floor(fy - (my - bcy) * off), r.y0, r.y1 - 1);
          for (let c = 0; c < n; c++) px[c] = src.get(sx, sy, c);
        }
      } else {
        // 光从左上：左、上侧面亮
        const kk = face === 1 ? 0.85 : face === 2 ? 0.55 : face === 3 ? 0.95 : 0.45;   // 1 左侧（块右移）、2 右侧、3 上侧、4 下侧
        shade(px, col, kk);
      }
    }
  }
  return res;
}

/* stylize2.rs:266 tiles：bounds 切成方砖（短边 count 块），各自随机偏移至多 max_offset %；后画的盖前面，缝隙填所选 */
function px_tiles(src, out, ctx, count, maxOffset, fill, colours, seed){
  const n = src.ch, b = ctx.bounds;
  const ts = Math.max(Math.min(RW(b), RH(b)) / clamp(count, 1, 99), 1);
  const m = clamp(maxOffset, 0, 99) / 100 * ts;
  const fg = nativeOf(ctx, colours[0]), bg = nativeOf(ctx, colours[1]);
  const cc = ncol(ctx, n);
  const res = src.crop(out), w = RW(out);
  const offset = (gx, gy) => [(hash01(gx, gy, 31, seed) * 2 - 1) * m, (hash01(gx, gy, 32, seed) * 2 - 1) * m];
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    if (!rContains(b, x, y)) continue;
    const fx = x + 0.5 - b.x0, fy = y + 0.5 - b.y0;
    const gx = Math.floor(fx / ts), gy = Math.floor(fy / ts);
    // 盖住此像素的最上层砖（最后画＝行优先序号最大）
    let hit = null;                                                  // [cy, cx, ox, oy]
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
      const cx = gx + dx, cy = gy + dy;
      const [ox, oy] = offset(cx, cy);
      const u = fx - ox - cx * ts, v = fy - oy - cy * ts;
      if (u >= 0 && v >= 0 && u < ts && v < ts && cx * ts < RW(b) && cy * ts < RH(b) && cx >= 0 && cy >= 0){
        if (hit === null || cy > hit[0] || (cy === hit[0] && cx > hit[1])) hit = [cy, cx, ox, oy];
      }
    }
    if (hit){
      const [, , ox, oy] = hit;
      const sx = clamp(Math.floor(x + 0.5 - ox), b.x0, b.x1 - 1), sy = clamp(Math.floor(y + 0.5 - oy), b.y0, b.y1 - 1);
      for (let c = 0; c < n; c++) res[p + c] = src.get(sx, sy, c);
    } else if (fill === 'background') for (let c = 0; c < n; c++) res[p + c] = bg[c];
    else if (fill === 'foreground') for (let c = 0; c < n; c++) res[p + c] = fg[c];
    else if (fill === 'inverse') for (let c = 0; c < cc; c++) res[p + c] = 1 - res[p + c];
    // unaltered：不动
  }
  return res;
}

/* stylize2.rs:325 trace_contour：每通道在值跨过 level（0–255）处描 1 px 线（加色模式为暗线），底为白 */
function px_traceContour(src, out, ctx, level, upper){
  const n = src.ch, cc = ncol(ctx, n), sub = subtractive(ctx);
  const t = clamp(level, 0, 255) / 255;
  const area = rInter(ctx.bounds, src.rect);
  const bright = (x, y, c) => { const v = src.getEdge(x, y, c, EDGE.Repeat, area); return sub ? 1 - v : v; };
  const res = src.crop(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const [x, y] = xyOf(out, i);
    for (let c = 0; c < cc; c++){
      const me = bright(x, y, c) > t;
      const line = me === upper && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (bright(x + dx, y + dy, c) > t) !== me);
      const paper = line ? 0 : 1;
      res[p + c] = sub ? 1 - paper : paper;
    }
  }
  return res;
}

/* stylize2.rs:348 wind_reach：风纹最长长度（或错位位移），px */
function px_windReach(method){ return method === 'blast' ? 40 : method === 'stagger' ? 12 : 16; }

/* stylize2.rs:358 wind：风纹从边缘往下风处拖（大风：更长更密）；错位＝随机行段顺风错开 */
function px_wind(src, out, ctx, method, fromRight, seed){
  const n = src.ch;
  const lmax = Math.trunc(px_windReach(method));
  // 风纹往下风走：从左吹就往右（+x）延伸
  const d = fromRight ? -1 : 1;
  const res = src.crop(out), tmp = new Float32Array(MAXC), tmp2 = new Float32Array(MAXC);
  const lum = (x, y, buf) => { px_readPx(src, x, y, buf, n); return lumaOf(ctx, buf); };
  const w = RW(out);
  const strength = method === 'blast' ? 8 : 4;
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    if (method === 'stagger'){
      // 每行切成 8–40 px 的段，各段顺风移 0–lmax px
      const segLen = 8 + Math.trunc(hash01(0, y, 41, seed) * 32);
      const phase = Math.trunc(hash01(1, y, 42, seed) * segLen);
      const seg = Math.floor((x * d + phase) / segLen);
      const hv = hash01(seg, y, 43, seed);
      const shift = Math.trunc(hv * hv * lmax);
      px_readPx(src, x - d * shift, y, tmp, n);
      for (let c = 0; c < n; c++) res[p + c] = tmp[c];
      continue;
    }
    let bw = 0, bs = x;
    for (let k = 1; k <= lmax; k++){
      const s = x - d * k;
      // 每个来源像素起一条随机长度的风纹；只有边缘起的看得见
      const hv = hash01(s, y, 44, seed);
      const len = Math.max(hv * hv * lmax, 1);
      if (k > len) continue;
      const edge = Math.min(Math.abs(lum(s, y, tmp) - lum(s - d, y, tmp2)) * strength, 1);
      const wgt = edge * (1 - k / (len + 1));
      if (wgt > bw){ bw = wgt; bs = s; }
    }
    if (bw > 0){
      px_readPx(src, bs, y, tmp, n);
      for (let c = 0; c < n; c++) res[p + c] += (tmp[c] - res[p + c]) * bw;
    }
  }
  return res;
}

/* ────────────────── 登记（lib.rs:698-737 kernel() 分派） ────────────────── */
KERNELS.colorHalftone = (src, out, ctx, fp) => px_colorHalftone(src, out, ctx, fp.maxRadius, fp.angles);
KERNELS.crystallize = (src, out, ctx, fp) => px_crystallize(src, out, ctx, fp.cellSize, fp.seed);
KERNELS.facet = (src, out, ctx) => px_facet(src, out, ctx);
KERNELS.fragment = (src, out, ctx) => px_fragment(src, out, ctx);
KERNELS.mezzotint = (src, out, ctx, fp) => px_mezzotint(src, out, ctx, fp.kind, fp.seed);
KERNELS.pointillize = (src, out, ctx, fp) => px_pointillize(src, out, ctx, fp.cellSize, fp.seed, fp.background);
KERNELS.diffuse = (src, out, ctx, fp) => px_diffuse(src, out, ctx, fp.mode, fp.seed);
KERNELS.extrude = (src, out, ctx, fp) => px_extrude(src, out, ctx,
  {kind:fp.kind, size:fp.size, depth:fp.depth, levelBased:fp.levelBased, solidFront:fp.solidFront, maskIncomplete:fp.maskIncomplete, seed:fp.seed});
KERNELS.tiles = (src, out, ctx, fp) => px_tiles(src, out, ctx, fp.count, fp.maxOffset, fp.fill, [fp.foreground, fp.background], fp.seed);
KERNELS.traceContour = (src, out, ctx, fp) => px_traceContour(src, out, ctx, fp.level, fp.upper);
KERNELS.wind = (src, out, ctx, fp) => px_wind(src, out, ctx, fp.method, fp.fromRight, fp.seed);
REACH.extrude = depth => px_extrudeReach(depth);
REACH.wind = method => px_windReach(method);

/* ──────────────── 段：13-render.js ──────────────── */
/* ═══════════ 油画／渲染／减少杂色：algo/src/oil.rs（全档）、render.rs（全档）、denoise.rs（全档） ═══════════
   KERNELS：oilPaint、fibers、lensFlare、lightingEffects、reduceNoise（lib.rs:719-773 kernel() 分派）
   REACH：oil（oil.rs:37）、denoise（denoise.rs:27）
   我们只有 RGB＋alpha：ncol＝3、非 CMYK、非 Lab，原码的 CMYK／Lab／灰阶／via_rgb 分支只留 RGB 那条，算法不改。
   效能：大暂存每次呼叫配一次、同一次呼叫内重复利用；逐格回圈里不配新阵列（与像素无关的量先算好，结果不变）。 */

/* ────────────────── oil.rs ────────────────── */

/* oil.rs:29 stroke_len：笔触长度 */
function rn_strokeLen(stylization){ return 1.5 + clamp(stylization, 0.1, 10) * 2; }
/* oil.rs:32 tensor_sigma：结构张量平滑的 sigma */
function rn_tensorSigma(scale){ return 0.8 + clamp(scale, 0.1, 10) * 0.6; }
/* oil.rs:37 reach：输出块外要读的像素数 */
function rn_oilReach(stylization, scale){ return rn_strokeLen(stylization) + 3 * rn_tensorSigma(scale) + 3 * 2.5 + 4; }

/* oil.rs:93 sample：窗座标 (x,y) 双线性取样（夹在窗内），乘权重 k 加进 acc[0..n)（p＝预乘窗、ww×wh） */
function rn_oilSample(p, ww, wh, n, x, y, k, acc){
  const xc = clamp(x, 0, ww - 1), yc = clamp(y, 0, wh - 1);
  const x0 = Math.floor(xc) | 0, y0 = Math.floor(yc) | 0;            // as usize（已夹 ≥0；|0 只为整数索引快）
  const x1 = Math.min(x0 + 1, ww - 1), y1 = Math.min(y0 + 1, wh - 1);
  const ax = xc - x0, ay = yc - y0;
  const w00 = (1 - ax) * (1 - ay) * k, w10 = ax * (1 - ay) * k, w01 = (1 - ax) * ay * k, w11 = ax * ay * k;
  const i00 = (y0 * ww + x0) * n, i10 = (y0 * ww + x1) * n, i01 = (y1 * ww + x0) * n, i11 = (y1 * ww + x1) * n;
  for (let c = 0; c < n; c++) acc[c] += p[i00 + c] * w00 + p[i10 + c] * w10 + p[i01 + c] * w01 + p[i11 + c] * w11;
}
/* oil.rs:109-146 线积分卷积的一列（拆成独立函数只为让 JS 引擎好最佳化；逻辑同原码）
   L＝{p, tangent, ww, wh, n, wx0, wy0, steps, h, acc}；dx0/dy＝窗座标起点；结果写进 col／bristle 从 base 起 */
function rn_oilLicRow(L, dx0, dy, rw, col, bristle, base){
  const p = L.p, tangent = L.tangent, ww = L.ww, wh = L.wh, n = L.n, steps = L.steps, h = L.h, acc = L.acc, wx0 = L.wx0, wy0 = L.wy0;
  for (let rx = 0; rx < rw; rx++){
    const dx = dx0 + rx;
    for (let c = 0; c < n; c++) acc[c] = 0;
    let wsum = 0, nsum = 0;
    rn_oilSample(p, ww, wh, n, dx, dy, 1, acc);
    wsum += 1;
    nsum += hash01(wx0 + dx, wy0 + dy, 71, 0);
    for (let dir = 1; dir >= -1; dir -= 2){                           // for dir in [1.0, -1.0]
      let qx = dx, qy = dy, ppx = 0, ppy = 0;
      for (let k = 1; k <= steps; k++){
        const ti = ((clamp(rround(qy), 0, wh - 1) | 0) * ww + (clamp(rround(qx), 0, ww - 1) | 0)) * 2;   // |0：去掉 -0、整数索引
        let tx = tangent[ti], ty = tangent[ti + 1];
        if (k === 1){ tx *= dir; ty *= dir; }
        else if (tx * ppx + ty * ppy < 0){ tx = -tx; ty = -ty; }
        ppx = tx; ppy = ty;
        qx += tx * h;
        qy += ty * h;
        const wk = 1 - k / (steps + 1);
        rn_oilSample(p, ww, wh, n, qx, qy, wk, acc);
        wsum += wk;
        nsum += wk * hash01(wx0 + rround(qx), wy0 + rround(qy), 71, 0);
      }
    }
    const o = (base + rx) * n;
    for (let c = 0; c < n; c++) col[o + c] = acc[c] / wsum;
    bristle[base + rx] = nsum / wsum - 0.5;
  }
}

/* oil.rs:41 oil_paint：结构张量给笔触方向场，沿方向线积分卷积（LIC）抹色；同一方向场卷白杂讯得刷毛纹，配亮度成高度图后打光
   spec＝OilSpec（oil.rs:19）：{stylization, cleanliness, scale, bristleDetail, lighting, angle, shine} */
function rn_oilPaint(src, out, ctx, spec){
  const n = src.ch, win = src.rect, ww = RW(win), wh = RH(win), alpha = ctx.alpha, cc = ncol(ctx, n);
  const len = ww * wh;
  // 1. 预乘色，依 cleanliness 先平滑
  const p = premulWindow(src, win, alpha);
  gaussBlurN(p, ww, wh, n, clamp(spec.cleanliness, 0, 10) * 0.25);
  // 2. 给结构张量用的亮度（颜色通道平均，任何色彩模式都通）
  const lum = new Float32Array(len);
  for (let i = 0, o = 0; i < len; i++, o += n){ let s = 0; for (let c = 0; c < cc; c++) s += p[o + c]; lum[i] = s / cc; }
  // 3. 平滑后的结构张量（E, F, G）；边框一格保持 0
  const efg = new Float32Array(len * 3);
  for (let y = 1; y < wh - 1; y++){
    for (let x = 1; x < ww - 1; x++){
      const r0 = (y - 1) * ww + x, r1 = y * ww + x, r2 = (y + 1) * ww + x;
      const gx = (lum[r0 + 1] + 2 * lum[r1 + 1] + lum[r2 + 1]) - (lum[r0 - 1] + 2 * lum[r1 - 1] + lum[r2 - 1]);
      const gy = (lum[r2 - 1] + 2 * lum[r2] + lum[r2 + 1]) - (lum[r0 - 1] + 2 * lum[r0] + lum[r0 + 1]);
      const o = r1 * 3;
      efg[o] = gx * gx;
      efg[o + 1] = gx * gy;
      efg[o + 2] = gy * gy;
    }
  }
  gaussBlurN(efg, ww, wh, 3, rn_tensorSigma(spec.scale));
  // 4. 笔触方向＝次特征向量（沿着边）
  const tangent = new Float32Array(len * 2);
  for (let i = 0; i < len; i++){
    const e = efg[i * 3], f = efg[i * 3 + 1], g = efg[i * 3 + 2];
    const l1 = 0.5 * (e + g + Math.sqrt((e - g) * (e - g) + 4 * f * f));
    const tx = l1 - e, ty = -f;
    const m = Math.sqrt(tx * tx + ty * ty);
    // 近乎各向同性的结构没有稳定方向，当平坦处理：平坦处走轻斜笔触
    if (m < 1e-6 || (l1 - (e + g - l1)) < 1e-6){ tangent[i * 2] = Math.SQRT1_2; tangent[i * 2 + 1] = Math.SQRT1_2; }
    else { tangent[i * 2] = tx / m; tangent[i * 2 + 1] = ty / m; }
  }
  // 5. 线积分卷积，范围＝out 外扩 1（打光要算梯度）
  const r1 = rInter(rInflate(out, 1), win);
  const rw = RW(r1), rh = RH(r1);
  const L = rn_strokeLen(spec.stylization);
  const h = Math.max(L / 10, 1);
  const steps = Math.trunc(Math.ceil(L / h));
  const col = new Float32Array(rw * rh * n);
  const bristle = new Float32Array(rw * rh);
  const acc = new Float64Array(MAXC);
  const lic = {p, tangent, ww, wh, n, wx0:win.x0, wy0:win.y0, steps, h, acc, wsum:0, nsum:0};
  const offX = r1.x0 - win.x0, offY = r1.y0 - win.y0;
  for (let ry = 0; ry < rh; ry++) rn_oilLicRow(lic, offX, offY + ry, rw, col, bristle, ry * rw);

  // 6. 浮雕打光
  const ang = spec.angle * DEG, ls = Math.sin(ang), lc = Math.cos(ang);
  const elev = 45 * DEG;
  const L0 = lc * Math.cos(elev), L1 = -ls * Math.cos(elev), L2 = Math.sin(elev);
  const hv0 = L0, hv1 = L1, hv2 = L2 + 1, hm = Math.sqrt(hv0 * hv0 + hv1 * hv1 + hv2 * hv2);
  const H0 = hv0 / hm, H1 = hv1 / hm, H2 = hv2 / hm;
  const amp = clamp(spec.bristleDetail, 0, 10) / 10;
  const shine = clamp(spec.shine, 0, 10) / 10;
  // 我们只有 RGB：sub（CMYK）＝false、lab＝false
  const height = (rx, ry) => {
    const o = (ry * rw + rx) * n;
    let l = 0; for (let c = 0; c < cc; c++) l += col[o + c];
    l /= cc;
    return l * 2 + bristle[ry * rw + rx] * amp * 6;
  };
  const flatSpec = Math.pow(H2, 40);
  const res = new Float32Array(RW(out) * RH(out) * n), px = new Float32Array(n);
  let k = 0;
  for (let y = out.y0; y < out.y1; y++){
    for (let x = out.x0; x < out.x1; x++, k += n){
      const rx = x - r1.x0, ry = y - r1.y0;
      const o = (ry * rw + rx) * n;
      for (let c = 0; c < n; c++) px[c] = col[o + c];
      unpremulPx(px, alpha);
      // 油画改的是颜色不是覆盖度：保留图层自己的 alpha（透明边缘被抹进来也不会让画布边变淡）
      if (alpha) px[n - 1] = src.get(x, y, n - 1);
      if (spec.lighting){
        const hx = height(Math.min(rx + 1, rw - 1), ry) - height(Math.max(rx - 1, 0), ry);
        const hy = height(rx, Math.min(ry + 1, rh - 1)) - height(rx, Math.max(ry - 1, 0));
        const nv0 = -hx * 0.5, nv1 = -hy * 0.5;
        const m = Math.sqrt(nv0 * nv0 + nv1 * nv1 + 1);
        const ndl = (nv0 * L0 + nv1 * L1 + L2) / m;
        const ndh = Math.max((nv0 * H0 + nv1 * H1 + H2) / m, 0);
        const shade = 1 + (ndl - L2) * 1.2;
        const specV = shine * Math.max(Math.pow(ndh, 40) - flatSpec, 0) * 0.8;
        for (let c = 0; c < cc; c++) px[c] = px[c] * shade + specV;
      }
      res.set(px, k);
    }
  }
  return res;
}

/* ────────────────── render.rs ────────────────── */

/* render.rs:11 value_noise：平滑值杂讯 [0,1) */
function rn_valueNoise(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h00 = hash01(ix, iy, 0, seed), h10 = hash01(ix + 1, iy, 0, seed);
  const h01 = hash01(ix, iy + 1, 0, seed), h11 = hash01(ix + 1, iy + 1, 0, seed);
  const top = h00 + (h10 - h00) * sx;
  const bot = h01 + (h11 - h01) * sx;
  return top + (bot - top) * sy;
}

/* render.rs:25 fibers：前景色与背景色之间的直向纤维纹；variance 管横向变化快慢（与纤维长短），strength 把纤维纵向拉长 */
function rn_fibers(src, out, ctx, variance, strength, seed, colours){
  const n = src.ch;
  const vr = clamp(variance, 1, 64);
  const st = clamp(strength, 1, 64);
  const fg = colours[0], bg = colours[1];
  // 横向频率随 variance 升、纵向频率随 strength 降
  const fx = 0.08 + vr / 64 * 0.6;
  const fy = fx / (2 + st * 1.5) * (0.5 + vr / 32);
  const res = src.crop(out), w = RW(out);
  const seedG = (seed ^ 0x5bd1) >>> 0;
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const xf = out.x0 + i % w, yf = out.y0 + Math.floor(i / w);
    let sum = 0, amp = 1, norm = 0, ax = fx, ay = fy;
    for (let o = 0; o < 4; o++){
      sum += rn_valueNoise(xf * ax, yf * ay, (seed + o * 977) >>> 0) * amp;   // seed.wrapping_add(o * 977)
      norm += amp;
      amp *= 0.55;
      ax *= 2;
      ay *= 2;
    }
    // 每栏细颗粒给出发丝纹理
    const grain = rn_valueNoise(xf * 0.9, yf * fy * 0.25, seedG) - 0.5;
    const t = clamp((sum / norm - 0.5) * (1.6 + vr / 40) + 0.5 + grain * 0.25, 0, 1);
    // set_rgba(ctx, px, [..., 1.0])：RGB 模式原样写四个通道（alpha＝1）
    res[p] = fg[0] + (bg[0] - fg[0]) * t;
    res[p + 1] = fg[1] + (bg[1] - fg[1]) * t;
    res[p + 2] = fg[2] + (bg[2] - fg[2]) * t;
    if (n > 3) res[p + 3] = 1;
  }
  return res;
}

/* render.rs:58 Ghost：光斑鬼影（沿光源→中心轴的位置 t、半径 r、色调 tint、强度 k）；render.rs:76-98 各镜头的参数表 */
const rn_LENS = {
  zoom:{core:14, glow:90, ringR:0, ringW:0, rays:0.5, streak:0, ghosts:[
    {t:0.35, r:10, tint:[0.6, 0.8, 1.0], k:0.18}, {t:0.6, r:26, tint:[0.5, 1.0, 0.6], k:0.10}, {t:0.85, r:6, tint:[1.0, 0.7, 0.4], k:0.25},
    {t:1.25, r:40, tint:[0.7, 0.5, 1.0], k:0.08}, {t:1.5, r:16, tint:[1.0, 0.6, 0.5], k:0.15}, {t:1.9, r:70, tint:[0.5, 0.7, 1.0], k:0.06}]},
  prime35:{core:12, glow:70, ringR:90, ringW:6, rays:0.3, streak:0, ghosts:[{t:0.7, r:18, tint:[0.6, 1.0, 0.7], k:0.12}, {t:1.4, r:30, tint:[1.0, 0.7, 0.5], k:0.09}]},
  prime105:{core:22, glow:130, ringR:0, ringW:0, rays:0.8, streak:0, ghosts:[{t:0.5, r:14, tint:[1.0, 0.8, 0.5], k:0.12}, {t:1.6, r:50, tint:[0.6, 0.7, 1.0], k:0.07}]},
  moviePrime:{core:10, glow:60, ringR:0, ringW:0, rays:0.2, streak:1, ghosts:[
    {t:0.4, r:8, tint:[0.5, 0.7, 1.0], k:0.2}, {t:1.0, r:20, tint:[0.4, 0.6, 1.0], k:0.12}, {t:1.6, r:12, tint:[0.5, 0.8, 1.0], k:0.16}]},
};
const rn_RING_OFF = [1.04, 1.0, 0.96];

/* render.rs:67 lens_flare：加亮（滤色）的光晕、光芒、光环，以及沿过画面中心直线排列的鬼影；镜头类型决定元素 */
function rn_lensFlare(src, out, ctx, brightness, centre, lens){
  const n = src.ch, b = ctx.bounds;
  const bw = RW(b), bh = RH(b);
  const diag = Math.max(Math.hypot(bw, bh), 1);
  const cx = b.x0 + centre[0] * bw, cy = b.y0 + centre[1] * bh;
  const mx = b.x0 + bw / 2, my = b.y0 + bh / 2;
  const bright = clamp(brightness, 10, 300) / 100;
  const s = diag / 1000;
  const Ls = rn_LENS[lens] || rn_LENS.zoom;
  const core = Ls.core, glow = Ls.glow, ringR = Ls.ringR, ringW = Ls.ringW, rays = Ls.rays, streak = Ls.streak;
  // 鬼影中心与像素无关，先算好
  const ng = Ls.ghosts.length, gX = new Float64Array(ng), gY = new Float64Array(ng);
  for (let j = 0; j < ng; j++){ const gh = Ls.ghosts[j]; gX[j] = cx + (mx - cx) * gh.t * 2; gY[j] = cy + (my - cy) * gh.t * 2; }
  const res = src.crop(out), w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    const fx = x + 0.5, fy = y + 0.5;
    const dx = fx - cx, dy = fy - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    let f0 = 0, f1 = 0, f2 = 0;
    // 热核心与大光晕（暖白）
    const q = d / (core * s);
    const g = Math.exp(-(q * q)) + 0.35 * Math.exp(-d / (glow * s));
    f0 += g * 1.0; f1 += g * 0.95; f2 += g * 0.85;
    // 光芒：角度调制，随距离衰减
    if (rays > 0){
      const th = Math.atan2(dy, dx);
      const m = Math.pow(Math.sin(th * 12) * 0.5 + 0.5, 8) + Math.pow(Math.sin(th * 7 + 1.3) * 0.5 + 0.5, 12) * 0.6;
      const rr = rays * m * Math.exp(-d / (glow * 1.6 * s));
      f0 += rr * 0.6; f1 += rr * 0.6; f2 += rr * 0.6;
    }
    // 变形宽银幕横纹（movie prime）
    if (streak > 0){
      const sv = Math.exp(-(Math.abs(dy) / (2.5 * s))) * Math.exp(-(Math.abs(dx) / (450 * s)));
      f0 += sv * 0.5;
      f1 += sv * 0.7;
      f2 += sv;
    }
    // 光环，带一点色散
    if (ringR > 0){
      let rd = (d - ringR * s * rn_RING_OFF[0]) / (ringW * s); f0 += 0.18 * Math.exp(-rd * rd);
      rd = (d - ringR * s * rn_RING_OFF[1]) / (ringW * s); f1 += 0.18 * Math.exp(-rd * rd);
      rd = (d - ringR * s * rn_RING_OFF[2]) / (ringW * s); f2 += 0.18 * Math.exp(-rd * rd);
    }
    // 沿中心轴的鬼影
    for (let j = 0; j < ng; j++){
      const gh = Ls.ghosts[j];
      const ex = fx - gX[j], ey = fy - gY[j];
      const gd = Math.sqrt(ex * ex + ey * ey) / (gh.r * s);
      if (gd < 1.2){
        // 软边圆盘，边缘略亮（smoothstep(1.0, 0.85, …)：e1<=e0 时 fxutil 回传阶梯，照原码）
        const e = smoothstep(1.0, 0.85, gd) * (0.6 + 0.4 * gd);
        f0 += e * gh.k * gh.tint[0];
        f1 += e * gh.k * gh.tint[1];
        f2 += e * gh.k * gh.tint[2];
      }
    }
    // rgba／set_rgba：RGB 模式原样；滤色让亮部停在白以下
    let a = Math.min(Math.max(f0 * bright, 0), 1); res[p] = 1 - (1 - res[p]) * (1 - a);
    a = Math.min(Math.max(f1 * bright, 0), 1); res[p + 1] = 1 - (1 - res[p + 1]) * (1 - a);
    a = Math.min(Math.max(f2 * bright, 0), 1); res[p + 2] = 1 - (1 - res[p + 2]) * (1 - a);
  }
  return res;
}

/* render.rs:178 lighting：把影像当曲面（以纹理通道做凹凸）在聚光／点光／平行光下做 Blinn–Phong 着色
   spec＝LightingSpec（render.rs:157）：{lights, gloss, metallic, exposure, ambience, texture, height, whiteIsHigh}
   norm3（render.rs:168）／dot3（render.rs:172）展开成纯量运算，不配阵列 */
function rn_lighting(src, out, ctx, spec){
  const n = src.ch, b = ctx.bounds;
  const bw = RW(b), bh = RH(b);
  const short = Math.max(Math.min(bw, bh), 1);
  const hscale = clamp(spec.height, 0, 100) / 100 * 0.06 * short;
  const gl = clamp(spec.gloss, -100, 100);
  const shininess = Math.pow(2, 1 + (gl + 100) / 200 * 7);
  const specK = (gl + 100) / 200 * 0.7;
  const metal = (clamp(spec.metallic, -100, 100) + 100) / 200;
  const expo = Math.pow(2, clamp(spec.exposure, -100, 100) / 50);
  const ambient = clamp(spec.ambience, -100, 100) / 100 * 0.5;
  const tmp = new Float32Array(MAXC);
  const texKind = spec.texture, wih = spec.whiteIsHigh;
  // render.rs:190 tex：夹进 bounds 读一格，取所选通道当高度
  const tex = (x, y) => {
    const xx = clamp(x, b.x0, b.x1 - 1), yy = clamp(y, b.y0, b.y1 - 1);
    for (let c = 0; c < n; c++) tmp[c] = src.get(xx, yy, c);
    let v;
    switch (texKind){
      case 'alpha': v = ctx.alpha ? tmp[n - 1] : 1; break;
      case 'luminance': v = lumaOf(ctx, tmp); break;
      case 'red': v = tmp[0]; break;                                   // 我们只有 RGB：直接取通道
      case 'green': v = tmp[1]; break;
      case 'blue': v = tmp[2]; break;
      default: v = 0;                                                  // none
    }
    return wih ? v : 1 - v;
  };
  // 与像素无关的每盏灯常数先算好（光源位置、平行光方向、聚光轴与锥角、强度）
  const lights = (spec.lights || []).map(l => {
    const kind = l.kind === 'infinite' || l.kind === 'point' ? l.kind : 'spot';
    const lx = b.x0 + l.x * bw, ly = b.y0 + l.y * bh, lz = l.z * short;
    const o = {kind, lx, ly, lz, c0:l.color[0], c1:l.color[1], c2:l.color[2], inten0:clamp(l.intensity, -100, 100) / 50,
      d0:0, d1:0, d2:0, a0:0, a1:0, a2:0, outer:0, inner:0, reach:0};
    if (kind === 'infinite'){
      const ang = l.angle * DEG, s = Math.sin(ang), co = Math.cos(ang), e = clamp(l.elevation, 0, 90) * DEG;
      const v0 = co * Math.cos(e), v1 = -s * Math.cos(e), v2 = Math.sin(e), m = Math.max(Math.sqrt(v0 * v0 + v1 * v1 + v2 * v2), 1e-9);
      o.d0 = v0 / m; o.d1 = v1 / m; o.d2 = v2 / m;
    } else if (kind === 'point'){
      o.reach = Math.max(l.radius * short, 1);
    } else {
      const tx = b.x0 + l.targetX * bw, ty = b.y0 + l.targetY * bh, tz = 0;
      const v0 = tx - lx, v1 = ty - ly, v2 = tz - lz, m = Math.max(Math.sqrt(v0 * v0 + v1 * v1 + v2 * v2), 1e-9);
      o.a0 = v0 / m; o.a1 = v1 / m; o.a2 = v2 / m;
      const cone = clamp(l.cone, 1, 89);
      o.outer = Math.cos(cone * DEG);
      o.inner = Math.cos(cone * (clamp(l.hotspot, 0, 100) / 100) * DEG);
    }
    return o;
  });
  const flatN = texKind === 'none' || hscale <= 0;
  const res = src.crop(out), w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    const fx = x + 0.5, fy = y + 0.5;
    let n0 = 0, n1 = 0, n2 = 1;
    if (!flatN){
      const hx = (tex(x + 1, y) - tex(x - 1, y)) * 0.5 * hscale;
      const hy = (tex(x, y + 1) - tex(x, y - 1)) * 0.5 * hscale;
      const m = Math.max(Math.sqrt(hx * hx + hy * hy + 1), 1e-9);
      n0 = -hx / m; n1 = -hy / m; n2 = 1 / m;
    }
    const base0 = res[p], base1 = res[p + 1], base2 = res[p + 2];
    let lit0 = ambient, lit1 = ambient, lit2 = ambient, spc0 = 0, spc1 = 0, spc2 = 0;
    for (let j = 0; j < lights.length; j++){
      const l = lights[j];
      let ld0, ld1, ld2, atten;
      if (l.kind === 'infinite'){ ld0 = l.d0; ld1 = l.d1; ld2 = l.d2; atten = 1; }
      else {
        const v0 = l.lx - fx, v1 = l.ly - fy, v2 = l.lz;
        const m = Math.max(Math.sqrt(v0 * v0 + v1 * v1 + v2 * v2), 1e-9);
        ld0 = v0 / m; ld1 = v1 / m; ld2 = v2 / m;
        if (l.kind === 'point'){
          const dist = Math.sqrt(v0 * v0 + v1 * v1);
          const t = clamp(1 - dist / l.reach, 0, 1);
          atten = t * t;
        } else {
          const cosang = -(ld0 * l.a0 + ld1 * l.a1 + ld2 * l.a2);
          atten = smoothstep(l.outer, Math.max(l.inner, l.outer + 1e-4), cosang);
        }
      }
      if (atten <= 0) continue;
      const inten = l.inten0 * atten;
      const ndl = Math.max(n0 * ld0 + n1 * ld1 + n2 * ld2, 0);
      const h2 = ld2 + 1, hm = Math.max(Math.sqrt(ld0 * ld0 + ld1 * ld1 + h2 * h2), 1e-9);
      const s = Math.pow(Math.max((n0 * ld0 + n1 * ld1 + n2 * h2) / hm, 0), shininess) * specK;
      const ip = Math.max(inten, 0);
      lit0 += ndl * inten * l.c0; lit1 += ndl * inten * l.c1; lit2 += ndl * inten * l.c2;
      // 金属感高光取表面色，塑胶感取光色
      spc0 += s * ip * (l.c0 * (1 - metal) + base0 * metal);
      spc1 += s * ip * (l.c1 * (1 - metal) + base1 * metal);
      spc2 += s * ip * (l.c2 * (1 - metal) + base2 * metal);
    }
    res[p] = Math.max((base0 * lit0 + spc0) * expo, 0);
    res[p + 1] = Math.max((base1 * lit1 + spc1) * expo, 0);
    res[p + 2] = Math.max((base2 * lit2 + spc2) * expo, 0);
  }
  return res;
}

/* ────────────────── denoise.rs ────────────────── */

const rn_MAX_LUMA_R = 5, rn_MAX_CHROMA_R = 9;                     // denoise.rs:23-24
/* denoise.rs:27 reach：每个导向滤波两趟方框、再加锐化 */
function rn_denoiseReach(){ return 2 * rn_MAX_LUMA_R + 2 * rn_MAX_CHROMA_R + 6; }

/* denoise.rs:32 guided：以 g 为导引对 p 做导向滤波（w×h、方框半径 r）；m／ab／dst 为呼叫端给的暂存（每次全覆写） */
function rn_guided(g, p, w, h, r, eps, m, ab, dst){
  const len = w * h;
  // 四个矩交错放，一趟方框模糊做完
  for (let i = 0; i < len; i++){
    m[i * 4] = g[i];
    m[i * 4 + 1] = p[i];
    m[i * 4 + 2] = g[i] * g[i];
    m[i * 4 + 3] = g[i] * p[i];
  }
  boxBlurN(m, w, h, 4, r);
  for (let i = 0; i < len; i++){
    const mg = m[i * 4], mp = m[i * 4 + 1], mgg = m[i * 4 + 2], mgp = m[i * 4 + 3];
    const vr = Math.max(mgg - mg * mg, 0);
    const a = (mgp - mg * mp) / (vr + eps);
    ab[i * 2] = a;
    ab[i * 2 + 1] = mp - a * mg;
  }
  boxBlurN(ab, w, h, 2, r);
  for (let i = 0; i < len; i++) dst[i] = ab[i * 2] * g[i] + ab[i * 2 + 1];
  return dst;
}

/* denoise.rs:55 reduce_noise：保边的亮度平滑、以亮度导引的色度平滑、可选细节锐化
   spec＝DenoiseSpec（denoise.rs:15）：{strength, preserve, color, sharpen, jpeg} */
function rn_reduceNoise(src, out, ctx, spec){
  const n = src.ch, win = src.rect, ww = RW(win), wh = RH(win), len = ww * wh;
  const s = clamp(spec.strength, 0, 10) / 10;
  const col = clamp(spec.color, 0, 100) / 100;
  const sh = clamp(spec.sharpen, 0, 100) / 100;
  if ((s <= 0 && col <= 0 && sh <= 0 && !spec.jpeg) || len === 0) return src.crop(out);
  // 拆成亮度＋两个色度平面（我们只有 RGB＝Ycc 模型）
  const yv = new Float32Array(len), c1 = new Float32Array(len), c2 = new Float32Array(len);
  for (let i = 0; i < len; i++){
    const x = win.x0 + i % ww, y = win.y0 + Math.floor(i / ww);
    const r = src.get(x, y, 0), g = src.get(x, y, 1), bb = src.get(x, y, 2);
    const l = 0.299 * r + 0.587 * g + 0.114 * bb;
    yv[i] = l;
    c1[i] = bb - l;
    c2[i] = r - l;
  }
  // JPEG 去块：沿 8×8 格线（以文件座标锚定）柔化亮度
  if (spec.jpeg){
    const orig = yv.slice();
    for (let yy = 1; yy < wh - 1; yy++){
      for (let xx = 1; xx < ww - 1; xx++){
        const dx = remE(win.x0 + xx, 8), dy = remE(win.y0 + yy, 8);
        if (dx === 0 || dx === 7 || dy === 0 || dy === 7){
          let a = 0;
          for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) a += orig[(yy + j - 1) * ww + xx + k - 1];
          yv[yy * ww + xx] = 0.5 * orig[yy * ww + xx] + 0.5 * a / 9;
        }
      }
    }
  }
  // 导向滤波暂存：三次呼叫共用
  const m = (s > 0 || col > 0) ? new Float32Array(len * 4) : null;
  const ab = (s > 0 || col > 0) ? new Float32Array(len * 2) : null;
  const d = (s > 0 || col > 0) ? new Float32Array(len) : null;
  // 亮度：保边平滑；保留细节缩小正则项
  if (s > 0){
    const r = rround(1 + clamp(spec.strength, 0, 10) * 0.4);
    const keep = clamp(spec.preserve, 0, 100) / 100;
    const e0 = 0.004 + 0.05 * s, eps = e0 * e0 * (1.05 - keep);
    rn_guided(yv, yv, ww, wh, Math.min(r, rn_MAX_LUMA_R), eps, m, ab, d);
    const k = Math.sqrt(s);
    for (let i = 0; i < len; i++) yv[i] += (d[i] - yv[i]) * k;
  }
  // 色度：以清过的亮度导引，色边不跑
  if (col > 0){
    const r = rround(1 + col * 8);
    const e0 = 0.01 + 0.05 * col, eps = e0 * e0;
    for (const plane of [c1, c2]){
      rn_guided(yv, plane, ww, wh, Math.min(r, rn_MAX_CHROMA_R), eps, m, ab, d);
      for (let i = 0; i < len; i++) plane[i] += (d[i] - plane[i]) * col;
    }
  }
  // 锐化细节：对亮度做 USM
  if (sh > 0){
    const bl = yv.slice();
    gaussBlurN(bl, ww, wh, 1, 1.0);
    for (let i = 0; i < len; i++) yv[i] += (yv[i] - bl[i]) * sh * 1.2;
  }
  const res = src.crop(out), w = RW(out);
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w);
    const k = (y - win.y0) * ww + (x - win.x0);
    const l = yv[k];
    const bb = c1[k] + l, r = c2[k] + l;
    const g = (l - 0.299 * r - 0.114 * bb) / 0.587;
    res[p] = r;
    res[p + 1] = g;
    res[p + 2] = bb;
  }
  return res;
}

/* ────────────────── 登记（lib.rs:719-773 kernel() 分派） ────────────────── */
KERNELS.oilPaint = (src, out, ctx, fp) => rn_oilPaint(src, out, ctx,
  {stylization:fp.stylization, cleanliness:fp.cleanliness, scale:fp.scale, bristleDetail:fp.bristleDetail, lighting:fp.lighting, angle:fp.angle, shine:fp.shine});
KERNELS.fibers = (src, out, ctx, fp) => rn_fibers(src, out, ctx, fp.variance, fp.strength, fp.seed, [fp.foreground, fp.background]);
KERNELS.lensFlare = (src, out, ctx, fp) => rn_lensFlare(src, out, ctx, fp.brightness, [fp.centerX, fp.centerY], fp.lens);
KERNELS.lightingEffects = (src, out, ctx, fp) => rn_lighting(src, out, ctx,
  {lights:fp.lights, gloss:fp.gloss, metallic:fp.metallic, exposure:fp.exposure, ambience:fp.ambience, texture:fp.texture, height:fp.height, whiteIsHigh:fp.whiteIsHigh});
KERNELS.reduceNoise = (src, out, ctx, fp) => rn_reduceNoise(src, out, ctx,
  {strength:fp.strength, preserve:fp.preserveDetails, color:fp.reduceColorNoise, sharpen:fp.sharpenDetails, jpeg:fp.removeJpegArtifact});
REACH.oil = (stylization, scale) => rn_oilReach(stylization, scale);
REACH.denoise = () => rn_denoiseReach();

/* ──────────────── 段：14-blur2.js ──────────────── */
/* ═══════════ 特殊模糊、形状模糊、镜头模糊（algo/src/blur2.rs 1-381）＋ 模糊画廊（algo/src/gallery.rs） ═══════════ */
/* blur2.rs:19 Spans：二值核拆成横向一段段 (dy, dx0, dx1)（含端点） */
function bg_spans(r, inside){
  const ri = Math.ceil(Math.max(r, 0)), rows = []; let count = 0;
  if (r < 0.5) return {rows:[[0, 0, 0]], count:1};
  for (let dy = -ri; dy <= ri; dy++){
    let run = null;
    for (let dx = -ri; dx <= ri + 1; dx++){
      const hit = dx <= ri && inside(dx / r, dy / r);
      if (hit && run === null) run = dx;
      else if (!hit && run !== null){ rows.push([dy, run, dx - 1]); count += dx - run; run = null; }
    }
  }
  if (!rows.length){ rows.push([0, 0, 0]); count = 1; }
  return {rows, count};
}
/* blur2.rs:57 Prefix：每列的前缀和（(w+1)×h×n，f64） */
function bg_prefix(p, w, h, n){
  const data = new Float64Array((w + 1) * h * n);
  for (let y = 0; y < h; y++){
    const s = y * w * n, d = y * (w + 1) * n;
    for (let x = 0; x < w; x++) for (let c = 0; c < n; c++) data[d + (x + 1) * n + c] = data[d + x * n + c] + p[s + x * n + c];
  }
  return {w, h, n, data};
}
/* blur2.rs:80 mean：核平均写进 acc */
function bg_mean(pre, spans, x, y, acc){
  const n = pre.n, w = pre.w, h = pre.h, d = pre.data, rows = spans.rows;
  for (let c = 0; c < n; c++) acc[c] = 0;
  for (let k = 0; k < rows.length; k++){
    const dy = rows[k][0], yy = y + dy; if (yy < 0 || yy >= h) continue;
    const x0 = clamp(x + rows[k][1], 0, w), x1 = clamp(x + rows[k][2] + 1, 0, w), row = yy * (w + 1) * n;
    for (let c = 0; c < n; c++) acc[c] += d[row + x1 * n + c] - d[row + x0 * n + c];
  }
  for (let c = 0; c < n; c++) acc[c] /= spans.count;
}
/* blur2.rs:104 in_poly（奇偶规则） */
function bg_inPoly(u, v, pts){
  let inside = false, j = pts.length - 1;
  for (let i = 0; i < pts.length; i++){
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}
/* blur2.rs:119 polygon_radius：正 n 边形（外接圆半径 1）在 theta 方向的半径 */
function bg_polygonRadius(theta, n, rot){ const seg = TAU / n, a = remE(theta - rot, seg) - seg / 2; return Math.cos(Math.PI / n) / Math.cos(a); }
/* blur2.rs:125 shape_inside */
function bg_shapeInside(shape){
  switch (shape){
    case 'ring': return (u, v) => { const d = u * u + v * v; return d >= 0.36 && d <= 1; };
    case 'square': return () => true;
    case 'diamond': return (u, v) => Math.abs(u) + Math.abs(v) <= 1;
    case 'triangle': return (u, v) => v <= 0.75 && Math.abs(u) <= (v + 1) / 1.75;
    case 'hexagon': return (u, v) => Math.sqrt(u * u + v * v) <= bg_polygonRadius(Math.atan2(v, u), 6, 0);
    case 'star': { const pts = []; for (let i = 0; i < 10; i++){ const r = i % 2 === 0 ? 1 : 0.42, a = -Math.PI / 2 + i * Math.PI / 5; pts.push([r * Math.cos(a), r * Math.sin(a)]); } return (u, v) => bg_inPoly(u, v, pts); }
    case 'heart': return (u, v) => { const x = u * 1.2, y = -v * 1.2 + 0.15; return Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y <= 0; };   // (x²+y²−1)³ − x²y³ ≤ 0
    case 'cross': return (u, v) => Math.abs(u) <= 0.3 || Math.abs(v) <= 0.3;
    default: return (u, v) => u * u + v * v <= 1;                  // circle
  }
}
/* blur2.rs:156 shape_blur ＋ 161 conv_spans */
function bg_convSpans(src, out, ctx, spans){
  const n = src.ch, win = src.rect, ww = RW(win), wh = RH(win);
  const pre = bg_prefix(premulWindow(src, win, ctx.alpha), ww, wh, n);
  const acc = new Float64Array(n), px = new Float32Array(n), res = new Float32Array(RW(out) * RH(out) * n); let k = 0;
  for (let y = out.y0; y < out.y1; y++) for (let x = out.x0; x < out.x1; x++){
    bg_mean(pre, spans, x - win.x0, y - win.y0, acc);
    for (let c = 0; c < n; c++) px[c] = acc[c];
    unpremulPx(px, ctx.alpha);
    for (let c = 0; c < n; c++) res[k++] = px[c];
  }
  return res;
}
KERNELS.shapeBlur = (src, out, ctx, fp) => bg_convSpans(src, out, ctx, bg_spans(Math.max(fp.radius, 0), bg_shapeInside(fp.shape)));

/* blur2.rs:188 smart_blur：只平均跟中心差在阈值内的邻居；只限边缘／叠加边缘＝把边缘画白 */
KERNELS.smartBlur = (src, out, ctx, fp) => {
  const n = src.ch, cc = ncol(ctx, n), r = clamp(fp.radius, 0.1, 100), t = clamp(fp.threshold, 0.1, 100) / 255, ri = Math.ceil(r);
  const target = fp.quality === 'low' ? 4 : fp.quality === 'medium' ? 7 : 12;
  const stride = Math.max(Math.trunc((ri + target - 1) / target), 1);
  const offs = [];
  for (let dy = -ri; dy <= ri; dy += stride) for (let dx = -ri; dx <= ri; dx += stride) if (dx * dx + dy * dy <= r * r + 0.5) offs.push([dx, dy]);
  const res = src.crop(out), q = new Float32Array(n), acc = new Float32Array(n), me = new Float32Array(n), w = RW(out);
  const differs = qq => { for (let c = 0; c < cc; c++) if (Math.abs(qq[c] - me[c]) > t) return true; return false; };
  const N = RW(out) * RH(out);
  for (let i = 0; i < N; i++){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w), j = i * n;
    for (let c = 0; c < n; c++) me[c] = res[j + c];
    if (fp.mode !== 'normal'){
      let edge = false;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]){
        for (let c = 0; c < n; c++) q[c] = src.get(x + dx, y + dy, c);
        if (differs(q)){ edge = true; break; }
      }
      const a = ctx.alpha ? res[j + n - 1] : 1;
      if (edge) for (let c = 0; c < cc; c++) res[j + c] = 1;           // white
      else if (fp.mode === 'edgeOnly') for (let c = 0; c < cc; c++) res[j + c] = 0;   // black
      if (ctx.alpha) res[j + n - 1] = a;
      continue;
    }
    acc.fill(0); let wsum = 0;
    for (let o = 0; o < offs.length; o++){
      const dx = offs[o][0], dy = offs[o][1];
      for (let c = 0; c < n; c++) q[c] = src.get(x + dx, y + dy, c);
      if (differs(q)) continue;
      const a = ctx.alpha ? q[n - 1] : 1;
      for (let c = 0; c < n; c++) acc[c] += (ctx.alpha && c < n - 1) ? q[c] * a : q[c];
      wsum += 1;
    }
    if (wsum > 0){
      for (let c = 0; c < n; c++) res[j + c] = acc[c] / wsum;
      const A = res[j + n - 1]; if (ctx.alpha) for (let c = 0; c < n - 1; c++) res[j + c] = A > 1e-7 ? res[j + c] / A : 0;   // unpremul_px
    }
  }
  return res;
};

/* blur2.rs:281-381 lens_blur：光圈形（多边形→按弯度变圆）散景核；高光先提亮再模糊；有深度就按离焦平面距离在 9 级半径间内插；最后加杂色 */
const BG_LENS_LEVELS = 8;
KERNELS.lensBlur = (src, out, ctx, fp) => {
  const n = src.ch, cc = ncol(ctx, n), win = src.rect, ww = RW(win), wh = RH(win);
  const rmax = clamp(fp.radius, 0, 100), blades = clamp(fp.blades, 3, 8), curv = clamp(fp.curvature, 0, 100) / 100, rot = fp.rotation * DEG;
  const iris = (u, v) => { const rho = Math.sqrt(u * u + v * v), pr = bg_polygonRadius(Math.atan2(v, u), blades, rot - Math.PI / 2); return rho <= pr + (1 - pr) * curv; };
  const levels = []; for (let k = 0; k <= BG_LENS_LEVELS; k++) levels.push(bg_spans(rmax * k / BG_LENS_LEVELS, iris));
  const p = premulWindow(src, win, ctx.alpha);
  const boost = clamp(fp.brightness, 0, 100) / 100 * 4;
  if (boost > 0){                                                  // 镜面高光提亮
    const th = clamp(fp.threshold, 0, 255) / 255, st = new Float32Array(n);
    for (let j = 0; j < p.length; j += n){
      const a = ctx.alpha ? p[j + n - 1] : 1; if (a <= 0) continue;
      for (let c = 0; c < n; c++) st[c] = (ctx.alpha && c < n - 1) ? p[j + c] / a : p[j + c];
      const l = lumaOf(ctx, st), k = 1 + boost * smoothstep(th, th + 0.02, l);
      for (let c = 0; c < cc; c++) p[j + c] = subtractive(ctx) ? a - (a - p[j + c]) / k : p[j + c] * k;
    }
  }
  const pre = bg_prefix(p, ww, wh, n);
  const depthAt = (x, y) => {
    let d;
    if (fp.depth === 'none') return null;
    if (fp.depth === 'transparency'){ if (!ctx.alpha) return null; d = src.get(x, y, n - 1); }
    else { if (!fp.depthMap) return null; d = fp.depthMap.get(x, y, 0); }
    return fp.invertDepth ? 1 - d : d;
  };
  const focal = clamp(fp.focalDistance, 0, 255) / 255, amount = clamp(fp.noise, 0, 100) / 100 * 0.25;
  const acc = new Float64Array(n), acc2 = new Float64Array(n), px = new Float32Array(n), res = new Float32Array(RW(out) * RH(out) * n); let k = 0;
  for (let y = out.y0; y < out.y1; y++) for (let x = out.x0; x < out.x1; x++){
    const wx = x - win.x0, wy = y - win.y0, d = depthAt(x, y);
    const level = d === null ? BG_LENS_LEVELS : Math.min(Math.abs(d - focal) * BG_LENS_LEVELS, BG_LENS_LEVELS);
    const lo = Math.floor(level), f = level - lo;
    bg_mean(pre, levels[lo], wx, wy, acc);
    if (f > 1e-4 && lo < BG_LENS_LEVELS){ bg_mean(pre, levels[lo + 1], wx, wy, acc2); for (let c = 0; c < n; c++) acc[c] += (acc2[c] - acc[c]) * f; }
    for (let c = 0; c < n; c++) px[c] = acc[c];
    unpremulPx(px, ctx.alpha);
    if (amount > 0 && (!ctx.alpha || px[n - 1] > 0)){
      for (let c = 0; c < cc; c++){
        const ch = fp.monochromatic ? 0 : c;
        if (fp.distribution === 'gaussian'){ const u1 = Math.max(hash01(x, y, ch * 2 + 301, fp.seed), 1e-7), u2 = hash01(x, y, ch * 2 + 302, fp.seed); px[c] += Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2) * amount * 0.5; }
        else px[c] += (hash01(x, y, ch + 200, fp.seed) - 0.5) * 2 * amount;
      }
    }
    for (let c = 0; c < n; c++) res[k++] = px[c];
  }
  return res;
};

/* ── 模糊画廊（algo/src/gallery.rs 1-277）：空间变化的高斯＝在 0 与几何级数 σ 的几层之间按帽形权重内插 ── */
const bg_sigmaOf = blur => clamp(blur, 0, 500) * 0.6;              // gallery.rs:16
REACH.gallery = blur => 3 * bg_sigmaOf(blur) + 2;                    // gallery.rs:21
const BG_LEVELS = 6;
/* gallery.rs:28 variable_blur：每格 σ＝sigma(x+.5, y+.5)（≤ smax） */
function bg_variableBlur(src, out, ctx, smax, sigma){
  const n = src.ch;
  if (smax < 0.3) return src.crop(out);
  const win = src.rect, ww = RW(win), wh = RH(win), ow = RW(out), oh = RH(out);
  const lv = [0]; for (let k = 0; k < BG_LEVELS; k++) lv.push(smax / Math.pow(2, BG_LEVELS - 1 - k));
  const sig = new Float32Array(ow * oh);
  for (let i = 0; i < ow * oh; i++){ const x = out.x0 + i % ow, y = out.y0 + Math.floor(i / ow); sig[i] = clamp(sigma(x + 0.5, y + 0.5), 0, smax); }
  const weight = (k, s) => {                                       // 第 k 层在 σ=s 的帽形权重
    const c = lv[k];
    if (k > 0 && s >= lv[k - 1] && s <= c) return (s - lv[k - 1]) / Math.max(c - lv[k - 1], 1e-6);
    if (k + 1 < lv.length && s >= c && s <= lv[k + 1]) return (lv[k + 1] - s) / Math.max(lv[k + 1] - c, 1e-6);
    if (k + 1 === lv.length && s >= c) return 1;
    return 0;
  };
  const p = premulWindow(src, win, ctx.alpha), acc = new Float32Array(ow * oh * n);
  let buf = null;
  for (let k = 0; k < lv.length; k++){
    let any = false; for (let i = 0; i < sig.length && !any; i++) if (weight(k, sig[i]) > 0) any = true;
    if (!any) continue;
    let level;
    if (k === 0) level = p; else { if (!buf) buf = new Float32Array(p.length); buf.set(p); gaussBlurN(buf, ww, wh, n, lv[k]); level = buf; }
    for (let i = 0; i < sig.length; i++){
      const wk = weight(k, sig[i]); if (wk <= 0) continue;
      const x = out.x0 + i % ow, y = out.y0 + Math.floor(i / ow), o = ((y - win.y0) * ww + (x - win.x0)) * n;
      for (let c = 0; c < n; c++) acc[i * n + c] += level[o + c] * wk;
    }
  }
  for (let j = 0; j < acc.length; j += n){ const a = acc[j + n - 1]; if (ctx.alpha) for (let c = 0; c < n - 1; c++) acc[j + c] = a > 1e-7 ? acc[j + c] / a : 0; }
  return acc;
}
const bg_shortSide = b => Math.max(Math.min(RW(b), RH(b)), 1);    // gallery.rs:90
/* gallery.rs:97 tilt_shift：过中心、沿 angle 的清晰带，超过 focus 后在 transition 内渐糊（都是短边的比例） */
KERNELS.tiltShift = (src, out, ctx, fp) => {
  const b = ctx.bounds, ss = bg_shortSide(b), cx = b.x0 + fp.centerX * RW(b), cy = b.y0 + fp.centerY * RH(b);
  const nx = Math.sin(fp.angle * DEG), ny = Math.cos(fp.angle * DEG), smax = bg_sigmaOf(fp.blur);
  const f0 = Math.max(fp.focus, 0), f1 = Math.max(fp.focus, 0) + Math.max(fp.transition, 1e-3);
  return bg_variableBlur(src, out, ctx, smax, (x, y) => smax * smoothstep(f0, f1, Math.abs((x - cx) * nx + (y - cy) * ny) / ss));
};
/* gallery.rs:114 pin_distance：到光圈／旋转钉的（超）椭圆正规化距离 → [e, u, v] */
function bg_pinDistance(x, y, b, px, py, rx, ry, angle, m){
  const ss = bg_shortSide(b), cx = b.x0 + px * RW(b), cy = b.y0 + py * RH(b), s = Math.sin(angle * DEG), c = Math.cos(angle * DEG);
  const dx = x - cx, dy = y - cy;
  const u = (dx * c + dy * s) / (Math.max(rx, 1e-3) * ss), v = (-dx * s + dy * c) / (Math.max(ry, 1e-3) * ss);
  const e = Math.abs(m - 2) < 1e-3 ? Math.sqrt(u * u + v * v) : Math.pow(Math.pow(Math.abs(u), m) + Math.pow(Math.abs(v), m), 1 / m);
  return [e, u, v];
}
/* gallery.rs:127 iris：每个钉的椭圆外糊、核心＝feather；任一钉清晰就清晰（取最小 σ） */
KERNELS.irisBlur = (src, out, ctx, fp) => {
  const b = ctx.bounds, pins = fp.pins;
  const smax = pins.reduce((m, q) => Math.max(m, bg_sigmaOf(q.blur)), 0);
  if (!pins.length) return src.crop(out);
  return bg_variableBlur(src, out, ctx, smax, (x, y) => {
    let best = Number.MAX_VALUE;
    for (const q of pins){
      const m = 2 + clamp(q.roundness, 0, 100) / 100 * 6, e = bg_pinDistance(x, y, b, q.x, q.y, q.radiusX, q.radiusY, q.angle, m)[0];
      best = Math.min(best, bg_sigmaOf(q.blur) * smoothstep(clamp(q.feather, 0, 0.999), 1, e));
    }
    return best;
  });
};
/* gallery.rs:145 field：各钉的模糊量按距离平方倒数内插 */
KERNELS.fieldBlur = (src, out, ctx, fp) => {
  const b = ctx.bounds, pins = fp.pins;
  if (!pins.length) return src.crop(out);
  const smax = pins.reduce((m, q) => Math.max(m, bg_sigmaOf(q.blur)), 0);
  const pts = pins.map(q => [b.x0 + q.x * RW(b), b.y0 + q.y * RH(b), bg_sigmaOf(q.blur)]);
  return bg_variableBlur(src, out, ctx, smax, (x, y) => {
    let ws = 0, s = 0;
    for (const [px, py, sg] of pts){ const w = 1 / ((x - px) * (x - px) + (y - py) * (y - py) + 1); ws += w; s += w * sg; }
    return s / ws;
  });
};
/* gallery.rs:166 spin：椭圆内沿绕中心的弧取样平均，边缘羽化 */
KERNELS.spinBlur = (src, out, ctx, fp) => {
  const n = src.ch, b = ctx.bounds, ss = bg_shortSide(b), res = src.crop(out), clip = rInter(b, src.rect);
  if (rEmpty(clip)) return res;
  const acc = new Float32Array(n), w = RW(out), N = RW(out) * RH(out);
  for (let i = 0; i < N; i++){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w), fx = x + 0.5, fy = y + 0.5, j0 = i * n;
    for (const p of fp.pins){
      const [e, u, v] = bg_pinDistance(fx, fy, b, p.x, p.y, p.radiusX, p.radiusY, p.angle, 2);
      if (e >= 1) continue;
      const theta = clamp(p.blurAngle, 0, 360) * DEG, rpx = e * Math.max(p.radiusX, p.radiusY) * ss;
      const m = clamp(Math.ceil(theta * rpx / 2), 2, 64);           // 弧上约 2px 一个样本
      const cx = b.x0 + p.x * RW(b), cy = b.y0 + p.y * RH(b), sa = Math.sin(p.angle * DEG), ca = Math.cos(p.angle * DEG);
      acc.fill(0);
      for (let j = 0; j < m; j++){
        const phi = theta * (j / (m - 1) - 0.5), sp = Math.sin(phi), cp = Math.cos(phi);
        const ru = u * cp - v * sp, rv = u * sp + v * cp, lu = ru * p.radiusX * ss, lv = rv * p.radiusY * ss;
        addSamplePremul(src, cx + lu * ca - lv * sa, cy + lu * sa + lv * ca, clip, ctx.alpha, acc);
      }
      for (let c = 0; c < n; c++) acc[c] /= m;
      unpremulPx(acc, ctx.alpha);
      const k = 1 - smoothstep(0.85, 1, e);
      for (let c = 0; c < n; c++) res[j0 + c] += (acc[c] - res[j0 + c]) * k;
      break;
    }
  }
  return res;
};
/* 路径模糊（照 PS 模糊画廊▸路径模糊；原 gallery.rs:217 是「最近切线方向的直线动态模糊」，弯路径拖不出弯的烟）：
   路径＝过控制点的平滑曲线（Catmull-Rom，跟对话框画在画布上的线同一条）；
   方向场＝各小段切线按「段长／(距离²+1)^1.5」加权（离哪段近就顺哪段），先算在 4px 格点上、取样时双线性；
   每格沿方向场的「流线」往前／往后一步步走着取样 ⇒ 拖影顺着弯路径弯；
   长度＝速度% × 终点速度（px，沿路径从起点那头的值渐变到终点那头的值）；居中模糊＝前后各半，不居中＝只往后拖；
   锥度＝拖影越往尾端权重越轻；后帘同步闪光＝原位再叠一份清楚的 */
function pbCurve(pts, sub){
  if (pts.length < 3) return pts.map(q => q.slice());
  const out = [pts[0].slice()], P = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let k = 0; k < pts.length - 1; k++){
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    for (let j = 1; j <= sub; j++){
      const t = j / sub, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  return out;
}
KERNELS.pathBlur = (src, out, ctx, fp) => {
  const n = src.ch, b = ctx.bounds, bw = RW(b), bh = RH(b), segs = [];
  fp.paths.forEach(p => {
    const pts = pbCurve(p.points.map(q => [b.x0 + q[0] * bw, b.y0 + q[1] * bh]), 16);
    let total = 0; for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    total = Math.max(total, 1e-3);
    const e0 = p.speed / 100 * p.endSpeeds[0], e1 = p.speed / 100 * p.endSpeeds[1];
    let run = 0;
    for (let k = 1; k < pts.length; k++){
      const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); if (l < 1e-6) continue;
      const along = (run + l / 2) / total; run += l;
      segs.push([pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], l, e0 + (e1 - e0) * along, clamp(p.taper, 0, 100) / 100]);
    }
  });
  const res = src.crop(out), clip = rInter(b, src.rect);
  if (!segs.length || rEmpty(clip)) return res;
  // 方向场格点：[ux, uy, 长度, 锥度]
  const G = 4, gw = Math.ceil(RW(clip) / G) + 1, gh = Math.ceil(RH(clip) / G) + 1, F = new Float32Array(gw * gh * 4);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++){
    const X = clip.x0 + gx * G, Y = clip.y0 + gy * G;
    let dx = 0, dy = 0, L = 0, T = 0, ws = 0;
    for (const [ax, ay, bx, by, l, len, tp] of segs){
      const sx = bx - ax, sy = by - ay, t = clamp(((X - ax) * sx + (Y - ay) * sy) / (l * l), 0, 1), ex = X - ax - sx * t, ey = Y - ay - sy * t;
      const d2 = ex * ex + ey * ey + 1, wt = l / (d2 * Math.sqrt(d2));
      dx += wt * sx / l; dy += wt * sy / l; L += wt * len; T += wt * tp; ws += wt;
    }
    const m = Math.hypot(dx, dy), o = (gy * gw + gx) * 4;
    F[o] = m > 1e-12 ? dx / m : 0; F[o + 1] = m > 1e-12 ? dy / m : 0; F[o + 2] = ws > 0 ? L / ws : 0; F[o + 3] = ws > 0 ? T / ws : 0;
  }
  const FA = new Float64Array(4);
  const fieldAt = (x, y) => {
    const u = clamp((x - clip.x0) / G, 0, gw - 1), v = clamp((y - clip.y0) / G, 0, gh - 1), x0 = Math.min(Math.floor(u), gw - 2 < 0 ? 0 : gw - 2), y0 = Math.min(Math.floor(v), gh - 2 < 0 ? 0 : gh - 2);
    const x1 = Math.min(x0 + 1, gw - 1), y1 = Math.min(y0 + 1, gh - 1), ax = u - x0, ay = v - y0;
    const o00 = (y0 * gw + x0) * 4, o10 = (y0 * gw + x1) * 4, o01 = (y1 * gw + x0) * 4, o11 = (y1 * gw + x1) * 4;
    for (let c = 0; c < 4; c++) FA[c] = (F[o00 + c] * (1 - ax) + F[o10 + c] * ax) * (1 - ay) + (F[o01 + c] * (1 - ax) + F[o11 + c] * ax) * ay;
  };
  // 双线性取样（预乘），不配置新阵列
  const sd = src.data, sw = RW(src.rect), sx0 = src.rect.x0, sy0 = src.rect.y0, alpha = ctx.alpha, acc = new Float64Array(n);
  const tap = (xx, yy, k) => {
    if (k <= 0) return;
    const i = ((yy - sy0) * sw + (xx - sx0)) * n;
    if (alpha){ const a = sd[i + n - 1] * k; for (let c = 0; c < n - 1; c++) acc[c] += sd[i + c] * a; acc[n - 1] += a; }
    else for (let c = 0; c < n; c++) acc[c] += sd[i + c] * k;
  };
  const samp = (x, y, w) => {
    const fx = clamp(x - 0.5, clip.x0, clip.x1 - 1), fy = clamp(y - 0.5, clip.y0, clip.y1 - 1), x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, clip.x1 - 1), y1 = Math.min(y0 + 1, clip.y1 - 1), ax = fx - x0, ay = fy - y0;
    tap(x0, y0, (1 - ax) * (1 - ay) * w); tap(x1, y0, ax * (1 - ay) * w); tap(x0, y1, (1 - ax) * ay * w); tap(x1, y1, ax * ay * w);
  };
  // 透明层：附近（拖影够得到的范围）都没像素的格直接跳过（积分图数 alpha>0 的格）
  let sat = null; const cw = RW(clip), ch = RH(clip);
  if (alpha){
    sat = new Int32Array((cw + 1) * (ch + 1));
    for (let y = 0; y < ch; y++){ let row = 0; for (let x = 0; x < cw; x++){ row += sd[((clip.y0 + y - sy0) * sw + (clip.x0 + x - sx0)) * n + n - 1] > 0 ? 1 : 0; sat[(y + 1) * (cw + 1) + x + 1] = sat[y * (cw + 1) + x + 1] + row; } }
  }
  const empty = (x, y, r) => {
    const a0 = clamp(x - r - clip.x0, 0, cw), a1 = clamp(x + r + 1 - clip.x0, 0, cw), b0 = clamp(y - r - clip.y0, 0, ch), b1 = clamp(y + r + 1 - clip.y0, 0, ch);
    return sat[b1 * (cw + 1) + a1] - sat[b0 * (cw + 1) + a1] - sat[b1 * (cw + 1) + a0] + sat[b0 * (cw + 1) + a0] === 0;
  };
  const centered = fp.centered !== false, dirs = centered ? [1, -1] : [-1], w = RW(out), N = RW(out) * RH(out);
  for (let i = 0; i < N; i++){
    const x = out.x0 + i % w, y = out.y0 + Math.floor(i / w), fx = x + 0.5, fy = y + 0.5;
    fieldAt(fx, fy);
    const len = FA[2], tp = FA[3], sx = FA[0], sy = FA[1];
    if (len < 0.5 || (sx === 0 && sy === 0)) continue;
    const half = centered ? len / 2 : len;
    if (sat && empty(x, y, Math.ceil(half) + 2)) continue;
    const ns = clamp(Math.ceil(half / 1.5), 1, centered ? 32 : 64), h = half / ns;     // 约 1.5px 一个样本
    acc.fill(0); let wsum = 1; samp(fx, fy, 1);
    for (const d of dirs){
      let px = fx, py = fy, vx = sx * d, vy = sy * d;
      for (let j = 1; j <= ns; j++){
        fieldAt(px, py); let ux = FA[0], uy = FA[1];
        const m = Math.hypot(ux, uy); if (m < 1e-9){ ux = vx; uy = vy; } else { ux /= m; uy /= m; if (ux * vx + uy * vy < 0){ ux = -ux; uy = -uy; } }
        px += ux * h; py += uy * h; vx = ux; vy = uy;
        const wt = Math.max(0, 1 - tp * j / ns);
        samp(px, py, wt); wsum += wt;
      }
    }
    if (fp.flash){ samp(fx, fy, wsum * 0.5); wsum *= 1.5; }                         // 后帘同步闪光：原位清楚的一份
    const j0 = i * n;
    if (alpha){ const a = acc[n - 1]; for (let c = 0; c < n - 1; c++) res[j0 + c] = a > 1e-7 ? acc[c] / a : 0; res[j0 + n - 1] = a / wsum; }
    else for (let c = 0; c < n; c++) res[j0 + c] = acc[c] / wsum;
  }
  return res;
};

/* ──────────────── 段：15-gallery.js ──────────────── */
/* ═══════════ 滤镜库（滤镜 ▸ 滤镜库…）：algo/src/artistic.rs（全档）、artistic_fx.rs（全档）、engine/src/gallery_cmds.rs（全档）、ui-egui/src/gallery_ui.rs（对话框） ═══════════
   登记：galleryParamsFor（gallery_cmds.rs:80 params_for）、ag_validate（gallery_cmds.rs:102 run_gallery 的检查）、ag_usesColours（gallery_cmds.rs:89）、
         AG_CATALOGUE（gallery_cmds.rs:94 catalogue）、KERNELS.filterGallery（artistic_fx.rs:459 run）、REACH.artistic（artistic_fx.rs:454 reach）、
         CUSTOM_DIALOGS['filter.filterGallery']（gallery_ui.rs）。
   我们只有 RGB＋alpha：fxutil rgba／set_rgba 就是原样读写前三个通道，算法不改。
   效能：工作窗用一条 Float32Array（每格 3 个 f32，对应原码 Vec<[f32;3]>），逐格回圈里不配置新阵列。 */

/* ────────────────── artistic.rs：目录 ────────────────── */
/* artistic.rs:38 gallery!{…}：[key, 名字, 分类, 参数记法] */
const AG_LIST = [
  // ---- Artistic ----
  ['coloredPencil', 'Colored Pencil', 'Artistic', '{"pencilWidth":1..24=4,"strokePressure":0..15=8,"paperBrightness":0..50=25}'],
  ['cutout', 'Cutout', 'Artistic', '{"numberOfLevels":2..8=4,"edgeSimplicity":0..10=4,"edgeFidelity":1..3=2}'],
  ['dryBrush', 'Dry Brush', 'Artistic', '{"brushSize":0..10=2,"brushDetail":0..10=8,"texture":1..3=1}'],
  ['filmGrain', 'Film Grain', 'Artistic', '{"grain":0..20=4,"highlightArea":0..20=0,"intensity":0..10=10}'],
  ['fresco', 'Fresco', 'Artistic', '{"brushSize":0..10=2,"brushDetail":0..10=8,"texture":1..3=1}'],
  ['neonGlow', 'Neon Glow', 'Artistic', '{"glowSize":-24..24=5,"glowBrightness":0..50=15,"glowColor":json}'],
  ['paintDaubs', 'Paint Daubs', 'Artistic', '{"brushSize":1..50=8,"sharpness":0..40=7,"brushType":"simple|lightRough|darkRough|wideSharp|wideBlurry|sparkle"}'],
  ['paletteKnife', 'Palette Knife', 'Artistic', '{"strokeSize":1..50=25,"strokeDetail":1..3=3,"softness":0..10=0}'],
  ['plasticWrap', 'Plastic Wrap', 'Artistic', '{"highlightStrength":0..20=15,"detail":1..15=9,"smoothness":1..15=7}'],
  ['posterEdges', 'Poster Edges', 'Artistic', '{"edgeThickness":0..10=2,"edgeIntensity":0..10=1,"posterization":0..6=2}'],
  ['roughPastels', 'Rough Pastels', 'Artistic', '{"strokeLength":0..40=6,"strokeDetail":1..20=4,"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=20,"light":"bottom|bottomLeft|left|topLeft|top|topRight|right|bottomRight","invert":bool,"textureKey":json}'],
  ['smudgeStick', 'Smudge Stick', 'Artistic', '{"strokeLength":0..10=2,"highlightArea":0..20=0,"intensity":0..10=10}'],
  ['sponge', 'Sponge', 'Artistic', '{"brushSize":0..10=2,"definition":0..25=12,"smoothness":1..15=5}'],
  ['underpainting', 'Underpainting', 'Artistic', '{"brushSize":0..40=6,"textureCoverage":0..40=16,"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=4,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","invert":bool,"textureKey":json}'],
  ['watercolor', 'Watercolor', 'Artistic', '{"brushDetail":1..14=9,"shadowIntensity":0..10=1,"texture":1..3=1}'],
  // ---- Brush Strokes ----
  ['accentedEdges', 'Accented Edges', 'Brush Strokes', '{"edgeWidth":1..14=2,"edgeBrightness":0..50=38,"smoothness":1..15=5}'],
  ['angledStrokes', 'Angled Strokes', 'Brush Strokes', '{"directionBalance":0..100=50,"strokeLength":3..50=15,"sharpness":0..10=3}'],
  ['crosshatch', 'Crosshatch', 'Brush Strokes', '{"strokeLength":3..50=9,"sharpness":0..20=6,"strength":1..3=1}'],
  ['darkStrokes', 'Dark Strokes', 'Brush Strokes', '{"balance":0..10=5,"blackIntensity":0..10=6,"whiteIntensity":0..10=2}'],
  ['inkOutlines', 'Ink Outlines', 'Brush Strokes', '{"strokeLength":1..50=4,"darkIntensity":0..50=20,"lightIntensity":0..50=10}'],
  ['spatter', 'Spatter', 'Brush Strokes', '{"sprayRadius":0..25=10,"smoothness":1..15=5}'],
  ['sprayedStrokes', 'Sprayed Strokes', 'Brush Strokes', '{"strokeLength":0..20=12,"sprayRadius":0..25=7,"strokeDirection":"rightDiagonal|horizontal|leftDiagonal|vertical"}'],
  ['sumiE', 'Sumi-e', 'Brush Strokes', '{"strokeWidth":3..15=10,"strokePressure":0..15=2,"contrast":0..40=16}'],
  // ---- Distort ----
  ['diffuseGlow', 'Diffuse Glow', 'Distort', '{"graininess":0..10=6,"glowAmount":0..20=10,"clearAmount":0..20=15,"background":json}'],
  ['glass', 'Glass', 'Distort', '{"distortion":0..20=5,"smoothness":1..15=3,"texture":"frosted|blocks|canvas|tinyLens","scaling":50..200=100,"invert":bool,"textureKey":json}'],
  ['oceanRipple', 'Ocean Ripple', 'Distort', '{"rippleSize":1..15=9,"rippleMagnitude":0..20=9}'],
  // ---- Sketch（前景色＝墨、背景色＝纸） ----
  ['basRelief', 'Bas Relief', 'Sketch', '{"detail":1..15=13,"smoothness":1..15=3,"light":"bottom|bottomLeft|left|topLeft|top|topRight|right|bottomRight","foreground":json,"background":json}'],
  ['chalkCharcoal', 'Chalk & Charcoal', 'Sketch', '{"charcoalArea":0..20=6,"chalkArea":0..20=6,"strokePressure":0..5=1,"foreground":json,"background":json}'],
  ['charcoal', 'Charcoal', 'Sketch', '{"charcoalThickness":1..7=1,"detail":0..5=5,"lightDarkBalance":0..100=50,"foreground":json,"background":json}'],
  ['chrome', 'Chrome', 'Sketch', '{"detail":0..10=4,"smoothness":0..10=7}'],
  ['conteCrayon', 'Conté Crayon', 'Sketch', '{"foregroundLevel":1..15=11,"backgroundLevel":1..15=7,"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=4,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","invert":bool,"textureKey":json,"foreground":json,"background":json}'],
  ['graphicPen', 'Graphic Pen', 'Sketch', '{"strokeLength":1..15=15,"lightDarkBalance":0..100=50,"strokeDirection":"rightDiagonal|horizontal|leftDiagonal|vertical","foreground":json,"background":json}'],
  ['halftonePattern', 'Halftone Pattern', 'Sketch', '{"size":1..12=1,"contrast":0..50=5,"patternType":"dot|circle|line","foreground":json,"background":json}'],
  ['notePaper', 'Note Paper', 'Sketch', '{"imageBalance":0..50=25,"graininess":0..20=10,"relief":0..25=11,"foreground":json,"background":json}'],
  ['photocopy', 'Photocopy', 'Sketch', '{"detail":1..24=7,"darkness":1..50=8,"foreground":json,"background":json}'],
  ['plaster', 'Plaster', 'Sketch', '{"imageBalance":0..50=20,"smoothness":1..15=2,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","foreground":json,"background":json}'],
  ['reticulation', 'Reticulation', 'Sketch', '{"density":0..50=12,"foregroundLevel":0..50=40,"backgroundLevel":0..50=5,"foreground":json,"background":json}'],
  ['stamp', 'Stamp', 'Sketch', '{"lightDarkBalance":0..50=25,"smoothness":1..50=5,"foreground":json,"background":json}'],
  ['tornEdges', 'Torn Edges', 'Sketch', '{"imageBalance":0..50=25,"smoothness":1..15=11,"contrast":1..25=17,"foreground":json,"background":json}'],
  ['waterPaper', 'Water Paper', 'Sketch', '{"fiberLength":3..50=15,"brightness":0..100=60,"contrast":0..100=80}'],
  // ---- Stylize ----
  ['glowingEdges', 'Glowing Edges', 'Stylize', '{"edgeWidth":1..14=2,"edgeBrightness":0..20=6,"smoothness":1..15=5}'],
  // ---- Texture ----
  ['craquelure', 'Craquelure', 'Texture', '{"crackSpacing":2..100=15,"crackDepth":0..10=6,"crackBrightness":0..10=9}'],
  ['grain', 'Grain', 'Texture', '{"intensity":0..100=40,"contrast":0..100=50,"grainType":"regular|soft|sprinkles|clumped|contrasty|enlarged|stippled|horizontal|vertical|speckle","foreground":json,"background":json}'],
  ['mosaicTiles', 'Mosaic Tiles', 'Texture', '{"tileSize":2..100=12,"groutWidth":1..15=3,"lightenGrout":0..10=9}'],
  ['patchwork', 'Patchwork', 'Texture', '{"squareSize":0..10=4,"relief":0..25=8}'],
  ['stainedGlass', 'Stained Glass', 'Texture', '{"cellSize":2..50=10,"borderThickness":1..20=4,"lightIntensity":0..10=3,"foreground":json}'],
  ['texturizer', 'Texturizer', 'Texture', '{"texture":"canvas|brick|burlap|sandstone","scaling":50..200=100,"relief":0..50=4,"light":"top|topRight|right|bottomRight|bottom|bottomLeft|left|topLeft","invert":bool,"textureKey":json}']
];
/* artistic.rs:95 GALLERY_CATEGORIES */
const AG_CATEGORIES = ['Artistic', 'Brush Strokes', 'Distort', 'Sketch', 'Stylize', 'Texture'];
/* artistic.rs:157 NEON_DEFAULT */
const AG_NEON = [0.0, 0.62, 1.0, 1.0];

/* artistic.rs:126 params：数值／选项／布林参数（颜色 json 不列） */
function ag_parseParams(doc){
  const inner = doc.trim().replace(/^\{+/, '').replace(/\}+$/, '');
  const num = s => { s = s.trim(); const v = s === '' ? NaN : Number(s); return isFinite(v) ? v : 0; };   // parse::<f32>().unwrap_or(0.0)
  const out = [];
  for (const part of inner.split(',')){
    const i = part.indexOf(':'); if (i < 0) continue;
    const key = part.slice(0, i).trim().replace(/^"+|"+$/g, ''), v = part.slice(i + 1).trim();
    let p;
    if (v.startsWith('"')) p = {key, t:'choice', options:v.slice(1).replace(/"+$/, '').split('|')};
    else if (v === 'bool') p = {key, t:'bool', d:false};
    else if (v.indexOf('=') >= 0){
      const eq = v.indexOf('='), range = v.slice(0, eq), def = v.slice(eq + 1), dd = range.indexOf('..');
      const lo = dd >= 0 ? range.slice(0, dd) : '0', hi = dd >= 0 ? range.slice(dd + 2) : '1';
      p = {key, t:'range', min:num(lo), max:num(hi), d:num(def)};
    } else continue;                                                // json（颜色）
    out.push(p);
  }
  return out;
}
/* 每个效果一笔资料：key、name、category、command、doc、params、uses（artistic.rs:151 uses_colours） */
const AG_BY_KEY = {};
for (const [key, name, category, doc] of AG_LIST)
  AG_BY_KEY[key] = {key, name, category, command:'filter.gallery.' + key, doc, params:ag_parseParams(doc), uses:doc.includes('"foreground"') || doc.includes('"background"')};
const ag_asciiLower = s => String(s).replace(/[A-Z]/g, ch => ch.toLowerCase());       // eq_ignore_ascii_case
/* artistic.rs:119 from_key：key、命令 id 或显示名（ASCII 不分大小写） */
function ag_fromKey(k){
  k = String(k); if (k.startsWith('filter.gallery.')) k = k.slice(15);
  const lk = ag_asciiLower(k);
  for (const [key, name] of AG_LIST) if (key === k || ag_asciiLower(name) === lk) return key;
  return null;
}
const ag_param = (key, k) => { const inf = AG_BY_KEY[key]; if (!inf) return null; for (const p of inf.params) if (p.key === k) return p; return null; };

/* artistic.rs:187 GalleryEffect::new：预设值、黑墨白纸、霓虹预设色 */
function ag_newEffect(key){
  const values = {};
  for (const p of AG_BY_KEY[key].params) values[p.key] = p.t === 'range' ? p.d : p.t === 'choice' ? 0 : (p.d ? 1 : 0);
  return {filter:key, values, foreground:[0, 0, 0, 1], background:[1, 1, 1, 1], color:AG_NEON.slice()};
}
/* artistic.rs:201 set：数值夹到范围、选项取整夹进索引、布林 0/1 */
function ag_set(e, k, v){
  const p = ag_param(e.filter, k); if (!p) return;
  if (p.t === 'range') v = clamp(v, p.min, p.max);
  else if (p.t === 'choice') v = clamp(rround(v), 0, p.options.length - 1);
  else v = v !== 0 ? 1 : 0;
  e.values[k] = v;
}
/* artistic.rs:213 set_choice：用名字设选项（不分大小写）；不在清单＝false */
function ag_setChoice(e, k, name){
  const p = ag_param(e.filter, k); if (!p || p.t !== 'choice') return false;
  const ln = ag_asciiLower(name), i = p.options.findIndex(n => ag_asciiLower(n) === ln);
  if (i < 0) return false;
  e.values[k] = i; return true;
}
/* artistic.rs:225 get：没设＝预设 */
function ag_get(e, k){
  const v = e.values ? e.values[k] : undefined;
  if (typeof v === 'number') return v;
  const p = ag_param(e.filter, k);
  if (p && p.t === 'range') return p.d;
  if (p && p.t === 'bool') return p.d ? 1 : 0;
  return 0;
}
const ag_flag = (e, k) => ag_get(e, k) !== 0;                      // artistic.rs:237 flag
/* artistic.rs:242 choice：选项名字（索引 max(0) 截断；超出＝第一个） */
function ag_choice(e, k){
  const p = ag_param(e.filter, k); if (!p || p.t !== 'choice') return '';
  const v = ag_get(e, k), i = v > 0 ? Math.floor(v) : 0;
  return i < p.options.length ? p.options[i] : p.options[0];
}

/* ────────────────── gallery_cmds.rs ────────────────── */
const ag_isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/* gallery_cmds.rs:17 colour：[r,g,b(,a)]（0..1）或 #rrggbb */
function ag_colour(v){
  if (Array.isArray(v) && v.length >= 3){ const c = (j, d) => typeof v[j] === 'number' ? v[j] : d; return [c(0, 0), c(1, 0), c(2, 0), c(3, 1)]; }
  if (typeof v === 'string' && v.length === 7 && v[0] === '#'){
    const ch = j => { const s = v.slice(j, j + 2); return /^\+?[0-9a-fA-F]+$/.test(s) ? parseInt(s, 16) / 255 : 0; };   // u8::from_str_radix，坏的＝0
    return [ch(1), ch(3), ch(5), 1];
  }
  return null;
}
/* gallery_cmds.rs:32 effect_from_json：一个效果（fallback 补没给的颜色） */
function ag_effectFromJson(key, p, fallback){
  const e = ag_newEffect(key);
  if (ag_isObj(p)) for (const prm of AG_BY_KEY[key].params){
    const v = p[prm.key]; if (v === undefined) continue;
    if (prm.t === 'choice' && typeof v === 'string') ag_setChoice(e, prm.key, v);
    else if (typeof v === 'boolean') ag_set(e, prm.key, v ? 1 : 0);
    else if (typeof v === 'number' && isFinite(v)) ag_set(e, prm.key, v);
  }
  if (ag_isObj(p) && typeof p.textureKey === 'string' && p.textureKey && ag_param(key, 'texture')) e.tex = p.textureKey;   // 载入的纹理（AG_TEX）
  const pick = k => (ag_isObj(p) ? ag_colour(p[k]) : null) || (ag_isObj(fallback) ? ag_colour(fallback[k]) : null);
  let c;
  if ((c = pick('foreground'))) e.foreground = c;
  if ((c = pick('background'))) e.background = c;
  if ((c = pick('glowColor'))) e.color = c;
  return e;
}
/* gallery_cmds.rs:64 effects_from_json：效果层叠（隐藏的跳过）→ {ok:[…]} 或 {err:'…'} */
function ag_effectsFromJson(p){
  const list = ag_isObj(p) && Array.isArray(p.effects) ? p.effects : null;
  if (!list) return {ok:[]};
  const out = [];
  for (let k = 0; k < list.length; k++){
    const item = list[k];
    if (ag_isObj(item) && item.visible === false) continue;
    const key = ag_isObj(item) && typeof item.filter === 'string' ? item.filter : null;
    if (key === null) return {err:'effect ' + k + ': missing `filter`'};
    const f = ag_fromKey(key);
    if (!f) return {err:'effect ' + k + ': unknown gallery filter `' + key + '`'};
    const params = ag_isObj(item.params) ? item.params : item;
    if (typeof params.textureKey === 'string' && params.textureKey && typeof AG_TEX !== 'undefined' && !AG_TEX.has(params.textureKey))
      return {err:'effect ' + k + ': the texture `' + (params.textureFile || params.textureKey) + '` is no longer loaded: load it again (ps.filterGallery.loadTexture)'};
    out.push(ag_effectFromJson(f, params, p));
  }
  return {ok:out};
}
/* gallery_cmds.rs:80 params_for：filter.filterGallery（坏的 effects＝空）或 filter.gallery.<key>（单一效果，颜色只看自己的参数） */
function galleryParamsFor(id, p){
  if (id === 'filter.filterGallery'){ const r = ag_effectsFromJson(p); return {filter:'filterGallery', effects:r.err ? [] : r.ok}; }
  if (typeof id !== 'string' || !id.startsWith('filter.gallery.')) return null;
  const f = ag_fromKey(id.slice(15)); if (!f) return null;
  return {filter:'filterGallery', effects:[ag_effectFromJson(f, p, null)]};
}
/* gallery_cmds.rs:89 uses_colours */
function ag_usesColours(id){
  if (id === 'filter.filterGallery') return true;
  if (typeof id !== 'string' || !id.startsWith('filter.gallery.')) return false;
  const f = ag_fromKey(id.slice(15)); return !!f && AG_BY_KEY[f].uses;
}
/* gallery_cmds.rs:94 catalogue */
const AG_CATALOGUE = () => ({categories:AG_CATEGORIES.slice(), filters:AG_LIST.map(([key, name, category, doc]) => ({key, name, category, command:'filter.gallery.' + key, params:doc}))});
/* 上一次跑过的滤镜库层叠（gallery_ui.rs:178 从 journal 找最后一笔 filter.filterGallery；我们在通过检查时记下） */
let ag_lastStack = null;
/* gallery_cmds.rs:102 run_gallery 的检查：list＝回目录（总档先处理）；effects 坏或空＝报错 */
function ag_validate(p){
  if (ag_isObj(p) && p.list === true) return;
  const r = ag_effectsFromJson(p);
  if (r.err) throw new FltBad(r.err);
  if (!r.ok.length) throw new FltBad('filter.filterGallery needs `effects`: [{"filter": "<key>", "params": {...}}] (pass {"list": true} for the catalogue)');
  try { ag_lastStack = JSON.parse(JSON.stringify(p.effects)); } catch (_){}
}

/* ────────────────── artistic_fx.rs：小工具 ────────────────── */
const AG_FMAX = 3.4028234663852886e38;                               // f32::MAX
const ag_clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;                   // artistic_fx.rs:93
const ag_us = v => v > 0 ? Math.floor(v) : 0;                        // Rust `as usize`（截断、负数与 NaN＝0）
const ag_remf = (x, m) => { const r = x % m; return r < 0 ? r + Math.abs(m) : r; };   // f32::rem_euclid
const ag_fract = v => v - Math.trunc(v);                             // f32::fract（负数为负）
/* artistic_fx.rs:64 smoothstep：e0 > e1＝下降的阶梯（跟核心 smoothstep 不同，另写一份） */
function ag_ss(e0, e1, x){
  if (Math.abs(e1 - e0) < 1e-9) return x >= e1 ? 1 : 0;
  let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
/* artistic_fx.rs:97 posterize */
function ag_poster(v, levels){ const l = Math.max(levels - 1, 1); return rround(ag_clamp01(v) * l) / l; }
/* artistic_fx.rs:39 Win::lum／73 lum */
function ag_lum(win){
  const c = win.c, N = win.w * win.h, l = new Float32Array(N);
  for (let i = 0, o = 0; i < N; i++, o += 3) l[i] = 0.299 * c[o] + 0.587 * c[o + 1] + 0.114 * c[o + 2];
  return l;
}
const ag_lumAt = (c, o) => 0.299 * c[o] + 0.587 * c[o + 1] + 0.114 * c[o + 2];
/* artistic_fx.rs:43 Win::sample：文件坐标双线性（中心在 .5），夹进工作窗；写进 dst[o..o+3] */
function ag_sampleInto(sc, win, x, y, dst, o){
  const w = win.w, h = win.h;
  const fx = clamp(x - 0.5 - win.r.x0, 0, w - 1), fy = clamp(y - 0.5 - win.r.y0, 0, h - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), ax = fx - x0, ay = fy - y0;
  const a = (y0 * w + x0) * 3, b = (y0 * w + x1) * 3, c = (y1 * w + x0) * 3, d = (y1 * w + x1) * 3;
  for (let k = 0; k < 3; k++){
    const top = sc[a + k] + (sc[b + k] - sc[a + k]) * ax, bot = sc[c + k] + (sc[d + k] - sc[c + k]) * ax;
    dst[o + k] = top + (bot - top) * ay;
  }
}
/* artistic_fx.rs:55 Win::at：最近格（夹进工作窗）→ 在 c 里的位移 */
function ag_atIdx(win, x, y){
  const xx = clamp(x - win.r.x0, 0, win.w - 1), yy = clamp(y - win.r.y0, 0, win.h - 1);
  return (yy * win.w + xx) * 3;
}
/* artistic_fx.rs:108 gs：sigma 的高斯模糊读多远 */
function ag_gs(sigma){ if (sigma < 0.3) return 0; const r = gaussBoxRadii(sigma); return r[0] + r[1] + r[2] + 1; }
const ag_blur1 = (p, w, h, sigma) => gaussBlurN(p, w, h, 1, sigma);   // artistic_fx.rs:112
const ag_blur3 = (c, w, h, sigma) => gaussBlurN(c, w, h, 3, sigma);   // artistic_fx.rs:115
/* artistic_fx.rs:120 sobel（边缘夹住）→ [gx, gy] */
function ag_sobel(p, w, h){
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++){
    const ym = (y - 1 < 0 ? 0 : y - 1) * w, y0 = y * w, yp = (y + 1 > h - 1 ? h - 1 : y + 1) * w;
    for (let x = 0; x < w; x++){
      const xm = x - 1 < 0 ? 0 : x - 1, xp = x + 1 > w - 1 ? w - 1 : x + 1;
      gx[y0 + x] = ((p[ym + xp] + 2 * p[y0 + xp] + p[yp + xp]) - (p[ym + xm] + 2 * p[y0 + xm] + p[yp + xm])) / 8;
      gy[y0 + x] = ((p[yp + xm] + 2 * p[yp + x] + p[yp + xp]) - (p[ym + xm] + 2 * p[ym + x] + p[ym + xp])) / 8;
    }
  }
  return [gx, gy];
}
/* artistic_fx.rs:135 grad_mag */
function ag_gradMag(p, w, h){
  const [gx, gy] = ag_sobel(p, w, h);
  for (let i = 0; i < gx.length; i++) gx[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
  return gx;
}
/* artistic_fx.rs:142 line_blur：沿方向 (dx,dy) 半径 r 的滑动平均（交错 n 通道，线两端夹住，f64 累加） */
function ag_lineBlur(buf, n, w, h, dx, dy, r){
  if (r === 0 || w === 0 || h === 0) return;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const norm = 1 / (2 * r + 1), L = Math.max(w, h) + 1;
  const idx = new Int32Array(L), vals = new Float64Array(L);
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++){
    if (inside(sx - dx, sy - dy)) continue;                        // 不是一条线的起点
    let m = 0, x = sx, y = sy;
    while (inside(x, y)){ idx[m++] = (y * w + x) * n; x += dx; y += dy; }
    for (let c = 0; c < n; c++){
      for (let k = 0; k < m; k++) vals[k] = buf[idx[k] + c];
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += vals[k < 0 ? 0 : k >= m ? m - 1 : k];
      for (let k = 0; k < m; k++){
        buf[idx[k] + c] = acc * norm;
        const a = k + r + 1, b = k - r;
        acc += vals[a >= m ? m - 1 : a] - vals[b < 0 ? 0 : b];
      }
    }
  }
}
/* artistic_fx.rs:182 direction */
function ag_direction(name){
  switch (name){ case 'horizontal': return [1, 0]; case 'vertical': return [0, 1]; case 'leftDiagonal': return [1, 1]; default: return [1, -1]; }   // rightDiagonal：左下到右上
}
/* artistic_fx.rs:193 kuwahara：四个象限平均里最平的那个（盒子平均，代价跟 r 无关） */
function ag_kuwahara(win, r){
  const h2 = Math.max(Math.ceil(r / 2), 1), w = win.w, h = win.h, N = w * h, c = win.c;
  const m = new Float32Array(N * 5);
  for (let i = 0, o = 0, q = 0; i < N; i++, o += 3, q += 5){
    const l = 0.299 * c[o] + 0.587 * c[o + 1] + 0.114 * c[o + 2];
    m[q] = c[o]; m[q + 1] = c[o + 1]; m[q + 2] = c[o + 2]; m[q + 3] = l; m[q + 4] = l * l;
  }
  boxBlurN(m, w, h, 5, h2);
  const o4 = h2;
  for (let y = 0, i = 0; y < h; y++){
    const ya = (y - o4 < 0 ? 0 : y - o4 > h - 1 ? h - 1 : y - o4) * w, yb = (y + o4 < 0 ? 0 : y + o4 > h - 1 ? h - 1 : y + o4) * w;
    for (let x = 0; x < w; x++, i++){
      const xa = x - o4 < 0 ? 0 : x - o4 > w - 1 ? w - 1 : x - o4, xb = x + o4 < 0 ? 0 : x + o4 > w - 1 ? w - 1 : x + o4;
      let best = AG_FMAX, q = 0;
      // 顺序：(-o,-o)、(o,-o)、(-o,o)、(o,o)
      for (let s = 0; s < 4; s++){
        const qq = ((s < 2 ? ya : yb) + ((s & 1) ? xb : xa)) * 5;
        const v = Math.fround(m[qq + 4] - Math.fround(m[qq + 3] * m[qq + 3]));   // 原码 f32 运算（平坦区四个象限打平时谁先赢要一样）
        if (v < best){ best = v; q = qq; }
      }
      const o = i * 3;
      if (best < AG_FMAX){ c[o] = m[q]; c[o + 1] = m[q + 1]; c[o + 2] = m[q + 2]; }
      else { c[o] = 0; c[o + 1] = 0; c[o + 2] = 0; }                 // 原码 col 初值 [0;3]（方差全 NaN 才会走到）
    }
  }
}
const ag_kuwaharaReach = r => 2 * Math.max(Math.ceil(r / 2), 1) + 1; // artistic_fx.rs:225
/* artistic_fx.rs:229 unsharp */
function ag_unsharp(win, sigma, amount){
  if (amount <= 0) return;
  const c = win.c, b = c.slice();
  ag_blur3(b, win.w, win.h, sigma);
  for (let i = 0; i < c.length; i++) c[i] = c[i] + (c[i] - b[i]) * amount;
}
/* artistic_fx.rs:241 vnoise：单位格上的平滑值杂讯 0..1 */
function ag_vnoise(x, y, seed){
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h00 = hash01(ix, iy, 0, seed), h10 = hash01(ix + 1, iy, 0, seed), h01 = hash01(ix, iy + 1, 0, seed), h11 = hash01(ix + 1, iy + 1, 0, seed);
  const top = h00 + (h10 - h00) * sx, bot = h01 + (h11 - h01) * sx;
  return top + (bot - top) * sy;
}
/* artistic_fx.rs:252 fbm：三阶值杂讯 */
function ag_fbm(x, y, seed){
  return (ag_vnoise(x, y, seed) * 0.57 + ag_vnoise(x * 2.03, y * 2.03, (seed ^ 0x51) >>> 0) * 0.29 + ag_vnoise(x * 4.1, y * 4.1, (seed ^ 0xa3) >>> 0) * 0.14) / 1.0;
}
/* artistic_fx.rs:257 strokes：沿 (dx,dy) 拉长 len、横向 wid 的笔触杂讯 */
function ag_strokes(x, y, dx, dy, len, wid, seed){
  const l = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-6), ux = dx / l, uy = dy / l;
  const u = x * ux + y * uy, v = -x * uy + y * ux;
  return ag_vnoise(u / Math.max(len, 0.5), v / Math.max(wid, 0.3), seed);
}
/* artistic_fx.rs:268 light_dir（y 向下） */
const AG_S2 = Math.SQRT1_2;
const AG_LIGHT = {bottom:[0, 1], bottomLeft:[-AG_S2, AG_S2], left:[-1, 0], topLeft:[-AG_S2, -AG_S2], topRight:[AG_S2, -AG_S2], right:[1, 0], bottomRight:[AG_S2, AG_S2]};
const ag_lightDir = name => AG_LIGHT[name] || [0, -1];
/* artistic_fx.rs:284 shade：Lambert（1＝平） */
function ag_shade(gx, gy, lx, ly, k){
  const nx = -k * gx, ny = -k * gy, nz = 1, nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const lz = 1, ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const d = (nx * lx + ny * ly + nz * lz) / (nl * ll);
  return d / (lz / ll);
}
/* artistic_fx.rs:324 weave：p px 宽的编织纹，noise 不规则度 */
function ag_weave(x, y, p, noise){
  const cx = Math.floor(x / p), cy = Math.floor(y / p);
  const overH = remE(cx + cy, 2) === 0;
  const u = ag_remf(x, p) / p, v = ag_remf(y, p) / p;
  const ridge = overH ? Math.sin(v * Math.PI) : Math.sin(u * Math.PI);   // 一条线＝格子里一道圆脊
  const n = ag_vnoise(x / (p * 0.7), y / (p * 2.0), 97);
  return ridge * (1 - noise) + n * noise;
}
/* artistic_fx.rs:294 texture：程序纹理（0..1 高度），s＝缩放（1＝100%） */
function ag_texture(kind, x, y, s){
  if (kind && typeof kind === 'object') return ag_texAt(kind, kind.g, x + 0.5, y + 0.5, s);   // 载入的纹理（AG_TEX）
  x = x / s; y = y / s;
  switch (kind){
    case 'brick': {
      const bw = 24, bh = 12, row = Math.floor(y / bh);
      const xo = x + (Math.trunc(row) % 2 === 0 ? 0 : bw / 2);
      const u = ag_remf(xo, bw), v = ag_remf(y, bh);
      const d = Math.min(Math.min(u, bw - u), Math.min(v, bh - v));
      return ag_ss(0.6, 2.2, d) * (0.85 + 0.15 * ag_vnoise(x / 3, y / 3, 91));
    }
    case 'burlap': return ag_weave(x, y, 7.0, 0.35);
    case 'canvas': return ag_weave(x, y, 3.5, 0.18);
    case 'sandstone': return ag_fbm(x / 7, y / 7, 93) * 0.7 + hash01(Math.trunc(x), Math.trunc(y), 0, 94) * 0.3;
    case 'blocks': {
      const b = 18, u = ag_remf(x, b) / b, v = ag_remf(y, b) / b;
      return Math.min(Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) * 4, 1);
    }
    case 'frosted': return ag_fbm(x / 2.5, y / 2.5, 95);
    case 'tinyLens': {
      const p = 12, u = (ag_remf(x, p) / p - 0.5) * 2, v = (ag_remf(y, p) / p - 0.5) * 2;
      return Math.sqrt(Math.max(1 - (u * u + v * v), 0));
    }
  }
  return 0.5;
}
/* ── 载入纹理（PS 滤镜库：玻璃／纹理化／粗糙蜡笔／底纹效果／炭精笔「纹理」下拉旁的选单 ▸ 载入纹理…）──
   读 .psd（取合成图）或一般图片当灰阶高度图（明度 0..1；透明处垫白＝PS 存 PSD 合成图时透明处的颜色）；
   从文件左上角 (0,0) 起平铺，「缩放」100％＝纹理一格对文件一格。图放 AG_TEX，参数只记 textureKey／textureFile（同置换图：参数是 JSON、要当快取键） */
const AG_TEX = new Map(); let ag_texSeq = 0;
const AG_GLASS_K = 45;                                               // 玻璃：坡度 1/45（0→1 跨 45 格）× 扭曲度 10 ≈ 偏 10 格
function ag_texPut(key, name, c){
  const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4){ const a = d[p + 3] / 255; g[i] = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255 * a + (1 - a); }
  const t = {key, name, w, h, g, canvas:c, blur:new Map()}; AG_TEX.set(key, t); return t;
}
/* 文件坐标 (x,y)（连续，格中心在 .5）在纹理上平铺双线性取样 */
function ag_texAt(t, g, x, y, s){
  const u = ag_remf(x / s - 0.5, t.w), v = ag_remf(y / s - 0.5, t.h);
  const x0 = Math.min(Math.floor(u), t.w - 1), y0 = Math.min(Math.floor(v), t.h - 1), ax = u - x0, ay = v - y0;
  const x1 = x0 + 1 >= t.w ? 0 : x0 + 1, y1 = y0 + 1 >= t.h ? 0 : y0 + 1, r0 = y0 * t.w, r1 = y1 * t.w;
  const top = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * ax, bot = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * ax;
  return top + (bot - top) * ay;
}
/* 玻璃的「平滑度」：高度图先高斯模糊（sigma＝平滑度×0.5 纹理格；按 sigma 快取） */
function ag_texBlur(t, sigma){
  const k = Math.round(sigma * 100); let b = t.blur.get(k);
  if (!b){ b = t.g.slice(); if (sigma >= 0.3) ag_blur1(b, t.w, t.h, sigma); t.blur.set(k, b); }
  return b;
}
/* 效果用哪个纹理：载入的（还在）＝那张，否则＝下拉选的程序纹理名字 */
const ag_texKind = e => (e.tex && AG_TEX.get(e.tex)) || ag_choice(e, 'texture');
/* 读档：.psd 取合成图，其余当图片 → {textureKey, textureFile, width, height} */
async function ag_loadTexture(p){
  p = p || {};
  const f = p.file || (p.files && p.files[0]) || p.url, name0 = String(p.name || (f && f.name) || (typeof f === 'string' && !/^data:/i.test(f) ? f.split(/[?#]/)[0].split(/[\\/]/).pop() : '') || 'texture');
  if (!f) throw new FltBad('loadTexture: need file or url');
  let c;
  if (/\.psd$/i.test(name0) || (f instanceof Blob && /photoshop|psd/i.test(f.type || '')) || (typeof f === 'string' && /^data:image\/(vnd\.adobe\.photoshop|x-photoshop|psd)/i.test(f))) c = await PsFile.psd.canvas(f);
  else {
    const url = f instanceof Blob ? URL.createObjectURL(f) : f, img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new FltBad('cannot open texture `' + name0 + '`')); img.src = url; });
    c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    if (f instanceof Blob) URL.revokeObjectURL(url);
  }
  if (!c || !c.width || !c.height) throw new FltBad('texture `' + name0 + '` is empty');
  const key = 'gtex' + (++ag_texSeq) + '-' + Date.now().toString(36), name = name0.replace(/\.[a-z0-9]+$/i, '');
  ag_texPut(key, name, c);
  return {textureKey:key, textureFile:name, width:c.width, height:c.height};
}
/* 智能滤镜用到的载入纹理跟工程档一起存（galleryTextures），开档先解回来（同置换图） */
function ag_texKeysUsed(){
  const keys = new Set();
  const scanFx = list => (list || []).forEach(e => { const q = e && (ag_isObj(e.params) ? e.params : e); if (q && typeof q.textureKey === 'string') keys.add(q.textureKey); });
  const scan = list => (list || []).forEach(L => { if (L && L.kind === 'smart' && L.data) (L.data.filters || []).forEach(f => {
    if (!f || !f.params) return;
    if (f.command === 'filter.filterGallery') scanFx(f.params.effects); else if (String(f.command).startsWith('filter.gallery.')) scanFx([f.params]);
  }); });
  scan(Doc.layers);
  try { if (window.Smart && window.SmartStore) Smart.collect(Doc.layers).forEach(id => { const e = SmartStore.get(id); if (e && e.type === 'layers') scan(e.layers); }); } catch (_){}
  return keys;
}
if (window.Project && !Project.__galTex){
  Project.__galTex = true;
  const ser0 = Project.serialize;
  Project.serialize = function(){
    const j = ser0.apply(this, arguments);
    try {
      const keys = ag_texKeysUsed();
      if (j && keys.size){ const m = j.galleryTextures = Object.assign({}, j.galleryTextures || {});
        keys.forEach(k => { const t = AG_TEX.get(k); if (t && !m[k]) m[k] = {name:t.name, image:Project.encodeExtra(t.canvas, 'gtex:' + k)}; }); }
    } catch (e){ console.warn('[载入纹理] 存档', e); }
    return j;
  };
  const load0 = Project.load;
  Project.load = async function(json){
    if (json && json.galleryTextures && typeof json.galleryTextures === 'object'){
      for (const [k, m] of Object.entries(json.galleryTextures)){
        if (AG_TEX.has(k) || !m || !m.image) continue;
        try { const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = m.image; });
          const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); ag_texPut(k, m.name || 'texture', c); }
        catch (e){ console.warn('[载入纹理] 读不回来：', k, e); }
      }
    }
    return load0.apply(this, arguments);
  };
  if (Array.isArray(Project.asyncCanvases)) Project.asyncCanvases.push(() => [...ag_texKeysUsed()].map(k => AG_TEX.get(k)).filter(Boolean).map(t => t.canvas));
}
/* artistic_fx.rs:335 texturize：程序纹理的浮雕光影 */
function ag_texturize(win, kind, scaling, relief, light, invert){
  if (relief <= 0) return;
  const s = clamp(scaling / 100, 0.5, 2), [lx, ly] = ag_lightDir(light), k = relief / 50 * 3, sign = invert ? -1 : 1;
  const c = win.c, w = win.w, h = win.h, x0 = win.r.x0, y0 = win.r.y0;
  for (let y = y0, o = 0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++, o += 3){
    const gx = (ag_texture(kind, x + 1, y, s) - ag_texture(kind, x - 1, y, s)) * 0.5 * sign;
    const gy = (ag_texture(kind, x, y + 1, s) - ag_texture(kind, x, y - 1, s)) * 0.5 * sign;
    const f = clamp(ag_shade(gx, gy, lx, ly, k), 0, 2);
    c[o] *= f; c[o + 1] *= f; c[o + 2] *= f;
  }
}
/* artistic_fx.rs:354 voronoi：最近与次近的抖动格点（= 核心 cellPoint、origin (0,0)；为免逐格配置阵列，结果放在下面几个变数） */
let ag_vd1 = 0, ag_vd2 = 0, ag_vpx = 0, ag_vpy = 0;
function ag_voronoi(x, y, cell, seed){
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let d1 = AG_FMAX, d2 = AG_FMAX, px = x, py = y;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++){
    const gx = cx + i, gy = cy + j;
    const qx = (gx + 0.1 + 0.8 * hash01(gx, gy, 11, seed)) * cell, qy = (gy + 0.1 + 0.8 * hash01(gx, gy, 12, seed)) * cell;
    const d = Math.sqrt((qx - x) * (qx - x) + (qy - y) * (qy - y));
    if (d < d1){ d2 = d1; d1 = d; px = qx; py = qy; } else if (d < d2) d2 = d;
  }
  ag_vd1 = d1; ag_vd2 = d2; ag_vpx = px; ag_vpy = py;
}
/* artistic_fx.rs:374 highlights：亮部提亮（就地改 c[o..o+3]） */
function ag_highlights(c, o, l, area, intensity){
  if (area <= 0) return;
  const m = ag_ss(1 - area / 20 * 0.75, 1.02, l) * (1 - intensity / 10 * 0.6);
  for (let k = 0; k < 3; k++) c[o + k] = c[o + k] + (1 - c[o + k]) * m;
}

/* artistic_fx.rs:429-451 */
const ag_cutoutSigma = e => 0.5 + ag_get(e, 'edgeSimplicity') * (1.1 - 0.3 * ag_get(e, 'edgeFidelity'));
function ag_daubsRadius(e){ const ty = ag_choice(e, 'brushType'), wide = ty === 'wideSharp' || ty === 'wideBlurry'; return ag_us(Math.max(ag_get(e, 'brushSize') / 2 * (wide ? 1.5 : 1), 1)); }
const ag_plasticSigma = e => 0.5 + ag_get(e, 'smoothness') * 0.5 + (15 - ag_get(e, 'detail')) * 0.2;
const ag_watercolorRadius = e => 1 + ag_us((15 - ag_get(e, 'brushDetail')) / 2.5);
const ag_basreliefSigma = e => 0.3 + ag_get(e, 'smoothness') * 0.5 + (15 - ag_get(e, 'detail')) * 0.12;
const ag_patchSize = e => 3 + ag_get(e, 'squareSize') * 1.5;
const ag_glassCell = e => ag_get(e, 'cellSize') * 1.6 + 1;

/* artistic_fx.rs:383 effect_reach：一个效果在输出格周围要读几格 */
function ag_effectReach(e){
  const g = k => ag_get(e, k), T = Math.trunc;
  switch (e.filter){
    case 'coloredPencil': return 2;
    case 'cutout': return ag_gs(ag_cutoutSigma(e));
    case 'dryBrush': case 'fresco': return ag_kuwaharaReach(1 + ag_us(g('brushSize'))) + ag_gs(1.0) + 2;
    case 'filmGrain': case 'diffuseGlow': case 'chalkCharcoal': case 'reticulation': case 'grain': case 'mosaicTiles': case 'texturizer': return 0;
    case 'roughPastels': return T(g('strokeLength') / 2) + 2;
    case 'neonGlow': return ag_gs(Math.abs(g('glowSize')) * 0.6 + 0.5);
    case 'paintDaubs': return ag_kuwaharaReach(ag_daubsRadius(e)) + ag_gs(1.5) + 1;
    case 'paletteKnife': return ag_kuwaharaReach(ag_us(Math.max(g('strokeSize') / 3, 1))) + ag_gs(g('softness') * 0.5);
    case 'plasticWrap': return ag_gs(ag_plasticSigma(e)) + 2;
    case 'posterEdges': return ag_gs(0.6 + g('edgeThickness') * 0.6) + 2;
    case 'smudgeStick': return T(g('strokeLength') * 1.5) + 2;
    case 'sponge': return ag_kuwaharaReach(1 + ag_us(g('brushSize')));
    case 'underpainting': return ag_gs(0.5 + g('brushSize') * 0.4);
    case 'watercolor': return ag_kuwaharaReach(ag_watercolorRadius(e)) + 2;
    case 'accentedEdges': return ag_gs(0.4 + g('smoothness') * 0.3) + ag_gs(g('edgeWidth') * 0.5) + 2;
    case 'angledStrokes': return T(g('strokeLength') / 3) + ag_gs(1.0) + 2;
    case 'crosshatch': return T(g('strokeLength') / 3) + ag_gs(1.0) + 2;
    case 'darkStrokes': return 9;
    case 'inkOutlines': return T(g('strokeLength') / 2) + 3;
    case 'spatter': return Math.ceil(g('sprayRadius')) + 2;
    case 'sprayedStrokes': return Math.ceil(g('sprayRadius')) + T(g('strokeLength') / 2) + 3;
    case 'sumiE': return ag_gs(g('strokeWidth') * 0.2) + T(g('strokeWidth') / 2) + 2;
    case 'glass': return Math.ceil(g('distortion') * 2) + 2;
    case 'oceanRipple': return Math.ceil(g('rippleMagnitude') * 0.9) + 2;
    case 'basRelief': return ag_gs(ag_basreliefSigma(e)) + 2;
    case 'charcoal': return ag_gs(1.0) + 2;
    case 'chrome': return ag_gs(1.0 + g('smoothness') * 0.4) + 2;
    case 'conteCrayon': return 0;
    case 'graphicPen': return T(g('strokeLength') / 2) + 2;
    case 'halftonePattern': return ag_gs(0.5 + g('size') * 0.3);
    case 'notePaper': return ag_gs(1.0) + ag_gs(1.2) + 2;
    case 'photocopy': return ag_gs(1.0 + g('detail') * 0.5);
    case 'plaster': return ag_gs(0.5 + g('smoothness') * 0.8) + ag_gs(1.5) + 2;
    case 'stamp': return ag_gs(0.3 + g('smoothness') * 0.3);
    case 'tornEdges': return ag_gs(1.0);
    case 'waterPaper': return 2 * T(g('fiberLength') / 6) + 2;
    case 'glowingEdges': return ag_gs(0.3 + g('smoothness') * 0.25) + ag_gs(g('edgeWidth') * 0.4) + 2;
    case 'craquelure': return 0;
    case 'patchwork': return Math.ceil(ag_patchSize(e)) + 2;
    case 'stainedGlass': return Math.ceil(ag_glassCell(e) * 2.5) + 2;
  }
  return 0;
}
/* artistic_fx.rs:454 reach：一叠效果的总读取范围 */
REACH.artistic = effects => (effects || []).reduce((s, e) => s + ag_effectReach(e), 0);

/* artistic_fx.rs:459 run：工作窗＝整个 src（out 外扩 reach），逐层套效果，最后取 out 那块、留原 alpha */
function ag_run(effects, src, out, ctx){
  const n = src.ch, r = src.rect, w = RW(r), h = RH(r);
  if (!effects.length || !w || !h) return src.crop(out);
  const N = w * h, c = new Float32Array(N * 3), d = src.data;
  for (let i = 0, p = 0, o = 0; i < N; i++, p += n, o += 3){ c[o] = d[p]; c[o + 1] = d[p + 1]; c[o + 2] = d[p + 2]; }   // rgb(rgba(ctx, px))
  const win = {r, w, h, c};
  for (const e of effects) ag_apply(e, win, ctx);
  const res = src.crop(out), ow = RW(out), wc = win.c;
  for (let i = 0, p = 0; p < res.length; i++, p += n){
    const x = out.x0 + i % ow, y = out.y0 + Math.floor(i / ow);
    const a = ctx.alpha ? res[p + n - 1] : 1, q = ag_atIdx(win, x, y);
    res[p] = ag_clamp01(wc[q]); res[p + 1] = ag_clamp01(wc[q + 1]); res[p + 2] = ag_clamp01(wc[q + 2]);
    if (ctx.alpha) res[p + n - 1] = a;
  }
  return res;
}
KERNELS.filterGallery = (src, out, ctx, fp) => ag_run(fp.effects || [], src, out, ctx);

/* artistic_fx.rs:484 apply：一层效果 */
function ag_apply(e, win, ctx){
  const g = k => ag_get(e, k);
  const w = win.w, h = win.h, N = w * h, X0 = win.r.x0, Y0 = win.r.y0, X1 = X0 + w, Y1 = Y0 + h;
  const fg = [e.foreground[0], e.foreground[1], e.foreground[2]], bg = [e.background[0], e.background[1], e.background[2]];
  let c = win.c;
  switch (e.filter){
    /* ──────────────── Artistic ──────────────── */
    case 'coloredPencil': {
      const pw = g('pencilWidth'), pressure = g('strokePressure') / 15, pk = 0.7 + 0.3 * g('paperBrightness') / 50;
      const p0 = bg[0] * pk, p1 = bg[1] * pk, p2 = bg[2] * pk;
      const l = ag_lum(win), e2 = ag_gradMag(l, w, h), len = 5 + pw * 3, wid = 0.5 + pw * 0.45;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, d = 1 - l[i];
        const h1 = ag_strokes(x, y, 1, 1, len, wid, 11), h2 = ag_strokes(x, y, 1, -1, len, wid, 12);
        const hatch = Math.max(h1, h2 * ag_ss(0.3, 0.8, d));
        const cov = ag_clamp01(d * (0.55 + pressure) + e2[i] * 3 - (1 - hatch) * 0.8 + 0.25);
        c[o] = p0 + (c[o] * 0.88 - p0) * cov; c[o + 1] = p1 + (c[o + 1] * 0.88 - p1) * cov; c[o + 2] = p2 + (c[o + 2] * 0.88 - p2) * cov;
      }
      break;
    }
    case 'cutout': {
      ag_blur3(c, w, h, ag_cutoutSigma(e));
      const levels = rround(g('numberOfLevels'));
      for (let o = 0; o < c.length; o += 3){
        // 每个明度阶一个平色，保留区域色相
        const l = Math.max(ag_lumAt(c, o), 1e-4), k = ag_poster(l, levels) / l;
        for (let q = 0; q < 3; q++) c[o + q] = ag_poster(ag_clamp01(c[o + q] * k), levels * 2);
      }
      break;
    }
    case 'dryBrush': case 'fresco': {
      const fresco = e.filter === 'fresco';
      ag_kuwahara(win, 1 + ag_us(g('brushSize')));
      ag_unsharp(win, 1.0, fresco ? 0.9 : 0.5);
      const levels = 3 + g('brushDetail'), amp = 0.02 + (g('texture') - 1) * 0.05;
      const l = fresco ? ag_gradMag(ag_lum(win), w, h) : null;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, n = (hash01(x, y, 0, 21) - 0.5) * amp, fk = fresco ? 1 - ag_clamp01(l[i] * 2.5) * 0.6 : 0;
        for (let q = 0; q < 3; q++){
          const v = c[o + q]; let p = ag_poster(v, levels) * 0.6 + v * 0.4 + n;
          if (fresco) p = Math.pow(ag_clamp01((p - 0.5) * 1.3 + 0.45), 1.15) * fk;
          c[o + q] = p;
        }
      }
      break;
    }
    case 'filmGrain': {
      const grain = g('grain') / 20, area = g('highlightArea'), inten = g('intensity');
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, l = ag_lumAt(c, o);
        const n = (hash01(x, y, 0, 31) - 0.5) * grain * 0.5 * (0.3 + 2.8 * l * (1 - l));
        c[o] += n; c[o + 1] += n; c[o + 2] += n;
        ag_highlights(c, o, l, area, inten);
      }
      break;
    }
    case 'neonGlow': {
      const size = g('glowSize'), br = g('glowBrightness') / 50, glow = e.color;
      const l = ag_lum(win), m = new Float32Array(N);
      for (let i = 0; i < N; i++) m[i] = size >= 0 ? l[i] : 1 - l[i];
      ag_blur1(m, w, h, Math.abs(size) * 0.6 + 0.5);
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const k = ag_clamp01(m[i] * 1.2) * br * 2;
        for (let q = 0; q < 3; q++){ const base = fg[q] + (bg[q] - fg[q]) * l[i]; c[o + q] = 1 - (1 - base) * (1 - ag_clamp01(glow[q] * k)); }
      }
      break;
    }
    case 'paintDaubs': {
      const ty = ag_choice(e, 'brushType');
      ag_kuwahara(win, ag_daubsRadius(e));
      const sharp = g('sharpness') / 40;
      if (ty === 'wideBlurry') ag_blur3(c, w, h, 1.5);
      else if (ty === 'wideSharp') ag_unsharp(win, 1.5, sharp * 4);
      else ag_unsharp(win, 1.2, sharp * 2.5);
      if (ty === 'lightRough' || ty === 'darkRough' || ty === 'sparkle'){
        const edges = ty === 'sparkle' ? ag_gradMag(ag_lum(win), w, h) : null;
        for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
          const o = i * 3;
          if (ty === 'sparkle'){
            const a = ag_clamp01(edges[i] * 4) * ag_ss(0.75, 0.95, hash01(x, y, 0, 42)) * 0.8;
            c[o] += a; c[o + 1] += a; c[o + 2] += a;
          } else {
            const n = ag_fbm(x / 2, y / 2, 41) - 0.5, np = Math.max(n, 0);
            if (ty === 'lightRough'){ const a = np * 0.35; c[o] += a; c[o + 1] += a; c[o + 2] += a; }
            else { const f = 1 - np * 0.7; c[o] *= f; c[o + 1] *= f; c[o + 2] *= f; }
          }
        }
      }
      break;
    }
    case 'paletteKnife': {
      ag_kuwahara(win, ag_us(Math.max(g('strokeSize') / 3, 1)));
      const levels = 2 + g('strokeDetail') * 3;
      for (let o = 0; o < c.length; o++) c[o] = ag_poster(c[o], levels) * 0.5 + c[o] * 0.5;
      ag_blur3(c, w, h, g('softness') * 0.5);
      break;
    }
    case 'plasticWrap': {
      const hs = g('highlightStrength') / 20, l = ag_lum(win);
      ag_blur1(l, w, h, ag_plasticSigma(e));
      const [gx, gy] = ag_sobel(l, w, h);
      // lv＝normalize3([-0.45,-0.65,1])，hv＝normalize3([lv0,lv1,lv2+1])
      const ln = Math.max(Math.sqrt(0.45 * 0.45 + 0.65 * 0.65 + 1), 1e-9), lv0 = -0.45 / ln, lv1 = -0.65 / ln, lv2 = 1 / ln;
      const hn = Math.max(Math.sqrt(lv0 * lv0 + lv1 * lv1 + (lv2 + 1) * (lv2 + 1)), 1e-9), hv0 = lv0 / hn, hv1 = lv1 / hn, hv2 = (lv2 + 1) / hn;
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const k = 14, ax = -k * gx[i], ay = -k * gy[i], nn = Math.max(Math.sqrt(ax * ax + ay * ay + 1), 1e-9);
        const n0 = ax / nn, n1 = ay / nn, n2 = 1 / nn;
        const ndh = Math.max(n0 * hv0 + n1 * hv1 + n2 * hv2, 0), tilt = 1 - n2;
        const spec = Math.pow(ndh, 30) * ag_ss(0.01, 0.12, tilt) + ag_ss(0.25, 0.6, tilt) * 0.25, add = spec * hs * 1.3;
        c[o] = c[o] * 0.88 + add; c[o + 1] = c[o + 1] * 0.88 + add; c[o + 2] = c[o + 2] * 0.88 + add;
      }
      break;
    }
    case 'posterEdges': {
      const l = ag_lum(win);
      ag_blur1(l, w, h, 0.6 + g('edgeThickness') * 0.6);
      const edge = ag_gradMag(l, w, h), inten = g('edgeIntensity') / 10, levels = g('posterization') + 2;
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const ink = ag_ss(0.015, 0.06, edge[i] * (1 + inten * 3)) * (0.55 + inten * 0.45);
        for (let q = 0; q < 3; q++) c[o + q] = ag_poster(c[o + q], levels) * (1 - ink);
      }
      break;
    }
    case 'roughPastels': {
      const len = g('strokeLength'), det = g('strokeDetail') / 20, orig = c.slice();
      ag_lineBlur(c, 3, w, h, 1, -1, ag_us(len / 2));
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, n = ag_strokes(x, y, 1, -1, 3 + len * 0.8, 1.1, 51) - 0.5, t = det * 0.5;
        for (let q = 0; q < 3; q++) c[o + q] = c[o + q] + (orig[o + q] - c[o + q]) * t + n * 0.3;
      }
      ag_texturize(win, ag_texKind(e), g('scaling'), g('relief'), ag_choice(e, 'light'), ag_flag(e, 'invert'));
      break;
    }
    case 'smudgeStick': {
      ag_lineBlur(c, 3, w, h, 1, 1, ag_us(g('strokeLength') * 1.5));
      const area = g('highlightArea'), inten = g('intensity');
      for (let o = 0; o < c.length; o += 3){
        const l = ag_lumAt(c, o), f = 0.7 + 0.3 * l;
        c[o] *= f; c[o + 1] *= f; c[o + 2] *= f;
        ag_highlights(c, o, l, area, inten);
      }
      break;
    }
    case 'sponge': {
      ag_kuwahara(win, 1 + ag_us(g('brushSize')));
      const def = g('definition') / 25, sc = 1.5 + g('smoothness') * 0.5;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, s = ag_fbm(x / sc, y / sc, 61), hole = ag_ss(0.58, 0.75, s);
        for (let q = 0; q < 3; q++) c[o + q] = ag_clamp01((c[o + q] - 0.5) * (1 + def * 0.6) + 0.5) * (1 - hole * def * 0.4);
      }
      break;
    }
    case 'underpainting': {
      const orig = c.slice();
      ag_blur3(c, w, h, 0.5 + g('brushSize') * 0.4);
      for (let o = 0; o < c.length; o += 3){
        const m0 = orig[o] + (c[o] - orig[o]) * 0.8, m1 = orig[o + 1] + (c[o + 1] - orig[o + 1]) * 0.8, m2 = orig[o + 2] + (c[o + 2] - orig[o + 2]) * 0.8;
        const l = 0.299 * m0 + 0.587 * m1 + 0.114 * m2;           // saturate(…, 1.15)
        c[o] = l + (m0 - l) * 1.15; c[o + 1] = l + (m1 - l) * 1.15; c[o + 2] = l + (m2 - l) * 1.15;
      }
      const cov = g('textureCoverage') / 40;
      ag_texturize(win, ag_texKind(e), g('scaling'), g('relief') * (0.5 + cov * 1.5), ag_choice(e, 'light'), ag_flag(e, 'invert'));
      break;
    }
    case 'watercolor': {
      ag_kuwahara(win, ag_watercolorRadius(e));
      const sh = g('shadowIntensity') / 10, edge = ag_gradMag(ag_lum(win), w, h), amp = (g('texture') - 1) * 0.04, ex = 1.1 + sh * 0.6;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, n = (ag_fbm(x / 3, y / 3, 71) - 0.5) * amp, k = 1 - ag_clamp01(edge[i] * (3 + sh * 8)) * 0.6;
        const l = ag_lumAt(c, o);
        for (let q = 0; q < 3; q++){ const v = l + (c[o + q] - l) * 1.2; c[o + q] = Math.pow(ag_clamp01(v * k + n), ex); }
      }
      break;
    }
    /* ──────────────── Brush Strokes ──────────────── */
    case 'accentedEdges': {
      const l = ag_lum(win);
      ag_blur1(l, w, h, 0.4 + g('smoothness') * 0.3);
      const edge = ag_gradMag(l, w, h);
      ag_blur1(edge, w, h, g('edgeWidth') * 0.5);
      const eb = g('edgeBrightness') / 50;
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const k = ag_clamp01(edge[i] * 6);
        if (eb >= 0.5){ const t = k * (eb - 0.5) * 2; for (let q = 0; q < 3; q++) c[o + q] = c[o + q] + (1 - c[o + q]) * t; }
        else { const f = 1 - k * (0.5 - eb) * 2; for (let q = 0; q < 3; q++) c[o + q] = c[o + q] * f; }
      }
      break;
    }
    case 'angledStrokes': case 'crosshatch': {
      const len = g('strokeLength'), r = ag_us(len / 3);
      if (e.filter === 'crosshatch'){
        const st = g('strength');
        for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
          const o = i * 3, n = (hash01(x, y, 0, 81) - 0.5) * 0.12 * st;
          c[o] += n; c[o + 1] += n; c[o + 2] += n;
        }
      }
      const l = ag_lum(win), a = c.slice();
      ag_lineBlur(a, 3, w, h, 1, 1, r);
      ag_lineBlur(c, 3, w, h, 1, -1, r);
      if (e.filter === 'angledStrokes'){
        const bal = g('directionBalance') / 100;
        for (let i = 0, o = 0; i < N; i++, o += 3){
          const t = ag_ss(1 - bal - 0.15, 1 - bal + 0.15, l[i]);
          for (let q = 0; q < 3; q++) c[o + q] = a[o + q] + (c[o + q] - a[o + q]) * t;
        }
        ag_unsharp(win, 1.0, g('sharpness') / 10 * 1.5);
      } else {
        for (let o = 0; o < c.length; o++) c[o] = a[o] + (c[o] - a[o]) * 0.5;
        ag_unsharp(win, 1.0, g('sharpness') / 20 * 3);
      }
      break;
    }
    case 'darkStrokes': {
      const bal = g('balance') / 10, bi = g('blackIntensity') / 10, wi = g('whiteIntensity') / 10;
      const l = ag_lum(win), a = c.slice();
      ag_lineBlur(a, 3, w, h, 1, 1, 3);
      ag_lineBlur(c, 3, w, h, 1, -1, 8);
      const t = 0.25 + bal * 0.5;
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const s = ag_ss(t - 0.1, t + 0.1, l[i]);
        for (let q = 0; q < 3; q++){ const d = a[o + q] * (1 - bi * 0.85), li = c[o + q] + (1 - c[o + q]) * wi * 0.5; c[o + q] = d + (li - d) * s; }
      }
      break;
    }
    case 'inkOutlines': {
      const di = g('darkIntensity') / 50, li = g('lightIntensity') / 50;
      const l = ag_lum(win), edge = ag_gradMag(l, w, h);
      ag_lineBlur(c, 3, w, h, 1, 1, ag_us(g('strokeLength') / 2));
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const ink = ag_clamp01(edge[i] * 5) * di * 1.5;
        const lt = ag_ss(0.5, 1.0, l[i]) * li, dk = ag_ss(0.5, 0.0, l[i]) * di * 0.8;
        for (let q = 0; q < 3; q++){ const v = c[o + q]; c[o + q] = (v + (1 - v) * lt) * (1 - dk) * (1 - ag_clamp01(ink)); }
      }
      break;
    }
    case 'spatter': case 'sprayedStrokes': {
      const rad = g('sprayRadius'), sc = e.filter === 'spatter' ? 0.6 + g('smoothness') * 0.25 : 1.2;
      const src = c.slice();
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const fx = x / sc, fy = y / sc;
        const dx = (ag_vnoise(fx, fy, 91) - 0.5) * 2 * rad, dy = (ag_vnoise(fx, fy, 92) - 0.5) * 2 * rad;
        ag_sampleInto(src, win, x + 0.5 + dx, y + 0.5 + dy, c, i * 3);
      }
      if (e.filter === 'sprayedStrokes'){ const [ddx, ddy] = ag_direction(ag_choice(e, 'strokeDirection')); ag_lineBlur(c, 3, w, h, ddx, ddy, ag_us(g('strokeLength') / 2)); }
      break;
    }
    case 'sumiE': {
      const sw = g('strokeWidth'), pr = g('strokePressure') / 15, con = g('contrast') / 40;
      ag_blur3(c, w, h, sw * 0.2);
      ag_lineBlur(c, 3, w, h, 1, 1, ag_us(sw / 2));
      for (let o = 0; o < c.length; o += 3){
        const l = ag_lumAt(c, o), ink = Math.pow(ag_ss(0.65, 0.15, l), 1 - pr * 0.5), f = 1 - ink * 0.9 * (0.5 + con);
        for (let q = 0; q < 3; q++) c[o + q] = ag_clamp01((c[o + q] - 0.5) * (1 + con) + 0.5) * f;
      }
      break;
    }
    /* ──────────────── Distort ──────────────── */
    case 'diffuseGlow': {
      const gr = g('graininess') / 10, ga = g('glowAmount') / 20, ca = g('clearAmount') / 20, thr = 0.2 + ca * 0.7;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, l = ag_lumAt(c, o);
        let m = ag_ss(thr - 0.3, thr + 0.1, l) * ga * 1.4;
        if (hash01(x, y, 0, 101) < gr * 0.3 * (m + 0.15)) m += 0.5;
        const t = ag_clamp01(m);
        for (let q = 0; q < 3; q++) c[o + q] = c[o + q] + (bg[q] - c[o + q]) * t;
      }
      break;
    }
    case 'glass': {
      const dist = g('distortion'), step = 0.5 + g('smoothness') * 0.5, kind = ag_texKind(e);
      const s = clamp(g('scaling') / 100, 0.5, 2), sign = ag_flag(e, 'invert') ? -1 : 1, max = dist * 2, src = c.slice();
      if (typeof kind === 'object'){
        /* 载入的纹理＝凹凸高度图：平滑度先模糊高度图，再按坡度（每文件格）折射——平的地方（全白／全黑）不动，坡越陡偏越多（夹在 ±扭曲度×2） */
        const hm = ag_texBlur(kind, g('smoothness') * 0.5), K = AG_GLASS_K * dist * sign * 0.5;
        for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
          const cx = x + 0.5, cy = y + 0.5;
          const gx = ag_texAt(kind, hm, cx + 1, cy, s) - ag_texAt(kind, hm, cx - 1, cy, s), gy = ag_texAt(kind, hm, cx, cy + 1, s) - ag_texAt(kind, hm, cx, cy - 1, s);
          if (gx === 0 && gy === 0) continue;
          ag_sampleInto(src, win, cx + clamp(gx * K, -max, max), cy + clamp(gy * K, -max, max), c, i * 3);
        }
        break;
      }
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const gx = ag_texture(kind, x + step, y, s) - ag_texture(kind, x - step, y, s);
        const gy = ag_texture(kind, x, y + step, s) - ag_texture(kind, x, y - step, s);
        const dx = clamp(gx * sign * dist * 3, -max, max), dy = clamp(gy * sign * dist * 3, -max, max);
        ag_sampleInto(src, win, x + 0.5 + dx, y + 0.5 + dy, c, i * 3);
      }
      break;
    }
    case 'oceanRipple': {
      const s = 2 + g('rippleSize') * 1.2, mag = g('rippleMagnitude') * 0.9, src = c.slice();
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const fx = x / s, fy = y / s;
        const dx = (ag_vnoise(fx, fy, 111) - 0.5) * 2 * mag, dy = (ag_vnoise(fx, fy, 112) - 0.5) * 2 * mag;
        ag_sampleInto(src, win, x + 0.5 + dx, y + 0.5 + dy, c, i * 3);
      }
      break;
    }
    /* ──────────────── Sketch ──────────────── */
    case 'basRelief': {
      const l = ag_lum(win), orig = l.slice();
      ag_blur1(l, w, h, ag_basreliefSigma(e));
      const [gx, gy] = ag_sobel(l, w, h), [lx, ly] = ag_lightDir(ag_choice(e, 'light')), k = 3 + g('detail') * 0.4;
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const t = ag_clamp01(orig[i] * 0.5 + 0.25 + k * -(gx[i] * lx + gy[i] * ly));
        for (let q = 0; q < 3; q++) c[o + q] = fg[q] + (bg[q] - fg[q]) * t;
      }
      break;
    }
    case 'chalkCharcoal': {
      const ca = g('charcoalArea') / 20, ch = g('chalkArea') / 20, pr = g('strokePressure') / 5;
      const mid = [0, 1, 2].map(q => fg[q] + (bg[q] - fg[q]) * 0.5);
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, l = ag_lumAt(c, o);
        const cn = ag_strokes(x, y, 1, 1, 9, 0.9, 121) - 0.5, kn = ag_strokes(x, y, 1, -1, 9, 0.9, 122) - 0.5;
        const cc = ag_ss(0.25, 0.6, (1 - l) * (0.4 + ca * 1.2) + cn * (0.6 + pr * 0.4) - 0.15);
        const kc = ag_ss(0.25, 0.6, l * (0.4 + ch * 1.2) + kn * (0.6 + pr * 0.4) - 0.15), t = kc * (1 - cc);
        for (let q = 0; q < 3; q++){ const a = mid[q] + (fg[q] - mid[q]) * cc; c[o + q] = a + (bg[q] - a) * t; }
      }
      break;
    }
    case 'charcoal': {
      const th = g('charcoalThickness'), det = g('detail') / 5, bal = g('lightDarkBalance') / 100;
      const l = ag_lum(win);
      ag_blur1(l, w, h, 1.0);
      const edge = ag_gradMag(l, w, h);
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, sn = ag_strokes(x, y, 1, 1, 8 + th * 3, 0.6 + th * 0.5, 131) - 0.5;
        const cov = ag_clamp01(ag_ss(1 - bal - 0.2, 1 - bal + 0.2, 1 - l[i] + sn * 0.6) + ag_clamp01(edge[i] * det * 6));
        for (let q = 0; q < 3; q++) c[o + q] = bg[q] + (fg[q] - bg[q]) * cov;
      }
      break;
    }
    case 'chrome': {
      const det = g('detail') / 10, sm = g('smoothness') / 10, l = ag_lum(win);
      ag_blur1(l, w, h, 1.0 + sm * 4);
      const edge = ag_gradMag(l, w, h);
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const v = 0.5 + 0.5 * Math.sin((l[i] * (2.5 + det * 3) + edge[i] * 6) * 2 * Math.PI), s = ag_ss(0.05, 0.95, v);
        c[o] = s; c[o + 1] = s; c[o + 2] = s;
      }
      break;
    }
    case 'conteCrayon': {
      const fl = g('foregroundLevel') / 15, bl = g('backgroundLevel') / 15;
      const mid = [0, 1, 2].map(q => fg[q] + (bg[q] - fg[q]) * 0.5);
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, l = ag_lumAt(c, o), sn = ag_strokes(x, y, 1, -1, 7, 1, 141) - 0.5;
        const cf = ag_clamp01((0.6 - l) * 2 * fl * 1.4 + sn * 0.5), cb = ag_clamp01((l - 0.4) * 2 * bl * 1.4 - sn * 0.5), t = cb * (1 - cf);
        for (let q = 0; q < 3; q++){ const a = mid[q] + (fg[q] - mid[q]) * cf; c[o + q] = a + (bg[q] - a) * t; }
      }
      ag_texturize(win, ag_texKind(e), g('scaling'), g('relief'), ag_choice(e, 'light'), ag_flag(e, 'invert'));
      break;
    }
    case 'graphicPen': {
      const r = ag_us(g('strokeLength') / 2), bal = g('lightDarkBalance') / 100, l = ag_lum(win), n = new Float32Array(N);
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++) n[i] = hash01(x, y, 0, 151);
      const [ddx, ddy] = ag_direction(ag_choice(e, 'strokeDirection'));
      ag_lineBlur(n, 1, w, h, ddx, ddy, r);
      const sd = 0.2887 / Math.sqrt(2 * r + 1);
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const z = (n[i] - 0.5) / sd, t = l[i] + z * 0.16, s = ag_ss(bal + 0.04, bal - 0.04, t);
        for (let q = 0; q < 3; q++) c[o + q] = bg[q] + (fg[q] - bg[q]) * s;
      }
      break;
    }
    case 'halftonePattern': {
      const size = g('size'), con = g('contrast') / 50, cell = 3 + size * 2, l = ag_lum(win);
      ag_blur1(l, w, h, 0.5 + size * 0.3);
      const b = ctx.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ty = ag_choice(e, 'patternType'), aa = 1 / cell;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, fx = x + 0.5, fy = y + 0.5, d = ag_clamp01((1 - l[i] - 0.5) * (1 + con * 3) + 0.5);
        let ink;
        if (ty === 'circle'){ const rr = Math.sqrt((fx - cx) * (fx - cx) + (fy - cy) * (fy - cy)) / cell, q = Math.abs(ag_fract(rr) - 0.5) * 2; ink = ag_ss(d + aa, d - aa, q); }
        else if (ty === 'line'){ const q = Math.abs(ag_fract(fy / cell) - 0.5) * 2; ink = ag_ss(d + aa, d - aa, q); }
        else { const u = ag_fract(fx / cell) - 0.5, v = ag_fract(fy / cell) - 0.5, q = Math.sqrt(u * u + v * v) * 2, rr = Math.sqrt(d) * 1.15; ink = ag_ss(rr + aa, rr - aa, q); }
        for (let q = 0; q < 3; q++) c[o + q] = bg[q] + (fg[q] - bg[q]) * ink;
      }
      break;
    }
    case 'notePaper': {
      const bal = g('imageBalance') / 50, gr = g('graininess') / 20, rel = g('relief') / 25, l = ag_lum(win);
      ag_blur1(l, w, h, 1.0);
      const m = new Float32Array(N);
      for (let i = 0; i < N; i++) m[i] = ag_ss(bal - 0.05, bal + 0.05, l[i]);
      ag_blur1(m, w, h, 1.2);
      const [gx, gy] = ag_sobel(m, w, h), [lx, ly] = ag_lightDir('topLeft');
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, n = (hash01(x, y, 0, 161) - 0.5) * gr * 0.3, f = clamp(ag_shade(gx[i], gy[i], lx, ly, rel * 6), 0, 2);
        for (let q = 0; q < 3; q++) c[o + q] = (fg[q] + (bg[q] - fg[q]) * m[i] + n) * f;
      }
      break;
    }
    case 'photocopy': {
      const det = g('detail'), dk = g('darkness') / 50, l = ag_lum(win), b = l.slice();
      ag_blur1(b, w, h, 1.0 + det * 0.5);
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const hp = l[i] - b[i], ink = ag_clamp01(ag_ss(0.0, 0.06, -hp * (1 + dk * 8)) + ag_ss(0.35, 0.05, l[i]) * dk * 1.5);
        for (let q = 0; q < 3; q++) c[o + q] = bg[q] + (fg[q] - bg[q]) * ink;
      }
      break;
    }
    case 'plaster': {
      const bal = g('imageBalance') / 50, l = ag_lum(win);
      ag_blur1(l, w, h, 0.5 + g('smoothness') * 0.8);
      const m = new Float32Array(N);
      for (let i = 0; i < N; i++) m[i] = ag_ss(bal + 0.1, bal - 0.1, l[i]);
      ag_blur1(m, w, h, 1.5);
      const [gx, gy] = ag_sobel(m, w, h), [lx, ly] = ag_lightDir(ag_choice(e, 'light'));
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const f = clamp(ag_shade(gx[i], gy[i], lx, ly, 6), 0, 2), t = m[i] * 0.6;
        for (let q = 0; q < 3; q++) c[o + q] = (bg[q] + (fg[q] - bg[q]) * t) * f;
      }
      break;
    }
    case 'reticulation': {
      const den = g('density') / 50, fl = g('foregroundLevel') / 50, bl = g('backgroundLevel') / 50;
      const ink = [0, 1, 2].map(q => bg[q] + (fg[q] - bg[q]) * (0.3 + fl * 0.7)), paper = [0, 1, 2].map(q => bg[q] + (fg[q] - bg[q]) * (bl * 0.6));
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, n = 0.5 * hash01(x, y, 0, 171) + 0.5 * ag_vnoise(x / 1.8, y / 1.8, 172);
        const t = (1 - ag_lumAt(c, o)) + (n - 0.5) * (0.4 + den * 1.2), s = ag_ss(0.45, 0.55, t);
        for (let q = 0; q < 3; q++) c[o + q] = paper[q] + (ink[q] - paper[q]) * s;
      }
      break;
    }
    case 'stamp': {
      const bal = g('lightDarkBalance') / 50, l = ag_lum(win);
      ag_blur1(l, w, h, 0.3 + g('smoothness') * 0.3);
      for (let i = 0, o = 0; i < N; i++, o += 3){
        const s = ag_ss(bal + 0.02, bal - 0.02, l[i]);
        for (let q = 0; q < 3; q++) c[o + q] = bg[q] + (fg[q] - bg[q]) * s;
      }
      break;
    }
    case 'tornEdges': {
      const bal = g('imageBalance') / 50, sm = g('smoothness'), con = g('contrast'), l = ag_lum(win);
      ag_blur1(l, w, h, 1.0);
      const rough = (16 - sm) / 15 * 0.35, aa = 0.25 / con;
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, t = l[i] + (ag_fbm(x / 2, y / 2, 181) - 0.5) * rough, s = ag_ss(bal + aa, bal - aa, t);
        for (let q = 0; q < 3; q++) c[o + q] = bg[q] + (fg[q] - bg[q]) * s;
      }
      break;
    }
    case 'waterPaper': {
      const fl = g('fiberLength'), br = g('brightness') / 100, co = g('contrast') / 100, r = ag_us(fl / 6);
      ag_lineBlur(c, 3, w, h, 1, 0, r);
      ag_lineBlur(c, 3, w, h, 0, 1, r);
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, fib = Math.max(ag_strokes(x, y, 1, 0, fl, 1, 191), ag_strokes(x, y, 0, 1, fl, 1, 192));
        for (let q = 0; q < 3; q++) c[o + q] = (c[o + q] * (0.85 + 0.25 * fib) - 0.5) * (co * 1.6 + 0.2) + 0.5 + (br - 0.5) * 0.8;
      }
      break;
    }
    /* ──────────────── Stylize ──────────────── */
    case 'glowingEdges': {
      ag_blur3(c, w, h, 0.3 + g('smoothness') * 0.25);
      const e3 = new Float32Array(N * 3), plane = new Float32Array(N);
      for (let q = 0; q < 3; q++){
        for (let i = 0; i < N; i++) plane[i] = c[i * 3 + q];
        const gm = ag_gradMag(plane, w, h);
        for (let i = 0; i < N; i++) e3[i * 3 + q] = gm[i];
      }
      ag_blur3(e3, w, h, g('edgeWidth') * 0.4);
      const k = 2 + g('edgeBrightness') * 1.2;
      for (let o = 0; o < c.length; o++) c[o] = ag_clamp01(e3[o] * k);
      break;
    }
    /* ──────────────── Texture ──────────────── */
    case 'craquelure': {
      const sp = g('crackSpacing'), dep = g('crackDepth') / 10, bri = g('crackBrightness') / 10;
      const cell = sp * 1.3 + 1, width = 0.8 + dep * 0.8, [lx, ly] = ag_lightDir('topLeft');
      const crack = (x, y) => { ag_voronoi(x, y, cell, 201); return 1 - ag_ss(0, width, ag_vd2 - ag_vd1); };
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, fx = x + 0.5, fy = y + 0.5, c0 = crack(fx, fy);
        const gx = crack(fx + 1, fy) - c0, gy = crack(fx, fy + 1) - c0;
        const f = clamp(ag_shade(-gx, -gy, lx, ly, dep * 2), 0, 2);
        for (let q = 0; q < 3; q++) c[o + q] = c[o + q] * (0.55 + bri * 0.5) * (1 - c0 * dep * 0.6) * f;
      }
      break;
    }
    case 'grain': {
      const it = g('intensity') / 100, co = g('contrast') / 100, ty = ag_choice(e, 'grainType');
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, p0 = c[o], p1 = c[o + 1], p2 = c[o + 2];
        let q0 = p0, q1 = p1, q2 = p2;
        switch (ty){
          case 'soft': q0 = p0 + (hash01(x, y, 0, 211) - 0.5) * it * 0.4; q1 = p1 + (hash01(x, y, 1, 211) - 0.5) * it * 0.4; q2 = p2 + (hash01(x, y, 2, 211) - 0.5) * it * 0.4; break;
          case 'sprinkles': if (hash01(x, y, 3, 211) < it * 0.15){ q0 = bg[0]; q1 = bg[1]; q2 = bg[2]; } break;
          case 'clumped': { const a = (ag_vnoise(x / 2, y / 2, 212) - 0.5) * it * 1.2; q0 = p0 + a; q1 = p1 + a; q2 = p2 + a; break; }
          case 'contrasty': { const a = (hash01(x, y, 4, 211) - 0.5) * it * 0.5, k = 1 + it * 2; q0 = (p0 - 0.5) * k + 0.5 + a; q1 = (p1 - 0.5) * k + 0.5 + a; q2 = (p2 - 0.5) * k + 0.5 + a; break; }
          case 'enlarged': { const fx = x / 3, fy = y / 3; q0 = p0 + (ag_vnoise(fx, fy, 213) - 0.5) * it; q1 = p1 + (ag_vnoise(fx, fy, 214) - 0.5) * it; q2 = p2 + (ag_vnoise(fx, fy, 215) - 0.5) * it; break; }
          case 'stippled': { const st = 0.299 * p0 + 0.587 * p1 + 0.114 * p2 > hash01(x, y, 5, 211) ? bg : fg, t = 0.3 + it * 0.7; q0 = p0 + (st[0] - p0) * t; q1 = p1 + (st[1] - p1) * t; q2 = p2 + (st[2] - p2) * t; break; }
          case 'horizontal': { const a = (ag_vnoise(x / 25, y, 216) - 0.5) * it; q0 = p0 + a; q1 = p1 + a; q2 = p2 + a; break; }
          case 'vertical': { const a = (ag_vnoise(x, y / 25, 217) - 0.5) * it; q0 = p0 + a; q1 = p1 + a; q2 = p2 + a; break; }
          case 'speckle': if (hash01(x, y, 6, 211) < it * 0.1){ q0 = p0 + (fg[0] - p0) * 0.85; q1 = p1 + (fg[1] - p1) * 0.85; q2 = p2 + (fg[2] - p2) * 0.85; } break;
          default: q0 = p0 + (hash01(x, y, 0, 211) - 0.5) * it * 0.8; q1 = p1 + (hash01(x, y, 1, 211) - 0.5) * it * 0.8; q2 = p2 + (hash01(x, y, 2, 211) - 0.5) * it * 0.8;
        }
        const k = 0.5 + co;
        c[o] = (q0 - 0.5) * k + 0.5; c[o + 1] = (q1 - 0.5) * k + 0.5; c[o + 2] = (q2 - 0.5) * k + 0.5;
      }
      break;
    }
    case 'mosaicTiles': {
      const ts = g('tileSize'), gw = g('groutWidth'), lg = g('lightenGrout') / 10;
      const edge = (x, y) => {
        const jx = x + (ag_vnoise(x / ts * 0.7, y / ts * 0.7, 221) - 0.5) * ts * 0.3;
        const jy = y + (ag_vnoise(x / ts * 0.7, y / ts * 0.7, 222) - 0.5) * ts * 0.3;
        const u = ag_remf(jx, ts), v = ag_remf(jy, ts);
        return Math.min(Math.min(u, ts - u), Math.min(v, ts - v));
      };
      const hgt = (xx, yy) => ag_ss(gw * 0.5, gw * 0.5 + 2.5, edge(xx, yy));
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, fx = x + 0.5, fy = y + 0.5, de = edge(fx, fy);
        const grout = ag_ss(gw * 0.5 + 0.7, gw * 0.5 - 0.3, de);
        const s = (hgt(fx - 1, fy - 1) - hgt(fx + 1, fy + 1)) * 0.35;
        const gc = ag_clamp01(ag_lumAt(c, o) * 0.5 + lg * 0.45);
        for (let q = 0; q < 3; q++){ const a = c[o + q] * (1 + s); c[o + q] = a + (gc - a) * grout; }
      }
      break;
    }
    case 'patchwork': {
      const size = ag_patchSize(e), rel = g('relief') / 25, src = c.slice(), sw = {r:win.r, w, h};
      const hv = (x, y) => {
        const bx = Math.floor(x / size), by = Math.floor(y / size), u = ag_remf(x, size), v = ag_remf(y, size);
        const bevel = ag_ss(0, 1.5, Math.min(Math.min(u, size - u), Math.min(v, size - v)));
        return hash01(bx, by, 0, 231) * bevel;
      };
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, fx = x + 0.5, fy = y + 0.5, bx = Math.floor(fx / size), by = Math.floor(fy / size);
        const p = ag_atIdx(sw, Math.trunc((bx + 0.5) * size), Math.trunc((by + 0.5) * size));
        const s = (hv(fx - 1, fy - 1) - hv(fx + 1, fy + 1)) * rel * 1.5;
        c[o] = src[p] * (1 + s); c[o + 1] = src[p + 1] * (1 + s); c[o + 2] = src[p + 2] * (1 + s);
      }
      break;
    }
    case 'stainedGlass': {
      const cell = ag_glassCell(e), bt = g('borderThickness'), li = g('lightIntensity') / 10, b = ctx.bounds;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, half = Math.max(Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2, 1);
      const src = c.slice(), sw = {r:win.r, w, h};
      for (let y = Y0, i = 0; y < Y1; y++) for (let x = X0; x < X1; x++, i++){
        const o = i * 3, fx = x + 0.5, fy = y + 0.5;
        ag_voronoi(fx, fy, cell, 241);
        const border = ag_ss(bt * 0.5 + 0.6, bt * 0.5 - 0.4, (ag_vd2 - ag_vd1) * 0.5);
        const dn = Math.min(Math.sqrt((fx - cx) * (fx - cx) + (fy - cy) * (fy - cy)) / half, 1), f = 1 + li * 0.6 * (1 - dn);
        const p = ag_atIdx(sw, Math.trunc(ag_vpx), Math.trunc(ag_vpy));
        for (let q = 0; q < 3; q++){ const col = src[p + q] * f; c[o + q] = col + (fg[q] - col) * border; }
      }
      break;
    }
    case 'texturizer': ag_texturize(win, ag_texKind(e), g('scaling'), g('relief'), ag_choice(e, 'light'), ag_flag(e, 'invert')); break;
  }
}

/* ────────────────── 对话框（ui-egui/src/gallery_ui.rs） ────────────────── */
/* 分类与效果名：Photoshop 繁中／简中正名（跟 AI 菜单「Photoshop 效果」同一套） */
const AG_CAT_NAMES = {'Artistic':S('藝術風', '艺术效果', 'Artistic'), 'Brush Strokes':S('筆觸', '画笔描边', 'Brush Strokes'), 'Distort':S('扭曲', '扭曲', 'Distort'),
  'Sketch':S('素描', '素描', 'Sketch'), 'Stylize':S('風格化', '风格化', 'Stylize'), 'Texture':S('紋理', '纹理', 'Texture')};
const AG_NAMES = {
  coloredPencil:S('色鉛筆', '彩色铅笔', 'Colored Pencil'), cutout:S('挖剪圖案', '木刻', 'Cutout'), dryBrush:S('乾性筆刷', '干画笔', 'Dry Brush'), filmGrain:S('粒狀影片', '胶片颗粒', 'Film Grain'),
  fresco:S('壁畫', '壁画', 'Fresco'), neonGlow:S('霓虹光', '霓虹灯光', 'Neon Glow'), paintDaubs:S('繪畫塗抹', '绘画涂抹', 'Paint Daubs'), paletteKnife:S('調色刀', '调色刀', 'Palette Knife'),
  plasticWrap:S('塑膠覆膜', '塑料包装', 'Plastic Wrap'), posterEdges:S('海報邊緣', '海报边缘', 'Poster Edges'), roughPastels:S('粗粉彩筆', '粗糙蜡笔', 'Rough Pastels'),
  smudgeStick:S('塗抹沾黏', '涂抹棒', 'Smudge Stick'), sponge:S('海綿', '海绵', 'Sponge'), underpainting:S('底層繪畫', '底纹效果', 'Underpainting'), watercolor:S('水彩', '水彩', 'Watercolor'),
  accentedEdges:S('強調邊緣', '强化的边缘', 'Accented Edges'), angledStrokes:S('角度筆觸', '成角的线条', 'Angled Strokes'), crosshatch:S('交叉影線', '阴影线', 'Crosshatch'),
  darkStrokes:S('深色筆觸', '深色线条', 'Dark Strokes'), inkOutlines:S('墨水輪廓', '油墨概况', 'Ink Outlines'), spatter:S('噴灑', '喷溅', 'Spatter'), sprayedStrokes:S('噴灑筆觸', '喷色描边', 'Sprayed Strokes'),
  sumiE:S('潑墨', '烟灰墨', 'Sumi-e'), diffuseGlow:S('擴散光暈', '扩散亮光', 'Diffuse Glow'), glass:S('玻璃', '玻璃', 'Glass'), oceanRipple:S('海浪效果', '海洋波纹', 'Ocean Ripple'),
  basRelief:S('淺浮雕', '基底凸现', 'Bas Relief'), chalkCharcoal:S('粉筆和炭筆', '粉笔和炭笔', 'Chalk & Charcoal'), charcoal:S('炭筆', '炭笔', 'Charcoal'), chrome:S('鉻黃', '铬黄渐变', 'Chrome'),
  conteCrayon:S('炭精筆', '炭精笔', 'Conté Crayon'), graphicPen:S('繪圖筆', '绘图笔', 'Graphic Pen'), halftonePattern:S('網屏圖樣', '半调图案', 'Halftone Pattern'), notePaper:S('便條紙', '便条纸', 'Note Paper'),
  photocopy:S('影印', '影印', 'Photocopy'), plaster:S('石膏效果', '塑料效果', 'Plaster'), reticulation:S('網狀', '网状', 'Reticulation'), stamp:S('印章', '图章', 'Stamp'), tornEdges:S('撕邊', '撕边', 'Torn Edges'),
  waterPaper:S('浸水效果', '水彩画纸', 'Water Paper'), glowingEdges:S('邊緣光亮化', '照亮边缘', 'Glowing Edges'), craquelure:S('裂縫紋理', '龟裂缝', 'Craquelure'), grain:S('粒狀紋理', '颗粒', 'Grain'),
  mosaicTiles:S('馬賽克拼貼', '马赛克拼贴', 'Mosaic Tiles'), patchwork:S('拼貼', '拼缀图', 'Patchwork'), stainedGlass:S('彩色玻璃', '染色玻璃', 'Stained Glass'), texturizer:S('紋理化', '纹理化', 'Texturizer')
};
/* 参数名（PS 滤镜库繁／简中介面） */
const AG_FIELD = {};
[['pencilWidth', '鉛筆寬度', '铅笔宽度', 'Pencil Width'], ['strokePressure', '筆觸壓力', '描边压力', 'Stroke Pressure'], ['paperBrightness', '紙張亮度', '纸张亮度', 'Paper Brightness'],
 ['numberOfLevels', '色階數', '色阶数', 'Number of Levels'], ['edgeSimplicity', '邊緣簡化度', '边缘简化度', 'Edge Simplicity'], ['edgeFidelity', '邊緣精確度', '边缘逼真度', 'Edge Fidelity'],
 ['brushSize', '筆刷尺寸', '画笔大小', 'Brush Size'], ['brushDetail', '筆刷細節', '画笔细节', 'Brush Detail'], ['texture', '紋理', '纹理', 'Texture'], ['grain', '粒子', '颗粒', 'Grain'],
 ['highlightArea', '亮部區域', '高光区域', 'Highlight Area'], ['intensity', '強度', '强度', 'Intensity'], ['glowSize', '光暈尺寸', '发光大小', 'Glow Size'], ['glowBrightness', '光暈亮度', '发光亮度', 'Glow Brightness'],
 ['glowColor', '光暈顏色', '发光颜色', 'Glow Color'],
 ['sharpness', '銳利度', '锐化程度', 'Sharpness'], ['brushType', '筆刷類型', '画笔类型', 'Brush Type'], ['strokeSize', '筆觸尺寸', '描边大小', 'Stroke Size'], ['strokeDetail', '筆觸細節', '描边细节', 'Stroke Detail'],
 ['softness', '柔和度', '软化度', 'Softness'], ['highlightStrength', '亮部強度', '高光强度', 'Highlight Strength'], ['detail', '細節', '细节', 'Detail'], ['smoothness', '平滑度', '平滑度', 'Smoothness'],
 ['edgeThickness', '邊緣粗細', '边缘厚度', 'Edge Thickness'], ['edgeIntensity', '邊緣強度', '边缘强度', 'Edge Intensity'], ['posterization', '色調分離', '海报化', 'Posterization'],
 ['strokeLength', '筆觸長度', '描边长度', 'Stroke Length'], ['scaling', '縮放', '缩放', 'Scaling'], ['relief', '浮雕', '凸现', 'Relief'], ['light', '光源', '光照', 'Light'], ['invert', '負片效果', '反相', 'Invert'],
 ['definition', '清晰度', '清晰度', 'Definition'], ['textureCoverage', '紋理覆蓋範圍', '纹理覆盖', 'Texture Coverage'], ['shadowIntensity', '陰影強度', '阴影强度', 'Shadow Intensity'],
 ['edgeWidth', '邊緣寬度', '边缘宽度', 'Edge Width'], ['edgeBrightness', '邊緣亮度', '边缘亮度', 'Edge Brightness'], ['directionBalance', '方向平衡', '方向平衡', 'Direction Balance'],
 ['strength', '強度', '强度', 'Strength'], ['balance', '平衡', '平衡', 'Balance'], ['blackIntensity', '黑色強度', '黑色强度', 'Black Intensity'], ['whiteIntensity', '白色強度', '白色强度', 'White Intensity'],
 ['darkIntensity', '暗部強度', '深色强度', 'Dark Intensity'], ['lightIntensity', '亮部強度', '光照强度', 'Light Intensity'], ['sprayRadius', '噴灑強度', '喷色半径', 'Spray Radius'],
 ['strokeDirection', '筆觸方向', '描边方向', 'Stroke Direction'], ['strokeWidth', '筆觸寬度', '描边宽度', 'Stroke Width'], ['contrast', '對比', '对比度', 'Contrast'],
 ['graininess', '粒子', '粒度', 'Graininess'], ['glowAmount', '光暈量', '发光量', 'Glow Amount'], ['clearAmount', '清除量', '清除数量', 'Clear Amount'], ['distortion', '扭曲', '扭曲度', 'Distortion'],
 ['rippleSize', '波紋尺寸', '波纹大小', 'Ripple Size'], ['rippleMagnitude', '波紋強度', '波纹幅度', 'Ripple Magnitude'], ['charcoalArea', '炭筆區域', '炭笔区', 'Charcoal Area'], ['chalkArea', '粉筆區域', '粉笔区', 'Chalk Area'],
 ['charcoalThickness', '炭筆粗細', '炭笔粗细', 'Charcoal Thickness'], ['lightDarkBalance', '明暗平衡', '明/暗平衡', 'Light/Dark Balance'], ['foregroundLevel', '前景色階', '前景色阶', 'Foreground Level'],
 ['backgroundLevel', '背景色階', '背景色阶', 'Background Level'], ['size', '尺寸', '大小', 'Size'], ['patternType', '圖樣類型', '图案类型', 'Pattern Type'], ['imageBalance', '影像平衡', '图像平衡', 'Image Balance'],
 ['darkness', '暗度', '暗度', 'Darkness'], ['density', '密度', '浓度', 'Density'], ['fiberLength', '纖維長度', '纤维长度', 'Fiber Length'], ['brightness', '亮度', '亮度', 'Brightness'],
 ['crackSpacing', '裂縫間距', '裂缝间距', 'Crack Spacing'], ['crackDepth', '裂縫深度', '裂缝深度', 'Crack Depth'], ['crackBrightness', '裂縫亮度', '裂缝亮度', 'Crack Brightness'],
 ['grainType', '粒子類型', '颗粒类型', 'Grain Type'], ['tileSize', '拼貼尺寸', '拼贴大小', 'Tile Size'], ['groutWidth', '間隙寬度', '缝隙宽度', 'Grout Width'], ['lightenGrout', '間隙加亮', '加亮缝隙', 'Lighten Grout'],
 ['squareSize', '方塊尺寸', '平方大小', 'Square Size'], ['cellSize', '儲存格尺寸', '单元格大小', 'Cell Size'], ['borderThickness', '邊框粗細', '边框粗细', 'Border Thickness']
].forEach(([k, a, b, c]) => { AG_FIELD[k] = S(a, b, c); });
const AG_CHOICE = {};
[['canvas', '畫布', '画布', 'Canvas'], ['brick', '磚塊', '砖形', 'Brick'], ['burlap', '粗麻布', '粗麻布', 'Burlap'], ['sandstone', '砂岩', '砂岩', 'Sandstone'],
 ['frosted', '結霜', '磨砂', 'Frosted'], ['blocks', '塊狀', '块状', 'Blocks'], ['tinyLens', '小透鏡', '小镜头', 'Tiny Lens'],
 ['bottom', '下', '下', 'Bottom'], ['bottomLeft', '左下', '左下', 'Bottom Left'], ['left', '左', '左', 'Left'], ['topLeft', '左上', '左上', 'Top Left'], ['top', '上', '上', 'Top'],
 ['topRight', '右上', '右上', 'Top Right'], ['right', '右', '右', 'Right'], ['bottomRight', '右下', '右下', 'Bottom Right'],
 ['simple', '簡單', '简单', 'Simple'], ['lightRough', '淡色粗糙', '未处理光照', 'Light Rough'], ['darkRough', '深色粗糙', '未处理深色', 'Dark Rough'], ['wideSharp', '寬銳利', '宽锐化', 'Wide Sharp'],
 ['wideBlurry', '寬模糊', '宽模糊', 'Wide Blurry'], ['sparkle', '閃爍', '火花', 'Sparkle'],
 ['rightDiagonal', '右斜', '右对角线', 'Right Diagonal'], ['horizontal', '水平', '水平', 'Horizontal'], ['leftDiagonal', '左斜', '左对角线', 'Left Diagonal'], ['vertical', '垂直', '垂直', 'Vertical'],
 ['dot', '點', '网点', 'Dot'], ['circle', '圓形', '圆形', 'Circle'], ['line', '線條', '直线', 'Line'],
 ['regular', '一般', '常规', 'Regular'], ['soft', '柔和', '软化', 'Soft'], ['sprinkles', '灑點', '喷洒', 'Sprinkles'], ['clumped', '結塊', '结块', 'Clumped'], ['contrasty', '高對比', '强反差', 'Contrasty'],
 ['enlarged', '放大', '扩大', 'Enlarged'], ['stippled', '點刻', '点刻', 'Stippled'], ['speckle', '斑點', '斑点', 'Speckle']
].forEach(([k, a, b, c]) => { AG_CHOICE[k] = S(a, b, c); });
const AG_UI = {
  add:S('新增效果圖層', '新建效果图层', 'New effect layer'), del:S('刪除效果圖層', '删除效果图层', 'Delete effect layer'),
  up:S('上移效果圖層', '上移效果图层', 'Move effect layer up'), down:S('下移效果圖層', '下移效果图层', 'Move effect layer down'),
  colours:S('會使用前景色與背景色。', '会使用前景色和背景色。', 'Uses the foreground and background colours.'),
  fit:S('符合畫面', '符合视图大小', 'Fit in View'), show:S('顯示／隱藏', '显示／隐藏', 'Show/Hide'), ms:S('預視 {n} 毫秒', '预览 {n} 毫秒', 'preview {n} ms'),
  layers:S('效果圖層', '效果图层', 'Effect layers'),
  loadTex:S('載入紋理…', '载入纹理…', 'Load Texture…'), texMenu:S('紋理選單', '纹理菜单', 'Texture menu')
};
/* 「纹理」下拉＋旁边的选单钮（PS：▸≡ ⇒「载入纹理…」）：载入的纹理排在程序纹理后面（值 'tex:<key>'）；挑了 ⇒ 参数记 textureKey／textureFile */
function ag_textureRow(pu, pane, p, prm){
  const cur = () => (typeof prm.textureKey === 'string' && AG_TEX.has(prm.textureKey)) ? 'tex:' + prm.textureKey : (typeof prm.texture === 'string' ? prm.texture : p.options[0]);
  const opts = p.options.map(o => [o, ag_choiceLabel(o)]);
  AG_TEX.forEach(t => opts.push(['tex:' + t.key, t.name]));
  const pick = x => {
    x = String(x);
    if (x.startsWith('tex:') && AG_TEX.has(x.slice(4))){ const t = AG_TEX.get(x.slice(4)); prm.textureKey = t.key; prm.textureFile = t.name; }
    else { delete prm.textureKey; delete prm.textureFile; prm.texture = x; }
  };
  const row = pu.select({k:'texture', label:ag_label('texture'), options:opts, get:cur, set:pick});
  const menuBtn = el('button', {type:'button', title:tr(AG_UI.texMenu), data:{k:'galTexMenu'}, style:'padding:0 6px'}, ['▸≡']);
  menuBtn.onclick = ev => {
    ev.stopPropagation();
    const old = document.querySelector('.ag-texpop'); if (old){ old.remove(); return; }
    const b = menuBtn.getBoundingClientRect();
    const pop = el('div', {className:'ag-texpop', style:`position:fixed;left:${Math.round(b.left)}px;top:${Math.round(b.bottom + 2)}px;z-index:100000;background:#f0f0f0;color:#111;border:1px solid #888;box-shadow:0 2px 8px rgba(0,0,0,.4);padding:2px 0;font-size:12px`});
    const item = el('div', {data:{k:'galLoadTex'}, style:'padding:4px 18px;cursor:pointer;white-space:nowrap'}, [tr(AG_UI.loadTex)]);
    item.onmouseenter = () => { item.style.background = '#2f7fd8'; item.style.color = '#fff'; };
    item.onmouseleave = () => { item.style.background = ''; item.style.color = '#111'; };
    const close = () => { pop.remove(); document.removeEventListener('mousedown', away, true); };
    const away = e2 => { if (!pop.contains(e2.target)) close(); };
    item.onclick = async () => {
      close();
      const fs = await PsFile.pickFiles('.psd,image/*', false); if (!fs || !fs.length) return;   // 取消＝不动
      try { const r = await ag_loadTexture({file:fs[0]}); prm.textureKey = r.textureKey; prm.textureFile = r.textureFile; if (Dlg.cur) Dlg.changed(true); }
      catch (e){ toast(t('error') + (e && e.message || e)); }
    };
    pop.appendChild(item); document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  };
  row.appendChild(menuBtn);
  return row;
}
const ag_label = k => AG_FIELD[k] ? tr(AG_FIELD[k]) : (typeof fieldName === 'function' ? fieldName(k) : k);
const ag_choiceLabel = v => AG_CHOICE[v] ? tr(AG_CHOICE[v]) : (typeof camelLabel === 'function' ? camelLabel(v) : v);
const ag_name = key => AG_NAMES[key] ? tr(AG_NAMES[key]) : (AG_BY_KEY[key] ? AG_BY_KEY[key].name : key);

/* gallery_ui.rs:47 default_params：命令参数式的预设（选项用名字） */
function ag_defaultParams(key){
  const m = {};
  for (const p of AG_BY_KEY[key].params) m[p.key] = p.t === 'range' ? p.d : p.t === 'choice' ? p.options[0] : !!p.d;
  return m;
}
const ag_layerNew = key => ({filter:key, params:ag_defaultParams(key), visible:true});   // gallery_ui.rs:38 EffectLayer::new
/* gallery_ui.rs:184 从参数恢复一层（认不得的滤镜跳过） */
function ag_layerFromJson(e){
  if (!ag_isObj(e) || typeof e.filter !== 'string') return null;
  const f = ag_fromKey(e.filter); if (!f) return null;
  const l = ag_layerNew(f);
  if (ag_isObj(e.params)) Object.assign(l.params, JSON.parse(JSON.stringify(e.params)));
  l.visible = typeof e.visible === 'boolean' ? e.visible : true;
  return l;
}
/* gallery_ui.rs:98-130 cur／set_filter／add／delete／move_to */
const ag_cur = (v, st) => v.effects[Math.min(st.selected, v.effects.length - 1)];
function ag_setFilter(v, st, key){ const i = Math.min(st.selected, v.effects.length - 1), e = v.effects[i]; if (e.filter !== key){ const n = ag_layerNew(key); n.visible = e.visible; v.effects[i] = n; } }
function ag_addLayer(v, st){ const e = JSON.parse(JSON.stringify(ag_cur(v, st))); st.selected = Math.min(st.selected + 1, v.effects.length); v.effects.splice(st.selected, 0, e); }   // 跟 PS 一样：复制目前那层、放在它上面
function ag_delLayer(v, st){ if (v.effects.length > 1){ v.effects.splice(Math.min(st.selected, v.effects.length - 1), 1); st.selected = Math.min(Math.max(st.selected - 1, 0), v.effects.length - 1); } }
function ag_moveLayer(v, st, from, to){ if (from < v.effects.length && to < v.effects.length && from >= 0 && to >= 0 && from !== to){ const e = v.effects.splice(from, 1)[0]; v.effects.splice(to, 0, e); st.selected = to; } }

const AG_CSS = `
.psflt-dlg .ag-wrap{display:flex;gap:8px;height:100%;min-height:0}
.psflt-dlg .ag-left{flex:1;display:flex;flex-direction:column;min-width:0}
.psflt-dlg .ag-view{flex:1;overflow:auto;background:#1e2126;border:1px solid #444a54;display:flex;align-items:center;justify-content:center;min-height:120px}
.psflt-dlg .ag-view canvas{border:1px solid #444a54;background-color:#fff;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%);background-size:16px 16px;background-position:0 0,8px 8px;margin:auto;flex:none}
.psflt-dlg .ag-zoom{display:flex;align-items:center;gap:8px;padding:4px 0}
.psflt-dlg .ag-mid{width:300px;overflow:auto;border-left:1px solid #444a54;padding:0 6px}
.psflt-dlg .ag-cat{cursor:pointer;padding:3px 2px;font-weight:bold;user-select:none}
.psflt-dlg .ag-grid{display:grid;grid-template-columns:repeat(3,84px);gap:6px;margin:4px 0 8px 10px}
.psflt-dlg .ag-cell{cursor:pointer;color:#aab0ba;font-size:10.5px;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.psflt-dlg .ag-cell .ag-th{width:80px;height:56px;border:1px solid #444a54;background:#3a404a;margin:0 auto 2px;display:block}
.psflt-dlg .ag-cell.on{color:#fff}.psflt-dlg .ag-cell.on .ag-th{border:2px solid #2f7fd8}
.psflt-dlg .ag-right{width:290px;display:flex;flex-direction:column;border-left:1px solid #444a54;padding-left:8px;min-height:0}
.psflt-dlg .ag-params{flex:1;overflow:auto;min-height:80px}
.psflt-dlg .ag-params .row>.lb{min-width:90px}
.psflt-dlg .ag-params input[type=range]{min-width:70px}
.psflt-dlg .ag-layers{height:190px;display:flex;flex-direction:column;border-top:1px solid #444a54;margin-top:6px;padding-top:4px}
.psflt-dlg .ag-list{flex:1;overflow:auto}
.psflt-dlg .ag-row{display:flex;align-items:center;gap:6px;height:24px;padding:0 4px;border-radius:2px;cursor:pointer}
.psflt-dlg .ag-row.on{background:#2f4f78}.psflt-dlg .ag-row.off{color:#7a8290}
.psflt-dlg .ag-btns{display:flex;gap:4px;padding-top:4px}.psflt-dlg .ag-btns .sp{flex:1}
`;
function ag_injectCSS(){ if (document.getElementById('psFltAgCss')) return; const s = document.createElement('style'); s.id = 'psFltAgCss'; s.textContent = AG_CSS; document.head.appendChild(s); }

/* gallery_ui.rs:327 缩图：图层中间约 4 倍缩图大小的一块，每 k 格取一格（gallery_ui.rs:134 sample） */
const AG_THUMB = [80, 56];
function ag_thumbSource(){
  const L = Doc.active(); if (!L || L.kind !== 'raster') return null;
  const s = Surf.fromLayer(L), canvas = R(0, 0, Doc.width, Doc.height);
  let cb = rInter(s.contentBounds(), canvas); if (rEmpty(cb)) cb = canvas;
  const k = Math.max(Math.min(Math.floor(RW(cb) / (AG_THUMB[0] * 4)), Math.floor(RH(cb) / (AG_THUMB[1] * 4))), 1);
  const tw = AG_THUMB[0] * k, th = AG_THUMB[1] * k, cx = Math.trunc((cb.x0 + cb.x1) / 2), cy = Math.trunc((cb.y0 + cb.y1) / 2);
  const r = R(cx - Math.trunc(tw / 2), cy - Math.trunc(th / 2), cx - Math.trunc(tw / 2) + tw, cy - Math.trunc(th / 2) + th);
  const w = Math.ceil(RW(r) / k), h = Math.ceil(RH(r) / k), out = new Surf(0, 0, w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){ const p = s.pixel(r.x0 + i * k, r.y0 + j * k), d = (j * w + i) * 4; out.data[d] = p[0]; out.data[d + 1] = p[1]; out.data[d + 2] = p[2]; out.data[d + 3] = p[3]; }
  return out;
}
/* gallery_ui.rs:156 render：小 Surf 上跑一叠（缩图用） → canvas */
function ag_renderThumb(surf, key, fgc, bgc){
  const cb = surf.contentBounds(), b = rEmpty(cb) ? R(0, 0, 1, 1) : R(0, 0, Math.max(cb.x1, 1), Math.max(cb.y1, 1));
  const fp = galleryParamsFor('filter.filterGallery', {effects:[{filter:key}], foreground:fgc, background:bgc});
  const src = Img.readClamped(surf, rInflate(b, REACH.artistic(fp.effects)), b);
  const data = KERNELS.filterGallery(src, b, {bounds:b, mode:'rgb', alpha:true}, fp);
  const cv = document.createElement('canvas'); cv.width = RW(b); cv.height = RH(b); cv.className = 'ag-th';
  const g2 = cv.getContext('2d'), im = g2.createImageData(cv.width, cv.height);
  for (let i = 0; i < im.data.length; i++){ const v = data[i]; im.data[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
  g2.putImageData(im, 0, 0);
  return cv;
}
/* gallery_ui.rs:327 update_thumbs：每回最多做 6 张、分几轮做（打开对话框不卡） */
function ag_thumbTick(st, v){
  if (st.thumbTimer || !Dlg.cur || Dlg.cur.state !== st) return;
  st.thumbTimer = setTimeout(() => {
    st.thumbTimer = 0;
    if (!Dlg.cur || Dlg.cur.state !== st) return;
    if (st.thumbSrc === undefined){ try { st.thumbSrc = ag_thumbSource(); } catch (_){ st.thumbSrc = null; } }
    if (!st.thumbSrc) return;
    let done = 0;
    for (const [key, , cat] of AG_LIST){
      if (st.thumbs[key] || !st.open[AG_CATEGORIES.indexOf(cat)]) continue;
      if (done === 6){ ag_thumbTick(st, v); return; }
      try { st.thumbs[key] = ag_renderThumb(st.thumbSrc, key, v.foreground, v.background); } catch (_){ continue; }
      const ph = Dlg.cur.box.querySelector('[data-thumb="' + key + '"]');
      if (ph) ph.replaceWith(st.thumbs[key]);
      done++;
    }
  }, 0);
}
/* 左边的预览窗：把目前像素层（预视后的样子）照文件坐标画进来（原码是缩小代理；我们直接用 Dlg 预设在图层上跑的结果） */
function ag_drawPreview(st){
  const cv = st.pv, box = st.pvBox; if (!cv || !box) return;
  const c = Dlg.cur, L = c && c.prev ? c.prev.L : (typeof Doc !== 'undefined' ? Doc.active() : null);
  const W = Math.max(Doc.width, 1), H = Math.max(Doc.height, 1);
  const z = st.zoom > 0 ? st.zoom : clamp(Math.min((box.clientWidth - 24) / W, (box.clientHeight - 24) / H), 0.005, 1);
  cv.width = Math.max(1, Math.round(W * z)); cv.height = Math.max(1, Math.round(H * z));
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
  const g2 = cv.getContext('2d'); g2.clearRect(0, 0, cv.width, cv.height);
  if (L && L.data && L.data.canvas){ g2.imageSmoothingEnabled = z < 1; g2.drawImage(L.data.canvas, (L.x || 0) * z, (L.y || 0) * z, L.data.canvas.width * z, L.data.canvas.height * z); }
  if (st.msEl) st.msEl.textContent = tr(AG_UI.ms).replace('{n}', String(Math.round(st.ms || 0)));
}

/* gallery_ui.rs:347 show：左＝预览、中＝分类缩图、右＝滤镜下拉＋参数＋效果层叠 */
CUSTOM_DIALOGS['filter.filterGallery'] = init => {
  init = init || {};
  ag_injectCSS();
  /* gallery_ui.rs:173 open：从上一次的层叠开始（没有＝彩色铅笔一层） */
  const from = Array.isArray(init.effects) ? init.effects : (ag_lastStack || (typeof Last !== 'undefined' && Last.id === 'filter.filterGallery' && Last.params ? Last.params.effects : null) || []);
  let effects = (Array.isArray(from) ? from : []).map(ag_layerFromJson).filter(Boolean);
  if (!effects.length) effects = [ag_layerNew('coloredPencil')];
  const sel = effects.length - 1, selCat = AG_BY_KEY[effects[sel].filter].category;
  const v = {effects, foreground:ag_colour(init.foreground) || fgColor(), background:ag_colour(init.background) || bgColor()};
  const st = {selected:sel, open:AG_CATEGORIES.map(c => c === selCat), zoom:0, thumbs:{}, thumbSrc:undefined, thumbTimer:0, scroll:{}, pv:null, pvBox:null, msEl:null, ms:0};
  const keepScroll = (node, name) => { node.addEventListener('scroll', () => { st.scroll[name] = node.scrollTop; }); return () => { node.scrollTop = st.scroll[name] || 0; }; };
  const box = Dlg.open({
    id:'filter.filterGallery', wide:true, v, state:st,
    build(ui, v, st){
      const restores = [];
      const wrap = el('div', {className:'ag-wrap'}), left = el('div', {className:'ag-left'}), mid = el('div', {className:'ag-mid'}), right = el('div', {className:'ag-right'});
      /* ---- 预览 ---- */
      if (!st.pv){ st.pvBox = el('div', {className:'ag-view', data:{k:'galView'}}); st.pv = el('canvas', {width:1, height:1, data:{k:'galPreview'}}); st.pvBox.appendChild(st.pv); }
      left.appendChild(st.pvBox);
      const zb = el('div', {className:'ag-zoom'});
      const zs = el('select', {data:{k:'galZoom'}});
      [[0, tr(AG_UI.fit)], [0.125, '12.5%'], [0.25, '25%'], [0.5, '50%'], [1, '100%'], [2, '200%'], [4, '400%']].forEach(([z, txt]) => zs.appendChild(el('option', {value:String(z), selected:st.zoom === z}, [txt])));
      zs.onchange = () => { st.zoom = Number(zs.value) || 0; ag_drawPreview(st); };
      st.msEl = el('span', {className:'note'});
      zb.appendChild(zs); zb.appendChild(st.msEl); left.appendChild(zb);
      /* ---- 分类资料夹＋缩图 ---- */
      const cur = ag_cur(v, st);
      AG_CATEGORIES.forEach((cat, ci) => {
        const hd = el('div', {className:'ag-cat', data:{k:'galCat' + ci}}, [(st.open[ci] ? '▾ ' : '▸ ') + tr(AG_CAT_NAMES[cat])]);
        hd.onclick = () => { st.open[ci] = !st.open[ci]; Dlg.render(); };
        mid.appendChild(hd);
        if (!st.open[ci]) return;
        const grid = el('div', {className:'ag-grid'});
        for (const [key, , c2] of AG_LIST){
          if (c2 !== cat) continue;
          const th = st.thumbs[key] || el('div', {className:'ag-th', data:{thumb:key}});
          const cell = el('div', {className:'ag-cell' + (cur.filter === key ? ' on' : ''), title:ag_name(key), data:{k:'gal-' + key}}, [th, ag_name(key)]);
          cell.onclick = () => { ag_setFilter(v, st, key); Dlg.changed(true); };
          grid.appendChild(cell);
        }
        mid.appendChild(grid);
      });
      restores.push(keepScroll(mid, 'mid'));
      /* ---- 右：滤镜下拉、参数、效果层叠 ---- */
      const fs = el('select', {data:{k:'galFilter'}, style:'width:100%;margin-bottom:6px'});
      for (const [key] of AG_LIST) fs.appendChild(el('option', {value:key, selected:cur.filter === key}, [ag_name(key)]));
      fs.onchange = () => { ag_setFilter(v, st, fs.value); Dlg.changed(true); };
      right.appendChild(fs);
      const pane = el('div', {className:'ag-params'}), pu = makeUI(pane, Dlg), prm = cur.params;
      const inf = AG_BY_KEY[cur.filter];
      for (const p of parseSpec(inf.doc)){
        const k = p.key;
        if (p.t === 'range') pu.slider({k, label:ag_label(k), min:p.min, max:p.max, step:1, get:() => typeof prm[k] === 'number' ? prm[k] : p.d, set:x => { prm[k] = rround(x); }});
        else if (p.t === 'choice' && k === 'texture' && inf.doc.includes('"textureKey"')) ag_textureRow(pu, pane, p, prm);
        else if (p.t === 'choice') pu.select({k, label:ag_label(k), options:p.options.map(o => [o, ag_choiceLabel(o)]), get:() => typeof prm[k] === 'string' ? prm[k] : p.options[0], set:x => { prm[k] = String(x); }});
        else if (p.t === 'bool') pu.check({k, label:ag_label(k), get:() => typeof prm[k] === 'boolean' ? prm[k] : p.d, set:x => { prm[k] = !!x; }});
        else if (p.t === 'json' && k === 'glowColor') pu.color({k, label:ag_label(k), get:() => hexOf(ag_colour(prm.glowColor) || AG_NEON), set:x => { const c = hexRGBA(x, AG_NEON); prm.glowColor = [c[0], c[1], c[2], 1]; }});
      }
      if (inf.uses) pu.note(tr(AG_UI.colours));
      right.appendChild(pane);
      restores.push(keepScroll(pane, 'params'));
      const lay = el('div', {className:'ag-layers'}), list = el('div', {className:'ag-list', title:tr(AG_UI.layers)});
      for (let i = v.effects.length - 1; i >= 0; i--){                // 清单最上面＝最后套用
        const ef = v.effects[i];
        const eye = el('input', {type:'checkbox', checked:ef.visible, title:tr(AG_UI.show), data:{k:'galEye' + i}});
        eye.onclick = ev => ev.stopPropagation();
        eye.onchange = () => { ef.visible = eye.checked; Dlg.changed(true); };
        const row = el('div', {className:'ag-row' + (i === st.selected ? ' on' : '') + (ef.visible ? '' : ' off'), data:{k:'galLayer' + i}}, [eye, ag_name(ef.filter)]);
        row.onclick = () => { if (st.selected !== i){ st.selected = i; Dlg.render(); } };
        list.appendChild(row);
      }
      lay.appendChild(list);
      restores.push(keepScroll(list, 'list'));
      const bt = el('div', {className:'ag-btns'});
      const btn = (txt, title, k, fn) => { const b = pu.button(txt, fn, k); b.title = title; return b; };
      bt.appendChild(btn('▲', tr(AG_UI.up), 'galUp', () => { const s = st.selected; ag_moveLayer(v, st, s, Math.min(s + 1, v.effects.length - 1)); Dlg.changed(true); }));
      bt.appendChild(btn('▼', tr(AG_UI.down), 'galDown', () => { const s = st.selected; ag_moveLayer(v, st, s, Math.max(s - 1, 0)); Dlg.changed(true); }));
      bt.appendChild(el('span', {className:'sp'}));
      bt.appendChild(btn('+', tr(AG_UI.add), 'galAdd', () => { ag_addLayer(v, st); Dlg.changed(true); }));
      bt.appendChild(btn('−', tr(AG_UI.del), 'galDel', () => { ag_delLayer(v, st); Dlg.changed(true); }));
      lay.appendChild(bt);
      right.appendChild(lay);
      wrap.appendChild(left); wrap.appendChild(mid); wrap.appendChild(right);
      ui.add(wrap);
      restores.forEach(f => f());
      ag_drawPreview(st);
      ag_thumbTick(st, v);
    },
    /* gallery_ui.rs:94 params ＋ 228 commit（没有可见的层＝不跑） */
    params(v){
      if (!v.effects.some(e => e.visible)) return null;
      return {effects:v.effects.map(e => ({filter:e.filter, params:JSON.parse(JSON.stringify(e.params)), visible:e.visible})), foreground:v.foreground.slice(), background:v.background.slice()};
    },
    onPreview(L, prm){
      const t0 = performance.now();
      if (prm) runFilterOnLayer(L, 'filter.filterGallery', prm, {preview:true});
      st.ms = performance.now() - t0;
      ag_drawPreview(st);
    },
    onClose(){ if (st.thumbTimer) clearTimeout(st.thumbTimer); st.thumbTimer = 0; const pop = document.querySelector('.ag-texpop'); if (pop) pop.remove(); }
  });
  /* 关掉「预视」时左边也要回到原样 */
  const pc = box && box.querySelector('[data-k="__preview"]');
  if (pc) pc.addEventListener('change', () => setTimeout(() => ag_drawPreview(st), 60));
  return box;
};

/* ──────────────── 段：16-render2.js ──────────────── */
/* ═══════════ 滤镜 ▸ 渲染 ▸ 火焰…／图片框…／树…（algo/src/render2.rs 全档 ＋ engine/src/render_cmds.rs） ═══════════
   三个程序化渲染器：把选项变成一串反锯齿向量图元（渐细胶囊、渐层椭圆；一般／相加／变亮混合），
   r2_composite 把图元画进像素层（画布 ∩ 选区外框为界、按选区覆盖度混合）。我们只有 RGB：to_rgba／from_rgba 都是原样。 */

/* ── u64 小工具：SplitMix64 要 64 位无号整数，JS 用 [hi, lo] 两个 u32 表示；r2_mul 结果放 r2_H／r2_L ── */
let r2_H = 0, r2_L = 0;
function r2_mul(ah, al, bh, bl){                                   // (a × b) mod 2^64（u64 wrapping_mul）
  const a48 = ah >>> 16, a32 = ah & 0xffff, a16 = al >>> 16, a00 = al & 0xffff;
  const b48 = bh >>> 16, b32 = bh & 0xffff, b16 = bl >>> 16, b00 = bl & 0xffff;
  let c00 = a00 * b00, c16 = c00 >>> 16; c00 &= 0xffff;
  c16 += a16 * b00; let c32 = c16 >>> 16; c16 &= 0xffff;
  c16 += a00 * b16; c32 += c16 >>> 16; c16 &= 0xffff;
  c32 += a32 * b00; let c48 = c32 >>> 16; c32 &= 0xffff;
  c32 += a16 * b16; c48 += c32 >>> 16; c32 &= 0xffff;
  c32 += a00 * b32; c48 += c32 >>> 16; c32 &= 0xffff;
  c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48; c48 &= 0xffff;
  r2_H = ((c48 << 16) | c32) >>> 0; r2_L = ((c16 << 16) | c00) >>> 0;
}
const r2_u64 = n => [Math.floor(n / 4294967296) >>> 0, n >>> 0];   // 非负整数（或 i64 转 u64）→ [hi, lo]
const r2_xor = (a, b) => [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0];
const r2_mod = (a, m) => ((a[0] % m) * (4294967296 % m) + a[1] % m) % m;   // u64 % m（m 小）

/* render2.rs:272 Rng：小型确定性乱数（SplitMix64） */
class r2_Rng {
  constructor(hi, lo){ this.hi = hi >>> 0; this.lo = lo >>> 0; }
  /* render2.rs:277 new：((seed as u64) << 32) ^ salt × 0x9E3779B97F4A7C15 ^ 0x2545F4914F6CDD1D */
  static make(seed, salt){
    const s = r2_u64(salt); r2_mul(s[0], s[1], 0x9E3779B9, 0x7F4A7C15);
    return new r2_Rng(((seed >>> 0) ^ r2_H ^ 0x2545F491) >>> 0, (0 ^ r2_L ^ 0x4F6CDD1D) >>> 0);
  }
  /* render2.rs:280 next_u64 → [hi, lo] */
  next(){
    let lo = this.lo + 0x7F4A7C15; const c = lo > 0xFFFFFFFF ? 1 : 0; lo >>>= 0;
    const hi = (this.hi + 0x9E3779B9 + c) >>> 0;
    this.hi = hi; this.lo = lo;
    let zl = (lo ^ ((lo >>> 30) | (hi << 2))) >>> 0, zh = (hi ^ (hi >>> 30)) >>> 0;
    r2_mul(zh, zl, 0xBF58476D, 0x1CE4E5B9); zh = r2_H; zl = r2_L;
    zl = (zl ^ ((zl >>> 27) | (zh << 5))) >>> 0; zh = (zh ^ (zh >>> 27)) >>> 0;
    r2_mul(zh, zl, 0x94D049BB, 0x133111EB); zh = r2_H; zl = r2_L;
    zl = (zl ^ ((zl >>> 31) | (zh << 1))) >>> 0; zh = (zh ^ (zh >>> 31)) >>> 0;
    return [zh, zl];
  }
  f(){ return (this.next()[0] >>> 8) / 16777216; }                // render2.rs:288（>> 40 ＝ hi >> 8）
  range(a, b){ return a + (b - a) * this.f(); }                    // render2.rs:292
  sym(){ return this.f() * 2 - 1; }                                // render2.rs:296
}

/* render2.rs:302 noise1：平滑一维值杂讯 [-1, 1]；seed 是 u64 [hi, lo] */
function r2_noise1(x, seed){
  const h = i => { const u = r2_u64(i); r2_mul(u[0], u[1], 0xD6E8FEB8, 0x6659FD93); return new r2_Rng(r2_H ^ seed[0], r2_L ^ seed[1]).sym(); };
  const fi = Math.floor(x), f = x - fi, t = f * f * (3 - 2 * f);
  return h(fi) + (h(fi + 1) - h(fi)) * t;
}
/* render2.rs:315 fbm1：两个八度 */
const r2_fbm1 = (x, seed) => (r2_noise1(x, seed) + 0.5 * r2_noise1(x * 2.13 + 7.1, [seed[0], (seed[1] ^ 0xA5A5) >>> 0])) / 1.5;

/* ── 图元（render2.rs:22-127）：cap＝胶囊 a→b 半径 ra→rb、颜色 c0→c1 沿线；否则椭圆（中心→边缘 c0→c1）。
   颜色一律复制一份（Rust 的 [f32;4] 是值，淡化时各改各的） ── */
const R2_NORMAL = 0, R2_ADD = 1, R2_LIGHTEN = 2;
const r2_capsule = (a, b, ra, rb, c0, c1) => ({cap:true, ax:a[0], ay:a[1], bx:b[0], by:b[1], ra, rb, c0:c0.slice(), c1:c1.slice(), soft:1, blend:R2_NORMAL});   // :55
const r2_ellipse = (c, rx, ry, angle, c0, c1) => ({cap:false, cx:c[0], cy:c[1], rx, ry, angle, c0:c0.slice(), c1:c1.slice(), soft:1, blend:R2_NORMAL});   // :58
const r2_disc = (c, r, col) => r2_ellipse(c, r, r, 0, col, col);   // :61
const r2_soft = (p, s) => { p.soft = s; return p; };              // :64 with_soft
const r2_additive = p => { p.blend = R2_ADD; return p; };          // :68
const r2_lighten = p => { p.blend = R2_LIGHTEN; return p; };       // :72
/* render2.rs:78 bounds：图元可能碰到的像素框 */
function r2_bounds(p){
  const s = Math.max(p.soft, 1) + 1;
  let x0, y0, x1, y1;
  if (p.cap){ const r = Math.max(p.ra, p.rb) + s; x0 = Math.min(p.ax, p.bx) - r; y0 = Math.min(p.ay, p.by) - r; x1 = Math.max(p.ax, p.bx) + r; y1 = Math.max(p.ay, p.by) + r; }
  else {
    const sn = Math.sin(p.angle), cs = Math.cos(p.angle);
    const ex = Math.sqrt((p.rx * cs) ** 2 + (p.ry * sn) ** 2) + s, ey = Math.sqrt((p.rx * sn) ** 2 + (p.ry * cs) ** 2) + s;
    x0 = p.cx - ex; y0 = p.cy - ey; x1 = p.cx + ex; y1 = p.cy + ey;
  }
  if (!(isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1))) return EMPTY;
  const cl = v => Math.trunc(clamp(v, -1e8, 1e8));
  return R(cl(Math.floor(x0)), cl(Math.floor(y0)), cl(Math.ceil(x1)), cl(Math.ceil(y1)));
}
/* render2.rs:101 eval：像素中心的覆盖度（0–1）与颜色位置（0–1） */
function r2_eval(p, x, y){
  const soft = Math.max(p.soft, 1);
  if (p.cap){
    const dx = p.bx - p.ax, dy = p.by - p.ay, l2 = dx * dx + dy * dy;
    const t = l2 > 1e-9 ? clamp(((x - p.ax) * dx + (y - p.ay) * dy) / l2, 0, 1) : 0;
    const px = p.ax + dx * t - x, py = p.ay + dy * t - y, d = Math.sqrt(px * px + py * py);
    const r = p.ra + (p.rb - p.ra) * t;
    const thin = clamp(2 * r, 0, 1);                               // 比一像素细的线淡掉而不是消失
    r2_T = t; return clamp((Math.max(r, 0.5) - d) / soft + 0.5, 0, 1) * thin;
  }
  const s = Math.sin(p.angle), co = Math.cos(p.angle), dx = x - p.cx, dy = y - p.cy;
  const u = dx * co + dy * s, v = -dx * s + dy * co, rx = Math.max(p.rx, 0.05), ry = Math.max(p.ry, 0.05);
  const e = Math.sqrt((u / rx) ** 2 + (v / ry) ** 2), mn = Math.min(rx, ry);
  const edge = (1 - e) * mn, thin = clamp(2 * mn, 0, 1);
  r2_T = Math.min(e, 1); return clamp(edge / soft + 0.5, 0, 1) * thin;
}
let r2_T = 0;                                                       // r2_eval 的第二个回传值（颜色位置）

/* render2.rs:135 raster_tile：照顺序把图元画进 t 范围的预乘 RGBA 暂存 */
function r2_rasterTile(prims, idx, t){
  const w = RW(t), buf = new Float32Array(w * RH(t) * 4);
  for (const k of idx){
    const p = prims[k], r = rInter(r2_bounds(p), t);
    if (rEmpty(r)) continue;
    const same = p.c0[0] === p.c1[0] && p.c0[1] === p.c1[1] && p.c0[2] === p.c1[2] && p.c0[3] === p.c1[3];
    for (let y = r.y0; y < r.y1; y++){
      const row = (y - t.y0) * w;
      for (let x = r.x0; x < r.x1; x++){
        const cov = r2_eval(p, x + 0.5, y + 0.5);
        if (cov <= 0) continue;
        const ct = r2_T, c = same ? p.c0 : [p.c0[0] + (p.c1[0] - p.c0[0]) * ct, p.c0[1] + (p.c1[1] - p.c0[1]) * ct, p.c0[2] + (p.c1[2] - p.c0[2]) * ct, p.c0[3] + (p.c1[3] - p.c0[3]) * ct];   // :130 lerp4
        const a = clamp(c[3] * cov, 0, 1);
        if (a <= 0) continue;
        const i = (row + x - t.x0) * 4;
        if (p.blend === R2_ADD){
          buf[i] += c[0] * a; buf[i + 1] += c[1] * a; buf[i + 2] += c[2] * a; buf[i + 3] += a * (1 - buf[i + 3]);
        } else if (p.blend === R2_LIGHTEN){
          buf[i] = Math.max(buf[i], c[0] * a); buf[i + 1] = Math.max(buf[i + 1], c[1] * a); buf[i + 2] = Math.max(buf[i + 2], c[2] * a); buf[i + 3] = Math.max(buf[i + 3], a);
        } else {
          const kk = 1 - a;
          buf[i] = c[0] * a + buf[i] * kk; buf[i + 1] = c[1] * a + buf[i + 1] * kk; buf[i + 2] = c[2] * a + buf[i + 2] * kk; buf[i + 3] = a + buf[i + 3] * kk;
        }
      }
    }
  }
  return buf;
}

/* render2.rs:189 composite：在 clip 内把图元画到 surf 上、按选区覆盖度（sel.get）混合；回传画到的外框。
   原码把图元分进 128 格小块并行画——每格内照原顺序、每个像素只看碰到它的图元，结果与分块无关 ⇒ 我们整块（used）一次画 */
function r2_composite(surf, prims, clip, sel){
  let used = EMPTY;
  const bounds = prims.map(p => rInter(r2_bounds(p), clip));
  for (const b of bounds) if (!rEmpty(b)) used = rEmpty(used) ? b : rUnion(used, b);
  if (rEmpty(used)) return used;
  const idx = []; bounds.forEach((b, k) => { if (!rEmpty(b)) idx.push(k); });
  const paint = r2_rasterTile(prims, idx, used), data = surf.readRegion(used), w = RW(used);
  for (let i = 0, N = w * RH(used); i < N; i++){
    const j = i * 4, s3 = paint[j + 3];
    const k = sel ? clamp(sel.get(used.x0 + i % w, used.y0 + Math.floor(i / w)), 0, 1) : 1;
    const sa = clamp(s3, 0, 1) * k;
    if (sa <= 0) continue;
    const inv = 1 / Math.max(s3, 1e-6);
    const sc0 = clamp(paint[j] * inv, 0, 1), sc1 = clamp(paint[j + 1] * inv, 0, 1), sc2 = clamp(paint[j + 2] * inv, 0, 1);
    const da = data[j + 3], oa = sa + da * (1 - sa);
    const mix = (sv, dv) => oa > 1e-7 ? (sv * sa + dv * da * (1 - sa)) / oa : 0;
    data[j] = mix(sc0, data[j]); data[j + 1] = mix(sc1, data[j + 1]); data[j + 2] = mix(sc2, data[j + 2]); data[j + 3] = oa;
  }
  surf.writeRegion(used, data);
  return used;
}

/* ── render2.rs:324 Spine：以弧长参数化的折线 ── */
class r2_Spine {
  constructor(pts){ this.pts = pts; this.cum = [0]; for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  len(){ return this.cum[this.cum.length - 1] || 0; }
  /* :342 at：弧长 s 处的点与单位切线 → [px, py, dx, dy] */
  at(s){
    const n = this.pts.length;
    if (n === 0) return [0, 0, 1, 0];
    if (n === 1) return [this.pts[0][0], this.pts[0][1], 0, -1];
    s = clamp(s, 0, this.len());
    const cmp = v => v < s ? -1 : v > s ? 1 : v === s ? 0 : -1;   // partial_cmp，NaN 当 Less
    let size = this.cum.length, base = 0;                         // slice::binary_search_by
    while (size > 1){ const half = size >> 1, mid = base + half; if (cmp(this.cum[mid]) !== 1) base = mid; size -= half; }
    const c = cmp(this.cum[base]);
    const k = c === 0 ? Math.min(base, n - 2) : Math.min(Math.max(base + (c === -1 ? 1 : 0) - 1, 0), n - 2);
    const a = this.pts[k], b = this.pts[k + 1];
    const seg = Math.max(this.cum[k + 1] - this.cum[k], 1e-6), t = clamp((s - this.cum[k]) / seg, 0, 1);
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-6);
    return [a[0] + dx * t, a[1] + dy * t, dx / l, dy / l];
  }
}

/* ═══════════ 火焰（render2.rs:364-669） ═══════════ */
const R2_FLAME_TYPES = ['oneFlameAlongPath', 'multipleFlamesAlongPath', 'multipleFlamesPathDirections', 'multipleFlamesVariousLength', 'candleLight', 'multipleFlamesOneDirection'];   // :371
const R2_FLAME_STYLES = ['normal', 'violent', 'flat'];             // :390
const R2_FLAME_SHAPES = ['parallel', 'toCenter', 'spread', 'oval', 'pointed'];   // :400
const R2_FLAME_QUALITY = ['draft', 'low', 'medium', 'high', 'fine'];   // render_cmds.rs:138
/* :446 FlameSpec 预设值 */
const R2_FLAME_DEF = {flameType:'oneFlameAlongPath', length:150, randomizeLength:false, width:40, angle:0, interval:60, adjustIntervalForLoops:true, color:null,
  turbulent:25, jag:25, opacity:75, flameLines:20, flameBottomAlignment:20, flameStyle:'normal', flameShape:'parallel', randomizeShapes:false, seed:0, quality:2};

/* :472 flame_colour：火焰上 t 处的颜色（0＝底、1＝尖） */
function r2_flameColour(t, custom){
  const a = Math.pow(1 - t, 0.7) * 0.9 + 0.1 * (1 - t);
  if (custom){
    const c = custom, core = [c[0] * 0.4 + 0.6, c[1] * 0.4 + 0.6, c[2] * 0.4 + 0.6], rim = [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];   // 近白的焰心 → 颜色 → 较暗的边
    const k = clamp(t, 0, 1);
    let rgb;
    if (k < 0.35){ const u = k / 0.35; rgb = [core[0] + (c[0] - core[0]) * u, core[1] + (c[1] - core[1]) * u, core[2] + (c[2] - core[2]) * u]; }
    else { const u = (k - 0.35) / 0.65; rgb = [c[0] + (rim[0] - c[0]) * u, c[1] + (rim[1] - c[1]) * u, c[2] + (rim[2] - c[2]) * u]; }
    return [rgb[0], rgb[1], rgb[2], a * c[3]];
  }
  const STOPS = [[0, [1, 0.98, 0.85]], [0.2, [1, 0.86, 0.35]], [0.45, [1, 0.55, 0.08]], [0.75, [0.9, 0.25, 0.02]], [1, [0.6, 0.08, 0]]];
  const k = clamp(t, 0, 1);
  let rgb = STOPS[4][1];
  for (let i = 0; i + 1 < STOPS.length; i++){
    const w0 = STOPS[i], w1 = STOPS[i + 1];
    if (k <= w1[0]){ const u = (k - w0[0]) / (w1[0] - w0[0]); rgb = [0, 1, 2].map(c => w0[1][c] + (w1[1][c] - w0[1][c]) * u); break; }
  }
  return [rgb[0], rgb[1], rgb[2], a];
}

/* :507 draw_flame：一道火焰（脊线 底→尖、宽度、乱数流） */
function r2_drawFlame(out, spine, width, spec, rng){
  const len = spine.len();
  if (len < 1) return;
  const lines = rround(clamp(spec.flameLines, 1, 100) * 0.6 + 3);
  const segs = Math.min(Math.max([6, 10, 16, 24, 36][Math.min(spec.quality, 4)], Math.trunc(len / 12)), 160);
  let turb = clamp(spec.turbulent, 0, 100) / 100, jag = clamp(spec.jag, 0, 100) / 100;
  if (spec.flameStyle === 'violent'){ turb = Math.min(turb * 1.8 + 0.2, 2); jag = Math.min(jag * 1.8 + 0.15, 2); }
  else if (spec.flameStyle === 'flat'){ turb *= 0.35; jag *= 0.35; }
  const shape = spec.randomizeShapes ? R2_FLAME_SHAPES[r2_mod(rng.next(), 5)] : spec.flameShape;
  const opacity = clamp(spec.opacity, 0, 100) / 100;
  const half = Math.max(width, 1) / 2;
  const seed = rng.next();
  // 整道火焰摆动；每条线再加自己的闪动
  const swaySeed = [seed[0], (seed[1] ^ 0x5A5A) >>> 0];
  const sway = u => turb * half * 1.6 * r2_fbm1(u * 1.7, swaySeed) * Math.pow(u, 1.4);
  // 沿脊线一层柔和的相加光晕
  for (let k = 0; k < 6; k++){
    const u = k / 6 * 0.75 + 0.05;
    const [px, py, dx, dy] = spine.at(u * len);
    const o = sway(u), c = r2_flameColour(u, spec.color), r = half * (1.25 - u) + 2;
    out.push(r2_additive(r2_soft(r2_ellipse([px - dy * o, py + dx * o], r, r * 1.2, Math.atan2(dy, dx), [c[0], c[1], c[2], 0.16 * opacity], [c[0], c[1] * 0.6, c[2] * 0.3, 0]), Math.max(r, 2))));
  }
  const lineR = clamp(half / lines * 2.2, 0.8, 10);
  for (let li = 0; li < lines; li++){
    const lane = lines === 1 ? 0 : li / (lines - 1) * 2 - 1;
    r2_mul(0, li, 0x00517CC1, 0xB727220A); const lseed = [(seed[0] ^ r2_H) >>> 0, (seed[1] ^ r2_L) >>> 0];
    const lseed77 = [lseed[0], (lseed[1] ^ 0x77) >>> 0];
    const start = (clamp(spec.flameBottomAlignment, 0, 100) / 100) * rng.f() * 0.4;
    // 外侧的线较短，形成火舌
    const reach = (1 - 0.55 * Math.pow(Math.abs(lane), 1.5)) * rng.range(0.7, 1.0);
    const end = clamp(start + reach * (1 - start), start + 0.05, 1);
    const lr = lineR * rng.range(0.6, 1.3);
    let prev = null;
    for (let k = 0; k <= segs; k++){
      const u = start + (end - start) * k / segs, s = u * len;
      const [px, py, dx, dy] = spine.at(s);
      const nx = -dy, ny = dx;
      const spread = shape === 'parallel' ? 1 - 0.6 * u : shape === 'toCenter' ? 1 - u : shape === 'spread' ? 1 + u : shape === 'oval' ? Math.sin(Math.PI * (0.15 + 0.85 * u)) * 1.3 : (1 - u) ** 2;
      const flick = turb * half * 0.5 * r2_fbm1(s / (len * 0.2 + 6) + li * 0.37, lseed) * u + jag * half * 0.25 * r2_noise1(s / 5, lseed77) * u;
      const off = lane * half * spread + sway(u) + flick;
      const p = [px + nx * off, py + ny * off], r = lr * (1 - u * 0.75);
      // 每条线朝自己的尖端淡出
      const fadeT = clamp((u - start) / Math.max(end - start, 1e-3), 0, 1);
      if (prev){
        // 前十分之一淡入（柔和的底），朝尖端淡出
        const f = (c, uu, t) => [c[0], c[1], c[2], c[3] * opacity * (1 - t ** 3) * Math.sqrt(clamp((uu - start) / 0.08, 0, 1))];
        const [q, rq, uq] = prev;
        out.push(r2_lighten(r2_soft(r2_capsule(q, p, rq, r, f(r2_flameColour(uq, spec.color), uq, fadeT), f(r2_flameColour(u, spec.color), u, fadeT)), 1 + lr * 0.6)));
      }
      prev = [p, r, u];
    }
  }
}

/* :592 flame：paths＝文件像素的折线 */
function r2_flame(spec, paths){
  const out = [], rng = r2_Rng.make(spec.seed, 0xF1A3);
  const length = clamp(spec.length, 1, 1000), width = clamp(spec.width, 1, 1000), interval = clamp(spec.interval, 1, 1000);
  const pickLen = (rng, v) => (spec.randomizeLength || v > 0) ? length * rng.range(1 - Math.max(v, 0.4), 1 + Math.max(v, 0.4) * 0.5) : length;
  for (const path of paths.filter(p => p.length)){
    const spine = new r2_Spine(path.slice()), total = spine.len(), ft = spec.flameType;
    if (ft === 'oneFlameAlongPath' && path.length >= 2 && total >= 1) r2_drawFlame(out, spine, width, spec, rng);
    else if (ft === 'candleLight' || ft === 'oneFlameAlongPath'){
      // 蜡烛：从起点笔直向上的短泪滴
      const base = path[0], h = Math.min(length, 400);
      const candle = new r2_Spine([base, [base[0], base[1] - h]]);
      const c = Object.assign({}, spec, {flameShape:'oval', turbulent:spec.turbulent * 0.3, jag:spec.jag * 0.2});
      r2_drawFlame(out, candle, Math.max(width * 0.6, 4), c, rng);
      const core = r2_flameColour(0.05, spec.color);
      out.push(r2_additive(r2_soft(r2_ellipse([base[0], base[1] - h * 0.28], Math.max(width * 0.12, 1.5), h * 0.22, 0,
        [core[0], core[1], core[2], 0.9 * clamp(spec.opacity, 0, 100) / 100], [core[0], core[1], core[2], 0]), 2)));
    } else {
      const closed = path.length > 2 && Math.abs(path[0][0] - path[path.length - 1][0]) < 1 && Math.abs(path[0][1] - path[path.length - 1][1]) < 1;
      const loop = spec.adjustIntervalForLoops && closed;
      const count = loop ? Math.max(rround(total / interval), 1) : Math.floor(total / interval) + 1;
      const step = loop ? total / count : interval;
      for (let k = 0; k < count; k++){
        const [x, y, dx, dy] = spine.at(k * step);
        let dir;
        if (ft === 'multipleFlamesPathDirections') dir = [dx, dy];
        else if (ft === 'multipleFlamesOneDirection'){ const a = spec.angle * DEG; dir = [Math.sin(a), -Math.cos(a)]; }
        else dir = [dy, -dx];                                      // 路径方向的左侧（从左往右的路径＝朝上）
        const v = ft === 'multipleFlamesVariousLength' ? 0.7 : 0;
        const l = pickLen(rng, v);
        r2_drawFlame(out, new r2_Spine([[x, y], [x + dir[0] * l, y + dir[1] * l]]), width, spec, rng);
      }
    }
  }
  return out;
}

/* :661 default_flame_path：文件没有路径时用——画布下方一道平缓的弧 */
function r2_defaultFlamePath(c){
  const w = RW(c), h = RH(c), out = [];
  for (let k = 0; k <= 32; k++){ const t = k / 32; out.push([c.x0 + w * (0.15 + 0.7 * t), c.y0 + h * (0.8 - 0.08 * Math.sin(Math.PI * t))]); }
  return out;
}

/* ═══════════ 树（render2.rs:671-1119） ═══════════ */
const R2_BROWN = [0.36, 0.25, 0.16], R2_GREY_BARK = [0.45, 0.42, 0.38], R2_GREEN = [0.24, 0.52, 0.16], R2_DARK_GREEN = [0.12, 0.36, 0.14];
/* :727 tk(name, habit, levels, children, spread, ratio, trunk, droop, wiggle, thick, leaf, leaf_col, bark, accent) */
const r2_tk = (name, habit, levels, children, spread, ratio, trunk, droop, wiggle, thick, leaf, leafCol, bark, accent) => ({name, habit, levels, children, spread, ratio, trunk, droop, wiggle, thick, leaf, leafCol, bark, accent});
/* :752 TREES（index＝baseTreeType − 1） */
const R2_TREES = [
  r2_tk('Oak', 'branching', 5, 3, 38, 0.72, 0.35, 0.05, 0.35, 0.035, 'round', R2_GREEN, R2_BROWN, null),
  r2_tk('Maple', 'branching', 5, 3, 34, 0.74, 0.32, 0, 0.25, 0.03, 'heart', [0.3, 0.55, 0.15], R2_BROWN, null),
  r2_tk('Pine', 'conifer', 3, 2, 70, 0.5, 0.15, 0.25, 0.1, 0.025, 'needle', R2_DARK_GREEN, R2_BROWN, null),
  r2_tk('Palm', 'palm', 1, 9, 0, 0, 0.85, 0, 0.15, 0.022, 'frond', [0.25, 0.5, 0.18], [0.55, 0.45, 0.32], null),
  r2_tk('Birch', 'branching', 5, 2, 28, 0.75, 0.4, 0.1, 0.3, 0.02, 'oval', [0.45, 0.65, 0.2], [0.88, 0.86, 0.82], null),
  r2_tk('Weeping Willow', 'branching', 5, 3, 40, 0.78, 0.3, 0.9, 0.2, 0.035, 'long', [0.45, 0.62, 0.22], R2_GREY_BARK, null),
  r2_tk('Cherry Blossom', 'branching', 5, 3, 42, 0.7, 0.3, 0, 0.45, 0.03, 'blossom', [0.98, 0.75, 0.82], [0.3, 0.2, 0.17], null),
  r2_tk('Bamboo', 'bamboo', 1, 5, 6, 0, 1, 0, 0.05, 0.012, 'long', [0.35, 0.6, 0.2], [0.55, 0.65, 0.3], null),
  r2_tk('Cypress', 'branching', 5, 3, 10, 0.8, 0.1, -0.1, 0.1, 0.02, 'needle', R2_DARK_GREEN, R2_BROWN, null),
  r2_tk('Baobab', 'branching', 3, 4, 50, 0.55, 0.65, 0, 0.3, 0.09, 'round', [0.35, 0.55, 0.2], [0.55, 0.47, 0.4], null),
  r2_tk('Ginkgo', 'branching', 4, 3, 30, 0.72, 0.35, 0, 0.2, 0.025, 'heart', [0.75, 0.75, 0.2], R2_GREY_BARK, null),
  r2_tk('Spruce', 'conifer', 3, 2, 80, 0.45, 0.1, 0.45, 0.08, 0.025, 'needle', [0.1, 0.3, 0.2], R2_BROWN, null),
  r2_tk('Bare Winter Tree', 'branching', 6, 2, 34, 0.74, 0.3, 0.05, 0.35, 0.03, 'none', R2_GREEN, [0.3, 0.25, 0.22], null),
  r2_tk('Apple', 'branching', 5, 3, 46, 0.68, 0.3, 0.1, 0.4, 0.03, 'round', R2_GREEN, R2_BROWN, [0.85, 0.1, 0.1]),
  r2_tk('Acacia', 'branching', 4, 3, 55, 0.75, 0.45, -0.25, 0.25, 0.03, 'round', [0.35, 0.5, 0.18], R2_BROWN, null),
  r2_tk('Poplar', 'branching', 5, 3, 12, 0.8, 0.15, -0.15, 0.1, 0.025, 'oval', [0.3, 0.55, 0.15], R2_GREY_BARK, null),
  r2_tk('Elm', 'branching', 5, 2, 24, 0.8, 0.3, 0.15, 0.25, 0.032, 'oval', R2_GREEN, R2_BROWN, null),
  r2_tk('Magnolia', 'branching', 4, 3, 40, 0.7, 0.3, 0, 0.3, 0.03, 'blossom', [0.98, 0.9, 0.92], [0.35, 0.28, 0.25], [0.85, 0.5, 0.65]),
  r2_tk('Banana', 'palm', 1, 7, 0, 0, 0.6, 0, 0.05, 0.04, 'frond', [0.45, 0.7, 0.2], [0.5, 0.6, 0.3], null),
  r2_tk('Bonsai', 'branching', 4, 3, 60, 0.6, 0.45, 0.2, 0.7, 0.05, 'round', R2_DARK_GREEN, [0.4, 0.3, 0.22], null),
  r2_tk('Jacaranda', 'branching', 5, 3, 44, 0.72, 0.3, 0, 0.35, 0.03, 'blossom', [0.6, 0.45, 0.85], R2_BROWN, null),
  r2_tk('Autumn Maple', 'branching', 5, 3, 34, 0.74, 0.32, 0, 0.25, 0.03, 'heart', [0.85, 0.3, 0.1], R2_BROWN, null),
  r2_tk('Golden Autumn', 'branching', 5, 3, 36, 0.72, 0.33, 0.05, 0.3, 0.03, 'round', [0.9, 0.7, 0.15], R2_BROWN, null),
  r2_tk('Olive', 'branching', 4, 3, 48, 0.68, 0.35, 0.1, 0.6, 0.04, 'long', [0.5, 0.58, 0.42], R2_GREY_BARK, [0.25, 0.28, 0.12]),
  r2_tk('Fir', 'conifer', 3, 2, 75, 0.5, 0.12, 0.15, 0.05, 0.025, 'needle', [0.12, 0.38, 0.22], R2_BROWN, null),
  r2_tk('Cedar', 'conifer', 3, 3, 88, 0.6, 0.2, 0, 0.15, 0.03, 'needle', [0.2, 0.4, 0.25], R2_BROWN, null),
  r2_tk('Lemon', 'branching', 4, 3, 45, 0.68, 0.3, 0.05, 0.35, 0.03, 'oval', R2_DARK_GREEN, R2_BROWN, [0.98, 0.88, 0.15]),
  r2_tk('Wisteria', 'branching', 5, 3, 45, 0.72, 0.3, 0.7, 0.3, 0.03, 'blossom', [0.7, 0.55, 0.9], [0.35, 0.3, 0.27], null),
  r2_tk('Young Sapling', 'branching', 3, 2, 30, 0.7, 0.45, 0, 0.2, 0.015, 'oval', [0.4, 0.7, 0.2], [0.45, 0.35, 0.22], null),
  r2_tk('Dead Tree', 'branching', 5, 2, 45, 0.68, 0.4, 0.1, 0.8, 0.035, 'none', R2_GREEN, [0.32, 0.29, 0.26], null),
  r2_tk('Coconut Palm', 'palm', 1, 11, 0, 0, 0.88, 0, 0.35, 0.018, 'frond', [0.3, 0.55, 0.15], [0.6, 0.5, 0.36], [0.4, 0.3, 0.15]),
  r2_tk('Shrub', 'branching', 4, 4, 55, 0.7, 0.05, 0, 0.35, 0.02, 'round', R2_GREEN, R2_BROWN, null),
  r2_tk('Plum Blossom', 'branching', 5, 2, 48, 0.7, 0.3, 0.1, 0.6, 0.03, 'blossom', [0.95, 0.6, 0.7], [0.25, 0.18, 0.15], null),
  r2_tk('Cloud Pine', 'branching', 4, 3, 70, 0.65, 0.35, 0.2, 0.5, 0.035, 'needle', [0.15, 0.4, 0.2], [0.35, 0.27, 0.2], null)
];
const r2_treeTypeNames = () => R2_TREES.map(t => t.name);        // :790
/* :826 TreeSpec 预设值 */
const R2_TREE_DEF = {baseTreeType:1, lightDirection:3, leavesAmount:50, leavesSize:100, branchesHeight:100, branchesThickness:100, defaultLeaves:true, leavesColor:[0.24, 0.52, 0.16, 1],
  customBranchColor:false, branchesColor:[0.36, 0.25, 0.16, 1], flatShading:false, seed:0, x:0.5, y:0.95, size:0.8};
/* :861 shade */
const r2_shade = (c, k) => [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1), 1];

/* :848 TreeCtx */
class r2_TreeCtx {
  constructor(o){ Object.assign(this, o); this.branches = []; this.leaves = []; }
  /* :867 light_at：树冠受光的一侧较亮 */
  lightAt(p){
    if (this.spec.flatShading) return 1;
    const dx = p[0] - this.centre[0], dy = p[1] - this.centre[1], l = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    return 0.78 + 0.32 * ((dx * this.light[0] + dy * this.light[1]) / l) + 0.12 * this.rng.sym();
  }
  /* :876 add_leaf */
  addLeaf(p, dir){
    const r = this.rng, s = this.leafPx * r.range(0.7, 1.2), ang = dir + r.sym() * 1.2, k = this.lightAt(p), col = this.leaf;
    let prim;
    switch (this.kind.leaf){
      case 'none': return;
      case 'round': prim = r2_ellipse(p, s, s * 0.85, ang, r2_shade(col, k * 1.1), r2_shade(col, k * 0.8)); break;
      case 'oval': prim = r2_ellipse(p, s * 1.2, s * 0.55, ang, r2_shade(col, k * 1.1), r2_shade(col, k * 0.8)); break;
      case 'long': prim = r2_ellipse(p, s * 1.6, s * 0.28, ang, r2_shade(col, k * 1.1), r2_shade(col, k * 0.8)); break;
      case 'heart': prim = r2_ellipse(p, s * 0.9, s * 1.1, ang, r2_shade(col, k * 1.1), r2_shade(col, k * 0.75)); break;
      case 'needle': {
        // 一簇从小枝散开的针叶
        const n = 7;
        for (let j = 0; j < n; j++){
          const a = ang + (j / (n - 1) - 0.5) * 2.4 + this.rng.sym() * 0.15;
          const l = s * this.rng.range(1.1, 1.7), q = [p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l];
          const kk = k + 0.1 * this.rng.sym();
          this.leaves.push([kk, r2_capsule(p, q, Math.max(s * 0.1, 0.45), Math.max(s * 0.05, 0.3), r2_shade(col, kk * 0.85), r2_shade(col, kk * 1.1))]);
        }
        return;
      }
      case 'blossom': prim = r2_ellipse(p, s * 0.75, s * 0.75, 0, r2_shade(col, k * 1.08), r2_shade(col, k * 0.85)); break;
      default: prim = r2_ellipse(p, s * 1.6, s * 0.3, ang, r2_shade(col, k), r2_shade(col, k * 0.8));   // frond
    }
    const order = k + this.rng.f() * 0.05;
    this.leaves.push([order, prim]);
    const acc = this.kind.accent;
    if (acc && this.rng.f() < 0.12){
      const qx = p[0] + this.rng.sym() * s, qy = p[1] + this.rng.sym() * s, rr = Math.max(s * 0.45, 1);
      this.leaves.push([k + 1, r2_ellipse([qx, qy], rr, rr, 0, r2_shade(acc, k * 1.15), r2_shade(acc, k * 0.75))]);
    }
  }
  /* :916 limb：从 p 朝 ang（弧度，0＝右、y 朝下）的一段弯枝 → [终点, 终点方向] */
  limb(p, ang, len, r0, r1, depth01){
    const t0n = len / 6, segs = clamp(isFinite(t0n) ? Math.max(Math.trunc(t0n), 0) : 0, 2, 10);
    let q = p, a = ang;
    const droop = this.kind.droop * depth01, col0 = r2_shade(this.bark, 0.9 + 0.2 * depth01);
    for (let k = 0; k < segs; k++){
      const t0 = k / segs, t1 = (k + 1) / segs;
      a += this.kind.wiggle * this.rng.sym() * 0.25;
      // 重力把方向拉向正下方（π/2）
      const down = Math.PI / 2, diff = Math.atan2(Math.sin(down - a), Math.cos(down - a));
      a += diff * droop * 0.12;
      const step = len / segs, nq = [q[0] + Math.cos(a) * step, q[1] + Math.sin(a) * step];
      this.branches.push(r2_capsule(q, nq, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, col0, col0));
      if (depth01 > 0.99 && this.kind.leaf !== 'none' && k > 0 && this.rng.f() < clamp(this.spec.leavesAmount, 0, 100) / 100 * 0.9) this.addLeaf(nq, a);
      q = nq;
    }
    return [q, a];
  }
  /* :941 branch */
  branch(p, ang, len, r, level){
    const levels = this.kind.levels, depth01 = level / Math.max(levels, 1), rEnd = r * 0.62;
    const [end, a] = this.limb(p, ang, len, r, rEnd, depth01);
    if (level >= levels){
      const amount = clamp(this.spec.leavesAmount, 0, 100) / 100;
      if (this.kind.leaf !== 'none'){
        const n = rround(amount * 9);
        for (let i = 0; i < n; i++){
          const d = len * 0.5 * this.rng.f(), th = this.rng.f() * TAU;
          this.addLeaf([end[0] + Math.cos(th) * d, end[1] + Math.sin(th) * d], a);
        }
      }
      return;
    }
    const spread = this.kind.spread * DEG, n = this.kind.children;
    for (let c = 0; c < n; c++){
      const side = n === 1 ? 0 : c / (n - 1) * 2 - 1;
      const ca = a + side * spread + this.rng.sym() * spread * 0.35;
      const cl = len * this.kind.ratio * this.rng.range(0.8, 1.1);
      const cr = rEnd * this.rng.range(0.75, 0.95);
      this.branch(end, ca, cl, cr, level + 1);
    }
  }
}

/* :971 tree：在 canvas 内造树的图元 */
function r2_tree(spec, canvas){
  const kind = R2_TREES[clamp(spec.baseTreeType, 1, R2_TREES.length) - 1];
  const h = RH(canvas) * clamp(spec.size, 0.05, 2);
  const base = [canvas.x0 + RW(canvas) * spec.x, canvas.y0 + RH(canvas) * spec.y];
  const la = [0, 180, 225, 270, 315, 0][clamp(spec.lightDirection, 1, 5)] * DEG;
  const leaf = spec.defaultLeaves ? kind.leafCol : [spec.leavesColor[0], spec.leavesColor[1], spec.leavesColor[2]];
  const bark = spec.customBranchColor ? [spec.branchesColor[0], spec.branchesColor[1], spec.branchesColor[2]] : kind.bark;
  const thick = clamp(spec.branchesThickness, 50, 200) / 100, bh = clamp(spec.branchesHeight, 50, 300) / 100;
  const t = new r2_TreeCtx({kind, spec, rng:r2_Rng.make(spec.seed, 0x7EE + spec.baseTreeType), bark, leaf, light:[Math.cos(la), Math.sin(la)],
    centre:[base[0], base[1] - h * 0.65], leafPx:Math.max(h * 0.012 * clamp(spec.leavesSize, 0, 200) / 100, 0.6)});
  const up = -Math.PI / 2, r0 = Math.max(h * kind.thick * thick, 0.8);
  if (kind.habit === 'branching'){
    const trunk = Math.min(h * kind.trunk * bh, h * 0.92);
    const [top, a] = t.limb(base, up, Math.max(trunk, 1), r0, r0 * 0.75, 0);
    // 树冠长度：让整棵树约 h 高
    let geo = 0; for (let k = 0; k < kind.levels; k++) geo += Math.pow(kind.ratio, k);
    const first = (Math.max(h - trunk, h * 0.08) / Math.max(geo, 0.5)) * 1.05;
    const n = Math.max(kind.children, 2);
    for (let c = 0; c < n; c++){
      const side = c / (n - 1) * 2 - 1, sp = kind.spread * DEG * 0.8;
      const ca = a + side * sp + t.rng.sym() * 0.15;
      const fl = first * t.rng.range(0.85, 1.05);
      t.branch(top, ca, fl, r0 * 0.7, 1);
    }
  } else if (kind.habit === 'conifer'){
    const [top] = t.limb(base, up, h, r0, r0 * 0.1, 0);
    const start = Math.min(h * kind.trunk * bh, h * 0.8);
    const whorls = Math.trunc(14 * clamp(Math.sqrt(h / 300), 0.6, 2.5));
    const spread = kind.spread * DEG;
    for (let k = 0; k < whorls; k++){
      const f = k / whorls, y = base[1] - start - (h - start) * f;
      const x = base[0] + (top[0] - base[0]) * ((base[1] - y) / h);
      const span = (h - start) * 0.42 * Math.pow(1 - f, 0.9) + h * 0.03;
      for (const side of [-1, 1]){
        const ang = up + side * spread + t.rng.sym() * 0.1;
        t.branch([x, y], ang, span, Math.max(r0 * 0.35 * (1 - f), 0.6), kind.levels);
        if (kind.levels >= 2){
          const s2 = Math.sin(ang + side * 0.5), c2 = Math.cos(ang + side * 0.5);
          t.branch([x + c2 * span * 0.5, y + s2 * span * 0.5], ang + side * 0.6, span * 0.4, Math.max(r0 * 0.15, 0.5), kind.levels);
        }
      }
    }
  } else if (kind.habit === 'palm'){
    const trunk = Math.max(h * kind.trunk * Math.min(bh, 1.15), 1);
    const lean = t.rng.sym() * kind.wiggle, segs = 12;
    let p = base;
    for (let k = 0; k < segs; k++){
      const f = k / segs, a = up + lean * f;
      const q = [p[0] + Math.cos(a) * trunk / segs, p[1] + Math.sin(a) * trunk / segs];
      const r = r0 * (1 - 0.35 * f), ring = r2_shade(bark, k % 2 === 0 ? 1 : 0.85);
      t.branches.push(r2_capsule(p, q, r, r * 0.97, ring, ring));
      p = q;
    }
    const fronds = kind.children, flen = h * 0.38 * Math.sqrt(clamp(spec.leavesSize, 10, 200) / 100);
    for (let k = 0; k < fronds; k++){
      const a = up + (k / fronds - 0.5) * Math.PI * 1.7 + t.rng.sym() * 0.2;
      let q = p, ang = a;
      const segs2 = 10, leaflets = rround(clamp(spec.leavesAmount, 0, 100) / 100 * 3);
      for (let s = 0; s < segs2; s++){
        // 叶柄先拱起再垂向地面
        const d = Math.PI / 2 - ang;
        ang += 0.06 * Math.atan2(Math.sin(d), Math.cos(d));
        const nq = [q[0] + Math.cos(ang) * flen / segs2, q[1] + Math.sin(ang) * flen / segs2];
        const k2 = t.lightAt(nq);
        t.leaves.push([k2 - 0.1, r2_capsule(q, nq, Math.max(r0 * 0.15, 0.6), Math.max(r0 * 0.1, 0.4), r2_shade(t.leaf, k2 * 0.8), r2_shade(t.leaf, k2 * 0.8))]);
        for (let j = 0; j < leaflets; j++){
          const along = j / leaflets, at = [q[0] + (nq[0] - q[0]) * along, q[1] + (nq[1] - q[1]) * along];
          for (const side of [-1, 1]){
            const la2 = ang + side * 1.1, ll = flen * 0.22 * (1 - s / segs2 * 0.7);
            const tip = [at[0] + Math.cos(la2) * ll, at[1] + Math.sin(la2) * ll + ll * 0.25];
            t.leaves.push([k2, r2_capsule(at, tip, Math.max(ll * 0.08, 0.5), 0.3, r2_shade(t.leaf, k2), r2_shade(t.leaf, k2 * 0.9))]);
          }
        }
        q = nq;
      }
    }
    if (kind.accent){
      for (let i = 0; i < 4; i++){
        const cx = p[0] + t.rng.sym() * r0 * 2, cy = p[1] + t.rng.f() * r0 * 2;
        t.leaves.push([2, r2_disc([cx, cy], r0 * 1.1, r2_shade(kind.accent, 1))]);
      }
    }
  } else {                                                          // bamboo
    const stalks = kind.children;
    for (let k = 0; k < stalks; k++){
      const x = base[0] + (k - (stalks - 1) / 2) * r0 * 5 + t.rng.sym() * r0;
      const hh = h * t.rng.range(0.7, 1.0);
      const a = up + t.rng.sym() * kind.spread * DEG * 0.5;
      const joints = 8;
      let p = [x, base[1]];
      for (let j = 0; j < joints; j++){
        const q = [p[0] + Math.cos(a) * hh / joints, p[1] + Math.sin(a) * hh / joints];
        t.branches.push(r2_capsule(p, q, r0, r0, r2_shade(bark, 1), r2_shade(bark, 0.85)));
        t.branches.push(r2_capsule([q[0] - r0 * 1.1, q[1]], [q[0] + r0 * 1.1, q[1]], r0 * 0.25, r0 * 0.25, r2_shade(bark, 0.7), r2_shade(bark, 0.7)));
        if (j >= Math.floor(joints / 3)){
          const leaves = rround(clamp(spec.leavesAmount, 0, 100) / 100 * 4);
          for (let i = 0; i < leaves; i++){
            const side = t.rng.f() < 0.5 ? -1 : 1;
            const la2 = a + side * t.rng.range(0.6, 1.4), ll = t.leafPx * 2.2;
            t.addLeaf([q[0] + Math.cos(la2) * ll, q[1] + Math.sin(la2) * ll], la2);
          }
        }
        p = q;
      }
    }
  }
  // 后面的叶子先画：暗的在下、亮的在上（稳定排序；NaN 当相等）
  t.leaves.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return t.branches.concat(t.leaves.map(x => x[1]));
}

/* ═══════════ 图片框（render2.rs:1121-1487） ═══════════ */
const R2_FRAME_STYLES = ['vineWithFlowers', 'vineWithLeaves', 'ivy', 'roses', 'daisies', 'berries', 'bamboo', 'waves', 'zigzag', 'dots', 'rope', 'scallops', 'doubleLine', 'snowflakes', 'stars', 'hearts'];   // :1126
/* :1169 FrameSpec 预设值 */
const R2_FRAME_DEF = {frame:1, margin:4, size:50, arrangement:50, lines:1, thickness:30, fade:0, vineColor:[0.25, 0.4, 0.15, 1], flowerColor:[0.9, 0.3, 0.45, 1], leafColor:[0.3, 0.6, 0.2, 1], seed:0};
const r2_remf = (x, m) => { const r = x % m; return r < 0 ? r + Math.abs(m) : r; };   // f32::rem_euclid
/* :1188 Border：顺时针（从左上起）按弧长走的框 */
class r2_Border {
  constructor(x0, y0, w, h){ this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; }
  len(){ return 2 * (this.w + this.h); }
  /* :1200 at → [点, 单位切线, 朝内法线] */
  at(s){
    s = r2_remf(s, this.len());
    const w = this.w, h = this.h;
    if (s < w) return [[this.x0 + s, this.y0], [1, 0], [0, 1]];
    if (s < w + h) return [[this.x0 + w, this.y0 + s - w], [0, 1], [-1, 0]];
    if (s < 2 * w + h) return [[this.x0 + w - (s - w - h), this.y0 + h], [-1, 0], [0, -1]];
    return [[this.x0, this.y0 + h - (s - 2 * w - h)], [0, -1], [1, 0]];
  }
}
const r2_rgb = c => [c[0], c[1], c[2]];
/* :1215 flower */
function r2_flower(out, c, r, petals, petal, centre, rot){
  for (let k = 0; k < petals; k++){
    const a = rot + k / petals * TAU, p = [c[0] + Math.cos(a) * r * 0.55, c[1] + Math.sin(a) * r * 0.55];
    out.push(r2_ellipse(p, r * 0.5, r * 0.26, a, petal, r2_shade(r2_rgb(petal), 0.8)));
  }
  out.push(r2_ellipse(c, r * 0.28, r * 0.28, 0, centre, r2_shade(r2_rgb(centre), 0.75)));
}
/* :1224 leaf */
function r2_leaf(out, p, ang, len, col){
  const c = [p[0] + Math.cos(ang) * len * 0.5, p[1] + Math.sin(ang) * len * 0.5];
  out.push(r2_ellipse(c, len * 0.5, len * 0.22, ang, r2_shade(r2_rgb(col), 1.12), r2_shade(r2_rgb(col), 0.8)));
}
/* :1229 star */
function r2_star(out, c, r, points, col, rot){
  for (let k = 0; k < points; k++){ const a = rot + k / points * TAU; out.push(r2_capsule(c, [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r], r * 0.28, 0.4, col, col)); }
}

/* :1237 picture_frame：在 canvas 内造图片框的图元 */
function r2_pictureFrame(spec, canvas){
  const out = [];
  const short = Math.max(Math.min(RW(canvas), RH(canvas)), 8);
  const margin = short * clamp(spec.margin, 0, 30) / 100;
  const unit = short * (0.008 + clamp(spec.size, 1, 100) / 100 * 0.05);
  const thick = Math.max(unit * 0.04 + short * 0.00012 * clamp(spec.thickness, 1, 100), 0.6);
  const spacing = unit * (4 - 3.2 * clamp(spec.arrangement, 1, 100) / 100);
  const inset = margin + unit;
  const b = new r2_Border(canvas.x0 + inset, canvas.y0 + inset, Math.max(RW(canvas) - 2 * inset, 1), Math.max(RH(canvas) - 2 * inset, 1));
  const total = b.len();
  const count = Math.max(rround(total / spacing), 4);
  const step = total / count;
  const rng = r2_Rng.make(spec.seed, 0xF8A3E + spec.frame);
  const vine = spec.vineColor, fl = spec.flowerColor, lf = spec.leafColor;
  const style = R2_FRAME_STYLES[clamp(spec.frame, 1, R2_FRAME_STYLES.length) - 1];
  const lines = clamp(spec.lines, 1, 5);
  const white = [1, 1, 1, 1], yellow = [0.98, 0.82, 0.2, 1];
  // 沿框一道波浪藤蔓
  const vinePath = (amp, wl, col, r) => {
    const n = Math.max(Math.ceil(total / 3), 8);
    let prev = null;
    for (let k = 0; k <= n; k++){
      const s = k / n * total, [p, , nn] = b.at(s), o = amp * Math.sin(s / wl * TAU), q = [p[0] + nn[0] * o, p[1] + nn[1] * o];
      if (prev) out.push(r2_capsule(prev, q, r, r, col, col));
      prev = q;
    }
  };
  const waveOff = (s, amp, wl) => amp * Math.sin(s / wl * TAU);
  if (['vineWithFlowers', 'vineWithLeaves', 'ivy', 'roses', 'daisies', 'berries'].includes(style)){
    const amp = unit * 0.5, wl = step * 2;
    vinePath(amp, wl, vine, thick);
    for (let k = 0; k < count; k++){
      const s = k * step + step * 0.5, [p, t, nn] = b.at(s), o = waveOff(s, amp, wl);
      const q = [p[0] + nn[0] * o, p[1] + nn[1] * o];
      const side = k % 2 === 0 ? 1 : -1, ta = Math.atan2(t[1], t[0]);
      const la = ta + side * 0.9 + rng.sym() * 0.3;
      const ll = unit * rng.range(0.9, 1.2);
      if (style === 'vineWithFlowers'){
        r2_leaf(out, q, la, ll, lf);
        if (k % 2 === 0) r2_flower(out, [q[0] + nn[0] * unit * 0.7 * side, q[1] + nn[1] * unit * 0.7 * side], unit * 0.65, 5, fl, yellow, rng.f() * 6.3);
      } else if (style === 'vineWithLeaves'){
        r2_leaf(out, q, la, ll, lf); r2_leaf(out, q, ta - side * 0.9, ll * 0.8, lf);
      } else if (style === 'ivy'){
        for (let j = 0; j < 3; j++) r2_leaf(out, q, la + (j - 1) * 0.7, ll * 0.75, r2_shade(r2_rgb(lf), 0.75 + 0.15 * j));
      } else if (style === 'roses'){
        r2_leaf(out, q, la, ll, lf);
        if (k % 3 === 0){
          const r = unit * 0.7;
          [1, 0.75, 0.5, 0.28].forEach((f, j) => {
            const c = r2_shade(r2_rgb(fl), 0.75 + 0.1 * j);
            out.push(r2_ellipse(q, r * f, r * f * 0.9, rng.f() * 3, c, r2_shade(r2_rgb(fl), 0.55)));
          });
        }
      } else if (style === 'daisies'){
        r2_leaf(out, q, la, ll * 0.8, lf);
        if (k % 2 === 1) r2_flower(out, q, unit * 0.6, 12, white, yellow, rng.f());
      } else {                                                      // berries
        r2_leaf(out, q, la, ll, lf);
        for (let i = 0; i < 3; i++){
          const cx = q[0] + rng.sym() * unit * 0.4, cy = q[1] + rng.sym() * unit * 0.4;
          out.push(r2_ellipse([cx, cy], unit * 0.2, unit * 0.2, 0, r2_shade(r2_rgb(fl), 1.2), r2_shade(r2_rgb(fl), 0.6)));
        }
      }
    }
  } else if (style === 'bamboo'){
    for (let edge = 0; edge < 4; edge++){
      const [s0, l] = [[0, b.w], [b.w, b.h], [b.w + b.h, b.w], [2 * b.w + b.h, b.h]][edge];
      const a = b.at(s0 + 0.01)[0], z = b.at(s0 + l - 0.01)[0];
      const joints = Math.max(rround(l / (spacing * 2)), 1);
      for (let j = 0; j < joints; j++){
        const f0 = j / joints, f1 = (j + 1) / joints;
        const p0 = [a[0] + (z[0] - a[0]) * f0, a[1] + (z[1] - a[1]) * f0], p1 = [a[0] + (z[0] - a[0]) * f1, a[1] + (z[1] - a[1]) * f1];
        out.push(r2_capsule(p0, p1, unit * 0.35, unit * 0.35, vine, r2_shade(r2_rgb(vine), 0.8)));
        out.push(r2_disc(p1, unit * 0.4, r2_shade(r2_rgb(vine), 0.7)));
      }
      // 每边几片叶子
      for (let i = 0, n = Math.max(Math.floor(joints / 2), 1); i < n; i++){
        const f = rng.f(), p = [a[0] + (z[0] - a[0]) * f, a[1] + (z[1] - a[1]) * f];
        r2_leaf(out, p, rng.f() * 6.3, unit * 1.4, lf);
      }
    }
  } else if (['waves', 'zigzag', 'doubleLine', 'rope'].includes(style)){
    for (let li = 0; li < lines; li++){
      const off = (li - (lines - 1) / 2) * thick * 4;
      const n = Math.max(Math.ceil(total / 2), 8);
      let prev = null;
      for (let k = 0; k <= n; k++){
        const s = k / n * total, [p, , nn] = b.at(s);
        let o = off;
        if (style === 'waves') o += waveOff(s + li * step * 0.25, unit * 0.4, step);
        else if (style === 'zigzag'){ const x = s / step, ph = x - Math.trunc(x); o += unit * 0.4 * (4 * Math.abs(ph - 0.5) - 1); }
        const q = [p[0] + nn[0] * o, p[1] + nn[1] * o];
        if (style === 'rope'){
          if (k % 2 === 0){
            const t = b.at(s)[1];
            out.push(r2_ellipse(q, unit * 0.45, unit * 0.2, Math.atan2(t[1], t[0]) + 0.7, r2_shade(r2_rgb(vine), 1.1), r2_shade(r2_rgb(vine), 0.65)));
          }
        } else if (prev) out.push(r2_capsule(prev, q, thick, thick, vine, vine));
        prev = q;
      }
      if (style === 'doubleLine'){
        // 每条线内侧再一道细线
        const ins = unit * 0.6 + off;
        const inner = new r2_Border(b.x0 + ins, b.y0 + ins, b.w - 2 * ins, b.h - 2 * ins);
        const A = [0, inner.w, inner.w + inner.h, 2 * inner.w + inner.h], Z = [inner.w, inner.w + inner.h, 2 * inner.w + inner.h, inner.len() - 0.001];
        for (let e = 0; e < 4; e++) out.push(r2_capsule(inner.at(A[e])[0], inner.at(Z[e])[0], thick * 0.6, thick * 0.6, vine, vine));
      }
    }
    if (style === 'doubleLine'){                                     // 四角的方块
      const A = [0, b.w, b.w + b.h, 2 * b.w + b.h];
      for (let e = 0; e < 4; e++) out.push(r2_ellipse(b.at(A[e])[0], unit * 0.45, unit * 0.45, Math.PI / 4, fl, fl));
    }
  } else {                                                          // dots | scallops | snowflakes | stars | hearts
    for (let k = 0; k < count; k++){
      const s = k * step, [p, t, nn] = b.at(s), ta = Math.atan2(t[1], t[0]);
      if (style === 'dots'){
        const r = unit * (k % 2 === 0 ? 0.4 : 0.22);
        out.push(r2_ellipse(p, r, r, 0, r2_shade(r2_rgb(fl), 1.15), r2_shade(r2_rgb(fl), 0.75)));
      } else if (style === 'scallops'){
        const c0 = b.at(s - step * 0.5)[0], mid = [(c0[0] + p[0]) / 2, (c0[1] + p[1]) / 2], n = 8, r = step * 0.5;
        const pt = a => [mid[0] - t[0] * r * Math.cos(a) - nn[0] * r * Math.sin(a), mid[1] - t[1] * r * Math.cos(a) - nn[1] * r * Math.sin(a)];
        for (let j = 0; j < n; j++) out.push(r2_capsule(pt(Math.PI * j / n), pt(Math.PI * (j + 1) / n), thick, thick, vine, vine));
      } else if (style === 'snowflakes'){
        const r = unit * 0.6, c = [0.85, 0.92, 1, 1];
        for (let j = 0; j < 6; j++){
          const a = ta + j * Math.PI / 3, e = [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
          out.push(r2_capsule(p, e, Math.max(thick * 0.6, 0.6), Math.max(thick * 0.4, 0.5), c, c));
          const m = [p[0] + Math.cos(a) * r * 0.6, p[1] + Math.sin(a) * r * 0.6];
          for (const sd of [-0.7, 0.7]) out.push(r2_capsule(m, [m[0] + Math.cos(a + sd) * r * 0.3, m[1] + Math.sin(a + sd) * r * 0.3], Math.max(thick * 0.4, 0.5), 0.4, c, c));
        }
      } else if (style === 'stars') r2_star(out, p, unit * 0.55, 5, k % 2 === 0 ? yellow : fl, ta - Math.PI / 2);
      else {
        // 心形：两个圆瓣、尖端朝内
        const r = unit * 0.3, tx = t[0], ty = t[1];
        const l = [p[0] - tx * r * 0.8 - nn[0] * r * 0.3, p[1] - ty * r * 0.8 - nn[1] * r * 0.3];
        const rr = [p[0] + tx * r * 0.8 - nn[0] * r * 0.3, p[1] + ty * r * 0.8 - nn[1] * r * 0.3];
        const tip = [p[0] + nn[0] * r * 1.6, p[1] + nn[1] * r * 1.6];
        out.push(r2_capsule(l, tip, r, 0.6, fl, fl)); out.push(r2_capsule(rr, tip, r, 0.6, fl, fl));
      }
    }
  }
  // 淡化：越往里伸的装饰越透明
  const fade = clamp(spec.fade, 0, 100) / 100;
  if (fade > 0){
    const cx = canvas.x0 + RW(canvas) / 2, cy = canvas.y0 + RH(canvas) / 2;
    for (const p of out){
      const c = p.cap ? [p.ax, p.ay] : [p.cx, p.cy];
      const edge = clamp(Math.max(Math.abs(c[0] - cx) / (b.w / 2), Math.abs(c[1] - cy) / (b.h / 2)), 0, 1);
      const k = clamp(1 - fade * (1 - edge) * 8, 0, 1);
      p.c0[3] *= k; p.c1[3] *= k;
    }
  }
  return out;
}

/* ═══════════ 命令（engine/src/render_cmds.rs） ═══════════ */
/* render_cmds.rs:18 parse_colour：[r,g,b(,a)]（0–1）或 #rrggbb → [r,g,b,a] */
function r2_parseColour(v){
  if (Array.isArray(v) && v.length >= 3){ const c = (j, d) => typeof v[j] === 'number' ? v[j] : d; return [c(0, 0), c(1, 0), c(2, 0), c(3, 1)]; }
  if (typeof v === 'string' && v.length === 7 && v[0] === '#'){ const ch = j => { const s = v.slice(j, j + 2); return /^[0-9a-fA-F]{2}$/.test(s) ? parseInt(s, 16) / 255 : 0; }; return [ch(1), ch(3), ch(5), 1]; }
  return null;
}
/* :33 normalized：参数物件（去掉 layer/newLayer/path；颜色键正规化成阵列，不合法的丢掉）。paths 是我们加的（路径来源），也拿掉 */
function r2_normalized(p, colours){
  const m = p && typeof p === 'object' && !Array.isArray(p) ? Object.assign({}, p) : {};
  delete m.layer; delete m.newLayer; delete m.path; delete m.paths;
  for (const k of colours) if (k in m){ const v = m[k]; delete m[k]; const c = r2_parseColour(v); if (c) m[k] = c; }
  return m;
}
/* :48 spec_from：照 serde（camelCase、缺的用预设、不认得的键忽略）反序列化；型别不对 ⇒ invalid parameters */
function r2_unexp(v){
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'string ' + JSON.stringify(v);
  if (typeof v === 'boolean') return 'boolean `' + v + '`';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer `' + v + '`' : 'floating point `' + v + '`';
  return Array.isArray(v) ? 'sequence' : 'map';
}
function r2_specFrom(m, schema, def){
  const spec = JSON.parse(JSON.stringify(def));
  const bad = msg => { throw new FltBad('invalid parameters: ' + msg); };
  const f32 = (v, what) => { if (typeof v !== 'number' || !isFinite(v)) bad('invalid type: ' + r2_unexp(v) + ', expected ' + what); return v; };
  const col4 = v => {
    if (!Array.isArray(v)) bad('invalid type: ' + r2_unexp(v) + ', expected an array of length 4');
    if (v.length !== 4) bad('invalid length ' + v.length + ', expected an array of length 4');
    return v.map(x => f32(x, 'f32'));
  };
  for (const k of Object.keys(m)){
    const t = schema[k]; if (!t) continue;                            // 不认得的键：serde 预设忽略
    const v = m[k];
    if (t === 'f32') spec[k] = f32(v, 'f32');
    else if (t === 'bool'){ if (typeof v !== 'boolean') bad('invalid type: ' + r2_unexp(v) + ', expected a boolean'); spec[k] = v; }
    else if (t === 'u32'){
      if (typeof v !== 'number' || !Number.isInteger(v)) bad('invalid type: ' + r2_unexp(v) + ', expected u32');
      if (v < 0 || v > 4294967295) bad('invalid value: integer `' + v + '`, expected u32');
      spec[k] = v;
    } else if (t === 'color') spec[k] = col4(v);
    else if (t === 'optcolor') spec[k] = v === null ? null : col4(v);
    else {                                                          // 列举（camelCase 名字）
      if (typeof v !== 'string') bad('invalid type: ' + r2_unexp(v) + ', expected unit variant');
      if (!t.includes(v)) bad('unknown variant `' + v + '`, expected one of ' + t.map(x => '`' + x + '`').join(', '));
      spec[k] = v;
    }
  }
  return spec;
}
/* :53 index_param：列举选项可给 1 起算的号码或名字（大小写、空白、-、_ 不计；认不得＝1） */
function r2_indexParam(m, k, names){
  if (typeof m[k] !== 'string') return;
  const norm = s => s.toLowerCase().replace(/[ \-_]/g, ''), want = norm(m[k]);
  const i = names.findIndex(s => norm(s) === want);
  m[k] = i < 0 ? 1 : i + 1;
}
const R2_FLAME_SCHEMA = {flameType:R2_FLAME_TYPES, length:'f32', randomizeLength:'bool', width:'f32', angle:'f32', interval:'f32', adjustIntervalForLoops:'bool', color:'optcolor',
  turbulent:'f32', jag:'f32', opacity:'f32', flameLines:'f32', flameBottomAlignment:'f32', flameStyle:R2_FLAME_STYLES, flameShape:R2_FLAME_SHAPES, randomizeShapes:'bool', seed:'u32', quality:'u32'};
const R2_TREE_SCHEMA = {baseTreeType:'u32', lightDirection:'u32', leavesAmount:'f32', leavesSize:'f32', branchesHeight:'f32', branchesThickness:'f32', defaultLeaves:'bool', leavesColor:'color',
  customBranchColor:'bool', branchesColor:'color', flatShading:'bool', seed:'u32', x:'f32', y:'f32', size:'f32'};
const R2_FRAME_SCHEMA = {frame:'u32', margin:'f32', size:'f32', arrangement:'f32', lines:'u32', thickness:'f32', fade:'f32', vineColor:'color', flowerColor:'color', leafColor:'color', seed:'u32'};

/* :63 flame_paths 的替代：我们没有「路径」面板／存的路径 ⇒ 来源依序是
   ① p.paths（agent 给的折线 [[[x,y],…],…]，文件坐标；也收 {x,y}）
   ② 文件的工作路径 Doc.workPath（文字 ▸ 建立工作路径 产生的 {subpaths:[{closed, anchors}]}；p.path 给了别的名字就不用它——我们没有存的路径）
   都没有 ⇒ null（用原码的退路）。闭合的子路径补回起点（同原码） */
function r2_flamePaths(p){
  if (p.paths !== undefined && p.paths !== null){
    if (!Array.isArray(p.paths)) throw new FltBad('invalid parameters: paths must be an array of polylines [[[x,y],…],…]');
    const polys = [];
    for (const pl of p.paths){
      if (!Array.isArray(pl)) throw new FltBad('invalid parameters: each path must be an array of [x,y] points');
      const v = pl.map(q => Array.isArray(q) ? [q[0], q[1]] : q && typeof q === 'object' ? [q.x, q.y] : [NaN, NaN]);
      if (v.some(q => typeof q[0] !== 'number' || typeof q[1] !== 'number' || !isFinite(q[0]) || !isFinite(q[1]))) throw new FltBad('invalid parameters: path points must be [x,y] numbers');
      if (v.length) polys.push(v);
    }
    if (polys.length) return polys;
  }
  const name = typeof p.path === 'string' ? p.path : '';
  const wp = (typeof Doc !== 'undefined' && Doc.workPath) || null;
  if ((!name || name.toLowerCase() === 'work') && wp && Array.isArray(wp.subpaths)){
    const polys = wp.subpaths.map(sp => r2_flattenSubpath(sp, 0.5)).filter(v => v.length);
    if (polys.length) return polys;
  }
  return null;
}
/* photocraft_vector::flatten_path(path, 0.5) 的替代：锚点 {x,y,in:[x,y]?,out:[x,y]?} 的三次贝兹分段成折线（容差 tol） */
function r2_flattenSubpath(sp, tol){
  const A = (sp && sp.anchors) || [], v = [];
  if (!A.length) return v;
  v.push([A[0].x, A[0].y]);
  const seg = (p, q) => {
    if (!p.out && !q.in){ v.push([q.x, q.y]); return; }
    const c1 = p.out || [p.x, p.y], c2 = q.in || [q.x, q.y];
    const dd = Math.max(Math.hypot(p.x - 2 * c1[0] + c2[0], p.y - 2 * c1[1] + c2[1]), Math.hypot(c1[0] - 2 * c2[0] + q.x, c1[1] - 2 * c2[1] + q.y));
    const n = clamp(Math.ceil(Math.sqrt(0.75 * dd / tol)), 1, 256);
    for (let i = 1; i <= n; i++){
      const t = i / n, u = 1 - t;
      v.push([u * u * u * p.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q.x, u * u * u * p.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q.y]);
    }
  };
  for (let i = 1; i < A.length; i++) seg(A[i - 1], A[i]);
  if (sp.closed){ if (A.length > 1) seg(A[A.length - 1], A[0]); else v.push(v[0].slice()); }
  return v;
}

/* :87 draw：把图元画到目标层（一步历史由总档管）。
   新层：p.newLayer 或没有可画的像素层（总档传 L＝null）⇒ 新像素层，名字＝菜单名（去「…」），插在目前层上面（没有目前层＝最上面）。
   预览：直接画在 L 上不新建；L 为 null 就什么都不画。clip＝画布 ∩ 选区外框，按选区覆盖度合成 */
function r2_draw(L, p, opt, id, prims, extra){
  const wantNew = p.newLayer === true;
  let T = L, created = false;
  if (opt && opt.preview){
    if (!T) return Object.assign({layer:null, newLayer:false, bounds:null, primitives:prims.length}, extra);
  } else if (wantNew || !T){
    const A = Doc.active(), at = A ? Doc.index(A.id) + 1 : Doc.layers.length;
    T = Layer.raster(menuName(id));
    Doc.add(T, at);
    created = true;
  }
  const sel = selCoverage();
  let clip = R(0, 0, Doc.width, Doc.height);
  if (sel) clip = rInter(clip, sel.bounds);
  const surf = Surf.fromLayer(T);
  const used = r2_composite(surf, prims, clip, sel);
  surf.toLayer(T); Layer.invalidate(T);
  return Object.assign({layer:T.id, newLayer:created, bounds:rEmpty(used) ? null : [used.x0, used.y0, used.x1, used.y1], primitives:prims.length}, extra);
}
const r2_canvas = () => R(0, 0, Doc.width, Doc.height);           // :125 canvas

/* :129 run_flame（算图元的部分；画交给 r2_draw） */
function r2_flameSpec(p){
  const m = r2_normalized(p, ['color']);
  const use = typeof m.useCustomColor === 'boolean' ? m.useCustomColor : ('color' in m);
  if (!use) delete m.color;
  delete m.useCustomColor;
  if (typeof m.quality === 'number') m.quality = Math.trunc(clamp(m.quality, 0, 4)) || 0;
  else if (typeof m.quality === 'string'){ const i = R2_FLAME_QUALITY.indexOf(m.quality); m.quality = i < 0 ? 2 : i; }
  return r2_specFrom(m, R2_FLAME_SCHEMA, R2_FLAME_DEF);
}
function r2_runFlame(p, canvas){
  const spec = r2_flameSpec(p);
  const found = r2_flamePaths(p), usedPath = !!found;
  const paths = found || (spec.flameType === 'candleLight' ? [[[canvas.x0 + RW(canvas) * 0.5, canvas.y0 + RH(canvas) * 0.75]]] : [r2_defaultFlamePath(canvas)]);
  return {prims:r2_flame(spec, paths), extra:{usedPath}};
}
/* :156 run_tree */
function r2_treeSpec(p){
  const m = r2_normalized(p, ['leavesColor', 'branchesColor']);
  r2_indexParam(m, 'baseTreeType', r2_treeTypeNames());
  if ('leavesColor' in m && !('defaultLeaves' in m)) m.defaultLeaves = false;
  if ('branchesColor' in m && !('customBranchColor' in m)) m.customBranchColor = true;
  return r2_specFrom(m, R2_TREE_SCHEMA, R2_TREE_DEF);
}
function r2_runTree(p, canvas){
  const spec = r2_treeSpec(p);
  return {prims:r2_tree(spec, canvas), extra:{treeType:R2_TREES[clamp(spec.baseTreeType, 1, 34) - 1].name}};
}
/* :171 run_frame */
function r2_frameSpec(p){
  const m = r2_normalized(p, ['vineColor', 'flowerColor', 'leafColor']);
  r2_indexParam(m, 'frame', R2_FRAME_STYLES);
  return r2_specFrom(m, R2_FRAME_SCHEMA, R2_FRAME_DEF);
}
function r2_runFrame(p, canvas){
  const spec = r2_frameSpec(p);
  return {prims:r2_pictureFrame(spec, canvas), extra:{frame:R2_FRAME_STYLES[clamp(spec.frame, 1, R2_FRAME_STYLES.length) - 1]}};
}
const r2_op = (id, run) => (L, p, opt) => { p = p || {}; const {prims, extra} = run(p, r2_canvas()); return r2_draw(L, p, opt, id, prims, extra); };
SURF_OPS['filter.render.flame'] = r2_op('filter.render.flame', r2_runFlame);
SURF_OPS['filter.render.pictureFrame'] = r2_op('filter.render.pictureFrame', r2_runFrame);
SURF_OPS['filter.render.tree'] = r2_op('filter.render.tree', r2_runTree);

/* render_cmds.rs:185 specs 的 params 字串（原样） */
PARAM_SPECS['filter.render.flame'] = '{"flameType":"oneFlameAlongPath|multipleFlamesAlongPath|multipleFlamesPathDirections|multipleFlamesVariousLength|candleLight|multipleFlamesOneDirection","length":1..1000=150,"randomizeLength":bool,"width":1..1000=40,"angle":-180..180=0,"interval":1..1000=60,"adjustIntervalForLoops":bool=true,"useCustomColor":bool,"color":color,"turbulent":0..100=25,"jag":0..100=25,"opacity":0..100=75,"flameLines":1..100=20,"flameBottomAlignment":0..100=20,"flameStyle":"normal|violent|flat","flameShape":"parallel|toCenter|spread|oval|pointed","randomizeShapes":bool,"seed":u32=0,"quality":"draft|low|medium|high|fine","path":text,"newLayer":bool} → {layer,newLayer,bounds,primitives,usedPath}';
PARAM_SPECS['filter.render.pictureFrame'] = '{"frame":"vineWithFlowers|vineWithLeaves|ivy|roses|daisies|berries|bamboo|waves|zigzag|dots|rope|scallops|doubleLine|snowflakes|stars|hearts","margin":0..30=4,"size":1..100=50,"arrangement":1..100=50,"lines":1..5=1,"thickness":1..100=30,"fade":0..100=0,"vineColor":color,"flowerColor":color,"leafColor":color,"seed":u32=0,"newLayer":bool} → {layer,newLayer,bounds,primitives,frame}';
PARAM_SPECS['filter.render.tree'] = '{"baseTreeType":1..34=1,"lightDirection":1..5=3,"leavesAmount":0..100=50,"leavesSize":0..200=100,"branchesHeight":50..300=100,"branchesThickness":50..200=100,"defaultLeaves":bool=true,"leavesColor":color,"customBranchColor":bool,"branchesColor":color,"flatShading":bool,"seed":u32=0,"x":0..1=0.5,"y":0..1=0.95,"size":0.05..2=0.8,"newLayer":bool} → {layer,newLayer,bounds,primitives,treeType}';

/* ═══════════ 对话框（树种／框样式用下拉、颜色用色块；其余照参数表；三语照 PS 中文版） ═══════════ */
const R2_LBL = {
  flameType:S('火焰類型', '火焰类型', 'Flame Type'), length:S('長度', '长度', 'Length'), randomizeLength:S('隨機化長度', '随机化长度', 'Randomize Length'), width:S('寬度', '宽度', 'Width'),
  angle:S('角度', '角度', 'Angle'), interval:S('間隔', '间隔', 'Interval'), adjustIntervalForLoops:S('調整迴圈間隔', '为环形调整间隔', 'Adjust Interval for Loops'),
  useCustomColor:S('為火焰使用自訂顏色', '为火焰使用自定颜色', 'Use Custom Color for Flames'), color:S('顏色', '颜色', 'Color'), quality:S('品質', '品质', 'Quality'),
  advanced:S('進階', '高级', 'Advanced'), turbulent:S('擾流', '湍流', 'Turbulent'), jag:S('鋸齒', '锯齿', 'Jag'), opacity:S('不透明度', '不透明度', 'Opacity'),
  flameLines:S('火焰線條（複雜度）', '火焰线条（复杂性）', 'Flame Lines (Complexity)'), flameBottomAlignment:S('火焰底部對齊', '火焰底部对齐', 'Flame Bottom Alignment'),
  flameStyle:S('火焰樣式', '火焰样式', 'Flame Style'), flameShape:S('火焰形狀', '火焰形状', 'Flame Shape'), randomizeShapes:S('隨機化形狀', '随机形状', 'Randomize Shapes'),
  arrangement:S('排列', '排列', 'Arrangement'),
  baseTreeType:S('基本樹木類型', '基本树类型', 'Base Tree Type'), lightDirection:S('光源方向', '光照方向', 'Light Direction'), leavesAmount:S('樹葉數量', '叶子数量', 'Leaves Amount'),
  leavesSize:S('樹葉大小', '叶子大小', 'Leaves Size'), branchesHeight:S('樹枝高度', '树枝高度', 'Branches Height'), branchesThickness:S('樹枝粗細', '树枝粗细', 'Branches Thickness'),
  defaultLeaves:S('預設樹葉', '默认叶子', 'Default Leaves'), leavesColor:S('樹葉顏色', '叶子颜色', 'Leaves Color'), customBranchColor:S('為樹枝使用自訂顏色', '为树枝使用自定颜色', 'Use Custom Color for Branches'),
  branchesColor:S('樹枝顏色', '树枝颜色', 'Branches Color'), flatShading:S('平面著色', '平面着色', 'Flat Shading'), x:S('位置 X', '位置 X', 'Position X'), y:S('位置 Y', '位置 Y', 'Position Y'),
  size:S('大小', '大小', 'Size'), frame:S('圖案', '图案', 'Frame'), margin:S('邊界', '边距', 'Margin'), lines:S('線條數', '行数', 'Number of Lines'), thickness:S('粗細', '粗细', 'Thickness'),
  fade:S('淡化', '淡化', 'Fade'), vineColor:S('藤蔓顏色', '藤饰颜色', 'Vine Color'), flowerColor:S('花朵顏色', '花颜色', 'Flower Color'), leafColor:S('葉子顏色', '叶子颜色', 'Leaf Color'),
  seed:S('隨機種子', '随机种子', 'Seed'), newLayer:S('新增圖層', '新建图层', 'New Layer')
};
const R2_OPT = {
  oneFlameAlongPath:S('沿路徑一個火焰', '沿路径一个火焰', 'One Flame Along Path'), multipleFlamesAlongPath:S('沿路徑多個火焰', '沿路径多个火焰', 'Multiple Flames Along Path'),
  multipleFlamesPathDirections:S('沿路徑方向多個火焰', '沿路径方向多个火焰', 'Multiple Flames Path Directed'), multipleFlamesVariousLength:S('多個不同長度火焰', '多个不同长度火焰', 'Multiple Flames Various Length'),
  candleLight:S('燭光', '烛光', 'Candle Light'), multipleFlamesOneDirection:S('一個方向多個火焰', '一个方向多个火焰', 'Multiple Flames One Direction'),
  draft:S('草稿', '草图', 'Draft'), low:S('低', '低', 'Low'), medium:S('中', '中', 'Medium'), high:S('高', '高', 'High'), fine:S('精細', '精细', 'Fine'),
  normal:S('一般', '普通', 'Normal'), violent:S('劇烈', '猛烈', 'Violent'), flat:S('平坦', '扁平', 'Flat'),
  parallel:S('平行', '平行', 'Parallel'), toCenter:S('至中心', '集中', 'To Center'), spread:S('擴散', '散开', 'Spread'), oval:S('橢圓', '椭圆', 'Oval'), pointed:S('尖角', '尖角', 'Pointed'),
  vineWithFlowers:S('藤蔓與花朵', '藤蔓与花朵', 'Vine with Flowers'), vineWithLeaves:S('藤蔓與葉子', '藤蔓与叶子', 'Vine with Leaves'), ivy:S('常春藤', '常春藤', 'Ivy'), roses:S('玫瑰', '玫瑰', 'Roses'),
  daisies:S('雛菊', '雏菊', 'Daisies'), berries:S('漿果', '浆果', 'Berries'), bamboo:S('竹子', '竹子', 'Bamboo'), waves:S('波浪', '波浪', 'Waves'), zigzag:S('鋸齒', '锯齿', 'Zigzag'),
  dots:S('圓點', '圆点', 'Dots'), rope:S('繩索', '绳索', 'Rope'), scallops:S('扇貝邊', '扇贝边', 'Scallops'), doubleLine:S('雙線', '双线', 'Double Line'), snowflakes:S('雪花', '雪花', 'Snowflakes'),
  stars:S('星星', '星星', 'Stars'), hearts:S('愛心', '爱心', 'Hearts')
};
/* 树种（顺序＝R2_TREES；英文＝原码 name） */
const R2_TREE_I18N = [['橡樹', '橡树'], ['楓樹', '枫树'], ['松樹', '松树'], ['棕櫚樹', '棕榈树'], ['樺樹', '桦树'], ['垂柳', '垂柳'], ['櫻花', '樱花'], ['竹子', '竹子'], ['柏樹', '柏树'],
  ['猴麵包樹', '猴面包树'], ['銀杏', '银杏'], ['雲杉', '云杉'], ['冬季枯樹', '冬季枯树'], ['蘋果樹', '苹果树'], ['金合歡', '金合欢'], ['白楊', '白杨'], ['榆樹', '榆树'], ['木蘭', '木兰'],
  ['香蕉樹', '香蕉树'], ['盆景', '盆景'], ['藍花楹', '蓝花楹'], ['秋季楓樹', '秋季枫树'], ['金秋', '金秋'], ['橄欖樹', '橄榄树'], ['冷杉', '冷杉'], ['雪松', '雪松'], ['檸檬樹', '柠檬树'],
  ['紫藤', '紫藤'], ['幼樹', '幼树'], ['枯樹', '枯树'], ['椰子樹', '椰子树'], ['灌木', '灌木'], ['梅花', '梅花'], ['雲松', '云松']];
const r2_lbl = k => tr(R2_LBL[k]);
const r2_opt = k => R2_OPT[k] ? tr(R2_OPT[k]) : k;
const r2_treeName = i => { const z = R2_TREE_I18N[i]; return tr(S(z[0], z[1], R2_TREES[i].name)); };
const r2_hex = (c, d) => hexOf(r2_parseColour(c) || d);
/* 参数表里一栏的滑杆（步长同 buildSpecFields；整数栏给 step 1） */
function r2_slider(ui, id, v, k, unit, step){
  const f = parseSpec(specOf(id)).find(x => x.key === k), span = f.max - f.min;
  const st = step || (span <= 2 ? 0.01 : span <= 20 ? 0.1 : (Number.isInteger(f.min) && Number.isInteger(f.max) && Number.isInteger(f.d) ? 1 : 0.1));
  ui.slider({k, label:r2_lbl(k), min:f.min, max:f.max, step:st, log:f.min > 0 && f.max / f.min > 500, unit:unit || '', get:() => v[k], set:x => { v[k] = x; }});
}
function r2_seedRow(ui, v, label){
  ui.number({k:'seed', label, min:0, max:2147483647, step:1, get:() => v.seed, set:x => { v.seed = Math.max(0, Math.round(x)); },
    after:[ui.button(t('randomize'), () => { v.seed = Math.floor(Math.random() * 100000); Dlg.changed(true); }, 'seedRandom')]});
}
const r2_check = (ui, v, k, rebuild) => ui.check({k, label:r2_lbl(k), get:() => v[k], set:x => { v[k] = x; }, rebuild});
const r2_select = (ui, v, k, opts) => ui.select({k, label:r2_lbl(k), options:opts.map(o => [o, r2_opt(o)]), get:() => v[k], set:x => { v[k] = x; }});
const r2_color = (ui, v, k, disabled) => ui.color({k, label:r2_lbl(k), get:() => v[k], set:x => { v[k] = x; }, disabled});
/* 对话框初值：参数表预设 → 原码 Spec 的预设（颜色、品质）→ init（agent 给的栏位初值） */
function r2_dlgInit(id, mine, init){
  const v = Object.assign(specDefaults(id, {}), mine);
  delete v.path;
  Object.keys(init || {}).forEach(k => { if (init[k] !== undefined) v[k] = init[k]; });
  return v;
}

CUSTOM_DIALOGS['filter.render.flame'] = init => {
  const id = 'filter.render.flame', i0 = Object.assign({}, init);
  if (i0.color !== undefined) i0.color = r2_hex(i0.color, [1, 0.55, 0.1, 1]);
  if (typeof i0.quality === 'number') i0.quality = R2_FLAME_QUALITY[clamp(Math.trunc(i0.quality), 0, 4)];
  const v = r2_dlgInit(id, {quality:'medium', color:'#ff8c1a'}, i0);
  return Dlg.open({id, v, build(ui, v){
    r2_select(ui, v, 'flameType', R2_FLAME_TYPES);
    r2_slider(ui, id, v, 'length', 'px'); r2_check(ui, v, 'randomizeLength');
    r2_slider(ui, id, v, 'width', 'px'); r2_slider(ui, id, v, 'angle', '°');
    r2_slider(ui, id, v, 'interval', 'px'); r2_check(ui, v, 'adjustIntervalForLoops');
    r2_check(ui, v, 'useCustomColor', true); r2_color(ui, v, 'color', !v.useCustomColor);
    r2_select(ui, v, 'quality', R2_FLAME_QUALITY);
    ui.sec(r2_lbl('advanced'));
    r2_slider(ui, id, v, 'turbulent'); r2_slider(ui, id, v, 'jag'); r2_slider(ui, id, v, 'opacity', '%');
    r2_slider(ui, id, v, 'flameLines'); r2_slider(ui, id, v, 'flameBottomAlignment');
    r2_select(ui, v, 'flameStyle', R2_FLAME_STYLES); r2_select(ui, v, 'flameShape', R2_FLAME_SHAPES); r2_check(ui, v, 'randomizeShapes');
    r2_seedRow(ui, v, r2_lbl('arrangement'));
    r2_check(ui, v, 'newLayer');
  }, params:v => specParams(id, v)});
};

CUSTOM_DIALOGS['filter.render.tree'] = init => {
  const id = 'filter.render.tree', i0 = Object.assign({}, init);
  ['leavesColor', 'branchesColor'].forEach(k => { if (i0[k] !== undefined) i0[k] = r2_hex(i0[k], R2_TREE_DEF[k]); });
  if (typeof i0.baseTreeType === 'string'){ const m = {baseTreeType:i0.baseTreeType}; r2_indexParam(m, 'baseTreeType', r2_treeTypeNames()); i0.baseTreeType = m.baseTreeType; }
  const v = r2_dlgInit(id, {leavesColor:hexOf(R2_TREE_DEF.leavesColor), branchesColor:hexOf(R2_TREE_DEF.branchesColor)}, i0);
  return Dlg.open({id, v, build(ui, v){
    ui.select({k:'baseTreeType', label:r2_lbl('baseTreeType'), options:R2_TREES.map((_, i) => [i + 1, (i + 1) + ': ' + r2_treeName(i)]), get:() => v.baseTreeType, set:x => { v.baseTreeType = +x; }});
    r2_slider(ui, id, v, 'lightDirection', '', 1);
    r2_slider(ui, id, v, 'leavesAmount'); r2_slider(ui, id, v, 'leavesSize', '%');
    r2_slider(ui, id, v, 'branchesHeight', '%'); r2_slider(ui, id, v, 'branchesThickness', '%');
    r2_check(ui, v, 'defaultLeaves', true); r2_color(ui, v, 'leavesColor', !!v.defaultLeaves);
    r2_check(ui, v, 'customBranchColor', true); r2_color(ui, v, 'branchesColor', !v.customBranchColor);
    r2_check(ui, v, 'flatShading');
    r2_seedRow(ui, v, r2_lbl('arrangement'));
    r2_slider(ui, id, v, 'x'); r2_slider(ui, id, v, 'y'); r2_slider(ui, id, v, 'size');
    r2_check(ui, v, 'newLayer');
  }, params:v => specParams(id, v)});
};

CUSTOM_DIALOGS['filter.render.pictureFrame'] = init => {
  const id = 'filter.render.pictureFrame', i0 = Object.assign({}, init);
  ['vineColor', 'flowerColor', 'leafColor'].forEach(k => { if (i0[k] !== undefined) i0[k] = r2_hex(i0[k], R2_FRAME_DEF[k]); });
  if (typeof i0.frame === 'number') i0.frame = R2_FRAME_STYLES[clamp(Math.trunc(i0.frame), 1, R2_FRAME_STYLES.length) - 1];
  const v = r2_dlgInit(id, {vineColor:hexOf(R2_FRAME_DEF.vineColor), flowerColor:hexOf(R2_FRAME_DEF.flowerColor), leafColor:hexOf(R2_FRAME_DEF.leafColor)}, i0);
  return Dlg.open({id, v, build(ui, v){
    r2_select(ui, v, 'frame', R2_FRAME_STYLES);
    r2_slider(ui, id, v, 'margin', '%'); r2_slider(ui, id, v, 'size'); r2_slider(ui, id, v, 'arrangement');
    r2_slider(ui, id, v, 'lines', '', 1); r2_slider(ui, id, v, 'thickness'); r2_slider(ui, id, v, 'fade', '%');
    r2_color(ui, v, 'vineColor'); r2_color(ui, v, 'flowerColor'); r2_color(ui, v, 'leafColor');
    r2_seedRow(ui, v, r2_lbl('seed'));
    r2_check(ui, v, 'newLayer');
  }, params:v => specParams(id, v)});
};

/* ──────────────── 段：17-lens.js ──────────────── */
/* ═══════════ 滤镜 ▸ 镜头校正…／自适应广角…
   engine/src/lens_cmds.rs（参数、选区混回、命令回传）、algo/src/lens.rs（全档）、algo/src/wideangle.rs（全档）、
   algo/src/warp.rs:86 warp_triangles、algo/src/photo_util.rs:68 SparseLs／210 catmull_rom；对话框照 ui-egui/src/wide_angle_ui.rs。
   我们没有 EXIF：原码 camera_info() 一律当 None——profile:"auto" 只走「focalLength>0 就用通用描述档」的退路；自适应广角焦距 0 也不从 EXIF 补。
   我们只有 RGB＋alpha（8 位储存）：原码 CMYK／Lab／无 alpha 的分支不翻。 */
const LC_LENS = 'filter.lensCorrection', LC_WIDE = 'filter.adaptiveWideAngle';
/* lens_cmds.rs:29 bad（EngineError::BadParams 的显示字串 lib.rs:103） */
const lc_bad = (cmd, msg) => new FltBad('invalid parameters for `' + cmd + '`: ' + msg);
/* lens_cmds.rs:33 num：JSON 数字且有限才算，否则预设 */
const lc_num = (p, k, d) => { const v = p ? p[k] : undefined; return typeof v === 'number' && isFinite(v) ? v : d; };
/* lens_cmds.rs:37 flag */
const lc_flag = (p, k, d) => { const v = p ? p[k] : undefined; return typeof v === 'boolean' ? v : d; };
/* commands.rs:137 parse_hex（#RRGGBB／#RRGGBBAA；u8::from_str_radix 认前置 +） */
function lc_parseHex(s){
  s = s.replace(/^#+/, '');
  const b = i => { const t = s.slice(i, i + 2); return t.length === 2 && /^\+?[0-9a-fA-F]+$/.test(t) ? parseInt(t, 16) / 255 : null; };
  const q = s.length === 6 ? [b(0), b(2), b(4), 1] : s.length === 8 ? [b(0), b(2), b(4), b(6)] : null;
  return q && q.every(x => x !== null) ? q : null;
}
/* commands.rs:127 color_param */
function lc_colorParam(p, key, d){
  const v = p ? p[key] : undefined;
  if (Array.isArray(v) && v.length >= 3){ const a = v.map(x => typeof x === 'number' ? x : 0); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; }
  if (typeof v === 'string') return lc_parseHex(v) || d;
  return d;
}

/* ───────── lens.rs ───────── */
/* lens.rs:63 通用描述档表 (焦距, k1, k2, v1, v2) */
const LC_TABLE = [[12, -0.16, 0.04, -0.60, 0.15], [16, -0.11, 0.025, -0.50, 0.12], [24, -0.06, 0.012, -0.38, 0.08], [35, -0.025, 0.004, -0.28, 0.05],
  [50, 0, 0, -0.22, 0.04], [85, 0.012, 0, -0.16, 0.02], [200, 0.02, 0, -0.10, 0.01]];
/* Rust format!("{:.0}")：恰好 .5 时取偶（round-half-even） */
function lc_fmt0(v){ const f = Math.floor(v), d = v - f, r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); return String(r === 0 ? 0 : r); }
/* lens.rs:61 generic_profile：在 log 焦距上内插 */
function lc_genericProfile(f35){
  const T = LC_TABLE, f = clamp(f35, T[0][0], T[6][0]);
  let k = 5; for (let i = 0; i < 6; i++) if (f <= T[i + 1][0]){ k = i; break; }
  const a = T[k], b = T[k + 1], t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
  const l = (x, y) => x + (y - x) * t;
  return {name:'Generic Lens (' + lc_fmt0(f35) + ' mm equivalent)', k1:l(a[1], b[1]), k2:l(a[2], b[2]), p1:0, p2:0, vignette:[l(a[3], b[3]), l(a[4], b[4]), 0], caRed:0, caBlue:0};
}
const LC_PROFILE0 = {name:'', k1:0, k2:0, p1:0, p2:0, vignette:[0, 0, 0], caRed:0, caBlue:0};   // LensProfile::default
/* lens.rs:117 LensCorrection::default（edge：{t:'extension'|'transparency'|'color', c:[r,g,b,a]}） */
const lc_defaultLens = () => ({profile:null, correctDistortion:true, correctVignette:true, correctCA:true, distortion:0, redCyan:0, blueYellow:0,
  vignetteAmount:0, vignetteMidpoint:50, vertical:0, horizontal:0, angle:0, scale:100, edge:{t:'transparency'}});

/* lens.rs:149 LensMap：输出像素 → 取样位置。sample(x,y,o) 写进 o[0..7]＝p.x,p.y,pr.x,pr.y,pb.x,pb.y,gain，回 false＝梯形送到无穷远（None） */
class lc_LensMap {
  constructor(lc, frame){                                          // lens.rs:169
    this.c0 = (frame.x0 + frame.x1) / 2; this.c1 = (frame.y0 + frame.y1) / 2;
    this.r = Math.max(Math.hypot(frame.x1 - frame.x0, frame.y1 - frame.y0), 2) / 2;
    const prof = lc.profile || LC_PROFILE0;
    const d = lc.correctDistortion;
    // 梯形 x' = x / (1 + h x + g y)（以 r 正规化）；[[1,0,0],[0,1,0],[h,g,1]] 的逆是 [[1,0,0],[0,1,0],[-h,-g,1]]
    const g = -lc.vertical / 100 * 0.5, h = -lc.horizontal / 100 * 0.5;
    this.m6 = -h; this.m7 = -g; this.m8 = 1;
    const a = lc.angle * (Math.PI / 180);                            // f64::to_radians
    this.k1 = (d ? prof.k1 : 0) - lc.distortion / 100 * 0.25; this.k2 = d ? prof.k2 : 0; this.p1 = d ? prof.p1 : 0; this.p2 = d ? prof.p2 : 0;
    this.caR = (lc.correctCA ? prof.caRed : 0) - lc.redCyan * 4e-5;
    this.caB = (lc.correctCA ? prof.caBlue : 0) - lc.blueYellow * 4e-5;
    this.vig = lc.correctVignette ? prof.vignette : [0, 0, 0];
    this.vigAmount = lc.vignetteAmount / 100; this.vigMid = clamp(lc.vignetteMidpoint, 0, 100) / 100;
    this.sin = Math.sin(a); this.cos = Math.cos(a);
    this.scale = clamp(lc.scale / 100, 0.05, 20);
  }
  sample(x, y, o){                                                 // lens.rs:199
    const dx = (x - this.c0) / this.scale, dy = (y - this.c1) / this.scale, s = this.sin, co = this.cos;   // 先退缩放与旋转（绕中心）
    const rx = co * dx + s * dy, ry = -s * dx + co * dy;
    const nx = rx / this.r, ny = ry / this.r;                         // 退梯形
    const w = this.m6 * nx + this.m7 * ny + this.m8;
    if (w <= 0.05) return false;
    const ux = nx / w, uy = ny / w;
    const r2 = ux * ux + uy * uy, radial = 1 + this.k1 * r2 + this.k2 * r2 * r2;   // Brown–Conrady
    const sx = ux * radial + 2 * this.p1 * ux * uy + this.p2 * (r2 + 2 * ux * ux);
    const sy = uy * radial + this.p1 * (r2 + 2 * uy * uy) + 2 * this.p2 * ux * uy;
    const rs2 = sx * sx + sy * sy, v1 = this.vig[0], v2 = this.vig[1], v3 = this.vig[2];   // 暗角：依来源半径
    const falloff = Math.max(1 + v1 * rs2 + v2 * rs2 * rs2 + v3 * rs2 * rs2 * rs2, 0.05);
    const start = (1 - this.vigMid) * 0.9;
    const t = clamp((Math.sqrt(rs2) - start) / (1 - start + 1e-9), 0, 1), ramp = t * t * (3 - 2 * t);
    const gain = Math.pow(2, this.vigAmount * 1.5 * ramp) / falloff;
    const kr = 1 + this.caR, kb = 1 + this.caB;
    o[0] = this.c0 + sx * 1 * this.r; o[1] = this.c1 + sy * 1 * this.r;
    o[2] = this.c0 + sx * kr * this.r; o[3] = this.c1 + sy * kr * this.r;
    o[4] = this.c0 + sx * kb * this.r; o[5] = this.c1 + sy * kb * this.r;
    o[6] = gain;
    return true;
  }
}
/* lens.rs:231 auto_scale：最小的缩放（%）使校正后的图盖满整个画框 */
function lc_autoScale(lc, frame){
  const o = new Float64Array(7), x0 = frame.x0, y0 = frame.y0, x1 = frame.x1, y1 = frame.y1;
  const ok = (m, x, y) => m.sample(x, y, o) && o[0] >= x0 - 0.5 && o[0] <= x1 + 0.5 && o[1] >= y0 - 0.5 && o[1] <= y1 + 0.5;
  const covers = scale => {
    const m = new lc_LensMap(Object.assign({}, lc, {scale}), frame);
    for (let i = 0; i <= 40; i++){
      const t = i / 40;
      if (!ok(m, x0 + t * (x1 - x0), y0) || !ok(m, x0 + t * (x1 - x0), y1) || !ok(m, x0, y0 + t * (y1 - y0)) || !ok(m, x1, y0 + t * (y1 - y0))) return false;
    }
    return true;
  };
  if (covers(lc.scale)) return lc.scale;                             // 已盖满就不缩（不低于使用者的基准）
  let lo = lc.scale, hi = lc.scale;
  while (!covers(hi) && hi < 400) hi *= 1.25;
  for (let k = 0; k < 30; k++){ const mid = (lo + hi) / 2; if (covers(mid)) hi = mid; else lo = mid; }
  return hi;
}
/* lens.rs:259 straighten_angle：让 a→b 变水平或垂直（取近的那个）的角度 */
function lc_straightenAngle(a, b){
  const deg = Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI);
  const target = rround(deg / 90) * 90;
  return -(deg - target);
}

/* lens.rs:271 remap：逆映射重采样（双立方、预乘）；每 128 格一块算来源窗（窗＝本块所有取样点外框 −3／+4、夹进画框；窗空＝整块填边缘色，照原码） */
const LC_TILE = 128;
let lc_tileBuf = null, lc_tileOk = null;
function lc_remap(src, frame, outArea, edge, map){
  if (rEmpty(outArea) || rEmpty(frame)) return new Surf(0, 0, 0, 0);
  const T = LC_TILE;
  if (!lc_tileBuf){ lc_tileBuf = new Float64Array(T * T * 7); lc_tileOk = new Uint8Array(T * T); }
  const S = lc_tileBuf, OK = lc_tileOk, tmp = new Float64Array(7);
  const FW = frame.x1 - frame.x0, fx0 = frame.x0, fy0 = frame.y0, fx1 = frame.x1, fy1 = frame.y1;
  const buf = src.readRegion(frame); premultiply(buf, 4, true);       // 原码每块读窗；窗 ⊆ 画框，一次读整个画框等价
  const edgePx = edge.t === 'color' ? edge.c : [0, 0, 0, 0];
  const ext = edge.t === 'extension', isColor = edge.t === 'color';
  const OW = outArea.x1 - outArea.x0, out = new Surf(outArea.x0, outArea.y0, OW, outArea.y1 - outArea.y0), od = out.data;
  let wx0 = 0, wy0 = 0, wx1 = 0, wy1 = 0;
  const acc = new Float64Array(4), WK = new Float64Array(16), IK = new Int32Array(16);
  /* lens.rs:336 bicubic：像素中心在 +.5；位置夹进画框（边缘延伸），取样格夹进窗。先把 16 个权重（wx·wy）与格位算好，再按通道累加（同原码 j 外 i 内的顺序） */
  const prep = (px, py) => {
    let x = px - 0.5, y = py - 0.5;
    x = x < fx0 ? fx0 : x > fx1 - 1 ? fx1 - 1 : x; y = y < fy0 ? fy0 : y > fy1 - 1 ? fy1 - 1 : y;
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = x - xi, ty = y - yi, tx2 = tx * tx, tx3 = tx2 * tx, ty2 = ty * ty, ty3 = ty2 * ty;   // photo_util.rs:210 catmull_rom
    const ax0 = -0.5 * tx3 + tx2 - 0.5 * tx, ax1 = 1.5 * tx3 - 2.5 * tx2 + 1, ax2 = -1.5 * tx3 + 2 * tx2 + 0.5 * tx, ax3 = 0.5 * tx3 - 0.5 * tx2;
    const wl = wx0, wh = wx1 - 1, hl = wy0, hh = wy1 - 1;
    let xx = xi - 1; const xa = (xx < wl ? wl : xx > wh ? wh : xx) - fx0;
    xx = xi; const xb = (xx < wl ? wl : xx > wh ? wh : xx) - fx0;
    xx = xi + 1; const xc = (xx < wl ? wl : xx > wh ? wh : xx) - fx0;
    xx = xi + 2; const xd = (xx < wl ? wl : xx > wh ? wh : xx) - fx0;
    let k = 0;
    for (let j = 0; j < 4; j++, k += 4){
      const wy = j === 0 ? -0.5 * ty3 + ty2 - 0.5 * ty : j === 1 ? 1.5 * ty3 - 2.5 * ty2 + 1 : j === 2 ? -1.5 * ty3 + 2 * ty2 + 0.5 * ty : 0.5 * ty3 - 0.5 * ty2;
      let yy = yi + j - 1; yy = yy < hl ? hl : yy > hh ? hh : yy;
      const rowB = (yy - fy0) * FW;
      WK[k] = ax0 * wy; IK[k] = (rowB + xa) * 4; WK[k + 1] = ax1 * wy; IK[k + 1] = (rowB + xb) * 4;
      WK[k + 2] = ax2 * wy; IK[k + 2] = (rowB + xc) * 4; WK[k + 3] = ax3 * wy; IK[k + 3] = (rowB + xd) * 4;
    }
  };
  const bic4 = (px, py) => {
    prep(px, py);
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let k = 0; k < 16; k++){ const b = IK[k], w = WK[k]; a0 += w * buf[b]; a1 += w * buf[b + 1]; a2 += w * buf[b + 2]; a3 += w * buf[b + 3]; }
    acc[0] = a0; acc[1] = a1; acc[2] = a2; acc[3] = a3;
  };
  const bic1 = (px, py, c) => { prep(px, py); let a = 0; for (let k = 0; k < 16; k++) a += WK[k] * buf[IK[k] + c]; return a; };
  for (let ty = outArea.y0; ty < outArea.y1; ty += T) for (let tx = outArea.x0; tx < outArea.x1; tx += T){
    const tx1 = Math.min(tx + T, outArea.x1), ty1 = Math.min(ty + T, outArea.y1), tw = tx1 - tx, th = ty1 - ty, n = tw * th;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i < n; i++){
      if (!map(tx + (i % tw) + 0.5, ty + Math.floor(i / tw) + 0.5, tmp)){ OK[i] = 0; continue; }
      OK[i] = 1; const b = i * 7;
      for (let q = 0; q < 7; q++) S[b + q] = tmp[q];
      for (let q = 0; q < 6; q += 2){ const px = tmp[q], py = tmp[q + 1]; if (px < bx0) bx0 = px; if (py < by0) by0 = py; if (px > bx1) bx1 = px; if (py > by1) by1 = py; }
    }
    if (bx0 > bx1){ wx0 = wy0 = wx1 = wy1 = 0; }
    else {                                                          // (v as i32).clamp(frame)
      wx0 = clamp(Math.trunc(Math.floor(bx0) - 3), fx0, fx1); wy0 = clamp(Math.trunc(Math.floor(by0) - 3), fy0, fy1);
      wx1 = clamp(Math.trunc(Math.ceil(bx1) + 4), fx0, fx1); wy1 = clamp(Math.trunc(Math.ceil(by1) + 4), fy0, fy1);
    }
    const valid = wx1 - wx0 > 0 && wy1 - wy0 > 0;
    for (let i = 0; i < n; i++){
      const o = ((ty - outArea.y0 + Math.floor(i / tw)) * OW + (tx - outArea.x0 + i % tw)) * 4;
      if (!OK[i] || !valid){ od[o] = edgePx[0]; od[o + 1] = edgePx[1]; od[o + 2] = edgePx[2]; od[o + 3] = edgePx[3]; continue; }
      const b = i * 7, p0 = S[b], p1 = S[b + 1], pr0 = S[b + 2], pr1 = S[b + 3], pb0 = S[b + 4], pb1 = S[b + 5], g = S[b + 6];
      // 画框内的权重（1 格软边），边缘延伸除外
      const inside = ext ? 1 : clamp(Math.min(p0 - fx0, fx1 - p0) + 0.5, 0, 1) * clamp(Math.min(p1 - fy0, fy1 - p1) + 0.5, 0, 1);
      bic4(p0, p1);                                                   // 绿与 alpha 在 p；红在 pr、蓝在 pb（位置相同就共用这次的结果）
      const alpha = clamp(acc[3], 0, 1), pmG = acc[1];
      let pmR = acc[0], pmB = acc[2];
      if (pr0 !== p0 || pr1 !== p1) pmR = bic1(pr0, pr1, 0);
      if (pb0 !== p0 || pb1 !== p1) pmB = bic1(pb0, pb1, 2);
      const cR = clamp((alpha > 1e-6 ? pmR / alpha : 0) * g, 0, 1), cG = clamp((alpha > 1e-6 ? pmG / alpha : 0) * g, 0, 1), cB = clamp((alpha > 1e-6 ? pmB / alpha : 0) * g, 0, 1);
      if (isColor && inside < 1){                                     // 依外面的比例混向边缘色
        const ea = edgePx[3], oa = alpha * inside + ea * (1 - inside);
        od[o] = oa > 1e-6 ? (cR * alpha * inside + edgePx[0] * ea * (1 - inside)) / oa : 0;
        od[o + 1] = oa > 1e-6 ? (cG * alpha * inside + edgePx[1] * ea * (1 - inside)) / oa : 0;
        od[o + 2] = oa > 1e-6 ? (cB * alpha * inside + edgePx[2] * ea * (1 - inside)) / oa : 0;
        od[o + 3] = oa;
      } else { od[o] = cR; od[o + 1] = cG; od[o + 2] = cB; od[o + 3] = alpha * inside; }
    }
  }
  for (let k = 0; k < od.length; k++){ const x = od[k]; od[k] = x < 0 ? 0 : x > 1 ? 1 : x; }   // 8 位储存：写入即夹 0..1
  return out;
}
/* lens.rs:422 correct */
function lc_correct(src, frame, lc){
  const m = new lc_LensMap(lc, frame);
  return lc_remap(src, frame, frame, lc.edge, (x, y, o) => m.sample(x, y, o));
}

/* ───────── wideangle.rs ───────── */
const LC_MODELS = ['auto', 'fisheye', 'perspective', 'fullSpherical'], LC_ORIENTS = ['free', 'horizontal', 'vertical'];
const lc_dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];                                   // wideangle.rs:185
const lc_norm = v => { const l = Math.max(Math.sqrt(lc_dot(v, v)), 1e-300); return [v[0] / l, v[1] / l, v[2] / l]; };   // :188
/* wideangle.rs:91 Camera */
class lc_Camera {
  constructor(p, frame){                                           // :102 解 Auto 与焦距（35mm 等效 × 裁切 / 36mm 长边）
    const w = Math.max(frame.x1 - frame.x0, 1), h = Math.max(frame.y1 - frame.y0, 1);
    let f35 = p.focalLength * Math.max(p.cropFactor, 0.1), model = p.model;
    if (model === 'auto') model = Math.abs(w / h - 2) < 0.01 ? 'fullSpherical' : (f35 > 0 && f35 < 17) ? 'fisheye' : 'perspective';
    f35 = f35 > 0 ? f35 : model === 'fisheye' ? 12 : 24;
    this.model = model; this.f = f35 / 36 * Math.max(w, h);
    this.c = [(frame.x0 + frame.x1) / 2, (frame.y0 + frame.y1) / 2]; this.size = [w, h];
  }
  ray(x, y){                                                       // :128 影像像素 → 单位射线（x 右、y 下、z 前）
    const dx = x - this.c[0], dy = y - this.c[1];
    let v;
    if (this.model === 'fullSpherical'){ const lon = dx / this.size[0] * TAU, lat = dy / this.size[1] * Math.PI; v = [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)]; }
    else if (this.model === 'fisheye'){ const r = Math.hypot(dx, dy), th = r / this.f; v = r < 1e-12 ? [0, 0, 1] : [Math.sin(th) * dx / r, Math.sin(th) * dy / r, Math.cos(th)]; }
    else v = [dx, dy, this.f];
    return lc_norm(v);
  }
  pixel(d){                                                        // :147 单位射线 → 影像像素（null＝None）
    if (this.model === 'fullSpherical'){ const lon = Math.atan2(d[0], d[2]), lat = Math.asin(clamp(d[1], -1, 1)); return [this.c[0] + lon / TAU * this.size[0], this.c[1] + lat / Math.PI * this.size[1]]; }
    if (this.model === 'fisheye'){
      const th = Math.acos(clamp(d[2], -1, 1)), s = Math.hypot(d[0], d[1]);
      if (s < 1e-12) return [this.c[0], this.c[1]];
      return [this.c[0] + this.f * th * d[0] / s, this.c[1] + this.f * th * d[1] / s];
    }
    return d[2] > 1e-6 ? [this.c[0] + this.f * d[0] / d[2], this.c[1] + this.f * d[1] / d[2]] : null;
  }
  arc(a, b, n){                                                    // :167 a→b 景物直线（大圆）上的 n+1 个影像点
    const da = this.ray(a[0], a[1]), db = this.ray(b[0], b[1]), omega = Math.acos(clamp(lc_dot(da, db), -1, 1)), out = [];
    for (let k = 0; k <= n; k++){
      const t = k / n;
      let d;
      if (omega < 1e-9) d = da;
      else { const sa = Math.sin((1 - t) * omega) / Math.sin(omega), sb = Math.sin(t * omega) / Math.sin(omega); d = lc_norm([sa * da[0] + sb * db[0], sa * da[1] + sb * db[1], sa * da[2] + sb * db[2]]); }
      const q = this.pixel(d); if (q) out.push(q);
    }
    return out;
  }
}
/* photo_util.rs:68 SparseLs：min Σ w²(row·x − rhs)²，CGLS。row＝扁平 [i0,c0,i1,c1,…]（原码 Vec<(usize,f64)>；系数先乘 w） */
class lc_SparseLs {
  constructor(n){ this.n = n; this.idx = []; this.cof = []; this.start = [0]; this.rhs = []; }
  add(row, rhs, w){ for (let k = 0; k < row.length; k += 2){ this.idx.push(row[k]); this.cof.push(row[k + 1] * w); } this.start.push(this.idx.length); this.rhs.push(rhs * w); }
  rows(){ return this.rhs.length; }
  /* 退回前 m 列（原码每轮重建；形状列与锚定列每轮都一样，只换线条列——结果相同） */
  truncate(m){ this.rhs.length = m; this.start.length = m + 1; const e = this.start[m]; this.idx.length = e; this.cof.length = e; }
  solve(x0, iters){                                                // photo_util.rs:81
    const n = this.n, m = this.rhs.length, E = this.idx.length, idx = Int32Array.from(this.idx), cof = Float64Array.from(this.cof), st = Int32Array.from(this.start), b = this.rhs;
    const x = Float64Array.from(x0);
    /* Aᵀv：原码按列顺序散加 out[i] += c·v[r]；这里先建转置表（每个未知数的 (列, 系数) 照列顺序排），改成聚集——每个 out[i] 的加法顺序与原码相同、结果逐位一样，但快很多 */
    const tSt = new Int32Array(n + 1), tRow = new Int32Array(E), tCof = new Float64Array(E);
    for (let j = 0; j < E; j++) tSt[idx[j] + 1]++;
    for (let i = 0; i < n; i++) tSt[i + 1] += tSt[i];
    { const fill = tSt.slice(0, n); for (let r = 0; r < m; r++) for (let j = st[r], e = st[r + 1]; j < e; j++){ const k = fill[idx[j]]++; tRow[k] = r; tCof[k] = cof[j]; } }
    const ax = (v, out) => { for (let r = 0; r < m; r++){ let s = 0; for (let j = st[r], e = st[r + 1]; j < e; j++) s += cof[j] * v[idx[j]]; out[r] = s; } };
    const atv = (v, out) => { for (let i = 0; i < n; i++){ let s = 0; for (let k = tSt[i], e = tSt[i + 1]; k < e; k++) s += tCof[k] * v[tRow[k]]; out[i] = s; } };
    const r = new Float64Array(m), q = new Float64Array(m), s = new Float64Array(n);
    ax(x, r); for (let i = 0; i < m; i++) r[i] = b[i] - r[i];
    atv(r, s);
    const p = Float64Array.from(s);
    let gamma = 0; for (let i = 0; i < n; i++) gamma += s[i] * s[i];
    const g0 = Math.max(gamma, 1e-30);
    for (let it = 0; it < iters; it++){
      if (gamma <= g0 * 1e-20) break;
      ax(p, q);
      let qq = 0; for (let i = 0; i < m; i++) qq += q[i] * q[i];
      if (qq <= 1e-300) break;
      const alpha = gamma / qq;
      for (let i = 0; i < n; i++) x[i] += alpha * p[i];
      for (let i = 0; i < m; i++) r[i] -= alpha * q[i];
      atv(r, s);
      let g1 = 0; for (let i = 0; i < n; i++) g1 += s[i] * s[i];
      const beta = g1 / gamma; gamma = g1;
      for (let i = 0; i < n; i++) p[i] = s[i] + beta * p[i];
    }
    return x;
  }
}
/* wideangle.rs:207 WideMesh::triangles（每格两个） */
function lc_meshTriangles(mesh){
  const w1 = mesh.nx + 1, t = new Int32Array(mesh.nx * mesh.ny * 6); let k = 0;
  for (let j = 0; j < mesh.ny; j++) for (let i = 0; i < mesh.nx; i++){ const a = j * w1 + i; t[k++] = a; t[k++] = a + 1; t[k++] = a + w1 + 1; t[k++] = a; t[k++] = a + w1 + 1; t[k++] = a + w1; }
  return t;
}
/* wideangle.rs:221 WideMesh::map：来源点 p 的输出位置（格内双线性） */
function lc_meshMap(mesh, frame, p){
  const cw = (frame.x1 - frame.x0) / mesh.nx, ch = (frame.y1 - frame.y0) / mesh.ny;
  const gx = clamp((p[0] - frame.x0) / cw, 0, mesh.nx - 1e-9), gy = clamp((p[1] - frame.y0) / ch, 0, mesh.ny - 1e-9);
  const i = gx > 0 ? Math.floor(gx) : 0, j = gy > 0 ? Math.floor(gy) : 0, tx = gx - i, ty = gy - j, w1 = mesh.nx + 1, vo = mesh.vo;
  const a = 2 * (j * w1 + i), b = a + 2, c = a + 2 * w1, d = c + 2;
  return [(vo[a] * (1 - tx) + vo[b] * tx) * (1 - ty) + (vo[c] * (1 - tx) + vo[d] * tx) * ty,
    (vo[a + 1] * (1 - tx) + vo[b + 1] * tx) * (1 - ty) + (vo[c + 1] * (1 - tx) + vo[d + 1] * tx) * ty];
}
/* wideangle.rs:238 solve：内容保持网格变形（相似形状项＋弱锚定＋约束线项），回 {nx,ny,vo 输出位置,vs 来源位置（扁平 2×nv）,curves,residual} */
function lc_wideSolve(p, frame){
  const cam = new lc_Camera(p, frame);
  const fw = Math.max(frame.x1 - frame.x0, 1), fh = Math.max(frame.y1 - frame.y0, 1);
  const cells = 48, cell = Math.max(fw, fh) / cells;
  const nx = clamp(rround(fw / cell), 2, 96), ny = clamp(rround(fh / cell), 2, 96);
  const cw = fw / nx, ch = fh / ny, w1 = nx + 1, nv = w1 * (ny + 1);
  const src = new Float64Array(2 * nv);
  for (let k = 0; k < nv; k++){ src[2 * k] = frame.x0 + (k % w1) * cw; src[2 * k + 1] = frame.y0 + Math.floor(k / w1) * ch; }
  const curves = p.constraints.map(c => cam.arc(c.a, c.b, 24));
  let x = Float64Array.from(src);
  const weights = q => {                                            // 来源点在网格里的双线性权重
    const gx = clamp((q[0] - frame.x0) / cw, 0, nx - 1e-9), gy = clamp((q[1] - frame.y0) / ch, 0, ny - 1e-9);
    const i = gx > 0 ? Math.floor(gx) : 0, j = gy > 0 ? Math.floor(gy) : 0, tx = gx - i, ty = gy - j, a = j * w1 + i;   // (NaN as usize＝0)
    return [a, (1 - tx) * (1 - ty), a + 1, tx * (1 - ty), a + w1, (1 - tx) * ty, a + w1 + 1, tx * ty];
  };
  const active = []; for (let k = 0; k < curves.length; k++) if (curves[k].length >= 3) active.push(k);
  if (active.length){
    const tris = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
      const a = j * w1 + i;
      tris.push([a, a + 1, a + w1 + 1], [a, a + w1 + 1, a + w1], [a, a + 1, a + w1], [a + 1, a + w1 + 1, a + w1]);   // 两条对角线都放，形状项才对称
    }
    const ls = new lc_SparseLs(2 * nv);
    // 形状：v0 = v1 + u (v2 − v1) + v R90 (v2 − v1)，(u, v) 取自来源
    for (const t of tris) for (let rot = 0; rot < 3; rot++){
      const i0 = t[rot], i1 = t[(rot + 1) % 3], i2 = t[(rot + 2) % 3];
      const e0 = src[2 * i2] - src[2 * i1], e1 = src[2 * i2 + 1] - src[2 * i1 + 1], l2 = e0 * e0 + e1 * e1;
      const d0 = src[2 * i0] - src[2 * i1], d1 = src[2 * i0 + 1] - src[2 * i1 + 1];
      const u = (d0 * e0 + d1 * e1) / l2, v = (d0 * -e1 + d1 * e0) / l2;
      ls.add([2 * i0, 1, 2 * i1, -1 + u, 2 * i2, -u, 2 * i2 + 1, v, 2 * i1 + 1, -v], 0, 1);
      ls.add([2 * i0 + 1, 1, 2 * i1 + 1, -1 + u, 2 * i2 + 1, -u, 2 * i2, -v, 2 * i1, v], 0, 1);
    }
    for (let k = 0; k < nv; k++){ ls.add([2 * k, 1], src[2 * k], 0.02); ls.add([2 * k + 1, 1], src[2 * k + 1], 0.02); }   // 弱锚定（定住整体相似变换）
    const base = ls.rows();
    const normals = active.map(() => [0, 1]);
    for (let round = 0; round < 4; round++){
      ls.truncate(base);
      active.forEach((k, ci) => {                                   // 线条
        const c = curves[k], o = p.constraints[k].orientation;
        const n = o === 'horizontal' ? [0, 1] : o === 'vertical' ? [1, 0] : normals[ci];
        const w0 = weights(c[0]);
        for (let qi = 1; qi < c.length; qi++){
          const wq = weights(c[qi]), row = [];
          for (let e = 0; e < 8; e += 2){ row.push(2 * wq[e], n[0] * wq[e + 1], 2 * wq[e] + 1, n[1] * wq[e + 1]); }
          for (let e = 0; e < 8; e += 2){ row.push(2 * w0[e], -n[0] * w0[e + 1], 2 * w0[e] + 1, -n[1] * w0[e + 1]); }
          ls.add(row, 0, 10);
        }
      });
      x = ls.solve(x, 400 + 200 * round);
      const pos = q => { const w = weights(q); let a0 = 0, a1 = 0; for (let e = 0; e < 8; e += 2){ a0 += w[e + 1] * x[2 * w[e]]; a1 += w[e + 1] * x[2 * w[e] + 1]; } return [a0, a1]; };
      let changed = false;
      active.forEach((k, ci) => {                                   // 自由约束：用目前端点重估法向
        const c = curves[k], a = pos(c[0]), b = pos(c[c.length - 1]), d = [b[0] - a[0], b[1] - a[1]], l = Math.max(Math.hypot(d[0], d[1]), 1e-9);
        const nn = [-d[1] / l, d[0] / l];
        if (Math.abs(nn[0] - normals[ci][0]) + Math.abs(nn[1] - normals[ci][1]) > 1e-3) changed = true;
        normals[ci] = nn;
      });
      if (round === 0 && active.every(k => p.constraints[k].orientation !== 'free')) break;
      if (round > 0 && !changed) break;
    }
  }
  const s = clamp(p.scale / 100, 0.1, 10), c = cam.c, vo = new Float64Array(2 * nv);   // 绕中心缩放
  for (let k = 0; k < nv; k++){ vo[2 * k] = c[0] + (x[2 * k] - c[0]) * s; vo[2 * k + 1] = c[1] + (x[2 * k + 1] - c[1]) * s; }
  const mesh = {nx, ny, vo, vs:src, curves, residual:0};
  let worst = 0;                                                    // 直线度残差：曲线取样点离「映射后两端弦」的距离
  for (const cv of mesh.curves){
    if (cv.length < 3) continue;
    const pts = cv.map(q => lc_meshMap(mesh, frame, q)), a = pts[0], b = pts[pts.length - 1], d = [b[0] - a[0], b[1] - a[1]], l = Math.max(Math.hypot(d[0], d[1]), 1e-9);
    for (const q of pts) worst = Math.max(worst, Math.abs((q[0] - a[0]) * d[1] - (q[1] - a[1]) * d[0]) / l);
  }
  mesh.residual = worst;
  return mesh;
}

/* warp.rs:86 warp_triangles：贴图三角形光栅化（目的空间、重心内插来源位置；后画的三角形盖前面），再预乘取样（邻近／双线性／Catmull-Rom）
   原码按目的图块分工；三角形顺序与覆盖规则跟分块无关、来源窗 ⊇ 所有取样格，整块一次做等价 */
let lc_uvBuf = null;
function lc_warpTriangles(src, srcRect, vo, vs, tris, interp){
  if (rEmpty(srcRect) || !tris.length) return new Surf(0, 0, 0, 0);
  for (let k = 0; k < vo.length; k++) if (!isFinite(vo[k])) return new Surf(0, 0, 0, 0);
  const lim = 1 << 20;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < tris.length; k++){ const i = tris[k], X = vo[2 * i], Y = vo[2 * i + 1]; if (X < x0) x0 = X; if (Y < y0) y0 = Y; if (X > x1) x1 = X; if (Y > y1) y1 = Y; }
  const dst = R(Math.floor(Math.max(x0, -lim)) - 1, Math.floor(Math.max(y0, -lim)) - 1, Math.ceil(Math.min(x1, lim)) + 1, Math.ceil(Math.min(y1, lim)) + 1);
  const W = dst.x1 - dst.x0, H = dst.y1 - dst.y0, N = W * H;
  if (!lc_uvBuf || lc_uvBuf.length < 2 * N) lc_uvBuf = new Float64Array(2 * N);
  const uv = lc_uvBuf; uv.fill(NaN, 0, 2 * N);                      // 每个目的像素的来源位置（NaN＝没盖到）
  const eps = -1e-9;
  for (let k = 0; k < tris.length; k += 3){
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    const p0x = vo[2 * a], p0y = vo[2 * a + 1], p1x = vo[2 * b], p1y = vo[2 * b + 1], p2x = vo[2 * c], p2y = vo[2 * c + 1];
    const s0x = vs[2 * a], s0y = vs[2 * a + 1], s1x = vs[2 * b], s1y = vs[2 * b + 1], s2x = vs[2 * c], s2y = vs[2 * c + 1];
    const det = (p1x - p0x) * (p2y - p0y) - (p2x - p0x) * (p1y - p0y);
    if (Math.abs(det) < 1e-12) continue;
    const bx0 = Math.max(Math.floor(Math.min(p0x, p1x, p2x) - 0.5), dst.x0), by0 = Math.max(Math.floor(Math.min(p0y, p1y, p2y) - 0.5), dst.y0);
    const bx1 = Math.min(Math.ceil(Math.max(p0x, p1x, p2x) + 0.5), dst.x1), by1 = Math.min(Math.ceil(Math.max(p0y, p1y, p2y) + 0.5), dst.y1);
    for (let y = by0; y < by1; y++){
      const py = y + 0.5, row = (y - dst.y0) * W - dst.x0;
      for (let x = bx0; x < bx1; x++){
        const px = x + 0.5;
        const l1 = ((px - p0x) * (p2y - p0y) - (p2x - p0x) * (py - p0y)) / det;
        const l2 = ((p1x - p0x) * (py - p0y) - (px - p0x) * (p1y - p0y)) / det;
        const l0 = 1 - l1 - l2;
        if (l0 < eps || l1 < eps || l2 < eps) continue;
        const o = 2 * (row + x);
        uv[o] = l0 * s0x + l1 * s1x + l2 * s2x; uv[o + 1] = l0 * s0y + l1 * s1y + l2 * s2y;
      }
    }
  }
  const sp = src.readRegion(srcRect); premultiply(sp, 4, true);
  const SX0 = srcRect.x0, SY0 = srcRect.y0, SX1 = srcRect.x1, SY1 = srcRect.y1, SW = SX1 - SX0;
  const out = new Surf(dst.x0, dst.y0, W, H), od = out.data, acc = new Float64Array(4);
  const add = (ix, iy, k) => {                                      // at(x,y,c)·k：src_rect 外＝0
    if (ix < SX0 || iy < SY0 || ix >= SX1 || iy >= SY1) return;
    const b = ((iy - SY0) * SW + ix - SX0) * 4; acc[0] += sp[b] * k; acc[1] += sp[b + 1] * k; acc[2] += sp[b + 2] * k; acc[3] += sp[b + 3] * k;
  };
  const snap = t => Math.abs(t - Math.round(t)) < 1e-7 ? Math.round(t) : t;   // 贴近格点就对齐（恒等变换才会精确）
  const wx = new Float64Array(4), wy = new Float64Array(4);
  const cr = (t, w) => { const t2 = t * t, t3 = t2 * t; w[0] = -0.5 * t3 + t2 - 0.5 * t; w[1] = 1.5 * t3 - 2.5 * t2 + 1; w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t; w[3] = 0.5 * t3 - 0.5 * t2; };   // warp.rs:18
  for (let o = 0; o < N; o++){
    const qx = uv[2 * o]; if (qx !== qx) continue;
    let u = qx - 0.5, v = uv[2 * o + 1] - 0.5;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    if (interp === 'nearest') add(Math.floor(u + 0.5), Math.floor(v + 0.5), 1);
    else if (interp === 'bilinear'){
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      add(ix, iy, (1 - fx) * (1 - fy)); add(ix + 1, iy, fx * (1 - fy)); add(ix, iy + 1, (1 - fx) * fy); add(ix + 1, iy + 1, fx * fy);
    } else {
      u = snap(u); v = snap(v);
      const ix = Math.floor(u), iy = Math.floor(v); cr(u - ix, wx); cr(v - iy, wy);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++){ const k = wx[i] * wy[j]; if (k === 0) continue; add(ix - 1 + i, iy - 1 + j, k); }
    }
    const al = clamp(acc[3], 0, 1);
    if (al <= 1e-6) continue;                                       // 浮点杂讯别在透明格留颜色
    const b = o * 4;
    od[b] = clamp(acc[0] / al, 0, 1); od[b + 1] = clamp(acc[1] / al, 0, 1); od[b + 2] = clamp(acc[2] / al, 0, 1); od[b + 3] = al;
  }
  return out;
}
/* wideangle.rs:372 apply */
function lc_wideApply(src, frame, p, interp){
  const mesh = lc_wideSolve(p, frame);
  return lc_warpTriangles(src, frame, mesh.vo, mesh.vs, lc_meshTriangles(mesh), interp);
}
/* transform.rs:111 Interp::parse */
const lc_interp = s => (s === 'nearest' || s === 'nearestNeighbor') ? 'nearest' : s === 'bilinear' ? 'bilinear' : 'bicubic';

/* ───────── lens_cmds.rs ───────── */
/* lens_cmds.rs:44 lens_params（info＝None：我们没有 EXIF） */
function lc_lensParams(cmd, p, frame){
  const lc = Object.assign(lc_defaultLens(), {
    correctDistortion:lc_flag(p, 'correctDistortion', true), correctVignette:lc_flag(p, 'correctVignette', true), correctCA:lc_flag(p, 'correctCA', true),
    distortion:clamp(lc_num(p, 'distortion', 0), -100, 100), redCyan:clamp(lc_num(p, 'redCyan', 0), -100, 100), blueYellow:clamp(lc_num(p, 'blueYellow', 0), -100, 100),
    vignetteAmount:clamp(lc_num(p, 'vignetteAmount', 0), -100, 100), vignetteMidpoint:clamp(lc_num(p, 'vignetteMidpoint', 50), 0, 100),
    vertical:clamp(lc_num(p, 'vertical', 0), -100, 100), horizontal:clamp(lc_num(p, 'horizontal', 0), -100, 100),
    angle:lc_num(p, 'angle', 0), scale:clamp(lc_num(p, 'scale', 100), 50, 150)
  });
  const edge = typeof p.edge === 'string' ? p.edge : 'transparency';
  if (edge === 'transparency') lc.edge = {t:'transparency'};
  else if (edge === 'edgeExtension' || edge === 'extension') lc.edge = {t:'extension'};
  else if (edge === 'black') lc.edge = {t:'color', c:[0, 0, 0, 1]};
  else if (edge === 'white') lc.edge = {t:'color', c:[1, 1, 1, 1]};
  else if (edge === 'background' || edge === 'color') lc.edge = {t:'color', c:lc_colorParam(p, 'edgeColor', [0, 0, 0, 1])};
  else throw lc_bad(cmd, 'unknown edge `' + edge + '` (transparency|edgeExtension|black|white|color)');
  const focal = lc_num(p, 'focalLength', 0), prof = typeof p.profile === 'string' ? p.profile : 'none';
  if (prof === 'none' || prof === '') lc.profile = null;
  else if (prof === 'generic') lc.profile = lc_genericProfile(focal > 0 ? focal : 50);
  else if (prof === 'auto') lc.profile = focal > 0 ? lc_genericProfile(focal) : null;   // 原码先看 EXIF 的 35mm 等效焦距；我们没有 EXIF ⇒ 只剩这条退路
  else throw lc_bad(cmd, 'unknown profile `' + prof + '` (none|auto|generic)');
  if (Array.isArray(p.straighten)){
    const pt = v => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
    const a = pt(p.straighten[0]), b = pt(p.straighten[1]);
    if (!a || !b) throw lc_bad(cmd, '`straighten` is [[x0,y0],[x1,y1]]');
    lc.angle += lc_straightenAngle(a, b);
  }
  if (lc_flag(p, 'autoScale', false)) lc.scale = lc_autoScale(lc, frame);
  return lc;
}
/* lens_cmds.rs:89 resolved_lens_params：把解出来的描述档／角度／缩放写回参数 */
function lc_resolvedLensParams(p, lc){
  const q = JSON.parse(JSON.stringify(p || {}));
  delete q.straighten; delete q.autoScale; delete q.layer;
  q.angle = lc.angle; q.scale = lc.scale;
  if (lc.profile){
    q.profile = 'generic';
    const tok = lc.profile.name.replace(/^(Generic Lens \()+/, '').split(' ')[0];   // str::parse::<f64>（严格）
    q.focalLength = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok) ? Number(tok) : 50;
  } else q.profile = 'none';
  return q;
}
/* lens_cmds.rs:112 wide_params：照 serde（camelCase、缺的用预设、不认得的键略过；型别不对＝报错） */
function lc_wideParams(cmd, p){
  const hint = ' (constraints: [{"a":[x,y],"b":[x,y],"orientation":"free|horizontal|vertical"}])';
  const bad = m => lc_bad(cmd, 'bad params: ' + m + hint);
  const ty = v => v === null ? 'null' : Array.isArray(v) ? 'a sequence' : typeof v === 'object' ? 'a map' : typeof v === 'string' ? 'string "' + v + '"' : typeof v === 'boolean' ? 'boolean `' + v + '`' : typeof v === 'number' ? 'floating point `' + v + '`' : String(v);
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('invalid type: ' + ty(p) + ', expected struct WideAngle');
  const num = (k, d) => { const v = p[k]; if (v === undefined) return d; if (typeof v !== 'number' || !isFinite(v)) throw bad('invalid type: ' + ty(v) + ', expected f64'); return v; };
  const enm = (v, list, d) => { if (v === undefined) return d; if (typeof v !== 'string') throw bad('invalid type: ' + ty(v) + ', expected one of ' + list.map(s => '`' + s + '`').join(', ')); if (!list.includes(v)) throw bad('unknown variant `' + v + '`, expected one of ' + list.map(s => '`' + s + '`').join(', ')); return v; };
  const pt2 = v => {
    if (!Array.isArray(v)) throw bad('invalid type: ' + ty(v) + ', expected an array of length 2');
    if (v.length !== 2) throw bad('invalid length ' + v.length + ', expected an array of length 2');
    v.forEach(x => { if (typeof x !== 'number') throw bad('invalid type: ' + ty(x) + ', expected f64'); });
    return [v[0], v[1]];
  };
  const wa = {model:enm(p.model, LC_MODELS, 'auto'), focalLength:num('focalLength', 0), cropFactor:num('cropFactor', 1), scale:num('scale', 100), constraints:[]};
  if (p.constraints !== undefined){
    if (!Array.isArray(p.constraints)) throw bad('invalid type: ' + ty(p.constraints) + ', expected a sequence');
    wa.constraints = p.constraints.map(c => {
      if (Array.isArray(c)){                                        // serde 的结构也收序列形式 [a, b, orientation?]
        if (c.length < 2) throw bad('invalid length ' + c.length + ', expected struct Constraint with 3 elements');
        return {a:pt2(c[0]), b:pt2(c[1]), orientation:enm(c[2], LC_ORIENTS, 'free')};
      }
      if (!c || typeof c !== 'object') throw bad('invalid type: ' + ty(c) + ', expected struct Constraint');
      if (c.a === undefined) throw bad('missing field `a`');
      if (c.b === undefined) throw bad('missing field `b`');
      return {a:pt2(c.a), b:pt2(c.b), orientation:enm(c.orientation, LC_ORIENTS, 'free')};
    });
  }
  if (wa.constraints.some(c => c.a.concat(c.b).some(v => !isFinite(v)))) throw lc_bad(cmd, 'constraint points must be finite');
  wa.scale = clamp(wa.scale, 50, 150);
  wa.cropFactor = clamp(wa.cropFactor, 0.1, 10);
  // 焦距 ≤0 时原码用 EXIF 的焦距／35mm 等效补；我们没有 EXIF，留 0（Camera::new 再给预设）
  return wa;
}
const lc_waValue = wa => ({model:wa.model, focalLength:wa.focalLength, cropFactor:wa.cropFactor, scale:wa.scale,
  constraints:wa.constraints.map(c => ({a:c.a.slice(), b:c.b.slice(), orientation:c.orientation}))});   // serde 序列化（栏位顺序照结构）

/* lens_cmds.rs:180 mix_by_selection：按选区覆盖度把新像素混到旧像素上（预乘混合） */
function lc_mixBySelection(old, nw, sel){
  const area = rUnion(old.contentBounds(), nw.contentBounds());
  const out = nw.clone();
  if (rEmpty(area)) return out;
  const o = old.readRegion(area), w = nw.readRegion(area), aw = RW(area), r = new Float32Array(o.length);
  for (let i = 0, n = o.length / 4; i < n; i++){
    const k = clamp(sel.get(area.x0 + i % aw, area.y0 + Math.floor(i / aw)), 0, 1), b = i * 4;
    const oa = o[b + 3] + (w[b + 3] - o[b + 3]) * k;
    r[b + 3] = oa;
    for (let c = 0; c < 3; c++){ const pm = o[b + c] * o[b + 3] + (w[b + c] * w[b + 3] - o[b + c] * o[b + 3]) * k; r[b + c] = oa > 0 ? pm / oa : 0; }
  }
  out.writeRegion(area, r);
  return out;
}
/* lens_cmds.rs:275 背景层：边缘模式会露出透明时变成一般图层「图层 0」（PS 是这样；原码认 Background＋位置锁，我们照 ps-layer.js isBackground 的认法） */
function lc_floatBackground(L){
  const isBg = window.PsLayer && PsLayer.isBackground ? PsLayer.isBackground(L) : !!L.isBackground;
  if (!isBg) return;
  if (L.locks){ L.locks.position = false; L.locks.transparency = false; }
  L.isBackground = false;
  L.name = (typeof Lang !== 'undefined' && Lang.t ? Lang.t('layer.untitled') : 'Layer') + ' 0';
}
/* lens_cmds.rs:257 run_filter 的像素部分：整层（文件坐标）跑 f，有选区就按覆盖度混回；没选区＝整层换成结果（原码同） */
function lc_runFilter(L, floatBg, opt, f){
  const canvas = R(0, 0, Doc.width, Doc.height), sel = selCoverage();
  if (floatBg && !(opt && opt.preview)) lc_floatBackground(L);       // 预览不改图层名（取消时还原不了）
  const surf = Surf.fromLayer(L);
  const out = f(surf, canvas);
  const res = sel ? lc_mixBySelection(surf, out, sel) : out;
  res.toLayer(L); Layer.invalidate(L);
}
/* lens_cmds.rs:293 lens_correction */
SURF_OPS[LC_LENS] = (L, p, opt) => {
  p = p || {};
  const frame = R(0, 0, Doc.width, Doc.height);
  const lc = lc_lensParams(LC_LENS, p, frame);
  const stored = lc_resolvedLensParams(p, lc);
  const t0 = performance.now();
  lc_runFilter(L, lc.edge.t === 'transparency', opt, (surf, canvas) => lc_correct(surf, canvas, lc));
  return {ok:true, layer:L.id, profile:lc.profile ? lc.profile.name : null, angle:lc.angle, scale:lc.scale, params:stored, ms:performance.now() - t0};
};
/* lens_cmds.rs:305 adaptive_wide_angle（canvas＝frame，直接 warp_triangles） */
let lc_wideLast = null;                                             // 最近一次解出来的网格（对话框把约束线画到预览上用）
SURF_OPS[LC_WIDE] = (L, p, opt) => {
  p = p || {};
  const frame = R(0, 0, Doc.width, Doc.height);
  const wa = lc_wideParams(LC_WIDE, p);
  const t0 = performance.now();
  const mesh = lc_wideSolve(wa, frame), cam = new lc_Camera(wa, frame);
  const stored = lc_waValue(wa);
  // 预览照 wide_angle_ui.rs:75 用双线性（没指定 interpolation 时）；确定＝原码预设双立方
  const interp = lc_interp(typeof p.interpolation === 'string' ? p.interpolation : (opt && opt.preview ? 'bilinear' : 'bicubic'));
  lc_runFilter(L, true, opt, (surf, canvas) => lc_warpTriangles(surf, canvas, mesh.vo, mesh.vs, lc_meshTriangles(mesh), interp));
  lc_wideLast = {mesh, frame};
  return {ok:true, layer:L.id, model:cam.model, focalPx:cam.f, constraints:wa.constraints.length, curves:mesh.curves, residual:mesh.residual, params:stored, ms:performance.now() - t0};
};
/* lens_cmds.rs:376 LENS_DOC／:395 自适应广角 params（原样） */
PARAM_SPECS[LC_LENS] = '{"profile":"none|auto|generic","focalLength":mm=0,"correctDistortion":bool=true,"correctVignette":bool=true,"correctCA":bool=true,"autoScale":bool=false,"distortion":-100..100=0,"redCyan":-100..100=0,"blueYellow":-100..100=0,"vignetteAmount":-100..100=0,"vignetteMidpoint":0..100=50,"vertical":-100..100=0,"horizontal":-100..100=0,"angle":-180..180=0,"scale":50..150=100,"edge":"transparency|edgeExtension|black|white","straighten":[[x,y],[x,y]]?}';
PARAM_SPECS[LC_WIDE] = '{"model":"auto|fisheye|perspective|fullSpherical","focalLength":0..200=0,"cropFactor":0.1..10=1,"scale":50..150=100,"constraints":[{"a":[x,y],"b":[x,y],"orientation":"free|horizontal|vertical"}]}';

/* ───────── 对话框 ───────── */
/* 目前图层的缩图（画布范围 × sc；透明处棋盘格） */
function lc_thumb(L, sc, cw, ch){
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d');
  for (let yy = 0; yy < ch; yy += 8) for (let xx = 0; xx < cw; xx += 8){ x.fillStyle = ((xx + yy) / 8) % 2 ? '#3a3f47' : '#2a2e35'; x.fillRect(xx, yy, 8, 8); }
  const cv = L && L.kind === 'raster' && L.data && L.data.canvas;
  if (cv && cv.width && cv.height){ x.imageSmoothingQuality = 'high'; x.drawImage(cv, (L.x || 0) * sc, (L.y || 0) * sc, cv.width * sc, cv.height * sc); }
  return c;
}
function lc_fit(panel){                                              // 宽对话框里左边画面能用的大小
  const W = Doc.width, H = Doc.height;
  const aw = Math.max(200, (window.innerWidth || 1200) - 80 - 24 - panel - 16), ah = Math.max(150, (window.innerHeight || 800) - 80 - 120);
  const sc = Math.min(1, aw / W, ah / H);
  return {W, H, sc, cw:Math.max(1, Math.round(W * sc)), ch:Math.max(1, Math.round(H * sc))};
}
const LC_WSTR = {correction:S('校正', '校正', 'Correction'), auto:S('自動', '自动', 'Auto'), fisheye:S('魚眼', '鱼眼', 'Fisheye'), perspective:S('透視', '透视', 'Perspective'),
  fullSpherical:S('完整球面', '完整球面', 'Full Spherical'), scale:S('縮放', '缩放', 'Scale'), focal:S('焦距', '焦距', 'Focal Length'), crop:S('裁切係數', '裁剪因子', 'Crop Factor'),
  constraints:S('限制', '约束', 'Constraints'), free:S('不固定', '不固定', 'Free'), horizontal:S('水平', '水平', 'Horizontal'), vertical:S('垂直', '垂直', 'Vertical'), del:S('刪除', '删除', 'Delete'),
  hint:S('在影像上拖曳加入限制；放開時按住 Shift＝水平／垂直；在限制線上按右鍵刪除。', '在图像上拖动添加约束；松开时按住 Shift＝水平／垂直；在约束线上右键删除。', 'Drag on the image to add a constraint; Shift for horizontal/vertical; right-click to delete.'),
  straightness:S('直線度', '直线度', 'straightness')};
/* ui-egui/src/wide_angle_ui.rs：左边影像（拖曳画约束，Shift＝水平／垂直，右键删），右边校正模型／缩放／焦距／裁剪因子／约束清单 */
function lc_wideDialog(init){
  init = init || {};
  const {W, H, sc, cw, ch} = lc_fit(300), frame = R(0, 0, W, H);
  const num = (k, d) => typeof init[k] === 'number' && isFinite(init[k]) ? init[k] : d;
  const v = {model:LC_MODELS.includes(init.model) ? init.model : 'auto', focalLength:num('focalLength', 0), cropFactor:num('cropFactor', 1), scale:num('scale', 100), constraints:[]};
  if (Array.isArray(init.constraints)) init.constraints.forEach(c => { const pt = q => Array.isArray(q) && typeof q[0] === 'number' && typeof q[1] === 'number' ? [q[0], q[1]] : null;
    if (c && pt(c.a) && pt(c.b)) v.constraints.push({a:pt(c.a), b:pt(c.b), orientation:LC_ORIENTS.includes(c.orientation) ? c.orientation : 'free'}); });
  const st = {drag:null, after:null, mesh:null, info:null, hooked:false};
  const srcThumb = lc_thumb(Doc.active(), sc, cw, ch);
  let cv = null, infoEl = null;
  const params = () => lc_waValue(v);                                // wide_angle_ui.rs:88 command_params
  const colorOf = o => o === 'horizontal' ? '#e8c46a' : o === 'vertical' ? '#ff6b6b' : '#4aa3ff';
  const infoText = () => st.info ? (Math.round(st.info.ms) + ' ms · ' + tr(LC_WSTR.straightness) + ' ' + st.info.residual.toFixed(1) + ' px') : '';
  const draw = () => {
    if (!cv) return;
    const x = cv.getContext('2d'), showAfter = !!(Dlg.cur && Dlg.cur.previewOn && !st.drag && st.after);   // show_src＝!preview || 拖曳中
    x.clearRect(0, 0, cw, ch); x.drawImage(showAfter ? st.after : srcThumb, 0, 0);
    const cam = new lc_Camera(v, frame), D = q => [q[0] * sc, q[1] * sc];
    const line = (pts, color) => { if (!pts.length) return; x.strokeStyle = color; x.lineWidth = 2; x.beginPath(); pts.forEach((q, k) => { const d = D(q); k ? x.lineTo(d[0], d[1]) : x.moveTo(d[0], d[1]); }); x.stroke(); };
    v.constraints.forEach(c => {                                     // 原图上画弯的；校正后的预览上画映射后（应该是直的）
      let pts = cam.arc(c.a, c.b, 24);
      if (showAfter && st.mesh && v.constraints.length) pts = pts.map(q => lc_meshMap(st.mesh, frame, q));
      line(pts, colorOf(c.orientation));
      if (pts.length) [pts[0], pts[pts.length - 1]].forEach(q => { const d = D(q); x.fillStyle = colorOf(c.orientation); x.beginPath(); x.arc(d[0], d[1], 3.5, 0, TAU); x.fill(); });
    });
    if (st.drag) line(cam.arc(st.drag[0], st.drag[1], 24), 'rgba(74,163,255,.55)');
  };
  const docPt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / sc, (e.clientY - r.top) / sc]; };
  return Dlg.open({id:LC_WIDE, wide:true, v, state:st, params,
    build(ui, v, st){
      cv = ui.canvas(cw, ch, 'waCanvas'); cv.style.cursor = 'crosshair';
      cv.addEventListener('contextmenu', e => {                      // 右键：删曲线离点最近（<10 屏幕像素）的那条
        e.preventDefault();
        const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, cam = new lc_Camera(v, frame);
        let best = -1, bd = Infinity;
        v.constraints.forEach((c, i) => cam.arc(c.a, c.b, 24).forEach(q => { const d = Math.hypot(q[0] * sc - sx, q[1] * sc - sy); if (d < bd){ bd = d; best = i; } }));
        if (best >= 0 && bd < 10){ v.constraints.splice(best, 1); Dlg.changed(true); }
      });
      cv.addEventListener('pointerdown', e => { if (e.button !== 0) return; const p = docPt(e); st.drag = [p, p.slice()]; cv.setPointerCapture(e.pointerId); draw(); });
      cv.addEventListener('pointermove', e => { if (!st.drag) return; st.drag[1] = docPt(e); draw(); });
      const end = e => {
        if (!st.drag) return;
        const [a, b] = st.drag; st.drag = null;
        if (e.type === 'pointerup' && Math.hypot(a[0] - b[0], a[1] - b[1]) * sc > 6){
          const orientation = e.shiftKey ? (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'horizontal' : 'vertical') : 'free';
          v.constraints.push({a, b, orientation}); Dlg.changed(true);
        } else draw();
      };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      const right = el('div', {style:'min-width:300px;flex:0 0 300px'});
      ui.add(el('div', {style:'display:flex;gap:16px;align-items:flex-start'}, [cv, right]));
      const rui = makeUI(right, Dlg);
      rui.select({k:'model', label:tr(LC_WSTR.correction), options:LC_MODELS.map(m => [m, tr(LC_WSTR[m])]), get:() => v.model, set:x => { v.model = x; draw(); }});
      rui.slider({k:'scale', label:tr(LC_WSTR.scale), min:50, max:150, step:1, unit:'%', get:() => v.scale, set:x => { v.scale = x; }});
      rui.slider({k:'focalLength', label:tr(LC_WSTR.focal), min:0, max:200, step:0.1, unit:'mm', get:() => v.focalLength, set:x => { v.focalLength = x; draw(); }});
      rui.slider({k:'cropFactor', label:tr(LC_WSTR.crop), min:0.1, max:10, step:0.01, get:() => v.cropFactor, set:x => { v.cropFactor = x; draw(); }});
      rui.sec(tr(LC_WSTR.constraints) + '（' + v.constraints.length + '）');
      v.constraints.forEach((c, i) => {
        const row = rui.select({k:'waOrient' + i, label:String(i + 1), options:LC_ORIENTS.map(o => [o, tr(LC_WSTR[o])]), get:() => c.orientation, set:x => { c.orientation = x; }, rebuild:true});
        row.appendChild(rui.button(tr(LC_WSTR.del), () => { v.constraints.splice(i, 1); Dlg.changed(true); }, 'waDel' + i));
      });
      rui.note(tr(LC_WSTR.hint));
      infoEl = rui.note(infoText()); infoEl.dataset.k = 'waInfo';
      if (!st.hooked && Dlg.cur){                                    // 预览勾掉／勾回时画面跟着换（原图／校正后）
        const cb = Dlg.cur.ft.querySelector('[data-k="__preview"]');
        if (cb){ cb.addEventListener('change', () => draw()); st.hooked = true; }
      }
      draw();
    },
    onPreview(L, prm){                                               // 同 Dlg 预设（在目前像素层跑同一条命令），另外把结果缩图与直线度给画面
      st.info = SURF_OPS[LC_WIDE](L, prm, {preview:true});
      st.mesh = lc_wideLast && lc_wideLast.mesh;
      st.after = lc_thumb(L, sc, cw, ch);
      if (infoEl) infoEl.textContent = infoText();
      draw();
    }
  });
}
CUSTOM_DIALOGS[LC_WIDE] = lc_wideDialog;

/* 镜头校正：原码没有专用 UI（参数表自动生成）；这里照同一张参数表补中文正名与「拉直工具」（参数表里的 straighten 是 json、自动生成用不到） */
const LC_LSTR = {autoTab:S('自動校正', '自动校正', 'Auto Correction'), customTab:S('自訂', '自定', 'Custom'), profile:S('鏡頭描述檔', '镜头配置文件', 'Lens Profile'),
  none:S('無', '无', 'None'), auto:S('自動', '自动', 'Auto'), generic:S('通用鏡頭', '通用镜头', 'Generic Lens'), focal:S('焦距', '焦距', 'Focal Length'),
  correction:S('校正', '校正', 'Correction'), geo:S('幾何扭曲', '几何扭曲', 'Geometric Distortion'), ca:S('色差', '色差', 'Chromatic Aberration'), vig:S('暈映', '晕影', 'Vignette'),
  autoScale:S('自動縮放影像', '自动缩放图像', 'Auto Scale Image'), edge:S('邊緣', '边缘', 'Edge'), transparency:S('透明度', '透明度', 'Transparency'), edgeExtension:S('邊緣延伸', '边缘扩展', 'Edge Extension'),
  black:S('黑色', '黑色', 'Black Color'), white:S('白色', '白色', 'White Color'), remove:S('移除扭曲', '移去扭曲', 'Remove Distortion'),
  redCyan:S('修正紅/青色邊緣', '修复红/青边', 'Fix Red/Cyan Fringe'), blueYellow:S('修正藍/黃色邊緣', '修复蓝/黄边', 'Fix Blue/Yellow Fringe'),
  amount:S('總量', '数量', 'Amount'), mid:S('中點', '中点', 'Midpoint'), transform:S('變形', '变换', 'Transform'), vp:S('垂直透視', '垂直透视', 'Vertical Perspective'),
  hp:S('水平透視', '水平透视', 'Horizontal Perspective'), angle:S('角度', '角度', 'Angle'), scale:S('縮放', '比例', 'Scale'),
  straighten:S('拉直工具', '拉直工具', 'Straighten Tool'), hintSt:S('在影像上沿著應該水平或垂直的邊拖曳一條線（角度會加上這條線的校正）', '在图像上沿应该水平或垂直的边拖一条线（角度会加上这条线的校正）', 'Drag along an edge that should be horizontal or vertical (its correction is added to the angle)'),
  clearSt:S('清除拉直線', '清除拉直线', 'Clear Straighten Line')};
function lc_lensDialog(init){
  init = init || {};
  const {sc, cw, ch} = lc_fit(330);
  const v = specDefaults(LC_LENS, init);
  const pt = q => Array.isArray(q) && typeof q[0] === 'number' && typeof q[1] === 'number' ? [q[0], q[1]] : null;
  v.straighten = Array.isArray(init.straighten) && pt(init.straighten[0]) && pt(init.straighten[1]) ? [pt(init.straighten[0]), pt(init.straighten[1])] : null;
  const st = {drag:null};
  const srcThumb = lc_thumb(Doc.active(), sc, cw, ch);
  let cv = null;
  const draw = () => {
    if (!cv) return;
    const x = cv.getContext('2d'); x.clearRect(0, 0, cw, ch); x.drawImage(srcThumb, 0, 0);
    const seg = (l, color) => { x.strokeStyle = color; x.lineWidth = 2; x.beginPath(); x.moveTo(l[0][0] * sc, l[0][1] * sc); x.lineTo(l[1][0] * sc, l[1][1] * sc); x.stroke(); };
    if (v.straighten) seg(v.straighten, '#e8c46a');
    if (st.drag) seg(st.drag, 'rgba(74,163,255,.8)');
  };
  const docPt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / sc, (e.clientY - r.top) / sc]; };
  return Dlg.open({id:LC_LENS, wide:true, v, state:st,
    params:v => { const o = specParams(LC_LENS, v); if (v.straighten) o.straighten = v.straighten.map(q => q.slice()); else delete o.straighten; return o; },
    build(ui, v, st){
      const left = el('div', {style:'display:flex;flex-direction:column;gap:6px'});
      cv = ui.canvas(cw, ch, 'lcCanvas'); cv.style.cursor = 'crosshair';
      cv.addEventListener('pointerdown', e => { if (e.button !== 0) return; const p = docPt(e); st.drag = [p, p.slice()]; cv.setPointerCapture(e.pointerId); draw(); });
      cv.addEventListener('pointermove', e => { if (!st.drag) return; st.drag[1] = docPt(e); draw(); });
      const end = e => { if (!st.drag) return; const l = st.drag; st.drag = null;
        if (e.type === 'pointerup' && Math.hypot(l[0][0] - l[1][0], l[0][1] - l[1][1]) * sc > 4){ v.straighten = l; Dlg.changed(true); } else draw(); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      left.appendChild(cv);
      left.appendChild(el('div', {className:'note'}, [tr(LC_LSTR.straighten) + '：' + tr(LC_LSTR.hintSt) +
        (v.straighten ? '　' + (lc_straightenAngle(v.straighten[0], v.straighten[1]) >= 0 ? '+' : '') + lc_straightenAngle(v.straighten[0], v.straighten[1]).toFixed(2) + '°' : '')]));
      if (v.straighten){ const b = makeUI(left, Dlg).button(tr(LC_LSTR.clearSt), () => { v.straighten = null; Dlg.changed(true); }, 'lcClearStraighten'); left.appendChild(el('div', {className:'row'}, [b])); }
      const right = el('div', {style:'min-width:320px;flex:0 0 320px'});
      ui.add(el('div', {style:'display:flex;gap:16px;align-items:flex-start'}, [left, right]));
      const r = makeUI(right, Dlg), set = k => x => { v[k] = x; };
      const sl = (k, label, min, max, step, unit) => r.slider({k, label:tr(label), min, max, step, unit, get:() => v[k], set:set(k)});
      r.sec(tr(LC_LSTR.autoTab));
      r.select({k:'profile', label:tr(LC_LSTR.profile), options:['none', 'auto', 'generic'].map(o => [o, tr(LC_LSTR[o])]), get:() => v.profile, set:set('profile')});
      r.number({k:'focalLength', label:tr(LC_LSTR.focal), min:0, max:2000, step:1, get:() => v.focalLength, set:set('focalLength'), after:[el('span', {}, ['mm'])]});
      r.check({k:'correctDistortion', label:tr(LC_LSTR.geo), get:() => v.correctDistortion, set:set('correctDistortion')});
      r.check({k:'correctCA', label:tr(LC_LSTR.ca), get:() => v.correctCA, set:set('correctCA')});
      r.check({k:'correctVignette', label:tr(LC_LSTR.vig), get:() => v.correctVignette, set:set('correctVignette')});
      r.check({k:'autoScale', label:tr(LC_LSTR.autoScale), get:() => v.autoScale, set:set('autoScale')});
      r.select({k:'edge', label:tr(LC_LSTR.edge), options:['transparency', 'edgeExtension', 'black', 'white'].map(o => [o, tr(LC_LSTR[o])]), get:() => v.edge, set:set('edge')});
      r.sec(tr(LC_LSTR.customTab) + '：' + tr(LC_LSTR.geo));
      sl('distortion', LC_LSTR.remove, -100, 100, 1);
      r.sec(tr(LC_LSTR.ca));
      sl('redCyan', LC_LSTR.redCyan, -100, 100, 1); sl('blueYellow', LC_LSTR.blueYellow, -100, 100, 1);
      r.sec(tr(LC_LSTR.vig));
      sl('vignetteAmount', LC_LSTR.amount, -100, 100, 1); sl('vignetteMidpoint', LC_LSTR.mid, 0, 100, 1);
      r.sec(tr(LC_LSTR.transform));
      sl('vertical', LC_LSTR.vp, -100, 100, 1); sl('horizontal', LC_LSTR.hp, -100, 100, 1);
      sl('angle', LC_LSTR.angle, -180, 180, 0.1, '°'); sl('scale', LC_LSTR.scale, 50, 150, 1, '%');
      draw();
    }
  });
}
CUSTOM_DIALOGS[LC_LENS] = lc_lensDialog;

/* ──────────────── 段：18-cameraraw.js ──────────────── */
/* ═══════════ 滤镜 ▸ Camera Raw 滤镜…（filter.cameraRaw）
   对照源：algo/src/camera_raw.rs 1-999（整档：develop 管线、引导滤波、曲线、HSL、颜色分级、细节、晕影、颗粒）
           algo/src/photo_util.rs 177-207（hash01〔64 位，跟核心 noise.rs 的 hash01 不同〕、srgb_to_linear、linear_to_srgb、bilinear；par_rows／par_map 翻成普通回圈）
           algo/src/fxutil.rs:165 gauss_box_radii（＝核心 gaussBoxRadii）
           engine/src/lens_cmds.rs 136-211（raw_params、camera_raw_surface、mix_by_selection）、347-352（camera_raw_cmd）、405（params 字串）
           ui-egui/src/camera_raw_ui.rs 1-468（对话框：左预览、右分页滑杆、曲线编辑器、混色器三分页、颜色分级四色轮、效果；双击滑杆归零；Y＝之前／之后）
   我们只有 RGB 8 位：develop 的 float 参数恒 false（结尾夹 0..1）；灰阶分支不需要。 ═══════════ */

/* ── photo_util.rs ── */
const cr_srgbToLinear = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);          // photo_util.rs:187
const cr_linearToSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;       // photo_util.rs:192
/* photo_util.rs:197 bilinear：w×h×ch 缓冲第 c 通道的双线性取样，边缘夹住 */
function cr_bilinear(buf, w, h, ch, c, x, y){
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), tx = x - x0, ty = y - y0;
  const p00 = buf[(y0 * w + x0) * ch + c], p10 = buf[(y0 * w + x1) * ch + c], p01 = buf[(y1 * w + x0) * ch + c], p11 = buf[(y1 * w + x1) * ch + c];
  const top = p00 + (p10 - p00) * tx, bot = p01 + (p11 - p01) * tx;
  return top + (bot - top) * ty;
}
/* 64 位无号乘法（取低 64 位）：结果放 cr_mh（高 32）／cr_ml（低 32）——不配物件，颗粒每格要算 8 次 */
let cr_mh = 0, cr_ml = 0;
function cr_mul64(ah, al, bh, bl){
  const a0 = al & 0xffff, a1 = al >>> 16, b0 = bl & 0xffff, b1 = bl >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0;                // 各 < 2^32（双精度精确）
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  cr_ml = Math.imul(al, bl) >>> 0;
  cr_mh = (a1 * b1 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16) + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;
}
const cr_hi32 = v => (v >= 0 && v < 4294967296) ? 0 : Math.floor(v / 4294967296) >>> 0;   // i64／u64 → 高 32 位（负数＝二补数）
/* photo_util.rs:178 hash01(x:i64, y:i64, seed:u64) → [0,1)（SplitMix64 混合；跟核心 noise.rs 的 hash01 不同） */
function cr_hash01(x, y, seed){ cr_mul64(cr_hi32(seed), seed >>> 0, 0x165667B1, 0x9E3779F9); return cr_hashS(x, y, cr_mh, cr_ml); }
/* 同上，seed×常数先算好（sh:sl）——颗粒同一个 seed 要算几十万次 */
function cr_hashS(x, y, ssh, ssl){
  cr_mul64(cr_hi32(x), x >>> 0, 0x9E3779B9, 0x7F4A7C15); let zh = cr_mh, zl = cr_ml;
  cr_mul64(cr_hi32(y), y >>> 0, 0xC2B2AE3D, 0x27D4EB4F); zh ^= cr_mh; zl ^= cr_ml;
  return cr_hashMix((zh ^ ssh) >>> 0, (zl ^ ssl) >>> 0);
}
/* hash01 后半段：z（x·C1 ^ y·C2 ^ seed·C3）→ SplitMix 混合 → [0,1) */
function cr_hashMix(zh, zl){
  let sl = ((zl >>> 30) | (zh << 2)) >>> 0, sh = zh >>> 30; zl = (zl ^ sl) >>> 0; zh = (zh ^ sh) >>> 0;      // z ^= z >> 30
  cr_mul64(zh, zl, 0xBF58476D, 0x1CE4E5B9); zh = cr_mh; zl = cr_ml;
  sl = ((zl >>> 27) | (zh << 5)) >>> 0; sh = zh >>> 27; zl = (zl ^ sl) >>> 0; zh = (zh ^ sh) >>> 0;          // z ^= z >> 27
  cr_mul64(zh, zl, 0x94D049BB, 0x133111EB); zh = cr_mh;
  zh = (zh ^ (zh >>> 31)) >>> 0;                                   // z ^= z >> 31（低 32 位用不到）
  return (zh >>> 8) / 16777216;                                    // (z >> 40) / 2^24
}

/* ── camera_raw.rs ── */
const CR_HSL_BANDS = [0, 30, 60, 120, 180, 240, 270, 300];          // camera_raw.rs:176
const CR_U8F = Float32Array.from({length:256}, (_, k) => k / 255);  // Surf.fromLayer 读进来的 8 位值（存成 f32）
const cr_luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;   // camera_raw.rs:178（BT.709）
function cr_smoothstep(e0, e1, x){ const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }   // camera_raw.rs:182（没有 e1<=e0 的防呆，跟核心的不同）
/* Rust f32::rem_euclid（m>0）；|x|<m 时 x%m≡x，直接走捷径（浮点取余很慢，HSL 每格要好几次；结果逐位相同） */
const cr_remEuclid = (x, m) => { if (x >= 0 && x < m) return x; if (x < 0 && x > -m) return x + m; const r = x % m; return r < 0 ? r + Math.abs(m) : r; };
/* camera_raw.rs:189 box_mean：单通道盒状平均（半径 r，边缘夹住）；先列后行，f64 累加、存 f32 */
function cr_boxMean(v, w, h, r){
  if (r === 0 || w === 0 || h === 0) return Float32Array.from(v);
  const n = 2 * r + 1, tmp = new Float32Array(w * h), W1 = w - 1, H1 = h - 1;
  for (let y = 0; y < h; y++){
    const b = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += v[b + (k < 0 ? 0 : k > W1 ? W1 : k)];
    for (let x = 0; x < w; x++){
      tmp[b + x] = acc / n;
      const a = x + r + 1, s = x - r;
      acc += v[b + (a > W1 ? W1 : a)] - v[b + (s < 0 ? 0 : s)];
    }
  }
  const out = new Float32Array(w * h), acc = new Float64Array(w);   // 原码按 256 宽分带平行，各行各自独立，结果一样
  for (let yy = -r; yy <= r; yy++){ const ri = (yy < 0 ? 0 : yy > H1 ? H1 : yy) * w; for (let x = 0; x < w; x++) acc[x] += tmp[ri + x]; }
  for (let y = 0; y < h; y++){
    const o = y * w, ya = y + r + 1, ys = y - r, ai = (ya > H1 ? H1 : ya) * w, si = (ys < 0 ? 0 : ys) * w;
    for (let x = 0; x < w; x++){ out[o + x] = acc[x] / n; acc[x] += Math.fround(tmp[ai + x] - tmp[si + x]); }   // (*p - *m) 是 f32 相减
  }
  return out;
}
/* camera_raw.rs:239 gauss：三次盒状近似高斯 */
function cr_gauss(v, w, h, sigma){
  if (sigma < 0.3) return Float32Array.from(v);
  let out = Float32Array.from(v);
  for (const r of gaussBoxRadii(sigma)) out = cr_boxMean(out, w, h, r);
  return out;
}
/* camera_raw.rs:297 guided：引导滤波（He 等 2010） */
function cr_guided(I, P, w, h, r, eps){
  const N = w * h, mi = cr_boxMean(I, w, h, r), mp = cr_boxMean(P, w, h, r), ip = new Float32Array(N), ii = new Float32Array(N);
  for (let k = 0; k < N; k++){ ip[k] = I[k] * P[k]; ii[k] = I[k] * I[k]; }
  const mip = cr_boxMean(ip, w, h, r), mii = cr_boxMean(ii, w, h, r), a = new Float32Array(N), b = new Float32Array(N);
  for (let k = 0; k < N; k++){ a[k] = (mip[k] - mi[k] * mp[k]) / (mii[k] - mi[k] * mi[k] + eps); b[k] = mp[k] - a[k] * mi[k]; }
  const ma = cr_boxMean(a, w, h, r), mb = cr_boxMean(b, w, h, r), out = new Float32Array(N);
  for (let k = 0; k < N; k++) out[k] = ma[k] * I[k] + mb[k];
  return out;
}
/* camera_raw.rs:253 guided_fast：系数在 s× 缩小副本上算、双线性放大（Fast Guided Filter） */
function cr_guidedFast(I, P, w, h, r, eps){
  const s = clamp(Math.floor(r / 8), 1, 8);
  if (s === 1) return cr_guided(I, P, w, h, r, eps);
  const sw = Math.ceil(w / s), sh = Math.ceil(h / s), SN = sw * sh;
  const down = v => {
    const o = new Float32Array(SN), c = new Float32Array(SN);        // f32 累加（跟原码同）
    for (let y = 0; y < h; y++){ const row = ((y / s) | 0) * sw; for (let x = 0; x < w; x++){ const k = row + ((x / s) | 0); o[k] += v[y * w + x]; c[k] += 1; } }
    for (let k = 0; k < SN; k++) o[k] = o[k] / Math.max(c[k], 1);
    return o;
  };
  const si = down(I), sp = down(P), rs = Math.max(Math.floor(r / s), 1);
  const mi = cr_boxMean(si, sw, sh, rs), mp = cr_boxMean(sp, sw, sh, rs), ip = new Float32Array(SN), ii = new Float32Array(SN);
  for (let k = 0; k < SN; k++){ ip[k] = si[k] * sp[k]; ii[k] = si[k] * si[k]; }
  const mip = cr_boxMean(ip, sw, sh, rs), mii = cr_boxMean(ii, sw, sh, rs), a = new Float32Array(SN), b = new Float32Array(SN);
  for (let k = 0; k < SN; k++){ a[k] = (mip[k] - mi[k] * mp[k]) / (mii[k] - mi[k] * mi[k] + eps); b[k] = mp[k] - a[k] * mi[k]; }
  const ma = cr_boxMean(a, sw, sh, rs), mb = cr_boxMean(b, sw, sh, rs), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++){
    const fy = (y + 0.5) / s - 0.5;
    for (let x = 0; x < w; x++){
      const fx = (x + 0.5) / s - 0.5;
      out[y * w + x] = cr_bilinear(ma, sw, sh, 1, 0, fx, fy) * I[y * w + x] + cr_bilinear(mb, sw, sh, 1, 0, fx, fy);
    }
  }
  return out;
}
/* camera_raw.rs:312 curve_lut：单调三次（Fritsch–Carlson）穿过 pts（0..255），取 n 格查表 */
function cr_curveLut(pts, n){
  const p0 = pts.map(q => [q[0] / 255, q[1] / 255]).sort((a, b) => a[0] - b[0]);   // 稳定排序（同 sort_by）
  const p = [];
  for (const q of p0) if (!p.length || Math.abs(q[0] - p[p.length - 1][0]) >= 1e-6) p.push(q);   // dedup_by：跟上一个留下的比
  const lut = new Float32Array(n);
  if (p.length < 2){ for (let i = 0; i < n; i++) lut[i] = i / (n - 1); return lut; }
  const m = p.length, d = [], t = new Array(m).fill(0);
  for (let k = 0; k < m - 1; k++) d.push((p[k + 1][1] - p[k][1]) / Math.max(p[k + 1][0] - p[k][0], 1e-6));
  t[0] = d[0]; t[m - 1] = d[m - 2];
  for (let k = 1; k < m - 1; k++) t[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < m - 1; k++){
    if (d[k] === 0){ t[k] = 0; t[k + 1] = 0; continue; }
    const a = t[k] / d[k], b = t[k + 1] / d[k], s = a * a + b * b;
    if (s > 9){ const tau = 3 / Math.sqrt(s); t[k] = tau * a * d[k]; t[k + 1] = tau * b * d[k]; }
  }
  for (let i = 0; i < n; i++){
    const x = i / (n - 1);
    if (x <= p[0][0]){ lut[i] = p[0][1]; continue; }
    if (x >= p[m - 1][0]){ lut[i] = p[m - 1][1]; continue; }
    let k = m - 2; for (let j = 0; j < m - 1; j++) if (x <= p[j + 1][0]){ k = j; break; }
    const hh = p[k + 1][0] - p[k][0], s = (x - p[k][0]) / hh;
    const h00 = 2 * s * s * s - 3 * s * s + 1, h10 = s * s * s - 2 * s * s + s, h01 = -2 * s * s * s + 3 * s * s, h11 = s * s * s - s * s;
    lut[i] = clamp(h00 * p[k][1] + h10 * hh * t[k] + h01 * p[k + 1][1] + h11 * hh * t[k + 1], 0, 1);
  }
  return lut;
}
/* camera_raw.rs:359 lut_eval（0..1 外线性外插） */
function cr_lutEval(lut, v){
  const n = lut.length;
  if (!(v >= 0 && v <= 1)) return v < 0 ? v + lut[0] : lut[n - 1] + (v - 1);
  const x = v * (n - 1), i = Math.min(Math.floor(x), n - 2), t = x - i;
  return lut[i] + (lut[i + 1] - lut[i]) * t;
}
/* camera_raw.rs:372 parametric_lut：四区（阴影／暗调／亮调／高光）参数曲线 */
function cr_parametricLut(p, n){
  const s = p.curveSplits.map(v => clamp(v, 5, 95) / 100);
  const centres = [s[0] / 2, (s[0] + s[1]) / 2, (s[1] + s[2]) / 2, (s[2] + 1) / 2];
  const amounts = [p.curveShadows, p.curveDarks, p.curveLights, p.curveHighlights];
  const widths = [Math.max(s[0], 0.1), Math.max(s[1] - s[0], 0.1), Math.max(s[2] - s[1], 0.1), Math.max(1 - s[2], 0.1)];
  const lut = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const x = i / (n - 1); let y = x;
    for (let k = 0; k < 4; k++){ const d = (x - centres[k]) / (widths[k] * 1.2), bump = Math.exp(-d * d * 2) * x * (1 - x) * 4; y += amounts[k] / 100 * 0.25 * bump; }
    lut[i] = clamp(y, 0, 1);
  }
  for (let i = 1; i < n; i++) lut[i] = Math.max(lut[i], lut[i - 1]);   // 保持单调
  return lut;
}
/* camera_raw.rs:396 rgb_to_hsv → cr_hsv[0..2]（不配阵列） */
const cr_hsv = new Float64Array(3), cr_rgb = new Float64Array(3);
function cr_rgbToHsv(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  cr_hsv[0] = d <= 1e-9 ? 0 : mx === r ? 60 * cr_remEuclid((g - b) / d, 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  cr_hsv[1] = mx > 1e-9 ? d / mx : 0; cr_hsv[2] = mx;
}
/* camera_raw.rs:411 hsv_to_rgb → cr_rgb[0..2] */
function cr_hsvToRgb(h, s, v){
  h = cr_remEuclid(h, 360) / 60;
  const h2 = h < 2 ? h : h < 4 ? h - 2 : h < 6 ? h - 4 : h % 2;   // ＝h % 2（0≤h<6 时减法精确，Sterbenz）
  const c = v * s, x = c * (1 - Math.abs(h2 - 1)), m = v - c;
  let r, g, b; switch (Math.trunc(h)){ case 0: r = c; g = x; b = 0; break; case 1: r = x; g = c; b = 0; break; case 2: r = 0; g = c; b = x; break;
    case 3: r = 0; g = x; b = c; break; case 4: r = x; g = 0; b = c; break; default: r = c; g = 0; b = x; }
  cr_rgb[0] = r + m; cr_rgb[1] = g + m; cr_rgb[2] = b + m;
}
/* camera_raw.rs:428 band_weights：八个色带在色相 h 的权重（相邻中心间的帽形函数）；写进 out（长 8） */
const CR_SPAN_NEXT = CR_HSL_BANDS.map((c, k) => cr_remEuclid(CR_HSL_BANDS[(k + 1) % 8] - c, 360));   // 只跟色带有关的常数先算好
const CR_SPAN_PREV = CR_HSL_BANDS.map((c, k) => cr_remEuclid(c - CR_HSL_BANDS[(k + 7) % 8], 360));
function cr_bandWeight(h, k){
  const c = CR_HSL_BANDS[k], t = h - c + 540;
  const tm = t >= 0 && t < 360 ? t : t >= 360 && t < 720 ? t - 360 : t >= 720 && t < 1080 ? t - 720 : t % 360;   // ＝t % 360（减法精确）
  const diff = tm - 180, span = diff >= 0 ? CR_SPAN_NEXT[k] : CR_SPAN_PREV[k];
  return Math.max(1 - Math.abs(diff) / Math.max(span, 1e-3), 0);
}
function cr_bandWeights(h, out){ for (let k = 0; k < 8; k++) out[k] = cr_bandWeight(h, k); return out; }
/* camera_raw.rs:439-476 各组是否中性 */
const cr_isLinear = c => c.length < 2 || c.every(q => Math.abs(q[0] - q[1]) < 1e-3);
const cr_wheelNeutral = wh => wh.sat === 0 && wh.lum === 0;
const cr_wbNeutral = p => p.temperature === 0 && p.tint === 0 && p.exposure === 0;
const cr_toneNeutral = p => [p.contrast, p.highlights, p.shadows, p.whites, p.blacks, p.texture, p.clarity].every(v => v === 0);
const cr_hslNeutral = p => p.hslHue.concat(p.hslSat, p.hslLum).every(v => v === 0);
const cr_gradeNeutral = p => cr_wheelNeutral(p.gradeShadows) && cr_wheelNeutral(p.gradeMidtones) && cr_wheelNeutral(p.gradeHighlights) && cr_wheelNeutral(p.gradeGlobal);
const cr_curvesNeutral = p => [p.curveHighlights, p.curveLights, p.curveDarks, p.curveShadows].every(v => v === 0) && [p.pointCurve, p.pointCurveRed, p.pointCurveGreen, p.pointCurveBlue].every(cr_isLinear);
const cr_calNeutral = p => [p.calShadowTint, p.calRedHue, p.calRedSat, p.calGreenHue, p.calGreenSat, p.calBlueHue, p.calBlueSat].every(v => !v);
function cr_isIdentity(p){                                         // camera_raw.rs:457
  return cr_calNeutral(p) && cr_wbNeutral(p) &&cr_toneNeutral(p) && p.dehaze === 0 && p.vibrance === 0 && p.saturation === 0 && cr_curvesNeutral(p) && cr_hslNeutral(p) && cr_gradeNeutral(p)
    && p.sharpenAmount === 0 && p.noiseLuminance === 0 && p.noiseColor === 0 && p.grainAmount === 0 && p.vignetteAmount === 0
    && !(p.defringePurpleAmount > 0) && !(p.defringeGreenAmount > 0);   // 照 PS 补：光学 ▸ 去边（在 develop 里）
}

/* 照 PS 补（原码没有）：校准面板＝相机描述档那一层，在白平衡之前、线性光里做。
   红／绿／蓝原色各自的「色相」把该原色往色环两边转（红＋＝往橙黄、−＝往洋红；绿＋＝往青、−＝往黄；蓝＋＝往紫、−＝往青），±100 ≈ ±30°；
   「饱和度」把该原色往灰拉／推离灰。新原色当 3×3 矩阵的栏，再按列正规化让白（1,1,1）还是白——中性灰不变，只动有色彩的地方。
   阴影「色调」：−＝暗部偏绿、＋＝暗部偏洋红。 */
function cr_calibrate(px, N, p){
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  [[0, p.calRedHue, p.calRedSat], [120, p.calGreenHue, p.calGreenSat], [240, p.calBlueHue, p.calBlueSat]].forEach(([h0, dh, ds], c) => {
    cr_hsvToRgb(h0 + (dh || 0) / 100 * 30, 1, 1);
    const m = (cr_rgb[0] + cr_rgb[1] + cr_rgb[2]) / 3, k = Math.max(1 + (ds || 0) / 100 * 0.6, 0);
    for (let r = 0; r < 3; r++) M[r][c] = m + (cr_rgb[r] - m) * k;
  });
  for (let r = 0; r < 3; r++){ const s = M[r][0] + M[r][1] + M[r][2]; if (s > 1e-6) for (let c = 0; c < 3; c++) M[r][c] /= s; }
  const tint = (p.calShadowTint || 0) / 100;
  const lin = v => { const k = Math.round(v * 255); return (k >= 0 && k <= 255 && CR_U8F[k] === v) ? CR_LIN8[k] : cr_srgbToLinear(v > 0 ? v : 0); };
  for (let o = 0; o < N * 4; o += 4){
    const r0 = lin(px[o]), g0 = lin(px[o + 1]), b0 = lin(px[o + 2]);
    let r = M[0][0] * r0 + M[0][1] * g0 + M[0][2] * b0, g = M[1][0] * r0 + M[1][1] * g0 + M[1][2] * b0, b = M[2][0] * r0 + M[2][1] * g0 + M[2][2] * b0;
    if (tint){
      const sm = 1 - cr_smoothstep(0.03, 0.4, cr_luma(px[o], px[o + 1], px[o + 2])), f = Math.pow(2, -tint * 0.6 * sm), q = 1 / Math.sqrt(f);
      g *= f; r *= q; b *= q;
    }
    px[o] = cr_linearToSrgb(r > 0 ? r : 0); px[o + 1] = cr_linearToSrgb(g > 0 ? g : 0); px[o + 2] = cr_linearToSrgb(b > 0 ? b : 0);
  }
}
const CR_LIN8 = Float64Array.from({length:256}, (_, k) => cr_srgbToLinear(k / 255));
/* camera_raw.rs:480 develop：直通 RGBA（px＝Float32Array 交错 4 通道，w×h，显示编码 RGB）；float＝保留 >1（我们恒 false） */
function cr_develop(px, w, h, p, float){
  const N = w * h;
  if (!N || cr_isIdentity(p)) return;
  const ps = clamp(p.pixelScale, 0.01, 1), long = Math.max(w, h);
  // 0. 校准（照 PS 补，相机描述档那一层，比白平衡早）
  if (p.defringePurpleAmount > 0 || p.defringeGreenAmount > 0) cr_defringe(px, w, h, p, ps);   // 照 PS 补：光学 ▸ 去边（原色上做）
  if (!cr_calNeutral(p)) cr_calibrate(px, N, p);
  // 1. 线性光里做白平衡＋曝光
  if (!cr_wbNeutral(p)){
    const t = p.temperature / 100, tn = p.tint / 100;
    // 色调：原码只压 G（1−0.25·tn），按亮度正规化后 G 占 72% ⇒ 几乎被抵掉、灰牌 −100 才偏 13 阶；照 PS 改成 R／B 跟 G 反向（−100 灰牌约偏绿 27 阶，跟色温同量级）
    let g0 = (1 + 0.35 * t) * (1 + 0.2 * tn), g1 = 1 - 0.3 * tn, g2 = (1 - 0.35 * t) * (1 + 0.2 * tn);
    const norm = cr_luma(g0, g1, g2), e = Math.pow(2, p.exposure);
    g0 = g0 / norm * e; g1 = g1 / norm * e; g2 = g2 / norm * e;
    const gg = [g0, g1, g2], f = (v, c) => { const q = cr_srgbToLinear(v) * gg[c]; return cr_linearToSrgb(q > 0 ? q : 0); };
    // 8 位来的值（k/255）每通道只有 256 种：先算好查表（同一个函数、结果逐位相同）；不是这 256 个值的（代理平均过的）照算
    const tab = new Float64Array(768); for (let c = 0; c < 3; c++) for (let k = 0; k < 256; k++) tab[c * 256 + k] = f(CR_U8F[k], c);
    for (let o = 0; o < N * 4; o += 4) for (let c = 0; c < 3; c++){
      const v = px[o + c], k = Math.round(v * 255);
      px[o + c] = (k >= 0 && k <= 255 && CR_U8F[k] === v) ? tab[c * 256 + k] : f(v, c);
    }
  }
  /* 照 ACR 改晕影位置（原码在最后、显示编码上做）：
     · 高光优先＝在色调映射之前、场景线性光里乘（跟曝光同一层），所以压暗的角落里原本过曝的高光还救得回来（Adobe 说明「Highlight Priority：能做高光恢复」）；
     · 颜色优先＝在「基本」面板的影调之后（Martin Evening《Lightroom Classic Book》：Color Priority 在基本面板调整之后套用，暗角少色偏、不能恢复高光）；
     · 绘画叠加＝最后跟黑／白混（LR2 时代的旧做法：所有校正之后才叠，prolost.com 2008「What's wrong with Lightroom 2」）。 */
  const vigStyle = p.vignetteAmount !== 0 ? (p.vignetteStyle === 'colorPriority' || p.vignetteStyle === 'paintOverlay' ? p.vignetteStyle : 'highlightPriority') : null;
  if (vigStyle === 'highlightPriority') cr_vignetteLinear(px, w, h, p);
  // 2. 去除薄雾
  if (p.dehaze !== 0) cr_dehaze(px, w, h, p.dehaze / 100);
  // 3. 亮度上的影调（保留色彩比例）
  if (!cr_toneNeutral(p)){
    const l = new Float32Array(N), lc = new Float32Array(N);
    for (let i = 0; i < N; i++){ const v = cr_luma(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); l[i] = v > 0 ? v : 0; lc[i] = Math.min(l[i], 1); }
    const base = (p.highlights !== 0 || p.shadows !== 0) ? cr_guidedFast(lc, lc, w, h, Math.max(Math.floor(long * 0.015), 2), 0.02) : null;
    const clar = p.clarity !== 0 ? cr_guidedFast(lc, lc, w, h, Math.max(Math.floor(long * 0.02), 3), 0.005) : null;
    const tex = p.texture !== 0 ? cr_gauss(lc, w, h, Math.max(long * 0.002, 1.5 * ps)) : null;
    const kCon = p.contrast / 100 * 0.6;
    for (let i = 0; i < N; i++){
      const l0 = l[i]; let lv = lc[i];
      if (base){
        const bv = clamp(base[i], 0, 1), hm = cr_smoothstep(0.45, 0.95, bv), sm = 1 - cr_smoothstep(0.05, 0.5, bv);
        lv *= Math.pow(2, p.highlights / 100 * 1.2 * hm + p.shadows / 100 * 1.4 * sm);
      }
      if (clar){ const q = 2 * clamp(lv, 0, 1) - 1, mw = 1 - q * q; lv += p.clarity / 100 * 0.8 * (lc[i] - clar[i]) * mw; }
      if (tex) lv += p.texture / 100 * 0.9 * clamp(lc[i] - tex[i], -0.1, 0.1);
      if (p.whites !== 0) lv += p.whites / 100 * 0.25 * cr_smoothstep(0.4, 1, lv);
      if (p.blacks !== 0) lv += p.blacks / 100 * 0.15 * (1 - cr_smoothstep(0, 0.45, lv));
      if (kCon !== 0){ const xx = clamp(lv, 0, 1); lv += -kCon * Math.sin(TAU * xx) / TAU; }
      lv = (lv > 0 ? lv : 0) + (l0 - lc[i]);
      const o = i * 4;
      if (l0 > 1e-5){ const ratio = lv / l0; px[o] *= ratio; px[o + 1] *= ratio; px[o + 2] *= ratio; }
      else { const d = lv - l0; px[o] += d; px[o + 1] += d; px[o + 2] += d; }
    }
  }
  if (vigStyle === 'colorPriority') cr_vignette(px, w, h, p);
  // 4–7. 逐格的颜色阶段（自然饱和度／饱和度、色调曲线、混色器、颜色分级）
  const needColor = p.vibrance !== 0 || p.saturation !== 0 || !cr_curvesNeutral(p) || !cr_hslNeutral(p) || !cr_gradeNeutral(p);
  if (needColor) cr_colorStages(px, N, p);
  // 8. 细节
  if (p.noiseLuminance > 0 || p.noiseColor > 0 || p.sharpenAmount > 0) cr_detail(px, w, h, p, ps);
  // 9. 效果（晕影只剩绘画叠加在这；高光优先／颜色优先见上）
  if (vigStyle === 'paintOverlay') cr_vignette(px, w, h, p);
  if (p.grainAmount > 0){
    const cell = 1 + p.grainSize / 25, rough = p.grainRoughness / 100, amt = p.grainAmount / 100 * 0.12, seed = p.seed, pscale = 1 / ps;
    const maxF = (w - 1) * pscale / cell, nA = cr_noiseSampler(seed, maxF), nB = cr_noiseSampler(seed + 7, maxF * 2.3);   // ＝value_noise(…, seed)／(…, seed+7)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const fx = x * pscale / cell, fy = y * pscale / cell;      // 用全尺寸坐标取样，预览跟结果对得上
      const n = nA(fx, fy) * (1 - rough) + (nB(fx * 2.3, fy * 2.3) - 0) * rough;
      const o = (y * w + x) * 4, l = clamp(cr_luma(px[o], px[o + 1], px[o + 2]), 0, 1);
      const g = (n - 0.5) * 2 * amt * (0.4 + 2.4 * l * (1 - l));
      px[o] += g; px[o + 1] += g; px[o + 2] += g;
    }
  }
  if (!float) for (let o = 0; o < N * 4; o += 4){ px[o] = clamp(px[o], 0, 1); px[o + 1] = clamp(px[o + 1], 0, 1); px[o + 2] = clamp(px[o + 2], 0, 1); }
}
/* camera_raw.rs:556-639 颜色阶段（develop 里那个 par_rows 回圈） */
function cr_colorStages(px, N, p){
  const anyCurve = !(p.curveHighlights === 0 && p.curveLights === 0 && p.curveDarks === 0 && p.curveShadows === 0);
  const par = anyCurve ? cr_parametricLut(p, 1024) : null;
  const pts = c => cr_isLinear(c) ? null : cr_curveLut(c, 1024);
  const master = pts(p.pointCurve), chLut = [pts(p.pointCurveRed), pts(p.pointCurveGreen), pts(p.pointCurveBlue)];
  const hsl = !cr_hslNeutral(p), grade = !cr_gradeNeutral(p), vibSat = p.vibrance !== 0 || p.saturation !== 0;
  const wheelTint = wh => { cr_hsvToRgb(wh.hue, 1, 1); const l = cr_luma(cr_rgb[0], cr_rgb[1], cr_rgb[2]); return [cr_rgb[0] - l, cr_rgb[1] - l, cr_rgb[2] - l].map(v => v * wh.sat / 100 * 0.3); };
  const wheels = [p.gradeShadows, p.gradeMidtones, p.gradeHighlights, p.gradeGlobal], tints = wheels.map(wheelTint), lums = wheels.map(wh => wh.lum);
  const blend = 0.15 + clamp(p.gradeBlending, 0, 100) / 100 * 0.35, bal = clamp(p.gradeBalance, -100, 100) / 100 * 0.25;
  const wts = new Float64Array(8), masks = new Float64Array(4), hH = Float64Array.from(p.hslHue), hS = Float64Array.from(p.hslSat), hL = Float64Array.from(p.hslLum);
  for (let i = 0; i < N; i++){
    const o = i * 4; let r = px[o], g = px[o + 1], b = px[o + 2];
    if (vibSat){
      const l = cr_luma(r, g, b), mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 1e-6 ? (mx - mn) / mx : 0;
      cr_rgbToHsv(r, g, b);                                        // 自然饱和度稍微护住肤色（橙色）
      const skin = clamp(1 - Math.abs(cr_hsv[0] - 25) / 25, 0, 1) * 0.5;
      let k = 1 + p.saturation / 100 + p.vibrance / 100 * (1 - sat) * (1 - skin); if (!(k > 0)) k = 0;
      r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
    }
    if (par){ r = cr_lutEval(par, r); g = cr_lutEval(par, g); b = cr_lutEval(par, b); }
    if (master){ r = cr_lutEval(master, r); g = cr_lutEval(master, g); b = cr_lutEval(master, b); }
    if (chLut[0]) r = cr_lutEval(chLut[0], r);
    if (chLut[1]) g = cr_lutEval(chLut[1], g);
    if (chLut[2]) b = cr_lutEval(chLut[2], b);
    if (hsl){
      cr_rgbToHsv(r > 0 ? r : 0, g > 0 ? g : 0, b > 0 ? b : 0);
      const hh = cr_hsv[0], s = cr_hsv[1], v = cr_hsv[2];
      if (s > 1e-4){
        // band_weights：帽形函数在任一色相最多两个色带非零，其余＝0（加 0 不改和）⇒ 只算相邻两带、照 k 由小到大加（结果逐位相同）
        let j = 7; while (j > 0 && hh < CR_HSL_BANDS[j]) j--;
        const ka = j === 7 ? 0 : j, kb = j === 7 ? 7 : j + 1, wa = cr_bandWeight(hh, ka), wb = cr_bandWeight(hh, kb);
        const dh = 0 + wa * hH[ka] + wb * hH[kb], ds = 0 + wa * hS[ka] + wb * hS[kb], dl = 0 + wa * hL[ka] + wb * hL[kb];
        const nh = hh + dh / 100 * 30, ns = clamp(s * (1 + ds / 100), 0, 1);
        cr_hsvToRgb(nh, ns, v);
        let qr = cr_rgb[0], qg = cr_rgb[1], qb = cr_rgb[2];
        const l0 = cr_luma(r, g, b), l1 = cr_luma(qr, qg, qb);     // 保住亮度，再按饱和度加权做明亮度位移
        if (l1 > 1e-6){ qr = qr * l0 / l1; qg = qg * l0 / l1; qb = qb * l0 / l1; }
        const k = Math.pow(2, dl / 100 * 1 * s);
        r = qr * k; g = qg * k; b = qb * k;
      }
    }
    if (grade){
      const l = clamp(cr_luma(r, g, b), 0, 1);
      const sh = 1 - cr_smoothstep(0, 0.5 + bal + blend, l), hi = cr_smoothstep(0.5 + bal - blend, 1, l);
      masks[0] = sh; masks[1] = Math.max(1 - sh - hi, 0); masks[2] = hi; masks[3] = 1;
      for (let k = 0; k < 4; k++){
        const tk = tints[k]; r += masks[k] * tk[0]; g += masks[k] * tk[1]; b += masks[k] * tk[2];
        if (lums[k] !== 0){ const f = Math.pow(2, masks[k] * lums[k] / 100 * 0.6); r *= f; g *= f; b *= f; }
      }
    }
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
  }
}
/* camera_raw.rs:676 value_noise：双线性内插（smoothstep 权重）的格点杂凑 */
function cr_valueNoise(x, y, seed){
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h00 = cr_hash01(xi, yi, seed), h10 = cr_hash01(xi + 1, yi, seed), h01 = cr_hash01(xi, yi + 1, seed), h11 = cr_hash01(xi + 1, yi + 1, seed);
  const top = h00 + (h10 - h00) * sx, bot = h01 + (h11 - h01) * sx;
  return top + (bot - top) * sy;
}
/* 同 value_noise，但格点杂凑值按列快取（y 由上往下扫时只留两列、用到才算）——结果逐位相同，只是不重算同一个格点 */
function cr_noiseSampler(seed, maxX){
  cr_mul64(cr_hi32(seed), seed >>> 0, 0x165667B1, 0x9E3779F9);
  const ssh = cr_mh, ssl = cr_ml, X = Math.max(Math.floor(maxX) + 3, 2);
  const xh = new Uint32Array(X), xl = new Uint32Array(X);           // x·C1 先算好（每个 x 只算一次）
  for (let i = 0; i < X; i++){ cr_mul64(0, i, 0x9E3779B9, 0x7F4A7C15); xh[i] = cr_mh; xl[i] = cr_ml; }
  let r0 = new Float64Array(X).fill(NaN), r1 = new Float64Array(X).fill(NaN), ry = NaN, y0h = 0, y0l = 0, y1h = 0, y1l = 0;
  const yprod = yy => { cr_mul64(cr_hi32(yy), yy >>> 0, 0xC2B2AE3D, 0x27D4EB4F); };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    if (yi !== ry){
      if (yi === ry + 1){ const t = r0; r0 = r1; r1 = t; r1.fill(NaN); y0h = y1h; y0l = y1l; }
      else { r0.fill(NaN); r1.fill(NaN); yprod(yi); y0h = cr_mh; y0l = cr_ml; }
      yprod(yi + 1); y1h = cr_mh; y1l = cr_ml; ry = yi;
    }
    if (xi < 0 || xi + 1 >= X) return cr_valueNoise(x, y, seed);      // 超出快取范围就照原式算
    let h00 = r0[xi], h10 = r0[xi + 1], h01 = r1[xi], h11 = r1[xi + 1];
    if (h00 !== h00) h00 = r0[xi] = cr_hashMix((xh[xi] ^ y0h ^ ssh) >>> 0, (xl[xi] ^ y0l ^ ssl) >>> 0);
    if (h10 !== h10) h10 = r0[xi + 1] = cr_hashMix((xh[xi + 1] ^ y0h ^ ssh) >>> 0, (xl[xi + 1] ^ y0l ^ ssl) >>> 0);
    if (h01 !== h01) h01 = r1[xi] = cr_hashMix((xh[xi] ^ y1h ^ ssh) >>> 0, (xl[xi] ^ y1l ^ ssl) >>> 0);
    if (h11 !== h11) h11 = r1[xi + 1] = cr_hashMix((xh[xi + 1] ^ y1h ^ ssh) >>> 0, (xl[xi + 1] ^ y1l ^ ssl) >>> 0);
    const top = h00 + (h10 - h00) * sx, bot = h01 + (h11 - h01) * sx;
    return top + (bot - top) * sy;
  };
}
/* camera_raw.rs:686 dehaze：暗通道先验（He 2009）；透射率在 ≤768 px 代理上算、引导滤波细化、双线性放大 */
function cr_dehaze(px, w, h, amount){
  const k = Math.max(Math.ceil(Math.max(w, h) / 768), 1), sw = Math.ceil(w / k), sh = Math.ceil(h / k), SN = sw * sh;
  const small = new Float32Array(SN * 3), cnt = new Float32Array(SN);
  for (let y = 0; y < h; y++){ const row = ((y / k) | 0) * sw; for (let x = 0; x < w; x++){ const i = row + ((x / k) | 0), o = (y * w + x) * 4;
    small[i * 3] += clamp(px[o], 0, 1); small[i * 3 + 1] += clamp(px[o + 1], 0, 1); small[i * 3 + 2] += clamp(px[o + 2], 0, 1); cnt[i] += 1; } }
  for (let i = 0; i < SN; i++){ const c = Math.max(cnt[i], 1); small[i * 3] = small[i * 3] / c; small[i * 3 + 1] = small[i * 3 + 1] / c; small[i * 3 + 2] = small[i * 3 + 2] / c; }
  const r = Math.max(Math.floor(Math.max(sw, sh) / 60), 2);
  const minFilter = v => {                                          // 可分离的最小值滤波（窗口在边缘截短）
    const a = new Float32Array(SN), b = new Float32Array(SN);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++){ const x0 = Math.max(x - r, 0), x1 = Math.min(x + r, sw - 1); let m = 3.4028234663852886e38; for (let xx = x0; xx <= x1; xx++){ const q = v[y * sw + xx]; if (q < m) m = q; } a[y * sw + x] = m; }
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++){ const y0 = Math.max(y - r, 0), y1 = Math.min(y + r, sh - 1); let m = 3.4028234663852886e38; for (let yy = y0; yy <= y1; yy++){ const q = a[yy * sw + x]; if (q < m) m = q; } b[y * sw + x] = m; }
    return b;
  };
  const dc = new Float32Array(SN);
  for (let i = 0; i < SN; i++) dc[i] = Math.min(small[i * 3], small[i * 3 + 1], small[i * 3 + 2]);
  const dark = minFilter(dc);
  // 大气光：暗通道最亮的 0.1 % 的平均色。原码＝整列稳定降序排序取前 top 个；这里先找门槛再只排那几个（选出来的集合与相加顺序都一样）
  const top = Math.max(Math.floor(SN / 1000), 1), thr = Float32Array.from(dark).sort()[SN - top];
  const pick = []; for (let i = 0; i < SN; i++) if (dark[i] > thr) pick.push(i);
  pick.sort((a, b) => dark[b] - dark[a] || a - b);
  for (let i = 0; i < SN && pick.length < top; i++) if (dark[i] === thr) pick.push(i);
  const air = new Float32Array(3);
  for (const i of pick) for (let c = 0; c < 3; c++) air[c] += small[i * 3 + c] / top;
  for (let c = 0; c < 3; c++) air[c] = Math.max(air[c], 0.2);
  const nd = new Float32Array(SN);
  for (let i = 0; i < SN; i++) nd[i] = Math.min(small[i * 3] / air[0], small[i * 3 + 1] / air[1], small[i * 3 + 2] / air[2]);
  const normDark = minFilter(nd), tRaw = new Float32Array(SN), guide = new Float32Array(SN);
  for (let i = 0; i < SN; i++){ tRaw[i] = 1 - 0.95 * normDark[i]; guide[i] = cr_luma(small[i * 3], small[i * 3 + 1], small[i * 3 + 2]); }
  const t = cr_guided(guide, tRaw, sw, sh, r * 2, 1e-3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const tv = clamp(cr_bilinear(t, sw, sh, 1, 0, (x + 0.5) / k - 0.5, (y + 0.5) / k - 0.5), 0.1, 1), o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++){
      const i = px[o + c], j = (i - air[c]) / tv + air[c];
      px[o + c] = amount >= 0 ? i + (j - i) * amount : i + (air[c] - i) * (-amount) * 0.5 * (1 - tv * 0.5);
    }
  }
}
/* camera_raw.rs:751 detail：在 Y＋色差（BT.709 Y、B−Y、R−Y）上做减少杂色与锐化 */
function cr_detail(px, w, h, p, ps){
  const N = w * h, Y = new Float32Array(N), cb = new Float32Array(N), crr = new Float32Array(N);
  for (let i = 0; i < N; i++){ const o = i * 4, l = cr_luma(px[o], px[o + 1], px[o + 2]); Y[i] = l; cb[i] = px[o + 2] - l; crr[i] = px[o] - l; }
  if (p.noiseLuminance > 0){
    const n = p.noiseLuminance / 100, r = Math.max(rround((1 + 3 * n) * ps), 1);
    const smooth = cr_guided(Y, Y, w, h, r, Math.pow(n * 0.06, 2) + 1e-6), keep = p.noiseLuminanceDetail / 100 * 0.5;
    for (let i = 0; i < N; i++) Y[i] = smooth[i] + (Y[i] - smooth[i]) * keep;
  }
  if (p.noiseColor > 0){
    const sigma = Math.max(p.noiseColor / 100 * 6 * ps, 0.3), bcb = cr_gauss(cb, w, h, sigma), bcr = cr_gauss(crr, w, h, sigma), keep = p.noiseColorDetail / 100 * 0.3;
    for (let i = 0; i < N; i++){ cb[i] = bcb[i] + (cb[i] - bcb[i]) * keep; crr[i] = bcr[i] + (crr[i] - bcr[i]) * keep; }
  }
  if (p.sharpenAmount > 0){
    const sigma = Math.max(clamp(p.sharpenRadius, 0.5, 3) * ps, 0.3), blur = cr_gauss(Y, w, h, sigma);
    let mask = null;
    if (p.sharpenMasking > 0){                                      // 遮蔽：平滑亮度的梯度当边缘遮罩
      const s = cr_gauss(Y, w, h, 1 * Math.max(ps, 0.5)), t = p.sharpenMasking / 100 * 0.08;
      mask = new Float32Array(N);
      for (let i = 0; i < N; i++){
        const x = i % w, yy = (i / w) | 0;
        const gx = s[yy * w + Math.min(x + 1, w - 1)] - s[yy * w + Math.max(x - 1, 0)], gy = s[Math.min(yy + 1, h - 1) * w + x] - s[Math.max(yy - 1, 0) * w + x];
        mask[i] = cr_smoothstep(t * 0.5, t + 1e-4, Math.hypot(gx, gy));
      }
    }
    const amt = p.sharpenAmount / 100 * 1.2, det = p.sharpenDetail / 100, limit = 0.03 + det * 0.3;
    for (let i = 0; i < N; i++){
      const hp = clamp(Y[i] - blur[i], -limit, limit) * (0.5 + 0.5 * det);   // 细节低＝压住大的（会出光晕的）差
      Y[i] += amt * hp * (mask ? mask[i] : 1);
    }
  }
  for (let i = 0; i < N; i++){
    const l = Y[i], rr = crr[i] + l, bb = cb[i] + l, o = i * 4;
    px[o] = rr; px[o + 1] = (l - 0.2126 * rr - 0.0722 * bb) / 0.7152; px[o + 2] = bb;
  }
}
/* camera_raw.rs:809 vignette：裁剪后晕影（数量、中点、圆度、羽化、高光、样式） */
/* 晕影遮罩：回 (x, y) → m（0＝不动、1＝满量） */
function cr_vignetteMask(w, h, p){
  const mid = clamp(p.vignetteMidpoint, 0, 100) / 100, feather = clamp(p.vignetteFeather, 0, 100) / 100;
  const round = clamp(p.vignetteRoundness, -100, 100) / 100;
  const cx = w / 2, cy = h / 2;
  let ax = cx, ay = cy;                                            // 圆度：0＝照画面比例、+1＝正圆、−1＝圆角矩形
  if (round >= 0){ const r = Math.min(cx, cy) + (Math.max(cx, cy) - Math.min(cx, cy)) * (1 - round); ax = cx >= cy ? r : cx; ay = cy > cx ? r : cy; }
  const pw = 2 + Math.max(-round, 0) * 6, inner = 1 - mid * 0.8;
  const edge0 = inner - feather * 0.5 * inner, edge1 = inner + feather * 0.5 * (1.4 - inner) + 0.02;
  return (x, y) => {
    const dx = Math.abs((x + 0.5 - cx) / ax), dy = Math.abs((y + 0.5 - cy) / ay);
    return cr_smoothstep(edge0, edge1, Math.pow(Math.pow(dx, pw) + Math.pow(dy, pw), 1 / pw));
  };
}
/* 高光优先（照 ACR：色调映射之前、场景线性光里）：线性值 ×2^(数量·4.4·m)（≈显示编码 ×2^(2·数量·m) 的 γ2.2 换算，−100 角落约 −4.4 EV）；
   「高光」＞0 时亮处（含曝光推出 >1 的）穿透变暗晕影 */
function cr_vignetteLinear(px, w, h, p){
  const amt = p.vignetteAmount / 100, hl = clamp(p.vignetteHighlights, 0, 100) / 100, mask = cr_vignetteMask(w, h, p);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const m = mask(x, y); if (m <= 0) continue;
    const o = (y * w + x) * 4;
    let k = Math.pow(2, amt * 4.4 * m);
    if (amt < 0 && hl > 0){ const protect = cr_smoothstep(0.6, 1, cr_luma(px[o], px[o + 1], px[o + 2])) * hl; k += (1 - k) * protect; }
    for (let c = 0; c < 3; c++){ const q = cr_srgbToLinear(px[o + c] > 0 ? px[o + c] : 0) * k; px[o + c] = cr_linearToSrgb(q); }
  }
}
/* 颜色优先（影调之后，只动亮度、保色差）／绘画叠加（最后，跟黑／白混） */
function cr_vignette(px, w, h, p){
  const amt = p.vignetteAmount / 100, hl = clamp(p.vignetteHighlights, 0, 100) / 100, style = p.vignetteStyle, mask = cr_vignetteMask(w, h, p);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const m = mask(x, y);
    if (m <= 0) continue;
    const o = (y * w + x) * 4, l = clamp(cr_luma(px[o], px[o + 1], px[o + 2]), 0, 1);
    if (style === 'paintOverlay'){
      const target = amt < 0 ? 0 : 1, k = m * Math.abs(amt);
      for (let c = 0; c < 3; c++) px[o + c] += (target - px[o + c]) * k;
    } else {
      let k = Math.pow(2, amt * 2 * m);
      if (amt < 0 && hl > 0){ const protect = cr_smoothstep(0.6, 1, l) * hl; k += (1 - k) * protect; }   // 高光：亮处穿透变暗晕影
      if (style === 'colorPriority'){ const d = l * k - l; px[o] += d; px[o + 1] += d; px[o + 2] += d; }
      else { px[o] *= k; px[o + 1] *= k; px[o + 2] *= k; }
    }
  }
}

/* ── 照 PS 2020（ACR 12）补：「光学」与「几何」两页（原码 camera_raw.rs 没有）──
   光学：删除色差（自动量 R／B 对 G 的径向放大率，照量到的反向缩回）、使用配置文件校正（滤镜下没有 EXIF ⇒ 找不到镜头配置文件、照实不作用）、
         手动：扭曲度（径向 r·(1+k·r²)，＋＝校正桶形）、去边（紫／绿：在亮度边缘附近、色相落在范围内的像素往灰拉；数量 0..20）、镜头晕影（数量、中点；＋＝提亮四角）。
   几何：Upright 关闭／自动／水平／纵向／完全／参考线＋手动 垂直／水平／旋转／长宽比／缩放／X 偏移／Y 偏移，勾「限制裁切」＝放大到四边没有空白。
         Upright 是近似：缩图上 Sobel＋按梯度方向投票的 Hough 找直线（或用使用者画的 2–4 条参考线），
         座标下降解「旋转、垂直、水平」三个量让近竖直线变竖直、近水平线变水平（水平＝只解旋转；纵向＝旋转＋垂直；自动＝完全但对透视量加惩罚、比较保守）。
   像素顺序：去边在 develop 最前（原色上做）；扭曲／色差／镜头晕影／变换在 develop 之后一次逆映射重采样（借镜头校正的 lc_remap，双立方、预乘；外面＝透明）。 */
const cr_m3mul = (A, B) => { const C = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return C; };
function cr_m3inv(m){
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-14)) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
/* 变换矩阵（来源〔镜头校正后〕像素 → 输出像素）：以画框中心、半长边正规化；先旋转、再梯形（垂直／水平）、再长宽比＋缩放＋偏移 */
function cr_geomMatrix(t, frame){
  const cx = (frame.x0 + frame.x1) / 2, cy = (frame.y0 + frame.y1) / 2, s = Math.max(RW(frame), RH(frame), 2) / 2;
  const N = [1 / s, 0, -cx / s, 0, 1 / s, -cy / s, 0, 0, 1], Ni = [s, 0, cx, 0, s, cy, 0, 0, 1];
  const a = -t.vert / 100 * 0.5, b = -t.horiz / 100 * 0.5;           // 垂直－＝上缘放宽（仰拍楼往后倒用负的拉直）；水平＋＝右边放大
  const P = [1, 0, 0, 0, 1, 0, b, a, 1];
  const th = t.rot * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);   // 旋转＋＝顺时针（y 朝下）
  const Rm = [co, -si, 0, si, co, 0, 0, 0, 1];
  const ax = Math.pow(2, (t.aspect || 0) / 200), sc = t.scale === undefined ? 1 : t.scale;
  const A = [ax * sc, 0, t.ox || 0, 0, sc / ax, t.oy || 0, 0, 0, 1];
  return cr_m3mul(Ni, cr_m3mul(A, cr_m3mul(P, cr_m3mul(Rm, N))));
}
const cr_m3apply = (M, x, y) => { const w = M[6] * x + M[7] * y + M[8]; return w > 1e-9 ? [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w] : null; };
/* 缩图上找直线：Sobel → 按梯度法线方向（±2°）投票的 Hough → 取峰（抑制邻近）→ 用落在线上的边缘点量出线段两端。回全尺寸画框座标 */
function cr_detectLines(buf, W, H){
  const k = Math.max(1, Math.ceil(Math.max(W, H) / 400)), sw = Math.ceil(W / k), sh = Math.ceil(H / k), SN = sw * sh;
  if (sw < 8 || sh < 8) return [];
  const g = new Float32Array(SN), cnt = new Float32Array(SN);
  for (let y = 0; y < H; y++){ const row = ((y / k) | 0) * sw; for (let x = 0; x < W; x++){ const o = (y * W + x) * 4, i = row + ((x / k) | 0); g[i] += cr_luma(buf[o], buf[o + 1], buf[o + 2]) * buf[o + 3]; cnt[i]++; } }
  for (let i = 0; i < SN; i++) g[i] /= Math.max(cnt[i], 1);
  const EX = [], EY = [], ET = [], EM = []; let maxM = 0;
  const mag = new Float32Array(SN), GX = new Float32Array(SN), GY = new Float32Array(SN);
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++){
    const i = y * sw + x;
    const gx = (g[i - sw + 1] + 2 * g[i + 1] + g[i + sw + 1]) - (g[i - sw - 1] + 2 * g[i - 1] + g[i + sw - 1]);
    const gy = (g[i + sw - 1] + 2 * g[i + sw] + g[i + sw + 1]) - (g[i - sw - 1] + 2 * g[i - sw] + g[i - sw + 1]);
    GX[i] = gx; GY[i] = gy; mag[i] = Math.hypot(gx, gy) / 4; if (mag[i] > maxM) maxM = mag[i];
  }
  const thr = Math.max(0.06, maxM * 0.2);
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++){
    const i = y * sw + x; if (mag[i] < thr) continue;
    let th = Math.atan2(GY[i], GX[i]) * 180 / Math.PI; if (th < 0) th += 180; if (th >= 180) th -= 180;
    EX.push(x + 0.5); EY.push(y + 0.5); ET.push(th); EM.push(mag[i]);
  }
  const ne = EX.length; if (ne < 10) return [];
  const cx = sw / 2, cy = sh / 2, diag = Math.hypot(sw, sh) / 2, off = Math.ceil(diag) + 2, nR = 2 * off + 1;
  const COS = new Float64Array(180), SIN = new Float64Array(180);
  for (let t = 0; t < 180; t++){ COS[t] = Math.cos(t * Math.PI / 180); SIN[t] = Math.sin(t * Math.PI / 180); }
  const acc = new Float32Array(180 * nR);
  for (let e = 0; e < ne; e++){
    const px = EX[e] - cx, py = EY[e] - cy, t0 = Math.round(ET[e]);
    for (let d = -2; d <= 2; d++){ const t = (t0 + d + 360) % 180, r = Math.round(px * COS[t] + py * SIN[t]) + off; if (r >= 0 && r < nR) acc[t * nR + r] += EM[e]; }
  }
  const lines = [], minLen = 0.12 * Math.min(sw, sh); let first = 0;
  for (let it = 0; it < 40 && lines.length < 24; it++){
    let bi = 0, bv = 0; for (let i = 0; i < acc.length; i++) if (acc[i] > bv){ bv = acc[i]; bi = i; }
    if (!first) first = bv;
    if (bv < Math.max(minLen * 0.3, first * 0.1)) break;
    const t = Math.floor(bi / nR), r = bi % nR - off;
    for (let dt = -5; dt <= 5; dt++){                                // 抑制邻近（跨 0°／180° 时 rho 变号）
      const tt = t + dt, wrap = tt < 0 || tt >= 180, t2 = (tt + 360) % 180, rc = (wrap ? -r : r) + off;
      for (let dr = -6; dr <= 6; dr++){ const q = rc + dr; if (q >= 0 && q < nR) acc[t2 * nR + q] = 0; }
    }
    // 落在线上（±1.5 px、方向差 ≤8°）的边缘点：按梯度加权做主轴拟合（Hough 只有 1° 一格，拟合把角度量准）
    const sel = []; let sw0 = 0, mx = 0, my = 0;
    for (let e = 0; e < ne; e++){
      const px = EX[e] - cx, py = EY[e] - cy;
      if (Math.abs(px * COS[t] + py * SIN[t] - r) > 1.5) continue;
      let da = Math.abs(ET[e] - t); if (da > 90) da = 180 - da; if (da > 8) continue;
      sel.push(e); sw0 += EM[e]; mx += EM[e] * EX[e]; my += EM[e] * EY[e];
    }
    if (sel.length < minLen * 0.5) continue;
    mx /= sw0; my /= sw0;
    let sxx = 0, syy = 0, sxy = 0;
    for (const e of sel){ const ux = EX[e] - mx, uy = EY[e] - my; sxx += EM[e] * ux * ux; syy += EM[e] * uy * uy; sxy += EM[e] * ux * uy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(ang), dy = Math.sin(ang);
    let tmin = Infinity, tmax = -Infinity;
    for (const e of sel){ const s = (EX[e] - mx) * dx + (EY[e] - my) * dy; if (s < tmin) tmin = s; if (s > tmax) tmax = s; }
    if (!(tmax - tmin >= minLen)) continue;
    const a = [(mx + tmin * dx) * k, (my + tmin * dy) * k], b = [(mx + tmax * dx) * k, (my + tmax * dy) * k];
    lines.push({a, b, w:bv});
  }
  return lines;
}
/* Upright：座标下降解 [旋转°, 垂直, 水平]；lines＝[{a,b,w}]（画框座标、镜头校正后） */
function cr_uprightSolve(mode, lines, frame){
  const L = [];
  for (const ln of lines){
    const dx = ln.b[0] - ln.a[0], dy = ln.b[1] - ln.a[1], ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);   // 0..180
    const kind = Math.abs(ang - 90) <= 35 ? 'v' : (ang <= 35 || ang >= 145) ? 'h' : null;
    if (kind) L.push({a:ln.a, b:ln.b, w:ln.w || 1, kind});
  }
  const out = {rotate:0, vertical:0, horizontal:0, aspect:0, lines:L.length};
  if (!L.length) return out;
  const sw = L.reduce((s, l) => s + l.w, 0); L.forEach(l => { l.w /= sw; });
  // 透视量要有至少两条同向的线才解得出来（ACR 参考线：两条竖的才做垂直、两条横的才做水平；一竖一横＝只转）
  const nv = L.filter(l => l.kind === 'v').length, nh = L.length - nv;
  // Adobe 说明（helpx「Correct image perspective using Geometry」）：自动＝平衡的透视校正；水平＝只让画面水平；纵向＝水平＋纵向透视；完全＝水平＋纵向＋横向透视；参考线＝画 2 条以上（最多 4 条）。
  // 自动的「平衡」照 Upright 所本的 Lee、Shechtman、Wang、Lee《Automatic Upright Adjustment of Photographs》(CVPR 2012)：
  // 不硬把所有竖线拉到全平行（会扭得不自然），对透视量加惩罚、限幅 ±40，并补长宽比让画面不被拉扁／拉长。
  const free = mode === 'level' ? [1, 0, 0] : mode === 'vertical' ? [1, nv >= 2 ? 1 : 0, 0] : [1, nv >= 2 ? 1 : 0, nh >= 2 ? 1 : 0];
  const auto = mode === 'auto', lam = auto ? 0.01 : 1e-6, LO = auto ? [-30, -40, -40] : [-30, -100, -100], HI = auto ? [30, 40, 40] : [30, 100, 100];
  const cost = x => {
    const M = cr_geomMatrix({rot:x[0], vert:x[1], horiz:x[2], aspect:0, scale:1, ox:0, oy:0}, frame);
    let c = lam * ((x[1] / 100) ** 2 + (x[2] / 100) ** 2);
    for (const l of L){
      const a = cr_m3apply(M, l.a[0], l.a[1]), b = cr_m3apply(M, l.b[0], l.b[1]);
      if (!a || !b){ c += l.w * 10; continue; }
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const dev = l.kind === 'v' ? Math.atan2(dx, Math.abs(dy) < 1e-9 ? 1e-9 : dy) : Math.atan2(dy, Math.abs(dx) < 1e-9 ? 1e-9 : dx);
      const d = Math.abs(dev) > Math.PI / 2 ? (dev > 0 ? dev - Math.PI : dev + Math.PI) : dev;
      c += l.w * d * d;
    }
    return c;
  };
  const x = [0, 0, 0], step = [1, 6, 6], minStep = [0.002, 0.01, 0.01];
  let cur = cost(x);
  for (let it = 0; it < 600; it++){
    let moved = false;
    for (let j = 0; j < 3; j++){
      if (!free[j]) continue;
      for (const sg of [1, -1]){
        const y = x.slice(); y[j] = clamp(y[j] + sg * step[j], LO[j], HI[j]);
        const cy = cost(y); if (cy < cur - 1e-12){ x[j] = y[j]; cur = cy; moved = true; break; }
      }
    }
    if (!moved){ let done = true; for (let j = 0; j < 3; j++){ step[j] /= 2; if (free[j] && step[j] > minStep[j]) done = false; } if (done) break; }
  }
  out.rotate = Math.round(x[0] * 100) / 100; out.vertical = Math.round(x[1] * 10) / 10; out.horizontal = Math.round(x[2] * 10) / 10;
  if (auto && (out.vertical || out.horizontal)){                    // 自动：保持长宽比（只补透视造成的比例变化，旋转不算）
    const M = cr_geomMatrix({rot:0, vert:out.vertical, horiz:out.horizontal, aspect:0, scale:1, ox:0, oy:0}, frame);
    const pts = [[frame.x0, frame.y0], [frame.x1, frame.y0], [frame.x0, frame.y1], [frame.x1, frame.y1]].map(q => cr_m3apply(M, q[0], q[1]));
    if (pts.every(Boolean)){
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), W1 = Math.max(...xs) - Math.min(...xs), H1 = Math.max(...ys) - Math.min(...ys);
      if (W1 > 1e-6 && H1 > 1e-6) out.aspect = Math.round(clamp(100 * Math.log2((RW(frame) / RH(frame)) / (W1 / H1)), -100, 100) * 10) / 10;
    }
  }
  return out;
}
/* 删除色差：在亮度强边上比较 R（B）径向放大 s 后跟 G 的径向导数相关性，取最好的 s（−1%..+1%） */
function cr_estimateCA(buf, W, H){
  const N = W * H, cx = W / 2, cy = H / 2, rd = Math.max(Math.hypot(W, H), 2) / 2;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++){ const a = buf[i * 4 + 3]; R[i] = buf[i * 4] * a; G[i] = buf[i * 4 + 1] * a; B[i] = buf[i * 4 + 2] * a; }
  const bil = (v, x, y) => cr_bilinear(v, W, H, 1, 0, x, y);
  const S = [], step = Math.max(1, Math.floor(Math.sqrt(N / 160000)));
  for (let y = 3; y < H - 3; y += step) for (let x = 3; x < W - 3; x += step){
    const ux = x + 0.5 - cx, uy = y + 0.5 - cy, r = Math.hypot(ux, uy); if (r < 0.2 * rd) continue;
    const nx = ux / r, ny = uy / r, dG = bil(G, x + nx, y + ny) - bil(G, x - nx, y - ny);
    if (Math.abs(dG) > 0.1) S.push(x, y, nx, ny, dG);
  }
  const n = S.length / 5; if (n < 40) return {r:0, b:0, samples:n};
  const corr = (C, s) => {
    let num = 0, cc = 0, gg = 0;
    for (let q = 0; q < S.length; q += 5){
      const x = S[q], y = S[q + 1], nx = S[q + 2], ny = S[q + 3], dG = S[q + 4];
      const X = cx + (x + 0.5 - cx) * (1 + s) - 0.5, Y = cy + (y + 0.5 - cy) * (1 + s) - 0.5;
      const d = bil(C, X + nx, Y + ny) - bil(C, X - nx, Y - ny);
      num += d * dG; cc += d * d; gg += dG * dG;
    }
    return cc > 1e-12 ? num / Math.sqrt(cc * gg) : 0;
  };
  const best = C => {
    const ss = [], cs = []; for (let i = -20; i <= 20; i++){ ss.push(i * 0.0005); cs.push(corr(C, i * 0.0005)); }
    let bi = 0; for (let i = 1; i < cs.length; i++) if (cs[i] > cs[bi]) bi = i;
    if (cs[bi] < 0.3) return 0;
    let s = ss[bi];
    if (bi > 0 && bi < cs.length - 1){ const a = cs[bi - 1], b = cs[bi], c = cs[bi + 1], den = a - 2 * b + c; if (den < 0) s += clamp(0.5 * (a - c) / den, -0.5, 0.5) * 0.0005; }
    return Math.abs(s) < 0.0002 ? 0 : Math.round(s * 1e5) / 1e5;
  };
  return {r:best(R), b:best(B), samples:n};
}
/* 去边（develop 第 0 步，照 ACR 12 光学 ▸ 手动 ▸ 去边）。Adobe 说明（helpx「Correct lens distortions in Camera Raw」）：
   紫色／绿色数量 0..20＝去边强度，越大去得越多；紫色／绿色色相＝只对选定色相范围去边，两端最少差 10；绿色缺省范围窄（40–60）以保护叶子等黄绿色。
   色边（纵向色差）只出现在高反差边缘旁边 ⇒ 遮罩＝半径 r 内亮度极差（max−min）大的地方，平面大块同色（含大块紫／绿）不动。
   半径随数量变宽（数量越大、吃掉越宽的色边：r ≈ 1+数量/4 px，全尺寸，数量 20≈6 px）；紫、绿各用自己的半径。
   色相单位：滑杆 0..100 → 紫 230°..330°（蓝紫→洋红，缺省 30–70＝260°..300°）、绿 60°..180°（黄绿→青绿，缺省 40–60＝108°..132°）；
   范围外 10° 内渐弱。处理：保亮度往灰拉（去饱和），强度＝√(数量/20)×边缘遮罩×色相权重。 */
function cr_defringe(px, w, h, p, ps){
  const N = w * h, Lm = new Float32Array(N);
  for (let i = 0; i < N; i++) Lm[i] = clamp(cr_luma(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), 0, 1);
  const tmpX = new Float32Array(N), tmpN = new Float32Array(N);
  const contrast = r => {                                            // 半径 r 方框内亮度 max−min（可分离）
    const E = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      let mx = 0, mn = 1; for (let d = Math.max(x - r, 0); d <= Math.min(x + r, w - 1); d++){ const v = Lm[y * w + d]; if (v > mx) mx = v; if (v < mn) mn = v; }
      tmpX[y * w + x] = mx; tmpN[y * w + x] = mn;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      let mx = 0, mn = 1; for (let d = Math.max(y - r, 0); d <= Math.min(y + r, h - 1); d++){ const i = d * w + x; if (tmpX[i] > mx) mx = tmpX[i]; if (tmpN[i] < mn) mn = tmpN[i]; }
      E[y * w + x] = cr_smoothstep(0.1, 0.3, mx - mn);
    }
    return E;
  };
  const amtP = clamp(p.defringePurpleAmount || 0, 0, 20), amtG = clamp(p.defringeGreenAmount || 0, 0, 20);
  const rad = a => Math.max(1, Math.round((1 + a / 4) * ps));
  const rP = rad(amtP), rG = rad(amtG);
  const EP = amtP > 0 ? contrast(rP) : null, EG = amtG > 0 ? (amtP > 0 && rG === rP ? EP : contrast(rG)) : null;
  const ph = p.defringePurpleHue, gh = p.defringeGreenHue;
  const pLo = 230 + Math.min(ph[0], ph[1]), pHi = 230 + Math.max(ph[0], ph[1]), gLo = 60 + 1.2 * Math.min(gh[0], gh[1]), gHi = 60 + 1.2 * Math.max(gh[0], gh[1]);
  const aP = Math.sqrt(amtP / 20), aG = Math.sqrt(amtG / 20);
  const hw = (hh, lo, hi) => hh >= lo && hh <= hi ? 1 : Math.max(0, 1 - Math.min(Math.abs(hh - lo), Math.abs(hh - hi)) / 10);
  for (let i = 0; i < N; i++){
    const eP = EP ? EP[i] : 0, eG = EG ? EG[i] : 0; if (eP <= 0 && eG <= 0) continue;
    const o = i * 4, rr = px[o], gg = px[o + 1], bb = px[o + 2];
    cr_rgbToHsv(Math.max(rr, 0), Math.max(gg, 0), Math.max(bb, 0));
    const s = cr_hsv[1]; if (s < 0.04) continue;
    const k = Math.min(1, (aP * eP * hw(cr_hsv[0], pLo, pHi) + aG * eG * hw(cr_hsv[0], gLo, gHi)) * cr_smoothstep(0.04, 0.2, s));
    if (k <= 0) continue;
    const l = cr_luma(rr, gg, bb);
    px[o] = l + (rr - l) * (1 - k); px[o + 1] = l + (gg - l) * (1 - k); px[o + 2] = l + (bb - l) * (1 - k);
  }
}
const cr_lensNeutral = p => !p.removeCA && p.lensDistortion === 0 && p.lensVignetteAmount === 0;
const cr_transformNeutral = p => (p.upright === 'off' || (p.upright === 'guided' && p.uprightGuides.length < 2)) && p.transformVertical === 0 && p.transformHorizontal === 0 &&
  p.transformRotate === 0 && p.transformAspect === 0 && p.transformScale === 100 && p.transformX === 0 && p.transformY === 0;
const cr_geomNeutral = p => cr_lensNeutral(p) && cr_transformNeutral(p);
const CR_UPRIGHT_MODES = ['off', 'auto', 'level', 'vertical', 'full', 'guided'];   // ACR 12：关闭／自动／水平／纵向／完全／通过使用参考线
let cr_geomLast = null;                                              // 最近一次的几何（对话框画参考线、点预览换算来源座标用）
/* 几何计画：量色差、找直线解 Upright、组矩阵；回 {identity, map(输出→来源，lc_remap 用), fwd(来源→输出), inv(输出→来源 G), upright, ca, cropScale} */
function cr_geomPlan(surf, frame, p){
  const W = RW(frame), H = RH(frame);
  if (!W || !H || cr_geomNeutral(p)) return null;
  let buf = null; const getBuf = () => buf || (buf = surf.readRegion(frame));
  const cx = (frame.x0 + frame.x1) / 2, cy = (frame.y0 + frame.y1) / 2, rd = Math.max(Math.hypot(W, H), 2) / 2;
  const k1 = -p.lensDistortion / 100 * 0.25;
  const ca = p.removeCA ? cr_estimateCA(getBuf(), W, H) : {r:0, b:0, samples:0};
  const undist = (x, y) => {                                         // 来源（有扭曲）→ 镜头校正后：解 p = q·(1+k1·|q|²)
    if (!k1) return [x, y];
    const px = (x - cx) / rd, py = (y - cy) / rd; let ux = px, uy = py;
    for (let i = 0; i < 8; i++){ const f = 1 + k1 * (ux * ux + uy * uy); if (f <= 0.05) break; ux = px / f; uy = py / f; }
    return [cx + ux * rd, cy + uy * rd];
  };
  let up = {rotate:0, vertical:0, horizontal:0, aspect:0, lines:0};
  if (!(p.upright === 'off' || (p.upright === 'guided' && p.uprightGuides.length < 2))){
    const raw = p.upright === 'guided' ? p.uprightGuides.map(g => ({a:[g[0], g[1]], b:[g[2], g[3]], w:1}))
      : cr_detectLines(getBuf(), W, H).map(l => ({a:[l.a[0] + frame.x0, l.a[1] + frame.y0], b:[l.b[0] + frame.x0, l.b[1] + frame.y0], w:l.w}));
    up = cr_uprightSolve(p.upright, raw.map(l => ({a:undist(l.a[0], l.a[1]), b:undist(l.b[0], l.b[1]), w:l.w})), frame);
  }
  const t = {rot:up.rotate + p.transformRotate, vert:up.vertical + p.transformVertical, horiz:up.horizontal + p.transformHorizontal,
    aspect:p.transformAspect + (up.aspect || 0), scale:p.transformScale / 100, ox:p.transformX / 100 * 0.5, oy:-p.transformY / 100 * 0.5};
  const tIdent = t.rot === 0 && t.vert === 0 && t.horiz === 0 && t.aspect === 0 && t.scale === 1 && t.ox === 0 && t.oy === 0;
  const res = {identity:false, upright:up, ca:{red:ca.r, blue:ca.b}, cropScale:1, frame};
  if (tIdent && !k1 && !ca.r && !ca.b && p.lensVignetteAmount === 0){ res.identity = true; res.fwd = (x, y) => [x, y]; res.inv = (x, y) => [x, y]; return res; }
  const vAmt = p.lensVignetteAmount / 100, vStart = 0.15 + clamp(p.lensVignetteMidpoint, 0, 100) / 100 * 0.6;
  const mkMap = M => {
    const Mi = cr_m3inv(M) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return (x, y, o) => {
      const w = Mi[6] * x + Mi[7] * y + Mi[8]; if (w <= 1e-6) return false;
      const qx = (Mi[0] * x + Mi[1] * y + Mi[2]) / w, qy = (Mi[3] * x + Mi[4] * y + Mi[5]) / w;
      const ux = (qx - cx) / rd, uy = (qy - cy) / rd, rad = 1 + k1 * (ux * ux + uy * uy), sx = ux * rad, sy = uy * rad;
      o[0] = cx + sx * rd; o[1] = cy + sy * rd;
      o[2] = cx + sx * (1 + ca.r) * rd; o[3] = cy + sy * (1 + ca.r) * rd;
      o[4] = cx + sx * (1 + ca.b) * rd; o[5] = cy + sy * (1 + ca.b) * rd;
      o[6] = vAmt ? Math.pow(2, vAmt * cr_smoothstep(vStart, 1, Math.sqrt(sx * sx + sy * sy))) : 1;
      return true;
    };
  };
  let M = cr_geomMatrix(t, frame);
  if (p.constrainCrop){                                              // 限制裁切：绕中心放大到输出四边都取得到来源
    const o = new Float64Array(7);
    const covers = m => {
      const Mm = cr_m3mul([m, 0, cx * (1 - m), 0, m, cy * (1 - m), 0, 0, 1], M), f = mkMap(Mm);
      for (let i = 0; i <= 40; i++){                                 // 输出边上的像素中心都要取在来源像素中心以内（不留半透明边）
        const u = i / 40, X = frame.x0 + 0.5 + u * (W - 1), Y = frame.y0 + 0.5 + u * (H - 1);
        const pts = [[X, frame.y0 + 0.5], [X, frame.y1 - 0.5], [frame.x0 + 0.5, Y], [frame.x1 - 0.5, Y]];
        for (const q of pts) if (!f(q[0], q[1], o) || o[0] < frame.x0 + 0.49 || o[0] > frame.x1 - 0.49 || o[1] < frame.y0 + 0.49 || o[1] > frame.y1 - 0.49) return false;
      }
      return true;
    };
    let m = 1;
    if (!covers(1)){
      let lo = 1, hi = 1; while (!covers(hi) && hi < 16) hi *= 1.25;
      for (let k = 0; k < 30; k++){ const mid = (lo + hi) / 2; if (covers(mid)) hi = mid; else lo = mid; }
      m = hi;
    }
    if (m !== 1){ M = cr_m3mul([m, 0, cx * (1 - m), 0, m, cy * (1 - m), 0, 0, 1], M); res.cropScale = Math.round(m * 1e4) / 1e4; }
  }
  res.map = mkMap(M); res.M = M;
  const o7 = new Float64Array(7);
  res.inv = (x, y) => res.map(x, y, o7) ? [o7[0], o7[1]] : null;
  res.fwd = (x, y) => { const q = undist(x, y); return cr_m3apply(M, q[0], q[1]); };
  return res;
}

/* ── 参数（lens_cmds.rs:137 raw_params：serde 反序列化 CameraRaw〔camelCase、缺的用预设、未知键忽略〕；类型不对＝bad params） ── */
const CR_DEFAULTS = () => ({                                        // camera_raw.rs:118 Default（键序同结构）
  temperature:0, tint:0, exposure:0, contrast:0, highlights:0, shadows:0, whites:0, blacks:0, texture:0, clarity:0, dehaze:0, vibrance:0, saturation:0,
  curveHighlights:0, curveLights:0, curveDarks:0, curveShadows:0, curveSplits:[25, 50, 75], pointCurve:[], pointCurveRed:[], pointCurveGreen:[], pointCurveBlue:[],
  hslHue:[0, 0, 0, 0, 0, 0, 0, 0], hslSat:[0, 0, 0, 0, 0, 0, 0, 0], hslLum:[0, 0, 0, 0, 0, 0, 0, 0],
  gradeShadows:{hue:0, sat:0, lum:0}, gradeMidtones:{hue:0, sat:0, lum:0}, gradeHighlights:{hue:0, sat:0, lum:0}, gradeGlobal:{hue:0, sat:0, lum:0}, gradeBlending:50, gradeBalance:0,
  sharpenAmount:0, sharpenRadius:1, sharpenDetail:25, sharpenMasking:0, noiseLuminance:0, noiseLuminanceDetail:50, noiseColor:0, noiseColorDetail:50,
  grainAmount:0, grainSize:25, grainRoughness:50, vignetteAmount:0, vignetteMidpoint:50, vignetteRoundness:0, vignetteFeather:50, vignetteHighlights:0,
  vignetteStyle:'highlightPriority', seed:0, pixelScale:1,
  calShadowTint:0, calRedHue:0, calRedSat:0, calGreenHue:0, calGreenSat:0, calBlueHue:0, calBlueSat:0,  // 照 PS 补：校准面板（原码没有）
  // 照 PS 补：光学（ACR 12）
  removeCA:false, lensProfile:false, lensDistortion:0, defringePurpleAmount:0, defringePurpleHue:[30, 70], defringeGreenAmount:0, defringeGreenHue:[40, 60],
  lensVignetteAmount:0, lensVignetteMidpoint:50,
  // 照 PS 补：几何（ACR 12 Upright＋手动变换）
  upright:'off', uprightGuides:[], transformVertical:0, transformHorizontal:0, transformRotate:0, transformAspect:0, transformScale:100, transformX:0, transformY:0, constrainCrop:false
});
const cr_show = v => { try { return v === undefined ? 'undefined' : JSON.stringify(v); } catch (_){ return String(v); } };
const cr_bad = msg => new FltBad('bad params: ' + msg);
function cr_f32(v, where){
  if (typeof v !== 'number' || !isFinite(v)) throw cr_bad('invalid type: ' + cr_show(v) + ', expected f32 (`' + where + '`)');
  return v;
}
function cr_arr(v, n, where){
  if (!Array.isArray(v)) throw cr_bad('invalid type: ' + cr_show(v) + ', expected an array of length ' + n + ' (`' + where + '`)');
  if (v.length !== n) throw cr_bad('invalid length ' + v.length + ', expected an array of length ' + n + ' (`' + where + '`)');
  return v.map((x, i) => cr_f32(x, where + '[' + i + ']'));
}
function cr_wheel(v, where){
  const out = {hue:0, sat:0, lum:0}, keys = ['hue', 'sat', 'lum'];
  if (Array.isArray(v)){                                            // serde 的结构体也收序列（缺的用预设、多了报错）
    if (v.length > 3) throw cr_bad('invalid length ' + v.length + ', expected struct Wheel (`' + where + '`)');
    v.forEach((x, i) => { out[keys[i]] = cr_f32(x, where + '.' + keys[i]); });
    return out;
  }
  if (!v || typeof v !== 'object') throw cr_bad('invalid type: ' + cr_show(v) + ', expected struct Wheel (`' + where + '`)');
  for (const k of keys) if (v[k] !== undefined) out[k] = cr_f32(v[k], where + '.' + k);
  return out;
}
function cr_params(p){
  if (p === undefined || p === null) p = {};
  if (typeof p !== 'object' || Array.isArray(p)) throw cr_bad('invalid type: ' + cr_show(p) + ', expected struct CameraRaw');
  const out = CR_DEFAULTS();
  for (const k of Object.keys(p)){
    if (k === 'layer' || !Object.prototype.hasOwnProperty.call(out, k)) continue;
    const v = p[k];
    if (k === 'curveSplits') out[k] = cr_arr(v, 3, k);
    else if (k === 'hslHue' || k === 'hslSat' || k === 'hslLum') out[k] = cr_arr(v, 8, k);
    else if (k.startsWith('pointCurve')){
      if (!Array.isArray(v)) throw cr_bad('invalid type: ' + cr_show(v) + ', expected a sequence (`' + k + '`)');
      out[k] = v.map((q, i) => cr_arr(q, 2, k + '[' + i + ']'));
    } else if (k.startsWith('grade') && k !== 'gradeBlending' && k !== 'gradeBalance') out[k] = cr_wheel(v, k);
    else if (k === 'vignetteStyle'){ if (typeof v !== 'string') throw cr_bad('invalid type: ' + cr_show(v) + ', expected a string (`vignetteStyle`)'); out[k] = v; }
    else if (k === 'seed'){ if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 4294967295) throw cr_bad('invalid value: ' + cr_show(v) + ', expected u32 (`seed`)'); out[k] = v; }
    else if (k === 'removeCA' || k === 'lensProfile' || k === 'constrainCrop'){ if (typeof v !== 'boolean') throw cr_bad('invalid type: ' + cr_show(v) + ', expected a boolean (`' + k + '`)'); out[k] = v; }
    else if (k === 'defringePurpleHue' || k === 'defringeGreenHue'){   // 照 ACR：两端最少差 10
      const q = cr_arr(v, 2, k).map(x => clamp(x, 0, 100)); let lo = Math.min(q[0], q[1]), hi = Math.max(q[0], q[1]);
      if (hi - lo < 10){ hi = Math.min(lo + 10, 100); lo = hi - 10; }
      out[k] = [lo, hi];
    }
    else if (k === 'upright'){ if (!CR_UPRIGHT_MODES.includes(v)) throw cr_bad('unknown variant ' + cr_show(v) + ', expected one of ' + CR_UPRIGHT_MODES.join(', ') + ' (`upright`)'); out[k] = v; }
    else if (k === 'uprightGuides'){
      if (!Array.isArray(v)) throw cr_bad('invalid type: ' + cr_show(v) + ', expected a sequence of [x0,y0,x1,y1] (`uprightGuides`)');
      if (v.length > 4) throw cr_bad('at most 4 guides (`uprightGuides`)');
      out[k] = v.map((q, i) => cr_arr(q, 4, k + '[' + i + ']'));
    }
    else out[k] = cr_f32(v, k);
  }
  return out;
}
/* camera_raw_ui.rs:50 command_params：只留跟预设不同的键（不含 pixelScale） */
function cr_cmdParams(v){
  const def = CR_DEFAULTS(), out = {};
  for (const k of Object.keys(def)) if (k !== 'pixelScale' && v[k] !== undefined && JSON.stringify(v[k]) !== JSON.stringify(def[k])) out[k] = JSON.parse(JSON.stringify(v[k]));
  return out;
}

/* ── lens_cmds.rs:154 camera_raw_surface ＋ 180 mix_by_selection ＋ 347 camera_raw_cmd ── */
const CR_PROXY_SIDE = 900;                                          // camera_raw_ui.rs:22
/* 预览代理（camera_raw_ui.rs:97-119 的 k×k 方块平均、pixel_scale＝pw/全宽）。原码只在对话框里显示代理；
   我们的预览要画回图层，所以把代理上算出的「改变量」双线性放大、加回原尺寸像素（细节保留原图的） */
function cr_developProxy(px, w, h, p){
  const k = Math.max(Math.ceil(Math.max(w, h) / CR_PROXY_SIDE), 1), pw = Math.ceil(w / k), ph = Math.ceil(h / k);
  const proxy = new Float32Array(pw * ph * 4), acc = new Float64Array(pw * 5);
  for (let py = 0; py < ph; py++){
    acc.fill(0);
    for (let dy = 0; dy < k; dy++){
      const y = Math.min(py * k + dy, h - 1);
      for (let x = 0; x < w; x++){ const a = ((x / k) | 0) * 5, o = (y * w + x) * 4; acc[a] += px[o]; acc[a + 1] += px[o + 1]; acc[a + 2] += px[o + 2]; acc[a + 3] += px[o + 3]; acc[a + 4] += 1; }
    }
    for (let x = 0; x < pw; x++){ const a = x * 5, o = (py * pw + x) * 4; for (let c = 0; c < 4; c++) proxy[o + c] = acc[a + c] / acc[a + 4]; }
  }
  const dev = proxy.slice();
  cr_develop(dev, pw, ph, Object.assign({}, p, {pixelScale:Math.min(pw / Math.max(w, 1), 1)}), false);
  const delta = new Float32Array(pw * ph * 3);
  for (let i = 0; i < pw * ph; i++) for (let c = 0; c < 3; c++) delta[i * 3 + c] = dev[i * 4 + c] - proxy[i * 4 + c];
  // 双线性放大（同 photo_util bilinear 的夹边规则；x 方向的索引与权重每栏先算好）
  const X0 = new Int32Array(w), X1 = new Int32Array(w), TX = new Float64Array(w);
  for (let x = 0; x < w; x++){ const fx = clamp((x + 0.5) / k - 0.5, 0, pw - 1), x0 = Math.floor(fx); X0[x] = x0 * 3; X1[x] = Math.min(x0 + 1, pw - 1) * 3; TX[x] = fx - x0; }
  for (let y = 0; y < h; y++){
    const fy = clamp((y + 0.5) / k - 0.5, 0, ph - 1), y0 = Math.floor(fy), ty = fy - y0, r0 = y0 * pw * 3, r1 = Math.min(y0 + 1, ph - 1) * pw * 3;
    for (let x = 0; x < w; x++){
      const a = X0[x], b = X1[x], tx = TX[x], o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++){
        const top = delta[r0 + a + c] + (delta[r0 + b + c] - delta[r0 + a + c]) * tx, bot = delta[r1 + a + c] + (delta[r1 + b + c] - delta[r1 + a + c]) * tx;
        const v = px[o + c] + top + (bot - top) * ty; px[o + c] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
  }
}
/* 对一块 Surf 跑：area＝画布 ∪ 内容外框（camera_raw_cmd）；alpha 不动；有选区按覆盖度预乘混回（mix_by_selection）。回传是否有改 */
function cr_applySurf(surf, p, sel, canvas, preview){
  const area = rUnion(canvas, surf.contentBounds());                // camera_raw_surface：area ∩ (content ∪ area) ＝ area
  if (rEmpty(area) || cr_isIdentity(p)) return false;
  const w = RW(area), h = RH(area), px = surf.readRegion(area), orig = px.slice();
  if (preview && Math.max(w, h) > CR_PROXY_SIDE) cr_developProxy(px, w, h, p);   // 预览：跟原码 UI 一样长边 >900 就在代理上算
  else cr_develop(px, w, h, p, false);
  for (let i = 3; i < px.length; i += 4) px[i] = orig[i];            // Alpha is untouched.
  if (sel){
    for (let y = area.y0, i = 0; y < area.y1; y++) for (let x = area.x0; x < area.x1; x++, i += 4){
      const k = clamp(sel.get(x, y), 0, 1), a = orig[i + 3];          // 新旧 alpha 相同 ⇒ oa＝a
      for (let c = 0; c < 3; c++){ const pm = orig[i + c] * a + (px[i + c] * a - orig[i + c] * a) * k; px[i + c] = a > 0 ? pm / a : 0; }
    }
  }
  // 只写回图层现有画布内（外面原本 alpha＝0、alpha 不动 ⇒ 看不见；不让图层画布无谓长大）
  const tgt = rInter(area, surf.rect());
  if (rEmpty(tgt)) return true;
  if (rEq(tgt, area)) surf.writeRegion(area, px);
  else {
    const tw = RW(tgt), sub = new Float32Array(tw * RH(tgt) * 4);
    for (let y = tgt.y0; y < tgt.y1; y++){ const s = ((y - area.y0) * w + (tgt.x0 - area.x0)) * 4; sub.set(px.subarray(s, s + tw * 4), (y - tgt.y0) * tw * 4); }
    surf.writeRegion(tgt, sub);
  }
  return true;
}
SURF_OPS['filter.cameraRaw'] = (L, p, opt) => {
  opt = opt || {};
  const cr = cr_params(p), t0 = performance.now();
  const surf = Surf.fromLayer(L), sel = selCoverage(), canvas = R(0, 0, Doc.width, Doc.height);
  const geo = cr_geomPlan(surf, canvas, cr);                        // 照 PS 补：光学／几何——在原像素上量色差、找直线（develop 之前）
  let changed = cr_applySurf(surf, cr, sel, canvas, !!opt.preview), res = surf;
  if (geo && !geo.identity){                                         // develop 之后一次逆映射（扭曲＋色差＋镜头晕影＋变换），外面＝透明
    const out = lc_remap(surf, canvas, canvas, {t:'transparency'}, geo.map);
    res = sel ? lc_mixBySelection(surf, out, sel) : out; changed = true;
    if (!opt.preview){                                               // 背景层露出透明 ⇒ 变一般图层（同镜头校正）
      const d = res.data; let holes = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 0.999){ holes = true; break; }
      if (holes) lc_floatBackground(L);
    }
  }
  cr_geomLast = geo;
  if (changed){ res.toLayer(L); if (typeof Layer !== 'undefined' && Layer.invalidate) Layer.invalidate(L); }
  const r = {ok:true, layer:L.id, identity:cr_isIdentity(cr) && (!geo || geo.identity), ms:Math.round((performance.now() - t0) * 10) / 10};
  if (geo){
    if (cr.upright !== 'off') r.upright = {mode:cr.upright, rotate:geo.upright.rotate, vertical:geo.upright.vertical, horizontal:geo.upright.horizontal, lines:geo.upright.lines};
    if (cr.upright !== 'off' && geo.upright.aspect) r.upright.aspect = geo.upright.aspect;   // 自动补的长宽比
    if (cr.removeCA) r.chromaticAberration = geo.ca;
    if (cr.constrainCrop) r.cropScale = geo.cropScale;
  }
  if (cr.lensProfile) r.lensProfile = null;                          // 滤镜下没有 EXIF：找不到镜头配置文件（照 PS：勾着但不作用）
  return r;
};
PARAM_SPECS['filter.cameraRaw'] = '{"temperature":-100..100=0,"tint":-100..100=0,"exposure":-5..5=0,"contrast":-100..100=0,"highlights":-100..100=0,"shadows":-100..100=0,"whites":-100..100=0,"blacks":-100..100=0,"texture":-100..100=0,"clarity":-100..100=0,"dehaze":-100..100=0,"vibrance":-100..100=0,"saturation":-100..100=0,"curveHighlights":-100..100=0,"curveLights":-100..100=0,"curveDarks":-100..100=0,"curveShadows":-100..100=0,"curveSplits":[25,50,75],"pointCurve":[[in,out]],"pointCurveRed":[[in,out]],"pointCurveGreen":[[in,out]],"pointCurveBlue":[[in,out]],"hslHue":[8],"hslSat":[8],"hslLum":[8],"gradeShadows":{"hue":deg,"sat":0..100,"lum":-100..100},"gradeMidtones":{},"gradeHighlights":{},"gradeGlobal":{},"gradeBlending":0..100=50,"gradeBalance":-100..100=0,"sharpenAmount":0..150=0,"sharpenRadius":0.5..3=1,"sharpenDetail":0..100=25,"sharpenMasking":0..100=0,"noiseLuminance":0..100=0,"noiseLuminanceDetail":0..100=50,"noiseColor":0..100=0,"noiseColorDetail":0..100=50,"grainAmount":0..100=0,"grainSize":0..100=25,"grainRoughness":0..100=50,"vignetteAmount":-100..100=0,"vignetteMidpoint":0..100=50,"vignetteRoundness":-100..100=0,"vignetteFeather":0..100=50,"vignetteHighlights":0..100=0,"vignetteStyle":"highlightPriority|colorPriority|paintOverlay","seed":u32=0,"calShadowTint":-100..100=0,"calRedHue":-100..100=0,"calRedSat":-100..100=0,"calGreenHue":-100..100=0,"calGreenSat":-100..100=0,"calBlueHue":-100..100=0,"calBlueSat":-100..100=0,"removeCA":bool=false,"lensProfile":bool=false (no EXIF in a filter ⇒ no profile found, no effect),"lensDistortion":-100..100=0 (+ corrects barrel),"defringePurpleAmount":0..20=0,"defringePurpleHue":[lo,hi]=[30,70],"defringeGreenAmount":0..20=0,"defringeGreenHue":[lo,hi]=[40,60],"lensVignetteAmount":-100..100=0 (+ brightens corners),"lensVignetteMidpoint":0..100=50,"upright":"off|auto|level|vertical|full|guided","uprightGuides":[[x0,y0,x1,y1]] (2-4, doc px, for guided),"transformVertical":-100..100=0,"transformHorizontal":-100..100=0,"transformRotate":-10..10=0,"transformAspect":-100..100=0,"transformScale":50..150=100,"transformX":-100..100=0,"transformY":-100..100=0,"constrainCrop":bool=false}';

/* ── 对话框（camera_raw_ui.rs：左边预览、右边分页面板；双击滑杆归零；Y＝切换之前／之后；确定＝只送跟预设不同的参数） ── */
const CR_STR = {
  basic:S('基本', '基本', 'Basic'), curve:S('曲線', '曲线', 'Curve'), detail:S('細節', '细节', 'Detail'), mixer:S('混色器', '混色器', 'Color Mixer'),
  grading:S('顏色分級', '颜色分级', 'Color Grading'), effects:S('效果', '效果', 'Effects'),
  wbAsShot:S('白平衡：原相機設定', '白平衡：原照设置', 'White Balance: As Shot'),
  temperature:S('色溫', '色温', 'Temperature'), tint:S('色調', '色调', 'Tint'), exposure:S('曝光度', '曝光', 'Exposure'), contrast:S('對比', '对比度', 'Contrast'),
  highlights:S('亮部', '高光', 'Highlights'), shadows:S('陰影', '阴影', 'Shadows'), whites:S('白色', '白色', 'Whites'), blacks:S('黑色', '黑色', 'Blacks'),
  texture:S('紋理', '纹理', 'Texture'), clarity:S('清晰度', '清晰度', 'Clarity'), dehaze:S('去朦朧', '去除薄雾', 'Dehaze'),
  vibrance:S('細節飽和度', '自然饱和度', 'Vibrance'), saturation:S('飽和度', '饱和度', 'Saturation'),
  lights:S('亮色調', '亮调', 'Lights'), darks:S('暗色調', '暗调', 'Darks'),
  sharpening:S('銳利化', '锐化', 'Sharpening'), amount:S('總量', '数量', 'Amount'), radius:S('強度', '半径', 'Radius'), detailS:S('細節', '细节', 'Detail'), masking:S('遮色片', '蒙版', 'Masking'),
  noiseReduction:S('雜色減少', '减少杂色', 'Noise Reduction'), luminance:S('明度', '明亮度', 'Luminance'), luminanceDetail:S('明度細節', '明亮度细节', 'Luminance Detail'),
  color:S('顏色', '颜色', 'Color'), colorDetail:S('顏色細節', '颜色细节', 'Color Detail'),
  hue:S('色相', '色相', 'Hue'), midtones:S('中間調', '中间调', 'Midtones'), global:S('整體', '全局', 'Global'), blending:S('混合', '混合', 'Blending'), balance:S('平衡', '平衡', 'Balance'),
  grain:S('顆粒', '颗粒', 'Grain'), size:S('大小', '大小', 'Size'), roughness:S('粗糙度', '粗糙度', 'Roughness'),
  vignetting:S('暈映', '晕影', 'Vignetting'), style:S('樣式', '样式', 'Style'), highlightPriority:S('亮部優先', '高光优先', 'Highlight Priority'),
  colorPriority:S('顏色優先', '颜色优先', 'Color Priority'), paintOverlay:S('繪畫覆蓋', '绘画叠加', 'Paint Overlay'),
  midpoint:S('中點', '中点', 'Midpoint'), roundness:S('圓度', '圆度', 'Roundness'), feather:S('羽化', '羽化', 'Feather'),
  before:S('之前 (Y)', '之前 (Y)', 'Before (Y)'), noLayer:S('Camera Raw 濾鏡需要像素圖層', 'Camera Raw 滤镜需要像素图层', 'Camera Raw Filter needs a pixel layer'),
  curveHint:S('按一下加點、拖曳移動、按右鍵刪除', '单击添加点、拖动移动、右键删除', 'Click to add a point, drag to move, right-click to delete'),
  calibration:S('校正', '校准', 'Calibration'), redPrimary:S('紅色原色', '红原色', 'Red Primary'), greenPrimary:S('綠色原色', '绿原色', 'Green Primary'),
  bluePrimary:S('藍色原色', '蓝原色', 'Blue Primary'), tintS:S('色調', '色调', 'Tint'),
  curPar:S('參數曲線', '参数曲线', 'Parametric Curve'), curRgb:S('點曲線', '点曲线', 'Point Curve'), curRed:S('紅色色版', '红色通道', 'Red Channel'),
  curGreen:S('綠色色版', '绿色通道', 'Green Channel'), curBlue:S('藍色色版', '蓝色通道', 'Blue Channel'), regions:S('區域', '区域', 'Regions')
};
const CR_BANDS = [S('紅色', '红色', 'Red'), S('橙色', '橙色', 'Orange'), S('黃色', '黄色', 'Yellow'), S('綠色', '绿色', 'Green'), S('水綠色', '浅绿色', 'Aqua'),
  S('藍色', '蓝色', 'Blue'), S('紫色', '紫色', 'Purple'), S('洋紅色', '洋红', 'Magenta')];
const CR_TABS = ['basic', 'curve', 'detail', 'mixer', 'grading', 'optics', 'geometry', 'effects', 'calibration'];   // PS 次序（ACR 12）：…颜色分级、光学、几何、效果、校准
/* 照 PS 补：光学／几何两页的字（ACR 12 简体／繁体／英文） */
Object.assign(CR_STR, {
  optics:S('光學', '光学', 'Optics'), geometry:S('幾何', '几何', 'Geometry'),
  opProfile:S('描述檔', '配置文件', 'Profile'), opManual:S('手動', '手动', 'Manual'),
  removeCA:S('移除色差', '删除色差', 'Remove Chromatic Aberration'), lensProfile:S('使用描述檔校正', '使用配置文件校正', 'Use Profile Corrections'),
  noProfile:S('找不到相符的鏡頭描述檔（濾鏡沒有相機 EXIF），不套用', '未找到匹配的镜头配置文件（滤镜没有相机 EXIF），不套用', 'No matching lens profile found (a filter has no camera EXIF); not applied'),
  caFound:S('偵測到的色差', '检测到的色差', 'Detected aberration'), distortion:S('扭曲', '扭曲度', 'Distortion'), defringe:S('去除邊緣色彩', '去边', 'Defringe'),
  purpleAmount:S('紫色量', '紫色数量', 'Purple Amount'), purpleHueLo:S('紫色色相（起）', '紫色色相（起）', 'Purple Hue (from)'), purpleHueHi:S('紫色色相（迄）', '紫色色相（止）', 'Purple Hue (to)'),
  greenAmount:S('綠色量', '绿色数量', 'Green Amount'), greenHueLo:S('綠色色相（起）', '绿色色相（起）', 'Green Hue (from)'), greenHueHi:S('綠色色相（迄）', '绿色色相（止）', 'Green Hue (to)'),
  lensVignette:S('暈映', '晕影', 'Vignetting'),
  up_off:S('關閉', '关闭', 'Off'), up_auto:S('自動', '自动', 'Auto'), up_level:S('水平', '水平', 'Level'), up_vertical:S('垂直', '纵向', 'Vertical'),
  up_full:S('完整', '完全', 'Full'), up_guided:S('參考線', '通过使用参考线', 'Guided'),
  up_offTip:S('停用 Upright', '禁用 Upright', 'Upright off'), up_autoTip:S('自動：套用平衡透視校正', '自动：应用平衡透视校正', 'Auto: apply balanced perspective corrections'),
  up_levelTip:S('水平：只套用水平校正', '水平：仅应用水平校正', 'Level: apply only level correction'),
  up_verticalTip:S('垂直：套用水平與垂直透視校正', '纵向：应用水平和纵向透视校正', 'Vertical: apply level and vertical perspective corrections'),
  up_fullTip:S('完整：套用水平、橫向與垂直透視校正', '完全：应用水平、横向和纵向透视校正', 'Full: apply level, horizontal, and vertical perspective corrections'),
  up_guidedTip:S('在預覽上拖曳畫 2–4 條參考線（按右鍵刪除）', '在预览上拖动画 2–4 条参考线（右键删除）', 'Drag on the preview to draw 2–4 guides (right-click deletes)'),
  clearGuides:S('清除參考線', '清除参考线', 'Clear Guides'), solved:S('Upright 解出', 'Upright 解出', 'Upright solved'),
  manualTransform:S('手動變形', '手动变换', 'Manual Transformations'), tVertical:S('垂直', '垂直', 'Vertical'), tHorizontal:S('水平', '水平', 'Horizontal'),
  tRotate:S('旋轉', '旋转', 'Rotate'), tAspect:S('外觀比例', '长宽比', 'Aspect'), tScale:S('縮放', '缩放', 'Scale'), tX:S('X 位移', 'X 轴偏移', 'Offset X'), tY:S('Y 位移', 'Y 轴偏移', 'Offset Y'),
  constrainCrop:S('強制裁切', '限制裁切', 'Constrain Crop')
});
const CR_UPRIGHT_UI = CR_UPRIGHT_MODES;
/* 曲线面板上方五颗（PS：参数曲线／点曲线〔RGB〕／红／绿／蓝） */
const CR_CURVES = [['par', null, 'curPar', '#9aa0a6'], ['rgb', 'pointCurve', 'curRgb', '#e6e8eb'], ['r', 'pointCurveRed', 'curRed', '#e5484d'],
  ['g', 'pointCurveGreen', 'curGreen', '#46a758'], ['b', 'pointCurveBlue', 'curBlue', '#3e7ee8']];
const CR_MIX = [['hue', 'hslHue', CR_STR.hue], ['sat', 'hslSat', CR_STR.saturation], ['lum', 'hslLum', CR_STR.luminance]];
const cr_hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const CR_TEMP_STOPS = ['rgb(70,120,230)', 'rgb(200,200,200)', 'rgb(235,200,60)'];   // camera_raw_ui.rs:195
const CR_TINT_STOPS = ['rgb(70,190,80)', 'rgb(200,200,200)', 'rgb(210,80,200)'];    // camera_raw_ui.rs:198
const CR_HUE_STOPS = Array.from({length:13}, (_, i) => { cr_hsvToRgb(i / 12 * 360, 0.85, 1); return cr_hex(cr_linearToSrgb(cr_rgb[0]) * 255, cr_linearToSrgb(cr_rgb[1]) * 255, cr_linearToSrgb(cr_rgb[2]) * 255); });   // widgets.rs:360 hue_stops（egui Hsva 是线性光）
function cr_hueColor(h){                                           // camera_raw_ui.rs:456 hue_color
  const h6 = cr_remEuclid(h, 360) / 60, x = 1 - Math.abs((h6 % 2) - 1);
  const t = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1]][Math.trunc(h6)] || [1, 0, x];
  return cr_hex(Math.trunc(t[0] * 220), Math.trunc(t[1] * 220), Math.trunc(t[2] * 220));
}
let cr_checker = null;
function cr_drawPreview(st){
  const cv = st.cv; if (!cv || !cv.isConnected) return;
  const x = cv.getContext('2d'), W = Doc.width, H = Doc.height, s = Math.min(cv.width / W, cv.height / H);
  x.clearRect(0, 0, cv.width, cv.height);
  const dw = W * s, dh = H * s, ox = (cv.width - dw) / 2, oy = (cv.height - dh) / 2;
  if (!cr_checker){ const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#ccc'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8); cr_checker = c; }
  x.save(); x.beginPath(); x.rect(ox, oy, dw, dh); x.clip();
  x.fillStyle = x.createPattern(cr_checker, 'repeat'); x.fillRect(ox, oy, dw, dh);
  const live = st.smart ? Smart.render(st.L) : st.L.data.canvas;     // 智能对象：预览＝带着暂记滤镜的外观（文件大小、0,0）
  const src = st.before ? st.beforeCanvas : live, lx = st.before ? st.bx : st.smart ? 0 : (st.L.x || 0), ly = st.before ? st.by : st.smart ? 0 : (st.L.y || 0);
  if (src && src.width && src.height){ x.imageSmoothingQuality = 'high'; x.drawImage(src, ox + lx * s, oy + ly * s, src.width * s, src.height * s); }
  x.restore();
  // 照 PS 补：几何 ▸ 参考线（来源座标，经目前变换画到预览上；拉直后就是竖／横的）
  const v = st.v;
  if (!st.before && st.tab === 'geometry' && v && v.upright === 'guided'){
    const g = cr_geomLast, fwd = (px, py) => (g && g.fwd ? g.fwd(px, py) : [px, py]) || [px, py];
    const line = (q, col) => { const a = fwd(q[0], q[1]), b = fwd(q[2], q[3]); x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.moveTo(ox + a[0] * s, oy + a[1] * s); x.lineTo(ox + b[0] * s, oy + b[1] * s); x.stroke();
      x.fillStyle = col; for (const p of [a, b]){ x.beginPath(); x.arc(ox + p[0] * s, oy + p[1] * s, 3, 0, TAU); x.fill(); } };
    v.uprightGuides.forEach(q => line(q, '#f5d90a'));
    if (st.gdrag) line([st.gdrag.a[0], st.gdrag.a[1], st.gdrag.b[0], st.gdrag.b[1]], '#7ee787');
  }
  if (st.msEl) st.msEl.textContent = st.ms !== undefined ? st.ms.toFixed(0) + ' ms' : '';
}
/* 照 PS 补：光学／几何页下方的说明（检测到的色差、Upright 解出的量） */
function cr_geomInfo(st, v){
  const e = st.infoEl, r = st.res; if (!e || !e.isConnected || !v) return;
  if (st.tab === 'optics'){
    e.textContent = v.removeCA && r && r.chromaticAberration ? tr(CR_STR.caFound) + '：R ' + (r.chromaticAberration.red * 100).toFixed(2) + '%　B ' + (r.chromaticAberration.blue * 100).toFixed(2) + '%' : '';
  } else {
    const u = r && r.upright;
    e.textContent = v.upright !== 'off' && u ? tr(CR_STR.solved) + '：' + tr(CR_STR.tRotate) + ' ' + u.rotate.toFixed(2) + '°　' + tr(CR_STR.tVertical) + ' ' + u.vertical.toFixed(1) + '　' + tr(CR_STR.tHorizontal) + ' ' + u.horizontal.toFixed(1) + (u.aspect ? '　' + tr(CR_STR.tAspect) + ' ' + u.aspect.toFixed(1) : '') +
      (r.cropScale && r.cropScale !== 1 ? '　×' + r.cropScale.toFixed(3) : '') : (r && r.cropScale && r.cropScale !== 1 ? tr(CR_STR.constrainCrop) + ' ×' + r.cropScale.toFixed(3) : '');
  }
}
/* 照 PS 补：Upright ▸ 参考线工具——在预览上拖一条（最多 4 条）、右键删最近的；存来源座标（用目前的变换把点换回去） */
function cr_guideTool(st, v){
  const cv = st.cv; if (!cv) return;
  cv.style.cursor = 'crosshair';
  const toDoc = e => {
    const r = cv.getBoundingClientRect(), W = Doc.width, H = Doc.height, s = Math.min(cv.width / W, cv.height / H);
    const ox = (cv.width - W * s) / 2, oy = (cv.height - H * s) / 2;
    const dx = ((e.clientX - r.left) * cv.width / r.width - ox) / s, dy = ((e.clientY - r.top) * cv.height / r.height - oy) / s;
    const g = cr_geomLast; return (g && g.inv ? g.inv(dx, dy) : null) || [dx, dy];
  };
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    const q = toDoc(e);
    if (e.button === 2){
      let bi = -1, bd = Infinity;
      v.uprightGuides.forEach((g, i) => { const ax = g[2] - g[0], ay = g[3] - g[1], l2 = ax * ax + ay * ay || 1, t = clamp(((q[0] - g[0]) * ax + (q[1] - g[1]) * ay) / l2, 0, 1), d = Math.hypot(g[0] + ax * t - q[0], g[1] + ay * t - q[1]); if (d < bd){ bd = d; bi = i; } });
      if (bi >= 0 && bd < Math.max(Doc.width, Doc.height) * 0.04){ v.uprightGuides = v.uprightGuides.filter((_, i) => i !== bi); Dlg.changed(true); }
      return;
    }
    if (e.button !== 0 || v.uprightGuides.length >= 4) return;
    st.gdrag = {a:q, b:q}; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => { if (!st.gdrag) return; st.gdrag.b = toDoc(e); cr_drawPreview(st); });
  const up = () => {
    const d = st.gdrag; st.gdrag = null; if (!d) return;
    if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < Math.max(4, Math.max(Doc.width, Doc.height) * 0.02)){ cr_drawPreview(st); return; }
    v.uprightGuides = v.uprightGuides.concat([[d.a[0], d.a[1], d.b[0], d.b[1]].map(z => Math.round(z * 10) / 10)]); Dlg.changed(true);
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { st.gdrag = null; cr_drawPreview(st); });
}
/* camera_raw_ui.rs:227 curve_editor：主通道点曲线（按一下加点、拖移、右键删除〔端点不删〕） */
/* 照 PS 补：key＝要编的点曲线（pointCurve／pointCurveRed／Green／Blue，曲线画成该通道色）；key＝null＝参数曲线（只画、不能点，靠下面四条滑杆） */
function cr_curveEditor(ui, v, st, key, color){
  key = key === undefined ? 'pointCurve' : key; color = color || '#e6e8eb';
  const side = 260, cv = ui.canvas(side, side, 'crCurve'); cv.style.cursor = key ? 'crosshair' : 'default';
  const pts = () => (v[key].length < 2 ? [[0, 0], [255, 255]] : v[key]);   // 原码一打开就把空曲线改成两端点；这里等真的动了才写进参数（结果相同：直线＝不作用）
  const toS = (px, py) => [px / 255 * side, side - py / 255 * side];
  const fromS = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / side * 255, 0, 255), clamp((side - (e.clientY - r.top)) / side * 255, 0, 255)]; };
  const draw = () => {
    const g = cv.getContext('2d'); g.fillStyle = '#1e2126'; g.fillRect(0, 0, side, side); g.strokeStyle = '#444a54'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++){ const f = i / 4 * side; g.beginPath(); g.moveTo(f, 0); g.lineTo(f, side); g.moveTo(0, f); g.lineTo(side, f); g.stroke(); }
    g.strokeStyle = '#555c66'; g.beginPath(); g.moveTo(0, side); g.lineTo(side, 0); g.stroke();   // 对角基准线
    const lut = key ? cr_curveLut(pts(), 256) : cr_parametricLut(v, 256); g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i < 256; i++){ const q = toS(i, lut[i] * 255); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); } g.stroke();
    if (!key){ g.strokeStyle = '#6b7280'; g.setLineDash([3, 3]); for (const s of v.curveSplits){ const x = clamp(s, 5, 95) / 100 * side; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, side); g.stroke(); } g.setLineDash([]); return; }
    g.strokeStyle = '#2f7fd8'; for (const c of pts()){ const q = toS(c[0], c[1]); g.beginPath(); g.arc(q[0], q[1], 4, 0, TAU); g.stroke(); }
  };
  if (key){
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      const q = fromS(e), r = cv.getBoundingClientRect();
      if (v[key].length < 2) v[key] = [[0, 0], [255, 255]]; else v[key] = v[key].map(c => c.slice());
      const near = v[key].findIndex(c => { const s = toS(c[0], c[1]); return Math.hypot(s[0] - (e.clientX - r.left), s[1] - (e.clientY - r.top)) < 8; });
      if (e.button === 2){
        if (near > 0 && near + 1 !== v[key].length){ v[key].splice(near, 1); draw(); Dlg.schedule(); }
        return;
      }
      if (near >= 0) st.drag = near;
      else { v[key].push(q); v[key].sort((a, b) => a[0] - b[0]); st.drag = v[key].indexOf(q); draw(); Dlg.schedule(); }
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (st.drag === null || st.drag === undefined) return;
      const i = st.drag, n = v[key].length, q = fromS(e);
      const lo = i === 0 ? 0 : v[key][i - 1][0] + 1, hi = i + 1 === n ? 255 : v[key][i + 1][0] - 1;
      v[key][i] = [clamp(q[0], lo, Math.max(hi, lo)), q[1]]; draw(); Dlg.schedule();
    });
    const up = () => { st.drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  st.drawCurve = draw;
  ui.add(cv); if (key) ui.note(tr(CR_STR.curveHint)); draw();
}
function cr_dialog(init){
  const L = Doc.active();
  // 照 PS 补：智能对象也能开（预览／确定＝记成智能滤镜，双击滤镜名带原参数重开）
  const smart = !!(L && L.kind === 'smart' && L.data && window.Smart);
  if (!L || (L.kind !== 'raster' && !smart)){ toast(tr(CR_STR.noLayer)); return null; }
  const lk = lockMsg(L); if (lk){ toast(lk); return null; }
  let v; try { v = cr_params(init || {}); } catch (_){ v = CR_DEFAULTS(); }
  const srcC = smart ? Smart.render(L) : L.data.canvas;
  const bc = document.createElement('canvas'); bc.width = srcC.width; bc.height = srcC.height;
  if (bc.width && bc.height) bc.getContext('2d').drawImage(srcC, 0, 0);
  cr_geomLast = null;
  const st = {tab:'basic', mix:1, curve:'par', before:false, L, smart, beforeCanvas:bc, bx:smart ? 0 : (L.x || 0), by:smart ? 0 : (L.y || 0), cv:null, msEl:null, ms:undefined, drag:null};
  const title = menuName('filter.cameraRaw') + (Lang.cur === 'en' ? ' (' + L.name + ')' : '（' + L.name + '）');
  /* 一条滑杆：data-k＝参数键（阵列元素＝键.序号、色轮＝键.hue/sat/lum）；双击归零（camera_raw_ui.rs:208，零在范围外就夹回） */
  const slider = (ui, k, label, min, max, get, set, grad) => {
    const row = ui.slider({k, label:tr(label), min, max, step:max - min <= 10 ? 0.01 : 1, get, set});
    const rng = row.querySelector('input[type=range]');
    if (grad){ rng.style.background = 'linear-gradient(to right,' + grad.join(',') + ')'; rng.style.borderRadius = '3px'; rng.style.height = '6px'; }
    rng.addEventListener('dblclick', () => { set(clamp(0, min, max)); Dlg.changed(true); });
    return row;
  };
  const num = (ui, k, label, min, max, grad) => slider(ui, k, label, min, max, () => v[k], x => { v[k] = x; }, grad);
  const hair = ui => ui.add(el('div', {style:'border-top:1px solid #444a54;margin:6px 0'}));
  const wheel = (ui, k, label) => {
    ui.sec(tr(label));
    [['hue', CR_STR.hue, 0, 360, CR_HUE_STOPS], ['sat', CR_STR.saturation, 0, 100], ['lum', CR_STR.luminance, -100, 100]].forEach(([f, lb, mn, mx, grad]) =>
      slider(ui, k + '.' + f, lb, mn, mx, () => v[k][f], x => { v[k] = Object.assign({}, v[k], {[f]:x}); }, grad));
  };
  const box = Dlg.open({id:'filter.cameraRaw', title, wide:true, v, state:st, params:vv => cr_cmdParams(vv),
    build(ui, v, st){
      st.v = v; st.gdrag = null;
      const bd = ui.root, H = Math.max(240, bd.clientHeight - 24), Wp = Math.max(240, bd.clientWidth - 24 - 330 - 14);
      const left = el('div', {style:'flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px'});
      const right = el('div', {style:'width:330px;flex:none;overflow:auto;border-left:1px solid #444a54;padding-left:12px'});
      ui.add(el('div', {style:'display:flex;gap:12px;height:' + H + 'px'}, [left, right]));
      const W = Doc.width || 1, Hd = Doc.height || 1, sc = Math.min(Wp / W, (H - 34) / Hd);
      const cv = el('canvas', {width:Math.max(1, Math.floor(W * sc)), height:Math.max(1, Math.floor(Hd * sc)), data:{k:'crPreview'}});
      left.appendChild(cv); st.cv = cv;
      const bcb = el('input', {type:'checkbox', checked:st.before, data:{k:'crBefore'}}); bcb.onchange = () => { st.before = bcb.checked; cr_drawPreview(st); };
      st.msEl = el('span', {className:'note', style:'margin-left:12px'});
      left.appendChild(el('div', {className:'row'}, [el('label', {}, [bcb, ' ' + tr(CR_STR.before)]), st.msEl]));
      const rui = makeUI(right, Dlg);
      const tabs = el('div', {style:'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px'});
      CR_TABS.forEach(k => { const b = rui.button(tr(CR_STR[k]), () => { st.tab = k; Dlg.render(); }, 'crTab-' + k); if (st.tab === k) b.className = 'on'; tabs.appendChild(b); });
      rui.add(tabs);
      if (st.tab === 'basic'){
        rui.sec(tr(CR_STR.wbAsShot));
        num(rui, 'temperature', CR_STR.temperature, -100, 100, CR_TEMP_STOPS); num(rui, 'tint', CR_STR.tint, -100, 100, CR_TINT_STOPS);
        num(rui, 'exposure', CR_STR.exposure, -5, 5); num(rui, 'contrast', CR_STR.contrast, -100, 100); num(rui, 'highlights', CR_STR.highlights, -100, 100);
        num(rui, 'shadows', CR_STR.shadows, -100, 100); num(rui, 'whites', CR_STR.whites, -100, 100); num(rui, 'blacks', CR_STR.blacks, -100, 100);
        hair(rui);
        num(rui, 'texture', CR_STR.texture, -100, 100); num(rui, 'clarity', CR_STR.clarity, -100, 100); num(rui, 'dehaze', CR_STR.dehaze, -100, 100);
        hair(rui);
        num(rui, 'vibrance', CR_STR.vibrance, -100, 100); num(rui, 'saturation', CR_STR.saturation, -100, 100);
      } else if (st.tab === 'curve'){
        // 照 PS 补：上方五颗选曲线（参数曲线／点曲线 RGB／红／绿／蓝），点曲线可分通道
        const cbar = el('div', {style:'display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 8px'});
        CR_CURVES.forEach(([id, , lb, col]) => {
          const b = rui.button('', () => { st.curve = id; st.drag = null; Dlg.render(); }, 'crCurveCh-' + id); b.title = tr(CR_STR[lb]);
          b.appendChild(el('span', {style:'display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:-1px;margin-right:4px;background:' + (id === 'par' ? 'transparent;border:1px solid ' + col : col)}));
          b.appendChild(document.createTextNode(tr(CR_STR[lb]).replace(/(色版|通道|Channel)$/, '').trim()));
          if (st.curve === id) b.className = 'on'; cbar.appendChild(b);
        });
        rui.add(cbar);
        const cc = CR_CURVES.find(c => c[0] === st.curve) || CR_CURVES[0];
        cr_curveEditor(rui, v, st, cc[1], cc[3]);
        if (!cc[1]){
          const pn = (k, lb) => slider(rui, k, lb, -100, 100, () => v[k], x => { v[k] = x; if (st.drawCurve) st.drawCurve(); });
          rui.sec(tr(CR_STR.regions));
          pn('curveHighlights', CR_STR.highlights); pn('curveLights', CR_STR.lights); pn('curveDarks', CR_STR.darks); pn('curveShadows', CR_STR.shadows);
        }
      } else if (st.tab === 'detail'){
        rui.sec(tr(CR_STR.sharpening));
        num(rui, 'sharpenAmount', CR_STR.amount, 0, 150); num(rui, 'sharpenRadius', CR_STR.radius, 0.5, 3);
        num(rui, 'sharpenDetail', CR_STR.detailS, 0, 100); num(rui, 'sharpenMasking', CR_STR.masking, 0, 100);
        rui.sec(tr(CR_STR.noiseReduction));
        num(rui, 'noiseLuminance', CR_STR.luminance, 0, 100); num(rui, 'noiseLuminanceDetail', CR_STR.luminanceDetail, 0, 100);
        num(rui, 'noiseColor', CR_STR.color, 0, 100); num(rui, 'noiseColorDetail', CR_STR.colorDetail, 0, 100);
      } else if (st.tab === 'mixer'){
        // 照 PS 补：「调整」下拉 HSL／颜色；HSL 分页 色相／饱和度／明亮度／全部；颜色＝八色块挑一色、该色的色相／饱和度／明亮度三条
        // 查证：「颜色」模式是 ACR 12.3（2020-06，新界面、HSL 面板改名「混色器」同一版）加的，PS 2020（21.2）就用得到——
        // photocascadia.com「Best New Features in Camera Raw 12.3」：“you now have two choices HSL or Color”；jkost.com 2020-06「ACR v12.3」。
        // ACR 12.0（2019-11）旧界面是「HSL／灰度」页、只有色相／饱和度／明亮度三个子页，但我们整个对话框照的是 12.3+ 新界面，故留着；缺省 HSL，「颜色」藏在「调整」下拉后面。
        const mode = st.mixMode || 'hsl';
        rui.select({k:'crMixMode', label:tr(S('調整', '调整', 'Adjust')), options:[['hsl', 'HSL'], ['color', tr(CR_STR.color)]], get:() => mode, set:x => { st.mixMode = x; }, rebuild:true});
        const band = (key, k, lb) => slider(rui, key + '.' + k, lb, -100, 100, () => v[key][k], x => { v[key] = v[key].slice(); v[key][k] = x; }, ['rgb(128,128,128)', cr_hueColor(CR_HSL_BANDS[k])]);
        if (mode === 'color'){
          const sw = el('div', {style:'display:flex;gap:6px;margin:6px 0 10px'}), cb = st.mixBand || 0;
          CR_BANDS.forEach((nm, k) => { const d = el('div', {title:tr(nm), data:{k:'crMixBand-' + k}, style:'width:20px;height:20px;border-radius:50%;cursor:pointer;background:' + cr_hueColor(CR_HSL_BANDS[k]) + ';outline:' + (k === cb ? '2px solid #e6e8eb' : '1px solid #0006') + ';outline-offset:1px'});
            d.onclick = () => { st.mixBand = k; Dlg.render(); }; sw.appendChild(d); });
          rui.add(sw); rui.sec(tr(CR_BANDS[cb]));
          CR_MIX.forEach(([, key, lb]) => band(key, cb, lb));
        } else {
          const pills = el('div', {style:'display:flex;gap:4px;margin:4px 0 8px'});
          CR_MIX.concat([['all', null, S('全部', '全部', 'All')]]).forEach(([nm, , lb], i) => { const b = rui.button(tr(lb), () => { st.mix = i; Dlg.render(); }, 'crMix-' + nm); if (st.mix === i) b.className = 'on'; pills.appendChild(b); });
          rui.add(pills);
          if (st.mix === 3) CR_MIX.forEach(([, key, lb]) => { rui.sec(tr(lb)); CR_BANDS.forEach((nm, k) => band(key, k, nm)); });
          else CR_BANDS.forEach((nm, k) => band(CR_MIX[st.mix][1], k, nm));
        }
      } else if (st.tab === 'grading'){
        wheel(rui, 'gradeShadows', CR_STR.shadows); wheel(rui, 'gradeMidtones', CR_STR.midtones); wheel(rui, 'gradeHighlights', CR_STR.highlights); wheel(rui, 'gradeGlobal', CR_STR.global);
        hair(rui);
        num(rui, 'gradeBlending', CR_STR.blending, 0, 100); num(rui, 'gradeBalance', CR_STR.balance, -100, 100);
      } else if (st.tab === 'optics' || st.tab === 'geometry'){       // 照 PS 补（ACR 12）：光学／几何
        const DEF = CR_DEFAULTS();
        const numD = (k, label, min, max, step, grad) => {             // 双击＝回预设（缩放 100、中点 50…）
          const row = rui.slider({k, label:tr(label), min, max, step, get:() => v[k], set:x => { v[k] = x; }});
          const rng = row.querySelector('input[type=range]');
          if (grad){ rng.style.background = 'linear-gradient(to right,' + grad.join(',') + ')'; rng.style.borderRadius = '3px'; rng.style.height = '6px'; }
          rng.addEventListener('dblclick', () => { v[k] = DEF[k]; Dlg.changed(true); });
          return row;
        };
        const hueRange = (key, i, label, h0, span) => {               // 色相范围的一端（两端至少差 10，照 ACR）
          const row = rui.slider({k:key + '.' + i, label:tr(label), min:0, max:100, step:1, get:() => v[key][i], set:x => { const q = v[key].slice(); q[i] = i ? Math.max(x, q[0] + 10) : Math.min(x, q[1] - 10); q[i] = clamp(q[i], 0, 100); v[key] = q; }});
          const rng = row.querySelector('input[type=range]');
          rng.style.background = 'linear-gradient(to right,' + [0, 0.25, 0.5, 0.75, 1].map(f => cr_hueColor(h0 + f * span)).join(',') + ')'; rng.style.borderRadius = '3px'; rng.style.height = '6px';
          rng.addEventListener('dblclick', () => { v[key] = DEF[key].slice(); Dlg.changed(true); });
        };
        st.infoEl = null;
        if (st.tab === 'optics'){
          const pills = el('div', {style:'display:flex;gap:4px;margin:4px 0 8px'}), op = st.optics || 'profile';
          [['profile', 'opProfile'], ['manual', 'opManual']].forEach(([id, lb]) => { const b = rui.button(tr(CR_STR[lb]), () => { st.optics = id; Dlg.render(); }, 'crOptics-' + id); if (op === id) b.className = 'on'; pills.appendChild(b); });
          rui.add(pills);
          if (op === 'profile'){
            rui.check({k:'removeCA', label:tr(CR_STR.removeCA), get:() => v.removeCA, set:x => { v.removeCA = x; }});
            rui.check({k:'lensProfile', label:tr(CR_STR.lensProfile), get:() => v.lensProfile, set:x => { v.lensProfile = x; }, rebuild:true});
            if (v.lensProfile) rui.note(tr(CR_STR.noProfile));
            st.infoEl = rui.note(''); st.infoEl.dataset.k = 'crCaInfo';
          } else {
            numD('lensDistortion', CR_STR.distortion, -100, 100, 1);
            rui.sec(tr(CR_STR.defringe));
            numD('defringePurpleAmount', CR_STR.purpleAmount, 0, 20, 1, ['rgb(128,128,128)', cr_hueColor(280)]);
            hueRange('defringePurpleHue', 0, CR_STR.purpleHueLo, 230, 100); hueRange('defringePurpleHue', 1, CR_STR.purpleHueHi, 230, 100);
            numD('defringeGreenAmount', CR_STR.greenAmount, 0, 20, 1, ['rgb(128,128,128)', cr_hueColor(120)]);
            hueRange('defringeGreenHue', 0, CR_STR.greenHueLo, 60, 120); hueRange('defringeGreenHue', 1, CR_STR.greenHueHi, 60, 120);
            rui.sec(tr(CR_STR.lensVignette));
            const amt = numD('lensVignetteAmount', CR_STR.amount, -100, 100, 1, ['rgb(40,40,40)', 'rgb(128,128,128)', 'rgb(235,235,235)']);
            const mid = numD('lensVignetteMidpoint', CR_STR.midpoint, 0, 100, 1);
            const gray = () => mid.querySelectorAll('input').forEach(i => { i.disabled = v.lensVignetteAmount === 0; });   // ACR：数量 0 时中点灰掉
            amt.querySelectorAll('input').forEach(i => i.addEventListener('input', gray)); gray();
          }
        } else {
          rui.sec('Upright');
          const ub = el('div', {style:'display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px'});
          CR_UPRIGHT_UI.forEach(id => { const b = rui.button(tr(CR_STR['up_' + id]), () => { v.upright = id; Dlg.changed(true); }, 'crUpright-' + id); b.title = tr(CR_STR['up_' + id + 'Tip']); if (v.upright === id) b.className = 'on'; ub.appendChild(b); });
          rui.add(ub);
          rui.note(tr(CR_STR['up_' + v.upright + 'Tip']) + (v.upright === 'guided' ? '　' + v.uprightGuides.length + '/4' : ''));
          if (v.upright === 'guided' && v.uprightGuides.length) rui.add(rui.button(tr(CR_STR.clearGuides), () => { v.uprightGuides = []; Dlg.changed(true); }, 'crClearGuides'));
          st.infoEl = rui.note(''); st.infoEl.dataset.k = 'crUprightInfo';
          rui.check({k:'constrainCrop', label:tr(CR_STR.constrainCrop), get:() => v.constrainCrop, set:x => { v.constrainCrop = x; }});
          rui.sec(tr(CR_STR.manualTransform));
          numD('transformVertical', CR_STR.tVertical, -100, 100, 1); numD('transformHorizontal', CR_STR.tHorizontal, -100, 100, 1);
          numD('transformRotate', CR_STR.tRotate, -10, 10, 0.1); numD('transformAspect', CR_STR.tAspect, -100, 100, 1);
          numD('transformScale', CR_STR.tScale, 50, 150, 1); numD('transformX', CR_STR.tX, -100, 100, 0.1); numD('transformY', CR_STR.tY, -100, 100, 0.1);
          if (v.upright === 'guided') cr_guideTool(st, v);
        }
        cr_geomInfo(st, v);
      } else if (st.tab === 'calibration'){                         // 照 PS 补：校准（阴影色调＋红／绿／蓝原色的色相、饱和度）
        rui.sec(tr(CR_STR.shadows)); num(rui, 'calShadowTint', CR_STR.tintS, -100, 100, CR_TINT_STOPS);
        [['Red', 'redPrimary', 0], ['Green', 'greenPrimary', 120], ['Blue', 'bluePrimary', 240]].forEach(([n, lb, h]) => {
          rui.sec(tr(CR_STR[lb]));
          num(rui, 'cal' + n + 'Hue', CR_STR.hue, -100, 100, [cr_hueColor(h - 30), cr_hueColor(h), cr_hueColor(h + 30)]);
          num(rui, 'cal' + n + 'Sat', CR_STR.saturation, -100, 100, ['rgb(128,128,128)', cr_hueColor(h)]);
        });
      } else {
        rui.sec(tr(CR_STR.grain));
        num(rui, 'grainAmount', CR_STR.amount, 0, 100); num(rui, 'grainSize', CR_STR.size, 0, 100); num(rui, 'grainRoughness', CR_STR.roughness, 0, 100);
        rui.sec(tr(CR_STR.vignetting));
        rui.select({k:'vignetteStyle', label:tr(CR_STR.style), options:['highlightPriority', 'colorPriority', 'paintOverlay'].map(s => [s, tr(CR_STR[s])]), get:() => v.vignetteStyle, set:x => { v.vignetteStyle = x; }});
        num(rui, 'vignetteAmount', CR_STR.amount, -100, 100); num(rui, 'vignetteMidpoint', CR_STR.midpoint, 0, 100); num(rui, 'vignetteRoundness', CR_STR.roundness, -100, 100);
        num(rui, 'vignetteFeather', CR_STR.feather, 0, 100); num(rui, 'vignetteHighlights', CR_STR.highlights, 0, 100);
      }
      cr_drawPreview(st);
    },
    // 智能对象不给 onPreview ⇒ Dlg 走「暂记智能滤镜」那条预览；对话框里的缩图用计时器跟着重画
    onPreview:smart ? undefined : (L2, prm) => { const r = SURF_OPS['filter.cameraRaw'](L2, prm, {preview:true}); st.ms = r.ms; st.res = r; cr_geomInfo(st, st.v); cr_drawPreview(st); },
    onClose(){ if (st.timer) clearInterval(st.timer); st.timer = 0; }
  });
  if (box && smart) st.timer = setInterval(() => { if (!box.isConnected){ clearInterval(st.timer); return; } if (!st.gdrag) cr_drawPreview(st); }, 250);
  if (box){
    const pv = box.querySelector('[data-k="__preview"]');            // 关掉「预览」时 Dlg 只还原、不叫 onPreview ⇒ 自己重画
    if (pv) pv.addEventListener('change', () => setTimeout(() => cr_drawPreview(st), 80));
    box.addEventListener('keydown', e => {                           // camera_raw_ui.rs:437：Y 切换之前／之后
      const tg = e.target, typing = /^(select|textarea)$/i.test(tg.tagName) || (tg.tagName === 'INPUT' && tg.type !== 'checkbox' && tg.type !== 'range');
      if ((e.key === 'y' || e.key === 'Y') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing){
        e.preventDefault(); st.before = !st.before; const c = box.querySelector('[data-k="crBefore"]'); if (c) c.checked = st.before; cr_drawPreview(st);
      }
    });
  }
  return box;
}
CUSTOM_DIALOGS['filter.cameraRaw'] = cr_dialog;

/* ──────────────── 段：19-liquify.js ──────────────── */
/* ═══════════ 滤镜 ▸ 液化…（algo/src/liquify.rs 1-676、engine/src/distort_cmds.rs 39-59/115-151/174-179/274-306/365、ui-egui/src/liquify_ui.rs 1-699） ═══════════
   位移场：每个网格节点（每 cell 文件像素一个）存「输出像素 p 取来源 p + d(p)」的反向位移；笔画（工具＋笔刷＋点）照顺序重播到新场上，
   同样的笔画在同样的范围上重播结果逐位相同（所以液化是一条可重播的命令）。确定时用 Catmull-Rom 双立方把场补到每个像素、再双立方（预乘）取样来源。
   对话框预览走原码的 ProxyImage：图层盒式缩小到最长边 ≤1600 的预乘副本，只在笔刷改到的地方用双线性场＋双线性来源重画。 */

/* liquify.rs:26 LiquifyTool（serde camelCase 名） */
const LQ_TOOLS = ['forwardWarp', 'reconstruct', 'smooth', 'twirlCw', 'twirlCcw', 'pucker', 'bloat', 'pushLeft', 'freeze', 'thaw', 'reconstructAll', 'freezeAll', 'thawAll', 'invertFreeze'];
const LQ_ALL = LQ_TOOLS.slice(0, 10);                                                                          // liquify.rs:50 ALL（左边工具列）
const lq_isGlobal = t => t === 'reconstructAll' || t === 'freezeAll' || t === 'thawAll' || t === 'invertFreeze';   // liquify.rs:83
const lq_isStationary = t => !(t === 'forwardWarp' || t === 'pushLeft');                                      // liquify.rs:88
const LQ_TILE = 256;                                                                                           // photocraft_geom TILE_SIZE

/* liquify.rs:133 LiquifyStroke::new（预设 density 50、pressure 100、rate 80） */
const lq_newStroke = (tool, size) => ({tool, size, density:50, pressure:100, rate:80, points:[], amount:null});
/* liquify.rs:138 validate */
function lq_validate(s){
  if (!(isFinite(s.size) && s.size >= 1 && s.size <= 15000)) return 'brush size ' + s.size + ' out of range 1..15000';
  for (const p of s.points) if (!(p.length >= 2 && p.length <= 3) || p.some(v => !isFinite(v))) return 'stroke points are [x, y] or [x, y, pressure]';
  return null;
}
/* serde 反序列化 Vec<LiquifyStroke>（tool 缺＝forwardWarp；数字缺＝预设；null 当数字＝错；amount 可 null） */
const lq_typeName = v => v === null ? 'null' : Array.isArray(v) ? 'sequence' : typeof v === 'string' ? 'string ' + JSON.stringify(v) : typeof v === 'boolean' ? 'boolean `' + v + '`' : typeof v === 'number' ? 'floating point `' + v + '`' : 'map';
function lq_parseStrokes(v){
  const bad = (x, want) => { throw new Error('invalid type: ' + lq_typeName(x) + ', expected ' + want); };
  if (!Array.isArray(v)) bad(v, 'a sequence');
  return v.map(o => {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) bad(o, 'struct LiquifyStroke');
    const s = lq_newStroke('forwardWarp', 100);
    if (o.tool !== undefined){
      if (typeof o.tool !== 'string') bad(o.tool, 'variant identifier');
      if (!LQ_TOOLS.includes(o.tool)) throw new Error('unknown variant `' + o.tool + '`, expected one of ' + LQ_TOOLS.map(t => '`' + t + '`').join(', '));
      s.tool = o.tool;
    }
    for (const k of ['size', 'density', 'pressure', 'rate']) if (o[k] !== undefined){ if (typeof o[k] !== 'number') bad(o[k], 'f64'); s[k] = o[k]; }
    if (o.points !== undefined){
      if (!Array.isArray(o.points)) bad(o.points, 'a sequence');
      s.points = o.points.map(p => { if (!Array.isArray(p)) bad(p, 'a sequence'); return p.map(x => { if (typeof x !== 'number') bad(x, 'f64'); return x; }); });
    }
    if (o.amount !== undefined && o.amount !== null){ if (typeof o.amount !== 'number') bad(o.amount, 'f64'); s.amount = o.amount; }
    return s;
  });
}
/* liquify.rs:166 auto_cell：4.2 MP 以内每节点 2 px，以上 4 px */
const lq_autoCell = b => RW(b) * RH(b) <= 4200000 ? 2 : 4;
/* distort_cmds.rs:40 liquify_params → {strokes, cell} */
function lq_params(cmd, p, canvas){
  let strokes = [];
  if (p.strokes !== undefined){ try { strokes = lq_parseStrokes(p.strokes); } catch (e){ throw new FltBad('bad `strokes`: ' + e.message); } }
  for (const s of strokes){ const e = lq_validate(s); if (e) throw new FltBad(e); }
  let cell;
  if (p.meshSize === undefined || p.meshSize === null) cell = lq_autoCell(canvas);
  else {
    if (typeof p.meshSize !== 'number') throw new FltBad('`meshSize` is px per field node (1..64)');
    if (!(p.meshSize >= 1 && p.meshSize <= 64)) throw new FltBad('`meshSize` must be 1..64');
    cell = p.meshSize;
  }
  return {strokes, cell};
}

/* liquify.rs:431 bilinear（场外 0）；ox/oy/w/h＝在大场 d（宽 W）里的一块子窗（dab 的快照就是这样读，免得复制） */
function lq_bilin(d, W, ox, oy, w, h, gx, gy, out){
  if (!(gx > -1 && gy > -1 && gx < w && gy < h)){ out[0] = 0; out[1] = 0; return out; }
  gx = clamp(gx, 0, w - 1); gy = clamp(gy, 0, h - 1);
  const i = Math.min(Math.trunc(gx), Math.max(w - 2, 0)), j = Math.min(Math.trunc(gy), Math.max(h - 2, 0));
  const fx = gx - i, fy = gy - j, i1 = Math.min(i + 1, w - 1), j1 = Math.min(j + 1, h - 1);
  const A = ((oy + j) * W + ox + i) * 2, B = ((oy + j) * W + ox + i1) * 2, C = ((oy + j1) * W + ox + i) * 2, E = ((oy + j1) * W + ox + i1) * 2;
  out[0] = (d[A] * (1 - fx) + d[B] * fx) * (1 - fy) + (d[C] * (1 - fx) + d[E] * fx) * fy;
  out[1] = (d[A + 1] * (1 - fx) + d[B + 1] * fx) * (1 - fy) + (d[C + 1] * (1 - fx) + d[E + 1] * fx) * fy;
  return out;
}
/* liquify.rs:447 catmull_rom（写进 o，不配阵列） */
function lq_catmull(t, o){ const t2 = t * t, t3 = t2 * t; o[0] = -0.5 * t3 + t2 - 0.5 * t; o[1] = 1.5 * t3 - 2.5 * t2 + 1; o[2] = -1.5 * t3 + 2 * t2 + 0.5 * t; o[3] = 0.5 * t3 - 0.5 * t2; return o; }
const lq_union = (a, b) => rUnion(a, b);
const LQ_SOX = [-1, 1, 0, 0, -1, 1, -1, 1], LQ_SOY = [0, 0, -1, 1, -1, -1, 1, 1];   // liquify.rs:349 平滑的八邻格（顺序照原码）
const lq_fr = Math.fround;

/* liquify.rs:153 LiquifyField：位移场＋冻结遮罩（d、freeze 用 Float32Array＝原码的 f32） */
class LqField {
  constructor(bounds, cell){                                          // liquify.rs:171 new
    cell = clamp(cell, 1, 64);
    this.bounds = bounds; this.cell = cell;
    this.w = Math.ceil(RW(bounds) / cell) + 2; this.h = Math.ceil(RH(bounds) / cell) + 2;
    this.d = new Float32Array(this.w * this.h * 2); this.freeze = new Float32Array(this.w * this.h);
    this._t = new Float64Array(2);
    this._wi = new Int32Array(0); this._wd = new Float32Array(0); this._wf = new Float32Array(0);   // dab 延后写入的暂存（重复用）
  }
  nodePos(i, j){ return [this.bounds.x0 + 0.5 + i * this.cell, this.bounds.y0 + 0.5 + j * this.cell]; }   // liquify.rs:180
  gx(x){ return (x - this.bounds.x0 - 0.5) / this.cell; }                                                  // liquify.rs:186 to_grid
  gy(y){ return (y - this.bounds.y0 - 0.5) / this.cell; }
  isIdentity(){ const d = this.d; for (let i = 0; i < d.length; i++) if (d[i] !== 0) return false; return true; }   // liquify.rs:190
  maxDisplacement(){ let m = 0; const d = this.d; for (let i = 0; i < d.length; i += 2){ const v = lq_fr(Math.hypot(d[i], d[i + 1])); if (v > m) m = v; } return m; }   // liquify.rs:195
  /* liquify.rs:200 sample：文件点的双线性位移（场外 0）；out 可省 */
  sample(x, y, out){ return lq_bilin(this.d, this.w, 0, 0, this.w, this.h, this.gx(x), this.gy(y), out || [0, 0]); }
  /* liquify.rs:206 freeze_at */
  freezeAt(x, y){
    const gx = clamp(this.gx(x), 0, this.w - 1), gy = clamp(this.gy(y), 0, this.h - 1);
    const i = Math.min(Math.trunc(gx), this.w - 2), j = Math.min(Math.trunc(gy), this.h - 2), fx = lq_fr(gx - i), fy = lq_fr(gy - j);
    const at = (i, j) => this.freeze[j * this.w + i];
    return lq_fr((at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy);
  }
  /* liquify.rs:217 apply_stroke：回传输出有变的文件框 */
  applyStroke(s){
    if (s.tool === 'reconstructAll'){
      const k = lq_fr(clamp((s.amount === null || s.amount === undefined ? 100 : s.amount) / 100, 0, 1)), d = this.d, f = this.freeze;
      for (let n = 0; n < f.length; n++){ const m = lq_fr(1 - lq_fr(k * lq_fr(1 - f[n]))); d[n * 2] *= m; d[n * 2 + 1] *= m; }
      return this.bounds;
    }
    if (s.tool === 'freezeAll') this.freeze.fill(1);
    else if (s.tool === 'thawAll') this.freeze.fill(0);
    else if (s.tool === 'invertFreeze'){ const f = this.freeze; for (let n = 0; n < f.length; n++) f[n] = 1 - f[n]; }
    if (lq_isGlobal(s.tool)) return this.bounds;
    const pts = s.points.filter(p => p.length >= 2).map(p => [p[0], p[1], p.length > 2 ? p[2] : 1]);
    if (!pts.length) return EMPTY;
    let dirty = this.strokeBegin(s, pts[0]);
    for (let k = 0; k + 1 < pts.length; k++) dirty = lq_union(dirty, this.strokeSegment(s, pts[k], pts[k + 1]));
    return dirty;
  }
  /* liquify.rs:248 stroke_begin：原地工具在起点点一下 */
  strokeBegin(s, p){ return lq_isStationary(s.tool) && !lq_isGlobal(s.tool) ? this.dab(s, p[0], p[1], 0, 0, clamp(p[2], 0, 1)) : EMPTY; }
  /* liquify.rs:254 stroke_segment：每 1/5 笔刷半径点一下（原地工具停着不动＝在 b 点一下） */
  strokeSegment(s, a, b){
    let dirty = EMPTY;
    const pa = clamp(a[2], 0, 1), pb = clamp(b[2], 0, 1), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) return lq_isStationary(s.tool) ? this.dab(s, b[0], b[1], 0, 0, pb) : dirty;
    const r = Math.max(s.size / 2, 0.5), spacing = Math.max(r * 0.2, 0.5), steps = Math.max(Math.ceil(len / spacing), 1);
    for (let k = 1; k <= steps; k++){
      const t0 = (k - 1) / steps, t1 = k / steps;
      const cx = a[0] + (b[0] - a[0]) * t1, cy = a[1] + (b[1] - a[1]) * t1;
      const ddx = (b[0] - a[0]) * (t1 - t0), ddy = (b[1] - a[1]) * (t1 - t0), pr = pa + (pb - pa) * t1;
      // 向前变形把笔刷中心放在笔刷原来的位置（拖着底下的东西走）
      dirty = lq_union(dirty, lq_isStationary(s.tool) ? this.dab(s, cx, cy, ddx, ddy, pr) : this.dab(s, cx - ddx, cy - ddy, ddx, ddy, pr));
    }
    return dirty;
  }
  /* liquify.rs:278 dab：在 (cx,cy) 点一下、笔刷移动 (ddx,ddy)；回传影响到的文件框 */
  dab(s, cx, cy, ddx, ddy, pointPressure){
    const r = Math.max(s.size / 2, 0.5), strength = clamp(s.pressure / 100, 0, 1) * pointPressure;
    const rate = clamp(s.rate / 100, 0, 1), density = clamp(s.density / 100, 0, 1);
    if (strength <= 0) return EMPTY;
    const W = this.w, H = this.h, cell = this.cell, d = this.d, fz = this.freeze, bx = this.bounds.x0, by = this.bounds.y0;
    const gx0 = this.gx(cx - r), gy0 = this.gy(cy - r), gx1 = this.gx(cx + r), gy1 = this.gy(cy + r);
    const i0 = Math.max(Math.floor(gx0), 0), j0 = Math.max(Math.floor(gy0), 0);
    const i1 = Math.min(Math.max(Math.ceil(gx1), -1), W - 1), j1 = Math.min(Math.max(Math.ceil(gy1), -1), H - 1);
    if (i1 < i0 || j1 < j0) return EMPTY;
    // 受影响节点外加一圈边的快照（取样会读到四周）。写入一律延后到回圈结束（原码 writes），所以快照内容＝当下的场：
    // 这里不复制，直接用子窗读同一块 d（lq_bilin 的 ox/oy/sw/sh），算术与原码逐项相同。
    const m = Math.ceil((Math.max(Math.abs(ddx), Math.abs(ddy)) + r * 0.2) / cell) + 2;
    const si0 = Math.max(i0 - m, 0), sj0 = Math.max(j0 - m, 0), si1 = Math.min(i1 + m, W - 1), sj1 = Math.min(j1 + m, H - 1);
    const sw = si1 - si0 + 1, sh = sj1 - sj0 + 1, dq = this._t;
    const old = (gx, gy) => {
      const lx = gx - si0, ly = gy - sj0;
      if (lx >= 0 && ly >= 0 && lx <= sw - 1 && ly <= sh - 1) return lq_bilin(d, W, si0, sj0, sw, sh, lx, ly, dq);
      return lq_bilin(d, W, 0, 0, W, H, gx, gy, dq);                 // 快照外没变：读活的场
    };
    const cap = (i1 - i0 + 1) * (j1 - j0 + 1);
    if (this._wi.length < cap){ this._wi = new Int32Array(cap); this._wd = new Float32Array(cap * 2); this._wf = new Float32Array(cap); }
    const wi = this._wi, wd = this._wd, wf = this._wf; let nw = 0;
    const invCell = 1 / cell, tool = s.tool, isFz = tool === 'freeze', isTh = tool === 'thaw';
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const px = bx + 0.5 + i * cell, py = by + 0.5 + j * cell;
      const dx = px - cx, dy = py - cy, t2 = (dx * dx + dy * dy) / (r * r);
      if (t2 >= 1) continue;
      const soft = (1 - t2) * (1 - t2), fall = (1 - density) + density * soft, idx = j * W + i, kRaw = strength * fall;
      if (isFz || isTh){
        const f = fz[idx], v = isFz ? Math.min(f + kRaw, 1) : Math.max(f - kRaw, 0);
        wi[nw] = idx; wd[nw * 2] = d[idx * 2]; wd[nw * 2 + 1] = d[idx * 2 + 1]; wf[nw] = v; nw++;
        continue;
      }
      const k = kRaw * (1 - fz[idx]);
      if (k <= 0) continue;
      const c0 = d[idx * 2], c1 = d[idx * 2 + 1];
      let n0, n1;
      if (tool === 'reconstruct'){
        const a = lq_fr(1 - k * (0.1 + 0.4 * rate)); n0 = c0 * a; n1 = c1 * a;
      } else if (tool === 'smooth'){
        const gx = i - si0, gy = j - sj0; let m0 = 0, m1 = 0;
        for (let q = 0; q < 8; q++){
          const ox = LQ_SOX[q], oy = LQ_SOY[q];
          const x = clamp(gx + ox, 0, sw - 1) + si0, y = clamp(gy + oy, 0, sh - 1) + sj0, o = (y * W + x) * 2;
          m0 = lq_fr(m0 + lq_fr(d[o] / 8)); m1 = lq_fr(m1 + lq_fr(d[o + 1] / 8));
        }
        const a = lq_fr(k * (0.1 + 0.4 * rate));
        n0 = lq_fr(c0 + lq_fr(lq_fr(m0 - c0) * a)); n1 = lq_fr(c1 + lq_fr(lq_fr(m1 - c1) * a));
      } else {
        let q0, q1;
        if (tool === 'forwardWarp'){ q0 = px - k * ddx; q1 = py - k * ddy; }
        else if (tool === 'pushLeft'){ q0 = px - k * ddy; q1 = py + k * ddx; }          // 笔画方向的左边（y 向下）：(dx,dy)→(dy,−dx)
        else if (tool === 'twirlCw' || tool === 'twirlCcw'){
          const th = k * rate * 0.12 * (tool === 'twirlCw' ? 1 : -1), sn = Math.sin(-th), cs = Math.cos(-th);   // 内容转 +th ⇒ 在转 −th 的点取样
          q0 = cx + dx * cs - dy * sn; q1 = cy + dx * sn + dy * cs;
        } else if (tool === 'pucker'){ const a = 1 + k * rate * 0.06; q0 = cx + dx * a; q1 = cy + dy * a; }
        else { const a = 1 - k * rate * 0.06; q0 = cx + dx * a; q1 = cy + dy * a; }   // bloat
        const v = old((q0 - px) * invCell + i, (q1 - py) * invCell + j);
        n0 = q0 + v[0] - px; n1 = q1 + v[1] - py;
      }
      wi[nw] = idx; wd[nw * 2] = n0; wd[nw * 2 + 1] = n1; wf[nw] = fz[idx]; nw++;
    }
    for (let n = 0; n < nw; n++){ const idx = wi[n]; d[idx * 2] = wd[n * 2]; d[idx * 2 + 1] = wd[n * 2 + 1]; fz[idx] = wf[n]; }
    const pad = Math.ceil(r) + 2;
    return rInter(R(Math.floor(cx) - pad, Math.floor(cy) - pad, Math.ceil(cx) + pad, Math.ceil(cy) + pad), this.bounds);
  }
  /* liquify.rs:394 from_strokes */
  static fromStrokes(bounds, cell, strokes){ const f = new LqField(bounds, cell); for (const s of strokes) f.applyStroke(s); return f; }
  /* liquify.rs:403 sample_cubic（格点坐标的 Catmull-Rom 位移，边缘夹住） */
  sampleCubic(gx, gy, wx, wy, out){
    const ix = Math.floor(gx), iy = Math.floor(gy), W = this.w, H = this.h, d = this.d; let a0 = 0, a1 = 0;
    for (let jj = 0; jj < 4; jj++){
      let y = iy - 1 + jj; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
      const row = y * W, wyj = wy[jj];
      for (let ii = 0; ii < 4; ii++){ let x = ix - 1 + ii; x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; const k = wx[ii] * wyj, o = (row + x) * 2; a0 += d[o] * k; a1 += d[o + 1] * k; }
    }
    out[0] = a0; out[1] = a1;
  }
  /* liquify.rs:420 touches：影响文件框 r 的节点有没有位移 */
  touches(r){
    const W = this.w, H = this.h;
    const i0 = clamp(Math.floor(this.gx(r.x0)) - 2, 0, W - 1), j0 = clamp(Math.floor(this.gy(r.y0)) - 2, 0, H - 1);
    const i1 = clamp(Math.ceil(this.gx(r.x1)) + 2, 0, W - 1), j1 = clamp(Math.ceil(this.gy(r.y1)) + 2, 0, H - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){ const o = (j * W + i) * 2; if (this.d[o] !== 0 || this.d[o + 1] !== 0) return true; }
    return false;
  }
}

/* liquify.rs:456 apply_liquify：在场范围内每格显示来源的 p + d(p)（双立方场、双立方预乘来源、场外重复边缘格）；范围外照旧。
   照原码按 256 格的块做（没位移的块原样跳过；取样窗＝该块的 foot，夹在 foot 里） */
function lq_apply(src, field){
  const n = 4, b = field.bounds, out = src.clone();
  if (field.isIdentity() || rEmpty(b)) return out;
  const maxd = Math.ceil(field.maxDisplacement()) + 3;
  const wx = new Float64Array(4), wy = new Float64Array(4), dv = new Float64Array(2), acc = new Float64Array(n);
  let disp = new Float64Array(LQ_TILE * LQ_TILE * 2);
  const snap = t => Math.abs(t - rround(t)) < 1e-7 ? rround(t) : t;
  const done = [];
  const tx0 = Math.floor(b.x0 / LQ_TILE), ty0 = Math.floor(b.y0 / LQ_TILE), tx1 = Math.floor((b.x1 - 1) / LQ_TILE), ty1 = Math.floor((b.y1 - 1) / LQ_TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++){
    const t = rInter(R(tx * LQ_TILE, ty * LQ_TILE, (tx + 1) * LQ_TILE, (ty + 1) * LQ_TILE), b);
    if (rEmpty(t) || !field.touches(t)) continue;
    const w = RW(t), h = RH(t);
    if (disp.length < w * h * 2) disp = new Float64Array(w * h * 2);
    // 每格的场（双立方），同一列共用 y 权重
    let fx0 = Number.MAX_VALUE, fy0 = Number.MAX_VALUE, fx1 = -Number.MAX_VALUE, fy1 = -Number.MAX_VALUE, moved = false;
    for (let y = 0; y < h; y++){
      const py = t.y0 + y + 0.5, gy = (py - b.y0 - 0.5) / field.cell;
      lq_catmull(gy - Math.floor(gy), wy);
      for (let x = 0; x < w; x++){
        const px = t.x0 + x + 0.5, gx = (px - b.x0 - 0.5) / field.cell;
        lq_catmull(gx - Math.floor(gx), wx);
        field.sampleCubic(gx, gy, wx, wy, dv);
        if (dv[0] !== 0 || dv[1] !== 0) moved = true;
        const o = (y * w + x) * 2; disp[o] = dv[0]; disp[o + 1] = dv[1];
        const sx = px + dv[0], sy = py + dv[1];
        if (sx < fx0) fx0 = sx; if (sy < fy0) fy0 = sy; if (sx > fx1) fx1 = sx; if (sy > fy1) fy1 = sy;
      }
    }
    if (!moved) continue;
    const foot = rInter(rInter(R(Math.floor(fx0) - 3, Math.floor(fy0) - 3, Math.ceil(fx1) + 3, Math.ceil(fy1) + 3), rInflate(t, maxd)), b);
    if (rEmpty(foot)) continue;
    const px = src.readRegion(foot); premultiply(px, n, true);
    const fw = RW(foot), fX0 = foot.x0, fY0 = foot.y0, fX1 = foot.x1 - 1, fY1 = foot.y1 - 1;
    const outp = new Float32Array(w * h * n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const o2 = (y * w + x) * 2, u = snap(t.x0 + x + disp[o2]), v = snap(t.y0 + y + disp[o2 + 1]);
      const ix = Math.floor(u), iy = Math.floor(v);
      lq_catmull(u - ix, wx); lq_catmull(v - iy, wy);
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (let j = 0; j < 4; j++){
        let yy = iy - 1 + j; yy = yy < fY0 ? fY0 : yy > fY1 ? fY1 : yy;
        const row = (yy - fY0) * fw, wyj = wy[j];
        for (let i = 0; i < 4; i++){
          const k = wx[i] * wyj; if (k === 0) continue;
          let xx = ix - 1 + i; xx = xx < fX0 ? fX0 : xx > fX1 ? fX1 : xx;
          const q = (row + xx - fX0) * n;
          acc[0] += px[q] * k; acc[1] += px[q + 1] * k; acc[2] += px[q + 2] * k; acc[3] += px[q + 3] * k;
        }
      }
      const o = (y * w + x) * n, al = clamp(acc[3], 0, 1);
      outp[o + 3] = al;
      for (let c = 0; c < 3; c++) outp[o + c] = al > 0 ? clamp(acc[c] / al, 0, 1) : 0;
    }
    done.push([t, outp]);
  }
  for (const [r, v] of done) out.writeRegion(r, v);
  return out;
}

/* distort_cmds.rs:115 mix_by_selection：按选区覆盖度把 new 混到 old 上（有 alpha ⇒ 预乘混） */
function lq_mixBySelection(old, nw, sel){
  const area = rUnion(old.contentBounds(), nw.contentBounds()), out = nw.clone();
  if (rEmpty(area)) return out;
  const o = old.readRegion(area), w = nw.readRegion(area), r = new Float32Array(o.length), aw = RW(area);
  for (let i = 0, N = o.length / 4; i < N; i++){
    const k = clamp(sel.get(area.x0 + i % aw, area.y0 + Math.floor(i / aw)), 0, 1), p = i * 4;
    const oa = o[p + 3] + (w[p + 3] - o[p + 3]) * k;
    r[p + 3] = oa;
    for (let c = 0; c < 3; c++){ const pm = o[p + c] * o[p + 3] + (w[p + c] * w[p + 3] - o[p + c] * o[p + 3]) * k; r[p + c] = oa > 0 ? clamp(pm / oa, 0, 1) : 0; }
  }
  out.writeRegion(area, r);
  return out;
}
/* distort_cmds.rs:148 liquify_surface（智慧滤镜重播用，distort_cmds.rs:174 apply_to_surface 的液化分支） */
const lq_liquifySurface = (surf, strokes, cell, canvas) => lq_apply(surf, LqField.fromStrokes(canvas, cell, strokes));

/* distort_cmds.rs:274 liquify：参数错先报 → 没笔画／场是恒等 ⇒ changed:false → 套用、有选区按覆盖度混 → {layer, changed, ms, maxDisplacement}
   （我们只有像素层，没有智慧型物件；锁定由 targetLayer 先挡） */
SURF_OPS['filter.liquify'] = (L, p) => {
  const canvas = R(0, 0, Doc.width, Doc.height);
  const {strokes, cell} = lq_params('filter.liquify', p || {}, canvas);
  if (!strokes.length) return {layer:L.id, changed:false};
  const t0 = performance.now();
  const field = LqField.fromStrokes(canvas, cell, strokes);
  if (field.isIdentity()) return {layer:L.id, changed:false};
  const surf = Surf.fromLayer(L), sel = selCoverage();
  let out = lq_apply(surf, field);
  if (sel) out = lq_mixBySelection(surf, out, sel);
  out.toLayer(L); Layer.invalidate(L);
  return {layer:L.id, changed:true, ms:performance.now() - t0, maxDisplacement:field.maxDisplacement()};
};
/* distort_cmds.rs:365 specs 的 params 字串 L（原样） */
PARAM_SPECS['filter.liquify'] = '{"strokes":[{"tool":"forwardWarp|reconstruct|smooth|twirlCw|twirlCcw|pucker|bloat|pushLeft|freeze|thaw|reconstructAll","size":px=100,"density":0-100=50,"pressure":0-100=100,"rate":0-100=80,"points":[[x,y,pressure?]…],"amount":%? (reconstructAll)}…],"meshSize":px? (field resolution, px per node; default 2, or 4 above 4 MP),"layer":id?} — strokes replay in order on a fresh field; a selection limits the effect; on a smart object it becomes a smart filter';

/* liquify.rs:574 ProxyImage：预览用的缩小预乘 RGBA 副本 */
const LQ_PROXY_SIDE = 1600;                                         // liquify_ui.rs:23
class LqProxy {
  constructor(src, bounds, maxSide){                                // liquify.rs:587 new：盒式缩小到最长边 ≤ maxSide
    const side = Math.max(RW(bounds), RH(bounds), 1), scale = Math.ceil(Math.max(side / Math.max(maxSide, 1), 1));
    const w = Math.max(Math.ceil(RW(bounds) / scale), 1), h = Math.max(Math.ceil(RH(bounds) / scale), 1), k = scale | 0;
    const px = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++){
      const r = R(bounds.x0, bounds.y0 + y * k, bounds.x0 + w * k, Math.min(bounds.y0 + (y + 1) * k, bounds.y1));
      const buf = src.readRegion(r), rw = RW(r), rh = RH(r);
      for (let x = 0; x < w; x++){
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, cnt = 0;
        for (let yy = 0; yy < rh; yy++) for (let xx = x * k, xe = Math.min((x + 1) * k, rw); xx < xe; xx++){
          const q = (yy * rw + xx) * 4, a = buf[q + 3];
          a0 += buf[q] * a; a1 += buf[q + 1] * a; a2 += buf[q + 2] * a; a3 += a; cnt++;
        }
        if (cnt > 0){ const o = (y * w + x) * 4; px[o] = a0 / cnt; px[o + 1] = a1 / cnt; px[o + 2] = a2 / cnt; px[o + 3] = a3 / cnt; }
      }
    }
    Object.assign(this, {bounds, scale, w, h, px, _d:new Float64Array(2)});
  }
  /* liquify.rs:631 render：把代理像素 r=[x0,y0,x1,y1] 经场重画进 out（预乘 RGBA8，w×h）：双线性场、双线性来源 */
  render(field, r, out){
    const W = this.w, H = this.h, x0 = Math.min(r[0], W), y0 = Math.min(r[1], H), x1 = Math.min(r[2], W), y1 = Math.min(r[3], H);
    if (x0 >= x1 || y0 >= y1) return;
    const s = this.scale, bx = this.bounds.x0, by = this.bounds.y0, P = this.px, dd = this._d;
    const FD = field.d, FW = field.w, FH = field.h;
    for (let y = y0; y < y1; y++){
      const py = by + (y + 0.5) * s, gy = field.gy(py);
      for (let x = x0; x < x1; x++){
        const px = bx + (x + 0.5) * s;
        lq_bilin(FD, FW, 0, 0, FW, FH, field.gx(px), gy, dd);         // ＝field.sample(px, py)
        const u = (px + dd[0] - bx) / s - 0.5, v = (py + dd[1] - by) / s - 0.5, iu = Math.floor(u), iv = Math.floor(v);
        const fu = lq_fr(u - iu), fv = lq_fr(v - iv), gu = 1 - fu, gv = 1 - fv;
        const xa = iu < 0 ? 0 : iu > W - 1 ? W - 1 : iu, xb = iu + 1 < 0 ? 0 : iu + 1 > W - 1 ? W - 1 : iu + 1;
        const ya = (iv < 0 ? 0 : iv > H - 1 ? H - 1 : iv) * W, yb = (iv + 1 < 0 ? 0 : iv + 1 > H - 1 ? H - 1 : iv + 1) * W;
        const A = (ya + xa) * 4, B = (ya + xb) * 4, C = (yb + xa) * 4, E = (yb + xb) * 4, o = (y * W + x) * 4;
        for (let k = 0; k < 4; k++){
          const val = (P[A + k] * gu + P[B + k] * fu) * gv + (P[C + k] * gu + P[E + k] * fu) * fv;
          out[o + k] = val <= 0 ? 0 : val >= 1 ? 255 : Math.trunc(val * 255 + 0.5);
        }
      }
    }
  }
  /* liquify.rs:666 proxy_rect：盖住文件框 r 的代理像素框 */
  proxyRect(r){
    const s = this.scale, f = (v, o) => Math.max((v - o) / s, 0);
    return [Math.floor(f(r.x0, this.bounds.x0)), Math.floor(f(r.y0, this.bounds.y0)), Math.min(Math.ceil(f(r.x1, this.bounds.x0)) + 1, this.w), Math.min(Math.ceil(f(r.y1, this.bounds.y0)) + 1, this.h)];
  }
}

/* liquify_ui.rs:62 LiquifyDialog 的资料部分（不碰 DOM：录笔画、维护场与代理、重建／恢复／复原） */
function lq_rectUnion(a, b){                                        // liquify_ui.rs:89 union
  if (b[0] >= b[2] || b[1] >= b[3]) return a;
  return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b;
}
class LqModel {
  constructor(surf, canvas, cell, maxSide){                         // liquify_ui.rs:238 open
    this.canvas = canvas; this.cell = cell || lq_autoCell(canvas);
    this.field = new LqField(canvas, this.cell); this.strokes = []; this.cur = null;   // cur＝{s:画到一半的笔画, last:[x,y,pressure]}
    this.proxy = new LqProxy(surf, canvas, maxSide || LQ_PROXY_SIDE);
    this.out = new Uint8Array(this.proxy.w * this.proxy.h * 4);
    this.dirty = [0, 0, this.proxy.w, this.proxy.h]; this.maskDirty = true;   // 第一次整张上传
    this.lastDab = 0; this.dabMs = 0;
  }
  template(o){ return {tool:o.tool, size:+o.size, density:+o.density, pressure:+o.pressure, rate:+o.rate, points:[], amount:null}; }   // liquify_ui.rs:113
  mark(r, mask){ if (rEmpty(r)) return; this.dirty = lq_rectUnion(this.dirty, this.proxy.proxyRect(r)); this.maskDirty = this.maskDirty || mask; }   // :126
  begin(p, now, o){                                                 // :134
    const s = this.template(o); s.points.push(p.slice());
    const t0 = performance.now(), d = this.field.strokeBegin(s, p);
    this.mark(d, s.tool === 'freeze' || s.tool === 'thaw');
    this.dabMs = performance.now() - t0; this.cur = {s, last:p}; this.lastDab = now;
  }
  extend(p, now){                                                   // :146
    if (!this.cur) return;
    const s = this.cur.s, t0 = performance.now(), d = this.field.strokeSegment(s, this.cur.last, p);
    s.points.push(p.slice());
    this.mark(d, s.tool === 'freeze' || s.tool === 'thaw');
    this.dabMs = performance.now() - t0; this.cur = {s, last:p}; this.lastDab = now;
  }
  end(){ if (this.cur){ this.strokes.push(this.cur.s); this.cur = null; } }   // :158
  global(tool, amount){                                             // :165 整场操作（重建…、遮罩按钮）也记成一笔
    this.end();
    const s = lq_newStroke(tool, 1); s.amount = amount === undefined ? null : amount;
    const d = this.field.applyStroke(s); this.strokes.push(s); this.mark(d, true);
  }
  rebuild(){ this.field = LqField.fromStrokes(this.canvas, this.cell, this.strokes); this.dirty = [0, 0, this.proxy.w, this.proxy.h]; this.maskDirty = true; }   // :175
  undo(){ this.end(); if (this.strokes.pop()) this.rebuild(); }    // :182
  restoreAll(){ this.cur = null; this.strokes = []; this.rebuild(); }   // :189
  renderDirty(){ if (this.dirty) this.proxy.render(this.field, this.dirty, this.out); }   // :196
  takeDirty(){ const r = this.dirty; this.dirty = null; if (r) this.proxy.render(this.field, r, this.out); return r; }   // :202 upload 取走 dirty
  /* liquify_ui.rs:349 pointer：down／move／up（文件坐标） */
  pointer(ev, o, now){
    if (ev.type === 'down') this.begin([ev.x, ev.y, ev.pressure === undefined ? 1 : ev.pressure], now, o);
    else if (ev.type === 'move'){ if (this.cur) this.extend([ev.x, ev.y, ev.pressure === undefined ? 1 : ev.pressure], now); }
    else if (ev.type === 'up'){
      if (this.cur && (this.cur.last[0] !== ev.x || this.cur.last[1] !== ev.y)) this.extend([ev.x, ev.y, this.cur.last[2]], now);
      this.end();
    }
  }
  /* liquify_ui.rs:100 describe */
  describe(o, layerId){
    return {layer:layerId, tool:o.tool, size:o.size, strokes:this.strokes.length + (this.cur ? 1 : 0), meshSize:this.cell, maxDisplacement:this.field.maxDisplacement(), proxy:[this.proxy.w, this.proxy.h], dabMs:this.dabMs};
  }
}

/* ── 对话框（liquify_ui.rs:442 show：左工具列、中间预览、右属性；确定＝跑 filter.liquify 一步历史） ── */
const LQ_STR = {
  title:S('液化', '液化', 'Liquify'),
  forwardWarp:S('向前彎曲工具', '向前变形工具', 'Forward Warp Tool'), reconstruct:S('重建工具', '重建工具', 'Reconstruct Tool'), smooth:S('平滑工具', '平滑工具', 'Smooth Tool'),
  twirlCw:S('順時針扭轉工具', '顺时针旋转扭曲工具', 'Twirl Clockwise Tool'), twirlCcw:S('逆時針扭轉工具', '逆时针旋转扭曲工具', 'Twirl Counterclockwise Tool'),
  pucker:S('縮攏工具', '褶皱工具', 'Pucker Tool'), bloat:S('膨脹工具', '膨胀工具', 'Bloat Tool'), pushLeft:S('左推工具', '左推工具', 'Push Left Tool'),
  freeze:S('凍結遮色片工具', '冻结蒙版工具', 'Freeze Mask Tool'), thaw:S('解凍遮色片工具', '解冻蒙版工具', 'Thaw Mask Tool'),
  brushOpts:S('筆刷工具選項', '画笔工具选项', 'Brush Tool Options'), size:S('尺寸', '大小', 'Size'), density:S('密度', '浓度', 'Density'), pressure:S('壓力', '压力', 'Pressure'), rate:S('速率', '速率', 'Rate'),
  recOpts:S('筆刷重建選項', '画笔重建选项', 'Brush Reconstruct Options'), amount:S('數量', '数量', 'Amount'), recBtn:S('重建...', '重建...', 'Reconstruct...'), restoreAll:S('全部復原', '恢复全部', 'Restore All'),
  maskOpts:S('遮色片選項', '蒙版选项', 'Mask Options'), maskNone:S('無', '无', 'None'), maskAll:S('全部遮色', '全部蒙住', 'Mask All'), invertAll:S('全部反轉', '全部反相', 'Invert All'),
  viewOpts:S('檢視選項', '视图选项', 'View Options'), showMesh:S('顯示網格', '显示网格', 'Show Mesh'), meshSize:S('網格大小', '网格大小', 'Mesh Size'),
  small:S('小', '小', 'Small'), medium:S('中', '中', 'Medium'), large:S('大', '大', 'Large'), showMask:S('顯示遮色片', '显示蒙版', 'Show Mask'),
  showBackdrop:S('顯示背景', '显示背景', 'Show Backdrop'), opacity:S('不透明度', '不透明度', 'Opacity'), undo:S('還原上一筆', '撤销上一笔', 'Undo Stroke'),
  needPixel:S('液化需要像素圖層', '液化需要像素图层', 'Liquify needs a pixel layer')
};
const LQ_KEY = {forwardWarp:'W', reconstruct:'R', smooth:'E', twirlCw:'C', pucker:'S', bloat:'B', pushLeft:'O', freeze:'F', thaw:'D'};   // liquify_ui.rs:416 shortcut
const LQ_GLYPH = {forwardWarp:'↗', reconstruct:'⟲', smooth:'≈', twirlCw:'↻', twirlCcw:'↺', pucker:'⇥⇤', bloat:'⇤⇥', pushLeft:'«', freeze:'▣', thaw:'▢'};
const lq_defaultOpts = () => ({tool:'forwardWarp', size:100, density:50, pressure:100, rate:80, showMesh:false, meshView:1, showMask:true, showBackdrop:false, backdropOpacity:50, reconstructAmount:100});   // liquify_ui.rs:44
function lq_css(){
  if (document.getElementById('lqCss')) return;
  const s = document.createElement('style'); s.id = 'lqCss';
  s.textContent = '.lq-props .row>.lb{min-width:62px}.lq-props input[type=range]{min-width:60px}.lq-props input[type=number]{width:54px}' +
    '.lq-tools button{width:34px;height:34px;padding:0;font-size:14px;line-height:1}.lq-view{touch-action:none;cursor:crosshair;outline:none}';
  document.head.appendChild(s);
}
/* 文件 ↔ 视图（CSS px，以预览 canvas 中心为准；liquify_ui.rs:641 to_screen／645 to_doc） */
const lq_toScreen = (st, x, y) => [st.vw / 2 + (x - st.center[0]) * st.zoom, st.vh / 2 + (y - st.center[1]) * st.zoom];
function lq_toDoc(st, e){ const r = st.view.getBoundingClientRect(), lx = e.clientX - r.left, ly = e.clientY - r.top; return [st.center[0] + (lx - r.width / 2) / st.zoom, st.center[1] + (ly - r.height / 2) / st.zoom]; }
function lq_kick(st){ if (!st.raf && !st.closed) st.raf = requestAnimationFrame(() => lq_frame(st)); }
/* 代理 out（预乘 8 位）的 r 框 → 直通 ImageData → 离屏代理 canvas（liquify_ui.rs:202 upload） */
function lq_upload(st, r){
  const P = st.model.proxy, W = P.w, o = st.model.out, dd = st.img.data;
  const x0 = Math.min(r[0], W), y0 = Math.min(r[1], P.h), x1 = Math.min(r[2], W), y1 = Math.min(r[3], P.h);
  if (x1 <= x0 || y1 <= y0) return;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const i = (y * W + x) * 4, a = o[i + 3];
    if (a === 0){ dd[i] = dd[i + 1] = dd[i + 2] = dd[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) dd[i + c] = Math.min(255, Math.round(o[i + c] * 255 / a));
    dd[i + 3] = a;
  }
  st.pctx.putImageData(st.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
}
function lq_uploadMask(st){                                          // 冻结遮罩：红 (230,40,40)、alpha＝freeze×140
  const f = st.model.field;
  if (!st.maskCanvas || st.maskCanvas.width !== f.w || st.maskCanvas.height !== f.h){ st.maskCanvas = document.createElement('canvas'); st.maskCanvas.width = f.w; st.maskCanvas.height = f.h; st.maskImg = st.maskCanvas.getContext('2d').createImageData(f.w, f.h); }
  const d = st.maskImg.data;
  for (let i = 0; i < f.freeze.length; i++){ d[i * 4] = 230; d[i * 4 + 1] = 40; d[i * 4 + 2] = 40; d[i * 4 + 3] = Math.trunc(clamp(f.freeze[i], 0, 1) * 140); }
  st.maskCanvas.getContext('2d').putImageData(st.maskImg, 0, 0);
}
function lq_backdrop(st){                                            // liquify_ui.rs:431 load_backdrop：不含本层的文件拼合
  if (st.backdrop) return st.backdrop;
  const L = st.L, vis = L.visible;
  try { L.visible = false; st.backdrop = composite(1); } catch (_){ st.backdrop = null; } finally { L.visible = vis; }
  return st.backdrop;
}
/* liquify_ui.rs:654 draw_mesh：来源网格线（p + d(p) 的等值线，用比网格细四倍的取样做 marching squares） */
function lq_drawMesh(st, g){
  const c = st.model.canvas, f = st.model.field, cells = [64, 40, 24][Math.min(st.v.meshView | 0, 2)];
  const step = Math.max(RW(c), RH(c)) / cells, h = step / 4, nx = Math.ceil(RW(c) / h) + 1, ny = Math.ceil(RH(c) / h) + 1, x0 = c.x0, y0 = c.y0;
  const src = new Float64Array(nx * ny * 2), tmp = new Float64Array(2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){ const px = x0 + i * h, py = y0 + j * h; f.sample(px, py, tmp); src[(j * nx + i) * 2] = px + tmp[0]; src[(j * nx + i) * 2 + 1] = py + tmp[1]; }
  g.beginPath(); g.strokeStyle = 'rgba(90,90,90,0.82)'; g.lineWidth = 0.75;
  const CI = [0, 1, 1, 0], CJ = [0, 0, 1, 1], vals = [0, 0, 0, 0], pts = [];
  for (let axis = 0; axis < 2; axis++){
    const origin = axis === 0 ? x0 : y0;
    for (let jj = 0; jj < ny - 1; jj++) for (let ii = 0; ii < nx - 1; ii++){
      let lo = Infinity, hi = -Infinity;
      for (let e = 0; e < 4; e++){ const v = src[((jj + CJ[e]) * nx + ii + CI[e]) * 2 + axis]; vals[e] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
      for (let k = Math.ceil((lo - origin) / step); origin + k * step <= hi; k++){
        const level = origin + k * step; pts.length = 0;
        for (let e = 0; e < 4; e++){
          const a = vals[e] - level, b = vals[(e + 1) % 4] - level;
          if ((a <= 0) !== (b <= 0)){ const t = a / (a - b), e2 = (e + 1) % 4; pts.push([x0 + (ii + CI[e] + (CI[e2] - CI[e]) * t) * h, y0 + (jj + CJ[e] + (CJ[e2] - CJ[e]) * t) * h]); }
        }
        for (let q = 0; q + 1 < pts.length; q += 2){ const A = lq_toScreen(st, pts[q][0], pts[q][1]), B = lq_toScreen(st, pts[q + 1][0], pts[q + 1][1]); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); }
      }
    }
  }
  g.stroke();
}
/* 画预览（liquify_ui.rs:567-605：棋盘格、背景、代理、遮罩、网格、笔刷圈、画布框） */
function lq_draw(st){
  const g = st.vctx, dpr = st.dpr, m = st.model, c = m.canvas, P = m.proxy, v = st.v;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, st.view.width, st.view.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1e2126'; g.fillRect(0, 0, st.vw, st.vh);
  const a = lq_toScreen(st, c.x0, c.y0), b = lq_toScreen(st, c.x1, c.y1);
  g.save(); g.beginPath(); g.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.clip();
  if (!st.checker){ const k = document.createElement('canvas'); k.width = k.height = 16; const kg = k.getContext('2d'); kg.fillStyle = '#fff'; kg.fillRect(0, 0, 16, 16); kg.fillStyle = '#ccc'; kg.fillRect(0, 0, 8, 8); kg.fillRect(8, 8, 8, 8); st.checker = g.createPattern(k, 'repeat'); }
  g.fillStyle = st.checker; g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  g.imageSmoothingEnabled = true;
  if (v.showBackdrop){ const bk = lq_backdrop(st); if (bk){ g.globalAlpha = clamp(v.backdropOpacity / 100, 0, 1); g.drawImage(bk, a[0], a[1], b[0] - a[0], b[1] - a[1]); g.globalAlpha = 1; } }
  g.restore();
  g.save(); g.beginPath(); g.rect(0, 0, st.vw, st.vh); g.clip();
  g.drawImage(st.pcanvas, a[0], a[1], P.w * P.scale * st.zoom, P.h * P.scale * st.zoom);   // 代理盖整个代理像素，会略超出画布边
  if (v.showMask && st.maskCanvas){
    const f = m.field, z = st.zoom;
    g.drawImage(st.maskCanvas, a[0] - 0.5 * z * f.cell + 0.5 * z, a[1] - 0.5 * z * f.cell + 0.5 * z, f.w * f.cell * z, f.h * f.cell * z);
  }
  if (v.showMesh) lq_drawMesh(st, g);
  if (st.hover){
    const h = lq_toScreen(st, st.hover[0], st.hover[1]), r = v.size * 0.5 * st.zoom;
    g.beginPath(); g.arc(h[0], h[1], r, 0, TAU); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 0.75; g.stroke();
  }
  g.strokeStyle = '#444a54'; g.lineWidth = 1; g.strokeRect(a[0] - 0.5, a[1] - 0.5, b[0] - a[0] + 1, b[1] - a[1] + 1);
  g.restore();
}
function lq_info(st){
  const m = st.model, n = m.strokes.length, ms = m.dabMs.toFixed(2);
  if (st.info) st.info.textContent = tr(S(n + ' 筆 · 網格 ' + m.cell + ' px/節點 · 每筆 ' + ms + ' ms', n + ' 笔 · 网格 ' + m.cell + ' px/节点 · 每笔 ' + ms + ' ms', n + ' stroke(s) · field ' + m.cell + ' px/node · dab ' + ms + ' ms'));
  const hd = Dlg.cur && Dlg.cur.box.querySelector('.hd');
  if (hd) hd.textContent = tr(LQ_STR.title) + ' (' + st.L.name + ', ' + Math.round(st.zoom * 100) + '%)';
}
/* 每帧：原地工具按住不动每 33ms 点一下（liquify_ui.rs:619）→ 重画 dirty → 上传 → 画 */
function lq_frame(st){
  st.raf = 0; if (st.closed || !st.view) return;
  const m = st.model, now = performance.now();
  if (st.down && m.cur && lq_isStationary(st.v.tool) && now - m.lastDab > 33) m.pointer({type:'move', x:m.cur.last[0], y:m.cur.last[1], pressure:1}, st.v, now);
  const r = m.takeDirty(); if (r) lq_upload(st, r);
  if (m.maskDirty){ m.maskDirty = false; lq_uploadMask(st); }
  lq_draw(st); lq_info(st);
  if (st.down) lq_kick(st);
}
function lq_syncTools(st){ if (st.tools) st.tools.querySelectorAll('button[data-k^="tool-"]').forEach(b => b.classList.toggle('on', b.dataset.k === 'tool-' + st.v.tool)); }
function lq_syncInput(st, k){ if (!st.props) return; st.props.querySelectorAll('[data-k="' + k + '"]').forEach(n => { n.value = n.type === 'number' ? String(+(+st.v[k]).toFixed(2)) : st.v[k]; }); }
/* liquify_ui.rs:371 keys：Ctrl+Z 复原一笔、[ ] 改笔刷大小、字母换工具；空白键按住＝平移 */
function lq_keys(st, e){
  if (st.closed) return;
  const tg = e.target, typing = tg && /^(input|select|textarea)$/i.test(tg.tagName) && !/^(range|checkbox|radio)$/i.test(tg.type || '');
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ'){ e.preventDefault(); st.model.undo(); lq_kick(st); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' '){ st.space = e.type === 'keydown'; e.preventDefault(); return; }
  if (e.type !== 'keydown') return;
  if (e.key === '['){ st.v.size = Math.max(st.v.size * 0.9, 1); lq_syncInput(st, 'size'); lq_kick(st); return; }
  if (e.key === ']'){ st.v.size = Math.min(st.v.size * 1.1, 15000); lq_syncInput(st, 'size'); lq_kick(st); return; }
  const t = Object.keys(LQ_KEY).find(k => 'Key' + LQ_KEY[k] === e.code);
  if (t){ st.v.tool = t; lq_syncTools(st); }
}
function lq_build(ui, v, st){
  lq_css();
  const root = ui.root; root.style.padding = '0'; root.style.overflow = 'hidden';
  const wrap = el('div', {style:'display:flex;height:100%;min-height:360px'});
  const left = el('div', {className:'lq-tools', style:'width:48px;flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;border-right:1px solid #444a54;background:#323741;overflow:auto'});
  const center = el('div', {style:'flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;background:#24272d;overflow:hidden'});
  const right = el('div', {className:'lq-props', style:'width:292px;flex:none;overflow:auto;padding:10px 12px;border-left:1px solid #444a54;background:#323741'});
  wrap.appendChild(left); wrap.appendChild(center); wrap.appendChild(right); root.appendChild(wrap);
  /* 左：工具列（liquify_ui.rs:472） */
  st.tools = left;
  for (const tool of LQ_ALL){
    const b = el('button', {type:'button', title:tr(LQ_STR[tool]) + (LQ_KEY[tool] ? ' (' + LQ_KEY[tool] + ')' : ''), data:{k:'tool-' + tool}}, [LQ_GLYPH[tool]]);
    b.onclick = () => { v.tool = tool; lq_syncTools(st); };
    left.appendChild(b);
    if (tool === 'smooth' || tool === 'pushLeft') left.appendChild(el('div', {style:'height:6px;flex:none'}));
  }
  lq_syncTools(st);
  /* 右：属性（liquify_ui.rs:486-535） */
  st.props = right;
  const P = makeUI(right, Dlg), redraw = () => lq_kick(st);
  P.sec(tr(LQ_STR.brushOpts));
  P.slider({k:'size', label:tr(LQ_STR.size), min:1, max:3000, step:1, get:() => v.size, set:x => { v.size = x; redraw(); }});
  P.slider({k:'density', label:tr(LQ_STR.density), min:0, max:100, step:1, get:() => v.density, set:x => { v.density = x; }});
  P.slider({k:'pressure', label:tr(LQ_STR.pressure), min:0, max:100, step:1, get:() => v.pressure, set:x => { v.pressure = x; }});
  P.slider({k:'rate', label:tr(LQ_STR.rate), min:0, max:100, step:1, get:() => v.rate, set:x => { v.rate = x; }});
  P.sec(tr(LQ_STR.recOpts));
  P.slider({k:'reconstructAmount', label:tr(LQ_STR.amount), min:0, max:100, step:1, unit:'%', get:() => v.reconstructAmount, set:x => { v.reconstructAmount = x; }});
  P.row('', [P.button(tr(LQ_STR.recBtn), () => { st.model.global('reconstructAll', +v.reconstructAmount); redraw(); }, 'reconstruct'),
    P.button(tr(LQ_STR.restoreAll), () => { st.model.restoreAll(); redraw(); }, 'restoreAll')], true);
  P.sec(tr(LQ_STR.maskOpts));
  P.row('', [P.button(tr(LQ_STR.maskNone), () => { st.model.global('thawAll'); redraw(); }, 'maskNone'),
    P.button(tr(LQ_STR.maskAll), () => { st.model.global('freezeAll'); redraw(); }, 'maskAll'),
    P.button(tr(LQ_STR.invertAll), () => { st.model.global('invertFreeze'); redraw(); }, 'invertMask')], true);
  P.sec(tr(LQ_STR.viewOpts));
  P.check({k:'showMesh', label:tr(LQ_STR.showMesh), get:() => v.showMesh, set:x => { v.showMesh = x; redraw(); }});
  P.select({k:'meshView', label:tr(LQ_STR.meshSize), options:[[0, tr(LQ_STR.small)], [1, tr(LQ_STR.medium)], [2, tr(LQ_STR.large)]], get:() => v.meshView, set:x => { v.meshView = +x; redraw(); }});
  P.check({k:'showMask', label:tr(LQ_STR.showMask), get:() => v.showMask, set:x => { v.showMask = x; redraw(); }});
  let opRow = null;
  P.check({k:'showBackdrop', label:tr(LQ_STR.showBackdrop), get:() => v.showBackdrop, set:x => { v.showBackdrop = x; if (opRow) opRow.style.display = x ? '' : 'none'; redraw(); }});
  opRow = P.slider({k:'backdropOpacity', label:tr(LQ_STR.opacity), min:0, max:100, step:1, get:() => v.backdropOpacity, set:x => { v.backdropOpacity = x; redraw(); }});
  opRow.style.display = v.showBackdrop ? '' : 'none';
  P.row('', [P.button(tr(LQ_STR.undo) + ' (Ctrl+Z)', () => { st.model.undo(); redraw(); }, 'undo')], true);
  st.info = P.note(''); st.info.dataset.k = 'liquifyInfo';
  /* 中：预览（canvas 刚好＝整张画布、适合大小；滚轮以指标为中心缩放、中键／空白键拖曳平移） */
  const c = st.model.canvas, cw = Math.max(RW(c), 1), ch = Math.max(RH(c), 1);
  const aw = (center.clientWidth || 800) - 40, ah = (center.clientHeight || 560) - 40;
  const fit = clamp(Math.min(aw / cw, ah / ch), 0.01, 4);
  if (!st.zoom){ st.zoom = fit; st.center = [c.x0 + cw / 2, c.y0 + ch / 2]; }
  st.vw = cw * fit; st.vh = ch * fit; st.dpr = window.devicePixelRatio || 1;
  const view = el('canvas', {className:'lq-view', tabIndex:0, width:Math.max(1, Math.round(st.vw * st.dpr)), height:Math.max(1, Math.round(st.vh * st.dpr)), data:{k:'liquifyCanvas'}});
  view.style.width = st.vw + 'px'; view.style.height = st.vh + 'px'; view.style.background = '#1e2126';
  center.appendChild(view);
  st.view = view; st.vctx = view.getContext('2d');
  view.addEventListener('pointerdown', e => {
    view.focus();
    if (e.button === 1 || (e.button === 0 && st.space)){ st.pan = {x:e.clientX, y:e.clientY}; view.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.button !== 0) return;
    e.preventDefault(); view.setPointerCapture(e.pointerId);
    const q = lq_toDoc(st, e); st.hover = q; st.down = true;
    st.model.pointer({type:'down', x:q[0], y:q[1], pressure:1}, v, performance.now());   // 原码压力恒 1
    lq_kick(st);
  });
  view.addEventListener('pointermove', e => {
    if (st.pan){ st.center = [st.center[0] - (e.clientX - st.pan.x) / st.zoom, st.center[1] - (e.clientY - st.pan.y) / st.zoom]; st.pan = {x:e.clientX, y:e.clientY}; lq_kick(st); return; }
    const q = lq_toDoc(st, e); st.hover = q;
    const m = st.model;
    if (st.down && m.cur && (m.cur.last[0] !== q[0] || m.cur.last[1] !== q[1])) m.pointer({type:'move', x:q[0], y:q[1], pressure:1}, v, performance.now());
    lq_kick(st);
  });
  const up = e => {
    if (st.pan){ st.pan = null; return; }
    if (!st.down) return;
    st.down = false;
    const q = lq_toDoc(st, e);
    st.model.pointer({type:'up', x:q[0], y:q[1]}, v, performance.now());
    lq_kick(st);
  };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  view.addEventListener('pointerleave', () => { if (!st.down){ st.hover = null; lq_kick(st); } });
  view.addEventListener('wheel', e => {
    e.preventDefault();
    const before = lq_toDoc(st, e);
    st.zoom = clamp(st.zoom * Math.exp(-e.deltaY / 200), 0.01, 32);
    const after = lq_toDoc(st, e);
    st.center = [st.center[0] + before[0] - after[0], st.center[1] + before[1] - after[1]];
    lq_kick(st);
  }, {passive:false});
  view.addEventListener('contextmenu', e => e.preventDefault());
  if (!st.keysBound && Dlg.cur){ st.keysBound = true; const box = Dlg.cur.box; box.addEventListener('keydown', e => lq_keys(st, e)); box.addEventListener('keyup', e => lq_keys(st, e)); }
  lq_kick(st);
}
CUSTOM_DIALOGS['filter.liquify'] = init => {
  init = init || {};
  const L = (init.layer !== undefined && init.layer !== null) ? Doc.byId(init.layer) : Doc.active();
  if (!L || L.kind !== 'raster'){ toast(t('error') + tr(LQ_STR.needPixel)); return null; }
  const lk = lockMsg(L); if (lk){ toast(t('error') + lk); return null; }
  const canvas = R(0, 0, Doc.width, Doc.height);
  let cell = null, pre = null;
  try {
    if (init.meshSize !== undefined || init.strokes !== undefined){ const q = lq_params('filter.liquify', init, canvas); if (init.meshSize !== undefined && init.meshSize !== null) cell = q.cell; pre = q.strokes; }
  } catch (e){ toast(t('error') + e.message); return null; }
  const model = new LqModel(Surf.fromLayer(L), canvas, cell);
  if (pre && pre.length){ model.strokes = pre; model.rebuild(); }
  const v = lq_defaultOpts();
  v.size = clamp(Math.round(Math.max(RW(canvas), RH(canvas)) / 10), 10, 1500);   // liquify_ui.rs:270 起始笔刷＝图的十分之一
  for (const k of Object.keys(v)) if (init[k] !== undefined && init[k] !== null) v[k] = typeof v[k] === 'number' ? +init[k] : init[k];
  if (!LQ_TOOLS.includes(v.tool) || lq_isGlobal(v.tool)) v.tool = 'forwardWarp';
  const st = {model, L, v, zoom:0, center:[0, 0], hover:null, down:false, raf:0, closed:false};   // st.v：工具列／快捷键读目前选项
  st.pcanvas = document.createElement('canvas'); st.pcanvas.width = model.proxy.w; st.pcanvas.height = model.proxy.h;
  st.pctx = st.pcanvas.getContext('2d'); st.img = st.pctx.createImageData(model.proxy.w, model.proxy.h);
  return Dlg.open({
    id:'filter.liquify', wide:true, preview:false, v, state:st,
    title:tr(LQ_STR.title) + ' (' + L.name + ')',
    build:lq_build,
    /* liquify_ui.rs:277 commit：结束画到一半的笔画；没有笔画就不跑（关掉即可） */
    params(v, st){ st.model.end(); if (!st.model.strokes.length) return null; return {strokes:JSON.parse(JSON.stringify(st.model.strokes)), meshSize:st.model.cell, layer:st.L.id}; },
    onClose(){ st.closed = true; if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }
  });
};

/* ──────────────── 段：20-vanishing.js ──────────────── */
/* ═══════════ 消失点（engine/src/vp_cmds.rs 1-208 ＋ algo/src/vanishing.rs 1-331；投影变换用共用段 06-transform.js〔transform.rs〕） ═══════════
   平面＝跟照片里平面对齐的四边形；两个消失点 ⇒ 焦距 f² = −(v₁−c)·(v₂−c)（Hartley & Zisserman §8.8）⇒ 把四角抬到 3-D：得到平面的真实长宽比、可沿边撕出垂直平面。
   贴上＝把图片的矩形对应到平面的公制座标再用合成的单应扭过去（裁在平面内）；仿制图章＝每个落点拷「同一公制位移」处的像素（远处纹理跟着缩小）。 */
const vp_sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], vp_add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vp_mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], vp_dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vp_cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vp_norm = a => vp_mul(a, 1 / Math.max(Math.sqrt(vp_dot(a, a)), 1e-300));
const vp_meet = (a, b, c, d) => vp_cross(vp_cross([a[0], a[1], 1], [b[0], b[1], 1]), vp_cross([c[0], c[1], 1], [d[0], d[1], 1]));   // vanishing.rs:44
/* vanishing.rs:52 VpPlane（四角顺时针、从平面左上起） */
const vp_homography = pl => Homography.rectToQuad([0, 0, 1, 1], pl.corners);
function vp_focal(pl, c){                                          // vanishing.rs:83
  const q = pl.corners, v1 = vp_meet(q[0], q[1], q[3], q[2]), v2 = vp_meet(q[0], q[3], q[1], q[2]);
  if (Math.abs(v1[2]) < 1e-9 || Math.abs(v2[2]) < 1e-9) return null;
  const a = [v1[0] / v1[2] - c[0], v1[1] / v1[2] - c[1]], b = [v2[0] / v2[2] - c[0], v2[1] / v2[2] - c[1]], f2 = -(a[0] * b[0] + a[1] * b[1]);
  return f2 > 1 ? Math.sqrt(f2) : null;
}
function vp_lift(pl, f, c){                                         // vanishing.rs:96 lift
  const ray = p => [(p[0] - c[0]) / f, (p[1] - c[1]) / f, 1], q = pl.corners;
  const dir = (a, b, cc, d) => { const v = vp_meet(a, b, cc, d); return Math.abs(v[2]) < 1e-9 * Math.max(Math.abs(v[0]) + Math.abs(v[1]), 1) ? vp_norm([v[0], v[1], 0]) : vp_norm(ray([v[0] / v[2], v[1] / v[2]])); };
  const d1 = dir(q[0], q[1], q[3], q[2]), d2 = dir(q[0], q[3], q[1], q[2]);
  let n = vp_norm(vp_cross(d1, d2)); if (n[2] < 0) n = vp_mul(n, -1);
  const pts = q.map(p => { const r = ray(p); return vp_mul(r, 1 / Math.max(Math.abs(vp_dot(n, r)), 1e-9)); });
  return {focal:f, center:c, pts};
}
const vp_project = (lf, x) => x[2] > 1e-9 ? [lf.center[0] + lf.focal * x[0] / x[2], lf.center[1] + lf.focal * x[1] / x[2]] : null;   // vanishing.rs:120
function vp_lengths(lf){ const l = (a, b) => Math.sqrt(vp_dot(vp_sub(a, b), vp_sub(a, b))), p = lf.pts; return [(l(p[0], p[1]) + l(p[3], p[2])) / 2, (l(p[0], p[3]) + l(p[1], p[2])) / 2]; }   // vanishing.rs:124
/* vanishing.rs:132 Scene */
function vp_newScene(first, center, focal, fallback){
  const f = (focal !== null && focal > 1) ? focal : (vp_focal(first, center) || fallback);
  return {planes:[first], focal:f, center};
}
const vp_lifted = (sc, i) => vp_lift(sc.planes[i], sc.focal, sc.center);
/* 边：[起角, 终角, 对边角]（顺时针）；撕出的子平面里「共享边」的两角（母平面起角→子角、终角→子角） */
const VP_EDGE = {top:[0, 1, 3], right:[1, 2, 0], bottom:[2, 3, 1], left:[3, 0, 2]}, VP_SHARED = {top:[3, 2], right:[0, 3], bottom:[1, 0], left:[2, 1]};
const VP_OPP = {top:'bottom', bottom:'top', left:'right', right:'left'}, VP_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
function vp_tearBasis(lf, edge){
  const p = lf.pts, [ia, ib, ic] = VP_EDGE[edge], a = p[ia], b = p[ib], inward = vp_sub(p[ic], p[ia]);
  return {a, b, axis:vp_norm(vp_sub(b, a)), inward, inLen:Math.sqrt(vp_dot(inward, inward)), out:vp_mul(vp_norm(inward), -1)};
}
/* 两种转向各算一遍；chosen＝原码挑的（「面向相机、母平面在前」＝房间墙角；90° 两边同分取 sgn=+1）。
   angle>180（我们加的）＝折到另一边：用 360−angle 的角度、取原码没挑的那个转向（楼梯一阶的凸角＝270） */
function vp_tearRes(lf, edge, angle, depth){
  const {a, b, axis, inward, inLen, out} = vp_tearBasis(lf, edge), len = inLen * Math.max(depth, 0.05);
  const back = angle > 180, th = (180 - (back ? 360 - angle : angle)) * DEG, res = [];
  let best = null;
  for (const sgn of [1, -1]){                                       // 两种转向挑「面向相机、母平面在前」那个（房间墙角）
    const s = Math.sin(sgn * th), c = Math.cos(sgn * th);
    const rot = vp_add(vp_add(vp_mul(out, c), vp_mul(vp_cross(axis, out), s)), vp_mul(axis, vp_dot(axis, out) * (1 - c)));
    const a2 = vp_add(a, vp_mul(rot, len)), b2 = vp_add(b, vp_mul(rot, len));
    const pa = vp_project(lf, a), pb = vp_project(lf, b), pa2 = vp_project(lf, a2), pb2 = vp_project(lf, b2);
    if (!pa || !pb || !pa2 || !pb2){ res.push(null); continue; }
    let n2 = vp_norm(vp_cross(vp_sub(b, a), vp_sub(a2, a))); if (vp_dot(n2, a) > 0) n2 = vp_mul(n2, -1);
    const score = vp_dot(n2, inward), r = [score, [pa, pb, pa2, pb2], sgn]; res.push(r);
    if (!best || score > best[0] + 1e-9) best = r;                    // 90° 两边理论上同分 ⇒ 取 sgn=+1；容差免得浮点杂讯随 depth 翻边
  }
  if (!back || !best) return best;
  return res.find(r => r && r !== best) || null;
}
/* 原码挑哪个转向（1／-1；两边都在相机后面＝0） */
const vp_tearPick = (lf, edge, a0) => { const r = vp_tearRes(lf, edge, a0, 1); return r ? r[2] : 0; };
function vp_tearOff(sc, from, edge, angle, depth){                    // vanishing.rs:151 tear_off
  const best = vp_tearRes(vp_lifted(sc, from), edge, angle, depth);
  if (!best) return null;
  const [pa, pb, pa2, pb2] = best[1];
  const corners = edge === 'top' ? [pa2, pb2, pb, pa] : edge === 'right' ? [pa, pa2, pb2, pb] : edge === 'bottom' ? [pb, pa, pa2, pb2] : [pb2, pb, pa, pa2];
  sc.planes.push({corners, from, edge});                             // from／edge：记下相连关系（贴上物顺着折过去）
  return sc.planes.length - 1;
}
/* 滑鼠 → 撕出平面的 {angle, depth}（对话框 Ctrl＋拖边中点）。母平面 from 抬到 3-D，ray＝滑鼠的视线：
   free（Alt）＝视线交「过边中点、法向＝边」的平面 ⇒ 方向角 φ 与长度一起解；否则 φ 固定（phi 没给＝90° 两边挑滑鼠那边），长度＝视线跟那条直线的最近点 */
function vp_tearSolve(sc, from, edge, p, free, phi){
  const lf = vp_lifted(sc, from), {a, b, axis, inLen, out} = vp_tearBasis(lf, edge), side = vp_cross(axis, out);
  const m = vp_mul(vp_add(a, b), 0.5), r = [(p[0] - lf.center[0]) / lf.focal, (p[1] - lf.center[1]) / lf.focal, 1];
  if (!(inLen > 1e-12)) return null;
  let len;
  if (free){
    const den = vp_dot(axis, r); if (Math.abs(den) < 1e-12) return null;
    const t = vp_dot(axis, m) / den; if (!(t > 0)) return null;
    let d = vp_sub(vp_mul(r, t), m); d = vp_sub(d, vp_mul(axis, vp_dot(axis, d)));
    len = Math.sqrt(vp_dot(d, d)); if (!(len > 1e-12)) return null;
    phi = Math.atan2(vp_dot(d, side), vp_dot(d, out));
  } else {
    if (phi === undefined || phi === null){                           // 90°：预设折向远离相机那侧（PS：像楼梯踏面往里走）；滑鼠明显拖在另一侧才折过来（地面拉出墙）
      const P0 = vp_project(lf, m); if (!P0) return null;
      const away = vp_dot(side, m) > 0 ? 1 : -1, q = vp_project(lf, vp_add(m, vp_mul(side, away * inLen * 0.05)));
      const dd = q ? (q[0] - P0[0]) * (p[0] - P0[0]) + (q[1] - P0[1]) * (p[1] - P0[1]) : 1;
      phi = (dd >= 0 ? away : -away) * Math.PI / 2;
    }
    const dir = vp_add(vp_mul(out, Math.cos(phi)), vp_mul(side, Math.sin(phi)));
    const B = vp_dot(dir, r), C = vp_dot(r, r), D = vp_dot(dir, m), E = vp_dot(r, m), den = C - B * B;
    if (Math.abs(den) < 1e-12) return null;
    len = (B * E - C * D) / den;
  }
  const a0 = clamp(Math.round((180 - Math.abs(phi) / DEG) * 10) / 10, 1, 179), s = phi >= 0 ? 1 : -1;
  const angle = vp_tearPick(lf, edge, a0) === s || a0 === 180 ? a0 : Math.round((360 - a0) * 10) / 10;
  return {angle, depth:clamp(Math.round(len / inLen * 100) / 100, 0.05, 50), phi};
}
/* 已撕出平面（angle）现在的 φ（拉伸＝只改 depth 时沿同一方向） */
function vp_tearPhi(sc, from, edge, angle){
  const lf = vp_lifted(sc, from), back = angle > 180, a0 = back ? 360 - angle : angle, s = vp_tearPick(lf, edge, a0) || 1;
  return (back ? -s : s) * (180 - a0) * DEG;
}
function vp_frame(sc, i){ const h = vp_homography(sc.planes[i]); if (!h) return null; const [lu, lv] = vp_lengths(vp_lifted(sc, i)); return [h, lu, lv]; }   // vanishing.rs:198
function vp_planeAt(sc, p){                                         // vanishing.rs:205
  for (let i = sc.planes.length - 1; i >= 0; i--){
    const h = vp_homography(sc.planes[i]), inv = h && h.inverse(); if (!inv) continue;
    const [u, v] = inv.apply(p[0], p[1]); if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return i;
  }
  return null;
}
function vp_quadMask(h, area){                                      // vanishing.rs:216
  const inv = h.inverse(), w = RW(area), N = w * RH(area), m = new Float32Array(N); if (!inv) return m;
  for (let i = 0; i < N; i++){ const [u, v] = inv.apply(area.x0 + i % w + 0.5, area.y0 + Math.floor(i / w) + 0.5); m[i] = (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? 1 : 0; }
  return m;
}
/* 贴上物「图片像素 → 平面座标 (u,v)」的仿射：左上（未转前）在 at、宽占平面宽 width、按平面公制保比例；
   angle（度，画面上顺时针为正，同 PS 变形）／flipH／flipV 绕贴上物中心在平面「公制」座标（u·lu, v·lv）里做，转了不会被平面长宽比拉歪 */
function vp_pasteMat(lu, lv, rect, at, width, angle, fh, fv){
  const sw = RW(rect), sh = RH(rect), s = width * lu / sw;                  // s＝每图片像素多少公制单位
  if (!angle && !fh && !fv){ const su = width / sw, sv = width * lu / lv / sw; return new Homography([su, 0, at[0] - rect.x0 * su, 0, sv, at[1] - rect.y0 * sv, 0, 0, 1]); }   // 原码那条（不转不翻）
  const a = angle * DEG, c = Math.cos(a), sn = Math.sin(a), fx = fh ? -1 : 1, fy = fv ? -1 : 1;
  const cxp = rect.x0 + sw / 2, cyp = rect.y0 + sh / 2, cmx = at[0] * lu + sw * s / 2, cmy = at[1] * lv + sh * s / 2;
  return new Homography([c * s * fx / lu, -sn * s * fy / lu, (cmx - c * s * fx * cxp + sn * s * fy * cyp) / lu,
    sn * s * fx / lv, c * s * fy / lv, (cmy - sn * s * fx * cxp - c * s * fy * cyp) / lv, 0, 0, 1]);
}
/* vanishing.rs:231 paste：图片左上放在平面座标 at、宽占平面宽 width，按平面公制保比例；裁在平面内（＋angle／翻转） */
function vp_paste(sc, i, src, srcRect, at, width, angle, fh, fv){
  const fr = vp_frame(sc, i); if (!fr) return null;
  const [h, lu, lv] = fr, sw = RW(srcRect), sh = RH(srcRect);
  if (sw <= 0 || sh <= 0) return null;
  const toPlane = vp_pasteMat(lu, lv, srcRect, at, width, angle || 0, !!fh, !!fv);
  const out = warpSurface(src, srcRect, h.mul(toPlane), 'bicubic');
  const b = out.contentBounds(); if (rEmpty(b)) return out;
  const mask = vp_quadMask(h, b), data = out.readRegion(b);
  for (let k = 0; k < mask.length; k++) data[k * 4 + 3] *= mask[k];
  out.writeRegion(b, data);
  return out;
}
/* 平面网展开（像纸盒摊平）：从 root 沿「撕出」关系（母↔子共享一条边）走遍相连平面；
   每个平面 j 回 T＝「j 的公制座标 (u·lu, v·lv) → root 公制」的相似变换（沿共享边转正、按共享边长对齐尺度，子平面落在边的另一侧） */
function vp_net(sc, root){
  const fr = sc.planes.map((_, i) => vp_frame(sc, i)), node = new Map();
  if (!fr[root]) return [];
  const met = (i, k) => [VP_UV[k][0] * fr[i][1], VP_UV[k][1] * fr[i][2]];
  /* 子 c（经母 p 的 edge 撕出）公制 → 母公制：复数 z' = α z + β，把子的共享边两角对到母的那两角 */
  const link = (p, c, edge) => {
    const [ia, ib] = VP_EDGE[edge], [ca, cb] = VP_SHARED[edge], A = met(p, ia), B = met(p, ib), a = met(c, ca), b = met(c, cb);
    const dx = a[0] - b[0], dy = a[1] - b[1], n = dx * dx + dy * dy; if (!(n > 1e-24)) return null;
    const Dx = A[0] - B[0], Dy = A[1] - B[1], ar = (Dx * dx + Dy * dy) / n, ai = (Dy * dx - Dx * dy) / n;
    return new Homography([ar, -ai, A[0] - (ar * a[0] - ai * a[1]), ai, ar, A[1] - (ai * a[0] + ar * a[1]), 0, 0, 1]);
  };
  node.set(root, Homography.identity());
  const queue = [root];
  while (queue.length){
    const i = queue.shift(), Ti = node.get(i);
    sc.planes.forEach((pl, j) => {
      if (node.has(j) || !fr[j]) return;
      let T = null;
      if (pl.from === i && pl.edge){ const S = link(i, j, pl.edge); if (S) T = Ti.mul(S); }                       // i 的子
      else if (sc.planes[i].from === j && sc.planes[i].edge){ const S = link(j, i, sc.planes[i].edge), Si = S && S.inverse(); if (Si) T = Ti.mul(Si); }   // i 的母
      if (T){ node.set(j, T); queue.push(j); }
    });
  }
  return [...node].map(([i, T]) => ({i, T, Ti:T.inverse(), h:fr[i][0], hi:fr[i][0].inverse(), lu:fr[i][1], lv:fr[i][2]})).filter(n => n.Ti && n.hi);
}
/* 贴上物「图片像素 → 平面 j 的 (u,v)」：root 的 vp_pasteMat 先到 root 公制、经展开图回 j 公制、再除 j 的长宽 */
const vp_netMat = (n, lu, lv, M) => new Homography([1 / n.lu, 0, 0, 0, 1 / n.lv, 0, 0, 0, 1]).mul(n.Ti).mul(new Homography([lu, 0, 0, 0, lv, 0, 0, 0, 1])).mul(M);
/* 折过去的贴上：每个相连平面各自以「目的格反查」画（只看落在该平面四边形里的格＝该平面的 quadMask），先到先得（BFS 次序、root 优先）。
   不用 warpSurface 整张扭：贴上物超出某平面地平线的部分会投到相机后面、外框算不出来 */
function vp_pasteWrap(sc, i, src, srcRect, at, width, angle, fh, fv, canvas){
  const net = vp_net(sc, i);
  if (net.length <= 1) return vp_paste(sc, i, src, srcRect, at, width, angle, fh, fv);
  const sw = RW(srcRect), sh = RH(srcRect); if (sw <= 0 || sh <= 0) return null;
  const lu = net[0].lu, lv = net[0].lv, M = vp_pasteMat(lu, lv, srcRect, at, width, angle || 0, !!fh, !!fv);
  const boxes = net.map(n => {
    const q = VP_UV.map(c => n.h.apply(c[0], c[1])); if (q.some(c => !c.every(isFinite))) return EMPTY;
    return rInter(R(Math.floor(Math.min(...q.map(c => c[0]))) - 1, Math.floor(Math.min(...q.map(c => c[1]))) - 1, Math.ceil(Math.max(...q.map(c => c[0]))) + 1, Math.ceil(Math.max(...q.map(c => c[1]))) + 1), canvas);
  });
  let area = EMPTY; boxes.forEach(b => { if (!rEmpty(b)) area = rEmpty(area) ? b : rUnion(area, b); });
  if (rEmpty(area)) return null;
  const aw = RW(area), outp = new Float32Array(aw * RH(area) * 4), claimed = new Uint8Array(aw * RH(area)), acc = new Float64Array(4);
  const srcs = new Map();                                             // 大幅缩小先预缩（同 warpSurface），按倍率快取
  const source = f => {
    if (!srcs.has(f)){ const s = f === 1 ? src : resizeSurface(src, f, f, 'bicubic'), r = f === 1 ? srcRect : scaledRect(srcRect, f, f), px = s.readRegion(r); premultiply(px, 4, true); srcs.set(f, {r, px, w:RW(r)}); }
    return srcs.get(f);
  };
  net.forEach((n, k) => {
    const b = boxes[k]; if (rEmpty(b)) return;
    const P = vp_netMat(n, lu, lv, M), full = n.h.mul(P), fullInv = full.inverse(); if (!fullInv) return;
    const qc = n.h.apply(0.5, 0.5), sc0 = fullInv.apply(qc[0], qc[1]), scale = full.localScale(sc0[0], sc0[1]);
    const f = scale < 0.5 && scale > 0 ? Math.min(Math.pow(2, Math.ceil(Math.log2(scale))), 1) : 1;
    const S = source(f), inv = f === 1 ? fullInv : new Homography([f, 0, 0, 0, f, 0, 0, 0, 1]).mul(fullInv), r = S.r;
    const at_ = (x, y, c) => (x < r.x0 || y < r.y0 || x >= r.x1 || y >= r.y1) ? 0 : S.px[((y - r.y0) * S.w + (x - r.x0)) * 4 + c];
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++){
      const o = (y - area.y0) * aw + (x - area.x0); if (claimed[o]) continue;
      const [pu, pv] = n.hi.apply(x + 0.5, y + 0.5); if (!(pu >= 0 && pu <= 1 && pv >= 0 && pv <= 1)) continue;   // 该平面的 quadMask
      claimed[o] = 1;
      let [u, v] = inv.apply(x + 0.5, y + 0.5); u -= 0.5; v -= 0.5;
      if (!(u >= r.x0 - 1 && v >= r.y0 - 1 && u <= r.x1 && v <= r.y1)) continue;
      const ix = Math.floor(u), iy = Math.floor(v), wx = tf_catmullRom(u - ix), wy = tf_catmullRom(v - iy); acc.fill(0);
      for (let jj = 0; jj < 4; jj++) for (let ii = 0; ii < 4; ii++){ const kk = wx[ii] * wy[jj]; for (let c = 0; c < 4; c++) acc[c] += at_(ix - 1 + ii, iy - 1 + jj, c) * kk; }
      const al = clamp(acc[3], 0, 1); if (al <= 0) continue;
      for (let c = 0; c < 3; c++) outp[o * 4 + c] = clamp(acc[c] / al, 0, 1);
      outp[o * 4 + 3] = al;
    }
  });
  const out = new Surf(area.x0, area.y0, aw, RH(area)); out.writeRegion(area, outp);
  return out;
}
function vp_sample(s, x, y){                                        // vanishing.rs:326 双线性
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, r = s.readRegion(R(x0, y0, x0 + 2, y0 + 2)), o = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) o[c] = (r[c] * (1 - tx) + r[4 + c] * tx) * (1 - ty) + (r[8 + c] * (1 - tx) + r[12 + c] * tx) * ty;
  return o;
}
/* vanishing.rs:263 clone_stroke：一笔落点（目标平面上），从 source 拷；位移在第一落点固定成平面公制；size＝第一落点处的笔刷直径 px */
function vp_cloneStroke(sc, surf, source, points, size, hardness, opacity, k){
  if (!points.length) return 0;
  const first = points[0], ps = vp_planeAt(sc, source), pd = vp_planeAt(sc, first);
  if (ps === null) throw vp_bad('clone ' + k + ': `source` is not on any plane');            // 原码静默 return 0 ⇒ 改报错（PS 在平面外不给落笔）
  if (pd === null) throw vp_bad('clone ' + k + ': the first point is not on any plane');
  const fs = vp_frame(sc, ps), fd = vp_frame(sc, pd); if (!fs || !fd) return 0;
  const [hs, lus, lvs] = fs, [hd, lud, lvd] = fd, hsInv = hs.inverse(), hdInv = hd.inverse(); if (!hsInv || !hdInv) return 0;
  const metric = (inv, lu, lv, p) => { const [u, v] = inv.apply(p[0], p[1]); return [u * lu, v * lv]; };
  const ms = metric(hsInv, lus, lvs, source), md0 = metric(hdInv, lud, lvd, first), offset = [ms[0] - md0[0], ms[1] - md0[1]];
  const probe = metric(hdInv, lud, lvd, [first[0] + size / 2, first[1]]), rM = Math.max(Math.hypot(probe[0] - md0[0], probe[1] - md0[1]), 1e-9);
  const srcCopy = surf.clone();
  let dabs = 0;
  for (const p of points){
    const mc = metric(hdInv, lud, lvd, p);
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 16; k++){                                  // 公制圆的外框映回影像
      const a = k / 16 * TAU, [x, y] = hd.apply((mc[0] + rM * Math.cos(a)) / lud, (mc[1] + rM * Math.sin(a)) / lvd);
      bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
    }
    if (!bb.every(isFinite)) continue;
    const area = R(Math.floor(bb[0]), Math.floor(bb[1]), Math.ceil(bb[2]) + 1, Math.ceil(bb[3]) + 1);
    if (rEmpty(area) || RW(area) > 4096 || RH(area) > 4096) continue;
    const data = surf.readRegion(area), w = RW(area); let changed = false;
    for (let i = 0; i < RW(area) * RH(area); i++){
      const x = area.x0 + i % w + 0.5, y = area.y0 + Math.floor(i / w) + 0.5, m = metric(hdInv, lud, lvd, [x, y]);
      const d = Math.hypot(m[0] - mc[0], m[1] - mc[1]) / rM; if (d >= 1) continue;
      const hard = clamp(hardness, 0, 0.99), fall = d <= hard ? 1 : 1 - (d - hard) / (1 - hard), k = fall * fall * (3 - 2 * fall) * opacity;
      const [sx, sy] = hs.apply((m[0] + offset[0]) / lus, (m[1] + offset[1]) / lvs), s = vp_sample(srcCopy, sx - 0.5, sy - 0.5);
      for (let c = 0; c < 4; c++) data[i * 4 + c] += (s[c] - data[i * 4 + c]) * k;
      changed = true;
    }
    if (changed){ surf.writeRegion(area, data); dabs++; }
  }
  return dabs;
}

/* ── vp_cmds.rs ── */
const vp_bad = msg => new FltBad('filter.vanishingPoint: ' + msg);
const vp_pt = v => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
function vp_scene(p, canvas){                                       // vp_cmds.rs:26 scene
  const planes = Array.isArray(p.planes) && p.planes.length ? p.planes : null;
  if (!planes) throw vp_bad('pass `planes`: [{"corners":[[x,y]×4]}, {"from":0,"edge":"top","angle":90}]');
  const center = [(canvas.x0 + canvas.x1) / 2, (canvas.y0 + canvas.y1) / 2];
  const corners = v => { const a = v && v.corners; if (!Array.isArray(a)) return null; const q = [0, 1, 2, 3].map(i => vp_pt(a[i])); return q.every(x => x) ? q : null; };
  const first = corners(planes[0]); if (!first) throw vp_bad('the first plane needs four `corners`');
  const focal = typeof p.focalLength === 'number' && p.focalLength > 0 ? p.focalLength : null;
  const sc = vp_newScene({corners:first}, center, focal, Math.max(RW(canvas), RH(canvas)));
  for (let i = 1; i < planes.length; i++){
    const pl = planes[i], c = corners(pl);
    if (c){ sc.planes.push({corners:c}); continue; }
    const from = typeof pl.from === 'number' && pl.from >= 0 && Number.isInteger(pl.from) && pl.from < sc.planes.length ? pl.from : null;
    if (from === null) throw vp_bad('plane ' + i + ': `corners` or `from` (an earlier plane)');
    const edge = typeof pl.edge === 'string' ? pl.edge : 'top';
    if (!['top', 'right', 'bottom', 'left'].includes(edge)) throw vp_bad('plane ' + i + ': unknown edge `' + edge + '`');
    const angle = typeof pl.angle === 'number' ? pl.angle : 90, depth = typeof pl.depth === 'number' ? pl.depth : 1;
    if (vp_tearOff(sc, from, edge, angle, depth) === null) throw vp_bad('plane ' + i + ' would lie behind the camera');
  }
  if (sc.planes.some(q => !vp_homography(q))) throw vp_bad('a plane is degenerate');
  return sc;
}
function vp_over(dst, top){                                          // vp_cmds.rs:78 over（直通 source-over）
  const b = top.contentBounds(); if (rEmpty(b)) return;
  const t = top.readRegion(b), d = dst.readRegion(b);
  for (let i = 0; i < t.length; i += 4){
    const ta = t[i + 3], da = d[i + 3], oa = ta + da * (1 - ta);
    for (let c = 0; c < 3; c++) d[i + c] = oa > 0 ? (t[i + c] * ta + d[i + c] * da * (1 - ta)) / oa : 0;
    d[i + 3] = oa;
  }
  dst.writeRegion(b, d);
}
function vp_flattened(skip){                                         // file_cmds::flattened：看得到的整张图（skip＝先藏起来的层，免得目前层被算两次）
  const was = skip ? skip.visible : false; if (skip) skip.visible = false;
  let c; try { c = composite(1); } finally { if (skip) skip.visible = was; }
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, s = new Surf(0, 0, c.width, c.height);
  for (let i = 0; i < d.length; i++) s.data[i] = d[i] / 255;
  return s;
}
/* 贴上来源：layer＝像素层 id；空／没给＝共用剪贴簿（DlClipboard）。回 [surf, 有内容的范围] */
function vp_pasteSrc(layer, k){
  if (layer !== undefined && layer !== null && layer !== ''){
    const Ls = Doc.byId(layer); if (!Ls || Ls.kind !== 'raster') throw vp_bad('paste ' + k + ': no pixel layer ' + layer);
    const surf = Surf.fromLayer(Ls); return [surf, surf.contentBounds()];
  }
  const cp = window.DlClipboard && DlClipboard.asPixels ? DlClipboard.asPixels() : null;
  if (!cp) throw vp_bad('paste ' + k + ': nothing on the clipboard (or pass `layer`)');
  const [x0, y0, x1, y1] = cp.bounds, surf = new Surf(x0, y0, x1 - x0, y1 - y0); for (let i = 0; i < cp.px.length; i++) surf.data[i] = cp.px[i] / 255;
  return [surf, surf.contentBounds()];
}
const vp_normAngle = a => { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; };   // 收成 (-180, 180]
/* 修复（PS 消失点图章「修复」：关／明度／开）：只在这一笔改到的格上，以原像素为边界、仿制像素为引导场解泊松（tools/spotheal.js HealCore.healRegion＝poisson.rs seamless_clone）；
   明度＝只借泊松解出来的亮度落差，颜色留仿制来的 */
/* raw＝同一笔放大一圈、硬边全不透明仿出来的纯仿制像素（引导场要盖到遮罩外一圈，边界落差才量得到）；解完照这一笔的软边（nw 离原像素走了几成）混回 */
function vp_heal(mode, b, nw, ow, raw, changed){
  const HC = window.HealCore; if (!HC || !HC.healRegion) throw vp_bad('healing needs tools/spotheal.js (HealCore)');
  const rect = [b.x0, b.y0, b.x1, b.y1];
  const hd = HC.healRegion({rect, ch:4, data:Float32Array.from(raw)}, {rect, ch:4, data:Float32Array.from(ow)}, changed).data;
  const Y = (a, i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2], out = Float32Array.from(nw);
  for (let i = 0; i < out.length; i += 4){
    if (!changed[i >> 2]) continue;
    let num = 0, den = 0; for (let c = 0; c < 4; c++){ num += Math.abs(nw[i + c] - ow[i + c]); den += Math.abs(raw[i + c] - ow[i + c]); }
    const w = den > 1e-6 ? clamp(num / den, 0, 1) : 1, h = [0, 0, 0, 0];
    if (mode === 'luminance'){ const dy = Y(hd, i) - Y(raw, i); for (let c = 0; c < 3; c++) h[c] = clamp(raw[i + c] + dy, 0, 1); h[3] = raw[i + 3]; }   // 明度：颜色留仿制的，只借亮度落差
    else for (let c = 0; c < 4; c++) h[c] = hd[i + c];
    for (let c = 0; c < 4; c++) out[i + c] = ow[i + c] + (h[c] - ow[i + c]) * w;
  }
  return out;
}
/* vp_cmds.rs:102 vanishing_point */
SURF_OPS['filter.vanishingPoint'] = (L, p, opt) => {
  const canvas = R(0, 0, Doc.width, Doc.height), sc = vp_scene(p, canvas);
  const pastes = [];
  (Array.isArray(p.paste) ? p.paste : []).forEach((item, k) => {   // 贴上来源先取好（图层像素或剪贴簿）
    item = item || {};
    const plane = typeof item.plane === 'number' ? Math.max(0, Math.floor(item.plane)) : 0;
    if (plane >= sc.planes.length) throw vp_bad('paste ' + k + ': no plane ' + plane);
    const [surf, rect] = vp_pasteSrc(item.layer, k);
    const at = vp_pt(item.at) || [0.25, 0.25], width = clamp(typeof item.width === 'number' ? item.width : 0.5, 0.01, 10);
    if (!at.every(isFinite) || Math.abs(at[0]) > 100 || Math.abs(at[1]) > 100) throw vp_bad('paste ' + k + ': `at` must be [u,v] within -100..100');
    if (item.angle !== undefined && (typeof item.angle !== 'number' || !isFinite(item.angle) || Math.abs(item.angle) > 3600)) throw vp_bad('paste ' + k + ': `angle` must be degrees -3600..3600');
    ['flipH', 'flipV', 'wrap'].forEach(f => { if (item[f] !== undefined && typeof item[f] !== 'boolean') throw vp_bad('paste ' + k + ': `' + f + '` must be true/false'); });
    pastes.push([plane, surf, rect, at, width, vp_normAngle(item.angle || 0), item.flipH === true, item.flipV === true, item.wrap !== false]);
  });
  const clones = Array.isArray(p.clone) ? p.clone : [];
  const newLayer = p.newLayer === true && !opt.preview;               // 预览不新建层、直接画在目前层上
  let T = L;
  const base = p.newLayer === true ? vp_flattened() : null;           // 新层：从看得到的整张图仿制；否则从图层本身
  if (newLayer){
    const N = Layer.raster(tr(S('消失點', '消失点', 'Vanishing Point')));
    Doc.add(N, Doc.index(L.id) + 1); T = N;
  }
  const m = lockMsg(T); if (m) throw new FltBad(m);
  const surf = Surf.fromLayer(T);
  for (const [plane, src, rect, at, width, angle, fh, fv, wrap] of pastes){   // wrap（缺省，同 PS）＝顺着相连平面折过去；false＝只落在 plane 一面
    const out = wrap ? vp_pasteWrap(sc, plane, src, rect, at, width, angle, fh, fv, canvas) : vp_paste(sc, plane, src, rect, at, width, angle, fh, fv);
    if (out) vp_over(surf, out);
  }
  /* 取样（PS 消失点在空层上照样从看得到的图仿制）：auto＝目前层在 source 处透明就从整张图取、否则从目前层；current＝只从目前层；all＝整张图 */
  const sample = p.sample === undefined ? 'auto' : p.sample;
  if (!['auto', 'current', 'all'].includes(sample)) throw vp_bad('unknown sample `' + sample + '` (auto|current|all)');
  let below = null;                                                   // 整张图（藏起目前层，目前层再由 surf 叠上去）
  const heals = ['off', 'luminance', 'on'];
  let dabs = 0;
  clones.forEach((c, k) => {
    c = c || {};
    const source = vp_pt(c.source); if (!source) throw vp_bad('clone ' + k + ': `source` [x,y]');
    const points = Array.isArray(c.points) ? c.points.map(vp_pt).filter(x => x) : [];
    const size = clamp(typeof c.size === 'number' ? c.size : 40, 1, 2000), hardness = clamp(typeof c.hardness === 'number' ? c.hardness : 50, 0, 100) / 100;
    const opacity = clamp(typeof c.opacity === 'number' ? c.opacity : 100, 0, 100) / 100;
    const heal = c.heal !== undefined ? c.heal : p.heal !== undefined ? p.heal : 'off';
    if (!heals.includes(heal)) throw vp_bad('clone ' + k + ': unknown heal `' + heal + '` (off|luminance|on)');
    const all = !base && (sample === 'all' || (sample === 'auto' && vp_sample(surf, source[0] - 0.5, source[1] - 0.5)[3] < 1 / 255));
    if (all && !below) below = vp_flattened(T);
    let work; if (base || all){ work = (base || below).clone(); vp_over(work, surf); } else work = surf.clone();   // 从原像素（含刚贴上的）取样
    const before = work.clone(), rawW = heal === 'off' ? null : work.clone();
    dabs += vp_cloneStroke(sc, work, source, points, size, hardness, opacity, k);
    if (rawW) vp_cloneStroke(sc, rawW, source, points, size + 6, 1, 1, k);
    const b0 = rUnion(work.contentBounds(), before.contentBounds()), b = rawW ? rUnion(b0, rawW.contentBounds()) : b0;   // 只拷回这一笔改到的格
    if (!rEmpty(b)){
      const nw = work.readRegion(b), ow = before.readRegion(b), cur = surf.readRegion(b), changed = new Uint8Array(cur.length >> 2);
      for (let i = 0; i < cur.length; i += 4) if (nw[i] !== ow[i] || nw[i + 1] !== ow[i + 1] || nw[i + 2] !== ow[i + 2] || nw[i + 3] !== ow[i + 3]) changed[i >> 2] = 1;
      const got = heal === 'off' ? nw : vp_heal(heal, b, nw, ow, rawW.readRegion(b), changed);
      for (let i = 0; i < cur.length; i += 4) if (changed[i >> 2]) for (let q = 0; q < 4; q++) cur[i + q] = got[i + q];
      surf.writeRegion(b, cur);
    }
  });
  surf.toLayer(T); Layer.invalidate(T);
  const planes = sc.planes.map((pl, i) => { const [lu, lv] = vp_lengths(vp_lifted(sc, i)); return {corners:pl.corners, aspect:lu / lv}; });
  return {ok:true, layer:T.id, focal:sc.focal, planes, pasted:pastes.length, dabs};
};
PARAM_SPECS['filter.vanishingPoint'] = '{"planes":[{"corners":[[x,y]×4]} | {"from":plane (any earlier plane, torn-off ones too ⇒ chains like stairs),"edge":"top|right|bottom|left","angle":deg 1..359=90 (>180 folds to the other side, e.g. 270 for the next stair step),"depth":1 (fraction of the parent plane\'s extent across that edge)}],"focalLength":px=0,"paste":[{"plane":0,"layer":id? (else the clipboard),"at":[u,v]=[0.25,0.25] (top-left before rotating, plane coords -100..100),"width":0.01..10=0.5 (fraction of the plane width),"angle":deg -3600..3600=0 (clockwise on screen, about the paste centre, in plane metric),"flipH":bool=false,"flipV":bool=false,"wrap":bool=true (wraps across planes connected by from/edge, unfolded like a box net; false = clip to this plane only)}],"clone":[{"source":[x,y],"points":[[x,y]],"size":px=40,"hardness":0..100=50,"opacity":0..100=100,"heal":"off|luminance|on"? (else the top-level heal)}],"heal":"off|luminance|on"="off","sample":"auto|current|all"="auto" (auto: from the whole visible image where the current layer is transparent at source),"newLayer":bool=false}';

/* ── 对话框（原码无专用 UI·照 PS 消失点行为补）：左边工具（创建平面／编辑平面／图章）、中间文件缩图（点四下建平面、拖角、平面上画网格）、右边贴上与仿制设定 ── */
const VP_STR = {create:S('建立平面工具', '创建平面工具', 'Create Plane Tool'), edit:S('編輯平面工具', '编辑平面工具', 'Edit Plane Tool'), stamp:S('印章工具', '图章工具', 'Stamp Tool'),
  tear:S('從邊緣拉出垂直平面', '从边缘拉出垂直平面', 'Tear Off Perpendicular Plane'), top:S('上', '上', 'Top'), right:S('右', '右', 'Right'), bottom:S('下', '下', 'Bottom'), left:S('左', '左', 'Left'),
  angle:S('角度', '角度', 'Angle'), selAngle:S('角度（選取的平面）', '角度（选中的平面）', 'Angle (Selected Plane)'), delPlane:S('刪除選取的平面', '删除选中的平面', 'Delete Selected Plane'), paste:S('貼上', '粘贴', 'Paste'), source:S('來源圖層', '来源图层', 'Source Layer'),
  plane:S('平面', '平面', 'Plane'), atU:S('位置 U', '位置 U', 'Position U'), atV:S('位置 V', '位置 V', 'Position V'), width:S('寬度', '宽度', 'Width'), clipboard:S('剪貼簿', '剪贴板', 'Clipboard'),
  stampSec:S('印章', '图章', 'Stamp'), diameter:S('直徑', '直径', 'Diameter'), hardness:S('硬度', '硬度', 'Hardness'), opacity:S('不透明度', '不透明度', 'Opacity'), clearStamp:S('清除印章筆畫', '清除图章笔画', 'Clear Stamp Strokes'),
  focal:S('焦距（0＝自動）', '焦距（0＝自动）', 'Focal Length (0 = auto)'), newLayer:S('在新圖層上算繪', '在新图层上渲染', 'Render on a New Layer'),
  hintCreate:S('在影像上依序點四個角建立平面（順時針、從左上起）', '在图像上按顺序点四个角创建平面（顺时针、从左上开始）', 'Click four corners clockwise from top-left to create a plane'),
  hintEdit:S('按一下平面邊框＝選取；拖曳平面的角調整；拖邊緣中點＝拉伸平面；Ctrl＋拖邊緣中點＝拉出相連的新平面（再按住 Alt＝改角度）；Ctrl+Z／Ctrl+Shift+Z＝撤銷／重做', '单击平面边框＝选中；拖动平面的角调整；拖边缘中点＝拉伸平面；Ctrl＋拖边缘中点＝拉出相连的新平面（再按住 Alt＝改角度）；Ctrl+Z／Ctrl+Shift+Z＝撤销／重做',
    'Click a plane edge to select it; drag a corner to adjust; drag an edge midpoint to stretch the plane; Ctrl-drag an edge midpoint to tear off a connected plane (add Alt to change its angle); Ctrl+Z / Ctrl+Shift+Z undo / redo'),
  wrap:S('貼上物沿相連平面折過去', '粘贴物沿相连平面折过去', 'Wrap Across Connected Planes'), hintStamp:S('Alt＋按一下設定來源點，再在平面上拖曳', 'Alt＋单击设置源点，再在平面上拖动', 'Alt-click to set the source, then drag on a plane'),
  none:S('（無）', '（无）', '(None)'), strokes:S('筆畫', '笔画', 'strokes'),
  heal:S('修復', '修复', 'Heal'), healOff:S('關', '关', 'Off'), healLum:S('明度', '明度', 'Luminance'), healOn:S('開', '开', 'On'),
  sample:S('取樣', '取样', 'Sample'), sAuto:S('自動（目前圖層透明處取整個影像）', '自动（当前图层透明处取整个图像）', 'Auto (whole image where the layer is empty)'),
  sCur:S('目前圖層', '当前图层', 'Current Layer'), sAll:S('整個影像', '整个图像', 'All Layers'),
  marquee:S('選取畫面工具', '选框工具', 'Marquee Tool'), transform:S('變形工具', '变换工具', 'Transform Tool'), pAngle:S('旋轉', '旋转', 'Rotate'),
  flipH:S('水平翻轉', '水平翻转', 'Flip Horizontal'), flipV:S('垂直翻轉', '垂直翻转', 'Flip Vertical'), clipEmpty:S('剪貼簿是空的', '剪贴板是空的', 'The clipboard is empty'),
  needPaste:S('先貼上（Ctrl+V）或選來源圖層', '先粘贴（Ctrl+V）或选来源图层', 'Paste (Ctrl+V) or pick a source layer first'),
  hintMarquee:S('在貼上物上拖曳＝沿平面移動（相連的平面會折過去、可拖進別的平面）；Ctrl+V 貼上剪貼簿、Ctrl+T 變形；Ctrl＋拖邊緣中點＝拉出新平面', '在粘贴物上拖动＝沿平面移动（相连的平面会折过去、可拖进别的平面）；Ctrl+V 粘贴剪贴板、Ctrl+T 变换；Ctrl＋拖边缘中点＝拉出新平面',
    'Drag the paste to move it along the plane (it wraps across connected planes, or drag it into another plane); Ctrl+V pastes, Ctrl+T transforms; Ctrl-drag an edge midpoint to tear off a plane'),
  hintTransform:S('拖四角等比縮放、框外拖曳旋轉、框內拖曳移動；Enter 確認、Esc 取消', '拖四角等比缩放、框外拖动旋转、框内拖动移动；Enter 确认、Esc 取消', 'Drag a corner to scale, outside to rotate, inside to move; Enter commits, Esc cancels')};
function vp_dialog(init){
  const W = Doc.width, H = Doc.height, sc0 = Math.min(1, 620 / W, 420 / H), cw = Math.max(1, Math.round(W * sc0)), ch = Math.max(1, Math.round(H * sc0));
  const v = {planes:Array.isArray(init.planes) ? JSON.parse(JSON.stringify(init.planes)) : [], focalLength:typeof init.focalLength === 'number' ? init.focalLength : 0,
    pasteLayer:'', pastePlane:0, pasteU:0.25, pasteV:0.25, pasteWidth:0.5, pasteAngle:0, pasteFlipH:false, pasteFlipV:false, pasteWrap:true, clone:Array.isArray(init.clone) ? JSON.parse(JSON.stringify(init.clone)) : [],
    size:40, hardness:50, opacity:100, heal:typeof init.heal === 'string' ? init.heal : 'off', sample:typeof init.sample === 'string' ? init.sample : 'auto', newLayer:init.newLayer === true, tearAngle:90};
  if (Array.isArray(init.paste) && init.paste[0]){
    const q = init.paste[0]; v.pasteLayer = (q.layer !== undefined && q.layer !== null && q.layer !== '') ? q.layer : '__clip'; v.pastePlane = q.plane || 0;
    if (q.at){ v.pasteU = q.at[0]; v.pasteV = q.at[1]; } if (typeof q.width === 'number') v.pasteWidth = q.width;
    if (typeof q.angle === 'number') v.pasteAngle = vp_normAngle(q.angle); v.pasteFlipH = q.flipH === true; v.pasteFlipV = q.flipV === true; v.pasteWrap = q.wrap !== false;
  }
  /* tool：create／edit（平面）、marquee（选框＝拖贴上物）、transform（Ctrl+T）、stamp；pd＝拖贴上物中；xf＝变换前的值（Esc 还原） */
  const st = {tool:v.planes.length ? (v.pasteLayer !== '' ? 'marquee' : 'edit') : 'create', pending:[], drag:null, source:null, stroke:null, pd:null, xf:null, focusCv:false,
    undo:[], redo:[], base:null, mv:null, sel:Math.max(v.planes.length - 1, 0)};   // undo／redo＝对话框内逐步撤销（PS 消失点）；sel＝选中的平面（删除平面删它）
  const thumb = composite(sc0 < 1 ? sc0 : 1);
  const params = () => {
    const out = {planes:JSON.parse(JSON.stringify(v.planes)), newLayer:!!v.newLayer};
    if (v.focalLength > 0) out.focalLength = v.focalLength;
    if (v.pasteLayer !== ''){
      const q = {plane:v.pastePlane | 0, at:[v.pasteU, v.pasteV], width:v.pasteWidth};
      if (v.pasteLayer !== '__clip') q.layer = v.pasteLayer;             // 没带 layer＝剪贴簿
      if (v.pasteAngle) q.angle = v.pasteAngle; if (v.pasteFlipH) q.flipH = true; if (v.pasteFlipV) q.flipV = true; if (!v.pasteWrap) q.wrap = false;
      out.paste = [q];
    }
    if (v.clone.length) out.clone = JSON.parse(JSON.stringify(v.clone));
    if (v.sample !== 'auto') out.sample = v.sample;
    return out;
  };
  const sceneObj = () => { try { return v.planes.length ? vp_scene({planes:v.planes, focalLength:v.focalLength}, R(0, 0, W, H)) : null; } catch (_){ return null; } };
  const scenePlanes = () => { const s = sceneObj(); return s ? s.planes : v.planes.filter(q => q.corners).map(q => ({corners:q.corners})); };
  /* 贴上物的来源范围（按来源＋剪贴簿版次快取；来源是正在预览的目前层 ⇒ 用预览前的快照） */
  let srcKey = null, srcRect = null;
  const pasteRect = () => {
    if (v.pasteLayer === '') return null;
    const key = v.pasteLayer + '|' + (window.DlClipboard ? DlClipboard.serial : 0);
    if (key !== srcKey){
      srcKey = key; srcRect = null;
      try {
        const pv = Dlg.cur && Dlg.cur.prev;
        srcRect = (v.pasteLayer !== '__clip' && pv && String(pv.L.id) === String(v.pasteLayer)) ? pv.snap.contentBounds() : vp_pasteSrc(v.pasteLayer === '__clip' ? undefined : v.pasteLayer, 0)[1];
        if (rEmpty(srcRect)) srcRect = null;
      } catch (_){ srcRect = null; }
    }
    return srcRect;
  };
  /* 贴上物几何：pl＝四角平面座标、met＝四角公制（u·lu, v·lv）、quad＝四角文件座标（平面单应投到画面）、center＝中心公制 */
  const geo = () => {
    const rect = pasteRect(); if (!rect) return null;
    const sc = sceneObj(); if (!sc || v.pastePlane >= sc.planes.length) return null;
    const fr = vp_frame(sc, v.pastePlane); if (!fr) return null;
    const [h, lu, lv] = fr, sw = RW(rect), sh = RH(rect);
    const M = vp_pasteMat(lu, lv, rect, [v.pasteU, v.pasteV], v.pasteWidth, v.pasteAngle, v.pasteFlipH, v.pasteFlipV);
    const pl = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]].map(q => M.apply(q[0], q[1]));
    /* net＝顺着相连平面折过去时的展开图（只有起始平面一面＝null，行为同旧版）；quad 的角落在哪个相连平面就用那面投影 */
    const nt = v.pasteWrap ? vp_net(sc, v.pastePlane) : [], net = nt.length > 1 ? nt : null, in01 = (u, w) => u >= -1e-6 && u <= 1 + 1e-6 && w >= -1e-6 && w <= 1 + 1e-6;
    const metToImg = m => { if (net) for (const n of net){ const q = n.Ti.apply(m[0], m[1]), u = q[0] / n.lu, w = q[1] / n.lv; if (in01(u, w)) return n.h.apply(u, w); } return h.apply(m[0] / lu, m[1] / lv); };
    const met = pl.map(q => [q[0] * lu, q[1] * lv]);
    return {sc, h, inv:h.inverse(), lu, lv, sw, sh, pl, met, quad:met.map(metToImg), net, M,
      center:[v.pasteU * lu + v.pasteWidth * lu / 2, v.pasteV * lv + v.pasteWidth * lu * sh / sw / 2]};
  };
  st.geo = geo;
  /* 画面点 → 起始平面公制；折过去时：点落在哪个相连平面（起始平面优先）就经那面的展开变换回起始平面公制 */
  const toMetric = (g, p) => {
    if (g.net) for (const n of g.net){ const [u, w] = n.hi.apply(p[0], p[1]); if (u >= 0 && u <= 1 && w >= 0 && w <= 1){ const m = n.T.apply(u * n.lu, w * n.lv); if (m.every(isFinite)) return m; } }
    if (!g.inv) return null; const q = g.inv.apply(p[0], p[1]), m = [q[0] * g.lu, q[1] * g.lv]; return m.every(isFinite) ? m : null;
  };
  /* 贴上物在各相连平面上被裁后的轮廓（平面 (u,v) 里跟单位方格做 Sutherland–Hodgman 裁切再投到画面） */
  const wrapOutlines = g => g.net.map(n => {
    const P = vp_netMat(n, g.lu, g.lv, g.M), rect = pasteRect();
    let poly = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]].map(q => P.apply(q[0], q[1]));
    [[0, 0, 1], [0, 1, -1], [1, 0, 1], [1, 1, -1]].forEach(([ax, c, s]) => {           // 轴 ax 上 s·(x−c) ≥ 0
      const inn = q => s * (q[ax] - c) >= 0, out = [];
      poly.forEach((a, k) => { const b = poly[(k + 1) % poly.length], ia = inn(a), ib = inn(b);
        if (ia) out.push(a);
        if (ia !== ib){ const t = (c - a[ax]) / (b[ax] - a[ax]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } });
      poly = out;
    });
    return poly.length >= 3 ? poly.map(q => n.h.apply(q[0], q[1])) : null;
  }).filter(x => x);
  /* 平面边中点（编辑平面：拉伸；Ctrl＝撕出新平面）。撕出平面跟母平面共享的那条边不给（跟母平面的中点重叠） */
  const midHandles = () => {
    const sc = sceneObj(); if (!sc) return [];
    const out = [];
    sc.planes.forEach((pl, i) => { const h = vp_homography(pl); if (!h) return;
      [['top', 0.5, 0], ['right', 1, 0.5], ['bottom', 0.5, 1], ['left', 0, 0.5]].forEach(([edge, u, w]) => { if (pl.from !== undefined && VP_OPP[pl.edge] === edge) return; const q = h.apply(u, w); if (q.every(isFinite)) out.push({i, edge, pt:q}); }); });
    return out;
  };
  st.mids = midHandles;
  const hitMid = p => { let best = null; midHandles().forEach(m => { const d = Math.hypot((m.pt[0] - p[0]) * sc0, (m.pt[1] - p[1]) * sc0); if (d < 8 && (!best || d < best.d)) best = Object.assign({d}, m); }); return best; };
  const parentScene = idx => { try { return vp_scene({planes:v.planes.slice(0, idx), focalLength:v.focalLength}, R(0, 0, W, H)); } catch (_){ return null; } };
  const sceneOk = () => { try { vp_scene({planes:v.planes, focalLength:v.focalLength}, R(0, 0, W, H)); return true; } catch (_){ return false; } };
  /* 按下边中点：tear＝Ctrl 撕出（先放一个很浅的子平面、拖曳时改 angle／depth）；否则拉伸（四角平面＝那条边两角一起移；撕出平面的远边＝改 depth） */
  const startEdge = (hd, tear, p) => {
    const snap = JSON.parse(JSON.stringify(v.planes)), pl = v.planes[hd.i];
    begin();
    if (tear){ v.planes.push({from:hd.i, edge:hd.edge, angle:90, depth:0.05}); st.ed = {mode:'tear', idx:v.planes.length - 1, from:hd.i, edge:hd.edge, p0:p, mid:hd.pt, moved:false, snap}; }
    else if (pl && pl.corners){ const ks = VP_EDGE[hd.edge].slice(0, 2); st.ed = {mode:'move', idx:hd.i, ks, c0:ks.map(k => pl.corners[k].slice()), p0:p, snap}; }
    else if (pl && pl.from !== undefined && (pl.edge || 'top') === hd.edge){
      const sp = parentScene(hd.i); if (!sp) return false;
      st.ed = {mode:'depth', idx:hd.i, from:pl.from, edge:hd.edge, p0:p, mid:hd.pt, moved:false, snap, phi:vp_tearPhi(sp, pl.from, hd.edge, typeof pl.angle === 'number' ? pl.angle : 90)};
    } else return false;
    if (!tear) st.sel = hd.i;
    return true;
  };
  const moveEdge = (p, alt) => {
    const ed = st.ed, dx = p[0] - ed.p0[0], dy = p[1] - ed.p0[1];
    if (ed.mode === 'move'){ ed.ks.forEach((k, j) => { v.planes[ed.idx].corners[k] = [ed.c0[j][0] + dx, ed.c0[j][1] + dy]; }); return; }
    if (!ed.moved && Math.hypot(dx, dy) * sc0 < 3) return;
    ed.moved = true;
    const sp = parentScene(ed.idx); if (!sp) return;
    const q = [ed.mid[0] + dx, ed.mid[1] + dy], pl = v.planes[ed.idx], was = {angle:pl.angle, depth:pl.depth};
    const sol = ed.mode === 'tear' ? vp_tearSolve(sp, ed.from, ed.edge, q, !!alt) : vp_tearSolve(sp, ed.from, ed.edge, q, false, ed.phi);
    if (!sol) return;
    if (ed.mode === 'tear') pl.angle = sol.angle; pl.depth = sol.depth;
    if (!sceneOk()){ pl.angle = was.angle; pl.depth = was.depth; }       // 会跑到相机后面 ⇒ 留在上一个能用的位置
  };
  const endEdge = () => {
    const ed = st.ed; st.ed = null;
    if (ed.mode === 'tear'){ if (!ed.moved) v.planes.pop(); else st.sel = ed.idx; }   // 撕出的新平面＝选中
    commit(); Dlg.changed(true);
  };
  const r4 = x => Math.round(x * 1e4) / 1e4;
  /* 对话框内逐步撤销（PS 消失点：Ctrl+Z 撤销、Ctrl+Shift+Z／Ctrl+Alt+Z 重做）：每一步（建平面的每个角、拖角、移平面、撕／拉伸、改折角、贴上、
     移动／变换贴上物、图章一笔、删平面、右栏每次放开滑杆或数字栏确定）结束时跟「上一步结束时的快照」base 比，有变才把 base 进堆；
     begin＝动手前先把还没记的改动（例如打了数字没按 Enter）记成自己那一步。选中哪个平面跟着快照还原但单独换选不算一步 */
  const UNDO_KEYS = ['planes', 'pastePlane', 'pasteLayer', 'pasteU', 'pasteV', 'pasteWidth', 'pasteAngle', 'pasteFlipH', 'pasteFlipV', 'pasteWrap', 'clone',
    'focalLength', 'tearAngle', 'size', 'hardness', 'opacity', 'heal', 'sample', 'newLayer'];
  const vStr = () => JSON.stringify(UNDO_KEYS.map(k => v[k]).concat([st.pending]));
  const snapE = () => ({s:vStr(), sel:st.sel});
  const commit = () => { const s = vStr(); if (st.base && s !== st.base.s){ st.undo.push(st.base); st.redo = []; } st.base = {s, sel:st.sel}; };
  const begin = commit;
  const step = fn => { begin(); fn(); commit(); };
  const restore = e => {
    const a = JSON.parse(e.s); UNDO_KEYS.forEach((k, i) => { v[k] = a[i]; }); st.pending = a[UNDO_KEYS.length] || [];
    st.sel = e.sel; st.drag = st.pd = st.stroke = st.ed = st.mv = null; srcKey = null; st.base = e;
    if (st.pending.length) st.tool = 'create'; else if (st.tool === 'create' && v.planes.length) st.tool = 'edit';
    if (v.pastePlane >= v.planes.length) v.pastePlane = 0;
    Dlg.changed(true);
  };
  const undoStep = redo => {
    if (st.ed || st.pd || st.drag || st.stroke || st.mv) return false;   // 拖到一半不撤
    commit();
    const from = redo ? st.redo : st.undo, to = redo ? st.undo : st.redo; if (!from.length) return false;
    to.push(st.base); restore(from.pop()); return true;
  };
  st.base = snapE();
  st.undoStep = undoStep;
  /* 删除选中的平面，连带删从它撕出的子平面（含孙）；后面平面的 from、贴上物的 plane 重新编号 */
  const delPlane = () => {
    if (!v.planes.length) return;
    const i0 = st.sel >= 0 && st.sel < v.planes.length ? st.sel : v.planes.length - 1, gone = new Set([i0]);
    v.planes.forEach((pl, j) => { if (typeof pl.from === 'number' && gone.has(pl.from)) gone.add(j); });   // 子平面一定排在母平面后面 ⇒ 一趟就连孙带子
    const map = []; let n = 0; v.planes.forEach((_, j) => { map[j] = gone.has(j) ? -1 : n++; });
    v.planes = v.planes.filter((_, j) => !gone.has(j)).map(pl => typeof pl.from === 'number' ? Object.assign({}, pl, {from:map[pl.from]}) : pl);
    v.pastePlane = map[v.pastePlane] >= 0 ? map[v.pastePlane] : 0;
    st.sel = v.planes.length ? Math.min(Math.max(i0 - 1, 0), v.planes.length - 1) : 0;
  };
  /* 编辑平面工具点平面：先看边框（6px 内、最近的），再看落在哪个平面里（后建的优先） */
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0; return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
  const hitPlane = p => {
    const pls = scenePlanes(); let best = null;
    pls.forEach((pl, i) => pl.corners.forEach((a, k) => { const d = segD(p, a, pl.corners[(k + 1) % 4]) * sc0; if (d < 6 && (!best || d < best[1])) best = [i, d]; }));
    return best ? best[0] : vp_planeAt({planes:pls}, p);
  };
  const setCenter = (g, c) => { v.pasteU = r4(c[0] / g.lu - v.pasteWidth / 2); v.pasteV = r4((c[1] - v.pasteWidth * g.lu * g.sh / g.sw / 2) / g.lv); };
  /* 画面上一像素在平面 i 的点 p 处约等于多少公制单位（拖进别的平面时保持贴上物在画面上的大小） */
  const mScale = (sc, i, p) => {
    const fr = vp_frame(sc, i), inv = fr && fr[0].inverse(); if (!inv) return null;
    const m = q => { const r = inv.apply(q[0], q[1]); return [r[0] * fr[1], r[1] * fr[2]]; }, a = m(p), b = m([p[0] + 1, p[1]]), c = m([p[0], p[1] + 1]);
    const d = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return isFinite(d) && d > 0 ? Math.sqrt(d) : null;
  };
  const inQuad = (q, p) => { let s = 0; for (let k = 0; k < 4; k++){ const a = q[k], b = q[(k + 1) % 4], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (c !== 0){ if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } } return true; };
  /* 拖曳／变换时把右栏滑杆、平面选单跟着改（不重建，免得打断拖曳） */
  const syncCtl = () => {
    const box = Dlg.cur && Dlg.cur.box; if (!box) return;
    [['pasteU', v.pasteU, 0.01], ['pasteV', v.pasteV, 0.01], ['pasteWidth', v.pasteWidth, 0.01], ['pasteAngle', v.pasteAngle, 0.1]].forEach(([k, val, step]) =>
      box.querySelectorAll('[data-k="' + k + '"]').forEach(n => { n.value = n.type === 'range' ? String(val) : fmtNum(val, step); }));
    const ps = box.querySelector('select[data-k="pastePlane"]'); if (ps) ps.value = String(v.pastePlane);
  };
  const xfKeys = ['pasteU', 'pasteV', 'pasteWidth', 'pasteAngle', 'pasteFlipH', 'pasteFlipV', 'pastePlane'];
  const startXf = () => {
    if (!geo()){ toast(tr(VP_STR.needPaste)); return; }
    if (!st.xf){ commit(); st.xf = Object.fromEntries(xfKeys.map(k => [k, v[k]])); st.xfMark = st.undo.length; }
    st.tool = 'transform'; st.focusCv = true; Dlg.render();
  };
  const endXf = keep => {                                             // Enter＝确认、Esc＝还原变换前
    if (!keep && st.xf){ xfKeys.forEach(k => { v[k] = st.xf[k]; }); st.undo.length = Math.min(st.undo.length, st.xfMark); st.redo = []; st.base = snapE(); }   // 取消变形＝变形里的各步一起丢
    st.xf = null; st.pd = null; st.tool = 'marquee'; st.focusCv = true; Dlg.changed(true);
  };
  /* 对话框里 Ctrl+V：把共用剪贴簿贴进来（＝pasteLayer:'__clip'），放在第一个平面中间、换选框工具 */
  const pasteClip = () => {
    const cp = window.DlClipboard && DlClipboard.asPixels ? DlClipboard.asPixels() : null;
    if (!cp){ toast(tr(VP_STR.clipEmpty)); return; }
    begin();
    v.pasteLayer = '__clip'; srcKey = null; v.pastePlane = 0; v.pasteAngle = 0; v.pasteFlipH = v.pasteFlipV = false; st.xf = null; st.pd = null;
    st.tool = 'marquee'; st.focusCv = true;
    const g = geo(); if (g) setCenter(g, [g.lu / 2, g.lv / 2]);
    commit(); Dlg.changed(true);
  };
  const onKey = e => {
    if (st.ed && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); v.planes = st.ed.snap; st.ed = null; Dlg.changed(true); return; }   // 拉伸／撕出拖到一半按 Esc ⇒ 还原这一步
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ'){                // 对话框内撤销／重做（拦住，外面画板的历史不动）；右栏打字的输入框留给它自己
      const t = e.target, typing = t && t !== keys && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|number|search)$/.test(t.type)));
      if (!typing){ e.preventDefault(); e.stopPropagation(); undoStep(e.shiftKey || e.altKey); return; }
    }
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (mod && e.code === 'KeyT'){ e.preventDefault(); e.stopPropagation(); startXf(); return; }
    if (mod && e.code === 'KeyV' && !(e.target && e.target !== keys && (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')))){ e.preventDefault(); e.stopPropagation(); pasteClip(); return; }
    if (st.tool === 'transform' && (e.key === 'Enter' || e.key === 'Escape')){ e.preventDefault(); e.stopPropagation(); endXf(e.key === 'Enter'); }
  };
  let cv = null, keys = null;
  const selAngle = () => { const pl = v.planes[st.sel]; return pl && typeof pl.from === 'number' && typeof pl.angle === 'number' ? pl.angle : 90; };
  const syncSel = () => {                                             // 右栏「角度」跟着选中的平面（四角平面没有折角 ⇒ 灰掉）
    const n = Dlg.cur && Dlg.cur.box.querySelector('input[data-k="planeAngle"]'); if (!n) return;
    const pl = v.planes[st.sel]; n.disabled = !(pl && typeof pl.from === 'number'); if (document.activeElement !== n) n.value = fmtNum(selAngle(), 0.1);
  };
  const draw = () => {
    if (!cv) return; const x = cv.getContext('2d');
    x.clearRect(0, 0, cw, ch); x.drawImage(thumb, 0, 0, cw, ch);
    const D = p => [p[0] * sc0, p[1] * sc0];
    scenePlanes().forEach((pl, i) => {
      const h = vp_homography(pl); x.strokeStyle = i === v.pastePlane ? '#4aa3ff' : '#9fd36a'; x.lineWidth = 1;
      if (h) for (let k = 0; k <= 8; k++){ const t = k / 8; [[[t, 0], [t, 1]], [[0, t], [1, t]]].forEach(([a, b]) => { const pa = D(h.apply(a[0], a[1])), pb = D(h.apply(b[0], b[1])); x.beginPath(); x.moveTo(pa[0], pa[1]); x.lineTo(pb[0], pb[1]); x.stroke(); }); }
      x.lineWidth = 2; x.beginPath(); pl.corners.forEach((c, k) => { const d = D(c); k ? x.lineTo(d[0], d[1]) : x.moveTo(d[0], d[1]); }); x.closePath(); x.stroke();
      if (i === st.sel && st.tool === 'edit'){ x.lineWidth = 3; x.strokeStyle = '#ffd400'; x.stroke(); }   // 选中的平面（删除平面删它）
      if (v.planes[i] && v.planes[i].corners) pl.corners.forEach(c => { const d = D(c); x.fillStyle = '#fff'; x.fillRect(d[0] - 3, d[1] - 3, 6, 6); });
    });
    if (st.tool === 'edit' || st.tool === 'marquee'){ x.lineWidth = 1; x.strokeStyle = '#222'; x.fillStyle = '#e8f4ff'; midHandles().forEach(m => { const d = D(m.pt); x.fillRect(d[0] - 2.5, d[1] - 2.5, 5, 5); x.strokeRect(d[0] - 2.5, d[1] - 2.5, 5, 5); }); }   // 边中点
    x.fillStyle = '#ffcc33'; st.pending.forEach(c => { const d = D(c); x.fillRect(d[0] - 3, d[1] - 3, 6, 6); });
    if (st.source){ const d = D(st.source); x.strokeStyle = '#ff4d4d'; x.beginPath(); x.arc(d[0], d[1], 6, 0, TAU); x.moveTo(d[0] - 9, d[1]); x.lineTo(d[0] + 9, d[1]); x.moveTo(d[0], d[1] - 9); x.lineTo(d[0], d[1] + 9); x.stroke(); }
    x.strokeStyle = 'rgba(255,77,77,.8)'; v.clone.forEach(c => { x.beginPath(); (c.points || []).forEach((q, k) => { const d = D(q); k ? x.lineTo(d[0], d[1]) : x.moveTo(d[0], d[1]); }); x.stroke(); });
    const g = geo();                                                    // 贴上物的透视外框（变换时四角控点）
    if (g && g.quad.every(q => q.every(isFinite))){
      const qd = g.quad.map(D), xf = st.tool === 'transform';
      x.lineWidth = xf ? 1.5 : 1; x.strokeStyle = '#ff9f1a'; x.setLineDash(xf ? [] : [4, 3]);
      const polys = g.net ? wrapOutlines(g).map(q => q.map(D)) : [qd];   // 折过去：每个相连平面上各画被裁后的那段
      polys.forEach(pp => { x.beginPath(); pp.forEach((d, k) => k ? x.lineTo(d[0], d[1]) : x.moveTo(d[0], d[1])); x.closePath(); x.stroke(); }); x.setLineDash([]);
      if (xf){ x.strokeStyle = '#000'; x.fillStyle = '#fff'; qd.forEach(d => { x.fillRect(d[0] - 4, d[1] - 4, 8, 8); x.strokeRect(d[0] - 4, d[1] - 4, 8, 8); }); }
    }
    syncSel();
  };
  const docPt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / sc0, (e.clientY - r.top) / sc0]; };
  return Dlg.open({id:'filter.vanishingPoint', wide:true, v, state:st, params,
    build(ui, v, st){
      const left = el('div', {style:'display:flex;flex-direction:column;gap:4px;min-width:120px'});
      [['marquee', VP_STR.marquee], ['transform', VP_STR.transform], ['create', VP_STR.create], ['edit', VP_STR.edit], ['stamp', VP_STR.stamp]].forEach(([k, n]) => {
        const b = ui.button(tr(n), () => {
          if (k === 'transform'){ startXf(); return; }
          st.xf = null; st.pd = null; st.tool = k; st.pending = []; Dlg.render();   // 换工具＝确认变换（同 PS）
        }, 'vpTool-' + k);
        if (st.tool === k) b.className = 'on'; left.appendChild(b); });
      const hint = {create:VP_STR.hintCreate, edit:VP_STR.hintEdit, stamp:VP_STR.hintStamp, marquee:VP_STR.hintMarquee, transform:VP_STR.hintTransform}[st.tool];
      left.appendChild(el('div', {className:'note'}, [tr(hint)]));
      cv = ui.canvas(cw, ch, 'vpCanvas'); cv.style.cursor = (st.tool === 'marquee' || st.tool === 'transform') ? 'move' : 'crosshair';
      /* 收键的焦点：唯读小输入框（画面按下就把焦点给它）。ps-edit.js 的 Ctrl+V／Ctrl+C 挂在 window 捕获阶段、只认它自己的对话框，
         焦点在 input 上它才放手 ⇒ Ctrl+T／Ctrl+V／Enter／Esc 才轮得到对话框（onKey 挂在框上的捕获阶段） */
      keys = el('input', {type:'text', readOnly:true, tabIndex:-1, style:'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;pointer-events:none', data:{k:'vpKeys'}});
      left.appendChild(keys);
      if (!st.keysBound && Dlg.cur){ st.keysBound = true; Dlg.cur.box.addEventListener('keydown', onKey, true); }
      cv.addEventListener('pointerdown', e => {
        const p = docPt(e); cv.setPointerCapture(e.pointerId); st.focusCv = true; keys.focus({preventScroll:true}); e.preventDefault();
        const mod = e.ctrlKey || e.metaKey;
        if (st.tool === 'marquee' && mod){ const hd = hitMid(p); if (hd && startEdge(hd, true, p)){ draw(); return; } }   // 选框工具下 Ctrl＋拖边中点也能撕
        if (st.tool === 'marquee' || st.tool === 'transform'){
          const g = geo(); if (!g) return;
          const m = toMetric(g, p); if (!m) return;
          const inside = g.net ? inQuad(g.met, m) : inQuad(g.quad, p);   // 折过去时在展开图（公制）里判
          if (st.tool === 'transform'){
            let k = -1, best = 9; g.quad.forEach((q, i) => { const d = Math.hypot((q[0] - p[0]) * sc0, (q[1] - p[1]) * sc0); if (d < best){ best = d; k = i; } });
            if (k >= 0){ const A = g.met[(k + 2) % 4]; st.pd = {mode:'scale', A, d:[g.met[k][0] - A[0], g.met[k][1] - A[1]], w0:v.pasteWidth}; begin(); return; }   // 拖角＝等比缩放（对角不动）
            if (!inside){ st.pd = {mode:'rotate', a0:v.pasteAngle, t0:Math.atan2(m[1] - g.center[1], m[0] - g.center[0])}; begin(); return; }   // 框外＝绕中心旋转
          }
          if (inside){ st.pd = {mode:'move', off:[m[0] - g.center[0], m[1] - g.center[1]]}; begin(); }
          return;
        }
        if (st.tool === 'create'){                                         // 每点一个角＝一步（Ctrl+Z 退一个角）；第四个角＝建好平面
          begin(); st.pending.push(p);
          if (st.pending.length === 4){ v.planes.push({corners:st.pending}); st.sel = v.planes.length - 1; st.pending = []; st.tool = 'edit'; commit(); Dlg.changed(true); return; }
          commit(); draw(); return;
        }
        if (st.tool === 'edit'){
          let best = null; v.planes.forEach((pl, i) => (pl.corners || []).forEach((c, k) => { const d = Math.hypot((c[0] - p[0]) * sc0, (c[1] - p[1]) * sc0); if (d < 8 && (!best || d < best[2])) best = [i, k, d]; }));
          st.drag = best;
          if (best){ st.sel = best[0]; begin(); draw(); return; }
          const hd = hitMid(p); if (hd && startEdge(hd, mod, p)){ draw(); return; }   // 边中点：拉伸／Ctrl＝撕出
          const k = hitPlane(p);                                           // 点边框（或平面里）＝选中；按着拖＝整个平面移（撕出的跟着母平面走 ⇒ 移的是这串的四角根平面）
          if (k !== null){
            let r = k; while (r > 0 && v.planes[r] && !v.planes[r].corners && typeof v.planes[r].from === 'number') r = v.planes[r].from;
            begin(); st.sel = k;
            if (v.planes[r] && v.planes[r].corners) st.mv = {r, p0:p, c0:v.planes[r].corners.map(c => c.slice()), moved:false};
            draw(); syncSel();
          }
          return;
        }
        if (e.altKey){ st.source = p; draw(); return; }
        if (!st.source) return;
        const sp = {planes:scenePlanes()}; if (vp_planeAt(sp, st.source) === null || vp_planeAt(sp, p) === null) return;   // 来源或落点在平面外 ⇒ PS 不给落笔
        begin(); st.stroke = {source:st.source.slice(), points:[p], size:v.size, hardness:v.hardness, opacity:v.opacity, heal:v.heal}; v.clone.push(st.stroke); draw();
      });
      cv.addEventListener('pointermove', e => {
        const p = docPt(e);
        if (st.ed){ moveEdge(p, e.altKey); draw(); Dlg.schedule(); return; }
        if (st.mv){ const dx = p[0] - st.mv.p0[0], dy = p[1] - st.mv.p0[1]; if (!st.mv.moved && Math.hypot(dx, dy) * sc0 < 2) return; st.mv.moved = true;
          v.planes[st.mv.r].corners = st.mv.c0.map(c => [c[0] + dx, c[1] + dy]); draw(); Dlg.schedule(); return; }
        if (st.pd){
          let g = geo(); if (!g) return;
          const pd = st.pd;
          if (pd.mode === 'move'){
            const j = vp_planeAt(g.sc, p);                              // 拖进别的（不相连的）平面 ⇒ 换平面，画面上的大小与抓点不跳；相连的＝在展开图上自然延伸
            if (j !== null && j !== v.pastePlane && !(g.net && g.net.some(n => n.i === j))){
              const s0 = mScale(g.sc, v.pastePlane, p), s1 = mScale(g.sc, j, p), f1 = vp_frame(g.sc, j);
              if (s0 && s1 && f1){ const r = s1 / s0; v.pasteWidth = r4(clamp(v.pasteWidth * g.lu * r / f1[1], 0.01, 10)); pd.off = pd.off.map(q => q * r); v.pastePlane = j; g = geo(); if (!g) return; }
            }
            const m = toMetric(g, p); if (!m) return;
            setCenter(g, [m[0] - pd.off[0], m[1] - pd.off[1]]);
          } else if (pd.mode === 'scale'){
            const m = toMetric(g, p); if (!m) return;
            const k = ((m[0] - pd.A[0]) * pd.d[0] + (m[1] - pd.A[1]) * pd.d[1]) / Math.max(pd.d[0] * pd.d[0] + pd.d[1] * pd.d[1], 1e-12);
            v.pasteWidth = r4(clamp(pd.w0 * k, 0.01, 10)); const kk = v.pasteWidth / pd.w0;
            setCenter(g, [pd.A[0] + pd.d[0] * kk / 2, pd.A[1] + pd.d[1] * kk / 2]);
          } else {
            const m = toMetric(g, p); if (!m) return;
            v.pasteAngle = Math.round(vp_normAngle(pd.a0 + (Math.atan2(m[1] - g.center[1], m[0] - g.center[0]) - pd.t0) / DEG) * 10) / 10;
          }
          syncCtl(); draw(); Dlg.schedule();
        }
        else if (st.drag){ v.planes[st.drag[0]].corners[st.drag[1]] = p; draw(); Dlg.schedule(); }
        else if (st.stroke){ const q = st.stroke.points[st.stroke.points.length - 1]; if (Math.hypot(q[0] - p[0], q[1] - p[1]) * sc0 >= 3){ st.stroke.points.push(p); draw(); } }
      });
      cv.addEventListener('pointerup', () => {
        if (st.ed){ endEdge(); return; }
        if (st.mv){ const mv = st.mv; st.mv = null; commit(); if (mv.moved) Dlg.changed(true); return; }
        if (st.pd){ st.pd = null; commit(); syncCtl(); draw(); Dlg.schedule(); return; }
        if (st.drag || st.stroke){ st.drag = null; st.stroke = null; commit(); Dlg.changed(true); }
      });
      const right = el('div', {style:'min-width:250px'});
      const wrap = el('div', {style:'display:flex;gap:12px;align-items:flex-start'}, [left, cv, right]);
      ui.add(wrap);
      const rui = makeUI(right, Dlg);
      right.addEventListener('change', () => commit());                  // 放开滑杆／数字栏确定／勾选＝各自一步
      rui.number({k:'focalLength', label:tr(VP_STR.focal), min:0, max:100000, step:1, get:() => v.focalLength, set:x => { v.focalLength = x; }});
      rui.sec(tr(VP_STR.tear));
      const tb = el('div', {className:'row'});
      ['top', 'right', 'bottom', 'left'].forEach(edge => tb.appendChild(rui.button(tr(VP_STR[edge]), () => {   // 从选中的平面撕出
        if (!v.planes.length) return;
        step(() => { const f = st.sel >= 0 && st.sel < v.planes.length ? st.sel : v.planes.length - 1; v.planes.push({from:f, edge, angle:v.tearAngle, depth:1}); st.sel = v.planes.length - 1; });
        Dlg.changed(true); }, 'vpTear-' + edge)));
      rui.add(tb);
      rui.slider({k:'tearAngle', label:tr(VP_STR.angle), min:1, max:179, step:1, unit:'°', get:() => v.tearAngle, set:x => { v.tearAngle = x; }});
      rui.add(el('div', {className:'row'}, [rui.button(tr(VP_STR.delPlane), () => { step(delPlane); Dlg.changed(true); }, 'vpDelPlane')]));   // 删选中的平面（连带从它撕出的）
      rui.number({k:'planeAngle', label:tr(VP_STR.selAngle), min:1, max:359, step:0.1, get:selAngle, set:x => {   // PS 的 Angle 栏：改选中（撕出）平面的折角
        const pl = v.planes[st.sel]; if (!pl || typeof pl.from !== 'number') return; const was = pl.angle; pl.angle = x; if (!sceneOk()) pl.angle = was; draw(); }});
      rui.sec(tr(VP_STR.paste));
      const opts = [['', tr(VP_STR.none)], ['__clip', tr(VP_STR.clipboard)]].concat([...Doc.layers].reverse().filter(q => q.kind === 'raster').map(q => [q.id, q.name]));
      rui.select({k:'pasteLayer', label:tr(VP_STR.source), options:opts, get:() => v.pasteLayer, set:x => { step(() => { v.pasteLayer = x; }); }, rebuild:true});
      rui.select({k:'pastePlane', label:tr(VP_STR.plane), options:(v.planes.length ? v.planes : [0]).map((_, i) => [i, String(i)]), get:() => v.pastePlane, set:x => { step(() => { v.pastePlane = +x; }); }, rebuild:true});
      rui.slider({k:'pasteU', label:tr(VP_STR.atU), min:-1, max:2, step:0.01, get:() => v.pasteU, set:x => { v.pasteU = x; }});
      rui.slider({k:'pasteV', label:tr(VP_STR.atV), min:-1, max:2, step:0.01, get:() => v.pasteV, set:x => { v.pasteV = x; }});
      rui.slider({k:'pasteWidth', label:tr(VP_STR.width), min:0.01, max:10, step:0.01, get:() => v.pasteWidth, set:x => { v.pasteWidth = x; }});
      rui.slider({k:'pasteAngle', label:tr(VP_STR.pAngle), min:-180, max:180, step:0.1, unit:'°', get:() => v.pasteAngle, set:x => { v.pasteAngle = x; }});
      rui.check({k:'pasteFlipH', label:tr(VP_STR.flipH), get:() => v.pasteFlipH, set:x => { step(() => { v.pasteFlipH = x; }); }});
      rui.check({k:'pasteFlipV', label:tr(VP_STR.flipV), get:() => v.pasteFlipV, set:x => { step(() => { v.pasteFlipV = x; }); }});
      rui.check({k:'pasteWrap', label:tr(VP_STR.wrap), get:() => v.pasteWrap, set:x => { step(() => { v.pasteWrap = x; }); }});
      rui.sec(tr(VP_STR.stampSec) + '（' + v.clone.length + ' ' + tr(VP_STR.strokes) + '）');
      rui.slider({k:'size', label:tr(VP_STR.diameter), min:1, max:500, step:1, unit:'px', get:() => v.size, set:x => { v.size = x; }});
      rui.slider({k:'hardness', label:tr(VP_STR.hardness), min:0, max:100, step:1, unit:'%', get:() => v.hardness, set:x => { v.hardness = x; }});
      rui.slider({k:'opacity', label:tr(VP_STR.opacity), min:0, max:100, step:1, unit:'%', get:() => v.opacity, set:x => { v.opacity = x; }});
      rui.select({k:'heal', label:tr(VP_STR.heal), options:[['off', tr(VP_STR.healOff)], ['luminance', tr(VP_STR.healLum)], ['on', tr(VP_STR.healOn)]], get:() => v.heal, set:x => { v.heal = x; }});
      rui.select({k:'sample', label:tr(VP_STR.sample), options:[['auto', tr(VP_STR.sAuto)], ['current', tr(VP_STR.sCur)], ['all', tr(VP_STR.sAll)]], get:() => v.sample, set:x => { v.sample = x; }});
      rui.add(el('div', {className:'row'}, [rui.button(tr(VP_STR.clearStamp), () => { step(() => { v.clone = []; }); Dlg.changed(true); }, 'vpClearStamp')]));
      rui.check({k:'newLayer', label:tr(VP_STR.newLayer), get:() => v.newLayer, set:x => { v.newLayer = x; }});
      draw();
      if (st.focusCv) keys.focus({preventScroll:true});               // 重建后焦点留在画面（键盘仍归对话框）
    },
    onPreview(L, prm){ if (prm.planes && prm.planes.length) SURF_OPS['filter.vanishingPoint'](L, prm, {preview:true}); }
  });
}
CUSTOM_DIALOGS['filter.vanishingPoint'] = vp_dialog;

/* ──────────────── 段：50-params.js ──────────────── */
/* ═══════════ 参数（engine/src/filters.rs:41-129 params_for、filters_ext.rs:70-370 params_for；Photoshop 对话框单位） ═══════════
   回 fp＝{filter:<FilterParams 变体名 camelCase>, …栏位（Rust 栏位名转 camelCase）}；不认得的 id 回 null。 */
const pf = (p, k, d) => { const v = p ? p[k] : undefined; return typeof v === 'number' && isFinite(v) ? v : d; };            // f()
const pi = (p, k, d) => { const v = p ? p[k] : undefined; return typeof v === 'number' && isFinite(v) ? rround(v) : d; };   // i()（浮点四舍五入）
const pb = (p, k, d) => { const v = p ? p[k] : undefined; return typeof v === 'boolean' ? v : d; };
const ps = (p, k, d) => { const v = p ? p[k] : undefined; return typeof v === 'string' ? v : d; };
const pseed = p => (pi(p, 'seed', 0) >>> 0);
/* filters_ext.rs:39 colour：[r,g,b(,a)]（0..1）或 #rrggbb */
function pcolour(p, k, d){
  const v = p ? p[k] : undefined;
  if (Array.isArray(v) && v.length >= 3){ const c = (j, dv) => typeof v[j] === 'number' ? v[j] : dv; return [c(0, 0), c(1, 0), c(2, 0), c(3, 1)]; }
  if (typeof v === 'string' && v.length === 7 && v[0] === '#'){ const ch = j => { const n = parseInt(v.slice(j, j + 2), 16); return isFinite(n) ? n / 255 : 0; }; return [ch(1), ch(3), ch(5), 1]; }
  return d;
}
const BLACK = [0, 0, 0, 1], WHITE = [1, 1, 1, 1];
const undefinedOf = (p, d) => { const s = ps(p, 'undefinedAreas', d); return s === 'repeat' ? 'repeat' : s === 'transparent' ? 'transparent' : 'wrap'; };
/* filters_ext.rs:60 list：阵列参数，坏的项跳过；空＝null */
function plist(p, k, mk){ const a = p ? p[k] : undefined; if (!Array.isArray(a)) return null; const v = a.map(mk).filter(x => x); return v.length ? v : null; }
const obj = e => e && typeof e === 'object' && !Array.isArray(e) ? e : null;
/* serde default 的结构（params_ext.rs Light／IrisPin／FieldPin／SpinPin／BlurPath） */
const LIGHT0 = {kind:'spot', x:0.25, y:0.2, z:0.6, targetX:0.5, targetY:0.55, angle:135, elevation:45, color:[1, 1, 1], intensity:75, cone:45, hotspot:50, radius:0.8};
const IRIS0 = {x:0.5, y:0.5, radiusX:0.35, radiusY:0.25, angle:0, roundness:0, feather:0.5, blur:15};
const FIELD0 = {x:0.5, y:0.5, blur:15};
const SPIN0 = {x:0.5, y:0.5, radiusX:0.3, radiusY:0.3, angle:0, blurAngle:15};
const PATH0 = {points:[[0.2, 0.5], [0.8, 0.5]], speed:50, taper:0};
/* 路径模糊终点速度的预设（PS 2092×2791 的图预设 82 像素 ≈ 短边 4%） */
const pbEndSpeed0 = () => Math.max(1, Math.round(Math.min(typeof Doc !== 'undefined' && Doc.width || 1000, typeof Doc !== 'undefined' && Doc.height || 1000) * 0.04));
function structOf(e, D){                                          // serde：缺的栏位用预设，型别不对＝整项丢掉
  e = obj(e); if (!e) return null;
  const o = {};
  for (const k of Object.keys(D)){
    const v = e[k], d = D[k];
    if (v === undefined || v === null){ o[k] = Array.isArray(d) ? JSON.parse(JSON.stringify(d)) : d; continue; }
    if (typeof d === 'number'){ if (typeof v !== 'number') return null; o[k] = v; }
    else if (typeof d === 'string'){ if (typeof v !== 'string') return null; o[k] = v; }
    else if (Array.isArray(d)){ if (!Array.isArray(v)) return null; o[k] = v; }
  }
  return o;
}
const pt2 = v => Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;

function paramsFor(id, p){
  p = p || {};
  const f = (k, d) => pf(p, k, d), s = (k, d) => ps(p, k, d);
  const blur = d => clamp(f('blur', d), 0, 500);
  switch (id){
    /* ── filters.rs ── */
    case 'filter.blur.gaussianBlur': return {filter:'gaussianBlur', radius:clamp(f('radius', 1), 0.1, 1000)};
    case 'filter.blur.blur': return {filter:'gaussianBlur', radius:0.6};                 // 一步预设（无对话框）
    case 'filter.blur.blurMore': return {filter:'gaussianBlur', radius:1.4};
    case 'filter.sharpen.sharpen': return {filter:'unsharpMask', amount:60, radius:0.5, threshold:0};
    case 'filter.sharpen.sharpenMore': return {filter:'unsharpMask', amount:150, radius:0.6, threshold:0};
    case 'filter.sharpen.sharpenEdges': return {filter:'unsharpMask', amount:100, radius:0.8, threshold:6};
    case 'filter.noise.despeckle': return {filter:'surfaceBlur', radius:2, threshold:12};
    case 'filter.blur.boxBlur': return {filter:'boxBlur', radius:clamp(f('radius', 1), 1, 2000)};
    case 'filter.blur.motionBlur': return {filter:'motionBlur', angle:f('angle', 0), distance:clamp(f('distance', 10), 1, 2000)};
    case 'filter.blur.radialBlur': return {filter:'radialBlur', amount:clamp(f('amount', 10), 1, 100), method:s('method', 'spin') === 'zoom' ? 'zoom' : 'spin', centerX:f('centerX', 0.5), centerY:f('centerY', 0.5)};
    case 'filter.blur.surfaceBlur': return {filter:'surfaceBlur', radius:clamp(f('radius', 5), 1, 100), threshold:clamp(f('threshold', 15), 2, 255)};
    case 'filter.sharpen.unsharpMask': return {filter:'unsharpMask', amount:clamp(f('amount', 50), 1, 500), radius:clamp(f('radius', 1), 0.1, 1000), threshold:clamp(f('threshold', 0), 0, 255)};
    case 'filter.sharpen.smartSharpen': return {filter:'smartSharpen', amount:clamp(f('amount', 100), 1, 500), radius:clamp(f('radius', 1), 0.1, 64), reduceNoise:clamp(f('reduceNoise', 10), 0, 100)};
    case 'filter.other.highPass': return {filter:'highPass', radius:clamp(f('radius', 10), 0.1, 1000)};
    case 'filter.noise.addNoise': return {filter:'addNoise', amount:clamp(f('amount', 12.5), 0.1, 400), distribution:s('distribution', 'uniform') === 'gaussian' ? 'gaussian' : 'uniform', monochromatic:pb(p, 'monochromatic', false), seed:pseed(p)};
    case 'filter.noise.median': return {filter:'median', radius:clamp(f('radius', 1), 1, 500)};
    case 'filter.noise.dustAndScratches': return {filter:'dustAndScratches', radius:clamp(f('radius', 1), 1, 500), threshold:clamp(f('threshold', 0), 0, 255)};
    case 'filter.other.minimum': return {filter:'minimum', radius:clamp(f('radius', 1), 0.2, 500), preserve:s('preserve', 'squareness') === 'roundness' ? 'roundness' : 'squareness'};
    case 'filter.other.maximum': return {filter:'maximum', radius:clamp(f('radius', 1), 0.2, 500), preserve:s('preserve', 'squareness') === 'roundness' ? 'roundness' : 'squareness'};
    case 'filter.other.offset': return {filter:'offset', horizontal:pi(p, 'horizontal', 0), vertical:pi(p, 'vertical', 0), undefinedAreas:undefinedOf(p, 'wrap')};
    case 'filter.pixelate.mosaic': return {filter:'mosaic', cellSize:clamp(f('cellSize', 10), 2, 200)};
    case 'filter.stylize.emboss': return {filter:'emboss', angle:f('angle', 135), height:clamp(f('height', 3), 1, 100), amount:clamp(f('amount', 100), 1, 500)};
    case 'filter.stylize.findEdges': return {filter:'findEdges'};
    case 'filter.stylize.solarize': return {filter:'solarize'};
    case 'filter.distort.twirl': return {filter:'twirl', angle:clamp(f('angle', 50), -999, 999)};
    case 'filter.distort.pinch': return {filter:'pinch', amount:clamp(f('amount', 50), -100, 100)};
    case 'filter.distort.spherize': { const m = s('mode', 'normal'); return {filter:'spherize', amount:clamp(f('amount', 100), -100, 100), mode:m === 'horizontalOnly' || m === 'verticalOnly' ? m : 'normal'}; }
    case 'filter.distort.wave': { const t = s('type', 'sine');
      return {filter:'wave', generators:clamp(pi(p, 'generators', 5), 1, 999), wavelengthMin:clamp(f('wavelengthMin', 10), 1, 998), wavelengthMax:clamp(f('wavelengthMax', 120), 2, 999),
        amplitudeMin:clamp(f('amplitudeMin', 5), 1, 998), amplitudeMax:clamp(f('amplitudeMax', 35), 1, 999), waveType:t === 'triangle' || t === 'square' ? t : 'sine', undefinedAreas:undefinedOf(p, 'wrap'), seed:pseed(p)}; }
    case 'filter.distort.ripple': { const z = s('size', 'medium'); return {filter:'ripple', amount:clamp(f('amount', 100), -999, 999), size:z === 'small' || z === 'large' ? z : 'medium'}; }
    case 'filter.distort.polarCoordinates': return {filter:'polarCoordinates', mode:s('mode', 'rectangularToPolar') === 'polarToRectangular' ? 'polarToRectangular' : 'rectangularToPolar'};
    /* ── filters_ext.rs ── */
    case 'filter.pixelate.colorHalftone': return {filter:'colorHalftone', maxRadius:clamp(f('maxRadius', 8), 4, 127), angles:[f('channel1', 108), f('channel2', 162), f('channel3', 90), f('channel4', 45)]};
    case 'filter.pixelate.crystallize': return {filter:'crystallize', cellSize:clamp(f('cellSize', 10), 3, 300), seed:pseed(p)};
    case 'filter.pixelate.facet': return {filter:'facet'};
    case 'filter.pixelate.fragment': return {filter:'fragment'};
    case 'filter.pixelate.mezzotint': { const K = ['fineDots', 'mediumDots', 'grainyDots', 'coarseDots', 'shortLines', 'mediumLines', 'longLines', 'shortStrokes', 'mediumStrokes', 'longStrokes'], t = s('type', 'fineDots');
      return {filter:'mezzotint', kind:K.includes(t) ? t : 'fineDots', seed:pseed(p)}; }
    case 'filter.pixelate.pointillize': return {filter:'pointillize', cellSize:clamp(f('cellSize', 5), 3, 300), seed:pseed(p), background:pcolour(p, 'background', WHITE)};
    case 'filter.stylize.diffuse': { const m = s('mode', 'normal'); return {filter:'diffuse', mode:['darkenOnly', 'lightenOnly', 'anisotropic'].includes(m) ? m : 'normal', seed:pseed(p)}; }
    case 'filter.stylize.extrude': return {filter:'extrude', kind:s('type', 'blocks') === 'pyramids' ? 'pyramids' : 'blocks', size:clamp(f('size', 30), 2, 255), depth:clamp(f('depth', 30), 1, 255),
      levelBased:s('depthMode', 'random') === 'levelBased', solidFront:pb(p, 'solidFrontFaces', false), maskIncomplete:pb(p, 'maskIncompleteBlocks', false), seed:pseed(p)};
    case 'filter.stylize.oilPaint': return {filter:'oilPaint', stylization:clamp(f('stylization', 4), 0.1, 10), cleanliness:clamp(f('cleanliness', 5), 0, 10), scale:clamp(f('scale', 1), 0.1, 10),
      bristleDetail:clamp(f('bristleDetail', 5), 0, 10), lighting:pb(p, 'lighting', true), angle:f('angle', -60), shine:clamp(f('shine', 1), 0, 10)};
    case 'filter.stylize.tiles': { const fl = s('fill', 'background');
      return {filter:'tiles', count:clamp(pi(p, 'count', 10), 1, 99), maxOffset:clamp(f('maxOffset', 10), 1, 99), fill:['foreground', 'inverse', 'unaltered'].includes(fl) ? fl : 'background',
        foreground:pcolour(p, 'foreground', BLACK), background:pcolour(p, 'background', WHITE), seed:pseed(p)}; }
    case 'filter.stylize.traceContour': return {filter:'traceContour', level:clamp(f('level', 128), 0, 255), upper:s('edge', 'lower') === 'upper'};
    case 'filter.stylize.wind': { const m = s('method', 'wind'); return {filter:'wind', method:m === 'blast' || m === 'stagger' ? m : 'wind', fromRight:s('direction', 'fromRight') !== 'fromLeft', seed:pseed(p)}; }
    case 'filter.distort.displace': return {filter:'displace', horizontal:clamp(f('horizontal', 10), -999, 999), vertical:clamp(f('vertical', 10), -999, 999), stretch:s('fit', 'stretch') !== 'tile', undefinedAreas:undefinedOf(p, 'repeat'), map:null};
    case 'filter.distort.shear': { const pts = plist(p, 'points', pt2); const a = clamp(f('amount', 0), -100, 100) / 100;
      return {filter:'shear', points:pts || [[0, 0], [0.5, a], [1, 0]], undefinedAreas:undefinedOf(p, 'wrap')}; }
    case 'filter.distort.zigZag': { const st = s('style', 'pondRipples'); return {filter:'zigZag', amount:clamp(f('amount', 10), -100, 100), ridges:clamp(f('ridges', 5), 0, 20), style:st === 'outFromCenter' || st === 'aroundCenter' ? st : 'pondRipples'}; }
    case 'filter.render.fibers': return {filter:'fibers', variance:clamp(f('variance', 16), 1, 64), strength:clamp(f('strength', 4), 1, 64), seed:pseed(p), foreground:pcolour(p, 'foreground', BLACK), background:pcolour(p, 'background', WHITE)};
    case 'filter.render.lensFlare': { const l = s('lens', 'zoom'); return {filter:'lensFlare', brightness:clamp(f('brightness', 100), 10, 300), centerX:clamp(f('centerX', 0.5), -0.5, 1.5), centerY:clamp(f('centerY', 0.5), -0.5, 1.5), lens:['prime35', 'prime105', 'moviePrime'].includes(l) ? l : 'zoom'}; }
    case 'filter.render.lightingEffects': {
      const lights = plist(p, 'lights', e => structOf(e, LIGHT0)) || [(() => { const lt = s('lightType', 'spot'), c = pcolour(p, 'color', WHITE);
        return {kind:lt === 'point' || lt === 'infinite' ? lt : 'spot', x:f('lightX', 0.25), y:f('lightY', 0.2), z:clamp(f('lightZ', 0.6), 0, 10), targetX:f('targetX', 0.5), targetY:f('targetY', 0.55),
          angle:f('angle', 135), elevation:clamp(f('elevation', 45), 0, 90), color:[c[0], c[1], c[2]], intensity:clamp(f('intensity', 75), -100, 100), cone:clamp(f('cone', 45), 1, 89),
          hotspot:clamp(f('hotspot', 50), 0, 100), radius:clamp(f('radius', 0.8), 0.01, 10)}; })()];
      const tx = s('texture', 'none');
      return {filter:'lightingEffects', lights, gloss:clamp(f('gloss', 0), -100, 100), metallic:clamp(f('metallic', 0), -100, 100), exposure:clamp(f('exposure', 0), -100, 100), ambience:clamp(f('ambience', 8), -100, 100),
        texture:['red', 'green', 'blue', 'alpha', 'luminance'].includes(tx) ? tx : 'none', height:clamp(f('height', 50), 0, 100), whiteIsHigh:pb(p, 'whiteIsHigh', true)};
    }
    case 'filter.noise.reduceNoise': return {filter:'reduceNoise', strength:clamp(f('strength', 6), 0, 10), preserveDetails:clamp(f('preserveDetails', 60), 0, 100), reduceColorNoise:clamp(f('reduceColorNoise', 45), 0, 100),
      sharpenDetails:clamp(f('sharpenDetails', 25), 0, 100), removeJpegArtifact:pb(p, 'removeJpegArtifact', false)};
    case 'filter.blur.smartBlur': { const q = s('quality', 'high'), m = s('mode', 'normal');
      return {filter:'smartBlur', radius:clamp(f('radius', 3), 0.1, 100), threshold:clamp(f('threshold', 25), 0.1, 100), quality:q === 'low' || q === 'medium' ? q : 'high', mode:m === 'edgeOnly' || m === 'overlayEdge' ? m : 'normal'}; }
    case 'filter.blur.lensBlur': { const B = {triangle:3, square:4, pentagon:5, heptagon:7, octagon:8}, dm = s('depthMap', 'none');
      return {filter:'lensBlur', radius:clamp(f('radius', 15), 0, 100), blades:B[s('shape', 'hexagon')] || 6, curvature:clamp(f('bladeCurvature', 0), 0, 100), rotation:f('rotation', 0),
        depth:dm === 'transparency' || dm === 'layerMask' ? dm : 'none', focalDistance:clamp(f('focalDistance', 0), 0, 255), invertDepth:pb(p, 'invert', false), brightness:clamp(f('brightness', 0), 0, 100),
        threshold:clamp(f('threshold', 255), 0, 255), noise:clamp(f('noise', 0), 0, 100), distribution:s('distribution', 'uniform') === 'gaussian' ? 'gaussian' : 'uniform',
        monochromatic:pb(p, 'monochromatic', false), seed:pseed(p), depthMap:null}; }
    case 'filter.blur.shapeBlur': { const S = ['ring', 'square', 'diamond', 'triangle', 'hexagon', 'star', 'heart', 'cross'], sh = s('shape', 'circle');
      return {filter:'shapeBlur', radius:clamp(f('radius', 10), 5, 1000), shape:S.includes(sh) ? sh : 'circle'}; }
    case 'filter.blurGallery.tiltShift': return {filter:'tiltShift', blur:blur(15), centerX:f('centerX', 0.5), centerY:f('centerY', 0.5), angle:f('angle', 0), focus:clamp(f('focus', 0.1), 0, 2), transition:clamp(f('transition', 0.15), 0.001, 2)};
    case 'filter.blurGallery.irisBlur': return {filter:'irisBlur', pins:plist(p, 'pins', e => structOf(e, IRIS0)) || [{x:f('centerX', 0.5), y:f('centerY', 0.5), radiusX:Math.max(f('radiusX', 0.35), 0.001), radiusY:Math.max(f('radiusY', 0.25), 0.001),
      angle:f('angle', 0), roundness:clamp(f('roundness', 0), 0, 100), feather:clamp(f('feather', 0.5), 0, 0.99), blur:blur(15)}]};
    case 'filter.blurGallery.fieldBlur': return {filter:'fieldBlur', pins:plist(p, 'pins', e => structOf(e, FIELD0)) || [{x:f('centerX', 0.5), y:f('centerY', 0.5), blur:blur(15)}]};
    case 'filter.blurGallery.spinBlur': return {filter:'spinBlur', pins:plist(p, 'pins', e => structOf(e, SPIN0)) || [{x:f('centerX', 0.5), y:f('centerY', 0.5), radiusX:Math.max(f('radiusX', 0.3), 0.001), radiusY:Math.max(f('radiusY', 0.3), 0.001),
      angle:f('angle', 0), blurAngle:clamp(f('blurAngle', 15), 0, 360)}]};
    case 'filter.blurGallery.pathBlur': {                              // PS：速度 0..500%、终点速度 px（预设＝短边 4%）、居中模糊、基本模糊／后帘同步闪光
      const es0 = pbEndSpeed0(), spd = clamp(f('speed', 50), 0, 500), tp = clamp(f('taper', 0), 0, 100), nb = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
      const one = e => { e = obj(e); if (!e || !Array.isArray(e.points)) return null; const pts = e.points.map(pt2).filter(x => x); if (pts.length < 2) return null;
        const es = Array.isArray(e.endSpeeds) ? e.endSpeeds : [], a = clamp(nb(es[0], es0), 0, 2000);
        return {points:pts, speed:clamp(nb(e.speed, spd), 0, 500), taper:clamp(nb(e.taper, tp), 0, 100), endSpeeds:[a, clamp(nb(es[1], a), 0, 2000)]}; };
      return {filter:'pathBlur', centered:pb(p, 'centered', true), flash:s('mode', 'basic') === 'rearSync',
        paths:plist(p, 'paths', one) || [one({points:[[f('startX', PATH0.points[0][0]), f('startY', PATH0.points[0][1])], [f('endX', PATH0.points[1][0]), f('endY', PATH0.points[1][1])]]})]}; }
    case 'filter.other.custom': { const k = Array.isArray(p.kernel) ? p.kernel.slice(0, 25).map(v => clamp(typeof v === 'number' ? v : 0, -999, 999)) : Array.from({length:25}, (_, i) => i === 12 ? 1 : 0);
      return {filter:'custom', kernel:k, scale:clamp(f('scale', 1), 1, 9999), offset:clamp(f('offset', 0), -9999, 9999)}; }
    case 'filter.other.hsbHsl': { const m = (k, d) => { const v = s(k, d); return v === 'hsb' ? 'hsb' : v === 'hsl' ? 'hsl' : 'rgb'; }; return {filter:'hsbHsl', input:m('inputMode', 'rgb'), output:m('rowOrder', 'hsb')}; }
    case 'filter.video.deInterlace': return {filter:'deInterlace', eliminateEven:s('eliminate', 'oddFields') === 'evenFields', interpolate:s('createBy', 'interpolation') !== 'duplication'};
    case 'filter.video.ntscColors': return {filter:'ntscColors'};
    case 'filter.filterGallery': return (typeof galleryParamsFor === 'function') ? galleryParamsFor(id, p) : null;   // gallery_cmds.rs:80
  }
  if (id.startsWith('filter.gallery.') && typeof galleryParamsFor === 'function') return galleryParamsFor(id, p);
  return null;
}

/* lib.rs:507 halo／halo_ext：{r:n}＝外扩 n 格；'bounds'＝整个参考框（扭曲类） */
function haloOf(fp){
  const g = sigma => ({r:Math.ceil(Math.max(sigma, 0) * 3) + 1}), r = v => ({r:Math.ceil(Math.max(v, 0)) + 1});
  switch (fp.filter){
    case 'gaussianBlur': case 'highPass': case 'unsharpMask': case 'smartSharpen': return g(fp.radius);
    case 'boxBlur': case 'surfaceBlur': case 'median': case 'dustAndScratches': case 'minimum': case 'maximum': return {r:Math.ceil(Math.max(fp.radius, 0)) + 1};
    case 'motionBlur': return {r:Math.ceil(Math.abs(fp.distance) / 2) + 2};
    case 'mosaic': return {r:Math.ceil(Math.max(fp.cellSize, 1)) + 1};
    case 'emboss': return {r:Math.ceil(Math.abs(fp.height)) + 2};
    case 'findEdges': return {r:1};
    case 'addNoise': case 'solarize': case 'invert': case 'desaturate': return {r:0};
    case 'radialBlur': case 'offset': case 'twirl': case 'pinch': case 'spherize': case 'wave': case 'ripple': case 'polarCoordinates': return 'bounds';
    case 'colorHalftone': return r(fp.maxRadius * 3);
    case 'crystallize': return r(Math.max(fp.cellSize, 1) * 3);
    case 'pointillize': return r(Math.max(fp.cellSize, 1) * 2);
    case 'facet': return r(3);
    case 'fragment': return r(4);
    case 'mezzotint': case 'hsbHsl': case 'ntscColors': return {r:0};
    case 'diffuse': return r(1);
    case 'extrude': return r(REACH.extrude(fp.depth) + clamp(fp.size, 2, 255) * 3 + 1);
    case 'oilPaint': return r(REACH.oil(fp.stylization, fp.scale));
    case 'tiles': return 'bounds';
    case 'traceContour': return r(1);
    case 'wind': return r(REACH.wind(fp.method));
    case 'displace': case 'shear': case 'zigZag': case 'spinBlur': return 'bounds';
    case 'fibers': case 'lensFlare': return {r:0};
    case 'lightingEffects': return r(1);
    case 'reduceNoise': return r(REACH.denoise());
    case 'smartBlur': case 'lensBlur': case 'shapeBlur': return r(fp.radius);
    case 'tiltShift': return r(REACH.gallery(fp.blur));
    case 'irisBlur': case 'fieldBlur': return r(REACH.gallery(fp.pins.reduce((m, q) => Math.max(m, q.blur), 0)));
    case 'pathBlur': return r(fp.paths.reduce((m, q) => Math.max(m, q.speed / 100 * Math.max(q.endSpeeds[0], q.endSpeeds[1])), 0) * (fp.centered ? 0.5 : 1) + 2);
    case 'custom': return r(2);
    case 'deInterlace': return r(1);
    case 'filterGallery': return {r:REACH.artistic(fp.effects)};
  }
  return {r:0};
}
/* lib.rs:542 label */
const LABELS = {gaussianBlur:'Gaussian Blur', boxBlur:'Box Blur', motionBlur:'Motion Blur', radialBlur:'Radial Blur', surfaceBlur:'Surface Blur', unsharpMask:'Unsharp Mask', smartSharpen:'Smart Sharpen',
  highPass:'High Pass', addNoise:'Add Noise', median:'Median', dustAndScratches:'Dust & Scratches', minimum:'Minimum', maximum:'Maximum', offset:'Offset', mosaic:'Mosaic', emboss:'Emboss', findEdges:'Find Edges',
  solarize:'Solarize', twirl:'Twirl', pinch:'Pinch', spherize:'Spherize', wave:'Wave', ripple:'Ripple', polarCoordinates:'Polar Coordinates', colorHalftone:'Color Halftone', crystallize:'Crystallize',
  facet:'Facet', fragment:'Fragment', mezzotint:'Mezzotint', pointillize:'Pointillize', diffuse:'Diffuse', extrude:'Extrude', oilPaint:'Oil Paint', tiles:'Tiles', traceContour:'Trace Contour', wind:'Wind',
  displace:'Displace', shear:'Shear', zigZag:'ZigZag', fibers:'Fibers', lensFlare:'Lens Flare', lightingEffects:'Lighting Effects', reduceNoise:'Reduce Noise', smartBlur:'Smart Blur', lensBlur:'Lens Blur',
  shapeBlur:'Shape Blur', tiltShift:'Tilt-Shift', irisBlur:'Iris Blur', fieldBlur:'Field Blur', spinBlur:'Spin Blur', pathBlur:'Path Blur', custom:'Custom', hsbHsl:'HSB/HSL', deInterlace:'De-Interlace', ntscColors:'NTSC Colors'};

/* ──────────────── 段：60-ui.js ──────────────── */
/* ═══════════ 对话框外框（照 ui-egui/src/filter_dialog.rs：参数表生成栏位＋即时预览；样式注入在这里，不改 style.css） ═══════════ */
const CSS = `
.psflt-bg{position:fixed;inset:0;z-index:9998;background:transparent}
.psflt-dlg{position:fixed;z-index:9999;top:70px;right:280px;min-width:320px;max-width:460px;max-height:calc(100vh - 90px);overflow:auto;background:#2b2f36;color:#e6e8eb;
  border:1px solid #444a54;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.5);font:12px sans-serif;display:flex;flex-direction:column}
.psflt-dlg.wide{left:40px;right:40px;top:50px;bottom:30px;max-width:none;max-height:none}
.psflt-dlg .hd{padding:8px 12px;font-weight:bold;cursor:move;background:#323741;border-bottom:1px solid #444a54;user-select:none}
.psflt-dlg .bd{padding:10px 12px;overflow:auto;flex:1}
.psflt-dlg .ft{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid #444a54}
.psflt-dlg .ft .sp{flex:1}
.psflt-dlg button{background:#3a404a;color:#e6e8eb;border:1px solid #555c68;border-radius:3px;padding:3px 12px;cursor:pointer;font:12px sans-serif}
.psflt-dlg button.pri{background:#2f7fd8;border-color:#2f7fd8;color:#fff}
.psflt-dlg button.on{background:#e6e8eb;color:#000}
.psflt-dlg .row{display:flex;align-items:center;gap:6px;margin:4px 0}
.psflt-dlg .row>.lb{min-width:104px;color:#aab0ba;text-align:right}
.psflt-dlg .row>.lb.w{min-width:0;text-align:left}
.psflt-dlg input[type=number],.psflt-dlg input[type=text],.psflt-dlg select{background:#1e2126;color:#e6e8eb;border:1px solid #444a54;border-radius:3px;padding:2px 4px;font:12px sans-serif}
.psflt-dlg input[type=number]{width:64px}
.psflt-dlg input[type=range]{flex:1;min-width:110px}
.psflt-dlg input[type=color]{width:34px;height:20px;padding:0;border:1px solid #444a54;background:none}
.psflt-dlg .sec{margin:8px 0 2px;color:#e6e8eb;font-weight:bold}
.psflt-dlg .note{color:#7a8290;font-size:11px;margin:4px 0}
.psflt-dlg canvas{display:block;background:#1e2126;border:1px solid #444a54}
.psflt-dlg .grid{display:grid;gap:3px}
.psflt-dlg .grid input{width:44px}
.psflt-dlg .err{color:#ff8a7a;margin-top:6px}
.psflt-dlg .busy{color:#e8c46a;font-size:11px}
`;
function injectCSS(){ if (document.getElementById('psFltCss')) return; const s = document.createElement('style'); s.id = 'psFltCss'; s.textContent = CSS; document.head.appendChild(s); }
function el(tag, props, kids){
  const e = document.createElement(tag);
  if (props) Object.entries(props).forEach(([k, v]) => { if (k === 'style') e.style.cssText = v; else if (k === 'data') Object.assign(e.dataset, v); else if (k in e) e[k] = v; else e.setAttribute(k, v); });
  (kids || []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}
const fmtNum = (v, step) => { const d = step && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) : 0; return String(+Number(v).toFixed(d)); };
function toast(msg){
  const d = el('div', {style:'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:10000;background:#5a2a2a;color:#fff;padding:6px 14px;border-radius:4px;font:12px sans-serif', data:{psfltToast:'1'}}, [msg]);
  document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}

/* Dlg.open(o)：o＝{id:原码命令 id, title?, v:栏位值物件, build(ui, v, state), params?(v, state)→命令参数, preview?:true|false, wide?:bool,
                   onPreview?(L, params)＝自订预览（预设＝在目前像素层上跑同一个滤镜）, onClose?()}
   确定＝CMD.run('ps.'+id, params)（一步历史）；取消／Esc＝还原预览前的像素。 */
const Dlg = {
  cur:null,
  isOpen(){ return !!this.cur; },
  open(o){
    this.cancel();
    injectCSS();
    const bg = el('div', {className:'psflt-bg', id:'psFltDlgBg'});
    const box = el('div', {className:'psflt-dlg' + (o.wide ? ' wide' : ''), id:'psFltDlg', data:{cmd:'ps.' + o.id}});
    const hd = el('div', {className:'hd'}, [o.title || menuName(o.id)]);
    const bd = el('div', {className:'bd'});
    const ft = el('div', {className:'ft'});
    const cur = this.cur = {o, v:o.v, state:o.state || {}, box, bg, bd, ft, prev:null, previewOn:true, raf:0, busy:null};
    if (o.preview !== false){
      const cb = el('input', {type:'checkbox', checked:true, data:{k:'__preview'}});
      cb.onchange = () => { cur.previewOn = cb.checked; this.schedule(); };
      ft.appendChild(el('label', {}, [cb, ' ' + t('preview')]));
      cur.busy = el('span', {className:'busy'}); ft.appendChild(cur.busy);
    }
    ft.appendChild(el('span', {className:'sp'}));
    ft.appendChild(el('button', {type:'button', data:{act:'cancel'}, onclick:() => this.cancel()}, [t('cancel')]));
    ft.appendChild(el('button', {type:'button', className:'pri', data:{act:'ok'}, onclick:() => this.ok()}, [t('ok')]));
    box.appendChild(hd); box.appendChild(bd); box.appendChild(ft);
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape'){ e.preventDefault(); this.cancel(); }
      else if (e.key === 'Enter' && !/textarea/i.test(e.target.tagName) && e.target.tagName !== 'BUTTON'){ e.preventDefault(); if (e.target.blur) e.target.blur(); this.ok(); }
      e.stopPropagation();
    });
    if (!o.wide) hd.addEventListener('pointerdown', e => {               // 拖标题移开对话框看画面
      const r = box.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { box.style.left = (r.left + ev.clientX - sx) + 'px'; box.style.top = (r.top + ev.clientY - sy) + 'px'; box.style.right = 'auto'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    document.body.appendChild(bg); document.body.appendChild(box);
    this.render();
    if (o.preview !== false) this.beginPreview();
    const first = bd.querySelector('input,select'); if (first && first.focus) first.focus();
    return box;
  },
  render(){
    const c = this.cur; if (!c) return;
    const sy = c.bd.scrollTop; c.bd.innerHTML = '';
    c.o.build(makeUI(c.bd, this), c.v, c.state);
    c.bd.scrollTop = sy;
  },
  changed(rebuild){ if (rebuild) this.render(); this.schedule(); },
  schedule(){
    const c = this.cur; if (!c || c.o.preview === false) return;
    if (c.raf) clearTimeout(c.raf);
    if (c.busy) c.busy.textContent = '…';
    c.raf = setTimeout(() => { c.raf = 0; this.runPreview(); }, 30);
  },
  params(){ const c = this.cur; return c.o.params ? c.o.params(c.v, c.state) : JSON.parse(JSON.stringify(c.v)); },
  /* 预览：同一个滤镜跑在目前像素层上，不进历史；关掉对话框就还原（filter_dialog.rs:378 preview_document 的做法，我们不缩小代理） */
  beginPreview(){
    const c = this.cur, L = Doc.active();
    // 智能对象（照 PS）：预览＝暂时把这个滤镜记进智能滤镜叠（改旧滤镜＝暂时换掉那一个的参数），关框就还原
    if (L && L.kind === 'smart' && !c.o.onPreview && L.data){ c.prev = {L, smart:true, filters0:JSON.parse(JSON.stringify(L.data.filters || []))}; this.runPreview(); return; }
    // 正在编辑图层蒙版（PS）：预览也套在蒙版上
    const ML = window.PsLayer && PsLayer.maskEditing && PsLayer.maskEditing();
    if (ML && ML === L && !c.o.onPreview){ const mc = L.mask.data.canvas; c.prev = {L, mask:true, snap:L.mask.data.ctx.getImageData(0, 0, mc.width, mc.height)}; this.runPreview(); return; }
    if (!L || L.kind !== 'raster') return;
    c.prev = {L, snap:Surf.fromLayer(L), x:L.x, y:L.y};
    this.runPreview();
  },
  restorePreview(){
    const p = this.cur && this.cur.prev; if (!p) return;
    if (p.smart){ p.L.data.filters = JSON.parse(JSON.stringify(p.filters0)); Layer.invalidate(p.L); return; }
    if (p.mask){ if (p.L.mask) p.L.mask.data.ctx.putImageData(p.snap, 0, 0); if (p.L.mask) { p.L.mask._cache = null; } Layer.invalidate(p.L); return; }
    p.snap.toLayer(p.L); p.L.x = p.x; p.L.y = p.y; Layer.invalidate(p.L);
  },
  runPreview(){
    const c = this.cur; if (!c || !c.prev) return;
    this.restorePreview();
    c.err = null;
    if (c.previewOn){
      try {
        const prm = this.params();
        if (c.prev.mask){
          const S = PsLayer.MaskSwap, h = S.begin(c.prev.L);
          try { previewFilter(c.prev.L, c.o.id, prm, c.prevState || (c.prevState = {})); S.writeBack(h); } finally { S.end(h); }
        }
        else if (c.prev.smart){
          const F = c.prev.L.data.filters = c.prev.L.data.filters || [], e = c.o.sfEdit;
          if (e && F[e.index]) F[e.index].params = prm;
          else F.push({command:c.o.id, params:prm, blend:'normal', opacity:1, visible:true});
        }
        else if (c.o.onPreview) c.o.onPreview(c.prev.L, prm);
        else previewFilter(c.prev.L, c.o.id, prm, c.prevState || (c.prevState = {}));
        Layer.invalidate(c.prev.L);
      } catch (e){ c.err = e.message; console.warn(e); }
    }
    if (c.busy) c.busy.textContent = c.err ? ('⚠ ' + c.err) : '';
    if (window.UI) UI.draw();
  },
  close(){
    const c = this.cur; if (!c) return;
    if (c.raf) clearTimeout(c.raf);
    c.box.remove(); c.bg.remove(); this.cur = null;
    if (c.o.onClose) try { c.o.onClose(); } catch (_){}
  },
  ok(){
    const c = this.cur; if (!c) return null;
    let prm; try { prm = this.params(); } catch (e){ prm = null; }
    this.restorePreview(); this.close();
    if (!prm) return null;
    // 先关框再问一件事（置换：确定后才挑置换图文件，照 PS 2020）；回 null＝取消
    if (c.o.beforeRun) return Promise.resolve(c.o.beforeRun(prm)).then(p2 => p2 ? this.ok.call({cur:{o:Object.assign({}, c.o, {beforeRun:null}), v:c.v}, params:() => p2, restorePreview(){}, close(){}}) : null);
    let r;
    try {
      // 双击智能滤镜重开的框：确定＝改那个智能滤镜的参数（一步历史），不是再叠一个
      if (c.o.sfEdit) r = CMD.run('ps.layer.smartFilter.setParams', {id:c.o.sfEdit.id, index:c.o.sfEdit.index, params:prm, replace:true});
      else r = CMD.run('ps.' + c.o.id, prm);
    } catch (e){ console.error(e); r = {ok:false, error:String(e && e.message || e)}; }
    if (r && r.ok === false) toast(t('error') + (r.error || ''));
    if (window.UI) UI.refresh();
    return r;
  },
  cancel(){
    if (!this.cur) return;
    this.restorePreview(); this.close();
    if (window.UI) UI.refresh();
  }
};
/* 对话框开着时，对话框外的键一律不给：Esc＝取消、Enter＝确定 */
window.addEventListener('keydown', e => {
  const c = Dlg.cur; if (!c || c.box.contains(e.target)) return;
  if (e.key === 'Escape') Dlg.cancel(); else if (e.key === 'Enter') Dlg.ok();
  e.preventDefault(); e.stopPropagation();
}, true);

/* 控件小工具：每个控件都带 data-k（测试与 agent 照这个找），改了就叫 D.changed */
function makeUI(root, D){
  const add = n => { root.appendChild(n); return n; };
  const row = (label, nodes, wide) => add(el('div', {className:'row'}, [el('span', {className:'lb' + (wide ? ' w' : '')}, [label || ''])].concat(nodes)));
  const num = (k, val, min, max, step, on) => {
    const n = el('input', {type:'number', min, max, step:step || 1, value:fmtNum(val, step), data:{k}});
    n.addEventListener('input', () => { const x = Number(n.value); if (n.value !== '' && isFinite(x)) on(clamp(x, min, max)); });
    n.addEventListener('change', () => { const x = Number(n.value); if (isFinite(x)){ const v = clamp(x, min, max); n.value = fmtNum(v, step); on(v); } });
    return n;
  };
  return {
    root, add, row,
    sec(text){ return add(el('div', {className:'sec'}, [text])); },
    note(text){ return add(el('div', {className:'note'}, [text])); },
    /* 滑杆＋数字框；log＝对数滑杆（filter_dialog.rs:246 min>0 且 max/min>500） */
    slider({k, label, min, max, step, get, set, unit, rebuild, log}){
      const st = step || 1;
      const toR = v => log ? Math.log(clamp(v, min, max)) : v, fromR = r => log ? Math.exp(r) : r;
      const r = el('input', {type:'range', min:toR(min), max:toR(max), step:log ? 'any' : st, value:toR(get()), data:{k}});
      const n = num(k, get(), min, max, st, v => { set(v); r.value = toR(v); D.changed(rebuild); });
      r.addEventListener('input', () => { let v = fromR(Number(r.value)); v = Math.round(v / st) * st; v = clamp(+v.toFixed(4), min, max); set(v); n.value = fmtNum(v, st); D.changed(rebuild); });
      return row(label, unit ? [r, n, el('span', {}, [unit])] : [r, n]);
    },
    number({k, label, min, max, step, get, set, rebuild, after}){ return row(label, [num(k, get(), min, max, step, x => { set(x); D.changed(rebuild); })].concat(after || [])); },
    check({k, label, get, set, rebuild, disabled}){
      const c = el('input', {type:'checkbox', checked:!!get(), disabled:!!disabled, data:{k}});
      c.onchange = () => { set(c.checked); D.changed(rebuild); };
      return row('', [el('label', {}, [c, ' ' + label])]);
    },
    select({k, label, options, get, set, rebuild, disabled}){
      const s = el('select', {disabled:!!disabled, data:{k}});
      options.forEach(([val, text]) => s.appendChild(el('option', {value:String(val), selected:String(get()) === String(val)}, [text])));
      s.onchange = () => { const o = options.find(x => String(x[0]) === s.value); set(o ? o[0] : s.value); D.changed(rebuild); };
      return row(label, [s]);
    },
    radio({k, label, options, get, set, rebuild}){
      const nodes = options.map(([val, text]) => { const r = el('input', {type:'radio', name:'psflt_' + k, value:String(val), checked:String(get()) === String(val), data:{k}});
        r.onchange = () => { if (r.checked){ set(val); D.changed(rebuild); } }; return el('label', {style:'margin-right:8px'}, [r, ' ' + text]); });
      return row(label, nodes);
    },
    color({k, label, get, set, disabled}){
      const c = el('input', {type:'color', value:get(), disabled:!!disabled, data:{k}});
      c.addEventListener('input', () => { set(c.value); D.changed(); });
      return row(label, [c]);
    },
    text({k, label, get, set}){ const x = el('input', {type:'text', value:get(), style:'width:200px', data:{k}}); x.addEventListener('input', () => { set(x.value); D.changed(); }); return row(label, [x]); },
    button(text, fn, k){ const b = el('button', {type:'button', data:{k:k || ''}}, [text]); b.onclick = () => { fn(); }; return b; },
    canvas(w, h, k){ const c = el('canvas', {width:w, height:h, data:{k}}); c.style.width = w + 'px'; c.style.height = h + 'px'; return c; }
  };
}

/* ──────────────── 段：70-run.js ──────────────── */
/* ═══════════ 跑滤镜（engine/src/filters.rs:131-229 apply_filter_to_surface／run_filter ＋ algo/src/lib.rs:834-959 output_area／apply_in／apply_tiled） ═══════════ */
/* 命令参数说明（照原码 specs 的 params 字串原样；filters.rs:249-308、filters_ext.rs:456-597、gallery_cmds.rs:142、extra_cmds.rs:688-690） */
const SPEC = {
  'filter.blur.gaussianBlur':'{"radius":0.1..1000=1}', 'filter.blur.blur':'{}', 'filter.blur.blurMore':'{}', 'filter.sharpen.sharpen':'{}', 'filter.sharpen.sharpenMore':'{}',
  'filter.sharpen.sharpenEdges':'{}', 'filter.noise.despeckle':'{}', 'filter.blur.boxBlur':'{"radius":1..2000=1}', 'filter.blur.motionBlur':'{"angle":-360..360=0,"distance":1..2000=10}',
  'filter.blur.radialBlur':'{"amount":1..100=10,"method":"spin|zoom","centerX":0..1=0.5,"centerY":0..1=0.5}', 'filter.blur.surfaceBlur':'{"radius":1..100=5,"threshold":2..255=15}',
  'filter.sharpen.unsharpMask':'{"amount":1..500=50,"radius":0.1..1000=1,"threshold":0..255=0}', 'filter.sharpen.smartSharpen':'{"amount":1..500=100,"radius":0.1..64=1,"reduceNoise":0..100=10}',
  'filter.noise.addNoise':'{"amount":0.1..400=12.5,"distribution":"uniform|gaussian","monochromatic":bool,"seed":u32=0}', 'filter.noise.median':'{"radius":1..500=1}',
  'filter.noise.dustAndScratches':'{"radius":1..500=1,"threshold":0..255=0}', 'filter.pixelate.mosaic':'{"cellSize":2..200=10}', 'filter.stylize.emboss':'{"angle":-180..180=135,"height":1..100=3,"amount":1..500=100}',
  'filter.stylize.findEdges':'{}', 'filter.stylize.solarize':'{}', 'filter.distort.twirl':'{"angle":-999..999=50}', 'filter.distort.pinch':'{"amount":-100..100=50}',
  'filter.distort.spherize':'{"amount":-100..100=100,"mode":"normal|horizontalOnly|verticalOnly"}',
  'filter.distort.wave':'{"generators":1..999=5,"wavelengthMin":1..998=10,"wavelengthMax":2..999=120,"amplitudeMin":1..998=5,"amplitudeMax":1..999=35,"type":"sine|triangle|square","undefinedAreas":"wrap|repeat","seed":u32=0}',
  'filter.distort.ripple':'{"amount":-999..999=100,"size":"small|medium|large"}', 'filter.distort.polarCoordinates':'{"mode":"rectangularToPolar|polarToRectangular"}',
  'filter.other.highPass':'{"radius":0.1..1000=10}', 'filter.other.minimum':'{"radius":0.2..500=1,"preserve":"squareness|roundness"}', 'filter.other.maximum':'{"radius":0.2..500=1,"preserve":"squareness|roundness"}',
  'filter.other.offset':'{"horizontal":px=0,"vertical":px=0,"undefinedAreas":"wrap|repeat|transparent"}',
  'filter.pixelate.colorHalftone':'{"maxRadius":4..127=8,"channel1":-360..360=108,"channel2":-360..360=162,"channel3":-360..360=90,"channel4":-360..360=45}',
  'filter.pixelate.crystallize':'{"cellSize":3..300=10,"seed":u32=0}', 'filter.pixelate.facet':'{}', 'filter.pixelate.fragment':'{}',
  'filter.pixelate.mezzotint':'{"type":"fineDots|mediumDots|grainyDots|coarseDots|shortLines|mediumLines|longLines|shortStrokes|mediumStrokes|longStrokes","seed":u32=0}',
  'filter.pixelate.pointillize':'{"cellSize":3..300=5,"seed":u32=0,"background":json}', 'filter.stylize.diffuse':'{"mode":"normal|darkenOnly|lightenOnly|anisotropic","seed":u32=0}',
  'filter.stylize.extrude':'{"type":"blocks|pyramids","size":2..255=30,"depth":1..255=30,"depthMode":"random|levelBased","solidFrontFaces":bool,"maskIncompleteBlocks":bool,"seed":u32=0}',
  'filter.stylize.oilPaint':'{"stylization":0.1..10=4,"cleanliness":0..10=5,"scale":0.1..10=1,"bristleDetail":0..10=5,"lighting":bool=true,"angle":-180..180=-60,"shine":0..10=1}',
  'filter.stylize.tiles':'{"count":1..99=10,"maxOffset":1..99=10,"fill":"background|foreground|inverse|unaltered","seed":u32=0,"foreground":json,"background":json}',
  'filter.stylize.traceContour':'{"level":0..255=128,"edge":"lower|upper"}', 'filter.stylize.wind':'{"method":"wind|blast|stagger","direction":"fromRight|fromLeft","seed":u32=0}',
  'filter.distort.displace':'{"horizontal":-999..999=10,"vertical":-999..999=10,"fit":"stretch|tile","undefinedAreas":"repeat|wrap","mapDocument":doc,"mapPath":text,"mapLayer":json}',
  'filter.distort.shear':'{"amount":-100..100=0,"undefinedAreas":"wrap|repeat","points":json}', 'filter.distort.zigZag':'{"amount":-100..100=10,"ridges":0..20=5,"style":"pondRipples|outFromCenter|aroundCenter"}',
  'filter.render.fibers':'{"variance":1..64=16,"strength":1..64=4,"seed":u32=0,"foreground":json,"background":json}',
  'filter.render.lensFlare':'{"brightness":10..300=100,"centerX":0..1=0.5,"centerY":0..1=0.5,"lens":"zoom|prime35|prime105|moviePrime"}',
  'filter.render.lightingEffects':'{"lightType":"spot|point|infinite","intensity":-100..100=75,"lightX":0..1=0.25,"lightY":0..1=0.2,"lightZ":0..2=0.6,"targetX":0..1=0.5,"targetY":0..1=0.55,"cone":1..89=45,"hotspot":0..100=50,"angle":-180..180=135,"elevation":0..90=45,"gloss":-100..100=0,"metallic":-100..100=0,"exposure":-100..100=0,"ambience":-100..100=8,"texture":"none|red|green|blue|alpha|luminance","height":0..100=50,"whiteIsHigh":bool=true,"lights":json}',
  'filter.noise.reduceNoise':'{"strength":0..10=6,"preserveDetails":0..100=60,"reduceColorNoise":0..100=45,"sharpenDetails":0..100=25,"removeJpegArtifact":bool}',
  'filter.blur.smartBlur':'{"radius":0.1..100=3,"threshold":0.1..100=25,"quality":"high|medium|low","mode":"normal|edgeOnly|overlayEdge"}',
  'filter.blur.lensBlur':'{"radius":0..100=15,"shape":"hexagon|triangle|square|pentagon|heptagon|octagon","bladeCurvature":0..100=0,"rotation":0..360=0,"depthMap":"none|transparency|layerMask","focalDistance":0..255=0,"invert":bool,"brightness":0..100=0,"threshold":0..255=255,"noise":0..100=0,"distribution":"uniform|gaussian","monochromatic":bool,"seed":u32=0}',
  'filter.blur.shapeBlur':'{"radius":5..1000=10,"shape":"circle|ring|square|diamond|triangle|hexagon|star|heart|cross"}',
  'filter.blurGallery.tiltShift':'{"blur":0..500=15,"centerX":0..1=0.5,"centerY":0..1=0.5,"angle":-90..90=0,"focus":0..1=0.1,"transition":0.01..1=0.15}',
  'filter.blurGallery.irisBlur':'{"blur":0..500=15,"centerX":0..1=0.5,"centerY":0..1=0.5,"radiusX":0.01..1=0.35,"radiusY":0.01..1=0.25,"angle":-180..180=0,"roundness":0..100=0,"feather":0..0.99=0.5,"pins":json}',
  'filter.blurGallery.fieldBlur':'{"blur":0..500=15,"centerX":0..1=0.5,"centerY":0..1=0.5,"pins":json}',
  'filter.blurGallery.spinBlur':'{"blurAngle":0..360=15,"centerX":0..1=0.5,"centerY":0..1=0.5,"radiusX":0.01..1=0.3,"radiusY":0.01..1=0.3,"angle":-180..180=0,"pins":json}',
  'filter.blurGallery.pathBlur':'{"speed":0..500=50,"taper":0..100=0,"centered":bool=true,"mode":"basic|rearSync","startX":0..1=0.2,"startY":0..1=0.5,"endX":0..1=0.8,"endY":0..1=0.5,"paths":json}',
  'filter.other.custom':'{"kernel":int[25],"scale":1..9999=1,"offset":-9999..9999=0}', 'filter.other.hsbHsl':'{"inputMode":"rgb|hsb|hsl","rowOrder":"hsb|hsl|rgb"}',
  'filter.video.deInterlace':'{"eliminate":"oddFields|evenFields","createBy":"interpolation|duplication"}', 'filter.video.ntscColors':'{}',
  'filter.filterGallery':'{"effects":json,"foreground":json,"background":json,"list":bool}',
  'filter.blur.average':'{}', 'filter.render.clouds':'{"seed":u32=0}', 'filter.render.differenceClouds':'{"seed":u32=0}'
};
const specOf = id => PARAM_SPECS[id] || SPEC[id] || '{}';

/* filters_ext.rs:373 uses_colours／379 prepare：会读前景／背景色的滤镜，把目前色块写进参数（录下来的参数才能重现） */
function usesColours(id){
  if (['filter.render.fibers', 'filter.stylize.tiles', 'filter.pixelate.pointillize', 'filter.filterGallery'].includes(id)) return true;
  return id.startsWith('filter.gallery.') && typeof ag_usesColours === 'function' && ag_usesColours(id);
}
function prepare(id, p){
  const out = p && typeof p === 'object' && !Array.isArray(p) ? Object.assign({}, p) : {};
  if (usesColours(id)){ if (out.foreground === undefined) out.foreground = fgColor(); if (out.background === undefined) out.background = bgColor(); }
  return out;
}
/* filters_ext.rs:391 map_from_document：某层（或整份拼合）当置换图 */
function mapImageOf(layerId){
  if (layerId !== undefined && layerId !== null){
    const L = Doc.byId(layerId); if (!L) return null;
    let s;
    if (L.kind === 'raster'){ s = Surf.fromLayer(L); const cb = s.contentBounds(); const r = rEmpty(cb) ? R(0, 0, Doc.width, Doc.height) : cb; return new Img(r, 4, s.readRegion(r)); }
    const c = renderLayer(L, 1), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; s = new Surf(0, 0, c.width, c.height); for (let i = 0; i < d.length; i++) s.data[i] = d[i] / 255;
    const cb = s.contentBounds(), r = rEmpty(cb) ? R(0, 0, Doc.width, Doc.height) : cb; return new Img(r, 4, s.readRegion(r));
  }
  const c = composite(1), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, data = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) data[i] = d[i] / 255;
  return new Img(R(0, 0, c.width, c.height), 4, data);
}
/* filters_ext.rs:404 resolve：置换图（mapDocument＝0／'本文件名'＝这份文件；mapLayer＝某层 id；mapPath 要读档——网页读不到本机路径） */
/* 置换图文件（PS 2020：置换对话框按确定后跳「选取一个置换图」挑 .psd）：读进来的图放这里，参数只记 mapKey／mapFile（智能滤镜参数是 JSON、
   每次重渲都拿来当快取键，不能塞整张图）。存工程档时把智能滤镜用到的置换图一起写进 displaceMaps（PS 也把置换图存进智能滤镜），开档先解回来 */
const DISP_MAPS = new Map(); let dispSeq = 0;
function dispPut(key, name, c){
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, data = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) data[i] = d[i] / 255;
  DISP_MAPS.set(key, {name, canvas:c, img:new Img(R(0, 0, c.width, c.height), 4, data)});
}
function dispKeysUsed(){
  const keys = new Set();
  const scan = list => (list || []).forEach(L => { if (L && L.kind === 'smart' && L.data) (L.data.filters || []).forEach(f => { if (f && f.command === 'filter.distort.displace' && f.params && f.params.mapKey) keys.add(f.params.mapKey); }); });
  scan(Doc.layers);
  try { if (window.Smart && window.SmartStore) Smart.collect(Doc.layers).forEach(id => { const e = SmartStore.get(id); if (e && e.type === 'layers') scan(e.layers); }); } catch (_){}
  return keys;
}
if (window.Project && !Project.__dispMaps){
  Project.__dispMaps = true;
  const ser0 = Project.serialize;
  Project.serialize = function(){
    const j = ser0.apply(this, arguments);
    try {
      const keys = dispKeysUsed();
      if (j && keys.size){ const m = j.displaceMaps = Object.assign({}, j.displaceMaps || {});
        keys.forEach(k => { const e = DISP_MAPS.get(k); if (e && !m[k]) m[k] = {name:e.name, image:Project.encodeExtra(e.canvas, 'dmap:' + k)}; }); }
    } catch (e){ console.warn('[置换图] 存档', e); }
    return j;
  };
  const load0 = Project.load;
  Project.load = async function(json){
    if (json && json.displaceMaps && typeof json.displaceMaps === 'object'){
      for (const [k, m] of Object.entries(json.displaceMaps)){
        if (DISP_MAPS.has(k) || !m || !m.image) continue;
        try { const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = m.image; });
          const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); dispPut(k, m.name || 'map', c); }
        catch (e){ console.warn('[置换图] 读不回来：', k, e); }
      }
    }
    return load0.apply(this, arguments);
  };
  if (Array.isArray(Project.asyncCanvases)) Project.asyncCanvases.push(() => [...dispKeysUsed()].map(k => DISP_MAPS.get(k)).filter(Boolean).map(e => e.canvas));
}
async function loadDisplaceMap(p){
  const f = p.file || (p.files && p.files[0]) || p.url, name = String(p.name || (f && f.name) || (typeof f === 'string' ? f.split(/[?#]/)[0].split(/[\\/]/).pop() : '') || 'map');
  if (!f) throw new FltBad('loadDisplaceMap: need file or url');
  let c;
  if (/\.psd$/i.test(name) || (f instanceof Blob && /photoshop|psd/i.test(f.type || ''))) c = await PsFile.psd.canvas(f);
  else {
    const url = f instanceof Blob ? URL.createObjectURL(f) : f, img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new FltBad('cannot open displacement map `' + name + '`')); img.src = url; });
    c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    if (f instanceof Blob) URL.revokeObjectURL(url);
  }
  const key = 'dmap' + (++dispSeq) + '-' + Date.now().toString(36);
  dispPut(key, name, c);
  return {mapKey:key, mapFile:name, width:c.width, height:c.height};
}
/* 对话框按确定：没挑本文件／图层、也没读过的置换图 ⇒ 开文件挑选器（.psd，也认一般图片） */
async function displaceBeforeRun(prm){
  if (prm.mapDocument !== undefined || prm.mapLayer !== undefined || prm.mapPath || (prm.mapKey && DISP_MAPS.has(prm.mapKey))) return prm;
  const fs = await PsFile.pickFiles('.psd,image/*', false); if (!fs || !fs.length) return null;
  try { return Object.assign({}, prm, await loadDisplaceMap({file:fs[0]})); }
  catch (e){ toast(t('error') + (e && e.message || e)); return null; }
}
function resolve(fp, p){
  if (fp.filter !== 'displace' || fp.map) return;
  if (p.mapKey){ const m = DISP_MAPS.get(p.mapKey); if (!m) throw new FltBad('the displacement map `' + (p.mapFile || p.mapKey) + '` is no longer loaded: choose it again'); fp.map = m.img; return; }
  const layer = p.mapLayer !== undefined && p.mapLayer !== null && p.mapLayer !== -1 && p.mapLayer !== '' ? p.mapLayer : undefined;
  let img;
  if (typeof p.mapPath === 'string' && p.mapPath) throw new FltBad('cannot read displacement map `' + p.mapPath + '`: the browser cannot open local paths (use mapDocument 0 + mapLayer)');
  else if (p.mapDocument !== undefined && p.mapDocument !== null && p.mapDocument !== -1){
    const d = p.mapDocument;
    if (!(d === 0 || d === '0' || d === 'current')) throw new FltBad('displacement map document not found');
    img = mapImageOf(layer);
  } else if (layer !== undefined) img = mapImageOf(layer);           // 我们只有一份文件：只给 mapLayer 也认
  else throw new FltBad('Displace needs a displacement map: pass `mapPath` or `mapDocument`');
  if (!img) throw new FltBad('the displacement map is empty');
  fp.map = img;
}
/* filters_ext.rs:430 resolve_in_layer：镜头模糊的深度＝图层蒙版（我们的蒙版是一张 raster，alpha＝显示度 ⇒ 通道 0 放 alpha）——写在 filterSurf 里 */
/* lib.rs:834 output_area */
function outputArea(fp, content, bounds, selBounds){
  const h = haloOf(fp);
  let area = h === 'bounds' ? bounds : (rEmpty(content) ? EMPTY : rInflate(content, h.r));
  if (selBounds) area = rInter(area, selBounds);
  return area;
}
/* lib.rs:860 apply_in → 874 apply_tiled（不分块：原码保证结果与分块无关，整块一次算） */
function applyIn(surf, fp, area, bounds, sel, extent){
  area = rInter(area, extent);
  const out = surf.clone();
  if (rEmpty(area)) return out;
  const ctx = {bounds, mode:'rgb', alpha:true}, h = haloOf(fp);
  const src = h === 'bounds' ? Img.read(surf, rUnion(bounds, area)) : Img.readClamped(surf, rInflate(area, h.r), extent);
  const k = KERNELS[fp.filter]; if (!k) throw new FltBad('filter `' + fp.filter + '` is not available');
  const data = k(src, area, ctx, fp);
  if (sel){                                                        // 按选区覆盖度混回原样
    const w = RW(area), n = 4;
    for (let i = 0, N = w * RH(area); i < N; i++){
      const xx = area.x0 + i % w, yy = area.y0 + Math.floor(i / w), kk = clamp(sel.get(xx, yy), 0, 1);
      if (kk >= 1) continue;
      for (let c = 0; c < n; c++){ const o = src.get(xx, yy, c); data[i * n + c] = o + (data[i * n + c] - o) * kk; }
    }
  }
  out.writeRegion(area, data);
  return out;
}
const lockMsg = L => { const k = L && L.locks; return k && (k.all || k.pixels) ? 'Could not complete your request because the layer "' + L.name + '" is locked' : null; };
function targetLayer(p, cmd){
  const L = (p && p.layer !== undefined && p.layer !== null && p.layer !== '') ? Doc.byId(p.layer) : (p && p.layerId) ? Doc.byId(p.layerId) : Doc.active();
  if (!L) throw new FltBad(cmd + ': no active layer');
  if (L.kind !== 'raster') throw new FltBad('filters need a pixel layer (active layer is a ' + L.kind + ' layer)');
  const m = lockMsg(L); if (m) throw new FltBad(m);
  return L;
}
/* filters.rs:182 run_filter 的像素部分：对一块 Surf 跑（env＝{docB 画布框, sel 选区覆盖度 or null, mask 图层蒙版 Surf or null, k 代理缩小倍数}） */
function filterSurf(surf, id, p, env){
  const fp = paramsFor(id, p); if (!fp) throw new FltBad('unknown filter ' + id);
  resolve(fp, p);
  if (fp.map && env.k > 1) fp.map = downImg(fp.map, env.k);
  const sel = env.sel, selBounds = sel ? sel.bounds : null, docB = env.docB;
  const bounds = selBounds && !rEmpty(selBounds) ? selBounds : docB;   // 扭曲类以选区为中心，没选区＝画布
  if (fp.filter === 'lensBlur' && fp.depth === 'layerMask' && env.mask){ const raw = env.mask.readRegion(bounds), img = new Img(bounds, 4); for (let i = 0; i < raw.length; i += 4){ img.data[i] = img.data[i + 1] = img.data[i + 2] = raw[i + 3]; img.data[i + 3] = 1; } fp.depthMap = img; }
  const content = surf.contentBounds();
  const area = outputArea(fp, content, bounds, selBounds);
  return {fp, out:applyIn(surf, fp, area, bounds, sel, rUnion(docB, content))};
}
function runFilterOnLayer(L, id, p, opt){
  opt = opt || {};
  if (SURF_OPS[id]) return SURF_OPS[id](L, p || {}, opt);
  p = prepare(id, p);
  const sel = selCoverage(), docB = R(0, 0, Doc.width, Doc.height);
  const {fp, out} = filterSurf(Surf.fromLayer(L), id, p, {docB, sel, mask:L.mask ? Surf.fromLayer(L.mask) : null, k:1});
  out.toLayer(L); Layer.invalidate(L);
  const shown = Object.assign({}, fp); delete shown.map; delete shown.depthMap;
  return {ok:true, layer:L.id, filter:shown};
}

/* ── 对话框预览的代理（filter_dialog.rs:378 preview_document：在缩小 k 倍的代理文件上跑同一条命令，像素单位的参数除以 k）──
   慢的滤镜（放射模糊、表面模糊…）整层一次要好几秒，预览先在 k=4 的代理上量时间、估整层要多久，超过 ~250ms 就用代理预览（结果放大回去；没改到的地方留原图） */
function downSurf(s, k){                                            // k×k 方块平均（预乘）
  const X0 = Math.floor(s.x0 / k), Y0 = Math.floor(s.y0 / k), X1 = Math.ceil((s.x0 + s.w) / k), Y1 = Math.ceil((s.y0 + s.h) / k), o = new Surf(X0, Y0, X1 - X0, Y1 - Y0);
  const acc = new Float64Array(o.w * o.h * 5);
  for (let y = 0; y < s.h; y++){ const Y = Math.floor((y + s.y0) / k) - Y0;
    for (let x = 0; x < s.w; x++){ const X = Math.floor((x + s.x0) / k) - X0, i = (y * s.w + x) * 4, j = (Y * o.w + X) * 5, a = s.data[i + 3];
      acc[j] += s.data[i] * a; acc[j + 1] += s.data[i + 1] * a; acc[j + 2] += s.data[i + 2] * a; acc[j + 3] += a; acc[j + 4]++; } }
  for (let q = 0; q < o.w * o.h; q++){ const j = q * 5, a = acc[j + 3]; o.data[q * 4] = a > 0 ? acc[j] / a : 0; o.data[q * 4 + 1] = a > 0 ? acc[j + 1] / a : 0; o.data[q * 4 + 2] = a > 0 ? acc[j + 2] / a : 0; o.data[q * 4 + 3] = acc[j + 4] ? a / (k * k) : 0; }
  return o;
}
function downImg(img, k){ const s = new Surf(img.rect.x0, img.rect.y0, RW(img.rect), RH(img.rect), img.data.slice()); const d = downSurf(s, k); return new Img(d.rect(), 4, d.data); }
function previewProxy(L, id, p, k){
  const full = Surf.fromLayer(L), proxy = downSurf(full, k);
  const W = Doc.width, H = Doc.height, pw = Math.ceil(W / k), ph = Math.ceil(H / k), sel0 = selCoverage();
  let sel = null;
  if (sel0){                                                        // 选区覆盖度也缩
    const b = new Float32Array(pw * ph);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b[Math.floor(y / k) * pw + Math.floor(x / k)] += sel0.bytes[y * W + x] / 255 / (k * k);
    let x0 = pw, y0 = ph, x1 = -1, y1 = -1; for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) if (b[y * pw + x] > 0){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    sel = {get:(x, y) => (x >= 0 && y >= 0 && x < pw && y < ph) ? Math.min(1, b[y * pw + x]) : 0, bounds:x1 < 0 ? EMPTY : R(x0, y0, x1 + 1, y1 + 1)};
  }
  const q = Object.assign({}, p);
  Object.keys(q).forEach(key => { if (PIXEL_KEYS.includes(key) && typeof q[key] === 'number') q[key] = Math.max(q[key] / k, key === 'cellSize' ? 1 : 0.1); });
  if (id === 'filter.blurGallery.pathBlur' && Array.isArray(q.paths))   // 路径模糊的终点速度是像素：代理上跟着缩
    q.paths = q.paths.map(o => o && Array.isArray(o.endSpeeds) ? Object.assign({}, o, {endSpeeds:o.endSpeeds.map(x => typeof x === 'number' ? x / k : x)}) : o);
  const {out} = filterSurf(proxy, id, q, {docB:R(0, 0, pw, ph), sel, mask:L.mask ? downSurf(Surf.fromLayer(L.mask), k) : null, k});
  /* 放大回去：双线性（预乘）；代理上没改到的格保留原图 */
  const res = full.clone(); res.ensure(R(out.x0 * k, out.y0 * k, (out.x0 + out.w) * k, (out.y0 + out.h) * k));
  const orig = res.clone(), pd = proxy, od = out;
  const chg = (X, Y) => { const a = od.pixel(X, Y), b = pd.pixel(X, Y); return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3])) > 1 / 512 ? 1 : 0; };
  for (let y = res.y0; y < res.y0 + res.h; y++){
    const fy = (y + 0.5) / k - 0.5, Y0 = Math.floor(fy), ty = fy - Y0;
    for (let x = res.x0; x < res.x0 + res.w; x++){
      const fx = (x + 0.5) / k - 0.5, X0 = Math.floor(fx), tx = fx - X0;
      let r = 0, g = 0, bl = 0, a = 0, m = 0;
      for (let q2 = 0; q2 < 4; q2++){ const dx = q2 & 1, dy = q2 >> 1, w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty); if (w <= 0) continue;
        const px = od.pixel(X0 + dx, Y0 + dy); r += px[0] * px[3] * w; g += px[1] * px[3] * w; bl += px[2] * px[3] * w; a += px[3] * w; m += chg(X0 + dx, Y0 + dy) * w; }
      if (m <= 0) continue;
      const i = ((y - res.y0) * res.w + (x - res.x0)) * 4, o = orig.data;
      const nv = [a > 0 ? r / a : 0, a > 0 ? g / a : 0, a > 0 ? bl / a : 0, a];
      for (let c = 0; c < 4; c++) res.data[i + c] = o[i + c] + (nv[c] - o[i + c]) * m;
    }
  }
  res.toLayer(L); Layer.invalidate(L);
}
/* 对话框预览：参数式滤镜先在 4 倍代理上估时间，整层预估超过 250ms 就用代理（k＝能压到 ~250ms 的最小整数） */
function previewFilter(L, id, p, state){
  if (SURF_OPS[id]) return SURF_OPS[id](L, p, {preview:true});
  p = prepare(id, p);
  const px = L.data.canvas.width * L.data.canvas.height;
  if (state.k === undefined){
    if (px < 120000) state.k = 1;
    else { const snap = Surf.fromLayer(L), t0 = performance.now(); try { previewProxy(L, id, p, 4); } finally { snap.toLayer(L); }
      const est = (performance.now() - t0) * 16; state.k = est <= 250 ? 1 : clamp(Math.ceil(Math.sqrt(est / 250)), 2, 8); }
  }
  if (state.k <= 1) return runFilterOnLayer(L, id, p, {preview:true});
  previewProxy(L, id, p, state.k);
}

/* ── extra_cmds.rs:64 map_pixels（平均、云彩、分层云彩）：选区外框∩画布（或画布）、按覆盖度混回、锁透明度就留 alpha ── */
function mapPixels(L, f){
  const canvas = R(0, 0, Doc.width, Doc.height), sel = selCoverage();
  const area = sel ? rInter(sel.bounds, canvas) : canvas;
  const lockAlpha = !!(L.locks && L.locks.transparency);
  if (rEmpty(area)) return;
  const surf = Surf.fromLayer(L), raw = surf.readRegion(area), N = RW(area) * RH(area), w = RW(area);
  const orig = []; for (let i = 0; i < N; i++) orig.push([raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2], raw[i * 4 + 3]]);
  const cover = new Float32Array(N); for (let i = 0; i < N; i++) cover[i] = sel ? sel.get(area.x0 + i % w, area.y0 + Math.floor(i / w)) : 1;
  const px = orig.map(q => q.slice());
  f(area, px, cover);
  for (let i = 0; i < N; i++){
    const k = cover[i]; if (k <= 0) continue;
    for (let c = 0; c < 4; c++) raw[i * 4 + c] = orig[i][c] + (px[i][c] - orig[i][c]) * k;
    if (lockAlpha) raw[i * 4 + 3] = orig[i][3];
  }
  surf.writeRegion(area, raw); surf.toLayer(L); Layer.invalidate(L);
}
/* extra_cmds.rs:188 average：选区（或图层）填成平均色（按 alpha×覆盖度加权） */
SURF_OPS['filter.blur.average'] = L => {
  mapPixels(L, (_, px, cover) => {
    const sum = [0, 0, 0]; let wsum = 0, asum = 0, n = 0;
    px.forEach((p, i) => { const k = cover[i], w = p[3] * k; for (let c = 0; c < 3; c++) sum[c] += p[c] * w; wsum += w; asum += p[3] * k; n += k; });
    if (wsum <= 0) return;
    const avg = [sum[0] / wsum, sum[1] / wsum, sum[2] / wsum, asum / Math.max(n, 1e-9)];
    px.forEach(p => { p[0] = avg[0]; p[1] = avg[1]; p[2] = avg[2]; p[3] = avg[3]; });
  });
  return {ok:true, layer:L.id};
};
function cloudHash(x, y, seed){                                    // extra_cmds.rs:208 hash
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(seed | 0, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0x00ffffff) / 0x00ffffff;
}
function cloudsValue(x, y, base, seed){                             // extra_cmds.rs:217 clouds_value（8 阶 fBm 值杂讯）
  let sum = 0, amp = 1, freq = 1 / base, norm = 0;
  for (let o = 0; o < 8; o++){
    const fx = x * freq, fy = y * freq, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), s = (seed + o * 7919) >>> 0;
    const top = cloudHash(ix, iy, s) + (cloudHash(ix + 1, iy, s) - cloudHash(ix, iy, s)) * sx;
    const bot = cloudHash(ix, iy + 1, s) + (cloudHash(ix + 1, iy + 1, s) - cloudHash(ix, iy + 1, s)) * sx;
    sum += (top + (bot - top) * sy) * amp; norm += amp; amp *= 0.5; freq *= 2;
  }
  return clamp((sum / norm - 0.5) * 2.2 + 0.5, 0, 1);
}
function cloudsOp(difference){                                      // extra_cmds.rs:237 clouds
  return (L, p) => {
    const fg = fgColor(), bg = bgColor(), seed = (typeof p.seed === 'number' ? Math.max(0, Math.floor(p.seed)) : 0) >>> 0;
    const base = clamp(Math.max(Doc.width, Doc.height) / 4, 16, 512);
    mapPixels(L, (area, px) => {
      const w = RW(area);
      px.forEach((q, i) => {
        const x = area.x0 + i % w, y = area.y0 + Math.floor(i / w), tt = cloudsValue(x, y, base, seed);
        const c = [0, 1, 2].map(k => fg[k] + (bg[k] - fg[k]) * tt);
        if (difference) for (let k = 0; k < 3; k++) q[k] = Math.abs(q[k] - c[k]);
        else { q[0] = c[0]; q[1] = c[1]; q[2] = c[2]; q[3] = 1; }
      });
    });
    return {ok:true, layer:L.id};
  };
}
SURF_OPS['filter.render.clouds'] = cloudsOp(false);
SURF_OPS['filter.render.differenceClouds'] = cloudsOp(true);

/* ──────────────── 段：80-cmds.js ──────────────── */
/* ═══════════ 对话框栏位（ui-egui/src/filter_dialog.rs:44 parse_spec：照命令参数表生成；三语照 PS 繁中／简中版正名） ═══════════ */
function parseSpec(spec){                                          // filter_dialog.rs:44
  const inner = String(spec).trim().replace(/^\{/, '').replace(/\}$/, '');
  const parts = []; let cur = '', inStr = false, depth = 0;
  for (const ch of inner){
    if (ch === '"') inStr = !inStr;
    if (!inStr){ if (ch === '[' || ch === '{') depth++; else if (ch === ']' || ch === '}') depth--; }
    if (ch === ',' && !inStr && depth === 0){ parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const out = [];
  for (const part of parts){
    const i = part.indexOf(':'); if (i < 0) continue;
    const key = part.slice(0, i).trim().replace(/^"|"$/g, ''), v = part.slice(i + 1).trim();
    if (!key || key === 'layer') continue;
    let kind;
    if (v.startsWith('"')) kind = {t:'choice', options:v.slice(1).split('"')[0].split('|')};
    else if (v.startsWith('bool')) kind = {t:'bool', d:v.replace(/^bool/, '').replace(/^=/, '').trim() === 'true'};
    else if (v === 'text') kind = {t:'text'};
    else if (v === 'doc') kind = {t:'doc'};
    else if (v === 'json' || v === 'color' || v.startsWith('[') || v.startsWith('{')) kind = {t:'json'};
    else if (/^int\[\d+\]$/.test(v)) kind = {t:'grid', n:+v.slice(4, -1)};
    else {
      const eq = v.indexOf('='), range = eq >= 0 ? v.slice(0, eq) : v, def = eq >= 0 ? v.slice(eq + 1).trim() : '';
      const dd = range.indexOf('..');
      if (dd >= 0){ const min = parseFloat(range.slice(0, dd)), max = parseFloat(range.slice(dd + 2)); const mn = isFinite(min) ? min : 0;
        kind = {t:'range', min:mn, max:isFinite(max) ? max : 100, d:isFinite(parseFloat(def)) ? parseFloat(def) : mn}; }
      else kind = {t:'int', d:isFinite(parseInt(def)) ? parseInt(def) : 0};
    }
    out.push(Object.assign({key}, kind));
  }
  return out;
}
const PIXEL_KEYS = ['radius', 'distance', 'cellSize', 'horizontal', 'vertical', 'height', 'wavelengthMin', 'wavelengthMax', 'amplitudeMin', 'amplitudeMax', 'maxRadius', 'size', 'blur'];   // filter_dialog.rs:110（路径模糊的 speed 改成 PS 的 %，像素量在 paths[].endSpeeds）
/* 栏位名（camelCase 键 → 三语）；没列到的照原码 label()：camelCase → "Camel Case" */
const FIELD = {
  radius:S('強度', '半径', 'Radius'), angle:S('角度', '角度', 'Angle'), distance:S('間距', '距离', 'Distance'), amount:S('總量', '数量', 'Amount'), method:S('模糊方式', '模糊方法', 'Blur Method'),
  centerX:S('中心 X', '中心 X', 'Center X'), centerY:S('中心 Y', '中心 Y', 'Center Y'), threshold:S('臨界值', '阈值', 'Threshold'), reduceNoise:S('減少雜訊', '减少杂色', 'Reduce Noise'),
  distribution:S('分佈', '分布', 'Distribution'), monochromatic:S('單色的', '单色', 'Monochromatic'), seed:S('隨機種子', '随机种子', 'Seed'), cellSize:S('儲存格大小', '单元格大小', 'Cell Size'),
  height:S('高度', '高度', 'Height'), mode:S('模式', '模式', 'Mode'), generators:S('產生器數目', '生成器数', 'Number of Generators'), wavelengthMin:S('波長 最小', '波长 最小', 'Wavelength Min'),
  wavelengthMax:S('波長 最大', '波长 最大', 'Wavelength Max'), amplitudeMin:S('振幅 最小', '波幅 最小', 'Amplitude Min'), amplitudeMax:S('振幅 最大', '波幅 最大', 'Amplitude Max'),
  type:S('類型', '类型', 'Type'), undefinedAreas:S('未定義區域', '未定义区域', 'Undefined Areas'), size:S('大小', '大小', 'Size'), preserve:S('保留', '保留', 'Preserve'),
  horizontal:S('水平', '水平', 'Horizontal'), vertical:S('垂直', '垂直', 'Vertical'), maxRadius:S('最大強度', '最大半径', 'Max. Radius'),
  channel1:S('色版 1', '通道 1', 'Channel 1'), channel2:S('色版 2', '通道 2', 'Channel 2'), channel3:S('色版 3', '通道 3', 'Channel 3'), channel4:S('色版 4', '通道 4', 'Channel 4'),
  depth:S('深度', '深度', 'Depth'), depthMode:S('深度方式', '深度方式', 'Depth Mode'), solidFrontFaces:S('立方體正面', '立方体正面', 'Solid Front Faces'), maskIncompleteBlocks:S('遮色片不完整區塊', '蒙版不完整块', 'Mask Incomplete Blocks'),
  stylization:S('風格化', '描边样式', 'Stylization'), cleanliness:S('清除', '描边清洁度', 'Cleanliness'), scale:S('縮放', '缩放', 'Scale'), bristleDetail:S('毛刷細節', '硬毛刷细节', 'Bristle Detail'),
  lighting:S('光源', '光照', 'Lighting'), shine:S('光澤', '闪亮', 'Shine'), count:S('拼貼數', '拼贴数', 'Number of Tiles'), maxOffset:S('最大位移', '最大位移', 'Maximum Offset'), fill:S('填滿空白區域', '填充空白区域用', 'Fill Empty Area With'),
  level:S('色階', '色阶', 'Level'), edge:S('邊緣', '边缘', 'Edge'), direction:S('方向', '方向', 'Direction'), fit:S('置換圖', '置换图', 'Displacement Map'), mapDocument:S('置換圖文件', '置换图文件', 'Map Document'),
  mapPath:S('置換圖路徑', '置换图路径', 'Map Path'), ridges:S('起伏', '起伏', 'Ridges'), style:S('樣式', '样式', 'Style'), variance:S('變異數', '差异', 'Variance'), strength:S('強度', '强度', 'Strength'),
  brightness:S('亮度', '亮度', 'Brightness'), lens:S('鏡頭類型', '镜头类型', 'Lens Type'), lightType:S('光源類型', '光照类型', 'Light Type'), intensity:S('強度', '强度', 'Intensity'),
  lightX:S('光源 X', '光源 X', 'Light X'), lightY:S('光源 Y', '光源 Y', 'Light Y'), lightZ:S('光源 Z', '光源 Z', 'Light Z'), targetX:S('目標 X', '目标 X', 'Target X'), targetY:S('目標 Y', '目标 Y', 'Target Y'),
  cone:S('光源角度', '聚光', 'Hotspot Cone'), hotspot:S('聚光', '着色', 'Hotspot'), elevation:S('高度', '高度', 'Elevation'), gloss:S('光澤', '光泽', 'Gloss'), metallic:S('金屬質感', '金属质感', 'Metallic'),
  exposure:S('曝光度', '曝光度', 'Exposure'), ambience:S('環境', '环境', 'Ambience'), texture:S('紋理', '纹理', 'Texture'), whiteIsHigh:S('白色為最高', '白色部分凸起', 'White is High'),
  preserveDetails:S('保留細節', '保留细节', 'Preserve Details'), reduceColorNoise:S('減少色彩雜訊', '减少杂色', 'Reduce Color Noise'), sharpenDetails:S('銳利化細節', '锐化细节', 'Sharpen Details'),
  removeJpegArtifact:S('移除 JPEG 不自然感', '移去 JPEG 不自然感', 'Remove JPEG Artifact'), quality:S('品質', '品质', 'Quality'), shape:S('形狀', '形状', 'Shape'), bladeCurvature:S('葉片彎度', '叶片弯度', 'Blade Curvature'),
  rotation:S('旋轉', '旋转', 'Rotation'), depthMap:S('深度對應來源', '深度映射源', 'Depth Map Source'), focalDistance:S('模糊焦距', '模糊焦距', 'Blur Focal Distance'), invert:S('負片效果', '反相', 'Invert'),
  noise:S('雜訊', '杂色', 'Noise'), blur:S('模糊', '模糊', 'Blur'), focus:S('焦點', '焦点', 'Focus'), transition:S('漸變', '渐隐', 'Transition'), radiusX:S('半徑 X', '半径 X', 'Radius X'), radiusY:S('半徑 Y', '半径 Y', 'Radius Y'),
  roundness:S('圓度', '圆度', 'Roundness'), feather:S('羽化', '羽化', 'Feather'), blurAngle:S('模糊角度', '模糊角度', 'Blur Angle'), speed:S('速度', '速度', 'Speed'), taper:S('錐度', '锥度', 'Taper'),
  startX:S('起點 X', '起点 X', 'Start X'), startY:S('起點 Y', '起点 Y', 'Start Y'), endX:S('終點 X', '终点 X', 'End X'), endY:S('終點 Y', '终点 Y', 'End Y'), kernel:S('自訂', '自定', 'Kernel'),
  offset:S('位移', '位移', 'Offset'), inputMode:S('輸入模式', '输入模式', 'Input Mode'), rowOrder:S('列順序', '行序', 'Row Order'), eliminate:S('消除', '消除', 'Eliminate'), createBy:S('建立新圖場的方式', '创建新场方式', 'Create New Fields By'),
  newLayer:S('新增圖層', '新建图层', 'New Layer')
};
const CHOICE = {
  spin:S('迴轉', '旋转', 'Spin'), zoom:S('縮放', '缩放', 'Zoom'), uniform:S('均勻', '平均分布', 'Uniform'), gaussian:S('高斯', '高斯分布', 'Gaussian'),
  normal:S('正常', '正常', 'Normal'), horizontalOnly:S('只限水平', '水平优先', 'Horizontal only'), verticalOnly:S('只限垂直', '垂直优先', 'Vertical only'),
  sine:S('正弦', '正弦', 'Sine'), triangle:S('三角形', '三角形', 'Triangle'), square:S('正方形', '方形', 'Square'), wrap:S('折回', '折回', 'Wrap Around'), repeat:S('重複邊緣像素', '重复边缘像素', 'Repeat Edge Pixels'),
  transparent:S('設定為透明', '设置为透明', 'Set to Transparent'), small:S('小', '小', 'Small'), medium:S('中', '中', 'Medium'), large:S('大', '大', 'Large'),
  rectangularToPolar:S('直角座標到極座標', '平面坐标到极坐标', 'Rectangular to Polar'), polarToRectangular:S('極座標到直角座標', '极坐标到平面坐标', 'Polar to Rectangular'),
  squareness:S('方形', '方形', 'Squareness'), roundness:S('圓度', '圆度', 'Roundness'),
  fineDots:S('細網點', '精细点', 'Fine Dots'), mediumDots:S('中網點', '中等点', 'Medium Dots'), grainyDots:S('粒狀網點', '粒状点', 'Grainy Dots'), coarseDots:S('粗網點', '粗网点', 'Coarse Dots'),
  shortLines:S('短線', '短直线', 'Short Lines'), mediumLines:S('中線', '中长直线', 'Medium Lines'), longLines:S('長線', '长直线', 'Long Lines'),
  shortStrokes:S('短筆觸', '短描边', 'Short Strokes'), mediumStrokes:S('中筆觸', '中长描边', 'Medium Strokes'), longStrokes:S('長筆觸', '长描边', 'Long Strokes'),
  darkenOnly:S('僅限變暗', '变暗优先', 'Darken Only'), lightenOnly:S('僅限變亮', '变亮优先', 'Lighten Only'), anisotropic:S('非等方向', '各向异性', 'Anisotropic'),
  blocks:S('區塊', '块', 'Blocks'), pyramids:S('金字塔', '金字塔', 'Pyramids'), random:S('隨機', '随机', 'Random'), levelBased:S('色階', '基于色阶', 'Level-based'),
  background:S('背景色', '背景色', 'Background Color'), foreground:S('前景色', '前景颜色', 'Foreground Color'), inverse:S('負片影像', '反向图像', 'Inverse Image'), unaltered:S('未修改影像', '未改变的图像', 'Unaltered Image'),
  lower:S('較低', '较低', 'Lower'), upper:S('較高', '较高', 'Upper'), wind:S('風', '风', 'Wind'), blast:S('強風', '大风', 'Blast'), stagger:S('交錯', '飓风', 'Stagger'),
  fromRight:S('從右邊', '从右', 'From the Right'), fromLeft:S('從左邊', '从左', 'From the Left'), stretch:S('延伸至適合大小', '伸展以适合', 'Stretch to Fit'), tile:S('拼貼', '拼贴', 'Tile'),
  pondRipples:S('池塘漣漪', '水池波纹', 'Pond Ripples'), outFromCenter:S('從中心向外', '从中心向外', 'Out From Center'), aroundCenter:S('環繞中心', '围绕中心', 'Around Center'),
  prime35:S('35 公釐定焦', '35 毫米聚焦', '35mm Prime'), prime105:S('105 公釐定焦', '105 毫米聚焦', '105mm Prime'), moviePrime:S('電影定焦', '电影镜头', 'Movie Prime'),
  spot:S('聚光燈', '聚光灯', 'Spot'), point:S('點光', '点光', 'Point'), infinite:S('無限光', '无限光', 'Infinite'),
  none:S('無', '无', 'None'), red:S('紅', '红', 'Red'), green:S('綠', '绿', 'Green'), blue:S('藍', '蓝', 'Blue'), alpha:S('Alpha', 'Alpha', 'Alpha'), luminance:S('明度', '明度', 'Luminance'),
  high:S('高', '高', 'High'), low:S('低', '低', 'Low'), edgeOnly:S('只限邊緣', '仅限边缘', 'Edge Only'), overlayEdge:S('覆蓋邊緣', '叠加边缘', 'Overlay Edge'),
  hexagon:S('六邊形', '六边形', 'Hexagon'), pentagon:S('五邊形', '五边形', 'Pentagon'), heptagon:S('七邊形', '七边形', 'Heptagon'), octagon:S('八邊形', '八边形', 'Octagon'),
  layerMask:S('圖層遮色片', '图层蒙版', 'Layer Mask'), circle:S('圓形', '圆形', 'Circle'), ring:S('圓環', '圆环', 'Ring'), diamond:S('菱形', '菱形', 'Diamond'),
  star:S('星形', '星形', 'Star'), heart:S('心形', '心形', 'Heart'), cross:S('十字', '十字', 'Cross'), rgb:S('RGB', 'RGB', 'RGB'), hsb:S('HSB', 'HSB', 'HSB'), hsl:S('HSL', 'HSL', 'HSL'),
  oddFields:S('奇數圖場', '奇数场', 'Odd Fields'), evenFields:S('偶數圖場', '偶数场', 'Even Fields'), interpolation:S('內插補點', '插值', 'Interpolation'), duplication:S('複製', '复制', 'Duplication')
};
const camelLabel = k => k.replace(/^./, c => c.toUpperCase()).replace(/([A-Z])/g, (m, c, i) => i ? ' ' + c : c);   // filter_dialog.rs:226 label
const fieldName = k => FIELD[k] ? tr(FIELD[k]) : camelLabel(k);
const choiceName = (key, v) => (key === 'fill' && v === 'background') ? tr(CHOICE.background) : CHOICE[v] ? tr(CHOICE[v]) : camelLabel(v);
const unitOf = (key, max) => PIXEL_KEYS.includes(key) ? 'px' : key === 'angle' ? '°' : (key === 'amount' && max <= 500) ? '%' : '';   // filter_dialog.rs:266
/* 菜单上的名字（对话框标题跟菜单同一个字） */
function menuName(id){
  let n = null;
  try { MenuTrees.walk('ps', it => { if (!n && it.id === id && it.n) n = it.n[Lang.cur] || it.n.en; }); } catch (_){}
  return (n || id).replace(/…$/, '');
}
/* filter_dialog.rs:169 open：栏位预设（Range 预设值、Choice 第一个、Bool 预设、Grid 中央 1；json 除前景背景外不显示） */
function specDefaults(id, init){
  const v = {};
  for (const f of parseSpec(specOf(id))){
    if (f.t === 'range') v[f.key] = f.d; else if (f.t === 'choice') v[f.key] = f.options[0]; else if (f.t === 'bool') v[f.key] = f.d; else if (f.t === 'int') v[f.key] = f.d;
    else if (f.t === 'text') v[f.key] = ''; else if (f.t === 'doc') v[f.key] = -1; else if (f.t === 'grid') v[f.key] = Array.from({length:f.n}, (_, i) => i === (f.n >> 1) ? 1 : 0);
    else if (f.t === 'json' && f.key === 'foreground') v[f.key] = fgColor(); else if (f.t === 'json' && f.key === 'background') v[f.key] = bgColor();
  }
  if (init) Object.keys(init).forEach(k => { if (init[k] !== undefined) v[k] = init[k]; });
  return v;
}
/* filter_dialog.rs:372 params_of：去掉对话框私用键；置换图文件「无」(-1)＝没给；Range 取到 0.1 */
function specParams(id, v){
  const out = {}, fields = parseSpec(specOf(id));
  Object.keys(v).forEach(k => {
    if (k.startsWith('__')) return;
    const f = fields.find(x => x.key === k), x = v[k];
    if (k === 'mapDocument' && x === -1) return;
    if (f && f.t === 'text' && !x) return;
    out[k] = f && f.t === 'range' && typeof x === 'number' ? Math.round(x * 10) / 10 : x;
  });
  return out;
}
/* filter_dialog.rs:251 body：照参数表一栏一栏画 */
function buildSpecFields(ui, id, v){
  for (const f of parseSpec(specOf(id))){
    const k = f.key, L = fieldName(k);
    if (f.t === 'range'){
      const log = f.min > 0 && f.max / f.min > 500, span = f.max - f.min;
      const step = span <= 2 ? 0.01 : span <= 20 ? 0.1 : (Number.isInteger(f.min) && Number.isInteger(f.max) && Number.isInteger(f.d) ? 1 : 0.1);
      ui.slider({k, label:L, min:f.min, max:f.max, step, log, unit:unitOf(k, f.max), get:() => v[k], set:x => { v[k] = x; }});
    } else if (f.t === 'choice') ui.select({k, label:L, options:f.options.map(o => [o, choiceName(k, o)]), get:() => v[k], set:x => { v[k] = x; }});
    else if (f.t === 'bool') ui.check({k, label:L, get:() => v[k], set:x => { v[k] = x; }});
    else if (f.t === 'int') ui.number({k, label:L, min:-30000, max:30000, step:1, get:() => v[k], set:x => { v[k] = Math.round(x); },
      after:k === 'seed' ? [ui.button(t('randomize'), () => { v[k] = Math.floor(Math.random() * 100000); Dlg.changed(true); }, 'seedRandom')] : []});
    else if (f.t === 'text') ui.text({k, label:L, get:() => v[k] || '', set:x => { v[k] = x; }});
    else if (f.t === 'doc'){
      const none = id === 'filter.distort.displace' ? (v.mapFile ? tr(UI_STR.mapFile) + v.mapFile : tr(UI_STR.pickMap)) : t('none');   // 置换：「无」＝确定后选文件
      ui.select({k, label:L, options:[[-1, none], [0, t('thisDoc')]], get:() => v[k], set:x => { v[k] = +x; }, rebuild:true});
      if (id === 'filter.distort.displace'){                        // 我们只有一份文件：再给一栏挑哪一层当置换图（原码 mapLayer 是 json、对话框不显示）
        const opts = [['', t('merged')]].concat([...Doc.layers].reverse().map(Lr => [Lr.id, Lr.name]));
        ui.select({k:'mapLayer', label:tr(UI_STR.mapLayer), options:opts, get:() => v.mapLayer === undefined ? '' : v.mapLayer, set:x => { if (x === '') delete v.mapLayer; else v.mapLayer = x; }, disabled:v[k] !== 0});
      }
    } else if (f.t === 'grid'){
      const side = Math.max(1, Math.round(Math.sqrt(f.n)));
      ui.sec(L);
      const g = el('div', {className:'grid', style:'grid-template-columns:repeat(' + side + ',48px)'});
      for (let i = 0; i < f.n; i++){
        const n = el('input', {type:'number', min:-999, max:999, step:1, value:String(Math.round((v[k] || [])[i] || 0)), data:{k:k + i}});
        n.addEventListener('input', () => { const x = Number(n.value); if (isFinite(x)){ v[k] = (v[k] || []).slice(); v[k][i] = clamp(Math.round(x), -999, 999); Dlg.changed(); } });
        g.appendChild(n);
      }
      ui.add(g);
    }
  }
}
function openSpecDialog(id, init, extra){
  return Dlg.open(Object.assign({id, v:specDefaults(id, init), build(ui, v){ buildSpecFields(ui, id, v); }, params:v => specParams(id, v)}, id === 'filter.distort.displace' ? {beforeRun:displaceBeforeRun} : {}, extra || {}));
}

/* ═══════════ 场景模糊：在画布上点图钉（照 PS 2020 模糊画廊；原码 filter_dialog.rs:32 的 pins 只给命令、对话框不显示） ═══════════
   对话框开着时：点画布空白处＝加一个图钉（模糊量＝目前选中图钉的值）、点图钉＝选它、拖图钉＝移动；Delete＝删选中的图钉。
   图钉坐标 x/y 是 0..1、相对「有选区＝选区外框，没选区＝画布」（同 KERNELS.fieldBlur 的 ctx.bounds）。 */
const FB_ID = 'filter.blurGallery.fieldBlur';
const fbL3 = (a, b, c) => Lang.cur === 'en' ? c : Lang.cur === 'zh-Hans' ? b : a;
function fbBounds(){ const s = Doc.sel; return s && s.w > 0 && s.h > 0 ? [s.x, s.y, s.w, s.h] : [0, 0, Doc.width, Doc.height]; }
function fbOverlay(ctx, s){
  const c = Dlg.cur; if (!c || c.o.id !== FB_ID) return;
  const [bx, by, bw, bh] = fbBounds();
  c.v.pins.forEach((q, i) => {
    const X = (bx + q.x * bw) * s, Y = (by + q.y * bh) * s, on = i === c.v.sel;
    ctx.save();
    ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(X, Y, 11, 0, 7); ctx.stroke();
    ctx.lineWidth = on ? 2 : 1.2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Y, 11, 0, 7); ctx.stroke();
    // 外圈弧长＝模糊量（PS 图钉外圈那段白弧）
    ctx.lineWidth = 3; ctx.strokeStyle = on ? '#ffd24a' : '#ddd'; ctx.beginPath(); ctx.arc(X, Y, 16, -Math.PI / 2, -Math.PI / 2 + Math.min(1, q.blur / 100) * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = on ? '#ffd24a' : '#fff'; ctx.beginPath(); ctx.arc(X, Y, 3, 0, 7); ctx.fill();
    ctx.restore();
  });
}
CUSTOM_DIALOGS[FB_ID] = init => {
  const i0 = init || {};
  let pins = Array.isArray(i0.pins) ? i0.pins.map(q => ({x:clamp(+q.x || 0, 0, 1), y:clamp(+q.y || 0, 0, 1), blur:clamp(isFinite(+q.blur) ? +q.blur : 15, 0, 500)})) : [];
  if (!pins.length) pins = [{x:isFinite(+i0.centerX) ? clamp(+i0.centerX, 0, 1) : 0.5, y:isFinite(+i0.centerY) ? clamp(+i0.centerY, 0, 1) : 0.5, blur:isFinite(+i0.blur) ? clamp(+i0.blur, 0, 500) : 15}];
  const v = {pins, sel:pins.length - 1};
  const box = Dlg.open({id:FB_ID, v, build(ui, v){
    ui.note(fbL3('在畫面上按一下＝加圖釘；拖曳圖釘＝移動；Delete＝刪除選取的圖釘', '在画面上点一下＝加图钉；拖动图钉＝移动；Delete＝删除选中的图钉', 'Click the image to add a pin · drag a pin to move it · Delete removes the selected pin'));
    const q = v.pins[v.sel];
    if (q) ui.slider({k:'blur', label:fbL3('模糊', '模糊', 'Blur'), min:0, max:500, step:1, unit:'px', get:() => q.blur, set:x => { q.blur = x; if (window.UI) UI.draw(); }});
    const list = el('div', {className:'row'}, []);
    v.pins.forEach((p, i) => list.appendChild(el('button', {type:'button', className:i === v.sel ? 'pri' : '', data:{k:'pin' + i}, onclick:() => { v.sel = i; Dlg.changed(true); if (window.UI) UI.draw(); }}, [fbL3('圖釘 ', '图钉 ', 'Pin ') + (i + 1) + ' · ' + Math.round(p.blur) + 'px'])));
    ui.add(list);
    ui.add(el('div', {className:'row'}, [ui.button(fbL3('移去所有圖釘', '移去所有图钉', 'Remove All Pins'), () => { v.pins.length = 0; v.sel = -1; Dlg.changed(true); if (window.UI) UI.draw(); }, 'removeAll'),
      ui.button(fbL3('刪除圖釘', '删除图钉', 'Delete Pin'), () => fbDelete(v), 'deletePin')]));
  }, params:v => ({pins:v.pins.length ? v.pins.map(q => ({x:+q.x.toFixed(5), y:+q.y.toFixed(5), blur:q.blur})) : [{x:0.5, y:0.5, blur:0}]}),   // 没图钉＝不模糊（PS）
  onClose(){ if (window.UI) UI.draw(); }});
  const c = Dlg.cur, bg = c && c.bg;
  if (bg){
    // 画布在对话框的透明底下：底层接滑鼠 → 文件坐标
    const toDoc = e => { const r = UI.canvas.getBoundingClientRect(); return [(e.clientX - r.left) / UI.zoom, (e.clientY - r.top) / UI.zoom]; };
    const hit = (e) => { const [bx, by, bw, bh] = fbBounds(), p = toDoc(e); let best = -1, bd = 14 / UI.zoom;
      v.pins.forEach((q, i) => { const d = Math.hypot(bx + q.x * bw - p[0], by + q.y * bh - p[1]); if (d <= bd){ bd = d; best = i; } }); return best; };
    let drag = -1;
    bg.addEventListener('pointerdown', e => {
      const [bx, by, bw, bh] = fbBounds(), p = toDoc(e);
      if (p[0] < 0 || p[1] < 0 || p[0] > Doc.width || p[1] > Doc.height) return;
      let i = hit(e);
      if (i < 0){
        const cur = v.pins[v.sel];
        v.pins.push({x:clamp((p[0] - bx) / bw, 0, 1), y:clamp((p[1] - by) / bh, 0, 1), blur:cur ? cur.blur : 15});
        i = v.pins.length - 1;
      }
      v.sel = i; drag = i;
      try { bg.setPointerCapture(e.pointerId); } catch (_){}
      c.box.tabIndex = -1; c.box.focus({preventScroll:true});           // 焦点留在对话框：Delete 删图钉、Enter 确定
      Dlg.changed(true); UI.draw(); e.preventDefault();
    });
    bg.addEventListener('pointermove', e => {
      if (drag < 0 || !v.pins[drag]) return;
      const [bx, by, bw, bh] = fbBounds(), p = toDoc(e);
      v.pins[drag].x = clamp((p[0] - bx) / bw, 0, 1); v.pins[drag].y = clamp((p[1] - by) / bh, 0, 1);
      UI.draw();
    });
    bg.addEventListener('pointerup', () => { if (drag >= 0){ drag = -1; Dlg.changed(); } });
    c.box.addEventListener('keydown', e => { if ((e.key === 'Delete' || e.key === 'Backspace') && !/input|textarea/i.test(e.target.tagName)){ e.preventDefault(); fbDelete(v); } }, true);
  }
  if (window.UI && !UI.__fbPins){ UI.__fbPins = true; UI.overlays.push(fbOverlay); }
  if (window.UI) UI.draw();
  return box;
};
function fbDelete(v){ if (v.sel < 0 || !v.pins[v.sel]) return; v.pins.splice(v.sel, 1); v.sel = v.pins.length - 1; Dlg.changed(true); if (window.UI) UI.draw(); }

/* ═══════════ 路径模糊：在画布上编辑模糊路径（照 PS 2020 模糊画廊▸路径模糊） ═══════════
   拖点＝移动；按在路径线上＝加一个曲线点（接着可拖）；空白处拖一下＝新的一条路径（起点→终点），空白处点一下＝开始新路径、
   再点＝一点点接下去、双击＝结束；Delete＝删选中的点（剩不到两点就整条删掉）。
   右边面板＝PS「模糊工具▸路径模糊」：基本模糊／后帘同步闪光、速度（0～500%）、锥度、居中模糊、终点速度（选中端点才能改）。
   点坐标 0..1 相对「有选区＝选区外框，没选区＝画布」（同 KERNELS.pathBlur 的 ctx.bounds）。 */
const PB_ID = 'filter.blurGallery.pathBlur';
function pbOverlay(ctx, s){
  const c = Dlg.cur; if (!c || c.o.id !== PB_ID) return;
  const [bx, by, bw, bh] = fbBounds(), v = c.v;
  v.paths.forEach((q, pi) => {
    const P = q.points.map(p => [(bx + p[0] * bw) * s, (by + p[1] * bh) * s]), C = pbCurve(P, 16);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (C.length > 1){
      [[3.5, 'rgba(0,0,0,.55)'], [1.6, '#a9c4ff']].forEach(([lw, st]) => { ctx.lineWidth = lw; ctx.strokeStyle = st; ctx.beginPath(); C.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); });
      const e = C[C.length - 1], f = C[Math.max(0, C.length - 3)], a = Math.atan2(e[1] - f[1], e[0] - f[0]);   // 终点箭头
      ctx.fillStyle = '#a9c4ff'; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(e[0] + Math.cos(a) * 9, e[1] + Math.sin(a) * 9); ctx.lineTo(e[0] + Math.cos(a + 2.5) * 8, e[1] + Math.sin(a + 2.5) * 8); ctx.lineTo(e[0] + Math.cos(a - 2.5) * 8, e[1] + Math.sin(a - 2.5) * 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    P.forEach((p, i) => {
      const on = v.sel && v.sel.p === pi && v.sel.i === i, end = i === 0 || i === P.length - 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#2a5bd7'; ctx.fillStyle = on ? '#2a5bd7' : '#fff';
      ctx.beginPath(); ctx.arc(p[0], p[1], end ? 5 : 4, 0, 7); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  });
}
CUSTOM_DIALOGS[PB_ID] = init => {
  const i0 = init || {}, es0 = pbEndSpeed0(), nb = (x, d) => typeof x === 'number' && isFinite(x) ? x : d;
  let paths = Array.isArray(i0.paths) ? i0.paths.filter(q => q && Array.isArray(q.points)).map(q => {
    const pts = q.points.map(pt2).filter(x => x).map(p => [clamp(p[0], -1, 2), clamp(p[1], -1, 2)]), es = Array.isArray(q.endSpeeds) ? q.endSpeeds : [];
    return {points:pts, endSpeeds:[nb(es[0], es0), nb(es[1], nb(es[0], es0))]}; }).filter(q => q.points.length >= 2) : [];
  if (!paths.length) paths = [{points:[[nb(i0.startX, PATH0.points[0][0]), nb(i0.startY, PATH0.points[0][1])], [nb(i0.endX, PATH0.points[1][0]), nb(i0.endY, PATH0.points[1][1])]], endSpeeds:[es0, es0]}];
  const v = {speed:clamp(nb(i0.speed, 50), 0, 500), taper:clamp(nb(i0.taper, 0), 0, 100), centered:i0.centered !== false, mode:i0.mode === 'rearSync' ? 'rearSync' : 'basic', paths, sel:null, build:-1};
  const selEnd = () => { const s = v.sel, q = s && v.paths[s.p]; return q && (s.i === 0 || s.i === q.points.length - 1) ? (s.i === 0 ? 0 : 1) : -1; };
  const box = Dlg.open({id:PB_ID, v, title:fbL3('模糊工具 ▸ 路徑模糊', '模糊工具 ▸ 路径模糊', 'Blur Tools ▸ Path Blur'), build(ui, v){
    ui.note(fbL3('拖曳路徑上的點＝調整走向；按路徑線＝加曲線點；空白處拖曳＝新增一條路徑（按一下＝逐點建立、按兩下結束）；Delete＝刪除選取的點',
      '拖动路径上的点＝调整走向；点路径线＝加曲线点；空白处拖动＝新建一条路径（点一下＝逐点建立、双击结束）；Delete＝删除选中的点',
      'Drag path points to steer · click the path to add a curve point · drag on empty canvas for a new path (click to add points, double-click to finish) · Delete removes the selected point'));
    ui.sec(fbL3('路徑模糊', '路径模糊', 'Path Blur'));
    ui.select({k:'mode', label:'', options:[['basic', fbL3('基本模糊', '基本模糊', 'Basic Blur')], ['rearSync', fbL3('後簾同步閃光', '后帘同步闪光', 'Rear Sync Flash')]], get:() => v.mode, set:x => { v.mode = x; }});
    ui.slider({k:'speed', label:fbL3('速度', '速度', 'Speed'), min:0, max:500, step:1, unit:'%', get:() => v.speed, set:x => { v.speed = x; }});
    ui.slider({k:'taper', label:fbL3('錐度', '锥度', 'Taper'), min:0, max:100, step:1, unit:'%', get:() => v.taper, set:x => { v.taper = x; }});
    ui.check({k:'centered', label:fbL3('居中模糊', '居中模糊', 'Centered Blur'), get:() => v.centered, set:x => { v.centered = x; }});
    const e = selEnd(), q = e >= 0 ? v.paths[v.sel.p] : null;
    ui.slider({k:'endSpeed', label:fbL3('終點速度', '终点速度', 'End Point Speed'), min:0, max:2000, step:1, unit:'px', get:() => q ? q.endSpeeds[e] : es0, set:x => { if (q) q.endSpeeds[e] = x; }});
    if (!q) ui.root.querySelectorAll('[data-k=endSpeed]').forEach(n => { n.disabled = true; });   // PS：没选端点时灰着
    ui.add(el('div', {className:'row'}, [ui.button(fbL3('刪除點', '删除点', 'Delete Point'), () => pbDelete(v), 'deletePoint'),
      ui.button(fbL3('移去所有路徑', '移去所有路径', 'Remove All Paths'), () => { v.paths.length = 0; v.sel = null; v.build = -1; Dlg.changed(true); if (window.UI) UI.draw(); }, 'removeAll')]));
    ui.note(fbL3('路徑 ', '路径 ', 'Paths: ') + v.paths.length + ' · ' + fbL3('點 ', '点 ', 'points: ') + v.paths.map(p => p.points.length).join('/'));
  }, params:v => {
    const ps = v.paths.filter(q => q.points.length >= 2).map(q => ({points:q.points.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]), endSpeeds:q.endSpeeds.slice()}));
    return {speed:v.speed, taper:v.taper, centered:v.centered, mode:v.mode, paths:ps.length ? ps : [{points:[[0, 0], [1, 0]], speed:0}]};   // 没路径＝不模糊（PS）
  }, onClose(){ if (window.UI) UI.draw(); }});
  const c = Dlg.cur, bg = c && c.bg;
  if (bg){
    const toDoc = e => { const r = UI.canvas.getBoundingClientRect(); return [(e.clientX - r.left) / UI.zoom, (e.clientY - r.top) / UI.zoom]; };
    const norm = p => { const [bx, by, bw, bh] = fbBounds(); return [(p[0] - bx) / bw, (p[1] - by) / bh]; };
    const docPt = q => { const [bx, by, bw, bh] = fbBounds(); return [bx + q[0] * bw, by + q[1] * bh]; };
    const hitPoint = p => { let best = null, bd = 9 / UI.zoom;
      v.paths.forEach((q, pi) => q.points.forEach((pt, i) => { const d = docPt(pt), dd = Math.hypot(d[0] - p[0], d[1] - p[1]); if (dd <= bd){ bd = dd; best = {p:pi, i}; } })); return best; };
    const hitCurve = p => { let best = null, bd = 6 / UI.zoom;                       // 按在线上：插在哪两个控制点之间
      v.paths.forEach((q, pi) => { const P = q.points.map(docPt);
        for (let k = 0; k + 1 < P.length; k++){ const C = pbCurve(P.slice(Math.max(0, k - 1), k + 3), 16), off = k > 0 ? 16 : 0;
          for (let j = off; j < off + (P.length < 3 ? 1 : 16) && j + 1 < C.length; j++){
            const a = C[j], b = C[j + 1], sx = b[0] - a[0], sy = b[1] - a[1], l2 = sx * sx + sy * sy || 1, t = clamp(((p[0] - a[0]) * sx + (p[1] - a[1]) * sy) / l2, 0, 1);
            const d = Math.hypot(p[0] - a[0] - sx * t, p[1] - a[1] - sy * t); if (d < bd){ bd = d; best = {p:pi, k}; } } } });
      return best; };
    let drag = null, fresh = null;
    bg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const p = toDoc(e);
      if (p[0] < 0 || p[1] < 0 || p[0] > Doc.width || p[1] > Doc.height) return;
      let h = hitPoint(p);
      if (h){ if (v.build >= 0 && h.p !== v.build) v.build = -1; }
      else {
        const hc = v.build < 0 && hitCurve(p);
        if (hc){ v.paths[hc.p].points.splice(hc.k + 1, 0, norm(p)); h = {p:hc.p, i:hc.k + 1}; }
        else if (v.build >= 0 && v.paths[v.build]){ const q = v.paths[v.build]; q.points.push(norm(p)); h = {p:v.build, i:q.points.length - 1}; }
        else { v.paths.push({points:[norm(p)], endSpeeds:[es0, es0]}); h = {p:v.paths.length - 1, i:0}; fresh = {p:h.p, at:p}; }
      }
      v.sel = h; drag = h;
      try { bg.setPointerCapture(e.pointerId); } catch (_){}
      c.box.tabIndex = -1; c.box.focus({preventScroll:true});           // 焦点留在对话框：Delete 删点、Enter 确定
      Dlg.render(); UI.draw(); e.preventDefault();
    });
    bg.addEventListener('pointermove', e => {
      if (!drag || !v.paths[drag.p]) return;
      const p = toDoc(e), q = v.paths[drag.p];
      if (fresh && fresh.p === drag.p && q.points.length === 1){              // 空白处拖：拉出第二个点（终点）
        if (Math.hypot(p[0] - fresh.at[0], p[1] - fresh.at[1]) * UI.zoom < 4) return;
        q.points.push(norm(p)); drag = v.sel = {p:drag.p, i:1}; fresh = null;
      }
      q.points[drag.i] = norm(p);
      UI.draw();
    });
    bg.addEventListener('pointerup', () => {
      if (!drag) return;
      const q = v.paths[drag.p];
      if (fresh && q && q.points.length === 1) v.build = drag.p;            // 点一下没拖＝开始逐点建立
      else if (fresh) v.build = -1;
      drag = null; fresh = null; Dlg.changed(true); UI.draw();
    });
    bg.addEventListener('dblclick', () => { pbFinish(v); Dlg.changed(true); UI.draw(); });
    c.box.addEventListener('keydown', e => { if ((e.key === 'Delete' || e.key === 'Backspace') && !/input|textarea|select/i.test(e.target.tagName)){ e.preventDefault(); pbDelete(v); } }, true);
  }
  if (window.UI && !UI.__pbPaths){ UI.__pbPaths = true; UI.overlays.push(pbOverlay); }
  if (window.UI) UI.draw();
  return box;
};
/* 结束逐点建立：只有一个点的那条丢掉 */
function pbFinish(v){ if (v.build >= 0 && v.paths[v.build] && v.paths[v.build].points.length < 2){ v.paths.splice(v.build, 1); v.sel = null; } v.build = -1; }
function pbDelete(v){
  const s = v.sel, q = s && v.paths[s.p]; if (!q) return;
  q.points.splice(s.i, 1);
  if (q.points.length < 2 && !(v.build === s.p && q.points.length === 1)){ v.paths.splice(s.p, 1); if (v.build === s.p) v.build = -1; else if (v.build > s.p) v.build--; v.sel = null; }
  else v.sel = {p:s.p, i:Math.min(s.i, q.points.length - 1)};
  Dlg.changed(true); if (window.UI) UI.draw();
}

/* ═══════════ 命令登记（ps.<原码 id>；带「…」的项＝{dialog:true} 开对话框，其余参数＝直接做、一步历史） ═══════════ */
/* 菜单「滤镜」里每一个原码 id（menu_catalog.rs 的 Filter 菜单） */
const MENU_IDS = [
  'filter.lastFilter', 'filter.filterGallery', 'filter.cameraRaw', 'filter.adaptiveWideAngle', 'filter.lensCorrection', 'filter.liquify', 'filter.vanishingPoint',
  'filter.blur.average', 'filter.blur.blur', 'filter.blur.blurMore', 'filter.blur.boxBlur', 'filter.blur.gaussianBlur', 'filter.blur.lensBlur', 'filter.blur.motionBlur', 'filter.blur.radialBlur',
  'filter.blur.shapeBlur', 'filter.blur.smartBlur', 'filter.blur.surfaceBlur',
  'filter.blurGallery.fieldBlur', 'filter.blurGallery.irisBlur', 'filter.blurGallery.tiltShift', 'filter.blurGallery.pathBlur', 'filter.blurGallery.spinBlur',
  'filter.distort.displace', 'filter.distort.pinch', 'filter.distort.polarCoordinates', 'filter.distort.ripple', 'filter.distort.shear', 'filter.distort.spherize', 'filter.distort.twirl', 'filter.distort.wave', 'filter.distort.zigZag',
  'filter.noise.addNoise', 'filter.noise.despeckle', 'filter.noise.dustAndScratches', 'filter.noise.median', 'filter.noise.reduceNoise',
  'filter.pixelate.colorHalftone', 'filter.pixelate.crystallize', 'filter.pixelate.facet', 'filter.pixelate.fragment', 'filter.pixelate.mezzotint', 'filter.pixelate.mosaic', 'filter.pixelate.pointillize',
  'filter.render.flame', 'filter.render.pictureFrame', 'filter.render.tree', 'filter.render.clouds', 'filter.render.differenceClouds', 'filter.render.fibers', 'filter.render.lensFlare', 'filter.render.lightingEffects',
  'filter.sharpen.sharpen', 'filter.sharpen.sharpenEdges', 'filter.sharpen.sharpenMore', 'filter.sharpen.smartSharpen', 'filter.sharpen.unsharpMask',
  'filter.stylize.diffuse', 'filter.stylize.emboss', 'filter.stylize.extrude', 'filter.stylize.findEdges', 'filter.stylize.oilPaint', 'filter.stylize.solarize', 'filter.stylize.tiles', 'filter.stylize.traceContour', 'filter.stylize.wind',
  'filter.video.deInterlace', 'filter.video.ntscColors',
  'filter.other.custom', 'filter.other.hsbHsl', 'filter.other.highPass', 'filter.other.maximum', 'filter.other.minimum', 'filter.other.offset'
];
/* 菜单项名字带「…」＝开对话框（PS 惯例；原码 has_dialog 是「参数表非空」，云彩只有 seed 但菜单不带「…」⇒ 照菜单直接做） */
const DIALOG_IDS = new Set(['filter.filterGallery', 'filter.cameraRaw', 'filter.adaptiveWideAngle', 'filter.lensCorrection', 'filter.liquify', 'filter.vanishingPoint',
  'filter.blur.boxBlur', 'filter.blur.gaussianBlur', 'filter.blur.lensBlur', 'filter.blur.motionBlur', 'filter.blur.radialBlur', 'filter.blur.shapeBlur', 'filter.blur.smartBlur', 'filter.blur.surfaceBlur',
  'filter.blurGallery.fieldBlur', 'filter.blurGallery.irisBlur', 'filter.blurGallery.tiltShift', 'filter.blurGallery.pathBlur', 'filter.blurGallery.spinBlur',
  'filter.distort.displace', 'filter.distort.pinch', 'filter.distort.polarCoordinates', 'filter.distort.ripple', 'filter.distort.shear', 'filter.distort.spherize', 'filter.distort.twirl', 'filter.distort.wave', 'filter.distort.zigZag',
  'filter.noise.addNoise', 'filter.noise.dustAndScratches', 'filter.noise.median', 'filter.noise.reduceNoise',
  'filter.pixelate.colorHalftone', 'filter.pixelate.crystallize', 'filter.pixelate.mezzotint', 'filter.pixelate.mosaic', 'filter.pixelate.pointillize',
  'filter.render.flame', 'filter.render.pictureFrame', 'filter.render.tree', 'filter.render.fibers', 'filter.render.lensFlare', 'filter.render.lightingEffects',
  'filter.sharpen.smartSharpen', 'filter.sharpen.unsharpMask',
  'filter.stylize.diffuse', 'filter.stylize.emboss', 'filter.stylize.extrude', 'filter.stylize.oilPaint', 'filter.stylize.tiles', 'filter.stylize.traceContour', 'filter.stylize.wind',
  'filter.video.deInterlace', 'filter.other.custom', 'filter.other.highPass', 'filter.other.maximum', 'filter.other.minimum', 'filter.other.offset']);
/* 不必有现成像素层的（render_cmds.rs：没有像素层就自己新建一层） */
const NEW_LAYER_OK = new Set(['filter.render.flame', 'filter.render.pictureFrame', 'filter.render.tree']);
/* filters.rs:329 last_filter：最近一次「params_for 认得」的 filter.* 命令（平均、云彩、液化、镜头校正、火焰…这些原码不算） */
const Last = {id:null, params:null};
const repeatable = id => id.startsWith('filter.') && id !== 'filter.lastFilter' && !SURF_OPS[id] && !!paramsFor(id, null);
function setLast(id, p){
  Last.id = id; Last.params = JSON.parse(JSON.stringify(p || {}));
  try {                                                             // 菜单上「上次滤镜」显示那个滤镜的名字（PS 是这样）
    MenuTrees.walk('ps', it => { if (it.id === 'filter.lastFilter'){ if (!it._n0) it._n0 = it.n; const nm = {}; ['zh-Hant', 'zh-Hans', 'en'].forEach(lg => { let s = null; MenuTrees.walk('ps', q => { if (!s && q.id === id && q.n) s = (q.n[lg] || q.n.en).replace(/…$/, ''); }); nm[lg] = it._n0[lg] + (s ? (lg === 'en' ? ' (' + s + ')' : '（' + s + '）') : ''); }); it.n = nm; } });
  } catch (_){}
}
function runCommand(id, p){
  p = p || {};
  if (id === 'filter.filterGallery'){                                // gallery_cmds.rs:105 run_gallery：list＝回目录；effects 空＝报错
    if (p.list === true && typeof AG_CATALOGUE === 'function') return Object.assign({ok:true}, AG_CATALOGUE());
    if (typeof ag_validate === 'function') try { ag_validate(p); } catch (e){ if (e instanceof FltBad) return {ok:false, error:e.message}; throw e; }
  }
  History.push();
  let r;
  try {
    let L = null;
    if (NEW_LAYER_OK.has(id)){ const A = (p.layer !== undefined && p.layer !== null) ? Doc.byId(p.layer) : Doc.active(); L = A && A.kind === 'raster' && !lockMsg(A) ? A : null; }
    else L = targetLayer(p, id);
    r = runFilterOnLayer(L, id, p, {preview:false});
  } catch (e){
    History.restoreInPlace(History.past.pop());
    if (e instanceof FltBad) return {ok:false, error:e.message};
    throw e;
  }
  if (r && r.ok === false){ History.restoreInPlace(History.past.pop()); return r; }
  if (r && r.changed === false) History.past.pop();                 // 没改到东西（液化没笔画等）不留空的一步（distort_cmds.rs:274）
  if (repeatable(id)) setLast(id, p);
  return Object.assign({ok:true}, r);
}
function openDialog(id, init, extra){
  if (CUSTOM_DIALOGS[id]){ CUSTOM_DIALOGS[id](init || {}, extra); if (extra && Dlg.cur && Dlg.cur.o.id === id){ Object.assign(Dlg.cur.o, extra); Dlg.runPreview(); } }
  else openSpecDialog(id, init || {}, extra);
  return {ok:true, dialog:'opened'};
}
/* 智能滤镜重开（照 PS：图层面板双击滤镜名＝用原参数重开那个滤镜的对话框，确定＝改参数、取消＝不动） */
function editSmartFilter(L, index){
  const f = L && L.kind === 'smart' && L.data && (L.data.filters || [])[index];
  if (!f) return {ok:false, error:'no such smart filter'};
  const id = String(f.command || '');
  if (!id.startsWith('filter.') || !CMD.map['ps.' + id]) return {ok:false, error:'this smart filter has no dialog: ' + id};
  if (Doc.activeId !== L.id) Doc.activeId = L.id;
  const r = openDialog(id, JSON.parse(JSON.stringify(f.params || {})), {sfEdit:{id:L.id, index}});
  // 重开的初值按栏位的 step 取整（存的是 4，栏位就显示 4，不要 4.00003 这种浮点尾巴）
  const c = Dlg.cur;
  if (c && c.o.sfEdit && c.v){
    let changed = false;
    Object.keys(c.v).forEach(k => {
      const x = c.v[k]; if (typeof x !== 'number' || !isFinite(x)) return;
      const inp = c.box.querySelector(`input[type=number][data-k="${k}"]`), st = inp ? parseFloat(inp.step) : NaN;
      const y = isFinite(st) && st > 0 ? +(Math.round(x / st) * st).toFixed(Math.max(0, Math.ceil(-Math.log10(st) - 1e-9))) : +x.toFixed(4);
      if (y !== x){ c.v[k] = y; changed = true; }
    });
    if (changed) Dlg.changed(true);
  }
  return r;
}
function registerAll(){
  for (const id of MENU_IDS){
    if (id === 'filter.lastFilter') continue;
    if (!SURF_OPS[id]){ const fp = paramsFor(id, {}); if (!fp || !KERNELS[fp.filter]) continue; }   // 没有实作的不登记（菜单就灰着）
    const spec = specOf(id), dlg = DIALOG_IDS.has(id);
    const note = '；作用在目前像素层（或 layer:图层 id），有选区＝按覆盖度只改选区内；一步历史（Ctrl+Z 可退）';
    CMD.reg('ps.' + id, {i18n:'', history:true, undoable:false, params:spec + note + (dlg ? '｜{dialog:true}＝开对话框（同点菜单；其余键当栏位初值）' : '')},
      p => { p = p || {}; if (p.dialog){ const q = Object.assign({}, p); delete q.dialog; return openDialog(id, q); } return runCommand(id, p); });
  }
  /* filters.rs:309 filter.lastFilter：用同一组参数再跑一次最近的滤镜 */
  CMD.reg('ps.filter.lastFilter', {i18n:'', undoable:false, params:'{} 用同一组参数再跑一次最近套用的滤镜（filters.rs:329：只算参数式滤镜；液化、镜头校正、火焰、云彩等不算）→ {ok, filter, …}；还没用过 ⇒ {ok:false}'},
    () => Last.id ? Object.assign(runCommand(Last.id, Last.params), {repeated:Last.id}) : {ok:false, error:t('noLast')});
  /* 滤镜库目录（gallery_cmds.rs:97 catalogue；agent 用） */
  if (typeof AG_CATALOGUE === 'function') CMD.reg('ps.filter.filterGallery.list', {i18n:'', undoable:false, params:'{} 滤镜库的分类、效果与参数说明（gallery_cmds.rs catalogue）'}, () => AG_CATALOGUE());
  /* 滤镜库「纹理 ▸ 载入纹理…」（玻璃／纹理化／粗糙蜡笔／底纹效果／炭精笔） */
  CMD.reg('ps.filterGallery.loadTexture', {i18n:'', undoable:false, params:'{url:网址|dataURL（.psd 取合成图；也认 png/jpg）, name?} 或 {ui:true}＝开文件挑选器；读成灰阶高度图（透明垫白），从文件左上角平铺 → {textureKey, textureFile, width, height}；之后滤镜库参数带 textureKey 就用这张（取代 texture 下拉）'},
    async p => {
      p = p || {};
      if (p.ui || (!p.url && !p.file && !p.files)){ const fs = await PsFile.pickFiles('.psd,image/*', false); if (!fs || !fs.length) return {ok:false, cancelled:true}; p = Object.assign({}, p, {file:fs[0]}); }
      try { return Object.assign({ok:true}, await ag_loadTexture(p)); } catch (e){ if (e instanceof FltBad) return {ok:false, error:e.message}; throw e; }
    });
}
registerAll();

/* ═══════════ 快捷键（菜单树上本菜单的 key ＋ Ctrl+F＝上次滤镜；只在 PS 菜单〔像素／文字层〕时生效） ═══════════ */
const comboOf = e => { const q = []; if (e.ctrlKey || e.metaKey) q.push('Ctrl'); if (e.altKey) q.push('Alt'); if (e.shiftKey) q.push('Shift');
  const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key; q.push(k); return q.join('+'); };
const normCombo = s => { const parts = String(s).split('+'), key = parts.pop(); return ['Ctrl', 'Alt', 'Shift'].filter(m => parts.includes(m)).concat(key.toUpperCase()).join('+'); };
window.addEventListener('keydown', e => {
  if (Dlg.cur || e.defaultPrevented) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const tg = e.target; if (tg && (tg.isContentEditable || /^(input|select|textarea)$/i.test(tg.tagName))) return;
  if (!window.Menubar || Menubar.app !== 'ps' || !window.MenuTrees || !MenuTrees.ps.filter) return;
  const want = normCombo(comboOf(e));
  let hit = null;
  if (want === 'Ctrl+F') MenuTrees.walk('ps', it => { if (!hit && it.id === 'filter.lastFilter') hit = it; });   // PS：Ctrl+F 重复上次滤镜
  else MenuTrees.walk('ps', it => { if (!hit && it.key && it.impl && it.id && it.id.startsWith('filter.') && normCombo(it.key) === want) hit = it; });
  if (!hit || !Menubar.enabled(hit)) return;
  e.preventDefault(); e.stopPropagation();
  Menubar.run(hit);
}, true);

/* ═══════════ 给测试与 agent ═══════════ */
window.PsFilter = {
  version:'1',
  paramsFor, haloOf, parseSpec, specOf, KERNELS, SURF_OPS, CUSTOM_DIALOGS, Img, Surf, R, hash01,
  run:(id, p) => { const L = targetLayer(p || {}, id); const r = runFilterOnLayer(L, id, p || {}); return r; },   // 不进历史（测试用）
  openDialog, editSmartFilter, loadDisplaceMap, displaceMaps:DISP_MAPS, loadTexture:ag_loadTexture, textures:AG_TEX, last:() => ({id:Last.id, params:Last.params}), menuIds:MENU_IDS.slice(),
  dlg:{
    get cur(){ return Dlg.cur; },
    isOpen:() => Dlg.isOpen(),
    values:() => Dlg.cur ? JSON.parse(JSON.stringify(Dlg.cur.v)) : null,
    params:() => Dlg.cur ? Dlg.params() : null,
    set(k, val){ if (!Dlg.cur) return false; Dlg.cur.v[k] = val; Dlg.changed(true); return true; },
    ok:() => Dlg.ok(), cancel:() => Dlg.cancel(), preview:() => Dlg.runPreview()
  }
};

})();
