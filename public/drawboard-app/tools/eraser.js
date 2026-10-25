/* 橡皮擦（E）：PhotoCraft 的「橡皮擦工具组」三颗，在我们这边是同一颗按钮的三种模式（Shift+E 轮换，同 PS）：
     · eraser     橡皮擦：一笔把像素擦成透明（paint.stroke erase:true）       → 命令 eraser.stroke
     · background 背景橡皮擦：沿笔画取样热点颜色，只擦颜色相近的像素        → 命令 eraser.background
     · magic      魔术橡皮擦：点一下，把魔棒区域擦成透明                    → 命令 eraser.magic
   一笔／一点＝一条命令＝一步历史。🔴 滑鼠给的是文件坐标，图层可能被移动过 ⇒ 一律先换算成图层坐标（铁律④）。

   对照源（逐段翻译，各段注释标 档:行；路径都在 photocraft/crates/ 下）：
     ui-egui/src/state.rs:21-23,31,153,173  工具组 Eraser/BackgroundEraser/MagicEraser、键 E、哪几颗算「笔刷类」
     ui-egui/src/state.rs:416-462           选项预设（容差 32、消除锯齿、连续、魔术橡皮擦不透明度 100、背景橡皮擦取样／限制／容差 50）
     ui-egui/src/shortcuts.rs:290-318       同键轮换（Shift+E）、[ ] 改笔尖大小
     ui-egui/src/canvas.rs                  tool_event 1967-2142、tool_move 1942-1964、finish_gesture 2144-2182、
                                            游标 1598-1651、brush_tip_centre 213-221、拖曳预览 1864-1888
     ui-egui/src/eraser_ui.rs:1-103         魔术橡皮擦点击、背景橡皮擦收笔、两者的选项栏
     ui-egui/src/paint_mouse.rs:13-99       平滑是每颗工具各一份（橡皮擦第一次 10%）、右键不画
     ui-egui/src/stroke_constraint.rs       Shift 拖直线 60-83、Shift＋点接上一笔、橡皮筋预览 85-123
     ui-egui/src/brush_resize.rs:20-153     Ctrl+Alt 拖曳改直径／硬度
     ui-egui/src/stroke_trail.rs:1-80       背景橡皮擦拖曳时的半透明笔迹
     ui-egui/src/panels.rs:426-435,508-535  选项栏（大小 硬度 不透明度 流量 平滑 压力控制大小／不透明度）
     engine/src/brush_cmds.rs:50-82,146-180,267-353  paint.stroke 参数解析、resolve_brush、LiveStroke（即时预览＋收笔尾巴）
     engine/src/eraser_cmds.rs:1-189        paint.magicEraser / paint.backgroundEraser
     engine/src/selection_cmds.rs:58-70     sample_rgba8（本层或所有图层）
     paint/src/lib.rs:139-156               笔尖覆盖率 dab_coverage
     paint/src/dynamics.rs                  平滑 Smoother 51-115、按间距落点 PathWalker 143-260、base_diameter 362-373、DabBuilder 385-507
     paint/src/render.rs                    dab_rect 143-150、rasterize 153-237、accumulate 297-361、tail_preview 474-519、composite 567-657
     paint/src/retouch.rs:80-117,219-292    Footprint、apply_dab_stroke（逐个笔印改工作副本）
     paint/src/bg_erase.rs:1-157            背景橡皮擦
     algo/src/selection.rs:245-361          wand_region（扫描线填充＋3×3 消除锯齿）
     algo/src/erase.rs:13-97                magic_erase */
