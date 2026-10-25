/* 污点修复画笔（J）：在瑕疵上点一下或涂一笔，放开时不用取样点、自动拿周围的内容补上，再用梯度域（Poisson）融进四周。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - engine/src/retouch_cmds.rs 255–450   pad_coverage、heal_region、dilate、SpotType、spot_heal_surface、spot_healing（paint.spotHealing）
   - algo/src/poisson.rs                   solve_membrane（串级多重网格＋SOR）、seamless_clone、membrane_fill
   - algo/src/inpaint.rs                   complete（PatchMatch＋EM 内容识别）、best_offset（近似匹配）、synthesize（创建纹理）、SplitMix64 Rng
   - paint/src/retouch.rs                  Region、apply_coverage／over_native（含锁透明像素）
   - ui-egui/src/retouch_ui.rs             收笔叫 paint.spotHealing {type}、选项栏（类型三选一、对所有图层取样）
   - ui-egui/src/canvas.rs                 笔尖圆圈（屏幕半径 > 6 才画中心十字 brush_tip_centre）、拖曳足迹、freehand
   - ui-egui/src/stroke_constraint.rs、stroke_trail.rs、brush_resize.rs   Shift 直线、足迹、Ctrl+Alt 改大小（照 tools/clone.js 那套）
   dab／覆盖图／间距（dabCoverage、walkDabs、strokeCoverage）照抄 tools/clone.js 97–166 行（同 paint/src/lib.rs、dynamics.rs）。
   这里同时挂 window.HealCore（修复两颗共用的算法与界面小件），tools/heal.js 读它。
   命令：spotheal.stroke / spotheal.setOptions */
(function(){

/* ───────── 小工具：矩形 [x0,y0,x1,y1)（photocraft_geom::Rect） ───────── */
const RC = {
  w: r => r[2]-r[0], h: r => r[3]-r[1],
  empty: r => r[2] <= r[0] || r[3] <= r[1],
  inflate: (r, m) => [r[0]-m, r[1]-m, r[2]+m, r[3]+m],
  intersect(a, b){
    const r = [Math.max(a[0],b[0]), Math.max(a[1],b[1]), Math.min(a[2],b[2]), Math.min(a[3],b[3])];
    return RC.empty(r) ? [0,0,0,0] : r;
  },
  contains: (r, x, y) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3]
};
const asNum  = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const asBool = (v, d) => typeof v === 'boolean' ? v : d;
const roundAway = v => v < 0 ? -Math.round(-v) : Math.round(v);

/* ───────── paint/src/lib.rs、dynamics.rs、retouch.rs：dab 与整笔覆盖图（照抄 clone.js） ───────── */
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
const baseDiameter = (brush, q) => brush.size * Math.min(Math.max(q[2], 0), 1);
const stepLen = (brush, q) => Math.max(Math.max(baseDiameter(brush, q), 1) * Math.max(brush.spacing, 0.01), 0.5);
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
function dabRect(c, radius){
  const rr = Math.ceil(radius) + 1, cx = Math.floor(c[0]), cy = Math.floor(c[1]);
  return [cx-rr, cy-rr, cx+rr+1, cy+rr+1];
}
function strokeCoverage(points, brush){
  const pts = points.map(q => [q[0], q[1], (typeof q[2] === 'number' && isFinite(q[2])) ? q[2] : 1]);
  const dabs = walkDabs(pts, brush);
  if (!dabs.length) return { rect:[0,0,0,0], cov:new Float32Array(0) };
  const radiusOf = d => Math.max(baseDiameter(brush, d)/2, 0.5);
  let R = null;
  for (const d of dabs){
    const r = dabRect(d, radiusOf(d));
    R = R ? [Math.min(R[0],r[0]), Math.min(R[1],r[1]), Math.max(R[2],r[2]), Math.max(R[3],r[3])] : r;
  }
  const W = R[2]-R[0], H = R[3]-R[1], cov = new Float32Array(W*H), ceil = 1;
  for (const d of dabs){
    const radius = radiusOf(d), r = dabRect(d, radius);
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
      const v = dabCoverage(Math.hypot(x + 0.5 - d[0], y + 0.5 - d[1]), radius, brush.hardness) * brush.flow;
      if (v <= 0) continue;
      const i = (y - R[1])*W + (x - R[0]), c = cov[i];
      if (ceil > c) cov[i] = c + v*(ceil - c);
    }
  }
  return { rect:R, cov };
}

/* ───────── retouch_cmds.rs parse_brush：共用的笔刷参数 ───────── */
function parseBrush(p, cmd){
  if (!Array.isArray(p.points)) return {error:`${cmd}: missing \`points\``};
  const pts = p.points.filter(a => Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number')
                      .map(a => [a[0], a[1], typeof a[2] === 'number' ? a[2] : 1]);
  if (!pts.length) return {error:`${cmd}: \`points\` is empty`};
  const pct = (k, d, lo, hi) => Math.min(Math.max(asNum(p[k], d), lo), hi) / 100;
  const brush = {
    size: Math.max(asNum(p.size, ToolState.size), 1),
    hardness: pct('hardness', ToolState.hardness*100, 0, 100),
    opacity: pct('opacity', 100, 1, 100),
    flow: pct('flow', 100, 1, 100),
    spacing: pct('spacing', 25, 1, 1000)
  };
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`active layer is a ${L.kind} layer, not a pixel layer`};
  return {pts, brush, L};
}
/* 图层锁（我们这边的 Locks）：锁像素／全锁 ⇒ 整笔挡掉；锁透明像素 ⇒ apply_coverage 的 lock_transparency */
function lockFail(L, cmd){
  if (!window.Locks) return null;
  const k = Locks.blocks(L, 'pixels'); if (!k) return null;
  Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, cmd);
}
const lockAlpha = L => !!(window.Locks && Locks.alpha(L));

