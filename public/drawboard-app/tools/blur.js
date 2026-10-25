/* 模糊工具：拖曳＝沿笔画把笔尖底下的像素做局部高斯模糊（逐 dab 改工作副本，后面的 dab 看得到前面的结果），放开一步历史。
   🔴 这支档是把 ArtCraft／PhotoCraft 的 Rust 原始码逐段翻译成 JS（算法照搬，不是凭 PS 印象另写）：
   - engine/src/retouch_cmds.rs 30–125    parse_brush（points/size/hardness/opacity/flow/spacing/layer）、run_stroke、damage_json
   - engine/src/retouch_cmds.rs 456–461   per_dab：每个 dab 的强度，让一趟笔画在中线上累积约等于 strength（与间距无关）
   - engine/src/retouch_cmds.rs 531–614   sample_all_layers、AllLayers（取样所有图层：效果跑在可见合成的副本上再铺回本层）、focus_cmd（模糊／锐化）
   - engine/src/retouch_cmds.rs 616–636   smudge_cmd（涂抹，见 smudge.js）
   - engine/src/retouch_cmds.rs 716–745   paint.blur／paint.sharpen／paint.smudge 的参数说明
   - paint/src/retouch.rs 80–117、219–292、294–415   Footprint、apply_dab_stroke（工作副本＋halo、逐 dab、预乘混回）、mix_premultiplied、Smudge
   - paint/src/render.rs 143–245          BrushContext::dab_rect／rasterize／footprint（圆笔尖 × flow）
   - paint/src/lib.rs 131–156             dabs()、dab_coverage（smoothstep 硬度）；间距走 dynamics.rs（同 clone.js 的 PathWalker）
   - algo/src/retouch.rs 112–221          local_blur（可分离高斯、边缘夹取、按 alpha 预乘）、local_sharpen（反锐化遮罩＋保护细节夹到 3×3 范围）
   - ui-egui/src/retouch_ui.rs 13–76、183–192   收笔叫命令（strength／sampleAllLayers／protectDetail／fingerPainting）、选项栏
   - ui-egui/src/state.rs 345–347、419、440–442  选项预设：强度 50%、取样所有图层 关、保护细节 开、手指绘画 关（三颗工具共用一份 tool_options）
   - ui-egui/src/canvas.rs 211–221、1601–1646    笔尖圆圈游标（NormalTip 半径 ×(0.5＋0.5×硬度)，半径 >6 屏幕点才画中心十字）
   - ui-egui/src/stroke_constraint.rs、brush_resize.rs、stroke_trail.rs    Shift 直线、Ctrl+Alt 拖改大小硬度、拖曳足迹（照 clone.js 那套）
   三颗工具（blur／sharpen／smudge）共用的算法与手感都在这支档，挂在 window.RetouchDab；sharpen.js、smudge.js 只登记自己的工具与命令。
   命令：blur.stroke / blur.setOptions（sharpen.*、smudge.* 同形） */
