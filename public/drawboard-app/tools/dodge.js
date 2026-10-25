/* 减淡工具（O）：在像素层上拖曳＝把笔刷扫过的地方调亮（范围 阴影／中间调／高光、曝光度、保护色调）。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - engine/src/retouch_cmds.rs 452–529   per_dab、color_dab、tone_range、dodge_burn_cmd、sponge_cmd、parse_brush（63–98）
   - algo/src/retouch.rs 1–110            luma、tone_curve、compress_gamut、dodge_burn、saturation、sponge
   - paint/src/retouch.rs 80–117、219–292  Footprint、apply_dab_stroke（逐 dab 改工作副本、收笔按不透明度×选区混回）、mix_premultiplied
   - paint/src/render.rs 143–245          dab_rect、rasterize（圆笔尖：dab_coverage × flow）、footprint
   - paint/src/dynamics.rs 450–505        radius＝max(直径/2,0.5)、dab.alpha＝flow
   - ui-egui/src/retouch_ui.rs 46–50、170–182   收笔叫命令（range/exposure/protectTones；sponge 的 mode/vibrance）、选项栏
   - ui-egui/src/state.rs 338–343、435–439      选项预设：midtones / 50% / 保护色调开；去色 / 自然饱和度开
   - ui-egui/src/canvas.rs 263–286、210–221     减淡加深海绵是「自由路径」工具；笔尖圆圈大于 6 屏幕点才画中心十字
   - ui-egui/src/stroke_trail.rs、stroke_constraint.rs、brush_resize.rs（照 tools/clone.js 那份翻译抄一份）
   共用：这支档把三颗工具（减淡／加深／海绵）共用的算法与手势挂在 window.Toning；burn.js、sponge.js 只读它、各自登记一颗工具。
   命令：dodge.stroke / dodge.setOptions（burn.js 登记 burn.stroke / burn.setOptions，sponge.js 登记 sponge.stroke / sponge.setOptions） */