/* ───────── 像素来源（Region：rect、ch=4、data＝0..1 的 Float32，直通 alpha） ───────── */
function layerBuffer(L){
  const c = L.data.canvas;
  return { d: L.data.ctx.getImageData(0, 0, c.width, c.height).data, w:c.width, h:c.height, ox:L.x, oy:L.y };
}
/* composite_region：整份文件（all）或目标层＋它下面（currentAndBelow，把上面的层藏起来再合成） */
function compositeBuffer(L, which){
  const idx = Doc.index(L.id), hidden = [];
  if (which === 'currentAndBelow') Doc.layers.forEach((l, i) => { if (i > idx && l.visible){ l.visible = false; hidden.push(l); } });
  let c;
  try { c = composite(1); } finally { hidden.forEach(l => l.visible = true); }
  return { d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w:c.width, h:c.height, ox:0, oy:0 };
}
const sourceBuffer = (L, which) => which === 'current' ? layerBuffer(L) : compositeBuffer(L, which);
function fetchPx(S, x, y, out){
  const bx = x - S.ox, by = y - S.oy;
  if (bx < 0 || by < 0 || bx >= S.w || by >= S.h){ out[0]=out[1]=out[2]=out[3]=0; return; }
  const i = (by*S.w + bx)*4;
  out[0]=S.d[i]; out[1]=S.d[i+1]; out[2]=S.d[i+2]; out[3]=S.d[i+3];
}
/* Region::read：缓冲外＝透明 */
function readRegion(S, rect){
  const W = RC.w(rect), H = RC.h(rect), data = new Float32Array(W*H*4), q = [0,0,0,0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    fetchPx(S, rect[0]+x, rect[1]+y, q);
    const o = (y*W+x)*4; data[o]=q[0]/255; data[o+1]=q[1]/255; data[o+2]=q[2]/255; data[o+3]=q[3]/255;
  }
  return { rect:rect.slice(), ch:4, data };
}
const regIndex = (g, x, y) => (y - g.rect[1]) * RC.w(g.rect) + (x - g.rect[0]);
/* Region::crop */
function cropRegion(g, r){
  r = RC.intersect(r, g.rect);
  const W = RC.w(r), out = { rect:r, ch:g.ch, data:new Float32Array(W*RC.h(r)*g.ch) }, n = g.ch;
  for (let y = r[1]; y < r[3]; y++){
    const s = regIndex(g, r[0], y)*n;
    out.data.set(g.data.subarray(s, s + W*n), (y - r[1])*W*n);
  }
  return out;
}
/* clone_sample（retouch_cmds.rs:193）：恒等＝整数平移直读；有缩放／旋转／翻转＝双线性（预乘内插，同 clone.js） */
function cloneSample(S, rect, map){
  if (map.isTranslation()){
    const off = map.offset();
    const r = readRegion(S, [rect[0]+off[0], rect[1]+off[1], rect[2]+off[0], rect[3]+off[1]]);
    r.rect = rect.slice(); return r;
  }
  const W = RC.w(rect), H = RC.h(rect), out = new Float32Array(W*H*4);
  const Q = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  const pre = b => { const a = b[3]/255; b[0]*=a; b[1]*=a; b[2]*=a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const [sx, sy] = map.map(rect[0]+x+0.5, rect[1]+y+0.5);
    const fx = sx - 0.5, fy = sy - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    fetchPx(S, x0, y0, Q[0]); fetchPx(S, x0+1, y0, Q[1]); fetchPx(S, x0, y0+1, Q[2]); fetchPx(S, x0+1, y0+1, Q[3]);
    Q.forEach(pre);
    const o = (y*W+x)*4;
    for (let c = 0; c < 4; c++){
      const top = Q[0][c] + (Q[1][c]-Q[0][c])*tx, bot = Q[2][c] + (Q[3][c]-Q[2][c])*tx;
      out[o+c] = top + (bot-top)*ty;
    }
    const av = out[o+3]/255;
    for (let c = 0; c < 3; c++) out[o+c] = av > 1e-6 ? out[o+c]/av/255 : 0;
    out[o+3] = av;
  }
  return { rect:rect.slice(), ch:4, data:out };
}

/* ───────── retouch.rs apply_coverage／over_native：经覆盖图把 paint 贴回图层 ─────────
   k = min(覆盖 × 不透明度 × 选区, 1)；lock＝锁透明像素：本来透明的格子跳过、alpha 不变。回传 rect（damage）。 */
function applyCoverage(L, rect, cov, opacity, paint, mode, lock){
  if (RC.empty(rect)) return [0,0,0,0];
  const W = RC.w(rect);
  const cw = L.data.canvas.width, ch = L.data.canvas.height;
  const cx0 = Math.max(rect[0], L.x), cy0 = Math.max(rect[1], L.y);
  const cx1 = Math.min(rect[2], L.x + cw), cy1 = Math.min(rect[3], L.y + ch);
  if (cx1 <= cx0 || cy1 <= cy0) return rect;
  const s = Doc.sel;
  const selAt = (x, y) => {
    if (!s) return 1;
    if (window.SelMask) return SelMask.coverage(x, y, s);
    const sx0 = Math.min(s.x, s.x+s.w), sy0 = Math.min(s.y, s.y+s.h), sx1 = Math.max(s.x, s.x+s.w), sy1 = Math.max(s.y, s.y+s.h);
    return (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) ? 1 : 0;
  };
  const rw = cx1-cx0, rh = cy1-cy0, ctx = L.data.ctx, P = paint.data;
  const img = ctx.getImageData(cx0 - L.x, cy0 - L.y, rw, rh), d = img.data;
  if (mode === 'normal'){
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++){
      const i = (y - rect[1])*W + (x - rect[0]);
      const k = Math.min(cov[i] * opacity * selAt(x, y), 1);
      if (k <= 0) continue;
      const o = ((y - cy0)*rw + (x - cx0))*4;
      if (lock && d[o+3] <= 0) continue;
      const pi = regIndex(paint, x, y)*4;
      const da = d[o+3]/255, sa = P[pi+3] * k, oa = sa + da*(1 - sa);
      if (oa > 0) for (let c = 0; c < 3; c++) d[o+c] = (P[pi+c]*255*sa + d[o+c]*da*(1 - sa)) / oa;
      if (!lock) d[o+3] = oa*255;
    }
    ctx.putImageData(img, cx0 - L.x, cy0 - L.y);
    return rect;
  }
  // 非 normal：W3C 混合交给画布（paint 的 alpha 乘上 k）；锁透明像素时事后把 alpha 还原、本来透明的整格还原
  const before = lock ? new Uint8ClampedArray(d) : null;
  const t = document.createElement('canvas'); t.width = rw; t.height = rh;
  const tx = t.getContext('2d'), ti = tx.createImageData(rw, rh), td = ti.data;
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++){
    const i = (y - rect[1])*W + (x - rect[0]);
    const k = Math.min(cov[i] * opacity * selAt(x, y), 1);
    if (k <= 0) continue;
    const o = ((y - cy0)*rw + (x - cx0))*4, pi = regIndex(paint, x, y)*4;
    td[o]=P[pi]*255; td[o+1]=P[pi+1]*255; td[o+2]=P[pi+2]*255; td[o+3]=P[pi+3]*255*k;
  }
  tx.putImageData(ti, 0, 0);
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); blendDraw(ctx, t, cx0 - L.x, cy0 - L.y, mode, 1); ctx.restore();
  if (lock){
    const after = ctx.getImageData(cx0 - L.x, cy0 - L.y, rw, rh), a = after.data;
    for (let o = 0; o < a.length; o += 4){
      if (before[o+3] <= 0){ a[o]=before[o]; a[o+1]=before[o+1]; a[o+2]=before[o+2]; a[o+3]=0; }
      else a[o+3] = before[o+3];
    }
    ctx.putImageData(after, cx0 - L.x, cy0 - L.y);
  }
  return rect;
}