(function(){

/* ───────── 小工具 ───────── */
const roundAway = v => v < 0 ? -Math.round(-v) : Math.round(v);
const asNum  = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const asBool = (v, d) => typeof v === 'boolean' ? v : d;
const clamp  = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* ───────── 三颗共用的选项（ui-egui state.rs ToolOptions：strength／sample_all_layers 三颗同一份） ───────── */
const O = { strength:50, sampleAllLayers:false, protectDetail:true, fingerPainting:false };

/* ───────── paint/src/lib.rs、dynamics.rs：dab 的位置（照 clone.js 97–142 抄） ───────── */
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
/* lib.rs dabs()：Dab{center, radius = max(直径/2, 0.5), alpha = flow} */
function dabs(points, brush){
  return walkDabs(points, brush).map(q => ({ c:[q[0], q[1]], radius:Math.max(baseDiameter(brush, q)/2, 0.5), alpha:brush.flow }));
}
/* render.rs BrushContext::dab_rect（圆笔尖，不是取样笔尖 ⇒ reach＝radius） [x0,y0,x1,y1) */
function dabRect(d){
  const rr = Math.ceil(d.radius) + 1, cx = Math.floor(d.c[0]), cy = Math.floor(d.c[1]);
  return [cx-rr, cy-rr, cx+rr+1, cy+rr+1];
}
/* render.rs BrushContext::footprint ＋ rasterize（圆笔尖：roundness 1 ⇒ rm＝max(r,0.5)；值＝coverage × dab.alpha） */
function footprint(d, index, hardness){
  const rect = dabRect(d), w = rect[2]-rect[0], h = rect[3]-rect[1], cov = new Float32Array(w*h);
  const rm = Math.max(d.radius, 0.5), reach2 = (rm + 0.5)*(rm + 0.5);
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++){
    const dx = x + 0.5 - d.c[0], dy = y + 0.5 - d.c[1], d2 = dx*dx + dy*dy;
    if (d2 >= reach2) continue;
    cov[(y-rect[1])*w + (x-rect[0])] = dabCoverage(Math.sqrt(d2), rm, hardness) * d.alpha;
  }
  return { dab:d, index, rect, w, cov, at(x, y){ return this.cov[(y-this.rect[1])*this.w + (x-this.rect[0])]; } };
}
const isect = (a, b) => [Math.max(a[0],b[0]), Math.max(a[1],b[1]), Math.min(a[2],b[2]), Math.min(a[3],b[3])];
const emptyR = r => r[2] <= r[0] || r[3] <= r[1];

/* ───────── retouch.rs Region：一块文件坐标的 RGBA（直通、0..1 浮点），图层画布外＝透明 ───────── */
function Region(rect){
  this.rect = rect; this.w = rect[2]-rect[0]; this.h = rect[3]-rect[1]; this.ch = 4;
  this.data = new Float32Array(Math.max(this.w*this.h*4, 0));
}
Region.prototype.index = function(x, y){ return (y - this.rect[1])*this.w + (x - this.rect[0]); };
Region.prototype.contains = function(x, y){ return x >= this.rect[0] && y >= this.rect[1] && x < this.rect[2] && y < this.rect[3]; };
Region.prototype.clone = function(){ const r = new Region(this.rect); r.data.set(this.data); return r; };
Region.prototype.crop = function(rc){
  const r = isect(rc, this.rect), out = new Region(r);
  for (let y = r[1]; y < r[3]; y++){
    const s = this.index(r[0], y)*4, d = (y - r[1])*out.w*4;
    out.data.set(this.data.subarray(s, s + out.w*4), d);
  }
  return out;
};
/* 从图层读：文件坐标 rect → 画布 (X−L.x, Y−L.y)（铁律④） */
function readLayer(L, rect){
  const R = new Region(rect), cv = L.data.canvas;
  const ix = isect(rect, [L.x, L.y, L.x + cv.width, L.y + cv.height]);
  if (emptyR(ix)) return R;
  const iw = ix[2]-ix[0], ih = ix[3]-ix[1], d = L.data.ctx.getImageData(ix[0]-L.x, ix[1]-L.y, iw, ih).data;
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++){
    const s = (y*iw + x)*4, o = R.index(ix[0]+x, ix[1]+y)*4;
    R.data[o] = d[s]/255; R.data[o+1] = d[s+1]/255; R.data[o+2] = d[s+2]/255; R.data[o+3] = d[s+3]/255;
  }
  return R;
}
/* 写回图层（只写得进画布的那块；Uint8ClampedArray 自己夹 0..255、四舍五入） */
function writeLayer(L, R){
  const cv = L.data.canvas, ix = isect(R.rect, [L.x, L.y, L.x + cv.width, L.y + cv.height]);
  if (emptyR(ix)) return;
  const iw = ix[2]-ix[0], ih = ix[3]-ix[1], img = L.data.ctx.createImageData(iw, ih), d = img.data;
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++){
    const s = R.index(ix[0]+x, ix[1]+y)*4, o = (y*iw + x)*4;
    d[o] = R.data[s]*255; d[o+1] = R.data[s+1]*255; d[o+2] = R.data[s+2]*255; d[o+3] = R.data[s+3]*255;
  }
  L.data.ctx.putImageData(img, ix[0]-L.x, ix[1]-L.y);
}
/* retouch_cmds.rs composite_region(pre, None, All, rect)：落笔前整份文件的可见合成，取 rect 那块 */
function compositeRegion(rect, comp){
  const R = new Region(rect);
  const ix = isect(rect, [0, 0, comp.width, comp.height]);
  if (emptyR(ix)) return R;
  const iw = ix[2]-ix[0], ih = ix[3]-ix[1], d = comp.getContext('2d').getImageData(ix[0], ix[1], iw, ih).data;
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++){
    const s = (y*iw + x)*4, o = R.index(ix[0]+x, ix[1]+y)*4;
    R.data[o] = d[s]/255; R.data[o+1] = d[s+1]/255; R.data[o+2] = d[s+2]/255; R.data[o+3] = d[s+3]/255;
  }
  return R;
}

/* ───────── retouch.rs mix_premultiplied：dst ← lerp(dst, src, k)（预乘空间；结果全透明时直通混，颜色仍有定义） ───────── */
function mixPremultiplied(dst, di, src, si, a, k){
  const da = dst[di+a], sa = src[si+a];
  const oa = da + (sa - da)*k;
  for (let c = 0; c < 4; c++){
    if (c === a) continue;
    const d = dst[di+c], s = src[si+c];
    dst[di+c] = oa > 1e-6 ? (d*da + (s*sa - d*da)*k) / oa : d + (s - d)*k;
  }
  dst[di+a] = oa;
}
/* retouch_cmds.rs per_dab */
const perDab = (e, spacing) => 1 - Math.pow(1 - clamp(e, 0, 1), clamp(spacing, 0.01, 1));

/* 选区覆盖度（文件坐标）：路径／套索／羽化照真形状（同 clone.js applyCoverage） */
function selAt(x, y){
  const s = Doc.sel;
  if (!s) return 1;
  if (window.SelMask) return SelMask.coverage(x, y, s);
  const sx0 = Math.min(s.x, s.x+s.w), sy0 = Math.min(s.y, s.y+s.h), sx1 = Math.max(s.x, s.x+s.w), sy1 = Math.max(s.y, s.y+s.h);
  return (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) ? 1 : 0;
}

