/* 混合器画笔（PS 的 B 组）：笔上有「储槽」（载入的颜料）与「拾取槽」（从画布沾起来的颜色），每个笔印把两者按湿度／载入量／混合比例混好再落下。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - paint/src/mixer.rs:1-151           MixerSettings（wet/load/mix/flow/sampleAllLayers 预设 50/50/50/100/关）、MixerState（储槽 reservoir、
                                         剩量 amount、拾取 pickup；load()/clean()）、apply_mixer_stroke（逐笔印：取样笔印底下的画布色 → 拾取色往它靠
                                         PICKUP_RATE·wet·覆盖 alpha → 储槽权重 amount·(1−mix·wet) 与拾取权重 mix·wet 混色 → 以 min(总权重,1)·flow 落下 →
                                         剩量 ×(1−0.08·(1−load))——这条照 PS 改成按走过距离半衰，见 paintHalfLife）
   笔尖：圆笔尖之外，「画笔设置」面板的角度／圆度／翻转／形状动态（大小・角度・圆度抖动与压力等控制）借 brush.js 的 DabGenerator（tipDabs）
   - paint/src/mixer.rs:153-240         测试：低载入会画干、满载入不会；湿笔把蓝色拖进白色；干的空笔不画；（我们的自测照这几条量）
   - paint/src/retouch.rs:80-117,136-163,219-292   Footprint、alpha_index、over_native（含锁透明像素）、apply_dab_stroke（逐笔印改工作副本，
                                         最后按 不透明度×选区 混回，alpha 有变就用预乘混 mix_premultiplied）
   - paint/src/render.rs:143-245        dab_rect、rasterize（圆笔尖：reach²、dab_coverage×流量）、footprint
   - paint/src/lib.rs:102-137           Dab.wet／Dab.mix（Transfer 的湿度／混合抖动，没开＝1）、dabs()
   - paint/src/dynamics.rs              PathWalker 间距、base_diameter（压力控制大小）、step_len
   - engine/src/brush_cmds.rs:362-411,685-691   paint.mixerBrush：wet/load/mix/flow 百分比（缺省＝笔刷的 mixer 设定）、color 缺省前景色、
                                         sampleAllLayers 时取笔画范围的整份合成、loadAfterStroke=true（每笔开头重新装满）、cleanAfterStroke=true（每笔收尾清掉拾取）
   - engine/src/brush_cmds/tests.rs:103-119,477-488   reservoir_and_cleaning、uses_the_brush_mixer_settings
   - ui-egui/src/brush_sections.rs:538-553   笔刷面板上的 Mixer Brush 区：Wet／Load／Mix／Flow／Sample All Layers
   PhotoCraft 的 ui-egui 没有「混合器画笔」这颗工具（state.rs 的 enum Tool 里没有），滑鼠手感（Shift 拉直线、Shift＋点接上一笔、Ctrl+Alt 拖改大小硬度、
   笔尖圈、[ ] 改大小、边拖边显示）沿用 clone.js／eraser.js 那套（stroke_constraint.rs、brush_resize.rs、canvas.rs）。
   命令（agent 与人同一条路）：mixer.stroke / mixer.load / mixer.clean / mixer.state / mixer.setOptions

   本档另把「逐笔印修图」的共用件挂在 window.MixerKit，给 colorreplace.js 读（index.html 里 mixer.js 排在 colorreplace.js 前面）：
   dabs、footprint、applyDabStroke、parsePoints、resolveBrush、Gesture（滑鼠手感控制器）…… */
(function(){
'use strict';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = v => typeof v === 'number' && isFinite(v);
const flag = (p, k, d) => typeof p[k] === 'boolean' ? p[k] : d;
const MAX_COORD = 1e6;                 // brush_cmds.rs parse_points 坐标上限
const SIZE_MIN = 1, SIZE_MAX = 5000;   // brush_resize.rs
const BAR_SIZE_MAX = 2500;             // shortcuts.rs [ ] 的上限
const LOCK_DISTANCE = 3;               // stroke_constraint.rs：Shift 拖这么远（萤幕点）才锁方向
const HARDNESS_TRAVEL = 200;           // brush_resize.rs：垂直拖 200 萤幕点＝硬度 0→100%

/* ═══════════ 笔刷引擎（paint/src/lib.rs、dynamics.rs、render.rs；圆笔尖、无形状动态／纹理／双重笔刷） ═══════════ */

/* lib.rs:139-156 dab_coverage：边缘 1px 反锯齿 × smoothstep 硬度衰减 */
function dabCoverage(d, radius, hardness){
  if (d >= radius + 0.5) return 0;
  const edge = Math.min(clamp(radius + 0.5 - d, 0, 1), 1);
  const h = clamp(hardness, 0, 1), inner = radius * h;
  let falloff;
  if (d <= inner || radius - inner < 1e-3) falloff = 1;
  else { const t = clamp((d - inner) / (radius - inner), 0, 1); falloff = 1 - t * t * (3 - 2 * t); }
  return edge * falloff;
}
/* dynamics.rs base_diameter：压力控制大小开着（预设）⇒ 直径＝size × 压力（滑鼠压力＝1） */
const baseD = (b, pr) => b.size * (b.pressureSize ? clamp(pr, 0, 1) : 1);
/* dynamics.rs step_len：max(直径,1) × spacing（至少 0.01），再至少 0.5 像素 */
const stepLen = (b, q) => Math.max(Math.max(baseD(b, q[2]), 1) * Math.max(b.spacing, 0.01), 0.5);
/* dynamics.rs PathWalker：沿折线每隔 step_len 落一个笔印；第一点等第二点来才吐，只有一点就收笔时吐。
   DabBuilder::build：半径＝max(直径/2, 0.5)，alpha＝流量；Dab.wet／Dab.mix＝1（没开 Transfer） */
function dabs(points, b){
  const out = [], emit = q => out.push({ x:q[0], y:q[1], radius:Math.max(baseD(b, q[2]) / 2, 0.5), alpha:clamp(b.flow, 0, 1), wet:1, mix:1 });
  let last = null, pending = null, nextAt = 0;
  for (const q of points){
    if (!last){ last = q; pending = q; nextAt = stepLen(b, q); continue; }
    const dx = q[0] - last[0], dy = q[1] - last[1], len = Math.sqrt(dx * dx + dy * dy);
    if (pending){ emit(pending); pending = null; }
    if (len > 1e-9){
      while (nextAt <= len + 1e-9){
        const t = Math.min(nextAt / len, 1);
        const p = [last[0] + dx * t, last[1] + dy * t, last[2] + (q[2] - last[2]) * t];   // lerp_pt：压力也内插
        emit(p);
        nextAt += Math.max(stepLen(b, p), 0.25);
      }
      nextAt -= len;
    }
    last = q;
  }
  if (pending) emit(pending);
  return out;
}
/* render.rs:143-150 dab_rect（圆笔尖：半径取整＋1 余量）→ [x0,y0,x1,y1)（文件坐标） */
function dabRect(d){
  const rr = Math.ceil(d.radius) + 1, cx = Math.floor(d.x), cy = Math.floor(d.y);
  return [cx - rr, cy - rr, cx + rr + 1, cy + rr + 1];
}
/* render.rs:153-245 rasterize＋footprint：每格 覆盖率×流量；at(x,y) 取值（文件坐标，框外＝0） */
function footprint(d, hardness, index){
  const r = dabRect(d), w = r[2] - r[0], h = r[3] - r[1], cov = new Float32Array(w * h);
  // 椭圆／转角笔尖（画笔设置的角度、圆度；照 brush.js _accum：长轴＝半径、短轴＝半径×圆度）
  const shaped = (isNum(d.roundness) && d.roundness < 1) || (isNum(d.angle) && d.angle !== 0);
  const ro = shaped ? Math.min(Math.max(isNum(d.roundness) ? d.roundness : 1, 0.5 / Math.max(d.radius, 0.5)), 1) : 1;
  const rm = Math.max(Math.max(d.radius, 0.5) * ro, 0.5), reach2 = (rm + 0.5) * (rm + 0.5);
  const sn = shaped ? Math.sin(d.angle || 0) : 0, cs = shaped ? Math.cos(d.angle || 0) : 1;
  for (let y = r[1]; y < r[3]; y++){
    const dy = y + 0.5 - d.y;
    for (let x = r[0]; x < r[2]; x++){
      let dx = x + 0.5 - d.x, d2;
      if (shaped){ const ux = dx, uy = -dy, u = (ux * cs + uy * sn) * ro, v = -ux * sn + uy * cs; d2 = u * u + v * v; }
      else d2 = dx * dx + dy * dy;
      if (d2 >= reach2) continue;
      const v = dabCoverage(Math.sqrt(d2), rm, hardness);
      if (v > 0) cov[(y - r[1]) * w + (x - r[0])] = v * d.alpha;
    }
  }
  return { dab:d, index, rect:r, w, cov,
           at(x, y){ return (x < r[0] || y < r[1] || x >= r[2] || y >= r[3]) ? 0 : cov[(y - r[1]) * w + (x - r[0])]; } };
}
const uni = (a, b) => a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice();
const inter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

/* ═══════════ retouch.rs：工作副本（Region）与逐笔印笔画 ═══════════ */

/* Region::read：文件坐标的一块，straight RGBA 0..1 浮点；图层画布外＝透明 */
function readRegion(L, r){
  const w = r[2] - r[0], h = r[3] - r[1], d = new Float32Array(w * h * 4);
  const reg = { rect:r, w, h, d };
  const cw = L.data.canvas.width, ch = L.data.canvas.height;
  const c = inter([r[0] - L.x, r[1] - L.y, r[2] - L.x, r[3] - L.y], [0, 0, cw, ch]);
  if (c[2] > c[0] && c[3] > c[1]){
    const img = L.data.ctx.getImageData(c[0], c[1], c[2] - c[0], c[3] - c[1]).data, iw = c[2] - c[0];
    for (let y = c[1]; y < c[3]; y++) for (let x = c[0]; x < c[2]; x++){
      const si = ((y - c[1]) * iw + (x - c[0])) * 4, di = ((y + L.y - r[1]) * w + (x + L.x - r[0])) * 4;
      d[di] = img[si] / 255; d[di + 1] = img[si + 1] / 255; d[di + 2] = img[si + 2] / 255; d[di + 3] = img[si + 3] / 255;
    }
  }
  return reg;
}
const ri = (reg, x, y) => ((y - reg.rect[1]) * reg.w + (x - reg.rect[0])) * 4;
/* Region::write：写回图层（只写得进图层画布的那块；8 位量化＝四舍五入） */
function writeRegion(L, reg){
  const r = reg.rect, cw = L.data.canvas.width, ch = L.data.canvas.height;
  const c = inter([r[0] - L.x, r[1] - L.y, r[2] - L.x, r[3] - L.y], [0, 0, cw, ch]);
  if (!(c[2] > c[0] && c[3] > c[1])) return;
  const iw = c[2] - c[0], img = L.data.ctx.createImageData(iw, c[3] - c[1]), o = img.data;
  for (let y = c[1]; y < c[3]; y++) for (let x = c[0]; x < c[2]; x++){
    const si = ri(reg, x + L.x, y + L.y), di = ((y - c[1]) * iw + (x - c[0])) * 4;
    for (let k = 0; k < 4; k++) o[di + k] = Math.round(clamp(reg.d[si + k], 0, 1) * 255);
  }
  L.data.ctx.putImageData(img, c[0], c[1]);
}
/* 选区覆盖率（文件坐标）：照 clone.js，选区有遮罩就照真形状（SelMask），没有就看外框 */
function selAt(x, y){
  const s = Doc.sel; if (!s) return 1;
  if (window.SelMask) return SelMask.coverage(x, y, s);
  const sx0 = Math.min(s.x, s.x + s.w), sy0 = Math.min(s.y, s.y + s.h), sx1 = Math.max(s.x, s.x + s.w), sy1 = Math.max(s.y, s.y + s.h);
  return (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) ? 1 : 0;
}
/* retouch.rs:143-163 over_native：normal「源盖目的」，k＝覆盖；锁透明像素 ⇒ alpha 不动 */
function overNative(dst, i, src, k, lock){
  const da = dst[i + 3], sa = src[3] * k, oa = sa + da * (1 - sa);
  if (oa > 0) for (let c = 0; c < 3; c++) dst[i + c] = (src[c] * sa + dst[i + c] * da * (1 - sa)) / oa;
  if (!lock) dst[i + 3] = oa;
}
/* retouch.rs:277-292 mix_premultiplied：dst ← lerp(dst, src, k)（预乘空间；结果全透明时颜色直接内插） */
function mixPremultiplied(dst, i, src, j, k){
  const da = dst[i + 3], sa = src[j + 3], oa = da + (sa - da) * k;
  for (let c = 0; c < 3; c++){
    const d = dst[i + c], s = src[j + c];
    dst[i + c] = oa > 1e-6 ? (d * da + (s * sa - d * da) * k) / oa : d + (s - d) * k;
  }
  dst[i + 3] = oa;
}
/* retouch.rs:219-275 apply_dab_stroke：effect(work, fp, orig) 逐笔印改工作副本（第 n 个看得到第 n−1 个的结果），
   整笔完了按 不透明度×选区 混回（alpha 会变＝预乘混；锁透明像素＝只混颜色）。回伤害范围 [x0,y0,x1,y1)（文件坐标）或 null */
function applyDabStroke(L, ds, hardness, opacity, lock, effect, maskAt){
  if (!ds.length) return null;
  let B = null; for (const d of ds) B = uni(B, dabRect(d));
  const orig = readRegion(L, B), work = { rect:B, w:orig.w, h:orig.h, d:orig.d.slice() };
  ds.forEach((d, i) => effect(work, footprint(d, hardness, i), orig));
  const op = clamp(opacity, 0, 1), out = orig;            // 原地改 orig 当输出（effect 已经用完它）
  for (let y = B[1]; y < B[3]; y++) for (let x = B[0]; x < B[2]; x++){
    const k = op * selAt(x, y) * (maskAt ? maskAt(x, y) : 1);   // maskAt：整笔一次套的遮罩（混合器纹理「为每个笔尖设置纹理」没勾）
    if (k <= 0) continue;
    const i = ri(out, x, y);
    if (!lock) mixPremultiplied(out.d, i, work.d, i, k);
    else for (let c = 0; c < 3; c++) out.d[i + c] += (work.d[i + c] - out.d[i + c]) * k;
  }
  writeRegion(L, out);
  return B;
}

/* ═══════════ 参数解析（brush_cmds.rs） ═══════════ */

/* parse_points：[x,y,pressure?] 或 {x,y,pressure}；坏的丢掉；空的、过大的报错 → [[x,y,p]…] */
function parsePoints(raw){
  if (!Array.isArray(raw)) return { error:'missing `points`' };
  const pts = [];
  for (const v of raw){
    let x, y, pr;
    if (Array.isArray(v)){ x = v[0]; y = v[1]; pr = v[2]; }
    else if (v && typeof v === 'object'){ x = v.x; y = v.y; pr = v.pressure; }
    else continue;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    pts.push([x, y, isNum(pr) ? pr : 1]);
  }
  if (!pts.length) return { error:'`points` is empty' };
  if (pts.some(q => !(Math.abs(q[0]) <= MAX_COORD && Math.abs(q[1]) <= MAX_COORD))) return { error:`point coordinates must be finite and within ±${MAX_COORD}` };
  return { pts };
}
/* resolve_brush：工具现值（大小／硬度与笔刷共用 ToolState；其余＝BrushSettings 预设 spacing 0.1、flow 1、opacity 1、压力控制大小开）
   ← brush:{…} 补丁 ← 纯量参数 */
function resolveBrush(p){
  const b = { size:ToolState.size, hardness:ToolState.hardness, spacing:0.1, flow:1, opacity:1, pressureSize:true };
  const patch = (p.brush && typeof p.brush === 'object') ? p.brush : {};
  for (const k of ['size', 'hardness', 'spacing', 'flow', 'opacity']) if (isNum(patch[k])) b[k] = patch[k];
  if (typeof patch.pressureSize === 'boolean') b.pressureSize = patch.pressureSize;
  if (isNum(p.size))     b.size = Math.max(p.size, 0.5);
  if (isNum(p.hardness)) b.hardness = clamp(p.hardness, 0, 1);
  if (isNum(p.spacing))  b.spacing = clamp(p.spacing, 0.01, 10);
  if (typeof p.pressureSize === 'boolean') b.pressureSize = p.pressureSize;
  b.size = clamp(b.size, 0.5, SIZE_MAX); b.hardness = clamp(b.hardness, 0, 1); b.flow = clamp(b.flow, 0, 1); b.opacity = clamp(b.opacity, 0, 1);
  return b;
}
/* 颜色 "#rgb"/"#rrggbb"/[r,g,b,(a)](0..1) → [r,g,b,a](0..1)；认不得回 d */
function parseColor(v, d){
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(isNum)) return [clamp(v[0], 0, 1), clamp(v[1], 0, 1), clamp(v[2], 0, 1), isNum(v[3]) ? clamp(v[3], 0, 1) : 1];
  if (typeof v === 'string'){
    let h = v.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
    if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).concat([1]);
  }
  return d;
}
const hexOf = c => c ? '#' + [0, 1, 2].map(i => Math.round(clamp(c[i], 0, 1) * 255).toString(16).padStart(2, '0')).join('') : null;
/* 前景色／背景色（PS 版面：工具栏两个色块＝#fillColor／#strokeColor，同 gradient.js） */
const fgHex = () => (document.getElementById('fillColor') || {}).value || '#000000';
const bgHex = () => (document.getElementById('strokeColor') || {}).value || '#ffffff';
/* 目标像素层＋锁（commands.rs paint_surface：锁像素／全锁就报错；锁透明像素＝lock_transparency） */
function targetLayer(p, cmd){
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return { error:'no active layer' };
  if (L.kind !== 'raster' || !L.data || !L.data.canvas) return { error:`active layer is a ${L.kind} layer, not a pixel layer` };
  if (window.Locks){
    const k = Locks.blocks(L, 'pixels');
    if (k){ Locks.notify(Locks.message(L, k)); return { fail:Locks.fail(L, k, cmd) }; }
  }
  return { L, lock: !!(window.Locks && Locks.alpha(L)) };
}