/* ───────── algo/src/poisson.rs ───────── */
const TOL = 2e-5, FINE_ITERS = 30, FINE_OMEGA = 1.7;
/* solve_membrane：unknown 格解 Δv=0，已知格当 Dirichlet；格外邻居不算（Neumann）。串级多重网格＋SOR */
function solveMembrane(w, h, unknown, v){ solveRec(w, h, unknown, v, 0); }
function solveRec(w, h, unknown, v, depth){
  let nU = 0, sumK = 0, nK = 0;
  for (let i = 0; i < w*h; i++){ if (unknown[i]) nU++; else { sumK += v[i]; nK++; } }
  if (nU === 0) return;
  if (nK === 0) return;                                   // 没有可内插的
  if (w >= 8 && h >= 8 && nU > 64 && depth < 16){
    // 限制：粗格只要有一个子格已知就算已知（值＝已知子格平均）
    const cw = Math.ceil(w/2), chh = Math.ceil(h/2);
    const cu = new Uint8Array(cw*chh).fill(1), cv = new Float64Array(cw*chh);
    for (let cy = 0; cy < chh; cy++) for (let cx = 0; cx < cw; cx++){
      let s = 0, n = 0;
      for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]){
        const x = cx*2 + dx, y = cy*2 + dy;
        if (x < w && y < h && !unknown[y*w + x]){ s += v[y*w + x]; n++; }
      }
      if (n > 0){ cu[cy*cw + cx] = 0; cv[cy*cw + cx] = s / n; }
    }
    solveRec(cw, chh, cu, cv, depth + 1);
    // 延拓：粗解双线性取样当初值
    for (let y = 0; y < h; y++){
      const fy = Math.min(Math.max((y + 0.5)/2 - 0.5, 0), chh - 1);
      const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, chh - 1), ty = fy - y0;
      for (let x = 0; x < w; x++){
        if (!unknown[y*w + x]) continue;
        const fx = Math.min(Math.max((x + 0.5)/2 - 0.5, 0), cw - 1);
        const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, cw - 1), tx = fx - x0;
        const a = cv[y0*cw + x0] + (cv[y0*cw + x1] - cv[y0*cw + x0]) * tx;
        const b = cv[y1*cw + x0] + (cv[y1*cw + x1] - cv[y1*cw + x0]) * tx;
        v[y*w + x] = a + (b - a) * ty;
      }
    }
    sor(w, h, unknown, v, FINE_ITERS, FINE_OMEGA);
  } else {
    const mean = sumK / nK;
    for (let i = 0; i < w*h; i++) if (unknown[i]) v[i] = mean;
    sor(w, h, unknown, v, 2000, 1.85);
  }
}
function sor(w, h, unknown, v, maxIter, omega){
  const cells = [], masks = [];
  for (let i = 0; i < w*h; i++){
    if (!unknown[i]) continue;
    const x = i % w, y = (i / w) | 0;
    cells.push(i); masks.push((x > 0 ? 1 : 0) | (x + 1 < w ? 2 : 0) | (y > 0 ? 4 : 0) | (y + 1 < h ? 8 : 0));
  }
  for (let it = 0; it < maxIter; it++){
    let maxD = 0;
    for (let k = 0; k < cells.length; k++){
      const i = cells[k], m = masks[k];
      let s, n;
      if (m === 15){ s = v[i-1] + v[i+1] + v[i-w] + v[i+w]; n = 4; }
      else {
        s = 0; n = 0;
        if (m & 1){ s += v[i-1]; n++; }
        if (m & 2){ s += v[i+1]; n++; }
        if (m & 4){ s += v[i-w]; n++; }
        if (m & 8){ s += v[i+w]; n++; }
        if (n === 0) continue;
      }
      const d = omega * (s/n - v[i]);
      v[i] += d;
      if (Math.abs(d) > maxD) maxD = Math.abs(d);
    }
    if (maxD < TOL) break;
  }
}
/* 逐通道（他们桌面版平行跑，结果与顺序无关） */
function perChannel(w, h, ch, f){
  const out = new Float32Array(w*h*ch);
  for (let c = 0; c < ch; c++){
    const p = f(c);
    for (let i = 0; i < w*h; i++) out[i*ch + c] = p[i];
  }
  return out;
}
/* seamless_clone（Pérez 2003，引导场＝∇src）：遮罩外＝dst；遮罩内＝src＋消掉边界落差的膜 */
function seamlessClone(w, h, ch, src, dst, mask){
  return perChannel(w, h, ch, c => {
    const hv = new Float64Array(w*h);
    for (let i = 0; i < w*h; i++) hv[i] = mask[i] ? 0 : dst[i*ch + c] - src[i*ch + c];
    solveMembrane(w, h, mask, hv);
    const o = new Float64Array(w*h);
    for (let i = 0; i < w*h; i++) o[i] = mask[i] ? src[i*ch + c] + hv[i] : dst[i*ch + c];
    return o;
  });
}
/* membrane_fill：没有来源纹理，只把周围的已知值调和内插进洞 */
function membraneFill(w, h, ch, img, hole){
  return perChannel(w, h, ch, c => {
    const v = new Float64Array(w*h);
    for (let i = 0; i < w*h; i++) v[i] = hole[i] ? 0 : img[i*ch + c];
    solveMembrane(w, h, hole, v);
    return v;
  });
}

/* ───────── algo/src/inpaint.rs ───────── */
/* SplitMix64（u64 用 BigInt 算，结果跟他们逐位一样） */
const M64 = (1n << 64n) - 1n, GOLD = 0x9E3779B97F4A7C15n;
function Rng(seed){ this.s = (BigInt.asUintN(64, BigInt(seed)) ^ GOLD) & M64; }
Rng.prototype.next = function(){
  this.s = (this.s + GOLD) & M64;
  let z = this.s;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & M64;
  return z ^ (z >> 31n);
};
Rng.prototype.range = function(lo, hi){ return hi <= lo ? lo : lo + Number(this.next() % BigInt(hi - lo + 1)); };
Rng.prototype.below = function(n){ return Number(this.next() % BigInt(n)); };
const u64 = v => BigInt.asUintN(64, BigInt(v));

const COMPLETE_DEFAULT = { patchRadius:3, emIters:8, minEmIters:2, pmIters:2, refineExtent:96, seed:1n };

function downsample(l, ch){
  const w = Math.ceil(l.w/2), h = Math.ceil(l.h/2);
  const img = new Float64Array(w*h*ch), hole = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    let n = 0; const o = (y*w + x)*ch;
    for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]){
      const sx = x*2 + dx, sy = y*2 + dy;
      if (sx >= l.w || sy >= l.h) continue;
      const si = sy*l.w + sx;
      if (l.hole[si]) hole[y*w + x] = 1;
      else { for (let c = 0; c < ch; c++) img[o+c] += l.img[si*ch + c]; n++; }
    }
    if (n > 0) for (let c = 0; c < ch; c++) img[o+c] /= n;
  }
  return { w, h, img, hole };
}
/* 布尔格的积分图（(w+1)×(h+1)） */
function integral(w, h, m){
  const s = new Uint32Array((w+1)*(h+1));
  for (let y = 0; y < h; y++){
    let row = 0;
    for (let x = 0; x < w; x++){ row += m[y*w + x] ? 1 : 0; s[(y+1)*(w+1) + x + 1] = s[y*(w+1) + x + 1] + row; }
  }
  return s;
}
function windowCount(s, gw, gh, x0, y0, x1, y1){
  x0 = Math.max(x0, 0); y0 = Math.max(y0, 0);
  x1 = Math.min(Math.max(x1, 0), gw); y1 = Math.min(Math.max(y1, 0), gh);
  if (x1 <= x0 || y1 <= y0) return 0;
  const w1 = gw + 1;
  return s[y1*w1 + x1] + s[y0*w1 + x0] - s[y0*w1 + x1] - s[y1*w1 + x0];
}
function holeBbox(w, h, hole){
  let b = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    if (!hole[y*w + x]) continue;
    if (!b) b = [x, y, x+1, y+1];
    else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x+1); b[3] = Math.max(b[3], y+1); }
  }
  return b;
}