(function(){
'use strict';

/* ── 常数（照抄） ── */
const MAX_COORD       = 1e6;    // brush_cmds.rs:51 点坐标上限
const LOCK_DISTANCE   = 3;      // stroke_constraint.rs:16 Shift 锁方向前要走的萤幕点数
const HARDNESS_TRAVEL = 200;    // brush_resize.rs:21 垂直拖 200 萤幕点＝硬度 0→100%
const SIZE_MIN = 1, SIZE_MAX = 5000;   // brush_resize.rs:23（tools.setBrush 同范围）
const BAR_SIZE_MAX = 2500;      // panels.rs:513 选项栏、shortcuts.rs:312 [ ] 的上限
const MODES = ['eraser', 'background', 'magic'];          // state.rs:31 工具组顺序
const SAMPLINGS = ['continuous', 'once', 'backgroundSwatch'];        // replace.rs:25-33
const LIMITS = ['discontiguous', 'contiguous', 'findEdges'];         // replace.rs:37-45
/* 「背景色板」取样用的颜色＝工具箱的背景色（PS／原码 bg_erase.rs swatch＝背景色；我们的背景色就是 #strokeColor 那格，吸管 Alt 点写的也是它）。
   没有那格（单测环境）才退回工具选项里记的那一份 */
const bgSw = o => { const e = typeof document !== 'undefined' && document.getElementById('strokeColor'); return e && /^#[0-9a-f]{6}$/i.test(e.value) ? e.value.toLowerCase() : o.bgSwatch; };

/* 魔棒类工具共用的选项（state.rs:309-312：tolerance／contiguous／anti_alias／sample_all_layers 几颗工具共用一份） */
if (ToolState.antiAlias       === undefined) ToolState.antiAlias       = true;
if (ToolState.contiguous      === undefined) ToolState.contiguous      = true;
if (ToolState.sampleAllLayers === undefined) ToolState.sampleAllLayers = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = v => typeof v === 'number' && isFinite(v);

/* ═══════════ 笔刷引擎（只抄橡皮擦用得到的：圆笔尖、无形状动态、无纹理、无双重笔刷） ═══════════ */

/* paint/src/lib.rs:141-156：圆笔尖在距中心 d 处的覆盖率（边缘反锯齿＋硬度衰减，smoothstep） */
function dabCoverage(d, radius, hardness){
  if (d >= radius + 0.5) return 0;
  const edge = Math.min(clamp(radius + 0.5 - d, 0, 1), 1);
  const h = clamp(hardness, 0, 1);
  const inner = radius * h;
  let falloff;
  if (d <= inner || radius - inner < 1e-3) falloff = 1;
  else {
    const t = clamp((d - inner) / (radius - inner), 0, 1);
    falloff = 1 - t * t * (3 - 2 * t);
  }
  return edge * falloff;
}

const lerpPt = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f,
                               pressure: a.pressure + (b.pressure - a.pressure) * f });

/* dynamics.rs:51-115 Smoother（指数平滑。滑鼠点没有时间戳 ⇒ catch_up 每点只迭代一次；收笔时 catch_up_on_end 追到最后一点） */
class Smoother {
  constructor(amount){ this.amount = amount; this.pos = null; this.last = null; }
  clone(){ const s = new Smoother(this.amount); s.pos = this.pos; s.last = this.last; return s; }
  push(p, out){
    this.last = p;
    if (!(this.amount > 0)){ out.push(p); return; }
    if (!this.pos){ this.pos = p; out.push(p); return; }
    const a = 1 - Math.min(clamp(this.amount, 0, 1), 0.95);
    const cur = { x: this.pos.x + (p.x - this.pos.x) * a, y: this.pos.y + (p.y - this.pos.y) * a, pressure: p.pressure };
    out.push(cur); this.pos = cur;
  }
  finish(out){
    if (!(this.amount > 0)) return;
    if (this.pos && this.last && (this.pos.x !== this.last.x || this.pos.y !== this.last.y)){
      this.pos = this.last; out.push(this.last);
    }
  }
}

/* dynamics.rs:143-260 PathWalker（只有距离间距；第一点等第二点来了才发，收笔时补发） */
class PathWalker {
  constructor(){ this.last = null; this.nextAt = 0; this.pendingFirst = null; }
  clone(){ const w = new PathWalker(); w.last = this.last; w.nextAt = this.nextAt; w.pendingFirst = this.pendingFirst; return w; }
  push(p, stepLen, emit){
    const a = this.last;
    if (!a){ this.last = p; this.pendingFirst = p; this.nextAt = stepLen(p); return; }
    const dx = p.x - a.x, dy = p.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (this.pendingFirst){ const f = this.pendingFirst; this.pendingFirst = null; emit(f); }
    if (len > 1e-9){
      while (this.nextAt <= len + 1e-9){
        const q = lerpPt(a, p, Math.min(this.nextAt / len, 1));
        emit(q);
        this.nextAt += Math.max(stepLen(q), 0.25);
      }
      this.nextAt -= len;
    }
    this.last = p;
  }
  finish(emit){ if (this.pendingFirst){ const f = this.pendingFirst; this.pendingFirst = null; emit(f); } }
}

/* dynamics.rs:582-657 DabGenerator（平滑 → 走路径 → 每步一个笔印）。
   b = 解析后的笔刷 {size, hardness, opacity, flow, spacing, smoothing, pressureSize, pressureOpacity}
   笔印 = {x, y, radius, alpha(流量), opacity(累积上限)} */
class DabGen {
  constructor(b){ this.b = b; this.smoother = new Smoother(b.smoothing); this.walker = new PathWalker(); }
  clone(){ const g = Object.create(DabGen.prototype); g.b = this.b; g.smoother = this.smoother.clone(); g.walker = this.walker.clone(); return g; }
  /* dynamics.rs:362-373 base_diameter：没开形状动态时，压力控制大小开着就乘笔压 */
  baseD(p){ return this.b.size * (this.b.pressureSize ? clamp(p.pressure, 0, 1) : 1); }
  /* dynamics.rs:390-394 step_len */
  stepLen(p){ return Math.max(Math.max(this.baseD(p), 1) * Math.max(this.b.spacing, 0.01), 0.5); }
  /* dynamics.rs:396-507 build（剩直径、流量、压力控制不透明度） */
  build(s){
    const b = this.b;
    return { x: s.x, y: s.y, radius: Math.max(this.baseD(s) / 2, 0.5), alpha: clamp(b.flow, 0, 1),
             opacity: clamp(b.pressureOpacity ? clamp(s.pressure, 0, 1) : 1, 0, 1) };
  }
  _walk(pts, out){ for (const p of pts) this.walker.push(p, q => this.stepLen(q), s => out.push(this.build(s))); }
  push(pts, out){ const sm = []; for (const p of pts) this.smoother.push(p, sm); this._walk(sm, out); return out; }
  finish(out){
    const sm = []; this.smoother.finish(sm); this._walk(sm, out);
    this.walker.finish(s => out.push(this.build(s)));
    return out;
  }
}

/* render.rs:143-150 dab_rect（圆笔尖：半径取整＋1 的余量）→ [x0,y0,x1,y1] */
function dabRect(d){
  const rr = Math.ceil(d.radius) + 1, cx = Math.floor(d.x), cy = Math.floor(d.y);
  return [cx - rr, cy - rr, cx + rr + 1, cy + rr + 1];
}
/* render.rs:153-237 rasterize（圆笔尖 roundness=1 ⇒ ro=1、rm=r；未开杂色／湿边／纹理）：对 dab_rect 每格回 覆盖率×流量 */
function rasterDab(d, hardness, each){
  const r = dabRect(d), rm = Math.max(d.radius, 0.5), reach2 = (rm + 0.5) * (rm + 0.5);
  for (let y = r[1]; y < r[3]; y++){
    const dy = y + 0.5 - d.y;
    for (let x = r[0]; x < r[2]; x++){
      const dx = x + 0.5 - d.x, d2 = dx * dx + dy * dy;
      if (d2 >= reach2) continue;
      const v = dabCoverage(Math.sqrt(d2), rm, hardness);
      if (v <= 0) continue;
      each(x, y, v * d.alpha);
    }
  }
  return r;
}
/* render.rs:297-361 accumulate：c ← c + v·(ceil − c)（流量累积到不透明度上限）。buf = {arr, x0, y0, w, h}，裁到 buf 之内 */
function accumulate(buf, d, hardness){
  const ceil = d.opacity, arr = buf.arr;
  return rasterDab(d, hardness, (x, y, v) => {
    if (v <= 0) return;
    const lx = x - buf.x0, ly = y - buf.y0;
    if (lx < 0 || ly < 0 || lx >= buf.w || ly >= buf.h) return;
    const i = ly * buf.w + lx, c = arr[i];
    if (ceil > c){ const nv = c + v * (ceil - c); if (nv > c) arr[i] = nv; }
  });
}
function uni(a, b){ return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice(); }
function clipTo(r, W, H){
  if (!r) return null;
  const c = [Math.max(r[0], 0), Math.max(r[1], 0), Math.min(r[2], W), Math.min(r[3], H)];
  return (c[2] > c[0] && c[3] > c[1]) ? c : null;
}
/* 选区覆盖率：我们的选区只有矩形（文件坐标）；换成图层坐标后看像素中心在不在里面 */
function selFor(L){
  const s = Doc.sel; if (!s) return null;
  return [s.x - L.x, s.y - L.y, s.x - L.x + s.w, s.y - L.y + s.h];
}
const selAt = (sel, x, y) => (!sel || (x + 0.5 >= sel[0] && x + 0.5 < sel[2] && y + 0.5 >= sel[1] && y + 0.5 < sel[3])) ? 1 : 0;

/* render.rs:567-657 composite 的 erase 分支（623-627）：α ← α·(1 − k)，k = min(覆盖率·不透明度·选区, 1)。
   永远从 pre（下笔前的像素）算，所以同一笔可以反复增量合成而不会越擦越多。rect 已裁到图层内（图层坐标）。 */
function compositeErase(ctx, pre, rect, sel, buf, opacity){
  if (!rect) return;
  const [x0, y0, x1, y1] = rect, w = x1 - x0, h = y1 - y0;
  const out = ctx.createImageData(w, h), od = out.data, pd = pre.data, W = pre.width;
  const op = clamp(opacity, 0, 1), arr = buf.arr;
  for (let y = y0; y < y1; y++){
    for (let x = x0; x < x1; x++){
      const pi = (y * W + x) * 4, oi = ((y - y0) * w + (x - x0)) * 4;
      od[oi] = pd[pi]; od[oi + 1] = pd[pi + 1]; od[oi + 2] = pd[pi + 2];
      let a = pd[pi + 3];
      const lx = x - buf.x0, ly = y - buf.y0;
      const c = (lx >= 0 && ly >= 0 && lx < buf.w && ly < buf.h) ? arr[ly * buf.w + lx] : 0;
      if (c > 0 && a > 0){
        const k = Math.min(c * op * selAt(sel, x, y), 1);
        if (k > 0) a = Math.round(a * (1 - k));
      }
      od[oi + 3] = a;
    }
  }
  ctx.putImageData(out, x0, y0);
}

/* render.rs:374-519 StrokeRenderer：落点 → 覆盖率缓冲（一笔一张，跟图层同尺寸）→ 从下笔前的像素合成 */
class EraseRenderer {
  constructor(W, H, b){
    this.W = W; this.H = H; this.b = b;
    this.gen = new DabGen(b);
    this.buf = { arr: new Float32Array(W * H), x0: 0, y0: 0, w: W, h: H };
    this.bounds = null;           // 整笔笔印范围（不裁；同 render.rs:443 cov.bounds）
    this.dirty = null;            // 上次合成后新碰到的范围
    this.tail = null;             // 即时预览画上去的「收笔尾巴」范围
    this.dabs = 0;
  }
  _add(ds){
    for (const d of ds){
      const r = accumulate(this.buf, d, this.b.hardness);
      this.bounds = uni(this.bounds, r); this.dirty = uni(this.dirty, r); this.dabs++;
    }
  }
  push(pts){ this._add(this.gen.push(pts, [])); }
  finish(){ this._add(this.gen.finish([])); }
  /* 一次合成整笔（render.rs:660-677 render_stroke） */
  compositeAll(ctx, pre, sel){ compositeErase(ctx, pre, clipTo(this.bounds, this.W, this.H), sel, this.buf, this.b.opacity); this.dirty = null; }
  /* 即时预览（brush_cmds.rs:335-352 LiveStroke::push ＋ render.rs:474-519 tail_preview）：
     先把上次画的尾巴还原成「只有主笔」，合成新碰到的部分，再把「现在收笔会补上的尾巴」（平滑追上指针）画上去，
     所以放开时画面不会再跳。 */
  preview(ctx, pre, sel){
    const rect = this.tail ? uni(this.dirty || this.tail, this.tail) : this.dirty;
    this.dirty = null; this.tail = null;
    compositeErase(ctx, pre, clipTo(rect, this.W, this.H), sel, this.buf, this.b.opacity);
    const td = this.gen.clone().finish([]);
    if (!td.length) return;
    let tr = null; for (const d of td) tr = uni(tr, dabRect(d));
    tr = clipTo(tr, this.W, this.H); if (!tr) return;
    const w = tr[2] - tr[0], h = tr[3] - tr[1], local = { arr: new Float32Array(w * h), x0: tr[0], y0: tr[1], w, h };
    for (let y = 0; y < h; y++) local.arr.set(this.buf.arr.subarray((tr[1] + y) * this.W + tr[0], (tr[1] + y) * this.W + tr[2]), y * w);
    for (const d of td) accumulate(local, d, this.b.hardness);
    compositeErase(ctx, pre, tr, sel, local, this.b.opacity);
    this.tail = tr;
  }
}

/* ═══════════ 背景橡皮擦（bg_erase.rs ＋ retouch.rs apply_dab_stroke） ═══════════
   全在图层坐标里做。工作副本盖住整笔笔印范围（不裁；图层画布外当透明、也不写回）。
   bs = {sampling, limits, tolerance(0..1), protectFg, fg:[r,g,b](0..1), swatch:[r,g,b](0..1)} */
function backgroundErase(L, pts, b, bs, sel){
  const bb = Object.assign({}, b, { opacity: 1 });             // bg_erase.rs:83-84 笔刷不透明度不算
  const gen = new DabGen(bb), ds = gen.push(pts, []); gen.finish(ds);
  if (!ds.length) return null;
  let B = null; for (const d of ds) B = uni(B, dabRect(d));
  const [bx0, by0, bx1, by1] = B, bw = bx1 - bx0, bh = by1 - by0;
  const ctx = L.data.ctx, W = L.data.canvas.width, H = L.data.canvas.height;
  const clip = clipTo(B, W, H);
  // 工作副本：颜色（0..255 位元组）＋ alpha（0..1 浮点，免得一个个笔印反复取整）
  const col = new Uint8ClampedArray(bw * bh * 3), al = new Float32Array(bw * bh);
  let pre = null;
  if (clip){
    pre = ctx.getImageData(clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]);
    const pw = pre.width, pd = pre.data;
    for (let y = clip[1]; y < clip[3]; y++) for (let x = clip[0]; x < clip[2]; x++){
      const pi = ((y - clip[1]) * pw + (x - clip[0])) * 4, wi = (y - by0) * bw + (x - bx0);
      col[wi * 3] = pd[pi]; col[wi * 3 + 1] = pd[pi + 1]; col[wi * 3 + 2] = pd[pi + 2]; al[wi] = pd[pi + 3] / 255;
    }
  }
  const tol = isFinite(bs.tolerance) ? clamp(bs.tolerance, 0, 1) : 0;
  const soft = bs.limits !== 'findEdges';
  const dist = (wi, c) => Math.max(Math.abs(col[wi * 3] / 255 - c[0]), Math.abs(col[wi * 3 + 1] / 255 - c[1]), Math.abs(col[wi * 3 + 2] / 255 - c[2]));
  const distV = (wi, c, B) => { const a = al[wi]; let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a * col[wi * 3 + k] / 255 + (1 - a) * B[k] - c[k])); return m; };
  const matchW = d => d > tol ? 0 : (soft && tol > 0) ? clamp((tol - d) / (tol * 0.25), 0, 1) : 1;   // 最后 1/4 容差软化
  let once;                                                    // undefined＝还没取过；null＝取到透明（整笔都不擦）
  for (const d of ds){
    // retouch.rs:106-117 / render.rs:239-245 footprint：笔印覆盖率（含流量）
    const r = dabRect(d), w = r[2] - r[0], h = r[3] - r[1], fp = new Float32Array(w * h);
    rasterDab(d, b.hardness, (x, y, v) => { fp[(y - r[1]) * w + (x - r[0])] = v; });
    const cx = Math.floor(d.x), cy = Math.floor(d.y);
    // 热点颜色（已透明就没有）
    const hotspot = () => {
      if (cx < bx0 || cy < by0 || cx >= bx1 || cy >= by1) return null;
      const wi = (cy - by0) * bw + (cx - bx0);
      return al[wi] > 0 ? [col[wi * 3] / 255, col[wi * 3 + 1] / 255, col[wi * 3 + 2] / 255] : null;
    };
    let sampled;
    if (bs.sampling === 'once'){ if (once === undefined) once = hotspot(); sampled = once; }
    else if (bs.sampling === 'backgroundSwatch') sampled = bs.swatch;
    else sampled = hotspot();
    if (!sampled) continue;
    const weight = new Float32Array(w * h);
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
      const wi = (y - by0) * bw + (x - bx0);
      if (!(fp[(y - r[1]) * w + (x - r[0])] > 0)) continue;
      if (al[wi] <= 0) continue;
      // 比的是「叠在取样色上看到的颜色」（不透明像素＝原码的直接比颜色）：颜色抽离过的半透明像素外观不变 ⇒ 后面的笔印照样认得、不会卡在半抽离
      if (bs.protectFg && distV(wi, bs.fg, sampled) <= tol) continue;
      weight[(y - r[1]) * w + (x - r[0])] = matchW(distV(wi, sampled, sampled));
    }
    if (bs.limits !== 'discontiguous')
      keepConnected(weight, w, h, clamp(cx, r[0], r[2] - 1) - r[0], clamp(cy, r[1], r[3] - 1) - r[1]);
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
      const wi = (y - by0) * bw + (x - bx0);
      const k = Math.min(fp[(y - r[1]) * w + (x - r[0])] * weight[(y - r[1]) * w + (x - r[0])], 1);
      if (k <= 0) continue;
      // 原码（bg_erase.rs）只把 alpha 乘 (1−k)；PS 2020 另外做「颜色抽离」（Adobe 说明：Background Eraser performs color extraction at the edges）：
      // 把像素（连它现有的透明度）叠在取样色 B 上看到的颜色 V＝a0·C＋(1−a0)·B，当成 前景 F 跟 B 的混合 V＝a·F＋(1−a)·B，
      // 求最小的 a（逐色版取最大，同 color-to-alpha）与抽出来的 F ⇒ 擦掉的部分只剩「前景 F、透明度 a」：
      // 白底上的浅纱留成半透明的纱色、没有白边，垫回 B 跟原来一模一样。看的是叠出来的颜色 ⇒ 同一点被好几个笔印扫过也不会越擦越淡（幂等）。
      // 底噪：a 不到容差 1/8 的当成纯背景整个擦掉（摄影棚底的微小深浅、杂讯不留残影）；容差过 50% 底噪跟着拉高，到 100% 整个笔尖都擦（PS：容差 100% 什么颜色都擦）。
      // 笔尖覆盖率 k 在预乘空间里混。
      const a0 = al[wi], V = [0, 1, 2].map(c => a0 * col[wi * 3 + c] / 255 + (1 - a0) * sampled[c]);
      let a = 0;
      for (let c = 0; c < 3; c++){
        const d = V[c] - sampled[c];
        const t = d > 1e-6 ? (sampled[c] < 1 - 1e-6 ? d / (1 - sampled[c]) : 0) : d < -1e-6 ? (sampled[c] > 1e-6 ? -d / sampled[c] : 0) : 0;
        if (t > a) a = t;
      }
      a = Math.min(a, 1);
      const nf = tol / 8 + Math.max(0, tol - 0.5) * 1.75, aT = a <= nf ? 0 : a;
      const aN = k * aT + (1 - k) * a0;                            // 抽离后的 alpha、跟笔尖覆盖率混
      if (aN <= 1e-4){ al[wi] = 0; col[wi * 3] = col[wi * 3 + 1] = col[wi * 3 + 2] = 0; continue; }
      for (let c = 0; c < 3; c++){
        const F = a > 1e-6 ? clamp(sampled[c] + (V[c] - sampled[c]) / a, 0, 1) : sampled[c];
        col[wi * 3 + c] = Math.round((k * aT * F + (1 - k) * a0 * col[wi * 3 + c] / 255) / aN * 255);
      }
      al[wi] = aN;
    }
  }
  // retouch.rs:245-274：工作副本按「不透明度(=1)×选区」混回去（k=1 ⇒ 直接取工作副本；选区外保留原样）
  if (clip){
    const pw = pre.width, pd = pre.data;
    for (let y = clip[1]; y < clip[3]; y++) for (let x = clip[0]; x < clip[2]; x++){
      if (!selAt(sel, x, y)) continue;
      const pi = ((y - clip[1]) * pw + (x - clip[0])) * 4, wi = (y - by0) * bw + (x - bx0);
      pd[pi] = col[wi * 3]; pd[pi + 1] = col[wi * 3 + 1]; pd[pi + 2] = col[wi * 3 + 2]; pd[pi + 3] = Math.round(al[wi] * 255);
    }
    ctx.putImageData(pre, clip[0], clip[1]);
  }
  return { bounds: B, dabs: ds.length };
}
/* bg_erase.rs:159-191 keep_connected：只留跟 (sx,sy) 四连通、权重 > 0 的像素 */
function keepConnected(weight, w, h, sx, sy){
  const keep = new Uint8Array(w * h), si = sy * w + sx;
  if (weight[si] > 0){
    const stack = [si]; keep[si] = 1;
    while (stack.length){
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      const nb = j => { if (!keep[j] && weight[j] > 0){ keep[j] = 1; stack.push(j); } };
      if (x > 0) nb(i - 1);
      if (x + 1 < w) nb(i + 1);
      if (y > 0) nb(i - w);
      if (y + 1 < h) nb(i + w);
    }
  }
  for (let i = 0; i < weight.length; i++) if (!keep[i]) weight[i] = 0;
}