(function(){

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const asNum  = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const asBool = (v, d) => typeof v === 'boolean' ? v : d;
const roundAway = v => v < 0 ? -Math.round(-v) : Math.round(v);     // Rust f64::round：.5 远离 0

/* ───────── algo/src/retouch.rs：每像素的调色核 ───────── */
/* Rec. 601 亮度 */
const luma = c => 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
/* tone_curve：单一值 v（0..1）在强度 e（0..1）下的减淡／加深曲线 */
function toneCurve(v, e, range, burn){
  v = Math.max(v, 0); e = clamp(e, 0, 1);
  const m = Math.min(v, 1);
  if (range === 'midtones'){
    // 伽玛弯曲，权重在中灰最大：0 与 1 是不动点
    const w = clamp(4*v*(1 - v), 0, 1);
    return burn ? v + w*(Math.pow(m, 1 + e) - v) : v + w*(Math.pow(m, 1/(1 + e)) - v);
  }
  // 阴影／高光：v + e·w·(目标 − v)，权重 (1−v)² 或 v²
  if (range === 'shadows') return burn ? v - e*(1 - m)**2*v : v + e*(1 - m)**2*(1 - m);
  return burn ? v - e*m*m*v : v + e*m*m*(1 - m);                          // highlights
}
/* compress_gamut：超出 0..1 时朝亮度灰混回来（保留亮度），不逐通道裁切（裁切会偏色相） */
function compressGamut(c, l){
  l = clamp(l, 0, 1);
  const lo = Math.min(c[0], c[1], c[2]), hi = Math.max(c[0], c[1], c[2]);
  let t = 1;
  if (hi > 1 && hi - l > 1e-9) t = Math.min(t, (1 - l)/(hi - l));
  if (lo < 0 && l - lo > 1e-9) t = Math.min(t, l/(l - lo));
  return [l + (c[0] - l)*t, l + (c[1] - l)*t, l + (c[2] - l)*t];
}
/* dodge_burn：保护色调＝曲线只套在亮度上、颜色按新亮度等比缩放（色相饱和度不变、超色域压回）；否则每通道各套曲线 */
function dodgeBurn(c, e, range, burn, protect){
  if (e <= 0) return c;
  if (protect){
    const l = luma(c), nl = toneCurve(l, e, range, burn);
    const out = l > 1e-6 ? [c[0]*nl/l, c[1]*nl/l, c[2]*nl/l] : [nl, nl, nl];
    return compressGamut(out, nl);
  }
  return [toneCurve(c[0], e, range, burn), toneCurve(c[1], e, range, burn), toneCurve(c[2], e, range, burn)];
}
/* HSV 式饱和度（色度 / 最大值） */
function saturation(c){
  const lo = Math.min(c[0], c[1], c[2]), hi = Math.max(c[0], c[1], c[2]);
  return hi <= 1e-6 ? 0 : clamp((hi - lo)/hi, 0, 1);
}
/* sponge：把颜色推离（加色）或拉向（去色）它的亮度灰；自然饱和度＝加色时已饱和的少动、去色时近灰的少动 */
function sponge(c, amount, saturate, vibrance){
  let a = clamp(amount, 0, 1);
  if (a <= 0) return c;
  const s = saturation(c);
  if (vibrance) a *= saturate ? 1 - s : 0.25 + 0.75*s;
  const l = luma(c), k = saturate ? 1 + a : 1 - a;
  return compressGamut([l + (c[0] - l)*k, l + (c[1] - l)*k, l + (c[2] - l)*k], l);
}

/* ───────── paint/src/lib.rs、dynamics.rs、render.rs：dab（照 tools/clone.js 97–166 那份翻译抄一份） ───────── */
/* 圆 dab 在距圆心 d 处的覆盖率（边缘 1px 反锯齿 × smoothstep 硬度衰减） */
function dabCoverage(d, radius, hardness){
  if (d >= radius + 0.5) return 0;
  const edge = Math.min(Math.max(radius + 0.5 - d, 0), 1);
  const h = Math.min(Math.max(hardness, 0), 1);
  const inner = radius * h;
  let falloff;
  if (d <= inner || radius - inner < 1e-3) falloff = 1;
  else {
    const t = Math.min(Math.max((d - inner) / (radius - inner), 0), 1);
    falloff = 1 - t*t*(3 - 2*t);
  }
  return edge * falloff;
}
/* dynamics.rs base_diameter：pressure_size 预设开 ⇒ 直径＝size × 压力（滑鼠压力＝1） */
const baseDiameter = (brush, q) => brush.size * Math.min(Math.max(q[2], 0), 1);
/* DabBuilder::step_len：max(直径,1) × spacing（至少 0.01），再至少 0.5 像素 */
const stepLen = (brush, q) => Math.max(Math.max(baseDiameter(brush, q), 1) * Math.max(brush.spacing, 0.01), 0.5);
/* PathWalker：沿折线每隔 step_len 像素落一个 dab；第一点等第二点来才吐出，整笔只有一点就收笔时吐 */
function walkDabs(points, brush){
  const out = [];
  let last = null, pending = null, nextAt = 0;
  for (const q of points){
    if (!last){ last = q; pending = q; nextAt = stepLen(brush, q); continue; }
    const dx = q[0]-last[0], dy = q[1]-last[1], len = Math.sqrt(dx*dx + dy*dy);
    if (pending){ out.push(pending); pending = null; }
    if (len > 1e-9){
      while (nextAt <= len + 1e-9){
        const t = Math.min(nextAt/len, 1);
        const p = [last[0] + dx*t, last[1] + dy*t, last[2] + (q[2]-last[2])*t];
        out.push(p);
        nextAt += Math.max(stepLen(brush, p), 0.25);
      }
      nextAt -= len;
    }
    last = q;
  }
  if (pending) out.push(pending);
  return out;
}
/* dab 外框（含 1px 反锯齿余量）[x0,y0,x1,y1)，render.rs dab_rect（圆笔尖不取样 ⇒ reach＝radius） */
function dabRect(c, radius){
  const rr = Math.ceil(radius) + 1, cx = Math.floor(c[0]), cy = Math.floor(c[1]);
  return [cx-rr, cy-rr, cx+rr+1, cy+rr+1];
}
/* render.rs footprint：一个 dab 的覆盖（硬度衰减 × flow），文件坐标 */
function footprint(d, brush){
  const radius = Math.max(baseDiameter(brush, d)/2, 0.5);
  const rect = dabRect(d, radius), W = rect[2]-rect[0], H = rect[3]-rect[1], cov = new Float32Array(W*H);
  const alpha = clamp(brush.flow, 0, 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    cov[y*W + x] = dabCoverage(Math.hypot(rect[0] + x + 0.5 - d[0], rect[1] + y + 0.5 - d[1]), radius, brush.hardness) * alpha;
  return { rect, cov, at(x, y){ return this.cov[(y - rect[1])*W + (x - rect[0])]; } };
}

/* ───────── retouch_cmds.rs per_dab／color_dab ───────── */
/* 每个 dab 的强度：让一点被扫过一次累计约 e，不管间距（中线上每点约有 1/spacing 个 dab 重叠） */
const perDab = (e, spacing) => 1 - Math.pow(1 - clamp(e, 0, 1), clamp(spacing, 0.01, 1));
/* 对 dab 覆盖到的每个像素套 RGB 变换 f(rgb, 强度)；alpha 不动 */
function colorDab(work, fp, strength, spacing, f){
  const r = [Math.max(fp.rect[0], work.rect[0]), Math.max(fp.rect[1], work.rect[1]), Math.min(fp.rect[2], work.rect[2]), Math.min(fp.rect[3], work.rect[3])];
  const W = work.rect[2] - work.rect[0], d = work.data;
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
    const k = perDab(fp.at(x, y) * strength, spacing);
    if (k <= 0) continue;
    const i = ((y - work.rect[1])*W + (x - work.rect[0]))*4;
    const o = f([d[i], d[i+1], d[i+2]], k);
    d[i] = o[0]; d[i+1] = o[1]; d[i+2] = o[2];
  }
}

/* ───────── paint/src/retouch.rs mix_premultiplied ───────── */
function mixPremultiplied(dst, src, k){
  const da = dst[3], sa = src[3], oa = da + (sa - da)*k;
  for (let c = 0; c < 3; c++)
    dst[c] = oa > 1e-6 ? (dst[c]*da + (src[c]*sa - dst[c]*da)*k)/oa : dst[c] + (src[c] - dst[c])*k;
  dst[3] = oa;
}

/* 选区覆盖度（文件坐标；路径／套索／羽化照真形状，同 clone.js） */
function selAt(x, y){
  const s = Doc.sel;
  if (!s) return 1;
  if (window.SelMask) return SelMask.coverage(x, y, s);
  const sx0 = Math.min(s.x, s.x+s.w), sy0 = Math.min(s.y, s.y+s.h), sx1 = Math.max(s.x, s.x+s.w), sy1 = Math.max(s.y, s.y+s.h);
  return (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) ? 1 : 0;
}

/* ───────── paint/src/retouch.rs apply_dab_stroke ─────────
   effect(work, fp) 逐个 dab 改工作副本（dab n 看得到 dab n−1 的结果）；完了按 不透明度 × 选区 混回图层。
   工作副本＝笔画外框 ∩ 图层画布（文件坐标；画布外在他们那边是透明、改了也没有像素可写）。回传外框 [x0,y0,x1,y1)。 */
function applyDabStroke(L, points, brush, effect){
  const ds = walkDabs(points, brush);
  if (!ds.length) return null;
  const fps = ds.map(d => footprint(d, brush));
  let B = null;
  for (const fp of fps){ const r = fp.rect; B = B ? [Math.min(B[0],r[0]), Math.min(B[1],r[1]), Math.max(B[2],r[2]), Math.max(B[3],r[3])] : r.slice(); }
  const cw = L.data.canvas.width, ch = L.data.canvas.height;
  const R = [Math.max(B[0], L.x), Math.max(B[1], L.y), Math.min(B[2], L.x + cw), Math.min(B[3], L.y + ch)];
  if (R[2] <= R[0] || R[3] <= R[1]) return B;
  const W = R[2]-R[0], H = R[3]-R[1];
  const ctx = L.data.ctx, img = ctx.getImageData(R[0] - L.x, R[1] - L.y, W, H), px = img.data;
  const work = { rect:R, data:new Float32Array(W*H*4) };
  for (let i = 0; i < px.length; i++) work.data[i] = px[i]/255;
  for (const fp of fps) effect(work, fp);
  const opacity = clamp(brush.opacity, 0, 1), lockA = !!(window.Locks && Locks.alpha(L));
  const o = [0,0,0,0], wv = [0,0,0,0];
  for (let y = R[1]; y < R[3]; y++) for (let x = R[0]; x < R[2]; x++){
    const k = opacity * selAt(x, y);
    if (k <= 0) continue;
    const i = ((y - R[1])*W + (x - R[0]))*4;
    for (let c = 0; c < 4; c++){ o[c] = px[i+c]/255; wv[c] = work.data[i+c]; }
    if (!lockA) mixPremultiplied(o, wv, k);
    else for (let c = 0; c < 3; c++) o[c] += (wv[c] - o[c])*k;          // 锁透明像素：alpha 不动、颜色直线混
    for (let c = 0; c < 4; c++) px[i+c] = Math.round(clamp(o[c], 0, 1)*255);
  }
  ctx.putImageData(img, R[0] - L.x, R[1] - L.y);
  return B;
}

/* ───────── retouch_cmds.rs parse_brush：points／size／hardness／opacity／flow／spacing／layer ───────── */
function parseBrush(p, C){
  if (!Array.isArray(p.points)) return {error:`${C}: missing \`points\``};
  const pts = p.points.filter(a => Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number')
                      .map(a => [a[0], a[1], typeof a[2] === 'number' ? a[2] : 1]);
  if (!pts.length) return {error:`${C}: \`points\` is empty`};
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`active layer is a ${L.kind} layer, not a pixel layer`};
  const pct = (k, d, lo, hi) => clamp(asNum(p[k], d), lo, hi) / 100;
  const brush = {
    size: Math.max(asNum(p.size, ToolState.size), 1),
    hardness: pct('hardness', ToolState.hardness*100, 0, 100),
    opacity: pct('opacity', 100, 1, 100),
    flow: pct('flow', 100, 1, 100),
    spacing: pct('spacing', 25, 1, 1000)
  };
  return { pts, L, brush };
}
/* 图层锁（engine 的 Locks 把关表还没列这三条命令 ⇒ 命令自己挡；最外层叫才提示） */
function lockFail(L, C){
  if (!window.Locks) return null;
  const k = Locks.blocks(L, 'pixels'); if (!k) return null;
  if (CMD._depth <= 1) Locks.notify(Locks.message(L, k));
  return Locks.fail(L, k, C);
}

/* dodge_burn_cmd */
const RANGES = ['shadows', 'midtones', 'highlights'];
function toneStroke(p, burn){
  const C = burn ? 'burn.stroke' : 'dodge.stroke';
  const b = parseBrush(p, C); if (b.error) return {ok:false, error:b.error};
  const range = typeof p.range === 'string' ? p.range : 'midtones';
  if (!RANGES.includes(range)) return {ok:false, error:`${C}: unknown range \`${range}\` (shadows|midtones|highlights)`};
  const exposure = clamp(asNum(p.exposure, 50), 1, 100) / 100;
  const protect = asBool(p.protectTones, true);
  const lf = lockFail(b.L, C); if (lf) return lf;
  const sp = b.brush.spacing;
  const B = applyDabStroke(b.L, b.pts, b.brush, (work, fp) => colorDab(work, fp, exposure, sp, (c, k) => dodgeBurn(c, k, range, burn, protect)));
  return { ok:true, damage: B ? [B[0], B[1], B[2]-B[0], B[3]-B[1]] : [0,0,0,0] };
}
/* sponge_cmd */
function spongeStroke(p){
  const C = 'sponge.stroke';
  const b = parseBrush(p, C); if (b.error) return {ok:false, error:b.error};
  const mode = typeof p.mode === 'string' ? p.mode : 'desaturate';
  if (mode !== 'desaturate' && mode !== 'saturate') return {ok:false, error:`${C}: unknown mode \`${mode}\` (desaturate|saturate)`};
  const saturate = mode === 'saturate', vibrance = asBool(p.vibrance, true);
  const lf = lockFail(b.L, C); if (lf) return lf;
  const sp = b.brush.spacing;
  // flow 已经乘进每个 dab 的覆盖；满 flow 扫一次＝颜色移动一半
  const B = applyDabStroke(b.L, b.pts, b.brush, (work, fp) => colorDab(work, fp, 0.5, sp, (c, k) => sponge(c, k, saturate, vibrance)));
  return { ok:true, damage: B ? [B[0], B[1], B[2]-B[0], B[3]-B[1]] : [0,0,0,0] };
}

const BRUSH_PARAMS = 'points:[[x,y,pressure?],…] 文件坐标（必填）, size=工具大小 px, hardness=0..100（工具硬度）, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, layerId?=当前层';

/* 选项（state.rs 435–439 预设）：减淡与加深共用一份（他们 tool_options 同一组栏位）；海绵另一份 */
const toneOpts = { range:'midtones', exposure:50, protectTones:true };
const spongeOpts = { mode:'desaturate', vibrance:true, flow:100 };

function setToneOptions(p, id){
  if (RANGES.includes(p.range)) toneOpts.range = p.range;
  if (typeof p.exposure === 'number' && isFinite(p.exposure)) toneOpts.exposure = clamp(Math.round(p.exposure), 1, 100);
  if (typeof p.protectTones === 'boolean') toneOpts.protectTones = p.protectTones;
  commonOptions(p);
  if (window.UI && (ToolState.cur === 'dodge' || ToolState.cur === 'burn')) UI.buildOptions(ToolState.cur);
  return Object.assign({}, toneOpts, { size:ToolState.size, hardness:Math.round(ToolState.hardness*100) });
}
function commonOptions(p){
  if (typeof p.size === 'number' && isFinite(p.size)) ToolState.size = clamp(Math.round(p.size), 1, 5000);
  if (typeof p.hardness === 'number' && isFinite(p.hardness)) ToolState.hardness = clamp(p.hardness, 0, 100) / 100;
}

/* ═════════ 手势（照 clone.js 那套：retouch_ui.rs finish_stroke、stroke_constraint.rs、stroke_trail.rs、brush_resize.rs） ═════════ */
const pressure = e => (e && e.pointerType === 'pen' && typeof e.pressure === 'number') ? e.pressure : 1;

/* stroke_constraint.rs：Shift 拖锁 0/45/90°；Shift 点一下从上一笔终点连直线 */
const LOCK_DISTANCE = 3;
function snappedDir(o, p, step){
  const dx = p[0]-o[0], dy = p[1]-o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const a = roundAway(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(a), Math.sin(a)];
}
function project(o, dir, p){
  const t = (p[0]-o[0])*dir[0] + (p[1]-o[1])*dir[1];
  return [o[0] + dir[0]*t, o[1] + dir[1]*t];
}
function constrain(d, last, p, shift){
  if (!shift){ d.axis = null; return p; }
  if (!d.axis) d.axis = { origin:last.slice(), dir:null };
  const a = d.axis;
  if (!a.dir){
    const reach = LOCK_DISTANCE / Math.max(UI.zoom, 1e-3);
    if (Math.hypot(p[0]-a.origin[0], p[1]-a.origin[1]) < reach) return a.origin.slice();
    a.dir = snappedDir(a.origin, p, Math.PI/4);
  }
  return a.dir ? project(a.origin, a.dir, p) : a.origin.slice();
}

/* stroke_trail.rs：拖曳时的半透明足迹（覆盖取最大，重叠不加深） */
const MAX_SIDE = 1024, TRAIL_ALPHA = 60;
function trailNew(){
  const k = Math.max(1, Math.ceil(Math.max(Doc.width, Doc.height) / MAX_SIDE));
  const w = Math.max(1, Math.ceil(Doc.width / k)), h = Math.max(1, Math.ceil(Doc.height / k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, x:c.getContext('2d'), k, w, h, cov:new Uint8Array(w*h), fed:0, dirty:null };
}
function trailCapsule(t, a, b, r){
  if (![a[0],a[1],b[0],b[1],r].every(isFinite)) return;
  const x0 = Math.max(Math.floor(Math.min(a[0], b[0]) - r - 1), 0), y0 = Math.max(Math.floor(Math.min(a[1], b[1]) - r - 1), 0);
  const x1 = Math.min(Math.ceil(Math.max(a[0], b[0]) + r + 1), t.w), y1 = Math.min(Math.ceil(Math.max(a[1], b[1]) + r + 1), t.h);
  if (x1 <= x0 || y1 <= y0) return;
  const dx = b[0]-a[0], dy = b[1]-a[1], len2 = dx*dx + dy*dy;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const px = x + 0.5 - a[0], py = y + 0.5 - a[1];
    const s = len2 > 0 ? Math.min(Math.max((px*dx + py*dy) / len2, 0), 1) : 0;
    const c = Math.round(Math.min(Math.max(r + 0.5 - Math.hypot(px - s*dx, py - s*dy), 0), 1) * 255);
    const i = y*t.w + x;
    if (c > t.cov[i]) t.cov[i] = c;
  }
  const D = t.dirty || (t.dirty = [x0, y0, x1, y1]);
  t.dirty = [Math.min(D[0], x0), Math.min(D[1], y0), Math.max(D[2], x1), Math.max(D[3], y1)];
}
function trailFeed(t, points, diameter){
  if (t.fed >= points.length) return;
  const r = (Math.max(diameter, 1) / 2) / t.k, m = q => [q[0]/t.k, q[1]/t.k];
  for (let i = t.fed; i < points.length; i++){
    const b = m(points[i]), a = i > 0 ? m(points[i-1]) : b;
    trailCapsule(t, a, b, r);
  }
  t.fed = points.length;
  if (t.dirty){
    const [x0, y0, x1, y1] = t.dirty, w = x1-x0, h = y1-y0, img = t.x.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const o = (y*w + x)*4;
      d[o] = d[o+1] = d[o+2] = 255; d[o+3] = Math.floor(t.cov[(y0+y)*t.w + x0 + x] * TRAIL_ALPHA / 255);
    }
    t.x.putImageData(img, x0, y0); t.dirty = null;
  }
}

/* brush_resize.rs：Ctrl+Alt 拖曳——左右改直径、上下改硬度 */
const HARDNESS_TRAVEL = 200;
function resized(start, dx, dy, zoom){
  dx = isFinite(dx) ? dx : 0; dy = isFinite(dy) ? dy : 0;
  zoom = (isFinite(zoom) && zoom > 0) ? zoom : 1;
  const size = clamp(Math.round(start[0] + 2*dx), 1, 5000);
  const hardness = clamp(start[1] + dy*zoom/HARDNESS_TRAVEL, 0, 1);
  return [size, Math.round(hardness*100)/100];
}

/* 造一颗调色笔工具。cfg：{id, order, icon, cmd(e)→命令 id, params()→命令选项, setOptions 命令 id, strings, buildOptions, altLabel?} */
function makeTool(cfg){
  const U = { drag:null, lastEnd:null, trail:null, resize:null, hover:null, alt:false, shift:false, status:null };
  /* 边拖边显示（同仿制图章，三颗都这样做）：按下时备份这一层；每帧把上一帧画过的那块还原，再用到目前为止的点整笔重算一次（不进历史）。
     放开时整层还原，再走 CMD 正式落一次（进历史，Ctrl+Z 一步退）。重算合并到下一个动画帧，拖快不会卡。 */
  const Live = {
    L:null, bak:null, dmg:null, raf:0, pts:null, cmd:null,
    begin(){
      const L = Doc.active(); this.L = null; this.dmg = null;
      if (!L || L.kind !== 'raster' || !L.data || !L.data.canvas) return;
      const cv = L.data.canvas, b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height;
      b.getContext('2d').drawImage(cv, 0, 0); this.L = L; this.bak = b;
    },
    restore(){
      const L = this.L, d = this.dmg; if (!L || !d) return;
      const x = Math.max(0, Math.floor(d[0] - L.x)), y = Math.max(0, Math.floor(d[1] - L.y));
      const w = Math.min(L.data.canvas.width - x, Math.ceil(d[0] + d[2] - L.x) - x + 1), h = Math.min(L.data.canvas.height - y, Math.ceil(d[1] + d[3] - L.y) - y + 1);
      if (w > 0 && h > 0){ const c = L.data.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        c.clearRect(x, y, w, h); c.drawImage(this.bak, x, y, w, h, x, y, w, h); c.restore(); }
      this.dmg = null;
    },
    schedule(points, cmd){
      this.pts = points; this.cmd = cmd;
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.run(); if (window.UI) UI.draw(); });
    },
    run(){
      if (!this.L || Doc.active() !== this.L || !this.pts) return;
      this.restore();
      const p = Object.assign(cfg.params(), { points:this.pts.map(q => q.slice()), layerId:this.L.id });
      const fn = CMD.map[this.cmd]; if (!fn) return;
      const r = fn.run(p); if (r && r.ok) this.dmg = r.damage;
    },
    end(){ if (this.raf){ cancelAnimationFrame(this.raf); this.raf = 0; } this.restore(); this.L = null; this.bak = null; this.pts = null; }
  };

  function finishStroke(points, cmd){
    Live.end();
    const p = Object.assign(cfg.params(), { points: points.map(q => [q[0], q[1], q[2]]) });
    const r = CMD.run(cmd, p);
    U.status = (r && r.ok === false) ? r.error : null;
  }
  function resizeUpdate(x, y){
    const r = U.resize;
    const [size, hardness] = resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
    if (ToolState.size === size && ToolState.hardness === hardness) return;
    ToolState.size = size; ToolState.hardness = hardness;                 // 拖曳中只改值不刷整个界面；放开再刷
  }

  const tool = Tools.reg({
    id:cfg.id, icon:cfg.icon, group:'raster', order:cfg.order, for:'raster', needs:'raster', opts:['size','hardness'],
    cursor:'none', ui:U, live:Live, strings:cfg.strings,
    buildOptions:cfg.buildOptions,

    onDown(e, pt, P){
      U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
      if (e.ctrlKey && e.altKey && !U.drag){                               // brush_resize::pointer
        U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] };
        UI.draw(); return;
      }
      P.ensureRaster();
      const L = Doc.active();
      if (window.Locks && L && Locks.deny(L, 'pixels')){ P.down = false; UI.draw(); return; }   // 图层锁：这一下不画
      const from = (e.shiftKey && U.lastEnd) ? U.lastEnd.slice() : null;
      const pr = pressure(e);
      const points = [[pt[0], pt[1], pr]];
      if (from) points.unshift([from[0], from[1], pr]);
      U.drag = { start: from || pt.slice(), points, axis:null, cmd:cfg.cmd(e) };
      U.trail = trailNew();
      trailFeed(U.trail, U.drag.points, ToolState.size);
      Live.begin(); Live.schedule(U.drag.points, U.drag.cmd);
      UI.draw();
    },
    onMove(e, pt, P){
      U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
      if (U.resize){ resizeUpdate(pt[0], pt[1]); UI.draw(); return; }
      const d = U.drag;
      if (d && P.down){
        const last = d.points.length ? d.points[d.points.length-1] : d.start;
        const q = constrain(d, last, pt, e.shiftKey);
        if (!d.points.length || Math.abs(last[0]-q[0]) + Math.abs(last[1]-q[1]) > 0.25) d.points.push([q[0], q[1], pressure(e)]);
        trailFeed(U.trail, d.points, ToolState.size);
        Live.schedule(d.points, d.cmd);
      }
      UI.draw();
    },
    onUp(e, pt){
      U.alt = e.altKey; U.shift = e.shiftKey;
      if (U.resize){
        resizeUpdate(pt[0], pt[1]); U.resize = null;
        CMD.run(cfg.setOptions, {});                                       // 放开：选项栏的大小／硬度跟上
        return;
      }
      const d = U.drag; U.drag = null; U.trail = null;
      if (!d){ UI.draw(); return; }
      const last = d.points.length ? d.points[d.points.length-1] : d.start;
      const q = constrain(d, last, pt, e.shiftKey);
      if (!d.points.length || last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], d.points.length ? last[2] : 1]);
      U.lastEnd = d.points[d.points.length-1].slice(0, 2);
      finishStroke(d.points, d.cmd);
      UI.refresh();
    },
    onDeactivate(){ if (U.drag) Live.end(); U.drag = null; U.trail = null; U.resize = null; U.hover = null; },

    drawOverlay(ctx, s){
      const z = UI.zoom, dpr = s / z, scr = q => [q[0]*s, q[1]*s];
      ctx.save();
      // 1 足迹：边拖边显示已经把真像素画上去 ⇒ 只有画不出来（例如层不对）时才留白色足迹
      if (U.trail && !Live.dmg){
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(U.trail.c, 0, 0, U.trail.w*U.trail.k*s, U.trail.h*U.trail.k*s);
      }
      const line = (a, b, w, col) => { ctx.lineWidth = w*dpr; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
      // 2 Shift 橡皮筋：上一笔终点 → 游标
      if (U.shift && U.lastEnd && !U.drag && U.hover && !U.resize){
        const a = scr(U.lastEnd), b = scr(U.hover);
        line(a, b, 2.5, 'rgba(0,0,0,0.47)'); line(a, b, 1, 'rgba(255,255,255,0.9)');
      }
      if (U.resize){
        // 3 Ctrl+Alt 改笔刷：圆圈钉在起点、红色笔尖预览、旁边读数
        const c = scr(U.resize.anchor), R = Math.max(ToolState.size/2*z, 1)*dpr, inner = R*clamp(ToolState.hardness, 0, 1);
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
        g.addColorStop(0, 'rgba(255,0,0,0.43)'); g.addColorStop(inner/R, 'rgba(255,0,0,0.43)'); g.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.fill();
        ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], R + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
        if (U.hover){
          const h = scr(U.hover), t1 = `${Lang.t('ui.toneDiameter')} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t('ui.toneHardness')} ${Math.round(ToolState.hardness*100)}%`;
          ctx.font = `${12*dpr}px sans-serif`;
          const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12*dpr;
          ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0]+14*dpr, h[1]+14*dpr, w, 38*dpr);
          ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0]+20*dpr, h[1]+29*dpr); ctx.fillText(t2, h[0]+20*dpr, h[1]+45*dpr);
        }
      } else if (U.hover){
        // 4 笔尖圆圈（完整半径 ×(0.5＋0.5×硬度)）；半径大于 6 屏幕点才画中心十字（canvas.rs brush_tip_centre）
        const c = scr(U.hover), full = Math.max(ToolState.size/2*z, 1);
        const rs = Math.max(full*(0.5 + 0.5*clamp(ToolState.hardness, 0, 1)), 1), r = rs*dpr;
        ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], r + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI*2); ctx.stroke();
        if (rs > 6) [[2.5, 'rgba(0,0,0,0.55)'], [1, 'rgba(255,255,255,0.86)']].forEach(([w, col]) => {
          line([c[0]-3*dpr, c[1]], [c[0]+3*dpr, c[1]], w, col); line([c[0], c[1]-3*dpr], [c[0], c[1]+3*dpr], w, col);
        });
        // 5 按住 Alt（我们加的：PS 的减淡⇄加深暂时互换）：笔尖旁标一个小字
        if (cfg.altLabel && U.alt && !U.drag){
          ctx.font = `${11*dpr}px sans-serif`; ctx.fillStyle = 'rgba(0,0,0,0.6)';
          const t = Lang.t(cfg.altLabel); ctx.fillText(t, c[0] + r + 5*dpr, c[1] - r);
          ctx.fillStyle = '#fff'; ctx.fillText(t, c[0] + r + 4*dpr, c[1] - r - 1*dpr);
        }
      }
      ctx.restore();
    }
  });

  /* ui.js 按住 Alt／Ctrl 时不把键盘事件交给工具 ⇒ 自己听 Alt／Shift，好即时重画橡皮筋与 Alt 标记 */
  const modKey = e => {
    if (ToolState.cur !== cfg.id || !window.UI || !UI.canvas) return;
    if (e.key === 'Alt' || e.key === 'Shift'){
      if (e.altKey !== U.alt || e.shiftKey !== U.shift){ U.alt = e.altKey; U.shift = e.shiftKey; UI.draw(); }
    }
  };
  document.addEventListener('keydown', modKey);
  document.addEventListener('keyup', modKey);
  window.addEventListener('DOMContentLoaded', () => {
    const v = document.getElementById('view');
    if (v) v.addEventListener('pointerleave', () => { if (ToolState.cur === cfg.id && !U.drag){ U.hover = null; UI.draw(); } });
  });
  return tool;
}

