/* 修补工具（PS J，ps.patch）——🔴 原码没有·照 PS 2020 写（ArtCraft／PhotoCraft 没有修补工具：grep patch／Patch 于 photocraft/crates 只有滤镜 patchwork）。
   算法全借现成的：window.HealCore（tools/spotheal.js，翻自 algo/src/poisson.rs seamless_clone／solve_membrane、
   algo/src/inpaint.rs complete、engine/src/retouch_cmds.rs heal_region／dilate）、tools/lasso.js 的 lasso.select（圈选区）、
   tools/marquee.js 的 window.SelMask（选区遮罩）、menus/impl/ps-edit.js 的图案库 PsEdit.patterns（「使用图案」）。
   PS 2020 的行为（我们照做）：
   - 没选区／在选区外拖＝像套索一样圈选区（Shift 加、Alt 减、Shift+Alt 交集；选项栏四个模式钮）；点一下不拖＝取消选择
   - 在选区里拖＝拖着选区走（看得到边界与内容预览），放开时修补：
       「源」：把拖到的地方的纹理补进原本的选区，再用梯度域（Poisson）融进原选区四周的颜色与亮度；选区留在原处
       「目标」：把原选区的内容补到放开的地方（同样融进那里），选区跟着搬过去
       「透明」：混合梯度（Pérez 2003 mixing gradients）——取样纹理与原本内容取强的那一边，原本的线条保留下来
       「扩散」1–7：贴回去时选区内缘的过渡宽度（1＝硬边）
       「使用图案」：拿图案库的图案当来源，补进选区（同样梯度域融合）
   - 修补：「内容识别」：结构 1–7（7＝严格照抄拖到的那块，越小越让内容识别自己补）、颜色 0–10（0＝不调色，10＝完全融进四周颜色）、对所有图层取样
   命令（agent 与人同一条路）：patch.apply / patch.usePattern / patch.setOptions；圈选区走 lasso.select（同套索）
   这里同时挂 window.PatchKit（选区平移、内容预览、修补融合、套索手势），tools/contentmove.js 读它。 */
(function(){
const H = window.HealCore;
if (!H){ console.error('patch.js: window.HealCore（tools/spotheal.js）没载入'); return; }
const RC = H.RC;
const asNum = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const L3 = (a, b, c) => ({'zh-Hant':a, 'zh-Hans':b, 'en':c});
const toStrings = S => { const o = {'zh-Hant':{}, 'zh-Hans':{}, 'en':{}}; Object.keys(S).forEach(k => Object.keys(o).forEach(l => o[l][k] = S[k][l])); return o; };
const SEL_MODES = ['replace', 'add', 'subtract', 'intersect'];
const CLICK_DIST = 6;            // 同 marquee.js／lasso.js：按下后移动没超过 6 个萤幕点＝点一下

/* ───────── 选区遮罩（整张文件的 8 位覆盖度） ───────── */
function selBytes(){ return (window.SelMask && Doc.sel) ? SelMask.bytes() : null; }
/* 整数平移（移出文件的部分丢掉） */
function shiftBytes(b, dx, dy){
  const W = Doc.width, Hh = Doc.height, out = new Uint8Array(W*Hh);
  for (let y = 0; y < Hh; y++){
    const sy = y - dy; if (sy < 0 || sy >= Hh) continue;
    for (let x = 0; x < W; x++){ const sx = x - dx; if (sx >= 0 && sx < W) out[y*W + x] = b[sy*W + sx]; }
  }
  return out;
}
function bytesBox(b){
  const W = Doc.width, Hh = Doc.height; let x0 = W, y0 = Hh, x1 = -1, y1 = -1;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (b[y*W + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
const docRect = () => [0, 0, Doc.width, Doc.height];
/* 文件遮罩 → 某块 rect 的 0..1 覆盖度 */
function cropCov(b, rect){
  const W = Doc.width, w = RC.w(rect), h = RC.h(rect), out = new Float32Array(w*h);
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++)
    if (x >= 0 && y >= 0 && x < W && y < Doc.height) out[(y - rect[1])*w + (x - rect[0])] = b[y*W + x] / 255;
  return out;
}
/* 区域（Region）平移读：rect 这一块读 S 在 (x+dx, y+dy) 的像素，标回 rect */
function readShifted(S, rect, dx, dy){
  const r = H.readRegion(S, [rect[0]+dx, rect[1]+dy, rect[2]+dx, rect[3]+dy]); r.rect = rect.slice(); return r;
}
/* 来源：当前层（像素层缓冲，带 L.x/L.y）或整份文件合成（对所有图层取样） */
const sourceOf = (L, all) => all ? H.compositeBuffer(L, 'all') : H.layerBuffer(L);

/* 选区内缘的过渡（扩散）：3-4 倒角距离；宽 w 像素内线性渐进到 1，w=0＝硬边 */
function innerRamp(mask, w, h, width){
  const out = new Float32Array(w*h);
  if (width <= 0){ for (let i = 0; i < w*h; i++) out[i] = mask[i] ? 1 : 0; return out; }
  const INF = 1e9, d = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[y*w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y*w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x-1, y) + 3, at(x, y-1) + 3, at(x-1, y-1) + 4, at(x+1, y-1) + 4);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--){
    const i = y*w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x+1, y) + 3, at(x, y+1) + 3, at(x+1, y+1) + 4, at(x-1, y+1) + 4);
  }
  for (let i = 0; i < w*h; i++) out[i] = mask[i] ? Math.min(1, (d[i] / 3) / (width + 1)) : 0;
  return out;
}