/* 每层的 PatchMatch／EM 状态（nnf 用两条 Int32Array 存 (x,y)） */
function Solver(w, h, ch, r, img, hole, valid, validList, targets){
  Object.assign(this, {w, h, ch, r, img, hole, valid, validList, targets});
}
Solver.prototype.isValid = function(x, y){ return x >= 0 && y >= 0 && x < this.w && y < this.h && this.valid[y*this.w + x] === 1; };
/* 目标块（裁到格内）与来源块的平方差，按样本数平均；cutoff 提早出场 */
Solver.prototype.dist = function(tx0, ty0, sx0, sy0, cutoff){
  const w = this.w, h = this.h, ch = this.ch, r = this.r, img = this.img;
  const full = (2*r + 1)*(2*r + 1)*ch;
  let sum = 0, n = 0;
  for (let dy = -r; dy <= r; dy++){
    const ty = ty0 + dy;
    if (ty < 0 || ty >= h) continue;
    const sy = sy0 + dy;
    for (let dx = -r; dx <= r; dx++){
      const tx = tx0 + dx;
      if (tx < 0 || tx >= w) continue;
      const ti = (ty*w + tx)*ch, si = (sy*w + sx0 + dx)*ch;
      for (let c = 0; c < ch; c++){ const d = img[ti+c] - img[si+c]; sum += d*d; }
      n += ch;
    }
    if (sum > cutoff * full) return Infinity;
  }
  return n === 0 ? Infinity : sum / n;
};
/* 一趟 PatchMatch：16 行一带（他们平行跑各带，带内传播；这里依序跑，结果相同） */
Solver.prototype.patchmatch = function(NX, NY, cost, pass, seed, searchRadius){
  const BAND = 16, w = this.w, h = this.h, reverse = pass % 2 === 1, step = reverse ? -1 : 1;
  const nb = Math.ceil(h / BAND);
  for (let bi = 0; bi < nb; bi++){
    const rng = new Rng(u64(seed) ^ ((BigInt(bi) * 0x2545F4914F6CDD1Dn) & M64) ^ ((BigInt(pass) << 40n) & M64));
    const y0 = bi*BAND, rows = Math.min(BAND, h - y0);
    for (let ry = 0; ry < rows; ry++){
      const ly = reverse ? rows - 1 - ry : ry, y = y0 + ly;
      for (let rx = 0; rx < w; rx++){
        const x = reverse ? w - 1 - rx : rx, i = y*w + x;
        if (!this.targets[i]) continue;
        let bx = NX[i], by = NY[i], bc = cost[i];
        const nx = x - step;
        if (nx >= 0 && nx < w){
          const j = y*w + nx, cx = NX[j] + step, cy = NY[j];
          if (this.isValid(cx, cy) && (cx !== bx || cy !== by)){
            const d = this.dist(x, y, cx, cy, bc);
            if (d < bc){ bx = cx; by = cy; bc = d; }
          }
        }
        const nly = ly - step;
        if (nly >= 0 && nly < rows){
          const j = (y0 + nly)*w + x, cx = NX[j], cy = NY[j] + step;
          if (this.isValid(cx, cy) && (cx !== bx || cy !== by)){
            const d = this.dist(x, y, cx, cy, bc);
            if (d < bc){ bx = cx; by = cy; bc = d; }
          }
        }
        // 随机搜寻：视窗指数缩小
        let rad = searchRadius;
        while (rad >= 1){
          const cx = bx + rng.range(-rad, rad), cy = by + rng.range(-rad, rad);
          if (this.isValid(cx, cy) && (cx !== bx || cy !== by)){
            const d = this.dist(x, y, cx, cy, bc);
            if (d < bc){ bx = cx; by = cy; bc = d; }
          }
          rad = (rad / 2) | 0;
        }
        NX[i] = bx; NY[i] = by; cost[i] = bc;
      }
    }
  }
};
/* 投票：洞里每格＝所有盖到它的匹配块按相似度加权平均（σ² 取匹配代价的第 75 百分位） */
Solver.prototype.vote = function(NX, NY, cost){
  const w = this.w, h = this.h, ch = this.ch, r = this.r, img = this.img;
  const cs = [];
  for (let i = 0; i < w*h; i++) if (this.targets[i] && isFinite(cost[i])) cs.push(cost[i]);
  let sigma2 = 1;
  if (cs.length){
    const k = Math.min((cs.length*3/4) | 0, cs.length - 1);
    cs.sort((a, b) => a - b);
    sigma2 = Math.max(cs[k], 1e-6);
  }
  const upd = [];
  const acc = new Float64Array(ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    if (!this.hole[y*w + x]) continue;
    acc.fill(0); let wsum = 0;
    for (let dy = -r; dy <= r; dy++){
      const ty = y + dy; if (ty < 0 || ty >= h) continue;
      for (let dx = -r; dx <= r; dx++){
        const tx = x + dx; if (tx < 0 || tx >= w) continue;
        const ti = ty*w + tx;
        if (!this.targets[ti] || !isFinite(cost[ti])) continue;
        const sx = NX[ti] - dx, sy = NY[ti] - dy;
        const wt = Math.max(Math.exp(-cost[ti] / (2*sigma2)), 1e-8);
        const si = (sy*w + sx)*ch;
        for (let c = 0; c < ch; c++) acc[c] += img[si+c] * wt;
        wsum += wt;
      }
    }
    if (wsum > 0) upd.push(y*w + x, Array.from(acc, v => v / wsum));
  }
  for (let k = 0; k < upd.length; k += 2){
    const i = upd[k], v = upd[k+1];
    for (let c = 0; c < ch; c++) img[i*ch + c] = v[c];
  }
};