/* ═══════════ 滑鼠手感控制器（照 clone.js／eraser.js：stroke_constraint.rs、brush_resize.rs、canvas.rs、shortcuts.rs） ═══════════
   cfg = { id, live(L, points) → 伤害 [x0,y0,x1,y1)|null（边拖边显示，不进历史）, commit(L, points)（放开：走 CMD）,
           alt(pt)?（Alt 点）, cross（笔尖圈中心常驻十字）, setOpts(o)（改 size／hardness 的那条命令）, key（字串前缀） } */
function Gesture(cfg){
  const G = { drag:null, lastEnd:null, resize:null, hover:null, alt:false, shift:false, bound:false };
  const docKey = () => 'S' + Doc.serial;
  const pressure = e => (e && e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : 1;   // 滑鼠一律满压
  const cur = () => ToolState.cur === cfg.id;

  function snappedDir(o, p, step){
    const dx = p[0] - o[0], dy = p[1] - o[1];
    if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
    const v = Math.atan2(dy, dx) / step, a = (v < 0 ? -Math.round(-v) : Math.round(v)) * step;   // f64::round：.5 远离 0
    return [Math.cos(a), Math.sin(a)];
  }
  /* stroke_constraint.rs:63-83 constrain：Shift 拖过 3 个萤幕点后锁 0/45/90°，之后的点都投影到那条线上 */
  function constrain(d, last, p, shift){
    if (!shift){ d.axis = null; return p; }
    if (!d.axis) d.axis = { origin:last.slice(0, 2), dir:null };
    const a = d.axis;
    if (!a.dir){
      if (Math.hypot(p[0] - a.origin[0], p[1] - a.origin[1]) < LOCK_DISTANCE / Math.max(UI.zoom, 1e-3)) return a.origin.slice();
      a.dir = snappedDir(a.origin, p, Math.PI / 4);
    }
    if (!a.dir) return a.origin.slice();
    const t = (p[0] - a.origin[0]) * a.dir[0] + (p[1] - a.origin[1]) * a.dir[1];
    return [a.origin[0] + a.dir[0] * t, a.origin[1] + a.dir[1] * t];
  }
  /* 边拖边显示：按下时备份整层；每次把上回画过的那块还原，再用到目前为止的点整笔重算（不进历史） */
  function restore(d){
    const L = d.L, r = d.dmg; if (!r) return;
    const x = Math.max(0, r[0] - L.x), y = Math.max(0, r[1] - L.y);
    const w = Math.min(L.data.canvas.width, r[2] - L.x) - x, h = Math.min(L.data.canvas.height, r[3] - L.y) - y;
    if (w > 0 && h > 0){ const c = L.data.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.clearRect(x, y, w, h); c.drawImage(d.bak, x, y, w, h, x, y, w, h); c.restore(); }
    d.dmg = null;
  }
  /* cfg.incremental：工具自己接着上回的结果只画新增的笔印（混合器：间距 1% 时整笔重算太慢），回传累计伤害范围，这里就不先还原 */
  function live(d){
    if (Doc.active() !== d.L) return;
    if (!cfg.incremental) restore(d);
    d.dmg = cfg.live(d.L, d.points, d) || null;
  }
  /* brush_resize.rs:45-99：左右改直径（×2 跟着游标边）、上下改硬度（往下更硬） */
  function resizeTo(pt){
    const r = G.resize; r.at = pt;
    const z = (UI.zoom > 0) ? UI.zoom : 1, dx = pt[0] - r.anchor[0], dy = pt[1] - r.anchor[1];
    const size = clamp(Math.round(r.start[0] + 2 * (isFinite(dx) ? dx : 0)), SIZE_MIN, SIZE_MAX);
    const hard = Math.round(clamp(r.start[1] + (isFinite(dy) ? dy : 0) * z / HARDNESS_TRAVEL, 0, 1) * 100) / 100;
    if (size !== ToolState.size || hard !== ToolState.hardness) cfg.setOpts({ size, hardness:hard });
    UI.draw();
  }
  function bind(){
    if (G.bound || !window.UI || !UI.canvas) return;
    G.bound = true;
    UI.canvas.addEventListener('pointerleave', () => { if (cur() && !G.drag){ G.hover = null; UI.draw(); } });
    // ui.js 按住 Alt／Ctrl 时不把键交给工具 ⇒ 自己听 Alt／Shift，好即时重画十字与橡皮筋
    const mod = e => { if (!cur() || (e.key !== 'Alt' && e.key !== 'Shift')) return;
      if (e.altKey !== G.alt || e.shiftKey !== G.shift){ G.alt = e.altKey; G.shift = e.shiftKey; UI.draw(); } };
    document.addEventListener('keydown', mod); document.addEventListener('keyup', mod);
  }

  return {
    state:G,
    onDown(e, pt, P){
      bind();
      G.alt = !!e.altKey; G.shift = !!e.shiftKey; G.hover = pt;
      if (e.button !== undefined && e.button !== 0) return;            // paint_mouse.rs：右键不画
      if (e.ctrlKey && e.altKey && !G.drag){                           // brush_resize.rs:59-69
        G.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness], at:pt };
        UI.draw(); return;
      }
      if (e.altKey && cfg.alt){ cfg.alt(pt); P.down = false; UI.draw(); return; }
      P.ensureRaster();
      const L = Doc.active();
      if (!L || L.kind !== 'raster' || !L.data || !L.data.canvas) return;
      if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }   // 锁像素／全锁：提示、不画
      // canvas.rs：Shift＋点（这份文件上有上一笔）⇒ 先放上一笔终点，整条直线算同一笔
      const from = (e.shiftKey && G.lastEnd && G.lastEnd.key === docKey()) ? G.lastEnd.pt.slice() : null;
      const pr = pressure(e), points = [[pt[0], pt[1], pr]];
      if (from) points.unshift([from[0], from[1], pr]);
      const bak = document.createElement('canvas'); bak.width = L.data.canvas.width; bak.height = L.data.canvas.height;
      bak.getContext('2d').drawImage(L.data.canvas, 0, 0);
      G.drag = { L, points, start: from || pt.slice(), axis:null, bak, dmg:null };
      if (cfg.begin) cfg.begin(G.drag);
      live(G.drag);
      UI.draw();
    },
    onMove(e, pt, P){
      bind();
      G.alt = !!e.altKey; G.shift = !!e.shiftKey; G.hover = pt;
      if (G.resize){ resizeTo(pt); return; }
      const d = G.drag;
      if (d && P.down){
        const last = d.points[d.points.length - 1];
        const q = constrain(d, last, pt, e.shiftKey);
        // canvas.rs tool_move：离上一点超过 0.25 像素（曼哈顿）才收一点
        if (Math.abs(last[0] - q[0]) + Math.abs(last[1] - q[1]) > 0.25){ d.points.push([q[0], q[1], pressure(e)]); live(d); }
      }
      UI.draw();
    },
    onUp(e, pt){
      G.alt = !!e.altKey; G.shift = !!e.shiftKey;
      if (G.resize){ resizeTo(pt); G.resize = null; cfg.setOpts({}); UI.draw(); return; }
      const d = G.drag; G.drag = null;
      if (!d){ UI.draw(); return; }
      const last = d.points[d.points.length - 1], q = constrain(d, last, pt, e.shiftKey);
      // ToolEvent::Up：放开点跟最后一点不同才补上，压力沿用最后一点
      if (last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], last[2]]);
      const end = d.points[d.points.length - 1];
      G.lastEnd = { key:docKey(), pt:[end[0], end[1]] };
      restore(d);                                                      // 先还原成下笔前，历史快照才对；再走命令正式落一次
      cfg.commit(d.L, d.points.map(p => p.slice()));
    },
    /* shortcuts.rs:307-318：[ 缩小、] 放大（×1.25，取整，至少 +1） */
    onKey(e){
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== '[' && e.key !== ']')) return false;
      const s = ToolState.size;
      const next = e.key === '[' ? Math.round(Math.max(s / 1.25, 1)) : Math.max(Math.round(Math.min(s * 1.25, BAR_SIZE_MAX)), s + 1);
      if (next !== s) cfg.setOpts({ size:next });
      UI.draw();
      return true;
    },
    onDeactivate(){
      if (G.drag) restore(G.drag);
      G.drag = null; G.resize = null; G.hover = null;
    },
    /* 叠画：笔尖圈（NormalTip：半径×(0.5＋0.5×硬度)）、中心十字、Ctrl+Alt 改笔尖的红色预览＋读数、Shift 橡皮筋 */
    drawOverlay(ctx, s){
      const z = UI.zoom > 0 ? UI.zoom : 1, dpr = s / z, scr = q => [q[0] * s, q[1] * s];
      const line = (a, b, w, col) => { ctx.lineWidth = w * dpr; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
      const ring = (c, r) => {
        ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], r + 0.5 * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
      };
      const cross = (c, len) => [[2.5, 'rgba(0,0,0,0.55)'], [1, 'rgba(255,255,255,0.86)']].forEach(([w, col]) => {
        line([c[0] - len * dpr, c[1]], [c[0] + len * dpr, c[1]], w, col); line([c[0], c[1] - len * dpr], [c[0], c[1] + len * dpr], w, col);
      });
      ctx.save();
      const full = Math.max(ToolState.size / 2 * z, 1);
      if (G.resize){
        const c = scr(G.resize.anchor), R = full * dpr, inner = clamp(ToolState.hardness, 0, 1);
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
        g.addColorStop(0, 'rgba(255,0,0,0.43)'); g.addColorStop(inner, 'rgba(255,0,0,0.43)'); g.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI * 2); ctx.fill();
        ring(c, R);
        const h = scr(G.resize.at || G.resize.anchor);
        const t1 = `${Lang.t('ui.' + cfg.key + '.diameter')} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t('ui.' + cfg.key + '.hardness')} ${Math.round(ToolState.hardness * 100)}%`;
        ctx.font = `${12 * dpr}px sans-serif`;
        const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12 * dpr;
        ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0] + 14 * dpr, h[1] + 14 * dpr, w, 38 * dpr);
        ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0] + 20 * dpr, h[1] + 29 * dpr); ctx.fillText(t2, h[0] + 20 * dpr, h[1] + 45 * dpr);
      } else if (G.hover){
        const c = scr(G.hover), r = Math.max(full * (0.5 + 0.5 * clamp(ToolState.hardness, 0, 1)), 1) * dpr;
        // cfg.tip()＝{angle 弧度（y 朝上逆时针）, roundness}：游标照笔尖形状（PS「正常画笔笔尖」游标＝笔尖轮廓：转角、压扁的椭圆）
        const tp = cfg.tip ? cfg.tip() : null;
        if (tp && (tp.roundness < 1 || tp.angle)){
          const ry = Math.max(r * clamp(tp.roundness, 0.01, 1), dpr);
          ctx.lineWidth = dpr;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(c[0], c[1], r + 0.5 * dpr, ry + 0.5 * dpr, -tp.angle, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.ellipse(c[0], c[1], r, ry, -tp.angle, 0, Math.PI * 2); ctx.stroke();
          G.cursor = { rx:r / dpr, ry:ry / dpr, angle:tp.angle };
        } else { ring(c, r); G.cursor = { rx:r / dpr, ry:r / dpr, angle:0 }; }
        if (cfg.cross || (G.alt && cfg.alt) || (tp && r / dpr > 6)) cross(c, 3);   // 画笔工具同款：笔尖半径 > 6 加中心十字
        if (G.shift && G.lastEnd && G.lastEnd.key === docKey() && !G.drag){
          const a = scr(G.lastEnd.pt);
          line(a, c, 2.5, 'rgba(0,0,0,0.47)'); line(a, c, 1, 'rgba(255,255,255,0.9)');
        }
      }
      ctx.restore();
    }
  };
}