/* 混合梯度的 Poisson（「透明」）：Δf = div v，v_pq＝取样与原图在这条边上梯度大的那个；遮罩外＝原图（Dirichlet），格外不算（Neumann）。
   初值用一般修补（heal_region）的结果，SOR 收敛 */
function mixedSolve(src, dst, mask, init){
  const w = RC.w(dst.rect), h = RC.h(dst.rect), ch = dst.ch;
  const out = Float32Array.from(init.data), S = src.data, D = dst.data;
  const cells = []; for (let i = 0; i < w*h; i++) if (mask[i]) cells.push(i);
  const nb = (i) => { const x = i % w, y = (i / w) | 0, r = []; if (x > 0) r.push(i-1); if (x+1 < w) r.push(i+1); if (y > 0) r.push(i-w); if (y+1 < h) r.push(i+w); return r; };
  const NB = cells.map(nb);
  for (let c = 0; c < ch; c++){
    for (let it = 0; it < 600; it++){
      let maxD = 0;
      for (let k = 0; k < cells.length; k++){
        const p = cells[k], ns = NB[k]; let s = 0;
        for (const q of ns){
          const gs = S[p*ch+c] - S[q*ch+c], gd = D[p*ch+c] - D[q*ch+c];
          s += (mask[q] ? out[q*ch+c] : D[q*ch+c]) + (Math.abs(gs) > Math.abs(gd) ? gs : gd);
        }
        const dv = 1.85 * (s / ns.length - out[p*ch+c]);
        out[p*ch+c] += dv; if (Math.abs(dv) > maxD) maxD = Math.abs(dv);
      }
      if (maxD < 1e-5) break;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], 0, 1);
  return { rect:dst.rect.slice(), ch, data:out };
}

/* 把一块区域（0..1 直通 RGBA）照权重贴回图层：预乘内插（权重 1＝取代）；锁透明像素＝原本透明的跳过、alpha 不变 */
function putRegion(L, reg, weight, lock){
  const rect = reg.rect, W = RC.w(rect), P = reg.data;
  const cw = L.data.canvas.width, chh = L.data.canvas.height;
  const x0 = Math.max(rect[0], L.x), y0 = Math.max(rect[1], L.y), x1 = Math.min(rect[2], L.x + cw), y1 = Math.min(rect[3], L.y + chh);
  if (x1 <= x0 || y1 <= y0) return [0,0,0,0];
  const rw = x1 - x0, rh = y1 - y0, ctx = L.data.ctx;
  const img = ctx.getImageData(x0 - L.x, y0 - L.y, rw, rh), d = img.data;
  let bb = null;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
    const i = (y - rect[1])*W + (x - rect[0]), k = Math.min(weight[i], 1);
    if (!(k > 0)) continue;
    const o = ((y - y0)*rw + (x - x0))*4, pi = i*4, da = d[o+3]/255, sa = P[pi+3];
    if (lock){
      if (da <= 0) continue;
      for (let c = 0; c < 3; c++) d[o+c] = d[o+c]*(1 - k) + P[pi+c]*255*k;
    } else {
      const oa = da + (sa - da)*k;
      if (oa > 0) for (let c = 0; c < 3; c++) d[o+c] = (d[o+c]*da*(1 - k) + P[pi+c]*255*sa*k) / oa;
      d[o+3] = oa*255;
    }
    if (!bb) bb = [x, y, x+1, y+1]; else { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x+1); bb[3] = Math.max(bb[3], y+1); }
  }
  ctx.putImageData(img, x0 - L.x, y0 - L.y);
  return bb || [0,0,0,0];
}