/* 选项栏小控件（retouch_ui.rs 170–182） */
function mkSelect(opt, values, cur, onchange){
  const sel = document.createElement('select'); sel.dataset.opt = opt;
  values.forEach(([v, key]) => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t(key); sel.appendChild(o); });
  sel.value = cur; sel.onchange = () => onchange(sel.value);
  return sel;
}
function mkPct(mk, opt, cur, onchange){
  const n = mk('number', {min:1, max:100, value:cur}); n.dataset.opt = opt; n.style.width = '52px';
  n.onchange = () => onchange(+n.value);
  return n;
}
/* 减淡／加深共用的选项栏：范围、曝光度、保护色调 */
function buildToneOptions(id){
  return function(box, add, mk){
    const C = id + '.setOptions';
    add('toneRange', mkSelect('range', RANGES.map(v => [v, 'opt.toneRange.' + v]), toneOpts.range, v => CMD.run(C, {range:v})));
    add('exposure', mkPct(mk, 'exposure', toneOpts.exposure, v => CMD.run(C, {exposure:v})));
    box.appendChild(document.createTextNode('%'));
    const cb = mk('checkbox', {checked:toneOpts.protectTones}); cb.dataset.opt = 'protectTones';
    cb.onchange = () => CMD.run(C, {protectTones:cb.checked});
    add('protectTones', cb);
  };
}