/* ═══════════ 魔术橡皮擦（selection.rs wand_region ＋ erase.rs magic_erase） ═══════════ */

/* selection_cmds.rs:58-70 sample_rgba8：文件范围的 RGBA8（本层：图层画布外＝透明；sampleAll：整份合成） */
function sampleRGBA8(L, all){
  const W = Doc.width, H = Doc.height;
  if (all) return composite(1).getContext('2d').getImageData(0, 0, W, H).data;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(L.data.canvas, L.x, L.y);
  return c.getContext('2d').getImageData(0, 0, W, H).data;
}
/* selection.rs:248-361 wand_region：img 是 w×h 的 RGBA8，seed 在 img 内。回 {bbox:[x0,y0,x1,y1], mask:Uint8Array} 或 null */
function wandRegion(img, w, h, sx, sy, tolerance, contiguous, antiAlias){
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const ti = (sy * w + sx) * 4, T0 = img[ti], T1 = img[ti + 1], T2 = img[ti + 2], T3 = img[ti + 3];
  const tol = Math.max(Math.floor(tolerance + 1e-3), 0);
  const similar = i => { const j = i * 4;
    return Math.abs(img[j] - T0) <= tol && Math.abs(img[j + 1] - T1) <= tol && Math.abs(img[j + 2] - T2) <= tol && Math.abs(img[j + 3] - T3) <= tol; };
  const marks = new Uint8Array(w * h);
  let bx0 = Infinity, by0 = Infinity, bx1 = 0, by1 = 0;
  if (contiguous){
    // 扫描线填充：填一整段，再到上下两行找新的种子
    const stack = [[sx, sy]];
    while (stack.length){
      const [x, y] = stack.pop(), row = y * w;
      if (marks[row + x]) continue;
      let l = x, r = x;
      while (l > 0 && !marks[row + l - 1] && similar(row + l - 1)) l--;
      while (r + 1 < w && !marks[row + r + 1] && similar(row + r + 1)) r++;
      marks.fill(255, row + l, row + r + 1);
      bx0 = Math.min(bx0, l); bx1 = Math.max(bx1, r); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      for (const ny of [y - 1, y + 1]){
        if (ny < 0 || ny >= h) continue;
        const nrow = ny * w; let inRun = false;
        for (let nx = l; nx <= r; nx++){
          const ok = !marks[nrow + nx] && similar(nrow + nx);
          if (ok && !inRun) stack.push([nx, ny]);
          inRun = ok;
        }
      }
    }
  } else {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      if (similar(y * w + x)){ marks[y * w + x] = 255; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    }
  }
  if (bx0 === Infinity) return null;
  // 消除锯齿多留一圈
  const pad = antiAlias ? 1 : 0;
  const x0 = Math.max(bx0 - pad, 0), y0 = Math.max(by0 - pad, 0), x1 = Math.min(bx1 + 1 + pad, w), y1 = Math.min(by1 + 1 + pad, h);
  const bw = x1 - x0, mask = new Uint8Array(bw * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const v = marks[y * w + x]; let o = v;
    if (antiAlias){
      // 边缘像素跟 3×3 邻居平均；区外的邻居当成自己
      let sum = 0, edge = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const nx = x + dx, ny = y + dy;
        const n = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? v : marks[ny * w + nx];
        if (n !== v) edge = true;
        sum += n;
      }
      if (edge){ const avg = sum / (9 * 255); o = Math.round((v > 127 ? 0.5 + 0.5 * avg : 0.5 * avg) * 255); }
    }
    mask[(y - y0) * bw + (x - x0)] = o;
  }
  return { bbox: [x0, y0, x1, y1], mask };
}
/* erase.rs:17-97 magic_erase：k = 覆盖率·不透明度·选区；α ← α·(1−k)，k≥1 或 α 归零 ⇒ 整个像素清成 0。
   region 是文件坐标；写进图层要减图层位移，图层画布外的跳过。回伤害范围（文件坐标）或 null */