/* 选项栏小帮手：数字格／勾选／按钮列／下拉（每一格都只是叫命令） */
function bar(box, add, mk, cmd, key){
  return {
    num(k, val, min, max, toOpt){
      const n = mk('number', { min, max, value:val }); n.dataset[key] = k; n.style.width = '56px';
      n.onchange = n.oninput = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run(cmd, toOpt(clamp(+n.value, min, max))); };
      return n;
    },
    chk(k, val, toOpt){
      const c = mk('checkbox', { checked:!!val }); c.dataset[key] = k;
      c.onchange = () => CMD.run(cmd, toOpt(c.checked));
      return c;
    },
    sel(k, items, val, toOpt){
      const s = document.createElement('select'); s.dataset[key] = k;
      for (const [v, label] of items){ const o = document.createElement('option'); o.value = v; o.textContent = Lang.t(label); s.appendChild(o); }
      s.value = val; s.onchange = () => CMD.run(cmd, toOpt(s.value));
      return s;
    },
    btn(k, label, fn){
      const b = document.createElement('button'); b.type = 'button'; b.dataset[key] = k; b.textContent = Lang.t(label);
      b.style.cssText = 'padding:1px 7px;margin-right:6px;border-radius:3px;cursor:pointer;border:1px solid #555;background:transparent;color:inherit;font:inherit';
      b.onclick = fn; box.appendChild(b); return b;
    }
  };
}
/* 选项改了（快捷键、Ctrl+Alt 拖、agent）⇒ 对齐选项栏现成的大小／硬度滑杆与自家的格子，不重建（免得打字失焦） */
function syncBar(id, key, vals){
  if (ToolState.cur !== id) return;
  const rs = document.querySelectorAll('#optBody input[type=range]');
  if (rs[0] && rs[0] !== document.activeElement){ rs[0].value = ToolState.size; const sp = rs[0].parentNode && rs[0].parentNode.nextSibling; if (sp && sp.tagName === 'SPAN') sp.textContent = ToolState.size; }
  if (rs[1] && rs[1] !== document.activeElement) rs[1].value = Math.round(ToolState.hardness * 100);
  document.querySelectorAll(`#optBody [data-${key}]`).forEach(el => {
    if (el === document.activeElement) return;
    const k = el.dataset[key]; if (!(k in vals)) return;
    if (el.type === 'checkbox') el.checked = !!vals[k]; else if ('value' in el && el.tagName !== 'BUTTON') el.value = vals[k];
    else if (el.tagName === 'SPAN') el.style.background = vals[k] || 'transparent';
  });
}
/* 大小／硬度（与笔刷共用 ToolState） */
function setSizeHardness(p){
  if (isNum(p.size)) ToolState.size = clamp(Math.round(p.size), SIZE_MIN, SIZE_MAX);
  if (isNum(p.hardness)) ToolState.hardness = clamp(p.hardness, 0, 1);
}
/* sampleAllLayers：整份合成（文件坐标，straight RGBA8） */
function compositeBuf(){
  const c = composite(1);
  return { d:c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w:c.width, h:c.height };
}

window.MixerKit = { clamp, isNum, flag, uni, inter, dabCoverage, dabs, dabRect, footprint, readRegion, writeRegion, ri, selAt, overNative, mixPremultiplied,
                    applyDabStroke, parsePoints, resolveBrush, parseColor, hexOf, fgHex, bgHex, targetLayer, Gesture, bar, syncBar, setSizeHardness, compositeBuf };

/* ═══════════ mixer.rs：混合器画笔本体 ═══════════ */

const PICKUP_RATE = 0.25;          // mixer.rs:17：湿度 100% 时每个笔印拾取色往画布色走的比例
/* 储槽颜料的「半衰距离」（以笔尖直径计）：画这么远储槽剩一半。PhotoCraft 原式是逐笔印 ×(1−0.08·(1−load))，跟间距绑死
   （间距 1% 时载入 50% 一个直径就干了），跟 PS 不像，照 PS 改成按距离：
   - Adobe 帮助「Paint with the Mixer Brush」的载入示意图：载入 1% 约一个半直径就淡到看不见、载入 100% 一路不干 ⇒ 载入 1% 半衰≈0.66 直径、100%＝∞；
   - 中间照 load/(1−load) 拉开（载入 50%≈6.6 直径、90%≈55 直径；推定值，PS 没公开公式）；
   - 潮湿：PS「较高的设置会产生较长的绘画条痕」⇒ 半衰 ×(1＋潮湿)（推定倍率）。 */