const TONE_STRINGS = {
  'zh-Hant':{ 'tool.dodge':'加亮工具', 'tool.burn':'加深工具', 'tool.sponge':'海綿工具',
    'opt.toneRange':'範圍：', 'opt.toneRange.shadows':'陰影', 'opt.toneRange.midtones':'中間調', 'opt.toneRange.highlights':'亮部',
    'opt.exposure':'曝光度：', 'opt.protectTones':'保護色調', 'ui.toneDiameter':'直徑：', 'ui.toneHardness':'硬度：',
    'ui.altBurn':'加深', 'ui.altDodge':'加亮' },
  'zh-Hans':{ 'tool.dodge':'减淡工具', 'tool.burn':'加深工具', 'tool.sponge':'海绵工具',
    'opt.toneRange':'范围：', 'opt.toneRange.shadows':'阴影', 'opt.toneRange.midtones':'中间调', 'opt.toneRange.highlights':'高光',
    'opt.exposure':'曝光度：', 'opt.protectTones':'保护色调', 'ui.toneDiameter':'直径：', 'ui.toneHardness':'硬度：',
    'ui.altBurn':'加深', 'ui.altDodge':'减淡' },
  'en':{ 'tool.dodge':'Dodge Tool', 'tool.burn':'Burn Tool', 'tool.sponge':'Sponge Tool',
    'opt.toneRange':'Range:', 'opt.toneRange.shadows':'Shadows', 'opt.toneRange.midtones':'Midtones', 'opt.toneRange.highlights':'Highlights',
    'opt.exposure':'Exposure:', 'opt.protectTones':'Protect Tones', 'ui.toneDiameter':'Diameter:', 'ui.toneHardness':'Hardness:',
    'ui.altBurn':'Burn', 'ui.altDodge':'Dodge' }
};