/* ───────── retouch.rs apply_dab_stroke ─────────
   工作副本＝笔画外框再外扩 halo（模糊／锐化要读邻居）；每个 dab 依序 effect(work, fp)；
   最后只把笔画外框按 不透明度×选区 混回：有 alpha 又没锁透明 ⇒ 预乘混；锁透明 ⇒ alpha 不动只混颜色 */
function applyDabStroke(L, points, brush, lock, halo, effect){
  const ds = dabs(points, brush);
  if (!ds.length) return null;
  let b = null;
  for (const d of ds){ const r = dabRect(d); b = b ? [Math.min(b[0],r[0]), Math.min(b[1],r[1]), Math.max(b[2],r[2]), Math.max(b[3],r[3])] : r; }
  const outer = [b[0]-halo, b[1]-halo, b[2]+halo, b[3]+halo];
  const orig = readLayer(L, outer), work = orig.clone();
  ds.forEach((d, i) => effect(work, footprint(d, i, brush.hardness)));
  const out = orig.crop(b), a = 3;
  const opacity = clamp(brush.opacity, 0, 1);
  for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++){
    const k = opacity * selAt(x, y);
    if (k <= 0) continue;
    const wi = work.index(x, y)*4, oi = out.index(x, y)*4, o = out.data, wv = work.data;
    if (!lock) mixPremultiplied(o, oi, wv, wi, a, k);
    else for (let c = 0; c < 4; c++){ if (c === a) continue; o[oi+c] += (wv[wi+c] - o[oi+c])*k; }
  }
  writeLayer(L, out);
  return b;
}

/* ───────── algo/src/retouch.rs local_blur ─────────
   data＝w×h×ch 交错；win＝[x0,y0,x1,y1)（缓冲坐标）；邻居边缘夹取；有 alpha 就预乘模糊颜色。回传窗口的模糊结果 */
function localBlur(data, w, h, ch, alpha, win, sigma){
  const [x0, y0, x1, y1] = win, ow = x1-x0, oh = y1-y0;
  const r = Math.max(Math.ceil(sigma*3), 1);
  let k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i*i) / Math.max(2*sigma*sigma, 1e-6)));
  const ks = k.reduce((s, v) => s + v, 0); k = k.map(v => v / ks);
  const px = new Float32Array(ch);
  const get = (x, y) => {
    const xx = clamp(x, 0, w-1), yy = clamp(y, 0, h-1), i = (yy*w + xx)*ch;
    for (let c = 0; c < ch; c++) px[c] = data[i+c];
    if (alpha !== null){ const av = px[alpha]; for (let c = 0; c < ch; c++) if (c !== alpha) px[c] *= av; }
  };
  // 横向：窗口的列 × 上下各多 r 行
  const th = oh + 2*r, tmp = new Float32Array(ow*th*ch);
  for (let ty = 0; ty < th; ty++){
    const y = y0 + ty - r;
    for (let ox = 0; ox < ow; ox++){
      const o = (ty*ow + ox)*ch;
      for (let i = 0; i < k.length; i++){
        get(x0 + ox + i - r, y);
        const kv = k[i];
        for (let c = 0; c < ch; c++) tmp[o+c] += px[c]*kv;
      }
    }
  }
  const out = new Float32Array(ow*oh*ch);
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++){
    const o = (oy*ow + ox)*ch;
    for (let i = 0; i < k.length; i++){
      const s = ((oy + i)*ow + ox)*ch, kv = k[i];
      for (let c = 0; c < ch; c++) out[o+c] += tmp[s+c]*kv;
    }
    if (alpha !== null){
      const av = out[o+alpha];
      for (let c = 0; c < ch; c++) if (c !== alpha)
        out[o+c] = av > 1e-6 ? out[o+c] / av : data[((y0+oy)*w + x0 + ox)*ch + c];
    }
  }
  return out;
}
/* algo/src/retouch.rs local_sharpen：v + amount·(v − blur(v))（σ=1）；保护细节＝夹到 3×3 邻域的最小最大；alpha 不变 */
const N8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function localSharpen(data, w, h, ch, alpha, win, amount, protect){
  const [x0, y0, x1, y1] = win, ow = x1-x0;
  const blur = localBlur(data, w, h, ch, alpha, win, 1.0);
  const out = new Float32Array(blur.length);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const o = ((y-y0)*ow + (x-x0))*ch, i = (y*w + x)*ch;
    for (let c = 0; c < ch; c++){
      const v = data[i+c];
      if (c === alpha){ out[o+c] = v; continue; }
      let s = v + amount*(v - blur[o+c]);
      if (protect){
        let lo = v, hi = v;
        for (const [dx, dy] of N8){
          const nx = clamp(x+dx, 0, w-1), ny = clamp(y+dy, 0, h-1), nv = data[(ny*w + nx)*ch + c];
          if (nv < lo) lo = nv; if (nv > hi) hi = nv;
        }
        s = clamp(s, lo, hi);
      }
      out[o+c] = s;
    }
  }
  return out;
}