/* complete：内容识别补洞（Wexler 2007 EM ＋ Barnes 2009 PatchMatch，金字塔由粗到细）。没有完整已知块可抄＝回 null */
function complete(w, h, ch, img, hole, P){
  P = Object.assign({}, COMPLETE_DEFAULT, P || {});
  const bb = holeBbox(w, h, hole);
  if (!bb) return Float64Array.from(img);
  const r = Math.max(P.patchRadius, 1), psz = 2*r + 1;
  const levels = [{ w, h, img:Float64Array.from(img), hole:Uint8Array.from(hole) }];
  let ext = Math.max(bb[2]-bb[0], bb[3]-bb[1]);
  const exts = [ext];
  for (;;){
    const l = levels[levels.length-1];
    if (ext <= 2*psz || ((l.w/2) | 0) < 3*psz || ((l.h/2) | 0) < 3*psz) break;
    levels.push(downsample(l, ch));
    ext = Math.ceil(ext/2); exts.push(ext);
  }
  const nlev = levels.length;
  let NX = null, NY = null, prev = null;
  for (let li = nlev - 1; li >= 0; li--){
    const lw = levels[li].w, lh = levels[li].h, lhole = levels[li].hole;
    let limg = Float64Array.from(levels[li].img);
    // 洞的初值：最粗层＝膜内插；其他层＝上一层结果最近邻放大
    if (!prev) limg = Float64Array.from(membraneFill(lw, lh, ch, limg, lhole));
    else {
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
        if (!lhole[y*lw + x]) continue;
        const sx = Math.min(x >> 1, prev.w - 1), sy = Math.min(y >> 1, prev.h - 1);
        const d = (y*lw + x)*ch, s = (sy*prev.w + sx)*ch;
        for (let c = 0; c < ch; c++) limg[d+c] = prev.img[s+c];
      }
    }
    const ri = r, hs = integral(lw, lh, lhole);
    const valid = new Uint8Array(lw*lh), validList = [], targets = new Uint8Array(lw*lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
      const cnt = windowCount(hs, lw, lh, x - ri, y - ri, x + ri + 1, y + ri + 1);
      const inside = x >= ri && y >= ri && x + ri < lw && y + ri < lh;
      const i = y*lw + x;
      if (inside && cnt === 0){ valid[i] = 1; validList.push(x, y); }
      targets[i] = cnt > 0 ? 1 : 0;
    }
    if (!validList.length){
      if (li === 0) return null;
      prev = { w:lw, h:lh, img:limg }; NX = NY = null;
      continue;
    }
    const S = new Solver(lw, lh, ch, ri, limg, lhole, valid, validList, targets);
    const nValid = validList.length / 2;
    // NNF 初值：能从粗一层放大就放大，不然随机
    const rng = new Rng(u64(P.seed) ^ (BigInt(li) << 20n));
    const pwPrev = prev ? prev.w : 0;
    const oX = NX, oY = NY;
    NX = new Int32Array(lw*lh); NY = new Int32Array(lw*lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++){
      const i = y*lw + x;
      if (!targets[i]) continue;
      let got = false;
      if (oX && oX.length && pwPrev > 0){
        const pi = (y >> 1)*pwPrev + (x >> 1);
        if (pi < oX.length){
          const cx = oX[pi]*2 + (x % 2), cy = oY[pi]*2 + (y % 2);
          if (S.isValid(cx, cy)){ NX[i] = cx; NY[i] = cy; got = true; }
        }
      }
      if (!got){ const k = rng.below(nValid); NX[i] = validList[2*k]; NY[i] = validList[2*k+1]; }
    }
    const refineOnly = li + 1 < nlev && exts[li] > P.refineExtent;
    const em = (li + 1 === nlev) ? P.emIters : refineOnly ? 1 : Math.max(P.emIters >> (nlev - 1 - li), P.minEmIters);
    const pmIters = refineOnly ? 1 : P.pmIters;
    const fullSearch = Math.max(lw, lh);
    const cost = new Float64Array(lw*lh).fill(Infinity);
    for (let it = 0; it < em; it++){
      // 洞里的值在变：每轮 PatchMatch 前把代价重算一次
      for (let i = 0; i < lw*lh; i++) if (targets[i]) cost[i] = S.dist(i % lw, (i / lw) | 0, NX[i], NY[i], Infinity);
      const radius = refineOnly ? 2 : (li + 1 === nlev || it === 0) ? fullSearch : Math.min(4*psz, fullSearch);
      for (let pass = 0; pass < pmIters; pass++)
        S.patchmatch(NX, NY, cost, pass + it*pmIters, (u64(P.seed) + BigInt(li*1000 + it)) & M64, radius);
      S.vote(NX, NY, cost);
    }
    prev = { w:lw, h:lh, img:limg };
  }
  return prev ? prev.img : null;
}

/* best_offset：近似匹配——找一个位移，让洞四周那一圈跟位移后那一圈最像（平方差），位移后的框要在格内且不含洞 */
function bestOffset(w, h, ch, img, hole, ring, maxRadius){
  const bb = holeBbox(w, h, hole); if (!bb) return null;
  ring = Math.max(ring, 1);
  const hs = integral(w, h, hole);
  const x0 = bb[0] - ring, y0 = bb[1] - ring, x1 = bb[2] + ring, y1 = bb[3] + ring;
  let pts = [];
  for (let y = Math.max(y0, 0); y < Math.min(y1, h); y++) for (let x = Math.max(x0, 0); x < Math.min(x1, w); x++){
    if (hole[y*w + x]) continue;
    if (windowCount(hs, w, h, x - ring, y - ring, x + ring + 1, y + ring + 1) > 0) pts.push([x, y]);
  }
  const stride = Math.max((pts.length / 2000) | 0, 1);
  pts = pts.filter((_, i) => i % stride === 0);
  const evalAt = (dx, dy) => {
    const hx0 = x0 + dx, hy0 = y0 + dy, hx1 = x1 + dx, hy1 = y1 + dy;
    const inside = hx0 >= 0 && hy0 >= 0 && hx1 <= w && hy1 <= h;
    if ((dx === 0 && dy === 0) || !inside || windowCount(hs, w, h, hx0, hy0, hx1, hy1) !== 0) return null;
    let e = 0;
    for (const [x, y] of pts){
      const a = (y*w + x)*ch, b = ((y + dy)*w + x + dx)*ch;
      for (let c = 0; c < ch; c++){ const d = img[a+c] - img[b+c]; e += d*d; }
    }
    // 平手时稍微偏好近的
    return e / Math.max(pts.length, 1) * (1 + 1e-3 * Math.sqrt(dx*dx + dy*dy) / Math.max(maxRadius, 1));
  };
  const step = Math.max((maxRadius / 24) | 0, 1);
  let best = null;
  const consider = (dx, dy) => { const e = evalAt(dx, dy); if (e !== null && (!best || e < best[2])) best = [dx, dy, e]; };
  for (let dy = -maxRadius; dy <= maxRadius; dy += step) for (let dx = -maxRadius; dx <= maxRadius; dx += step) consider(dx, dy);
  if (step > 1 && best){
    const bx = best[0], by = best[1];
    for (let dy = by - step; dy <= by + step; dy++) for (let dx = bx - step; dx <= bx + step; dx++) consider(dx, dy);
  }
  return best ? [best[0], best[1]] : null;
}

/* synthesize：创建纹理——用周围的块拼进洞（Efros–Freeman 拼布式，重叠处对半羽化） */
function synthesize(w, h, ch, img, hole, block, seed){
  const out = Float64Array.from(img);
  const bb = holeBbox(w, h, hole); if (!bb) return out;
  const b = Math.max(block, 4), ov = Math.max((b/3) | 0, 1);
  const hs = integral(w, h, hole);
  const cands = [];
  for (let y = ov; y < h - b - ov; y++) for (let x = ov; x < w - b - ov; x++)
    if (windowCount(hs, w, h, x - ov, y - ov, x + b + ov, y + b + ov) === 0) cands.push([x, y]);
  if (!cands.length) return Float64Array.from(membraneFill(w, h, ch, img, hole));
  const filled = new Uint8Array(w*h);
  for (let i = 0; i < w*h; i++) filled[i] = hole[i] ? 0 : 1;
  const rng = new Rng(seed);
  for (let by = bb[1]; by < bb[3]; by += b){
    for (let bx = bb[0]; bx < bb[2]; bx += b){
      if (windowCount(hs, w, h, bx, by, bx + b, by + b) <= 0) continue;
      let best = [cands[0], Infinity];
      for (let t = 0; t < 48; t++){
        const c = cands[rng.below(cands.length)];
        let e = 0, n = 0;
        for (let y = by - ov; y < by + b + ov; y++) for (let x = bx - ov; x < bx + b + ov; x++){
          if (x < 0 || y < 0 || x >= w || y >= h || !filled[y*w + x]) continue;
          const a = (y*w + x)*ch, s = ((y - by + c[1])*w + (x - bx + c[0]))*ch;
          for (let k = 0; k < ch; k++){ const d = out[a+k] - img[s+k]; e += d*d; }
          n++;
        }
        e = n === 0 ? 0 : e / n;
        if (e < best[1]) best = [c, e];
      }
      const c = best[0];
      for (let y = by - ov; y < by + b + ov; y++) for (let x = bx - ov; x < bx + b + ov; x++){
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y*w + x;
        if (!hole[i]) continue;
        const a = i*ch, s = ((y - by + c[1])*w + (x - bx + c[0]))*ch;
        const k = filled[i] ? 0.5 : 1;
        for (let q = 0; q < ch; q++) out[a+q] += (img[s+q] - out[a+q]) * k;
        filled[i] = 1;
      }
    }
  }
  return out;
}