/* 挂出去给 burn.js、sponge.js 用（也给测试与 agent 看） */
window.Toning = {
  luma, toneCurve, compressGamut, dodgeBurn, saturation, sponge, perDab, dabCoverage, walkDabs, footprint, colorDab,
  mixPremultiplied, applyDabStroke, toneStroke, spongeStroke, setToneOptions, commonOptions, makeTool, buildToneOptions,
  mkSelect, mkPct, toneOpts, spongeOpts, BRUSH_PARAMS, TONE_STRINGS, RANGES
};

/* ───────── 减淡这一颗 ───────── */
CMD.reg('dodge.stroke', {i18n:'', undoable:true,
  params:'{' + BRUSH_PARAMS + ', range="shadows"|"midtones"|"highlights"=midtones, exposure=1..100=50, protectTones=true} '
       + '减淡（paint.dodge）：逐 dab 把扫过的像素调亮；保护色调＝只改亮度、色相饱和度不变 → {damage:[x,y,w,h]}'},
  p => toneStroke(p, false));
CMD.reg('dodge.setOptions', {i18n:'',
  params:'{range?:"shadows"|"midtones"|"highlights", exposure?:1..100, protectTones?:bool, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏；减淡与加深共用一份）'},
  p => setToneOptions(p, 'dodge'));

window.DodgeTool = makeTool({
  id:'dodge', icon:'◐', order:60, setOptions:'dodge.setOptions',
  cmd: e => (e && e.altKey) ? 'burn.stroke' : 'dodge.stroke',          // Alt＝暂时变加深（PS 行为，原码没有，我们加的）
  params: () => ({ range:toneOpts.range, exposure:toneOpts.exposure, protectTones:toneOpts.protectTones }),
  altLabel:'ui.altBurn',
  strings:TONE_STRINGS,
  buildOptions: buildToneOptions('dodge')
});

})();