/* 内容识别补洞（同污点修复 spot_heal_surface 的拼法：domain 膨胀 2 格、complete（不行就膜内插）、heal_region 膨胀 1 格融进四周） */
function fillHole(img, hole){
  const w = RC.w(img.rect), h = RC.h(img.rect), ch = img.ch;
  const domain = H.dilate(w, h, hole, 2), healMask = H.dilate(w, h, hole, 1);
  const filled = H.complete(w, h, ch, img.data, domain) || H.membraneFill(w, h, ch, img.data, domain);
  const r = H.healRegion({ rect:img.rect, ch, data:Float32Array.from(filled) }, img, healMask);
  return r;
}
/* 「颜色」：guide＝整块的取样内容（选区外也要是取样那边的样子，梯度域才看得到选区边上的落差）；
   0＝选区里原样贴 guide，10＝梯度域完全融进 around 四周（heal_region），中间按比例。回：选区里＝结果、选区外＝around */
function adaptPatch(guide, around, mask, color){
  const w = RC.w(around.rect), h = RC.h(around.rect), ch = around.ch;
  const out = Float32Array.from(around.data);
  const k = clamp(color, 0, 10) / 10, healed = k > 0 ? H.healRegion(guide, around, mask) : null;
  for (let i = 0; i < w*h; i++) if (mask[i]) for (let c = 0; c < ch; c++){
    const g = guide.data[i*ch+c];
    out[i*ch+c] = healed ? clamp(g + (healed.data[i*ch+c] - g)*k, 0, 1) : g;
  }
  return { rect:around.rect.slice(), ch, data:out };
}
/* 结构：严格照抄（strict）与内容识别自己补（free）按比例混（7＝全用 strict）；整块都混，选区边上才连续 */
function mixStructure(strict, free, structure){
  const t = (clamp(structure, 1, 7) - 1) / 6;
  if (t >= 1 || !free) return strict;
  const out = Float32Array.from(strict.data);
  for (let i = 0; i < out.length; i++) out[i] = free.data[i] + (strict.data[i] - free.data[i])*t;
  return { rect:strict.rect.slice(), ch:strict.ch, data:out };
}
/* 内容识别的工作区要多大：洞外框外扩（结构越低给越大的自由度） */
const caMargin = (box, structure) => Math.round(clamp(Math.max(RC.w(box), RC.h(box)) * 0.5, 12, 64) + (7 - clamp(structure, 1, 7)) * 4);