/* ───────── retouch_cmds.rs 的拼装 ───────── */
/* pad_coverage：覆盖图四周补 m 圈 0（解方程的 Dirichlet 边） */
function padCoverage(bounds, cov, m){
  const g = RC.inflate(bounds, m), w = RC.w(bounds), gw = RC.w(g);
  const out = new Float32Array(gw * RC.h(g));
  for (let i = 0; i < cov.length; i++){ const x = i % w + m, y = ((i / w) | 0) + m; out[y*gw + x] = cov[i]; }
  return { rect:g, cov:out };
}
/* clamp_samples：8 位深度 ⇒ 全部夹到 0..1 */
function clampSamples(data){ for (let i = 0; i < data.length; i++) data[i] = Math.min(Math.max(data[i], 0), 1); }
/* heal_region：在遮罩上把 src 无缝贴进 dst；只在遮罩外框＋1 圈上解，其余＝dst */
function healRegion(src, dst, mask){
  const w = RC.w(dst.rect);
  let bb = null;
  for (let i = 0; i < mask.length; i++){
    if (!mask[i]) continue;
    const x = dst.rect[0] + i % w, y = dst.rect[1] + ((i / w) | 0);
    if (!bb) bb = [x, y, x+1, y+1];
    else { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x+1); bb[3] = Math.max(bb[3], y+1); }
  }
  const out = { rect:dst.rect.slice(), ch:dst.ch, data:Float32Array.from(dst.data) };
  if (!bb) return out;
  const r = RC.intersect(RC.inflate(bb, 1), dst.rect);
  const s = cropRegion(src, r), d = cropRegion(dst, r);
  const rw = RC.w(r), rh = RC.h(r), m = new Uint8Array(rw*rh);
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) m[(y - r[1])*rw + (x - r[0])] = mask[regIndex(dst, x, y)] ? 1 : 0;
  const data = seamlessClone(rw, rh, d.ch, s.data, d.data, m);
  clampSamples(data);
  const n = dst.ch;
  for (let y = r[1]; y < r[3]; y++){
    const o = regIndex(out, r[0], y)*n, i = (y - r[1])*rw*n;
    out.data.set(data.subarray(i, i + rw*n), o);
  }
  return out;
}
/* dilate：方形结构元素膨胀 r 格（先横后纵） */
function dilate(w, h, m, r){
  const tmp = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    if (!m[y*w + x]) continue;
    for (let xx = Math.max(x - r, 0); xx < Math.min(x + r + 1, w); xx++) tmp[y*w + xx] = 1;
  }
  const out = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    if (!tmp[y*w + x]) continue;
    for (let yy = Math.max(y - r, 0); yy < Math.min(y + r + 1, h); yy++) out[yy*w + x] = 1;
  }
  return out;
}

const SPOT_TYPES = ['contentAware', 'createTexture', 'proximityMatch'];
/* spot_heal_surface：不要来源，先把笔画范围补满，再用梯度域融进四周 */
function spotHealSurface(L, area, pts, brush, kind, lock){
  const { rect:bounds, cov } = strokeCoverage(pts, brush);
  const size = brush.size;
  const margin = Math.ceil(Math.max(size, 8) * 1.0) + 8;
  const regionRect = RC.intersect(RC.inflate(bounds, margin), area);
  if (RC.empty(regionRect)) return [0,0,0,0];
  const img = readRegion(layerBuffer(L), regionRect);
  const w = RC.w(regionRect), h = RC.h(regionRect), ch = img.ch;
  const bw = RC.w(bounds);
  const strokeCov = new Float32Array(w*h);
  for (let i = 0; i < cov.length; i++){
    const x = bounds[0] + i % bw, y = bounds[1] + ((i / bw) | 0);
    if (RC.contains(regionRect, x, y)) strokeCov[regIndex(img, x, y)] = cov[i];
  }
  const hole = new Uint8Array(w*h); let any = false;
  for (let i = 0; i < w*h; i++) if (strokeCov[i] > 0){ hole[i] = 1; any = true; }
  if (!any) return [0,0,0,0];
  // 合成的范围比 Poisson 区再大一点：解的边界格带著合成值、跟没动的四周有落差，膜才有东西可修（不然 Dirichlet 全 0、融合等于没做）
  const domain = dilate(w, h, hole, 2);
  const healMask = dilate(w, h, hole, 1);
  const contentAware = data => complete(w, h, ch, data, domain, COMPLETE_DEFAULT) || membraneFill(w, h, ch, data, domain);
  let filled;
  if (kind === 'contentAware') filled = contentAware(img.data);
  else if (kind === 'createTexture') filled = synthesize(w, h, ch, img.data, domain, Math.trunc(Math.min(Math.max(size/4, 6), 32)), 0x5eedn);
  else {
    const ring = Math.trunc(Math.min(Math.max(size/8, 3), 16));
    const off = bestOffset(w, h, ch, img.data, domain, ring, margin);
    if (off){
      const [dx, dy] = off, out = Float64Array.from(img.data);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        if (!domain[y*w + x]) continue;
        const i = (y*w + x)*ch, j = ((y + dy)*w + x + dx)*ch;
        for (let c = 0; c < ch; c++) out[i+c] = out[j+c];      // copy_within：就地抄（前面抄过的会被后面读到，照搬）
      }
      filled = out;
    } else filled = contentAware(img.data);
  }
  const src = { rect:regionRect, ch, data:Float32Array.from(filled) };
  const healed = healRegion(src, img, healMask);
  const dmg = RC.intersect(bounds, regionRect);
  const dw = RC.w(dmg), dmgCov = new Float32Array(dw * RC.h(dmg));
  for (let y = dmg[1]; y < dmg[3]; y++) for (let x = dmg[0]; x < dmg[2]; x++) dmgCov[(y - dmg[1])*dw + (x - dmg[0])] = strokeCov[regIndex(img, x, y)];
  return applyCoverage(L, dmg, dmgCov, brush.opacity, healed, 'normal', lock);
}
function spotHealing(p){
  const C = 'spotheal.stroke';
  const b = parseBrush(p, C); if (b.error) return {ok:false, error:b.error};
  const kind = typeof p.type === 'string' ? p.type : 'contentAware';
  if (!SPOT_TYPES.includes(kind)) return {ok:false, error:`${C}: unknown type \`${kind}\` (contentAware|createTexture|proximityMatch)`};
  const lf = lockFail(b.L, C); if (lf) return lf;
  const r = spotHealSurface(b.L, [0, 0, Doc.width, Doc.height], b.pts, b.brush, kind, lockAlpha(b.L));
  return { ok:true, damage:[r[0], r[1], r[2]-r[0], r[3]-r[1]], type:kind };
}