/* ───────── retouch.rs Smudge ───────── */
function premultiply(v, alpha){ if (alpha === null) return; const pa = v[alpha]; for (let c = 0; c < v.length; c++) if (c !== alpha) v[c] *= pa; }
function Smudge(strength, finger, maxSize){
  this.strength = clamp(strength, 0, 1); this.finger = finger;
  this.radius = Math.ceil(maxSize/2) + 2; this.alpha = null; this.carry = null;
}
Smudge.prototype.withAlpha = function(a){ this.alpha = a; return this; };
Smudge.prototype.dab = function(work, fp){
  const r = this.radius, n = work.ch, side = 2*r + 1;
  const cx = Math.floor(fp.dab.c[0]), cy = Math.floor(fp.dab.c[1]);
  const wr = work.rect, alpha = (this.alpha !== null && this.alpha < n) ? this.alpha : null;
  const clampPx = (x, y) => {
    const i = work.index(clamp(x, wr[0], wr[2]-1), clamp(y, wr[1], wr[3]-1))*n;
    const v = Array.from(work.data.subarray(i, i+n)); premultiply(v, alpha); return v;
  };
  if (!this.carry){
    // 第一个 dab：拿笔尖底下的像素（手指绘画＝前景色）当「手上沾的颜色」
    const c = new Float32Array(side*side*n);
    for (let qy = 0; qy < side; qy++) for (let qx = 0; qx < side; qx++){
      let v;
      if (this.finger){ v = this.finger.slice(0, n); while (v.length < n) v.push(1); premultiply(v, alpha); }
      else v = clampPx(cx + qx - r, cy + qy - r);
      c.set(v.slice(0, n), (qy*side + qx)*n);
    }
    this.carry = c;
  }
  const carry = this.carry, src = new Float32Array(n);
  // 铺下手上的颜色
  for (let y = Math.max(fp.rect[1], wr[1]); y < Math.min(fp.rect[3], wr[3]); y++)
    for (let x = Math.max(fp.rect[0], wr[0]); x < Math.min(fp.rect[2], wr[2]); x++){
      const k = fp.at(x, y) * this.strength;
      const qx = x - cx + r, qy = y - cy + r;
      if (k <= 0 || qx < 0 || qy < 0 || qx >= side || qy >= side) continue;
      const q = (qy*side + qx)*n, pi = work.index(x, y)*n;
      if (alpha !== null){
        const ca = carry[q+alpha];
        for (let c = 0; c < n; c++) src[c] = carry[q+c];
        if (ca > 1e-6) for (let c = 0; c < n; c++) if (c !== alpha) src[c] /= ca;
        mixPremultiplied(work.data, pi, src, 0, alpha, k);
      } else {
        for (let c = 0; c < n; c++) work.data[pi+c] += (carry[q+c] - work.data[pi+c])*k;
      }
    }
  // 重新沾色：手上的颜色留 strength 成
  const keep = this.strength;
  for (let qy = 0; qy < side; qy++) for (let qx = 0; qx < side; qx++){
    const x = cx + qx - r, y = cy + qy - r;
    if (!work.contains(x, y)) continue;
    const q = (qy*side + qx)*n, pi = work.index(x, y)*n;
    const pa = alpha !== null ? work.data[pi+alpha] : 1;
    for (let c = 0; c < n; c++){
      const v = (alpha !== null && alpha !== c) ? work.data[pi+c]*pa : work.data[pi+c];
      carry[q+c] = carry[q+c]*keep + v*(1 - keep);
    }
  }
};

/* ───────── retouch_cmds.rs AllLayers：取样所有图层 ─────────
   每个 dab 的效果跑在「可见合成」的副本上（跨 dab 保留，后面的 dab 看得到前面的），再把 dab 底下那块铺回本层 */
function AllLayers(comp){ this.comp = comp; this.visible = null; }
AllLayers.prototype.dab = function(work, fp, effect){
  if (!this.visible) this.visible = compositeRegion(work.rect, this.comp);
  const v = this.visible;
  if (v.rect.join() !== work.rect.join() || v.ch !== work.ch) return effect(work, fp);
  effect(v, fp);
  const r = isect(fp.rect, work.rect);
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
    if (fp.at(x, y) > 0){ const i = work.index(x, y)*4; work.data.set(v.data.subarray(i, i+4), i); }
  }
};

/* 前景色 → 直通 RGBA 0..1（手指绘画用；s.tools.foreground） */
function parseColor(s, d){
  if (Array.isArray(s) && s.length >= 3) return [s[0]/255, s[1]/255, s[2]/255, s.length > 3 ? s[3] : 1].map(v => clamp(+v || 0, 0, 1));
  if (typeof s !== 'string') return d;
  let m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (m){ const n = parseInt(m[1], 16); return [(n>>16 & 255)/255, (n>>8 & 255)/255, (n & 255)/255, 1]; }
  m = /^#?([0-9a-f]{3})$/i.exec(s.trim());
  if (m){ const h = m[1]; return [0,1,2].map(i => parseInt(h[i]+h[i], 16)/255).concat([1]); }
  return d;
}