function magicErase(L, region, amount, sel){
  amount = isFinite(amount) ? clamp(amount, 0, 1) : 0;
  const [x0, y0, x1, y1] = region.bbox, bw = x1 - x0;
  if (!(x1 > x0 && y1 > y0) || amount <= 0) return null;
  const W = L.data.canvas.width, H = L.data.canvas.height;
  const c = clipTo([x0 - L.x, y0 - L.y, x1 - L.x, y1 - L.y], W, H);
  if (!c) return null;
  const ctx = L.data.ctx, img = ctx.getImageData(c[0], c[1], c[2] - c[0], c[3] - c[1]), d = img.data, iw = img.width;
  for (let ly = c[1]; ly < c[3]; ly++) for (let lx = c[0]; lx < c[2]; lx++){
    const m = region.mask[(ly + L.y - y0) * bw + (lx + L.x - x0)];
    if (!m) continue;
    const k = m / 255 * amount * selAt(sel, lx, ly);
    if (k <= 0) continue;
    const i = ((ly - c[1]) * iw + (lx - c[0])) * 4;
    const v = d[i + 3] / 255 * (1 - k);
    if (k >= 1 || v <= 0){ d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
    else d[i + 3] = Math.round(v * 255);
  }
  ctx.putImageData(img, c[0], c[1]);
  return [x0, y0, x1, y1];
}

/* ═══════════ 参数解析（brush_cmds.rs、eraser_cmds.rs） ═══════════ */

/* brush_cmds.rs:55-82 parse_points：[x,y,pressure?] 或 {x,y,pressure}；坏的丢掉；空的、过大的报错 */
function parsePoints(raw){
  if (!Array.isArray(raw)) return {error:'missing `points`'};
  const pts = [];
  for (const v of raw){
    let x, y, pr;
    if (Array.isArray(v)){ x = v[0]; y = v[1]; pr = v[2]; }
    else if (v && typeof v === 'object'){ x = v.x; y = v.y; pr = v.pressure; }
    else continue;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    pts.push({x, y, pressure: isNum(pr) ? pr : 1});
  }
  if (!pts.length) return {error:'`points` is empty'};
  if (pts.some(q => !(Math.abs(q.x) <= MAX_COORD && Math.abs(q.y) <= MAX_COORD)))
    return {error:`point coordinates must be finite and within ±${MAX_COORD}`};
  return {pts};
}

/* brush_cmds.rs:146-180 resolve_brush：工具现值 ← brush:{…} 补丁 ← 纯量参数（夹值照抄） */
function resolveBrush(T, p){
  const o = T.opt, b = {
    size: ToolState.size, hardness: ToolState.hardness,
    opacity: o.opacity, flow: o.flow, spacing: o.spacing, smoothing: o.smoothing,
    pressureSize: o.pressureSize, pressureOpacity: o.pressureOpacity
  };
  const patch = (p.brush && typeof p.brush === 'object') ? p.brush : {};
  for (const k of ['size', 'hardness', 'opacity', 'flow', 'spacing']) if (isNum(patch[k])) b[k] = patch[k];
  if (patch.smoothing && isNum(patch.smoothing.amount)) b.smoothing = patch.smoothing.amount;
  for (const k of ['pressureSize', 'pressureOpacity']) if (typeof patch[k] === 'boolean') b[k] = patch[k];
  if (isNum(p.size))      b.size = Math.max(p.size, 0.5);
  if (isNum(p.hardness))  b.hardness = clamp(p.hardness, 0, 1);
  if (isNum(p.opacity))   b.opacity = clamp(p.opacity, 0, 1);
  if (isNum(p.flow))      b.flow = clamp(p.flow, 0, 1);
  if (isNum(p.spacing))   b.spacing = clamp(p.spacing, 0.01, 10);
  if (isNum(p.smoothing)) b.smoothing = clamp(p.smoothing, 0, 1);
  if (typeof p.pressureSize === 'boolean')    b.pressureSize = p.pressureSize;
  if (typeof p.pressureOpacity === 'boolean') b.pressureOpacity = p.pressureOpacity;
  return b;
}

/* eraser_cmds.rs:30-44 number／enum_param：缺省用预设；不是数字或不在列表里就报错 */
function numParam(p, k, def, lo, hi){
  const v = p[k];
  if (v === undefined || v === null) return {v: def};
  if (!isNum(v)) return {error:`\`${k}\` must be a number`};
  return {v: clamp(v, lo, hi)};
}
function enumParam(p, k, def, allowed){
  const v = p[k];
  if (v === undefined || v === null) return {v: def};
  return allowed.includes(v) ? {v} : {error:`\`${k}\` must be one of ${allowed.join('|')}`};
}
const flag = (p, k, d) => typeof p[k] === 'boolean' ? p[k] : d;

/* 颜色 "#rrggbb" / [r,g,b](0..1) → [r,g,b](0..1)（brush_cmds.rs:29-45 color） */
function rgb01(v, d){
  if (Array.isArray(v) && v.length >= 3) return [0, 1, 2].map(i => +v[i] || 0);
  if (typeof v === 'string'){
    let h = v.replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  return d;
}
const hexOf = c => '#' + c.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

/* 同一份文件的判定（Shift＋点接上一笔）*/
const docKey = () => 'S' + Doc.serial;      // engine.js 的文件序号：每开一份新文件 +1，undo 不变

/* 不留空历史：他们 s.edit 前就回错／什么都没做时不记一步。我们这边交给共用层 CMD.run——
   命令回 {ok:false} 它就把刚推的快照弹掉；所以失败回 {ok:false, error}，「不是错误的空操作」回 {ok:false, noop:true}。 */

/* stroke_constraint.rs:37-50 */
function snappedDir(o, p, step){
  const dx = p[0] - o[0], dy = p[1] - o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(a), Math.sin(a)];
}
function project(o, d, p){
  const t = (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1];
  return [o[0] + d[0] * t, o[1] + d[1] * t];
}

/* 指针压力：滑鼠一律满压（stylus.rs mouse_is_full_pressure）；笔／触控才读 pressure */
const pressureOf = e => (e && e.pointerType && e.pointerType !== 'mouse' && e.pressure > 0) ? e.pressure : 1;

const STR = {
  'zh-Hant':{ 'opt.eraser.mode':'模式', 'ui.eraser.mode.eraser':'橡皮擦', 'ui.eraser.mode.background':'背景橡皮擦', 'ui.eraser.mode.magic':'魔術橡皮擦',
              'opt.eraser.opacity':'不透明度', 'opt.eraser.flow':'流量', 'opt.eraser.smoothing':'平滑化',
              'opt.eraser.pressureSize':'壓力控制大小', 'opt.eraser.pressureOpacity':'壓力控制不透明度',
              'opt.eraser.sampling':'取樣', 'ui.eraser.sampling.continuous':'連續', 'ui.eraser.sampling.once':'一次', 'ui.eraser.sampling.backgroundSwatch':'背景色票',
              'opt.eraser.limits':'限制', 'ui.eraser.limits.discontiguous':'不連續', 'ui.eraser.limits.contiguous':'連續', 'ui.eraser.limits.findEdges':'尋找邊緣',
              'opt.eraser.bgTolerance':'容許度 %', 'opt.eraser.protectFg':'保護前景色', 'opt.eraser.swatch':'背景色',
              'opt.eraser.antiAlias':'消除鋸齒', 'opt.eraser.contiguous':'連續的', 'opt.eraser.sampleAll':'取樣全部圖層', 'opt.eraser.magicOpacity':'不透明度 %',
              'ui.eraser.diameter':'直徑：', 'ui.eraser.hardness':'硬度：',
              'ui.eraser.hint.eraser':'Shift 拖曳＝直線；Shift＋點＝接上一筆；Ctrl+Alt 拖曳＝改大小／硬度；[ ]＝縮放筆尖；Shift+E＝換模式',
              'ui.eraser.hint.background':'拖曳擦掉跟筆尖中心相近的顏色；Shift／Ctrl+Alt／[ ] 同橡皮擦；Shift+E＝換模式',
              'ui.eraser.hint.magic':'點一下擦掉相近顏色的一整片；Shift+E＝換模式' },
  'zh-Hans':{ 'opt.eraser.mode':'模式', 'ui.eraser.mode.eraser':'橡皮擦', 'ui.eraser.mode.background':'背景橡皮擦', 'ui.eraser.mode.magic':'魔术橡皮擦',
              'opt.eraser.opacity':'不透明度', 'opt.eraser.flow':'流量', 'opt.eraser.smoothing':'平滑',
              'opt.eraser.pressureSize':'压力控制大小', 'opt.eraser.pressureOpacity':'压力控制不透明度',
              'opt.eraser.sampling':'取样', 'ui.eraser.sampling.continuous':'连续', 'ui.eraser.sampling.once':'一次', 'ui.eraser.sampling.backgroundSwatch':'背景色板',
              'opt.eraser.limits':'限制', 'ui.eraser.limits.discontiguous':'不连续', 'ui.eraser.limits.contiguous':'连续', 'ui.eraser.limits.findEdges':'查找边缘',
              'opt.eraser.bgTolerance':'容差 %', 'opt.eraser.protectFg':'保护前景色', 'opt.eraser.swatch':'背景色',
              'opt.eraser.antiAlias':'消除锯齿', 'opt.eraser.contiguous':'连续', 'opt.eraser.sampleAll':'对所有图层取样', 'opt.eraser.magicOpacity':'不透明度 %',
              'ui.eraser.diameter':'直径：', 'ui.eraser.hardness':'硬度：',
              'ui.eraser.hint.eraser':'Shift 拖动＝直线；Shift＋点＝接上一笔；Ctrl+Alt 拖动＝改大小／硬度；[ ]＝缩放笔尖；Shift+E＝换模式',
              'ui.eraser.hint.background':'拖动擦掉跟笔尖中心相近的颜色；Shift／Ctrl+Alt／[ ] 同橡皮擦；Shift+E＝换模式',
              'ui.eraser.hint.magic':'点一下擦掉相近颜色的一整片；Shift+E＝换模式' },
  'en':     { 'opt.eraser.mode':'Mode', 'ui.eraser.mode.eraser':'Eraser', 'ui.eraser.mode.background':'Background Eraser', 'ui.eraser.mode.magic':'Magic Eraser',
              'opt.eraser.opacity':'Opacity', 'opt.eraser.flow':'Flow', 'opt.eraser.smoothing':'Smoothing',
              'opt.eraser.pressureSize':'Pressure for Size', 'opt.eraser.pressureOpacity':'Pressure for Opacity',
              'opt.eraser.sampling':'Sampling', 'ui.eraser.sampling.continuous':'Continuous', 'ui.eraser.sampling.once':'Once', 'ui.eraser.sampling.backgroundSwatch':'Background Swatch',
              'opt.eraser.limits':'Limits', 'ui.eraser.limits.discontiguous':'Discontiguous', 'ui.eraser.limits.contiguous':'Contiguous', 'ui.eraser.limits.findEdges':'Find Edges',
              'opt.eraser.bgTolerance':'Tolerance %', 'opt.eraser.protectFg':'Protect Foreground Color', 'opt.eraser.swatch':'Background',
              'opt.eraser.antiAlias':'Anti-alias', 'opt.eraser.contiguous':'Contiguous', 'opt.eraser.sampleAll':'Sample All Layers', 'opt.eraser.magicOpacity':'Opacity %',
              'ui.eraser.diameter':'Diameter:', 'ui.eraser.hardness':'Hardness:',
              'ui.eraser.hint.eraser':'Shift-drag: straight line · Shift-click: line from last stroke · Ctrl+Alt-drag: size/hardness · [ ]: brush size · Shift+E: next mode',
              'ui.eraser.hint.background':'Drag to erase colours like the one under the brush centre · Shift, Ctrl+Alt, [ ] as Eraser · Shift+E: next mode',
              'ui.eraser.hint.magic':'Click to erase a whole area of similar colour · Shift+E: next mode' }
};

const T = Tools.reg({
  id:'eraser', icon:'⌫', key:'E', group:'raster', order:20, for:'raster', needs:'raster', opts:[],
  strings: STR,
  /* 提示字、游标跟着模式走（canvas.rs:1598-1669：笔刷类画笔尖圈、隐藏系统游标；魔术橡皮擦是十字） */
  get hint(){ return 'ui.eraser.hint.' + this.mode; },
  get cursor(){ return this.mode === 'magic' ? 'crosshair' : 'none'; },

  mode: 'eraser',
  /* 选项现值。size／hardness 跟笔刷、图章共用 ToolState（PhotoCraft 也是共用一支 session brush）；
     平滑是「每颗工具各自一份」，橡皮擦第一次是 10%（paint_mouse.rs:13-40、engine/src/lib.rs:216-218）。
     其余照 BrushSettings 预设（brush.rs:419-449）与 state.rs:458-462。 */
  opt:{ opacity:1, flow:1, spacing:0.1, smoothing:0.1, pressureSize:true, pressureOpacity:false,
        magicOpacity:100,
        bgSampling:'continuous', bgLimits:'contiguous', bgTolerance:50, bgProtectFg:false, bgSwatch:'#ffffff' },

  _drag:null,        // {L, mode, pts:[[x,y,p]…] 文件坐标, start, axis, (eraser) ren, pre, sel}
  _resize:null,      // {anchor:[x,y], start:[size, hardness], at:[x,y]}
  _lastEnd:null,     // {key, pt}：上一笔的终点（Shift＋点从这里拉直线）
  _hover:null, _shift:false, _bound:false,
  lastParams:null,   // 最近一次提交的命令 {cmd, params}（给自测与 agent 对照）

  /* 笔刷类（橡皮擦、背景橡皮擦）才有 Ctrl+Alt 改笔尖、Shift 拉直线（state.rs:148-166 is_brushlike） */
  _brushlike(){ return this.mode !== 'magic'; },

  /* stroke_constraint.rs:63-83 constrain（只取绘画工具那支） */
  _constrain(d, p, shift){
    if (!shift){ d.axis = null; return p; }
    const last = d.pts[d.pts.length - 1];
    if (!d.axis) d.axis = { origin:[last[0], last[1]], dir:null };
    const a = d.axis;
    if (!a.dir){
      const reach = LOCK_DISTANCE / Math.max(UI.zoom, 1e-3);
      if (Math.hypot(p[0] - a.origin[0], p[1] - a.origin[1]) < reach) return a.origin.slice();
      a.dir = snappedDir(a.origin, p, Math.PI / 4);
    }
    return a.dir ? project(a.origin, a.dir, p) : a.origin.slice();
  },

  _bind(){
    if (this._bound || !window.UI || !UI.canvas) return;
    this._bound = true;
    // 指针离开画布就不画笔尖圈
    UI.canvas.addEventListener('pointerleave', () => { this._hover = null; if (Tools.current() === this) UI.draw(); });
    // Shift 按下／放开：橡皮筋预览要跟着出现／消失（stroke_constraint.rs:85-93）
    const k = (e, v) => { if (e.key === 'Shift' && this._shift !== v){ this._shift = v; if (Tools.current() === this) UI.draw(); } };
    document.addEventListener('keydown', e => k(e, true));
    document.addEventListener('keyup',   e => k(e, false));
  },

  /* canvas.rs:1967-2105 Down */
  onDown(e, pt, P){
    this._bind();
    this._shift = !!e.shiftKey; this._hover = pt;
    // paint_mouse.rs:56-99：右键不画（PhotoCraft 预设是开笔刷预设挑选器；这里没有挑选器就什么都不做）
    if (e.button !== undefined && e.button !== 0) return;
    // brush_resize.rs:59-69：笔刷类按着 Ctrl+Alt 按下＝改笔尖，不画（正在画的那一笔不被接管）
    if (!this._drag && this._brushlike() && e.ctrlKey && e.altKey){
      this._resize = { anchor:[pt[0], pt[1]], start:[ToolState.size, ToolState.hardness], at:pt };
      UI.draw(); return;
    }
    const L = Doc.active();
    if (!L || L.kind !== 'raster') return;           // has_paintable：不是像素层就不画
    // canvas.rs:2064-2067 ＋ eraser_ui.rs:18-36：魔术橡皮擦按下就叫一次命令（不拖、不看修饰键）
    if (this.mode === 'magic'){
      const params = { x: Math.floor(pt[0]), y: Math.floor(pt[1]), tolerance: ToolState.tolerance, antiAlias: ToolState.antiAlias,
                       contiguous: ToolState.contiguous, sampleAllLayers: ToolState.sampleAllLayers, opacity: this.opt.magicOpacity };
      this.lastParams = { cmd:'eraser.magic', params };
      CMD.run('eraser.magic', params);
      return;
    }
    const pr = pressureOf(e);
    // canvas.rs:2091-2097：Shift＋点 且 这份文件上有上一笔 ⇒ 先放上一笔终点，整条直线算同一笔
    const from = (e.shiftKey && this._lastEnd && this._lastEnd.key === docKey()) ? this._lastEnd.pt : null;
    const pts = [[pt[0], pt[1], pr]];
    if (from) pts.unshift([from[0], from[1], pr]);
    const d = { L, mode: this.mode, pts, start: from || [pt[0], pt[1]], axis:null };
    if (this.mode === 'eraser'){
      // 即时预览（canvas.rs:223-232 begin_live_stroke）：在图层上直接画，放开时先还原再走命令重画
      const W = L.data.canvas.width, H = L.data.canvas.height, ctx = L.data.ctx;
      d.b = resolveBrush(this, {});
      d.pre = ctx.getImageData(0, 0, W, H); d.sel = selFor(L); d.ren = new EraseRenderer(W, H, d.b);
      d.ren.push(pts.map(q => ({ x: q[0] - L.x, y: q[1] - L.y, pressure: q[2] })));
      d.lockA = !!(window.Locks && (Locks.alpha(L) || Locks.isBg(L)));   // 背景层同理（PS：背景层擦成背景色）
         // 锁透明像素：擦除会改成刷背景色（放开时 eraser.stroke 由 CMD.run 收尾），不画「擦透明」的预览免得放开时跳
      if (!d.lockA) d.ren.preview(ctx, d.pre, d.sel);
      d.fed = pts.length;
    }
    this._drag = d;
    UI.draw();
  },

  /* canvas.rs:1942-1964 tool_move ＋ 2106-2109 feed_live_stroke */
  onMove(e, pt, P){
    this._bind();
    this._hover = pt; this._shift = !!e.shiftKey;
    if (this._resize){ this._resizeTo(pt); return; }
    const d = this._drag;
    if (!d){ UI.draw(); return; }                       // 只是悬停：重画笔尖圈／橡皮筋
    const [x, y] = this._constrain(d, [pt[0], pt[1]], e.shiftKey);
    const last = d.pts[d.pts.length - 1];
    if (Math.abs(last[0] - x) + Math.abs(last[1] - y) > 0.25){
      d.pts.push([x, y, pressureOf(e)]);
      if (d.ren) this._feed(d);
    }
    UI.draw();
  },
  _feed(d){
    const L = d.L, add = d.pts.slice(d.fed).map(q => ({ x: q[0] - L.x, y: q[1] - L.y, pressure: q[2] }));
    d.fed = d.pts.length;
    d.ren.push(add);
    if (!d.lockA) d.ren.preview(L.data.ctx, d.pre, d.sel);
  },

  /* canvas.rs:2110-2140 Up ＋ 2144-2182 finish_gesture ＋ eraser_ui.rs:38-54 */
  onUp(e, pt, P){
    if (this._resize){ this._resizeTo(pt); this._resize = null; UI.draw(); return; }
    const d = this._drag; this._drag = null;
    if (!d){ UI.draw(); return; }
    const [x, y] = this._constrain(d, [pt[0], pt[1]], e.shiftKey);
    const last = d.pts[d.pts.length - 1];
    if (last[0] !== x || last[1] !== y) d.pts.push([x, y, last[2]]);
    const end = d.pts[d.pts.length - 1];
    this._lastEnd = { key: docKey(), pt: [end[0], end[1]] };     // 下一次 Shift＋点从这里接
    const points = d.pts.map(q => q.slice());
    let cmd, params;
    if (d.mode === 'eraser'){
      // 先把预览擦掉的还原，再走命令重算一次：历史快照才是下笔前的样子，agent 走命令也得到一模一样的像素
      d.L.data.ctx.putImageData(d.pre, 0, 0);
      const b = d.b;
      cmd = 'eraser.stroke';
      params = { points, layerId: d.L.id, size: b.size, hardness: b.hardness, opacity: b.opacity, flow: b.flow, spacing: b.spacing,
                 smoothing: b.smoothing, pressureSize: b.pressureSize, pressureOpacity: b.pressureOpacity };
    } else {
      const o = this.opt, b = resolveBrush(this, {});
      cmd = 'eraser.background';
      params = { points, layerId: d.L.id, size: b.size, hardness: b.hardness, flow: b.flow, spacing: b.spacing, smoothing: b.smoothing,
                 pressureSize: b.pressureSize, sampling: o.bgSampling, limits: o.bgLimits, tolerance: o.bgTolerance,
                 protectForegroundColor: o.bgProtectFg, foreground: UI.fill(), background: bgSw(o) };
    }
    this.lastParams = { cmd, params };
    CMD.run(cmd, params);
  },

  /* brush_resize.rs:87-99 update ＋ 47-55 resized */
  _resizeTo(pt){
    const r = this._resize; r.at = pt;
    const z = (window.UI && UI.zoom > 0) ? UI.zoom : 1;
    const dx = pt[0] - r.anchor[0], dy = pt[1] - r.anchor[1];
    const size = clamp(Math.round(r.start[0] + 2 * (isFinite(dx) ? dx : 0)), SIZE_MIN, SIZE_MAX);
    let hard = clamp(r.start[1] + (isFinite(dy) ? dy : 0) * z / HARDNESS_TRAVEL, 0, 1);
    hard = Math.round(hard * 100) / 100;
    if (size !== ToolState.size || hard !== ToolState.hardness) CMD.run('eraser.setOptions', { size, hardness: hard });
    else UI.draw();
  },

  onKey(e){
    // shortcuts.rs:290-301：同键工具组，Shift+E 轮换下一颗（橡皮擦 → 背景橡皮擦 → 魔术橡皮擦）
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'E' || e.key === 'e')){
      CMD.run('eraser.setOptions', { mode: MODES[(MODES.indexOf(this.mode) + 1) % MODES.length] });
      return true;
    }
    // shortcuts.rs:307-318：[ 缩小、] 放大（×1.25，取整，至少 +1）
    if (e.key !== '[' && e.key !== ']') return false;
    const size = ToolState.size;
    const next = e.key === '['
      ? Math.round(Math.max(size / 1.25, 1))
      : Math.max(Math.round(Math.min(size * 1.25, BAR_SIZE_MAX)), size + 1);
    if (next !== size) CMD.run('eraser.setOptions', { size: next });
    return true;
  },

  onDeactivate(){
    // 画到一半被换工具：把预览还原，不提交
    if (this._drag && this._drag.pre) this._drag.L.data.ctx.putImageData(this._drag.pre, 0, 0);
    this._drag = null; this._resize = null; this._hover = null;
  },

  /* 选项栏（eraser_ui.rs:61-103、panels.rs:426-435／508-535）：每一格都只是叫 eraser.setOptions */
  buildOptions(box, add, mk){
    const o = this.opt;
    const btnRow = (labelKey, items, cur, onPick, dataKey) => {
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-right:8px';
      const t = document.createElement('span'); t.textContent = Lang.t(labelKey); t.style.marginRight = '4px'; wrap.appendChild(t);
      for (const [v, k] of items){
        const b = document.createElement('button'); b.type = 'button'; b.textContent = Lang.t(k);
        b.dataset[dataKey] = v;
        const on = v === cur;
        b.style.cssText = 'padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid ' + (on ? '#5b8def' : '#555') +
                          ';background:' + (on ? '#2f4f8a' : 'transparent') + ';color:inherit;font:inherit';
        b.onclick = () => onPick(v);
        wrap.appendChild(b);
      }
      box.appendChild(wrap);
    };
    const num = (key, val, min, max, toOpt) => {
      const n = mk('number', { min, max, value: val });
      n.dataset.eraser = key; n.style.width = '58px';
      n.onchange = n.oninput = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('eraser.setOptions', toOpt(+n.value)); };
      return n;
    };
    const chk = (key, val, toOpt) => {
      const c = mk('checkbox', { checked: !!val }); c.dataset.eraser = key;
      c.onchange = () => CMD.run('eraser.setOptions', toOpt(c.checked));
      return c;
    };
    // 模式（PS 的工具组飞出选单；state.rs:31）
    btnRow('opt.eraser.mode', MODES.map(m => [m, 'ui.eraser.mode.' + m]), this.mode, m => CMD.run('eraser.setOptions', { mode: m }), 'eraserMode');
    if (this.mode === 'eraser'){
      add('size',     num('size', ToolState.size, 1, BAR_SIZE_MAX, v => ({ size: clamp(v, 1, BAR_SIZE_MAX) })));
      add('hardness', num('hardness', Math.round(ToolState.hardness * 100), 0, 100, v => ({ hardness: v / 100 })));
      add('eraser.opacity',   num('opacity',   Math.round(o.opacity * 100), 0, 100, v => ({ opacity: v / 100 })));
      add('eraser.flow',      num('flow',      Math.round(o.flow * 100), 1, 100, v => ({ flow: clamp(v, 1, 100) / 100 })));
      add('eraser.smoothing', num('smoothing', Math.round(o.smoothing * 100), 0, 100, v => ({ smoothing: v / 100 })));
      add('eraser.pressureSize', chk('pressureSize', o.pressureSize, v => ({ pressureSize: v })));
      add('eraser.pressureOpacity', chk('pressureOpacity', o.pressureOpacity, v => ({ pressureOpacity: v })));
    } else if (this.mode === 'background'){
      // 他们这里是笔刷预设小片（大小／硬度在里面）；我们没有预设小片 ⇒ 直接给大小、硬度两格
      add('size',     num('size', ToolState.size, 1, BAR_SIZE_MAX, v => ({ size: clamp(v, 1, BAR_SIZE_MAX) })));
      add('hardness', num('hardness', Math.round(ToolState.hardness * 100), 0, 100, v => ({ hardness: v / 100 })));
      btnRow('opt.eraser.sampling', SAMPLINGS.map(s => [s, 'ui.eraser.sampling.' + s]), o.bgSampling, s => CMD.run('eraser.setOptions', { bgSampling: s }), 'eraserSampling');
      const sel = document.createElement('select'); sel.dataset.eraser = 'bgLimits';
      for (const l of LIMITS){ const op = document.createElement('option'); op.value = l; op.textContent = Lang.t('ui.eraser.limits.' + l); sel.appendChild(op); }
      sel.value = o.bgLimits; sel.onchange = () => CMD.run('eraser.setOptions', { bgLimits: sel.value });
      add('eraser.limits', sel);
      add('eraser.bgTolerance', num('bgTolerance', o.bgTolerance, 0, 100, v => ({ bgTolerance: v })));
      add('eraser.protectFg', chk('bgProtectFg', o.bgProtectFg, v => ({ bgProtectFg: v })));
      if (o.bgSampling === 'backgroundSwatch'){
        // 原码取工具箱的背景色；这一格就是工具箱背景色（#strokeColor）的另一个入口，改哪边都一样
        const c = mk('color', { value: bgSw(o) }); c.dataset.eraser = 'bgSwatch';
        c.oninput = c.onchange = () => CMD.run('eraser.setOptions', { bgSwatch: c.value });
        add('eraser.swatch', c);
      }
    } else {
      add('tolerance', num('tolerance', ToolState.tolerance, 0, 255, v => ({ tolerance: v })));
      add('eraser.antiAlias', chk('antiAlias', ToolState.antiAlias, v => ({ antiAlias: v })));
      add('eraser.contiguous', chk('contiguous', ToolState.contiguous, v => ({ contiguous: v })));
      add('eraser.sampleAll', chk('sampleAllLayers', ToolState.sampleAllLayers, v => ({ sampleAllLayers: v })));
      add('eraser.magicOpacity', num('magicOpacity', o.magicOpacity, 1, 100, v => ({ magicOpacity: v })));
    }
  },
  /* 选项改了（快捷键、Ctrl+Alt 拖、agent 叫命令）⇒ 把选项栏上的数字对齐，不重建（免得打字时失焦） */
  _syncBar(){
    if (Tools.current() !== this) return;
    const o = this.opt;
    const v = { size: ToolState.size, hardness: Math.round(ToolState.hardness * 100),
                opacity: Math.round(o.opacity * 100), flow: Math.round(o.flow * 100), smoothing: Math.round(o.smoothing * 100),
                pressureSize: o.pressureSize, pressureOpacity: o.pressureOpacity,
                bgLimits: o.bgLimits, bgTolerance: o.bgTolerance, bgProtectFg: o.bgProtectFg, bgSwatch: bgSw(o),
                tolerance: ToolState.tolerance, antiAlias: ToolState.antiAlias, contiguous: ToolState.contiguous,
                sampleAllLayers: ToolState.sampleAllLayers, magicOpacity: o.magicOpacity };
    document.querySelectorAll('#optBody [data-eraser]').forEach(el => {
      if (el === document.activeElement) return;
      const k = el.dataset.eraser;
      if (!(k in v)) return;
      if (el.type === 'checkbox') el.checked = !!v[k]; else el.value = v[k];
    });
  },

  /* 叠画：canvas.rs:1598-1646 笔尖圈（预设「正常笔尖」＝ 50% 等高线：r·(0.5+0.5·硬度)）＋ brush_tip_centre 中心十字、
     brush_resize.rs:101-153 改笔尖时圈固定在起点＋红色笔尖预览＋读数、stroke_constraint.rs:95-123 Shift 橡皮筋、
     canvas.rs:1878-1888 ＋ stroke_trail.rs 背景橡皮擦拖曳时的半透明笔迹（白 α60） */
  drawOverlay(ctx, s){
    if (this.mode === 'magic') return;                       // 魔术橡皮擦：系统十字游标就够了
    const z = (window.UI && UI.zoom > 0) ? UI.zoom : 1;
    const dpr = s / z;                                       // 萤幕点 → 画布像素
    const ring = (cx, cy, r) => {
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,' + (140 / 255) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, (r + 0.5) * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (220 / 255) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, r * dpr, 0, Math.PI * 2); ctx.stroke();
    };
    const cross = (cx, cy, len) => {
      for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (140 / 255) + ')'], [1, 'rgba(255,255,255,' + (220 / 255) + ')']]){
        ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
        ctx.moveTo(cx - len * dpr, cy); ctx.lineTo(cx + len * dpr, cy);
        ctx.moveTo(cx, cy - len * dpr); ctx.lineTo(cx, cy + len * dpr); ctx.stroke();
      }
    };
    ctx.save();
    const full = Math.max(ToolState.size / 2 * z, 1);
    if (this._resize){
      const r = this._resize, cx = r.anchor[0] * s, cy = r.anchor[1] * s, R = full * dpr;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      const red = 'rgba(255,0,0,' + (110 / 255) + ')';
      g.addColorStop(0, red); g.addColorStop(clamp(ToolState.hardness, 0, 1), red); g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ring(cx, cy, full);
      // 读数（直径／硬度）贴在指针旁
      const at = r.at || r.anchor, tx = at[0] * s + 16 * dpr, ty = at[1] * s + 18 * dpr;
      const lines = [Lang.t('ui.eraser.diameter') + ' ' + Math.round(ToolState.size) + ' px',
                     Lang.t('ui.eraser.hardness') + ' ' + Math.round(ToolState.hardness * 100) + '%'];
      ctx.font = (11.5 * dpr) + 'px sans-serif';
      const wBox = Math.max(...lines.map(t => ctx.measureText(t).width)) + 14 * dpr;
      ctx.fillStyle = 'rgba(30,32,36,0.92)'; ctx.fillRect(tx, ty, wBox, 36 * dpr);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
      lines.forEach((t, i) => ctx.fillText(t, tx + 7 * dpr, ty + (4 + i * 15) * dpr));
      ctx.restore(); return;
    }
    // 背景橡皮擦拖曳中：笔迹（各段胶囊的联集，重叠不加深）
    const d = this._drag;
    if (d && d.mode === 'background' && d.pts.length){
      const W = ctx.canvas.width, H = ctx.canvas.height;
      if (!this._trail || this._trail.width !== W || this._trail.height !== H){
        this._trail = document.createElement('canvas'); this._trail.width = W; this._trail.height = H;
      }
      const tc = this._trail.getContext('2d');
      tc.clearRect(0, 0, W, H);
      tc.strokeStyle = tc.fillStyle = '#fff'; tc.lineCap = tc.lineJoin = 'round'; tc.lineWidth = Math.max(ToolState.size, 1) * s;
      tc.beginPath(); d.pts.forEach((q, i) => i ? tc.lineTo(q[0] * s, q[1] * s) : tc.moveTo(q[0] * s, q[1] * s));
      if (d.pts.length === 1){ tc.arc(d.pts[0][0] * s, d.pts[0][1] * s, Math.max(ToolState.size, 1) / 2 * s, 0, Math.PI * 2); tc.fill(); }
      else tc.stroke();
      ctx.globalAlpha = 60 / 255; ctx.drawImage(this._trail, 0, 0); ctx.globalAlpha = 1;
    }
    const h = this._hover;
    if (h){
      const cx = h[0] * s, cy = h[1] * s;
      const r = Math.max(full * (0.5 + 0.5 * clamp(ToolState.hardness, 0, 1)), 1);
      ring(cx, cy, r);
      if (r > 6 || this.mode === 'background') cross(cx, cy, 3);     // brush_tip_centre：半径 > 6 或背景橡皮擦 ⇒ 中心十字
      // Shift 且没在画、这份文件有上一笔 ⇒ 从上一笔终点到指针的橡皮筋
      if (this._shift && !this._drag && this._lastEnd && this._lastEnd.key === docKey()){
        const a = this._lastEnd.pt;
        for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (120 / 255) + ')'], [1, 'rgba(255,255,255,' + (230 / 255) + ')']]){
          ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
          ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(cx, cy); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
});