/* ───────── 界面共用小件（照 clone.js：stroke_constraint.rs、stroke_trail.rs、brush_resize.rs） ───────── */
const pressure = e => (e && e.pointerType === 'pen' && typeof e.pressure === 'number') ? e.pressure : 1;
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
    const d = Math.hypot(px - s*dx, py - s*dy);
    const c = Math.round(Math.min(Math.max(r + 0.5 - d, 0), 1) * 255);
    const i = y*t.w + x;
    if (c > t.cov[i]) t.cov[i] = c;
  }
  const D = t.dirty || (t.dirty = [x0, y0, x1, y1]);
  t.dirty = [Math.min(D[0], x0), Math.min(D[1], y0), Math.max(D[2], x1), Math.max(D[3], y1)];
}
function trailFeed(t, points, diameter){
  if (!t || t.fed >= points.length) return;
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
const HARDNESS_TRAVEL = 200;
function resized(start, dx, dy, zoom){
  dx = isFinite(dx) ? dx : 0; dy = isFinite(dy) ? dy : 0;
  zoom = (isFinite(zoom) && zoom > 0) ? zoom : 1;
  const size = Math.min(Math.max(Math.round(start[0] + 2*dx), 1), 5000);
  const hardness = Math.min(Math.max(start[1] + dy*zoom/HARDNESS_TRAVEL, 0), 1);
  return [size, Math.round(hardness*100)/100];
}
/* 叠画：足迹、Shift 橡皮筋、Ctrl+Alt 改笔刷预览、笔尖圆圈（centre(r)＝要不要画中心十字）。readout＝[直径字, 硬度字] 的 i18n key */
function drawCommon(ctx, s, U, opt){
  const z = UI.zoom, dpr = s / z, scr = q => [q[0]*s, q[1]*s];
  ctx.save();
  if (U.trail && opt.trail !== false){
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(U.trail.c, 0, 0, U.trail.w*U.trail.k*s, U.trail.h*U.trail.k*s);
  }
  const line = (a, b, w, col) => { ctx.lineWidth = w*dpr; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const cross = (c, len, layers) => layers.forEach(([w, col]) => {
    line([c[0]-len*dpr, c[1]], [c[0]+len*dpr, c[1]], w, col);
    line([c[0], c[1]-len*dpr], [c[0], c[1]+len*dpr], w, col);
  });
  if (opt.marker){ const m = opt.marker(); if (m) cross(scr(m), 7, [[3, 'rgba(0,0,0,0.63)'], [1, '#fff']]); }
  if (U.shift && U.lastEnd && !U.drag && U.hover && !U.resize){
    const a = scr(U.lastEnd), b = scr(U.hover);
    line(a, b, 2.5, 'rgba(0,0,0,0.47)'); line(a, b, 1, 'rgba(255,255,255,0.9)');
  }
  if (U.resize){
    const c = scr(U.resize.anchor), R = Math.max(ToolState.size/2*z, 1)*dpr, inner = R*Math.min(Math.max(ToolState.hardness, 0), 1);
    const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
    g.addColorStop(0, 'rgba(255,0,0,0.43)'); g.addColorStop(inner/R, 'rgba(255,0,0,0.43)'); g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], R + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
    if (U.hover){
      const h = scr(U.hover), t1 = `${Lang.t(opt.readout[0])} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t(opt.readout[1])} ${Math.round(ToolState.hardness*100)}%`;
      ctx.font = `${12*dpr}px sans-serif`;
      const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12*dpr;
      ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0]+14*dpr, h[1]+14*dpr, w, 38*dpr);
      ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0]+20*dpr, h[1]+29*dpr); ctx.fillText(t2, h[0]+20*dpr, h[1]+45*dpr);
    }
  } else if (U.hover && opt.aim && !U.drag){
    // 按住 Alt（还没在拖）：取样用的瞄准圈（同 clone.js，照 PS）
    const c = scr(U.hover), R = 7*dpr, Lx = 11*dpr;
    [[3, 'rgba(0,0,0,0.6)'], [1, 'rgba(255,255,255,0.95)']].forEach(([w, col]) => {
      ctx.lineWidth = w*dpr; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c[0]-Lx, c[1]); ctx.lineTo(c[0]+Lx, c[1]); ctx.moveTo(c[0], c[1]-Lx); ctx.lineTo(c[0], c[1]+Lx); ctx.stroke();
    });
  } else if (U.hover){
    // NormalTip：完整半径 ×(0.5＋0.5×硬度)；canvas.rs:1640 黑 140／白 220 两圈
    const c = scr(U.hover), full = Math.max(ToolState.size/2*z, 1);
    const rs = Math.max(full*(0.5 + 0.5*Math.min(Math.max(ToolState.hardness, 0), 1)), 1), r = rs*dpr;
    ctx.lineWidth = dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], r + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI*2); ctx.stroke();
    if (opt.centre(rs)) cross(c, 3, [[2.5, 'rgba(0,0,0,0.55)'], [1, 'rgba(255,255,255,0.86)']]);
  }
  ctx.restore();
}

window.HealCore = {
  RC, asNum, asBool, roundAway, dabCoverage, walkDabs, strokeCoverage, parseBrush, lockFail, lockAlpha,
  layerBuffer, compositeBuffer, sourceBuffer, readRegion, cropRegion, cloneSample, applyCoverage,
  solveMembrane, seamlessClone, membraneFill, Rng, complete, bestOffset, synthesize, padCoverage, healRegion, dilate,
  pressure, constrain, trailNew, trailFeed, resized, drawCommon
};

/* ───────── 命令 ───────── */
CMD.reg('spotheal.stroke', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?],…] 文件坐标（必填）, type="contentAware"|"createTexture"|"proximityMatch"=contentAware（内容识别／创建纹理／近似匹配）, '
       + 'size=工具大小 px, hardness=0..100（工具硬度）, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, layerId?=当前层} '
       + '不用取样点：笔画范围先自动补满再用梯度域融进四周 → {damage:[x,y,w,h], type}'},
  p => spotHealing(p));