/* ───────── 命令本体：retouch_cmds.rs parse_brush ＋ focus_cmd／smudge_cmd ───────── */
function retouchStroke(kind, p){
  const C = `${kind}.stroke`;
  if (!Array.isArray(p.points)) return {ok:false, error:`${C}: missing \`points\``};
  const pts = p.points.filter(a => Array.isArray(a) && typeof a[0] === 'number' && typeof a[1] === 'number')
                      .map(a => [a[0], a[1], typeof a[2] === 'number' ? a[2] : 1]);
  if (!pts.length) return {ok:false, error:`${C}: \`points\` is empty`};
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return {ok:false, error:'no active layer'};
  if (L.kind !== 'raster') return {ok:false, error:`active layer is a ${L.kind} layer, not a pixel layer`};
  // 锁像素／全锁：photocraft target_surface 拒改（共用层的 Locks 规则表还没收这三条命令 ⇒ 这里自己挡）
  if (window.Locks){ const k = Locks.blocks(L, 'pixels'); if (k){ Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, C); } }
  const lock = !!(window.Locks && Locks.alpha(L));      // 锁透明像素：alpha 不动
  const pct = (k, d, lo, hi) => clamp(asNum(p[k], d), lo, hi) / 100;
  const brush = {
    size: Math.max(asNum(p.size, ToolState.size), 1),
    hardness: pct('hardness', ToolState.hardness*100, 0, 100),
    opacity: pct('opacity', 100, 1, 100),
    flow: pct('flow', 100, 1, 100),
    spacing: pct('spacing', 25, 1, 1000)
  };
  const strength = clamp(asNum(p.strength, 50), 1, 100) / 100;
  const all = asBool(p.sampleAllLayers, false);
  // 取样所有图层：落笔前的可见合成（Live 期间本层已还原成落笔前，所以这里合成的就是 pre）
  const comp = all ? composite(1) : null;
  const sampler = all ? new AllLayers(comp) : null;
  let dmg;
  if (kind === 'smudge'){
    const finger = asBool(p.fingerPainting, false);
    const fg = finger ? parseColor(p.color !== undefined ? p.color : (window.UI && UI.fill ? UI.fill() : '#000000'), [0,0,0,1]) : null;
    // 预乘混色：透明像素不带颜色，就不会拖出黑边
    const sm = new Smudge(strength, fg, brush.size).withAlpha(3);
    dmg = applyDabStroke(L, pts, brush, lock, 0, (work, fp) => sampler ? sampler.dab(work, fp, (w, f) => sm.dab(w, f)) : sm.dab(work, fp));
  } else {
    const sharpen = kind === 'sharpen';
    const protect = asBool(p.protectDetail, true);
    const sigma = clamp(brush.size * 0.03, 1, 4);
    const halo = Math.ceil(sigma*3) + 1;
    const sp = brush.spacing;
    const focus = (work, fp) => {
      const r = isect(fp.rect, work.rect);
      if (emptyR(r)) return;
      const w = work.w, h = work.h, n = work.ch;
      const win = [r[0]-work.rect[0], r[1]-work.rect[1], r[2]-work.rect[0], r[3]-work.rect[1]];
      const out = sharpen ? localSharpen(work.data, w, h, n, 3, win, 1.0, protect) : localBlur(work.data, w, h, n, 3, win, sigma);
      const rw = r[2]-r[0];
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++){
        const k = perDab(fp.at(x, y) * strength, sp);
        if (k <= 0) continue;
        const o = ((y-r[1])*rw + (x-r[0]))*n, pi = work.index(x, y)*n;
        for (let c = 0; c < n; c++) work.data[pi+c] += (out[o+c] - work.data[pi+c])*k;
      }
    };
    dmg = applyDabStroke(L, pts, brush, lock, halo, (work, fp) => sampler ? sampler.dab(work, fp, focus) : focus(work, fp));
  }
  if (!dmg) dmg = [0, 0, 0, 0];
  return { ok:true, damage:[dmg[0], dmg[1], dmg[2]-dmg[0], dmg[3]-dmg[1]] };
}