function paintHalfLife(load, wet){
  const l = clamp(load, 0, 1);
  if (l >= 1) return Infinity;
  return (0.6 + 6 * l / (1 - l)) * (1 + clamp(wet, 0, 1));
}
/* MixerSettings 的现值（＝笔刷的 mixer 设定；brush_sections.rs:538-553 面板上调的就是它）＋ 两个自动选项
   solidOnly＝PS「只载入纯色」（目前画笔载入色块下拉里的勾选；关着时 Alt 点＝把笔尖底下整块图案载进储槽） */
const MO = { wet:50, load:50, mix:50, flow:100, sampleAll:false, loadAfter:true, cleanAfter:true, solidOnly:false };
/* MixerState（engine/src/lib.rs:205 s.tools.mixer：跟 session 走，不进历史）
   tex＝载入的图案（PS 混合器画笔 Alt 点取样：储槽里装的是笔尖大小的一整块图像，不只一个颜色；PhotoCraft 原码没有，照 PS 补）
   srcFg＝载入那时的前景色（PS：换前景色＝把新前景色载进画笔；没换就一直用载入的那份） */
const MS = { reservoir:null, amount:0, pickup:null, tex:null, srcFg:null };
const stateJSON = s => ({ reservoir:hexOf(s.reservoir), amount:Math.round(s.amount * 1e4) / 1e4, pickup:hexOf(s.pickup),
                          reservoirRGBA:s.reservoir ? s.reservoir.slice() : null, pickupRGBA:s.pickup ? s.pickup.slice() : null,
                          texture:s.tex ? { w:s.tex.w, h:s.tex.h, x:s.tex.x0, y:s.tex.y0 } : null });
const cloneState = s => ({ reservoir:s.reservoir ? s.reservoir.slice() : null, amount:s.amount, pickup:s.pickup ? s.pickup.slice() : null,
                           tex:s.tex || null, srcFg:s.srcFg || null });

/* ── 载入的图案（PS Alt 点取样）：文件坐标 (cx,cy) 为中心、边长＝笔尖直径的方块；预乘 RGBA 0..1 ── */
function captureTex(cx, cy, size, all){
  const S = clamp(Math.round(size), 1, 1024), x0 = Math.round(cx - S / 2), y0 = Math.round(cy - S / 2), r = [x0, y0, x0 + S, y0 + S];
  let reg;
  if (all){
    const s = compositeBuf(), d = new Float32Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
      const X = x0 + x, Y = y0 + y; if (X < 0 || Y < 0 || X >= s.w || Y >= s.h) continue;
      const si = (Y * s.w + X) * 4, di = (y * S + x) * 4;
      for (let c = 0; c < 4; c++) d[di + c] = s.d[si + c] / 255;
    }
    reg = { d };
  } else {
    const L = Doc.active();
    if (!L || L.kind !== 'raster' || !L.data || !L.data.canvas) return null;
    reg = readRegion(L, r);
  }
  const d = reg.d, acc = [0, 0, 0]; let asum = 0;
  for (let i = 0; i < d.length; i += 4){
    const a = d[i + 3];
    for (let c = 0; c < 3; c++){ d[i + c] *= a; acc[c] += d[i + c]; }
    asum += a;
  }
  if (asum < 1e-6) return null;
  return { w:S, h:S, d, x0, y0, avg:[acc[0] / asum, acc[1] / asum, acc[2] / asum, 1], thumb:null };
}
/* 图案的双线性取样（u,v＝像素中心坐标；边缘夹住）→ out＝预乘 RGBA */
function texAt(t, u, v, out){
  const xa = Math.floor(u), ya = Math.floor(v), fx = u - xa, fy = v - ya;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++){
    const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy); if (w <= 0) continue;
    const x = clamp(xa + i, 0, t.w - 1), y = clamp(ya + j, 0, t.h - 1), k = (y * t.w + x) * 4;
    for (let c = 0; c < 4; c++) out[c] += t.d[k + c] * w;
  }
}
/* 选项栏「目前画笔载入」色块用的缩图 */
function texThumb(t){
  if (t.thumb) return t.thumb;
  const c = document.createElement('canvas'); c.width = t.w; c.height = t.h;
  const x = c.getContext('2d'), img = x.createImageData(t.w, t.h);
  for (let i = 0; i < t.d.length; i += 4){
    const a = t.d[i + 3];
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(clamp(a > 0 ? t.d[i + k] / a : 0, 0, 1) * 255);
    img.data[i + 3] = Math.round(a * 255);
  }
  x.putImageData(img, 0, 0);
  t.thumb = c.toDataURL();
  return t.thumb;
}
const swatchCss = s => s.tex ? `url(${texThumb(s.tex)}) center / cover no-repeat ${hexOf(s.reservoir || s.tex.avg)}` : (hexOf(s.reservoir) || 'transparent');

/* mixer.rs:61-151 apply_mixer_stroke 的逐笔印部分。m＝{wet,load,mix,flow}（0..1）；
   sample＝整份合成（sampleAllLayers）或 null（取工作副本＝这一层、含本笔前面的笔印）。
   储槽装的是图案（state.tex）时：储槽色＝图案在笔印里对应的那一点（图案随笔尖大小缩放、整块盖印），其余混色照原式 */
function mixerEffect(m, state, sample, lock, grain){
  const native = c => [c[0], c[1], c[2], 1];                       // 储槽／拾取色一律当不透明（alpha 通道设 1）
  const tex = state.tex || null;
  const res = state.reservoir ? native(state.reservoir) : (tex ? native(tex.avg) : null);
  let amount = res ? clamp(state.amount, 0, 1) : 0;
  let pickup = state.pickup ? native(state.pickup) : null;
  const wet0 = clamp(m.wet, 0, 1), mix0 = clamp(m.mix, 0, 1), flow = clamp(m.flow, 0, 1), load = clamp(m.load, 0, 1);
  const acc = [0, 0, 0], paint = [0, 0, 0, 0], px = [0, 0, 0, 0], tc = [0, 0, 0, 0];
  const half = paintHalfLife(load, wet0);
  let prev = null;
  function effect(work, fp){
    const wet = wet0 * clamp(fp.dab.wet, 0, 1), mix = mix0 * clamp(fp.dab.mix, 0, 1);   // Transfer 湿度／混合抖动（没开＝1）
    // 储槽颜料干涸（照 PS：载入量决定一笔能画多长，跟笔印间距无关）：按走过的距离（以笔尖直径计）半衰
    if (prev && isFinite(half)){
      const dist = Math.hypot(fp.dab.x - prev[0], fp.dab.y - prev[1]), D = Math.max(2 * fp.dab.radius, 1);
      amount *= Math.pow(0.5, dist / (D * half));
    }
    prev = [fp.dab.x, fp.dab.y];
    // 取样笔印底下的画布色（按覆盖×alpha 加权平均）
    acc[0] = acc[1] = acc[2] = 0;
    let wsum = 0, asum = 0;
    const r = inter(fp.rect, work.rect);
    // 颜色动态（画笔设置面板 ▸ 颜色动态）：这个笔印的储槽色＝DabBuilder 按前景(储槽)／背景、色相饱和度亮度抖动算出的那色
    const resD = (fp.dab.color && res && !tex) ? native(fp.dab.color) : res;
    if (wet > 0){
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
        const w = fp.at(x, y); if (w <= 0) continue;
        if (sample){
          const ok = x >= 0 && y >= 0 && x < sample.w && y < sample.h, si = (y * sample.w + x) * 4;
          for (let c = 0; c < 4; c++) px[c] = ok ? sample.d[si + c] / 255 : 0;
        } else { const i = ri(work, x, y); for (let c = 0; c < 4; c++) px[c] = work.d[i + c]; }
        const al = px[3];
        for (let c = 0; c < 3; c++) acc[c] += px[c] * w * al;
        wsum += w; asum += w * al;
      }
    }
    if (asum > 1e-6 && wet > 0){
      const ca = asum / Math.max(wsum, 1e-6);
      const canvas = [acc[0] / asum, acc[1] / asum, acc[2] / asum, 1];
      pickup = !pickup ? canvas : pickup.map((p, c) => p + (canvas[c] - p) * PICKUP_RATE * wet * ca);
    }
    const wr = res ? amount * (1 - mix * wet) : 0;
    const wp = pickup ? mix * wet : 0;
    const total = wr + wp;
    if (total > 1e-6){
      const dep = Math.min(total, 1) * flow;
      if (!tex){
        for (let c = 0; c < 4; c++) paint[c] = ((resD ? resD[c] : 0) * wr + (pickup ? pickup[c] : 0) * wp) / total;
        for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
          const k = (grain ? grain(fp.at(x, y), x, y) : fp.at(x, y)) * dep;
          if (k > 0) overNative(work.d, ri(work, x, y), paint, k, lock);
        }
      } else {
        const dd = fp.dab, sx = tex.w / (2 * dd.radius), sy = tex.h / (2 * dd.radius);
        for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
          const k = (grain ? grain(fp.at(x, y), x, y) : fp.at(x, y)) * dep; if (k <= 0) continue;
          texAt(tex, (x + 0.5 - dd.x) * sx + tex.w / 2 - 0.5, (y + 0.5 - dd.y) * sy + tex.h / 2 - 0.5, tc);
          const den = tc[3] * wr + wp; if (den <= 1e-6) continue;
          for (let c = 0; c < 3; c++) paint[c] = (tc[c] * wr + (pickup ? pickup[c] : 0) * wp) / den;
          paint[3] = den / total;
          overNative(work.d, ri(work, x, y), paint, k, lock);
        }
      }
    }
  }
  return { effect, finish(){ state.amount = amount; state.pickup = pickup ? pickup.slice() : null; } };
}
/* ── 混合器自己的一份笔尖（PS：每颗绘画工具各自记笔尖——大小、硬度、笔尖形状与画笔设置各节；换工具不互相影响）──
   OWN.size／hardness：混合器不在手上时存这里；在手上时 ToolState.size／hardness 就是它（换工具那一刻对调，见文末 ToolState.cur 拦截）。
   OWN.brush：画笔设置面板各节（栏位同 brush.js 的 BrushSettings，另加「纹理」一节——brush.js 引擎没有纹理，这里自己做）。
   手上是混合器时，画笔设置／画笔面板改的就是这份（menus/impl/ps-window.js 走 mixer.brush.set／get）。 */