/* ───────── 修补本体（patch.apply） ───────── */
const C = 'patch.apply';
function targetLayer(p){
  const lid = p.layerId !== undefined ? p.layerId : p.layer;
  const L = lid !== undefined ? Doc.byId(lid) : Doc.active();
  if (!L) return {error:'no active layer'};
  if (L.kind !== 'raster') return {error:`active layer is a ${L.kind} layer, not a pixel layer`};
  return {L};
}
function parseCommon(p, cmd){
  const t = targetLayer(p); if (t.error) return {error:`${cmd}: ${t.error}`};
  const b = selBytes(); if (!b) return {error:`${cmd}: needs a selection (draw one first: lasso.select / marquee.select, or drag with the tool)`};
  const box = bytesBox(b); if (!box) return {error:`${cmd}: the selection is empty`};
  return { L:t.L, b, box,
    diffusion: Math.round(clamp(asNum(p.diffusion, 5), 1, 7)),
    structure: Math.round(clamp(asNum(p.structure, 4), 1, 7)),
    color: Math.round(clamp(asNum(p.color, 0), 0, 10)),
    transparent: p.transparent === true,
    sampleAll: p.sampleAllLayers === true };
}
/* 把 src 补进 mask（rect 上的 0/1）那块，回贴好的区域与权重 */
function healInto(dst, src, maskU8, cov, o){
  const w = RC.w(dst.rect), h = RC.h(dst.rect);
  let healed = H.healRegion(src, dst, maskU8);
  if (o.transparent) healed = mixedSolve(src, dst, maskU8, healed);
  const ramp = innerRamp(maskU8, w, h, o.diffusion - 1);
  const wt = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) wt[i] = cov[i] * ramp[i];
  return { healed, wt };
}
function patchApply(p){
  const o = parseCommon(p, C); if (o.error) return {ok:false, error:o.error};
  const kind = p.patch === undefined ? 'normal' : p.patch;
  if (kind !== 'normal' && kind !== 'contentAware') return {ok:false, error:`${C}: unknown patch \`${kind}\` (normal|contentAware)`};
  const dir = p.direction === undefined ? 'source' : p.direction;
  if (dir !== 'source' && dir !== 'destination') return {ok:false, error:`${C}: unknown direction \`${dir}\` (source|destination)`};
  const dx = Math.round(asNum(p.dx, 0)), dy = Math.round(asNum(p.dy, 0));
  if (!dx && !dy) return {ok:false, error:`${C}: dx/dy is 0 — drag the selection somewhere else first`};
  const lf = H.lockFail(o.L, C); if (lf) return lf;
  const lock = H.lockAlpha(o.L), L = o.L;
  // 目标区（被补的那块）与读取位移：源＝补原选区、读 +d；目标＝补搬过去的那块、读 −d
  const dest = (kind === 'normal' && dir === 'destination');
  const tb = dest ? shiftBytes(o.b, dx, dy) : o.b;
  const tbox = bytesBox(tb); if (!tbox) return {ok:false, error:`${C}: the patch lands outside the canvas`};
  const rx = dest ? -dx : dx, ry = dest ? -dy : dy;
  const S = sourceOf(L, o.sampleAll), Ldst = H.layerBuffer(L);
  let dmg;
  if (kind === 'normal'){
    const rect = RC.intersect(RC.inflate(tbox, 2), docRect());
    const dst = H.readRegion(Ldst, rect), src = readShifted(S, rect, rx, ry);
    const cov = cropCov(tb, rect), m = Uint8Array.from(cov, v => v > 0 ? 1 : 0);
    const { healed, wt } = healInto(dst, src, m, cov, o);
    dmg = putRegion(L, healed, wt, lock);
  } else {
    // 内容识别：工作区＝洞与取样那块的联集外扩
    const sbox = [tbox[0]+rx, tbox[1]+ry, tbox[2]+rx, tbox[3]+ry];
    const uni = [Math.min(tbox[0], sbox[0]), Math.min(tbox[1], sbox[1]), Math.max(tbox[2], sbox[2]), Math.max(tbox[3], sbox[3])];
    const rect = RC.intersect(RC.inflate(uni, caMargin(tbox, o.structure)), docRect());
    const around = H.readRegion(S, rect);
    const cov = cropCov(tb, rect), m = Uint8Array.from(cov, v => v > 0 ? 1 : 0);
    const strict = readShifted(S, rect, rx, ry);
    const free = o.structure < 7 ? fillHole(around, m) : null;
    const mixed = adaptPatch(mixStructure(strict, free, o.structure), around, m, o.color);
    const ramp = innerRamp(m, RC.w(rect), RC.h(rect), Math.round((7 - o.structure) / 2));
    const wt = Float32Array.from(cov, (v, i) => v * ramp[i]);
    dmg = putRegion(L, mixed, wt, lock);
  }
  // 选区：源＝留原处；目标＝跟着搬过去（PS）
  if (dest) Doc.sel = SelMask.fromBytes(tb);
  return { ok:true, patch:kind, direction: kind === 'normal' ? dir : 'source', offset:[dx, dy],
           damage:[dmg[0], dmg[1], dmg[2]-dmg[0], dmg[3]-dmg[1]], selection:Doc.sel };
}

/* 「使用图案」：选区里补上图案（图案库 PsEdit.patterns；铺法照 ps-edit.js renderPattern：文件原点对齐、环绕双线性） */
function patternLib(){ return (window.PsEdit && PsEdit.patterns) || null; }
function renderPattern(pat, r, origin, scale){
  const tw = pat.width, th = pat.height, tp = new Float32Array(tw*th*4);
  for (let i = 0; i < tw*th; i++){ const a = pat.px[i*4+3]/255; tp[i*4] = pat.px[i*4]/255*a; tp[i*4+1] = pat.px[i*4+1]/255*a; tp[i*4+2] = pat.px[i*4+2]/255*a; tp[i*4+3] = a; }
  const mod = (v, n) => ((v % n) + n) % n, inv = 1 / clamp(scale || 1, 0.01, 10);
  const w = RC.w(r), h = RC.h(r), out = new Float32Array(w*h*4), acc = [0,0,0,0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const u = (r[0] + x + 0.5 - origin[0])*inv - 0.5, v = (r[1] + y + 0.5 - origin[1])*inv - 0.5;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    for (const [ddy, wy] of [[0, 1-fy], [1, fy]]){ if (!wy) continue;
      for (const [ddx, wx] of [[0, 1-fx], [1, fx]]){ if (!wx) continue;
        const j = (mod(y0+ddy, th)*tw + mod(x0+ddx, tw))*4, k = wx*wy;
        acc[0] += tp[j]*k; acc[1] += tp[j+1]*k; acc[2] += tp[j+2]*k; acc[3] += tp[j+3]*k; } }
    const o = (y*w + x)*4;
    if (acc[3] > 0){ out[o] = acc[0]/acc[3]; out[o+1] = acc[1]/acc[3]; out[o+2] = acc[2]/acc[3]; out[o+3] = Math.min(acc[3], 1); }
  }
  return { rect:r.slice(), ch:4, data:out };
}
function resolvePattern(key, cmd){
  const lib = patternLib(); if (!lib) return {error:`${cmd}: pattern library (menus/impl/ps-edit.js) not loaded`};
  const pat = lib.resolve(typeof key === 'string' ? key : '');
  return pat ? {pat} : {error:`${cmd}: no pattern "${key || ''}" (see ps.pattern.list)`};
}
function usePattern(p){
  const CU = 'patch.usePattern';
  const o = parseCommon(p, CU); if (o.error) return {ok:false, error:o.error};
  const rp = resolvePattern(p.pattern, CU); if (rp.error) return {ok:false, error:rp.error};
  const lf = H.lockFail(o.L, CU); if (lf) return lf;
  const L = o.L, rect = RC.intersect(RC.inflate(o.box, 2), docRect());
  const dst = H.readRegion(H.layerBuffer(L), rect);
  const src = renderPattern(rp.pat, rect, [0, 0], asNum(p.scale, 100) / 100);
  const cov = cropCov(o.b, rect), m = Uint8Array.from(cov, v => v > 0 ? 1 : 0);
  const { healed, wt } = healInto(dst, src, m, cov, o);
  const dmg = putRegion(L, healed, wt, H.lockAlpha(L));
  return { ok:true, pattern:rp.pat.id, damage:[dmg[0], dmg[1], dmg[2]-dmg[0], dmg[3]-dmg[1]] };
}