/* ───────── 命令登记（每颗工具各自的 <id>.stroke／<id>.setOptions） ───────── */
const BRUSH_PARAMS = 'points:[[x,y,pressure?],…] 文件坐标（必填）, size=工具大小 px, hardness=0..100（工具硬度）, opacity=1..100=100, flow=1..100=100, spacing=1..1000（% of size）=25, layerId?=当前层';
const EXTRA = {
  blur:   'strength=1..100=50, sampleAllLayers=false',
  sharpen:'strength=1..100=50, protectDetail=true（结果夹在 3×3 邻域范围内，不放大杂点与光晕）, sampleAllLayers=false',
  smudge: 'strength=1..100=50, fingerPainting=false（＝一开始手上沾前景色）, color?=手指绘画用的颜色（缺省＝前景色）, sampleAllLayers=false'
};
const OPT_KEYS = { blur:['strength','sampleAllLayers'], sharpen:['strength','sampleAllLayers','protectDetail'], smudge:['strength','sampleAllLayers','fingerPainting'] };
function registerCommands(kind){
  CMD.reg(`${kind}.stroke`, {i18n:'', undoable:true, params:`{${BRUSH_PARAMS}, ${EXTRA[kind]}} → {damage:[x,y,w,h]}`}, p => retouchStroke(kind, p));
  CMD.reg(`${kind}.setOptions`, {i18n:'', params:`{${OPT_KEYS[kind].map(k => k + '?').join(', ')}, size?:px, hardness?:0..100} 滑鼠作画用的选项（＝选项栏；强度与取样所有图层三颗工具共用一份）`}, p => {
    if (typeof p.strength === 'number' && isFinite(p.strength)) O.strength = clamp(Math.round(p.strength), 1, 100);
    if (typeof p.sampleAllLayers === 'boolean') O.sampleAllLayers = p.sampleAllLayers;
    if (kind === 'sharpen' && typeof p.protectDetail === 'boolean') O.protectDetail = p.protectDetail;
    if (kind === 'smudge' && typeof p.fingerPainting === 'boolean') O.fingerPainting = p.fingerPainting;
    if (typeof p.size === 'number' && isFinite(p.size)) ToolState.size = clamp(Math.round(p.size), 1, 5000);
    if (typeof p.hardness === 'number' && isFinite(p.hardness)) ToolState.hardness = clamp(p.hardness, 0, 100) / 100;
    if (window.UI && ToolState.cur === kind && !p._quiet) UI.buildOptions(kind);
    const r = { size:ToolState.size, hardness:Math.round(ToolState.hardness*100) };
    OPT_KEYS[kind].forEach(k => r[k] = O[k]);
    return r;
  });
}
/* retouch_ui.rs finish_stroke：送出的参数 */
function strokeParams(kind, points){
  const p = { strength:O.strength, sampleAllLayers:O.sampleAllLayers };
  if (kind === 'sharpen') p.protectDetail = O.protectDetail;
  if (kind === 'smudge') p.fingerPainting = O.fingerPainting;
  p.points = points.map(q => [q[0], q[1], q[2]]);
  return p;
}

/* ───────── 界面手感（照 clone.js：stroke_constraint／stroke_trail／brush_resize／笔尖圆圈） ───────── */
const SHARED = { lastEnd:null };   // app.last_stroke_end：Shift 点一下从上一笔终点连直线（三颗共用，同 PhotoCraft 整个 app 一份）
const pressure = e => (e && e.pointerType === 'pen' && typeof e.pressure === 'number') ? e.pressure : 1;

const LOCK_DISTANCE = 3;
function snappedDir(o, p, step){
  const dx = p[0]-o[0], dy = p[1]-o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const a = roundAway(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(a), Math.sin(a)];
}
function project(o, dir, p){ const t = (p[0]-o[0])*dir[0] + (p[1]-o[1])*dir[1]; return [o[0] + dir[0]*t, o[1] + dir[1]*t]; }
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
  if (t.fed >= points.length) return;
  const r = (Math.max(diameter, 1) / 2) / t.k, m = q => [q[0]/t.k, q[1]/t.k];
  for (let i = t.fed; i < points.length; i++){ const b = m(points[i]), a = i > 0 ? m(points[i-1]) : b; trailCapsule(t, a, b, r); }
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
  const size = clamp(Math.round(start[0] + 2*dx), 1, 5000);
  const hardness = clamp(start[1] + dy*zoom/HARDNESS_TRAVEL, 0, 1);
  return [size, Math.round(hardness*100)/100];
}

/* 边拖边显示（照 clone.js Live；原码这几颗只画半透明足迹、放开才算——这是我们加的）：
   按下时备份这一层；拖动中每帧把上一帧改过的那块还原成备份，再用到目前为止的点整笔重算一次（不进历史）；放开整层还原、走 CMD 正式落一次 */
function makeLive(kind){
  return {
    begin(){
      const L = Doc.active(); this.L = null; this.dmg = null;
      if (!L || L.kind !== 'raster' || !L.data || !L.data.canvas) return;
      const cv = L.data.canvas, b = document.createElement('canvas'); b.width = cv.width; b.height = cv.height;
      b.getContext('2d').drawImage(cv, 0, 0); this.L = L; this.bak = b;
    },
    restore(){
      const L = this.L, d = this.dmg; if (!L || !d) return;
      const x = Math.max(0, Math.floor(d[0] - L.x)), y = Math.max(0, Math.floor(d[1] - L.y));
      const w = Math.min(L.data.canvas.width - x, Math.ceil(d[2]) + 2), h = Math.min(L.data.canvas.height - y, Math.ceil(d[3]) + 2);
      if (w > 0 && h > 0){ const c = L.data.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        c.clearRect(x, y, w, h); c.drawImage(this.bak, x, y, w, h, x, y, w, h); c.restore(); }
      this.dmg = null;
    },
    update(points){
      if (!this.L || Doc.active() !== this.L) return;
      if (window.Locks && (Locks.blocks(this.L, 'pixels'))) return;
      this.restore();
      const p = strokeParams(kind, points); p.layerId = this.L.id;
      const r = retouchStroke(kind, p); if (r && r.ok) this.dmg = r.damage;
    },
    end(){ this.restore(); this.L = null; this.bak = null; }
  };
}