const eng = () => { const BT = window.Tools && Tools.get && Tools.get('brush'); return BT && BT._engine && BT._engine.DabGenerator ? BT._engine : null; };
const TEX_MODES = ['multiply', 'subtract', 'darken', 'overlay', 'colorDodge', 'colorBurn', 'linearBurn', 'hardMix', 'linearHeight', 'height'];
/* PS 2020 画笔设置 ▸ 纹理：图案、反相、缩放 100%、亮度 0、对比度 0、为每个笔尖设置纹理、模式、深度 100% */
const defTexture = () => ({ enabled:false, pattern:'', invert:false, scale:1, brightness:0, contrast:0, eachTip:false, mode:'multiply', depth:1 });
const OWN = { size:ToolState.size, hardness:ToolState.hardness, brush:null };
function ownBrush(){
  if (!OWN.brush){
    const E = eng(), b = E ? E.defaultBrush() : { spacing:0.1, spacingEnabled:true };
    delete b.size; delete b.hardness; if (b.smoothing) b.smoothing.amount = 0; b.texture = defTexture();
    OWN.brush = b;
  }
  return OWN.brush;
}
const mixerCur = () => ToolState.cur === 'mixer';
const ownSize = () => mixerCur() ? ToolState.size : OWN.size;
const ownHard = () => mixerCur() ? ToolState.hardness : OWN.hardness;
function setOwnSH(p){
  if (mixerCur()){ setSizeHardness(p); return; }
  if (isNum(p.size)) OWN.size = clamp(Math.round(p.size), SIZE_MIN, SIZE_MAX);
  if (isNum(p.hardness)) OWN.hardness = clamp(p.hardness, 0, 1);
}
/* 整支（含大小／硬度）＝画笔设置面板读的那份 */
function fullBrush(){ const b = JSON.parse(JSON.stringify(ownBrush())); b.size = ownSize(); b.hardness = ownHard(); return b; }
/* 命令没给 size／hardness／spacing ⇒ 用混合器自己那份（不是画笔工具的） */
function ownParams(p){
  const q = Object.assign({}, p), pb = (p.brush && typeof p.brush === 'object') ? p.brush : {};
  if (!isNum(q.size) && !isNum(pb.size)) q.size = ownSize();
  if (!isNum(q.hardness) && !isNum(pb.hardness)) q.hardness = ownHard();
  if (!isNum(q.spacing) && !isNum(pb.spacing)) q.spacing = brushSpacing();
  return q;
}
function mergeTexture(base, v){
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('invalid brush: `texture` must be an object');
  const t = Object.assign(defTexture(), base || {});
  const lim = { scale:[0.01, 10], brightness:[-150, 150], contrast:[-50, 100], depth:[0, 1] };
  for (const k of Object.keys(v)){
    const x = v[k];
    if (k === 'enabled' || k === 'invert' || k === 'eachTip'){ if (typeof x !== 'boolean') throw new Error(`invalid brush: \`texture.${k}\` must be true/false`); t[k] = x; }
    else if (k === 'pattern'){ if (typeof x !== 'string') throw new Error('invalid brush: `texture.pattern` must be a pattern id or name'); t.pattern = x; }
    else if (k === 'mode'){ if (!TEX_MODES.includes(x)) throw new Error(`invalid brush: \`texture.mode\` must be one of ${TEX_MODES.join('|')}`); t.mode = x; }
    else if (lim[k]){ if (!isNum(x)) throw new Error(`invalid brush: \`texture.${k}\` must be a number`); t[k] = clamp(x, lim[k][0], lim[k][1]); }
  }
  return t;
}
/* 纹理（PS 画笔设置 ▸ 纹理）：图案灰度（亮度／对比度／反相调过）按深度跟笔印覆盖率照模式合成 ⇒ 笔画里出现图案的纹路。
   图案取 menus/impl/ps-edit.js 的图案库（同图案图章），以文件坐标平铺（缩放＝图案放大倍数）。模式算式 PS 没公开，照混合模式的意思推定。
   回 (覆盖率, x, y) → 新覆盖率；没开／没图案 ⇒ null */
const grainCache = new Map();
function makeGrain(tx){
  if (!tx || !tx.enabled) return null;
  const lib = window.PsEdit && PsEdit.patterns, pat = lib && lib.resolve(tx.pattern || '');
  if (!pat || !pat.px || !pat.width || !pat.height) return null;
  const key = [pat.id, tx.invert, tx.brightness, tx.contrast].join('|');
  let g = grainCache.get(key);
  if (!g){
    const n = pat.width * pat.height; g = new Float32Array(n);
    const ct = 1 + tx.contrast / 100;
    for (let i = 0; i < n; i++){
      const a = pat.px[i * 4 + 3] / 255, l = (0.299 * pat.px[i * 4] + 0.587 * pat.px[i * 4 + 1] + 0.114 * pat.px[i * 4 + 2]) / 255;
      let v = a * l + (1 - a);                                     // 透明处当白
      v = clamp((v + tx.brightness / 255 - 0.5) * ct + 0.5, 0, 1);
      g[i] = tx.invert ? 1 - v : v;
    }
    grainCache.set(key, g); if (grainCache.size > 16) grainCache.delete(grainCache.keys().next().value);
  }
  const W = pat.width, H = pat.height, sc = Math.max(tx.scale, 0.01), depth = clamp(tx.depth, 0, 1), mode = tx.mode;
  return (c, x, y) => {
    if (c <= 0) return 0;
    const u = Math.floor((x + 0.5) / sc), v = Math.floor((y + 0.5) / sc);
    const s = 1 - depth * (1 - g[(((v % H) + H) % H) * W + (((u % W) + W) % W)]);   // 纹理值：1＝不挡、0＝全挡（深度 100%）
    let o;
    switch (mode){
      case 'subtract':     o = c - (1 - s); break;
      case 'darken':       o = Math.min(c, s); break;
      case 'overlay':      o = c < 0.5 ? 2 * c * s : 1 - 2 * (1 - c) * (1 - s); break;
      case 'colorDodge':   o = c * (s + (1 - s) * c); break;          // 比正片叠底淡：笔印越实纹理越不显
      case 'colorBurn':    o = 1 - Math.min(1, (1 - c) / Math.max(s, 1e-3)); break;
      case 'linearBurn':   o = c + s - 1; break;
      case 'hardMix':      o = c + s > 1 ? c : 0; break;
      case 'linearHeight': o = c * clamp((s - (1 - c)) / Math.max(c, 1e-3), 0, 1); break;
      case 'height':       o = c > 1 - s ? c : 0; break;
      default:             o = c * s;                             // multiply
    }
    return clamp(o, 0, 1);
  };
}
/* 「为每个笔尖设置纹理」勾＝每个笔印各套一次（重叠处会叠满）；没勾（PS 预设）＝整笔画完再套一次图案遮罩（笔画里留得住纹路） */
function texParts(tx){
  const g = makeGrain(tx); if (!g) return { grain:null, mask:null };
  return tx.eachTip ? { grain:g, mask:null } : { grain:null, mask:(x, y) => g(1, x, y) };
}
/* ── 笔尖形状＋画笔设置各节（角度／圆度／翻转、形状动态、散布、颜色动态、传递；纹理另走 makeGrain）──
   p.brush 可带这些栏位（同 mixer.brush.set）；没带就取混合器自己那支笔刷的。
   全是缺省（圆、0°、没开动态／散布／颜色动态）⇒ tip:null（走原本的 dabs，结果逐像素不变） */
const TIP_KEYS = ['angle', 'roundness', 'flipX', 'flipY', 'shapeDynamics', 'scattering', 'colorDynamics', 'transfer'];
function resolveTip(p){
  const E = eng();
  let full = fullBrush();
  if (p.brush && typeof p.brush === 'object' && 'texture' in p.brush){ try { full.texture = mergeTexture(full.texture, p.brush.texture); } catch (err){ return { error:err.message }; } }
  const texture = full.texture || null;
  if (!E) return { tip:null, texture };
  const patch = {};
  if (p.brush && typeof p.brush === 'object') for (const k of TIP_KEYS) if (k in p.brush) patch[k] = p.brush[k];
  if (isNum(p.angle)) patch.angle = p.angle;
  if (isNum(p.roundness)) patch.roundness = p.roundness;
  if (Object.keys(patch).length){ try { full = E.mergeBrush(full, patch).b; } catch (err){ return { error:err.message }; } }
  const sd = full.shapeDynamics || {}, on = k => !!(full[k] && full[k].enabled);
  const plain = !(((full.angle % 360) + 360) % 360) && !(full.roundness < 1) && !full.flipX && !full.flipY && !sd.enabled && !on('transfer') && !on('scattering') && !on('colorDynamics');
  if (plain) return { tip:null, texture };
  const tip = {}; for (const k of TIP_KEYS) tip[k] = JSON.parse(JSON.stringify(full[k]));
  return { tip, seed:E.seedOf(p), texture };
}
/* 用 brush.js 的 DabGenerator 生笔印（间距、压力控制大小同 dabs；散布＝落点偏移与数量、颜色动态＝每个笔印的储槽色（前景＝储槽色、背景＝背景色）；平滑／喷枪关掉），转成混合器的笔印格式 */
function tipDabs(points, b){
  const E = eng(), full = E.defaultBrush();
  Object.assign(full, b.tip, { size:b.size, hardness:b.hardness, spacing:Math.max(b.spacing, 0.01), spacingEnabled:true, flow:b.flow, opacity:1,
                               pressureSize:b.pressureSize, pressureOpacity:false, buildUp:false });
  full.smoothing.amount = 0; full._seed = b.tipSeed;
  if (b.resColor) full.color = b.resColor.slice(0, 3).concat([1]);
  full.background = parseColor(bgHex(), [1, 1, 1, 1]);
  const cdOn = !!(full.colorDynamics && full.colorDynamics.enabled);
  // 照 DabGenerator.walk 逐步走（平滑关），每一步记下 step，好算传递的湿度／混合抖动（lib.rs Dab.wet／Dab.mix；没开＝1）
  const g = new E.DabGenerator(full, 1), out = [], tr = full.transfer || {};
  const wm = tr.enabled ? [tr.wetness, tr.mix] : null;
  const build = s => { const n0 = out.length; g.builder.build(s, out);
    for (let i = n0; i < out.length; i++){ const d = out[i];
      d._wet = wm ? E.scalar(wm[0], s, E.rand01(full._seed, d.index, E.ST.WET)) : 1;
      d._mix = wm ? E.scalar(wm[1], s, E.rand01(full._seed, d.index, E.ST.MIX)) : 1; } };
  for (const q of points){
    const steps = [];
    g.walker.push(E.mkPt(q[0], q[1], { pressure:isNum(q[2]) ? q[2] : 1 }), pt => g.builder.stepLen(pt), s => steps.push(s));
    steps.forEach(build);
  }
  const tail = []; g.walker.finish(s => tail.push(s)); tail.forEach(build);
  return out.map(d => ({ x:d.cx, y:d.cy, radius:d.radius, alpha:d.alpha, wet:d._wet, mix:d._mix, angle:d.angle, roundness:d.roundness, flipX:d.flipX, flipY:d.flipY,
                         color: cdOn ? d.color : null }));
}
const strokeDabs = (points, b) => b.tip ? tipDabs(points, b) : dabs(points, b);

function applyMixerStroke(L, pts, b, m, state, sample, lock, grain, mask){
  const st = Object.assign({}, b, { opacity:1, resColor:state.reservoir || (state.tex && state.tex.avg) || null });   // mixer.rs:88 笔刷不透明度不算
  const E = mixerEffect(m, state, sample, lock, grain || null);
  const dmg = applyDabStroke(L, strokeDabs(pts, st), st.hardness, 1, lock, E.effect, mask || null);
  E.finish();
  return dmg;
}

/* 一笔开始前把储槽装好（MixerState::load）：texture:true＝装目前载入的图案；否则装 color（缺省前景色） */
function loadState(p, state, loadAfter){
  if (!(loadAfter || (!state.reservoir && !state.tex))) return;
  if (p.texture === true && MS.tex){ state.tex = MS.tex; state.reservoir = MS.tex.avg.slice(); }
  else { state.reservoir = parseColor(p.color, parseColor(fgHex(), [0, 0, 0, 1])); state.tex = null; }
  state.amount = 1;
}