CMD.reg(C, {i18n:'tool.patch', undoable:true,
  params:'{dx, dy:选区拖了多少（文件像素，取整；必填、不能都是 0）, patch="normal"|"contentAware"="normal", direction="source"|"destination"="source"'
       + '（源＝把 (选区+d) 那块的纹理补进原选区、选区不动；目标＝把原选区内容补到 (选区+d)、选区跟着搬）, transparent=false（混合梯度：原图较强的线条保留）, '
       + 'diffusion=1..7=5（选区内缘过渡宽），structure=1..7=4（内容识别：7＝严格照抄取样那块）, color=0..10=0（内容识别：0＝不调色、10＝完全融进四周）, '
       + 'sampleAllLayers=false（取样整份文件合成、写进当前层）, layerId?=当前层} 要先有选区（套索 lasso 的 select 命令、marquee.select，或拖着工具圈）→ {ok, damage:[x,y,w,h], selection}'},
  patchApply);
CMD.reg('patch.usePattern', {i18n:'tool.patch', undoable:true,
  params:'{pattern?:图案 id|名字（缺省＝图案库第一个；见 ps.pattern.list）, scale=100（%）, diffusion=1..7=5, transparent=false, layerId?} 选项栏「使用图案」：把图案补进选区并用梯度域融进四周 → {ok, pattern, damage}'},
  usePattern);

/* ───────── 内容预览画布（拖着选区时看得到的那块）：bb 这块显示来源在 (x+rdx, y+rdy) 的像素、乘上遮罩 b 在 (x,y) 的覆盖度 ───────── */
function contentCanvas(srcCanvas, sox, soy, b, bb, rdx, rdy){
  const w = RC.w(bb), h = RC.h(bb), c = document.createElement('canvas'); c.width = Math.max(w, 1); c.height = Math.max(h, 1);
  const x = c.getContext('2d');
  x.drawImage(srcCanvas, sox - bb[0] - rdx, soy - bb[1] - rdy);
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data, W = Doc.width;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++){
    const X = bb[0] + xx, Y = bb[1] + yy, o = (yy*w + xx)*4;
    const v = (X >= 0 && Y >= 0 && X < W && Y < Doc.height) ? b[Y*W + X] : 0;
    d[o+3] = d[o+3] * v / 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
/* 选区边界平移后画（行军蚁） */
function drawShiftedSel(ctx, s, sel, dx, dy){
  if (!sel) return;
  const dpr = s / UI.zoom, sc = p => [Math.round((p[0]+dx)*s) + 0.5, Math.round((p[1]+dy)*s) + 0.5];
  ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
  if (sel.mask) SelMask.outline(sel).forEach(([a, b]) => { const A = sc(a), B = sc(b); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); });
  else { const A = sc([sel.x, sel.y]), B = sc([sel.x + sel.w, sel.y + sel.h]); ctx.rect(A[0], A[1], B[0]-A[0], B[1]-A[1]); }
  ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4*dpr, 4*dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}