/* ═══════════ 命令（agent 与人走同一条路） ═══════════ */

const pixelLayer = p => {
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`active layer is a ${L.kind} layer, not a pixel layer`};
  return {L};
};

/* brush_cmds.rs:267-273 paint_stroke（erase:true 那一支）＋ 215-230 stroke_with ＋ render.rs:661-677 render_stroke */
CMD.reg('eraser.stroke', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?]…] 文件坐标（滑鼠 pressure=1）, size? 直径px（预设＝工具现值）, hardness? 0..1, '
       + 'opacity? 0..1 整笔上限, flow? 0..1 每个笔印, spacing? 0.01..10 直径的倍数=0.1, smoothing? 0..1（预设 0.1）, '
       + 'pressureSize? bool=true, pressureOpacity? bool=false, brush?:{size,hardness,opacity,flow,spacing,smoothing:{amount},pressureSize,pressureOpacity}, layerId?} '
       + '橡皮擦一笔：把像素层擦成透明（有选区只擦选区内）；一笔一步历史；回传 damage=[x,y,w,h] 文件坐标'},
  p => {
    const t = pixelLayer(p); if (t.error) return {ok:false, error:t.error};
    const r = parsePoints(p.points); if (r.error) return {ok:false, error:r.error};
    const L = t.L, b = resolveBrush(T, p);
    const W = L.data.canvas.width, H = L.data.canvas.height, ctx = L.data.ctx;
    const ren = new EraseRenderer(W, H, b);
    ren.push(r.pts.map(q => ({ x: q.x - L.x, y: q.y - L.y, pressure: q.pressure })));   // 文件坐标 → 图层坐标
    ren.finish();
    if (ren.bounds) ren.compositeAll(ctx, ctx.getImageData(0, 0, W, H), selFor(L));
    const d = ren.bounds;
    return { ok:true, erased:true, dabs: ren.dabs,
             damage: d ? [d[0] + L.x, d[1] + L.y, d[2] - d[0], d[3] - d[1]] : [0, 0, 0, 0] };
  });