/* brush_cmds.rs:362-411 mixer_brush（文件坐标进来，L.x／L.y 由 readRegion／writeRegion 换算——铁律④） */
function mixerStroke(p, opts){
  const C = 'mixer.stroke';
  const pr = parsePoints(p.points); if (pr.error) return { ok:false, error:`${C}: ${pr.error}` };
  const t = targetLayer(p, C); if (t.fail) return t.fail; if (t.error) return { ok:false, error:`${C}: ${t.error}` };
  const b = resolveBrush(ownParams(p));
  const tp = resolveTip(p); if (tp.error) return { ok:false, error:`${C}: ${tp.error}` };
  b.tip = tp.tip; b.tipSeed = tp.seed;
  const tx = texParts(tp.texture);
  const pct = (k, d) => clamp(isNum(p[k]) ? p[k] : d, 0, 100) / 100;
  const m = { wet:pct('wet', MO.wet), load:pct('load', MO.load), mix:pct('mix', MO.mix), flow:pct('flow', MO.flow) };
  const sampleAll = flag(p, 'sampleAllLayers', MO.sampleAll);
  const clean = flag(p, 'cleanAfterStroke', true), loadAfter = flag(p, 'loadAfterStroke', true);
  const state = (opts && opts.state) || cloneState(MS);
  loadState(p, state, loadAfter);
  const sample = sampleAll ? ((opts && opts.sample) || compositeBuf()) : null;
  const B = applyMixerStroke(t.L, pr.pts, b, m, state, sample, t.lock, tx.grain, tx.mask);
  if (clean) state.pickup = null;                                   // MixerState::clean
  if (!(opts && opts.preview)){ Object.assign(MS, state); T._sync(); }
  return { ok:true, damage: B ? [B[0], B[1], B[2] - B[0], B[3] - B[1]] : [0, 0, 0, 0], rect:B, mixer:stateJSON(state) };
}

/* PS 2020「有用的混合画笔组合」（选项栏下拉，13 项＝自定＋干燥／湿润／潮湿／非常潮湿 四种 × 中／浅／深）：[id, [潮湿,载入,混合]]；只改这三格，流量不动（PS 同）。
   数值出处：Syd Johnson「Mixing It Up with Legacy Bristle Brushes in Photoshop – Mixer Refresher」（sydspix.wordpress.com 2025-07-14，逐项列 PS 下拉的值）：
     干燥类 潮湿 0、载入 干燥 50／浅描 5；湿润类 潮湿 10、载入 5；潮湿类 潮湿 50、载入 50；非常潮湿类 潮湿 100、载入 50；
     混合 中＝50、浅混合＝0、深混合＝100。
   推定（出处没写或明显笔误）：干燥类的混合（潮湿 0 时混合不起作用，PS 栏位照填 0）；干燥，深描 的载入（原文写 50 与「干燥」重复，照名称取 100）。 */
const COMBOS = [['custom', null], ['dry', [0, 50, 0]], ['dryLight', [0, 5, 0]], ['dryHeavy', [0, 100, 0]],
  ['moist', [10, 5, 50]], ['moistLight', [10, 5, 0]], ['moistHeavy', [10, 5, 100]],
  ['wet', [50, 50, 50]], ['wetLight', [50, 50, 0]], ['wetHeavy', [50, 50, 100]],
  ['veryWet', [100, 50, 50]], ['veryWetLight', [100, 50, 0]], ['veryWetHeavy', [100, 50, 100]]];
const comboOf = () => { const c = COMBOS.find(([, v]) => v && v[0] === MO.wet && v[1] === MO.load && v[2] === MO.mix); return c ? c[0] : 'custom'; };

CMD.reg('mixer.stroke', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?],…] 文件坐标（必填）, size?:px=工具大小, hardness?:0..1=工具硬度, spacing?:0.01..10（直径倍数）=0.1, '
       + 'brush?:{size,hardness,spacing,flow,opacity,pressureSize, angle 度, roundness 0..1, flipX, flipY, shapeDynamics{enabled,size{jitter,control,minimum},angle{jitter,control},roundness{jitter,control,minimum}}, scattering{…}, colorDynamics{…}, transfer{…}, texture{enabled,pattern,scale,depth,mode,…}（缺省＝混合器自己那支笔刷，见 mixer.brush.get）}, '
       + 'angle?:度, roundness?:0..1, seed?（形状动态抖动种子；缺省由 points 杂凑）, pressureSize?:bool=true, '
       + 'wet:0..100=选项栏湿度(50), load:0..100=载入量(50), mix:0..100=混合(50), flow:0..100=流量(100), color?:"#rrggbb"=前景色（载入储槽的颜色）, '
       + 'texture?:bool（true＝储槽装目前载入的图案，见 mixer.load {x,y}）, '
       + 'sampleAllLayers:bool=选项栏, cleanAfterStroke:bool=true（收笔清掉拾取色）, loadAfterStroke:bool=true（下笔前把储槽重新装满）, layerId?} '
       + '混合器画笔一笔（一步历史）→ {damage:[x,y,w,h], mixer:{reservoir, amount, pickup, texture}}'},
  p => mixerStroke(p));
CMD.reg('mixer.load', {i18n:'', params:'{color?:"#rrggbb"|[r,g,b]=前景色} 把储槽装满这个颜色（＝PS「载入画笔」）；或 {x,y 文件坐标, size?:px=笔尖直径, solidOnly?:bool=选项栏「只载入纯色」} ＝Alt 点取样：'
       + '把那里笔尖大小的整块图案载进储槽（只载入纯色＝只取那一点的颜色；sampleAllLayers 时取合成）；工具状态，不进历史 → 储槽状态'},
  p => {
    if (isNum(p.x) && isNum(p.y)){
      const solid = typeof p.solidOnly === 'boolean' ? p.solidOnly : MO.solidOnly;
      if (!solid){
        const t = captureTex(p.x, p.y, isNum(p.size) ? p.size : ownSize(), MO.sampleAll);
        if (!t) return { ok:false, error:'mixer.load: nothing to sample there (transparent or no pixel layer)' };
        Object.assign(MS, { tex:t, reservoir:t.avg.slice(), amount:1, srcFg:fgHex() });
      } else {
        const x = Math.floor(p.x), y = Math.floor(p.y);
        let c = null;
        if (MO.sampleAll){ const s = compositeBuf(); if (x >= 0 && y >= 0 && x < s.w && y < s.h){ const i = (y * s.w + x) * 4; c = [s.d[i], s.d[i + 1], s.d[i + 2], s.d[i + 3]]; } }
        else {
          const L = Doc.active();
          if (L && L.kind === 'raster' && L.data && L.data.canvas){
            const lx = x - L.x, ly = y - L.y;
            if (lx >= 0 && ly >= 0 && lx < L.data.canvas.width && ly < L.data.canvas.height){ const d = L.data.ctx.getImageData(lx, ly, 1, 1).data; c = [d[0], d[1], d[2], d[3]]; }
          }
        }
        if (!c || c[3] <= 0) return { ok:false, error:'mixer.load: nothing to sample there' };
        Object.assign(MS, { tex:null, reservoir:[c[0] / 255, c[1] / 255, c[2] / 255, 1], amount:1, srcFg:fgHex() });
      }
    } else Object.assign(MS, { tex:null, reservoir:parseColor(p.color, parseColor(fgHex(), [0, 0, 0, 1])), amount:1, srcFg:fgHex() });
    T._sync(); if (window.UI && UI.canvas) UI.draw();
    return Object.assign({ ok:true }, stateJSON(MS));
  });
CMD.reg('mixer.clean', {i18n:'', params:'{} 清理画笔：丢掉拾取槽里沾到的颜色（MixerState::clean）；工具状态，不进历史'},
  () => { MS.pickup = null; T._sync(); return Object.assign({ ok:true }, stateJSON(MS)); });
CMD.reg('mixer.state', {i18n:'', params:'{} → {reservoir:"#rrggbb"|null, amount:0..1, pickup:"#rrggbb"|null, texture:{w,h,x,y}|null, options}'},
  () => Object.assign({ ok:true }, stateJSON(MS), { options:Object.assign({ combo:comboOf() }, MO) }));
CMD.reg('mixer.setOptions', {i18n:'',
  params:'{wet?,load?,mix?,flow?:0..100, combo?:"dry|dryLight|dryHeavy|moist|moistLight|moistHeavy|wet|wetLight|wetHeavy|veryWet|veryWetLight|veryWetHeavy"（PS 有用的混合画笔组合，设潮湿／载入／混合）, '
       + 'sampleAllLayers?:bool, loadAfterStroke?:bool, cleanAfterStroke?:bool, solidOnly?:bool（只载入纯色）, size?:px（与笔刷共用）, hardness?:0..1} '
       + '改混合器画笔选项（不进历史）；传 {} 只读现值'},
  p => {
    if (typeof p.combo === 'string' && p.combo !== 'custom'){
      const c = COMBOS.find(([id]) => id === p.combo);
      if (!c) return { ok:false, error:`mixer.setOptions: unknown combo "${p.combo}"` };
      MO.wet = c[1][0]; MO.load = c[1][1]; MO.mix = c[1][2];
    }
    for (const k of ['wet', 'load', 'mix', 'flow']) if (isNum(p[k])) MO[k] = clamp(p[k], 0, 100);
    if (typeof p.sampleAllLayers === 'boolean') MO.sampleAll = p.sampleAllLayers;
    if (typeof p.loadAfterStroke === 'boolean') MO.loadAfter = p.loadAfterStroke;
    if (typeof p.cleanAfterStroke === 'boolean') MO.cleanAfter = p.cleanAfterStroke;
    if (typeof p.solidOnly === 'boolean') MO.solidOnly = p.solidOnly;
    setOwnSH(p);
    T._sync();
    return { ok:true, wet:MO.wet, load:MO.load, mix:MO.mix, flow:MO.flow, combo:comboOf(), sampleAllLayers:MO.sampleAll, loadAfterStroke:MO.loadAfter,
             cleanAfterStroke:MO.cleanAfter, solidOnly:MO.solidOnly, size:ownSize(), hardness:ownHard() };
  });

/* 混合器自己那支笔刷（画笔设置面板在手上是混合器时读写这两条；栏位同 brush.set，另加 texture{…}） */
const brushOut = () => { const o = fullBrush(); o.seed = String(o.seed); o.ok = true; return o; };
CMD.reg('mixer.brush.set', {i18n:'',
  params:'{reset?:bool（回预设）, brush?:{…}, 或直接给栏位（深合并，同 brush.set）：size, hardness, spacing, spacingEnabled, angle, roundness, flipX, flipY, '
       + 'shapeDynamics{…}, scattering{enabled,scatter{jitter,control},bothAxes,count,countJitter{…}}, colorDynamics{enabled,perTip,fgBg{…},hueJitter,saturationJitter,brightnessJitter,purity}, transfer{…}, '
       + 'texture{enabled, pattern:图案 id|名字（缺省＝图案库第一个）, invert, scale:0.01..10（1＝100%）, brightness:-150..150, contrast:-50..100, eachTip, mode:"' + TEX_MODES.join('|') + '", depth:0..1}} '
       + '混合器画笔自己的笔尖（PS 每颗工具各记一份；跟画笔工具的 brush.set 互不影响）；工具状态，不进历史 → 整支笔刷'},
  p => {
    const E = eng(); if (!E) return { ok:false, error:'mixer.brush.set: brush engine (tools/brush.js) not loaded' };
    let b = fullBrush();
    if (p.reset === true){ b = E.defaultBrush(); if (b.smoothing) b.smoothing.amount = 0; b.texture = defTexture(); }
    const patches = [];
    if (p.brush && typeof p.brush === 'object') patches.push(Object.assign({}, p.brush));
    const top = Object.assign({}, p); ['preset', 'reset', 'coalesce', 'brush'].forEach(k => delete top[k]); patches.push(top);
    try {
      for (const q of patches){
        if ('texture' in q){ b.texture = mergeTexture(b.texture, q.texture); delete q.texture; }
        const tx = b.texture; b = E.mergeBrush(b, q).b; b.texture = tx;
      }
    } catch (err){ return { ok:false, error:err.message }; }
    setOwnSH({ size:clamp(b.size, SIZE_MIN, SIZE_MAX), hardness:clamp(b.hardness, 0, 1) });
    delete b.size; delete b.hardness; delete b._seed;
    OWN.brush = b;
    T._sync(); if (window.UI && UI.canvas) UI.draw();
    return brushOut();
  });