/* 套索手势（圈选区；同 lasso.js：曼哈顿距离 >0.25 才记一点，放开 ≥3 点走 lasso.select，点一下走 lasso.deselect） */
function modeFrom(e, base){ return (e.shiftKey && e.altKey) ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : base; }
function drawLassoPath(ctx, s, pts){
  if (!pts || pts.length < 2) return;
  const dpr = s / UI.zoom;
  ctx.save(); ctx.lineWidth = 1; ctx.beginPath();
  pts.forEach((q, i) => { const x = Math.round(q[0]*s) + 0.5, y = Math.round(q[1]*s) + 0.5; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4*dpr, 4*dpr]); ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}
function lassoFinish(d){
  if (d.moved && d.points.length >= 3) return CMD.run('lasso.select', {points:d.points.map(q => [q[0], q[1]]), mode:d.mode, antiAlias:true, feather:0});
  if (!d.moved && Doc.sel) return CMD.run('lasso.deselect', {});
  return null;
}
const screenDist = (e, d) => Math.hypot(e.clientX - d.client0[0], e.clientY - d.client0[1]);
/* 选项栏的四个选区模式钮（新选区／添加／减去／交叉） */
const MODE_ICON = {replace:'▭', add:'⊞', subtract:'⊟', intersect:'⊠'};
function modeButtons(box, cur, onPick){
  SEL_MODES.forEach(m => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = MODE_ICON[m]; b.dataset.opt = 'mode-' + m;
    b.title = Lang.t('ui.pk.mode.' + m);
    b.style.cssText = 'min-width:24px;padding:1px 4px;margin-right:2px;' + (m === cur ? 'background:#4a6fa5;color:#fff' : '');
    b.onclick = () => onPick(m);
    box.appendChild(b);
  });
  const sep = document.createElement('span'); sep.style.cssText = 'display:inline-block;width:1px;height:18px;background:#3a3f47;margin:0 6px;vertical-align:middle';
  box.appendChild(sep);
}
const KIT_STRINGS = {
  'ui.pk.mode.replace':   L3('新增選取範圍', '新选区', 'New Selection'),
  'ui.pk.mode.add':       L3('增加至選取範圍', '添加到选区', 'Add to Selection'),
  'ui.pk.mode.subtract':  L3('從選取範圍中減去', '从选区减去', 'Subtract from Selection'),
  'ui.pk.mode.intersect': L3('與選取範圍相交', '与选区交叉', 'Intersect with Selection'),
  'ui.pk.needRaster':     L3('要在像素圖層上用', '要在像素图层上用', 'Use it on a pixel layer'),
};

window.PatchKit = { selBytes, shiftBytes, bytesBox, cropCov, readShifted, sourceOf, innerRamp, mixedSolve, putRegion, fillHole, adaptPatch, mixStructure,
  caMargin, renderPattern, resolvePattern, contentCanvas, drawShiftedSel, modeFrom, drawLassoPath, lassoFinish, screenDist, modeButtons,
  KIT_STRINGS, L3, toStrings, CLICK_DIST, SEL_MODES, docRect, targetLayer };

/* ───────── 选项与界面 ───────── */
const U = {
  patch:'normal', direction:'source', transparent:false, diffusion:5, structure:4, color:0, sampleAll:false,
  mode:'replace', pattern:'',
  drag:null, hover:null, status:null, prev:null
};
CMD.reg('patch.setOptions', {i18n:'',
  params:'{patch?:"normal"|"contentAware", direction?:"source"|"destination", transparent?:bool, diffusion?:1..7, structure?:1..7, color?:0..10, sampleAllLayers?:bool, '
       + 'mode?:"replace"|"add"|"subtract"|"intersect"（圈选区的模式＝选项栏四钮）, pattern?:图案 id|名字（「使用图案」用）} 滑鼠用的选项（＝选项栏）'}, p => {
  if (p.patch !== undefined){ if (p.patch !== 'normal' && p.patch !== 'contentAware') return {ok:false, error:`patch.setOptions: unknown patch \`${p.patch}\``}; U.patch = p.patch; }
  if (p.direction !== undefined){ if (p.direction !== 'source' && p.direction !== 'destination') return {ok:false, error:`patch.setOptions: unknown direction \`${p.direction}\``}; U.direction = p.direction; }
  if (typeof p.transparent === 'boolean') U.transparent = p.transparent;
  if (typeof p.diffusion === 'number') U.diffusion = Math.round(clamp(p.diffusion, 1, 7));
  if (typeof p.structure === 'number') U.structure = Math.round(clamp(p.structure, 1, 7));
  if (typeof p.color === 'number') U.color = Math.round(clamp(p.color, 0, 10));
  if (typeof p.sampleAllLayers === 'boolean') U.sampleAll = p.sampleAllLayers;
  if (SEL_MODES.includes(p.mode)) U.mode = p.mode;
  if (typeof p.pattern === 'string') U.pattern = p.pattern;
  if (window.UI && ToolState.cur === 'patch') UI.buildOptions('patch');
  return { ok:true, patch:U.patch, direction:U.direction, transparent:U.transparent, diffusion:U.diffusion, structure:U.structure, color:U.color, sampleAllLayers:U.sampleAll, mode:U.mode, pattern:U.pattern };
});