/* eraser_cmds.rs:124-163 paint.backgroundEraser ＋ bg_erase.rs apply_background_eraser */
CMD.reg('eraser.background', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?]…] 文件坐标, size?, hardness? 0..1, flow?, spacing?, smoothing?, pressureSize?（同 eraser.stroke，预设＝工具现值）, '
       + 'sampling:"continuous|once|backgroundSwatch"="continuous", limits:"discontiguous|contiguous|findEdges"="contiguous", '
       + 'tolerance:0..100=50, protectForegroundColor:bool=false, foreground?:"#rrggbb"（预设＝填色）, background?:"#rrggbb"（背景色板，预设＝工具箱背景色）, layerId?} '
       + '背景橡皮擦一笔：沿笔画取样笔尖中心的颜色，只把笔尖内颜色相近的像素擦成透明；一笔一步历史'},
  p => {
    const r = parsePoints(p.points); if (r.error) return {ok:false, error:r.error};
    if (r.pts.some(q => Math.abs(q.x) > 1e7 || Math.abs(q.y) > 1e7)) return {ok:false, error:'`points` must be finite canvas coordinates'};
    const b = resolveBrush(T, p);
    if (!(isFinite(b.size) && b.size <= 5000)) return {ok:false, error:'`size` must be at most 5000 px'};
    const sa = enumParam(p, 'sampling', 'continuous', SAMPLINGS); if (sa.error) return {ok:false, error:sa.error};
    const li = enumParam(p, 'limits', 'contiguous', LIMITS);      if (li.error) return {ok:false, error:li.error};
    const to = numParam(p, 'tolerance', 50, 0, 100);              if (to.error) return {ok:false, error:to.error};
    const t = pixelLayer(p); if (t.error) return {ok:false, error:t.error};
    const L = t.L;
    const bs = { sampling: sa.v, limits: li.v, tolerance: to.v / 100, protectFg: flag(p, 'protectForegroundColor', false),
                 fg: rgb01(p.foreground, rgb01(window.UI ? UI.fill() : '#000000', [0, 0, 0])), swatch: rgb01(p.background, rgb01(bgSw(T.opt), [1, 1, 1])) };
    unlockBackground(L);                                         // eraser_cmds.rs:157 背景层先变「图层 0」才能有透明
    const res = backgroundErase(L, r.pts.map(q => ({ x: q.x - L.x, y: q.y - L.y, pressure: q.pressure })), b, bs, selFor(L));
    const d = res && res.bounds;
    return { ok:true, erased:true, dabs: res ? res.dabs : 0,
             damage: d ? [d[0] + L.x, d[1] + L.y, d[2] - d[0], d[3] - d[1]] : [0, 0, 0, 0] };
  });