CMD.reg('spotheal.setOptions', {i18n:'', params:'{type?:"contentAware"|"createTexture"|"proximityMatch", sampleAllLayers?:bool（只存：他们的 paint.spotHealing 不收这个）, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏）'}, p => {
  if (SPOT_TYPES.includes(p.type)) U.type = p.type;
  else if (p.type !== undefined) return {ok:false, error:`spotheal.setOptions: unknown type \`${p.type}\` (contentAware|createTexture|proximityMatch)`};
  if (typeof p.sampleAllLayers === 'boolean') U.sampleAll = p.sampleAllLayers;
  if (typeof p.size === 'number') ToolState.size = Math.min(Math.max(Math.round(p.size), 1), 5000);
  if (typeof p.hardness === 'number') ToolState.hardness = Math.min(Math.max(p.hardness, 0), 100) / 100;
  if (window.UI && ToolState.cur === 'spotheal' && !U.resize) UI.buildOptions('spotheal');
  return { type:U.type, sampleAllLayers:U.sampleAll, size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
});

/* ───────── 界面（retouch_ui.rs／canvas.rs） ───────── */
const U = {
  type:'contentAware', sampleAll:false,          // tool_options.spot_type／sample_all_layers
  drag:null, lastEnd:null, trail:null, resize:null, blocked:false,
  hover:null, alt:false, shift:false, status:null
};
function setStatus(st){
  U.status = st;
  const el = document.getElementById('spotStatus'); if (!el) return;
  el.textContent = st ? (st.key ? Lang.t(st.key) : String(st.text || '')) : '';
}
function finishStroke(points){
  const r = CMD.run('spotheal.stroke', { type:U.type, points: points.map(q => [q[0], q[1], q[2]]) });
  setStatus(r && r.ok === false ? {text:r.error} : null);
}
function resizeUpdate(x, y){
  const r = U.resize;
  const [size, hardness] = resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
  if (ToolState.size === size && ToolState.hardness === hardness) return;
  CMD.map['spotheal.setOptions'].run({size, hardness:hardness*100});
}

const tool = Tools.reg({
  id:'spotheal', icon:'✚', group:'raster', order:41, for:'raster', needs:'raster', opts:['size','hardness'],
  cursor:'none',
  ui:U, strokeCoverage, spotHealing,
  trailCoverage: (x, y) => U.trail ? U.trail.cov[y*U.trail.w + x] : 0,

  strings:{
    'zh-Hant':{ 'opt.spotType':'類型：', 'opt.spot.contentAware':'內容感知', 'opt.spot.createTexture':'建立紋理', 'opt.spot.proximityMatch':'近似符合',
      'opt.spotSampleAll':'取樣全部圖層', 'ui.spotDiameter':'直徑：', 'ui.spotHardness':'硬度：' },
    'zh-Hans':{ 'opt.spotType':'类型：', 'opt.spot.contentAware':'内容识别', 'opt.spot.createTexture':'创建纹理', 'opt.spot.proximityMatch':'近似匹配',
      'opt.spotSampleAll':'对所有图层取样', 'ui.spotDiameter':'直径：', 'ui.spotHardness':'硬度：' },
    'en':{ 'opt.spotType':'Type:', 'opt.spot.contentAware':'Content-Aware', 'opt.spot.createTexture':'Create Texture', 'opt.spot.proximityMatch':'Proximity Match',
      'opt.spotSampleAll':'Sample All Layers', 'ui.spotDiameter':'Diameter:', 'ui.spotHardness':'Hardness:' }
  },

  /* retouch_ui.rs:145-155：「类型：」三个勾选框当单选用，竖线，「对所有图层取样」 */
  buildOptions(box){
    const lab = document.createElement('span'); lab.textContent = Lang.t('opt.spotType'); lab.style.color = '#7a8290';
    box.appendChild(lab);
    SPOT_TYPES.forEach(k => {
      const l = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = U.type === k; cb.dataset.opt = 'spot-' + k;
      cb.onchange = () => CMD.run('spotheal.setOptions', {type:k});           // 点哪个就换哪个（再点已选的也不会变成没选）
      l.appendChild(cb); const t = document.createElement('span'); t.textContent = Lang.t('opt.spot.' + k); l.appendChild(t);
      box.appendChild(l);
    });
    const sep = document.createElement('span'); sep.style.cssText = 'display:inline-block;width:1px;height:18px;background:#3a3f47;margin:0 6px;vertical-align:middle';
    box.appendChild(sep);
    const l = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = U.sampleAll; cb.dataset.opt = 'sampleAll';
    cb.onchange = () => CMD.run('spotheal.setOptions', {sampleAllLayers:cb.checked});
    l.appendChild(cb); const t = document.createElement('span'); t.textContent = Lang.t('opt.spotSampleAll'); l.appendChild(t);
    box.appendChild(l);
    const st = document.createElement('span'); st.id = 'spotStatus'; st.style.color = '#e8573f'; box.appendChild(st);
    setStatus(U.status);
  },

  onDown(e, pt, P){
    U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt; U.blocked = false;
    if (e.ctrlKey && e.altKey && !U.drag){
      U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] };
      UI.draw(); return;
    }
    const L0 = Doc.active();
    if (L0 && L0.kind === 'raster' && window.Locks && Locks.deny(L0, 'pixels')){ U.blocked = true; return; }
    P.ensureRaster();
    const from = (e.shiftKey && U.lastEnd) ? U.lastEnd.slice() : null;
    const pr = pressure(e);
    const points = [[pt[0], pt[1], pr]];
    if (from) points.unshift([from[0], from[1], pr]);
    U.drag = { start: from || pt.slice(), points, axis:null };
    U.trail = trailNew();
    trailFeed(U.trail, U.drag.points, ToolState.size);
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
    }
    UI.draw();
  },
  onUp(e, pt){
    U.alt = e.altKey; U.shift = e.shiftKey;
    if (U.resize){ resizeUpdate(pt[0], pt[1]); U.resize = null; CMD.run('spotheal.setOptions', {}); return; }
    if (U.blocked){ U.blocked = false; UI.draw(); return; }
    const d = U.drag; U.drag = null; U.trail = null;
    if (!d){ UI.draw(); return; }
    const last = d.points.length ? d.points[d.points.length-1] : d.start;
    const q = constrain(d, last, pt, e.shiftKey);
    if (!d.points.length || last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], d.points.length ? last[2] : 1]);
    U.lastEnd = d.points[d.points.length-1].slice(0, 2);
    finishStroke(d.points);
    UI.refresh();
  },
  onDeactivate(){ U.drag = null; U.trail = null; U.resize = null; U.hover = null; U.blocked = false; },

  /* canvas.rs brush_tip_centre：污点修复跟一般笔刷一样，屏幕半径 > 6 才画中心十字 */
  drawOverlay(ctx, s){
    drawCommon(ctx, s, U, { centre: r => r > 6, readout:['ui.spotDiameter', 'ui.spotHardness'] });
  }
});

function modKey(e){
  if (ToolState.cur !== 'spotheal' || !window.UI || !UI.canvas) return;
  if (e.key === 'Alt' || e.key === 'Shift'){
    if (e.altKey !== U.alt || e.shiftKey !== U.shift){ U.alt = e.altKey; U.shift = e.shiftKey; UI.draw(); }
  }
}
document.addEventListener('keydown', modKey);
document.addEventListener('keyup', modKey);
window.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('view');
  if (v) v.addEventListener('pointerleave', () => { if (ToolState.cur === 'spotheal' && !U.drag){ U.hover = null; UI.draw(); } });
});

window.SpotHeal = tool;
/* 描边路径（PS 路径面板 ▸ 描边路径 ▸ 污点修复画笔）：同滑鼠收笔那包参数（选项栏类型） */
tool.pathParams = (L, points) => ({ type:U.type, points: points.map(q => [q[0], q[1], q.length > 2 ? q[2] : 1]), layerId:L.id });
})();