CMD.reg('mixer.brush.get', {i18n:'', params:'{} 读混合器画笔自己那支笔刷（含大小／硬度、纹理）'}, () => brushOut());

/* 笔尖间距：PS 的混合器画笔用「画笔设置」面板（F5）里它自己那支笔刷的间距；间距没勾＝照预设 0.1 */
function brushSpacing(){
  const b = ownBrush();
  return isNum(b.spacing) && b.spacingEnabled !== false ? clamp(b.spacing, 0.01, 10) : 0.1;
}
/* 滑鼠：送出的参数＝选项栏现值（agent 照抄这包参数就得到同样的像素）。
   储槽：载入后前景色没换过 ⇒ 用载入的那份（图案＝texture:true、Alt 取的纯色＝color）；换过前景色 ⇒ 前景色（PS 行为） */
function strokeParams(L, points){
  const fg = fgHex(), loaded = !!MS.reservoir && MS.srcFg === fg;
  const p = { points, layerId:L.id, size:ownSize(), hardness:ownHard(), spacing:brushSpacing(), wet:MO.wet, load:MO.load, mix:MO.mix, flow:MO.flow,
              sampleAllLayers:MO.sampleAll, loadAfterStroke:MO.loadAfter, cleanAfterStroke:MO.cleanAfter, color: loaded && !MS.tex ? hexOf(MS.reservoir) : fg };
  if (loaded && MS.tex) p.texture = true;
  if (T._strokeSeed) p.seed = T._strokeSeed;                       // 形状动态抖动的种子：一笔从按下到放开同一个（边拖边显示＝放开结果）
  return p;
}
/* 边拖边显示（增量）：按下时备份整层（Gesture 的 bak）；每次只把新增的笔印画进一块持续的浮点工作区，再把新增那块按选区混回图层。
   结果跟放开后 mixer.stroke 整笔重算逐像素相同（同一串笔印、同一套算式、同一个起始储槽） */
function liveStroke(L, points, d){
  let pv = d.pv;
  if (!pv){
    const p = strokeParams(L, points), t = targetLayer(p, 'mixer.stroke');
    if (!t.L) return null;
    const b = Object.assign(resolveBrush(p), { opacity:1 });
    const tp = resolveTip(p); b.tip = tp.tip || null; b.tipSeed = tp.seed;
    const pct = k => clamp(p[k], 0, 100) / 100;
    const state = cloneState(d.state);
    loadState(p, state, p.loadAfterStroke);
    b.resColor = state.reservoir || (state.tex && state.tex.avg) || null;   // 颜色动态的「前景」＝储槽色（同 applyMixerStroke）
    const tx = texParts(tp.texture);
    pv = d.pv = { b, lock:t.lock, n:0, reg:null, dmg:null, mask:tx.mask,
                  E:mixerEffect({ wet:pct('wet'), load:pct('load'), mix:pct('mix'), flow:pct('flow') }, state, d.sample, t.lock, tx.grain),
                  bakL:{ x:L.x, y:L.y, data:{ canvas:d.bak, ctx:d.bak.getContext('2d') } } };
  }
  const ds = strokeDabs(points, pv.b);
  if (ds.length <= pv.n) return pv.dmg;
  let B = null; for (let i = pv.n; i < ds.length; i++) B = uni(B, dabRect(ds[i]));
  // 工作区不够大就长大（多留 64px，免得一直重配）：新的部分从备份读、旧的部分沿用工作区
  if (!pv.reg || B[0] < pv.reg.rect[0] || B[1] < pv.reg.rect[1] || B[2] > pv.reg.rect[2] || B[3] > pv.reg.rect[3]){
    const M = 64, R = uni(pv.reg ? pv.reg.rect : null, [B[0] - M, B[1] - M, B[2] + M, B[3] + M]);
    const nr = readRegion(pv.bakL, R);
    if (pv.reg){ const o = pv.reg;
      for (let y = o.rect[1]; y < o.rect[3]; y++){ const si = ri(o, o.rect[0], y), di = ri(nr, o.rect[0], y); nr.d.set(o.d.subarray(si, si + o.w * 4), di); } }
    pv.reg = nr;
  }
  for (let i = pv.n; i < ds.length; i++) pv.E.effect(pv.reg, footprint(ds[i], pv.b.hardness, i));
  pv.n = ds.length;
  const out = readRegion(pv.bakL, B);
  for (let y = B[1]; y < B[3]; y++) for (let x = B[0]; x < B[2]; x++){
    const k = selAt(x, y) * (pv.mask ? pv.mask(x, y) : 1); if (k <= 0) continue;
    const i = ri(out, x, y), j = ri(pv.reg, x, y);
    if (!pv.lock) mixPremultiplied(out.d, i, pv.reg.d, j, k);
    else for (let c = 0; c < 3; c++) out.d[i + c] += (pv.reg.d[j + c] - out.d[i + c]) * k;
  }
  writeRegion(L, out);
  pv.dmg = uni(pv.dmg, B);
  return pv.dmg;
}
const gesture = Gesture({
  id:'mixer', key:'mixer', cross:false, incremental:true,
  setOpts: o => CMD.run('mixer.setOptions', o),
  tip(){ const b = ownBrush(); return { angle:(isNum(b.angle) ? b.angle : 0) * Math.PI / 180, roundness:isNum(b.roundness) ? clamp(b.roundness, 0.01, 1) : 1 }; },
  begin(d){ T._strokeSeed = String(Math.floor(Math.random() * 4294967296)); d.state = cloneState(MS); d.sample = MO.sampleAll ? compositeBuf() : null; d.pv = null; },
  live: liveStroke,
  commit(L, points){ const p = strokeParams(L, points); T.lastParams = p; CMD.run('mixer.stroke', p); },
  /* PS：Alt 点＝从画布取样装进储槽（PhotoCraft 没有这个手势，照 PS 补）：缺省载入笔尖底下整块图案，勾「只载入纯色」才只取一色 */
  alt(pt){ CMD.run('mixer.load', { x:pt[0], y:pt[1] }); }
});

/* 描边路径（PS 路径面板 ▸ 描边路径… ▸ 工具＝混合器画笔）：用目前混合器选项＋载入的储槽，给 ps.path.stroke 叫 */
function pathParams(L, points){ const p = strokeParams(L, points); delete p.seed; p.pressureSize = !!(points.length && points.some(q => q.length > 2 && q[2] < 1)); return p; }

/* ── 选项栏「画笔预设」选取器（PS：点笔尖缩图下拉＝大小、硬度＋画笔预设清单；点「硬边圆」就换成它） ── */
const PRESET_ZH = { 'Hard Round':['硬邊圓', '硬边圆'], 'Soft Round':['柔邊圓', '柔边圆'], 'Hard Round Fine':['硬邊圓（細）', '硬边圆（细）'], 'Soft Round Large':['柔邊圓（大）', '柔边圆（大）'],
  'Hard Round Pressure Size':['硬邊圓壓力大小', '硬边圆压力大小'], 'Soft Round Pressure Size':['柔邊圓壓力大小', '柔边圆压力大小'],
  'Hard Round Pressure Opacity':['硬邊圓壓力不透明度', '硬边圆压力不透明度'], 'Soft Round Pressure Opacity':['柔邊圓壓力不透明度', '柔边圆压力不透明度'],
  'Hard Round Pressure Opacity and Flow':['硬邊圓壓力不透明度和流量', '硬边圆压力不透明度和流量'] };
const presetLabel = n => { const z = PRESET_ZH[n], l = window.Lang && Lang.cur; return z && l === 'zh-Hant' ? z[0] : z && l === 'zh-Hans' ? z[1] : n; };
let picker = null;
function closePicker(){ if (picker){ picker.remove(); picker = null; document.removeEventListener('pointerdown', outside, true); } }
function outside(e){ if (picker && !picker.contains(e.target) && !(e.target.closest && e.target.closest('[data-mixer="preset"]'))) closePicker(); }
function openPicker(anchor){
  closePicker();
  const box = picker = document.createElement('div'); box.id = 'mixerBrushPicker';
  box.style.cssText = 'position:fixed;z-index:60;background:#2a2d33;color:#ddd;border:1px solid #444;border-radius:6px;padding:8px 10px;width:250px;font:12px sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)';
  const row = (label, ...kids) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0';
    const s = document.createElement('span'); s.textContent = label; s.style.cssText = 'width:40px;color:#aaa'; r.appendChild(s); kids.forEach(k => r.appendChild(k)); box.appendChild(r); return r; };
  const inp = (type, a) => { const i = document.createElement('input'); i.type = type; Object.assign(i, a); return i; };
  const sz = inp('number', { min:1, max:5000, value:ToolState.size }); sz.dataset.picker = 'size'; sz.style.width = '64px';
  const lg = inp('range', { min:0, max:Math.log(5000), step:0.001, value:Math.log(Math.max(1, ToolState.size)) }); lg.dataset.picker = 'sizeLog'; lg.style.flex = '1';
  const hd = inp('range', { min:0, max:100, step:1, value:Math.round(ToolState.hardness * 100) }); hd.dataset.picker = 'hardness'; hd.style.flex = '1';
  const setSize = v => CMD.run('mixer.setOptions', { size:clamp(Math.round(v), SIZE_MIN, SIZE_MAX) });
  sz.onchange = () => { if (isFinite(+sz.value)) setSize(+sz.value); };
  lg.oninput = () => setSize(Math.exp(+lg.value));
  hd.oninput = () => CMD.run('mixer.setOptions', { hardness:clamp(+hd.value / 100, 0, 1) });
  row(Lang.t('ui.mixer.pSize'), lg, sz); row(Lang.t('ui.mixer.pHard'), hd);
  const list = document.createElement('div'); list.style.cssText = 'max-height:260px;overflow:auto;margin-top:6px;border-top:1px solid #444;padding-top:4px';
  const lr = CMD.map['ps.brush.presets.list'] ? CMD.map['ps.brush.presets.list'].run({}) : null;
  const groups = lr && lr.ok ? lr.groups : [{ name:'General', presets:[{ name:'Hard Round', size:30 }, { name:'Soft Round', size:45 }] }];
  for (const g of groups){
    const h = document.createElement('div'); h.textContent = '▾ ' + g.name; h.style.cssText = 'color:#999;margin:4px 0 2px'; list.appendChild(h);
    for (const it of g.presets){
      const r = document.createElement('div'); r.dataset.preset = it.name; r.title = it.name;
      r.style.cssText = 'display:flex;gap:6px;align-items:center;padding:2px 4px 2px 14px;cursor:pointer;border-radius:3px';
      r.innerHTML = `<span style="min-width:28px;text-align:right;color:#888">${it.size}</span><span>${presetLabel(it.name)}</span>`;
      r.onmouseenter = () => r.style.background = '#3a4a63'; r.onmouseleave = () => r.style.background = '';
      r.onclick = () => {
        if (CMD.map['ps.brush.presets.select']) CMD.run('ps.brush.presets.select', { preset:it.name });
        T._sync(); sz.value = ToolState.size; lg.value = Math.log(Math.max(1, ToolState.size)); hd.value = Math.round(ToolState.hardness * 100);
        list.querySelectorAll('[data-preset]').forEach(x => x.style.outline = x === r ? '1px solid #2f7fd8' : '');
      };
      list.appendChild(r);
    }
  }
  box.appendChild(list);
  document.body.appendChild(box);
  const rc = anchor.getBoundingClientRect();
  box.style.left = clamp(rc.left, 0, Math.max(0, innerWidth - box.offsetWidth)) + 'px';
  box.style.top = clamp(rc.bottom + 2, 0, Math.max(0, innerHeight - box.offsetHeight)) + 'px';
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape'){ e.preventDefault(); closePicker(); } });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