/* eraser_cmds.rs:58-69 is_background／unlock_background：PS 擦成透明之前先把「背景」变成普通层「图层 0」（背景层不能有透明）。
   回一个还原函数（没擦到东西时退回去）；不是背景层回 null */
function unlockBackground(L){
  const isBg = window.PsLayer && PsLayer.isBackground ? PsLayer.isBackground(L) : !!L.isBackground;
  if (!isBg) return null;
  const keep = {name:L.name, isBackground:L.isBackground, locks:L.locks ? Object.assign({}, L.locks) : undefined};
  L.name = Lang.t('layer.untitled') + ' 0'; L.isBackground = false;
  if (L.locks){ L.locks.transparency = false; L.locks.position = false; }
  if (window.UI && UI.refresh) setTimeout(() => UI.refresh(), 0);
  return () => { L.name = keep.name; if (keep.isBackground === undefined) delete L.isBackground; else L.isBackground = keep.isBackground; if (keep.locks) L.locks = keep.locks; };
}

/* eraser_cmds.rs:84-122 paint.magicEraser ＋ selection.rs wand_region ＋ erase.rs magic_erase */
CMD.reg('eraser.magic', {i18n:'', undoable:true,
  params:'{x,y 文件坐标（取整）, tolerance:0..255=32, antiAlias:bool=true, contiguous:bool=true, sampleAllLayers:bool=false, opacity:1..100=100, layerId?} '
       + '魔术橡皮擦：把落点那一片相近颜色擦成透明（有选区只擦选区内）；点在文件外或什么都没擦＝回 {ok:false, noop:true, erased:false}（不是错误，只是不进历史）；擦了回 {ok:true, erased:true, damage:[x,y,w,h]}'},
  p => {
    const coord = k => isNum(p[k]) && Math.abs(p[k]) < 1e9 ? Math.floor(p[k]) : null;
    const x = coord('x'), y = coord('y');
    if (x === null) return {ok:false, error:'missing or invalid `x`'};
    if (y === null) return {ok:false, error:'missing or invalid `y`'};
    const to = numParam(p, 'tolerance', 32, 0, 255); if (to.error) return {ok:false, error:to.error};
    const op = numParam(p, 'opacity', 100, 1, 100);  if (op.error) return {ok:false, error:op.error};
    const t = pixelLayer(p); if (t.error) return {ok:false, error:t.error};
    const L = t.L;
    const none = {ok:false, noop:true, erased:false, damage:[0, 0, 0, 0]};   // 空操作：不是错误，但不进历史（CMD.run 见 ok:false 就弹掉快照）
    // 点在文件外：什么都不擦、也不留历史
    if (x < 0 || y < 0 || x >= Doc.width || y >= Doc.height) return none;
    const img = sampleRGBA8(L, flag(p, 'sampleAllLayers', false));
    const region = wandRegion(img, Doc.width, Doc.height, x, y, to.v, flag(p, 'contiguous', true), flag(p, 'antiAlias', true));
    if (!region) return none;
    const wasBg = unlockBackground(L);                           // eraser_cmds.rs:113
    const d = magicErase(L, region, op.v / 100, selFor(L));
    if (!d){ if (wasBg) wasBg(); return none; }
    return { ok:true, erased:true, damage:[d[0], d[1], d[2] - d[0], d[3] - d[1]] };
  });