function setStatus(st){
  U.status = st;
  const el = document.getElementById('patchStatus'); if (el) el.textContent = st ? (st.key ? Lang.t(st.key) : String(st.text || '')) : '';
}
function applyParams(dx, dy){
  return { dx, dy, patch:U.patch, direction:U.direction, transparent:U.transparent, diffusion:U.diffusion, structure:U.structure, color:U.color, sampleAllLayers:U.sampleAll };
}
/* 按下：在选区里（且没按 Shift／Alt）＝拖选区；不然＝圈选区 */
function beginMove(L, pt, e){
  const b = selBytes(), box = b && bytesBox(b); if (!box) return false;
  const all = U.patch === 'contentAware' && U.sampleAll;
  const srcC = all ? composite(1) : L.data.canvas, sox = all ? 0 : L.x, soy = all ? 0 : L.y;
  U.drag = { type:'move', start:pt.slice(), off:[0, 0], b, box, srcC, sox, soy, client0:[e.clientX, e.clientY], moved:false };
  U.prev = null;
  return true;
}
function movePreview(d){
  const [dx, dy] = d.off;
  if (!dx && !dy){ U.prev = null; return; }
  const dest = U.patch === 'normal' && U.direction === 'destination';
  // 源：原选区里显示拖到那块；目标：拖到那块显示原选区内容
  U.prev = dest ? { c:contentCanvas(d.srcC, d.sox, d.soy, d.b, d.box, 0, 0), at:[d.box[0]+dx, d.box[1]+dy] }
                : { c:contentCanvas(d.srcC, d.sox, d.soy, d.b, d.box, dx, dy), at:[d.box[0], d.box[1]] };
}