const COMBO_STR = {
  custom:['自訂', '自定', 'Custom'], dry:['乾燥', '干燥', 'Dry'], dryLight:['乾燥，淺描', '干燥，浅描', 'Dry, Light Load'], dryHeavy:['乾燥，深描', '干燥，深描', 'Dry, Heavy Load'],
  moist:['濕潤', '湿润', 'Moist'], moistLight:['濕潤，淺混合', '湿润，浅混合', 'Moist, Light Mix'], moistHeavy:['濕潤，深混合', '湿润，深混合', 'Moist, Heavy Mix'],
  wet:['潮濕', '潮湿', 'Wet'], wetLight:['潮濕，淺混合', '潮湿，浅混合', 'Wet, Light Mix'], wetHeavy:['潮濕，深混合', '潮湿，深混合', 'Wet, Heavy Mix'],
  veryWet:['非常潮濕', '非常潮湿', 'Very Wet'], veryWetLight:['非常潮濕，淺混合', '非常潮湿，浅混合', 'Very Wet, Light Mix'], veryWetHeavy:['非常潮濕，深混合', '非常潮湿，深混合', 'Very Wet, Heavy Mix'] };
const STR = {
  'zh-Hant':{ 'tool.mixer':'混合器筆刷工具', 'opt.mixer.wet':'潮濕', 'opt.mixer.load':'載入', 'opt.mixer.mix':'混合', 'opt.mixer.flow':'流量',
              'opt.mixer.sampleAll':'取樣全部圖層', 'opt.mixer.loadAfter':'每一筆後載入筆刷', 'opt.mixer.cleanAfter':'每一筆後清除筆刷', 'opt.mixer.reservoir':'儲槽',
              'opt.mixer.solidOnly':'只載入純色', 'opt.mixer.combo':'實用的混合筆刷組合', 'opt.mixer.preset':'筆刷',
              'ui.mixer.load':'載入筆刷', 'ui.mixer.clean':'清除筆刷', 'ui.mixer.diameter':'直徑：', 'ui.mixer.hardness':'硬度：', 'ui.mixer.pSize':'尺寸', 'ui.mixer.pHard':'硬度',
              'ui.mixer.brushSettings':'切換筆刷設定面板（F5）',
              'ui.mixer.hint':'拖曳＝混色塗抹；Alt＋點＝把筆尖底下那塊圖案載入筆刷（勾「只載入純色」＝只取一色）；Shift 拖曳＝直線；Shift＋點＝接上一筆；Ctrl+Alt 拖曳＝改大小／硬度；[ ]＝縮放筆尖' },
  'zh-Hans':{ 'tool.mixer':'混合器画笔工具', 'opt.mixer.wet':'潮湿', 'opt.mixer.load':'载入', 'opt.mixer.mix':'混合', 'opt.mixer.flow':'流量',
              'opt.mixer.sampleAll':'对所有图层取样', 'opt.mixer.loadAfter':'每次描边后载入画笔', 'opt.mixer.cleanAfter':'每次描边后清理画笔', 'opt.mixer.reservoir':'储槽',
              'opt.mixer.solidOnly':'只载入纯色', 'opt.mixer.combo':'有用的混合画笔组合', 'opt.mixer.preset':'画笔',
              'ui.mixer.load':'载入画笔', 'ui.mixer.clean':'清理画笔', 'ui.mixer.diameter':'直径：', 'ui.mixer.hardness':'硬度：', 'ui.mixer.pSize':'大小', 'ui.mixer.pHard':'硬度',
              'ui.mixer.brushSettings':'切换画笔设置面板（F5）',
              'ui.mixer.hint':'拖动＝混色涂抹；Alt＋点＝把笔尖底下那块图案载入画笔（勾「只载入纯色」＝只取一色）；Shift 拖动＝直线；Shift＋点＝接上一笔；Ctrl+Alt 拖动＝改大小／硬度；[ ]＝缩放笔尖' },
  'en':     { 'tool.mixer':'Mixer Brush Tool', 'opt.mixer.wet':'Wet', 'opt.mixer.load':'Load', 'opt.mixer.mix':'Mix', 'opt.mixer.flow':'Flow',
              'opt.mixer.sampleAll':'Sample All Layers', 'opt.mixer.loadAfter':'Load the brush after each stroke', 'opt.mixer.cleanAfter':'Clean the brush after each stroke', 'opt.mixer.reservoir':'Reservoir',
              'opt.mixer.solidOnly':'Load Solid Colors Only', 'opt.mixer.combo':'Useful mixer brush combinations', 'opt.mixer.preset':'Brush',
              'ui.mixer.load':'Load Brush', 'ui.mixer.clean':'Clean Brush', 'ui.mixer.diameter':'Diameter:', 'ui.mixer.hardness':'Hardness:', 'ui.mixer.pSize':'Size', 'ui.mixer.pHard':'Hardness',
              'ui.mixer.brushSettings':'Toggle the Brush Settings panel (F5)',
              'ui.mixer.hint':'Drag to paint and blend · Alt-click: load the image under the tip into the brush (Load Solid Colors Only = one colour) · Shift-drag: straight line · Shift-click: line from last stroke · Ctrl+Alt-drag: size/hardness · [ ]: brush size' }
};
['zh-Hant', 'zh-Hans', 'en'].forEach((l, i) => { for (const k in COMBO_STR) STR[l]['ui.mixer.combo.' + k] = COMBO_STR[k][i]; });

const T = Tools.reg({
  id:'mixer', icon:'≋', group:'raster', order:45, for:'raster', needs:'raster', opts:['size', 'hardness'],
  cursor:'none', hint:'ui.mixer.hint', strings:STR,
  mo:MO, ms:MS, applyMixerStroke, pathParams, paintHalfLife, combos:COMBOS, lastParams:null, _gesture:gesture, _strokeSeed:null,
  own:OWN, fullBrush, makeGrain, texModes:TEX_MODES, cursorShape:() => gesture.state.cursor || null,
  onDown:gesture.onDown, onMove:gesture.onMove, onUp:gesture.onUp, onKey:gesture.onKey,
  onDeactivate(){ closePicker(); gesture.onDeactivate(); }, drawOverlay:gesture.drawOverlay,
  _sync(){
    syncBar('mixer', 'mixer', { wet:MO.wet, load:MO.load, mix:MO.mix, flow:MO.flow, sampleAll:MO.sampleAll, loadAfter:MO.loadAfter,
                                cleanAfter:MO.cleanAfter, solidOnly:MO.solidOnly, combo:comboOf(), reservoir:swatchCss(MS) });
    const pb = document.querySelector('#optBody [data-mixer="preset"] span'); if (pb && ToolState.cur === 'mixer') pb.textContent = ToolState.size;
    if (picker) picker.querySelectorAll('[data-picker]').forEach(el => { if (el === document.activeElement) return;
      const k = el.dataset.picker; el.value = k === 'size' ? ToolState.size : k === 'sizeLog' ? Math.log(Math.max(1, ToolState.size)) : Math.round(ToolState.hardness * 100); });
  },
  /* 选项栏（PS 混合器画笔：画笔预设选取器、画笔设置面板、目前画笔载入（色块／图案缩图）、载入／清理、只载入纯色、自动载入／自动清理、
     有用的混合画笔组合、潮湿／载入／混合／流量、对所有图层取样） */
  buildOptions(box, add, mk){
    const B = bar(box, add, mk, 'mixer.setOptions', 'mixer');
    const pb = document.createElement('button'); pb.type = 'button'; pb.dataset.mixer = 'preset';
    pb.style.cssText = 'padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid #555;background:transparent;color:inherit;font:inherit';
    pb.innerHTML = `● <span>${ToolState.size}</span> ▾`;
    pb.onclick = () => picker ? closePicker() : openPicker(pb);
    add('mixer.preset', pb);
    B.btn('brushSettings', 'ui.mixer.brushSettings', () => CMD.map['ps.window.panel'] && CMD.run('ps.window.panel', { panel:'brushSettings' })).textContent = '⚙';
    const sw = document.createElement('span'); sw.dataset.mixer = 'reservoir';
    sw.style.cssText = 'display:inline-block;width:22px;height:22px;border:1px solid #888;vertical-align:middle;background:' + swatchCss(MS);
    add('mixer.reservoir', sw);
    B.btn('load', 'ui.mixer.load', () => CMD.run('mixer.load', {}));
    B.btn('clean', 'ui.mixer.clean', () => CMD.run('mixer.clean', {}));
    add('mixer.solidOnly', B.chk('solidOnly', MO.solidOnly, v => ({ solidOnly:v })));
    add('mixer.loadAfter', B.chk('loadAfter', MO.loadAfter, v => ({ loadAfterStroke:v })));
    add('mixer.cleanAfter', B.chk('cleanAfter', MO.cleanAfter, v => ({ cleanAfterStroke:v })));
    add('mixer.combo', B.sel('combo', COMBOS.map(([id]) => [id, 'ui.mixer.combo.' + id]), comboOf(), v => ({ combo:v })));
    for (const k of ['wet', 'load', 'mix', 'flow']) add('mixer.' + k, B.num(k, MO[k], 0, 100, v => ({ [k]:v })));
    add('mixer.sampleAll', B.chk('sampleAll', MO.sampleAll, v => ({ sampleAllLayers:v })));
  }
});

window.MixerBrush = T;

/* 换工具时对调笔尖大小／硬度（PS：混合器画笔自己记一份，跟画笔、橡皮擦等那份互不影响）：
   ToolState.cur 改成拦截式属性——换进混合器：先记下共用那份、换上混合器的；换出：存回混合器的、还原共用那份。
   不管从哪里换工具（工具栏、快捷键、UI.setTool、测试直接设）都走这一道；手上换完再刷画笔设置面板（面板显示手上工具的笔尖）。 */
(function hookCur(){
  const d = Object.getOwnPropertyDescriptor(ToolState, 'cur');
  if (!d || d.get) return;
  let cur = ToolState.cur;
  const shared = { size:ToolState.size, hardness:ToolState.hardness };
  Object.defineProperty(ToolState, 'cur', { configurable:true, enumerable:true,
    get(){ return cur; },
    set(v){
      if (v === cur) return;
      if (cur === 'mixer'){ OWN.size = ToolState.size; OWN.hardness = ToolState.hardness; ToolState.size = shared.size; ToolState.hardness = shared.hardness; }
      if (v === 'mixer'){ shared.size = ToolState.size; shared.hardness = ToolState.hardness; ToolState.size = OWN.size; ToolState.hardness = OWN.hardness; }
      const was = cur; cur = v;
      if ((was === 'mixer' || v === 'mixer') && window.DlPanels && DlPanels.isOpen && DlPanels.isOpen('brushSettings') && DlPanels.refresh)
        setTimeout(() => { try { DlPanels.refresh('brushSettings'); } catch (e){} }, 0);
    } });
})();
})();