/* 工具选项（tools.setBrush 与 tool_options 的橡皮擦版；工具状态，不进历史——brush_resize.rs:7-9） */
CMD.reg('eraser.setOptions', {i18n:'',
  params:'{mode? "eraser|background|magic", size? 1..5000 px（与笔刷共用）, hardness? 0..1（与笔刷共用）, opacity? 0..1, flow? 0..1, smoothing? 0..1, '
       + 'pressureSize? bool, pressureOpacity? bool, bgSampling? "continuous|once|backgroundSwatch", bgLimits? "discontiguous|contiguous|findEdges", '
       + 'bgTolerance? 0..100, bgProtectFg? bool, bgSwatch? "#rrggbb", tolerance? 0..255（与油漆桶共用）, antiAlias? bool, contiguous? bool, '
       + 'sampleAllLayers? bool, magicOpacity? 1..100} 改橡皮擦选项（不进历史）；回传全部现值。传 {} 只读现值'},
  p => {
    const o = T.opt, oldMode = T.mode, oldSampling = o.bgSampling;
    if (MODES.includes(p.mode)) T.mode = p.mode;
    if (isNum(p.size))      ToolState.size = clamp(p.size, SIZE_MIN, SIZE_MAX);
    if (isNum(p.hardness))  ToolState.hardness = clamp(p.hardness, 0, 1);
    if (isNum(p.opacity))   o.opacity = clamp(p.opacity, 0, 1);
    if (isNum(p.flow))      o.flow = clamp(p.flow, 0, 1);
    if (isNum(p.smoothing)) o.smoothing = clamp(p.smoothing, 0, 1);
    if (typeof p.pressureSize === 'boolean')    o.pressureSize = p.pressureSize;
    if (typeof p.pressureOpacity === 'boolean') o.pressureOpacity = p.pressureOpacity;
    if (SAMPLINGS.includes(p.bgSampling)) o.bgSampling = p.bgSampling;
    if (LIMITS.includes(p.bgLimits))      o.bgLimits = p.bgLimits;
    if (isNum(p.bgTolerance)) o.bgTolerance = clamp(p.bgTolerance, 0, 100);
    if (typeof p.bgProtectFg === 'boolean') o.bgProtectFg = p.bgProtectFg;
    if (typeof p.bgSwatch === 'string' && rgb01(p.bgSwatch, null)){
      o.bgSwatch = hexOf(rgb01(p.bgSwatch, null));
      const e = typeof document !== 'undefined' && document.getElementById('strokeColor');   // 色板＝工具箱背景色：两边一起改
      if (e && e.value.toLowerCase() !== o.bgSwatch){ e.value = o.bgSwatch; e.dispatchEvent(new Event('input', {bubbles:true})); }
    }
    if (isNum(p.tolerance)) ToolState.tolerance = clamp(p.tolerance, 0, 255);
    if (typeof p.antiAlias === 'boolean') ToolState.antiAlias = p.antiAlias;
    if (typeof p.contiguous === 'boolean') ToolState.contiguous = p.contiguous;
    if (typeof p.sampleAllLayers === 'boolean') ToolState.sampleAllLayers = p.sampleAllLayers;
    if (isNum(p.magicOpacity)) o.magicOpacity = clamp(p.magicOpacity, 1, 100);
    if (Tools.current() === T && window.UI && UI.canvas && (T.mode !== oldMode || o.bgSampling !== oldSampling)){
      // 换模式／换取样方式：选项栏换一套、游标跟着换（画到一半就先收掉预览）
      if (T.mode !== oldMode) T.onDeactivate();
      UI.buildOptions(T.id); UI.canvas.style.cursor = T.cursor;
    }
    T._syncBar();
    return { ok:true, mode:T.mode, size:ToolState.size, hardness:ToolState.hardness, opacity:o.opacity, flow:o.flow,
             spacing:o.spacing, smoothing:o.smoothing, pressureSize:o.pressureSize, pressureOpacity:o.pressureOpacity,
             bgSampling:o.bgSampling, bgLimits:o.bgLimits, bgTolerance:o.bgTolerance, bgProtectFg:o.bgProtectFg, bgSwatch:bgSw(o),
             tolerance:ToolState.tolerance, antiAlias:ToolState.antiAlias, contiguous:ToolState.contiguous,
             sampleAllLayers:ToolState.sampleAllLayers, magicOpacity:o.magicOpacity };
  });

})();