const STR = {
  'zh-Hant':{ 'opt.rtStrength':'強度：', 'opt.rtSampleAll':'對所有圖層取樣', 'opt.rtProtect':'保護細節', 'opt.rtFinger':'手指繪畫',
              'ui.rtDiameter':'直徑：', 'ui.rtHardness':'硬度：' },
  'zh-Hans':{ 'opt.rtStrength':'强度：', 'opt.rtSampleAll':'对所有图层取样', 'opt.rtProtect':'保护细节', 'opt.rtFinger':'手指绘画',
              'ui.rtDiameter':'直径：', 'ui.rtHardness':'硬度：' },
  'en':     { 'opt.rtStrength':'Strength:', 'opt.rtSampleAll':'Sample All Layers', 'opt.rtProtect':'Protect Detail', 'opt.rtFinger':'Finger Painting',
              'ui.rtDiameter':'Diameter:', 'ui.rtHardness':'Hardness:' }
};

/* 一颗工具（blur／sharpen／smudge 同一套手感，只差送哪条命令与选项栏多哪个勾） */
function makeTool(kind, order, icon){
  registerCommands(kind);
  const U = { drag:null, trail:null, resize:null, hover:null, alt:false, shift:false };
  const Live = makeLive(kind);

  function finishStroke(points){
    Live.end();
    const r = CMD.run(`${kind}.stroke`, strokeParams(kind, points));
    U.lastResult = r;
  }
  function resizeUpdate(x, y){
    const r = U.resize;
    const [size, hardness] = resized(r.start, x - r.anchor[0], y - r.anchor[1], UI.zoom);
    if (ToolState.size === size && ToolState.hardness === hardness) return;
    CMD.map[`${kind}.setOptions`].run({size, hardness:hardness*100, _quiet:true});
  }

  const tool = Tools.reg({
    id:kind, icon, group:'raster', order, for:'raster', needs:'raster', opts:['size','hardness'],
    cursor:'none',
    ui:U, options:O, shared:SHARED, live:Live,
    trailCoverage: (x, y) => U.trail ? U.trail.cov[y*U.trail.w + x] : 0,
    strings:STR,

    /* retouch_ui.rs options_bar 183–192：强度 %、对所有图层取样；锐化多「保护细节」、涂抹多「手指绘画」 */
    buildOptions(box, add, mk){
      const n = mk('number', {min:1, max:100, step:1, value:O.strength});
      n.dataset.opt = 'strength'; n.style.width = '58px';
      n.onchange = () => CMD.run(`${kind}.setOptions`, {strength:+n.value});
      add('rtStrength', n);
      const pctTxt = document.createElement('span'); pctTxt.textContent = '%'; box.appendChild(pctTxt);
      const cb = (key, label, val) => {
        const c = mk('checkbox', {checked:val}); c.dataset.opt = key;
        c.onchange = () => CMD.run(`${kind}.setOptions`, {[key]:c.checked});
        add(label, c);
      };
      cb('sampleAllLayers', 'rtSampleAll', O.sampleAllLayers);
      if (kind === 'sharpen') cb('protectDetail', 'rtProtect', O.protectDetail);
      if (kind === 'smudge') cb('fingerPainting', 'rtFinger', O.fingerPainting);
    },

    onDown(e, pt, P){
      U.alt = e.altKey; U.shift = e.shiftKey; U.hover = pt;
      // brush_resize::pointer：Control+Alt 按下＝改笔刷，不作画
      if (e.ctrlKey && e.altKey && !U.drag){
        U.resize = { anchor:pt.slice(), start:[ToolState.size, ToolState.hardness] };
        UI.draw(); return;
      }
      P.ensureRaster();
      // 当前层锁了像素：整个手势不给（_registry.js 的 TOOL_LOCKS 还没收这三颗 ⇒ 这里自己挡）
      if (window.Locks && Locks.deny(Doc.active(), 'pixels')){ P.down = false; UI.draw(); return; }
      const from = (e.shiftKey && SHARED.lastEnd) ? SHARED.lastEnd.slice() : null;
      const pr = pressure(e);
      const points = [[pt[0], pt[1], pr]];
      if (from) points.unshift([from[0], from[1], pr]);
      U.drag = { start: from || pt.slice(), points, axis:null };
      U.trail = trailNew();
      trailFeed(U.trail, U.drag.points, ToolState.size);
      Live.begin(); Live.update(U.drag.points);
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
        Live.update(d.points);
      }
      UI.draw();
    },
    onUp(e, pt){
      U.alt = e.altKey; U.shift = e.shiftKey;
      if (U.resize){
        resizeUpdate(pt[0], pt[1]); U.resize = null;
        CMD.run(`${kind}.setOptions`, {});
        return;
      }
      const d = U.drag; U.drag = null; U.trail = null;
      if (!d){ UI.draw(); return; }
      const last = d.points.length ? d.points[d.points.length-1] : d.start;
      const q = constrain(d, last, pt, e.shiftKey);
      if (!d.points.length || last[0] !== q[0] || last[1] !== q[1]) d.points.push([q[0], q[1], d.points.length ? last[2] : 1]);
      SHARED.lastEnd = d.points[d.points.length-1].slice(0, 2);
      finishStroke(d.points);
      UI.refresh();
    },
    onDeactivate(){ if (U.drag) Live.end(); U.drag = null; U.trail = null; U.resize = null; U.hover = null; },

    drawOverlay(ctx, s){
      const z = UI.zoom, dpr = s / z;
      const scr = q => [q[0]*s, q[1]*s];
      ctx.save();
      // 拖曳足迹（stroke_trail.rs）：边拖边显示已画上真像素 ⇒ 只有 Live 没画出来时才留
      if (U.trail && !Live.dmg){
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(U.trail.c, 0, 0, U.trail.w*U.trail.k*s, U.trail.h*U.trail.k*s);
      }
      const line = (a, b, w, col) => { ctx.lineWidth = w*dpr; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
      const cross = (c, len) => [[2.5, 'rgba(0,0,0,0.55)'], [1, 'rgba(255,255,255,0.86)']].forEach(([w, col]) => {
        line([c[0]-len*dpr, c[1]], [c[0]+len*dpr, c[1]], w, col);
        line([c[0], c[1]-len*dpr], [c[0], c[1]+len*dpr], w, col);
      });
      // Shift 橡皮筋：上一笔终点 → 游标
      if (U.shift && SHARED.lastEnd && !U.drag && U.hover && !U.resize){
        const a = scr(SHARED.lastEnd), b = scr(U.hover);
        line(a, b, 2.5, 'rgba(0,0,0,0.47)'); line(a, b, 1, 'rgba(255,255,255,0.9)');
      }
      if (U.resize){
        // Ctrl+Alt 改笔刷：圆圈钉在起点、红色笔尖预览、旁边读数（brush_resize.rs）
        const c = scr(U.resize.anchor), R = Math.max(ToolState.size/2*z, 1)*dpr, inner = R*clamp(ToolState.hardness, 0, 1);
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
        g.addColorStop(0, 'rgba(255,0,0,0.43)'); g.addColorStop(inner/R, 'rgba(255,0,0,0.43)'); g.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.fill();
        ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], R + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI*2); ctx.stroke();
        if (U.hover){
          const h = scr(U.hover), t1 = `${Lang.t('ui.rtDiameter')} ${Math.round(ToolState.size)} px`, t2 = `${Lang.t('ui.rtHardness')} ${Math.round(ToolState.hardness*100)}%`;
          ctx.font = `${12*dpr}px sans-serif`;
          const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 12*dpr;
          ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(h[0]+14*dpr, h[1]+14*dpr, w, 38*dpr);
          ctx.fillStyle = '#e6e8eb'; ctx.fillText(t1, h[0]+20*dpr, h[1]+29*dpr); ctx.fillText(t2, h[0]+20*dpr, h[1]+45*dpr);
        }
      } else if (U.hover){
        // 笔尖圆圈（NormalTip：完整半径 ×(0.5＋0.5×硬度)）；canvas.rs brush_tip_centre：半径 >6 屏幕点才画中心十字
        const c = scr(U.hover), full = Math.max(ToolState.size/2*z, 1);
        const rs = Math.max(full*(0.5 + 0.5*clamp(ToolState.hardness, 0, 1)), 1), r = rs*dpr;
        ctx.lineWidth = dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(c[0], c[1], r + 0.5*dpr, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI*2); ctx.stroke();
        if (rs > 6) cross(c, 3);
      }
      ctx.restore();
    }
  });
  return tool;
}

/* 修饰键即时重画（ui.js 按住 Alt／Ctrl 时不交键给工具）；游标离开画布收掉圆圈 */
const KINDS = ['blur', 'sharpen', 'smudge'];
function modKey(e){
  if (!KINDS.includes(ToolState.cur) || !window.UI || !UI.canvas) return;
  if (e.key === 'Alt' || e.key === 'Shift'){
    const U = Tools.get(ToolState.cur).ui;
    if (e.altKey !== U.alt || e.shiftKey !== U.shift){ U.alt = e.altKey; U.shift = e.shiftKey; UI.draw(); }
  }
}
document.addEventListener('keydown', modKey);
document.addEventListener('keyup', modKey);
window.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('view');
  if (v) v.addEventListener('pointerleave', () => {
    if (!KINDS.includes(ToolState.cur)) return;
    const U = Tools.get(ToolState.cur).ui; if (U && !U.drag){ U.hover = null; UI.draw(); }
  });
});

window.RetouchDab = { makeTool, retouchStroke, strokeParams, options:O, shared:SHARED,
  dabs, footprint, perDab, localBlur, localSharpen, Smudge, mixPremultiplied, applyDabStroke };

window.BlurTool = makeTool('blur', 60, '◌');
})();