const tool = Tools.reg({
  id:'patch', icon:'⧉', group:'raster', order:42, for:'raster', needs:'raster',
  ui:U,
  strings: toStrings(Object.assign({
    'tool.patch':        L3('修補工具', '修补工具', 'Patch Tool'),
    'opt.pt.patch':      L3('修補：', '修补：', 'Patch:'),
    'ui.pt.normal':      L3('正常', '正常', 'Normal'),
    'ui.pt.contentAware':L3('內容感知', '内容识别', 'Content-Aware'),
    'ui.pt.source':      L3('來源', '源', 'Source'),
    'ui.pt.destination': L3('目的地', '目标', 'Destination'),
    'ui.pt.transparent': L3('透明', '透明', 'Transparent'),
    'ui.pt.usePattern':  L3('使用圖樣', '使用图案', 'Use Pattern'),
    'opt.pt.diffusion':  L3('擴散：', '扩散：', 'Diffusion:'),
    'opt.pt.structure':  L3('結構：', '结构：', 'Structure:'),
    'opt.pt.color':      L3('顏色：', '颜色：', 'Color:'),
    'ui.pt.sampleAll':   L3('取樣全部圖層', '对所有图层取样', 'Sample All Layers'),
  }, KIT_STRINGS)),

  /* 选项栏照 PS 2020：选区四钮｜修补：正常／内容识别｜（正常）源 目标 透明 使用图案[图案▾] 扩散｜（内容识别）结构 颜色 对所有图层取样 */
  buildOptions(box, add, mk){
    modeButtons(box, U.mode, m => CMD.run('patch.setOptions', {mode:m}));
    const kind = document.createElement('select'); kind.dataset.opt = 'patchKind';
    ['normal', 'contentAware'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = Lang.t('ui.pt.' + v); kind.appendChild(o); });
    kind.value = U.patch; kind.onchange = () => CMD.run('patch.setOptions', {patch:kind.value});
    add('pt.patch', kind);
    const chk = (key, on, f) => { const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.dataset.opt = key;
      cb.onchange = () => f(cb.checked); l.appendChild(cb); const t = document.createElement('span'); t.textContent = Lang.t('ui.pt.' + key); l.appendChild(t); box.appendChild(l); return cb; };
    const num = (key, lo, hi, v) => { const n = mk('number', {min:lo, max:hi, value:v}); n.dataset.opt = key; n.style.width = '48px';
      n.onchange = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('patch.setOptions', {[key]: +n.value}); }; add('pt.' + key, n); return n; };
    if (U.patch === 'normal'){
      ['source', 'destination'].forEach(v => {
        const l = document.createElement('label'); const r = document.createElement('input'); r.type = 'radio'; r.name = 'patchDir'; r.checked = U.direction === v; r.dataset.opt = 'dir-' + v;
        r.onchange = () => CMD.run('patch.setOptions', {direction:v});
        l.appendChild(r); const t = document.createElement('span'); t.textContent = Lang.t('ui.pt.' + v); l.appendChild(t); box.appendChild(l);
      });
      chk('transparent', U.transparent, v => CMD.run('patch.setOptions', {transparent:v}));
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = Lang.t('ui.pt.usePattern'); btn.dataset.opt = 'usePattern';
      btn.disabled = !Doc.sel;
      btn.onclick = () => { const r = CMD.run('patch.usePattern', {pattern:U.pattern, diffusion:U.diffusion, transparent:U.transparent}); setStatus(r && r.ok === false ? {text:r.error} : null); };
      box.appendChild(btn);
      const lib = patternLib(), ps = document.createElement('select'); ps.dataset.opt = 'pattern';
      (lib ? lib.load() : []).forEach(q => { const o = document.createElement('option'); o.value = q.id; o.textContent = q.name; ps.appendChild(o); });
      if (U.pattern) ps.value = U.pattern;
      ps.onchange = () => { U.pattern = ps.value; };
      box.appendChild(ps);
      num('diffusion', 1, 7, U.diffusion);
    } else {
      num('structure', 1, 7, U.structure);
      num('color', 0, 10, U.color);
      chk('sampleAll', U.sampleAll, v => CMD.run('patch.setOptions', {sampleAllLayers:v}));
    }
    const st = document.createElement('span'); st.id = 'patchStatus'; st.style.color = '#e8573f'; box.appendChild(st);
    setStatus(U.status);
  },

  onDown(e, pt, P){
    U.hover = pt;
    const L = Doc.active();
    if (!L || L.kind !== 'raster'){ setStatus({key:'ui.pk.needRaster'}); P.down = false; return; }
    const inside = Doc.sel && SelMask.coverage(Math.floor(pt[0]), Math.floor(pt[1])) > 0 && !e.shiftKey && !e.altKey;
    if (inside){
      if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; return; }
      if (beginMove(L, pt, e)){ UI.draw(); return; }
    }
    U.drag = { type:'lasso', points:[pt.slice()], mode:modeFrom(e, U.mode), client0:[e.clientX, e.clientY], moved:false };
    UI.draw();
  },
  onMove(e, pt, P){
    U.hover = pt;
    const d = U.drag;
    if (d && P.down){
      if (!d.moved && screenDist(e, d) > CLICK_DIST) d.moved = true;
      if (d.type === 'lasso'){
        const last = d.points[d.points.length-1];
        if (Math.abs(last[0]-pt[0]) + Math.abs(last[1]-pt[1]) > 0.25) d.points.push(pt.slice());
      } else {
        d.off = [Math.round(pt[0] - d.start[0]), Math.round(pt[1] - d.start[1])];
        movePreview(d);
      }
    }
    UI.draw();
  },
  onUp(e, pt){
    const d = U.drag; U.drag = null; U.prev = null;
    if (!d){ UI.draw(); return; }
    if (d.type === 'lasso'){
      const last = d.points[d.points.length-1];
      if (last[0] !== pt[0] || last[1] !== pt[1]) d.points.push(pt.slice());
      lassoFinish(d);
      if (ToolState.cur === 'patch') UI.buildOptions('patch');
      UI.refresh(); return;
    }
    const off = [Math.round(pt[0] - d.start[0]), Math.round(pt[1] - d.start[1])];
    if (off[0] || off[1]){
      const r = CMD.run(C, applyParams(off[0], off[1]));
      setStatus(r && r.ok === false ? {text:r.error} : null);
    }
    UI.refresh();
  },
  onKey(e){
    if (e.key === 'Escape' && U.drag){ U.drag = null; U.prev = null; UI.draw(); return true; }
    return false;
  },
  onDeactivate(){ U.drag = null; U.prev = null; U.hover = null; },

  drawOverlay(ctx, s){
    const d = U.drag;
    if (!d) return;
    if (d.type === 'lasso'){ drawLassoPath(ctx, s, d.points); return; }
    if (U.prev){
      ctx.save(); ctx.imageSmoothingEnabled = s < 1; ctx.globalAlpha = 0.85;
      ctx.drawImage(U.prev.c, U.prev.at[0]*s, U.prev.at[1]*s, U.prev.c.width*s, U.prev.c.height*s);
      ctx.restore();
    }
    drawShiftedSel(ctx, s, Doc.sel, d.off[0], d.off[1]);
  }
});

window.PatchTool = tool;
})();
